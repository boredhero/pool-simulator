import {test,expect,type Page} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
const identity={id:'preferences',username:'Player',createdAt:1,premium:false,isAdmin:false};
async function prepare(page:Page){
  await acceptWelcomeBeforeLoad(page);
  await page.addInitScript(()=>{localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));localStorage.setItem('pool:felt','#112233');localStorage.setItem('pool:cameraInput','mouse');const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const game=(window as any).__pool;if(game)game.scene.renderer.render=()=>{};cb(t);});});
  await page.route('**/api/version',r=>r.fulfill({json:{version:'test'}}));
  await page.route('**/api/opponents/jev',r=>r.fulfill({json:{available:false}}));
}
test('account settings hydrate a fresh device and logout restores guest settings',async({page,browser})=>{
  let account:any={...identity,settings:{'pool:felt':'#aabbcc','pool:cameraInput':'trackpad','pool:auto-camera':'1'}};
  await prepare(page);await page.route('**/api/account',r=>r.fulfill({json:{account}}));
  await page.route('**/api/account/preferences',r=>{account.settings={...account.settings,...r.request().postDataJSON().settings};return r.fulfill({json:{account}});});
  await page.route('**/api/account/logout',r=>{account=null;return r.fulfill({json:{account:null}});});
  await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.locator('#accountidentityname')).toHaveText('Player');
  await expect(page.locator('#feltcustom')).toHaveValue('#aabbcc');await expect(page.locator('#camera-input-profile')).toHaveValue('trackpad');
  expect(await page.evaluate(()=>(window as any).__pool.options.autoCamera)).toBe(true);
  await page.evaluate(()=>{const felt=document.getElementById('feltcustom') as HTMLInputElement;felt.value='#445566';felt.dispatchEvent(new Event('input'));const wood=document.getElementById('woodcustom') as HTMLInputElement;wood.value='#778899';wood.dispatchEvent(new Event('input'));});
  await expect.poll(()=>account.settings['pool:felt']).toBe('#445566');await expect.poll(()=>account.settings['pool:wood']).toBe('#778899');
  expect(await page.evaluate(()=>localStorage.getItem('pool:felt'))).toBe('#112233');
  const second=await browser.newContext();const device=await second.newPage();await prepare(device);await device.route('**/api/account',r=>r.fulfill({json:{account}}));await device.goto(page.url(),{waitUntil:'domcontentloaded'});
  await expect(device.locator('#feltcustom')).toHaveValue('#445566');await expect(device.locator('#woodcustom')).toHaveValue('#778899');await expect(device.locator('#camera-input-profile')).toHaveValue('trackpad');await second.close();
  await page.evaluate(()=>{(document.getElementById('accountidentity') as HTMLElement).click();});await page.locator('#accountlogout').click();
  await expect(page.locator('#accountidentityname')).toHaveText('Sign in');await expect(page.locator('#feltcustom')).toHaveValue('#112233');await expect(page.locator('#camera-input-profile')).toHaveValue('mouse');
});
test('failed settings saves remain visible and can be retried',async({page})=>{
  const account={...identity,settings:{} as Record<string,string>};let fail=true;
  await prepare(page);await page.route('**/api/account',r=>r.fulfill({json:{account}}));
  await page.route('**/api/account/preferences',r=>{if(fail)return r.fulfill({status:503,json:{detail:'Unavailable'}});Object.assign(account.settings,r.request().postDataJSON().settings);return r.fulfill({json:{account}});});
  await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.locator('#accountidentityname')).toHaveText('Player');await page.locator('#settingsbtn').click();
  await page.evaluate(()=>{const field=document.getElementById('fastforward') as HTMLInputElement;field.checked=true;field.dispatchEvent(new Event('change'));});
  await expect(page.locator('#preferencesstatus')).toBeVisible();fail=false;await page.locator('#preferencesstatus button').click();await expect(page.locator('#preferencesstatus')).toBeHidden();expect(account.settings['pool:fast-forward']).toBe('1');
});
