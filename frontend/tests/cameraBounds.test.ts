import { expect, it } from 'vitest';
import { PerspectiveCamera, Spherical, Vector3 } from 'three';
import { constrainTableCamera } from '../src/render/cameraBounds';

it('keeps every near-plane corner above the rails at close zoom and low orbit',()=>{
  for(const aspect of [.45,1.8,4]) for(const distance of [.6,1,4]) for(const targetY of [-.16,0]) {
    const camera=new PerspectiveCamera(50,aspect,.05,50);
    const controls={target:new Vector3(0,targetY,0),maxPolarAngle:Math.PI*.49};
    camera.position.set(distance*.6,targetY,distance*.8);
    constrainTableCamera(camera,controls);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(distance,10);
    for(const x of [-1,1])for(const y of [-1,1]) {
      const corner=new Vector3(x,y,-1).unproject(camera);
      expect(corner.y).toBeGreaterThan(.058);
    }
    const position=camera.position.clone();constrainTableCamera(camera,controls);
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-10);
  }
});
it('leaves a normal overhead view unchanged and relaxes the angle when zoomed out',()=>{
  const camera=new PerspectiveCamera(50,1.8,.05,50);
  const controls={target:new Vector3(0,-.16,0),maxPolarAngle:Math.PI*.49};
  camera.position.set(-2.4,1.9,2.8);const original=camera.position.clone();
  constrainTableCamera(camera,controls);expect(camera.position.equals(original)).toBe(true);
  const farLimit=controls.maxPolarAngle;
  camera.position.copy(controls.target).add(new Vector3(.6,0,0));
  constrainTableCamera(camera,controls);expect(controls.maxPolarAngle).toBeLessThan(farLimit);
});

import { framePose } from '../src/render/cameraRig';
import { TABLE_W, TABLE_H, BALL_R } from '../src/sim/table';
it('frames all remaining balls within HUD space while preserving viewing direction',()=>{
  for(const aspect of [.5,1.8]) {
    const camera=new PerspectiveCamera(50,aspect,.05,50),target=new Vector3();camera.position.set(-2,3,2);
    const safe={left:-.75,right:.9,top:.5,bottom:-.55};
    const points=[{x:.2,y:.2},{x:TABLE_W-.2,y:TABLE_H-.2}];
    const pose=framePose(camera,target,points,safe);
    expect(Math.atan2(pose.position.x-pose.target.x,pose.position.z-pose.target.z)).toBeCloseTo(-Math.PI/4);
    camera.position.copy(pose.position);camera.lookAt(pose.target);camera.updateMatrixWorld();
    for(const point of points){const p=new Vector3(point.x-TABLE_W/2,BALL_R,point.y-TABLE_H/2).project(camera);expect(p.x).toBeGreaterThan(safe.left);expect(p.x).toBeLessThan(safe.right);expect(p.y).toBeGreaterThan(safe.bottom);expect(p.y).toBeLessThan(safe.top);}
    const clustered=framePose(camera,pose.target,[{x:.3,y:.3},{x:.4,y:.4}],safe);
    expect(clustered.position.distanceTo(clustered.target)).toBeLessThan(pose.position.distanceTo(pose.target));
  }
});

import { majorityFacing, angleDelta } from '../src/render/cameraRig';
it('faces the angular majority, ignores a lone opposite target, and handles wraparound',()=>{
  const cue={x:0,y:0};
  const theta=majorityFacing(cue,[{x:1,y:-.1},{x:1,y:0},{x:1,y:.1},{x:-2,y:0}],0);
  expect(Math.abs(angleDelta(theta,-Math.PI/2))).toBeLessThan(.11);
  const wrap=majorityFacing(cue,[{x:.01,y:-1},{x:-.01,y:-1},{x:0,y:1}],Math.PI);
  expect(Math.abs(angleDelta(wrap,0))).toBeLessThan(.02);
  expect(majorityFacing(cue,[],1)).toBe(1);
  expect(angleDelta(Math.PI-.01,-Math.PI+.01)).toBeCloseTo(.02);
  expect(Math.abs(angleDelta(majorityFacing(cue,[{x:0,y:1}],0),Math.PI))).toBeLessThan(1e-8);
});
it('frames eligible balls behind the cue with the cue centered in usable screen space',()=>{
  const camera=new PerspectiveCamera(50,.6,.05,50);camera.position.set(-2,3,2);
  const cue={x:.3,y:.5},targets=[{x:2,y:.4},{x:2.1,y:.6},{x:1.8,y:.7}];
  const theta=majorityFacing(cue,targets,0),safe={left:-.8,right:.8,top:.55,bottom:-.55};
  const pose=framePose(camera,new Vector3(),[cue,...targets],safe,{cue,theta});
  const ahead=(pose.position.x-(cue.x-TABLE_W/2))*(-Math.sin(theta))+(pose.position.z-(cue.y-TABLE_H/2))*(-Math.cos(theta));
  expect(ahead).toBeLessThan(0);
  camera.position.copy(pose.position);camera.lookAt(pose.target);camera.updateMatrixWorld();
  for(const p of [cue,...targets]){const screen=new Vector3(p.x-TABLE_W/2,BALL_R,p.y-TABLE_H/2).project(camera);expect(screen.x).toBeGreaterThan(safe.left);expect(screen.x).toBeLessThan(safe.right);expect(screen.y).toBeGreaterThan(safe.bottom);expect(screen.y).toBeLessThan(safe.top);}
  expect(new Vector3(cue.x-TABLE_W/2,BALL_R,cue.y-TABLE_H/2).project(camera).x).toBeCloseTo(0);
});

it('preserves shot inclination after tight zoom toward a HUD-shifted rail or corner target',()=>{
  for(const aspect of [390/844,844/390])for(const [x,z]of [[-1.24,0],[-1.24,-.6],[1.24,.6]]) {
    const camera=new PerspectiveCamera(50,aspect,.05,50);
    const controls={target:new Vector3(x,-.45,z),maxPolarAngle:Math.PI*.49,minDistance:.6};
    camera.position.copy(controls.target).add(new Vector3().setFromSpherical(new Spherical(.6,1.12,.8)));
    constrainTableCamera(camera,controls,true);
    const orbit=new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    expect(orbit.phi).toBeCloseTo(1.12,10);
    expect(orbit.theta).toBeCloseTo(.8,10);
    expect(orbit.radius).toBeGreaterThan(1);
    expect(controls.minDistance).toBeCloseTo(orbit.radius,10);
    for(const x of [-1,1])for(const y of [-1,1])expect(new Vector3(x,y,-1).unproject(camera).y).toBeGreaterThan(.058);
  }
});

it('keeps shallow mobile panning within the controls zoom range without changing pitch',()=>{
  const camera=new PerspectiveCamera(50,844/390,.05,50);
  const controls={target:new Vector3(1,-.4,-.6),maxPolarAngle:Math.PI*.49,minDistance:.6,maxDistance:8};
  camera.position.copy(controls.target).add(new Vector3().setFromSpherical(new Spherical(.6,Math.PI*.49,.8)));
  constrainTableCamera(camera,controls,true);
  expect(controls.minDistance).toBeLessThanOrEqual(controls.maxDistance);
  expect(camera.position.distanceTo(controls.target)).toBeCloseTo(8,8);
  expect(new Spherical().setFromVector3(camera.position.clone().sub(controls.target)).phi).toBeCloseTo(Math.PI*.49,8);
  for(const x of [-1,1])for(const y of [-1,1])expect(new Vector3(x,y,-1).unproject(camera).y).toBeGreaterThan(.058);
  const position=camera.position.clone(),target=controls.target.clone();
  constrainTableCamera(camera,controls,true);
  expect(camera.position.distanceTo(position)).toBeLessThan(1e-10);
  expect(controls.target.distanceTo(target)).toBeLessThan(1e-10);
});
