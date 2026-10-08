import {TERMS_VERSION} from '../src/ui/terms';
import type { Page } from '@playwright/test';

/** Existing gameplay tests acknowledge onboarding only. This never opts into analytics. */
export async function acceptWelcomeBeforeLoad(page:Page):Promise<void> {
  // Mocked gameplay suites must not inherit an unrelated local backend's Terms.
  // Account/consent tests can override this route with their own server state.
  await page.route('**/api/privacy/terms',route=>route.fulfill({json:{
    version:TERMS_VERSION,accepted:false,authenticated:false,accountId:null,
  }}));
  await page.addInitScript(version=>{
    localStorage.setItem('pool:welcome',JSON.stringify({version,accepted:true}));
  },TERMS_VERSION);
}

/** Wait for the visible opening toss without bypassing gameplay or selecting a winner. */
export async function waitForOpening(page:Page):Promise<void> {
  await page.waitForFunction(()=>{const game=(window as any).__pool;return !!game&&!game.openingBusy;});
}
