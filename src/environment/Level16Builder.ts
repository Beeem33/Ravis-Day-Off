import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Collider } from './OfficeLevelBuilder';
import type { CombatLevel } from '../scenes/CombatScene';
import { makeCanvas } from './Level8Builder';

/**
 * Level16Builder — the far side of the Atom Warper.
 *
 * A long valley running north between mountains, under a black sky with
 * planets in it. The ground is a pale, porous sponge; the water is a
 * glowing green, bubbling; the trees are purple and green.
 *
 *  - South end (z ≈ 135): a small survey station, where he arrives. A button
 *    lifts its door.
 *  - A meadow (18, 92) with a crashed survey drone and its tracker tablet.
 *  - Forest north to a cliff (z ≈ 30) five metres high across the valley:
 *    over it with the pressure shotgun.
 *  - A plateau to a rock massif (z −12 … −44) blocking the valley to the
 *    sky; a green lake at its foot, and a passage under it, underwater, round
 *    turns, up into the lake on the far side.
 *  - The north valley, a clearing where the big one lives, and the exit
 *    portal on a mound at the end (0, −150).
 *
 * The ground's height is a function (groundY), shared with the scene: the
 * player walks on it directly, not on boxes.
 */

// ================================================================ the ground

export const WATER_Y = 4.6;
export const LAKE_BED = WATER_Y - 3.3;
/** The massif's footprint and its passage. */
export const MASSIF = { x0: -40, x1: 40, z0: -44, z1: -12, top: 33 };
export const CEIL_Y = WATER_Y - 0.45;
export const POOL_A = { x0: -10, x1: 10, z0: -12, z1: -1 };
export const POOL_B = { x0: -11, x1: 11, z0: -57, z1: -44 };
export const BUILDING = { x0: -4, x1: 4, z0: 131, z1: 138, h: 3.2 };
export const MEADOW = new THREE.Vector3(18, 0, 92);
export const ARENA = new THREE.Vector3(0, 0, -105);
export const PORTAL = new THREE.Vector3(0, 0, -150);
export const CLIFF_Z = 30;
/** The passage under the massif, as a polyline (x, z) and its half-width. */
const PATH: [number, number][] = [[0, -10.5], [0, -19], [9, -19], [9, -28], [-8, -28], [-8, -37], [0, -37], [0, -45.5]];
const PATH_HALF = 1.6;

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export function fbm(x: number, y: number, oct = 4): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += noise(x * f, y * f) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return s;
}
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The valley's half-width at z (mountains beyond it), and where its middle is. */
function valley(z: number): { hw: number; cx: number } {
  // Narrow where the massif plugs it, wide in the forests
  const narrow = 1 - smoothstep(-70, -56, z) * (1 - smoothstep(-2, 8, z));
  const hw = 52 - 24 * (1 - narrow);
  const cx = Math.sin(z * 0.012) * 8 * narrow;
  return { hw, cx };
}

/** Distance from (x, z) to the passage's polyline. */
function pathDist(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i];
    const [bx, bz] = PATH[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** In the passage under the massif (its footprint). */
export function inPassage(x: number, z: number): boolean {
  return z < MASSIF.z1 + 0.6 && z > MASSIF.z0 - 0.6 && pathDist(x, z) < PATH_HALF;
}

/** In the lake (either pool or the passage between them), anywhere below its surface. */
export function inLake(x: number, z: number): boolean {
  const inA = x > POOL_A.x0 && x < POOL_A.x1 && z > POOL_A.z0 - 0.5 && z < POOL_A.z1;
  const inB = x > POOL_B.x0 && x < POOL_B.x1 && z > POOL_B.z0 && z < POOL_B.z1 + 0.5;
  return inA || inB || inPassage(x, z);
}

/** Decorative ponds: shallow, glowing, bubbling. */
export const PONDS: { x: number; z: number; r: number }[] = [
  { x: -30, z: 62, r: 7 },
  { x: 34, z: 44, r: 5.5 },
  { x: -18, z: 110, r: 4.5 },
  { x: 26, z: -82, r: 6.5 },
  { x: -27, z: -126, r: 8 }
];

/** Ground height before the ponds are let in. */
function baseY(x: number, z: number): number {
  let h = fbm(x * 0.018, z * 0.018) * 2.6 + fbm(x * 0.07 + 30, z * 0.07) * 0.55;
  // North of the cliff, five metres up
  h += 5 * smoothstep(CLIFF_Z + 0.6, CLIFF_Z - 0.6, z + fbm(x * 0.08, 3) * 1.2);
  // Mountains either side, and at both ends
  const { hw, cx } = valley(z);
  const d = Math.abs(x - cx) - hw;
  if (d > 0) h += Math.min(70, d * d * 0.22 + d * 3) * (0.85 + 0.3 * fbm(x * 0.05, z * 0.05));
  const ends = Math.max(0, z - 150) + Math.max(0, -172 - z);
  if (ends > 0) h += Math.min(70, ends * ends * 0.25 + ends * 3);
  // Flattened: the station's pad, the meadow, the arena; the portal's mound
  const flat = (cx2: number, cz: number, r: number, y: number): void => {
    const k = 1 - smoothstep(r * 0.6, r, Math.hypot(x - cx2, z - cz));
    h = h + (y - h) * k;
  };
  flat(0, 134.5, 12, 0.6);
  flat(MEADOW.x, MEADOW.z, 20, 0.4);
  flat(ARENA.x, ARENA.z, 30, 5.3);
  const pm = Math.hypot(x - PORTAL.x, z - PORTAL.z);
  h += 1.6 * (1 - smoothstep(4, 14, pm));
  return h;
}

/** The ground's height at (x, z). */
export function groundY(x: number, z: number): number {
  let h = baseY(x, z);
  // The lake: two basins and the bed under the massif between them
  const lakeEdge = (x0: number, x1: number, z0: number, z1: number, ramp: number): number => {
    const dx = Math.max(x0 - x, 0, x - x1);
    const dz = Math.max(z0 - z, 0, z - z1);
    return 1 - smoothstep(0, ramp, Math.hypot(dx, dz));
  };
  // A bank round the lake, above the water, so the water stops where the pools do
  const rectD = (x0: number, x1: number, z0: number, z1: number): number => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
  const dPool = Math.min(rectD(POOL_A.x0, POOL_A.x1, POOL_A.z0 - 2, POOL_A.z1), rectD(POOL_B.x0, POOL_B.x1, POOL_B.z0, POOL_B.z1 + 2));
  if (dPool < 11) {
    const s = smoothstep(7, 11, dPool);
    h = Math.max(h, (WATER_Y + 0.45) * (1 - s) + h * s);
  }
  const k = Math.max(lakeEdge(POOL_A.x0, POOL_A.x1, POOL_A.z0 - 2, POOL_A.z1, 4), lakeEdge(POOL_B.x0, POOL_B.x1, POOL_B.z0, POOL_B.z1 + 2, 4.5));
  const under = z < MASSIF.z1 && z > MASSIF.z0 && Math.abs(x) < 30 ? 1 : 0;
  const kk = Math.max(k, under);
  h = h + (LAKE_BED + fbm(x * 0.2, z * 0.2) * 0.25 - h) * kk;
  // Ponds: the ground levelled round each, and a shallow bowl in the middle
  for (const p of PONDS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.r + 4) continue;
    const flatY = pondBase(p);
    h += (flatY - h) * (1 - smoothstep(p.r + 1, p.r + 4, d));
    h -= 1.1 * (1 - smoothstep(p.r * 0.5, p.r + 0.8, d));
  }
  return h;
}

const pondY = new Map<object, number>();
function pondBase(p: { x: number; z: number; r: number }): number {
  let y = pondY.get(p);
  if (y === undefined) pondY.set(p, (y = baseY(p.x, p.z)));
  return y;
}

/** The water level of a pond (what it was filled to). */
export function pondLevel(p: { x: number; z: number; r: number }): number {
  return pondBase(p) - 0.3;
}

// ================================================================ textures

/** The sponge: pale olive-grey, pitted all over with holes of every size. */
function spongeTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  g.fillStyle = '#cfc896';
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 2200; k++) {
    const v = 160 + Math.random() * 70;
    g.fillStyle = `rgba(${v},${v * 0.98},${v * 0.7},${0.2 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * S, Math.random() * S, 3 + Math.random() * 6, 3 + Math.random() * 6);
  }
  // Pits: dark holes with a lit lip on one side
  for (let k = 0; k < 1700; k++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 1.2 + Math.pow(Math.random(), 3) * 9;
    const ry = r * (0.6 + Math.random() * 0.4);
    g.fillStyle = 'rgba(240,235,195,0.4)';
    g.beginPath();
    g.ellipse(x - r * 0.15, y - r * 0.15, r * 1.12, ry * 1.12, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgba(${70 + Math.random() * 30},${68 + Math.random() * 25},${36},${0.6})`;
    g.beginPath();
    g.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A height-map for the pits, so they read as holes in the light. */
function spongeBump(): THREE.CanvasTexture {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  g.fillStyle = '#b0b0b0';
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 600; k++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 1 + Math.pow(Math.random(), 2.5) * 7;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, '#202020');
    gr.addColorStop(1, 'rgba(176,176,176,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function rockTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  g.fillStyle = '#6e6a5e';
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 3000; k++) {
    const v = 70 + Math.random() * 80;
    g.fillStyle = `rgba(${v},${v * 0.95},${v * 0.82},0.35)`;
    g.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 5, 1 + Math.random() * 3);
  }
  for (let k = 0; k < 40; k++) {
    g.strokeStyle = 'rgba(30,28,22,0.5)';
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    let x = Math.random() * S;
    let y = Math.random() * S;
    g.moveTo(x, y);
    for (let s = 0; s < 6; s++) g.lineTo((x += (Math.random() - 0.5) * 40), (y += Math.random() * 25));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ================================================================ data

export interface TreeTrunk {
  x: number;
  z: number;
  r: number;
  /** How high it stands off the ground. */
  h: number;
}

export interface Level16Data extends CombatLevel {
  start: { pos: THREE.Vector3; yaw: number };
  door: { slab: THREE.Object3D; collider: Collider; button: THREE.Vector3; buttonMat: THREE.MeshStandardMaterial; light: THREE.PointLight };
  tablet: { obj: THREE.Object3D; at: THREE.Vector3; beacon: THREE.MeshStandardMaterial };
  portal: { group: THREE.Group; disc: THREE.ShaderMaterial; at: THREE.Vector3 };
  /** Tree trunks, for collision near the player. */
  trunks: TreeTrunk[];
  water: THREE.ShaderMaterial;
  /** Where bubbles can come up: water surface spots. */
  bubbleSpots: { x: number; z: number; y: number; r: number }[];
  sky: THREE.ShaderMaterial;
  planets: THREE.Object3D[];
  /** The ground as one mesh, for bullets and goo to stop on. */
  terrain: THREE.Mesh;
  /** A top-down picture of the valley for the tracker. */
  mapCanvas: HTMLCanvasElement;
  mapBounds: { x0: number; x1: number; z0: number; z1: number };
  specimens: THREE.Object3D[];
  /** The forest's instanced chunks, for hiding by distance. */
  chunks: THREE.InstancedMesh[];
}

interface Inst {
  m: THREE.Matrix4;
  c?: THREE.Color;
}

// ================================================================ builder

export class Level16Builder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private trunks: TreeTrunk[] = [];
  private bubbleSpots: Level16Data['bubbleSpots'] = [];
  private specimens: THREE.Object3D[] = [];
  private rockMat!: THREE.MeshStandardMaterial;
  private chunks: THREE.InstancedMesh[] = [];

  build(): Level16Data {
    const rt = rockTexture();
    rt.repeat.set(0.25, 0.25);
    this.rockMat = new THREE.MeshStandardMaterial({ map: rt, color: 0xe8e0d0, roughness: 0.92 });
    const terrain = this.buildTerrain();
    const water = this.buildWater();
    this.buildMassif();
    this.buildForest();
    const sky = this.buildSky();
    const door = this.buildStation();
    const tablet = this.buildDrone();
    const portal = this.buildPortal();
    const map = this.buildMap();
    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      glassPanes: [],
      start: { pos: new THREE.Vector3(0, groundY(0, 136.6), 136.6), yaw: 0 },
      door,
      tablet,
      portal,
      trunks: this.trunks,
      water,
      bubbleSpots: this.bubbleSpots,
      sky: sky.mat,
      planets: sky.planets,
      terrain,
      mapCanvas: map,
      mapBounds: { x0: -70, x1: 70, z0: -165, z1: 150 },
      specimens: this.specimens,
      chunks: this.chunks
    };
  }

  /**
   * Instances, in chunks 40 m long and half the valley wide, each with its own
   * bounds: what's behind him or off to the side isn't drawn, and the scene
   * hides what's lost in the haze.
   */
  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: Inst[]): void {
    const bands = new Map<string, Inst[]>();
    for (const it of items) {
      const e = it.m.elements;
      const k = `${Math.floor(e[14] / 40)},${e[12] < 0 ? 0 : 1}`;
      let l = bands.get(k);
      if (!l) bands.set(k, (l = []));
      l.push(it);
    }
    for (const list of bands.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        im.setMatrixAt(i, it.m);
        if (it.c) im.setColorAt(i, it.c);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      this.group.add(im);
      this.chunks.push(im);
    }
  }

  private collide(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider {
    const c: Collider = { box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)) };
    this.colliders.push(c);
    return c;
  }

  // ------------------------------------------------------------- terrain

  private buildTerrain(): THREE.Mesh {
    const X0 = -150;
    const X1 = 150;
    const Z0 = -185;
    const Z1 = 165;
    const step = 1.25;
    const nx = Math.round((X1 - X0) / step);
    const nz = Math.round((Z1 - Z0) / step);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const col = new Float32Array((nx + 1) * (nz + 1) * 3);
    const uv = new Float32Array((nx + 1) * (nz + 1) * 2);
    const heights: number[] = [];
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) {
        const x = X0 + i * step;
        const z = Z0 + j * step;
        heights.push(groundY(x, z));
      }
    const H = (i: number, j: number): number => heights[Math.min(nz, Math.max(0, j)) * (nx + 1) + Math.min(nx, Math.max(0, i))];
    const sponge = new THREE.Color(0xf2ecc0);
    const moss = new THREE.Color(0xa8c86a);
    const rock = new THREE.Color(0xa8a090);
    const bed = new THREE.Color(0x3d6a2a);
    const c = new THREE.Color();
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) {
        const k = j * (nx + 1) + i;
        const x = X0 + i * step;
        const z = Z0 + j * step;
        const y = H(i, j);
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        uv[k * 2] = x * 0.17;
        uv[k * 2 + 1] = z * 0.17;
        // Colour: moss in the hollows, bare rock where it's steep, green-stained under water
        const slope = Math.hypot(H(i + 1, j) - H(i - 1, j), H(i, j + 1) - H(i, j - 1)) / (2 * step);
        const m = Math.max(0, Math.min(1, 0.5 + fbm(x * 0.05, z * 0.05) * 1.4));
        c.copy(sponge).lerp(moss, m * 0.7);
        c.lerp(rock, smoothstep(0.7, 1.4, slope));
        if (y < WATER_Y - 0.3 && inLake(x, z)) c.lerp(bed, 0.8);
        for (const p of PONDS) if (Math.hypot(x - p.x, z - p.z) < p.r) c.lerp(bed, 0.6);
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    const idx: number[] = [];
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        const b = a + 1;
        const d = a + nx + 1;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tex = spongeTexture();
    const bump = spongeBump();
    bump.repeat.set(1.7, 1.7);
    const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: bump, bumpScale: 1.6, vertexColors: true, roughness: 0.95 });
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    // (not shootable as a mesh: far too many triangles to raycast; the scene marches groundY instead)
    return mesh;
  }

  // ------------------------------------------------------------- water

  private buildWater(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uT: { value: 0 },
        fogColor: { value: new THREE.Color() },
        fogDensity: { value: 0 }
      },
      vertexShader: `
        varying vec3 vW; varying float vDepth;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform float uT; uniform vec3 fogColor; uniform float fogDensity;
        varying vec3 vW; varying float vDepth;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 p = vW.xz * 0.35;
          float a = n(p + vec2(uT * 0.25, uT * 0.18)) * 0.6 + n(p * 2.3 - vec2(uT * 0.3, -uT * 0.2)) * 0.4;
          // Bubbles: little rings appearing and popping across the surface
          vec2 cell = floor(vW.xz * 1.3);
          vec2 f = fract(vW.xz * 1.3) - 0.5;
          float r = h(cell);
          float life = fract(uT * (0.25 + r * 0.35) + r * 7.0);
          float ring = smoothstep(0.08, 0.0, abs(length(f) - life * 0.42)) * step(0.72, r) * (1.0 - life);
          vec3 deep = vec3(0.10, 0.62, 0.12);
          vec3 bright = vec3(0.45, 1.0, 0.25);
          vec3 c = mix(deep, bright, smoothstep(0.35, 0.85, a));
          c += vec3(0.7, 1.0, 0.5) * ring * 0.9;
          float fog = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth);
          gl_FragColor = vec4(mix(c * 1.25, fogColor, fog), 0.9);
        }`,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    // The lake: pool A, pool B
    for (const p of [POOL_A, POOL_B]) {
      const w = p.x1 - p.x0 + 8;
      const d = p.z1 - p.z0 + 8;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((p.x0 + p.x1) / 2, WATER_Y, (p.z0 + p.z1) / 2);
      m.renderOrder = 2;
      this.group.add(m);
      for (let k = 0; k < 6; k++) this.bubbleSpots.push({ x: p.x0 + Math.random() * (p.x1 - p.x0), z: p.z0 + Math.random() * (p.z1 - p.z0), y: WATER_Y, r: 1.2 });
    }
    // The ponds
    for (const p of PONDS) {
      const y = pondLevel(p);
      const m = new THREE.Mesh(new THREE.CircleGeometry(p.r + 0.6, 40), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, y, p.z);
      m.renderOrder = 2;
      this.group.add(m);
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * p.r * 0.7;
        this.bubbleSpots.push({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, y, r: 0.8 });
      }
    }
    return mat;
  }

  // ------------------------------------------------------------- the massif and its passage

  /**
   * The massif: its south and north faces (rough walls, holes where the
   * passage opens into each pool, under the water), a broken top, and the
   * passage under it — walls and a ceiling of rock round a winding way, the
   * lake bed for its floor.
   */
  private buildMassif(): void {
    const { x0, x1, z0, z1, top } = MASSIF;
    const rock = this.rockMat;
    // ---- The faces: a displaced grid, the mouth cut out of it
    const face = (z: number, out: 1 | -1): void => {
      const w = x1 - x0;
      const hgt = top - (LAKE_BED - 1);
      const sx = 1;
      const nx = Math.round(w / sx);
      const ny = Math.round(hgt / 1);
      const pos: number[] = [];
      const idx: number[] = [];
      for (let j = 0; j <= ny; j++)
        for (let i = 0; i <= nx; i++) {
          const x = x0 + i * sx;
          const y = LAKE_BED - 1 + (j / ny) * hgt;
          const bulge = (fbm(x * 0.08, y * 0.08 + z) + 0.6) * 2.0 + fbm(x * 0.3, y * 0.3) * 0.5;
          const nearMouth = Math.abs(x) < 6 && y < CEIL_Y + 3 ? 1 - Math.max(smoothstep(2.2, 6, Math.abs(x)), smoothstep(CEIL_Y, CEIL_Y + 3, y)) : 0;
          pos.push(x, y, z + out * (0.6 + Math.max(0, bulge) * (1 - nearMouth)));
        }
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const cx = x0 + (i + 0.5) * sx;
          const cy = LAKE_BED - 1 + ((j + 0.5) / ny) * hgt;
          // The passage's mouth: open
          if (Math.abs(cx) < PATH_HALF + 0.2 && cy < CEIL_Y) continue;
          const a = j * (nx + 1) + i;
          const b = a + 1;
          const c = a + nx + 1;
          const d = c + 1;
          if (out > 0) idx.push(a, b, c, b, d, c);
          else idx.push(a, c, b, b, c, d);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      // World UVs
      const uvs: number[] = [];
      for (let k = 0; k < pos.length; k += 3) uvs.push(pos[k] * 1.0, pos[k + 1] * 1.0);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, rock);
      this.group.add(m);
      this.shootables.push(m);
      // Collision: either side of the mouth, and over it
      const zz0 = out > 0 ? z - 0.2 : z - 1.5;
      const zz1 = out > 0 ? z + 1.5 : z + 0.2;
      this.collide(x0, LAKE_BED - 2, Math.min(zz0, zz1), -PATH_HALF, top, Math.max(zz0, zz1));
      this.collide(PATH_HALF, LAKE_BED - 2, Math.min(zz0, zz1), x1, top, Math.max(zz0, zz1));
      this.collide(-PATH_HALF, CEIL_Y, Math.min(zz0, zz1), PATH_HALF, top, Math.max(zz0, zz1));
    };
    face(z1, 1);
    face(z0, -1);
    this.buildCliffFace();
    this.collide(x0, CEIL_Y + 1.2, z0, x1, top - 1, z1);
    // ---- The top: a broken plateau of rock
    {
      const n = 48;
      const geo = new THREE.PlaneGeometry(x1 - x0 + 6, z1 - z0 + 6, n, 24);
      geo.rotateX(-Math.PI / 2);
      const p = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i) + (z0 + z1) / 2;
        p.setY(i, top - 1 + fbm(x * 0.06, z * 0.06) * 6 + Math.abs(fbm(x * 0.2, z * 0.2)) * 3);
        p.setZ(i, z);
      }
      const uvs = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        uvs[i * 2] = p.getX(i);
        uvs[i * 2 + 1] = p.getZ(i);
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.computeVertexNormals();
      this.group.add(new THREE.Mesh(geo, rock));
    }
    // ---- The passage: a grid of 1 m cells; walls round the path, a ceiling over it
    const cells = new Map<string, boolean>();
    const key = (i: number, j: number): string => `${i},${j}`;
    const gx0 = -20;
    const gx1 = 20;
    const gz0 = z0 - 2;
    const gz1 = z1 + 1;
    for (let i = gx0; i < gx1; i++) for (let j = gz0; j < gz1; j++) if (pathDist(i + 0.5, j + 0.5) < PATH_HALF) cells.set(key(i, j), true);
    const wallGeos: THREE.BufferGeometry[] = [];
    const ceilGeos: THREE.BufferGeometry[] = [];
    const wallBottom = LAKE_BED - 1.5;
    const wallTop = CEIL_Y + 1.2;
    for (let j = gz0; j < gz1; j++) {
      // (null, not -1, for "no run": the cells west of x = 0 have negative indices)
      let run: number | null = null;
      const flush = (iEnd: number): void => {
        if (run === null) return;
        const g = new THREE.BoxGeometry(iEnd - run, wallTop - wallBottom, 1, Math.max(1, (iEnd - run) * 2), 6, 2);
        g.translate((run + iEnd) / 2, (wallTop + wallBottom) / 2, j + 0.5);
        wallGeos.push(g);
        this.collide(run, wallBottom, j, iEnd, wallTop, j + 1);
        run = null;
      };
      for (let i = gx0; i <= gx1; i++) {
        const z = j + 0.5;
        const isWall =
          i < gx1 &&
          !cells.get(key(i, j)) &&
          z > z0 - 0.5 &&
          z < z1 + 0.5 &&
          [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]].some(([a, b]) => cells.get(key(i + a, j + b)));
        if (isWall && run === null) run = i;
        if (!isWall) flush(i);
      }
      // The ceiling over this row's path cells
      let cr: number | null = null;
      for (let i = gx0; i <= gx1; i++) {
        const on = i < gx1 && cells.get(key(i, j)) && j + 0.5 < z1 && j + 0.5 > z0;
        if (on && cr === null) cr = i;
        if (!on && cr !== null) {
          const g = new THREE.BoxGeometry(i - cr, 1.2, 1, Math.max(1, (i - cr) * 2), 2, 2);
          g.translate((cr + i) / 2, CEIL_Y + 0.6, j + 0.5);
          ceilGeos.push(g);
          this.collide(cr, CEIL_Y, j, i, CEIL_Y + 1.2, j + 1);
          cr = null;
        }
      }
    }
    // Rough them up: displace by world-position noise (shared vertices move together, so no cracks)
    const rough = (geos: THREE.BufferGeometry[]): THREE.BufferGeometry => {
      const g = mergeGeometries(geos.map((x) => x.toNonIndexed()), false)!;
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const d = fbm(x * 0.7 + y * 0.3, z * 0.7 - y * 0.2) * 0.32;
        p.setXYZ(i, x + d, y + d * 0.6, z - d);
      }
      const uvs = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        uvs[i * 2] = p.getX(i) + p.getZ(i);
        uvs[i * 2 + 1] = p.getY(i);
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      g.computeVertexNormals();
      return g;
    };
    const walls = new THREE.Mesh(rough(wallGeos), rock);
    const ceil = new THREE.Mesh(rough(ceilGeos), rock);
    this.group.add(walls, ceil);
    // Glowing growths on the passage walls: something to see by besides the torch
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x0a2a10, emissive: 0x70ff90, emissiveIntensity: 1.2 });
    for (let k = 0; k < 40; k++) {
      const seg = Math.floor(Math.random() * (PATH.length - 1));
      const [ax, az] = PATH[seg];
      const [bx, bz] = PATH[seg + 1];
      const t = Math.random();
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (z > z1 || z < z0) continue;
      const along = new THREE.Vector2(bx - ax, bz - az).normalize();
      const side = Math.random() < 0.5 ? 1 : -1;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.08, 6, 5), glowMat);
      m.position.set(x - along.y * side * (PATH_HALF - 0.05), LAKE_BED + 0.3 + Math.random() * 2.2, z + along.x * side * (PATH_HALF - 0.05));
      this.group.add(m);
    }
  }

  /**
   * The cliff across the valley: a band of broken rock over the steep part of
   * the ground, its strata running sideways, ledges and bulges. Only to look
   * at: the ground's own slope is what stops him.
   */
  private buildCliffFace(): void {
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const X0 = -64;
    const X1 = 64;
    const nx = Math.round((X1 - X0) / 0.7);
    const ny = 10;
    for (let i = 0; i <= nx; i++) {
      const x = X0 + (i / nx) * (X1 - X0);
      // Where the step is along this x (the lip wanders as the ground's does)
      const zc = CLIFF_Z - fbm(x * 0.08, 3) * 1.2;
      const bot = groundY(x, zc + 1.6) - 0.6;
      const top = groundY(x, zc - 1.6) + 0.12;
      for (let j = 0; j <= ny; j++) {
        const v = j / ny;
        const y = bot + (top - bot) * v;
        // Strata: ledges every so often, bulges between
        const strata = Math.sin(y * 3.1 + fbm(x * 0.2, 1) * 2) * 0.12 + fbm(x * 0.35, y * 0.6) * 0.28;
        const lean = (v - 0.5) * -0.35;
        pos.push(x, y, zc + 0.35 + strata + lean + (j === ny ? -0.35 : 0));
        uvs.push(x * 0.5, y * 0.5);
      }
    }
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const a = i * (ny + 1) + j;
        const b = a + ny + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.rockMat);
    this.group.add(m);
    this.shootables.push(m);
  }

  // ------------------------------------------------------------- the forest

  /**
   * Trees, purple and green, a trunk each and a crown of lumpy clumps; bushes;
   * spiky plants by the water. Instanced, kept out of the clearings.
   */
  private buildForest(): void {
    const clear = (x: number, z: number): boolean => {
      if (Math.hypot(x - 0, z - 134) < 16) return false;
      if (Math.hypot(x - MEADOW.x, z - MEADOW.z) < 21) return false;
      if (Math.hypot(x - ARENA.x, z - ARENA.z) < 31) return false;
      if (Math.hypot(x - PORTAL.x, z - PORTAL.z) < 14) return false;
      if (Math.abs(z - CLIFF_Z) < 3.5) return false;
      if (z < MASSIF.z1 + 4 && z > MASSIF.z0 - 4 && Math.abs(x) < 42) return false;
      if (x > POOL_B.x0 - 4 && x < POOL_B.x1 + 4 && z > POOL_B.z0 - 6 && z < POOL_B.z1) return false;
      for (const p of PONDS) if (Math.hypot(x - p.x, z - p.z) < p.r + 2) return false;
      const { hw, cx } = valley(z);
      if (Math.abs(x - cx) > hw + 6) return false;
      return true;
    };
    // ---- Geometry: a tapered, slightly bent trunk; a crown of five displaced lumps
    const trunk = new THREE.CylinderGeometry(0.12, 0.3, 4.2, 8, 6);
    {
      const p = trunk.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        p.setX(i, p.getX(i) + Math.sin(y * 0.8) * 0.12);
        p.setZ(i, p.getZ(i) + Math.cos(y * 0.6) * 0.08);
      }
      trunk.translate(0, 2.1, 0);
      trunk.computeVertexNormals();
    }
    const crownParts: THREE.BufferGeometry[] = [];
    for (const [x, y, z, r] of [[0, 4.6, 0, 1.5], [1.0, 4.1, 0.3, 1.1], [-0.9, 4.2, -0.4, 1.15], [0.2, 5.4, -0.2, 1.05], [-0.2, 4.0, 1.0, 1.0], [0.4, 3.9, -1.0, 0.95]]) {
      const g = new THREE.IcosahedronGeometry(r, 1);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i);
        v.multiplyScalar(1 + fbm(v.x * 2 + x, v.y * 2 + z) * 0.3);
        p.setXYZ(i, v.x + x, v.y + y, v.z + z);
      }
      crownParts.push(g);
    }
    const crown = mergeGeometries(crownParts.map((g) => g.toNonIndexed()), false)!;
    crown.computeVertexNormals();
    const bark = new THREE.MeshStandardMaterial({ color: 0x4a3c34, roughness: 0.9 });
    const purple = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, flatShading: true });
    const green = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true });
    // ---- Placement
    const spots: { x: number; z: number; s: number; ry: number; p: boolean }[] = [];
    for (let k = 0; k < 9000 && spots.length < 1500; k++) {
      const x = -70 + Math.random() * 140;
      const z = -170 + Math.random() * 318;
      if (!clear(x, z)) continue;
      // Clumped: thinner in places
      if (fbm(x * 0.03, z * 0.03) < -0.2) continue;
      if (spots.some((s) => Math.abs(s.x - x) < 2.4 && Math.abs(s.z - z) < 2.4)) continue;
      spots.push({ x, z, s: 0.8 + Math.random() * 0.8, ry: Math.random() * 6.28, p: Math.random() < 0.55 });
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const trunkItems: Inst[] = [];
    const purpleItems: Inst[] = [];
    const greenItems: Inst[] = [];
    spots.forEach((s) => {
      const y = groundY(s.x, s.z) - 0.1;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, y, s.z), q, new THREE.Vector3(s.s, s.s * (0.9 + Math.random() * 0.4), s.s));
      trunkItems.push({ m });
      const c = new THREE.Color().setHSL(s.p ? 0.8 + Math.random() * 0.06 : 0.28 + Math.random() * 0.06, 0.55 + Math.random() * 0.2, s.p ? 0.42 + Math.random() * 0.12 : 0.34 + Math.random() * 0.1);
      (s.p ? purpleItems : greenItems).push({ m, c });
      this.trunks.push({ x: s.x, z: s.z, r: 0.28 * s.s, h: 4.2 * s.s });
    });
    this.instanced(trunk, bark, trunkItems);
    this.instanced(crown, purple, purpleItems);
    this.instanced(crown, green, greenItems);
    const tint = new THREE.Color();
    // ---- Bushes and spiky plants
    const bushG = new THREE.IcosahedronGeometry(0.7, 1);
    {
      const p = bushG.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i);
        v.multiplyScalar(1 + fbm(v.x * 3, v.z * 3) * 0.4);
        v.y *= 0.65;
        p.setXYZ(i, v.x, v.y + 0.3, v.z);
      }
      bushG.computeVertexNormals();
    }
    const spikes: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 9; k++) {
      const g = new THREE.ConeGeometry(0.03, 0.6 + Math.random() * 0.5, 4);
      g.translate(0, 0.3, 0);
      g.rotateZ((Math.random() - 0.5) * 0.7);
      g.rotateY((k / 9) * Math.PI * 2);
      g.translate(Math.random() * 0.15, 0, Math.random() * 0.15);
      spikes.push(g.toNonIndexed());
    }
    const spikeG = mergeGeometries(spikes, false)!;
    const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true });
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x2f5a26, roughness: 0.8 });
    const bushSpots: { x: number; z: number }[] = [];
    for (let k = 0; k < 9000 && bushSpots.length < 2400; k++) {
      const x = -70 + Math.random() * 140;
      const z = -170 + Math.random() * 318;
      if (!clear(x, z) && !(Math.hypot(x - MEADOW.x, z - MEADOW.z) > 14 && Math.hypot(x - MEADOW.x, z - MEADOW.z) < 21)) continue;
      bushSpots.push({ x, z });
    }
    this.instanced(
      bushG,
      bushMat,
      bushSpots.map((s) => {
        const sc = 0.5 + Math.random() * 0.9;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, groundY(s.x, s.z) - 0.05, s.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6), new THREE.Vector3(sc, sc, sc));
        return { m, c: tint.setHSL(Math.random() < 0.6 ? 0.8 + Math.random() * 0.05 : 0.3, 0.6, 0.38 + Math.random() * 0.12).clone() };
      })
    );
    // Spiky plants round every bit of water
    const spikeSpots: THREE.Vector3[] = [];
    const ring = (cx: number, cz: number, r: number, n: number): void => {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const rr = r + (Math.random() - 0.3) * 2.2;
        const x = cx + Math.cos(a) * rr;
        const z = cz + Math.sin(a) * rr;
        spikeSpots.push(new THREE.Vector3(x, groundY(x, z), z));
      }
    };
    for (const p of PONDS) ring(p.x, p.z, p.r, 24);
    ring(0, -6, 11, 30);
    ring(0, -52, 12, 30);
    for (let k = 0; k < 500; k++) {
      const x = -60 + Math.random() * 120;
      const z = -165 + Math.random() * 310;
      if (clear(x, z)) spikeSpots.push(new THREE.Vector3(x, groundY(x, z), z));
    }
    this.instanced(
      spikeG,
      spikeMat,
      spikeSpots.map((p) => {
        const sc = 0.7 + Math.random() * 0.8;
        return { m: new THREE.Matrix4().compose(p, q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6), new THREE.Vector3(sc, sc, sc)) };
      })
    );
    // Boulders scattered about, some by the cliff
    const boulderG = new THREE.IcosahedronGeometry(1, 1);
    {
      const p = boulderG.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i);
        v.multiplyScalar(1 + fbm(v.x * 1.5, v.z * 1.5 + v.y) * 0.45);
        p.setXYZ(i, v.x, v.y * 0.7, v.z);
      }
      const uvs = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        uvs[i * 2] = p.getX(i) * 2;
        uvs[i * 2 + 1] = p.getY(i) * 2 + p.getZ(i);
      }
      boulderG.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      boulderG.computeVertexNormals();
    }
    const bspots: THREE.Vector3[] = [];
    for (let k = 0; k < 2000 && bspots.length < 140; k++) {
      const x = -60 + Math.random() * 120;
      const z = -165 + Math.random() * 310;
      if (!clear(x, z) && Math.abs(z - CLIFF_Z) > 6) continue;
      if (Math.hypot(x - ARENA.x, z - ARENA.z) < 31 && Math.random() < 0.7) continue;
      bspots.push(new THREE.Vector3(x, groundY(x, z), z));
    }
    this.instanced(
      boulderG,
      this.rockMat,
      bspots.map((p) => {
        const s = 0.4 + Math.pow(Math.random(), 2) * 1.6;
        if (s > 0.7) this.trunks.push({ x: p.x, z: p.z, r: s * 0.8, h: s * 0.6 });
        return { m: m4.compose(p.clone().setY(p.y - s * 0.25), q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, Math.random())), new THREE.Vector3(s, s, s)).clone() };
      })
    );
  }

  // ------------------------------------------------------------- the sky

  private buildSky(): { mat: THREE.ShaderMaterial; planets: THREE.Object3D[] } {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform float uT; varying vec3 vD;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        float fb(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += n(p) * a; p *= 2.1; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vD);
          float up = max(d.y, 0.0);
          vec2 p = d.xz / (d.y + 0.25);
          // Black overhead, a deep purple glow toward the horizon
          vec3 c = mix(vec3(0.16, 0.07, 0.24), vec3(0.004, 0.003, 0.012), smoothstep(0.0, 0.55, up));
          // Purple cloud banks low in the sky
          float cl = fb(p * 0.9 + vec2(uT * 0.004, 0.0));
          c += vec3(0.35, 0.16, 0.5) * smoothstep(0.45, 0.85, cl) * (1.0 - smoothstep(0.05, 0.5, up)) * 0.9;
          // An aurora: a cyan curtain in one quarter
          float au = smoothstep(0.6, 0.0, abs(d.y - 0.32 - sin(d.x * 6.0 + uT * 0.05) * 0.05)) * smoothstep(-0.2, 0.6, d.x) * smoothstep(0.3, -0.6, d.z);
          c += vec3(0.1, 0.55, 0.7) * au * (0.4 + 0.6 * fb(vec2(d.x * 20.0, uT * 0.03))) * 0.6;
          // Stars
          vec2 sp = vec2(atan(d.z, d.x) * 200.0, d.y * 260.0);
          float st = step(0.996, h(floor(sp))) * smoothstep(0.02, 0.2, up);
          c += vec3(st) * (0.6 + 0.4 * h(floor(sp) + 3.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.group.add(sky);
    // Planets: a banded giant with a ring, a pale cratered moon, a blue one, two small
    const planets: THREE.Object3D[] = [];
    const planetTex = (kind: number): THREE.CanvasTexture => {
      const c = makeCanvas(512, 256);
      const g = c.getContext('2d')!;
      if (kind === 0) {
        for (let y = 0; y < 256; y++) {
          const t = y / 256;
          const v = Math.sin(t * 30 + Math.sin(t * 9) * 2) * 0.5 + 0.5;
          g.fillStyle = `rgb(${120 + v * 80},${90 + v * 50},${130 + v * 60})`;
          g.fillRect(0, y, 512, 1);
        }
      } else if (kind === 1) {
        g.fillStyle = '#a8a4a0';
        g.fillRect(0, 0, 512, 256);
        for (let k = 0; k < 160; k++) {
          const x = Math.random() * 512;
          const y = Math.random() * 256;
          const r = 2 + Math.pow(Math.random(), 3) * 26;
          g.fillStyle = 'rgba(60,58,56,0.35)';
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = 'rgba(220,216,210,0.3)';
          g.stroke();
        }
      } else {
        g.fillStyle = '#2a5aa8';
        g.fillRect(0, 0, 512, 256);
        for (let k = 0; k < 60; k++) {
          g.fillStyle = `rgba(${200 + Math.random() * 55},${220 + Math.random() * 35},255,${0.2 + Math.random() * 0.3})`;
          g.beginPath();
          g.ellipse(Math.random() * 512, Math.random() * 256, 20 + Math.random() * 60, 4 + Math.random() * 8, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const planet = (kind: number, r: number, dir: THREE.Vector3, ring = false): void => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), new THREE.MeshBasicMaterial({ map: planetTex(kind), fog: false }));
      // A lit side and a dark side, painted on: a gradient over the sphere
      const shade = new THREE.Mesh(new THREE.SphereGeometry(r * 1.002, 48, 32), new THREE.ShaderMaterial({
        uniforms: { uL: { value: new THREE.Vector3(-0.6, 0.4, 0.7).normalize() } },
        vertexShader: 'varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uL; varying vec3 vN; void main(){ float k = smoothstep(-0.25, 0.4, dot(vN, uL)); gl_FragColor = vec4(0.0, 0.0, 0.02, 1.0 - k * 0.92); }',
        transparent: true,
        depthWrite: false,
        fog: false
      }));
      const g = new THREE.Group();
      g.add(m, shade);
      if (ring) {
        const rg = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 2.2, 96, 1), new THREE.MeshBasicMaterial({ color: 0xc8b0d8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, fog: false }));
        rg.rotation.x = Math.PI / 2 - 0.85;
        rg.rotation.y = 0.45;
        g.add(rg);
      }
      g.position.copy(dir.normalize().multiplyScalar(820));
      g.renderOrder = -9;
      g.traverse((o) => (o.frustumCulled = false));
      this.group.add(g);
      planets.push(g);
    };
    planet(0, 120, new THREE.Vector3(-0.55, 0.42, -0.72), true);
    planet(1, 45, new THREE.Vector3(0.6, 0.55, -0.5));
    planet(2, 26, new THREE.Vector3(0.25, 0.32, -0.9));
    planet(1, 12, new THREE.Vector3(-0.2, 0.7, -0.6));
    planet(2, 18, new THREE.Vector3(0.8, 0.25, 0.4));
    return { mat, planets };
  }

  // ------------------------------------------------------------- the survey station

  /**
   * A small prefab station: panelled walls, a grated floor, a light; specimen
   * jars of alien parts in green fluid, rock samples on shelves, a bench with a
   * microscope and a screen, a generator, crates, pipes; the door in the north
   * wall and its release button.
   */
  private buildStation(): Level16Data['door'] {
    const { x0, x1, z0, z1, h } = BUILDING;
    const fy = groundY(0, 134.5);
    const g = new THREE.Group();
    g.position.y = fy;
    this.group.add(g);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xc8ccc8, roughness: 0.6, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: 0.5, metalness: 0.6 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8e979e, roughness: 0.35, metalness: 0.8 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8b21c, roughness: 0.55 });
    const box = (w: number, hh: number, d: number, x: number, y: number, z: number, m: THREE.Material, solid = false): THREE.Mesh => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m);
      o.position.set(x, y, z);
      g.add(o);
      if (solid) this.collide(x - w / 2, fy + y - hh / 2, z - d / 2, x + w / 2, fy + y + hh / 2, z + d / 2);
      return o;
    };
    // Floor, ceiling, walls (the north one round the door)
    box(x1 - x0, 0.1, z1 - z0, 0, -0.05, (z0 + z1) / 2, dark);
    box(x1 - x0 + 0.4, 0.15, z1 - z0 + 0.4, 0, h + 0.075, (z0 + z1) / 2, wallMat);
    box(0.2, h, z1 - z0, x0 - 0.1, h / 2, (z0 + z1) / 2, wallMat, true);
    box(0.2, h, z1 - z0, x1 + 0.1, h / 2, (z0 + z1) / 2, wallMat, true);
    box(x1 - x0 + 0.4, h, 0.2, 0, h / 2, z1 + 0.1, wallMat, true);
    box(3.0, h, 0.2, x0 + 1.5, h / 2, z0 - 0.1, wallMat, true);
    box(3.0, h, 0.2, x1 - 1.5, h / 2, z0 - 0.1, wallMat, true);
    box(2.0, h - 2.5, 0.2, 0, 2.5 + (h - 2.5) / 2, z0 - 0.1, wallMat, true);
    // Panel seams and ribs inside
    for (let x = x0 + 1; x < x1; x += 2) {
      box(0.06, h, 0.04, x, h / 2, z1 - 0.02, dark);
    }
    for (let z = z0 + 1; z < z1; z += 2) {
      box(0.04, h, 0.06, x0 + 0.02, h / 2, z, dark);
      box(0.04, h, 0.06, x1 - 0.02, h / 2, z, dark);
    }
    // A strip light, and the light itself
    box(2.6, 0.06, 0.2, 0, h - 0.04, (z0 + z1) / 2, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f4ff, emissiveIntensity: 2 }));
    const light = new THREE.PointLight(0xdfeeff, 6, 10, 1.4);
    light.position.set(0, fy + h - 0.4, (z0 + z1) / 2);
    this.group.add(light);
    // ---- The door: a slab that rides up into the lintel, hazard stripes, the button by it
    const slab = new THREE.Group();
    slab.position.set(0, fy, z0 - 0.1);
    this.group.add(slab);
    const sm = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.5, 0.12), dark);
    sm.position.y = 1.25;
    slab.add(sm);
    for (let k = 0; k < 5; k++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.5, 0.01), yellow);
      s.position.set(-0.8 + k * 0.4, 1.25, 0.065);
      s.rotation.z = 0.4;
      s.scale.y = 0.18;
      s.position.y = 0.3;
      slab.add(s);
    }
    const collider = this.collide(-1, fy, z0 - 0.2, 1, fy + 2.5, z0);
    // The button: a yellow box on the wall to the door's right, a big red mushroom on it
    box(0.3, 0.42, 0.1, 1.55, 1.3, z0 + 0.06, yellow);
    const buttonMat = new THREE.MeshStandardMaterial({ color: 0x5a0a08, emissive: 0xff2a1a, emissiveIntensity: 1.2 });
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.06, 18), buttonMat);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(1.55, 1.34, z0 + 0.13);
    g.add(btn);
    const plateC = makeCanvas(256, 64);
    {
      const pg = plateC.getContext('2d')!;
      pg.fillStyle = '#111';
      pg.fillRect(0, 0, 256, 64);
      pg.fillStyle = '#f2c400';
      pg.font = 'bold 26px Arial';
      pg.textAlign = 'center';
      pg.fillText('DOOR RELEASE', 128, 42);
    }
    const pt = new THREE.CanvasTexture(plateC);
    pt.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.07), new THREE.MeshBasicMaterial({ map: pt }));
    plate.position.set(1.55, 1.58, z0 + 0.115);
    g.add(plate);
    // ---- Specimen jars down the east wall: alien parts in glowing fluid
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfe0e8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, depthWrite: false });
    const fluid = new THREE.MeshStandardMaterial({ color: 0x1a6a2a, emissive: 0x30c050, emissiveIntensity: 0.7, transparent: true, opacity: 0.55, depthWrite: false });
    const flesh = new THREE.MeshStandardMaterial({ color: 0x8a5a6a, roughness: 0.5 });
    const fleshB = new THREE.MeshStandardMaterial({ color: 0x6a6a8a, roughness: 0.45 });
    box(0.7, 0.9, 4.2, x1 - 0.45, 0.45, 134.5, dark, true);
    for (let k = 0; k < 4; k++) {
      const z = 132.9 + k * 1.05;
      const jx = x1 - 0.45;
      const jar = new THREE.Group();
      jar.position.set(jx, 0.9, z);
      g.add(jar);
      jar.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 20), steel));
      const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.62, 20, 1, true), glass);
      gl.position.y = 0.33;
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.55, 20), fluid);
      fl.position.y = 0.3;
      fl.renderOrder = 2;
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20), steel);
      lid.position.y = 0.66;
      jar.add(gl, fl, lid);
      // What's in it
      const spec = new THREE.Group();
      spec.position.y = 0.32;
      jar.add(spec);
      if (k === 0) {
        // A coiled tentacle with suckers
        const pts: THREE.Vector3[] = [];
        for (let s = 0; s < 30; s++) {
          const a = s * 0.45;
          pts.push(new THREE.Vector3(Math.cos(a) * (0.11 - s * 0.003), -0.2 + s * 0.014, Math.sin(a) * (0.11 - s * 0.003)));
        }
        spec.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.025, 8), flesh));
      } else if (k === 1) {
        // An eye, big, a slit pupil
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.3 }));
        const iris = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), new THREE.MeshStandardMaterial({ color: 0xc87a10, emissive: 0x402000 }));
        iris.position.z = 0.119;
        const pupil = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.09), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        pupil.position.z = 0.121;
        eye.add(iris, pupil);
        eye.rotation.y = 0.7;
        spec.add(eye);
        this.specimens.push(eye);
      } else if (k === 2) {
        // A claw: three hooked segments
        for (let s = 0; s < 3; s++) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.03 - s * 0.006, 0.14, 8), fleshB);
          c.position.set(0, -0.15 + s * 0.12, 0.02 * s);
          c.rotation.x = 0.4 + s * 0.35;
          spec.add(c);
        }
      } else {
        // A lump of something with veins
        const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 3), flesh);
        const p = lump.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(p, i);
          v.multiplyScalar(1 + fbm(v.x * 18, v.y * 18 + v.z * 9) * 0.3);
          p.setXYZ(i, v.x, v.y * 1.3, v.z);
        }
        lump.geometry.computeVertexNormals();
        spec.add(lump);
        this.specimens.push(lump);
      }
      // A label
      const lc = makeCanvas(128, 32);
      const lg = lc.getContext('2d')!;
      lg.fillStyle = '#efece0';
      lg.fillRect(0, 0, 128, 32);
      lg.fillStyle = '#222';
      lg.font = 'bold 14px monospace';
      lg.fillText(`SPC-${(410 + k * 7).toString()}-${'ABCD'[k]}`, 8, 21);
      const lt = new THREE.CanvasTexture(lc);
      lt.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), new THREE.MeshBasicMaterial({ map: lt }));
      label.position.set(-0.225, 0.08, 0);
      label.rotation.y = -Math.PI / 2;
      jar.add(label);
    }
    // ---- Rock samples on shelves along the west wall
    const rockMat = this.rockMat;
    for (const y of [0.7, 1.3, 1.9]) {
      box(0.45, 0.04, 3.4, x0 + 0.25, y, 134.2, steel);
      for (let k = 0; k < 6; k++) {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06 + Math.random() * 0.07, 1), k % 3 === 0 ? new THREE.MeshStandardMaterial({ color: 0x4a2a5a, emissive: 0x401060, emissiveIntensity: 0.5, roughness: 0.4 }) : rockMat);
        r.position.set(x0 + 0.25, y + 0.1, 132.8 + k * 0.55);
        r.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        g.add(r);
        const tag = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.07), new THREE.MeshStandardMaterial({ color: 0xe8e4d8 }));
        tag.position.set(x0 + 0.47, y + 0.03, 132.8 + k * 0.55);
        g.add(tag);
      }
    }
    for (const s of [-1, 1]) box(0.04, 1.95, 0.04, x0 + 0.25 + s * 0.2, 0.975, 132.5, steel);
    this.collide(x0, fy, 132.4, x0 + 0.5, fy + 2, 136);
    // ---- The bench at the south wall: microscope, a screen, a rack of sample tubes
    box(2.6, 0.06, 0.7, -0.6, 0.9, z1 - 0.4, dark, true);
    box(2.5, 0.85, 0.05, -0.6, 0.45, z1 - 0.1, dark);
    const scr = makeCanvas(256, 160);
    {
      const sg = scr.getContext('2d')!;
      sg.fillStyle = '#04100a';
      sg.fillRect(0, 0, 256, 160);
      sg.strokeStyle = '#4dff8a';
      sg.lineWidth = 2;
      sg.beginPath();
      for (let x = 0; x < 256; x += 2) sg.lineTo(x, 80 + Math.sin(x * 0.08) * 30 * Math.sin(x * 0.013));
      sg.stroke();
      sg.fillStyle = '#4dff8a';
      sg.font = '12px monospace';
      sg.fillText('ATMOS 0.71 bar  O2 19.8%', 8, 18);
      sg.fillText('SAMPLE 4C — LIVE TISSUE', 8, 148);
    }
    const st = new THREE.CanvasTexture(scr);
    st.colorSpace = THREE.SRGBColorSpace;
    box(0.66, 0.42, 0.04, -1.3, 1.25, z1 - 0.22, dark);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.36), new THREE.MeshBasicMaterial({ map: st, toneMapped: false }));
    face.position.set(-1.3, 1.25, z1 - 0.245);
    face.rotation.y = Math.PI;
    g.add(face);
    // Microscope
    const mic = new THREE.Group();
    mic.position.set(0, 0.93, z1 - 0.45);
    g.add(mic);
    const micM = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.4 });
    const mb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.2), micM);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.05), micM);
    arm.position.set(0, 0.14, 0.06);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.16, 12), dark);
    tube.position.set(0, 0.24, 0.0);
    tube.rotation.x = -0.4;
    mic.add(mb, arm, tube);
    // ---- A generator in the corner, piped to the ceiling; crates
    box(1.0, 1.3, 0.9, x0 + 0.7, 0.65, z1 - 0.7, new THREE.MeshStandardMaterial({ color: 0x3a5a3a, roughness: 0.6, metalness: 0.4 }), true);
    for (let k = 0; k < 4; k++) box(0.9, 0.04, 0.02, x0 + 0.7, 0.4 + k * 0.2, z1 - 1.16, dark);
    for (const dx of [-0.25, 0.25]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h - 1.3, 10), steel);
      pipe.position.set(x0 + 0.7 + dx, 1.3 + (h - 1.3) / 2, z1 - 0.7);
      g.add(pipe);
    }
    const crateM = new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.6, metalness: 0.3 });
    box(0.8, 0.6, 0.6, x1 - 0.7, 0.3, z1 - 0.45, crateM, true);
    box(0.6, 0.45, 0.5, x1 - 0.75, 0.825, z1 - 0.45, crateM);
    // ---- Outside: a roof unit, an antenna mast, a beacon
    box(1.6, 0.6, 1.2, 1.4, h + 0.45, 135.5, dark);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 3, 8), steel);
    mast.position.set(-2.6, h + 1.6, 136.5);
    g.add(mast);
    const bea = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2010, emissiveIntensity: 2.5 }));
    bea.position.set(-2.6, h + 3.15, 136.5);
    g.add(bea);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.shootables.push(o);
    });
    return { slab, collider, button: new THREE.Vector3(1.55, fy + 1.34, z0 + 0.13), buttonMat, light };
  }

  // ------------------------------------------------------------- the crashed drone and its tablet

  private buildDrone(): Level16Data['tablet'] {
    const x = MEADOW.x;
    const z = MEADOW.z;
    const y = groundY(x, z);
    const g = new THREE.Group();
    g.position.set(x + 1.6, y, z - 0.8);
    g.rotation.set(0.12, 0.6, 0.18);
    this.group.add(g);
    const shell = new THREE.MeshStandardMaterial({ color: 0xd8dcd8, roughness: 0.4, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.5, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), shell);
    body.scale.set(1.3, 0.55, 1.0);
    body.position.y = 0.2;
    g.add(body);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.78;
      const armM = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.08), dark);
      armM.position.set(Math.cos(a) * 0.7, 0.25, Math.sin(a) * 0.7);
      armM.rotation.y = -a;
      if (k === 1) armM.rotation.z = 0.5;
      g.add(armM);
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.02, 20), dark);
      rotor.position.set(Math.cos(a) * 1.15, k === 1 ? 0.55 : 0.3, Math.sin(a) * 1.15);
      rotor.rotation.z = k === 1 ? 0.6 : 0.05;
      g.add(rotor);
    }
    const beacon = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff3020, emissiveIntensity: 2.5 });
    const bl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), beacon);
    bl.position.y = 0.52;
    g.add(bl);
    // A scorched furrow behind it
    const scorch = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 6), new THREE.MeshBasicMaterial({ color: 0x1a1810, transparent: true, opacity: 0.6, depthWrite: false }));
    scorch.rotation.x = -Math.PI / 2;
    scorch.rotation.z = 0.6;
    scorch.position.set(x + 3.2, y + 0.04, z + 1.6);
    this.group.add(scorch);
    // The tablet, face up in the sponge beside it, its screen lit
    const tab = new THREE.Group();
    tab.position.set(x, y + 0.03, z);
    tab.rotation.set(-Math.PI / 2 + 0.1, 0, 0.5);
    this.group.add(tab);
    tab.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.015), dark));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.15), new THREE.MeshBasicMaterial({ color: 0x46d0ff }));
    scr.position.z = 0.008;
    tab.add(scr);
    this.collide(x + 0.6, y, z - 1.8, x + 2.6, y + 0.6, z + 0.2);
    return { obj: tab, at: new THREE.Vector3(x, y, z), beacon };
  }

  // ------------------------------------------------------------- the exit portal

  private buildPortal(): Level16Data['portal'] {
    const y = groundY(PORTAL.x, PORTAL.z);
    const g = new THREE.Group();
    g.position.set(PORTAL.x, y, PORTAL.z);
    this.group.add(g);
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.35, metalness: 0.8 });
    // A plinth, two uprights, the ring between them
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
    this.collide(PORTAL.x - 3.3, y, PORTAL.z - 0.5, PORTAL.x - 2.6, y + 5.6, PORTAL.z + 0.5);
    this.collide(PORTAL.x + 2.6, y, PORTAL.z - 0.5, PORTAL.x + 3.3, y + 5.6, PORTAL.z + 0.5);
    return { group: g, disc, at: new THREE.Vector3(PORTAL.x, y + 0.5, PORTAL.z) };
  }

  // ------------------------------------------------------------- the tracker's map

  private buildMap(): HTMLCanvasElement {
    const W = 360;
    const H = 810;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d')!;
    const X0 = -70;
    const X1 = 70;
    const Z0 = -165;
    const Z1 = 150;
    const img = g.createImageData(W, H);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const x = X0 + ((i + 0.5) / W) * (X1 - X0);
        const z = Z0 + ((j + 0.5) / H) * (Z1 - Z0);
        const y = groundY(x, z);
        let r: number;
        let gg: number;
        let b: number;
        if (inLake(x, z) && y < WATER_Y) [r, gg, b] = [60, 240, 90];
        else if (z < MASSIF.z1 && z > MASSIF.z0 && Math.abs(x) < 40) [r, gg, b] = [120, 112, 104];
        else {
          const k = Math.max(0, Math.min(1, (y + 2) / 30));
          const steep = Math.abs(groundY(x + 1, z) - groundY(x - 1, z)) + Math.abs(groundY(x, z + 1) - groundY(x, z - 1));
          r = 70 + k * 120 + Math.min(60, steep * 25);
          gg = 96 + k * 100 + Math.min(50, steep * 20);
          b = 70 + k * 90 + Math.min(50, steep * 20);
          // Contour lines
          if (Math.abs(((y + 100) % 2.5) - 1.25) < 0.12) {
            r += 25;
            gg += 30;
            b += 30;
          }
        }
        for (const p of PONDS) if (Math.hypot(x - p.x, z - p.z) < p.r) [r, gg, b] = [40, 200, 60];
        const o = (j * W + i) * 4;
        img.data[o] = r;
        img.data[o + 1] = gg;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return c;
  }
}
