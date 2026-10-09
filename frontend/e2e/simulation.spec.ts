import {test,expect} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
for(const mobile of [false,true])test.describe(mobile?'mobile simulation':'desktop simulation',()=>{
 if(mobile)test.use({viewport:{width:393,height:851},isMobile:true,hasTouch:true});
 test('permitted spectator can select all modes and return from the picker',async({page})=>{
  await acceptWelcomeBeforeLoad(page);
  await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-09',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
  await page.route('**/api/account',r=>r.fulfill({json:{account:{id:'sim-user',username:'spectator',premium:false,simEnabled:true,isAdmin:false,createdAt:1},stats:null}}));
  const cpuJevRequests:string[]=[];
  page.on('request',r=>{if(r.url().includes('/api/opponents/jev/'))cpuJevRequests.push(r.url());});
  await page.goto('/');await expect(page.locator('#sim-button')).toBeVisible();
  if(mobile){
   for(const viewport of [{width:320,height:740},{width:390,height:844},{width:844,height:390}]){
    await page.setViewportSize(viewport);
    for(const id of ['resetspin','sim-button','mobile-move-camera']){const box=await page.locator('#'+id).boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height);}
    const reset=(await page.locator('#resetspin').boundingBox())!,sim=(await page.locator('#sim-button').boundingBox())!,camera=(await page.locator('#mobile-move-camera').boundingBox())!;
    if(Math.abs(reset.y-sim.y)<5)expect(reset.x+reset.width).toBeLessThanOrEqual(sim.x);
    if(Math.abs(sim.y-camera.y)<5)expect(sim.x+sim.width).toBeLessThanOrEqual(camera.x);
   }
   await page.setViewportSize({width:393,height:851});
  }
  await page.locator('#sim-button').click();await expect(page.locator('#sim-panel')).toBeVisible();
  if(mobile)await expect(page.locator('.control-tray')).toBeHidden();
  await page.locator('#sim-panel').getByRole('button',{name:'Done',exact:true}).click();await expect(page.locator('.control-tray')).toBeVisible();
  await page.locator('#sim-button').click();await page.locator('[data-sim-mode="cpu-cpu"]').click();
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return{mode:g.simMode,controls:g.humanCueControls(),names:[g.playerName(0),g.playerName(1)]};})).toEqual({mode:'cpu-cpu',controls:false,names:['CPU 1','CPU 2']});
  // Both seats enter the real planner and cue presentation, without human input.
  for(const seat of [0,1])expect(await page.evaluate(async seat=>{const g=(window as any).__pool;g.coin.cancel();g.cancelOpponent();g.gs.current=seat;g.mode='aim';let planned=false;const show=g.showOpponentShot;g.showOpponentShot=async()=>{planned=true;return false;};await g.cpuMove();g.showOpponentShot=show;return planned;},seat)).toBe(true);
  expect(cpuJevRequests).toEqual([]);
  const requests:any[]=[];
  await page.route('**/api/opponents/jev/games',async r=>{requests.push(r.request().postDataJSON());await r.fulfill({status:429,json:{detail:'Daily allowance reached'}});});
  for(const mode of ['jev-cpu','jev-jev']){await page.locator('#sim-button').click();await page.locator(`[data-sim-mode="${mode}"]`).click();await expect.poll(()=>requests.at(-1)?.simulation).toBe(mode);await expect(page.locator('#opponentstatus')).toContainText('Daily allowance reached');}
  expect(requests.every(r=>r.new_game===true)).toBe(true);
 });
});
