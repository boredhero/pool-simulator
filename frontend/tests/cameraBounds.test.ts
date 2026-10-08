import { expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
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
