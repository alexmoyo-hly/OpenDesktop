/**
 * Real turns against a real model: the small tasks people actually ask for,
 * measured with the app's own turn log and checked against the files.
 *
 * Run with: OD_LIVE_KEY_FILE=~/key OD_LIVE_BASE_URL=https://… pnpm live:check <model> [<model>…]
 * Writes a JSON summary to OD_LIVE_OUT when set.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig, loadConfig, saveConfig, setAgentLoader } from './config'
import { listAgents, seedBuiltins } from './agents'
import { runTurn } from './agent/runner'
import { logPath } from './log'
import * as store from './store'

interface TurnReport {
  scenario: string
  model: string
  ok: boolean
  status: string
  steps: number
  tokensIn: number
  tokensOut: number
  prefixFirstK: number
  prefixLastK: number
  cacheRead: number
  calls: number
  textParts: number
  longestSilentRun: number
  ms: number
  errors: string[]
  answer: string
}

const FIXTURE: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node test.js' } }, null, 2),
  'util.js': 'function calcTotal(items) {\n  return items.reduce((sum, n) => sum + n, 0)\n}\n\nmodule.exports = { calcTotal }\n',
  'server.js':
    "const http = require('http')\nconst { calcTotal } = require('./util')\n\nconst PORT = 4317\n\n" +
    'http.createServer((req, res) => res.end(String(calcTotal([1, 2, 3])))).listen(PORT)\n',
  'test.js':
    "const assert = require('assert')\nconst { calcTotal } = require('./util')\n\n" +
    "assert.strictEqual(calcTotal([1, 2, 3]), 6)\nassert.strictEqual(calcTotal([]), 0)\nconsole.log('all tests passed')\n"
}

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'od-live-'))
  for (const [name, body] of Object.entries(FIXTURE)) writeFileSync(join(dir, name), body)
  return dir
}

const read = (dir: string, name: string): string => readFileSync(join(dir, name), 'utf8')

type TurnLog = Pick<
  TurnReport,
  'steps' | 'tokensIn' | 'tokensOut' | 'prefixFirstK' | 'prefixLastK' | 'cacheRead' | 'calls' | 'ms'
>

/** The app's own end-of-turn log line for this session, which both old and new builds write. */
function turnLog(sessionId: string): TurnLog {
  const lines = existsSync(logPath()) ? readFileSync(logPath(), 'utf8').split('\n') : []
  const line = [...lines].reverse().find((entry) => entry.includes(`turn ${sessionId} done`)) ?? ''
  const number = (pattern: RegExp): number => Number(pattern.exec(line)?.[1] ?? 0)
  return {
    steps: number(/steps=(\d+)/),
    tokensIn: number(/tokens=(\d+)\//),
    tokensOut: number(/tokens=\d+\/(\d+)/),
    prefixFirstK: number(/prefix=(\d+)k/),
    prefixLastK: number(/prefix=\d+k→(\d+)k/),
    cacheRead: number(/cache=(\d+)r/),
    calls: number(/calls=(\d+)/),
    ms: number(/ (\d+)ms\(model/)
  }
}

/** Text parts said, and the longest run of tool calls with nothing said in between. */
function narration(sessionId: string): { textParts: number; longestSilentRun: number; answer: string; errors: string[] } {
  let textParts = 0
  let run = 0
  let longest = 0
  let answer = ''
  const errors: string[] = []
  const blocks = store.listBlocks(sessionId)
  for (const message of store.listMessages(sessionId).filter((m) => m.role === 'assistant')) {
    run += blocks.filter((block) => block.messageId === message.id).length
    for (const part of message.parts) {
      if (part.type === 'text' && part.text?.trim()) {
        textParts++
        answer = part.text
        longest = Math.max(longest, run)
        run = 0
      }
      if (part.type === 'error' && part.text) errors.push(part.text.slice(0, 200))
    }
  }
  return { textParts, longestSilentRun: Math.max(longest, run), answer: answer.slice(0, 300), errors }
}

interface Scenario {
  name: string
  turns: string[]
  verify: (dir: string, answer: string) => boolean
}

const SCENARIOS: Scenario[] = [
  {
    name: 'question',
    turns: ['¿En qué puerto escucha el servidor de este proyecto? Contesta solo con el número.'],
    verify: (_dir, answer) => answer.includes('4317')
  },
  {
    name: 'rename',
    turns: ['Renombra la función calcTotal a computeTotal en todo el proyecto.'],
    verify: (dir) =>
      ['util.js', 'server.js', 'test.js'].every((file) => read(dir, file).includes('computeTotal')) &&
      !['util.js', 'server.js', 'test.js'].some((file) => read(dir, file).includes('calcTotal'))
  },
  {
    name: 'tests',
    turns: ['Ejecuta los tests del proyecto y dime si pasan.'],
    verify: (_dir, answer) => /pasan|passed|pass|correct|éxito|ok/i.test(answer)
  },
  {
    name: 'background',
    turns: ['Lanza en segundo plano `sleep 25 && echo listo-25` y dime lo que imprime cuando termine.'],
    verify: (_dir, answer) => answer.includes('listo-25')
  },
  {
    name: 'follow-up',
    turns: ['Lee util.js y dime en una frase qué hace.', '¿Y qué devuelve si le paso una lista vacía?'],
    verify: (_dir, answer) => /\b0\b|cero|zero/i.test(answer)
  }
]

// Claude goes through the Anthropic SDK (LiteLLM serves /v1/messages); everything else as OpenAI-compatible.
const providerFor = (model: string): string => (model.startsWith('claude-') ? 'liveclaude' : 'live')

const PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-opus-5-5': { input: 4, output: 20 }
}

async function run(model: string, scenario: Scenario): Promise<TurnReport[]> {
  const dir = fixture()
  const session = store.createSession({
    title: `live ${scenario.name}`,
    cwd: dir,
    environmentId: 'local',
    agentId: 'manager',
    model: `${providerFor(model)}/${model}`,
    autoApprove: true
  })
  const reports: TurnReport[] = []
  for (const [index, text] of scenario.turns.entries()) {
    const began = Date.now()
    await runTurn({ sessionId: session.id, userText: text }).catch((error: Error) => {
      console.log(`  turn threw: ${error.message}`)
    })
    const log = turnLog(session.id)
    const said = narration(session.id)
    const last = index === scenario.turns.length - 1
    reports.push({
      ...log,
      ...said,
      scenario: `${scenario.name}#${index + 1}`,
      model,
      ok: last ? scenario.verify(dir, said.answer) : said.textParts > 0,
      status: store.getSession(session.id)?.status ?? 'gone',
      ms: log.ms || Date.now() - began
    })
  }
  return reports
}

async function main(): Promise<void> {
  const models = process.argv.slice(2)
  const keyFile = process.env.OD_LIVE_KEY_FILE
  const baseURL = process.env.OD_LIVE_BASE_URL ?? 'https://ia.h-ltd.net/v1'
  if (models.length === 0 || !keyFile) {
    console.log('usage: OD_LIVE_KEY_FILE=<path> [OD_LIVE_BASE_URL=…] live-check.mjs <model> [<model>…]')
    process.exit(2)
  }
  seedBuiltins()
  setAgentLoader(listAgents)
  const base = defaultConfig()
  const declare = (ids: string[]) =>
    Object.fromEntries(
      ids.map((id) => [
        id,
        PRICES[id]
          ? { id, name: id, reasoning: true, toolCall: true, contextWindow: 1_000_000, price: PRICES[id] }
          : { id, name: id, reasoning: true, toolCall: true, contextWindow: 1_000_000, billing: 'flat' as const }
      ])
    )
  saveConfig({
    ...base,
    model: `${providerFor(models[0])}/${models[0]}`,
    autoApprove: true,
    provider: {
      ...base.provider,
      live: {
        id: 'live',
        npm: '@ai-sdk/openai-compatible',
        name: 'Live',
        options: { baseURL, apiKey: `{file:${keyFile}}` },
        models: declare(models.filter((id) => providerFor(id) === 'live'))
      },
      liveclaude: {
        id: 'liveclaude',
        npm: '@ai-sdk/anthropic',
        name: 'Live Claude',
        options: { baseURL, apiKey: `{file:${keyFile}}` },
        models: declare(models.filter((id) => providerFor(id) === 'liveclaude'))
      }
    }
  })
  loadConfig(true)
  store.loadStore()

  const only = process.env.OD_LIVE_ONLY?.split(',')
  const all: TurnReport[] = []
  for (const model of models) {
    for (const scenario of SCENARIOS.filter((s) => !only || only.includes(s.name))) {
      console.log(`\n${model} · ${scenario.name}`)
      for (const report of await run(model, scenario)) {
        all.push(report)
        console.log(
          `  ${report.ok ? 'ok  ' : 'FAIL'} ${report.scenario} steps=${report.steps} in=${report.tokensIn} ` +
            `out=${report.tokensOut} cache=${report.cacheRead} prefix=${report.prefixFirstK}k→${report.prefixLastK}k calls=${report.calls} ` +
            `said=${report.textParts} silent-run=${report.longestSilentRun} ${Math.round(report.ms / 1000)}s ` +
            `status=${report.status}${report.errors.length ? ` errors=${JSON.stringify(report.errors)}` : ''}`
        )
      }
    }
  }
  if (process.env.OD_LIVE_OUT) {
    mkdirSync(join(process.env.OD_LIVE_OUT, '..'), { recursive: true })
    writeFileSync(process.env.OD_LIVE_OUT, JSON.stringify(all, null, 2))
  }
  const failed = all.filter((report) => !report.ok)
  console.log(`\n${all.length - failed.length}/${all.length} turns did the job`)
  store.flush()
  process.exit(failed.length > 0 ? 1 : 0)
}

void main()
