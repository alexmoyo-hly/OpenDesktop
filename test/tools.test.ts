import { beforeAll, describe, expect, test } from 'vitest'
import { NOTHING } from '@shared/savings'
import { createTools, type ToolContext } from '../src/main/agent/tools'
import { loadConfig } from '../src/main/config'
import { getRuntime, type Runtime } from '../src/main/runtime'
import { boot, tempDir } from './helpers'

beforeAll(boot)

function context(runtime: Runtime): ToolContext {
  const config = loadConfig()
  return {
    config,
    agent: { id: 'build', name: 'Build', mode: 'primary' },
    permissions: config.permissions,
    sessionId: 's',
    environmentId: 'e',
    cwd: tempDir(),
    runtime,
    signal: new AbortController().signal,
    savings: NOTHING,
    modelRef: 'p/strong',
    currentMessageId: () => 'm',
    depth: 0,
    spawnSubagent: async () => ({ sessionId: 'c', report: '' })
  } as unknown as ToolContext
}

describe('tool set', () => {
  test('a local session has fetch', () => {
    expect(Object.keys(createTools(context(getRuntime('local'))))).toContain('fetch')
  })

  test('a sandbox session has no fetch: it would run on the host, outside the container firewall', () => {
    const container = { ...getRuntime('local'), kind: 'container' } as Runtime
    expect(Object.keys(createTools(context(container)))).not.toContain('fetch')
  })
})
