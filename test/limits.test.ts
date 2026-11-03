import { MockLanguageModelV4 } from 'ai/test'
import { streamText, type LanguageModel } from 'ai'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { loadConfig } from '../src/main/config'
import * as providers from '../src/main/providers'
import { boot, finish } from './helpers'

beforeAll(boot)
afterEach(() => providers.setModelResolverOverride(null))

function slowModel(load: { now: number; max: number }, failFirst = false): LanguageModel {
  let calls = 0
  return new MockLanguageModelV4({
    doStream: async () => {
      calls++
      if (failFirst && calls === 1) throw new Error('boom')
      load.now++
      load.max = Math.max(load.max, load.now)
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            setTimeout(() => {
              load.now--
              controller.enqueue(finish('stop', { input: 1, output: 1 }))
              controller.close()
            }, 80)
          }
        })
      }
    }
  }) as unknown as LanguageModel
}

function configWithLimit(limit?: number) {
  const config = loadConfig()
  return {
    ...config,
    provider: {
      ...config.provider,
      p: { id: 'p', npm: '@ai-sdk/openai-compatible', name: 'P', options: {}, models: {}, maxConcurrent: limit }
    }
  }
}

async function burst(count: number, config: ReturnType<typeof configWithLimit>): Promise<void> {
  const { model } = await providers.resolveModel(config, 'p/m')
  await Promise.all(
    Array.from({ length: count }, async () => {
      const result = streamText({ model, prompt: 'x', maxRetries: 0 })
      await result.consumeStream()
    })
  )
}

test('a provider never has more requests in flight than its limit', async () => {
  const load = { now: 0, max: 0 }
  providers.setModelResolverOverride(() => ({ providerId: 'p', modelId: 'm', label: 'p/m', model: slowModel(load) }))
  await burst(6, configWithLimit(2))
  expect(load.max).toBe(2)
})

test('without a declared limit the default applies', async () => {
  const load = { now: 0, max: 0 }
  providers.setModelResolverOverride(() => ({ providerId: 'p', modelId: 'm', label: 'p/m', model: slowModel(load) }))
  await burst(8, configWithLimit())
  expect(load.max).toBe(providers.DEFAULT_MAX_CONCURRENT)
})

test('a request that fails gives its slot back', async () => {
  const load = { now: 0, max: 0 }
  providers.setModelResolverOverride(() => ({ providerId: 'p', modelId: 'm', label: 'p/m', model: slowModel(load, true) }))
  const config = configWithLimit(1)
  await burst(1, config).catch(() => undefined)
  await burst(3, config)
  expect(load.max).toBe(1)
})
