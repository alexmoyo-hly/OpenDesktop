import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { wrapLanguageModel, type LanguageModel } from 'ai'
import type { AppConfig } from '@shared/types'
import { isLocalProvider } from '@shared/local-model'
import { loadConfig } from './config'
import { ensureLocalModel } from './local-model'

export interface ResolvedModel {
  providerId: string
  modelId: string
  label: string
  model: LanguageModel
  contextWindow?: number
}

type Factory = (options: Record<string, unknown>) => (modelId: string) => LanguageModel

/**
 * The AI SDK packages we ship with. A config can name any of these in `npm`;
 * anything else is loaded dynamically and must be installed alongside the app.
 */
const FACTORIES: Record<string, Factory> = {
  '@ai-sdk/openai-compatible': (options) =>
    createOpenAICompatible({ name: 'compat', ...options } as never) as unknown as (
      id: string
    ) => LanguageModel,
  '@ai-sdk/openai': (options) => createOpenAI(options as never) as unknown as (id: string) => LanguageModel,
  '@ai-sdk/anthropic': (options) =>
    createAnthropic(options as never) as unknown as (id: string) => LanguageModel,
  '@ai-sdk/google': (options) =>
    createGoogleGenerativeAI(options as never) as unknown as (id: string) => LanguageModel
}

const cache = new Map<string, (modelId: string) => LanguageModel>()

let overrideResolver: ((ref: string) => ResolvedModel | null) | null = null

/**
 * Test seam: lets the headless smoke test substitute a mock model without a
 * provider or a network call. Never set in normal operation.
 */
export function setModelResolverOverride(fn: ((ref: string) => ResolvedModel | null) | null): void {
  overrideResolver = fn
}

async function providerFor(
  config: AppConfig,
  providerId: string
): Promise<(modelId: string) => LanguageModel> {
  const provider = config.provider[providerId]
  if (!provider) {
    throw new Error(
      `Provider "${providerId}" is not configured. Add it under "provider" in the Settings tab.`
    )
  }

  const options: Record<string, unknown> = { ...provider.options }

  /*
   * The model that runs on this machine is reached like any other
   * OpenAI-compatible endpoint, and the address is the one thing about it that
   * cannot be written down: the sidecar takes a free port each time it starts.
   * So the config holds `local://llama` and it is substituted here — which is
   * also what starts the server, since this is the moment it is about to be
   * used. The key is generated per start and never stored anywhere.
   */
  if (isLocalProvider(provider)) {
    const live = await ensureLocalModel()
    options.baseURL = live.baseURL
    options.apiKey = live.apiKey
    // Its own fetch, so a request counts as the model being used and the idle
    // timer does not stop a server in the middle of a long turn.
    options.fetch = live.fetch
  }

  // Keyed on the options as resolved, so a sidecar that came back on another
  // port is a different instance rather than a cached one pointing at a
  // port nothing is listening on any more.
  const key = `${providerId}:${JSON.stringify(options)}:${provider.npm}`
  const cached = cache.get(key)
  if (cached) return cached

  if (provider.npm === '@ai-sdk/openai-compatible') {
    options.name = provider.id
    // An OpenAI-compatible endpoint reports no token usage while streaming
    // unless the request asks for it, which is why the transcript had nothing
    // to count. Opt in unless the config says otherwise — a server that does
    // not understand stream_options ignores it.
    options.includeUsage = provider.options.includeUsage ?? true
  }

  let factory = FACTORIES[provider.npm]
  if (!factory) {
    const mod = (await import(/* @vite-ignore */ provider.npm)) as Record<string, unknown>
    const create = Object.entries(mod).find(
      ([name, value]) => name.startsWith('create') && typeof value === 'function'
    )?.[1] as Factory | undefined
    if (!create) throw new Error(`Package "${provider.npm}" exports no create* factory.`)
    factory = create
  }

  const instance = factory(options)
  cache.set(key, instance)
  return instance
}

/** Parses `provider/model` — model ids may themselves contain slashes. */
export function parseModelRef(ref: string): { providerId: string; modelId: string } {
  const slash = ref.indexOf('/')
  if (slash === -1) throw new Error(`Model "${ref}" must be written as "provider/model".`)
  return { providerId: ref.slice(0, slash), modelId: ref.slice(slash + 1) }
}

/** Requests one provider key may have in flight at once (Helmcode allows 5 per key). */
export const DEFAULT_MAX_CONCURRENT = 4

const gates = new Map<string, { active: number; waiting: (() => void)[] }>()

/** Waits for a slot; the returned function gives it back, once. A freed slot goes straight to the next waiter. */
// ponytail: a request aborted while queued still takes its slot and frees it at once; fine at these queue sizes.
function acquire(key: string, limit: number): Promise<() => void> {
  const gate = gates.get(key) ?? { active: 0, waiting: [] }
  gates.set(key, gate)
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    const next = gate.waiting.shift()
    if (next) next()
    else gate.active--
  }
  if (gate.active < limit) {
    gate.active++
    return Promise.resolve(release)
  }
  return new Promise((resolve) => gate.waiting.push(() => resolve(release)))
}

function releasing<T>(source: ReadableStream<T>, release: () => void): ReadableStream<T> {
  const reader = source.getReader()
  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          release()
          controller.close()
        } else controller.enqueue(value)
      } catch (error) {
        release()
        controller.error(error)
      }
    },
    cancel(reason) {
      release()
      return reader.cancel(reason)
    }
  })
}

/** Every call through this model — turns, subagents, compaction, the scheduler's judge — shares the provider's slots. */
function limited(model: LanguageModel, providerId: string, limit: number): LanguageModel {
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]['model'],
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        const release = await acquire(providerId, limit)
        try {
          return await doGenerate()
        } finally {
          release()
        }
      },
      wrapStream: async ({ doStream }) => {
        const release = await acquire(providerId, limit)
        try {
          const result = await doStream()
          return { ...result, stream: releasing(result.stream, release) }
        } catch (error) {
          release()
          throw error
        }
      }
    }
  })
}

const limitFor = (config: AppConfig, providerId: string): number =>
  Math.max(1, config.provider[providerId]?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT)

export async function resolveModel(config: AppConfig, ref: string): Promise<ResolvedModel> {
  const resolved = await resolveUnlimited(config, ref)
  return {
    ...resolved,
    model: limited(resolved.model, resolved.providerId, limitFor(config, resolved.providerId))
  }
}

async function resolveUnlimited(config: AppConfig, ref: string): Promise<ResolvedModel> {
  const overridden = overrideResolver?.(ref)
  if (overridden) return overridden

  const { providerId, modelId } = parseModelRef(ref)
  const provider = await providerFor(config, providerId)
  const declared = config.provider[providerId]?.models[modelId]
  const apiKey = config.provider[providerId]?.options.apiKey

  if (!apiKey && config.provider[providerId]?.npm !== '@ai-sdk/openai-compatible') {
    // Other providers read their own env vars; only warn for compat providers below.
  }
  const localProvider = config.provider[providerId]
    ? isLocalProvider(config.provider[providerId])
    : false

  // A local server needs no key from anybody: it is handed a fresh one at
  // every start, which `providerFor` above has already injected.
  if (!apiKey && !localProvider && config.provider[providerId]?.npm === '@ai-sdk/openai-compatible') {
    /*
     * Never the value, and never a guess at the cause. This used to say "make
     * sure that environment variable is exported" whatever the placeholder
     * said — so a key sitting in the keychain that this build cannot read,
     * which is what happens when the packaged app stored it and a dev run is
     * asking, sent people looking for a variable that was never involved.
     */
    // The placeholder this provider's key is written as, read from the config
    // before expansion — not from a process-wide list, which would quote
    // another provider's missing variable at whoever's key is actually empty.
    const raw = loadConfig().provider[providerId]?.options.apiKey
    const placeholder = typeof raw === 'string' && raw.includes('{') ? raw : null
    const detail =
      placeholder
        ? `Its apiKey reads ${placeholder}, which came back empty. A {secret:…} is ` +
          `encrypted against the application binary, so a key stored by the packaged app cannot ` +
          `be read by a dev build or the other way round — re-enter it under Settings → Models & ` +
          `providers, or point apiKey at {env:VAR} or {file:~/path} instead. An {env:VAR} has to ` +
          `be exported where OpenDesktop itself is launched, which for a Finder launch means a ` +
          `file your login shell reads.`
        : 'Its apiKey is empty. Set it under Settings → Models & providers.'
    throw new Error(`No API key for provider "${providerId}". ${detail}`)
  }

  return {
    providerId,
    modelId,
    label: declared?.name ?? modelId,
    model: provider(modelId),
    contextWindow: declared?.contextWindow
  }
}

export function invalidateProviderCache(): void {
  cache.clear()
}

/** Every `provider/model` pair the config declares, for the model picker. */
export function listModels(config: AppConfig): { ref: string; label: string; provider: string }[] {
  const out: { ref: string; label: string; provider: string }[] = []
  for (const provider of Object.values(config.provider)) {
    for (const model of Object.values(provider.models)) {
      out.push({ ref: `${provider.id}/${model.id}`, label: model.name, provider: provider.name })
    }
  }
  return out
}
