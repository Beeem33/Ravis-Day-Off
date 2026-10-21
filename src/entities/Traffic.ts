import * as THREE from 'three';
import type { CarKind } from '../scenes/Level8Contracts';
import type { ICar, ITraffic, Lane, RoadId, RoadPos, TrafficCar } from '../scenes/StreetContracts';
import { bakedCar, carMaterials, CAR_COLOURS, CAR_SPECS } from '../environment/VehicleProps';
import { boxAt, impulse, makeBox, makeHit, sat, type Body } from './DriveCar';
import { makeFrame, type RoadNet } from './RoadNet';

/**
 * Every other car on the road. A pool of cars that live in a window around
 * the player (by route distance), each following its lane with a simple
 * car-following model (IDM: it slows for whatever is ahead in its lane —
 * another car, a wreck, Ravi), changing lanes now and then on the highway,
 * spawned out of sight at the window's ends and recycled when it falls out.
 *
 * Chase reactions: a fast car closing from behind in their lane makes some
 * brake (badly), some edge aside, and plenty honk (onHorn); one coming at
 * them in their own lane makes them stand on the brakes and swerve.
 *
 * hit() knocks a car out of its lane for good: it becomes a free sliding
 * body (velocity, spin, tyre friction, the road's edges as walls, knocking
 * into other cars on its way) and then a stationary wreck that stays in the
 * road (still collidable) until it's well behind.
 *
 * Drawing: one InstancedMesh per (kind, part) — paint, trim, glass, lamps —
 * from VehicleProps' baked cars, the paint taking the instance colour, plus
 * a crumpled set per kind for the wrecks. Only sets with cars in them draw.
 */

export interface TrafficOptions {
  /** Cars per lane, relative to the default spacing (1 = the default gaps below); 0 = none on that road. */
  density?: Partial<Record<RoadId, number>>;
  /** Bumper-to-bumper gap range per road, metres, at density 1. */
  gaps?: Partial<Record<RoadId, [number, number]>>;
  seed?: number;
  /** Pool size. Default 72. */
  maxCars?: number;
  /** The window, route metres from the player: ahead and behind. Defaults 450 / 120. */
  ahead?: number;
  behind?: number;
  /** New cars only appear at least this far ahead / behind the player (except on the first fill). Defaults 260 / 80. */
  spawnAheadMin?: number;
  spawnBehindMin?: number;
  /** Draw wrecks with the crumpled geometry. Default true. */
  wreckLook?: boolean;
  /** Paint meshes cast shadows. Default true. */
  castShadow?: boolean;
  /** Chance a highway car in the rightmost lane takes the exit (if the exit has lanes). Default 0.3. */
  exitChance?: number;
}

const DEFAULT_GAPS: Record<RoadId, [number, number]> = {
  city: [18, 45],
  onramp: [30, 70],
  highway: [25, 70],
  exit: [30, 80],
  airport: [25, 60]
};

/** What a traffic car carries besides the contract's fields. */
export interface TrafficCarState extends TrafficCar {
  /** World velocity, m/s. */
  vel: THREE.Vector3;
  /** Yaw rate, rad/s (wrecks spinning). */
  spin: number;
  mass: number;
  /** +1 / −1 along its road while in lane; 0 once wrecked. */
  dir: 1 | -1 | 0;
}

const KINDS: readonly CarKind[] = ['sedan', 'hatch', 'suv', 'pickup'];
/** How common each kind is on the road. */
const KIND_W = [0.42, 0.24, 0.24, 0.1];

class TCar implements TrafficCarState {
  id: number;
  kind: CarKind = 'sedan';
  position = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  at: RoadPos = { road: 'city', s: 0, d: 0 };
  wrecked = false;
  halfLength = 2.3;
  halfWidth = 0.9;
  vel = new THREE.Vector3();
  spin = 0;
  mass = 1300;
  dir: 1 | -1 | 0 = 1;

  active = false;
  lane = -1;
  laneDir: 1 | -1 = 1;
  v0 = 13;
  vd = 0;
  colour = new THREE.Color();
  laneTimer = 0;
  hornCd = 0;
  react = 0;
  reactBrake = 1;
  swerve = 0;
  trait = 0;
  pitch = 0;
  R = 0;
  takeExit = false;
  /** Lane-forward, horizontal unit (dir × tangent), from the last pose. */
  fx = 0;
  fz = -1;
  wreckAge = 0;
  still = false;
  constructor(id: number) {
    this.id = id;
  }
}

interface LaneInfo {
  idx: number;
  road: RoadId;
  lane: Lane;
  /** The lane this one carries on into in its direction of travel (next road for +1, the previous for −1), or −1. */
  next: number;
  /** For highway +1 lanes: the exit lane to take at the fork, or −1. */
  exitLane: number;
  /** Is this the rightmost same-direction lane (the one that can take the exit). */
  rightmost: boolean;
  /** Other lanes on the same road going the same way, by offset. */
  siblings: number[];
  list: Int32Array;
  n: number;
  gapMin: number;
  gapMax: number;
  nextGapA: number;
  nextGapB: number;
  minR: number;
  maxR: number;
  /** Speeds of the cars at minR / maxR. */
  minV: number;
  maxV: number;
  count: number;
}

interface VisualSet {
  meshes: THREE.InstancedMesh[];
  count: number;
}

const IDS: readonly RoadId[] = ['city', 'onramp', 'highway', 'exit', 'airport'];

const _f = makeFrame();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _bA = makeBox();
const _bB = makeBox();
const _hit = makeHit();
const _b1: Body = { vx: 0, vz: 0, w: 0, invM: 0, invI: 0 };
const _b2: Body = { vx: 0, vz: 0, w: 0, invM: 0, invI: 0 };
const _dv = new THREE.Vector3();
const _pos = { road: 'city' as RoadId, s: 0, d: 0 };

function mulberry(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Traffic implements ITraffic {
  readonly object = new THREE.Group();
  /** The cars on the road now (lane cars and wrecks). Rebuilt each update; ids index the pool and stay valid while a car lives. */
  readonly cars: TrafficCarState[] = [];
  enabled = true;
  onHorn: ((pos: THREE.Vector3) => void) | null = null;

  private pool: TCar[] = [];
  private free: number[] = [];
  private lanes: LaneInfo[] = [];
  private wrecks: number[] = [];
  private sets: VisualSet[] = [];
  private rng: () => number;
  private opts: Required<Omit<TrafficOptions, 'density' | 'gaps' | 'seed'>> & { density: Record<RoadId, number> };
  private lastR0 = NaN;
  private laneStart = 0;
  private time = 0;

  constructor(
    readonly net: RoadNet,
    opts: TrafficOptions = {}
  ) {
    this.object.name = 'traffic';
    this.rng = mulberry(opts.seed ?? 1234);
    const density = {} as Record<RoadId, number>;
    for (const id of IDS) density[id] = opts.density?.[id] ?? 1;
    this.opts = {
      maxCars: opts.maxCars ?? 72,
      ahead: opts.ahead ?? 450,
      behind: opts.behind ?? 120,
      spawnAheadMin: opts.spawnAheadMin ?? 260,
      spawnBehindMin: opts.spawnBehindMin ?? 80,
      wreckLook: opts.wreckLook ?? true,
      castShadow: opts.castShadow ?? true,
      exitChance: opts.exitChance ?? 0.3,
      density
    };
    const N = this.opts.maxCars;
    for (let i = 0; i < N; i++) {
      this.pool.push(new TCar(i));
      this.free.push(N - 1 - i);
    }

    // Lanes, and how they carry on through the joins
    const roads = net.roads;
    for (const id of IDS) {
      const r = roads[id];
      const g = opts.gaps?.[id] ?? DEFAULT_GAPS[id];
      const dens = density[id];
      for (const lane of r.lanes) {
        this.lanes.push({
          idx: this.lanes.length,
          road: id,
          lane,
          next: -1,
          exitLane: -1,
          rightmost: false,
          siblings: [],
          list: new Int32Array(N),
          n: 0,
          gapMin: dens > 0 ? g[0] / dens : Infinity,
          gapMax: dens > 0 ? g[1] / dens : Infinity,
          nextGapA: 0,
          nextGapB: 0,
          minR: 0,
          maxR: 0,
          minV: 0,
          maxV: 0,
          count: 0
        });
      }
    }
    const nearest = (road: RoadId | null, dir: 1 | -1, offset: number): number => {
      if (!road) return -1;
      let best = -1;
      let bd = Infinity;
      for (const L of this.lanes) {
        if (L.road !== road || L.lane.dir !== dir) continue;
        const d = Math.abs(L.lane.offset - offset);
        if (d < bd) {
          bd = d;
          best = L.idx;
        }
      }
      return best;
    };
    for (const L of this.lanes) {
      const r = roads[L.road];
      L.next = L.lane.dir === 1 ? nearest(r.next, 1, L.lane.offset) : nearest(net.prevOf(L.road), -1, L.lane.offset);
      L.siblings = this.lanes
        .filter((o) => o.road === L.road && o.lane.dir === L.lane.dir)
        .sort((a, b) => a.lane.offset - b.lane.offset)
        .map((o) => o.idx);
      const same = L.siblings.map((i) => this.lanes[i].lane.offset * L.lane.dir);
      L.rightmost = L.lane.offset * L.lane.dir >= Math.max(...same) - 1e-6;
      if (L.lane.dir === 1 && L.rightmost) {
        for (const b of net.branchesOf(L.road)) {
          const e = this.lanes.filter((o) => o.road === b && o.lane.dir === 1).sort((a, c) => a.lane.offset - c.lane.offset);
          if (e.length) L.exitLane = e[0].idx;
        }
      }
      this.rollGaps(L);
    }

    // Drawing
    const mats = carMaterials();
    const looks = this.opts.wreckLook ? [false, true] : [false];
    for (const kind of KINDS) {
      for (const wreck of looks) {
        const baked = bakedCar(kind, wreck);
        const parts: [THREE.BufferGeometry, THREE.Material, string][] = [
          [baked.paint, mats.paint, 'paint'],
          [baked.trim, mats.trim, 'trim'],
          [baked.glass, mats.glass, 'glass'],
          [baked.lamps, mats.lamps, 'lamps']
        ];
        const meshes = parts.map(([g, mat, name]) => {
          const m = new THREE.InstancedMesh(g, mat, N);
          m.name = `traffic ${kind}${wreck ? ' wreck' : ''} ${name}`;
          m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          m.frustumCulled = false;
          m.matrixAutoUpdate = false;
          m.count = 0;
          m.visible = false;
          m.castShadow = this.opts.castShadow && name === 'paint';
          m.receiveShadow = false;
          this.object.add(m);
          return m;
        });
        const col = new THREE.InstancedBufferAttribute(new Float32Array(N * 3).fill(1), 3);
        col.setUsage(THREE.DynamicDrawUsage);
        meshes[0].instanceColor = col;
        this.sets.push({ meshes, count: 0 });
      }
    }
  }

  private rollGaps(L: LaneInfo): void {
    L.nextGapA = L.gapMin + (L.gapMax - L.gapMin) * this.rng();
    L.nextGapB = L.gapMin + (L.gapMax - L.gapMin) * this.rng();
  }

  // ------------------------------------------------------------ the contract

  hit(id: number, imp: THREE.Vector3, spin: number): void {
    const c = this.pool[id];
    if (!c || !c.active) return;
    if (!c.wrecked) {
      c.wrecked = true;
      c.dir = 0;
      c.lane = -1;
      c.wreckAge = 0;
    }
    c.still = false;
    c.vel.x += imp.x;
    c.vel.z += imp.z;
    c.spin += spin;
    c.speed = Math.hypot(c.vel.x, c.vel.z);
  }

  /** Move a car bodily (collision separation). Wrecks only: a lane car's place is its lane. */
  push(id: number, dx: number, dz: number): void {
    const c = this.pool[id];
    if (!c || !c.active) return;
    c.position.x += dx;
    c.position.z += dz;
  }

  clear(road: RoadId, s0: number, s1: number): void {
    const lo = Math.min(s0, s1);
    const hi = Math.max(s0, s1);
    for (const c of this.pool) if (c.active && c.at.road === road && c.at.s >= lo && c.at.s <= hi) this.kill(c);
    this.rebuildList();
  }

  /** Lift the cars `which` picks out of the traffic, as they are now, for the scene to do with as it likes. */
  take(which: (c: TrafficCarState) => boolean): { kind: CarKind; colour: THREE.Color; position: THREE.Vector3; yaw: number; vel: THREE.Vector3 }[] {
    const out: { kind: CarKind; colour: THREE.Color; position: THREE.Vector3; yaw: number; vel: THREE.Vector3 }[] = [];
    for (const c of this.pool) {
      if (!c.active || !which(c)) continue;
      const vel = c.wrecked ? c.vel.clone() : new THREE.Vector3(c.fx * c.speed, 0, c.fz * c.speed);
      out.push({ kind: c.kind, colour: c.colour.clone(), position: c.position.clone(), yaw: c.yaw, vel });
      this.kill(c);
    }
    if (out.length) {
      this.rebuildList();
      this.writeInstances();
    }
    return out;
  }

  /** Everything off the road (a retry). The next update fills the window afresh. */
  reset(): void {
    for (const c of this.pool) if (c.active) this.kill(c);
    this.lastR0 = NaN;
    this.rebuildList();
    this.writeInstances();
  }

  private kill(c: TCar): void {
    c.active = false;
    c.wrecked = false;
    this.free.push(c.id);
  }

  private rebuildList(): void {
    this.cars.length = 0;
    this.wrecks.length = 0;
    for (const c of this.pool) {
      if (!c.active) continue;
      this.cars.push(c);
      if (c.wrecked) this.wrecks.push(c.id);
    }
  }

  // ------------------------------------------------------------ the frame

  update(dt: number, around: RoadPos, others: ICar[]): void {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const net = this.net;
    const R0 = net.routeS(around);
    const jump = !(Math.abs(R0 - this.lastR0) < 150);
    this.lastR0 = R0;

    // Lane lists, sorted by s (nearly sorted already: insertion sort is linear)
    for (const L of this.lanes) L.n = 0;
    this.wrecks.length = 0;
    for (const c of this.pool) {
      if (!c.active) continue;
      if (c.wrecked) {
        this.wrecks.push(c.id);
        continue;
      }
      const L = this.lanes[c.lane];
      L.list[L.n++] = c.id;
    }
    for (const L of this.lanes) {
      const a = L.list;
      for (let i = 1; i < L.n; i++) {
        const v = a[i];
        const s = this.pool[v].at.s;
        let j = i - 1;
        while (j >= 0 && this.pool[a[j]].at.s > s) {
          a[j + 1] = a[j];
          j--;
        }
        a[j + 1] = v;
      }
    }

    for (const L of this.lanes) for (let k = 0; k < L.n; k++) this.drive(this.pool[L.list[k]], L, k, dt, others);
    for (let i = 0; i < this.wrecks.length; i++) this.slideWreck(this.pool[this.wrecks[i]], dt);

    // Recycle, and each lane's extent
    for (const L of this.lanes) {
      L.count = 0;
      L.minR = Infinity;
      L.maxR = -Infinity;
    }
    const lo = R0 - this.opts.behind;
    const hi = R0 + this.opts.ahead;
    for (const c of this.pool) {
      if (!c.active) continue;
      c.R = net.routeS(c.at);
      if (c.wrecked) {
        if (c.R < lo - 40 || c.R > hi + 250) this.kill(c);
        continue;
      }
      if (c.R < lo - 15 || c.R > hi + 40) {
        this.kill(c);
        continue;
      }
      const L = this.lanes[c.lane];
      L.count++;
      if (c.R < L.minR) {
        L.minR = c.R;
        L.minV = c.speed;
      }
      if (c.R > L.maxR) {
        L.maxR = c.R;
        L.maxV = c.speed;
      }
    }

    if (this.enabled) this.spawnAll(R0, lo, hi, jump, others);
    this.rebuildList();
    this.writeInstances();
  }

  /** One lane car's frame: who's ahead, how hard to go, the chase, lane changes, and on along the lane. */
  private drive(c: TCar, L: LaneInfo, k: number, dt: number, others: ICar[]): void {
    const net = this.net;
    const road = net.roads[c.at.road];
    const dir = c.laneDir;
    const s = c.at.s;
    const d = c.at.d;
    c.hornCd -= dt;
    c.react -= dt;
    c.laneTimer -= dt;

    // ---- what's ahead: the next car in the lane (on into the next road's lane at the end)
    let gap = Infinity;
    let vLead = 0;
    let staticAhead = Infinity;
    const lk = k + dir;
    if (lk >= 0 && lk < L.n) {
      const o = this.pool[L.list[lk]];
      gap = (o.at.s - s) * dir - c.halfLength - o.halfLength;
      vLead = o.speed;
    } else if (L.next >= 0) {
      const N = this.lanes[L.next];
      if (N.n > 0) {
        const o = this.pool[N.list[dir === 1 ? 0 : N.n - 1]];
        const toEnd = dir === 1 ? road.length - s : s;
        const into = dir === 1 ? o.at.s : net.roads[o.at.road].length - o.at.s;
        gap = toEnd + into - c.halfLength - o.halfLength;
        vLead = o.speed;
      }
    }
    // Cars changing into this lane from the next one along, and wrecks in the way
    const corridor = c.halfWidth + 1.25;
    const laneYaw = Math.atan2(-c.fx, -c.fz);
    for (let i = 0; i < this.wrecks.length; i++) {
      const w = this.pool[this.wrecks[i]];
      if (w.at.road !== c.at.road) continue;
      const ahead = (w.at.s - s) * dir;
      if (ahead < 0 || ahead > 150) continue;
      // A wreck lying across the road blocks as wide as it is long
      const cr = Math.abs(Math.cos(w.yaw - laneYaw));
      const sr = Math.abs(Math.sin(w.yaw - laneYaw));
      if (Math.abs(w.at.d - d) > c.halfWidth + w.halfWidth * cr + w.halfLength * sr + 0.4) continue;
      const g = ahead - c.halfLength - (w.halfLength * cr + w.halfWidth * sr) - 0.5;
      if (g < gap) {
        gap = g;
        vLead = 0;
      }
      if (g < staticAhead) staticAhead = g;
    }
    // The DriveCars (Ravi, the boss, the cop): in the lane ahead they're obstacles; close behind and fast, a fright
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o.at.road !== c.at.road) continue;
      const ahead = (o.at.s - s) * dir;
      const lat = Math.abs(o.at.d - d);
      const vAlong = o.velocity.x * c.fx + o.velocity.z * c.fz;
      const oh = (o as { halfLength?: number }).halfLength ?? 2.4;
      if (ahead > 0 && ahead < 150 && lat < corridor + 0.3) {
        const g = ahead - c.halfLength - oh;
        if (g < gap) {
          gap = g;
          vLead = vAlong;
        }
        if (vAlong < 2 && g < staticAhead) staticAhead = g;
        // Coming at us in our own lane
        if (vAlong < -3 && ahead < 80) this.fright(c, o, dir, true);
      } else if (ahead < -3 && ahead > -38 && lat < 2.8 && vAlong > c.speed + 7) {
        this.fright(c, o, dir, false);
      } else if (Math.abs(ahead) < 4 && lat < 3.4 && Math.abs(vAlong - c.speed) > 12 && c.hornCd <= 0 && this.rng() < 0.02) {
        this.honk(c); // a near miss going past
      }
    }

    // ---- IDM
    const v = c.speed;
    const v0 = Math.max(0.1, c.v0 * (c.react > 0 ? c.reactBrake : 1));
    const A = 2.2;
    const B = 3.2;
    let acc = A * (1 - Math.pow(v / v0, 4));
    if (gap < Infinity) {
      const sStar = 3 + Math.max(0, v * 1.25 + (v * (v - vLead)) / (2 * Math.sqrt(A * B)));
      const g = Math.max(0.2, gap);
      acc -= A * (sStar / g) * (sStar / g);
    }
    acc = Math.max(gap < 8 ? -20 : -9, Math.min(A, acc));
    c.speed = Math.max(0, v + acc * dt);
    // Whatever the model says, never drive into the car in front
    if (gap < 1.5) c.speed = Math.min(c.speed, Math.max(0, vLead) * Math.max(0, gap / 1.5));

    // ---- lane changes: now and then on multi-lane roads, or to get round something stopped
    if (L.siblings.length > 1 && c.laneTimer <= 0) {
      const urgent = staticAhead < 45;
      const roadP = c.at.road === 'highway' ? 1 : 0.35;
      if (urgent || this.rng() < roadP) {
        const pos = L.siblings.indexOf(L.idx);
        const choices: number[] = [];
        if (pos > 0) choices.push(L.siblings[pos - 1]);
        if (pos < L.siblings.length - 1) choices.push(L.siblings[pos + 1]);
        const tgt = choices[Math.floor(this.rng() * choices.length)];
        if (tgt !== undefined && this.laneClear(c, this.lanes[tgt], others)) {
          c.lane = tgt;
          // A lane change off the rightmost lane gives up the exit; onto it, maybe takes it
          const T = this.lanes[tgt];
          c.takeExit = T.exitLane >= 0 && this.rng() < this.opts.exitChance;
        }
      }
      c.laneTimer = urgent ? 0.6 : 7 + this.rng() * 18;
    }

    // ---- along the lane, and across it toward the lane's line (plus any swerve)
    const lane = this.lanes[c.lane].lane;
    let ns = s + dir * c.speed * dt;
    if (c.react <= 0) c.swerve *= Math.max(0, 1 - dt * 1.2);
    let dT = lane.offset + c.swerve;
    net.sampleInto(c.at.road, Math.max(0, Math.min(road.length, ns)), _f);
    // Keep to the drivable width — unless the lane is out beyond it (the far carriageway's cosmetic lanes)
    if (lane.offset > -_f.halfLeft && lane.offset < _f.halfRight)
      dT = Math.max(-_f.halfLeft + c.halfWidth + 0.15, Math.min(_f.halfRight - c.halfWidth - 0.15, dT));
    const vdT = Math.max(-1.6, Math.min(1.6, (dT - d) * 0.9));
    c.vd += (vdT - c.vd) * Math.min(1, dt * 3);
    let nd = d + c.vd * dt;

    // ---- the joins, and the fork
    let rid = c.at.road;
    if (dir === 1) {
      const T = this.lanes[c.lane];
      if (c.takeExit && T.exitLane >= 0) {
        const ex = net.roads[this.lanes[T.exitLane].road];
        const fs = ex.from!.s;
        if (s <= fs && ns > fs) {
          // Onto the exit, keeping its place in the world
          net.point({ road: rid, s: ns, d: nd }, _c);
          rid = ex.id;
          ns -= fs;
          net.sampleInto(rid, ns, _f);
          nd = (_c.x - _f.pos.x) * _f.right.x + (_c.z - _f.pos.z) * _f.right.z;
          c.lane = T.exitLane;
          c.takeExit = false;
        }
      }
      if (ns > net.roads[rid].length) {
        const nx = this.lanes[c.lane].next;
        if (nx < 0) {
          this.kill(c);
          return;
        }
        ns -= net.roads[rid].length;
        rid = this.lanes[nx].road;
        c.lane = nx;
        c.takeExit = this.lanes[nx].exitLane >= 0 && this.rng() < this.opts.exitChance;
        // Up to the new road's pace: off the avenue and up the ramp, it's highway speed
        c.v0 = this.lanes[nx].lane.speed * (0.88 + this.rng() * 0.2);
      }
    } else if (ns < 0) {
      const nx = this.lanes[c.lane].next;
      if (nx < 0) {
        this.kill(c);
        return;
      }
      rid = this.lanes[nx].road;
      ns += net.roads[rid].length;
      c.lane = nx;
    }
    c.at.road = rid;
    c.at.s = ns;
    c.at.d = nd;
    this.poseLane(c);
  }

  /** Something fast behind, or coming head-on: brake, edge aside, honk — or nothing, some people just don't look. */
  private fright(c: TCar, o: ICar, dir: 1 | -1, headOn: boolean): void {
    if (c.react > 0) return;
    c.react = headOn ? 1.6 : 1.2 + this.rng() * 0.8;
    // Edge aside — only toward the kerb side of its own direction, never into the next lane's traffic
    const L = this.lanes[c.lane];
    const pos = L.siblings.indexOf(L.idx);
    const outer = pos === (dir === 1 ? L.siblings.length - 1 : 0);
    const away = outer ? dir : 0;
    if (headOn) {
      c.reactBrake = 0.25;
      c.swerve = away * 1.2;
      if (c.hornCd <= 0) this.honk(c);
      return;
    }
    if (c.trait < 0.4) {
      c.reactBrake = 0.6;
    } else if (c.trait < 0.85) {
      c.reactBrake = away ? 0.92 : 0.7;
      c.swerve = away * (0.6 + this.rng() * 0.5);
    } else {
      c.react = 0.8;
      c.reactBrake = 1;
    }
    if (c.hornCd <= 0 && this.rng() < 0.55) this.honk(c);
  }

  private honk(c: TCar): void {
    c.hornCd = 3 + this.rng() * 3;
    this.onHorn?.(c.position);
  }

  /** Room to move over into lane T: a gap ahead and behind, nobody fast coming up in it. */
  private laneClear(c: TCar, T: LaneInfo, others: ICar[]): boolean {
    const dir = c.laneDir;
    const s = c.at.s;
    for (let i = 0; i < T.n; i++) {
      const o = this.pool[T.list[i]];
      const ahead = (o.at.s - s) * dir;
      if (ahead >= 0 && ahead - c.halfLength - o.halfLength < 14 + c.speed * 0.6) return false;
      if (ahead < 0 && -ahead - c.halfLength - o.halfLength < 9 + Math.max(0, o.speed - c.speed) * 2.5) return false;
    }
    for (let i = 0; i < this.wrecks.length; i++) {
      const w = this.pool[this.wrecks[i]];
      if (w.at.road !== c.at.road) continue;
      const ahead = (w.at.s - s) * dir;
      const ext = c.halfWidth + w.halfWidth + Math.abs(Math.sin(w.yaw - c.yaw)) * (w.halfLength - w.halfWidth) + 0.5;
      if (ahead > -8 && ahead < 50 && Math.abs(w.at.d - T.lane.offset) < ext) return false;
    }
    for (const o of others) {
      if (o.at.road !== c.at.road) continue;
      const ahead = (o.at.s - s) * dir;
      if (ahead > -40 && ahead < 25 && Math.abs(o.at.d - T.lane.offset) < 2.8) return false;
    }
    return true;
  }

  /** World pose of a lane car from its (road, s, d) and lateral drift. */
  private poseLane(c: TCar): void {
    const f = this.net.sampleInto(c.at.road, c.at.s, _f);
    const dir = c.laneDir;
    c.position.copy(f.pos).addScaledVector(f.right, c.at.d);
    const th = Math.hypot(f.tangent.x, f.tangent.z) || 1;
    c.fx = (dir * f.tangent.x) / th;
    c.fz = (dir * f.tangent.z) / th;
    const vs = Math.max(c.speed, 2);
    const hx = c.fx * vs + f.right.x * c.vd;
    const hz = c.fz * vs + f.right.z * c.vd;
    c.yaw = Math.atan2(-hx, -hz);
    c.pitch = Math.asin(Math.max(-1, Math.min(1, dir * f.tangent.y)));
    c.vel.set(c.fx * c.speed + f.right.x * c.vd, 0, c.fz * c.speed + f.right.z * c.vd);
  }

  /** A wreck: sliding and spinning down to a stop, off the walls, into anyone in the way. */
  private slideWreck(c: TCar, dt: number): void {
    c.wreckAge += dt;
    if (c.still) return;
    const net = this.net;
    c.position.x += c.vel.x * dt;
    c.position.z += c.vel.z * dt;
    c.yaw += c.spin * dt;
    // Friction by direction: tyres scrubbing sideways bite hard (~0.85 g); rolling along its
    // length, bent and dragging, much less (~0.35 g) — so a spinning wreck slows in pulses
    const sy0 = Math.sin(c.yaw);
    const cy0 = Math.cos(c.yaw);
    let vf = -c.vel.x * sy0 - c.vel.z * cy0;
    let vs = c.vel.x * cy0 - c.vel.z * sy0;
    const sp = Math.hypot(vf, vs) || 1;
    const df = 3.4 * dt * (Math.abs(vf) / sp);
    const dsd = 8.3 * dt * (Math.abs(vs) / sp);
    vf = Math.abs(vf) <= df ? 0 : vf - Math.sign(vf) * df;
    vs = Math.abs(vs) <= dsd ? 0 : vs - Math.sign(vs) * dsd;
    c.vel.x = -sy0 * vf + cy0 * vs;
    c.vel.z = -cy0 * vf - sy0 * vs;
    // The spin dies as the speed does: it keeps turning while it's still sliding hard
    const ws = Math.abs(c.spin);
    const wdec = (0.7 + ws * 0.3 + 6 / (2 + sp)) * dt;
    c.spin = ws <= wdec ? 0 : c.spin - Math.sign(c.spin) * wdec;
    // The road's edges
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? 1 : -1;
      const sz = i < 2 ? 1 : -1;
      const sy = Math.sin(c.yaw);
      const cy = Math.cos(c.yaw);
      const x = sx * c.halfWidth;
      const z = sz * c.halfLength;
      _c.set(c.position.x + cy * x - sy * z, c.position.y, c.position.z - sy * x - cy * z);
      const pen = net.edgePen(_c, c.at, _n);
      if (pen > 0) {
        c.position.x -= _n.x * pen;
        c.position.z -= _n.z * pen;
        const vn = c.vel.x * _n.x + c.vel.z * _n.z;
        if (vn > 0) {
          c.vel.x -= _n.x * vn * 1.25;
          c.vel.z -= _n.z * vn * 1.25;
          // Clipping the wall with one corner turns it
          const rx = _c.x - c.position.x;
          const rz = _c.z - c.position.z;
          c.spin += ((rz * _n.x - rx * _n.z) * vn * 0.25) / (c.halfLength * c.halfLength);
          c.spin *= 0.8;
        }
      }
    }
    net.locate(c.position, c.at, c.at);
    c.position.y = net.heightAt(c.at.road, c.at.s);
    c.speed = Math.hypot(c.vel.x, c.vel.z);
    c.pitch = 0;
    if (c.speed < 0.05 && Math.abs(c.spin) < 0.02 && c.wreckAge > 0.3) {
      c.still = true;
      c.vel.set(0, 0, 0);
      c.spin = 0;
      return;
    }
    if (c.speed > 1.2 || Math.abs(c.spin) > 0.6) this.wreckContacts(c);
  }

  /** A moving wreck against every other car near it: the pile-up. Lane cars it touches are knocked out of their lanes too. */
  private wreckContacts(w: TCar): void {
    const Rw = Math.hypot(w.halfLength, w.halfWidth);
    for (const o of this.pool) {
      if (!o.active || o === w) continue;
      const dx = o.position.x - w.position.x;
      const dz = o.position.z - w.position.z;
      const R = Rw + Math.hypot(o.halfLength, o.halfWidth);
      if (dx * dx + dz * dz > R * R || Math.abs(o.position.y - w.position.y) > 2.5) continue;
      boxAt(w.position.x, w.position.z, w.yaw, w.halfWidth, w.halfLength, _bA);
      boxAt(o.position.x, o.position.z, o.yaw, o.halfWidth, o.halfLength, _bB);
      if (!sat(_bA, _bB, w.vel.x - o.vel.x, w.vel.z - o.vel.z, _hit)) continue;
      const share = w.mass / (w.mass + o.mass);
      w.position.x -= _hit.nx * _hit.depth * (1 - share);
      w.position.z -= _hit.nz * _hit.depth * (1 - share);
      if (o.wrecked) {
        o.position.x += _hit.nx * _hit.depth * share;
        o.position.z += _hit.nz * _hit.depth * share;
      }
      _b1.vx = w.vel.x;
      _b1.vz = w.vel.z;
      _b1.w = w.spin;
      _b1.invM = 1 / w.mass;
      _b1.invI = 3 / (w.mass * (w.halfLength * w.halfLength + w.halfWidth * w.halfWidth));
      _b2.vx = o.vel.x;
      _b2.vz = o.vel.z;
      _b2.w = o.spin;
      _b2.invM = 1 / o.mass;
      _b2.invI = 3 / (o.mass * (o.halfLength * o.halfLength + o.halfWidth * o.halfWidth));
      const vn = impulse(_b1, _b2, w.position.x, w.position.z, o.position.x, o.position.z, _hit.px, _hit.pz, _hit.nx, _hit.nz, 0.15, 0.3);
      if (vn <= 0) continue;
      w.vel.x = _b1.vx;
      w.vel.z = _b1.vz;
      w.spin = _b1.w;
      _dv.set(_b2.vx - o.vel.x, 0, _b2.vz - o.vel.z);
      const dw = _b2.w - o.spin;
      if (o.wrecked || vn > 1.5) this.hit(o.id, _dv, dw + (o.wrecked ? 0 : (this.rng() - 0.5) * 2));
    }
  }

  // ------------------------------------------------------------ spawning

  private spawnAll(R0: number, lo: number, hi: number, fill: boolean, others: ICar[]): void {
    const nL = this.lanes.length;
    if (!nL) return;
    this.laneStart = (this.laneStart + 1) % nL;
    this.fillNow = fill;
    this.R0 = R0;
    for (let q = 0; q < nL; q++) {
      const L = this.lanes[(this.laneStart + q) % nL];
      if (!(L.gapMin < Infinity)) continue;
      const base = this.net.routeBase(L.road);
      const len = this.net.roads[L.road].length;
      const a = Math.max(lo, base + 4);
      const b = Math.min(hi, base + len - 4);
      if (b <= a) continue;
      const carLen = 4.8;
      if (L.count === 0) {
        if (fill) {
          let R = a + this.rng() * L.nextGapA;
          while (R <= b && this.free.length) {
            this.spawn(L, R - base, others);
            R += carLen + L.gapMin + (L.gapMax - L.gapMin) * this.rng();
          }
        } else {
          if (this.far(b)) this.spawn(L, b - base - this.rng() * 10, others);
          else if (this.far(a)) this.spawn(L, a - base + this.rng() * 10, others);
        }
        continue;
      }
      // Beyond the last car toward the window's far end, and before the first toward its near end
      // Arriving behind a car (upstream of it), come in at a speed it can follow at
      const dir = L.lane.dir;
      const Ra = L.maxR + carLen + L.nextGapA;
      if (Ra <= b && this.far(Ra) && this.spawn(L, Ra - base, others, dir === -1 ? L.maxV : Infinity, L.nextGapA)) this.rollGaps(L);
      const Rb = L.minR - carLen - L.nextGapB;
      if (Rb >= a && this.far(Rb) && this.spawn(L, Rb - base, others, dir === 1 ? L.minV : Infinity, L.nextGapB)) this.rollGaps(L);
    }
  }

  private fillNow = false;
  private R0 = 0;

  /** Out of sight: far enough ahead or behind the player (or the first fill). */
  private far(R: number): boolean {
    return this.fillNow || R - this.R0 > this.opts.spawnAheadMin || this.R0 - R > this.opts.spawnBehindMin;
  }

  private spawn(L: LaneInfo, s: number, others: ICar[], vLead = Infinity, gap = 40): boolean {
    if (!this.free.length) return false;
    const net = this.net;
    _pos.road = L.road;
    _pos.s = s;
    _pos.d = L.lane.offset;
    net.point(_pos, _c);
    // Not on top of anyone
    for (const o of others) if (o.position.distanceToSquared(_c) < 14 * 14) return false;
    for (let i = 0; i < this.wrecks.length; i++) {
      const w = this.pool[this.wrecks[i]];
      if (w.position.distanceToSquared(_c) < 9 * 9) return false;
    }
    for (const id of L.siblings) {
      const T = this.lanes[id];
      for (let i = 0; i < T.n; i++) {
        const o = this.pool[T.list[i]];
        if (o.active && o.lane === L.idx && Math.abs(o.at.s - s) < 9) return false;
      }
    }
    const c = this.pool[this.free.pop()!];
    let r = this.rng();
    let ki = 0;
    while (ki < KINDS.length - 1 && r > KIND_W[ki]) {
      r -= KIND_W[ki];
      ki++;
    }
    const kind = KINDS[ki];
    const spec = CAR_SPECS[kind];
    c.active = true;
    c.wrecked = false;
    c.still = false;
    c.kind = kind;
    c.halfLength = spec.length / 2;
    c.halfWidth = spec.width / 2;
    c.mass = spec.mass;
    c.colour.setHex(CAR_COLOURS[Math.floor(this.rng() * CAR_COLOURS.length)]);
    c.lane = L.idx;
    c.laneDir = L.lane.dir;
    c.dir = L.lane.dir;
    c.v0 = L.lane.speed * (0.88 + this.rng() * 0.2);
    // Behind a slower car: no faster than it can stop for it (v² ≤ vl² + 2·4·gap)
    c.speed = vLead < Infinity ? Math.min(c.v0, Math.sqrt(vLead * vLead + 8 * Math.max(0, gap - 8))) : c.v0;
    c.vd = 0;
    c.spin = 0;
    c.swerve = 0;
    c.react = 0;
    c.reactBrake = 1;
    c.hornCd = this.rng() * 2;
    c.trait = this.rng();
    c.laneTimer = 3 + this.rng() * 15;
    c.takeExit = L.exitLane >= 0 && this.rng() < this.opts.exitChance;
    c.at.road = L.road;
    c.at.s = s;
    c.at.d = L.lane.offset;
    c.R = net.routeBase(L.road) + s;
    this.poseLane(c);
    L.count++;
    if (c.R < L.minR) {
      L.minR = c.R;
      L.minV = c.speed;
    }
    if (c.R > L.maxR) {
      L.maxR = c.R;
      L.maxV = c.speed;
    }
    // Into the lane's list too, so a second spawn this frame sees it
    if (L.n < L.list.length) {
      let j = L.n++;
      while (j > 0 && this.pool[L.list[j - 1]].at.s > s) {
        L.list[j] = L.list[j - 1];
        j--;
      }
      L.list[j] = c.id;
    }
    return true;
  }

  // ------------------------------------------------------------ drawing

  private writeInstances(): void {
    for (const set of this.sets) set.count = 0;
    const looks = this.opts.wreckLook ? 2 : 1;
    for (const c of this.pool) {
      if (!c.active) continue;
      const set = this.sets[KINDS.indexOf(c.kind) * looks + (c.wrecked && looks === 2 ? 1 : 0)];
      const i = set.count++;
      _e.set(c.pitch, c.yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(c.position, _q, _one);
      for (const m of set.meshes) m.setMatrixAt(i, _m);
      set.meshes[0].setColorAt(i, c.colour);
    }
    for (const set of this.sets) {
      for (const m of set.meshes) {
        m.count = set.count;
        m.visible = set.count > 0;
        if (set.count > 0) m.instanceMatrix.needsUpdate = true;
      }
      if (set.count > 0 && set.meshes[0].instanceColor) set.meshes[0].instanceColor.needsUpdate = true;
    }
  }

  /** How many cars are live now, and how many of them wrecks. */
  stats(): { cars: number; wrecks: number; free: number } {
    return { cars: this.cars.length, wrecks: this.wrecks.length, free: this.free.length };
  }

  dispose(): void {
    for (const set of this.sets) for (const m of set.meshes) m.dispose();
    this.object.clear();
  }
}
