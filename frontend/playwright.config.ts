import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['pool.spec.ts', 'panels.spec.ts', 'admin.spec.ts'],
  fullyParallel: true,
  workers: process.env.CI ? 1 : 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 10_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: process.env.CI ? 'npx vite preview --port 4173 --strictPort --host 127.0.0.1' : 'npx vite --port 4173 --strictPort --host 127.0.0.1', port: 4173, reuseExistingServer: !process.env.CI },
});
