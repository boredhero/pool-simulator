import {test,expect} from './fixtures';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';

test.beforeEach(async({page})=>{
  await acceptWelcomeBeforeLoad(page);
  await page.addInitScript(()=>{
    localStorage.setItem('pool:help-dismissed','1');
    localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-09',allow:false}));
    const raf=requestAnimationFrame.bind(window);
    window.requestAnimationFrame=cb=>raf(t=>{
      const game=(window as any).__pool;
      if(game)game.scene.renderer.render=()=>{};
      cb(t);
    });
  });
});

for(const width of [1280,320])test(`custom input menu fits ${width}px and persists selection`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:800});
  await page.goto('/');
  const trigger=page.getByRole('button',{name:'Camera input mode',exact:true});
  await expect(page.locator('select#camera-input-profile')).toHaveCount(0);
  await trigger.click();
  const menu=page.getByRole('menu',{name:'Camera input mode'});
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio',{name:'Mouse & Keyboard Mode'})).toHaveAttribute('aria-checked','true');
  const box=(await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y).toBeGreaterThanOrEqual(0);
  await menu.screenshot({path:testInfo.outputPath(`input-menu-${width}.png`)});
  await menu.getByRole('menuitemradio',{name:'Trackpad Mode',exact:true}).click();
  await expect(menu).toBeHidden();await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('value','trackpad');
  expect(await page.evaluate(()=>localStorage.getItem('pool:cameraInput'))).toBe('trackpad');
  await page.reload();await expect(trigger).toHaveAttribute('value','trackpad');
});

test('menu keyboard navigation, cancellation and outside dismissal preserve gameplay',async({page})=>{
  await page.goto('/');
  const trigger=page.getByRole('button',{name:'Camera input mode',exact:true});
  const menu=page.getByRole('menu',{name:'Camera input mode'});
  await trigger.focus();await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio',{name:'Mouse & Keyboard Mode'})).toBeFocused();
  await page.keyboard.press('End');await expect(menu.getByRole('menuitemradio',{name:'Trackpad Mode',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('value','mouse');
  await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('value','trackpad');await expect(trigger).toBeFocused();
  await trigger.click();await page.keyboard.press('Home');await page.keyboard.press('Tab');await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('value','trackpad');
  await trigger.click();await page.mouse.click(5,5);await expect(menu).toBeHidden();
  await trigger.click();await page.setViewportSize({width:1024,height:700});await expect(menu).toBeHidden();
  expect(await page.evaluate(()=>(window as any).__pool.mode)).not.toBe('rolling');
});
