import { accountPreferences } from './accountPreferences';
import type { CameraRig } from '../render/cameraRig';
import './cameraFlyControls.css';

/** WASD is independent of shooting/orbit mode; the HUD pad never sends canvas gestures. */
export function setupCameraFly(rig: CameraRig): void {
  if (document.getElementById('camera-fly-hud')) return;
  const hud = document.createElement('aside');
  hud.id = 'camera-fly-hud';
  hud.setAttribute('aria-label', 'Camera movement');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = 'camera-fly-toggle';
  toggle.setAttribute('aria-label', 'Show camera controls');
  const toggleLabel=document.createElement('span');toggleLabel.className='camera-toggle-label';toggleLabel.textContent='Camera';
  const chevron=document.createElement('span');chevron.className='camera-toggle-chevron';chevron.innerHTML='<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><path d="M4 10 8 6 12 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'; chevron.setAttribute('aria-hidden','true');
  toggle.append(toggleLabel,chevron);
  toggle.title = 'Show camera controls';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'camera-fly-pad');
  const pad = document.createElement('div');
  pad.id = 'camera-fly-pad';
  pad.hidden = true;
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', 'Fly camera directions');
  const hint = document.createElement('span');
  hint.className = 'camera-fly-hint';
  hint.textContent = 'WASD · Space ↑ · Left Shift ↓ · Q/E turn';
  pad.append(hint);
  const viewActions=document.getElementById('camera-view-actions')!;
  viewActions.hidden=false;pad.append(viewActions);
  const header=document.createElement('div');header.className='camera-hud-header';
  hud.append(header,pad);
  const profile=document.createElement('select');
  profile.id='camera-input-profile';profile.setAttribute('aria-label','Camera input mode');
  for(const [value,label] of [['mouse','Mouse & Keyboard Mode'],['trackpad','Trackpad Mode']]) {
    const option=document.createElement('option');option.value=value;option.textContent=label;profile.append(option);
  }
  try { if(accountPreferences.getItem('pool:cameraInput')==='trackpad')profile.value='trackpad'; } catch { /* private mode */ }
  rig.setInputProfile(profile.value as 'mouse'|'trackpad');
  const profileHint=document.createElement('span');profileHint.id='camera-input-hint';
  profile.setAttribute('aria-describedby',profileHint.id);
  const updateHint=()=>{profileHint.textContent=profile.value==='trackpad'?'Scroll to orbit · pinch to zoom · Option-scroll to pan':'Right-drag to orbit · scroll to zoom · Alt-scroll to pan';};
  updateHint();header.append(toggle);pad.append(profileHint);
  const profileDock=document.createElement('aside');profileDock.id='camera-profile-dock';profileDock.setAttribute('aria-label','Camera input');
  const profileLabel=document.createElement('label');profileLabel.htmlFor=profile.id;profileLabel.textContent='Controls';
  profileDock.append(profileLabel,profile);
  const desktopStack=document.createElement('div');desktopStack.id='desktop-camera-stack';
  desktopStack.append(hud,profileDock);
  const legal=document.querySelector('.legal-links');if(legal)desktopStack.append(legal);
  document.body.append(desktopStack);

  const mobile = matchMedia('(max-width: 900px) and (pointer: coarse)');
  const modeButton = document.getElementById('cameramode')!;
  const moveButton = document.createElement('button');
  moveButton.id = 'mobile-move-camera';
  moveButton.type = 'button';
  moveButton.textContent = 'Move Camera';
  moveButton.setAttribute('aria-controls', 'camera-fly-hud');
  document.getElementById('morecontrols')!.before(moveButton);
  moveButton.addEventListener('click', () => {
    modeButton.click();
    // The shot tray disappears on phones; focus its replacement after the mode observer runs.
    if (mobile.matches) queueMicrotask(() => {
      if (modeButton.getAttribute('aria-pressed') === 'true') toggle.focus();
    });
  });
  const syncMobileMode = () => {
    const active = mobile.matches && modeButton.getAttribute('aria-pressed') === 'true';
    document.body.classList.toggle('mobile-camera-active', active);
    moveButton.setAttribute('aria-expanded', String(active));
    if (mobile.matches) {
      pad.hidden = !active;
      hud.classList.toggle('expanded', active);
      toggleLabel.textContent = active ? 'Done' : 'Move Camera';
      toggle.setAttribute('aria-label', active ? 'Done moving camera' : 'Move Camera');
      toggle.setAttribute('aria-expanded', String(active));
      toggle.title = 'Return to shot controls';
    } else {
      toggleLabel.textContent = 'Camera';
      toggle.setAttribute('aria-label', pad.hidden ? 'Show camera controls' : 'Hide camera controls');
    }
  };
  new MutationObserver(syncMobileMode).observe(modeButton, {attributes:true, attributeFilter:['aria-pressed']});
  mobile.addEventListener('change', () => {
    if (document.body.classList.contains('mobile-camera-active')) modeButton.click();
    pad.hidden = true;
    hud.classList.remove('expanded');
    toggle.setAttribute('aria-expanded', 'false');
    syncMobileMode();
  });
  syncMobileMode();
  const updateMobileInset = () => {
    if (!mobile.matches) return;
    const active = document.body.classList.contains('mobile-camera-active');
    const box = (active ? hud : document.querySelector('.control-tray')!).getBoundingClientRect();
    const sidePanel = innerWidth > innerHeight && !document.body.classList.contains('tutorial-practice');
    document.documentElement.style.setProperty('--above-controls', `${!sidePanel && box.height ? innerHeight - box.top + 12 : 12}px`);
  };
  const insetObserver = new ResizeObserver(updateMobileInset);
  insetObserver.observe(hud);
  insetObserver.observe(document.querySelector('.control-tray')!);
  window.addEventListener('resize', updateMobileInset);

  const keys = new Set<string>();
  const vectors: Record<string, [number, number, number, number]> = { KeyW:[1,0,0,0], KeyS:[-1,0,0,0], KeyA:[0,-1,0,0], KeyD:[0,1,0,0], Space:[0,0,1,0], ShiftLeft:[0,0,-1,0], KeyQ:[0,0,0,1], KeyE:[0,0,0,-1] };
  let pointer: { id: number; button: HTMLButtonElement; forward: number; right: number; up:number; yaw:number } | undefined;
  const blocked = (target: EventTarget | null) => !!document.querySelector('dialog[open]') ||
    target instanceof Element && !!target.closest('button,a,[role=button],[tabindex]:not(canvas),summary,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],dialog,[role="dialog"]');
  const pointerBlocked=()=>!!document.querySelector('dialog[open]');
  profile.addEventListener('change',()=>{
    stop();rig.setInputProfile(profile.value as 'mouse'|'trackpad');updateHint();
    try {accountPreferences.setItem('pool:cameraInput',profile.value);} catch { /* private mode */ }
  });
  const apply = () => {
    let forward = pointer?.forward ?? 0, right = pointer?.right ?? 0, up=pointer?.up??0, yaw=pointer?.yaw??0;
    for (const key of keys) { forward += vectors[key][0]; right += vectors[key][1]; up += vectors[key][2]; yaw += vectors[key][3]; }
    rig.setFlyInput(Math.max(-1, Math.min(1, forward)), Math.max(-1, Math.min(1, right)),Math.max(-1,Math.min(1,up)),Math.max(-1,Math.min(1,yaw)));
  };
  const releasePointer = () => {
    const held = pointer;
    pointer = undefined;
    if (held) {
      held.button.classList.remove('held');
      if (held.button.hasPointerCapture(held.id)) held.button.releasePointerCapture(held.id);
    }
    apply();
  };
  const stop = () => { keys.clear(); releasePointer(); };
  accountPreferences.subscribe(()=>{
    stop();profile.value=accountPreferences.getItem('pool:cameraInput')==='trackpad'?'trackpad':'mouse';
    rig.setInputProfile(profile.value as 'mouse'|'trackpad');updateHint();
  });
  for (const [name, symbol, forward, right, up, yaw] of [
    ['forward', '↑', 1, 0,0,0], ['left', '←', 0, -1,0,0], ['backward', '↓', -1, 0,0,0], ['right', '→', 0, 1,0,0],
    ['rise','＋',0,0,1,0], ['lower','−',0,0,-1,0], ['turn-left','↶',0,0,0,1], ['turn-right','↷',0,0,0,-1],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `camera-fly-${name}`;
    const glyph=document.createElement('span');glyph.textContent=symbol;glyph.setAttribute('aria-hidden','true');
    button.append(glyph);
    const captions:Record<string,string>={rise:'Rise',lower:'Lower','turn-left':'Turn left','turn-right':'Turn right'};
    if(captions[name]){const caption=document.createElement('small');caption.textContent=captions[name];button.append(caption);}
    button.title=`Fly camera ${name}`;
    button.setAttribute('aria-label', `Fly camera ${name}`);
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || pointerBlocked()) return;
      event.preventDefault();
      releasePointer();
      pointer = { id: event.pointerId, button, forward, right, up, yaw };
      button.setPointerCapture(event.pointerId);
      button.classList.add('held');
      // A short tap moves too, even if no animation frame occurs before release.
      rig.nudgeFly(forward, right, up, yaw);
      apply();
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(eventName, event => {
        if ((event as PointerEvent).pointerId === pointer?.id) releasePointer();
      });
    }
    button.addEventListener('click', event => {
      if (event.detail === 0 && !pointerBlocked()) rig.nudgeFly(forward, right, up, yaw);
    });
    pad.append(button);
  }
  toggle.addEventListener('click', () => {
    if (mobile.matches) { stop(); modeButton.click(); queueMicrotask(() => moveButton.focus()); return; }
    pad.hidden = !pad.hidden;
    toggle.setAttribute('aria-expanded', String(!pad.hidden));
    toggle.setAttribute('aria-label',pad.hidden?'Show camera controls':'Hide camera controls');
    toggle.title=pad.hidden?'Show camera controls':'Hide camera controls';
    hud.classList.toggle('expanded',!pad.hidden);
    if (pad.hidden) {
      stop();
      if (modeButton.getAttribute('aria-pressed') === 'true') modeButton.click();
    }
  });
  window.addEventListener('keydown', event => {
    if(event.code==='Escape'){stop();if(!mobile.matches&&!pad.hidden)toggle.click();return;}
    if(event.altKey||event.ctrlKey||event.metaKey){stop();return;}
    if (!(event.code in vectors) || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || blocked(event.target)) return;
    event.preventDefault();
    keys.add(event.code);
    apply();
  });
  window.addEventListener('keyup', event => {
    if (!keys.delete(event.code)) return;
    apply();
  });
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  document.addEventListener('focusin', event => { if (blocked(event.target)) stop(); });
  // Also handles dialogs opened while another pointer/keyboard control holds focus.
  for (const dialog of document.querySelectorAll('dialog')) {
    new MutationObserver(() => { if (dialog.open) stop(); }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }
}
