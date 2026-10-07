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

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Sync ball meshes from sim state. */
  setBalls(list: Array<{ n: number | null; x: number; y: number; potted: boolean }>): void;
  /** Cue stick. pull in meters of drawback. */
  setCue(visible: boolean, cx: number, cy: number, angle: number, pull: number): void;
  /** Ball-in-hand placement preview: legal-zone outline + cursor ring. */
  setPlace(visible: boolean, x: number, y: number, legal: boolean): void;
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
  const rails: THREE.Mesh[] = [];
  for (const z of [-TABLE_H / 2 - RAIL_W / 2, TABLE_H / 2 + RAIL_W / 2]) {
    const r = new THREE.Mesh(railLong, wood);
    r.position.set(0, 0.015, z);
    r.castShadow = r.receiveShadow = true;
    scene.add(r);
    rails.push(r);
  }
  for (const x of [-TABLE_W / 2 - RAIL_W / 2, TABLE_W / 2 + RAIL_W / 2]) {
    const r = new THREE.Mesh(railShort, wood);
    r.position.set(x, 0.015, 0);
    r.castShadow = r.receiveShadow = true;
    scene.add(r);
    rails.push(r);
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

  // Ball-in-hand placement preview: legal-zone outline + cursor ring.
  const zonePts: Array<[number, number, number]> = [];
  {
    const m = 0.035;
    const corners: Array<[number, number]> = [
      [m, m], [TABLE_W - m, m], [TABLE_W - m, TABLE_H - m], [m, TABLE_H - m],
    ];
    for (const [sx, sy] of corners) {
      const [rx, rz] = toRender(sx, sy);
      zonePts.push([rx, 0.002, rz]);
    }
  }
  const zoneLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(zonePts.map(([x, y, z]) => new THREE.Vector3(x, y, z))),
    new THREE.LineBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.5 }),
  );
  zoneLine.visible = false;
  scene.add(zoneLine);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.8 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(BALL_R * 0.9, BALL_R * 1.25, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  // Cue stick. Shaft rescales to avoid clipping rails/balls behind the cue ball.
  const SHAFT_LEN = 1.1;
  const SHAFT_Z0 = BALL_R + 0.014;
  const cueGroup = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.009, SHAFT_LEN, 12),
    new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.5 }),
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = SHAFT_Z0 + SHAFT_LEN / 2;
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
    setPlace(visible, x, y, legal) {
      zoneLine.visible = visible;
      ring.visible = visible;
      if (!visible) return;
      const [rx, rz] = toRender(x, y);
      ring.position.set(rx, 0.004, rz);
      ringMat.color.set(legal ? 0x4caf50 : 0xf44336);
    },
    setCue(visible, cx, cy, angle, pull) {
      cueGroup.visible = visible;
      if (!visible) return;
      const [rx, rz] = toRender(cx, cy);
      const dx = Math.cos(angle), dy = Math.sin(angle);
      // Stick extends local +z; point it back along -aim, shifted by pull-back.
      cueGroup.rotation.y = Math.atan2(-dx, -dy);
      cueGroup.position.set(rx - dx * pull, BALL_R, rz - dy * pull);
      // Clip the shaft at the first rail/ball behind the cue ball.
      ray.set(
        new THREE.Vector3(rx, BALL_R, rz),
        new THREE.Vector3(-dx, 0, -dy).normalize(),
      );
      const colliders: THREE.Object3D[] = [...rails];
      for (const m of meshes.values()) if (m.visible && m !== meshes.get('cue')) colliders.push(m);
      let len = SHAFT_LEN;
      const hits = ray.intersectObjects(colliders, false);
      for (const h of hits) {
        if (h.distance > 0.06) {
          len = Math.max(0.28, Math.min(SHAFT_LEN, h.distance - 0.05 - pull));
          break;
        }
      }
      shaft.scale.y = len / SHAFT_LEN;
      shaft.position.z = SHAFT_Z0 + len / 2;
    },
    pickFelt,
    onFrame(cb) { cbs.push(cb); },
  };
}
