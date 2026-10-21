import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BakedCar, CarKind, CarRig, CarSpec, CivicRig } from '../scenes/Level8Contracts';

/**
 * VehicleProps — the cars of Level 8: the parked rows, the General's scrap
 * pile, the boss's black saloon and Ravi's battered old hatchback.
 *
 * Every car shares one frame (see Level8Contracts): origin on the ground at
 * the middle of the footprint, +Y up, the FRONT toward −Z and the driver's
 * (left) side toward −X. Inside this file the modelling is done in a side
 * view, (u, y), where u runs FORWARD (u = −z): a car is drawn the way you
 * would sketch one, nose to the right, and the sketch is extruded across its
 * width. So a profile point (u, y) lands at z = −u.
 *
 * Why profiles and not boxes: Level 7's window view got away with two boxes a
 * car, but here the player is crouched behind them. A box does not read as a
 * car at four metres; a bonnet that falls away, a raked windscreen, a roof,
 * a boot, arches with tyres in them do. Each body is a side profile extruded
 * across the car with a deep, elliptical bevel (13 cm across, 6.5 cm in the
 * profile), which rolls the shoulders, tucks the sills and rounds the
 * corners in plan in one go. The greenhouse sits on top, narrower and leaning
 * in (tumblehome), built as a hollow shell — roof, side frames with the
 * window holes cut through, pillars — with the glass set into it, so the
 * hand-animated cars can be seen into.
 *
 * Nothing here is a light. Lamps are lamps: a vertex-coloured unlit material
 * on the parked cars (it reads as lit in daylight), and on the two rigs
 * emissive materials whose intensity the scene drives (lights must exist from
 * the first frame or every lit material recompiles mid-level).
 *
 * There is no environment map in this game, so a metal reflects nothing and
 * high metalness renders black: paint stays at metalness ≤ 0.25 and the
 * "chrome" is a pale grey that reads as bright trim against the panels.
 */

// --------------------------------------------------------------- the models

export type P = [number, number];

/** One body style, in the side-view frame (u forward, y up), metres. */
export interface Model {
  L: number;
  W: number;
  H: number;
  /** Tyre radius: also the axle height. */
  R: number;
  /** How much bigger the arch is than the tyre. */
  arch: number;
  tyreW: number;
  rimR: number;
  /** Wheel centre |x|. */
  track: number;
  /** Front and rear axle, u. */
  uF: number;
  uR: number;
  /** Sill bottom. */
  clear: number;
  /** The beltline: top of the lower body along the doors, where the glass starts. */
  belt: number;
  /** Bonnet's front edge, and the front bumper's bottom. */
  noseY: number;
  noseLow: number;
  /** Top of the tail (boot lid, tailgate), and the rear bumper's bottom. */
  tailY: number;
  tailLow: number;
  bumperH: number;
  /** The windscreen's foot. */
  cowlU: number;
  /** The roof's front and rear ends, and how much lower the rear sits. */
  roofFU: number;
  roofRU: number;
  roofDrop: number;
  /** Where the rear glass meets the body. */
  rearU: number;
  rearY: number;
  /** Greenhouse taper at the roof, as a fraction of its half-width at the belt. */
  tumble: number;
  /** Side shut lines, u, front to back: [front door front, (B,) last door's rear]. */
  doors: number[];
  /** The driver's door, the one the rigs open. */
  doorFront: number;
  doorRear: number;
  /** The B-pillar (blacked out), u at the belt. */
  bPillar: number;
  /** The side glass's rear edge: u at the top, u at the belt. */
  dloRear: [number, number];
  /** Rigs: where the fixed side panels behind the driver's door end (just clear of the rear arch). */
  skinRear?: number;
  /** The body's tail when it is not the car's (the pickup: the cab back). */
  tailU?: number;
  bed?: { front: number; rear: number; floor: number };
  bumper: 'paint' | 'black' | 'chrome';
  grille: 'slot' | 'tall' | 'exec';
  /** Black plastic mirror shells instead of painted ones. */
  blackMirrors?: boolean;
  roofRails?: boolean;
}

export const MODELS: Record<CarKind | 'exec', Model> = {
  sedan: {
    L: 4.65, W: 1.82, H: 1.45, R: 0.32, arch: 0.03, tyreW: 0.21, rimR: 0.205, track: 0.78,
    uF: 1.37, uR: -1.35, clear: 0.17, belt: 0.93, noseY: 0.74, noseLow: 0.2, tailY: 0.99, tailLow: 0.24,
    bumperH: 0.25, cowlU: 0.48, roofFU: -0.3, roofRU: -1.12, roofDrop: 0.03, rearU: -1.68, rearY: 0.99,
    tumble: 0.13, doors: [0.72, -0.38, -1.12], doorFront: 0.72, doorRear: -0.38, bPillar: -0.38,
    dloRear: [-0.98, -1.25], bumper: 'paint', grille: 'slot'
  },
  hatch: {
    L: 4.15, W: 1.76, H: 1.48, R: 0.3, arch: 0.03, tyreW: 0.185, rimR: 0.18, track: 0.75,
    uF: 1.2, uR: -1.37, clear: 0.16, belt: 0.92, noseY: 0.72, noseLow: 0.2, tailY: 0.94, tailLow: 0.24,
    bumperH: 0.25, cowlU: 0.56, roofFU: -0.28, roofRU: -1.62, roofDrop: 0.04, rearU: -1.97, rearY: 0.94,
    tumble: 0.13, doors: [0.68, -0.52], doorFront: 0.68, doorRear: -0.52, bPillar: -0.52,
    dloRear: [-1.42, -1.6], skinRear: -0.96, bumper: 'paint', grille: 'slot'
  },
  suv: {
    L: 4.75, W: 1.92, H: 1.78, R: 0.37, arch: 0.035, tyreW: 0.235, rimR: 0.23, track: 0.82,
    uF: 1.43, uR: -1.37, clear: 0.26, belt: 1.03, noseY: 0.93, noseLow: 0.3, tailY: 1.04, tailLow: 0.33,
    bumperH: 0.3, cowlU: 0.78, roofFU: -0.05, roofRU: -2.12, roofDrop: 0.02, rearU: -2.26, rearY: 1.05,
    tumble: 0.1, doors: [0.86, -0.28, -1.25], doorFront: 0.86, doorRear: -0.28, bPillar: -0.28,
    dloRear: [-1.95, -2.06], bumper: 'black', grille: 'tall', blackMirrors: true, roofRails: true
  },
  pickup: {
    // 1.95 wide rather than a real full-size 1.96: the lot's 2.8 m bays promise
    // a gap of at least 0.85 m between parked cars, wide enough to squeeze through
    L: 5.35, W: 1.95, H: 1.85, R: 0.39, arch: 0.04, tyreW: 0.245, rimR: 0.23, track: 0.83,
    uF: 1.72, uR: -1.48, clear: 0.3, belt: 1.06, noseY: 1.0, noseLow: 0.36, tailY: 1.06, tailLow: 0.4,
    bumperH: 0.26, cowlU: 1.0, roofFU: 0.32, roofRU: -0.84, roofDrop: 0, rearU: -0.88, rearY: 1.08,
    tumble: 0.09, doors: [1.08, -0.1, -0.78], doorFront: 1.08, doorRear: -0.1, bPillar: -0.1,
    dloRear: [-0.7, -0.72], tailU: -0.9, bed: { front: -0.9, rear: -2.605, floor: 0.62 },
    bumper: 'chrome', grille: 'tall', blackMirrors: true
  },
  // The boss's car: a long-wheelbase executive saloon, longer and lower than anything parked
  exec: {
    L: 5.15, W: 1.9, H: 1.48, R: 0.34, arch: 0.03, tyreW: 0.245, rimR: 0.23, track: 0.81,
    uF: 1.6, uR: -1.55, clear: 0.17, belt: 0.95, noseY: 0.78, noseLow: 0.22, tailY: 1.02, tailLow: 0.26,
    bumperH: 0.26, cowlU: 0.62, roofFU: -0.28, roofRU: -1.3, roofDrop: 0.03, rearU: -1.9, rearY: 1.02,
    tumble: 0.12, doors: [0.88, -0.32, -1.32], doorFront: 0.88, doorRear: -0.32, bPillar: -0.32,
    dloRear: [-1.18, -1.45], skinRear: -1.08, bumper: 'paint', grille: 'exec'
  }
};

const MASS: Record<CarKind, number> = { sedan: 1300, hatch: 1150, suv: 1800, pickup: 2000 };

/** The roof's top line, for u along it (front t = 1, rear t = 0): a slight crown, a little lower at the back. */
export function roofTop(m: Model, u: number): number {
  const t = (u - m.roofRU) / (m.roofFU - m.roofRU);
  return m.H - 0.035 * (2 * t - 1) ** 2 - m.roofDrop * (1 - t);
}

function specOf(m: Model, mass: number): CarSpec {
  const hw = m.W / 2;
  // The cabin box runs from halfway up the windscreen to halfway down the
  // rear glass — what the eye takes as the car's cabin, and what a round
  // should stop on — at the greenhouse's width part way up its taper.
  const front = (m.cowlU + m.roofFU) / 2;
  const rear = (m.roofRU + m.rearU) / 2;
  const cabHW = (hw - 0.115) * (1 - m.tumble * 0.4);
  return {
    length: m.L,
    width: m.W,
    height: m.H,
    mass,
    boxes: [
      // Down to the ground, wheels and all: the car rests on this box
      { c: [0, m.belt / 2, 0], h: [hw, m.belt / 2, m.L / 2] },
      { c: [0, (m.belt + m.H) / 2, -(front + rear) / 2], h: [cabHW, (m.H - m.belt) / 2, (front - rear) / 2] }
    ],
    wheelRadius: m.R
  };
}

export const CAR_SPECS: Record<CarKind, CarSpec> = {
  sedan: specOf(MODELS.sedan, MASS.sedan),
  hatch: specOf(MODELS.hatch, MASS.hatch),
  suv: specOf(MODELS.suv, MASS.suv),
  pickup: specOf(MODELS.pickup, MASS.pickup)
};

/** Paint for the parked rows: what a real car park is — mostly silver, black, white and grey, a few colours. */
export const CAR_COLOURS: number[] = [
  0xb9bdc1, 0x1c1d20, 0xe8e8e4, 0x5d6268, 0x9a9da2, 0x7a1c1c, 0x1d3a6a, 0x2c3a48,
  0xe2e2de, 0x16171a, 0x4a5a3a, 0xc8b28a, 0xa8241e, 0x23402f, 0x8c9094, 0x3b2f2a
];

/** The scrap pile's paint: sun-faded, oxidised, primer and rust. */
export const WRECK_COLOURS: number[] = [
  0x7d5a40, 0x6c7166, 0x958a74, 0x5a4636, 0x8a3f2c, 0x667380, 0x8b8e8f, 0x4f5a45, 0x9c7a4a, 0x6e6a64
];

// ---------------------------------------------------------------- colours

/** Trim and lamp vertex colours (sRGB hex; THREE.Color takes them to linear). */
export const C = {
  tyre: 0x151515,
  rim: 0x8a8f96,
  rimDark: 0x2f3236,
  black: 0x1b1c1e,
  chrome: 0xb8bcc2,
  plate: 0xe2e0d6,
  hole: 0x0b0c0e,
  mirror: 0x3a3f45,
  lensClear: 0xd6d8d3,
  carpet: 0x19191b,
  dash: 0x161718,
  cloth: 0x2e2f32,
  leather: 0x3d2219,
  head: 0xfff2d0,
  tail: 0xa01010,
  ind: 0xff9a20,
  steel: 0x9a9ea2,
  steelBlack: 0x262829,
  lug: 0x3a3c3e,
  drum: 0x4a3426,
  crazed: 0x8a9096,
  crack: 0x0e0f10,
  tape: 0x8e9092,
  rust: [0x6b3a1e, 0x82441f, 0x4f2a17, 0x5e3219]
};

// --------------------------------------------------------- geometry helpers

export const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

function dedupe(poly: P[]): P[] {
  const out: P[] = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) out.push(p);
  }
  while (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-4) out.pop();
  return out;
}

function area(poly: P[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * The outline moved in by d (out, for d < 0), mitred at the corners.
 * ExtrudeGeometry's bevel grows a shape outward by its bevel size, so a
 * profile is drawn at its finished size and inset first: the bevel then
 * brings it back out to exactly where it was drawn.
 */
function inset(poly: P[], d: number): P[] {
  if (d === 0) return poly;
  const n = poly.length;
  const s = area(poly) > 0 ? 1 : -1;
  const out = (a: P, b: P): P => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [(s * dy) / l, (-s * dx) / l];
  };
  return poly.map((p, i) => {
    const e1 = out(poly[(i + n - 1) % n], p);
    const e2 = out(p, poly[(i + 1) % n]);
    let mx = e1[0] + e2[0];
    let my = e1[1] + e2[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const k = d / Math.max(0.35, mx * e1[0] + my * e1[1]);
    return [p[0] - mx * k, p[1] - my * k] as P;
  });
}

/** ExtrudeGeometry only fixes up the holes' winding when it has to flip the outline, so set both. */
function wound(poly: P[], clockwise: boolean): P[] {
  return area(poly) < 0 === clockwise ? poly : [...poly].reverse();
}

const vec2 = (poly: P[]): THREE.Vector2[] => poly.map(([a, b]) => new THREE.Vector2(a, b));

/**
 * A side-view profile (u, y) extruded across the car from x0 to x1, with a
 * bevel of bt across the car and bs in the profile. `steps` cuts the run
 * between the bevels into that many equal strips across the car (the
 * Civic's roof, so its sunroof can be cut out along strip lines).
 */
export function side(poly: P[], x0: number, x1: number, bt = 0, bs = 0, seg = 2, holes: P[][] = [], steps = 1): THREE.BufferGeometry {
  const bevel = bt > 0 && bs > 0;
  const shape = new THREE.Shape(vec2(wound(inset(dedupe(poly), bevel ? bs : 0), true)));
  for (const h of holes) shape.holes.push(new THREE.Path(vec2(wound(dedupe(h), false))));
  const tb = bevel ? bt : 0;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: x1 - x0 - 2 * tb,
    bevelEnabled: bevel,
    bevelThickness: tb,
    bevelSize: bevel ? bs : 0,
    bevelSegments: seg,
    steps,
    curveSegments: 1
  });
  // Shape x is u, so it lands on −z; the extrusion runs along x
  g.rotateY(Math.PI / 2);
  g.translate(x0 + tb, 0, 0);
  return g;
}

/** A plan-view shape (x, u) extruded upward from y0 to y1: bumpers and lamps that wrap the corners. */
export function plan(poly: P[], y0: number, y1: number, b = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(vec2(wound(inset(dedupe(poly), b), true)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: y1 - y0 - 2 * b,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 1
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + b, 0);
  return g;
}

/** Smooth across the bevels, keep the creases: the bonnet's edge, the screen's foot. */
export function smooth(g: THREE.BufferGeometry, crease = 0.9): THREE.BufferGeometry {
  return toCreasedNormals(g, crease);
}

/** Newell's normal, so near-collinear first points do not decide the facing. */
function newell(pts: THREE.Vector3[]): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n;
}

/** A flat convex polygon, single-sided, facing `out`. */
export function facet(pts: THREE.Vector3[], out: THREE.Vector3): THREE.BufferGeometry {
  const list = newell(pts).dot(out) < 0 ? [...pts].reverse() : pts;
  const pos: number[] = [];
  for (let i = 1; i < list.length - 1; i++) {
    for (const p of [list[0], list[i], list[i + 1]]) pos.push(p.x, p.y, p.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A thin flat strip from a to b, w wide, facing `out`: shut lines, cracks, pinstripes. */
export function strip(a: THREE.Vector3, b: THREE.Vector3, w: number, out: THREE.Vector3): THREE.BufferGeometry {
  const across = b.clone().sub(a).cross(out).normalize().multiplyScalar(w / 2);
  return facet([a.clone().add(across), b.clone().add(across), b.clone().sub(across), a.clone().sub(across)], out);
}

export function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

/** A cylinder along X (radius r0 at +X, r1 at −X). */
export function cylX(r0: number, len: number, seg: number, x: number, y: number, z: number, r1 = r0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg);
  g.rotateZ(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** A cylinder along Z (radius r0 at +Z). */
export function cylZ(r0: number, len: number, seg: number, x: number, y: number, z: number, r1 = r0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/**
 * Every part leaves here in the one attribute set — position, normal, uv,
 * colour; non-indexed, no groups — because mergeGeometries refuses to merge
 * anything that differs, and the whole point is that a car is four draws.
 */
export function finish(g: THREE.BufferGeometry, colour: number): THREE.BufferGeometry {
  let out = g;
  if (g.index) {
    out = g.toNonIndexed();
    g.dispose();
  }
  for (const k of Object.keys(out.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv') out.deleteAttribute(k);
  }
  const n = out.attributes.position.count;
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const c = new THREE.Color(colour);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.clearGroups();
  return out;
}

// ------------------------------------------------------------- the builder

/** Which material a part takes: on the parked cars paint, trim, glass and lamps; the rigs split lamps by job. */
export type Layer = 'paint' | 'primer' | 'trim' | 'glass' | 'head' | 'tail' | 'ind';
/** Which moving piece of a rig it belongs to. ('sunroof': the Civic's sliding glass panel, in its own frame; 'wheel': the steering wheel, in its own frame — centred on the hub, its face toward the driver along +Z.) */
export type Node = 'body' | 'door' | 'fl' | 'fr' | 'rl' | 'rr' | 'hubcap' | 'sunroof' | 'wheel';
type WheelName = 'fl' | 'fr' | 'rl' | 'rr';
export type WheelStyle = 'alloy' | 'exec' | 'steel' | 'steelBlack' | 'stub';

export interface Part {
  g: THREE.BufferGeometry;
  layer: Layer;
  node: Node;
}

export class Kit {
  readonly parts: Part[] = [];
  node: Node = 'body';
  put(g: THREE.BufferGeometry, layer: Layer, colour = 0xffffff): void {
    this.parts.push({ g: finish(g, colour), layer, node: this.node });
  }
  trim(g: THREE.BufferGeometry, colour: number): void {
    this.put(g, 'trim', colour);
  }
}

export interface Look {
  /** A hand-animated car: an open cabin with seats in it, and the driver's door its own piece. */
  rig?: boolean;
  wreck?: boolean;
  exec?: boolean;
  civic?: boolean;
  wheels: Record<WheelName, WheelStyle>;
}

/** Below the rigs' cabin floor is the sill. */
export const FLOOR = 0.34;
/** The body's bevel: across the car, and in the profile. */
export const BT = 0.13;
export const BS = 0.065;
const DOOR_OPEN = THREE.MathUtils.degToRad(70);

export const halfBody = (m: Model): number => m.W / 2 - 0.015;

/** The lower body's side profile: sills and arches, nose, bonnet, the belt, the boot or tail. */
function lowerOutline(m: Model, notch?: { front: number; rear: number; floor: number }): P[] {
  const Ra = m.R + m.arch;
  const nU = m.L / 2 - 0.07;
  const tU = m.tailU ?? -nU;
  const tailLow = m.bed ? m.clear : m.tailLow;
  const pts: P[] = [];
  // Along the bottom, tail to nose, with the arches cut up into the sill
  pts.push([tU, tailLow + 0.08], [tU + 0.04, tailLow + 0.02], [tU + 0.12, tailLow]);
  for (const ua of [m.uR, m.uF]) {
    if (ua - Ra < tU + 0.15) continue; // the pickup's rear arch is in its bed sides
    const beta = Math.asin(Math.min(0.95, (m.R - m.clear) / Ra));
    const foot = Ra * Math.cos(beta);
    pts.push([ua - foot - 0.12, m.clear]);
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI + beta - (i / 12) * (Math.PI + 2 * beta);
      pts.push([ua + Ra * Math.cos(a), m.R + Ra * Math.sin(a)]);
    }
    pts.push([ua + foot + 0.12, m.clear]);
  }
  pts.push([nU - 0.12, m.noseLow], [nU - 0.04, m.noseLow + 0.02], [nU, m.noseLow + 0.08]);
  // The nose, rounding over onto the bonnet
  pts.push([nU, m.noseY - 0.07], [nU - 0.025, m.noseY - 0.02]);
  // The top, nose to tail (u falling): bonnet up to the cowl, then the belt
  const cowlY = m.belt - 0.01;
  const top: P[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    top.push([lerp(nU - 0.08, m.cowlU, t), bonnetY(m, t)]);
  }
  const tailY = m.bed ? m.belt : m.tailY;
  if (tailY > m.belt + 0.02) {
    // A saloon's boot: the belt runs back to the rear screen, the deck sits a touch higher
    top.push([m.rearU + 0.25, m.belt], [m.rearU, tailY - 0.012]);
  }
  top.push([tU + 0.07, tailY], [tU + 0.02, tailY - 0.03], [tU, tailY - 0.09]);
  pts.push(...(notch ? cut(top, notch.front, notch.rear, notch.floor) : top));
  return pts;
}

/** The bonnet's top at fraction t of the way from its front edge to the cowl: rises quickly, flattens out. */
export function bonnetY(m: Model, t: number): number {
  return m.noseY + (m.belt - 0.01 - m.noseY) * (1 - (1 - t) ** 2);
}

/** Cut the open cabin into the top line (u falling), down to the floor between front and rear. */
function cut(top: P[], front: number, rear: number, floor: number): P[] {
  const yAt = (u: number): number => {
    for (let i = 0; i < top.length - 1; i++) {
      const a = top[i];
      const b = top[i + 1];
      if (u <= a[0] && u >= b[0]) return lerp(a[1], b[1], (a[0] - u) / (a[0] - b[0] || 1));
    }
    return top[top.length - 1][1];
  };
  const out: P[] = top.filter((p) => p[0] > front);
  out.push([front, yAt(front)], [front, floor], [rear, floor], [rear, yAt(rear)]);
  out.push(...top.filter((p) => p[0] < rear));
  return out;
}

/** The arch's arc above the sill, (u, y), rear foot to front foot. */
function archArc(m: Model, ua: number, r: number, n = 10): P[] {
  const beta = Math.asin(Math.min(0.95, (m.R - m.clear) / r));
  const pts: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + beta - (i / n) * (Math.PI + 2 * beta);
    pts.push([ua + r * Math.cos(a), m.R + r * Math.sin(a)]);
  }
  return pts;
}

/** Keep the side of a convex polygon above (or below) u = c. */
function clipU(poly: P[], c: number, above: boolean): P[] {
  const inside = (p: P): boolean => (above ? p[0] >= c : p[0] <= c);
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (c - a[0]) / (b[0] - a[0]);
      out.push([c, lerp(a[1], b[1], t)]);
    }
  }
  return out;
}

/** The front-right corner of a lamp that wraps the body's rounded corner, in plan (x, u), for the face at u = e. */
function cornerWrap(hw: number, e: number, back: number): P[] {
  // The body's corner is an ellipse quarter (the bevel: BT across, BS along);
  // the lamp follows it 12 mm proud
  const cx = hw - BT;
  const cu = e - BS;
  const pts: P[] = [];
  for (let i = 0; i <= 4; i++) {
    const a = (Math.PI / 2) * (1 - i / 4);
    pts.push([cx + (BT + 0.012) * Math.cos(a), cu + (BS + 0.012) * Math.sin(a)]);
  }
  pts.push([hw + 0.012, cu - back], [hw - 0.03, cu - back], [hw - 0.03, cu], [cx, e - 0.03]);
  return pts;
}

/** The bumper in plan (x, u), for the end at u = e: wraps round the corners and back along the sides. */
function bumperPlan(hw: number, e: number): P[] {
  const r = 0.14;
  const pts: P[] = [[-hw, e - 0.42]];
  for (let i = 0; i <= 3; i++) {
    const a = Math.PI - (i / 3) * (Math.PI / 2);
    pts.push([-hw + r + r * Math.cos(a), e - r + r * Math.sin(a)]);
  }
  for (let i = 0; i <= 3; i++) {
    const a = Math.PI / 2 - (i / 3) * (Math.PI / 2);
    pts.push([hw - r + r * Math.cos(a), e - r + r * Math.sin(a)]);
  }
  // The inner edge is buried in the body; 8 cm of side wrap survives the bevel's inset
  pts.push([hw, e - 0.42], [hw - 0.08, e - 0.42], [hw - 0.08, e - 0.17], [hw - 0.2, e - 0.12]);
  pts.push([-hw + 0.2, e - 0.12], [-hw + 0.08, e - 0.17], [-hw + 0.08, e - 0.42]);
  return pts;
}

/** The steering wheel's rim: radius to the middle of its grip. */
export const WHEEL_RIM = 0.185;

/** Where the driver sits, car-local: left of centre, hip half a metre up, behind a raked wheel. */
export function seatOf(m: Model): { hip: THREE.Vector3; wheel: THREE.Vector3; wheelFacing: THREE.Vector3 } {
  const dx = Math.round(halfBody(m) * 0.43 * 100) / 100;
  const wheel = V(-dx, m.belt - 0.06, -(m.cowlU - 0.5));
  return { hip: V(-dx, 0.5, wheel.z + 0.38), wheel, wheelFacing: V(0, 0.42, 0.91).normalize() };
}

/** Cheap deterministic numbers for the dressing (rust, cracks): the same car every time. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * The whole car as parts, car-local; wheel parts in their own frame (centred
 * on the hub, +X out through the face), which the bake or the rig places.
 */
export function buildCar(m: Model, look: Look): Part[] {
  const k = new Kit();
  const hw = halfBody(m);
  const hwB = hw - 0.1; // the greenhouse's half-width where it meets the belt
  const Ra = m.R + m.arch;
  const nU = m.L / 2 - 0.07;
  const tU = m.tailU ?? -nU;
  const rig = !!look.rig;
  const wreck = !!look.wreck;
  const exec = !!look.exec;
  const civic = !!look.civic;

  // Tumblehome: the greenhouse leans in as it rises
  const hwG = (y: number): number => hwB * (1 - m.tumble * clamp01((y - m.belt) / (m.H - m.belt)));
  const taper = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setX(i, (p.getX(i) * hwG(p.getY(i))) / hwB);
    return g;
  };

  // ---- the lower body: one extruded profile, the rigs' with the cabin cut out of it
  const notch = rig && m.skinRear !== undefined ? { front: m.doorFront - 0.07, rear: m.skinRear + 0.07, floor: FLOOR } : undefined;
  k.put(smooth(side(lowerOutline(m, notch), -hw, hw, BT, BS, 2)), 'paint');

  // Arch liners: black wells over the tyres instead of painted tunnels
  for (const ua of [m.uF, m.uR]) {
    const xs = m.bed && ua === m.uR ? hw - 0.07 : hw - 0.03;
    const arc = archArc(m, ua, Ra - 0.008, 10);
    for (let i = 0; i < arc.length - 1; i++) {
      const [u0, y0] = arc[i];
      const [u1, y1] = arc[i + 1];
      const mid = V(0, (y0 + y1) / 2, -(u0 + u1) / 2);
      k.trim(facet([V(-xs, y0, -u0), V(xs, y0, -u0), V(xs, y1, -u1), V(-xs, y1, -u1)], V(0, m.R, -ua).sub(mid)), C.black);
    }
  }

  // ---- the rigs' cabin: side panels over the cut, the driver's door, and something to sit in
  if (rig && notch && m.skinRear !== undefined) {
    const y0 = FLOOR - 0.07;
    const y1 = m.belt;
    // Panels stand 6 mm proud of the body and overlap the cut's rounded edges,
    // so there is no groove round them and nothing coplanar to flicker
    const panel = (u0: number, u1: number, s: number): THREE.BufferGeometry =>
      smooth(
        side(
          [[u0, y0], [u1, y0], [u1, y1 - 0.02], [u1 + 0.02 * Math.sign(u0 - u1), y1], [u0 - 0.02 * Math.sign(u0 - u1), y1], [u0, y1 - 0.02]],
          s > 0 ? hw - 0.054 : -hw - 0.006,
          s > 0 ? hw + 0.006 : -hw + 0.054,
          0.012,
          0.012,
          1
        )
      );
    const card = (u0: number, u1: number, s: number): THREE.BufferGeometry =>
      box(0.02, y1 - y0 - 0.18, Math.abs(u0 - u1) - 0.1, s * (hw - 0.066), (y0 + y1) / 2 + 0.03, -(u0 + u1) / 2);
    const cardCol = exec ? C.leather : C.cloth;
    k.put(panel(m.skinRear, m.doorFront, 1), 'paint');
    k.trim(card(m.skinRear, m.doorFront, 1), cardCol);
    k.put(panel(m.skinRear, m.doorRear - 0.006, -1), 'paint');
    k.trim(card(m.skinRear, m.doorRear - 0.006, -1), cardCol);
    k.node = 'door';
    k.put(panel(m.doorRear, m.doorFront, -1), civic ? 'primer' : 'paint');
    k.trim(card(m.doorRear, m.doorFront, -1), cardCol);
    // Pull and armrest on the inside, so an open door does not show a blank card
    k.trim(box(0.05, 0.05, 0.3, -hw + 0.09, m.belt - 0.28, -(m.doorRear + 0.35)), C.black);
    k.node = 'body';
    interior(k, m, hw, notch, exec);
  }

  // ---- the greenhouse: a hollow shell of roof, side frames and pillars, the glass set into it
  const yA1 = roofTop(m, m.roofFU);
  const yR1 = roofTop(m, m.roofRU);
  const uA = (y: number): number => m.cowlU + ((m.roofFU - m.cowlU) * (y - m.belt)) / (yA1 - m.belt);
  const uRear = (y: number): number => m.rearU + ((m.roofRU - m.rearU) * (y - m.rearY)) / (yR1 - m.rearY);

  // Roof: a thin slab along the roof line, 6 mm wider than the frames under it
  if (civic) {
    civicRoof(k, m, hwB, taper);
  } else {
    const roofLine: P[] = [];
    for (let i = 0; i <= 8; i++) {
      const u = lerp(m.roofFU + 0.03, m.roofRU - 0.03, i / 8);
      roofLine.push([u, roofTop(m, u)]);
    }
    const slab: P[] = [...roofLine, ...[...roofLine].reverse().map(([u, y]) => [u, y - 0.055] as P)];
    k.put(smooth(taper(side(slab, -hwB - 0.006, hwB + 0.006, 0.05, 0.022, 2))), 'paint');
  }

  // Side frames: the greenhouse's side silhouette with the window hole through it
  const frame: P[] = [[uA(m.belt - 0.05), m.belt - 0.05], [uA(yA1 - 0.012), yA1 - 0.012]];
  for (let i = 1; i < 8; i++) {
    const u = lerp(m.roofFU, m.roofRU, i / 8);
    frame.push([u, roofTop(m, u) - 0.012]);
  }
  frame.push([uRear(yR1 - 0.012), yR1 - 0.012], [uRear(m.rearY - 0.03), m.rearY - 0.03]);
  if (m.rearY > m.belt + 0.03) frame.push([m.rearU + 0.3, m.belt - 0.05]);
  const yb = m.belt + 0.04;
  const fTop = yA1 - 0.075;
  const dlo: P[] = [[uA(yb) - 0.13, yb], [uA(fTop) - 0.13, fTop]];
  for (let i = 1; i < 6; i++) {
    const u = lerp(uA(fTop) - 0.13, m.dloRear[0], i / 6);
    dlo.push([u, roofTop(m, u) - 0.075]);
  }
  dlo.push([m.dloRear[0], roofTop(m, m.dloRear[0]) - 0.075], [m.dloRear[1], yb]);
  // The glass is the hole grown 25 mm all round, its edges buried in the frame
  const pane = inset(dlo, -0.025);
  const panes = [clipU(pane, m.bPillar, true), clipU(pane, m.bPillar, false)];

  for (const s of [-1, 1]) {
    k.put(smooth(taper(side(frame, s > 0 ? hwB - 0.045 : -hwB, s > 0 ? hwB : -hwB + 0.045, 0, 0, 1, [dlo]))), 'paint');
    // B-pillar, blacked out, standing just proud of the glass either side of it
    const bp = m.bPillar;
    const ybt = roofTop(m, bp) - 0.03;
    const pillar: P[] = [[bp + 0.05, m.belt - 0.03], [bp - 0.05, m.belt - 0.03], [bp - 0.05, ybt], [bp + 0.05, ybt]];
    k.trim(smooth(taper(side(pillar, s > 0 ? hwB - 0.05 : -hwB - 0.006, s > 0 ? hwB + 0.006 : -hwB + 0.05))), C.black);
    panes.forEach((poly, i) => {
      if (poly.length < 3) return;
      const g = facet(poly.map(([u, y]) => V(s * (hwG(y) - 0.02), y, -u)), V(s, 0, 0));
      const driverFront = s < 0 && i === 0;
      if (rig && driverFront) k.node = 'door';
      if (wreck && driverFront) k.trim(g, C.hole); // smashed out
      else k.put(g, 'glass');
      k.node = 'body';
    });
    if (exec) {
      // Chrome along the foot of the side glass, split at the door's rear edge for the rig
      const yc = m.belt + 0.022;
      const xc = s * (hwG(yc) + 0.004);
      const fwd = uA(yb) - 0.1;
      const runs: [number, number][] = [[m.bPillar, fwd], [m.dloRear[1] - 0.02, m.bPillar]];
      runs.forEach(([u0, u1], i) => {
        if (rig && s < 0 && i === 0) k.node = 'door';
        k.trim(box(0.012, 0.022, u1 - u0, xc, yc, -(u0 + u1) / 2), C.chrome);
        k.node = 'body';
      });
    }
  }

  // Windscreen and rear glass, set just inside the pillars' faces, their feet buried in the body
  const wsB = m.belt - 0.03;
  const wsT = yA1 - 0.03;
  const wsOut = V(0, m.cowlU - m.roofFU, -(yA1 - m.belt));
  const ws = [
    V(-(hwG(wsB) - 0.015), wsB, -(uA(wsB) - 0.015)),
    V(hwG(wsB) - 0.015, wsB, -(uA(wsB) - 0.015)),
    V(hwG(wsT) - 0.015, wsT, -(uA(wsT) - 0.015)),
    V(-(hwG(wsT) - 0.015), wsT, -(uA(wsT) - 0.015))
  ];
  k.put(facet(ws, wsOut), 'glass');
  const onWs = (x: number, t: number, lift = 0.004): THREE.Vector3 => {
    const y = lerp(m.belt + 0.02, wsT, t);
    return V(x, y, -(uA(y) - 0.015)).add(wsOut.clone().normalize().multiplyScalar(lift));
  };
  // Wipers parked along the screen's foot
  for (const x of [-0.62, 0.02]) k.trim(strip(onWs(x, 0.04), onWs(x + 0.52, 0.09), 0.018, wsOut), C.black);

  const rgB = m.rearY - 0.03;
  const rgT = yR1 - 0.03;
  const rgOut = V(0, m.roofRU - m.rearU, -(m.rearY - yR1));
  const rg = [
    V(-(hwG(rgB) - 0.015), rgB, -(uRear(rgB) + 0.015)),
    V(hwG(rgB) - 0.015, rgB, -(uRear(rgB) + 0.015)),
    V(hwG(rgT) - 0.015, rgT, -(uRear(rgT) + 0.015)),
    V(-(hwG(rgT) - 0.015), rgT, -(uRear(rgT) + 0.015))
  ];
  if (wreck) k.trim(facet(rg, rgOut), C.hole);
  else k.put(facet(rg, rgOut), 'glass');
  if (m.rearU < tU + 0.1 && !m.bed) {
    // A hatch's rear wiper
    const y = lerp(rgB, rgT, 0.18);
    const z = -(uRear(y) + 0.015) + 0.01;
    k.trim(box(0.42, 0.016, 0.02, 0.08, y + 0.02, z, 0, 0, 0.35), C.black);
  }

  if (m.roofRails) {
    for (const s of [-1, 1]) {
      const y = m.H - 0.01;
      k.trim(box(0.04, 0.04, m.roofFU - m.roofRU - 0.2, s * (hwG(y) - 0.08), y + 0.01, -(m.roofFU + m.roofRU) / 2), C.black);
    }
  }

  if (wreck) {
    // The windscreen crazed white from a blow in the middle
    const r = rng(41);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r() * 0.5;
      const len = 0.25 + r() * 0.35;
      const c = onWs(0.05, 0.45, 0.004);
      const e = onWs(0.05 + Math.cos(a) * len, 0.45 + Math.sin(a) * len * 1.4, 0.004);
      k.trim(strip(c, e, 0.012, wsOut), C.crazed);
    }
  }

  // ---- bumpers, grille, plates
  const bumpCol = m.bumper === 'paint' ? -1 : m.bumper === 'black' ? C.black : C.chrome;
  const bumper = (front: boolean): void => {
    // A shade short of the spec length, so the plate standing off its face lands on it
    const e = m.L / 2 - 0.014;
    let poly = bumperPlan(m.W / 2, e);
    if (!front) poly = poly.map(([x, u]) => [x, -u] as P);
    const y0 = front ? m.noseLow : m.tailLow;
    const g = smooth(plan(poly, y0, y0 + m.bumperH, 0.025));
    if (bumpCol < 0) k.put(g, 'paint');
    else k.trim(g, bumpCol);
    const f = front ? 1 : -1;
    // A black rubbing strip along its face, chrome on the boss's car
    k.trim(box(m.W - 0.5, 0.035, 0.012, 0, y0 + m.bumperH * 0.62, -f * (e + 0.004)), exec ? C.chrome : C.black);
    if (front) {
      // Lower intake, and the plate
      k.trim(box(m.W * 0.5, 0.07, 0.01, 0, y0 + 0.06, -(e + 0.002)), C.black);
      k.trim(box(0.52, 0.11, 0.012, 0, y0 + m.bumperH * 0.38, -(e + 0.008)), C.plate);
    } else if (m.bed) {
      k.trim(box(0.52, 0.11, 0.012, 0, y0 + m.bumperH * 0.5, e + 0.008), C.plate);
    }
  };
  bumper(true);
  bumper(false);

  // Grille between the headlamps
  const lampX0 = hw * 0.42;
  const gTop = m.noseY - 0.045;
  const gBot = m.noseLow + m.bumperH + 0.015;
  const zF = -(nU + 0.006);
  if (m.grille === 'slot') {
    k.trim(box(lampX0 * 2 - 0.06, 0.08, 0.024, 0, gTop - 0.06, zF), C.black);
    k.trim(box(lampX0 * 2 - 0.2, gTop - 0.1 - gBot, 0.02, 0, (gTop - 0.1 + gBot) / 2, zF + 0.002), C.black);
  } else if (m.grille === 'tall') {
    k.trim(box(lampX0 * 2 + 0.04, gTop - gBot, 0.024, 0, (gTop + gBot) / 2, zF), C.black);
    for (let i = 1; i <= 3; i++) {
      k.trim(box(lampX0 * 2, 0.025, 0.03, 0, lerp(gBot, gTop, i / 4), zF - 0.006), m.bumper === 'chrome' ? C.chrome : C.rimDark);
    }
  } else {
    // The executive's: a tall chrome-framed grille with chrome slats
    const gw = 0.62;
    const gh = gTop - gBot + 0.04;
    const gy = (gTop + gBot) / 2;
    k.trim(box(gw + 0.06, gh + 0.05, 0.03, 0, gy, zF), C.chrome);
    k.trim(box(gw, gh, 0.03, 0, gy, zF - 0.004), C.hole);
    for (let i = 0; i < 9; i++) k.trim(box(0.018, gh - 0.02, 0.03, lerp(-gw / 2 + 0.04, gw / 2 - 0.04, i / 8), gy, zF - 0.008), C.chrome);
  }

  // ---- lamps: headlamps across the nose, the indicator wrapping the corner; tail clusters at the back
  const headY0 = m.noseY - (m.grille === 'slot' ? 0.16 : 0.2);
  const headY1 = m.noseY - 0.035;
  for (const s of [-1, 1]) {
    const wrapPts = cornerWrap(hw, nU, 0.16).map(([x, u]) => [x * s, u] as P);
    k.put(plan(wrapPts, headY0, headY1), 'ind', C.ind);
    const lampW = hw - BT - lampX0;
    const lamp = box(lampW, headY1 - headY0, 0.042, s * (lampX0 + lampW / 2), (headY0 + headY1) / 2, -(nU - 0.009));
    if (wreck && s < 0) k.trim(lamp, C.hole);
    else k.put(lamp, 'head', C.head);
    // Side repeater on the wing
    k.put(box(0.012, 0.025, 0.06, s * (hw + 0.004), m.belt - 0.17, -(m.uF - Ra - 0.16)), 'ind', C.ind);
  }
  if (m.bed) {
    // Pickup: tall lamps on the back of the bed sides
    for (const s of [-1, 1]) {
      const z = -m.bed.rear + 0.012;
      k.put(box(0.12, 0.3, 0.025, s * (hw - 0.065), 0.84, z), 'tail', C.tail);
      k.put(box(0.12, 0.07, 0.025, s * (hw - 0.065), 0.65, z), 'ind', C.ind);
      k.trim(box(0.12, 0.05, 0.025, s * (hw - 0.065), 0.58, z), C.lensClear);
    }
  } else {
    const tailTop = m.tailY - 0.05;
    const tailBot = m.tailY - (m.tailY > m.belt + 0.02 ? 0.2 : 0.3);
    const e = -tU;
    const inner = hw * 0.5;
    for (const s of [-1, 1]) {
      const wrapPts = cornerWrap(hw, e, 0.12).map(([x, u]) => [x * s, -u] as P);
      k.put(plan(wrapPts, tailBot, tailTop), 'tail', C.tail);
      const lw = hw - BT - inner;
      k.put(box(lw, tailTop - tailBot, 0.042, s * (inner + lw / 2), (tailTop + tailBot) / 2, e - 0.009), 'tail', C.tail);
      k.put(box(0.1, (tailTop - tailBot) * 0.45, 0.042, s * (inner - 0.05), tailTop - (tailTop - tailBot) * 0.25, e - 0.007), 'ind', C.ind);
      k.trim(box(0.1, (tailTop - tailBot) * 0.45, 0.042, s * (inner - 0.05), tailBot + (tailTop - tailBot) * 0.25, e - 0.007), C.lensClear);
    }
    // Rear plate between them
    k.trim(box(0.52, 0.11, 0.012, 0, Math.max(tailBot - 0.1, m.tailLow + m.bumperH + 0.08), e + 0.006), C.plate);
    if (civic) {
      // Duct tape holding the left tail lamp together
      const x = -(inner + lw0(hw, inner) / 2);
      const y = (tailTop + tailBot) / 2;
      k.trim(box(0.26, 0.05, 0.006, x, y + 0.04, e + 0.016, 0, 0, 0.22), C.tape);
      k.trim(box(0.24, 0.05, 0.006, x + 0.02, y - 0.05, e + 0.017, 0, 0, -0.3), C.tape);
    }
  }

  // ---- mirrors, door handles, shut lines
  for (const s of [-1, 1]) {
    const mu = m.cowlU - 0.08;
    const my = m.belt + 0.07;
    const shell = box(0.1, 0.11, 0.17, s * (hw + 0.075), my, -mu);
    if (m.blackMirrors) k.trim(shell, C.black);
    else k.put(shell, 'paint');
    k.trim(box(0.1, 0.03, 0.05, s * (hw + 0.01), my - 0.03, -mu + 0.03), C.black);
    k.trim(box(0.085, 0.09, 0.006, s * (hw + 0.08), my, -mu + 0.088), C.mirror);
  }
  const footAt = (u: number): number => {
    for (const ua of [m.uF, m.uR]) {
      const d = u - ua;
      const r = Ra + BS;
      if (Math.abs(d) < r) return m.R + Math.sqrt(r * r - d * d) + 0.02;
    }
    return m.clear + BS + 0.02;
  };
  const lineX = rig ? hw + 0.009 : hw + 0.002;
  for (const s of [-1, 1]) {
    for (const u of m.doors) {
      // The rig's driver's door is a real panel with real seams; lines on the
      // body there would be left hanging in the air when it opens
      if (rig && s < 0 && (u === m.doorFront || u === m.doorRear)) continue;
      k.trim(strip(V(s * lineX, footAt(u), -u), V(s * lineX, m.belt - BS - 0.015, -u), 0.009, V(s, 0, 0)), C.hole);
    }
    for (let i = 0; i < m.doors.length - 1; i++) {
      const u = m.doors[i + 1] + 0.14;
      if (rig && s < 0 && i === 0) k.node = 'door';
      k.trim(box(0.022, 0.026, 0.15, s * (lineX + 0.008), m.belt - BS - 0.06, -u), exec ? C.chrome : C.black);
      k.node = 'body';
    }
  }
  // Bonnet: across in front of the screen, and back along the wings
  {
    const uBack = m.cowlU + 0.06;
    const tBack = (nU - 0.08 - uBack) / (nU - 0.08 - m.cowlU);
    const yBack = bonnetY(m, tBack) + 0.003;
    const xs = hw - 0.15;
    k.trim(strip(V(-xs, yBack, -uBack), V(xs, yBack, -uBack), 0.009, V(0, 1, 0)), C.hole);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const t0 = lerp(tBack, 0.05, i / 5);
        const t1 = lerp(tBack, 0.05, (i + 1) / 5);
        const u0 = lerp(nU - 0.08, m.cowlU, t0);
        const u1 = lerp(nU - 0.08, m.cowlU, t1);
        k.trim(strip(V(s * xs, bonnetY(m, t0) + 0.003, -u0), V(s * xs, bonnetY(m, t1) + 0.003, -u1), 0.009, V(0, 1, 0)), C.hole);
      }
    }
  }
  if (m.tailY > m.belt + 0.02) {
    // Boot lid
    const u0 = m.rearU - 0.05;
    const y = m.tailY + 0.002;
    const xs = hw - 0.15;
    k.trim(strip(V(-xs, y, -u0), V(xs, y, -u0), 0.009, V(0, 1, 0)), C.hole);
    for (const s of [-1, 1]) k.trim(strip(V(s * xs, y, -u0), V(s * xs, y, -(tU + 0.06)), 0.009, V(0, 1, 0)), C.hole);
  }

  // ---- exhaust
  if (exec) {
    for (const s of [-1, 1]) {
      k.trim(cylZ(0.04, 0.3, 10, s * 0.55, m.tailLow - 0.02, m.L / 2 - 0.16), C.chrome);
      k.trim(cylZ(0.03, 0.02, 10, s * 0.55, m.tailLow - 0.02, m.L / 2 - 0.0), C.hole);
    }
  } else if (civic) {
    // The cheap big-bore can every boy racer bolts on
    k.trim(cylZ(0.03, 0.4, 8, 0.48, m.tailLow - 0.03, m.L / 2 - 0.2), C.black);
    k.trim(cylZ(0.06, 0.16, 12, 0.48, m.tailLow - 0.03, m.L / 2 - 0.04), C.chrome);
    k.trim(cylZ(0.048, 0.02, 12, 0.48, m.tailLow - 0.03, m.L / 2 + 0.035), C.hole);
  } else {
    k.trim(cylZ(0.032, 0.3, 8, 0.5, m.tailLow - 0.03, m.L / 2 - 0.165), C.rimDark);
  }

  // ---- the pickup's bed
  if (m.bed) {
    const b = m.bed;
    for (const s of [-1, 1]) {
      // Bed sides: the rear quarters, with the rear arches cut into them
      const prof: P[] = [[b.front, m.clear], ...archArc(m, m.uR, Ra, 12).map(([u, y]) => [u, y] as P).reverse()];
      prof.splice(1, 0, [m.uR + Ra * Math.cos(Math.asin(Math.min(0.95, (m.R - m.clear) / Ra))) + 0.1, m.clear]);
      prof.push([m.uR - Ra - 0.1, m.clear + 0.02], [b.rear + 0.06, m.tailLow], [b.rear, m.tailLow + 0.06], [b.rear, m.belt - 0.03], [b.rear + 0.03, m.belt], [b.front, m.belt]);
      k.put(smooth(side(prof, s > 0 ? hw - 0.06 : -hw, s > 0 ? hw : -hw + 0.06, 0.02, 0.02, 2)), 'paint');
      k.trim(box(0.075, 0.016, b.front - b.rear, s * (hw - 0.03), m.belt + 0.008, -(b.front + b.rear) / 2), C.black);
      // Wheel humps inside
      k.trim(box(0.24, 0.24, 2 * Ra + 0.1, s * (hw - 0.06 - 0.12), b.floor + 0.12, -m.uR), C.black);
    }
    const iw = 2 * (hw - 0.06);
    k.put(box(iw, m.belt - 0.03 - 0.42, 0.06, 0, (m.belt - 0.03 + 0.42) / 2, -(b.rear + 0.03)), 'paint'); // tailgate
    k.trim(box(0.3, 0.05, 0.02, 0, m.belt - 0.12, -b.rear + 0.012), C.black);
    k.trim(box(iw, 0.06, b.front - b.rear - 0.06, 0, b.floor - 0.03, -(b.front + b.rear + 0.06) / 2), C.black);
    k.trim(box(1.1, b.floor - 0.06 - m.clear, b.front - b.rear - 0.3, 0, (b.floor - 0.06 + m.clear) / 2, -(b.front + b.rear) / 2), C.black);
  }

  // ---- the beat-up hatchback's history
  if (civic) civicWear(k, m, hw, onWs, wsOut, tU);
  if (wreck) rustOn(k, m, hw, 77, 22, rig);

  // ---- wheels
  for (const name of ['fl', 'fr', 'rl', 'rr'] as WheelName[]) {
    k.node = name;
    wheel(k, m, look.wheels[name]);
  }
  k.node = 'body';
  return k.parts;
}

/**
 * The Civic's sunroof, the aftermarket kind a car this age would have had
 * fitted: an opening cut through the front half of the roof (side-view u
 * from `front` to `rear`, about 0.76 across × 0.55 along), a black rubber
 * seal round its edge, two low runners back along the roof behind it, and
 * a tinted panel in a black frame that lifts `lift` off its seat and slides
 * `slide` back along the runners.
 */
export const SUNROOF = {
  front: -0.385,
  rear: -0.935,
  slide: 0.62,
  lift: 0.032,
  /** The panel's half-width across the car and half-length, and how far its underside stands off the roof when shut. */
  panelHW: 0.43,
  panelHL: 0.305,
  stand: 0.004,
  /** The runners' |x| (and the panel's feet that ride them). */
  runnerX: 0.355
};

/** The roof slab is extruded in this many equal strips across the car; the opening is the middle three. */
const ROOF_STEPS = 5;

/** Keep the triangles of a (non-indexed) geometry whose centroids pass `keep`. */
function keepTriangles(g: THREE.BufferGeometry, keep: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.attributes.position as THREE.BufferAttribute;
  const names = Object.keys(src.attributes);
  const out: Record<string, number[]> = {};
  for (const n of names) out[n] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
    const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    if (!keep(cx, cy, cz)) continue;
    for (const n of names) {
      const a = src.attributes[n] as THREE.BufferAttribute;
      for (let v = t; v < t + 3; v++) for (let c = 0; c < a.itemSize; c++) out[n].push(a.array[v * a.itemSize + c]);
    }
  }
  const res = new THREE.BufferGeometry();
  for (const n of names) res.setAttribute(n, new THREE.Float32BufferAttribute(out[n], (src.attributes[n] as THREE.BufferAttribute).itemSize));
  if (src !== g) src.dispose();
  g.dispose();
  return res;
}

/**
 * The Civic's roof: the same slab every car's roof is, extruded in five
 * equal strips across the car so the opening's sides fall on strip lines,
 * with the middle three strips' top and underside taken out between the
 * opening's front and rear and the cut lined in black rubber — a real hole
 * Ravi can come up through. Then the seal round its lip, the runners, and
 * the sliding panel (its own node, in its own frame: origin at the middle
 * of its underside, front toward −Z).
 */
function civicRoof(k: Kit, m: Model, hwB: number, taper: (g: THREE.BufferGeometry) => THREE.BufferGeometry): void {
  const S = SUNROOF;
  const x0 = -hwB - 0.006;
  const x1 = hwB + 0.006;
  const tb = 0.05;
  // The opening's half-width before the tumblehome takes it in: the edge of the outermost strip
  const hx = x1 - tb - (x1 - x0 - 2 * tb) / ROOF_STEPS;
  const fu = m.roofFU + 0.03;
  const ru = m.roofRU - 0.03;
  const us: number[] = [];
  for (let i = 0; i < 2; i++) us.push(lerp(fu, S.front, i / 2));
  for (let i = 0; i < 4; i++) us.push(lerp(S.front, S.rear, i / 4));
  for (let i = 0; i <= 4; i++) us.push(lerp(S.rear, ru, i / 4));
  const roofLine: P[] = us.map((u) => [u, roofTop(m, u)] as P);
  const slab: P[] = [...roofLine, ...[...roofLine].reverse().map(([u, y]) => [u, y - 0.055] as P)];
  const cut = keepTriangles(side(slab, x0, x1, tb, 0.022, 2, [], ROOF_STEPS), (x, _y, z) => !(Math.abs(x) < hx && -z < S.front && -z > S.rear));
  k.put(smooth(taper(cut)), 'paint');

  // The cut's four faces, in black rubber, facing into the opening
  const inner: THREE.BufferGeometry[] = [];
  const yt = (u: number): number => roofTop(m, u) - 0.001;
  const yb = (u: number): number => roofTop(m, u) - 0.054;
  for (const [u, face] of [[S.front, 1], [S.rear, -1]] as const) {
    inner.push(facet([V(-hx, yt(u), -u), V(hx, yt(u), -u), V(hx, yb(u), -u), V(-hx, yb(u), -u)], V(0, 0, face)));
  }
  const along = us.filter((u) => u <= S.front + 1e-6 && u >= S.rear - 1e-6);
  for (const s of [-1, 1]) {
    for (let i = 0; i < along.length - 1; i++) {
      const a = along[i];
      const b = along[i + 1];
      inner.push(facet([V(s * hx, yt(a), -a), V(s * hx, yt(b), -b), V(s * hx, yb(b), -b), V(s * hx, yb(a), -a)], V(-s, 0, 0)));
    }
  }
  // The seal over the lip, 2.2 cm wide, just proud of the paint
  const lip = (u: number): number => roofTop(m, u) + 0.0025;
  for (const u of [S.front, S.rear]) inner.push(strip(V(-hx - 0.011, lip(u), -u), V(hx + 0.011, lip(u), -u), 0.022, V(0, 1, 0)));
  for (const s of [-1, 1]) {
    for (let i = 0; i < along.length - 1; i++) {
      const a = along[i];
      const b = along[i + 1];
      inner.push(strip(V(s * hx, lip(a), -a), V(s * hx, lip(b), -b), 0.022, V(0, 1, 0)));
    }
  }
  for (const g of inner) k.trim(taper(g), C.black);

  // The runners, back along the roof behind the opening (already at their tapered width)
  const r0 = S.rear - 0.02;
  const r1 = (S.front + S.rear) / 2 - S.slide - S.panelHL + 0.01;
  const nr = 4;
  for (const s of [-1, 1]) {
    for (let i = 0; i < nr; i++) {
      const a = lerp(r0, r1, i / nr);
      const b = lerp(r0, r1, (i + 1) / nr);
      const ua = (a + b) / 2;
      const len = Math.hypot(a - b, roofTop(m, a) - roofTop(m, b));
      k.trim(box(0.014, 0.012, len + 0.004, s * S.runnerX, roofTop(m, ua) + 0.004, -ua, Math.atan2(roofTop(m, a) - roofTop(m, b), a - b)), C.black);
    }
  }

  // The panel: smoked glass in a black frame, with a foot under each corner of it for the runners
  k.node = 'sunroof';
  const hw = S.panelHW;
  const hl = S.panelHL;
  const fw = 0.04;
  k.put(facet([V(-hw + fw, 0.009, -hl + fw), V(hw - fw, 0.009, -hl + fw), V(hw - fw, 0.009, hl - fw), V(-hw + fw, 0.009, hl - fw)], V(0, 1, 0)), 'glass');
  for (const sz of [-1, 1]) k.trim(box(2 * hw, 0.014, fw, 0, 0.007, sz * (hl - fw / 2)), C.black);
  for (const sx of [-1, 1]) k.trim(box(fw, 0.014, 2 * hl - 2 * fw, sx * (hw - fw / 2), 0.007, 0), C.black);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.trim(box(0.014, S.lift - 0.008, 0.06, sx * S.runnerX, -(S.lift - 0.008) / 2, sz * (hl - 0.09)), C.black);
  k.node = 'body';
}

/** Width of the tail lamp's inboard block (for placing the tape over it). */
function lw0(hw: number, inner: number): number {
  return hw - BT - inner;
}

/** Rust patches along the sills and round the arches, deterministic. */
function rustOn(k: Kit, m: Model, hw: number, seed: number, count: number, rig: boolean): void {
  const r = rng(seed);
  const Ra = m.R + m.arch;
  for (let i = 0; i < count; i++) {
    const s = r() < 0.5 ? -1 : 1;
    const col = C.rust[Math.floor(r() * C.rust.length)];
    const x = s * (hw + (rig ? 0.012 : 0.004));
    if (r() < 0.55) {
      // Along the sill, between the arches
      const u = lerp(m.uR + Ra + 0.1, m.uF - Ra - 0.1, r());
      if (rig && s < 0 && u < m.doorFront && u > m.doorRear) {
        // The driver's door rots along its own bottom edge
        k.node = 'door';
        k.trim(box(0.006, 0.04 + r() * 0.05, 0.12 + r() * 0.3, x, FLOOR - 0.04 + r() * 0.04, -u), col);
        k.node = 'body';
        continue;
      }
      k.trim(box(0.006, 0.04 + r() * 0.05, 0.12 + r() * 0.35, x, m.clear + BS + 0.03 + r() * 0.03, -u), col);
    } else {
      // Round an arch lip
      const ua = r() < 0.6 ? m.uR : m.uF;
      const a = 0.35 + r() * 2.4;
      const rr = Ra + BS + 0.03;
      const u = ua + Math.cos(a) * rr;
      if (rig && s < 0 && u < m.doorFront + 0.05 && u > m.doorRear - 0.05) continue;
      k.trim(box(0.006, 0.05 + r() * 0.04, 0.1 + r() * 0.12, x, m.R + Math.sin(a) * rr, -u, a - Math.PI / 2, 0, 0), col);
    }
  }
}

/**
 * Ravi's car: a faded hatchback older than he is. Rust in the sills and
 * arches, a dent in the rear quarter, a cracked screen, a wing off a catalogue
 * and a tail lamp held in with tape. The primer door and the odd wheels are
 * handled where the door and wheels are built.
 */
function civicWear(
  k: Kit,
  m: Model,
  hw: number,
  onWs: (x: number, t: number, lift?: number) => THREE.Vector3,
  wsOut: THREE.Vector3,
  tU: number
): void {
  rustOn(k, m, hw, 19, 16, true);

  // The dent: a patch of panel just proud of the left rear quarter, whose
  // normals are those of a real 5 cm dent — the light falls into it, though
  // the surface hardly moves
  {
    const pw = 0.5;
    const ph = 0.26;
    const bump = (x: number, y: number): number => Math.exp(-((x / (pw * 0.32)) ** 2) - (y / (ph * 0.36)) ** 2);
    const shape = (depth: number): THREE.BufferGeometry => {
      const g = new THREE.PlaneGeometry(pw, ph, 10, 6);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setZ(i, -depth * bump(p.getX(i), p.getY(i)));
      g.computeVertexNormals();
      return g;
    };
    const lit = shape(0.05);
    const g = shape(0.004);
    g.setAttribute('normal', lit.attributes.normal.clone());
    lit.dispose();
    // Face −X, centred on the quarter panel ahead of the rear arch
    g.rotateY(-Math.PI / 2);
    g.translate(-(hw + 0.016), 0.75, 0.82);
    k.put(g, 'paint');
  }

  // A stone chip on the passenger side of the screen, cracks running out of it
  {
    const r = rng(5);
    const cx = 0.42;
    const ct = 0.32;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r() * 0.6;
      let x = cx;
      let t = ct;
      // Each crack wanders in three kinks
      for (let j = 0; j < 3; j++) {
        const len = 0.06 + r() * 0.16;
        const aj = a + (r() - 0.5) * 0.7;
        const x1 = x + Math.cos(aj) * len;
        const t1 = t + Math.sin(aj) * len * 1.5;
        if (Math.abs(x1) > 0.7 || t1 < 0.05 || t1 > 0.95) break;
        k.trim(strip(onWs(x, t, 0.003), onWs(x1, t1, 0.003), 0.0045, wsOut), C.crack);
        x = x1;
        t = t1;
      }
    }
    k.trim(strip(onWs(cx - 0.012, ct, 0.0035), onWs(cx + 0.012, ct, 0.0035), 0.02, wsOut), C.crazed);
  }

  // A wing spoiler on stalks off the tail, in unpainted black plastic
  {
    const z = -(tU + 0.08);
    for (const x of [-0.5, 0.5]) k.trim(box(0.04, 0.17, 0.07, x, m.tailY + 0.08, z), C.black);
    k.trim(box(1.36, 0.03, 0.2, 0, m.tailY + 0.175, z + 0.03, -0.14), C.black);
    for (const x of [-0.69, 0.69]) k.trim(box(0.018, 0.1, 0.24, x, m.tailY + 0.16, z + 0.03), C.black);
  }
}

/** A flat disc facing +X (or −X), at x. */
function disc(r: number, seg: number, x: number, facing: 1 | -1 = 1): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateY((facing * Math.PI) / 2);
  g.translate(x, 0, 0);
  return g;
}

/**
 * A wheel in its own frame: centred on the hub, +X out through its face.
 * The wheels are most of a car's triangles, so they are spent where they
 * show — the tyre's rounded shoulders, the spokes — and the rim is a pair of
 * discs closing the tyre's mouth, front and back, rather than a solid drum.
 */
function wheel(k: Kit, m: Model, style: WheelStyle): void {
  const w = style === 'steelBlack' ? m.tyreW * 0.82 : m.tyreW;
  const R = m.R;
  if (style === 'stub') {
    // The wheel is gone: a rusted drum on the hub
    k.trim(cylX(0.14, 0.11, 10, -0.02, 0, 0), C.drum);
    k.trim(cylX(0.05, 0.04, 6, 0.05, 0, 0), C.lug);
    return;
  }
  const ri = m.rimR + 0.012;
  const tyre = new THREE.LatheGeometry(
    vec2([
      [ri, -w / 2 + 0.012],
      [R - 0.04, -w / 2],
      [R, -w / 2 + 0.05],
      [R, w / 2 - 0.05],
      [R - 0.04, w / 2],
      [ri, w / 2 - 0.012]
    ]),
    // A multiple of four, so a vertex sits at the very bottom: the tyre touches y = 0
    16
  );
  tyre.rotateZ(-Math.PI / 2);
  k.trim(tyre, C.tyre);
  const face = w / 2 - 0.025;
  const rimR = m.rimR + 0.015;
  const steel = style === 'steel' || style === 'steelBlack';
  const paint = style === 'steel' ? C.steel : style === 'steelBlack' ? C.steelBlack : C.rimDark;
  k.trim(disc(rimR, 14, face, 1), paint);
  k.trim(disc(rimR, 10, -face, -1), C.rimDark);
  if (!steel) {
    const metal = style === 'exec' ? C.chrome : C.rim;
    const lip = new THREE.RingGeometry(m.rimR - 0.025, rimR, 14);
    lip.rotateY(Math.PI / 2);
    lip.translate(face + 0.003, 0, 0);
    k.trim(lip, metal);
    const n = style === 'exec' ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = m.rimR * 0.5;
      k.trim(box(0.014, m.rimR * 0.86, style === 'exec' ? 0.034 : 0.05, face + 0.002, Math.cos(a) * r, Math.sin(a) * r, a), metal);
    }
    k.trim(disc(0.055, 8, face + 0.012), C.chrome);
  } else {
    // Pressed steel: a plain painted disc, a raised centre, four nuts and the vent holes
    k.trim(cylX(0.1, 0.03, 12, face + 0.01, 0, 0), paint);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      k.trim(box(0.022, 0.022, 0.022, face + 0.03, Math.cos(a) * 0.06, Math.sin(a) * 0.06), C.lug);
    }
    const out = V(1, 0, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r0 = m.rimR * 0.58;
      const r1 = m.rimR * 0.74;
      k.trim(strip(V(face + 0.002, Math.cos(a) * r0, Math.sin(a) * r0), V(face + 0.002, Math.cos(a) * r1, Math.sin(a) * r1), 0.034, out), C.hole);
    }
  }
}

/** The Civic's last hubcap, in its own frame (centred, +X out): cheap silver plastic with fake spokes. */
function hubcapParts(k: Kit, m: Model): void {
  k.node = 'hubcap';
  const r = m.rimR + 0.02;
  k.trim(cylX(r - 0.012, 0.03, 18, 0, 0, 0, r), 0xc4c8cc);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.trim(box(0.006, r * 0.5, 0.035, 0.016, Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, a), 0x55595e);
  }
  k.trim(cylX(0.05, 0.02, 10, 0.022, 0, 0), 0xd9dcdf);
  k.node = 'body';
}

/** Seats, dash, steering wheel and carpet for the rigs' open cabins. */
function interior(k: Kit, m: Model, hw: number, notch: { front: number; rear: number }, exec: boolean): void {
  const iw = hw - 0.06;
  const seatCol = exec ? C.leather : C.cloth;
  k.trim(box(2 * iw, 0.03, notch.front - notch.rear, 0, FLOOR + 0.015, -(notch.front + notch.rear) / 2), C.carpet);
  const dashRear = m.cowlU - 0.3;
  const dashTop = m.belt + 0.03;
  k.trim(box(2 * iw, dashTop - 0.58, notch.front - dashRear, 0, (dashTop + 0.58) / 2, -(notch.front + dashRear) / 2), C.dash);
  const st = seatOf(m);
  // The wheel itself turns (the rig's steeringWheel); the column stays put
  const at = k.node;
  k.node = 'wheel';
  k.trim(new THREE.TorusGeometry(WHEEL_RIM, 0.02, 6, 18), C.black);
  k.trim(box(0.36, 0.03, 0.02, 0, 0, 0), C.black);
  k.trim(box(0.1, 0.09, 0.05, 0, 0, -0.01), C.black);
  k.node = at;
  const column = new THREE.CylinderGeometry(0.03, 0.035, 0.34, 8);
  column.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), st.wheelFacing));
  column.translate(st.wheel.x - st.wheelFacing.x * 0.18, st.wheel.y - st.wheelFacing.y * 0.18, st.wheel.z - st.wheelFacing.z * 0.18);
  k.trim(column, C.black);
  // Front seats, the driver's under his hip point
  const lean = 0.22;
  for (const x of [st.hip.x, -st.hip.x]) {
    const z = st.hip.z;
    k.trim(box(0.42, 0.36 - FLOOR, 0.4, x, (0.36 + FLOOR) / 2, z - 0.05), C.black);
    k.trim(box(0.48, 0.1, 0.5, x, 0.41, z - 0.08), seatCol);
    const by = 0.45 + 0.31 * Math.cos(lean);
    const bz = z + 0.14 + 0.31 * Math.sin(lean);
    k.trim(box(0.48, 0.62, 0.1, x, by, bz, lean), seatCol);
    k.trim(box(0.26, 0.17, 0.08, x, 0.45 + 0.71 * Math.cos(lean), z + 0.15 + 0.71 * Math.sin(lean), lean), seatCol);
  }
  // Rear bench
  k.trim(box(2 * iw - 0.1, 0.12, 0.42, 0, 0.42, -(notch.rear + 0.27)), seatCol);
  k.trim(box(2 * iw - 0.1, 0.55, 0.1, 0, 0.72, -(notch.rear + 0.07), 0.2), seatCol);
}

// ------------------------------------------------------------------ baking

/** Where a wheel sits, car-local: its frame's +X turned to face out of the car. */
function wheelMatrix(m: Model, name: WheelName): THREE.Matrix4 {
  const left = name === 'fl' || name === 'rl';
  const u = name === 'fl' || name === 'fr' ? m.uF : m.uR;
  const mat = new THREE.Matrix4().makeTranslation(left ? -m.track : m.track, m.R, -u);
  if (left) mat.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  return mat;
}

export function merge(list: THREE.BufferGeometry[], what: string): THREE.BufferGeometry {
  const g = list.length ? mergeGeometries(list, false) : null;
  for (const p of list) p.dispose();
  if (!g) throw new Error(`VehicleProps: could not merge the ${what}`);
  return g;
}

/** Value noise in [0, 1): smooth, and the same every run. */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const f = (t: number): number => t * t * (3 - 2 * t);
  const fx = f(x - xi);
  const fy = f(y - yi);
  const fz = f(z - zi);
  const c = (i: number, j: number, l: number): number => hash3(xi + i, yi + j, zi + l);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), fx);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), fx);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), fx);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

/**
 * Crush a baked car for the scrap pile: the roof caved in and the cabin
 * squashed by nearly half, both bumpers bent in at a corner, every panel
 * crumpled. Purely a function of position, so the four geometries — and the
 * two copies of each shared vertex — move together and nothing tears. Every
 * displacement is inward or downward, so the wreck keeps the car's footprint
 * and the physics box still fits it.
 */
function crush(g: THREE.BufferGeometry, m: Model, seed: number): void {
  const p = g.attributes.position as THREE.BufferAttribute;
  const hw = m.W / 2;
  const hl = m.L / 2;
  const cab = m.H - m.belt;
  const midU = (m.roofFU + m.roofRU) / 2;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let u = -p.getZ(i);
    if (y > m.belt) {
      const cave = Math.exp(-2.2 * (x / hw) ** 2 - ((u - midU) / 0.9) ** 2);
      const h = (y - m.belt) / cab;
      y = m.belt + (y - m.belt) * (0.58 - 0.16 * cave);
      x += 0.06 * h; // shoved over as it went down
    }
    const fz = (u - (hl - 0.34)) / 0.34;
    if (fz > 0) {
      const c = 0.5 - 0.5 * (x / hw);
      u -= fz * (0.04 + 0.12 * c);
      y -= fz * 0.06 * c;
    }
    const rz = (-hl + 0.3 - u) / 0.3;
    if (rz > 0) {
      const c = 0.5 + 0.5 * (x / hw);
      u += rz * (0.03 + 0.1 * c);
      y -= rz * 0.04 * c;
    }
    const n1 = noise3(x * 3.1 + seed, y * 3.1, u * 3.1);
    const n2 = noise3(x * 2.7 + 31, y * 2.7 + seed, u * 2.7 + 7);
    const n3 = noise3(x * 4.3, y * 4.3 + 13, u * 4.3 + seed);
    const amp = 0.06;
    x -= Math.sign(x) * amp * n1 * Math.min(1, (Math.abs(x) / hw) * 1.3);
    u -= Math.sign(u) * amp * 0.7 * n2 * Math.min(1, (Math.abs(u) / hl) * 1.3);
    if (y > 0.25) y -= amp * 0.9 * n3 * Math.min(1, (y - 0.25) / 0.5);
    p.setXYZ(i, x, Math.max(0, y), -u);
  }
  p.needsUpdate = true;
}

const bakedCache = new Map<string, BakedCar>();

/**
 * A car kind baked for instancing: four geometries in the car-local frame,
 * one InstancedMesh each. Cached per (kind, wrecked) — every parked car of a
 * kind is the same geometry, painted by its instance colour.
 */
export function bakedCar(kind: CarKind, wrecked = false): BakedCar {
  const key = `${kind}${wrecked ? ':wreck' : ''}`;
  const hit = bakedCache.get(key);
  if (hit) return hit;
  const m = MODELS[kind];
  const parts = buildCar(m, {
    wreck: wrecked,
    wheels: { fl: 'alloy', fr: 'alloy', rl: 'alloy', rr: wrecked ? 'stub' : 'alloy' }
  });
  const by: Record<keyof BakedCar, THREE.BufferGeometry[]> = { paint: [], trim: [], glass: [], lamps: [] };
  for (const part of parts) {
    if (part.node === 'hubcap' || part.node === 'sunroof' || part.node === 'wheel') continue;
    if (part.node !== 'body' && part.node !== 'door') part.g.applyMatrix4(wheelMatrix(m, part.node));
    const slot: keyof BakedCar =
      part.layer === 'paint' || part.layer === 'primer'
        ? 'paint'
        : part.layer === 'head' || part.layer === 'tail' || part.layer === 'ind'
          ? 'lamps'
          : part.layer;
    by[slot].push(part.g);
  }
  const out: BakedCar = {
    paint: merge(by.paint, `${key} paint`),
    trim: merge(by.trim, `${key} trim`),
    glass: merge(by.glass, `${key} glass`),
    lamps: merge(by.lamps, `${key} lamps`)
  };
  for (const g of [out.paint, out.trim, out.glass, out.lamps]) {
    if (wrecked) {
      crush(g, m, (['sedan', 'hatch', 'suv', 'pickup'] as CarKind[]).indexOf(kind) * 17.3 + 5);
      // Flat facets: crumpled steel catches the light in planes
      g.computeVertexNormals();
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  bakedCache.set(key, out);
  return out;
}

let shared: { paint: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial; lamps: THREE.Material } | null = null;

/**
 * The parked cars' materials, shared by every car and every InstancedMesh.
 * Paint is white in its vertex colours, so the instance colour is the paint;
 * glass is a dark smoked tint, opaque — nobody sees into a parked car, and
 * an opaque pane sorts with everything else for free.
 */
export function carMaterials(): { paint: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial; lamps: THREE.Material } {
  if (!shared) {
    shared = {
      paint: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, metalness: 0.2 }),
      trim: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.12 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x1b222b, roughness: 0.2, metalness: 0.1 }),
      lamps: new THREE.MeshBasicMaterial({ vertexColors: true })
    };
  }
  return shared;
}

// -------------------------------------------------------------------- rigs

export interface RigMats {
  paint: THREE.Material;
  primer: THREE.Material;
  glass: THREE.Material;
  headlights: THREE.MeshStandardMaterial;
  brakelights: THREE.MeshStandardMaterial;
  indicators: THREE.MeshStandardMaterial;
}

/** Fresh lamp materials for one rig: lenses with colour of their own, dark until the scene lights them. */
export function rigLamps(): Pick<RigMats, 'headlights' | 'brakelights' | 'indicators'> {
  return {
    headlights: new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.25, metalness: 0.1, emissive: C.head, emissiveIntensity: 0 }),
    brakelights: new THREE.MeshStandardMaterial({ color: 0x6e0c0c, roughness: 0.3, metalness: 0.1, emissive: 0xff1d12, emissiveIntensity: 0 }),
    indicators: new THREE.MeshStandardMaterial({ color: 0xb5671a, roughness: 0.3, metalness: 0.1, emissive: C.ind, emissiveIntensity: 0 })
  };
}

/**
 * Put a rig together from the parts: everything above the axles on the
 * body, which pivots at axle height; the driver's door on its front hinge;
 * the front wheels in steering pivots. Each wheel hangs from a holder turned
 * half round, so that adding to its rotation.x rolls the car forward (−Z):
 * a plain rotation about +X would turn the top of the wheel backward.
 */
export function assemble(m: Model, parts: Part[], mats: RigMats, exhaustAt: THREE.Vector3): CarRig & { hubcap: THREE.Object3D | null } {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.set(0, m.R, 0);
  group.add(body);
  const hinge = V(-halfBody(m) - 0.006, m.belt, -m.doorFront);
  const door = new THREE.Group();
  door.position.copy(hinge).sub(body.position);
  body.add(door);

  const holder = (name: WheelName): { pivot: THREE.Object3D; spin: THREE.Object3D } => {
    const at = new THREE.Vector3().setFromMatrixPosition(wheelMatrix(m, name));
    const pivot = new THREE.Object3D();
    pivot.position.copy(at);
    group.add(pivot);
    const flip = new THREE.Object3D();
    flip.rotation.y = Math.PI;
    pivot.add(flip);
    const spin = new THREE.Object3D();
    flip.add(spin);
    return { pivot, spin };
  };
  const fl = holder('fl');
  const fr = holder('fr');
  const rl = holder('rl');
  const rr = holder('rr');
  const spins: Record<WheelName, THREE.Object3D> = { fl: fl.spin, fr: fr.spin, rl: rl.spin, rr: rr.spin };

  let hubcap: THREE.Object3D | null = null;
  let sunroof: THREE.Object3D | null = null;
  let steeringWheel: THREE.Object3D | null = null;
  const parentOf = (node: Node): THREE.Object3D => {
    if (node === 'body') return body;
    if (node === 'door') return door;
    if (node === 'wheel') {
      if (!steeringWheel) {
        // On its column: +Z out of its face toward the driver, rotation.z turns it
        const st = seatOf(m);
        const mount = new THREE.Group();
        mount.position.copy(st.wheel).sub(body.position);
        mount.rotation.x = -Math.asin(st.wheelFacing.y);
        body.add(mount);
        steeringWheel = new THREE.Group();
        steeringWheel.name = 'steeringWheel';
        mount.add(steeringWheel);
      }
      return steeringWheel;
    }
    if (node === 'sunroof') {
      // Only the Civic has one; placed by its setOpen (see civic)
      if (!sunroof) {
        sunroof = new THREE.Group();
        sunroof.name = 'sunroof';
        body.add(sunroof);
      }
      return sunroof;
    }
    if (node === 'hubcap') {
      if (!hubcap) {
        hubcap = new THREE.Group();
        hubcap.name = 'hubcap';
        // Standing just off the steel wheel's face, clear of its nuts
        hubcap.position.set(m.tyreW / 2 + 0.004, 0, 0);
        spins.fl.add(hubcap);
      }
      return hubcap;
    }
    return spins[node];
  };
  // The holder's half turn already faces a wheel's +X out on the left; the right ones turn back
  const toNode = (node: Node): THREE.Matrix4 => {
    if (node === 'body') return new THREE.Matrix4().makeTranslation(0, -m.R, 0);
    if (node === 'door') return new THREE.Matrix4().makeTranslation(-hinge.x, -hinge.y, -hinge.z);
    if (node === 'sunroof' || node === 'wheel') return new THREE.Matrix4();
    if (node === 'fr' || node === 'rr') return new THREE.Matrix4().makeRotationY(Math.PI);
    return new THREE.Matrix4();
  };

  const groups = new Map<string, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const key = `${p.node}|${p.layer}`;
    const list = groups.get(key) ?? [];
    list.push(p.g);
    groups.set(key, list);
  }
  const trim = carMaterials().trim;
  const matFor = (layer: Layer): THREE.Material =>
    layer === 'paint'
      ? mats.paint
      : layer === 'primer'
        ? mats.primer
        : layer === 'glass'
          ? mats.glass
          : layer === 'head'
            ? mats.headlights
            : layer === 'tail'
              ? mats.brakelights
              : layer === 'ind'
                ? mats.indicators
                : trim;
  const meshes: THREE.Mesh[] = [];
  for (const [key, list] of groups) {
    const [node, layer] = key.split('|') as [Node, Layer];
    const g = merge(list, `rig ${key}`);
    g.applyMatrix4(toNode(node));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, matFor(layer));
    mesh.userData.surface = layer === 'glass' ? 'glass' : 'metal';
    parentOf(node).add(mesh);
    meshes.push(mesh);
  }

  const exhaust = new THREE.Object3D();
  exhaust.name = 'exhaust';
  exhaust.position.copy(exhaustAt).sub(body.position);
  body.add(exhaust);

  return {
    group,
    body,
    wheels: { fl: fl.spin, fr: fr.spin, rl: rl.spin, rr: rr.spin },
    steer: { l: fl.pivot, r: fr.pivot },
    setDoor(k: number): void {
      door.rotation.y = -clamp01(k) * DOOR_OPEN;
    },
    headlights: mats.headlights,
    brakelights: mats.brakelights,
    indicators: mats.indicators,
    exhaust,
    seat: seatOf(m),
    ...(steeringWheel ? { steeringWheel } : {}),
    meshes,
    hubcap
  };
}

/**
 * The boss's car: a long black executive saloon — chrome grille, chrome
 * along the glass and the handles, twin chrome tailpipes, glass tinted
 * near-black. Black paint with nothing to reflect needs its highlights from
 * the sun, so it stays fairly glossy.
 */
export function bossCar(): CarRig {
  const m = MODELS.exec;
  const parts = buildCar(m, { rig: true, exec: true, wheels: { fl: 'exec', fr: 'exec', rl: 'exec', rr: 'exec' } });
  const paint = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.28, metalness: 0.22 });
  const rig = assemble(
    m,
    parts,
    {
      paint,
      primer: paint,
      glass: new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.12, metalness: 0.2 }),
      ...rigLamps()
    },
    V(-0.55, m.tailLow - 0.02, m.L / 2 + 0.01)
  );
  const { hubcap: _none, ...out } = rig;
  return out;
}

/**
 * Ravi's getaway: an early-2000s three-door hatchback, silver-green once and
 * chalky now, the driver's door a scrapyard replacement in grey primer, a
 * plain steel spare on the back that matches nothing, and one hubcap left of
 * four — on the front left, loose, and its own object so the scene can send
 * it rolling off across the lot. Its glass is see-through: he is visible at
 * the wheel.
 */
export function civic(): CivicRig {
  const m = MODELS.hatch;
  const k = new Kit();
  hubcapParts(k, m);
  const parts = [
    ...buildCar(m, { rig: true, civic: true, wheels: { fl: 'steel', fr: 'steel', rl: 'steel', rr: 'steelBlack' } }),
    ...k.parts
  ];
  const rig = assemble(
    m,
    parts,
    {
      paint: new THREE.MeshStandardMaterial({ color: 0x9aa697, roughness: 0.66, metalness: 0.12 }),
      primer: new THREE.MeshStandardMaterial({ color: 0x7c7f7b, roughness: 0.94, metalness: 0 }),
      glass: new THREE.MeshStandardMaterial({
        color: 0x2a3540,
        roughness: 0.15,
        metalness: 0.1,
        transparent: true,
        opacity: 0.42,
        depthWrite: false
      }),
      ...rigLamps()
    },
    V(0.48, m.tailLow - 0.03, m.L / 2 + 0.05)
  );
  if (!rig.hubcap) throw new Error('VehicleProps: the Civic lost its hubcap before the scene could');
  const panel = rig.body.getObjectByName('sunroof');
  if (!panel) throw new Error('VehicleProps: the Civic has no sunroof');
  return { ...rig, hubcap: rig.hubcap, sunroof: sunroofRig(m, panel) };
}

/**
 * The Civic's sunroof as the scene drives it: setOpen(0) shut, the panel
 * seated over the opening; up to 0.2 it lifts off its seat; on to 1 it
 * slides back along the runners until the opening is clear. `hatch` is the
 * opening's middle at roof height, car-local (the group's frame).
 */
function sunroofRig(m: Model, panel: THREE.Object3D): { setOpen(k: number): void; hatch: THREE.Vector3 } {
  const S = SUNROOF;
  const uc = (S.front + S.rear) / 2;
  const ease = (t: number): number => {
    const c = clamp01(t);
    return c * c * (3 - 2 * c);
  };
  const slope = (u: number): number => (roofTop(m, u + 0.01) - roofTop(m, u - 0.01)) / 0.02;
  const setOpen = (k: number): void => {
    const t = clamp01(k);
    const lift = S.lift * ease(t / 0.2);
    const u = uc - S.slide * ease((t - 0.2) / 0.8);
    // On the body, which pivots at axle height
    panel.position.set(0, roofTop(m, u) + S.stand + lift - m.R, -u);
    panel.rotation.set(Math.atan(slope(u)), 0, 0);
  };
  setOpen(0);
  return { setOpen, hatch: V(0, roofTop(m, uc), -uc) };
}
