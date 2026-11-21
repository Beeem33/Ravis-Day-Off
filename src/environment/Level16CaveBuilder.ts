import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Collider } from './OfficeLevelBuilder';
import { makeCanvas } from './Level8Builder';
import { triplanar, fbm, type Level16Data } from './Level16Builder';
import { wetFlesh } from '../entities/AlienCreatures';

/**
 * Level16CaveBuilder — Level 16, part 2: the cave.
 *
 * One long winding passage through the rock, smooth-walled and wet, opening
 * into chambers along the way, ending in a great cavern with the exit portal
 * in it. Water drips from the roof into puddles on the floor; clusters of
 * alien egg-cocoons cling to the walls (he can eat them); glowing fungus and
 * crystals; stalactites; holes in the walls the hounds come out of.
 *
 * The passage follows a curve: its floor height, width and height vary along
 * it. The ground (and the walls, for the player and the hounds and every
 * shot) are worked out from the nearest point on that curve — no boxes, no
 * heightfield to sample.
 *
 * It returns the same shape of data as the canyon's builder (with the parts
 * the cave hasn't got left empty), so the one scene plays both.
 */

// ================================================================ the passage

const PATH: [number, number, number][] = [
  [0, 0, 6],
  [0, 0, -8],
  [-6, -0.4, -22],
  [-4, -1, -38],
  [6, -1.5, -54],
  [10, -2, -68],
  [4, -2.6, -82],
  [-8, -3, -96],
  [-11, -3.2, -110],
  [-3, -3.6, -124],
  [0, -3.8, -142]
];
/** Where it opens out: a chamber's middle (along the curve's z) and how wide. */
const CHAMBERS = [
  { z: -38, w: 9, h: 9 },
  { z: -82, w: 10, h: 10 },
  { z: -142, w: 13, h: 14 }
];
export const CAVE_PORTAL = new THREE.Vector3(0, -3.8, -146);

interface Sample {
  p: THREE.Vector3;
  t: THREE.Vector3;
  w: number;
  h: number;
}

const curve = new THREE.CatmullRomCurve3(PATH.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
const LEN = curve.getLength();
const STEP = 0.5;
const samples: Sample[] = [];
{
  const n = Math.ceil(LEN / STEP);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).setY(0).normalize();
    let w = 3.7 + fbm(i * 0.03, 3) * 0.8;
    let h = 4.4 + fbm(i * 0.025, 9) * 0.8;
    for (const c of CHAMBERS) {
      const k = Math.max(0, 1 - Math.abs(p.z - c.z) / 11);
      const s = k * k * (3 - 2 * k);
      w = Math.max(w, w + (c.w - w) * s);
      h = Math.max(h, h + (c.h - h) * s);
    }
    samples.push({ p, t, w, h });
  }
}
// A grid of the samples by 4 m cell, for finding the nearest quickly
const grid = new Map<string, number[]>();
samples.forEach((s, i) => {
  const k = `${Math.floor(s.p.x / 4)},${Math.floor(s.p.z / 4)}`;
  let a = grid.get(k);
  if (!a) grid.set(k, (a = []));
  a.push(i);
});

/** The nearest point on the passage's middle (horizontally), and how far off it (x, z) is. */
function nearest(x: number, z: number): { s: Sample; d: number; i: number } {
  const cx = Math.floor(x / 4);
  const cz = Math.floor(z / 4);
  let best = -1;
  let bd = Infinity;
  for (let r = 1; r <= 4 && best < 0; r++)
    for (let i = cx - r; i <= cx + r; i++)
      for (let j = cz - r; j <= cz + r; j++)
        for (const k of grid.get(`${i},${j}`) ?? []) {
          const s = samples[k];
          const d = (s.p.x - x) ** 2 + (s.p.z - z) ** 2;
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
  if (best < 0) return { s: samples[0], d: 999, i: 0 };
  return { s: samples[best], d: Math.sqrt(bd), i: best };
}

/** The floor at (x, z); up the wall, somewhere he can't stand. */
export function caveGround(x: number, z: number): number {
  const { s, d } = nearest(x, z);
  const f = s.p.y + fbm(x * 0.35, z * 0.35) * 0.08;
  return d < s.w * 0.7 ? f : f + 12;
}

/** Inside the rock: past the wall at that height, or above the roof. */
export function caveSolid(x: number, y: number, z: number): boolean {
  const { s, d } = nearest(x, z);
  const yy = y - (s.p.y + s.h * 0.45);
  if (yy > s.h * 0.55 - 0.1) return true;
  const half = s.w * Math.pow(Math.sqrt(Math.max(0, 1 - (yy / (s.h * 0.55)) ** 2)), 0.7);
  return d > Math.max(half, s.w * 0.68) - 0.05;
}

/** Which way the rock faces at a point on it: the floor up, a wall in toward the passage's middle, the roof down. */
export function caveNormal(x: number, y: number, z: number): THREE.Vector3 {
  const { s, d } = nearest(x, z);
  const floor = s.p.y + fbm(x * 0.35, z * 0.35) * 0.08;
  if (d < s.w * 0.7 && y < floor + 0.25) return new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3(s.p.x - x, 0, s.p.z - z);
  if (n.lengthSq() < 1e-6) n.set(0, -1, 0);
  else n.normalize();
  // Up toward the roof it leans over: facing down as well as in
  const yy = (y - (s.p.y + s.h * 0.45)) / (s.h * 0.55);
  if (yy > 0) n.multiplyScalar(Math.sqrt(Math.max(0, 1 - yy * yy))).setY(-Math.min(1, yy)).normalize();
  return n;
}

/** Kept inside the walls (`r` his own radius): true if he had to be moved. */
export function caveConfine(p: THREE.Vector3, r: number): boolean {
  const { s, d } = nearest(p.x, p.z);
  const max = s.w * 0.66 - r;
  if (d <= max) return false;
  const k = max / d;
  p.x = s.p.x + (p.x - s.p.x) * k;
  p.z = s.p.z + (p.z - s.p.z) * k;
  return true;
}

// ================================================================ builder

export interface CaveExtras {
  eggs: { mesh: THREE.Group; at: THREE.Vector3; eaten: boolean }[];
  drips: { top: THREE.Vector3; floor: number; t: number; every: number }[];
  packs: { trigger: number; at: { x: number; z: number }[] }[];
}

export class Level16CaveBuilder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private rock!: THREE.MeshStandardMaterial;

  build(): Level16Data & CaveExtras {
    this.rock = triplanar(new THREE.MeshStandardMaterial({ map: wetRock(), bumpMap: wetRock(true), bumpScale: 2.2, color: 0x8a8478, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }), 0.3, 1);
    const mesh = this.buildPassage();
    const eggs = this.buildEggs();
    const drips = this.buildDrips();
    this.buildGlow();
    const holes = this.buildHoles();
    const portal = this.buildPortal();
    const dummyMat = (u: Record<string, { value: unknown }>): THREE.ShaderMaterial => new THREE.ShaderMaterial({ uniforms: u });
    const far = new THREE.Vector3(0, -999, 999);
    const traps: THREE.Vector3[] = [-16, -47, -60, -104, -118].map((z) => {
      const { s } = nearest(0, z);
      const off = (Math.sin(z) * 0.5) * s.w * 0.5;
      const x = s.p.x + s.t.z * off;
      const zz = s.p.z - s.t.x * off;
      return new THREE.Vector3(x, caveGround(x, zz), zz);
    });
    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      glassPanes: [],
      start: { pos: new THREE.Vector3(0, caveGround(0, 2), 2), yaw: 0 },
      door: { slab: new THREE.Object3D(), collider: { box: new THREE.Box3(far, far), disabled: true }, button: far.clone(), buttonMat: new THREE.MeshStandardMaterial(), light: new THREE.PointLight(), open: () => {} },
      tablet: { obj: new THREE.Object3D(), at: far.clone(), beacon: new THREE.MeshStandardMaterial() },
      portal,
      trunks: [],
      water: dummyMat({ uT: { value: 0 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } }),
      bubbleSpots: drips.map((d) => ({ x: d.top.x, z: d.top.z, y: d.floor + 0.02, r: 0.4 })),
      sky: dummyMat({ uT: { value: 0 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector2() } }),
      planets: [],
      terrain: mesh,
      mapCanvas: this.buildMap(),
      mapBounds: { x0: -30, x1: 30, z0: -160, z1: 12 },
      specimens: [],
      station: { update: () => {} },
      chunks: [],
      trapSpots: traps,
      note: { at: far.clone(), obj: new THREE.Object3D(), cologne: far.clone() },
      glowMats: this.glowMats,
      arenaTrees: [],
      caveGate: { box: new THREE.Box3(far.clone(), far.clone()), disabled: true },
      groundFog: dummyMat({ uT: { value: 0 }, uScale: { value: 1 }, uAlpha: { value: 0 } }),
      eggs,
      drips,
      packs: holes
    };
  }

  /**
   * The passage itself: a tube round the curve, its cross-section a tall
   * oval with the bottom cut flat for a floor, the walls pushed in and out by
   * noise so they bulge and fold, a cap at the far end and a glow at the
   * mouth behind him.
   */
  private buildPassage(): THREE.Mesh {
    const R = 36;
    const ringEvery = 2;
    const rings = samples.filter((_, i) => i % ringEvery === 0);
    const pos: number[] = [];
    const idx: number[] = [];
    const v = new THREE.Vector3();
    rings.forEach((s) => {
      const side = new THREE.Vector3(-s.t.z, 0, s.t.x);
      for (let k = 0; k <= R; k++) {
        const th = (k / R) * Math.PI * 2;
        // (squared off toward the bottom: a wide flat floor, the walls rising off it steeply)
        let lx = Math.sign(Math.cos(th)) * Math.pow(Math.abs(Math.cos(th)), 0.7) * s.w;
        let ly = Math.sin(th) * s.h * 0.55 + s.h * 0.45;
        const floor = ly <= 0;
        if (floor) ly = 0;
        v.copy(s.p).addScaledVector(side, lx);
        v.y += ly;
        // Folds and bulges in the walls and roof (less on the floor)
        const n = fbm(v.x * 0.22 + v.y * 0.15, v.z * 0.22 - v.y * 0.1) * 1.3 + fbm(v.x * 0.8, v.z * 0.8 + v.y) * 0.35;
        const out = floor ? 0 : n;
        lx += Math.sign(lx || 1) * out * Math.abs(Math.cos(th));
        v.copy(s.p).addScaledVector(side, lx);
        v.y += floor ? fbm(v.x * 0.35, v.z * 0.35) * 0.08 : ly + out * Math.max(0, Math.sin(th)) * 0.8;
        pos.push(v.x, v.y, v.z);
      }
    });
    for (let r = 0; r < rings.length - 1; r++)
      for (let k = 0; k < R; k++) {
        const a = r * (R + 1) + k;
        const b = a + R + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo = mergeVertices(geo);
    geo.computeVertexNormals();
    // Cut into lengths of a few metres (normals worked out on the whole, so no seams): each is
    // something a shot can hit and blood can be laid on, following the rock's folds (small
    // enough to project a decal onto quickly), and culled when it's behind him
    const ix = geo.getIndex()!.array;
    const P = geo.getAttribute('position') as THREE.BufferAttribute;
    const N = geo.getAttribute('normal') as THREE.BufferAttribute;
    const per = R * 6;
    const SEG = 6;
    const chunks: THREE.Mesh[] = [];
    for (let r0 = 0; r0 < rings.length - 1; r0 += SEG) {
      const r1 = Math.min(rings.length - 1, r0 + SEG);
      const map = new Map<number, number>();
      const cp: number[] = [];
      const cn: number[] = [];
      const ci: number[] = [];
      for (let i = r0 * per; i < r1 * per; i++) {
        const v = ix[i];
        let j = map.get(v);
        if (j === undefined) {
          j = cp.length / 3;
          map.set(v, j);
          cp.push(P.getX(v), P.getY(v), P.getZ(v));
          cn.push(N.getX(v), N.getY(v), N.getZ(v));
        }
        ci.push(j);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
      g.setIndex(ci);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const m = new THREE.Mesh(g, this.rock);
      m.userData.projectDecals = true;
      this.group.add(m);
      this.shootables.push(m);
      chunks.push(m);
    }
    geo.dispose();
    const mesh = chunks[0];
    // The far end shut with rock; the near end the light of outside
    const last = rings[rings.length - 1];
    const cap = new THREE.Mesh(new THREE.CircleGeometry(Math.max(last.w, last.h) * 1.2, 32), this.rock);
    cap.position.copy(last.p).add(new THREE.Vector3(0, last.h * 0.45, 0)).addScaledVector(last.t, 0.5);
    cap.lookAt(cap.position.clone().sub(last.t));
    this.group.add(cap);
    const first = rings[0];
    const sky = new THREE.Mesh(new THREE.CircleGeometry(Math.max(first.w, first.h) * 1.3, 32), new THREE.MeshBasicMaterial({ color: 0x2a1a40, toneMapped: false }));
    sky.position.copy(first.p).add(new THREE.Vector3(0, first.h * 0.45, 0)).addScaledVector(first.t, -0.4);
    sky.lookAt(sky.position.clone().add(first.t));
    this.group.add(sky);
    return mesh;
  }

  /** A point on the wall at sample i, `side` ±1, `up` metres off the floor, pushed `into` the rock. */
  private wallPoint(i: number, side: number, up: number, into = 0): { p: THREE.Vector3; n: THREE.Vector3 } {
    const s = samples[Math.min(samples.length - 1, Math.max(0, i))];
    const sd = new THREE.Vector3(-s.t.z, 0, s.t.x).multiplyScalar(side);
    const yy = up - s.h * 0.45;
    const half = s.w * Math.pow(Math.sqrt(Math.max(0, 1 - (yy / (s.h * 0.55)) ** 2)), 0.7);
    const p = s.p.clone().addScaledVector(sd, Math.max(half, s.w * 0.68) + into);
    p.y += up;
    return { p, n: sd.clone().negate() };
  }

  /**
   * Egg-cocoons in clusters on the walls: each a swollen, veined, glistening
   * sac with a warm glow inside and something curled up in it, stuck to the
   * rock in a mat of membrane. He can eat them (the scene).
   */
  private buildEggs(): CaveExtras['eggs'] {
    const eggs: CaveExtras['eggs'] = [];
    const shell = wetFlesh(2, { clearcoat: 1, rough: 0.2 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x401010, emissive: 0xff7a3a, emissiveIntensity: 1.4, roughness: 0.4 });
    this.glowMats.push(glow);
    const membrane = new THREE.MeshPhysicalMaterial({ color: 0x8a5a6a, roughness: 0.25, clearcoat: 1, transparent: true, opacity: 0.85 });
    const paintEgg = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      const col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const c = new THREE.Color(0xd8a0a8).lerp(new THREE.Color(0x8a3a50), Math.max(0, -y) * 2);
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    };
    const eggGeo = paintEgg(new THREE.SphereGeometry(0.22, 20, 16));
    eggGeo.scale(1, 1.45, 1);
    const spots = [40, 70, 110, 150, 190, 220, 250, 270, 300, 320, 350];
    spots.forEach((si, c) => {
      if (si >= samples.length) return;
      const side = c % 2 ? 1 : -1;
      const base = this.wallPoint(si, side, 0.4 + (c % 3) * 0.5, -0.2);
      const mat = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 10), membrane);
      mat.scale.set(1, 0.7, 0.35);
      mat.position.copy(base.p);
      mat.lookAt(base.p.clone().add(base.n));
      this.group.add(mat);
      const n = 3 + (c % 4);
      for (let k = 0; k < n; k++) {
        const g = new THREE.Group();
        const off = new THREE.Vector3((Math.random() - 0.5) * 1.0, (Math.random() - 0.5) * 0.8, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), base.n);
        g.position.copy(base.p).add(off.applyQuaternion(q)).addScaledVector(base.n, 0.15);
        g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), base.n.clone().add(new THREE.Vector3(0, 0.9, 0)).normalize());
        const egg = new THREE.Mesh(eggGeo, shell);
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), glow);
        core.scale.set(0.8, 1.3, 0.8);
        g.add(egg, core);
        g.scale.setScalar(0.8 + Math.random() * 0.5);
        this.group.add(g);
        eggs.push({ mesh: g, at: g.position.clone(), eaten: false });
      }
    });
    return eggs;
  }

  /** Water dripping from the roof: where it falls from, and a puddle where it lands. */
  private buildDrips(): CaveExtras['drips'] {
    const drips: CaveExtras['drips'] = [];
    const puddleMat = new THREE.MeshStandardMaterial({ color: 0x0a1418, roughness: 0.02, metalness: 0.6, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    for (let i = 10; i < samples.length - 10; i += 9) {
      const s = samples[i];
      const side = new THREE.Vector3(-s.t.z, 0, s.t.x);
      const off = (Math.random() - 0.5) * s.w * 1.1;
      const x = s.p.x + side.x * off;
      const z = s.p.z + side.z * off;
      const floor = caveGround(x, z);
      const top = new THREE.Vector3(x, s.p.y + s.h * 0.9, z);
      drips.push({ top, floor, t: Math.random() * 3, every: 0.8 + Math.random() * 2.5 });
      const pd = new THREE.Mesh(new THREE.CircleGeometry(0.3 + Math.random() * 0.4, 18), puddleMat);
      pd.rotation.x = -Math.PI / 2;
      pd.position.set(x, floor + 0.02, z);
      pd.renderOrder = 2;
      this.group.add(pd);
      // A stalactite over it, the drip coming off its tip
      const st = new THREE.Mesh(new THREE.ConeGeometry(0.12 + Math.random() * 0.15, 0.8 + Math.random() * 1.2, 8, 3), this.rock);
      st.rotation.x = Math.PI;
      st.position.set(x, top.y + 0.6, z);
      this.group.add(st);
    }
    return drips;
  }

  /** Glowing fungus on the walls and floor-edges, crystals in clusters, more stalactites. */
  private buildGlow(): void {
    const fungus = new THREE.MeshStandardMaterial({ color: 0x182030, emissive: 0x40c8ff, emissiveIntensity: 1.2, roughness: 0.5 });
    const crystal = new THREE.MeshStandardMaterial({ color: 0x2a1040, emissive: 0xa050ff, emissiveIntensity: 1.6, roughness: 0.15 });
    this.glowMats.push(fungus, crystal);
    const cap = new THREE.SphereGeometry(0.08, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.5, 1);
    const shard = new THREE.OctahedronGeometry(0.18, 0);
    shard.scale(0.6, 2.4, 0.6);
    const capM = new THREE.InstancedMesh(cap, fungus, 900);
    const shardM = new THREE.InstancedMesh(shard, crystal, 260);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let nc = 0;
    let ns = 0;
    for (let i = 0; i < samples.length; i += 2) {
      for (const side of [-1, 1]) {
        if (Math.random() < 0.55 && nc < 900) {
          const w = this.wallPoint(i, side, Math.random() * 1.2, -0.05);
          for (let k = 0; k < 3 && nc < 900; k++) {
            q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), w.n.clone().add(new THREE.Vector3(0, 1.5, 0)).normalize());
            const s = 0.6 + Math.random() * 1.2;
            m4.compose(w.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.4)), q, new THREE.Vector3(s, s, s));
            capM.setMatrixAt(nc++, m4);
          }
        }
        if (Math.random() < 0.12 && ns < 255) {
          const w = this.wallPoint(i, side, 0.5 + Math.random() * 3, 0.1);
          for (let k = 0; k < 4 && ns < 260; k++) {
            q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 1.4, Math.random() * 6, (Math.random() - 0.5) * 1.4));
            const s = 0.5 + Math.random() * 1.2;
            m4.compose(w.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5)), q, new THREE.Vector3(s, s, s));
            shardM.setMatrixAt(ns++, m4);
          }
        }
      }
    }
    capM.count = nc;
    shardM.count = ns;
    for (const im of [capM, shardM]) {
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      this.group.add(im);
    }
  }

  /**
   * Holes in the walls where the hounds live; for each, the pack that comes
   * out of it (when he gets past `trigger`, going on along z).
   */
  private buildHoles(): CaveExtras['packs'] {
    const out: CaveExtras['packs'] = [];
    const dark = new THREE.MeshBasicMaterial({ color: 0x010102, side: THREE.BackSide });
    for (const [zc, side, trig, n] of [
      [-38, 1, -26, 4],
      [-82, -1, -68, 5],
      [-118, 1, -106, 4]
    ]) {
      const { i } = nearest(0, zc);
      const w = this.wallPoint(i, side, 0.8, 0.2);
      const hole = new THREE.Mesh(new THREE.SphereGeometry(1.3, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), dark);
      hole.position.copy(w.p);
      hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), w.n.clone().negate());
      hole.scale.set(1, 1.3, 1.4);
      this.group.add(hole);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.35, 10, 24), this.rock);
      rim.position.copy(w.p).addScaledVector(w.n, 0.1);
      rim.lookAt(rim.position.clone().add(w.n));
      rim.scale.set(1, 1.3, 1);
      this.group.add(rim);
      const at: { x: number; z: number }[] = [];
      for (let k = 0; k < n; k++) {
        const p = w.p.clone().addScaledVector(w.n, 0.9 + (k % 2) * 0.6);
        const along = new THREE.Vector3(-w.n.z, 0, w.n.x).multiplyScalar((k - (n - 1) / 2) * 0.8);
        p.add(along);
        at.push({ x: p.x, z: p.z });
      }
      out.push({ trigger: trig, at });
    }
    return out;
  }

  /** The exit portal, in the middle of the last cavern: the same ring on its plinth. */
  private buildPortal(): Level16Data['portal'] {
    const y = caveGround(CAVE_PORTAL.x, CAVE_PORTAL.z);
    const g = new THREE.Group();
    g.position.set(CAVE_PORTAL.x, y, CAVE_PORTAL.z);
    this.group.add(g);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.35, metalness: 0.8 });
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 0.5, 40), metal);
    plinth.position.y = 0.25;
    g.add(plinth);
    for (const s of [-1, 1]) {
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.5, 0.7), metal);
      up.position.set(s * 2.9, 2.9, 0);
      g.add(up);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.25, 16, 64), metal);
    ring.position.y = 3.0;
    g.add(ring);
    const disc = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uK: { value: 0.25 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uT; uniform float uK; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
          float a = atan(p.y, p.x); float sw = a + 3.0 / (r + 0.3) - uT * 1.4;
          float v = n(vec2(cos(sw), sin(sw)) * 2.5 + vec2(r * 4.0 - uT, 0.0));
          vec3 c = mix(vec3(0.05, 0.15, 0.3), vec3(0.6, 0.95, 1.0), smoothstep(0.3, 0.9, v));
          c += vec3(0.8, 1.0, 1.0) * pow(1.0 - r, 5.0);
          gl_FragColor = vec4(c * (0.3 + uK), smoothstep(1.0, 0.85, r) * (0.4 + 0.6 * uK));
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const dm = new THREE.Mesh(new THREE.CircleGeometry(2.3, 48), disc);
    dm.position.y = 3.0;
    g.add(dm);
    return { group: g, disc, at: new THREE.Vector3(CAVE_PORTAL.x, y + 0.5, CAVE_PORTAL.z) };
  }

  /** The tracker's map: the passage drawn from above. */
  private buildMap(): HTMLCanvasElement {
    const W = 240;
    const H = Math.round((W * 172) / 60);
    const c = makeCanvas(W, H);
    const g = c.getContext('2d')!;
    g.fillStyle = '#081008';
    g.fillRect(0, 0, W, H);
    const px = (x: number): number => ((x + 30) / 60) * W;
    const pz = (z: number): number => ((z + 160) / 172) * H;
    g.strokeStyle = '#4a7a5a';
    g.lineCap = 'round';
    for (const s of samples) {
      g.lineWidth = (s.w * 2 * W) / 60;
      g.beginPath();
      g.moveTo(px(s.p.x), pz(s.p.z));
      g.lineTo(px(s.p.x + s.t.x * 0.6), pz(s.p.z + s.t.z * 0.6));
      g.stroke();
    }
    return c;
  }
}

/** Wet rock: seamless noise, darker and smoother than the canyon's, glistening (its own bump). */
function wetRock(bump = false): THREE.CanvasTexture {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const P = 8;
  const hash = (x: number, y: number): number => {
    const s = Math.sin(((x % P) + P) % P * 127.1 + (((y % P) + P) % P) * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x: number, y: number, p: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const m = (a: number): number => ((a % p) + p) % p;
    const a = hash(m(xi), m(yi));
    const b = hash(m(xi + 1), m(yi));
    const cc = hash(m(xi), m(yi + 1));
    const d = hash(m(xi + 1), m(yi + 1));
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const u = (i / S) * P;
      const v = (j / S) * P;
      let h = 0;
      let amp = 0.5;
      let f = 1;
      for (let o = 0; o < 5; o++) {
        h += noise(u * f, v * f, P * f) * amp;
        f *= 2;
        amp *= 0.5;
      }
      const k = (j * S + i) * 4;
      const val = bump ? h * 255 : 50 + h * 110;
      img.data[k] = val;
      img.data[k + 1] = bump ? val : val * 0.96;
      img.data[k + 2] = bump ? val : val * 0.9;
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (!bump) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
