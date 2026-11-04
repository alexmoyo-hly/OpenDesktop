import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { runTurn } from '../src/main/agent/runner'
import { DATA_DIR, loadConfig, normalizeConfig, saveConfig } from '../src/main/config'
import { boot, newSession, scriptedModel, useModel, type Captured } from './helpers'

beforeAll(boot)

const lastMessage = (step: Captured): string => JSON.stringify(step.prompt.at(-1))

describe('pinned instructions', () => {
  // Goose re-injects these each turn; DeepSeek forgot rules that only lived in the system prompt.
  test('ride at the end of every step, and are not written into the conversation', async () => {
    const original = loadConfig()
    saveConfig({ ...original, pinned: 'Answer in Spanish. Never retry a refused call another way.' })
    try {
      const session = newSession()
      const seen: Captured[] = []
      useModel(
        scriptedModel(
          [{ calls: [{ tool: 'bash', input: { command: 'echo hi', description: 'x' } }] }, { text: 'hecho' }],
          seen
        )
      )
      await runTurn({ sessionId: session.id, userText: 'say hi' })
      expect(seen.length).toBeGreaterThanOrEqual(2)
      for (const step of seen) expect(lastMessage(step)).toContain('Answer in Spanish')
      const history = readFileSync(join(DATA_DIR, 'history', `${session.id}.json`), 'utf8')
      expect(history).not.toContain('Answer in Spanish')
    } finally {
      saveConfig(original)
    }
  })

  test('are absent when there are none', async () => {
    const session = newSession()
    const seen: Captured[] = []
    useModel(scriptedModel([{ text: 'ok' }], seen))
    await runTurn({ sessionId: session.id, userText: 'hello' })
    expect(JSON.stringify(seen[0].prompt)).not.toContain('<pinned>')
  })

  test('are kept as text, trimmed, and dropped when blank', () => {
    expect(normalizeConfig({ pinned: '  Be brief.  ' }).pinned).toBe('Be brief.')
    expect(normalizeConfig({ pinned: '   ' }).pinned).toBeUndefined()
    expect(normalizeConfig({ pinned: 42 }).pinned).toBeUndefined()
  })
})
