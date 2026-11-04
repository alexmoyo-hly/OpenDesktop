import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { runTurn } from '../src/main/agent/runner'
import * as store from '../src/main/store'
import { boot, newSession, scriptedModel, useModel, type Captured } from './helpers'

beforeAll(boot)

describe('plan mode', () => {
  // Claude Code, Codex, Cursor, OpenCode, Cline: explore read-only, then a plan the person approves.
  test('reads and looks freely, changes nothing, and is told so', async () => {
    const session = newSession({ autoApprove: true, planMode: true })
    writeFileSync(join(session.cwd, 'a.txt'), 'hello')
    const seen: Captured[] = []
    useModel(
      scriptedModel(
        [
          { calls: [{ tool: 'read', input: { path: 'a.txt' } }] },
          { calls: [{ tool: 'bash', input: { command: 'ls -la', description: 'look' } }] },
          { calls: [{ tool: 'write', input: { path: 'b.txt', content: 'b' } }] },
          { calls: [{ tool: 'bash', input: { command: 'touch c.txt', description: 'make' } }] },
          { text: '1. Change a.txt. 2. Add b.txt.' }
        ],
        seen
      )
    )
    await runTurn({ sessionId: session.id, userText: 'plan the change' })
    expect(existsSync(join(session.cwd, 'b.txt'))).toBe(false)
    expect(existsSync(join(session.cwd, 'c.txt'))).toBe(false)
    const status = Object.fromEntries(store.listBlocks(session.id).map((b) => [b.title, b.status]))
    expect(Object.values(status).filter((s) => s === 'success').length).toBe(2)
    expect(JSON.stringify(seen[3].prompt)).toMatch(/nothing is changed until the person approves the plan/)
    expect(JSON.stringify(seen[0].prompt)).toMatch(/# Plan mode/)
  })

  test('off, nothing about it reaches the model', async () => {
    const session = newSession({ autoApprove: true })
    const seen: Captured[] = []
    useModel(scriptedModel([{ text: 'ok' }], seen))
    await runTurn({ sessionId: session.id, userText: 'hi' })
    expect(JSON.stringify(seen[0].prompt)).not.toMatch(/# Plan mode/)
  })
})
