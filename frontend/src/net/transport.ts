// Transport abstraction: REST now (P2), WS shot-event sync later (P3).
export interface ShotEvent { shotId: string; aim: number; power: number; tipX: number; tipY: number }
export interface Transport { sendShot(s: ShotEvent): Promise<void> }
export class RestTransport implements Transport {
  async sendShot(s: ShotEvent): Promise<void> {
    await fetch('/api/replays', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(s) });
  }
}
