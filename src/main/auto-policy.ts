import { generateText } from 'ai'
import { z } from 'zod'
import type { AppConfig, AutoModePolicy, MessagePart } from '@shared/types'
import { costOf } from '@shared/cost'
import { logLine } from './log'
import { record as meterRecord } from './meter'
import { resolveModel } from './providers'
import * as store from './store'

/**
 * Auto-approve with rules, the way Claude Code's auto mode works.
 *
 * Without rules, auto-approve lifts every prompt. With them, each call that
 * would have asked is put to a model with the rules, the action and what the
 * person said in the conversation: a deny rule refuses the call with its reason,
 * the person's own words can authorise it, and anything the rules do not mention
 * goes through. A judge that cannot answer hands the call back to the person.
 */

export interface PolicyQuestion {
  rules: AutoModePolicy
  action: string
  cwd: string
  /** The person's latest messages in the conversation, oldest first. */
  asked: string[]
}

export interface PolicyVerdict {
  allowed: boolean
  rule?: string
  reason?: string
}

type Judge = (question: PolicyQuestion) => Promise<PolicyVerdict | null>

const VERDICT = z.object({
  allowed: z.boolean(),
  rule: z.string().optional(),
  reason: z.string().optional()
})

let judgeOverride: Judge | null = null
const verdicts = new Map<string, PolicyVerdict>()
const VERDICT_CAP = 500

/** Test seam: drives the whole path without a provider. */
export function setPolicyJudge(judge: Judge | null): void {
  judgeOverride = judge
  verdicts.clear()
}

export function hasPolicy(config: AppConfig): boolean {
  return (config.autoMode?.allow.length ?? 0) + (config.autoMode?.deny.length ?? 0) > 0
}

function textOf(parts: MessagePart[]): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
}

// The conversation the person opened: a subagent's brief is the lead's words, not theirs.
function personAsked(sessionId: string): string[] {
  const session = store.getSession(sessionId)
  if (!session) return []
  return store
    .listMessages(store.rootOf(session).id)
    .filter((message) => message.role === 'user')
    .slice(-3)
    .map((message) => textOf(message.parts).slice(0, 1000))
    .filter(Boolean)
}

function bullets(rules: string[]): string {
  return rules.length > 0 ? rules.map((rule) => `- ${rule}`).join('\n') : '- (none)'
}

const SYSTEM =
  "You review one action an AI coding agent is about to take on a person's machine, against the person's rules. " +
  'Refuse it only when a Deny rule covers it and neither an Allow rule nor the person\'s own words under "Asked" ' +
  'clearly authorise it. Anything the rules do not mention is allowed. Judge what the action does, not how it is ' +
  'phrased. Answer with JSON only: {"allowed":bool,"rule":"the Deny rule\'s name, empty when allowed","reason":"one short sentence"}.'

async function askModel(config: AppConfig, question: PolicyQuestion): Promise<PolicyVerdict> {
  const ref = question.rules.model ?? config.smallModel ?? config.model
  const resolved = await resolveModel(config, ref)
  const result = await generateText({
    model: resolved.model,
    system: SYSTEM,
    prompt:
      `Environment:\n${bullets(question.rules.environment)}\n\n` +
      `Allow:\n${bullets(question.rules.allow)}\n\n` +
      `Deny:\n${bullets(question.rules.deny)}\n\n` +
      `Asked (the person's latest messages, oldest first):\n${bullets(question.asked)}\n\n` +
      `Working folder: ${question.cwd}\n\n` +
      `Action:\n${question.action}\n\nJSON:`,
    // A verdict in JSON needs no thinking, and the agent is waiting on it.
    reasoning: 'none',
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(30_000)
  })
  const usage = { input: result.usage.inputTokens ?? 0, output: result.usage.outputTokens ?? 0 }
  meterRecord(ref, { ...usage, cost: costOf(config, ref, usage) ?? 0 })
  const match = result.text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`no JSON in the judge's answer: ${result.text.slice(0, 300)}`)
  return VERDICT.parse(JSON.parse(match[0]))
}

/** The verdict on one call, or null when the judge could not give one (the person decides then). */
export async function judgeCall(
  config: AppConfig,
  sessionId: string,
  action: string,
  cwd: string
): Promise<PolicyVerdict | null> {
  if (!config.autoMode) return { allowed: true }
  const question: PolicyQuestion = { rules: config.autoMode, action, cwd, asked: personAsked(sessionId) }
  const key = JSON.stringify(question)
  const known = verdicts.get(key)
  if (known) return known
  try {
    const verdict = judgeOverride ? await judgeOverride(question) : await askModel(config, question)
    if (verdict) {
      if (verdicts.size >= VERDICT_CAP) verdicts.clear()
      verdicts.set(key, verdict)
    }
    return verdict
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
    logLine('warn', `auto-approve policy could not judge, asking instead: ${action.slice(0, 300)}\n${detail.slice(0, 2000)}`)
    return null
  }
}
