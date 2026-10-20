import * as THREE from 'three';
import { HAND, RaviRig, RaviVisual, elbowToward, type HandShape, type Side } from './RaviVisual';

/**
 * RaviStunt — the whole-body poses for Map 11's runway stunt: Ravi climbs
 * out of the Civic's sunroof, crouches on the roof, leaps onto the jet's
 * left wing, lands, crawls along it and dives head first into a vent.
 *
 *   const stunt = new RaviStunt(RaviVisual.rig('body'));
 *   stunt.set('emerge', k);   // poses and applies the whole body
 *
 * Every pose is a function of one number k, worked out fresh on each call,
 * so the scene can run any of them at any speed (slow motion included) or
 * scrub them. Hands, feet and knees that should be planted are put there
 * with the rig's own IK (RaviRig.reach / leg), elbows and knees bent toward
 * poles chosen per beat. Inside a pose the beats are blended with a monotone
 * cubic, so a planted hand stays put between two beats that agree on it,
 * and nothing overshoots.
 *
 * The end of each pose is built from the start of the next, so a scene that
 * switches pose at k = 1 → k = 0 gets no pop, as long as it puts the new
 * root where these numbers say (RaviStunt.ROOF / onRoof(), landToCrawl,
 * crawlToDive, and pelvis() for the leap's arc).
 *
 * Model space throughout: Y up, he faces +Z, his left on +X. The scene puts
 * rig.root in the world (position, and rotation.y for his heading; it may
 * also tilt it to a sloping surface such as a wing with dihedral).
 *
 * Roots, pose by pose (all yaw via rotation.y; tilt allowed on the wing/fuselage):
 *  - seated, emerge: the Civic's seat hip point (seatOf().hip), facing the
 *    car's front. Under the car body, as the drivers are now, that is
 *    root.position = (seat.hip.x, seat.hip.y − body.position.y, seat.hip.z),
 *    rotation.y = π. 'seated' is then exactly Level 8's / the street's
 *    driver; 'emerge' ends standing on both front cushions, his hips at
 *    (−0.37, 0.78, −0.32) from the root, out of the sunroof to the waist.
 *  - climb, crouch: a point on the roof skin between his feet in the crouch,
 *    behind the sunroof, facing the car's driver's side (car −X): onRoof()
 *    gives it from the seat root (car-local (−0.17, 1.462, 1.27), yaw −π/2).
 *  - leap: the midpoint of his hip joints, flown by the scene from
 *    crouchRoot + pelvis('crouch', 1) to landRoot + pelvis('land', 0).
 *  - land: the surface point under his hips at touchdown (k = 0); his hips
 *    are 0.784 above it then.
 *  - crawl: the surface point under his hips, moved forward CRAWL_STRIDE per
 *    cycle by the scene; at k = 0 it is landToCrawl ahead of the land root.
 *  - dive: the vent's near rim, centred on him, the root's XZ plane the skin
 *    around it; the opening runs forward (+Z, up the fuselage when tilted)
 *    from the rim, at least 0.6 × 0.6 m, and he goes in along −Y. At k = 0 it
 *    is crawlToDive ahead of the crawl root (at crawl k ≡ 0).
 */
export type StuntPose = 'seated' | 'emerge' | 'climb' | 'crouch' | 'leap' | 'land' | 'crawl' | 'dive';

type V3 = [number, number, number];

interface LegKey {
  /** Ankle joint, model space (or from the hip joint, with from: 'hip'). */
  ankle: V3;
  from?: 'model' | 'hip';
  /** Which way the knee points. */
  pole: V3;
  /** The foot laid in model space: pitch (+ toes down) and yaw (+ toes to his left), degrees. */
  flat?: [number, number];
  /** The foot carried by the shin instead, pointed by this much (+ toes away from the shin's front). */
  point?: number;
  /** 0 = the `flat` foot, 1 = the shin-carried one. */
  w?: number;
  /** Toes bent at the ball, degrees (+ curled under, − bent up). */
  toe?: number;
  /** Where the knee joint lands (kneeling legs; for reference, not blended). */
  knee?: V3;
}

interface ArmKey {
  /** Wrist joint, model space (or from the shoulder joint, with from: 'shoulder'). */
  wrist: V3;
  from?: 'model' | 'shoulder';
  /** Wrist to middle knuckle. */
  along: V3;
  /** Which way the palm faces. */
  palm: V3;
  /** Which way the elbow points. */
  pole: V3;
  shape: HandShape;
}

interface Key {
  t: number;
  /** Midpoint of his hip joints. */
  hips: V3;
  /** Degrees for pelvis, spine_01, spine_02, spine_03, neck_01, head (the pelvis in model space, the rest on their parents). + = forward. */
  lean: number[];
  /** + turns to his left. */
  twist?: number[];
  /** + drops his right side. */
  roll?: number[];
  legs: Record<Side, LegKey>;
  arms: Record<Side, ArmKey>;
}

const TRUNK = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'];
const SIDES: Side[] = ['l', 'r'];
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ dimensions
// Measured off the skinned mesh: how far each joint sits off a surface it touches
/** Ankle joint over the sole, foot flat. */
const ANKLE_UP = 0.078;
/** Ankle joint over the surface, up on the balls of the feet (foot pitched 25°, toes bent back flat). */
const BALLS_UP = 0.14;
/** Wrist joint over a surface the palm is flat on. */
const WRIST_UP = 0.064;
/** Wrist joint over a surface the fingertips touch (TIPS, the hand 53° down). */
const TIP_UP = 0.175;
/** Knee joint over a surface he kneels on. */
const KNEE_UP = 0.073;

// ------------------------------------------------------------------ hand shapes
const shape = (f: [number, number, number], thumb: [number, number, number], spread = 0, add = 2): HandShape => ({
  fingers: [0, 1, 2, 3].map((i) => [f[0] + i * add, f[1] + i * add, f[2] + i * add * 0.5]) as HandShape['fingers'],
  thumb,
  spread
});
/** Round the steering wheel, as the drivers in Level 8 and the street hold it. */
const GRIP: HandShape = { fingers: [[70, 80, 40], [72, 82, 40], [74, 84, 42], [76, 86, 44]], thumb: [0.45, 0.5, 0.3] };
/** Flat on a surface, fingers fanned for purchase. */
const PLANT = shape([4, 6, 3], [0.05, 0.12, 0.1], 9, 1);
/** Hooked over an edge. */
const HOOK = shape([48, 62, 34], [0.3, 0.35, 0.25], 3);
/** Fingertips down on a surface. */
const TIPS = shape([18, 22, 10], [0.2, 0.25, 0.2], 6);
/** Stretched open, reaching. */
const REACH = shape([8, 10, 6], [0.1, 0.18, 0.12], 7, 1);
const LOOSE = HAND.relaxed;

// ------------------------------------------------------------------ the Civic
// The driver's seat, from its hip point (the root for 'seated' and 'emerge'),
// in his model space (+Z to the car's front, +X to the car's left = driver's
// side). Car-local: hip (−0.37, 0.5, 0.32), wheel (−0.37, 0.86, −0.06), roof
// skin 1.462, the sunroof x −0.38…+0.38, z 0.385…0.935. Car-local to model:
// x_m = −(x_c + 0.37), y_m = y_c − 0.5, z_m = −(z_c − 0.32).
const WHEEL: V3 = [0, 0.36, 0.38];
const CUSHION_Y = -0.04;
const ROOF_Y = 0.962;
/** The passenger seat's cushion centre, across the car. */
const PASSENGER_X = -0.74;
/** Ankle on the cushion. */
const STAND_Y = CUSHION_Y + ANKLE_UP + 0.005;

// ------------------------------------------------------------------ math
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Ry(twist)·Rx(lean)·Rz(roll): roll on his own front axis, then lean forward, then turn. */
function euler(lean: number, twist: number, roll: number, out = new THREE.Quaternion()): THREE.Quaternion {
  out.setFromAxisAngle(Y, twist * D2R);
  out.multiply(_q.setFromAxisAngle(X, lean * D2R));
  if (roll) out.multiply(_q.setFromAxisAngle(Z, roll * D2R));
  return out;
}

/** Rotation whose Y column is `y` and Z column is `z` (made perpendicular). */
function basisQ(y: THREE.Vector3, z: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const Yc = y.clone().normalize();
  const Zc = z.clone().addScaledVector(Yc, -z.dot(Yc)).normalize();
  const Xc = new THREE.Vector3().crossVectors(Yc, Zc);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xc, Yc, Zc));
}

/** Rotation taking rest vectors (a0, b0) onto (a1, b1), as RaviRig.leg works its bones out. */
function frameQ(a0: THREE.Vector3, b0: THREE.Vector3, a1: THREE.Vector3, b1: THREE.Vector3): THREE.Quaternion {
  const q0 = basisQ(a0, b0);
  return basisQ(a1, b1).multiply(q0.invert());
}

/** Where the middle joint of a two-bone limb goes (as RaviVisual's own). */
function twoBone(root: THREE.Vector3, end: THREE.Vector3, a: number, b: number, pole: THREE.Vector3): THREE.Vector3 {
  const w = end.clone().sub(root);
  const d = THREE.MathUtils.clamp(w.length(), Math.abs(a - b) + 1e-3, (a + b) * 0.999);
  w.normalize();
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const n = pole.clone().addScaledVector(w, -pole.dot(w)).normalize();
  return root.clone().addScaledVector(w, x).addScaledVector(n, h);
}

/** Fritsch–Butland slope at a key: zero where the track turns, so holds hold and nothing overshoots. */
function slope(d0: number, d1: number, h0: number, h1: number): number {
  if (d0 * d1 <= 0) return 0;
  return (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
}

/** Monotone cubic through the keys' values at k; flat at the first and last key. */
function track(ts: number[], vs: number[][], k: number): number[] {
  const n = ts.length;
  if (n === 1 || k <= ts[0]) return vs[0].slice();
  if (k >= ts[n - 1]) return vs[n - 1].slice();
  let i = 0;
  while (i < n - 2 && k > ts[i + 1]) i++;
  const h = ts[i + 1] - ts[i];
  const s = (k - ts[i]) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const a = vs[i];
  const b = vs[i + 1];
  const out = new Array<number>(a.length);
  for (let c = 0; c < a.length; c++) {
    const d = (b[c] - a[c]) / h;
    const m0 = i > 0 ? slope((a[c] - vs[i - 1][c]) / (ts[i] - ts[i - 1]), d, ts[i] - ts[i - 1], h) : 0;
    const m1 = i + 2 < n ? slope(d, (vs[i + 2][c] - b[c]) / (ts[i + 2] - ts[i + 1]), h, ts[i + 2] - ts[i + 1]) : 0;
    out[c] = h00 * a[c] + h10 * h * m0 + h01 * b[c] + h11 * h * m1;
  }
  return out;
}

const mir = (v: V3): V3 => [-v[0], v[1], v[2]];

function shapeArr(s: HandShape): number[] {
  const out: number[] = [];
  for (const f of s.fingers) out.push(f[0], f[1], f[2]);
  out.push(s.thumb[0], s.thumb[1], s.thumb[2], s.spread ?? 0);
  for (let i = 0; i < 4; i++) out.push(s.splay?.[i] ?? 0);
  return out;
}
function shapeOf(a: number[], o: number): HandShape {
  const f = (i: number): [number, number, number] => [a[o + i * 3], a[o + i * 3 + 1], a[o + i * 3 + 2]];
  return {
    fingers: [f(0), f(1), f(2), f(3)],
    thumb: [a[o + 12], a[o + 13], a[o + 14]],
    spread: a[o + 15],
    splay: [a[o + 16], a[o + 17], a[o + 18], a[o + 19]]
  };
}
function mixShape(a: HandShape, b: HandShape, k: number): HandShape {
  const x = shapeArr(a);
  const y = shapeArr(b);
  return shapeOf(
    x.map((v, i) => v + (y[i] - v) * k),
    0
  );
}

function pad6(a: number[] | undefined): number[] {
  const o = [0, 0, 0, 0, 0, 0];
  if (a) for (let i = 0; i < 6; i++) o[i] = a[i] ?? 0;
  return o;
}

function legArr(l: LegKey, H: THREE.Vector3): number[] {
  const A = l.from === 'hip' ? [H.x + l.ankle[0], H.y + l.ankle[1], H.z + l.ankle[2]] : l.ankle;
  return [A[0], A[1], A[2], ...l.pole, l.flat?.[0] ?? 0, l.flat?.[1] ?? 0, l.point ?? 0, l.w ?? 0, l.toe ?? 0];
}

function armArr(a: ArmKey, S: THREE.Vector3): number[] {
  const W = a.from === 'shoulder' ? [S.x + a.wrist[0], S.y + a.wrist[1], S.z + a.wrist[2]] : a.wrist;
  return [W[0], W[1], W[2], ...a.along, ...a.palm, ...a.pole, ...shapeArr(a.shape)];
}

// ------------------------------------------------------------------ key edits
function cloneKey(k: Key, t = k.t): Key {
  return JSON.parse(JSON.stringify({ ...k, t })) as Key;
}

/** The same body with every model-space point moved by d. */
function shifted(k: Key, d: V3, t = k.t): Key {
  const o = cloneKey(k, t);
  const add = (v: V3): V3 => [v[0] + d[0], v[1] + d[1], v[2] + d[2]];
  o.hips = add(o.hips);
  for (const sd of SIDES) {
    if (o.legs[sd].knee) o.legs[sd].knee = add(o.legs[sd].knee!);
    if (o.legs[sd].from !== 'hip') o.legs[sd].ankle = add(o.legs[sd].ankle);
    if (o.arms[sd].from !== 'shoulder') o.arms[sd].wrist = add(o.arms[sd].wrist);
  }
  return o;
}

/**
 * The same body seen from another root: one at `at` (in this key's space)
 * turned by `yaw` degrees (+ to his left). Points and directions are carried
 * into the new root's space.
 */
function reframed(k: Key, at: V3, yaw: number, t = k.t): Key {
  const o = cloneKey(k, t);
  const c = Math.cos(-yaw * D2R);
  const s = Math.sin(-yaw * D2R);
  const dir = (v: V3): V3 => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  const pt = (v: V3): V3 => dir([v[0] - at[0], v[1] - at[1], v[2] - at[2]]);
  o.hips = pt(o.hips);
  o.twist = pad6(o.twist);
  o.twist[0] -= yaw;
  for (const sd of SIDES) {
    const l = o.legs[sd];
    l.ankle = l.from === 'hip' ? dir(l.ankle) : pt(l.ankle);
    if (l.knee) l.knee = pt(l.knee);
    l.pole = dir(l.pole);
    l.flat = [l.flat?.[0] ?? 0, (l.flat?.[1] ?? 0) - yaw];
    const a = o.arms[sd];
    a.wrist = a.from === 'shoulder' ? dir(a.wrist) : pt(a.wrist);
    a.along = dir(a.along);
    a.palm = dir(a.palm);
    a.pole = dir(a.pole);
  }
  return o;
}

/** A palm-down hand planted at (x, z) on the surface (y = 0), fingers along `along`. */
function flatHand(x: number, z: number, along: V3, pole: V3, y = 0): ArmKey {
  return { wrist: [x, y + WRIST_UP, z], along, palm: [0, -1, 0], pole, shape: PLANT };
}

// ------------------------------------------------------------------ the stunt
export class RaviStunt {
  /**
   * The crouch root (the climb's too) from the seat root: put it here in the
   * seat root's space, turned this many degrees (+90: to his left, so he
   * faces the car's driver's side, −X car-local). That is on the roof skin
   * behind the sunroof, car-local (−0.17, 1.462, 1.27), rotation.y −π/2 in
   * the car. onRoof() does the sums.
   */
  static readonly ROOF = { at: new THREE.Vector3(-0.2, ROOF_Y, -0.95), yaw: 90 };
  /**
   * The Civic's sunroof in the seat root's space (car-local x −0.38…+0.38,
   * z 0.385…0.935, roof skin 1.462): to his right and behind him, its plane
   * 0.962 above the hip point. The roof itself runs x −1.04…+0.30,
   * z +0.04…−1.30 here.
   */
  static readonly OPENING = { minX: -0.75, maxX: 0.01, minZ: -0.615, maxZ: -0.065, y: ROOF_Y };
  /** How far the crawl's root goes forward over one cycle (k 0 → 1). */
  static readonly CRAWL_STRIDE = 0.6;

  /** The crawl's root at its k = 0, from the land's root: this far ahead (+Z) of where he touched down. */
  readonly landToCrawl = 0.45;
  /** The dive's root (the hatch's near rim), from the crawl's root at crawl k = 0 (≡ 1): this far ahead (+Z). */
  readonly crawlToDive: number;
  /** The IK targets of the last set(), model space: hand_l/hand_r wrists, foot_l/foot_r ankles (for checking reach). */
  readonly targets: Record<string, THREE.Vector3> = {};

  private keys = new Map<StuntPose, Key[]>();
  private thigh: number;
  private calf: number;
  private hipHalf: number;

  constructor(private rig: RaviRig) {
    this.thigh = RaviRig.len('thigh_l', 'calf_l');
    this.calf = RaviRig.len('calf_l', 'foot_l');
    this.hipHalf = RaviVisual.restBone('thigh_l').modelP.x;
    const c0 = this.crawlKey(0);
    // The rim just past his fingertips
    this.crawlToDive = Math.max(c0.arms.l.wrist[2], c0.arms.r.wrist[2]) + 0.2;
    this.build();
  }

  /**
   * The crouch root (on the roof) for a seat root at `seatPos` turned
   * `seatYaw` radians (rotation.y), both in the same parent space; writes
   * its position into `out` and returns its rotation.y.
   */
  static onRoof(seatPos: THREE.Vector3, seatYaw: number, out: THREE.Vector3): number {
    out.copy(RaviStunt.ROOF.at).applyAxisAngle(Y, seatYaw).add(seatPos);
    return seatYaw + RaviStunt.ROOF.yaw * D2R;
  }

  /** Where the midpoint of his hip joints is for `pose` at `k`, in that pose's root space (no rig needed). */
  pelvis(pose: StuntPose, k: number, out = new THREE.Vector3()): THREE.Vector3 {
    if (pose === 'crawl') return out.fromArray(this.crawlKey(k).hips);
    const keys = this.keys.get(pose)!;
    const T = track(
      keys.map((q) => q.t),
      keys.map((q) => q.hips),
      THREE.MathUtils.clamp(k, 0, 1)
    );
    return out.set(T[0], T[1], T[2]);
  }

  /** Pose the whole body for `pose` at progress `k` and apply() it. For 'crawl', k is the cycle phase (any real; it wraps). */
  set(pose: StuntPose, k: number): void {
    if (pose === 'crawl') {
      this.drive([this.crawlKey(k)], 0);
      return;
    }
    this.drive(this.keys.get(pose)!, THREE.MathUtils.clamp(k, 0, 1));
  }

  // ---------------------------------------------------------------- driving
  private drive(keys: Key[], k: number): void {
    const r = this.rig;
    const ts = keys.map((q) => q.t);
    const T = track(
      ts,
      keys.map((q) => [...q.hips, ...pad6(q.lean), ...pad6(q.twist), ...pad6(q.roll)]),
      k
    );
    r.clear();
    for (let i = 0; i < 6; i++) r.rel(TRUNK[i], euler(T[3 + i], T[9 + i], T[15 + i]));
    r.apply();
    const mid = r.at('thigh_l', _a).add(r.at('thigh_r', _b)).multiplyScalar(0.5);
    r.move('pelvis', new THREE.Vector3(T[0], T[1], T[2]).sub(mid));
    r.apply();
    for (const sd of SIDES) {
      const H = r.at(`thigh_${sd}`);
      const L = track(
        ts,
        keys.map((q) => legArr(q.legs[sd], H)),
        k
      );
      this.targets[`foot_${sd}`] = new THREE.Vector3(L[0], L[1], L[2]);
      this.placeLeg(sd, H, L);
    }
    r.apply();
    for (const sd of SIDES) {
      const S = r.at(`upperarm_${sd}`);
      const A = track(
        ts,
        keys.map((q) => armArr(q.arms[sd], S)),
        k
      );
      const W = new THREE.Vector3(A[0], A[1], A[2]);
      this.targets[`hand_${sd}`] = W.clone();
      const along = new THREE.Vector3(A[3], A[4], A[5]).normalize();
      const palm = new THREE.Vector3(A[6], A[7], A[8]).normalize();
      const pole = new THREE.Vector3(A[9], A[10], A[11]);
      r.reach(sd, W, along, palm, elbowToward(W, S, pole), S, 0.5, false).hand(sd, shapeOf(A, 12));
    }
    r.apply();
  }

  private placeLeg(sd: Side, H: THREE.Vector3, L: number[]): void {
    const r = this.rig;
    const th = `thigh_${sd}`;
    const ca = `calf_${sd}`;
    const A = new THREE.Vector3(L[0], L[1], L[2]);
    const pole = new THREE.Vector3(L[3], L[4], L[5]);
    const K = twoBone(H, A, this.thigh, this.calf, pole);
    const d1 = K.clone().sub(H).normalize();
    const d2 = A.clone().sub(K).normalize();
    const front = d1.clone().sub(d2);
    if (front.lengthSq() < 0.02) front.copy(pole).addScaledVector(d1, -pole.dot(d1));
    front.normalize();
    r.leg(sd, H, d1, d2, front, false);
    // The foot: laid in model space, or carried by the shin and pointed
    const hinge = new THREE.Vector3().crossVectors(d1, front).normalize();
    const hinge0 = new THREE.Vector3().crossVectors(RaviRig.dir(th), Z).normalize();
    const calfQ = frameQ(RaviRig.dir(ca), hinge0, d2, hinge);
    const shin = new THREE.Quaternion().setFromAxisAngle(hinge, -L[8] * D2R).multiply(calfQ);
    const flat = euler(L[6], L[7], 0, new THREE.Quaternion());
    r.abs(`foot_${sd}`, flat.slerp(shin, THREE.MathUtils.clamp(L[9], 0, 1)));
    if (Math.abs(L[10]) > 0.01) r.rel(`ball_${sd}`, new THREE.Quaternion().setFromAxisAngle(X, L[10] * D2R));
  }

  /** One hip joint, for a hip midpoint `hips` and a pelvis turned (lean, twist, roll). */
  private hipJoint(sd: Side, hips: V3, lean: number, twist: number, roll: number): THREE.Vector3 {
    return new THREE.Vector3(sd === 'l' ? this.hipHalf : -this.hipHalf, 0, 0).applyQuaternion(euler(lean, twist, roll)).add(new THREE.Vector3(...hips));
  }

  /**
   * A leg kneeling with its knee on the surface (y = 0) at (x, z): with
   * `slide`, the knee slides along x or z until it is exactly a thigh's
   * length from the hip, the shin lies back behind it rising `up` degrees, and the
   * foot follows the shin, pointed back.
   */
  private kneel(sd: Side, hips: V3, pel: [number, number, number], x: number, z: number, opt: { up?: number; slide?: 'x' | 'z'; point?: number; lift?: number } = {}): LegKey {
    const Hj = this.hipJoint(sd, hips, pel[0], pel[1], pel[2]);
    const ky = KNEE_UP + (opt.lift ?? 0);
    const K = new THREE.Vector3(x, ky, z);
    const rest = this.thigh * this.thigh - (Hj.y - ky) ** 2;
    if (opt.slide === 'x') {
      const R = rest - (Hj.z - z) ** 2;
      if (R > 0) K.x = Hj.x + Math.sign(x - Hj.x || (sd === 'l' ? 1 : -1)) * Math.sqrt(R);
    } else if (opt.slide === 'z') {
      const R = rest - (Hj.x - x) ** 2;
      if (R > 0) K.z = Hj.z + Math.sign(z - Hj.z || 1) * Math.sqrt(R);
    }
    const up = (opt.up ?? 4) * D2R;
    const A = K.clone().add(new THREE.Vector3(0, Math.sin(up), -Math.cos(up)).multiplyScalar(this.calf));
    const pole = K.clone().sub(Hj.clone().add(A).multiplyScalar(0.5));
    return { ankle: A.toArray() as V3, pole: pole.toArray() as V3, w: 1, point: opt.point ?? 72, toe: 10, knee: K.toArray() as V3 };
  }

  /**
   * A leg laid by direction: the thigh from the hip joint along `thigh`, the
   * shin from the knee along `shin` (both model space, any length), the foot
   * carried by the shin and pointed by `point`.
   */
  private legFK(sd: Side, hips: V3, pel: [number, number, number], thigh: V3, shin: V3, point = 60): LegKey {
    const Hj = this.hipJoint(sd, hips, pel[0], pel[1], pel[2]);
    const K = Hj.clone().addScaledVector(new THREE.Vector3(...thigh).normalize(), this.thigh);
    const A = K.clone().addScaledVector(new THREE.Vector3(...shin).normalize(), this.calf);
    const pole = K.clone().sub(Hj.clone().add(A).multiplyScalar(0.5));
    return { ankle: A.toArray() as V3, pole: pole.toArray() as V3, w: 1, point, knee: K.toArray() as V3 };
  }

  /** Hips at (x, ?, z), the height that puts one hip joint exactly a thigh's length from knee joint K. */
  private hipsOver(sd: Side, K: V3, x: number, z: number, pel: [number, number, number]): V3 {
    const o = this.hipJoint(sd, [x, 0, z], pel[0], pel[1], pel[2]);
    const R = this.thigh * this.thigh - (o.x - K[0]) ** 2 - (o.z - K[2]) ** 2;
    return [x, K[1] - o.y + Math.sqrt(Math.max(0.01, R)), z];
  }

  // ---------------------------------------------------------------- the crawl
  /**
   * On hands and knees, low and flat, one cycle per k: left hand and right
   * knee step together, then right hand and left knee. Root under the hips,
   * going forward CRAWL_STRIDE per cycle; each planted hand and knee goes
   * back at that speed, so it stays where it was put.
   */
  private crawlKey(k: number): Key {
    const ph = ((k % 1) + 1) % 1;
    const S = RaviStunt.CRAWL_STRIDE;
    const SW = 0.45;
    const E = S * (1 - SW);
    /** A limb's place in the cycle: z (back to front), lift 0…1, and how far through its swing (−1 when planted). */
    const limb = (off: number, zc: number): { z: number; lift: number; sw: number } => {
      const u = (((ph - off) % 1) + 1) % 1;
      if (u < SW) {
        const s = u / SW;
        // Leaves the ground and arrives moving back with it
        const m = -S * SW;
        const s2 = s * s;
        const s3 = s2 * s;
        const z = (2 * s3 - 3 * s2 + 1) * (zc - E / 2) + (s3 - 2 * s2 + s) * m + (-2 * s3 + 3 * s2) * (zc + E / 2) + (s3 - s2) * m;
        return { z, lift: Math.sin(Math.PI * s), sw: s };
      }
      const s = (u - SW) / (1 - SW);
      return { z: zc + E / 2 - E * s, lift: 0, sw: -1 };
    };
    const c2 = Math.cos(2 * Math.PI * ph);
    const s2 = Math.sin(2 * Math.PI * ph);
    // The pelvis turns toward the knee swinging forward and rolls onto the planted one; the shoulders counter
    const twist = 6 * s2;
    const roll = -3 * s2;
    const sway = -0.012 * s2;
    const lean = [76 + 1.5 * c2, 10, 9, 8, -42, -36];
    const tw = [twist, -3 * s2, -4 * s2, -5 * s2, 4 * s2, 4 * s2];
    const rl = [roll, 1 * s2, 1 * s2, 1.5 * s2, 0, 1 * s2];
    const knee = { l: limb(0.56, 0), r: limb(0.06, 0) };
    const KX = 0.2;
    // Hips: as high as the planted knees let them be, a thigh's length off each
    let hw = 0;
    let hs = 0;
    for (const sd of SIDES) {
      const kn = knee[sd];
      const o = this.hipJoint(sd, [sway, 0, 0], lean[0], twist, roll);
      const kx = sd === 'l' ? KX : -KX;
      const R = this.thigh * this.thigh - (o.x - kx) ** 2 - (o.z - kn.z) ** 2;
      const h = KNEE_UP - o.y + Math.sqrt(Math.max(0.01, R));
      const w = kn.sw < 0 ? 1 : 0.05 + 0.95 * Math.abs(2 * kn.sw - 1) ** 6;
      hw += w;
      hs += w * h;
    }
    const hips: V3 = [sway, hs / hw, 0];
    const legs = {} as Record<Side, LegKey>;
    for (const sd of SIDES) {
      const kn = knee[sd];
      const kx = sd === 'l' ? KX : -KX;
      legs[sd] = this.kneel(sd, hips, [lean[0], twist, roll], kx, kn.z, {
        slide: kn.sw < 0 ? 'x' : undefined,
        lift: 0.05 * kn.lift,
        up: 4 + 10 * kn.lift,
        point: 72 - 10 * kn.lift
      });
    }
    const hand = { l: limb(0.0, 0.62), r: limb(0.5, 0.62) };
    const arms = {} as Record<Side, ArmKey>;
    for (const sd of SIDES) {
      const h = hand[sd];
      const sg = sd === 'l' ? 1 : -1;
      const lift = h.lift;
      arms[sd] = {
        wrist: [sg * 0.3, WRIST_UP + 0.09 * lift, h.z],
        along: [sg * 0.15, -0.25 * lift, 1],
        palm: [0, -1, -0.45 * lift],
        pole: [sg * 1, 0.45, -0.3],
        shape: mixShape(PLANT, LOOSE, lift)
      };
    }
    return { t: 0, hips, lean, twist: tw, roll: rl, legs, arms };
  }

  // ---------------------------------------------------------------- the beats
  private build(): void {
    // ---- seated: today's driver, to the number
    const seated: Key = {
      t: 0,
      hips: [0, 0, 0],
      lean: [-10, 3, 3, 2, 2, -2],
      legs: {
        l: { ankle: [0.16, -0.36, 0.8], pole: [0.12, 0.8, 1] },
        r: { ankle: [-0.14, -0.36, 0.8], pole: [-0.12, 0.8, 1] }
      },
      arms: {
        l: { wrist: [0.17, WHEEL[1] + 0.04, WHEEL[2] - 0.06], along: [-0.25, 0.55, 0.8], palm: [-0.75, -0.1, 0.6], pole: [0.6, -0.6, -0.4], shape: GRIP },
        r: { wrist: [-0.17, WHEEL[1] + 0.04, WHEEL[2] - 0.06], along: [0.25, 0.55, 0.8], palm: [0.75, -0.1, 0.6], pole: [-0.6, -0.6, -0.4], shape: GRIP }
      }
    };
    this.keys.set('seated', [seated]);

    // ---- emerge: up through the sunroof, root still the seat's hip point.
    // The opening is to his right and behind him, so he shifts right and back
    // as he rises: hands up to its left and front edges, hauls, gets his feet
    // up onto the two front seat cushions and stands between the seat backs,
    // out to the waist, a hand flat on the roof either side of the hole
    const O = RaviStunt.OPENING;
    const RW = ROOF_Y + WRIST_UP;
    /** Gripping one of the opening's edges from inside: palm against it, fingers up and over the top. */
    const grip = (wrist: V3, toward: V3, pole: V3): ArmKey => ({ wrist, along: [toward[0] * 0.1, 1, toward[2] * 0.1], palm: [toward[0], 0.15, toward[2]], pole, shape: HOOK });
    const gripL = (y: number, pole: V3): ArmKey => grip([O.maxX - 0.035, y, -0.27], [1, 0, 0], pole);
    const gripR = (y: number, pole: V3): ArmKey => grip([-0.5, y, O.maxZ - 0.035], [0, 0, 1], pole);
    const roofL = (pole: V3, lift = 0, sh: HandShape = PLANT): ArmKey => ({ wrist: [0.13, RW + lift, -0.3], along: [0.35, 0, 1], palm: [0, -1, 0], pole, shape: sh });
    const roofR = (pole: V3, lift = 0, sh: HandShape = PLANT): ArmKey => ({ wrist: [-0.88, RW + lift, -0.3], along: [-0.35, 0, 1], palm: [0, -1, 0], pole, shape: sh });
    const standL: V3 = [-0.14, STAND_Y, -0.08];
    const standR: V3 = [PASSENGER_X + 0.14, STAND_Y, -0.08];
    const emergeEnd: Key = {
      t: 1,
      hips: [-0.37, 0.78, -0.32],
      lean: [8, 2, 1, 0, -2, -4],
      legs: {
        l: { ankle: standL, pole: [0.2, 0.1, 1], flat: [0, 8] },
        r: { ankle: standR, pole: [-0.2, 0.1, 1], flat: [0, -8] }
      },
      arms: { l: roofL([0.8, 0.3, -0.6]), r: roofR([-0.8, 0.3, -0.6]) }
    };
    const emerge: Key[] = [
      seated,
      {
        // Lets go of the wheel, sits up, leans right and back, reaches up for the opening's edges
        t: 0.15,
        hips: [-0.05, 0.03, -0.07],
        lean: [0, 2, 2, 1, -6, -10],
        twist: [-4, 0, 0, 0, 0, 0],
        roll: [6, 2, 1, 1, -4, -4],
        legs: {
          l: { ankle: [0.15, -0.33, 0.64], pole: [0.2, 0.8, 1] },
          r: { ankle: [-0.15, -0.33, 0.64], pole: [-0.2, 0.8, 1] }
        },
        arms: { l: gripL(0.952, [0.6, -0.6, -0.3]), r: gripR(0.952, [-0.6, -0.6, -0.3]) }
      },
      {
        // Hauls on them: head up into the opening
        t: 0.3,
        hips: [-0.16, 0.17, -0.18],
        lean: [2, 2, 2, 1, -4, -6],
        twist: [-4, 0, 0, 0, 0, 0],
        roll: [4, 1, 1, 1, -3, -3],
        legs: {
          l: { ankle: [0.1, -0.24, 0.46], pole: [0.3, 0.7, 1] },
          r: { ankle: [-0.22, -0.24, 0.44], pole: [-0.3, 0.7, 1] }
        },
        arms: { l: gripL(0.952, [0.7, -0.5, -0.3]), r: gripR(0.952, [-0.7, -0.5, -0.3]) }
      },
      {
        // Chest up to his hands, feet coming up off the floor
        t: 0.44,
        hips: [-0.25, 0.36, -0.25],
        lean: [3, 2, 2, 1, -2, -4],
        roll: [2, 1, 0, 0, -1, -1],
        legs: {
          l: { ankle: [-0.06, STAND_Y + 0.07, 0.12], pole: [0.35, 0.4, 0.8], flat: [20, 0] },
          r: { ankle: [-0.45, STAND_Y + 0.07, 0.1], pole: [-0.35, 0.4, 0.8], flat: [20, 0] }
        },
        arms: { l: gripL(0.952, [0.8, -0.2, -0.5]), r: gripR(0.952, [-0.8, -0.2, -0.5]) }
      },
      {
        // Hands straight up out of their grips
        t: 0.5,
        hips: [-0.29, 0.45, -0.27],
        lean: [5, 2, 2, 1, -2, -3],
        legs: {
          l: { ankle: [-0.1, STAND_Y + 0.05, 0.02], pole: [0.3, 0.35, 0.9], flat: [12, 4] },
          r: { ankle: [-0.52, STAND_Y + 0.05, 0.0], pole: [-0.3, 0.35, 0.9], flat: [12, -4] }
        },
        arms: {
          l: { ...gripL(1.07, [0.8, 0, -0.5]), shape: LOOSE },
          r: { ...gripR(1.07, [-0.8, 0, -0.5]), shape: LOOSE }
        }
      },
      {
        // Feet on the cushions, hands over the edges onto the roof
        t: 0.57,
        hips: [-0.33, 0.54, -0.29],
        lean: [6, 3, 2, 0, -2, -3],
        legs: {
          l: { ankle: [standL[0], STAND_Y + 0.02, standL[2]], pole: [0.25, 0.3, 1], flat: [5, 8] },
          r: { ankle: [standR[0], STAND_Y + 0.02, standR[2]], pole: [-0.25, 0.3, 1], flat: [5, -8] }
        },
        arms: { l: roofL([0.7, 0.3, -0.6], 0.09, LOOSE), r: roofR([-0.7, 0.3, -0.6], 0.09, LOOSE) }
      },
      {
        t: 0.66,
        hips: [-0.35, 0.63, -0.31],
        lean: [8, 3, 2, 0, -2, -3],
        legs: {
          l: { ankle: standL, pole: [0.25, 0.3, 1], flat: [0, 8] },
          r: { ankle: standR, pole: [-0.25, 0.3, 1], flat: [0, -8] }
        },
        arms: { l: roofL([0.6, 0.5, -0.7]), r: roofR([-0.6, 0.5, -0.7]) }
      },
      emergeEnd
    ];
    this.keys.set('emerge', emerge);

    // ---- crouch: on the roof, root between his feet, facing the jet.
    // Up on the balls of his feet, right fingertips down, the left arm loose then drawn back to throw
    const tipsR = (x: number, z: number): ArmKey => ({ wrist: [x, TIP_UP, z], along: [0.05, -0.8, 0.6], palm: [0.1, -0.6, -0.8], pole: [-0.25, -0.2, -1], shape: TIPS });
    const feet: Record<Side, LegKey> = {
      l: { ankle: [0.17, BALLS_UP, 0.04], pole: [0.4, 0.2, 1], flat: [25, 10], toe: -25 },
      r: { ankle: [-0.16, BALLS_UP, -0.12], pole: [-0.4, 0.2, 1], flat: [25, -10], toe: -25 }
    };
    /** The free left arm, from his shoulder: hanging outside his knee, then drawn back past his hip to throw forward. */
    const leftArm = (wrist: V3, along: V3, palm: V3, pole: V3, sh: HandShape): ArmKey => ({ wrist, from: 'shoulder', along, palm, pole, shape: sh });
    const crouch0: Key = {
      t: 0,
      hips: [0, 0.43, -0.12],
      lean: [43, 10, 9, 7, -37, -30],
      roll: [4, 1, 1, 1, -3, -2],
      legs: feet,
      arms: {
        l: leftArm([0.2, -0.36, 0.06], [0.15, -1, 0.15], [-0.9, 0, 0.2], [0.5, 0, -1], LOOSE),
        r: tipsR(-0.06, 0.36)
      }
    };
    const crouch: Key[] = [
      crouch0,
      {
        t: 0.45,
        hips: [0, 0.41, -0.13],
        lean: [45, 10, 9, 7, -38, -32],
        roll: [5, 1, 1, 1, -4, -2],
        legs: feet,
        arms: {
          l: leftArm([0.27, -0.22, -0.12], [0.2, -0.7, -0.7], [-0.8, -0.2, -0.4], [1, -0.2, -0.4], LOOSE),
          r: tipsR(-0.06, 0.36)
        }
      },
      {
        t: 1,
        hips: [0, 0.37, -0.15],
        lean: [49, 10, 9, 7, -40, -34],
        roll: [5, 1, 1, 1, -4, -2],
        legs: feet,
        arms: {
          l: leftArm([0.26, -0.24, -0.34], [0.25, -0.35, -1], [-0.4, -0.8, 0.2], [1, 0.2, 0.2], REACH),
          r: tipsR(-0.06, 0.36)
        }
      }
    ];
    this.keys.set('crouch', crouch);

    // ---- climb: out of the sunroof onto the roof behind it; root = the crouch's.
    // In this space he starts facing −X (the car's front) in the hole, which
    // runs x −0.885…−0.335, z −0.55…+0.21; behind him (+X) is the roof to its
    // rear edge at x +0.35, ahead of the crouch (+Z, the driver's side) the
    // roof's edge is at z +0.50. He presses up, sits back on the hole's rear
    // edge, swings his legs up out of it as he pivots to his left, sits facing
    // the driver's side with his feet planted, and rocks forward into the crouch
    const R = RaviStunt.ROOF;
    const fromSeat = reframed(emergeEnd, R.at.toArray() as V3, R.yaw, 0);
    const ry = (v: V3, deg: number): V3 => {
      const c = Math.cos(deg * D2R);
      const s = Math.sin(deg * D2R);
      return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
    };
    /** Both legs laid by direction, written facing +Z and turned to `yaw`. */
    const legsAt = (hips: V3, pel: [number, number, number], thigh: V3, shin: V3, point: number, spread = 0.06): Record<Side, LegKey> => ({
      l: this.legFK('l', hips, pel, ry([thigh[0] + spread, thigh[1], thigh[2]], pel[1]), ry(shin, pel[1]), point),
      r: this.legFK('r', hips, pel, ry([thigh[0] - spread, thigh[1], thigh[2]], pel[1]), ry(shin, pel[1]), point)
    });
    const sitHand = (x: number, z: number, sg: number, yaw: number): ArmKey => flatHand(x, z, ry([sg * 0.25, 0, 1], yaw), ry([sg * 0.6, 0.3, -1], yaw));
    const sitPel: [number, number, number] = [-4, -90, 0];
    const sitHips: V3 = [-0.2, 0.1, -0.17];
    const outPel: [number, number, number] = [-12, -80, 0];
    const outHips: V3 = [-0.18, 0.1, -0.18];
    const turnPel: [number, number, number] = [-10, -45, 0];
    const turnHips: V3 = [-0.12, 0.1, -0.24];
    const climb: Key[] = [
      fromSeat,
      {
        // Presses up and back toward the hole's rear edge, feet off the cushions
        t: 0.14,
        hips: [-0.5, 0.0, -0.17],
        lean: [12, 3, 2, 1, -4, -4],
        twist: [-90, 0, 0, 0, 0, 0],
        legs: {
          l: { ankle: [-0.64, -0.78, 0.05], pole: [-1, 0.2, 0], flat: [15, -82] },
          r: { ankle: [-0.64, -0.78, -0.39], pole: [-1, 0.2, 0], flat: [15, -98] }
        },
        arms: fromSeat.arms
      },
      {
        // Hands lifted back to beside him
        t: 0.23,
        hips: [-0.34, 0.07, -0.17],
        lean: [4, 2, 2, 1, -3, -3],
        twist: [-90, 0, 0, 0, 0, 0],
        legs: legsAt([-0.34, 0.07, -0.17], [4, -90, 0], [0, -0.55, 0.85], [0, -1, 0.15], 30),
        arms: {
          l: { ...sitHand(-0.32, 0.12, 1, -90), wrist: [-0.32, WRIST_UP + 0.12, 0.12], shape: LOOSE },
          r: { ...sitHand(-0.32, -0.46, -1, -90), wrist: [-0.32, WRIST_UP + 0.12, -0.46], shape: LOOSE }
        }
      },
      {
        // Sat on the rear edge, legs down in the hole
        t: 0.32,
        hips: sitHips,
        lean: [sitPel[0], 2, 2, 1, -2, -2],
        twist: [sitPel[1], 0, 0, 0, 0, 0],
        legs: legsAt(sitHips, sitPel, [0, -0.12, 1], [0, -1, 0.15], 30),
        arms: { l: sitHand(-0.16, 0.08, 1, -90), r: sitHand(-0.16, -0.42, -1, -90) }
      },
      {
        // Leans back on his hands and lifts his legs up out of the hole
        t: 0.48,
        hips: outHips,
        lean: [outPel[0], 2, 2, 1, 0, 0],
        twist: [outPel[1], 0, 0, 0, 0, 0],
        legs: legsAt(outHips, outPel, [0, 0.55, 0.8], [0, -0.12, 0.55], 45),
        arms: { l: sitHand(-0.16, 0.08, 1, -90), r: sitHand(-0.16, -0.42, -1, -90) }
      },
      {
        // ...and pivots to his left, swinging them round over the roof
        t: 0.64,
        hips: turnHips,
        lean: [turnPel[0], 2, 2, 1, -2, -2],
        twist: [turnPel[1], 0, 0, 0, 0, 0],
        legs: legsAt(turnHips, turnPel, [0, 0.55, 0.8], [0, -0.1, 0.55], 45),
        arms: { l: sitHand(-0.16, 0.08, 1, -90), r: sitHand(-0.16, -0.42, -1, -90) }
      },
      {
        // Left hand lifted round behind him
        t: 0.72,
        hips: [-0.06, 0.1, -0.32],
        lean: [-8, 3, 2, 1, -4, -4],
        twist: [-20, 0, 0, 0, 0, 0],
        legs: {
          l: { ankle: [0.1, ANKLE_UP + 0.06, 0.06], pole: [0.2, 1, 0.4], flat: [10, 5] },
          r: { ankle: [-0.18, ANKLE_UP + 0.06, -0.08], pole: [-0.2, 1, 0.4], flat: [10, -15] }
        },
        arms: { l: { ...sitHand(0.18, -0.3, 1, 0), wrist: [0.34, 0.3, -0.3], shape: LOOSE }, r: sitHand(-0.16, -0.42, -1, -90) }
      },
      {
        // Sat facing the driver's side, feet planted, hands behind him
        t: 0.8,
        hips: [-0.02, 0.1, -0.4],
        lean: [-8, 3, 3, 2, -8, -6],
        legs: {
          l: { ankle: [0.17, ANKLE_UP, 0.04], pole: [0.25, 1, 0.4], flat: [0, 10] },
          r: { ankle: [-0.16, ANKLE_UP, -0.12], pole: [-0.25, 1, 0.4], flat: [0, -10] }
        },
        arms: { l: sitHand(0.22, -0.62, 1, 0), r: sitHand(-0.26, -0.62, -1, 0) }
      },
      {
        // Pushes off his hands
        t: 0.85,
        hips: [-0.015, 0.18, -0.33],
        lean: [10, 5, 4, 3, -14, -12],
        legs: {
          l: { ankle: [0.17, ANKLE_UP + 0.02, 0.04], pole: [0.35, 0.6, 1], flat: [5, 10], toe: -5 },
          r: { ankle: [-0.16, ANKLE_UP + 0.02, -0.12], pole: [-0.35, 0.6, 1], flat: [5, -10], toe: -5 }
        },
        arms: {
          l: { ...sitHand(0.22, -0.62, 1, 0), wrist: [0.42, 0.22, -0.4], shape: LOOSE },
          r: { ...sitHand(-0.26, -0.62, -1, 0), wrist: [-0.5, 0.3, -0.3], shape: LOOSE }
        }
      },
      {
        // Rocks forward over his feet, the right hand coming round in front of its knee
        t: 0.92,
        hips: [-0.01, 0.3, -0.24],
        lean: [32, 8, 7, 5, -26, -22],
        legs: {
          l: { ankle: [0.17, BALLS_UP - 0.03, 0.04], pole: [0.4, 0.2, 1], flat: [15, 10], toe: -15 },
          r: { ankle: [-0.16, BALLS_UP - 0.03, -0.12], pole: [-0.4, 0.2, 1], flat: [15, -10], toe: -15 }
        },
        arms: {
          l: { ...crouch0.arms.l, wrist: [0.26, -0.3, -0.05] },
          r: { ...tipsR(-0.06, 0.36), wrist: [-0.45, 0.4, 0.3], shape: LOOSE }
        }
      },
      cloneKey(crouch0, 1)
    ];
    this.keys.set('climb', climb);

    // ---- leap: root = the hip midpoint, flown by the scene
    const crouchEnd = crouch[crouch.length - 1];
    const fly = (wrist: V3, along: V3, palm: V3, pole: V3, sh: HandShape): Record<Side, ArmKey> => ({
      l: { wrist, from: 'shoulder', along, palm, pole, shape: sh },
      r: { wrist: mir(wrist), from: 'shoulder', along: mir(along), palm: mir(palm), pole: mir(pole), shape: sh }
    });
    const leapEnd: Key = {
      t: 1,
      hips: [0, 0, 0],
      lean: [14, 5, 4, 2, -8, -8],
      legs: {
        l: { ankle: [0.14, -0.7, 0.12], pole: [0.2, 0.2, 1], flat: [0, 6] },
        r: { ankle: [-0.14, -0.7, 0.1], pole: [-0.2, 0.2, 1], flat: [0, -6] }
      },
      arms: fly([0.28, -0.25, 0.36], [0.2, -0.3, 1], [0, -1, 0.2], [0.8, -0.3, -0.4], REACH)
    };
    const leap: Key[] = [
      shifted(crouchEnd, [-crouchEnd.hips[0], -crouchEnd.hips[1], -crouchEnd.hips[2]], 0),
      {
        // Driving up off the roof, arms swinging through low
        t: 0.07,
        hips: [0, 0, 0],
        lean: [44, 9, 7, 5, -30, -24],
        legs: {
          l: { ankle: [0.15, -0.5, 0.06], pole: [0.35, 0.2, 1], flat: [40, 10], toe: -35 },
          r: { ankle: [-0.15, -0.48, -0.06], pole: [-0.35, 0.2, 1], flat: [40, -10], toe: -35 }
        },
        arms: {
          l: fly([0.2, -0.42, 0.12], [0.1, -0.6, 0.8], [-0.6, -0.2, 0.3], [0.6, 0, -1], REACH).l,
          // The right comes up off its fingertips between the knees
          r: { wrist: [0.06, -0.4, 0.2], from: 'shoulder', along: [0.05, -0.6, 0.8], palm: [0.6, -0.2, 0.3], pole: [-0.3, 0, -1], shape: REACH }
        }
      },
      {
        // Off the roof: legs driving down and back, arms thrown through
        t: 0.14,
        hips: [0, 0, 0],
        lean: [38, 8, 6, 4, -28, -22],
        legs: {
          l: { ankle: [0.11, -0.7, -0.36], pole: [0.1, 0.2, 1], w: 1, point: 45 },
          r: { ankle: [-0.11, -0.66, -0.42], pole: [-0.1, 0.2, 1], w: 1, point: 45 }
        },
        arms: fly([0.1, 0.24, 0.45], [0.1, 0.5, 0.9], [-0.4, -0.3, 0.2], [0.5, -0.6, -0.4], REACH)
      },
      {
        // Stretched out flat for the wing
        t: 0.38,
        hips: [0, 0, 0],
        lean: [62, 6, 4, 2, -36, -26],
        legs: {
          l: { ankle: [0.1, -0.06, -0.64], pole: [0.1, -0.6, 0.8], w: 1, point: 60 },
          r: { ankle: [-0.1, -0.22, -0.76], pole: [-0.1, -0.4, 0.9], w: 1, point: 60 }
        },
        arms: fly([0.13, 0.02, 0.53], [0.08, 0.05, 1], [-0.3, -0.95, 0], [0.6, -0.5, -0.3], REACH)
      },
      {
        t: 0.62,
        hips: [0, 0, 0],
        lean: [52, 6, 4, 2, -32, -22],
        legs: {
          l: { ankle: [0.11, -0.2, -0.52], pole: [0.15, -0.3, 1], w: 1, point: 50 },
          r: { ankle: [-0.11, -0.36, -0.58], pole: [-0.15, -0.2, 1], w: 1, point: 50 }
        },
        arms: fly([0.18, -0.03, 0.5], [0.12, -0.05, 1], [-0.2, -1, 0], [0.7, -0.4, -0.3], REACH)
      },
      {
        // Legs come under him, arms out to take it
        t: 0.85,
        hips: [0, 0, 0],
        lean: [26, 5, 4, 2, -14, -10],
        legs: {
          l: { ankle: [0.13, -0.56, 0.06], pole: [0.2, 0.3, 1], w: 0.6, point: 25, flat: [10, 6] },
          r: { ankle: [-0.13, -0.6, 0.02], pole: [-0.2, 0.3, 1], w: 0.6, point: 25, flat: [10, -6] }
        },
        arms: fly([0.34, -0.1, 0.3], [0.3, -0.1, 1], [0, -1, 0.1], [0.8, -0.2, -0.5], REACH)
      },
      leapEnd
    ];
    this.keys.set('leap', leap);

    // ---- land: touchdown, squat, hands down, knees down, into the crawl's first frame
    const zf = this.landToCrawl;
    const crawl0 = this.crawlKey(0);
    const crawlIn = shifted(crawl0, [0, 0, zf], 1);
    const touchY = -Math.min(leapEnd.legs.l.ankle[1], leapEnd.legs.r.ankle[1]) + ANKLE_UP + 0.006;
    const touch = shifted(leapEnd, [0, touchY, 0], 0);
    const tdFeet: Record<Side, LegKey> = {
      l: { ankle: [touch.legs.l.ankle[0], ANKLE_UP, touch.legs.l.ankle[2]], pole: [0.6, 0.2, 1], flat: [0, 10] },
      r: { ankle: [touch.legs.r.ankle[0], ANKLE_UP, touch.legs.r.ankle[2]], pole: [-0.6, 0.2, 1], flat: [0, -10] }
    };
    // Hands slapped down between his knees, elbows up and back clear of them
    const slapL = flatHand(0.13, 0.5, [0.2, 0, 1], [0.35, 0.6, -0.7]);
    const slapR = flatHand(-0.13, 0.48, [-0.2, 0, 1], [-0.35, 0.6, -0.7]);
    const balls = (l: LegKey, sg: number): LegKey => ({ ...l, ankle: [l.ankle[0], BALLS_UP, l.ankle[2] + 0.03], flat: [30, sg * 6], toe: -30 });
    // The left knee comes down where the crawl will have it, and stays: first
    // on its tucked toes, then the foot flicks over onto its instep
    const lKnee = crawlIn.legs.l;
    const kl = lKnee.knee!;
    const kneelPel: [number, number, number] = [40, 2, 0];
    const kneelL = { hips: this.hipsOver('l', kl, 0, kl[2] - 0.26, kneelPel), pel: kneelPel };
    const lTucked: LegKey = { ...this.kneel('l', kneelL.hips, kneelL.pel, kl[0], kl[2], { up: 16, point: 4 }), toe: -50 };
    const flickPel: [number, number, number] = [62, 0, 0];
    const flick = { hips: this.hipsOver('l', kl, 0, kl[2] - 0.19, flickPel), pel: flickPel };
    const lFlick = this.kneel('l', flick.hips, flick.pel, kl[0], kl[2], { up: 34, point: 45 });
    const midPel: [number, number, number] = [56, 1, 0];
    const mid = { hips: this.hipsOver('l', kl, 0, kl[2] - 0.22, midPel), pel: midPel };
    const kr = crawlIn.legs.r.knee!;
    /** The right hand's first step on, before the crawl's own. */
    const stepR = flatHand(-0.26, 0.9, [-0.2, 0, 1], [-1, 0.45, -0.3]);
    const land: Key[] = [
      touch,
      {
        // The bottom of the squat, hands slapped down
        t: 0.2,
        hips: [0, 0.36, 0.02],
        lean: [54, 10, 9, 7, -38, -32],
        legs: tdFeet,
        arms: { l: slapL, r: slapR }
      },
      {
        // Weight forward onto the hands, up on the balls of his feet
        t: 0.31,
        hips: [0, 0.4, 0.09],
        lean: [54, 10, 9, 8, -36, -30],
        legs: { l: balls(tdFeet.l, 1), r: balls(tdFeet.r, -1) },
        arms: { l: slapL, r: slapR }
      },
      {
        // Rolling forward over the left ball as that knee goes down
        t: 0.37,
        hips: [0, 0.4, 0.22],
        lean: [47, 9, 8, 7, -32, -27],
        legs: {
          l: { ankle: [0.17, 0.18, 0.21], pole: [0.6, 0, 1], flat: [55, 10], toe: -55 },
          r: balls(tdFeet.r, -1)
        },
        arms: {
          l: { ...crawlIn.arms.l, wrist: [0.04, WRIST_UP + 0.24, 0.64], shape: LOOSE },
          r: { ...slapR, wrist: [-0.15, WRIST_UP + 0.08, 0.58], shape: LOOSE }
        }
      },
      {
        // Left knee down ahead of its foot, toes tucked
        t: 0.43,
        hips: kneelL.hips,
        lean: [kneelL.pel[0], 8, 7, 6, -28, -24],
        twist: [kneelL.pel[1], 0, 0, 0, 0, 0],
        legs: { l: lTucked, r: balls(tdFeet.r, -1) },
        arms: {
          l: { ...crawlIn.arms.l, wrist: [0.15, WRIST_UP + 0.2, 0.72], shape: LOOSE },
          r: { ...slapR, wrist: [-0.18, WRIST_UP + 0.15, 0.7], shape: LOOSE }
        }
      },
      {
        // The left foot turning over behind its knee; the right knee coming down
        t: 0.5,
        hips: mid.hips,
        lean: [mid.pel[0], 10, 9, 8, -36, -30],
        twist: [mid.pel[1], 0, 0, 0, 0, 0],
        legs: {
          l: { ...this.kneel('l', mid.hips, mid.pel, kl[0], kl[2], { up: 25, point: 25 }), toe: -20 },
          r: this.kneel('r', mid.hips, mid.pel, kr[0], kr[2], { up: 45, point: 30, lift: 0.1, slide: 'x' })
        },
        arms: { l: crawlIn.arms.l, r: stepR }
      },
      {
        // Right foot swept back off the wing, the left flicked over; right hand reaches on
        t: 0.56,
        hips: flick.hips,
        lean: [flick.pel[0], 10, 9, 8, -38, -32],
        legs: { l: lFlick, r: this.kneel('r', flick.hips, flick.pel, kr[0], kr[2], { up: 34, point: 45, slide: 'x' }) },
        arms: { l: crawlIn.arms.l, r: stepR }
      },
      {
        // Right knee down; right hand walks on
        t: 0.72,
        hips: crawlIn.hips,
        lean: crawlIn.lean,
        twist: crawlIn.twist,
        roll: crawlIn.roll,
        legs: crawlIn.legs,
        arms: { l: crawlIn.arms.l, r: { ...crawlIn.arms.r, wrist: [crawlIn.arms.r.wrist[0] + 0.01, WRIST_UP + 0.1, (stepR.wrist[2] + crawlIn.arms.r.wrist[2]) / 2], shape: LOOSE } }
      },
      cloneKey(crawlIn, 0.86),
      crawlIn
    ];
    this.keys.set('land', land);

    // ---- dive: root = the hatch's near rim; the hole runs forward (+Z) and down.
    // Hands step up to either side of the hole, he lowers his head and
    // shoulders in between them, slides forward on his knees until his hips
    // are over the rim, lets go, and his legs follow him over it
    const D = this.crawlToDive;
    const start = shifted(crawl0, [0, 0, -D], 0);
    const side = (sg: number): ArmKey => flatHand(sg * 0.38, 0.08, [sg * 0.35, 0, 1], [sg * 0.45, 1, -0.3]);
    const reachDown = (sg: number): ArmKey => ({ wrist: [sg * 0.12, -0.5, 0.12], from: 'shoulder', along: [sg * 0.1, -1, 0.2], palm: [sg * -0.6, 0, -0.6], pole: [sg * 0.2, 0.2, -0.9], shape: REACH });
    const slid = (dz: number): Record<Side, LegKey> => shifted(crawl0, [0, 0, -D + dz]).legs;
    const fk = (hips: V3, lean0: number, thigh: V3, shin: V3, point: number): Record<Side, LegKey> => ({
      l: this.legFK('l', hips, [lean0, 0, 0], thigh, shin, point),
      r: this.legFK('r', hips, [lean0, 0, 0], thigh, shin, point)
    });
    const h0 = start.hips;
    const lean0 = start.lean;
    const dive: Key[] = [
      start,
      {
        // Left hand on, to the left of the hole
        t: 0.12,
        hips: [h0[0], h0[1], h0[2] + 0.08],
        lean: lean0,
        twist: start.twist,
        roll: start.roll,
        legs: slid(0.08),
        arms: { l: { ...side(1), wrist: [0.35, WRIST_UP + 0.1, -0.12], shape: LOOSE }, r: start.arms.r }
      },
      {
        // ...planted; right hand on
        t: 0.22,
        hips: [0, h0[1] + 0.02, h0[2] + 0.24],
        lean: [lean0[0] + 4, lean0[1], lean0[2], lean0[3], -30, -18],
        legs: slid(0.24),
        arms: { l: side(1), r: { ...side(-1), wrist: [-0.35, WRIST_UP + 0.1, -0.02], shape: LOOSE } }
      },
      {
        t: 0.32,
        hips: [0, 0.48, -0.62],
        lean: [90, 12, 11, 10, -20, -8],
        legs: fk([0, 0.48, -0.62], 90, [0, -0.88, -0.32], [0, 0.08, -1], 72),
        arms: { l: side(1), r: side(-1) }
      },
      {
        // Head and shoulders down into the hole between his hands
        t: 0.48,
        hips: [0, 0.46, -0.4],
        lean: [104, 12, 12, 10, -8, 4],
        legs: fk([0, 0.46, -0.4], 104, [0, -0.85, -0.5], [0, 0.1, -1], 72),
        arms: { l: side(1), r: side(-1) }
      },
      {
        // Chest over the hole, knees sliding up to the rim, feet lifting
        t: 0.66,
        hips: [0, 0.36, -0.06],
        lean: [124, 12, 12, 10, 0, 8],
        legs: fk([0, 0.36, -0.06], 124, [0, -0.6, -0.8], [0, 0.5, -0.87], 65),
        arms: { l: side(1), r: side(-1) }
      },
      {
        // Lets go: hands up off the wing and back in over the edges
        t: 0.74,
        hips: [0, 0.22, 0.04],
        lean: [133, 12, 12, 10, 2, 8],
        legs: fk([0, 0.22, 0.04], 133, [0, -0.15, -0.99], [0, 0.55, -0.83], 62),
        arms: {
          l: { ...side(1), wrist: [0.22, 0.12, 0.16], pole: [0.1, 1, -0.4], shape: LOOSE },
          r: { ...side(-1), wrist: [-0.22, 0.12, 0.16], pole: [-0.1, 1, -0.4], shape: LOOSE }
        }
      },
      {
        // Hips over the rim, legs following
        t: 0.84,
        hips: [0, 0.06, 0.17],
        lean: [143, 12, 12, 10, 4, 8],
        legs: fk([0, 0.06, 0.17], 143, [0, 0.35, -0.94], [0, 0.62, -0.78], 60),
        arms: { l: reachDown(1), r: reachDown(-1) }
      },
      {
        t: 1,
        hips: [0, -0.4, 0.3],
        lean: [156, 10, 10, 8, 6, 8],
        legs: fk([0, -0.4, 0.3], 156, [0, 0.9, -0.42], [0, 0.62, -0.78], 55),
        arms: { l: reachDown(1), r: reachDown(-1) }
      }
    ];
    this.keys.set('dive', dive);
  }
}
