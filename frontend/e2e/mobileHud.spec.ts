import {test,expect} from '@playwright/test';
import {acceptWelcomeBeforeLoad,waitForOpening} from './welcomeFixture';
import {TERMS_VERSION} from '../src/ui/terms';
test.use({hasTouch:true,isMobile:true});
for(const viewport of [{width:320,height:700},{width:390,height:844},{width:844,height:390}])test(`compact mobile HUD keeps touch controls reachable at ${viewport.width}x${viewport.height}`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);await acceptWelcomeBeforeLoad(page);
  await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
  await page.route('**/api/version',r=>r.fulfill({json:{version:'1.0.0'}}));
  await page.route('**/api/account',r=>r.fulfill({json:{account:{id:'player',username:'god',createdAt:1,premium:true,isAdmin:false},stats:null}}));
  await page.route('**/api/privacy/terms',r=>r.fulfill({json:{version:TERMS_VERSION,accepted:true,authenticated:true,accountId:'player'}}));
  await page.route('**/api/opponents/jev',r=>r.fulfill({json:{available:false}}));
  await page.goto('/');await waitForOpening(page);
  await page.evaluate(()=>{document.getElementById('msg')!.textContent='god to shoot';document.getElementById('opponentstatus')!.textContent='Jev AI selected a development shot';});
  const header=(await page.locator('.topbar').boundingBox())!,tray=(await page.locator('.control-tray').boundingBox())!,identity=(await page.locator('#accountidentity').boundingBox())!,toolbar=(await page.locator('.toolbar').boundingBox())!;
  expect(header.height).toBeLessThan(112);expect(tray.height).toBeLessThan(viewport.width>=700?66:112);expect(Math.abs(identity.y-toolbar.y)).toBeLessThan(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  for(const selector of ['#accountidentity','#helpbtn','#settingsbtn','#viewbtn','#onlinebtn','#touchshoot','#touchpower','#spin','#resetspin','#morecontrols','#version','.legal-links a','.legal-links button'])for(const element of await page.locator(selector).all()){
    await expect(element).toBeInViewport();const box=(await element.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const version=(await page.locator('#version').boundingBox())!,legal=(await page.locator('.legal-links').boundingBox())!,scores=(await page.locator('#scorecard').boundingBox())!;
  expect(version.x+version.width).toBeLessThan(legal.x);expect(tray.y+tray.height).toBeLessThan(legal.y);
  if(viewport.width<700)expect(tray.y-(scores.y+scores.height)).toBeGreaterThan(250);else expect(scores.x).toBeGreaterThan(header.x+header.width);
  const camera=(await page.locator('#camera-fly-hud').boundingBox())!;expect(camera.y+camera.height).toBeLessThan(tray.y);
  await page.locator('#camera-fly-toggle').tap();
  const expanded=(await page.locator('#camera-fly-hud').boundingBox())!;expect(expanded.y+expanded.height).toBeLessThan(tray.y);await expect(page.locator('#touchshoot')).toBeInViewport();await expect(page.locator('#spin')).toBeInViewport();
  await page.locator('#camera-fly-toggle').tap();
  await page.screenshot({path:testInfo.outputPath('mobile-hud.png')});
  await page.locator('#morecontrols').tap();await expect(page.locator('#cpubtn')).toBeVisible();await expect(page.locator('#jevbtn')).toBeVisible();await expect(page.locator('#rack')).toBeVisible();
});
