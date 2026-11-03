import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { previewUrl, startPreviewServer, stopPreviewServer } from '../src/main/preview'
import { boot, tempDir } from './helpers'

beforeAll(async () => {
  boot()
  await startPreviewServer()
})
afterAll(stopPreviewServer)

test('every page is sandboxed into an opaque origin, so its scripts cannot read other files', async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'page.html'), '<script>fetch("/f/local/etc/passwd")</script>')
  const res = await fetch(previewUrl('local', join(dir, 'page.html')))
  expect(res.headers.get('content-security-policy')).toMatch(/sandbox/)
  expect(res.headers.get('content-security-policy')).not.toMatch(/allow-same-origin/)
})

test('a file name cannot inject markup into a directory listing', async () => {
  const dir = tempDir()
  writeFileSync(join(dir, '<img src=x onerror=alert(1)>'), 'x')
  const body = await (await fetch(previewUrl('local', dir))).text()
  expect(body).not.toContain('<img src=x')
  expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;')
})

test('the token is still required', async () => {
  const res = await fetch(previewUrl('local', tempDir()).replace(/t=[^&]+/, 't=wrong'))
  expect(res.status).toBe(403)
})
