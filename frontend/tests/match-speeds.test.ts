import {expect,it} from 'vitest';
import cases from '../../contracts/match-speeds.json';
import {matchConfig,type MatchConfig} from '../src/sim/config';
import {shootSpeed} from '../src/sim/physics';
it.each(cases)('keeps the shared normal/break speed contract for $input',c=>{
 const rules=matchConfig(c.input as Partial<MatchConfig>);
 expect(rules.normalMax).toBe(c.normalMax);expect(rules.breakMax).toBe(c.breakMax);
 expect(shootSpeed(1,rules.normalMax)).toBe(c.normalMax);expect(shootSpeed(1,rules.breakMax)).toBe(c.breakMax);
});

it('canonicalizes the launch speed affected by Node 22 pow rounding', () => {
 expect(shootSpeed(0.8120963088290007,9.5)).toBe(7.032084929271);
});
