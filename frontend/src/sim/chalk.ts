/** Gameplay approximation of friction-limited cue contact, mirrored in Python.
 * Wear/friction endpoints are tunable gameplay values, not measured chalk lifetimes. */
const finite=(n:number,fallback=0)=>Number.isFinite(n)?n:fallback;
export const chalkLevel=(n:number)=>Math.max(0,Math.min(1,finite(n,1)));
export function chalkContact(level:number,tipX:number,tipY:number){
  let tx=finite(tipX),ty=finite(tipY);let offset=Math.hypot(tx,ty);
  if(offset>.55){tx*=.55/offset;ty*=.55/offset;}
  offset=Math.hypot(tx,ty);const h=Math.sqrt(1-offset*offset);
  const grip=offset?Math.min(1,(.25+.45*chalkLevel(level))*h/offset):1;
  return {tx,ty,h,grip};
}
export function wearChalk(level:number,power:number,tipX:number,tipY:number){
  const {tx,ty}=chalkContact(level,tipX,tipY);
  return Math.max(0,chalkLevel(level)-(.12+.08*Math.max(0,Math.min(1,finite(power)))+.1*Math.hypot(tx,ty)/.55));
}
