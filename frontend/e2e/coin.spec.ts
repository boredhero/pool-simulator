import {expect,test,type Page} from '@playwright/test';
import {acceptWelcomeBeforeLoad,waitForOpening} from './welcomeFixture';

test.beforeEach(async({page})=>{
  await acceptWelcomeBeforeLoad(page);
  await page.route('**/api/account',r=>r.fulfill({json:{account:null,stats:null}}));
  await page.route('**/api/version',r=>r.fulfill({json:{version:'e2e'}}));
  await page.addInitScript(()=>{const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
});
async function open(page:Page){await page.goto('/');await waitForOpening(page);}
async function state(page:Page){return page.evaluate(()=>{const g=(window as any).__pool;return{balls:g.gs.balls,current:0,groups:[null,null],open:true,return_order:[],ball_in_hand:false,break_shot:true,placement:'none',kitchen_shot:false,rules:g.gs.rules,revision:0,winner:null,message:'Break'};});}

for(const breaker of [0,1])for(const cpu of [false,true])test(`${cpu?'CPU':'local PvP'} gold coin selects seat ${breaker} and gates the opening shot`,async({page})=>{
  await open(page);
  const before=await page.evaluate(({breaker,cpu})=>{
    const g=(window as any).__pool,random=crypto.getRandomValues.bind(crypto);
    (crypto as any).getRandomValues=(array:any)=>{random(array);if(array instanceof Uint8Array&&array.length===1)array[0]=breaker;return array;};
    g.cpuOpponent=cpu;g.reset();(crypto as any).getRandomValues=random;
    const angle=g.targetAngle;g.fire(.5);g.setSpin(.3,.2);void g.cpuMove();
    return{current:g.gs.current,busy:g.openingBusy,mode:g.mode,angle:g.targetAngle===angle,spin:g.tipX,action:g.opponentAction};
  },{breaker,cpu});
  expect(before).toEqual({current:breaker,busy:true,mode:'aim',angle:true,spin:0,action:null});
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.scene.coin.group.visible)).toBe(true);
  expect(await page.evaluate(()=>(window as any).__pool.gs.current)).toBe(breaker);
  await expect(page.locator('#msg')).toContainText('breaks ·');
  await expect(page.locator('#msg')).toContainText(`${cpu&&breaker===1?'CPU':`Player ${breaker+1}`} breaks`);
  await waitForOpening(page);await expect.poll(()=>page.evaluate(()=>(window as any).__pool.scene.coin.group.visible)).toBe(false);
  expect(await page.evaluate(()=>(window as any).__pool.gs.current)).toBe(breaker);
});

test('practice pauses the original toss and reset cancels its old result',async({page})=>{
  await open(page);
  expect(await page.evaluate(()=>{const g=(window as any).__pool;g.reset();const saved=g.gs,seat=g.gs.current;g.tutorial.start();g.frame();const paused=!g.openingBusy;g.tutorial.close();return{paused,same:g.gs===saved,seat:g.gs.current===seat,busy:g.openingBusy};})).toEqual({paused:true,same:true,seat:true,busy:true});
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.scene.coin.group.visible)).toBe(true);
  await page.evaluate(()=>{const g=(window as any).__pool;g.reset();g.gs.current=1;g.coin.queue(g.gs,1);});
  expect(await page.evaluate(()=>(window as any).__pool.gs.current)).toBe(1);
  await waitForOpening(page);expect(await page.evaluate(()=>(window as any).__pool.gs.current)).toBe(1);
});

test('reduced motion presents a static result briefly',async({page})=>{
  await open(page);await page.emulateMedia({reducedMotion:'reduce'});
  const value=await page.evaluate(()=>{const g=(window as any).__pool;g.reset();g.frame();const coin=g.scene.coin.group;return{busy:g.openingBusy,visible:coin.visible,height:coin.position.y,status:g.coin.status};});
  expect(value.busy).toBe(true);expect(value.visible).toBe(true);expect(value.height).toBeCloseTo(.0048);expect(value.status).toMatch(/breaks · [HT]/);await waitForOpening(page);
});

for(const breaker of [0,1])test(`new Jev game toss uses server seat ${breaker}, resume never rerolls`,async({page})=>{
  await open(page);const initial=await state(page);let created=true,turns=0;
  await page.route('**/api/opponents/jev/turn',r=>{turns++;return r.fulfill({status:503,json:{detail:'No model request expected'}});});
  await page.route('**/api/opponents/jev/games',r=>r.fulfill({json:{id:'server-rack',created,state:{...initial,current:breaker},expiresAt:null}}));
  await page.evaluate(async()=>{const g=(window as any).__pool;await g.startJev(true);g.frame();await g.playJevTurn();});
  expect(await page.evaluate(()=>(window as any).__pool.gs.current)).toBe(breaker);expect(turns).toBe(0);
  created=false;
  await page.evaluate(async()=>{const g=(window as any).__pool;await g.startJev(false);g.frame();});
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return{busy:g.openingBusy,current:g.gs.current};})).toEqual({busy:false,current:breaker});
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.scene.coin.group.visible)).toBe(false);
});

for(const breaker of [0,1])test(`online clients show the same authoritative coin seat ${breaker} only once`,async({page})=>{
  await open(page);const initial=await state(page);
  const result=await page.evaluate(({initial,breaker})=>{
    const g=(window as any).__pool;g.coin.cancel();g.room={ready:true};g.seat=1-breaker;g.roomNames=['Alice','Bob'];
    g.applyServerState({...initial,ready:false,break_starter:null});const waiting=g.openingBusy;
    g.applyServerState({...initial,ready:true,current:breaker,break_starter:breaker});g.frame();const first={busy:g.openingBusy,seat:String(g.gs.current),visible:g.scene.coin.group.visible};
    g.coin.cancel();g.applyServerState({...initial,ready:true,current:breaker,break_starter:breaker});const repeated=g.openingBusy;
    g.room={ready:true};g.seat=breaker;g.applyServerState({...initial,ready:true,current:breaker,break_starter:breaker});g.frame();
    const second={busy:g.openingBusy,seat:String(g.gs.current),visible:g.scene.coin.group.visible};g.coin.cancel();g.room=null;return{waiting,first,repeated,second};
  },{initial,breaker});
  expect(result).toEqual({waiting:false,first:{busy:true,seat:String(breaker),visible:true},repeated:false,second:{busy:true,seat:String(breaker),visible:true}});
});

test('initial toss waits for welcome and stays paused throughout practice',async({page})=>{
  await page.addInitScript(()=>localStorage.removeItem('pool:welcome'));
  await page.goto('/');await expect(page.locator('#welcomedialog')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__pool.openingBusy)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.scene.coin.group.visible)).toBe(false);
  await page.locator('#welcometerms').check();await page.locator('#welcometutorial').click();
  await expect(page.locator('#tutorial')).toBeVisible();await expect.poll(()=>page.evaluate(()=>(window as any).__pool.scene.coin.group.visible)).toBe(false);
  await page.locator('#tutorialclose').click();await expect.poll(()=>page.evaluate(()=>(window as any).__pool.scene.coin.group.visible)).toBe(true);
  await waitForOpening(page);
});

test('coin stays on the felt while its status uses the existing topbar',async({page})=>{
  await page.setViewportSize({width:320,height:568});await open(page);
  const view=await page.evaluate(()=>{const g=(window as any).__pool;g.reset();g.frame();g.scene.coin.advance(1.2,false);const position=g.scene.coin.group.position.toArray();g.scene.controls.object.position.x+=2;return{position,text:document.getElementById('msg')!.textContent,extra:!!document.querySelector('#coin-toss,.coin-caption')};});
  expect(view.position).toEqual([0,.0048,0]);expect(view.text).toBe('Flipping a 🪙');expect(view.extra).toBe(false);
});
