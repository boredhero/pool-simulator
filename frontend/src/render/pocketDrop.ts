import { BALL_R, POCKETS } from '../sim/table';

type Ball = {n:number|null;x:number;y:number;potted:boolean};
type Drop = {x:number;y:number;px:number;py:number;elapsed:number};
/** Presentation only: capture and scoring stay authoritative in the simulator. */
export class PocketDrops {
  private previous=new Map<number|null,boolean>();
  private drops=new Map<number|null,Drop>();
  update(ball:Ball,dt:number):{x:number;y:number;height:number}|null {
    const wasPotted=this.previous.get(ball.n);
    this.previous.set(ball.n,ball.potted);
    if(!ball.potted){this.drops.delete(ball.n);return null;}
    if(wasPotted===false){
      const pocket=POCKETS.reduce((a,b)=>Math.hypot(ball.x-a.x,ball.y-a.y)<Math.hypot(ball.x-b.x,ball.y-b.y)?a:b);
      // Off-table fouls and already-pocketed network snapshots don't fall into a pocket.
      if(Math.hypot(ball.x-pocket.x,ball.y-pocket.y)<pocket.r+.07)
        this.drops.set(ball.n,{x:ball.x,y:ball.y,px:pocket.x,py:pocket.y,elapsed:0});
    }
    const drop=this.drops.get(ball.n);if(!drop)return null;
    const t=drop.elapsed;
    drop.elapsed+=Math.max(0,Math.min(dt,.1));
    if(t>=.42){this.drops.delete(ball.n);return null;}
    const inward=1-Math.pow(1-Math.min(1,t/.22),2);
    return {x:drop.x+(drop.px-drop.x)*inward,y:drop.y+(drop.py-drop.y)*inward,height:BALL_R-.012-2.45*t*t};
  }
}
