import {test,expect,type Page} from '@playwright/test';
import {TERMS_VERSION} from '../src/ui/terms';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
const account={id:'player',username:'player',createdAt:1,premium:true,isAdmin:false};
const stats={matches:0,wins:0,losses:0,abandoned:0,shots:0,ballsPocketed:0,scratches:0,fouls:0,recent:[]};
test.beforeEach(async({page})=>{
 await acceptWelcomeBeforeLoad(page);
 await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
 await page.route('**/api/account',r=>r.fulfill({json:{account,stats}}));
 await page.route('**/api/version',r=>r.fulfill({json:{version:'e2e'}}));
 await page.route('**/api/opponents/jev',r=>r.fulfill({json:{available:false}}));
});
async function openAccount(page:Page){await page.goto('/');await page.locator('#accountidentity').click();}
test('accepted backend terms stay hidden on reopening and reload',async({page})=>{
 await page.route('**/api/privacy/terms',r=>r.fulfill({json:{version:TERMS_VERSION,accepted:true,authenticated:true}}));
 await openAccount(page);await expect(page.locator('#accounttermsstatus')).toHaveText('Current Terms accepted.');await expect(page.locator('#termsupdate')).toBeHidden();
 await page.locator('#accountclose').click();await page.locator('#accountidentity').click();await expect(page.locator('#termsupdate')).toBeHidden();await page.reload();await page.locator('#accountidentity').click();await expect(page.locator('#accounttermsstatus')).toHaveText('Current Terms accepted.');
});
test('changed terms require explicit acceptance and controls clear the stats',async({page})=>{
 let accepted=true,version=TERMS_VERSION;const next='b'.repeat(64);const posted:string[]=[];
 await page.route('**/api/privacy/terms',r=>{if(r.request().method()==='POST'){const data=r.request().postDataJSON();posted.push(data.version);accepted=true;return r.fulfill({json:{accepted:data.version}});}return r.fulfill({json:{version,accepted,authenticated:true}});});
 await openAccount(page);await expect(page.locator('#accounttermsstatus')).toHaveText('Current Terms accepted.');accepted=false;version=next;
 await page.locator('#accountclose').click();await page.locator('#accountidentity').click();await expect(page.locator('#termsupdate')).toBeVisible();await expect(page.locator('#termsadult')).not.toBeChecked();
 const checkbox=(await page.locator('#termsadult').boundingBox())!,button=(await page.locator('#acceptterms').boundingBox())!,grid=(await page.locator('#accountstats').boundingBox())!;expect(checkbox.width).toBe(22);expect(checkbox.height).toBe(22);expect(grid.y-button.y-button.height).toBeGreaterThanOrEqual(20);
 await page.locator('#termsadult').check();await page.locator('#acceptterms').click();await expect(page.locator('#termsupdate')).toBeHidden();expect(posted).toEqual([next]);
});
test('registration sends current content hash and never asks again after recovery saved',async({page})=>{
 let signedIn=false;
 await page.route('**/api/account',r=>r.fulfill({json:{account:signedIn?account:null,stats}}));
 await page.route('**/api/privacy/terms',r=>r.fulfill({json:{version:TERMS_VERSION,accepted:signedIn,authenticated:signedIn}}));
 await page.route('**/api/account/register',r=>{expect(r.request().postDataJSON().terms_version).toBe(TERMS_VERSION);signedIn=true;return r.fulfill({json:{account,recovery:'a-recovery-code'}});});
 await openAccount(page);await page.locator('#account-register').click();await page.locator('#accountusername').fill('player');await page.locator('#accountpassword').fill('a-long-enough-password');await page.locator('#registeradult').check();await page.locator('#accountsubmit').click();await page.locator('#recoverysaved').click();await expect(page.locator('#accounttermsstatus')).toHaveText('Current Terms accepted.');await expect(page.locator('#termsupdate')).toBeHidden();
});
test('unavailable status cannot submit a guessed agreement',async({page})=>{
 await page.route('**/api/privacy/terms',r=>r.fulfill({status:503,json:{}}));await openAccount(page);await expect(page.locator('#accounttermsstatus')).toContainText('unavailable');await expect(page.locator('#termsupdate')).toBeHidden();
});
