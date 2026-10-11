import {afterEach,expect,it,vi} from 'vitest';
import {breakPlans,planCpuTurn} from '../src/sim/cpu';
import {canPlace,newGame,placeCue,beginShot,applyShot} from '../src/sim/rules';
import {matchConfig} from '../src/sim/config';
import {strike,simulateShot} from '../src/sim/physics';
import {cueElevation} from '../src/sim/cue';

function random(seed:number){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
afterEach(()=>vi.unstubAllGlobals());
it('samples five legal break styles without mutating the table',()=>{
  const gs=newGame(),before=structuredClone(gs);
  const a=breakPlans(gs,random(1)),b=breakPlans(gs,random(2));
  expect(new Set(a.map(s=>s.breakStyle)).size).toBe(5);
  expect(a).toEqual(breakPlans(gs,random(1)));expect(a).not.toEqual(b);
  for(const s of a){expect(canPlace(gs,s.placement!.x,s.placement!.y)).toBe(true);expect(s.power).toBeLessThanOrEqual(1);}
  expect(gs).toEqual(before);
});
it('offline CPU varies breaks and executes the selected placement without any API calls',()=>{
  const fetcher=vi.fn(()=>{throw Error('CPU must never call a provider');});vi.stubGlobal('fetch',fetcher);
  const finishes=[];
  for(const seed of [1,2,3]){
    const gs=newGame(),shot=planCpuTurn(gs,12,Infinity,random(seed))!;
    expect(shot.verified).toBe(true);
    expect(placeCue(gs,shot.placement!.x,shot.placement!.y)).toBe(true);
    const cue=gs.balls[0];beginShot(gs,shot.ball,shot.pocket);
    strike(cue,Math.cos(shot.angle),Math.sin(shot.angle),shot.power,shot.tipX,shot.tipY,gs.rules.breakMax,
      cueElevation(cue.x,cue.y,shot.angle,0,gs.balls,shot.tipX,shot.tipY));
    const events=simulateShot(gs.balls,0);
    if(shot.breakStyle?.startsWith('second-'))expect(events.firstContact).toBe(shot.ball);
    applyShot(gs,events);expect(gs.ballInHand).toBe(false);
    finishes.push(`${cue.x},${cue.y}`);
  }
  expect(new Set(finishes).size).toBe(3);expect(fetcher).not.toHaveBeenCalled();
});
it('custom fixed starts prevent CPU relocation',()=>{
  const gs=newGame(1,matchConfig({preset:'custom',breakPlacement:false}));
  expect(breakPlans(gs,random(1)).every(s=>!s.placement)).toBe(true);
});
