import {expect,it} from 'vitest';
import {DT,makeBall,step,type Ball,type ShotEvents} from '../src/sim/physics';
import {BALL_R,POCKETS,TABLE_W,CORNER_SHELF,SIDE_SHELF,cushions} from '../src/sim/table';
const events=():ShotEvents=>({firstContact:null,potted:[],offTable:[],railAfterContact:false,cuePotted:false});
function run(b:Ball,dt=DT,seconds=2){const ev=events(),contact={v:false};for(let i=0;i<Math.ceil(seconds/dt);i++){step([b],dt,ev,0,contact);if(b.potted||b.asleep)break;}return ev;}
it('uses physical WPA mouth and shelf dimensions',()=>{
  const p=POCKETS[0];expect(cushions()[0].x1*Math.sqrt(2)).toBeCloseTo(.1143,12);
  expect(.1143/2-((p.x+p.y)/Math.sqrt(2)+p.r)).toBeCloseTo(CORNER_SHELF,12);
  expect(-POCKETS[1].y-POCKETS[1].r).toBeCloseTo(SIDE_SHELF,12);
});
it.each([.5,1,3,7])('physically drops center entry at %s m/s without off-table classification',speed=>{
  const b=makeBall(1,1,TABLE_W/2,.04);Object.assign(b,{vy:-speed,asleep:false});
  const ev=run(b);expect(ev.potted).toEqual([1]);expect(ev.offTable).toEqual([]);expect(b.z).toBeLessThan(-.11);
});
it('does not attract a stationary shelf hanger',()=>{const b=makeBall(1,1,TABLE_W/2,.002);b.asleep=false;expect(run(b).potted).toEqual([]);expect(b.y).toBe(.002);expect(b.z).toBe(0);});
it('keeps the ball live during descent before committing the pot',()=>{
  const p=POCKETS[1],b=makeBall(1,1,p.x,p.y);b.asleep=false;const ev=events();step([b],DT,ev,0,{v:false});
  expect(b.z).toBeLessThan(0);expect(b.potted).toBe(false);expect(ev.potted).toEqual([]);
});
it('lets a lip contact return to the cloth',()=>{const p=POCKETS[1],d=.003,b=makeBall(1,1,p.x,p.y+p.r-d);Object.assign(b,{z:Math.sqrt(BALL_R**2-d*d)-BALL_R,vy:.7,asleep:false});expect(run(b).potted).toEqual([]);expect(b.y).toBeGreaterThan(0);expect(b.z).toBe(0);});
it('converges when the outer timestep is halved',()=>{const fall=(dt:number)=>{const b=makeBall(1,1,TABLE_W/2,.01);Object.assign(b,{vy:-1,asleep:false});run(b,dt,.1);return b;};const a=fall(DT),b=fall(DT/2);expect(Math.abs(a.y-b.y)).toBeLessThan(.001);expect(Math.abs(a.z-b.z)).toBeLessThan(.001);});
it.each([[.045,1,.02],[.03,3,-.08]])('returns incoming offset %s speed %s through jaw/liner contact',(offset,speed,depth)=>{
  const b=makeBall(1,1,TABLE_W/2+offset,.08);Object.assign(b,{vy:-speed,asleep:false});
  const ev=events(),contact={v:false};let minY=.08,returned=false;
  for(let i=0;i<1200;i++){
    step([b],DT,ev,0,contact);minY=Math.min(minY,b.y);
    const energy=b.vx**2+b.vy**2+b.vz**2+.4*BALL_R**2*(b.wx**2+b.wy**2+b.wz**2)+2*9.81*b.z;
    expect(energy).toBeLessThanOrEqual(speed**2+1e-5);
    if(b.vy>0&&b.y>.08){returned=true;break;}
  }
  expect(minY).toBeLessThan(depth);expect(returned).toBe(true);expect(b.potted).toBe(false);expect(ev.potted).toEqual([]);
});
it('scores two physical arrivals in the same well once each',()=>{
  const balls=[makeBall(1,1,TABLE_W/2-.01,.04),makeBall(2,2,TABLE_W/2+.01,.13)];
  Object.assign(balls[0],{vy:-1,asleep:false});Object.assign(balls[1],{vy:-1.2,asleep:false});
  const ev=events(),contact={v:false};for(let i=0;i<1200;i++){step(balls,DT,ev,0,contact);if(balls.every(b=>b.potted))break;}
  expect(ev.potted.toSorted()).toEqual([1,2]);expect(ev.pockets).toHaveLength(2);expect(ev.offTable).toEqual([]);
});
