import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {TABLE_H, TABLE_W} from '../sim/table';

export const CHALK_SIZE = .023;
export const CHALK_PICK_RADIUS = .06;
const RAIL_TOP = .052;
export const CHALK_POSITIONS = [
  new THREE.Vector3(-TABLE_W / 2 + .22, RAIL_TOP, -TABLE_H / 2 - .10),
  new THREE.Vector3(TABLE_W / 2 - .22, RAIL_TOP, TABLE_H / 2 + .10),
];

/** Square chalk with softened edges and a genuinely recessed applicator face. */
export function chalkGeometry(): THREE.BufferGeometry {
  const positions:number[] = [], colors:number[] = [], indices:number[] = [];
  const segments = 64, rings = 16, half = CHALK_SIZE / 2;
  const blue = new THREE.Color(0x418ed4);
  const vertex = (x:number, y:number, z:number) => {
    positions.push(x,y,z);
    const grain = .94 + .06 * Math.sin(positions.length * 78.233);
    colors.push(blue.r * grain, blue.g * grain, blue.b * grain);
  };
  // Rings move from the dished center to the square perimeter. The bevel
  // is a separate outer ring so the paper does not hide the exposed lip.
  for(let ring=0;ring<=rings;ring++) {
    for(let i=0;i<segments;i++) {
      const angle=i/segments*Math.PI*2, c=Math.cos(angle), s=Math.sin(angle);
      const radius=(half-.0008)*ring/rings/Math.max(Math.abs(c),Math.abs(s));
      const depression=.004*Math.max(0,1-(radius/.0075)**2)**2;
      vertex(radius*c,CHALK_SIZE-depression,radius*s);
    }
  }
  for(const [width,height] of [[half,CHALK_SIZE-.0008],[half,.001],[half-.0008,0]]) {
    for(let i=0;i<segments;i++) {
      const angle=i/segments*Math.PI*2, c=Math.cos(angle), s=Math.sin(angle);
      const radius=width/Math.max(Math.abs(c),Math.abs(s));
      vertex(radius*c,height,radius*s);
    }
  }
  const count=positions.length/3/segments;
  for(let ring=0;ring<count-1;ring++) for(let i=0;i<segments;i++) {
    const a=ring*segments+i, b=ring*segments+(i+1)%segments;
    const c=a+segments, d=b+segments;
    indices.push(a,b,c,b,d,c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
}

export function createChalks() {
  const group = new THREE.Group();group.name='Billiard chalk';group.visible=false;
  const powder = new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,envMapIntensity:.08});
  const paper = new THREE.MeshStandardMaterial({color:0x912e22,roughness:.94});
  const ink = new THREE.MeshStandardMaterial({color:0xefe0ad,roughness:.95});
  const coreGeometry=chalkGeometry();
  const wrapperGeometry=new RoundedBoxGeometry(CHALK_SIZE+.00025,.017,CHALK_SIZE+.00025,2,.0005);
  const lineGeometry=new THREE.PlaneGeometry(.020,.0006);
  const markGeometry=new THREE.PlaneGeometry(.0045,.0045);
  CHALK_POSITIONS.forEach((position,index)=>{
    const cube=new THREE.Group();cube.name=`Rail chalk ${index+1}`;cube.position.copy(position);
    cube.rotation.y=index===0?.12:-.18;
    const core=new THREE.Mesh(coreGeometry,powder);core.castShadow=core.receiveShadow=true;cube.add(core);
    const sleeve=new THREE.Mesh(wrapperGeometry,paper);sleeve.position.y=.0086;
    sleeve.castShadow=sleeve.receiveShadow=true;cube.add(sleeve);
    for(let side=0;side<4;side++) {
      const label=new THREE.Group();label.rotation.y=side*Math.PI/2;
      for(const y of [.003,.014]) {
        const stripe=new THREE.Mesh(lineGeometry,ink);stripe.position.set(0,y,CHALK_SIZE/2+.00015);label.add(stripe);
      }
      const mark=new THREE.Mesh(markGeometry,ink);mark.position.set(0,.0085,CHALK_SIZE/2+.00015);mark.rotation.z=Math.PI/4;label.add(mark);
      cube.add(label);
    }
    group.add(cube);
  });
  const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();
  const hit=new THREE.Vector3();
  const targets=CHALK_POSITIONS.map(position=>new THREE.Sphere(position.clone().add(new THREE.Vector3(0,CHALK_SIZE/2,0)),CHALK_PICK_RADIUS));
  let previousLevel:number|undefined, previousSeat:number|undefined, pulseUntil=0;
  return {
    group,
    set(enabled:boolean,levels?:readonly number[],activeSeat=0) {
      const level=levels?.[activeSeat];
      if(enabled && group.visible && previousSeat===activeSeat && level!==undefined && previousLevel!==undefined && level>previousLevel+.05) pulseUntil=performance.now()+450;
      group.visible=enabled;previousLevel=level;previousSeat=activeSeat;
      if(!enabled)pulseUntil=0;
    },
    update(now:number) {
      const pulse=Math.max(0,(pulseUntil-now)/450);
      powder.emissive.setHex(0x438acc);powder.emissiveIntensity=pulse*.6;
      paper.emissive.setHex(0xb06b32);paper.emissiveIntensity=pulse*.4;
    },
    pick(camera:THREE.PerspectiveCamera,rect:{left:number;top:number;width:number;height:number},x:number,y:number):boolean {
      if(!group.visible || rect.width<=0 || rect.height<=0 || x<rect.left || y<rect.top || x>rect.left+rect.width || y>rect.top+rect.height)return false;
      camera.updateMatrixWorld();
      pointer.set((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2);
      raycaster.setFromCamera(pointer,camera);
      return targets.some(target=>raycaster.ray.intersectSphere(target,hit)!==null);
    },
  };
}
