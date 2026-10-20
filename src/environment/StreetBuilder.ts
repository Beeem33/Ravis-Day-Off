import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Lane, Road, RoadId, RoadSample, StreetBlocker, StreetData } from '../scenes/StreetContracts';

// ---------------------------------------------------------------- the street
//
// Map 10: one continuous drive, out of the staff car park and up the avenue,
// up the on-ramp onto the elevated highway, off at exit 12 and down to the
// airport's private-aviation gate. Same frame as every level: x east, z
// SOUTH, y up, the ground y = 0. Yaw 0 faces −Z (north); forward is
// (−sin yaw, 0, −cos yaw) and the right of it (cos yaw, 0, −sin yaw).
//
//   city     (0,0) north up a four-lane avenue, a gentle right then left bend,
//            cross streets at s 110, 400 and 640 (and one behind the start)
//   onramp   from the avenue's end: funnels to one lane, curves right (east)
//            and climbs to the deck (8 m), merges onto the highway's right side
//   highway  east, then a long left bend to east-north-east; the cop at s 500,
//            the fork at s 1150, the construction closure at s 1500
//   exit     peels off the right at the fork, curves right and down to grade
//   airport  south-south-east to the gate; beyond it the apron and the jet
//
// The highway road's centreline is the centre of its RIGHT-HAND lane (lanes
// at 0, −3.6, −7.2; shoulder to +5.3; a metre of inner shoulder to the median
// at −10). Every other road's centreline is the middle of its carriageway.

type V3 = [number, number, number];
type RGBA = [number, number, number, number];
/** A cross-section polyline: [lateral (+ right), height above the deck]. Listed counter-clockwise round the solid. */
type Prof = [number, number][];

const STEP = 0.25;
const SPACING = 2;
const DECK = 8;
/** Heights of the ground layers: grass under everything, paved lots and blocks, footpath tops. */
const GROUND = -0.25;
const PAD = -0.08;
const WALK = 0.15;

const CITY_BACK = 250;
const CITY_LEN = 650;
const CITY_HALF = 7.5;
const WALK_OUT = 12.5;
const CROSS = [-150, 110, 400, 640];
const CROSS_HALF = 5;
const CROSS_WALK = 9.5;
const CROSS_NAMES = ['st4', 'st1', 'st2', 'st3'];
/** The staff car park Ravi comes out of: east of the avenue, its gate in the west fence. */
const LOT = { s0: -70, s1: 30, gate0: -4, gate1: 8, lat0: 13, lat1: 85 };

const RAMP_TAPER = 40;
/** Where the ramp's centre ends up in the funnel, right of the avenue's centreline. */
const RAMP_OFF = 3.0;
const MERGE_LEN = 110;
/** Two lanes our way, 9 m between the barriers. */
const RAMP_HALF = 4.5;

const HW_BACK = 900;
const HW_LEN = 1510;
const HW_ON = 700;
const EXIT_S = 1150;
const MISSED_S = 1420;
const CLOSURE_S = 1500;
const NEAR_END = 1560;
const COP_S = 500;
const EXIT_HALF = 2.75;
const AIR_HALF = 3.75;
const EXIT_PEEL = 4.6;

/** The highway's cross-section, laterals from the right-hand lane's centre. */
const HW = { R: 5.3, nearL: -10, medL: -10.8, farL: -25.6, bot: -1.6, colA: -4, colB: -18.2 } as const;

/** Toward the sun: high in the south-south-west, early afternoon. Behind Ravi up the avenue, over his right shoulder on the highway. */
const SUN_DIR = new THREE.Vector3(-0.35, 0.62, 0.7).normalize();

/** Everything the scene needs to set itself for this level's daylight. */
export const STREET_ATMOSPHERE = {
  background: 0x9fbbd8,
  /** Haze toward the horizon; the sky and the sun are unfogged. */
  fog: { color: 0xd0cfc4, near: 260, far: 950 },
  /** The sky sphere (1150 m) rides on the camera, so this only has to reach it. */
  cameraFar: 1300,
  exposure: 1.05
} as const;

/** The route's numbers, for the scene: everything here is also in the StreetData it builds. */
export const STREET = {
  deckHeight: DECK,
  city: { length: CITY_LEN, half: CITY_HALF, crossings: CROSS.slice(1) },
  highway: { length: HW_LEN, exitS: EXIT_S, missedExitS: MISSED_S, closureS: CLOSURE_S, copS: COP_S, halfLeft: 10, halfRight: HW.R },
  exitHalf: EXIT_HALF,
  airportHalf: AIR_HALF
} as const;

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const sm = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const fx = (yaw: number): number => -Math.sin(yaw);
const fz = (yaw: number): number => -Math.cos(yaw);
const rx = (yaw: number): number => Math.cos(yaw);
const rz = (yaw: number): number => -Math.sin(yaw);
const yawOf = (t: THREE.Vector3): number => Math.atan2(-t.x, -t.z);

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function rgba(hex: number, a = 1): RGBA {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b, a];
}
const shade = (c: RGBA, k: number): RGBA => [c[0] * k, c[1] * k, c[2] * k, c[3]];
const WHITE: RGBA = [1, 1, 1, 1];
const UP: V3 = [0, 1, 0];

// ---------------------------------------------------------------- the route

interface Pose {
  x: number;
  z: number;
  yaw: number;
}
interface Seg {
  len: number;
  /** Total change of yaw over it: + turns left. */
  turn: number;
}
interface Dense {
  x: number;
  y: number;
  z: number;
  hl: number;
  hr: number;
  tag: number;
}

/** A centreline from straights and arcs, a point every STEP metres. */
function trace(start: Pose, segs: Seg[]): Pose[] {
  const out: Pose[] = [{ ...start }];
  let { x, z, yaw } = start;
  for (const sg of segs) {
    const n = Math.max(1, Math.round(sg.len / STEP));
    const ds = sg.len / n;
    const dy = sg.turn / n;
    for (let i = 0; i < n; i++) {
      const ym = yaw + dy / 2;
      x -= Math.sin(ym) * ds;
      z -= Math.cos(ym) * ds;
      yaw += dy;
      out.push({ x, z, yaw });
    }
  }
  return out;
}

/** Evenly spaced samples (about SPACING apart along the surface), first at 0, last at the end. */
function resample(d: Dense[]): { samples: RoadSample[]; tags: number[]; cum: number[] } {
  const cum = [0];
  for (let i = 1; i < d.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(d[i].x - d[i - 1].x, d[i].y - d[i - 1].y, d[i].z - d[i - 1].z));
  }
  const L = cum[cum.length - 1];
  const n = Math.max(1, Math.round(L / SPACING));
  const samples: RoadSample[] = [];
  const tags: number[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = k === n ? L : (L * k) / n;
    while (j < d.length - 2 && cum[j + 1] < s) j++;
    const a = d[j];
    const b = d[j + 1];
    const seg = cum[j + 1] - cum[j];
    const f = seg > 0 ? Math.min(1, Math.max(0, (s - cum[j]) / seg)) : 0;
    const t = V(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    const r = V(-t.z, 0, t.x).normalize();
    samples.push({
      s,
      pos: V(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f),
      tangent: t,
      right: r,
      halfLeft: a.hl + (b.hl - a.hl) * f,
      halfRight: a.hr + (b.hr - a.hr) * f
    });
    tags.push(f < 0.5 ? a.tag : b.tag);
  }
  return { samples, tags, cum };
}

/** A run of evenly spaced frames, to be read anywhere along. */
class Chain {
  readonly s0: number;
  readonly ds: number;
  constructor(readonly f: RoadSample[]) {
    this.s0 = f[0].s;
    this.ds = (f[f.length - 1].s - f[0].s) / (f.length - 1);
  }
  get s1(): number {
    return this.f[this.f.length - 1].s;
  }
  at(s: number): RoadSample {
    const n = this.f.length;
    const x = Math.min(n - 1, Math.max(0, (s - this.s0) / this.ds));
    const i = Math.min(n - 2, Math.floor(x));
    const k = x - i;
    const a = this.f[i];
    const b = this.f[i + 1];
    const t = a.tangent.clone().lerp(b.tangent, k).normalize();
    return {
      s,
      pos: a.pos.clone().lerp(b.pos, k),
      tangent: t,
      right: V(-t.z, 0, t.x).normalize(),
      halfLeft: a.halfLeft + (b.halfLeft - a.halfLeft) * k,
      halfRight: a.halfRight + (b.halfRight - a.halfRight) * k
    };
  }
  /** The frames from a to b: one at each end, and every sample between. */
  span(a: number, b: number): RoadSample[] {
    const out = [this.at(a)];
    const i0 = Math.max(0, Math.floor((a - this.s0) / this.ds));
    for (let i = i0; i < this.f.length; i++) {
      const s = this.f[i].s;
      if (s <= a + 1e-4) continue;
      if (s >= b - 1e-4) break;
      out.push(this.f[i]);
    }
    out.push(this.at(b));
    return out;
  }
}

const pt = (f: RoadSample, lat: number, dy = 0): V3 => [f.pos.x + f.right.x * lat, f.pos.y + dy, f.pos.z + f.right.z * lat];

/** Alongside the highway, the ramp's centre this far right of its right lane: barriers back to back. */
const RAMP_ALONG = 5.3 + 2 * 0.6 + RAMP_HALF;
/** Just right of the right lane, its left edge on the lane's edge line. */
const RAMP_ADJ = 1.8 + RAMP_HALF;

/** The onramp's merge: its centre's offset right of the highway's right lane, t metres past the nose. */
function mergeOff(t: number): number {
  if (t < 35) return RAMP_ALONG - (RAMP_ALONG - RAMP_ADJ) * sm(t / 35);
  if (t < 45) return RAMP_ADJ;
  return RAMP_ADJ * (1 - sm((t - 45) / 65));
}

interface Route {
  roads: Record<RoadId, Road>;
  tags: Record<RoadId, number[]>;
  cityVis: Chain;
  hwVis: Chain;
  ramp: Chain;
  exit: Chain;
  air: Chain;
  /** The highway's paved right edge (to its barrier) at u, where the ramps fuse into it. */
  hwR: (u: number) => number;
  /** Where on the ramps the fused stretch meets the separate deck. */
  rampNoseS: number;
  exitNoseS: number;
  exitNoseU: number;
  /** Highway u where the exit's left line has pulled clear of the right lane's edge line. */
  exitDivU: number;
  /** Highway u where the onramp's left line has come in to the right lane's edge line. */
  rampConvU: number;
  /** The exit's left line laterally (highway frame) at highway u, through the fused stretch. */
  exitLeftLat: (u: number) => number;
  rampLeftLat: (u: number) => number;
}

function buildRoute(): Route {
  // ---- The avenue, and its first 250 m behind the start for the view back
  const cityPoses = trace({ x: 0, z: CITY_BACK, yaw: 0 }, [
    { len: CITY_BACK, turn: 0 },
    { len: 200, turn: 0 },
    { len: 112.5, turn: -0.25 },
    { len: 167.5, turn: 0 },
    { len: 112.5, turn: 0.25 },
    { len: 57.5, turn: 0 }
  ]);
  const cityDense: Dense[] = cityPoses.map((p) => ({ x: p.x, y: 0, z: p.z, hl: CITY_HALF, hr: CITY_HALF, tag: 0 }));
  const cityVisR = resample(cityDense);
  for (const f of cityVisR.samples) f.s -= CITY_BACK;
  const city = resample(cityDense.slice(Math.round(CITY_BACK / STEP)));
  const E = cityPoses[cityPoses.length - 1];

  // ---- Where the highway starts (u 0). Fixed from the avenue's end as it was laid out first
  // (a one-lane ramp 4.2 m right of the avenue's line, an 80 m curve, 15 m alongside 9.5 m
  // right of the highway's right lane), so everything along the highway stays put
  const hwYaw = -Math.PI / 2;
  const anchor = trace({ x: E.x + rx(E.yaw) * 4.2 + fx(E.yaw) * RAMP_TAPER, z: E.z + rz(E.yaw) * 4.2 + fz(E.yaw) * RAMP_TAPER, yaw: E.yaw }, [
    { len: 40 * Math.PI, turn: -Math.PI / 2 },
    { len: 15, turn: 0 }
  ]);
  const A0 = anchor[anchor.length - 1];
  const H0x = A0.x - rx(hwYaw) * 9.5 + fx(hwYaw) * MERGE_LEN;
  const H0z = A0.z - rz(hwYaw) * 9.5 + fz(hwYaw) * MERGE_LEN;

  // ---- The on-ramp: the funnel to two lanes, the climbing curve, alongside, the merge
  const ramp: Dense[] = [];
  const fun = trace(E, [{ len: RAMP_TAPER, turn: 0 }]);
  fun.forEach((p, i) => {
    const k = sm((i * STEP) / RAMP_TAPER);
    const off = RAMP_OFF * k;
    const le = -CITY_HALF + (CITY_HALF - (RAMP_HALF - RAMP_OFF)) * k;
    const re = CITY_HALF + (RAMP_OFF + RAMP_HALF - CITY_HALF) * k;
    ramp.push({ x: p.x + rx(p.yaw) * off, y: 0, z: p.z + rz(p.yaw) * off, hl: off - le, hr: re - off, tag: 2 });
  });
  const T = ramp[ramp.length - 1];
  // The curve and the run alongside, fitted to land RAMP_ALONG right of the highway's right lane
  // at the nose: a quarter turn right of radius R (north to east), then P metres east
  const Nx = H0x - fx(hwYaw) * MERGE_LEN + rx(hwYaw) * RAMP_ALONG;
  const Nz = H0z - fz(hwYaw) * MERGE_LEN + rz(hwYaw) * RAMP_ALONG;
  const rampRad = (Nx - T.x) * fx(E.yaw) + (Nz - T.z) * fz(E.yaw);
  const rampPar = (Nx - T.x) * rx(E.yaw) + (Nz - T.z) * rz(E.yaw) - rampRad;
  const arc = trace({ x: T.x, z: T.z, yaw: E.yaw }, [
    { len: (rampRad * Math.PI) / 2, turn: -Math.PI / 2 },
    { len: rampPar, turn: 0 }
  ]);
  for (let i = 1; i < arc.length; i++) ramp.push({ x: arc[i].x, y: 0, z: arc[i].z, hl: RAMP_HALF, hr: RAMP_HALF, tag: 1 });
  // Exactly on the fitted nose (the traced curve lands within a fraction of a millimetre of it)
  ramp[ramp.length - 1].x = Nx;
  ramp[ramp.length - 1].z = Nz;
  const rampNoseIdx = ramp.length - 1;
  for (let i = 1; i <= Math.round(MERGE_LEN / STEP); i++) {
    const t = i * STEP;
    const off = mergeOff(t);
    const u = t - MERGE_LEN;
    ramp.push({
      x: H0x + fx(hwYaw) * u + rx(hwYaw) * off,
      y: 0,
      z: H0z + fz(hwYaw) * u + rz(hwYaw) * off,
      hl: off + 10,
      hr: Math.max(RAMP_HALF, HW.R - off),
      tag: 0
    });
  }
  {
    let d = 0;
    for (let i = 0; i < ramp.length; i++) {
      if (i > 0) d += Math.hypot(ramp[i].x - ramp[i - 1].x, ramp[i].z - ramp[i - 1].z);
      ramp[i].y = DECK * sm((d - 25) / 150);
    }
  }

  // ---- The highway: 900 m of deck behind the merge for the view, the drivable 1510, 700 more of the far side
  const hwPoses = trace({ x: H0x - fx(hwYaw) * HW_BACK, z: H0z - fz(hwYaw) * HW_BACK, yaw: hwYaw }, [
    { len: HW_BACK, turn: 0 },
    { len: 560, turn: 0 },
    { len: 240, turn: 0.24 },
    { len: HW_LEN - 800, turn: 0 },
    { len: HW_ON, turn: 0 }
  ]);
  const iu = (u: number): number => Math.round((u + HW_BACK) / STEP);
  // The straight from u 800 on, as a frame: where the exit is measured against it
  const S = hwPoses[iu(800)];
  const toHw = (x: number, z: number): { u: number; lat: number } => ({
    u: 800 + (x - S.x) * fx(S.yaw) + (z - S.z) * fz(S.yaw),
    lat: (x - S.x) * rx(S.yaw) + (z - S.z) * rz(S.yaw)
  });

  // ---- The exit: down the shoulder, then curving right and down
  const exit: Dense[] = [];
  for (let i = iu(EXIT_S); i <= iu(EXIT_S + 60); i++) {
    const p = hwPoses[i];
    const off = EXIT_PEEL * sm(((i - iu(EXIT_S)) * STEP) / 60);
    exit.push({ x: p.x + rx(p.yaw) * off, y: DECK, z: p.z + rz(p.yaw) * off, hl: 0, hr: 0, tag: 0 });
  }
  const P60 = exit[exit.length - 1];
  const exArc = trace({ x: P60.x, z: P60.z, yaw: hwPoses[iu(EXIT_S + 60)].yaw }, [
    { len: 220, turn: -1.0 },
    { len: 20, turn: 0 }
  ]);
  for (let i = 1; i < exArc.length; i++) exit.push({ x: exArc[i].x, y: DECK, z: exArc[i].z, hl: 0, hr: 0, tag: 1 });
  const fusedU: number[] = [];
  const fusedLat: number[] = [];
  let exitNoseIdx = -1;
  {
    let t = 0;
    for (let i = 0; i < exit.length; i++) {
      const e = exit[i];
      if (i > 0) t += Math.hypot(e.x - exit[i - 1].x, e.z - exit[i - 1].z);
      e.y = DECK * (1 - sm((t - 130) / 155));
      const h = toHw(e.x, e.z);
      // The nose: where its left barrier's back meets the highway's right barrier's back
      if (exitNoseIdx < 0 && h.lat - EXIT_HALF - 0.6 >= HW.R + 0.6) exitNoseIdx = i;
      if (exitNoseIdx < 0 || i < exitNoseIdx + 40) {
        fusedU.push(h.u);
        fusedLat.push(h.lat);
      }
      if (exitNoseIdx < 0) {
        e.tag = 0;
        e.hl = h.lat + 10;
        e.hr = Math.max(EXIT_HALF, HW.R - h.lat);
      } else {
        e.tag = 1;
        e.hl = e.hr = EXIT_HALF + (AIR_HALF - EXIT_HALF) * sm((t - 268) / 30);
      }
    }
  }
  const latAt = (u: number): number => {
    if (u <= fusedU[0]) return fusedLat[0];
    let lo = 0;
    let hi = fusedU.length - 1;
    if (u >= fusedU[hi]) return fusedLat[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fusedU[mid] <= u) lo = mid;
      else hi = mid;
    }
    const k = (u - fusedU[lo]) / (fusedU[hi] - fusedU[lo] || 1);
    return fusedLat[lo] + (fusedLat[hi] - fusedLat[lo]) * k;
  };
  const exitNoseU = toHw(exit[exitNoseIdx].x, exit[exitNoseIdx].z).u;
  const hwR = (u: number): number => {
    if (u >= -MERGE_LEN && u <= 0) return Math.max(HW.R, mergeOff(u + MERGE_LEN) + RAMP_HALF);
    if (u >= EXIT_S && u <= exitNoseU) return Math.max(HW.R, latAt(u) + EXIT_HALF);
    return HW.R;
  };

  const hwDense: Dense[] = [];
  for (let i = iu(0); i <= iu(HW_LEN); i++) {
    const u = i * STEP - HW_BACK;
    hwDense.push({ x: hwPoses[i].x, y: DECK, z: hwPoses[i].z, hl: 10, hr: u >= EXIT_S && u < exitNoseU ? hwR(u) : HW.R, tag: 0 });
  }
  const hw = resample(hwDense);
  const hwVisR = resample(hwPoses.map((p) => ({ x: p.x, y: DECK, z: p.z, hl: 10, hr: HW.R, tag: 0 })));
  for (const f of hwVisR.samples) f.s -= HW_BACK;

  // ---- The airport road: on from the exit's foot to the gate
  const XE = exArc[exArc.length - 1];
  const airPoses = trace({ x: XE.x, z: XE.z, yaw: XE.yaw }, [
    { len: 150, turn: 0 },
    { len: 105, turn: -0.35 },
    { len: 95, turn: 0 }
  ]);
  const air = resample(airPoses.map((p) => ({ x: p.x, y: 0, z: p.z, hl: AIR_HALF, hr: AIR_HALF, tag: 3 })));

  const rampRes = resample(ramp);
  const exitR = resample(exit);

  // Where the painted lines part and meet (highway u)
  let exitDivU = EXIT_S + 70;
  for (let i = 0; i < fusedU.length; i++) {
    if (fusedLat[i] - EXIT_HALF + 0.25 >= 2.4) {
      exitDivU = fusedU[i];
      break;
    }
  }
  let rampConvU = -MERGE_LEN + 30;
  for (let t = 0; t < MERGE_LEN; t += 0.25) {
    if (mergeOff(t) - RAMP_HALF + 0.25 <= 2.3) {
      rampConvU = t - MERGE_LEN;
      break;
    }
  }

  const cityLanes: Lane[] = [
    { offset: 1.8, dir: 1, speed: 16 },
    { offset: 5.4, dir: 1, speed: 14 },
    { offset: -1.8, dir: -1, speed: 17 },
    { offset: -5.4, dir: -1, speed: 15 }
  ];
  // The far carriageway's three lanes are listed too, dir −1 and beyond halfLeft (−10): not part of
  // this road's drivable width — the median barrier is between — but Traffic drives them for the
  // oncoming stream. Fast lanes nearest the median on both sides.
  const hwLanes: Lane[] = [
    { offset: 0, dir: 1, speed: 24 },
    { offset: -3.6, dir: 1, speed: 26.5 },
    { offset: -7.2, dir: 1, speed: 29 },
    { offset: -13.6, dir: -1, speed: 29 },
    { offset: -17.2, dir: -1, speed: 26.5 },
    { offset: -20.8, dir: -1, speed: 24 }
  ];
  const road = (id: RoadId, r: { samples: RoadSample[] }, lanes: Lane[], next: RoadId | null, limitMph: number): Road => ({
    id,
    samples: r.samples,
    length: r.samples[r.samples.length - 1].s,
    lanes,
    next,
    limitMph
  });
  const roads: Record<RoadId, Road> = {
    city: road('city', city, cityLanes, 'onramp', 35),
    onramp: road('onramp', rampRes, [{ offset: -1.8, dir: 1, speed: 24 }, { offset: 1.8, dir: 1, speed: 24 }], 'highway', 45),
    highway: road('highway', hw, hwLanes, null, 65),
    exit: { ...road('exit', exitR, [], 'airport', 40), from: { road: 'highway', s: EXIT_S } },
    airport: road('airport', air, [], null, 25)
  };

  return {
    roads,
    tags: { city: city.tags, onramp: rampRes.tags, highway: hw.tags, exit: exitR.tags, airport: air.tags },
    cityVis: new Chain(cityVisR.samples),
    hwVis: new Chain(hwVisR.samples),
    ramp: new Chain(rampRes.samples),
    exit: new Chain(exitR.samples),
    air: new Chain(air.samples),
    hwR,
    rampNoseS: rampRes.cum[rampNoseIdx],
    exitNoseS: exitR.cum[exitNoseIdx],
    exitNoseU,
    exitDivU,
    rampConvU,
    exitLeftLat: (u) => latAt(u) - EXIT_HALF + 0.25,
    rampLeftLat: (u) => mergeOff(u + MERGE_LEN) - RAMP_HALF + 0.25
  };
}

// ---------------------------------------------------------------- geometry

class FBuf {
  a = new Float32Array(1 << 14);
  n = 0;
  push(...v: number[]): void {
    if (this.n + v.length > this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    for (const x of v) this.a[this.n++] = x;
  }
  view(): Float32Array {
    return this.a.slice(0, this.n);
  }
}

/** Flat polygons gathered into one non-indexed geometry, each face its own normal: the low-poly look, one draw. */
class Geo {
  private p = new FBuf();
  private nr = new FBuf();
  private uv = new FBuf();
  private c = new FBuf();
  get empty(): boolean {
    return this.p.n === 0;
  }
  get tris(): number {
    return this.p.n / 9;
  }
  /** A polygon (convex, or star-shaped from its first corner), fanned, turned to face `want`. */
  poly(pts: V3[], uvs: [number, number][] | null, col: RGBA, want: V3 | null): void {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const u = pts[i];
      const v = pts[(i + 1) % pts.length];
      nx += (u[1] - v[1]) * (u[2] + v[2]);
      ny += (u[2] - v[2]) * (u[0] + v[0]);
      nz += (u[0] - v[0]) * (u[1] + v[1]);
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len;
    ny /= len;
    nz /= len;
    const flip = want ? nx * want[0] + ny * want[1] + nz * want[2] < 0 : false;
    if (flip) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const ids = flip ? [0, i + 1, i] : [0, i, i + 1];
      for (const k of ids) {
        const q = pts[k];
        this.p.push(q[0], q[1], q[2]);
        this.nr.push(nx, ny, nz);
        if (uvs) this.uv.push(uvs[k][0], uvs[k][1]);
        else this.uv.push(0, 0);
        this.c.push(col[0], col[1], col[2], col[3]);
      }
    }
  }
  geometry(colours: 'none' | 'rgb' | 'rgba'): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nr.view(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.view(), 2));
    if (colours !== 'none') {
      const src = this.c.view();
      if (colours === 'rgba') g.setAttribute('color', new THREE.BufferAttribute(src, 4));
      else {
        const rgb = new Float32Array((src.length / 4) * 3);
        for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
          rgb[j] = src[i];
          rgb[j + 1] = src[i + 1];
          rgb[j + 2] = src[i + 2];
        }
        g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      }
    }
    g.computeBoundingSphere();
    return g;
  }
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A box on any three axes, `h` its half extents. `uvTile`: lay the texture in metres over each face. */
function obox(g: Geo, c: V3, ax: V3, ay: V3, az: V3, hx: number, hy: number, hz: number, col: RGBA, uvTile = 0): void {
  const P = (sx: number, sy: number, sz: number): V3 => add(add(add(c, ax, sx * hx), ay, sy * hy), az, sz * hz);
  const face = (a: V3, b: V3, cc: V3, d: V3, want: V3, w: number, h: number): void => {
    const uvs: [number, number][] | null = uvTile ? [[0, 0], [w / uvTile, 0], [w / uvTile, h / uvTile], [0, h / uvTile]] : null;
    g.poly([a, b, cc, d], uvs, col, want);
  };
  face(P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1), ax, 2 * hz, 2 * hy);
  face(P(-1, -1, 1), P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1), neg(ax), 2 * hz, 2 * hy);
  face(P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1), ay, 2 * hx, 2 * hz);
  face(P(-1, -1, 1), P(1, -1, 1), P(1, -1, -1), P(-1, -1, -1), neg(ay), 2 * hx, 2 * hz);
  face(P(-1, -1, 1), P(-1, 1, 1), P(1, 1, 1), P(1, -1, 1), az, 2 * hx, 2 * hy);
  face(P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, -1), neg(az), 2 * hx, 2 * hy);
}

/** A box standing on the yaw: w across (its right), h up from its base y, d along. */
function boxAt(g: Geo, x: number, y: number, z: number, yaw: number, w: number, h: number, d: number, col: RGBA, uvTile = 0): void {
  obox(g, [x, y + h / 2, z], [rx(yaw), 0, rz(yaw)], UP, [-fx(yaw), 0, -fz(yaw)], w / 2, h / 2, d / 2, col, uvTile);
}

/** A box between two points, w wide and h deep across them. */
function beam(g: Geo, a: V3, b: V3, w: number, h: number, col: RGBA): void {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const dir = norm(d);
  const side = Math.abs(dir[1]) > 0.98 ? ([1, 0, 0] as V3) : norm(cross(dir, UP));
  const up = cross(side, dir);
  obox(g, add(a, d, 0.5), side, up, dir, w / 2, h / 2, len / 2, col);
}

/** A tapered tube from a to b, `seg` sided, capped at the far end. */
function tube(g: Geo, a: V3, b: V3, r0: number, r1: number, seg: number, col: RGBA, uvTile = 0): void {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const dir = norm(d);
  const s1 = Math.abs(dir[1]) > 0.98 ? ([1, 0, 0] as V3) : norm(cross(dir, UP));
  const s2 = cross(s1, dir);
  const ring = (c: V3, r: number, k: number): V3 => {
    const t = (k / seg) * Math.PI * 2;
    return add(add(c, s1, Math.cos(t) * r), s2, Math.sin(t) * r);
  };
  const top: V3[] = [];
  for (let k = 0; k < seg; k++) {
    const p0 = ring(a, r0, k);
    const p1 = ring(a, r0, k + 1);
    const q1 = ring(b, r1, k + 1);
    const q0 = ring(b, r1, k);
    const mid = (k + 0.5) / seg;
    const want = norm(add(add([0, 0, 0], s1, Math.cos(mid * Math.PI * 2)), s2, Math.sin(mid * Math.PI * 2)));
    const circ = 2 * Math.PI * Math.max(r0, r1);
    const uvs: [number, number][] | null = uvTile
      ? [[(k / seg) * circ / uvTile, 0], [((k + 1) / seg) * circ / uvTile, 0], [((k + 1) / seg) * circ / uvTile, len / uvTile], [(k / seg) * circ / uvTile, len / uvTile]]
      : null;
    g.poly([p0, p1, q1, q0], uvs, col, want);
    top.push(q0);
  }
  if (r1 > 0.001) g.poly(top, null, col, dir);
}

const cylY = (g: Geo, x: number, y0: number, z: number, r0: number, r1: number, h: number, seg: number, col: RGBA, uvTile = 0): void =>
  tube(g, [x, y0, z], [x, y0 + h, z], r0, r1, seg, col, uvTile);

/**
 * Sweep a cross-section along frames. Each profile is a counter-clockwise
 * piece of a solid's outline (lateral right, height up), so the outward
 * side of every edge is known: (dh, −dl).
 */
function extrude(g: Geo, frs: RoadSample[], prof: (k: number) => Prof, col: RGBA, tile = 0, latUV = false): void {
  let prev = prof(0);
  for (let k = 0; k < frs.length - 1; k++) {
    const next = prof(k + 1);
    const A = frs[k];
    const B = frs[k + 1];
    let acc = 0;
    for (let j = 0; j < prev.length - 1; j++) {
      const dl = prev[j + 1][0] - prev[j][0];
      const dh = prev[j + 1][1] - prev[j][1];
      const len = Math.hypot(dl, dh);
      if (len < 1e-6) continue;
      const want: V3 = [A.right.x * dh, -dl, A.right.z * dh];
      let uvs: [number, number][] | null = null;
      if (tile) {
        const u0 = latUV ? prev[j][0] / tile : acc / tile;
        const u1 = latUV ? prev[j + 1][0] / tile : (acc + len) / tile;
        uvs = [[u0, A.s / tile], [u1, A.s / tile], [u1, B.s / tile], [u0, B.s / tile]];
      }
      g.poly([pt(A, prev[j][0], prev[j][1]), pt(A, prev[j + 1][0], prev[j + 1][1]), pt(B, next[j + 1][0], next[j + 1][1]), pt(B, next[j][0], next[j][1])], uvs, col, want);
      acc += len;
    }
    prev = next;
  }
}

/** A cross-section's face at one frame, facing along (+1) or against (−1) the road. */
function capAt(g: Geo, f: RoadSample, poly: Prof, facing: 1 | -1, col: RGBA): void {
  g.poly(poly.map(([l, h]) => pt(f, l, h)), null, col, [f.tangent.x * facing, f.tangent.y * facing, f.tangent.z * facing]);
}

/** Jersey barrier faces, from the inner base out: [out, up]. */
const JERSEY: [number, number][] = [[0, 0], [0.06, 0.08], [0.2, 0.33], [0.4, 0.85], [0.6, 0.85]];
const BAR_H = 0.85;
const BAR_W = 0.6;
/** A barrier on the right edge at base b (inner face toward −lateral), outer top first. */
const barR = (b: number): Prof => JERSEY.slice().reverse().map(([o, h]) => [b + o, h] as [number, number]);
/** On the left edge at base b, inner base first. */
const barL = (b: number): Prof => JERSEY.map(([o, h]) => [b - o, h] as [number, number]);
/** The cross-section of a barrier's end: a polygon from its outer foot round. */
const barCap = (b: number, side: 1 | -1, bottom = 0): Prof => [[b + side * BAR_W, bottom], ...JERSEY.slice().reverse().map(([o, h]) => [b + side * o, h] as [number, number]), [b, bottom]];

/** Lay a world-space quad flat at y, its texture in world metres. */
function flatQuad(g: Geo, c: [number, number][], y: number, col: RGBA, tile: number): void {
  g.poly(c.map(([x, z]) => [x, y, z] as V3), tile ? c.map(([x, z]) => [x / tile, -z / tile] as [number, number]) : null, col, UP);
}

/** A painted stroke on the ground between two world points. */
function stroke(g: Geo, ax: number, az: number, bx: number, bz: number, w: number, y: number, col: RGBA): void {
  const l = Math.hypot(bx - ax, bz - az) || 1;
  const px = (-(bz - az) / l) * (w / 2);
  const pz = ((bx - ax) / l) * (w / 2);
  g.poly([[ax + px, y, az + pz], [bx + px, y, bz + pz], [bx - px, y, bz - pz], [ax - px, y, az - pz]], null, col, UP);
}

/** Bake light into vertex colours for the unlit far stuff (Level 8's trick). */
function bakeShade(geo: THREE.BufferGeometry, tint: [number, number, number] = [1, 1, 1]): void {
  const n = geo.attributes.normal;
  const c = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const nx = n.getX(i);
    const ny = n.getY(i);
    const nz = n.getZ(i);
    const s = 0.56 + 0.44 * Math.max(0, nx * SUN_DIR.x + ny * SUN_DIR.y + nz * SUN_DIR.z) + 0.1 * ny;
    c[i * 3] = tint[0] * s;
    c[i * 3 + 1] = tint[1] * s;
    c[i * 3 + 2] = tint[2] * s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

// ---------------------------------------------------------------- clearance

/** Corridors nothing may stand in: segments with a half-width, hashed on a grid. */
class Clear {
  private grid = new Map<number, number[]>();
  private segs: number[] = [];
  private static CELL = 40;
  private static key(cx: number, cz: number): number {
    return (cx + 2000) * 8192 + (cz + 2000);
  }
  add(pts: [number, number][], half: number): void {
    const C = Clear.CELL;
    for (let i = 0; i < pts.length - 1; i++) {
      const id = this.segs.length / 5;
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      this.segs.push(x0, z0, x1, z1, half);
      const m = half + 6;
      for (let cx = Math.floor((Math.min(x0, x1) - m) / C); cx <= Math.floor((Math.max(x0, x1) + m) / C); cx++) {
        for (let cz = Math.floor((Math.min(z0, z1) - m) / C); cz <= Math.floor((Math.max(z0, z1) + m) / C); cz++) {
          const k = Clear.key(cx, cz);
          const l = this.grid.get(k);
          if (l) l.push(id);
          else this.grid.set(k, [id]);
        }
      }
    }
  }
  addChain(ch: Chain, s0: number, s1: number, half: number, lat = 0, every = 4): void {
    const pts: [number, number][] = [];
    for (let s = s0; s < s1; s += every) {
      const f = ch.at(s);
      pts.push([f.pos.x + f.right.x * lat, f.pos.z + f.right.z * lat]);
    }
    const f = ch.at(s1);
    pts.push([f.pos.x + f.right.x * lat, f.pos.z + f.right.z * lat]);
    this.add(pts, half);
  }
  blocked(x: number, z: number, pad = 0): boolean {
    const l = this.grid.get(Clear.key(Math.floor(x / Clear.CELL), Math.floor(z / Clear.CELL)));
    if (!l) return false;
    const s = this.segs;
    for (const id of l) {
      const o = id * 5;
      const ax = s[o];
      const az = s[o + 1];
      const dx = s[o + 2] - ax;
      const dz = s[o + 3] - az;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2));
      const ex = ax + dx * t - x;
      const ez = az + dz * t - z;
      const h = s[o + 4] + pad;
      if (ex * ex + ez * ez < h * h) return true;
    }
    return false;
  }
}

/** A building's footprint, an oriented rectangle. */
interface Foot {
  x: number;
  z: number;
  ax: [number, number];
  az: [number, number];
  hx: number;
  hz: number;
}
function overlaps(a: Foot, b: Foot, m: number): boolean {
  const axes = [a.ax, a.az, b.ax, b.az];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const L of axes) {
    const d = Math.abs(dx * L[0] + dz * L[1]);
    const ra = (a.hx + m) * Math.abs(a.ax[0] * L[0] + a.ax[1] * L[1]) + (a.hz + m) * Math.abs(a.az[0] * L[0] + a.az[1] * L[1]);
    const rb = b.hx * Math.abs(b.ax[0] * L[0] + b.ax[1] * L[1]) + b.hz * Math.abs(b.az[0] * L[0] + b.az[1] * L[1]);
    if (d > ra + rb) return false;
  }
  return true;
}

// ---------------------------------------------------------------- textures

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function tiling(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function once(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A seamless noise tile, as Level 8 makes its ground (seeded here, so the street looks the same every run). */
function noiseTile(
  size: number,
  base: [number, number, number],
  o: { fine: number; blobs?: number; blobAmp?: number; tint?: [number, number, number]; specks?: number; speckAmp?: number; seed?: number }
): HTMLCanvasElement {
  const rnd = lcg(o.seed ?? 7);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const d = img.data;
  const low = new Float32Array(size * size);
  for (let b = 0; b < (o.blobs ?? 0); b++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const r = size * (0.06 + rnd() * 0.18);
    const a = (rnd() - 0.5) * 2 * (o.blobAmp ?? 0);
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const q = ((x - cx) * (x - cx) + (y - cy) * (y - cy)) / r2;
        if (q >= 1) continue;
        const wx = ((x % size) + size) % size;
        const wy = ((y % size) + size) % size;
        low[wy * size + wx] += a * (1 - q) * (1 - q);
      }
    }
  }
  const tint = o.tint ?? [1, 1, 1];
  for (let i = 0; i < size * size; i++) {
    let v = (rnd() - 0.5) * o.fine;
    if (o.specks && rnd() < o.specks) v += (rnd() - 0.35) * (o.speckAmp ?? 30);
    const l = low[i];
    d[i * 4] = base[0] + v + l * tint[0];
    d[i * 4 + 1] = base[1] + v + l * tint[1];
    d[i * 4 + 2] = base[2] + v + l * tint[2];
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function asphaltCanvas(): HTMLCanvasElement {
  const c = noiseTile(512, [99, 102, 106], { fine: 16, blobs: 30, blobAmp: 9, specks: 0.022, speckAmp: 46, seed: 11 });
  const g = c.getContext('2d')!;
  const rnd = lcg(5);
  g.strokeStyle = 'rgba(38,40,43,0.55)';
  g.lineWidth = 1.4;
  for (let i = 0; i < 5; i++) {
    let x = 70 + rnd() * 370;
    let y = 70 + rnd() * 370;
    let a = rnd() * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 14; s++) {
      a += (rnd() - 0.5) * 0.9;
      x = Math.min(500, Math.max(12, x + Math.cos(a) * 6));
      y = Math.min(500, Math.max(12, y + Math.sin(a) * 6));
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return c;
}

/** The footpath: 1.2 m flags. 256 px is 2.4 m. */
function flagsCanvas(): HTMLCanvasElement {
  const c = noiseTile(256, [158, 156, 149], { fine: 12, blobs: 10, blobAmp: 7, seed: 13 });
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(96,94,88,0.85)';
  for (const p of [0, 128]) {
    g.fillRect(p, 0, 2, 256);
    g.fillRect(0, p, 256, 2);
  }
  return c;
}

/** The apron: 5 m concrete slabs with their joints, a few stains. 256 px is one slab. */
function slabCanvas(): HTMLCanvasElement {
  const c = noiseTile(256, [178, 176, 168], { fine: 10, blobs: 14, blobAmp: 7, seed: 17 });
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(92,90,84,0.9)';
  g.fillRect(0, 0, 3, 256);
  g.fillRect(0, 0, 256, 3);
  g.fillStyle = 'rgba(70,66,60,0.12)';
  g.beginPath();
  g.ellipse(150, 120, 40, 22, 0.4, 0, Math.PI * 2);
  g.fill();
  return c;
}

function chainLinkCanvas(): HTMLCanvasElement {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(200,206,210,1)';
  g.lineWidth = 2.2;
  for (let k = -64; k <= 128; k += 16) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 64, 64);
    g.stroke();
    g.beginPath();
    g.moveTo(k, 64);
    g.lineTo(k + 64, 0);
    g.stroke();
  }
  return c;
}

function stripesCanvas(): HTMLCanvasElement {
  const c = makeCanvas(256, 16);
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#ecebe6' : '#c4232b';
    g.fillRect(i * 32, 0, 32, 16);
  }
  return c;
}

function skyCanvas(): HTMLCanvasElement {
  const c = makeCanvas(16, 256);
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4f7ab0');
  grad.addColorStop(0.3, '#7fa3cc');
  grad.addColorStop(0.44, '#a9c2db');
  grad.addColorStop(0.5, '#dcd6c6');
  grad.addColorStop(0.56, '#c8c2b0');
  grad.addColorStop(1, '#6d7a5a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  return c;
}

function sunCanvas(): HTMLCanvasElement {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,252,240,1)');
  grad.addColorStop(0.1, 'rgba(255,246,222,0.95)');
  grad.addColorStop(0.18, 'rgba(255,232,190,0.4)');
  grad.addColorStop(0.45, 'rgba(255,220,170,0.1)');
  grad.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/** Soft shapes for what only darkens the ground: a blot, and a band soft only at its two long edges. */
function softCanvas(): HTMLCanvasElement {
  const c = makeCanvas(128, 64);
  const g = c.getContext('2d')!;
  const img = g.createImageData(128, 64);
  const d = img.data;
  const sstep = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 128; x++) {
      let a = 0;
      if (x < 64) {
        const r = Math.hypot(x + 0.5 - 32, y + 0.5 - 32) / 31;
        a = r < 1 ? Math.pow(1 - r * r, 1.6) : 0;
      } else {
        const lx = x - 64 + 0.5;
        a = sstep(0, 7, Math.min(lx, 64 - lx));
      }
      const i = (y * 128 + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
const SOFT = { disc: [0.004, 0.496], band: [0.504, 0.996] } as const;

function glassCanvas(): HTMLCanvasElement {
  const c = makeCanvas(32, 256);
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#aec6dc');
  grad.addColorStop(0.4, '#8ba7c1');
  grad.addColorStop(0.72, '#6c849b');
  grad.addColorStop(1, '#4a5866');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 256);
  g.fillStyle = 'rgba(235,242,248,0.12)';
  g.fillRect(0, 52, 32, 26);
  return c;
}

/** One bay and storey of an office or flats facade: 3.0 m by 3.5 m. */
function windowsCanvas(): HTMLCanvasElement {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d')!;
  g.fillStyle = '#e6e2da';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#cdc8be';
  g.fillRect(0, 114, 128, 14);
  const grad = g.createLinearGradient(0, 16, 0, 102);
  grad.addColorStop(0, '#9db3c7');
  grad.addColorStop(0.45, '#64798e');
  grad.addColorStop(1, '#3f4e5d');
  g.fillStyle = grad;
  g.fillRect(16, 16, 96, 86);
  g.fillStyle = 'rgba(225,232,238,0.18)';
  g.fillRect(16, 30, 96, 12);
  g.fillStyle = '#d4d8dc';
  g.fillRect(62, 16, 4, 86);
  g.fillRect(16, 54, 96, 3);
  g.fillStyle = '#b9b4aa';
  g.fillRect(12, 102, 104, 6);
  return c;
}

/** A shop front: 4 m by 4.2 m, its fascia, a big window and a door. */
function shopCanvas(): HTMLCanvasElement {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d')!;
  g.fillStyle = '#d7d0c4';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#8c7b66';
  g.fillRect(0, 0, 128, 24);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(0, 22, 128, 2);
  const grad = g.createLinearGradient(0, 30, 0, 124);
  grad.addColorStop(0, '#7c93a8');
  grad.addColorStop(0.5, '#4d5f70');
  grad.addColorStop(1, '#2e3a45');
  g.fillStyle = grad;
  g.fillRect(8, 32, 80, 88);
  g.fillStyle = '#343a40';
  g.fillRect(96, 40, 26, 88);
  g.fillStyle = '#9aa3aa';
  g.fillRect(118, 80, 2, 10);
  g.fillStyle = '#6a645c';
  g.fillRect(0, 120, 96, 8);
  return c;
}

// ---------------------------------------------------------------- signs

interface Region {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  aspect: number;
}

/** A small airliner seen from above, nose up. */
function drawPlane(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, colour: string): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(Math.PI / 4);
  g.fillStyle = colour;
  g.beginPath();
  g.ellipse(0, 0, s * 0.09, s * 0.5, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(-s * 0.06, -s * 0.08);
  g.lineTo(-s * 0.48, s * 0.12);
  g.lineTo(-s * 0.48, s * 0.2);
  g.lineTo(-s * 0.06, s * 0.08);
  g.lineTo(s * 0.06, s * 0.08);
  g.lineTo(s * 0.48, s * 0.2);
  g.lineTo(s * 0.48, s * 0.12);
  g.lineTo(s * 0.06, -s * 0.08);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(-s * 0.04, s * 0.36);
  g.lineTo(-s * 0.2, s * 0.48);
  g.lineTo(s * 0.2, s * 0.48);
  g.lineTo(s * 0.04, s * 0.36);
  g.closePath();
  g.fill();
  g.restore();
}

/** An arrow, pointing along `angle` (0 = right, −π/2 = up). */
function drawArrow(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, angle: number, colour: string): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(angle);
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(-s * 0.5, -s * 0.09);
  g.lineTo(s * 0.12, -s * 0.09);
  g.lineTo(s * 0.12, -s * 0.28);
  g.lineTo(s * 0.5, 0);
  g.lineTo(s * 0.12, s * 0.28);
  g.lineTo(s * 0.12, s * 0.09);
  g.lineTo(-s * 0.5, s * 0.09);
  g.closePath();
  g.fill();
  g.restore();
}

function text(g: CanvasRenderingContext2D, t: string, x: number, y: number, px: number, colour: string, bold = true, align: CanvasTextAlign = 'center'): void {
  g.fillStyle = colour;
  g.font = `${bold ? 'bold ' : ''}${px}px Arial, Helvetica, sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(t, x, y);
}

/** A word and the little plane after it, centred together on x. */
function planeText(g: CanvasRenderingContext2D, t: string, x: number, y: number, px: number, colour: string): void {
  g.font = `bold ${px}px Arial, Helvetica, sans-serif`;
  const tw = g.measureText(t).width;
  const gap = px * 0.25;
  const ps = px * 0.95;
  const total = tw + gap + ps;
  text(g, t, x - total / 2, y, px, colour, true, 'left');
  drawPlane(g, x - total / 2 + tw + gap + ps / 2, y, ps, colour);
}

function plate(g: CanvasRenderingContext2D, w: number, h: number, bg: string, border: string | null, rad = 0.06): void {
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    const i = Math.max(5, h * 0.035);
    g.strokeStyle = border;
    g.lineWidth = Math.max(4, h * 0.025);
    const r = h * rad;
    g.beginPath();
    g.roundRect(i, i, w - 2 * i, h - 2 * i, r);
    g.stroke();
  }
}

const GREEN = '#0f6b3c';
const SIGN_WHITE = '#f4f4ee';

/** Every sign, one canvas: one material and one draw for all of them. */
function signAtlas(): { canvas: HTMLCanvasElement; regions: Record<string, Region> } {
  const W = 2048;
  const H = 2048;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  const specs: { key: string; w: number; h: number; draw: (g: CanvasRenderingContext2D, w: number, h: number) => void }[] = [
    {
      key: 'g1',
      w: 1024,
      h: 448,
      draw: (g, w, h) => {
        plate(g, w, h, GREEN, SIGN_WHITE);
        planeText(g, 'AIRPORT', w / 2, 160, 160, SIGN_WHITE);
        text(g, 'EXIT 2 MI', w / 2, 330, 120, SIGN_WHITE);
      }
    },
    {
      key: 'g2',
      w: 1024,
      h: 512,
      draw: (g, w, h) => {
        plate(g, w, h, GREEN, SIGN_WHITE);
        text(g, 'EXIT 12', w - 190, 80, 66, SIGN_WHITE);
        g.fillStyle = SIGN_WHITE;
        g.fillRect(w - 340, 122, 300, 5);
        planeText(g, 'AIRPORT', w / 2, 250, 150, SIGN_WHITE);
        text(g, '1/2 MI', w / 2, 410, 110, SIGN_WHITE);
      }
    },
    {
      key: 'g3',
      w: 768,
      h: 384,
      draw: (g, w, h) => {
        plate(g, w, h, GREEN, SIGN_WHITE);
        text(g, 'EXIT', 230, 120, 110, SIGN_WHITE);
        text(g, '12', 230, 270, 160, SIGN_WHITE);
        drawArrow(g, 560, 200, 300, -Math.PI / 4, SIGN_WHITE);
      }
    },
    {
      key: 'g4',
      w: 768,
      h: 512,
      draw: (g, w, h) => {
        plate(g, w, h, GREEN, SIGN_WHITE);
        text(g, 'EXIT 12', w / 2, 80, 70, SIGN_WHITE);
        planeText(g, 'AIRPORT', w / 2, 220, 110, SIGN_WHITE);
        drawArrow(g, w / 2, 390, 170, Math.PI / 2, SIGN_WHITE);
      }
    },
    {
      key: 'g5',
      w: 896,
      h: 512,
      draw: (g, w, h) => {
        plate(g, w, h, '#f08a24', '#111111');
        text(g, '9 EAST', w / 2, 100, 100, '#111111');
        text(g, 'ROAD CLOSED', w / 2, 250, 110, '#111111');
        text(g, '1/4 MI', w / 2, 400, 100, '#111111');
      }
    },
    {
      key: 'hwy',
      w: 896,
      h: 448,
      draw: (g, w, h) => {
        plate(g, w, h, GREEN, SIGN_WHITE);
        text(g, '9 EAST', w / 2 - 80, 120, 130, SIGN_WHITE);
        planeText(g, 'AIRPORT', w / 2 - 70, 300, 100, SIGN_WHITE);
        drawArrow(g, w - 130, 140, 170, -Math.PI / 4, SIGN_WHITE);
      }
    },
    {
      key: 'closed',
      w: 768,
      h: 256,
      draw: (g, w, h) => {
        plate(g, w, h, '#f2f1ec', '#111111');
        text(g, 'ROAD CLOSED', w / 2, h / 2 + 4, 120, '#111111');
      }
    },
    {
      key: 'work',
      w: 256,
      h: 256,
      draw: (g, w, h) => {
        g.save();
        g.translate(w / 2, h / 2);
        g.rotate(Math.PI / 4);
        g.fillStyle = '#111111';
        g.fillRect(-88, -88, 176, 176);
        g.fillStyle = '#f08a24';
        g.fillRect(-82, -82, 164, 164);
        g.restore();
        text(g, 'ROAD', w / 2, 92, 34, '#111111');
        text(g, 'WORK', w / 2, 130, 34, '#111111');
        text(g, 'AHEAD', w / 2, 168, 34, '#111111');
      }
    },
    ...[35, 45, 65, 40].map((n) => ({
      key: `sl${n}`,
      w: 192,
      h: 256,
      draw: (g: CanvasRenderingContext2D, w: number, h: number) => {
        plate(g, w, h, '#f4f4ee', '#111111', 0.04);
        text(g, 'SPEED', w / 2, 48, 40, '#111111');
        text(g, 'LIMIT', w / 2, 92, 40, '#111111');
        text(g, String(n), w / 2, 178, 104, '#111111');
      }
    })),
    {
      key: 'airport',
      w: 1024,
      h: 320,
      draw: (g, w, h) => {
        plate(g, w, h, '#1d4f91', SIGN_WHITE);
        drawPlane(g, 150, h / 2, 190, SIGN_WHITE);
        text(g, 'AIRPORT', 600, 110, 120, SIGN_WHITE);
        text(g, 'PRIVATE AVIATION', 600, 228, 72, SIGN_WHITE);
      }
    },
    {
      key: 'fbo',
      w: 1024,
      h: 160,
      draw: (g, w, h) => {
        plate(g, w, h, '#1b2740', null);
        text(g, 'EXECUTIVE JET CENTER', w / 2, h / 2 + 3, 76, '#f2f0ea');
        g.fillStyle = '#e8b04a';
        g.fillRect(40, h - 26, w - 80, 6);
      }
    },
    {
      key: 'hangar',
      w: 512,
      h: 128,
      draw: (g, w, h) => {
        plate(g, w, h, '#2b3440', null);
        text(g, 'HANGAR 3', w / 2, h / 2 + 3, 84, '#f2f0ea');
      }
    },
    {
      key: 'gate',
      w: 512,
      h: 320,
      draw: (g, w, h) => {
        plate(g, w, h, '#f4f4ee', '#b01e23');
        g.fillStyle = '#b01e23';
        g.fillRect(0, 0, w, 130);
        text(g, 'STOP', w / 2, 70, 104, SIGN_WHITE);
        text(g, 'SECURITY CHECK', w / 2, 180, 48, '#111111');
        text(g, 'AUTHORIZED VEHICLES ONLY', w / 2, 250, 32, '#111111');
      }
    },
    {
      key: 'company',
      w: 1024,
      h: 96,
      draw: (g, w, h) => {
        plate(g, w, h, '#1b2740', null);
        g.fillStyle = '#e8792b';
        g.beginPath();
        g.arc(70, h / 2, 34, 0, Math.PI * 2);
        g.fill();
        text(g, 'RAVI-CALL SYSTEMS', w / 2 + 40, h / 2 + 3, 66, '#f2f0ea');
      }
    },
    {
      key: 'staff',
      w: 384,
      h: 256,
      draw: (g, w, h) => {
        plate(g, w, h, '#f2f1ec', '#1b2740');
        text(g, 'STAFF PARKING', w / 2, 50, 46, '#1b2740');
        text(g, 'RAVI-CALL SYSTEMS', w / 2, 104, 32, '#e8792b');
        text(g, 'PERMIT HOLDERS ONLY', w / 2, 156, 28, '#1b2740');
        text(g, 'Exit — turn right only', w / 2, 206, 22, '#555b63', false);
      }
    },
    ...['OAK ST', 'PINE ST', 'ELM ST', 'BAY ST'].map((n, i) => ({
      key: `st${i + 1}`,
      w: 384,
      h: 96,
      draw: (g: CanvasRenderingContext2D, w: number, h: number) => {
        plate(g, w, h, GREEN, SIGN_WHITE, 0.1);
        text(g, n, w / 2, h / 2 + 2, 58, SIGN_WHITE);
      }
    })),
    {
      key: 'stripes',
      w: 512,
      h: 64,
      draw: (g, w, h) => {
        g.fillStyle = '#f4f4ee';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#f0781e';
        for (let x = -64; x < w + 64; x += 64) {
          g.beginPath();
          g.moveTo(x, h);
          g.lineTo(x + 32, h);
          g.lineTo(x + 32 + h, 0);
          g.lineTo(x + h, 0);
          g.closePath();
          g.fill();
        }
      }
    },
    {
      key: 'chev',
      w: 256,
      h: 256,
      draw: (g, w, h) => {
        g.fillStyle = '#f2c21b';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#151515';
        for (let y = -64; y < h + 64; y += 64) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w / 2, y + 48);
          g.lineTo(w, y);
          g.lineTo(w, y + 26);
          g.lineTo(w / 2, y + 74);
          g.lineTo(0, y + 26);
          g.closePath();
          g.fill();
        }
      }
    },
    {
      key: 'grey',
      w: 64,
      h: 64,
      draw: (g, w, h) => {
        g.fillStyle = '#8e9399';
        g.fillRect(0, 0, w, h);
      }
    }
  ];
  // Shelf-packed tallest first; the big guide signs drawn at 3/4 size, and
  // everything shrunk a little more if it still would not fit
  const big = new Set(['g1', 'g2', 'g4', 'g5', 'hwy', 'airport', 'g3', 'closed']);
  const order = specs.slice().sort((a, b) => b.h - a.h);
  const pad = 12;
  const pack = (k: number): Map<string, [number, number, number, number]> | null => {
    const out = new Map<string, [number, number, number, number]>();
    let x = pad;
    let y = pad;
    let rowH = 0;
    for (const s of order) {
      const f = k * (big.has(s.key) ? 0.75 : 1);
      const w = Math.ceil(s.w * f);
      const h = Math.ceil(s.h * f);
      if (x + w + pad > W) {
        x = pad;
        y += rowH + pad;
        rowH = 0;
      }
      if (y + h + pad > H) return null;
      out.set(s.key, [x, y, w, h]);
      x += w + pad;
      rowH = Math.max(rowH, h);
    }
    return out;
  };
  let k = 1;
  let placed = pack(k);
  while (!placed) {
    k *= 0.92;
    placed = pack(k);
  }
  const regions: Record<string, Region> = {};
  for (const s of specs) {
    const [x, y, w, h] = placed.get(s.key)!;
    g.save();
    g.translate(x, y);
    g.scale(w / s.w, h / s.h);
    g.beginPath();
    g.rect(0, 0, s.w, s.h);
    g.clip();
    s.draw(g, s.w, s.h);
    g.restore();
    // A little inside the edges: no bleed from the neighbour at a distance
    regions[s.key] = { u0: (x + 1.5) / W, u1: (x + w - 1.5) / W, v1: 1 - (y + 1.5) / H, v0: 1 - (y + h - 1.5) / H, aspect: s.w / s.h };
  }
  return { canvas: c, regions };
}

// ---------------------------------------------------------------- materials

interface Mats {
  asphalt: THREE.MeshLambertMaterial;
  paint: THREE.MeshLambertMaterial;
  conc: THREE.MeshLambertMaterial;
  walk: THREE.MeshLambertMaterial;
  grass: THREE.MeshLambertMaterial;
  apron: THREE.MeshLambertMaterial;
  win: THREE.MeshLambertMaterial;
  shop: THREE.MeshLambertMaterial;
  props: THREE.MeshLambertMaterial;
  glow: THREE.MeshBasicMaterial;
  sign: THREE.MeshLambertMaterial;
  fence: THREE.MeshLambertMaterial;
  glass: THREE.MeshBasicMaterial;
  soft: THREE.MeshBasicMaterial;
  skyline: THREE.MeshBasicMaterial;
  trunk: THREE.MeshBasicMaterial;
  crown: THREE.MeshBasicMaterial;
  stripes: THREE.MeshLambertMaterial;
  sky: THREE.MeshBasicMaterial;
  sun: THREE.MeshBasicMaterial;
  regions: Record<string, Region>;
}

let shared: Mats | null = null;

/** Made once and kept, as Level 8 does: a chase gets restarted a lot. */
function mats(): Mats {
  if (shared) return shared;
  const atlas = signAtlas();
  const atlasTex = once(atlas.canvas);
  const winTex = tiling(windowsCanvas());
  shared = {
    asphalt: new THREE.MeshLambertMaterial({ map: tiling(asphaltCanvas()), vertexColors: true }),
    paint: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    conc: new THREE.MeshLambertMaterial({ map: tiling(noiseTile(128, [176, 173, 166], { fine: 10, blobs: 8, blobAmp: 7, seed: 19 })), vertexColors: true }),
    walk: new THREE.MeshLambertMaterial({ map: tiling(flagsCanvas()) }),
    // Pushed back in depth: everything else lies on it
    grass: new THREE.MeshLambertMaterial({
      map: tiling(noiseTile(256, [84, 108, 62], { fine: 22, blobs: 26, blobAmp: 14, tint: [0.7, 1, 0.5], seed: 23 })),
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 4
    }),
    apron: new THREE.MeshLambertMaterial({ map: tiling(slabCanvas()), vertexColors: true }),
    win: new THREE.MeshLambertMaterial({ map: winTex, vertexColors: true }),
    shop: new THREE.MeshLambertMaterial({ map: tiling(shopCanvas()), vertexColors: true }),
    props: new THREE.MeshLambertMaterial({ vertexColors: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    // Lit a little from within, so a sign in its own shade still reads
    sign: new THREE.MeshLambertMaterial({
      map: atlasTex,
      emissive: 0xffffff,
      emissiveMap: atlasTex,
      emissiveIntensity: 0.3,
      alphaTest: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2
    }),
    fence: new THREE.MeshLambertMaterial({ map: tiling(chainLinkCanvas()), transparent: true, alphaTest: 0.05, side: THREE.DoubleSide }),
    glass: new THREE.MeshBasicMaterial({ map: once(glassCanvas()), vertexColors: true }),
    soft: new THREE.MeshBasicMaterial({
      color: 0x0b0e12,
      map: once(softCanvas()),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2
    }),
    skyline: new THREE.MeshBasicMaterial({ map: winTex, vertexColors: true }),
    trunk: new THREE.MeshBasicMaterial({ vertexColors: true }),
    crown: new THREE.MeshBasicMaterial({ vertexColors: true }),
    stripes: new THREE.MeshLambertMaterial({ map: once(stripesCanvas()) }),
    sky: new THREE.MeshBasicMaterial({ map: once(skyCanvas()), side: THREE.BackSide, fog: false, depthWrite: false }),
    sun: new THREE.MeshBasicMaterial({
      map: once(sunCanvas()),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      side: THREE.DoubleSide
    }),
    regions: atlas.regions
  };
  return shared;
}

// ---------------------------------------------------------------- palette

const C = {
  asphalt: rgba(0xc4c6c8),
  asphaltDark: rgba(0xa9abae),
  asphaltPale: rgba(0xe2e0da),
  pad: rgba(0xc9c8c4),
  yard: rgba(0xe4e2dc),
  lot: rgba(0xd2d2d0),
  conc: rgba(0xe2e0da),
  concDark: rgba(0xc9c6bf),
  underside: [2.3, 2.25, 2.15, 1] as RGBA,
  kerb: rgba(0xd8d5ce),
  white: rgba(0xe8e6de),
  yellow: rgba(0xe0b030),
  galv: rgba(0x9aa1a6),
  dark: rgba(0x2a2d31),
  black: rgba(0x18191b),
  lens: rgba(0xd9dde0),
  orange: rgba(0xe8691c),
  hiViz: rgba(0xf2c21b),
  red: rgba(0xff3b30),
  green: rgba(0x3cff7a),
  amberOff: rgba(0x4a3a12),
  redOff: rgba(0x3d1412),
  greenOff: rgba(0x113a20),
  runway: rgba(0x8a8c90),
  blueLight: rgba(0x3d6bff),
  whiteLight: rgba(0xfff6dc)
};

const FACADES = [0xd9d3c7, 0xc9bfae, 0xb9b2a6, 0xa7adb3, 0xd2c2a8, 0xbfa58a, 0x9fa9b2, 0xcfcac0, 0xb48f72, 0x8f9aa3, 0xc4b8a0, 0xa69a8c];

// ---------------------------------------------------------------- builder

/**
 * StreetBuilder — Map 10's route as one continuous drive (see the top of
 * this file), and everything static along it: the city, the decks and their
 * pillars, the signs, the closure, the airport.
 *
 * Draw calls are kept to a couple of dozen by building everything straight
 * into one geometry per material (Geo): the road surfaces, the paint, all the
 * concrete, every prop in one vertex-coloured mesh, every sign in one atlas.
 * The far scenery and trees are unlit colour, as in Level 8.
 */
export class StreetBuilder {
  private group = new THREE.Group();
  private m!: Mats;
  private r!: Route;
  private asph = new Geo();
  private paint = new Geo();
  private conc = new Geo();
  private walk = new Geo();
  private grass = new Geo();
  private apron = new Geo();
  private win = new Geo();
  private shop = new Geo();
  private props = new Geo();
  private glow = new Geo();
  private sign = new Geo();
  private fence = new Geo();
  private glass = new Geo();
  private soft = new Geo();
  private skyline: THREE.BufferGeometry[] = [];
  private treeSpots: { x: number; y: number; z: number; s: number }[] = [];
  private blockers: StreetBlocker[] = [];
  /** Where nothing may be built: every road and deck. */
  private clear = new Clear();
  /** Ground-level roads only: where a pillar may not stand. */
  private groundRoads = new Clear();
  private feet: Foot[] = [];
  private airport!: StreetData['airport'];
  private gateFrame!: { x: number; z: number; f: [number, number]; r: [number, number]; yaw: number };

  build(): StreetData {
    this.m = mats();
    this.r = buildRoute();
    this.setupClearance();
    this.buildGround();
    this.buildCity();
    this.buildCrossStreets();
    this.buildCityProps();
    this.buildLot();
    this.buildRamp();
    this.buildHighway();
    this.buildHighwayProps();
    this.buildClosure();
    this.buildExit();
    this.buildAirportRoad();
    this.buildAirport();
    this.buildUnderRoads();
    this.buildCityBlocks();
    this.buildOutskirts();
    this.buildSkyline();
    this.buildTrees();
    this.buildSky();
    this.buildLighting();
    this.finish();

    const r = this.r;
    const hw = r.hwVis.at(COP_S);
    const copYaw = yawOf(hw.tangent) + 0.12;
    return {
      group: this.group,
      roads: r.roads,
      blockers: this.blockers,
      start: { civic: { road: 'city', s: 12, d: 5.4 }, boss: { road: 'city', s: 57, d: 1.8 } },
      cop: { pos: V(hw.pos.x + hw.right.x * 3.7, DECK, hw.pos.z + hw.right.z * 3.7), yaw: copYaw, s: COP_S },
      exitS: EXIT_S,
      missedExitS: MISSED_S,
      airport: this.airport,
      sunDir: SUN_DIR.clone()
    };
  }

  // ------------------------------------------------------------ clearance

  private setupClearance(): void {
    const r = this.r;
    const c = this.clear;
    const g = this.groundRoads;
    c.addChain(r.cityVis, r.cityVis.s0, r.cityVis.s1, WALK_OUT + 0.4);
    g.addChain(r.cityVis, r.cityVis.s0, r.cityVis.s1, WALK_OUT + 1.5);
    c.addChain(r.ramp, 0, r.ramp.s1, 10);
    g.addChain(r.ramp, 0, 80, 9);
    c.addChain(r.hwVis, r.hwVis.s0, r.hwVis.s1, 22, -10.1, 6);
    c.addChain(r.exit, 0, r.exit.s1, 10);
    g.addChain(r.exit, 240, r.exit.s1, 8);
    c.addChain(r.air, 0, r.air.s1, 13);
    g.addChain(r.air, 0, r.air.s1, 9);
    for (const ch of this.crossChains()) {
      c.addChain(ch, 0, ch.s1, CROSS_WALK + 0.6);
      g.addChain(ch, 0, ch.s1, CROSS_WALK + 1.5);
    }
    for (const ch of this.underChains()) {
      c.addChain(ch, ch.s0, ch.s1, 8);
      g.addChain(ch, ch.s0, ch.s1, 7);
    }
    // The gate frame, for everything at the airport
    const end = r.roads.airport.samples[r.roads.airport.samples.length - 1];
    const t = end.tangent;
    this.gateFrame = { x: end.pos.x, z: end.pos.z, f: [t.x, t.z], r: [-t.z, t.x], yaw: yawOf(t) };
  }

  private crossCache: Chain[] | null = null;
  /** The cross streets, each side of the avenue, outward from its kerb. */
  private crossChains(): Chain[] {
    if (this.crossCache) return this.crossCache;
    const out: Chain[] = [];
    for (const si of CROSS) {
      const f = this.r.cityVis.at(si);
      const yaw = yawOf(f.tangent);
      for (const side of [1, -1]) {
        const x = f.pos.x + f.right.x * side * CITY_HALF;
        const z = f.pos.z + f.right.z * side * CITY_HALF;
        const poses = trace({ x, z, yaw: yaw - (side * Math.PI) / 2 }, [{ len: 300, turn: 0 }]);
        out.push(new Chain(resample(poses.map((p) => ({ x: p.x, y: 0, z: p.z, hl: CROSS_HALF, hr: CROSS_HALF, tag: 0 }))).samples));
      }
    }
    this.crossCache = out;
    return out;
  }

  private underCache: Chain[] | null = null;
  /** Two country roads that pass under the highway, for something to see down there. */
  private underChains(): Chain[] {
    if (this.underCache) return this.underCache;
    const out: Chain[] = [];
    for (const u of [300, 980]) {
      const f = this.r.hwVis.at(u);
      const yaw = yawOf(f.tangent) - Math.PI / 2;
      const poses = trace({ x: f.pos.x - fx(yaw) * 350, z: f.pos.z - fz(yaw) * 350, yaw }, [{ len: 700, turn: 0 }]);
      const ch = new Chain(resample(poses.map((p) => ({ x: p.x, y: 0, z: p.z, hl: 4.5, hr: 4.5, tag: 0 }))).samples);
      out.push(ch);
    }
    this.underCache = out;
    return out;
  }

  /** In the gate frame: a metres past the gate, b to the right of the road's line. */
  private ap(a: number, b: number): [number, number] {
    const G = this.gateFrame;
    return [G.x + G.f[0] * a + G.r[0] * b, G.z + G.f[1] * a + G.r[1] * b];
  }
  private toGate(x: number, z: number): [number, number] {
    const G = this.gateFrame;
    const dx = x - G.x;
    const dz = z - G.z;
    return [dx * G.f[0] + dz * G.f[1], dx * G.r[0] + dz * G.r[1]];
  }
  private inAirport(x: number, z: number, m = 0): boolean {
    const [a, b] = this.toGate(x, z);
    return a > -12 - m && a < 540 + m && b > -780 - m && b < 980 + m;
  }

  /** Room for a footprint: off every road and deck, clear of the airport and of what's built. */
  private place(f: Foot, margin: number, extra = 0): boolean {
    const pts: [number, number][] = [];
    const nx = Math.max(1, Math.ceil((f.hx * 2) / 8));
    const nz = Math.max(1, Math.ceil((f.hz * 2) / 8));
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const a = -f.hx + (2 * f.hx * i) / nx;
        const b = -f.hz + (2 * f.hz * j) / nz;
        pts.push([f.x + f.ax[0] * a + f.az[0] * b, f.z + f.ax[1] * a + f.az[1] * b]);
      }
    }
    for (const [x, z] of pts) {
      if (this.clear.blocked(x, z, extra)) return false;
      if (this.inAirport(x, z, 10)) return false;
    }
    for (const o of this.feet) if (overlaps(f, o, margin)) return false;
    this.feet.push(f);
    return true;
  }

  private block(cx: number, cz: number, yaw: number, halfX: number, halfZ: number, minY: number, maxY: number): void {
    this.blockers.push({ centre: V(cx, (minY + maxY) / 2, cz), halfX, halfZ, yaw, minY, maxY });
  }

  // ---------------------------------------------------------------- ground

  /** Grass under the whole map, a little below everything that lies on it. */
  private buildGround(): void {
    flatQuad(this.grass, [[-1400, -1800], [-1400, 1000], [3200, 1000], [3200, -1800]], GROUND, WHITE, 6);
  }

  // ------------------------------------------------------------------ city

  /** Free stretches of the avenue between the intersection boxes. */
  private cityFree(margin: number): [number, number][] {
    const out: [number, number][] = [];
    let a = this.r.cityVis.s0;
    for (const si of CROSS) {
      if (si - margin > a) out.push([a, si - margin]);
      a = si + margin;
    }
    if (CITY_LEN > a) out.push([a, CITY_LEN]);
    return out;
  }

  /**
   * A kerbed footpath along one side of a road, inner (the kerb line) to
   * outer, from s a to b; capped at both ends. `walk` false: the kerb alone.
   */
  private footpath(ch: Chain, a: number, b: number, side: 1 | -1, inner: (f: RoadSample) => number, outer: number, walk = true): void {
    const frs = ch.span(a, b);
    const k = 0.2;
    const lo = GROUND + 0.05;
    const o = walk ? outer : 0;
    if (side > 0) {
      extrude(this.conc, frs, (i) => [[inner(frs[i]), WALK], [inner(frs[i]), lo]], C.kerb, 1.2);
      extrude(this.conc, frs, (i) => [[inner(frs[i]) + k, WALK], [inner(frs[i]), WALK]], C.kerb, 1.2);
      if (walk) {
        extrude(this.walk, frs, (i) => [[o, WALK], [inner(frs[i]) + k, WALK]], WHITE, 2.4, true);
        extrude(this.conc, frs, () => [[o, lo], [o, WALK]], C.kerb, 1.2);
      } else extrude(this.conc, frs, (i) => [[inner(frs[i]) + k, lo], [inner(frs[i]) + k, WALK]], C.kerb, 1.2);
    } else {
      extrude(this.conc, frs, (i) => [[-inner(frs[i]), lo], [-inner(frs[i]), WALK]], C.kerb, 1.2);
      extrude(this.conc, frs, (i) => [[-inner(frs[i]), WALK], [-inner(frs[i]) - k, WALK]], C.kerb, 1.2);
      if (walk) {
        extrude(this.walk, frs, (i) => [[-inner(frs[i]) - k, WALK], [-o, WALK]], WHITE, 2.4, true);
        extrude(this.conc, frs, () => [[-o, WALK], [-o, lo]], C.kerb, 1.2);
      } else extrude(this.conc, frs, (i) => [[-inner(frs[i]) - k, WALK], [-inner(frs[i]) - k, lo]], C.kerb, 1.2);
    }
    for (const [f, facing] of [[frs[0], -1], [frs[frs.length - 1], 1]] as [RoadSample, 1 | -1][]) {
      const i0 = inner(f) * side;
      const i1 = (walk ? outer : inner(f) + k) * side;
      capAt(this.conc, f, [[i0, lo], [i1, lo], [i1, WALK], [i0, WALK]], facing, C.kerb);
    }
  }

  /** The avenue: its asphalt, footpaths, the blocks' paving, and its paint. */
  private buildCity(): void {
    const ch = this.r.cityVis;
    const all = ch.span(ch.s0, ch.s1);
    extrude(this.asph, all, () => [[CITY_HALF, 0], [-CITY_HALF, 0]], C.asphalt, 5, true);

    // Footpaths: broken for the cross streets, and on the right for the car park's driveway
    const ranges = this.cityFree(CROSS_HALF);
    for (const [a, b] of ranges) {
      const bb = Math.min(b, 635);
      if (bb - a < 0.5) continue;
      this.footpath(ch, a, bb, -1, () => CITY_HALF, WALK_OUT);
      if (a < LOT.gate0 && bb > LOT.gate1) {
        this.footpath(ch, a, LOT.gate0, 1, () => CITY_HALF, WALK_OUT);
        this.footpath(ch, LOT.gate1, bb, 1, () => CITY_HALF, WALK_OUT);
      } else this.footpath(ch, a, bb, 1, () => CITY_HALF, WALK_OUT);
    }
    // Past the last crossing the kerbs alone, on into the ramp's funnel
    this.footpath(ch, 645, CITY_LEN, 1, () => CITY_HALF, 0, false);
    this.footpath(ch, 645, CITY_LEN, -1, () => CITY_HALF, 0, false);

    // The blocks' paving behind the footpaths, out to the second row of buildings
    const padRun = (a: number, b: number, l0: number, l1: number, col: RGBA, y = PAD): void => {
      extrude(this.asph, ch.span(a, b), () => [[l1, y], [l0, y]], col, 5, true);
    };
    padRun(ch.s0, CITY_LEN, -130, -WALK_OUT, C.pad);
    padRun(ch.s0, LOT.s0, WALK_OUT, 130, C.pad);
    padRun(LOT.s1, CITY_LEN, WALK_OUT, 130, C.pad);
    padRun(LOT.s0, LOT.s1, LOT.lat1, 130, C.pad);

    // ---- Paint
    const p = this.paint;
    const Y = 0.02;
    const W = 0.12;
    for (const [a, b] of this.cityFree(9.5)) {
      for (const side of [1, -1]) {
        this.line(ch, a, b, () => side * 0.15, W, C.yellow, Y);
        this.line(ch, a, b, () => side * 7.2, W, C.white, Y);
        this.dashes(ch, a, b, () => side * 3.6, W, C.white, 3, 9, Y);
      }
    }
    for (const si of CROSS) {
      // Stop lines, and a zebra across the avenue either side of the box
      this.across(ch, si - 9.7, 0.3, 7.2, 0.45, C.white, Y);
      this.across(ch, si + 9.7, -7.2, -0.3, 0.45, C.white, Y);
      for (const s0 of [si - 9.2, si + 6.2]) {
        for (let l = -6.8; l <= 6.8; l += 1.0) {
          const f0 = ch.at(s0);
          const f1 = ch.at(s0 + 3);
          const a = pt(f0, l, Y);
          const b = pt(f1, l, Y);
          stroke(p, a[0], a[2], b[0], b[2], 0.5, a[1], C.white);
        }
      }
    }
  }

  /** A solid painted line along a chain, lateral lat(s), from a to b. */
  private line(ch: Chain, a: number, b: number, lat: (s: number) => number, w: number, col: RGBA, dy = 0.02): void {
    if (b - a < 0.05) return;
    const n = Math.max(1, Math.ceil((b - a) / 2));
    let fa = ch.at(a);
    let la = lat(a);
    for (let k = 1; k <= n; k++) {
      const s = a + ((b - a) * k) / n;
      const fb = ch.at(s);
      const lb = lat(s);
      this.paint.poly([pt(fa, la - w / 2, dy), pt(fa, la + w / 2, dy), pt(fb, lb + w / 2, dy), pt(fb, lb - w / 2, dy)], null, col, UP);
      fa = fb;
      la = lb;
    }
  }

  private dashes(ch: Chain, a: number, b: number, lat: (s: number) => number, w: number, col: RGBA, on: number, off: number, dy = 0.02): void {
    const P = on + off;
    for (let s = Math.floor(a / P) * P; s < b; s += P) {
      const s0 = Math.max(a, s);
      const s1 = Math.min(b, s + on);
      if (s1 > s0 + 0.2) this.line(ch, s0, s1, lat, w, col, dy);
    }
  }

  /** A bar across a road at s, from lateral l0 to l1. */
  private across(ch: Chain, s: number, l0: number, l1: number, w: number, col: RGBA, dy = 0.02): void {
    const f0 = ch.at(s - w / 2);
    const f1 = ch.at(s + w / 2);
    this.paint.poly([pt(f0, l0, dy), pt(f0, l1, dy), pt(f1, l1, dy), pt(f1, l0, dy)], null, col, UP);
  }

  private buildCrossStreets(): void {
    for (const ch of this.crossChains()) {
      const all = ch.span(0, ch.s1);
      extrude(this.asph, all, () => [[CROSS_HALF, 0], [-CROSS_HALF, 0]], C.asphalt, 5, true);
      // The far end, down to the grass
      capAt(this.asph, all[all.length - 1], [[-CROSS_HALF, GROUND], [CROSS_HALF, GROUND], [CROSS_HALF, 0], [-CROSS_HALF, 0]], 1, C.asphaltDark);
      const a = WALK_OUT - CITY_HALF;
      this.footpath(ch, a, ch.s1, 1, () => CROSS_HALF, CROSS_WALK);
      this.footpath(ch, a, ch.s1, -1, () => CROSS_HALF, CROSS_WALK);
      for (const side of [1, -1]) this.line(ch, 12, ch.s1, () => side * 0.15, 0.12, C.yellow);
      this.across(ch, 9, -4.8, -0.3, 0.45, C.white);
    }
  }

  // ------------------------------------------------------------ city props

  /** Street lamps, the traffic signals at each crossing, the speed limit and the ramp's sign. */
  private buildCityProps(): void {
    const ch = this.r.cityVis;
    const g = this.props;
    const near = (s: number, m: number): boolean => CROSS.some((si) => Math.abs(s - si) < m);
    // Lamps both sides, staggered; trees between them
    for (let s = -240; s < 632; s += 34) {
      for (const side of [1, -1]) {
        const ss = s + (side > 0 ? 0 : 17);
        if (near(ss, 12) || ss > 632) continue;
        if (side > 0 && ss > LOT.gate0 - 3 && ss < LOT.gate1 + 3) continue;
        this.streetLamp(ch.at(ss), side as 1 | -1);
        const ts = ss + 8.5;
        if (!near(ts, 13) && ts < 630 && !(side > 0 && ts > LOT.gate0 - 4 && ts < LOT.gate1 + 4)) {
          const f = ch.at(ts);
          const p = pt(f, side * 11.0, WALK);
          this.treeSpots.push({ x: p[0], y: WALK, z: p[2], s: 0.75 + ((ss * 7) % 10) / 40 });
        }
      }
    }
    // Signals: over our lanes from the far right corner, over the oncoming from the near left, red to the cross streets
    CROSS.forEach((si, n) => {
      const yaw = yawOf(ch.at(si).tangent);
      this.signalMast(ch.at(si + 7.6), 1, yaw, 'green', CROSS_NAMES[n]);
      this.signalMast(ch.at(si - 7.6), -1, yaw + Math.PI, 'green', CROSS_NAMES[n]);
      for (const [s, side, vy] of [[si - 7.6, 1, yaw + Math.PI / 2], [si + 7.6, -1, yaw - Math.PI / 2]] as [number, number, number][]) {
        const f = ch.at(s);
        const p = pt(f, side * 9.9, WALK);
        cylY(g, p[0], p[1], p[2], 0.11, 0.09, 3.6, 8, C.dark);
        this.signalHead(p[0] - fx(vy) * 0.3, p[1] + 3.0, p[2] - fz(vy) * 0.3, vy, 'red');
      }
    });
    // Speed limit up the avenue, and the ramp's sign at its end
    this.postSign(pt(ch.at(30), 9.6, WALK), yawOf(ch.at(30).tangent), 'sl35', 0.75, 2.1);
    this.postSign(pt(ch.at(560), 10.2, WALK), yawOf(ch.at(560).tangent), 'hwy', 3.2, 2.6, true);
  }

  private streetLamp(f: RoadSample, side: 1 | -1): void {
    const g = this.props;
    const b = pt(f, side * 11.9, WALK);
    cylY(g, b[0], b[1], b[2], 0.13, 0.08, 8.6, 8, C.galv);
    cylY(g, b[0], b[1], b[2], 0.2, 0.2, 0.5, 8, C.galv);
    const top = pt(f, side * 11.9, WALK + 8.45);
    const end = pt(f, side * 9.7, WALK + 8.75);
    beam(g, top, end, 0.09, 0.09, C.galv);
    const h = pt(f, side * 9.3, WALK + 8.7);
    const yaw = yawOf(f.tangent);
    boxAt(g, h[0], h[1] - 0.09, h[2], yaw, 0.9, 0.18, 0.36, C.dark);
    boxAt(g, h[0], h[1] - 0.12, h[2], yaw, 0.7, 0.04, 0.26, C.lens);
  }

  /** A signal mast on the corner, its arm over the lanes, two heads and the street's name. */
  private signalMast(f: RoadSample, side: 1 | -1, viewYaw: number, lit: 'red' | 'green', street: string): void {
    const g = this.props;
    const b = pt(f, side * 9.9, WALK);
    cylY(g, b[0], b[1], b[2], 0.16, 0.12, 7.2, 10, C.dark);
    const a0 = pt(f, side * 9.9, WALK + 6.7);
    const a1 = pt(f, side * 1.0, WALK + 6.7);
    beam(g, a0, a1, 0.16, 0.16, C.dark);
    beam(g, pt(f, side * 9.9, WALK + 5.6), pt(f, side * 6.5, WALK + 6.65), 0.06, 0.06, C.dark);
    for (const l of [2.0, 5.6]) {
      const h = pt(f, side * l, WALK + 6.0);
      this.signalHead(h[0], h[1], h[2], viewYaw, lit);
    }
    const s = pt(f, side * 7.9, WALK + 7.12);
    this.panel(s, viewYaw, 1.7, 0.42, street, 0.04);
  }

  /** Three lamps in a black housing, facing a driver heading viewYaw. */
  private signalHead(x: number, y: number, z: number, viewYaw: number, lit: 'red' | 'green'): void {
    const g = this.props;
    boxAt(g, x, y - 0.5, z, viewYaw, 0.36, 1.0, 0.3, C.black);
    const bx = -fx(viewYaw) * 0.02;
    const bz = -fz(viewYaw) * 0.02;
    boxAt(g, x - bx * 6, y - 0.62, z - bz * 6, viewYaw, 0.62, 1.24, 0.03, C.dark);
    const front = (k: number): [number, number] => [x - fx(viewYaw) * 0.16 * k, z - fz(viewYaw) * 0.16 * k];
    const lamps: [number, RGBA, RGBA][] = [
      [0.32, C.red, C.redOff],
      [0, C.hiViz, C.amberOff],
      [-0.32, C.green, C.greenOff]
    ];
    lamps.forEach(([dy, on, off], i) => {
      const [lx, lz] = front(1);
      const isLit = (lit === 'red' && i === 0) || (lit === 'green' && i === 2);
      boxAt(isLit ? this.glow : g, lx, y + dy - 0.11, lz, viewYaw, 0.22, 0.22, 0.04, isLit ? on : off);
      // The visor over it
      const [vx, vz] = front(1.6);
      boxAt(g, vx, y + dy + 0.12, vz, viewYaw, 0.28, 0.03, 0.18, C.black);
    });
  }

  /** A sign panel facing a driver heading viewYaw, centred at c. */
  private panel(c: V3, viewYaw: number, w: number, h: number, key: string, depth = 0.08, diamond = false): void {
    const R = this.m.regions[key];
    const grey = this.m.regions.grey;
    const right: V3 = [rx(viewYaw), 0, rz(viewYaw)];
    const toward: V3 = [-fx(viewYaw), 0, -fz(viewYaw)];
    const front = add(c, toward, depth / 2);
    const back = add(c, toward, -depth / 2);
    const corner = (o: V3, sx: number, sy: number): V3 => add(add(o, right, (sx * w) / 2), UP, (sy * h) / 2);
    this.sign.poly(
      [corner(front, -1, -1), corner(front, 1, -1), corner(front, 1, 1), corner(front, -1, 1)],
      [[R.u0, R.v0], [R.u1, R.v0], [R.u1, R.v1], [R.u0, R.v1]],
      WHITE,
      toward
    );
    if (diamond) return;
    const gu: [number, number][] = [[grey.u0, grey.v0], [grey.u1, grey.v0], [grey.u1, grey.v1], [grey.u0, grey.v1]];
    this.sign.poly([corner(back, 1, -1), corner(back, -1, -1), corner(back, -1, 1), corner(back, 1, 1)], gu, WHITE, neg(toward));
    this.sign.poly([corner(front, -1, 1), corner(front, 1, 1), corner(back, 1, 1), corner(back, -1, 1)], gu, WHITE, UP);
    this.sign.poly([corner(front, -1, -1), corner(back, -1, -1), corner(back, 1, -1), corner(front, 1, -1)], gu, WHITE, neg(UP));
    this.sign.poly([corner(front, 1, -1), corner(back, 1, -1), corner(back, 1, 1), corner(front, 1, 1)], gu, WHITE, right);
    this.sign.poly([corner(back, -1, -1), corner(front, -1, -1), corner(front, -1, 1), corner(back, -1, 1)], gu, WHITE, neg(right));
  }

  /** A sign on its own post (or two), its foot at b, for a driver heading viewYaw. */
  private postSign(b: V3, viewYaw: number, key: string, h: number, bottom: number, two = false): void {
    const R = this.m.regions[key];
    const w = h * R.aspect;
    const g = this.props;
    const right: V3 = [rx(viewYaw), 0, rz(viewYaw)];
    const back: V3 = [fx(viewYaw) * 0.08, 0, fz(viewYaw) * 0.08];
    const posts = two ? [-w * 0.3, w * 0.3] : [0];
    for (const o of posts) {
      const p = add(add(b, right, o), back);
      cylY(g, p[0], p[1], p[2], 0.06, 0.06, bottom + h - 0.05, 6, C.galv);
    }
    this.panel(add(b, UP, bottom + h / 2), viewYaw, w, h, key, two ? 0.12 : 0.04, key === 'work');
  }

  // ------------------------------------------------------------------- lot

  /**
   * The staff car park Ravi comes out of, east of the avenue: tarmac, the
   * chain-link round it, the gateway in its west fence with the barrier arm
   * stood up out of the way, and Ravi-Call's tower behind it.
   */
  private buildLot(): void {
    const ch = this.r.cityVis;
    const g = this.props;
    const rect = (s0: number, s1: number, l0: number, l1: number, y: number, col: RGBA): void => {
      extrude(this.asph, ch.span(s0, s1), () => [[l1, y], [l0, y]], col, 5, true);
    };
    rect(LOT.s0, LOT.s1, WALK_OUT, LOT.lat1, 0, C.lot);
    // Nothing else is built on it
    {
      const f = ch.at((LOT.s0 + LOT.s1) / 2);
      const c = pt(f, (WALK_OUT + LOT.lat1) / 2, 0);
      this.feet.push({ x: c[0], z: c[2], ax: [f.tangent.x, f.tangent.z], az: [f.right.x, f.right.z], hx: (LOT.s1 - LOT.s0) / 2 + 1, hz: (LOT.lat1 - WALK_OUT) / 2 + 1 });
    }
    rect(LOT.gate0, LOT.gate1, CITY_HALF, WALK_OUT, 0, C.asphalt);
    capAt(this.asph, ch.at(LOT.s0), [[WALK_OUT, PAD], [LOT.lat1, PAD], [LOT.lat1, 0], [WALK_OUT, 0]], -1, C.asphaltDark);
    capAt(this.asph, ch.at(LOT.s1), [[WALK_OUT, PAD], [LOT.lat1, PAD], [LOT.lat1, 0], [WALK_OUT, 0]], 1, C.asphaltDark);
    // Bay lines
    for (let s = LOT.s0 + 6; s < LOT.s1 - 4; s += 2.8) {
      for (const [l0, l1] of [[20, 25], [41, 46], [47, 52], [68, 73]]) this.across(ch, s, l0, l1, 0.1, C.white);
    }
    // The fence, the gate posts, the raised arm
    const fenceAt = (s: number, l: number): [number, number] => {
      const p = pt(ch.at(s), l, 0);
      return [p[0], p[2]];
    };
    this.fenceRun([fenceAt(LOT.s0, LOT.lat0), fenceAt(LOT.gate0, LOT.lat0)], 0);
    this.fenceRun([fenceAt(LOT.gate1, LOT.lat0), fenceAt(LOT.s1, LOT.lat0)], 0);
    this.fenceRun([fenceAt(LOT.s0, LOT.lat0), fenceAt(LOT.s0, LOT.lat1)], 0);
    this.fenceRun([fenceAt(LOT.s1, LOT.lat0), fenceAt(LOT.s1, LOT.lat1)], 0);
    this.fenceRun([fenceAt(LOT.s0, LOT.lat1), fenceAt(LOT.s1, LOT.lat1)], 0);
    const yaw = yawOf(ch.at(0).tangent);
    for (const s of [LOT.gate0, LOT.gate1]) {
      const p = pt(ch.at(s), LOT.lat0, 0);
      boxAt(g, p[0], 0, p[2], yaw, 0.16, 2.7, 0.16, C.galv);
    }
    const h = pt(ch.at(LOT.gate1 + 0.7), LOT.lat0 - 0.75, 0);
    boxAt(g, h[0], 0, h[2], yaw, 0.4, 1.0, 0.36, C.hiViz);
    tube(g, [h[0], 0.95, h[2]], [h[0] + 0.4, 7.4, h[2] - 0.6], 0.05, 0.05, 4, C.red);
    const sg = pt(ch.at(LOT.gate0 - 2.6), LOT.lat0 - 0.1, 0);
    this.postSign(sg, yaw - Math.PI / 2, 'staff', 0.8, 1.0);
    // Ravi-Call Systems' tower, behind the lot: nine floors and a parapet
    const tf = ch.at(-29);
    const tc = pt(tf, 108, 0);
    this.building(tc[0], tc[2], [tf.tangent.x, tf.tangent.z], [tf.right.x, tf.right.z], 42, 32, 9 * 3.3 + 1.8, rgba(0xc8c3b8), false);
    this.feet.push({ x: tc[0], z: tc[2], ax: [tf.tangent.x, tf.tangent.z], az: [tf.right.x, tf.right.z], hx: 21, hz: 16 });
    const sp = pt(tf, 108 - 16 - 0.12, 9 * 3.3 + 0.9);
    this.panel(sp, yaw + Math.PI / 2, 15, 1.4, 'company', 0.1);
  }

  /** Chain-link along a polyline: blended mesh panels, galvanised posts and rails. */
  private fenceRun(pts: [number, number][], y: number, H = 2.2): void {
    const g = this.props;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 3.5));
      for (let k = 0; k <= n; k++) {
        if (k === 0 && i > 0) continue;
        const t = k / n;
        cylY(g, ax + (bx - ax) * t, y + GROUND, az + (bz - az) * t, 0.04, 0.04, H + 0.1 - GROUND, 5, C.galv);
      }
      beam(g, [ax, y + H, az], [bx, y + H, bz], 0.045, 0.045, C.galv);
      const T = 0.6;
      this.fence.poly(
        [[ax, y + 0.04, az], [bx, y + 0.04, bz], [bx, y + H, bz], [ax, y + H, az]],
        [[acc / T, 0], [(acc + len) / T, 0], [(acc + len) / T, H / T], [acc / T, H / T]],
        WHITE,
        null
      );
      acc += len;
    }
  }

  // ------------------------------------------------------------------ ramp

  /** A deck's pieces between its barriers, bottom `bot` below the surface (or down to the ground). */
  private deckRun(frs: RoadSample[], bot: (f: RoadSample) => number, barL = true, barRt = true): void {
    const hl = (f: RoadSample): number => f.halfLeft;
    const hr = (f: RoadSample): number => f.halfRight;
    const oL = (f: RoadSample): number => -hl(f) - (barL ? BAR_W : 0);
    const oR = (f: RoadSample): number => hr(f) + (barRt ? BAR_W : 0);
    extrude(this.asph, frs, (k) => [[hr(frs[k]), 0], [-hl(frs[k]), 0]], C.asphalt, 5, true);
    extrude(this.conc, frs, (k) => [[oL(frs[k]), bot(frs[k])], [oR(frs[k]), bot(frs[k])]], C.underside, 3);
    extrude(this.conc, frs, (k) => [[oR(frs[k]), bot(frs[k])], [oR(frs[k]), barRt ? BAR_H : 0]], C.concDark, 3);
    extrude(this.conc, frs, (k) => [[oL(frs[k]), barL ? BAR_H : 0], [oL(frs[k]), bot(frs[k])]], C.concDark, 3);
    if (barRt) extrude(this.conc, frs, (k) => barR(hr(frs[k])), C.conc, 3);
    if (barL) extrude(this.conc, frs, (k) => barL_(hl(frs[k])), C.conc, 3);
  }

  /** Pillars every `every` metres where a deck stands high enough off the ground. */
  private deckPillars(ch: Chain, s0: number, s1: number, every: number): void {
    for (let s = s0 + every / 2; s < s1; s += every) {
      const f = ch.at(s);
      const bottom = f.pos.y - 1.4;
      if (bottom < 2.2) continue;
      const c = pt(f, (f.halfRight - f.halfLeft) / 2, 0);
      if (this.groundRoads.blocked(c[0], c[2], 1)) continue;
      cylY(this.conc, c[0], GROUND, c[2], 0.7, 0.7, bottom - 0.7 - GROUND, 8, C.conc, 3);
      const yaw = yawOf(f.tangent);
      boxAt(this.conc, c[0], bottom - 0.75, c[2], yaw, f.halfLeft + f.halfRight + 0.6, 0.75, 1.6, C.concDark, 3);
    }
  }

  /** The shade a deck throws on the ground below it. */
  private deckShade(frs: RoadSample[], l: (f: RoadSample) => number, rr: (f: RoadSample) => number, alpha = 0.4): void {
    const k = 1 / SUN_DIR.y;
    for (let i = 0; i < frs.length - 1; i++) {
      const a = frs[i];
      const b = frs[i + 1];
      if (a.pos.y < 2.5 || b.pos.y < 2.5) continue;
      const proj = (f: RoadSample, lat: number): V3 => {
        const p = pt(f, lat, 0);
        const h = p[1];
        return [p[0] - SUN_DIR.x * h * k, 0, p[2] - SUN_DIR.z * h * k];
      };
      const q = [proj(a, l(a)), proj(a, rr(a)), proj(b, rr(b)), proj(b, l(b))];
      const cx = (q[0][0] + q[2][0]) / 2;
      const cz = (q[0][2] + q[2][2]) / 2;
      const y = this.groundRoads.blocked(cx, cz, 4) || this.inAirport(cx, cz) ? 0.03 : GROUND + 0.03;
      for (const v of q) v[1] = y;
      this.soft.poly(q, [[SOFT.band[0], 0.5], [SOFT.band[1], 0.5], [SOFT.band[1], 0.5], [SOFT.band[0], 0.5]], [1, 1, 1, alpha], UP);
    }
  }

  /** The on-ramp: the funnel off the avenue, then its own deck up to the nose, where the highway takes over. */
  private buildRamp(): void {
    const r = this.r;
    const ch = r.ramp;
    // The funnel, kerbed, on the ground
    const fun = ch.span(0, RAMP_TAPER);
    extrude(this.asph, fun, (k) => [[fun[k].halfRight, 0], [-fun[k].halfLeft, 0]], C.asphalt, 5, true);
    this.footpath(ch, 0, RAMP_TAPER, 1, (f) => f.halfRight, 0, false);
    this.footpath(ch, 0, RAMP_TAPER, -1, (f) => f.halfLeft, 0, false);
    this.line(ch, 0, RAMP_TAPER, (s) => -ch.at(s).halfLeft + 0.3, 0.15, C.white);
    this.line(ch, 0, RAMP_TAPER, (s) => ch.at(s).halfRight - 0.3, 0.15, C.white);
    // The avenue's lane line (3.6 right of its centre) runs on as the ramp's, into its middle
    this.dashes(ch, 0, RAMP_TAPER, (s) => 3.6 * (1 - sm(s / RAMP_TAPER)), 0.12, C.white, 3, 9);
    // Chevrons in the funnel's left, where the avenue's oncoming half closes off
    for (let s = 6; s < 34; s += 4) {
      const a = ch.at(s);
      const b = ch.at(s + 3);
      const pa = pt(a, -a.halfLeft + 0.6, 0.02);
      const pb = pt(b, -b.halfLeft + 2.4 * (1 - s / 40) + 0.6, 0.02);
      stroke(this.paint, pa[0], pa[2], pb[0], pb[2], 0.35, 0.02, C.white);
    }

    // The deck: barriers from the end of the funnel, ground embankment, then on pillars
    const s1 = r.rampNoseS;
    // Its own width throughout (the samples either side of the nose straddle the jump to the fused width)
    const frs = ch.span(RAMP_TAPER, s1).map((f) => ({ ...f, halfLeft: RAMP_HALF, halfRight: RAMP_HALF }));
    const bot = (f: RoadSample): number => (f.pos.y < 3.5 ? GROUND - f.pos.y : -1.4);
    this.deckRun(frs, bot);
    const f0 = frs[0];
    capAt(this.conc, f0, barCap(f0.halfRight, 1, GROUND - f0.pos.y), -1, C.conc);
    capAt(this.conc, f0, barCap(-f0.halfLeft, -1, GROUND - f0.pos.y), -1, C.conc);
    const fe = frs[frs.length - 1];
    capAt(this.conc, fe, barCap(-fe.halfLeft, -1), 1, C.conc);
    // Where the embankment gives way to the viaduct
    for (let i = 0; i < frs.length - 1; i++) {
      if (frs[i].pos.y < 3.5 && frs[i + 1].pos.y >= 3.5) {
        const f = frs[i + 1];
        capAt(this.conc, f, [[-f.halfLeft - BAR_W, GROUND - f.pos.y], [f.halfRight + BAR_W, GROUND - f.pos.y], [f.halfRight + BAR_W, -1.4], [-f.halfLeft - BAR_W, -1.4]], 1, C.concDark);
      }
    }
    this.deckPillars(ch, RAMP_TAPER, s1, 24);
    this.deckShade(frs, (f) => -f.halfLeft - BAR_W, (f) => f.halfRight + BAR_W);
    this.line(ch, RAMP_TAPER, s1, () => -RAMP_HALF + 0.3, 0.15, C.yellow);
    this.line(ch, RAMP_TAPER, s1, () => RAMP_HALF - 0.3, 0.15, C.white);
    this.dashes(ch, RAMP_TAPER, s1, () => 0, 0.12, C.white, 3, 9);
    // ... and on through the merge until it comes alongside the right lane
    const hw = r.hwVis;
    this.dashes(hw, -MERGE_LEN, -MERGE_LEN + 45, (u) => mergeOff(u + MERGE_LEN), 0.12, C.white, 3, 9);
    // Its speed limit, on the right barrier at the foot
    const sf = ch.at(60);
    this.postSign(pt(sf, RAMP_HALF + 0.3, BAR_H), yawOf(sf.tangent), 'sl45', 0.75, 1.2);
  }

  // --------------------------------------------------------------- highway

  /**
   * The highway's deck: both carriageways on one slab, the median barrier
   * between, jersey barriers at the edges, in runs between the places its
   * right edge jumps (where the on-ramp and the exit fuse into it).
   */
  private buildHighway(): void {
    const r = this.r;
    const ch = r.hwVis;
    const B = HW.bot;
    const near = (frs: RoadSample[], R: (u: number) => number, tint: RGBA): void => {
      const Rk = (k: number): number => R(frs[k].s);
      extrude(this.conc, frs, (k) => [[HW.farL - BAR_W, B], [Rk(k) + BAR_W, B]], C.underside, 3);
      extrude(this.conc, frs, (k) => [[Rk(k) + BAR_W, B], [Rk(k) + BAR_W, BAR_H]], C.concDark, 3);
      extrude(this.conc, frs, (k) => barR(Rk(k)), C.conc, 3);
      extrude(this.asph, frs, (k) => [[Rk(k), 0], [HW.nearL, 0]], tint, 5, true);
      extrude(this.conc, frs, () => [[HW.nearL, 0], [HW.nearL - 0.06, 0.08], [HW.nearL - 0.2, 0.33], [HW.nearL - 0.32, BAR_H], [HW.nearL - 0.48, BAR_H], [HW.nearL - 0.6, 0.33], [HW.nearL - 0.74, 0.08], [HW.medL, 0]], C.conc, 3);
      this.farSide(frs);
    };
    const runs: [number, number, (u: number) => number, RGBA][] = [
      [-HW_BACK, -MERGE_LEN, () => HW.R, C.asphalt],
      [-MERGE_LEN, 0, r.hwR, C.asphalt],
      [0, EXIT_S, () => HW.R, C.asphalt],
      [EXIT_S, r.exitNoseU, r.hwR, C.asphalt],
      [r.exitNoseU, HW_LEN, () => HW.R, C.asphalt],
      [HW_LEN, NEAR_END, () => HW.R, C.asphaltPale]
    ];
    for (const [a, b, R, tint] of runs) near(ch.span(a, b), R, tint);
    // The far carriageway alone, on past the end of ours
    const far = ch.span(NEAR_END, ch.s1);
    extrude(this.conc, far, () => [[HW.farL - BAR_W, B], [HW.medL + BAR_W, B]], C.underside, 3);
    extrude(this.conc, far, () => [[HW.medL + BAR_W, B], [HW.medL + BAR_W, BAR_H]], C.concDark, 3);
    extrude(this.conc, far, () => barR(HW.medL), C.conc, 3);
    this.farSide(far);

    // Ends and breaks
    const f0 = ch.at(ch.s0);
    capAt(this.conc, f0, [[HW.farL - BAR_W, B], [HW.R + BAR_W, B], [HW.R + BAR_W, 0], [HW.farL - BAR_W, 0]], -1, C.concDark);
    for (const [l, sd] of [[HW.R, 1], [HW.nearL, -1], [HW.farL, -1], [HW.medL, 1]] as [number, 1 | -1][]) capAt(this.conc, f0, barCap(l, sd), -1, C.conc);
    const fz = ch.at(ch.s1);
    capAt(this.conc, fz, [[HW.farL - BAR_W, B], [HW.medL + BAR_W, B], [HW.medL + BAR_W, 0], [HW.farL - BAR_W, 0]], 1, C.concDark);
    for (const [l, sd] of [[HW.farL, -1], [HW.medL, 1]] as [number, 1 | -1][]) capAt(this.conc, fz, barCap(l, sd), 1, C.conc);
    capAt(this.conc, ch.at(-MERGE_LEN), barCap(HW.R, 1), 1, C.conc);
    capAt(this.conc, ch.at(r.exitNoseU), barCap(HW.R, 1), -1, C.conc);
    // Our side's deck stops dead past the closure: the unfinished span
    const fe = ch.at(NEAR_END);
    capAt(this.conc, fe, [[HW.medL + BAR_W, B], [HW.R + BAR_W, B], [HW.R + BAR_W, 0], [HW.medL + BAR_W, 0]], 1, C.concDark);
    capAt(this.conc, fe, barCap(HW.R, 1), 1, C.conc);
    capAt(this.conc, fe, [[HW.nearL, 0], [HW.nearL - 0.06, 0.08], [HW.nearL - 0.2, 0.33], [HW.nearL - 0.32, BAR_H], [HW.medL + BAR_W, BAR_H], [HW.medL + BAR_W, 0]], 1, C.conc);
    for (let l = -9.4; l < 5; l += 0.9) {
      const a = pt(fe, l, -0.3);
      const b = add(a, [fe.tangent.x, 0.05, fe.tangent.z], 0.9);
      tube(this.props, a, b, 0.025, 0.025, 4, C.dark);
      const a2 = pt(fe, l + 0.45, -1.1);
      tube(this.props, a2, add(a2, [fe.tangent.x, -0.08, fe.tangent.z], 0.7), 0.025, 0.025, 4, C.dark);
    }

    // Pillars: two columns under a cap beam, a third where the ramps widen the deck
    for (let u = ch.s0 + 15; u < ch.s1; u += 30) {
      const f = ch.at(u);
      const nearOn = u < NEAR_END;
      const R = r.hwR(u);
      const cols: number[] = [HW.colB];
      if (nearOn) cols.push(HW.colA);
      if (nearOn && R > 9) cols.push(R - 2.5);
      const yaw = yawOf(f.tangent);
      const capTop = DECK + B;
      let any = false;
      for (const l of cols) {
        const p = pt(f, l, 0);
        if (this.groundRoads.blocked(p[0], p[2], 1.2)) continue;
        any = true;
        cylY(this.conc, p[0], GROUND, p[2], 0.85, 0.85, capTop - 1.2 - GROUND, 8, C.conc, 3);
      }
      if (!any) continue;
      const l0 = HW.farL + 0.2;
      const l1 = nearOn ? R + 0.2 : HW.medL + 0.2;
      const c = pt(f, (l0 + l1) / 2, 0);
      boxAt(this.conc, c[0], capTop - 1.2, c[2], yaw, l1 - l0, 1.2, 1.8, C.concDark, 3);
    }
    this.deckShade(ch.span(ch.s0, ch.s1), () => HW.farL - BAR_W, (f) => (f.s < NEAR_END ? r.hwR(f.s) + BAR_W : HW.medL + BAR_W), 0.42);

    // ---- Paint
    const Y = 0.02;
    const W = 0.15;
    const end = CLOSURE_S - 2;
    const line = (a: number, b: number, lat: number | ((s: number) => number), col: RGBA, w = W): void =>
      this.line(ch, a, b, typeof lat === 'number' ? () => lat : lat, w, col, Y);
    const dash = (a: number, b: number, lat: number, col: RGBA, on = 3, off = 9, w = W): void => this.dashes(ch, a, b, () => lat, w, col, on, off, Y);
    // Ours: yellow on the left, lane lines, the right lane's edge line
    line(ch.s0, end, -9.0, C.yellow);
    dash(ch.s0, end, -5.4, C.white);
    dash(ch.s0, end, -1.8, C.white);
    line(ch.s0, r.rampConvU, 1.8, C.white);
    dash(r.rampConvU, 0, 1.8, C.white, 1, 3, 0.3);
    line(0, EXIT_S, 1.8, C.white);
    dash(EXIT_S, r.exitDivU, 1.8, C.white, 1, 3, 0.3);
    line(r.exitDivU, end, 1.8, C.white);
    // Along the barrier where a ramp widens the deck
    for (const [a, b] of [[-MERGE_LEN, 0], [EXIT_S, r.exitNoseU]]) {
      let s0 = -1;
      for (let s = a; s <= b; s += 0.5) {
        const wide = r.hwR(s) > HW.R + 0.12;
        if (wide && s0 < 0) s0 = s;
        if ((!wide || s + 0.5 > b) && s0 >= 0) {
          line(s0, s, (q) => r.hwR(q) - 0.3, C.white);
          s0 = -1;
        }
      }
    }
    // The gores: hatched between the lane's edge and the ramp's line
    const hatch = (a: number, b: number, other: (u: number) => number): void => {
      for (let u = a + 3; u < b - 2; u += 5) {
        const fa = ch.at(u);
        const fb = ch.at(u + 3);
        const la = 1.8 + 0.35;
        const lb = other(u + 3) - 0.35;
        if (lb - la < 0.4) continue;
        const pa = pt(fa, la, Y);
        const pb = pt(fb, lb, Y);
        stroke(this.paint, pa[0], pa[2], pb[0], pb[2], 0.4, pa[1], C.white);
      }
    };
    hatch(-MERGE_LEN, r.rampConvU, r.rampLeftLat);
    hatch(r.exitDivU, r.exitNoseU, r.exitLeftLat);
    line(-MERGE_LEN, r.rampConvU, r.rampLeftLat, C.white);
    line(r.exitDivU, r.exitNoseU, r.exitLeftLat, C.white);
    // The far side's
    line(ch.s0, ch.s1, -11.8, C.yellow);
    dash(ch.s0, ch.s1, -15.4, C.white);
    dash(ch.s0, ch.s1, -19.0, C.white);
    line(ch.s0, ch.s1, -22.6, C.white);
  }

  /** The far carriageway's surface and outer barrier. */
  private farSide(frs: RoadSample[]): void {
    extrude(this.asph, frs, () => [[HW.medL, 0], [HW.farL, 0]], C.asphalt, 5, true);
    extrude(this.conc, frs, () => barL_(HW.farL), C.conc, 3);
    extrude(this.conc, frs, () => [[HW.farL - BAR_W, BAR_H], [HW.farL - BAR_W, HW.bot]], C.concDark, 3);
  }

  /** Lamps on the median, the gantries and the signs on the barriers. */
  private buildHighwayProps(): void {
    const r = this.r;
    const ch = r.hwVis;
    const g = this.props;
    const gantries = [40, 650, EXIT_S - 25];
    for (let u = ch.s0 + 20; u < ch.s1; u += 50) {
      if (gantries.some((q) => Math.abs(q - u) < 12)) continue;
      const f = ch.at(u);
      const base = pt(f, -10.4, BAR_H);
      cylY(g, base[0], base[1], base[2], 0.2, 0.2, 0.6, 8, C.galv);
      cylY(g, base[0], base[1], base[2], 0.16, 0.1, 10.5, 8, C.galv);
      const yaw = yawOf(f.tangent);
      const arms = u < NEAR_END ? [-1, 1] : [-1];
      for (const sd of arms) {
        const a = pt(f, -10.4, BAR_H + 10.3);
        const b = pt(f, -10.4 + sd * 5.2, BAR_H + 10.6);
        beam(g, a, b, 0.1, 0.1, C.galv);
        const h = pt(f, -10.4 + sd * 5.6, BAR_H + 10.5);
        boxAt(g, h[0], h[1] - 0.1, h[2], yaw, 0.95, 0.2, 0.42, C.dark);
        boxAt(g, h[0], h[1] - 0.13, h[2], yaw, 0.75, 0.04, 0.3, C.lens);
      }
    }
    // Gantries over our side
    const gantry = (u: number, panels: [string, number, number][]): void => {
      const f = ch.at(u);
      const yaw = yawOf(f.tangent);
      const R = r.hwR(u);
      const posts = [-10.4, R + 0.3];
      for (const l of posts) {
        const p = pt(f, l, BAR_H);
        boxAt(g, p[0], p[1], p[2], yaw, 0.5, 7.1, 0.5, C.galv);
      }
      const a = pt(f, posts[0], 6.9);
      const b = pt(f, posts[1], 6.9);
      beam(g, a, b, 0.7, 0.9, C.galv);
      beam(g, pt(f, posts[0], 6.2), pt(f, posts[1], 6.2), 0.12, 0.12, C.galv);
      for (const [key, lat, h] of panels) {
        const w = h * this.m.regions[key].aspect;
        const c = pt(f, lat, 6.3);
        const cc = add(c, [-f.tangent.x, 0, -f.tangent.z], 0.42);
        this.panel(cc, yaw, w, h, key, 0.12);
      }
    };
    gantry(40, [['g1', -2.2, 3.1]]);
    gantry(650, [['g2', -2.2, 3.4]]);
    gantry(EXIT_S - 25, [['g5', -5.6, 3.0], ['g4', 1.3, 3.2]]);
    // Speed limits, on the right barrier
    const barSign = (u: number, key: string, h: number): void => {
      const f = ch.at(u);
      const b = pt(f, r.hwR(u) + 0.3, BAR_H);
      this.postSign(b, yawOf(f.tangent), key, h, 1.2);
    };
    barSign(90, 'sl65', 1.0);
    barSign(1250, 'work', 1.5);
    barSign(1330, 'work', 1.5);
    {
      const f = ch.at(1250);
      this.postSign(pt(f, -10.4, BAR_H), yawOf(f.tangent), 'work', 1.5, 1.2);
    }

    // The exit's gore: the crash cushion at the nose and the EXIT 12 sign behind it
    const nu = r.exitNoseU;
    const fN = ch.at(nu - 2.4);
    const yaw = yawOf(fN.tangent);
    const cc = pt(fN, HW.R + BAR_W, 0);
    for (let k = 0; k < 4; k++) {
      const q = pt(ch.at(nu - 0.6 - k * 1.1), HW.R + BAR_W, 0);
      boxAt(g, q[0], q[1] + 0.05, q[2], yaw, 0.92, 0.9, 1.0, C.hiViz);
      boxAt(g, q[0], q[1] + 0.05, q[2], yaw, 0.96, 0.08, 1.04, C.black);
    }
    const fr = ch.at(nu - 4.95);
    const front = pt(fr, HW.R + BAR_W, 0.5);
    this.panel(front, yaw, 0.9, 0.85, 'chev', 0.02);
    this.block(cc[0], cc[2], yaw, 0.5, 2.5, DECK, DECK + 1);
    const sp = pt(ch.at(nu + 1.2), HW.R + BAR_W, BAR_H);
    cylY(g, sp[0], sp[1], sp[2], 0.08, 0.08, 3.0, 6, C.galv);
    this.panel(add(sp, UP, 2.6), yaw, 3.4, 1.7, 'g3', 0.1);
  }

  /** The construction closure at the end of our side: the taper of barrels, the blocks, the barricade. */
  private buildClosure(): void {
    const ch = this.r.hwVis;
    const g = this.props;
    const barrel = (u: number, lat: number): void => {
      const f = ch.at(u);
      const p = pt(f, lat, 0);
      for (let k = 0; k < 4; k++) {
        cylY(g, p[0], p[1] + k * 0.24, p[2], 0.3 - k * 0.01, 0.29 - k * 0.01, 0.24, 8, k % 2 ? C.white : C.orange);
      }
      cylY(g, p[0], p[1], p[2], 0.38, 0.38, 0.06, 8, C.black);
    };
    // Taper from the shoulder across all three lanes
    for (let u = 1360, k = 0; u <= CLOSURE_S - 8; u += 7, k++) {
      const t = (u - 1360) / (CLOSURE_S - 8 - 1360);
      barrel(u, 4.6 - t * 13.8);
    }
    for (let l = -9.2; l <= 4.8; l += 2.0) barrel(CLOSURE_S - 4, l);
    // Concrete blocks across the carriageway: the actual stop
    const f = ch.at(CLOSURE_S);
    const yaw = yawOf(f.tangent);
    for (let l = -9.25; l < 5; l += 3.05) {
      const p = pt(f, l + 1.5, 0);
      obox(this.conc, [p[0], p[1] + 0.42, p[2]], [f.right.x, 0, f.right.z], UP, [f.tangent.x, 0, f.tangent.z], 1.48, 0.42, 0.3, C.conc, 3);
      obox(this.conc, [p[0], p[1] + 0.07, p[2]], [f.right.x, 0, f.right.z], UP, [f.tangent.x, 0, f.tangent.z], 1.48, 0.07, 0.42, C.concDark, 3);
    }
    const mid = pt(f, (HW.nearL + HW.R) / 2, 0);
    this.block(mid[0], mid[2], yaw, (HW.R - HW.nearL) / 2 + 0.3, 0.5, DECK, DECK + 0.9);
    // Type III barricades with ROAD CLOSED on the middle one
    const fb = ch.at(CLOSURE_S - 6);
    for (const l of [-6.8, -2.3, 2.3]) {
      for (const sd of [-1.8, 1.8]) {
        const p = pt(fb, l + sd, 0);
        boxAt(g, p[0], p[1], p[2], yaw, 0.1, 1.7, 0.1, C.white);
        boxAt(g, p[0], p[1], p[2], yaw, 0.5, 0.06, 0.6, C.dark);
      }
      for (const h of [0.55, 0.95, 1.35]) {
        const c = pt(fb, l, h);
        this.panel(c, yaw, 3.9, 0.26, 'stripes', 0.03);
      }
    }
    this.panel(pt(fb, -2.3, 1.95), yaw, 2.4, 0.8, 'closed', 0.05);
    // Past the blocks: a work light, a mixer and an excavator on the unfinished deck
    const fl = ch.at(1520);
    const lp = pt(fl, 3.2, 0);
    boxAt(g, lp[0], lp[1], lp[2], yaw, 1.4, 1.0, 2.2, C.hiViz);
    cylY(g, lp[0], lp[1] + 1.0, lp[2], 0.08, 0.06, 6.5, 6, C.galv);
    boxAt(g, lp[0], lp[1] + 7.3, lp[2], yaw, 1.6, 0.6, 0.3, C.dark);
    const ex = ch.at(1536);
    const ep = pt(ex, -4.5, 0);
    boxAt(g, ep[0], ep[1], ep[2], yaw + 0.3, 2.6, 0.9, 4.2, C.dark);
    boxAt(g, ep[0], ep[1] + 0.9, ep[2], yaw + 0.3, 2.4, 1.2, 2.6, C.hiViz);
    boxAt(g, ep[0] + 0.5, ep[1] + 2.1, ep[2], yaw + 0.3, 1.2, 1.3, 1.3, C.hiViz);
    const boom0: V3 = [ep[0], ep[1] + 1.9, ep[2]];
    const boom1 = add(boom0, [-fx(yaw + 0.3) * 4, 2.2, -fz(yaw + 0.3) * 4]);
    beam(g, boom0, boom1, 0.4, 0.5, C.hiViz);
    beam(g, boom1, add(boom1, [-fx(yaw + 0.3) * 1.5, -2.6, -fz(yaw + 0.3) * 1.5]), 0.3, 0.4, C.hiViz);
  }

  // ------------------------------------------------------------------ exit

  /** The exit's own deck from the gore nose: curving right and down to grade. */
  private buildExit(): void {
    const r = this.r;
    const ch = r.exit;
    const s0 = r.exitNoseS;
    const half = (q: number): number => EXIT_HALF + (AIR_HALF - EXIT_HALF) * sm((q - 268) / 30);
    const frs = ch.span(s0, ch.s1).map((f) => ({ ...f, halfLeft: half(f.s), halfRight: half(f.s) }));
    // Its first cross-section square to the highway, so it meets the fused deck's end edge to edge
    frs[0].right = r.hwVis.at(r.exitNoseU).right.clone();
    const bot = (f: RoadSample): number => (f.pos.y < 3.5 ? GROUND - f.pos.y : -1.4);
    this.deckRun(frs, bot);
    const f0 = frs[0];
    capAt(this.conc, f0, barCap(-f0.halfLeft, -1), -1, C.conc);
    const fe = frs[frs.length - 1];
    capAt(this.conc, fe, barCap(fe.halfRight, 1, GROUND), 1, C.conc);
    capAt(this.conc, fe, barCap(-fe.halfLeft, -1, GROUND), 1, C.conc);
    for (let i = 0; i < frs.length - 1; i++) {
      if (frs[i].pos.y >= 3.5 && frs[i + 1].pos.y < 3.5) {
        const f = frs[i];
        capAt(this.conc, f, [[-f.halfLeft - BAR_W, GROUND - f.pos.y], [f.halfRight + BAR_W, GROUND - f.pos.y], [f.halfRight + BAR_W, -1.4], [-f.halfLeft - BAR_W, -1.4]], -1, C.concDark);
      }
    }
    this.deckPillars(ch, s0, ch.s1, 24);
    this.deckShade(frs, (f) => -f.halfLeft - BAR_W, (f) => f.halfRight + BAR_W);
    this.line(ch, s0, ch.s1, (s) => -half(s) + 0.3, 0.15, C.yellow);
    this.line(ch, s0, ch.s1, (s) => half(s) - 0.3, 0.15, C.white);
    const sf = ch.at(s0 + 40);
    this.postSign(pt(sf, sf.halfRight + 0.3, BAR_H), yawOf(sf.tangent), 'sl40', 0.8, 1.2);
  }

  /** On to the gate: two lanes, kerbs, chain-link both sides, the airport's sign. */
  private buildAirportRoad(): void {
    const ch = this.r.air;
    const all = ch.span(0, ch.s1);
    extrude(this.asph, all, () => [[AIR_HALF, 0], [-AIR_HALF, 0]], C.asphaltDark, 5, true);
    this.footpath(ch, 0, ch.s1, 1, () => AIR_HALF, 0, false);
    this.footpath(ch, 0, ch.s1, -1, () => AIR_HALF, 0, false);
    this.line(ch, 0, ch.s1 - 1, () => -AIR_HALF + 0.3, 0.15, C.yellow);
    this.line(ch, 0, ch.s1 - 1, () => AIR_HALF - 0.3, 0.15, C.white);
    this.dashes(ch, 0, ch.s1 - 12, () => 0, 0.12, C.white, 3, 9);
    this.across(ch, ch.s1 - 5, -AIR_HALF + 0.3, AIR_HALF - 0.3, 0.5, C.white);
    const pts = (lat: number, a: number, b: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let s = a; s <= b; s += 10) {
        const p = pt(ch.at(s), lat, 0);
        out.push([p[0], p[2]]);
      }
      return out;
    };
    this.fenceRun(pts(-10, 30, ch.s1 - 2), 0);
    this.fenceRun(pts(10, 30, ch.s1 - 12), 0);
    const sf = ch.at(45);
    this.postSign(pt(sf, AIR_HALF + 4.5, 0), yawOf(sf.tangent), 'airport', 1.7, 0.7, true);
    // A low plinth under it
    const pl = pt(sf, AIR_HALF + 4.5, 0);
    boxAt(this.props, pl[0], GROUND, pl[2], yawOf(sf.tangent), 6.2, 0.95 - GROUND, 0.6, rgba(0x8a6f5a));
  }

  // --------------------------------------------------------------- airport

  /**
   * The private-aviation side of the airport, laid out in the gate's frame
   * (a metres on past the gate, b to the right of the road's line): the gate
   * and the guard's booth, the apron, the hangar, the FBO, the jet's stand,
   * the taxiway out to the runway, a windsock, the tower.
   *
   * The jet comes from StreetProps; this only leaves room for it. Its frame
   * as assumed here: origin on the ground at the middle of its footprint,
   * NOSE toward local −Z (like the cars), airstair door on its LEFT (−X)
   * side 4 m back from the nose, the stair's foot 4 m out from the centreline.
   */
  private buildAirport(): void {
    const G = this.gateFrame;
    const g = this.props;
    const ap = (a: number, b: number): [number, number] => this.ap(a, b);
    const rectAB = (geo: Geo, a0: number, a1: number, b0: number, b1: number, y: number, col: RGBA, tile: number): void =>
      flatQuad(geo, [ap(a0, b0), ap(a1, b0), ap(a1, b1), ap(a0, b1)], y, col, tile);
    const yawF = G.yaw;
    const yawR = G.yaw - Math.PI / 2;

    // Surfaces
    rectAB(this.apron, 0, 240, -130, 160, 0, WHITE, 5);
    rectAB(this.asph, 240, 408, 45, 75, 0, C.asphaltDark, 5);
    rectAB(this.asph, 408, 453, -700, 900, 0, C.runway, 5);
    // A blast pad of grass-free gravel around the runway's ends
    rectAB(this.asph, 404, 457, -760, -700, -0.02, C.asphaltPale, 5);
    rectAB(this.asph, 404, 457, 900, 960, -0.02, C.asphaltPale, 5);

    // Paint: taxi lines and edges in yellow, the runway in white
    const Y = 0.02;
    const yl = (a0: number, b0: number, a1: number, b1: number, w = 0.3, col = C.yellow): void => {
      const A = ap(a0, b0);
      const B = ap(a1, b1);
      stroke(this.paint, A[0], A[1], B[0], B[1], w, Y, col);
    };
    yl(200, -128, 200, 158);
    yl(200, 60, 384, 60);
    for (const da of [0, 0.6]) yl(384 + da, 45.5, 384 + da, 74.5, 0.25);
    for (let b = 46; b < 74; b += 1.8) for (const da of [1.6, 2.2]) yl(384 + da, b, 384 + da, b + 0.9, 0.25);
    for (const [a0, b0, a1, b1] of [[1, -129, 239, -129], [1, 159, 239, 159], [239, -129, 239, 44], [239, 76, 239, 159]]) yl(a0, b0, a1, b1, 0.2);
    for (const a of [409.5, 451.5]) yl(a, -698, a, 898, 0.9, C.white);
    for (let b = -660; b < 860; b += 50) yl(430.5, b, 430.5, b + 30, 0.9, C.white);
    for (const b0 of [-696, 866]) {
      for (let k = 0; k < 8; k++) {
        for (const sd of [-1, 1]) {
          const a = 430.5 + sd * (3 + k * 2.4);
          yl(a, b0, a, b0 + 30, 1.6, C.white);
        }
      }
    }
    // Edge lights, and blue along the taxiway
    for (let b = -700; b <= 900; b += 60) {
      for (const a of [407.2, 453.8]) {
        const [x, z] = ap(a, b);
        boxAt(this.glow, x, 0, z, yawF, 0.22, 0.32, 0.22, b === -700 || b === 900 ? C.green : C.whiteLight);
      }
    }
    for (let a = 245; a < 405; a += 30) {
      for (const b of [44, 76]) {
        const [x, z] = ap(a, b);
        boxAt(this.glow, x, 0, z, yawF, 0.2, 0.3, 0.2, C.blueLight);
      }
    }

    // The gate: posts, the guard's booth on the right, the arm across the road
    const roadEnd = this.r.roads.airport.samples[this.r.roads.airport.samples.length - 1];
    for (const b of [4.6, -4.4]) {
      const [x, z] = ap(0.3, b);
      boxAt(g, x, GROUND, z, yawF, 0.3, 1.15 - GROUND, 0.3, b > 0 ? C.hiViz : C.galv);
    }
    const [rx0, rz0] = ap(0.3, -4.4);
    boxAt(g, rx0, 1.05, rz0, yawF, 0.4, 0.1, 0.12, C.dark);
    // Booth
    const [bx, bz] = ap(-3.6, 7.6);
    boxAt(g, bx, GROUND, bz, yawF, 2.6, 1.1 - GROUND, 2.6, rgba(0xe8e4dc));
    for (const [w, d] of [[2.6, 0.12], [0.12, 2.6]] as [number, number][]) {
      for (const sd of [-1, 1]) {
        const ox = w < 1 ? sd * 1.24 : 0;
        const oz = d < 1 ? sd * 1.24 : 0;
        const x = bx + rx(yawF) * ox - fx(yawF) * oz;
        const z = bz + rz(yawF) * ox - fz(yawF) * oz;
        boxAt(this.glass, x, 1.1, z, yawF, w, 1.2, d, WHITE, 1.4);
      }
    }
    boxAt(g, bx, 2.3, bz, yawF, 2.6, 0.5, 2.6, rgba(0xe8e4dc));
    boxAt(g, bx, 2.8, bz, yawF, 3.6, 0.18, 3.6, C.dark);
    this.block(bx, bz, yawF, 1.4, 1.4, 0, 3);
    const [gsx, gsz] = ap(-14, 6.2);
    this.postSign([gsx, 0, gsz], yawF, 'gate', 1.1, 1.1);
    // Fence along the front of the airfield and round it
    this.fenceRun([ap(0.3, 5.2), ap(0.3, 980)], 0);
    this.fenceRun([ap(0.3, -5.0), ap(0.3, -780)], 0);
    this.fenceRun([ap(0.3, 980), ap(540, 980), ap(540, -780), ap(0.3, -780)], 0);
    this.block(...ap(0.3, 4.6), yawF, 0.25, 0.25, 0, 1.2);
    this.block(...ap(0.3, -4.4), yawF, 0.25, 0.25, 0, 1.2);

    // The arm: on its own, so the scene can swing it (or break it)
    const pivot = new THREE.Group();
    const [px, pz] = ap(0.3, 4.6);
    pivot.position.set(px, 1.0, pz);
    pivot.rotation.y = yawF + Math.PI;
    const arm = new THREE.Group();
    arm.name = 'gateArm';
    const stick = new THREE.Mesh(new THREE.BoxGeometry(8.7, 0.11, 0.09), this.m.stripes);
    stick.position.x = 4.45;
    const weight = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.2), this.m.props);
    const wc = weight.geometry.attributes.position.count;
    weight.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(wc * 3).fill(0.12), 3));
    weight.position.x = -0.35;
    arm.add(stick, weight);
    pivot.add(arm);
    this.group.add(pivot);

    // Hangar on the left, its doors open toward the apron
    const hc = ap(95, -88);
    const hw = 48;
    const hd = 36;
    const hh = 12;
    const ax: [number, number] = [G.f[0], G.f[1]];
    const az: [number, number] = [G.r[0], G.r[1]];
    const wall = rgba(0xa8b6c2);
    boxAt(g, hc[0], GROUND, hc[1], yawF, hd, hh - GROUND, hw, wall);
    // Barrel roof: a half-cylinder squashed low
    const roofGeo = new THREE.CylinderGeometry(hd / 2, hd / 2, hw, 14, 1, true, -Math.PI / 2, Math.PI);
    roofGeo.scale(1, 0.32, 1);
    roofGeo.rotateX(Math.PI / 2);
    roofGeo.rotateY(yawF);
    roofGeo.translate(hc[0], hh, hc[1]);
    this.absorb(roofGeo, this.props, rgba(0x7c8790));
    // Doors: a dark opening on the apron side, the sign over it
    const dc = this.ap(95, -88 + hd / 2 + 0.06);
    boxAt(g, dc[0], 0, dc[1], yawF, 0.1, 9.5, 40, rgba(0x2a2f35));
    for (const sd of [-1, 1]) {
      const pc = this.ap(95 + sd * 21.5, -88 + hd / 2 + 0.3);
      boxAt(g, pc[0], 0, pc[1], yawF, 0.6, hh, 5, rgba(0x8e9ca8));
    }
    const hs = this.ap(95, -88 + hd / 2 + 0.25);
    this.panel([hs[0], 10.8, hs[1]], yawR + Math.PI, 7, 1.75, 'hangar', 0.06);
    this.block(hc[0], hc[1], yawF, hd / 2, hw / 2, 0, hh + 6);
    this.feet.push({ x: hc[0], z: hc[1], ax, az, hx: hw / 2, hz: hd / 2 });

    // The FBO: two storeys, glass on the apron and gate sides, its name over the gate side
    const tc = ap(45, 75);
    const ta = 44;
    const tb = 20;
    const th = 8.5;
    const tw = rgba(0xe6e1d6);
    boxAt(g, tc[0], GROUND, tc[1], yawF, tb, th - GROUND, ta, tw);
    boxAt(g, tc[0], th, tc[1], yawF, tb + 0.4, 0.9, ta + 0.4, rgba(0xcfc9bd));
    for (const y of [0.9, 4.9]) {
      const gw = this.ap(45, 75 - tb / 2 - 0.05);
      boxAt(this.glass, gw[0], y, gw[1], yawF, 0.1, 2.6, ta - 4, WHITE, 2.8);
      const gg = this.ap(45 - ta / 2 - 0.05, 75);
      boxAt(this.glass, gg[0], y, gg[1], yawF, tb - 4, 2.6, 0.1, WHITE, 2.8);
    }
    const can = this.ap(45 - ta / 2 - 2.5, 75);
    boxAt(g, can[0], 3.4, can[1], yawF, 9, 0.3, 5, rgba(0x1b2740));
    for (const sd of [-1, 1]) {
      const cp = this.ap(45 - ta / 2 - 4.6, 75 + sd * 4);
      cylY(g, cp[0], 0, cp[1], 0.12, 0.12, 3.4, 6, C.galv);
    }
    const ts = this.ap(45 - ta / 2 - 0.08, 75);
    this.panel([ts[0], 7.6, ts[1]], yawF, 13, 2.03, 'fbo', 0.06);
    this.block(tc[0], tc[1], yawF, tb / 2, ta / 2, 0, th + 1);
    this.feet.push({ x: tc[0], z: tc[1], ax, az, hx: ta / 2, hz: tb / 2 });

    // The control tower, out by the runway; the windsock; floodlights round the apron
    const tw0 = ap(330, -230);
    cylY(g, tw0[0], GROUND, tw0[1], 3.2, 2.6, 24 - GROUND, 8, rgba(0xd8d3c8));
    cylY(this.glass, tw0[0], 24, tw0[1], 4.6, 5.2, 3.6, 8, WHITE, 4);
    cylY(g, tw0[0], 23.4, tw0[1], 4.8, 4.8, 0.6, 8, rgba(0xbfb9ad));
    cylY(g, tw0[0], 27.6, tw0[1], 5.6, 1.0, 1.2, 8, C.dark);
    const ws = ap(392, 130);
    cylY(g, ws[0], GROUND, ws[1], 0.08, 0.06, 6.6, 6, C.white);
    const wsDir: V3 = [fx(yawR - 0.6), -0.12, fz(yawR - 0.6)];
    const wsTop: V3 = [ws[0], 6.2, ws[1]];
    for (let k = 0; k < 4; k++) {
      const a = add(wsTop, wsDir, k * 0.9);
      const b = add(wsTop, wsDir, (k + 1) * 0.9);
      tube(g, a, b, 0.45 - k * 0.07, 0.38 - k * 0.07, 8, k % 2 ? C.white : C.orange);
    }
    for (const [a, b] of [[8, -126], [8, 156], [236, -126], [236, 156]]) {
      const [x, z] = ap(a, b);
      cylY(g, x, GROUND, z, 0.3, 0.2, 20, 8, C.galv);
      boxAt(g, x, 19.6, z, yawF + Math.PI / 4, 3.2, 1.0, 0.6, C.dark);
      boxAt(this.glow, x - fx(yawF + Math.PI / 4) * 0.31, 19.7, z - fz(yawF + Math.PI / 4) * 0.31, yawF + Math.PI / 4, 3.0, 0.8, 0.02, C.whiteLight);
    }
    // A couple of light singles by the hangar
    this.lightPlane(ap(55, -42), yawR + 0.2);
    this.lightPlane(ap(140, -48), yawR - 0.3);

    // ---- The jet's stand, the boss's stop, the paths
    const J = ap(130, 10);
    const jetYaw = yawF + Math.PI - 0.6;
    const jr: [number, number] = [rx(jetYaw), rz(jetYaw)];
    const jb: [number, number] = [-fx(jetYaw), -fz(jetYaw)];
    const jl = (x: number, z: number): [number, number] => [J[0] + jr[0] * x + jb[0] * z, J[1] + jr[1] * x + jb[1] * z];
    const jy = (a: number, b: number, c: number, d: number, w = 0.25): void => {
      const A = jl(a, b);
      const B = jl(c, d);
      stroke(this.paint, A[0], A[1], B[0], B[1], w, Y, C.yellow);
    };
    jy(0, 62, 0, -10.6);
    jy(-1.8, -11, 1.8, -11, 0.5);
    for (const [a, b, c, d] of [[-11, -13, 11, -13], [-11, 14, 11, 14], [-11, -13, -11, 14], [11, -13, 11, 14]]) {
      for (let t = 0; t < 1; t += 0.12) {
        const t1 = Math.min(1, t + 0.06);
        jy(a + (c - a) * t, b + (d - b) * t, a + (c - a) * t1, b + (d - b) * t1, 0.2);
      }
    }
    // Chocks and a ground power cart: something by the stand
    const gpu = jl(5.5, -4);
    boxAt(g, gpu[0], 0, gpu[1], jetYaw, 1.2, 1.0, 2.0, C.hiViz);
    // Blockers for the jet: fuselage and wings (as assumed: wings across local z −1..+4)
    const fc = jl(0, 0);
    this.block(fc[0], fc[1], jetYaw, 1.3, 10, 0, 3.4);
    const wc2 = jl(0, 1.5);
    this.block(wc2[0], wc2[1], jetYaw, 9.6, 2.6, 0.7, 2.2);

    const bossStop = jl(-8, -5.5);
    const stairFoot = jl(-4, -6);
    const path: [number, number][] = [[roadEnd.pos.x, roadEnd.pos.z], ap(30, 0), ap(70, 0.5), jl(-9.5, -30), jl(-8.6, -17), bossStop];
    // Back 25 m along the path from the stop: where the Civic skids in
    const lens: number[] = [0];
    for (let i = 1; i < path.length; i++) lens.push(lens[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const want = lens[lens.length - 1] - 25;
    let ci = 1;
    while (ci < path.length - 1 && lens[ci] < want) ci++;
    const k = (want - lens[ci - 1]) / (lens[ci] - lens[ci - 1]);
    const civ: [number, number] = [path[ci - 1][0] + (path[ci][0] - path[ci - 1][0]) * k, path[ci - 1][1] + (path[ci][1] - path[ci - 1][1]) * k];
    const civDir = V(path[ci][0] - path[ci - 1][0], 0, path[ci][1] - path[ci - 1][1]).normalize();
    const civicPath = [...path.slice(0, ci), civ].map(([x, z]) => V(x, 0, z));

    this.airport = {
      gate: { pos: roadEnd.pos.clone().setY(0), yaw: yawF },
      gateArm: arm,
      jet: { pos: V(J[0], 0, J[1]), yaw: jetYaw },
      bossStop: { pos: V(bossStop[0], 0, bossStop[1]), yaw: jetYaw + Math.PI },
      stairFoot: V(stairFoot[0], 0, stairFoot[1]),
      civicStop: { pos: V(civ[0], 0, civ[1]), yaw: yawOf(civDir) + 0.45 },
      bossPath: path.map(([x, z]) => V(x, 0, z)),
      civicPath
    };
  }

  /** A high-wing single, parked: white with a stripe. */
  private lightPlane(c: [number, number], yaw: number): void {
    const g = this.props;
    const P = (x: number, y: number, z: number): V3 => [c[0] + rx(yaw) * x - fx(yaw) * z, y, c[1] + rz(yaw) * x - fz(yaw) * z];
    const ax: V3 = [rx(yaw), 0, rz(yaw)];
    const az: V3 = [-fx(yaw), 0, -fz(yaw)];
    const body = rgba(0xf0f0ec);
    obox(g, P(0, 1.25, 0), ax, UP, az, 0.55, 0.6, 2.2, body);
    obox(g, P(0, 1.1, 3.2), ax, UP, az, 0.3, 0.35, 1.6, body);
    obox(g, P(0, 1.3, 0.2), ax, UP, az, 0.57, 0.08, 2.3, rgba(0x1d4f91));
    obox(g, P(0, 2.0, -0.3), ax, UP, az, 5.4, 0.07, 0.75, body);
    obox(g, P(0, 1.3, 4.6), ax, UP, az, 1.6, 0.05, 0.45, body);
    obox(g, P(0, 1.9, 4.7), ax, UP, az, 0.05, 0.65, 0.5, body);
    obox(g, P(0, 1.15, -2.35), ax, UP, az, 0.08, 0.7, 0.05, C.dark);
    for (const x of [-1.1, 1.1]) tube(g, P(x, 0.25, 0.3), P(x * 0.4, 0.8, 0.3), 0.04, 0.04, 4, C.dark);
    for (const x of [-1.1, 1.1]) {
      const w = P(x, 0, 0.3);
      cylY(g, w[0], 0, w[2], 0.25, 0.25, 0.3, 8, C.black);
    }
  }

  /** A three geometry into one of the batches (indexed or not), coloured. */
  private absorb(geo: THREE.BufferGeometry, into: Geo, col: RGBA): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const a: V3 = [p.getX(i), p.getY(i), p.getZ(i)];
      const b: V3 = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
      const c: V3 = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
      into.poly([a, b, c], null, col, null);
    }
  }

  // ------------------------------------------------------------ under-roads

  private buildUnderRoads(): void {
    for (const ch of this.underChains()) {
      const all = ch.span(ch.s0, ch.s1);
      extrude(this.asph, all, () => [[4.5, 0], [-4.5, 0]], C.asphaltDark, 5, true);
      extrude(this.asph, all, () => [[4.5, GROUND], [4.5, 0]], C.asphaltDark, 5);
      extrude(this.asph, all, () => [[-4.5, 0], [-4.5, GROUND]], C.asphaltDark, 5);
      for (const sd of [1, -1]) {
        this.line(ch, ch.s0, ch.s1, () => sd * 0.15, 0.12, C.yellow);
        this.line(ch, ch.s0, ch.s1, () => sd * 4.15, 0.12, C.white);
      }
    }
  }

  // --------------------------------------------------------------- buildings

  /**
   * One building: walls with windows (a shop front on the ground floor if
   * `shopFront`), a flat roof with a parapet. `ax` along its frontage, `az`
   * back from it; c is the footprint's middle.
   */
  private building(cx: number, cz: number, ax: [number, number], az: [number, number], w: number, d: number, h: number, tint: RGBA, shopFront: boolean): void {
    const corner = (sx: number, sz: number): [number, number] => [cx + ax[0] * (sx * w) / 2 + az[0] * (sz * d) / 2, cz + ax[1] * (sx * w) / 2 + az[1] * (sz * d) / 2];
    const ring: [number, number][] = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const base = PAD - 0.1;
    const shopH = shopFront ? 4.2 : 0;
    const winU = 3.0;
    const winV = 3.5;
    for (let i = 0; i < 4; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const out: V3 = norm([b[1] - a[1], 0, -(b[0] - a[0])]);
      // Outward: away from the centre
      const mx = (a[0] + b[0]) / 2 - cx;
      const mz = (a[1] + b[1]) / 2 - cz;
      const want: V3 = mx * out[0] + mz * out[2] > 0 ? out : neg(out);
      if (shopFront) {
        const nu = Math.max(1, Math.round(len / 4));
        this.shop.poly([[a[0], base, a[1]], [b[0], base, b[1]], [b[0], shopH, b[1]], [a[0], shopH, a[1]]], [[0, -0.02], [nu, -0.02], [nu, 1], [0, 1]], tint, want);
      }
      const nu = Math.max(1, Math.round(len / winU));
      const nv = Math.max(1, Math.round((h - shopH) / winV));
      const v0 = shopFront ? 0 : -0.02;
      this.win.poly([[a[0], shopFront ? shopH : base, a[1]], [b[0], shopFront ? shopH : base, b[1]], [b[0], h, b[1]], [a[0], h, a[1]]], [[0, v0], [nu, v0], [nu, nv], [0, nv]], tint, want);
    }
    // Roof and parapet
    const roof = shade(tint, 0.62);
    this.props.poly(ring.map(([x, z]) => [x, h - 0.3, z] as V3), null, roof, UP);
    for (let i = 0; i < 4; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % 4];
      beam(this.props, [a[0], h + 0.25, a[1]], [b[0], h + 0.25, b[1]], 0.35, 0.7, shade(tint, 0.85));
    }
    if (h > 18) {
      // A plant room on top
      const pc = corner(0.2, 0.25);
      obox(this.props, [pc[0], h + 1.2, pc[1]], [ax[0], 0, ax[1]], UP, [az[0], 0, az[1]], Math.min(4, w / 5), 1.5, Math.min(3.5, d / 5), rgba(0x8d9196));
    }
  }

  /** The avenue's blocks, both sides, and the cross streets' frontages. */
  private buildCityBlocks(): void {
    const rnd = lcg(1010);
    const ch = this.r.cityVis;
    const tint = (): RGBA => rgba(FACADES[Math.floor(rnd() * FACADES.length) % FACADES.length]);
    const along = (frame: (s: number) => RoadSample, s0: number, s1: number, side: 1 | -1, setback: number, opts: { hMin: number; hMax: number; dMin: number; dMax: number; shop: number; tall?: (s: number) => number }): void => {
      let s = s0;
      while (s < s1) {
        const w = 14 + rnd() * 18;
        const d = opts.dMin + rnd() * (opts.dMax - opts.dMin);
        const tallK = opts.tall ? opts.tall(s + w / 2) : 1;
        const h = opts.hMin + (opts.hMax - opts.hMin) * rnd() * rnd() * tallK + (rnd() < 0.08 * tallK ? 25 : 0);
        const gap = 1.5 + rnd() * 5;
        const f = frame(s + w / 2);
        const c = pt(f, side * (setback + d / 2), 0);
        const foot: Foot = { x: c[0], z: c[2], ax: [f.tangent.x, f.tangent.z], az: [f.right.x * side, f.right.z * side], hx: w / 2, hz: d / 2 };
        if (this.place(foot, 1.5)) {
          this.building(c[0], c[2], foot.ax, foot.az, w, d, Math.round(h / 3.5) * 3.5 + (rnd() < 0.5 ? 0 : 1.2), tint(), rnd() < opts.shop);
        }
        s += w + gap;
      }
    };
    const mid = (s: number): number => 0.6 + 0.9 * Math.exp(-(((s - 330) / 220) ** 2));
    const at = (s: number): RoadSample => ch.at(s);
    for (const side of [1, -1] as const) {
      along(at, -246, 640, side, WALK_OUT + 0.6, { hMin: 9, hMax: 46, dMin: 14, dMax: 26, shop: 0.75, tall: mid });
      along(at, -240, 635, side, WALK_OUT + 34, { hMin: 14, hMax: 62, dMin: 16, dMax: 30, shop: 0, tall: mid });
      along(at, -235, 630, side, WALK_OUT + 72, { hMin: 10, hMax: 40, dMin: 16, dMax: 28, shop: 0 });
    }
    for (const cc of this.crossChains()) {
      const atc = (s: number): RoadSample => cc.at(s);
      for (const side of [1, -1] as const) {
        along(atc, 14, 290, side, CROSS_WALK + 0.6, { hMin: 7, hMax: 30, dMin: 12, dMax: 22, shop: 0.4 });
        along(atc, 40, 280, side, CROSS_WALK + 30, { hMin: 7, hMax: 24, dMin: 14, dMax: 24, shop: 0 });
      }
    }
  }

  /** The edge of town under the highway: sheds and their yards, out past the city. */
  private buildOutskirts(): void {
    const rnd = lcg(2020);
    const ch = this.r.hwVis;
    const roofs = [0x7d858c, 0x6b7a86, 0x8c8478, 0x5f6e66, 0x9a9488];
    const walls = [0xcfc9bb, 0xb8bcbf, 0xd8cfb8, 0xa9b3b9, 0xc2b49c];
    const cityC = this.r.cityVis;
    const shed = (x: number, z: number, yaw: number): void => {
      const w = 26 + rnd() * 44;
      const d = 20 + rnd() * 30;
      const h = 6 + rnd() * 6;
      const ax: [number, number] = [rx(yaw), rz(yaw)];
      const az: [number, number] = [-fx(yaw), -fz(yaw)];
      // Keep out of the city's own blocks
      for (const s of [0, 200, 400, 600]) {
        const f = cityC.at(s);
        if (Math.hypot(f.pos.x - x, f.pos.z - z) < 170) return;
      }
      const foot: Foot = { x, z, ax, az, hx: w / 2 + 8, hz: d / 2 + 8 };
      if (!this.place(foot, 4)) return;
      const wall = rgba(walls[Math.floor(rnd() * walls.length) % walls.length]);
      boxAt(this.props, x, GROUND, z, yaw, w, h - GROUND, d, wall);
      // A shallow pitched roof
      const roof = rgba(roofs[Math.floor(rnd() * roofs.length) % roofs.length]);
      const P = (a: number, y: number, b: number): V3 => [x + ax[0] * a + az[0] * b, y, z + ax[1] * a + az[1] * b];
      const rh = h + 1.6;
      this.props.poly([P(-w / 2 - 0.3, h, -d / 2 - 0.3), P(w / 2 + 0.3, h, -d / 2 - 0.3), P(w / 2 + 0.3, rh, 0), P(-w / 2 - 0.3, rh, 0)], null, roof, UP);
      this.props.poly([P(w / 2 + 0.3, h, d / 2 + 0.3), P(-w / 2 - 0.3, h, d / 2 + 0.3), P(-w / 2 - 0.3, rh, 0), P(w / 2 + 0.3, rh, 0)], null, roof, UP);
      for (const sd of [-1, 1]) this.props.poly([P((sd * w) / 2, h, -d / 2), P((sd * w) / 2, h, d / 2), P((sd * w) / 2, rh, 0)], null, wall, [ax[0] * sd, 0, ax[1] * sd]);
      // Loading doors on one long side
      for (let a = -w / 2 + 5; a < w / 2 - 4; a += 7) {
        const q = P(a, 0, -d / 2 - 0.05);
        boxAt(this.props, q[0], 0, q[2], yaw, 4, 4.2, 0.1, rgba(0x6f767c));
      }
      // Its yard
      const Y = PAD + 0.02;
      flatQuad(this.asph, [[P(-w / 2 - 8, Y, -d / 2 - 14)[0], P(-w / 2 - 8, Y, -d / 2 - 14)[2]], [P(w / 2 + 8, Y, -d / 2 - 14)[0], P(w / 2 + 8, Y, -d / 2 - 14)[2]], [P(w / 2 + 8, Y, d / 2 + 6)[0], P(w / 2 + 8, Y, d / 2 + 6)[2]], [P(-w / 2 - 8, Y, d / 2 + 6)[0], P(-w / 2 - 8, Y, d / 2 + 6)[2]]], Y, C.yard, 5);
    };
    for (let u = -500; u < 1900; u += 26) {
      for (const sd of [1, -1]) {
        if (rnd() < 0.35) continue;
        const f = ch.at(u + rnd() * 10);
        const lat = sd > 0 ? 40 + rnd() * 170 : -55 - rnd() * 170;
        const p = pt(f, lat, 0);
        shed(p[0], p[2], yawOf(f.tangent) + (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.1);
      }
    }
    for (const uc of this.underChains()) {
      for (let s = uc.s0 + 20; s < uc.s1; s += 40) {
        for (const sd of [1, -1]) {
          if (rnd() < 0.4) continue;
          const f = uc.at(s);
          const p = pt(f, sd * (30 + rnd() * 30), 0);
          shed(p[0], p[2], yawOf(f.tangent));
        }
      }
    }
  }

  /** Other people's towns, out past everything in each direction: unlit, Level 8's way. */
  private buildSkyline(): void {
    const rnd = lcg(71);
    const tints = [0xc9c3b6, 0xa9b0b6, 0x8e8a80, 0xd8d2c4, 0x9aa4ae, 0xb7a58e, 0x7f8a94];
    const addBox = (x: number, z: number, w: number, d: number, h: number): void => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, h / 2 + GROUND, z);
      const p = g.attributes.position;
      const n = g.attributes.normal;
      const uv = g.attributes.uv;
      const xa = x - w / 2;
      const za = z - d / 2;
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, 0.02, 0.02);
        else if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, (p.getZ(i) - za) / 3.0, p.getY(i) / 3.5);
        else uv.setXY(i, (p.getX(i) - xa) / 3.0, p.getY(i) / 3.5);
      }
      const c = new THREE.Color(tints[Math.floor(rnd() * tints.length) % tints.length]);
      bakeShade(g, [c.r, c.g, c.b]);
      this.skyline.push(g.toNonIndexed());
    };
    const cluster = (count: number, x0: number, x1: number, z0: number, z1: number, hMin: number, hMax: number): void => {
      for (let i = 0, guard = 0; i < count && guard < count * 8; guard++) {
        const w = 18 + rnd() * 28;
        const d = 18 + rnd() * 28;
        const h = hMin + rnd() * rnd() * (hMax - hMin);
        const x = x0 + rnd() * (x1 - x0);
        const z = z0 + rnd() * (z1 - z0);
        if (this.clear.blocked(x, z, Math.max(w, d) / 2 + 10) || this.inAirport(x, z, 40)) continue;
        const foot: Foot = { x, z, ax: [1, 0], az: [0, 1], hx: w / 2, hz: d / 2 };
        if (this.feet.some((o) => overlaps(foot, o, 4))) continue;
        this.feet.push(foot);
        addBox(x, z, w, d, h);
        i++;
      }
    };
    cluster(34, -900, -330, -400, 350, 40, 150);
    cluster(40, -400, 2300, -1650, -1250, 12, 50);
    cluster(22, 2650, 3000, -1300, 200, 15, 60);
    cluster(26, 300, 1500, 350, 750, 10, 36);
    cluster(16, -700, 250, 450, 850, 12, 45);
  }

  // ----------------------------------------------------------------- trees

  private buildTrees(): void {
    const rnd = lcg(53);
    const spots = this.treeSpots;
    // Out in the fields: off the roads, out of the yards and the airfield
    for (let placed = 0, guard = 0; placed < 520 && guard < 9000; guard++) {
      const x = -900 + rnd() * 3700;
      const z = -1500 + rnd() * 2200;
      if (this.clear.blocked(x, z, 6) || this.inAirport(x, z, 15)) continue;
      const foot: Foot = { x, z, ax: [1, 0], az: [0, 1], hx: 2, hz: 2 };
      if (this.feet.some((o) => overlaps(foot, o, 2))) continue;
      spots.push({ x, y: GROUND, z, s: 1.0 + rnd() * 0.9 });
      placed++;
    }
    // A row along the airport road's verges
    const ch = this.r.air;
    for (let s = 20; s < ch.s1 - 20; s += 14) {
      for (const sd of [1, -1]) {
        const p = pt(ch.at(s + rnd() * 4), sd * (14 + rnd() * 3), 0);
        spots.push({ x: p[0], y: GROUND, z: p[2], s: 0.8 + rnd() * 0.4 });
      }
    }

    const trunkGeo = new THREE.CylinderGeometry(0.17, 0.26, 3.0, 7);
    trunkGeo.translate(0, 1.5, 0);
    bakeShade(trunkGeo);
    const lumps: [number, number, number, number][] = [
      [0, 4.4, 0, 1.9],
      [0.85, 5.25, 0.35, 1.45],
      [-0.75, 4.95, -0.45, 1.4],
      [0.1, 5.9, -0.2, 1.1]
    ];
    const crownGeo = mergeGeometries(
      lumps.map(([x, y, z, r]) => {
        const g = new THREE.IcosahedronGeometry(r, 1);
        g.translate(x, y, z);
        bakeShade(g);
        return g;
      }),
      false
    );
    const trunks = new THREE.InstancedMesh(trunkGeo, this.m.trunk, spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, this.m.crown, spots.length);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    spots.forEach((t, i) => {
      mtx.compose(p.set(t.x, t.y, t.z), q, sc.set(t.s, t.s * (0.9 + rnd() * 0.25), t.s));
      trunks.setMatrixAt(i, mtx);
      crowns.setMatrixAt(i, mtx);
      crowns.setColorAt(i, col.setHSL(0.24 + rnd() * 0.08, 0.36 + rnd() * 0.2, 0.2 + rnd() * 0.09));
      trunks.setColorAt(i, col.setHSL(0.07 + rnd() * 0.03, 0.22 + rnd() * 0.1, 0.12 + rnd() * 0.05));
    });
    for (const im of [trunks, crowns]) {
      im.frustumCulled = false;
      this.group.add(im);
    }
  }

  // ------------------------------------------------------------------- sky

  /**
   * The sky sphere and the sun, carried on the camera: the route is three
   * kilometres long, and a fixed sphere big enough for all of it would be
   * past any sane far plane. Each is moved to the camera in onBeforeRender,
   * after the world matrices are made and before it is drawn.
   */
  private buildSky(): void {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1150, 32, 16), this.m.sky);
    sky.name = 'street-sky';
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    const cam = new THREE.Vector3();
    sky.onBeforeRender = (_r, _s, camera) => {
      cam.setFromMatrixPosition(camera.matrixWorld);
      sky.matrixWorld.makeTranslation(cam.x, cam.y, cam.z);
    };
    this.group.add(sky);
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), this.m.sun);
    sun.name = 'street-sun';
    sun.frustumCulled = false;
    sun.renderOrder = -1;
    const sp = new THREE.Vector3();
    sun.onBeforeRender = (_r, _s, camera) => {
      cam.setFromMatrixPosition(camera.matrixWorld);
      sp.copy(cam).addScaledVector(SUN_DIR, 1080);
      sun.matrixWorld.lookAt(cam, sp, THREE.Object3D.DEFAULT_UP);
      sun.matrixWorld.setPosition(sp);
    };
    this.group.add(sun);
  }

  /** Daylight only, Level 8's three lights; no shadows. The sun's direction is `sunDir`. */
  private buildLighting(): void {
    this.group.add(new THREE.AmbientLight(0xbfc8d2, 0.5));
    this.group.add(new THREE.HemisphereLight(0xcfe0f2, 0x6b6358, 1.25));
    const sun = new THREE.DirectionalLight(0xffe4c2, 2.9);
    sun.name = 'street-sun-light';
    const c = V(600, 0, -500);
    sun.position.copy(c).addScaledVector(SUN_DIR, 300);
    sun.target.position.copy(c);
    this.group.add(sun, sun.target);
  }

  // ---------------------------------------------------------------- finish

  private finish(): void {
    const m = this.m;
    const add = (geo: Geo, mat: THREE.Material, colours: 'none' | 'rgb' | 'rgba', name: string, surface: string | null, order = 0): void => {
      if (geo.empty) return;
      const mesh = new THREE.Mesh(geo.geometry(colours), mat);
      mesh.name = `street-${name}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      if (surface) mesh.userData.surface = surface;
      this.group.add(mesh);
    };
    add(this.grass, m.grass, 'none', 'grass', 'grass');
    add(this.asph, m.asphalt, 'rgb', 'asphalt', 'concrete');
    add(this.apron, m.apron, 'rgb', 'apron', 'concrete');
    add(this.walk, m.walk, 'none', 'walk', 'concrete');
    add(this.conc, m.conc, 'rgb', 'concrete', 'concrete');
    add(this.paint, m.paint, 'rgb', 'paint', null);
    add(this.win, m.win, 'rgb', 'windows', 'concrete');
    add(this.shop, m.shop, 'rgb', 'shops', 'glass');
    add(this.props, m.props, 'rgb', 'props', 'metal');
    add(this.glow, m.glow, 'rgb', 'lamps', 'glass');
    add(this.sign, m.sign, 'none', 'signs', 'metal');
    add(this.glass, m.glass, 'rgb', 'glass', 'glass');
    add(this.fence, m.fence, 'none', 'fence', 'metal', 2);
    add(this.soft, m.soft, 'rgba', 'shade', null, 1);
    if (this.skyline.length) {
      const mesh = new THREE.Mesh(mergeGeometries(this.skyline, false), m.skyline);
      mesh.name = 'street-skyline';
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }
}

/** A barrier on the left edge (named apart from the `barL` flag above). */
function barL_(b: number): Prof {
  return barL(b);
}
