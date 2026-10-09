import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import cases from '../../contracts/cue-clearance.json';
import { cueElevation, CUE_LENGTH } from '../src/sim/cue';
import { BALL_R, TABLE_H, TABLE_W, cushions } from '../src/sim/table';
import { cushionGeometry } from '../src/render/cushionGeometry';

it.each(cases)('$name uses the shared minimal-clearance contract',c=>{
  const balls=c.balls.map(b=>({...b,potted:!!('potted' in b&&b.potted)}));
  const elevation=cueElevation(c.x,c.y,c.aim,c.pull,balls,c.tipX,c.tipY);
  expect(elevation).toBeCloseTo(c.elevation,10);
  expect(elevation*180/Math.PI).toBeGreaterThanOrEqual(c.minDegrees-1e-9);
  expect(elevation*180/Math.PI).toBeLessThan(c.maxDegrees);
});

// This oracle uses the actual rendered cloth meshes, not the clearance solver's
// strip boxes. Vertices and triangle centers cover noses, sloping tops and jaws.
const surface:Vector3[]=[];
for(const c of cushions()) {
  const geometry=cushionGeometry(c),positions=geometry.getAttribute('position'),indices=geometry.getIndex()!;
  for(let i=0;i<positions.count;i++)surface.push(new Vector3().fromBufferAttribute(positions,i));
  for(let i=0;i<indices.count;i+=3) {
    const center=new Vector3();
    for(let j=0;j<3;j++)center.add(new Vector3().fromBufferAttribute(positions,indices.getX(i+j)));
    surface.push(center.multiplyScalar(1/3));
  }
  geometry.dispose();
}
function shaft(c:{x:number;y:number;aim:number;tipX:number;tipY:number},e:number){
  const dx=-Math.cos(c.aim),dy=-Math.sin(c.aim),ct=Math.cos(e),st=Math.sin(e);
  const contact=Math.sqrt(1-c.tipX*c.tipX-c.tipY*c.tipY),along=BALL_R*(contact*ct-c.tipY*st);
  const tip=new Vector3(c.x-Math.sin(c.aim)*BALL_R*c.tipX+dx*along-TABLE_W/2,
    BALL_R+BALL_R*(c.tipY*ct+contact*st),c.y+Math.cos(c.aim)*BALL_R*c.tipX+dy*along-TABLE_H/2);
  return {tip,axis:new Vector3(dx*ct,st,dy*ct)};
}
it('the full tapered shaft clears the actual rendered cloth and spherical balls',()=>{
  for(const c of cases) {
    const {tip,axis}=shaft(c,c.elevation),length=CUE_LENGTH+c.pull;
    for(const point of surface) {
      const offset=point.clone().sub(tip),s=Math.max(0,Math.min(length,offset.dot(axis)));
      // The envelope includes 0.5 mm safety. Allow float32 mesh rounding only.
      const gap=offset.addScaledVector(axis,-s).length()-(.006+.006*s);
      expect(gap,`${c.name}: shaft intersects rendered cloth`).toBeGreaterThan(-1e-6);
    }
    for(const b of c.balls) {
      if('potted' in b&&b.potted)continue;
      const offset=new Vector3(b.x-TABLE_W/2,BALL_R,b.y-TABLE_H/2).sub(tip);
      // Dense independent samples validate the spherical obstruction, including
      // the part swept by pulling back then striking, not an inflated box.
      for(let s=0;s<=length;s+=.001)expect(offset.clone().addScaledVector(axis,-s).length()-BALL_R-(.006+.006*s)).toBeGreaterThan(-1e-6);
    }
  }
});
it('does not lift several degrees higher than the rendered rail actually requires',()=>{
  for(const c of cases.filter(c=>c.name.endsWith(' cushion'))) {
    const {tip,axis}=shaft(c,c.elevation-5*Math.PI/180);
    // Exact nose point at the shot's rail crossing: long mesh triangles have
    // no vertex here, so vertex-only checks would miss this obstruction.
    const along=c.x===BALL_R||c.x===TABLE_W-BALL_R;
    const nose=new Vector3(along?(c.x<TABLE_W/2?0:TABLE_W):c.x,.036,
      along?c.y:c.y<TABLE_H/2?0:TABLE_H);
    nose.x-=TABLE_W/2;nose.z-=TABLE_H/2;
    const offset=nose.sub(tip),s=Math.max(0,Math.min(CUE_LENGTH,offset.dot(axis)));
    const collides=offset.addScaledVector(axis,-s).length()<.006+.006*s;
    expect(collides,`${c.name}: excess elevation`).toBe(true);
  }
});
it('supports full rotations without steep rail or pocket-facing blind spots',()=>{
  for(const [x,y] of [[BALL_R,.635],[1.33,BALL_R],[.03,.03]]) {
    let last=cueElevation(x,y,0,0,[]);
    for(let i=1;i<=1440;i++) {
      const angle=i*Math.PI/720,next=cueElevation(x,y,angle,0,[]);
      // A jaw may require switching between disjoint clear tip poses.
      // Straight rails and open corners should vary smoothly; the jaw must
      // still never force the old near-vertical blind spot.
      if(x!==1.33)expect(Math.abs(next-last)*180/Math.PI).toBeLessThan(2);
      expect(next*180/Math.PI).toBeLessThan(40);
      last=next;
    }
    expect(last).toBeCloseTo(cueElevation(x,y,0,0,[]),10);
  }
});
it('side spin is symmetric around a corner and draw raises the cue only as needed',()=>{
  const a=cueElevation(.08,.08,Math.PI/4,0,[],.4,-.3);
  expect(a).toBeCloseTo(cueElevation(.08,.08,Math.PI/4,0,[],-.4,-.3),12);
  expect(cueElevation(BALL_R,.635,0,0,[],0,-.55)).toBeGreaterThan(cueElevation(BALL_R,.635,0,0,[]));
});

it('keeps the same touching-cluster elevation throughout the rendered pullback and strike',()=>{
  const c=cases.find(c=>c.name==='dense touching cluster full stroke')!;
  const balls=c.balls.map(b=>({...b,potted:false}));
  const e=cueElevation(c.x,c.y,c.aim,0,balls),{tip,axis}=shaft(c,e);
  expect(cueElevation(c.x,c.y,c.aim,.2,balls)).toBeCloseTo(e,10);
  for(const pull of [0,.012,.07,.12,.192,.2]) {
    const renderedTip=tip.clone().addScaledVector(axis,pull);
    for(const ball of balls) {
      const center=new Vector3(ball.x-TABLE_W/2,BALL_R,ball.y-TABLE_H/2);
      for(let s=0;s<=CUE_LENGTH;s+=.002) {
        const clearance=center.distanceTo(renderedTip.clone().addScaledVector(axis,s))-BALL_R-(.006+.006*s);
        expect(clearance,`pull ${pull}, shaft ${s}`).toBeGreaterThan(-1e-6);
      }
    }
  }
});
