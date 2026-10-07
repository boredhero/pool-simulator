import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BALL_R, TABLE_H, TABLE_W } from '../sim/table';

// WPA 9ft visuals. Sim space [0,W]x[0,H] maps to render (x-W/2, z=y-H/2).
export const toRender = (x: number, y: number): [number, number] => [x - TABLE_W / 2, y - TABLE_H / 2];
export const toSim = (rx: number, rz: number): [number, number] => [rx + TABLE_W / 2, rz + TABLE_H / 2];

const RAIL_W = 0.12;
const BALL_COLORS = [
  '#f5c518', '#0d47d8', '#d82323', '#5b0d8a', '#ef6c00', '#0a7a3d', '#7a1a1a', '#111111',
  '#f5c518', '#0d47d8', '#d82323', '#5b0d8a', '#ef6c00', '#0a7a3d', '#7a1a1a',
];

function ballTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  const stripe = n > 8;
  g.fillStyle = stripe ? '#f8f8f8' : BALL_COLORS[(n - 1) % 15];
  g.fillRect(0, 0, 256, 128);
  if (stripe) {
    g.fillStyle = BALL_COLORS[(n - 1) % 15];
    g.fillRect(0, 40, 256, 48);
  }
  for (const x of [64, 192]) {
    g.fillStyle = '#f8f8f8';
    g.beginPath(); g.arc(x, 64, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111';
    g.font = 'bold 26px system-ui';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), x, 66);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface AimGhost { gx: number; gy: number; ox: number; oy: number; hasHit: boolean }

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Sync ball meshes from sim state. */
  setBalls(list: Array<{ n: number | null; x: number; y: number; potted: boolean }>): void;
  /** Aim line + ghost ball. Angles in sim plane radians. */
  setAim(visible: boolean, cx: number, cy: number, angle: number, ghost: AimGhost): void;
  /** Cue stick. pull in meters of drawback. */
  setCue(visible: boolean, cx: number, cy: number, angle: number, pull: number): void;
  /** Raycast pointer to felt plane, sim coords or null. */
  pickFelt(clientX: number, clientY: number): [number, number] | null;
  onFrame(cb: () => void): void;
}

export function init(canvas: HTMLCanvasElement): SceneHandle {
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
  Object.assign(sun.shadow.camera, { left: -1.8, right: 1.8, top: 1.2, bottom: -1.2, far: 8 });
  scene.add(sun);

  const felt = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_W, 0.04, TABLE_H),
    new THREE.MeshStandardMaterial({ color: 0x0a6c2f, roughness: 0.95 }),
  );
  felt.position.y = -0.02;
  felt.receiveShadow = true;
  scene.add(felt);
  const feltPlane = new THREE.PlaneGeometry(TABLE_W + 0.3, TABLE_H + 0.3);
  const feltHit = new THREE.Mesh(feltPlane, new THREE.MeshBasicMaterial({ visible: false }));
  feltHit.rotation.x = -Math.PI / 2;
  scene.add(feltHit);

  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2c14, roughness: 0.6 });
  const railLong = new THREE.BoxGeometry(TABLE_W + RAIL_W * 2, 0.07, RAIL_W);
  const railShort = new THREE.BoxGeometry(RAIL_W, 0.07, TABLE_H);
  for (const z of [-TABLE_H / 2 - RAIL_W / 2, TABLE_H / 2 + RAIL_W / 2]) {
    const r = new THREE.Mesh(railLong, wood);
    r.position.set(0, 0.015, z);
    r.castShadow = r.receiveShadow = true;
    scene.add(r);
  }
  for (const x of [-TABLE_W / 2 - RAIL_W / 2, TABLE_W / 2 + RAIL_W / 2]) {
    const r = new THREE.Mesh(railShort, wood);
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

  // Ball meshes keyed by number ('cue' for cue ball).
  const ballGeo = new THREE.SphereGeometry(BALL_R, 32, 24);
  const meshes = new Map<string, THREE.Mesh>();
  const getMesh = (n: number | null): THREE.Mesh => {
    const key = n === null ? 'cue' : `b${n}`;
    let m = meshes.get(key);
    if (!m) {
      const mat = n === null
        ? new THREE.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.25 })
        : new THREE.MeshStandardMaterial({ map: ballTexture(n), roughness: 0.25 });
      mat.envMapIntensity = 0.9;
      m = new THREE.Mesh(ballGeo, mat);
      m.castShadow = true;
      meshes.set(key, m);
      scene.add(m);
    }
    return m;
  };

  // Aim line + ghost ball + object direction tick.
  const aimMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
  const aimLine = new THREE.Line(new THREE.BufferGeometry(), aimMat);
  aimLine.frustumCulled = false;
  scene.add(aimLine);
  const ghost = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  scene.add(ghost);
  const tickLine = new THREE.Line(new THREE.BufferGeometry(), aimMat.clone());
  tickLine.frustumCulled = false;
  scene.add(tickLine);

  // Cue stick.
  const cueGroup = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.009, 1.1, 12),
    new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.5 }),
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.55 + BALL_R + 0.01;
  cueGroup.add(shaft);
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0062, 0.0062, 0.012, 12),
    new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.8 }),
  );
  tip.rotation.x = Math.PI / 2;
  tip.position.z = BALL_R + 0.008;
  cueGroup.add(tip);
  cueGroup.position.y = BALL_R;
  scene.add(cueGroup);

  const ray = new THREE.Raycaster();
  const pickFelt = (clientX: number, clientY: number): [number, number] | null => {
    const r = canvas.getBoundingClientRect();
    const nd = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    ray.setFromCamera(nd, camera);
    const hit = ray.intersectObject(feltHit, false)[0];
    if (!hit) return null;
    return toSim(hit.point.x, hit.point.z);
  };

  const setPoints = (line: THREE.Line, pts: Array<[number, number, number]>) => {
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  };

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
  const cbs: Array<() => void> = [];
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(frame);
  });
  const frame = () => {
    if (!running) return;
    controls.update();
    for (const cb of cbs) cb();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();

  return {
    renderer,
    controls,
    setBalls(list) {
      for (const b of list) {
        const m = getMesh(b.n);
        const [rx, rz] = toRender(b.x, b.y);
        m.position.set(rx, BALL_R, rz);
        m.visible = !b.potted;
      }
    },
    setAim(visible, cx, cy, angle, g) {
      aimLine.visible = ghost.visible = tickLine.visible = visible;
      if (!visible) return;
      const [cxr, czr] = toRender(cx, cy);
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const len = g.hasHit ? Math.hypot(g.gx - cx, g.gy - cy) : 1.2;
      const [exr, ezr] = toRender(cx + dx * len, cy + dy * len);
      setPoints(aimLine, [[cxr, BALL_R, czr], [exr, BALL_R, ezr]]);
      if (g.hasHit) {
        const [gxr, gzr] = toRender(g.gx, g.gy);
        ghost.position.set(gxr, BALL_R, gzr);
        const [oxr, ozr] = toRender(g.gx + g.ox * 0.18, g.gy + g.oy * 0.18);
        setPoints(tickLine, [[gxr, BALL_R, gzr], [oxr, BALL_R, ozr]]);
      }
    },
    setCue(visible, cx, cy, angle, pull) {
      cueGroup.visible = visible;
      if (!visible) return;
      const [rx, rz] = toRender(cx, cy);
      const dx = Math.cos(angle), dy = Math.sin(angle);
      // Stick extends local +z; point it back along -aim, shifted by pull-back.
      cueGroup.rotation.y = Math.atan2(-dx, -dy);
      cueGroup.position.set(rx - dx * pull, BALL_R, rz - dy * pull);
    },
    pickFelt,
    onFrame(cb) { cbs.push(cb); },
  };
}
