import { acceptWelcomeBeforeLoad } from './welcomeFixture';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await acceptWelcomeBeforeLoad(page);
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
  await expect(page.locator('#settingspanel')).toHaveAttribute('data-draggable', 'true');
});

for (const [panelId, openerId] of [['settingspanel', 'settingsbtn'], ['onlinepanel', 'onlinebtn']]) {
  test(`${panelId} drags from its header and stays within the viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(`#${openerId}`).click();
    const panel = page.locator(`#${panelId}`);
    const before = (await panel.boundingBox())!;
    const header = (await panel.locator('header h2').boundingBox())!;
    await page.mouse.move(header.x + 8, header.y + header.height / 2);
    await page.mouse.down();
    await page.mouse.move(header.x - 160, header.y + 60, { steps: 8 });
    await page.mouse.up();
    const moved = (await panel.boundingBox())!;
    expect(moved.x).toBeLessThan(before.x - 100);
    await expect(page.locator(`#${openerId}`)).toHaveAttribute('aria-expanded', 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => {
      const box = (await panel.boundingBox())!;
      return box.x >= 0 && box.y >= 0 && box.x + box.width <= 391;
    }).toBe(true);
    const close = panel.locator('header button').last();
    await expect(close).toBeInViewport();
    await close.click();
    await expect(panel).not.toBeVisible();
    await expect(page.locator(`#${openerId}`)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(`#${openerId}`)).toBeFocused();
  });
}

test('click and keyboard move controls do not change the game aim; reset restores placement', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#settingsbtn').click();
  const panel = page.locator('#settingspanel');
  const before = (await panel.boundingBox())!;
  const move = panel.getByRole('button', { name: 'Move settings panel', exact: true });
  await move.click();
  await panel.getByRole('button', { name: 'Move panel left', exact: true }).click();
  expect((await panel.boundingBox())!.x).toBeLessThan(before.x);
  const aim = await page.evaluate(() => (window as any).__pool.targetAngle);
  await move.focus();
  const x = (await panel.boundingBox())!.x;
  await page.keyboard.press('ArrowLeft');
  expect((await panel.boundingBox())!.x).toBe(x - 16);
  expect(await page.evaluate(() => (window as any).__pool.targetAngle)).toBe(aim);
  await panel.getByRole('button', { name: 'Reset position', exact: true }).click();
  expect((await panel.boundingBox())!.x).toBe(before.x);
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(page.locator('#settingsbtn')).toBeFocused();
});

test('panel content remains scrollable on mobile and switching panels keeps aria state synchronized', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await page.locator('#settingsbtn').click();
  const panel = page.locator('#settingspanel');
  const body = panel.locator('.settings-body');
  await expect(body).toHaveCSS('touch-action', 'auto');
  expect(await body.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  })).toBeGreaterThan(0);
  await page.locator('#onlinebtn').click();
  await expect(panel).not.toBeVisible();
  await expect(page.locator('#settingsbtn')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#onlinebtn')).toHaveAttribute('aria-expanded', 'true');
});
