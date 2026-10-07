import { init } from './render/scene';
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
init(canvas);
fetch('/api/version').then(r => r.json()).then(({ version }) => {
  const el = document.getElementById('version');
  if (el && version) el.textContent = `v${version}`;
}).catch(() => {});
console.log('pool-simulator scaffold ok');
