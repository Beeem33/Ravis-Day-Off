import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Collider } from './OfficeLevelBuilder';
import type { CombatLevel } from '../scenes/CombatScene';
import { makeCanvas } from './Level8Builder';
import { suitModel } from '../entities/FieldSuit';

/**
 * Level16Builder — the far side of the Atom Warper.
 *
 * A canyon winding north between jagged, terraced walls of rock, under a
 * black sky with planets in it. The ground is a pale, porous sponge rolling
 * in hills, outcrops of rock standing up out of it; the water is a glowing
 * green, bubbling; the trees are purple and green.
 *
 *  - South end (z ≈ 135): a small survey station, where he arrives.
 *  - The canyon swings west: a meadow with a crashed survey drone and its
 *    tracker tablet; forest; it swings back east to a cliff (z ≈ 30) across
 *    it, five metres high: over it with the pressure shotgun.
 *  - A plateau to a rock massif blocking the canyon; a green lake at its
 *    foot and a flooded passage under it, round turns, up the other side.
 *  - North, the canyon winds again: a clearing where the big one lives; then
 *    a cave in the end wall, and in the cavern at the back of it, the exit
 *    portal.
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
export const CLIFF_Z = 30;
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
/** Ridged: sharp crests, for broken rock. 0..1. */
function ridged(x: number, y: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    const n = 1 - Math.abs(noise(x * f, y * f));
    s += n * n * amp;
    f *= 2.1;
    amp *= 0.5;
  }
  return s;
}
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The canyon's middle at z: it swings west and back east south of the massif, and again north of it. */
export function valleyX(z: number): number {
  const south = smoothstep(4, 18, z) * (1 - smoothstep(112, 126, z));
  const north = 1 - smoothstep(-72, -60, z);
  return south * 20 * Math.sin((z - 4) * 0.045) + north * 18 * Math.sin((z + 66) * 0.05);
}

export const ARENA = new THREE.Vector3(valleyX(-105), 0, -105);
export const MEADOW = new THREE.Vector3(valleyX(92) + 6, 0, 92);
/**
 * Past the big one: a chasm right across the canyon, far too deep to fall
 * into, and pillars of rock standing up out of it — too far apart to jump
 * between without the pressure shotgun. Then a ledge, and the cave.
 */
export const CHASM = { z0: -191.5, z1: -147, floor: -30 };
export const PILLARS = [
  [-158.5, 0, 6.0, 2.5],
  [-168, -15, 7.2, 2.6],
  [-177, 8, 8.0, 2.7]
].map(([z, dx, y, r]) => ({ x: valleyX(z) + dx, z, y, r }));
export const LEDGE_Y = 8.6;
/** The cave in the canyon's end wall: part two is in it. */
export const CAVE_MOUTH_Z = -203;
const CAVE_X = valleyX(CAVE_MOUTH_Z);
export const CAVE_Y = LEDGE_Y;

/** The canyon's half-width at z: wide where there's somewhere to be, narrow between. */
function halfWidth(z: number): number {
  let hw = 22 + 8 * Math.sin(z * 0.037 + 0.8) + 4 * fbm(z * 0.05, 7);
  hw = Math.max(hw, 34 * (1 - smoothstep(26, 38, Math.abs(z - ARENA.z))));
  hw = Math.max(hw, 30 * (1 - smoothstep(16, 24, Math.abs(z + 28))));
  hw = Math.max(hw, 27 * (1 - smoothstep(16, 26, Math.abs(z - 92))));
  return Math.max(hw, 16);
}

/** How far outside the canyon floor (x, z) is: > 0 up the walls. */
export function outside(x: number, z: number): number {
  const d = Math.abs(x - valleyX(z)) - halfWidth(z) + fbm(x * 0.06, z * 0.06) * 4;
  return Math.max(d, -206 - z, z - 150);
}

function pathDist(x: number, z: number, path: [number, number][] = PATH): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

export function inPassage(x: number, z: number): boolean {
  return z < MASSIF.z1 + 0.6 && z > MASSIF.z0 - 0.6 && pathDist(x, z) < PATH_HALF;
}

export function inLake(x: number, z: number): boolean {
  const inA = x > POOL_A.x0 && x < POOL_A.x1 && z > POOL_A.z0 - 0.5 && z < POOL_A.z1;
  const inB = x > POOL_B.x0 && x < POOL_B.x1 && z > POOL_B.z0 && z < POOL_B.z1 + 0.5;
  return inA || inB || inPassage(x, z);
}

/** Just inside the cave's mouth. */
export function inCave(x: number, z: number): boolean {
  return z < CAVE_MOUTH_Z + 0.5 && z > CAVE_MOUTH_Z - 9 && Math.abs(x - CAVE_X) < 3.4;
}

/** Over the chasm (not on a pillar). */
export function inChasm(x: number, z: number): boolean {
  if (z >= CHASM.z1 || z <= CHASM.z0) return false;
  return !PILLARS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r);
}

/** Decorative ponds: shallow, glowing, bubbling (placed along the canyon's middle). */
export const PONDS: { x: number; z: number; r: number }[] = [
  [62, -8, 6],
  [44, 8, 5],
  [108, 6, 4.5],
  [-84, -9, 6],
  [-128, 10, 6.5]
].map(([z, dx, r]) => ({ x: valleyX(z) + dx, z, r }));

/** Outcrops: steep humps of broken rock standing up from the floor, to go round. */
/** The hill up the canyon from the station, where the pack first shows itself. */
export const HILL = { x: valleyX(104) - 6, z: 104, r: 12, h: 7.5 };

/**
 * The hounds' dens: holes in the foot of the canyon wall a pack comes out of.
 * Each: its mouth on the canyon floor, which way it faces (yaw), and a point
 * a little way inside it.
 */
export interface Den {
  mouth: THREE.Vector3;
  inner: THREE.Vector3;
  yaw: number;
}
export const DENS: Den[] = [
  [8, 1],
  [-72, -1],
  [-134, 1],
  [-153, -1]
].map(([z, side]) => {
  // Out from the middle to the wall's foot
  const cx = valleyX(z);
  let x = cx;
  for (let d = 0; d < 60; d += 0.5) {
    x = cx + side * d;
    if (outside(x, z) > -0.6) break;
  }
  const yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  const inward = side;
  return { mouth: new THREE.Vector3(x - side * 1.2, 0, z), inner: new THREE.Vector3(x + inward * 0.6, 0, z), yaw };
});

/** Where the dead explorer lies (near the den the north pack comes out of). */
export const EXPLORER = new THREE.Vector3(valleyX(-64) - 10, 0, -64);

export const OUTCROPS: { x: number; z: number; r: number; h: number }[] = [
  [121, 17, 6, 8],
  [76, -11, 7.5, 10],
  [52, 12, 6.5, 8],
  [12, -16, 6, 7],
  [-70, 13, 7, 9],
  [-142, -10, 7, 10],
  [-128, -18, 5, 7]
].map(([z, dx, r, h]) => ({ x: valleyX(z) + dx, z, r, h }));

/** The ground with no cave cut into it: the canyon, its walls, the hills, the outcrops, the flats. */
function baseY(x: number, z: number): number {
  let h = fbm(x * 0.018, z * 0.018) * 2.6 + fbm(x * 0.07 + 30, z * 0.07) * 0.55;
  // North of the cliff, five metres up
  h += 5 * smoothstep(CLIFF_Z + 0.6, CLIFF_Z - 0.6, z + fbm(x * 0.08, 3) * 1.2);
  // Hills: rolling, walkable, kept off the places that need to be level
  const keep =
    Math.max(
      1 - smoothstep(14, 22, Math.hypot(x, z - 134.5)),
      1 - smoothstep(20, 28, Math.hypot(x - MEADOW.x, z - MEADOW.z)),
      1 - smoothstep(30, 40, Math.hypot(x - ARENA.x, z - ARENA.z)),
      1 - smoothstep(6, 12, Math.abs(z - CLIFF_Z)),
      z < 6 && z > -64 && Math.abs(x) < 36 ? 1 : 0,
      z < -140 ? 1 : 0
    );
  h += Math.max(0, fbm(x * 0.022 + 7, z * 0.022 - 3)) * 9 * (1 - keep);
  // Outcrops: steep, their tops broken
  for (const o of OUTCROPS) {
    const d = Math.hypot(x - o.x, z - o.z);
    if (d > o.r * 1.15) continue;
    const k = smoothstep(o.r * 1.1, o.r * 0.45, d + fbm(x * 0.3, z * 0.3) * 1.5);
    h += o.h * k * (0.75 + 0.5 * ridged(x * 0.25, z * 0.25));
  }
  // The canyon walls: terraced, ledges and sheer steps, broken along their crests
  const d = Math.abs(x - valleyX(z)) - halfWidth(z) + fbm(x * 0.06, z * 0.06) * 4;
  const ends = Math.max(0, z - 150) + Math.max(0, -206 - z);
  const w = Math.max(d, ends);
  if (w > 0) {
    let r = w * 2.6 + w * w * 0.12;
    const step = 3.6;
    const t = r / step;
    const f = t - Math.floor(t);
    r = (Math.floor(t) + smoothstep(0.25, 0.95, f)) * step;
    r += ridged(x * 0.06, z * 0.06) * 2.5 * smoothstep(0, 6, w);
    h += Math.min(80, r);
  }
  // Flattened: the station's pad, the meadow, the clearing, the cave's mouth
  const flat = (cx2: number, cz: number, r: number, y: number): void => {
    const k = 1 - smoothstep(r * 0.6, r, Math.hypot(x - cx2, z - cz));
    h = h + (y - h) * k;
  };
  flat(0, 134.5, 12, 0.6);
  flat(MEADOW.x, MEADOW.z, 20, 0.4);
  flat(ARENA.x, ARENA.z, 30, 5.3);
  // The hill, after the flattening: it stands at the near edge of the meadow, its foot short of the drone
  const dh = Math.hypot(x - HILL.x, z - HILL.z);
  if (dh < HILL.r) h += HILL.h * 0.5 * (1 + Math.cos((Math.PI * dh) / HILL.r));
  return h;
}

/** The ground's height at (x, z). */
export function groundY(x: number, z: number): number {
  if (inCave(x, z)) return CAVE_Y + fbm(x * 0.4, z * 0.4) * 0.06;
  let h = baseY(x, z);
  // The chasm, its pillars, and the ledge beyond it (the canyon's walls still rise either side)
  if (z < CHASM.z1 + 0.01) {
    const wall = Math.abs(x - valleyX(z)) - halfWidth(z) + fbm(x * 0.06, z * 0.06) * 4 > 0;
    if (z <= CHASM.z0) return Math.max(h, LEDGE_Y + fbm(x * 0.3, z * 0.3) * 0.12);
    for (const p of PILLARS) if (Math.hypot(x - p.x, z - p.z) < p.r) return p.y + 0.07;
    if (!wall) return CHASM.floor + fbm(x * 0.1, z * 0.1) * 3;
    return h;
  }
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

export function pondLevel(p: { x: number; z: number; r: number }): number {
  return pondBase(p) - 0.3;
}

// ================================================================ triplanar

/**
 * Texture by world position, not UVs: three projections blended by the
 * surface's facing, so a cliff gets the texture at its proper scale instead
 * of stretched down it, and nothing needs UVs. Its bump map too.
 */
export function triplanar<M extends THREE.MeshStandardMaterial>(mat: M, scale: number, bumpScale = 1): M {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tpScale = { value: scale };
    sh.uniforms.tpBump = { value: bumpScale };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNrm;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vTpPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vTpNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vTpPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTpNrm = normalize(mat3(modelMatrix) * objectNormal);
        #endif`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTpPos;
        varying vec3 vTpNrm;
        uniform float tpScale;
        uniform float tpBump;
        vec4 tpSample(sampler2D t, float s) {
          vec3 w = pow(abs(normalize(vTpNrm)), vec3(4.0));
          w /= (w.x + w.y + w.z);
          vec3 p = vTpPos * s;
          return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
        }`
      )
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor *= tpSample(map, tpScale);\n#endif')
      .replace(
        '#include <bumpmap_pars_fragment>',
        `#ifdef USE_BUMPMAP
          uniform sampler2D bumpMap;
          uniform float bumpScale;
          vec2 dHdxy_fwd() {
            float h = bumpScale * tpSample(bumpMap, tpScale * tpBump).x;
            return vec2(dFdx(h), dFdy(h));
          }
          vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
            vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
            vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
            vec3 vN = surf_norm;
            vec3 R1 = cross( vSigmaY, vN );
            vec3 R2 = cross( vN, vSigmaX );
            float fDet = dot( vSigmaX, R1 ) * faceDirection;
            vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
            return normalize( abs( fDet ) * surf_norm - vGrad );
          }
        #endif`
      );
  };
  mat.customProgramCacheKey = () => `tp${scale}_${bumpScale}`;
  return mat;
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

/** Value noise that wraps every `P` cells: a texture made from it tiles with no seam. */
function periodicNoise(x: number, y: number, P: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const m = (a: number): number => ((a % P) + P) % P;
  const a = hash(m(xi), m(yi));
  const b = hash(m(xi + 1), m(yi));
  const c = hash(m(xi), m(yi + 1));
  const d = hash(m(xi + 1), m(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function periodicFbm(x: number, y: number, P: number, oct = 5): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += periodicNoise(x * f, y * f, P * f) * amp;
    f *= 2;
    amp *= 0.5;
  }
  return s;
}

/** Rock: seamless, strata and grain and lichen-ish blotches — a height map of it for its bump. */
function rockPixels(S: number): Float32Array {
  const out = new Float32Array(S * S);
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const u = (i / S) * 8;
      const v = (j / S) * 8;
      const big = periodicFbm(u, v, 8);
      const strata = Math.sin((j / S) * Math.PI * 2 * 6 + big * 5) * 0.5 + 0.5;
      const grain = periodicFbm(u * 4, v * 4, 32, 3);
      out[j * S + i] = big * 0.55 + strata * 0.2 + grain * 0.3;
    }
  return out;
}
let rockPx: Float32Array | null = null;
function rockTexture(): THREE.CanvasTexture {
  const S = 256;
  rockPx ??= rockPixels(S);
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  for (let k = 0; k < S * S; k++) {
    const h = rockPx[k];
    const v = 70 + h * 120;
    img.data[k * 4] = v * 1.02;
    img.data[k * 4 + 1] = v * 0.97;
    img.data[k * 4 + 2] = v * 0.86;
    img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
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
  trunks: TreeTrunk[];
  water: THREE.ShaderMaterial;
  bubbleSpots: { x: number; z: number; y: number; r: number }[];
  sky: THREE.ShaderMaterial;
  planets: THREE.Object3D[];
  terrain: THREE.Mesh;
  mapCanvas: HTMLCanvasElement;
  mapBounds: { x0: number; x1: number; z0: number; z1: number };
  specimens: THREE.Object3D[];
  /** The forest's instanced chunks: near and far versions, for showing by distance. */
  chunks: { mesh: THREE.InstancedMesh; lod: 'near' | 'far' | 'any' }[];
  /** Where the maws lie in wait. */
  trapSpots: THREE.Vector3[];
  /** The dead explorer's note, on the ground by his hand; and where his cologne lies. */
  note: { at: THREE.Vector3; obj: THREE.Object3D; cologne: THREE.Vector3 };
  /** Trees standing round the big one's clearing, on their own (not instanced): it can rip them up. */
  arenaTrees: { group: THREE.Group; x: number; z: number }[];
  /** The low fog lying along the canyon floor (its clock, and the colour it's tinted). */
  groundFog: THREE.ShaderMaterial;
  /** At the cave's mouth: shut till he has what the big one carried. */
  caveGate: Collider;
  /** The cave's rock: only drawn once he's near the north end. */
  /** Glowing things (fungus, bulbs, crystals) whose light pulses. */
  glowMats: THREE.MeshStandardMaterial[];
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
  private chunks: Level16Data['chunks'] = [];
  private glowMats: THREE.MeshStandardMaterial[] = [];
  private traps: THREE.Vector3[] = [];
  private caveGate: Collider | null = null;
  private arenaTrees: Level16Data['arenaTrees'] = [];

  build(): Level16Data {
    const rt = rockTexture();
    this.rockMat = triplanar(new THREE.MeshStandardMaterial({ map: rt, bumpMap: rockBump(), bumpScale: 2.5, color: 0xb8b0a4, roughness: 0.9 }), 0.22, 1.0);
    this.traps = this.trapSpots();
    const terrain = this.buildTerrain();
    const water = this.buildWater();
    this.buildMassif();
    this.buildRocks();
    this.buildForest();
    const sky = this.buildSky();
    const door = this.buildStation();
    const tablet = this.buildDrone();
    const portal = this.buildCaveMouth();
    this.buildChasm();
    this.buildDens();
    const note = this.buildExplorer();
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
      mapBounds: { x0: -70, x1: 70, z0: -212, z1: 150 },
      specimens: this.specimens,
      chunks: this.chunks,
      trapSpots: this.traps,
      note,
      caveGate: this.caveGate!,
      arenaTrees: this.arenaTrees,
      groundFog: this.buildGroundFog(),
      glowMats: this.glowMats
    };
  }

  /**
   * Instances, in chunks 40 m long and half the canyon wide, each with its
   * own bounds: what's behind him or off to the side isn't drawn, and the
   * scene picks near or far versions by distance.
   */
  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], items: Inst[], lod: 'near' | 'far' | 'any' = 'any'): void {
    const bands = new Map<string, Inst[]>();
    for (const it of items) {
      const e = it.m.elements;
      const k = `${Math.floor(e[14] / 60)}`;
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
      this.chunks.push({ mesh: im, lod });
    }
  }

  private collide(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider {
    const c: Collider = { box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)) };
    this.colliders.push(c);
    return c;
  }

  /** Where the maws lie: on the way, in among the trees and in the open, none where he has to stand still. */
  private trapSpots(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const zs = [118, 104, 84, 70, 58, 46, 40, 22, 16, -66, -78, -90, -122, -134];
    zs.forEach((z, i) => {
      const x = valleyX(z) + (hash(i, 9) - 0.5) * 16;
      if (Math.hypot(x - MEADOW.x, z - MEADOW.z) < 14 || Math.hypot(x, z - 134) < 14) return;
      if (Math.hypot(x - HILL.x, z - HILL.z) < HILL.r + 2) return;
      if (DENS.some((d) => Math.hypot(d.mouth.x - x, d.mouth.z - z) < 6)) return;
      if (OUTCROPS.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 2)) return;
      if (PONDS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 2)) return;
      out.push(new THREE.Vector3(x, groundY(x, z), z));
    });
    return out;
  }

  // ------------------------------------------------------------- terrain

  private buildTerrain(): THREE.Mesh {
    const X0 = -150;
    const X1 = 150;
    const Z0 = -232;
    const Z1 = 165;
    const step = 1.25;
    const nx = Math.round((X1 - X0) / step);
    const nz = Math.round((Z1 - Z0) / step);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
    const col = new Float32Array((nx + 1) * (nz + 1) * 3);
    const heights: number[] = [];
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) heights.push(groundY(X0 + i * step, Z0 + j * step));
    const H = (i: number, j: number): number => heights[Math.min(nz, Math.max(0, j)) * (nx + 1) + Math.min(nx, Math.max(0, i))];
    const sponge = new THREE.Color(0xe2dcb0);
    const moss = new THREE.Color(0x8aa858);
    const rock = new THREE.Color(0x7a7268);
    const rockDark = new THREE.Color(0x4a4440);
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
        // Moss in the hollows, bare rock where it's steep (and darker up the walls), stained green under water
        const slope = Math.hypot(H(i + 1, j) - H(i - 1, j), H(i, j + 1) - H(i, j - 1)) / (2 * step);
        const m = Math.max(0, Math.min(1, 0.5 + fbm(x * 0.05, z * 0.05) * 1.4));
        c.copy(sponge).lerp(moss, m * 0.6);
        c.lerp(rock, smoothstep(0.35, 1.5, slope + fbm(x * 0.15, z * 0.15) * 0.45));
        c.lerp(rockDark, smoothstep(2, 14, outside(x, z)) * 0.7);
        if (y < WATER_Y - 0.3 && inLake(x, z)) c.lerp(bed, 0.8);
        if (y < 0 && z < CHASM.z1 && z > CHASM.z0) c.lerp(rockDark, 0.7);
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
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = triplanar(new THREE.MeshStandardMaterial({ map: spongeTexture(), bumpMap: spongeBump(), bumpScale: 1.6, vertexColors: true, roughness: 0.95 }), 0.17, 1.7);
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
   * The cliff across the canyon: broken rock over the steep part of the
   * ground, strata running sideways, ledges, overhangs, slabs fallen away.
   * Only to look at: the ground's own slope is what stops him.
   */
  private buildCliffFace(): void {
    const pos: number[] = [];
    const idx: number[] = [];
    const X0 = -70;
    const X1 = 80;
    const nx = Math.round((X1 - X0) / 0.5);
    const ny = 16;
    for (let i = 0; i <= nx; i++) {
      const x = X0 + (i / nx) * (X1 - X0);
      const zc = CLIFF_Z - fbm(x * 0.08, 3) * 1.2;
      const bot = groundY(x, zc + 1.6) - 0.7;
      const top = groundY(x, zc - 1.6) + 0.15;
      for (let j = 0; j <= ny; j++) {
        const v = j / ny;
        const y = bot + (top - bot) * v;
        // Strata (ledges), blocks standing proud, cracks between them
        const strata = Math.sin(y * 2.6 + fbm(x * 0.15, 1) * 3) * 0.18;
        const block = (fbm(x * 0.3, y * 0.45) * 0.5 + (ridged(x * 0.2, y * 0.3) - 0.5) * 0.25) * 0.9;
        const crack = Math.pow(1 - Math.abs(noise(x * 0.7, 9)), 8) * -0.4;
        const lean = (v - 0.5) * -0.45;
        pos.push(x, y, zc + 0.35 + strata + block + crack + lean + (j === ny ? -0.4 : 0));
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
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.rockMat);
    this.group.add(m);
    this.shootables.push(m);
  }

  // ------------------------------------------------------------- rock

  /**
   * Broken rock: spires and slabs along the foot of the canyon walls and on
   * its terraces, jagged crags on the outcrops, a fringe along the cliff's
   * lip. Three shapes, instanced.
   */
  private buildRocks(): void {
    const shapes = [0, 1, 2].map((v) => {
      let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1.3, 3);
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      g = mergeVertices(g);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      const q = new THREE.Vector3();
      const H = 1.5 + v * 0.45;
      for (let i = 0; i < p.count; i++) {
        q.fromBufferAttribute(p, i);
        // Lumpy, with flattish faces broken off it; taller than wide, broad at the foot
        const n = 1 + fbm(q.x * 0.9 + v * 5, q.z * 0.9 + q.y * 0.7) * 0.35 + (ridged(q.x * 1.6 + v, q.y * 1.6 + q.z) - 0.5) * 0.12;
        q.multiplyScalar(n);
        const foot = 1 + Math.max(0, -q.y) * 0.25;
        q.x *= foot;
        q.z *= foot * (0.75 + v * 0.1);
        q.y = q.y * H + 1.3 * H * 0.75;
        q.x += Math.max(0, q.y) * 0.08 * (v - 1);
        p.setXYZ(i, q.x, q.y, q.z);
      }
      g.computeVertexNormals();
      return g;
    });
    const items: Inst[][] = [[], [], []];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const put = (x: number, z: number, s: number, tilt = 0.25): void => {
      const y = groundY(x, z);
      q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * tilt, Math.random() * 6.28, (Math.random() - 0.5) * tilt));
      m4.compose(new THREE.Vector3(x, y - 0.3 * s, z), q, new THREE.Vector3(s, s * (0.7 + Math.random() * 0.8), s));
      items[Math.floor(Math.random() * 3)].push({ m: m4.clone() });
      this.trunks.push({ x, z, r: 0.9 * s, h: 4 * s });
    };
    // Along the walls, both sides, at the foot and up the terraces
    for (let z = -158; z < 148; z += 2.2 + Math.random() * 2.5) {
      for (const side of [-1, 1]) {
        if (z < MASSIF.z1 + 4 && z > MASSIF.z0 - 6) continue;
        const cx = valleyX(z);
        const hw = halfWidth(z);
        for (let k = 0; k < (Math.random() < 0.5 ? 1 : 2); k++) {
          const off = hw + 0.5 + Math.random() * (k ? 14 : 4);
          const x = cx + side * off;
          if (outside(x, z) < -1) continue;
          if (this.traps.some((t) => Math.hypot(t.x - x, t.z - z) < 3)) continue;
          put(x, z, 0.5 + Math.random() * (k ? 1.6 : 1.0));
        }
      }
    }
    // Crags on the outcrops
    for (const o of OUTCROPS)
      for (let k = 0; k < 9; k++) {
        const a = Math.random() * 6.28;
        const r = Math.random() * o.r * 0.7;
        put(o.x + Math.cos(a) * r, o.z + Math.sin(a) * r, 0.6 + Math.random() * 0.9, 0.5);
      }
    // A broken fringe along the cliff's lip
    for (let x = -50; x < 60; x += 3 + Math.random() * 4) {
      const z = CLIFF_Z - fbm(x * 0.08, 3) * 1.2 - 1.2;
      if (outside(x, z) > 2) continue;
      put(x, z, 0.35 + Math.random() * 0.45, 0.6);
    }
    shapes.forEach((g, i) => this.instanced(g, this.rockMat, items[i]));
  }

  // ------------------------------------------------------------- the forest

  /**
   * The trees: a flared, twisting trunk with roots; branches growing up and
   * out of its upper half; at the end of each, a cluster of round, lumpy
   * crowns of foliage, leafy in texture; vines hanging under them. Purple
   * and green. Four shapes, each in a near version and a far one with much
   * less in it. Then the undergrowth: fronds, leafy mounds, glowing bulbs
   * on stalks, tufts of spiky grass.
   */
  private buildForest(): void {
    const clear = (x: number, z: number): boolean => {
      if (Math.hypot(x, z - 134) < 16) return false;
      if (Math.hypot(x - HILL.x, z - HILL.z) < HILL.r * 0.9) return false;
      // The view from the station door up to the hill: nothing in the way when the pack shows itself
      {
        const ax = 0;
        const az = 130;
        const bx = HILL.x - ax;
        const bz = HILL.z - az;
        const u = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz)));
        if (Math.hypot(x - ax - bx * u, z - az - bz * u) < 8) return false;
      }
      if (DENS.some((d) => Math.hypot(d.mouth.x - x, d.mouth.z - z) < 5)) return false;
      if (Math.hypot(x - EXPLORER.x, z - EXPLORER.z) < 3) return false;
      if (Math.hypot(x - MEADOW.x, z - MEADOW.z) < 21) return false;
      if (Math.hypot(x - ARENA.x, z - ARENA.z) < 31) return false;
      // (a clear strip along the foot of the cliff, so it can be seen and got at)
      if (z > CLIFF_Z - 3.5 && z < CLIFF_Z + 9) return false;
      if (this.traps.some((t) => Math.hypot(t.x - x, t.z - z) < 2.6)) return false;
      if (z < MASSIF.z1 + 4 && z > MASSIF.z0 - 4 && Math.abs(x) < 42) return false;
      if (x > POOL_B.x0 - 4 && x < POOL_B.x1 + 4 && z > POOL_B.z0 - 6 && z < POOL_B.z1) return false;
      if (x > POOL_A.x0 - 3 && x < POOL_A.x1 + 3 && z > POOL_A.z0 && z < POOL_A.z1 + 3) return false;
      if (z < -142) return false;
      for (const p of PONDS) if (Math.hypot(x - p.x, z - p.z) < p.r + 2) return false;
      for (const o of OUTCROPS) if (Math.hypot(x - o.x, z - o.z) < o.r * 0.9) return false;
      if (outside(x, z) > 1) return false;
      return true;
    };
    const leaf = leafTexture();
    const barkT = barkTexture();
    const bark = triplanar(new THREE.MeshStandardMaterial({ map: barkT, color: 0x6a5a58, roughness: 0.85, bumpMap: barkT, bumpScale: 1.5 }), 1.6, 1);
    const foliage = triplanar(new THREE.MeshStandardMaterial({ map: leaf, color: 0xffffff, roughness: 0.75, bumpMap: leaf, bumpScale: 2 }), 1.1, 1);
    const vineMat = new THREE.MeshStandardMaterial({ color: 0x5a3a5a, roughness: 0.6 });
    // ---- Four tree shapes
    const shapes = [0, 1, 2, 3].map((v) => buildTree(v));
    // ---- Round the clearing: trees standing on their own, for the big one to tear up
    {
      const fP = triplanar(new THREE.MeshStandardMaterial({ map: leaf, bumpMap: leaf, bumpScale: 2, color: 0x7e3aa0, roughness: 0.75 }), 1.1, 1);
      const fG = triplanar(new THREE.MeshStandardMaterial({ map: leaf, bumpMap: leaf, bumpScale: 2, color: 0x3c6e2c, roughness: 0.8 }), 1.1, 1);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.5;
        const r = 24 + (k % 2) * 3;
        const x = ARENA.x + Math.cos(a) * r;
        const z = ARENA.z + Math.sin(a) * r;
        const sh = shapes[k % 4];
        const g = new THREE.Group();
        g.add(new THREE.Mesh(sh.near.wood, bark), new THREE.Mesh(sh.near.leaves, k % 2 ? fG : fP), new THREE.Mesh(sh.near.vines, vineMat));
        g.position.set(x, groundY(x, z) - 0.15, z);
        g.rotation.y = k * 1.3;
        g.scale.setScalar(1.15);
        this.group.add(g);
        this.arenaTrees.push({ group: g, x, z });
      }
    }
    // ---- Placement
    const spots: { x: number; z: number; s: number; ry: number; p: boolean; v: number }[] = [];
    for (let k = 0; k < 9000 && spots.length < 1000; k++) {
      const z = -160 + Math.random() * 310;
      const x = valleyX(z) + (Math.random() - 0.5) * 2 * (halfWidth(z) + 4);
      if (!clear(x, z)) continue;
      if (fbm(x * 0.03, z * 0.03) < -0.22) continue;
      if (spots.some((s) => Math.abs(s.x - x) < 2.8 && Math.abs(s.z - z) < 2.8)) continue;
      spots.push({ x, z, s: 0.8 + Math.random() * 0.7, ry: Math.random() * 6.28, p: Math.random() < 0.58, v: Math.floor(Math.random() * 4) });
    }
    const q = new THREE.Quaternion();
    const by: { trunk: Inst[]; purple: Inst[]; green: Inst[] }[] = shapes.map(() => ({ trunk: [], purple: [], green: [] }));
    for (const s of spots) {
      const y = groundY(s.x, s.z) - 0.15;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, y, s.z), q, new THREE.Vector3(s.s, s.s * (0.9 + Math.random() * 0.3), s.s));
      const c = new THREE.Color().setHSL(s.p ? 0.79 + Math.random() * 0.07 : 0.27 + Math.random() * 0.07, 0.5 + Math.random() * 0.25, s.p ? 0.4 + Math.random() * 0.12 : 0.3 + Math.random() * 0.1);
      by[s.v].trunk.push({ m });
      (s.p ? by[s.v].purple : by[s.v].green).push({ m, c });
      this.trunks.push({ x: s.x, z: s.z, r: 0.34 * s.s, h: 4.5 * s.s });
    }
    shapes.forEach((sh, v) => {
      this.instanced(sh.near.wood, bark, by[v].trunk, 'near');
      this.instanced(sh.near.leaves, foliage, by[v].purple, 'near');
      this.instanced(sh.near.leaves, foliage, by[v].green, 'near');
      this.instanced(sh.near.vines, vineMat, by[v].trunk, 'near');
      this.instanced(sh.far.wood, bark, by[v].trunk, 'far');
      this.instanced(sh.far.leaves, foliage, by[v].purple, 'far');
      this.instanced(sh.far.leaves, foliage, by[v].green, 'far');
    });
    // ---- Undergrowth
    const frondMat = new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7, color: 0xffffff });
    const fern = fernGeometry();
    const mound = moundGeometry();
    const tuft = tuftGeometry();
    const stalk = bulbStalk();
    const bulbCyan = new THREE.MeshStandardMaterial({ color: 0x0a2a30, emissive: 0x40f0ff, emissiveIntensity: 1.6, roughness: 0.3 });
    const bulbPink = new THREE.MeshStandardMaterial({ color: 0x300a2a, emissive: 0xff40c8, emissiveIntensity: 1.4, roughness: 0.3 });
    this.glowMats.push(bulbCyan, bulbPink);
    const stalkMat = new THREE.MeshStandardMaterial({ color: 0x2a3a2a, roughness: 0.7 });
    const tuftMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide });
    const ferns: Inst[] = [];
    const mounds: Inst[] = [];
    const tufts: Inst[] = [];
    const bulbsA: Inst[] = [];
    const bulbsB: Inst[] = [];
    const m4 = new THREE.Matrix4();
    const at = (x: number, z: number, s: number, sink = 0.05): THREE.Matrix4 =>
      m4.compose(new THREE.Vector3(x, groundY(x, z) - sink, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28), new THREE.Vector3(s, s * (0.8 + Math.random() * 0.4), s)).clone();
    const scatter = (n: number, f: (x: number, z: number) => void, nearTrees = 0): void => {
      for (let k = 0; k < n * 4 && n > 0; k++) {
        let x: number;
        let z: number;
        if (nearTrees && Math.random() < nearTrees && spots.length) {
          const s = spots[Math.floor(Math.random() * spots.length)];
          const a = Math.random() * 6.28;
          const r = 1 + Math.random() * 3;
          x = s.x + Math.cos(a) * r;
          z = s.z + Math.sin(a) * r;
        } else {
          z = -160 + Math.random() * 310;
          x = valleyX(z) + (Math.random() - 0.5) * 2 * (halfWidth(z) + 3);
        }
        if (!clear(x, z) && !(Math.hypot(x - MEADOW.x, z - MEADOW.z) > 15 && Math.hypot(x - MEADOW.x, z - MEADOW.z) < 21)) continue;
        f(x, z);
        n--;
      }
    };
    scatter(1500, (x, z) => ferns.push({ m: at(x, z, 0.7 + Math.random() * 0.8), c: new THREE.Color().setHSL(Math.random() < 0.55 ? 0.8 + Math.random() * 0.05 : 0.3 + Math.random() * 0.05, 0.6, 0.38 + Math.random() * 0.1) }), 0.6);
    scatter(900, (x, z) => mounds.push({ m: at(x, z, 0.5 + Math.random() * 0.8, 0.1), c: new THREE.Color().setHSL(Math.random() < 0.6 ? 0.8 : 0.3, 0.55, 0.3 + Math.random() * 0.1) }), 0.5);
    scatter(2000, (x, z) => tufts.push({ m: at(x, z, 0.6 + Math.random() * 0.7, 0.02), c: new THREE.Color().setHSL(Math.random() < 0.5 ? 0.82 : 0.28, 0.45, 0.32 + Math.random() * 0.12) }));
    scatter(420, (x, z) => (Math.random() < 0.5 ? bulbsA : bulbsB).push({ m: at(x, z, 0.7 + Math.random() * 0.7, 0) }), 0.4);
    // Round every bit of water, tufts and fronds
    for (const p of PONDS)
      for (let k = 0; k < 26; k++) {
        const a = Math.random() * 6.28;
        const r = p.r + (Math.random() - 0.3) * 2.2;
        tufts.push({ m: at(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, 0.7 + Math.random() * 0.6, 0.02), c: new THREE.Color().setHSL(0.3, 0.5, 0.3) });
      }
    this.instanced(fern, frondMat, ferns, 'near');
    this.instanced(mound, foliage, mounds, 'any');
    this.instanced(tuft, tuftMat, tufts, 'near');
    this.instanced(stalk.stalk, stalkMat, bulbsA.concat(bulbsB), 'any');
    this.instanced(stalk.bulbs, bulbCyan, bulbsA, 'any');
    this.instanced(stalk.bulbs, bulbPink, bulbsB, 'any');
    // ---- On the ground: pebbles and stones, old bones, clusters of glowing fungus caps
    {
      const pebble = new THREE.DodecahedronGeometry(0.12, 0);
      const pebbles: Inst[] = [];
      const bones: Inst[] = [];
      const caps: Inst[] = [];
      for (let k = 0; k < 4000; k++) {
        const z = -160 + Math.random() * 310;
        const x = valleyX(z) + (Math.random() - 0.5) * 2 * (halfWidth(z) + 2);
        if (inLake(x, z) || outside(x, z) > 1 || Math.hypot(x, z - 134.5) < 9) continue;
        const y = groundY(x, z);
        const s = 0.4 + Math.pow(Math.random(), 2) * 2.2;
        pebbles.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.02 * s, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3)), new THREE.Vector3(s, s * 0.6, s * (0.7 + Math.random() * 0.5))) });
        if (k % 14 === 0) {
          const b = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, y + 0.03, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + (Math.random() - 0.5) * 0.3, 0, Math.random() * 6.28)), new THREE.Vector3(1, 0.6 + Math.random() * 0.8, 1));
          bones.push({ m: b });
        }
        if (k % 9 === 0 && clear(x, z)) {
          for (let c = 0; c < 4; c++) {
            const cx = x + (Math.random() - 0.5) * 0.5;
            const cz = z + (Math.random() - 0.5) * 0.5;
            const cs = 0.5 + Math.random() * 0.9;
            caps.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(cx, groundY(cx, cz), cz), new THREE.Quaternion(), new THREE.Vector3(cs, cs, cs)) });
          }
        }
      }
      this.instanced(pebble, this.rockMat, pebbles, 'near');
      const bone = new THREE.CapsuleGeometry(0.03, 0.35, 3, 8);
      const boneMat = new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.6 });
      this.instanced(bone, boneMat, bones, 'near');
      // A fungus cap: a stem and a domed cap that glows underneath
      const stem = new THREE.CylinderGeometry(0.012, 0.018, 0.12, 6);
      stem.translate(0, 0.06, 0);
      const cap = new THREE.SphereGeometry(0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.scale(1, 0.6, 1);
      cap.translate(0, 0.12, 0);
      const fungus = mergeGeometries([stem.toNonIndexed(), cap.toNonIndexed()].map((g) => {
        g.deleteAttribute('uv');
        return g;
      }), false)!;
      const capMat = new THREE.MeshStandardMaterial({ color: 0x302040, emissive: 0x9a50ff, emissiveIntensity: 1.2, roughness: 0.5 });
      this.glowMats.push(capMat);
      this.instanced(fungus, capMat, caps, 'near');
    }
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
    {
      const gc = makeCanvas(256, 256);
      const gg = gc.getContext('2d')!;
      gg.fillStyle = '#2a2f34';
      gg.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 256; i += 16) {
        gg.fillStyle = 'rgba(0,0,0,0.55)';
        gg.fillRect(i, 0, 3, 256);
        gg.fillRect(0, i, 256, 3);
        gg.fillStyle = 'rgba(160,170,180,0.18)';
        gg.fillRect(i + 3, 0, 1, 256);
      }
      for (let k = 0; k < 400; k++) {
        gg.fillStyle = `rgba(${120 + Math.random() * 60},${110 + Math.random() * 40},90,0.12)`;
        gg.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 1 + Math.random() * 2);
      }
      const gt = new THREE.CanvasTexture(gc);
      gt.wrapS = gt.wrapT = THREE.RepeatWrapping;
      gt.repeat.set(4, 3.5);
      gt.colorSpace = THREE.SRGBColorSpace;
      box(x1 - x0, 0.1, z1 - z0, 0, -0.03, (z0 + z1) / 2, new THREE.MeshStandardMaterial({ map: gt, roughness: 0.55, metalness: 0.6 }));
    }
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
    this.stationDetail(g, { dark, steel, yellow, wallMat });
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

  /**
   * The dens: a hole in the foot of the wall, a ragged arch of rock round it,
   * black inside; gnawed bones strewn in front, the ground there churned.
   */
  private buildDens(): void {
    const dark = new THREE.MeshBasicMaterial({ color: 0x020103, side: THREE.BackSide });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xd2c8ac, roughness: 0.6 });
    for (const d of DENS) {
      const g = new THREE.Group();
      const y = groundY(d.mouth.x, d.mouth.z);
      g.position.set(d.mouth.x, y - 0.3, d.mouth.z);
      g.rotation.y = d.yaw;
      this.group.add(g);
      // Into the wall is local −Z
      const arch = new THREE.TorusGeometry(1.9, 0.75, 12, 30, Math.PI);
      const ap = arch.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < ap.count; i++) {
        const x = ap.getX(i);
        const yy = ap.getY(i);
        const z = ap.getZ(i);
        const k = 1 + (ridged(x * 0.7 + d.mouth.z, yy * 0.7 + z) - 0.45) * 0.7;
        ap.setXYZ(i, x * (0.95 + 0.08 * k), yy * k, z * k * 1.5);
      }
      arch.deleteAttribute('uv');
      arch.computeVertexNormals();
      const am = new THREE.Mesh(arch, this.rockMat);
      am.scale.set(1, 1.15, 1);
      g.add(am);
      this.shootables.push(am);
      const hole = new THREE.Mesh(new THREE.SphereGeometry(1.75, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), dark);
      hole.rotation.x = -Math.PI / 2;
      hole.scale.set(1, 1.4, 1.15);
      hole.position.set(0, 0.2, -0.3);
      g.add(hole);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), new THREE.MeshBasicMaterial({ color: 0x030204 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, 0.32, -1.0);
      floor.scale.set(1, 1.6, 1);
      g.add(floor);
      for (let k = 0; k < 9; k++) {
        const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.3 + Math.random() * 0.3, 3, 8), boneMat);
        const bx = (Math.random() - 0.5) * 3;
        const bz = 0.6 + Math.random() * 2.2;
        const wp = new THREE.Vector3(bx, 0, bz).applyAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw).add(d.mouth);
        b.position.set(bx, groundY(wp.x, wp.z) - y + 0.33, bz);
        b.rotation.set(Math.PI / 2, Math.random() * 3, Math.random() * 3);
        g.add(b);
      }
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), boneMat);
      skull.scale.set(1, 0.8, 1.3);
      skull.position.set(0.6, 0.42, 1.0);
      g.add(skull);
      // Not a way in for him: a block just inside the arch
      const inside = d.mouth.clone().add(new THREE.Vector3(0, 0, -0.9).applyAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw));
      this.collide(inside.x - 1.4, y - 1, inside.z - 1.4, inside.x + 1.4, y + 3.5, inside.z + 1.4);
    }
  }

  /**
   * Someone who came through before him: a body in a suit like his, on its
   * back on the sponge, the visor cracked, dried blood under it, things from
   * its pack scattered — and a sheet of paper by its hand.
   */
  private buildExplorer(): Level16Data['note'] {
    const x = EXPLORER.x;
    const z = EXPLORER.z;
    const y = groundY(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = 0.9;
    this.group.add(g);
    const body = suitModel([]);
    // On his back, one knee up a little, rolled slightly
    body.rotation.set(-Math.PI / 2 + 0.06, 0, 0.12);
    body.position.set(0, 0.16, 0.9);
    g.add(body);
    body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.shootables.push(o);
    });
    // Dried blood under him, dark and spread
    const stain = new THREE.Mesh(new THREE.CircleGeometry(1.2, 24), new THREE.MeshStandardMaterial({ color: 0x2a0606, roughness: 0.4, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    stain.rotation.x = -Math.PI / 2;
    stain.position.set(0.1, 0.04, 0.2);
    stain.scale.set(1, 1.5, 1);
    g.add(stain);
    // Things from his pack: a torch, a canteen, a cracked tablet, a flare burnt out
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.4 });
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5 }));
    torch.rotation.set(Math.PI / 2, 0, 0.7);
    torch.position.set(0.8, 0.05, -0.2);
    const canteen = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 16), dark);
    canteen.rotation.set(Math.PI / 2, 0, -0.4);
    canteen.position.set(-0.7, 0.07, 0.6);
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8), new THREE.MeshStandardMaterial({ color: 0x8a1a10, roughness: 0.7 }));
    flare.rotation.set(Math.PI / 2, 0, 1.4);
    flare.position.set(0.3, 0.03, 1.9);
    g.add(torch, canteen, flare);
    // The note: a sheet of paper, weighted with a stone
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.29), new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.9, side: THREE.DoubleSide }));
    paper.rotation.set(-Math.PI / 2, 0, 0.4);
    paper.position.set(0.65, 0.05, 0.55);
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 0), this.rockMat);
    stone.position.set(0.7, 0.08, 0.5);
    g.add(paper, stone);
    g.updateMatrixWorld(true);
    return { at: paper.getWorldPosition(new THREE.Vector3()), obj: paper, cologne: new THREE.Vector3(-0.55, 0.04, -0.15).applyMatrix4(g.matrixWorld) };
  }

  /**
   * The rest of the station: a locker with a spare helmet, a folding cot, a
   * desk with a laptop, papers and a mug, a whiteboard of sketches of the
   * things outside, the canyon map pinned up, cable trays and conduit along
   * the ceiling, a vent, a first-aid box, signs.
   */
  private stationDetail(g: THREE.Group, M: { dark: THREE.Material; steel: THREE.Material; yellow: THREE.Material; wallMat: THREE.Material }): void {
    const { x0, x1, z0, z1, h } = BUILDING;
    const fy = g.position.y;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.rotation.y = ry;
      g.add(o);
      return o;
    };
    const canvasMat = (w: number, hh: number, draw: (c: CanvasRenderingContext2D) => void, basic = false): THREE.Material => {
      const c = makeCanvas(w, hh);
      draw(c.getContext('2d')!);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return basic ? new THREE.MeshBasicMaterial({ map: t, toneMapped: false }) : new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
    };
    // ---- Locker in the north-west corner, a helmet on top
    const lockerM = new THREE.MeshStandardMaterial({ color: 0x4a5a6a, roughness: 0.5, metalness: 0.5 });
    add(new THREE.BoxGeometry(0.6, 1.9, 0.5), lockerM, x0 + 0.42, 0.95, z0 + 0.38);
    for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.4, 0.015, 0.01), M.dark, x0 + 0.42, 1.55 + k * 0.04, z0 + 0.635);
    add(new THREE.BoxGeometry(0.02, 0.18, 0.03), M.steel, x0 + 0.66, 1.0, z0 + 0.64);
    const helm = add(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshStandardMaterial({ color: 0xc0c4c8, roughness: 0.35, metalness: 0.3 }), x0 + 0.42, 2.06, z0 + 0.38);
    helm.scale.set(1, 1.1, 1.05);
    const vis = add(new THREE.SphereGeometry(0.13, 20, 10, -0.9, 1.8, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0xd99a22, roughness: 0.1, metalness: 1 }), x0 + 0.42, 2.05, z0 + 0.42);
    vis.rotation.y = 0;
    this.collide(x0, fy, z0, x0 + 0.75, fy + 1.9, z0 + 0.65);
    // ---- A folding cot on the west side, a rumpled blanket on it
    const cotX = -2.15;
    const cotZ = 134.3;
    add(new THREE.BoxGeometry(0.72, 0.05, 1.85), new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.9 }), cotX, 0.42, cotZ);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 6), M.steel, cotX + sx * 0.33, 0.21, cotZ + sz * 0.85);
    const blanket = new THREE.PlaneGeometry(0.76, 1.1, 10, 12);
    blanket.rotateX(-Math.PI / 2);
    const bp = blanket.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) bp.setY(i, Math.max(0, Math.sin(bp.getX(i) * 9 + bp.getZ(i) * 5) * 0.03 + Math.cos(bp.getZ(i) * 7) * 0.025) + 0.01);
    blanket.computeVertexNormals();
    add(blanket, new THREE.MeshStandardMaterial({ color: 0x8a4a2a, roughness: 0.95, side: THREE.DoubleSide }), cotX, 0.45, cotZ + 0.3);
    add(new THREE.BoxGeometry(0.5, 0.1, 0.32), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.95 }), cotX, 0.5, cotZ - 0.7);
    this.collide(cotX - 0.36, fy, cotZ - 0.93, cotX + 0.36, fy + 0.45, cotZ + 0.93);
    // ---- A desk on the east side: laptop, papers, a mug, a lamp
    const dx = 2.05;
    const dz = 135.4;
    add(new THREE.BoxGeometry(1.2, 0.04, 0.62), new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.6 }), dx, 0.76, dz);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.74, 0.58), M.dark, dx + sx * 0.56, 0.37, dz);
    this.collide(dx - 0.6, fy, dz - 0.31, dx + 0.6, fy + 0.78, dz + 0.31);
    add(new THREE.BoxGeometry(0.34, 0.015, 0.24), M.dark, dx - 0.15, 0.79, dz + 0.05);
    const lid = add(new THREE.BoxGeometry(0.34, 0.22, 0.012), M.dark, dx - 0.15, 0.9, dz - 0.07);
    lid.rotation.x = -0.25;
    const scr = add(
      new THREE.PlaneGeometry(0.31, 0.19),
      canvasMat(256, 160, (c) => {
        c.fillStyle = '#04120c';
        c.fillRect(0, 0, 256, 160);
        c.fillStyle = '#4dff8a';
        c.font = '11px monospace';
        ['SURVEY LOG 0417', 'DRONE-2 SIGNAL LOST', 'BIO-SIGNS: CANYON N', 'PACK SIZE: 6+', 'DO NOT GO OUT ALONE'].forEach((s, i) => c.fillText(s, 10, 22 + i * 18));
        c.strokeStyle = '#4dff8a';
        c.beginPath();
        for (let x = 0; x < 256; x += 3) c.lineTo(x, 135 + Math.sin(x * 0.2) * 10 * Math.sin(x * 0.03));
        c.stroke();
      }, true),
      dx - 0.15,
      0.9,
      dz - 0.063
    );
    scr.rotation.x = -0.25;
    const paperM = new THREE.MeshStandardMaterial({ color: 0xeeeae0, roughness: 0.9 });
    for (let k = 0; k < 4; k++) {
      const pp = add(new THREE.PlaneGeometry(0.21, 0.29), paperM, dx + 0.3 + (k % 2) * 0.05, 0.783 + k * 0.002, dz + 0.05 - k * 0.03);
      pp.rotation.set(-Math.PI / 2, 0, (k - 1.5) * 0.3);
    }
    const mug = add(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a6a9a, roughness: 0.4, side: THREE.DoubleSide }), dx + 0.45, 0.83, dz - 0.18);
    void mug;
    add(new THREE.CircleGeometry(0.035, 12), new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.2 }), dx + 0.45, 0.865, dz - 0.18).rotation.x = -Math.PI / 2;
    const lamp = add(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 6), M.steel, dx - 0.5, 0.95, dz + 0.2);
    lamp.rotation.z = 0.3;
    add(new THREE.ConeGeometry(0.07, 0.09, 14, 1, true), M.yellow, dx - 0.44, 1.12, dz + 0.2).rotation.z = Math.PI + 0.6;
    // ---- A whiteboard west of the door: sketches of the hounds, the big one, notes
    add(new THREE.BoxGeometry(1.5, 0.95, 0.03), M.steel, -2.4, 1.6, z0 + 0.03);
    add(
      new THREE.PlaneGeometry(1.42, 0.87),
      canvasMat(512, 312, (c) => {
        c.fillStyle = '#f2f2ee';
        c.fillRect(0, 0, 512, 312);
        c.strokeStyle = '#2244aa';
        c.lineWidth = 3;
        // A hound: a body, legs, the round mouth with teeth
        c.beginPath();
        c.ellipse(120, 120, 70, 30, 0, 0, Math.PI * 2);
        c.moveTo(70, 140);
        c.lineTo(60, 200);
        c.moveTo(95, 145);
        c.lineTo(100, 205);
        c.moveTo(150, 145);
        c.lineTo(140, 205);
        c.moveTo(175, 140);
        c.lineTo(185, 200);
        c.stroke();
        c.beginPath();
        c.arc(215, 105, 30, 0, Math.PI * 2);
        c.stroke();
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          c.beginPath();
          c.moveTo(215 + Math.cos(a) * 30, 105 + Math.sin(a) * 30);
          c.lineTo(215 + Math.cos(a) * 16, 105 + Math.sin(a) * 16);
          c.stroke();
        }
        c.fillStyle = '#cc2222';
        c.font = 'bold 22px Arial';
        c.fillText('NO EYES??', 160, 50);
        c.fillStyle = '#2244aa';
        c.font = '18px Arial';
        c.fillText('hunt in packs - 5/6', 40, 250);
        c.fillText('hear vibration?', 40, 275);
        c.fillStyle = '#cc2222';
        c.fillText('the BIG one - N. canyon', 300, 210);
        c.fillText('DO NOT approach', 300, 236);
        c.strokeStyle = '#cc2222';
        c.beginPath();
        c.ellipse(390, 120, 80, 40, 0, 0, Math.PI * 2);
        for (let k = 0; k < 6; k++) {
          c.moveTo(330 + k * 25, 150);
          c.lineTo(315 + k * 28, 190);
        }
        c.stroke();
      }),
      -2.4,
      1.6,
      z0 + 0.05
    );
    // ---- The canyon map pinned up over the bench
    add(
      new THREE.PlaneGeometry(0.5, 0.7),
      canvasMat(200, 280, (c) => {
        c.fillStyle = '#d8d0b0';
        c.fillRect(0, 0, 200, 280);
        c.strokeStyle = '#6a5a3a';
        c.lineWidth = 2;
        c.beginPath();
        for (let y = 0; y <= 280; y += 6) c.lineTo(100 + Math.sin(y * 0.03) * 40 - 25, y);
        c.stroke();
        c.beginPath();
        for (let y = 0; y <= 280; y += 6) c.lineTo(100 + Math.sin(y * 0.03) * 40 + 25, y);
        c.stroke();
        c.fillStyle = '#cc2222';
        c.font = 'bold 14px Arial';
        c.fillText('X', 92, 20);
        c.fillText('BASE', 80, 270);
        c.fillStyle = '#2a8a4a';
        c.fillRect(70, 140, 60, 18);
      }),
      1.1,
      1.55,
      z1 - 0.02,
      Math.PI
    );
    // ---- Overhead: cable trays and conduit the length of the room, a vent
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.3, 0.04, z1 - z0 - 0.2), M.steel, sx * 2.6, h - 0.15, (z0 + z1) / 2);
      for (let k = 0; k < 4; k++) {
        const cab = add(new THREE.CylinderGeometry(0.015, 0.015, z1 - z0 - 0.2, 6), new THREE.MeshStandardMaterial({ color: [0x1a1a1a, 0xaa2222, 0x2244aa, 0xd8b21c][k], roughness: 0.6 }), sx * 2.6 - 0.1 + k * 0.06, h - 0.11, (z0 + z1) / 2);
        cab.rotation.x = Math.PI / 2;
      }
    }
    const pipe = add(new THREE.CylinderGeometry(0.05, 0.05, x1 - x0 - 0.2, 10), M.steel, 0, h - 0.3, z1 - 0.3);
    pipe.rotation.z = Math.PI / 2;
    add(
      new THREE.PlaneGeometry(0.6, 0.4),
      canvasMat(120, 80, (c) => {
        c.fillStyle = '#3a4048';
        c.fillRect(0, 0, 120, 80);
        c.fillStyle = '#101418';
        for (let y = 8; y < 76; y += 9) c.fillRect(8, y, 104, 5);
      }),
      1.6,
      h - 0.005,
      133
    ).rotation.x = Math.PI / 2;
    // ---- A first-aid box and signs by the door
    add(new THREE.BoxGeometry(0.34, 0.26, 0.1), new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.5 }), x1 - 0.3, 1.5, z0 + 0.06);
    add(new THREE.BoxGeometry(0.06, 0.18, 0.01), new THREE.MeshStandardMaterial({ color: 0xcc1111 }), x1 - 0.3, 1.5, z0 + 0.115);
    add(new THREE.BoxGeometry(0.18, 0.06, 0.01), new THREE.MeshStandardMaterial({ color: 0xcc1111 }), x1 - 0.3, 1.5, z0 + 0.115);
    add(
      new THREE.PlaneGeometry(0.42, 0.3),
      canvasMat(210, 150, (c) => {
        c.fillStyle = '#f2c400';
        c.fillRect(0, 0, 210, 150);
        c.fillStyle = '#111';
        c.font = 'bold 22px Arial';
        c.textAlign = 'center';
        c.fillText('WARNING', 105, 40);
        c.font = 'bold 15px Arial';
        c.fillText('HOSTILE FAUNA', 105, 75);
        c.fillText('SUIT SEALED AT', 105, 105);
        c.fillText('ALL TIMES', 105, 128);
      }),
      -0.9,
      2.0,
      z0 + 0.012
    );
  }

  // ------------------------------------------------------------- the crashed drone and its tablet

  private buildDrone(): Level16Data['tablet'] {
    const V = (a: number, b: number, c: number): THREE.Vector3 => new THREE.Vector3(a, b, c);
    const x = MEADOW.x;
    const z = MEADOW.z;
    const y = groundY(x, z);
    // Where it ended up, and the way it came in (from the +x+z side, ploughing toward −x−z)
    const dx = x + 1.6;
    const dz = z - 0.8;
    const dirX = 0.555;
    const dirZ = 0.832;
    const g = new THREE.Group();
    g.position.set(dx, groundY(dx, dz) + 0.08, dz);
    g.rotation.set(0.14, 0.6, 0.2);
    this.group.add(g);

    // ---- materials
    const decal = (() => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 128;
      const x2 = c.getContext('2d')!;
      x2.fillStyle = '#dfe3e0';
      x2.fillRect(0, 0, 256, 128);
      x2.fillStyle = '#e8641c';
      x2.fillRect(0, 74, 256, 16);
      x2.fillStyle = '#23272b';
      x2.font = 'bold 34px "Courier New", monospace';
      x2.fillText('SURVEY-07', 26, 50);
      x2.font = 'bold 14px "Courier New", monospace';
      x2.fillText('DEEP FIELD RECON  //  DO NOT TOUCH', 18, 112);
      // Scorched and scraped
      for (let i = 0; i < 26; i++) {
        x2.fillStyle = `rgba(20, 16, 12, ${0.15 + Math.random() * 0.4})`;
        x2.beginPath();
        x2.ellipse(150 + Math.random() * 110, Math.random() * 128, 6 + Math.random() * 30, 3 + Math.random() * 12, Math.random() * 3, 0, Math.PI * 2);
        x2.fill();
      }
      x2.strokeStyle = 'rgba(40,40,40,0.6)';
      x2.lineWidth = 1.5;
      for (let i = 0; i < 12; i++) {
        x2.beginPath();
        const sx = Math.random() * 256;
        x2.moveTo(sx, Math.random() * 128);
        x2.lineTo(sx + 30 + Math.random() * 40, Math.random() * 128);
        x2.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const shell = new THREE.MeshStandardMaterial({ color: 0xffffff, map: decal, roughness: 0.42, metalness: 0.25 });
    const white = new THREE.MeshStandardMaterial({ color: 0xd8dcd8, roughness: 0.42, metalness: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1e2226, roughness: 0.45, metalness: 0.6 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.35, metalness: 0.4 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xe8641c, roughness: 0.5, metalness: 0.2 });
    const glassM = new THREE.MeshStandardMaterial({ color: 0x0b1a2a, roughness: 0.05, metalness: 0.8, emissive: 0x05121e });
    const burnt = new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.9, metalness: 0.1 });
    const add = (m: THREE.Mesh, parent: THREE.Object3D = g): THREE.Mesh => {
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // ---- the fuselage: a rounded body, darker belly, a stripe round it, a sensor dome (cracked) on top
    const body = add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 18), shell));
    body.scale.set(1.35, 0.5, 0.95);
    body.position.y = 0.26;
    body.rotation.y = Math.PI / 2;
    const belly = add(new THREE.Mesh(new THREE.SphereGeometry(0.47, 28, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), dark));
    belly.scale.set(1.32, 0.42, 0.92);
    belly.position.y = 0.24;
    const stripe = add(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 8, 40), orange));
    stripe.rotation.x = Math.PI / 2;
    stripe.scale.set(1.35, 0.95, 1);
    stripe.position.y = 0.25;
    const dome = add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glassM));
    dome.position.set(0.12, 0.47, 0);
    // The crack across it, and the hole punched in the shell beside it
    const crack = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.006, 0.012), new THREE.MeshBasicMaterial({ color: 0xbfe8ff })));
    crack.position.set(0.12, 0.6, 0.02);
    crack.rotation.set(0, 0.7, 0.3);
    const hole = add(new THREE.Mesh(new THREE.CircleGeometry(0.11, 10), burnt));
    hole.position.set(-0.32, 0.45, 0.12);
    hole.rotation.set(-Math.PI / 2 + 0.4, 0, 0.3);
    // Wires hanging out of it, still sparking (the beacon is on the tail fin)
    const wireMat = [new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.6 })];
    for (let i = 0; i < 4; i++) {
      const pts = [V(-0.32, 0.45, 0.12), V(-0.36 - i * 0.03, 0.52 + i * 0.02, 0.18 + i * 0.03), V(-0.42 - i * 0.05, 0.4, 0.26 + i * 0.04)];
      add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.006, 5), wireMat[i % 2]));
    }
    // A tail fin with the beacon on it
    const fin = add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.3), white));
    fin.position.set(-0.62, 0.42, 0);
    fin.rotation.z = -0.25;
    const beacon = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff3020, emissiveIntensity: 2.5 });
    const bl = add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), beacon));
    bl.position.set(-0.66, 0.55, 0);
    // Antenna whip, bent
    const ant = add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0.4, 0.4, -0.1), V(0.48, 0.7, -0.14), V(0.62, 0.86, -0.08)]), 10, 0.008, 5), dark));
    ant.castShadow = false;

    // ---- four arms with motors, props and guards; one snapped off
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const ax = Math.cos(a);
      const az = Math.sin(a);
      const snapped = k === 1;
      const len = snapped ? 0.42 : 0.82;
      const arm = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, len, 10), carbon));
      arm.position.set(ax * (0.42 + len / 2), 0.28, az * (0.42 + len / 2));
      arm.rotation.set(0, -a, Math.PI / 2);
      if (snapped) {
        // The splintered end
        const end = add(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 6), carbon));
        end.position.set(ax * (0.42 + len + 0.03), 0.28, az * (0.42 + len + 0.03));
        end.rotation.set(0, -a, -Math.PI / 2);
        continue;
      }
      const mx = ax * 1.28;
      const mz = az * 1.28;
      const motor = add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.13, 16), dark));
      motor.position.set(mx, 0.33, mz);
      const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12), orange));
      cap.position.set(mx, 0.41, mz);
      // Two-blade prop, one of them bent down
      for (const s of [0, 1]) {
        const blade = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.008, 0.055), carbon));
        const ba = a * 1.7 + s * Math.PI;
        blade.position.set(mx + Math.cos(ba) * 0.17, 0.43, mz + Math.sin(ba) * 0.17);
        blade.rotation.set(k === 2 && s ? 0.5 : 0.08, -ba, k === 2 && s ? -0.35 : 0);
      }
      // The guard ring (squashed on the one that hit first)
      const guard = add(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.016, 6, 36), white));
      guard.rotation.x = Math.PI / 2;
      guard.position.set(mx, 0.36, mz);
      if (k === 0) guard.scale.set(1, 0.7, 1);
    }
    // ---- landing skids
    for (const s of [-1, 1]) {
      const skid = add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.45, -0.02, s * 0.38), V(0, -0.05, s * 0.4), V(0.5, 0.02, s * 0.36)]), 12, 0.022, 6), dark));
      skid.castShadow = true;
      for (const u of [-0.25, 0.25]) {
        const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 6), dark));
        leg.position.set(u, 0.08, s * 0.32);
        leg.rotation.x = s * 0.35;
      }
    }
    // ---- the camera gimbal, torn half off and hanging under the nose
    const gimbal = add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), dark));
    gimbal.position.set(0.55, 0.06, 0.12);
    const lens = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 14), glassM));
    lens.position.set(0.63, 0.04, 0.16);
    lens.rotation.z = Math.PI / 2 - 0.4;

    // ---- the furrow it ploughed: dark scorched soil, banks of churned earth both sides
    const trailLen = 17;
    const segs = 44;
    // Across the furrow: outer edge, bank top, furrow side, floor, floor, side, bank, edge
    const across = [-1.5, -1.0, -0.62, -0.2, 0.2, 0.62, 1.0, 1.5];
    const lift = [0.01, 0.32, 0.07, 0.025, 0.025, 0.07, 0.32, 0.01];
    const cols = [0x8a7c52, 0x8e6a42, 0x5c412a, 0x33251a, 0x33251a, 0x5c412a, 0x8e6a42, 0x8a7c52].map((h) => new THREE.Color(h));
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const sideX = dirZ;
    const sideZ = -dirX;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const along = 0.6 + t * trailLen;
      // Wide and deep where it came to rest, a skid mark where it first touched
      const w = 0.95 * (1 - t * 0.62) + 0.05 * Math.sin(t * 23);
      const deep = 1 - t * 0.7;
      const cxp = dx + dirX * along + Math.sin(t * 9) * 0.12 * t;
      const czp = dz + dirZ * along;
      for (let j = 0; j < across.length; j++) {
        const o = across[j] * w;
        const px = cxp + sideX * o;
        const pz = czp + sideZ * o;
        const bank = j === 1 || j === 6 ? lift[j] * deep * (0.75 + 0.5 * Math.abs(Math.sin(t * 31 + j))) : lift[j];
        pos.push(px, groundY(px, pz) + bank, pz);
        const c = cols[j].clone();
        // Fading out toward the far (first-touch) end
        c.lerp(cols[0], (j === 0 || j === 7 ? 0 : t * 0.5) + Math.random() * 0.08);
        col.push(c.r, c.g, c.b);
        uv.push(j / (across.length - 1), along / 2);
      }
    }
    const row = across.length;
    for (let i = 0; i < segs; i++)
      for (let j = 0; j < row - 1; j++) {
        const a0 = i * row + j;
        const b0 = a0 + row;
        idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
    const furrowGeo = new THREE.BufferGeometry();
    furrowGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    furrowGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    furrowGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    furrowGeo.setIndex(idx);
    furrowGeo.computeVertexNormals();
    // Grain in the soil: clods and streaks along the line of travel
    const soil = (() => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const x2 = c.getContext('2d')!;
      x2.fillStyle = '#c8c8c8';
      x2.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 900; i++) {
        const v = 120 + Math.floor(Math.random() * 120);
        x2.fillStyle = `rgb(${v},${v},${v})`;
        x2.fillRect(Math.random() * 128, Math.random() * 256, 1 + Math.random() * 3, 2 + Math.random() * 9);
      }
      x2.strokeStyle = 'rgba(40,40,40,0.5)';
      for (let i = 0; i < 26; i++) {
        x2.lineWidth = 1 + Math.random() * 2;
        const sx = Math.random() * 128;
        x2.beginPath();
        x2.moveTo(sx, 0);
        x2.lineTo(sx + (Math.random() - 0.5) * 10, 256);
        x2.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    })();
    const furrow = new THREE.Mesh(furrowGeo, new THREE.MeshStandardMaterial({ vertexColors: true, map: soil, bumpMap: soil, bumpScale: 0.6, roughness: 0.95 }));
    furrow.receiveShadow = true;
    this.group.add(furrow);
    // A burn under where it lies
    const burn = new THREE.Mesh(
      new THREE.CircleGeometry(1.9, 28),
      new THREE.MeshBasicMaterial({ color: 0x0c0907, transparent: true, opacity: 0.4, depthWrite: false })
    );
    burn.rotation.x = -Math.PI / 2;
    burn.position.set(dx, groundY(dx, dz) + 0.03, dz);
    this.group.add(burn);
    // Clods thrown out along the banks, bigger near the end of it
    const clodMat = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 1, flatShading: true });
    const clodGeo = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 70; i++) {
      const t = Math.pow(Math.random(), 1.4);
      const along = 0.4 + t * trailLen;
      const side = (Math.random() < 0.5 ? -1 : 1) * (1.0 + Math.random() * 1.2) * (1 - t * 0.5);
      const px = dx + dirX * along + sideX * side;
      const pz = dz + dirZ * along + sideZ * side;
      const s = (0.05 + Math.random() * 0.13) * (1.2 - t * 0.6);
      const clod = new THREE.Mesh(clodGeo, clodMat);
      clod.scale.set(s, s * 0.7, s * (0.8 + Math.random() * 0.5));
      clod.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      clod.position.set(px, groundY(px, pz) + s * 0.4, pz);
      clod.castShadow = true;
      this.group.add(clod);
    }
    // Embers still glowing in the deepest part of it
    const ember = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff5a10, emissiveIntensity: 1.6 });
    for (let i = 0; i < 12; i++) {
      const along = 0.5 + Math.random() * 3.5;
      const side = (Math.random() - 0.5) * 0.8;
      const px = dx + dirX * along + sideX * side;
      const pz = dz + dirZ * along + sideZ * side;
      const e = new THREE.Mesh(clodGeo, ember);
      e.scale.setScalar(0.01 + Math.random() * 0.014);
      e.position.set(px, groundY(px, pz) + 0.05, pz);
      this.group.add(e);
    }
    // Bits of it along the way: the snapped arm with its motor, a guard ring, a blade, a panel
    const bits = new THREE.Group();
    this.group.add(bits);
    const bit = (m: THREE.Mesh, along: number, side: number, h: number, rot: [number, number, number]): void => {
      const px = dx + dirX * along + sideX * side;
      const pz = dz + dirZ * along + sideZ * side;
      m.position.set(px, groundY(px, pz) + h, pz);
      m.rotation.set(...rot);
      m.castShadow = true;
      bits.add(m);
    };
    bit(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.45, 10), carbon), 6.5, 1.1, 0.05, [Math.PI / 2, 0.3, 0.6]);
    bit(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.13, 16), dark), 6.8, 1.35, 0.07, [0.4, 0, 1.2]);
    bit(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.016, 6, 36), white), 10.5, -1.4, 0.1, [1.2, 0.4, 0.2]);
    bit(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.008, 0.055), carbon), 3.2, -1.2, 0.02, [0, 1.1, 0]);
    bit(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.008, 0.055), carbon), 13.5, 0.9, 0.02, [0, -0.4, 0.1]);
    const panel = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, 1.4, 0, 1.0), white);
    panel.material = white;
    bit(panel, 8.4, 0.3, 0.05, [2.2, 0.5, 0.3]);

    // ---- the tablet, face up in the sponge beside it, its screen lit
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

  /**
   * Fog lying low along the canyon floor: big soft billows a few metres off
   * the ground, drifting, thickest in the hollows, fading out as he comes
   * up close to one so he walks into the haze rather than through a card.
   */
  private buildGroundFog(): THREE.ShaderMaterial {
    const pts: number[] = [];
    const sizes: number[] = [];
    const seeds: number[] = [];
    for (let k = 0; k < 900; k++) {
      const z = -205 + Math.random() * 355;
      const x = valleyX(z) + (Math.random() - 0.5) * 2 * (halfWidth(z) + 6);
      if (inCave(x, z)) continue;
      const y = groundY(x, z) + 0.6 + Math.random() * 2.2;
      pts.push(x, y, z);
      sizes.push(9 + Math.random() * 12);
      seeds.push(Math.random() * 100);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color(0x3a2a52) }, uScale: { value: 600 }, uAlpha: { value: 0.16 } },
      vertexShader: `
        attribute float size; attribute float seed;
        uniform float uT; uniform float uScale;
        varying float vA; varying float vSeed;
        void main(){
          vec3 p = position + vec3(sin(uT * 0.05 + seed) * 2.0, sin(uT * 0.13 + seed * 2.0) * 0.3, cos(uT * 0.04 + seed) * 2.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          vA = smoothstep(2.0, 9.0, d) * (1.0 - smoothstep(110.0, 170.0, d));
          vSeed = seed;
          gl_PointSize = min(size * uScale / max(d, 0.1), 1024.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uAlpha; uniform float uT;
        varying float vA; varying float vSeed;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float r = length(q);
          if (r > 1.0) discard;
          float wisp = n(q * 2.5 + vSeed + uT * 0.03) * 0.6 + n(q * 5.0 - vSeed) * 0.4;
          float a = (1.0 - smoothstep(0.2, 1.0, r)) * (0.5 + 0.5 * wisp) * uAlpha * vA;
          gl_FragColor = vec4(uColor, a);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false
    });
    const fog = new THREE.Points(geo, mat);
    fog.frustumCulled = false;
    fog.renderOrder = 5;
    this.group.add(fog);
    return mat;
  }

  // ------------------------------------------------------------- the sky

  /**
   * Black overhead; low down a bruised purple glow and heavy cloud banks,
   * with a cyan aurora in one quarter; stars; and the planets. `uFlash`
   * lights the clouds from inside (lightning, far off).
   */
  private buildSky(): { mat: THREE.ShaderMaterial; planets: THREE.Object3D[] } {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector2(0.4, -0.9) } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform float uT; uniform float uFlash; uniform vec2 uFlashDir; varying vec3 vD;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        float fb(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += n(p) * a; p *= 2.1; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vD);
          float up = max(d.y, 0.0);
          vec2 p = d.xz / (d.y + 0.22);
          // Black overhead; a dim, bruised purple toward the horizon
          vec3 c = mix(vec3(0.09, 0.03, 0.12), vec3(0.002, 0.001, 0.006), smoothstep(0.0, 0.5, up));
          // Heavy cloud banks low down, darker than the glow behind them
          float cl = fb(p * 0.8 + vec2(uT * 0.006, uT * 0.002));
          float bank = smoothstep(0.4, 0.8, cl) * (1.0 - smoothstep(0.05, 0.6, up));
          c = mix(c, vec3(0.05, 0.02, 0.07), bank * 0.8);
          c += vec3(0.22, 0.09, 0.3) * smoothstep(0.55, 0.9, cl) * (1.0 - smoothstep(0.0, 0.35, up)) * 0.5;
          // Lightning inside the clouds, in one part of the sky
          float near = smoothstep(0.6, 1.0, dot(normalize(d.xz + 1e-4), normalize(uFlashDir)));
          c += vec3(0.55, 0.45, 0.85) * uFlash * near * (0.3 + bank) * (1.0 - smoothstep(0.0, 0.6, up));
          // The aurora: a faint cyan curtain
          float au = smoothstep(0.6, 0.0, abs(d.y - 0.32 - sin(d.x * 6.0 + uT * 0.05) * 0.05)) * smoothstep(-0.2, 0.6, d.x) * smoothstep(0.3, -0.6, d.z);
          c += vec3(0.05, 0.35, 0.45) * au * (0.4 + 0.6 * fb(vec2(d.x * 20.0, uT * 0.03))) * 0.5;
          vec3 sq = d * 210.0;
          vec3 sc = floor(sq);
          float sr = fract(sin(dot(sc, vec3(127.1, 311.7, 74.7))) * 43758.5453);
          float sd = length(fract(sq) - 0.5);
          float st = step(0.9965, sr) * smoothstep(0.32, 0.08, sd) * smoothstep(0.02, 0.25, up) * (1.0 - bank);
          c += vec3(st) * (0.5 + 0.5 * fract(sr * 97.0));
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
    const planets: THREE.Object3D[] = [];
    const planetTex = (kind: number): THREE.CanvasTexture => {
      const c = makeCanvas(512, 256);
      const g = c.getContext('2d')!;
      if (kind === 0) {
        for (let y = 0; y < 256; y++) {
          const t = y / 256;
          const v = Math.sin(t * 30 + Math.sin(t * 9) * 2) * 0.5 + 0.5;
          g.fillStyle = `rgb(${110 + v * 70},${60 + v * 40},${90 + v * 50})`;
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
    const planet = (kind: number, r: number, dir: THREE.Vector3, ring = false, bright = 0.75): void => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), new THREE.MeshBasicMaterial({ map: planetTex(kind), color: new THREE.Color(bright, bright, bright), fog: false }));
      const shade = new THREE.Mesh(
        new THREE.SphereGeometry(r * 1.002, 48, 32),
        new THREE.ShaderMaterial({
          uniforms: { uL: { value: new THREE.Vector3(-0.6, 0.4, 0.7).normalize() } },
          vertexShader: 'varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'uniform vec3 uL; varying vec3 vN; void main(){ float k = smoothstep(-0.2, 0.45, dot(vN, uL)); gl_FragColor = vec4(0.0, 0.0, 0.02, 1.0 - k * 0.9); }',
          transparent: true,
          depthWrite: false,
          fog: false
        })
      );
      const g = new THREE.Group();
      g.add(m, shade);
      if (ring) {
        const rg = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 2.2, 96, 1), new THREE.MeshBasicMaterial({ color: 0x9a80a8, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false }));
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
    planet(0, 140, new THREE.Vector3(-0.55, 0.36, -0.72), true, 0.7);
    planet(1, 45, new THREE.Vector3(0.6, 0.55, -0.5), false, 0.6);
    planet(2, 26, new THREE.Vector3(0.25, 0.3, -0.9), false, 0.55);
    planet(1, 12, new THREE.Vector3(-0.2, 0.7, -0.6), false, 0.5);
    planet(2, 18, new THREE.Vector3(0.8, 0.25, 0.4), false, 0.5);
    return { mat, planets };
  }

  // ------------------------------------------------------------- the chasm and the cave's mouth

  /**
   * The pillars, as rock: tall columns from far down in the chasm up to
   * their tops (the ground's own slope does the standing on); a mist lying
   * in the chasm so it looks as deep as it is.
   */
  private chasmGlow = new THREE.MeshStandardMaterial({ color: 0x2a6a5a, emissive: 0x5affc0, emissiveIntensity: 2.2, roughness: 0.5 });

  private buildChasm(): void {
    this.glowMats.push(this.chasmGlow);
    for (const p of PILLARS) {
      const H = p.y - CHASM.floor + 2;
      const geo = new THREE.CylinderGeometry(p.r * 1.06, p.r * 1.5, H, 28, 24, false);
      const pa = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i);
        const y = pa.getY(i);
        const z = pa.getZ(i);
        const top = y > H / 2 - 0.01;
        if (top) continue;
        const k = 1 + (fbm(x * 0.6 + p.z, y * 0.15 + z * 0.6) * 0.25 + (ridged(x * 0.4, y * 0.3 + z) - 0.5) * 0.12) * Math.min(1, (H / 2 - y) / 1.5);
        pa.setXYZ(i, x * k, y, z * k);
      }
      geo.deleteAttribute('uv');
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.rockMat);
      m.position.set(p.x, p.y + 0.07 - H / 2, p.z);
      this.group.add(m);
      this.shootables.push(m);
      // Moss and a few tufts on top
      const moss = new THREE.Mesh(new THREE.CircleGeometry(p.r * 1.02, 28), new THREE.MeshStandardMaterial({ color: 0x4a6a3a, roughness: 0.95 }));
      moss.rotation.x = -Math.PI / 2;
      moss.position.set(p.x, p.y + 0.075, p.z);
      this.group.add(moss);
      // Glowing caps round its rim and a light over it: something to aim for in the dark
      const capGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      const n = 16;
      const caps = new THREE.InstancedMesh(capGeo, this.chasmGlow, n);
      const m4 = new THREE.Matrix4();
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + hash(k, p.z) * 0.3;
        const rr = p.r * (0.86 + hash(k, 3) * 0.1);
        const s = 0.07 + hash(k, 5) * 0.09;
        m4.compose(
          new THREE.Vector3(p.x + Math.cos(a) * rr, p.y + 0.07, p.z + Math.sin(a) * rr),
          new THREE.Quaternion(),
          new THREE.Vector3(s * 1.4, s * 0.7, s * 1.4)
        );
        caps.setMatrixAt(k, m4);
      }
      this.group.add(caps);
      const lamp = new THREE.PointLight(0x5affc0, 5, 11, 1.4);
      lamp.position.set(p.x, p.y + 1.6, p.z);
      this.group.add(lamp);
    }
    // The mist down in it
    const mist = new THREE.Mesh(
      new THREE.PlaneGeometry(90, CHASM.z1 - CHASM.z0 + 6),
      new THREE.MeshBasicMaterial({ color: 0x1a1226, transparent: true, opacity: 0.82, depthWrite: false })
    );
    mist.rotation.x = -Math.PI / 2;
    mist.position.set(valleyX((CHASM.z0 + CHASM.z1) / 2), -8, (CHASM.z0 + CHASM.z1) / 2);
    this.group.add(mist);
  }

  /**
   * The cave's mouth in the canyon's end wall: an arch of broken rock, a
   * short way in going dark, crystals glowing at its edges. Part two is in
   * there. Shut (a gate he can't see) till he has the big one's cannons.
   */
  private buildCaveMouth(): Level16Data['portal'] {
    const rock = this.rockMat;
    const y = CAVE_Y;
    const g = new THREE.Group();
    g.position.set(CAVE_X, y, CAVE_MOUTH_Z);
    this.group.add(g);
    const arch = new THREE.TorusGeometry(4.2, 1.5, 14, 40, Math.PI);
    const ap = arch.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < ap.count; i++) {
      const x = ap.getX(i);
      const yy = ap.getY(i);
      const z = ap.getZ(i);
      const k = 1 + (ridged(x * 0.5 + 4, yy * 0.5 + z) - 0.45) * 0.8;
      ap.setXYZ(i, x * (0.95 + 0.1 * k), yy * k, z * k * 1.4);
    }
    arch.deleteAttribute('uv');
    arch.computeVertexNormals();
    const am = new THREE.Mesh(arch, rock);
    am.position.set(0, -0.8, 0.6);
    am.scale.set(1, 1.25, 1);
    g.add(am);
    this.shootables.push(am);
    // The way in: a hollow going back into the rock and into the dark
    const tunnel = new THREE.CylinderGeometry(3.4, 3.4, 10, 24, 6, true, -Math.PI / 2, Math.PI);
    tunnel.rotateX(Math.PI / 2);
    tunnel.rotateZ(Math.PI / 2);
    const tp = tunnel.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) {
      const k = 1 + fbm(tp.getX(i) * 0.5, tp.getY(i) * 0.5 + tp.getZ(i) * 0.3) * 0.2;
      tp.setXYZ(i, tp.getX(i) * k, Math.max(0, tp.getY(i) * k), tp.getZ(i));
    }
    tunnel.computeVertexNormals();
    const tm = new THREE.Mesh(tunnel, new THREE.MeshStandardMaterial({ map: rock.map, color: 0x5a5650, roughness: 0.6, side: THREE.DoubleSide }));
    tm.position.set(0, -0.05, -5);
    g.add(tm);
    const back = new THREE.Mesh(new THREE.CircleGeometry(3.6, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    back.position.set(0, 1.5, -9.8);
    g.add(back);
    // Darker the further in: veils of black, so the way in reads as going on into the dark
    const veil = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false });
    for (const z of [-2.5, -4.5, -6.5, -8.5]) {
      const v = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 6.4), veil);
      v.position.set(0, 2.6, z);
      g.add(v);
    }
    const crystal = new THREE.MeshStandardMaterial({ color: 0x0a2a3a, emissive: 0x40d8ff, emissiveIntensity: 1.4, roughness: 0.15 });
    this.glowMats.push(crystal);
    for (let k = 0; k < 14; k++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), crystal);
      s.scale.set(0.6, 2.2 + Math.random(), 0.6);
      const side = k % 2 ? 1 : -1;
      s.position.set(side * (2.6 + Math.random() * 0.6), 0.3 + Math.random() * 2.5, -1 - Math.random() * 6);
      s.rotation.set((Math.random() - 0.5) * 1.2, Math.random() * 3, side * 0.5);
      g.add(s);
    }
    // Walls of the way in, and the end of it; the gate across its mouth
    this.collide(CAVE_X - 4.6, y - 1, CAVE_MOUTH_Z - 11, CAVE_X - 3.2, y + 6, CAVE_MOUTH_Z + 1);
    this.collide(CAVE_X + 3.2, y - 1, CAVE_MOUTH_Z - 11, CAVE_X + 4.6, y + 6, CAVE_MOUTH_Z + 1);
    this.collide(CAVE_X - 4.6, y - 1, CAVE_MOUTH_Z - 12, CAVE_X + 4.6, y + 6, CAVE_MOUTH_Z - 10);
    this.caveGate = this.collide(CAVE_X - 3.3, y - 1, CAVE_MOUTH_Z - 0.4, CAVE_X + 3.3, y + 6, CAVE_MOUTH_Z + 0.2);
    // (the scene's portal hooks: a disc to drive, nothing to show)
    const disc = new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 }, uK: { value: 0 } } });
    return { group: g, disc, at: new THREE.Vector3(CAVE_X, y + 0.5, CAVE_MOUTH_Z - 2.5) };
  }

  // ------------------------------------------------------------- the tracker's map

  private buildMap(): HTMLCanvasElement {
    const X0 = -70;
    const X1 = 70;
    const Z0 = -212;
    const Z1 = 150;
    const W = 360;
    const H = Math.round((W * (Z1 - Z0)) / (X1 - X0));
    const c = makeCanvas(W, H);
    const g = c.getContext('2d')!;
    const img = g.createImageData(W, H);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const x = X0 + ((i + 0.5) / W) * (X1 - X0);
        const z = Z0 + ((j + 0.5) / H) * (Z1 - Z0);
        let r: number;
        let gg: number;
        let b: number;
        if (inCave(x, z)) [r, gg, b] = [40, 60, 90];
        else if (inChasm(x, z) && groundY(x, z) < 0) [r, gg, b] = [8, 6, 12];
        else if (inLake(x, z) && groundY(x, z) < WATER_Y) [r, gg, b] = [60, 240, 90];
        else if (z < MASSIF.z1 && z > MASSIF.z0 && Math.abs(x) < 40) [r, gg, b] = [120, 112, 104];
        else {
          const y = groundY(x, z);
          const out = outside(x, z);
          if (out > 0) {
            const k = Math.min(1, out / 30);
            [r, gg, b] = [70 - k * 40, 66 - k * 40, 64 - k * 36];
          } else {
            const k = Math.max(0, Math.min(1, (y + 2) / 16));
            r = 60 + k * 90;
            gg = 100 + k * 90;
            b = 70 + k * 70;
            if (Math.abs(((y + 100) % 2) - 1) < 0.1) {
              r += 25;
              gg += 30;
              b += 30;
            }
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

// ================================================================ plants

/** A seeded random, so each tree shape is the same every time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ready to merge: no index, no UVs (the plants are textured by world position). */
function plain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n.getAttribute('uv')) n.deleteAttribute('uv');
  return n;
}

function tube(curve: THREE.Curve<THREE.Vector3>, segs: number, radial: number, r: (u: number, a: number) => number): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
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

/** A lumpy round puff of foliage, smooth-shaded. */
function puff(r: number, detail: number, seed: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + fbm(v.x * 1.6 + seed, v.z * 1.6 + v.y * 0.9) * 0.45 + ridged(v.x * 3 + seed, v.y * 3 + v.z) * 0.12;
    v.multiplyScalar(k);
    v.y *= 0.82;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * One tree shape (v picks which): a trunk that flares at the root and
 * twists as it rises; roots spreading into the ground; branches up and out
 * of its upper half; a cluster of foliage at each branch end and on top;
 * vines hanging from under the crowns. And a far version: the trunk, and a
 * few plain crowns.
 */
function buildTree(v: number): { near: { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry; vines: THREE.BufferGeometry }; far: { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry } } {
  const R = rng(1013 + v * 7919);
  const H = 3.4 + v * 0.45;
  const lean = new THREE.Vector3((R() - 0.5) * 0.8, 0, (R() - 0.5) * 0.8);
  const trunkPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 5; i++) {
    const u = i / 5;
    trunkPts.push(new THREE.Vector3(lean.x * u * u + Math.sin(u * 4 + v) * 0.15, -0.4 + u * H, lean.z * u * u + Math.cos(u * 3 + v) * 0.15));
  }
  const trunkC = new THREE.CatmullRomCurve3(trunkPts);
  const trunkR = (u: number, a: number): number => (0.34 * (1 - u * 0.62) + 0.22 * Math.pow(Math.max(0, 1 - u * 5), 2)) * (1 + 0.08 * Math.sin(a * 5 + u * 9));
  const wood: THREE.BufferGeometry[] = [plain(tube(trunkC, 28, 14, trunkR))];
  const woodFar: THREE.BufferGeometry[] = [plain(tube(trunkC, 8, 7, trunkR))];
  // Roots
  const nRoots = 4 + Math.floor(R() * 2);
  for (let k = 0; k < nRoots; k++) {
    const a = (k / nRoots) * Math.PI * 2 + R() * 0.6;
    const l = 0.9 + R() * 0.6;
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(Math.cos(a) * l * 0.45, 0.12, Math.sin(a) * l * 0.45), new THREE.Vector3(Math.cos(a) * l, -0.25, Math.sin(a) * l)]);
    wood.push(plain(tube(c, 10, 7, (u) => 0.13 * (1 - u * 0.8))));
  }
  // Branches, and where each ends
  const tips: { p: THREE.Vector3; s: number }[] = [{ p: trunkC.getPointAt(1).clone().add(new THREE.Vector3(0, 0.5, 0)), s: 1.25 }];
  const nB = 4 + Math.floor(R() * 3);
  for (let k = 0; k < nB; k++) {
    const u = 0.45 + R() * 0.45;
    const base = trunkC.getPointAt(u);
    const a = (k / nB) * Math.PI * 2 + R() * 0.8;
    const l = 1.3 + R() * 1.1;
    const up = 0.55 + R() * 0.45;
    const mid = base.clone().add(new THREE.Vector3(Math.cos(a) * l * 0.5, l * up * 0.35, Math.sin(a) * l * 0.5));
    const end = base.clone().add(new THREE.Vector3(Math.cos(a) * l, l * up, Math.sin(a) * l));
    const c = new THREE.CatmullRomCurve3([base, mid, end]);
    const r0 = trunkR(u, 0) * 0.45;
    wood.push(plain(tube(c, 12, 8, (t) => r0 * (1 - t * 0.7))));
    woodFar.push(plain(tube(c, 3, 5, (t) => r0 * (1 - t * 0.7))));
    tips.push({ p: end, s: 0.75 + R() * 0.35 });
    // A twig or two off it
    if (R() < 0.7) {
      const tb = c.getPointAt(0.6);
      const ta = a + (R() < 0.5 ? 0.9 : -0.9);
      const te = tb.clone().add(new THREE.Vector3(Math.cos(ta) * 0.7, 0.5, Math.sin(ta) * 0.7));
      wood.push(plain(tube(new THREE.CatmullRomCurve3([tb, tb.clone().lerp(te, 0.5).add(new THREE.Vector3(0, 0.1, 0)), te]), 6, 6, (t) => r0 * 0.5 * (1 - t * 0.7))));
      tips.push({ p: te, s: 0.55 });
    }
  }
  // Foliage: a cluster of puffs at each tip
  const leaves: THREE.BufferGeometry[] = [];
  const leavesFar: THREE.BufferGeometry[] = [];
  const vines: THREE.BufferGeometry[] = [];
  tips.forEach((t, i) => {
    const n = t.s > 1 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + R();
      const off = new THREE.Vector3(Math.cos(a) * 0.5 * t.s, (R() - 0.3) * 0.4 * t.s, Math.sin(a) * 0.5 * t.s);
      const g = puff((0.85 + R() * 0.35) * t.s, 2, i * 13 + k);
      g.translate(t.p.x + off.x, t.p.y + off.y, t.p.z + off.z);
      leaves.push(plain(g));
    }
    const f = puff(1.15 * t.s, 1, i * 7);
    f.translate(t.p.x, t.p.y, t.p.z);
    leavesFar.push(plain(f));
    // Vines hanging from under it
    if (i > 0 && R() < 0.8)
      for (let k = 0; k < 2; k++) {
        const s = t.p.clone().add(new THREE.Vector3((R() - 0.5) * 0.9, -0.4 * t.s, (R() - 0.5) * 0.9));
        const len = 0.9 + R() * 1.6;
        const c = new THREE.CatmullRomCurve3([s, s.clone().add(new THREE.Vector3((R() - 0.5) * 0.2, -len * 0.5, (R() - 0.5) * 0.2)), s.clone().add(new THREE.Vector3((R() - 0.5) * 0.3, -len, (R() - 0.5) * 0.3))]);
        vines.push(plain(tube(c, 8, 4, (u) => 0.025 * (1 - u * 0.6))));
      }
  });
  const merge = (l: THREE.BufferGeometry[]): THREE.BufferGeometry => {
    const g = mergeGeometries(l, false)!;
    g.computeBoundingSphere();
    return g;
  };
  return { near: { wood: merge(wood), leaves: merge(leaves), vines: merge(vines.length ? vines : [plain(new THREE.BoxGeometry(0.01, 0.01, 0.01))]) }, far: { wood: merge(woodFar), leaves: merge(leavesFar) } };
}

/** A frond-bush: arching fern fronds out from the middle, drooping at their tips. */
function fernGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 8;
  for (let k = 0; k < n; k++) {
    const L = 0.9 + (k % 3) * 0.2;
    const g = new THREE.PlaneGeometry(0.34, L, 1, 10);
    g.translate(0, L / 2, 0);
    const a = (k / n) * Math.PI * 2 + (k % 2) * 0.3;
    const rise = 0.5 + (k % 2) * 0.25;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const w = p.getX(i);
      const t = p.getY(i) / L;
      const o = t * L * 0.8;
      const h = L * rise * Math.sin(t * Math.PI * 0.72);
      // A little cupped across its width
      const cup = Math.abs(w) * 0.25;
      p.setXYZ(i, Math.cos(a) * o - Math.sin(a) * w, h + cup, Math.sin(a) * o + Math.cos(a) * w);
    }
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts, false)!;
}

/** A low mound of leafy growth. */
function moundGeometry(): THREE.BufferGeometry {
  const g = puff(0.75, 2, 3.3);
  g.scale(1, 0.75, 1);
  g.translate(0, 0.28, 0);
  return g;
}

/** A tuft of spiky grass: thin blades fanning out and up, bending over. */
function tuftGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 14; k++) {
    const L = 0.35 + ((k * 37) % 10) * 0.035;
    const g = new THREE.PlaneGeometry(0.035, L, 1, 4);
    g.translate(0, L / 2, 0);
    const a = k * 2.4;
    const bend = 0.25 + (k % 4) * 0.1;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const w = p.getX(i) * (1 - p.getY(i) / L);
      const t = p.getY(i) / L;
      const o = 0.04 + t * t * L * bend;
      p.setXYZ(i, Math.cos(a) * o - Math.sin(a) * w, t * L * (1 - bend * 0.3 * t), Math.sin(a) * o + Math.cos(a) * w);
    }
    g.computeVertexNormals();
    parts.push(plain(g));
  }
  return mergeGeometries(parts, false)!;
}

/** A glowing bulb on a curved stalk, two smaller ones beside it. */
function bulbStalk(): { stalk: THREE.BufferGeometry; bulbs: THREE.BufferGeometry } {
  const stalks: THREE.BufferGeometry[] = [];
  const bulbs: THREE.BufferGeometry[] = [];
  for (const [dx, dz, h, r] of [[0, 0, 0.95, 0.11], [0.12, 0.06, 0.6, 0.07], [-0.08, 0.1, 0.45, 0.06]]) {
    const top = new THREE.Vector3(dx + 0.1, h, dz);
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(dx, 0, dz), new THREE.Vector3(dx - 0.05, h * 0.5, dz), top]);
    stalks.push(plain(tube(c, 10, 6, (u) => 0.018 * (1 - u * 0.4))));
    const b = new THREE.SphereGeometry(r, 14, 10);
    b.scale(1, 1.3, 1);
    b.translate(top.x, top.y + r * 0.9, top.z);
    bulbs.push(plain(b));
  }
  return { stalk: mergeGeometries(stalks, false)!, bulbs: mergeGeometries(bulbs, false)! };
}

// ================================================================ more textures

/** Foliage: a mass of small overlapping leaves, each lit along its middle. Grey: the instances tint it. */
function leafTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  g.fillStyle = '#6a6a6a';
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 1400; k++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const a = Math.random() * Math.PI * 2;
    const l = 5 + Math.random() * 9;
    const w = l * (0.35 + Math.random() * 0.2);
    const v = 120 + Math.random() * 120;
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.fillStyle = `rgb(${v * 0.55},${v * 0.55},${v * 0.55})`;
    g.beginPath();
    g.ellipse(0, 0, l, w, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.ellipse(-l * 0.1, -w * 0.15, l * 0.8, w * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(40,40,40,0.5)';
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(-l, 0);
    g.lineTo(l, 0);
    g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Bark: long fibres and cracks running up it. */
function barkTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  g.fillStyle = '#8a8080';
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 500; k++) {
    const x = Math.random() * S;
    const v = 80 + Math.random() * 110;
    g.strokeStyle = `rgba(${v},${v * 0.95},${v * 0.95},0.5)`;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    g.moveTo(x, 0);
    let xx = x;
    for (let y = 0; y <= S; y += 16) g.lineTo((xx += (Math.random() - 0.5) * 4), y);
    g.stroke();
  }
  for (let k = 0; k < 60; k++) {
    g.strokeStyle = 'rgba(20,16,16,0.7)';
    g.lineWidth = 1 + Math.random() * 2;
    const x = Math.random() * S;
    const y = Math.random() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 6, y + 20 + Math.random() * 40);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A fern frond on transparent: a central rib, paired leaflets curving out along it. */
function frondTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 512;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  for (let k = 0; k < 26; k++) {
    const t = k / 26;
    const y = H - 20 - t * (H - 40);
    const l = (W / 2 - 4) * Math.sin(Math.min(1, (1 - t) * 1.25) * Math.PI * 0.55 + 0.35) * (1 - t * 0.6);
    for (const s of [-1, 1]) {
      g.fillStyle = `rgb(${190 + Math.random() * 40},${190 + Math.random() * 40},${190 + Math.random() * 40})`;
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + s * l * 0.6, y - 14, W / 2 + s * l, y - 22);
      g.quadraticCurveTo(W / 2 + s * l * 0.5, y - 2, W / 2, y + 6);
      g.fill();
      g.strokeStyle = 'rgba(60,60,60,0.6)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(W / 2, y);
      g.lineTo(W / 2 + s * l * 0.8, y - 16);
      g.stroke();
    }
  }
  g.strokeStyle = '#555';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(W / 2, H);
  g.lineTo(W / 2, 10);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Rock's bump: cracks and grain. */
function rockBump(): THREE.CanvasTexture {
  const S = 256;
  rockPx ??= rockPixels(S);
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  for (let k = 0; k < S * S; k++) {
    const v = rockPx[k] * 255;
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = v;
    img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
