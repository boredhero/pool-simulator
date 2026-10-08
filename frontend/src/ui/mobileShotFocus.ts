import {shotCandidates} from '../sim/cpu';
import {legalTargets,type GameState} from '../sim/rules';
import {BALL_R,POCKETS,TABLE_W} from '../sim/table';

/** A compact mobile composition, not a call or an executable shot. */
export function mobileShotFocus(gs:GameState,calledBall:number|null=null,calledPocket:number|null=null){
  const cue=gs.balls[0];
  if(cue.potted||gs.ballInHand||gs.winner!==null||gs.breakShot)return null;
  const legal=legalTargets(gs).filter(n=>{
    const b=gs.balls.find(b=>b.n===n&&!b.potted);
    return !!b&&(!gs.kitchenShot||b.x>=TABLE_W/4);
  });
  const selected=calledBall!==null&&legal.includes(calledBall)?calledBall:null;
  const candidates=shotCandidates(gs.balls,selected===null?legal:[selected]);
  const selectedPocket=calledPocket!==null&&Number.isInteger(calledPocket)&&calledPocket>=0&&calledPocket<POCKETS.length?calledPocket:null;
  const shot=candidates.find(s=>selectedPocket===null||s.pocket===selectedPocket);
  const object=gs.balls.find(b=>!b.potted&&b.n===(selected??shot?.ball))??
    gs.balls.filter(b=>!b.potted&&b.n!==null&&legal.includes(b.n))
      .sort((a,b)=>Math.hypot(a.x-cue.x,a.y-cue.y)-Math.hypot(b.x-cue.x,b.y-cue.y))[0];
  if(!object)return null;
  const point=(b:{x:number;y:number})=>({x:b.x,y:b.y});
  const origin=point(cue),points=[origin,point(object)];
  // Keep a player's selected pocket visible even when its lane is obstructed.
  const pocketIndex=selected!==null&&selectedPocket!==null?selectedPocket:shot?.pocket;
  let aim=point(object);
  if(pocketIndex!==undefined){
    const pocket=POCKETS[pocketIndex],distance=Math.hypot(object.x-pocket.x,object.y-pocket.y)||1;
    aim={x:object.x+(object.x-pocket.x)*2*BALL_R/distance,y:object.y+(object.y-pocket.y)*2*BALL_R/distance};
    points.push(aim,point(pocket));
  }
  // Nearby blockers are useful context; unrelated distant balls must not zoom out the shot.
  for(const b of gs.balls)if(!b.potted&&b!==cue&&b!==object&&Math.hypot(b.x-object.x,b.y-object.y)<.18)points.push(point(b));
  return {cue:origin,points,theta:Math.atan2(origin.x-aim.x,origin.y-aim.y),ball:object.n,pocket:pocketIndex??null};
}
