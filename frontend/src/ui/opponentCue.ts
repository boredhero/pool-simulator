export type CuePhase = 'planning' | 'aiming' | 'pulling' | 'striking';
export interface SelectedShot {
  chalkLevel?:number; miscue?:boolean;
  aim:number; power:number; tipX:number; tipY:number;
  calledBall:number|null; calledPocket:number|null;
  placement:{x:number;y:number}; vmax?:number; elevation?:number;
}
export function freezeShot(shot:SelectedShot):Readonly<SelectedShot> {
  return Object.freeze({...shot,placement:Object.freeze({...shot.placement})});
}
export function cuePresentation(elapsed:number,power:number,reduced=false):{phase:CuePhase;pull:number} {
  if(reduced || elapsed<250)return {phase:'aiming',pull:.025};
  const back=.04+Math.max(0,Math.min(1,power))*.16;
  if(elapsed<550)return {phase:'pulling',pull:.025+(back-.025)*(elapsed-250)/300};
  return {phase:'striking',pull:back*(1-Math.min(1,(elapsed-550)/120))};
}
/** Visible frame time: tab suspension never skips straight through the stroke. */
export function animateOpponentCue(signal:AbortSignal,reduced:boolean,update:(elapsed:number)=>void):Promise<boolean> {
  return new Promise(resolve=>{
    let frame=0,last:number|undefined,elapsed=0,finished=false;
    const finish=(completed:boolean)=>{if(finished)return;finished=true;cancelAnimationFrame(frame);signal.removeEventListener('abort',abort);resolve(completed);};
    const abort=()=>finish(false);
    const tick=(now:number)=>{
      if(signal.aborted){finish(false);return;}
      if(last!==undefined)elapsed+=Math.min(50,Math.max(0,now-last));
      last=now;update(elapsed);
      if(finished)return;
      if(elapsed>=(reduced?140:670)){finish(true);return;}
      frame=requestAnimationFrame(tick);
    };
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)finish(false);else frame=requestAnimationFrame(tick);
  });
}
