import * as THREE from 'three';
import { FirstPersonArms, grip, type HandShape } from './RaviVisual';

/**
 * Ravi's arms in a blind panic, in first person: both hands up in front of
 * his face, palms out, fingers spread, shoving at what's coming and shaking
 * — jerking about, never still. `push` 0..1 brings them out from his chest
 * to arm's length; `fear` is how hard they shake.
 */
const SPREAD: HandShape = { fingers: [[2, 6, 4], [2, 5, 3], [3, 6, 4], [4, 8, 5]], thumb: [-0.1, 0.05, 0.05], spread: 14 };

export class PanicArms {
  private root = new THREE.Group();
  private hands: Record<'l' | 'r', THREE.Group> = { l: new THREE.Group(), r: new THREE.Group() };
  private arms: FirstPersonArms;
  private t = 0;
  private shown = 0;
  private on = false;
  push = 0.5;
  fear = 1;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.hands.l, this.hands.r);
    // Wrist at the anchor, fingers along its −Z, palm its −Y: each anchor is turned so the palm faces out and the fingers up
    this.arms = new FirstPersonArms(this.root, camera)
      .set('r', this.hands.r, grip([0, 0, 0], [0, 0, -1], [0, -1, 0], [0.25, -0.2, 1], SPREAD))
      .set('l', this.hands.l, grip([0, 0, 0], [0, 0, -1], [0, -1, 0], [-0.25, -0.2, 1], SPREAD));
    this.root.visible = false;
  }

  set active(v: boolean) {
    this.on = v;
  }

  /** Gone at once (a cut). */
  hide(): void {
    this.on = false;
    this.shown = 0;
    this.root.visible = false;
  }

  update(dt: number): void {
    this.t += dt;
    this.shown = Math.max(0, Math.min(1, this.shown + (this.on ? dt * 5 : -dt * 6)));
    this.root.visible = this.shown > 0.01;
    if (!this.root.visible) return;
    const t = this.t;
    const up = 1 - Math.pow(1 - this.shown, 3);
    for (const sd of ['l', 'r'] as const) {
      const s = sd === 'r' ? 1 : -1;
      const ph = s > 0 ? 0 : 1.7;
      // Shaking: a fast tremble on top of slower, bigger jerks
      const jx = (Math.sin(t * 31 + ph) * 0.012 + Math.sin(t * 7.3 + ph) * 0.035) * this.fear;
      const jy = (Math.sin(t * 27 + ph * 2) * 0.012 + Math.sin(t * 5.1 + ph) * 0.03) * this.fear;
      const z = -0.26 - this.push * 0.2 + Math.sin(t * 9 + ph) * 0.03 * this.fear;
      const h = this.hands[sd];
      h.position.set(s * (0.17 + jx), -0.42 + up * 0.36 + jy, z);
      // Palm out, fingers up, splayed a little outward, wrists twisting as they shove
      h.rotation.set(Math.PI / 2 - 0.15, -s * 0.25 + Math.sin(t * 11 + ph) * 0.15 * this.fear, -s * 0.2, 'YXZ');
    }
    this.root.updateMatrixWorld(true);
    this.arms.update();
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
