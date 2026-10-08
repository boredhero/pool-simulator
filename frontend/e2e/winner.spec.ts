import {expect,test,type Page} from '@playwright/test';
import {acceptWelcomeBeforeLoad,waitForOpening} from './welcomeFixture';

const account={id:'winner-owner',username:'god',createdAt:1780000000,premium:true,isAdmin:true};
test.beforeEach(async({page})=>{
  await acceptWelcomeBeforeLoad(page);
  await page.route('**/api/version',r=>r.fulfill({json:{version:'e2e'}}));
  await page.route('**/api/account',r=>r.fulfill({json:{account,stats:null}}));
  await page.addInitScript(()=>{
    const raf=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});
  });
});
async function open(page:Page){await page.goto('/');await page.waitForFunction(()=>!!(window as any).__pool?.account);await waitForOpening(page);}
async function finish(page:Page,opponent:'cpu'|'jev'|'online'|'local',winner=1){
  await page.evaluate(({opponent,winner})=>{
    const g=(window as any).__pool;g.cancelOpponent();g.gs={...g.gs,winner,message:`Player ${winner+1} wins the rack`};
    g.cpuOpponent=opponent==='cpu'||opponent==='jev';g.jevOpponent=opponent==='jev';
    g.roomNames=opponent==='online'?['Alice','Bob <safe>']:null;g.room=opponent==='online'?{ready:true}:null;
    g.mode='over';g.hud();
  },{opponent,winner});
}

test('real final eight pot celebrates signed-in winner and replay retains CPU opponent',async({page})=>{
  await open(page);
  await page.evaluate(()=>{
    const g=(window as any).__pool;g.cancelOpponent();g.cpuOpponent=true;g.gs.current=0;g.gs.breakShot=false;g.gs.groups=['solid','stripe'];g.gs.open=false;
    for(const b of g.gs.balls)b.potted=true;
    Object.assign(g.gs.balls[0],{potted:false,x:.9,y:.54});Object.assign(g.gs.balls.find((b:any)=>b.n===8),{potted:false,x:.45,y:.27});
    g.angle=g.targetAngle=Math.atan2(-.27,-.45);g.calledBall=8;g.calledPocket=0;g.mode='aim';g.fire(.4);
    let steps=0;while(g.mode==='rolling'&&steps++<240){g.accumulator+=.25;g.frame();}
  });
  await expect(page.locator('#winnertitle')).toHaveText('god wins!');
  expect(await page.evaluate(()=>(window as any).__pool.gs.winner)).toBe(0);
  await page.locator('#winnerreplay').click();await expect(page.locator('#winnerdialog')).not.toBeVisible();
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return {winner:g.gs.winner,cpu:g.cpuOpponent,mode:g.mode,balls:g.gs.balls.filter((b:any)=>!b.potted).length};})).toEqual({winner:null,cpu:true,mode:'aim',balls:16});
});

test('winner names follow CPU, Jev and room identities and dismissal remains dismissed',async({page})=>{
  await open(page);
  for(const [opponent,name] of [['cpu','CPU'],['jev','Jev AI'],['online','Bob <safe>']] as const){
    await finish(page,opponent);await expect(page.locator('#winnertitle')).toHaveText(`${name} wins!`);
    await expect(page.locator('#winnerdetail')).toContainText(name);
    if(opponent==='online')await expect(page.locator('#winnerreplay')).toHaveText('New online session');
    await page.locator('#winnerclose').click();
    await page.evaluate(()=>{const g=(window as any).__pool;for(let i=0;i<5;i++){g.hud();g.frame();}});
    await expect(page.locator('#winnerdialog')).not.toBeVisible();
  }
});

test('premium Jev replay creates a new server game through the real button',async({page})=>{
  await open(page);
  const state=await page.evaluate(()=>{const g=(window as any).__pool;return {balls:g.gs.balls,current:0,groups:[null,null],open:true,return_order:[],ball_in_hand:false,break_shot:true,placement:'none',kitchen_shot:false,rules:g.gs.rules,revision:0,winner:null,message:'Player 1 to break'};});
  const requests:any[]=[];await page.route('**/api/opponents/jev/games',async r=>{requests.push(r.request().postDataJSON());if(requests.length===1){await r.fulfill({status:503,json:{detail:'Temporarily unavailable; retry'}});return;}await r.fulfill({json:{id:'new-game',state,expiresAt:null}});});
  await page.evaluate(()=>(window as any).__pool.jevGame={id:'old-game',revision:1});
  await finish(page,'jev');await expect(page.locator('#winnerreplay')).toHaveText('Play Jev again');
  await page.locator('#winnerreplay').click();await expect(page.locator('#winnerstatus')).toContainText('Temporarily unavailable');
  await expect(page.locator('#winnerreplay')).toBeEnabled();
  await page.locator('#winnerreplay').click();await expect(page.locator('#winnerdialog')).not.toBeVisible();
  expect(requests).toEqual([{new_game:true},{new_game:true}]);
  expect(await page.evaluate(()=>{const g=(window as any).__pool;return [g.jevGame.id,g.jevOpponent,g.gs.winner];})).toEqual(['new-game',true,null]);
});

test('celebration is compact on narrow screens and honors reduced motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:320,height:568});await open(page);await finish(page,'local',0);
  await expect(page.locator('#winnerdialog')).toBeVisible();await expect(page.locator('.winner-confetti i')).toHaveCount(0);
  const geometry=await page.locator('#winnerdialog').evaluate(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
  expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(320);expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeLessThanOrEqual(568);
  await page.keyboard.press('Escape');await expect(page.locator('#winnerdialog')).not.toBeVisible();await expect(page.locator('#game-canvas')).toBeFocused();
});

test('tutorial and unfinished playback cannot show a winner dialog',async({page})=>{
  await open(page);
  expect(await page.evaluate(()=>{const g=(window as any).__pool;const started=g.tutorial.start();g.gs.winner=0;g.mode='over';g.hud();g.frame();return {started,active:g.tutorial.active};})).toEqual({started:true,active:true});
  await expect(page.locator('#winnerdialog')).not.toBeVisible();
  await page.evaluate(()=>{const g=(window as any).__pool;g.tutorial.close();g.gs.winner=0;g.gs.balls[0].asleep=false;g.gs.balls[0].vx=2;g.mode='rolling';g.hud();});
  await expect(page.locator('#winnerdialog')).not.toBeVisible();
  await page.evaluate(()=>{const g=(window as any).__pool;g.mode='over';g.gs.balls[0].asleep=false;g.gs.balls[0].vx=.2;g.hud();g.frame();});
  await expect(page.locator('#winnerdialog')).not.toBeVisible();
});
