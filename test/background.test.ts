import { beforeAll, expect, test } from 'vitest'
import { killBackgroundTask, readBackgroundOutput, startBackgroundTask, waitForNews } from '../src/main/background'
import { boot, tempDir } from './helpers'

beforeAll(boot)

const start = (command: string) =>
  startBackgroundTask({
    sessionId: 'bg',
    command,
    description: 'test',
    cwd: tempDir(),
    environmentId: 'local',
    agentId: 'build'
  })

test('waiting for a background task returns as soon as it prints, not before', async () => {
  const task = start('sleep 0.6; echo ready; sleep 5')
  const began = Date.now()
  await waitForNews(task.id, 5_000)
  const waited = Date.now() - began
  expect(waited).toBeGreaterThanOrEqual(400)
  expect(waited).toBeLessThan(3_000)
  expect(readBackgroundOutput(task.id)?.chunk).toContain('ready')
  killBackgroundTask(task.id)
})

test('a silent task is waited on for the whole window, then handed back', async () => {
  const task = start('sleep 5')
  const began = Date.now()
  await waitForNews(task.id, 600)
  expect(Date.now() - began).toBeGreaterThanOrEqual(550)
  killBackgroundTask(task.id)
})

test('an aborted turn stops waiting at once', async () => {
  const task = start('sleep 5')
  const stop = new AbortController()
  setTimeout(() => stop.abort(), 100)
  const began = Date.now()
  await waitForNews(task.id, 5_000, stop.signal)
  expect(Date.now() - began).toBeLessThan(1_000)
  killBackgroundTask(task.id)
})
