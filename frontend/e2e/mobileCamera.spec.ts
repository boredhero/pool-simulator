import {test,expect,type Page} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
async function prepare(page:Page){
  await acceptWelcomeBeforeLoad(page);
  await page.route('**/api/**',r=>r.fulfill({json:{}}));
  await page.addInitScript(()=>{localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-09',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g){g.__cameraDraw??=g.scene.renderer.render.bind(g.scene.renderer);g.scene.renderer.render=g.__cameraShow?g.__cameraDraw:()=>{};}cb(t);});});
  await page.goto('/');await page.waitForFunction(()=>!!(window as any).__pool);
  await page.evaluate(()=>{
    const g=(window as any).__pool;g.coin.cancel();g.cpuOpponent=false;g.gs.current=0;g.gs.breakShot=false;g.gs.open=false;g.gs.groups=['solid','stripe'];g.gs.ballInHand=false;g.gs.winner=null;g.gs.message='Player 1 to shoot';g.mode='aim';g.options.autoCamera=true;
    for(const b of g.gs.balls){b.potted=true;b.asleep=true;}
    Object.assign(g.cue(),{potted:false,x:.9,y:.54});
    for(const [n,x,y]of [[1,.45,.27],[2,2.3,1.05],[3,2.2,.2]])Object.assign(g.gs.balls.find((b:any)=>b.n===n),{potted:false,x,y});
    g.calledBall=1;g.calledPocket=0;g.scene.controls.target.set(0,0,0);g.scene.controls.object.position.set(-2,3,2);g.scene.controls.update();g.hud();
  });
}
test.describe('touch shot framing',()=>{
 test.use({hasTouch:true,isMobile:true});
for(const viewport of [{width:390,height:844},{width:844,height:390}])test(`mobile shot stays visible and closer than whole table at ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});await prepare(page);
  const focused=await page.evaluate(()=>{
    const g=(window as any).__pool;g.frameBalls();
    const camera=g.scene.controls.object;camera.updateMatrixWorld();
    const points=[[.9,.54],[.45,.27],[-.0287,-.0287]].map(([x,y])=>{
      const p=camera.position.clone().set(x-2.54/2,.028575,y-1.27/2).project(camera);
      return{x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};
    });
    const boxes=['.topbar','#scorecard','.control-tray','#camera-fly-hud'].map(s=>{const r=document.querySelector(s)!.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};});
    return{distance:camera.position.distanceTo(g.scene.controls.target),points,boxes};
  });
  const visible=focused.boxes.filter(b=>b.width>0&&b.height>0),landscape=viewport.width>viewport.height;
  const top=landscape?0:Math.max(...focused.boxes.slice(0,2).filter(b=>b.height>0).map(b=>b.bottom));
  const bottom=landscape?viewport.height:Math.min(...focused.boxes.slice(2).filter(b=>b.height>0).map(b=>b.top));
  const left=landscape?Math.max(...visible.filter(b=>b.right<viewport.width/2).map(b=>b.right))+10:16;
  const right=landscape?Math.min(...visible.filter(b=>b.left>viewport.width/2).map(b=>b.left))-10:viewport.width-16;
  for(const point of focused.points){expect(point.x).toBeGreaterThan(left);expect(point.x).toBeLessThan(right);expect(point.y).toBeGreaterThan(top+10);expect(point.y).toBeLessThan(bottom-10);}
  await page.evaluate(async()=>{const g=(window as any).__pool;g.angle=g.targetAngle;g.__cameraShow=true;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  await page.screenshot({path:`/tmp/pool-mobile-camera-${viewport.width}.png`});
  await page.evaluate(()=>{(window as any).__pool.__cameraShow=false;});
  const whole=await page.evaluate(()=>{const g=(window as any).__pool;g.frameBalls(true);return g.scene.controls.object.position.distanceTo(g.scene.controls.target);});
  expect(whole).toBeGreaterThan(focused.distance*1.15);
  const optedOut=await page.evaluate(()=>{const g=(window as any).__pool;g.options.autoCamera=false;const before=g.scene.controls.object.position.toArray();g.frameBalls(false,true);return{before,after:g.scene.controls.object.position.toArray()};});
  expect(optedOut.after).toEqual(optedOut.before);
});

for(const viewport of [{width:390,height:844},{width:844,height:390}])test(`rail and corner framing keeps its angle during mobile pinch at ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});await prepare(page);
  for(const [x,y]of [[.04,.5],[.04,.06],[2.5,1.21]]){
    const before=await page.evaluate(async([x,y])=>{
      const g=(window as any).__pool;Object.assign(g.cue(),{x,y});g.frameBalls();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const c=g.scene.controls,o=c.object.position.clone().sub(c.target);
      return{phi:Math.acos(o.y/o.length()),distance:o.length()};
    },[x,y]);
    expect(before.phi).toBeCloseTo(1.12,3);
    // Browser pinch input reaches OrbitControls through real touch pointer events.
    const session=await page.context().newCDPSession(page);
    const cy=viewport.height/2,cx=viewport.width/2;
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-25,y:cy,id:1},{x:cx+25,y:cy,id:2}]});
    for(const d of [45,70,100,140])await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-d,y:cy,id:1},{x:cx+d,y:cy,id:2}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const after=await page.evaluate(()=>{
      const c=(window as any).__pool.scene.controls,o=c.object.position.clone().sub(c.target);
      return{phi:Math.acos(o.y/o.length()),distance:o.length(),height:c.object.position.y,moving:(window as any).__pool.scene.cameraRig.moving};
    });
    expect(after.phi).toBeCloseTo(before.phi,3);expect(after.distance).toBeLessThan(before.distance);
    expect(after.height).toBeGreaterThan(.058);expect(after.moving).toBe(false);
    if(x===.04&&y===.5){
      await page.evaluate(async()=>{const g=(window as any).__pool;g.angle=g.targetAngle;g.__cameraShow=true;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
      await page.screenshot({path:`/tmp/pool-101-rail-pinch-${viewport.width}.png`});
      await page.evaluate(()=>{(window as any).__pool.__cameraShow=false;});
    }
  }
});
});
test('desktop framing retains all legal targets and manual camera input cancels automatic motion',async({page})=>{
  await page.setViewportSize({width:1280,height:800});await prepare(page);
  const result=await page.evaluate(()=>{
    const g=(window as any).__pool,rig=g.scene.cameraRig,frame=rig.frame.bind(rig);let points:any[]=[];
    rig.frame=(...args:any[])=>{points=args[0];return frame(...args);};g.frameBalls();
    const included=points.some(p=>p.x===2.3&&p.y===1.05)&&points.some(p=>p.x===2.2&&p.y===.2);
    const moving=rig.moving;rig.cancel(true);const before=g.scene.controls.object.position.toArray();rig.update(performance.now()+2000);
    return{included,moving,afterCancel:rig.moving,before,after:g.scene.controls.object.position.toArray()};
  });
  expect(result.included).toBe(true);expect(result.moving).toBe(true);expect(result.afterCancel).toBe(false);expect(result.after).toEqual(result.before);
});
