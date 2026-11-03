import { afterEach, beforeAll, expect, test } from 'vitest'
import {
  assessRelated,
  judgementCount,
  resetJudgementCount,
  setRelatednessJudge
} from '../src/main/coordination'
import { loadConfig } from '../src/main/config'
import * as store from '../src/main/store'
import { boot, newSession, tempDir } from './helpers'

beforeAll(boot)
afterEach(() => setRelatednessJudge(null))

function pair() {
  const cwd = tempDir()
  const a = newSession({ cwd, title: 'rewrite the README install section' })
  const b = newSession({ cwd, title: 'update README install instructions' })
  store.updateSession(a.id, { queuedPrompt: 'rewrite the README install section' })
  store.updateSession(b.id, { queuedPrompt: 'update README install instructions' })
  return [store.getSession(a.id)!, store.getSession(b.id)!] as const
}

test('a judge that fails is not asked the same question again on every scheduler tick', async () => {
  resetJudgementCount()
  setRelatednessJudge(async () => {
    throw new Error('provider down')
  })
  const [a, b] = pair()
  await assessRelated(loadConfig(), a, [b])
  await assessRelated(loadConfig(), a, [b])
  await assessRelated(loadConfig(), a, [b])
  expect(judgementCount()).toBe(1)
})

test('a failed judgement still lets both run, flagged as related', async () => {
  setRelatednessJudge(async () => {
    throw new Error('provider down')
  })
  const [a, b] = pair()
  const related = await assessRelated(loadConfig(), a, [b])
  expect(related).toHaveLength(1)
  expect(related[0].sameFiles).toBe(false)
})

test('a successful judgement is cached too', async () => {
  resetJudgementCount()
  setRelatednessJudge(async () => ({ related: true, same_files: true, reason: 'same file' }))
  const [a, b] = pair()
  await assessRelated(loadConfig(), a, [b])
  const again = await assessRelated(loadConfig(), a, [b])
  expect(judgementCount()).toBe(1)
  expect(again[0].sameFiles).toBe(true)
})
