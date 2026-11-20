import * as THREE from 'three';
import { Enemy } from '../entities/Enemy';
import { HitmanVisual } from '../entities/HitmanVisual';
import { RaviVisual, HAND } from '../entities/RaviVisual';

/**
 * Two photos for Ravi's PC, taken in the game itself: the real models posed
 * in his office for a moment, rendered through a second camera, copied off
 * the canvas, and taken down again before the player ever sees a frame.
 *
 *  - The team photo: Ravi in the middle with an arm round two coworkers who
 *    didn't ask for it, two more with their arms folded, and at the end a
 *    man nobody knows — all yellow, no clothes, just a face.
 *  - Maheer's selfie, showing off a new haircut.
 */

export interface Photos {
  team: HTMLCanvasElement;
  /** Where the man at the end is in the team photo (canvas px), for the circle. */
  stranger: { x: number; y: number; r: number };
  maheer: HTMLCanvasElement;
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const PHOTO_W = 960;
const PHOTO_H = 640;

/** Take them once the models have loaded; `done` is called with the pictures. */
export function shootOfficePhotos(renderer: THREE.WebGLRenderer, scene: THREE.Scene, done: (p: Photos) => void): void {
  const go = (): void => {
    if (!RaviVisual.ready || !HitmanVisual.ready) {
      setTimeout(go, 200);
      return;
    }
    done(shoot(renderer, scene));
  };
  go();
}

function coworker(scene: THREE.Scene, x: number, z: number, seed: number, shirt: number, glasses = false): Enemy {
  // Facing -Z, out towards the camera
  const e = new Enemy(V(x, 0, z), 0, seed, { name: 'COWORKER', civilian: true });
  e.restyleCrew({ cap: false, shirt, glasses });
  e.hideWeapon();
  e.setCalm();
  scene.add(e.root);
  return e;
}

function settle(people: Enemy[]): void {
  for (let i = 0; i < 12; i++) for (const p of people) p.update(1 / 30);
}

/** Render `cam` and copy the middle 3:2 of the canvas into a new one. */
function snap(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera): HTMLCanvasElement {
  const src = renderer.domElement;
  const exposure = renderer.toneMappingExposure;
  renderer.toneMappingExposure = exposure * 1.25;
  cam.aspect = src.width / src.height;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  renderer.render(scene, cam);
  renderer.toneMappingExposure = exposure;
  const out = document.createElement('canvas');
  out.width = PHOTO_W;
  out.height = PHOTO_H;
  const g = out.getContext('2d')!;
  let sw = src.width;
  let sh = (sw * PHOTO_H) / PHOTO_W;
  if (sh > src.height) {
    sh = src.height;
    sw = (sh * PHOTO_W) / PHOTO_H;
  }
  g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, PHOTO_W, PHOTO_H);
  return out;
}

function shoot(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Photos {
  const props: THREE.Object3D[] = [];

  // ---------------------------------------------------------- the team photo
  // Along the south wall of his office, everyone facing north into the room.
  const z = 2.3;
  const rx = -4.25;
  const left = coworker(scene, rx + 0.5, z, 811, 0x2e86de); // on Ravi's right, the camera's left
  const right = coworker(scene, rx - 0.5, z, 823, 0xc0392b, true);
  const third = coworker(scene, rx - 1.15, z, 837, 0x27ae60);
  const stranger = coworker(scene, rx - 2.0, z + 0.05, 851, 0x777777);
  stranger.mannequin(0xffd21f, true);
  const folded = { handR: V(-0.11, 1.2, -0.2), handL: V(0.11, 1.18, -0.21), curl: 0.7 };
  left.pose = { ...folded, lean: 0.05 };
  right.pose = { handR: V(0.2, 0.92, -0.05), handL: V(-0.2, 0.92, -0.05), curl: 0.3, lean: -0.06 };
  third.pose = { ...folded };
  stranger.pose = { handR: V(0.2, 0.9, -0.02), handL: V(-0.2, 0.9, -0.02), curl: 0.2 };
  const people = [left, right, third, stranger];
  settle(people);

  // Ravi, between the two, an arm round each
  const rig = RaviVisual.rig('body');
  rig.clear();
  rig.apply();
  const hips = rig.at('thigh_l').add(rig.at('thigh_r')).multiplyScalar(0.5);
  const SL = rig.at('upperarm_l');
  const SR = rig.at('upperarm_r');
  rig.seat({
    hips,
    lean: [0, 0, 2, 2, 0, -4],
    twist: [0, 0, 0, 0, 0, 0],
    legs: {
      l: { ankle: rig.at('foot_l'), knee: V(0, 0, 1), turn: 8 },
      r: { ankle: rig.at('foot_r'), knee: V(0, 0, 1), turn: -8 }
    },
    arms: {
      // His left is model +X: the coworker to the camera's right
      // Up on top of their shoulders (they're taller than him), hands draped over the far side
      l: { wrist: SL.clone().add(V(0.4, 0.12, 0.02)), along: V(1, -0.45, 0.2).normalize(), palm: V(0, -1, 0.1).normalize(), elbow: V(0.1, 0.2, -1), shape: HAND.relaxed },
      r: { wrist: SR.clone().add(V(-0.4, 0.12, 0.02)), along: V(-1, -0.45, 0.2).normalize(), palm: V(0, -1, 0.1).normalize(), elbow: V(-0.1, 0.2, -1), shape: HAND.relaxed }
    }
  });
  rig.root.position.set(rx, 0, z);
  rig.root.rotation.y = Math.PI; // model +Z is his front; turn him to face north
  scene.add(rig.root);
  props.push(rig.root);

  // A window in the wall behind them, the world outside it
  const solids: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh && o.visible) solids.push(o);
  });
  const wallHit = new THREE.Raycaster(V(rx - 0.75, 1.6, z + 0.3), V(0, 0, 1), 0, 6).intersectObjects(solids, false)[0];
  // (the office's south wall is 0.59 m behind them, if the ray finds nothing yet)
  const wallZ = wallHit && wallHit.distance < 1.5 ? wallHit.point.z : z + 0.59;
  const win = officeWindow();
  win.position.set(rx - 0.85, 1.62, wallZ - 0.025);
  scene.add(win);
  props.push(win);
  const cam = new THREE.PerspectiveCamera(40, 1.5, 0.05, 60);
  cam.position.set(rx - 0.75, 1.45, -1.25);
  cam.lookAt(rx - 0.75, 1.12, z);
  const team = snap(renderer, scene, cam);
  // Where the stranger's face is, in the photo: the circle goes evenly round it
  const to2d = (v: THREE.Vector3): { x: number; y: number } => {
    const p = v.clone().project(cam);
    return { x: ((p.x + 1) / 2) * PHOTO_W, y: ((1 - p.y) / 2) * PHOTO_H };
  };
  const at3 = stranger.root.position;
  const face2 = to2d(V(at3.x, 1.62, at3.z - 0.05));
  const edge2 = to2d(V(at3.x + 0.2, 1.62, at3.z - 0.05));
  const strangerMark = { x: face2.x, y: face2.y, r: Math.hypot(edge2.x - face2.x, edge2.y - face2.y) + 10 };
  for (const p of people) p.root.removeFromParent();
  rig.root.removeFromParent();

  // ---------------------------------------------------------- Maheer's selfie
  const mx = -2.6;
  const mz = 2.2;
  const maheer = coworker(scene, mx, mz, 877, 0x1f1f24);
  maheer.setHair('Buzz'); // the short sides
  maheer.wear(flatTopMullet());
  maheer.pose = { handR: V(0.2, 1.42, -0.42), handL: V(-0.16, 1.22, -0.16), curl: 1, head: new THREE.Euler(-0.08, 0.12, 0.06) };
  settle([maheer]);
  const sc = new THREE.PerspectiveCamera(58, 1.5, 0.05, 60);
  sc.position.set(mx + 0.1, 1.74, mz - 0.86);
  sc.lookAt(mx, 1.56, mz);
  const maheerPic = snap(renderer, scene, sc);
  maheer.root.removeFromParent();

  for (const p of props) p.removeFromParent();
  return { team, stranger: strangerMark, maheer: maheerPic };
}

/**
 * A window in the office wall (it faces -Z, into the room): a white frame
 * and sill, a cross of glazing bars, and outside it an afternoon — sky,
 * the city's towers, a tree's top close by.
 */
function officeWindow(): THREE.Group {
  const g = new THREE.Group();
  const W = 1.9;
  const H = 1.15;
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 464;
  const x = c.getContext('2d')!;
  const sky = x.createLinearGradient(0, 0, 0, 464);
  sky.addColorStop(0, '#5f9fe0');
  sky.addColorStop(0.7, '#b9dcf5');
  sky.addColorStop(1, '#e6f2fa');
  x.fillStyle = sky;
  x.fillRect(0, 0, 768, 464);
  // A few clouds
  x.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [cx, cy, r] of [[120, 70, 34], [160, 60, 42], [205, 74, 30], [560, 110, 28], [600, 98, 38], [640, 112, 26]]) {
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fill();
  }
  // The towers: far ones hazy, near ones darker, lit windows
  const towers = (n: number, base: number, hmin: number, hmax: number, col: string, lit: string): void => {
    for (let i = 0; i < n; i++) {
      const tw = 40 + Math.random() * 60;
      const tx = (i / n) * 800 - 20 + Math.random() * 30;
      const th = hmin + Math.random() * (hmax - hmin);
      x.fillStyle = col;
      x.fillRect(tx, base - th, tw, th + 4);
      x.fillStyle = lit;
      for (let wy = base - th + 8; wy < base - 6; wy += 12) for (let wx = tx + 5; wx < tx + tw - 6; wx += 10) if (Math.random() < 0.55) x.fillRect(wx, wy, 5, 6);
    }
  };
  towers(14, 380, 90, 220, '#8aa6bf', 'rgba(230,240,250,0.5)');
  towers(9, 430, 120, 300, '#4f6b84', 'rgba(255,240,190,0.55)');
  // A tree's crown in the near corner
  x.fillStyle = '#3f7a3a';
  for (let k = 0; k < 40; k++) {
    x.beginPath();
    x.arc(640 + Math.random() * 140, 360 + Math.random() * 120, 24 + Math.random() * 30, 0, Math.PI * 2);
    x.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const view = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  view.rotation.y = Math.PI;
  g.add(view);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.12 }));
  glass.rotation.y = Math.PI;
  glass.position.z = -0.01;
  g.add(glass);
  const frame = new THREE.MeshStandardMaterial({ color: 0xf0efea, roughness: 0.5 });
  const bar = (w: number, h: number, px: number, py: number, d = 0.06): void => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frame);
    b.position.set(px, py, -0.02);
    g.add(b);
  };
  bar(W + 0.12, 0.06, 0, H / 2 + 0.03);
  bar(W + 0.12, 0.06, 0, -H / 2 - 0.03);
  bar(0.06, H + 0.12, W / 2 + 0.03, 0);
  bar(0.06, H + 0.12, -W / 2 - 0.03, 0);
  bar(0.035, H, 0, 0, 0.04);
  bar(W, 0.035, 0, 0.1, 0.04);
  // The sill
  const sill = new THREE.Mesh(new THREE.BoxGeometry(W + 0.24, 0.04, 0.16), frame);
  sill.position.set(0, -H / 2 - 0.08, -0.07);
  g.add(sill);
  return g;
}

/** Hair strands on a canvas: a base colour, light and dark streaks running its length, and coloured streaks through it. */
function strandTex(base: string, streaks: string[], w: number, h: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < w * 1.6; i++) {
    x.strokeStyle = Math.random() < 0.5 ? 'rgba(255,248,215,0.45)' : 'rgba(120,96,50,0.35)';
    x.lineWidth = 0.6 + Math.random() * 1.2;
    const sx = Math.random() * w;
    x.beginPath();
    x.moveTo(sx, 0);
    x.lineTo(sx + (Math.random() - 0.5) * 3, h);
    x.stroke();
  }
  for (const col of streaks) {
    x.fillStyle = col;
    x.fillRect(Math.random() * w, 0, 3 + Math.random() * 7, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/**
 * The cut in the photo Ben sent: blond, the top a flat-top standing dead
 * straight up, the sides short, and long straight hair hanging from behind
 * the ears down past the shoulders, streaked with pink. In the coworker
 * model's rest space (head about 1.6 up, face toward -Z).
 */
function flatTopMullet(): THREE.Group {
  const g = new THREE.Group();
  // ---- The flat-top: a block of short hair stood straight up off the crown, cut flat across the top
  const topTex = strandTex('#cdb57a', [], 256, 128);
  topTex.repeat.set(3, 1);
  const blondMat = new THREE.MeshStandardMaterial({ color: 0xe0c890, map: topTex, roughness: 0.85 });
  // Under it, the hair lying over the crown down to the hairline
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), blondMat);
  crown.scale.set(0.1, 0.082, 0.109);
  crown.position.set(0, 1.682, 0.004);
  g.add(crown);
  const block = new THREE.Mesh(new THREE.CylinderGeometry(1.04, 0.97, 1, 40, 1), blondMat);
  block.scale.set(0.1, 0.1, 0.11);
  block.position.set(0, 1.78, 0.006);
  g.add(block);
  // Its top: the ends of the hair, bristly — a plate and a field of short spikes standing up off it
  const cc = document.createElement('canvas');
  cc.width = cc.height = 128;
  const cx = cc.getContext('2d')!;
  cx.fillStyle = '#c9b073';
  cx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1800; i++) {
    cx.fillStyle = Math.random() < 0.5 ? 'rgba(255,245,210,0.6)' : 'rgba(110,88,45,0.5)';
    cx.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
  }
  const capTex = new THREE.CanvasTexture(cc);
  capTex.colorSpace = THREE.SRGBColorSpace;
  const cap = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: 0xffffff, map: capTex, roughness: 0.9 }));
  cap.rotation.x = -Math.PI / 2;
  cap.scale.set(0.102, 0.112, 1);
  cap.position.set(0, 1.83, 0.006);
  g.add(cap);
  const N = 420;
  const spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.0035, 0.024, 4), new THREE.MeshStandardMaterial({ color: 0xdcc58c, roughness: 0.8 }), N);
  const m = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    m.compose(
      V(Math.cos(a) * r * 0.1, 1.836 + Math.random() * 0.006, 0.006 + Math.sin(a) * r * 0.11),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25)),
      new THREE.Vector3(1, 0.6 + Math.random() * 0.8, 1)
    );
    spikes.setMatrixAt(i, m);
  }
  g.add(spikes);
  // ---- The long hair: straight strands from behind the ears and the back of the head, down past the
  // shoulders and in front of them; blond, with pink streaks through it
  const longMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: strandTex('#d9c088', ['rgba(240,120,170,0.9)', 'rgba(250,160,195,0.85)', 'rgba(232,96,150,0.9)', 'rgba(255,190,210,0.8)'], 128, 256),
    roughness: 0.75,
    side: THREE.DoubleSide
  });
  const pinkMat = new THREE.MeshStandardMaterial({ color: 0xf08cb4, map: strandTex('#f2a0c0', ['rgba(255,220,235,0.7)'], 64, 256), roughness: 0.75, side: THREE.DoubleSide });
  /** A ribbon of hair along a curve, `w` wide, its flat face turned toward `out`. */
  const ribbon = (pts: THREE.Vector3[], w: number, mat: THREE.Material, out: THREE.Vector3): void => {
    const curve = new THREE.CatmullRomCurve3(pts);
    const n = 24;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u);
      const side = new THREE.Vector3().crossVectors(t, out).normalize().multiplyScalar((w / 2) * (1 - u * 0.25));
      pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
      uv.push(0, 1 - u, 1, 1 - u);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, mat));
  };
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 11; k++) {
      // A curtain from behind the ear, hanging straight, coming forward a little over the shoulder
      const z0 = 0.0 + k * 0.01;
      const x0 = sx * (0.095 + (k % 4) * 0.003);
      const x1 = sx * (0.13 + (k % 4) * 0.008);
      const len = 0.48 + (k % 3) * 0.035;
      // (over the collarbone and down the front of the chest, clear of the shirt)
      const front = -0.135 - (k % 4) * 0.007;
      ribbon([V(x0, 1.72, z0), V(x0 * 1.02, 1.6, z0 * 0.6), V(x1, 1.47, -0.07 - (k % 4) * 0.006), V(x1 * 1.04, 1.72 - len, front)], 0.04, k % 4 === 1 ? pinkMat : longMat, V(sx, 0, 0));
    }
  }
  // And down the back
  for (let k = 0; k < 10; k++) {
    const x0 = -0.08 + k * 0.018;
    ribbon([V(x0, 1.72, 0.1), V(x0, 1.58, 0.108), V(x0 * 1.1, 1.42, 0.115), V(x0 * 1.15, 1.26, 0.12)], 0.034, k % 3 === 1 ? pinkMat : longMat, V(0, 0, 1));
  }
  return g;
}
