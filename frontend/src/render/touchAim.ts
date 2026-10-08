import {Vector3,type PerspectiveCamera} from 'three';
import {BALL_R,TABLE_W,TABLE_H} from '../sim/table';

/** Local projected table axes keep touch rotation centered on the visible ball,
 * including foreground/horizon positions where a felt ray has no intersection. */
export function touchAimAngle(camera:PerspectiveCamera,rect:{left:number;top:number;width:number;height:number},
  cue:{x:number;y:number},clientX:number,clientY:number):number|null {
  const origin=new Vector3(cue.x-TABLE_W/2,BALL_R,cue.y-TABLE_H/2);
  const screen=(p:Vector3)=>{const n=p.project(camera);return {x:rect.left+(n.x+1)*rect.width/2,y:rect.top+(1-n.y)*rect.height/2};};
  const c=screen(origin.clone()),x=screen(origin.clone().add(new Vector3(.001,0,0))),y=screen(origin.clone().add(new Vector3(0,0,.001)));
  const dx=clientX-c.x,dy=clientY-c.y;
  if(Math.hypot(dx,dy)<4)return null;
  const ax=x.x-c.x,ay=x.y-c.y,bx=y.x-c.x,by=y.y-c.y,det=ax*by-ay*bx;
  if(!Number.isFinite(det)||Math.abs(det)<1e-10)return null;
  return Math.atan2((ax*dy-ay*dx)/det,(dx*by-dy*bx)/det);
}
