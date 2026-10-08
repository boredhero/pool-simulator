import {setupInstallApp} from './ui/installApp';
import './ui/closeButton.css';
import { initPrivacy } from './ui/privacy';
import { needsWelcome, setupWelcome } from './ui/welcome';
import { setupChangelog } from './ui/changelog';
import { Game } from './ui/game';
import { setupDraggablePanels } from './ui/draggablePanel';
import { setupMobileHud } from './ui/mobileHud';
import { setupCameraFly } from './ui/cameraFlyControls';
setupInstallApp();
setupChangelog();
initPrivacy({deferNotice:needsWelcome()});
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const game = new Game(canvas);
setupDraggablePanels();
setupCameraFly(game.scene.cameraRig);
setupMobileHud();
setupWelcome(()=>game.tutorial.start());
(window as unknown as { __pool: Game }).__pool = game;
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
fetch('/api/version').then(r => r.json()).then(({ version }) => {
  const el = document.getElementById('version');
  if (el && version) el.textContent = `v${version}`;
}).catch(() => {});
