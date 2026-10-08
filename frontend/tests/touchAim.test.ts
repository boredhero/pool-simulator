import {expect,it} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import {touchAimAngle} from '../src/render/touchAim';
it.each([1,-1])('maps full circles including the foreground in direction %s',direction=>{
  const camera=new PerspectiveCamera(50,390/844,.05,50);camera.position.set(0,.5,1.4);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const cue={x:1.27,y:.635},rect={left:0,top:0,width:390,height:844};
  const projected=new Vector3(0,.028575,0).project(camera),cx=(projected.x+1)*195,cy=(1-projected.y)*422;
  let total=0,previous=touchAimAngle(camera,rect,cue,cx+70,cy)!;
  for(let i=1;i<=144;i++){
    const t=direction*i*Math.PI/36,angle=touchAimAngle(camera,rect,cue,cx+70*Math.cos(t),cy+70*Math.sin(t))!;
    expect(Number.isFinite(angle)).toBe(true);
    const delta=Math.atan2(Math.sin(angle-previous),Math.cos(angle-previous));
    expect(Math.abs(delta)).toBeLessThan(.4);total+=delta;previous=angle;
  }
  expect(Math.abs(total)).toBeCloseTo(4*Math.PI,6);
});
