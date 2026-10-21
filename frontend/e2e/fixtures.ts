import {test as base, expect, type BrowserContext, type BrowserContextOptions, type Page} from '@playwright/test';
import {TERMS_VERSION} from '../src/ui/terms';

/** Defaults for background traffic only. Feature tests override these with page.route. */
export async function mockStandaloneApi(context:BrowserContext, unexpected:string[]) {
  await context.route('**/api/**', async route=>{
    const request=route.request();
    const path=new URL(request.url()).pathname;
    const key=`${request.method()} ${path}`;
    const responses:Record<string,unknown>={
      'GET /api/version':{version:'e2e'},
      'GET /api/account':{account:null,stats:null},
      'GET /api/privacy/terms':{version:TERMS_VERSION,accepted:false,authenticated:false,accountId:null},
      'GET /api/account/google':{enabled:false,linked:false},
      'GET /api/account/passkeys':{passkeys:[],recentlyVerified:false},
      // Opening guest sign-in starts conditional passkey autofill in supporting
      // browsers. Supply options, never a successful authentication response.
      'POST /api/account/passkeys/login/options':{
        ceremony:'0'.repeat(64),
        options:{challenge:'cG9vbC1lMmUtY29uZGl0aW9uYWwtY2hhbGxlbmdl',
          rpId:new URL(request.url()).hostname,timeout:60000,userVerification:'preferred'},
      },
      'GET /api/opponents/jev':{available:false},
      'POST /api/account/activity':{lastActiveAt:1},
    };
    if(Object.hasOwn(responses,key))return route.fulfill({json:responses[key]});
    if(key==='POST /api/privacy/consent'){
      const body=request.postDataJSON();
      return route.fulfill({json:{analytics:body?.allow===true&&body?.adult===true}});
    }
    if(key==='POST /api/privacy/events')return route.fulfill({status:204});
    // Never forward an unhandled API call to Vite's absent backend. Report the
    // method and path only: credentials and request bodies must not enter logs.
    unexpected.push(key);
    await route.fulfill({status:501,json:{detail:`Unhandled standalone API request: ${key}. Add an explicit test mock.`}});
  });
}

type Fixtures={
  unexpectedApiRequests:string[];
  standaloneApi:void;
  newStandaloneContext:(options?:BrowserContextOptions)=>Promise<BrowserContext>;
};

export const test=base.extend<Fixtures>({
  unexpectedApiRequests:async({},use)=>{
    const unexpected:string[]=[];
    await use(unexpected);
    expect(unexpected,'Unhandled standalone API requests. Add explicit page.route mocks for these features.').toEqual([]);
  },
  standaloneApi:[async({context,unexpectedApiRequests},use)=>{
    await mockStandaloneApi(context,unexpectedApiRequests);
    await use();
  },{auto:true}],
  newStandaloneContext:async({browser,baseURL,unexpectedApiRequests},use)=>{
    const contexts:BrowserContext[]=[];
    await use(async(options={})=>{
      const context=await browser.newContext({baseURL,serviceWorkers:'block',...options});
      contexts.push(context);
      await mockStandaloneApi(context,unexpectedApiRequests);
      return context;
    });
    await Promise.all(contexts.map(context=>context.close()));
  },
});
export {expect};
export {devices} from '@playwright/test';
export type {Page} from '@playwright/test';

/** Exercise the custom menu rather than changing the stored preference directly. */
export async function selectInputProfile(page:Page, value:'mouse'|'trackpad') {
  await page.locator('#camera-input-profile').click();
  await page.getByRole('menuitemradio', {name:value==='mouse'?'Mouse & Keyboard Mode':'Trackpad Mode',exact:true}).click();
}
