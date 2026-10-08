import {expect,it} from 'vitest';
import matrix from '../../contracts/custom-rules-matrix.json';
import {matchConfig,type MatchConfig} from '../src/sim/config';
import {applyShot,beginShot,newGame} from '../src/sim/rules';
import type {ShotEvents} from '../src/sim/physics';

const configs=Object.entries(matrix.axes).reduce<Record<string,unknown>[]>((rows,[key,values])=>
  rows.flatMap(row=>values.map(value=>({...row,[key]:value}))),[{}]);
it.each(configs)('resolves shared custom rule policy examples for %j',options=>{
  for(const scenario of matrix.cases){
    const gs=newGame(1,matchConfig({preset:'custom',...options} as Partial<MatchConfig>));
    Object.assign(gs,structuredClone(scenario.state));
    for(const ball of gs.balls)ball.potted=(scenario.pottedBefore??[]).includes(ball.n!);
    beginShot(gs,scenario.call?.[0]??null,scenario.call?.[1]??null);
    const ev=structuredClone(scenario.ev) as ShotEvents;
    for(const ball of gs.balls)if(ev.potted.includes(ball.n!))ball.potted=true;
    applyShot(gs,ev);
    const variants=scenario.variants.filter(v=>Object.entries(v.when).every(([key,value])=>options[key]===value));
    expect(variants,scenario.name).toHaveLength(1);
    expect(gs,scenario.name).toMatchObject(variants[0].expected);
  }
});
