import { expect, test } from '@playwright/test';

test.setTimeout(120 * 1000);

test('loads, renders table, breaks and resolves', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page).toHaveTitle(/Play Pool/);
  const canvas = page.locator('#game-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(200);
  await expect(page.locator('link[rel="icon"]')).toHaveCount(1);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'e2e/table.png' });
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
  await page.mouse.move(sx - 300, sy + 250, { steps: 12 });
  await page.mouse.up();
  // Shot must actually be underway now.
  await page.waitForFunction(
    () => (window as unknown as { __pool: { mode: string } }).__pool.mode === 'rolling',
    { timeout: 5000 },
  );
  // Rolling: charge meter was active; wait for resolution.
  await page.waitForFunction(
    () => (window as unknown as { __pool: { mode: string } }).__pool.mode !== 'rolling',
    { timeout: 90000 },
  );
  const msg = await page.locator('#msg').textContent();
  expect(msg).toMatch(/Player [12]/);
  await page.screenshot({ path: 'e2e/break.png' });
  expect(errors.filter((e) => !e.includes('WebGL'))).toEqual([]);
});

test('adaptive controls, readable settings, and desktop version card', async ({ page }) => {
  await page.setViewportSize({width:1440,height:900}); await page.goto('/');
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
  await page.goto('/');
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
  await page.goto('/');
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
  await page.goto('/');
  expect(await page.locator('#railsights').inputValue()).toBe('diamonds');
  await page.locator('#settingsbtn').click();
  await page.locator('#railsights').selectOption('double-diamonds');
  await page.reload();
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
  await page.goto('/');
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
