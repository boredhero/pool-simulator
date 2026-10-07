import { allAsleep, DT, step, strike, type Ball, type ShotEvents } from '../sim/physics';
import { applyShot, canPlace, newGame, placeCue, type GameState } from '../sim/rules';
import { breakShot, chooseShot, legalTargets } from '../sim/ai';
import { Sfx } from './sfx';
import { TABLE_H, TABLE_W } from '../sim/table';
import { init, type SceneHandle } from '../render/scene';
import { RoomClient, type RoomState } from '../net/room';

type Mode = 'aim' | 'rolling' | 'place' | 'over' | 'wait';

const CHARGE_MS = 1400; // press-hold ramp to full power

const freshEv = (): ShotEvents => ({
  firstContact: null, potted: [], offTable: [], railAfterContact: false, cuePotted: false,
});

export class Game {
  gs: GameState;
  scene: SceneHandle;
  mode: Mode = 'aim';
  angle = Math.PI; // aim direction, sim plane
  power = 0.5; // last fired power (drives cue rest offset)
  tipX = 0; tipY = 0;
  orbit = false;
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
  lastT = 0;
  chargeT0: number | null = null;
  placeX = TABLE_W / 4; placeY = TABLE_H / 2;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = init(canvas);
    this.gs = newGame(1);
    this.el = Object.fromEntries(
      ['msg', 'turn', 'version', 'onlinebtn', 'onlinepanel', 'pname', 'rcode', 'createbtn', 'joinbtn',
        'roominfo', 'chargefill', 'spin', 'orbitbtn', 'aibtn', 'rack'].map((id) => [id, document.getElementById(id)!]),
    );
    this.wire(canvas);
    this.scene.onFrame(() => this.frame());
    this.hud();
  }

  cue(): Ball { return this.gs.balls[0]; }

  canShoot(): boolean {
    if (this.mode !== 'aim' || this.gs.winner !== null) return false;
    if (this.room && this.seat !== this.gs.current) return false;
    if (this.aiOpponent && this.gs.current === 1) return false;
    return true;
  }

  chargePower(now = performance.now()): number {
    if (this.chargeT0 === null) return 0;
    return Math.min(1, (now - this.chargeT0) / CHARGE_MS);
  }

  wire(canvas: HTMLCanvasElement): void {
    const aimAt = (cx: number, cy: number) => {
      if (this.orbit) return;
      if (this.mode === 'place') {
        this.placeX = cx; this.placeY = cy;
        return;
      }
      if (this.mode !== 'aim' || this.cue().potted) return;
      const c = this.cue();
      const dx = cx - c.x, dy = cy - c.y;
      if (Math.hypot(dx, dy) > 0.02) this.angle = Math.atan2(dy, dx);
    };
    const tryPlace = (cx: number, cy: number) => {
      if (this.room) {
        if (this.seat === this.gs.current) this.room.place(cx, cy);
      } else if (placeCue(this.gs, cx, cy)) {
        this.mode = 'aim';
      }
      this.hud();
    };
    canvas.addEventListener('pointermove', (e) => {
      if (this.orbit) return;
      if (e.pointerType === 'mouse' && e.buttons !== 0 && e.buttons !== 1) return;
      const p = this.scene.pickFelt(e.clientX, e.clientY);
      if (p) aimAt(p[0], p[1]);
    });
    canvas.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      if (this.orbit || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const p = this.scene.pickFelt(e.clientX, e.clientY);
      if (!p) return;
      if (this.mode === 'place') {
        this.placeX = p[0]; this.placeY = p[1];
        tryPlace(p[0], p[1]);
        return;
      }
      if (this.mode === 'aim' && !this.cue().potted) {
        const c = this.cue();
        const dx = p[0] - c.x, dy = p[1] - c.y;
        if (Math.hypot(dx, dy) > 0.02) this.angle = Math.atan2(dy, dx);
      }
      if (this.canShoot()) this.chargeT0 = performance.now();
    });
    const cancelCharge = () => { this.chargeT0 = null; };
    canvas.addEventListener('pointerup', (e) => {
      if (this.chargeT0 === null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) { this.chargeT0 = null; return; }
      const power = this.chargePower();
      this.chargeT0 = null;
      this.fire(Math.max(0.05, power));
    });
    canvas.addEventListener('pointercancel', cancelCharge);
    canvas.addEventListener('pointerleave', cancelCharge);
    addEventListener('keydown', (e) => {
      if (e.code === 'ArrowLeft') this.angle += 0.004;
      if (e.code === 'ArrowRight') this.angle -= 0.004;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat && this.chargeT0 === null && this.canShoot()) this.chargeT0 = performance.now();
      }
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.chargeT0 !== null) {
        const power = this.chargePower();
        this.chargeT0 = null;
        this.fire(Math.max(0.05, power));
      }
    });
    const spin = this.el.spin;
    const setTip = (e: PointerEvent) => {
      const r = spin.getBoundingClientRect();
      this.tipX = Math.max(-0.55, Math.min(0.55, ((e.clientX - r.left) / r.width - 0.5) * 2 * 0.55));
      this.tipY = Math.max(-0.55, Math.min(0.55, (0.5 - (e.clientY - r.top) / r.height) * 2 * 0.55));
      spin.style.setProperty('--tx', `${(this.tipX / 0.55) * 30}px`);
      spin.style.setProperty('--ty', `${(-this.tipY / 0.55) * 30}px`);
    };
    spin.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setTip(e);
      const mv = (m: PointerEvent) => setTip(m);
      spin.addEventListener('pointermove', mv);
      spin.addEventListener('pointerup', () => spin.removeEventListener('pointermove', mv), { once: true });
    });
    this.el.onlinebtn.addEventListener('click', () => {
      this.el.onlinepanel.classList.toggle('open');
    });
    this.el.createbtn.addEventListener('click', () => this.connectRoom(true));
    this.el.joinbtn.addEventListener('click', () => this.connectRoom(false));
    this.el.orbitbtn.addEventListener('click', () => {
      this.orbit = !this.orbit;
      this.chargeT0 = null;
      this.scene.controls.enabled = this.orbit;
      (this.el.orbitbtn as HTMLButtonElement).textContent = this.orbit ? 'Aim' : 'Orbit';
      (this.el.orbitbtn as HTMLButtonElement).classList.toggle('on', this.orbit);
    });
    this.el.rack.addEventListener('click', () => {
      this.gs = newGame((Math.random() * 1e9) | 0);
      this.mode = 'aim';
      this.chargeT0 = null;
      this.hud();
    });
    this.el.aibtn.addEventListener('click', () => {
      this.aiOpponent = !this.aiOpponent;
      (this.el.aibtn as HTMLButtonElement).textContent = this.aiOpponent ? 'AI: on' : 'vs AI';
      (this.el.aibtn as HTMLButtonElement).classList.toggle('on', this.aiOpponent);
      this.gs = newGame((Math.random() * 1e9) | 0);
      this.mode = 'aim';
      this.hud();
    });
    this.scene.controls.enabled = false;
  }

  fire(power: number): void {
    if (!this.canShoot()) return;
    const c = this.cue();
    if (c.potted) return;
    this.power = power;
    const params = { aim: this.angle, power, tipX: this.tipX, tipY: this.tipY };
    strike(c, Math.cos(this.angle), Math.sin(this.angle), power, this.tipX, this.tipY);
    this.ev = freshEv();
    this.contact = { v: false };
    this.whoShot = this.seat;
    this.mode = 'rolling';
    if (this.room) this.room.shot(params);
    this.hud();
  }

  aiMove(): void {
    const aiSeat = this.aiOpponent ? 1 : -1;
    if (aiSeat < 0 || this.gs.current !== aiSeat) return;
    if (this.gs.ballInHand) {
      placeCue(this.gs, TABLE_W / 4, TABLE_H / 2);
      if (this.room) this.room.place(TABLE_W / 4, TABLE_H / 2);
    }
    const myGroup = this.gs.groups[this.gs.current];
    const onEight = !this.gs.open && myGroup !== null &&
      !this.gs.balls.some((b) => !b.potted && b.n !== null && b.n !== 8 && (
        this.gs.open || (myGroup === 'solid' || myGroup === 'stripe'
          ? (b.n < 8 ? 'solid' : 'stripe') === myGroup : false)));
    const targets = legalTargets(
      this.gs.balls,
      onEight ? 'eight' : this.gs.open ? null : myGroup,
      this.gs.open,
    );
    const shot = (this.gs.breakShot ? breakShot(this.gs.balls) : chooseShot(this.gs.balls, targets, 'medium'))
      ?? breakShot(this.gs.balls);
    this.angle = shot.angle;
    this.power = shot.power;
    this.tipX = shot.tipX;
    this.tipY = shot.tipY;
    this.fire(shot.power);
  }

  frame(): void {
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
    const potted = this.gs.balls.filter((b) => b.potted).length;
    if (potted > this.lastPotted) this.sfx.pot();
    this.lastPotted = potted;
    if (this.mode === 'aim' && this.aiOpponent && this.gs.current === 1 && this.gs.winner === null && !this.room) {
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
      let acc = Math.min((now - this.lastT) / 1000, 0.25);
      this.lastT = now;
      let n = 0;
      while (acc >= DT && !allAsleep(this.gs.balls) && n < 60) {
        step(this.gs.balls, DT, this.ev, 0, this.contact);
        acc -= DT;
        n++;
      }
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
          this.mode = this.gs.winner !== null ? 'over' : this.gs.ballInHand ? 'place' : 'aim';
        } else {
          this.mode = 'wait';
        }
        this.hud();
      }
    }
    this.scene.setBalls(this.gs.balls);
    const aiming = this.mode === 'aim' && !this.cue().potted;
    const charging = this.chargeT0 !== null && aiming;
    const pull = charging ? 0.02 + this.chargePower() * 0.18 : 0.02 + this.power * 0.1;
    this.scene.setCue(aiming, this.cue().x, this.cue().y, this.angle, pull);
    (this.el.chargefill as HTMLElement).style.width = charging ? `${this.chargePower() * 100}%` : '0%';
    if (this.mode === 'place') {
      this.scene.setPlace(true, this.placeX, this.placeY, canPlace(this.gs, this.placeX, this.placeY));
    } else {
      this.scene.setPlace(false, 0, 0, false);
    }
  }

  hud(): void {
    let msg = this.gs.message;
    if (this.mode === 'place') msg += ' — tap a green spot to place the cue ball';
    else if (this.mode === 'wait' && this.room) msg += ' — waiting…';
    else if (this.room && this.seat !== null && this.seat !== this.gs.current && this.mode === 'aim') msg += ' — opponent aiming…';
    this.el.msg.textContent = msg;
    this.el.turn.textContent = this.gs.winner !== null ? 'Game over' : `Player ${this.gs.current + 1}`;
    this.el.roominfo.textContent = this.room ? `room ${this.room.code} · you P${(this.seat ?? 0) + 1}` : 'solo table';
  }

  applyServerState(s: RoomState): void {
    for (const sb of s.balls) {
      const b = this.gs.balls.find((q) => q.id === sb.id);
      if (!b) continue;
      b.x = sb.x; b.y = sb.y; b.potted = sb.potted;
      b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      b.asleep = true;
    }
    this.gs.current = s.current === 1 ? 1 : 0;
    this.gs.groups = [(s.groups[0] ?? null) as never, (s.groups[1] ?? null) as never];
    this.gs.open = s.open;
    this.gs.ballInHand = s.ball_in_hand;
    this.gs.winner = s.winner === 1 ? 1 : s.winner === 0 ? 0 : null;
    this.gs.message = s.message;
    this.mode = s.winner !== null ? 'over' : s.ball_in_hand && s.current === this.seat ? 'place' : 'aim';
    this.chargeT0 = null;
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
    rc.onState = (s) => {
      if (this.seat === null && rc.seat !== null) this.seat = rc.seat;
      this.applyServerState(s);
    };
    rc.onShot = (by, shot) => {
      const c = this.cue();
      if (c.potted) return;
      strike(c, Math.cos(shot.aim), Math.sin(shot.aim), shot.power, shot.tipX, shot.tipY);
      this.ev = freshEv();
      this.contact = { v: false };
      this.whoShot = by;
      this.mode = 'rolling';
      this.hud();
    };
    rc.onError = (e) => { this.el.msg.textContent = `net: ${e}`; };
    rc.onOpen = () => (create ? rc.create(name) : rc.join(code, name));
    rc.connect();
    this.el.onlinepanel.classList.remove('open');
  }
}
