import {test,expect,type Page} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
const keys=['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
async function code(page:Page){await page.locator('canvas').first().focus();for(const key of keys)await page.keyboard.press(key);}
test.beforeEach(async({page})=>{
  await acceptWelcomeBeforeLoad(page);
  await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
  await page.route('**/api/opponents/jev',route=>route.fulfill({json:{available:false}}));
});
test('unlock requires backend success and saved preference survives reload without leaking on logout',async({page})=>{
  let account:any={id:'a',username:'Player',createdAt:1,premium:false,isAdmin:false,easterEggsEnabled:false,chalkSim:false};
  let fail=true,unlocks=0;
  await page.route('**/api/account',route=>route.fulfill({json:{account,stats:null}}));
  await page.route('**/api/account/easter-eggs/unlock',route=>{
    unlocks++;if(fail)return route.fulfill({status:503,json:{detail:'Try again'}});
    account={...account,easterEggsEnabled:true};return route.fulfill({json:{account}});
  });
  await page.route('**/api/account/preferences',route=>{account={...account,...route.request().postDataJSON()};return route.fulfill({json:{account}});});
  await page.route('**/api/account/logout',route=>{account=null;return route.fulfill({json:{account:null}});});
  await page.goto('/');await expect(page.locator('#accountidentityname')).toHaveText('Player');
  await code(page);await expect.poll(()=>unlocks).toBe(1);await expect(page.locator('#eastereggsdialog')).not.toBeVisible();await expect(page.locator('#eastereggssettings')).toBeHidden();
  fail=false;await code(page);await expect(page.getByRole('heading',{name:'Easter eggs unlocked'})).toBeVisible();
  await page.getByRole('button',{name:'Open Settings',exact:true}).click();
  await expect(page.locator('#chalksimenabled')).not.toBeChecked();await page.locator('#chalksimenabled').check();
  await expect.poll(()=>account.chalkSim).toBe(true);await expect(page.locator('#chalksimenabled')).toBeChecked();
  await page.reload();await expect(page.locator('#accountidentityname')).toHaveText('Player');await page.locator('#settingsbtn').click();await page.locator('#eastereggssettings summary').click();await expect(page.locator('#chalksimenabled')).toBeChecked();
  await page.locator('#accountidentity').click();await page.locator('#accountlogout').click();await expect(page.locator('#eastereggssettings')).toBeHidden();
});
test('guest code invites sign in without sending unlock, and typing in a dialog is ignored',async({page})=>{
  let unlocks=0;await page.route('**/api/account',route=>route.fulfill({json:{account:null,stats:null}}));
  await page.route('**/api/account/easter-eggs/unlock',route=>{unlocks++;return route.fulfill({status:401,json:{detail:'Sign in'}});});
  await page.goto('/');await page.locator('#accountidentity').click();await page.locator('#accountusername').focus();
  for(const key of keys)await page.keyboard.press(key);
  await expect(page.locator('#eastereggsdialog')).not.toBeVisible();await page.locator('#accountclose').click();
  await code(page);await expect(page.getByRole('heading',{name:'Sign in to unlock Easter eggs'})).toBeVisible();expect(unlocks).toBe(0);await expect(page.locator('#eastereggssettings')).toBeHidden();
  await page.keyboard.press('Escape');await expect(page.locator('#eastereggsdialog')).not.toBeVisible();await expect(page.locator('canvas').first()).toBeFocused();
});
for(const mobile of [false,true])test.describe(mobile?'mobile unlock presentation':'desktop unlock presentation',()=>{
 test.use(mobile?{viewport:{width:390,height:844},hasTouch:true,isMobile:true}:{viewport:{width:1280,height:900}});
 test('unlock dialog and chalk setting fit the screen',async({page},testInfo)=>{
  let account={id:'visual',username:'ChalkPlayer',createdAt:1,premium:false,isAdmin:false,easterEggsEnabled:false,chalkSim:false};
  await page.route('**/api/account',r=>r.fulfill({json:{account,stats:null}}));
  await page.route('**/api/account/easter-eggs/unlock',r=>{account={...account,easterEggsEnabled:true};return r.fulfill({json:{account}});});
  await page.goto('/');await expect(page.locator('#accountidentityname')).toHaveText('ChalkPlayer');await code(page);
  await expect(page.locator('#eastereggsdialog')).toBeVisible();await page.screenshot({path:testInfo.outputPath('unlock.png')});
  const dialog=(await page.locator('#eastereggsdialog').boundingBox())!;expect(dialog.x).toBeGreaterThanOrEqual(0);expect(dialog.width).toBeLessThanOrEqual(mobile?390:1280);
  await page.getByRole('button',{name:'Open Settings',exact:true}).click();await expect(page.locator('#chalksimenabled')).toBeVisible();await expect(page.locator('#chalksimenabled')).not.toBeChecked();await page.screenshot({path:testInfo.outputPath('chalk-settings.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(mobile?390:1280);
 });
});
test('preference failure rolls the checkbox back and leaves gameplay disabled',async({page})=>{
 const account={id:'failed-save',username:'Player',createdAt:1,premium:false,isAdmin:false,easterEggsEnabled:true,chalkSim:false};
 await page.route('**/api/account',r=>r.fulfill({json:{account,stats:null}}));
 await page.route('**/api/account/preferences',r=>r.fulfill({status:503,json:{detail:'Could not save your setting'}}));
 await page.goto('/');await expect(page.locator('#accountidentityname')).toHaveText('Player');await page.locator('#settingsbtn').click();await page.locator('#eastereggssettings summary').click();
 await page.locator('#chalksimenabled').click();await expect(page.locator('#chalksimstatus')).toContainText('Could not save');await expect(page.locator('#chalksimenabled')).not.toBeChecked();await expect(page.locator('#chalksimenabled')).toBeEnabled();await expect(page.locator('#chalkcontrols')).toBeHidden();
});
