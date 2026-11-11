import * as THREE from 'three';
import type { Enemy } from './Enemy';
import type { Collider, Waypoint } from '../environment/OfficeLevelBuilder';
import type { Post } from '../environment/HQBuilder';

/**
 * CrewAI — Ravi's coworkers in a firefight: each has a post to fight from,
 * runs to it when told (by the waypoint graph, then straight in), gets down
 * behind it, and fights from there — up over the cover, a burst at whoever
 * they can see, back down, a breath, up again. With nobody to shoot they
 * put rounds on the nearest turret. They don't die: a round near them is a
 * flinch.
 *
 * The scene says what's out there (`targets`), whether a line is clear, and
 * what a shot does (`shoot`).
 */

export interface CrewTarget {
  /** Where to aim (a chest, a turret). */
  pos: THREE.Vector3;
  /** A man (worth shooting first), or a tower's gun (keeping its head down). */
  kind: 'man' | 'turret';
  ref: unknown;
}

export interface CrewDeps {
  waypoints: Waypoint[];
  colliders: Collider[];
  /** Is the line from a to b clear of anything solid? */
  clear: (a: THREE.Vector3, b: THREE.Vector3) => boolean;
  /** What there is to shoot at, now. */
  targets: () => CrewTarget[];
  /** One round from `e`'s muzzle toward `at`. */
  shoot: (e: Enemy, from: THREE.Vector3, at: THREE.Vector3, t: CrewTarget) => void;
  /** Everyone in the crew, to keep their distance from each other. */
  all: () => Enemy[];
  /** Somebody else to keep out of the way of (Ravi). */
  avoid?: () => THREE.Vector3 | null;
}

type State = 'idle' | 'run' | 'cover';

const RUN = 4.8;
const JOG = 3.2;
const BODY = 0.38;
const RANGE_MAN = 58;
const RANGE_TURRET = 75;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class CrewAI {
  state: State = 'idle';
  post: Post | null = null;
  /** Holding fire (a cutscene): they still crouch and look about. */
  hold = false;
  private path: THREE.Vector3[] = [];
  private wait = 0;
  private up = false;
  private upT = 0;
  private downT = 0;
  private burst = 0;
  private burstT = 0;
  private target: CrewTarget | null = null;
  private seekT = 0;
  private crouch = 0;
  private flinchT = 0;
  private stuckT = 0;
  private last = new THREE.Vector3();

  constructor(readonly e: Enemy, private deps: CrewDeps) {
    this.last.copy(e.position);
    this.downT = 0.5 + Math.random() * 1.5;
  }

  /** Off to `post`, after `delay` seconds; `jog` for a walk-up rather than a sprint. */
  goTo(post: Post, delay = 0): void {
    this.post = post;
    this.spot.copy(post.pos);
    this.settleT = 0;
    this.wait = delay;
    this.path = this.plan(this.e.position, post.pos);
    this.state = 'run';
    this.up = false;
  }

  /** Straight there (a restart): already at it, down behind it. */
  placeAt(post: Post): void {
    this.post = post;
    this.spot.copy(post.pos);
    this.e.position.copy(post.pos);
    this.state = 'cover';
    this.path = [];
    this.e.yaw = Math.atan2(-(post.face.x - post.pos.x), -(post.face.z - post.pos.z));
    this.e.root.rotation.y = this.e.yaw;
  }

  /** A round's come close: he ducks. */
  flinch(): void {
    if (this.flinchT > 0) return;
    this.flinchT = 0.6;
    this.e.flinch(0.6);
    if (this.up && Math.random() < 0.5) {
      this.up = false;
      this.downT = 0.4 + Math.random() * 0.6;
    }
  }

  update(dt: number): void {
    const e = this.e;
    // Killed (a blast): the ragdoll has him now
    if (!e.alive) return;
    this.flinchT = Math.max(0, this.flinchT - dt);
    if (this.state === 'run') this.updateRun(dt);
    else if (this.state === 'cover') this.updateCover(dt);
    else {
      e.setWalk(0);
      e.setRun(false);
    }
    // Down behind it, or up over it; standing anywhere else
    const want = this.state === 'cover' && this.post?.low && !this.up ? 0.85 : 0;
    this.crouch += (want - this.crouch) * Math.min(1, dt * 7);
    e.pose = this.crouch > 0.02 ? { crouch: this.crouch } : null;
    this.separate(dt);
    this.resolve();
    // The lot is flat: on it
    e.position.y = 0;
  }

  // ------------------------------------------------------------------ running

  private updateRun(dt: number): void {
    const e = this.e;
    if (this.wait > 0) {
      this.wait -= dt;
      e.setWalk(0);
      e.setRun(false);
      e.slingWeapon(false);
      this.lookAndShoot(dt, false);
      return;
    }
    const next = this.path[0];
    if (!next) {
      this.state = 'cover';
      this.up = false;
      this.downT = 0.3 + Math.random() * 0.8;
      e.setRun(false);
      e.setWalk(0);
      return;
    }
    const to = _a.set(next.x - e.position.x, 0, next.z - e.position.z);
    const d = to.length();
    const last = this.path.length === 1;
    if (d < (last ? 0.25 : 1.1)) {
      this.path.shift();
      return;
    }
    const sp = last && d < 3 ? JOG : RUN;
    to.divideScalar(d);
    this.steer(to, Math.min(d, 1.6));
    e.position.addScaledVector(to, Math.min(d, sp * dt));
    e.faceToward(_b.copy(e.position).add(to), dt, 9);
    // Running flat out the rifle goes over his back and both arms pump; it comes
    // back into his hands for the last few steps in to the post
    e.slingWeapon(sp > JOG);
    e.setAiming(false);
    e.setRun(sp > JOG);
    e.setWalk(1);
    // Stuck on something: find a way round from here
    this.stuckT += dt;
    if (this.stuckT > 0.8) {
      if (e.position.distanceTo(this.last) < 0.5 && this.post) {
        const off = Math.hypot(this.post.pos.x - e.position.x, this.post.pos.z - e.position.z);
        if (off < 1.6) {
          this.path = [];
          this.spot.copy(e.position);
        } else this.path = this.plan(e.position, this.post.pos, true);
      }
      this.last.copy(e.position);
      this.stuckT = 0;
    }
  }

  /** Where he actually settles at his post: the post, unless something solid holds him off it. */
  private spot = new THREE.Vector3();
  private settleT = 0;

  // -------------------------------------------------------------------- cover

  private updateCover(dt: number): void {
    const e = this.e;
    e.setRun(false);
    e.slingWeapon(false);
    // Down behind it he holds it properly: two hands, muzzle low
    e.setRestCarry(true);
    // Settle onto the post itself — or, held off it a second, where he is (no shuffling on the spot)
    if (this.post) {
      const p = this.spot;
      const dx = p.x - e.position.x;
      const dz = p.z - e.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.08) {
        this.settleT += dt;
        if (this.settleT > 1) {
          p.copy(e.position);
          e.setWalk(0);
        } else {
          e.position.x += (dx / d) * Math.min(d, 1.5 * dt);
          e.position.z += (dz / d) * Math.min(d, 1.5 * dt);
          e.setWalk(0.3);
        }
      } else {
        this.settleT = 0;
        e.setWalk(0);
      }
    }
    this.lookAndShoot(dt, true);
  }

  /** Who to shoot, and the up-fire-down cycle. */
  private lookAndShoot(dt: number, inCover: boolean): void {
    const e = this.e;
    this.seekT -= dt;
    if (this.seekT <= 0) {
      this.seekT = 0.6 + Math.random() * 0.5;
      this.target = this.pick();
    }
    const t = this.target;
    const face = t ? t.pos : this.post?.face;
    if (face) e.faceToward(face, dt, 6);
    if (t) {
      const eye = e.eyePosition(_a);
      const dist = Math.hypot(t.pos.x - eye.x, t.pos.z - eye.z);
      e.setAimPitch(Math.atan2(t.pos.y - (eye.y - 0.2), dist));
    } else e.setAimPitch(0);
    if (!inCover) {
      e.setAiming(!!t);
      return;
    }
    if (this.up) {
      this.upT -= dt;
      e.setAiming(true);
      if (t && !this.hold) {
        this.burstT -= dt;
        if (this.burst > 0 && this.burstT <= 0) {
          this.burst--;
          this.burstT = 0.1 + Math.random() * 0.05;
          const from = e.muzzleWorld(_b);
          e.flashMuzzle();
          this.deps.shoot(e, from.clone(), t.pos.clone(), t);
        }
      }
      if (this.upT <= 0) {
        this.up = false;
        this.downT = (this.post?.low ? 0.9 : 0.5) + Math.random() * 1.6;
      }
    } else {
      this.downT -= dt;
      e.setAiming(!this.post?.low);
      if (this.downT <= 0) {
        this.up = true;
        this.upT = 1.1 + Math.random() * 1.2;
        this.burst = t ? 3 + Math.floor(Math.random() * 4) : 0;
        this.burstT = 0.35 + Math.random() * 0.2;
      }
    }
  }

  /** The nearest man he can see; failing that, the nearest turret in reach. */
  private pick(): CrewTarget | null {
    const e = this.e;
    const eye = _c.copy(e.position);
    eye.y += 1.72;
    let best: CrewTarget | null = null;
    let bestD = Infinity;
    for (const t of this.deps.targets()) {
      const d = Math.hypot(t.pos.x - eye.x, t.pos.z - eye.z);
      const range = t.kind === 'man' ? RANGE_MAN : RANGE_TURRET;
      if (d > range) continue;
      const score = d + (t.kind === 'turret' ? 40 : 0);
      if (score >= bestD) continue;
      if (t.kind === 'man' && !this.deps.clear(eye, _a.copy(t.pos).setY(t.pos.y + 0.25))) continue;
      best = t;
      bestD = score;
    }
    return best;
  }

  // -------------------------------------------------------------------- moving

  /** By the waypoints from the one nearest `from` to the one nearest `to`; then `to` itself. */
  private plan(from: THREE.Vector3, to: THREE.Vector3, viaGrid = false): THREE.Vector3[] {
    const wps = this.deps.waypoints;
    if (!wps.length || (!viaGrid && this.deps.clear(_a.copy(from).setY(1), _b.copy(to).setY(1)))) return [to.clone()];
    // The nearest waypoint with a clear line to the point (so the first and last legs, off the grid, don't go
    // through a column); failing any, the nearest at all
    const nearest = (p: THREE.Vector3): number => {
      const order: number[] = [];
      for (let i = 0; i < wps.length; i++) if (wps[i].links.length) order.push(i);
      order.sort((i, j) => wps[i].pos.distanceToSquared(p) - wps[j].pos.distanceToSquared(p));
      for (const i of order.slice(0, 8)) if (this.deps.clear(_a.copy(wps[i].pos).setY(1), _b.copy(p).setY(1))) return i;
      return order[0] ?? 0;
    };
    const a = nearest(from);
    const b = nearest(to);
    // A* over the grid
    const g = new Map<number, number>([[a, 0]]);
    const came = new Map<number, number>();
    const open = new Set<number>([a]);
    const h = (i: number): number => wps[i].pos.distanceTo(wps[b].pos);
    while (open.size) {
      let cur = -1;
      let cf = Infinity;
      for (const i of open) {
        const f = (g.get(i) ?? Infinity) + h(i);
        if (f < cf) {
          cf = f;
          cur = i;
        }
      }
      if (cur === b) break;
      open.delete(cur);
      for (const n of wps[cur].links) {
        const ng = (g.get(cur) ?? Infinity) + wps[cur].pos.distanceTo(wps[n].pos);
        if (ng < (g.get(n) ?? Infinity)) {
          g.set(n, ng);
          came.set(n, cur);
          open.add(n);
        }
      }
    }
    const route: THREE.Vector3[] = [to.clone()];
    if (came.has(b) || a === b) {
      for (let i: number | undefined = b; i !== undefined && i !== a; i = came.get(i)) route.unshift(wps[i].pos.clone());
      route.unshift(wps[a].pos.clone());
    }
    // Skip waypoints he can already see past
    while (route.length > 1 && this.deps.clear(_a.copy(from).setY(1), _b.copy(route[1]).setY(1))) route.shift();
    return route;
  }

  private side = 0;
  private sideT = 0;

  /** Turn `dir` (flat, unit) off anything solid within `look` metres, toward whichever side is clear; keep to that side a moment. */
  private steer(dir: THREE.Vector3, look: number): void {
    const p = this.e.position;
    const from = _b.set(p.x, 1.0, p.z);
    const ahead = _c.set(p.x + dir.x * (look + BODY), 1.0, p.z + dir.z * (look + BODY));
    if (this.deps.clear(from, ahead)) {
      this.sideT = Math.max(0, this.sideT - 0.016);
      if (this.sideT <= 0) this.side = 0;
      return;
    }
    const turned = (a: number): THREE.Vector3 => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      return new THREE.Vector3(dir.x * c - dir.z * s, 0, dir.x * s + dir.z * c);
    };
    if (!this.side) {
      for (const a of [0.9, 1.4]) {
        if (this.deps.clear(from, ahead.copy(from).addScaledVector(turned(a), look + BODY).setY(1))) {
          this.side = 1;
          break;
        }
        if (this.deps.clear(from, ahead.copy(from).addScaledVector(turned(-a), look + BODY).setY(1))) {
          this.side = -1;
          break;
        }
      }
      if (!this.side) this.side = Math.random() < 0.5 ? 1 : -1;
    }
    this.sideT = 0.5;
    dir.copy(turned(this.side * 1.1));
  }

  /** Keep a body's width from the others, and out of Ravi's way. */
  private separate(dt: number): void {
    const e = this.e;
    const r = this.deps.avoid?.();
    if (r) {
      const dx = e.position.x - r.x;
      const dz = e.position.z - r.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.9 && d > 1e-4) {
        e.position.x += (dx / d) * (0.9 - d);
        e.position.z += (dz / d) * (0.9 - d);
      }
    }
    for (const o of this.deps.all()) {
      if (o === e || !o.alive) continue;
      const dx = e.position.x - o.position.x;
      const dz = e.position.z - o.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.1 || d < 1e-4) continue;
      const push = (1.1 - d) * Math.min(1, dt * 6);
      e.position.x += (dx / d) * push;
      e.position.z += (dz / d) * push;
    }
  }

  /** Out of anything solid he's walked into, the short way. */
  private resolve(): void {
    const p = this.e.position;
    for (const c of this.deps.colliders) {
      if (c.disabled) continue;
      const b = c.box;
      if (b.max.y < 0.3 || b.min.y > 1.6) continue;
      if (p.x < b.min.x - BODY || p.x > b.max.x + BODY || p.z < b.min.z - BODY || p.z > b.max.z + BODY) continue;
      const pushes = [b.min.x - BODY - p.x, b.max.x + BODY - p.x, b.min.z - BODY - p.z, b.max.z + BODY - p.z];
      let k = 0;
      for (let i = 1; i < 4; i++) if (Math.abs(pushes[i]) < Math.abs(pushes[k])) k = i;
      if (k < 2) p.x += pushes[k];
      else p.z += pushes[k];
    }
  }
}
