import { acceptWelcomeBeforeLoad, waitForOpening } from './welcomeFixture';
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({page}) => {
  await acceptWelcomeBeforeLoad(page);
  // This suite covers the standalone frontend. Backend API tests cover /api/version.
  await page.route('**/api/account',route=>route.fulfill({json:{account:null,stats:null}}));
  await page.route('**/api/version', route => route.fulfill({json:{version:'e2e'}}));
  await page.addInitScript(() => {
    const w=window as any, requestFrame=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>requestFrame(time=>{
      // Pause redundant GPU draws in-page before the first post-init frame,
      // not after several slow browser-protocol round trips. Game updates and
      // real browser animation frames continue for controls and actionability.
      if(w.__pool && !w.__draw) {
        const renderer=w.__pool.scene.renderer;
        w.__draw=renderer.render.bind(renderer);
        w.__renderedCalls=renderer.info.render.calls;
        renderer.render=()=>{};
      }
      callback(time);
    });
  });
});

async function openGame(page: Page, reload = false) {
  if (reload) await page.reload(); else await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__draw, undefined, {timeout:10000,polling:100});
  await expect(page.locator('#version')).toHaveText('ve2e');
  await waitForOpening(page);
}

test('loads, renders table, breaks and resolves', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openGame(page);
  await expect(page).toHaveTitle(/Pool Simulator/);
  const canvas = page.locator('#game-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(200);
  await expect(page.locator('link[rel="icon"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__renderedCalls)).toBeGreaterThan(0);
  if (await page.locator('#helppanel').isVisible()) await page.locator('#closehelp').click();
  // Aim at the apex ball, hold to charge full power, release to break.
  const cbox = (await canvas.boundingBox())!;
  // Press mid-felt, drag back ~400px for full power, release to break.
  const sx = cbox.x + cbox.width / 2, sy = cbox.y + cbox.height / 2;
  await page.mouse.move(sx, sy);
  await page.evaluate(() => {
    const g = (window as unknown as { __pool: { angle: number; targetAngle: number } }).__pool;
    g.angle = 0; g.targetAngle = 0; // +x straight into the rack from the head spot
  });
  await page.mouse.down();
  await page.evaluate(() => {const g=(window as any).__pool;g.angle=g.targetAngle=0;});
  await page.mouse.move(sx - 180, sy + 100, { steps: 4 });
  await page.mouse.up();
  // Shot must actually be underway now.
  await page.waitForFunction(
    () => (window as unknown as { __pool: { mode: string } }).__pool.mode === 'rolling',
    undefined, { timeout: 5000 },
  );
  // Exercise the same game frame/physics path without waiting on GPU frames
  // or real-time playback. No balls are forcibly stopped or rules bypassed.
  const result=await page.evaluate(() => {
    const g=(window as any).__pool;
    let frames=0;
    while(g.mode==='rolling' && frames<180) {g.accumulator+=.25;g.frame();frames++;}
    g.scene.renderer.render=(...args:any[])=>{
      (window as any).__draw(...args);
      (window as any).__afterShotCalls=g.scene.renderer.info.render.calls;
      g.scene.renderer.render=()=>{};
    };
    return {mode:g.mode, firstContact:g.ev.firstContact, asleep:g.gs.balls.every((b:any)=>b.asleep||b.potted)};
  });
  expect(result.mode).not.toBe('rolling');expect(result.firstContact).not.toBeNull();expect(result.asleep).toBe(true);
  await expect(page.locator('#msg')).toContainText(/Player [12]/);
  await page.waitForFunction(() => (window as any).__afterShotCalls>0, undefined, {timeout:10000,polling:100});
  expect(errors).toEqual([]);
});

test('adaptive controls, readable settings, and desktop version card', async ({ page }) => {
  await page.setViewportSize({width:1440,height:900}); await openGame(page);
  await expect(page.locator('#mouseguide')).toBeVisible();
  expect((await page.locator('#helppanel').boundingBox())!.width).toBeGreaterThanOrEqual(500);
  await expect(page.locator('.guide-tabs')).toHaveCount(0);
  await expect(page.locator('#version')).toHaveCSS('position','fixed');
  await page.locator('#settingsbtn').click();
  expect((await page.locator('#settingspanel').boundingBox())!.width).toBeGreaterThan(500);
  await expect(page.locator('#scratchrule')).toBeDisabled();
  await page.locator('#rulespreset').selectOption('custom');
  await expect(page.locator('#scratchrule')).toBeEnabled();
  await page.locator('#normalspeed').fill('4.5');
  await page.locator('#applyrules').click();
  expect(await page.evaluate(() => (window as any).__pool.gs.rules.normalMax)).toBe(4.5);
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#helppanel')).toBeHidden();
  await page.locator('#helpbtn').click();
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch'})));
  await expect(page.locator('#touchguide')).toBeVisible();
  await expect(page.locator('#mouseguide')).toBeHidden();
  // A narrow desktop viewport retains desktop controls; mobile relocation requires a coarse pointer.
  await expect(page.locator('#version')).toHaveCSS('position','fixed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pocket indicators update before rest without overwriting the next turn', async ({ page }) => {
  await openGame(page);
  const result = await page.evaluate(() => {
    const g=(window as any).__pool; g.gs.open=false; g.gs.groups=['solid','stripe'];g.gs.breakShot=false;
    g.hud();
    const b=g.gs.balls.find((b:any)=>b.n===1); b.potted=true;
    const moving=g.gs.balls.find((b:any)=>b.n===2); moving.x=1;moving.y=.5;moving.vx=.2;moving.asleep=false;
    g.ev={firstContact:1,potted:[1],offTable:[],railAfterContact:true,cuePotted:false}; g.mode='rolling';
    g.frame();
    const live={mode:g.mode, message:document.getElementById('msg')!.textContent, marked:document.querySelectorAll('.pcard:first-child .pball.potted').length};
    for(const ball of g.gs.balls) {ball.vx=ball.vy=ball.vz=ball.wx=ball.wy=ball.wz=0;ball.asleep=true;}
    g.frame(); g.frame();
    return {live, finalMessage:document.getElementById('msg')!.textContent, expected:g.gs.message};
  });
  expect(result.live.marked).toBe(1);
  expect(result.live.message).toContain('Pocketed 1');
  expect(result.live.mode).toBe('rolling');
  expect(result.finalMessage).toBe(result.expected);
});

test('bar break assigns both cards before the same player shoots again', async ({page}) => {
  await openGame(page);
  const result=await page.evaluate(()=>{
    const g=(window as any).__pool;g.gs.current=0;
    g.gs.balls.find((b:any)=>b.n===1).potted=true;
    g.ev={firstContact:1,potted:[1],offTable:[],railAfterContact:true,cuePotted:false};g.mode='rolling';
    g.frame();
    return {mode:g.mode,current:g.gs.current,groups:g.gs.groups,text:document.getElementById('scorecard')!.textContent,message:document.getElementById('msg')!.textContent};
  });
  expect(result.mode).toBe('aim');expect(result.current).toBe(0);
  expect(result.groups).toEqual(['solid','stripe']);expect(result.text).toContain('Solids');expect(result.text).toContain('Stripes');expect(result.message).toContain('shoots again');
});

test('kitchen guide and locally persisted sight shape', async ({page})=>{
  await openGame(page);
  expect(await page.locator('#railsights').inputValue()).toBe('diamonds');
  await page.locator('#settingsbtn').click();
  await page.locator('summary').filter({hasText:'Appearance'}).click();await page.locator('#railsights').selectOption('double-diamonds');
  await openGame(page, true);
  expect(await page.locator('#railsights').inputValue()).toBe('double-diamonds');
  await page.evaluate(()=>{const g=(window as any).__pool;g.gs.ballInHand=true;g.gs.placement='kitchen';g.gs.kitchenShot=true;g.mode='place';g.frame();});
  await expect(page.locator('#headstringguide')).toBeVisible();
  await expect(page.locator('#headstringguide')).toContainText('Place inside');
  await page.evaluate(()=>{const g=(window as any).__pool;g.gs.ballInHand=false;g.mode='aim';g.frame();});
  await expect(page.locator('#headstringguide')).toContainText('leave the kitchen first');
  await page.evaluate(()=>{const g=(window as any).__pool;g.gs.kitchenShot=false;g.frame();});
  await expect(page.locator('#headstringguide')).toBeHidden();
});


test('capture history survives consecutive shots and clears with a new rack', async ({page})=>{
  await openGame(page);
  const result=await page.evaluate(()=>{
    const g=(window as any).__pool;g.gs.breakShot=false;
    const capture=(numbers:number[])=>{
      for(const n of numbers)g.gs.balls.find((b:any)=>b.n===n).potted=true;
      g.ev={firstContact:numbers[0],potted:numbers,offTable:[],railAfterContact:true,cuePotted:false};g.mode='rolling';g.frame();
    };
    capture([12,3]);capture([10]);
    const order=[...g.gs.returnOrder];g.reset();return {order,reset:g.gs.returnOrder};
  });
  expect(result.order).toEqual([12,3,10]);expect(result.reset).toEqual([]);
});

test('dismissal and independent playback preference survive reload',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await openGame(page);
  await page.locator('#closehelp').click();await openGame(page, true);
  await expect(page.locator('#helppanel')).toBeHidden();
  await page.locator('#helpbtn').click();await expect(page.locator('#helppanel')).toBeVisible();
  await page.locator('#settingsbtn').click();await expect(page.locator('#fastforward')).not.toBeChecked();
  await page.locator('summary').filter({hasText:'Camera & playback'}).click();await page.locator('#fastforward').check();await page.locator('#rulespreset').selectOption('custom');
  await expect(page.locator('#fastforward')).toBeChecked();await openGame(page, true);
  await expect(page.locator('#helppanel')).toBeHidden();
  expect(await page.evaluate(()=>(window as any).__pool.options.fastForward)).toBe(true);
  await page.locator('#settingsbtn').click();await expect(page.locator('#fastforward')).toBeChecked();
});

test('live break groups are provisional and a later scratch retracts them',async({page})=>{
  await openGame(page);
  const result=await page.evaluate(()=>{
    const g=(window as any).__pool;
    g.gs.shot={current:0,open:true,breakShot:true,group:null,remaining:g.gs.balls.filter((b:any)=>b.n!==null&&b.n!==8).map((b:any)=>b.n),kitchen:false,calledBall:null,calledPocket:null};
    g.gs.balls.find((b:any)=>b.n===1).potted=true;
    const moving=g.gs.balls.find((b:any)=>b.n===2);moving.x=1;moving.y=.5;moving.vx=.2;moving.asleep=false;
    g.ev={firstContact:1,potted:[1],offTable:[],railAfterContact:true,cuePotted:false};g.mode='rolling';g.frame();
    const live={text:document.getElementById('scorecard')!.textContent,groups:[...g.gs.groups],mode:g.mode};
    g.ev.cuePotted=true;g.frame();
    return {live,after:document.getElementById('scorecard')!.textContent,groups:g.gs.groups};
  });
  expect(result.live.mode).toBe('rolling');expect(result.live.text).toContain('Solids · pending');
  expect(result.live.text).toContain('This shot: 1');expect(result.live.groups).toEqual([null,null]);
  expect(result.after).toContain('scratch');expect(result.after).not.toContain('pending shot result');expect(result.groups).toEqual([null,null]);
});

test('queued network results wait for local playback and stop at the next shot',async({page})=>{
  await openGame(page);
  const result=await page.evaluate(()=>{
    const g=(window as any).__pool,order:string[]=[];
    const b=g.gs.balls[0];b.vx=.1;b.asleep=false;g.mode='rolling';
    g.pendingNetwork.push(()=>order.push('result'),()=>{order.push('next shot');g.mode='rolling';b.asleep=false;b.vx=.1;},()=>order.push('next result'));
    g.frame();const during=[...order];
    for(const ball of g.gs.balls){ball.asleep=true;ball.vx=ball.vy=ball.vz=ball.wx=ball.wy=ball.wz=0;}
    g.frame();return{during,order,queued:g.pendingNetwork.length,mode:g.mode};
  });
  expect(result.during).toEqual([]);expect(result.order).toEqual(['result','next shot']);expect(result.queued).toBe(1);expect(result.mode).toBe('rolling');
});

test('close zoom cannot orbit the camera inside the table',async({page})=>{
  await openGame(page);
  const result=await page.evaluate(async()=>{
    const controls=(window as any).__pool.scene.controls,camera=controls.object;
    controls.target.set(0,-.16,0);camera.position.set(.36,-.16,.48);
    controls.maxPolarAngle=Math.PI*.49;
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    return {height:camera.position.y,distance:camera.position.distanceTo(controls.target),angle:controls.maxPolarAngle};
  });
  expect(result.height).toBeGreaterThan(.12);
  expect(result.distance).toBeCloseTo(.6,6);
  expect(result.angle).toBeLessThan(Math.PI/2);
});

test('cue ball markings persist without changing the physical ball state',async({page})=>{
  await openGame(page);await page.locator('#settingsbtn').click();
  const before=await page.evaluate(()=>JSON.stringify((window as any).__pool.gs.balls));
  await page.locator('summary').filter({hasText:'Appearance'}).click();
  for(const style of ['red-ring','blue-dot','black-triangles','plain','red-spots'])await page.locator('#cueappearance').selectOption(style);
  expect(await page.evaluate(()=>JSON.stringify((window as any).__pool.gs.balls))).toBe(before);
  await openGame(page,true);
  expect(await page.locator('#cueappearance').inputValue()).toBe('red-spots');
  expect(await page.evaluate(()=>localStorage.getItem('pool:cue-style'))).toBe('red-spots');
});

test('head-string tip stays dismissed after reload while its tutorial remains available',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await openGame(page);
  const kitchen=()=>page.evaluate(()=>{const g=(window as any).__pool;g.gs.ballInHand=true;g.gs.placement='kitchen';g.gs.kitchenShot=true;g.mode='place';g.frame();});
  await kitchen();await expect(page.locator('#headstringguide')).toBeVisible();
  await page.locator('#dismissheadstring').click();await expect(page.locator('#headstringguide')).toBeHidden();
  await openGame(page,true);await kitchen();
  await expect(page.locator('#headstringguide')).toBeHidden();
  await expect(page.locator('#kitchenhelp')).toContainText('behind the dashed line');
  expect(await page.evaluate(()=>localStorage.getItem('pool:headstring-dismissed'))).toBe('1');
});

test('spin resets both axes and supports keyboard adjustments on desktop and mobile',async({page})=>{
  await openGame(page);const spin=page.locator('#spin'),reset=page.locator('#resetspin');
  await expect(reset).toBeDisabled();
  const size=(await spin.boundingBox())!;
  await spin.click({position:{x:size.width*.8,y:size.height*.25}});
  await expect(reset).toBeEnabled();
  const before=await page.evaluate(()=>{const g=(window as any).__pool;return[g.tipX,g.tipY];});
  expect(before[0]).toBeGreaterThan(0);expect(before[1]).toBeGreaterThan(0);
  await reset.click();
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return[g.tipX,g.tipY];})).toEqual([0,0]);
  await expect(spin).toHaveAttribute('aria-label','Cue ball spin control: centered');
  await spin.focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Shift+ArrowDown');
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return[g.tipX,g.tipY];})).toEqual([-.025,-.005]);
  await page.keyboard.press('Home');await expect(reset).toBeDisabled();
  await page.setViewportSize({width:390,height:844});await expect(reset).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('version opens a readable changelog and restores keyboard focus', async ({page})=>{
  await openGame(page);
  await page.locator('#version').click();
  await expect(page.locator('#changelog')).toBeVisible();
  await expect(page.locator('#changelog-content')).toContainText('v0.3.0');
  await page.keyboard.press('Escape');
  await expect(page.locator('#changelog')).not.toBeVisible();
  await expect(page.locator('#version')).toBeFocused();
});

test('camera preferences adapt to mobile and persist an explicit override',async({page})=>{
  await openGame(page);
  await expect(page.locator('#autocamera')).not.toBeChecked();
  await page.setViewportSize({width:390,height:844});
  await openGame(page,true);
  await expect(page.locator('#autocamera')).toBeChecked();
  for(const id of ['version','settingsbtn']) {const box=(await page.locator('#'+id).boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);}
  if(await page.locator('#privacynotice').isVisible()) await page.locator('#privacyessential').click();
  await page.screenshot({path:'/tmp/pool-mobile-camera.png'});
  await page.locator('#camera-fly-toggle').click();
  await page.getByRole('button',{name:'Move camera',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__pool.cameraMode)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>(window as any).__pool.cameraMode)).toBe(false);
  await page.locator('#settingsbtn').click();
  await page.locator('summary').filter({hasText:'Camera & playback'}).click();await page.locator('#autocamera').uncheck();
  await openGame(page,true);
  await expect(page.locator('#autocamera')).not.toBeChecked();
});

test('automatic framing waits for rest and yields to manual camera movement',async({page})=>{
  await openGame(page);
  const result=await page.evaluate(()=>{
    const g=(window as any).__pool;let framed=0;g.frameBalls=()=>framed++;g.options.autoCamera=true;
    g.cameraShotPending=true;g.cameraShotRevision=g.scene.cameraRig.revision;g.mode='wait';g.frame();const waiting=framed;
    g.mode='aim';g.frame();const settled=framed;g.frame();const once=framed;
    g.cameraShotPending=true;g.cameraShotRevision=g.scene.cameraRig.revision;g.scene.cameraRig.cancel(true);g.frame();
    return{waiting,settled,once,manual:framed};
  });
  expect(result).toEqual({waiting:0,settled:1,once:1,manual:1});
});

test('cards retain the final 8-Ball objective before and after clearing a group',async({page})=>{
  await openGame(page);
  await expect(page.locator('.pcard .eight-ball')).toHaveCount(0);
  await page.evaluate(()=>{const g=(window as any).__pool;g.gs.open=false;g.gs.groups=['solid','stripe'];g.hud();});
  await expect(page.locator('.pcard .eight-ball')).toHaveCount(2);
  await expect(page.locator('.pcard').first().locator('.balls .pball').last()).toHaveText('8');
  await expect(page.locator('.pcard').first().locator('.grp')).toHaveText('Solids · 7 remaining');
  await expect(page.locator('.pcard').first().locator('.eight-ball')).not.toHaveClass(/ready/);
  await page.evaluate(()=>{const g=(window as any).__pool;for(const b of g.gs.balls)if(b.n>=1&&b.n<=7)b.potted=true;g.hud();});
  await expect(page.locator('.pcard').first().locator('.grp')).toHaveText('On the 8-Ball');
  await expect(page.locator('.pcard').first().locator('.eight-ball')).toHaveClass(/ready/);
});

test('desktop starts behind the cue facing the rack and renders a captured ball dropping',async({page})=>{
  await openGame(page);
  const result=await page.evaluate(()=>{
    const w=window as any,g=w.__pool,scene=g.scene, camera=scene.controls.object;
    const direction=camera.position.clone().sub(scene.controls.target);
    return {x:direction.x,y:direction.y,z:direction.z,angle:g.angle};
  });
  expect(result.x).toBeLessThan(0);expect(result.y).toBeGreaterThan(0);expect(result.z).toBeCloseTo(0);expect(result.angle).toBeCloseTo(0);
  await page.evaluate(()=>{const w=window as any;w.__pool.scene.renderer.render=(s:any,c:any)=>{w.__scene=s;w.__draw(s,c);w.__pool.scene.renderer.render=()=>{};};});
  await page.waitForFunction(()=>!!(window as any).__scene);
  await page.screenshot({path:'/tmp/pool-desktop-start.png'});
  const drop=await page.evaluate(()=>{
    const w=window as any,g=w.__pool,list=g.gs.balls.map((b:any)=>({...b})),b=list.find((b:any)=>b.n===1);
    b.x=1.27;b.y=-.026;g.scene.setBalls(list,0,[],.016);
    b.potted=true;g.scene.setBalls(list,0,[1],.1);
    const mesh=w.__scene.getObjectByName('ball-b1'),start=mesh.position.y;
    g.scene.setBalls(list,0,[1],.1);const falling=mesh.position.y;
    for(let i=0;i<5;i++)g.scene.setBalls(list,0,[1],.1);
    return{start,falling,stored:mesh.position.y,visible:mesh.visible};
  });
  expect(drop.start).toBeGreaterThan(drop.falling);expect(drop.stored).toBeLessThan(-.1);expect(drop.visible).toBe(true);
});


test('CPU name appears in turn, foul, rolling, and winner messages',async({page})=>{
  await openGame(page);
  for(const [mode,message,expected] of [
    ['place','Foul: No contact · Player 2, place anywhere','Foul: No contact · CPU, place anywhere'],
    ['rolling','Player 2 to shoot','Shot in motion'],
    ['over','Player 2 wins!','CPU wins!'],
  ]) {
    const state=await page.evaluate(({mode,message})=>{const g=(window as any).__pool;g.cpuOpponent=true;g.gs.current=1;g.gs.message=message;g.mode=mode;g.hud();return{turn:document.getElementById('turn')!.textContent,message:document.getElementById('msg')!.textContent};},{mode,message});
    expect(state.turn).toBe('CPU');expect(state.message).toContain(expected);expect(state.message).not.toContain('Player 2');
  }
});

test('camera faces current player targets and aligns the idle cue with the final view',async({page})=>{
  await openGame(page);
  const results=await page.evaluate(()=>{
    const g=(window as any).__pool,rig=g.scene.cameraRig,camera=g.scene.controls.object;
    g.gs.open=false;g.gs.groups=['solid','stripe'];g.gs.current=0;
    let args:any;const frame=rig.frame.bind(rig);rig.frame=(...a:any[])=>{args=a;return frame(...a);};
    g.targetAngle=1.7;
    g.frameBalls();rig.update(performance.now()+1000);
    const solids=args[2].map((b:any)=>b.n),cue=args[1].n;
    g.gs.current=1;g.frameBalls();const stripes=args[2].map((b:any)=>b.n);
    for(const b of g.gs.balls)if(b.n>=9)b.potted=true;
    g.frameBalls();const eight=args[2].map((b:any)=>b.n);
    rig.update(performance.now()+1000);
    const offset=camera.position.clone().sub(g.scene.controls.target),ball=g.gs.balls.find((b:any)=>b.n===8),c=g.cue();
    const alignment=(offset.x*(ball.x-c.x)+offset.z*(ball.y-c.y))/Math.hypot(offset.x,offset.z)/Math.hypot(ball.x-c.x,ball.y-c.y);
    const cueAlignment=(Math.cos(g.targetAngle)*offset.x+Math.sin(g.targetAngle)*offset.z)/Math.hypot(offset.x,offset.z);
    const angle=g.targetAngle;
    g.gs.ballInHand=true;g.frameBalls();const placement=args[1]===undefined;
    return{solids,stripes,eight,cue,alignment,placement,cueAlignment,placementKeepsAim:g.targetAngle===angle};
  });
  expect(results.solids.sort((a:number,b:number)=>a-b)).toEqual([1,2,3,4,5,6,7]);
  expect(results.stripes.sort((a:number,b:number)=>a-b)).toEqual([9,10,11,12,13,14,15]);
  expect(results.eight).toEqual([8]);expect(results.cue).toBeNull();expect(results.alignment).toBeCloseTo(-1);
  expect(results.placement).toBe(true);expect(results.cueAlignment).toBeCloseTo(-1);expect(results.placementKeepsAim).toBe(true);
});

test('settings title and close button stay visible while scrolling on desktop and mobile',async({page})=>{
  await openGame(page);
  for(const viewport of [{width:1280,height:720},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await page.locator('#settingsbtn').click();
    const header=page.locator('#settingspanel .settings-header'),before=(await header.boundingBox())!;
    await page.locator('#settingspanel .settings-body').evaluate(el=>el.scrollTop=el.scrollHeight);
    expect(await page.locator('#settingspanel .settings-body').evaluate(el=>el.scrollTop)).toBeGreaterThan(100);
    const after=(await header.boundingBox())!;expect(after.y).toBeCloseTo(before.y);
    await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    await expect(page.locator('#settingspanel')).not.toBeVisible();
    await expect(page.locator('#settingsbtn')).toBeFocused();
    await page.locator('#settingsbtn').click();await page.keyboard.press('Escape');
    await expect(page.locator('#settingspanel')).not.toBeVisible();
    await expect(page.locator('#settingsbtn')).toBeFocused();
  }
});

test('touch drag aims and pinch followed by parallel drag orbits without firing',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});
  await openGame(page);
  // First-visit privacy UI can cover the felt: choose storage before touching the table.
  if(await page.locator('#privacynotice').isVisible())await page.locator('#privacyessential').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.scene.cameraRig.moving)).toBe(false);
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const send=(type:'touchStart'|'touchMove'|'touchEnd',touchPoints:{x:number;y:number;id:number}[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
  const state=()=>page.evaluate(()=>{const g=(window as any).__pool,c=g.scene.controls;return {theta:c.getAzimuthalAngle(),distance:c.getDistance(),aim:g.targetAngle,mode:g.mode,pointers:g.pointers.size};});
  const points=await page.evaluate(()=>{
    const g=(window as any).__pool,cue=g.cue();
    const exposed=(x:number,y:number)=>document.elementFromPoint(x,y)?.id==='game-canvas';
    const felt:Array<{x:number;y:number;angle:number}>=[];
    for(let y=200;y<innerHeight-180;y+=20)for(let x=40;x<innerWidth-40;x+=20){
      const p=g.scene.pickFelt(x,y);
      if(exposed(x,y)&&p&&Math.hypot(p[0]-cue.x,p[1]-cue.y)>.08)
        felt.push({x,y,angle:Math.atan2(p[1]-cue.y,p[0]-cue.x)});
    }
    for(const from of felt)for(const to of felt){
      const delta=Math.abs(Math.atan2(Math.sin(to.angle-from.angle),Math.cos(to.angle-from.angle)));
      if(Math.hypot(to.x-from.x,to.y-from.y)>60&&delta>.2&&delta<1.5)return {from,to};
    }
    throw new Error('No two unobscured felt points with distinct aiming directions');
  });
  await send('touchStart',[{x:points.from.x,y:points.from.y,id:1}]);
  const aimed=await state();
  await send('touchMove',[{x:points.to.x,y:points.to.y,id:1}]);
  expect(Math.abs((await state()).aim-aimed.aim)).toBeGreaterThan(.01);
  await send('touchEnd',[]);
  expect((await state()).mode).toBe('aim');
  await expect(page.locator('#touchshoot')).toBeVisible();
  const center=await page.evaluate(()=>{
    for(let y=260;y<innerHeight-220;y+=20)for(let x=130;x<innerWidth-130;x+=10){
      const path=[[-60,0],[60,0],[-95,0],[95,0],[-55,20],[135,20],[-15,30]];
      if(path.every(([dx,dy])=>document.elementFromPoint(x+dx,y+dy)?.id==='game-canvas'))return {x,y};
    }
    throw new Error('No exposed canvas region for a native pinch and parallel drag');
  });
  const finger=(dx:number,dy:number,id:number)=>({x:center.x+dx,y:center.y+dy,id});
  const initial=await state();
  await send('touchStart',[finger(-60,0,1),finger(60,0,2)]);
  await send('touchMove',[finger(-95,0,1),finger(95,0,2)]);
  const zoomed=await state();
  expect(zoomed.distance).toBeLessThan(initial.distance);
  await send('touchMove',[finger(-55,20,1),finger(135,20,2)]);
  await expect.poll(async()=>Math.abs((await state()).theta-zoomed.theta)).toBeGreaterThan(.05);
  await send('touchEnd',[finger(-55,20,1)]);
  const held=await state();
  await send('touchMove',[finger(-15,30,1)]);
  expect((await state()).aim).toBe(held.aim);
  await send('touchEnd',[]);
  expect((await state()).mode).toBe('aim');
  expect((await state()).pointers).toBe(0);
  await expect(page.locator('#touchshoot')).toBeEnabled();
  await page.evaluate(()=>{const w=window as any,r=w.__pool.scene.renderer;r.render=(...args:any[])=>{w.__draw(...args);r.render=()=>{};};});
  await page.screenshot({path:'/tmp/pool-060-touch.png'});
  const button=(await page.locator('#touchshoot').boundingBox())!;
  await send('touchStart',[{x:button.x+button.width/2,y:button.y+button.height/2,id:1}]);
  await send('touchEnd',[]);
  expect((await state()).mode).toBe('rolling');
});

test('compact mobile scores expand and explicit trackpad scrolling orbits',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openGame(page);
  await page.evaluate(()=>{const g=(window as any).__pool;g.gs.groups=['solid','stripe'];g.gs.open=false;g.hud();});
  await expect(page.locator('.pcard')).toHaveCount(2);
  await expect(page.locator('.pcard .balls').first()).toBeHidden();
  await page.locator('.pcard').first().click();
  await expect(page.locator('.pcard .balls').first()).toBeVisible();
  await page.locator('.pcard').first().click();
  await expect(page.locator('#spin')).toBeVisible();
  await expect(page.locator('#resetspin')).toBeVisible();
  await expect(page.locator('#cpubtn')).toBeHidden();
  await page.locator('#morecontrols').click();
  await expect(page.locator('#cpubtn')).toBeVisible();
  await page.locator('#morecontrols').click();
  await expect(page.locator('#spin')).toBeVisible();
  const before=await page.evaluate(()=>(window as any).__pool.scene.controls.getAzimuthalAngle());
  await page.locator('#camera-input-profile').selectOption('trackpad');
  await page.locator('#game-canvas').dispatchEvent('wheel',{deltaX:80,bubbles:true,cancelable:true});
  const after=await page.evaluate(()=>{const g=(window as any).__pool;return {theta:g.scene.controls.getAzimuthalAngle(),mode:g.mode};});
  expect(Math.abs(after.theta-before)).toBeGreaterThan(.01);expect(after.mode).toBe('aim');
  await page.screenshot({path:'/tmp/pool-060-mobile.png'});
});

test('premium badges and unlimited racks follow the server account',async({page})=>{
  let premium=true,starts=0;
  await page.route('**/api/account',route=>route.fulfill({json:{account:{id:'premium',username:'PremiumPlayer',createdAt:0,premium},stats:null}}));
  await page.route('**/api/opponents/jev',route=>route.fulfill({json:{available:true,usage:{unlimited:premium,budget:{remainingNano:0,limitNano:150000000,unknownRequests:0},resetsAt:2000000000}}}));
  await openGame(page);
  await page.locator('#settingsbtn').click();await expect(page.locator('#settingspremium')).toBeVisible();
  await page.locator('#closesettings').click();
  await page.locator('#onlinebtn').click();await page.locator('#accountbtn').click();
  await expect(page.locator('#accountpremium')).toBeVisible();
  await expect(page.locator('#accountjev')).toContainText('Unlimited Jev AI games');
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#accountpremium')).toBeVisible();
  await page.locator('#accountclose').click();await page.locator('#closeonline').click();
  await page.setViewportSize({width:1280,height:800});
  const state=await page.evaluate(()=>{
    const g=(window as any).__pool;
    return {balls:g.gs.balls,return_order:[],current:0,groups:[null,null],open:true,ball_in_hand:false,break_shot:true,placement:'none',kitchen_shot:false,rules:g.gs.rules,revision:0,winner:null,message:'Player 1 to break'};
  });
  await page.route('**/api/opponents/jev/games',route=>{
    if(route.request().postDataJSON().new_game===true)starts++;
    return route.fulfill({json:{id:'premium-'+starts,state,status:'active',expiresAt:null}});
  });
  await page.locator('#jevbtn').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.id)).toBe('premium-1');
  await expect(page.locator('#opponentstatus')).toContainText('Unlimited Jev AI');
  for(const n of [2,3]){
    await page.locator('#rack').click();
    await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.id)).toBe('premium-'+n);
  }
  premium=false;
  await page.locator('#settingsbtn').click();await expect(page.locator('#settingspremium')).toBeHidden();
  await page.locator('#closesettings').click();
  await page.locator('#onlinebtn').click();await page.locator('#accountbtn').click();
  await expect(page.locator('#accountpremium')).toBeHidden();
  await expect(page.locator('#accountjev')).toContainText('$0.0000 remaining');
});

test('Jev requires sign-in while CPU remains available to guests', async ({page}) => {
  await openGame(page);
  await page.locator('#jevbtn').click();
  await expect(page.locator('#accountdialog')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__pool.jevOpponent)).toBe(false);
  await page.locator('#accountclose').click();
  await page.locator('#cpubtn').click();
  expect(await page.evaluate(()=>(window as any).__pool.cpuOpponent)).toBe(true);
});

test('Jev new rack discards an in-flight turn and opens a fresh server game', async ({page}) => {
  await page.route('**/api/account',route=>route.fulfill({json:{account:{id:'jev-test',username:'Tester',createdAt:0},stats:null}}));
  await page.route('**/api/opponents/jev',route=>route.fulfill({json:{available:true,usage:{budget:{remainingNano:150000000,limitNano:150000000,unknownRequests:0},resetsAt:2000000000}}}));
  await openGame(page);
  const state=await page.evaluate(()=>{
    const g=(window as any).__pool;
    return {balls:g.gs.balls,return_order:[],current:0,groups:[null,null],open:true,
      ball_in_hand:false,break_shot:true,placement:'none',kitchen_shot:false,rules:g.gs.rules,
      revision:0,winner:null,message:'Player 1 to break'};
  });
  let starts=0;
  await page.route('**/api/opponents/jev/games',route=>{expect(route.request().postDataJSON().new_game).toBe(true);return route.fulfill({json:{id:++starts===1?'daily-game':'fresh-game',state,status:'active'}});});
  if(await page.locator('#helppanel').isVisible())await page.locator('#closehelp').click();
  let release:(()=>void)|undefined,requests=0;
  await page.route('**/api/opponents/jev/games/daily-game/turn',async route=>{
    requests++;
    await new Promise<void>(resolve=>{release=resolve;});
    await route.fulfill({status:409,json:{detail:'Resume game'}}).catch(()=>{});
  });
  await page.locator('#jevbtn').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.id)).toBe('daily-game');
  await page.evaluate(()=>{const g=(window as any).__pool;g.angle=.35;g.targetAngle=.35+Math.PI;g.fire(.4);});
  await expect.poll(()=>requests).toBe(1);
  await page.locator('#rack').click();
  release!();
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.id)).toBe('fresh-game');
  await expect(page.locator('#opponentstatus')).not.toContainText('Resume game');
  expect(starts).toBe(2);
});

test('optional analytics waits for consent, withdraws, and leaves play available',async({page})=>{
  let events=0;
  await page.route('**/api/privacy/consent',route=>route.fulfill({json:{analytics:route.request().postDataJSON().allow}}));
  await page.route('**/api/privacy/events',route=>{events++;return route.fulfill({status:204});});
  await openGame(page);
  await page.locator('#settingsbtn').click();
  expect(events).toBe(0);
  await page.locator('#closesettings').click();
  await page.locator('#privacybtn').click();
  await page.locator('#privacyaccept').click();
  await expect.poll(()=>events).toBe(1);
  await page.locator('#settingsbtn').click();
  await expect.poll(()=>events).toBe(2);
  await page.locator('#closesettings').click();
  await page.locator('#privacybtn').click();await page.locator('#privacyreject').click();
  await expect(page.locator('#privacychoices')).not.toBeVisible();
  await page.locator('#settingsbtn').click();
  expect(events).toBe(2);
});

test('optional interactive tutorial responds to controls and stays dismissed',async({page})=>{
  await openGame(page);
  await expect(page.locator('#tutorial')).toBeHidden();
  if(!await page.locator('#helppanel').isVisible())await page.locator('#helpbtn').click();
  await page.locator('#starttutorial').click();
  await expect(page.locator('#tutorialtitle')).toContainText('Line up');
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:844});
    await expect.poll(async()=>page.evaluate(()=>{
      const panel=document.getElementById('tutorial')!.getBoundingClientRect();
      return Math.abs((panel.left+panel.right)/2-innerWidth/2)<2 && panel.top>=0 && panel.bottom<180;
    })).toBe(true);
  }

  const point=await page.evaluate(()=>{
    const g=(window as any).__pool;
    for(let y=200;y<innerHeight-120;y+=20)for(let x=20;x<innerWidth-20;x+=20){
      if(document.elementFromPoint(x,y)?.id==='game-canvas' && g.scene.pickFelt(x,y))return {x,y};
    }
    throw new Error('No exposed felt for tutorial aiming');
  });
  await page.mouse.move(point.x,point.y);
  await expect(page.locator('#tutorialnext')).toHaveText('Next');
  await page.locator('#tutorialnext').click();
  await page.locator('#spin').focus();await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tutorialprogress')).toContainText('worked');
  await page.locator('#resetspin').click();
  await page.locator('#tutorialnext').click();
  await page.locator('#camera-input-profile').selectOption('trackpad');
  await page.mouse.move(point.x,point.y);await page.mouse.wheel(100,0);
  await expect(page.locator('#tutorialprogress')).toContainText('worked');
  await page.locator('#tutorialnext').click();
  await expect(page.locator('#tutorialbody')).toContainText('release');
  await page.locator('#tutorialclose').click();
  await openGame(page,true);
  await expect(page.locator('#tutorial')).toBeHidden();
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#scoretoggle')).toHaveCount(0);
  await page.locator('.pcard').first().focus();await page.keyboard.press('Enter');
  await expect(page.locator('.pcard').first()).toHaveAttribute('aria-expanded','true');
});

test('offline CPU places behind the head string and actually fires its turn', async ({page})=>{
  await openGame(page);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(()=>{
    const g=(window as any).__pool;
    g.cpuOpponent=true;g.jevGame=null;g.room=null;
    for(const b of g.gs.balls) b.potted=true;
    Object.assign(g.gs.balls[0],{potted:true,asleep:true,x:.25,y:.7});
    Object.assign(g.gs.balls[1],{potted:false,asleep:true,n:1,x:1.5,y:.55});
    Object.assign(g.gs.balls[2],{potted:false,asleep:true,n:8,x:2.1,y:1.1});
    Object.assign(g.gs,{current:1,groups:['stripe','solid'],open:false,breakShot:false,
      ballInHand:true,placement:'kitchen',kitchenShot:true,winner:null});
    g.mode='place';g.cpuTimer=-1000;
    (window as any).__originalPick=g.scene.pickFelt;
    g.scene.pickFelt=()=>[.2,.4];
  });
  const box=(await page.locator('#game-canvas').boundingBox())!;
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  const result=await page.evaluate(async()=>{
    const g=(window as any).__pool;
    g.scene.pickFelt=(window as any).__originalPick;
    const humanCouldPlace=!g.gs.ballInHand;
    await g.cpuMove();
    const fired={mode:g.mode,x:g.gs.balls[0].x,hand:g.gs.ballInHand,potted:g.gs.balls[0].potted};
    // Stop future CPU turns while resolving this exact shot through real frame playback.
    g.cpuOpponent=false;
    for(let n=0;n<200 && g.mode==='rolling';n++){g.accumulator+=.25;g.frame();}
    return {fired,humanCouldPlace,mode:g.mode,firstContact:g.ev.firstContact,message:g.gs.message,
      asleep:g.gs.balls.every((b:any)=>b.asleep||b.potted)};
  });
  expect(result.fired.mode).toBe('rolling');expect(result.fired.x).toBeLessThan(2.54/4);
  expect(result.humanCouldPlace).toBe(false);expect(errors).toEqual([]);
  expect(result.fired.hand).toBe(false);expect(result.fired.potted).toBe(false);
  expect(result.mode).not.toBe('rolling');expect(result.firstContact).toBe(1);
  expect(result.asleep).toBe(true);expect(result.message).not.toContain('Foul');
});

test('CPU presents its immutable cue, locks human controls, and strikes once in that direction',async({page})=>{
  await openGame(page);
  const result=await page.evaluate(async()=>{
    const g=(window as any).__pool;g.cpuOpponent=true;g.gs.current=1;g.mode='aim';
    g.angle=.4;g.targetAngle=.8;g.power=.23;g.tipX=.12;g.tipY=-.08;
    const rendered:any[]=[],fire=g.fire.bind(g),setCue=g.scene.setCue.bind(g.scene);
    g.scene.setCue=(...args:any[])=>{rendered.push(args);setCue(...args);};
    const strikes:any[]=[];
    g.fire=(...args:any[])=>{strikes.push({angle:g.angle,target:g.targetAngle,args});fire(...args);};
    const pending=g.cpuMove();g.frame();const hidden=rendered.at(-1)[0]===false;
    await g.cpuMove();
    while(!g.opponentAction?.shot)await new Promise(requestAnimationFrame);
    const selected=g.opponentAction.shot,before={angle:g.targetAngle,tip:g.tipX,ball:g.calledBall,power:g.humanPower,x:g.placeX};
    g.setSpin(.4,.3);
    const canvas=document.getElementById('game-canvas')!;canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowLeft',bubbles:true}));
    canvas.dispatchEvent(new PointerEvent('pointermove',{clientX:550,clientY:400,pointerType:'mouse',bubbles:true}));
    const call=document.getElementById('callball') as HTMLSelectElement;call.value='8';call.dispatchEvent(new Event('change'));
    const power=document.getElementById('touchpower') as HTMLInputElement;power.value='99';power.dispatchEvent(new Event('input'));
    const after={angle:g.targetAngle,tip:g.tipX,ball:g.calledBall,power:g.humanPower,x:g.placeX};
    g.frame();const visible=rendered.at(-1);await pending;
    return {hidden,before,after,visible,selected,strikes,mode:g.mode,humanSettings:{power:g.power,tipX:g.tipX,tipY:g.tipY},
      cueAngles:rendered.filter(x=>x[0]).map(x=>x[3]),pulls:rendered.filter(x=>x[0]).map(x=>x[4])};
  });
  expect(result.hidden).toBe(true);expect(result.after).toEqual(result.before);
  expect(result.humanSettings).toEqual({power:.23,tipX:.12,tipY:-.08});
  expect(result.visible[0]).toBe(true);expect(result.visible[3]).toBe(result.selected.aim);
  expect(result.strikes).toHaveLength(1);expect(result.strikes[0].angle).toBe(result.selected.aim);
  expect(result.strikes[0].target).toBe(result.selected.aim);expect(result.mode).toBe('rolling');
  expect(result.cueAngles.every((a:number)=>a===result.selected.aim)).toBe(true);
  expect(Math.max(...result.pulls)-Math.min(...result.pulls)).toBeGreaterThan(.04);
});

test('reracking cancels a prepared opponent stroke before it can fire',async({page})=>{
  await openGame(page);
  const result=await page.evaluate(async()=>{
    const g=(window as any).__pool;g.cpuOpponent=true;g.gs.current=1;
    let strikes=0;const fire=g.fire.bind(g);g.fire=(...args:any[])=>{strikes++;fire(...args);};
    const pending=g.cpuMove();
    while(!g.opponentAction?.shot)await new Promise(requestAnimationFrame);
    g.reset();const state=g.gs;await pending;
    return {strikes,same:g.gs===state,current:g.gs.current,mode:g.mode,action:g.opponentAction};
  });
  expect(result).toMatchObject({strikes:0,same:true,mode:'aim',action:null});expect([0,1]).toContain(result.current);
});

test('Jev cue presentation uses authoritative placement and strike before final state',async({page})=>{
  await openGame(page);
  const state=await page.evaluate(()=>{
    const g=(window as any).__pool;g.cpuOpponent=true;g.jevOpponent=true;g.jevGame={id:'cue-test',revision:0};
    g.gs.current=1;g.gs.ballInHand=true;g.gs.placement='kitchen';g.gs.kitchenShot=true;g.mode='place';g.power=.23;
    return {balls:g.gs.balls,return_order:[],current:0,groups:[null,null],open:true,ball_in_hand:false,
      break_shot:false,placement:'none',kitchen_shot:false,rules:g.gs.rules,revision:1,winner:null,message:'Player 1 to shoot'};
  });
  const shot={aim:.15,power:.35,tipX:0,tipY:.1,calledBall:1,calledPocket:0,vmax:3.5,elevation:.12};
  await page.route('**/api/opponents/jev/games/cue-test/turn',route=>{
    expect(route.request().postDataJSON()).toEqual({revision:0});
    return route.fulfill({json:{id:'cue-test',state,shot,placement:{x:.3,y:.4},by:1,source:'jev',family:'direct',expiresAt:null}});
  });
  const result=await page.evaluate(async()=>{
    const g=(window as any).__pool,cues:any[]=[],strikes:any[]=[],render=g.scene.setCue.bind(g.scene),fire=g.fire.bind(g);
    g.scene.setCue=(...args:any[])=>{if(args[0]&&g.opponentAction)cues.push(args);render(...args);};
    g.fire=(...args:any[])=>{strikes.push({aim:g.angle,tipX:g.tipX,tipY:g.tipY,x:g.cue().x,y:g.cue().y,args});fire(...args);};
    await g.playJevTurn();const mode=g.mode;
    g.cpuOpponent=false;
    for(let i=0;i<220&&g.mode==='rolling';i++){g.accumulator+=.25;g.frame();}
    return {cues,strikes,mode,humanPower:g.power,revision:g.jevGame.revision,current:g.gs.current};
  });
  expect(result.mode).toBe('rolling');expect(result.strikes).toHaveLength(1);expect(result.humanPower).toBe(.23);
  // Opponent spin travels in the immutable shot, leaving the human's HUD unchanged.
  expect(result.strikes[0]).toEqual({aim:shot.aim,tipX:0,tipY:0,x:.3,y:.4,args:[.35,3.5,.12,{...shot,placement:{x:.3,y:.4}}]});
  expect(result.cues.length).toBeGreaterThan(2);
  expect(result.cues.every((c:any[])=>c[1]===.3&&c[2]===.4&&c[3]===shot.aim&&c[7]===shot.elevation)).toBe(true);
  expect(result.revision).toBe(1);expect(result.current).toBe(0);
});

test('reduced motion shows a static opponent cue',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await openGame(page);
  const result=await page.evaluate(async()=>{
    const g=(window as any).__pool,cues:any[]=[],render=g.scene.setCue.bind(g.scene);
    g.scene.setCue=(...args:any[])=>{if(args[0]&&g.opponentAction)cues.push(args);render(...args);};
    g.cpuOpponent=true;g.gs.current=1;await g.cpuMove();
    return {pulls:cues.map(c=>c[4]),mode:g.mode};
  });
  expect(result.mode).toBe('rolling');expect(result.pulls.length).toBeGreaterThan(0);
  expect(result.pulls.every((pull:number)=>pull===.025)).toBe(true);
});

test('a delayed human Jev response cannot reverse the latched visible shot direction',async({page})=>{
  await openGame(page);
  const state=await page.evaluate(()=>{
    const g=(window as any).__pool;g.cpuOpponent=true;g.jevOpponent=true;g.jevGame={id:'human-cue',revision:0};g.gs.current=0;
    g.angle=.35;g.targetAngle=.35+Math.PI;
    return {balls:g.gs.balls,return_order:[],current:1,groups:[null,null],open:true,ball_in_hand:false,
      break_shot:false,placement:'none',kitchen_shot:false,rules:g.gs.rules,revision:1,winner:null,message:'Player 2 to shoot'};
  });
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/opponents/jev/games/human-cue/turn',async route=>{
    const payload=route.request().postDataJSON();expect(payload.shot.aim).toBe(.35);
    await gate;
    await route.fulfill({json:{id:'human-cue',state,by:0,source:'human',placement:{x:payload.shot.x,y:payload.shot.y},
      shot:{...payload.shot,vmax:8.5,elevation:.1},expiresAt:null}});
  });
  await page.evaluate(()=>{const g=(window as any).__pool;g.angle=.35;g.targetAngle=.35+Math.PI;g.fire(.4);});
  await expect.poll(()=>page.evaluate(()=>!!(window as any).__pool.jevRequest)).toBe(true);
  const waiting=await page.evaluate(()=>{
    const g=(window as any).__pool,canvas=document.getElementById('game-canvas')!;canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowLeft',bubbles:true}));
    canvas.dispatchEvent(new PointerEvent('pointermove',{clientX:550,clientY:400,pointerType:'mouse',bubbles:true}));
    g.setSpin(.4,.4);for(let n=0;n<5;n++)g.frame();
    return {angle:g.angle,target:g.targetAngle,tip:g.tipX,action:g.opponentAction};
  });
  expect(waiting).toEqual({angle:.35,target:.35,tip:0,action:null});
  release();await expect.poll(()=>page.evaluate(()=>(window as any).__pool.mode)).toBe('rolling');
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return {angle:g.angle,target:g.targetAngle,action:g.opponentAction};})).toEqual({angle:.35,target:.35,action:null});
});

async function pullPracticeShot(page:Page){
  await expect(page.locator('.power-control')).toBeVisible();
  await expect(page.locator('.touch-shot')).not.toBeVisible();
  const drag=await page.evaluate(()=>{
    const g=(window as any).__pool;
    for(let y=160;y<innerHeight-100;y+=20)for(let x=40;x<innerWidth-50;x+=20){
      const a=g.scene.pickFelt(x,y),b=g.scene.pickFelt(x+25,y+25);
      if(a&&b&&document.elementFromPoint(x,y)?.id==='game-canvas'&&document.elementFromPoint(x+25,y+25)?.id==='game-canvas'&&Math.hypot(a[0]-b[0],a[1]-b[1])>.03)return{x,y};
    }
    throw Error('No exposed felt for pull gesture');
  });
  await page.mouse.move(drag.x,drag.y);await page.mouse.down();
  await expect(page.locator('#tutorialprogress')).toHaveText('Practice · game saved');
  await page.mouse.move(drag.x+25,drag.y+25,{steps:4});
  await expect.poll(()=>page.locator('#chargefill').evaluate(e=>parseFloat((e as HTMLElement).style.width))).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).__pool.mode)).toBe('aim');
  await page.mouse.up();
}

for(const viewport of [{width:320,height:700},{width:390,height:844},{width:844,height:390},{width:1280,height:800}]){
  test(`practice keeps staged targets clear and restores game at ${viewport.width}x${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);await openGame(page);
    const saved=await page.evaluate(()=>{const g=(window as any).__pool;g.cpuOpponent=true;g.gs.current=0;g.angle=g.targetAngle=.31;g.setSpin(.2,-.1,true);return JSON.stringify(g.gs);});
    await page.evaluate(()=> (window as any).__pool.tutorial.start());
    for(const step of ['aim','spin','camera','shot']){
      await expect(page.locator('#tutorial')).toHaveAttribute('data-step',step);
      await expect(page.locator('#tutorialprogress')).toHaveText('Practice · game saved');
      await expect.poll(()=>page.evaluate(()=>{
        const g=(window as any).__pool,camera=g.scene.controls.object;
        camera.updateMatrixWorld();
        const coach=document.getElementById('tutorial')!.getBoundingClientRect();
        const obstacles=[coach,...Array.from(document.querySelectorAll('.control-tray,#camera-fly-hud')).map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height)];
        return [{x:0,y:0},{x:.9,y:.54},{x:.45,y:.27}].every(b=>{
          const p=camera.position.clone().set(b.x-1.27,.028575,b.y-.635).project(camera);
          const x=(p.x+1)*innerWidth/2,y=(1-p.y)*innerHeight/2;
          return x>8&&x<innerWidth-8&&y>8&&y<innerHeight-48&&obstacles.every(r=>x+8<r.left||x-8>r.right||y+8<r.top||y-8>r.bottom);
        });
      })).toBe(true);
      expect(await page.evaluate(()=>{const g=(window as any).__pool;return !g.cpuOpponent&&!g.jevOpponent&&!g.room&&!g.jevGame;})).toBe(true);
      if(step!=='shot')await page.locator('#tutorialnext').click();
    }
    await pullPracticeShot(page);
    await expect(page.locator('#tutorialprogress')).toHaveText('Control worked');
    expect(await page.evaluate(()=> (window as any).__pool.mode)).toBe('rolling');
    await page.locator('#tutorialclose').click();
    expect(await page.evaluate(()=>JSON.stringify((window as any).__pool.gs))).toBe(saved);
    expect(await page.evaluate(()=>{const g=(window as any).__pool;return g.cpuOpponent&&g.angle===.31&&g.tipX===.2&&g.tipY===-.1&&g.mode==='aim';})).toBe(true);
  });
}

test('practice refuses live games and rolling shots without replacing state',async({page})=>{
  await openGame(page);
  expect(await page.evaluate(()=>{const g=(window as any).__pool,original=g.gs;let blocked=true;
    for(const field of ['room','jevGame','jevRequest']){g[field]={};blocked=blocked&&!g.tutorial.start()&&g.gs===original;g[field]=null;}
    g.mode='rolling';blocked=blocked&&!g.tutorial.start()&&g.gs===original;g.mode='aim';return blocked;
  })).toBe(true);
});

test('practice touch aiming and profile-specific coaching use real controls',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});await openGame(page);
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.evaluate(()=>{document.documentElement.classList.add('touch-input');(window as any).__pool.tutorial.start();});
  await expect(page.locator('#tutorialbody')).toContainText('one finger');
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const p=await page.evaluate(()=>{const g=(window as any).__pool;for(let y=220;y<600;y+=20)for(let x=80;x<300;x+=20)if(document.elementFromPoint(x,y)?.id==='game-canvas'&&g.scene.pickFelt(x,y))return{x,y};throw Error('No exposed felt');});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+20,y:p.y+15,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('#tutorialprogress')).toHaveText('Control worked');
  expect(await page.evaluate(()=>(window as any).__pool.mode)).toBe('aim');
  // Chromium suppresses a synthetic tap immediately after this raw CDP drag.
  // Finish its gesture window before testing a separate, real Next tap.
  await page.waitForTimeout(500);
  await touchPracticeControl(page,'#tutorialnext');await expect(page.locator('#tutorial')).toHaveAttribute('data-step','spin');await touchPracticeControl(page,'#tutorialnext');
  await expect(page.locator('#tutorialbody')).toContainText('two fingers');
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await page.evaluate(()=>document.documentElement.classList.remove('touch-input'));
  await page.locator('#camera-input-profile').selectOption('trackpad');
  await expect(page.locator('#tutorialbody')).toContainText('Option-scroll');
  await expect(page.locator('#tutorialprogress')).toHaveText('Practice · game saved');
  await page.locator('#camera-input-profile').selectOption('mouse');
  await expect(page.locator('#tutorialbody')).toContainText('Right-drag');
});

test('accepted placement frames a clear shot without aiming or calling it and respects manual camera input',async({page})=>{
  await openGame(page);
  const result=await page.evaluate(()=>{
    const g=(window as any).__pool,rig=g.scene.cameraRig;
    for(const b of g.gs.balls)b.potted=true;
    Object.assign(g.gs.balls[0],{potted:false,x:.9,y:.54});Object.assign(g.gs.balls.find((b:any)=>b.n===1),{potted:false,x:.45,y:.27});
    Object.assign(g.gs,{breakShot:false,ballInHand:false,groups:['solid','stripe'],open:false,current:0});
    g.options.autoCamera=true;g.angle=g.targetAngle=.7;g.calledBall=1;g.calledPocket=2;
    let calls:any[]=[];const frame=rig.frame.bind(rig);rig.frame=(...args:any[])=>{calls.push(args);return frame(...args);};
    g.frameBalls(false,true);
    const direct={count:calls.length,points:calls[0][0].length,theta:typeof calls[0][3],angle:g.targetAngle,ball:g.calledBall,pocket:g.calledPocket};
    g.options.autoCamera=false;g.frameBalls(false,true);const disabled=calls.length;
    g.options.autoCamera=true;g.cameraMode=true;g.frameBalls(false,true);const manual=calls.length;g.cameraMode=false;
    g.tutorial.start();g.frameBalls(false,true);const practice=calls.length;g.tutorial.close();
    const room={ready:true};g.room=room;g.seat=0;
    const state=()=>({balls:g.gs.balls.map((b:any)=>({...b})),current:0,groups:['solid','stripe'],open:false,return_order:[],ball_in_hand:false,winner:null,message:'Placed',break_shot:false,placement:'none',kitchen_shot:false,rules:g.gs.rules});
    const pending=()=>{g.gs.ballInHand=true;g.pendingPlacementCamera={revision:rig.revision,seat:0,room,x:.9,y:.54};};
    pending();rig.cancel(true);g.applyServerState(state());const moved=calls.length;
    pending();g.applyServerState(state());const accepted=calls.length;
    g.gs.ballInHand=true;g.applyServerState(state());const unsolicited=calls.length;
    g.room=null;return{direct,disabled,manual,practice,moved,accepted,unsolicited};
  });
  expect(result).toEqual({direct:{count:1,points:4,theta:'number',angle:.7,ball:1,pocket:2},disabled:1,manual:1,practice:1,moved:1,accepted:2,unsolicited:2});
});

async function touchPracticeControl(page:Page,selector:string){
  const cdp=await page.context().newCDPSession(page),box=(await page.locator(selector).boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  // Let the browser finish its touch click/double-tap window before another tap.
  await page.waitForTimeout(350);
}

test('practice shot controls follow actual pointer interface and trackpad profile',async({page,context})=>{
  await openGame(page);await page.evaluate(()=>(window as any).__pool.tutorial.start());
  for(let i=0;i<3;i++)await page.locator('#tutorialnext').click();
  await page.locator('#camera-input-profile').selectOption('trackpad');
  await expect(page.locator('#tutorialbody')).toContainText('Pull farther');
  await expect(page.locator('.power-control')).toHaveClass(/tutorial-focus/);
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.evaluate(()=>document.documentElement.classList.add('touch-input'));
  await expect(page.locator('.touch-shot')).toBeVisible();await expect(page.locator('.power-control')).not.toBeVisible();await expect(page.locator('.touch-shot')).toHaveClass(/tutorial-focus/);
  await expect(page.locator('#tutorialprogress')).toHaveText('Practice · game saved');
  await page.locator('#touchpower').fill('35');await expect(page.locator('#tutorialprogress')).toHaveText('Practice · game saved');
  await touchPracticeControl(page,'#touchshoot');await expect(page.locator('#tutorialprogress')).toHaveText('Control worked');
  await touchPracticeControl(page,'#tutorialback');await touchPracticeControl(page,'#tutorialnext');
  // Stop Chromium translating mouse events into touch before using the hybrid's mouse.
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await page.mouse.move(20,200);await page.mouse.down();await page.mouse.up();
  await expect(page.locator('#tutorial')).toHaveAttribute('data-profile','trackpad');
  await expect(page.locator('.power-control')).toHaveClass(/tutorial-focus/);
  await pullPracticeShot(page);await expect(page.locator('#tutorialprogress')).toHaveText('Control worked');
});

for(const pointer of ['mouse','touch'] as const)test(`${pointer} selects the 8-ball pocket through black center or rim without shooting`,async({page,context})=>{
  await page.setViewportSize(pointer==='touch'?{width:390,height:844}:{width:1280,height:800});await openGame(page);
  if(await page.locator('#privacynotice').isVisible())await page.locator('#privacyessential').click();
  if(await page.locator('#helppanel').isVisible())await page.locator('#closehelp').click();
  const cdp=pointer==='touch'?await context.newCDPSession(page):null;
  if(cdp)await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  for(const rim of [false,true]){
    const point=await page.evaluate(rim=>{
      const g=(window as any).__pool;g.cancelOpponent();g.cpuOpponent=false;g.gs.current=0;g.gs.winner=null;g.gs.open=false;g.gs.breakShot=false;
      g.gs.groups=['solid','stripe'];g.gs.rules.calls='eight';for(const b of g.gs.balls)if(b.n>=1&&b.n<=7)b.potted=true;
      g.mode='aim';g.calledBall=8;g.calledPocket=null;g.scene.cameraRig.cancel(true);g.hud();
      const camera=g.scene.controls.object;camera.updateMatrixWorld();const r=g.scene.renderer.domElement.getBoundingClientRect();
      const pockets=[[-.0287,-.0287],[1.27,-.066],[2.5687,-.0287],[-.0287,1.2987],[1.27,1.336],[2.5687,1.2987]];
      for(let index=0;index<pockets.length;index++){
        const [x,y]=pockets[index];const p=camera.position.clone().set(x-1.27,.04,y-.635);
        if(rim)p.add(camera.position.clone().set(1,0,0).applyQuaternion(camera.quaternion).multiplyScalar(.085));
        p.project(camera);const px=r.left+(p.x+1)*r.width/2,py=r.top+(1-p.y)*r.height/2;
        if(document.elementFromPoint(px,py)?.id==='game-canvas'&&g.scene.pickPocket(px,py)===index)return{x:px,y:py,index};
      }throw Error('No unobscured pocket target');
    },rim);
    await expect(page.locator('#msg')).toContainText('Select a pocket for the 8 ball');
    if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    else await page.mouse.click(point.x,point.y);
    expect(await page.evaluate(()=>{const g=(window as any).__pool;return{pocket:g.calledPocket,mode:g.mode,pulling:g.pulling,shot:g.gs.shot??null};})).toEqual({pocket:point.index,mode:'aim',pulling:false,shot:null});
    await expect(page.locator('#msg')).not.toContainText('Select a pocket');
  }
  await page.evaluate(()=>{const g=(window as any).__pool;g.calledPocket=null;g.cpuOpponent=true;g.gs.current=1;g.hud();});
  await expect(page.locator('#msg')).not.toContainText('Select a pocket');
});

test('touch aim continues beyond the rail while outside-table placement stays rejected',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});await openGame(page);
  if(await page.locator('#privacynotice').isVisible())await page.locator('#privacyessential').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.scene.cameraRig.moving)).toBe(false);
  const points=await page.evaluate(()=>{
    const g=(window as any).__pool;g.cpuOpponent=false;g.gs.current=0;g.mode='aim';g.calledPocket=0;
    Object.assign(g.cue(),{x:.04,y:.635});g.scene.cameraRig.cancel(true);
    const inside:any[]=[],outside:any[]=[];
    for(let y=210;y<innerHeight-190;y+=15)for(let x=15;x<innerWidth-15;x+=15){
      if(document.elementFromPoint(x,y)?.id!=='game-canvas')continue;
      const p=g.scene.pickFelt(x,y,true);if(!p)continue;
      const item={x,y,angle:Math.atan2(p[1]-g.cue().y,p[0]-g.cue().x)};
      (g.scene.pickFelt(x,y)?inside:outside).push(item);
    }
    for(const from of inside)for(const to of outside)if(Math.abs(to.angle-from.angle)>.2)return {from,to};
    throw new Error('Need exposed cloth and outside-rail points');
  });
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const send=(type:'touchStart'|'touchMove'|'touchEnd',point?:{x:number;y:number})=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{x:point.x,y:point.y,id:1}]:[]});
  await send('touchStart',points.from);
  const startAim=await page.evaluate(()=>(window as any).__pool.targetAngle);
  await send('touchMove',points.to);
  const aim=await page.evaluate(()=>{const g=(window as any).__pool;return{angle:g.targetAngle,mode:g.mode};});
  expect(Number.isFinite(aim.angle)).toBe(true);expect(Math.abs(aim.angle-startAim)).toBeGreaterThan(.01);expect(aim.mode).toBe('aim');
  await send('touchEnd');
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return {mode:g.mode,speed:Math.hypot(g.cue().vx,g.cue().vy)};})).toEqual({mode:'aim',speed:0});
  const before=await page.evaluate(()=>{const g=(window as any).__pool;g.gs.ballInHand=true;g.gs.placement='anywhere';g.mode='place';return{x:g.cue().x,y:g.cue().y};});
  await send('touchStart',points.to);await send('touchEnd');
  const after=await page.evaluate(()=>{const g=(window as any).__pool;return{x:g.cue().x,y:g.cue().y,mode:g.mode,ballInHand:g.gs.ballInHand};});
  expect(after).toEqual({...before,mode:'place',ballInHand:true});
});


test('mobile circular touch aiming rotates repeatedly both ways without a foreground gap or shot',async({page,context})=>{
  await page.setViewportSize({width:390,height:844});await openGame(page);
  if(await page.locator('#privacynotice').isVisible())await page.locator('#privacyessential').click();
  const center=await page.evaluate(()=>{
    const g=(window as any).__pool;g.cpuOpponent=false;g.gs.current=0;g.mode='aim';g.calledPocket=0;g.scene.cameraRig.cancel(true);
    Object.assign(g.cue(),{x:1.27,y:.635});
    const camera=g.scene.controls.object;g.scene.controls.enableDamping=false;g.scene.controls.update();
    g.scene.controls.target.set(0,.028575,0);camera.position.set(0,.7,1.5);camera.lookAt(g.scene.controls.target);camera.updateMatrixWorld();
    const p=camera.position.clone().set(0,.028575,0).project(camera);
    const center={x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};
    for(let i=0;i<48;i++){const t=i*Math.PI/24;if(document.elementFromPoint(center.x+50*Math.cos(t),center.y+50*Math.sin(t))?.id!=='game-canvas')throw new Error('Touch circle obstructed');}
    return center;
  });
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  for(const direction of [1,-1]){
    const point=(i:number)=>({x:center.x+50*Math.cos(direction*i*Math.PI/24),y:center.y+50*Math.sin(direction*i*Math.PI/24),id:1});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(0)]});
    expect(await page.evaluate(()=>{const g=(window as any).__pool;return {touch:g.touchAim,human:g.humanTurn(),camera:g.cameraMode,gesture:g.cameraGesture,interacting:g.scene.cameraRig.interacting,mode:g.mode};})).toMatchObject({touch:true,human:true,camera:false,gesture:false,interacting:false,mode:'aim'});
    let previous=await page.evaluate(()=>(window as any).__pool.targetAngle),total=0;
    for(let i=1;i<=96;i++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(i)]});
      // CDP acknowledgement can precede the coalesced browser pointermove.
      if(i>3)await expect.poll(()=>page.evaluate(()=>(window as any).__pool.targetAngle)).not.toBe(previous);
      const angle=await page.evaluate(()=>(window as any).__pool.targetAngle);
      const delta=Math.atan2(Math.sin(angle-previous),Math.cos(angle-previous));
      expect(Math.abs(delta)).toBeLessThan(.6);total+=delta;previous=angle;
    }
    expect(Math.abs(total)).toBeCloseTo(4*Math.PI,2);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    expect(await page.evaluate(()=>{const g=(window as any).__pool;return{mode:g.mode,speed:Math.hypot(g.cue().vx,g.cue().vy)};})).toEqual({mode:'aim',speed:0});
  }
});

for(const [simulation,seat,name] of [['jev-cpu',1,'CPU'],['jev-cpu',0,'Jev AI'],['jev-jev',1,'Jev AI 2']] as const)test(`pending ${simulation} seat ${seat} names the actual planner`,async({page})=>{
  await openGame(page);
  await page.route('**/api/opponents/jev/games/status-test/turn',route=>route.abort());
  const status=await page.evaluate(({simulation,seat})=>{
    const g=(window as any).__pool;g.coin.cancel();g.cancelOpponent();g.simMode=simulation;g.cpuOpponent=true;g.jevOpponent=true;
    g.jevGame={id:'status-test',revision:0};g.gs.current=seat;g.mode='aim';
    void g.playJevTurn();
    return {name:document.getElementById('turn')!.textContent,primary:document.getElementById('msg')?.textContent,secondary:document.getElementById('opponentstatus')!.textContent};
  },{simulation,seat});
  expect(status).toEqual({name,primary:'Choosing a shot',secondary:''});
});

test('departed room callbacks cannot overwrite local play or a replacement room',async({page})=>{
  await page.addInitScript(()=>{
    class TestSocket {
      static OPEN=1;readyState=1;onopen:any=null;onmessage:any=null;onclose:any=null;
      send(){}close(){this.readyState=3;}
    }
    (window as any).WebSocket=TestSocket;
  });
  await openGame(page);
  const result=await page.evaluate(()=>{
    const g=(window as any).__pool;g.coin.cancel();g.connectRoom(true);
    const old=g.room;old.seat=0;old.code='ABCD2345';
    const state={code:old.code,balls:structuredClone(g.gs.balls),current:1,groups:['solid','stripe'],open:false,ball_in_hand:false,winner:null,message:'STALE ROOM',break_shot:false,placement:'anywhere',kitchen_shot:false,rules:structuredClone(g.gs.rules),revision:3,return_order:[],names:['Stale A','Stale B'],ready:false};
    const shot={aim:1,power:.7,tipX:0,tipY:0};
    g.mode='rolling';old.onState(state);old.onShot(1,shot);
    const queued=g.pendingNetwork.splice(0);const queuedCount=queued.length;
    g.leaveRoom('Local game');g.coin.cancel();
    const snapshot=()=>JSON.stringify({state:g.gs,mode:g.mode,seat:g.seat,names:g.roomNames,message:g.el.msg.textContent,roomInfo:g.el.roominfo.textContent,link:(document.getElementById('roomlink') as HTMLInputElement).value,pending:g.pendingNetwork.length});
    let openCalls=0;old.create=()=>openCalls++;
    const stale=()=>{old.onState(state);old.onShot(1,shot);old.onJoined(state.names);old.onOpen();old.onError('OLD ERROR');old.onClose('OLD CLOSED');for(const callback of queued)callback();};
    const localBefore=snapshot();stale();const localPreserved=localBefore===snapshot()&&g.room===null;
    g.connectRoom(true);const current=g.room;g.coin.cancel();
    const replacementBefore=snapshot();old.code='';stale();const replacementPreserved=replacementBefore===snapshot()&&g.room===current;
    current.seat=0;current.code='EFGH2345';current.onState({...state,message:'CURRENT ROOM',names:['Current A','Current B']});
    const currentAccepted=g.gs.message==='CURRENT ROOM'&&g.seat===0&&g.roomNames[0]==='Current A';
    g.leaveRoom('Done');
    return {queuedCount,localPreserved,replacementPreserved,currentAccepted,openCalls};
  });
  expect(result).toEqual({queuedCount:2,localPreserved:true,replacementPreserved:true,currentAccepted:true,openCalls:0});
});

test('idle cue stays close to a touching cluster regardless of prior shot power',async({page})=>{
  await openGame(page);
  const values=await page.evaluate(async()=>{
    const g=(window as any).__pool;g.coin.cancel();g.cancelOpponent();g.cpuOpponent=false;g.jevOpponent=false;g.simMode=null;g.mode='aim';g.gs.current=0;g.gs.breakShot=false;g.tipX=g.tipY=0;g.angle=g.targetAngle=0;
    for(const b of g.gs.balls)b.potted=true;
    Object.assign(g.gs.balls[0],{x:1.27,y:.635,potted:false,asleep:true});
    [Math.PI/3,2*Math.PI/3,Math.PI,4*Math.PI/3,5*Math.PI/3].forEach((a,i)=>Object.assign(g.gs.balls[i+1],{x:1.27+.05715*Math.cos(a),y:.635+.05715*Math.sin(a),potted:false,asleep:true}));
    const original=g.scene.setCue;let last:any[]=[];
    g.scene.setCue=(...args:any[])=>{last=args;return original(...args);};
    const result=[];
    for(const power of [.1,.5,1]){g.power=power;g.pulling=false;g.frame();result.push({visible:last[0],pull:last[4]});}
    g.pulling=true;const originalPower=g.pullPower;g.pullPower=()=>1;g.frame();result.push({visible:last[0],pull:last[4]});g.pulling=false;g.pullPower=originalPower;g.scene.setCue=original;
    return result;
  });
  for(const v of values.slice(0,3)){expect(v.visible).toBe(true);expect(v.pull).toBeCloseTo(.012,10);}
  expect(values[3].visible).toBe(true);expect(values[3].pull).toBeCloseTo(.192,10);
});
