import * as THREE from 'three';
import type { FPSPlayer } from './FPSPlayer';
import { FirstPersonArms, grip, mixGrip, type Grip } from './RaviVisual';

/**
 * KnifeTwirlViewmodel — Ravi's karambit, held the ordinary way: in his right
 * fist, low and to the side, the claw up and curving forward. It sits still
 * there until the player clicks; each click is a trick, one after another
 * round a set of three:
 *
 *  - the spin: his fingers open and it whirls round on the ring, twice;
 *  - the toss: flicked up out of his hand, end over end, and caught;
 *  - the roll: spun about its own handle through loose fingers, like a drumstick.
 *
 * Frames: `hand` is where his fist is (camera space), its origin the middle
 * of the handle, +Y up the handle to the blade, −Z the way the claw curves.
 */

/** The fist round the handle: knuckles forward, palm in, thumb on top. */
const GRIP_HOLD = grip([0.024, -0.004, 0.07], [0.08, 0.04, -1], [-1, 0, -0.1], [0.3, -0.4, 0.86], {
  fingers: [[78, 96, 60], [82, 98, 62], [84, 100, 62], [86, 100, 62]],
  thumb: [0.5, 0.75, 0.6]
});
/** Let go of, all but: fingers out from it, the little one still hooked through the ring. */
const GRIP_LOOSE = grip([0.03, -0.004, 0.075], [0.08, 0.06, -1], [-1, 0.05, -0.1], [0.3, -0.4, 0.86], {
  fingers: [[22, 30, 18], [26, 34, 20], [34, 44, 26], [74, 92, 58]],
  thumb: [0.15, 0.25, 0.2]
});
/** Open for the toss: nothing in it. */
const GRIP_OPEN = grip([0.034, -0.01, 0.078], [0.06, 0.12, -1], [-0.9, 0.42, -0.1], [0.3, -0.4, 0.86], {
  fingers: [[14, 20, 12], [16, 22, 14], [20, 26, 16], [26, 32, 18]],
  thumb: [0.05, 0.15, 0.15],
  spread: 3
});

const TAU = Math.PI * 2;
const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};
/** Fast away, slowing in: a thing thrown round and caught. */
const easeOut = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 2.2);

type Trick = 'spin' | 'toss' | 'roll';
const TRICKS: { kind: Trick; time: number }[] = [
  { kind: 'spin', time: 0.85 },
  { kind: 'toss', time: 0.95 },
  { kind: 'roll', time: 0.75 }
];

let scaleTex: THREE.CanvasTexture | null = null;
/** G10 scales: a dark green laminate, its weave showing in fine diagonal lines. */
function scaleTexture(): THREE.CanvasTexture {
  if (scaleTex) return scaleTex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f3a2a';
  g.fillRect(0, 0, S, S);
  for (let i = -S; i < S * 2; i += 4) {
    g.strokeStyle = i % 8 ? 'rgba(10,22,14,0.75)' : 'rgba(70,120,84,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i - S, S);
    g.moveTo(i - S, 0);
    g.lineTo(i, S);
    g.stroke();
  }
  scaleTex = new THREE.CanvasTexture(c);
  scaleTex.wrapS = scaleTex.wrapT = THREE.RepeatWrapping;
  scaleTex.repeat.set(60, 60);
  scaleTex.colorSpace = THREE.SRGBColorSpace;
  return scaleTex;
}

/**
 * The karambit, drawn flat (x the way the claw curves, y up the handle, the
 * ring at the origin) and extruded: a full tang with a finger-grooved
 * handle, laminate scales screwed to both sides of it, a bolster, the claw
 * with its ground edge and a fuller, jimping on the spine, and the ring.
 */
function karambit(): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9c0c7, roughness: 0.32, metalness: 0.5, emissive: 0x16181b });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xeef2f5, roughness: 0.18, metalness: 0.4, emissive: 0x2a2d30 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.5, metalness: 0.6 });
  const scales = new THREE.MeshStandardMaterial({ map: scaleTexture(), color: 0xc8d8cc, roughness: 0.8 });
  const flat = (s: THREE.Shape, depth: number, mat: THREE.Material, z = 0, bevel = 0): THREE.Mesh => {
    const geo = new THREE.ExtrudeGeometry(s, {
      depth,
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 1,
      curveSegments: 12
    });
    geo.translate(0, 0, z - depth / 2);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    g.add(m);
    return m;
  };
  // ---- The ring, and the collar it grows out of
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0155, 0.0042, 10, 26), dark);
  g.add(ring);
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, 0.011), dark);
  collar.position.set(0, 0.0185, 0);
  g.add(collar);
  // ---- The tang: the handle's outline, finger grooves down its front
  const handle = (inset: number): THREE.Shape => {
    const s = new THREE.Shape();
    const f = 0.0125 - inset;
    const b = -0.0125 + inset;
    s.moveTo(b, 0.02 + inset);
    s.quadraticCurveTo(b - 0.0045, 0.064, b + 0.002, 0.108 - inset);
    s.lineTo(f, 0.108 - inset);
    s.quadraticCurveTo(f - 0.0065, 0.094, f + 0.0005, 0.08);
    s.quadraticCurveTo(f - 0.0065, 0.066, f, 0.052);
    s.quadraticCurveTo(f - 0.006, 0.038, f - 0.0005, 0.02 + inset);
    s.closePath();
    return s;
  };
  flat(handle(0), 0.0052, steel);
  // The scales, proud of the tang on both sides, and their screws
  for (const side of [-1, 1]) {
    flat(handle(0.0016), 0.0042, scales, side * 0.0047, 0.0008);
    for (const [x, y] of [[-0.001, 0.032], [-0.003, 0.064], [0, 0.096]]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.0016, 10), steel);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(x, y, side * 0.0078);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.0007, 0.0004), dark);
      slot.position.set(x, y, side * 0.0087);
      slot.rotation.z = 0.6 + y * 20;
      g.add(screw, slot);
    }
  }
  // ---- The bolster
  const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.007, 0.0125), dark);
  bolster.position.set(0.0012, 0.1115, 0);
  g.add(bolster);
  // ---- The claw: spine up and over, edge on the inside of the curve, to a point
  const blade = new THREE.Shape();
  blade.moveTo(-0.0125, 0.115);
  blade.quadraticCurveTo(-0.019, 0.192, 0.064, 0.196);
  blade.quadraticCurveTo(0.014, 0.172, 0.0135, 0.115);
  blade.closePath();
  flat(blade, 0.0028, steel);
  // The ground edge: a bright band along the inside of the curve, a hair proud of the flats
  const edge = new THREE.Shape();
  edge.moveTo(0.0135, 0.115);
  edge.quadraticCurveTo(0.014, 0.172, 0.064, 0.196);
  edge.quadraticCurveTo(0.0075, 0.178, 0.0065, 0.115);
  edge.closePath();
  flat(edge, 0.0031, edgeMat);
  // The fuller: a dark groove following the spine
  const fuller = new THREE.Shape();
  fuller.moveTo(-0.0075, 0.124);
  fuller.quadraticCurveTo(-0.012, 0.181, 0.03, 0.188);
  fuller.quadraticCurveTo(-0.0075, 0.178, -0.0035, 0.124);
  fuller.closePath();
  flat(fuller, 0.0032, dark);
  // Jimping: notches up the back of the spine, for his thumb
  for (let i = 0; i < 6; i++) {
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0022, 0.0034), dark);
    n.position.set(-0.0128 - i * 0.00035, 0.119 + i * 0.0055, 0);
    g.add(n);
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
  });
  return g;
}

export class KnifeTwirlViewmodel {
  readonly root = new THREE.Group();
  /** His fist (camera space): the middle of the handle. */
  private hand = new THREE.Object3D();
  /** Up out of his hand, for the toss. */
  private toss = new THREE.Object3D();
  /** At the ring: the knife tumbles about this (its X, the ring's axis). */
  private pivot = new THREE.Object3D();
  private knife: THREE.Group;
  private arms: FirstPersonArms;
  /** 1 put away .. 0 out in his hand. */
  stow = 0;
  private trickI = 0;
  private trickT = -1;
  private current: Trick = 'spin';
  private trickTime = 1;
  private swayX = 0;
  private swayY = 0;
  private settle = 0;
  /** A trick starting: the blade passes in front of him (the scene finds what it caught). */
  onSlash: (() => void) | null = null;
  /** The catch at the end of one, for a sound. */
  onCatch: (() => void) | null = null;

  /** Where the middle of the handle is above the ring. */
  private static readonly SEAT = 0.064;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.hand);
    this.hand.add(this.toss);
    this.toss.add(this.pivot);
    this.pivot.position.y = -KnifeTwirlViewmodel.SEAT;
    this.knife = karambit();
    // Drawn with the claw along +X: turned so it curves away from him
    this.knife.rotation.y = Math.PI / 2;
    this.pivot.add(this.knife);
    this.arms = new FirstPersonArms(this.root, camera).set('r', this.hand, GRIP_HOLD);
  }

  /** The next trick, if he isn't in the middle of one. */
  trick(): boolean {
    if (this.trickT >= 0 || this.stow > 0.2) return false;
    const t = TRICKS[this.trickI++ % TRICKS.length];
    this.current = t.kind;
    this.trickTime = t.time;
    this.trickT = 0;
    return true;
  }

  get busy(): boolean {
    return this.trickT >= 0;
  }

  update(dt: number, player: FPSPlayer): void {
    let grip: Grip = GRIP_HOLD;
    let tumble = 0;
    let roll = 0;
    let up = 0;
    let lift = 0;
    let wrist = 0;
    let dip = 0;
    if (this.trickT >= 0) {
      const before = this.trickT;
      this.trickT += dt;
      const u = Math.min(1, this.trickT / this.trickTime);
      if (before < 0.1 && this.trickT >= 0.1) this.onSlash?.();
      if (this.current === 'spin') {
        // Fingers off it, twice round on the ring, and closed on it again
        const open = smooth(u / 0.12) * (1 - smooth((u - 0.86) / 0.14));
        grip = mixGrip(GRIP_HOLD, GRIP_LOOSE, open);
        tumble = -TAU * 2 * easeOut(u);
        lift = 0.035 * Math.sin(u * Math.PI);
        wrist = 0.25 * Math.sin(u * Math.PI);
      } else if (this.current === 'toss') {
        // A dip, the flick, up and over twice, and into his hand
        const out = smooth((u - 0.1) / 0.08) * (1 - smooth((u - 0.88) / 0.1));
        grip = mixGrip(GRIP_HOLD, GRIP_OPEN, out);
        const air = Math.min(1, Math.max(0, (u - 0.12) / 0.78));
        up = 0.24 * 4 * air * (1 - air);
        tumble = -TAU * 2 * air;
        dip = Math.sin(Math.min(1, u / 0.12) * Math.PI) * 0.04 + 0.03 * Math.sin(Math.min(1, Math.max(0, (u - 0.88) / 0.12)) * Math.PI);
        lift = 0.02 * smooth(u / 0.2) * (1 - smooth((u - 0.8) / 0.2));
      } else {
        // Loose fingers, and it spins about its own handle
        const open = smooth(u / 0.15) * (1 - smooth((u - 0.8) / 0.2));
        grip = mixGrip(GRIP_HOLD, GRIP_LOOSE, open * 0.7);
        roll = TAU * 3 * smooth(u);
        wrist = -0.3 * Math.sin(u * Math.PI);
        lift = 0.025 * Math.sin(u * Math.PI);
      }
      if (u >= 1) {
        this.trickT = -1;
        this.settle = 1;
        this.onCatch?.();
      }
    }
    // The catch: a little give in the wrist as it lands
    this.settle = Math.max(0, this.settle - dt * 5);
    const give = this.settle * this.settle;
    this.toss.position.y = up;
    this.pivot.rotation.x = tumble;
    this.knife.rotation.y = Math.PI / 2 + roll;
    // ---- The hand: low and to the right, the blade leaning forward and in
    this.swayX += (-player.lastMouseDX * 0.00007 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (player.lastMouseDY * 0.00007 - this.swayY) * Math.min(1, dt * 9);
    const { phase, amount } = player.bob;
    const bx = Math.sin(phase) * 0.01 * amount;
    const by = -Math.abs(Math.sin(phase)) * 0.011 * amount;
    const s = this.stow;
    const h = this.hand;
    h.position.set(
      0.215 + this.swayX + bx - 0.03 * (lift / 0.035),
      -0.235 + this.swayY + by + lift - dip - 0.02 * give - 0.5 * s,
      -0.43 + 0.08 * s
    );
    h.rotation.set(-0.42 + 0.12 * give - 0.9 * s + this.swayY * 2, 0.22 + this.swayX * 2, 0.2 + wrist);
    this.root.visible = s < 0.99;
    this.arms.set('r', h, grip);
    this.arms.update();
  }
}
