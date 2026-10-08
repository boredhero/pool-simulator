import './simControls.css';
export type SimMode='cpu-cpu'|'jev-cpu'|'jev-jev';
export class SimControls {
  private button=document.createElement('button');
  private panel=document.createElement('section');
  constructor(start:(mode:SimMode)=>Promise<void>){
    this.button.id='sim-button';this.button.type='button';this.button.textContent='Sim';this.button.hidden=true;
    this.button.setAttribute('aria-controls','sim-panel');this.button.setAttribute('aria-expanded','false');
    document.getElementById('spincontrols')!.after(this.button);
    this.panel.id='sim-panel';this.panel.hidden=true;this.panel.setAttribute('aria-label','Simulation games');
    const header=document.createElement('header'),title=document.createElement('strong'),done=document.createElement('button');
    title.textContent='Watch a simulation';done.type='button';done.textContent='Done';done.addEventListener('click',()=>this.close());header.append(title,done);this.panel.append(header);
    const note=document.createElement('p');note.textContent='Uses your shared daily Jev allowance. Premium has unlimited games.';this.panel.append(note);
    for(const [mode,label,cost] of [['cpu-cpu','CPU vs CPU',0],['jev-cpu','Jev vs CPU',1],['jev-jev','Jev vs Jev',2]] as const){
      const button=document.createElement('button');button.type='button';button.dataset.simMode=mode;button.textContent=`${label} · ${cost===0?'Free':`${cost} Jev game${cost===1?'':'s'}`}`;
      button.addEventListener('click',()=>{this.close();void start(mode);});this.panel.append(button);
    }
    document.body.append(this.panel);
    this.button.addEventListener('click',()=>{this.panel.hidden=false;this.button.setAttribute('aria-expanded','true');document.body.classList.add('sim-panel-open');done.focus();});
    this.panel.addEventListener('keydown',event=>{if(event.key==='Escape'){this.close();this.button.focus();}});
  }
  setEnabled(enabled:boolean):void {this.button.hidden=!enabled;document.body.classList.toggle('sim-enabled',enabled);if(!enabled)this.close();}
  close():void {this.panel.hidden=true;this.button.setAttribute('aria-expanded','false');document.body.classList.remove('sim-panel-open');}
}
