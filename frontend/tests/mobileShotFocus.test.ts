import {expect,it} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import {mobileShotFocus} from '../src/ui/mobileShotFocus';
import {mobileSafeFrame} from '../src/render/mobileSafeFrame';
import {framePose,majorityFacing} from '../src/render/cameraRig';
import {practiceTable} from '../src/ui/tutorialPractice';
import {BALL_R,TABLE_W,TABLE_H,POCKETS} from '../src/sim/table';
const rect=(left:number,top:number,width:number,height:number)=>({left,top,width,height,right:left+width,bottom:top+height});
it('fits a mobile shot closer than scattered legal balls while keeping cue, target and pocket visible',()=>{
  const gs=practiceTable();
  Object.assign(gs.balls.find(b=>b.n===2)!,{potted:false,x:2.3,y:1.05});
  Object.assign(gs.balls.find(b=>b.n===3)!,{potted:false,x:2.2,y:.2});
  const original=structuredClone(gs),focus=mobileShotFocus(gs,1,0)!;
  expect(gs).toEqual(original);expect(focus.ball).toBe(1);expect(focus.pocket).toBe(0);
  expect(focus.points).not.toContainEqual({x:2.3,y:1.05});
  for(const [width,height] of [[390,844],[844,390]]){
    const camera=new PerspectiveCamera(50,width/height,.05,50);camera.position.set(-2,3,2);
    const safe=width>height?mobileSafeFrame(rect(0,0,width,height),[rect(8,8,160,height-16)],[rect(width-188,8,180,height-16)])!:mobileSafeFrame(rect(0,0,width,height),[rect(8,8,width-16,100)],[rect(8,height-85,width-16,75)])!;
    const selected=framePose(camera,new Vector3(),focus.points,safe,{cue:focus.cue,theta:focus.theta});
    const legal=gs.balls.filter(b=>!b.potted&&b.n!==null);
    const all=framePose(camera,new Vector3(),[gs.balls[0],...legal],safe,{cue:focus.cue,theta:majorityFacing(focus.cue,legal,0)});
    expect(selected.position.distanceTo(selected.target)).toBeLessThan(all.position.distanceTo(all.target)*.85);
    camera.position.copy(selected.position);camera.lookAt(selected.target);camera.updateMatrixWorld();
    for(const point of [focus.cue,{x:.45,y:.27},POCKETS[0]]){
      const screen=new Vector3(point.x-TABLE_W/2,BALL_R,point.y-TABLE_H/2).project(camera);
      expect(screen.x).toBeGreaterThan(safe.left);expect(screen.x).toBeLessThan(safe.right);
      expect(screen.y).toBeGreaterThan(safe.bottom);expect(screen.y).toBeLessThan(safe.top);
    }
  }
});
it('respects selected pockets and legal groups, preserving placement and break overviews',()=>{
  const gs=practiceTable();expect(mobileShotFocus(gs,1,3)?.pocket).toBe(3);
  gs.groups=['stripe','solid'];expect(mobileShotFocus(gs,1,0)).toBeNull();
  gs.groups=['solid','stripe'];gs.kitchenShot=true;expect(mobileShotFocus(gs,1,0)).toBeNull();
  gs.kitchenShot=false;gs.ballInHand=true;expect(mobileShotFocus(gs)).toBeNull();
  gs.ballInHand=false;gs.breakShot=true;expect(mobileShotFocus(gs)).toBeNull();
});
it('blocked lanes fall back to one legal target with nearby obstruction context',()=>{
  const gs=practiceTable(),blockers=gs.balls.filter(b=>b.n!==1&&b.n!==null).slice(0,8);
  blockers.forEach((b,i)=>Object.assign(b,{potted:false,n:9,x:.45+Math.cos(i*Math.PI/4)*.095,y:.27+Math.sin(i*Math.PI/4)*.095}));
  const focus=mobileShotFocus(gs)!;expect(focus.ball).toBe(1);expect(focus.pocket).toBeNull();
  expect(focus.points.length).toBeGreaterThan(2);
  expect(focus.points.every(p=>p===focus.cue||Math.hypot(p.x-.45,p.y-.27)<.2)).toBe(true);
});
it('uses canvas-relative HUD bounds, ignores hidden panels and refuses fully covered viewports',()=>{
  const canvas=rect(20,40,390,800),safe=mobileSafeFrame(canvas,[rect(20,40,390,150)],[rect(20,720,390,100),rect(280,670,110,44),rect(0,0,0,0)])!;
  expect(safe.top).toBeCloseTo(1-2*162/800);expect(safe.bottom).toBeCloseTo(1-2*618/800);
  expect(mobileSafeFrame(canvas,[rect(20,40,390,700)],[rect(20,730,390,100)])).toBeNull();
});

it('reserves landscape side panels and switches to the active camera tray',()=>{
  const canvas=rect(20,40,844,390),left=rect(28,48,160,374),shot=rect(676,48,180,374);
  const safe=mobileSafeFrame(canvas,[left,rect(28,220,160,90)],[shot,rect(0,0,0,0)])!;
  expect(safe.left).toBeCloseTo(2*180/844-1);expect(safe.right).toBeCloseTo(2*644/844-1);
  expect(safe.top).toBeCloseTo(1-24/390);expect(safe.bottom).toBeCloseTo(-1+24/390);
  expect(mobileSafeFrame(canvas,[left],[rect(0,0,0,0),shot])).toEqual(safe);
});
it('keeps tutorial framing vertical when side panels are hidden in landscape',()=>{
  const safe=mobileSafeFrame(rect(0,0,844,390),[rect(0,0,0,0)],[rect(300,320,240,60)])!;
  expect(safe.left).toBeCloseTo(-1+32/844);expect(safe.right).toBeCloseTo(1-32/844);
  expect(safe.top).toBeCloseTo(1-24/390);expect(safe.bottom).toBeCloseTo(1-2*308/390);
});
