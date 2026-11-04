import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { NOTHING } from '@shared/savings'
import type { AppConfig } from '@shared/types'
import { createTools, type ToolContext } from '../src/main/agent/tools'
import { listPending, resolveApproval, PermissionDenied } from '../src/main/approvals'
import { setPolicyJudge, type PolicyQuestion } from '../src/main/auto-policy'
import { loadConfig, normalizeConfig } from '../src/main/config'
import { getRuntime } from '../src/main/runtime'
import * as store from '../src/main/store'
import { boot, newSession } from './helpers'

beforeAll(boot)
afterEach(() => setPolicyJudge(null))

const RULES = {
  environment: ['A developer laptop; the working folder is a scratch checkout.'],
  allow: ['Creating or editing files inside the working folder.'],
  deny: ['Git Push: pushing to any remote unless the user asked for it in this conversation.']
}

function context(auto: boolean, autoMode: AppConfig['autoMode'] = RULES): ToolContext {
  const config = { ...loadConfig(), autoMode }
  const session = newSession({ autoApprove: auto })
  return {
    config,
    agent: { id: 'build', name: 'Build', mode: 'primary' },
    permissions: config.permissions,
    autoApprove: auto,
    sessionId: session.id,
    environmentId: 'local',
    cwd: session.cwd,
    runtime: getRuntime('local'),
    signal: new AbortController().signal,
    savings: NOTHING,
    modelRef: 'p/strong',
    currentMessageId: () => 'm',
    depth: 0,
    spawnSubagent: async () => ({ sessionId: 'c', report: '' })
  } as unknown as ToolContext
}

type Outcome = { asked: boolean; error?: unknown }

async function run(ctx: ToolContext, command: string): Promise<Outcome> {
  const tools = createTools(ctx)
  let error: unknown
  const running = (tools.bash.execute as (input: unknown, options: unknown) => Promise<unknown>)(
    { command, description: 'test' },
    { toolCallId: 'b', messages: [] }
  ).catch((caught: unknown) => {
    error = caught
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  const asked = listPending().filter((request) => request.sessionId === ctx.sessionId)
  for (const request of asked) resolveApproval(request.id, 'once')
  await running
  return { asked: asked.length > 0, error }
}

function judging(verdict: (question: PolicyQuestion) => { allowed: boolean; rule?: string; reason?: string } | null) {
  const asked: PolicyQuestion[] = []
  setPolicyJudge(async (question) => {
    asked.push(question)
    return verdict(question)
  })
  return asked
}

describe('the auto-approve policy', () => {
  test('a call it allows runs without asking', async () => {
    const asked = judging(() => ({ allowed: true }))
    const ctx = context(true)
    const outcome = await run(ctx, 'touch made.txt')
    expect(asked).toHaveLength(1)
    expect(outcome.asked).toBe(false)
    expect(existsSync(join(ctx.cwd, 'made.txt'))).toBe(true)
  })

  test('a call it blocks is refused with the rule, and the turn may carry on', async () => {
    judging(() => ({ allowed: false, rule: 'Git Push', reason: 'nobody asked for a push' }))
    const ctx = context(true)
    const outcome = await run(ctx, 'touch pushed.txt')
    expect(outcome.asked).toBe(false)
    expect(existsSync(join(ctx.cwd, 'pushed.txt'))).toBe(false)
    expect(outcome.error).toBeInstanceOf(PermissionDenied)
    expect(String((outcome.error as Error).message)).toMatch(/Git Push.*nobody asked for a push/)
    expect((outcome.error as PermissionDenied).endsTurn).toBe(false)
    const [block] = store.listBlocks(ctx.sessionId)
    expect(block?.error).toMatch(/auto-approve policy/i)
  })

  test('when the judge cannot answer, a person is asked', async () => {
    judging(() => null)
    const outcome = await run(context(true), 'touch unsure.txt')
    expect(outcome.asked).toBe(true)
  })

  test('the judge sees the action, the folder and what the person asked for', async () => {
    const asked = judging(() => ({ allowed: true }))
    const ctx = context(true)
    store.addMessage({ sessionId: ctx.sessionId, role: 'user', parts: [{ type: 'text', text: 'push it to origin please' }] })
    await run(ctx, 'touch seen.txt')
    expect(asked[0]?.action).toContain('touch seen.txt')
    expect(asked[0]?.cwd).toBe(ctx.cwd)
    expect(asked[0]?.asked).toEqual(['push it to origin please'])
    expect(asked[0]?.rules).toEqual(RULES)
  })

  test('a subagent is judged against what the person asked the conversation, not its brief', async () => {
    const asked = judging(() => ({ allowed: true }))
    const lead = newSession({ autoApprove: true })
    store.addMessage({ sessionId: lead.id, role: 'user', parts: [{ type: 'text', text: 'the real ask' }] })
    const helper = newSession({ autoApprove: true, parentSessionId: lead.id })
    store.addMessage({ sessionId: helper.id, role: 'user', parts: [{ type: 'text', text: 'push everything' }] })
    const ctx = { ...context(true), sessionId: helper.id, cwd: helper.cwd }
    await run(ctx, 'touch sub.txt')
    expect(asked[0]?.asked).toEqual(['the real ask'])
  })

  test('the same call is judged once', async () => {
    const asked = judging(() => ({ allowed: true }))
    const ctx = context(true)
    await run(ctx, 'touch twice.txt')
    await run(ctx, 'touch twice.txt')
    expect(asked).toHaveLength(1)
  })

  test('what the allowlist covers is not judged', async () => {
    const asked = judging(() => ({ allowed: false, rule: 'x', reason: 'x' }))
    const outcome = await run(context(true), 'ls -la')
    expect(asked).toHaveLength(0)
    expect(outcome.error).toBeUndefined()
  })

  test('the denylist refuses before the judge is consulted', async () => {
    const asked = judging(() => ({ allowed: true }))
    const outcome = await run(context(true), 'shutdown -h now')
    expect(asked).toHaveLength(0)
    expect(String((outcome.error as Error).message)).toMatch(/denylist/)
  })

  test('without rules nothing is judged and auto-approve runs as before', async () => {
    const asked = judging(() => ({ allowed: false, rule: 'x', reason: 'x' }))
    const outcome = await run(context(true, { environment: ['laptop'], allow: [], deny: [] }), 'touch free.txt')
    expect(asked).toHaveLength(0)
    expect(outcome.asked).toBe(false)
  })

  test('a session that asks is asked, not judged', async () => {
    const asked = judging(() => ({ allowed: true }))
    const outcome = await run(context(false), 'touch manual.txt')
    expect(asked).toHaveLength(0)
    expect(outcome.asked).toBe(true)
  })
})

describe('the policy in the config', () => {
  test('keeps lines of text and drops anything else', () => {
    const config = normalizeConfig({
      autoMode: { environment: ['laptop', 3, ''], allow: 'nope', deny: ['  Git Push: no  '], model: 'p/small' }
    })
    expect(config.autoMode).toEqual({ environment: ['laptop'], allow: [], deny: ['Git Push: no'], model: 'p/small' })
  })

  test('is absent unless written', () => {
    expect(normalizeConfig({}).autoMode).toBeUndefined()
  })
})
