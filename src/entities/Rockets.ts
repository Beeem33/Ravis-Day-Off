import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ParticleManager } from '../fx/ParticleManager';

/**
 * The General's rockets in flight: straight and fast, twenty-odd in the air
 * through one sweep. Every body is one draw and every flame another
 * (instanced; the spares sit parked out of sight rather than the count going
 * to zero, so the warm-up's throwaway frame compiles them). What a flight
 * runs into is the scene's to say (`hit`), and what a rocket going off does
 * (`onBurst`); the ground, and running out of fuel, are handled here.
 */

const POOL = 40;
/** Seconds of fuel: one that has met nothing by then goes off where it is. */
const LIFE = 4;
const FWD = new THREE.Vector3(0, 0, 1);
const PARK = new THREE.Matrix4().compose(new THREE.Vector3(0, -300, 0), new THREE.Quaternion(), new THREE.Vector3(1e-4, 1e-4, 1e-4));

interface Rocket {
  alive: boolean;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  age: number;
}

/** Where a flight a→b first meets something: how far along it (0..1), and whether that was Ravi himself. */
export type RocketHitTest = (a: THREE.Vector3, b: THREE.Vector3) => { t: number; direct: boolean } | null;

export class Rockets {
  /** A rocket has gone off at `pos`, flying along `dir`; `direct` if it hit Ravi himself. */
  onBurst: ((pos: THREE.Vector3, dir: THREE.Vector3, direct: boolean) => void) | null = null;

  private readonly list: Rocket[] = [];
  private readonly bodies: THREE.InstancedMesh;
  private readonly flames: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private flicker = 0;

  constructor(
    private scene: THREE.Scene,
    private particles: ParticleManager,
    private hit: RocketHitTest
  ) {
    // The rocket, nose toward +Z: a body, a nose cone, four fins at the tail
    const body = new THREE.CylinderGeometry(0.065, 0.065, 0.6, 10);
    body.rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.065, 0.2, 10);
    nose.rotateX(Math.PI / 2);
    nose.translate(0, 0, 0.4);
    const parts: THREE.BufferGeometry[] = [body, nose];
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.BoxGeometry(0.012, 0.11, 0.15);
      fin.translate(0, 0.1, -0.24);
      fin.rotateZ((i * Math.PI) / 2 + Math.PI / 4);
      parts.push(fin);
    }
    const geo = mergeGeometries(parts.map((g) => g.toNonIndexed())) ?? body;
    for (const g of parts) if (g !== geo) g.dispose();
    this.bodies = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x5b6148, roughness: 0.6, metalness: 0.25 }), POOL);
    // The motor's flame out of the tail, white at the root
    const flame = new THREE.ConeGeometry(0.075, 0.6, 8, 1, true);
    flame.rotateX(-Math.PI / 2);
    flame.translate(0, 0, -0.3);
    this.flames = new THREE.InstancedMesh(
      flame,
      new THREE.MeshBasicMaterial({
        color: 0xffb35a,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false
      }),
      POOL
    );
    for (const im of [this.bodies, this.flames]) {
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < POOL; i++) im.setMatrixAt(i, PARK);
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
    }
    for (let i = 0; i < POOL; i++) {
      this.list.push({ alive: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), speed: 0, age: 0 });
    }
  }

  /** Away it goes, from `pos` along `dir` (unit) at `speed` m/s. With every one in the air, the oldest goes off early. */
  fire(pos: THREE.Vector3, dir: THREE.Vector3, speed: number): void {
    let i = this.list.findIndex((r) => !r.alive);
    if (i < 0) {
      i = 0;
      for (let k = 1; k < POOL; k++) if (this.list[k].age > this.list[i].age) i = k;
      this.burst(i, this.list[i].pos, false);
    }
    const r = this.list[i];
    r.alive = true;
    r.pos.copy(pos);
    r.dir.copy(dir).normalize();
    r.speed = speed;
    r.age = 0;
    this.place(i);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.flicker += dt;
    let moved = false;
    for (let i = 0; i < POOL; i++) {
      const r = this.list[i];
      if (!r.alive) continue;
      moved = true;
      r.age += dt;
      const a = this.a.copy(r.pos);
      const b = this.b.copy(r.pos).addScaledVector(r.dir, r.speed * dt);
      // Into the ground, or into whatever the scene says is in the way first
      let t = 2;
      let direct = false;
      if (b.y < 0.03) t = a.y > 0.03 ? (a.y - 0.03) / (a.y - b.y) : 0;
      const h = this.hit(a, b);
      if (h && h.t < t) {
        t = h.t;
        direct = h.direct;
      }
      if (t <= 1) {
        this.burst(i, a.lerp(b, Math.max(0, t)), direct);
        continue;
      }
      r.pos.copy(b);
      if (r.age > LIFE) {
        this.burst(i, r.pos, false);
        continue;
      }
      this.particles.rocketTrail(r.pos, r.dir, r.speed * dt);
      this.place(i);
    }
    if (moved) {
      this.bodies.instanceMatrix.needsUpdate = true;
      this.flames.instanceMatrix.needsUpdate = true;
    }
  }

  /** Every rocket gone, nothing going off (a restart). */
  clear(): void {
    for (let i = 0; i < POOL; i++) {
      this.list[i].alive = false;
      this.bodies.setMatrixAt(i, PARK);
      this.flames.setMatrixAt(i, PARK);
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.flames.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const im of [this.bodies, this.flames]) {
      this.scene.remove(im);
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      im.dispose();
    }
    this.onBurst = null;
  }

  private place(i: number): void {
    const r = this.list[i];
    this.q.setFromUnitVectors(FWD, r.dir);
    this.m.compose(r.pos, this.q, this.one);
    this.bodies.setMatrixAt(i, this.m);
    // The flame, from the tail, flickering in length
    const f = 0.8 + 0.35 * Math.abs(Math.sin(this.flicker * 47 + i * 1.7));
    this.b.copy(r.pos).addScaledVector(r.dir, -0.3);
    this.m.compose(this.b, this.q, this.a.set(1, 1, f));
    this.flames.setMatrixAt(i, this.m);
  }

  private burst(i: number, at: THREE.Vector3, direct: boolean): void {
    const r = this.list[i];
    r.alive = false;
    this.bodies.setMatrixAt(i, PARK);
    this.flames.setMatrixAt(i, PARK);
    this.bodies.instanceMatrix.needsUpdate = true;
    this.flames.instanceMatrix.needsUpdate = true;
    this.onBurst?.(at.clone(), r.dir.clone(), direct);
  }
}
