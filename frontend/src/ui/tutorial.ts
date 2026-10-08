type Action='aim'|'spin'|'camera'|'shot';
const steps:Array<{action:Action;title:string;target:string;desktop:string;touch:string}>=[
  {action:'aim',title:'Line up the cue',target:'game-canvas',desktop:'Move the pointer over the felt to aim. Try turning the cue toward a ball.',touch:'Touch the felt and keep holding. Swing your finger sideways to turn the cue, then lift to keep your aim.'},
  {action:'spin',title:'Try spin, then reset',target:'spincontrols',desktop:'Drag the dot on the white ball below to move the tip contact. Reset centers it again.',touch:'Drag the dot on the white ball below to add spin. Tap Reset whenever you want a centered hit.'},
  {action:'camera',title:'Find your view',target:'viewbtn',desktop:'Choose your camera input mode in the HUD. Right-drag with a mouse, or two-finger scroll in Trackpad Mode. Pinch zooms; Option-scroll pans. WASD moves, Space rises, Left Shift descends, Q/E turns.',touch:'Drag two fingers together to orbit, and spread or pinch to zoom. View → Move camera also offers one-finger orbit. Return to play before shooting.'},
  {action:'shot',title:'Choose power and shoot',target:'touchshoot',desktop:'On your turn, press on the felt, pull back to build power, and release. This is a real shot in your current game. Place or call the cue ball/shot first if prompted.',touch:'On your turn, set the power slider, then tap Shoot. This is a real shot in your current game. Place the cue ball or call your shot first if prompted.'},
];
export class Tutorial {
  private index=-1;
  private done=false;
  constructor(){
    document.getElementById('starttutorial')!.addEventListener('click',()=>{
      document.getElementById('helppanel')!.classList.remove('open');
      document.getElementById('helpbtn')!.setAttribute('aria-expanded','false');
      this.index=0;this.show();
    });
    document.getElementById('tutorialclose')!.addEventListener('click',()=>this.close());
    document.getElementById('tutorialnext')!.addEventListener('click',()=>{
      if(++this.index===steps.length){this.close();return;}this.show();
    });
    document.getElementById('tutorialback')!.addEventListener('click',()=>{if(this.index>0){this.index--;this.show();}});
    addEventListener('keydown',e=>{if(e.key==='Escape'&&this.index>=0){this.close();e.preventDefault();}});
  }
  record(action:Action){
    if(this.index<0||steps[this.index].action!==action||this.done)return;
    this.done=true;
    document.getElementById('tutorialprogress')!.textContent='Nice—that control worked. Continue when you’re ready.';
    document.getElementById('tutorialnext')!.textContent=this.index===steps.length-1?'Finish':'Next';
  }
  private show(){
    this.done=false;
    const step=steps[this.index],touch=document.documentElement.classList.contains('touch-input');
    document.getElementById('tutorial')!.hidden=false;
    document.getElementById('tutorialtitle')!.textContent=`${this.index+1} / ${steps.length} · ${step.title}`;
    document.getElementById('tutorialbody')!.textContent=touch?step.touch:step.desktop;
    document.getElementById('tutorialprogress')!.textContent='Try it on the table, or skip this step.';
    document.getElementById('tutorialnext')!.textContent=this.index===steps.length-1?'Finish':'Skip step';
    (document.getElementById('tutorialback') as HTMLButtonElement).disabled=this.index===0;
    document.querySelectorAll('.tutorial-focus').forEach(e=>e.classList.remove('tutorial-focus'));
    document.getElementById(step.action==='shot'&&!touch?'chargebar':step.target)?.classList.add('tutorial-focus');
  }
  private close(){
    this.index=-1;document.getElementById('tutorial')!.hidden=true;
    document.querySelectorAll('.tutorial-focus').forEach(e=>e.classList.remove('tutorial-focus'));
    try{localStorage.setItem('pool:tutorialSeen','1');}catch{/* private mode */}
    document.getElementById('helpbtn')!.focus();
  }
}
