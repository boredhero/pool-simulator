import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({page}) => {
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
}

test('loads, renders table, breaks and resolves', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openGame(page);
  await expect(page).toHaveTitle(/Play Pool/);
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
  await expect(page.locator('#version')).not.toHaveCSS('position','fixed');
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
    const g=(window as any).__pool;
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
  await page.locator('#railsights').selectOption('double-diamonds');
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
  await page.locator('#fastforward').check();await page.locator('#rulespreset').selectOption('custom');
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
  for(const id of ['viewbtn','version','settingsbtn']) {const box=(await page.locator('#'+id).boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);}
  await page.screenshot({path:'/tmp/pool-mobile-camera.png'});
  await page.locator('#viewbtn').click();
  await page.getByRole('button',{name:'Move camera',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__pool.cameraMode)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>(window as any).__pool.cameraMode)).toBe(false);
  await page.locator('#settingsbtn').click();
  await page.locator('#autocamera').uncheck();
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
    ['rolling','Player 2 to shoot','CPU · shot in motion'],
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
  const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const send=(type:'touchStart'|'touchMove'|'touchEnd',touchPoints:{x:number;y:number;id:number}[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
  const state=()=>page.evaluate(()=>{const g=(window as any).__pool,c=g.scene.controls;return {theta:c.getAzimuthalAngle(),distance:c.getDistance(),aim:g.targetAngle,mode:g.mode,pointers:g.pointers.size};});
  await send('touchStart',[{x:160,y:450,id:1}]);
  const aimed=await state();
  await send('touchMove',[{x:240,y:460,id:1}]);
  expect(Math.abs((await state()).aim-aimed.aim)).toBeGreaterThan(.01);
  await send('touchEnd',[]);
  expect((await state()).mode).toBe('aim');
  await expect(page.locator('#touchshoot')).toBeVisible();
  const initial=await state();
  await send('touchStart',[{x:135,y:450,id:1},{x:255,y:450,id:2}]);
  await send('touchMove',[{x:100,y:450,id:1},{x:290,y:450,id:2}]);
  const zoomed=await state();
  expect(zoomed.distance).toBeLessThan(initial.distance);
  await send('touchMove',[{x:140,y:470,id:1},{x:330,y:470,id:2}]);
  await expect.poll(async()=>Math.abs((await state()).theta-zoomed.theta)).toBeGreaterThan(.05);
  await send('touchEnd',[{x:140,y:470,id:1}]);
  const held=await state();
  await send('touchMove',[{x:180,y:480,id:1}]);
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

test('compact mobile scores expand and trackpad shift-scroll orbits',async({page})=>{
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
  await page.locator('#game-canvas').dispatchEvent('wheel',{deltaY:80,shiftKey:true,bubbles:true,cancelable:true});
  const after=await page.evaluate(()=>{const g=(window as any).__pool;return {theta:g.scene.controls.getAzimuthalAngle(),mode:g.mode};});
  expect(Math.abs(after.theta-before)).toBeGreaterThan(.01);expect(after.mode).toBe('aim');
  await page.screenshot({path:'/tmp/pool-060-mobile.png'});
});

test('premium badges and unlimited racks follow the server account',async({page})=>{
  let premium=true,starts=0;
  await page.route('**/api/account',route=>route.fulfill({json:{account:{id:'premium',username:'PremiumPlayer',createdAt:0,premium},stats:null}}));
  await page.route('**/api/opponents/jev',route=>route.fulfill({json:{available:true,usage:{unlimited:premium,gamesRemaining:premium?null:0,resetsAt:2000000000}}}));
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
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.id)).toBe('premium-0');
  await expect(page.locator('#opponentstatus')).toContainText('Unlimited Jev AI');
  for(const n of [1,2]){
    await page.locator('#rack').click();
    await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.id)).toBe('premium-'+n);
  }
  premium=false;
  await page.locator('#settingsbtn').click();await expect(page.locator('#settingspremium')).toBeHidden();
  await page.locator('#closesettings').click();
  await page.locator('#onlinebtn').click();await page.locator('#accountbtn').click();
  await expect(page.locator('#accountpremium')).toBeHidden();
  await expect(page.locator('#accountjev')).toContainText('0 free game available today');
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

test('Jev resumes its server-owned game and reset discards an in-flight turn', async ({page}) => {
  await page.route('**/api/account',route=>route.fulfill({json:{account:{id:'jev-test',username:'Tester',createdAt:0},stats:null}}));
  await page.route('**/api/opponents/jev',route=>route.fulfill({json:{available:true,usage:{gamesRemaining:1,resetsAt:2000000000}}}));
  await openGame(page);
  const state=await page.evaluate(()=>{
    const g=(window as any).__pool;
    return {balls:g.gs.balls,return_order:[],current:0,groups:[null,null],open:true,
      ball_in_hand:false,break_shot:true,placement:'none',kitchen_shot:false,rules:g.gs.rules,
      revision:0,winner:null,message:'Player 1 to break'};
  });
  await page.route('**/api/opponents/jev/games',route=>route.fulfill({json:{id:'daily-game',state,status:'active'}}));
  let release:(()=>void)|undefined,requests=0;
  await page.route('**/api/opponents/jev/games/daily-game/turn',async route=>{
    requests++;
    await new Promise<void>(resolve=>{release=resolve;});
    await route.fulfill({status:409,json:{detail:'Resume game'}}).catch(()=>{});
  });
  await page.locator('#jevbtn').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.id)).toBe('daily-game');
  await page.evaluate(()=>{const g=(window as any).__pool;g.fire(.4);});
  await expect.poll(()=>requests).toBe(1);
  await page.locator('#rack').click();
  release!();
  expect(await page.evaluate(()=>(window as any).__pool.jevGame)).toBeNull();
  await page.locator('#jevbtn').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.id)).toBe('daily-game');
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
      const scores=document.getElementById('scorecard')!.getBoundingClientRect();
      const tray=document.querySelector('.control-tray')!.getBoundingClientRect();
      return Math.abs((panel.left+panel.right)/2-innerWidth/2)<2 && panel.top>=scores.bottom && panel.bottom<=tray.top;
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
  await page.mouse.move(point.x,point.y);await page.keyboard.down('Shift');await page.mouse.wheel(100,0);await page.keyboard.up('Shift');
  await expect(page.locator('#tutorialprogress')).toContainText('worked');
  await page.locator('#tutorialnext').click();
  await expect(page.locator('#tutorialbody')).toContainText('real shot');
  await page.locator('#tutorialclose').click();
  await openGame(page,true);
  await expect(page.locator('#tutorial')).toBeHidden();
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#scoretoggle')).toHaveCount(0);
  await page.locator('.pcard').first().focus();await page.keyboard.press('Enter');
  await expect(page.locator('.pcard').first()).toHaveAttribute('aria-expanded','true');
});
