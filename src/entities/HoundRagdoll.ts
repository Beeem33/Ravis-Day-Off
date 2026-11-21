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
  /** How long it's been loose. */
  get age(): number {
    return this.t;
  }
  /** Settled: the scene takes it out of the physics then (the mesh keeps its last pose). */
  done = false;
  /** Fired once, when it first comes to rest: where (for the blood under it). */
  onRest: ((at: THREE.Vector3) => void) | null = null;
  private rested = false;
  /** How long it's lain still, this time. */
  stillT = 0;

  constructor(
    private world: CANNON.World,
    private hound: Hound,
    vel: THREE.Vector3,
    /** How hard it tumbles (rad/s, either way). */
    spin = 14
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
      b.angularVelocity.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin * 0.43, (Math.random() - 0.5) * spin);
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

  /** Its legs give under it: it rolls over onto its side (it would stand on four stiff legs else). */
  topple(): void {
    const s = Math.random() < 0.5 ? -1 : 1;
    const f = this.torso.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
    const side = this.torso.quaternion.vmult(new CANNON.Vec3(1, 0, 0));
    for (const b of this.bodies) {
      b.angularVelocity.set(f.x * 6 * s, f.y * 6 * s, f.z * 6 * s);
      b.velocity.x += side.x * 1.6 * s;
      b.velocity.z += side.z * 1.6 * s;
    }
    // The legs folding up under it rather than holding it up
    for (const l of this.legs) l.velocity.y += 1.5;
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
    this.stillT = still ? this.stillT + dt : 0;
    if (!this.rested && (still || this.t > 3) && this.t > 0.6) {
      this.rested = true;
      this.onRest?.(tp.clone());
    }
    // Lying still for a while, or long enough: out of the physics, left as it fell
    if ((still && this.t > 2.5) || this.t > 10) this.dispose();
  }

  /** Where its body is, and how fast it's going. */
  torsoAt(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.torso.position.x, this.torso.position.y, this.torso.position.z);
  }
  torsoVel(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.torso.velocity.x, this.torso.velocity.y, this.torso.velocity.z);
  }
  /** Which way its body faces (its head end). */
  facing(out: THREE.Vector3): THREE.Vector3 {
    const f = this.torso.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
    return out.set(f.x, f.y, f.z);
  }

  /** Back into the physics (it had settled and been taken out), to be moved again. */
  wake(): void {
    if (!this.done) return;
    this.done = false;
    this.t = 0.7;
    this.stillT = 0;
    for (const b of this.bodies) {
      b.velocity.setZero();
      b.angularVelocity.setZero();
      this.world.addBody(b);
    }
    for (const c of this.constraints) this.world.addConstraint(c);
  }

  /**
   * Hit at `point` (world) going `dir` with force `k` (about the speed it
   * knocks a limb to, m/s): the nearest part jerks, the body with it.
   */
  hit(point: THREE.Vector3, dir: THREE.Vector3, k: number): void {
    this.wake();
    let best = this.torso;
    let bd = Infinity;
    for (const b of this.bodies) {
      const d = (b.position.x - point.x) ** 2 + (b.position.y - point.y) ** 2 + (b.position.z - point.z) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    // (up off the ground as well: lying on it, a straight push is all friction)
    const J = new CANNON.Vec3(dir.x, Math.max(0, dir.y) + 0.75, dir.z);
    J.normalize();
    // The part hit, hard; the rest of it, less
    best.applyImpulse(J.scale(best.mass * k), new CANNON.Vec3(point.x - best.position.x, point.y - best.position.y, point.z - best.position.z));
    if (best !== this.torso) this.torso.applyImpulse(J.scale(this.torso.mass * k * 0.6), new CANNON.Vec3(0, 0, 0));
    else this.torso.angularVelocity.vadd(new CANNON.Vec3((Math.random() - 0.5) * k, (Math.random() - 0.5) * k * 0.5, (Math.random() - 0.5) * k), this.torso.angularVelocity);
  }

  /**
   * Let go of it, alive: out of the physics and its pose given back to it to
   * animate (the scene sets it upright).
   */
  release(): void {
    this.dispose();
    const h = this.hound;
    h.ragdoll = false;
    h.neck.quaternion.identity();
    for (const l of h.legs) l.hip.rotation.set(0, 0, 0);
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    for (const c of this.constraints) this.world.removeConstraint(c);
    for (const b of this.bodies) this.world.removeBody(b);
  }
}
