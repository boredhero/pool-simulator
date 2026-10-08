import { expect, test, type Page } from '@playwright/test';

async function position(page: Page) {
  return page.evaluate(() => (window as any).__pool.scene.controls.target.toArray() as number[]);
}
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/account', route => route.fulfill({ json: { account: null, stats: null } }));
  await page.route('**/api/version', route => route.fulfill({ json: { version: 'e2e' } }));
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => original(time => {
      const game = (window as any).__pool;
      if (game) game.scene.renderer.render = () => {};
      callback(time);
    });
  });
  await page.goto('/');
  await expect(page.locator('#camera-fly-toggle')).toBeVisible();
  if (await page.locator('#privacynotice').isVisible()) await page.locator('#privacyessential').click();
  if (await page.locator('#helppanel').isVisible()) await page.locator('#closehelp').click();
  await page.evaluate(() => (window as any).__pool.scene.cameraRig.cancel(true));
  await page.locator('#game-canvas').focus();
});

test('WASD translates the view without shooting; release and blur stop movement', async ({ page }) => {
  const start = await position(page);
  const mode = await page.evaluate(() => (window as any).__pool.mode);
  await page.keyboard.down('w');
  await expect.poll(async () => distance(start, await position(page))).toBeGreaterThan(.12);
  await page.keyboard.up('w');
  const stopped = await position(page);
  await page.waitForTimeout(150);
  expect(distance(stopped, await position(page))).toBeLessThan(.001);
  expect(await page.evaluate(() => (window as any).__pool.mode)).toBe(mode);
  await page.keyboard.down('d');
  await expect.poll(async () => distance(stopped, await position(page))).toBeGreaterThan(.1);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const blurred = await position(page);
  await page.waitForTimeout(150);
  expect(distance(blurred, await position(page))).toBeLessThan(.001);
  await page.keyboard.up('d');
});

test('opening account stops held movement and typing WASD in the dialog does not move', async ({ page }) => {
  const start = await position(page);
  await page.keyboard.down('w');
  await expect.poll(async () => distance(start, await position(page))).toBeGreaterThan(.1);
  await page.locator('#onlinebtn').click();
  await page.locator('#accountbtn').click();
  await expect(page.locator('#accountdialog')).toBeVisible();
  await page.keyboard.up('w');
  const stopped = await position(page);
  await page.locator('#accountusername').fill('wasd');
  await page.locator('#accountusername').press('a');
  await page.waitForTimeout(150);
  expect(distance(stopped, await position(page))).toBeLessThan(.001);
});

test.describe('mobile camera pad', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('touch hold translates, cancellation stops, and the pad can be hidden', async ({ page }) => {
    const toggle = page.locator('#camera-fly-toggle');
    await expect(toggle).toBeInViewport();
    await toggle.tap();
    const arrow = page.getByRole('button', { name: 'Fly camera forward', exact: true });
    await expect(arrow).toBeInViewport();
    const box = (await arrow.boundingBox())!;
    const start = await position(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
    await expect.poll(async () => distance(start, await position(page))).toBeGreaterThan(.25);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    const stopped = await position(page);
    await page.waitForTimeout(150);
    expect(distance(stopped, await position(page))).toBeLessThan(.001);
    await expect(arrow).not.toHaveClass(/held/);
    await toggle.tap();
    await expect(page.locator('#camera-fly-pad')).not.toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

async function pose(page:Page) {
  return page.evaluate(()=>{const s=(window as any).__pool.scene;return {
    theta:s.controls.getAzimuthalAngle(),phi:s.controls.getPolarAngle(),
    distance:s.controls.object.position.distanceTo(s.controls.target),height:s.controls.object.position.y,
    mode:(window as any).__pool.mode,
  };});
}

test('Space rises, Left Shift descends, release stops, and buttons retain Space activation',async({page})=>{
  const initial=await pose(page);
  await page.keyboard.down('Space');
  await expect.poll(async()=>(await pose(page)).height-initial.height).toBeGreaterThan(.12);
  await page.keyboard.up('Space');
  expect((await pose(page)).mode).toBe('aim');
  const raised=await pose(page);await page.waitForTimeout(150);
  expect((await pose(page)).height).toBeCloseTo(raised.height,4);
  await page.keyboard.down('ShiftLeft');
  await expect.poll(async()=>raised.height-(await pose(page)).height).toBeGreaterThan(.12);
  await page.keyboard.up('ShiftLeft');
  const stopped=await pose(page);
  await page.locator('#camera-fly-toggle').focus();await page.keyboard.press('Space');
  await expect(page.locator('#camera-fly-pad')).toBeVisible();
  expect((await pose(page)).height).toBeCloseTo(stopped.height,4);
  await page.locator('#game-canvas').focus();await page.keyboard.press('Enter');
  expect((await pose(page)).mode).toBe('rolling');
});

test('trackpad profile persists and independently controls yaw, pitch, pinch and pan',async({page})=>{
  await page.locator('#camera-input-profile').selectOption('trackpad');
  await page.reload();await expect(page.locator('#camera-input-profile')).toHaveValue('trackpad');
  await page.evaluate(()=>{const s=(window as any).__pool.scene;s.cameraRig.cancel(true);s.controls.enableDamping=false;});
  const canvas=page.locator('#game-canvas');const start=await pose(page);
  await canvas.dispatchEvent('wheel',{deltaX:50,deltaY:0,bubbles:true,cancelable:true});
  const horizontal=await pose(page);
  expect(Math.abs(horizontal.theta-start.theta)).toBeGreaterThan(.05);
  expect(horizontal.phi).toBeCloseTo(start.phi,4);expect(horizontal.distance).toBeCloseTo(start.distance,4);
  await canvas.dispatchEvent('wheel',{deltaX:0,deltaY:50,bubbles:true,cancelable:true});
  const vertical=await pose(page);
  expect(Math.abs(vertical.phi-horizontal.phi)).toBeGreaterThan(.05);
  expect(vertical.theta).toBeCloseTo(horizontal.theta,4);
  await canvas.dispatchEvent('wheel',{deltaY:-30,ctrlKey:true,bubbles:true,cancelable:true});
  const zoomed=await pose(page);expect(zoomed.distance).toBeLessThan(vertical.distance);
  expect(zoomed.theta).toBeCloseTo(vertical.theta,4);expect(zoomed.phi).toBeCloseTo(vertical.phi,4);
  const target=await position(page);
  await canvas.dispatchEvent('wheel',{deltaX:25,deltaY:40,altKey:true,bubbles:true,cancelable:true});
  expect(distance(target,await position(page))).toBeGreaterThan(.02);
  expect((await pose(page)).mode).toBe('aim');
  const beforeUI=await pose(page);
  await page.locator('#camera-input-profile').dispatchEvent('wheel',{deltaY:50,bubbles:true,cancelable:true});
  expect(await pose(page)).toEqual(beforeUI);
});

test('movement cancels a pending pull and editing or dialogs cannot fly or fire',async({page})=>{
  await page.evaluate(()=>{const g=(window as any).__pool;g.pulling=true;g.pressPt=[1,1];g.hoverPt=[.5,1];});
  await page.keyboard.down('Space');await page.keyboard.up('Space');
  expect(await page.evaluate(()=>(window as any).__pool.pulling)).toBe(false);
  await page.locator('#onlinebtn').click();await page.locator('#accountbtn').click();
  await expect(page.locator('#accountdialog')).toBeVisible();
  const initial=await pose(page);
  await page.locator('#accountusername').focus();await page.keyboard.press('Space');await page.keyboard.press('ShiftLeft');
  await page.locator('#game-canvas').dispatchEvent('wheel',{deltaY:-80,ctrlKey:true,bubbles:true,cancelable:true});
  await page.waitForTimeout(150);
  expect(await pose(page)).toEqual(initial);
});

test('trackpad momentum never steers or fires the cue and Shift spin precision stays in the UI',async({page})=>{
  await page.locator('#camera-input-profile').selectOption('trackpad');
  const result=await page.evaluate(()=>{
    const g=(window as any).__pool,canvas=document.getElementById('game-canvas')!;
    canvas.focus();const aim=g.targetAngle;
    canvas.dispatchEvent(new WheelEvent('wheel',{deltaX:40,deltaY:20,bubbles:true,cancelable:true}));
    canvas.dispatchEvent(new PointerEvent('pointermove',{clientX:550,clientY:400,pointerType:'mouse',bubbles:true}));
    canvas.dispatchEvent(new KeyboardEvent('keydown',{code:'Enter',key:'Enter',bubbles:true,cancelable:true}));
    return {aim,after:g.targetAngle,mode:g.mode,pulling:g.pulling,canShoot:g.humanTurn()};
  });
  expect(result.after).toBe(result.aim);expect(result.mode).toBe('aim');expect(result.pulling).toBe(false);expect(result.canShoot).toBe(false);
  await page.waitForTimeout(600);
  await page.locator('#spin').focus();const height=(await pose(page)).height;
  await page.keyboard.down('ShiftLeft');await page.waitForTimeout(180);await page.keyboard.press('ArrowDown');await page.keyboard.up('ShiftLeft');
  expect((await pose(page)).height).toBeCloseTo(height,3);
});
