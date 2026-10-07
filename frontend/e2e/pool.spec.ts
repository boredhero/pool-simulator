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
