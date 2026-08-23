import * as THREE from 'three';
import type { ParticleManager } from '../fx/ParticleManager';
import type { AudioManager } from '../core/AudioManager';

interface Shard {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  landed: boolean;
  life: number;
}

/**
 * BreakableGlass — a glazed partition pane. Blocks movement (and bullets
 * shatter it and pass through); does NOT block enemy vision. On shatter the
 * pane breaks into real shard meshes that tumble, fall, land on the floor
 * and slowly fade, plus jagged remnants left in the frame.
 */
export class BreakableGlass {
  readonly mesh: THREE.Mesh;
  readonly group: THREE.Group;
  broken = false;
  /** Set by the level builder so shatter() can disable the movement collider. */
  colliderIndex = -1;

  private shards: Shard[] = [];
  private floorY = 0;
  private shardMat: THREE.MeshPhysicalMaterial;
  private static shardGeos: THREE.BufferGeometry[] = [];

  /**
   * @param width  pane width
   * @param height pane height
   * @param horizontalAxis 'x' if the pane runs along world X, 'z' if along Z
   */
  constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly horizontalAxis: 'x' | 'z'
  ) {
    this.group = new THREE.Group();

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xbfe3ea,
      transparent: true,
      opacity: 0.16,
      roughness: 0.05,
      metalness: 0,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), glassMat);
    if (horizontalAxis === 'z') this.mesh.rotation.y = Math.PI / 2;
    this.mesh.userData.glass = this;
    this.mesh.userData.surface = 'glass';
    this.group.add(this.mesh);

    this.shardMat = new THREE.MeshPhysicalMaterial({
      color: 0xd6f0f5,
      transparent: true,
      opacity: 0.55,
      roughness: 0.08,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    // Aluminum frame
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x6a7076 });
    const t = 0.05;
    const mkBar = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
      bar.position.set(x, y, z);
      this.group.add(bar);
    };
    if (horizontalAxis === 'x') {
      mkBar(width + t, t, t * 1.6, 0, height / 2, 0);
      mkBar(width + t, t, t * 1.6, 0, -height / 2, 0);
      mkBar(t, height, t * 1.6, -width / 2, 0, 0);
      mkBar(t, height, t * 1.6, width / 2, 0, 0);
    } else {
      mkBar(t * 1.6, t, width + t, 0, height / 2, 0);
      mkBar(t * 1.6, t, width + t, 0, -height / 2, 0);
      mkBar(t * 1.6, height, t, 0, 0, -width / 2);
      mkBar(t * 1.6, height, t, 0, 0, width / 2);
    }
  }

  /** A handful of random jagged triangle/quad shard shapes, shared by all panes. */
  private static shardGeo(): THREE.BufferGeometry {
    if (BreakableGlass.shardGeos.length === 0) {
      for (let i = 0; i < 10; i++) {
        const shape = new THREE.Shape();
        const n = 3 + Math.floor(Math.random() * 3);
        const r = 0.04 + Math.random() * 0.11;
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * Math.PI * 2 + Math.random() * 0.6;
          const rr = r * (0.5 + Math.random() * 0.8);
          const px = Math.cos(ang) * rr;
          const py = Math.sin(ang) * rr * (0.6 + Math.random() * 0.9);
          if (k === 0) shape.moveTo(px, py);
          else shape.lineTo(px, py);
        }
        shape.closePath();
        BreakableGlass.shardGeos.push(new THREE.ShapeGeometry(shape));
      }
    }
    return BreakableGlass.shardGeos[Math.floor(Math.random() * BreakableGlass.shardGeos.length)];
  }

  /** World-space center of the pane. */
  center(): THREE.Vector3 {
    return this.group.getWorldPosition(new THREE.Vector3());
  }

  /** World-space unit normal of the pane. */
  private normal(): THREE.Vector3 {
    return this.horizontalAxis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  }

  shatter(
    hitPoint: THREE.Vector3,
    bulletDir: THREE.Vector3,
    particles: ParticleManager,
    audio: AudioManager,
    listenerPos: THREE.Vector3
  ): void {
    if (this.broken) return;
    this.broken = true;
    this.mesh.visible = false;

    const c = this.center();
    audio.glassShatter(c.distanceTo(listenerPos));
    // Shards fall to the storey's FLOOR, not the pane's bottom edge (windows
    // sit on a sill, and glass doesn't hover at sill height).
    this.floorY = Math.floor((c.y - this.height / 2 + 0.05) / 3.3) * 3.3;
    // Fine glittering dust from the impact point
    particles.glassShards(hitPoint, bulletDir, this.floorY);

    // Break the pane into shards on a jittered grid. Shards near the bullet
    // get blasted along it; the rest mostly just drop out of the frame.
    const n = this.normal();
    const along = this.horizontalAxis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const parent = this.group.parent ?? this.group;
    const cols = Math.max(3, Math.round(this.width / 0.22));
    const rows = Math.max(3, Math.round(this.height / 0.22));
    const pushSign = Math.sign(bulletDir.dot(n)) || 1;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (Math.random() < 0.15) continue; // some of it just pulverises
        const u = (i + 0.5) / cols - 0.5 + (Math.random() - 0.5) * 0.4;
        const v = (j + 0.5) / rows - 0.5 + (Math.random() - 0.5) * 0.4;
        const pos = c.clone().addScaledVector(along, u * this.width).add(new THREE.Vector3(0, v * this.height, 0));
        const mesh = new THREE.Mesh(BreakableGlass.shardGeo(), this.shardMat);
        mesh.position.copy(pos);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
        mesh.rotateZ(Math.random() * Math.PI * 2);
        parent.add(mesh);

        const distToHit = pos.distanceTo(hitPoint);
        const blast = Math.max(0, 1 - distToHit / 1.2);
        const vel = n
          .clone()
          .multiplyScalar(pushSign * (0.3 + blast * 4 + Math.random() * 0.6))
          .addScaledVector(along, (Math.random() - 0.5) * 1.2)
          .add(new THREE.Vector3(0, -0.5 + blast * 1.5 + Math.random() * 0.8, 0));
        this.shards.push({
          mesh,
          vel,
          spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
          landed: false,
          life: 7 + Math.random() * 3
        });
      }
    }

    // Jagged remnant teeth left in the frame
    for (let i = 0; i < 6; i++) {
      const w = 0.06 + Math.random() * 0.16;
      const h = 0.1 + Math.random() * 0.3;
      const shard = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.shardMat);
      const edge = Math.floor(Math.random() * 2);
      const pos = (Math.random() - 0.5) * (this.width - 0.2);
      const y = edge === 0 ? -this.height / 2 + h / 2 : this.height / 2 - h / 2;
      if (this.horizontalAxis === 'x') shard.position.set(pos, y, 0);
      else {
        shard.rotation.y = Math.PI / 2;
        shard.position.set(0, y, pos);
      }
      shard.rotation.z = (Math.random() - 0.5) * 0.5;
      this.group.add(shard);
    }
  }

  /** Tumble the shards under gravity; they land on the floor, lie flat and fade. */
  update(dt: number): void {
    if (this.shards.length === 0) return;
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt;
      if (!s.landed) {
        s.vel.y -= 9.8 * dt;
        s.vel.multiplyScalar(1 - 0.4 * dt);
        s.mesh.position.addScaledVector(s.vel, dt);
        s.mesh.rotation.x += s.spin.x * dt;
        s.mesh.rotation.y += s.spin.y * dt;
        s.mesh.rotation.z += s.spin.z * dt;
        if (s.mesh.position.y <= this.floorY + 0.005) {
          // Land: lie flat on the floor, tiny skid, done
          s.landed = true;
          s.mesh.position.y = this.floorY + 0.004 + Math.random() * 0.004;
          s.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
          s.mesh.position.addScaledVector(new THREE.Vector3(s.vel.x, 0, s.vel.z), 0.08);
        }
      }
      if (s.life < 1.5) {
        // Fade out via per-shard scale so we don't have to clone the material
        const k = Math.max(0, s.life / 1.5);
        s.mesh.scale.setScalar(k);
      }
      if (s.life <= 0) {
        s.mesh.parent?.remove(s.mesh);
        this.shards.splice(i, 1);
      }
    }
  }
}
