import {expect,test,type Page} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';

test.beforeEach(async({page})=>{
  await acceptWelcomeBeforeLoad(page);
  await page.route('**/api/**',route=>route.fulfill({json:{}}));
  await page.addInitScript(()=>{
    const raf=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>raf(time=>{
      const g=(window as any).__pool;
      if(g&&!g.__latencyNoDraw){g.__latencyNoDraw=true;g.scene.renderer.render=()=>{};}
      callback(time);
    });
  });
});
async function setup(page:Page){
  await page.goto('/');await page.waitForFunction(()=>!!(window as any).__pool);
  return page.evaluate(()=>{
    const g=(window as any).__pool;g.coin.cancel();g.cancelOpponent();g.cpuOpponent=true;g.jevOpponent=true;
    g.jevGame={id:'latency',revision:0};g.gs.current=0;g.gs.breakShot=false;g.gs.rules.calls='none';
    g.gs.winner=null;g.mode='aim';g.angle=g.targetAngle=.35;g.tipX=g.tipY=0;g.options.autoCamera=false;
    for(const b of g.gs.balls){b.potted=true;b.asleep=true;b.vx=b.vy=b.vz=b.z=b.wx=b.wy=b.wz=0;}
    Object.assign(g.cue(),{potted:false,x:1,y:.6});
    Object.assign(g.gs.balls.find((b:any)=>b.n===1),{potted:false,x:2,y:.9});
    const balls=structuredClone(g.gs.balls);Object.assign(balls[0],{x:.8,y:.4});
    return {balls,return_order:[],current:0,groups:[null,null],open:true,ball_in_hand:false,
      break_shot:false,placement:'none',kitchen_shot:false,rules:g.gs.rules,revision:1,winner:null,message:'Authoritative result'};
  });
}
async function settlePrediction(page:Page){
  await page.evaluate(()=>{
    const g=(window as any).__pool;let n=0;
    while(g.mode==='rolling'&&n++<240){g.accumulator+=.25;g.frame();}
    if(g.mode==='rolling')throw Error('Prediction failed to settle within 60 simulated seconds');
  });
}

test('human Jev stroke moves immediately, locks aim, and commits only one authoritative result',async({page})=>{
  const state=await setup(page);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let requests=0;
  await page.route('**/api/opponents/jev/games/latency/turn',async route=>{
    requests++;await gate;await route.fulfill({json:{state,by:0,source:'human',expiresAt:null}});
  });
  const instant=await page.evaluate(()=>{
    const g=(window as any).__pool;g.fire(.2);
    const canvas=document.getElementById('game-canvas')!;canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowLeft',bubbles:true}));
    canvas.dispatchEvent(new PointerEvent('pointermove',{clientX:400,clientY:400,pointerType:'mouse',bubbles:true}));
    g.setSpin(.4,.4);g.fire(.2);void g.playJevTurn(.2);
    return {mode:g.mode,speed:Math.hypot(g.cue().vx,g.cue().vy),angle:g.angle,target:g.targetAngle,spin:g.tipX,revision:g.jevGame.revision};
  });
  expect(instant.mode).toBe('rolling');expect(instant.speed).toBeGreaterThan(0);
  expect(instant).toMatchObject({angle:.35,target:.35,spin:0,revision:0});
  await expect.poll(()=>requests).toBe(1);
  // Count only subsequent fire calls: a server response must never strike again.
  await page.evaluate(()=>{const g=(window as any).__pool;g.__duplicateStrikes=0;const fire=g.fire.bind(g);g.fire=(...args:any[])=>{g.__duplicateStrikes++;return fire(...args);};});
  await settlePrediction(page);
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return{mode:g.mode,current:g.gs.current,revision:g.jevGame.revision,winner:g.gs.winner};})).toEqual({mode:'wait',current:0,revision:0,winner:null});
  release();await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame.revision)).toBe(1);
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return{mode:g.mode,x:g.cue().x,y:g.cue().y,strikes:g.__duplicateStrikes,speed:Math.hypot(g.cue().vx,g.cue().vy)};})).toEqual({mode:'aim',x:.8,y:.4,strikes:0,speed:0});
  expect(requests).toBe(1);
});

test('a response arriving during playback queues final state without replaying the stroke',async({page})=>{
  const state=await setup(page);
  await page.route('**/api/opponents/jev/games/latency/turn',route=>route.fulfill({json:{state,by:0,source:'human'}}));
  await page.evaluate(()=>{const g=(window as any).__pool;g.fire(.8);});
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.pendingNetwork.length)).toBe(1);
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return{mode:g.mode,revision:g.jevGame.revision};})).toEqual({mode:'rolling',revision:0});
  await settlePrediction(page);
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return{mode:g.mode,revision:g.jevGame.revision,x:g.cue().x,pending:g.pendingNetwork.length};})).toEqual({mode:'aim',revision:1,x:.8,pending:0});
});

test('failed human sync settles without awarding a result and resumes authoritative state',async({page})=>{
  const state=await setup(page);
  await page.route('**/api/opponents/jev/games/latency/turn',route=>route.fulfill({status:503,json:{detail:'Temporarily unavailable'}}));
  await page.evaluate(()=>{const g=(window as any).__pool;g.fire(.2);});
  await expect(page.locator('#opponentstatus')).toContainText('Select Jev AI to resume');
  await settlePrediction(page);
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return{mode:g.mode,current:g.gs.current,revision:g.jevGame.revision,winner:g.gs.winner};})).toEqual({mode:'wait',current:0,revision:0,winner:null});
  await page.route('**/api/opponents/jev/games',route=>route.fulfill({json:{id:'latency',created:false,state,expiresAt:null}}));
  await page.evaluate(async()=>{await (window as any).__pool.startJev();});
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return{mode:g.mode,revision:g.jevGame.revision,x:g.cue().x,coin:g.coinPending()};})).toEqual({mode:'aim',revision:1,x:.8,coin:false});
});

test('reset discards a late human response and preserves the fresh rack',async({page})=>{
  const state=await setup(page);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let started=false,finished=false;
  await page.route('**/api/opponents/jev/games/latency/turn',async route=>{
    started=true;await gate;try{await route.fulfill({json:{state,by:0,source:'human'}});}catch{/* reset may abort the routed request */}finally{finished=true;}
  });
  await page.evaluate(()=>{(window as any).__pool.fire(.2);});await expect.poll(()=>started).toBe(true);
  const fresh=await page.evaluate(()=>{const g=(window as any).__pool;g.reset(g.gs.rules,false);return JSON.stringify(g.gs);});
  release();await expect.poll(()=>finished).toBe(true);
  await page.evaluate(()=>{(window as any).__pool.frame();});
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return{state:JSON.stringify(g.gs),jev:g.jevGame,pending:g.pendingNetwork.length,mode:g.mode};})).toEqual({state:fresh,jev:null,pending:0,mode:'aim'});
});
