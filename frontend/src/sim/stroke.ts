/** Compliant cue-tip contact; mirrored by backend/app/sim/stroke.py. */
import {chalkContact,chalkLevel} from './chalk';
import {Ball,ShotEvents,VMAX_NORMAL,shootSpeed,step} from './physics';
import {BALL_R,TABLE_W,TABLE_H,POCKETS} from './table';
const M=.17,MC=.54,ME=.012,RT=.006,H=.0000125,T=.0012,E=.75;
type Vec=[number,number,number];
const dot=(a:Vec,b:Vec)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec,b:Vec):Vec=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
/** Advances shot contact, returning events which subsequent simulation MUST retain. */
export function strikeBalls(balls:Ball[],cueId:number,dx:number,dy:number,power:number,tipX:number,tipY:number,vmax=VMAX_NORMAL,elevation=0,chalk=1):ShotEvents{
 const cue=balls.find(b=>b.id===cueId)!;
 const ev:ShotEvents={firstContact:null,potted:[],offTable:[],railAfterContact:false,cuePotted:false,pockets:[],objectRails:[]};
 const made={v:false};ev._strokeContacts=[];
 const {tx,ty}=chalkContact(chalk,tipX,tipY);
 const theta=Math.max(0,Math.min(Math.PI/2-.01,elevation)),ct=Math.cos(theta),st=Math.sin(theta);
 const axis:Vec=[dx*ct,dy*ct,-st],side:Vec=[-dy,dx,0],up:Vec=[dx*st,dy*st,ct];
 const radius=BALL_R+RT,back=radius*Math.sqrt(1-tx*tx-ty*ty);
 let center:Vec=[cue.x,cue.y,cue.z+BALL_R];
 let tip=center.map((v,i)=>v-axis[i]*back+radius*(tx*side[i]+ty*up[i])) as Vec;
 const speed=shootSpeed(power,vmax)*(1+M/MC)/(1+E);
 let velocity=axis.map(a=>speed*a) as Vec;
 const frozen=new Set(balls.filter(b=>b.id!==cueId&&!b.potted&&Math.sqrt((b.x-cue.x)**2+(b.y-cue.y)**2+(b.z-cue.z)**2)<=2*BALL_R+1e-7).map(b=>b.id));
 const near=Math.min(cue.x,cue.y,TABLE_W-cue.x,TABLE_H-cue.y)<.20||balls.some(b=>b.id!==cueId&&!b.potted&&Math.sqrt((b.x-cue.x)**2+(b.y-cue.y)**2)<.20);
 const mu=.25+.45*chalkLevel(chalk),inertia=.4*M*BALL_R*BALL_R,reduced=1/(1/M+1/MC),decay=-Math.log(E)/T;
 const stiffness=reduced*((Math.PI/T)**2+decay*decay),damping=2*reduced*decay;
 let touching=false,contacts=0,elapsed=0;
 let slateZ=cue.z;
 const slateTime=.0008,slateDecay=-Math.log(.5)/slateTime,slateK=M*((Math.PI/slateTime)**2+slateDecay*slateDecay),slateC=2*M*slateDecay;
 const invCue=(v:Vec):Vec=>{const axial=dot(v,axis);return v.map((q,i)=>axis[i]*axial/MC+(q-axis[i]*axial)/ME) as Vec;};
 while(elapsed<.02-1e-12&&!cue.potted){
  const dt=elapsed<.004||touching?H:.0001;
  center=[cue.x,cue.y,cue.z+BALL_R];
  const delta=center.map((v,i)=>v-tip[i]) as Vec,distance=Math.sqrt(dot(delta,delta)),compression=radius-distance,active=compression>0;
  if(active){
   if(!touching){contacts++;if(contacts>1)ev.cueDoubleHit=true;}
   const normal=delta.map(v=>v/distance) as Vec,arm=normal.map(v=>-BALL_R*v) as Vec;
   const ballV:Vec=[cue.vx,cue.vy,cue.vz],spinV=cross([cue.wx,cue.wy,cue.wz],arm);
   const relative=velocity.map((v,i)=>v-ballV[i]-spinV[i]) as Vec,closing=dot(relative,normal);
   const jn=Math.max(0,stiffness*compression+damping*closing)*dt;
   const tangent=relative.map((v,i)=>v-normal[i]*closing) as Vec,slip=Math.sqrt(dot(tangent,tangent));
   let impulse=normal.map(v=>v*jn) as Vec;
   if(slip>1e-12){const direction=tangent.map(v=>v/slip) as Vec,inverse=1/M+BALL_R*BALL_R/inertia+dot(direction,invCue(direction)),jt=Math.min(mu*jn,slip/inverse);impulse=impulse.map((v,i)=>v+direction[i]*jt) as Vec;}
   const change=invCue(impulse);velocity=velocity.map((v,i)=>v-change[i]) as Vec;
   cue.vx+=impulse[0]/M;cue.vy+=impulse[1]/M;cue.vz+=impulse[2]/M;
   const torque=cross(arm,impulse);cue.wx+=torque[0]/inertia;cue.wy+=torque[1]/inertia;cue.wz+=torque[2]/inertia;cue.asleep=false;
  }
  if(contacts&&!active&&!near&&slateZ>=-1e-8)break;
  touching=active;
  const previousContacts=ev._strokeContacts.length;
  tip=tip.map((v,i)=>v+velocity[i]*dt) as Vec;
  const supported=slateZ<=0&&(cue.vz<0||slateZ<0)&&!POCKETS.some(p=>(cue.x-p.x)**2+(cue.y-p.y)**2<p.r**2);
  if(supported){
   cue.vz+=Math.max(0,-slateK*slateZ-slateC*cue.vz)*dt/M;
   const vertical=cue.vz;cue.z=0;cue.vz=0;
   step(balls,dt,ev,cueId,made);cue.vz+=vertical;slateZ+=cue.vz*dt;cue.z=Math.max(0,slateZ);cue.asleep=false;
  }else{step(balls,dt,ev,cueId,made);slateZ=cue.z;}
  if(active)for(const hit of ev._strokeContacts.slice(previousContacts)){
   if(!frozen.has(hit.id)&&Math.abs(dot([hit.nx,hit.ny,hit.nz],axis))>.15)ev.cueDoubleHit=true;
  }
  elapsed+=dt;
 }
 delete ev._strokeContacts;return ev;
}
