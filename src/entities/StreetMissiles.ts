import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ParticleManager } from '../fx/ParticleManager';

/**
 * The boss's man's missiles, fired back out of the passenger window at the
 * Civic coming up behind. Each is aimed at where Ravi will be in `T`
 * seconds — his lane, that far up the road at his speed — and a red ring
 * goes down on the road there the moment it leaves the tube, a column of
 * red light standing up out of it so it reads from far up the road: that
 * is the warning. It flies straight to the ring and goes off on it, or on
 * anything it meets on the way. Ravi in the ring, or in its path, is dead.
 *
 * One draw for the bodies, one for the flames, one for the rings, one for
 * the columns; the
 * spares sit parked, never a count of zero, so the warm-up compiles them.
 */

const POOL = 12;
const FWD = new THREE.Vector3(0, 0, 1);
const PARK = new THREE.Matrix4().compose(new THREE.Vector3(0, -300, 0), new THREE.Quaternion(), new THREE.Vector3(1e-4, 1e-4, 1e-4));

interface Missile {
  alive: boolean;
  from: THREE.Vector3;
  aim: THREE.Vector3;
  pos: THREE.Vector3;
  /** Its nose: toward where it is going as Ravi sees it. */
  dir: THREE.Vector3;
  t: number;
  T: number;
}

/** What a missile can hit on its way: Ravi's car, a traffic car (its id), or nothing. */
export type MissileHit = { kind: 'ravi' } | { kind: 'car'; id: number } | null;

export class StreetMissiles {
  /** It went off at `pos`: on Ravi, on a car, or on the road at its ring. */
  onBurst: ((pos: THREE.Vector3, hit: MissileHit) => void) | null = null;

  private readonly list: Missile[] = [];
  private readonly bodies: THREE.InstancedMesh;
  private readonly flames: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly beams: THREE.InstancedMesh;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private t = 0;

  constructor(
    private scene: THREE.Scene,
    private particles: ParticleManager
  ) {
    const body = new THREE.CylinderGeometry(0.075, 0.075, 0.9, 10);
    body.rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.075, 0.25, 10);
    nose.rotateX(Math.PI / 2);
    nose.translate(0, 0, 0.57);
    const parts: THREE.BufferGeometry[] = [body, nose];
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.BoxGeometry(0.012, 0.14, 0.18);
      fin.translate(0, 0.12, -0.36);
      fin.rotateZ((i * Math.PI) / 2 + Math.PI / 4);
      parts.push(fin);
    }
    const geo = mergeGeometries(parts.map((g) => g.toNonIndexed())) ?? body;
    this.bodies = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.3 }), POOL);
    const flame = new THREE.ConeGeometry(0.1, 0.8, 8, 1, true);
    flame.rotateX(-Math.PI / 2);
    flame.translate(0, 0, -0.4);
    this.flames = new THREE.InstancedMesh(
      flame,
      new THREE.MeshBasicMaterial({ color: 0xffb35a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }),
      POOL
    );
    // The ring: a bold outer band, a thin inner one and a dot, flat on the road
    const outer = new THREE.RingGeometry(0.82, 1, 48, 1);
    const inner = new THREE.RingGeometry(0.4, 0.47, 32, 1);
    const dot = new THREE.CircleGeometry(0.1, 16);
    const ringGeo = mergeGeometries([outer, inner, dot]) ?? outer;
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xff2a1a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
    this.rings = new THREE.InstancedMesh(ringGeo, this.ringMat, POOL);
    // The column: an open tube of red light off the ring, solid at the road and gone by the top
    const beam = new THREE.CylinderGeometry(1, 1, 8, 20, 1, true);
    beam.translate(0, 4, 0);
    const pos = beam.getAttribute('position');
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      col.set([1, 0.09, 0.05, 0.75 * (1 - pos.getY(i) / 8)], i * 4);
    }
    beam.setAttribute('color', new THREE.BufferAttribute(col, 4));
    this.beamMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false
    });
    this.beams = new THREE.InstancedMesh(beam, this.beamMat, POOL);
    for (const im of [this.bodies, this.flames, this.rings, this.beams]) {
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < POOL; i++) im.setMatrixAt(i, PARK);
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
    }
    this.rings.renderOrder = 2;
    for (let i = 0; i < POOL; i++) {
      this.list.push({ alive: false, from: new THREE.Vector3(), aim: new THREE.Vector3(), pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), t: 0, T: 1 });
    }
  }

  get flying(): number {
    let n = 0;
    for (const m of this.list) if (m.alive) n++;
    return n;
  }

  /** Away from `from`, to come down on `aim` (on the road) in `T` seconds. */
  fire(from: THREE.Vector3, aim: THREE.Vector3, T: number): void {
    const i = this.list.findIndex((m) => !m.alive);
    if (i < 0) return;
    const m = this.list[i];
    m.alive = true;
    m.from.copy(from);
    m.aim.copy(aim);
    m.pos.copy(from);
    m.t = 0;
    m.T = T;
  }

  /**
   * One step. `ravi`: his car's middle, heading and half size, and his
   * velocity (to point the noses the way he sees them come); `hitTest` says
   * what a missile at a point is touching.
   */
  update(dt: number, raviVel: THREE.Vector3, hitTest: (p: THREE.Vector3) => MissileHit): void {
    if (dt <= 0) return;
    this.t += dt;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 22);
    this.ringMat.opacity = 0.55 + 0.4 * pulse;
    this.beamMat.opacity = 0.6 + 0.3 * pulse;
    for (let i = 0; i < POOL; i++) {
      const m = this.list[i];
      if (!m.alive) continue;
      m.t += dt;
      const k = Math.min(1, m.t / m.T);
      const prev = this.a.copy(m.pos);
      m.pos.lerpVectors(m.from, m.aim, k);
      // A little arc up off the launcher and down onto the ring
      m.pos.y += Math.sin(Math.PI * k) * 0.8;
      // Its nose: the way it is going, as seen from a car doing Ravi's speed
      const v = this.b.copy(m.pos).sub(prev).divideScalar(dt).sub(raviVel);
      if (v.lengthSq() > 1e-4) m.dir.copy(v).normalize();
      // What it meets on the way, checked along this step's flight
      let hit: MissileHit = null;
      for (let j = 1; j <= 3 && !hit; j++) {
        hit = hitTest(this.s.lerpVectors(prev, m.pos, j / 3));
        if (hit) m.pos.copy(this.s);
      }
      if (hit || k >= 1) {
        this.burst(i, hit);
        continue;
      }
      this.particles.rocketTrail(m.pos, m.dir, m.pos.distanceTo(prev));
      this.place(i);
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.flames.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
  }

  /** Every missile gone, nothing going off. */
  clear(): void {
    for (let i = 0; i < POOL; i++) {
      this.list[i].alive = false;
      this.park(i);
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.flames.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const im of [this.bodies, this.flames, this.rings, this.beams]) {
      this.scene.remove(im);
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      im.dispose();
    }
    this.onBurst = null;
  }

  private place(i: number): void {
    const m = this.list[i];
    this.q.setFromUnitVectors(FWD, m.dir);
    this.m.compose(m.pos, this.q, this.s.set(1, 1, 1));
    this.bodies.setMatrixAt(i, this.m);
    const f = 0.8 + 0.4 * Math.abs(Math.sin(this.t * 51 + i));
    this.m.compose(this.a.copy(m.pos).addScaledVector(m.dir, -0.45), this.q, this.s.set(1, 1, f));
    this.flames.setMatrixAt(i, this.m);
    // The ring where it will come down, a car's length across
    const r = 2.3 + 0.15 * Math.sin(this.t * 22 + i);
    this.m.compose(this.a.copy(m.aim).setY(m.aim.y - 0.45), this.q.identity(), this.s.set(r, 1, r));
    this.rings.setMatrixAt(i, this.m);
    // Narrow, and sinking into the ring as the missile comes down on it
    const k = Math.min(1, m.t / m.T);
    this.s.set(r * 0.3, Math.max(0.05, 1 - k * k), r * 0.3);
    this.m.compose(this.a, this.q, this.s);
    this.beams.setMatrixAt(i, this.m);
  }

  private park(i: number): void {
    this.bodies.setMatrixAt(i, PARK);
    this.flames.setMatrixAt(i, PARK);
    this.rings.setMatrixAt(i, PARK);
    this.beams.setMatrixAt(i, PARK);
  }

  private burst(i: number, hit: MissileHit): void {
    const m = this.list[i];
    m.alive = false;
    this.park(i);
    this.onBurst?.(m.pos.clone(), hit);
  }
}
