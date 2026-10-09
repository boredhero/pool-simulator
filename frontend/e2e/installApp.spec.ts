import {test,expect} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
test.beforeEach(async({page})=>{
 await acceptWelcomeBeforeLoad(page);
 await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-09',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
 await page.route('**/api/account',r=>r.fulfill({json:{account:null,stats:null}}));
});
test.describe('touch install options',()=>{
 test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
 test('settings invokes the native install prompt only on click and tracks installation',async({page})=>{
 await page.goto('/');await page.locator('#settingsbtn').click();await expect(page.locator('#installapp')).toBeVisible();
 await page.evaluate(()=>{(window as any).installCalls=0;const event=new Event('beforeinstallprompt',{cancelable:true});Object.assign(event,{prompt:async()=>{(window as any).installCalls++;},userChoice:Promise.resolve({outcome:'accepted'})});window.dispatchEvent(event);});
 expect(await page.evaluate(()=>(window as any).installCalls)).toBe(0);
 await page.locator('#installapp').click();await expect(page.locator('#installappstatus')).toContainText('Installation requested');expect(await page.evaluate(()=>(window as any).installCalls)).toBe(1);
 await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));await expect(page.locator('#installapp')).toHaveText('App installed');await expect(page.locator('#installapp')).toBeDisabled();
});
test('dismissal consumes the prompt and settings remains available with manual instructions',async({page})=>{
 await page.goto('/');await page.locator('#settingsbtn').click();
 await page.evaluate(()=>{const event=new Event('beforeinstallprompt',{cancelable:true});Object.assign(event,{prompt:async()=>{},userChoice:Promise.resolve({outcome:'dismissed'})});window.dispatchEvent(event);});
 await page.locator('#installapp').click();await expect(page.locator('#installappstatus')).toContainText('dismissed');await page.locator('#installapp').click();await expect(page.locator('#installappdialog')).toBeVisible();await page.locator('#installappdialog').getByRole('button',{name:'Done'}).click();await expect(page.locator('#installapp')).toBeFocused();
});
test('iPhone welcome offers Home Screen instructions without accepting terms',async({page})=>{
 await page.addInitScript(()=>{localStorage.removeItem('pool:welcome');Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile Safari/604.1'});});
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#welcomeinstall').click();
 const dialog=page.locator('#installappdialog');await expect(dialog).toContainText('Share, then Add to Home Screen');await expect(dialog).toContainText('Open as Web App');expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390);
 await page.keyboard.press('Escape');await expect(page.locator('#welcomedialog')).toBeVisible();await expect(page.locator('#welcometerms')).not.toBeChecked();await expect(page.locator('#welcomeinstall')).toBeFocused();
});
test('standalone mode marks settings installed',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{value:true});});await page.goto('/');await page.locator('#settingsbtn').click();await expect(page.locator('#installapp')).toBeDisabled();await expect(page.locator('#installapp')).toHaveText('App installed');
});
});
test('manifest and Apple metadata serve correctly sized install icons',async({page})=>{
 const manifest=await (await page.request.get('/manifest.json')).json();expect(manifest.name).toBe('Pool Simulator');expect(manifest.display).toBe('standalone');expect(manifest.id).toBe('/');
 for(const size of [192,512])expect(manifest.icons).toContainEqual({src:`/icon-${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'any'});
 for(const [path,size] of [['/icon-192.png',192],['/icon-512.png',512],['/apple-touch-icon.png',180]] as const){const response=await page.request.get(path);expect(response.ok()).toBe(true);const body=await response.body();expect(body.readUInt32BE(16)).toBe(size);expect(body.readUInt32BE(20)).toBe(size);}
 await page.goto('/');await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href','/apple-touch-icon.png');
});

for(const profile of ['mouse','trackpad'])test(`desktop ${profile} hides installation throughout welcome and settings`,async({page})=>{
 await page.addInitScript(profile=>{localStorage.removeItem('pool:welcome');localStorage.setItem('pool:cameraInput',profile);},profile);
 await page.goto('/');await expect(page.locator('#welcomedialog')).toBeVisible();await expect(page.locator('#welcomeinstall')).toBeHidden();
 await page.evaluate(()=>{(window as any).installCalls=0;const event=new Event('beforeinstallprompt',{cancelable:true});Object.assign(event,{prompt:async()=>{(window as any).installCalls++;},userChoice:Promise.resolve({outcome:'accepted'})});window.dispatchEvent(event);(window as any).installPrevented=event.defaultPrevented;document.getElementById('welcomeinstall')!.click();});
 await expect(page.locator('#installappdialog')).not.toBeVisible();expect(await page.evaluate(()=>(window as any).installCalls)).toBe(0);expect(await page.evaluate(()=>(window as any).installPrevented)).toBe(false);
 await page.locator('#welcometerms').check();await page.locator('#welcomeplay').click();await page.locator('#settingsbtn').click();
 await expect(page.locator('#installapp')).toBeHidden();await expect(page.locator('#installappstatus')).toBeHidden();
 await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));await expect(page.locator('#installapp')).toBeHidden();await expect(page.locator('#installappstatus')).toBeHidden();
});
test.describe('responsive installation controls',()=>{
 test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
 test('mobile installation closes and hides when the interface becomes desktop',async({page})=>{
  await page.goto('/');await page.locator('#settingsbtn').click();await expect(page.locator('#installapp')).toBeVisible();
  await page.locator('#installapp').tap();await expect(page.locator('#installappdialog')).toBeVisible();
  await page.setViewportSize({width:1280,height:800});
  await expect(page.locator('#installappdialog')).not.toBeVisible();await expect(page.locator('#installapp')).toBeHidden();
  await page.setViewportSize({width:390,height:844});await expect(page.locator('#installapp')).toBeVisible();
 });
});
test('a desktop touch event cannot expose installation in settings or welcome',async({page})=>{
 await page.addInitScript(()=>localStorage.removeItem('pool:welcome'));
 await page.goto('/');
 await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch'})));
 await expect(page.locator('#welcomeinstall')).toBeHidden();
 await page.locator('#welcometerms').check();await page.locator('#welcomeplay').click();await page.locator('#settingsbtn').click();
 await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch'})));
 await expect(page.locator('#installapp')).toBeHidden();
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('#installapp')).toBeHidden();
 await page.locator('#installapp').evaluate(button=>(button as HTMLButtonElement).click());
 await expect(page.locator('#installappdialog')).not.toBeVisible();
});
