import {expect,it} from 'vitest';
import {planCpuTurn} from '../src/sim/cpu';
import {newGame,beginShot,applyShot} from '../src/sim/rules';
import {strike,simulateShot,allAsleep,shootSpeed} from '../src/sim/physics';
import {cueElevation} from '../src/sim/cue';
import type {RuleConfig} from '../src/sim/config';

const settings = [
  {preset:'bar'}, {preset:'tournament'},
  ...(['none','eight','all'] as const).flatMap(calls=>[1,8.5].map(normalMax=>({
    preset:'custom',calls,normalMax,breakMax:normalMax===1?1:12,
    scratch:normalMax===1?'kitchen':'anywhere',strictBreak:normalMax===1,
    assignOnBreak:normalMax!==1,scratchOnEightLoss:normalMax===1,eightOnBreak:normalMax===1?'spot':'win',
  }))),
] as Partial<RuleConfig>[];
function fixture(rules:Partial<RuleConfig>){
  const gs=newGame(1,rules); gs.breakShot=false;gs.open=false;gs.groups=['solid','stripe'];
  const positions=new Map([[0,[1.27,.95]],[1,[1.27,.38]],[8,[2.1,1.1]]]);
  for(const b of gs.balls){const p=positions.get(b.n??0);b.potted=!p;if(p)[b.x,b.y]=p;}
  return gs;
}
function execute(gs:ReturnType<typeof newGame>,shot:NonNullable<ReturnType<typeof planCpuTurn>>){
  const cue=gs.balls[0];beginShot(gs,shot.ball,shot.pocket);
  strike(cue,Math.cos(shot.angle),Math.sin(shot.angle),shot.power,shot.tipX,shot.tipY,
    gs.rules[gs.breakShot?'breakMax':'normalMax'],cueElevation(cue.x,cue.y,shot.angle,0,gs.balls));
  const ev=simulateShot(gs.balls,0);applyShot(gs,ev);expect(allAsleep(gs.balls)).toBe(true);
}
it.each(settings)('plans and executes with custom settings %j',rules=>{
  const gs=fixture(rules),before=structuredClone(gs),shot=planCpuTurn(gs,4,Infinity)!;
  expect(gs).toEqual(before);expect(shot.ball).toBe(1);
  expect(shot.power).toBeGreaterThanOrEqual(0);expect(shot.power).toBeLessThanOrEqual(1);
  expect(shot.pocket).toBeGreaterThanOrEqual(0);expect(shot.pocket).toBeLessThan(6);
  execute(gs,shot);
  if(shot.verified)expect(gs.ballInHand).toBe(false);
});
it('calibrates zero-budget geometry to physical speed at both custom cap boundaries',()=>{
  const standard=planCpuTurn(fixture({preset:'custom',normalMax:3.5}),0,Infinity)!;
  const low=planCpuTurn(fixture({preset:'custom',normalMax:1}),0,Infinity)!;
  const high=planCpuTurn(fixture({preset:'custom',normalMax:8.5}),0,Infinity)!;
  expect(low.power).toBe(1);expect(low.verified).toBe(false);
  expect(shootSpeed(high.power,8.5)).toBeCloseTo(shootSpeed(standard.power,3.5),10);
});
it.each([1,9.5,12])('executes a full break at cap %s even when strict break cannot be satisfied',breakMax=>{
  const gs=newGame(1,{preset:'custom',breakMax,strictBreak:true});
  const shot=planCpuTurn(gs,1,Infinity)!;expect(shot.power).toBe(1);execute(gs,shot);
});
