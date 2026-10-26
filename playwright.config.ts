import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/desktop',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: 'test-results/desktop',
});
