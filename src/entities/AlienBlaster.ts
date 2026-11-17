import * as THREE from 'three';
import type { FPSPlayer } from './FPSPlayer';
import { FirstPersonArms, grip, mixGrip, type Grip } from './RaviVisual';
import { alienCannon, type CannonParts } from './AlienCreatures';

/**
 * AlienBlaster — the cannon-head Ravi cut off the big one, grown onto his
 * own right forearm. His fist is inside the back of it; its feelers have
 * closed round his wrist and forearm; the barrel runs on past his knuckles
 * to the toothed mouth with the blue light in it.
 *
 * Fully automatic: hold the trigger and it spits goo as fast as it can
 * (the scene asks `fire()` each frame and launches a shot when it says
 * yes). Nothing to reload: it makes its own.
 */

/** His fist, knuckles forward, palm down. */
const FIST = grip([0.0, -0.005, 0.075], [0.02, 0.02, -1], [0, -1, 0.05], [0.3, -0.35, 0.88], {
  fingers: [[82, 98, 62], [84, 100, 62], [86, 100, 62], [88, 100, 62]],
  thumb: [0.55, 0.8, 0.6]
});
const FIST_FIRE = grip([0.0, -0.005, 0.075], [0.02, 0.0, -1], [0, -1, 0.0], [0.3, -0.35, 0.88], {
  fingers: [[90, 104, 66], [92, 106, 66], [92, 106, 66], [94, 106, 66]],
  thumb: [0.62, 0.9, 0.68]
});
/** Open, fingers spread: the cannon not on yet. */
export const FIST_OPEN = grip([0.0, -0.005, 0.075], [0.02, 0.06, -1], [0, -1, 0.05], [0.3, -0.35, 0.88], {
  fingers: [[8, 10, 6], [6, 8, 4], [8, 10, 6], [12, 14, 8]],
  thumb: [0.05, 0.1, 0.1],
  spread: 6
});

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

export class AlienBlaster {
  readonly root = new THREE.Group();
  /** His fist (camera space). */
  readonly hand = new THREE.Group();
  readonly gun: CannonParts;
  private arms: FirstPersonArms;
  /** 1 put away .. 0 up in front of him. */
  stow = 1;
  private cool = 0;
  private recoil = 0;
  private swayX = 0;
  private swayY = 0;
  private t = 0;
  /** 0..1: how far the feelers have taken hold (the graft; 1 once it's his). */
  grip = 1;
  /** 0 a fist, 1 open (in the graft, before it's on). */
  open = 0;
  /** Extra shake in his arm (the graft taking). */
  tremor = 0;
  /** Where the hand is pointed while the scene has it (the graft); null for the usual place. */
  pose: { p: THREE.Vector3; r: THREE.Euler } | null = null;
  static readonly RATE = 0.105;
  static readonly SCALE = 0.85;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.hand);
    this.gun = alienCannon();
    this.seat(this.gun.root);
    this.hand.add(this.gun.root);
    this.arms = new FirstPersonArms(this.root, camera).set('r', this.hand, FIST);
    this.root.visible = false;
  }

  /** Where the cannon sits on the fist: its cuff back over his wrist, the barrel forward past his knuckles. */
  seat(o: THREE.Object3D): void {
    o.position.set(0.0, 0.01, 0.13);
    o.rotation.set(0, Math.PI, 0);
    o.scale.setScalar(AlienBlaster.SCALE);
  }

  fire(): boolean {
    if (this.cool > 0 || this.stow > 0.1) return false;
    this.cool = AlienBlaster.RATE;
    this.recoil = 1;
    return true;
  }

  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.gun.muzzle.getWorldPosition(out);
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
    const tr = this.tremor;
    const jx = (Math.random() - 0.5) * 0.006 * tr;
    const jy = (Math.random() - 0.5) * 0.006 * tr;
    if (this.pose) {
      this.hand.position.copy(this.pose.p).add(new THREE.Vector3(jx, jy - 0.55 * s, 0.1 * s));
      this.hand.rotation.copy(this.pose.r);
    } else {
      this.hand.position.set(0.2 + this.swayX + bx + jx, -0.27 + this.swayY + by - 0.55 * s + r * 0.012 + jy, -0.34 + r * 0.05 + 0.1 * s);
      this.hand.rotation.set(0.05 + r * 0.09 - 0.8 * s + this.swayY * 2, 0.06 + this.swayX * 2, -0.06 + Math.sin(this.t * 1.3) * 0.01);
    }
    this.root.visible = this.stow < 0.99;
    this.living();
    let g: Grip = r > 0.05 ? mixGrip(FIST, FIST_FIRE, Math.min(1, r * 2)) : FIST;
    if (this.open > 0) g = mixGrip(g, FIST_OPEN, this.open);
    this.arms.set('r', this.hand, g);
    this.arms.update();
  }

  /** It's alive: the feelers flex, the core flickers, the mouth breathes; firing, it flares. */
  private living(): void {
    const a = this.gun;
    const f = 0.8 + 0.2 * Math.sin(this.t * 11) + (Math.random() - 0.5) * 0.15 + this.recoil * 1.2;
    a.core.scale.setScalar(f);
    (a.glow.material as THREE.SpriteMaterial).opacity = 0.3 + 0.2 * f;
    const br = 1 + this.recoil * 0.25 + Math.sin(this.t * 4) * 0.04;
    a.flare.scale.set(br, br, 1);
    a.tendrils.forEach((t, i) => {
      const k = smooth(this.grip * 1.5 - i * 0.06);
      t.scale.set(0.5 + 0.5 * k, 0.5 + 0.5 * k, 0.15 + 0.85 * k * (1 + Math.sin(this.t * 3 + i) * 0.05));
    });
  }
}
