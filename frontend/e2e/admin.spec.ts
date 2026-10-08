import { acceptWelcomeBeforeLoad } from './welcomeFixture';
import { expect, test } from '@playwright/test';

const usage={games:2,requests:12,input_tokens:1200,output_tokens:0,estimated_cost_nano:50400,unmetered_requests:1,last_activity:1780000000};
const owner={id:'owner',username:'god',createdAt:1780000000,premium:true,isAdmin:true};
test.beforeEach(async({page})=>{
  await acceptWelcomeBeforeLoad(page);
  await page.route('**/api/version',r=>r.fulfill({json:{version:'e2e'}}));
  await page.addInitScript(()=>{
    const raf=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});
  });
});
test('ordinary accounts never see or load owner tools',async({page})=>{
  let requests=0;
  await page.route('**/api/admin/**',r=>{requests++;return r.fulfill({status:404,json:{detail:'Not found'}});});
  await page.route('**/api/account',r=>r.fulfill({json:{account:{...owner,isAdmin:false},stats:null}}));
  await page.goto('/');await page.locator('#settingsbtn').click();
  await expect(page.locator('#accountbtn')).toHaveText('god · Account');
  await expect(page.locator('#adminbtn')).toBeHidden();expect(requests).toBe(0);
});
test('owner can inspect usage, recover a failed toggle, search and close the dashboard',async({page})=>{
  let premium=false, fail=true;
  await page.route('**/api/account',r=>r.fulfill({json:{account:owner,stats:null}}));
  await page.route('**/api/admin/**',async r=>{
    const url=new URL(r.request().url());
    if(url.pathname.endsWith('/overview'))return r.fulfill({json:{accounts:2,premium:1,usage,lifetimeAttempts:15}});
    if(r.request().method()==='PATCH'){
      expect(r.request().headers()['x-pool-request']).toBe('1');
      if(fail){fail=false;return r.fulfill({status:500,json:{}});}
      premium=r.request().postDataJSON().premium;return r.fulfill({json:{premium}});
    }
    if(url.pathname.endsWith('/accounts/player'))return r.fulfill({json:{lifetimeAttempts:15,lifetimeCompleted:12,games:[],audit:[]}});
    const accounts=url.searchParams.get('search')==='missing'?[]:[{id:'player',username:'Player <safe>',createdAt:1780000000,premium,isAdmin:false,usage}];
    return r.fulfill({json:{accounts,total:accounts.length}});
  });
  await page.goto('/');await page.locator('#settingsbtn').click();await page.locator('#adminbtn').click();
  const dialog=page.locator('#admindialog');await expect(dialog).toBeVisible();
  await expect(page.locator('#adminsummary')).toContainText('$0.000050');
  const toggle=dialog.getByRole('switch',{name:'Premium for Player <safe>'});
  await toggle.click();await expect(page.locator('#adminstatus')).toContainText('Could not complete');
  await expect(toggle).toHaveAttribute('aria-checked','false');await expect(toggle).toBeEnabled();
  await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','true');
  await dialog.getByRole('button',{name:'Usage details for Player <safe>'}).click();
  await expect(dialog).toContainText('15 lifetime attempts');
  await page.setViewportSize({width:390,height:844});
  const box=(await dialog.boundingBox())!;expect(box.width).toBeLessThanOrEqual(390);
  await page.locator('#adminsearch').fill('missing');await expect(page.locator('#adminempty')).toBeVisible();
  await page.locator('#adminclose').focus();await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.locator('#adminbtn')).toBeFocused();
});

test('owner can disable, re-enable and confirm deletion without owner self-actions',async({page})=>{
  let disabled=false,deleted=false,deleteCalls=0;
  await page.route('**/api/account',r=>r.fulfill({json:{account:owner,stats:null}}));
  await page.route('**/api/admin/**',r=>{
    const path=new URL(r.request().url()).pathname,method=r.request().method();
    if(path.endsWith('/overview'))return r.fulfill({json:{accounts:deleted?1:2,premium:1,usage,lifetimeAttempts:15}});
    if(method==='PATCH'){disabled=r.request().postDataJSON().disabled;return r.fulfill({json:{disabled}});}
    if(method==='DELETE'){expect(r.request().postDataJSON()).toEqual({username:'ManagedPlayer'});deleted=true;deleteCalls++;return r.fulfill({json:{deleted:true}});}
    return r.fulfill({json:{total:deleted?1:2,accounts:[{...owner,usage},...deleted?[]:[{id:'managed',username:'ManagedPlayer',createdAt:1780000000,premium:false,isAdmin:false,disabled,usage}]]}});
  });
  await page.goto('/');await page.locator('#settingsbtn').click();await page.locator('#adminbtn').click();
  const panel=page.locator('#admindialog');
  await expect(panel.getByRole('button',{name:'Delete account god',exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'Disable account ManagedPlayer',exact:true}).click();
  await expect(panel.locator('.admin-disabled-tag')).toHaveText('Disabled');
  await panel.getByRole('button',{name:'Re-enable account ManagedPlayer',exact:true}).click();
  await expect(panel.locator('.admin-disabled-tag')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await panel.getByRole('button',{name:'Delete account ManagedPlayer',exact:true}).click();
  const submit=panel.getByRole('button',{name:'Permanently delete',exact:true});
  await expect(submit).toBeDisabled();await panel.getByLabel('Type ManagedPlayer to confirm').fill('wrong');await expect(submit).toBeDisabled();
  await panel.getByRole('button',{name:'Cancel',exact:true}).click();expect(deleteCalls).toBe(0);
  await panel.getByRole('button',{name:'Delete account ManagedPlayer',exact:true}).click();
  await panel.getByLabel('Type ManagedPlayer to confirm').fill('ManagedPlayer');await submit.click();
  await expect(panel.getByRole('button',{name:'Delete account ManagedPlayer',exact:true})).toHaveCount(0);
  await expect(page.locator('#adminstatus')).toContainText('account deleted');expect(deleteCalls).toBe(1);
});
