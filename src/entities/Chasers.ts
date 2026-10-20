import * as THREE from 'three';
import type { DriveInput, IBossDriver, ICar, ICopDriver, ITraffic, RoadId, RoadPos, TrafficCar } from '../scenes/StreetContracts';
import { BOSS_TUNE, COP_TUNE, DriveCar, type CarTune } from './DriveCar';
import { makeFrame, type RoadNet } from './RoadNet';

/**
 * The two AI drivers. Both drive a DriveCar with real inputs — throttle,
 * steering, handbrake — through the same physics as Ravi, so what you see is
 * a car being driven: it leans, it slips, it misses things by a foot.
 *
 * Steering is pure pursuit on a point a speed-dependent distance down the
 * route, at the lateral offset of the lane the driver has picked. Picking a
 * lane: look 30–80 m down each candidate line (the lanes, the shoulder, and
 * for the boss in the city the oncoming lanes) for the first thing in it —
 * a traffic car, a wreck, Ravi — and how fast it's going relative to him
 * (oncoming cars eat the room fast), score them, and stay put unless the
 * current one is about to run out.
 */

interface Obstacle {
  R: number;
  d: number;
  /** Speed along the route, m/s (negative: coming toward). */
  v: number;
  hl: number;
  hw: number;
  road: RoadId;
}

const _f = makeFrame();
const _g = makeFrame();
const _p = new THREE.Vector3();
const _look: RoadPos = { road: 'city', s: 0, d: 0 };
const _look2: RoadPos = { road: 'city', s: 0, d: 0 };

interface Style {
  /** Room in the current line below which he changes (m, and seconds of his speed). */
  trigger: number;
  triggerT: number;
  /** How fast his line moves across, m/s. */
  lateral: number;
  /** Uses the oncoming lanes to pass (city). */
  oncoming: boolean;
  shoulder: boolean;
  /** How close he'll pass a car beside his line (m of clearance between bodies). */
  clearance: number;
  /** Fraction of grip he corners at. */
  cornerGrip: number;
}

const BOSS_STYLE: Style = { trigger: 24, triggerT: 0.95, lateral: 4.2, oncoming: true, shoulder: true, clearance: 0.35, cornerGrip: 0.82 };
const COP_STYLE: Style = { trigger: 30, triggerT: 1.25, lateral: 3.0, oncoming: false, shoulder: true, clearance: 0.6, cornerGrip: 0.78 };

class RouteDriver {
  readonly car: DriveCar;
  /** Follow the exit at the fork. */
  takeExit = true;
  /** The line he's on (offset he is steering to) and the one he wants. */
  lineD = 0;
  wantD = 0;
  protected input: DriveInput = { throttle: 0, steer: 0, handbrake: false };
  protected obstacles: Obstacle[] = [];
  private nObs = 0;
  private lineHold = 0;
  private stuck = 0;
  private unstick = 0;
  /** Debug/HUD: the room he saw in his line last frame. */
  room = 0;
  /**
   * Where he steers from: his place on the route, except that a driver who
   * wants the exit counts himself on it as soon as he's within its overlap
   * with the highway (located on the highway he'd look on down the highway).
   */
  protected base: RoadPos = { road: 'city', s: 0, d: 0 };
  private baseRoad: RoadId | null = null;
  private tmp: RoadPos = { road: 'city', s: 0, d: 0 };

  protected updateBase(): void {
    const me = this.car;
    const net = this.net;
    const b = this.base;
    b.road = me.at.road;
    b.s = me.at.s;
    b.d = me.at.d;
    if (this.takeExit) {
      for (const br of net.branchesOf(me.at.road)) {
        const fs = net.roads[br].from!.s;
        if (me.at.s < fs - 1 || me.at.s > fs + net.roads[br].length) continue;
        const t = this.tmp;
        t.road = br;
        t.s = Math.max(0, me.at.s - fs);
        t.d = 0;
        net.locate(me.position, t, t);
        if (t.road === br) {
          b.road = t.road;
          b.s = t.s;
          b.d = t.d;
        }
      }
    }
    if (this.baseRoad !== null && this.baseRoad !== b.road && net.roads[b.road].from?.road === this.baseRoad) {
      // Over the fork: his line's offsets are from the exit's centreline now
      this.lineD = b.d;
      this.wantD = nearestLane(net.roads[b.road].lanes, b.d);
    }
    this.baseRoad = b.road;
  }

  constructor(
    readonly net: RoadNet,
    tune: CarTune,
    role: 'boss' | 'cop',
    protected style: Style
  ) {
    this.car = new DriveCar(net, tune, role);
    for (let i = 0; i < 96; i++) this.obstacles.push({ R: 0, d: 0, v: 0, hl: 0, hw: 0, road: 'city' });
  }

  /** Everything around worth avoiding, in route terms. */
  protected gather(traffic: ITraffic, extra: readonly (ICar | null)[], behind = 12): void {
    const net = this.net;
    const me = this.car;
    this.updateBase();
    const myR = net.routeS(me.at);
    const myRoad = me.at.road;
    net.sampleInto(myRoad, me.at.s, _f);
    const th = Math.hypot(_f.tangent.x, _f.tangent.z) || 1;
    const tx = _f.tangent.x / th;
    const tz = _f.tangent.z / th;
    const roadYaw = Math.atan2(-tx, -tz);
    let n = 0;
    // Through the joins the centrelines carry on, so offsets compare; across the fork they don't
    const nextRoad = net.roads[myRoad].next;
    const prevRoad = net.prevOf(myRoad);
    const cars = traffic.cars;
    for (let i = 0; i < cars.length && n < this.obstacles.length; i++) {
      const c = cars[i] as TrafficCar & { vel?: THREE.Vector3 };
      if (c.at.road !== myRoad && c.at.road !== nextRoad && c.at.road !== prevRoad) continue;
      const R = net.routeS(c.at);
      if (R < myR - behind || R > myR + 110) continue;
      const o = this.obstacles[n++];
      o.R = R;
      o.d = c.at.d;
      o.v = c.vel ? c.vel.x * tx + c.vel.z * tz : Math.cos(c.yaw - roadYaw) * c.speed;
      // Its footprint in the road's frame: a car lying across the road is as wide as it is long
      const cr = Math.abs(Math.cos(c.yaw - roadYaw));
      const sr = Math.abs(Math.sin(c.yaw - roadYaw));
      o.hl = c.halfLength * cr + c.halfWidth * sr;
      o.hw = c.halfWidth * cr + c.halfLength * sr;
      o.road = c.at.road;
    }
    for (const c of extra) {
      if (!c || (c.at.road !== myRoad && c.at.road !== nextRoad && c.at.road !== prevRoad) || n >= this.obstacles.length) continue;
      const R = net.routeS(c.at);
      if (R < myR - behind || R > myR + 110) continue;
      const o = this.obstacles[n++];
      o.R = R;
      o.d = c.at.d;
      o.v = c.velocity.x * tx + c.velocity.z * tz;
      o.hl = (c as { halfLength?: number }).halfLength ?? 2.4;
      o.hw = (c as { halfWidth?: number }).halfWidth ?? 0.95;
      o.road = c.at.road;
    }
    this.nObs = n;
  }

  /** The speed he'd like to be doing (set each frame before picking a line): room is judged against it. */
  protected vRef = 20;
  /** The nearest thing in the last line measured: its raw gap (bumper to bumper) and speed along the route. */
  protected leadGap = Infinity;
  protected leadV = 0;

  /**
   * Room down a line: the gap to the first thing in it, less what he'd eat
   * of it in a second and a half at the speed he wants (so a car dawdling
   * ahead is no room at all to a man doing twice its speed, and an oncoming
   * one is a wall). Also leaves the raw gap and its speed in leadGap/leadV.
   */
  protected roomIn(d: number, look: number): number {
    const me = this.car;
    const myR = this.net.routeS(me.at);
    const vRef = Math.max(5, me.speed, this.vRef);
    let room = look;
    this.leadGap = Infinity;
    this.leadV = 0;
    for (let i = 0; i < this.nObs; i++) {
      const o = this.obstacles[i];
      const ahead = o.R - myR;
      if (ahead < -me.halfLength - o.hl + 0.5 || ahead > look + 60) continue;
      if (Math.abs(o.d - d) > me.halfWidth + o.hw + this.style.clearance) continue;
      const g = ahead - me.halfLength - o.hl;
      if (g < this.leadGap) {
        this.leadGap = g;
        this.leadV = o.v;
      }
      const eff = g - Math.max(0, vRef - o.v) * 1.6;
      if (eff < room) room = eff;
    }
    return room;
  }

  /** The lines he could take here. */
  protected nObsPublic(): number {
    return this.nObs;
  }

  protected candidates(out: { d: number; pen: number }[]): number {
    const me = this.car;
    const net = this.net;
    const road = net.roads[this.base.road];
    net.sampleInto(this.base.road, this.base.s + 25, _g);
    const hw = me.halfWidth;
    let n = 0;
    const put = (d: number, pen: number): void => {
      if (n >= out.length) return;
      out[n].d = d;
      out[n].pen = pen;
      n++;
    };
    const minD = -_g.halfLeft + hw + 0.6;
    const maxD = _g.halfRight - hw - 0.6;
    let fwdMin = Infinity;
    let fwdMax = -Infinity;
    for (const L of road.lanes) {
      if (L.offset < minD - 0.5 || L.offset > maxD + 0.5) continue; // the far carriageway, beyond the barrier
      if (L.dir === 1) {
        put(clamp(L.offset, minD, maxD), 0);
        fwdMin = Math.min(fwdMin, L.offset);
        fwdMax = Math.max(fwdMax, L.offset);
      } else if (this.style.oncoming) put(clamp(L.offset, minD, maxD), 22);
    }
    if (n === 0) put(0, 0);
    this.rightLane = fwdMax > -Infinity ? fwdMax : 0;
    if (this.style.shoulder && fwdMax > -Infinity) {
      if (maxD - fwdMax > 2.2) put(maxD, 9);
      if (fwdMin - minD > 2.2 && this.base.road === 'highway') put(minD, 12);
    }
    return n;
  }

  private cands = Array.from({ length: 10 }, () => ({ d: 0, pen: 0 }));
  /** The rightmost same-way lane's offset here. */
  private rightLane = 0;
  private steerSign = 1;

  /** Choose the line: stay in it while it has room, else the best of the others. */
  protected pickLine(dt: number, forceRight: number): void {
    const me = this.car;
    if (this.base.road !== me.at.road) return;
    const v = Math.max(0, me.speed);
    const look = clamp(30 + v * 1.0, 30, 80);
    const n = this.candidates(this.cands);
    this.lineHold -= dt;
    const curRoom = this.roomIn(this.wantD, look);
    let best = this.wantD;
    let bestScore = -Infinity;
    let curScore = -Infinity;
    let curPen = 0;
    for (let i = 0; i < n; i++) {
      const c = this.cands[i];
      let room = this.roomIn(c.d, look);
      // The way across must be passable too (a car alongside blocks the move)
      const mid = (c.d + this.base.d) / 2;
      room = Math.min(room, this.roomIn(mid, 14) + 30);
      let score = room - c.pen - Math.abs(c.d - this.base.d) * 1.6;
      // The exit's pull, but never so hard that a clear lane loses to a blocked one
      if (forceRight > 0) score += Math.max(-45, Math.min(c.d, this.rightLane) * forceRight);
      const isCur = Math.abs(c.d - this.wantD) < 0.5;
      if (isCur) {
        score += 6;
        curPen = c.pen;
        curScore = score;
      }
      if (score > bestScore) {
        bestScore = score;
        best = c.d;
      }
    }
    const trigger = Math.max(this.style.trigger, v * this.style.triggerT);
    const valid = curScore > -Infinity;
    // Move when: his line's gone (road changed), it's running out, he's in an oncoming lane or on
    // the shoulder and can get out, the exit's calling, or another line is just much better
    const want =
      !valid || curRoom < trigger || (curPen > 0 && this.lineHold <= 0) || forceRight > 0 || bestScore > curScore + 35;
    if (want && Math.abs(best - this.wantD) > 0.3 && (this.lineHold <= 0 || curRoom < trigger * 0.6 || !valid)) {
      this.wantD = best;
      this.lineHold = 0.9;
    }
    this.room = curRoom;
  }

  /** Corner speed: the tightest bend in the next couple of seconds. */
  protected cornerLimit(): number {
    const me = this.car;
    const net = this.net;
    const v = Math.max(8, me.speed);
    const span = clamp(v * 2.2, 25, 130);
    let limit = Infinity;
    net.sampleInto(this.base.road, this.base.s, _f);
    let px = _f.tangent.x;
    let pz = _f.tangent.z;
    let prev = 0;
    for (let k = 1; k <= 5; k++) {
      const ds = (span * k) / 5;
      net.advance(this.base, ds, this.takeExit, _look2);
      net.sampleInto(_look2.road, _look2.s, _g);
      const ang = Math.abs(Math.atan2(px * _g.tangent.z - pz * _g.tangent.x, px * _g.tangent.x + pz * _g.tangent.z));
      const kappa = ang / Math.max(1, ds - prev);
      if (kappa > 1e-4) {
        const vmax = Math.sqrt((me.tune.latMax * this.style.cornerGrip) / kappa);
        // Brake in time: v² = vmax² + 2 a d
        const reach = Math.sqrt(vmax * vmax + 2 * 8 * Math.max(0, prev));
        limit = Math.min(limit, reach);
      }
      px = _g.tangent.x;
      pz = _g.tangent.z;
      prev = ds;
    }
    return limit;
  }

  /** Steer for the line and hold a speed: one step of the car. */
  protected driveTo(dt: number, vWant: number, brakeHard = false): void {
    const me = this.car;
    const net = this.net;
    const v = me.speed;
    // The line slides across at the driver's rate
    this.lineD += clamp(this.wantD - this.lineD, -this.style.lateral * dt, this.style.lateral * dt);
    const L = clamp(7 + Math.abs(v) * 0.42, 8, 30);
    net.advance(this.base, L, this.takeExit, _look);
    _look.d = this.lineD;
    if (_look.road !== this.base.road && net.roads[_look.road].from?.road === this.base.road) {
      // The fork is just ahead: offsets on the exit are from its own centreline — aim for its lane
      _look.d = nearestLane(net.roads[_look.road].lanes, 0);
    }
    // Keep the target inside the road there
    net.sampleInto(_look.road, _look.s, _g);
    _look.d = clamp(_look.d, -_g.halfLeft + me.halfWidth + 0.3, _g.halfRight - me.halfWidth - 0.3);
    net.point(_look, _p);
    const dx = _p.x - me.position.x;
    const dz = _p.z - me.position.z;
    const sy = Math.sin(me.yaw);
    const cy = Math.cos(me.yaw);
    const fwd = -dx * sy - dz * cy;
    const right = dx * cy - dz * sy;
    const Ld = Math.max(3, Math.hypot(dx, dz));
    let alpha = Math.atan2(right, fwd);
    // Target behind him (a U-turn out of a parking place): commit to one way round
    if (Math.abs(alpha) > 2.4) alpha = Math.abs(alpha) * this.steerSign;
    else if (Math.abs(alpha) > 0.05) this.steerSign = Math.sign(alpha);
    // Way off the nose: slow enough to turn
    if (Math.abs(alpha) > 0.9) vWant = Math.min(vWant, 7);
    const kappa = (2 * Math.sin(alpha)) / Ld;
    // Damp the yaw rate a touch: no fishtailing on the straights
    let delta = Math.atan(kappa * me.tune.wheelbase);
    delta += me.yawRate * 0.02 * Math.sign(v || 1);
    const lock = me.lockAt(Math.abs(v));
    let steer = clamp(delta / lock, -1, 1);
    let throttle: number;
    const err = vWant - v;
    if (err > 0) throttle = clamp(err * 0.35 + 0.15, 0, 1);
    else throttle = err < -1.5 || brakeHard ? clamp(err * 0.25, -1, 0) : 0;

    // Stuck nose-in to something: back out and go round
    if (this.unstick > 0) {
      this.unstick -= dt;
      throttle = -1;
      steer = -steer;
    } else if (vWant > 4 && Math.abs(v) < 1.2 && throttle > 0.4) {
      this.stuck += dt;
      if (this.stuck > 1.3) {
        this.unstick = 1.6;
        this.stuck = 0;
      }
    } else this.stuck = 0;

    this.input.throttle = throttle;
    this.input.steer = steer;
    this.input.handbrake = false;
    me.update(dt, this.input);
  }

  /** Coast along at a speed in the current line (cutscenes). */
  protected hold(dt: number, v: number): void {
    this.updateBase();
    this.wantD = this.base.d;
    this.driveTo(dt, v);
  }

  protected routeGap(ahead: ICar, behind: ICar): number {
    return this.net.routeS(ahead.at) - this.net.routeS(behind.at);
  }

  /** The speed to aim for given what's in his line: follow whatever's there, closing to a few metres. */
  protected followLimit(vWant: number): number {
    this.roomIn(this.lineD, 90);
    let g = this.leadGap;
    let vl = this.leadV;
    // Mid lane change: what's in the line he's moving to counts too, and where the car actually is
    // (it lags its line by a couple of metres at speed)
    for (let k = 0; k < 2; k++) {
      const d = k === 0 ? this.wantD : this.base.road === this.car.at.road ? this.car.at.d : this.lineD;
      if (Math.abs(d - this.lineD) < 0.5) continue;
      this.roomIn(d, 90);
      if (this.leadGap < g) {
        g = this.leadGap;
        vl = this.leadV;
      }
    }
    if (g === Infinity) return vWant;
    // v² = vl² + 2·a·(gap − margin): brake in time, at a hard but sane 7 m/s²
    const margin = 3 + Math.max(0, vl) * 0.25;
    const v = Math.sqrt(Math.max(0, Math.max(0, vl) ** 2 + 2 * 7 * Math.max(0, g - margin)));
    return Math.min(vWant, v);
  }

  private impatience = 0;
  private bully = 0;

  /**
   * followLimit, unless he's been stuck behind stopped traffic a while: then
   * for a couple of seconds he stops waiting and shoves his way through
   * (traffic.hit() knocks what he touches aside).
   */
  protected followOrShove(dt: number, v: number): number {
    const me = this.car;
    if (this.bully > 0) {
      this.bully -= dt;
      return Math.min(v, 14);
    }
    const out = this.followLimit(v);
    if (me.speed < 4 && v > 8 && out < 4) this.impatience += dt;
    else this.impatience = Math.max(0, this.impatience - dt * 2);
    if (this.impatience > 1.8) {
      this.bully = 2.5;
      this.impatience = 0;
    }
    return out;
  }

  /** How far before the fork the exit decides his lane (m), and the fork's route distance. */
  protected exitPull(): number {
    if (!this.takeExit) return 0;
    const net = this.net;
    const me = this.car;
    if (me.at.road !== 'highway') return 0;
    const ex = net.roads.exit;
    if (!ex.from) return 0;
    const toFork = ex.from.s - me.at.s;
    const v = Math.max(0, me.speed);
    // Across to the right in good time: it takes a couple of seconds at his lateral rate, and traffic
    if (toFork < 0 || toFork > Math.max(400, v * 10)) return 0;
    return toFork < Math.max(160, v * 6) ? 30 : 8;
  }
}

/** Cruise speeds the boss drifts back to when he has the gap he wants. */
const BOSS_CRUISE: Record<RoadId, number> = { city: 24, onramp: 27, highway: 43, exit: 30, airport: 24 };
const BOSS_FLOOR: Record<RoadId, number> = { city: 15, onramp: 17, highway: 27, exit: 18, airport: 14 };

/**
 * The boss: a maniac in a big black saloon, always just about catchable.
 * Rubber-bands to 35–70 m ahead of Ravi by route distance, picks his way
 * through traffic, shoulders and oncoming lanes and all, and always takes
 * the exit. He never wrecks himself: what he hits is shoved aside (his
 * DriveCar's shove is 0.25), he just wobbles.
 */
export class BossDriver extends RouteDriver implements IBossDriver {
  mode: 'drive' | 'hold' = 'drive';
  /** The gap he aims for, route metres ahead of Ravi. */
  gapMin = 35;
  gapMax = 70;
  private holdSpeed = -1;
  /** The speed he's aiming for this frame (debug/HUD). */
  vWant = 0;

  constructor(net: RoadNet, tune: CarTune = BOSS_TUNE) {
    super(net, tune, 'boss', BOSS_STYLE);
    this.car.shove = 0.25;
  }

  place(at: RoadPos, speed: number): void {
    this.car.place(at, speed);
    this.wantD = this.lineD = at.d;
  }

  update(dt: number, ravi: ICar, traffic: ITraffic, cop?: ICar | null): void {
    if (!(dt > 0)) return;
    const me = this.car;
    if (this.mode === 'hold') {
      if (this.holdSpeed < 0) this.holdSpeed = Math.max(0, me.speed);
      this.hold(dt, this.holdSpeed);
      return;
    }
    this.holdSpeed = -1;
    this.takeExit = true;
    this.gather(traffic, [ravi, cop ?? null]);

    const road = me.at.road;
    const gap = this.routeGap(me, ravi);
    const rv = Math.max(0, ravi.speed);
    const top = me.tune.topSpeed;
    const mid = (this.gapMin + this.gapMax) / 2;
    let v: number;
    if (gap < 20) v = top;
    else if (gap > 110) v = Math.max(BOSS_FLOOR[road], Math.min(BOSS_CRUISE[road], rv * 0.9));
    else {
      v = rv + (mid - gap) * 0.32;
      v = clamp(v, BOSS_FLOOR[road], top);
    }
    v = Math.min(v, this.cornerLimit());
    // His lane choice is judged against the speed he wants, then he follows whatever's still in his way
    this.vRef = v;
    this.pickLine(dt, this.exitPull());
    v = this.followOrShove(dt, v);
    // The end of the line: pull up before the airport road runs out
    const ar = this.net.roads.airport;
    if (road === 'airport') v = Math.min(v, Math.sqrt(2 * 6 * Math.max(0, ar.length - me.at.s - 8)));
    this.vWant = v;
    this.driveTo(dt, v);
  }
}

/**
 * The highway cop. 'parked' on his shoulder; 'launch': lights on, out
 * across the lanes behind them flat out; 'chase': hangs 25–60 m behind Ravi
 * by route distance, picking through traffic (more carefully than the
 * boss), and if Ravi slows right down he closes in and bumps him.
 */
export class CopDriver extends RouteDriver implements ICopDriver {
  mode: 'parked' | 'launch' | 'chase' = 'parked';
  gapMin = 25;
  gapMax = 60;
  /** Has the launch got him into a lane, up to speed (the scene can switch to 'chase'). */
  merged = false;
  vWant = 0;
  private bumpCd = 0;
  private bumping = false;

  constructor(net: RoadNet, tune: CarTune = COP_TUNE) {
    super(net, tune, 'cop', COP_STYLE);
    this.car.onImpact = null;
  }

  /** Park him (the scene: StreetData.cop.pos / yaw). */
  park(pos: THREE.Vector3, yaw: number): void {
    this.car.setPose(pos, yaw, 0);
    this.mode = 'parked';
    this.merged = false;
    this.wantD = this.lineD = this.car.at.d;
  }

  /** A bump on Ravi: back off a moment. Called by itself on contact; the scene may call it too. */
  bumped(): void {
    this.bumpCd = 2.2;
    this.bumping = false;
  }

  update(dt: number, ravi: ICar, traffic: ITraffic, boss?: ICar | null): void {
    if (!(dt > 0)) return;
    const me = this.car;
    this.bumpCd -= dt;
    if (this.mode === 'parked') {
      me.update(dt, PARKED);
      return;
    }
    // Follows Ravi off at the exit; if Ravi misses it, so does he
    const ex = this.net.roads.exit.from;
    this.takeExit = !(ravi.at.road === 'highway' && ex && ravi.at.s > ex.s + 30);
    if (this.mode === 'launch') {
      this.gather(traffic, [ravi, boss ?? null], 80);
      // Into the nearest proper lane, then whichever has room
      const lanes = this.net.roads[me.at.road].lanes.filter((l) => l.dir === 1);
      if (!this.merged) {
        let best = this.wantD;
        let bd = Infinity;
        for (const l of lanes) {
          const dd = Math.abs(l.offset - me.at.d);
          if (dd < bd) {
            bd = dd;
            best = l.offset;
          }
        }
        this.wantD = best;
        const fwd = Math.cos(me.yaw - this.laneYaw());
        if (Math.abs(me.at.d - best) < 1 && fwd > 0.97 && me.speed > 18) this.merged = true;
        // A look over the shoulder before pulling out: anything coming up the lanes he's crossing into?
        if (me.speed < 10 && this.comingUp(best)) {
          this.vWant = 0;
          this.driveTo(dt, 0, true);
          return;
        }
      } else {
        this.vRef = me.tune.topSpeed;
        this.pickLine(dt, this.exitPull());
      }
      this.vWant = me.tune.topSpeed;
      this.driveTo(dt, this.followLimit(Math.min(me.tune.topSpeed, this.cornerLimit())));
      return;
    }

    this.gather(traffic, [this.bumping ? null : ravi, boss ?? null]);
    const behind = this.routeGap(ravi, me);
    const rv = Math.max(0, ravi.speed);
    const top = me.tune.topSpeed;
    // Ravi's crawling: go and give him a nudge
    this.bumping = this.bumpCd <= 0 && rv < 7 && behind < 40 && behind > 0;
    let v: number;
    if (this.bumping) {
      this.wantD = ravi.at.d;
      v = rv + 5;
      // Touched his bumper: back off a moment, then (if he's still crawling) again
      const rh = (ravi as { halfLength?: number }).halfLength ?? 2.2;
      if (behind < me.halfLength + rh + 0.4 && Math.abs(ravi.at.d - me.at.d) < 1.6) this.bumped();
    } else {
      const mid = (this.gapMin + this.gapMax) / 2;
      if (behind > 90) v = top;
      else if (behind < 0) {
        // Somehow ahead of him: ease off and out of his line, let him by
        v = Math.max(5, rv * 0.75);
        const n = this.candidates(this.cands2);
        let far = this.wantD;
        let fd = -1;
        for (let i = 0; i < n; i++) {
          const dd = Math.abs(this.cands2[i].d - ravi.at.d);
          if (this.cands2[i].pen < 20 && dd > fd) {
            fd = dd;
            far = this.cands2[i].d;
          }
        }
        this.wantD = far;
      }
      else v = clamp(rv + (behind - mid) * 0.3, 6, top);
      if (behind < this.gapMin) v = Math.min(v, rv - 2);
      v = Math.min(v, this.cornerLimit());
      this.vRef = v;
      this.pickLine(dt, this.exitPull());
      v = this.followOrShove(dt, v);
    }
    this.vWant = v;
    this.driveTo(dt, Math.max(0, v));
  }

  private cands2 = Array.from({ length: 10 }, () => ({ d: 0, pen: 0 }));

  /** Is anything coming up behind him, fast, between his line and lane `d`? */
  private comingUp(d: number): boolean {
    const me = this.car;
    const myR = this.net.routeS(me.at);
    const lo = Math.min(d, me.at.d) - 2.4;
    const hi = Math.max(d, me.at.d) + 2.4;
    for (let i = 0; i < this.nObsPublic(); i++) {
      const o = this.obstacles[i];
      const ahead = o.R - myR;
      if (ahead > 8 || ahead < -80) continue;
      if (o.d < lo || o.d > hi) continue;
      if (o.v > me.speed + 4 && -ahead < 12 + (o.v - me.speed) * 2.2) return true;
    }
    return false;
  }

  private laneYaw(): number {
    const f = this.net.sampleInto(this.car.at.road, this.car.at.s, _f);
    return Math.atan2(-f.tangent.x, -f.tangent.z);
  }
}

const PARKED: DriveInput = { throttle: 0, steer: 0, handbrake: true };

/** The forward lane on a road nearest an offset (0 if it has none). */
function nearestLane(lanes: readonly { offset: number; dir: 1 | -1 }[], d: number): number {
  let best = 0;
  let bd = Infinity;
  for (const l of lanes) {
    if (l.dir !== 1) continue;
    const x = Math.abs(l.offset - d);
    if (x < bd) {
      bd = x;
      best = l.offset;
    }
  }
  return best;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
