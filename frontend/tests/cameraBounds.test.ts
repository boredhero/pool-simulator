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
