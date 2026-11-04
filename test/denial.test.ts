import { beforeAll, describe, expect, test } from 'vitest'
import { runTurn, stop } from '../src/main/agent/runner'
import { listPending, releasePending, requestApproval, resolveApproval } from '../src/main/approvals'
import { rawConfig, saveConfig } from '../src/main/config'
import * as store from '../src/main/store'
import { boot, newSession, scriptedModel, useModel, type Captured } from './helpers'

beforeAll(boot)

async function answerWhenAsked(sessionId: string, note?: string): Promise<void> {
  for (let tries = 0; tries < 300; tries++) {
    const asked = listPending().find((request) => request.sessionId === sessionId)
    if (asked) return resolveApproval(asked.id, 'reject', note)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('the agent never asked')
}

const twoAttempts = [
  { calls: [{ tool: 'bash', input: { command: 'mv notes.md /tmp/notes.md', description: 'Move notes out' } }] },
  { calls: [{ tool: 'bash', input: { command: 'cp notes.md /tmp/notes.md', description: 'Copy notes out' } }] }
]

describe('a person saying no', () => {
  test('a bare denial ends the turn, so the next move is theirs and not another route to the same thing', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel(twoAttempts, seen))
    const session = newSession({ autoApprove: false })
    await Promise.all([runTurn({ sessionId: session.id, userText: 'tidy up' }), answerWhenAsked(session.id)])
    expect(seen).toHaveLength(1)
  })

  test('a denial with a reason reaches the model and the turn carries on', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel([twoAttempts[0], { text: 'ok, keeping it inside' }], seen))
    const session = newSession({ autoApprove: false })
    await Promise.all([
      runTurn({ sessionId: session.id, userText: 'tidy up' }),
      answerWhenAsked(session.id, 'stay inside the repo folder')
    ])
    expect(seen).toHaveLength(2)
    expect(JSON.stringify(seen[1].prompt)).toContain('stay inside the repo folder')
  })
})

/*
 * The shape of a real complaint: a turn started while the session was still
 * asking, and auto-approve was turned on after the card was already up. The
 * decision used to be taken once, at the top of the turn, so the click that was
 * meant to stop the asking changed nothing and the card sat there.
 */
describe('a session that starts restricted and is switched to auto-approve mid-turn', () => {
  test('the card on screen is answered, and the turn carries on', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel(
      [
        { calls: [{ tool: 'bash', input: { command: 'printf switched', description: 'Run it' } }] },
        { text: 'done' }
      ],
      seen
    ))
    const session = newSession({ autoApprove: false })

    let switched = false
    const watch = setInterval(() => {
      if (switched) return
      // The person flips the session's own switch while the card is up.
      if (listPending().some((request) => request.sessionId === session.id)) {
        switched = true
        store.updateSession(session.id, { autoApprove: true })
      }
    }, 5)

    const turn = runTurn({ sessionId: session.id, userText: 'run it' })
    const finished = await Promise.race([
      turn.then(() => 'finished' as const),
      new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 4000))
    ])
    clearInterval(watch)
    if (finished === 'stuck') stop(session.id)
    await turn.catch(() => undefined)

    expect(switched).toBe(true)
    expect(finished).toBe('finished')
    // Nothing is left waiting, and the command really ran instead of being
    // refused or left parked.
    expect(listPending().filter((request) => request.sessionId === session.id)).toHaveLength(0)
    expect(seen).toHaveLength(2)
    const block = store.listBlocks(session.id)[0]
    expect(block?.status).toBe('success')
    expect(block?.output ?? '').toContain('switched')
  })
})

/*
 * The other half of the same complaint: the switch that was turned on is the
 * app-wide one in Settings, and the session never had an opinion of its own.
 */
describe('the app-wide default is switched on while a card is already up', () => {
  test('a session that never chose follows it, and stops asking', async () => {
    const seen: Captured[] = []
    useModel(scriptedModel(
      [
        { calls: [{ tool: 'bash', input: { command: 'printf global', description: 'Run it' } }] },
        { text: 'done' }
      ],
      seen
    ))
    // No opinion of its own, and the app is asking.
    saveConfig({ ...rawConfig(), autoApprove: false })
    const session = newSession({ autoApprove: undefined })

    let switched = false
    const watch = setInterval(() => {
      if (switched) return
      if (listPending().some((request) => request.sessionId === session.id)) {
        switched = true
        saveConfig({ ...rawConfig(), autoApprove: true })
        releasePending()
      }
    }, 5)

    const turn = runTurn({ sessionId: session.id, userText: 'run it' })
    const finished = await Promise.race([
      turn.then(() => 'finished' as const),
      new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 4000))
    ])
    clearInterval(watch)
    if (finished === 'stuck') stop(session.id)
    await turn.catch(() => undefined)
    saveConfig({ ...rawConfig(), autoApprove: false })

    expect(switched).toBe(true)
    expect(finished).toBe('finished')
    expect(store.listBlocks(session.id)[0]?.status).toBe('success')
  })

  test('a session that said no for itself keeps asking whatever the app does', async () => {
    saveConfig({ ...rawConfig(), autoApprove: true })
    const session = newSession({ autoApprove: false })
    const waiting = requestApproval({
      sessionId: session.id,
      blockId: 'b',
      tool: 'bash',
      title: 't',
      detail: 'd',
      environmentId: 'local',
      cwd: '/'
    })
    expect(releasePending()).toBe(0)
    expect(listPending().some((request) => request.sessionId === session.id)).toBe(true)
    resolveApproval(listPending().find((r) => r.sessionId === session.id)!.id, 'once')
    await waiting
    saveConfig({ ...rawConfig(), autoApprove: false })
  })
})
