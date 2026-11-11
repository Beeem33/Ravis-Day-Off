import * as THREE from 'three';
import type { FPSPlayer } from './FPSPlayer';
import { FirstPersonArms, grip } from './RaviVisual';

/**
 * KnifeTwirlViewmodel — a karambit hooked on Ravi's index finger, spun round
 * and round it for something to do with his hands, the way people do on a
 * bunny-hop server: it whirls, he catches it in his fist, holds it a moment,
 * flicks it off again. A click is a quick slash forward.
 *
 * The spin is the knife turning about his index finger, pointed straight
 * ahead through its ring, so it whirls round face-on in front of him; the
 * hand gives a little with each turn and dips when he flicks it.
 */

/** His right hand: knuckles forward, palm in and down, the index pointing straight out through the ring, the rest curled. */
const GRIP_TWIRL = grip([0.0, -0.012, 0.075], [-0.04, 0.08, -0.99], [-0.75, -0.66, 0], [0.12, -0.25, 0.96], {
  fingers: [[4, 8, 4], [72, 88, 52], [80, 94, 58], [86, 100, 60]],
  thumb: [0.4, 0.45, 0.3]
});

/** Revolutions a second, spinning flat out. */
const SPIN = 2.6;

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/** The karambit, flat in XY: the ring at the origin (its axis along Z, the finger's line), the handle hanging down from it, the claw curling out and up. */
function karambit(): THREE.Group {
  const g = new THREE.Group();
  // Bright enough to flash in a dark hall: not so metal it has nothing to reflect and goes black
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.3, metalness: 0.45, emissive: 0x1a1d20 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.55, metalness: 0.4 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x2f6f4a, roughness: 0.7 });
  // The ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0045, 8, 22), dark);
  g.add(ring);
  // The handle: down from the ring, a little curved (two segments)
  const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.05, 0.012), grip);
  h1.position.set(0.004, -0.04, 0);
  h1.rotation.z = -0.25;
  const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.048, 0.012), grip);
  h2.position.set(0.014, -0.085, 0);
  h2.rotation.z = -0.08;
  const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.01, 0.013), dark);
  bolster.position.set(0.016, -0.111, 0);
  g.add(h1, h2, bolster);
  // The claw: a crescent out of the end of the handle, curling out and back up to its point
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.0, -0.075, 0.07, -0.08);
  s.quadraticCurveTo(0.022, -0.052, 0.02, 0.0);
  s.closePath();
  const claw = new THREE.ExtrudeGeometry(s, { depth: 0.0035, bevelEnabled: false, curveSegments: 10 });
  claw.translate(0, 0, -0.00175);
  const blade = new THREE.Mesh(claw, steel);
  blade.position.set(0.006, -0.114, 0);
  g.add(blade);
  // Big enough to read on screen
  g.scale.setScalar(1.45);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = false;
  });
  return g;
}

export class KnifeTwirlViewmodel {
  readonly root = new THREE.Group();
  /** Where his hand is (camera space), what the arm lays onto. */
  private hand = new THREE.Object3D();
  /** Through the ring: the finger's line. The knife turns about this. */
  private finger = new THREE.Object3D();
  private knife: THREE.Group;
  private arms: FirstPersonArms;
  /** 1 put away .. 0 out in his hand. */
  stow = 0;
  private angle = 0;
  private speed = SPIN;
  /** Spinning, slowing to catch it, held, or flicking it off again; and how long in. */
  private mode: 'spin' | 'catch' | 'hold' = 'spin';
  private modeT = 0;
  private nextCatch = 3 + Math.random() * 2.5;
  private slashT = -1;
  private swayX = 0;
  private swayY = 0;
  /** The slash's moment of contact, for the scene to find what it hit. */
  onSlash: (() => void) | null = null;

  /** The angle the knife sits at in his fist: hanging straight down from his finger, the handle in his curled fingers. */
  private static readonly HELD = 0;
  /** And for a slash: swung up and out, the claw leading. */
  private static readonly SLASH = Math.PI * 0.6;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.hand);
    this.hand.add(this.finger);
    // The ring on the index finger, out in front of the knuckles
    this.finger.position.set(-0.022, -0.006, -0.06);
    this.knife = karambit();
    this.finger.add(this.knife);
    this.arms = new FirstPersonArms(this.root, camera).set('r', this.hand, GRIP_TWIRL);
  }

  /** A slash, if one isn't already going. */
  slash(): boolean {
    if (this.slashT >= 0 || this.stow > 0.2) return false;
    this.slashT = 0;
    this.mode = 'hold';
    this.modeT = 0;
    return true;
  }

  get slashing(): boolean {
    return this.slashT >= 0;
  }

  update(dt: number, player: FPSPlayer): void {
    // ---- The twirl
    this.modeT += dt;
    if (this.slashT >= 0) {
      // In the fist for the slash
      // Blade out and leading for the cut
      const w = this.wrapped();
      this.angle += (KnifeTwirlViewmodel.SLASH - w) * Math.min(1, dt * 20);
    } else if (this.mode === 'spin') {
      this.speed += (SPIN * (0.85 + 0.3 * Math.sin(this.modeT * 1.3)) - this.speed) * Math.min(1, dt * 3);
      this.angle += this.speed * Math.PI * 2 * dt;
      this.nextCatch -= dt;
      if (this.nextCatch <= 0) {
        this.mode = 'catch';
        this.modeT = 0;
      }
    } else if (this.mode === 'catch') {
      // Slowing, and snapped into the fist as it comes round to it
      this.speed = Math.max(0.9, this.speed - dt * 5);
      const before = this.wrapped();
      this.angle += this.speed * Math.PI * 2 * dt;
      const after = this.wrapped();
      // Coming round past straight down (the angle wrapping): caught
      if (this.speed <= 1.2 && after < before) {
        this.angle -= after;
        this.mode = 'hold';
        this.modeT = 0;
      }
    } else if (this.mode === 'hold') {
      // Held a moment, a little turn of the wrist; then a flick and it's going again
      if (this.modeT > 0.9) {
        this.mode = 'spin';
        this.modeT = 0;
        this.speed = SPIN * 1.25;
        this.nextCatch = 3 + Math.random() * 3;
      }
    }
    this.finger.rotation.z = this.angle;
    // ---- The hand: where it's held, giving a little with each turn, a dip on the flick, the slash
    const spinning = this.mode === 'spin' ? 1 : this.mode === 'catch' ? 0.5 : 0;
    const turn = Math.sin(this.angle);
    const flick = this.mode === 'spin' ? Math.exp(-this.modeT * 7) : 0;
    this.swayX += (-player.lastMouseDX * 0.00008 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (player.lastMouseDY * 0.00008 - this.swayY) * Math.min(1, dt * 9);
    const { phase, amount } = player.bob;
    const bx = Math.sin(phase) * 0.012 * amount;
    const by = -Math.abs(Math.sin(phase)) * 0.012 * amount;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let rz = 0;
    if (this.slashT >= 0) {
      this.slashT += dt;
      const t = this.slashT;
      // Back, then across and forward, then back home
      const wind = smooth(t / 0.08) * (1 - smooth((t - 0.08) / 0.06));
      const cut = smooth((t - 0.08) / 0.1) * (1 - smooth((t - 0.26) / 0.16));
      sx = 0.05 * wind - 0.2 * cut;
      sy = 0.03 * wind + 0.02 * cut;
      sz = 0.03 * wind - 0.16 * cut;
      rz = -0.4 * wind + 0.9 * cut;
      if (t - dt < 0.14 && t >= 0.14) this.onSlash?.();
      if (t > 0.45) {
        this.slashT = -1;
        this.mode = 'spin';
        this.modeT = 0;
        this.speed = SPIN;
      }
    }
    const h = this.hand;
    h.position.set(
      0.15 + this.swayX + bx + sx,
      -0.15 + this.swayY + by + 0.004 * turn * spinning - 0.025 * flick + sy - 0.5 * this.stow,
      -0.34 + sz + 0.08 * this.stow
    );
    h.rotation.set(0.12 + 0.05 * turn * spinning + 0.25 * flick - 0.9 * this.stow, 0.3, -0.1 + rz);
    this.root.visible = this.stow < 0.99;
    this.arms.update();
  }

  /** The knife's angle round the finger, 0..2π. */
  private wrapped(): number {
    const t = Math.PI * 2;
    return ((this.angle % t) + t) % t;
  }
}
