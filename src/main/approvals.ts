import { nanoid } from 'nanoid'
import type { ApprovalRequest, PermissionMode, Permissions } from '@shared/types'
import { bus } from './bus'

export type ApprovalAnswer = 'once' | 'always' | 'reject'

/** What a person decided; `note` is the reason they typed when they said no. */
export interface ApprovalDecision {
  answer: ApprovalAnswer
  note?: string
}

interface Pending {
  request: ApprovalRequest
  resolve: (decision: ApprovalDecision) => void
}

const pending = new Map<string, Pending>()
/** Per-session grants keyed by `tool` or `tool:signature`, from "Always allow". */
const sessionGrants = new Map<string, Set<string>>()

export class PermissionDenied extends Error {
  /**
   * `why` is for a refusal that was not a person's: the denylist. An agent told
   * only "not permitted" cannot tell a policy from a broken tool, and what it
   * does next is try the same thing another way — so the rule that refused it is
   * named, and the sentence says who refused.
   */
  constructor(what: string, why?: string, note?: string) {
    super(
      why
        ? `Refused by this machine's configuration (${why}): ${what}. Do not retry it and do not ` +
          `work around it; tell the user what you needed and why.`
        : note
          ? `Denied by the user: ${what}. Their reason: ${note}. Do what that says; do not retry ` +
            `the same thing another way.`
          : `Denied by the user: ${what}. Do not retry this; tell the user what you needed and why.`
    )
    this.endsTurn = !why && !note
  }

  /**
   * A bare "no" from a person ends the turn. Told "do not retry", models still
   * reached the same end another way (mv to /tmp, then cp to /tmp): the next
   * move has to be the person's.
   */
  readonly endsTurn: boolean
}

export function listPending(): ApprovalRequest[] {
  return [...pending.values()].map((p) => p.request)
}

export function grantForSession(sessionId: string, key: string): void {
  const set = sessionGrants.get(sessionId) ?? new Set<string>()
  set.add(key)
  sessionGrants.set(sessionId, set)
}

export function hasSessionGrant(sessionId: string, key: string): boolean {
  return sessionGrants.get(sessionId)?.has(key) ?? false
}

/**
 * What an "always" covers: the tool, or for a command each program in it (`bash:git`).
 * Null when the line hides a command or writes a file — that is never granted ahead.
 */
function grantKeys(tool: string, command?: string): string[] | null {
  if (!command) return [tool]
  const segments = splitCommand(command)
  if (segments.length === 0 || hasOpaqueShellSyntax(command) || segments.some(escalates)) return null
  return segments.map((segment) => `${tool}:${segment.split(/\s+/)[0]}`)
}

export function isGranted(sessionId: string, tool: string, command?: string): boolean {
  const keys = grantKeys(tool, command)
  return keys !== null && keys.every((key) => hasSessionGrant(sessionId, key))
}

export function resolveApproval(approvalId: string, answer: ApprovalAnswer, note?: string): void {
  const entry = pending.get(approvalId)
  if (!entry) return
  pending.delete(approvalId)
  bus.emit({ type: 'approval.resolved', approvalId })
  if (answer === 'always') {
    for (const key of grantKeys(entry.request.tool, entry.request.command) ?? []) {
      grantForSession(entry.request.sessionId, key)
    }
  }
  const reason = answer === 'reject' ? note?.trim() : undefined
  entry.resolve(reason ? { answer, note: reason } : { answer })
}

/** Rejects everything outstanding for a session, e.g. when the user stops the turn. */
export function cancelSessionApprovals(sessionId: string): void {
  for (const [id, entry] of [...pending.entries()]) {
    if (entry.request.sessionId !== sessionId) continue
    pending.delete(id)
    bus.emit({ type: 'approval.resolved', approvalId: id })
    entry.resolve({ answer: 'reject' })
  }
}

export function requestApproval(input: {
  sessionId: string
  blockId: string
  tool: string
  title: string
  detail: string
  summary?: string
  preview?: string
  /** For a shell call: what "always" is granted against. */
  command?: string
  outside?: string[]
  environmentId: string
  cwd: string
}): Promise<ApprovalDecision> {
  const request: ApprovalRequest = { ...input, id: nanoid(10), createdAt: Date.now() }
  return new Promise<ApprovalDecision>((resolve) => {
    pending.set(request.id, { request, resolve })
    bus.emit({ type: 'approval.requested', request })
  })
}

/* ---------------- pattern matching ---------------- */

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

export function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((p) => patternToRegExp(p.trim()).test(value.trim()))
}

/**
 * Splits a compound shell command so an allowlist entry cannot be smuggled past
 * by chaining. Every segment has to stand on its own.
 *
 * `&` and a bare newline are separators too. Without them, `cat x & rm -rf ~`
 * was one segment that matched `cat *` and went through without asking.
 */
export function splitCommand(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||&|\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Whether the command does something the text does not show.
 *
 * An allowlist entry like `echo *` is a statement about what `echo` does. It
 * stops being true the moment the line can run another program inside itself or
 * write over a file: `echo $(rm -rf ~)` and `echo x > ~/.zshrc` both matched
 * that pattern and were approved silently.
 *
 * These are not denied — a person may well want them. They just never skip the
 * prompt, because the prompt is the only place the real effect is visible.
 */
export function hasOpaqueShellSyntax(command: string): boolean {
  return (
    command.includes('$(') || // command substitution
    command.includes('`') || // the older spelling of the same thing
    command.includes('>') || // truncates or appends to a file
    command.includes('<(') || // process substitution
    command.includes('<<') // heredoc: the payload is not on this line
  )
}

// Programs whose path arguments are written, moved or removed.
const WRITERS = new Set(['mv', 'cp', 'rm', 'mkdir', 'touch', 'tee', 'ln', 'rsync', 'install', 'truncate', 'chmod', 'chown'])

function absolute(path: string, home: string): string | null {
  const bare = path.replace(/^['"]|['"]$/g, '')
  if (bare === '~' || bare.startsWith('~/')) return home + bare.slice(1)
  return bare.startsWith('/') ? bare : null
}

/**
 * Absolute paths a command writes outside `cwd`: redirection targets, and the
 * path arguments of programs that write. Relative paths stay inside by
 * definition here; `cd elsewhere && …` is not followed.
 */
export function pathsWrittenOutside(cwd: string, command: string, home: string): string[] {
  const targets = [...command.matchAll(/(?:&>>?|\d?>>?)\s*([^\s;&|<>]+)/g)].map((match) => match[1])
  for (const segment of splitCommand(command)) {
    const [program, ...args] = segment.split(/\s+/)
    if (WRITERS.has(program)) targets.push(...args.filter((arg) => !arg.startsWith('-')))
  }
  const inside = (path: string): boolean => path === cwd || path.startsWith(cwd.endsWith('/') ? cwd : `${cwd}/`)
  return targets
    .map((target) => absolute(target, home))
    .filter((path): path is string => path !== null && !path.startsWith('/dev/') && !inside(path))
}

// Flags that turn an allowlisted reader (find, rg, git diff/log) into something that runs code or writes files.
const RUNS_OR_WRITES = ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls', '--pre', '--pre-glob', '--output']

export function escalates(segment: string): boolean {
  return segment
    .replace(/['"\\]/g, '')
    .split(/\s+/)
    .some((word) => RUNS_OR_WRITES.some((flag) => word === flag || word.startsWith(`${flag}=`)))
}

/**
 * The segment of a command that the denylist refuses, or null.
 *
 * Shared by the agent's own bash calls and by the run button on a code block:
 * the button needs no approval prompt, since clicking it is the approval, but
 * the denylist is about things that should not run however they were asked for.
 */
export function deniedSegment(permissions: Permissions, command: string): string | null {
  return splitCommand(command).find((segment) => matchesAny(segment, permissions.denylist)) ?? null
}

/**
 * The same permissions, minus the questions.
 *
 * Auto-approve lifts `ask` to `allow` and does nothing else. It is not a
 * blanket "run anything": a tool the user set to `deny` stays denied, and the
 * denylist is checked before any mode is consulted, so a command nobody should
 * ever run still cannot run. What it removes is the prompt, not the policy —
 * which is also why it is a property of one session rather than an edit to the
 * config: a standing policy should not be changed by wanting to be left alone
 * for an afternoon.
 */
export function withoutPrompts(permissions: Permissions): Permissions {
  const lift = (mode: PermissionMode): PermissionMode => (mode === 'ask' ? 'allow' : mode)
  /*
   * Every mode, not a list of them.
   *
   * This used to name the five keys it knew about, so a key added later was
   * silently left asking — and an auto-approving session that hits one waits
   * for an answer from a dialog nobody is looking at, for as long as the turn
   * ceiling allows. That is how `mcp` arrived: the turn simply stopped. A
   * `deny` still denies, which is the whole point of lifting only `ask`.
   */
  const out: Permissions = { ...permissions }
  for (const [key, value] of Object.entries(permissions)) {
    if (value === 'ask' || value === 'allow' || value === 'deny') {
      ;(out as unknown as Record<string, PermissionMode>)[key] = lift(value)
    }
  }
  return out
}

export interface PermissionDecision {
  mode: PermissionMode
  /** True when an allowlist entry short-circuits the prompt. */
  preapproved: boolean
  /** The denylist pattern that refused it, when that is what happened. */
  deniedBy?: string
}

export function decide(
  permissions: Permissions,
  tool: keyof Omit<Permissions, 'allowlist' | 'denylist'>,
  command?: string
): PermissionDecision {
  const mode = permissions[tool] ?? 'ask'
  if (command) {
    const segments = splitCommand(command)
    const pattern = permissions.denylist.find((entry) =>
      segments.some((segment) => matchesAny(segment, [entry]))
    )
    if (pattern !== undefined) {
      return { mode: 'deny', preapproved: false, deniedBy: `denylist pattern "${pattern}"` }
    }
    if (
      segments.length > 0 &&
      !hasOpaqueShellSyntax(command) &&
      segments.every((s) => matchesAny(s, permissions.allowlist) && !escalates(s))
    ) {
      return { mode, preapproved: true }
    }
  }
  return { mode, preapproved: false }
}
