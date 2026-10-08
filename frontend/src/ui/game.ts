import type { PerspectiveCamera } from 'three';
import { animateOpponentCue, cuePresentation, freezeShot, type SelectedShot, type CuePhase } from './opponentCue';
import { Tutorial, type TutorialAction } from './tutorial';
import { practiceTable } from './tutorialPractice';
import { framePose } from '../render/cameraRig';
import { AccountPanel, type Account } from './account';
import { cueStyle } from '../render/ballTextures';
import { advancePlayback } from './playback';
import { sightStyle } from '../render/railSights';
import { cueElevation } from '../sim/cue';
import { type MatchConfig } from '../sim/config';
import { TableOptions } from './tableOptions';
import { allAsleep, strike, type Ball, type ShotEvents } from '../sim/physics';
import { applyShot, beginShot, callRequired, canPlace, legalTargets, newGame, placeCue, type GameState } from '../sim/rules';
import { planCpuTurn } from '../sim/cpu';
import { jevRequest } from '../sim/jev';
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
  tutorial = new Tutorial();
  gs: GameState;
  options: TableOptions;
  calledBall: number | null = null;
  calledPocket: number | null = null;
  accumulator = 0;
  pointers = new Set<number>();
  touchAim=false;
  scoresExpanded=false;
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
  cpuOpponent = false;
  jevOpponent = false;
  jevRequest: AbortController | null = null;
  jevGame: {id:string;revision:number} | null = null;
  jevPlayback = false;
  account:Account|null=null;
  accountPanel:AccountPanel;
  cpuTimer = 0;
  opponentGeneration=0;
  opponentAction:{controller:AbortController;shot:Readonly<SelectedShot>|null;elapsed:number;phase:CuePhase;reduced:boolean}|null=null;
  humanPower=50;
  private restorePractice:(()=>void)|null=null;
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
        'roominfo', 'chargefill', 'spin', 'cpubtn', 'jevbtn', 'opponentstatus', 'rack', 'settingsbtn', 'settingspanel',
        'feltsw', 'woodsw', 'feltcustom', 'woodcustom', 'scorecard'].map((id) => [id, document.getElementById(id)!]),
    );
    this.applyTheme(localStorage.getItem('pool:felt') ?? FELTS[0], localStorage.getItem('pool:wood') ?? WOODS[0], false);
    this.options = new TableOptions(rules => this.reset(rules));
    this.buildThemePanel();
    this.wire(canvas);
    this.accountPanel=new AccountPanel(()=>!!this.room,account=>{
      this.account=account;
      if (!account && this.jevOpponent) {
        this.cancelOpponent();
        this.jevRequest?.abort(); this.jevRequest=null;this.jevGame=null;
        this.jevOpponent=false; this.cpuOpponent=true;
        this.el.jevbtn.classList.remove('on');this.el.jevbtn.setAttribute('aria-pressed','false');
        this.el.cpubtn.classList.add('on');this.el.cpubtn.setAttribute('aria-pressed','true');
        this.el.cpubtn.textContent='CPU: on';
        this.el.opponentstatus.textContent='Signed out · switched to CPU';
      }
      const input=this.el.pname as HTMLInputElement;input.disabled=!!account;
      if(account)input.value=account.username;
      document.getElementById('onlineidentity')!.textContent=account?`Signed in as ${account.username}. Private matches count toward unranked casual stats.`:'Playing as a guest. Create an account to keep lifetime online stats.';
    });
    const invitation=new URLSearchParams(location.hash.slice(1)).get('join')??new URLSearchParams(location.search).get('join');
    if(invitation&&/^[A-Z2-9]{8}$/i.test(invitation)){
      (this.el.rcode as HTMLInputElement).value=invitation.toUpperCase();
      this.el.onlinepanel.classList.add('open');document.getElementById('helppanel')!.classList.remove('open');
      this.el.roominfo.textContent='You are invited. Choose a name and join—no account needed.';
    }
    new ResizeObserver(entries => {
      const bar = entries[0].target.getBoundingClientRect();
      document.documentElement.style.setProperty('--below-header', `${bar.bottom + 12}px`);
      document.documentElement.style.setProperty('--below-scores',`${this.el.scorecard.getBoundingClientRect().bottom+6}px`);
    }).observe(document.querySelector('.topbar')!);
    new ResizeObserver(()=>{
      document.documentElement.style.setProperty('--below-scores',`${this.el.scorecard.getBoundingClientRect().bottom+6}px`);
    }).observe(this.el.scorecard);
    new ResizeObserver(()=>{
      const tray=document.querySelector('.control-tray')!.getBoundingClientRect();
      document.documentElement.style.setProperty('--above-controls',`${innerHeight-tray.top+12}px`);
    }).observe(document.querySelector('.control-tray')!);
    this.scene.onFrame(() => this.frame());
    try {
      if (localStorage.getItem('pool:seen')) document.getElementById('hint')?.classList.add('gone');
    } catch { /* private mode */ }
    this.hud();
    this.tutorial.bind({begin:()=>this.beginPractice(),stage:action=>this.stagePractice(action),
      end:()=>{this.restorePractice?.();this.restorePractice=null;},frame:()=>this.framePractice()});
  }

  beginPractice():boolean {
    if(this.room||this.jevGame||this.jevRequest||this.opponentAction||this.mode==='rolling'||this.pulling||this.pendingNetwork.length){
      this.el.msg.textContent='Practice is available at an idle local table. Finish this shot or leave the online/Jev game first.';return false;
    }
    const saved={gs:this.gs,mode:this.mode,angle:this.angle,targetAngle:this.targetAngle,power:this.power,
      tipX:this.tipX,tipY:this.tipY,calledBall:this.calledBall,calledPocket:this.calledPocket,
      cpuOpponent:this.cpuOpponent,jevOpponent:this.jevOpponent,placeX:this.placeX,placeY:this.placeY,
      humanPower:this.humanPower,cameraMode:this.cameraMode,autoCamera:this.options.autoCamera};
    const camera=this.scene.controls.object,position=camera.position.clone(),target=this.scene.controls.target.clone();
    this.cancelOpponent();this.cpuOpponent=false;this.jevOpponent=false;this.options.autoCamera=false;
    this.cameraMode=false;this.scene.cameraRig.setMode(false);this.scene.cameraRig.setFlyInput(0,0);
    this.restorePractice=()=>{
      this.cancelOpponent();this.pendingNetwork=[];
      const {autoCamera,...fields}=saved;Object.assign(this,fields);this.options.autoCamera=autoCamera;
      this.ev=freshEv();this.contact={v:false};this.lastSpeed.clear();this.lastPotted=this.gs.balls.filter(b=>b.potted).length;
      this.scene.cameraRig.cancel();this.scene.cameraRig.setFlyInput(0,0);this.scene.cameraRig.setMode(saved.cameraMode);
      const damping=this.scene.controls.enableDamping;this.scene.controls.enableDamping=false;this.scene.controls.update();this.scene.controls.enableDamping=damping;
      camera.position.copy(position);this.scene.controls.target.copy(target);camera.lookAt(target);this.scene.controls.update();
      document.getElementById('cameramode')!.textContent=saved.cameraMode?'Aim cue':'Move camera';
      document.getElementById('cameramode')!.setAttribute('aria-pressed',String(saved.cameraMode));
      this.setSpin(saved.tipX,saved.tipY,true);
      const slider=document.getElementById('touchpower') as HTMLInputElement;slider.value=String(saved.humanPower);
      document.getElementById('touchpowerlabel')!.textContent=`Power ${saved.humanPower}%`;
      this.cameraShotPending=false;this.options.write(this.gs.rules);this.hud();
    };
    return true;
  }

  stagePractice(_action:TutorialAction):void {
    this.cancelOpponent();this.gs=practiceTable();this.mode='aim';this.pendingNetwork=[];
    this.ev=freshEv();this.contact={v:false};this.cameraShotPending=false;this.lastSpeed.clear();
    this.lastPotted=this.gs.balls.filter(b=>b.potted).length;
    this.angle=this.targetAngle=Math.atan2(-.27,-.45);this.power=.4;this.humanPower=40;
    this.calledBall=1;this.calledPocket=0;this.setSpin(0,0,true);
    const slider=document.getElementById('touchpower') as HTMLInputElement;slider.value='40';
    document.getElementById('touchpowerlabel')!.textContent='Power 40%';
    this.cameraMode=false;this.scene.cameraRig.setMode(false);this.scene.cameraRig.setFlyInput(0,0);
    document.getElementById('cameramode')!.textContent='Move camera';
    document.getElementById('cameramode')!.setAttribute('aria-pressed','false');
    this.lastTutorialCameraRevision=this.scene.cameraRig.revision;this.hud();
  }

  framePractice():void {
    if(!this.tutorial.active)return;
    const coach=document.getElementById('tutorial')!.getBoundingClientRect();
    const tray=document.querySelector('.control-tray')!.getBoundingClientRect();
    const hud=document.getElementById('camera-fly-hud')?.getBoundingClientRect();
    const top=coach.bottom+12;
    const bottom=Math.max(top+40,Math.min(innerHeight-65,tray.height?tray.top-10:Infinity,
      this.tutorial.action==='camera'&&hud?.height?hud.top-10:Infinity));
    const camera=this.scene.controls.object as PerspectiveCamera;
    const damping=this.scene.controls.enableDamping;this.scene.controls.enableDamping=false;this.scene.controls.update();this.scene.controls.enableDamping=damping;
    // Start each drill from a stable elevated view; manual camera input remains free afterward.
    camera.position.set(-1,2,1.6);this.scene.controls.target.set(-.8,0,-.25);camera.lookAt(this.scene.controls.target);
    const points=[{x:0,y:0},{x:.9,y:.54},{x:.45,y:.27}];
    const safe={left:-.8,right:.8,top:1-2*top/innerHeight,bottom:1-2*bottom/innerHeight};
    const pose=framePose(camera,this.scene.controls.target,points,safe);
    this.scene.cameraRig.cancel();this.scene.controls.target.copy(pose.target);camera.position.copy(pose.position);camera.lookAt(pose.target);this.scene.controls.update();
    this.lastTutorialCameraRevision=this.scene.cameraRig.revision;
    this.practiceCameraPose=[...camera.position.toArray(),...this.scene.controls.target.toArray()];
  }

  reset(rules: MatchConfig = this.gs.rules): void {
    if(this.tutorial.active)this.tutorial.close();
    if (this.room) return;
    this.cancelOpponent();this.pendingNetwork=[];
    this.jevRequest?.abort(); this.jevRequest = null;
    if(this.jevGame){
      this.jevGame=null;
      if(this.jevOpponent)this.cpuOpponent=false;
      this.jevOpponent=false;
      this.el.jevbtn.classList.remove('on');this.el.jevbtn.setAttribute('aria-pressed','false');
    }
    this.el.opponentstatus.textContent = '';
    this.gs = newGame((Math.random() * 1e9) | 0, rules);
    this.cameraShotPending=false;this.scene.cameraRig.cancel();
    this.mode = 'aim'; this.pulling = false; this.pressPt = null;
    this.angle=this.targetAngle=0;
    this.lastPotted = 0; this.lastSpeed.clear(); this.calledBall = this.calledPocket = null;
    this.options.write(rules); this.hud();
  }

  cancelOpponent():void {
    this.opponentGeneration++;this.opponentAction?.controller.abort();this.opponentAction=null;
    this.pulling=false;this.touchAim=false;this.pressPt=null;this.placementPress=null;this.cpuTimer=0;
  }

  humanCueControls():boolean {
    return !this.opponentAction&&!this.jevRequest&&this.gs.winner===null
      && (this.mode==='aim'||this.mode==='place')
      && (this.room?this.room.ready&&this.seat===this.gs.current:!this.cpuOpponent||this.gs.current===0);
  }

  async showOpponentShot(shot:SelectedShot,valid:()=>boolean):Promise<boolean> {
    const action=this.opponentAction;
    if(!action||!valid())return false;
    action.shot=freezeShot(shot);action.elapsed=0;action.phase='aiming';this.hud();
    const done=await animateOpponentCue(action.controller.signal,action.reduced,elapsed=>{
      if(!valid()){action.controller.abort();return;}
      action.elapsed=elapsed;
      const phase=cuePresentation(elapsed,shot.power,action.reduced).phase;
      if(phase!==action.phase){action.phase=phase;this.hud();}
    });
    return done&&valid();
  }

  beginOpponent():NonNullable<Game['opponentAction']> {
    this.pulling=false;this.touchAim=false;this.pressPt=null;this.placementPress=null;
    const action={controller:new AbortController(),shot:null,elapsed:0,phase:'planning' as CuePhase,
      reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
    this.opponentAction=action;this.hud();return action;
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
    if (this.room && (!this.room.ready || this.seat !== this.gs.current)) return false;
    return true;
  }

  /** Human may act only on their own turn (CPU turns are driven by cpuMove). */
  humanTurn(): boolean {
    if(!this.humanCueControls()||this.cameraMode || this.cameraGesture || this.scene.cameraRig.interacting)return false;
    if (!this.canShoot()) return false;
    if (this.cpuOpponent && this.gs.current === 1) return false;
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

  setSpin(x: number, y: number, internal=false): void {
    if(!internal&&!this.humanCueControls())return;
    if(!this.cpuOpponent||this.gs.current===0)this.tutorial.record('spin');
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
      if(!this.humanCueControls())return;
      if (this.mode === 'place') {
        this.placeX = cx; this.placeY = cy;
        return;
      }
      if (this.mode !== 'aim' || this.cue().potted) return;
      const c = this.cue();
      const dx = cx - c.x, dy = cy - c.y;
      if (Math.hypot(dx, dy) > 0.02) {this.targetAngle = Math.atan2(dy, dx);this.tutorial.record('aim');}
    };
    const tryPlace = (cx: number, cy: number) => {
      if(!this.humanCueControls())return;
      if (this.room) {
        if (this.seat === this.gs.current) this.room.place(cx, cy);
      } else if (placeCue(this.gs, cx, cy)) {
        this.mode = 'aim';
        if(this.options.autoCamera)this.frameBalls();
      }
      this.hud();
    };
    canvas.addEventListener('pointermove', (e) => {
      if (this.cameraMode || this.cameraGesture || this.scene.cameraRig.interacting || this.pointers.size > 1) return;
      if (e.pointerType === 'mouse' && e.buttons !== 0 && e.buttons !== 1) return;
      const p = this.scene.pickFelt(e.clientX, e.clientY);
      if (!p) return;
      this.hoverPt = p;
      if (!this.pulling && (e.pointerType === 'mouse' || this.touchAim)) aimAt(p[0], p[1]); // aim locks once the pull starts
    });
    canvas.tabIndex=0;
    canvas.setAttribute('aria-label','Pool table. Enter takes a shot; Space raises the camera, Left Shift lowers it.');
    canvas.addEventListener('pointerdown', (e) => {
      if(!document.querySelector('dialog[open]'))canvas.focus({preventScroll:true});
      this.sfx.unlock();
      this.pointers.add(e.pointerId);
      if(this.cameraMode || this.scene.cameraRig.interacting || this.pointers.size>1){this.cameraGesture=true;this.touchAim=false;this.pulling=false;this.pressPt=null;this.placementPress=null;return;}
      if(this.cameraGesture)return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if(!this.humanCueControls())return;
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
        if (Math.hypot(dx, dy) > 0.02) {this.targetAngle = Math.atan2(dy, dx);this.tutorial.record('aim');}
      }
      if (e.pointerType !== 'mouse') {
        this.touchAim=this.humanTurn();
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (this.humanTurn()) {
        this.pulling = true;
        this.pressPt = p;
        this.hoverPt = p;
      }
    });
    const cancelPull = () => { this.touchAim=false; this.pulling = false; this.pressPt = null; };
    this.scene.controls.addEventListener('start',()=>{cancelPull();this.placementPress=null;});
    canvas.addEventListener('pointerup', (e) => {
      this.pointers.delete(e.pointerId);
      this.touchAim=false;
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
    canvas.addEventListener('pointerleave', e => {if(e.pointerType==='mouse')cancelPull();});
    const touchPower=document.getElementById('touchpower') as HTMLInputElement;
    touchPower.addEventListener('input',()=>{if(!this.humanCueControls()){touchPower.value=String(this.humanPower);return;}this.humanPower=touchPower.valueAsNumber;document.getElementById('touchpowerlabel')!.textContent=`Power ${touchPower.value}%`;});
    document.getElementById('touchshoot')!.addEventListener('click',()=>{
      if(this.humanTurn()&&!this.pointers.size){this.angle=this.targetAngle;this.fire(touchPower.valueAsNumber/100);}
    });
    const toggleScores=()=>{
      if(!matchMedia('(max-width:900px)').matches)return;
      this.scoresExpanded=!this.scoresExpanded;
      this.el.scorecard.classList.toggle('expanded',this.scoresExpanded);
      for(const card of this.el.scorecard.querySelectorAll('.pcard'))card.setAttribute('aria-expanded',String(this.scoresExpanded));
    };
    matchMedia('(max-width:900px)').addEventListener('change',()=>this.renderScorecard());
    this.el.scorecard.addEventListener('click',toggleScores);
    this.el.scorecard.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();toggleScores();}
    });
    document.getElementById('morecontrols')!.addEventListener('click',()=>{
      const open=document.querySelector('.control-tray')!.classList.toggle('expanded');
      document.getElementById('morecontrols')!.setAttribute('aria-expanded',String(open));
    });
    addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]') || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if ((e.target as HTMLElement)?.closest('input,select,button,a,textarea,summary,[role="button"],[contenteditable],dialog,[role="dialog"]')) return;
      if(this.cameraMode||!this.humanCueControls())return;
      if (e.code === 'ArrowLeft') this.targetAngle += 0.03;
      if (e.code === 'ArrowRight') this.targetAngle -= 0.03;
      if (e.code === 'Enter' && document.activeElement===canvas) {
        e.preventDefault();
        if (!e.repeat && this.humanTurn()) {this.angle=this.targetAngle;this.fire(0.4);}
      }
    });
    const spin = this.el.spin;
    const setTip = (e: PointerEvent) => {
      const r=spin.getBoundingClientRect();
      this.setSpin(Math.max(-.55,Math.min(.55,((e.clientX-r.left)/r.width-.5)*1.1)),Math.max(-.55,Math.min(.55,(.5-(e.clientY-r.top)/r.height)*1.1)));
    };
    spin.addEventListener('pointerdown',e=>{
      if(!this.humanCueControls())return;
      if(e.pointerType==='mouse' && e.button!==0)return;
      e.stopPropagation();spin.setPointerCapture(e.pointerId);setTip(e);
    });
    spin.addEventListener('pointermove',e=>{if(spin.hasPointerCapture(e.pointerId))setTip(e);});
    spin.addEventListener('keydown',e=>{
      if(!this.humanCueControls())return;
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
    document.getElementById('closeonline')!.addEventListener('click',()=>{this.el.onlinepanel.classList.remove('open');this.el.onlinebtn.focus();});
    document.getElementById('leaveroom')!.addEventListener('click',()=>this.leaveRoom('Left room. You are back at a local table.'));
    document.getElementById('copyroom')!.addEventListener('click',()=>{
      const input=document.getElementById('roomlink') as HTMLInputElement;
      void navigator.clipboard.writeText(input.value).then(()=>{this.el.roominfo.textContent='Invite link copied.';}).catch(()=>{input.select();this.el.roominfo.textContent='Select and copy the invite link.';});
    });
    this.el.createbtn.addEventListener('click', () => this.connectRoom(true));
    this.el.joinbtn.addEventListener('click', () => this.connectRoom(false));
    document.getElementById('callball')!.addEventListener('change', e => { if(!this.humanCueControls())return;this.calledBall = Number((e.target as HTMLSelectElement).value); this.calledPocket = null; this.hud(); });
    document.getElementById('clearcall')!.addEventListener('click', () => { if(!this.humanCueControls())return;this.calledPocket = null; this.hud(); });
    this.el.rack.addEventListener('click', () => {
      if(this.jevGame && this.account?.premium)void this.startJev(true);
      else this.reset();
    });
    this.el.cpubtn.addEventListener('click', () => {
      if (this.room||this.tutorial.active) return;
      this.cpuOpponent = this.jevOpponent || !this.cpuOpponent;
      this.jevOpponent = false;
      this.el.jevbtn.classList.remove('on');
      this.el.cpubtn.textContent = this.cpuOpponent ? 'CPU: on' : 'Play vs CPU';
      this.el.cpubtn.classList.toggle('on', this.cpuOpponent);
      this.el.cpubtn.setAttribute('aria-pressed', String(this.cpuOpponent));
      this.el.jevbtn.setAttribute('aria-pressed', 'false');
      this.reset();
    });
    this.el.jevbtn.addEventListener('click', () => {
      if (this.room) return;
      if (!this.account) {
        this.el.opponentstatus.textContent='Sign in to play against Jev AI. CPU is available without an account.';
        document.getElementById('accountbtn')!.click();
        return;
      }
      void this.startJev();
    });
  }

  async startJev(fresh=false): Promise<void> {
    if(this.tutorial.active)return;
    if(fresh){this.cancelOpponent();this.jevRequest?.abort();this.jevRequest=null;}
    if(this.jevRequest)return;
    this.cancelOpponent();
    const controller=new AbortController();this.jevRequest=controller;
    this.el.opponentstatus.textContent=fresh?'Starting a new Jev game…':'Starting or resuming your Jev game…';
    try {
      const game=await jevRequest('/games',fresh?{new_game:true}:{},controller.signal);
      if(controller.signal.aborted||this.room)return;
      this.reset();
      this.pendingNetwork=[];
      this.jevOpponent=true;this.cpuOpponent=true;
      this.jevGame={id:game.id,revision:game.state.revision};
      this.el.jevbtn.classList.add('on');this.el.jevbtn.setAttribute('aria-pressed','true');
      this.el.cpubtn.classList.remove('on');this.el.cpubtn.setAttribute('aria-pressed','false');
      this.el.cpubtn.textContent='Play vs CPU';
      this.applyJevState(game.state);
      this.el.opponentstatus.textContent=game.expiresAt===null
        ? 'Premium · Unlimited Jev AI · New rack starts another game'
        : 'Daily Jev game · resets at midnight UTC · select Jev again to resume';
    } catch(error) {
      if(!controller.signal.aborted)this.el.opponentstatus.textContent=error instanceof Error?error.message:'Jev unavailable';
    } finally {if(this.jevRequest===controller)this.jevRequest=null;}
  }

  applyJevState(state: RoomState): void {
    this.applyServerState(state);this.roomNames=null;
    this.mode=state.winner!==null?'over':state.ball_in_hand?'place':'aim';
    if(this.jevGame)this.jevGame.revision=state.revision;
    this.hud();
  }

  async playJevTurn(power?: number): Promise<void> {
    if(!this.jevGame||this.jevRequest||this.opponentAction)return;
    const game=this.jevGame,state=this.gs,generation=this.opponentGeneration;
    const controller=new AbortController();this.jevRequest=controller;
    const opponent=power===undefined,action=opponent?this.beginOpponent():null;
    const valid=()=>!controller.signal.aborted&&this.jevGame===game&&this.gs===state
      &&this.opponentGeneration===generation&&!this.room;
    const cue=this.cue();
    const shot=opponent?undefined:{aim:this.angle,power,tipX:this.tipX,tipY:this.tipY,
      calledBall:this.calledBall,calledPocket:this.calledPocket,x:cue.x,y:cue.y};
    this.el.opponentstatus.textContent=shot?'Checking your shot…':'Jev AI is choosing a shot…';
    try {
      const result=await jevRequest(`/games/${game.id}/turn`,{revision:game.revision,shot},controller.signal);
      if(!valid())return;
      const selected=freezeShot({...result.shot,placement:result.placement});
      if(opponent && !await this.showOpponentShot(selected,valid))return;
      if(!valid())return;
      if(this.opponentAction===action)this.opponentAction=null;
      Object.assign(cue,{x:selected.placement.x,y:selected.placement.y,potted:false});
      this.gs.ballInHand=false;this.mode='aim';
      this.angle=this.targetAngle=selected.aim;
      this.calledBall=selected.calledBall;this.calledPocket=selected.calledPocket;
      this.setSpin(selected.tipX,selected.tipY,true);
      this.jevPlayback=true;
      try {this.fire(selected.power,selected.vmax,selected.elevation);} finally {this.jevPlayback=false;}
      this.pendingNetwork.push(()=>{if(valid())this.applyJevState(result.state);});
      this.el.opponentstatus.textContent=result.source==='jev'?`Jev AI selected a ${result.family??'planned'} shot`:
        result.source==='cpu-fallback'?'Jev AI unavailable or capacity reached · CPU took this shot':
        result.source==='planner'?`Jev AI · local ${result.family??'planned'} shot (no model choice needed)`:
        result.expiresAt===null?'Premium · Unlimited Jev AI':'Daily Jev game';
    } catch(error) {
      if(valid()){
        this.mode='wait';
        this.el.opponentstatus.textContent=(error instanceof Error?error.message:'Connection lost')+' Select Jev AI to resume.';
      }
    } finally {
      if(this.jevRequest===controller)this.jevRequest=null;
      if(this.opponentAction===action)this.opponentAction=null;
    }
  }

  fire(power: number, vmax = this.gs.breakShot ? this.gs.rules.breakMax : this.gs.rules.normalMax, authoritativeElevation?:number): void {
    if (!this.canShoot() || (this.tutorial.active&&this.tutorial.action!=='shot')) return;
    document.querySelector('.hint')?.classList.add('gone');
    try { localStorage.setItem('pool:seen', '1'); } catch { /* private mode */ }
    const c = this.cue();
    if (c.potted) return;
    if (callRequired(this.gs) && (this.calledBall === null || this.calledPocket === null)) {
      this.el.msg.textContent = 'Choose a ball and tap its destination pocket before shooting'; return;
    }
    // Latch the actual strike direction; pending aim smoothing must not reverse the cue.
    this.targetAngle=this.angle;
    if(this.jevGame && !this.jevPlayback){void this.playJevTurn(power);return;}
    this.power = power;
    const elevation = authoritativeElevation??cueElevation(c.x, c.y, this.angle, 0, this.gs.balls);
    beginShot(this.gs, this.calledBall, this.calledPocket);
    const params = { aim: this.angle, power, tipX: this.tipX, tipY: this.tipY, vmax, elevation, calledBall: this.calledBall, calledPocket: this.calledPocket };
    if(!this.cpuOpponent||this.gs.current===0)this.tutorial.record('shot');
    strike(c, Math.cos(this.angle), Math.sin(this.angle), power, this.tipX, this.tipY, vmax, elevation);
    this.ev = freshEv();
    this.contact = { v: false };
    this.whoShot = this.seat;
    this.mode = 'rolling';
    this.cameraShotPending=true;this.cameraShotRevision=this.scene.cameraRig.revision; this.lastT = 0; this.accumulator = 0;
    if (this.room) this.room.shot(params);
    this.hud();
  }

  async cpuMove(): Promise<void> {
    if(this.jevRequest||this.opponentAction||!this.cpuOpponent||this.gs.current!==1
      ||this.room||this.gs.winner!==null||!['aim','place'].includes(this.mode))return;
    if(this.jevGame){await this.playJevTurn();return;}
    const state=this.gs,generation=this.opponentGeneration,action=this.beginOpponent();
    const valid=()=>this.opponentAction===action&&!action.controller.signal.aborted
      &&this.gs===state&&this.opponentGeneration===generation&&this.cpuOpponent&&!this.jevGame&&!this.room;
    try {
      // Yield a frame so the genuine planning phase hides the idle human cue.
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if(!valid())return;
      const plan=planCpuTurn(state);if(!plan)return;
      const selected=freezeShot({aim:plan.angle,power:plan.power,tipX:plan.tipX,tipY:plan.tipY,
        calledBall:plan.ball,calledPocket:plan.pocket,placement:plan.placement??{x:this.cue().x,y:this.cue().y}});
      if(!await this.showOpponentShot(selected,valid))return;
      if(state.ballInHand&&!placeCue(state,selected.placement.x,selected.placement.y))return;
      this.opponentAction=null;this.mode='aim';
      this.angle=this.targetAngle=selected.aim;this.power=selected.power;
      this.setSpin(selected.tipX,selected.tipY,true);
      this.calledBall=selected.calledBall;this.calledPocket=selected.calledPocket;
      this.fire(selected.power);
    } finally {if(this.opponentAction===action)this.opponentAction=null;}
  }

  private practiceCameraPose:number[]=[];
  lastTutorialCameraRevision = 0;
  frame(): void {
    if(this.scene.cameraRig.revision!==this.lastTutorialCameraRevision){
      this.lastTutorialCameraRevision=this.scene.cameraRig.revision;
      const pose=[...this.scene.controls.object.position.toArray(),...this.scene.controls.target.toArray()];
      if(pose.some((v,i)=>Math.abs(v-this.practiceCameraPose[i])>.002))this.tutorial.record('camera');
    }
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
    if (!this.opponentAction && (this.mode === 'aim' || this.mode === 'place') && this.cpuOpponent && this.gs.current === 1 && this.gs.winner === null && !this.room) {
      this.cpuTimer += fdt;
      if (this.cpuTimer > 1.2) {
        this.cpuTimer = 0;
        void this.cpuMove();
      }
    } else {
      this.cpuTimer = 0;
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
    const presented=this.opponentAction?.shot;
    const visualBalls=presented?this.gs.balls.map(b=>b.id===0?{...b,...presented.placement,potted:false}:b):this.gs.balls;
    this.scene.setBalls(visualBalls, ballDt, returnOrder, fdt);
    // Ease aim toward target (kills mouse jitter twitch), frame-rate independent.
    {
      let d = this.targetAngle - this.angle;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.angle += d * Math.min(1, fdt * 14);
    }
    (document.getElementById('touchshoot') as HTMLButtonElement).disabled=!this.humanTurn()||this.pointers.size>0;
    const aiming = this.mode === 'aim' && !this.cue().potted && this.humanCueControls();
    const pulling = this.pulling && aiming;
    const pull = pulling ? 0.02 + this.pullPower() * 0.18 : 0.02 + this.power * 0.1;
    this.scene.setCall(this.calledPocket, aiming && callRequired(this.gs));
    if(presented&&this.opponentAction){
      const pose=cuePresentation(this.opponentAction.elapsed,presented.power,this.opponentAction.reduced);
      this.scene.setCue(true,presented.placement.x,presented.placement.y,presented.aim,pose.pull,presented.tipX,presented.tipY,presented.elevation);
      this.scene.setCall(presented.calledPocket,callRequired(this.gs));
    } else this.scene.setCue(aiming, this.cue().x, this.cue().y, this.angle, pull, this.tipX, this.tipY);
    const controls=this.humanCueControls();
    (document.getElementById('touchpower') as HTMLInputElement).disabled=!controls;
    (document.getElementById('callball') as HTMLSelectElement).disabled=!controls;
    (document.getElementById('clearcall') as HTMLButtonElement).disabled=!controls;
    (document.getElementById('resetspin') as HTMLButtonElement).disabled=!controls||Math.hypot(this.tipX,this.tipY)<1e-9;
    this.el.spin.setAttribute('aria-disabled',String(!controls));
    (this.el.chargefill as HTMLElement).style.width = pulling ? `${this.pullPower() * 100}%` : '0%';
    this.scene.setKitchen((this.mode === 'place' && this.gs.placement === 'kitchen') || (aiming && this.gs.kitchenShot), aiming);
    if (this.mode === 'place' && this.humanCueControls()) {
      this.scene.setPlace(true, this.placeX, this.placeY, canPlace(this.gs, this.placeX, this.placeY), this.gs.placement);
    } else {
      this.scene.setPlace(false, 0, 0, false);
    }
  }

  playerName(seat:number): string {
    return this.roomNames?.[seat] ?? (seat===1 && this.cpuOpponent && !this.room ? (this.jevOpponent ? 'Jev AI' : 'CPU') : `Player ${seat+1}`);
  }

  hud(): void {
    let msg = this.gs.message;
    if(this.opponentAction){
      const phase=this.opponentAction.phase;
      msg=`${this.playerName(1)} · ${phase==='planning'?'choosing a shot':phase==='aiming'?'lining up':phase==='pulling'?'drawing back':'striking'}`;
    }
    if (!this.opponentAction&&this.mode === 'place') msg += this.cpuOpponent && this.gs.current === 1 && !this.room
      ? ' — planning cue placement…' : ' — tap inside the outlined area to place the cue ball';
    else if (this.mode === 'rolling') msg = `Player ${this.gs.current + 1} · shot in motion`;
    else if (this.mode === 'wait' && this.room) msg += ' — waiting…';
    else if (this.room && this.seat !== null && this.seat !== this.gs.current && this.mode === 'aim') msg += ' — opponent aiming…';
    if(msg.startsWith('Illegal break'))msg += ' · no ball pocketed and fewer than four object balls reached a rail';
    this.el.msg.textContent = msg.replace(/\bPlayer ([12])\b/g,(_,seat)=>this.playerName(Number(seat)-1));
    this.el.turn.textContent = this.gs.winner !== null ? 'Game over' : this.playerName(this.gs.current);
    this.el.turn.classList.toggle('me', !this.room || this.seat === this.gs.current);
    this.el.roominfo.textContent = this.room ? (this.room.code ? `Room ${this.room.code} · ${this.room.ready?'Connected · your seat '+((this.seat??0)+1):'Waiting for your friend'}`:'Connecting…') : 'No room connected';
    if(this.room&&!this.room.ready)this.el.msg.textContent='Waiting for your friend · open Online to share the invite link';
    document.getElementById('roomentry')!.hidden=!!this.room;
    document.getElementById('roomsharing')!.hidden=!this.room?.code;
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
    for (const id of ['rack', 'cpubtn', 'jevbtn']) (this.el[id] as HTMLButtonElement).disabled = !!this.room;
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
      card.setAttribute('aria-label',`${this.playerName(i)}${this.gs.current===i?' — current player':''}`);
      if(matchMedia('(max-width:900px)').matches){card.setAttribute('role','button');card.tabIndex=0;card.setAttribute('aria-expanded',String(this.scoresExpanded));card.title='Tap to show or hide balls';}
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
      gr.textContent = g === null ? 'Open table' : onEight ? 'On the 8-Ball' : `${label} · ${left} remaining`;
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
    this.cancelOpponent();
    const wasPlacing=this.gs.ballInHand;
    for (const sb of s.balls) {
      const b = this.gs.balls.find((q) => q.id === sb.id);
      if (!b) continue;
      b.n = sb.n; b.z = b.vz = 0;
      b.x = sb.x; b.y = sb.y; b.potted = sb.potted;
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      b.asleep = true;
    }
    if(s.names)this.roomNames=s.names;
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

  leaveRoom(message:string):void {
    this.room?.close();this.room=null;this.seat=null;this.roomNames=null;this.pendingNetwork=[];
    this.jevRequest?.abort();this.jevRequest=null;this.jevOpponent=false;this.el.jevbtn.classList.remove('on');
    this.el.opponentstatus.textContent='';
    this.cpuOpponent=false;this.el.cpubtn.textContent='Play vs CPU';this.el.cpubtn.classList.remove('on');
    this.reset();this.el.roominfo.textContent=message;this.el.msg.textContent=message;
    void this.accountPanel.refresh();
  }

  connectRoom(create: boolean): void {
    if(this.room||this.tutorial.active)return;
    const name = ((this.el.pname as HTMLInputElement).value || 'Player').slice(0, 24);
    const code = (this.el.rcode as HTMLInputElement).value.trim().toUpperCase();
    if (!create && !/^[A-Z2-9]{8}$/.test(code)) {
      this.el.roominfo.textContent = 'Enter an 8-character room code to join.';
      return;
    }
    this.jevRequest?.abort();this.jevRequest=null;this.jevGame=null;this.jevOpponent=false;
    this.el.opponentstatus.textContent="";
    this.cancelOpponent();
    const rc = new RoomClient();
    this.room = rc;
    this.seat = null;
    const handleState = (s: RoomState) => {
      if (this.seat === null && rc.seat !== null) this.seat = rc.seat;
      this.applyServerState(s);
      const link=new URL('/',location.href);link.hash='join='+rc.code;
      (document.getElementById('roomlink') as HTMLInputElement).value=link.href;
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
    rc.onError = (e) => {if(!rc.code)this.leaveRoom(e);else this.el.msg.textContent=e;this.el.roominfo.textContent=e;};
    rc.onClose = message=>{if(this.room===rc)this.leaveRoom(message);};
    rc.onJoined = (names) => { this.roomNames = names; this.hud(); };
    rc.onOpen = () => (create ? rc.create(name, this.gs.rules) : rc.join(code, name));
    rc.connect();
    this.hud();
  }
}
