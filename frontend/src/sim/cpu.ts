// Offline CPU: geometry seeds and bounded previews using the live physics/rules.
// Legacy difficulty helpers remain available to existing callers.
import { BALL_R, POCKETS, TABLE_H, TABLE_W, cushions } from './table';
import { allAsleep, DT, shootSpeed, step, strike, type Ball, type ShotEvents } from './physics';
import { cueElevation } from './cue';
import { applyShot, beginShot, canPlace, groupOf, legalTargets as ruleTargets, placeCue, type GameState } from './rules';

export interface CpuShot { angle: number; power: number; tipX: number; tipY: number; ball?: number; pocket?: number }

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
  family: 'direct' | 'bank' | 'kick' | 'safety' | 'break' | 'development';
  placement?: { x: number; y: number };
  verified: boolean;
  score: number;
  evidence?: { clusterLinksOpened: number; newObjectRoutes: number; newTargetsAvailable: number;
    opponentClusterLinksOpened: number; opponentNewObjectRoutes: number; nextShots: number; opponentShots: number };
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

function placementSeeds(gs: GameState): CpuPlan[] {
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

/** Entirely offline. Preview copies use the same elevation, physics and rules as fire(). */
export function planCpuTurn(gs: GameState, maxTrials = 12, budgetMs = 120): CpuPlan | null {
  if(gs.winner!==null) return null;
  const deadline=performance.now()+budgetMs;
  const seeds=placementSeeds(gs);
  if(!seeds.length) return null;
  const vmax=gs.rules[gs.breakShot?'breakMax':'normalMax'];
  // Geometry seeds use the default 3.5 m/s calibration; custom caps change
  // normalized power, not the intended physical energy. Development is already calibrated.
  if(!gs.breakShot) for(const seed of seeds) if(seed.family!=='development')
    seed.power=powerForSpeed(shootSpeed(seed.power,3.5),vmax);
  const firm={...seeds[0],power:powerForSpeed(shootSpeed(seeds[0].power,vmax)+.65,vmax)};
  const queue=[...seeds.slice(0,1),...(gs.breakShot?[]:[firm]),...seeds.slice(1,8),...seeds.slice(0,2).flatMap(s=>[
    {...s,power:Math.max(.12,s.power*.7),tipY:.18}, {...s,tipY:-.22},
  ])];
  let best: CpuPlan|null=null;
  for(const seed of queue.slice(0,maxTrials)) {
    if(performance.now()>=deadline) break;
    const state=structuredClone(gs),me=state.current;
    if(state.ballInHand && (!seed.placement || !placeCue(state,seed.placement.x,seed.placement.y))) continue;
    const cue=state.balls[0];beginShot(state,seed.ball,seed.pocket);
    strike(cue,Math.cos(seed.angle),Math.sin(seed.angle),seed.power,seed.tipX,seed.tipY,
      state.rules[state.breakShot?'breakMax':'normalMax'],cueElevation(cue.x,cue.y,seed.angle,0,state.balls));
    const ev: ShotEvents={firstContact:null,potted:[],offTable:[],railAfterContact:false,cuePotted:false};
    const contact={v:false};let ticks=0;
    while(ticks<45/DT && !allAsleep(state.balls)) {
      if(ticks%64===0 && performance.now()>=deadline) break;
      step(state.balls,DT,ev,0,contact);ticks++;
    }
    if(!allAsleep(state.balls)) continue;
    applyShot(state,ev);
    if(state.winner===1-me || state.ballInHand || state.message.startsWith('Illegal break')) continue;
    const continues=state.current===me;
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
    const plan={...seed,score,verified:true,evidence:{clusterLinksOpened:opened,newObjectRoutes:newRoutes,newTargetsAvailable:newTargets,
      opponentClusterLinksOpened:opponentOpened,opponentNewObjectRoutes:opponentRoutes,nextShots:own.length,opponentShots:opponent}};
    if(!best || score>best.score) best=plan;
    if(state.winner===me) break;
  }
  // Unverified escape remains explicit; never target a potted apex as a fallback.
  return best ?? seeds[0];
}
