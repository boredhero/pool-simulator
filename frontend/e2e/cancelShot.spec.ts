import {expect,test} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';

for(const profile of ['mouse','trackpad'])for(const firstRelease of ['left','right'] as const)
test(`${profile}: secondary click cancels a pull with ${firstRelease} released first`,async({page})=>{
  await acceptWelcomeBeforeLoad(page);
  await page.route('**/api/**',route=>route.fulfill({json:{}}));
  await page.addInitScript(profile=>{
    localStorage.setItem('pool:cameraInput',profile);
    localStorage.setItem('pool:help-dismissed','1');
    localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));
    const raf=requestAnimationFrame.bind(window);
    window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});
  },profile);
  await page.goto('/');await page.waitForFunction(()=>!!(window as any).__pool);
  await page.evaluate(()=>{
    const g=(window as any).__pool;g.coin.cancel();g.cpuOpponent=false;g.gs.current=0;
    g.gs.ballInHand=false;g.gs.winner=null;g.gs.rules.calls='none';g.mode='aim';
    g.__shots=0;const fire=g.fire.bind(g);g.fire=(...args:any[])=>{g.__shots++;fire(...args);};
    // Keep hit testing deterministic; mouse events and real pull/release handlers run normally.
    g.scene.pickFelt=(x:number,y:number)=>[x/500,y/500];
  });
  await page.mouse.move(650,360);await page.mouse.down({button:'left'});await page.mouse.move(560,390);
  expect(await page.evaluate(()=>(window as any).__pool.pulling)).toBe(true);
  await page.mouse.down({button:'right'});
  expect(await page.evaluate(()=>(window as any).__pool.pulling)).toBe(false);
  await page.mouse.up({button:firstRelease});await page.mouse.move(530,400);
  expect(await page.evaluate(()=>(window as any).__pool.__shots)).toBe(0);
  await page.mouse.up({button:firstRelease==='left'?'right':'left'});
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return{shots:g.__shots,pulling:g.pulling,pointers:g.pointers.size};})).toEqual({shots:0,pulling:false,pointers:0});
  await page.mouse.down({button:'left'});expect(await page.evaluate(()=>(window as any).__pool.pulling)).toBe(true);
  // Native trackpads may deliver a context-menu gesture without another pointerdown.
  await page.locator('#game-canvas').dispatchEvent('contextmenu',{button:2,buttons:3});
  await page.mouse.up({button:'left'});
  expect(await page.evaluate(()=>(window as any).__pool.__shots)).toBe(0);
  await page.mouse.down({button:'left'});await page.mouse.move(500,410);await page.mouse.up({button:'left'});
  expect(await page.evaluate(()=>(window as any).__pool.__shots)).toBe(1);
});
