import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Collider } from './OfficeLevelBuilder';
import type { CombatLevel } from '../scenes/CombatScene';
import { makeCanvas, tiling, noiseTile } from './Level8Builder';

/**
 * Level13Builder — inside the Exterminator Collective.
 *
 *  The sewers (floor y 30): a tube's outlet high in the end wall of the first
 *  tunnel drops Ravi into a channel of green sludge. Tunnels, a junction, a
 *  pool room thick with flies, a last tunnel and a chamber with a ladder up a
 *  shaft in its ceiling.
 *
 *  The hall (x −60..60, z −70..70): the shaft comes out in a recess in the
 *  west wall, onto the first of a route of perforated steel walkways and
 *  platforms hung across the middle of a building-sized void. Below them,
 *  the abyss: fog, and far down a lattice of rails with tank cars moving on
 *  it. Up the route: ladders, a walkway with no rails, a broken span crossed
 *  on beams, a lever that brings a platform over a gap, sentry turrets
 *  sweeping the walkways, classified crates and vats; and at the end, on the
 *  east wall, a blast door.
 *
 * Coordinates are high (the sewers at 30, the route from 46 up) so nothing
 * gets near FPSPlayer's out-of-the-world reset at −10.
 */

export const SEW_Y = 30;
export const CH_Y = 29.25;
export const SLUDGE_Y = 29.72;
export const H1 = 46;
export const H2 = 54;
export const H3 = 62;
/** Below this, inside the hall, he's gone over. */
export const FALL_Y = 38;
export const HALL = { x0: -60, x1: 60, z0: -70, z1: 70, top: 92, bottom: -70 };

export interface Ladder {
  /** Where he stands on it (feet, at the bottom), the way he faces to climb, its top, and where he steps off. */
  base: THREE.Vector3;
  face: number;
  top: number;
  off: THREE.Vector3;
}

export interface TurretSite {
  pos: THREE.Vector3;
  /** The middle of its sweep, how far either side it goes, how fast, and how far down it looks. */
  yaw: number;
  half: number;
  rate: number;
  pitch: number;
  mount: 'ceiling' | 'post';
}

export interface Cart {
  obj: THREE.Object3D;
  axis: 'x' | 'z';
  from: number;
  to: number;
  speed: number;
  u: number;
}

export interface Level13Data extends CombatLevel {
  occluders: THREE.Object3D[];
  /** 0 the sewer (after the tube), 1 the hall, 2 the lever, 3 the last ladder's top. */
  checkpoints: { pos: THREE.Vector3; yaw: number }[];
  ladders: Ladder[];
  turrets: TurretSite[];
  /** Where the sludge is (wading is slow), as boxes over the channel. */
  sludge: THREE.Box3[];
  sludgeMats: THREE.ShaderMaterial[];
  flies: THREE.Vector3[];
  /** Ledge runs the rats scurry along (each a start and an end). */
  ratRuns: [THREE.Vector3, THREE.Vector3][];
  /** Trash floating on the sludge, to bob. */
  floaters: THREE.Object3D[];
  /** Above each ladder, where its marker lamp's light goes. */
  ladderTops: THREE.Vector3[];
  lever: { pivot: THREE.Group; at: THREE.Vector3 };
  mover: { group: THREE.Group; collider: Collider; from: THREE.Vector3; to: THREE.Vector3; size: THREE.Vector3 };
  door: { slab: THREE.Group; collider: Collider; front: THREE.Vector3; plant: THREE.Vector3 };
  carts: Cart[];
  tube: THREE.CatmullRomCurve3;
  outlet: THREE.Vector3;
  lights: { sewer: THREE.PointLight[]; hall: THREE.PointLight[] };
  vatGlow: THREE.MeshStandardMaterial[];
  fogLayers: THREE.Mesh[];
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}
/** A box from min to max corners. */
function span(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.BufferGeometry {
  return box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, y0, (z0 + z1) / 2);
}
function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false) ?? list[0];
  for (const x of list) if (x !== g) x.dispose();
  return g;
}
/** UVs from world position, `tile` metres a repeat, by the face's plane. */
function worldUVs(g: THREE.BufferGeometry, tile: number): void {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const nz = Math.abs(n.getZ(i));
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (ny > nx && ny > nz) uv.set([x / tile, z / tile], i * 2);
    else if (nx > nz) uv.set([z / tile, y / tile], i * 2);
    else uv.set([x / tile, y / tile], i * 2);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ------------------------------------------------------------- textures

/** Old brick in the sewer, black with damp at the bottom and green where it runs. */
function sewerBrickCanvas(): HTMLCanvasElement {
  const c = noiseTile(512, [74, 70, 58], { fine: 14, blobs: 26, blobAmp: 16, specks: 0.02, speckAmp: 30 });
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(20,20,14,0.55)';
  g.lineWidth = 3;
  for (let y = 0; y <= 512; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
    const off = (y / 32) % 2 ? 32 : 0;
    for (let x = off; x <= 512; x += 64) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 32);
      g.stroke();
    }
  }
  // Streaks of green and black down from the top
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 512;
    const w = 3 + Math.random() * 12;
    const len = 80 + Math.random() * 400;
    const grad = g.createLinearGradient(0, 0, 0, len);
    const green = Math.random() < 0.6;
    grad.addColorStop(0, green ? 'rgba(70,110,30,0.5)' : 'rgba(10,12,8,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, w, len);
  }
  return c;
}

/** Perforated steel plate: a grid of round holes (transparent), the plate grey and scuffed. */
function gratingCanvas(): HTMLCanvasElement {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d')!;
  const base = noiseTile(256, [118, 121, 124], { fine: 18, blobs: 10, blobAmp: 12 });
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  for (let y = 8; y < 256; y += 16) {
    for (let x = 8 + ((y / 16) % 2) * 8; x < 256; x += 16) {
      g.beginPath();
      g.arc(x, y, 4.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

/** Board-marked concrete for the hall: panels, tie holes, stains. */
function hallConcreteCanvas(): HTMLCanvasElement {
  const c = noiseTile(512, [120, 121, 122], { fine: 12, blobs: 34, blobAmp: 14, specks: 0.01, speckAmp: 20 });
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(60,60,62,0.6)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 510, 510);
  g.beginPath();
  g.moveTo(0, 256);
  g.lineTo(512, 256);
  g.stroke();
  g.fillStyle = 'rgba(40,40,42,0.7)';
  for (const [x, y] of [[64, 64], [448, 64], [64, 192], [448, 192], [64, 320], [448, 320], [64, 448], [448, 448]]) {
    g.beginPath();
    g.arc(x, y, 6, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * 512;
    const grad = g.createLinearGradient(0, 0, 0, 300);
    grad.addColorStop(0, 'rgba(50,48,44,0.35)');
    grad.addColorStop(1, 'rgba(50,48,44,0)');
    g.fillStyle = grad;
    g.fillRect(x, Math.random() * 200, 4 + Math.random() * 10, 300);
  }
  return c;
}

/** A crate's side: olive drab, stencilled CLASSIFIED MATERIAL, a hazard square. */
function crateCanvas(): HTMLCanvasElement {
  const c = noiseTile(256, [78, 84, 62], { fine: 16, blobs: 8, blobAmp: 10 });
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(30,32,24,0.8)';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 246, 246);
  g.fillStyle = '#e8e4d8';
  g.font = 'bold 30px Courier New, monospace';
  g.textAlign = 'center';
  g.fillText('CLASSIFIED', 128, 92);
  g.font = 'bold 26px Courier New, monospace';
  g.fillText('MATERIAL', 128, 124);
  g.fillStyle = '#b8261c';
  g.fillRect(40, 146, 176, 6);
  g.font = 'bold 16px Courier New, monospace';
  g.fillStyle = '#e8e4d8';
  g.fillText('E.C. PROPERTY — LEVEL 5', 128, 178);
  g.fillText('DO NOT OPEN', 128, 200);
  // A biohazard trefoil, roughly
  g.strokeStyle = '#d8b21a';
  g.lineWidth = 4;
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3 - Math.PI / 2;
    g.beginPath();
    g.arc(128 + Math.cos(a) * 12, 40 + Math.sin(a) * 12, 10, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}

/** Yellow and black hazard stripes. */
function hazardCanvas(): HTMLCanvasElement {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d')!;
  g.fillStyle = '#c99a12';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#16140f';
  for (let i = -128; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 16 + 128, 128);
    g.lineTo(i + 128, 128);
    g.closePath();
    g.fill();
  }
  return c;
}

/** The door: heavy steel, rivets, the EC hex, a warning. */
function doorCanvas(): HTMLCanvasElement {
  const c = noiseTile(512, [72, 76, 80], { fine: 14, blobs: 12, blobAmp: 10 });
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(30,32,34,0.9)';
  g.lineWidth = 8;
  g.strokeRect(14, 14, 484, 484);
  g.fillStyle = 'rgba(30,32,34,0.9)';
  for (let i = 30; i < 500; i += 40) for (const y of [28, 484]) g.fillRect(i, y, 6, 6);
  g.strokeStyle = '#c4261c';
  g.lineWidth = 10;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const x = 256 + Math.cos(a) * 90;
    const y = 200 + Math.sin(a) * 90;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.stroke();
  g.fillStyle = '#c4261c';
  g.font = 'bold 90px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('EC', 256, 204);
  g.font = 'bold 26px Courier New, monospace';
  g.fillStyle = '#d8d2c4';
  g.fillText('CONTAINMENT LEVEL 5', 256, 350);
  g.fillText('AUTHORISED PERSONNEL ONLY', 256, 386);
  return c;
}

/** Soft fog for the layers over the abyss: noisy, faded to nothing at the edges. */
function fogCanvas(): HTMLCanvasElement {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d')!;
  for (let i = 0; i < 70; i++) {
    const x = 30 + Math.random() * 196;
    const y = 30 + Math.random() * 196;
    const r = 20 + Math.random() * 60;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  }
  return c;
}

// ------------------------------------------------------------- the sludge

function sludgeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying float vFog;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        vFog = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 fogColor;
      uniform float fogDensity;
      varying vec3 vW;
      varying float vFog;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec2 p = vW.xz * 0.8;
        float n = noise(p + vec2(uTime * 0.12, uTime * 0.05)) * 0.6 + noise(p * 2.7 - uTime * 0.09) * 0.4;
        float scum = smoothstep(0.55, 0.8, noise(vW.xz * 0.35 + uTime * 0.02));
        float bub = step(0.985, hash(floor(vW.xz * 6.0) + floor(uTime * 1.5)));
        vec3 col = mix(vec3(0.06, 0.11, 0.025), vec3(0.17, 0.27, 0.05), n);
        col = mix(col, vec3(0.26, 0.27, 0.1), scum * 0.75);
        // Brown spots of muck drifting in it, and a darker crust round them
        float muck = noise(vW.xz * 1.1 + vec2(uTime * 0.03, -uTime * 0.02) + 31.0) * 0.65 + noise(vW.xz * 3.3 - uTime * 0.02) * 0.35;
        float spot = smoothstep(0.6, 0.7, muck);
        col = mix(col, vec3(0.05, 0.06, 0.02), smoothstep(0.54, 0.6, muck) * (1.0 - spot) * 0.6);
        col = mix(col, vec3(0.24, 0.15, 0.06) * (0.8 + 0.4 * noise(vW.xz * 9.0)), spot);
        col += vec3(0.25, 0.4, 0.08) * bub;
        // A sick sheen
        col += vec3(0.05, 0.09, 0.02) * pow(n, 4.0) * 3.0;
        float f = 1.0 - exp(-fogDensity * fogDensity * vFog * vFog);
        gl_FragColor = vec4(mix(col, fogColor, f), 0.985);
      }
    `,
    transparent: true
  });
}

// ------------------------------------------------------------- builder

interface WalkwaySpec {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  /** Rails along each long side: 'both', 'none', '-' (the low-coordinate side), '+'. */
  rails: 'both' | 'none' | '-' | '+';
}

export class Level13Builder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private M!: {
    brick: THREE.MeshStandardMaterial;
    sewerFloor: THREE.MeshStandardMaterial;
    concrete: THREE.MeshStandardMaterial;
    darkConcrete: THREE.MeshStandardMaterial;
    steel: THREE.MeshStandardMaterial;
    darkSteel: THREE.MeshStandardMaterial;
    rust: THREE.MeshStandardMaterial;
    grating: THREE.MeshStandardMaterial;
    yellow: THREE.MeshStandardMaterial;
    hazard: THREE.MeshStandardMaterial;
    crate: THREE.MeshStandardMaterial;
    pipe: THREE.MeshStandardMaterial;
    lamp: THREE.MeshStandardMaterial;
    greenLamp: THREE.MeshStandardMaterial;
    black: THREE.MeshBasicMaterial;
  };
  /** Collected per material, merged at the end into one mesh each. */
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private sludge: THREE.Box3[] = [];
  private sludgeMats: THREE.ShaderMaterial[] = [];
  private carts: Cart[] = [];
  private vatGlow: THREE.MeshStandardMaterial[] = [];
  private sewerLights: THREE.PointLight[] = [];
  private hallLights: THREE.PointLight[] = [];
  private fogLayers: THREE.Mesh[] = [];
  private ratRuns: [THREE.Vector3, THREE.Vector3][] = [];
  private floaters: THREE.Object3D[] = [];
  private ladderTops: THREE.Vector3[] = [];

  build(): Level13Data {
    this.makeMaterials();
    this.buildSewer();
    this.buildShaft();
    this.buildHall();
    const route = this.buildRoute();
    this.buildAbyss();
    this.buildHallDressing();
    this.flush();
    const tube = this.buildTube();
    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      glassPanes: [],
      occluders: this.occluders,
      checkpoints: [
        { pos: V(-128.5, CH_Y, 0), yaw: -Math.PI / 2 },
        { pos: V(-57, H1, -31), yaw: -Math.PI / 2 },
        { pos: V(1, H2, 35.5), yaw: -Math.PI / 2 },
        { pos: V(30, H3, 45.5), yaw: -Math.PI / 2 }
      ],
      ladders: route.ladders,
      turrets: route.turrets,
      sludge: this.sludge,
      sludgeMats: this.sludgeMats,
      flies: [V(-112, 31.2, 0.5), V(-99, 31, -2), V(-98, 31.4, -32), V(-94, 31.1, -35), V(-104, 31.6, -29), V(-78, 31.2, -31), V(-64, 31.4, -30)],
      ratRuns: this.ratRuns,
      floaters: this.floaters,
      ladderTops: this.ladderTops,
      lever: route.lever,
      mover: route.mover,
      door: route.door,
      carts: this.carts,
      tube,
      outlet: V(-133.4, 32.3, 0),
      lights: { sewer: this.sewerLights, hall: this.hallLights },
      vatGlow: this.vatGlow,
      fogLayers: this.fogLayers
    };
  }

  private makeMaterials(): void {
    const brick = tiling(sewerBrickCanvas());
    const conc = tiling(hallConcreteCanvas());
    const grate = tiling(gratingCanvas());
    const crate = tiling(crateCanvas());
    const haz = tiling(hazardCanvas());
    this.M = {
      brick: new THREE.MeshStandardMaterial({ map: brick, color: 0x9a9a88, roughness: 0.85 }),
      sewerFloor: new THREE.MeshStandardMaterial({ map: brick, color: 0x5d6a48, roughness: 0.55, metalness: 0.1 }),
      concrete: new THREE.MeshStandardMaterial({ map: conc, color: 0xa8aaac, roughness: 0.82 }),
      darkConcrete: new THREE.MeshStandardMaterial({ map: conc, color: 0x6c6e70, roughness: 0.85 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x7c8288, roughness: 0.45, metalness: 0.75 }),
      darkSteel: new THREE.MeshStandardMaterial({ color: 0x3a3e43, roughness: 0.5, metalness: 0.7 }),
      rust: new THREE.MeshStandardMaterial({ color: 0x5a4434, roughness: 0.75, metalness: 0.4 }),
      grating: new THREE.MeshStandardMaterial({ map: grate, color: 0xb0b4b8, roughness: 0.5, metalness: 0.65, alphaTest: 0.5, side: THREE.DoubleSide }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xc8a020, roughness: 0.5, metalness: 0.3, emissive: 0x2a1c00 }),
      hazard: new THREE.MeshStandardMaterial({ map: haz, roughness: 0.6 }),
      crate: new THREE.MeshStandardMaterial({ map: crate, roughness: 0.75 }),
      pipe: new THREE.MeshStandardMaterial({ color: 0x4e5a48, roughness: 0.6, metalness: 0.5 }),
      lamp: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1d0, emissiveIntensity: 2.6 }),
      greenLamp: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x9cff5a, emissiveIntensity: 2.2 }),
      black: new THREE.MeshBasicMaterial({ color: 0x020202 })
    };
  }

  /** Geometry to be drawn in `mat` (merged later); optionally solid, and shot at. */
  private add(mat: THREE.Material, g: THREE.BufferGeometry, solid = false, tile = 0): void {
    if (tile) worldUVs(g, tile);
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
    if (solid) {
      g.computeBoundingBox();
      this.colliders.push({ box: g.boundingBox!.clone() });
    }
  }

  private solidBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider {
    const c: Collider = { box: new THREE.Box3(V(x0, y0, z0), V(x1, y1, z1)) };
    this.colliders.push(c);
    return c;
  }

  private flush(): void {
    for (const [mat, list] of this.parts) {
      if (!list.length) continue;
      const mesh = new THREE.Mesh(merge(list), mat);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.surface = mat === this.M.grating || mat === this.M.steel || mat === this.M.darkSteel || mat === this.M.rust || mat === this.M.yellow ? 'metal' : mat === this.M.crate ? 'wood' : 'concrete';
      mesh.userData.noDecal = mat === this.M.grating;
      this.group.add(mesh);
      this.shootables.push(mesh);
      this.occluders.push(mesh);
    }
    this.parts.clear();
  }

  // -------------------------------------------------------------- sewer

  /**
   * The tunnels on a 1 m grid: which cells are walkable, which of those are
   * the channel. Floors and walls come off the grid, merged into runs.
   */
  private buildSewer(): void {
    const M = this.M;
    const X0 = -136;
    const X1 = -60;
    const Z0 = -40;
    const Z1 = 6;
    const W = X1 - X0;
    const D = Z1 - Z0;
    const open = new Uint8Array(W * D);
    const chan = new Uint8Array(W * D);
    const mark = (x0: number, z0: number, x1: number, z1: number, arr: Uint8Array): void => {
      for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) arr[(x - X0) * D + (z - Z0)] = 1;
    };
    // Rooms and tunnels
    mark(-133, -3, -100, 3, open); // A
    mark(-105, -5, -93, 5, open); // junction
    mark(-102, -27, -96, -5, open); // B
    mark(-107, -38, -89, -26, open); // pool room
    mark(-89, -34, -66, -28, open); // C
    mark(-66, -35, -61, -27, open); // the ladder chamber
    // The channel down the middle of them
    mark(-133, -1, -100, 1, chan);
    mark(-101, -2, -97, 1, chan);
    mark(-101, -27, -97, -2, chan);
    mark(-104, -36, -92, -28, chan); // the pool
    mark(-92, -32, -70, -30, chan);
    const isOpen = (x: number, z: number): boolean => x >= X0 && x < X1 && z >= Z0 && z < Z1 && open[(x - X0) * D + (z - Z0)] === 1;
    const isChan = (x: number, z: number): boolean => isOpen(x, z) && chan[(x - X0) * D + (z - Z0)] === 1;
    // Floors: runs along z at each x, ledge or channel
    for (let x = X0; x < X1; x++) {
      let z = Z0;
      while (z < Z1) {
        if (!isOpen(x, z)) {
          z++;
          continue;
        }
        const c = isChan(x, z);
        let z2 = z;
        while (z2 < Z1 && isOpen(x, z2) && isChan(x, z2) === c) z2++;
        const top = c ? CH_Y : SEW_Y;
        this.add(c ? M.sewerFloor : M.brick, span(x, top - 0.6, z, x + 1, top, z2), false, 2);
        this.solidBox(x, top - 0.6, z, x + 1, top, z2);
        if (c) {
          // The ledge's lip down into the channel, where a ledge is beside it
          for (const zz of [z - 1, z2]) if (isOpen(x, zz) && !isChan(x, zz)) this.add(M.brick, span(x, CH_Y, Math.min(zz, zz) + (zz < z ? 0.9 : 0), x + 1, SEW_Y, (zz < z ? zz + 1 : zz + 0.1)), false, 2);
        }
        z = z2;
      }
    }
    // Lips along x too (the channel's sides that run north–south)
    for (let x = X0; x < X1; x++) {
      for (let z = Z0; z < Z1; z++) {
        if (!isChan(x, z)) continue;
        if (isOpen(x - 1, z) && !isChan(x - 1, z)) this.add(M.brick, span(x - 0.1, CH_Y, z, x, SEW_Y, z + 1), false, 2);
        if (isOpen(x + 1, z) && !isChan(x + 1, z)) this.add(M.brick, span(x + 1, CH_Y, z, x + 1.1, SEW_Y, z + 1), false, 2);
      }
    }
    // Walls: every closed cell touching an open one, in runs along z
    for (let x = X0 - 1; x <= X1; x++) {
      let z = Z0 - 1;
      while (z <= Z1) {
        const wall = (zz: number): boolean => !isOpen(x, zz) && (isOpen(x - 1, zz) || isOpen(x + 1, zz) || isOpen(x, zz - 1) || isOpen(x, zz + 1) || isOpen(x - 1, zz - 1) || isOpen(x + 1, zz + 1) || isOpen(x - 1, zz + 1) || isOpen(x + 1, zz - 1));
        if (!wall(z)) {
          z++;
          continue;
        }
        let z2 = z;
        while (z2 <= Z1 && wall(z2)) z2++;
        // The end wall where the hall's west wall stands is the hall's
        if (x !== -61) {
          this.add(M.brick, span(x, CH_Y - 0.6, z, x + 1, SEW_Y + 4.4, z2), false, 2);
          this.solidBox(x, CH_Y - 0.6, z, x + 1, SEW_Y + 4.4, z2);
        }
        z = z2;
      }
    }
    // Ceiling, a slab over the lot, with the shaft's hole left in it
    for (const [x0, z0, x1, z1] of [[-136, -40, -63, 6], [-63, -40, -61, -32], [-63, -30, -61, 6]] as const) {
      this.add(M.darkConcrete, span(x0, SEW_Y + 4, z0, x1, SEW_Y + 4.6, z1), false, 3);
      this.solidBox(x0, SEW_Y + 4, z0, x1, SEW_Y + 4.6, z1);
    }
    // The sludge, over the channel
    const sludgeRects: [number, number, number, number][] = [[-133, -1, -100, 1], [-101, -27, -97, 1], [-104, -36, -92, -28], [-92, -32, -70, -30]];
    for (const [x0, z0, x1, z1] of sludgeRects) {
      const mat = sludgeMaterial();
      this.sludgeMats.push(mat);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set((x0 + x1) / 2, SLUDGE_Y, (z0 + z1) / 2);
      plane.renderOrder = 2;
      this.group.add(plane);
      this.sludge.push(new THREE.Box3(V(x0, CH_Y - 0.2, z0), V(x1, SLUDGE_Y + 0.05, z1)));
    }
    // Pipes along the walls, runs of conduit, grates in the floor, the outlet
    const r = lcg(13);
    const pipeRun = (a: THREE.Vector3, b: THREE.Vector3, rad: number, mat: THREE.Material): void => {
      const len = a.distanceTo(b);
      const g = new THREE.CylinderGeometry(rad, rad, len, 10);
      g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()), V(1, 1, 1)));
      this.add(mat, g);
      // Collars along it
      for (let k = 2; k < len; k += 3 + r() * 2) {
        const c = new THREE.CylinderGeometry(rad * 1.25, rad * 1.25, 0.12, 10);
        const p = a.clone().lerp(b, k / len);
        c.applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()), V(1, 1, 1)));
        this.add(M.rust, c);
      }
    };
    pipeRun(V(-132, 33.3, 2.6), V(-101, 33.3, 2.6), 0.22, M.pipe);
    pipeRun(V(-132, 32.6, 2.75), V(-101, 32.6, 2.75), 0.12, M.rust);
    pipeRun(V(-132, 33.5, -2.65), V(-104, 33.5, -2.65), 0.16, M.darkSteel);
    pipeRun(V(-101.6, 33.3, -5), V(-101.6, 33.3, -26), 0.25, M.pipe);
    pipeRun(V(-96.4, 32.8, -6), V(-96.4, 32.8, -26), 0.14, M.rust);
    pipeRun(V(-88, 33.4, -28.5), V(-67, 33.4, -28.5), 0.24, M.pipe);
    pipeRun(V(-88, 32.7, -33.6), V(-67, 32.7, -33.6), 0.14, M.darkSteel);
    pipeRun(V(-106.5, 30, -37), V(-106.5, 34, -37), 0.3, M.rust);
    pipeRun(V(-89.6, 30, -37.4), V(-89.6, 34, -37.4), 0.22, M.pipe);
    // Big outflow pipes spilling into the pool room from the walls
    for (const [x, z, ry] of [[-106.6, -31, 0], [-89.4, -33, Math.PI]] as const) {
      const g = new THREE.CylinderGeometry(0.55, 0.55, 1.2, 14, 1, true);
      g.rotateZ(Math.PI / 2);
      g.rotateY(ry);
      g.translate(x, 31.6, z);
      this.add(M.rust, g);
    }
    // Floor grates on the ledges, a few rungs set in the walls
    for (let i = 0; i < 9; i++) this.add(M.darkSteel, span(-128 + i * 3.5, SEW_Y, 1.4, -127.2 + i * 3.5, SEW_Y + 0.02, 2.4));
    // The outlet: a pipe mouth in the end wall, high up, black inside
    {
      const g = new THREE.CylinderGeometry(0.95, 0.95, 1.4, 20, 1, true);
      g.rotateZ(Math.PI / 2);
      g.translate(-133.3, 32.3, 0);
      this.add(M.rust, g);
      const ring = new THREE.TorusGeometry(0.98, 0.1, 8, 24);
      ring.rotateY(Math.PI / 2);
      ring.translate(-132.6, 32.3, 0);
      this.add(M.rust, ring);
      const back = new THREE.CircleGeometry(0.94, 20);
      back.rotateY(Math.PI / 2);
      back.translate(-133.95, 32.3, 0);
      this.add(M.black, back);
    }
    // Lights: caged bulkheads, sick green; real lights only a few
    const lamps: [number, number, number][] = [[-122, 33.8, -2.7], [-108, 33.8, 2.7], [-99, 33.8, -14], [-98, 33.8, -32], [-80, 33.8, -28.3], [-64, 33.8, -34.5]];
    for (const [x, y, z] of lamps) {
      this.add(M.greenLamp, box(0.5, 0.16, 0.22, x, y - 0.16, z));
      this.add(M.darkSteel, box(0.6, 0.06, 0.3, x, y - 0.02, z));
    }
    for (const [i, [x, y, z]] of lamps.entries()) {
      void i;
      const l = new THREE.PointLight(0x9cdc6a, 26, 22, 1.5);
      l.position.set(x, y - 0.4, z);
      this.group.add(l);
      this.sewerLights.push(l);
    }
    // ---- Rounder: brick vaults over the tunnels and rooms, springing from a metre up the walls
    const vault = (x0: number, z0: number, x1: number, z1: number): void => {
      const alongX = x1 - x0 >= z1 - z0;
      const len = alongX ? x1 - x0 : z1 - z0;
      const half = (alongX ? z1 - z0 : x1 - x0) / 2;
      const g = new THREE.CylinderGeometry(half, half, len, 20, 1, true, -Math.PI / 2, Math.PI);
      // Lying along the run, the open side down; squashed to fit under the 4 m ceiling
      g.rotateZ(Math.PI / 2);
      if (!alongX) g.rotateY(Math.PI / 2);
      g.scale(alongX ? 1 : 1, 2.95 / half, alongX ? 1 : 1);
      g.translate((x0 + x1) / 2, SEW_Y + 1.0, (z0 + z1) / 2);
      worldUVs(g, 2);
      const m = new THREE.Mesh(g, this.M.brick.clone());
      (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      this.group.add(m);
      // Ribs every few metres, the way old sewers are built
      for (let k = 2; k < len; k += 4) {
        const rib = new THREE.TorusGeometry(half - 0.05, 0.09, 4, 18, Math.PI);
        if (alongX) rib.rotateY(Math.PI / 2);
        rib.scale(1, 2.95 / half, 1);
        rib.translate(alongX ? x0 + k : (x0 + x1) / 2, SEW_Y + 1.0, alongX ? (z0 + z1) / 2 : z0 + k);
        this.add(M.darkConcrete, rib);
      }
    };
    vault(-133, -3, -105, 3);
    vault(-105, -5, -93, 5);
    vault(-102, -26, -96, -5);
    vault(-107, -38, -89, -26);
    vault(-89, -34, -66, -28);
    // ---- More pipes: down the walls, across the vaults, valves on them, one dribbling
    pipeRun(V(-118, 30, 2.75), V(-118, 34, 2.75), 0.18, M.rust);
    pipeRun(V(-110, 30, -2.75), V(-110, 33.6, -2.75), 0.12, M.pipe);
    pipeRun(V(-126, 33.2, -2.6), V(-126, 33.2, 2.6), 0.1, M.darkSteel);
    pipeRun(V(-104.5, 32.2, -4.6), V(-93.5, 32.2, -4.6), 0.2, M.pipe);
    pipeRun(V(-104.6, 30, 4.6), V(-104.6, 34, 4.6), 0.28, M.rust);
    pipeRun(V(-101.7, 31.6, -8), V(-101.7, 31.6, -24), 0.12, M.darkSteel);
    pipeRun(V(-106.5, 33.2, -27), V(-89.5, 33.2, -27), 0.3, M.pipe);
    pipeRun(V(-95, 30, -37.6), V(-95, 34, -37.6), 0.16, M.darkSteel);
    pipeRun(V(-80, 30, -33.6), V(-80, 34, -33.6), 0.22, M.rust);
    pipeRun(V(-74, 32.1, -28.4), V(-68, 32.1, -28.4), 0.1, M.darkSteel);
    const valveMat = new THREE.MeshStandardMaterial({ color: 0x9a2a1c, roughness: 0.5, metalness: 0.5 });
    for (const [x, y, z, ry] of [[-118, 31.4, 2.45, 0], [-104.3, 31.2, 4.3, 0], [-80, 31.3, -33.3, 0], [-95, 31.5, -37.3, 0], [-110, 31.6, -2.5, 0]] as const) {
      const w = new THREE.TorusGeometry(0.16, 0.025, 6, 14);
      w.rotateY(ry);
      w.translate(x, y, z);
      this.group.add(new THREE.Mesh(w, valveMat));
      this.add(M.darkSteel, box(0.04, 0.04, 0.18, x, y - 0.02, z));
    }
    // ---- Trash: crushed bottles, cans, wrappers, takeaway boxes, an apple core, newspaper —
    // on the ledges, and some of it floating in the sludge
    const bottleMat = new THREE.MeshStandardMaterial({ color: 0x9cc8e0, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.7 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2a6ad0, roughness: 0.5 });
    const canMats = [0xc8241c, 0x1c6ac8, 0xd8c020, 0x2a8a3a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.7 }));
    const paperMats = [0xe8e2d0, 0xd8c8a0, 0xffffff, 0xf0d040, 0xd03a2a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide }));
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xb8a070, roughness: 0.9 });
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xc8b070, roughness: 0.8 });
    const bottle = (() => {
      const g = new THREE.CylinderGeometry(0.035, 0.04, 0.22, 10, 4);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        // Crushed: squashed flat in the middle and kinked
        const y = p.getY(i);
        p.setZ(i, p.getZ(i) * (0.35 + 0.4 * Math.abs(Math.sin(y * 20))));
        p.setX(i, p.getX(i) + Math.sin(y * 30) * 0.008);
      }
      g.rotateZ(Math.PI / 2);
      g.computeVertexNormals();
      return g;
    })();
    const trashAt = (x: number, z: number, onSludge: boolean): void => {
      const y = onSludge ? SLUDGE_Y + 0.01 : SEW_Y;
      const k = Math.floor(r() * 7);
      const ry = r() * Math.PI * 2;
      let m: THREE.Mesh;
      if (k <= 1) {
        m = new THREE.Mesh(bottle, bottleMat);
        m.position.set(x, y + 0.03, z);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8), capMat);
        cap.rotation.z = Math.PI / 2;
        cap.position.set(0.12, 0, 0);
        m.add(cap);
      } else if (k === 2) {
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.07, 10), canMats[Math.floor(r() * canMats.length)]);
        m.scale.set(1, 0.5 + r() * 0.5, 1);
        m.rotation.z = Math.PI / 2;
        m.position.set(x, y + 0.03, z);
      } else if (k === 3) {
        // A takeaway box, lid open
        m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.22), boxMat);
        m.position.set(x, y + 0.03, z);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.01, 0.22), boxMat);
        lid.position.set(0, 0.06, -0.15);
        lid.rotation.x = -1.2;
        m.add(lid);
        const food = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.02, 8), new THREE.MeshStandardMaterial({ color: 0xa86a2a, roughness: 0.8 }));
        food.position.y = 0.03;
        m.add(food);
      } else if (k === 4) {
        m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), coreMat);
        m.scale.set(0.8, 1.3, 0.8);
        m.position.set(x, y + 0.03, z);
      } else {
        // Wrapper, newspaper: a crumpled sheet
        const g = new THREE.PlaneGeometry(0.25 + r() * 0.3, 0.2 + r() * 0.25, 4, 4);
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) p.setZ(i, (r() - 0.5) * 0.05);
        g.rotateX(-Math.PI / 2);
        g.computeVertexNormals();
        m = new THREE.Mesh(g, paperMats[Math.floor(r() * paperMats.length)]);
        m.position.set(x, y + 0.012, z);
      }
      m.rotation.y = ry;
      this.group.add(m);
      if (onSludge) this.floaters.push(m);
    };
    for (let i = 0; i < 140; i++) {
      const x = -132 + r() * 70;
      const z = -38 + r() * 42;
      const cx = Math.floor(x);
      const cz = Math.floor(z);
      if (!isOpen(cx, cz)) continue;
      const wet = isChan(cx, cz);
      if (wet && r() < 0.4) continue;
      trashAt(x, z, wet);
    }
    // Where the rats run: along the ledges, either side of the channel
    this.ratRuns.push(
      [V(-131, SEW_Y, 2.2), V(-102, SEW_Y, 2.2)],
      [V(-130, SEW_Y, -2.3), V(-104, SEW_Y, -2.3)],
      [V(-103, SEW_Y, -6), V(-103, SEW_Y, -25)],
      [V(-96.6, SEW_Y, -6), V(-96.6, SEW_Y, -25)],
      [V(-106, SEW_Y, -37), V(-90, SEW_Y, -37)],
      [V(-88, SEW_Y, -33.3), V(-67, SEW_Y, -33.3)],
      [V(-88, SEW_Y, -28.6), V(-68, SEW_Y, -28.6)]
    );

    // Muck heaped in corners, a dead rat's worth of debris
    for (let i = 0; i < 40; i++) {
      const x = -132 + r() * 70;
      const z = -38 + r() * 42;
      if (!isOpen(Math.floor(x), Math.floor(z)) || isChan(Math.floor(x), Math.floor(z))) continue;
      const g = new THREE.DodecahedronGeometry(0.12 + r() * 0.2, 0);
      g.scale(1, 0.4, 1);
      g.translate(x, SEW_Y + 0.03, z);
      this.add(M.sewerFloor, g);
    }
  }

  /** The chamber's ceiling hole and the shaft up from it to the recess in the hall's west wall. */
  private buildShaft(): void {
    const M = this.M;
    const top = H1;
    // Shaft walls, from the sewer ceiling up to the recess floor
    this.add(M.darkConcrete, span(-63.5, SEW_Y + 4, -32.5, -63, top, -29.5), true, 2);
    this.add(M.darkConcrete, span(-63, SEW_Y + 4, -32.5, -61, top, -32), true, 2);
    this.add(M.darkConcrete, span(-63, SEW_Y + 4, -30, -61, top, -29.5), true, 2);
    // The recess: floor round the hole, its walls and roof, open to the hall
    for (const [x0, z0, x1, z1] of [[-66, -34, -63, -28], [-61, -34, -60, -28], [-63, -34, -61, -32], [-63, -30, -61, -28]] as const) {
      this.add(M.concrete, span(x0, top - 0.4, z0, x1, top, z1), true, 2);
    }
    this.add(M.darkConcrete, span(-67, top - 0.4, -35, -66, top + 3.8, -27), true, 3);
    this.add(M.darkConcrete, span(-66, top - 0.4, -35, -61, top + 3.8, -34), true, 3);
    this.add(M.darkConcrete, span(-66, top - 0.4, -28, -61, top + 3.8, -27), true, 3);
    this.add(M.darkConcrete, span(-67, top + 3.5, -35, -60, top + 4.1, -27), true, 3);
    // A hatch, flung open against the recess wall
    this.add(M.darkSteel, span(-62.9, top, -33.9, -61.1, top + 2.0, -33.8));
    this.add(M.lamp, box(0.4, 0.12, 0.2, -63.5, top + 3.3, -28.2));
    // The ladder up the shaft: on its east face
    this.ladderMesh(V(-61.05, SEW_Y, -31), -Math.PI / 2, top - SEW_Y + 1.1);
  }

  /**
   * A ladder's rails and rungs: `at` its foot, against whatever it's fixed to
   * on the side `face` points away from (the climber faces `face`), `h` tall.
   */
  private ladderMesh(at: THREE.Vector3, face: number, h: number, cage = false): void {
    const M = this.M;
    const fx = -Math.sin(face);
    const fz = -Math.cos(face);
    const sx = Math.cos(face);
    const sz = -Math.sin(face);
    const off = 0.08; // proud of the wall, toward the climber (he faces `face`, so back along it)
    for (const s of [-0.24, 0.24]) {
      const g = new THREE.BoxGeometry(0.065, h, 0.08);
      g.translate(at.x + sx * s - fx * off, at.y + h / 2, at.z + sz * s - fz * off);
      this.add(M.yellow, g);
    }
    for (let y = 0.3; y < h; y += 0.3) {
      const g = new THREE.CylinderGeometry(0.024, 0.024, 0.48, 6);
      g.rotateZ(Math.PI / 2);
      g.rotateY(face);
      g.translate(at.x - fx * off, at.y + y, at.z - fz * off);
      this.add(M.yellow, g);
    }
    // A lamp at the top and a glow at the foot, so he can find it
    this.add(M.lamp, box(0.36, 0.14, 0.14, at.x - fx * off, at.y + h + 0.05, at.z - fz * off));
    this.add(M.hazard, box(Math.abs(fx) > 0.5 ? 0.02 : 0.62, 0.3, Math.abs(fx) > 0.5 ? 0.62 : 0.02, at.x - fx * (off + 0.02), at.y + 1.6, at.z - fz * (off + 0.02)));
    this.ladderTops.push(V(at.x - fx * 0.5, at.y + h + 0.4, at.z - fz * 0.5));
    if (cage) {
      for (let y = 2.4; y < h; y += 0.9) {
        const ring = new THREE.TorusGeometry(0.42, 0.018, 4, 16, Math.PI);
        ring.rotateX(Math.PI / 2);
        ring.rotateY(face + Math.PI / 2);
        ring.translate(at.x - fx * 0.3, at.y + y, at.z - fz * 0.3);
        this.add(M.yellow, ring);
      }
    }
  }

  // -------------------------------------------------------------- the hall

  private buildHall(): void {
    const M = this.M;
    const { x0, x1, z0, z1, top, bottom } = HALL;
    // Walls (the west one round the recess's opening, the east one round the door)
    this.add(M.concrete, span(x0 - 1, bottom, z0, x0, H1 - 0.4, z1), true, 8);
    this.add(M.concrete, span(x0 - 1, H1 + 3.5, z0, x0, top, z1), true, 8);
    this.add(M.concrete, span(x0 - 1, H1 - 0.4, z0, x0, H1 + 3.5, -34), true, 8);
    this.add(M.concrete, span(x0 - 1, H1 - 0.4, -28, x0, H1 + 3.5, z1), true, 8);
    this.add(M.concrete, span(x1, bottom, z0, x1 + 1, H3, z1), true, 8);
    this.add(M.concrete, span(x1, H3 + 4, z0, x1 + 1, top, z1), true, 8);
    this.add(M.concrete, span(x1, H3, z0, x1 + 1, H3 + 4, 42), true, 8);
    this.add(M.concrete, span(x1, H3, 46, x1 + 1, H3 + 4, z1), true, 8);
    this.add(M.concrete, span(x0, bottom, z0 - 1, x1, top, z0), true, 8);
    this.add(M.concrete, span(x0, bottom, z1, x1, top, z1 + 1), true, 8);
    this.add(M.darkConcrete, span(x0, top, z0, x1, top + 1, z1), true, 8);
    // Pilasters and string courses on the walls: scale for the eye
    for (let z = z0 + 10; z < z1; z += 20) {
      for (const x of [x0, x1 - 1.2]) this.add(M.darkConcrete, span(x, bottom, z - 1, x + 1.2, top, z + 1), false, 4);
    }
    for (let x = x0 + 10; x < x1; x += 20) {
      for (const z of [z0, z1 - 1.2]) this.add(M.darkConcrete, span(x - 1, bottom, z, x + 1, top, z + 1.2), false, 4);
    }
    for (const y of [20, 40, 70]) {
      this.add(M.darkConcrete, span(x0, y, z0, x0 + 0.6, y + 0.8, z1), false, 4);
      this.add(M.darkConcrete, span(x1 - 0.6, y, z0, x1, y + 0.8, z1), false, 4);
      this.add(M.darkConcrete, span(x0, y, z0, x1, y + 0.8, z0 + 0.6), false, 4);
      this.add(M.darkConcrete, span(x0, y, z1 - 0.6, x1, y + 0.8, z1), false, 4);
    }
    // Columns up out of the abyss to the roof
    for (const [x, z] of [[-45, -56], [-10, -56], [25, -56], [48, -22], [-48, 26], [-14, 54], [16, 60], [46, 62], [-42, 58], [16, -14], [-6, -30]] as const) {
      this.add(M.concrete, span(x - 2, bottom, z - 2, x + 2, top, z + 2), false, 6);
      for (const y of [H1 - 6, H2 + 10, 80]) this.add(M.darkConcrete, span(x - 2.4, y, z - 2.4, x + 2.4, y + 1.2, z + 2.4), false, 6);
    }
    // Roof trusses: deep steel girders across, and lights hung from them
    for (let z = z0 + 8; z < z1; z += 16) {
      this.add(M.darkSteel, span(x0, top - 2.4, z - 0.25, x1, top - 0.2, z + 0.25));
      this.add(M.darkSteel, span(x0, top - 2.6, z - 0.5, x1, top - 2.4, z + 0.5));
    }
    for (let x = x0 + 15; x < x1; x += 30) this.add(M.darkSteel, span(x - 0.3, top - 3.2, z0, x + 0.3, top - 2.6, z1));
    // Skylight panels in the roof: cold light through them
    for (let x = -45; x <= 45; x += 30) {
      for (let z = -50; z <= 50; z += 33) this.add(M.lamp, span(x - 4, top - 0.25, z - 6, x + 4, top - 0.2, z + 6));
    }
    // Fog layers over the abyss, deeper and deeper
    const fogTex = new THREE.CanvasTexture(fogCanvas());
    fogTex.wrapS = fogTex.wrapT = THREE.RepeatWrapping;
    fogTex.repeat.set(3, 3);
    for (const [y, a, c] of [[34, 0.45, 0x707672], [26, 0.6, 0x5a605c], [18, 0.75, 0x464b48], [10, 0.9, 0x343836], [0, 1, 0x232624]] as const) {
      const mat = new THREE.MeshBasicMaterial({ map: fogTex, color: c, transparent: true, opacity: a, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, y, 0);
      m.renderOrder = 3;
      this.group.add(m);
      this.fogLayers.push(m);
    }
    // Hall lights: a few, on the route
    for (const [x, y, z, k] of [[-44, H1 + 6, -31, 40], [-30, H1 + 6, 0, 30], [2, H2 + 7, 22, 36], [30, H3 + 6, 38, 34], [52, H3 + 6, 44, 34], [-14, H2 + 7, 10, 28]] as const) {
      const l = new THREE.PointLight(0xdfe6ee, k, 34, 1.4);
      l.position.set(x, y, z);
      this.group.add(l);
      this.hallLights.push(l);
    }
  }

  // -------------------------------------------------------------- the route

  /** A run of perforated decking with stringers under it and rails as asked. Solid where it's walked. */
  private walkway(w: WalkwaySpec): void {
    const M = this.M;
    const { x0, z0, x1, z1, y } = w;
    const alongX = x1 - x0 >= z1 - z0;
    // Deck: the grating, a thin plate the eye sees through
    const deck = span(x0, y - 0.04, z0, x1, y, z1);
    this.add(M.grating, deck, false, 1.5);
    this.solidBox(x0, y - 0.25, z0, x1, y, z1);
    // Stringers along both long edges, cross-members under it
    if (alongX) {
      for (const z of [z0, z1 - 0.12]) this.add(M.darkSteel, span(x0, y - 0.32, z, x1, y - 0.02, z + 0.12));
      for (let x = x0 + 0.6; x < x1; x += 1.5) this.add(M.darkSteel, span(x - 0.05, y - 0.26, z0, x + 0.05, y - 0.06, z1));
    } else {
      for (const x of [x0, x1 - 0.12]) this.add(M.darkSteel, span(x, y - 0.32, z0, x + 0.12, y - 0.02, z1));
      for (let z = z0 + 0.6; z < z1; z += 1.5) this.add(M.darkSteel, span(x0, y - 0.26, z - 0.05, x1, y - 0.06, z + 0.05));
    }
    // Rails
    const rail = (side: '-' | '+'): void => {
      if (alongX) {
        const z = side === '-' ? z0 + 0.04 : z1 - 0.04;
        for (let x = x0 + 0.05; x <= x1; x += 1.5) this.add(M.yellow, span(x - 0.03, y, z - 0.03, x + 0.03, y + 1.1, z + 0.03));
        this.add(M.yellow, span(x0, y + 1.06, z - 0.03, x1, y + 1.12, z + 0.03));
        this.add(M.yellow, span(x0, y + 0.55, z - 0.02, x1, y + 0.59, z + 0.02));
        this.add(M.hazard, span(x0, y, z - 0.015, x1, y + 0.12, z + 0.015), false, 0.5);
        this.solidBox(x0, y, z - 0.08, x1, y + 1.12, z + 0.08);
      } else {
        const x = side === '-' ? x0 + 0.04 : x1 - 0.04;
        for (let z = z0 + 0.05; z <= z1; z += 1.5) this.add(M.yellow, span(x - 0.03, y, z - 0.03, x + 0.03, y + 1.1, z + 0.03));
        this.add(M.yellow, span(x - 0.03, y + 1.06, z0, x + 0.03, y + 1.12, z1));
        this.add(M.yellow, span(x - 0.02, y + 0.55, z0, x + 0.02, y + 0.59, z1));
        this.add(M.hazard, span(x - 0.015, y, z0, x + 0.015, y + 0.12, z1), false, 0.5);
        this.solidBox(x - 0.08, y, z0, x + 0.08, y + 1.12, z1);
      }
    };
    if (w.rails === 'both' || w.rails === '-') rail('-');
    if (w.rails === 'both' || w.rails === '+') rail('+');
    // Hangers: rods up to the roof, every so often (the whole route hangs)
    const n = Math.max(1, Math.floor(Math.max(x1 - x0, z1 - z0) / 12));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const hx = alongX ? x0 + (x1 - x0) * k : x0;
      const hz = alongX ? z0 : z0 + (z1 - z0) * k;
      const hx2 = alongX ? hx : x1;
      const hz2 = alongX ? z1 : hz;
      for (const [px, pz] of i % 2 ? [[hx, hz]] : [[hx2, hz2]]) this.add(M.darkSteel, span(px - 0.03, y + 1.1, pz - 0.03, px + 0.03, HALL.top - 2.4, pz + 0.03));
    }
  }

  /** A square platform: deck, a heavier frame, rails on the sides asked for, legs down into the dark. */
  private platform(x0: number, z0: number, x1: number, z1: number, y: number, rails: string): void {
    const M = this.M;
    this.add(M.grating, span(x0, y - 0.04, z0, x1, y, z1), false, 1.5);
    this.solidBox(x0, y - 0.3, z0, x1, y, z1);
    this.add(M.darkSteel, span(x0, y - 0.4, z0, x1, y - 0.04, z0 + 0.2));
    this.add(M.darkSteel, span(x0, y - 0.4, z1 - 0.2, x1, y - 0.04, z1));
    this.add(M.darkSteel, span(x0, y - 0.4, z0, x0 + 0.2, y - 0.04, z1));
    this.add(M.darkSteel, span(x1 - 0.2, y - 0.4, z0, x1, y - 0.04, z1));
    // Rails: each letter a whole side (n = −z, s = +z, w = −x, e = +x)
    for (const s of rails) {
      if (s === 'n') this.walkRail(x0, z0, x1, z0 + 0.08, y);
      if (s === 's') this.walkRail(x0, z1 - 0.08, x1, z1, y);
      if (s === 'w') this.walkRail(x0, z0, x0 + 0.08, z1, y);
      if (s === 'e') this.walkRail(x1 - 0.08, z0, x1, z1, y);
    }
    // Legs: a steel trestle at each corner going down into the fog
    for (const [x, z] of [[x0 + 0.3, z0 + 0.3], [x1 - 0.3, z0 + 0.3], [x0 + 0.3, z1 - 0.3], [x1 - 0.3, z1 - 0.3]]) {
      this.add(M.darkSteel, span(x - 0.15, -10, z - 0.15, x + 0.15, y - 0.3, z + 0.15));
    }
    for (let yy = y - 6; yy > 0; yy -= 8) {
      this.add(M.darkSteel, span(x0 + 0.3, yy, z0 + 0.25, x1 - 0.3, yy + 0.2, z0 + 0.35));
      this.add(M.darkSteel, span(x0 + 0.3, yy, z1 - 0.35, x1 - 0.3, yy + 0.2, z1 - 0.25));
    }
  }

  /** A short rail along a box footprint (one side of a platform). */
  private walkRail(x0: number, z0: number, x1: number, z1: number, y: number): void {
    const M = this.M;
    const alongX = x1 - x0 > z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    for (let k = 0; k <= len; k += 1.5) {
      const x = alongX ? x0 + k : (x0 + x1) / 2;
      const z = alongX ? (z0 + z1) / 2 : z0 + k;
      this.add(M.yellow, span(x - 0.03, y, z - 0.03, x + 0.03, y + 1.1, z + 0.03));
    }
    if (alongX) {
      const z = (z0 + z1) / 2;
      this.add(M.yellow, span(x0, y + 1.06, z - 0.03, x1, y + 1.12, z + 0.03));
      this.add(M.yellow, span(x0, y + 0.55, z - 0.02, x1, y + 0.59, z + 0.02));
    } else {
      const x = (x0 + x1) / 2;
      this.add(M.yellow, span(x - 0.03, y + 1.06, z0, x + 0.03, y + 1.12, z1));
      this.add(M.yellow, span(x - 0.02, y + 0.55, z0, x + 0.02, y + 0.59, z1));
    }
    this.solidBox(x0 - 0.04, y, z0 - 0.04, x1 + 0.04, y + 1.12, z1 + 0.04);
  }

  /** Cover from the turrets: two crates, one on the other, head high (they fire down from well above). */
  private coverStack(x: number, y: number, z: number, s: number): void {
    this.crate(x, y, z, s, 1.05);
    this.crate(x, y + 1.05, z, s * 0.92, 0.95);
  }

  private crate(x: number, y: number, z: number, s = 1.1, h = 1.1): void {
    const g = new THREE.BoxGeometry(s, h, s);
    g.translate(x, y + h / 2, z);
    this.add(this.M.crate, g, true);
  }

  /** A vat: a steel drum on legs with a glass band showing what's inside it glowing. */
  private vat(x: number, y: number, z: number, r: number, h: number, colour: number, solid = true): void {
    const M = this.M;
    this.add(M.steel, (() => {
      const g = new THREE.CylinderGeometry(r, r, h * 0.3, 20);
      g.translate(x, y + 0.4 + h * 0.15, z);
      return g;
    })());
    this.add(M.steel, (() => {
      const g = new THREE.CylinderGeometry(r, r * 0.9, h * 0.25, 20);
      g.translate(x, y + 0.4 + h * 0.75 + h * 0.125, z);
      return g;
    })());
    const dome = new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.4, 1);
    dome.translate(x, y + 0.4 + h, z);
    this.add(M.darkSteel, dome);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + 0.4;
      this.add(M.darkSteel, span(x + Math.cos(a) * r * 0.8 - 0.06, y, z + Math.sin(a) * r * 0.8 - 0.06, x + Math.cos(a) * r * 0.8 + 0.06, y + 0.45, z + Math.sin(a) * r * 0.8 + 0.06));
    }
    // The glass band, and the stuff in it: lit from within
    const glow = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 1.4, roughness: 0.1, transparent: true, opacity: 0.85 });
    this.vatGlow.push(glow);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.002, r * 1.002, h * 0.45, 20, 1, true), glow);
    band.position.set(x, y + 0.4 + h * 0.3 + h * 0.225, z);
    this.group.add(band);
    // Pipes off the top
    this.add(M.pipe, (() => {
      const g = new THREE.CylinderGeometry(0.08, 0.08, 3, 8);
      g.translate(x + r * 0.4, y + 0.4 + h + 1.5, z);
      return g;
    })());
    if (solid) this.solidBox(x - r, y, z - r, x + r, y + 0.4 + h, z + r);
  }

  /**
   * The route, start to finish; and the things on it the scene drives:
   * ladders, the turrets' mounts, the lever and the platform it calls, the door.
   */
  private buildRoute(): { ladders: Ladder[]; turrets: TurretSite[]; lever: Level13Data['lever']; mover: Level13Data['mover']; door: Level13Data['door'] } {
    const M = this.M;
    const ladders: Ladder[] = [];
    // Up the shaft from the sewer, against the hall's wall
    ladders.push({ base: V(-61.75, SEW_Y, -31), face: -Math.PI / 2, top: H1, off: V(-60.4, H1, -31) });
    // ---- 0: out of the recess onto the first platform
    this.platform(-60, -34, -53, -28, H1, 'ns');
    this.crate(-55, H1, -33.2, 1.1, 1.1);
    // S1, east, railed both sides; crates on its north side to duck behind
    this.walkway({ x0: -53, z0: -32.1, x1: -36, z1: -29.9, y: H1, rails: 'both' });
    this.coverStack(-48.5, H1, -31.5, 1.0);
    this.coverStack(-42, H1, -31.5, 1.0);
    // ---- 1: the first junction, crates and a vat on it
    this.platform(-36, -36, -28, -27, H1, 'nw');
    this.crate(-35, H1, -35, 1.1, 1.1);
    this.crate(-35, H1, -35, 0.9, 2.1);
    this.crate(-29.3, H1, -34.8, 1.1, 1.1);
    this.vat(-29.6, H1, -29.6, 0.9, 2.4, 0x7dff5a);
    // S2, south, no rails at all
    this.walkway({ x0: -32.9, z0: -27, x1: -31.1, z1: -3, y: H1, rails: 'none' });
    this.coverStack(-31.55, H1, -19, 0.9);
    this.coverStack(-31.55, H1, -10, 0.9);
    // ---- 2: the platform at its end, and the ladder up to 3
    this.platform(-36, -3, -28, 5.4, H1, 'we');
    this.crate(-34.8, H1, -1.8, 1.1, 1.1);
    ladders.push({ base: V(-32, H1, 5.0), face: Math.PI, top: H2, off: V(-32, H2, 7.2) });
    this.ladderMesh(V(-32, H1, 5.8), Math.PI, H2 - H1 + 1.1, true);
    // ---- 3: above, and the span east that's been broken
    this.platform(-36, 5.8, -28, 13, H2, 'nws');
    this.walkway({ x0: -28, z0: 9, x1: -19.5, z1: 11, y: H2, rails: '+' });
    // The gap: the walkway's gone between x −19.5 and −9.5, and its ends torn and hanging
    this.add(M.darkSteel, (() => {
      const g = new THREE.BoxGeometry(2.4, 0.06, 1.8);
      g.rotateZ(-0.9);
      g.translate(-18.9, H2 - 1.0, 10);
      return g;
    })());
    this.add(M.darkSteel, (() => {
      const g = new THREE.BoxGeometry(2.2, 0.06, 1.8);
      g.rotateZ(0.8);
      g.translate(-10.1, H2 - 0.9, 10);
      return g;
    })());
    // Beams to jump across: I-beams left from the old frame, at odd heights and lines
    const beams: [number, number, number, number][] = [
      [-18.0, -14.8, 10.1, H2 - 0.05],
      [-13.3, -10.3, 9.8, H2 + 0.2]
    ];
    for (const [a, b, z, y] of beams) {
      this.add(M.rust, span(a, y - 0.06, z - 0.22, b, y, z + 0.22));
      this.add(M.rust, span(a, y - 0.42, z - 0.04, b, y - 0.06, z + 0.04));
      this.add(M.rust, span(a, y - 0.48, z - 0.22, b, y - 0.42, z + 0.22));
      this.solidBox(a, y - 0.48, z - 0.3, b, y, z + 0.3);
      // Hanging off chains from the roof
      for (const x of [a + 0.2, b - 0.2]) this.add(M.darkSteel, span(x - 0.02, y, z - 0.02, x + 0.02, HALL.top - 2.4, z + 0.02));
    }
    this.walkway({ x0: -9.5, z0: 9, x1: -2, z1: 11, y: H2, rails: '+' });
    // ---- 4: the middle platform
    this.platform(-2, 6, 6, 14, H2, 'ne');
    this.vat(4.4, H2, 7.6, 0.8, 2.2, 0xb35cff);
    this.crate(-1, H2, 7.2, 1.1, 1.1);
    // S4, south, railed, crates on its east side against the turret
    this.walkway({ x0: 1, z0: 14, x1: 3, z1: 30, y: H2, rails: 'both' });
    this.coverStack(2.45, H2, 18.5, 0.9);
    this.coverStack(2.45, H2, 25, 0.9);
    // ---- 5: the lever platform, and the gap east of it
    this.platform(-2, 30, 6, 38, H2, 'nws');
    const leverAt = V(-1.2, H2, 34);
    const lever = this.leverPost(leverAt);
    // The platform it calls: parked against 6 to start with
    const size = V(5, 0.3, 5.6);
    const from = V(23.5, H2, 34);
    const to = V(8.5, H2, 34);
    const mover = this.moverPlatform(size, from);
    // The gantry it hangs from
    for (const z of [31, 37]) {
      this.add(M.darkSteel, span(5, H2 + 7.4, z - 0.3, 27, H2 + 8, z + 0.3));
      this.add(M.hazard, span(5, H2 + 7.25, z - 0.31, 27, H2 + 7.4, z + 0.31), false, 1);
    }
    // ---- 6 and the ladder up to 7
    this.platform(26, 30, 34, 39.2, H2, 'ne');
    // Its south rail with a gap where the ladder goes up
    this.walkRail(26, 39.12, 29.2, 39.2, H2);
    this.walkRail(30.8, 39.12, 34, 39.2, H2);
    this.crate(32.9, H2, 31.2, 1.1, 1.1);
    ladders.push({ base: V(30, H2, 39.0), face: Math.PI, top: H3, off: V(30, H3, 41.4) });
    this.ladderMesh(V(30, H2, 39.8), Math.PI, H3 - H2 + 1.1, true);
    // ---- 7, and the last long walkway east under the turret
    this.platform(26, 40, 34, 48, H3, 'nws');
    this.vat(27.4, H3, 46.5, 0.8, 2.0, 0x7dff5a);
    this.walkway({ x0: 34, z0: 42.9, x1: 52, z1: 45.1, y: H3, rails: '+' });
    for (const x of [38, 43.5, 48.5]) this.coverStack(x, H3, 43.45, 0.9);
    // ---- 8: the last platform, against the east wall, the door in it
    this.platform(52, 38, 60, 50, H3, 'ns');
    this.crate(53.2, H3, 39.2, 1.1, 1.1);
    this.crate(53.2, H3, 39.2, 0.9, 2.1);
    this.vat(54, H3, 48.4, 0.7, 1.8, 0xb35cff);
    const door = this.buildDoor();
    // ---- The turrets' mounts are the scene's (it builds the guns); here, the sites
    const turrets: TurretSite[] = [
      // Each sweeps one walkway and nothing else: the platforms between them are never in two beams
      // (or any), so there's always somewhere to wait. S1 only — not the first junction:
      { pos: V(-44.5, H1 + 7, -50), yaw: Math.PI + 0.1, half: 0.3, rate: 0.5, pitch: -0.3, mount: 'post' },
      // S2's middle stretch, clear of both ends
      { pos: V(-17, H1 + 6, -15), yaw: 1.75, half: 0.42, rate: 0.42, pitch: -0.28, mount: 'post' },
      // S4, short of the platforms at either end
      { pos: V(17, H2 + 7, 22), yaw: 1.57, half: 0.42, rate: 0.45, pitch: -0.35, mount: 'post' },
      // S5
      { pos: V(43, H3 + 8, 25), yaw: Math.PI, half: 0.4, rate: 0.45, pitch: -0.34, mount: 'post' }
    ];
    // Their posts: steel columns up from the abyss, a bracket out to the gun
    for (const t of turrets) {
      this.add(M.darkSteel, span(t.pos.x - 0.35, -10, t.pos.z - 0.35, t.pos.x + 0.35, t.pos.y - 0.6, t.pos.z + 0.35));
      this.add(M.hazard, span(t.pos.x - 0.37, t.pos.y - 2.2, t.pos.z - 0.37, t.pos.x + 0.37, t.pos.y - 1.6, t.pos.z + 0.37), false, 0.6);
      this.add(M.darkSteel, span(t.pos.x - 0.8, t.pos.y - 0.75, t.pos.z - 0.8, t.pos.x + 0.8, t.pos.y - 0.6, t.pos.z + 0.8));
    }
    return { ladders, turrets, lever, mover, door };
  }

  private leverPost(at: THREE.Vector3): Level13Data['lever'] {
    const M = this.M;
    this.add(M.darkSteel, span(at.x - 0.25, at.y, at.z - 0.25, at.x + 0.25, at.y + 1.0, at.z + 0.25), true);
    this.add(M.hazard, span(at.x - 0.26, at.y + 0.2, at.z - 0.26, at.x + 0.26, at.y + 0.5, at.z + 0.26), false, 0.6);
    const pivot = new THREE.Group();
    pivot.position.set(at.x + 0.26, at.y + 0.9, at.z);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), M.steel);
    arm.position.y = 0.35;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0xb8261c, roughness: 0.4 }));
    knob.position.y = 0.72;
    pivot.add(arm, knob);
    pivot.rotation.z = 0.7;
    this.group.add(pivot);
    // A lamp on the post: red until it's pulled
    return { pivot, at: at.clone().setY(at.y + 1) };
  }

  /** The platform that rides the gantry: a deck, rails at its ends, cables up to its trolley. */
  private moverPlatform(size: THREE.Vector3, at: THREE.Vector3): Level13Data['mover'] {
    const M = this.M;
    const g = new THREE.Group();
    g.position.copy(at);
    const hx = size.x / 2;
    const hz = size.z / 2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(size.x, 0.06, size.z), M.grating);
    deck.position.y = -0.03;
    const frame = new THREE.Mesh(
      merge([span(-hx, -0.4, -hz, hx, -0.05, -hz + 0.2), span(-hx, -0.4, hz - 0.2, hx, -0.05, hz), span(-hx, -0.4, -hz, -hx + 0.2, -0.05, hz), span(hx - 0.2, -0.4, -hz, hx, -0.05, hz)]),
      M.yellow
    );
    const rails = new THREE.Mesh(
      merge([
        ...[-hz + 0.04, hz - 0.04].flatMap((z) => [span(-hx, 1.06, z - 0.03, hx, 1.12, z + 0.03), span(-hx, 0.55, z - 0.02, hx, 0.59, z + 0.02), ...[-hx + 0.05, 0, hx - 0.05].map((x) => span(x - 0.03, 0, z - 0.03, x + 0.03, 1.1, z + 0.03))])
      ]),
      M.yellow
    );
    const cables = new THREE.Mesh(merge([-hx + 0.2, hx - 0.2].flatMap((x) => [-hz + 0.1, hz - 0.1].map((z) => span(x - 0.02, 1.1, z - 0.02, x + 0.02, 7.4, z + 0.02)))), M.darkSteel);
    const trolley = new THREE.Mesh(merge([span(-hx, 7.4, -hz - 0.3, hx, 7.9, -hz + 0.5), span(-hx, 7.4, hz - 0.5, hx, 7.9, hz + 0.3)]), M.darkSteel);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0x332200, emissive: 0xffa21a, emissiveIntensity: 3 }));
    beacon.position.set(hx - 0.3, 1.25, -hz + 0.3);
    beacon.name = 'beacon';
    g.add(deck, frame, rails, cables, trolley, beacon);
    for (const m of [deck, frame, rails]) {
      m.userData.surface = 'metal';
      this.shootables.push(m);
    }
    this.group.add(g);
    const collider: Collider = { box: new THREE.Box3() };
    this.colliders.push(collider);
    return { group: g, collider, from: at.clone(), to: V(8.5, at.y, at.z), size };
  }

  /** The blast door in the east wall at the end of the route: its frame, its slab (it gets blown in). */
  private buildDoor(): Level13Data['door'] {
    const M = this.M;
    const x = HALL.x1;
    const z = 44;
    const y = H3;
    // Frame: heavy steel jambs and a lintel with hazard stripes, a red lamp over it
    this.add(M.darkSteel, span(x - 0.35, y, z - 2.3, x + 0.2, y + 4.3, z - 1.9));
    this.add(M.darkSteel, span(x - 0.35, y, z + 1.9, x + 0.2, y + 4.3, z + 2.3));
    this.add(M.hazard, span(x - 0.35, y + 3.8, z - 2.3, x + 0.2, y + 4.3, z + 2.3), false, 0.8);
    this.add(M.black, span(x + 0.3, y, z - 2, x + 0.4, y + 4, z + 2));
    const slab = new THREE.Group();
    const tex = new THREE.CanvasTexture(doorCanvas());
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.8, 3.8), [M.darkSteel, face, M.darkSteel, M.darkSteel, M.darkSteel, M.darkSteel]);
    // The face material on its −X side (toward the hall)
    (body.material as THREE.Material[])[0] = M.darkSteel;
    (body.material as THREE.Material[])[1] = face;
    body.rotation.y = Math.PI;
    slab.add(body);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 20), M.steel);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(-0.2, -0.3, 0.9);
    slab.add(wheel);
    slab.position.set(x + 0.05, y + 1.9, z);
    body.userData.surface = 'metal';
    this.shootables.push(body);
    this.group.add(slab);
    const collider = this.solidBox(x - 0.15, y, z - 2, x + 0.3, y + 3.9, z + 2);
    const warn = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2010, emissiveIntensity: 3 }));
    warn.position.set(x - 0.3, y + 4.6, z);
    this.group.add(warn);
    return { slab, collider, front: V(x - 1.6, y, z), plant: V(x - 0.2, y + 1.15, z + 0.75) };
  }

  // -------------------------------------------------------------- the abyss

  /**
   * Far down in the fog: rails on trestles both ways across the whole floor
   * of the place, at three depths, tank cars and hoppers running on them; the
   * glow of what's in them coming up through the murk.
   */
  private buildAbyss(): void {
    const M = this.M;
    const r = lcg(41);
    const tankMats = [
      new THREE.MeshStandardMaterial({ color: 0x2c4a22, emissive: 0x6cff3a, emissiveIntensity: 1.1, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x3a2050, emissive: 0xa64cff, emissiveIntensity: 1.1, roughness: 0.4 })
    ];
    const tankGeo = new THREE.CylinderGeometry(1.1, 1.1, 4.2, 14);
    tankGeo.rotateZ(Math.PI / 2);
    const carGeo = merge([span(-2.6, 0, -1.2, 2.6, 0.5, 1.2), span(-2.4, -0.3, -1.0, -1.6, 0, 1.0), span(1.6, -0.3, -1.0, 2.4, 0, 1.0)]);
    const levels = [
      { y: 14, along: 'x' as const, lines: [-48, -24, 2, 28, 52] },
      { y: 4, along: 'z' as const, lines: [-50, -26, -2, 22, 46] },
      { y: -6, along: 'x' as const, lines: [-36, -12, 14, 40] },
      { y: -16, along: 'z' as const, lines: [-40, -14, 12, 38] }
    ];
    for (const lv of levels) {
      for (const c of lv.lines) {
        const len = lv.along === 'x' ? HALL.x1 - HALL.x0 : HALL.z1 - HALL.z0;
        // Twin rails on a deck, trestles down every 12 m
        if (lv.along === 'x') {
          this.add(M.darkSteel, span(HALL.x0, lv.y - 0.5, c - 1.6, HALL.x1, lv.y - 0.2, c + 1.6));
          for (const s of [-0.75, 0.75]) this.add(M.steel, span(HALL.x0, lv.y - 0.2, c + s - 0.06, HALL.x1, lv.y, c + s + 0.06));
          for (let x = HALL.x0 + 6; x < HALL.x1; x += 12) this.add(M.darkSteel, span(x - 0.3, lv.y - 40, c - 1.4, x + 0.3, lv.y - 0.5, c + 1.4));
        } else {
          this.add(M.darkSteel, span(c - 1.6, lv.y - 0.5, HALL.z0, c + 1.6, lv.y - 0.2, HALL.z1));
          for (const s of [-0.75, 0.75]) this.add(M.steel, span(c + s - 0.06, lv.y - 0.2, HALL.z0, c + s + 0.06, lv.y, HALL.z1));
          for (let z = HALL.z0 + 6; z < HALL.z1; z += 12) this.add(M.darkSteel, span(c - 1.4, lv.y - 40, z - 0.3, c + 1.4, lv.y - 0.5, z + 0.3));
        }
        // Signal lamps along it
        for (let k = 8; k < len; k += 16) {
          const p = lv.along === 'x' ? V(HALL.x0 + k, lv.y + 0.2, c + 1.7) : V(c + 1.7, lv.y + 0.2, HALL.z0 + k);
          this.add(r() < 0.5 ? M.greenLamp : M.lamp, box(0.2, 0.2, 0.2, p.x, p.y, p.z));
        }
        // Cars on it: two to four, each a flat with tanks
        const n = 2 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) {
          const car = new THREE.Group();
          const flat = new THREE.Mesh(carGeo, M.darkSteel);
          car.add(flat);
          const k = 1 + Math.floor(r() * 2);
          for (let j = 0; j < k; j++) {
            const t = new THREE.Mesh(tankGeo, tankMats[Math.floor(r() * 2)]);
            t.position.set(0, 1.6 + j * 2.2, 0);
            if (k === 2) t.scale.setScalar(0.85);
            car.add(t);
          }
          if (lv.along === 'z') car.rotation.y = Math.PI / 2;
          car.position.set(lv.along === 'x' ? 0 : c, lv.y, lv.along === 'x' ? c : 0);
          this.group.add(car);
          const from = lv.along === 'x' ? HALL.x0 - 6 : HALL.z0 - 6;
          const to = lv.along === 'x' ? HALL.x1 + 6 : HALL.z1 + 6;
          this.carts.push({ obj: car, axis: lv.along, from, to, speed: (3 + r() * 4) * (r() < 0.5 ? 1 : -1), u: r() });
        }
      }
    }
    // A glow down there: lamps over the deepest level (no real lights: emissive only, the fog does the rest)
    for (let i = 0; i < 26; i++) {
      this.add(r() < 0.5 ? M.greenLamp : M.lamp, box(0.8, 0.3, 0.8, HALL.x0 + 6 + r() * 108, -20 + r() * 6, HALL.z0 + 6 + r() * 128));
    }
  }

  /** Pipes up the walls, hung chains, a crane, signage, perimeter walkways up high. */
  private buildHallDressing(): void {
    const M = this.M;
    const r = lcg(97);
    // Big risers up the walls
    for (let i = 0; i < 18; i++) {
      const onX = i % 2 === 0;
      const side = r() < 0.5 ? -1 : 1;
      const k = -60 + r() * 120;
      const rad = 0.3 + r() * 0.5;
      const g = new THREE.CylinderGeometry(rad, rad, HALL.top - HALL.bottom, 12);
      const x = onX ? (side < 0 ? HALL.x0 + rad + 0.7 : HALL.x1 - rad - 0.7) : THREE.MathUtils.clamp(k, -55, 55);
      const z = onX ? THREE.MathUtils.clamp(k, -65, 65) : side < 0 ? HALL.z0 + rad + 0.7 : HALL.z1 - rad - 0.7;
      // Keep clear of the recess and the door
      if (Math.abs(x - HALL.x0) < 4 && Math.abs(z + 31) < 6) continue;
      if (Math.abs(x - HALL.x1) < 4 && Math.abs(z - 44) < 6) continue;
      g.translate(x, (HALL.top + HALL.bottom) / 2, z);
      this.add(r() < 0.5 ? M.pipe : M.rust, g);
    }
    // Chains hanging into the void
    for (let i = 0; i < 26; i++) {
      const x = -55 + r() * 110;
      const z = -65 + r() * 130;
      const len = 20 + r() * 40;
      this.add(M.darkSteel, span(x - 0.03, HALL.top - len, z - 0.03, x + 0.03, HALL.top - 2.4, z + 0.03));
      this.add(M.rust, (() => {
        const g = new THREE.TorusGeometry(0.25, 0.05, 6, 12);
        g.translate(x, HALL.top - len - 0.25, z);
        return g;
      })());
    }
    // High walkways right round the walls, and two across: the size of the place
    const y = 76;
    this.walkway({ x0: HALL.x0 + 1, z0: HALL.z0 + 1, x1: HALL.x1 - 1, z1: HALL.z0 + 3, y, rails: '+' });
    this.walkway({ x0: HALL.x0 + 1, z0: HALL.z1 - 3, x1: HALL.x1 - 1, z1: HALL.z1 - 1, y, rails: '-' });
    this.walkway({ x0: HALL.x0 + 1, z0: HALL.z0 + 3, x1: HALL.x0 + 3, z1: HALL.z1 - 3, y, rails: '+' });
    this.walkway({ x0: HALL.x1 - 3, z0: HALL.z0 + 3, x1: HALL.x1 - 1, z1: HALL.z1 - 3, y, rails: '-' });
    this.walkway({ x0: HALL.x0 + 3, z0: -1, x1: HALL.x1 - 3, z1: 1, y: 82, rails: 'both' });
    this.walkway({ x0: -1, z0: HALL.z0 + 3, x1: 1, z1: HALL.z1 - 3, y: 70, rails: 'both' });
    // A gantry crane across the hall, its hook down in the dark
    this.add(M.yellow, span(HALL.x0, 86, 30, HALL.x1, 87.4, 31.4));
    this.add(M.yellow, span(-6, 84.6, 29.5, 2, 86, 31.9));
    this.add(M.darkSteel, span(-2.04, 40, 30.66, -1.96, 84.6, 30.74));
    this.add(M.yellow, span(-2.6, 38.6, 30.1, -1.4, 40, 31.3));
    // Signs
    const sign = (text: string, x: number, yy: number, z: number, ry: number): void => {
      const c = makeCanvas(512, 128);
      const g = c.getContext('2d')!;
      g.fillStyle = '#c99a12';
      g.fillRect(0, 0, 512, 128);
      g.fillStyle = '#16140f';
      g.fillRect(8, 8, 496, 112);
      g.fillStyle = '#c99a12';
      g.font = 'bold 44px Courier New, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 256, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
      m.position.set(x, yy, z);
      m.rotation.y = ry;
      this.group.add(m);
    };
    sign('SECTOR 7 — CONTAINMENT', HALL.x0 + 0.3, 58, -10, Math.PI / 2);
    sign('DANGER — NO RETURN BELOW', HALL.x1 - 0.3, 52, 10, -Math.PI / 2);
    sign('BIOHAZARD TRANSIT', 0, 64, HALL.z1 - 0.3, Math.PI);
    sign('LEVEL 5 ACCESS →', HALL.x1 - 0.3, H3 + 6.4, 44, -Math.PI / 2);
    // Vats on wall shelves, here and there, out over the drop
    for (const [x, z] of [[-57, 12], [-57, 40], [57, -10], [20, -67], [-20, 67]] as const) {
      const sy = 40 + r() * 20;
      this.add(M.darkSteel, span(x - 2.5, sy - 0.5, z - 2.5, x + 2.5, sy, z + 2.5));
      this.vat(x, sy, z, 1.2, 3.2, r() < 0.5 ? 0x7dff5a : 0xb35cff, false);
    }
  }

  /** The tube he comes down: a curve in from high above, ending at the sewer outlet. */
  private buildTube(): THREE.CatmullRomCurve3 {
    const pts = [V(-172, 66, 26), V(-164, 60, 14), V(-156, 52, 2), V(-150, 45, -8), V(-143, 39, -2), V(-138, 34.5, 1.5), V(-134.4, 32.3, 0), V(-133.2, 32.3, 0)];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const geo = new THREE.TubeGeometry(curve, 160, 0.95, 18, false);
    // Ribbed: a darker band every so often, painted in by UV
    const c = makeCanvas(64, 256);
    const g = c.getContext('2d')!;
    g.fillStyle = '#5a5a4a';
    g.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 32) {
      g.fillStyle = '#26261c';
      g.fillRect(0, y, 64, 8);
    }
    g.fillStyle = 'rgba(90,140,40,0.4)';
    g.fillRect(24, 0, 16, 256);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(40, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, metalness: 0.3, side: THREE.BackSide });
    const mesh = new THREE.Mesh(geo, mat);
    // Strip lights inside it, racing past
    const lights = new THREE.Group();
    for (let i = 1; i < 30; i++) {
      const u = i / 30;
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.5), this.M.greenLamp);
      l.position.copy(p).add(V(0, 0.88, 0));
      l.quaternion.setFromUnitVectors(V(0, 0, 1), tan);
      lights.add(l);
    }
    this.group.add(mesh, lights);
    return curve;
  }
}
