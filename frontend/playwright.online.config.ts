import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const database=join(mkdtempSync(join(tmpdir(),'pool-online-tests-')),'pool.db');
export default defineConfig({
  testDir:'./e2e',testMatch:'online.spec.ts',workers:1,timeout:60000,
  use:{baseURL:'http://127.0.0.1:8011',trace:'retain-on-failure',screenshot:'only-on-failure',actionTimeout:10000},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
  webServer:[{command:'uv run --offline --project ../backend uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8011',port:8011,reuseExistingServer:false,env:{DATABASE_URL:`sqlite:///${database}`,COOKIE_SECURE:'false'}},
    {command:'npx vite --port 4174 --strictPort --host 127.0.0.1',port:4174,reuseExistingServer:false,env:{POOL_API_TARGET:'http://127.0.0.1:8011'}}],
});
