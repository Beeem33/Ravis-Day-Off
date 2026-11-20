import * as THREE from 'three';
import { Enemy } from '../entities/Enemy';
import { HitmanVisual } from '../entities/HitmanVisual';
import { Hound } from '../entities/AlienCreatures';

/**
 * Staff photos for the Extraterrestrial Collective's page on the Exterminator
 * Collective's intranet, taken with the game's own models: Exterminator
 * Collective staff, in the company red, throwing peace signs with an arm
 * round one of the hounds from the far side. Posed in a little studio of
 * their own (a branded wall, a floor, lights), rendered, copied off the
 * canvas, and taken down again.
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const W = 720;
const H = 480;

export interface ECPhoto {
  img: HTMLCanvasElement;
  caption: string;
}

let cache: ECPhoto[] | null = null;

/** The photos (taken the first time they're asked for; the models have to have loaded). */
export function ecPhotos(renderer: THREE.WebGLRenderer): ECPhoto[] {
  if (cache) return cache;
  if (!HitmanVisual.ready) return [];
  cache = shoot(renderer);
  return cache;
}

function banner(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 1024);
  bg.addColorStop(0, '#e9ece6');
  bg.addColorStop(1, '#cfd5cc');
  g.fillStyle = bg;
  g.fillRect(0, 0, 2048, 1024);
  // Bunting
  const cols = ['#c4261c', '#2e8b57', '#f2c400', '#2e6fbf'];
  for (let k = 0; k < 26; k++) {
    const x = k * 80;
    g.fillStyle = cols[k % 4];
    g.beginPath();
    g.moveTo(x, 40 + Math.sin(k * 0.5) * 10);
    g.lineTo(x + 70, 40 + Math.sin(k * 0.5 + 0.5) * 10);
    g.lineTo(x + 35, 130);
    g.fill();
  }
  // The branch's name, the logo with a little alien in the hex
  g.textAlign = 'center';
  g.fillStyle = '#1d1d1f';
  g.font = 'bold 120px Arial, sans-serif';
  g.fillText('EXTRATERRESTRIAL', 1024, 330);
  g.fillText('COLLECTIVE', 1024, 460);
  g.fillStyle = '#c4261c';
  g.font = 'bold 54px Arial, sans-serif';
  g.fillText('A BRANCH OF THE EXTERMINATOR COLLECTIVE', 1024, 550);
  g.fillStyle = '#2e8b57';
  g.font = 'italic bold 64px Georgia, serif';
  g.fillText('Welcome to the team!', 1024, 680);
  for (const cx of [300, 1748]) {
    g.save();
    g.translate(cx, 400);
    g.strokeStyle = '#c4261c';
    g.lineWidth = 22;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      g.lineTo(Math.cos(a) * 140, Math.sin(a) * 140);
    }
    g.closePath();
    g.stroke();
    g.fillStyle = '#4caf50';
    g.beginPath();
    g.ellipse(0, -10, 60, 74, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(s * 26, -18, 18, 28, s * 0.5, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function staff(scene: THREE.Scene, x: number, z: number, seed: number, yaw = 0): Enemy {
  // Facing -Z (the camera) at yaw 0; his right is +X
  const e = new Enemy(V(x, 0, z), yaw, seed, { name: 'EC STAFF', civilian: true });
  e.restyleCrew({ cap: true, shirt: 0xb0231b });
  e.hideWeapon();
  e.setCalm();
  scene.add(e.root);
  return e;
}

function hound(scene: THREE.Scene, x: number, z: number, yaw: number, s = 1): Hound {
  const h = new Hound();
  h.group.position.set(x, 0, z);
  h.group.rotation.y = yaw;
  h.yaw = yaw;
  h.group.scale.setScalar(s);
  h.state = 'lurk';
  h.stateT = -1e9;
  scene.add(h.group);
  return h;
}

function settle(people: Enemy[], dogs: Hound[]): void {
  for (let i = 0; i < 14; i++) {
    for (const p of people) p.update(1 / 30);
    for (const d of dogs) d.animate(1 / 30, i / 30);
  }
}

function snap(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera): HTMLCanvasElement {
  const src = renderer.domElement;
  cam.aspect = src.width / src.height;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);
  renderer.render(scene, cam);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const g = out.getContext('2d')!;
  let sw = src.width;
  let sh = (sw * H) / W;
  if (sh > src.height) {
    sh = src.height;
    sw = (sh * W) / H;
  }
  g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, W, H);
  return out;
}

/** A hand up by his face, palm to the camera, two fingers up. */
const PEACE_R = { handR: V(0.2, 1.52, -0.2), palmR: V(0, 0, -1), thumbR: V(-1, 0, 0) };
const PEACE_L = { handL: V(-0.2, 1.52, -0.2), palmL: V(0, 0, -1), thumbL: V(1, 0, 0) };

function shoot(renderer: THREE.WebGLRenderer): ECPhoto[] {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe3dc);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6458, 1.6));
  const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
  key.position.set(2.5, 4, -4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd8e8ff, 1.0);
  fill.position.set(-3, 2, -3);
  scene.add(fill);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshStandardMaterial({ map: banner(), roughness: 0.85 }));
  wall.position.set(0, 2, 1.6);
  wall.rotation.y = Math.PI;
  scene.add(wall);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), new THREE.MeshStandardMaterial({ color: 0x8a8f8a, roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const photos: ECPhoto[] = [];
  const clear = (o: THREE.Object3D[]): void => o.forEach((x) => x.removeFromParent());

  // ---- 1. Gary and the hound: his arm round its neck, a peace sign
  {
    const gary = staff(scene, 0.3, 0.2, 913);
    const dog = hound(scene, -0.7, 0.4, Math.PI - 0.8, 1.05);
    gary.pose = { ...PEACE_R, handL: V(-0.6, 1.02, 0.12), curl: 1, lean: -0.05, head: new THREE.Euler(0.05, 0.25, 0.08) };
    gary.setPeace(false, true);
    settle([gary], [dog]);
    const cam = new THREE.PerspectiveCamera(42, 1.5, 0.05, 40);
    cam.position.set(-0.15, 1.5, -3.3);
    cam.lookAt(-0.15, 1.2, 0.3);
    photos.push({ img: snap(renderer, scene, cam), caption: 'Gary (Pest Relations) and "Biscuit" on Biscuit\'s first day. Biscuit has since been promoted.' });
    clear([gary.root, dog.group]);
  }
  // ---- 2. Two of them, one either side of a big one, both throwing peace signs
  {
    const a = staff(scene, 0.75, 0.25, 927);
    const b = staff(scene, -0.75, 0.25, 941);
    const dog = hound(scene, 0, 0.35, Math.PI, 1.3);
    a.pose = { ...PEACE_R, handL: V(-0.48, 1.12, 0.05), curl: 1, head: new THREE.Euler(0, 0.2, 0.06) };
    b.pose = { ...PEACE_L, handR: V(0.48, 1.12, 0.05), curl: 1, head: new THREE.Euler(0, -0.2, -0.06) };
    a.setPeace(false, true);
    b.setPeace(true, false);
    settle([a, b], [dog]);
    const cam = new THREE.PerspectiveCamera(44, 1.5, 0.05, 40);
    cam.position.set(0, 1.35, -3.4);
    cam.lookAt(0, 1.05, 0.3);
    photos.push({ img: snap(renderer, scene, cam), caption: 'Team day, Hangar 3. Dana and Marcus with "Big Steve". Nobody was eaten.' });
    clear([a.root, b.root, dog.group]);
  }
  // ---- 3. The whole branch: three staff, two hounds, every hand that's free throwing peace
  {
    const ps = [staff(scene, -1.05, 0.5, 951), staff(scene, 0.05, 0.6, 963), staff(scene, 1.1, 0.5, 977)];
    const dogs = [hound(scene, -0.55, -0.15, Math.PI - 0.3, 0.95), hound(scene, 0.6, -0.15, Math.PI + 0.35, 1.0)];
    ps[0].pose = { ...PEACE_L, handR: V(0.42, 0.95, -0.55), curl: 1 };
    ps[1].pose = { ...PEACE_R, ...PEACE_L, curl: 1, head: new THREE.Euler(-0.05, 0, 0) };
    ps[2].pose = { ...PEACE_R, handL: V(-0.42, 0.95, -0.55), curl: 1 };
    ps[0].setPeace(true, false);
    ps[1].setPeace(true, true);
    ps[2].setPeace(false, true);
    settle(ps, dogs);
    const cam = new THREE.PerspectiveCamera(48, 1.5, 0.05, 40);
    cam.position.set(0, 1.45, -3.9);
    cam.lookAt(0, 1.0, 0.3);
    photos.push({ img: snap(renderer, scene, cam), caption: 'The Extraterrestrial Collective, all of it. Peace among species, effective immediately.' });
    clear([...ps.map((p) => p.root), ...dogs.map((d) => d.group)]);
  }
  // ---- 4. A selfie: up close, cheek to its mouth, the peace sign big in frame
  {
    const s = staff(scene, 0.15, 0.2, 989);
    const dog = hound(scene, -0.75, 0.65, Math.PI - 0.75, 1.15);
    s.pose = { handR: V(0.18, 1.56, -0.24), palmR: V(0, 0, -1), thumbR: V(-1, 0, 0), handL: V(-0.5, 1.1, 0.25), curl: 1, head: new THREE.Euler(0, 0.3, 0.16) };
    s.setPeace(false, true);
    settle([s], [dog]);
    const cam = new THREE.PerspectiveCamera(58, 1.5, 0.05, 40);
    cam.position.set(-0.05, 1.5, -1.45);
    cam.lookAt(-0.22, 1.25, 0.3);
    photos.push({ img: snap(renderer, scene, cam), caption: 'Priya\'s first selfie with a colleague from the new branch. "He smells like a wet sponge but he\'s a sweetheart."' });
    clear([s.root, dog.group]);
  }
  return photos;
}
