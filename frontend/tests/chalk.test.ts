import {expect,it} from 'vitest';
import cases from '../../contracts/chalk.json';
import {chalkContact,wearChalk} from '../src/sim/chalk';
import {makeBall,strike} from '../src/sim/physics';
it.each(cases)('$name matches authoritative chalk impulse and wear',c=>{
 const b=makeBall(0,null,1,.6);strike(b,1,0,c.power,c.tipX,c.tipY,3.5,c.elevation,c.level);
 [b.vx,b.vy,b.vz,b.wx,b.wy,b.wz].forEach((v,i)=>expect(v).toBeCloseTo(c.velocity[i],11));
 expect(chalkContact(c.level,c.tipX,c.tipY).grip).toBeCloseTo(c.grip,12);
 expect(wearChalk(c.level,c.power,c.tipX,c.tipY)).toBeCloseTo(c.remaining,12);
});
it('fresh chalk preserves ordinary strikes and bare center hits still grip',()=>{
 for(const e of [0,.3,.8])for(const tx of [-.55,0,.55]){
  const a=makeBall(0,null,1,.6),b=makeBall(0,null,1,.6);
  strike(a,1,0,.7,tx,0,3.5,e);strike(b,1,0,.7,tx,0,3.5,e,1);expect(b).toEqual(a);
 }
 expect(chalkContact(0,0,0).grip).toBe(1);
 expect(chalkContact(0,.55,0).grip).toBeLessThan(1);
});
it('wear is bounded and depends on accepted stroke energy and offset',()=>{
 let level=1;for(let i=0;i<30;i++){const next=wearChalk(level,.7,.3,.4);expect(next).toBeLessThanOrEqual(level);expect(next).toBeGreaterThanOrEqual(0);level=next;}
 expect(level).toBe(0);expect(wearChalk(1,.8,.5,0)).toBeLessThan(wearChalk(1,.2,0,0));
});
