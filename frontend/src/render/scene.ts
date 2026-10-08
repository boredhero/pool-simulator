import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BALL_R, POCKETS, TABLE_H, TABLE_W } from '../sim/table';

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
  /** Sync ball meshes from sim state (rolls them by their spin state). */
  setBalls(
    list: Array<{ n: number | null; x: number; y: number; potted: boolean; wx: number; wy: number; wz: number }>,
    dt: number,
  ): void;
  /** Cue stick. pull in meters of drawback. */
  setCue(visible: boolean, cx: number, cy: number, angle: number, pull: number): void;
  /** Ball-in-hand placement preview: legal-zone outline + cursor ring. */
  setPlace(visible: boolean, x: number, y: number, legal: boolean): void;
  /** Felt + wood theme colors (css color strings). */
  setTheme(felt: string, wood: string): void;
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
  // Left press is shoot/aim (game handles it); orbit on right-drag + wheel + two fingers.
  controls.mouseButtons = {
    LEFT: -1 as unknown as THREE.MOUSE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: -1 as unknown as THREE.TOUCH,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223311, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-1.5, 3, 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(isCoarse ? 512 : 1024);
  Object.assign(sun.shadow.camera, { left: -1.8, right: 1.8, top: 1.2, bottom: -1.2, far: 8 });
  scene.add(sun);

  // --- Procedural textures: felt nap + wood grain (no downloads). ---
  const shade = (hex: string, f: number): string => {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
    const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
    const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
    return `rgb(${r},${g},${b})`;
  };
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  /** Woven cloth: base + per-pixel nap noise + faint directional streaks. */
  function feltTextures(base: string): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    // Nap speckle.
    for (let i = 0; i < 30000; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.fillStyle = rnd() < 0.5 ? shade(base, 0.82 + rnd() * 0.1) : shade(base, 1.06 + rnd() * 0.14);
      g.globalAlpha = 0.3 + rnd() * 0.35;
      g.fillRect(x, y, 2, 2);
    }
    // Nap direction streaks (along x).
    g.globalAlpha = 1;
    for (let i = 0; i < 130; i++) {
      const y = rnd() * S;
      g.strokeStyle = rnd() < 0.5 ? shade(base, 0.92) : shade(base, 1.08);
      g.globalAlpha = 0.05 + rnd() * 0.06;
      g.lineWidth = 0.8 + rnd() * 1.6;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(S * 0.3, y + (rnd() - 0.5) * 6, S * 0.7, y + (rnd() - 0.5) * 6, S, y);
      g.stroke();
    }
    g.globalAlpha = 1;
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(2, 1);
    map.anisotropy = 4;
    const bump = new THREE.CanvasTexture(c);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(2, 1);
    return { map, bump };
  }

  /** Lacquered wood: long grain streaks + dark pores over base. */
  function woodTexture(base: string): THREE.CanvasTexture {
    const W = 512, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const y = rnd() * H;
      g.strokeStyle = rnd() < 0.6 ? shade(base, 0.72 + rnd() * 0.15) : shade(base, 1.12 + rnd() * 0.12);
      g.globalAlpha = 0.16 + rnd() * 0.22;
      g.lineWidth = 0.7 + rnd() * 2.2;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 + (rnd() - 0.5) * 3);
      g.stroke();
    }
    // Pores.
    g.globalAlpha = 1;
    for (let i = 0; i < 900; i++) {
      g.fillStyle = shade(base, 0.6 + rnd() * 0.2);
      g.globalAlpha = 0.2 + rnd() * 0.25;
      g.fillRect(rnd() * W, rnd() * H, 2.2, 1);
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  let feltTex = feltTextures('#0a6c2f');
  const feltMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: feltTex.map, bumpMap: feltTex.bump, bumpScale: 0.6,
    roughness: 0.96, sheen: 1.0, sheenColor: new THREE.Color(0x8fae9a),
    sheenRoughness: 0.42, envMapIntensity: 0.15,
  });
  const felt = new THREE.Mesh(new THREE.BoxGeometry(TABLE_W, 0.04, TABLE_H), feltMat);
  felt.position.y = -0.02;
  felt.receiveShadow = true;
  scene.add(felt);
  const feltPlane = new THREE.PlaneGeometry(TABLE_W + 0.3, TABLE_H + 0.3);
  const feltHit = new THREE.Mesh(feltPlane, new THREE.MeshBasicMaterial({ visible: false }));
  feltHit.rotation.x = -Math.PI / 2;
  scene.add(feltHit);

  let woodTex = woodTexture('#4a2c14');
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: woodTex, roughness: 0.42, envMapIntensity: 0.7,
  });
  const rails: THREE.Mesh[] = [];
  // Rail segments between pockets (matching sim cushions) so holes sit in
  // real gaps instead of hiding under full-length boxes.
  {
    const segs: Array<[number, number, number, number, boolean]> = [
      [0.0572, 0, 0.5715, 0, true], [0.6985, 0, 2.4828, 0, true],
      [0.0572, 1.27, 0.5715, 1.27, true], [0.6985, 1.27, 2.4828, 1.27, true],
      [0, 0.0572, 0, 1.2128, false], [2.54, 0.0572, 2.54, 1.2128, false],
    ];
    for (const [x1, y1, x2, y2, alongX] of segs) {
      const [ax, az] = toRender(x1, y1);
      const [bx, bz] = toRender(x2, y2);
      const len = Math.hypot(bx - ax, bz - az) + 0.06;
      const geo = alongX
        ? new THREE.BoxGeometry(len, 0.07, RAIL_W)
        : new THREE.BoxGeometry(RAIL_W, 0.07, len);
      const r = new THREE.Mesh(geo, woodMat);
      // Wood sits outside the cushion nose line.
      const out = RAIL_W / 2;
      const sideX = x1 === x2 ? (x1 < TABLE_W / 2 ? -out : out) : 0;
      const sideZ = y1 === y2 ? ((y1 < TABLE_H / 2 ? -out : out)) : 0;
      r.position.set((ax + bx) / 2 + sideX, 0.015, (az + bz) / 2 + sideZ);
      r.castShadow = r.receiveShadow = true;
      scene.add(r);
      rails.push(r);
    }
  }
  // Diamond sights: mother-of-pearl dots at 1/8th points, skipping pockets.
  // One InstancedMesh for all 18 (single draw call).
  {
    const spots: Array<[number, number]> = [];
    for (let i = 1; i < 8; i++) {
      const fx = -TABLE_W / 2 + (TABLE_W * i) / 8;
      if (Math.abs(fx) < 0.1) continue; // side pocket
      if (TABLE_W / 2 - Math.abs(fx) < 0.12) continue; // corners
      spots.push([fx, -TABLE_H / 2 - RAIL_W / 2]);
      spots.push([fx, TABLE_H / 2 + RAIL_W / 2]);
    }
    for (let i = 1; i < 4; i++) {
      const fz = -TABLE_H / 2 + (TABLE_H * i) / 4;
      if (TABLE_H / 2 - Math.abs(fz) < 0.12) continue; // corners
      spots.push([-TABLE_W / 2 - RAIL_W / 2, fz]);
      spots.push([TABLE_W / 2 + RAIL_W / 2, fz]);
    }
    const dia = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.008, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.3, envMapIntensity: 1.2 }),
      spots.length,
    );
    const m4 = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    spots.forEach(([x, z], i) => {
      m4.copy(rot).setPosition(x, 0.051, z);
      dia.setMatrixAt(i, m4);
    });
    dia.instanceMatrix.needsUpdate = true;
    scene.add(dia);
  }
  // Pocket holes: dark radialgradient discs sunk at felt level + leather rim,
  // centered on the sim capture points (not the rail corners).
  const pocketCenters: Array<[number, number, number]> = [];
  {
    const hc = document.createElement('canvas');
    hc.width = hc.height = 128;
    const hg = hc.getContext('2d')!;
    const grad = hg.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, '#000000');
    grad.addColorStop(0.55, '#050505');
    grad.addColorStop(0.8, '#0d0a06');
    grad.addColorStop(1, 'rgba(20,12,6,0)');
    hg.fillStyle = grad;
    hg.fillRect(0, 0, 128, 128);
    const holeTex = new THREE.CanvasTexture(hc);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x1a120b, roughness: 0.85 });
    for (const p of POCKETS) {
      const [rx, rz] = toRender(p.x, p.y);
      pocketCenters.push([rx, rz, p.r]);
      const rim = new THREE.Mesh(new THREE.RingGeometry(p.r * 0.92, p.r * 1.18, 28), rimMat);
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(rx, 0.0016, rz);
      rim.receiveShadow = true;
      scene.add(rim);
      const hole = new THREE.Mesh(
        new THREE.CircleGeometry(p.r * 1.02, 28),
        new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false }),
      );
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(rx, 0.0012, rz);
      scene.add(hole);
    }
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
    setBalls(list, dt) {
      const axis = new THREE.Vector3();
      for (const b of list) {
        const m = getMesh(b.n);
        const [rx, rz] = toRender(b.x, b.y);
        m.position.set(rx, BALL_R, rz);
        m.visible = !b.potted;
        if (!b.potted) {
          // Lip dip: balls sink as their center crosses into the pocket mouth.
          let dip = 0;
          for (const [px, pz, pr] of pocketCenters) {
            const d = Math.hypot(rx - px, rz - pz);
            if (d < pr * 1.5) dip = Math.max(dip, 1 - d / (pr * 1.5));
          }
          m.position.y = BALL_R - dip * dip * 0.024;
        }
        if (!b.potted && dt > 0) {
          // Sim (x right, y plan, z up) -> render (x right, y up, z plan):
          // axis swap + sign flip from the handedness change.
          axis.set(-b.wx, -b.wz, -b.wy);
          const w = axis.length();
          if (w > 1e-3) m.rotateOnWorldAxis(axis.normalize(), Math.min(w * dt, 0.5));
        }
      }
    },
    setTheme(felt, wood) {
      const oldMap = feltMat.map, oldBump = feltMat.bumpMap;
      feltTex = feltTextures(felt);
      feltMat.map = feltTex.map;
      feltMat.bumpMap = feltTex.bump;
      feltMat.needsUpdate = true;
      oldMap?.dispose();
      if (oldBump && oldBump !== oldMap) oldBump.dispose();
      const oldWood = woodMat.map;
      woodTex = woodTexture(wood);
      woodMat.map = woodTex;
      woodMat.needsUpdate = true;
      oldWood?.dispose();
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
