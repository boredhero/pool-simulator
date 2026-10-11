import {expect,test} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';

for(const mobile of [false,true])test.describe(mobile?'mobile':'desktop',()=>{
  test.use({hasTouch:mobile,isMobile:mobile});
  test('breaker can reposition repeatedly and house rules can disable it',async({page})=>{
    await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:800});
    await acceptWelcomeBeforeLoad(page);
    await page.route('**/api/**',r=>r.fulfill({json:{}}));
    await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:headstring-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-09',allow:false}));});
    await page.goto('/');
    await page.waitForFunction(()=>!!(window as any).__pool);
    await page.evaluate(()=>{
      const g=(window as any).__pool;g.coin.cancel();g.gs.current=0;g.cpuOpponent=false;
      g.options.autoCamera=false;g.scene.renderer.render=()=>{};g.frame();
    });
    const button=page.getByRole('button',{name:'Place cue ball',exact:true});
    await expect(button).toBeVisible();
    const box=await button.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x+box!.width).toBeLessThanOrEqual(mobile?390:1280);
    const tap=async(x:number,y:number)=>{
      await page.evaluate(([x,y])=>{(window as any).__pool.scene.pickFelt=()=>[x,y];},[x,y]);
      if(mobile)await page.touchscreen.tap(200,400);else await page.mouse.click(600,400);
    };
    await button.click();await expect.poll(()=>page.evaluate(()=>(window as any).__pool.mode)).toBe('place');
    await tap(1,.6);await expect.poll(()=>page.evaluate(()=>(window as any).__pool.mode)).toBe('place');
    await tap(.4,.2);await expect.poll(()=>page.evaluate(()=>(window as any).__pool.mode)).toBe('aim');
    expect(await page.evaluate(()=>(window as any).__pool.cue().x)).toBe(.4);
    await button.click();await tap(.5,.9);
    expect(await page.evaluate(()=>(window as any).__pool.cue().y)).toBe(.9);
    await page.evaluate(()=>{const g=(window as any).__pool;g.gs.rules.breakPlacement=false;g.frame();});
    await expect(button).toBeHidden();
    await page.evaluate(()=>{const g=(window as any).__pool;g.gs.rules.breakPlacement=true;g.gs.breakShot=false;g.frame();});
    await expect(button).toBeHidden();
  });
});
