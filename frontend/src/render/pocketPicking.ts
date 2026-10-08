import {Vector3,type PerspectiveCamera} from 'three';
import {POCKETS,TABLE_H,TABLE_W} from '../sim/table';

type Viewport={left:number;top:number;width:number;height:number};
/** Project an invisible generous disk around the pocket and rim, with a 48px touch diameter. */
export function pocketTargets(camera:PerspectiveCamera,rect:Viewport){
  camera.updateMatrixWorld();
  const right=new Vector3(1,0,0).applyQuaternion(camera.quaternion);
  const up=new Vector3(0,1,0).applyQuaternion(camera.quaternion);
  const pixel=(point:Vector3)=>({x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2});
  return POCKETS.flatMap((p,index)=>{
    const center=new Vector3(p.x-TABLE_W/2,.04,p.y-TABLE_H/2),projected=center.clone().project(camera);
    if(projected.z<=-1||projected.z>=1)return [];
    const at=pixel(projected),margin=p.r+.045;
    const edges=[right,up].map(axis=>pixel(center.clone().addScaledVector(axis,margin).project(camera)));
    const radius=Math.max(24,...edges.map(edge=>Math.hypot(edge.x-at.x,edge.y-at.y)));
    return [{index,...at,radius}];
  });
}
export function pickPocket(camera:PerspectiveCamera,rect:Viewport,x:number,y:number):number|null {
  const hits=pocketTargets(camera,rect).map(p=>({...p,distance:Math.hypot(x-p.x,y-p.y)}))
    .filter(p=>p.distance<=p.radius).sort((a,b)=>a.distance-b.distance);
  return hits[0]?.index??null;
}
