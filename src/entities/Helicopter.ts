import * as THREE from 'three';
import { Enemy } from './Enemy';
import { armWithAK } from './AkModel';

/**
 * The boss's helicopter: a dark police-force utility helicopter with its
 * side door slid open and a man knelt in it with a rifle. It flies station
 * out ahead of Ravi over the road, sideways on so the door faces him,
 * drifting about the sky so he has to track it — and when it has taken
 * HELI_HP rounds it goes over smoking, spins and falls off the side of the
 * road, and burns.
 *
 * The scene says where it should be (`want`) and where Ravi is; this flies
 * it there with some weight, banks it into its drift, turns its door on
 * him, spins the rotors, poses the gunner and runs the crash.
 */

export const HELI_HP = 10;

/** Model frame: nose toward −Z, its right +X (the open door), skids at y 0. */
function heliModel(): { group: THREE.Group; rotor: THREE.Object3D; tail: THREE.Object3D; beacon: THREE.MeshStandardMaterial; hit: THREE.Vector3 } {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0x1e2530 });
  const trim = new THREE.MeshLambertMaterial({ color: 0xd8dde2 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x0c0e11 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x24384c, transparent: true, opacity: 0.75 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x6d737a });
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  // The cabin: a long rounded body, a glass nose, the engine hump on top
  const cabin = new THREE.CapsuleGeometry(1.15, 2.6, 6, 14);
  cabin.rotateX(Math.PI / 2);
  cabin.scale(1, 0.92, 1);
  mesh(cabin, body, 0, 1.55, 0);
  const nose = new THREE.SphereGeometry(1.08, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  nose.rotateX(-Math.PI / 2);
  mesh(nose, glass, 0, 1.62, -1.55);
  mesh(new THREE.BoxGeometry(1.3, 0.55, 2.6), body, 0, 2.75, 0.4);
  // A white band down each side, and the open door on the right
  mesh(new THREE.BoxGeometry(2.34, 0.18, 3.0), trim, 0, 1.25, 0.2);
  mesh(new THREE.BoxGeometry(0.06, 1.25, 1.55), dark, 1.15, 1.6, 0.05);
  mesh(new THREE.BoxGeometry(0.08, 1.3, 1.6), body, 1.2, 1.6, 1.65);
  // Tail boom, fin, tailplane
  const boom = new THREE.CylinderGeometry(0.22, 0.42, 5.2, 10);
  boom.rotateX(Math.PI / 2);
  mesh(boom, body, 0, 2.05, 4.3);
  mesh(new THREE.BoxGeometry(0.12, 1.5, 0.9), body, 0, 2.75, 6.7, 0.35, 0, 0);
  mesh(new THREE.BoxGeometry(2.0, 0.08, 0.55), body, 0, 2.15, 6.0);
  // Skids
  for (const sx of [-0.85, 0.85]) {
    const skid = new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6);
    skid.rotateX(Math.PI / 2);
    mesh(skid, metal, sx, 0.08, 0.2);
    for (const sz of [-0.9, 1.1]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), metal, sx * 0.85, 0.42, sz, 0, 0, sx * 0.3);
  }
  // Main rotor: mast, hub, four blades, a faint disc for the blur
  mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.6, 8), metal, 0, 3.25, 0.2);
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.55, 0.2);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 5.4), dark);
    blade.position.set(Math.sin((i * Math.PI) / 2) * 2.7, 0, Math.cos((i * Math.PI) / 2) * 2.7);
    blade.rotation.y = (i * Math.PI) / 2;
    rotor.add(blade);
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
  g.add(tail);
  // The red beacon under the belly, and the searchlight
  const beacon = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 2 });
  mesh(new THREE.SphereGeometry(0.11, 8, 6), beacon, 0, 0.7, 0.6);
  mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 10), metal, -0.5, 0.75, -1.4, Math.PI / 2, 0, 0);
  return { group: g, rotor, tail, beacon, hit: new THREE.Vector3(0, 1.7, 0.6) };
}

export class Helicopter {
  readonly group: THREE.Group;
  readonly gunner: Enemy;
  hp = HELI_HP;
  /** 'in': coming in to station; 'fight'; 'down': falling; 'gone'. */
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
    this.group.position.copy(at);
    this.group.rotation.order = 'YXZ';
    scene.add(this.group);
    // The gunner, knelt in the door with a rifle, facing out of it
    const e = new Enemy(new THREE.Vector3(), 0, 61, { name: 'POLICE FORCE AGENT' });
    armWithAK(e);
    e.setKneeling(true);
    e.setAiming(true);
    this.group.add(e.root);
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

  /** Back in the air at `at`, whole, coming in: the same machine for each of them. */
  reset(at: THREE.Vector3): void {
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
    scene.remove(this.group);
  }
}
