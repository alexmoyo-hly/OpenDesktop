import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { verifyHostKey } from '../src/main/runtime/ssh'
import { tempDir } from './helpers'

/** An ssh public key blob: string "ssh-ed25519" + 32 key bytes, as ssh2 hands it to hostVerifier. */
function keyBlob(): Buffer {
  const type = Buffer.from('ssh-ed25519')
  const body = randomBytes(32)
  const out = Buffer.alloc(4 + type.length + 4 + body.length)
  out.writeUInt32BE(type.length, 0)
  type.copy(out, 4)
  out.writeUInt32BE(body.length, 4 + type.length)
  body.copy(out, 8 + type.length)
  return out
}

const line = (host: string, key: Buffer) => `${host} ssh-ed25519 ${key.toString('base64')}`

function hashed(host: string): string {
  const salt = randomBytes(20)
  const hash = createHmac('sha1', salt).update(host).digest()
  return `|1|${salt.toString('base64')}|${hash.toString('base64')}`
}

function files(system = '') {
  const dir = tempDir('od-ssh-')
  const paths = { system: join(dir, 'known_hosts'), own: join(dir, 'own_known_hosts') }
  writeFileSync(paths.system, system)
  return paths
}

describe('ssh host keys', () => {
  test('a host whose key is in known_hosts connects', () => {
    const key = keyBlob()
    expect(verifyHostKey('box.example', 22, key, files(`${line('other,box.example', key)}\n`))).toBeNull()
  })

  test('hashed known_hosts entries are understood', () => {
    const key = keyBlob()
    expect(verifyHostKey('box.example', 22, key, files(`${line(hashed('box.example'), key)}\n`))).toBeNull()
  })

  test('a non-standard port is matched as [host]:port, as OpenSSH writes it', () => {
    const key = keyBlob()
    expect(verifyHostKey('box.example', 2222, key, files(`${line('[box.example]:2222', key)}\n`))).toBeNull()
  })

  test('a changed key is refused: that is what a man in the middle looks like', () => {
    const verdict = verifyHostKey('box.example', 22, keyBlob(), files(`${line('box.example', keyBlob())}\n`))
    expect(verdict).toMatch(/changed/i)
  })

  test('a new host is trusted once and remembered, so a later change is caught', () => {
    const paths = files()
    const first = keyBlob()
    expect(verifyHostKey('new.example', 22, first, paths)).toBeNull()
    expect(readFileSync(paths.own, 'utf8')).toContain('new.example ssh-ed25519')
    expect(verifyHostKey('new.example', 22, first, paths)).toBeNull()
    expect(verifyHostKey('new.example', 22, keyBlob(), paths)).toMatch(/changed/i)
  })

  test('comments and markers are ignored', () => {
    const key = keyBlob()
    const text = `# a comment\n@cert-authority *.example ssh-ed25519 AAAA\n${line('box.example', key)}\n`
    expect(verifyHostKey('box.example', 22, key, files(text))).toBeNull()
  })
})
