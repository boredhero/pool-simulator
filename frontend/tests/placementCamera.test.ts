import {expect,it} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import {placementLane} from '../src/ui/placementCamera';
import {framePose} from '../src/render/cameraRig';
import {practiceTable} from '../src/ui/tutorialPractice';
import {TABLE_W,TABLE_H} from '../src/sim/table';

it('finds a clear legal lane without modifying game, aim or called-shot state',()=>{
  const gs=practiceTable(),snapshot=structuredClone(gs),lane=placementLane(gs)!;
  expect(lane).not.toBeNull();expect(gs).toEqual(snapshot);
  expect(lane.object).toEqual({x:.45,y:.27});
  const travel=new Vector3(lane.ghost.x-lane.cue.x,0,lane.ghost.y-lane.cue.y).normalize();
  const camera=new PerspectiveCamera(45,16/9,.01,50),target=new Vector3();camera.position.set(0,2,3);
  const safe={left:-.7,right:.8,top:.7,bottom:-.6};
  const pose=framePose(camera,target,[lane.cue,lane.ghost,lane.object,lane.pocket],safe,{cue:lane.cue,theta:lane.theta});
  const cue=new Vector3(lane.cue.x-TABLE_W/2,0,lane.cue.y-TABLE_H/2);
  expect(pose.position.clone().sub(cue).dot(travel)).toBeLessThan(0);
  camera.position.copy(pose.position);camera.lookAt(pose.target);camera.updateMatrixWorld();
  for(const p of [lane.cue,lane.ghost,lane.object,lane.pocket]){
    const projected=new Vector3(p.x-TABLE_W/2,.028575,p.y-TABLE_H/2).project(camera);
    expect(projected.x).toBeGreaterThan(safe.left);expect(projected.x).toBeLessThan(safe.right);
    expect(projected.y).toBeGreaterThan(safe.bottom);expect(projected.y).toBeLessThan(safe.top);
  }
});
it('rejects targets behind the head string, illegal groups, break and unaccepted placement',()=>{
  const gs=practiceTable();gs.kitchenShot=true;expect(placementLane(gs)).toBeNull();
  gs.kitchenShot=false;gs.groups=['stripe','solid'];expect(placementLane(gs)).toBeNull();
  gs.groups=['solid','stripe'];gs.ballInHand=true;expect(placementLane(gs)).toBeNull();
  gs.ballInHand=false;gs.breakShot=true;expect(placementLane(gs)).toBeNull();
});
it('does not suggest an obstructed cue lane',()=>{
  const gs=practiceTable();
  // Surround cue with opponent balls; every direct lane must cross a blocker.
  const blockers=gs.balls.filter(b=>b.n!==1&&b.n!==null).slice(0,8);
  blockers.forEach((b,i)=>Object.assign(b,{potted:false,n:9,x:.9+Math.cos(i*Math.PI/4)*.095,y:.54+Math.sin(i*Math.PI/4)*.095}));
  expect(placementLane(gs)).toBeNull();
});
