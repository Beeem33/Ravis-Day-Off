import * as THREE from 'three';

/**
 * Bubbles in the acid lake: glowing green beads coming up off the bottom in
 * wobbling columns, growing as they rise, and bursting when they reach the
 * top (the surface, or the rock where the water runs under the massif).
 * They live in a ring round the player, wherever the water is.
 */
export interface BubbleWater {
  /** Is (x, z) in the water? */
  inWater(x: number, z: number): boolean;
  /** Where a bubble starts (the bed) and where it bursts (the surface, or a roof over the water). */
  bed(x: number, z: number): number;
  top(x: number, z: number): number;
}

const COUNT = 220;

interface Bubble {
  x: number;
  y: number;
  z: number;
  r: number;
  vy: number;
  wob: number;
  top: number;
  /** Bursting: counts up from 0 to 1, then it's reborn. */
  pop: number;
  live: boolean;
}

export class AcidBubbles {
  readonly mesh: THREE.InstancedMesh;
  private bubbles: Bubble[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  /** A few vents where they come up thick and fast, near the player. */
  private vents: { x: number; z: number }[] = [];

  constructor(
    scene: THREE.Scene,
    private water: BubbleWater
  ) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc8ff5a,
      emissive: 0x7aff10,
      emissiveIntensity: 0.9,
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    for (let i = 0; i < COUNT; i++) this.bubbles.push({ x: 0, y: 0, z: 0, r: 0, vy: 0, wob: 0, top: 0, pop: 0, live: false });
  }

  /** `near`: the player. Bubbles are kept within `radius` of him. */
  update(dt: number, near: THREE.Vector3, radius = 34): void {
    // Vents move with him: a handful of spots in the water round about
    if (this.vents.length < 8 || Math.random() < dt * 0.3) {
      for (let k = 0; k < 20 && this.vents.length < 8; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = 3 + Math.random() * radius;
        const x = near.x + Math.cos(a) * d;
        const z = near.z + Math.sin(a) * d;
        if (this.water.inWater(x, z)) this.vents.push({ x, z });
      }
      if (this.vents.length >= 8 && Math.random() < dt * 0.3) this.vents.shift();
    }
    this.vents = this.vents.filter((v) => Math.hypot(v.x - near.x, v.z - near.z) < radius + 8);
    let n = 0;
    for (const b of this.bubbles) {
      if (!b.live) {
        if (!this.spawn(b, near, radius)) continue;
      }
      if (b.pop > 0) {
        b.pop += dt * 6;
        if (b.pop >= 1) {
          b.live = false;
          continue;
        }
      } else {
        b.vy = Math.min(b.vy + dt * 0.9, 0.4 + b.r * 14);
        b.y += b.vy * dt;
        b.r = Math.min(b.r * (1 + dt * 0.2), 0.09);
        b.wob += dt * (3 + b.r * 30);
        if (b.y + b.r >= b.top) {
          b.y = b.top - b.r * 0.4;
          b.pop = 0.001;
        }
        if (Math.hypot(b.x - near.x, b.z - near.z) > radius + 10) {
          b.live = false;
          continue;
        }
      }
      // A bursting one swells and flattens into the surface, then it's gone
      const sw = b.pop > 0 ? 1 + b.pop * 0.5 : 1;
      const fl = b.pop > 0 ? 1 - b.pop * 0.6 : 1;
      this.p.set(b.x + Math.sin(b.wob) * b.r * 0.6, b.y, b.z + Math.cos(b.wob * 1.3) * b.r * 0.6);
      this.s.set(b.r * sw, b.r * fl, b.r * sw);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private spawn(b: Bubble, near: THREE.Vector3, radius: number): boolean {
    let x = 0;
    let z = 0;
    let ok = false;
    // Two in three come up from the vents in strings; the rest anywhere
    if (this.vents.length && Math.random() < 0.66) {
      const v = this.vents[Math.floor(Math.random() * this.vents.length)];
      x = v.x + (Math.random() - 0.5) * 0.4;
      z = v.z + (Math.random() - 0.5) * 0.4;
      ok = true;
    } else {
      for (let k = 0; k < 6 && !ok; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * radius;
        x = near.x + Math.cos(a) * d;
        z = near.z + Math.sin(a) * d;
        ok = this.water.inWater(x, z);
      }
    }
    if (!ok) return false;
    const bed = this.water.bed(x, z);
    b.top = this.water.top(x, z);
    if (b.top - bed < 0.3) return false;
    b.x = x;
    b.z = z;
    b.y = bed + Math.random() * (b.top - bed) * 0.8;
    b.r = 0.02 + Math.random() * 0.04;
    b.vy = 0.2;
    b.wob = Math.random() * 6;
    b.pop = 0;
    b.live = true;
    return true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
