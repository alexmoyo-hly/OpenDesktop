import { beforeAll, describe, expect, test } from 'vitest'
import { loadConfig } from '../src/main/config'
import { acceptSuggestion, approvalPattern, dismissSuggestion, recordApproval, suggestions } from '../src/main/learn'
import { boot } from './helpers'

beforeAll(boot)

describe('what an approval teaches', () => {
  test('a command becomes the pattern a person would write for it', () => {
    expect(approvalPattern('pnpm test --watch')).toBe('pnpm test*')
    expect(approvalPattern('node test.js')).toBe('node test.js*')
    expect(approvalPattern('cd /work/shop && pnpm run lint')).toBe('pnpm run*')
    expect(approvalPattern('npx tsc --noEmit -p tsconfig.json')).toBe('npx tsc*')
    expect(approvalPattern('make')).toBe('make*')
  })

  test('nothing is learned from commands that remove, move, push or reach out', () => {
    for (const command of ['rm -rf build', 'mv a b', 'git push origin main', 'sudo make install', 'curl https://x', 'terraform apply', 'kubectl delete pod x', 'echo x > f', 'ls && rm x', 'bash -c "ls"'])
      expect(approvalPattern(command), command).toBeNull()
  })
})

describe('suggesting an allowlist entry', () => {
  const ask = (command: string) => recordApproval({ tool: 'bash', command })

  test('after the third approval of the same pattern, not before', () => {
    ask('pnpm test')
    ask('pnpm test -- --run')
    expect(suggestions(loadConfig()).map((s) => s.pattern)).not.toContain('pnpm test*')
    ask('pnpm test --watch=false')
    const offered = suggestions(loadConfig()).find((s) => s.pattern === 'pnpm test*')
    expect(offered?.count).toBe(3)
    expect(offered?.example).toBe('pnpm test --watch=false')
  })

  test('accepting adds it to the allowlist and it is not offered again', () => {
    for (let i = 0; i < 3; i++) ask('cargo check')
    acceptSuggestion('cargo check*')
    expect(loadConfig().permissions.allowlist).toContain('cargo check*')
    expect(suggestions(loadConfig()).map((s) => s.pattern)).not.toContain('cargo check*')
  })

  test('a dismissed one stays dismissed', () => {
    for (let i = 0; i < 3; i++) ask('docker ps')
    dismissSuggestion('docker ps*')
    for (let i = 0; i < 3; i++) ask('docker ps -a')
    expect(suggestions(loadConfig()).map((s) => s.pattern)).not.toContain('docker ps*')
  })

  test('what the allowlist already covers is not suggested', () => {
    for (let i = 0; i < 3; i++) ask('git status --short')
    expect(suggestions(loadConfig()).map((s) => s.pattern)).not.toContain('git status*')
  })
})
