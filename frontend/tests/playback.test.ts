import { expect, it } from 'vitest';
import { allAsleep, DT, makeBall, step, type ShotEvents } from '../src/sim/physics';
import { BALL_R } from '../src/sim/table';
import { advancePlayback, playbackRate } from '../src/ui/playback';
const facts=():ShotEvents=>({firstContact:null,potted:[],offTable:[],railAfterContact:false,cuePotted:false});
it('tiny sliding velocities settle without a friction limit cycle or energy gain',()=>{
  const b=makeBall(0,null,1,.6); b.vx=.014;b.asleep=false;
  let energy=b.vx*b.vx;
  for(let i=0;i<240&&!b.asleep;i++) {
    step([b],DT,facts(),0,{v:false});
    const next=b.vx*b.vx+b.vy*b.vy+.4*BALL_R*BALL_R*(b.wx*b.wx+b.wy*b.wy);
    expect(next).toBeLessThanOrEqual(energy+1e-12);energy=next;
  }
  expect(b.asleep).toBe(true);
});
it('rolling deceleration matches mu*g until the sleep threshold',()=>{
  const b=makeBall(0,null,1,.6);b.vx=.1;b.wy=.1/BALL_R;b.asleep=false;
  for(let i=0;i<120;i++)step([b],DT,facts(),0,{v:false});
  expect(b.vx).toBeCloseTo(.1-.01*9.81*.5,10);
  expect(b.wy*BALL_R).toBeCloseTo(b.vx,10);
});
it('fast playback preserves every contact and final state while reducing wall time',()=>{
  const run=(fast:boolean)=>{
    const a=makeBall(0,null,1,.6),b=makeBall(1,1,1.1,.6);
    a.vx=.2;a.wy=.2/BALL_R;a.asleep=false;
    const balls=[a,b],ev=facts(),contact={v:false};let budget=0,frames=0;
    while(!allAsleep(balls)&&frames<600){budget=advancePlayback(balls,ev,contact,budget+1/60,fast).remaining;frames++;}
    expect(allAsleep(balls)).toBe(true);return {balls,ev,frames};
  };
  const normal=run(false),fast=run(true);
  expect(fast.balls).toEqual(normal.balls);expect(fast.ev).toEqual(normal.ev);
  expect(fast.ev.firstContact).toBe(1);expect(fast.frames).toBeLessThan(normal.frames/2);
});
it('requires all balls slow and grounded and respects disabled preference',()=>{
  const b=makeBall(0,null,1,.6);b.vx=.1;b.asleep=false;
  expect(playbackRate([b],false)).toBe(1);expect(playbackRate([b],true)).toBe(4);
  b.z=.01;expect(playbackRate([b],true)).toBe(1);b.z=0;b.wy=20;
  expect(playbackRate([b],true)).toBe(1);b.wy=0;b.vx=.3;expect(playbackRate([b],true)).toBe(1);
});
