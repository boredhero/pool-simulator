import { acceptWelcomeBeforeLoad, waitForOpening } from './welcomeFixture';
import { expect, test, type Page } from '@playwright/test';

async function open(page:Page,path='/'){
  await acceptWelcomeBeforeLoad(page);
  await page.addInitScript(()=>{
    const w=window as any,raf=requestAnimationFrame.bind(window);
    window.requestAnimationFrame=fn=>raf(t=>{if(w.__pool&&!w.__draw){const r=w.__pool.scene.renderer;w.__draw=r.render.bind(r);r.render=()=>{};}fn(t);});
  });
  await page.goto(path);await page.waitForFunction(()=>!!(window as any).__draw);await waitForOpening(page);
}
async function account(page:Page){await page.locator('#onlinebtn').click();await page.locator('#accountbtn').click();}

test('optional account creation, recovery, session reset, and mobile profile',async({page})=>{
  await open(page);await account(page);await page.locator('#account-register').click();await page.locator('#registeradult').check();
  const name='Player_'+Date.now().toString(36),password='a long pool password for testing';
  await page.locator('#accountusername').fill(name);await page.locator('#accountpassword').fill(password);
  await page.locator('#accountsubmit').click();await expect(page.locator('#recoverypanel')).toBeVisible();
  const code=await page.locator('#recoveryvalue').inputValue();expect(code.length).toBe(39);
  await page.keyboard.press('Escape');await expect(page.locator('#accountdialog')).toBeVisible();
  await page.locator('#recoverysaved').click();await expect(page.locator('#accountname')).toHaveText(name);
  await expect(page.locator('#accountstats')).toContainText('Casual matches');
  await page.locator('#accountlogout').click();await page.locator('#account-recover').click();
  await page.locator('#accountusername').fill(name);await page.locator('#accountpassword').fill(password+' new');
  await page.locator('#accountrecovery').fill(code);await page.locator('#accountsubmit').click();
  await expect(page.locator('#recoverypanel')).toBeVisible();expect(await page.locator('#recoveryvalue').inputValue()).not.toBe(code);
  await page.locator('#recoverysaved').click();await page.locator('#account-login').click();
  await page.locator('#accountpassword').fill(password+' new');await page.locator('#accountsubmit').click();
  await expect(page.locator('#accountname')).toHaveText(name);
  await page.setViewportSize({width:390,height:844});
  const box=(await page.locator('#accountdialog').boundingBox())!;expect(box.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:'/tmp/pool-account-mobile.png'});
  await page.locator('#accountclose').click();await page.reload();await page.waitForFunction(()=>!!(window as any).__draw);
  await expect(page.locator('#onlineidentity')).toContainText(name);
});

test('registered host shares a guest invite and both receive server results',async({browser,page})=>{
  await open(page);await account(page);await page.locator('#account-register').click();await page.locator('#registeradult').check();
  const name='Host_'+Date.now().toString(36);
  await page.locator('#accountusername').fill(name);await page.locator('#accountpassword').fill('a long secret password for host');
  await page.locator('#accountsubmit').click();await expect(page.locator('#recoverypanel')).toBeVisible();
  await page.locator('#recoverysaved').click();await page.locator('#accountclose').click();
  await page.locator('#createbtn').click();await expect(page.locator('#roomlink')).toHaveValue(/#join=[A-Z2-9]{8}$/);
  const link=await page.locator('#roomlink').inputValue();
  const guestContext=await browser.newContext(),guest=await guestContext.newPage();
  try {
    await open(guest,link);await expect(guest.locator('#onlinepanel')).toBeVisible();
    await guest.locator('#pname').fill('Guest Friend');await guest.locator('#joinbtn').click();
    await expect(page.locator('#roominfo')).toContainText('Connected');await expect(guest.locator('#roominfo')).toContainText('Connected');
    await expect(guest.locator('.pcard').first()).toContainText(name);
    await Promise.all([waitForOpening(page),waitForOpening(guest)]);
    const breaker=await page.evaluate(()=>(window as any).__pool.gs.current);
    await (breaker===0?page:guest).evaluate(()=>{const g=(window as any).__pool;g.angle=0;g.fire(.3);});
    // Advance local playback without changing physics; the server result is independent.
    await expect.poll(()=>page.evaluate(()=>(window as any).__pool.room.revision)).toBeGreaterThan(0);
    for(const p of [page,guest])await p.evaluate(()=>{const g=(window as any).__pool;for(let i=0;i<200&&g.mode==='rolling';i++){g.accumulator+=.25;g.frame();}g.frame();});
    await expect.poll(()=>page.evaluate(()=>(window as any).__pool.mode)).not.toBe('wait');
    const hostState=await page.evaluate(()=>{const g=(window as any).__pool;return{turn:g.gs.current,balls:g.gs.balls.map((b:any)=>[b.x,b.y,b.potted])};});
    const guestState=await guest.evaluate(()=>{const g=(window as any).__pool;return{turn:g.gs.current,balls:g.gs.balls.map((b:any)=>[b.x,b.y,b.potted])};});
    expect(guestState).toEqual(hostState);
    const stats=await page.request.get('/api/account');expect((await stats.json()).stats.shots).toBe(breaker===0?1:0);
    await page.locator('#leaveroom').click();await expect(guest.locator('#roominfo')).toContainText('closed');
    await expect(page.locator('#createbtn')).toBeVisible();
    await expect.poll(async()=>{const r=await page.request.get('/api/account');return (await r.json()).stats.losses;}).toBe(1);
  } finally {await guestContext.close();}
});

test('development proxy supports same-origin account requests and WebSocket rooms',async({page})=>{
  await open(page,'http://127.0.0.1:4174/');await account(page);await page.locator('#account-register').click();await page.locator('#registeradult').check();
  await page.locator('#accountusername').fill('Proxy_'+Date.now().toString(36));
  await page.locator('#accountpassword').fill('a sufficiently long proxy password');
  await page.locator('#accountsubmit').click();await expect(page.locator('#recoverypanel')).toBeVisible();
  await page.locator('#recoverysaved').click();await page.locator('#accountclose').click();
  await page.locator('#createbtn').click();await expect(page.locator('#roomlink')).toHaveValue(/^http:\/\/127\.0\.0\.1:4174\/#join=/);
  await page.locator('#leaveroom').click();
});

test('daily Jev game uses server state and survives a page reload',async({page})=>{
  const response=await page.request.post('/api/account/register',{headers:{'X-Pool-Request':'1'},data:{
    username:'Jev_'+Date.now().toString(36),password:'a long daily game test password',adult:true,terms_version:(await (await page.request.get('/api/privacy/terms')).json()).version,
  }});
  expect(response.ok()).toBe(true);
  await page.addInitScript(()=>{
    const raf=requestAnimationFrame.bind(window);
    window.requestAnimationFrame=fn=>raf(t=>{const g=(window as any).__pool;if(g)g.cpuTimer=-1000;fn(t);});
  });
  await open(page);
  await page.locator('#jevbtn').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.revision)).toBe(0);
  const id=await page.evaluate(()=>(window as any).__pool.jevGame.id);
  await waitForOpening(page);
  const breaker=await page.evaluate(()=>(window as any).__pool.gs.current);
  // This integration fixture pauses Jev decisions; either persisted coin outcome is valid.
  if(breaker===0)await page.evaluate(()=>{const g=(window as any).__pool;g.angle=0;g.fire(.05);});
  const revision=breaker===0?1:0;
  await expect.poll(async()=>{
    const response=await page.request.get('/api/opponents/jev');
    return (await response.json()).game?.state.revision;
  }).toBe(revision);
  await page.reload();await page.waitForFunction(()=>!!(window as any).__draw);
  await page.locator('#jevbtn').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame)).toEqual({id,revision});
  if(breaker===1)expect(await page.evaluate(()=>(window as any).__pool.gs.current)).toBe(1);
  const info=await page.request.get('/api/opponents/jev');
  expect((await info.json()).usage.gamesRemaining).toBe(0);
  await page.screenshot({path:'/tmp/pool-jev-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#morecontrols').click();
  await page.screenshot({path:'/tmp/pool-jev-mobile.png'});
});

test('rejected predicted shot restores both real clients and permits a valid retry',async({browser,page})=>{
  await open(page);await page.evaluate(()=>(window as any).__pool.connectRoom(true));
  await expect(page.locator('#roomlink')).toHaveValue(/#join=[A-Z2-9]{8}$/);
  const link=await page.locator('#roomlink').inputValue();
  const guestContext=await browser.newContext(),guest=await guestContext.newPage();
  try{
    await open(guest,link);await guest.evaluate(()=>(window as any).__pool.connectRoom(false));
    await expect.poll(()=>page.evaluate(()=>(window as any).__pool.room.ready)).toBe(true);
    await Promise.all([waitForOpening(page),waitForOpening(guest)]);
    const breaker=await page.evaluate(()=>(window as any).__pool.gs.current),shooter=breaker===0?page:guest;
    const before=await shooter.evaluate(()=>JSON.stringify((window as any).__pool.gs.balls.map((b:any)=>[b.x,b.y,b.potted])));
    await shooter.evaluate(()=>{const g=(window as any).__pool,room=g.room,send=room.shot.bind(room);
      room.shot=(shot:any)=>{room.shot=send;room.send({t:'shot',shot,revision:room.revision+1});};
      g.angle=0;g.fire(.2);
    });
    await expect.poll(()=>shooter.evaluate(()=>(window as any).__pool.pendingNetwork.length)).toBeGreaterThan(0);
    await shooter.evaluate(()=>{const g=(window as any).__pool;for(let i=0;i<200&&g.mode==='rolling';i++){g.accumulator+=.25;g.frame();}g.frame();});
    await expect.poll(()=>shooter.evaluate(()=>(window as any).__pool.mode)).toBe('aim');
    await expect(shooter.locator('#msg')).toContainText('stale table state');
    expect(await shooter.evaluate(()=>JSON.stringify((window as any).__pool.gs.balls.map((b:any)=>[b.x,b.y,b.potted])))).toBe(before);
    expect(await shooter.evaluate(()=>{const g=(window as any).__pool;return[g.room.revision,g.gs.winner];})).toEqual([0,null]);
    await shooter.evaluate(()=>{const g=(window as any).__pool;g.angle=0;g.fire(.2);});
    await expect.poll(()=>page.evaluate(()=>(window as any).__pool.room.revision)).toBe(1);
    for(const client of [page,guest])await client.evaluate(()=>{const g=(window as any).__pool;for(let i=0;i<200&&g.mode==='rolling';i++){g.accumulator+=.25;g.frame();}g.frame();});
    const settled=(client:Page)=>client.evaluate(()=>{const g=(window as any).__pool;return{mode:g.mode,current:g.gs.current,balls:g.gs.balls.map((b:any)=>[b.x,b.y,b.potted])};});
    const first=await settled(page),second=await settled(guest);expect(first.balls).toEqual(second.balls);expect(first.current).toBe(second.current);
    expect(first.mode).not.toBe('wait');expect(second.mode).not.toBe('wait');
  }finally{await guestContext.close();}
});
