import * as THREE from 'three';
import type { Enemy } from './Enemy';
import type { Collider, Waypoint } from '../environment/OfficeLevelBuilder';
import { EventBus, Events } from '../core/EventBus';

const PANIC_SPEED = 4.6;
const CALM_SPEED = 1.5;
const RADIUS = 0.32;

/**
 * CivilianAI — the call-centre staff caught in the raid. They have no
 * weapons and no interest in fighting: they run the waypoint graph at random
 * with their hands up, bolting somewhere new whenever a shot goes off nearby.
 *
 * Once the floor is clear they calm down: hands come down and they walk
 * instead of sprinting. In practice that rarely happens — the agents shoot
 * them long before the last one is down.
 */
export class CivilianAI {
  state: 'panic' | 'calm' = 'panic';
  private path: number[] = [];
  private target: THREE.Vector3 | null = null;
  private repathTimer = 0;
  private stuckTimer = 0;
  private lastPos = new THREE.Vector3();
  private unsub: () => void;

  constructor(
    private civ: Enemy,
    private waypoints: Waypoint[],
    private colliders: Collider[],
    bus: EventBus
  ) {
    this.civ.setHandsUp(true);
    this.lastPos.copy(civ.position);
    this.pickDestination();
    this.unsub = bus.on<{ position: THREE.Vector3; radius: number; kind: string }>(Events.Sound, (s) => {
      if (this.state !== 'panic' || !this.civ.alive) return;
      if (s.kind !== 'gunshot') return;
      // A shot nearby: bolt somewhere else, preferably away from the noise
      if (this.civ.position.distanceTo(s.position) < s.radius) this.pickDestination(s.position);
    });
  }

  dispose(): void {
    this.unsub();
  }

  /**
   * The floor is clear — stop panicking.
   *
   * `mood` picks the face they settle into: 'calm' for somewhere nothing has
   * happened yet, 'concerned' for somewhere it has.
   */
  calmDown(mood: 'calm' | 'concerned' = 'calm'): void {
    if (this.state === 'calm') return;
    this.state = 'calm';
    this.civ.setHandsUp(false);
    if (mood === 'concerned') this.civ.setConcerned();
    this.pickDestination();
  }

  private nearestWaypoint(from: THREE.Vector3): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.waypoints.length; i++) {
      const d = this.waypoints[i].pos.distanceToSquared(from);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Breadth-first route between two waypoints. */
  private route(from: number, to: number): number[] {
    if (from === to) return [to];
    const prev = new Map<number, number>([[from, -1]]);
    const q = [from];
    while (q.length) {
      const cur = q.shift()!;
      if (cur === to) break;
      for (const n of this.waypoints[cur].links) {
        if (prev.has(n)) continue;
        prev.set(n, cur);
        q.push(n);
      }
    }
    if (!prev.has(to)) return [];
    const out: number[] = [];
    for (let n: number = to; n !== -1; n = prev.get(n)!) out.unshift(n);
    out.shift(); // drop the node we're already standing on
    return out;
  }

  /** Head somewhere new; if `away` is given, prefer a far-off corner. */
  private pickDestination(away?: THREE.Vector3): void {
    const here = this.nearestWaypoint(this.civ.position);
    let pick = Math.floor(Math.random() * this.waypoints.length);
    if (away) {
      // Sample a handful and take whichever is furthest from the noise
      let bestD = -1;
      for (let i = 0; i < 6; i++) {
        const c = Math.floor(Math.random() * this.waypoints.length);
        const d = this.waypoints[c].pos.distanceToSquared(away);
        if (d > bestD) {
          bestD = d;
          pick = c;
        }
      }
    }
    this.path = this.route(here, pick);
    this.repathTimer = 3 + Math.random() * 3;
    this.advance();
  }

  private advance(): void {
    const next = this.path.shift();
    this.target = next === undefined ? null : this.waypoints[next].pos.clone();
  }

  update(dt: number): void {
    const civ = this.civ;
    if (!civ.alive) return;

    this.repathTimer -= dt;
    if (!this.target || this.repathTimer <= 0) {
      this.pickDestination();
      if (!this.target) {
        civ.setWalk(0);
        return;
      }
    }

    const speed = this.state === 'panic' ? PANIC_SPEED : CALM_SPEED;
    const to = this.target.clone().sub(civ.position);
    to.y = 0;
    const dist = to.length();
    if (dist < 0.4) {
      this.advance();
      if (!this.target) this.pickDestination();
      return;
    }
    to.divideScalar(dist);

    // Face where they're going and run
    const look = civ.position.clone().addScaledVector(to, 2);
    civ.faceToward(look, dt, this.state === 'panic' ? 9 : 4);
    civ.setWalk(this.state === 'panic' ? 1 : 0.45);

    const step = speed * dt;
    this.slide(to.x * step, to.z * step);

    // Wedged against something? Pick a different destination.
    if (civ.position.distanceToSquared(this.lastPos) < (step * 0.25) ** 2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.6) {
        this.stuckTimer = 0;
        this.pickDestination();
      }
    } else {
      this.stuckTimer = 0;
    }
    this.lastPos.copy(civ.position);
  }

  /** Axis-separated move so they scrape along walls instead of stopping dead. */
  private slide(dx: number, dz: number): void {
    const p = this.civ.position;
    const free = (x: number, z: number): boolean => {
      const box = new THREE.Box3(
        new THREE.Vector3(x - RADIUS, p.y + 0.1, z - RADIUS),
        new THREE.Vector3(x + RADIUS, p.y + 1.6, z + RADIUS)
      );
      for (const c of this.colliders) {
        if (c.disabled) continue;
        if (box.intersectsBox(c.box)) return false;
      }
      return true;
    };
    if (free(p.x + dx, p.z)) p.x += dx;
    if (free(p.x, p.z + dz)) p.z += dz;
    this.civ.root.position.copy(p);
  }
}
