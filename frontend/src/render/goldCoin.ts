import {CanvasTexture,CylinderGeometry,Group,Mesh,MeshStandardMaterial,Plane,Quaternion,Ray,Scene,SRGBColorSpace,Texture,TorusGeometry,Vector3,type PerspectiveCamera} from 'three';

export const COIN_RADIUS=.065;
export const COIN_THICKNESS=.009;
export const COIN_REST_Y=COIN_THICKNESS/2+.0003;
export const COIN_LAND_TIME=1.2;

/** Start outside the current camera's side edge, on a plane above the landing spot. */
export function coinEntry(camera:PerspectiveCamera,side:-1|1):Vector3 {
  camera.updateMatrixWorld();
  const origin=camera.getWorldPosition(new Vector3());
  const direction=new Vector3(side*1.5,.16,.5).unproject(camera).sub(origin).normalize();
  const plane=new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()),new Vector3(0,.45,0));
  return new Ray(origin,direction).intersectPlane(plane,new Vector3())??origin.clone().addScaledVector(direction,1.2);
}

/** World-space flight, two small contacts, then a flat face-up rest on the felt. */
export function coinPose(entry:Vector3,elapsed:number,seat:0|1){
  const t=Math.max(0,elapsed),end=seat===0?Math.PI*6:Math.PI*7;
  const position=new Vector3(0,COIN_REST_Y,0);
  let flip=end,rock=0;
  if(t<.88){
    const u=t/.88;position.copy(entry).lerp(position,u);position.y+=2.4*u*(1-u);
    flip=end*u;
  }else if(t<1.04){
    const u=(t-.88)/.16;position.y+=.055*Math.sin(Math.PI*u);rock=.12*Math.sin(Math.PI*2*u)*(1-u);
  }else if(t<COIN_LAND_TIME){
    const u=(t-1.04)/.16;position.y+=.012*Math.sin(Math.PI*u);rock=.04*Math.sin(Math.PI*2*u)*(1-u);
  }
  return {position,rotation:new Quaternion().setFromAxisAngle(new Vector3(1,0,0),flip).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),rock))};
}

function faceTexture(letter:'H'|'T'):Texture {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#eac05b';ctx.fillRect(0,0,256,256);
  ctx.strokeStyle='#967023';ctx.lineWidth=3;ctx.beginPath();ctx.arc(128,128,111,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#755019';ctx.font='bold 148px Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(letter,128,137);
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;return texture;
}

/** Decorative mesh only: it never enters the billiards simulation or its ball list. */
export class GoldCoin {
  readonly group=new Group();
  private entry=new Vector3();
  private seat:0|1=0;
  private resources:Array<{dispose():void}>=[];
  constructor(private scene:Scene,private camera:PerspectiveCamera,private makeTexture=faceTexture){
    this.group.name='Opening gold coin';this.group.visible=false;scene.add(this.group);
  }
  begin(seat:0|1){
    this.clear();this.seat=seat;this.entry.copy(coinEntry(this.camera,seat===0?-1:1));
    const top=this.makeTexture('H'),bottom=this.makeTexture('T');
    const edge=new MeshStandardMaterial({color:0xd4a338,metalness:.85,roughness:.3});
    const faces=[top,bottom].map(map=>new MeshStandardMaterial({map,metalness:.7,roughness:.38}));
    const cylinder=new CylinderGeometry(COIN_RADIUS,COIN_RADIUS,COIN_THICKNESS,64);
    const body=new Mesh(cylinder,[edge,...faces]);body.castShadow=true;body.receiveShadow=true;this.group.add(body);
    const rim=new TorusGeometry(COIN_RADIUS-.002,.0015,8,64);
    for(const sign of [-1,1]){const ring=new Mesh(rim,edge);ring.rotation.x=Math.PI/2;ring.position.y=sign*(COIN_THICKNESS/2-.0015);ring.castShadow=true;this.group.add(ring);}
    this.resources=[top,bottom,edge,...faces,cylinder,rim];this.group.visible=true;this.advance(0,false);
  }
  advance(elapsed:number,reduced:boolean){
    if(!this.group.visible)return;
    const pose=coinPose(this.entry,reduced?COIN_LAND_TIME:elapsed,this.seat);
    this.group.position.copy(pose.position);this.group.quaternion.copy(pose.rotation);
  }
  clear(){this.group.visible=false;this.group.clear();for(const resource of this.resources)resource.dispose();this.resources=[];}
  dispose(){this.clear();this.scene.remove(this.group);}
}
