import { describe, expect, it } from 'vitest';
import { breakShot, planCpuTurn, type CpuPlan } from '../src/sim/cpu';
import { allAsleep, simulateShot, strike } from '../src/sim/physics';
import { cueElevation } from '../src/sim/cue';
import { applyShot, beginShot, newGame, placeCue, type GameState } from '../src/sim/rules';
import { TABLE_W } from '../src/sim/table';

function fixture(): GameState {
  const gs=newGame(3);
  for(const b of gs.balls) b.potted=true;
  Object.assign(gs.balls[0],{potted:false,x:.25,y:.7});
  Object.assign(gs.balls[1],{potted:false,n:1,x:.4,y:.6});
  Object.assign(gs.balls[2],{potted:false,n:8,x:2.1,y:1.1});
  gs.groups=['stripe','solid'];gs.current=1;gs.open=false;gs.breakShot=false;
  return gs;
}
function execute(gs:GameState, shot:CpuPlan) {
  if(gs.ballInHand) expect(placeCue(gs,shot.placement!.x,shot.placement!.y)).toBe(true);
  const cue=gs.balls[0];
  beginShot(gs,shot.ball,shot.pocket);
  strike(cue,Math.cos(shot.angle),Math.sin(shot.angle),shot.power,shot.tipX,shot.tipY,
    gs.rules[gs.breakShot?'breakMax':'normalMax'],cueElevation(cue.x,cue.y,shot.angle,0,gs.balls));
  expect(cue.asleep).toBe(false);
  const ev=simulateShot(gs.balls,0);applyShot(gs,ev);
  expect(allAsleep(gs.balls)).toBe(true);
  return ev;
}

describe('offline CPU authoritative turn planning',()=>{
  it('reproduces the old kitchen fallback foul and chooses a legal exit-return kick',()=>{
    const gs=fixture();gs.kitchenShot=true;
    const original=structuredClone(gs);
    const broken={...breakShot(gs.balls),ball:1,pocket:0,family:'break',verified:false,score:0} as CpuPlan;
    execute(original,broken);
    expect(original.message).toContain('leave the kitchen first');
    const snapshot=structuredClone(gs);
    const shot=planCpuTurn(gs,12,Infinity)!;
    expect(gs).toEqual(snapshot);
    expect(shot.family).toBe('kick');expect(shot.verified).toBe(true);
    const ev=execute(gs,shot);
    expect(ev.firstContact).toBe(1);expect(ev.cueLeftKitchen).toBe(true);
    expect(ev.firstContactX).toBeLessThan(TABLE_W/4);
    expect(gs.ballInHand).toBe(false);expect(gs.message).not.toContain('Foul');
  });

  it('plans legal kitchen placement before firing and settling a shot',()=>{
    const gs=fixture();gs.balls[1].x=1.5;gs.balls[1].y=.55;
    gs.balls[0].potted=true;gs.ballInHand=true;gs.placement='kitchen';gs.kitchenShot=true;
    const snapshot=structuredClone(gs),shot=planCpuTurn(gs,12,Infinity)!;
    expect(gs).toEqual(snapshot);expect(shot.placement!.x).toBeLessThan(TABLE_W/4);
    expect(shot.verified).toBe(true);
    const ev=execute(gs,shot);
    expect(ev.firstContact).toBe(1);expect(gs.ballInHand).toBe(false);
    expect(gs.message).not.toContain('Foul');
  });

  it('never uses a potted apex or opponent ball as the default target',()=>{
    const gs=fixture();gs.balls[1].n=3;gs.balls[1].x=1.4;
    const shot=planCpuTurn(gs,0,0)!;
    expect(shot.ball).toBe(3);expect(shot.verified).toBe(false);
    expect(planCpuTurn({...gs,winner:0})).toBeNull();
  });
});
