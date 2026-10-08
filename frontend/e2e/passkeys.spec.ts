import {test,expect,type Page} from '@playwright/test';
import {TERMS_VERSION} from '../src/ui/terms';
const password='a long test passphrase for pool';
test.afterEach(async({page})=>{await page.unrouteAll({behavior:'wait'});});
async function prepare(page:Page){
 await page.addInitScript(version=>{
  localStorage.setItem('pool:welcome',JSON.stringify({version,accepted:true}));
  localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));
  // Exercise the explicit button deterministically; separate coverage checks conditional UI.
  PublicKeyCredential.isConditionalMediationAvailable=async()=>false;
  const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});
 },TERMS_VERSION);
 const cdp=await page.context().newCDPSession(page);await cdp.send('WebAuthn.enable');
 const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 return {cdp,authenticatorId};
}
async function signup(page:Page){
 await page.goto('/');await page.locator('#accountidentity').click();await page.locator('#account-register').click();
 await page.locator('#accountusername').fill('Key_'+Math.random().toString(36).slice(2,12));
 await page.locator('#accountpassword').fill(password);await page.locator('#accountpasswordconfirm').fill(password);
 await page.locator('#registeradult').check();await page.locator('#accountsubmit').click();
 await expect(page.locator('#recoverypanel')).toBeVisible();
 await expect(page.locator('#passkeyoffer')).toBeHidden();
 await page.locator('#recoverysaved').click();await expect(page.locator('#passkeyoffer')).toBeVisible();
}
for(const mobile of [false,true])test.describe(mobile?'mobile passkeys':'desktop passkeys',()=>{
 if(mobile)test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 test('optional signup offer, multiple keys, rename, sign-in and removal use the real backend',async({page},testInfo)=>{
  const {cdp,authenticatorId}=await prepare(page);await signup(page);
  await page.locator('#passkeyskip').click();await expect(page.locator('#passkeyoffer')).toBeHidden();
  await page.locator('#passkeyname').fill('First device');await page.locator('#passkeyadd').click();
  await expect(page.locator('#passkeylist')).toContainText('First device');
  const first=await cdp.send('WebAuthn.getCredentials',{authenticatorId});expect(first.credentials).toHaveLength(1);
  await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId});
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  await page.locator('#passkeyname').fill('Second device');await page.locator('#passkeyadd').click();
  await expect(page.locator('.passkey-item')).toHaveCount(2);
  await page.getByRole('button',{name:'Rename Second device',exact:true}).click();
  await page.locator('.passkey-edit:visible input').fill('Work laptop');await page.getByRole('button',{name:'Save name',exact:true}).click();
  await expect(page.locator('#passkeylist')).toContainText('Work laptop');
  await page.locator('#passkeys').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('passkey-settings.png')});
  await page.locator('#accountlogout').click();await expect(page.locator('#passkeylogin')).toBeVisible();
  await expect(page.locator('#accountusername')).toHaveAttribute('autocomplete','username webauthn');
  await page.locator('#accountusername').fill('');await page.locator('#passkeylogin').click();
  await expect(page.locator('#accountprofile')).toBeVisible();
  await expect(page.locator('#passkeylist')).toContainText('Last used');
  await page.getByRole('button',{name:'Remove First device',exact:true}).click();
  await page.getByRole('button',{name:'Confirm removal',exact:true}).click();await expect(page.locator('.passkey-item')).toHaveCount(1);
  await page.locator('#accountclose').click();await page.locator('#settingsbtn').click();await page.locator('#settingspasskeys').click();
  await expect(page.locator('#passkeystitle')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(mobile?390:1280);
 });
});

test('signup offer enrolls without requiring a second password',async({page})=>{
 await prepare(page);await signup(page);await page.locator('#passkeyofferadd').click();
 await expect(page.locator('.passkey-item')).toHaveCount(1);await expect(page.locator('#passkeyoffer')).toBeHidden();await expect(page.locator('#passkeyverify')).toBeHidden();
});

test('cancelled device prompt leaves password login available',async({page})=>{
 await prepare(page);
 await page.addInitScript(()=>{navigator.credentials.get=async()=>{throw new DOMException('Cancelled','NotAllowedError');};});
 await page.goto('/');await page.locator('#accountidentity').click();await page.locator('#passkeylogin').click();
 await expect(page.locator('#accountstatus')).toContainText('No changes made');await expect(page.locator('#accountsubmit')).toBeEnabled();await expect(page.locator('#accountpassword')).toBeVisible();
});

test('conditional autofill is requested and cancelled when switching forms',async({page})=>{
 await prepare(page);
 await page.addInitScript(()=>{
  PublicKeyCredential.isConditionalMediationAvailable=async()=>true;
  navigator.credentials.get=(options:any)=>new Promise((_resolve,reject)=>{
   (window as any).__mediation=options.mediation;
   options.signal?.addEventListener('abort',()=>{(window as any).__aborted=true;reject(new DOMException('Cancelled','AbortError'));});
  });
 });
 await page.goto('/');await page.locator('#accountidentity').click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__mediation)).toBe('conditional');
 await page.locator('#account-register').click();await expect.poll(()=>page.evaluate(()=>(window as any).__aborted)).toBe(true);
 await expect(page.locator('#passkeylogin')).toBeHidden();
});

test('expired verification offers password or existing passkey and clears the password',async({page})=>{
 await prepare(page);await signup(page);await page.locator('#passkeyofferadd').click();await expect(page.locator('.passkey-item')).toHaveCount(1);
 let fresh=false;
 await page.route('**/api/account/passkeys',async route=>{const r=await route.fetch();const d=await r.json();await route.fulfill({response:r,json:{...d,recentlyVerified:fresh}});});
 await page.route('**/api/account/passkeys/reauth/password',async route=>{const r=await route.fetch();if(r.ok())fresh=true;await route.fulfill({response:r});});
 await page.getByRole('button',{name:'Rename My passkey',exact:true}).click();await page.locator('.passkey-edit:visible input').fill('Renamed key');await page.getByRole('button',{name:'Save name'}).click();
 await expect(page.locator('#passkeyverify')).toBeVisible();await expect(page.locator('#passkeyverifykey')).toBeVisible();
 await page.locator('#passkeypassword').fill('wrong');await page.getByRole('button',{name:'Verify password',exact:true}).click();await expect(page.locator('#passkeystatus')).toContainText('Password is incorrect');await expect(page.locator('#passkeypassword')).toHaveValue('');
 await page.locator('#passkeypassword').fill(password);await page.getByRole('button',{name:'Show verification password'}).click();await expect(page.locator('#passkeypassword')).toHaveAttribute('type','text');await page.getByRole('button',{name:'Verify password',exact:true}).click();
 await expect(page.locator('#passkeyverify')).toBeHidden();await expect(page.locator('#passkeylist')).toContainText('Renamed key');await expect(page.locator('#passkeypassword')).toHaveValue('');await expect(page.locator('#passkeypassword')).toHaveAttribute('type','password');
});

test('switching from pending autofill to the button shares browser-binding options',async({page})=>{
 await prepare(page);
 await page.addInitScript(()=>{
  PublicKeyCredential.isConditionalMediationAvailable=async()=>true;
  navigator.credentials.get=()=>new Promise((_resolve,reject)=>{(window as any).__nativeStarted=true;(window as any).__cancelNative=()=>reject(new DOMException('Cancelled','NotAllowedError'));});
 });
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let requests=0;
 await page.route('**/api/account/passkeys/login/options',async route=>{requests++;await gate;await route.continue();});
 await page.goto('/');await page.locator('#accountidentity').click();await expect.poll(()=>requests).toBe(1);
 await page.locator('#passkeylogin').click();release();
 await expect.poll(()=>page.evaluate(()=>(window as any).__nativeStarted)).toBe(true);
 expect(requests).toBe(1);
 await page.evaluate(()=>{PublicKeyCredential.isConditionalMediationAvailable=async()=>false;(window as any).__cancelNative();});
 await expect(page.locator('#accountsubmit')).toBeEnabled();
});
