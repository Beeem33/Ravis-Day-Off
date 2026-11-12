import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Collider } from './OfficeLevelBuilder';
import type { CombatLevel } from '../scenes/CombatScene';
import { makeCanvas, tiling, noiseTile } from './Level8Builder';
import { barrel } from './MechanicalProps';
import { quadShotgunModel } from '../entities/QuadShotgun';
import { officeChair, officeDesk, trashCan, flowerPot, waterCooler, printer, fileCabinet, paperStack, deskPhone, sodaCan, snack, fireAlarm } from './OfficeProps';
import { cargoTexture, scissorGateTexture, monitor, screenPanel, poster, orderSheet, comic, type ScreenKind } from './Level13Props';
import { shelfUnit, shelfTops, cleanerJug, sprayBottle, paintCan, cardboardBox, rollPack, mopBucket, mop, broom, wetFloorSign, toolbox, pegboard, hoseReel, hardHat, rubberBoots, workbench, janitorCart, doorSign, warnPlate, ecMug, wallClock, whiteboardStand, penCup, binderShelf, coatRack, fireExtinguisher, headset, stickyNotes } from './Level13Props';

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
/** The landings either side of the vat line, the cargo line and the lift's bottom; walkway 7 and the door; the office floor. */
export const Y6 = 60.1;
export const H4 = 66;
export const OFFICE_Y = 78;
/** The vat line: its track along z at this x, the carts' decks at this height. */
export const VAT_X = 42.5;
export const VAT_Y = 59.6;
/** The second vat line, west of the first: the one he drops onto. */
export const VAT_XB = 38.7;
/** The waste room off the hall's west wall: inside it, and the height its grinder takes anything below. */
export const GRIND = { x0: -88, x1: -61, z0: -8, z1: 20, floor: 36, top: 63, killY: 42 };
/** Below this, inside the hall, he's gone over. */
export const FALL_Y = 38;
/** The sewer tunnels: walls straight up to SPRING, then a vault rising RISE to its crown under the slab. */
const SPRING = SEW_Y + 2.2;
const RISE = 1.75;
export const HALL = { x0: -60, x1: 60, z0: -70, z1: 70, top: 92, bottom: -70 };

export interface Ladder {
  /** Where he stands on it (feet, at the bottom), the way he faces to climb, its top, and where he steps off. */
  base: THREE.Vector3;
  face: number;
  top: number;
  off: THREE.Vector3;
  /** Not there to climb (drawn up). */
  disabled?: boolean;
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
  /** The maintenance room's door: slides into the wall (along z) when he comes up to it. */
  vatLine: { x: number; y: number; z0: number; z1: number; speed: number; carts: { group: THREE.Group; z: number; deck: Collider; vats: Collider[] }[] };
  /** The second line, beside it and in step with it. */
  vatLineB: Level13Data['vatLine'];
  /** The steriliser arches over the vat lines: the line each is on (its x), where along it, its curtain. */
  arches: { x: number; z: number; mat: THREE.MeshBasicMaterial }[];
  /** The weapons crate at the top of the shaft: the quad-barrel in it, where he stands to take it. */
  gunCrate: { gun: THREE.Group; pump: THREE.Group; setPressure(p: number, flash?: number): void; stand: THREE.Vector3; yaw: number };
  /** The waste room: its grinder's two rollers, and the chutes in its ceiling (those over the way through drop on a clock). */
  grinder: {
    rollers: THREE.Object3D[];
    chutes: { mouth: THREE.Vector3; period: number; phase: number; lamp: THREE.MeshStandardMaterial }[];
  };
  cargo: { lines: { z: number; top: number; speed: number; x0: number; x1: number }[]; boxes: { group: THREE.Group; collider: Collider; line: number; x: number }[] };
  lift: { car: THREE.Group; floor: Collider; x0: number; x1: number; z0: number; z1: number; yBottom: number; yTop: number; gates: { pivot: THREE.Group; collider: Collider; level: 'bottom' | 'top' }[] };
  officeLever: { pivot: THREE.Group; at: THREE.Vector3 };
  dropLadder: { group: THREE.Group; raise: number; ladder: Ladder };
  /** The vats' liquid, one material per colour: the scene runs their clock and fog. */
  vatMats: THREE.ShaderMaterial[];
  /** Colliders that move (carts, crates, the lift): kept out of the physics world, added after it. */
  dyn: Collider[];
  sewerDoor: { slab: THREE.Group; collider: Collider; closedZ: number; openZ: number; at: THREE.Vector3 };
  /** Where the outflows' slop lands in the pool, for splashes. */
  pours: THREE.Vector3[];
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

const SLUDGE_NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) { return noise(p) * 0.55 + noise(p * 2.1 + 7.3) * 0.3 + noise(p * 4.3 - 3.1) * 0.15; }
`;

const FOG_VERT = /* glsl */ `
  varying vec3 vW;
  varying float vFog;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vec4 mv = viewMatrix * w;
    vFog = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * The sludge: a thick green soup that drifts, with brown muck rafting on it,
 * a scum that gathers, and bubbles — round, domed, catching the light — that
 * swell up, pop and leave a ring spreading where they were.
 */
function sludgeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
    vertexShader: FOG_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 fogColor;
      uniform float fogDensity;
      varying vec3 vW;
      varying float vFog;
      ${SLUDGE_NOISE}
      // One layer of bubbles: cells of 1/scale m, one bubble in some of them
      vec3 bubbles(vec2 p, float scale, float t, float seed) {
        vec2 g = p * scale;
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        float h = hash(id + seed);
        if (h < 0.62) return vec3(0.0);
        vec2 o = (vec2(hash(id + seed + 3.1), hash(id + seed + 7.7)) - 0.5) * 0.5;
        float life = fract(t * (0.18 + h * 0.25) + h * 13.0);
        float d = length(f - o);
        // Swelling (a dome, lit from above), then popped (a ring going out)
        float r = 0.08 + 0.26 * smoothstep(0.0, 0.75, life);
        float alive = step(life, 0.78);
        float dome = alive * smoothstep(r, r - 0.05, d);
        float hi = alive * smoothstep(r * 0.45, 0.0, length(f - o - vec2(-0.3, 0.3) * r));
        float rr = (life - 0.78) / 0.22;
        float ring = (1.0 - alive) * smoothstep(0.04, 0.0, abs(d - (r + rr * 0.3))) * (1.0 - rr);
        return vec3(dome, hi, ring);
      }
      void main() {
        float t = uTime;
        vec2 p = vW.xz;
        vec2 flow = vec2(t * 0.11, t * 0.04);
        float n = fbm(p * 0.8 + flow);
        float swirl = fbm(p * 1.6 + vec2(n * 1.8, -n) - flow * 0.7);
        vec3 col = mix(vec3(0.05, 0.10, 0.02), vec3(0.18, 0.28, 0.05), swirl);
        // Scum gathering in drifts, a crust of muck, brown rafts
        float scum = smoothstep(0.55, 0.78, fbm(p * 0.35 + t * 0.015));
        col = mix(col, vec3(0.27, 0.28, 0.11), scum * 0.7);
        float muck = fbm(p * 1.1 + vec2(t * 0.03, -t * 0.02) + 31.0);
        float spot = smoothstep(0.6, 0.68, muck);
        col = mix(col, vec3(0.04, 0.05, 0.015), smoothstep(0.53, 0.6, muck) * (1.0 - spot) * 0.6);
        col = mix(col, vec3(0.24, 0.15, 0.06) * (0.75 + 0.45 * noise(p * 9.0)), spot);
        // Bubbles, two sizes
        vec3 b1 = bubbles(p + flow * 0.5, 2.2, t, 1.0);
        vec3 b2 = bubbles(p + flow * 0.5 + 0.37, 4.5, t * 1.3, 9.0);
        vec3 b = max(b1, b2 * 0.8);
        col = mix(col, vec3(0.22, 0.36, 0.07), b.x * 0.6);
        col += vec3(0.42, 0.55, 0.22) * b.y * 0.8;
        col += vec3(0.18, 0.26, 0.06) * b.z;
        // A sick oily sheen in the swirl
        float sheen = pow(max(0.0, swirl - 0.45) * 1.8, 3.0);
        col += vec3(0.08, 0.12, 0.03) * sheen + vec3(0.05, 0.02, 0.07) * sheen * noise(p * 3.0 + t * 0.2);
        float fogF = 1.0 - exp(-fogDensity * fogDensity * vFog * vFog);
        gl_FragColor = vec4(mix(col, fogColor, fogF), 0.985);
      }
    `,
    transparent: true
  });
}

/** Slop pouring out of an outflow: streaks falling down a narrow strip, frayed at the edges. */
function streamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
    vertexShader: FOG_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 fogColor;
      uniform float fogDensity;
      varying vec3 vW;
      varying float vFog;
      varying vec2 vUv;
      ${SLUDGE_NOISE}
      void main() {
        float x = vUv.x;
        float n = fbm(vec2(x * 6.0, vUv.y * 3.0 + uTime * 2.6));
        float edge = smoothstep(0.0, 0.25 + n * 0.2, x) * smoothstep(1.0, 0.75 - n * 0.2, x);
        float streak = 0.6 + 0.4 * noise(vec2(x * 14.0, vUv.y * 1.5 + uTime * 3.4));
        float a = edge * smoothstep(0.25, 0.5, n + 0.2) * 0.92;
        if (a < 0.05) discard;
        vec3 col = mix(vec3(0.07, 0.13, 0.02), vec3(0.24, 0.36, 0.07), streak * n);
        float fogF = 1.0 - exp(-fogDensity * fogDensity * vFog * vFog);
        gl_FragColor = vec4(mix(col, fogColor, fogF), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

// ------------------------------------------------------------- the vats

/**
 * A vat's pieces, foot at the origin: legs and a skirt, a lower and an upper
 * shell, the glass band between them held by straps and rims, a dome with a
 * hatch, a gauge, and a gooseneck pipe off the top down to the deck beside
 * it. `steel` and `dark` are for merging; `band` gets the liquid.
 */
function vatGeometry(r: number, h: number): { steel: THREE.BufferGeometry[]; dark: THREE.BufferGeometry[]; band: THREE.BufferGeometry } {
  const steel: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry => g.translate(x, y, z);
  const b0 = 0.4 + h * 0.3;
  const b1 = b0 + h * 0.45;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    dark.push(span(Math.cos(a) * r * 0.78 - 0.07, 0, Math.sin(a) * r * 0.78 - 0.07, Math.cos(a) * r * 0.78 + 0.07, 0.45, Math.sin(a) * r * 0.78 + 0.07));
  }
  dark.push(at(new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.12, 24), 0, 0.42, 0));
  steel.push(at(new THREE.CylinderGeometry(r, r, b0 - 0.4, 24), 0, (0.4 + b0) / 2, 0));
  steel.push(at(new THREE.CylinderGeometry(r * 0.9, r, h * 0.25, 24), 0, b1 + h * 0.125, 0));
  for (const y of [b0, b1]) {
    const t = new THREE.TorusGeometry(r * 1.01, 0.04, 6, 28);
    t.rotateX(Math.PI / 2);
    steel.push(at(t, 0, y, 0));
  }
  // Straps over the glass
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    const g = new THREE.BoxGeometry(0.05, b1 - b0, 0.035);
    g.rotateY(-a);
    steel.push(at(g, Math.cos(a) * (r + 0.012), (b0 + b1) / 2, Math.sin(a) * (r + 0.012)));
  }
  // Bolts round the lower rim
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    dark.push(at(new THREE.BoxGeometry(0.035, 0.035, 0.035), Math.cos(a) * (r + 0.02), b0 - 0.06, Math.sin(a) * (r + 0.02)));
  }
  const dome = new THREE.SphereGeometry(r * 0.9, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.42, 1);
  dark.push(at(dome, 0, b1 + h * 0.25, 0));
  const top = b1 + h * 0.25 + r * 0.38;
  steel.push(at(new THREE.CylinderGeometry(r * 0.28, r * 0.3, 0.12, 14), 0, top, 0));
  // A gauge on the upper shell
  const gauge = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14);
  gauge.rotateX(Math.PI / 2);
  dark.push(at(gauge, 0, b1 + h * 0.12, r * 0.97));
  // The gooseneck: up off the dome, over, and down the outside to a flange at the floor
  const pr = 0.06;
  const ox = r * 0.45;
  const reach = r + 0.22;
  steel.push(at(new THREE.CylinderGeometry(pr, pr, 0.55, 10), ox, top + 0.2, 0));
  const across = new THREE.CylinderGeometry(pr, pr, reach - ox, 10);
  across.rotateZ(Math.PI / 2);
  steel.push(at(across, (ox + reach) / 2, top + 0.47, 0));
  steel.push(at(new THREE.CylinderGeometry(pr, pr, top + 0.47, 10), reach, (top + 0.47) / 2, 0));
  for (const [x, y] of [[ox, top + 0.47], [reach, top + 0.47]]) steel.push(at(new THREE.SphereGeometry(pr * 1.15, 10, 8), x, y, 0));
  steel.push(at(new THREE.CylinderGeometry(pr * 1.8, pr * 1.8, 0.05, 12), reach, 0.025, 0));
  const band = new THREE.CylinderGeometry(r * 1.002, r * 1.002, b1 - b0, 36, 1, true);
  band.translate(0, (b0 + b1) / 2, 0);
  return { steel, dark, band };
}

/**
 * What's in a vat, through its glass: the stuff glowing, swirling slowly,
 * its surface sloshing round the tank, a bright scum at the top of it and a
 * meniscus line; bubbles rising through it in wobbling columns; above the
 * level the empty glass dark with vapour. Glints on the glass over the lot.
 */
function vatLiquidMaterial(colour: number): THREE.ShaderMaterial {
  const c = new THREE.Color(colour);
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCol: { value: new THREE.Vector3(((colour >> 16) & 255) / 255, ((colour >> 8) & 255) / 255, (colour & 255) / 255) },
      uSeed: { value: c.r * 3.1 + c.b * 7.7 },
      fogColor: { value: new THREE.Color() },
      fogDensity: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vW;
      varying float vFog;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        vFog = -mv.z;
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCol;
      uniform float uSeed;
      uniform vec3 fogColor;
      uniform float fogDensity;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vW;
      varying float vFog;
      ${SLUDGE_NOISE}
      void main() {
        float t = uTime + uSeed * 10.0 + (vW.x + vW.z) * 0.37;
        float u = vUv.x * 6.2831853;
        float level = 0.76 + 0.03 * sin(u * 2.0 + t * 1.1) + 0.014 * sin(u * 5.0 - t * 1.9) + 0.007 * sin(u * 11.0 + t * 3.3);
        vec2 p = vec2(vUv.x * 9.0, vUv.y * 2.6);
        vec3 col;
        if (vUv.y > level) {
          float vap = fbm(vec2(vUv.x * 12.0, vUv.y * 5.0 - t * 0.2));
          float near = smoothstep(level + 0.22, level, vUv.y);
          col = uCol * 0.05 + vec3(0.02, 0.025, 0.03) + uCol * 0.35 * vap * near;
          // Droplets of condensation on the inside of the glass
          vec2 dg = vec2(vUv.x * 60.0, vUv.y * 22.0);
          float dd = length(fract(dg) - 0.5);
          col += uCol * 0.25 * smoothstep(0.22, 0.1, dd) * step(0.7, hash(floor(dg)));
        } else {
          float depth = (level - vUv.y) / level;
          vec2 q = p + vec2(t * 0.05, -t * 0.18);
          float sw = fbm(q + fbm(p * 0.8 - t * 0.07) * 1.6);
          col = uCol * (0.38 + 0.85 * sw) * (1.0 - depth * 0.5);
          // Brighter veins winding through it
          float vein = smoothstep(0.035, 0.0, abs(fbm(p * 1.4 + vec2(-t * 0.06, t * 0.12)) - 0.5));
          col += uCol * 0.7 * vein;
          // Bubbles rising in wobbling columns
          vec2 bg = vec2(vUv.x * 30.0, vUv.y * 10.0 - t * 1.6);
          vec2 id = floor(bg);
          vec2 f = fract(bg) - 0.5;
          float col_ = hash(vec2(id.x, 7.0));
          if (col_ > 0.5 && hash(id + 2.3) > 0.35) {
            float wob = sin(t * 3.0 + id.y * 1.7 + col_ * 20.0) * 0.2;
            float d = length(vec2(f.x - wob, f.y * 1.1));
            float r = 0.1 + 0.14 * hash(id);
            float ring = smoothstep(r, r - 0.05, d) - smoothstep(r - 0.06, r - 0.12, d);
            col += (uCol * 0.6 + 0.35) * ring + vec3(0.5) * smoothstep(r * 0.4, 0.0, length(f - vec2(wob - r * 0.35, r * 0.35)));
          }
          // The scum at the top
          float foam = smoothstep(0.045, 0.0, level - vUv.y) * (0.6 + 0.4 * noise(vec2(vUv.x * 40.0, t)));
          col = mix(col, uCol * 1.5 + 0.25, foam * 0.85);
        }
        col += uCol * 0.9 * smoothstep(0.009, 0.0, abs(vUv.y - level));
        // The glass: a cool rim at grazing angles, two glints that drift a little
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        col += vec3(0.16, 0.2, 0.22) * fres;
        float g1 = smoothstep(0.012, 0.0, abs(fract(vUv.x * 3.0 + 0.1 + 0.01 * sin(uTime * 0.3)) - 0.5));
        col += vec3(0.22) * g1 * (0.6 + 0.4 * vUv.y);
        float fogF = 1.0 - exp(-fogDensity * fogDensity * vFog * vFog);
        // This writes display colour straight out; the fog colour is linear (the lit materials get it
        // encoded on the way out). Encode it here too, or far vats fade to a near-black instead of the haze.
        vec3 fogDisplay = pow(fogColor, vec3(1.0 / 2.2));
        gl_FragColor = vec4(mix(col, fogDisplay, fogF), 1.0);
      }
    `
  });
}

let arcTex: THREE.CanvasTexture | null = null;
/** Arcs of light: bright ragged lines across a faint glow, to scroll and flicker. */
function arcTexture(): THREE.CanvasTexture {
  if (arcTex) return arcTex;
  const c = makeCanvas(128, 256);
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a1030';
  g.fillRect(0, 0, 128, 256);
  let s = 11;
  const r = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < 26; i++) {
    const y = r() * 256;
    g.strokeStyle = `rgba(${200 + r() * 55},${170 + r() * 70},255,${0.35 + r() * 0.6})`;
    g.lineWidth = 0.6 + r() * 1.8;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 16; x <= 128; x += 16) g.lineTo(x, y + (r() - 0.5) * 22);
    g.stroke();
  }
  arcTex = new THREE.CanvasTexture(c);
  arcTex.wrapS = arcTex.wrapT = THREE.RepeatWrapping;
  arcTex.colorSpace = THREE.SRGBColorSpace;
  return arcTex;
}

// ------------------------------------------------------------- builder
// ------------------------------------------------------------- builder

interface WalkwaySpec {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  /** Rails along each long side: 'both', 'none', '-' (the low-coordinate side), '+'. */
  rails: 'both' | 'none' | '-' | '+';
  /** Where its hangers go up to (default the roof trusses). */
  hangTo?: number;
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
  private pours: THREE.Vector3[] = [];
  private dyn: Collider[] = [];
  private vatMats: THREE.ShaderMaterial[] = [];
  private vaultMat!: THREE.MeshStandardMaterial;

  build(): Level13Data {
    this.makeMaterials();
    this.buildSewer();
    const sewerDoor = this.buildMaintenance();
    this.buildShaft();
    this.buildHall();
    const route = this.buildRoute();
    const vats = this.buildVatLine();
    const gunCrate = this.buildGunCrate();
    const grinder = this.buildGrinder();
    const cargo = this.buildCargoLine();
    const lift = this.buildLift();
    const officeLever = this.buildOffice();
    const finale = this.buildFinale();
    route.ladders.push(finale.dropLadder.ladder);
    this.buildAbyss();
    this.buildHallDressing();
    this.buildSigns();
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
        { pos: V(-57.5, H1, 1.1), yaw: Math.PI / 2 },
        { pos: V(-34, H2, 10), yaw: -Math.PI / 2 },
        { pos: V(1, H2, 35.5), yaw: -Math.PI / 2 },
        { pos: V(30, H3, 45.5), yaw: -Math.PI / 2 },
        { pos: V(53, Y6, 10.5), yaw: 0 },
        { pos: V(53, OFFICE_Y, -13), yaw: Math.PI },
        { pos: V(53.5, H4, -18.5), yaw: 0 }
      ],
      ladders: route.ladders,
      turrets: route.turrets,
      sludge: this.sludge,
      sludgeMats: this.sludgeMats,
      flies: [V(-112, 31.2, 0.5), V(-99, 31, -2), V(-98, 31.4, -32), V(-94, 31.1, -35), V(-104, 31.6, -29), V(-78, 31.2, -31), V(-84, 31.3, -33)],
      ratRuns: this.ratRuns,
      floaters: this.floaters,
      ladderTops: this.ladderTops,
      lever: route.lever,
      mover: route.mover,
      door: finale.door,
      vatLine: vats.a,
      vatLineB: vats.b,
      arches: vats.arches,
      gunCrate,
      grinder,
      cargo,
      lift,
      officeLever,
      dropLadder: finale.dropLadder,
      vatMats: this.vatMats,
      dyn: this.dyn,
      carts: this.carts,
      tube,
      outlet: V(-133.4, 32.3, 0),
      lights: { sewer: this.sewerLights, hall: this.hallLights },
      vatGlow: this.vatGlow,
      fogLayers: this.fogLayers,
      sewerDoor,
      pours: this.pours
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
    this.vaultMat = new THREE.MeshStandardMaterial({ map: brick, color: 0x9a9a88, roughness: 0.85, side: THREE.DoubleSide });
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
   * the channel. Floors and walls come off the grid, merged into runs. The
   * tunnels get brick barrel vaults springing from both walls; the rooms
   * (the junction, the pool room, the maintenance room) have flat ceilings,
   * and where a tunnel opens into one a headwall closes the space above its
   * arch, so nothing curved ever crosses where he walks.
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
    mark(-89, -34, -67, -28, open); // C
    mark(-67, -32, -66, -30, open); // the maintenance room's doorway
    mark(-66, -37, -61, -25, open); // the maintenance room, the ladder up out of it
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
          for (const zz of [z - 1, z2]) if (isOpen(x, zz) && !isChan(x, zz)) this.add(M.brick, span(x, CH_Y, zz < z ? zz + 0.9 : zz, x + 1, SEW_Y, zz < z ? zz + 1 : zz + 0.1), false, 2);
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
    // ---- Vaults over the tunnels; headwalls where they open into the rooms
    this.vault(-133, -3, -105, 3);
    this.headwall('x', -105, 0, 3);
    this.vault(-102, -26, -96, -5);
    this.headwall('z', -5, -99, 3);
    this.headwall('z', -26, -99, 3);
    this.vault(-89, -34, -67, -28);
    this.headwall('x', -89, -31, 3);
    // The rooms' flat ceilings get concrete beams across them
    for (let x = -103; x < -93; x += 3) this.add(M.concrete, span(x - 0.2, SEW_Y + 3.65, -5, x + 0.2, SEW_Y + 4, 5), false, 2);
    for (let x = -105; x < -89; x += 3) this.add(M.concrete, span(x - 0.2, SEW_Y + 3.65, -38, x + 0.2, SEW_Y + 4, -26), false, 2);
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
    this.buildSewerPipes();
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
    // Lights. In the tunnels a caged fitting hung from the crown of the vault,
    // in the rooms one fixed flat to the ceiling; nothing hangs in the air.
    const crown = SPRING + RISE;
    const lamps: { x: number; z: number; alongX: boolean; room: boolean }[] = [
      { x: -124, z: 0, alongX: true, room: false },
      { x: -112, z: 0, alongX: true, room: false },
      { x: -99, z: 0, alongX: true, room: true },
      { x: -99, z: -15, alongX: false, room: false },
      { x: -98, z: -32, alongX: true, room: true },
      { x: -78, z: -31, alongX: true, room: false }
    ];
    for (const l of lamps) {
      const lx = l.alongX ? 0.55 : 0.24;
      const lz = l.alongX ? 0.24 : 0.55;
      const top = l.room ? SEW_Y + 4 : crown;
      if (!l.room) this.add(M.darkSteel, box(0.04, 0.22, 0.04, l.x, top - 0.2, l.z));
      const y = l.room ? top - 0.1 : top - 0.32;
      this.add(M.darkSteel, box(lx + 0.08, 0.1, lz + 0.08, l.x, y, l.z));
      this.add(M.greenLamp, box(lx, 0.06, lz, l.x, y - 0.06, l.z));
      // The cage over the lens
      for (const s of [-1, 1]) this.add(M.darkSteel, l.alongX ? box(lx + 0.04, 0.02, 0.02, l.x, y - 0.08, l.z + s * lz * 0.5) : box(0.02, 0.02, lz + 0.04, l.x + s * lx * 0.5, y - 0.08, l.z));
      const p = new THREE.PointLight(0x9cdc6a, 26, 22, 1.5);
      p.position.set(l.x, y - 0.4, l.z);
      this.group.add(p);
      this.sewerLights.push(p);
    }
    // ---- Trash: crushed bottles, cans, wrappers, takeaway boxes, an apple core, newspaper —
    // on the ledges, and some of it floating in the sludge
    const r = lcg(13);
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
      if (!isOpen(cx, cz) || x > -68) continue;
      const wet = isChan(cx, cz);
      if (wet && r() < 0.4) continue;
      trashAt(x, z, wet);
    }
    // Where the rats run: along the ledges, either side of the channel
    this.ratRuns.push(
      [V(-131, SEW_Y, 2.2), V(-102, SEW_Y, 2.2)],
      [V(-130, SEW_Y, -2.3), V(-104, SEW_Y, -2.3)],
      [V(-101.6, SEW_Y, -6), V(-101.6, SEW_Y, -25)],
      [V(-96.5, SEW_Y, -6), V(-96.5, SEW_Y, -25)],
      [V(-106, SEW_Y, -37), V(-90, SEW_Y, -37)],
      [V(-88, SEW_Y, -33.3), V(-69, SEW_Y, -33.3)],
      [V(-88, SEW_Y, -28.6), V(-69, SEW_Y, -28.6)]
    );
    // Muck heaped in corners
    for (let i = 0; i < 40; i++) {
      const x = -132 + r() * 70;
      const z = -38 + r() * 42;
      if (x > -68 || !isOpen(Math.floor(x), Math.floor(z)) || isChan(Math.floor(x), Math.floor(z))) continue;
      const g = new THREE.DodecahedronGeometry(0.12 + r() * 0.2, 0);
      g.scale(1, 0.4, 1);
      g.translate(x, SEW_Y + 0.03, z);
      this.add(M.sewerFloor, g);
    }
  }

  /** Half an ellipse in the XY plane, a by b, as a tube of radius `r`: a rib, or a ring round a mouth. */
  private archTube(a: number, b: number, r: number): THREE.BufferGeometry {
    const pts = new THREE.EllipseCurve(0, 0, a, b, 0, Math.PI, false, 0).getPoints(28).map((p) => V(p.x, p.y, 0));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, r, 5, false);
  }

  /**
   * A brick barrel vault along a tunnel: half an ellipse across it, springing
   * from both side walls at SPRING and rising RISE to a crown just under the
   * ceiling slab. Ribs every 4 m.
   */
  private vault(x0: number, z0: number, x1: number, z1: number): void {
    const alongX = x1 - x0 >= z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    const half = (alongX ? z1 - z0 : x1 - x0) / 2;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    // Theta 0..π puts the half with x ≥ 0 on the cylinder; turned about Z that half is the top
    const g = new THREE.CylinderGeometry(1, 1, len, 32, Math.max(1, Math.round(len / 4)), true, 0, Math.PI);
    const uv = g.getAttribute('uv');
    const arc = Math.PI * Math.sqrt((half * half + RISE * RISE) / 2);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getY(i) * len) / 2, (uv.getX(i) * arc) / 2);
    g.rotateZ(Math.PI / 2);
    g.scale(1, RISE, half);
    if (!alongX) g.rotateY(Math.PI / 2);
    g.translate(cx, SPRING, cz);
    this.add(this.vaultMat, g);
    for (let k = 2; k < len - 1; k += 4) {
      const rib = this.archTube(half - 0.05, RISE - 0.05, 0.08);
      if (alongX) rib.rotateY(Math.PI / 2);
      rib.translate(alongX ? x0 + k : cx, SPRING, alongX ? cz : z0 + k);
      this.add(this.M.darkConcrete, rib);
    }
  }

  /**
   * Where a vaulted tunnel opens into a flat-ceilinged room: the wall above
   * the arch, from the spring line up into the slab, with the arch cut out
   * of it and a brick ring round the opening. `axis` is the tunnel's
   * direction; `at` the plane of the mouth on it; `c` the tunnel's middle.
   */
  private headwall(axis: 'x' | 'z', at: number, c: number, half: number): void {
    const top = SEW_Y + 4.4 - SPRING;
    const s = new THREE.Shape();
    s.moveTo(-half, 0);
    s.lineTo(-half, top);
    s.lineTo(half, top);
    s.lineTo(half, 0);
    for (let i = 1; i < 28; i++) {
      const a = (i / 28) * Math.PI;
      s.lineTo(half * Math.cos(a), RISE * Math.sin(a));
    }
    s.lineTo(-half, 0);
    const g = new THREE.ShapeGeometry(s);
    const ring = this.archTube(half, RISE, 0.1);
    for (const x of [g, ring]) {
      if (axis === 'x') x.rotateY(Math.PI / 2);
      x.translate(axis === 'x' ? at : c, SPRING, axis === 'x' ? c : at);
    }
    worldUVs(g, 2);
    this.add(this.vaultMat, g);
    this.add(this.M.darkConcrete, ring);
  }

  /**
   * One pipe along the walls: straight runs between `pts`, an elbow at each
   * bend, collars along it, a flange where each end goes into a wall. The
   * runs are solid (he bumps his head on them jumping, not walking).
   */
  private pipeRoute(pts: THREE.Vector3[], r: number, mat: THREE.Material, solid = true): void {
    const M = this.M;
    const up = V(0, 1, 0);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = a.distanceTo(b);
      const q = new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize());
      const g = new THREE.CylinderGeometry(r, r, len, 12);
      g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
      this.add(mat, g);
      for (let k = 1.5; k < len - 0.5; k += 3) {
        const c = new THREE.CylinderGeometry(r * 1.22, r * 1.22, 0.1, 12);
        c.applyMatrix4(new THREE.Matrix4().compose(a.clone().lerp(b, k / len), q, V(1, 1, 1)));
        this.add(M.rust, c);
      }
      if (solid) this.solidBox(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r, Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r);
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const s = new THREE.SphereGeometry(r * 1.12, 12, 8);
      s.translate(pts[i].x, pts[i].y, pts[i].z);
      this.add(mat, s);
    }
    for (const [p, n] of [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]] as const) {
      const d = n.clone().sub(p).normalize();
      const f = new THREE.CylinderGeometry(r * 1.6, r * 1.6, 0.06, 14);
      f.applyMatrix4(new THREE.Matrix4().compose(p.clone().addScaledVector(d, 0.03), new THREE.Quaternion().setFromUnitVectors(up, d), V(1, 1, 1)));
      this.add(M.rust, f);
    }
  }

  /**
   * The pipework: two mains that run the whole way along the walls, one each
   * side, from the end wall at the outlet to the maintenance room's wall,
   * turning every corner on the way; downpipes off them to the floor with
   * valves; and two outflows spilling into the pool.
   */
  private buildSewerPipes(): void {
    const M = this.M;
    const y = SPRING - 0.22;
    const P = (pts: [number, number][]): THREE.Vector3[] => pts.map(([x, z]) => V(x, y, z));
    // Main one: along A's south wall, round the junction, down B's east side, across the pool room and along C
    this.pipeRoute(P([[-133, 2.76], [-104.76, 2.76], [-104.76, 4.76], [-93.24, 4.76], [-93.24, -4.76], [-96.24, -4.76], [-96.24, -26.24], [-89.24, -26.24], [-89.24, -28.24], [-67, -28.24]]), 0.18, M.pipe);
    // Main two: the other side all the way
    this.pipeRoute(P([[-133, -2.78], [-104.78, -2.78], [-104.78, -4.78], [-101.78, -4.78], [-101.78, -26.22], [-106.78, -26.22], [-106.78, -37.78], [-89.22, -37.78], [-89.22, -33.78], [-67, -33.78]]), 0.12, M.darkSteel);
    // A conduit under main one along A, into the end wall and into the junction's wall
    this.pipeRoute([V(-133, SPRING - 0.6, 2.88), V(-105, SPRING - 0.6, 2.88)], 0.06, M.rust);
    // Downpipes from the mains to the floor: a tee at the top, a flange at the floor, a valve wheel
    const valveMat = new THREE.MeshStandardMaterial({ color: 0x9a2a1c, roughness: 0.5, metalness: 0.5 });
    const downs: [number, number, number, number][] = [
      [-118, 2.76, 0.1, -1],
      [-110, -2.78, 0.08, 1],
      [-93.24, 0, 0.1, 0],
      [-106.78, -33, 0.08, 0],
      [-80, -28.24, 0.1, -1],
      [-74, -33.78, 0.08, 1]
    ];
    for (const [x, z, rr, face] of downs) {
      this.pipeRoute([V(x, SEW_Y, z), V(x, y, z)], rr, M.rust);
      const w = new THREE.TorusGeometry(0.15, 0.024, 6, 14);
      // The wheel faces into the tunnel: across z (face ±1) or across x (0)
      if (face === 0) w.rotateY(Math.PI / 2);
      const off = rr + 0.07;
      w.translate(x + (face === 0 ? (x > -100 ? -off : off) : 0), SEW_Y + 1.05, z + face * off);
      this.group.add(new THREE.Mesh(w, valveMat));
      this.add(M.darkSteel, box(face === 0 ? 0.16 : 0.04, 0.04, face === 0 ? 0.04 : 0.16, x + (face === 0 ? (x > -100 ? -off / 2 : off / 2) : 0), SEW_Y + 1.03, z + (face * off) / 2));
    }
    // The outflows: big pipes out of the pool room's walls over the ledge, slop falling out of them
    const outflows: { from: THREE.Vector3; to: THREE.Vector3; r: number }[] = [
      { from: V(-98, SEW_Y + 0.95, -38), to: V(-98, SEW_Y + 0.95, -35.7), r: 0.36 },
      { from: V(-107, SEW_Y + 0.95, -31), to: V(-103.7, SEW_Y + 0.95, -31), r: 0.32 }
    ];
    for (const o of outflows) {
      const len = o.from.distanceTo(o.to);
      const d = o.to.clone().sub(o.from).normalize();
      const g = new THREE.CylinderGeometry(o.r, o.r, len, 16, 1, true);
      g.applyMatrix4(new THREE.Matrix4().compose(o.from.clone().add(o.to).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d), V(1, 1, 1)));
      this.add(M.rust, g);
      const lip = new THREE.TorusGeometry(o.r, 0.05, 6, 18);
      lip.applyMatrix4(new THREE.Matrix4().compose(o.to, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d), V(1, 1, 1)));
      this.add(M.rust, lip);
      const back = new THREE.CircleGeometry(o.r * 0.98, 16);
      back.applyMatrix4(new THREE.Matrix4().compose(o.from.clone().addScaledVector(d, 0.3), new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d), V(1, 1, 1)));
      this.add(M.black, back);
      this.solidBox(Math.min(o.from.x, o.to.x) - o.r, o.from.y - o.r, Math.min(o.from.z, o.to.z) - o.r, Math.max(o.from.x, o.to.x) + o.r, o.from.y + o.r, Math.max(o.from.z, o.to.z) + o.r);
      // The slop pouring out of it, two crossed strips
      const mat = streamMaterial();
      this.sludgeMats.push(mat);
      const h = o.to.y - o.r * 0.4 - SLUDGE_Y;
      for (const ry of [0, Math.PI / 2]) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(o.r * 1.1, h), mat);
        s.position.set(o.to.x + d.x * 0.12, SLUDGE_Y + h / 2, o.to.z + d.z * 0.12);
        s.rotation.y = ry;
        s.renderOrder = 2;
        this.group.add(s);
      }
      this.pours.push(V(o.to.x + d.x * 0.12, SLUDGE_Y, o.to.z + d.z * 0.12));
    }
  }

  /**
   * The maintenance room at the end of the sewer, under the shaft: shelves
   * of cleaning kit, a bench and its tools, the mop bucket; and its door, a
   * steel slab that slides into the wall when he walks up to it.
   */
  private buildMaintenance(): Level13Data['sewerDoor'] {
    const M = this.M;
    const y = SEW_Y;
    // A step up out of the end of the channel, under the slop, so he can walk out of it to the door
    this.add(M.brick, span(-70.55, CH_Y - 0.6, -32, -70, CH_Y + 0.38, -30), true, 2);
    // The doorway in the wall between C and the room: jambs, lintel, hazard trim on the tunnel side
    this.add(M.darkSteel, span(-67, y, -32, -66, y + 2.45, -31.75), true);
    this.add(M.darkSteel, span(-67, y, -30.25, -66, y + 2.45, -30), true);
    this.add(M.brick, span(-67, y + 2.4, -32, -66, SEW_Y + 4.4, -30), true, 2);
    this.add(M.hazard, span(-67.04, y + 2.3, -32.1, -67, y + 2.5, -29.9), false, 0.5);
    for (const z of [-32.1, -30.1]) this.add(M.hazard, span(-67.04, y, z, -67, y + 2.5, z + 0.2), false, 0.5);
    // The door
    const slab = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x5c646c, roughness: 0.5, metalness: 0.6 });
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.3, 1.5), steel);
    slab.add(leaf);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.3), new THREE.MeshStandardMaterial({ color: 0x0a1210, roughness: 0.1, metalness: 0.4 }));
    win.position.set(0, 0.5, 0);
    slab.add(win);
    const plate = doorSign('MAINTENANCE', 'AUTHORISED STAFF ONLY', 0.9, 0.3);
    plate.rotation.y = -Math.PI / 2;
    plate.position.set(-0.05, 0.05, 0);
    slab.add(plate);
    const kick = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.25, 1.5), this.M.hazard);
    kick.position.set(0, -1.02, 0);
    slab.add(kick);
    slab.position.set(-66.5, y + 1.15, -31);
    leaf.userData.surface = 'metal';
    this.shootables.push(leaf);
    this.group.add(slab);
    const collider = this.solidBox(-66.56, y, -31.75, -66.44, y + 2.3, -30.25);
    // Inside: a lamp on the ceiling and its light
    for (const z of [-34.5, -27.5]) {
      this.add(M.darkSteel, box(0.7, 0.08, 0.3, -64, SEW_Y + 3.92, z));
      this.add(M.lamp, box(0.6, 0.04, 0.22, -64, SEW_Y + 3.88, z));
    }
    const l = new THREE.PointLight(0xffe6b0, 16, 12, 1.5);
    l.position.set(-64, SEW_Y + 3.3, -31);
    this.group.add(l);
    this.sewerLights.push(l);
    const put = (o: THREE.Object3D, x: number, yy: number, z: number, ry = 0): THREE.Object3D => {
      o.position.set(x, yy, z);
      o.rotation.y = ry;
      this.group.add(o);
      return o;
    };
    // North end: two runs of shelving against the wall, stocked
    const r = lcg(71);
    for (const sx of [-64.6, -62.4]) {
      put(shelfUnit(1.9, 0.5, 2.1, 4), sx, y, -36.68);
      this.solidBox(sx - 0.95, y, -36.95, sx + 0.95, y + 2.1, -36.43);
      const tops = shelfTops(2.1, 4);
      for (const [k, ty] of tops.entries()) {
        let x = sx - 0.8;
        while (x < sx + 0.75) {
          const pick = Math.floor(r() * 7);
          let o: THREE.Object3D;
          let w: number;
          if (pick === 0) [o, w] = [cleanerJug([0x2a8ad8, 0xf2d22a, 0xd8302a, 0x2ab84a][Math.floor(r() * 4)]), 0.16];
          else if (pick === 1) [o, w] = [sprayBottle([0x2a8ad8, 0xd8302a, 0x9a2ad8][Math.floor(r() * 3)]), 0.1];
          else if (pick === 2 && k < 2) [o, w] = [paintCan([0xd8d8d8, 0x2a6ad8, 0xc8261c, 0x2a8a3a][Math.floor(r() * 4)]), 0.19];
          else if (pick === 3) [o, w] = [rollPack(), 0.34];
          else if (pick === 4) [o, w] = [cardboardBox(0.32, 0.22 + r() * 0.12, 0.34), 0.34];
          else if (pick === 5 && k === 3) [o, w] = [hardHat(r() < 0.5 ? 0xf2c414 : 0xffffff), 0.3];
          else [o, w] = [cleanerJug(0xf2f2f2, '#2a6ad8'), 0.16];
          if (x + w > sx + 0.92) break;
          put(o, x + w / 2, y + ty, -36.68 + (r() - 0.5) * 0.08, (r() - 0.5) * 0.4);
          x += w + 0.03 + r() * 0.05;
        }
      }
    }
    // The mop bucket out in front of them, brooms and a mop against the west wall
    put(mopBucket(), -64.6, y, -34.9, 0.3);
    this.solidBox(-64.85, y, -35.1, -64.35, y + 0.6, -34.7);
    put(broom(), -65.82, y, -35.6).rotation.set(0, Math.PI / 2, 0.18);
    put(broom(), -65.82, y, -35.15).rotation.set(0, Math.PI / 2, 0.14);
    put(mop(0, 0, 0), -65.84, y, -34.6).rotation.set(0, 0, -0.16);
    put(barrel('blue'), -61.6, y, -34.4);
    this.solidBox(-61.9, y, -34.7, -61.3, y + 0.9, -34.1);
    // By the door, the wet floor sign
    put(wetFloorSign(), -65.3, y, -32.9, 0.6);
    // South end: the bench and its pegboard, the toolbox, a janitor's cart, boxes, boots, hats on hooks
    put(workbench(2.4), -64.6, y, -25.4, Math.PI);
    this.solidBox(-65.8, y, -25.75, -63.4, y + 0.92, -25.05);
    put(pegboard(2.2, 0.9), -64.6, y + 1.65, -25.02, Math.PI);
    put(toolbox(), -64.0, y + 0.91, -25.4, Math.PI + 0.2);
    put(cleanerJug(0xd8302a), -65.4, y + 0.91, -25.35);
    put(ecMug(false), -64.9, y + 0.91, -25.5);
    put(janitorCart(), -62.4, y, -26.0, Math.PI / 2);
    this.solidBox(-62.7, y, -26.9, -62.1, y + 0.9, -25.1);
    put(cardboardBox(0.5, 0.4, 0.5), -65.6, y, -27.3, 0.2);
    put(cardboardBox(0.42, 0.34, 0.42), -65.6, y + 0.4, -27.3, -0.1);
    this.solidBox(-65.9, y, -27.6, -65.3, y + 0.74, -27.0);
    put(rubberBoots(), -65.7, y, -28.3, Math.PI / 2);
    for (const [i, c] of [0xf2c414, 0xffffff, 0xf2c414].entries()) {
      this.add(M.darkSteel, box(0.04, 0.04, 0.12, -65.94, y + 1.62, -29.4 + i * 0.4));
      put(hardHat(c), -65.85, y + 1.66, -29.4 + i * 0.4).rotation.z = -0.25;
    }
    put(hoseReel(), -61.02, y + 1.4, -27.6, -Math.PI / 2);
    const ws = warnPlate('SHAFT ↑ HALL 7', 0.9, 0.22);
    ws.rotation.y = -Math.PI / 2;
    ws.position.set(-61.01, y + 2.5, -31);
    this.group.add(ws);
    return { slab, collider, closedZ: -31, openZ: -32.6, at: V(-66.5, y, -31) };
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
    // The recess lamp, fixed flat to its roof
    this.add(M.darkSteel, box(0.52, 0.06, 0.28, -63.5, top + 3.44, -28.6));
    this.add(M.lamp, box(0.42, 0.06, 0.2, -63.5, top + 3.38, -28.6));
    // A bulkhead lamp on the shaft's wall halfway up
    this.add(M.darkSteel, span(-63, SEW_Y + 8.2, -31.2, -62.9, SEW_Y + 8.6, -30.8));
    this.add(M.lamp, span(-62.9, SEW_Y + 8.25, -31.12, -62.86, SEW_Y + 8.55, -30.88));
    // The ladder up the shaft: on its east face, from the sewer floor to the recess floor, hoops above
    this.ladderMesh(V(-61.05, SEW_Y, -31), -Math.PI / 2, top - SEW_Y, 'hoops');
  }

  /**
   * A ladder's rails and rungs: `at` its foot, against whatever it's fixed to
   * on the side `face` points away from (the climber faces `face`), `h` tall.
   * Its top: 'lamp', a crossbar across the rail heads with a lamp on it, or
   * 'hoops', grab handles standing up off the floor it comes out on.
   */
  private ladderMesh(at: THREE.Vector3, face: number, h: number, topKind: 'lamp' | 'hoops' = 'lamp', cage = false): void {
    const M = this.M;
    const fx = -Math.sin(face);
    const fz = -Math.cos(face);
    const sx = Math.cos(face);
    const sz = -Math.sin(face);
    const off = 0.08; // proud of the wall, toward the climber (he faces `face`, so back along it)
    for (const s of [-0.24, 0.24]) {
      const g = new THREE.BoxGeometry(0.065, h, 0.08);
      g.rotateY(face);
      g.translate(at.x + sx * s - fx * off, at.y + h / 2, at.z + sz * s - fz * off);
      this.add(M.yellow, g);
    }
    for (let y = 0.3; y < h - 0.05; y += 0.3) {
      const g = new THREE.CylinderGeometry(0.024, 0.024, 0.48, 6);
      g.rotateZ(Math.PI / 2);
      g.rotateY(face);
      g.translate(at.x - fx * off, at.y + y, at.z - fz * off);
      this.add(M.yellow, g);
    }
    if (topKind === 'lamp') {
      // A crossbar over the rail heads, the lamp sat on it
      const bar = new THREE.BoxGeometry(0.6, 0.06, 0.08);
      bar.rotateY(face);
      bar.translate(at.x - fx * off, at.y + h - 0.03, at.z - fz * off);
      this.add(M.yellow, bar);
      const lamp = new THREE.BoxGeometry(0.36, 0.12, 0.12);
      lamp.rotateY(face);
      lamp.translate(at.x - fx * off, at.y + h + 0.06, at.z - fz * off);
      this.add(M.lamp, lamp);
    } else {
      // Grab hoops: a post each side on the floor past the top, bent back over the edge
      for (const s of [-0.3, 0.3]) {
        const bx = at.x + sx * s + fx * 0.28;
        const bz = at.z + sz * s + fz * 0.28;
        this.add(M.yellow, box(0.05, 0.95, 0.05, bx, at.y + h, bz));
        const tx = at.x + sx * s - fx * off;
        const tz = at.z + sz * s - fz * off;
        this.add(M.yellow, span(Math.min(bx, tx) - 0.025, at.y + h + 0.9, Math.min(bz, tz) - 0.025, Math.max(bx, tx) + 0.025, at.y + h + 0.95, Math.max(bz, tz) + 0.025));
        this.add(M.yellow, box(0.05, 0.95, 0.05, tx, at.y + h, tz));
      }
    }
    this.add(M.hazard, box(Math.abs(fx) > 0.5 ? 0.02 : 0.62, 0.3, Math.abs(fx) > 0.5 ? 0.62 : 0.02, at.x - fx * (off + 0.02), at.y + 1.6, at.z - fz * (off + 0.02)));
    this.ladderTops.push(V(at.x - fx * 0.5, at.y + h + 0.4, at.z - fz * 0.5));
    if (cage) {
      // Hoops wide and deep enough that he climbs inside them (his eye's 0.8 m off the wall),
      // each fixed back to the rails, with straps up the back joining them
      const C = 0.5;
      const R = 0.62;
      for (let y = 2.4; y < h; y += 0.9) {
        // The half-hoop round behind him: its ends at the sides, bowed out on his side of the ladder
        const ring = new THREE.TorusGeometry(R, 0.018, 4, 20, Math.PI);
        ring.rotateX(Math.PI / 2);
        ring.rotateY(face);
        ring.translate(at.x - fx * C, at.y + y, at.z - fz * C);
        this.add(M.yellow, ring);
        for (const s of [-1, 1]) {
          const a = V(at.x + sx * 0.24 * s - fx * off, at.y + y, at.z + sz * 0.24 * s - fz * off);
          const b = V(at.x + sx * R * s - fx * C, at.y + y, at.z + sz * R * s - fz * C);
          const arm = new THREE.CylinderGeometry(0.016, 0.016, a.distanceTo(b), 4);
          arm.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
          arm.translate((a.x + b.x) / 2, a.y, (a.z + b.z) / 2);
          this.add(M.yellow, arm);
        }
      }
      for (const k of [-0.7, 0, 0.7]) {
        const ang = Math.PI / 2 + k;
        const px = Math.cos(ang) * R;
        const pz = Math.sin(ang) * R;
        const strap = new THREE.CylinderGeometry(0.016, 0.016, h - 2.4, 4);
        strap.translate(at.x + sx * px - fx * (C + pz), at.y + 2.4 + (h - 2.4) / 2 - 0.45, at.z + sz * px - fz * (C + pz));
        this.add(M.yellow, strap);
      }
    }
  }

  // -------------------------------------------------------------- the hall

  private buildHall(): void {
    const M = this.M;
    const { x0, x1, z0, z1, top, bottom } = HALL;
    // Walls (the west one round the recess's opening, the east one round the door)
    this.add(M.concrete, span(x0 - 1, bottom, z0, x0, H1 - 0.4, z1), true, 8);
    this.add(M.concrete, span(x0 - 1, H1 + 3.5, z0, x0, H2, z1), true, 8);
    this.add(M.concrete, span(x0 - 1, H2 + 3, z0, x0, top, z1), true, 8);
    // (the waste room's way out, at the level of platform 3)
    this.add(M.concrete, span(x0 - 1, H2, z0, x0, H2 + 3, 8.8), true, 8);
    this.add(M.concrete, span(x0 - 1, H2, 11.2, x0, H2 + 3, z1), true, 8);
    this.add(M.concrete, span(x0 - 1, H1 - 0.4, z0, x0, H1 + 3.5, -34), true, 8);
    // (and its way in, off platform 2)
    this.add(M.concrete, span(x0 - 1, H1 - 0.4, -28, x0, H1 + 3.5, -0.2), true, 8);
    this.add(M.concrete, span(x0 - 1, H1 - 0.4, 2.4, x0, H1 + 3.5, z1), true, 8);
    this.add(M.concrete, span(x0 - 1, H1 - 0.4, -0.2, x0, H1, 2.4), true, 8);
    this.add(M.concrete, span(x0 - 1, H1 + 3, -0.2, x0, H1 + 3.5, 2.4), true, 8);
    this.add(M.concrete, span(x1, bottom, z0, x1 + 1, H4, z1), true, 8);
    this.add(M.concrete, span(x1, H4 + 4, z0, x1 + 1, top, z1), true, 8);
    this.add(M.concrete, span(x1, H4, z0, x1 + 1, H4 + 4, -32), true, 8);
    this.add(M.concrete, span(x1, H4, -28, x1 + 1, H4 + 4, z1), true, 8);
    this.add(M.concrete, span(x0, bottom, z0 - 1, x1, top, z0), true, 8);
    this.add(M.concrete, span(x0, bottom, z1, x1, top, z1 + 1), true, 8);
    this.add(M.darkConcrete, span(x0, top, z0, x1, top + 1, z1), true, 8);
    // Pilasters and string courses on the walls: scale for the eye
    for (let z = z0 + 10; z < z1; z += 20) {
      for (const x of [x0, x1 - 1.2]) {
        // None where the cargo line runs into the east wall, nor behind the office
        if (x > 0 && z > -26 && z < 8) continue;
        // Nor across the waste room's doorway
        if (x < 0 && z === 0) continue;
        this.add(M.darkConcrete, span(x, bottom, z - 1, x + 1.2, top, z + 1), false, 4);
      }
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
    for (const [x, z] of [[-45, -56], [-10, -56], [25, -56], [-48, 26], [-14, 54], [16, 60], [46, 62], [-42, 58], [16, -14], [-6, -30]] as const) {
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
      for (let z = -50; z <= 50; z += 33) this.add(M.lamp, span(x - 4, top - 0.05, z - 6, x + 4, top, z + 6));
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
    for (const [x, y, z, k] of [[-44, H1 + 6, -31, 40], [-30, H1 + 6, 0, 30], [2, H2 + 7, 22, 36], [30, H3 + 6, 38, 34], [-14, H2 + 7, 10, 28], [46, H3 + 5, 14, 34], [54, Y6 + 6.5, -2, 30], [55, H4 + 5, -30, 30]] as const) {
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
      for (const [px, pz] of i % 2 ? [[hx, hz]] : [[hx2, hz2]]) this.add(M.darkSteel, span(px - 0.03, y + 1.1, pz - 0.03, px + 0.03, w.hangTo ?? HALL.top - 2.4, pz + 0.03));
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
    const p = vatGeometry(r, h);
    for (const g of p.steel) this.add(this.M.steel, g.translate(x, y, z));
    for (const g of p.dark) this.add(this.M.darkSteel, g.translate(x, y, z));
    const band = new THREE.Mesh(p.band, this.liquid(colour));
    band.position.set(x, y, z);
    this.group.add(band);
    if (solid) this.solidBox(x - r, y, z - r, x + r, y + 0.4 + h, z + r);
  }

  /**
   * The route, start to finish; and the things on it the scene drives:
   * ladders, the turrets' mounts, the lever and the platform it calls, the door.
   */
  private buildRoute(): { ladders: Ladder[]; turrets: TurretSite[]; lever: Level13Data['lever']; mover: Level13Data['mover'] } {
    const M = this.M;
    const ladders: Ladder[] = [];
    // Up the shaft from the sewer, against the hall's wall
    ladders.push({ base: V(-61.75, SEW_Y, -31), face: -Math.PI / 2, top: H1, off: V(-60.4, H1, -31) });
    // ---- 0: out of the recess onto the first platform
    this.platform(-60, -34, -53, -28, H1, 'ns');
    this.crate(-55, H1, -33.2, 1.1, 1.1);
    // S1, east, railed both sides; crates on its north side to duck behind
    // The gun's first lesson: it stops at a step higher than he can climb, and goes on from the top of it
    this.walkway({ x0: -53, z0: -32.1, x1: -45.5, z1: -29.9, y: H1, rails: 'both' });
    this.coverStack(-50, H1, -31.5, 1.0);
    const UP1 = H1 + 2.6;
    this.add(M.darkSteel, span(-45.5, H1 - 0.32, -32.1, -45.3, UP1, -29.9), true);
    this.add(M.hazard, span(-45.52, UP1 - 0.5, -32.1, -45.5, UP1, -29.9), false, 0.5);
    this.add(M.hazard, span(-45.52, H1, -32.1, -45.5, H1 + 0.3, -29.9), false, 0.5);
    this.walkway({ x0: -45.5, z0: -32.1, x1: -37.6, z1: -29.9, y: UP1, rails: 'both' });
    this.coverStack(-41.5, UP1, -31.5, 1.0);
    for (const z of [-32.0, -30.0]) this.add(M.darkSteel, span(-45.45, -10, z - 0.1, -45.25, H1 - 0.32, z + 0.1));
    // ---- 1: the first junction, crates and a vat on it
    this.platform(-36, -36, -28, -27, H1, 'n');
    // West rail either side of where S1 comes in, not across it
    this.walkRail(-36, -36, -35.92, -32.1, H1);
    this.walkRail(-36, -29.9, -35.92, -27, H1);
    this.crate(-35, H1, -35, 1.1, 1.1);
    this.crate(-35, H1, -35, 0.9, 2.1);
    this.crate(-29.3, H1, -34.8, 1.1, 1.1);
    this.vat(-29.6, H1, -29.6, 0.9, 2.4, 0x7dff5a);
    // S2, south, no rails at all
    // (its middle's gone, and the far end hangs two and a half metres higher: up, then thrown across)
    this.walkway({ x0: -32.9, z0: -27, x1: -31.1, z1: -18, y: H1, rails: 'none' });
    this.coverStack(-31.55, H1, -25, 0.9);
    const UP2 = H1 + 2.5;
    this.walkway({ x0: -32.9, z0: -10, x1: -31.1, z1: -3, y: UP2, rails: 'none' });
    this.coverStack(-31.55, UP2, -5.5, 0.9);
    // Torn ends, hanging
    for (const [z, y, rz] of [[-17.2, H1 - 0.75, 0.95], [-10.8, UP2 - 0.7, -0.9]] as const) {
      const g = new THREE.BoxGeometry(1.8, 0.06, 2.0);
      g.rotateX(rz);
      g.translate(-32, y, z);
      this.add(M.darkSteel, g);
    }
    // ---- 2: the platform at its end, and the ladder up to 3
    this.platform(-36, -3, -28, 5.4, H1, 'es');
    this.walkRail(-36, -3, -35.92, 0, H1);
    this.walkRail(-36, 2.2, -35.92, 5.4, H1);
    this.crate(-34.8, H1, -1.8, 1.1, 1.1);
    // The ladder that went up to 3 has been cut away: its top two metres still hang off the platform above
    for (const s of [-0.24, 0.24]) this.add(M.yellow, span(-32 + s - 0.032, H2 - 2.2, 5.68, -32 + s + 0.032, H2 + 1.0, 5.76));
    for (let y = H2 - 2.0; y < H2 + 0.9; y += 0.3) this.add(M.yellow, span(-32.24, y - 0.024, 5.7, -31.76, y + 0.024, 5.74));
    // West, to the wall and the waste room's door
    this.walkway({ x0: -60, z0: 0, x1: -36, z1: 2.2, y: H1, rails: 'both' });
    this.coverStack(-47, H1, 0.55, 0.9);
    // ---- 3: above, and the span east that's been broken
    this.platform(-36, 5.8, -28, 13, H2, 'ns');
    this.walkRail(-36, 5.8, -35.92, 9, H2);
    this.walkRail(-36, 11, -35.92, 13, H2);
    // Back out of the waste room: east along the wall's upper door to here
    this.walkway({ x0: -60, z0: 9, x1: -36, z1: 11, y: H2, rails: 'both' });
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
    this.platform(-2, 30, 6, 38, H2, 'ws');
    // North rail either side of where S4 comes in, not across it
    this.walkRail(-2, 30, 1, 30.08, H2);
    this.walkRail(3, 30, 6, 30.08, H2);
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
    this.ladderMesh(V(30, H2, 39.8), Math.PI, H3 - H2 + 1.1, 'lamp', true);
    // ---- 7, and the last long walkway east under the turret
    this.platform(26, 40, 34, 48, H3, 'ws');
    this.walkRail(26, 40, 29.2, 40.08, H3);
    this.walkRail(30.8, 40, 34, 40.08, H3);
    this.vat(27.4, H3, 46.5, 0.8, 2.0, 0x7dff5a);
    // S5: east to where it stops, over the vat line (buildVatLine marks its end)
    this.walkway({ x0: 34, z0: 42.9, x1: 37.2, z1: 45.1, y: H3, rails: 'both' });
    this.coverStack(35.4, H3, 43.45, 0.9);
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
      { pos: V(34, H3 + 8, 25), yaw: Math.PI, half: 0.22, rate: 0.45, pitch: -0.34, mount: 'post' }
    ];
    // Their posts: steel columns up from the abyss, a bracket out to the gun
    for (const t of turrets) {
      this.add(M.darkSteel, span(t.pos.x - 0.35, -10, t.pos.z - 0.35, t.pos.x + 0.35, t.pos.y - 0.6, t.pos.z + 0.35));
      this.add(M.hazard, span(t.pos.x - 0.37, t.pos.y - 2.2, t.pos.z - 0.37, t.pos.x + 0.37, t.pos.y - 1.6, t.pos.z + 0.37), false, 0.6);
      this.add(M.darkSteel, span(t.pos.x - 0.8, t.pos.y - 0.75, t.pos.z - 0.8, t.pos.x + 0.8, t.pos.y - 0.6, t.pos.z + 0.8));
    }
    return { ladders, turrets, lever, mover };
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
    const z = -30;
    const y = H4;
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
    // On a bracket off the wall over the lintel, not hanging in the air
    warn.position.set(x - 0.2, y + 4.6, z);
    this.group.add(warn);
    this.add(this.M.darkSteel, span(x - 0.2, y + 4.42, z - 0.08, x, y + 4.48, z + 0.08));
    this.add(this.M.darkSteel, span(x - 0.06, y + 4.3, z - 0.15, x, y + 4.7, z + 0.15));
    return { slab, collider, front: V(x - 1.6, y, z), plant: V(x - 0.13, y + 1.45, z + 0.4) };
  }

  // -------------------------------------------------------------- the vat line

  /**
   * A track along z at VAT_X, carts on it carrying two vats each north
   * through the hall and out through the wall at each end. He drops onto one
   * from the end of walkway 5 and rides it to the landing beside the track.
   */
  private buildVatLine(): { a: Level13Data['vatLine']; b: Level13Data['vatLine']; arches: Level13Data['arches'] } {
    const M = this.M;
    const Y = VAT_Y;
    const z0 = HALL.z0;
    const z1 = HALL.z1;
    // A cart: a deck on two bogies, a vat at each end, the middle clear to stand in
    const deck = merge([
      span(-1.2, -0.28, -3.5, 1.2, 0, 3.5),
      span(-0.9, -0.62, -2.9, 0.9, -0.28, -1.9),
      span(-0.9, -0.62, 1.9, 0.9, -0.28, 2.9),
      span(-0.25, -0.2, -3.9, 0.25, -0.05, -3.5),
      span(-0.25, -0.2, 3.5, 0.25, -0.05, 3.9)
    ]);
    const edge = merge([span(-1.22, -0.26, -3.52, -1.18, -0.02, 3.52), span(1.18, -0.26, -3.52, 1.22, -0.02, 3.52), span(-1.2, -0.26, -3.52, 1.2, -0.02, -3.48), span(-1.2, -0.26, 3.48, 1.2, -0.02, 3.52)]);
    const wheels = merge(
      [-2.4, 2.4].flatMap((bz) =>
        [-0.45, 0.45].flatMap((dz) =>
          [-0.7, 0.7].map((wx) => {
            const g = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 12);
            g.rotateZ(Math.PI / 2);
            g.translate(wx, -0.55, bz + dz);
            return g;
          })
        )
      )
    );
    const stripes = merge([span(-1.2, 0, -1.6, 1.2, 0.012, -1.45), span(-1.2, 0, 1.45, 1.2, 0.012, 1.6)]);
    worldUVs(stripes, 0.5);
    const colours = [0x7dff5a, 0xb35cff, 0x5ae0ff];
    const vparts = vatGeometry(0.85, 2.0);
    const vSteel = merge(vparts.steel.flatMap((g) => [-2.35, 2.35].map((vz) => g.clone().translate(0, 0, vz))));
    const vDark = merge(vparts.dark.flatMap((g) => [-2.35, 2.35].map((vz) => g.clone().translate(0, 0, vz))));
    for (const g of [...vparts.steel, ...vparts.dark]) g.dispose();
    const n = 7;
    const len = z1 - z0 + 10;
    const track = (X: number, tint: number): Level13Data['vatLine'] => {
      // The girder under the carts, the rails on it, trestles down into the fog every 12 m
      this.add(M.darkSteel, span(X - 1.0, Y - 1.05, z0, X + 1.0, Y - 0.62, z1));
      for (const s of [-0.7, 0.7]) this.add(M.steel, span(X + s - 0.06, Y - 0.62, z0, X + s + 0.06, Y - 0.5, z1));
      this.add(M.hazard, span(X - 1.02, Y - 0.85, z0, X - 1.0, Y - 0.7, z1), false, 0.5);
      this.add(M.hazard, span(X + 1.0, Y - 0.85, z0, X + 1.02, Y - 0.7, z1), false, 0.5);
      for (let z = z0 + 6; z < z1; z += 12) {
        for (const s of [-0.85, 0.85]) this.add(M.darkSteel, span(X + s - 0.12, -10, z - 0.12, X + s + 0.12, Y - 1.05, z + 0.12));
        for (let yy = Y - 7; yy > 0; yy -= 9) this.add(M.darkSteel, span(X - 0.85, yy, z - 0.08, X + 0.85, yy + 0.18, z + 0.08));
      }
      // The portals it goes through, at both ends
      for (const z of [z0, z1]) {
        const s = z === z0 ? 1 : -1;
        this.add(M.black, span(X - 1.6, Y - 1.1, Math.min(z, z + s * 0.04), X + 1.6, Y + 3.4, Math.max(z, z + s * 0.04)));
        this.add(M.hazard, span(X - 1.9, Y - 1.1, Math.min(z, z + s * 0.12), X - 1.6, Y + 3.7, Math.max(z, z + s * 0.12)), false, 0.6);
        this.add(M.hazard, span(X + 1.6, Y - 1.1, Math.min(z, z + s * 0.12), X + 1.9, Y + 3.7, Math.max(z, z + s * 0.12)), false, 0.6);
        this.add(M.hazard, span(X - 1.9, Y + 3.4, Math.min(z, z + s * 0.12), X + 1.9, Y + 3.7, Math.max(z, z + s * 0.12)), false, 0.6);
      }
      const carts: Level13Data['vatLine']['carts'] = [];
      for (let i = 0; i < n; i++) {
        const g = new THREE.Group();
        const parts: THREE.Mesh[] = [new THREE.Mesh(deck, M.darkSteel), new THREE.Mesh(edge, M.yellow), new THREE.Mesh(wheels, M.darkSteel), new THREE.Mesh(stripes, M.hazard), new THREE.Mesh(vSteel, M.steel), new THREE.Mesh(vDark, M.darkSteel)];
        const liq = this.liquid(colours[(i + tint) % colours.length]);
        for (const vz of [-2.35, 2.35]) {
          const b = new THREE.Mesh(vparts.band, liq);
          b.position.z = vz;
          parts.push(b);
        }
        for (const m of parts) {
          g.add(m);
          m.userData.surface = 'metal';
          m.userData.noDecal = true;
          this.shootables.push(m);
        }
        // Both lines in step: a cart on one always has a cart beside it on the other
        const z = z0 - 5 + (i / n) * len;
        g.position.set(X, Y, z);
        this.group.add(g);
        const deckC: Collider = { box: new THREE.Box3() };
        const vatsC: Collider[] = [{ box: new THREE.Box3() }, { box: new THREE.Box3() }];
        this.dyn.push(deckC, ...vatsC);
        carts.push({ group: g, z, deck: deckC, vats: vatsC });
      }
      return { x: X, y: Y, z0: z0 - 5, z1: z1 + 5, speed: -2.4, carts };
    };
    const a = track(VAT_X, 0);
    const b = track(VAT_XB, 1);
    // ---- The steriliser arches: a frame over one line, a curtain of arcing light in it.
    // The vats go through; anyone riding with them doesn't. They alternate, line to line,
    // so the way north is from one line's carts to the other's and back.
    const arches: Level13Data['arches'] = [];
    const arch = (X: number, z: number): void => {
      for (const s of [-1, 1]) {
        this.add(M.darkSteel, span(X + s * 1.55 - 0.16, -10, z - 0.16, X + s * 1.55 + 0.16, Y + 3.9, z + 0.16));
        this.add(M.hazard, span(X + s * 1.55 - 0.17, Y - 0.6, z - 0.17, X + s * 1.55 + 0.17, Y + 0.3, z + 0.17), false, 0.5);
        // Emitters down the inside of each post
        for (let y = Y + 0.3; y < Y + 3.4; y += 0.62) this.add(M.steel, span(X + s * 1.36 - 0.05, y, z - 0.07, X + s * 1.36 + 0.05, y + 0.3, z + 0.07));
      }
      this.add(M.darkSteel, span(X - 1.75, Y + 3.5, z - 0.22, X + 1.75, Y + 4.0, z + 0.22));
      this.add(M.hazard, span(X - 1.76, Y + 3.42, z - 0.23, X + 1.76, Y + 3.5, z + 0.23), false, 0.5);
      const mat = new THREE.MeshBasicMaterial({ map: arcTexture(), color: 0xb8a0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.9), mat);
      curtain.position.set(X, Y + 1.5, z);
      curtain.renderOrder = 5;
      this.group.add(curtain);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), new THREE.MeshStandardMaterial({ color: 0x1a1030, emissive: 0xa070ff, emissiveIntensity: 3 }));
      lamp.position.set(X, Y + 4.08, z);
      this.group.add(lamp);
      for (const s of [-1, 1]) {
        const sign = warnPlate('STERILISER — DO NOT RIDE THROUGH', 3.0, 0.36);
        sign.position.set(X, Y + 3.75, z + s * 0.235);
        if (s < 0) sign.rotation.y = Math.PI;
        this.group.add(sign);
      }
      arches.push({ x: X, z, mat });
    };
    arch(VAT_X, 39);
    arch(VAT_XB, 30);
    arch(VAT_X, 21);
    arch(VAT_XB, 3);
    // Where he gets off: a landing pad beside the track, a walkway east to the cargo platform
    this.platform(44.0, 8.5, 47, 12.5, Y6, 'ns');
    this.add(M.hazard, span(44.0, Y6, 8.5, 44.3, Y6 + 0.012, 12.5), false, 0.5);
    this.walkway({ x0: 47, z0: 9.4, x1: 50, z1: 11.6, y: Y6, rails: 'both' });
    // The end of walkway 5, where he drops onto the near line: a hazard stripe
    this.add(M.hazard, span(36.8, H3, 42.9, 37.2, H3 + 0.012, 45.1), false, 0.5);
    return { a, b, arches };
  }

  /** The liquid in a vat: one material per colour, shared, the scene running its clock. */
  private liquidCache = new Map<number, THREE.ShaderMaterial>();
  private liquid(colour: number): THREE.ShaderMaterial {
    let m = this.liquidCache.get(colour);
    if (!m) {
      m = vatLiquidMaterial(colour);
      this.liquidCache.set(colour, m);
      this.vatMats.push(m);
    }
    return m;
  }

  // -------------------------------------------------------------- the cargo line

  /**
   * Three monorails out of the dispatch tower to the east wall, crates of
   * lab equipment hung under them on cables, each line running its own way.
   * He hops from crate to crate, line to line, from the cargo platform to the
   * lift's landing.
   */
  private buildCargoLine(): Level13Data['cargo'] {
    const M = this.M;
    const xa = 49.6;
    const xb = HALL.x1;
    const beamY = 65.2;
    // The dispatch tower they come out of, floor to roof
    // A dispatch house, not a slab: five metres deep (the crates go right inside it), out to just short of
    // the alighting platform, so from the cargo platform there's no seeing round the back of it
    this.add(M.concrete, span(44.5, HALL.bottom, -5, xa, HALL.top, 8.3), true, 6);
    for (const y of [H2 + 10, 80]) this.add(M.darkConcrete, span(44.2, y, -5.3, xa + 0.3, y + 1.2, 8.6), false, 6);
    const sign = warnPlate('CARGO DISPATCH 3', 2.6, 0.5);
    sign.rotation.y = Math.PI / 2;
    sign.position.set(xa + 0.02, 67.6, 2);
    this.group.add(sign);
    const lines: Level13Data['cargo']['lines'] = [
      // 1.5 m gaps: platform edge 6 | crates 4.5..2.5 | 1.0..-1.0 | -2.5..-4.5 | landing -6
      { z: 3.5, top: 59.95, speed: 1.5 },
      { z: 0, top: 60.2, speed: -1.4 },
      { z: -3.5, top: 60.0, speed: 1.35 }
    ].map((l) => ({ ...l, x0: xa - 1.5, x1: xb + 1.5 }));
    const crateMats = [0, 1, 2, 3, 4].map((i) => new THREE.MeshStandardMaterial({ map: cargoTexture(i), roughness: 0.6, metalness: 0.3 }));
    const topMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.55, metalness: 0.4 });
    const crateGeo = new THREE.BoxGeometry(2.0, 1.3, 2.0);
    const boxes: Level13Data['cargo']['boxes'] = [];
    for (const [li, l] of lines.entries()) {
      // The rail: an I-beam from the tower to the wall, a portal at each end
      this.add(M.darkSteel, span(xa, beamY, l.z - 0.18, xb, beamY + 0.06, l.z + 0.18));
      this.add(M.darkSteel, span(xa, beamY + 0.06, l.z - 0.04, xb, beamY + 0.5, l.z + 0.04));
      this.add(M.darkSteel, span(xa, beamY + 0.5, l.z - 0.18, xb, beamY + 0.56, l.z + 0.18));
      for (const [x, s] of [[xa, 1], [xb, -1]] as const) {
        this.add(M.black, span(Math.min(x, x + s * 0.04), l.top - 1.45, l.z - 1.15, Math.max(x, x + s * 0.04), beamY + 0.7, l.z + 1.15));
        this.add(M.hazard, span(Math.min(x, x + s * 0.1), beamY + 0.7, l.z - 1.25, Math.max(x, x + s * 0.1), beamY + 0.95, l.z + 1.25), false, 0.6);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: 0x221100, emissive: l.speed > 0 === (s > 0) ? 0x30ff40 : 0xff2a1a, emissiveIntensity: 3 }));
        lamp.position.set(x + s * 0.12, beamY + 1.15, l.z);
        this.group.add(lamp);
      }
      // Its rigging, the same on every crate of the line: trolley, rope, hook, spreader, four cables
      const spreadY = l.top + 2.8;
      const rig = merge([
        span(-0.35, beamY - 0.3, -0.14, 0.35, beamY, 0.14),
        span(-0.02, spreadY + 0.15, -0.02, 0.02, beamY - 0.3, 0.02),
        span(-0.08, spreadY + 0.05, -0.08, 0.08, spreadY + 0.2, 0.08),
        span(-1.0, spreadY - 0.06, -1.0, 1.0, spreadY + 0.04, -0.92),
        span(-1.0, spreadY - 0.06, 0.92, 1.0, spreadY + 0.04, 1.0),
        span(-1.0, spreadY - 0.06, -1.0, -0.92, spreadY + 0.04, 1.0),
        span(0.92, spreadY - 0.06, -1.0, 1.0, spreadY + 0.04, 1.0),
        span(-1.0, spreadY - 0.06, -0.02, 1.0, spreadY + 0.04, 0.02),
        ...[-0.95, 0.95].flatMap((cx) => [-0.95, 0.95].map((cz) => span(cx - 0.012, l.top, cz - 0.012, cx + 0.012, spreadY - 0.06, cz + 0.012)))
      ]);
      // Crates along the line, spaced so one comes by every few seconds
      const span_ = l.x1 - l.x0;
      // Two to a line, well spaced
      const n = 2;
      for (let i = 0; i < n; i++) {
        const g = new THREE.Group();
        const k = (li * 2 + i) % 5;
        const crate = new THREE.Mesh(crateGeo, [crateMats[k], crateMats[(k + 2) % 5], topMat, topMat, crateMats[(k + 1) % 5], crateMats[(k + 3) % 5]]);
        crate.position.y = l.top - 0.65;
        g.add(crate, new THREE.Mesh(rig, M.darkSteel));
        crate.userData.surface = 'metal';
        crate.userData.noDecal = true;
        this.shootables.push(crate);
        const x = l.x0 + ((i + li * 0.37) / n) * span_;
        g.position.set(x, 0, l.z);
        this.group.add(g);
        const c: Collider = { box: new THREE.Box3() };
        this.dyn.push(c);
        boxes.push({ group: g, collider: c, line: li, x });
      }
    }
    // The cargo platform he starts from, and its sign
    this.platform(50, 6, 56, 14, Y6, 'es');
    this.walkRail(50, 6, 50.08, 9.4, Y6);
    this.walkRail(50, 11.6, 50.08, 14, Y6);
    this.add(M.hazard, span(50, Y6, 6, 56, Y6 + 0.012, 6.3), false, 0.5);
    this.crate(55, Y6, 13, 1.1, 1.1);
    return { lines, boxes };
  }

  // -------------------------------------------------------------- the lift

  /**
   * A caged lift between the cargo line's landings and the control office
   * above. The shaft is a steel frame with perforated cage panels; the car
   * a floor, perforated sides and roof. Collapsible gates at the three
   * openings: south and north at the bottom, north at the top.
   */
  private buildLift(): Level13Data['lift'] {
    const M = this.M;
    const sx0 = 48.6;
    const sx1 = 57.4;
    const cx0 = 51.5;
    const cx1 = 54.5;
    const z0 = -11;
    const z1 = -8;
    const yb = Y6;
    const yt = OFFICE_Y;
    const base = yb - 0.8;
    const top = yt + 4.6;
    // The landings either side at the bottom
    this.platform(50, -8, 56, -6, yb, 'we');
    this.add(M.hazard, span(50, yb, -6.3, 56, yb + 0.012, -6), false, 0.5);
    this.platform(50, -16, 56, -11, yb, 'we');
    this.walkRail(50, -16, 52.9, -15.92, yb);
    this.walkRail(54.1, -16, 56, -15.92, yb);
    // The frame: corner posts, bracing rings every 4 m, a winch house on top
    for (const x of [sx0, cx0, cx1, sx1]) for (const z of [z0, z1]) this.add(M.darkSteel, span(x - 0.1, base, z - 0.1, x + 0.1, top, z + 0.1));
    // Bracing bars every 4 m, but never across the car's openings (one was landing right across the top one)
    const openAt: Record<number, [number, number][]> = { [z0]: [[yb, yb + 2.6], [yt, yt + 2.6]], [z1]: [[yb, yb + 2.6]] };
    for (let y = base; y < top; y += 4) {
      for (const z of [z0, z1]) {
        const blocked = openAt[z].some(([a, b]) => y + 0.16 > a - 0.05 && y < b + 0.05);
        if (blocked) {
          this.add(M.darkSteel, span(sx0, y, z - 0.08, cx0 - 0.1, y + 0.16, z + 0.08));
          this.add(M.darkSteel, span(cx1 + 0.1, y, z - 0.08, sx1, y + 0.16, z + 0.08));
        } else this.add(M.darkSteel, span(sx0, y, z - 0.08, sx1, y + 0.16, z + 0.08));
      }
    }
    this.add(M.darkSteel, span(sx0 - 0.2, top, z0 - 0.4, sx1 + 0.2, top + 0.3, z1 + 0.4));
    this.add(M.yellow, span(cx0 - 0.3, top + 0.3, z0 + 0.2, cx1 + 0.3, top + 1.4, z1 - 0.2));
    // The side bays either side of the car: solid, caged on every face
    const cage = (x0: number, y0: number, z0_: number, x1: number, y1: number, z1_: number): void => {
      this.add(M.grating, span(x0, y0, z0_, x1, y1, z1_), false, 1.2);
    };
    for (const [a, b] of [[sx0, cx0], [cx1, sx1]] as const) {
      this.solidBox(a, base, z0, b, top, z1);
      cage(a, base, z0 - 0.02, b, top, z0 + 0.02);
      cage(a, base, z1 - 0.02, b, top, z1 + 0.02);
      cage(a === sx0 ? a - 0.02 : b - 0.02, base, z0, a === sx0 ? a + 0.02 : b + 0.02, top, z1);
    }
    // The car's well: cage panels on its two faces, leaving the openings
    const opening = 2.6;
    const face = (z: number, gaps: [number, number][]): void => {
      let y = base;
      for (const [g0, g1] of [...gaps, [top, top]] as [number, number][]) {
        if (g0 > y) {
          cage(cx0, y, z - 0.02, cx1, g0, z + 0.02);
          this.solidBox(cx0, y, z - 0.06, cx1, g0, z + 0.06);
        }
        y = g1;
      }
    };
    face(z1, [[yb, yb + opening]]);
    face(z0, [[yb, yb + opening], [yt, yt + opening]]);
    // Gates: a collapsible lattice that folds toward the east side of each opening
    const gateTex = scissorGateTexture();
    gateTex.repeat.set(3, 1.3);
    const gateMat = new THREE.MeshStandardMaterial({ map: gateTex, color: 0xb8bcc0, metalness: 0.7, roughness: 0.4, alphaTest: 0.5, side: THREE.DoubleSide });
    const gates: Level13Data['lift']['gates'] = [];
    for (const [z, y, level, out] of [[z1, yb, 'bottom', 1], [z0, yb, 'bottom', -1], [z0, yt, 'top', -1]] as const) {
      const pivot = new THREE.Group();
      const m = new THREE.Mesh(new THREE.PlaneGeometry(cx1 - cx0, opening), gateMat);
      m.position.set(-(cx1 - cx0) / 2, opening / 2, 0);
      pivot.add(m);
      pivot.position.set(cx1 - 0.02, y, z + out * 0.12);
      this.group.add(pivot);
      const collider: Collider = { box: new THREE.Box3(V(cx0, y, z + out * 0.12 - 0.06), V(cx1, y + opening, z + out * 0.12 + 0.06)) };
      this.dyn.push(collider);
      gates.push({ pivot, collider, level });
      // A lamp over each opening, a sign beside the bottom ones
      this.add(M.darkSteel, span(cx0 + 1.2, y + opening + 0.05, z + out * 0.04, cx1 - 1.2, y + opening + 0.2, z + out * 0.2));
      this.add(M.lamp, span(cx0 + 1.25, y + opening + 0.02, z + out * 0.06, cx1 - 1.25, y + opening + 0.05, z + out * 0.18));
    }
    const ls = warnPlate('LIFT — CONTROL ROOM ↑', 1.5, 0.3);
    ls.position.set((sx0 + cx0) / 2, yb + 1.6, z1 + 0.05);
    this.group.add(ls);
    const ls2 = warnPlate('WALKWAY 7 LADDER: RAISED', 1.6, 0.3);
    ls2.rotation.y = Math.PI;
    ls2.position.set((cx1 + sx1) / 2, yb + 1.6, z0 - 0.05);
    this.group.add(ls2);
    // The car: floor at the group's origin
    const car = new THREE.Group();
    const w = cx1 - cx0 - 0.06;
    const d = z1 - z0 - 0.06;
    const H = 2.7;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), M.steel);
    floor.position.y = -0.09;
    const rim = new THREE.Mesh(merge([span(-w / 2, 0, -d / 2, w / 2, 0.012, -d / 2 + 0.15), span(-w / 2, 0, d / 2 - 0.15, w / 2, 0.012, d / 2)]), M.hazard);
    const frame = new THREE.Mesh(
      merge([
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => span(sx * (w / 2) - 0.05, 0, sz * (d / 2) - 0.05, sx * (w / 2) + 0.05, H, sz * (d / 2) + 0.05))),
        span(-w / 2, H - 0.08, -d / 2, w / 2, H, d / 2).translate(0, 0, 0),
        span(-w / 2, -0.4, -0.1, w / 2, -0.18, 0.1)
      ]),
      M.darkSteel
    );
    const walls = new THREE.Mesh(merge([span(-w / 2, 0.02, -d / 2, -w / 2 + 0.03, H - 0.08, d / 2), span(w / 2 - 0.03, 0.02, -d / 2, w / 2, H - 0.08, d / 2), span(-w / 2, H - 0.12, -d / 2, w / 2, H - 0.09, d / 2)]), M.grating);
    worldUVs(walls.geometry, 1.2);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.25), M.yellow);
    panel.position.set(w / 2 - 0.06, 1.3, -d / 2 + 0.4);
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3020, emissiveIntensity: 2.5 }));
    btn.position.set(w / 2 - 0.1, 1.35, -d / 2 + 0.4);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.2), M.lamp);
    light.position.y = H - 0.15;
    car.add(floor, rim, frame, walls, panel, btn, light);
    for (const m of [floor, frame]) {
      m.userData.surface = 'metal';
      m.userData.noDecal = true;
      this.shootables.push(m);
    }
    car.position.set((cx0 + cx1) / 2, yb, (z0 + z1) / 2);
    this.group.add(car);
    const floorC: Collider = { box: new THREE.Box3() };
    this.dyn.push(floorC);
    return { car, floor: floorC, x0: cx0, x1: cx1, z0, z1, yBottom: yb, yTop: yt, gates };
  }

  // -------------------------------------------------------------- the control office

  /**
   * The control room at the top of the lift, hung off the east wall over the
   * whole hall: windows all down the west side and part of the south, the
   * operators' console under them, screens, a map of the hall on the wall,
   * posters, the canteen's orders and the comics pinned up, coffee. And the
   * lever that lets down walkway 7's ladder.
   */
  private buildOffice(): Level13Data['officeLever'] {
    const M = this.M;
    const x0 = 45;
    const x1 = 58.6;
    const z0 = -24;
    const z1 = -11;
    const y = OFFICE_Y;
    const ceil = y + 3.4;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9c6bc, roughness: 0.85 });
    const carpet = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.95 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false });
    const put = (o: THREE.Object3D, x: number, yy: number, z: number, ry = 0): THREE.Object3D => {
      o.position.set(x, yy, z);
      o.rotation.y = ry;
      this.group.add(o);
      return o;
    };
    // Shell: the floor slab and its carpet, the ceiling slab, the walls
    this.add(M.darkSteel, span(x0, y - 0.6, z0, x1, y - 0.02, z1), true);
    this.add(carpet, span(x0 + 0.2, y - 0.02, z0 + 0.2, x1 - 0.2, y, z1 - 0.2));
    this.add(M.darkSteel, span(x0, ceil, z0, x1, ceil + 0.6, z1), true);
    this.add(wallMat, span(x0 + 0.2, ceil - 0.02, z0 + 0.2, x1 - 0.2, ceil, z1 - 0.2));
    // Under it: trusses, and legs down into the fog
    for (let x = x0 + 1; x < x1; x += 3) this.add(M.darkSteel, span(x - 0.12, y - 1.4, z0, x + 0.12, y - 0.6, z1));
    for (const z of [z0 + 0.5, z1 - 0.5]) this.add(M.darkSteel, span(x0 + 0.3, -10, z - 0.25, x0 + 0.8, y - 0.6, z + 0.25));
    for (const z of [z0 + 0.5, z1 - 0.5]) this.add(M.darkSteel, span(x0 + 0.3, y - 1.4, z - 0.1, x1, y - 1.2, z + 0.1));
    // North wall and east wall: solid
    this.add(wallMat, span(x0, y, z0, x1, ceil, z0 + 0.2), true);
    this.add(wallMat, span(x1 - 0.2, y, z0, x1, ceil, z1), true);
    // West wall: a low wall, the long window, a header; mullions every 1.6 m
    const sill = y + 0.95;
    const head = ceil - 0.25;
    this.add(wallMat, span(x0, y, z0, x0 + 0.2, sill, z1), true);
    this.add(wallMat, span(x0, head, z0, x0 + 0.2, ceil, z1), true);
    this.add(glass, span(x0 + 0.08, sill, z0, x0 + 0.12, head, z1));
    this.solidBox(x0, sill, z0, x0 + 0.2, head, z1);
    for (let z = z0 + 0.2; z <= z1; z += 1.6) this.add(M.darkSteel, span(x0 - 0.02, sill, z - 0.05, x0 + 0.22, head, z + 0.05));
    // South wall: window west of the lift, the lift's own cage face, solid east of it
    this.add(wallMat, span(x0, y, z1 - 0.2, 48.6, sill, z1), true);
    this.add(wallMat, span(x0, head, z1 - 0.2, 48.6, ceil, z1), true);
    this.add(glass, span(x0, sill, z1 - 0.12, 48.6, head, z1 - 0.08));
    this.solidBox(x0, sill, z1 - 0.2, 48.6, head, z1);
    for (const x of [x0 + 1.2, x0 + 2.4]) this.add(M.darkSteel, span(x - 0.05, sill, z1 - 0.22, x + 0.05, head, z1 + 0.02));
    this.add(wallMat, span(57.4, y, z1 - 0.2, x1, ceil, z1), true);
    // Outside: a band of light along the top of the window, the name on the wall
    for (const z of [z0 + 0.5, z1 - 0.5]) this.add(M.lamp, span(x0 + 0.3, ceil - 0.06, z - 0.15, x1 - 0.3, ceil, z + 0.15));
    for (let x = x0 + 2; x < x1 - 1; x += 3.2) this.add(M.lamp, span(x - 0.6, ceil - 0.05, -18.1, x + 0.6, ceil, -16.9));
    const l = new THREE.PointLight(0xfff0d8, 20, 18, 1.5);
    l.position.set(52, ceil - 0.5, -17.5);
    this.group.add(l);
    this.hallLights.push(l);
    const nameplate = warnPlate('SECTOR 7 CONTROL', 3.2, 0.6);
    nameplate.rotation.y = -Math.PI / 2;
    nameplate.position.set(x0 - 0.02, ceil + 0.3, (z0 + z1) / 2);
    this.group.add(nameplate);
    // ---- The console under the west window: a long desk, five screens, keyboards, chairs facing out
    this.add(M.darkSteel, span(x0 + 0.2, y, z0 + 1.2, x0 + 1.4, y + 0.74, z1 - 1.2), true);
    this.add(new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4 }), span(x0 + 0.2, y + 0.74, z0 + 1.1, x0 + 1.5, y + 0.78, z1 - 1.1));
    const kinds: ScreenKind[] = ['sentries', 'vats', 'cams', 'specimen', 'sentries'];
    kinds.forEach((k, i) => {
      const z = z0 + 2.4 + i * 2.1;
      put(monitor(k), x0 + 0.65, y + 0.78, z, Math.PI / 2);
      const chair = officeChair();
      put(chair, x0 + 2.2, y, z + (i % 2 ? 0.2 : -0.1), Math.PI / 2 + (i - 2) * 0.12);
      this.solidBox(x0 + 1.95, y, z - 0.3, x0 + 2.45, y + 0.5, z + 0.3);
    });
    put(ecMug(), x0 + 1.2, y + 0.78, z0 + 3.4, 0.6);
    put(ecMug(false), x0 + 1.25, y + 0.78, z0 + 8.1, 2.1);
    put(ecMug(), x0 + 1.15, y + 0.78, z0 + 10.6, -0.8);
    for (const [i, z] of [z0 + 5.2, z0 + 7.0].entries()) {
      const s = orderSheet(i);
      s.rotation.set(-Math.PI / 2, 0, 0.4 + i);
      s.position.set(x0 + 1.15, y + 0.785, z);
      this.group.add(s);
    }
    // ---- The big map of the hall on the north wall, posters either side
    put(screenPanel('map', 3.4, 2.0), 51.6, y + 1.9, z0 + 0.22);
    put(poster('teamwork'), 48.1, y + 1.75, z0 + 0.22);
    put(poster('safety'), 55.2, y + 1.75, z0 + 0.22);
    put(poster('employee', 0.55, 0.74), 56.9, y + 1.75, z0 + 0.22);
    // ---- East wall: posters, the corkboard with the canteen's orders and the comics, the lever
    const east = x1 - 0.22;
    put(poster('hang'), east, y + 1.7, -14.6, -Math.PI / 2);
    put(poster('payload'), east, y + 1.7, -22.4, -Math.PI / 2);
    put(poster('specimens', 0.55, 0.74), east, y + 1.7, -12.4, -Math.PI / 2);
    const cork = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.1, 2.6), new THREE.MeshStandardMaterial({ color: 0xa47a4a, roughness: 1 }));
    put(cork, east - 0.015, y + 1.65, -18.6);
    for (let i = 0; i < 5; i++) {
      const s = orderSheet(i, 0.24, 0.32);
      s.rotation.set(0, -Math.PI / 2, (i % 2 ? 0.05 : -0.06) * (i - 2));
      s.position.set(east - 0.035, y + 1.85 - (i % 2) * 0.42, -19.7 + Math.floor(i / 2) * 0.62 + (i % 2) * 0.3);
      this.group.add(s);
    }
    for (let i = 0; i < 2; i++) {
      const cm = comic(i, 0.6);
      cm.rotation.y = -Math.PI / 2;
      cm.position.set(east - 0.035, y + 1.35 + i * 0.62, -17.6 + i * 0.05);
      this.group.add(cm);
    }
    // Coffee: a counter in the south-east corner, the machine, the mugs, the cooler beside it
    this.add(new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 0.7 }), span(east - 0.6, y, -13.9, east, y + 0.92, -11.2), true);
    this.add(new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.4 }), span(east - 0.62, y + 0.92, -13.92, east, y + 0.96, -11.2));
    const machine = new THREE.Group();
    const mBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.36), new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.4, metalness: 0.4 }));
    mBody.position.y = 0.25;
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.16, 14), new THREE.MeshStandardMaterial({ color: 0x2a160a, roughness: 0.1, transparent: true, opacity: 0.85 }));
    pot.position.set(-0.08, 0.1, 0);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 3 }));
    led.position.set(-0.21, 0.4, 0.1);
    machine.add(mBody, pot, led);
    put(machine, east - 0.28, y + 0.96, -12.0, -Math.PI / 2);
    for (let i = 0; i < 4; i++) put(ecMug(i % 2 === 0), east - 0.35 + (i % 2) * 0.12, y + 0.96, -12.9 - i * 0.18, i * 1.3);
    put(waterCooler(), east - 0.3, y, -14.5, -Math.PI / 2);
    this.solidBox(east - 0.55, y, -14.8, east, y + 1.4, -14.2);
    // ---- Two desks in the room, a bin, a dying plant
    put(officeDesk(1.6), 52.0, y, -19.5);
    this.solidBox(51.2, y, -19.9, 52.8, y + 0.76, -19.1);
    put(monitor('email'), 51.7, y + 0.745, -19.75);
    put(ecMug(), 52.5, y + 0.745, -19.6, 1.0);
    const sheet = orderSheet(3);
    sheet.rotation.set(-Math.PI / 2, 0, -0.3);
    sheet.position.set(52.35, y + 0.75, -19.3);
    this.group.add(sheet);
    put(officeChair(), 51.9, y, -18.7, Math.PI);
    put(officeDesk(1.6), 52.0, y, -15.2, Math.PI);
    this.solidBox(51.2, y, -15.6, 52.8, y + 0.76, -14.8);
    put(monitor('cams'), 52.3, y + 0.745, -14.95, Math.PI);
    put(comic(0, 0.36), 51.6, y + 0.752, -15.25).rotation.set(-Math.PI / 2, 0, 0.2);
    put(officeChair(), 52.1, y, -16.0, 0);
    put(trashCan(), 50.7, y, -14.6);
    put(flowerPot('dying'), 57.6, y, -23.3);
    // ---- The rest of the office: a clock, the printer, filing, binders, the rota board, coats, the extinguisher
    put(wallClock(), 51.6, y + 3.12, z0 + 0.22);
    put(printer(), 46.95, y, -23.42, Math.PI);
    this.solidBox(46.58, y, -23.8, 47.32, y + 1.2, -23.08);
    put(fileCabinet(0.6, 1.3, 1.0, 3), 54.1, y, -23.48, Math.PI / 2);
    this.solidBox(53.6, y, -23.8, 54.6, y + 1.3, -23.18);
    put(paperStack(9, 0.05), 54.0, y + 1.3, -23.5, 0.2);
    put(binderShelf(1.3, 1.2), 55.75, y, -23.62);
    this.solidBox(55.1, y, -23.8, 56.4, y + 1.2, -23.44);
    put(whiteboardStand(), 56.9, y, -16.4, -Math.PI / 2);
    this.solidBox(56.6, y, -17.2, 57.2, y + 1.9, -15.6);
    put(coatRack(), 47.6, y, -11.75);
    this.solidBox(47.4, y, -11.95, 47.8, y + 1.8, -11.55);
    put(fireExtinguisher(), 45.6, y, -23.45);
    put(fireAlarm(), 57.9, y + 1.4, -11.21, Math.PI);
    put(flowerPot('tall'), 45.65, y, -11.6);
    this.solidBox(45.4, y, -11.85, 45.9, y + 1.4, -11.35);
    // Desk clutter along the console: a phone, pens, paperwork, a headset, notes stuck on the screens
    const top = y + 0.78;
    put(deskPhone(), 46.0, top, -22.35, Math.PI / 2);
    put(penCup(), 46.1, top, -20.95);
    put(paperStack(6, 0.04), 46.05, top, -16.4, 0.4);
    put(headset(), 46.05, top, -14.25, 0.3);
    put(penCup(), 46.12, top, -12.6);
    put(sodaCan(), 46.15, top, -18.15);
    for (const [z, n] of [[-21.85, 3], [-17.6, 2], [-13.05, 2]] as const) put(stickyNotes(n), 45.69, top + 0.52, z, Math.PI / 2);
    // And on the two desks
    const dt = y + 0.745;
    put(deskPhone(), 51.35, dt, -19.3, 0.2);
    put(penCup(), 52.75, dt, -19.75);
    put(snack('nutbar'), 52.6, dt, -19.25, 0.6);
    put(deskPhone(), 52.7, dt, -15.05, Math.PI - 0.2);
    put(paperStack(7, 0.05), 51.35, dt, -15.35, 0.3);
    put(sodaCan(), 52.75, dt, -15.45);
    put(penCup(), 51.3, dt, -14.95);

    // ---- The lever: a release box on the east wall, its handle down
    const at = V(east, y + 1.2, -21.0);
    this.add(M.yellow, span(east - 0.14, at.y - 0.35, at.z - 0.25, east, at.y + 0.35, at.z + 0.25));
    this.add(M.hazard, span(east - 0.15, at.y - 0.32, at.z - 0.22, east - 0.14, at.y - 0.18, at.z + 0.22), false, 0.4);
    const label = warnPlate('WALKWAY 7 LADDER — RELEASE', 0.9, 0.18);
    label.rotation.y = -Math.PI / 2;
    label.position.set(east - 0.01, at.y + 0.5, at.z);
    this.group.add(label);
    const pivot = new THREE.Group();
    pivot.position.set(east - 0.16, at.y, at.z);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 8), M.steel);
    arm.position.y = 0.22;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshStandardMaterial({ color: 0xb8261c, roughness: 0.4 }));
    knob.position.y = 0.46;
    pivot.add(arm, knob);
    pivot.rotation.z = Math.PI - 0.5;
    this.group.add(pivot);
    return { pivot, at: V(east - 0.6, y, at.z) };
  }

  // -------------------------------------------------------------- walkway 7 and the door

  /**
   * North of the lift: the drop ladder from its north landing up to walkway
   * 7 (pulled up until the lever's thrown), the walkway, the last platform
   * and the blast door in the east wall.
   */
  private buildFinale(): { dropLadder: Level13Data['dropLadder']; door: Level13Data['door'] } {
    const M = this.M;
    const lx = 53.5;
    const lz = -16.2;
    this.walkway({ x0: 52.4, z0: -24, x1: 54.6, z1: -16.4, y: H4, rails: 'both', hangTo: OFFICE_Y - 1.4 });
    this.platform(52, -36, 60, -24, H4, 'nw');
    this.walkRail(52, -24.08, 52.4, -24, H4);
    this.walkRail(54.6, -24.08, 60, -24, H4);
    this.coverStack(53.4, H4, -34.6, 1.0);
    this.crate(58.8, H4, -25.2, 1.1, 1.1);
    this.vat(58.4, H4, -34.6, 0.7, 1.8, 0xb35cff);
    // Guides at the walkway's end that the ladder slides in
    for (const s of [-0.3, 0.3]) this.add(M.darkSteel, span(lx + s - 0.05, H4 - 0.4, lz - 0.2, lx + s + 0.05, H4 + 1.1, lz - 0.1));
    // The ladder: its own group, drawn up 4.6 m until released
    const h = H4 - Y6;
    const g = new THREE.Group();
    const parts: THREE.BufferGeometry[] = [];
    for (const s of [-0.24, 0.24]) parts.push(span(s - 0.033, 0, -0.04, s + 0.033, h + 1.0, 0.04));
    for (let y = 0.3; y < h; y += 0.3) {
      const r = new THREE.CylinderGeometry(0.024, 0.024, 0.48, 6);
      r.rotateZ(Math.PI / 2);
      r.translate(0, y, 0);
      parts.push(r);
    }
    g.add(new THREE.Mesh(merge(parts), M.yellow));
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.02), M.hazard);
    plate.position.set(0, 1.6, -0.05);
    g.add(plate);
    const raise = 4.6;
    g.position.set(lx, Y6 + raise, lz);
    this.group.add(g);
    this.ladderTops.push(V(lx, H4 + 0.4, lz - 0.5));
    const ladder: Ladder = { base: V(lx, Y6, -15.7), face: 0, top: H4, off: V(lx, H4, -17.3), disabled: true };
    const door = this.buildDoor();
    return { dropLadder: { group: g, raise, ladder }, door };
  }

  // -------------------------------------------------------------- the weapons crate

  /** On the first platform, against its south rail: an armoury crate, its lid up, the quad-barrel in the foam. */
  private buildGunCrate(): Level13Data['gunCrate'] {
    const M = this.M;
    const x = -56.5;
    const z = -28.75;
    const y = H1;
    const olive = new THREE.MeshStandardMaterial({ color: 0x343b2a, roughness: 0.8 });
    const foam = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 1 });
    this.add(M.darkSteel, box(1.3, 0.08, 0.7, x, y, z));
    this.add(olive, box(1.3, 0.5, 0.7, x, y + 0.08, z));
    this.add(foam, box(1.16, 0.02, 0.56, x, y + 0.57, z));
    for (const s of [-1, 1]) {
      this.add(M.darkSteel, box(1.32, 0.06, 0.04, x, y + 0.39, z + s * 0.36));
      this.add(M.darkSteel, box(0.04, 0.5, 0.72, x + s * 0.55, y + 0.08, z));
    }
    this.solidBox(x - 0.66, y, z - 0.36, x + 0.66, y + 0.58, z + 0.36);
    // The lid, thrown back against the rail
    const lid = new THREE.BoxGeometry(1.3, 0.05, 0.7);
    lid.translate(0, 0, 0.35);
    lid.rotateX(-1.3);
    lid.translate(x, y + 0.58, z + 0.35);
    this.add(olive, lid);
    // Its stencil, on the side he comes to
    const c = makeCanvas(512, 128);
    const g = c.getContext('2d')!;
    g.fillStyle = '#343b2a';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#d8d2b4';
    g.font = 'bold 54px Arial';
    g.fillText('EC ARMORY', 20, 62);
    g.font = 'bold 28px Arial';
    g.fillText('QB-4 — PRESSURE-ASSIST', 20, 108);
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.8 }));
    label.position.set(x, y + 0.33, z - 0.352);
    label.rotation.y = Math.PI;
    this.group.add(label);
    // The gun in its foam, on its side, the gauge up
    const q = quadShotgunModel();
    q.group.position.set(x, y + 0.63, z);
    q.group.rotation.set(0, Math.PI / 2, -(Math.PI / 2 - 0.08));
    q.setPressure(0);
    this.group.add(q.group);
    // A strip of light inside the lid
    this.add(M.lamp, box(0.9, 0.02, 0.03, x, y + 0.98, z + 0.5));
    return { gun: q.group, pump: q.pump, setPressure: q.setPressure, stand: V(x, y, z - 1.2), yaw: Math.PI };
  }

  // -------------------------------------------------------------- the waste room

  /**
   * Waste Processing 2, through the hall's west wall: a tall concrete box
   * with no floor — under it a hopper, and in the hopper two toothed rollers
   * turning into each other. Chutes in the ceiling drop the Collective's
   * scrap into it. The way through is what's left of a gantry: a ledge
   * inside each door, three girders and a platform between them, each one
   * higher than the last; three of the chutes drop straight onto it.
   */
  private buildGrinder(): Level13Data['grinder'] {
    const M = this.M;
    const { x0, x1, z0, z1, floor, top } = GRIND;
    // ---- The box (the hall's wall is its east side)
    this.add(M.darkConcrete, span(x0 - 1, floor - 1, z0 - 1, x0, top + 1, z1 + 1), true, 5);
    this.add(M.darkConcrete, span(x0, floor - 1, z0 - 1, x1, top + 1, z0), true, 5);
    this.add(M.darkConcrete, span(x0, floor - 1, z1, x1, top + 1, z1 + 1), true, 5);
    this.add(M.darkConcrete, span(x0 - 1, top, z0 - 1, x1, top + 1, z1 + 1), true, 5);
    this.add(M.darkConcrete, span(x0, floor - 1, z0, x1, floor, z1), true, 5);
    // Bands round the walls, and a rust-streaked steel skirt above the hopper
    for (const y of [H1 - 1.2, H2 - 0.4, top - 2.2]) {
      this.add(M.concrete, span(x0, y, z0, x0 + 0.25, y + 0.5, z1), false, 4);
      this.add(M.concrete, span(x0, y, z0, x1, y + 0.5, z0 + 0.25), false, 4);
      this.add(M.concrete, span(x0, y, z1 - 0.25, x1, y + 0.5, z1), false, 4);
    }
    this.add(M.hazard, span(x0, 44.2, z0 + 0.02, x1, 44.9, z0 + 0.06), false, 1.2);
    this.add(M.hazard, span(x0, 44.2, z1 - 0.06, x1, 44.9, z1 - 0.02), false, 1.2);
    this.add(M.hazard, span(x0 + 0.02, 44.2, z0, x0 + 0.06, 44.9, z1), false, 1.2);
    this.add(M.hazard, span(x1 - 0.06, 44.2, z0, x1 - 0.02, 44.9, z1), false, 1.2);
    // ---- The hopper: steel plates sloping in from the long walls down to the rollers
    const zc = (z0 + z1) / 2;
    for (const s of [-1, 1]) {
      const wallZ = s < 0 ? z0 : z1;
      const lipZ = zc + s * 3.9;
      const len = Math.hypot(wallZ - lipZ, 3.6);
      const g = new THREE.BoxGeometry(x1 - x0, 0.14, len);
      g.rotateX(Math.atan2(3.6, Math.abs(wallZ - lipZ)) * s);
      g.translate((x0 + x1) / 2, 42.4, (wallZ + lipZ) / 2);
      this.add(M.rust, g);
      // Ribs down it
      for (let x = x0 + 1.5; x < x1; x += 3) {
        const r = new THREE.BoxGeometry(0.16, 0.3, len);
        r.rotateX(Math.atan2(3.6, Math.abs(wallZ - lipZ)) * s);
        r.translate(x, 42.5, (wallZ + lipZ) / 2);
        this.add(M.darkSteel, r);
      }
    }
    // ---- The rollers: drums the length of the room, rings of teeth staggered round them
    const rollers: THREE.Object3D[] = [];
    const rollMat = new THREE.MeshStandardMaterial({ color: 0x6d5f55, roughness: 0.55, metalness: 0.65 });
    const toothMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 });
    const L = x1 - x0 - 0.6;
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const drum = new THREE.CylinderGeometry(1.55, 1.55, L, 20);
      drum.rotateZ(Math.PI / 2);
      const teeth: THREE.BufferGeometry[] = [];
      let ring = 0;
      for (let x = -L / 2 + 0.6; x < L / 2 - 0.3; x += 1.15, ring++) {
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + (ring % 2) * 0.45 + (s > 0 ? 0.22 : 0);
          const t = new THREE.BoxGeometry(0.42, 0.75, 0.42);
          t.translate(0, 1.75, 0);
          // Raked into the turn
          t.rotateX(a);
          t.translate(x, 0, 0);
          teeth.push(t);
        }
      }
      const d = new THREE.Mesh(drum, rollMat);
      const tm = new THREE.Mesh(merge(teeth), toothMat);
      g.add(d, tm);
      g.position.set((x0 + x1) / 2, 39.4, zc + s * 2.0);
      this.group.add(g);
      rollers.push(g);
      // Its bearings in the end walls
      for (const ex of [x0 + 0.15, x1 - 0.15]) {
        const b = new THREE.CylinderGeometry(0.7, 0.7, 0.3, 14);
        b.rotateZ(Math.PI / 2);
        b.translate(ex, 39.4, zc + s * 2.0);
        this.add(M.darkSteel, b);
      }
    }
    // A furnace glow from under them
    this.add(new THREE.MeshBasicMaterial({ color: 0xff5a14 }), span(x0, floor, zc - 1.2, x1, floor + 0.05, zc + 1.2));
    // ---- The way through
    const ledge = (lx0: number, lz0: number, lx1: number, lz1: number, y: number): void => {
      this.add(M.grating, span(lx0, y - 0.04, lz0, lx1, y, lz1), false, 1.5);
      this.solidBox(lx0, y - 0.3, lz0, lx1, y, lz1);
      this.add(M.darkSteel, span(lx0, y - 0.4, lz0, lx1, y - 0.04, lz0 + 0.18));
      this.add(M.darkSteel, span(lx0, y - 0.4, lz1 - 0.18, lx1, y - 0.04, lz1));
      this.add(M.darkSteel, span(lx0, y - 0.4, lz0, lx0 + 0.18, y - 0.04, lz1));
      this.add(M.hazard, span(lx0, y, lz0, lx0 + 0.3, y + 0.012, lz1), false, 0.5);
      this.walkRail(lx0, lz0, lx1, lz0 + 0.08, y);
      this.walkRail(lx0, lz1 - 0.08, lx1, lz1, y);
      // Brackets back to the wall under it
      for (const z of [lz0 + 0.3, lz1 - 0.3]) {
        const b = new THREE.BoxGeometry(0.14, 0.14, Math.hypot(lx1 - lx0 - 0.4, 2.4));
        b.rotateY(Math.PI / 2);
        b.rotateZ(Math.atan2(2.4, lx1 - lx0 - 0.4));
        b.translate((lx0 + lx1) / 2 + 0.2, y - 1.55, z);
        this.add(M.darkSteel, b);
      }
    };
    ledge(-66, -0.6, x1, 2.8, H1);
    ledge(-66, 8.6, x1, 11.4, H2);
    /** A girder to walk: an I-beam 0.7 wide, hung from the roof on chains. */
    const girder = (gx0: number, gz0: number, gx1: number, gz1: number, y: number): void => {
      const alongX = gx1 - gx0 > gz1 - gz0;
      this.add(M.yellow, span(gx0, y - 0.07, gz0, gx1, y, gz1));
      if (alongX) {
        const zm = (gz0 + gz1) / 2;
        this.add(M.rust, span(gx0, y - 0.5, zm - 0.06, gx1, y - 0.07, zm + 0.06));
        this.add(M.rust, span(gx0, y - 0.57, gz0, gx1, y - 0.5, gz1));
        for (const x of [gx0 + 0.3, gx1 - 0.3]) for (const z of [gz0 + 0.04, gz1 - 0.04]) this.add(M.darkSteel, span(x - 0.02, y, z - 0.02, x + 0.02, top, z + 0.02));
        this.add(M.hazard, span(gx0, y, gz0, gx0 + 0.4, y + 0.01, gz1), false, 0.5);
        this.add(M.hazard, span(gx1 - 0.4, y, gz0, gx1, y + 0.01, gz1), false, 0.5);
      } else {
        const xm = (gx0 + gx1) / 2;
        this.add(M.rust, span(xm - 0.06, y - 0.5, gz0, xm + 0.06, y - 0.07, gz1));
        this.add(M.rust, span(gx0, y - 0.57, gz0, gx1, y - 0.5, gz1));
        for (const z of [gz0 + 0.3, gz1 - 0.3]) for (const x of [gx0 + 0.04, gx1 - 0.04]) this.add(M.darkSteel, span(x - 0.02, y, z - 0.02, x + 0.02, top, z + 0.02));
        this.add(M.hazard, span(gx0, y, gz0, gx1, y + 0.01, gz0 + 0.4), false, 0.5);
        this.add(M.hazard, span(gx0, y, gz1 - 0.4, gx1, y + 0.01, gz1), false, 0.5);
      }
      this.solidBox(gx0, y - 0.57, gz0, gx1, y, gz1);
    };
    girder(-76.2, 0.75, -68.2, 1.45, H1);
    girder(-80.35, 3, -79.65, 10, H1 + 1.6);
    girder(-75, 13.2, -67.5, 13.9, H1 + 5);
    // The rest platform between the second and third: what's left of the old gantry's corner
    const PY = H1 + 1.9;
    this.add(M.grating, span(-84, PY - 0.04, 12, -78, PY, 16.5), false, 1.5);
    this.solidBox(-84, PY - 0.3, 12, -78, PY, 16.5);
    for (const [a, b, c, d] of [[-84, 12, -78, 12.18], [-84, 16.32, -78, 16.5], [-84, 12, -83.82, 16.5], [-78.18, 12, -78, 16.5]]) this.add(M.darkSteel, span(a, PY - 0.4, b, c, PY - 0.04, d));
    this.walkRail(-84, 16.42, -78, 16.5, PY);
    this.walkRail(-84, 12, -83.92, 16.5, PY);
    for (const [x, z] of [[-83.8, 12.2], [-78.2, 12.2], [-83.8, 16.3], [-78.2, 16.3]]) this.add(M.darkSteel, span(x - 0.03, PY + 1.1, z - 0.03, x + 0.03, top, z + 0.03));
    this.add(M.darkSteel, span(-88, PY - 0.35, 13.9, -84, PY - 0.1, 14.2));
    this.add(M.darkSteel, span(-88, PY - 0.35, 15.6, -84, PY - 0.1, 15.9));
    // ---- The chutes: fat ducts down out of the ceiling, a hazard collar and a warning lamp at each mouth
    const chutes: Level13Data['grinder']['chutes'] = [];
    const duct = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide });
    const chute = (cx: number, cz: number, period: number, phase: number): void => {
      const mouthY = top - 3.4;
      const tube = new THREE.CylinderGeometry(1.25, 1.25, 3.4, 18, 1, true);
      tube.translate(cx, mouthY + 1.7, cz);
      this.add(duct, tube);
      const collar = new THREE.CylinderGeometry(1.38, 1.38, 0.35, 18, 1, true);
      collar.translate(cx, mouthY + 0.18, cz);
      this.add(M.hazard, collar, false, 0);
      for (const y of [mouthY + 1.4, mouthY + 2.6]) {
        const band = new THREE.TorusGeometry(1.27, 0.05, 6, 20);
        band.rotateX(Math.PI / 2);
        band.translate(cx, y, cz);
        this.add(M.darkSteel, band);
      }
      const dark = new THREE.CircleGeometry(1.24, 18);
      dark.rotateX(Math.PI / 2);
      dark.translate(cx, top - 0.02, cz);
      this.add(M.black, dark);
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x220a00, emissive: 0xff7a1a, emissiveIntensity: 0.3 });
      for (const a of [0.6, 2.7, 4.8]) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), lampMat);
        l.position.set(cx + Math.cos(a) * 1.42, mouthY + 0.1, cz + Math.sin(a) * 1.42);
        this.group.add(l);
      }
      chutes.push({ mouth: V(cx, mouthY - 0.6, cz), period, phase, lamp: lampMat });
    };
    // Over the first girder, the second and the third; and two off the route that just feed the grinder
    chute(-72.2, 1.1, 3.6, 0.4);
    chute(-80, 6.5, 4.3, 1.9);
    chute(-71.4, 13.55, 3.3, 2.6);
    chute(-84.5, -4.5, 5.2, 0.9);
    chute(-66, 16.5, 6.1, 3.3);
    // ---- Light: the furnace from below, a cold flood from the roof
    const glow = new THREE.PointLight(0xff6a22, 70, 34, 1.5);
    glow.position.set((x0 + x1) / 2, 41.5, zc);
    const flood = new THREE.PointLight(0xcfe0ee, 46, 36, 1.4);
    flood.position.set((x0 + x1) / 2, top - 4.5, zc);
    this.group.add(glow, flood);
    this.add(M.lamp, span(-75.5, top - 0.06, zc - 3, -73.5, top, zc + 3));
    // ---- Signs, and the door frames
    for (const [y, za, zb] of [[H1, -0.2, 2.4], [H2, 8.8, 11.2]] as const) {
      for (const x of [x1 - 0.06, HALL.x0]) {
        this.add(M.hazard, span(x, y, za - 0.3, x + 0.06, y + 3.3, za), false, 0.6);
        this.add(M.hazard, span(x, y, zb, x + 0.06, y + 3.3, zb + 0.3), false, 0.6);
        this.add(M.hazard, span(x, y + 3, za - 0.3, x + 0.06, y + 3.3, zb + 0.3), false, 0.6);
      }
    }
    const put = (m: THREE.Object3D, x: number, y: number, z: number, ry: number): void => {
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.group.add(m);
    };
    put(warnPlate('WASTE PROCESSING 2', 2.4, 0.44), HALL.x0 + 0.08, H1 + 3.75, 1.1, Math.PI / 2);
    put(warnPlate('DANGER — FALLING WASTE', 2.4, 0.36), HALL.x0 + 0.08, H1 + 4.25, 1.1, Math.PI / 2);
    put(warnPlate('GANTRY UNSAFE — NO ENTRY', 1.9, 0.3), HALL.x0 + 0.08, H1 + 1.6, 3.6, Math.PI / 2);
    put(warnPlate('WASTE PROCESSING 2 — EXIT', 2.4, 0.36), HALL.x0 + 0.08, H2 + 3.7, 10, Math.PI / 2);
    put(warnPlate('GRINDER LIVE — KEEP CLEAR OF HOPPER', 6, 0.7), x0 + 0.03, H1 + 6, zc, Math.PI / 2);
    put(warnPlate('CHUTES DISCHARGE WITHOUT WARNING', 6, 0.6), (x0 + x1) / 2, H2 + 4.5, z0 + 0.03, 0);
    put(warnPlate('DO NOT STAND UNDER CHUTES', 5, 0.6), (x0 + x1) / 2, H1 + 3.2, z1 - 0.03, Math.PI);
    put(warnPlate('EXIT ↑', 1.4, 0.4), x1 - 0.08, H2 + 3.7, 10, -Math.PI / 2);
    return { rollers, chutes };
  }

  // -------------------------------------------------------------- signs and fittings

  /** What a works like this has screwed to every surface: plates, placards, beacons, drums, hose reels. */
  private buildSigns(): void {
    const M = this.M;
    const put = (m: THREE.Object3D, x: number, y: number, z: number, ry = 0): void => {
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.group.add(m);
    };
    /** A plate on a post standing on a deck, facing `ry`. */
    const post = (text: string, x: number, y: number, z: number, ry: number, w = 1.5, h = 0.34): void => {
      this.add(M.darkSteel, span(x - 0.03, y, z - 0.03, x + 0.03, y + 2.0, z + 0.03));
      put(warnPlate(text, w, h), x - Math.sin(ry) * -0.04, y + 2.0, z + Math.cos(ry) * 0.04, ry);
    };
    // The first platform and the step
    post('SECTOR 4 — WALKWAY A', -53.6, H1, -33.6, -Math.PI / 2);
    put(warnPlate('PRESSURE-ASSIST ACCESS ONLY', 2.0, 0.34), -45.53, H1 + 2.05, -31, -Math.PI / 2);
    put(warnPlate('↑ 2.6 m', 0.9, 0.34), -45.53, H1 + 1.5, -31, -Math.PI / 2);
    // S2's gap
    post('SPAN REMOVED', -32.7, H1, -18.6, Math.PI, 1.3);
    post('NO RAILS — HOLD ON TO NOTHING', -32.7, H1, -26.4, Math.PI, 1.7, 0.3);
    // Platform 2: the ladder's gone
    put(warnPlate('LADDER OUT OF SERVICE', 1.6, 0.3), -32, H1 + 1.9, 5.3, Math.PI);
    put(warnPlate('WASTE PROCESSING 2 →', 1.7, 0.3), -35.9, H1 + 1.35, 3.8, Math.PI / 2);
    // The broken span, the lever, the vat lines
    post('SPAN CLOSED', -27.4, H2, 9.25, -Math.PI / 2, 1.2);
    post('LEVER CALLS PLATFORM', -1.4, H2, 36.9, Math.PI / 2, 1.6);
    post('VAT LINES B · A — NORTHBOUND', 34.4, H3, 45.0, -Math.PI / 2, 2.0);
    post('CHANGE LINES BEFORE EACH ARCH', 34.4, H3, 43.0, -Math.PI / 2, 2.0, 0.3);
    post('ALIGHT HERE', 46.6, Y6, 8.8, 0, 1.1);
    post('CARGO LINE — MIND THE GAPS', 55.6, Y6, 7.4, -Math.PI / 2, 1.9);
    // Level markers on the columns and walls: big stencilled plates
    for (const [text, x, y, z, ry] of [
      ['LEVEL 1', -45, H1 + 2, -53.96, 0],
      ['LEVEL 2', -6, H2 + 2, -27.96, 0],
      ['LEVEL 3', 16, H3 + 2, 57.96, Math.PI],
      ['BAY 7', -45.96, H2 + 2, 26, Math.PI / 2],
      ['BAY 9', 13.96, H2 + 3, -14, -Math.PI / 2]
    ] as const) {
      put(warnPlate(text, 2.6, 0.7), x, y, z, ry);
    }
    // Beacons on the corners of the platforms the route crosses
    const amber = new THREE.MeshStandardMaterial({ color: 0x332200, emissive: 0xffa21a, emissiveIntensity: 2.6 });
    for (const [x, y, z] of [[-53.2, H1, -28.2], [-36, H1, -36], [-28.2, H1, 5.2], [-36, H2, 13], [6, H2, 14], [6, H2, 30], [34, H2, 30.2], [34, H3, 48], [47, Y6, 8.6], [56, Y6, 6.2]]) {
      this.add(M.darkSteel, span(x - 0.04, y + 1.12, z - 0.04, x + 0.04, y + 1.4, z + 0.04));
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), amber);
      b.position.set(x, y + 1.46, z);
      this.group.add(b);
    }
    // Drums, a hose reel, extinguishers, a toolbox: left where people were working
    for (const [kind, x, y, z] of [['yellow', -54.2, H1, -33.3], ['blue', -29.2, H1, 4.4], ['rust', -29.3, H1, 3.3], ['blue', 5.2, H2, 31], ['yellow', 33, H3, 41], ['rust', 51, Y6, 13.2]] as const) {
      const b = barrel(kind);
      put(b, x, y, z, x);
      this.solidBox(x - 0.3, y, z - 0.3, x + 0.3, y + 0.9, z + 0.3);
    }
    put(fireExtinguisher(), -59.8, H1 + 0.9, -29.2, Math.PI / 2);
    put(fireExtinguisher(), -61.12, H1 + 0.9, 2.5, -Math.PI / 2);
    put(hoseReel(), HALL.x0 + 0.12, H1 + 1.4, -2.2, Math.PI / 2);
    put(toolbox(), -29.4, H1, -2.2, 0.5);
    put(toolbox(), -82.6, H1 + 1.9, 15.6, 0.3);
    put(hardHat(), -82.9, H1 + 2.13, 15.5, 1);
    // Cable trays along the west wall, and conduit down to the door controls
    for (const y of [H1 + 4.6, H2 + 4.2]) {
      this.add(M.darkSteel, span(HALL.x0, y, -27, HALL.x0 + 0.3, y + 0.06, 40));
      for (let z = -26; z < 40; z += 2.2) this.add(M.darkSteel, span(HALL.x0, y - 0.25, z, HALL.x0 + 0.05, y, z + 0.05));
      for (const k of [0.07, 0.15, 0.22]) this.add(M.black, span(HALL.x0 + k - 0.02, y + 0.06, -27, HALL.x0 + k + 0.02, y + 0.1, 40));
    }
    for (const [y, z] of [[H1, 2.9], [H2, 11.7]]) {
      this.add(M.darkSteel, span(HALL.x0, y + 1.1, z, HALL.x0 + 0.1, y + 1.5, z + 0.3));
      this.add(M.greenLamp, span(HALL.x0 + 0.1, y + 1.35, z + 0.08, HALL.x0 + 0.12, y + 1.42, z + 0.22));
      this.add(M.pipe, span(HALL.x0 + 0.02, y + 1.5, z + 0.12, HALL.x0 + 0.06, y + 4.4, z + 0.18));
    }
  }

  // -------------------------------------------------------------- the abyss
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
      if (Math.abs(x - HALL.x1) < 4 && z > -38 && z < 10) continue;
      if (Math.abs(x - VAT_X) < 4) continue;
      g.translate(x, (HALL.top + HALL.bottom) / 2, z);
      this.add(r() < 0.5 ? M.pipe : M.rust, g);
    }
    // Chains hanging into the void
    for (let i = 0; i < 26; i++) {
      const x = -55 + r() * 110;
      const z = -65 + r() * 130;
      const len = 20 + r() * 40;
      if (x > 36) continue;
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
    this.walkway({ x0: HALL.x1 - 3, z0: HALL.z0 + 3, x1: HALL.x1 - 1, z1: -38, y, rails: '-' });
    this.walkway({ x0: HALL.x1 - 3, z0: 10, x1: HALL.x1 - 1, z1: HALL.z1 - 3, y, rails: '-' });
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
    sign('SECTOR 7 — CONTAINMENT', HALL.x0 + 0.05, 58, -10, Math.PI / 2);
    sign('DANGER — NO RETURN BELOW', HALL.x1 - 0.05, 52, 12, -Math.PI / 2);
    sign('BIOHAZARD TRANSIT', 0, 64, HALL.z1 - 0.05, Math.PI);
    sign('LEVEL 5 ACCESS →', HALL.x1 - 0.05, H4 + 5.6, -30, -Math.PI / 2);
    // Vats on wall shelves, here and there, out over the drop
    for (const [x, z] of [[-57, 12], [-57, 40], [57, 30], [20, -67], [-20, 67]] as const) {
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
