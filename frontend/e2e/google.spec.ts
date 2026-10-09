import {test,expect,type Page} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
import {TERMS_VERSION} from '../src/ui/terms';
async function prepare(page:Page){
 await acceptWelcomeBeforeLoad(page);
 await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-09',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
 const state={account:null as any,linked:false,finish:'signup',scripts:0,finishes:0,signupBody:null as any};
 await page.route('**/api/account',r=>r.fulfill({json:{account:state.account,stats:null}}));
 await page.route('**/api/account/passkeys',r=>r.fulfill({json:{passkeys:[],recentlyVerified:true}}));
 await page.route('**/api/account/google',r=>r.fulfill({json:{enabled:true,linked:state.linked}}));
 await page.route('**/api/account/google/start',r=>r.fulfill({json:{clientId:'test.apps.googleusercontent.com',nonce:'test-nonce',flow:'f'.repeat(64)}}));
 await page.route('**/api/account/google/finish',r=>{
  state.finishes++;
  if(state.finish==='signup')return r.fulfill({json:{signup:'s'.repeat(64)}});
  if(state.finish==='link'){state.linked=true;return r.fulfill({json:{linked:true}});}
  state.account={id:'same-account',username:'Returning',hasPassword:true,createdAt:1,premium:true,isAdmin:false};return r.fulfill({json:{account:state.account}});
 });
 await page.route('**/api/account/google/register',r=>{
  const body=r.request().postDataJSON();state.signupBody=body;
  if(body.username==='Taken')return r.fulfill({status:409,json:{detail:'That username is already in use.'}});
  state.account={id:'new-account',username:body.username,hasPassword:false,createdAt:1,premium:false,isAdmin:false};state.linked=true;
  return r.fulfill({json:{account:state.account,recovery:'TEST-RECOVERY-CODE'}});
 });
 await page.route('**/api/account/google/unlink',r=>{state.linked=false;return r.fulfill({json:{linked:false}});});
 await page.route('https://accounts.google.com/gsi/client',r=>{state.scripts++;return r.fulfill({contentType:'application/javascript',body:`window.google={accounts:{id:{initialize(options){window.googleOptions=options;window.googleCallback=options.callback},renderButton(element){const b=document.createElement('button');b.type='button';b.textContent='Choose test Google account';b.onclick=()=>window.googleCallback({credential:'test-credential'});element.append(b)},cancel(){}}}};`});});
 await page.goto('/');await page.locator('#accountidentity').click();return state;
}
for(const mobile of [false,true])test.describe(mobile?'mobile Google':'desktop Google',()=>{
 if(mobile)test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 test('signup accepts Terms, retries conflicts, saves recovery and offers passkey',async({page},testInfo)=>{
  const state=await prepare(page);await expect(page.locator('#googlelogin')).toBeVisible();expect(state.scripts).toBe(0);await page.screenshot({path:testInfo.outputPath('signin.png')});
  await page.locator('#googlelogin').click();await page.getByText('Choose test Google account',{exact:true}).click();await expect(page.locator('#googlesignup')).toBeVisible();await page.screenshot({path:testInfo.outputPath('google-signup.png')});
  expect(await page.evaluate(()=>(window as any).googleOptions.nonce)).toBe('test-nonce');
  await page.locator('#googleusername').fill('Taken');await page.locator('#googleadult').check();await page.getByRole('button',{name:'Create account with Google',exact:true}).click();await expect(page.locator('#accountstatus')).toContainText('already in use');
  await page.locator('#googleusername').fill('NewPlayer');await page.getByRole('button',{name:'Create account with Google',exact:true}).click();await expect(page.locator('#recoverypanel')).toBeVisible();await expect(page.locator('#accountclose')).toBeDisabled();
  expect(state.signupBody.terms_version).toBe(TERMS_VERSION);expect(state.signupBody.adult).toBe(true);expect(state.signupBody.password).toBeUndefined();
  await page.locator('#recoverysaved').click();await expect(page.locator('#passkeyoffer')).toBeVisible();await expect(page.locator('#accountname')).toHaveText('NewPlayer');await expect(page.locator('#googleunlink')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(mobile?390:1280);
 });
 test('login preserves identity and linking/unlinking requires deliberate actions',async({page})=>{
  const state=await prepare(page);state.finish='login';await page.locator('#googlelogin').click();await page.getByText('Choose test Google account',{exact:true}).click();await expect(page.locator('#accountname')).toHaveText('Returning');await expect(page.locator('#accountpremium')).toBeVisible();
  state.finish='link';await page.locator('#account-tab-signin').click();await page.locator('#googlelink').click();await page.getByText('Choose test Google account',{exact:true}).click();await expect(page.locator('#googleunlink')).toBeVisible();expect(state.account.id).toBe('same-account');
  await page.locator('#googleunlink').click();await expect(page.locator('#googleunlinkconfirm')).toBeVisible();expect(state.linked).toBe(true);await page.locator('#googleunlinkyes').click();await expect(page.locator('#googlelink')).toBeVisible();expect(state.linked).toBe(false);
 });
});
test('cancelled callback cannot change the account',async({page})=>{
 const state=await prepare(page);await page.locator('#googlelogin').click();await expect(page.getByText('Choose test Google account',{exact:true})).toBeVisible();await page.locator('#googlecancel').click();await expect(page.locator('#googlelogin')).toBeFocused();await page.evaluate(()=>(window as any).googleCallback({credential:'late'}));expect(state.finishes).toBe(0);await expect(page.locator('#accountauth')).toBeVisible();
});
test('script failure keeps password login usable',async({page})=>{
 await prepare(page);await page.route('https://accounts.google.com/gsi/client',r=>r.abort());await page.locator('#googlelogin').click();await expect(page.locator('#accountstatus')).toContainText('Google could not load');await expect(page.locator('#accountsubmit')).toBeEnabled();await page.locator('#googlecancel').click();await page.locator('#accountusername').fill('PasswordUser');await expect(page.locator('#accountpassword')).toBeVisible();
});

test('Google-only accounts receive a usable reauthentication instruction',async({page})=>{
 const state=await prepare(page);await expect(page.locator('#googlelogin')).toBeVisible();await page.locator('#accountclose').click();
 state.account={id:'google-only',username:'GoogleOnly',hasPassword:false,createdAt:1,premium:false,isAdmin:false};state.linked=true;
 await page.route('**/api/account/passkeys',r=>r.fulfill({json:{passkeys:[],recentlyVerified:false}}));
 await page.locator('#accountidentity').click();await expect(page.locator('#accountname')).toHaveText('GoogleOnly');await page.locator('#account-tab-signin').click();await page.locator('#passkeyadd').click();await expect(page.locator('#passkeystatus')).toContainText('sign back in with Google');await expect(page.locator('#passkeyverifyform')).toBeHidden();
});
