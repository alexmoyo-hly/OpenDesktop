import { beforeAll, describe, expect, test } from 'vitest'
import { runTurn } from '../src/main/agent/runner'
import { listPending, resolveApproval } from '../src/main/approvals'
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
