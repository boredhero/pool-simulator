import {test,expect} from './fixtures';
import {test as isolatedTest} from '@playwright/test';
import {mockStandaloneApi} from './fixtures';

test('background API defaults work on fresh pages and additional contexts',async({page,newStandaloneContext})=>{
  const extra=await newStandaloneContext();
  for(const target of [page,await page.context().newPage(),await extra.newPage()]){
    // Load a static document so these checks do not depend on game rendering.
    await target.goto('/privacy.html');
    const result=await target.evaluate(async()=>{
      const version=await (await fetch('/api/version')).json();
      const account=await (await fetch('/api/account')).json();
      const consent=await (await fetch('/api/privacy/consent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({allow:false,adult:false})})).json();
      return {version,account,consent};
    });
    expect(result).toEqual({version:{version:'e2e'},account:{account:null,stats:null},consent:{analytics:false}});
  }
});

test('feature routes override defaults, including explicit failure responses',async({page})=>{
  await page.route('**/api/privacy/consent',route=>route.fulfill({status:503,json:{detail:'Deliberate outage'}}));
  await page.goto('/privacy.html');
  expect(await page.evaluate(async()=>(await fetch('/api/privacy/consent',{method:'POST'})).status)).toBe(503);
});

isolatedTest('unknown routes and wrong methods are blocked and recorded without payloads',async({context,page})=>{
  const unexpected:string[]=[];
  await mockStandaloneApi(context,unexpected);
  await page.goto('/privacy.html');
  const statuses=await page.evaluate(async()=>{
    const results=[];
    for(const path of ['/api/not-mocked?secret=private','/api/version']){
      results.push((await fetch(path,{method:'POST',body:'private request body'})).status);
    }
    return results;
  });
  expect(statuses).toEqual([501,501]);
  expect(unexpected).toEqual(['POST /api/not-mocked','POST /api/version']);
});
