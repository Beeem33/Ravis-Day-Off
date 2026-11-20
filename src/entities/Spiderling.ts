import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { wetFlesh } from './AlienCreatures';

/**
 * What comes out of the big one's egg sacs: a spider the size of a cat, a
 * swollen glistening abdomen, a hard dark head with a cluster of red eyes,
 * eight long jointed legs. Fast, low to the ground, one good hit each. It
 * runs at him in a weaving line and jumps for him at the end.
 *
 * Dead, it's a ragdoll: its body and each leg their own bodies in the
 * physics, pinned at the hips, thrown and let fall.
 */

let skin: THREE.MeshPhysicalMaterial | null = null;
let chitin: THREE.MeshPhysicalMaterial | null = null;
let eyeMat: THREE.MeshBasicMaterial | null = null;

export class Spiderling {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  /** Hip pivots, each a thigh and a shin under it. */
  readonly legs: { hip: THREE.Group; knee: THREE.Group; side: number; k: number }[] = [];
  readonly hitbox: THREE.Mesh;
  alive = true;
  hp = 1;
  /** 'hatch': tumbling out of its sac (`vel` carries it); 'run'; 'leap'; 'dead'. */
  state: 'hatch' | 'run' | 'leap' | 'dead' = 'hatch';
  stateT = 0;
  readonly vel = new THREE.Vector3();
  yaw = 0;
  bit = false;
  private ph = Math.random() * 6;
  readonly weave = (Math.random() - 0.5) * 2;
  ragdoll: SpiderlingRagdoll | null = null;

  constructor() {
    if (!skin) {
      skin = wetFlesh(2, { clearcoat: 0.9 });
      chitin = new THREE.MeshPhysicalMaterial({ color: 0x1c1418, roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.15 });
      eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3020, toneMapped: false });
    }
    this.group.add(this.body);
    this.body.position.y = 0.2;
    // Abdomen behind (−Z), the head in front (+Z)
    const abd = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), skin);
    abd.scale.set(0.95, 0.8, 1.2);
    abd.position.set(0, 0.04, -0.17);
    const ab = abd.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(ab.count * 3);
    for (let i = 0; i < ab.count; i++) {
      const y = ab.getY(i);
      const c = new THREE.Color(0xb05a6a).lerp(new THREE.Color(0x4a1a24), THREE.MathUtils.smoothstep(y, -0.05, 0.14));
      // Pale spots down its back
      if (y > 0.08 && Math.sin(ab.getZ(i) * 40) > 0.6) c.lerp(new THREE.Color(0xe8c8a0), 0.6);
      col.set([c.r, c.g, c.b], i * 3);
    }
    abd.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), chitin!);
    head.scale.set(1, 0.75, 1.15);
    head.position.set(0, 0.02, 0.06);
    this.body.add(abd, head);
    for (let k = 0; k < 6; k++) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(k < 2 ? 0.018 : 0.011, 8, 6), eyeMat!);
      e.position.set((k % 2 ? 1 : -1) * (k < 2 ? 0.03 : 0.055), 0.06 + (k >= 4 ? -0.02 : 0), 0.15 - (k >= 2 ? 0.015 : 0));
      this.body.add(e);
    }
    // Fangs
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 6), chitin!);
      f.position.set(s * 0.025, -0.03, 0.16);
      f.rotation.x = Math.PI * 0.6;
      this.body.add(f);
    }
    // Eight legs: up and out from the hip, a knee high, the shin down to the ground
    const thighG = new THREE.CylinderGeometry(0.012, 0.016, 0.22, 6);
    thighG.translate(0, 0.11, 0);
    const shinG = new THREE.CylinderGeometry(0.004, 0.011, 0.3, 6);
    shinG.translate(0, -0.15, 0);
    for (let k = 0; k < 8; k++) {
      const side = k < 4 ? -1 : 1;
      const i = k % 4;
      const hip = new THREE.Group();
      hip.position.set(side * 0.06, 0.0, 0.1 - i * 0.055);
      hip.rotation.y = side * (Math.PI / 2) + (1.5 - i) * 0.45 * -side;
      this.body.add(hip);
      const thigh = new THREE.Group();
      thigh.rotation.z = 0;
      thigh.rotation.x = 1.0;
      hip.add(thigh);
      thigh.add(new THREE.Mesh(thighG, chitin!));
      const knee = new THREE.Group();
      knee.position.y = 0.22;
      thigh.add(knee);
      knee.add(new THREE.Mesh(shinG, chitin!));
      knee.rotation.x = -1.45;
      this.legs.push({ hip, knee: thigh, side, k: i });
    }
    this.hitbox = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = 0.2;
    this.hitbox.userData.spider = this;
    this.group.add(this.hitbox);
    this.group.scale.setScalar(1.25);
  }

  /** The legs scuttling at `speed`; the body bobbing. */
  animate(dt: number, speed: number): void {
    if (this.ragdoll) return;
    this.ph += dt * (6 + speed * 3.2);
    const run = Math.min(1, speed / 4);
    this.legs.forEach((l, i) => {
      const off = (i % 2 === 0 ? 0 : Math.PI) + l.k * 0.8;
      const s = Math.sin(this.ph + off);
      l.knee.rotation.x = 1.0 - Math.max(0, s) * 0.5 * run;
      l.hip.rotation.z = Math.cos(this.ph + off) * 0.35 * run * l.side;
    });
    this.body.position.y = 0.2 + Math.abs(Math.sin(this.ph * 2)) * 0.02 * run;
    this.body.rotation.z = Math.sin(this.ph) * 0.05 * run;
  }
}

/**
 * A dead spiderling, limp: the body a ball, each leg a thin box pinned to it
 * at the hip; thrown and let fall on the level's ground.
 */
export class SpiderlingRagdoll {
  private core: CANNON.Body;
  private parts: { body: CANNON.Body; hip: THREE.Group }[] = [];
  private bodies: CANNON.Body[] = [];
  private cons: CANNON.Constraint[] = [];
  private t = 0;
  done = false;
  onRest: ((at: THREE.Vector3) => void) | null = null;
  private rested = false;

  constructor(
    private world: CANNON.World,
    private s: Spiderling,
    vel: THREE.Vector3
  ) {
    s.ragdoll = this;
    s.group.updateMatrixWorld(true);
    const sc = s.group.scale.x;
    const at = s.body.getWorldPosition(new THREE.Vector3());
    const q = s.body.getWorldQuaternion(new THREE.Quaternion());
    const make = (shape: CANNON.Shape, mass: number, p: THREE.Vector3, qq: THREE.Quaternion): CANNON.Body => {
      const b = new CANNON.Body({ mass, shape, linearDamping: 0.05, angularDamping: 0.08 });
      b.position.set(p.x, p.y, p.z);
      b.quaternion.set(qq.x, qq.y, qq.z, qq.w);
      b.collisionFilterGroup = 2;
      b.collisionFilterMask = 1;
      b.velocity.set(vel.x + (Math.random() - 0.5) * 2, vel.y + Math.random() * 1.5, vel.z + (Math.random() - 0.5) * 2);
      b.angularVelocity.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22);
      this.world.addBody(b);
      this.bodies.push(b);
      return b;
    };
    this.core = make(new CANNON.Sphere(0.15 * sc), 2, at, q);
    for (const l of s.legs) {
      const hipW = l.hip.getWorldPosition(new THREE.Vector3());
      const hq = l.hip.getWorldQuaternion(new THREE.Quaternion());
      const mid = hipW.clone().add(new THREE.Vector3(0, 0.0, 0.18 * sc).applyQuaternion(hq));
      const b = make(new CANNON.Box(new CANNON.Vec3(0.012 * sc, 0.012 * sc, 0.2 * sc)), 0.15, mid, hq);
      const w = new CANNON.Vec3(hipW.x, hipW.y, hipW.z);
      const c = new CANNON.PointToPointConstraint(this.core, this.core.pointToLocalFrame(w), b, b.pointToLocalFrame(w), 1e5);
      this.world.addConstraint(c);
      this.cons.push(c);
      this.parts.push({ body: b, hip: l.hip });
    }
    // The legs let go of their stride: each straight out along its body
    for (const l of s.legs) {
      l.knee.rotation.set(Math.PI / 2, 0, 0);
      l.hip.rotation.z = 0;
    }
  }

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    const s = this.s;
    const cq = new THREE.Quaternion(this.core.quaternion.x, this.core.quaternion.y, this.core.quaternion.z, this.core.quaternion.w);
    const cp = new THREE.Vector3(this.core.position.x, this.core.position.y, this.core.position.z);
    // The group's frame where the body is (its y offset and scale taken off)
    s.group.quaternion.copy(cq);
    s.group.position.copy(cp).sub(new THREE.Vector3(0, s.body.position.y * s.group.scale.x, 0).applyQuaternion(cq));
    s.body.rotation.set(0, 0, 0);
    const inv = cq.clone().invert();
    for (const p of this.parts) {
      const bq = new THREE.Quaternion(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
      p.hip.quaternion.copy(inv.clone().multiply(bq));
    }
    const still = this.core.velocity.length() < 0.2 && this.t > 0.5;
    if (!this.rested && (still || this.t > 2.5)) {
      this.rested = true;
      this.onRest?.(cp.clone());
    }
    if ((still && this.t > 2) || this.t > 8) this.dispose();
  }

  dispose(): void {
    if (this.done) return;
    this.done = true;
    for (const c of this.cons) this.world.removeConstraint(c);
    for (const b of this.bodies) this.world.removeBody(b);
  }
}
