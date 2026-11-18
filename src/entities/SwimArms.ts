import * as THREE from 'three';
import { FirstPersonArms, HAND, grip, mixShape, type HandShape } from './RaviVisual';

/**
 * Ravi's arms swimming: a breaststroke in front of his face while he's in the
 * water — out wide, round and in under his chin, and straight out ahead
 * again. Slow and easy treading water, quicker when he's going somewhere.
 * His own arms (dressed in whatever the level has him in), hung off the camera.
 */
export class SwimArms {
  private root = new THREE.Group();
  private hands: Record<'l' | 'r', THREE.Group> = { l: new THREE.Group(), r: new THREE.Group() };
  private arms: FirstPersonArms;
  private phase = 0;
  /** 0 out of sight .. 1 up in front of him. */
  private shown = 0;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.hands.l, this.hands.r);
    // Wrist at the anchor, fingers out along its −Z, palm down its −Y, the forearm back toward him
    this.arms = new FirstPersonArms(this.root, camera)
      .set('r', this.hands.r, grip([0, 0, 0], [0, 0, -1], [0, -1, 0], [0.18, -0.35, 1], HAND.open))
      .set('l', this.hands.l, grip([0, 0, 0], [0, 0, -1], [0, -1, 0], [-0.18, -0.35, 1], HAND.open));
    this.root.visible = false;
  }

  /** One frame: `swimming`, and how fast he's moving through the water (m/s). */
  update(dt: number, swimming: boolean, speed: number): void {
    this.shown = Math.max(0, Math.min(1, this.shown + (swimming ? dt * 2.5 : -dt * 4)));
    this.root.visible = this.shown > 0.01;
    if (!this.root.visible) return;
    // A stroke every 1.6 s treading water, every 0.95 s swimming hard
    this.phase = (this.phase + dt / (1.6 - Math.min(0.65, speed * 0.22))) % 1;
    const t = this.phase;
    // Keyframes per hand (x mirrored for the left): position in front of the camera, and the roll of the palm
    //   reach out ahead → sweep out wide → round and in under the chin → back out ahead
    const keys: [number, number, number, number, number][] = [
      // t,    x,     y,     z,    roll (palm turned out)
      [0.0, 0.08, -0.05, -0.68, 0.1],
      [0.32, 0.44, -0.08, -0.55, 1.25],
      [0.58, 0.17, -0.2, -0.38, 0.6],
      [0.72, 0.08, -0.15, -0.44, -0.1],
      [1.0, 0.08, -0.05, -0.68, 0.1]
    ];
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const u = (t - a[0]) / (b[0] - a[0]);
    const e = u * u * (3 - 2 * u);
    const lerp = (k: number): number => a[k] + (b[k] - a[k]) * e;
    const drop = (1 - this.shown) * 0.5;
    for (const sd of ['l', 'r'] as const) {
      const s = sd === 'r' ? 1 : -1;
      const h = this.hands[sd];
      h.position.set(s * lerp(1), lerp(2) - drop, lerp(3));
      // Fingers pointed a little out from straight ahead as they sweep, palm rolled out to push the water
      h.rotation.set(0, -s * lerp(4) * 0.35, -s * lerp(4), 'YXZ');
    }
    // Fingers together on the pull, spread a touch on the reach
    const pull = t > 0.05 && t < 0.6;
    const shape: HandShape = mixShape(HAND.open, HAND.relaxed, pull ? 0.15 : 0.45);
    this.arms.shape('l', shape);
    this.arms.shape('r', shape);
    this.root.updateMatrixWorld(true);
    this.arms.update();
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
