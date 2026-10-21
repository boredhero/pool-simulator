import {test,expect} from './fixtures';
import {TERMS_VERSION} from '../src/ui/terms';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';

for(const width of [1280,390])test(`owner entry fits the account overview at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:844});
  await acceptWelcomeBeforeLoad(page);
  await page.route('**/api/account',route=>route.fulfill({json:{account:{id:'owner',username:'Owner',createdAt:1780000000,isAdmin:true,premium:true},stats:{matches:0,wins:0,losses:0,shots:0,ballsPocketed:0,scratches:0,fouls:0,abandoned:0,recent:[]}}}));
  await page.route('**/api/privacy/terms',route=>route.fulfill({json:{version:TERMS_VERSION,accepted:true,authenticated:true,accountId:'owner'}}));
  await page.addInitScript(()=>{
    localStorage.setItem('pool:help-dismissed','1');
    localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-09',allow:false}));
    const raf=requestAnimationFrame.bind(window);
    window.requestAnimationFrame=cb=>raf(t=>{const game=(window as any).__pool;if(game)game.scene.renderer.render=()=>{};cb(t);});
  });
  await page.goto('/');await page.locator('#accountidentity').click();
  const entry=page.getByRole('button',{name:'Admin settings',exact:true});
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAccessibleDescription('Manage players, access and Jev usage.');
  await expect(page.locator('#account-section-overview #adminbtn')).toHaveCount(1);
  const box=(await entry.boundingBox())!,tabs=(await page.locator('.account-navigation').boundingBox())!;
  expect(box.y).toBeGreaterThan(tabs.y+tabs.height);
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
  expect(await entry.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.locator('#accountdialog').screenshot({path:testInfo.outputPath(`owner-account-${width}.png`)});
  await page.getByRole('tab',{name:'Sign-in',exact:true}).click();await expect(entry).toBeHidden();
  await page.getByRole('tab',{name:'Overview',exact:true}).click();await expect(entry).toBeVisible();
});
