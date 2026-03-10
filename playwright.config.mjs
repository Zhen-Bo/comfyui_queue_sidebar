import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.mjs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8188',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
})
