import * as THREE from 'three';
import type { ParticleManager } from './ParticleManager';

/**
 * Debris — loose pieces of something blown apart, flying, tumbling,
 * bouncing and coming to rest on whatever is under them (the scene says
 * how high that is anywhere, and it can change: a piece resting on a deck
 * that falls in goes down with it). Some burn as they go, some trail smoke,
 * for a while.
 */

export interface DebrisPiece {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  /** World angular velocity, rad/s. */
  spin: THREE.Vector3;
  /** Roughly how big: how far its middle sits above what it rests on is half of it. */
  size: number;
  /** Seconds left burning, and trailing smoke. */
  fire?: number;
  smoke?: number;
  /** Set once it has come to rest. */
  still?: boolean;
  /** Called the first time it hits something, with how hard. Return true if that stops it dead (it bounces no further). */
  onLand?: (p: DebrisPiece, speed: number) => boolean | void;
}

const G = 9.8;
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Debris {
  readonly pieces: DebrisPiece[] = [];
  private t = 0;

  constructor(
    private particles: ParticleManager,
    /** The height of whatever is under a point. */
    private floorAt: (x: number, z: number) => number
  ) {}

  add(p: DebrisPiece): DebrisPiece {
    this.pieces.push(p);
    return p;
  }

  /** Let go of every piece (they stay where they are). */
  clear(): void {
    this.pieces.length = 0;
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    this.t += dt;
    const puff = Math.floor(this.t * 20) !== Math.floor((this.t - dt) * 20);
    for (const p of this.pieces) {
      const o = p.obj;
      const rest = p.size * 0.42;
      const floor = this.floorAt(o.position.x, o.position.z);
      // Resting, until what it's on goes from under it
      if (p.still && o.position.y - rest > floor + 0.4) p.still = false;
      if (!p.still) {
        p.vel.y -= G * dt;
        // Air: the light stuff slows; the heavy pieces fly true (the scene aims some of them)
        if (p.size < 1) p.vel.multiplyScalar(1 - dt * 0.25);
        o.position.addScaledVector(p.vel, dt);
        const w = p.spin.length();
        if (w > 1e-4) {
          _q.setFromAxisAngle(_a.copy(p.spin).divideScalar(w), w * dt);
          o.quaternion.premultiply(_q);
        }
        if (o.position.y - rest < floor) {
          const hit = -p.vel.y;
          o.position.y = floor + rest;
          let dead = false;
          if (p.onLand) {
            dead = p.onLand(p, hit) === true;
            p.onLand = undefined;
          }
          if (dead) {
            p.vel.set(0, 0, 0);
            p.spin.multiplyScalar(0.2);
          } else if (hit > 2.5) {
            // A bounce: off the ground, slower, the spin knocked out of it
            p.vel.y = hit * 0.28;
            p.vel.x *= 0.55;
            p.vel.z *= 0.55;
            p.spin.multiplyScalar(0.5);
            this.particles.sparks(o.position, _up, Math.min(14, Math.round(hit)), floor);
            if (p.size > 1) this.particles.dust(o.position, p.size, 0.6);
          } else {
            // Down: it slides to a stop, and settles flat-ish
            p.vel.y = 0;
            p.vel.x *= 1 - Math.min(1, dt * 4);
            p.vel.z *= 1 - Math.min(1, dt * 4);
            p.spin.multiplyScalar(1 - Math.min(1, dt * 5));
            if (p.vel.lengthSq() < 0.04 && p.spin.lengthSq() < 0.04) p.still = true;
          }
        }
      }
      if (p.fire && p.fire > 0) {
        p.fire -= dt;
        this.particles.fire(o.position, Math.min(1.4, p.size * 0.55), 1);
      }
      if (p.smoke && p.smoke > 0) {
        p.smoke -= dt;
        if (puff) this.particles.exhaust(o.position, _up);
      }
    }
  }
}
