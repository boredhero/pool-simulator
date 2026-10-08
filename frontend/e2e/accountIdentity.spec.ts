import {acceptWelcomeBeforeLoad} from './welcomeFixture';
import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await acceptWelcomeBeforeLoad(page);
 await page.addInitScript(()=>{localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
 await page.route('**/api/version',r=>r.fulfill({json:{version:'e2e'}}));await page.route('**/api/opponents/jev',r=>r.fulfill({json:{available:false}}));
});
for(const viewport of [{width:1440,height:900},{width:1024,height:768},{width:320,height:844}])test(`account identity and footer fit ${viewport.width}px`,async({page})=>{
 await page.setViewportSize(viewport);await page.route('**/api/account',r=>r.fulfill({json:{account:{id:'a',username:'averylongplayername20',createdAt:1,premium:true,isAdmin:false},stats:null}}));await page.goto('/');if(await page.locator('#helppanel').isVisible())await page.locator('#closehelp').click();
 const identity=page.getByRole('button',{name:'Account settings for averylongplayername20'});await expect(identity).toBeVisible();await expect(page).toHaveTitle('Pool Simulator');await identity.click();await expect(page.locator('#accountdialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#accountdialog')).not.toBeVisible();await expect(identity).toBeFocused();
 const box=(await identity.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
 const dock=(await page.locator('#camera-profile-dock').boundingBox())!,legal=(await page.locator('.legal-links').boundingBox())!,tray=(await page.locator('.control-tray').boundingBox())!;expect(dock.y+dock.height).toBeLessThan(legal.y);expect(tray.y+tray.height).toBeLessThan(dock.y);
 await page.locator('#camera-input-profile').selectOption('trackpad');expect(await page.evaluate(()=>localStorage.getItem('pool:cameraInput'))).toBe('trackpad');await page.screenshot({path:`/tmp/pool-094-hud-${viewport.width}.png`});
});
test('direct guest sign in and logout update the same identity control',async({page})=>{
 let account:any=null;await page.route('**/api/account',r=>r.fulfill({json:{account,stats:null}}));await page.route('**/api/account/login',r=>{account={id:'a',username:'god',createdAt:1,premium:true,isAdmin:false};return r.fulfill({json:{account}});});await page.route('**/api/account/logout',r=>{account=null;return r.fulfill({json:{account:null}});});await page.goto('/');if(await page.locator('#helppanel').isVisible())await page.locator('#closehelp').click();await page.getByRole('button',{name:'Sign in or create an account',exact:true}).click();await page.locator('#accountusername').fill('god');await page.locator('#accountpassword').fill('longpassword123456');await page.locator('#accountsubmit').click();await expect(page.locator('#accountidentity')).toHaveAccessibleName('Account settings for god');await page.locator('#accountlogout').click();await expect(page.locator('#accountidentityname')).toHaveText('Sign in');
});

test('touch layout keeps account access and movement controls reachable',async({browser})=>{
 const context=await browser.newContext({viewport:{width:320,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();await acceptWelcomeBeforeLoad(page);
 await page.addInitScript(()=>{localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));});
 await page.route('**/api/account',r=>r.fulfill({json:{account:null,stats:null}}));await page.goto('/');if(await page.locator('#helppanel').isVisible())await page.locator('#closehelp').tap();
 await expect(page.locator('#accountidentity')).toBeVisible();await expect(page.locator('#camera-profile-dock')).not.toBeVisible();await page.locator('#camera-fly-toggle').tap();await expect(page.getByRole('button',{name:'Fly camera rise',exact:true})).toBeInViewport();
 const hud=(await page.locator('#camera-fly-hud').boundingBox())!,tray=(await page.locator('.control-tray').boundingBox())!;expect(hud.y+hud.height).toBeLessThan(tray.y);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);await page.screenshot({path:'/tmp/pool-094-touch-320.png'});await context.close();
});
