import * as THREE from 'three';

/**
 * The torch Ravi carries once the power goes.
 *
 * There is no model — it reads as something held just below the sightline,
 * which is also why the cone is offset a little down and to the right of
 * dead centre rather than perfectly on the crosshair.
 *
 * Like the muzzle flashes, it is created once and never hidden: three.js
 * bakes the number of visible lights into every material's shader, so
 * switching one off and on again would recompile the whole level. Toggling
 * drives intensity instead, and the count never moves.
 */
export class Flashlight {
  private spot: THREE.SpotLight;
  private target = new THREE.Object3D();
  private on = false;
  private level = 0;
  private readonly max: number;

  constructor(camera: THREE.Camera, intensity = 26) {
    this.max = intensity;
    this.spot = new THREE.SpotLight(0xfff0d4, 0, 26, Math.PI / 7.5, 0.42, 1.1);
    // Held at chest height in the right hand, so the cone sits low and right
    this.spot.position.set(0.16, -0.22, 0);
    camera.add(this.spot);
    // Below the sightline, so the useful part of the pool lands on the floor
    // and the walls ahead rather than on the ceiling tiles overhead.
    this.target.position.set(0.05, -1.5, -12);
    camera.add(this.target);
    this.spot.target = this.target;
  }

  get enabled(): boolean {
    return this.on;
  }

  toggle(): boolean {
    this.on = !this.on;
    return this.on;
  }

  set(on: boolean): void {
    this.on = on;
  }

  /** Eases in rather than snapping, so it reads as a click and a warm-up. */
  update(dt: number): void {
    const want = this.on ? 1 : 0;
    this.level += (want - this.level) * Math.min(1, dt * 9);
    // A little unsteadiness — it is being held, not mounted
    const flick = this.on ? 1 + Math.sin(performance.now() * 0.011) * 0.03 : 1;
    this.spot.intensity = this.max * this.level * flick;
  }

  dispose(): void {
    this.spot.removeFromParent();
    this.target.removeFromParent();
  }
}
