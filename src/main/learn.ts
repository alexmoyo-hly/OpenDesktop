import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig } from '@shared/types'
import { deniedSegment, hasOpaqueShellSyntax, matchesAny, splitCommand } from './approvals'
import { DATA_DIR, loadConfig, saveConfig } from './config'

/**
 * Learning from what a person approves by hand.
 *
 * "It asks too much" is usually the same few commands approved over and over.
 * After the third approval of the same pattern, the app offers to put it on the
 * allowlist — a deterministic rule the person reads and accepts, not something
 * the app decides for them. Never for commands that remove, move, push or
 * reach out, whatever the count.
 */

const AFTER = 3
const FILE = (): string => join(DATA_DIR, 'learned-approvals.json')

// Programs no count of approvals turns into "never ask again".
const NEVER = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'dd', 'chmod', 'chown', 'ln', 'truncate', 'shred',
  'sudo', 'su', 'doas', 'kill', 'pkill', 'killall', 'shutdown', 'reboot', 'launchctl',
  'curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'nc', 'telnet', 'ftp',
  'terraform', 'kubectl', 'helm', 'gcloud', 'aws', 'az', 'gh',
  'bash', 'sh', 'zsh', 'eval', 'exec', 'xargs', 'env', 'nohup', 'osascript'
])
const GIT_NEVER = new Set(['push', 'reset', 'rebase', 'clean', 'branch', 'tag', 'remote', 'checkout', 'switch', 'restore', 'rm', 'mv', 'filter-branch', 'gc', 'prune'])

/** The allowlist pattern a person would write for this command, or null when none should be offered. */
export function approvalPattern(command: string): string | null {
  if (hasOpaqueShellSyntax(command)) return null
  const segments = splitCommand(command).filter((segment) => !/^cd(?:\s|$)/.test(segment))
  if (segments.length !== 1) return null
  const [program, second] = segments[0].split(/\s+/)
  if (!program || NEVER.has(program)) return null
  if (program === 'git' && (!second || GIT_NEVER.has(second))) return null
  const keepsSecond = second !== undefined && !second.startsWith('-') && !/['"`$]/.test(second)
  return keepsSecond ? `${program} ${second}*` : `${program}*`
}

interface Learned {
  patterns: Record<string, { count: number; example: string; lastAt: number }>
  dismissed: string[]
}

function load(): Learned {
  try {
    if (existsSync(FILE())) return JSON.parse(readFileSync(FILE(), 'utf8')) as Learned
  } catch {
    // A file that does not parse starts the count again; it is a convenience, not a record.
  }
  return { patterns: {}, dismissed: [] }
}

function save(learned: Learned): void {
  writeFileSync(FILE(), JSON.stringify(learned, null, 2), 'utf8')
}

/** A person approved a call by hand. */
export function recordApproval(request: { tool: string; command?: string }): void {
  if (request.tool !== 'bash' || !request.command) return
  const pattern = approvalPattern(request.command)
  if (!pattern) return
  const learned = load()
  const seen = learned.patterns[pattern] ?? { count: 0, example: request.command, lastAt: 0 }
  learned.patterns[pattern] = { count: seen.count + 1, example: request.command, lastAt: Date.now() }
  save(learned)
}

export interface Suggestion {
  pattern: string
  count: number
  example: string
}

/** Patterns approved often enough to offer, that nothing already allows or denies. */
export function suggestions(config: AppConfig): Suggestion[] {
  const learned = load()
  return Object.entries(learned.patterns)
    .filter(([pattern, seen]) => seen.count >= AFTER && !learned.dismissed.includes(pattern))
    .filter(([pattern, seen]) => !config.permissions.allowlist.includes(pattern) && !matchesAny(seen.example, config.permissions.allowlist))
    .filter(([, seen]) => deniedSegment(config.permissions, seen.example) === null)
    .map(([pattern, seen]) => ({ pattern, count: seen.count, example: seen.example }))
    .sort((a, b) => b.count - a.count)
}

export function acceptSuggestion(pattern: string): void {
  const config = loadConfig()
  if (config.permissions.allowlist.includes(pattern)) return
  saveConfig({ ...config, permissions: { ...config.permissions, allowlist: [...config.permissions.allowlist, pattern] } })
}

export function dismissSuggestion(pattern: string): void {
  const learned = load()
  if (!learned.dismissed.includes(pattern)) learned.dismissed.push(pattern)
  save(learned)
}
