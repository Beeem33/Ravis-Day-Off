import * as THREE from 'three';

/**
 * OilSlicks — buckets of motor oil slung out of the back of the boss's car:
 * each one tumbling down the road, bursting where it lands into a glossy
 * black slick, the bucket clattering on and lying in the road. A car on a
 * slick (slickAt) has next to no grip.
 */
interface Bucket {
  group: THREE.Group;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  burst: boolean;
  still: boolean;
}

interface Slick {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  /** Its half-extents along its own axes, and their turn. */
  rx: number;
  rz: number;
  yaw: number;
  t: number;
}

const MAX_SLICKS = 14;
const MAX_BUCKETS = 10;

export class OilSlicks {
  private readonly buckets: Bucket[] = [];
  private readonly slicks: Slick[] = [];
  private readonly bucketGeo: { body: THREE.BufferGeometry; rim: THREE.BufferGeometry; oil: THREE.BufferGeometry; handle: THREE.BufferGeometry };
  private readonly mats: { steel: THREE.Material; oil: THREE.Material; slick: THREE.Material; label: THREE.Material };
  /** A bucket bursting on the road (for the splash), and one landing on something solid. */
  onBurst: ((at: THREE.Vector3) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly floorAt: (x: number, z: number) => number
  ) {
    this.bucketGeo = {
      body: new THREE.CylinderGeometry(0.17, 0.14, 0.36, 14, 1, true),
      rim: new THREE.TorusGeometry(0.17, 0.012, 6, 16),
      oil: new THREE.CircleGeometry(0.165, 14),
      handle: new THREE.TorusGeometry(0.17, 0.006, 4, 12, Math.PI)
    };
    this.mats = {
      steel: new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide }),
      oil: new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.08, metalness: 0.2 }),
      slick: new THREE.MeshStandardMaterial({ map: OilSlicks.sheen(), roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      label: new THREE.MeshStandardMaterial({ color: 0xd8a21a, roughness: 0.6, side: THREE.DoubleSide })
    };
  }

  /**
   * Oil on tarmac: wet black, with the rainbow sheen it throws in swirls
   * across it and a hard white glint of sky, so it reads from a way off.
   */
  private static sheen(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#050405';
    g.fillRect(0, 0, 256, 256);
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `hsla(${(i * 47) % 360}, 85%, 55%, 0.28)`;
      g.lineWidth = 4 + Math.random() * 9;
      g.beginPath();
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      g.moveTo(x, y);
      g.bezierCurveTo(x + (Math.random() - 0.5) * 220, y + (Math.random() - 0.5) * 220, x + (Math.random() - 0.5) * 220, y + (Math.random() - 0.5) * 220, x + (Math.random() - 0.5) * 160, y + (Math.random() - 0.5) * 160);
      g.stroke();
    }
    // The sky in it
    const grd = g.createLinearGradient(40, 60, 210, 190);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.5, 'rgba(225,235,250,0.42)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // (the puddle's uv are its outline's own coordinates, about ±1.4)
    t.repeat.set(0.35, 0.35);
    t.offset.set(0.5, 0.5);
    return t;
  }

  /** One flung out at `at`, going `vel`. */
  drop(at: THREE.Vector3, vel: THREE.Vector3): void {
    if (this.buckets.length >= MAX_BUCKETS) {
      const old = this.buckets.shift()!;
      old.group.removeFromParent();
    }
    const g = new THREE.Group();
    const G = this.bucketGeo;
    const body = new THREE.Mesh(G.body, this.mats.steel);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.152, 0.14, 14, 1, true), this.mats.label);
    label.position.y = -0.02;
    const rim = new THREE.Mesh(G.rim, this.mats.steel);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.18;
    const oil = new THREE.Mesh(G.oil, this.mats.oil);
    oil.rotation.x = -Math.PI / 2;
    oil.position.y = 0.15;
    const handle = new THREE.Mesh(G.handle, this.mats.steel);
    handle.position.y = 0.18;
    g.add(body, label, rim, oil, handle);
    // (a big one: five gallons of it)
    g.scale.setScalar(1.5);
    g.position.copy(at);
    g.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.scene.add(g);
    this.buckets.push({ group: g, vel: vel.clone(), spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14), burst: false, still: false });
  }

  /**
   * A step. `car`: a car to look out for (Ravi's) — a bucket still in the
   * air coming down on it bursts on it instead; returns true when one has.
   */
  update(dt: number, car?: { position: THREE.Vector3; yaw: number }): boolean {
    let onCar = false;
    for (const b of this.buckets) {
      if (b.still) continue;
      const p = b.group.position;
      b.vel.y -= 9.8 * dt;
      p.addScaledVector(b.vel, dt);
      b.group.rotation.x += b.spin.x * dt;
      b.group.rotation.y += b.spin.y * dt;
      b.group.rotation.z += b.spin.z * dt;
      // Onto the car
      if (car && !b.burst) {
        const dx = p.x - car.position.x;
        const dz = p.z - car.position.z;
        const along = -dx * Math.sin(car.yaw) - dz * Math.cos(car.yaw);
        const lat = dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw);
        if (Math.abs(along) < 2.2 && Math.abs(lat) < 1.0 && p.y < car.position.y + 1.7) {
          b.burst = true;
          onCar = true;
          this.spill(car.position.x, car.position.z, car.yaw);
          b.vel.set(b.vel.x * 0.3, 3, b.vel.z * 0.3);
          this.onBurst?.(p);
        }
      }
      const floor = this.floorAt(p.x, p.z) + 0.15;
      if (p.y <= floor) {
        p.y = floor;
        if (!b.burst) {
          // Bursts where it lands: the oil goes everywhere
          b.burst = true;
          this.spill(p.x, p.z, Math.atan2(b.vel.x, b.vel.z));
          this.onBurst?.(p);
        }
        // Clattering on, losing it
        b.vel.y = Math.abs(b.vel.y) * 0.3;
        b.vel.x *= 0.7;
        b.vel.z *= 0.7;
        b.spin.multiplyScalar(0.7);
        if (Math.hypot(b.vel.x, b.vel.z) < 0.6 && b.vel.y < 0.8) {
          b.still = true;
          b.group.rotation.set(Math.PI / 2, b.group.rotation.y, 0);
        }
      }
    }
    // The slicks spreading out to their size
    for (const s of this.slicks) {
      if (s.t >= 1) continue;
      s.t = Math.min(1, s.t + dt / 0.35);
      const k = 0.25 + 0.75 * (1 - (1 - s.t) * (1 - s.t));
      s.mesh.scale.set(s.rx * k, s.rz * k, 1);
    }
    return onCar;
  }

  /** A slick of it on the road at (x, z), spread along `yaw` (the way it was going). */
  private spill(x: number, z: number, yaw: number): void {
    if (this.slicks.length >= MAX_SLICKS) {
      const old = this.slicks.shift()!;
      old.mesh.removeFromParent();
      old.mesh.geometry.dispose();
    }
    // A ragged puddle: a disc with its edge pushed in and out
    const n = 22;
    const shape = new THREE.Shape();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 1 + 0.22 * Math.sin(a * 3 + x) + 0.12 * Math.sin(a * 7 + z) + (Math.random() - 0.5) * 0.12;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    }
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.mats.slick);
    // (its X along (cos yaw, −sin yaw), its Y along the way it was going: as slickAt reads it)
    mesh.rotation.set(-Math.PI / 2, 0, yaw);
    mesh.position.set(x, this.floorAt(x, z) + 0.02, z);
    const rx = 1.5 + Math.random() * 0.5;
    const rz = 2.4 + Math.random() * 0.8;
    mesh.scale.set(rx * 0.25, rz * 0.25, 1);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.slicks.push({ mesh, x, z, rx, rz, yaw, t: 0 });
  }

  /** Is (x, z) on oil? */
  slickAt(x: number, z: number): boolean {
    for (const s of this.slicks) {
      const dx = x - s.x;
      const dz = z - s.z;
      // Into the slick's own axes: its long axis is along `yaw`
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      const u = dx * c - dz * sn;
      const v = dx * sn + dz * c;
      const k = 0.25 + 0.75 * s.t;
      if ((u * u) / (s.rx * s.rx * k * k) + (v * v) / (s.rz * s.rz * k * k) < 1) return true;
    }
    return false;
  }

  clear(): void {
    for (const b of this.buckets) b.group.removeFromParent();
    for (const s of this.slicks) {
      s.mesh.removeFromParent();
      s.mesh.geometry.dispose();
    }
    this.buckets.length = 0;
    this.slicks.length = 0;
  }
}
