import * as THREE from 'three';
import type { ParticleManager } from '../fx/ParticleManager';
import type { AudioManager } from '../core/AudioManager';

/**
 * BreakableGlass — a glazed partition pane. Blocks movement (and bullets
 * shatter it and pass through); does NOT block enemy vision. On shatter it
 * bursts into shard particles, leaves jagged remnants in the frame, and its
 * collider is disabled.
 */
export class BreakableGlass {
  readonly mesh: THREE.Mesh;
  readonly group: THREE.Group;
  broken = false;
  /** Set by the level builder so shatter() can disable the movement collider. */
  colliderIndex = -1;

  private remnants: THREE.Mesh[] = [];

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

  /** World-space center of the pane. */
  center(): THREE.Vector3 {
    return this.group.getWorldPosition(new THREE.Vector3());
  }

  shatter(hitPoint: THREE.Vector3, bulletDir: THREE.Vector3, particles: ParticleManager, audio: AudioManager, listenerPos: THREE.Vector3): void {
    if (this.broken) return;
    this.broken = true;
    this.mesh.visible = false;

    const c = this.center();
    audio.glassShatter(c.distanceTo(listenerPos));
    // Floor is roughly bottom of the pane
    const floorY = c.y - this.height / 2;
    particles.glassShards(hitPoint, bulletDir, floorY);

    // Jagged remnant shards left in the frame
    const remnantMat = new THREE.MeshPhysicalMaterial({
      color: 0xbfe3ea,
      transparent: true,
      opacity: 0.22,
      roughness: 0.1,
      side: THREE.DoubleSide
    });
    for (let i = 0; i < 5; i++) {
      const w = 0.06 + Math.random() * 0.16;
      const h = 0.1 + Math.random() * 0.3;
      const shard = new THREE.Mesh(new THREE.PlaneGeometry(w, h), remnantMat);
      const edge = Math.floor(Math.random() * 2); // bottom or top edge
      const along = (Math.random() - 0.5) * (this.width - 0.2);
      const y = edge === 0 ? -this.height / 2 + h / 2 : this.height / 2 - h / 2;
      if (this.horizontalAxis === 'x') {
        shard.position.set(along, y, 0);
      } else {
        shard.rotation.y = Math.PI / 2;
        shard.position.set(0, y, along);
      }
      shard.rotation.z = (Math.random() - 0.5) * 0.5;
      this.group.add(shard);
      this.remnants.push(shard);
    }
  }
}
