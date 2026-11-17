import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * A six-axis robot arm: a bolted base, a turning turret, a shoulder and an
 * elbow with their motor housings, a wrist that pitches and rolls, and a
 * two-fingered gripper; a cable loom running down its back. It works through
 * a program of poses on its own — picking something up, carrying it,
 * setting it down — and can be made to shudder (`agitation`).
 *
 * Built standing at the origin, reaching toward −Z. `style` is the paint:
 * a white lab arm or an orange industrial one.
 */

export interface ArmPose {
  yaw: number;
  sh: number;
  el: number;
  wr: number;
  roll: number;
  /** 0 shut .. 1 open. */
  grip: number;
  /** Something held in the gripper. */
  hold?: boolean;
}

export class RobotArm {
  readonly root = new THREE.Group();
  private turret = new THREE.Group();
  private shoulder = new THREE.Group();
  private elbow = new THREE.Group();
  private wrist = new THREE.Group();
  private rollG = new THREE.Group();
  private fingers: THREE.Object3D[] = [];
  private held: THREE.Object3D;
  private lamp: THREE.MeshStandardMaterial;
  private t = 0;
  /** The pose program it loops through, and how long each move takes. */
  program: ArmPose[];
  moveTime = 1.6;
  hold = 0.5;
  /** 0 calm .. 1 thrashing. */
  agitation = 0;

  constructor(style: 'lab' | 'industrial', program: ArmPose[], s = 1) {
    this.program = program;
    const paint = new THREE.MeshPhysicalMaterial({ color: style === 'lab' ? 0xe8ebea : 0xe0661c, roughness: 0.32, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    const joint = new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.45, metalness: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.3, metalness: 0.85 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.85 });
    this.lamp = new THREE.MeshStandardMaterial({ color: 0x062206, emissive: 0x40ff70, emissiveIntensity: 1.8 });
    const box = (w: number, h: number, d: number, r: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh => {
      const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m);
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    const cyl = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, axis: 'x' | 'y' | 'z' = 'y', seg = 24): THREE.Mesh => {
      const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
      if (axis === 'x') o.rotation.z = Math.PI / 2;
      if (axis === 'z') o.rotation.x = Math.PI / 2;
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    const R = this.root;
    // ---- Base: a plate bolted down, a drum
    cyl(0.15, 0.025, joint, 0, 0.0125, 0, R, 'y', 32);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      cyl(0.012, 0.012, steel, Math.cos(a) * 0.125, 0.03, Math.sin(a) * 0.125, R, 'y', 8);
    }
    cyl(0.11, 0.07, paint, 0, 0.06, 0, R, 'y', 32);
    box(0.05, 0.03, 0.02, 0.008, joint, 0, 0.06, 0.11, R);
    const lampM = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.005), this.lamp);
    lampM.position.set(0, 0.065, 0.122);
    R.add(lampM);
    // ---- Turret
    this.turret.position.y = 0.095;
    R.add(this.turret);
    cyl(0.1, 0.06, joint, 0, 0.03, 0, this.turret, 'y', 32);
    box(0.17, 0.12, 0.14, 0.03, paint, 0, 0.11, 0, this.turret);
    // ---- Shoulder: a motor either side, the upper link rising from it
    this.shoulder.position.y = 0.15;
    this.turret.add(this.shoulder);
    cyl(0.07, 0.22, joint, 0, 0, 0, this.shoulder, 'x');
    for (const sx of [-1, 1]) cyl(0.05, 0.02, steel, sx * 0.12, 0, 0, this.shoulder, 'x');
    box(0.1, 0.36, 0.11, 0.035, paint, 0, 0.18, 0, this.shoulder);
    box(0.104, 0.05, 0.114, 0.02, joint, 0, 0.06, 0, this.shoulder);
    // ---- Elbow
    this.elbow.position.y = 0.36;
    this.shoulder.add(this.elbow);
    cyl(0.06, 0.16, joint, 0, 0, 0, this.elbow, 'x');
    box(0.08, 0.3, 0.085, 0.03, paint, 0, 0.15, 0, this.elbow);
    // ---- Wrist (pitch), roll, gripper
    this.wrist.position.y = 0.3;
    this.elbow.add(this.wrist);
    cyl(0.045, 0.11, joint, 0, 0, 0, this.wrist, 'x');
    this.rollG.position.y = 0.05;
    this.wrist.add(this.rollG);
    cyl(0.04, 0.06, steel, 0, 0.0, 0, this.rollG, 'y');
    box(0.1, 0.04, 0.05, 0.012, joint, 0, 0.045, 0, this.rollG);
    for (const sx of [-1, 1]) {
      const f = new THREE.Group();
      f.position.set(sx * 0.03, 0.06, 0);
      this.rollG.add(f);
      box(0.014, 0.07, 0.03, 0.005, steel, 0, 0.035, 0, f);
      box(0.012, 0.02, 0.032, 0.004, rubber, -sx * 0.006, 0.06, 0, f);
      this.fingers.push(f);
    }
    // What it carries: a sample tube with something glowing in it
    this.held = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 12), new THREE.MeshStandardMaterial({ color: 0x9fd0e0, roughness: 0.1, transparent: true, opacity: 0.5 }));
    const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 10), new THREE.MeshStandardMaterial({ color: 0x103010, emissive: 0x60ff90, emissiveIntensity: 1.6 }));
    fluid.position.y = -0.015;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.015, 12), new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.5 }));
    cap.position.y = 0.05;
    this.held.add(tube, fluid, cap);
    this.held.position.y = 0.08;
    this.held.visible = false;
    this.rollG.add(this.held);
    // ---- The cable loom down its back, in loops between the joints
    const loom = (a: THREE.Vector3, b: THREE.Vector3, sag: THREE.Vector3, parent: THREE.Object3D): void => {
      const mid = a.clone().lerp(b, 0.5).add(sag);
      parent.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 16, 0.012, 6, false), rubber));
    };
    loom(new THREE.Vector3(0, 0.05, 0.07), new THREE.Vector3(0, 0.32, 0.06), new THREE.Vector3(0, 0, 0.04), this.shoulder);
    loom(new THREE.Vector3(0, 0.02, 0.05), new THREE.Vector3(0, 0.26, 0.05), new THREE.Vector3(0, 0, 0.035), this.elbow);
    this.root.scale.setScalar(s);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = false;
    });
    this.apply(program[0]);
  }

  private apply(p: ArmPose): void {
    this.turret.rotation.y = p.yaw;
    this.shoulder.rotation.x = -p.sh;
    this.elbow.rotation.x = -p.el;
    this.wrist.rotation.x = -p.wr;
    this.rollG.rotation.y = p.roll;
    const o = 0.012 * p.grip;
    this.fingers[0].position.x = -0.03 - o;
    this.fingers[1].position.x = 0.03 + o;
    this.held.visible = !!p.hold;
  }

  update(dt: number): void {
    const n = this.program.length;
    const speed = 1 + 3 * this.agitation;
    this.t += dt * speed;
    const leg = this.moveTime + this.hold;
    const i = Math.floor(this.t / leg) % n;
    const u = Math.min(1, (this.t % leg) / this.moveTime);
    const e = u * u * (3 - 2 * u);
    const a = this.program[i];
    const b = this.program[(i + 1) % n];
    const l = (x: number, y: number): number => x + (y - x) * e;
    const j = this.agitation;
    const shake = (k: number): number => j * (Math.sin(this.t * (13 + k)) * 0.15 + (Math.random() - 0.5) * 0.12);
    this.apply({
      yaw: l(a.yaw, b.yaw) + shake(1),
      sh: l(a.sh, b.sh) + shake(2),
      el: l(a.el, b.el) + shake(3),
      wr: l(a.wr, b.wr) + shake(4),
      roll: l(a.roll, b.roll) + shake(5) * 3,
      grip: u < 0.5 ? a.grip : b.grip,
      hold: u < 0.5 ? a.hold : b.hold
    });
    this.lamp.emissive.setHex(j > 0.3 && Math.sin(this.t * 20) > 0 ? 0xff3020 : 0x40ff70);
  }
}
