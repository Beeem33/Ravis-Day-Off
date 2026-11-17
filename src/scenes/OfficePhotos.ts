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
  stranger.mannequin(0xffd21f);
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

  const cam = new THREE.PerspectiveCamera(40, 1.5, 0.05, 60);
  cam.position.set(rx - 0.75, 1.45, -1.25);
  cam.lookAt(rx - 0.75, 1.12, z);
  const team = snap(renderer, scene, cam);
  // Where the stranger's chest is, in the photo
  const chest = V(rx - 2.0, 1.25, z).project(cam);
  const head = V(rx - 2.0, 1.75, z).project(cam);
  const stranger2d = (v: THREE.Vector3): { x: number; y: number } => ({ x: ((v.x + 1) / 2) * PHOTO_W, y: ((1 - v.y) / 2) * PHOTO_H });
  const c2 = stranger2d(chest);
  const h2 = stranger2d(head);
  const strangerMark = { x: c2.x, y: (c2.y + h2.y) / 2 - 20, r: Math.abs(c2.y - h2.y) * 1.25 + 40 };
  for (const p of people) p.root.removeFromParent();
  rig.root.removeFromParent();

  // ---------------------------------------------------------- Maheer's selfie
  const mx = -2.6;
  const mz = 2.2;
  const maheer = coworker(scene, mx, mz, 877, 0x1f1f24);
  maheer.setHair('Buzz'); // the faded sides
  maheer.wear(edgarCut());
  maheer.pose = { handR: V(0.2, 1.42, -0.42), handL: V(-0.16, 1.22, -0.16), curl: 1, head: new THREE.Euler(-0.08, 0.12, 0.06) };
  settle([maheer]);
  const sc = new THREE.PerspectiveCamera(58, 1.5, 0.05, 60);
  sc.position.set(mx + 0.12, 1.78, mz - 0.62);
  sc.lookAt(mx, 1.6, mz);
  const maheerPic = snap(renderer, scene, sc);
  maheer.root.removeFromParent();

  for (const p of props) p.removeFromParent();
  return { team, stranger: strangerMark, maheer: maheerPic };
}

/**
 * Maheer's cut, in the coworker model's rest space (head about 1.6 up, his
 * face toward -Z): a full rounded top, and a fringe cut dead straight across
 * the forehead, over sides faded right down.
 */
function edgarCut(): THREE.Group {
  const g = new THREE.Group();
  // Strands: fine dark streaks running down, so it reads as hair and not a helmet
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x2 = c.getContext('2d')!;
  x2.fillStyle = '#2a201a';
  x2.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 420; i++) {
    const v = 10 + Math.floor(Math.random() * 40);
    x2.strokeStyle = `rgba(${v}, ${v * 0.8}, ${v * 0.7}, 0.8)`;
    x2.lineWidth = 1 + Math.random();
    const sx = Math.random() * 256;
    x2.beginPath();
    x2.moveTo(sx, 0);
    x2.lineTo(sx + (Math.random() - 0.5) * 6, 64);
    x2.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  const hair = new THREE.MeshStandardMaterial({ color: 0x8a7a70, map: tex, roughness: 0.78, side: THREE.DoubleSide });
  // The top: full and rounded, sitting right down on the head
  const top = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), hair);
  top.scale.set(0.097, 0.078, 0.106);
  top.position.set(0, 1.684, 0.004);
  g.add(top);
  // The fringe: a band round the front of the head, cut dead straight along the bottom
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32, 1, true, Math.PI - 1.45, 2.9), hair);
  band.scale.set(0.098, 0.03, 0.107);
  band.position.set(0, 1.671, 0.004);
  g.add(band);
  return g;
}
