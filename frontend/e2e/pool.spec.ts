import { expect, test } from '@playwright/test';

test('loads, renders table, breaks and resolves', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page).toHaveTitle(/pool-simulator/);
  const canvas = page.locator('#game-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(200);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'e2e/table.png' });
  // Aim at the apex ball and break at full power via the debug handle.
  await page.evaluate(() => {
    const g = (window as unknown as { __pool: { angle: number; power: number } }).__pool;
    g.angle = 0; // +x straight into the rack from the head spot
    g.power = 1;
  });
  await page.locator('#shoot').click();
  await expect(page.locator('#shoot')).toBeDisabled();
  await expect(page.locator('#shoot')).toBeEnabled({ timeout: 90000 });
  const msg = await page.locator('#msg').textContent();
  expect(msg).toMatch(/Player [12]/);
  await page.screenshot({ path: 'e2e/break.png' });
  expect(errors.filter((e) => !e.includes('WebGL'))).toEqual([]);
});
