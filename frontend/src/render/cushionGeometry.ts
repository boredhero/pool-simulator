import { BufferGeometry, Float32BufferAttribute } from 'three';
import { jaws, TABLE_H, TABLE_W, type Cushion } from '../sim/table';
import { CUSHION_W } from './tableGeometry';

/** One closed cloth mesh per cushion, including the rounded collision jaws. */
export function cushionGeometry(c: Cushion): BufferGeometry {
  const alongX=c.y1===c.y2;
  const nx=alongX?0:c.x1===0?-1:1, nz=alongX?(c.y1===0?-1:1):0;
  const tx=-nz,tz=nx,forward=tx+tz>0;
  const sx=forward?c.x1:c.x2,sz=forward?c.y1:c.y2;
  const ex=forward?c.x2:c.x1,ez=forward?c.y2:c.y1;
  const length=Math.hypot(ex-sx,ez-sz);
  const closest=(x:number,z:number)=>jaws().reduce((a,b)=>Math.hypot(a.x-x,a.y-z)<Math.hypot(b.x-x,b.y-z)?a:b);
  const first=closest(sx,sz),last=closest(ex,ez);
  const endAt=(u:number,jaw:typeof first,end:boolean)=>{
    const across=(jaw.x-sx)*nx+(jaw.y-sz)*nz;
    const along=(jaw.x-sx)*tx+(jaw.y-sz)*tz;
    const d=jaw.r*jaw.r-(u-across)**2;
    if(d<=0)return end?length:0;
    return end?Math.max(length,along+Math.sqrt(d)):Math.min(0,along-Math.sqrt(d));
  };
  const positions:number[]=[],uv:number[]=[],indices:number[]=[];
  const vertex=(u:number,h:number,v:number)=>{
    positions.push(sx+nx*u+tx*v-TABLE_W/2,h,sz+nz*u+tz*v-TABLE_H/2);
    uv.push(alongX?v:u+h,alongX?u+h:v);
  };
  const top=(u:number)=>.036+.013*u/CUSHION_W;
  const bottom=(u:number)=>.018-.014*u/CUSHION_W;
  // Separate strips preserve the cloth folds; shared vertices within each
  // strip give the rounded end a continuous normal without intersecting caps.
  const strip=(points:(u:number)=>number[][],reverse=false)=>{
    const base=positions.length/3,segments=64;
    for(let i=0;i<=segments;i++)for(const p of points(CUSHION_W*i/segments))vertex(p[0],p[1],p[2]);
    for(let i=0;i<segments;i++) {
      const a=base+2*i,b=a+1,c=a+2,d=a+3;
      indices.push(...(reverse?[a,c,b,b,c,d]:[a,b,c,b,d,c]));
    }
  };
  strip(u=>[[u,top(u),endAt(u,first,false)],[u,top(u),endAt(u,last,true)]]);
  strip(u=>[[u,bottom(u),endAt(u,first,false)],[u,bottom(u),endAt(u,last,true)]],true);
  strip(u=>[[u,bottom(u),endAt(u,first,false)],[u,top(u),endAt(u,first,false)]]);
  strip(u=>[[u,bottom(u),endAt(u,last,true)],[u,top(u),endAt(u,last,true)]],true);
  for(const u of [0,CUSHION_W]) {
    const base=positions.length/3,a=endAt(u,first,false),b=endAt(u,last,true);
    vertex(u,bottom(u),a);vertex(u,top(u),a);vertex(u,bottom(u),b);vertex(u,top(u),b);
    indices.push(...(u===0?[base,base+2,base+1,base+1,base+2,base+3]:[base,base+1,base+2,base+1,base+3,base+2]));
  }
  const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(positions,3));geo.setAttribute('uv',new Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();return geo;
}
