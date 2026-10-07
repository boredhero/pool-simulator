import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// WPA 9ft playfield, SI meters. Table centered at origin, x = long axis.
export const TABLE_W = 2.54;
export const TABLE_H = 1.27;
export const BALL_R = 0.028575;
const RAIL_W = 0.12;
const FELT = 0x0a6c2f;

const BALL_COLORS = [
  '#f5c518', '#0d47d8', '#d82323', '#5b0d8a', '#ef6c00', '#0a7a3d', '#7a1a1a', '#111111',
  '#f5c518', '#0d47d8', '#d82323', '#5b0d8a', '#ef6c00', '#0a7a3d', '#7a1a1a',
];

function ballTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const stripe = n > 8;
  g.fillStyle = stripe ? '#f8f8f8' : BALL_COLORS[(n - 1) % 15];
  g.fillRect(0, 0, 256, 128);
  if (stripe) {
    g.fillStyle = BALL_COLORS[(n - 1) % 15];
    g.fillRect(0, 40, 256, 48);
  }
  g.fillStyle = '#f8f8f8';
  for (const x of [64, 192]) {
    g.beginPath();
    g.arc(x, 64, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    g.font = 'bold 26px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), x, 66);
    g.fillStyle = '#f8f8f8';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rackPositions(): Array<[number, number]> {
  // Apex (1-ball) at foot spot facing the head end; rows extend +x.
  const apexX = TABLE_W / 4;
  const dx = BALL_R * 2 * 0.866 + 0.0004;
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15]; // 8 center, mixed corners
  const pos: Array<[number, number]> = [];
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      const x = apexX + row * dx;
      const z = (i - row / 2) * (BALL_R * 2 + 0.0004);
      pos.push([x, z]);
    }
  }
  return pos;
}

export function init(canvas: HTMLCanvasElement): { renderer: THREE.WebGLRenderer } {
  const isCoarse = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, isCoarse ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50);
  camera.position.set(-1.4, 1.6, 1.4);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 0.6;
  controls.maxDistance = 6;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223311, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-1.5, 3, 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(isCoarse ? 512 : 1024);
  sun.shadow.camera.left = -1.8;
  sun.shadow.camera.right = 1.8;
  sun.shadow.camera.top = 1.2;
  sun.shadow.camera.bottom = -1.2;
  sun.shadow.camera.far = 8;
  scene.add(sun);

  // Felt bed.
  const felt = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_W, 0.04, TABLE_H),
    new THREE.MeshStandardMaterial({ color: FELT, roughness: 0.95 }),
  );
  felt.position.y = -0.02;
  felt.receiveShadow = true;
  scene.add(felt);

  // Wooden rails + black pockets (visual only for now).
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2c14, roughness: 0.6 });
  const railGeoLong = new THREE.BoxGeometry(TABLE_W + RAIL_W * 2, 0.07, RAIL_W);
  const railGeoShort = new THREE.BoxGeometry(RAIL_W, 0.07, TABLE_H);
  for (const z of [-TABLE_H / 2 - RAIL_W / 2, TABLE_H / 2 + RAIL_W / 2]) {
    const r = new THREE.Mesh(railGeoLong, wood);
    r.position.set(0, 0.015, z);
    r.castShadow = r.receiveShadow = true;
    scene.add(r);
  }
  for (const x of [-TABLE_W / 2 - RAIL_W / 2, TABLE_W / 2 + RAIL_W / 2]) {
    const r = new THREE.Mesh(railGeoShort, wood);
    r.position.set(x, 0.015, 0);
    r.castShadow = r.receiveShadow = true;
    scene.add(r);
  }
  const pocketMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 });
  for (const [px, pz] of [
    [-TABLE_W / 2, -TABLE_H / 2], [0, -TABLE_H / 2 - 0.02], [TABLE_W / 2, -TABLE_H / 2],
    [-TABLE_W / 2, TABLE_H / 2], [0, TABLE_H / 2 + 0.02], [TABLE_W / 2, TABLE_H / 2],
  ] as Array<[number, number]>) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 20), pocketMat);
    p.position.set(px, 0, pz);
    scene.add(p);
  }

  // Balls: cue + racked 1-15.
  const ballGeo = new THREE.SphereGeometry(BALL_R, 32, 24);
  const addBall = (x: number, z: number, n: number | null) => {
    const mat = n === null
      ? new THREE.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.25 })
      : new THREE.MeshStandardMaterial({ map: ballTexture(n), roughness: 0.25 });
    const b = new THREE.Mesh(ballGeo, mat);
    b.position.set(x, BALL_R, z);
    b.castShadow = true;
    mat.envMapIntensity = 0.9;
    scene.add(b);
  };
  addBall(-TABLE_W / 4, 0, null); // cue ball at head spot
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  rackPositions().forEach(([x, z], i) => addBall(x, z, order[i]));

  const resize = () => {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, isCoarse ? 1.5 : 2));
    renderer.setSize(w, h, false);
  };
  addEventListener('resize', resize);
  resize();

  let running = true;
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(frame);
  });
  const frame = () => {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();

  return { renderer };
}
