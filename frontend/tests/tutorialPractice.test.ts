import {expect,it} from 'vitest';
import {practiceTable} from '../src/ui/tutorialPractice';
import {simulateShot,strike,allAsleep} from '../src/sim/physics';
import {beginShot,applyShot} from '../src/sim/rules';
import {cueElevation} from '../src/sim/cue';
it('stages a legal easy pot with the exact tutorial shot and independent states',()=>{
  const gs=practiceTable(), untouched=practiceTable(),snapshot=structuredClone(untouched);
  const cue=gs.balls[0],angle=Math.atan2(-.27,-.45);
  beginShot(gs,1,0);strike(cue,Math.cos(angle),Math.sin(angle),.4,0,0,gs.rules.normalMax,cueElevation(cue.x,cue.y,angle,0,gs.balls));
  const ev=simulateShot(gs.balls,0);applyShot(gs,ev);
  expect(ev.firstContact).toBe(1);expect(ev.cuePotted).toBe(false);
  expect(gs.balls.find(b=>b.n===1)!.potted).toBe(true);
  expect(gs.ballInHand).toBe(false);expect(allAsleep(gs.balls)).toBe(true);
  expect(untouched).toEqual(snapshot);
});
