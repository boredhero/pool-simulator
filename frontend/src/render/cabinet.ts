import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TABLE_H,TABLE_W,BALL_R } from '../sim/table';
export const RETURN_Z=TABLE_H/2+.104;
export const RETURN_Y=-.245;
export const returnPosition=(index:number)=>new THREE.Vector3(-.48+index*(2*BALL_R+.006),RETURN_Y,RETURN_Z);

/** Furniture below the slate, with a real opening through the front apron. */
export function createCabinet(wood:THREE.Material):THREE.Group {
  const cabinet=new THREE.Group();cabinet.name='Table cabinet and ball-view door';
  const metal=new THREE.MeshStandardMaterial({color:0x83715a,roughness:.48,metalness:.5});
  const dark=new THREE.MeshStandardMaterial({color:0x181411,roughness:.88});
  const box=(name:string,w:number,h:number,d:number,x:number,y:number,z:number,material:THREE.Material=wood,r=.018)=>{
    const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,Math.min(r,w/3,h/3,d/3)),material);
    mesh.name=name;mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;cabinet.add(mesh);return mesh;
  };
  const end=TABLE_W/2+.062, side=TABLE_H/2+.063;
  box('Back apron',TABLE_W+.12,.27,.13,0,-.22,-side);
  for(const sign of [-1,1]) {
    box('End apron',.13,.27,TABLE_H+.13,sign*end,-.22,0);
    box('Front apron wing',.78,.27,.13,sign*.98,-.22,side);
  }
  // Window spans 1.18 m. Its top/bottom and side pieces never occlude the balls.
  box('Front apron upper',1.2,.085,.13,0,-.1275,side);
  box('Front apron lower',1.2,.077,.13,0,-.3215,side);
  box('Return back wall',1.2,.12,.012,0,-.225,side-.083,dark);
  box('Return shelf',1.2,.018,.19,0,RETURN_Y-BALL_R-.01,side-.008,dark);
  const glass=new THREE.MeshPhysicalMaterial({color:0xbfd9d7,transparent:true,opacity:.12,roughness:.15,metalness:0,depthWrite:false,side:THREE.DoubleSide});
  const pane=box('Clear ball-view window',1.17,.11,.004,0,-.225,side+.072,glass,.001);pane.castShadow=false;
  for(const y of [-.168,-.282])box('Window trim',1.22,.008,.012,0,y,side+.076,metal,.003);
  for(const x of [-.604,.604])box('Window trim',.008,.12,.012,x,-.225,side+.076,metal,.003);
  // Rounded skirt molding ties the four aprons together.
  for(const sign of [-1,1]) {
    box('Lower long molding',TABLE_W+.2,.025,.045,0,-.365,sign*side,metal,.009);
    box('Lower end molding',.045,.025,TABLE_H+.15,sign*end,-.365,0,metal,.009);
  }
  for(const sx of [-1,1])for(const sz of [-1,1]) {
    const x=sx*(TABLE_W/2-.20),z=sz*(TABLE_H/2-.18);
    const leg=box('Tapered cabinet leg',.21,.40,.21,x,-.54,z,wood,.035);
    const positions=leg.geometry.getAttribute('position');
    for(let i=0;i<positions.count;i++) {const taper=.76+.24*(positions.getY(i)/.40+.5);positions.setX(i,positions.getX(i)*taper);positions.setZ(i,positions.getZ(i)*taper);}
    leg.geometry.computeVertexNormals();
    box('Leg collar',.215,.035,.215,x,-.365,z,metal,.014);
    const foot=new THREE.Mesh(new THREE.CylinderGeometry(.075,.086,.035,32),dark);foot.name='Adjustable foot';foot.position.set(x,-.7575,z);foot.castShadow=foot.receiveShadow=true;cabinet.add(foot);
  }
  // Supporting beams are visible from a low orbit.
  box('Long underframe',TABLE_W-.42,.09,.09,0,-.41,0,dark);
  for(const x of [-TABLE_W/2+.20,TABLE_W/2-.20])box('Cross bearer',.12,.1,TABLE_H-.30,x,-.40,0,dark);
  return cabinet;
}
