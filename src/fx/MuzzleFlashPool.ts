import * as THREE from 'three';

/**
 * A small ring of muzzle-flash lights shared by everyone who shoots.
 *
 * Toggling `light.visible` looks harmless and is not: three.js bakes the
 * number of visible lights into every material's shader, so switching one
 * on changes the program key for the *whole scene* and forces a fresh
 * compile of every material in it. On the call floor that was a 500ms
 * stall the first time the player pulled the trigger, and another one for
 * every distinct count after that — two enemies firing at once, then
 * three, and so on.
 *
 * So the lights here are created once, stay visible forever, and are only
 * ever driven by intensity. The visible count never moves, the programs are
 * compiled once, and nothing recompiles mid-fight. A handful of lights sat
 * at zero intensity costs a few instructions per fragment; the alternative
 * costs half a second.
 */
export class MuzzleFlashPool {
  private lights: THREE.PointLight[] = [];
  private decay: number[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, count = 3) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffb45e, 0, 7, 1.8);
      // Never toggled — see the note above. Parked out of the way until used.
      l.position.set(0, -80, 0);
      scene.add(l);
      this.lights.push(l);
      this.decay.push(0);
    }
  }

  /** Light one up at `pos`. Oldest in the ring is reused. */
  flash(pos: THREE.Vector3, intensity = 10): void {
    const i = this.next;
    this.next = (this.next + 1) % this.lights.length;
    this.lights[i].position.copy(pos);
    this.lights[i].intensity = intensity;
    this.decay[i] = 0.05;
  }

  update(dt: number): void {
    for (let i = 0; i < this.lights.length; i++) {
      if (this.decay[i] <= 0) continue;
      this.decay[i] -= dt;
      this.lights[i].intensity *= 0.7;
      if (this.decay[i] <= 0) this.lights[i].intensity = 0;
    }
  }

  dispose(): void {
    for (const l of this.lights) l.removeFromParent();
    this.lights.length = 0;
  }
}
