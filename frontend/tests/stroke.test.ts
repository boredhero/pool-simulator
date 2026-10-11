import {describe,it,expect} from 'vitest';
import {makeBall,shootSpeed} from '../src/sim/physics';
import {strikeBalls} from '../src/sim/stroke';
import {BALL_R} from '../src/sim/table';
describe('compliant cue contact',()=>{
 it.each([0,.25,.5,1])('preserves center speed calibration at %s',power=>{
  const b=makeBall(0,null,1,.6),ev=strikeBalls([b],0,1,0,power,0,0);
  expect(Math.abs(b.vx/shootSpeed(power)-1)).toBeLessThan(.025);
  expect(b.vy).toBe(0);expect(b.x).toBeGreaterThan(1);expect(b.x).toBeLessThan(1.006);
  expect(ev.cueDoubleHit).not.toBe(true);expect(ev.cuePush).not.toBe(true);
 });
 it('mirrors sidespin and deflection',()=>{
  const a=makeBall(0,null,1,.6),b=makeBall(0,null,1,.6);
  strikeBalls([a],0,1,0,1,.3,0);strikeBalls([b],0,1,0,1,-.3,0);
  expect(a.vx).toBeCloseTo(b.vx,12);expect(a.vy).toBeCloseTo(-b.vy,12);expect(a.wz).toBeCloseTo(-b.wz,10);
 });
 it.each([[0,false],[.0005,true],[.005,true],[.02,false]] as const)('resolves nearby gap %s', (gap,foul)=>{
  const cue=makeBall(0,null,1,.6),target=makeBall(1,1,1+2*BALL_R+gap,.6);
  const ev=strikeBalls([cue,target],0,1,0,.5,0,0);
  expect(ev.firstContact).toBe(1);expect(Boolean(ev.cueDoubleHit)).toBe(foul);expect(target.vx).toBeGreaterThan(0);
 });
});
