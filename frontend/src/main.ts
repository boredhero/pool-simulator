import { initPrivacy } from './ui/privacy';
import { setupChangelog } from './ui/changelog';
import { Game } from './ui/game';
import { setupDraggablePanels } from './ui/draggablePanel';
import { setupCameraFly } from './ui/cameraFlyControls';
setupChangelog();
initPrivacy();
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const game = new Game(canvas);
setupDraggablePanels();
setupCameraFly(game.scene.cameraRig);
(window as unknown as { __pool: Game }).__pool = game;
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
fetch('/api/version').then(r => r.json()).then(({ version }) => {
  const el = document.getElementById('version');
  if (el && version) el.textContent = `v${version}`;
}).catch(() => {});
