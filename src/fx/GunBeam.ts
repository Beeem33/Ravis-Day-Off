import * as THREE from 'three';

/**
 * The torches clipped to the agents' weapons.
 *
 * On a floor with no power these are the only thing that gives them away: a
 * long thin beam swinging round a corner arrives well before its owner does.
 * Each beam is a narrow spotlight plus a faint additive cone so the shaft
 * itself reads in the air, not just the disc it throws on the wall.
 *
 * The pool is sized once at build time and never grows. Every light stays in
 * the scene for good and is driven by intensity alone — the number of visible
 * lights is baked into every material's shader, so adding or hiding one
 * mid-fight recompiles the entire level.
 */
export class GunBeamPool {
  private spots: THREE.SpotLight[] = [];
  private targets: THREE.Object3D[] = [];
  private shafts: THREE.Mesh[] = [];
  private live: boolean[] = [];
  private readonly range: number;
  private readonly max: number;

  private static tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, count: number, range = 30, intensity = 30) {
    this.range = range;
    this.max = intensity;
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0xffeccd,
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    // Long and narrow — a search beam, not a lantern
    const half = Math.PI / 26;
    for (let i = 0; i < count; i++) {
      const spot = new THREE.SpotLight(0xffeccd, 0, range, half * 1.6, 0.55, 1.0);
      spot.position.set(0, -90, 0);
      scene.add(spot);
      const target = new THREE.Object3D();
      target.position.set(0, -90, -1);
      scene.add(target);
      spot.target = target;
      this.spots.push(spot);
      this.targets.push(target);

      // Cone runs from the muzzle out to the far end of the beam. Built along
      // +Y and tipped, because that is the axis ConeGeometry is happiest on.
      const shaft = new THREE.Mesh(
        new THREE.ConeGeometry(Math.tan(half) * range, range, 14, 1, true),
        shaftMat
      );
      shaft.visible = false;
      scene.add(shaft);
      this.shafts.push(shaft);
      this.live.push(false);
    }
  }

  get size(): number {
    return this.spots.length;
  }

  /** Point beam `i` from `from` along `dir`. */
  aim(i: number, from: THREE.Vector3, dir: THREE.Vector3): void {
    if (i >= this.spots.length) return;
    const d = GunBeamPool.tmp.copy(dir).normalize();
    this.spots[i].position.copy(from);
    this.spots[i].intensity = this.max;
    this.targets[i].position.copy(from).addScaledVector(d, this.range);
    const shaft = this.shafts[i];
    shaft.visible = true;
    // Cone apex sits at the muzzle, so the body is centred half a range out
    shaft.position.copy(from).addScaledVector(d, this.range / 2);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d);
    this.live[i] = true;
  }

  /** Put beam `i` out — its owner is down. */
  kill(i: number): void {
    if (i >= this.spots.length) return;
    this.spots[i].intensity = 0;
    this.spots[i].position.set(0, -90, 0);
    this.shafts[i].visible = false;
    this.live[i] = false;
  }

  dispose(): void {
    for (const s of this.spots) s.removeFromParent();
    for (const t of this.targets) t.removeFromParent();
    for (const m of this.shafts) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.spots.length = 0;
    this.targets.length = 0;
    this.shafts.length = 0;
  }
}

/**
 * The bit of light Ravi has on him — no torch, just enough of a warm spill to
 * make out what is directly in front of his feet. Deliberately short-ranged:
 * it is meant to leave the corridor dark, not solve it.
 */
export class PlayerGlow {
  private light: THREE.PointLight;

  constructor(camera: THREE.Camera, intensity = 2.6, distance = 4.2) {
    this.light = new THREE.PointLight(0xffb066, intensity, distance, 1.7);
    this.light.position.set(0, -0.35, -0.25);
    camera.add(this.light);
  }

  dispose(): void {
    this.light.removeFromParent();
  }
}
