import type { MatchConfig } from '../sim/config';
import type { Placement } from '../sim/rules';
// Room net client: join/create private rooms, shot-event sync.
// Server is authoritative on rules; we predict locally and reconcile at rest.
export interface ShotParams { aim: number; power: number; tipX: number; tipY: number; vmax?: number; elevation?: number; calledBall?: number | null; calledPocket?: number | null }
export interface ServerBall { id: number; n: number | null; x: number; y: number; potted: boolean }
export interface RoomState {
  return_order: number[];
  names?:string[]; ready?:boolean; registered?:boolean[];
  code: string; balls: ServerBall[]; current: number;
  groups: Array<string | null>; open: boolean; ball_in_hand: boolean;
  winner: number | null; message: string;
  break_shot: boolean; placement: Placement; kitchen_shot: boolean; rules: MatchConfig; revision: number;
}
export interface ShotEventsWire {
  first_contact: number | null; potted: number[]; off_table: Array<number | null>;
  rail_after_contact: boolean; cue_potted: boolean;
}

export class RoomClient {
  ws: WebSocket | null = null;
  seat: number | null = null;
  code = '';
  revision = 0;
  ready = false;
  private closed = false;
  private connectingTimer = 0;
  onState: (s: RoomState) => void = () => {};
  onShot: (by: number, shot: ShotParams) => void = () => {};
  onJoined: (names: string[]) => void = () => {};
  onError: (e: string) => void = () => {};
  onOpen: () => void = () => {};
  onClose: (message:string) => void = () => {};

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.connectingTimer=window.setTimeout(()=>{this.close();this.onClose('Connection timed out. Try again.');},12000);
    this.ws.onopen = () => {clearTimeout(this.connectingTimer);this.onOpen();};
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.t === 'room') {
        this.seat = d.you;
        this.code = d.code;
        this.revision = d.state.revision;
        this.ready = d.state.ready ?? true;
        this.onState(d.state);
      } else if (d.t === 'state' || d.t === 'result') {
        this.revision = d.revision;
        this.ready = d.ready ?? true;
        this.onState(d);
      } else if (d.t === 'shot') {
        this.onShot(d.by, d.shot);
      } else if (d.t === 'joined') {
        this.onJoined(d.names);
      } else if(d.t==='left'){
        this.close();this.onClose(d.message??'Opponent left. Room closed.');
      } else if (d.t === 'error') {
        this.onError(d.error);
      }
    };
    this.ws.onclose = () => {clearTimeout(this.connectingTimer);if(!this.closed){this.closed=true;this.onClose('Disconnected. Create or join a new room to continue.');}};
  }

  close():void {this.closed=true;clearTimeout(this.connectingTimer);this.ws?.close();this.ws=null;}
  send(o: object): void { if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(o)); }
  create(name: string, rules: MatchConfig): void { this.send({ t: 'create', name, rules }); }
  join(code: string, name: string): void { this.send({ t: 'join', code, name }); }
  shot(s: ShotParams): void { this.send({ t: 'shot', shot: s, revision: this.revision }); }
  done(balls: ServerBall[], ev: ShotEventsWire): void { this.send({ t: 'done', balls, ev }); }
  place(x: number, y: number): void { this.send({ t: 'place', x, y, revision: this.revision }); }
}
