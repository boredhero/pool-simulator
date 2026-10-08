import { expect, it } from 'vitest';
import { allAsleep, DT, makeBall, step, strike, type ShotEvents } from '../src/sim/physics';
import { BALL_R } from '../src/sim/table';
const facts = (): ShotEvents => ({firstContact:null,potted:[],offTable:[],railAfterContact:false,cuePotted:false});
it('elevated impulse rebounds off slate, alters speed and spin, then lands', () => {
  const flat = makeBall(0,null,1,.6), raised = makeBall(0,null,1,.6);
  strike(flat,1,0,.6,.2,.1); strike(raised,1,0,.6,.2,.1,3.5,Math.PI / 4);
  expect(raised.vz).toBeGreaterThan(.5); expect(raised.vx).toBeLessThan(flat.vx); expect(raised.wx).not.toBe(flat.wx);
  let apex = 0; const ev=facts();
  for (let i=0;i<2400 && !allAsleep([raised]);i++) {step([raised],DT,ev,0,{v:false});apex=Math.max(apex,raised.z);expect(raised.z).toBeGreaterThanOrEqual(0);}
  expect(apex).toBeGreaterThan(.01); expect(raised.z).toBe(0); expect(raised.vz).toBe(0); expect(raised.asleep).toBe(true);
});
it('airborne balls clear a ball without a phantom planar collision', () => {
  const a=makeBall(0,null,1,.6), b=makeBall(1,1,1.08,.6); a.z=.15;a.vx=2;a.asleep=false;
  const ev=facts();for(let i=0;i<20;i++)step([a,b],DT,ev,0,{v:false});
  expect(a.x).toBeGreaterThan(b.x);expect(ev.firstContact).toBeNull();expect(b.asleep).toBe(true);
});
it('a low airborne impact transfers vertical momentum and separates in 3D', () => {
  const a=makeBall(0,null,1,.6), b=makeBall(1,1,1.065,.6);a.z=.025;a.vx=2;a.asleep=false;
  const ev=facts();for(let i=0;i<12;i++)step([a,b],DT,ev,0,{v:false});
  expect(ev.firstContact).toBe(1);expect(b.vx).toBeGreaterThan(0);
  expect(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)).toBeGreaterThanOrEqual(2*BALL_R-1e-6);
});
it('pure sidespin at rest does not delay the next turn', () => {
  const b=makeBall(0,null,1,.6); b.wz=180;b.asleep=false;step([b],DT,facts(),0,{v:false});expect(b.asleep).toBe(true);
});
it('radially clamps tip offset', () => {
  const a=makeBall(0,null,1,.6),b=makeBall(0,null,1,.6);
  strike(a,1,0,.5,.55,.55,3.5,.2);strike(b,1,0,.5,.55/Math.sqrt(2),.55/Math.sqrt(2),3.5,.2);
  expect(a.wx).toBeCloseTo(b.wx,10);expect(a.wy).toBeCloseTo(b.wy,10);expect(a.wz).toBeCloseTo(b.wz,10);
});

import flightFixtures from '../../contracts/flight-fixtures.json';
for (const fixture of flightFixtures) it(`matches shared flight fixture at ${fixture.elevation} radians`, () => {
  const b=makeBall(0,null,1,.6); strike(b,1,0,.7,fixture.tipX,fixture.tipY,3.5,fixture.elevation);
  const ev=facts(); for(let i=0;i<fixture.frames;i++) step([b],DT,ev,0,{v:false});
  for(const [key,value] of Object.entries(fixture.expected)) expect(b[key as keyof typeof b]).toBeCloseTo(value,7);
});
