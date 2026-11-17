import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * AlienCreatures — what lives on the far side of the Atom Warper.
 *
 *  - Hound: a dog's body, low and fast, and where its face should be just a
 *    mouth: a wide fleshy funnel ringed with needle teeth. It runs at him and
 *    bites.
 *  - SpiderBoss: a grey ribbed grub the size of a car, a fanged mouth at the
 *    front, two fleshy arms ending in toothed cannon-mouths that spit blue
 *    bolts, six spider legs that walk it about.
 *  - alienArm(): one of those arms (the boss's two, and the one Ravi takes).
 *  - GlowShots: glowing projectiles (the bolts, the blaster's goo).
 *  - Droplets: splashes of alien blood and goo.
 *
 * All of them face +Z. Built from code, nothing loaded.
 */

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};
const UP = new THREE.Vector3(0, 1, 0);

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Mottled skin: a base colour, blotches darker and lighter, fine veins. */
function skinTexture(base: string, dark: string, light: string, veins: string): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 140; k++) {
    g.fillStyle = Math.random() < 0.6 ? dark : light;
    g.globalAlpha = 0.12 + Math.random() * 0.2;
    g.beginPath();
    g.ellipse(Math.random() * S, Math.random() * S, 4 + Math.random() * 22, 3 + Math.random() * 14, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 0.5;
  g.strokeStyle = veins;
  for (let k = 0; k < 26; k++) {
    g.lineWidth = 0.6 + Math.random() * 1.4;
    g.beginPath();
    let x = Math.random() * S;
    let y = Math.random() * S;
    g.moveTo(x, y);
    for (let s = 0; s < 8; s++) g.lineTo((x += (Math.random() - 0.5) * 30), (y += (Math.random() - 0.5) * 30));
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bands round a body: the grub's segments. */
function ribTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8c8a86';
  g.fillRect(0, 0, 64, 512);
  for (let k = 0; k < 900; k++) {
    const v = 110 + Math.random() * 60;
    g.fillStyle = `rgba(${v},${v},${v - 6},0.25)`;
    g.fillRect(Math.random() * 64, Math.random() * 512, 2 + Math.random() * 4, 1 + Math.random() * 3);
  }
  for (let y = 0; y < 512; y += 22) {
    const gr = g.createLinearGradient(0, y, 0, y + 22);
    gr.addColorStop(0, 'rgba(40,38,40,0.6)');
    gr.addColorStop(0.18, 'rgba(70,68,70,0.2)');
    gr.addColorStop(0.5, 'rgba(220,218,210,0.2)');
    gr.addColorStop(0.85, 'rgba(70,68,70,0.18)');
    gr.addColorStop(1, 'rgba(40,38,40,0.6)');
    g.fillStyle = gr;
    g.fillRect(0, y, 64, 22);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let fleshMatCache: THREE.MeshStandardMaterial | null = null;
function fleshMat(): THREE.MeshStandardMaterial {
  if (!fleshMatCache) {
    fleshMatCache = new THREE.MeshStandardMaterial({
      map: skinTexture('#8a3448', '#4a1426', '#c0607a', '#3a0a1a'),
      roughness: 0.42,
      metalness: 0.05,
      emissive: 0x200614,
      emissiveIntensity: 0.6
    });
  }
  return fleshMatCache;
}
const toothMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c4, roughness: 0.35 });
const throatMat = new THREE.MeshStandardMaterial({ color: 0x2a0408, emissive: 0x500810, emissiveIntensity: 0.8, roughness: 0.6, side: THREE.BackSide });

/** A tube along `curve` whose radius follows `r(u)`. */
function profiledTube(curve: THREE.Curve<THREE.Vector3>, segs: number, radial: number, r: (u: number) => number): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (radial + 1));
    const u = ring / segs;
    curve.getPointAt(u, c);
    v.fromBufferAttribute(p, i).sub(c).multiplyScalar(r(u));
    p.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A ring of teeth round a rim, pointing in (and a little out of the mouth). */
function teethRing(n: number, rim: number, len: number, thick: number, lean: number, z = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash(i, n) * 0.2;
    const l = len * (0.6 + hash(i, 3) * 0.6);
    const t = new THREE.ConeGeometry(thick * (0.7 + hash(i, 5) * 0.5), l, 5);
    // Base on the rim, pointing in toward the axis and leaning out of the mouth (+Z)
    t.translate(0, l / 2, 0);
    const d = new THREE.Vector3(-Math.cos(a) * Math.cos(lean), -Math.sin(a) * Math.cos(lean), Math.sin(lean));
    t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d));
    t.translate(Math.cos(a) * rim, Math.sin(a) * rim, z);
    parts.push(t.toNonIndexed());
  }
  return mergeGeometries(parts, false)!;
}

/**
 * A mouth that opens toward +Z: a fleshy flared funnel with a rolled lip,
 * rings of needle teeth inside it, and a throat going back into the dark.
 * `glow` lights the throat in that colour (the arm-cannons' blue).
 */
function mouth(radius: number, depth: number, opts: { teeth?: number; glow?: number; skin?: THREE.Material } = {}): { group: THREE.Group; core: THREE.Mesh | null; flare: THREE.Group } {
  const group = new THREE.Group();
  const flare = new THREE.Group();
  group.add(flare);
  // The funnel: a lathe from the throat out to the lip, rolled over at the lip
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    pts.push(new THREE.Vector2(radius * (0.35 + 0.65 * Math.pow(u, 1.6)), -depth + depth * u));
  }
  pts.push(new THREE.Vector2(radius * 1.08, depth * 0.06));
  pts.push(new THREE.Vector2(radius * 1.14, -depth * 0.02));
  pts.push(new THREE.Vector2(radius * 1.05, -depth * 0.16));
  pts.push(new THREE.Vector2(radius * 0.92, -depth * 0.5));
  const lathe = new THREE.LatheGeometry(pts, 28);
  lathe.rotateX(Math.PI / 2);
  // Lumpy: the lip's not a perfect circle
  const p = lathe.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const a = Math.atan2(y, x);
    const k = 1 + Math.sin(a * 5 + 1.3) * 0.05 + Math.sin(a * 9) * 0.03;
    p.setXY(i, x * k, y * k);
  }
  lathe.computeVertexNormals();
  const skin = opts.skin ?? fleshMat();
  const m = new THREE.Mesh(lathe, new THREE.MeshStandardMaterial({ map: (skin as THREE.MeshStandardMaterial).map, color: 0xffffff, roughness: 0.4, side: THREE.DoubleSide, emissive: 0x300810, emissiveIntensity: 0.5 }));
  flare.add(m);
  // The throat's dark inside
  const throat = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), throatMat);
  throat.rotation.x = -Math.PI / 2;
  throat.position.z = -depth * 0.92;
  flare.add(throat);
  // Teeth: an outer ring at the lip, an inner ring further in
  const n = opts.teeth ?? 18;
  flare.add(new THREE.Mesh(teethRing(n, radius * 0.98, radius * 0.38, radius * 0.06, 0.35, -depth * 0.05), toothMat));
  flare.add(new THREE.Mesh(teethRing(Math.round(n * 0.7), radius * 0.62, radius * 0.3, radius * 0.05, 0.15, -depth * 0.45), toothMat));
  let core: THREE.Mesh | null = null;
  if (opts.glow !== undefined) {
    core = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.3, 16, 12), new THREE.MeshBasicMaterial({ color: opts.glow, toneMapped: false }));
    core.position.z = -depth * 0.7;
    flare.add(core);
  }
  return { group, core, flare };
}

/** The glow round anything blue and electric: a soft additive sprite. */
let glowTex: THREE.CanvasTexture | null = null;
export function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
export function glowSprite(color: number, size: number, opacity = 0.8): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  s.scale.setScalar(size);
  return s;
}

// ================================================================ the arm

export interface AlienArmParts {
  root: THREE.Group;
  /** The cannon-mouth at its end (+Z), and the glowing core inside it. */
  muzzle: THREE.Object3D;
  core: THREE.Mesh;
  glow: THREE.Sprite;
  flare: THREE.Group;
  /** Tendrils at its base (the harvested arm's grip on his forearm). */
  tendrils: THREE.Object3D[];
  length: number;
}

/**
 * One of the arms: from its root at the origin out along +Z, thick and
 * muscled, a narrow joint, a swelling toward the end, ribbed with rings of
 * gristle, and at its end a flared mouth ringed with teeth with a blue
 * electric glow deep in it. `tendrils` grows a fringe of feelers at the root.
 */
export function alienArm(len: number, opts: { tendrils?: boolean } = {}): AlienArmParts {
  const root = new THREE.Group();
  const flesh = fleshMat();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.02 * len, 0.06 * len, 0.3 * len),
    new THREE.Vector3(-0.03 * len, 0.02 * len, 0.6 * len),
    new THREE.Vector3(0, 0, 0.86 * len)
  ]);
  const R = 0.088 * len;
  const prof = (u: number): number => {
    const base = 0.85 - 0.25 * Math.sin(Math.min(1, u / 0.5) * Math.PI) * 0.6 + 0.35 * smooth((u - 0.6) / 0.4);
    const rib = 1 + 0.07 * Math.max(0, Math.sin(u * 46));
    return R * base * rib;
  };
  const tube = new THREE.Mesh(profiledTube(curve, 64, 14, prof), flesh);
  root.add(tube);
  // Gristle rings and a few warts
  const nodule = new THREE.MeshStandardMaterial({ color: 0x6a2236, roughness: 0.5 });
  for (let k = 0; k < 6; k++) {
    const u = 0.12 + k * 0.13;
    const c = curve.getPointAt(u);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(prof(u) * 1.02, R * 0.07, 6, 18), nodule);
    ring.position.copy(c);
    ring.lookAt(c.clone().add(curve.getTangentAt(u)));
    root.add(ring);
  }
  // Veins along it, a bluish glow in them
  const veinMat = new THREE.MeshStandardMaterial({ color: 0x20304a, emissive: 0x2a9cff, emissiveIntensity: 0.9, roughness: 0.4 });
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + 0.4;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const u = 0.08 + (i / 10) * 0.8;
      const c = curve.getPointAt(u);
      const w = a + Math.sin(u * 9 + k) * 0.35;
      const r = prof(u) * 0.98;
      pts.push(new THREE.Vector3(c.x + Math.cos(w) * r, c.y + Math.sin(w) * r, c.z));
    }
    root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, R * 0.035, 5), veinMat));
  }
  // The cannon-mouth
  const end = curve.getPointAt(1);
  const mr = prof(1) * 1.4;
  const mo = mouth(mr, mr * 1.3, { teeth: 14, glow: 0x5ad8ff });
  mo.group.position.copy(end).add(new THREE.Vector3(0, 0, mr * 0.9));
  root.add(mo.group);
  const muzzle = new THREE.Object3D();
  muzzle.position.copy(mo.group.position).add(new THREE.Vector3(0, 0, mr * 0.2));
  root.add(muzzle);
  const glow = glowSprite(0x4ac8ff, mr * 3.2, 0.55);
  glow.position.copy(mo.group.position).add(new THREE.Vector3(0, 0, -mr * 0.4));
  root.add(glow);
  // Glowing spots round the mouth, where the light inside comes through the skin
  const spotMat = new THREE.MeshBasicMaterial({ color: 0x7ae0ff, toneMapped: false });
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.2;
    const u = 0.86 + (k % 3) * 0.035;
    const c = curve.getPointAt(u);
    const r = prof(u) * 1.0;
    const s = new THREE.Mesh(new THREE.SphereGeometry(R * (0.07 + (k % 2) * 0.04), 8, 6), spotMat);
    s.position.set(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, c.z);
    root.add(s);
  }
  // Tendrils: thin feelers curling back from the root
  const tendrils: THREE.Object3D[] = [];
  if (opts.tendrils) {
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.3;
      const t = new THREE.Group();
      t.rotation.z = a;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const u = i / 8;
        const r = R * (0.7 + 0.5 * Math.sin(u * Math.PI * 0.8));
        pts.push(new THREE.Vector3(r * (1 - u * 0.25), Math.sin(u * 5 + k) * R * 0.2, -u * len * 0.42));
      }
      const g = profiledTube(new THREE.CatmullRomCurve3(pts), 16, 6, (u) => R * 0.22 * (1 - u * 0.8));
      t.add(new THREE.Mesh(g, flesh));
      root.add(t);
      tendrils.push(t);
    }
  }
  return { root, muzzle, core: mo.core!, glow, flare: mo.flare, tendrils, length: end.z + mr };
}

// ================================================================ shots

export interface GlowShot {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  from: 'player' | 'enemy';
  damage: number;
  mesh: THREE.Group;
  alive: boolean;
}

/**
 * Glowing projectiles: a bright core with a halo, a short trail of fading
 * blobs. `gravity` pulls them down (the goo sags; the bolts don't). The
 * scene steps them and says what each one hit (`step` gets the segment it
 * covered this frame and returns where it stopped, or null).
 */
export class GlowShots {
  readonly group = new THREE.Group();
  private pool: GlowShot[] = [];
  private trailI = 0;
  private trail: THREE.Sprite[] = [];
  private trailT: number[] = [];

  constructor(
    private color: number,
    private size: number,
    private gravity: number,
    private wobble = 0,
    count = 40
  ) {
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55), toneMapped: false });
    const shellMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Group();
      const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.5, 10, 8), coreMat);
      const shell = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 10), shellMat);
      m.add(core, shell, glowSprite(color, size * 6, 0.65));
      m.visible = false;
      this.group.add(m);
      this.pool.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, from: 'enemy', damage: 1, mesh: m, alive: false });
    }
    for (let i = 0; i < count * 3; i++) {
      const s = glowSprite(color, size * 3, 0);
      s.visible = false;
      this.group.add(s);
      this.trail.push(s);
      this.trailT.push(0);
    }
  }

  fire(from: THREE.Vector3, vel: THREE.Vector3, who: 'player' | 'enemy', damage = 1): GlowShot | null {
    const s = this.pool.find((x) => !x.alive);
    if (!s) return null;
    s.pos.copy(from);
    s.vel.copy(vel);
    s.life = 4;
    s.from = who;
    s.damage = damage;
    s.alive = true;
    s.mesh.visible = true;
    s.mesh.position.copy(from);
    return s;
  }

  /** Every live shot moved; `step(shot, a, b)` returns true if it stopped. */
  update(dt: number, t: number, step: (s: GlowShot, a: THREE.Vector3, b: THREE.Vector3) => boolean): void {
    const a = new THREE.Vector3();
    for (const s of this.pool) {
      if (!s.alive) continue;
      s.life -= dt;
      a.copy(s.pos);
      s.vel.y -= this.gravity * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.life <= 0 || step(s, a, s.pos)) {
        s.alive = false;
        s.mesh.visible = false;
        continue;
      }
      s.mesh.position.copy(s.pos);
      // Goo wobbles as it flies
      if (this.wobble) {
        const k = this.wobble;
        s.mesh.scale.set(1 + Math.sin(t * 31 + s.life * 7) * k, 1 + Math.cos(t * 27 + s.life * 5) * k, 1 + Math.sin(t * 23) * k * 0.5);
      }
      // A blob of trail left behind
      const tr = this.trail[this.trailI];
      tr.position.copy(s.pos);
      tr.visible = true;
      this.trailT[this.trailI] = 0.25;
      this.trailI = (this.trailI + 1) % this.trail.length;
    }
    for (let i = 0; i < this.trail.length; i++) {
      if (this.trailT[i] <= 0) continue;
      this.trailT[i] -= dt;
      const k = Math.max(0, this.trailT[i] / 0.25);
      const tr = this.trail[i];
      (tr.material as THREE.SpriteMaterial).opacity = 0.45 * k;
      tr.scale.setScalar(this.size * (1.2 + 2.2 * k));
      if (this.trailT[i] <= 0) tr.visible = false;
    }
  }

  clear(): void {
    for (const s of this.pool) {
      s.alive = false;
      s.mesh.visible = false;
    }
  }
}

// ================================================================ droplets

/** Splashes: little blobs thrown out of a hit, falling, gone. Any colour. */
export class Droplets {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  private n: number;

  constructor(n = 600) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, '#fff');
    gr.addColorStop(0.6, '#fff');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 32, 32);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, map: new THREE.CanvasTexture(c), transparent: true, alphaTest: 0.3, depthWrite: false }));
    this.points.frustumCulled = false;
  }

  burst(at: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number, color: number): void {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.pos[i * 3] = at.x;
      this.pos[i * 3 + 1] = at.y;
      this.pos[i * 3 + 2] = at.z;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.vel[i * 3] = (dir.x + (Math.random() - 0.5) * 1.4) * s;
      this.vel[i * 3 + 1] = (dir.y + Math.random() * 0.9) * s;
      this.vel[i * 3 + 2] = (dir.z + (Math.random() - 0.5) * 1.4) * s;
      const v = 0.75 + Math.random() * 0.5;
      this.col[i * 3] = c.r * v;
      this.col[i * 3 + 1] = c.g * v;
      this.col[i * 3 + 2] = c.b * v;
      this.life[i] = 0.6 + Math.random() * 0.8;
    }
  }

  update(dt: number, floor: (x: number, z: number) => number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 14 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = floor(this.pos[i * 3], this.pos[i * 3 + 2]);
      if (this.pos[i * 3 + 1] < f + 0.02) {
        this.pos[i * 3 + 1] = f + 0.02;
        this.vel[i * 3] *= 0.2;
        this.vel[i * 3 + 1] = 0;
        this.vel[i * 3 + 2] *= 0.2;
      }
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -999;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ================================================================ hound

let houndSkin: THREE.MeshStandardMaterial | null = null;

/**
 * A hound. A long low body, ribs showing, a ridge of spines down its back;
 * four long legs, the back ones bent like a dog's; a whip of a tail. No head
 * to speak of: the neck ends in a mouth, a flared ring of lip and teeth
 * that gapes wider as it lunges.
 */
export class Hound {
  readonly group = new THREE.Group();
  /** For bullets: an invisible box round the body, one round the mouth. */
  readonly hitboxes: THREE.Mesh[] = [];
  private body = new THREE.Group();
  private legs: { hip: THREE.Group; knee: THREE.Group; front: boolean; side: number }[] = [];
  private tail: THREE.Group[] = [];
  private jaw: THREE.Group;
  private neck = new THREE.Group();
  hp = 3;
  alive = true;
  state: 'lurk' | 'run' | 'lunge' | 'recover' | 'dead' = 'lurk';
  stateT = 0;
  /** Gallop phase. */
  private ph = Math.random() * 6;
  speed = 0;
  yaw = 0;
  readonly vel = new THREE.Vector3();
  readonly knock = new THREE.Vector3();
  deadT = 0;
  /** Has its lunge landed yet. */
  bit = false;
  screechT = 1 + Math.random() * 2;
  /** Off the ground (a lunge, or a jump). */
  air = 0;
  airV = 0;

  constructor() {
    if (!houndSkin) houndSkin = new THREE.MeshStandardMaterial({ map: skinTexture('#6e6470', '#3a3040', '#9a8a96', '#2a1a2a'), roughness: 0.55, emissive: 0x0a0408 });
    const skin = houndSkin;
    const g = this.group;
    g.add(this.body);
    this.body.position.y = 0.72;
    // ---- Torso: a deep chest tapering to narrow hips, the ribs standing out
    const torsoCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.04, -0.62), new THREE.Vector3(0, 0.06, -0.2), new THREE.Vector3(0, 0.02, 0.25), new THREE.Vector3(0, 0.08, 0.55)]);
    const torso = new THREE.Mesh(
      profiledTube(torsoCurve, 32, 14, (u) => {
        const chest = 0.15 + 0.12 * smooth(u / 0.65) - 0.1 * smooth((u - 0.85) / 0.15);
        const rib = u > 0.4 && u < 0.85 ? 1 + 0.06 * Math.max(0, Math.sin(u * 70)) : 1;
        return chest * rib;
      }),
      skin
    );
    torso.scale.set(0.85, 1.15, 1);
    this.body.add(torso);
    // Spines down the back
    for (let k = 0; k < 9; k++) {
      const u = 0.1 + k * 0.1;
      const c = torsoCurve.getPointAt(u);
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12 + Math.sin(u * Math.PI) * 0.1, 5), toothMat);
      sp.position.set(c.x, c.y + 0.3 * (0.6 + 0.5 * Math.sin(u * Math.PI)), c.z);
      sp.rotation.x = -0.6;
      this.body.add(sp);
    }
    // ---- The neck, reaching forward and down, and the mouth on the end of it
    this.neck.position.set(0, 0.12, 0.55);
    this.body.add(this.neck);
    const neckCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -0.05), new THREE.Vector3(0, 0.04, 0.15), new THREE.Vector3(0, -0.02, 0.32)]);
    this.neck.add(new THREE.Mesh(profiledTube(neckCurve, 12, 12, (u) => 0.14 - 0.02 * u), skin));
    const mo = mouth(0.2, 0.26, { teeth: 20, skin });
    mo.group.position.set(0, -0.02, 0.42);
    this.neck.add(mo.group);
    this.jaw = mo.flare;
    // ---- Legs: front straight-ish, back bent; each a thigh and a shin, a splayed foot
    const leg = (x: number, z: number, front: boolean): void => {
      const hip = new THREE.Group();
      hip.position.set(x, -0.02, z);
      this.body.add(hip);
      const thighL = front ? 0.36 : 0.34;
      const shinL = front ? 0.4 : 0.44;
      const th = new THREE.Mesh(new THREE.CylinderGeometry(0.06, front ? 0.075 : 0.1, thighL, 8), skin);
      th.position.y = -thighL / 2;
      hip.add(th);
      const knee = new THREE.Group();
      knee.position.y = -thighL;
      hip.add(knee);
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.055, shinL, 7), skin);
      sh.position.y = -shinL / 2;
      knee.add(sh);
      // Toes: three claws
      for (let t = -1; t <= 1; t++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.1, 5), toothMat);
        c.position.set(t * 0.03, -shinL - 0.01, 0.05);
        c.rotation.x = Math.PI / 2 + 0.3;
        knee.add(c);
      }
      this.legs.push({ hip, knee, front, side: Math.sign(x) });
    };
    leg(-0.15, 0.38, true);
    leg(0.15, 0.38, true);
    leg(-0.13, -0.5, false);
    leg(0.13, -0.5, false);
    // ---- Tail: a chain of shrinking segments
    let parent: THREE.Object3D = this.body;
    let z = -0.62;
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Group();
      s.position.set(0, k === 0 ? 0.06 : 0, z);
      parent.add(s);
      const r = 0.05 * (1 - k * 0.14);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.14, 6), skin);
      seg.rotation.x = Math.PI / 2;
      seg.position.z = -0.07;
      s.add(seg);
      this.tail.push(s);
      parent = s;
      z = -0.14;
    }
    // ---- Hitboxes
    const hm = new THREE.MeshBasicMaterial({ visible: false });
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.3), hm);
    hb.position.set(0, 0.72, 0);
    const hh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.45), hm);
    hh.position.set(0, 0.8, 0.95);
    hb.userData.hound = this;
    hh.userData.hound = this;
    hh.userData.head = true;
    g.add(hb, hh);
    this.hitboxes.push(hb, hh);
    g.traverse((o) => (o.castShadow = false));
  }

  /** Mouth position in the world. */
  mouthWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.jaw.getWorldPosition(out);
  }

  /**
   * Pose it for this frame: the gallop from its speed, the mouth gaping on
   * a lunge, a fall onto its side once it's dead.
   */
  animate(dt: number, t: number): void {
    const run = Math.min(1, this.speed / 7);
    this.ph += dt * (4 + this.speed * 1.8);
    const ph = this.ph;
    for (const l of this.legs) {
      // A rotary gallop: fronts together, backs together, half a stride apart
      const off = (l.front ? 0 : Math.PI) + (l.side > 0 ? 0.35 : 0);
      const s = Math.sin(ph + off);
      const c = Math.cos(ph + off);
      if (this.alive) {
        l.hip.rotation.x = s * (0.15 + 0.75 * run) + (l.front ? 0 : 0.25);
        l.knee.rotation.x = l.front ? -Math.max(0, c) * (0.3 + 0.9 * run) - 0.1 : 0.4 + Math.max(0, -c) * (0.4 + 0.6 * run);
      } else {
        // Curled up
        const k = smooth(this.deadT / 0.6);
        l.hip.rotation.x += ((l.front ? 0.9 : -0.5) - l.hip.rotation.x) * k * 0.2;
        l.knee.rotation.x += ((l.front ? -1.4 : 1.6) - l.knee.rotation.x) * k * 0.2;
      }
    }
    // The body rocks with the stride; the neck reaches out on a run
    if (this.alive) {
      this.body.rotation.x = Math.sin(ph * 2) * 0.06 * run;
      this.body.position.y = 0.72 + Math.abs(Math.sin(ph)) * 0.08 * run;
      this.neck.rotation.x = 0.15 * run + Math.sin(ph * 2 + 1) * 0.05 + (this.state === 'lunge' ? -0.25 : 0);
    }
    this.tail.forEach((s, i) => {
      s.rotation.y = Math.sin(t * 6 + i * 0.8) * (this.alive ? 0.25 : 0.05);
      s.rotation.x = 0.12 + (this.alive ? -0.1 * run : 0.15);
    });
    // The mouth: always working, wide on the lunge
    const gape = this.state === 'lunge' ? 1.35 : this.alive ? 1 + Math.sin(t * 9 + ph) * 0.08 : 0.85;
    this.jaw.scale.set(gape, gape, 1);
    // Dead: over on its side
    if (!this.alive) {
      const k = smooth(this.deadT / 0.5);
      this.body.rotation.z = k * 1.45;
      this.body.position.y = 0.72 - k * 0.42;
    }
  }
}

// ================================================================ the big one

interface SpiderLeg {
  hip: THREE.Vector3;
  /** Where its foot rests on the body's frame when standing still. */
  home: THREE.Vector3;
  foot: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  stepT: number;
  group: 0 | 1;
  thigh: THREE.Mesh;
  shin: THREE.Mesh;
  knee: THREE.Mesh;
}

/**
 * The big one: a grub on spider legs. Its body is a long ribbed egg, grey
 * and segmented, a mouth at the front with a ring of fangs; on either side
 * of the mouth an arm with a cannon for a hand; six legs, three a side,
 * thrown out and up to high knees and down to points. The scene drives
 * where it goes and what it aims at; this places the legs (stepping in two
 * tripods) and the arms.
 */
export class SpiderBoss {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly arms: AlienArmParts[] = [];
  readonly armPivots: THREE.Group[] = [];
  readonly hitMeshes: THREE.Object3D[] = [];
  readonly mouthCore: THREE.Mesh;
  private legs: SpiderLeg[] = [];
  private mouthFlare: THREE.Group;
  readonly maxHp = 110;
  hp = 110;
  alive = true;
  deadT = 0;
  /** Where it's facing (radians about Y); its speed along the ground, for the legs. */
  yaw = 0;
  readonly at = new THREE.Vector3();
  private t = 0;
  /** 0..1 each arm's recoil. */
  readonly kick = [0, 0];
  /** How high the body rides over the ground. */
  static readonly RIDE = 2.7;
  /** The arm taken (severed); it no longer follows the body. */
  severed = -1;

  constructor(private ground: (x: number, z: number) => number) {
    // ---- The body: a lathe, the ribbed bands its texture
    const tex = ribTexture();
    tex.repeat.set(3, 1);
    const hide = new THREE.MeshStandardMaterial({ map: tex, color: 0xb8b4ae, roughness: 0.5, metalness: 0.1 });
    const pts: THREE.Vector2[] = [];
    const L = 3.6;
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const y = -L / 2 + u * L;
      // Fat behind, narrowing to the mouth, a bulge of segments
      let r = 1.15 * Math.pow(Math.sin(Math.PI * Math.min(0.98, 0.04 + u * 0.92)), 0.6) * (1 - 0.25 * u);
      r *= 1 + 0.045 * Math.sin(u * 60);
      if (u > 0.92) r = Math.max(r, 0.6);
      pts.push(new THREE.Vector2(Math.max(0.02, r), y));
    }
    const geo = new THREE.LatheGeometry(pts, 40);
    geo.rotateX(Math.PI / 2);
    const hull = new THREE.Mesh(geo, hide);
    hull.scale.set(1, 0.85, 1);
    this.body.add(hull);
    this.hitMeshes.push(hull);
    // Pale belly plates
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.45 });
    for (let k = 0; k < 7; k++) {
      const z = -1.4 + k * 0.4;
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.55 - Math.abs(k - 3) * 0.06, 16, 8, 0, Math.PI * 2, 0, 0.8), plateMat);
      p.rotation.x = Math.PI;
      p.position.set(0, -0.62, z);
      p.scale.set(1, 0.35, 0.5);
      this.body.add(p);
    }
    // Bumps and a ridge along the back
    for (let k = 0; k < 9; k++) {
      const z = -1.5 + k * 0.36;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), hide);
      b.position.set(0, 0.92 - Math.abs(z) * 0.18, z);
      b.scale.set(1.4, 0.6, 1);
      this.body.add(b);
    }
    // ---- The mouth: a fanged pit at the front
    const mo = mouth(0.62, 0.8, { teeth: 22, glow: 0xff5a3a });
    mo.group.position.set(0, -0.05, L / 2 - 0.05);
    this.body.add(mo.group);
    this.mouthFlare = mo.flare;
    this.mouthCore = mo.core!;
    // Big fangs either side, hooked down
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 7), toothMat);
      f.position.set(s * 0.42, -0.4, L / 2 + 0.15);
      f.rotation.set(Math.PI + 0.4, 0, s * 0.25);
      this.body.add(f);
    }
    // A cluster of small black eyes over the mouth
    const eyeM = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1, metalness: 0.4 });
    for (let k = 0; k < 6; k++) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.05 + (k % 2) * 0.025, 10, 8), eyeM);
      e.position.set((k - 2.5) * 0.13, 0.5 + Math.abs(k - 2.5) * -0.04, L / 2 - 0.35);
      this.body.add(e);
    }
    const mhit = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    mhit.position.copy(mo.group.position);
    mhit.userData.head = true;
    this.body.add(mhit);
    this.hitMeshes.push(mhit);
    // ---- The arms, from either side of the mouth
    for (const s of [-1, 1]) {
      const piv = new THREE.Group();
      piv.position.set(s * 0.82, -0.15, L / 2 - 0.7);
      this.body.add(piv);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), fleshMat());
      piv.add(shoulder);
      const arm = alienArm(2.4);
      piv.add(arm.root);
      this.arms.push(arm);
      this.armPivots.push(piv);
      arm.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) this.hitMeshes.push(o);
      });
    }
    // ---- Legs: three a side
    const chitin = new THREE.MeshStandardMaterial({ color: 0x3a3436, roughness: 0.35, metalness: 0.25 });
    const thighG = new THREE.CylinderGeometry(0.12, 0.19, 1, 10);
    thighG.translate(0, 0.5, 0);
    const shinG = new THREE.CylinderGeometry(0.035, 0.12, 1, 10);
    shinG.translate(0, 0.5, 0);
    const kneeG = new THREE.SphereGeometry(0.18, 12, 10);
    for (const [i, z] of [0.75, 0.0, -0.8].entries()) {
      for (const s of [-1, 1]) {
        const hip = new THREE.Vector3(s * 0.75, -0.2, z);
        const home = new THREE.Vector3(s * 3.3, 0, z * 2.0 + (i === 0 ? 0.8 : i === 2 ? -0.6 : 0));
        const thigh = new THREE.Mesh(thighG, chitin);
        const shin = new THREE.Mesh(shinG, chitin);
        const knee = new THREE.Mesh(kneeG, chitin);
        this.group.add(thigh, shin, knee);
        this.hitMeshes.push(thigh);
        this.legs.push({ hip, home, foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), stepT: -1, group: ((i + (s > 0 ? 1 : 0)) % 2) as 0 | 1, thigh, shin, knee });
      }
    }
    // Big: the size of a car
    this.body.scale.setScalar(1.3);
    this.group.add(this.body);
    for (const o of this.hitMeshes) o.userData.boss = this;
    this.group.traverse((o) => (o.castShadow = false));
  }

  /** Put it somewhere, standing, its feet planted. */
  place(x: number, z: number, yaw: number): void {
    this.at.set(x, this.ground(x, z), z);
    this.yaw = yaw;
    this.layBody(0);
    for (const l of this.legs) {
      this.homeWorld(l, l.foot);
      l.stepT = -1;
    }
    this.layLegs();
  }

  private homeWorld(l: SpiderLeg, out: THREE.Vector3, lead = new THREE.Vector3()): THREE.Vector3 {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const x = this.at.x + l.home.x * c + l.home.z * s + lead.x;
    const z = this.at.z - l.home.x * s + l.home.z * c + lead.z;
    return out.set(x, this.ground(x, z), z);
  }

  private layBody(dt: number): void {
    this.t += dt;
    this.group.position.set(0, 0, 0);
    this.body.position.set(this.at.x, this.at.y + SpiderBoss.RIDE + Math.sin(this.t * 2.2) * 0.06, this.at.z);
    this.body.rotation.set(-0.12 + Math.sin(this.t * 1.7) * 0.03, this.yaw, Math.sin(this.t * 1.3) * 0.03);
  }

  /**
   * One frame. `vel` is how it's moving over the ground (for where its feet
   * reach to); `aims` where each arm points (world), or null to let it hang.
   */
  update(dt: number, vel: THREE.Vector3, aims: (THREE.Vector3 | null)[]): void {
    if (!this.alive) {
      this.deadT += dt;
      const k = smooth(this.deadT / 1.2);
      this.body.position.y += (this.at.y + 1.15 - this.body.position.y) * Math.min(1, dt * 3 * (0.3 + k));
      this.body.rotation.z += (0.22 - this.body.rotation.z) * Math.min(1, dt * 2);
      this.body.rotation.x += (0.08 - this.body.rotation.x) * Math.min(1, dt * 2);
      // Feet slide out as it settles
      for (const l of this.legs) {
        const out = new THREE.Vector3().subVectors(l.foot, this.at).setY(0).normalize();
        if (k < 1) l.foot.addScaledVector(out, dt * 0.8 * (1 - k));
        l.foot.y = this.ground(l.foot.x, l.foot.z);
      }
      this.armPivots.forEach((p, i) => {
        if (i === this.severed) return;
        p.rotation.x += (0.9 - p.rotation.x) * Math.min(1, dt * 2);
        p.rotation.y += (0 - p.rotation.y) * Math.min(1, dt * 2);
      });
      const fade = Math.max(0, 1 - this.deadT / 2);
      for (const a of this.arms) {
        (a.glow.material as THREE.SpriteMaterial).opacity = 0.55 * fade;
        a.core.scale.setScalar(0.3 + 0.7 * fade);
      }
      this.mouthCore.scale.setScalar(0.2 + 0.8 * fade);
      this.layLegs();
      return;
    }
    this.layBody(dt);
    // ---- Steps: a foot too far from where it wants to be steps there, a tripod at a time
    const lead = vel.clone().multiplyScalar(0.45);
    const want = new THREE.Vector3();
    const stepping = [0, 0];
    for (const l of this.legs) if (l.stepT >= 0) stepping[l.group]++;
    for (const l of this.legs) {
      if (l.stepT >= 0) {
        l.stepT += dt / 0.28;
        const u = Math.min(1, l.stepT);
        l.foot.lerpVectors(l.from, l.to, smooth(u));
        l.foot.y += Math.sin(u * Math.PI) * 0.7;
        if (u >= 1) l.stepT = -1;
        continue;
      }
      this.homeWorld(l, want, lead);
      const other = l.group === 0 ? 1 : 0;
      if (want.distanceTo(l.foot) > 1.1 && stepping[other] === 0) {
        l.from.copy(l.foot);
        l.to.copy(want);
        l.stepT = 0;
        stepping[l.group]++;
      }
    }
    this.layLegs();
    // ---- Arms: turned toward what they're aiming at, kicked back when they fire
    this.armPivots.forEach((p, i) => {
      if (i === this.severed) return;
      this.kick[i] = Math.max(0, this.kick[i] - dt * 4);
      const aim = aims[i];
      let ry = 0;
      let rx = 0.35 + Math.sin(this.t * 1.4 + i * 2) * 0.08;
      if (aim) {
        p.parent!.updateWorldMatrix(true, false);
        const loc = p.parent!.worldToLocal(aim.clone()).sub(p.position);
        ry = Math.atan2(loc.x, loc.z);
        rx = -Math.atan2(loc.y, Math.hypot(loc.x, loc.z));
      }
      rx -= this.kick[i] * 0.35;
      p.rotation.order = 'YXZ';
      p.rotation.y += (THREE.MathUtils.clamp(ry, -0.9, 0.9) - p.rotation.y) * Math.min(1, dt * 5);
      p.rotation.x += (THREE.MathUtils.clamp(rx, -0.8, 0.9) - p.rotation.x) * Math.min(1, dt * 5);
      this.arms[i].root.position.z = -this.kick[i] * 0.25;
    });
    // The cores and the mouth pulsing, the electric flicker in them
    for (const [i, a] of this.arms.entries()) {
      const f = 0.85 + 0.25 * Math.sin(this.t * 13 + i * 3) + (Math.random() - 0.5) * 0.25 + this.kick[i] * 1.5;
      a.core.scale.setScalar(f);
      (a.glow.material as THREE.SpriteMaterial).opacity = 0.4 + 0.25 * f;
    }
    this.mouthFlare.scale.setScalar(1 + Math.sin(this.t * 3) * 0.06);
  }

  /** Thighs, knees and shins laid between the hips and the feet: up and out to a high knee, down to the point. */
  private layLegs(): void {
    this.body.updateMatrixWorld(true);
    const A = 2.4;
    const B = 3.1;
    const hipW = new THREE.Vector3();
    const kneeW = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const d = new THREE.Vector3();
    for (const l of this.legs) {
      hipW.copy(l.hip).applyMatrix4(this.body.matrixWorld);
      d.subVectors(l.foot, hipW);
      const dist = THREE.MathUtils.clamp(d.length(), 0.3, (A + B) * 0.995);
      d.normalize();
      const ang = Math.acos(THREE.MathUtils.clamp((A * A + dist * dist - B * B) / (2 * A * dist), -1, 1));
      // The knee bends up and out
      const out = new THREE.Vector3(l.foot.x - hipW.x, 0, l.foot.z - hipW.z).normalize();
      const pole = UP.clone().multiplyScalar(1).addScaledVector(out, 0.3);
      const n = pole.addScaledVector(d, -pole.dot(d)).normalize();
      kneeW.copy(hipW).addScaledVector(d, Math.cos(ang) * A).addScaledVector(n, Math.sin(ang) * A);
      // Segments: each a unit cylinder along +Y, scaled to length
      const seg = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void => {
        const v = new THREE.Vector3().subVectors(b, a);
        const len = v.length();
        m.position.copy(a);
        m.quaternion.copy(q.setFromUnitVectors(UP, v.normalize()));
        m.scale.set(1, len, 1);
      };
      seg(l.thigh, hipW, kneeW);
      seg(l.shin, kneeW, l.foot);
      l.knee.position.copy(kneeW);
    }
  }

  /** Muzzle of arm i in the world. */
  muzzle(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.arms[i].muzzle.getWorldPosition(out);
  }

  /** The root of arm i (its shoulder) in the world. */
  shoulder(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.armPivots[i].getWorldPosition(out);
  }

  /** Take arm i off: it stays where it is in the world, no longer the body's. */
  sever(i: number, scene: THREE.Object3D): THREE.Group {
    this.severed = i;
    const arm = this.arms[i].root;
    scene.attach(arm);
    return arm;
  }
}
