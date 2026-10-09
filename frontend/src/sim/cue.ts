import { BALL_R, TABLE_H, TABLE_W, POCKETS, cushions, jaws } from './table';

export const CUE_LENGTH = 1.45;
// Conservative envelope of the rendered tapered shaft (including decorative
// rings), plus 0.5 mm clearance. The butt radius must not be used at the tip.
const TIP_RADIUS = .0065, TAPER = .006;
const CUSHION_W = .035, RAIL_W = .17;
type Box = {left:number;right:number;top:number;bottom:number;height:number;wood?:boolean};

/** Bound the rendered sloping cloth and rounded jaw ends in 16 narrow strips.
 * Each strip encloses the surface; its maximum height error is 0.82 mm.
 */
function cushionBoxes():Box[] {
  const boxes:Box[]=[],ends=jaws();
  for(const c of cushions()) {
    const alongX=c.y1===c.y2;
    const nx=alongX?0:c.x1===0?-1:1,ny=alongX?(c.y1===0?-1:1):0;
    const tx=-ny,ty=nx,forward=tx+ty>0;
    const sx=forward?c.x1:c.x2,sy=forward?c.y1:c.y2;
    const ex=forward?c.x2:c.x1,ey=forward?c.y2:c.y1,length=Math.hypot(ex-sx,ey-sy);
    const nearest=(x:number,y:number)=>ends.reduce((a,b)=>Math.hypot(a.x-x,a.y-y)<Math.hypot(b.x-x,b.y-y)?a:b);
    const first=nearest(sx,sy),last=nearest(ex,ey);
    for(let i=0;i<16;i++) {
      const lo=CUSHION_W*i/16,hi=CUSHION_W*(i+1)/16;
      const bound=(jaw:typeof first,end:boolean)=>{
        const across=(jaw.x-sx)*nx+(jaw.y-sy)*ny,along=(jaw.x-sx)*tx+(jaw.y-sy)*ty;
        const d=jaw.r**2-(Math.max(lo,Math.min(hi,across))-across)**2;
        return d<=0?(end?length:0):end?Math.max(length,along+Math.sqrt(d)):Math.min(0,along-Math.sqrt(d));
      };
      const a=bound(first,false),b=bound(last,true);
      const xs=[sx+nx*lo+tx*a,sx+nx*hi+tx*b],ys=[sy+ny*lo+ty*a,sy+ny*hi+ty*b];
      boxes.push({left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys),height:.036+.013*hi/CUSHION_W});
    }
  }
  return boxes;
}
const BOXES:Box[]=[...cushionBoxes(),
  {left:-RAIL_W,right:-CUSHION_W,top:-RAIL_W,bottom:TABLE_H+RAIL_W,height:.054,wood:true},
  {left:TABLE_W+CUSHION_W,right:TABLE_W+RAIL_W,top:-RAIL_W,bottom:TABLE_H+RAIL_W,height:.054,wood:true},
  {left:-CUSHION_W,right:TABLE_W+CUSHION_W,top:-RAIL_W,bottom:-CUSHION_W,height:.054,wood:true},
  {left:-CUSHION_W,right:TABLE_W+CUSHION_W,top:TABLE_H+CUSHION_W,bottom:TABLE_H+RAIL_W,height:.054,wood:true},
];

// Intersect linear inequalities a + b*s >= 0 over the finite shaft. Expanding
// each plane by its local tapered radius bounds the cylinder without sampling
// along the shaft, so thin jaw/facing obstacles cannot fall between samples.
function interval(planes:number[][],length:number):[number,number]|null {
  let lo=0,hi=length;
  for(const [a,b] of planes) {
    if(Math.abs(b)<1e-12){if(a<0)return null;}
    else if(b>0)lo=Math.max(lo,-a/b);else hi=Math.min(hi,-a/b);
    if(lo>hi)return null;
  }
  return [lo,hi];
}
function boxInterval(box:Box,x:number,y:number,z:number,dx:number,dy:number,dz:number,r:number,k:number,length:number){
  return interval([[x-box.left+r,dx+k],[box.right-x+r,-dx+k],[y-box.top+r,dy+k],[box.bottom-y+r,-dy+k],[box.height-z+r,-dz+k]],length);
}
// Exact point-to-box distance along a tapered sphere sweep. Plane expansion
// is only broad phase: its square corners otherwise invent jaw collisions.
function hitsBox(box:Box,x:number,y:number,z:number,dx:number,dy:number,dz:number,length:number):boolean {
  const cuts=[0,length];
  for(const [origin,direction,edge] of [[x,dx,box.left],[x,dx,box.right],[y,dy,box.top],[y,dy,box.bottom],[z,dz,box.height]]) {
    if(Math.abs(direction)>1e-12){const s=(edge-origin)/direction;if(s>0&&s<length)cuts.push(s);}
  }
  cuts.sort((a,b)=>a-b);
  for(let i=1;i<cuts.length;i++) {
    const lo=cuts[i-1],hi=cuts[i],mid=(lo+hi)/2;
    let a=-TAPER*TAPER,b=-2*TIP_RADIUS*TAPER,c=-TIP_RADIUS*TIP_RADIUS;
    for(const [origin,direction,left,right] of [[x,dx,box.left,box.right],[y,dy,box.top,box.bottom],[z,dz,-Infinity,box.height]]) {
      const v=origin+direction*mid,edge=v<left?left:v>right?right:null;
      if(edge===null)continue;
      const d=origin-edge;a+=direction*direction;b+=2*d*direction;c+=d*d;
    }
    const q=(s:number)=>a*s*s+b*s+c;
    const at=a>0?Math.max(lo,Math.min(hi,-b/(2*a))):lo;
    if(Math.min(q(lo),q(hi),q(at))<0)return true;
  }
  return false;
}
/** Automatic elevation about the ball, shared with the authoritative server.
 * Find the lowest clear pose of the finite, tapered shaft, with actual pocket
 * openings, sloped cushions and spherical object balls. Never clamp a collision
 * to an aesthetically preferred angle.
 */
export function cueElevation(x:number,y:number,angle:number,pull:number,
  balls:ReadonlyArray<{x:number;y:number;n:number|null;potted:boolean}>,tipX=0,tipY=0):number {
  const dx=-Math.cos(angle),dy=-Math.sin(angle);
  const scale=Math.min(1,.55/(Math.hypot(tipX,tipY)||1)),tx=tipX*scale,ty=tipY*scale;
  x-=Math.sin(angle)*BALL_R*tx;y+=Math.cos(angle)*BALL_R*tx;
  // Enclose the entire pull-back/strike sweep, not only the retracted tip.
  const contact=Math.sqrt(1-tx*tx-ty*ty),length=CUE_LENGTH+Math.max(0,pull);
  // Broad phase encloses every possible inclined shaft and spin offset.
  const active=BOXES.filter(b=>boxInterval(b,x-dx*.02,y-dy*.02,0,dx,dy,0,.04,0,length+BALL_R+pull+.04));
  const objects=balls.filter(b=>!b.potted&&b.n!==null&&Math.hypot(b.x-x,b.y-y)<length+BALL_R*3+pull);
  const collides=(e:number)=>{
    const ct=Math.cos(e),st=Math.sin(e),along=BALL_R*(contact*ct-ty*st);
    const ox=x+dx*along,oy=y+dy*along,oz=BALL_R+BALL_R*(ty*ct+contact*st);
    const vx=dx*ct,vy=dy*ct;
    for(const box of active) {
      const hit=boxInterval(box,ox,oy,oz,vx,vy,st,TIP_RADIUS,TAPER,length);
      if(!hit)continue;
      if(!box.wood){if(hitsBox(box,ox,oy,oz,vx,vy,st,length))return true;continue;}
      // Pocket cutouts include the leather facing's inner radius. Remove only
      // intervals whose entire shaft cross-section fits inside an opening.
      let remaining:[number,number][]=[hit];
      for(const p of POCKETS) {
        const px=ox-p.x,py=oy-p.y,r=p.r+.007-TIP_RADIUS;
        const a=vx*vx+vy*vy-TAPER*TAPER,b=2*(px*vx+py*vy+r*TAPER),c=px*px+py*py-r*r;
        const disc=b*b-4*a*c;
        let holes:[number,number][]=[];
        if(Math.abs(a)<1e-12){
          if(Math.abs(b)<1e-12){if(c<=0)holes=[[-Infinity,Infinity]];}
          else holes=b>0?[[-Infinity,-c/b]]:[[-c/b,Infinity]];
        }else if(disc<=0){if(a<0)holes=[[-Infinity,Infinity]];}
        else {
          const roots=[(-b-Math.sqrt(disc))/(2*a),(-b+Math.sqrt(disc))/(2*a)].sort((u,v)=>u-v);
          holes=a>0?[[roots[0],roots[1]]]:[[-Infinity,roots[0]],[roots[1],Infinity]];
        }
        for(const [from,to] of holes)remaining=remaining.flatMap(([l,h])=>to<=l||from>=h?[[l,h]]:[...(from>l?[[l,from] as [number,number]]:[]),...(to<h?[[to,h] as [number,number]]:[])]);
        if(!remaining.length)break;
      }
      if(remaining.length)return true;
    }
    for(const b of objects) {
      const bx=ox-b.x,by=oy-b.y,bz=oz-BALL_R,r=BALL_R+TIP_RADIUS;
      // Minimum of squared axis distance minus squared local combined radius.
      const a=1-TAPER*TAPER,q=bx*vx+by*vy+bz*st-r*TAPER;
      const s=Math.max(0,Math.min(length,-q/a));
      if(a*s*s+2*q*s+bx*bx+by*by+bz*bz-r*r<0)return true;
    }
    return false;
  };
  let low=3*Math.PI/180;if(!collides(low))return low;
  // Tip retraction around a jaw can create more than one clear angular
  // interval. Bracket the first clear pose instead of assuming global
  // monotonicity and jumping straight to a nearly vertical second interval.
  const step=Math.PI/720;
  let high=low;
  do {low=high;high=Math.min(Math.PI/2,high+step);}while(high<Math.PI/2&&collides(high));
  for(let i=0;i<14;i++){const mid=(low+high)/2;if(collides(mid))low=mid;else high=mid;}
  return high;
}
