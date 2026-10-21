import * as THREE from 'three';
import { STREET } from '../environment/StreetBuilder';
import { bakedCar, carMaterials } from '../environment/VehicleProps';
import type { RoadNet } from '../entities/RoadNet';
import type { ICar, RoadPos } from '../scenes/StreetContracts';
import type { CarKind, CarRig } from '../scenes/Level8Contracts';
import type { ParticleManager } from './ParticleManager';
import { MAX_HOLES, inHole, jag, jagEnd, openHole, resetHoles, type DeckHole } from './DeckCut';

/**
 * HighwayCollapse — a side of the highway giving way where a helicopter
 * came down on it: a 36 m stretch of our carriageway, from one edge (the
 * outer barrier, or the median) in across two lanes, breaks up into slabs
 * that tip off their broken edge and fall to the ground eight metres down,
 * with whatever cars were on them. What's left of the deck stands with
 * ragged broken faces and rebar sticking out of them (the holes themselves
 * are cut in the deck's own materials by DeckCut).
 *
 * The scene plans a hole first (when the helicopter goes, so there's time
 * to get out of the way): from then on it stands in the road as a hazard
 * for the boss, the cop and the traffic to steer round or stop for. Then
 * it opens it when the wreck comes down on it.
 *
 * Holes go between the median's lamp standards, clear of the gantries, so
 * nothing is left standing on thin air.
 */

const HALF = 18;
/** What the drivers (and the traffic, lane by lane) see of a hole: a car stopped across it. */
class Ghost implements ICar {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly at: RoadPos;
  yaw = 0;
  speed = 0;
  readonly steerAngle = 0;
  readonly pitch = 0;
  readonly roll = 0;
  readonly slide = 0;
  onImpact = null;
  constructor(
    s: number,
    d: number,
    readonly halfLength: number,
    readonly halfWidth: number
  ) {
    this.at = { road: 'highway', s, d };
  }
  update(): void {}
  place(): void {}
  applyTo(_rig: CarRig): void {}
}

export interface HolePlan {
  /** Highway s of its middle, which side it's on (+1 the outer edge, −1 the median), and its extent across. */
  s: number;
  side: 1 | -1;
  lo: number;
  hi: number;
  /** Where to bring the wreck down: the middle of it, on the deck. */
  aim: THREE.Vector3;
}

interface Falling {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  delay: number;
  /** Half its height: how far its middle sits off the ground at rest. */
  rest: number;
  state: 'wait' | 'fall' | 'down';
}

interface Hole extends HolePlan {
  index: number;
  def: DeckHole | null;
  group: THREE.Group;
  pieces: Falling[];
  t: number;
  driverGhost: Ghost;
  laneGhosts: Ghost[];
}

type V = THREE.Vector3;
const GRAV = 12;
const GROUND = 0;

/** Flat-shaded triangles with colours, built up a quad at a time. */
class Tris {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  quad(a: V, b: V, c: V, d: V, colour: THREE.Color, uvs?: [number, number][]): void {
    const u = uvs ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [p, t] of [[a, u[0]], [b, u[1]], [c, u[2]], [a, u[0]], [c, u[2]], [d, u[3]]] as [V, [number, number]][]) {
      this.pos.push(p.x, p.y, p.z);
      this.col.push(colour.r, colour.g, colour.b);
      this.uv.push(t[0], t[1]);
    }
  }
  /** An axis-aligned box in the local frame: its top one colour, the rest another; UVs at `tile` metres. */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, top: THREE.Color, side: THREE.Color, tile = 3): void {
    const P = (x: number, y: number, z: number): V => new THREE.Vector3(cx + x * hx, cy + y * hy, cz + z * hz);
    const uv = (a: number, b: number): [number, number][] => [[0, 0], [a / tile, 0], [a / tile, b / tile], [0, b / tile]];
    this.quad(P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), top, uv(2 * hx, 2 * hz));
    this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), side, uv(2 * hx, 2 * hz));
    this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), side, uv(2 * hx, 2 * hy));
    this.quad(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), side, uv(2 * hx, 2 * hy));
    this.quad(P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), side, uv(2 * hz, 2 * hy));
    this.quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), side, uv(2 * hz, 2 * hy));
  }
  get empty(): boolean {
    return this.pos.length === 0;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** As StreetBuilder colours the deck (its asphalt and concrete textures multiply these). */
const COL = {
  face: new THREE.Color(0xd2cfc8),
  under: new THREE.Color(0xc9c6bf),
  barrier: new THREE.Color(0xe2e0da),
  road: new THREE.Color(0xc4c6c8),
  line: new THREE.Color(0xf0eee6),
  yellow: new THREE.Color(0xe0b030),
  rebar: new THREE.Color(0x4a3a2c)
};

export class HighwayCollapse {
  private holes: Hole[] = [];
  private readonly root = new THREE.Group();
  private readonly conc: THREE.Material;
  private readonly asph: THREE.Material;
  private readonly rnd = (a: number): number => (Math.random() * 2 - 1) * a;

  constructor(
    private scene: THREE.Scene,
    private net: RoadNet,
    private particles: ParticleManager,
    /** The deck's concrete and asphalt, uncut: what the broken faces and the slabs are made of. */
    mats: { conc: THREE.Material; asphalt: THREE.Material }
  ) {
    this.root.name = 'highway-collapse';
    scene.add(this.root);
    // Double-sided for the broken faces, which are seen from wherever the hole lets you look
    this.conc = mats.conc.clone();
    this.conc.side = THREE.DoubleSide;
    this.asph = mats.asphalt.clone();
    // One hidden scrap of each, so the warm-up compiles them
    const warm = new Tris();
    warm.box(0, -50, 0, 0.1, 0.1, 0.1, COL.face, COL.face);
    for (const m of [this.conc, this.asph]) {
      const mesh = new THREE.Mesh(warm.geometry(), m);
      mesh.visible = false;
      this.root.add(mesh);
    }
    resetHoles();
  }

  /** The hazards in the road for the boss and the cop: one across each hole. */
  get driverHazards(): readonly ICar[] {
    return this.holes.map((h) => h.driverGhost);
  }

  /** For the traffic, once a hole has opened (before that there's nothing to see): a car stopped across it in each lane it takes. */
  get laneHazards(): readonly ICar[] {
    return this.holes.flatMap((h) => (h.def ? h.laneGhosts : []));
  }

  /** Any open holes? */
  get anyOpen(): boolean {
    return this.holes.some((h) => h.def !== null);
  }

  /**
   * A hole in the highway near `sWant`, on `side`: the deck between the
   * nearest pair of lamp standards, or the next ones on, as long as it's
   * clear of the gantries and the ends of the road — and isn't where
   * `avoidS` says someone will be. Null if there's no room for one.
   */
  plan(sWant: number, side: 1 | -1, avoidS: (s0: number, s1: number) => boolean = () => false): HolePlan | null {
    if (this.holes.length >= MAX_HOLES) return null;
    const D = STREET.deck;
    const k0 = Math.round((sWant - D.lampFirst) / D.lampEvery - 0.5);
    for (const k of [k0, k0 + 1, k0 + 2, k0 - 1]) {
      const s = D.lampFirst + D.lampEvery * (k + 0.5);
      if (s - HALF < 250 || s + HALF > STREET.highway.exitS - 250) continue;
      if (D.gantries.some((g) => Math.abs(g - s) < HALF + 10)) continue;
      if (this.holes.some((h) => Math.abs(h.s - s) < HALF * 2 + 20)) continue;
      if (avoidS(s - HALF - 6, s + HALF + 6)) continue;
      const lo = side > 0 ? -1.8 : D.median - 0.25;
      const hi = side > 0 ? D.outer + 0.4 : -2.0;
      // The wreck comes down on the lanes, not out on the shoulder or the median
      const aimD = side > 0 ? 1.6 : -6.4;
      const aim = this.net.point({ road: 'highway', s, d: aimD }, new THREE.Vector3());
      const index = this.holes.length;
      const ghostD = (lo + Math.min(hi, D.edge)) / 2;
      const laneGhosts: Ghost[] = [];
      for (const L of this.net.roads.highway.lanes) {
        if (L.dir !== 1) continue;
        // Any lane a car (1.8 m wide) can't keep to clear of the hole
        if (L.offset + 1.2 > lo && L.offset - 1.2 < hi) laneGhosts.push(new Ghost(s, L.offset, HALF + 1, 1.6));
      }
      const plan: Hole = {
        s,
        side,
        lo,
        hi,
        aim,
        index,
        def: null,
        group: new THREE.Group(),
        pieces: [],
        t: 0,
        driverGhost: new Ghost(s, ghostD, HALF + 2, (Math.min(hi, D.edge) - lo) / 2),
        laneGhosts
      };
      for (const g of [plan.driverGhost, ...laneGhosts]) this.net.point(g.at, g.position);
      this.holes.push(plan);
      return plan;
    }
    return null;
  }

  /** Down it goes, the wreck landing on it at `impact` (world). */
  open(plan: HolePlan, impact: THREE.Vector3): void {
    const h = this.holes.find((q) => q.s === plan.s && q.side === plan.side);
    if (!h || h.def) return;
    const f = this.net.sample('highway', h.s);
    const t = new THREE.Vector3(f.tangent.x, 0, f.tangent.z).normalize();
    const r = new THREE.Vector3(-t.z, 0, t.x);
    // How far the road bends through it: the centreline's sideways sweep at the far end
    const f1 = this.net.sample('highway', h.s + HALF);
    const rel = f1.pos.clone().sub(f.pos);
    const al1 = rel.dot(t);
    const bend = (2 * rel.dot(r)) / Math.max(1, al1 * al1);
    const def: DeckHole = { centre: f.pos.clone(), tangent: t, halfLen: HALF, latMin: h.lo, latMax: h.hi, bend, side: h.side };
    h.def = def;
    openHole(h.index, def);
    this.root.add(h.group);
    this.buildFaces(h);
    const impactAl = impact.clone().sub(f.pos).dot(t);
    this.buildSlabs(h, impactAl);
    // The crack and the dust of it going
    for (let al = -HALF; al <= HALF; al += 6) {
      const p = this.W(def, al, (h.lo + Math.min(h.hi, STREET.deck.edge)) / 2, 0.3);
      this.particles.dust(p, 4, 1.4);
      this.particles.concreteChips(p, new THREE.Vector3(0, 1, 0));
    }
  }

  /** Is the world point `p` over an open hole (where the road was)? */
  holeAt(p: THREE.Vector3): boolean {
    for (const h of this.holes) {
      const d = h.def;
      if (!d) continue;
      const rx = p.x - d.centre.x;
      const rz = p.z - d.centre.z;
      const al = rx * d.tangent.x + rz * d.tangent.z;
      const la = rx * -d.tangent.z + rz * d.tangent.x - 0.5 * d.bend * al * al;
      if (inHole(d, al, la)) return true;
    }
    return false;
  }

  /** A car that was on the slabs when they went: it goes down with them. */
  dropCar(kind: CarKind, colour: THREE.Color, position: THREE.Vector3, yaw: number, vel: THREE.Vector3): void {
    const open = this.holes.filter((q) => q.def);
    const h = open.reduce<Hole | null>((best, q) => (!best || q.def!.centre.distanceTo(position) < best.def!.centre.distanceTo(position) ? q : best), null);
    if (!h) return;
    const baked = bakedCar(kind, false);
    const mats = carMaterials();
    const obj = new THREE.Group();
    const parts: [THREE.BufferGeometry, THREE.Material][] = [
      [baked.paint, mats.paint],
      [baked.trim, mats.trim],
      [baked.glass, mats.glass],
      [baked.lamps, mats.lamps]
    ];
    const one = new THREE.Matrix4();
    parts.forEach(([g, m], i) => {
      const mesh = new THREE.InstancedMesh(g, m, 1);
      mesh.setMatrixAt(0, one);
      if (i === 0) mesh.setColorAt(0, colour);
      obj.add(mesh);
    });
    obj.position.copy(position);
    obj.rotation.set(0, yaw, 0);
    h.group.add(obj);
    h.pieces.push({
      obj,
      vel: vel.clone().multiplyScalar(0.6),
      spin: new THREE.Vector3(this.rnd(0.8), this.rnd(0.6), this.rnd(0.8)),
      delay: 0.25 + Math.random() * 0.2,
      rest: 0.7,
      state: 'wait'
    });
  }

  update(dt: number): void {
    for (const h of this.holes) {
      if (!h.def) continue;
      h.t += dt;
      for (const p of h.pieces) {
        if (p.state === 'down') continue;
        if (p.state === 'wait') {
          if (h.t < p.delay) continue;
          p.state = 'fall';
          this.particles.concreteChips(p.obj.position, new THREE.Vector3(0, 1, 0));
        }
        p.vel.y -= GRAV * dt;
        p.obj.position.addScaledVector(p.vel, dt);
        const w = p.spin.length();
        if (w > 1e-4) p.obj.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(p.spin.clone().divideScalar(w), w * dt));
        if (p.obj.position.y < GROUND + p.rest) {
          p.obj.position.y = GROUND + p.rest;
          const hit = -p.vel.y;
          p.vel.set(0, 0, 0);
          p.spin.set(0, 0, 0);
          p.state = 'down';
          this.particles.dust(p.obj.position, 3 + hit * 0.25, 1.6);
          this.particles.concreteChips(p.obj.position, new THREE.Vector3(0, 1, 0));
          this.onThud?.(p.obj.position, hit);
        }
      }
    }
  }

  /** Something big hitting the ground (for the sound). */
  onThud: ((pos: THREE.Vector3, speed: number) => void) | null = null;

  /** Every hole closed and every piece gone. */
  dispose(): void {
    resetHoles();
    for (const h of this.holes) {
      h.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.Mesh).geometry.dispose();
      });
    }
    this.holes = [];
    this.scene.remove(this.root);
  }

  // ------------------------------------------------------------ building

  /** A point in a hole's frame: `al` along the road from its middle, `la` across (with the bend), `y` off the surface. */
  private W(d: DeckHole, al: number, la: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    const t = d.tangent;
    const lb = la + 0.5 * d.bend * al * al;
    return out.set(d.centre.x + t.x * al - t.z * lb, d.centre.y + y, d.centre.z + t.z * al + t.x * lb);
  }

  /** The height of the deck's top at `la` across: its surface, or a barrier's top. */
  private topAt(h: Hole, la: number): number {
    const D = STREET.deck;
    if (h.side > 0 && la > D.edge) return D.barrier;
    if (h.side < 0 && la < D.nearL) return D.barrier;
    return 0.02;
  }

  /**
   * The broken faces of what's left: the ragged long edge across the lanes,
   * the clean cut through the median on that side, and the two ragged ends;
   * concrete from the underside up, a skin of road surface on top, rebar
   * sticking out into the gap.
   */
  private buildFaces(h: Hole): void {
    const d = h.def!;
    const D = STREET.deck;
    const B = D.underside;
    const conc = new Tris();
    const road = new Tris();
    const P = (al: number, la: number, y: number): V => this.W(d, al, la, y);
    const lo = (al: number): number => h.lo + (h.side > 0 ? jag(al) : 0);
    const hi = (al: number): number => h.hi + (h.side < 0 ? jag(al) : 0);
    const outerMost = h.side > 0 ? D.outer : D.far;
    const hiDeck = (al: number): number => Math.min(hi(al), D.outer);
    const loDeck = (al: number): number => Math.max(lo(al), outerMost);
    // Along the broken long edge (and, on the median side, the cut through it)
    const edges: ((al: number) => number)[] = [h.side > 0 ? lo : hi];
    if (h.side < 0) edges.push(lo);
    for (const edge of edges) {
      const step = 0.6;
      for (let al = -HALF - 0.6; al < HALF + 0.6; al += step) {
        const a1 = al + step;
        const l0 = edge(al);
        const l1 = edge(a1);
        const t0 = this.topAt(h, l0);
        const t1 = this.topAt(h, l1);
        conc.quad(P(al, l0, B), P(a1, l1, B), P(a1, l1, t1 - 0.06), P(al, l0, t0 - 0.06), COL.face, [[al / 3, 0], [a1 / 3, 0], [a1 / 3, 0.5], [al / 3, 0.5]]);
        road.quad(P(al, l0, t0 - 0.06), P(a1, l1, t1 - 0.06), P(a1, l1, t1), P(al, l0, t0), t0 > 0.1 ? COL.barrier : COL.road);
      }
      // Rebar, bent down a little, sticking out into the gap
      for (let al = -HALF + 0.5; al < HALF; al += 0.9 + Math.random() * 0.6) {
        const into = edge === lo ? 1 : -1;
        const la = edge(al);
        for (const y of [-0.35, -1.15]) {
          if (Math.random() < 0.35) continue;
          const len = 0.25 + Math.random() * 0.5;
          const a = P(al, la, y);
          const b = P(al + this.rnd(0.15), la + into * len, y - Math.random() * 0.2);
          this.rod(conc, a, b, 0.025);
        }
      }
    }
    // The two ends, across the gap
    for (const sgn of [-1, 1]) {
      const step = 0.3;
      const from = h.side > 0 ? lo(sgn * HALF) : loDeck(sgn * HALF);
      const to = h.side > 0 ? hiDeck(sgn * HALF) : hi(sgn * HALF);
      for (let la = from; la < to - 1e-3; la += step) {
        const l1 = Math.min(to, la + step);
        const a0 = sgn * (HALF + jagEnd(la));
        const a1 = sgn * (HALF + jagEnd(l1));
        const t0 = this.topAt(h, la);
        const t1 = this.topAt(h, l1);
        conc.quad(P(a0, la, B), P(a1, l1, B), P(a1, l1, t1 - 0.06), P(a0, la, t0 - 0.06), COL.face, [[la / 3, 0], [l1 / 3, 0], [l1 / 3, 0.5], [la / 3, 0.5]]);
        road.quad(P(a0, la, t0 - 0.06), P(a1, l1, t1 - 0.06), P(a1, l1, t1), P(a0, la, t0), t0 > 0.1 ? COL.barrier : COL.road);
        if (Math.random() < 0.4) {
          const y = -0.35 - Math.random() * 0.8;
          this.rod(conc, P(a0, la, y), P(a0 - sgn * (0.25 + Math.random() * 0.45), la + this.rnd(0.1), y - Math.random() * 0.2), 0.025);
        }
      }
    }
    for (const [tris, mat] of [[conc, this.conc], [road, this.asph]] as [Tris, THREE.Material][]) {
      if (tris.empty) continue;
      const mesh = new THREE.Mesh(tris.geometry(), mat);
      mesh.frustumCulled = false;
      h.group.add(mesh);
    }
  }

  /** A thin square bar from a to b. */
  private rod(tris: Tris, a: V, b: V, r: number): void {
    const ax = b.clone().sub(a).normalize();
    const u = Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const s1 = u.clone().cross(ax).normalize().multiplyScalar(r);
    const s2 = ax.clone().cross(s1).normalize().multiplyScalar(r);
    const c = [s1.clone().add(s2), s1.clone().sub(s2), s1.clone().negate().sub(s2), s1.clone().negate().add(s2)];
    for (let i = 0; i < 4; i++) {
      const p = c[i];
      const q = c[(i + 1) % 4];
      tris.quad(a.clone().add(p), a.clone().add(q), b.clone().add(q), b.clone().add(p), COL.rebar);
    }
  }

  /**
   * The slabs that fall: four along, two across (the outer ones with the
   * barrier on them), each a box of deck in its own frame — tipping off
   * its broken edge toward the open side, the ones nearest the wreck first.
   */
  private buildSlabs(h: Hole, impactAl: number): void {
    const d = h.def!;
    const D = STREET.deck;
    const B = D.underside;
    const across0 = h.side > 0 ? h.lo : Math.max(h.lo, D.far);
    const across1 = h.side > 0 ? Math.min(h.hi, D.outer) : h.hi;
    const mid = (across0 + across1) / 2;
    const spans: [number, number][] = [
      [across0, mid],
      [mid, across1]
    ];
    const t = d.tangent;
    const r = new THREE.Vector3(-t.z, 0, t.x);
    const up = new THREE.Vector3(0, 1, 0);
    const basis = new THREE.Matrix4().makeBasis(r, up, t.clone().negate());
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    // Lane lines on the slabs' tops, where they were painted
    const lines: [number, THREE.Color][] = [
      [1.8, COL.line],
      [-1.8, COL.line],
      [-5.4, COL.line],
      [-9.0, COL.yellow]
    ];
    const n = 4;
    const len = (2 * HALF) / n;
    for (let i = 0; i < n; i++) {
      const al = -HALF + len * (i + 0.5);
      spans.forEach(([a, b], j) => {
        const w = b - a;
        const la = (a + b) / 2;
        const outer = h.side > 0 ? j === 1 : j === 0;
        // In the slab's own frame, its middle at the origin: the deck's depth below the road, the barrier on top
        const body = new Tris();
        const top = new Tris();
        const hy = -B / 2;
        body.box(0, 0, 0, w / 2 - 0.04, hy, len / 2 - 0.05, COL.face, COL.under);
        top.box(0, hy + 0.01, 0, w / 2 - 0.04, 0.01, len / 2 - 0.05, COL.road, COL.road, 5);
        if (outer) {
          const bx = h.side > 0 ? w / 2 - 0.34 : -w / 2 + 0.34;
          body.box(bx, hy + D.barrier / 2, 0, 0.3, D.barrier / 2, len / 2 - 0.05, COL.barrier, COL.barrier);
        }
        for (const [l, c] of lines) {
          if (l > a + 0.2 && l < b - 0.2) top.box(l - la, hy + 0.025, 0, 0.08, 0.01, len / 2 - 0.4, c, c);
        }
        const obj = new THREE.Group();
        obj.add(new THREE.Mesh(body.geometry(), this.conc), new THREE.Mesh(top.geometry(), this.asph));
        this.W(d, al, la, -hy, obj.position);
        obj.quaternion.copy(q);
        h.group.add(obj);
        const away = h.side;
        // Off the outer edge they tip out over the grass; on the median side there's the other carriageway's deck
        // beside them, so they go down more nearly flat, into the gap where they can be seen
        const rate = ((outer ? 1.1 : 0.8) + Math.random() * 0.5) * (h.side > 0 ? 1 : 0.55);
        const spin = t.clone().multiplyScalar(away * rate).add(new THREE.Vector3(this.rnd(0.25), this.rnd(0.3), this.rnd(0.25)));
        // Tipping off its inner edge: its middle starts down as the edge holds a moment
        const vel = up.clone().multiplyScalar(-rate * w * 0.35).addScaledVector(r, away * (h.side > 0 ? 0.6 : 0.1));
        const delay = 0.08 + (0.45 * Math.abs(al - impactAl)) / HALF + (outer ? 0 : 0.28) + Math.random() * 0.08;
        h.pieces.push({ obj, vel, spin, delay, rest: 1.0, state: 'wait' });
      });
    }
  }
}
