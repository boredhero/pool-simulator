import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TOUCH, MOUSE } from 'three';
import { BALL_R, TABLE_H, TABLE_W } from '../sim/table';

type Point={x:number;y:number;potted?:boolean};
export type SafeFrame={left:number;right:number;top:number;bottom:number};
export function framePose(camera:PerspectiveCamera,target:Vector3,points:Point[],safe:SafeFrame) {
  const live=points.filter(p=>!p.potted);
  if(!live.length)live.push({x:TABLE_W/2,y:TABLE_H/2});
  const minX=Math.min(...live.map(p=>p.x))-BALL_R-.08,maxX=Math.max(...live.map(p=>p.x))+BALL_R+.08;
  const minZ=Math.min(...live.map(p=>p.y))-BALL_R-.08,maxZ=Math.max(...live.map(p=>p.y))+BALL_R+.08;
  const center=new Vector3((minX+maxX-TABLE_W)/2,BALL_R,(minZ+maxZ-TABLE_H)/2);
  const orbit=new Spherical().setFromVector3(camera.position.clone().sub(target));
  orbit.phi=MathUtils.clamp(orbit.phi,.55,1.0);
  const probe=camera.clone();probe.clearViewOffset();
  const cx=(safe.left+safe.right)/2,cy=(safe.top+safe.bottom)/2,tan=Math.tan(MathUtils.degToRad(camera.getEffectiveFOV())/2);
  let destination=center.clone();
  for(let distance=1.0;;distance=Math.min(8,distance*1.08)) {
    orbit.radius=distance;probe.position.copy(center).add(new Vector3().setFromSpherical(orbit));probe.lookAt(center);
    const right=new Vector3(1,0,0).applyQuaternion(probe.quaternion),up=new Vector3(0,1,0).applyQuaternion(probe.quaternion);
    const shift=right.multiplyScalar(-cx*distance*tan*camera.aspect).add(up.multiplyScalar(-cy*distance*tan));
    destination=center.clone().add(shift);probe.position.add(shift);probe.lookAt(destination);probe.updateMatrixWorld();
    let fits=true;
    for(const x of [minX,maxX])for(const z of [minZ,maxZ])for(const h of [0,BALL_R*2]) {
      const p=new Vector3(x-TABLE_W/2,h,z-TABLE_H/2).project(probe);
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
    controls.maxDistance=8;controls.enablePan=false;controls.zoomSpeed=.8;controls.rotateSpeed=matchMedia('(pointer: coarse)').matches ? .65 : 1;
    controls.addEventListener('start',()=>this.cancel(true));
    canvas.addEventListener('pointerdown',()=>this.cancel(),{capture:true});
    canvas.addEventListener('wheel',()=>this.cancel(),{passive:true});
  }
  get moving(){return !!this.motion;}
  cancel(manual=false){this.motion=undefined;if(manual)this.revision++;}
  setMode(enabled:boolean){this.cancel(true);this.controls.enablePan=enabled;this.controls.mouseButtons.LEFT=enabled?MOUSE.ROTATE:-1 as MOUSE;this.controls.panSpeed=.6;this.controls.touches.ONE=enabled?TOUCH.ROTATE:-1 as TOUCH;this.controls.touches.TWO=enabled?TOUCH.DOLLY_PAN:TOUCH.DOLLY_ROTATE;}
  zoom(factor:number){this.cancel(true);const offset=this.camera.position.clone().sub(this.controls.target);offset.setLength(MathUtils.clamp(offset.length()*factor,.6,8));this.camera.position.copy(this.controls.target).add(offset);this.controls.update();}
  frame(points:Point[]) {
    this.cancel();
    const rect=this.canvas.getBoundingClientRect(),mobile=rect.width<900;
    const header=document.querySelector('.topbar')!.getBoundingClientRect(),cards=document.getElementById('scorecard')!.getBoundingClientRect(),tray=document.querySelector('.control-tray')!.getBoundingClientRect();
    const top=Math.min(rect.height*.45,(mobile?Math.max(header.bottom,cards.bottom):header.bottom)+20);
    const bottom=Math.min(rect.height-20,Math.max(top+80,tray.top-20));
    const left=mobile?20:Math.min(cards.right+24,rect.width*.3);
    const safe={left:2*left/rect.width-1,right:1-40/rect.width,top:1-2*top/rect.height,bottom:1-2*bottom/rect.height};
    const pose=framePose(this.camera,this.controls.target,points,safe);
    if(pose.target.distanceTo(this.controls.target)<.04&&pose.position.distanceTo(this.camera.position)<.12)return;
    const orbit=new Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const endOrbit=new Spherical().setFromVector3(pose.position.clone().sub(pose.target));
    // Group framing retains azimuth; no chosen ball, pocket or aim direction enters it.
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){this.controls.target.copy(pose.target);this.camera.position.copy(pose.position);this.camera.lookAt(pose.target);return;}
    this.motion={time:performance.now(),target:this.controls.target.clone(),end:pose.target,orbit,endOrbit};
  }
  update(now:number){
    const m=this.motion;if(!m)return;
    const t=Math.min(1,(now-m.time)/750),ease=t*t*(3-2*t);
    this.controls.target.copy(m.target).lerp(m.end,ease);
    const orbit=new Spherical(MathUtils.lerp(m.orbit.radius,m.endOrbit.radius,ease),MathUtils.lerp(m.orbit.phi,m.endOrbit.phi,ease),m.orbit.theta);
    this.camera.position.copy(this.controls.target).add(new Vector3().setFromSpherical(orbit));this.camera.lookAt(this.controls.target);this.camera.updateMatrixWorld();
    if(t===1)this.motion=undefined;
  }
}
