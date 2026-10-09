import {test,expect} from '@playwright/test';
import {acceptWelcomeBeforeLoad,waitForOpening} from './welcomeFixture';
import {TERMS_VERSION} from '../src/ui/terms';
test.use({hasTouch:true,isMobile:true});
for(const viewport of [{width:320,height:700},{width:390,height:844},{width:844,height:390}])test(`compact mobile HUD keeps touch controls reachable at ${viewport.width}x${viewport.height}`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);await acceptWelcomeBeforeLoad(page);
  await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g&&!((window as any).__draw)){(window as any).__draw=g.scene.renderer.render.bind(g.scene.renderer);g.scene.renderer.render=(...args:any[])=>{(window as any).__renderArgs=args;};}cb(t);});localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));});
  await page.route('**/api/version',r=>r.fulfill({json:{version:'1.0.0'}}));
  await page.route('**/api/account',r=>r.fulfill({json:{account:{id:'player',username:'developer',createdAt:1,premium:true,isAdmin:false},stats:null}}));
  await page.route('**/api/privacy/terms',r=>r.fulfill({json:{version:TERMS_VERSION,accepted:true,authenticated:true,accountId:'player'}}));
  await page.route('**/api/opponents/jev',r=>r.fulfill({json:{available:false}}));
  await page.goto('/');await waitForOpening(page);
  await page.evaluate(()=>{document.getElementById('msg')!.textContent='developer to shoot';document.getElementById('opponentstatus')!.textContent='Jev AI selected a development shot';});
  const header=(await page.locator('.topbar').boundingBox())!,tray=(await page.locator('.control-tray').boundingBox())!,identity=(await page.locator('#accountidentity').boundingBox())!,toolbar=(await page.locator('.toolbar').boundingBox())!;
  if(viewport.width<700){expect(header.height).toBeLessThan(150);expect(tray.height).toBeLessThan(112);expect(Math.abs(identity.y-toolbar.y)).toBeLessThan(1);}else{expect(header.width).toBe(160);expect(tray.width).toBe(180);expect(tray.x-header.x-header.width).toBeGreaterThan(250);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  for(const selector of ['#accountidentity','#helpbtn','#settingsbtn','#onlinebtn','#touchshoot','#touchpower','#spin','#resetspin','#morecontrols','#mobile-move-camera'])for(const element of await page.locator(selector).all()){
    await expect(element).toBeInViewport();const box=(await element.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('.topbar #scorecard')).toBeVisible();
  await expect(page.locator('#version')).not.toBeVisible();await expect(page.locator('.legal-links')).not.toBeVisible();
  if(viewport.width<700){expect(viewport.height-tray.y-tray.height).toBeGreaterThanOrEqual(7);expect(viewport.height-tray.y-tray.height).toBeLessThan(10);}
  const scores=(await page.locator('#scorecard').boundingBox())!;expect(scores.y+scores.height).toBeLessThanOrEqual(header.y+header.height);
  // Optional status controls must not squeeze the account action out of the header.
  await page.evaluate(()=>{const g=(window as any).__pool;g.account.easterEggsEnabled=true;g.account.chalkSim=true;g.gs.rules.chalkSim=true;g.gs.chalk=[.84,.66];g.hud();g.frame();});
  await expect(page.locator('#chalkcontrols')).toBeVisible();
  const account=(await page.locator('#accountidentity').boundingBox())!,chalk=(await page.locator('#chalkcontrols').boundingBox())!;
  expect(account.width).toBeGreaterThanOrEqual(80);
  expect(chalk.y).toBeGreaterThanOrEqual(account.y+account.height);
  expect(await page.locator('#accountidentityname').evaluate(e=>e.clientWidth)).toBeGreaterThan(30);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await expect(page.locator('#rechalk')).toBeInViewport();
  await page.locator('#mobile-move-camera').tap();await expect(page.locator('.control-tray')).not.toBeVisible();await expect(page.locator('#camera-fly-hud')).toBeVisible();
  await page.locator('#camera-fly-toggle').tap();await expect(page.locator('#touchshoot')).toBeVisible();
  await page.evaluate(()=>{const w=window as any;w.__draw?.(...w.__renderArgs);});
  await page.screenshot({path:testInfo.outputPath('mobile-hud.png')});
  await page.locator('#settingsbtn').tap();await page.locator('#version').scrollIntoViewIfNeeded();await expect(page.locator('#mobile-settings-about #version')).toBeVisible();await expect(page.locator('#mobile-settings-about .legal-links')).toBeVisible();await page.locator('#closesettings').tap();
  await page.locator('#morecontrols').tap();await expect(page.locator('#cpubtn')).toBeVisible();await expect(page.locator('#jevbtn')).toBeVisible();await expect(page.locator('#rack')).toBeVisible();
});

test.describe('desktop retains the original HUD',()=>{
  test.use({hasTouch:false,isMobile:false});
  for(const width of [1024,1440])test(`mobile layout preserves desktop at ${width}px`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:900});await acceptWelcomeBeforeLoad(page);
    await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g&&!(window as any).__draw){(window as any).__draw=g.scene.renderer.render.bind(g.scene.renderer);g.scene.renderer.render=(...args:any[])=>{(window as any).__renderArgs=args;};}cb(t);});});
    await page.route('**/api/account',r=>r.fulfill({json:{account:null,stats:null}}));await page.route('**/api/opponents/jev',r=>r.fulfill({json:{available:false}}));
    await page.goto('/');await waitForOpening(page);
    await expect(page.locator('.status-meta #version')).toBeAttached();await expect(page.locator('#desktop-camera-stack .legal-links')).toBeVisible();await expect(page.locator('.topbar #scorecard')).toHaveCount(0);await expect(page.locator('#mobile-settings-about')).not.toBeVisible();await expect(page.locator('.settings-mobile-icon')).not.toBeVisible();
    const snapshot=()=>page.evaluate(()=>Object.fromEntries(['.topbar','#scorecard','.control-tray','#version','.legal-links','#settingsbtn'].map(selector=>{const r=document.querySelector(selector)!.getBoundingClientRect();return [selector,[r.x,r.y,r.width,r.height]];})));
    const before=await snapshot();
    await page.evaluate(()=>{document.querySelector('.settings-mobile-icon')!.remove();const wrapper=document.querySelector('.settings-desktop-label')!;wrapper.replaceWith(...Array.from(wrapper.childNodes));document.getElementById('mobile-settings-about')!.remove();});
    expect(await snapshot()).toEqual(before);
    await page.evaluate(()=>{const w=window as any;w.__draw?.(...w.__renderArgs);});await page.screenshot({path:testInfo.outputPath('desktop-hud.png')});
  });
});
