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
