import {test,expect,type Page} from '@playwright/test';
import {acceptWelcomeBeforeLoad} from './welcomeFixture';
import {BAR_RULES,TOURNAMENT_RULES,type MatchConfig} from '../src/sim/config';
import {TERMS_VERSION} from '../src/ui/terms';
test.beforeEach(async({page})=>{
 await acceptWelcomeBeforeLoad(page);await page.addInitScript(()=>{localStorage.setItem('pool:help-dismissed','1');localStorage.setItem('pool:privacy',JSON.stringify({version:'2026-10-08',allow:false}));const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>{const g=(window as any).__pool;if(g)g.scene.renderer.render=()=>{};cb(t);});});
 await page.route('**/api/version',r=>r.fulfill({json:{version:'e2e'}}));await page.route('**/api/account',r=>r.fulfill({json:{account:{id:'rules-player',username:'player',premium:true,isAdmin:false,createdAt:1},stats:null}}));
 await page.route('**/api/privacy/terms',r=>r.fulfill({json:{version:TERMS_VERSION,accepted:true,authenticated:true,accountId:'rules-player'}}));await page.route('**/api/opponents/jev',r=>r.fulfill({json:{available:false}}));
 await page.goto('/');await expect(page.locator('#accountidentityname')).toHaveText('player');
});
async function state(page:Page,rules:MatchConfig){return page.evaluate(rules=>{const g=(window as any).__pool;return{balls:g.gs.balls,current:0,groups:[null,null],open:true,return_order:[],ball_in_hand:false,break_shot:true,placement:'none',kitchen_shot:false,rules,revision:0,winner:null,message:'Player 1 to break'};},rules);}
test('CPU and a new Jev game both use the selected tournament rules',async({page})=>{
 await page.locator('#settingsbtn').click();await page.locator('#rulespreset').selectOption('tournament');await page.locator('#applyrules').click();await page.locator('#cpubtn').click();
 expect(await page.evaluate(()=>(window as any).__pool.gs.rules)).toEqual(TOURNAMENT_RULES);expect(await page.evaluate(()=>(window as any).__pool.cpuOpponent)).toBe(true);
 const server=await state(page,TOURNAMENT_RULES);await page.route('**/api/opponents/jev/games',r=>{expect(r.request().postDataJSON()).toEqual({rules:TOURNAMENT_RULES});return r.fulfill({json:{id:'tournament',created:true,expiresAt:null,state:server}});});
 await page.locator('#jevbtn').click();await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.id)).toBe('tournament');expect(await page.evaluate(()=>(window as any).__pool.gs.rules)).toEqual(TOURNAMENT_RULES);
});
test('existing Jev game keeps server rules and explains a differing local selection',async({page})=>{
 await page.locator('#settingsbtn').click();await page.locator('#rulespreset').selectOption('tournament');await page.locator('#applyrules').click();const server=await state(page,BAR_RULES);
 await page.evaluate(()=>(window as any).__pool.account.premium=false);
 await page.route('**/api/opponents/jev/games',r=>r.fulfill({json:{id:'existing',created:false,expiresAt:9999999999,state:server}}));await page.locator('#jevbtn').click();await expect(page.locator('#opponentstatus')).toContainText('existing Jev game keeps its original rules');expect(await page.evaluate(()=>(window as any).__pool.gs.rules)).toEqual(BAR_RULES);
 await page.locator('#settingsbtn').click();await expect(page.locator('#rulespreset')).toBeDisabled();await expect(page.locator('#applyrules')).toBeDisabled();await expect(page.locator('#rulesnotice')).toContainText('Jev game keeps its starting rules');
});
test('premium custom rules create a new Jev game only on explicit apply',async({page})=>{
 const initial=await state(page,BAR_RULES);const requests:any[]=[];
 await page.route('**/api/opponents/jev/games',r=>{const payload=r.request().postDataJSON();requests.push(payload);return r.fulfill({json:{id:requests.length===1?'original':'custom',created:true,expiresAt:null,state:{...initial,rules:payload.rules}}});});
 await page.locator('#jevbtn').click();await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.id)).toBe('original');
 await page.locator('#settingsbtn').click();await page.locator('#rulespreset').selectOption('custom');await page.locator('#scratchrule').selectOption('anywhere');await page.locator('#callsrule').selectOption('all');await page.locator('#eightbreakrule').selectOption('spot');await page.locator('#strictbreakrule').check();await page.locator('#normalspeed').fill('5');await page.locator('#breakspeed').fill('10');
 expect(requests).toHaveLength(1);expect(await page.evaluate(()=>(window as any).__pool.gs.rules)).toEqual(BAR_RULES);await expect(page.locator('#applyrules')).toHaveText('Start new Jev game with these rules');
 await page.locator('#applyrules').click();await expect.poll(()=>page.evaluate(()=>(window as any).__pool.jevGame?.id)).toBe('custom');expect(requests[1]).toEqual({new_game:true,rules:{...BAR_RULES,preset:'custom',scratch:'anywhere',calls:'all',eightOnBreak:'spot',strictBreak:true,normalMax:5,breakMax:10}});expect(await page.evaluate(()=>(window as any).__pool.gs.rules)).toEqual(requests[1].rules);
});
