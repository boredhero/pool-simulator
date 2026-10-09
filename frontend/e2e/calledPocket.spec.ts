import {expect,test} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';

for(const mobile of [false,true])test.describe(mobile?'mobile':'desktop',()=>{
 test.use({hasTouch:mobile,isMobile:mobile});
 test(`${mobile?'mobile':'desktop'} called pocket remains distinct from available pockets`,async({page},info)=>{
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:800});
  await acceptWelcomeBeforeLoad(page);
  await page.route('**/api/**',route=>route.fulfill({json:{}}));
  await page.addInitScript(()=>{
    localStorage.setItem('pool:help-dismissed','1');
    localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));
    const raf=requestAnimationFrame.bind(window);
    window.requestAnimationFrame=cb=>raf(time=>{
      const g=(window as any).__pool;
      if(g&&!g.__capture){
        g.__capture=true;const draw=g.scene.renderer.render.bind(g.scene.renderer);
        g.scene.renderer.render=(world:any,camera:any)=>{g.__world=world;if(g.__show)draw(world,camera);};
      }
      cb(time);
    });
  });
  await page.goto('/');await page.waitForFunction(()=>!!(window as any).__pool?.__world);
  const selected=await page.evaluate(()=>{
    const g=(window as any).__pool;g.coin.cancel();g.cpuOpponent=false;g.jevGame=null;
    g.gs.current=0;g.gs.breakShot=false;g.gs.open=false;g.gs.groups=['solid','stripe'];
    g.gs.rules.calls='eight';g.gs.ballInHand=false;g.gs.winner=null;g.mode='aim';
    g.gs.message='Player 1 to shoot';g.options.autoCamera=false;
    for(const b of g.gs.balls){b.potted=b.n!==null&&b.n!==8;b.asleep=true;}
    Object.assign(g.cue(),{x:1,y:.65});Object.assign(g.gs.balls.find((b:any)=>b.n===8),{x:1.65,y:.6});
    g.calledBall=8;g.calledPocket=2;g.hud();g.frame();
    g.scene.controls.object.position.set(-1.7,2.4,1.8);g.scene.controls.target.set(0,0,0);g.scene.controls.update();
    const targets=Array.from({length:6},(_,i)=>g.__world.getObjectByName(`called-pocket-${i}`));
    return targets.map((t:any)=>({visible:t.visible,label:t.children.some((c:any)=>c.isSprite)}));
  });
  expect(selected.map(t=>t.visible)).toEqual([false,false,true,false,false,false]);
  expect(selected[2].label).toBe(true);
  expect(await page.evaluate(()=>{const g=(window as any).__pool;g.mode='wait';g.frame();const visible=g.__world.getObjectByName('called-pocket-2').visible;g.mode='aim';return visible;})).toBe(true);
  const calls=await page.evaluate(()=>{
    const g=(window as any).__pool;g.mode='wait';g.gs.shot={current:0,open:false,breakShot:false,group:'solid',remaining:[1],kitchen:false,calledBall:1,calledPocket:2};
    g.calledBall=1;g.calledPocket=2;
    const result=[];
    for(const mode of ['cpu','jev'])for(const policy of ['eight','all','none']){
      g.cpuOpponent=true;g.jevOpponent=mode==='jev';g.gs.rules.calls=policy;g.frame();
      result.push({mode,policy,visible:g.__world.getObjectByName('called-pocket-2').visible});
    }
    g.cpuOpponent=false;g.jevOpponent=false;g.gs.rules.calls='eight';g.calledBall=8;delete g.gs.shot;g.mode='aim';g.frame();
    return result;
  });
  for(const call of calls)expect(call.visible,`${call.mode} ${call.policy}`).toBe(call.policy==='all');
  await page.evaluate(()=>{(window as any).__pool.__show=true;});
  await page.screenshot({path:info.outputPath('called-pocket.png')});
  await page.evaluate(()=>{const g=(window as any).__pool;g.__show=false;g.calledPocket=null;g.hud();g.frame();});
  expect(await page.evaluate(()=>Array.from({length:6},(_,i)=>(window as any).__pool.__world.getObjectByName(`called-pocket-${i}`).visible))).toEqual([false,false,false,false,false,false]);
});

});
