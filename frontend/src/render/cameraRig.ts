import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TOUCH, MOUSE } from 'three';
import { BALL_R, TABLE_H, TABLE_W } from '../sim/table';

export type Point={x:number;y:number;potted?:boolean};
export type SafeFrame={left:number;right:number;top:number;bottom:number};
export type CueFacing={cue:Point;theta:number};
export const angleDelta=(from:number,to:number)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
/** Smallest cue-centered angular window containing a strict majority of targets. */
export function majorityFacing(cue:Point,targets:Point[],currentTheta:number):number {
  const bearings=targets.filter(p=>!p.potted&&Math.hypot(p.x-cue.x,p.y-cue.y)>.001)
    .map(p=>Math.atan2(p.x-cue.x,p.y-cue.y)).sort((a,b)=>a-b);
  const n=bearings.length;if(!n)return currentTheta;
  const k=Math.floor(n/2)+1,wrapped=[...bearings,...bearings.map(a=>a+Math.PI*2)];
  const candidates=bearings.map((_,i)=>({width:wrapped[i+k-1]-wrapped[i],theta:(wrapped[i]+wrapped[i+k-1])/2+Math.PI}));
  const narrowest=Math.min(...candidates.map(c=>c.width));
  // Near-equivalent clusters prefer the least movement, avoiding arbitrary flips.
  const best=candidates.filter(c=>c.width<=narrowest+.035).sort((a,b)=>Math.abs(angleDelta(currentTheta,a.theta))-Math.abs(angleDelta(currentTheta,b.theta)))[0];
  return currentTheta+angleDelta(currentTheta,best.theta);
}
export function framePose(camera:PerspectiveCamera,target:Vector3,points:Point[],safe:SafeFrame,facing?:CueFacing) {
  const live=points.filter(p=>!p.potted);
  if(!live.length)live.push({x:TABLE_W/2,y:TABLE_H/2});
  const minX=Math.min(...live.map(p=>p.x))-BALL_R-.08,maxX=Math.max(...live.map(p=>p.x))+BALL_R+.08;
  const minZ=Math.min(...live.map(p=>p.y))-BALL_R-.08,maxZ=Math.max(...live.map(p=>p.y))+BALL_R+.08;
  const center=new Vector3((minX+maxX-TABLE_W)/2,BALL_R,(minZ+maxZ-TABLE_H)/2);
  const orbit=new Spherical().setFromVector3(camera.position.clone().sub(target));
  if(facing){
    orbit.theta=facing.theta;
    // Keep the cue on the viewing axis, rather than centering between scattered targets.
    const cue=new Vector3(facing.cue.x-TABLE_W/2,BALL_R,facing.cue.y-TABLE_H/2);
    const direction=new Vector3(-Math.sin(orbit.theta),0,-Math.cos(orbit.theta));
    const along=center.clone().sub(cue).dot(direction);
    center.copy(cue).addScaledVector(direction,along);
  }
  orbit.phi=facing?1.12:MathUtils.clamp(orbit.phi,.55,1.0);
  const probe=camera.clone();probe.clearViewOffset();
  const cx=(safe.left+safe.right)/2,cy=(safe.top+safe.bottom)/2,tan=Math.tan(MathUtils.degToRad(camera.getEffectiveFOV())/2);
  let destination=center.clone();
  // Fit actual balls instead of empty corners of their overall bounding box.
  const padding=BALL_R+(facing?.045:.08);
  const fitPoints=live.flatMap(p=>[-padding,padding].flatMap(dx=>[-padding,padding].flatMap(dz=>[0,BALL_R*2].map(h=>new Vector3(p.x+dx-TABLE_W/2,h,p.y+dz-TABLE_H/2)))));
  for(let distance=facing?.85:1.0;;distance=Math.min(8,distance*1.08)) {
    orbit.radius=distance;probe.position.copy(center).add(new Vector3().setFromSpherical(orbit));probe.lookAt(center);
    const right=new Vector3(1,0,0).applyQuaternion(probe.quaternion),up=new Vector3(0,1,0).applyQuaternion(probe.quaternion);
    const shift=right.multiplyScalar(-cx*distance*tan*camera.aspect).add(up.multiplyScalar(-cy*distance*tan));
    destination=center.clone().add(shift);probe.position.add(shift);probe.lookAt(destination);probe.updateMatrixWorld();
    let fits=true;
    if(facing){
      const ahead=(probe.position.x-(facing.cue.x-TABLE_W/2))*(-Math.sin(orbit.theta))+(probe.position.z-(facing.cue.y-TABLE_H/2))*(-Math.cos(orbit.theta));
      if(ahead>-.15)fits=false;
    }
    for(const point of fitPoints) {
      const p=point.clone().project(probe);
      if(p.x<safe.left||p.x>safe.right||p.y<safe.bottom||p.y>safe.top)fits=false;
    }
    if(fits||distance>=8)break;
  }
  return {target:destination,position:probe.position.clone()};
}

export class CameraRig {
  revision=0;
  private motion?:{time:number;target:Vector3;end:Vector3;orbit:Spherical;endOrbit:Spherical};
  constructor(private camera:PerspectiveCamera,private controls:OrbitControls,private canvas:HTMLCanvasElement) {
    controls.maxDistance=8;controls.enablePan=false;controls.zoomSpeed=.8;controls.rotateSpeed=1;controls.dampingFactor=.12;
    controls.addEventListener('start',()=>this.cancel(true));
    canvas.addEventListener('pointerdown',()=>this.cancel(),{capture:true});
    canvas.addEventListener('wheel',e=>{
      this.cancel(true);
      // Shift + two-finger scroll gives trackpads an orbit gesture without a secondary click.
      // Pinch arrives as ctrl+wheel and remains handled by OrbitControls' zoom path.
      if(e.shiftKey&&!e.ctrlKey){
        e.preventDefault();e.stopImmediatePropagation();
        controls.dispatchEvent({type:'start'});
        const unit=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1;
        controls.rotateLeft((e.deltaX||e.deltaY)*unit*.004);
        if(e.deltaX)controls.rotateUp(e.deltaY*unit*.004);
        controls.update();controls.dispatchEvent({type:'end'});
      }
    },{capture:true,passive:false});
  }
  get moving(){return !!this.motion;}
  cancel(manual=false){this.motion=undefined;if(manual)this.revision++;}
  setMode(enabled:boolean){this.cancel(true);this.controls.enablePan=enabled;this.controls.mouseButtons.LEFT=enabled?MOUSE.ROTATE:-1 as MOUSE;this.controls.panSpeed=.6;this.controls.touches.ONE=enabled?TOUCH.ROTATE:-1 as TOUCH;this.controls.touches.TWO=enabled?TOUCH.DOLLY_PAN:TOUCH.DOLLY_ROTATE;}
  zoom(factor:number){this.cancel(true);const offset=this.camera.position.clone().sub(this.controls.target);offset.setLength(MathUtils.clamp(offset.length()*factor,.6,8));this.camera.position.copy(this.controls.target).add(offset);this.controls.update();}
  frame(points:Point[],cue?:Point,targets:Point[]=[]):number|undefined {
    this.cancel();
    const rect=this.canvas.getBoundingClientRect(),mobile=rect.width<900;
    const header=document.querySelector('.topbar')!.getBoundingClientRect(),cards=document.getElementById('scorecard')!.getBoundingClientRect(),tray=document.querySelector('.control-tray')!.getBoundingClientRect();
    const top=Math.min(rect.height*.45,(mobile?Math.max(header.bottom,cards.bottom):header.bottom)+20);
    const bottom=Math.min(rect.height-20,Math.max(top+80,tray.top-20));
    const left=mobile?20:Math.min(cards.right+24,rect.width*.3);
    const safe={left:2*left/rect.width-1,right:1-40/rect.width,top:1-2*top/rect.height,bottom:1-2*bottom/rect.height};
    const currentTheta=new Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target)).theta;
    const facing=cue?{cue,theta:majorityFacing(cue,targets,currentTheta)}:undefined;
    const pose=framePose(this.camera,this.controls.target,points,safe,facing);
    if(pose.target.distanceTo(this.controls.target)<.04&&pose.position.distanceTo(this.camera.position)<.12)return facing?.theta;
    const orbit=new Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const endOrbit=new Spherical().setFromVector3(pose.position.clone().sub(pose.target));
    // Return the facing direction so the game can align an idle human cue.
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){this.controls.target.copy(pose.target);this.camera.position.copy(pose.position);this.camera.lookAt(pose.target);return facing?.theta;}
    this.motion={time:performance.now(),target:this.controls.target.clone(),end:pose.target,orbit,endOrbit};
    return facing?.theta;
  }
  update(now:number){
    const m=this.motion;if(!m)return;
    const t=Math.min(1,(now-m.time)/750),ease=t*t*(3-2*t);
    this.controls.target.copy(m.target).lerp(m.end,ease);
    const orbit=new Spherical(MathUtils.lerp(m.orbit.radius,m.endOrbit.radius,ease),MathUtils.lerp(m.orbit.phi,m.endOrbit.phi,ease),m.orbit.theta+angleDelta(m.orbit.theta,m.endOrbit.theta)*ease);
    this.camera.position.copy(this.controls.target).add(new Vector3().setFromSpherical(orbit));this.camera.lookAt(this.controls.target);this.camera.updateMatrixWorld();
    if(t===1)this.motion=undefined;
  }
}
