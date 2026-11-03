import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModel } from 'ai'
import { listAgents, seedBuiltins } from '../src/main/agents'
import { loadConfig, setAgentLoader } from '../src/main/config'
import * as providers from '../src/main/providers'
import * as store from '../src/main/store'

export type ToolCall = { tool: string; input: Record<string, unknown> }
export type Step = { reasoning?: string; text?: string; calls?: ToolCall[] }

/** What the model was handed on one step: the converted prompt, tools and provider options. */
export interface Captured {
  prompt: { role: string; content: unknown; providerOptions?: Record<string, unknown> }[]
  tools: { name: string; description?: string; inputSchema?: unknown }[]
  providerOptions?: Record<string, Record<string, unknown>>
  reasoning?: string
  temperature?: number
}

export interface Usage {
  input: number
  output: number
  cacheRead?: number
}

export function boot(): void {
  seedBuiltins()
  setAgentLoader(listAgents)
  loadConfig(true)
  store.loadStore()
}

export function finish(reason: 'stop' | 'tool-calls' | 'length', usage: Usage) {
  return {
    type: 'finish' as const,
    finishReason: { unified: reason, raw: reason },
    usage: {
      inputTokens: {
        total: usage.input,
        noCache: usage.input - (usage.cacheRead ?? 0),
        cacheRead: usage.cacheRead ?? 0,
        cacheWrite: 0
      },
      outputTokens: { total: usage.output, text: usage.output, reasoning: 0 }
    }
  }
}

/**
 * A model that plays `steps` in order and then answers "done".
 * Every request it receives is pushed to `seen`.
 */
export function scriptedModel(
  steps: Step[] | ((index: number) => Step),
  seen: Captured[] = [],
  usage: (step: number) => Usage = () => ({ input: 100, output: 10 })
): LanguageModel {
  let index = 0
  return new MockLanguageModelV4({
    doStream: async (params: Record<string, unknown>) => {
      seen.push(params as unknown as Captured)
      const step: Step = (typeof steps === 'function' ? steps(index) : steps[index]) ?? { text: 'done' }
      const used = usage(index)
      index++
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            if (step.reasoning) {
              controller.enqueue({ type: 'reasoning-start', id: `r${index}` })
              controller.enqueue({ type: 'reasoning-delta', id: `r${index}`, delta: step.reasoning })
              controller.enqueue({ type: 'reasoning-end', id: `r${index}` })
            }
            if (step.text) {
              controller.enqueue({ type: 'text-start', id: `t${index}` })
              controller.enqueue({ type: 'text-delta', id: `t${index}`, delta: step.text })
              controller.enqueue({ type: 'text-end', id: `t${index}` })
            }
            const calls = step.calls ?? []
            calls.forEach((call, n) => {
              const id = `call-${index}-${n}`
              const input = JSON.stringify(call.input)
              controller.enqueue({ type: 'tool-input-start', id, toolName: call.tool })
              controller.enqueue({ type: 'tool-input-delta', id, delta: input })
              controller.enqueue({ type: 'tool-input-end', id })
              controller.enqueue({ type: 'tool-call', toolCallId: id, toolName: call.tool, input })
            })
            controller.enqueue(finish(calls.length > 0 ? 'tool-calls' : 'stop', used))
            controller.close()
          }
        })
      }
    }
  }) as unknown as LanguageModel
}

/** A model whose stream never ends until the request is aborted. */
export function hangingModel(): LanguageModel {
  return new MockLanguageModelV4({
    // Like fetch: a signal that is already aborted rejects at once.
    doGenerate: ({ abortSignal }: { abortSignal?: AbortSignal }) =>
      new Promise((_, reject) => {
        const fail = () => reject(new DOMException('aborted', 'AbortError'))
        if (abortSignal?.aborted) fail()
        abortSignal?.addEventListener('abort', fail)
      }),
    doStream: async ({ abortSignal }: { abortSignal?: AbortSignal }) => {
      if (abortSignal?.aborted) throw new DOMException('aborted', 'AbortError')
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            abortSignal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
          }
        })
      }
    }
  }) as unknown as LanguageModel
}

/** Routes every model ref to `model`, as the provider `providerId` would. */
export function useModel(model: LanguageModel, ref = 'p/strong'): void {
  const [providerId, modelId] = ref.split('/')
  providers.setModelResolverOverride(() => ({ providerId, modelId, label: ref, model }))
}

export function tempDir(prefix = 'od-cwd-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function newSession(over: Partial<Parameters<typeof store.createSession>[0]> = {}) {
  return store.createSession({
    title: 'test',
    cwd: tempDir(),
    environmentId: 'local',
    agentId: 'build',
    model: 'p/strong',
    autoApprove: true,
    ...over
  })
}

export const approxTokens = (value: unknown): number =>
  Math.round((typeof value === 'string' ? value : JSON.stringify(value)).length / 4)
