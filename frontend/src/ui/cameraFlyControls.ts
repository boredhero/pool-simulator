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
  toggle.textContent = 'Fly camera';
  toggle.title = 'Fly camera with WASD or the arrow pad';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'camera-fly-pad');
  const pad = document.createElement('div');
  pad.id = 'camera-fly-pad';
  pad.hidden = true;
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', 'Fly camera directions');
  const hint = document.createElement('span');
  hint.className = 'camera-fly-hint';
  hint.textContent = 'WASD · hold arrows';
  pad.append(hint);
  hud.append(pad, toggle);
  document.body.append(hud);

  const keys = new Set<string>();
  const vectors: Record<string, [number, number]> = { KeyW: [1, 0], KeyS: [-1, 0], KeyA: [0, -1], KeyD: [0, 1] };
  let pointer: { id: number; button: HTMLButtonElement; forward: number; right: number } | undefined;
  const blocked = (target: EventTarget | null) => !!document.querySelector('dialog[open]') ||
    target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],dialog,[role="dialog"]');
  const apply = () => {
    let forward = pointer?.forward ?? 0, right = pointer?.right ?? 0;
    for (const key of keys) { forward += vectors[key][0]; right += vectors[key][1]; }
    rig.setFlyInput(Math.max(-1, Math.min(1, forward)), Math.max(-1, Math.min(1, right)));
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
  for (const [name, symbol, forward, right] of [
    ['forward', '↑', 1, 0], ['left', '←', 0, -1], ['backward', '↓', -1, 0], ['right', '→', 0, 1],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `camera-fly-${name}`;
    button.textContent = symbol;
    button.setAttribute('aria-label', `Fly camera ${name}`);
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || blocked(event.target)) return;
      event.preventDefault();
      releasePointer();
      pointer = { id: event.pointerId, button, forward, right };
      button.setPointerCapture(event.pointerId);
      button.classList.add('held');
      // A short tap moves too, even if no animation frame occurs before release.
      rig.nudgeFly(forward, right);
      apply();
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(eventName, event => {
        if ((event as PointerEvent).pointerId === pointer?.id) releasePointer();
      });
    }
    button.addEventListener('click', event => {
      if (event.detail === 0 && !blocked(event.target)) rig.nudgeFly(forward, right);
    });
    pad.append(button);
  }
  toggle.addEventListener('click', () => {
    pad.hidden = !pad.hidden;
    toggle.setAttribute('aria-expanded', String(!pad.hidden));
    if (pad.hidden) stop();
  });
  window.addEventListener('keydown', event => {
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
