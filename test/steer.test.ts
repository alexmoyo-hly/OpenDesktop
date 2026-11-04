import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { isRunning, queueFollowUp, runTurn } from '../src/main/agent/runner'
import { DATA_DIR } from '../src/main/config'
import * as store from '../src/main/store'
import { boot, newSession, scriptedModel, useModel, type Captured } from './helpers'

beforeAll(boot)

const text = (step: Captured): string => JSON.stringify(step.prompt)

describe('a message sent while a turn works', () => {
  // As in Claude Code, Codex, Cursor: it reaches the next step instead of waiting for the turn to end.
  test('reaches the next step of the running turn, where it was said, and nowhere else', async () => {
    const session = newSession({ autoApprove: true })
    const seen: Captured[] = []
    useModel(
      scriptedModel(
        [
          { text: 'Looking.', calls: [{ tool: 'bash', input: { command: 'sleep 0.6', description: 'wait' } }] },
          { text: 'Switching to bar as you said.' }
        ],
        seen
      )
    )
    const turn = runTurn({ sessionId: session.id, userText: 'use foo' })
    await new Promise((resolve) => setTimeout(resolve, 250))
    queueFollowUp(session.id, 'actually use bar')
    await turn

    expect(text(seen[0])).not.toContain('actually use bar')
    expect(text(seen[1])).toContain('actually use bar')
    // After the tool's result, where it was typed: not at the end of a later step.
    const last = seen[1].prompt.at(-1)
    expect(last?.role).toBe('user')
    expect(JSON.stringify(last)).toContain('actually use bar')

    const roles = store.listMessages(session.id).map((m) => `${m.role}:${JSON.stringify(m.parts)}`)
    expect(roles).toHaveLength(4)
    expect(roles[2]).toMatch(/^user:.*actually use bar/)
    expect(roles[3]).toMatch(/^assistant:.*Switching to bar/)
    expect(roles[1]).not.toMatch(/Switching to bar/)

    const history = JSON.parse(readFileSync(join(DATA_DIR, 'history', `${session.id}.json`), 'utf8'))
    const said = JSON.stringify(history)
    expect(said.indexOf('actually use bar')).toBeGreaterThan(said.indexOf('sleep 0.6'))
    expect(said.indexOf('actually use bar')).toBeLessThan(said.indexOf('Switching to bar'))

    expect(store.getSession(session.id)?.queuedFollowUps ?? []).toEqual([])
    expect(isRunning(session.id)).toBe(false)
  })

  test('sent during the last step, it still goes as a turn of its own once this one ends', async () => {
    const session = newSession({ autoApprove: true })
    const seen: Captured[] = []
    useModel(scriptedModel([{ text: 'Done already.' }, { text: 'Answering the late message.' }], seen))
    const turn = runTurn({ sessionId: session.id, userText: 'quick one' })
    queueFollowUp(session.id, 'and one more thing')
    await turn
    for (let i = 0; i < 50 && (isRunning(session.id) || seen.length < 2); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(seen.some((step) => text(step).includes('and one more thing'))).toBe(true)
  })
})
