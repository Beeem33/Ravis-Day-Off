import * as THREE from 'three';
import type { Collider } from '../environment/OfficeLevelBuilder';
import { grenade } from '../environment/VanProps';
import { FirstPersonArms, grip, mixGrip } from './RaviVisual';

/**
 * Grenades: Ravi throwing one (T), the ones in the air and on the ground
 * with their fuses burning, and the ones the Collective's men drop, lying
 * where they fell for him to walk over and pick up.
 *
 * The throw, from his eyes: the gun drops out of the way, his right hand
 * comes up with a grenade in it, the left pulls the pin, the arm goes back
 * over the shoulder and comes through, and it's gone — then the gun comes
 * back up. It leaves the hand on `release`, with the scene's say on where
 * it goes (the camera's aim, his own speed added).
 *
 * In flight it's a point with a radius: gravity, the wind does nothing, it
 * bounces off the ground and anything solid and rolls to a stop. The fuse
 * runs from the moment the spoon flies, so a long throw goes off soon after
 * it lands. The scene does the bang (`onExplode`).
 */

const FUSE = 2.7;
const R = 0.045;
const G = 9.8;
const THROW_TIME = 1.0;
const RELEASE_AT = 0.66;
/** How close he has to walk to one lying on the ground. */
const PICK_RANGE = 1.35;

// The grenade in his palm, the fingers round it, held up in front (as the montage had it)
export const GRENADE_HOLD = grip([0.012, -0.064, 0.06], [-0.22, 0.22, -0.95], [0, 1, 0.15], [0.32, -0.45, 0.83], {
  fingers: [[46, 50, 30], [48, 54, 32], [50, 56, 32], [54, 58, 34]],
  thumb: [0.38, 0.42, 0.3]
});
// Let go: the fingers open as it leaves
export const GRENADE_OPEN = grip([0.012, -0.066, 0.066], [-0.22, 0.12, -0.97], [0, 1, 0.08], [0.32, -0.45, 0.83], {
  fingers: [[10, 12, 6], [8, 10, 5], [10, 12, 6], [14, 16, 8]],
  thumb: [0.12, 0.18, 0.12],
  spread: 6
});
// The left hand pinching the ring
export const GRENADE_PIN = grip([0.0, -0.03, 0.07], [0.3, 0.1, -0.95], [-0.6, 0, -0.2], [-0.3, -0.4, 0.6], {
  fingers: [[60, 60, 30], [70, 70, 35], [80, 75, 35], [85, 80, 35]],
  thumb: [0.6, 0.4, 0.3]
});

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

export interface LiveGrenade {
  obj: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  still: boolean;
  bounced: number;
}

export interface GrenadePickup {
  obj: THREE.Group;
  pos: THREE.Vector3;
  t: number;
}

export class GrenadeThrow {
  readonly root = new THREE.Group();
  private hand = new THREE.Object3D();
  private pinHand = new THREE.Object3D();
  private nade: THREE.Group;
  private ring: THREE.Object3D;
  private arms: FirstPersonArms;
  private t = -1;
  private released = false;
  private pinned = false;
  /** Set while one is in his hand: the guns are out of the way. */
  get busy(): boolean {
    return this.t >= 0;
  }
  /** The pin's out (the scene plays the sound). */
  onPin: (() => void) | null = null;
  /** It's left his hand, at `from` (world). */
  onRelease: ((from: THREE.Vector3) => void) | null = null;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.hand, this.pinHand);
    this.nade = grenade();
    this.hand.add(this.nade);
    this.ring = this.nade.children[2];
    this.arms = new FirstPersonArms(this.root, camera).set('r', this.hand, GRENADE_HOLD).set('l', this.pinHand, GRENADE_PIN);
    this.root.visible = false;
  }

  start(): boolean {
    if (this.t >= 0) return false;
    this.t = 0;
    this.released = false;
    this.pinned = false;
    this.nade.visible = true;
    this.ring.visible = true;
    this.root.visible = true;
    return true;
  }

  abort(): void {
    this.t = -1;
    this.root.visible = false;
  }

  /** Where the grenade is right now (world). */
  handWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.nade.getWorldPosition(out);
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    const h = this.hand;
    // Key poses of the right hand (camera space): up from below, held, back over the shoulder, through and down
    const low = new THREE.Vector3(0.2, -0.5, -0.3);
    const held = new THREE.Vector3(0.12, -0.16, -0.36);
    const back = new THREE.Vector3(0.3, 0.02, 0.06);
    const through = new THREE.Vector3(0.05, -0.02, -0.62);
    const after = new THREE.Vector3(-0.05, -0.55, -0.45);
    if (t < 0.22) h.position.lerpVectors(low, held, smooth(t / 0.22));
    else if (t < 0.42) h.position.copy(held).add(new THREE.Vector3(0, 0.01 * Math.sin(t * 20), 0));
    else if (t < 0.58) h.position.lerpVectors(held, back, smooth((t - 0.42) / 0.16));
    else if (t < 0.72) h.position.lerpVectors(back, through, smooth((t - 0.58) / 0.14));
    else h.position.lerpVectors(through, after, smooth((t - 0.72) / 0.25));
    // Turned: palm up holding it; cocked back, the palm faces forward; through, it rolls over
    const cock = smooth((t - 0.42) / 0.16) * (1 - smooth((t - 0.6) / 0.12));
    const roll = smooth((t - 0.6) / 0.2);
    h.rotation.set(-0.1 + 1.2 * cock - 0.6 * roll, 0.1, 0.25 + 0.5 * cock + 0.4 * roll);
    // The left hand: in to the ring, a tug, away
    const pin = smooth((t - 0.1) / 0.12) * (1 - smooth((t - 0.34) / 0.14));
    this.pinHand.position.copy(held).add(new THREE.Vector3(-0.06 - 0.08 * smooth((t - 0.24) / 0.08), 0.02, 0.02)).lerp(new THREE.Vector3(-0.25, -0.6, -0.2), 1 - pin);
    this.pinHand.rotation.set(0, 0, 0);
    this.pinHand.visible = pin > 0.02;
    if (!this.pinned && t >= 0.26) {
      this.pinned = true;
      this.ring.visible = false;
      this.onPin?.();
    }
    const open = smooth((t - RELEASE_AT + 0.02) / 0.06);
    this.arms.set('r', h, mixGrip(GRENADE_HOLD, GRENADE_OPEN, open));
    if (!this.released && t >= RELEASE_AT) {
      this.released = true;
      const at = this.handWorld();
      this.nade.visible = false;
      this.onRelease?.(at);
    }
    this.arms.update();
    if (t >= THROW_TIME) this.abort();
  }
}

/** The grenades in play, and the ones lying about to be picked up. */
export class Grenades {
  readonly live: LiveGrenade[] = [];
  readonly pickups: GrenadePickup[] = [];
  onExplode: ((at: THREE.Vector3) => void) | null = null;
  onBounce: ((at: THREE.Vector3, speed: number) => void) | null = null;
  private glowMat: THREE.MeshBasicMaterial;
  private glowGeo: THREE.RingGeometry;

  constructor(private scene: THREE.Scene, private colliders: () => Collider[]) {
    this.glowGeo = new THREE.RingGeometry(0.16, 0.24, 24);
    this.glowGeo.rotateX(-Math.PI / 2);
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffd85e, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  }

  /** One thrown from `from` at `vel`. */
  throw(from: THREE.Vector3, vel: THREE.Vector3): void {
    const obj = grenade();
    obj.children[2].visible = false;
    obj.position.copy(from);
    obj.scale.setScalar(1.3);
    this.scene.add(obj);
    this.live.push({ obj, pos: from.clone(), vel: vel.clone(), fuse: FUSE, still: false, bounced: 0 });
  }

  /** One dropped on the ground at `at`, for him to pick up. */
  drop(at: THREE.Vector3): void {
    const obj = new THREE.Group();
    const n = grenade();
    n.scale.setScalar(1.5);
    n.rotation.set(Math.PI / 2, Math.random() * 6, 0);
    n.position.y = 0.05;
    obj.add(n);
    const ring = new THREE.Mesh(this.glowGeo, this.glowMat);
    ring.position.y = 0.02;
    ring.renderOrder = 3;
    obj.add(ring);
    obj.position.set(at.x, 0, at.z);
    this.scene.add(obj);
    this.pickups.push({ obj, pos: obj.position.clone(), t: Math.random() * 6 });
  }

  /** Any within reach of `feet`: taken off the ground; returns how many. */
  pickUp(feet: THREE.Vector3, room: number): number {
    let n = 0;
    for (let i = this.pickups.length - 1; i >= 0 && n < room; i--) {
      const p = this.pickups[i];
      if (Math.hypot(p.pos.x - feet.x, p.pos.z - feet.z) > PICK_RANGE || Math.abs(p.pos.y - feet.y) > 1.2) continue;
      this.scene.remove(p.obj);
      this.pickups.splice(i, 1);
      n++;
    }
    return n;
  }

  update(dt: number): void {
    for (const p of this.pickups) {
      p.t += dt;
      const ring = p.obj.children[1];
      const k = 0.85 + 0.25 * Math.sin(p.t * 4);
      ring.scale.setScalar(k);
    }
    const cs = this.colliders();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.fuse -= dt;
      if (g.fuse <= 0) {
        this.scene.remove(g.obj);
        this.live.splice(i, 1);
        this.onExplode?.(g.pos.clone());
        continue;
      }
      if (g.still) continue;
      // Two half steps, so a fast one doesn't go through a barrier
      for (let s = 0; s < 2; s++) {
        const h = dt / 2;
        g.vel.y -= G * h;
        const next = g.pos.clone().addScaledVector(g.vel, h);
        // The ground
        if (next.y < R) {
          next.y = R;
          this.bounce(g, new THREE.Vector3(0, 1, 0));
        }
        // Anything solid: back out along the face it came through
        for (const c of cs) {
          if (c.disabled) continue;
          const b = c.box;
          if (next.x < b.min.x - R || next.x > b.max.x + R || next.y < b.min.y - R || next.y > b.max.y + R || next.z < b.min.z - R || next.z > b.max.z + R) continue;
          if (b.max.y < 0.05) continue;
          const o = g.pos;
          let n: THREE.Vector3;
          if (o.y >= b.max.y + R - 0.01) n = new THREE.Vector3(0, 1, 0);
          else if (o.x <= b.min.x - R + 0.01) n = new THREE.Vector3(-1, 0, 0);
          else if (o.x >= b.max.x + R - 0.01) n = new THREE.Vector3(1, 0, 0);
          else if (o.z <= b.min.z - R + 0.01) n = new THREE.Vector3(0, 0, -1);
          else if (o.z >= b.max.z + R - 0.01) n = new THREE.Vector3(0, 0, 1);
          else if (o.y <= b.min.y - R + 0.01) n = new THREE.Vector3(0, -1, 0);
          else continue;
          if (n.x) next.x = n.x > 0 ? b.max.x + R : b.min.x - R;
          if (n.y) next.y = n.y > 0 ? b.max.y + R : b.min.y - R;
          if (n.z) next.z = n.z > 0 ? b.max.z + R : b.min.z - R;
          this.bounce(g, n);
        }
        g.pos.copy(next);
      }
      g.obj.position.copy(g.pos);
      const sp = g.vel.length();
      g.obj.rotation.x += sp * dt * 3;
      g.obj.rotation.z += sp * dt * 2;
      if (sp < 0.15 && g.pos.y <= R + 0.02) {
        g.still = true;
        g.vel.set(0, 0, 0);
      }
    }
  }

  private bounce(g: LiveGrenade, n: THREE.Vector3): void {
    const into = g.vel.dot(n);
    if (into >= 0) return;
    if (-into > 1.2) this.onBounce?.(g.pos, -into);
    // Off the surface: most of the speed into it lost; along it, friction
    g.vel.addScaledVector(n, -into * 1.32);
    const along = g.vel.clone().addScaledVector(n, -g.vel.dot(n));
    g.vel.addScaledVector(along, -0.35);
    g.bounced++;
  }

  /** For the warm-up: one of each drawn somewhere out of sight. */
  warm(): THREE.Object3D[] {
    this.drop(new THREE.Vector3(0, 0, 9000));
    const p = this.pickups.pop()!;
    p.obj.position.set(0, -50, 0);
    return [p.obj];
  }

  clear(): void {
    for (const g of this.live) this.scene.remove(g.obj);
    for (const p of this.pickups) this.scene.remove(p.obj);
    this.live.length = 0;
    this.pickups.length = 0;
  }
}
