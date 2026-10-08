import {GoldCoin} from './goldCoin';
import { guideColor } from './guideColor';
import { PocketDrops } from './pocketDrop';
import { CameraRig } from './cameraRig';
import { ballTexture, type CueStyle } from './ballTextures';
import { cushionGeometry } from './cushionGeometry';
import { constrainTableCamera } from './cameraBounds';
import { createCabinet, returnPosition } from './cabinet';
import { feltTextures, woodTextures } from './surfaceTextures';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { cueElevation } from './cuePose';
import { createCue } from './cueModel';
import { createRailSights, type SightStyle } from './railSights';
import { RAIL_W, CUSHION_W, bedGeometry, surroundGeometry } from './tableGeometry';
import { BALL_R, POCKETS, TABLE_H, TABLE_W, cushions } from '../sim/table';

// WPA 9ft visuals. Sim space [0,W]x[0,H] maps to render (x-W/2, z=y-H/2).
export const toRender = (x: number, y: number): [number, number] => [x - TABLE_W / 2, y - TABLE_H / 2];
export const toSim = (rx: number, rz: number): [number, number] => [rx + TABLE_W / 2, rz + TABLE_H / 2];

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  coin: GoldCoin;
  controls: OrbitControls;
  cameraRig: CameraRig;
  /** Sync ball meshes from sim state (rolls them by their spin state). */
  setBalls(
    list: Array<{ n: number | null; x: number; y: number; z: number; potted: boolean; wx: number; wy: number; wz: number }>,
    dt: number,
    returnOrder?: number[],
    visualDt?: number,
  ): void;
  /** Cue stick. pull in meters of drawback. */
  setCue(visible: boolean, cx: number, cy: number, angle: number, pull: number, tipX?: number, tipY?: number, authoritativeElevation?:number): void;
  /** Ball-in-hand placement preview: legal-zone outline + cursor ring. */
  setPlace(visible: boolean, x: number, y: number, legal: boolean, zone?: string): void;
  setSights(style: SightStyle): void;
  setCueStyle(style: CueStyle): void;
  setKitchen(visible: boolean, placed?: boolean): void;
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
  scene.fog = new THREE.Fog(0x100e0c,8,22);
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
  const cameraRig=new CameraRig(camera,controls,canvas);
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

  // Color maps use sRGB; independent height/roughness maps use linear data.
  const surfaceAnisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  let feltTex = feltTextures('#0a6c2f',surfaceAnisotropy);
  const feltMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: feltTex.map, bumpMap: feltTex.bump, bumpScale: 0.00018,
    roughness: 0.96, sheen: 0.14, sheenColor: new THREE.Color('#0a6c2f').lerp(new THREE.Color('white'),.15),
    sheenRoughness: 0.82, envMapIntensity: 0.15,
  });
  const bedGeo = bedGeometry();
  const pocketLining = new THREE.MeshStandardMaterial({ color: 0x100c09, roughness: 1 });
  const felt = new THREE.Mesh(bedGeo, [feltMat, pocketLining]);
  felt.receiveShadow = true;
  scene.add(felt);
  const feltPlane = new THREE.PlaneGeometry(TABLE_W + 0.3, TABLE_H + 0.3);
  const feltHit = new THREE.Mesh(feltPlane, new THREE.MeshBasicMaterial({ visible: false }));
  feltHit.rotation.x = -Math.PI / 2;
  scene.add(feltHit);

  let woodTex = woodTextures('#4a2c14',surfaceAnisotropy);
  const woodMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: woodTex.map, bumpMap: woodTex.bump, bumpScale: .00008, roughnessMap: woodTex.roughness, roughness: 0.76, envMapIntensity: 0.2, specularIntensity: 0.3,
  });
  const surroundGeo = surroundGeometry();
  const frameMesh = new THREE.Mesh(surroundGeo, woodMat);
  frameMesh.castShadow = frameMesh.receiveShadow = true;
  scene.add(frameMesh);
  scene.add(createCabinet(woodMat));
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:0x211c16,roughness:.98}));
  floor.name='Room floor';floor.rotation.x=-Math.PI/2;floor.position.y=-.78;floor.receiveShadow=true;scene.add(floor);


  // Cushion noses use the collision segments, so all six mouths line up.
  // The bed and cushion cloth share textures, finish, and theme updates.
  const cushionMat = feltMat;
  for (const cushion of cushions()) {
    const rail = new THREE.Mesh(cushionGeometry(cushion), cushionMat);
    rail.name = 'Cloth cushion with integrated jaws';
    rail.castShadow = rail.receiveShadow = true;
    scene.add(rail);
  }
  const sights = createRailSights();
  scene.add(sights.group);
  // Recessed wells, with open tops and leather lips, remain visible while
  // orbiting. Their bottoms sit below the cut bed instead of over the felt.
  const pocketCenters: Array<[number, number, number]> = [];
  const pocketMat = new THREE.MeshBasicMaterial({ color: 0x070605, side: THREE.DoubleSide });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x24180f, roughness: 0.9, side: THREE.DoubleSide });
  for (const p of POCKETS) {
    const [rx, rz] = toRender(p.x, p.y);
    pocketCenters.push([rx, rz, p.r]);
    const rim = new THREE.Mesh(new THREE.RingGeometry(p.r - .0005, p.r + 0.009, 96), rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(rx, 0.001, rz);
    rim.receiveShadow = true;
    scene.add(rim);
    const well = new THREE.Mesh(new THREE.CylinderGeometry(p.r - .0005, p.r - .0005, 0.24, 96, 1, true), pocketMat);
    well.position.set(rx, -0.12, rz);
    scene.add(well);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(p.r, 96), pocketMat);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(rx, -0.24, rz);
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
  const ballGeo = new THREE.SphereGeometry(BALL_R, 48, 32);
  const meshes = new Map<string, THREE.Mesh>();
  const pocketDrops = new PocketDrops();
  let cueAppearance:CueStyle='plain';
  const getMesh = (n: number | null): THREE.Mesh => {
    const key = n === null ? 'cue' : `b${n}`;
    let m = meshes.get(key);
    if (!m) {
      const mat = new THREE.MeshPhysicalMaterial({ map: ballTexture(n,cueAppearance,surfaceAnisotropy), roughness: .34, specularIntensity: .28, clearcoat: .15, clearcoatRoughness: .4 });
      mat.envMapIntensity = 0.25;
      m = new THREE.Mesh(ballGeo, mat);
      m.name = `ball-${key}`;
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
  let guide=guideColor('#0a6c2f');
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x4caf50, transparent: true, opacity: 0.8 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(BALL_R * 0.9, BALL_R * 1.25, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  const kitchen = new THREE.Group(); kitchen.name = 'Head string placement guide'; kitchen.visible=false;
  const kitchenShade = new THREE.Mesh(new THREE.PlaneGeometry(TABLE_W/4-.04,TABLE_H-.04),new THREE.MeshBasicMaterial({color:0xf4cc83,transparent:true,opacity:.12,depthWrite:false}));
  kitchenShade.rotation.x=-Math.PI/2; kitchenShade.position.set(-TABLE_W*3/8,.003,0);kitchen.add(kitchenShade);
  const boundary = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-TABLE_W/4,.005,-TABLE_H/2),new THREE.Vector3(-TABLE_W/4,.005,TABLE_H/2),
  ]), new THREE.LineDashedMaterial({color:0xffdf9f,dashSize:.035,gapSize:.022,depthTest:false}));
  boundary.computeLineDistances();boundary.renderOrder=3;kitchen.add(boundary);
  scene.add(kitchen);
  // Keep text in CSS pixels so the guide stays readable when the table zooms out.
  const kitchenLabel=document.createElement('div');kitchenLabel.id='headstringguide';kitchenLabel.className='kitchen-guide';kitchenLabel.hidden=true;
  kitchenLabel.innerHTML='<strong>Head string</strong><span>Place inside the shaded kitchen</span><button id="dismissheadstring" type="button">Got it — hide this tip</button>';
  let kitchenDismissed=false;
  try {kitchenDismissed=localStorage.getItem('pool:headstring-dismissed')==='1';}catch{}
  kitchenLabel.querySelector('button')!.addEventListener('click',()=>{kitchenDismissed=true;kitchenLabel.hidden=true;try{localStorage.setItem('pool:headstring-dismissed','1');}catch{}});
  document.body.appendChild(kitchenLabel);
  let kitchenPlaced=false;
  const kitchenAnchor=new THREE.Vector3(-TABLE_W/4,.006,-TABLE_H*.27);

  const callRings = pocketCenters.map(([x, z, radius]) => {
    const material = new THREE.MeshBasicMaterial({color: 0xf5cc79, transparent:true, opacity:.65, depthTest:false});
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius * 1.04, radius * 1.20, 48), material);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x,.058,z); mesh.visible=false; mesh.renderOrder=5;
    scene.add(mesh); return mesh;
  });

  const cueGroup = createCue();
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
    const orientationChanged=portrait !== nextPortrait;
    cameraRig.cancel();
    if (orientationChanged) {
      portrait = nextPortrait;
      controls.target.set(0, 0, 0);
      if (portrait) camera.position.set(-2.3, 3.4, 0);
      else camera.position.set(-2.4, 1.25, 0);
      camera.lookAt(controls.target);
    }
    // Portrait fits the whole surround. Desktop starts closer, behind the cue.
    for (let i = 0; orientationChanged && portrait && i < 30; i++) {
      camera.updateMatrixWorld();
      let fits = true;
      for (const x of [-TABLE_W / 2 - RAIL_W, TABLE_W / 2 + RAIL_W]) {
        for (const z of [-TABLE_H / 2 - RAIL_W, TABLE_H / 2 + RAIL_W]) {
          for(const height of [.05]) {
            const p = new THREE.Vector3(x,height,z).project(camera);
            if (Math.abs(p.x) > .91 || Math.abs(p.y) > .8) fits=false;
          }
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

  const coin=new GoldCoin(scene,camera);
  let running = true;
  const cbs: Array<() => void> = [];
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(frame);
  });
  const frame = () => {
    if (!running) return;
    controls.update();
    cameraRig.update(performance.now());
    constrainTableCamera(camera, controls);
    for (const cb of cbs) cb();
    if (kitchen.visible && !kitchenDismissed) {
      const anchor=kitchenAnchor.clone().project(camera), rect=canvas.getBoundingClientRect();
      kitchenLabel.hidden=anchor.z>1 || anchor.z < -1;
      const half=kitchenLabel.offsetWidth/2;
      const x=Math.max(half+12,Math.min(innerWidth-half-12,rect.left+(anchor.x+1)*rect.width/2));
      const y=rect.top+(1-anchor.y)*rect.height/2;
      kitchenLabel.style.left=`${x}px`;kitchenLabel.style.top=`${Math.max(100,y-30)}px`;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();

  const storedPositions = new Map<number,THREE.Vector3>();
  let cueObstacles: Parameters<typeof cueElevation>[4] = [];
  return {
    renderer,
    coin,
    controls,
    cameraRig,
    setBalls(list, dt, returnOrder = [], visualDt = dt) {
      cueObstacles = list;
      const axis = new THREE.Vector3();
      for (const b of list) {
        const m = getMesh(b.n);
        const [rx, rz] = toRender(b.x, b.y);
        m.position.set(rx, BALL_R, rz);
        const drop=pocketDrops.update(b,visualDt);
        if(drop){
          const [x,z]=toRender(drop.x,drop.y);
          m.visible=true;m.position.set(x,drop.height,z);
          m.rotateZ(visualDt*3);
          continue;
        }
        const slot=b.n===null?-1:returnOrder.indexOf(b.n);
        m.visible = !b.potted || slot>=0;
        if (b.potted && slot>=0) {
          const target=returnPosition(slot);
          let position=storedPositions.get(b.n!);
          if(!position){position=target.clone().add(new THREE.Vector3(.075,0,0));storedPositions.set(b.n!,position);}
          position.lerp(target,1-Math.exp(-dt*9));m.position.copy(position);
          m.rotation.set(0,0,0);continue;
        }
        if(b.n!==null)storedPositions.delete(b.n);
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
      guide=guideColor(felt);
      zoneLine.material.color.copy(guide);zoneLine.material.opacity=.85;
      ringMat.color.copy(guide);boundary.material.color.copy(guide);
      kitchenShade.material.color.copy(guide);
      callRings.forEach(ring=>ring.material.color.copy(guide));
      const oldMap = feltMat.map, oldBump = feltMat.bumpMap;
      feltTex = feltTextures(felt,surfaceAnisotropy);
      feltMat.sheenColor.set(felt).lerp(new THREE.Color('white'),.15);
      feltMat.map = feltTex.map;
      feltMat.bumpMap = feltTex.bump;
      feltMat.needsUpdate = true;
      oldMap?.dispose();
      if (oldBump && oldBump !== oldMap) oldBump.dispose();
      const oldWood = woodTex;
      woodTex = woodTextures(wood,surfaceAnisotropy);
      woodMat.map = woodTex.map; woodMat.bumpMap = woodTex.bump; woodMat.roughnessMap = woodTex.roughness;
      woodMat.needsUpdate = true;
      oldWood.map.dispose();oldWood.bump.dispose();oldWood.roughness.dispose();
    },
    setSights: sights.setStyle,
    setCueStyle(style) {
      if(style===cueAppearance)return;
      cueAppearance=style;
      const cue=meshes.get('cue');
      if(cue) {const material=cue.material as THREE.MeshPhysicalMaterial;material.map?.dispose();material.map=ballTexture(null,style,surfaceAnisotropy);material.needsUpdate=true;}
    },
    setKitchen(visible, placed = false) { if (kitchen.visible === visible && kitchenPlaced === placed) return; kitchenPlaced = placed; kitchen.visible = visible; kitchenLabel.hidden = !visible || kitchenDismissed; kitchenLabel.querySelector('span')!.textContent = placed ? 'Cue ball must leave the kitchen first' : 'Place inside the shaded kitchen'; },
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
      ringMat.color.copy(legal ? guide : new THREE.Color(0xf44336));
    },
    setCue(visible, cx, cy, angle, pull, tipX = 0, tipY = 0, authoritativeElevation?:number) {
      cueGroup.visible = visible;
      if (!visible) return;
      const [rx, rz] = toRender(cx, cy);
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const elevation = authoritativeElevation??cueElevation(cx, cy, angle, 0, cueObstacles);
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
