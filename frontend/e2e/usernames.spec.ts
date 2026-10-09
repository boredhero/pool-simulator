import {test,expect} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
for(const mobile of [false,true])test.describe(mobile?'mobile username':'desktop username',()=>{
 if(mobile)test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 test('availability, conflict, rename and cooldown are usable and preserve identity',async({page})=>{
  await acceptWelcomeBeforeLoad(page);
  await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-09',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
  let account:any={id:'same-account',username:'Before',createdAt:1,premium:true,isAdmin:false,usernameChangedAt:null,usernameChangeAvailableAt:null};
  await page.route('**/api/account',r=>r.fulfill({json:{account,stats:null}}));
  await page.route('**/api/account/passkeys',r=>r.fulfill({json:{passkeys:[],recentlyVerified:true}}));
  await page.route('**/api/account/username/availability?*',r=>r.fulfill({json:{available:new URL(r.request().url()).searchParams.get('username')!=='Taken'}}));
  await page.route('**/api/account/username',r=>{
   const name=r.request().postDataJSON().username;
   if(name==='Taken')return r.fulfill({status:409,json:{detail:'That username is already taken. Choose another.'}});
   const now=Math.floor(Date.now()/1000);account={...account,username:name,usernameChangedAt:now,usernameChangeAvailableAt:now+365*86400};
   return r.fulfill({json:{account}});
  });
  await page.goto('/');await page.locator('#accountidentity').click();await page.locator('#account-tab-profile').click();
  await page.locator('#newusername').fill('Taken');await expect(page.locator('#usernameavailability')).toHaveText('That username is already taken.');
  await page.locator('#usernamechange').click();await expect(page.locator('#accountstatus')).toContainText('already taken');await expect(page.locator('#usernamechange')).toBeEnabled();
  await page.locator('#newusername').fill('After');await expect(page.locator('#usernameavailability')).toHaveText('Available.');
  await page.locator('#usernamechange').click();await expect(page.locator('#accountname')).toHaveText('After');await expect(page.locator('#usernamechange')).toBeDisabled();await expect(page.locator('#usernamecooldown')).toContainText('again on');
  await expect(page.locator('#accountpremium')).toBeVisible();expect(account.id).toBe('same-account');
  await page.locator('#accountclose').click();await expect(page.locator('#accountidentityname')).toHaveText('After');await page.locator('#accountidentity').click();await page.locator('#account-tab-profile').click();await expect(page.locator('#newusername')).toBeDisabled();
  const width=mobile?390:1280;expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 });
});
