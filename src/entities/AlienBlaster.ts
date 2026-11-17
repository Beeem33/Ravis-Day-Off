import * as THREE from 'three';
import type { FPSPlayer } from './FPSPlayer';
import { FirstPersonArms, grip, mixGrip, type Grip } from './RaviVisual';
import { alienArm, type AlienArmParts } from './AlienCreatures';

/**
 * AlienBlaster — the arm Ravi took off the big one, grown onto his own
 * right forearm. His fist sits inside the root of it, palm down, the
 * tendrils wrapped round his wrist and forearm; the fleshy barrel runs on
 * past his knuckles to the toothed mouth with the blue light in it.
 *
 * Fully automatic: hold the trigger and it spits goo as fast as it can
 * (the scene asks `fire()` each frame and launches a shot when it says
 * yes). Nothing to reload: it makes its own.
 */

/** His fist inside the root of it: knuckles forward, palm down. */
const FIST = grip([0.0, -0.005, 0.075], [0.02, 0.02, -1], [0, -1, 0.05], [0.3, -0.35, 0.88], {
  fingers: [[82, 98, 62], [84, 100, 62], [86, 100, 62], [88, 100, 62]],
  thumb: [0.55, 0.8, 0.6]
});
/** The fist clenching harder as it fires. */
const FIST_FIRE = grip([0.0, -0.005, 0.075], [0.02, 0.0, -1], [0, -1, 0.0], [0.3, -0.35, 0.88], {
  fingers: [[90, 104, 66], [92, 106, 66], [92, 106, 66], [94, 106, 66]],
  thumb: [0.62, 0.9, 0.68]
});

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

export class AlienBlaster {
  readonly root = new THREE.Group();
  /** His fist (camera space). */
  readonly hand = new THREE.Group();
  readonly arm: AlienArmParts;
  private arms: FirstPersonArms;
  /** 1 put away .. 0 up in front of him. */
  stow = 1;
  private cool = 0;
  private recoil = 0;
  private swayX = 0;
  private swayY = 0;
  private t = 0;
  /** 0..1: how far the tendrils have taken hold (the graft; 1 once it's his). */
  grip = 1;
  static readonly RATE = 0.105;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.hand);
    this.arm = alienArm(0.62, { tendrils: true });
    this.seat(this.arm.root);
    this.hand.add(this.arm.root);
    this.arms = new FirstPersonArms(this.root, camera).set('r', this.hand, FIST);
    this.root.visible = false;
  }

  /** Where the arm sits on the fist: its root back over his wrist, the barrel forward past his knuckles. */
  seat(o: THREE.Object3D): void {
    o.position.set(0.0, 0.02, 0.16);
    o.rotation.set(0, Math.PI, 0);
    o.scale.setScalar(1);
  }

  /** The trigger held: true if a shot goes now. */
  fire(): boolean {
    if (this.cool > 0 || this.stow > 0.1) return false;
    this.cool = AlienBlaster.RATE;
    this.recoil = 1;
    return true;
  }

  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.arm.muzzle.getWorldPosition(out);
  }

  update(dt: number, player: FPSPlayer): void {
    this.t += dt;
    this.cool -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.swayX += (-player.lastMouseDX * 0.00007 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (player.lastMouseDY * 0.00007 - this.swayY) * Math.min(1, dt * 9);
    const { phase, amount } = player.bob;
    const bx = Math.sin(phase) * 0.012 * amount;
    const by = -Math.abs(Math.sin(phase)) * 0.012 * amount;
    const s = smooth(this.stow);
    const r = this.recoil;
    // Low on the right, the barrel pointing in to where he's looking
    this.hand.position.set(0.21 + this.swayX + bx, -0.25 + this.swayY + by - 0.55 * s + r * 0.012, -0.36 + r * 0.05 + 0.1 * s);
    this.hand.rotation.set(0.04 + r * 0.09 - 0.8 * s + this.swayY * 2, 0.07 + this.swayX * 2, -0.08 + Math.sin(this.t * 1.3) * 0.01);
    this.root.visible = this.stow < 0.99;
    this.living(dt);
    const g: Grip = r > 0.05 ? mixGrip(FIST, FIST_FIRE, Math.min(1, r * 2)) : FIST;
    this.arms.set('r', this.hand, g);
    this.arms.update();
  }

  /** It's alive: the tendrils flex, the core flickers, the mouth breathes; firing, it flares. */
  living(_dt: number): void {
    const a = this.arm;
    const f = 0.8 + 0.2 * Math.sin(this.t * 11) + (Math.random() - 0.5) * 0.15 + this.recoil * 1.2;
    a.core.scale.setScalar(f);
    (a.glow.material as THREE.SpriteMaterial).opacity = 0.35 + 0.2 * f;
    a.flare.scale.set(1 + this.recoil * 0.25 + Math.sin(this.t * 4) * 0.04, 1 + this.recoil * 0.25 + Math.sin(this.t * 4) * 0.04, 1);
    a.tendrils.forEach((t, i) => {
      const k = smooth(this.grip * 1.4 - i * 0.06);
      t.scale.set(0.6 + 0.4 * k, 0.6 + 0.4 * k, 0.05 + 0.95 * k * (1 + Math.sin(this.t * 3 + i) * 0.04));
    });
  }
}
