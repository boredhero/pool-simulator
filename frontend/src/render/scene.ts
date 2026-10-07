import * as THREE from 'three';
// WebGL2 baseline; upgrade path: `three/webgpu` WebGPURenderer with fallback.
// Adaptive: DPR min(devicePixelRatio, mobile?1.5:2), 1 light 1024/512, baked PMREM env.
export function init(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const isCoarse = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, isCoarse ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const resize = () => {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, isCoarse ? 1.5 : 2));
    renderer.setSize(w, h, false);
  };
  addEventListener('resize', resize); resize();
  return renderer;
}
