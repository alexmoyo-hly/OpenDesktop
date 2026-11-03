import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    pool: 'forks',
    testTimeout: 20_000
  }
})
