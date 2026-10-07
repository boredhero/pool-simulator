import { allAsleep, DT, step, strike, type Ball, type ShotEvents } from '../sim/physics';
import { applyShot, newGame, placeCue, type GameState } from '../sim/rules';
import { BALL_R, TABLE_H, TABLE_W } from '../sim/table';
import { init, type AimGhost, type SceneHandle } from '../render/scene';

type Mode = 'aim' | 'rolling' | 'place' | 'over';

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
  ev: ShotEvents = { firstContact: null, potted: [], railAfterContact: false, cuePotted: false };
  contact = { v: false };
  el: Record<string, HTMLElement>;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = init(canvas);
    this.gs = newGame(1);
    this.el = Object.fromEntries(
      ['msg', 'turn', 'power', 'spin', 'shoot', 'orbitbtn', 'rack', 'version'].map((id) => [id, document.getElementById(id)!]),
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
        if (placeCue(this.gs, cx, cy)) this.mode = 'aim';
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
    this.scene.controls.enabled = false;
  }

  shoot(): void {
    if (this.mode !== 'aim' || this.gs.winner !== null) return;
    const c = this.cue();
    if (c.potted) return;
    strike(c, Math.cos(this.angle), Math.sin(this.angle), this.power, this.tipX, this.tipY);
    this.ev = { firstContact: null, potted: [], railAfterContact: false, cuePotted: false };
    this.contact = { v: false };
    this.mode = 'rolling';
    this.hud();
  }

  frame(): void {
    if (this.mode === 'rolling') {
      for (let i = 0; i < 4 && !allAsleep(this.gs.balls); i++) {
        step(this.gs.balls, DT, this.ev, 0, this.contact);
      }
      if (allAsleep(this.gs.balls)) {
        applyShot(this.gs, this.ev);
        this.mode = this.gs.winner !== null ? 'over' : this.gs.ballInHand ? 'place' : 'aim';
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
    this.el.msg.textContent = this.gs.message + (this.mode === 'place' ? ' — tap table to place cue ball' : '');
    this.el.turn.textContent = this.gs.winner !== null ? 'Game over' : `Player ${this.gs.current + 1}`;
    (this.el.shoot as HTMLButtonElement).disabled = this.mode !== 'aim';
  }
}
