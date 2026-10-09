import {test,expect} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
async function prepare(page:import('@playwright/test').Page,allow=false,signal=false){
 await acceptWelcomeBeforeLoad(page);
 await page.addInitScript(({allow,signal})=>{
  localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow}));localStorage.setItem('pool:help-dismissed','1');
  Object.defineProperty(navigator,'globalPrivacyControl',{value:signal});
  const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});
 },{allow,signal});
 await page.route('**/api/privacy/consent',r=>r.fulfill({json:{analytics:r.request().postDataJSON().allow}}));
 await page.goto('/');await page.waitForFunction(()=>!!(window as any).__pool);
 await page.evaluate(()=>document.getElementById('privacybtn')!.click());
}
test('privacy shows saved choice, prevents duplicate saves and retries after failure',async({page})=>{
 await prepare(page,true);await expect(page.locator('#privacystatus')).toContainText('optional analytics allowed');
 let calls=0;let finish:()=>void=()=>{};const pending=new Promise<void>(resolve=>finish=resolve);
 await page.route('**/api/privacy/consent',async r=>{calls++;await pending;await r.fulfill({status:503,json:{}});});
 await page.locator('#privacyreject').click();await expect(page.locator('#privacyaccept')).toBeDisabled();await expect(page.locator('#privacyreject')).toBeDisabled();
 await page.locator('#privacyreject').evaluate((b:HTMLButtonElement)=>b.click());await expect.poll(()=>calls).toBe(1);finish();
 await expect(page.locator('#privacystatus')).toContainText('Please try again');await expect(page.locator('#privacyreject')).toBeEnabled();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pool:privacy')!).allow)).toBe(false);
 await page.route('**/api/privacy/consent',r=>r.fulfill({json:{analytics:false}}));
 await page.locator('#privacyreject').click();await expect(page.locator('#privacychoices')).toBeHidden();
 await page.locator('#privacybtn').click();await expect(page.locator('#privacystatus')).toContainText('essential only');
});
test('privacy signal explains why analytics cannot be enabled',async({page})=>{
 await prepare(page,true,true);await expect(page.locator('#privacystatus')).toContainText('browser privacy signal');await expect(page.locator('#privacyaccept')).toBeDisabled();await expect(page.locator('#privacyreject')).toBeEnabled();
});
test.describe('mobile camera focus',()=>{
 test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 test('camera tray entry and return retain keyboard focus',async({page})=>{
  await prepare(page);await page.locator('#privacyclose').click();
  await page.locator('#mobile-move-camera').click();await expect(page.locator('#camera-fly-toggle')).toBeFocused();
  await page.locator('#camera-fly-toggle').click();await expect(page.locator('#mobile-move-camera')).toBeFocused();
 });
});
