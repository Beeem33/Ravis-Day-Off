import * as THREE from 'three';
import type { Enemy } from './Enemy';
import type { ParticleManager } from '../fx/ParticleManager';

/**
 * JetpackTrooper — one of the Collective's men on a jetpack: he comes in
 * high over the lot, drops to hover a few storeys up off to one side of
 * Ravi, drifts from one firing point to the next round him and puts bursts
 * down on him. He has to be shot out of the air.
 *
 * Shot down, the pack goes: it spits sparks and fire, he spins on it, the
 * thrust throws him through a couple of crazy loops, and then it noses over
 * and drives him head first into the ground, where it blows. The scene owns
 * what a burst or the crash does; this class flies him and draws the pack.
 */

type State = 'arrive' | 'fly' | 'spiral' | 'dive' | 'done';

export interface JetDeps {
  /** Where Ravi is (his feet). */
  target: () => THREE.Vector3;
  /** One round from his gun at Ravi (the scene rolls whether it hits). */
  fire: (e: Enemy) => void;
  /** The pack has hit the ground, here, going this fast. */
  crash: (t: JetpackTrooper, at: THREE.Vector3, vel: THREE.Vector3) => void;
  particles: ParticleManager;
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const UP = V(0, 1, 0);
const RIGHT = V(1, 0, 0);

let MATS: { frame: THREE.MeshStandardMaterial; tank: THREE.MeshStandardMaterial; nozzle: THREE.MeshStandardMaterial; flame: THREE.MeshBasicMaterial; core: THREE.MeshBasicMaterial; lamp: THREE.MeshStandardMaterial } | null = null;
function mats(): NonNullable<typeof MATS> {
  if (MATS) return MATS;
  MATS = {
    frame: new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.5, metalness: 0.6 }),
    tank: new THREE.MeshStandardMaterial({ color: 0x6b737d, roughness: 0.3, metalness: 0.8 }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.5, metalness: 0.8, emissive: 0xff5a1a, emissiveIntensity: 0.6 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    core: new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 3 })
  };
  return MATS;
}

/** The pack: a frame on his back, two tanks, two nozzles under them burning. Built in his frame (+Z his back). */
function jetpack(): { group: THREE.Group; flames: THREE.Mesh[]; nozzles: THREE.Object3D[] } {
  const M = mats();
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.05), M.frame);
  plate.position.set(0, 0, 0.02);
  g.add(plate);
  const flames: THREE.Mesh[] = [];
  const nozzles: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.4, 4, 12), M.tank);
    tank.position.set(s * 0.11, 0.02, 0.13);
    g.add(tank);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.14, 12, 1, true), M.nozzle);
    nozzle.position.set(s * 0.11, -0.33, 0.13);
    g.add(nozzle);
    const n = new THREE.Object3D();
    n.position.set(s * 0.11, -0.4, 0.13);
    g.add(n);
    nozzles.push(n);
    // The flame: a cone out of the nozzle, a hot core inside it
    const cone = new THREE.ConeGeometry(0.075, 0.6, 10, 1, true);
    cone.rotateX(Math.PI);
    cone.translate(0, -0.3, 0);
    const flame = new THREE.Mesh(cone, M.flame);
    flame.position.copy(n.position);
    flame.renderOrder = 7;
    g.add(flame);
    const coreGeo = new THREE.ConeGeometry(0.035, 0.32, 8, 1, true);
    coreGeo.rotateX(Math.PI);
    coreGeo.translate(0, -0.16, 0);
    const core = new THREE.Mesh(coreGeo, M.core);
    core.renderOrder = 8;
    flame.add(core);
    flames.push(flame);
  }
  // Straps over the shoulders, a winking red lamp on top
  for (const s of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.3), M.frame);
    strap.position.set(s * 0.13, 0.24, -0.08);
    g.add(strap);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), M.lamp);
  lamp.position.set(0, 0.27, 0.06);
  g.add(lamp);
  return { group: g, flames, nozzles };
}

export class JetpackTrooper {
  state: State = 'arrive';
  readonly pack: THREE.Group;
  private flames: THREE.Mesh[];
  private nozzles: THREE.Object3D[];
  private vel = new THREE.Vector3();
  private goal = new THREE.Vector3();
  private goalT = 0;
  private fireT = 2 + Math.random() * 1.5;
  private burst = 0;
  private burstT = 0;
  private t = Math.random() * 10;
  /** The spiral: how long it's been going, which way he's thrown, where the loops started. */
  private st = 0;
  private heading = new THREE.Vector3(1, 0, 0);
  private from = new THREE.Vector3();
  private spin = 0;
  private spinRate = 0;
  private loopEnd = new THREE.Vector3();
  private loopQ = new THREE.Quaternion();
  private side = Math.random() < 0.5 ? 1 : -1;
  /** 0..1 how hard the pack is pushing (for the flames and the sound). */
  thrust = 1;

  constructor(readonly e: Enemy, private deps: JetDeps) {
    const p = jetpack();
    this.pack = p.group;
    this.flames = p.flames;
    this.nozzles = p.nozzles;
    // On his back, over the shoulder blades (his forward is −Z)
    this.pack.position.set(0, 1.24, 0.17);
    e.root.add(this.pack);
    e.root.rotation.order = 'YXZ';
    this.pickGoal();
  }

  get alive(): boolean {
    return this.state === 'arrive' || this.state === 'fly';
  }

  /** Where the pack is, in the world. */
  packWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.pack.updateWorldMatrix(true, false);
    return this.pack.localToWorld(out.set(0, -0.1, 0.12));
  }

  /** A hover point off to one side of Ravi, a few storeys up. */
  private pickGoal(): void {
    const p = this.deps.target();
    const a = Math.random() * Math.PI * 2;
    const r = 13 + Math.random() * 11;
    this.goal.set(p.x + Math.cos(a) * r, 6.5 + Math.random() * 4.5, p.z + Math.sin(a) * r * 0.8 - 6);
    this.goalT = 3 + Math.random() * 3;
  }

  /** Shot out of the sky: the pack's gone, from `dir` (the round's way). */
  shotDown(dir: THREE.Vector3): void {
    if (!this.alive) return;
    this.state = 'spiral';
    this.st = 0;
    this.from.copy(this.e.position);
    this.heading.set(dir.x, 0, dir.z);
    if (this.heading.lengthSq() < 1e-4) this.heading.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    this.heading.normalize();
    this.spinRate = (8 + Math.random() * 5) * this.side;
    this.e.setAiming(false);
    const pk = this.packWorld(_a);
    this.deps.particles.explosion(pk, 0.9);
    this.deps.particles.sparks(pk, _b.copy(dir).negate(), 40);
    this.deps.particles.electricSparks(pk, 14);
  }

  update(dt: number): void {
    const e = this.e;
    this.t += dt;
    if (this.state === 'done') return;
    if (this.alive) this.fly(dt);
    else this.fall(dt);
    // The flames: flicker with the thrust, a little longer for a hard push
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const k = this.thrust * (0.8 + 0.35 * Math.sin(this.t * (38 + i * 7)) + 0.2 * Math.random());
      f.scale.set(1, Math.max(0.05, k), 1);
      f.visible = k > 0.08;
    }
    void e;
  }

  private fly(dt: number): void {
    const e = this.e;
    const p = this.deps.target();
    this.goalT -= dt;
    if (this.state === 'arrive' && e.position.distanceTo(this.goal) < 3) this.state = 'fly';
    if (this.goalT <= 0 && this.state === 'fly') this.pickGoal();
    // Toward the hover point, easing in; a bob and a drift on top
    const to = _a.copy(this.goal).sub(e.position);
    const want = to.multiplyScalar(this.state === 'arrive' ? 0.9 : 0.6);
    const maxV = this.state === 'arrive' ? 14 : 6;
    if (want.length() > maxV) want.setLength(maxV);
    want.y += Math.sin(this.t * 1.7) * 0.6;
    this.vel.lerp(want, Math.min(1, dt * 1.8));
    e.position.addScaledVector(this.vel, dt);
    if (e.position.y < 4) e.position.y += (4 - e.position.y) * Math.min(1, dt * 3);
    // Facing him, the gun on him
    const chest = _b.set(p.x, p.y + 1.2, p.z);
    e.faceToward(chest, dt, 6);
    const flat = Math.hypot(chest.x - e.position.x, chest.z - e.position.z);
    e.setAiming(true);
    e.setAimPitch(Math.atan2(chest.y - (e.position.y + 1.45), flat));
    e.setWalk(0);
    e.pose = { liftL: 0.32, liftR: 0.12 };
    this.thrust = 0.75 + 0.25 * Math.min(1, this.vel.length() / 6);
    // Leaning into the way he's going
    const fwd = _q.setFromAxisAngle(UP, e.yaw);
    const local = _a.copy(this.vel).applyQuaternion(_q2.copy(fwd).invert());
    e.root.rotation.set(THREE.MathUtils.clamp(local.z * 0.05, -0.3, 0.3), e.yaw, THREE.MathUtils.clamp(-local.x * 0.05, -0.3, 0.3));
    // Bursts at him, from the hover
    if (this.state !== 'fly') return;
    if (this.burst > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this.burst--;
        this.burstT = 0.13;
        this.deps.fire(e);
      }
      return;
    }
    this.fireT -= dt;
    if (this.fireT <= 0 && flat < 48) {
      this.fireT = 1.8 + Math.random() * 1.6;
      this.burst = 3 + Math.floor(Math.random() * 2);
      this.burstT = 0;
    }
  }

  /** Coming down: loops and spinning, then the dive into the ground. */
  private fall(dt: number): void {
    const e = this.e;
    this.st += dt;
    const t = this.st;
    const P = this.deps.particles;
    const h = this.heading;
    this.spin += this.spinRate * dt * (1 + t * 0.8);
    // The pack dying: sputtering, sparking, burning
    this.thrust = Math.random() < 0.3 ? 0.1 : 0.5 + Math.random() * 0.8;
    const pk = this.packWorld(_a);
    P.sparks(pk, _b.set(Math.random() - 0.5, -0.4 - Math.random(), Math.random() - 0.5).normalize(), 9);
    if (Math.random() < 0.6) P.electricSparks(pk, 4);
    P.fire(pk, 0.55, 1);
    P.tyreSmoke(pk, _b.copy(this.vel).negate().normalize(), 0.8);
    const LOOPS = 1.55;
    if (this.state === 'spiral') {
      // Two loops head over heels along the way he was thrown, corkscrewing on the pack as he goes
      const u = Math.min(1, t / LOOPS);
      const th = u * Math.PI * 4;
      const R = 2.4;
      const prev = _b.copy(e.position);
      e.position.copy(this.from)
        .addScaledVector(h, R * Math.sin(th) + 3.5 * t)
        .add(_a.set(0, R * (1 - Math.cos(th)) - 1.2 * t * t, 0));
      this.vel.copy(e.position).sub(prev).divideScalar(Math.max(dt, 1e-4));
      // Pitched over by the loop's angle about his side axis, spun about his own length
      _q.setFromAxisAngle(UP, Math.atan2(-h.x, -h.z));
      _q2.setFromAxisAngle(RIGHT, -th);
      e.root.quaternion.copy(_q).multiply(_q2).multiply(_q2.setFromAxisAngle(UP, this.spin));
      e.pose = { liftL: 0.6 + 0.3 * Math.sin(t * 17), liftR: 0.2 + 0.3 * Math.sin(t * 13 + 1), lean: 0.3 };
      if (u >= 1) {
        this.state = 'dive';
        this.st = 0;
        this.loopEnd.copy(e.position);
        this.loopQ.copy(e.root.quaternion);
        this.vel.copy(h).multiplyScalar(7).setY(-3);
      }
      return;
    }
    // The dive: nose over, head first, faster and faster, still spinning
    this.vel.y -= (16 + 14 * t) * dt;
    this.vel.x += h.x * 4 * dt;
    this.vel.z += h.z * 4 * dt;
    e.position.addScaledVector(this.vel, dt);
    const dir = _a.copy(this.vel).normalize();
    _q.setFromUnitVectors(UP, dir); // head first: his up along the way he's going (down)
    _q.multiply(_q2.setFromAxisAngle(UP, this.spin));
    e.root.quaternion.copy(this.loopQ).slerp(_q, Math.min(1, t / 0.3));
    e.pose = { liftL: 0.15, liftR: 0.45, lean: 0.2 };
    if (e.position.y <= 0.35 || t > 3.5) {
      e.position.y = Math.max(0.35, e.position.y);
      this.state = 'done';
      this.thrust = 0;
      for (const f of this.flames) f.visible = false;
      this.deps.crash(this, e.position.clone(), this.vel.clone());
    }
  }
}
