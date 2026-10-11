import {describe,it,expect} from 'vitest';
import {makeBall,shootSpeed,strike} from '../src/sim/physics';
import {strikeBalls} from '../src/sim/stroke';
import {BALL_R} from '../src/sim/table';
describe('shared impulse shot entry',()=>{
 it.each([[0,0,0,0],[.5,.3,-.2,.05],[1,0,0,.15]])('preserves baseline %s', (power,tx,ty,elevation)=>{
  const actual=makeBall(0,null,1,.6),reference=makeBall(0,null,1,.6);
  const events=strikeBalls([actual],0,1,0,power,tx,ty,undefined,elevation);
  strike(reference,1,0,power,tx,ty,undefined,elevation);
  expect(actual).toEqual(reference);expect(actual.x).toBe(1);
  expect(events.firstContact).toBeNull();expect(events).not.toHaveProperty('cueDoubleHit');
 });
 it('satisfies solid sphere angular impulse',()=>{
  const b=makeBall(0,null,1,.6);strikeBalls([b],0,1,0,.5,0,.3);
  expect(b.wy).toBeCloseTo(2.5*.3*shootSpeed(.5)/BALL_R,12);
  expect(b.vx).toBe(shootSpeed(.5));
 });
});
