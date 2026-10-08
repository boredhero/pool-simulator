import {expect,it} from 'vitest';
import {cueElevation} from '../src/sim/cue';
import {DT,makeBall,strike,step,allAsleep,type ShotEvents} from '../src/sim/physics';
import {newGame,beginShot,applyShot} from '../src/sim/rules';
import {BALL_R,jaws} from '../src/sim/table';
import rules from '../../contracts/off-table-rules.json';
import flight from '../../contracts/off-table-flight.json';
const facts=():ShotEvents=>({firstContact:null,potted:[],offTable:[],railAfterContact:false,cuePotted:false});
for(const c of rules)it(c.name,()=>{
  const gs=newGame(42,{preset:c.preset as 'bar'|'tournament'});gs.breakShot=c.breakShot;gs.open=false;gs.groups=['solid','stripe'];
  if(c.onEight)for(const b of gs.balls)if(b.n!==null&&b.n>=1&&b.n<=7)b.potted=true;
  beginShot(gs,c.onEight?8:2,0);
  for(const b of gs.balls)if(b.n===c.off||c.potted.includes(b.n as number))b.potted=true;
  const ev={...facts(),firstContact:c.onEight?8:1,offTable:[c.off],potted:c.potted,railAfterContact:true,pockets:c.potted.map(n=>({n,pocket:0}))};
  applyShot(gs,ev);expect(gs.winner).toBe(c.winner);expect(gs.placement).toBe(c.placement);
  if(gs.winner===null){expect(gs.current).toBe(1);expect(gs.ballInHand).toBe(true);expect(gs.breakShot).toBe(false);}
  for(const n of c.removed){expect(gs.returnOrder).toContain(n);expect(gs.balls.find(b=>b.n===n)!.potted).toBe(true);}
  for(const n of c.respot)expect(gs.balls.find(b=>b.n===n)!.potted).toBe(false);
});
for(const c of flight)it(c.name,()=>{
  const b=makeBall(0,null,c.x,c.y),angle=c.mirrorY?-c.aim:c.aim;
  strike(b,Math.cos(angle),Math.sin(angle),c.power,0,0,c.vmax,cueElevation(b.x,b.y,angle,0,[b]));
  const ev=facts(),contact={v:false};for(let i=0;i<5000&&!allAsleep([b]);i++)step([b],DT,ev,0,contact);
  expect(allAsleep([b])).toBe(true);expect(ev.offTable).toEqual(c.off?[null]:[]);expect(ev.cuePotted).toBe(c.off);expect(ev.potted).toEqual([]);
});
it('descending airborne jaw overlap does not collide with a phantom wall',()=>{
  const j=jaws()[0],b=makeBall(0,null,j.x+BALL_R+j.r-.002,j.y);Object.assign(b,{z:.08,vz:-.1,vx:-.2,asleep:false});
  const ev=facts();step([b],DT,ev,0,{v:false});expect(b.vx).toBeLessThan(0);expect(b.z).toBeGreaterThan(.05);expect(ev.offTable).toEqual([]);expect(ev.cuePotted).toBe(false);
});

import {eightBall} from '../src/sim/rules';
it('identifies the revised rule behavior',()=>expect(eightBall.version).toBe(2));
