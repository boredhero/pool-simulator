import {expect,it} from 'vitest';
import fixtures from '../../contracts/snapshot-replay.json';
import {applyServerBalls} from '../src/net/room';
import {DT,allAsleep,makeBall,simulateShot,step,strike,type ShotEvents} from '../src/sim/physics';
import {applyShot,beginShot,newGame} from '../src/sim/rules';

it('preserves all received physics fields and supports older idle snapshots',()=>{
  const ball=makeBall(1,1,0,0);
  const snapshot={id:1,n:7,x:.02857500000001,y:1.123456789012345,z:.0123456789012345,
    vx:.123456789012345,vy:-1.123456789012345,vz:.234567890123456,
    wx:-4.56789012345678,wy:3.45678901234567,wz:-2.34567890123456,asleep:false,potted:false};
  applyServerBalls([ball],JSON.parse(JSON.stringify([snapshot])));
  expect(ball).toEqual(snapshot);
  applyServerBalls([ball],[{id:1,n:7,x:.028575,y:.9,potted:true}]);
  expect(ball).toEqual({...makeBall(1,7,.028575,.9),potted:true});
});

it('replays the precise server rack without the false pocket caused by rounded coordinates',()=>{
  const fixture=fixtures.precisionBreak,shot=fixture.shot;
  const balls=newGame(1).balls;
  applyServerBalls(balls,JSON.parse(JSON.stringify(fixture.balls)));
  expect(balls).toEqual(fixture.balls);
  strike(balls[0],Math.cos(shot.aim),Math.sin(shot.aim),shot.power,shot.tipX,shot.tipY,shot.vmax,shot.elevation);
  expect(simulateShot(balls,0).potted).toEqual(fixture.potted);
  const rounded=structuredClone(fixture.balls);
  for(const ball of rounded){ball.x=Number(ball.x.toFixed(5));ball.y=Number(ball.y.toFixed(5));}
  strike(rounded[0],Math.cos(shot.aim),Math.sin(shot.aim),shot.power,shot.tipX,shot.tipY,shot.vmax,shot.elevation);
  expect(simulateShot(rounded,0).potted).toEqual(fixture.roundedPotted);
});

it('keeps both sequential pots through bar rules and authoritative reconciliation',()=>{
  const fixture=fixtures.sequentialPots,gs=newGame(1);
  gs.balls=structuredClone(fixture.balls);gs.breakShot=false;beginShot(gs);
  const ev:ShotEvents={firstContact:1,potted:[],offTable:[],railAfterContact:false,cuePotted:false};
  const contact={v:true},pocketSteps:number[]=[];
  for(let tick=0;tick<2400;tick++){
    const before=ev.potted.length;step(gs.balls,DT,ev,0,contact);
    if(ev.potted.length>before)pocketSteps.push(tick);
    if(allAsleep(gs.balls))break;
  }
  expect(ev.potted).toEqual(fixture.potted);expect(pocketSteps).toEqual(fixture.pocketSteps);
  applyShot(gs,ev);
  expect(gs.returnOrder).toEqual([2,1]);expect(gs.current).toBe(0);expect(gs.ballInHand).toBe(false);
  const snapshot=JSON.parse(JSON.stringify(gs.balls));
  applyServerBalls(gs.balls,snapshot);
  expect(gs.balls.filter(b=>b.n===1||b.n===2).every(b=>b.potted)).toBe(true);
});
