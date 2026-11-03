import { posix } from 'node:path'
import type { Runtime } from './runtime'

/** Characters, not tokens: the brief is resent on every step, so it is capped. */
export const BRIEF_LIMIT = 8_000
export const SLIM_BRIEF_LIMIT = 1_500

const NAMES = ['AGENTS.md', 'CLAUDE.md'] as const

export interface ProjectBrief {
  file: (typeof NAMES)[number]
  path: string
  text: string
  truncated: boolean
}

/** The repository's own instructions, read through the runtime so an SSH session reads the remote file. */
export async function projectBrief(
  runtime: Runtime,
  cwd: string,
  limit = BRIEF_LIMIT
): Promise<ProjectBrief | null> {
  for (const file of NAMES) {
    const path = posix.join(cwd, file)
    let raw = ''
    try {
      if (!(await runtime.exists(path))) continue
      raw = (await runtime.readFile(path)).trim()
    } catch {
      continue
    }
    if (!raw) continue
    if (raw.length <= limit) return { file, path, text: raw, truncated: false }
    const cut = raw.slice(0, limit)
    const lineEnd = cut.lastIndexOf('\n')
    return { file, path, text: (lineEnd > 0 ? cut.slice(0, lineEnd) : cut).trimEnd(), truncated: true }
  }
  return null
}

export function briefSection(brief: ProjectBrief): string {
  const tail = brief.truncated
    ? `\n\n[Truncated: the rest of ${brief.path} was not read. Read it if you need it.]`
    : ''
  return `\n\n# Project brief (${brief.file})\n${brief.text}${tail}`
}
