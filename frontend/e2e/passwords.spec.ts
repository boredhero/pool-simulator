import {test,expect,devices} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
const password='a long password for pool';
for(const mobile of [false,true])test.describe(mobile?'mobile passwords':'desktop passwords',()=>{
 if(mobile)test.use({viewport:devices['Pixel 7'].viewport,isMobile:true,hasTouch:true,deviceScaleFactor:devices['Pixel 7'].deviceScaleFactor,userAgent:devices['Pixel 7'].userAgent});
 test.beforeEach(async({page})=>{
  await acceptWelcomeBeforeLoad(page);
  await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-09',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
  await page.route('**/api/account',r=>r.fulfill({json:{account:null,stats:null}}));
  await page.goto('/');await page.locator('#accountidentity').click();
 });
 test('login has an accessible eye and hides secrets again on close or mode switch',async({page})=>{
  const input=page.locator('#accountpassword'),toggle=page.getByRole('button',{name:'Show password',exact:true});
  await expect(page.locator('#accountconfirmation')).toBeHidden();await expect(page.locator('#accountpasswordconfirm')).toBeDisabled();
  await input.fill(password);await toggle.click();await expect(input).toHaveAttribute('type','text');await expect(input).toHaveValue(password);
  const hide=page.getByRole('button',{name:'Hide password',exact:true});await expect(hide).toHaveAttribute('aria-pressed','true');expect((await hide.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await hide.focus();await page.keyboard.press('Enter');await expect(input).toHaveAttribute('type','password');
  await toggle.click();await page.locator('#accountclose').click();await page.locator('#accountidentity').click();await expect(input).toHaveAttribute('type','password');await expect(input).toHaveValue('');
  await input.fill(password);await toggle.click();await page.locator('#account-register').click();await expect(input).toHaveAttribute('type','password');await expect(input).toHaveValue('');
 });
 for(const mode of ['register','recover'] as const)test(`${mode} requires two matching entries and clears both after submission`,async({page})=>{
  const calls:any[]=[];await page.route(`**/api/account/${mode}`,r=>{calls.push(r.request().postDataJSON());return r.fulfill({json:{account:null,recovery:'replacement-recovery-code'}});});
  await page.locator(`#account-${mode}`).click();await page.locator('#accountusername').fill('Player');await page.locator('#accountpassword').fill(password);
  if(mode==='register')await page.locator('#registeradult').check();else await page.locator('#accountrecovery').fill('previous-recovery-code');
  const confirm=page.locator('#accountpasswordconfirm');await expect(confirm).toBeVisible();await expect(confirm).toHaveAttribute('autocomplete','new-password');
  await page.locator('#accountsubmit').click();expect(calls).toHaveLength(0);await expect(confirm).toBeFocused();
  await confirm.fill(password+' mismatch');await page.locator('#accountsubmit').click();expect(calls).toHaveLength(0);expect(await confirm.evaluate((e:HTMLInputElement)=>e.validationMessage)).toBe('Passwords do not match.');
  await page.getByRole('button',{name:'Show password confirmation',exact:true}).click();await expect(confirm).toHaveAttribute('type','text');
  await confirm.fill(password);await page.locator('#accountpassword').fill(password+' edited');await page.locator('#accountsubmit').click();expect(calls).toHaveLength(0);
  await page.locator('#accountpassword').fill(password);await page.locator('#accountsubmit').click();await expect.poll(()=>calls.length).toBe(1);expect(calls[0].password).toBe(password);
  await expect(confirm).toHaveValue('');await expect(confirm).toHaveAttribute('type','password');await expect(page.locator('#accountpassword')).toHaveValue('');
 });
});
