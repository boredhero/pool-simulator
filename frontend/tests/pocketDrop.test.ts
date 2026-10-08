import { expect, it } from 'vitest';
import { PocketDrops } from '../src/render/pocketDrop';
import { POCKETS } from '../src/sim/table';
it('shows a captured ball falling inward before removal without mutating its state',()=>{
  const drops=new PocketDrops(),p=POCKETS[1];
  const ball={n:1,x:p.x,y:p.y+.04,potted:false};
  expect(drops.update(ball,.016)).toBeNull();ball.potted=true;
  const start=drops.update(ball,.1)!;const next=drops.update(ball,.1)!;
  expect(start.height).toBeGreaterThan(next.height);expect(next.y).toBeLessThan(start.y);
  expect(ball).toEqual({n:1,x:p.x,y:p.y+.04,potted:true});
  for(let i=0;i<5;i++)drops.update(ball,.1);
  expect(drops.update(ball,.1)).toBeNull();
});
it('does not replay historical pots or animate off-table fouls, and resets for a new rack',()=>{
  const drops=new PocketDrops(),p=POCKETS[0],ball={n:8,x:p.x,y:p.y,potted:true};
  expect(drops.update(ball,.016)).toBeNull();
  ball.potted=false;drops.update(ball,.016);ball.potted=true;
  expect(drops.update(ball,.016)).not.toBeNull();
  ball.potted=false;expect(drops.update(ball,.016)).toBeNull();
  ball.x=-1;ball.potted=true;expect(drops.update(ball,.016)).toBeNull();
});
