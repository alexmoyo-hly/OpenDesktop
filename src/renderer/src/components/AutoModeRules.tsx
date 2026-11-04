import { useState, type ReactNode } from 'react'
import type { AutoModePolicy } from '@shared/types'
import { SUGGESTED_AUTO_MODE } from '@shared/auto-mode'
import { Row } from './settings-ui'

type Kind = 'environment' | 'allow' | 'deny'

const BOXES: { kind: Kind; label: string; description: string }[] = [
  {
    kind: 'environment',
    label: 'Environment',
    description: 'What this machine is and what is trusted, so the judge can tell inside from outside.'
  },
  {
    kind: 'allow',
    label: 'Allow',
    description: 'Exceptions: what is fine even when a deny rule seems to reach it.'
  },
  {
    kind: 'deny',
    label: 'Deny',
    description:
      'Refused, with the rule and the reason given to the agent, unless you asked for it in the conversation. Name each rule ("Git Push: …") so the refusal can cite it.'
  }
]

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * The auto-approve rules, in prose, one per line — the way Claude Code's auto
 * mode is configured. Easier to add to than the denylist, and judged by a model
 * rather than matched, so less certain: the denylist still comes first.
 */
export function AutoModeRules({
  policy,
  onSave
}: {
  policy: AutoModePolicy | undefined
  onSave: (next: AutoModePolicy) => void
}): ReactNode {
  const current: AutoModePolicy = policy ?? { environment: [], allow: [], deny: [] }
  const [drafts, setDrafts] = useState<Partial<Record<Kind, string>>>({})
  const empty = current.environment.length + current.allow.length + current.deny.length === 0

  return (
    <>
      {BOXES.map((box) => (
        <Row key={box.kind} align="start" label={box.label} description={box.description}>
          <textarea
            aria-label={box.label}
            spellCheck={false}
            rows={Math.max(3, Math.min(10, current[box.kind].length + 1))}
            value={drafts[box.kind] ?? current[box.kind].join('\n')}
            onChange={(event) => setDrafts({ ...drafts, [box.kind]: event.target.value })}
            onBlur={() => {
              const draft = drafts[box.kind]
              if (draft === undefined) return
              setDrafts({ ...drafts, [box.kind]: undefined })
              onSave({ ...current, [box.kind]: lines(draft) })
            }}
            className="border-ink-800 bg-ink-850 text-ink-200 placeholder:text-ink-600 focus:border-ink-600 min-h-[64px] w-[420px] resize-y rounded-lg border px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.5] outline-none"
          />
        </Row>
      ))}
      {empty ? (
        <Row label="No rules yet" description="Without allow or deny rules, auto-approve lifts every prompt.">
          <button
            type="button"
            onClick={() => onSave({ ...SUGGESTED_AUTO_MODE, ...(policy?.model ? { model: policy.model } : {}) })}
            className="border-ink-700 text-ink-200 hover:bg-ink-800 rounded-lg border px-2.5 py-1.5 text-[12.5px]"
          >
            Use the suggested rules
          </button>
        </Row>
      ) : null}
    </>
  )
}
