import {afterEach,expect,it,vi} from 'vitest';
import {animateOpponentCue,cuePresentation,freezeShot} from '../src/ui/opponentCue';
afterEach(()=>vi.unstubAllGlobals());
it('holds the selected aim then pulls back and reaches contact, without a reduced-motion sweep',()=>{
  expect(cuePresentation(0,.7)).toEqual(cuePresentation(249,.7));
  expect(cuePresentation(400,.7).pull).toBeGreaterThan(cuePresentation(250,.7).pull);
  expect(cuePresentation(600,.7).pull).toBeLessThan(cuePresentation(550,.7).pull);
  expect(cuePresentation(670,.7).pull).toBe(0);
  expect(cuePresentation(139,.7,true)).toEqual({phase:'aiming',pull:.025});
});
it('owns an immutable selected shot including its placement',()=>{
  const input={aim:.2,power:.4,tipX:0,tipY:0,calledBall:1,calledPocket:0,placement:{x:.3,y:.4}};
  const snapshot=freezeShot(input);input.aim=2;input.placement.x=1;
  expect(snapshot.aim).toBe(.2);expect(snapshot.placement.x).toBe(.3);
  expect(Object.isFrozen(snapshot)).toBe(true);expect(Object.isFrozen(snapshot.placement)).toBe(true);
});
it('cancellation stops presentation and tab suspension does not skip the stroke',async()=>{
  let callback:(now:number)=>void=()=>{};
  vi.stubGlobal('requestAnimationFrame',(cb:(now:number)=>void)=>{callback=cb;return 1;});
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  const controller=new AbortController(),times:number[]=[];
  const result=animateOpponentCue(controller.signal,false,t=>times.push(t));
  callback(10);callback(90000);
  expect(times).toEqual([0,50]);controller.abort();expect(await result).toBe(false);
});
