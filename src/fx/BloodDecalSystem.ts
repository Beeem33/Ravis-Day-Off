import * as THREE from 'three';

export type DecalKind = 'blood' | 'bullethole' | 'pool';

/**
 * BloodDecalSystem — projects splatter/bullet-hole quads onto surfaces.
 * Textures are generated procedurally on canvases; decals live in a pool
 * and the oldest are recycled once the cap is reached.
 */
export class BloodDecalSystem {
  private bloodMats: THREE.MeshBasicMaterial[] = [];
  private poolMats: THREE.MeshBasicMaterial[] = [];
  private holeMat!: THREE.MeshBasicMaterial;
  private decals: THREE.Mesh[] = [];
  private geo = new THREE.PlaneGeometry(1, 1);
  private max = 160;

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < 4; i++) this.bloodMats.push(this.makeMaterial(this.drawSplatter(i * 7 + 1, false)));
    for (let i = 0; i < 2; i++) this.poolMats.push(this.makeMaterial(this.drawSplatter(i * 13 + 3, true)));
    this.holeMat = this.makeMaterial(this.drawBulletHole());
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
    // Streaks
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
    // Cracked chips around the hole
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
   * Place a decal on a surface.
   * @param point  world hit point
   * @param normal world surface normal
   */
  place(
    kind: DecalKind,
    point: THREE.Vector3,
    normal: THREE.Vector3,
    size?: number,
    /** Optional travel direction: the splatter is stretched along it (projected onto the surface). */
    stretchDir?: THREE.Vector3,
    stretch = 1
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
    // Orient the plane to face along the normal, offset slightly to avoid z-fighting.
    const n = normal.clone().normalize();
    mesh.position.copy(point).addScaledVector(n, 0.012 + Math.random() * 0.006);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const proj = stretchDir ? stretchDir.clone().addScaledVector(n, -stretchDir.dot(n)) : null;
    if (proj && proj.lengthSq() > 1e-4 && stretch > 1) {
      // Align the decal's local X with the bullet's direction across the surface
      proj.normalize();
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
      const angle = Math.atan2(localX.clone().cross(proj).dot(n), localX.dot(proj));
      mesh.rotateZ(angle);
      mesh.scale.set(scale * stretch, scale * (0.55 + Math.random() * 0.25), 1);
      // Shift the streak so it trails away from the impact point
      mesh.position.addScaledVector(proj, scale * stretch * 0.3);
    } else {
      mesh.rotateZ(Math.random() * Math.PI * 2);
    }
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.decals.push(mesh);
    if (this.decals.length > this.max) {
      const old = this.decals.shift()!;
      this.scene.remove(old);
    }
  }
}
