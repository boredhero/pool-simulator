import { afterEach, expect, it, vi } from 'vitest';
import { jevRequest } from '../src/sim/jev';
afterEach(()=>vi.unstubAllGlobals());
it('uses authenticated same-origin game endpoints and passes cancellation',async()=>{
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'game'})});
  vi.stubGlobal('fetch',fetcher);
  expect(await jevRequest('/games',{},new AbortController().signal)).toEqual({id:'game'});
  expect(fetcher.mock.calls[0][0]).toBe('/api/opponents/jev/games');
  expect(fetcher.mock.calls[0][1].headers['X-Pool-Request']).toBe('1');
});
it('surfaces server sign-in and daily allowance errors',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({detail:'Sign in first.'})}));
  await expect(jevRequest('/games',{},new AbortController().signal)).rejects.toThrow('Sign in first.');
});
