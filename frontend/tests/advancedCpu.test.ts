import {afterEach,expect,it,vi} from 'vitest';
import {planCpuTurn} from '../src/sim/cpu';
import {newGame,type GameState} from '../src/sim/rules';

function layout(positions:Record<number,[number,number]>):GameState{
 const state=newGame();state.breakShot=false;state.open=false;state.groups=['solid','stripe'];
 for(const b of state.balls){const p=positions[b.n??0];b.potted=!p;if(p)[b.x,b.y]=p;}
 return state;
}
afterEach(()=>vi.unstubAllGlobals());
it('verifies continuation through the eight without any provider calls',()=>{
 const fetcher=vi.fn(()=>{throw Error('CPU cannot use a provider');});vi.stubGlobal('fetch',fetcher);
 const s=layout({0:[1.27,.6],1:[1.27,.12],8:[2.4,.12]}),before=structuredClone(s);
 const plan=planCpuTurn(s,16,Infinity)!;
 expect(plan.verified).toBe(true);expect(plan.evidence?.followUpVerified).toBe(true);
 expect(plan.evidence?.lookaheadDepth).toBeGreaterThanOrEqual(2);expect(plan.evidence?.runout).toBe(true);
 expect(s).toEqual(before);expect(fetcher).not.toHaveBeenCalled();
});
it('keeps deadline exhaustion explicitly unverified',()=>{
 const s=layout({0:[.5,.635],1:[1.4,.635],9:[.85,.635],8:[2,.3]});
 const plan=planCpuTurn(s,12,0)!;expect(plan.verified).toBe(false);expect(plan.evidence?.runout).toBeUndefined();
});
