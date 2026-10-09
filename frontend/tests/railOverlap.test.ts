import {describe, expect, it} from 'vitest';
import {DT, makeBall, step, type ShotEvents} from '../src/sim/physics';
import {BALL_R, TABLE_H, TABLE_W} from '../src/sim/table';

const rails = [
  [1, BALL_R, 0, 1],
  [1, TABLE_H - BALL_R, 0, -1],
  [BALL_R, .6, 1, 0],
  [TABLE_W - BALL_R, .6, -1, 0],
];
const events = (): ShotEvents => ({firstContact:null,potted:[],offTable:[],railAfterContact:false,cuePotted:false});

describe.each(rails)('rail overlap at (%s, %s), normal (%s, %s)', (x,y,nx,ny)=>{
  it.each([1e-12,1e-6,1e-4])('recovers grounded object penetration %s without tunneling',penetration=>{
    const ball=makeBall(1,1,x-nx*penetration,y-ny*penetration);
    Object.assign(ball,{vx:-nx,vy:-ny,asleep:false});
    const ev=events();
    step([ball],DT,ev,0,{v:true});
    expect(ball.vx*nx+ball.vy*ny).toBeGreaterThan(0);
    expect((ball.x-x)*nx+(ball.y-y)*ny).toBeGreaterThanOrEqual(-1e-12);
    expect(ball.z).toBe(0);expect(ev.railAfterContact).toBe(true);
    for(let i=0;i<240;i++)step([ball],DT,ev,0,{v:true});
    expect(ball.potted).toBe(false);expect(ev.offTable).toEqual([]);
  });

  it('keeps a rail-frozen object on the table when another ball pushes it into the cushion',()=>{
    const cue=makeBall(0,null,x+nx*(2*BALL_R-1e-6),y+ny*(2*BALL_R-1e-6));
    Object.assign(cue,{vx:-nx,vy:-ny,asleep:false});
    const obj=makeBall(1,1,x,y),ev=events(),contact={v:false};
    for(let i=0;i<240;i++) {
      step([cue,obj],DT,ev,0,contact);
      expect((obj.x-x)*nx+(obj.y-y)*ny).toBeGreaterThanOrEqual(-1e-9);
      expect(obj.z).toBe(0);expect(obj.potted).toBe(false);
    }
    expect(ev.firstContact).toBe(1);expect(ev.railAfterContact).toBe(true);
    expect(ev.offTable).toEqual([]);
  });

  it('preserves genuine airborne object departures over the rail',()=>{
    const ball=makeBall(1,1,x-nx*1e-6,y-ny*1e-6);
    Object.assign(ball,{z:.1,vx:-4*nx,vy:-4*ny,asleep:false});
    const ev=events();
    step([ball],DT,ev,0,{v:true});
    expect(ball.z).toBeGreaterThan(.05);expect(ball.vx*nx+ball.vy*ny).toBeLessThan(0);
    expect(ev.railAfterContact).toBe(false);
    for(let i=0;i<24;i++)step([ball],DT,ev,0,{v:true});
    expect(ev.offTable).toEqual([1]);
  });
});
