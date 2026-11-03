import { beforeAll, describe, expect, test } from 'vitest'
import { compactNow, isRunning, runTurn, stop } from '../src/main/agent/runner'
import * as history from '../src/main/history'
import * as store from '../src/main/store'
import { rawConfig, saveConfig } from '../src/main/config'
import { boot, hangingModel, newSession, scriptedModel, useModel, type Captured } from './helpers'

beforeAll(boot)

const systemOf = (call: Captured): string =>
  call.prompt
    .filter((message) => message.role === 'system')
    .map((message) => String(message.content))
    .join('\n')

const reasoningParts = (call: Captured): unknown[] =>
  call.prompt
    .filter((message) => message.role === 'assistant' && Array.isArray(message.content))
    .flatMap((message) => message.content as { type: string }[])
    .filter((part) => part.type === 'reasoning')

describe('prompt caching', () => {
  test('an Anthropic turn asks for the prefix to be cached', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel([{ text: 'hi' }], seen), 'anthropic/claude-sonnet-5')
    const session = newSession({ model: 'anthropic/claude-sonnet-5' })
    await runTurn({ sessionId: session.id, userText: 'hello' })
    expect(seen[0].providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' })
  })

  test('a non-Anthropic turn carries no Anthropic options', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel([{ text: 'hi' }], seen), 'helmcode/deepseek-v4-flash')
    const session = newSession({ model: 'helmcode/deepseek-v4-flash' })
    await runTurn({ sessionId: session.id, userText: 'hello' })
    expect(seen[0].providerOptions?.anthropic).toBeUndefined()
  })
})

describe('reasoning effort', () => {
  test('a Claude model gets the SDK reasoning level, never a thinking budget', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel([{ text: 'hi' }], seen), 'anthropic/claude-sonnet-5')
    const session = newSession({ model: 'anthropic/claude-sonnet-5' })
    await runTurn({ sessionId: session.id, userText: 'hello' })
    expect(seen[0].reasoning).toBe('medium')
    expect(JSON.stringify(seen[0].providerOptions ?? {})).not.toContain('budgetTokens')
  })

  test('minimal effort on Claude never sends thinking disabled', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel([{ text: 'hi' }], seen), 'anthropic/claude-sonnet-5')
    const session = newSession({ model: 'anthropic/claude-sonnet-5', effort: 1 })
    await runTurn({ sessionId: session.id, userText: 'hello' })
    expect(seen[0].reasoning).toBe('minimal')
  })

  test('minimal effort on an OpenAI-compatible model turns reasoning off', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel([{ text: 'hi' }], seen), 'helmcode/deepseek-v4-flash')
    const session = newSession({ model: 'helmcode/deepseek-v4-flash', effort: 1 })
    await runTurn({ sessionId: session.id, userText: 'hello' })
    expect(seen[0].reasoning).toBe('none')
  })

  test('a model that declares no reasoning is sent no reasoning level', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel([{ text: 'hi' }], seen), 'p/strong')
    const session = newSession()
    await runTurn({ sessionId: session.id, userText: 'hello' })
    expect(seen[0].reasoning ?? 'provider-default').toBe('provider-default')
  })
})

describe('reasoning is not resent', () => {
  const thinking = 'long private chain of thought '.repeat(50)

  test('within a turn, the next step does not carry the previous reasoning', async () => {
    const seen: Captured[] = []
    useModel(
      scriptedModel([{ reasoning: thinking, calls: [{ tool: 'list', input: { path: '.' } }] }, { text: 'done' }], seen),
      'helmcode/deepseek-v4-flash'
    )
    const session = newSession({ model: 'helmcode/deepseek-v4-flash' })
    await runTurn({ sessionId: session.id, userText: 'list it' })
    expect(seen.length).toBe(2)
    expect(reasoningParts(seen[1])).toEqual([])
  })

  test('across turns, the history does not carry old reasoning', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel([{ reasoning: thinking, text: 'first' }, { text: 'second' }], seen), 'helmcode/deepseek-v4-flash')
    const session = newSession({ model: 'helmcode/deepseek-v4-flash' })
    await runTurn({ sessionId: session.id, userText: 'one' })
    await runTurn({ sessionId: session.id, userText: 'two' })
    expect(reasoningParts(seen[1])).toEqual([])
  })

  test('the transcript still shows the reasoning to the user', async () => {
    useModel(scriptedModel([{ reasoning: thinking, text: 'answer' }]), 'helmcode/deepseek-v4-flash')
    const session = newSession({ model: 'helmcode/deepseek-v4-flash' })
    await runTurn({ sessionId: session.id, userText: 'why' })
    const parts = store.listMessages(session.id).flatMap((message) => message.parts)
    expect(parts.some((part) => part.type === 'reasoning')).toBe(true)
  })
})

describe('loops', () => {
  test('the same tool call over and over ends the turn long before the step ceiling', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel(() => ({ calls: [{ tool: 'list', input: { path: '.' } }] }), seen))
    const session = newSession()
    await runTurn({ sessionId: session.id, userText: 'look' })
    expect(seen.length).toBeLessThanOrEqual(6)
    const said = store
      .listMessages(session.id)
      .flatMap((message) => message.parts)
      .map((part) => part.text ?? '')
      .join('\n')
    expect(said).toMatch(/same call/i)
  })

  test('the model is warned before it is stopped', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel(() => ({ calls: [{ tool: 'list', input: { path: '.' } }] }), seen))
    const session = newSession()
    await runTurn({ sessionId: session.id, userText: 'look' })
    const last = JSON.stringify(seen[seen.length - 1].prompt.slice(-1))
    expect(last).toMatch(/same call/i)
  })

  test('different calls in a row are not a loop', async () => {
    const seen: Captured[] = []
    useModel(
      scriptedModel((index) => (index < 8 ? { calls: [{ tool: 'list', input: { path: `dir-${index}` } }] } : { text: 'ok' }), seen)
    )
    const session = newSession()
    await runTurn({ sessionId: session.id, userText: 'look' })
    expect(seen.length).toBe(9)
  })
})

describe('compaction', () => {
  test('a manual compaction is refused while the turn is still writing to the history', async () => {
    useModel(hangingModel())
    const session = newSession()
    for (let i = 0; i < 20; i++) {
      history.appendHistory(session.id, [
        { role: 'user', content: `question ${i} ${'x'.repeat(500)}` },
        { role: 'assistant', content: `answer ${i} ${'y'.repeat(500)}` }
      ])
    }
    const turn = runTurn({ sessionId: session.id, userText: 'go' })
    while (!isRunning(session.id)) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(await compactNow(session.id)).toBe(false)
    stop(session.id)
    await turn
  })
})

describe('system prompt', () => {
  test('asks for a short line of reasoning before tool calls instead of forbidding it', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel([{ text: 'hi' }], seen))
    const session = newSession()
    await runTurn({ sessionId: session.id, userText: 'hello' })
    const system = systemOf(seen[0])
    expect(system).not.toMatch(/do not narrate/i)
    expect(system).toMatch(/one\s+short\s+line/i)
  })
})

describe('the language the agent writes in', () => {
  test('a language named in the config is named to the model, not left to "the language they wrote in"', async () => {
    const before = rawConfig()
    saveConfig({ ...before, language: 'Spanish' })
    try {
      const seen: Captured[] = []
      useModel(scriptedModel([{ text: 'hola' }], seen))
      const session = newSession()
      await runTurn({ sessionId: session.id, userText: 'hello' })
      expect(systemOf(seen[0])).toContain('Write every message to the user in Spanish')
    } finally {
      saveConfig(before)
    }
  })
})
