import * as THREE from 'three';

const SEGMENTS = 7;

interface Arc {
  segs: THREE.Mesh[];
  life: number;
  rejitter: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

/**
 * Electric arcs skittering across the water.
 *
 * Each is a zig-zag of thin additive segments between two points a short way
 * apart on the surface, lifted a little off it in the middle. They live for a
 * tenth of a second or so and re-draw their path a few times while they do,
 * which is what makes them read as current rather than as a drawn line.
 *
 * Everything is built up front and shown or hidden; nothing is created while
 * the level is running.
 */
export class ElectricArcs {
  private arcs: Arc[] = [];
  private mat: THREE.MeshBasicMaterial;
  private tmp = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private dir = new THREE.Vector3();

  constructor(scene: THREE.Scene, count = 6) {
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xbff4ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    // Thick enough to register from the far ledge, which is where it has to
    // warn you from; at 18mm they were specks at any distance.
    const geo = new THREE.BoxGeometry(0.032, 1, 0.032);
    for (let i = 0; i < count; i++) {
      const segs: THREE.Mesh[] = [];
      for (let k = 0; k < SEGMENTS; k++) {
        const m = new THREE.Mesh(geo, this.mat);
        m.visible = false;
        m.frustumCulled = false;
        scene.add(m);
        segs.push(m);
      }
      this.arcs.push({ segs, life: 0, rejitter: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
  }

  /** Throw an arc from `at` in a random direction. Returns false if all are busy. */
  strike(at: THREE.Vector3): boolean {
    const a = this.arcs.find((x) => x.life <= 0);
    if (!a) return false;
    const ang = Math.random() * Math.PI * 2;
    const len = 0.7 + Math.random() * 1.1;
    a.from.copy(at);
    a.to.set(at.x + Math.cos(ang) * len, at.y, at.z + Math.sin(ang) * len);
    a.life = 0.07 + Math.random() * 0.1;
    a.rejitter = 0;
    this.layout(a);
    return true;
  }

  /** Draw an arc's path anew: same ends, a fresh zig-zag between them. */
  private layout(a: Arc): void {
    const pts: THREE.Vector3[] = [];
    this.dir.copy(a.to).sub(a.from);
    const side = this.tmp.set(-this.dir.z, 0, this.dir.x).normalize();
    for (let k = 0; k <= SEGMENTS; k++) {
      const t = k / SEGMENTS;
      const p = a.from.clone().lerp(a.to, t);
      if (k > 0 && k < SEGMENTS) {
        const bow = Math.sin(t * Math.PI);
        p.y += bow * (0.08 + Math.random() * 0.24);
        p.addScaledVector(side, (Math.random() - 0.5) * 0.24 * bow);
      }
      pts.push(p);
    }
    for (let k = 0; k < SEGMENTS; k++) {
      const s = a.segs[k];
      const p0 = pts[k];
      const p1 = pts[k + 1];
      const d = new THREE.Vector3().subVectors(p1, p0);
      const len = d.length();
      s.position.copy(p0).addScaledVector(d, 0.5);
      s.scale.set(1, Math.max(0.001, len), 1);
      s.quaternion.setFromUnitVectors(this.up, d.normalize());
      s.visible = true;
    }
  }

  /** Age the arcs. Returns how many are alight, for the light over the water. */
  update(dt: number): number {
    let live = 0;
    for (const a of this.arcs) {
      if (a.life <= 0) continue;
      a.life -= dt;
      if (a.life <= 0) {
        for (const s of a.segs) s.visible = false;
        continue;
      }
      live++;
      a.rejitter -= dt;
      if (a.rejitter <= 0) {
        a.rejitter = 0.025 + Math.random() * 0.02;
        this.layout(a);
      }
    }
    return live;
  }

  dispose(): void {
    for (const a of this.arcs) for (const s of a.segs) s.removeFromParent();
    this.arcs.length = 0;
  }
}
