import * as THREE from 'three';

export type DecalKind = 'blood' | 'bullethole' | 'pool';

interface Drip {
  mesh: THREE.Mesh;
  bead: THREE.Mesh;
  length: number;
  maxLength: number;
  speed: number;
  life: number;
}

interface Growing {
  mesh: THREE.Mesh;
  target: THREE.Vector3; // final scale
  t: number;
  duration: number;
}

/**
 * BloodDecalSystem — projects splatter/bullet-hole quads onto surfaces.
 * Textures are generated procedurally on canvases; decals live in a pool
 * and the oldest are recycled once the cap is reached. Decals are clipped
 * to the face they land on (no overhang into doorways), wall splatter
 * grows slow drips, and pools spread out over a few seconds.
 */
export class BloodDecalSystem {
  private bloodMats: THREE.MeshBasicMaterial[] = [];
  private poolMats: THREE.MeshBasicMaterial[] = [];
  private holeMat!: THREE.MeshBasicMaterial;
  private dripMat: THREE.MeshBasicMaterial;
  private decals: THREE.Mesh[] = [];
  private drips: Drip[] = [];
  private growing: Growing[] = [];
  private geo = new THREE.PlaneGeometry(1, 1);
  private dripGeo: THREE.PlaneGeometry;
  private max = 900; // blood stays for the whole shift; only the very oldest is recycled past this
  private maxDrips = 300;

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < 4; i++) this.bloodMats.push(this.makeMaterial(this.drawSplatter(i * 7 + 1, false)));
    for (let i = 0; i < 2; i++) this.poolMats.push(this.makeMaterial(this.drawSplatter(i * 13 + 3, true)));
    this.holeMat = this.makeMaterial(this.drawBulletHole());
    this.dripMat = new THREE.MeshBasicMaterial({
      color: 0x5a0a0c,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide
    });
    // Drip strip anchored at its TOP so scaling Y grows it downward
    this.dripGeo = new THREE.PlaneGeometry(1, 1);
    this.dripGeo.translate(0, -0.5, 0);
  }

  private makeMaterial(canvas: HTMLCanvasElement): THREE.MeshBasicMaterial {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide
    });
  }

  /** Seeded-ish random splatter blob painting. */
  private drawSplatter(seed: number, pool: boolean): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    let s = seed;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return (s % 1000) / 1000;
    };
    const cx = 64;
    const cy = 64;
    const blobs = pool ? 14 : 22;
    for (let i = 0; i < blobs; i++) {
      const ang = rnd() * Math.PI * 2;
      const dist = pool ? rnd() * 26 : Math.pow(rnd(), 1.6) * 52;
      const r = pool ? 12 + rnd() * 22 : 2 + rnd() * 11 * (1 - dist / 70);
      const x = cx + Math.cos(ang) * dist;
      const y = cy + Math.sin(ang) * dist;
      const shade = 30 + rnd() * 60;
      g.fillStyle = `rgba(${110 + shade}, ${6 + rnd() * 12}, ${8 + rnd() * 10}, ${pool ? 0.85 : 0.55 + rnd() * 0.4})`;
      g.beginPath();
      g.ellipse(x, y, r, r * (0.5 + rnd() * 0.7), ang, 0, Math.PI * 2);
      g.fill();
    }
    if (!pool) {
      for (let i = 0; i < 6; i++) {
        const ang = rnd() * Math.PI * 2;
        g.strokeStyle = `rgba(${120 + rnd() * 50}, 8, 10, ${0.5 + rnd() * 0.3})`;
        g.lineWidth = 1 + rnd() * 2.5;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(ang) * (30 + rnd() * 32), cy + Math.sin(ang) * (30 + rnd() * 32));
        g.stroke();
      }
    }
    return c;
  }

  private drawBulletHole(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 1, 32, 32, 30);
    grad.addColorStop(0, 'rgba(10,8,6,0.95)');
    grad.addColorStop(0.25, 'rgba(28,24,20,0.8)');
    grad.addColorStop(0.6, 'rgba(60,55,48,0.28)');
    grad.addColorStop(1, 'rgba(60,55,48,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(20,17,14,0.6)';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Math.random();
      g.beginPath();
      g.moveTo(32 + Math.cos(a) * 5, 32 + Math.sin(a) * 5);
      g.lineTo(32 + Math.cos(a) * (12 + Math.random() * 10), 32 + Math.sin(a) * (12 + Math.random() * 10));
      g.stroke();
    }
    return c;
  }

  /**
   * Clip a decal's footprint to the face of the surface it's on, so it
   * can't hang past a wall's end into a doorway or off a desk edge.
   * Surfaces are axis-aligned boxes, so the face rectangle comes straight
   * from the object's world bounding box.
   */
  private clipToSurface(mesh: THREE.Mesh, n: THREE.Vector3, surface: THREE.Object3D, sx: number, sy: number): boolean {
    const box = new THREE.Box3().setFromObject(surface);
    if (box.isEmpty()) return true;
    // Face tangent axes
    const u = Math.abs(n.y) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    u.crossVectors(v, n).normalize();
    const extent = (axis: THREE.Vector3): [number, number] => {
      const c = new THREE.Vector3();
      box.getCenter(c);
      const size = new THREE.Vector3();
      box.getSize(size);
      const half = Math.abs(axis.x) * size.x / 2 + Math.abs(axis.y) * size.y / 2 + Math.abs(axis.z) * size.z / 2;
      const center = axis.dot(c);
      return [center - half, center + half];
    };
    const [u0, u1] = extent(u);
    const [v0, v1] = extent(v);
    // Decal's footprint radius along u/v given its in-plane rotation
    const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
    const hu = Math.abs(localX.dot(u)) * sx / 2 + Math.abs(localY.dot(u)) * sy / 2;
    const hv = Math.abs(localX.dot(v)) * sx / 2 + Math.abs(localY.dot(v)) * sy / 2;
    const faceU = u1 - u0;
    const faceV = v1 - v0;
    if (faceU < 0.08 || faceV < 0.08) return false; // thin edge — nothing to paint on
    // Shrink if bigger than the face
    let k = 1;
    if (hu * 2 > faceU) k = Math.min(k, faceU / (hu * 2));
    if (hv * 2 > faceV) k = Math.min(k, faceV / (hv * 2));
    if (k < 1) mesh.scale.multiplyScalar(k);
    const huK = hu * k;
    const hvK = hv * k;
    // Slide the centre back inside the face
    const pu = mesh.position.dot(u);
    const pv = mesh.position.dot(v);
    const cu = Math.min(Math.max(pu, u0 + huK), u1 - huK);
    const cv = Math.min(Math.max(pv, v0 + hvK), v1 - hvK);
    mesh.position.addScaledVector(u, cu - pu).addScaledVector(v, cv - pv);
    return true;
  }

  /** How many decals are placed. The shader warm-up uses it as a mark. */
  get count(): number {
    return this.decals.length;
  }

  /** Drop every decal placed after mark `n` — undoes the warm-up ones. */
  trimTo(n: number): void {
    while (this.decals.length > n) {
      const m = this.decals.pop();
      if (m) this.scene.remove(m);
    }
  }

  /**
   * Place a decal on a surface.
   * @param point  world hit point
   * @param normal world surface normal
   * @param surface the object hit — used to clip the decal to its face
   */
  place(
    kind: DecalKind,
    point: THREE.Vector3,
    normal: THREE.Vector3,
    size?: number,
    /** Optional travel direction: the splatter is stretched along it (projected onto the surface). */
    stretchDir?: THREE.Vector3,
    stretch = 1,
    surface?: THREE.Object3D
  ): void {
    let mat: THREE.MeshBasicMaterial;
    let scale: number;
    if (kind === 'blood') {
      mat = this.bloodMats[Math.floor(Math.random() * this.bloodMats.length)];
      scale = size ?? 0.5 + Math.random() * 0.7;
    } else if (kind === 'pool') {
      mat = this.poolMats[Math.floor(Math.random() * this.poolMats.length)];
      scale = size ?? 1.2 + Math.random() * 0.8;
    } else {
      mat = this.holeMat;
      scale = size ?? 0.1 + Math.random() * 0.05;
    }
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.scale.setScalar(scale);
    const n = normal.clone().normalize();
    mesh.position.copy(point).addScaledVector(n, 0.012 + Math.random() * 0.006);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const proj = stretchDir ? stretchDir.clone().addScaledVector(n, -stretchDir.dot(n)) : null;
    if (proj && proj.lengthSq() > 1e-4 && stretch > 1) {
      proj.normalize();
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
      const angle = Math.atan2(localX.clone().cross(proj).dot(n), localX.dot(proj));
      mesh.rotateZ(angle);
      mesh.scale.set(scale * stretch, scale * (0.55 + Math.random() * 0.25), 1);
      mesh.position.addScaledVector(proj, scale * stretch * 0.3);
    } else {
      mesh.rotateZ(Math.random() * Math.PI * 2);
    }

    // Keep it on the face it hit
    if (surface && !this.clipToSurface(mesh, n, surface, mesh.scale.x, mesh.scale.y)) return;

    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.decals.push(mesh);
    if (this.decals.length > this.max) {
      const old = this.decals.shift()!;
      this.scene.remove(old);
    }

    // Pools seep outward instead of appearing fully formed
    if (kind === 'pool') {
      const target = mesh.scale.clone();
      mesh.scale.multiplyScalar(0.08);
      this.growing.push({ mesh, target, t: 0, duration: 5 + Math.random() * 3 });
    }

    // Fresh blood on a wall runs
    if (kind === 'blood' && Math.abs(n.y) < 0.5) this.spawnDrips(mesh, n, surface);
  }

  private spawnDrips(decal: THREE.Mesh, n: THREE.Vector3, surface?: THREE.Object3D): void {
    const count = 1 + Math.floor(Math.random() * 3);
    const up = new THREE.Vector3(0, 1, 0);
    const across = new THREE.Vector3().crossVectors(up, n).normalize();
    // How far down the face we're allowed to run
    let floorLimit = -Infinity;
    if (surface) {
      const box = new THREE.Box3().setFromObject(surface);
      if (!box.isEmpty()) floorLimit = box.min.y + 0.01;
    }
    for (let i = 0; i < count; i++) {
      if (this.drips.length >= this.maxDrips) {
        const old = this.drips.shift()!;
        this.scene.remove(old.mesh, old.bead);
      }
      const w = 0.008 + Math.random() * 0.012;
      const start = decal.position
        .clone()
        .addScaledVector(across, (Math.random() - 0.5) * decal.scale.x * 0.5)
        .addScaledVector(up, (Math.random() - 0.5) * decal.scale.y * 0.3)
        .addScaledVector(n, 0.004);
      const maxLen = Math.min(0.15 + Math.random() * 0.45, Math.max(0.05, start.y - floorLimit));
      const mesh = new THREE.Mesh(this.dripGeo, this.dripMat);
      mesh.position.copy(start);
      // Face along the normal with local Y pointing world-up so the strip hangs down
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
      const ang = Math.atan2(localY.clone().cross(up).dot(n), localY.dot(up));
      mesh.rotateZ(ang);
      mesh.scale.set(w, 0.001, 1);
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      const bead = new THREE.Mesh(this.geo, this.dripMat);
      bead.quaternion.copy(mesh.quaternion);
      bead.scale.setScalar(w * 1.8);
      bead.position.copy(start);
      bead.renderOrder = 3;
      this.scene.add(bead);
      this.drips.push({
        mesh,
        bead,
        length: 0,
        maxLength: maxLen,
        speed: 0.02 + Math.random() * 0.05, // m/s — slow
        life: 40 + Math.random() * 20
      });
    }
  }

  /** Advance drips and spreading pools. Call once per frame. */
  update(dt: number): void {
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      if (d.length < d.maxLength) {
        // Slows as it runs and thins out
        d.length = Math.min(d.maxLength, d.length + d.speed * dt * (1 - 0.5 * (d.length / d.maxLength)));
        d.mesh.scale.y = d.length;
        d.bead.position.copy(d.mesh.position).add(new THREE.Vector3(0, -d.length, 0));
      }
    }
    for (let i = this.growing.length - 1; i >= 0; i--) {
      const g = this.growing[i];
      g.t += dt;
      const k = Math.min(1, g.t / g.duration);
      const e = 1 - Math.pow(1 - k, 2.2); // fast start, long tail
      g.mesh.scale.set(g.target.x * (0.08 + 0.92 * e), g.target.y * (0.08 + 0.92 * e), 1);
      if (k >= 1) this.growing.splice(i, 1);
    }
  }
}
