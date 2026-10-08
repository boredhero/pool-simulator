import {COIN_LAND_TIME,type GoldCoin} from '../render/goldCoin';

/** Local randomness is used only for offline racks; remote callers supply their server's seat. */
export function randomBreaker():0|1 {return (crypto.getRandomValues(new Uint8Array(1))[0]&1) as 0|1;}

/** Rack-scoped animation and input gate; pausing for practice never rerolls the result. */
export class CoinToss {
  private rack:object|null=null;
  private seat:0|1=0;
  private elapsed=0;
  private started=false;
  private reduced=false;
  status='';
  constructor(private visual:GoldCoin){}
  pending(rack:object){return this.rack===rack;}
  queue(rack:object,seat:0|1){this.cancel();this.rack=rack;this.seat=seat;}
  cancel(){this.rack=null;this.elapsed=0;this.started=false;this.status='';this.visual.clear();}
  update(rack:object,dt:number,paused:boolean,names:[string,string]){
    if(!this.rack)return;
    if(paused){this.visual.clear();this.started=false;this.elapsed=0;this.status='';return;}
    if(this.rack!==rack){this.cancel();return;}
    if(!this.started){
      this.started=true;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.visual.begin(this.seat);
    }
    this.elapsed+=Math.min(.1,Math.max(0,dt));this.visual.advance(this.elapsed,this.reduced);
    const landed=this.reduced||this.elapsed>=COIN_LAND_TIME;
    this.status=landed?`${names[this.seat]} breaks · ${this.seat===0?'H':'T'}`:'Flipping a 🪙';
    if(this.elapsed>=(this.reduced?.3:1.85))this.cancel();
  }
}
