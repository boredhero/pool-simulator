// Tiny WebAudio SFX: unlocked on first gesture, driven by per-frame monitoring.
export class Sfx {
  ctx: AudioContext | null = null;

  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (navigator.storage?.persist) void navigator.storage.persist();
  }

  private burst(freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(Math.min(0.5, gain), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Ball click, intensity 0..1. */
  click(i: number): void {
    this.burst(2200 + Math.random() * 600, 0.05, 0.12 * Math.min(1, i));
  }

  /** Cushion thud. */
  thud(i: number): void {
    this.burst(320, 0.09, 0.2 * Math.min(1, i), 'triangle');
  }

  /** Pocket drop. */
  pot(): void {
    this.burst(660, 0.12, 0.25);
    setTimeout(() => this.burst(440, 0.15, 0.2), 70);
  }
}
