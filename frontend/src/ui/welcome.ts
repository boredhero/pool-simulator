import { chooseEssentialPrivacy, consent, privacyOptedOut, PRIVACY_VERSION, recordPrivacySession, savedPrivacyChoice } from './privacy';
import './welcome.css';

export const WELCOME_KEY='pool:welcome';
export const WELCOME_VERSION=PRIVACY_VERSION;
export function needsWelcome():boolean {
  try {const saved=JSON.parse(localStorage.getItem(WELCOME_KEY)??'null');return saved?.version!==WELCOME_VERSION||saved.accepted!==true;}catch{return true;}
}

/** Browser-local onboarding acknowledgment. Account TermsAcceptance remains server-owned. */
export function setupWelcome(startTutorial:()=>void):void {
  if(!needsWelcome()||document.getElementById('welcomedialog'))return;
  const dialog=document.createElement('dialog');dialog.id='welcomedialog';
  dialog.setAttribute('aria-labelledby','welcometitle');
  dialog.innerHTML=`<form id="welcomeform">
    <header class="welcome-header"><span class="welcome-eyebrow">A table. A little practice. Your next shot.</span><h1 id="welcometitle" tabindex="-1" autofocus>Welcome to Play Pool</h1><p>Play solo, challenge the CPU, or invite a friend. Sign in when you’re ready to meet Jev AI.</p></header>
    <div class="welcome-body">
      <section class="welcome-practice"><strong>Start with a quick practice</strong><p>Get comfortable with aiming, spin, your camera, and shooting before your first game.</p><p id="welcomeinvite" hidden>Your invite is ready in Online. You can practice first or go straight to joining your friend.</p></section>
      <label id="welcomeprofilelabel" class="welcome-profile">Your controls<select id="welcomeprofile"><option value="mouse">Mouse &amp; Keyboard Mode</option><option value="trackpad">Trackpad Mode</option></select></label>
      <p id="welcomecontrols" class="welcome-controls"></p>
      <div class="welcome-choice"><input id="welcometerms" type="checkbox" required><label for="welcometerms">I am 18 or older and accept the <a href="/terms.html" target="_blank" rel="noopener">Terms of Service</a>.</label></div>
      <div id="welcomeanalyticschoice" class="welcome-choice"><input id="welcomeanalytics" type="checkbox"><label for="welcomeanalytics">Allow optional usage analytics <span>Help improve the game with feature-use sessions and device type. No account identity, IP address, typing, or advertising trackers. You can change this in Privacy choices.</span></label></div>
      <p id="welcomeprivacy-note" class="welcome-small"></p>
      <a class="welcome-privacy-link" href="/privacy.html" target="_blank" rel="noopener">Read the Privacy Notice</a>
      <p id="welcomestatus" role="status" aria-live="polite"></p>
    </div>
    <footer class="welcome-footer"><p>We recommend the tutorial—it’s the easiest way to find your shot.</p><div><button id="welcometutorial" type="submit" disabled>Start quick tutorial</button><button id="welcomeplay" type="button" disabled>Just play</button></div></footer>
  </form>`;
  document.body.append(dialog);
  const get=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>('#'+id)!;
  const agreement=get<HTMLInputElement>('welcometerms'),analytics=get<HTMLInputElement>('welcomeanalytics');
  const profile=get<HTMLSelectElement>('welcomeprofile'),primary=get<HTMLButtonElement>('welcometutorial'),secondary=get<HTMLButtonElement>('welcomeplay');
  const touch=matchMedia('(pointer:coarse)').matches||document.documentElement.classList.contains('touch-input');
  if(touch)document.documentElement.classList.add('touch-input');
  const cameraProfile=document.getElementById('camera-input-profile') as HTMLSelectElement|null;
  profile.value=cameraProfile?.value??'mouse';
  get('welcomeprofilelabel').hidden=touch;
  const describe=()=>{
    get('welcomecontrols').textContent=touch?'Touch controls: drag to aim, set your power, then tap Shoot. Two fingers move your camera.':profile.value==='trackpad'?'Trackpad: move to aim, pull back and release to shoot. Two-finger scroll orbits; pinch zooms.':'Mouse & keyboard: move to aim, pull back and release to shoot. Right-drag orbits; the wheel zooms.';
  };
  describe();
  profile.addEventListener('change',()=>{
    if(cameraProfile){cameraProfile.value=profile.value;cameraProfile.dispatchEvent(new Event('change',{bubbles:true}));}
    describe();
  });
  get('welcomeinvite').hidden=!(new URLSearchParams(location.hash.slice(1)).has('join')||new URLSearchParams(location.search).has('join'));
  const saved=savedPrivacyChoice(),respectSaved=saved?.allow===true&&!privacyOptedOut();
  if(privacyOptedOut()){
    analytics.disabled=true;get('welcomeanalyticschoice').hidden=true;
    get('welcomeprivacy-note').textContent='Your browser requests no optional tracking. Analytics will stay off.';
  } else if(respectSaved){
    get('welcomeanalyticschoice').hidden=true;
    get('welcomeprivacy-note').textContent='Your saved analytics preference is enabled. You can change it at any time in Privacy choices.';
  } else get('welcomeprivacy-note').textContent='Analytics is optional and starts off. Playing and the tutorial work without it.';
  document.getElementById('privacynotice')!.hidden=true;
  document.getElementById('helppanel')?.classList.remove('open');
  document.getElementById('helpbtn')?.setAttribute('aria-expanded','false');
  let busy=false;
  const refresh=()=>{primary.disabled=secondary.disabled=busy||!agreement.checked;agreement.disabled=busy;analytics.disabled=busy||privacyOptedOut();profile.disabled=busy;};
  agreement.addEventListener('change',refresh);
  const proceed=async(tutorial:boolean)=>{
    if(busy||!agreement.checked)return;
    busy=true;refresh();get('welcomestatus').textContent='';
    try {
      if(!respectSaved){
        if(analytics.checked&&!privacyOptedOut()){await consent(true);recordPrivacySession();}
        else chooseEssentialPrivacy();
      }
      // Acceptance is explicit and local; it never substitutes for account/Jev terms.
      try {localStorage.setItem(WELCOME_KEY,JSON.stringify({version:WELCOME_VERSION,accepted:true}));localStorage.setItem('pool:help-dismissed','1');}catch{/* session works without persistent storage */}
      dialog.close();
      if(tutorial)startTutorial();
      else if(!get('welcomeinvite').hidden)document.getElementById('joinbtn')?.focus();
      else document.getElementById('game-canvas')?.focus();
    } catch(error){
      get('welcomestatus').textContent=(error instanceof Error?error.message:'Could not save your choice.')+' Try again, or uncheck analytics to continue without it.';
    } finally {busy=false;refresh();}
  };
  get<HTMLFormElement>('welcomeform').addEventListener('submit',event=>{event.preventDefault();void proceed(true);});
  secondary.addEventListener('click',()=>void proceed(false));
  dialog.addEventListener('cancel',event=>event.preventDefault());
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  dialog.showModal();
}
