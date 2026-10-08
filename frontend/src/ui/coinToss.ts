import './coinToss.css';

/** Local randomness is used only for offline racks; remote callers supply their server's seat. */
export function randomBreaker():0|1 {return (crypto.getRandomValues(new Uint8Array(1))[0]&1) as 0|1;}

/** A rack-scoped presentation gate. Pausing for practice never rerolls its result. */
export class CoinToss {
  private rack:object|null=null;
  private seat:0|1=0;
  private elapsed=0;
  private started=false;
  private reduced=false;
  private node=document.createElement('div');
  constructor(){
    this.node.id='coin-toss';this.node.hidden=true;this.node.setAttribute('role','status');this.node.setAttribute('aria-live','polite');
    this.node.innerHTML='<div class="denarius-shadow"></div><div class="denarius"><span class="denarius-face" aria-hidden="true">Ⅰ<span>DENARIVS</span></span><span class="denarius-face denarius-reverse" aria-hidden="true">Ⅱ<span>DENARIVS</span></span></div><p class="coin-caption"></p>';
    document.body.append(this.node);
  }
  pending(rack:object){return this.rack===rack;}
  queue(rack:object,seat:0|1){this.cancel();this.rack=rack;this.seat=seat;}
  cancel(){this.rack=null;this.elapsed=0;this.started=false;this.node.hidden=true;this.node.classList.remove('coin-running');}
  update(rack:object,dt:number,paused:boolean,names:[string,string],point:{x:number;y:number}){
    if(!this.rack)return;
    if(paused){this.node.hidden=true;this.started=false;this.elapsed=0;this.node.classList.remove('coin-running');return;}
    if(this.rack!==rack){this.cancel();return;}
    if(!this.started){
      this.started=true;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.node.dataset.reduced=String(this.reduced);this.node.dataset.seat=String(this.seat);
      this.node.style.setProperty('--coin-end',this.seat===0?'1080deg':'1260deg');
      this.node.hidden=false;void this.node.offsetWidth;this.node.classList.add('coin-running');
    }
    this.node.hidden=false;this.elapsed+=Math.min(.1,Math.max(0,dt));
    const margin=Math.min(140,innerWidth/2-12);
    const x=Number.isFinite(point.x)?Math.max(margin,Math.min(innerWidth-margin,point.x)):innerWidth/2;
    const y=Number.isFinite(point.y)?Math.max(125,Math.min(innerHeight-105,point.y)):innerHeight/2;
    this.node.style.left=`${x}px`;this.node.style.top=`${y}px`;
    const landed=this.reduced||this.elapsed>=1.2;
    this.node.dataset.phase=landed?'landed':'tossing';
    const caption=landed?`${names[this.seat]} breaks · ${this.seat===0?'I':'II'}`:'Tossing the denarius…';
    const label=this.node.querySelector('.coin-caption')!;if(label.textContent!==caption)label.textContent=caption;
    if(this.elapsed>=(this.reduced?.3:1.85))this.cancel();
  }
}
