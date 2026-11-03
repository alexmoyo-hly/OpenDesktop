import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { DATA_DIR } from '../src/main/config'
import * as history from '../src/main/history'
import * as store from '../src/main/store'
import { boot, newSession } from './helpers'

beforeAll(boot)

const historyDir = join(DATA_DIR, 'history')
const writeRaw = (id: string, body: string): void => {
  mkdirSync(historyDir, { recursive: true })
  writeFileSync(join(historyDir, `${id}.json`), body, 'utf8')
}

describe('history on disk', () => {
  test('an image saved as JSON comes back as bytes the SDK can send', () => {
    const saved = JSON.parse(
      JSON.stringify([
        { role: 'user', content: [{ type: 'image', image: Buffer.from([1, 2, 3]), mediaType: 'image/png' }] }
      ])
    )
    writeRaw('img-ok', JSON.stringify(saved))
    const image = (history.getHistory('img-ok')[0].content as { image: unknown }[])[0].image
    expect(image).toBeInstanceOf(Uint8Array)
    expect([...(image as Uint8Array)]).toEqual([1, 2, 3])
  })

  test('an image that cannot be restored becomes a note, not a dead session', () => {
    writeRaw('img-bad', JSON.stringify([{ role: 'user', content: [{ type: 'image', image: { mystery: true } }] }]))
    expect(JSON.stringify(history.getHistory('img-bad'))).toContain('could not be restored')
  })

  test('a corrupt history file is kept aside instead of being overwritten', () => {
    writeRaw('corrupt', '[{"role":"user","content":"tru')
    expect(history.getHistory('corrupt')).toEqual([])
    history.appendHistory('corrupt', [{ role: 'user', content: 'new' }])
    const kept = readdirSync(historyDir).filter((name) => name.startsWith('corrupt.json.corrupt'))
    expect(kept.length).toBe(1)
    expect(readFileSync(join(historyDir, kept[0]), 'utf8')).toBe('[{"role":"user","content":"tru')
  })

  test('writes leave no temporary files behind', () => {
    history.appendHistory('tidy', [{ role: 'user', content: 'x' }])
    expect(readdirSync(historyDir).filter((name) => name.includes('.tmp'))).toEqual([])
  })
})

describe('sessions on disk', () => {
  test('an unreadable session file is kept aside and its history is not swept as an orphan', () => {
    const session = newSession()
    history.appendHistory(session.id, [{ role: 'user', content: 'keep me' }])
    store.flush()
    const sessionPath = join(DATA_DIR, 'sessions', `${session.id}.json`)
    writeFileSync(sessionPath, '{"session": {"id": "', 'utf8')

    store.loadStore()
    expect(store.unreadableSessions()).toContain(session.id)
    history.dropOrphans([...store.listSessions().map((s) => s.id), ...store.unreadableSessions()])
    expect(existsSync(join(historyDir, `${session.id}.json`))).toBe(true)
    expect(existsSync(`${sessionPath}.corrupt`)).toBe(true)
  })
})
