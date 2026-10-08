import './tutorial.css';
export type TutorialAction='aim'|'spin'|'camera'|'shot';
export type TutorialProfile='mouse'|'trackpad'|'touch';
interface PracticeHooks {begin():boolean;stage(action:TutorialAction):void;end():void;frame():void}
const actions:TutorialAction[]=['aim','spin','camera','shot'];
const titles=['Line up the yellow ball','Try spin, then reset','Move your view','Take the practice shot'];
const copy:Record<TutorialProfile,string[]>={
  mouse:['Move over the felt to aim at the yellow ball.','Drag the white-ball dot, then Reset to center it.','Right-drag the felt to orbit. Scroll to zoom.','Press and hold on the felt, pull back to set power, then release to shoot. Pull farther for a stronger shot.'],
  trackpad:['Move your pointer over the felt toward the yellow ball.','Drag the white-ball dot, then Reset to center it.','Two-finger scroll to orbit. Pinch to zoom; Option-scroll pans.','Click and hold on the felt, drag back to set power, then release to shoot. Pull farther for a stronger shot.'],
  touch:['Drag one finger on the felt toward the yellow ball, then lift.','Drag the white-ball dot, then tap Reset.','Move two fingers together to orbit. Pinch to zoom.','Set power below, then tap Shoot. This table is only for practice.'],
};
export class Tutorial {
  private index=-1;
  private done=false;
  private staging=false;
  private hooks?:PracticeHooks;
  private frameId=0;
  private profile:TutorialProfile='mouse';
  constructor(){
    const panel=document.getElementById('tutorial')!;
    panel.innerHTML='<header><strong id="tutorialtitle"></strong><button id="tutorialclose" type="button" aria-label="Close practice and return to game">×</button></header><p id="tutorialbody"></p><footer><button id="tutorialback" type="button">Back</button><span id="tutorialprogress" role="status"></span><button id="tutorialnext" type="button">Next</button></footer>';
    document.getElementById('starttutorial')!.addEventListener('click',()=>this.start());
    document.getElementById('tutorialclose')!.addEventListener('click',()=>this.close());
    document.getElementById('tutorialnext')!.addEventListener('click',()=>{if(++this.index===actions.length)this.close();else this.show();});
    document.getElementById('tutorialback')!.addEventListener('click',()=>{if(this.index>0){this.index--;this.show();}});
    addEventListener('keydown',e=>{if(e.key==='Escape'&&this.active){this.close();e.preventDefault();}});
    const adapt=()=>{if(!this.active)return;this.refreshCopy();this.reframe();};
    addEventListener('resize',adapt);
    document.addEventListener('change',e=>{if((e.target as HTMLElement).id==='camera-input-profile')adapt();});
    new MutationObserver(adapt).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  }
  bind(hooks:PracticeHooks){this.hooks=hooks;}
  get active(){return this.index>=0;}
  get action():TutorialAction|null{return this.active?actions[this.index]:null;}
  start():boolean {
    if(this.active)return true;
    if(!this.hooks?.begin()){
      let notice=document.getElementById('tutorial-unavailable');
      if(!notice){notice=document.createElement('p');notice.id='tutorial-unavailable';notice.setAttribute('role','status');document.getElementById('starttutorial')!.after(notice);}
      notice.textContent='Practice needs an idle local table. Finish the shot or leave the online/Jev game first.';return false;
    }
    document.getElementById('tutorial-unavailable')?.remove();
    document.getElementById('helppanel')!.classList.remove('open');
    document.getElementById('helpbtn')!.setAttribute('aria-expanded','false');
    for(const id of ['settingspanel','onlinepanel','viewpanel'])document.getElementById(id)?.classList.remove('open');
    this.index=0;document.body.classList.add('tutorial-practice');this.show();document.getElementById('tutorialclose')!.focus();return true;
  }
  record(action:TutorialAction){
    if(this.staging||this.action!==action||this.done)return;
    this.done=true;document.getElementById('tutorialprogress')!.textContent='Control worked';
    document.getElementById('tutorialnext')!.textContent=this.index===actions.length-1?'Finish':'Next';
  }
  private refreshCopy(){
    this.profile=document.documentElement.classList.contains('touch-input')?'touch':
      (document.getElementById('camera-input-profile') as HTMLSelectElement|null)?.value==='trackpad'?'trackpad':'mouse';
    const panel=document.getElementById('tutorial')!;panel.dataset.profile=this.profile;
    document.getElementById('tutorialbody')!.textContent=copy[this.profile][this.index];
    document.querySelectorAll('.tutorial-focus').forEach(e=>e.classList.remove('tutorial-focus'));
    const target=this.action==='spin'?'#spincontrols':this.action==='shot'?(this.profile==='touch'?'.touch-shot':'.power-control'):null;
    if(target)document.querySelector(target)?.classList.add('tutorial-focus');
  }
  private reframe(){
    cancelAnimationFrame(this.frameId);
    this.frameId=requestAnimationFrame(()=>{if(this.active)this.hooks?.frame();});
  }
  private show(){
    this.done=false;
    const panel=document.getElementById('tutorial')!;panel.hidden=false;panel.dataset.step=actions[this.index];
    document.body.dataset.tutorialStep=actions[this.index];
    document.getElementById('tutorialtitle')!.textContent=`${this.index+1}/4 · ${titles[this.index]}`;
    document.getElementById('tutorialprogress')!.textContent='Practice · game saved';
    document.getElementById('tutorialnext')!.textContent=this.index===actions.length-1?'Finish':'Skip';
    (document.getElementById('tutorialback') as HTMLButtonElement).disabled=this.index===0;
    document.querySelectorAll('.tutorial-focus').forEach(e=>e.classList.remove('tutorial-focus'));
    this.refreshCopy();this.staging=true;this.hooks?.stage(actions[this.index]);this.staging=false;this.reframe();
  }
  close(){
    if(!this.active)return;
    this.index=-1;cancelAnimationFrame(this.frameId);
    document.getElementById('tutorial')!.hidden=true;document.body.classList.remove('tutorial-practice');delete document.body.dataset.tutorialStep;
    document.querySelectorAll('.tutorial-focus').forEach(e=>e.classList.remove('tutorial-focus'));
    this.hooks?.end();
    try{localStorage.setItem('pool:tutorialSeen','1');}catch{/* private mode */}
    document.getElementById('helpbtn')!.focus();
  }
}
