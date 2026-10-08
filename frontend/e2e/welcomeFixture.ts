import {TERMS_VERSION} from '../src/ui/terms';
import type { Page } from '@playwright/test';

/** Existing gameplay tests acknowledge onboarding only. This never opts into analytics. */
export async function acceptWelcomeBeforeLoad(page:Page):Promise<void> {
  await page.addInitScript(version=>{
    localStorage.setItem('pool:welcome',JSON.stringify({version,accepted:true}));
  },TERMS_VERSION);
}

/** Wait for the visible opening toss without bypassing gameplay or selecting a winner. */
export async function waitForOpening(page:Page):Promise<void> {
  await page.waitForFunction(()=>{const game=(window as any).__pool;return !!game&&!game.openingBusy;});
}
