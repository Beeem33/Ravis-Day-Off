import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * AlienCreatures — what lives on the far side of the Atom Warper.
 *
 *  - Hound: a dog's body, low and fast, and where its face should be just a
 *    mouth: a wide fleshy funnel ringed with needle teeth.
 *  - SpiderBoss: a great grub, grey shell plates over wet pink flesh, a fanged
 *    mouth at the front, two fleshy arms each ending in a cannon-head that
 *    spits blue bolts, six spider legs.
 *  - alienCannon(): the cannon-head on the end of each of its arms — and the
 *    thing Ravi cuts off and wears.
 *  - MawTrap: a mouth in the ground, its jaws laid open flat like petals.
 *    Step in it and they snap shut round his legs.
 *  - GlowShots, Droplets: the bolts and the goo; splashes.
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
function noise3(x: number, y: number, z: number): number {
  return Math.sin(x * 1.7 + Math.sin(y * 2.3 + z)) * 0.5 + Math.sin(y * 2.9 + Math.sin(z * 1.9 + x)) * 0.3 + Math.sin(z * 3.7 + x * 0.7) * 0.2;
}

// ================================================================ skin

/**
 * Wet flesh, in detail: a pale field the vertex colours tint, darker
 * mottling, a web of veins, fine wrinkles; the same canvas is its bump, so
 * the veins stand up and the wrinkles sink in under the light.
 */
function fleshDetail(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8d0d0';
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 260; k++) {
    const v = Math.random() < 0.5 ? 150 : 235;
    g.fillStyle = `rgba(${v},${v - 10},${v - 6},${0.08 + Math.random() * 0.14})`;
    g.beginPath();
    g.ellipse(Math.random() * S, Math.random() * S, 6 + Math.random() * 40, 4 + Math.random() * 22, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.lineCap = 'round';
  for (let k = 0; k < 700; k++) {
    g.strokeStyle = `rgba(90,70,74,${0.12 + Math.random() * 0.2})`;
    g.lineWidth = 0.6 + Math.random();
    const x = Math.random() * S;
    const y = Math.random() * S;
    const a = Math.random() * Math.PI;
    const l = 4 + Math.random() * 12;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 3, y + Math.sin(a) * l * 0.5 - 3, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const vein = (x: number, y: number, a: number, w: number, depth: number): void => {
    let px = x;
    let py = y;
    for (let s = 0; s < 14; s++) {
      a += (Math.random() - 0.5) * 0.7;
      const nx = px + Math.cos(a) * 9;
      const ny = py + Math.sin(a) * 9;
      g.strokeStyle = 'rgba(255,245,245,0.55)';
      g.lineWidth = w + 1.6;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(nx, ny);
      g.stroke();
      g.strokeStyle = 'rgba(120,60,90,0.6)';
      g.lineWidth = w;
      g.stroke();
      px = nx;
      py = ny;
      if (depth < 2 && Math.random() < 0.15) vein(px, py, a + (Math.random() < 0.5 ? 0.8 : -0.8), w * 0.6, depth + 1);
      w *= 0.94;
    }
  };
  for (let k = 0; k < 26; k++) vein(Math.random() * S, Math.random() * S, Math.random() * 6.28, 2.2, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let fleshTex: THREE.CanvasTexture | null = null;
let fleshBump: THREE.CanvasTexture | null = null;
/**
 * The wet, shiny skin everything fleshy is made of — boss, arms, cannons,
 * hounds, traps. White in itself: each piece's vertex colours paint it, so
 * one part shades into the next with no seam of colour between them.
 */
export function wetFlesh(repeat = 2, opts: { clearcoat?: number; rough?: number } = {}): THREE.MeshPhysicalMaterial {
  if (!fleshTex) {
    fleshTex = fleshDetail();
    fleshBump = fleshTex.clone();
    fleshBump.colorSpace = THREE.NoColorSpace;
    fleshBump.needsUpdate = true;
  }
  const map = fleshTex.clone();
  map.repeat.set(repeat, repeat);
  map.needsUpdate = true;
  const bump = fleshBump!.clone();
  bump.repeat.set(repeat, repeat);
  bump.needsUpdate = true;
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    map,
    bumpMap: bump,
    bumpScale: 1.4,
    roughness: opts.rough ?? 0.34,
    metalness: 0.0,
    clearcoat: opts.clearcoat ?? 0.9,
    clearcoatRoughness: 0.16,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xff9ab0),
    sheenRoughness: 0.5,
    side: THREE.DoubleSide
  });
}

/** Paint a geometry's vertices by a function of their position (and normal). */
function paint(g: THREE.BufferGeometry, f: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const nAttr = g.getAttribute('normal') as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.fromBufferAttribute(nAttr, i);
    f(v, n, c);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const solid = (hex: number) => (_p: THREE.Vector3, _n: THREE.Vector3, c: THREE.Color): void => void c.setHex(hex);

const toothMat = new THREE.MeshPhysicalMaterial({ color: 0xe8dfc2, roughness: 0.28, clearcoat: 0.6 });
const throatMat = new THREE.MeshStandardMaterial({ color: 0x2a0408, emissive: 0x500810, emissiveIntensity: 0.8, roughness: 0.4, side: THREE.BackSide });

/** A tube along `curve` whose radius follows `r(u)` (and, optionally, its angle round). */
function profiledTube(curve: THREE.Curve<THREE.Vector3>, segs: number, radial: number, r: (u: number, a: number) => number, closed = false): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, closed);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (radial + 1));
    const a = ((i % (radial + 1)) / radial) * Math.PI * 2;
    const u = ring / segs;
    curve.getPointAt(Math.min(1, u), c);
    v.fromBufferAttribute(p, i).sub(c).multiplyScalar(r(u, a));
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
    const t = new THREE.ConeGeometry(thick * (0.7 + hash(i, 5) * 0.5), l, 6);
    // A slight hook toward the axis
    const p = t.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) / l + 0.5;
      p.setZ(k, p.getZ(k) - y * y * l * 0.25);
    }
    t.translate(0, l / 2, 0);
    const d = new THREE.Vector3(-Math.cos(a) * Math.cos(lean), -Math.sin(a) * Math.cos(lean), Math.sin(lean));
    t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d));
    t.translate(Math.cos(a) * rim, Math.sin(a) * rim, z);
    parts.push(t.toNonIndexed());
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

/**
 * A mouth that opens toward +Z: a fleshy flared funnel with a rolled lip,
 * rings of hooked teeth inside it, a throat going back into the dark.
 * `glow` lights the throat in that colour.
 */
function mouth(radius: number, depth: number, skin: THREE.Material, opts: { teeth?: number; glow?: number; lip?: number; inner?: number } = {}): { group: THREE.Group; core: THREE.Mesh | null; flare: THREE.Group } {
  const group = new THREE.Group();
  const flare = new THREE.Group();
  group.add(flare);
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const u = i / 14;
    pts.push(new THREE.Vector2(radius * (0.32 + 0.68 * Math.pow(u, 1.5)), -depth + depth * u));
  }
  pts.push(new THREE.Vector2(radius * 1.08, depth * 0.07));
  pts.push(new THREE.Vector2(radius * 1.18, -depth * 0.02));
  pts.push(new THREE.Vector2(radius * 1.12, -depth * 0.18));
  pts.push(new THREE.Vector2(radius * 0.98, -depth * 0.5));
  const lathe = new THREE.LatheGeometry(pts, 36);
  lathe.rotateX(Math.PI / 2);
  const p = lathe.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const a = Math.atan2(y, x);
    const k = 1 + Math.sin(a * 5 + 1.3) * 0.05 + Math.sin(a * 9) * 0.03;
    p.setXY(i, x * k, y * k);
  }
  lathe.computeVertexNormals();
  const lip = new THREE.Color(opts.lip ?? 0x6a1626);
  const inner = new THREE.Color(opts.inner ?? 0xd06a7a);
  paint(lathe, (q, _n, c) => void c.copy(inner).lerp(lip, smooth((q.z + depth * 0.4) / (depth * 0.45))));
  flare.add(new THREE.Mesh(lathe, skin));
  const throat = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), throatMat);
  throat.rotation.x = -Math.PI / 2;
  throat.position.z = -depth * 0.92;
  flare.add(throat);
  const n = opts.teeth ?? 18;
  flare.add(new THREE.Mesh(teethRing(n, radius * 0.98, radius * 0.4, radius * 0.06, 0.35, -depth * 0.05), toothMat));
  flare.add(new THREE.Mesh(teethRing(Math.round(n * 0.75), radius * 0.66, radius * 0.32, radius * 0.05, 0.15, -depth * 0.42), toothMat));
  flare.add(new THREE.Mesh(teethRing(Math.round(n * 0.5), radius * 0.45, radius * 0.22, radius * 0.04, 0.05, -depth * 0.7), toothMat));
  let core: THREE.Mesh | null = null;
  if (opts.glow !== undefined) {
    core = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.28, 18, 12), new THREE.MeshBasicMaterial({ color: opts.glow, toneMapped: false }));
    core.position.z = -depth * 0.74;
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

// ================================================================ the cannon

export interface CannonParts {
  root: THREE.Group;
  /** Where the shot leaves (+Z end). */
  muzzle: THREE.Object3D;
  core: THREE.Mesh;
  glow: THREE.Sprite;
  flare: THREE.Group;
  /** The feelers at its back end that close round whatever it's on. */
  tendrils: THREE.Object3D[];
  length: number;
}

let cannonSkin: THREE.MeshPhysicalMaterial | null = null;
const veinGlow = new THREE.MeshStandardMaterial({ color: 0x163050, emissive: 0x3ab0ff, emissiveIntensity: 1.6, roughness: 0.3 });

/** Which of the two the cannon is: the acid-spitter or the grabber. */
export type AlienKind = 'acid' | 'grabber';
/** Each one's light: acid a sick yellow-green, the grabber a hot magenta. */
export const KIND_GLOW: Record<AlienKind, number> = { acid: 0xa8ff2a, grabber: 0xff3ac8 };
const kindMats = new Map<AlienKind, { vein: THREE.MeshStandardMaterial; spot: THREE.MeshBasicMaterial }>();
function kindMat(k: AlienKind): { vein: THREE.MeshStandardMaterial; spot: THREE.MeshBasicMaterial } {
  let m = kindMats.get(k);
  if (!m) {
    const c = new THREE.Color(KIND_GLOW[k]);
    m = {
      vein: new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.15), emissive: c, emissiveIntensity: 1.5, roughness: 0.3 }),
      spot: new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), 0.35), toneMapped: false })
    };
    kindMats.set(k, m);
  }
  return m;
}

/** The grabber's tongue-tip: a small round mouth of teeth, opening forward (+Z). */
export function grabberHead(): { group: THREE.Group; flare: THREE.Group } {
  if (!cannonSkin) cannonSkin = wetFlesh(1.2);
  const g = new THREE.Group();
  const mo = mouth(0.11, 0.12, cannonSkin, { teeth: 12, glow: KIND_GLOW.grabber, lip: 0x7a1a4a, inner: 0xd060a0 });
  g.add(mo.group);
  const bulb = new THREE.SphereGeometry(0.1, 16, 12);
  bulb.scale(1, 1, 1.3);
  bulb.translate(0, 0, -0.14);
  paint(bulb, solid(0x8a2a5a));
  g.add(new THREE.Mesh(bulb, cannonSkin));
  return { group: g, flare: mo.flare };
}

/**
 * The cannon-head: from the cuff at its back (the origin) to the lips of
 * its mouth (+Z), about 0.8 m. A ribbed, muscular barrel, glowing veins and
 * spots where the light inside shows through, gristle rings, a flared toothed
 * mouth with a blue core; at the back a fleshy cuff, and feelers that curl
 * back from it to grip.
 */
export function alienCannon(kind: AlienKind = 'acid'): CannonParts {
  if (!cannonSkin) cannonSkin = wetFlesh(1.2);
  const skin = cannonSkin;
  const km = kindMat(kind);
  const root = new THREE.Group();
  const L = 0.62;
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.01, L * 0.35), new THREE.Vector3(0, -0.005, L * 0.7), new THREE.Vector3(0, 0, L)]);
  const prof = (u: number, a: number): number => {
    const base = 0.088 + 0.045 * Math.sin(Math.min(1, u / 0.75) * Math.PI) + 0.03 * smooth((u - 0.82) / 0.18);
    const rib = 1 + 0.06 * Math.pow(Math.max(0, Math.sin(u * 52)), 3);
    const muscle = 1 + 0.06 * Math.sin(a * 3 + u * 4);
    return base * rib * muscle;
  };
  const barrel = profiledTube(curve, 72, 22, prof);
  paint(barrel, (q, n, c) => void c.setHex(0x8a2a46).lerp(new THREE.Color(0xc87888), Math.max(0, -n.y) * 0.5).lerp(new THREE.Color(0x4a0e22), smooth((q.z - L * 0.7) / (L * 0.3)) * 0.6));
  root.add(new THREE.Mesh(barrel, skin));
  for (let k = 0; k < 5; k++) {
    const u = 0.18 + k * 0.14;
    const c = curve.getPointAt(u);
    const ring = new THREE.TorusGeometry(prof(u, 0) * 1.02, 0.009, 8, 28);
    paint(ring, solid(0x5a1428));
    const rm = new THREE.Mesh(ring, skin);
    rm.position.copy(c);
    root.add(rm);
  }
  for (let k = 0; k < 4; k++) {
    const a0 = k * 1.6 + 0.3;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const u = 0.06 + (i / 12) * 0.84;
      const c = curve.getPointAt(u);
      const a = a0 + Math.sin(u * 8 + k) * 0.4;
      const r = prof(u, a) * 0.99;
      pts.push(new THREE.Vector3(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, c.z));
    }
    root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0055, 6), km.vein));
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.2;
    const u = 0.62 + (k % 3) * 0.08;
    const c = curve.getPointAt(u);
    const r = prof(u, a);
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.006 + (k % 2) * 0.004, 8, 6), km.spot);
    s.position.set(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, c.z);
    root.add(s);
  }
  const mo = mouth(0.13, 0.16, skin, { teeth: 16, glow: KIND_GLOW[kind], lip: 0x4a0e22, inner: 0xc05070 });
  // The grabber's tongue, coiled up in its throat
  if (kind === 'grabber') {
    const coil: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = i * 0.7;
      coil.push(new THREE.Vector3(Math.cos(a) * 0.05, Math.sin(a) * 0.05, L - 0.02 + i * 0.004));
    }
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 48, 0.018, 8);
    paint(tg, solid(0xc04a8a));
    root.add(new THREE.Mesh(tg, skin));
  }
  mo.group.position.set(0, 0, L + 0.07);
  root.add(mo.group);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, L + 0.1);
  root.add(muzzle);
  const glow = glowSprite(KIND_GLOW[kind], 0.42, 0.6);
  glow.position.set(0, 0, L + 0.02);
  root.add(glow);
  const cuffPts = [new THREE.Vector2(0.06, -0.02), new THREE.Vector2(0.095, -0.01), new THREE.Vector2(0.105, 0.03), new THREE.Vector2(0.095, 0.06)];
  const cuff = new THREE.LatheGeometry(cuffPts, 28);
  cuff.rotateX(Math.PI / 2);
  paint(cuff, solid(0x6a1a32));
  root.add(new THREE.Mesh(cuff, skin));
  const tendrils: THREE.Object3D[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const t = new THREE.Group();
    t.rotation.z = a;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const r = 0.085 - u * 0.035;
      const sw = u * 0.9 + Math.sin(k * 1.7) * 0.2;
      pts.push(new THREE.Vector3(Math.cos(sw) * r, Math.sin(sw) * r, -0.01 - u * (0.2 + (k % 3) * 0.04)));
    }
    const geo = profiledTube(new THREE.CatmullRomCurve3(pts), 20, 8, (u) => 0.016 * (1 - u * 0.8));
    paint(geo, solid(0x7a2440));
    t.add(new THREE.Mesh(geo, skin));
    root.add(t);
    tendrils.push(t);
  }
  return { root, muzzle, core: mo.core!, glow, flare: mo.flare, tendrils, length: L + 0.1 };
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
 * scene steps them and says what each one hit.
 */
export class GlowShots {
  readonly group = new THREE.Group();
  readonly pool: GlowShot[] = [];
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
      if (this.wobble) {
        const k = this.wobble;
        s.mesh.scale.set(1 + Math.sin(t * 31 + s.life * 7) * k, 1 + Math.cos(t * 27 + s.life * 5) * k, 1 + Math.sin(t * 23) * k * 0.5);
      }
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

let houndSkin: THREE.MeshPhysicalMaterial | null = null;

/**
 * A smooth limb: a thigh that's one muscled tube, sunk into a fleshy ball at
 * the hip, a ball at the knee the same size as the tube where it meets it, a
 * shin, a pad of a paw with hooked claws. Built along −Y from the hip; each
 * joint its own group so it can bend.
 */
function houndLeg(skin: THREE.Material, front: boolean): { hip: THREE.Group; knee: THREE.Group; paw: THREE.Group } {
  const hip = new THREE.Group();
  const knee = new THREE.Group();
  const paw = new THREE.Group();
  const L1 = front ? 0.34 : 0.33;
  const L2 = front ? 0.4 : 0.44;
  const col = (q: THREE.Vector3, n: THREE.Vector3, c: THREE.Color): void => {
    c.setHex(0x6e6070).lerp(new THREE.Color(0xa898a4), Math.max(0, n.z) * 0.25).lerp(new THREE.Color(0x3a2e3c), smooth(-q.y / 0.4) * 0.5);
  };
  const thigh = profiledTube(
    new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(0, -L1 * 0.4, front ? 0.02 : -0.03), new THREE.Vector3(0, -L1, 0)]),
    24,
    14,
    (u, a) => (front ? 0.07 : 0.095) * (1 - 0.45 * u) * (1 + 0.12 * Math.sin(a * 2) * (1 - u)) + 0.012
  );
  paint(thigh, col);
  hip.add(new THREE.Mesh(thigh, skin));
  const hipBall = new THREE.SphereGeometry(front ? 0.085 : 0.11, 18, 14);
  hipBall.scale(1, 1.1, 1.25);
  paint(hipBall, col);
  hip.add(new THREE.Mesh(hipBall, skin));
  knee.position.y = -L1;
  hip.add(knee);
  const kneeBall = new THREE.SphereGeometry(0.048, 16, 12);
  paint(kneeBall, col);
  knee.add(new THREE.Mesh(kneeBall, skin));
  const shin = profiledTube(
    new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -L2 * 0.5, front ? -0.01 : 0.02), new THREE.Vector3(0, -L2, 0)]),
    24,
    12,
    (u) => 0.044 - 0.016 * u + 0.008 * Math.sin(u * Math.PI)
  );
  paint(shin, col);
  knee.add(new THREE.Mesh(shin, skin));
  paw.position.y = -L2;
  knee.add(paw);
  const pad = new THREE.SphereGeometry(0.045, 16, 10);
  pad.scale(1, 0.55, 1.35);
  pad.translate(0, -0.012, 0.025);
  paint(pad, col);
  paw.add(new THREE.Mesh(pad, skin));
  for (let t = -1; t <= 1; t++) {
    const c = new THREE.ConeGeometry(0.011, 0.07, 6);
    const p = c.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) / 0.07 + 0.5;
      p.setZ(k, p.getZ(k) + y * y * 0.02);
    }
    const cm = new THREE.Mesh(c, toothMat);
    cm.position.set(t * 0.024, -0.025, 0.075);
    cm.rotation.x = Math.PI / 2 + 0.5;
    paw.add(cm);
  }
  return { hip, knee, paw };
}

/**
 * A hound. A long low body, ribs showing, a ridge of spines down its back;
 * four long legs, the back ones bent like a dog's; a whip of a tail. No head
 * to speak of: the neck ends in a mouth that gapes wider as it lunges.
 */
export class Hound {
  readonly group = new THREE.Group();
  readonly hitboxes: THREE.Mesh[] = [];
  private body = new THREE.Group();
  private legs: { hip: THREE.Group; knee: THREE.Group; paw: THREE.Group; front: boolean; side: number }[] = [];
  private tail: THREE.Group[] = [];
  private jaw: THREE.Group;
  private neck = new THREE.Group();
  hp = 3;
  alive = true;
  state: 'lurk' | 'run' | 'lunge' | 'recover' | 'dead' = 'lurk';
  stateT = 0;
  private ph = Math.random() * 6;
  speed = 0;
  yaw = 0;
  readonly vel = new THREE.Vector3();
  readonly knock = new THREE.Vector3();
  deadT = 0;
  bit = false;
  growlT = 4 + Math.random() * 5;
  /** In the grabber's mouth: kicking. */
  held = false;
  /** Melted away (acid): sinks into the ground instead of falling over. */
  melted = false;
  /** Spin while it's swung or thrown. */
  readonly spin = new THREE.Vector3();
  air = 0;
  airV = 0;

  constructor() {
    if (!houndSkin) houndSkin = wetFlesh(1.5, { clearcoat: 0.6, rough: 0.45 });
    const skin = houndSkin;
    const g = this.group;
    g.add(this.body);
    this.body.position.y = 0.72;
    const torsoCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.04, -0.66), new THREE.Vector3(0, 0.06, -0.2), new THREE.Vector3(0, 0.02, 0.25), new THREE.Vector3(0, 0.1, 0.58)]);
    const torso = profiledTube(torsoCurve, 48, 22, (u, a) => {
      const chest = 0.16 + 0.12 * smooth(u / 0.65) - 0.08 * smooth((u - 0.86) / 0.14);
      const rib = u > 0.4 && u < 0.84 ? 1 + 0.07 * Math.pow(Math.max(0, Math.sin(u * 70)), 2) * Math.max(0, Math.cos(a - Math.PI / 2) + 0.3) : 1;
      return chest * rib * (1 - 0.12 * Math.abs(Math.cos(a)));
    });
    torso.scale(0.85, 1.15, 1);
    paint(torso, (_q, n, c) => void c.setHex(0x6a5c6e).lerp(new THREE.Color(0x3a2c3e), Math.max(0, n.y) * 0.6).lerp(new THREE.Color(0xb48a96), Math.max(0, -n.y) * 0.6));
    this.body.add(new THREE.Mesh(torso, skin));
    for (let k = 0; k < 11; k++) {
      const u = 0.08 + k * 0.08;
      const c = torsoCurve.getPointAt(u);
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.1 + Math.sin(u * Math.PI) * 0.1, 6), toothMat);
      sp.position.set(c.x, c.y + 0.31 * (0.6 + 0.5 * Math.sin(u * Math.PI)), c.z);
      sp.rotation.x = -0.6;
      this.body.add(sp);
    }
    this.neck.position.set(0, 0.14, 0.55);
    this.body.add(this.neck);
    const neckCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.02, -0.12), new THREE.Vector3(0, 0.04, 0.15), new THREE.Vector3(0, -0.02, 0.34)]);
    const neckG = profiledTube(neckCurve, 18, 18, (u) => 0.17 - 0.03 * u);
    paint(neckG, (_q, n, c) => void c.setHex(0x64566a).lerp(new THREE.Color(0xa47a88), Math.max(0, -n.y) * 0.5));
    this.neck.add(new THREE.Mesh(neckG, skin));
    const mo = mouth(0.21, 0.27, skin, { teeth: 22 });
    mo.group.position.set(0, -0.02, 0.43);
    this.neck.add(mo.group);
    this.jaw = mo.flare;
    const leg = (x: number, z: number, front: boolean): void => {
      const l = houndLeg(skin, front);
      l.hip.position.set(x, -0.04, z);
      this.body.add(l.hip);
      this.legs.push({ ...l, front, side: Math.sign(x) });
    };
    leg(-0.15, 0.38, true);
    leg(0.15, 0.38, true);
    leg(-0.14, -0.52, false);
    leg(0.14, -0.52, false);
    let parent: THREE.Object3D = this.body;
    let z = -0.66;
    for (let k = 0; k < 7; k++) {
      const s = new THREE.Group();
      s.position.set(0, k === 0 ? 0.06 : 0, z);
      parent.add(s);
      const r = 0.05 * (1 - k * 0.12);
      const seg = new THREE.CapsuleGeometry(r, 0.1, 4, 10);
      seg.rotateX(Math.PI / 2);
      seg.translate(0, 0, -0.06);
      paint(seg, solid(0x5a4c5e));
      s.add(new THREE.Mesh(seg, skin));
      this.tail.push(s);
      parent = s;
      z = -0.12;
    }
    const hm = new THREE.MeshBasicMaterial({ visible: false });
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.3), hm);
    hb.position.set(0, 0.72, 0);
    const hh = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.45), hm);
    hh.position.set(0, 0.82, 0.98);
    hb.userData.hound = this;
    hh.userData.hound = this;
    hh.userData.head = true;
    g.add(hb, hh);
    this.hitboxes.push(hb, hh);
    g.traverse((o) => (o.castShadow = false));
  }

  mouthWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.jaw.getWorldPosition(out);
  }

  animate(dt: number, t: number): void {
    const run = Math.min(1, this.speed / 7);
    this.ph += dt * (4 + this.speed * 1.8);
    const ph = this.ph;
    for (const l of this.legs) {
      const off = (l.front ? 0 : Math.PI) + (l.side > 0 ? 0.35 : 0);
      const s = Math.sin(ph + off);
      const c = Math.cos(ph + off);
      if (this.alive) {
        l.hip.rotation.x = s * (0.15 + 0.75 * run) + (l.front ? 0 : 0.25);
        l.knee.rotation.x = l.front ? -Math.max(0, c) * (0.3 + 0.9 * run) - 0.1 : 0.4 + Math.max(0, -c) * (0.4 + 0.6 * run);
        l.paw.rotation.x = -l.hip.rotation.x - l.knee.rotation.x;
      } else {
        const k = smooth(this.deadT / 0.6);
        l.hip.rotation.x += ((l.front ? 0.9 : -0.5) - l.hip.rotation.x) * k * 0.2;
        l.knee.rotation.x += ((l.front ? -1.4 : 1.6) - l.knee.rotation.x) * k * 0.2;
      }
    }
    if (this.alive) {
      this.body.rotation.x = Math.sin(ph * 2) * 0.06 * run;
      this.body.position.y = 0.72 + Math.abs(Math.sin(ph)) * 0.08 * run;
      this.neck.rotation.x = 0.15 * run + Math.sin(ph * 2 + 1) * 0.05 + (this.state === 'lunge' ? -0.25 : 0);
    }
    this.tail.forEach((s, i) => {
      s.rotation.y = Math.sin(t * 6 + i * 0.8) * (this.alive ? 0.25 : 0.05);
      s.rotation.x = 0.12 + (this.alive ? -0.1 * run : 0.15);
    });
    const gape = this.state === 'lunge' ? 1.35 : this.alive ? 1 + Math.sin(t * 9 + ph) * 0.08 : 0.85;
    this.jaw.scale.set(gape, gape, 1);
    if (this.held) {
      // Kicking in the air, twisting
      for (const l of this.legs) {
        l.hip.rotation.x = Math.sin(t * 22 + (l.front ? 0 : 2) + l.side) * 0.9;
        l.knee.rotation.x = 0.6 + Math.sin(t * 19 + l.side) * 0.5;
      }
      this.body.rotation.z = Math.sin(t * 7) * 0.6;
      this.jaw.scale.set(1.4, 1.4, 1);
    }
    if (!this.alive) {
      if (this.melted) {
        // Slumps and sinks into the acid, shrinking as it goes
        const k = smooth(this.deadT / 2.2);
        this.body.rotation.z = smooth(this.deadT / 0.4) * 0.5;
        this.body.position.y = 0.72 - k * 0.9;
        this.body.scale.set(1 + k * 0.25, 1 - k * 0.7, 1 - k * 0.2);
        if (this.deadT > 2.4) this.group.visible = false;
      } else {
        const k = smooth(this.deadT / 0.5);
        this.body.rotation.z = k * 1.45;
        this.body.position.y = 0.72 - k * 0.42;
      }
    }
  }
}

// ================================================================ maw trap

let trapSkin: THREE.MeshPhysicalMaterial | null = null;

/**
 * A mouth in the ground. Laid open it's a ring of five fleshy petals flat on
 * the sponge, sponge-coloured on their backs, raw red inside with hooked
 * teeth along each, round a dark throat. Step on it and the petals slam up
 * and shut round his legs; it holds him and chews, then lets him go and
 * lies shut a while before it opens again.
 */
export class MawTrap {
  readonly group = new THREE.Group();
  readonly hitbox: THREE.Mesh;
  private petals: THREE.Group[] = [];
  private throatGlow: THREE.MeshStandardMaterial;
  state: 'open' | 'held' | 'shut' | 'dead' = 'open';
  stateT = 0;
  hp = 3;
  /** 0 open flat .. 1 shut. */
  private close = 0;
  private t = Math.random() * 10;
  static readonly REACH = 0.8;

  constructor() {
    if (!trapSkin) {
      trapSkin = wetFlesh(1.0, { clearcoat: 0.8 });
      trapSkin.side = THREE.DoubleSide;
    }
    const skin = trapSkin;
    const rim = new THREE.TorusGeometry(0.62, 0.11, 12, 40);
    rim.rotateX(Math.PI / 2);
    const rp = rim.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i++) {
      const a = Math.atan2(rp.getZ(i), rp.getX(i));
      const k = 1 + Math.sin(a * 7) * 0.05;
      rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * 0.6, rp.getZ(i) * k);
    }
    rim.computeVertexNormals();
    paint(rim, (q, _n, c) => void c.setHex(0x9a9466).lerp(new THREE.Color(0x7a2034), smooth((0.62 - Math.hypot(q.x, q.z)) / 0.1)));
    this.group.add(new THREE.Mesh(rim, skin));
    this.throatGlow = new THREE.MeshStandardMaterial({ color: 0x1a0204, emissive: 0x8a1018, emissiveIntensity: 0.5, roughness: 0.4, side: THREE.BackSide });
    const throat = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.throatGlow);
    throat.rotation.x = Math.PI;
    throat.scale.set(1, 0.7, 1);
    this.group.add(throat);
    const inner = new THREE.Mesh(teethRing(16, 0.42, 0.14, 0.022, 1.2, 0), toothMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = -0.04;
    this.group.add(inner);
    for (let k = 0; k < 5; k++) {
      const hinge = new THREE.Group();
      hinge.rotation.y = (k / 5) * Math.PI * 2;
      this.group.add(hinge);
      const flap = new THREE.Group();
      flap.position.set(0, 0.02, 0.58);
      hinge.add(flap);
      // A curved shell up from its hinge (+Y), curling in toward the middle (−Z)
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        pts.push(new THREE.Vector2(Math.sin(u * Math.PI) * 0.34 + 0.02, u * 0.62));
      }
      const shell = new THREE.LatheGeometry(pts, 14, -0.62, 1.24);
      const sp = shell.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < sp.count; i++) {
        const y = sp.getY(i);
        sp.setZ(i, sp.getZ(i) * 0.35 - (y / 0.62) * (y / 0.62) * 0.3);
      }
      shell.computeVertexNormals();
      paint(shell, (_q, n, c) => void c.setHex(n.z > 0 ? 0x9a9466 : 0xa02a3c));
      flap.add(new THREE.Mesh(shell, skin));
      for (let j = 0; j < 6; j++) {
        const u = 0.2 + j * 0.13;
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.09, 6), toothMat);
        tooth.position.set((j % 2 ? 1 : -1) * Math.sin(u * Math.PI) * 0.3, u * 0.62, -0.06 - u * u * 0.28);
        tooth.rotation.x = -Math.PI / 2;
        flap.add(tooth);
      }
      this.petals.push(flap);
    }
    this.hitbox = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.7, 12), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = 0.3;
    this.hitbox.userData.trap = this;
    this.group.add(this.hitbox);
    this.pose();
  }

  private pose(): void {
    const c = this.close;
    const breathe = this.state === 'open' ? Math.sin(this.t * 1.4) * 0.04 : 0;
    this.petals.forEach((f, k) => {
      // Open: laid out flat on the ground, pointing away from the middle, red insides up; shut: up and over it
      f.rotation.x = 1.45 - breathe - c * 1.95 + Math.sin(this.t * 3 + k) * 0.02;
    });
  }

  update(dt: number): void {
    this.t += dt;
    this.stateT += dt;
    let want = 0;
    if (this.state === 'held') want = 1 - 0.06 * Math.abs(Math.sin(this.t * 7));
    else if (this.state === 'shut') want = 0.92;
    else if (this.state === 'dead') want = 0.4;
    const rate = this.state === 'held' && this.stateT < 0.2 ? 18 : 3;
    this.close += (want - this.close) * Math.min(1, dt * rate);
    this.throatGlow.emissiveIntensity = this.state === 'dead' ? 0 : 0.4 + 0.3 * Math.sin(this.t * 2);
    this.pose();
  }

  snap(): void {
    this.state = 'held';
    this.stateT = 0;
  }
}

// ================================================================ the big one

interface SpiderLeg {
  hip: THREE.Vector3;
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

export interface BossArm {
  pivot: THREE.Group;
  /** The limb, shoulder to wrist (stays on the body). */
  limb: THREE.Group;
  /** The cannon-head on the end of it (comes off). */
  head: CannonParts;
  wrist: THREE.Group;
}

/**
 * The big one: a great grub on spider legs, the size of a car. Its back is
 * armoured in overlapping grey shell plates; down its sides and underneath
 * it's wet pink flesh, shiny, veined, and the colour runs from one to the
 * other with no seam. At the front a fanged mouth with fat lips and ropes of
 * drool; either side of it a muscular arm grows out of a swollen shoulder,
 * ending in a cannon-head. Six legs of glossy black chitin, each rising out
 * of a fleshy collar.
 */
export class SpiderBoss {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  readonly arms: BossArm[] = [];
  readonly hitMeshes: THREE.Object3D[] = [];
  readonly mouthCore: THREE.Mesh;
  private legs: SpiderLeg[] = [];
  private mouthFlare: THREE.Group;
  private sacs: THREE.MeshStandardMaterial;
  readonly maxHp = 120;
  hp = 120;
  alive = true;
  deadT = 0;
  yaw = 0;
  private yawPrev = 0;
  private yawRate = 0;
  readonly at = new THREE.Vector3();
  private t = 0;
  readonly kick = [0, 0];
  static readonly RIDE = 2.7;
  static readonly A = 2.4;
  static readonly B = 3.1;
  severed = -1;

  constructor(private ground: (x: number, z: number) => number) {
    const flesh = wetFlesh(3);
    const L = 3.8;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 64; i++) {
      const u = i / 64;
      const y = -L / 2 + u * L;
      let r = 1.2 * Math.pow(Math.sin(Math.PI * Math.min(0.985, 0.03 + u * 0.95)), 0.55) * (1 - 0.22 * u);
      r *= 1 + 0.04 * Math.pow(Math.max(0, Math.sin(u * 44)), 2);
      if (u > 0.93) r = Math.max(r, 0.66);
      pts.push(new THREE.Vector2(Math.max(0.02, r), y));
    }
    const hullG = new THREE.LatheGeometry(pts, 64);
    hullG.rotateX(Math.PI / 2);
    hullG.scale(1.05, 0.88, 1);
    {
      const p = hullG.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const k = 1 + noise3(x * 2.2, y * 2.2, z * 1.6) * 0.035;
        p.setXYZ(i, x * k, y * k, z);
      }
      hullG.computeVertexNormals();
    }
    const shell = new THREE.Color(0x7c7c84);
    const shellDark = new THREE.Color(0x3a3a44);
    const pink = new THREE.Color(0xd07888);
    const red = new THREE.Color(0x8a2236);
    paint(hullG, (q, n, c) => {
      const top = smooth((n.y + 0.05) / 0.5);
      const band = Math.pow(Math.max(0, Math.sin((q.z / L + 0.5) * 44)), 4);
      c.copy(pink).lerp(shell, top).lerp(shellDark, band * 0.5 * top);
      c.lerp(red, smooth((q.z - L * 0.2) / (L * 0.3)) * (1 - top) * 0.7);
    });
    const hull = new THREE.Mesh(hullG, flesh);
    this.body.add(hull);
    this.hitMeshes.push(hull);
    // ---- Shell plates over the back: overlapping curved scutes, each with a darker rim and a keel
    const plateMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12, side: THREE.DoubleSide });
    for (let k = 0; k < 8; k++) {
      const z = -1.55 + k * 0.4;
      const u = (z + L / 2) / L;
      const r = 1.2 * Math.pow(Math.sin(Math.PI * Math.min(0.985, 0.03 + u * 0.95)), 0.55) * (1 - 0.22 * u);
      // An arch over the top: a band of a cylinder round the body's axis, the upper part only
      const arc = new THREE.CylinderGeometry(r * 1.1, r * 1.08, 0.46, 40, 3, true, -Math.PI * 0.42, Math.PI * 0.84);
      arc.rotateX(Math.PI / 2);
      arc.rotateZ(Math.PI / 2);
      const p = arc.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const ang = Math.atan2(x, y);
        // A keel along the spine; the trailing edge lifted to overlap the next
        p.setY(i, y * 0.9 + Math.max(0, 0.07 - Math.abs(ang) * 0.12));
        p.setZ(i, p.getZ(i) + (p.getZ(i) < 0 ? 0.04 : 0) - Math.abs(ang) * 0.04);
      }
      arc.computeVertexNormals();
      paint(arc, (q, _n, c) => {
        const edge = smooth((Math.abs(q.z) - 0.14) / 0.08);
        c.setHex(0x8a8a94).lerp(new THREE.Color(0x24242c), edge * 0.85);
      });
      const pm = new THREE.Mesh(arc, plateMat);
      pm.position.set(0, 0.02, z);
      pm.rotation.x = -0.1;
      this.body.add(pm);
    }
    // ---- Sacs on the flanks: swollen, glowing through the skin
    this.sacs = new THREE.MeshStandardMaterial({ color: 0xffa060, emissive: 0xff6a20, emissiveIntensity: 0.9, roughness: 0.2, transparent: true, opacity: 0.85 });
    for (const s of [-1, 1])
      for (let k = 0; k < 3; k++) {
        const sac = new THREE.Mesh(new THREE.SphereGeometry(0.16 - k * 0.025, 18, 14), this.sacs);
        sac.position.set(s * 1.0, -0.15 - k * 0.05, -0.8 + k * 0.45);
        sac.scale.set(0.7, 1, 1.1);
        this.body.add(sac);
      }
    // ---- The mouth: fat lips round a fanged pit, ropes of drool
    const mo = mouth(0.7, 0.9, flesh, { teeth: 26, glow: 0xff5a3a, lip: 0x7a1a2c, inner: 0xd87080 });
    mo.group.position.set(0, -0.05, L / 2 - 0.02);
    this.body.add(mo.group);
    this.mouthFlare = mo.flare;
    this.mouthCore = mo.core!;
    const lipG = new THREE.TorusGeometry(0.8, 0.13, 16, 48);
    const lp = lipG.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) {
      const a = Math.atan2(lp.getY(i), lp.getX(i));
      const k = 1 + Math.sin(a * 4) * 0.06;
      lp.setXY(i, lp.getX(i) * k, lp.getY(i) * k);
    }
    lipG.computeVertexNormals();
    paint(lipG, (_q, n, c) => void c.setHex(0x9a3046).lerp(new THREE.Color(0x5a1020), Math.max(0, n.z) * 0.5));
    const lips = new THREE.Mesh(lipG, flesh);
    lips.position.set(0, -0.05, L / 2 - 0.05);
    this.body.add(lips);
    const droolMat = new THREE.MeshPhysicalMaterial({ color: 0xc8e0c0, roughness: 0.05, transparent: true, opacity: 0.6, clearcoat: 1 });
    for (let k = 0; k < 5; k++) {
      const a = Math.PI * 1.15 + k * 0.18;
      const len = 0.35 + hash(k, 2) * 0.5;
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.004, len, 6), droolMat);
      d.position.set(Math.cos(a) * 0.72, Math.sin(a) * 0.72 - 0.05 - len / 2, L / 2 + 0.05);
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), droolMat);
      bead.position.y = -len / 2;
      d.add(bead);
      this.body.add(d);
    }
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.75, 10), toothMat);
      f.position.set(s * 0.48, -0.5, L / 2 + 0.2);
      f.rotation.set(Math.PI + 0.45, 0, s * 0.25);
      this.body.add(f);
    }
    const eyeM = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, clearcoat: 1 });
    for (let k = 0; k < 8; k++) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.05 + (k % 3) * 0.02, 12, 10), eyeM);
      e.position.set((k - 3.5) * 0.12, 0.62 - Math.abs(k - 3.5) * 0.04, L / 2 - 0.42 - Math.abs(k - 3.5) * 0.03);
      this.body.add(e);
    }
    const mhit = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    mhit.position.copy(mo.group.position);
    mhit.userData.head = true;
    this.body.add(mhit);
    this.hitMeshes.push(mhit);
    // ---- The arms, out of swollen shoulders either side of the mouth
    for (const s of [-1, 1]) {
      const sh = new THREE.SphereGeometry(0.42, 28, 20);
      sh.scale(1, 0.9, 1.15);
      const shp = sh.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < shp.count; i++) {
        const k = 1 + noise3(shp.getX(i) * 6, shp.getY(i) * 6, shp.getZ(i) * 6) * 0.06;
        shp.setXYZ(i, shp.getX(i) * k, shp.getY(i) * k, shp.getZ(i) * k);
      }
      sh.computeVertexNormals();
      paint(sh, (q, n, c) => void c.copy(pink).lerp(shell, smooth((n.y - 0.2) / 0.6) * 0.6).lerp(red, smooth((q.x * s + 0.1) / 0.4) * 0.5));
      const shM = new THREE.Mesh(sh, flesh);
      shM.position.set(s * 0.78, -0.12, L / 2 - 0.85);
      this.body.add(shM);
      this.hitMeshes.push(shM);
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.98, -0.15, L / 2 - 0.7);
      pivot.rotation.order = 'YXZ';
      this.body.add(pivot);
      const limb = new THREE.Group();
      pivot.add(limb);
      const AL = 2.0;
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -0.1), new THREE.Vector3(0.05 * s, 0.12, AL * 0.35), new THREE.Vector3(-0.03 * s, 0.04, AL * 0.7), new THREE.Vector3(0, 0, AL)]);
      const rArm = (u: number): number => 0.27 - 0.19 * u + 0.06 * Math.sin(Math.min(1, u / 0.45) * Math.PI) + 0.04 * Math.sin(Math.max(0, (u - 0.5) / 0.4) * Math.PI);
      const arm = profiledTube(curve, 80, 24, (u, a) => rArm(u) * (1 + 0.08 * Math.sin(a * 3 + u * 6)) * (1 + 0.04 * Math.pow(Math.max(0, Math.sin(u * 40)), 3)));
      paint(arm, (q, n, c) => void c.copy(pink).lerp(red, smooth(q.z / AL) * 0.8).lerp(new THREE.Color(0xe8a0aa), Math.max(0, -n.y) * 0.3));
      const armM = new THREE.Mesh(arm, flesh);
      limb.add(armM);
      this.hitMeshes.push(armM);
      for (let k = 0; k < 3; k++) {
        const vp: THREE.Vector3[] = [];
        for (let i = 0; i <= 14; i++) {
          const u = 0.05 + (i / 14) * 0.9;
          const c = curve.getPointAt(u);
          const a = k * 2.1 + Math.sin(u * 7 + k) * 0.5;
          const r = rArm(u);
          vp.push(new THREE.Vector3(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, c.z));
        }
        limb.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(vp), 50, 0.016, 6), veinGlow));
      }
      const wrist = new THREE.Group();
      wrist.position.set(0, 0, AL - 0.05);
      limb.add(wrist);
      const head = alienCannon(s < 0 ? 'acid' : 'grabber');
      // Its size in the world is what goes on his forearm: the body's scale undone
      head.root.scale.setScalar(1 / 1.3);
      for (const t of head.tendrils) t.scale.setScalar(0.4);
      wrist.add(head.root);
      head.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) this.hitMeshes.push(o);
      });
      this.arms.push({ pivot, limb, head, wrist });
    }
    // ---- Legs: glossy chitin, each out of a fleshy collar
    const chitin = new THREE.MeshPhysicalMaterial({ color: 0x1e1a20, roughness: 0.22, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 });
    const A = SpiderBoss.A;
    const B = SpiderBoss.B;
    // Unit length along +Y (scaled to the real length when laid), widths in metres over the length they're scaled by
    const thighG = profiledTube(
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.015, 0.5, 0), new THREE.Vector3(0, 1, 0)]),
      30,
      14,
      (u, a) => ((0.24 - 0.08 * u + 0.07 * Math.sin(u * Math.PI)) * (1 + 0.1 * Math.cos(a * 2)) * (1 + 0.06 * Math.pow(Math.max(0, Math.sin(u * 26)), 4))) / A
    );
    const shinG = profiledTube(
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.016, 0.5, 0), new THREE.Vector3(0.02, 0.92, 0), new THREE.Vector3(0.05, 1, 0)]),
      34,
      12,
      (u) => (0.17 * (1 - u * 0.86) * (1 + 0.18 * Math.sin(u * Math.PI)) + 0.008) / B
    );
    const kneeG = new THREE.SphereGeometry(0.26, 18, 14);
    const collarG = new THREE.TorusGeometry(0.24, 0.11, 12, 24);
    paint(collarG, solid(0xb05a6a));
    for (const [i, z] of [0.8, 0.0, -0.85].entries()) {
      for (const s of [-1, 1]) {
        const hip = new THREE.Vector3(s * 0.85, -0.35, z);
        const home = new THREE.Vector3(s * 3.3, 0, z * 2.0 + (i === 0 ? 0.8 : i === 2 ? -0.6 : 0));
        const thigh = new THREE.Mesh(thighG, chitin);
        const shin = new THREE.Mesh(shinG, chitin);
        const knee = new THREE.Mesh(kneeG, chitin);
        this.group.add(thigh, shin, knee);
        this.hitMeshes.push(thigh);
        const collar = new THREE.Mesh(collarG, flesh);
        collar.position.copy(hip);
        collar.rotation.set(0, 0, s * 0.9);
        this.body.add(collar);
        this.legs.push({ hip, home, foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), stepT: -1, group: ((i + (s > 0 ? 1 : 0)) % 2) as 0 | 1, thigh, shin, knee });
      }
    }
    this.body.scale.setScalar(1.3);
    this.group.add(this.body);
    for (const o of this.hitMeshes) o.userData.boss = this;
    this.group.traverse((o) => (o.castShadow = false));
  }

  place(x: number, z: number, yaw: number): void {
    this.at.set(x, this.ground(x, z), z);
    this.yaw = yaw;
    this.yawPrev = yaw;
    this.layBody(0);
    for (const l of this.legs) {
      this.homeWorld(l, l.foot, new THREE.Vector3(), 0);
      l.stepT = -1;
    }
    this.layLegs();
  }

  /** Where a foot wants to be: its home round the body, ahead along its motion, ahead round its turn. */
  private homeWorld(l: SpiderLeg, out: THREE.Vector3, lead: THREE.Vector3, turnLead: number): THREE.Vector3 {
    const y = this.yaw + turnLead;
    const c = Math.cos(y);
    const s = Math.sin(y);
    const x = this.at.x + l.home.x * c + l.home.z * s + lead.x;
    const z = this.at.z - l.home.x * s + l.home.z * c + lead.z;
    return out.set(x, this.ground(x, z), z);
  }

  private layBody(dt: number): void {
    this.t += dt;
    this.body.position.set(this.at.x, this.at.y + SpiderBoss.RIDE + Math.sin(this.t * 2.2) * 0.06, this.at.z);
    this.body.rotation.set(-0.1 + Math.sin(this.t * 1.7) * 0.03, this.yaw, Math.sin(this.t * 1.3) * 0.03 - this.yawRate * 0.06);
  }

  update(dt: number, vel: THREE.Vector3, aims: (THREE.Vector3 | null)[]): void {
    this.sacs.emissiveIntensity = this.alive ? 0.7 + 0.4 * Math.sin(this.t * 3) : Math.max(0, 0.9 - this.deadT);
    if (!this.alive) {
      this.deadT += dt;
      this.t += dt;
      const k = smooth(this.deadT / 1.2);
      this.body.position.y += (this.at.y + 1.2 - this.body.position.y) * Math.min(1, dt * 3 * (0.3 + k));
      this.body.rotation.z += (0.22 - this.body.rotation.z) * Math.min(1, dt * 2);
      this.body.rotation.x += (0.08 - this.body.rotation.x) * Math.min(1, dt * 2);
      for (const l of this.legs) {
        const out = new THREE.Vector3().subVectors(l.foot, this.at).setY(0).normalize();
        if (k < 1) l.foot.addScaledVector(out, dt * 0.8 * (1 - k));
        l.foot.y = this.ground(l.foot.x, l.foot.z);
      }
      // Arms down on the ground in front of it, the cannon-heads lying where he can get at them
      this.arms.forEach((a) => {
        a.pivot.rotation.x += (0.75 - a.pivot.rotation.x) * Math.min(1, dt * 2);
        a.pivot.rotation.y += (0 - a.pivot.rotation.y) * Math.min(1, dt * 2);
        a.limb.position.z = 0;
      });
      const fade = Math.max(0, 1 - this.deadT / 2);
      this.arms.forEach((a, i) => {
        if (i === this.severed) return;
        (a.head.glow.material as THREE.SpriteMaterial).opacity = 0.6 * fade;
        a.head.core.scale.setScalar(0.3 + 0.7 * fade);
      });
      this.mouthCore.scale.setScalar(0.2 + 0.8 * fade);
      this.layLegs();
      // The arms come to rest on the ground, not through it: the cannon-heads lying where he can see them
      const w = new THREE.Vector3();
      this.arms.forEach((a) => {
        a.wrist.getWorldPosition(w);
        const g = this.ground(w.x, w.z);
        if (w.y < g + 0.4) a.pivot.rotation.x -= Math.min(0.05, (g + 0.4 - w.y) * 0.3);
        this.body.updateMatrixWorld(true);
      });
      return;
    }
    // How fast it's turning: the feet reach round ahead of the turn, and step sooner while it does
    let dy = this.yaw - this.yawPrev;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yawPrev = this.yaw;
    this.yawRate += (dy / Math.max(dt, 1e-4) - this.yawRate) * Math.min(1, dt * 8);
    this.layBody(dt);
    const lead = vel.clone().multiplyScalar(0.45);
    const turnLead = THREE.MathUtils.clamp(this.yawRate * 0.35, -0.5, 0.5);
    const want = new THREE.Vector3();
    const stepping = [0, 0];
    for (const l of this.legs) if (l.stepT >= 0) stepping[l.group]++;
    for (const l of this.legs) {
      if (l.stepT >= 0) {
        l.stepT += dt / 0.24;
        const u = Math.min(1, l.stepT);
        l.foot.lerpVectors(l.from, l.to, smooth(u));
        l.foot.y += Math.sin(u * Math.PI) * 0.75;
        if (u >= 1) l.stepT = -1;
        continue;
      }
      this.homeWorld(l, want, lead, turnLead);
      const other = l.group === 0 ? 1 : 0;
      const far = want.distanceTo(l.foot);
      const limit = Math.abs(this.yawRate) > 0.25 ? 0.5 : 0.9;
      if (far > limit && (stepping[other] === 0 || far > 1.6)) {
        l.from.copy(l.foot);
        l.to.copy(want);
        l.stepT = 0;
        stepping[l.group]++;
      }
    }
    this.layLegs();
    this.arms.forEach((a, i) => {
      const p = a.pivot;
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
      p.rotation.y += (THREE.MathUtils.clamp(ry, -0.9, 0.9) - p.rotation.y) * Math.min(1, dt * 5);
      p.rotation.x += (THREE.MathUtils.clamp(rx, -0.8, 0.9) - p.rotation.x) * Math.min(1, dt * 5);
      a.limb.position.z = -this.kick[i] * 0.25;
      const h = a.head;
      const f = 0.85 + 0.25 * Math.sin(this.t * 13 + i * 3) + (Math.random() - 0.5) * 0.25 + this.kick[i] * 1.5;
      h.core.scale.setScalar(f);
      (h.glow.material as THREE.SpriteMaterial).opacity = 0.4 + 0.25 * f;
      h.flare.scale.setScalar(1 + this.kick[i] * 0.3);
    });
    this.mouthFlare.scale.setScalar(1 + Math.sin(this.t * 3) * 0.06);
  }

  private layLegs(): void {
    this.body.updateMatrixWorld(true);
    const A = SpiderBoss.A;
    const B = SpiderBoss.B;
    const hipW = new THREE.Vector3();
    const kneeW = new THREE.Vector3();
    const d = new THREE.Vector3();
    for (const l of this.legs) {
      hipW.copy(l.hip).applyMatrix4(this.body.matrixWorld);
      d.subVectors(l.foot, hipW);
      const dist = THREE.MathUtils.clamp(d.length(), 0.3, (A + B) * 0.995);
      d.normalize();
      const ang = Math.acos(THREE.MathUtils.clamp((A * A + dist * dist - B * B) / (2 * A * dist), -1, 1));
      const out = new THREE.Vector3(l.foot.x - hipW.x, 0, l.foot.z - hipW.z).normalize();
      const pole = UP.clone().addScaledVector(out, 0.3);
      const n = pole.addScaledVector(d, -pole.dot(d)).normalize();
      kneeW.copy(hipW).addScaledVector(d, Math.cos(ang) * A).addScaledVector(n, Math.sin(ang) * A);
      const seg = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, w: number): void => {
        const v = new THREE.Vector3().subVectors(b, a);
        const len = v.length();
        m.position.copy(a);
        // Its sideways bend kept facing out from the body
        const y = v.normalize();
        const z = new THREE.Vector3().crossVectors(out, y).normalize();
        const x = new THREE.Vector3().crossVectors(y, z);
        m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
        m.scale.set(w, len, w);
      };
      seg(l.thigh, hipW, kneeW, A);
      seg(l.shin, kneeW, l.foot, B);
      l.knee.position.copy(kneeW);
    }
  }

  muzzle(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.arms[i].head.muzzle.getWorldPosition(out);
  }

  /** Arm i's wrist, where the cannon-head joins it, in the world. */
  wrist(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.arms[i].wrist.getWorldPosition(out);
  }

  /** Arm i's cannon-head, off: it stays where it is in the world, no longer the body's. */
  sever(i: number, scene: THREE.Object3D): THREE.Group {
    this.severed = i;
    const h = this.arms[i].head.root;
    scene.attach(h);
    return h;
  }
}
