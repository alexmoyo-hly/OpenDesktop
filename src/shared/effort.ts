import type { ProviderModelConfig } from './types'

/**
 * How hard to try, as one dial.
 *
 * Every AI client has grown one of these, and they all mean roughly "spend more
 * for a better answer". What it must not mean is a hidden second model picker:
 * the model is chosen in the model picker, and a slider that silently swapped
 * it would make the label above it a lie. So it moves the two things that
 * belong to *this* turn of *this* model — how much it may think, and how many
 * steps it gets — and the interface says which of the two is actually in force,
 * because a model with no reasoning setting can only be given the second.
 */
export interface EffortLevel {
  value: number
  label: string
  /**
   * What to ask a reasoning model for. `off` is a model told not to think at
   * all, which some support and most ignore.
   */
  reasoning: 'off' | 'minimal' | 'low' | 'medium' | 'high'
  /** Share of the configured step ceiling this level allows. */
  steps: number
}

export const EFFORT_LEVELS: EffortLevel[] = [
  { value: 1, label: 'Minimal', reasoning: 'off', steps: 0.25 },
  { value: 2, label: 'Low', reasoning: 'low', steps: 0.5 },
  { value: 3, label: 'Medium', reasoning: 'medium', steps: 1 },
  { value: 4, label: 'High', reasoning: 'high', steps: 1 },
  { value: 5, label: 'Max', reasoning: 'high', steps: 1 }
]

export const DEFAULT_EFFORT = 3

export function effortLevel(value: number | undefined): EffortLevel {
  return EFFORT_LEVELS.find((level) => level.value === (value ?? DEFAULT_EFFORT)) ?? EFFORT_LEVELS[2]
}

/**
 * Whether this model has anything to think with.
 *
 * Declared, not guessed: `reasoning` is a field on the model, set from the
 * catalogue or by hand, and a provider that is sent a setting it does not
 * understand is a request that might fail. So the dial only reaches the models
 * that say they have one, and says so plainly about the rest.
 */
export function canReason(model: ProviderModelConfig | undefined): boolean {
  return model?.reasoning === true
}

export type ReasoningLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high'

/**
 * The AI SDK's own `reasoning` call option for this level; each provider package
 * maps it to its API (adaptive thinking + effort on current Claude models).
 * Claude Opus 5.5 rejects thinking disabled, so on Anthropic the lowest level is `minimal`.
 */
export function reasoningLevel(npm: string, level: EffortLevel): ReasoningLevel {
  if (level.reasoning !== 'off') return level.reasoning
  return npm === '@ai-sdk/anthropic' ? 'minimal' : 'none'
}
