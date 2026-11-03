import { beforeAll, expect, test } from 'vitest'
import { runTurn } from '../src/main/agent/runner'
import { approxTokens, boot, newSession, scriptedModel, useModel, type Captured } from './helpers'

beforeAll(boot)

async function firstRequest(agentId: string): Promise<{ system: string; tools: Captured['tools'] }> {
  const seen: Captured[] = []
  useModel(scriptedModel([{ text: 'hi' }], seen))
  await runTurn({ sessionId: newSession({ agentId }).id, userText: 'hello' })
  const system = seen[0].prompt
    .filter((message) => message.role === 'system')
    .map((message) => String(message.content))
    .join('\n')
  return { system, tools: seen[0].tools }
}

test('outside a sandbox, the pentesting agents are not offered: they would be refused if picked', async () => {
  const { system, tools } = await firstRequest('manager')
  const offered = JSON.stringify(tools) + system
  for (const id of ['recon', 'exploit', 'exploit-review', 'pentest-report', 'forensic']) {
    expect(offered).not.toContain(`\`${id}\``)
    expect(offered).not.toContain(`- ${id}:`)
  }
})

test("the manager's prompt does not repeat the agent descriptions the task tool already carries", async () => {
  const { system, tools } = await firstRequest('manager')
  const task = tools.find((tool) => tool.name === 'task')
  const description = 'Finds things across many files, fast and read-only'
  expect(task?.description).toContain(description)
  expect(system).not.toContain(description)
})

// ponytail: a coarse ceiling (chars/4) that fails when someone grows the prefix by a few hundred tokens.
test('a one-word turn costs less than this many prefix tokens', async () => {
  const { system, tools } = await firstRequest('manager')
  const total = approxTokens(system) + approxTokens(tools)
  console.log(`manager prefix ≈ ${total} tokens (system ${approxTokens(system)}, tools ${approxTokens(tools)})`)
  expect(total).toBeLessThan(4_000)
})
