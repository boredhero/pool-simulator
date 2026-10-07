import { allAsleep, DT, step, strike, type Ball, type ShotEvents } from '../sim/physics';
import { applyShot, newGame, placeCue, type GameState } from '../sim/rules';
import { breakShot, chooseShot, legalTargets } from '../sim/ai';
import { BALL_R, TABLE_H, TABLE_W } from '../sim/table';
import { init, type AimGhost, type SceneHandle } from '../render/scene';
import { RoomClient, type RoomState } from '../net/room';

type Mode = 'aim' | 'rolling' | 'place' | 'over' | 'wait';

/** First ball/cushion along ray from (x,y) dir (dx,dy). */
export function predict(
  x: number, y: number, dx: number, dy: number, balls: Ball[], cueId: number,
): AimGhost {
  let bestT = Infinity;
  let hit: Ball | null = null;
  for (const b of balls) {
    if (b.id === cueId || b.potted) continue;
    const ox = x - b.x, oy = y - b.y;
    const proj = -(ox * dx + oy * dy);
    if (proj < 0) continue;
    const perp2 = ox * ox + oy * oy - proj * proj;
    const rr = BALL_R * 2;
    if (perp2 > rr * rr) continue;
    const t = proj - Math.sqrt(rr * rr - perp2);
    if (t > 0 && t < bestT) { bestT = t; hit = b; }
  }
  // Cushion distance (playfield edges).
  let cushionT = Infinity;
  if (dx > 0) cushionT = Math.min(cushionT, (TABLE_W - BALL_R - x) / dx);
  if (dx < 0) cushionT = Math.min(cushionT, (BALL_R - x) / dx);
  if (dy > 0) cushionT = Math.min(cushionT, (TABLE_H - BALL_R - y) / dy);
  if (dy < 0) cushionT = Math.min(cushionT, (BALL_R - y) / dy);
  if (!hit || bestT > cushionT) return { gx: 0, gy: 0, ox: 0, oy: 0, hasHit: false };
  const gx = x + dx * bestT, gy = y + dy * bestT;
  let ox = hit.x - gx, oy = hit.y - gy;
  const m = Math.hypot(ox, oy) || 1;
  ox /= m; oy /= m;
  return { gx, gy, ox, oy, hasHit: true };
}

export class Game {
  gs: GameState;
  scene: SceneHandle;
  mode: Mode = 'aim';
  angle = Math.PI; // aim direction, sim plane
  power = 0.5;
  tipX = 0; tipY = 0;
  orbit = false;
  ev: ShotEvents = { firstContact: null, potted: [], offTable: [], railAfterContact: false, cuePotted: false };
  contact = { v: false };
  el: Record<string, HTMLElement>;
  room: RoomClient | null = null;
  seat: number | null = null;
  whoShot: number | null = null;
  aiOpponent: boolean = false;
  aiTimer = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = init(canvas);
    this.gs = newGame(1);
    this.el = Object.fromEntries(
      ['msg', 'turn', 'power', 'spin', 'shoot', 'orbitbtn', 'rack', 'aibtn', 'version', 'lobby', 'pname', 'rcode', 'createbtn', 'joinbtn', 'roominfo'].map((id) => [id, document.getElementById(id)!]),
    );
    this.wire(canvas);
    this.scene.onFrame(() => this.frame());
    this.hud();
  }

  cue(): Ball { return this.gs.balls[0]; }

  wire(canvas: HTMLCanvasElement): void {
    const aimAt = (cx: number, cy: number) => {
      if (this.orbit) return;
      const c = this.cue();
      if (this.mode === 'place') {
        if (this.room) {
          if (this.seat === this.gs.current) this.room.place(cx, cy);
        } else if (placeCue(this.gs, cx, cy)) {
          this.mode = 'aim';
        }
        this.hud();
        return;
      }
      if (this.mode !== 'aim' || c.potted) return;
      const dx = cx - c.x, dy = cy - c.y;
      if (Math.hypot(dx, dy) > 0.02) this.angle = Math.atan2(dy, dx);
    };
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && e.buttons !== 0) return;
      const p = this.scene.pickFelt(e.clientX, e.clientY);
      if (p) aimAt(p[0], p[1]);
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') {
        const p = this.scene.pickFelt(e.clientX, e.clientY);
        if (p) aimAt(p[0], p[1]);
      }
    });
    addEventListener('keydown', (e) => {
      if (e.code === 'ArrowLeft') this.angle += 0.004;
      if (e.code === 'ArrowRight') this.angle -= 0.004;
      if (e.code === 'Space') { e.preventDefault(); this.shoot(); }
    });
    (this.el.power as HTMLInputElement).addEventListener('input', (e) => {
      this.power = Number((e.target as HTMLInputElement).value) / 100;
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
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setTip(e);
      const mv = (m: PointerEvent) => setTip(m);
      spin.addEventListener('pointermove', mv);
      spin.addEventListener('pointerup', () => spin.removeEventListener('pointermove', mv), { once: true });
    });
    this.el.shoot.addEventListener('click', () => this.shoot());
    this.el.createbtn.addEventListener('click', () => this.connectRoom(true));
    this.el.joinbtn.addEventListener('click', () => this.connectRoom(false));
    this.el.orbitbtn.addEventListener('click', () => {
      this.orbit = !this.orbit;
      this.scene.controls.enabled = this.orbit;
      (this.el.orbitbtn as HTMLButtonElement).textContent = this.orbit ? 'Aim' : 'Orbit';
    });
    this.el.rack.addEventListener('click', () => {
      this.gs = newGame((Math.random() * 1e9) | 0);
      this.mode = 'aim';
      this.hud();
    });
    this.el.aibtn.addEventListener('click', () => {
      this.aiOpponent = !this.aiOpponent;
      (this.el.aibtn as HTMLButtonElement).textContent = this.aiOpponent ? 'AI: on' : 'vs AI';
      this.gs = newGame((Math.random() * 1e9) | 0);
      this.mode = 'aim';
      this.hud();
    });
    this.scene.controls.enabled = false;
  }

  shoot(): void {
    if (!this.canShoot()) return;
    const c = this.cue();
    if (c.potted) return;
    const params = { aim: this.angle, power: this.power, tipX: this.tipX, tipY: this.tipY };
    strike(c, Math.cos(this.angle), Math.sin(this.angle), this.power, this.tipX, this.tipY);
    this.ev = { firstContact: null, potted: [], offTable: [], railAfterContact: false, cuePotted: false };
    this.contact = { v: false };
    this.whoShot = this.seat;
    this.mode = 'rolling';
    if (this.room) this.room.shot(params);
    this.hud();
  }

  canShoot(): boolean {
    if (this.mode !== 'aim' || this.gs.winner !== null) return false;
    if (this.room && this.seat !== this.gs.current) return false;
    if (this.aiOpponent && this.gs.current === 1) return false;
    return true;
  }

  aiMove(): void {
    // AI plays as player 2 (or whoever isn't the human).
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
    this.shoot();
  }

  frame(): void {
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
      for (let i = 0; i < 4 && !allAsleep(this.gs.balls); i++) {
        step(this.gs.balls, DT, this.ev, 0, this.contact);
      }
      if (allAsleep(this.gs.balls)) {
        if (this.room && this.whoShot === this.seat) {
          // Report rest snapshot; server reconciles and broadcasts the result.
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
          this.mode = 'wait'; // watched opponent's shot; result incoming
        }
        this.hud();
      }
    }
    this.scene.setBalls(this.gs.balls);
    const aiming = this.mode === 'aim' && !this.cue().potted;
    const g = aiming ? predict(this.cue().x, this.cue().y, Math.cos(this.angle), Math.sin(this.angle), this.gs.balls, 0) : { gx: 0, gy: 0, ox: 0, oy: 0, hasHit: false };
    this.scene.setAim(aiming, this.cue().x, this.cue().y, this.angle, g);
    this.scene.setCue(aiming, this.cue().x, this.cue().y, this.angle, 0.02 + this.power * 0.12);
  }

  hud(): void {
    let msg = this.gs.message;
    if (this.mode === 'place') msg += ' — tap table to place cue ball';
    else if (this.mode === 'wait' && this.room) msg += ' — waiting…';
    else if (this.room && this.seat !== null && this.seat !== this.gs.current && this.mode === 'aim') msg += ' — opponent aiming…';
    this.el.msg.textContent = msg;
    this.el.turn.textContent = this.gs.winner !== null ? 'Game over' : `Player ${this.gs.current + 1}`;
    (this.el.shoot as HTMLButtonElement).disabled = !this.canShoot();
    this.el.roominfo.textContent = this.room ? `room ${this.room.code} · you P${(this.seat ?? 0) + 1}` : 'solo';
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
    this.hud();
  }

  connectRoom(create: boolean): void {
    const name = ((this.el.pname as HTMLInputElement).value || 'Player').slice(0, 24);
    const code = (this.el.rcode as HTMLInputElement).value.trim().toUpperCase();
    const rc = new RoomClient();
    this.room = rc;
    rc.onState = (s) => this.applyServerState(s);
    rc.onShot = (by, shot) => {
      const c = this.cue();
      if (c.potted) return; // shouldn't happen; server gates turn order
      strike(c, Math.cos(shot.aim), Math.sin(shot.aim), shot.power, shot.tipX, shot.tipY);
      this.ev = { firstContact: null, potted: [], offTable: [], railAfterContact: false, cuePotted: false };
      this.contact = { v: false };
      this.whoShot = by;
      this.mode = 'rolling';
      this.hud();
    };
    rc.onError = (e) => { this.el.msg.textContent = `net: ${e}`; };
    rc.onOpen = () => (create ? rc.create(name) : rc.join(code, name));
    rc.connect();
    this.el.lobby.style.display = 'none';
  }
}
