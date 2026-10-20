import * as THREE from 'three';
import type { CarRig } from '../scenes/Level8Contracts';
import type { DriveInput, DriveTune, ICar, RoadPos, StreetBlocker } from '../scenes/StreetContracts';
import type { RoadNet } from './RoadNet';
import type { Traffic, TrafficCarState } from './Traffic';

/**
 * Arcade-but-weighty car physics on the ground plane, for Ravi's Civic and
 * the two AIs (same physics: they look like cars being driven, because they
 * are). A heading, a yaw rate and a world velocity; each substep the
 * velocity splits into forward and sideways parts — the engine and brakes
 * work on the forward part, the tyres scrub the sideways part away at a
 * grip-limited rate, and the heading turns at the bicycle-model yaw rate for
 * the front wheel angle (capped by what the tyres can hold). Because the
 * velocity only follows the heading through that scrub, the car slips a
 * little in every corner and a lot with the handbrake (which drops the
 * rear's grip and lets it rotate): drifts, slides, recoveries.
 *
 * It rides on the road under it (RoadNet.locate every substep): y on the
 * deck, pitch from the slope (and gravity along it), and the road's edges
 * are walls its corners are pushed back inside, with an impulse (so a nose
 * clipping the barrier turns the car) and friction along the wall.
 */

/** DriveTune plus what this physics also wants; every extra has a default. */
export interface CarTune extends DriveTune {
  /** Wheel radius, m (for spinning the rig's wheels). */
  wheelRadius?: number;
  /** Axle to axle, m. Default 0.6 × length. */
  wheelbase?: number;
  /** Most sideways acceleration the tyres hold, m/s². */
  latMax?: number;
  /** Fastest it goes backwards, m/s. */
  reverseSpeed?: number;
  /** How quickly the steering follows the input: rad/s-ish rates for the input (−1..1) ramp at standstill. Lower is smoother. */
  steerRate?: number;
}

type Full = Required<CarTune>;

function full(t: CarTune): Full {
  return {
    wheelRadius: 0.32,
    wheelbase: t.length * 0.6,
    latMax: 10,
    reverseSpeed: 9,
    steerRate: 4.2,
    ...t
  };
}

/** Ravi's tired Civic hatch: ~112 mph flat out, 0–60 in ~5.5 s, light and chuckable. */
export const CIVIC_TUNE: CarTune = {
  topSpeed: 50,
  accel: 5.7,
  brake: 12,
  steerLow: 0.54,
  steerHigh: 0.012,
  grip: 8,
  mass: 1100,
  length: 4.15,
  width: 1.76,
  wheelRadius: 0.3,
  wheelbase: 2.57,
  latMax: 10.5,
  reverseSpeed: 9,
  steerRate: 5
};

/** The boss's big black saloon: a little faster than the Civic, heavier, planted. */
export const BOSS_TUNE: CarTune = {
  topSpeed: 53,
  accel: 6.6,
  brake: 13,
  steerLow: 0.58,
  steerHigh: 0.012,
  grip: 9,
  mass: 1800,
  length: 5.15,
  width: 1.9,
  wheelRadius: 0.34,
  wheelbase: 3.15,
  latMax: 11.5,
  reverseSpeed: 9,
  steerRate: 12
};

/** The highway patrol cruiser: a big sedan with the pursuit package. */
export const COP_TUNE: CarTune = {
  topSpeed: 52,
  accel: 6.4,
  brake: 13,
  steerLow: 0.58,
  steerHigh: 0.012,
  grip: 9,
  mass: 1700,
  length: 5.1,
  width: 1.95,
  wheelRadius: 0.34,
  wheelbase: 2.95,
  latMax: 11,
  reverseSpeed: 9,
  steerRate: 10
};

/** Physics substep: 50 m/s is 0.42 m a step, a tenth of a car. */
const STEP = 1 / 120;
const G = 9.81;

export type CarRole = 'player' | 'boss' | 'cop';

const _corner = new THREE.Vector3();
const _n = new THREE.Vector3();
const _deep = new THREE.Vector3();

export class DriveCar implements ICar {
  readonly position = new THREE.Vector3();
  yaw = 0;
  /** World velocity (y: the deck's climb rate, for the camera; the physics is horizontal). */
  readonly velocity = new THREE.Vector3();
  readonly at: RoadPos = { road: 'city', s: 0, d: 0 };
  steerAngle = 0;
  pitch = 0;
  roll = 0;
  slide = 0;
  onImpact: ((speed: number, point: THREE.Vector3, other: 'wall' | 'traffic' | 'boss' | 'cop' | 'player') => void) | null = null;

  /** Static solids to collide with (StreetData.blockers). */
  blockers: StreetBlocker[] = [];
  /** Who this is, to the others' onImpact. */
  role: CarRole;
  readonly tune: Full;
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly mass: number;
  /** Yaw moment of inertia, kg m². */
  readonly inertia: number;
  /** Yaw rate, rad/s (+ = turning left, as yaw grows to the left). */
  yawRate = 0;
  /**
   * How much of a car-to-car impulse this car takes (1 = all of it, by its
   * mass). The boss is 0.25: what he hits is shoved and spun, he wobbles.
   */
  shove = 1;
  /** 0..1: how hard it is grinding along a wall right now (for a scrape loop). */
  scrape = 0;
  /** The smoothed inputs actually in use (for engine sound, lights): throttle −1..1, steer −1..1. */
  throttleNow = 0;
  steerNow = 0;
  /** Is it braking (for the brake lights), is the handbrake on. */
  braking = false;
  handbrake = false;
  /** The slope part of pitch (applyTo tilts the whole car by it) and the squat/dive part (the body). */
  slopePitch = 0;
  bodyPitch = 0;
  /** Seconds since the last onImpact, for throttling scrape callbacks. */
  private impactCd = 0;
  private reverseHold = 0;
  /** The current substep. */
  private h = STEP;
  private longAcc = 0;
  private latAcc = 0;
  private yTarget = 0;
  /** Is the car on a road at all (false only before the first place). */
  private placed = false;

  constructor(
    readonly net: RoadNet,
    tune: CarTune,
    role: CarRole = 'player'
  ) {
    this.tune = full(tune);
    this.role = role;
    this.halfLength = tune.length / 2;
    this.halfWidth = tune.width / 2;
    this.mass = tune.mass;
    this.inertia = (tune.mass * (tune.length * tune.length + tune.width * tune.width)) / 12;
  }

  /** Forward speed (negative reversing). Setting it keeps the sideways slip. */
  get speed(): number {
    return this.velocity.x * -Math.sin(this.yaw) + this.velocity.z * -Math.cos(this.yaw);
  }
  set speed(v: number) {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const lat = this.lateral;
    this.velocity.x = fx * v + Math.cos(this.yaw) * lat;
    this.velocity.z = fz * v - Math.sin(this.yaw) * lat;
  }

  /** Sideways speed, + to the right. */
  get lateral(): number {
    return this.velocity.x * Math.cos(this.yaw) - this.velocity.z * Math.sin(this.yaw);
  }

  place(at: RoadPos, speed: number): void {
    const f = this.net.sampleInto(at.road, at.s, _frame);
    this.position.copy(f.pos).addScaledVector(f.right, at.d);
    this.yaw = Math.atan2(-f.tangent.x, -f.tangent.z);
    this.at.road = at.road;
    this.at.s = at.s;
    this.at.d = at.d;
    this.velocity.set(-Math.sin(this.yaw) * speed, 0, -Math.cos(this.yaw) * speed);
    this.resetState();
    this.ride(1, true);
  }

  /** Put it at a world pose (the cop on his shoulder, the airport), finding the road under it from scratch. */
  setPose(pos: THREE.Vector3, yaw: number, speed = 0): void {
    this.position.copy(pos);
    this.yaw = yaw;
    this.velocity.set(-Math.sin(yaw) * speed, 0, -Math.cos(yaw) * speed);
    this.net.locateGlobal(pos, this.at);
    this.resetState();
    this.ride(1, true);
  }

  private resetState(): void {
    this.yawRate = 0;
    this.steerAngle = 0;
    this.steerNow = 0;
    this.throttleNow = 0;
    this.reverseHold = 0;
    this.slide = 0;
    this.scrape = 0;
    this.longAcc = 0;
    this.latAcc = 0;
    this.bodyPitch = 0;
    this.roll = 0;
    this.placed = true;
  }

  /** Steering lock at a speed: what puts the tyres just past their grip, between steerHigh and steerLow. */
  lockAt(v: number): number {
    const t = this.tune;
    const v2 = Math.max(1e-3, v * v);
    const lock = Math.atan((t.latMax * 1.15 * t.wheelbase) / v2);
    return Math.min(t.steerLow, Math.max(t.steerHigh, lock));
  }

  update(dt: number, input: DriveInput | null): void {
    if (!(dt > 0) || !this.placed) return;
    dt = Math.min(dt, 0.1);
    const n = Math.max(1, Math.ceil(dt / STEP - 1e-6));
    const h = dt / n;
    this.scrape *= Math.exp(-dt * 10);
    this.impactCd += dt;
    for (let i = 0; i < n; i++) this.step(h, input);
    // Body: squat/dive and roll follow the accelerations, a little behind
    const k = 1 - Math.exp(-dt * 9);
    const pitchT = Math.max(-0.055, Math.min(0.04, this.longAcc * 0.005));
    const rollT = Math.max(-0.075, Math.min(0.075, this.latAcc * 0.0075));
    this.bodyPitch += (pitchT - this.bodyPitch) * k;
    this.roll += (rollT - this.roll) * k;
    this.pitch = this.slopePitch + this.bodyPitch;
  }

  private step(h: number, input: DriveInput | null): void {
    const t = this.tune;
    this.h = h;
    const thrIn = input ? clamp(input.throttle, -1, 1) : 0;
    const steerIn = input ? clamp(input.steer, -1, 1) : this.steerNow * Math.max(0, 1 - h * 6);
    const hb = input ? input.handbrake : false;
    this.handbrake = hb;

    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // forward (−sin, −cos), right (cos, −sin)
    let vF = -this.velocity.x * sy - this.velocity.z * cy;
    let vL = this.velocity.x * cy - this.velocity.z * sy;
    const av = Math.abs(vF);

    // ---- inputs, smoothed: a keyboard is all or nothing, a car isn't
    const towardIn = Math.abs(steerIn) > Math.abs(this.steerNow) && steerIn * this.steerNow >= 0;
    const sRate = towardIn ? t.steerRate / (1 + av / 42) : t.steerRate * 1.8;
    this.steerNow += clamp(steerIn - this.steerNow, -sRate * h, sRate * h);
    const tRate = thrIn > this.throttleNow ? 5 : 9;
    this.throttleNow += clamp(thrIn - this.throttleNow, -tRate * h, tRate * h);
    const thr = this.throttleNow;

    // ---- along
    let a = 0;
    let driving = false;
    this.braking = false;
    if (thr > 0.02) {
      if (vF < -0.3) {
        a = t.brake * thr;
        this.braking = true;
      } else {
        // A torque curve that pulls hard low down and fades into the top speed
        const x = Math.max(0, vF) / (t.topSpeed * 1.02);
        const x2 = x * x;
        a = t.accel * thr * Math.max(0, 1 - x2 * x2 * x) * (1 - 0.3 * x);
        driving = true;
      }
      this.reverseHold = 0;
    } else if (thr < -0.02) {
      if (vF > 0.6) {
        a = t.brake * thr; // negative
        this.braking = true;
        this.reverseHold = 0;
      } else {
        // Stopped, still holding the brake: a beat, then it goes into reverse
        this.reverseHold += h;
        if (this.reverseHold > 0.22) {
          a = vF > -t.reverseSpeed ? t.accel * 0.55 * thr : 0;
          driving = true;
        } else {
          a = -vF / Math.max(h, 1e-3);
          this.braking = true;
        }
      }
    }
    // Engine braking off the throttle, rolling and air
    let drag = 0.22 + 0.00012 * vF * vF;
    if (Math.abs(thr) <= 0.02) drag += 0.9;
    if (hb && av > 0.3) drag += 3.6;
    // Sliding sideways costs speed
    drag += Math.min(3, Math.abs(vL) * 0.22);
    const slopeA = -G * Math.sin(this.slopePitch);
    let vNew = vF + (a + slopeA) * h;
    // Drag never reverses the car
    const dv = drag * h;
    if (!driving && Math.abs(vNew) <= dv) vNew = Math.abs(slopeA) > 0.6 && !hb ? vNew : 0;
    else vNew -= Math.sign(vNew) * dv;
    this.longAcc = (vNew - vF) / h;
    vF = vNew;

    // ---- turning: the bicycle model's yaw rate, capped by grip
    const lock = this.lockAt(av);
    this.steerAngle = this.steerNow * lock;
    let wT = (-vF * Math.tan(this.steerAngle)) / t.wheelbase;
    const latCap = t.latMax * (hb ? 1.9 : 1.08);
    const wMax = latCap / Math.max(av, 2.5);
    wT = clamp(wT, -wMax, wMax);
    if (hb && av > 4) {
      // The rear lets go and comes round: rotation the front wheels alone couldn't give
      wT = clamp(wT * 1.2 - Math.sign(vF) * this.steerNow * Math.min(1.9, av * 0.1), -2.7, 2.7);
    }
    // Low speed: the tyres hold the car to what the wheels say
    const resp = hb ? 4.5 : 10 - 4 * this.slide;
    this.yawRate += (wT - this.yawRate) * Math.min(1, resp * h);

    // ---- sideways: the tyres scrub the slip, up to what they can hold
    const slipAng = Math.atan2(Math.abs(vL), Math.max(1, av));
    let k = t.grip * (hb ? 0.22 : 1) * (slipAng > 0.18 ? 0.6 : 1);
    let cap = t.latMax * (hb ? 0.42 : 1.15) * (slipAng > 0.18 ? 0.8 : 1);
    if (av < 3) {
      // Nearly stopped: tyres just don't slide sideways
      k = Math.max(k, 14);
      cap = Math.max(cap, 12);
    }
    const scrub = Math.min(Math.abs(vL) * Math.min(1, k * h), cap * h);
    vL -= Math.sign(vL) * scrub;

    // Recompose in the old frame, then turn: the new heading is what makes the slip
    this.velocity.x = -sy * vF + cy * vL;
    this.velocity.z = -cy * vF - sy * vL;
    this.yaw += this.yawRate * h;
    this.latAcc = -vF * this.yawRate;
    this.position.x += this.velocity.x * h;
    this.position.z += this.velocity.z * h;

    const sl = Math.max(0, (Math.abs(vL) - 0.8) / 5);
    const lock2 = hb && av > 5 ? 0.55 : 0;
    const spin = thr > 0.85 && vF > 0 && vF < 5 ? (1 - vF / 5) * 0.45 : 0;
    this.slide = Math.min(1, Math.max(sl, lock2, spin));

    this.ride(h, false);
    this.walls();
    this.hitBlockers();
  }

  /** On the road: where it is, the deck's height and slope under it. */
  private ride(h: number, snap: boolean): void {
    this.net.locate(this.position, this.at, this.at);
    const f = this.net.sampleInto(this.at.road, this.at.s, _frame);
    this.yTarget = f.pos.y;
    const dy = this.yTarget - this.position.y;
    if (snap || Math.abs(dy) < 0.35) this.position.y = this.yTarget;
    else this.position.y += dy * Math.min(1, 14 * h);
    // Grade along the heading
    const th = Math.hypot(f.tangent.x, f.tangent.z) || 1;
    const grade = f.tangent.y / th;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const cosA = (fx * f.tangent.x + fz * f.tangent.z) / th;
    this.slopePitch = Math.atan(grade * cosA);
    const vF = this.velocity.x * fx + this.velocity.z * fz;
    this.velocity.y = vF * grade * cosA;
  }

  /** The corners, world, into `out` (index 0 FL, 1 FR, 2 RL, 3 RR). */
  corner(i: number, out: THREE.Vector3): THREE.Vector3 {
    const sx = i & 1 ? 1 : -1;
    const sz = i < 2 ? 1 : -1;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const x = sx * this.halfWidth;
    const z = sz * this.halfLength;
    // right (cos, −sin) * x + forward (−sin, −cos) * z
    out.set(this.position.x + cy * x - sy * z, this.position.y, this.position.z - sy * x - cy * z);
    return out;
  }

  /** The road's edges: push the deepest corner back in, kill the speed into the wall, scrape along it. */
  private walls(): void {
    for (let iter = 0; iter < 3; iter++) {
      let deepest = 0;
      for (let i = 0; i < 4; i++) {
        this.corner(i, _corner);
        const pen = this.net.edgePen(_corner, this.at, _n);
        if (pen > deepest) {
          deepest = pen;
          _deep.copy(_corner);
          _wallN.copy(_n);
        }
      }
      // The sides' midpoints too: a long car pinned against a bend touches there first
      if (deepest <= 0) return;
      this.position.x -= _wallN.x * deepest;
      this.position.z -= _wallN.z * deepest;
      _deep.x -= _wallN.x * deepest;
      _deep.z -= _wallN.z * deepest;
      this.contact(_deep, _wallN, Infinity, 0.12, 0.35, 'wall');
    }
  }

  /**
   * An impulse at a contact point against something immovable: `n` is the
   * outward normal (from the car into the obstacle). Kills the closing speed
   * (with a little bounce `e`), friction along the surface `mu`, the torque
   * from where it hit, and onImpact.
   */
  private contact(p: THREE.Vector3, n: THREE.Vector3, _m: number, e: number, mu: number, kind: 'wall'): void {
    const rx = p.x - this.position.x;
    const rz = p.z - this.position.z;
    // Point velocity: v + ω × r, ω about +y: (ω rz, −ω rx)
    const vpx = this.velocity.x + this.yawRate * rz;
    const vpz = this.velocity.z - this.yawRate * rx;
    const vn = vpx * n.x + vpz * n.z;
    if (vn <= 0) return;
    const rn = rz * n.x - rx * n.z; // (r × n)_y
    const invM = 1 / this.mass;
    const invI = 1 / this.inertia;
    const j = ((1 + e) * vn) / (invM + rn * rn * invI);
    this.velocity.x -= n.x * j * invM;
    this.velocity.z -= n.z * j * invM;
    this.yawRate -= rn * j * invI;
    // Friction along the wall
    const tx = -n.z;
    const tz = n.x;
    const vt = vpx * tx + vpz * tz;
    const rt = rz * tx - rx * tz;
    const jtMax = Math.abs(vt) / (invM + rt * rt * invI);
    const jt = Math.min(mu * j, jtMax) * Math.sign(vt);
    this.velocity.x -= tx * jt * invM;
    this.velocity.z -= tz * jt * invM;
    this.yawRate -= rt * jt * invI * 0.5;
    // Grinding along it: the panel dragging on the concrete
    const grind = Math.min(Math.abs(vt - jt * (invM + rt * rt * invI)), 3.2 * this.h);
    this.velocity.x -= tx * grind * Math.sign(vt);
    this.velocity.z -= tz * grind * Math.sign(vt);
    this.scrape = Math.max(this.scrape, Math.min(1, Math.abs(vt) / 18));
    if (this.onImpact && (vn > 3 || (vn > 0.4 && this.impactCd > 0.15))) {
      this.impactCd = 0;
      this.onImpact(vn, p, kind);
    }
  }

  /** The static solids: oriented boxes, SAT in the ground plane. */
  private hitBlockers(): void {
    const bl = this.blockers;
    if (!bl.length) return;
    const R = Math.hypot(this.halfLength, this.halfWidth);
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      if (this.position.y + 1.2 < b.minY || this.position.y > b.maxY) continue;
      const dx = b.centre.x - this.position.x;
      const dz = b.centre.z - this.position.z;
      const rb = Math.hypot(b.halfX, b.halfZ);
      if (dx * dx + dz * dz > (R + rb) * (R + rb)) continue;
      // Blocker axes: local X = (cos, −sin) and local Z = (sin, cos) for its yaw
      const bs = Math.sin(b.yaw);
      const bc = Math.cos(b.yaw);
      _boxB.cx = b.centre.x;
      _boxB.cz = b.centre.z;
      _boxB.ax = bc;
      _boxB.az = -bs;
      _boxB.ha = b.halfX;
      _boxB.bx = bs;
      _boxB.bz = bc;
      _boxB.hb = b.halfZ;
      boxOf(this, _boxA);
      if (!sat(_boxA, _boxB, this.velocity.x, this.velocity.z, _hit)) continue;
      this.position.x -= _hit.nx * _hit.depth;
      this.position.z -= _hit.nz * _hit.depth;
      _deep.set(_hit.px - _hit.nx * _hit.depth, this.position.y, _hit.pz - _hit.nz * _hit.depth);
      _n.set(_hit.nx, 0, _hit.nz);
      this.contact(_deep, _n, Infinity, 0.15, 0.4, 'wall');
    }
  }

  applyTo(rig: CarRig, dt: number): void {
    rig.group.position.copy(this.position);
    rig.group.rotation.set(this.slopePitch, this.yaw, 0, 'YXZ');
    rig.body.rotation.x = this.bodyPitch;
    rig.body.rotation.z = this.roll;
    const spin = (this.speed * dt) / this.tune.wheelRadius;
    // Locked rears under the handbrake: they don't turn
    rig.wheels.fl.rotation.x += spin;
    rig.wheels.fr.rotation.x += spin;
    const rearSpin = this.handbrake ? 0 : spin;
    rig.wheels.rl.rotation.x += rearSpin;
    rig.wheels.rr.rotation.x += rearSpin;
    // The rig's steer is + to the left; ours is + to the right
    rig.steer.l.rotation.y = -this.steerAngle;
    rig.steer.r.rotation.y = -this.steerAngle;
  }
}

const _frame = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), halfLeft: 0, halfRight: 0 };
const _wallN = new THREE.Vector3();

// ================================================================ collisions

/** An oriented box in the ground plane: centre, two unit axes and their half extents. */
export interface Box2 {
  cx: number;
  cz: number;
  ax: number;
  az: number;
  ha: number;
  bx: number;
  bz: number;
  hb: number;
}
export function makeBox(): Box2 {
  return { cx: 0, cz: 0, ax: 1, az: 0, ha: 1, bx: 0, bz: 1, hb: 1 };
}

/** A car's footprint: axis a = its right, axis b = its forward. */
export function boxAt(x: number, z: number, yaw: number, halfWidth: number, halfLength: number, out: Box2): Box2 {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  out.cx = x;
  out.cz = z;
  out.ax = c;
  out.az = -s;
  out.ha = halfWidth;
  out.bx = -s;
  out.bz = -c;
  out.hb = halfLength;
  return out;
}

function boxOf(car: DriveCar, out: Box2): Box2 {
  return boxAt(car.position.x, car.position.z, car.yaw, car.halfWidth, car.halfLength, out);
}

/** A SAT result: normal from A to B (unit), depth, and a contact point. */
export interface SatHit {
  nx: number;
  nz: number;
  depth: number;
  px: number;
  pz: number;
}
export function makeHit(): SatHit {
  return { nx: 0, nz: 0, depth: 0, px: 0, pz: 0 };
}

/**
 * Do two boxes overlap (2D SAT)? Writes the separating normal (from A to B),
 * depth and a contact point. Of the four axes it doesn't take simply the
 * shallowest: it takes the one the boxes most recently started to overlap
 * on, judged by the closing speed (`rvx`, `rvz`: A's velocity relative to
 * B), so a fast car that has sunk a metre into another's nose in one frame
 * is pushed back out the way it came, not out of the side.
 */
export function sat(A: Box2, B: Box2, rvx: number, rvz: number, out: SatHit): boolean {
  const dx = B.cx - A.cx;
  const dz = B.cz - A.cz;
  let bestScore = Infinity;
  let bnx = 0;
  let bnz = 0;
  let bdepth = 0;
  let owner = 0;
  for (let k = 0; k < 4; k++) {
    const nx = k === 0 ? A.ax : k === 1 ? A.bx : k === 2 ? B.ax : B.bx;
    const nz = k === 0 ? A.az : k === 1 ? A.bz : k === 2 ? B.az : B.bz;
    const ra = A.ha * Math.abs(A.ax * nx + A.az * nz) + A.hb * Math.abs(A.bx * nx + A.bz * nz);
    const rb = B.ha * Math.abs(B.ax * nx + B.az * nz) + B.hb * Math.abs(B.bx * nx + B.bz * nz);
    const dist = dx * nx + dz * nz;
    const over = ra + rb - Math.abs(dist);
    if (over <= 0) return false;
    const sg = dist >= 0 ? 1 : -1;
    const closing = (rvx * nx + rvz * nz) * sg; // A toward B along this axis
    const score = over / Math.max(closing, 1.5);
    if (score < bestScore) {
      bestScore = score;
      bnx = nx * sg;
      bnz = nz * sg;
      bdepth = over;
      owner = k < 2 ? 0 : 1;
    }
  }
  out.nx = bnx;
  out.nz = bnz;
  out.depth = bdepth;
  // Contact: the vertex of the other box deepest across the chosen face
  const P = owner === 0 ? B : A;
  const sgn = owner === 0 ? -1 : 1; // B's vertex most toward A (−n), or A's most toward B (+n)
  let best = -Infinity;
  for (let i = 0; i < 4; i++) {
    const sa = i & 1 ? 1 : -1;
    const sb = i & 2 ? 1 : -1;
    const vx = P.cx + P.ax * P.ha * sa + P.bx * P.hb * sb;
    const vz = P.cz + P.az * P.ha * sa + P.bz * P.hb * sb;
    const proj = (vx * bnx + vz * bnz) * sgn;
    if (proj > best) {
      best = proj;
      out.px = vx;
      out.pz = vz;
    }
  }
  return true;
}

const _boxA = makeBox();
const _boxB = makeBox();
const _hit = makeHit();
const _p = new THREE.Vector3();
const _dv = new THREE.Vector3();

/** A body in a collision: a DriveCar, or a traffic car seen as one. */
export interface Body {
  vx: number;
  vz: number;
  w: number;
  invM: number;
  invI: number;
}
const _ba: Body = { vx: 0, vz: 0, w: 0, invM: 0, invI: 0 };
const _bb: Body = { vx: 0, vz: 0, w: 0, invM: 0, invI: 0 };

/**
 * The impulse between two bodies at contact (px, pz) with normal n from a
 * to b. Writes the velocity changes into the bodies and returns the normal
 * closing speed (0 if they were already parting).
 */
export function impulse(a: Body, b: Body, ax: number, az: number, bx: number, bz: number, px: number, pz: number, nx: number, nz: number, e: number, mu: number): number {
  const rax = px - ax;
  const raz = pz - az;
  const rbx = px - bx;
  const rbz = pz - bz;
  const vax = a.vx + a.w * raz;
  const vaz = a.vz - a.w * rax;
  const vbx = b.vx + b.w * rbz;
  const vbz = b.vz - b.w * rbx;
  const rvx = vbx - vax;
  const rvz = vbz - vaz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return 0;
  const ran = raz * nx - rax * nz;
  const rbn = rbz * nx - rbx * nz;
  const den = a.invM + b.invM + ran * ran * a.invI + rbn * rbn * b.invI;
  const j = (-(1 + e) * vn) / den;
  a.vx -= nx * j * a.invM;
  a.vz -= nz * j * a.invM;
  a.w -= ran * j * a.invI;
  b.vx += nx * j * b.invM;
  b.vz += nz * j * b.invM;
  b.w += rbn * j * b.invI;
  // Friction
  const tx = -nz;
  const tz = nx;
  const vt = rvx * tx + rvz * tz;
  const rat = raz * tx - rax * tz;
  const rbt = rbz * tx - rbx * tz;
  const dent = a.invM + b.invM + rat * rat * a.invI + rbt * rbt * b.invI;
  const jt = clamp(-vt / dent, -mu * j, mu * j);
  a.vx -= tx * jt * a.invM;
  a.vz -= tz * jt * a.invM;
  a.w -= rat * jt * a.invI;
  b.vx += tx * jt * b.invM;
  b.vz += tz * jt * b.invM;
  b.w += rbt * jt * b.invI;
  return -vn;
}

function loadCar(c: DriveCar, out: Body): Body {
  out.vx = c.velocity.x;
  out.vz = c.velocity.z;
  out.w = c.yawRate;
  out.invM = 1 / c.mass;
  out.invI = 1 / c.inertia;
  return out;
}

/** Write a body's new velocity back into a car, scaled by how much it lets itself be shoved. */
function storeCar(c: DriveCar, b: Body): void {
  const k = c.shove;
  c.velocity.x += (b.vx - c.velocity.x) * k;
  c.velocity.z += (b.vz - c.velocity.z) * k;
  c.yawRate += (b.w - c.yawRate) * k;
}

/**
 * Car against car, between two DriveCars (the player, the boss, the cop).
 * Separates them by mass, exchanges momentum, spins them about where they
 * touched, fires both onImpacts. Returns whether they touched.
 */
export function collideCars(a: DriveCar, b: DriveCar): boolean {
  if (Math.abs(a.position.y - b.position.y) > 2.5) return false;
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  const R = Math.hypot(a.halfLength, a.halfWidth) + Math.hypot(b.halfLength, b.halfWidth);
  if (dx * dx + dz * dz > R * R) return false;
  boxOf(a, _boxA);
  boxOf(b, _boxB);
  if (!sat(_boxA, _boxB, a.velocity.x - b.velocity.x, a.velocity.z - b.velocity.z, _hit)) return false;
  // Separate by mass (and by how much each lets itself be pushed)
  const wa = (a.shove / a.mass) / (a.shove / a.mass + b.shove / b.mass + 1e-12);
  const wb = 1 - wa;
  a.position.x -= _hit.nx * _hit.depth * wa;
  a.position.z -= _hit.nz * _hit.depth * wa;
  b.position.x += _hit.nx * _hit.depth * wb;
  b.position.z += _hit.nz * _hit.depth * wb;
  loadCar(a, _ba);
  loadCar(b, _bb);
  const vn = impulse(_ba, _bb, a.position.x, a.position.z, b.position.x, b.position.z, _hit.px, _hit.pz, _hit.nx, _hit.nz, 0.2, 0.25);
  storeCar(a, _ba);
  storeCar(b, _bb);
  if (vn > 0.3) {
    _p.set(_hit.px, (a.position.y + b.position.y) / 2 + 0.5, _hit.pz);
    a.onImpact?.(vn, _p, b.role);
    b.onImpact?.(vn, _p, a.role);
  }
  return true;
}

/**
 * A DriveCar against the traffic. A lane car touched at more than a crawl is
 * knocked out of its lane — traffic.hit(): it slides, spins and stays a
 * wreck; a wreck already sliding is shoved again. A gentle touch on a lane
 * car (nudging it at walking pace) leaves it in its lane and just stops you.
 */
export function collideTraffic(a: DriveCar, traffic: Traffic): number {
  let n = 0;
  const list = traffic.cars as readonly TrafficCarState[];
  const Ra = Math.hypot(a.halfLength, a.halfWidth);
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (Math.abs(t.position.y - a.position.y) > 2.5) continue;
    const dx = t.position.x - a.position.x;
    const dz = t.position.z - a.position.z;
    const R = Ra + Math.hypot(t.halfLength, t.halfWidth);
    if (dx * dx + dz * dz > R * R) continue;
    boxOf(a, _boxA);
    boxAt(t.position.x, t.position.z, t.yaw, t.halfWidth, t.halfLength, _boxB);
    if (!sat(_boxA, _boxB, a.velocity.x - t.vel.x, a.velocity.z - t.vel.z, _hit)) continue;
    n++;
    loadCar(a, _ba);
    _bb.vx = t.vel.x;
    _bb.vz = t.vel.z;
    _bb.w = t.spin;
    _bb.invM = 1 / t.mass;
    _bb.invI = 12 / (t.mass * (4 * t.halfLength * t.halfLength + 4 * t.halfWidth * t.halfWidth));
    const preVx = _bb.vx;
    const preVz = _bb.vz;
    const preW = _bb.w;
    // Probe the impulse first: is this a knock or a nudge?
    const rvx = a.velocity.x - t.vel.x;
    const rvz = a.velocity.z - t.vel.z;
    const closing = rvx * _hit.nx + rvz * _hit.nz;
    // The boss (shove < 1) knocks whatever he touches aside; anyone else nudging at a crawl doesn't
    const knock = t.wrecked || a.shove < 1 || closing > 1.2 || _hit.depth > 0.35;
    if (knock) {
      const wa = (a.shove / a.mass) / (a.shove / a.mass + 1 / t.mass);
      a.position.x -= _hit.nx * _hit.depth * wa;
      a.position.z -= _hit.nz * _hit.depth * wa;
      traffic.push(t.id, _hit.nx * _hit.depth * (1 - wa), _hit.nz * _hit.depth * (1 - wa));
      const vn = impulse(_ba, _bb, a.position.x, a.position.z, t.position.x, t.position.z, _hit.px, _hit.pz, _hit.nx, _hit.nz, 0.18, 0.3);
      storeCar(a, _ba);
      _dv.set(_bb.vx - preVx, 0, _bb.vz - preVz);
      // A spin-out: the impulse's own spin, and then some (it's a film)
      const extra = (0.6 + Math.min(1.6, vn * 0.12)) * (Math.sign(_bb.w - preW) || (Math.random() < 0.5 ? -1 : 1));
      traffic.hit(t.id, _dv, _bb.w - preW + (t.wrecked ? 0 : extra));
      if (vn > 0.3) {
        _p.set(_hit.px, a.position.y + 0.5, _hit.pz);
        a.onImpact?.(vn, _p, 'traffic');
      }
    } else {
      // A nudge: the lane car is immovable, the DriveCar stops against it
      a.position.x -= _hit.nx * _hit.depth;
      a.position.z -= _hit.nz * _hit.depth;
      _bb.invM = 0;
      _bb.invI = 0;
      const vn = impulse(_ba, _bb, a.position.x, a.position.z, t.position.x, t.position.z, _hit.px, _hit.pz, _hit.nx, _hit.nz, 0.05, 0.2);
      storeCar(a, _ba);
      if (vn > 0.3) {
        _p.set(_hit.px, a.position.y + 0.5, _hit.pz);
        a.onImpact?.(vn, _p, 'traffic');
      }
    }
  }
  return n;
}

/**
 * Every car-to-car contact for a frame: the DriveCars with each other and
 * each with the traffic. Call once a frame after every car has updated.
 * Runs `iterations` passes so a car wedged between two others settles.
 */
export function resolveCollisions(cars: readonly DriveCar[], traffic: Traffic | null, iterations = 2): void {
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) collideCars(cars[i], cars[j]);
    if (traffic) for (let i = 0; i < cars.length; i++) collideTraffic(cars[i], traffic);
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
