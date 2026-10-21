import * as THREE from 'three';
import { Enemy } from './Enemy';
import { armWithAK } from './AkModel';

/**
 * The boss's helicopter: a dark police-force utility helicopter with its
 * side door slid open and a man knelt in it with a rifle. It flies station
 * out ahead of Ravi over the road, sideways on so the door faces him,
 * drifting about the sky so he has to track it — and when it has taken
 * HELI_HP rounds it blows apart in the air (shatter): cabin, tail, skids
 * and rotor blades let go as pieces for the scene to fling about.
 *
 * The scene says where it should be (`want`) and where Ravi is; this flies
 * it there with some weight, banks it into its drift, turns its door on
 * him, spins the rotors and poses the gunner. reset() puts it back
 * together for the next one.
 */

export const HELI_HP = 10;

/** The pieces it comes apart into when it's shot down: each its own group, so it can be let go of and put back. */
interface HeliParts {
  cabin: THREE.Group;
  tail: THREE.Group;
  skids: THREE.Group[];
  blades: THREE.Object3D[];
  disc: THREE.Object3D;
}

/** Model frame: nose toward −Z, its right +X (the open door), skids at y 0. */
function heliModel(): { group: THREE.Group; rotor: THREE.Object3D; tail: THREE.Object3D; beacon: THREE.MeshStandardMaterial; hit: THREE.Vector3; parts: HeliParts } {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0x1e2530 });
  const trim = new THREE.MeshLambertMaterial({ color: 0xd8dde2 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x0c0e11 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x24384c, transparent: true, opacity: 0.75 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x6d737a });
  const part = (): THREE.Group => {
    const p = new THREE.Group();
    g.add(p);
    return p;
  };
  const cabinG = part();
  const tailG = part();
  const skidG = [part(), part()];
  const mesh = (to: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    to.add(m);
    return m;
  };
  // The cabin: a long rounded body, a glass nose, the engine hump on top
  const cabin = new THREE.CapsuleGeometry(1.15, 2.6, 6, 14);
  cabin.rotateX(Math.PI / 2);
  cabin.scale(1, 0.92, 1);
  mesh(cabinG, cabin, body, 0, 1.55, 0);
  const nose = new THREE.SphereGeometry(1.08, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  nose.rotateX(-Math.PI / 2);
  mesh(cabinG, nose, glass, 0, 1.62, -1.55);
  mesh(cabinG, new THREE.BoxGeometry(1.3, 0.55, 2.6), body, 0, 2.75, 0.4);
  // A white band down each side, and the open door on the right
  mesh(cabinG, new THREE.BoxGeometry(2.34, 0.18, 3.0), trim, 0, 1.25, 0.2);
  mesh(cabinG, new THREE.BoxGeometry(0.06, 1.25, 1.55), dark, 1.15, 1.6, 0.05);
  mesh(cabinG, new THREE.BoxGeometry(0.08, 1.3, 1.6), body, 1.2, 1.6, 1.65);
  // Tail boom, fin, tailplane
  const boom = new THREE.CylinderGeometry(0.22, 0.42, 5.2, 10);
  boom.rotateX(Math.PI / 2);
  mesh(tailG, boom, body, 0, 2.05, 4.3);
  mesh(tailG, new THREE.BoxGeometry(0.12, 1.5, 0.9), body, 0, 2.75, 6.7, 0.35, 0, 0);
  mesh(tailG, new THREE.BoxGeometry(2.0, 0.08, 0.55), body, 0, 2.15, 6.0);
  // Skids
  [-0.85, 0.85].forEach((sx, i) => {
    const skid = new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6);
    skid.rotateX(Math.PI / 2);
    mesh(skidG[i], skid, metal, sx, 0.08, 0.2);
    for (const sz of [-0.9, 1.1]) mesh(skidG[i], new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), metal, sx * 0.85, 0.42, sz, 0, 0, sx * 0.3);
  });
  // Main rotor: mast, hub, four blades, a faint disc for the blur
  mesh(cabinG, new THREE.CylinderGeometry(0.1, 0.12, 0.6, 8), metal, 0, 3.25, 0.2);
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.55, 0.2);
  const blades: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 5.4), dark);
    blade.position.set(Math.sin((i * Math.PI) / 2) * 2.7, 0, Math.cos((i * Math.PI) / 2) * 2.7);
    blade.rotation.y = (i * Math.PI) / 2;
    rotor.add(blade);
    blades.push(blade);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(5.6, 32),
    new THREE.MeshBasicMaterial({ color: 0x15181c, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })
  );
  disc.rotation.x = -Math.PI / 2;
  rotor.add(disc);
  g.add(rotor);
  // Tail rotor on the fin's left
  const tail = new THREE.Group();
  tail.position.set(-0.15, 2.85, 6.75);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.3, 0.14), dark);
    b.rotation.x = (i * Math.PI) / 2;
    tail.add(b);
  }
  tailG.add(tail);
  // The red beacon under the belly, and the searchlight
  const beacon = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 2 });
  mesh(cabinG, new THREE.SphereGeometry(0.11, 8, 6), beacon, 0, 0.7, 0.6);
  mesh(cabinG, new THREE.CylinderGeometry(0.16, 0.2, 0.3, 10), metal, -0.5, 0.75, -1.4, Math.PI / 2, 0, 0);
  return { group: g, rotor, tail, beacon, hit: new THREE.Vector3(0, 1.7, 0.6), parts: { cabin: cabinG, tail: tailG, skids: skidG, blades, disc } };
}

/** A piece of it flying loose: what it is, how it's going and turning, and how big it is (for where it comes to rest). */
export interface HeliPiece {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  size: number;
  kind: 'cabin' | 'tail' | 'skid' | 'blade';
}

export class Helicopter {
  readonly group: THREE.Group;
  readonly gunner: Enemy;
  hp = HELI_HP;
  /** 'in': coming in to station; 'fight'; 'down': falling whole; 'gone' (hidden, or blown apart). */
  state: 'in' | 'fight' | 'down' | 'gone' = 'in';
  /** Where the scene wants it this frame (world), and where it flies from. */
  readonly want = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** How fast the station itself is moving (it rides along with Ravi): what it matches its speed to. */
  private readonly wantVel = new THREE.Vector3();
  private readonly lastWant = new THREE.Vector3();
  private hasLast = false;
  private readonly tmp = new THREE.Vector3();
  private rotor: THREE.Object3D;
  private tailRotor: THREE.Object3D;
  private beacon: THREE.MeshStandardMaterial;
  private readonly hitLocal: THREE.Vector3;
  private readonly parts: HeliParts;
  /** Each piece's place in the whole machine, to put it back together. */
  private readonly homes: { obj: THREE.Object3D; parent: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[] = [];
  private readonly scene: THREE.Scene;
  private yaw = 0;
  private bank = 0;
  private pitch = 0;
  private spin = 0;
  private t = 0;
  downT = 0;

  constructor(scene: THREE.Scene, at: THREE.Vector3) {
    const m = heliModel();
    this.group = m.group;
    this.rotor = m.rotor;
    this.tailRotor = m.tail;
    this.beacon = m.beacon;
    this.hitLocal = m.hit;
    this.parts = m.parts;
    this.scene = scene;
    for (const obj of [m.parts.cabin, m.parts.tail, ...m.parts.skids, ...m.parts.blades]) {
      this.homes.push({ obj, parent: obj.parent!, p: obj.position.clone(), q: obj.quaternion.clone() });
    }
    this.group.position.copy(at);
    this.group.rotation.order = 'YXZ';
    scene.add(this.group);
    // The gunner, knelt in the door with a rifle, facing out of it
    const e = new Enemy(new THREE.Vector3(), 0, 61, { name: 'POLICE FORCE AGENT' });
    armWithAK(e);
    e.setKneeling(true);
    e.setAiming(true);
    m.parts.cabin.add(e.root);
    e.position.set(0.55, 0.95, 0.05);
    e.yaw = -Math.PI / 2;
    e.root.rotation.y = e.yaw;
    this.gunner = e;
  }

  /** Where rounds that hit it are aimed: the middle of the cabin, in the world. */
  centre(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return out.copy(this.hitLocal).applyMatrix4(this.group.matrixWorld);
  }

  /** The gunner's muzzle, in the world. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.gunner.muzzleWorld(out);
  }

  /** Toward `want` with some weight; the door turned on `target`. */
  update(dt: number, target: THREE.Vector3): void {
    this.t += dt;
    const g = this.group;
    this.rotor.rotation.y += dt * 32;
    this.tailRotor.rotation.x += dt * 60;
    this.beacon.emissiveIntensity = this.t % 1 < 0.12 ? 4 : 0.3;
    if (this.state === 'gone') return;
    if (this.state === 'down') {
      // Over, spinning, smoking, and down off the road
      this.downT += dt;
      this.spin = Math.min(9, this.spin + dt * 5);
      this.yaw += this.spin * dt;
      this.velocity.y -= 9.8 * dt;
      this.velocity.x *= 1 - dt * 0.12;
      this.velocity.z *= 1 - dt * 0.12;
      g.position.addScaledVector(this.velocity, dt);
      this.bank += (0.9 - this.bank) * Math.min(1, dt * 1.5);
      this.pitch += (0.4 - this.pitch) * Math.min(1, dt * 1.5);
      g.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');
      this.gunner.update(dt);
      return;
    }
    // Fly to station: a spring with a top speed, matching the station's own speed
    if (this.hasLast && dt > 0) {
      const wv = this.tmp.subVectors(this.want, this.lastWant).divideScalar(dt);
      this.wantVel.lerp(wv, Math.min(1, dt * 6));
    }
    this.lastWant.copy(this.want);
    this.hasLast = true;
    const to = new THREE.Vector3().subVectors(this.want, g.position);
    const acc = to.multiplyScalar(this.state === 'in' ? 1.6 : 2.4).addScaledVector(this.tmp.subVectors(this.wantVel, this.velocity), 1.9);
    this.velocity.addScaledVector(acc, dt);
    const vmax = this.state === 'in' ? 110 : 90;
    if (this.velocity.length() > vmax) this.velocity.setLength(vmax);
    g.position.addScaledVector(this.velocity, dt);
    if (this.state === 'in' && g.position.distanceTo(this.want) < 6) this.state = 'fight';
    // Its right side, the open door, turned on Ravi
    const dx = target.x - g.position.x;
    const dz = target.z - g.position.z;
    const wantYaw = Math.atan2(-dx, -dz) + Math.PI / 2;
    let d = wantYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 2.2);
    // Bank and pitch with the way it is going, in its own frame
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const vRight = this.velocity.x * c - this.velocity.z * s;
    const vFwd = -this.velocity.x * s - this.velocity.z * c;
    this.bank += (THREE.MathUtils.clamp(-vRight * 0.012, -0.35, 0.35) - this.bank) * Math.min(1, dt * 2);
    this.pitch += (THREE.MathUtils.clamp(-vFwd * 0.008, -0.25, 0.25) - this.pitch) * Math.min(1, dt * 2);
    g.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');
    this.gunner.update(dt);
  }

  /** Shot down: it goes over, drifting off the side it is on — still carried on up the road ahead of him. */
  kill(away: THREE.Vector3): void {
    if (this.state === 'down' || this.state === 'gone') return;
    this.state = 'down';
    this.downT = 0;
    this.velocity.addScaledVector(away, 7);
    this.velocity.y = 3;
  }

  /**
   * Blown apart in the air: the cabin (the gunner still in it), the tail,
   * the skids and each rotor blade let go into the world where they are,
   * carrying its speed plus a kick of their own; the machine itself is gone.
   */
  shatter(): HeliPiece[] {
    if (this.state === 'gone') return [];
    const g = this.group;
    g.updateMatrixWorld(true);
    const rnd = (a: number): number => (Math.random() * 2 - 1) * a;
    const local = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).applyQuaternion(g.quaternion);
    const out: HeliPiece[] = [];
    const free = (obj: THREE.Object3D, kind: HeliPiece['kind'], size: number, kick: THREE.Vector3, spin: THREE.Vector3): void => {
      this.scene.attach(obj);
      out.push({ obj, kind, size, vel: this.velocity.clone().add(kick), spin });
    };
    const P = this.parts;
    free(P.cabin, 'cabin', 2.4, local(rnd(2), 3, -2), new THREE.Vector3(rnd(1.2), rnd(2.5), rnd(1.2)));
    free(P.tail, 'tail', 1.6, local(rnd(3), 5 + Math.random() * 3, 7 + Math.random() * 4), local(rnd(2), 6 + Math.random() * 4, rnd(2)));
    P.skids.forEach((sk, i) => free(sk, 'skid', 0.9, local((i ? 1 : -1) * (4 + Math.random() * 3), -1 + Math.random() * 3, rnd(3)), new THREE.Vector3(rnd(8), rnd(8), rnd(8))));
    const hub = this.rotor.getWorldPosition(new THREE.Vector3());
    for (const bl of P.blades) {
      const at = bl.getWorldPosition(new THREE.Vector3());
      const out2 = at.sub(hub).setY(0).normalize();
      free(bl, 'blade', 0.5, out2.multiplyScalar(16 + Math.random() * 10).setY(4 + Math.random() * 6), new THREE.Vector3(rnd(4), 14 + Math.random() * 12, rnd(4)));
    }
    P.disc.visible = false;
    this.state = 'gone';
    g.visible = false;
    return out;
  }

  /** The pieces it was blown into, back where they belong on it. */
  private gather(): void {
    for (const h of this.homes) {
      h.parent.add(h.obj);
      h.obj.position.copy(h.p);
      h.obj.quaternion.copy(h.q);
    }
    this.parts.disc.visible = true;
  }

  /** Back in the air at `at`, whole, coming in: the same machine for each of them. */
  reset(at: THREE.Vector3): void {
    this.gather();
    this.hp = HELI_HP;
    this.state = 'in';
    this.velocity.set(0, 0, 0);
    this.wantVel.set(0, 0, 0);
    this.hasLast = false;
    this.spin = 0;
    this.bank = 0;
    this.pitch = 0;
    this.downT = 0;
    this.t = 0;
    this.group.position.copy(at);
    this.group.visible = true;
  }

  /** Gone: hidden away until it is needed again. */
  hide(): void {
    this.state = 'gone';
    this.group.visible = false;
    this.group.position.set(0, -500, 0);
  }

  dispose(scene: THREE.Scene): void {
    this.state = 'gone';
    this.gather();
    scene.remove(this.group);
  }
}
