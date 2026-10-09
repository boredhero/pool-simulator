import {test,expect,type Page} from '@playwright/test';
import {acceptWelcomeBeforeLoad,waitForOpening} from './welcomeFixture';
import {TERMS_VERSION} from '../src/ui/terms';
const account={id:'chalk-player',username:'ChalkPlayer',createdAt:1,premium:true,isAdmin:false,easterEggsEnabled:true,chalkSim:true};
test.beforeEach(async({page})=>{
 await acceptWelcomeBeforeLoad(page);await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
 await page.route('**/api/account',r=>r.fulfill({json:{account,stats:null}}));
 await page.route('**/api/privacy/terms',r=>r.fulfill({json:{version:TERMS_VERSION,accepted:true,authenticated:true,accountId:account.id}}));
 await page.route('**/api/opponents/jev',r=>r.fulfill({json:{available:false}}));
});
async function open(page:Page){await page.goto('/');await expect(page.locator('#accountidentityname')).toHaveText('ChalkPlayer');await waitForOpening(page);}
async function state(page:Page){return page.evaluate(()=>{const g=(window as any).__pool;return{balls:g.gs.balls,current:0,groups:[null,null],open:true,return_order:[],ball_in_hand:false,break_shot:true,placement:'none',kitchen_shot:false,rules:{...g.gs.rules,chalkSim:true},chalk:[.2,.4],revision:7,winner:null,message:'Break',ready:true};});}
test('local chalk is rendered twice, wears only at strike, and rechalk only restores the current player',async({page})=>{
 let saved={...account,chalkSim:false};await page.route('**/api/account',r=>r.fulfill({json:{account:saved,stats:null}}));
 await page.route('**/api/account/preferences',r=>{saved={...saved,...r.request().postDataJSON()};return r.fulfill({json:{account:saved}});});
 await open(page);await expect(page.locator('#chalkcontrols')).toBeHidden();await page.locator('#settingsbtn').click();await page.locator('#eastereggssettings summary').click();await page.locator('#chalksimenabled').check();await expect(page.locator('#chalksimenabled')).toBeChecked();await page.locator('#closesettings').click();
 await expect(page.locator('#chalkcontrols')).toBeVisible();
 expect(await page.evaluate(()=>{const group=(window as any).__pool.scene.coin.group.parent.getObjectByName('Billiard chalk');return{visible:group.visible,count:group.children.length};})).toEqual({visible:true,count:2});
 const wear=await page.evaluate(()=>{const g=(window as any).__pool;g.gs.current=0;g.gs.chalk=[1,.38];g.setSpin(.3,.2);g.targetAngle+=.2;g.hud();const before=[...g.gs.chalk];g.fire(.5);return{before,after:[...g.gs.chalk],mode:g.mode};});
 expect(wear.before).toEqual([1,.38]);expect(wear.after[0]).toBeLessThan(1);expect(wear.after[1]).toBe(.38);expect(wear.mode).toBe('rolling');
 const during=await page.evaluate(async()=>{const g=(window as any).__pool;await g.rechalk();return[...g.gs.chalk];});expect(during).toEqual(wear.after);
 await page.evaluate(()=>{const g=(window as any).__pool;g.mode='aim';g.gs.current=0;g.gs.winner=null;g.hud();});await page.locator('#rechalk').click();
 expect(await page.evaluate(()=>(window as any).__pool.gs.chalk)).toEqual([1,.38]);
});
test('CPU rechalks its own worn cue before planning a shot',async({page})=>{
 await open(page);
 const levels=await page.evaluate(()=>{const g=(window as any).__pool;g.cpuOpponent=true;g.gs.current=1;g.gs.chalk=[.31,.15];void g.cpuMove();const levels=[...g.gs.chalk];g.cancelOpponent();return levels;});
 expect(levels).toEqual([.31,1]);
});
test('Jev rechalk posts the current revision and waits for authoritative state',async({page})=>{
 await open(page);const initial=await state(page);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let payload:any=null;
 await page.route('**/api/opponents/jev/games',r=>r.fulfill({json:{id:'chalk-jev',created:false,state:initial,expiresAt:null}}));
 await page.route('**/api/opponents/jev/games/chalk-jev/chalk',async r=>{payload=r.request().postDataJSON();await gate;await r.fulfill({json:{state:{...initial,chalk:[1,.4],revision:8}}});});
 await page.evaluate(()=>(window as any).__pool.startJev(false));await expect(page.locator('#rechalk')).toBeEnabled();await page.locator('#rechalk').click();await expect.poll(()=>payload).toEqual({revision:7});await expect(page.locator('#rechalk')).toBeDisabled();expect(await page.evaluate(()=>(window as any).__pool.gs.chalk)).toEqual([.2,.4]);
 release();await expect.poll(()=>page.evaluate(()=>(window as any).__pool.gs.chalk)).toEqual([1,.4]);expect(await page.evaluate(()=>(window as any).__pool.jevGame.revision)).toBe(8);
});
for(const unlocked of [false,true])test(`room join sends preference and uses shared rule for ${unlocked?'unlocked':'locked'} account`,async({page})=>{
 await page.route('**/api/account',r=>r.fulfill({json:{account:{...account,easterEggsEnabled:unlocked,chalkSim:unlocked},stats:null}}));
 let initial:any,join:any=null,request:any=null;
 await page.routeWebSocket('**/ws',ws=>{ws.onMessage(raw=>{const message=JSON.parse(String(raw));if(message.t==='join'){join=message;ws.send(JSON.stringify({t:'room',you:0,code:'ABCD2345',state:{...initial,code:'ABCD2345'}}));}if(message.t==='chalk'){request=message;ws.send(JSON.stringify({t:'state',...initial,code:'ABCD2345',chalk:[1,.4],revision:8}));}});});
 await open(page);initial=await state(page);
 await page.evaluate(()=>{const g=(window as any).__pool;g.el.rcode.value='ABCD2345';g.connectRoom(false);});
 await expect.poll(()=>join?.chalkSim).toBe(unlocked);await expect(page.locator('#chalkcontrols')).toBeVisible();await expect(page.locator('#chalkstatus')).toContainText('Shared match rule');
 if(!unlocked)await expect(page.locator('#eastereggssettings')).toBeHidden();
 await page.locator('#rechalk').click();await expect.poll(()=>request).toEqual({t:'chalk',revision:7});await expect.poll(()=>page.evaluate(()=>(window as any).__pool.gs.chalk)).toEqual([1,.4]);
});
test('a late Jev rechalk response cannot replace a different game',async({page})=>{
 await open(page);const initial=await state(page);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let requested=false;
 await page.route('**/api/opponents/jev/games',r=>r.fulfill({json:{id:'old-chalk',created:false,state:initial,expiresAt:null}}));
 await page.route('**/api/opponents/jev/games/old-chalk/chalk',async r=>{requested=true;await gate;await r.fulfill({json:{state:{...initial,chalk:[1,1],revision:99}}});});
 await page.evaluate(()=>(window as any).__pool.startJev(false));await page.locator('#rechalk').click();await expect.poll(()=>requested).toBe(true);
 await page.evaluate(()=>{const g=(window as any).__pool;g.jevGame={...g.jevGame,id:'replacement',revision:12};g.gs.chalk=[.6,.7];});
 release();await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevRequest)).toBeNull();
 expect(await page.evaluate(()=>{const g=(window as any).__pool;return{id:g.jevGame.id,revision:g.jevGame.revision,chalk:g.gs.chalk};})).toEqual({id:'replacement',revision:12,chalk:[.6,.7]});
});
