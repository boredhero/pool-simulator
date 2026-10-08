import * as THREE from 'three';
import { CUE_LENGTH } from '../sim/cue';

/** Original procedural cue: local origin is the striking face, +Z toward butt. */
export function createCue(): THREE.Group {
  const cue = new THREE.Group(); cue.name = 'Maple and walnut playing cue';
  const texture = (wrap: boolean) => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = wrap ? '#282522' : '#ead3a1'; ctx.fillRect(0,0,128,512);
    for (let i=0;i<128;i++) {
      ctx.strokeStyle = wrap ? (i % 2 ? '#817768' : '#39332c') : `rgba(116,78,32,${.04 + (i % 5)*.012})`;
      ctx.lineWidth = wrap ? 1 : .7;
      ctx.beginPath();
      if (wrap) { ctx.moveTo(0,i*4);ctx.lineTo(128,i*4+10); }
      else { ctx.moveTo(i,0);ctx.bezierCurveTo(i+4,180,i-3,340,i,512); }
      ctx.stroke();
    }
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping; return map;
  };
  const maple = new THREE.MeshStandardMaterial({map:texture(false),roughness:.56});
  const walnut = new THREE.MeshStandardMaterial({map:maple.map,color:0x784329,roughness:.42});
  const linen = new THREE.MeshStandardMaterial({map:texture(true),roughness:.95});
  const ivory = new THREE.MeshStandardMaterial({color:0xe8dfc6,roughness:.52});
  const dark = new THREE.MeshStandardMaterial({color:0x211b18,roughness:.66});
  const metal = new THREE.MeshStandardMaterial({color:0xa7997c,metalness:.55,roughness:.42});
  const chalk = new THREE.MeshStandardMaterial({color:0x577f99,roughness:.95});
  const segment = (name: string, from: number, to: number, front: number, back: number, mat: THREE.Material) => {
    // Rotating +90° maps cylinder +Y toward the butt, so top radius is the back.
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(back,front,to-from,32),mat);
    mesh.name=name; mesh.rotation.x=Math.PI/2; mesh.position.z=(from+to)/2;
    mesh.castShadow=true; mesh.receiveShadow=true; cue.add(mesh); return mesh;
  };
  segment('Chalked leather tip',0,.005,.006,.006, chalk);
  segment('Ferrule',.005,.029,.006,.0062,ivory);
  segment('Tapered maple shaft',.029,.745,.0062,.0103,maple);
  segment('Joint collar',.745,.778,.0103,.0107,dark);
  segment('Brushed joint ring',.758,.764,.0106,.0107,metal);
  segment('Walnut forearm',.778,.992,.0107,.0123,walnut);
  segment('Linen grip',.992,1.276,.0123,.014,linen);
  segment('Walnut butt sleeve',1.276,CUE_LENGTH-.019,.014,.0145,walnut);
  segment('Rubber bumper',CUE_LENGTH-.019,CUE_LENGTH,.0145,.013,dark);
  for (const [z,radius] of [[.783,.01085],[.979,.0123],[.985,.01235],[1.283,.0142],[CUE_LENGTH-.035,.0146],[CUE_LENGTH-.028,.0146]]) {
    segment('Pearl decorative ring',z,z+.002,radius,radius,ivory);
  }
  // Four flush ivory points follow the tapered forearm rather than floating off it.
  for(let side=0;side<4;side++) {
    const angle=side*Math.PI/2;
    const pos:number[]=[],indices:number[]=[];
    const rows=24,columns=6;
    for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++) {
      const t=row/rows,z=.80+t*.174,azimuth=angle+(column/columns*2-1)*.19*t;
      const radius=.0107+(z-.778)/(.992-.778)*.0016+.00013;
      pos.push(Math.cos(azimuth)*radius,Math.sin(azimuth)*radius,z);
      if(row<rows && column<columns){const i=row*(columns+1)+column;indices.push(i,i+1,i+columns+1,i+1,i+columns+2,i+columns+1);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setIndex(indices);geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0xd9c799,roughness:.55,side:THREE.DoubleSide}));
    mesh.name='Inlaid forearm point';cue.add(mesh);
  }
  return cue;
}
