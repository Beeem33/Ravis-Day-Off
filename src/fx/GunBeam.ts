import * as THREE from 'three';

/**
 * The torches clipped to the agents' weapons.
 *
 * On a floor with no power these are the only thing that gives them away: a
 * long thin beam swinging round a corner arrives well before its owner does.
 * Each beam is a narrow spotlight and nothing else. There was a faint cone
 * drawn along it so the shaft read in the air, but a mesh obeys none of the
 * rules the shadow map does — scaled off a single centre ray, it punched
 * straight through any near wall that ray happened to miss. The lit patch a
 * beam throws is the tell; the shaft was a liability.
 *
 * Each beam casts a shadow, which is the only way a wall actually stops it:
 * an unshadowed spotlight lights straight through geometry, so every beam in
 * the building was visible from everywhere at once. Shadow maps also give the
 * half-blocked case for free — a doorway edge cuts the cone where it stands
 * and the rest of the beam carries on past it.
 *
 * The pool is sized once at build time and never grows. Every light stays in
 * the scene for good and is driven by intensity alone — the number of visible
 * lights is baked into every material's shader, so adding or hiding one
 * mid-fight recompiles the entire level.
 */
export class GunBeamPool {
  private spots: THREE.SpotLight[] = [];
  private lamps: THREE.Sprite[] = [];
  private targets: THREE.Object3D[] = [];
  private live: boolean[] = [];
  private readonly range: number;
  private readonly max: number;

  private static tmp = new THREE.Vector3();
  private static DOWN = new THREE.Vector3(0, -1, 0);

  constructor(scene: THREE.Scene, count: number, range = 18, intensity = 55) {
    this.range = range;
    this.max = intensity;
    const lampMat = new THREE.SpriteMaterial({
      color: 0xfff2d6,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    // Tuned by looking at it, one variable at a time. The one that mattered
    // was decay: at 1.6 the pool all but vanished at any useful range and
    // pushing the intensity up just blew out whatever was close. At 1.0 a
    // moderate lamp throws a soft-edged patch that reads as a torch.
    const half = Math.PI / 9;
    for (let i = 0; i < count; i++) {
      const spot = new THREE.SpotLight(0xffeccd, 0, range, half, 0.6, 1.0);
      spot.position.set(0, -90, 0);
      // Small maps: the cone is narrow, so there is little to resolve, and
      // twelve of these have to fit in a frame alongside everything else.
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.camera.near = 0.4;
      spot.shadow.camera.far = range;
      spot.shadow.bias = -0.0009;
      spot.shadow.normalBias = 0.02;
      scene.add(spot);
      // The lens itself. A spotlight aimed at the player lights nothing the
      // player can see — the cone lands on surfaces behind them — so without
      // this the one moment that matters, a torch swinging onto you, has no
      // picture at all. It is a point at the muzzle, which is already
      // validated to be on the right side of any wall, so it cannot leak.
      const lamp = new THREE.Sprite(lampMat);
      lamp.scale.setScalar(0.22);
      lamp.position.set(0, -90, 0);
      lamp.visible = false;
      scene.add(lamp);
      this.lamps.push(lamp);
      const target = new THREE.Object3D();
      target.position.set(0, -90, -1);
      scene.add(target);
      spot.target = target;
      this.spots.push(spot);
      this.targets.push(target);

      // Cone runs from the muzzle out to the far end of the beam. Built along
      // +Y and tipped, because that is the axis ConeGeometry is happiest on.
      this.live.push(false);
    }
  }

  get size(): number {
    return this.spots.length;
  }

  /**
   * Point beam `i` from `from` along `dir`. `reach` is how far the beam gets
   * before something stops it — the shaft is scaled to it so the visible
   * shaft ends where the light does.
   */
  aim(i: number, from: THREE.Vector3, dir: THREE.Vector3, reach = this.range): void {
    if (i >= this.spots.length) return;
    const d = GunBeamPool.tmp.copy(dir).normalize();
    const len = Math.max(0.6, Math.min(reach, this.range));
    this.spots[i].position.copy(from);
    this.spots[i].intensity = this.max;
    this.lamps[i].position.copy(from);
    this.lamps[i].visible = true;
    this.targets[i].position.copy(from).addScaledVector(d, this.range);
    this.live[i] = true;
  }

  /** Put beam `i` out — its owner is down. */
  kill(i: number): void {
    if (i >= this.spots.length) return;
    this.spots[i].intensity = 0;
    this.spots[i].position.set(0, -90, 0);
    this.lamps[i].visible = false;
    this.live[i] = false;
  }

  dispose(): void {
    for (const s of this.spots) s.removeFromParent();
    for (const t of this.targets) t.removeFromParent();
    for (const l of this.lamps) l.removeFromParent();
    this.lamps.length = 0;
    this.spots.length = 0;
    this.targets.length = 0;
  }
}

/**
 * The bit of light Ravi has on him — no torch, just enough of a warm spill to
 * make out what is directly in front of his feet. Deliberately short-ranged:
 * it is meant to leave the corridor dark, not solve it.
 */
export class PlayerGlow {
  private light: THREE.PointLight;

  constructor(camera: THREE.Camera, intensity = 1.15, distance = 2.6) {
    this.light = new THREE.PointLight(0xffb066, intensity, distance, 1.7);
    this.light.position.set(0, -0.35, -0.25);
    camera.add(this.light);
  }

  dispose(): void {
    this.light.removeFromParent();
  }
}
