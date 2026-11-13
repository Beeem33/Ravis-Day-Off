import * as THREE from 'three';
import type { CarRig } from '../scenes/Level8Contracts';

/**
 * CabinJunk — the rubbish of a man who lives in his car: fries and a burger
 * wrapper on the passenger seat, papers, his phone on the console, shades
 * on the dash, a water bottle and a can in the footwell, a tissue box and a
 * gym bag on the back seat, a few coins.
 *
 * Still while he drives. When the car's blown off its wheels (loosen()),
 * it all comes free and goes where the car throws it: gravity and the car's
 * own lurches worked out in the car's frame, so as it rolls over the lot
 * tumbles round the cabin, bangs off the glass and the roof, and ends up
 * lying on the headliner when it's upside down.
 *
 * Car-local (the rig's group frame: forward −Z, the driver's side −X),
 * hung off the body like the interior.
 */

interface Item {
  mesh: THREE.Object3D;
  /** Where it is in the cabin, the group's frame; how fast it's going there; how it's turning. */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  /** Roughly how far it sticks out from its middle (for the walls). */
  r: number;
}

/** The inside of the cabin, as a box (group frame): what the junk bounces round in. */
const MIN = new THREE.Vector3(-0.72, 0.27, -0.5);
const MAX = new THREE.Vector3(0.72, 1.38, 1.85);

const M = (color: number, rough = 0.7, metal = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

export class CabinJunk {
  private readonly items: Item[] = [];
  private readonly group = new THREE.Group();
  private loose = false;
  private readonly prevVel = new THREE.Vector3();
  private readonly prevQ = new THREE.Quaternion();
  private hasPrev = false;
  /** His head, in the cabin: kept clear, so nothing ends up filling his eyes (keepClear()). */
  private readonly head = new THREE.Vector3(-0.36, 1.1, 0.35);
  private headR = 0;

  constructor(private readonly rig: CarRig) {
    this.group.position.y = -rig.body.position.y;
    rig.body.add(this.group);
    const box = (w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const cyl = (r: number, h: number, mat: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat);
    const paper = M(0xe9e6dc, 0.95);
    const add = (mesh: THREE.Object3D, x: number, y: number, z: number, ry = 0, r = 0.08): void => {
      mesh.rotation.y = ry;
      this.group.add(mesh);
      this.items.push({ mesh, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), spin: new THREE.Vector3(), r });
    };
    // On the passenger seat: a box of fries, a burger wrapper, a sheaf of papers
    const fries = new THREE.Group();
    fries.add(box(0.1, 0.11, 0.06, M(0xc8231d, 0.6)));
    for (let i = 0; i < 6; i++) {
      const f = box(0.012, 0.07, 0.012, M(0xf2c14e, 0.8));
      f.position.set(-0.035 + i * 0.014, 0.075, (i % 2) * 0.012 - 0.006);
      f.rotation.z = (i - 2.5) * 0.08;
      fries.add(f);
    }
    add(fries, 0.33, 0.55, 0.33, 0.4, 0.08);
    add(box(0.13, 0.012, 0.12, M(0xe8c24a, 0.85)), 0.47, 0.5, 0.48, 0.9, 0.08);
    add(box(0.21, 0.004, 0.29, paper), 0.38, 0.5, 0.52, -0.3, 0.15);
    add(box(0.21, 0.004, 0.29, paper), 0.42, 0.505, 0.5, 0.2, 0.15);
    // On the dash: his shades, a parking ticket
    const shades = new THREE.Group();
    for (const s of [-1, 1]) {
      const lens = box(0.05, 0.035, 0.008, M(0x0b0b0d, 0.15, 0.6));
      lens.position.x = s * 0.032;
      shades.add(lens);
    }
    shades.add(box(0.13, 0.008, 0.008, M(0x111111, 0.4)));
    add(shades, 0.28, 0.99, -0.36, 0.3, 0.07);
    add(box(0.09, 0.003, 0.16, M(0xf4ee9a, 0.9)), 0.05, 0.98, -0.42, 0.6, 0.09);
    // On the console: his phone, some coins
    add(box(0.075, 0.009, 0.15, M(0x101114, 0.3, 0.3)), 0.0, 0.575, 0.48, 0.15, 0.08);
    for (let i = 0; i < 4; i++) add(cyl(0.012, 0.003, M(0xc9a54a, 0.35, 0.8)), -0.04 + i * 0.025, 0.57, 0.62 + (i % 2) * 0.02, 0, 0.02);
    // In the passenger footwell: a water bottle, a can of Deadbull
    const bottle = cyl(0.034, 0.21, new THREE.MeshStandardMaterial({ color: 0xa8d0e6, roughness: 0.15, transparent: true, opacity: 0.7 }));
    bottle.rotation.z = Math.PI / 2;
    const bottleG = new THREE.Group();
    bottleG.add(bottle);
    add(bottleG, 0.36, 0.29, -0.12, 0.6, 0.11);
    const can = cyl(0.033, 0.12, M(0xb8bcc2, 0.3, 0.7));
    const band = cyl(0.0335, 0.04, M(0xc81e1e, 0.5));
    const canG = new THREE.Group();
    canG.add(can, band);
    canG.rotation.x = Math.PI / 2;
    const canW = new THREE.Group();
    canW.add(canG);
    add(canW, 0.52, 0.29, 0.02, 1.1, 0.07);
    // On the back seat: a tissue box, his gym bag, a hoodie
    add(box(0.22, 0.09, 0.12, M(0x6fa0c8, 0.8)), -0.32, 0.54, 1.25, 0.3, 0.12);
    add(box(0.48, 0.24, 0.26, M(0x22252b, 0.9)), 0.25, 0.62, 1.28, -0.2, 0.26);
    add(box(0.36, 0.06, 0.3, M(0x7a2f2f, 1)), -0.05, 0.52, 1.35, 0.5, 0.2);
    // And the rest of it, everywhere: a coffee cup, receipts and napkins, a pen, his keys, a CD, a cassette, a lighter, more fries
    const cup = new THREE.Group();
    const cupBody = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.032, 0.13, 12), M(0xf3efe6, 0.8));
    const lid = cyl(0.044, 0.014, M(0x2a2a2a, 0.5));
    lid.position.y = 0.07;
    const sleeve = cyl(0.04, 0.05, M(0x8a5a33, 0.9));
    cup.add(cupBody, lid, sleeve);
    add(cup, 0.12, 0.6, 0.15, 0, 0.08);
    const papers = [0xe9e6dc, 0xf7f3e8, 0xfafafa, 0xf4ee9a, 0xffffff, 0xdfe8f0];
    for (let i = 0; i < 9; i++) {
      const w = 0.07 + (i % 3) * 0.04;
      add(box(w, 0.003, w * (1.3 + (i % 2) * 0.6), M(papers[i % papers.length], 0.95)), -0.5 + (i % 5) * 0.25, 0.3 + (i % 3) * 0.25, -0.2 + i * 0.17, i * 0.7, 0.06);
    }
    add(cyl(0.005, 0.14, M(0x1d3fa8, 0.4)), 0.15, 0.97, -0.3, 1.2, 0.06);
    const keys = new THREE.Group();
    keys.add(new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.003, 6, 14), M(0xbfc3c8, 0.3, 0.9)));
    for (let i = 0; i < 3; i++) {
      const k = box(0.012, 0.05, 0.003, M(0xc9b27a, 0.3, 0.9));
      k.position.set(-0.012 + i * 0.012, -0.035, 0);
      k.rotation.z = (i - 1) * 0.35;
      keys.add(k);
    }
    add(keys, 0.02, 0.58, 0.3, 0, 0.04);
    add(box(0.12, 0.01, 0.12, M(0x9fd0ff, 0.2, 0.4)), 0.3, 0.52, 0.2, 0.3, 0.08);
    add(box(0.1, 0.016, 0.064, M(0x222222, 0.5)), 0.4, 0.3, 0.3, 0.9, 0.06);
    add(box(0.022, 0.07, 0.012, M(0xd0262d, 0.4)), 0.2, 0.3, -0.05, 0.2, 0.04);
    for (let i = 0; i < 7; i++) add(box(0.01, 0.065, 0.01, M(0xf2c14e, 0.8)), 0.25 + (i % 3) * 0.05, 0.5, 0.25 + i * 0.03, i, 0.03);
    for (const it of this.items) this.place(it);
  }

  /** Nothing comes within `r` of `center` (the cabin's frame): where the driver's head is. */
  keepClear(center: THREE.Vector3, r: number): void {
    this.head.copy(center);
    this.headR = r;
  }

  /** Blown loose: everything comes free with a kick of its own. */
  loosen(): void {
    if (this.loose) return;
    this.loose = true;
    this.hasPrev = false;
    for (const it of this.items) {
      // Thrown up out of where it lay, and most of it in toward the front of the cabin, past his face
      const tx = -0.45 + Math.random() * 0.9;
      const ty = 0.75 + Math.random() * 0.5;
      const tz = -0.35 + Math.random() * 0.75;
      const T = 0.35 + Math.random() * 0.4;
      it.vel.set((tx - it.pos.x) / T + (Math.random() - 0.5) * 1.5, (ty - it.pos.y) / T + 1 + Math.random() * 1.5, (tz - it.pos.z) / T + (Math.random() - 0.5) * 1.5);
      it.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    }
  }

  /** A hard bang (the roof hitting the road): it all jumps. */
  jolt(k = 1): void {
    if (!this.loose) return;
    for (const it of this.items) {
      it.vel.x += (Math.random() - 0.5) * 3 * k;
      it.vel.y += (Math.random() - 0.5) * 3 * k;
      it.vel.z += (Math.random() - 0.5) * 3 * k;
      it.spin.multiplyScalar(1.5);
    }
  }

  /**
   * A step of the junk inside a car turned `q` (the group's world rotation)
   * and going `carVel` (world): gravity, and the push back from the car
   * speeding up or slowing, both in the car's own frame.
   */
  update(dt: number, q: THREE.Quaternion, carVel: THREE.Vector3): void {
    if (!this.loose || !(dt > 0)) return;
    const inv = _q.copy(q).invert();
    // The car's acceleration (world): it's what everything inside it is left behind by
    if (!this.hasPrev) {
      this.prevVel.copy(carVel);
      this.prevQ.copy(q);
      this.hasPrev = true;
    }
    // The car turning round it: what's loose stays going the way it was going, so as the car
    // rolls the cabin turns past everything in it (and its walls come round into it)
    const turn = _t.copy(inv).multiply(this.prevQ);
    this.prevQ.copy(q);
    const acc = _a.subVectors(carVel, this.prevVel).divideScalar(dt);
    this.prevVel.copy(carVel);
    acc.clampLength(0, 60);
    const g = _g.set(0, -9.8, 0).sub(acc).applyQuaternion(inv);
    for (const it of this.items) {
      it.pos.sub(_c).applyQuaternion(turn).add(_c);
      it.vel.applyQuaternion(turn);
      it.vel.addScaledVector(g, dt);
      it.pos.addScaledVector(it.vel, dt);
      // Off the cabin's sides, floor and roof: a dull bounce, and it scrubs speed off along them
      for (const ax of ['x', 'y', 'z'] as const) {
        const lo = MIN[ax] + it.r * 0.5;
        const hi = MAX[ax] - it.r * 0.5;
        if (it.pos[ax] < lo || it.pos[ax] > hi) {
          it.pos[ax] = THREE.MathUtils.clamp(it.pos[ax], lo, hi);
          it.vel[ax] *= -0.32;
          for (const o of ['x', 'y', 'z'] as const) if (o !== ax) it.vel[o] *= 0.82;
          it.spin.multiplyScalar(0.7);
        }
      }
      // Off his head, the same
      if (this.headR > 0) {
        const off = _a.subVectors(it.pos, this.head);
        const min = this.headR + it.r * 0.6;
        const dd = off.length();
        if (dd < min) {
          if (dd < 1e-4) off.set(1, 0, 0);
          off.normalize();
          it.pos.copy(this.head).addScaledVector(off, min);
          const vn = it.vel.dot(off);
          if (vn < 0) it.vel.addScaledVector(off, -1.4 * vn);
        }
      }
      it.mesh.rotation.x += it.spin.x * dt;
      it.mesh.rotation.y += it.spin.y * dt;
      it.mesh.rotation.z += it.spin.z * dt;
      it.spin.multiplyScalar(Math.exp(-dt * 0.8));
      this.place(it);
    }
  }

  private place(it: Item): void {
    it.mesh.position.copy(it.pos);
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

const _q = new THREE.Quaternion();
const _t = new THREE.Quaternion();
/** The middle of the cabin: what it turns about as the car rolls. */
const _c = new THREE.Vector3(0, 0.8, 0.6);
const _a = new THREE.Vector3();
const _g = new THREE.Vector3();
