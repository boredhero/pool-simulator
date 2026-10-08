import * as THREE from 'three';
import { TABLE_H, TABLE_W } from '../sim/table';
import { RAIL_W } from './tableGeometry';
export const SIGHT_STYLES = ['dots','diamonds','double-diamonds','squares','none'] as const;
export type SightStyle = typeof SIGHT_STYLES[number];
export const sightStyle = (value: string | null): SightStyle => SIGHT_STYLES.includes(value as SightStyle) ? value as SightStyle : 'diamonds';

export function createRailSights() {
  const group = new THREE.Group(); group.name='Rail sights';
  const pearl = new THREE.MeshStandardMaterial({color:0xe8e4da,roughness:.65,envMapIntensity:.35});
  const ebony = new THREE.MeshStandardMaterial({color:0x241c16,roughness:.62});
  const positions:Array<[number,number,number]>=[];
  for(const i of [1,2,3,5,6,7]) for(const sign of [-1,1]) positions.push([-TABLE_W/2+TABLE_W*i/8,sign*(TABLE_H/2+RAIL_W/2),0]);
  for(const i of [1,2,3]) for(const sign of [-1,1]) positions.push([sign*(TABLE_W/2+RAIL_W/2),-TABLE_H/2+TABLE_H*i/4,Math.PI/2]);
  const rhombus = new THREE.Shape(); rhombus.moveTo(0,.0159);rhombus.lineTo(.0071,0);rhombus.lineTo(0,-.0159);rhombus.lineTo(-.0071,0);rhombus.closePath();
  const diamond = new THREE.ShapeGeometry(rhombus);
  const shapes:Record<string,THREE.BufferGeometry>={dots:new THREE.CircleGeometry(.008,24),diamonds:diamond,'double-diamonds':diamond,squares:new THREE.PlaneGeometry(.014,.014)};
  const styles = new Map<SightStyle,THREE.Group>();
  for(const style of SIGHT_STYLES.filter(s=>s!=='none')) {
    const node = new THREE.Group();node.name=style;
    const outer = new THREE.InstancedMesh(shapes[style],style==='double-diamonds'?ebony:pearl,18);
    node.add(outer);
    const inner = style==='double-diamonds' ? new THREE.InstancedMesh(diamond,pearl,18) : null;
    if(inner)node.add(inner);
    const matrix=new THREE.Matrix4(), dummy=new THREE.Object3D();
    positions.forEach(([x,z,rotation],i)=>{
      dummy.position.set(x,.054,z);dummy.rotation.set(-Math.PI/2,0,rotation);dummy.scale.setScalar(1);dummy.updateMatrix();outer.setMatrixAt(i,dummy.matrix);
      if(inner){dummy.position.y=.0541;dummy.scale.setScalar(.65);dummy.updateMatrix();matrix.copy(dummy.matrix);inner.setMatrixAt(i,matrix);}
    });
    outer.instanceMatrix.needsUpdate=true;if(inner)inner.instanceMatrix.needsUpdate=true;
    group.add(node);styles.set(style,node);
  }
  const setStyle=(style:SightStyle)=>styles.forEach((node,key)=>{node.visible=key===style;});
  setStyle('diamonds');return {group,setStyle};
}
