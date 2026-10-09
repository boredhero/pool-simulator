import {test,expect} from '@playwright/test';
import {TERMS_VERSION} from '../src/ui/terms';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
for(const mobile of [false,true])test.describe(mobile?'mobile settings layout':'desktop settings layout',()=>{
 if(mobile)test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 test('account sections support keyboard navigation and settings expose grouped controls',async({page},testInfo)=>{
  await acceptWelcomeBeforeLoad(page);
  await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
  await page.route('**/api/account',r=>r.fulfill({json:{account:{id:'account',username:'Player',createdAt:1,premium:true,isAdmin:false},stats:{matches:8,wins:5,losses:3,abandoned:0,shots:42,ballsPocketed:22,scratches:1,fouls:2,recent:[]}}}));
  await page.route('**/api/privacy/terms',r=>r.fulfill({json:{version:TERMS_VERSION,accepted:true,authenticated:true,accountId:'account'}}));
  await page.route('**/api/opponents/jev',r=>r.fulfill({json:{available:true,usage:{unlimited:true}}}));
  await page.route('**/api/account/passkeys',r=>r.fulfill({json:{passkeys:[],recentlyVerified:true}}));
  await page.route('**/api/account/google',r=>r.fulfill({json:{enabled:true,linked:false}}));
  await page.goto('/');await page.locator('#accountidentity').click();
  await expect(page.getByRole('tab',{name:'Overview'})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#accountstats')).toBeVisible();await expect(page.locator('#newusername')).toBeHidden();
  await page.screenshot({path:testInfo.outputPath('account-overview.png')});
  await page.getByRole('tab',{name:'Overview'}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Sign-in',exact:true})).toBeFocused();await expect(page.locator('#passkeys')).toBeVisible();
  await page.keyboard.press('End');await expect(page.locator('#newusername')).toBeVisible();
  await page.keyboard.press('Home');await expect(page.locator('#accountstats')).toBeVisible();
  await page.locator('#accountclose').click();await page.locator('#settingsbtn').click();
  await expect(page.locator('#rulespreset')).toBeVisible();await expect(page.locator('#rulefields')).toBeHidden();await page.locator('#rule-details-toggle').click();await expect(page.locator('#rulefields')).toBeVisible();await page.locator('#rulespreset').selectOption('custom');await expect(page.locator('#rulefields')).toBeVisible();await expect(page.locator('#rule-details-toggle')).toBeHidden();await page.locator('#rulespreset').selectOption('bar');await expect(page.locator('#rulefields')).toBeHidden();await expect(page.locator('#cueappearance')).toBeHidden();
  await page.locator('summary').filter({hasText:'Appearance'}).click();await expect(page.locator('#cueappearance')).toBeVisible();await expect(page.locator('#settingspanel .settings-label').filter({hasText:'Felt'})).toBeVisible();
  await page.locator('#cueappearance').selectOption('red-spots');
  await page.screenshot({path:testInfo.outputPath('table-settings.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(mobile?390:1280);
 });
});
