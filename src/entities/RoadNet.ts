import * as THREE from 'three';
import type { IRoadNet, Road, RoadId, RoadPos } from '../scenes/StreetContracts';

/**
 * The route as one thing (see IRoadNet in StreetContracts): sampling a road
 * at any s, finding which road a world point is on, route distance through
 * the joins and the fork, and walking a place along the route.
 *
 * Everything hot (the cars call it every substep) works in a small window of
 * samples around a hint, never the whole road, and allocates nothing: the
 * `*Into` methods write into caller-owned objects. `sample()` (the contract's)
 * returns a fresh object each call and is for the scene's occasional use.
 */

/** A centreline frame at some s: what sample() returns, reusable. */
export interface RoadFrame {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  halfLeft: number;
  halfRight: number;
}

export function makeFrame(): RoadFrame {
  return { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), right: new THREE.Vector3(), halfLeft: 0, halfRight: 0 };
}

const IDS: readonly RoadId[] = ['city', 'onramp', 'highway', 'exit', 'airport'];

/** How many samples either side of the hint a locate searches before it slides its window. */
const WINDOW = 12;
/** Slack beyond the drivable width within which a point still counts as on its hint road. */
const STICK = 0.6;

interface Info {
  road: Road;
  n: number;
  /** Sample spacing if even (it should be), else 0 and lookups bisect. */
  ds: number;
  base: number;
  prev: RoadId | null;
  /** Roads leaving this one part way along (the exit off the highway). */
  branches: RoadId[];
}

interface Cand {
  road: RoadId;
  s: number;
}

const _f = makeFrame();
const _g = makeFrame();
const _v = new THREE.Vector3();

export class RoadNet implements IRoadNet {
  readonly roads: Record<RoadId, Road>;
  private info: Record<RoadId, Info>;
  private cands: Cand[] = Array.from({ length: 6 }, () => ({ road: 'city' as RoadId, s: 0 }));
  private nc = 0;

  constructor(roads: Record<RoadId, Road>) {
    this.roads = roads;
    const info = {} as Record<RoadId, Info>;
    for (const id of IDS) {
      const r = roads[id];
      if (!r) throw new Error(`RoadNet: no road '${id}'`);
      const n = r.samples.length;
      if (n < 2) throw new Error(`RoadNet: road '${id}' needs at least two samples`);
      let ds = r.length / (n - 1);
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 16))) {
        if (Math.abs(r.samples[i].s - i * ds) > 0.05 * ds + 1e-3) {
          ds = 0;
          break;
        }
      }
      info[id] = { road: r, n, ds, base: 0, prev: null, branches: [] };
    }
    for (const id of IDS) {
      const r = roads[id];
      if (r.next) info[r.next].prev = id;
      if (r.from) info[r.from.road].branches.push(id);
    }
    // Route distance: from the road nobody leads into, on through next, and a branch from its fork
    const done = new Set<RoadId>();
    const root = IDS.find((id) => !info[id].prev && !roads[id].from) ?? 'city';
    const walk = (id: RoadId, base: number): void => {
      if (done.has(id)) return;
      done.add(id);
      info[id].base = base;
      const r = roads[id];
      for (const b of info[id].branches) walk(b, base + (roads[b].from?.s ?? 0));
      if (r.next) walk(r.next, base + r.length);
    };
    walk(root, 0);
    for (const id of IDS) if (!done.has(id)) walk(id, 0);
    this.info = info;
  }

  // ------------------------------------------------------------ sampling

  /** The route distance where a road's s = 0 lies. */
  routeBase(road: RoadId): number {
    return this.info[road].base;
  }

  /** The road whose `next` is this one, if any. */
  prevOf(road: RoadId): RoadId | null {
    return this.info[road].prev;
  }

  /** Roads branching off this one (the exit, for the highway). */
  branchesOf(road: RoadId): readonly RoadId[] {
    return this.info[road].branches;
  }

  /** Segment index and fraction for s (clamped). */
  private seg(inf: Info, s: number): { i: number; t: number } {
    const r = inf.road;
    const n = inf.n;
    if (s <= 0) return segOut(0, 0);
    if (s >= r.length) return segOut(n - 2, 1);
    if (inf.ds > 0) {
      const x = s / inf.ds;
      const i = Math.min(n - 2, Math.floor(x));
      return segOut(i, Math.min(1, x - i));
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (r.samples[m].s <= s) lo = m;
      else hi = m;
    }
    const a = r.samples[lo].s;
    const b = r.samples[hi].s;
    return segOut(lo, b > a ? (s - a) / (b - a) : 0);
  }

  /** The centreline frame at s on a road, written into `out` (s clamped). Allocation-free. */
  sampleInto(road: RoadId, s: number, out: RoadFrame): RoadFrame {
    const inf = this.info[road];
    const { i, t } = this.seg(inf, s);
    const a = inf.road.samples[i];
    const b = inf.road.samples[i + 1];
    out.pos.lerpVectors(a.pos, b.pos, t);
    out.tangent.lerpVectors(a.tangent, b.tangent, t).normalize();
    const h = Math.hypot(out.tangent.x, out.tangent.z) || 1;
    out.right.set(-out.tangent.z / h, 0, out.tangent.x / h);
    out.halfLeft = a.halfLeft + (b.halfLeft - a.halfLeft) * t;
    out.halfRight = a.halfRight + (b.halfRight - a.halfRight) * t;
    return out;
  }

  sample(road: RoadId, s: number): { pos: THREE.Vector3; tangent: THREE.Vector3; right: THREE.Vector3; halfLeft: number; halfRight: number } {
    return this.sampleInto(road, s, makeFrame());
  }

  point(at: RoadPos, out: THREE.Vector3): THREE.Vector3 {
    this.sampleInto(at.road, at.s, _f);
    return out.copy(_f.pos).addScaledVector(_f.right, at.d);
  }

  /** The deck height at a place. */
  heightAt(road: RoadId, s: number): number {
    return this.sampleInto(road, s, _f).pos.y;
  }

  // ------------------------------------------------------------ locating

  /**
   * Nearest point on one road's centreline to p (horizontal), searching
   * segments around sGuess and sliding the window if the best lies at its
   * edge. Writes s (unclamped beyond the ends: negative before the start,
   * past length after the end) and d into `out`; returns the horizontal
   * distance squared to the centreline (0-length overshoot included).
   */
  private project(road: RoadId, p: THREE.Vector3, sGuess: number, out: { s: number; d: number }): number {
    const inf = this.info[road];
    const sm = inf.road.samples;
    const n = inf.n;
    let centre = this.seg(inf, sGuess).i;
    let best = -1;
    let bestT = 0;
    let bestD2 = Infinity;
    for (let pass = 0; pass < 40; pass++) {
      const i0 = Math.max(0, centre - WINDOW);
      const i1 = Math.min(n - 2, centre + WINDOW);
      best = -1;
      bestD2 = Infinity;
      for (let i = i0; i <= i1; i++) {
        const a = sm[i].pos;
        const b = sm[i + 1].pos;
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const L2 = ex * ex + ez * ez || 1e-9;
        let t = ((p.x - a.x) * ex + (p.z - a.z) * ez) / L2;
        if (t < 0) t = i === 0 ? t : 0;
        else if (t > 1) t = i === n - 2 ? t : 1;
        const tc = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = a.x + ex * tc - p.x;
        const qz = a.z + ez * tc - p.z;
        const d2 = qx * qx + qz * qz;
        if (d2 < bestD2 - 1e-9) {
          bestD2 = d2;
          best = i;
          bestT = t;
        }
      }
      const atEdge = (best === i0 && i0 > 0) || (best === i1 && i1 < n - 2);
      if (!atEdge) break;
      centre = best;
    }
    const a = sm[best];
    const b = sm[best + 1];
    const segLen = b.s - a.s;
    const s = a.s + bestT * segLen;
    this.sampleInto(road, s, _g);
    // Beyond an end the centreline is extended straight along the end tangent
    _v.subVectors(p, _g.pos);
    if (s < 0 || s > inf.road.length) {
      const hx = _g.tangent.x;
      const hz = _g.tangent.z;
      const hl = Math.hypot(hx, hz) || 1;
      const along = (_v.x * hx + _v.z * hz) / hl;
      out.s = (s < 0 ? 0 : inf.road.length) + along;
    } else out.s = s;
    out.d = _v.x * _g.right.x + _v.z * _g.right.z;
    return bestD2;
  }

  /** The candidate roads around a place: itself and its neighbours at the joins and the fork, with a starting s on each. */
  private gather(at: RoadPos): number {
    const inf = this.info[at.road];
    const r = inf.road;
    this.nc = 0;
    this.put(at.road, at.s);
    if (r.next && at.s > r.length - 40) this.put(r.next, at.s - r.length);
    if (inf.prev && at.s < 40) this.put(inf.prev, this.roads[inf.prev].length + at.s);
    for (let i = 0; i < inf.branches.length; i++) {
      const b = inf.branches[i];
      const from = this.roads[b].from!.s;
      if (at.s > from - 30 && at.s < from + this.roads[b].length) this.put(b, at.s - from);
    }
    if (r.from && at.s < 400) {
      const host = this.roads[r.from.road];
      if (r.from.s + at.s < host.length + 40) this.put(r.from.road, r.from.s + at.s);
    }
    return this.nc;
  }

  private put(road: RoadId, s: number): void {
    if (this.nc >= this.cands.length) return;
    const c = this.cands[this.nc++];
    c.road = road;
    c.s = s;
  }

  /** How far a projected (s, d) lies outside a road's drivable area (0 = on it). */
  private excess(road: RoadId, s: number, d: number): number {
    const r = this.roads[road];
    this.sampleInto(road, s, _f);
    let e = Math.max(0, d - _f.halfRight, -_f.halfLeft - d);
    if (s < 0) e += -s;
    else if (s > r.length) e += s - r.length;
    return e;
  }

  /**
   * Is a neighbouring road at the same level as `y` there? The exit runs on
   * down to the ground beside and under the deck it left, and the street
   * runs under the highway: a road a storey above or below is never the
   * one a car is on, nor a wall it hits.
   */
  private level(road: RoadId, s: number, y: number): boolean {
    const L = this.roads[road].length;
    return Math.abs(this.heightAt(road, s < 0 ? 0 : s > L ? L : s) - y) < 2.5;
  }

  locate(p: THREE.Vector3, hint: RoadPos, out: RoadPos): RoadPos {
    const n = this.gather(hint);
    let bestRoad: RoadId = hint.road;
    let bestS = hint.s;
    let bestD = hint.d;
    let bestE = Infinity;
    let bestAbs = Infinity;
    const pr = _proj;
    for (let k = 0; k < n; k++) {
      const c = this.cands[k];
      this.project(c.road, p, c.s, pr);
      if (k > 0 && !this.level(c.road, pr.s, p.y)) continue;
      const e = this.excess(c.road, pr.s, pr.d);
      if (k === 0 && e <= STICK) {
        bestRoad = c.road;
        bestS = pr.s;
        bestD = pr.d;
        bestE = -1;
        break;
      }
      const ab = Math.abs(pr.d);
      if (e < bestE - 1e-6 || (Math.abs(e - bestE) <= 1e-6 && ab < bestAbs)) {
        bestE = e;
        bestAbs = ab;
        bestRoad = c.road;
        bestS = pr.s;
        bestD = pr.d;
      }
    }
    const L = this.roads[bestRoad].length;
    out.road = bestRoad;
    out.s = bestS < 0 ? 0 : bestS > L ? L : bestS;
    out.d = bestD;
    return out;
  }

  /**
   * Locate with no hint (teleports, setup): the nearest centreline over
   * every road, by 3D distance so the elevated deck and the street under it
   * don't get mixed up.
   */
  locateGlobal(p: THREE.Vector3, out: RoadPos): RoadPos {
    let best = Infinity;
    for (const id of IDS) {
      const sm = this.roads[id].samples;
      for (let i = 0; i < sm.length; i += 2) {
        const q = sm[i].pos;
        const dy = (q.y - p.y) * 3;
        const d2 = (q.x - p.x) ** 2 + (q.z - p.z) ** 2 + dy * dy;
        if (d2 < best) {
          best = d2;
          out.road = id;
          out.s = sm[i].s;
        }
      }
    }
    this.project(out.road, p, out.s, _proj);
    const L = this.roads[out.road].length;
    out.s = Math.max(0, Math.min(L, _proj.s));
    out.d = _proj.d;
    return out;
  }

  /**
   * The walls. How far a ground point lies outside the drivable surface
   * around a place — the union of the place's road and its neighbours, so
   * at the fork a car can drift from the highway onto the exit and at a
   * join from one road onto the next — and the outward wall normal there
   * (horizontal, unit) in `nOut`. 0 when the point is on the road. A road
   * end with nothing after it (the closure, the end of the airport road,
   * the start of the avenue) is a wall too.
   */
  edgePen(p: THREE.Vector3, at: RoadPos, nOut: THREE.Vector3): number {
    const n = this.gather(at);
    let best = Infinity;
    for (let k = 0; k < n; k++) {
      const c = this.cands[k];
      const r = this.roads[c.road];
      const inf = this.info[c.road];
      // Two Newton steps along the road from the guess: plenty for a corner a few metres off
      let s = c.s;
      for (let it = 0; it < 2; it++) {
        this.sampleInto(c.road, s, _f);
        const hl = Math.hypot(_f.tangent.x, _f.tangent.z) || 1;
        s += ((p.x - _f.pos.x) * _f.tangent.x + (p.z - _f.pos.z) * _f.tangent.z) / hl;
        if (s < -20 || s > r.length + 20) break;
      }
      const sc = s < 0 ? 0 : s > r.length ? r.length : s;
      if (k > 0 && !this.level(c.road, sc, p.y)) continue;
      this.sampleInto(c.road, sc, _f);
      const hl = Math.hypot(_f.tangent.x, _f.tangent.z) || 1;
      const tx = _f.tangent.x / hl;
      const tz = _f.tangent.z / hl;
      const dx = p.x - _f.pos.x;
      const dz = p.z - _f.pos.z;
      const d = dx * _f.right.x + dz * _f.right.z;
      const along = dx * tx + dz * tz; // beyond an end: how far
      let e = 0;
      let nx = 0;
      let nz = 0;
      if (d > _f.halfRight) {
        e = d - _f.halfRight;
        nx = _f.right.x;
        nz = _f.right.z;
      } else if (d < -_f.halfLeft) {
        e = -_f.halfLeft - d;
        nx = -_f.right.x;
        nz = -_f.right.z;
      }
      if (s < 0 || s > r.length) {
        const cont = s < 0 ? inf.prev !== null || r.from !== undefined : r.next !== null;
        if (cont) continue; // the neighbour on the other side owns that ground
        const over = Math.abs(along);
        if (over > e) {
          e = over;
          nx = s < 0 ? -tx : tx;
          nz = s < 0 ? -tz : tz;
        }
      }
      if (e <= 0) return 0;
      if (e < best) {
        best = e;
        nOut.set(nx, 0, nz);
      }
    }
    return best === Infinity ? 0 : best;
  }

  // ------------------------------------------------------------ the route

  routeS(at: RoadPos): number {
    const L = this.roads[at.road].length;
    return this.info[at.road].base + (at.s < 0 ? 0 : at.s > L ? L : at.s);
  }

  advance(at: RoadPos, ds: number, takeExit: boolean, out: RoadPos): RoadPos {
    let road = at.road;
    let s = at.s;
    const d = at.d;
    let left = ds;
    for (let guard = 0; guard < 12; guard++) {
      const r = this.roads[road];
      const inf = this.info[road];
      if (left >= 0) {
        // The fork ahead on this road?
        let forked = false;
        if (takeExit) {
          for (const b of inf.branches) {
            const fs = this.roads[b].from!.s;
            if (s <= fs && s + left > fs) {
              left -= fs - s;
              road = b;
              s = 0;
              forked = true;
              break;
            }
          }
        }
        if (forked) continue;
        if (s + left <= r.length) {
          s += left;
          break;
        }
        if (r.next) {
          left -= r.length - s;
          road = r.next;
          s = 0;
          continue;
        }
        s = r.length;
        break;
      } else {
        if (s + left >= 0) {
          s += left;
          break;
        }
        if (r.from) {
          left += s;
          road = r.from.road;
          s = r.from.s;
          continue;
        }
        if (inf.prev) {
          left += s;
          road = inf.prev;
          s = this.roads[road].length;
          continue;
        }
        s = 0;
        break;
      }
    }
    out.road = road;
    out.s = s;
    out.d = d;
    return out;
  }
}

const _seg = { i: 0, t: 0 };
function segOut(i: number, t: number): { i: number; t: number } {
  _seg.i = i;
  _seg.t = t;
  return _seg;
}
const _proj = { s: 0, d: 0 };
