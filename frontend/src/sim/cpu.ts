// Offline CPU: geometry seeds and bounded previews using the live physics/rules.
// Legacy difficulty helpers remain available to existing callers.
import { BALL_R, POCKETS, TABLE_H, TABLE_W, cushions } from './table';
import { allAsleep, DT, shootSpeed, step, type Ball } from './physics';
import { strikeBalls } from './stroke';
import { wearChalk } from './chalk';
import { cueElevation } from './cue';
import { applyShot, beginShot, canPlace, groupOf, legalTargets as ruleTargets, placeCue, type GameState } from './rules';

export interface CpuShot { elevation?: number; angle: number; power: number; tipX: number; tipY: number; ball?: number; pocket?: number }

function segClear(
  x1: number, y1: number, x2: number, y2: number, balls: Ball[], ignore: number[], margin = 0.004,
): boolean {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  for (const b of balls) {
    if (b.potted || ignore.includes(b.id)) continue;
    let t = l2 > 0 ? ((b.x - x1) * dx + (b.y - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(b.x - (x1 + dx * t), b.y - (y1 + dy * t)) < BALL_R * 2 + margin) return false;
  }
  return true;
}

/** Gaussian noise via Box-Muller. */
function gauss(rnd: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface ShotCandidate extends CpuShot {
  score: number; ball: number; pocket: number;
  cutDegrees: number; cueDistance: number; pocketDistance: number;
}

/** Deterministic geometric options; no model is asked to calculate aiming angles. */
export function shotCandidates(balls: Ball[], targets: number[]): ShotCandidate[] {
  const cue = balls[0];
  const cands: ShotCandidate[] = [];
  for (const b of balls) {
    if (b.id === 0 || b.potted || b.n === null || !targets.includes(b.n)) continue;
    for (const p of POCKETS) {
      const pdx = b.x - p.x, pdy = b.y - p.y;
      const pd = Math.hypot(pdx, pdy) || 1;
      // Ghost: cue center position at contact, 2R from target along pocket line.
      const gx = b.x + (pdx / pd) * BALL_R * 2;
      const gy = b.y + (pdy / pd) * BALL_R * 2;
      if (gx < BALL_R || gx > TABLE_W - BALL_R || gy < BALL_R || gy > TABLE_H - BALL_R) continue;
      const aimX = gx - cue.x, aimY = gy - cue.y;
      const aimLen = Math.hypot(aimX, aimY) || 1;
      // Angle between cue travel and object travel (cut angle).
      const dot = (aimX * (p.x - b.x) + aimY * (p.y - b.y)) / (aimLen * (pd || 1));
      const cut = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (cut > (65 * Math.PI) / 180) continue;
      if (!segClear(cue.x, cue.y, gx, gy, balls, [0, b.id])) continue;
      if (!segClear(b.x, b.y, p.x, p.y, balls, [0, b.id])) continue;
      const dist = aimLen + pd;
      const score = (1 - cut / Math.PI) * 2 - dist / (TABLE_W + TABLE_H) + (p.corner ? 0.1 : 0);
      cands.push({ angle: Math.atan2(aimY, aimX), power: Math.min(0.9, Math.max(0.15, 0.15 + dist * 0.22)), score, ball: b.n, pocket: POCKETS.indexOf(p), tipX: 0, tipY: 0, cutDegrees: cut * 180 / Math.PI, cueDistance: aimLen, pocketDistance: pd });
    }
  }
  return cands.sort((a, b) => b.score - a.score);
}

export function chooseShot(
  balls: Ball[], targets: number[], difficulty: 'easy' | 'medium' | 'hard' = 'medium', rnd: () => number = Math.random,
): CpuShot | null {
  const best = shotCandidates(balls, targets)[0];
  if (!best) return null;
  const sigma = (difficulty === 'easy' ? 2.5 : difficulty === 'hard' ? 0.3 : 1) * Math.PI / 180;
  return { angle: best.angle + gauss(rnd) * sigma, power: best.power, tipX: 0, tipY: 0, ball: best.ball, pocket: best.pocket };
}

/** Break fallback: full power at the apex ball. */
export function breakShot(balls: Ball[]): CpuShot {
  const cue = balls[0];
  const apex = balls.find((b) => b.n === 1) ?? balls[1];
  return { angle: Math.atan2(apex.y - cue.y, apex.x - cue.x), power: 1.0, tipX: 0, tipY: 0.1 };
}

export function legalTargets(balls: Ball[], group: string | null, open: boolean): number[] {
  const out: number[] = [];
  for (const b of balls) {
    if (b.id === 0 || b.potted || b.n === null) continue;
    if (open) {
      if (b.n !== 8) out.push(b.n);
    } else if (group === 'solid' || group === 'stripe') {
      if (groupOf(b.n) === group) out.push(b.n);
    } else if (group === 'eight') {
      if (b.n === 8) out.push(b.n);
    }
  }
  return out;
}

export interface CpuPlan extends CpuShot {
  ball: number; pocket: number;
  family: 'direct' | 'bank' | 'kick' | 'safety' | 'break' | 'development' | 'jump' | 'masse';
  placement?: { x: number; y: number };
  breakStyle?: string;
  verified: boolean;
  score: number;
  evidence?: { clusterLinksOpened: number; newObjectRoutes: number; newTargetsAvailable: number;
    opponentClusterLinksOpened: number; opponentNewObjectRoutes: number; nextShots: number; opponentShots: number; lookaheadDepth?: number; followUpTrials?: number; followUpVerified?: boolean; runout?: boolean; peakHeight?: number; curveDisplacement?: number };
}

function powerForSpeed(speed: number, vmax: number): number {
  const minimum=shootSpeed(0,vmax);
  return Math.min(1,Math.max(0,(speed-minimum)/(vmax-minimum)))**(1/1.55);
}

function layoutFeatures(gs:GameState,numbers:number[]) {
  const live=gs.balls.filter(b=>b.n!==null&&!b.potted),pairs=new Map<string,[number,number]>();
  for(let i=0;i<live.length;i++) for(const b of live.slice(i+1)) {
    const a=live[i];
    if((numbers.includes(a.n!)||numbers.includes(b.n!)) && Math.hypot(a.x-b.x,a.y-b.y)<2*BALL_R+.055) {
      const ids:[number,number]=[Math.min(a.id,b.id),Math.max(a.id,b.id)];pairs.set(ids.join(':'),ids);
    }
  }
  const routes=new Set(live.filter(b=>numbers.includes(b.n!)&&POCKETS.some(p=>segClear(b.x,b.y,p.x,p.y,gs.balls,[0,b.id]))).map(b=>b.n!));
  return {pairs,routes};
}

function developmentPlans(gs:GameState):CpuPlan[] {
  if(gs.breakShot)return [];
  const cue=gs.balls[0],targets=ruleTargets(gs),plans:CpuPlan[]=[];
  for(const ball of gs.balls) {
    if(ball.potted||ball.n===null||ball.n===8||!targets.includes(ball.n)||(gs.kitchenShot&&ball.x<TABLE_W/4))continue;
    const neighbors=gs.balls.filter(b=>!b.potted&&b.id!==0&&b.id!==ball.id&&Math.hypot(ball.x-b.x,ball.y-b.y)<2*BALL_R+.055).length;
    const distance=Math.hypot(ball.x-cue.x,ball.y-cue.y);
    if(!neighbors||distance<=2*BALL_R)continue;
    const gx=ball.x-2*BALL_R*(ball.x-cue.x)/distance,gy=ball.y-2*BALL_R*(ball.y-cue.y)/distance;
    if(gx<BALL_R||gx>TABLE_W-BALL_R||gy<BALL_R||gy>TABLE_H-BALL_R||!segClear(cue.x,cue.y,gx,gy,gs.balls,[0,ball.id]))continue;
    const pocket=POCKETS.reduce((best,p,i)=>Math.hypot(p.x-ball.x,p.y-ball.y)<Math.hypot(POCKETS[best].x-ball.x,POCKETS[best].y-ball.y)?i:best,0);
    for(const speed of [2.05,2.85]) {
      const launch=Math.sqrt(speed*speed+2*.01*9.81*Math.max(0,distance-.75));
      plans.push({angle:Math.atan2(ball.y-cue.y,ball.x-cue.x),power:powerForSpeed(launch,gs.rules.normalMax),tipX:0,tipY:0,
        ball:ball.n,pocket,family:'development',score:neighbors-distance,verified:false});
    }
  }
  return plans.sort((a,b)=>b.score-a.score).slice(0,4);
}

/** Mirror seeds use real cushion segments, avoiding the pocket mouths. */
function rebound(start: [number, number], end: [number, number], rail: ReturnType<typeof cushions>[number]): [number, number] | null {
  const horizontal = rail.y1 === rail.y2, axis = horizontal ? 1 : 0;
  const edge = horizontal ? rail.y1 : rail.x1;
  const plane = edge === 0 ? BALL_R : (horizontal ? TABLE_H : TABLE_W) - BALL_R;
  const reflected: [number, number] = [...end]; reflected[axis] = 2 * plane - end[axis];
  const delta = reflected[axis] - start[axis];
  if (Math.abs(delta) < 1e-9) return null;
  const t = (plane - start[axis]) / delta;
  if (t <= 0 || t >= 1) return null;
  const point: [number, number] = [start[0] + t * (reflected[0] - start[0]), start[1] + t * (reflected[1] - start[1])];
  const lo = horizontal ? rail.x1 : rail.y1, hi = horizontal ? rail.x2 : rail.y2;
  return point[1-axis] > Math.min(lo,hi) + BALL_R && point[1-axis] < Math.max(lo,hi) - BALL_R ? point : null;
}

function geometryPlans(gs: GameState): CpuPlan[] {
  const cue = gs.balls[0], targets = ruleTargets(gs);
  const eligible = targets.filter(n => !gs.kitchenShot || gs.balls.find(b => b.n === n)!.x >= TABLE_W / 4);
  if (gs.breakShot) {
    const ball = gs.balls.find(b => !b.potted && b.n !== null && targets.includes(b.n))!;
    return [{ ...breakShot(gs.balls), ball: ball.n!, pocket: 0, family: 'break', verified: false, score: 0 }];
  }
  const direct: CpuPlan[] = shotCandidates(gs.balls, eligible).map(s => ({...s, family: 'direct', verified: false}));
  const banks: CpuPlan[] = [], kicks: CpuPlan[] = [], safeties: CpuPlan[] = [];
  const shot = (ball: Ball, point: [number,number], pocket: number, family: CpuPlan['family'], power: number): CpuPlan => ({
    angle: Math.atan2(point[1]-cue.y, point[0]-cue.x), power, tipX: 0, tipY: 0,
    ball: ball.n!, pocket, family, verified: false, score: -Math.hypot(point[0]-cue.x,point[1]-cue.y),
  });
  for (const ball of gs.balls.filter(b => !b.potted && b.n !== null && targets.includes(b.n))) {
    const behind = gs.kitchenShot && ball.x < TABLE_W/4;
    const nearest = POCKETS.reduce((best,p,i) => Math.hypot(p.x-ball.x,p.y-ball.y) < Math.hypot(POCKETS[best].x-ball.x,POCKETS[best].y-ball.y) ? i : best,0);
    if (!behind && segClear(cue.x,cue.y,ball.x,ball.y,gs.balls,[0,ball.id])) {
      safeties.push(shot(ball,[ball.x,ball.y],nearest,'safety',.45));
    }
    for (const rail of cushions()) {
      // Contact escape: leave the kitchen first, then return to its legal target.
      const destinations=POCKETS.map((p,pocket)=>{
        const distance=Math.hypot(p.x-ball.x,p.y-ball.y);
        return {x:ball.x-2*BALL_R*(p.x-ball.x)/distance,y:ball.y-2*BALL_R*(p.y-ball.y)/distance,pocket};
      });
      destinations.push({x:ball.x,y:ball.y,pocket:nearest});
      for(const destination of destinations) {
        const contact = rebound([cue.x,cue.y],[destination.x,destination.y],rail);
        if (contact && (!behind || contact[0] >= TABLE_W/4)
            && segClear(cue.x,cue.y,...contact,gs.balls,[0])
            && segClear(...contact,destination.x,destination.y,gs.balls,[0,ball.id])) {
          const travel=Math.hypot(contact[0]-cue.x,contact[1]-cue.y)+Math.hypot(destination.x-contact[0],destination.y-contact[1]);
          kicks.push(shot(ball,contact,destination.pocket,'kick',Math.min(1,.45+.15*travel)));
        }
      }
      if (behind) continue;
      for (let i=0;i<POCKETS.length;i++) {
        const p=POCKETS[i], bounce=rebound([ball.x,ball.y],[p.x,p.y],rail);
        if (!bounce) continue;
        const distance=Math.hypot(bounce[0]-ball.x,bounce[1]-ball.y);
        const gx=ball.x-2*BALL_R*(bounce[0]-ball.x)/distance, gy=ball.y-2*BALL_R*(bounce[1]-ball.y)/distance;
        if (gx<BALL_R || gx>TABLE_W-BALL_R || gy<BALL_R || gy>TABLE_H-BALL_R) continue;
        if ((gx-cue.x)*(bounce[0]-ball.x)+(gy-cue.y)*(bounce[1]-ball.y)<=0) continue;
        if (segClear(cue.x,cue.y,gx,gy,gs.balls,[0,ball.id]) && segClear(ball.x,ball.y,...bounce,gs.balls,[0,ball.id]) && segClear(...bounce,p.x,p.y,gs.balls,[0,ball.id])) {
          banks.push(shot(ball,[gx,gy],i,'bank',.6));
        }
      }
    }
  }
  // Diversify before previewing so difficult layouts receive an escape trial.
  const options=[direct[0], safeties[0], kicks[0], banks[0], ...direct.slice(1,5), ...kicks.slice(1), ...safeties.slice(1), ...banks.slice(1)]
    .filter((s): s is CpuPlan => !!s);
  const development=developmentPlans(gs);
  if(options.length||development.length) {
    return [...options.slice(0,1),...development.slice(0,2),...options.slice(1),...development.slice(2)];
  }
  const target=gs.balls.find(b=>!b.potted && b.n!==null && targets.includes(b.n));
  if(!target) return [];
  // A fully obstructed layout must still take a turn, rather than freezing.
  // This last resort is deliberately unverified and may concede a foul.
  if(gs.kitchenShot && target.x<TABLE_W/4) {
    const bounce=cushions().map(r=>rebound([cue.x,cue.y],[target.x,target.y],r))
      .find(p=>p!==null && p[0]>=TABLE_W/4);
    return [shot(target,bounce??[TABLE_W-BALL_R,cue.y],0,'kick',1)];
  }
  return [shot(target,[target.x,target.y],0,'safety',.5)];
}

/** Deliberate break variations; randomness proposes a shot, never alters physics. */
export function breakPlans(gs: GameState, rnd:()=>number=Math.random):CpuPlan[] {
  const rack=gs.balls.filter(b=>b.n!==null&&!b.potted).sort((a,b)=>a.x-b.x||a.y-b.y);
  if(!rack.length)return [];
  const movable=gs.rules.breakPlacement!==false;
  const styles:Array<[string,number,Ball,number,number,number]>=[
    ['head-on',.5,rack[0],1,.06,0],['head-left',.32,rack[0],.9,.10,0],['head-right',.68,rack[0],.9,.10,0],
  ];
  if(movable&&rack.length>=3){
    const second=rack.slice(1,3).sort((a,b)=>a.y-b.y);
    styles.push(['second-left',.13,second[0],.78,-.1,-.035],['second-right',.87,second[1],.78,-.1,.035]);
  }
  for(let i=styles.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[styles[i],styles[j]]=[styles[j],styles[i]];}
  return styles.flatMap(([breakStyle,lane,target,power,tipY,offset])=>{
    const x=movable?TABLE_W/4-(.015+rnd()*.075):gs.balls[0].x;
    const y=movable?TABLE_H*lane+(rnd()-.5)*.07:gs.balls[0].y;
    if(movable&&!canPlace(gs,x,y))return [];
    return [{angle:Math.atan2(target.y+offset-y,target.x-x),power:Math.min(1,power+(rnd()-.5)*.08),
      tipX:0,tipY:tipY+(rnd()-.5)*.05,ball:target.n!,pocket:0,family:'break' as const,
      breakStyle,verified:false,score:0,...(movable?{placement:{x,y}}:{})}];
  });
}

function placementSeeds(gs: GameState, rnd:()=>number): CpuPlan[] {
  if(gs.breakShot)return breakPlans(gs,rnd);
  if (!gs.ballInHand) return geometryPlans(gs);
  const points: Array<[number,number]> = [];
  for (const ball of gs.balls.filter(b => !b.potted && b.n !== null && ruleTargets(gs).includes(b.n))) {
    for (const p of POCKETS) {
      const dx=ball.x-p.x,dy=ball.y-p.y,length=Math.hypot(dx,dy);
      if (!length) continue;
      for (const distance of [.25,.45]) points.push([ball.x+dx/length*distance,ball.y+dy/length*distance]);
    }
  }
  for (let x=.15;x<TABLE_W;x+=.2) for(let y=.15;y<TABLE_H;y+=.2) points.push([x,y]);
  const plans: CpuPlan[]=[];
  for(const [x,y] of points.filter(([x,y])=>canPlace(gs,x,y)).slice(0,64)) {
    const state=structuredClone(gs); placeCue(state,x,y);
    const targets=ruleTargets(state).filter(n=>!state.kitchenShot || state.balls.find(b=>b.n===n)!.x>=TABLE_W/4);
    const best=shotCandidates(state.balls,targets)[0];
    if(best) plans.push({...best,family:'direct',verified:false,placement:{x,y}});
  }
  plans.sort((a,b)=>b.score-a.score);
  const unique=plans.filter((s,i)=>plans.findIndex(p=>p.ball===s.ball&&p.pocket===s.pocket)===i).slice(0,8);
  const first=points.find(([x,y])=>canPlace(gs,x,y));
  if(first) {
    const state=structuredClone(gs);placeCue(state,...first);
    unique.push(...geometryPlans(state).filter(s=>s.family!=='direct').slice(0,6).map(s=>({...s,placement:{x:first[0],y:first[1]}})));
  }
  return unique;
}

/** Geometry proposes elevated rescue shots; full physics must establish legality. */
export function advancedPlans(gs:GameState):CpuPlan[] {
  if(gs.breakShot||gs.ballInHand)return [];
  const cue=gs.balls[0],plans:CpuPlan[]=[];
  for(const ball of gs.balls){
    if(ball.potted||ball.n===null||!ruleTargets(gs).includes(ball.n))continue;
    if(gs.kitchenShot&&ball.x<TABLE_W/4)continue;
    for(let pocket=0;pocket<POCKETS.length;pocket++){
      const p=POCKETS[pocket],distance=Math.hypot(ball.x-p.x,ball.y-p.y);
      if(!distance)continue;
      const gx=ball.x+2*BALL_R*(ball.x-p.x)/distance,gy=ball.y+2*BALL_R*(ball.y-p.y)/distance;
      if(gx<BALL_R||gx>TABLE_W-BALL_R||gy<BALL_R||gy>TABLE_H-BALL_R)continue;
      if(!segClear(ball.x,ball.y,p.x,p.y,gs.balls,[0,ball.id]))continue;
      if(segClear(cue.x,cue.y,gx,gy,gs.balls,[0,ball.id]))continue;
      const seed:CpuPlan={angle:Math.atan2(gy-cue.y,gx-cue.x),power:.85,tipX:0,tipY:.1,
        ball:ball.n,pocket,family:'jump',score:0,verified:false};
      for(const elevation of [.45,.7,.95])plans.push({...seed,elevation});
      for(const side of [-1,1])plans.push({...seed,family:'masse',elevation:1.05,power:.55,
        tipY:0,tipX:side*.45,angle:Math.atan2(ball.y-cue.y,ball.x-cue.x)-side*.4});
      if(plans.length>=10)return plans;
    }
  }
  return plans;
}

function previewPlan(gs:GameState,seed:CpuPlan,deadline:number){
    const state=structuredClone(gs),me=state.current;
    if((state.ballInHand||seed.placement) && (!seed.placement || !placeCue(state,seed.placement.x,seed.placement.y))) return null;
    const cue=state.balls[0];
    const elevation=Math.max(seed.elevation??0,cueElevation(cue.x,cue.y,seed.angle,0,state.balls,seed.tipX,seed.tipY));
    beginShot(state,seed.ball,seed.pocket);
    const chalk=state.rules.chalkSim?state.chalk[me]:1;
    if(state.rules.chalkSim)state.chalk[me]=wearChalk(chalk,seed.power,seed.tipX,seed.tipY);
    const ev=strikeBalls(state.balls,0,Math.cos(seed.angle),Math.sin(seed.angle),seed.power,seed.tipX,seed.tipY,
      state.rules[state.breakShot?'breakMax':'normalMax'],elevation,chalk);
    const contact={v:ev.firstContact!==null};let ticks=0;
    let peak=cue.z,curvature=0,trackingCurve=true;
    const initialX=cue.x,initialY=cue.y,initialAngle=Math.atan2(cue.vy,cue.vx);
    while(ticks<45/DT && !allAsleep(state.balls)) {
      if(ticks%64===0 && performance.now()>=deadline) break;
      step(state.balls,DT,ev,0,contact);ticks++;
      peak=Math.max(peak,cue.z);
      if(Math.min(cue.x,TABLE_W-cue.x,cue.y,TABLE_H-cue.y)<BALL_R+.002)trackingCurve=false;
      if(ev.firstContact===null&&trackingCurve)curvature=Math.max(curvature,Math.abs(-(cue.x-initialX)*Math.sin(initialAngle)+(cue.y-initialY)*Math.cos(initialAngle)));
    }
    if(!allAsleep(state.balls)) return null;
    if(seed.breakStyle?.startsWith('second-')&&ev.firstContact!==seed.ball)return null;
    if(seed.family==='jump'&&(peak<.01||ev.firstContact!==seed.ball))return null;
    if(seed.family==='masse'&&(curvature<.01||ev.firstContact!==seed.ball))return null;
    applyShot(state,ev);
    if(state.winner===1-me || state.ballInHand || state.message.startsWith('Illegal break')) return null;
    const resolvedCurrent=state.current,continues=state.current===me;
    state.current=me;
    const own=shotCandidates(state.balls,ruleTargets(state));
    const comparison={...gs,current:me,groups:state.groups,open:state.open};
    const ownNumbers=ruleTargets(comparison),before=layoutFeatures(comparison,ownNumbers),after=layoutFeatures(state,ownNumbers);
    const beforeTargets=new Set(shotCandidates(comparison.balls,ownNumbers).map(s=>s.ball));
    const nextTargets=new Set(own.map(s=>s.ball));
    const liveIds=new Set(state.balls.filter(b=>!b.potted).map(b=>b.id));
    const opened=[...before.pairs].filter(([key,[a,b]])=>!after.pairs.has(key)&&liveIds.has(a)&&liveIds.has(b)).length;
    const newRoutes=[...after.routes].filter(n=>!before.routes.has(n)).length;
    const newTargets=[...nextTargets].filter(n=>!beforeTargets.has(n)).length;
    state.current=(1-me) as 0|1;
    const opponent=shotCandidates(state.balls,ruleTargets(state)).length;
    comparison.current=state.current;
    const opponentNumbers=ruleTargets(comparison),oppBefore=layoutFeatures(comparison,opponentNumbers),oppAfter=layoutFeatures(state,opponentNumbers);
    const opponentOpened=[...oppBefore.pairs].filter(([key,[a,b]])=>!oppAfter.pairs.has(key)&&liveIds.has(a)&&liveIds.has(b)).length;
    const opponentRoutes=[...oppAfter.routes].filter(n=>!oppBefore.routes.has(n)).length;
    let score=state.winner===me?10000:(continues?80+Math.min(own.length,5)*3:30-Math.min(opponent,5)*3);
    if(before.pairs.size) score+=Math.min(20,Math.min(6,.5*opened)+Math.min(4,2*newRoutes)+Math.min(12,6*newTargets))-Math.min(15,.8*opponentOpened+4*opponentRoutes);
    score-=.2*seed.power;
    const plan:CpuPlan={...seed,elevation,score,verified:true,evidence:{peakHeight:peak,curveDisplacement:curvature,clusterLinksOpened:opened,newObjectRoutes:newRoutes,newTargetsAvailable:newTargets,
      opponentClusterLinksOpened:opponentOpened,opponentNewObjectRoutes:opponentRoutes,nextShots:own.length,opponentShots:opponent}};
    state.current=resolvedCurrent;
    return {plan,state,continues};
}

/** Entirely offline. Preview copies use the same elevation, physics and rules as fire(). */
export function planCpuTurn(gs: GameState, maxTrials = 12, budgetMs = 120, rnd:()=>number=Math.random): CpuPlan | null {
  if(gs.winner!==null) return null;
  const deadline=performance.now()+budgetMs;
  const seeds=placementSeeds(gs,rnd);
  if(!seeds.length) return null;
  const vmax=gs.rules[gs.breakShot?'breakMax':'normalMax'];
  // Geometry seeds use the default 3.5 m/s calibration; custom caps change
  // normalized power, not the intended physical energy. Development is already calibrated.
  if(!gs.breakShot) for(const seed of seeds) if(seed.family!=='development')
    seed.power=powerForSpeed(shootSpeed(seed.power,3.5),vmax);
  const firm={...seeds[0],power:powerForSpeed(shootSpeed(seeds[0].power,vmax)+.65,vmax)};
  const queue=[...seeds.slice(0,1),...(gs.breakShot?[]:[firm]),...seeds.slice(1,8),...(gs.breakShot?[]:seeds.slice(0,2)).flatMap(s=>[
    {...s,power:Math.max(.12,s.power*.7),tipY:.18}, {...s,tipY:-.22},
  ])];
  const advanced=advancedPlans(gs);
  if(advanced.length)queue.splice(5,0,advanced[0],advanced[3],advanced[4],advanced[1]);
  const limit=Math.max(0,Math.min(64,maxTrials));
  const rootLimit=gs.breakShot||limit<8?limit:limit-Math.min(4,Math.floor(limit/3));
  let trials=0;
  const completed:Array<NonNullable<ReturnType<typeof previewPlan>>>=[];
  for(const seed of queue.slice(0,rootLimit)){
    if(performance.now()>=deadline)break;
    trials++;
    const result=previewPlan(gs,seed,deadline);
    if(result)completed.push(result);
  }
  completed.sort((a,b)=>b.plan.score-a.plan.score);
  if(!gs.breakShot){
    for(const root of completed.filter(r=>r.continues&&r.state.winner===null).slice(0,2)){
      for(const seed of placementSeeds(root.state,rnd).slice(0,2)){
        if(trials>=limit||performance.now()>=deadline)break;
        trials++;
        if(seed.family!=='development')seed.power=powerForSpeed(shootSpeed(seed.power,3.5),vmax);
        const child=previewPlan(root.state,seed,deadline);
        if(!child)continue;
        const evidence=root.plan.evidence!;
        evidence.lookaheadDepth=Math.max(2,evidence.lookaheadDepth??1);
        evidence.followUpTrials=(evidence.followUpTrials??0)+1;
        if(child.continues){
          if(!evidence.followUpVerified)root.plan.score+=35;
          evidence.followUpVerified=true;
          if(child.state.winner===gs.current){if(!evidence.runout)root.plan.score+=150;evidence.runout=true;}
          else if(ruleTargets(child.state).length<=2&&trials<limit&&performance.now()<deadline){
            const third=placementSeeds(child.state,rnd)[0];
            if(third){
              if(third.family!=='development')third.power=powerForSpeed(shootSpeed(third.power,3.5),vmax);trials++;
              const leaf=previewPlan(child.state,third,deadline);
              if(leaf){evidence.lookaheadDepth=3;if(leaf.state.winner===gs.current){if(!evidence.runout)root.plan.score+=150;evidence.runout=true;}}
            }
          }
        }
      }
    }
  }
  completed.sort((a,b)=>b.plan.score-a.plan.score);
  const best=completed[0]?.plan;
  // Unverified escape remains explicit; never target a potted apex as a fallback.
  return best ?? seeds[0];
}
