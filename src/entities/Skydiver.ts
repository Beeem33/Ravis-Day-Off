import * as THREE from 'three';
import { RaviRig, type HandShape, type Side } from './RaviVisual';
import type { Enemy } from './Enemy';

/**
 * Skydiver — bodies in the air: Ravi's own (a RaviRig, seen from behind and
 * above) and anybody else's (an Enemy, the FBI and the boss), laid out flat
 * on the wind belly-down in the box position — arms out and bent up level
 * with the head, back arched, knees bent and the shins up into the wind —
 * and turned to face wherever they are going.
 *
 *   diverQuat(heading, bank, pitch, 'ravi' | 'enemy', q)   // root orientation
 *   raviFreefall(rig, { aim, aimK, steer, t })              // poses and applies
 *   enemyFreefall(e, t, steer)                              // sets e.pose
 */

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/**
 * The root orientation for a body flat on the wind, its head toward
 * `heading` (world, horizontal), belly down; `bank` rolls it about its
 * length (+ his right side down: turning right), `pitch` tips the head down
 * (+) or up. Ravi's model faces +Z; an Enemy's faces −Z.
 */
export function diverQuat(heading: THREE.Vector3, bank: number, pitch: number, model: 'ravi' | 'enemy', out: THREE.Quaternion): THREE.Quaternion {
  _y.copy(heading).setY(0).normalize();
  if (_y.lengthSq() < 1e-6) _y.set(0, 0, -1);
  // Model +Z is the belly for Ravi (to the ground), the back for an Enemy (to the sky)
  _z.set(0, model === 'ravi' ? -1 : 1, 0);
  _x.crossVectors(_y, _z).normalize();
  out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  // Bank about the length, pitch about the side, both in the world
  const side = _x.clone();
  out.premultiply(_q.setFromAxisAngle(_y, model === 'ravi' ? -bank : bank));
  out.premultiply(_q.setFromAxisAngle(side, model === 'ravi' ? pitch : -pitch));
  return out;
}

const FLAT: HandShape = { fingers: [[6, 8, 4], [5, 7, 4], [7, 9, 5], [9, 11, 6]], thumb: [0.05, 0.1, 0.1], spread: 8 };
const GUN: HandShape = { fingers: [[20, 25, 15], [80, 90, 50], [82, 92, 52], [84, 94, 56]], thumb: [0.5, 0.45, 0.35] };
const FIST: HandShape = { fingers: [[78, 88, 52], [80, 90, 52], [82, 92, 54], [84, 94, 56]], thumb: [0.5, 0.45, 0.35] };

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export interface FreefallPose {
  /** Model-space direction the right arm points the pistol, or null. */
  aim: THREE.Vector3 | null;
  /** 0 box position .. 1 the right arm out along `aim`. */
  aimK: number;
  /** -1..1 each: steering, right (+x) and forward (+y). Bends the arms and legs into it. */
  steer: { x: number; y: number };
  /** Seconds, for the wind's flutter. */
  t: number;
  /** 0..1: the arch lost, every limb flailing (a hit, a tumble). */
  flail?: number;
}

/**
 * Ravi in the box position (model space: Y up through his head, +Z his
 * belly, +X his left). Steering forward sweeps the arms back and the legs
 * out straight; right drops the right arm a touch and lifts the left. The
 * right hand holds the pistol; aimed, the whole right arm goes out along
 * the aim with the elbow soft.
 */
export function raviFreefall(rig: RaviRig, o: FreefallPose): void {
  const f = o.flail ?? 0;
  const flut = (k: number): number => Math.sin(o.t * (11 + k) + k * 1.7) * 0.012 + Math.sin(o.t * (3 + k * 0.3) + k) * 0.02 * (1 + f * 6);
  rig.clear();
  // Arched: the back bowed, the head up into the wind
  rig.turn('spine_01', [1, 0, 0], -5 - f * 10);
  rig.turn('spine_02', [1, 0, 0], -7);
  rig.turn('spine_03', [1, 0, 0], -6 + o.steer.y * 4);
  rig.turn('neck_01', [1, 0, 0], -14);
  rig.turn('head', [1, 0, 0], -22);
  rig.apply();
  const fw = o.steer.y;
  for (const side of ['l', 'r'] as Side[]) {
    const sx = side === 'l' ? 1 : -1;
    // Turning to his right (steer.x > 0) drops the right arm (−Z is toward the sky)
    const turn = o.steer.x * sx;
    const S = rig.at(`upperarm_${side}`);
    const W = V(sx * (0.56 - fw * 0.1), 1.66 - fw * 0.26 + flut(sx), -0.04 + turn * 0.1 + fw * 0.05);
    const E = V(sx * (0.47 - fw * 0.05), 1.39 - fw * 0.12, -0.02 + turn * 0.06);
    W.x += Math.sin(o.t * 7 + sx) * 0.15 * f;
    W.y += Math.cos(o.t * 6.3 + sx) * 0.2 * f;
    let wrist = W;
    let elbowDir = E.clone().sub(W).normalize();
    let along = V(sx * 0.18, 1, 0.05).normalize();
    let palm = V(0, 0, 1);
    if (side === 'r' && o.aim && o.aimK > 0) {
      const a = o.aim.clone().normalize();
      const aw = S.clone().addScaledVector(a, 0.55);
      const aside = new THREE.Vector3().crossVectors(a, V(0, 0, -1));
      if (aside.lengthSq() < 1e-4) aside.set(1, 0, 0);
      aside.normalize();
      const ae = a.clone().negate().addScaledVector(V(0, 0, 1), 0.2).addScaledVector(aside, -0.15).normalize();
      // Palm inward (toward his middle), square to the barrel
      const ap = aside.clone().multiplyScalar(-1);
      ap.addScaledVector(a, -ap.dot(a)).normalize();
      const k = o.aimK;
      wrist = W.clone().lerp(aw, k);
      elbowDir = elbowDir.clone().lerp(ae, k).normalize();
      along = along.clone().lerp(a, k).normalize();
      palm = palm.clone().lerp(ap, k).normalize();
    }
    rig.reach(side, wrist, along, palm, elbowDir, S, 0.5, false).hand(side, side === 'r' ? GUN : f > 0.5 ? FIST : FLAT);
  }
  rig.apply();
  for (const side of ['l', 'r'] as Side[]) {
    const sx = side === 'l' ? 1 : -1;
    const H = rig.at(`thigh_${side}`);
    // Forward: legs out straighter behind him; a turn: the inside knee bent more
    const bend = 1 - fw * 0.45 + o.steer.x * sx * -0.15;
    const thigh = V(sx * 0.3, -0.95, -0.1 - bend * 0.08).normalize();
    const shin = V(sx * 0.1, -0.95 + bend * 0.75, -0.15 - bend * 0.85).normalize();
    shin.x += Math.sin(o.t * 5 + sx) * 0.3 * f;
    shin.normalize();
    rig.leg(side, H, thigh, shin, V(0, 0, 1), false);
  }
  rig.apply();
}

/**
 * Ravi under the canopy: hanging upright in the harness, legs a little
 * forward, both hands up on the toggles over his head.
 */
export function raviUnderCanopy(rig: RaviRig, t: number, swing: number): void {
  rig.clear();
  rig.turn('spine_01', [1, 0, 0], 6);
  rig.turn('head', [1, 0, 0], -10);
  rig.apply();
  for (const side of ['l', 'r'] as Side[]) {
    const sx = side === 'l' ? 1 : -1;
    const S = rig.at(`upperarm_${side}`);
    const W = V(sx * 0.3, 1.95 + Math.sin(t * 2 + sx) * 0.02, 0.08);
    rig.reach(side, W, V(0, 1, 0), V(-sx, 0, 0), V(sx * 0.4, -1, 0.1).normalize(), S, 0.5, false).hand(side, FIST);
    const H = rig.at(`thigh_${side}`);
    const sw = Math.sin(t * 1.4 + sx) * 0.1 * swing;
    rig.leg(side, H, V(sx * 0.08, -0.9, 0.35 + sw).normalize(), V(sx * 0.02, -1, 0.1 + sw).normalize(), V(0, 0.2, 1).normalize(), false);
  }
  rig.apply();
}

// ================================================================ somebody else in the air

/** The joints of an Enemy's own rig (it keeps them private; the pose below sets them after its own animation). */
interface EnemyJoints {
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  foreL: THREE.Object3D;
  foreR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  shinL: THREE.Object3D;
  shinR: THREE.Object3D;
  torso: THREE.Object3D;
  head: THREE.Object3D;
}

const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _bm = new THREE.Matrix4();
const _bp = new THREE.Vector3();

/**
 * An upper limb's turn in the body's frame: the bone (which hangs down its
 * −Y at rest) laid along `dir`, turned about itself so the joint below it
 * folds toward `fold` — an arm's forearm folds toward the bone's −Z, a
 * leg's shin toward its +Z (`shinSide`).
 */
function limbQ(dir: THREE.Vector3, fold: THREE.Vector3, shinSide: boolean, out: THREE.Quaternion): THREE.Quaternion {
  _by.copy(dir).normalize().negate();
  _bp.copy(fold).addScaledVector(_by, -fold.dot(_by));
  if (_bp.lengthSq() < 1e-6) _bp.set(0, 0, 1).addScaledVector(_by, -_by.z);
  _bp.normalize();
  _bz.copy(_bp);
  if (!shinSide) _bz.negate();
  _bx.crossVectors(_by, _bz).normalize();
  _bz.crossVectors(_bx, _by);
  return out.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
}

/** Three sines at odd rates: a flutter that never quite repeats. */
function flutter(t: number, seed: number, amp: number): number {
  return (Math.sin(t * 7.3 + seed) * 0.5 + Math.sin(t * 13.1 + seed * 2.7) * 0.3 + Math.sin(t * 2.1 + seed * 0.7) * 0.6) * amp;
}

/**
 * How somebody else is lying on the air, joint by joint: the Enemy rig
 * animates as it always does, and then this lays every limb over the top
 * of it before the model is posed from the rig (it hooks the Enemy's own
 * animate step, so the hitman model, the pistol in the hand and the face
 * all follow as they do anywhere else).
 *
 *  - arch: belly to earth, back arched, arms in the W — upper arms out and
 *    forward, elbows bent so the forearms point up past the head — knees
 *    bent and the shins up into the wind, everything fluttering.
 *  - aim (0..1, blended): the right arm comes round and out straight at
 *    `aim` (body frame), the left stays in the W for balance.
 *  - limp (0..1): shot. Nothing held: the arms and legs trail up into the
 *    wind whichever way he's turning over, flopping, the head lolling.
 *  - hang: under a canopy, hands up on the toggles, legs dangling.
 *
 * Body frame: an Enemy faces −Z, so face down on the wind −Z is the ground
 * and +Z the sky; +Y runs up through his head, +X is his right.
 */
export class DiverPose {
  aim = new THREE.Vector3(0, 0, -1);
  aimK = 0;
  limp = 0;
  hang = 0;
  /** -1..1: a turn, banking the limbs into it. */
  steer = 0;
  private t = Math.random() * 20;
  private seed = Math.random() * 10;
  private j: EnemyJoints;
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private up = new THREE.Vector3();

  constructor(private e: Enemy) {
    this.j = e as unknown as EnemyJoints;
    e.pose = null;
    e.setWalk(0);
    e.setAiming(false);
    const host = e as unknown as { animate(dt: number): void };
    const own = host.animate.bind(e);
    host.animate = (dt: number): void => {
      own(dt);
      this.t += dt;
      this.apply();
    };
  }

  private arm(side: 1 | -1, out: THREE.Quaternion): number {
    const t = this.t;
    const s = this.seed + (side > 0 ? 0 : 3.1);
    const st = this.steer * side;
    // The W: out to the side and a little forward of the shoulders, up off the line of the back
    const dir = V(side * 0.8, 0.42 + st * 0.12 + flutter(t, s, 0.04), 0.3 + flutter(t, s + 1, 0.05));
    limbQ(dir, V(0, 1, 0.15), false, out);
    return 1.45 + flutter(t, s + 2, 0.08);
  }

  private apply(): void {
    const j = this.j;
    const t = this.t;
    // World up in his own frame: where a limp limb trails to
    this.e.root.updateMatrixWorld();
    this.up.set(0, 1, 0).applyQuaternion(this.qb.copy(this.e.root.quaternion).invert());
    for (const side of [1, -1] as const) {
      const armJ = side > 0 ? j.armR : j.armL;
      const foreJ = side > 0 ? j.foreR : j.foreL;
      const legJ = side > 0 ? j.legR : j.legL;
      const shinJ = side > 0 ? j.shinR : j.shinL;
      const s = this.seed + (side > 0 ? 0 : 3.1);
      let bend = this.arm(side, this.qa);
      if (this.hang > 0) {
        // Up on the toggles
        limbQ(V(side * 0.28, 1, 0.08), V(0, 0, -1), false, this.qb);
        this.qa.slerp(this.qb, this.hang);
        bend = THREE.MathUtils.lerp(bend, 0.35, this.hang);
      }
      if (side > 0 && this.aimK > 0) {
        limbQ(this.aim, V(0, 1, -0.4), false, this.qb);
        this.qa.slerp(this.qb, this.aimK);
        bend = THREE.MathUtils.lerp(bend, 0.12, this.aimK);
      }
      if (this.limp > 0) {
        const d = this.up.clone().multiplyScalar(0.9).add(V(side * 0.55, 0.25, 0)).add(V(flutter(t * 1.6, s, 0.5), flutter(t * 1.4, s + 5, 0.5), flutter(t * 1.5, s + 9, 0.5)));
        limbQ(d, V(flutter(t, s + 4, 1), 1, flutter(t, s + 6, 1)), false, this.qb);
        this.qa.slerp(this.qb, this.limp);
        bend = THREE.MathUtils.lerp(bend, 0.5 + Math.abs(flutter(t * 1.3, s + 7, 0.6)), this.limp);
      }
      armJ.quaternion.copy(this.qa);
      foreJ.rotation.set(bend, 0, 0);
      // Legs: in line with the body and apart, up off it with the arch, knees bent so the shins stand up into the wind
      const st = this.steer * side;
      limbQ(V(side * 0.3, -0.93, 0.2 + st * 0.08 + flutter(t, s + 8, 0.03)), V(0, 0, 1), true, this.qa);
      let knee = 1.45 - st * 0.3 + flutter(t, s + 10, 0.1);
      if (this.hang > 0) {
        limbQ(V(side * 0.1, -1, -0.12 + flutter(t * 0.6, s, 0.05)), V(0, 0, 1), true, this.qb);
        this.qa.slerp(this.qb, this.hang);
        knee = THREE.MathUtils.lerp(knee, 0.25 + flutter(t * 0.5, s, 0.1), this.hang);
      }
      if (this.limp > 0) {
        const d = this.up.clone().multiplyScalar(0.5).add(V(side * 0.25, -1, 0)).add(V(flutter(t * 1.2, s + 11, 0.35), 0, flutter(t * 1.1, s + 12, 0.35)));
        limbQ(d, V(0, 0, 1), true, this.qb);
        this.qa.slerp(this.qb, this.limp);
        knee = THREE.MathUtils.lerp(knee, 0.4 + Math.abs(flutter(t * 1.2, s + 13, 0.6)), this.limp);
      }
      legJ.quaternion.copy(this.qa);
      shinJ.rotation.set(-knee, 0, 0);
    }
    // The chest arched back, the head up looking where he's going; slack when shot
    const arch = (1 - this.hang) * (1 - this.limp);
    // (+x tips the chest and the face up off the ground, toward where he's going)
    j.torso.rotation.x = 0.16 * arch + flutter(t, this.seed + 14, 0.02);
    j.head.rotation.set(0.8 * arch + flutter(t * 1.4, this.seed + 15, 0.4) * this.limp - 0.1 * this.hang, flutter(t * 0.9, this.seed + 16, 0.5) * this.limp, 0);
  }
}

/** Face down on the sand, dragging himself along by his fingers: `k` 0..1 through one pull. */
export function enemyCrawl(e: Enemy, k: number): void {
  e.setWalk(0);
  // Each arm takes its turn: out past his head and down on the sand, then dragged back to the
  // shoulder hauling him along, then up and out again. Arms as shoulder turns (the upper arm
  // hangs down −Y at rest) and elbow bends; body frame, his front (−Z) on the sand.
  const arm = (ph: number, sx: number): { q: THREE.Quaternion; fore: number } => {
    const p = ((ph % 1) + 1) % 1;
    const pulling = p < 0.55;
    const u = pulling ? 1 - p / 0.55 : (p - 0.55) / 0.45;
    const e2 = u * u * (3 - 2 * u);
    const dir = V(sx * 0.48, 0.2, -0.28).lerp(V(sx * 0.34, 0.93, -0.12), e2);
    if (!pulling) dir.z += Math.sin(u * Math.PI) * 0.35;
    return { q: new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dir.normalize()), fore: 1.75 - 1.5 * e2 };
  };
  const r = arm(k, 1);
  const l = arm(k + 0.5, -1);
  e.pose = {
    armR: r.q,
    foreR: r.fore,
    armL: l.q,
    foreL: l.fore,
    head: new THREE.Euler(-0.75 + Math.sin(k * Math.PI * 4) * 0.06, Math.sin(k * Math.PI * 2) * 0.15, 0),
    curl: 0.85
  };
}
