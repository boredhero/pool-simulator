import {newGame,type GameState} from '../sim/rules';
/** A disposable two-ball table; never contains account, room, or Jev state. */
export function practiceTable():GameState {
  const gs=newGame(42);
  gs.breakShot=false;gs.rules={...gs.rules,preset:'custom',calls:'none'};
  gs.groups=['solid','stripe'];gs.open=false;gs.message='Practice table';
  for(const ball of gs.balls)ball.potted=true;
  Object.assign(gs.balls[0],{potted:false,x:.9,y:.54});
  const target=gs.balls.find(b=>b.n===1)!;Object.assign(target,{potted:false,x:.45,y:.27});
  return gs;
}
