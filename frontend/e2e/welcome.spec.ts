import { expect, test } from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route('**/api/account',route=>route.fulfill({json:{account:null,stats:null}}));
  await page.route('**/api/version',route=>route.fulfill({json:{version:'e2e'}}));
  await page.route('**/api/privacy/consent',route=>route.fulfill({json:{analytics:route.request().postDataJSON().allow}}));
  await page.route('**/api/privacy/events',route=>route.fulfill({status:204}));
  await page.addInitScript(()=>{
    const raf=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>raf(time=>{const game=(window as any).__pool;if(game)game.scene.renderer.render=()=>{};callback(time);});
  });
});

test('explicit terms gate, separate analytics, live control profile and immediate tutorial',async({page})=>{
  const consent:boolean[]=[];const accountTerms:string[]=[];
  page.on('request',request=>{if(request.url().endsWith('/privacy/consent'))consent.push(request.postDataJSON().allow);if(request.url().endsWith('/privacy/terms'))accountTerms.push(request.url());});
  await page.goto('/');
  const welcome=page.locator('#welcomedialog');await expect(welcome).toBeVisible();
  await expect(page.locator('#privacynotice')).not.toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(page.locator('#helppanel')).not.toBeVisible();
  await expect(page.locator('#welcometerms')).not.toBeChecked();await expect(page.locator('#welcomeanalytics')).not.toBeChecked();
  await expect(page.locator('#welcometutorial')).toBeDisabled();await expect(page.locator('#welcomeplay')).toBeDisabled();
  await page.keyboard.press('Escape');await expect(welcome).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('pool:welcome'))).toBeNull();
  await expect(welcome.getByRole('link',{name:'Terms of Service'})).toHaveAttribute('href','/terms.html');
  await page.locator('#welcomeprofile').selectOption('trackpad');
  expect(await page.evaluate(()=>(window as any).__pool.scene.cameraRig.inputProfile)).toBe('trackpad');
  await expect(page.locator('#welcomecontrols')).toContainText('Two-finger scroll');
  await page.locator('#welcometerms').check();await page.locator('#welcometutorial').click();
  await expect(welcome).not.toBeVisible();await expect(page.locator('#tutorial')).toBeVisible();
  expect(consent).toEqual([false]);expect(accountTerms).toEqual([]);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pool:welcome')!))).toEqual({version:'2026-10-08',accepted:true});
  await page.reload();await expect(page.locator('#welcomedialog')).toHaveCount(0);
});

test('analytics starts only after a separate opt-in and successful consent response',async({page})=>{
  const consent:boolean[]=[];page.on('request',request=>{if(request.url().endsWith('/privacy/consent'))consent.push(request.postDataJSON().allow);});
  await page.goto('/');await expect(page.locator('#welcomedialog')).toBeVisible();expect(consent).toEqual([]);
  await page.locator('#welcomeanalytics').check();expect(consent).toEqual([]);
  await page.locator('#welcometerms').check();await page.locator('#welcomeplay').click();
  await expect(page.locator('#welcomedialog')).not.toBeVisible();
  expect(consent).toEqual([true]);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pool:privacy')!))).toEqual({version:'2026-10-08',allow:true});
  await expect(page.locator('#tutorial')).not.toBeVisible();
});

test('failed optional consent remains off and essential play still works',async({page})=>{
  await page.route('**/api/privacy/consent',route=>route.fulfill({status:503,json:{}}));
  await page.goto('/');await page.locator('#welcometerms').check();await page.locator('#welcomeanalytics').check();
  await page.locator('#welcomeplay').click();await expect(page.locator('#welcomestatus')).toContainText('Optional tracking stays off');
  await expect(page.locator('#welcomedialog')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('pool:welcome'))).toBeNull();
  expect(await page.evaluate(()=>localStorage.getItem('pool:privacy'))).toBeNull();
  await page.locator('#welcomeanalytics').uncheck();await page.locator('#welcomeplay').click();
  await expect(page.locator('#welcomedialog')).not.toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pool:privacy')!).allow)).toBe(false);
});

for(const preference of ['globalPrivacyControl','doNotTrack'])test(`${preference} prevents analytics opt-in`,async({page})=>{
  await page.addInitScript(name=>Object.defineProperty(navigator,name,{get:()=>name==='globalPrivacyControl'?true:'1'}),preference);
  const consent:boolean[]=[];page.on('request',request=>{if(request.url().endsWith('/privacy/consent'))consent.push(request.postDataJSON().allow);});
  await page.goto('/');await expect(page.locator('#welcomeprivacy-note')).toContainText('stay off');
  await expect(page.locator('#welcomeanalyticschoice')).not.toBeVisible();
  await page.locator('#welcometerms').check();await page.locator('#welcomeplay').click();
  await expect(page.locator('#welcomedialog')).not.toBeVisible();expect(consent.every(allow=>!allow)).toBe(true);
});

test('saved analytics preference is preserved and an invite remains ready',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:true})));
  await page.goto('/#join=ABCDEFGH');await expect(page.locator('#welcomeinvite')).toBeVisible();
  await expect(page.locator('#welcomeprivacy-note')).toContainText('saved analytics preference is enabled');
  await expect(page.locator('#welcomeanalyticschoice')).not.toBeVisible();
  await page.locator('#welcometerms').check();await page.locator('#welcomeplay').click();
  await expect(page.locator('#onlinepanel')).toBeVisible();await expect(page.locator('#rcode')).toHaveValue('ABCDEFGH');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pool:privacy')!).allow)).toBe(true);
});

test.describe('small touch welcome',()=>{
  test.use({viewport:{width:320,height:640},hasTouch:true});
  test('reflows with reachable footer and touch instructions',async({page})=>{
    await page.goto('/');const dialog=page.locator('#welcomedialog');await expect(dialog).toBeVisible();
    await expect(page.locator('#welcomeprofilelabel')).not.toBeVisible();await expect(page.locator('#welcomecontrols')).toContainText('Touch controls');
    const box=(await dialog.boundingBox())!;expect(box.width).toBeLessThanOrEqual(320);expect(box.height).toBeLessThanOrEqual(640);
    expect(await page.locator('.welcome-body').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await page.locator('#welcometerms').check();await expect(page.locator('#welcometutorial')).toBeInViewport();
    await page.locator('#welcometutorial').tap();await expect(page.locator('#tutorial')).toBeVisible();
  });
});
