import { Game } from './ui/game';
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
new Game(canvas);
fetch('/api/version').then(r => r.json()).then(({ version }) => {
  const el = document.getElementById('version');
  if (el && version) el.textContent = `v${version}`;
}).catch(() => {});
