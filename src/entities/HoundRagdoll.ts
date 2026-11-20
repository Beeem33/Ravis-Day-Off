import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { Hound } from './AlienCreatures';

/**
 * A dead hound, limp: its body a box, its head a ball, its four legs thin
 * boxes, pinned together at the neck and the hips, thrown by whatever killed
 * it and let fall on the ground (the level's heightfield) as it will. The
 * mesh is posed from the bodies every frame until it's come to rest.
 *
 * The parts don't collide with each other (group 2, mask 1: only the world).
 */
export class HoundRagdoll {
  private torso: CANNON.Body;
  private head: CANNON.Body;
  private legs: CANNON.Body[] = [];
  private bodies: CANNON.Body[] = [];
  private constraints: CANNON.Constraint[] = [];
  private t = 0;
  /** Settled: the scene takes it out of the physics then (the mesh keeps its last pose). */
  done = false;
  /** Fired once, when it first comes to rest: where (for the blood under it). */
  onRest: ((at: THREE.Vector3) => void) | null = null;
  private rested = false;

  constructor(
    private world: CANNON.World,
    private hound: Hound,
    vel: THREE.Vector3
  ) {
    const s = hound.group.scale.x;
    hound.group.updateMatrixWorld(true);
    const bodyW = new THREE.Vector3();
    const bodyQ = new THREE.Quaternion();
    hound.body.getWorldPosition(bodyW);
    hound.body.getWorldQuaternion(bodyQ);
    const q = new CANNON.Quaternion(bodyQ.x, bodyQ.y, bodyQ.z, bodyQ.w);
    const make = (shape: CANNON.Shape, mass: number, at: THREE.Vector3): CANNON.Body => {
      const b = new CANNON.Body({ mass, shape, linearDamping: 0.08, angularDamping: 0.12 });
      b.position.set(at.x, at.y, at.z);
      b.quaternion.copy(q);
      b.collisionFilterGroup = 2;
      b.collisionFilterMask = 1;
      b.velocity.set(vel.x + (Math.random() - 0.5), vel.y, vel.z + (Math.random() - 0.5));
      b.angularVelocity.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 14);
      world.addBody(b);
      this.bodies.push(b);
      return b;
    };
    this.torso = make(new CANNON.Box(new CANNON.Vec3(0.2 * s, 0.2 * s, 0.6 * s)), 25, bodyW);
    const neckW = hound.neck.getWorldPosition(new THREE.Vector3());
    const headW = hound.mouthWorld(new THREE.Vector3());
    this.head = make(new CANNON.Sphere(0.2 * s), 5, headW);
    this.pin(this.torso, this.head, neckW);
    for (const l of hound.legs) {
      const hip = l.hip.getWorldPosition(new THREE.Vector3());
      const mid = hip.clone().add(new THREE.Vector3(0, -0.38 * s, 0).applyQuaternion(bodyQ));
      const leg = make(new CANNON.Box(new CANNON.Vec3(0.05 * s, 0.38 * s, 0.05 * s)), 3, mid);
      this.pin(this.torso, leg, hip);
      this.legs.push(leg);
    }
    // The run's pose let go: straight, the knees a little bent, the body level in its own frame
    hound.ragdoll = true;
    hound.body.position.set(0, 0.72, 0);
    hound.body.rotation.set(0, 0, 0);
    hound.body.scale.set(1, 1, 1);
    for (const l of hound.legs) {
      l.knee.rotation.x = l.front ? -0.3 : 0.45;
      l.paw.rotation.x = 0;
    }
  }

  private pin(a: CANNON.Body, b: CANNON.Body, at: THREE.Vector3): void {
    const w = new CANNON.Vec3(at.x, at.y, at.z);
    const pa = a.pointToLocalFrame(w);
    const pb = b.pointToLocalFrame(w);
    const c = new CANNON.PointToPointConstraint(a, pa, b, pb, 1e6);
    this.world.addConstraint(c);
    this.constraints.push(c);
  }

  /** The mesh to where the bodies are. */
  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    const h = this.hound;
    const s = h.group.scale.x;
    const tq = new THREE.Quaternion(this.torso.quaternion.x, this.torso.quaternion.y, this.torso.quaternion.z, this.torso.quaternion.w);
    const tp = new THREE.Vector3(this.torso.position.x, this.torso.position.y, this.torso.position.z);
    h.group.quaternion.copy(tq);
    h.group.position.copy(tp).sub(new THREE.Vector3(0, 0.72 * s, 0).applyQuaternion(tq));
    const inv = tq.clone().invert();
    const rel = (b: CANNON.Body): THREE.Quaternion => inv.clone().multiply(new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w));
    h.neck.quaternion.copy(rel(this.head));
    h.legs.forEach((l, i) => l.hip.quaternion.copy(rel(this.legs[i])));
    const still = this.torso.velocity.length() < 0.25 && this.torso.angularVelocity.length() < 0.4;
    if (!this.rested && (still || this.t > 3) && this.t > 0.6) {
      this.rested = true;
      this.onRest?.(tp.clone());
    }
    // Lying still for a while, or long enough: out of the physics, left as it fell
    if ((still && this.t > 2.5) || this.t > 10) this.dispose();
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    for (const c of this.constraints) this.world.removeConstraint(c);
    for (const b of this.bodies) this.world.removeBody(b);
  }
}
