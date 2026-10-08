import {defineConfig,devices} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const database=join(mkdtempSync(join(tmpdir(),'pool-passkeys-')),'pool.db');
export default defineConfig({
 testDir:'./e2e',testMatch:'passkeys.spec.ts',workers:1,timeout:60000,
 use:{baseURL:'http://localhost:8013',trace:'retain-on-failure',screenshot:'only-on-failure',actionTimeout:10000},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
 webServer:{command:'uv run --offline --project ../backend uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8013',port:8013,reuseExistingServer:false,
 env:{DATABASE_URL:`sqlite:///${database}`,COOKIE_SECURE:'false',WEBAUTHN_ORIGIN:'http://localhost:8013',WEBAUTHN_RP_ID:'localhost',JEV_API_KEY:''}},
});
