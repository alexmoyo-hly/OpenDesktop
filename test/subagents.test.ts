import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModel } from 'ai'
import { beforeAll, expect, test } from 'vitest'
import { isRunning, runTurn, stop } from '../src/main/agent/runner'
import * as store from '../src/main/store'
import { boot, finish, newSession, useModel } from './helpers'

beforeAll(boot)

/**
 * First request delegates to `explore`; every later one (the subagent's) streams
 * nothing until aborted.
 *
 * `onLive` fires when the subagent's request is actually in flight. The test has
 * to wait for that rather than for the subagent's session, which exists a few
 * ticks earlier: a stop in between aborts a turn that has not made its call yet,
 * so the mock's stream never opens and there is nothing to observe being
 * aborted. That is the arrangement working, not failing.
 */
function delegatingThenHanging(
  aborted: { count: number },
  onLive: () => void
): LanguageModel {
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
      // Open and holding: this is the request a stop has to reach.
      onLive()
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
  let signalLive = (): void => {}
  const inFlight = new Promise<void>((resolve) => {
    signalLive = resolve
  })
  useModel(delegatingThenHanging(aborted, signalLive))
  const parent = newSession({ agentId: 'manager' })
  const turn = runTurn({ sessionId: parent.id, userText: 'delegate' })

  // The subagent has made its request and is waiting on it.
  await inFlight
  const child = store.listSessions().find((s) => s.parentSessionId === parent.id && isRunning(s.id))
  expect(child).toBeDefined()

  stop(parent.id)
  await turn
  expect(isRunning(child!.id)).toBe(false)
  expect(aborted.count).toBe(1)
})
