import * as THREE from 'three';
import type { FPSPlayer } from './FPSPlayer';
import { FirstPersonArms, grip, mixGrip, type Grip } from './RaviVisual';
import { alienCannon, type AlienKind, type CannonParts } from './AlienCreatures';

/**
 * AlienBlaster — one of the two cannon-heads Ravi cut off the big one, grown
 * onto his forearm: the acid-spitter on his right, the grabber on his left.
 * His fist is inside the back of it; its feelers have closed round his wrist
 * and forearm; the barrel runs on past his knuckles to the toothed mouth.
 *
 * The scene does the shooting (the acid's globs, the grabber's tongue);
 * this is the arm and the thing on it, their sway and recoil, and the graft.
 */

/** His right fist, knuckles forward, palm down. */
const FIST = grip([0.0, -0.005, 0.075], [0.02, 0.02, -1], [0, -1, 0.05], [0.3, -0.35, 0.88], {
  fingers: [[82, 98, 62], [84, 100, 62], [86, 100, 62], [88, 100, 62]],
  thumb: [0.55, 0.8, 0.6]
});
const FIST_FIRE = grip([0.0, -0.005, 0.075], [0.02, 0.0, -1], [0, -1, 0.0], [0.3, -0.35, 0.88], {
  fingers: [[90, 104, 66], [92, 106, 66], [92, 106, 66], [94, 106, 66]],
  thumb: [0.62, 0.9, 0.68]
});
/** Open, fingers spread: the cannon not on yet. */
const FIST_OPEN = grip([0.0, -0.005, 0.075], [0.02, 0.06, -1], [0, -1, 0.05], [0.3, -0.35, 0.88], {
  fingers: [[8, 10, 6], [6, 8, 4], [8, 10, 6], [12, 14, 8]],
  thumb: [0.05, 0.1, 0.1],
  spread: 6
});

/** The same grip for the other hand: everything reflected across the middle. */
function mirror(g: Grip): Grip {
  const m = (v: THREE.Vector3): THREE.Vector3 => v.clone().setX(-v.x);
  return { wrist: m(g.wrist), along: m(g.along), palm: m(g.palm), toward: m(g.toward), shape: g.shape };
}

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
  private grips: { fist: Grip; fire: Grip; open: Grip };
  private s: number;
  /** 1 put away .. 0 up in front of him. */
  stow = 1;
  private cool = 0;
  /** 0..1 kick from a shot (the scene can set it for a long pull, the grabber's). */
  recoil = 0;
  private swayX = 0;
  private swayY = 0;
  private t = 0;
  /** 0..1: how far the feelers have taken hold (the graft; 1 once it's his). */
  grip = 1;
  /** 0 a fist, 1 open (in the graft, before it's on). */
  open = 0;
  /** Extra shake in his arm (the graft taking; something heavy on the end of the tongue). */
  tremor = 0;
  /** 0..1: the mouth gaping (eating something it's pulled in), the scene's to set. */
  chomp = 0;
  /** Where the hand is while the scene has it (the graft); null for the usual place. */
  pose: { p: THREE.Vector3; r: THREE.Euler } | null = null;
  static readonly SCALE = 0.74;

  constructor(
    camera: THREE.Camera,
    readonly side: 'l' | 'r',
    readonly kind: AlienKind
  ) {
    this.s = side === 'r' ? 1 : -1;
    this.grips = side === 'r' ? { fist: FIST, fire: FIST_FIRE, open: FIST_OPEN } : { fist: mirror(FIST), fire: mirror(FIST_FIRE), open: mirror(FIST_OPEN) };
    camera.add(this.root);
    this.root.add(this.hand);
    this.gun = alienCannon(kind);
    this.seat(this.gun.root);
    this.hand.add(this.gun.root);
    this.arms = new FirstPersonArms(this.root, camera).set(side, this.hand, this.grips.fist);
    this.root.visible = false;
  }

  /** Where the cannon sits on the fist: its cuff back over his wrist, the barrel forward past his knuckles. */
  seat(o: THREE.Object3D): void {
    o.position.set(0.0, 0.01, 0.13);
    o.rotation.set(0, Math.PI, 0);
    o.scale.setScalar(AlienBlaster.SCALE);
  }

  /** The trigger, at `rate` seconds a shot: true if one goes now. */
  fire(rate: number): boolean {
    if (this.cool > 0 || this.stow > 0.1) return false;
    this.cool = rate;
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
    const bx = Math.sin(phase) * 0.012 * amount * this.s;
    const by = -Math.abs(Math.sin(phase + (this.s < 0 ? 1.5 : 0))) * 0.012 * amount;
    const st = smooth(this.stow);
    const r = this.recoil;
    const tr = this.tremor;
    const jx = (Math.random() - 0.5) * 0.008 * tr;
    const jy = (Math.random() - 0.5) * 0.008 * tr;
    const s = this.s;
    if (this.pose) {
      this.hand.position.set(this.pose.p.x * s + jx, this.pose.p.y + jy - 0.55 * st, this.pose.p.z + 0.1 * st);
      this.hand.rotation.set(this.pose.r.x, this.pose.r.y * s, this.pose.r.z * s);
    } else {
      this.hand.position.set(s * 0.25 + this.swayX + bx + jx, -0.31 + this.swayY + by - 0.55 * st + r * 0.012 + jy, -0.34 + r * 0.05 + 0.1 * st);
      this.hand.rotation.set(0.05 + r * 0.09 - 0.8 * st + this.swayY * 2, s * 0.06 + this.swayX * 2, s * (-0.06 + Math.sin(this.t * 1.3) * 0.01));
    }
    this.root.visible = this.stow < 0.99;
    this.living();
    let g: Grip = r > 0.05 ? mixGrip(this.grips.fist, this.grips.fire, Math.min(1, r * 2)) : this.grips.fist;
    if (this.open > 0) g = mixGrip(g, this.grips.open, this.open);
    this.arms.set(this.side, this.hand, g);
    this.arms.update();
  }

  /** It's alive: the feelers flex, the core flickers, the mouth breathes; firing, it flares. */
  private living(): void {
    const a = this.gun;
    const f = 0.8 + 0.2 * Math.sin(this.t * 11 + this.s) + (Math.random() - 0.5) * 0.15 + this.recoil * 1.2;
    a.core.scale.setScalar(f);
    (a.glow.material as THREE.SpriteMaterial).opacity = 0.3 + 0.2 * f;
    const br = 1 + this.recoil * 0.25 + Math.sin(this.t * 4 + this.s) * 0.04 + this.chomp * 0.7;
    a.flare.scale.set(br, br, 1);
    a.tendrils.forEach((t, i) => {
      const k = smooth(this.grip * 1.5 - i * 0.06);
      t.scale.set(0.5 + 0.5 * k, 0.5 + 0.5 * k, 0.15 + 0.85 * k * (1 + Math.sin(this.t * 3 + i) * 0.05));
    });
  }
}
