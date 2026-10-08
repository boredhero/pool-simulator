import {shotCandidates} from '../sim/cpu';
import {legalTargets,type GameState} from '../sim/rules';
import {BALL_R,POCKETS,TABLE_W} from '../sim/table';

/** A camera composition hint, never an executable or called shot. Geometry only. */
export function placementLane(gs:GameState){
  const cue=gs.balls[0];
  if(cue.potted||gs.ballInHand||gs.winner!==null||gs.breakShot)return null;
  const eligible=legalTargets(gs).filter(n=>{
    const b=gs.balls.find(b=>b.n===n&&!b.potted);
    // A direct shot cannot leave the kitchen then return to a target behind it.
    return !!b&&(!gs.kitchenShot||b.x>=TABLE_W/4);
  });
  const shot=shotCandidates(gs.balls,eligible).find(s=>s.cutDegrees<=45&&s.cueDistance<=2.2&&s.pocketDistance<=2.2&&s.cueDistance+s.pocketDistance<=3.5);
  if(!shot)return null;
  const object=gs.balls.find(b=>b.n===shot.ball&&!b.potted)!,pocket=POCKETS[shot.pocket];
  const distance=Math.hypot(object.x-pocket.x,object.y-pocket.y);
  const ghost={x:object.x+(object.x-pocket.x)*2*BALL_R/distance,y:object.y+(object.y-pocket.y)*2*BALL_R/distance};
  const origin={x:cue.x,y:cue.y};
  // Spherical theta is measured around +z, with the camera behind cue travel.
  const theta=Math.atan2(origin.x-ghost.x,origin.y-ghost.y);
  return {cue:origin,ghost,object:{x:object.x,y:object.y},pocket:{x:pocket.x,y:pocket.y},theta};
}
