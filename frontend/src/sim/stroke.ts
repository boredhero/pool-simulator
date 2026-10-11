/** Shared shot entry point. Finite tip compliance is deferred: see docs/stroke.md. */
import {Ball,ShotEvents,VMAX_NORMAL,strike} from './physics';

export function strikeBalls(balls:Ball[],cueId:number,dx:number,dy:number,power:number,tipX:number,tipY:number,vmax=VMAX_NORMAL,elevation=0,chalk=1):ShotEvents{
 const cue=balls.find(b=>b.id===cueId)!;
 // Sequential impulse approximation: TP B.10 pp. 2–3; baseline calibration retained.
 // https://drdavepoolinfo.com/technical_proofs/new/TP_B-10.pdf
 strike(cue,dx,dy,power,tipX,tipY,vmax,elevation,chalk);
 return {firstContact:null,potted:[],offTable:[],railAfterContact:false,cuePotted:false,pockets:[],objectRails:[]};
}
