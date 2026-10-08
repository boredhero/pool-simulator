import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { cueElevation, CUE_LENGTH } from './cuePose';
import { RAIL_W, CUSHION_W, bedGeometry, surroundGeometry } from './tableGeometry';
import { BALL_R, POCKETS, TABLE_H, TABLE_W, cushions, jaws } from '../sim/table';

// WPA 9ft visuals. Sim space [0,W]x[0,H] maps to render (x-W/2, z=y-H/2).
export const toRender = (x: number, y: number): [number, number] => [x - TABLE_W / 2, y - TABLE_H / 2];
export const toSim = (rx: number, rz: number): [number, number] => [rx + TABLE_W / 2, rz + TABLE_H / 2];

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
    list: Array<{ n: number | null; x: number; y: number; z: number; potted: boolean; wx: number; wy: number; wz: number }>,
    dt: number,
  ): void;
  /** Cue stick. pull in meters of drawback. */
  setCue(visible: boolean, cx: number, cy: number, angle: number, pull: number, tipX?: number, tipY?: number): void;
  /** Ball-in-hand placement preview: legal-zone outline + cursor ring. */
  setPlace(visible: boolean, x: number, y: number, legal: boolean, zone?: string): void;
  setCall(pocket: number | null, visible: boolean): void;
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
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x100e0c);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = new RoomEnvironment();
  scene.environment = pmrem.fromScene(environment, 0.04).texture;
  scene.environmentIntensity = 0.45;
  environment.dispose();
  pmrem.dispose();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50);
  camera.position.set(-1.8, 2.5, 2.0);
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
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Broad amber overhead illumination, like a shaded billiard lamp. The
  // low room fill preserves contrast without turning the ball colors orange.
  scene.add(new THREE.HemisphereLight(0xffe8ce, 0x24170f, 0.35));
  RectAreaLightUniformsLib.init();
  const lamp = new THREE.RectAreaLight(0xffd6a0, 2, 1.9, 0.75);
  lamp.position.set(0, 1.65, 0);
  lamp.lookAt(0, 0, 0);
  scene.add(lamp);
  // Two bulbs inside the same shade footprint cast overlapping, soft-edged
  // shadow maps. Distance falloff and feathered cones concentrate light on
  // the cloth, instead of lighting the scene like an outdoor sun.
  for (const x of [-0.55, 0.55]) {
    const bulb = new THREE.SpotLight(0xffdfaf, 3.5, 6, 0.9, 0.65, 2);
    bulb.position.set(x, 1.65, 0);
    bulb.target.position.set(x, 0, 0);
    bulb.castShadow = true;
    bulb.shadow.mapSize.setScalar(isCoarse ? 1024 : 2048);
    bulb.shadow.camera.near = 0.1;
    bulb.shadow.camera.far = 6;
    bulb.shadow.radius = 2;
    bulb.shadow.normalBias = 0.0002;
    bulb.shadow.bias = -0.00005;
    scene.add(bulb, bulb.target);
  }

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
    color: 0xffffff, map: feltTex.map, bumpMap: feltTex.bump, bumpScale: 0.0006,
    roughness: 0.96, sheen: 0.3, sheenColor: new THREE.Color(0x8fae9a),
    sheenRoughness: 0.42, envMapIntensity: 0.15,
  });
  const bedGeo = bedGeometry();
  const felt = new THREE.Mesh(bedGeo, feltMat);
  felt.receiveShadow = true;
  scene.add(felt);
  const feltPlane = new THREE.PlaneGeometry(TABLE_W + 0.3, TABLE_H + 0.3);
  const feltHit = new THREE.Mesh(feltPlane, new THREE.MeshBasicMaterial({ visible: false }));
  feltHit.rotation.x = -Math.PI / 2;
  scene.add(feltHit);

  let woodTex = woodTexture('#4a2c14');
  const woodMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: woodTex, roughness: 0.7, envMapIntensity: 0.2, specularIntensity: 0.3,
  });
  const surroundGeo = surroundGeometry();
  const frameMesh = new THREE.Mesh(surroundGeo, woodMat);
  frameMesh.castShadow = frameMesh.receiveShadow = true;
  scene.add(frameMesh);

  // Cushion noses use the collision segments, so all six mouths line up.
  // The bed and cushion cloth share textures, finish, and theme updates.
  const cushionMat = feltMat;
  for (const { x1, y1, x2, y2 } of cushions()) {
    const alongX = y1 === y2;
    const [ax, az] = toRender(x1, y1);
    const [bx, bz] = toRender(x2, y2);
    const len = Math.hypot(bx - ax, bz - az);
    const nx = alongX ? 0 : x1 === 0 ? -1 : 1;
    const nz = alongX ? (y1 === 0 ? -1 : 1) : 0;
    // Sloped cloth face: the nose is 0.036 m above the bed; the
    // cushion rises to meet the wooden rail, with clearance under the nose.
    const profile = new THREE.Shape();
    profile.moveTo(0, 0.036);
    profile.lineTo(CUSHION_W, 0.049);
    profile.lineTo(CUSHION_W, 0.004);
    profile.lineTo(0.008, 0.012);
    profile.closePath();
    const geo = new THREE.ExtrudeGeometry(profile, { depth: len, bevelEnabled: false });
    // Use meters for cloth UVs, as on the bed, rather than stretching one
    // texture across the length of each cushion.
    const positions = geo.getAttribute('position');
    const clothUV = geo.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) {
      const along = positions.getZ(i);
      const across = positions.getX(i) + positions.getY(i);
      clothUV.setXY(i, alongX ? along : across, alongX ? across : along);
    }
    const rail = new THREE.Mesh(geo, cushionMat);
    const tangent = new THREE.Vector3(-nz, 0, nx);
    rail.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(nx, 0, nz), new THREE.Vector3(0, 1, 0), tangent));
    // Choose the endpoint which lets positive local z run along the segment.
    rail.position.set(tangent.x + tangent.z > 0 ? ax : bx, 0, tangent.x + tangent.z > 0 ? az : bz);
    rail.castShadow = rail.receiveShadow = true;
    scene.add(rail);
  }
  const jawList = jaws();
  const jawGeo = new THREE.CylinderGeometry(1, 1, 1, 32);
  const jawUV = jawGeo.getAttribute('uv');
  for (let i = 0; i < jawUV.count; i++) jawUV.setXY(i, jawUV.getX(i) * 2 * Math.PI * 0.021, jawUV.getY(i) * 0.025);
  const jawMesh = new THREE.InstancedMesh(jawGeo, cushionMat, jawList.length);
  const jawMatrix = new THREE.Matrix4();
  jawList.forEach((jaw, i) => {
    const [x, z] = toRender(jaw.x, jaw.y);
    jawMatrix.makeScale(jaw.r, 0.025, jaw.r).setPosition(x, 0.026, z);
    jawMesh.setMatrixAt(i, jawMatrix);
  });
  jawMesh.instanceMatrix.needsUpdate = true;
  jawMesh.castShadow = jawMesh.receiveShadow = true;
  scene.add(jawMesh);
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
      new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.65, envMapIntensity: 0.35 }),
      spots.length,
    );
    const m4 = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    spots.forEach(([x, z], i) => {
      m4.copy(rot).setPosition(x, 0.054, z);
      dia.setMatrixAt(i, m4);
    });
    dia.instanceMatrix.needsUpdate = true;
    scene.add(dia);
  }
  // Recessed wells, with open tops and leather lips, remain visible while
  // orbiting. Their bottoms sit below the cut bed instead of over the felt.
  const pocketCenters: Array<[number, number, number]> = [];
  const pocketMat = new THREE.MeshBasicMaterial({ color: 0x070605, side: THREE.DoubleSide });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x24180f, roughness: 0.9, side: THREE.DoubleSide });
  for (const p of POCKETS) {
    const [rx, rz] = toRender(p.x, p.y);
    pocketCenters.push([rx, rz, p.r]);
    const rim = new THREE.Mesh(new THREE.RingGeometry(p.r, p.r + 0.009, 48), rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(rx, 0.001, rz);
    rim.receiveShadow = true;
    scene.add(rim);
    const well = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 0.85, 0.13, 48, 1, true), pocketMat);
    well.position.set(rx, -0.065, rz);
    scene.add(well);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(p.r * 0.85, 48), pocketMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(rx, -0.13, rz);
    scene.add(bottom);
  }

  const facingVertices: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => facingVertices.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const p of POCKETS) {
    const radius = p.r + 0.012;
    for (let i = 0; i < 96; i++) {
      const a = i * Math.PI * 2 / 96, b = (i + 1) * Math.PI * 2 / 96;
      const mx = p.x + radius * Math.cos((a + b) / 2), my = p.y + radius * Math.sin((a + b) / 2);
      // Leave the entry across the cloth unobstructed.
      if (mx > -CUSHION_W && mx < TABLE_W + CUSHION_W && my > -CUSHION_W && my < TABLE_H + CUSHION_W) continue;
      const pt = (angle: number, r: number, h: number) => [p.x + r * Math.cos(angle) - TABLE_W / 2, h, p.y + r * Math.sin(angle) - TABLE_H / 2];
      quad(pt(a, radius - 0.005, 0), pt(b, radius - 0.005, 0), pt(b, radius - 0.005, 0.053), pt(a, radius - 0.005, 0.053));
      quad(pt(a, radius - 0.005, 0.053), pt(b, radius - 0.005, 0.053), pt(b, radius + 0.009, 0.053), pt(a, radius + 0.009, 0.053));
    }
  }
  const facingGeo = new THREE.BufferGeometry();
  facingGeo.setAttribute('position', new THREE.Float32BufferAttribute(facingVertices, 3));
  facingGeo.computeVertexNormals();
  const facings = new THREE.Mesh(facingGeo, rimMat);
  facings.receiveShadow = true;
  scene.add(facings);

  // Ball meshes keyed by number ('cue' for cue ball).
  const ballGeo = new THREE.SphereGeometry(BALL_R, 32, 24);
  const meshes = new Map<string, THREE.Mesh>();
  const getMesh = (n: number | null): THREE.Mesh => {
    const key = n === null ? 'cue' : `b${n}`;
    let m = meshes.get(key);
    if (!m) {
      const mat = n === null
        ? new THREE.MeshPhysicalMaterial({ color: 0xf8f8f8, roughness: 0.45, specularIntensity: 0.4 })
        : new THREE.MeshPhysicalMaterial({ map: ballTexture(n), roughness: 0.45, specularIntensity: 0.4 });
      mat.envMapIntensity = 0.25;
      m = new THREE.Mesh(ballGeo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
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

  const callRings = pocketCenters.map(([x, z, radius]) => {
    const material = new THREE.MeshBasicMaterial({color: 0xf5cc79, transparent:true, opacity:.65, depthTest:false});
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius * 1.04, radius * 1.20, 48), material);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x,.058,z); mesh.visible=false; mesh.renderOrder=5;
    scene.add(mesh); return mesh;
  });

  // Full-length cue, automatically elevated over obstacles.
  const SHAFT_LEN = CUE_LENGTH;
  const SHAFT_Z0 = 0.012;
  const cueGroup = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.009, SHAFT_LEN, 12),
    new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.5 }),
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = SHAFT_Z0 + SHAFT_LEN / 2;
  shaft.castShadow = true;
  cueGroup.add(shaft);
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0062, 0.0062, 0.012, 12),
    new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.8 }),
  );
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 0.006;
  tip.castShadow = true;
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

  let portrait: boolean | null = null;
  const resize = () => {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const nextPortrait = w < h;
    if (portrait !== nextPortrait) {
      portrait = nextPortrait;
      controls.target.set(0, 0, 0);
      if (portrait) camera.position.set(-2.3, 3.4, 0);
      else camera.position.set(-1.8, 2.5, 2.0);
      camera.lookAt(controls.target);
    }
    // Fit the whole surround with room for the HUD; retain the current orbit.
    for (let i = 0; i < 30; i++) {
      camera.updateMatrixWorld();
      let fits = true;
      for (const x of [-TABLE_W / 2 - RAIL_W, TABLE_W / 2 + RAIL_W]) {
        for (const z of [-TABLE_H / 2 - RAIL_W, TABLE_H / 2 + RAIL_W]) {
          const p = new THREE.Vector3(x, 0.05, z).project(camera);
          if (Math.abs(p.x) > 0.91 || Math.abs(p.y) > 0.8) fits = false;
        }
      }
      if (fits) break;
      camera.position.sub(controls.target).multiplyScalar(1.05).add(controls.target);
    }
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

  let cueObstacles: Parameters<typeof cueElevation>[4] = [];
  return {
    renderer,
    controls,
    setBalls(list, dt) {
      cueObstacles = list;
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
          m.position.y = BALL_R + b.z - (b.z < .005 ? dip * dip * 0.024 : 0);
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
    setCall(pocket, visible) {
      callRings.forEach((ring, i) => {
        ring.visible = visible && (pocket === null || pocket === i);
        ring.material.opacity = pocket === null ? .5 : 1;
      });
    },
    setPlace(visible, x, y, legal, zone = 'anywhere') {
      zoneLine.visible = visible;
      const points = zoneLine.geometry.getAttribute('position');
      const edge = zone === 'kitchen' ? TABLE_W / 4 : TABLE_W - .035;
      points.setX(1, edge - TABLE_W / 2); points.setX(2, edge - TABLE_W / 2); points.needsUpdate = true;
      ring.visible = visible;
      if (!visible) return;
      const [rx, rz] = toRender(x, y);
      ring.position.set(rx, 0.004, rz);
      ringMat.color.set(legal ? 0x4caf50 : 0xf44336);
    },
    setCue(visible, cx, cy, angle, pull, tipX = 0, tipY = 0) {
      cueGroup.visible = visible;
      if (!visible) return;
      const [rx, rz] = toRender(cx, cy);
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const elevation = cueElevation(cx, cy, angle, 0, cueObstacles);
      // Local +z is the butt. Tilt up around the ball, then yaw along -aim.
      cueGroup.rotation.set(-elevation, Math.atan2(-dx, -dy), 0, 'YXZ');
      const scale = Math.min(1, .55 / (Math.hypot(tipX, tipY) || 1));
      const tx = tipX * scale, ty = tipY * scale;
      const c = Math.sqrt(1 - tx * tx - ty * ty), ct = Math.cos(elevation), st = Math.sin(elevation);
      const along = BALL_R * (ty * st - c * ct) - pull * ct;
      cueGroup.position.set(rx + dx * along - dy * BALL_R * tx,
        BALL_R + BALL_R * (ty * ct + c * st) + pull * st,
        rz + dy * along + dx * BALL_R * tx);
    },
    pickFelt,
    onFrame(cb) { cbs.push(cb); },
  };
}
