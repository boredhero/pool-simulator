import { describe, expect, it } from 'vitest';
import { breakShot, planCpuTurn, type CpuPlan } from '../src/sim/cpu';
import { allAsleep, simulateShot, strike } from '../src/sim/physics';
import { cueElevation } from '../src/sim/cue';
import { applyShot, beginShot, newGame, placeCue, type GameState } from '../src/sim/rules';
import { TABLE_W } from '../src/sim/table';
import clusterFixtures from '../../backend/tests/cluster_fixtures.json';

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
  it.each(clusterFixtures)('uses measured controlled development for $name within four trials',testCase=>{
    const gs=newGame(1);
    gs.current=0;gs.groups=['solid','stripe'];gs.open=false;gs.breakShot=false;
    const positions=new Map(testCase.balls.map(([n,x,y])=>[n,{x,y}]));
    for(const b of gs.balls){const xy=positions.get(b.n??0);b.potted=!xy;if(xy)Object.assign(b,xy);}
    const snapshot=structuredClone(gs);
    const selected=planCpuTurn(gs,4,Infinity)!;
    expect(selected.verified).toBe(true);expect(selected.family).toBe('development');
    expect(selected.power).toBeGreaterThan(.6);expect(selected.power).toBeLessThan(1);
    expect(selected.evidence!.newTargetsAvailable).toBeGreaterThan(0);
    expect(selected.evidence!.nextShots).toBeGreaterThan(0);
    expect(gs).toEqual(snapshot);
    const ev=execute(gs,selected);
    expect(ev.firstContact).toBe(1);expect(ev.cuePotted).toBe(false);
    expect(gs.winner).toBeNull();expect(gs.ballInHand).toBe(false);
    const softState=structuredClone(snapshot);
    execute(softState,{...selected,power:.42});
    expect(softState.ballInHand).toBe(false);
    const pairCount=(state:GameState)=>state.balls.flatMap((a,i)=>state.balls.slice(i+1).filter(b=>
      !a.potted&&!b.potted&&a.n!==null&&b.n!==null&&a.n<8&&b.n<8&&Math.hypot(a.x-b.x,a.y-b.y)<.11215)).length;
    expect(pairCount(gs)).toBeLessThan(pairCount(softState));
  });
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
