import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModel } from 'ai'
import { beforeAll, expect, test } from 'vitest'
import { isRunning, runTurn, stop } from '../src/main/agent/runner'
import * as store from '../src/main/store'
import { boot, finish, newSession, useModel } from './helpers'

beforeAll(boot)

/** First request delegates to `explore`; every later one (the subagent's) streams nothing until aborted. */
function delegatingThenHanging(aborted: { count: number }): LanguageModel {
  let calls = 0
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }: { abortSignal?: AbortSignal }) => {
      calls++
      if (calls === 1) {
        const input = JSON.stringify({ agent: 'explore', description: 'look around', prompt: 'look' })
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] })
              controller.enqueue({ type: 'tool-call', toolCallId: 't1', toolName: 'task', input })
              controller.enqueue(finish('tool-calls', { input: 10, output: 5 }))
              controller.close()
            }
          })
        }
      }
      // Like fetch: a request made with a signal that is already aborted fails at once.
      if (abortSignal?.aborted) throw new DOMException('aborted', 'AbortError')
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            abortSignal?.addEventListener('abort', () => {
              aborted.count++
              controller.error(new DOMException('aborted', 'AbortError'))
            })
          }
        })
      }
    }
  }) as unknown as LanguageModel
}

test('stopping a turn stops the subagents it started', async () => {
  const aborted = { count: 0 }
  useModel(delegatingThenHanging(aborted))
  const parent = newSession({ agentId: 'manager' })
  const turn = runTurn({ sessionId: parent.id, userText: 'delegate' })

  let child = undefined as ReturnType<typeof store.listSessions>[number] | undefined
  for (let i = 0; i < 50 && !child; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    child = store.listSessions().find((s) => s.parentSessionId === parent.id && isRunning(s.id))
  }
  expect(child).toBeDefined()

  stop(parent.id)
  await turn
  expect(isRunning(child!.id)).toBe(false)
  expect(aborted.count).toBe(1)
})
