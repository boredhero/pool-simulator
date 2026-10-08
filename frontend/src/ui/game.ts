import { cueStyle } from '../render/ballTextures';
import { advancePlayback } from './playback';
import { sightStyle } from '../render/railSights';
import { cueElevation } from '../sim/cue';
import { type MatchConfig } from '../sim/config';
import { TableOptions } from './tableOptions';
import { allAsleep, strike, type Ball, type ShotEvents } from '../sim/physics';
import { applyShot, beginShot, callRequired, canPlace, legalTargets, newGame, placeCue, type GameState } from '../sim/rules';
import { breakShot, chooseShot } from '../sim/ai';
import { Sfx } from './sfx';
import { POCKETS, TABLE_H, TABLE_W } from '../sim/table';
import { init, type SceneHandle } from '../render/scene';
import { RoomClient, type RoomState } from '../net/room';

type Mode = 'aim' | 'rolling' | 'place' | 'over' | 'wait';

// Pull-back distance (m, felt space) for full power. Power is displacement,
// never hold time: a short tentative drag can't accidentally nuke the ball.
const PULL_FULL = 0.35;

const FELTS = ['#0a6c2f', '#0d47a1', '#6a1b9a', '#b71c1c', '#004d40', '#37474f'];
const WOODS = ['#4a2c14', '#8d6e63', '#212121', '#5d2a1a', '#e0e0e0', '#2e4a2c'];
const GROUP_BALLS: Record<string, number[]> = {
  solid: [1, 2, 3, 4, 5, 6, 7],
  stripe: [9, 10, 11, 12, 13, 14, 15],
};
const BALL_CSS = ['#f5c518', '#0d47d8', '#d82323', '#5b0d8a', '#ef6c00', '#0a7a3d', '#7a1a1a', '#111111',
  '#f5c518', '#0d47d8', '#d82323', '#5b0d8a', '#ef6c00', '#0a7a3d', '#7a1a1a'];
const ballCss = (n: number): string => {
  const c = BALL_CSS[(n - 1) % 15];
  return n > 8 ? `linear-gradient(to bottom, #f8f8f8 25%, ${c} 25%, ${c} 75%, #f8f8f8 75%)` : c;
};

const freshEv = (): ShotEvents => ({
  firstContact: null, potted: [], offTable: [], railAfterContact: false, cuePotted: false,
});

export class Game {
  gs: GameState;
  options: TableOptions;
  calledBall: number | null = null;
  calledPocket: number | null = null;
  accumulator = 0;
  pointers = new Set<number>();
  cameraMode=false;
  cameraGesture=false;
  placementPress:[number,number]|null=null;
  cameraShotPending=false;
  cameraShotRevision=0;
  scene: SceneHandle;
  mode: Mode = 'aim';
  angle = 0; // aim direction, sim plane (eased toward targetAngle)
  targetAngle = 0;
  power = 0.5; // last fired power (drives cue rest offset)
  tipX = 0; tipY = 0;
  roomNames: string[] | null = null;
  ev: ShotEvents = freshEv();
  contact = { v: false };
  el: Record<string, HTMLElement>;
  room: RoomClient | null = null;
  seat: number | null = null;
  whoShot: number | null = null;
  aiOpponent = false;
  aiTimer = 0;
  sfx = new Sfx();
  lastSpeed = new Map<number, number>();
  lastPotted = 0;
  lastLiveFacts = '';
  pendingNetwork: Array<() => void> = [];
  lastT = 0;
  lastFrame = 0;
  pulling = false;
  pressPt: [number, number] | null = null;
  hoverPt: [number, number] | null = null;
  placeX = TABLE_W / 4; placeY = TABLE_H / 2;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = init(canvas);
    this.gs = newGame(1);
    this.el = Object.fromEntries(
      ['msg', 'turn', 'version', 'onlinebtn', 'onlinepanel', 'pname', 'rcode', 'createbtn', 'joinbtn',
        'roominfo', 'chargefill', 'spin', 'aibtn', 'rack', 'settingsbtn', 'settingspanel',
        'feltsw', 'woodsw', 'feltcustom', 'woodcustom', 'scorecard'].map((id) => [id, document.getElementById(id)!]),
    );
    this.applyTheme(localStorage.getItem('pool:felt') ?? FELTS[0], localStorage.getItem('pool:wood') ?? WOODS[0], false);
    this.options = new TableOptions(rules => this.reset(rules));
    this.buildThemePanel();
    this.wire(canvas);
    new ResizeObserver(entries => {
      const bar = entries[0].target.getBoundingClientRect();
      document.documentElement.style.setProperty('--below-header', `${bar.bottom + 12}px`);
    }).observe(document.querySelector('.topbar')!);
    this.scene.onFrame(() => this.frame());
    try {
      if (localStorage.getItem('pool:seen')) document.getElementById('hint')?.classList.add('gone');
    } catch { /* private mode */ }
    this.hud();
  }

  reset(rules: MatchConfig = this.gs.rules): void {
    if (this.room) return;
    this.gs = newGame((Math.random() * 1e9) | 0, rules);
    this.cameraShotPending=false;this.scene.cameraRig.cancel();
    this.mode = 'aim'; this.pulling = false; this.pressPt = null;
    this.angle=this.targetAngle=0;
    this.lastPotted = 0; this.lastSpeed.clear(); this.calledBall = this.calledPocket = null;
    this.options.write(rules); this.hud();
  }

  cue(): Ball { return this.gs.balls[0]; }

  applyTheme(felt: string, wood: string, save = true): void {
    this.scene.setTheme(felt, wood);
    if (save) {
      localStorage.setItem('pool:felt', felt);
      localStorage.setItem('pool:wood', wood);
    }
    for (const [id, list, cur] of [['feltsw', FELTS, felt], ['woodsw', WOODS, wood]] as Array<[string, string[], string]>) {
      const box = this.el[id];
      box.innerHTML = '';
      for (const c of list) {
        const d = document.createElement('button');
        d.setAttribute('aria-label', `${id === 'feltsw' ? 'Felt' : 'Rails'} ${c}`);
        d.className = 'swatch' + (c.toLowerCase() === cur.toLowerCase() ? ' sel' : '');
        d.style.background = c;
        d.addEventListener('click', () => {
          const f = id === 'feltsw' ? c : localStorage.getItem('pool:felt') ?? FELTS[0];
          const w = id === 'woodsw' ? c : localStorage.getItem('pool:wood') ?? WOODS[0];
          this.applyTheme(f, w);
        });
        box.appendChild(d);
      }
    }
    (this.el.feltcustom as HTMLInputElement).value = felt;
    (this.el.woodcustom as HTMLInputElement).value = wood;
  }

  buildThemePanel(): void {
    const cueSelect=document.getElementById('cueappearance') as HTMLSelectElement;
    let savedCue:string|null=null;try{savedCue=localStorage.getItem('pool:cue-style');}catch{}
    cueSelect.value=cueStyle(savedCue);this.scene.setCueStyle(cueStyle(savedCue));
    cueSelect.addEventListener('change',()=>{const style=cueStyle(cueSelect.value);this.scene.setCueStyle(style);try{localStorage.setItem('pool:cue-style',style);}catch{}});
    const railSelect = document.getElementById('railsights') as HTMLSelectElement;
    railSelect.value = sightStyle(localStorage.getItem('pool:sights'));
    this.scene.setSights(sightStyle(railSelect.value));
    railSelect.addEventListener('change', () => {
      const style = sightStyle(railSelect.value); this.scene.setSights(style); localStorage.setItem('pool:sights', style);
    });
    this.applyTheme(localStorage.getItem('pool:felt') ?? FELTS[0], localStorage.getItem('pool:wood') ?? WOODS[0], false);
    (this.el.feltcustom as HTMLInputElement).addEventListener('input', (e) => {
      this.applyTheme((e.target as HTMLInputElement).value, localStorage.getItem('pool:wood') ?? WOODS[0]);
    });
    (this.el.woodcustom as HTMLInputElement).addEventListener('input', (e) => {
      this.applyTheme(localStorage.getItem('pool:felt') ?? FELTS[0], (e.target as HTMLInputElement).value);
    });
  }

  canShoot(): boolean {
    if (this.mode !== 'aim' || this.gs.winner !== null) return false;
    if (this.room && this.seat !== this.gs.current) return false;
    return true;
  }

  /** Human may act only on their own turn (AI turns are driven by aiMove). */
  humanTurn(): boolean {
    if(this.cameraMode || this.cameraGesture)return false;
    if (!this.canShoot()) return false;
    if (this.aiOpponent && this.gs.current === 1) return false;
    return true;
  }

  pullPower(): number {
    if (!this.pulling || !this.pressPt || !this.hoverPt) return 0;
    const d = Math.hypot(this.hoverPt[0] - this.pressPt[0], this.hoverPt[1] - this.pressPt[1]);
    return Math.min(1, d / PULL_FULL);
  }

  frameBalls(whole=false): void {
    const eligible=legalTargets(this.gs);
    const targets=this.gs.balls.filter(b=>!b.potted&&b.n!==null&&eligible.includes(b.n));
    const points=this.gs.balls.filter(b=>!b.potted&&(whole||b.n===null||eligible.includes(b.n))).map(b=>({x:b.x,y:b.y}));
    if(whole || this.gs.ballInHand) {
      const edge=whole||this.gs.placement!=='kitchen'?TABLE_W:TABLE_W/4;
      for(const x of [0,edge])for(const y of [0,TABLE_H])points.push({x,y});
    }
    const facing=this.scene.cameraRig.frame(points,!whole&&!this.gs.ballInHand&&!this.cue().potted?this.cue():undefined,targets);
    if(facing!==undefined&&this.humanTurn()&&!this.pulling)
      this.targetAngle=Math.atan2(-Math.cos(facing),-Math.sin(facing));
  }

  setSpin(x: number, y: number): void {
    const scale=Math.min(1,.55/(Math.hypot(x,y)||1));
    this.tipX=x*scale;this.tipY=y*scale;
    const spin=this.el.spin;
    spin.style.setProperty('--tx',`${this.tipX/.55*38}%`);
    spin.style.setProperty('--ty',`${-this.tipY/.55*38}%`);
    const centered=Math.hypot(this.tipX,this.tipY)<1e-9;
    (document.getElementById('resetspin') as HTMLButtonElement).disabled=centered;
    const horizontal=Math.abs(this.tipX)<.001?'no sidespin':`${Math.round(Math.abs(this.tipX)/.55*100)}% ${this.tipX<0?'left':'right'}`;
    const vertical=Math.abs(this.tipY)<.001?'center height':`${Math.round(Math.abs(this.tipY)/.55*100)}% ${this.tipY<0?'backspin':'topspin'}`;
    spin.setAttribute('aria-label',`Cue ball spin control: ${centered?'centered':horizontal+', '+vertical}`);
  }

  wire(canvas: HTMLCanvasElement): void {
    const aimAt = (cx: number, cy: number) => {
      if (this.mode === 'place') {
        this.placeX = cx; this.placeY = cy;
        return;
      }
      if (this.mode !== 'aim' || this.cue().potted) return;
      const c = this.cue();
      const dx = cx - c.x, dy = cy - c.y;
      if (Math.hypot(dx, dy) > 0.02) this.targetAngle = Math.atan2(dy, dx);
    };
    const tryPlace = (cx: number, cy: number) => {
      if (this.room) {
        if (this.seat === this.gs.current) this.room.place(cx, cy);
      } else if (placeCue(this.gs, cx, cy)) {
        this.mode = 'aim';
        if(this.options.autoCamera)this.frameBalls();
      }
      this.hud();
    };
    canvas.addEventListener('pointermove', (e) => {
      if (this.cameraMode || this.cameraGesture || this.pointers.size > 1) return;
      if (e.pointerType === 'mouse' && e.buttons !== 0 && e.buttons !== 1) return;
      const p = this.scene.pickFelt(e.clientX, e.clientY);
      if (!p) return;
      this.hoverPt = p;
      if (!this.pulling) aimAt(p[0], p[1]); // aim locks once the pull starts
    });
    canvas.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      this.pointers.add(e.pointerId);
      if(this.cameraMode || this.pointers.size>1){this.cameraGesture=true;this.pulling=false;this.pressPt=null;this.placementPress=null;return;}
      if(this.cameraGesture)return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = this.scene.pickFelt(e.clientX, e.clientY);
      if (!p) return;
      if (this.mode === 'place') {
        this.placeX = p[0]; this.placeY = p[1];
        this.placementPress=[e.clientX,e.clientY];
        return;
      }
      if (this.humanTurn() && callRequired(this.gs) && this.calledPocket === null) {
        const distances = POCKETS.map(q => Math.hypot(q.x - p[0], q.y - p[1]));
        const pocket = distances.indexOf(Math.min(...distances));
        if (distances[pocket] < .20) { this.calledPocket = pocket; this.hud(); }
        return;
      }
      if (this.mode === 'aim' && !this.cue().potted) {
        const c = this.cue();
        const dx = p[0] - c.x, dy = p[1] - c.y;
        if (Math.hypot(dx, dy) > 0.02) this.targetAngle = Math.atan2(dy, dx);
      }
      if (this.humanTurn()) {
        this.pulling = true;
        this.pressPt = p;
        this.hoverPt = p;
      }
    });
    const cancelPull = () => { this.pulling = false; this.pressPt = null; };
    this.scene.controls.addEventListener('start',()=>{cancelPull();this.placementPress=null;});
    canvas.addEventListener('pointerup', (e) => {
      this.pointers.delete(e.pointerId);
      if(this.cameraMode || this.cameraGesture){cancelPull();this.placementPress=null;if(!this.pointers.size)this.cameraGesture=false;return;}
      if(this.placementPress){const start=this.placementPress;this.placementPress=null;if(Math.hypot(e.clientX-start[0],e.clientY-start[1])<12){const p=this.scene.pickFelt(e.clientX,e.clientY);if(p)tryPlace(...p);}return;}
      if (!this.pulling) return;
      if (e.pointerType === 'mouse' && e.button !== 0) { cancelPull(); return; }
      const power = Math.max(0.04, this.pullPower());
      cancelPull();
      if (!this.humanTurn()) return;
      this.fire(power);
    });
    canvas.addEventListener('pointercancel', e => { this.pointers.delete(e.pointerId); cancelPull(); });
    const releasePointer=(e:PointerEvent)=>{this.pointers.delete(e.pointerId);if(!this.pointers.size){this.cameraGesture=false;this.placementPress=null;}};
    addEventListener('pointerup',releasePointer);addEventListener('pointercancel',releasePointer);
    canvas.addEventListener('pointerleave', cancelPull);
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest('input,select,button,textarea')) return;
      if(this.cameraMode)return;
      if (e.code === 'ArrowLeft') this.targetAngle += 0.03;
      if (e.code === 'ArrowRight') this.targetAngle -= 0.03;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat && this.humanTurn()) this.fire(0.4);
      }
    });
    addEventListener('keyup', (_e) => { /* space fires on keydown */ });
    const spin = this.el.spin;
    const setTip = (e: PointerEvent) => {
      const r=spin.getBoundingClientRect();
      this.setSpin(Math.max(-.55,Math.min(.55,((e.clientX-r.left)/r.width-.5)*1.1)),Math.max(-.55,Math.min(.55,(.5-(e.clientY-r.top)/r.height)*1.1)));
    };
    spin.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse' && e.button!==0)return;
      e.stopPropagation();spin.setPointerCapture(e.pointerId);setTip(e);
    });
    spin.addEventListener('pointermove',e=>{if(spin.hasPointerCapture(e.pointerId))setTip(e);});
    spin.addEventListener('keydown',e=>{
      const step=e.shiftKey ? .005 : .025;
      const keys:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,step],ArrowDown:[0,-step]};
      if(keys[e.key]){e.preventDefault();e.stopPropagation();this.setSpin(this.tipX+keys[e.key][0],this.tipY+keys[e.key][1]);}
      else if(e.key==='Home'||e.key==='0'){e.preventDefault();e.stopPropagation();this.setSpin(0,0);}
    });
    document.getElementById('resetspin')!.addEventListener('click',()=>this.setSpin(0,0));
    const view=document.getElementById('viewpanel')!,viewButton=document.getElementById('viewbtn')!;
    const closeView=()=>{view.classList.remove('open');viewButton.setAttribute('aria-expanded','false');};
    const setCameraMode=(enabled:boolean)=>{
      this.cameraMode=enabled;cancelPull();this.placementPress=null;this.scene.cameraRig.setMode(enabled);
      const button=document.getElementById('cameramode')!;button.setAttribute('aria-pressed',String(enabled));button.textContent=enabled?'Return to play':'Move camera';
      viewButton.classList.toggle('on',enabled);viewButton.textContent=enabled?'Camera':'View';
      if(enabled)closeView();
    };
    viewButton.addEventListener('click',()=>{
      const open=!view.classList.contains('open');view.classList.toggle('open',open);viewButton.setAttribute('aria-expanded',String(open));
      for(const id of ['helppanel','settingspanel','onlinepanel'])document.getElementById(id)!.classList.remove('open');
      document.getElementById('helpbtn')!.setAttribute('aria-expanded','false');
    });
    document.getElementById('cameramode')!.addEventListener('click',()=>setCameraMode(!this.cameraMode));
    document.getElementById('focusballs')!.addEventListener('click',()=>{closeView();this.scene.cameraRig.cancel(true);this.frameBalls();});
    document.getElementById('wholetable')!.addEventListener('click',()=>{closeView();this.scene.cameraRig.cancel(true);this.frameBalls(true);});
    document.getElementById('zoomin')!.addEventListener('click',()=>this.scene.cameraRig.zoom(.8));
    document.getElementById('zoomout')!.addEventListener('click',()=>this.scene.cameraRig.zoom(1.25));
    document.getElementById('autocamera')!.addEventListener('change',()=>{if(!this.options.autoCamera)this.scene.cameraRig.cancel();});
    for(const id of ['helpbtn','settingsbtn','onlinebtn'])document.getElementById(id)!.addEventListener('click',closeView);
    addEventListener('keydown',e=>{if(e.key==='Escape'){closeView();if(this.cameraMode)setCameraMode(false);}});
    this.el.onlinebtn.addEventListener('click', () => {
      this.el.onlinepanel.classList.toggle('open');
      this.el.settingspanel.classList.remove('open');
    });
    this.el.settingsbtn.addEventListener('click', () => {
      this.el.settingspanel.classList.toggle('open');
      this.el.onlinepanel.classList.remove('open');
    });
    this.el.createbtn.addEventListener('click', () => this.connectRoom(true));
    this.el.joinbtn.addEventListener('click', () => this.connectRoom(false));
    document.getElementById('callball')!.addEventListener('change', e => { this.calledBall = Number((e.target as HTMLSelectElement).value); this.calledPocket = null; this.hud(); });
    document.getElementById('clearcall')!.addEventListener('click', () => { this.calledPocket = null; this.hud(); });
    this.el.rack.addEventListener('click', () => this.reset());
    this.el.aibtn.addEventListener('click', () => {
      if (this.room) return;
      this.aiOpponent = !this.aiOpponent;
      this.el.aibtn.textContent = this.aiOpponent ? 'AI: on' : 'Play vs AI';
      this.el.aibtn.classList.toggle('on', this.aiOpponent);
      this.reset();
    });
  }

  fire(power: number, vmax = this.gs.breakShot ? this.gs.rules.breakMax : this.gs.rules.normalMax): void {
    if (!this.canShoot()) return;
    document.querySelector('.hint')?.classList.add('gone');
    try { localStorage.setItem('pool:seen', '1'); } catch { /* private mode */ }
    const c = this.cue();
    if (c.potted) return;
    if (callRequired(this.gs) && (this.calledBall === null || this.calledPocket === null)) {
      this.el.msg.textContent = 'Choose a ball and tap its destination pocket before shooting'; return;
    }
    this.power = power;
    const elevation = cueElevation(c.x, c.y, this.angle, 0, this.gs.balls);
    beginShot(this.gs, this.calledBall, this.calledPocket);
    const params = { aim: this.angle, power, tipX: this.tipX, tipY: this.tipY, vmax, elevation, calledBall: this.calledBall, calledPocket: this.calledPocket };
    strike(c, Math.cos(this.angle), Math.sin(this.angle), power, this.tipX, this.tipY, vmax, elevation);
    this.ev = freshEv();
    this.contact = { v: false };
    this.whoShot = this.seat;
    this.mode = 'rolling';
    this.cameraShotPending=true;this.cameraShotRevision=this.scene.cameraRig.revision; this.lastT = 0; this.accumulator = 0;
    if (this.room) this.room.shot(params);
    this.hud();
  }

  aiMove(): void {
    const aiSeat = this.aiOpponent ? 1 : -1;
    if (aiSeat < 0 || this.gs.current !== aiSeat) return;
    if (this.gs.ballInHand) {
      let placed = false;
      for (let x = .15; x < TABLE_W && !placed; x += .1) for (let y = .15; y < TABLE_H && !placed; y += .1) placed = placeCue(this.gs, x, y);
      if (!placed) return;
      this.mode = 'aim';
    }
    const targets = legalTargets(this.gs).filter(n => !this.gs.kitchenShot || this.gs.balls.find(b => b.n === n)!.x >= TABLE_W / 4);
    const shot = (this.gs.breakShot ? breakShot(this.gs.balls) : chooseShot(this.gs.balls, targets, 'medium'))
      ?? breakShot(this.gs.balls);
    this.angle = shot.angle;
    this.targetAngle = shot.angle;
    this.power = shot.power;
    this.setSpin(shot.tipX, shot.tipY);
    this.calledBall = shot.ball ?? targets[0] ?? null; this.calledPocket = shot.pocket ?? 0;
    this.fire(shot.power);
  }

  frame(): void {
    const fnow = performance.now();
    const fdt = this.lastFrame ? Math.min((fnow - this.lastFrame) / 1000, 0.1) : 0.016;
    this.lastFrame = fnow;
    let ballDt = fdt;
    for (const b of this.gs.balls) {
      if (b.potted) continue;
      const v = Math.hypot(b.vx, b.vy);
      const last = this.lastSpeed.get(b.id) ?? v;
      const drop = last - v;
      if (drop > 0.6 && v > 0.2) {
        const nearRail = b.x < 0.09 || b.x > TABLE_W - 0.09 || b.y < 0.09 || b.y > TABLE_H - 0.09;
        if (nearRail && drop > 1.2) this.sfx.thud(drop / 8);
        else this.sfx.click(drop / 6);
      }
      this.lastSpeed.set(b.id, v);
    }
    if ((this.mode === 'aim' || this.mode === 'place') && this.aiOpponent && this.gs.current === 1 && this.gs.winner === null && !this.room) {
      this.aiTimer += 1 / 60;
      if (this.aiTimer > 1.2) {
        this.aiTimer = 0;
        this.aiMove();
      }
    } else {
      this.aiTimer = 0;
    }
    if (this.mode === 'rolling') {
      const now = performance.now();
      if (!this.lastT) this.lastT = now;
      const elapsed = Math.min((now - this.lastT) / 1000, .25);
      this.lastT = now;
      const playback = advancePlayback(this.gs.balls,this.ev,this.contact,this.accumulator+elapsed,this.options.fastForward);
      this.accumulator = playback.remaining;
      ballDt = playback.simulated;
      const badge=document.getElementById('playbackstate')!;
      const caption=playback.accelerated ? 'Fast-forwarding · 4×' : '';
      if(badge.textContent!==caption)badge.textContent=caption;
      if (allAsleep(this.gs.balls)) {
        if (this.room && this.whoShot === this.seat) {
          this.room.done(
            this.gs.balls.map((b) => ({ id: b.id, n: b.n, x: b.x, y: b.y, potted: b.potted })),
            {
              first_contact: this.ev.firstContact, potted: this.ev.potted,
              off_table: this.ev.offTable, rail_after_contact: this.ev.railAfterContact,
              cue_potted: this.ev.cuePotted,
            },
          );
          this.mode = 'wait';
        } else if (!this.room) {
          applyShot(this.gs, this.ev);
          this.calledBall = this.calledPocket = null;
          this.mode = this.gs.winner !== null ? 'over' : this.gs.ballInHand ? 'place' : 'aim';
        } else {
          this.mode = 'wait';
        }
        this.hud();
      }
    }
    if (this.mode !== 'rolling') {
      document.getElementById('playbackstate')!.textContent='';
      // Results and following shots can arrive before this client's slower playback.
      while(this.pendingNetwork.length) {
        this.pendingNetwork.shift()!();
        if ((this.mode as Mode) === 'rolling') break;
      }
    }
    if(this.cameraShotPending && this.mode!=='rolling' && this.mode!=='wait') {
      this.cameraShotPending=false;
      if(this.options.autoCamera && !this.cameraMode && !this.pulling && !this.pointers.size && this.cameraShotRevision===this.scene.cameraRig.revision)this.frameBalls();
    }
    const potted=this.gs.balls.filter(b=>b.potted).length;
    if(potted>this.lastPotted)this.sfx.pot();
    this.lastPotted=potted;
    const liveFacts=JSON.stringify([this.mode,this.ev.potted,this.ev.cuePotted,this.ev.offTable,this.ev.firstContact,this.ev.railAfterContact]);
    if(liveFacts!==this.lastLiveFacts) {
      this.lastLiveFacts=liveFacts;this.renderScorecard();
      if(this.mode==='rolling' && (this.ev.potted.length || this.ev.cuePotted))this.el.msg.textContent=this.ev.cuePotted?'Scratch · balls still rolling':`Pocketed ${this.ev.potted.join(', ')} · balls still rolling`;
    }
    const returnOrder = [...new Set([...this.gs.returnOrder, ...(this.mode === 'rolling' || this.mode === 'wait' ? this.ev.potted : [])])].filter(n => this.gs.balls.some(b => b.n === n && b.potted));
    this.scene.setBalls(this.gs.balls, ballDt, returnOrder, fdt);
    // Ease aim toward target (kills mouse jitter twitch), frame-rate independent.
    {
      let d = this.targetAngle - this.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.angle += d * Math.min(1, fdt * 14);
    }
    const aiming = this.mode === 'aim' && !this.cue().potted;
    const pulling = this.pulling && aiming;
    const pull = pulling ? 0.02 + this.pullPower() * 0.18 : 0.02 + this.power * 0.1;
    this.scene.setCall(this.calledPocket, aiming && callRequired(this.gs));
    this.scene.setCue(aiming, this.cue().x, this.cue().y, this.angle, pull, this.tipX, this.tipY);
    (this.el.chargefill as HTMLElement).style.width = pulling ? `${this.pullPower() * 100}%` : '0%';
    this.scene.setKitchen((this.mode === 'place' && this.gs.placement === 'kitchen') || (aiming && this.gs.kitchenShot), aiming);
    if (this.mode === 'place') {
      this.scene.setPlace(true, this.placeX, this.placeY, canPlace(this.gs, this.placeX, this.placeY), this.gs.placement);
    } else {
      this.scene.setPlace(false, 0, 0, false);
    }
  }

  playerName(seat:number): string {
    return this.roomNames?.[seat] ?? (seat===1 && this.aiOpponent && !this.room ? 'AI' : `Player ${seat+1}`);
  }

  hud(): void {
    let msg = this.gs.message;
    if (this.mode === 'place') msg += ' — tap a green spot to place the cue ball';
    else if (this.mode === 'rolling') msg = `Player ${this.gs.current + 1} · shot in motion`;
    else if (this.mode === 'wait' && this.room) msg += ' — waiting…';
    else if (this.room && this.seat !== null && this.seat !== this.gs.current && this.mode === 'aim') msg += ' — opponent aiming…';
    if(msg.startsWith('Illegal break'))msg += ' · no ball pocketed and fewer than four object balls reached a rail';
    this.el.msg.textContent = msg.replace(/\bPlayer ([12])\b/g,(_,seat)=>this.playerName(Number(seat)-1));
    this.el.turn.textContent = this.gs.winner !== null ? 'Game over' : this.playerName(this.gs.current);
    this.el.turn.classList.toggle('me', !this.room || this.seat === this.gs.current);
    this.el.roominfo.textContent = this.room ? `room ${this.room.code} · you P${(this.seat ?? 0) + 1}` : 'solo table';
    this.options.summary(this.gs.rules);
    const needCall = this.mode === 'aim' && this.humanTurn() && callRequired(this.gs);
    document.getElementById('callpanel')!.hidden = !needCall;
    if (needCall) {
      const targets = legalTargets(this.gs);
      if (this.calledBall === null || !targets.includes(this.calledBall)) this.calledBall = targets[0] ?? null;
      const select = document.getElementById('callball') as HTMLSelectElement;
      select.replaceChildren(...targets.map(n => new Option(`Ball ${n}`, String(n), false, n === this.calledBall)));
      document.getElementById('callstatus')!.textContent = this.calledPocket === null ? 'Tap a pocket on the table' : `Pocket called · ready to shoot`;
    }
    for (const id of ['rack', 'aibtn']) (this.el[id] as HTMLButtonElement).disabled = !!this.room;
    this.renderScorecard();
  }

  renderScorecard(): void {
    const box = this.el.scorecard;
    box.innerHTML = '';
    const live=this.mode==='rolling' || this.mode==='wait';
    let displayedGroups=this.gs.groups;
    if(live && this.gs.open && this.gs.shot && this.ev.potted.length) {
      const preview:GameState={...this.gs,groups:[...this.gs.groups],returnOrder:[...this.gs.returnOrder],balls:this.gs.balls.map(b=>({...b}))};
      applyShot(preview,this.ev,this.gs.shot);
      displayedGroups=preview.groups;
    }
    for (const i of [0, 1]) {
      const g = displayedGroups[i];
      const provisional=this.gs.groups[i]!==g;
      const card = document.createElement('div');
      card.className = 'pcard' + (provisional ? ' provisional' : '') + (this.gs.current === i && this.gs.winner === null ? ' active' : '');
      const head = document.createElement('div');
      head.className = 'pname';
      const label = g === 'solid' ? 'Solids' : 'Stripes';
      head.innerHTML = '';
      const nm = document.createElement('span');
      nm.textContent = this.playerName(i);
      const gr = document.createElement('span');
      gr.className = 'grp';
      const nums = g !== null && GROUP_BALLS[g] ? [...GROUP_BALLS[g]] : [];
      const onEight = !this.gs.open && g !== null && !this.gs.balls.some(
        (b) => !b.potted && b.n !== null && b.n !== 8 && GROUP_BALLS[g]?.includes(b.n),
      );

      const left = nums.filter((n) => !this.gs.balls.find((q) => q.n === n)?.potted).length;
      gr.textContent = g === null ? 'Open table · groups unassigned' : onEight ? 'On the 8-Ball' : `${label} · ${left} remaining`;
      if(provisional)gr.textContent = `${label} · pending shot result`;
      if(g!==null)nums.push(8);
      head.appendChild(nm);
      head.appendChild(gr);
      card.appendChild(head);
      const row = document.createElement('div');
      row.className = 'balls';
      for (const n of nums) {
        const b = this.gs.balls.find((q) => q.n === n);
        const d = document.createElement('div');
        d.className = 'pball' + (b?.potted ? ' potted' : '') + (n===8 ? ' eight-ball'+(onEight?' ready':'') : '');
        d.style.background = ballCss(n);
        d.title = n===8 ? `8-Ball · ${b?.potted?'pocketed':onEight?'your final ball':'clear your group first'}` : `Ball ${n}${b?.potted ? ' · pocketed' : ' · remaining'}`;
        d.setAttribute('aria-label',d.title);
        const number = document.createElement('span');
        number.textContent = String(n);
        d.appendChild(number);
        row.appendChild(d);
      }
      card.appendChild(row);
      if(live && i === (this.gs.shot?.current ?? this.gs.current) && (this.ev.potted.length || this.ev.cuePotted)) {
        const pots=document.createElement('div');pots.className='live-pots';
        pots.textContent=`This shot: ${this.ev.potted.length ? this.ev.potted.join(' · ') : 'no object balls'}${this.ev.cuePotted ? ' · scratch' : ''}`;
        card.appendChild(pots);
      }
      box.appendChild(card);
    }
  }

  applyServerState(s: RoomState): void {
    const wasPlacing=this.gs.ballInHand;
    for (const sb of s.balls) {
      const b = this.gs.balls.find((q) => q.id === sb.id);
      if (!b) continue;
      b.n = sb.n; b.z = b.vz = 0;
      b.x = sb.x; b.y = sb.y; b.potted = sb.potted;
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      b.asleep = true;
    }
    this.gs.current = s.current === 1 ? 1 : 0;
    this.gs.groups = [(s.groups[0] ?? null) as never, (s.groups[1] ?? null) as never];
    this.gs.returnOrder = s.return_order ?? [];
    this.gs.open = s.open;
    this.gs.breakShot = s.break_shot; this.gs.placement = s.placement; this.gs.kitchenShot = s.kitchen_shot; this.gs.rules = s.rules;
    this.calledBall = this.calledPocket = null; delete this.gs.shot;
    this.options.write(s.rules, true);
    this.gs.ballInHand = s.ball_in_hand;
    this.gs.winner = s.winner === 1 ? 1 : s.winner === 0 ? 0 : null;
    this.gs.message = s.message;
    this.mode = s.winner !== null ? 'over' : s.ball_in_hand && s.current === this.seat ? 'place' : 'aim';
    this.pulling = false; this.pressPt = null;
    if(wasPlacing&&!s.ball_in_hand&&s.winner===null&&this.options.autoCamera&&!this.cameraMode)this.frameBalls();
    this.lastPotted = this.gs.balls.filter((b) => b.potted).length;
    this.lastSpeed.clear();
    this.hud();
  }

  connectRoom(create: boolean): void {
    const name = ((this.el.pname as HTMLInputElement).value || 'Player').slice(0, 24);
    const code = (this.el.rcode as HTMLInputElement).value.trim().toUpperCase();
    if (!create && code.length !== 4) {
      this.el.msg.textContent = 'enter a 4-letter room code to join';
      return;
    }
    const rc = new RoomClient();
    this.room = rc;
    this.seat = null;
    const handleState = (s: RoomState) => {
      if (this.seat === null && rc.seat !== null) this.seat = rc.seat;
      this.applyServerState(s);
    };
    rc.onState = s => { if(this.mode==='rolling' || this.pendingNetwork.length)this.pendingNetwork.push(()=>handleState(s)); else handleState(s); };
    const handleShot: typeof rc.onShot = (by, shot) => {
      if (by === this.seat) return;
      const c = this.cue();
      if (c.potted) return;
      beginShot(this.gs, shot.calledBall, shot.calledPocket);
      // Server is authoritative on break speed; ignore client-claimed vmax.
      const vmax = this.gs.breakShot ? this.gs.rules.breakMax : this.gs.rules.normalMax;
      strike(c, Math.cos(shot.aim), Math.sin(shot.aim), shot.power, shot.tipX, shot.tipY, vmax, shot.elevation ?? 0);
      this.ev = freshEv();
      this.contact = { v: false };
      this.whoShot = by;
      this.mode = 'rolling';
      this.cameraShotPending=true;this.cameraShotRevision=this.scene.cameraRig.revision; this.lastT = 0; this.accumulator = 0;
      this.hud();
    };
    rc.onShot = (by,shot) => { if(by===this.seat)return; if(this.mode==='rolling' || this.pendingNetwork.length)this.pendingNetwork.push(()=>handleShot(by,shot)); else handleShot(by,shot); };
    rc.onError = (e) => { this.el.msg.textContent = `net: ${e}`; };
    rc.onJoined = (names) => { this.roomNames = names; this.hud(); };
    rc.onOpen = () => (create ? rc.create(name, this.gs.rules) : rc.join(code, name));
    rc.connect();
    this.el.onlinepanel.classList.remove('open');
  }
}
