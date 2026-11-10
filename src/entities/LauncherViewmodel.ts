import * as THREE from 'three';
import type { FPSPlayer } from './FPSPlayer';
import { FirstPersonArms, grip } from './RaviVisual';

/**
 * LauncherViewmodel — the rocket launcher the crew brought for the towers,
 * on Ravi's right shoulder: a single tube with a rocket's warhead standing
 * out of its mouth, a pistol grip and a foregrip under it, sights along its
 * top left. One rocket a pull; then his left hand goes down for the next
 * one and pushes it into the muzzle. It never runs dry — and it isn't his:
 * the scene takes it back once the towers are down.
 *
 * Model frame: the tube runs along −Z (its mouth at −Z), +Y up. The root
 * hangs off the camera like the guns' viewmodels; during the hand-over the
 * scene sets `handoff` and the launcher is carried in from wherever Sanjay
 * holds it out (a camera-space pose) to the shoulder.
 */

export type LauncherEvent = 'fire' | 'reloadStart' | 'load' | 'reloadDone';

/** The tube: from its back end to its mouth. */
const BACK = 0.44;
const MOUTH = -0.6;
const R = 0.046;
const SHOT_GAP = 0.25;
const RELOAD = 1.75;

// Right hand round the pistol grip (as the rifle's), left round the foregrip (the mirror of it)
const GRIP_R = grip([0.026, -0.01, 0.07], [-0.1, 0.3, -0.95], [-1, 0, -0.1], [0.15, -0.2, 0.3], {
  fingers: [[-8, 12, 28], [82, 85, 35], [86, 85, 35], [88, 85, 35]],
  thumb: [0.3, 0.2, 0.1],
  splay: [-30, 0, 0, 0]
});
const GRIP_L = grip([-0.026, -0.01, 0.07], [0.1, 0.3, -0.95], [1, 0, -0.1], [-0.2, -0.25, 0.3], {
  fingers: [[78, 80, 34], [82, 85, 35], [86, 85, 35], [88, 85, 35]],
  thumb: [0.3, 0.2, 0.1]
});
/** Left hand round a rocket's body, carrying it: the rocket lies along the anchor's −Z. */
const GRIP_ROCKET = grip([-0.04, -0.045, 0.06], [0.1, 0.2, -0.97], [0.6, 0.6, 0], [-0.3, -0.5, 0.5], {
  fingers: [[62, 70, 34], [66, 72, 35], [70, 74, 35], [74, 76, 36]],
  thumb: [0.4, 0.3, 0.2]
});

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/** A rocket: the warhead's bulb and nose ahead of the neck, the motor's body behind. Nose toward −Z, the neck's back end at the origin. */
function rocketGeometry(): { head: THREE.BufferGeometry; body: THREE.BufferGeometry } {
  const prof: [number, number][] = [
    [0.0, 0.33], [0.012, 0.325], [0.03, 0.3], [0.046, 0.26], [0.056, 0.2], [0.056, 0.15], [0.048, 0.11], [0.032, 0.085], [0.028, 0.06], [0.028, 0.0]
  ];
  const head = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  head.rotateX(-Math.PI / 2);
  const body = new THREE.CylinderGeometry(0.03, 0.03, 0.42, 10);
  body.rotateX(Math.PI / 2);
  body.translate(0, 0, 0.21);
  return { head, body };
}

/** The launcher on its own: for the viewmodel, and for Sanjay to carry before he hands it over. */
export function launcherModel(): {
  group: THREE.Group;
  warhead: THREE.Object3D;
  grips: { r: THREE.Object3D; l: THREE.Object3D };
  muzzle: THREE.Object3D;
} {
  const g = new THREE.Group();
  g.name = 'launcher';
  const olive = new THREE.MeshStandardMaterial({ color: 0x5f6a3e, roughness: 0.55, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e201c, roughness: 0.45, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.7 });
  const black = new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide });
  const head = new THREE.MeshStandardMaterial({ color: 0x55603c, roughness: 0.5, metalness: 0.3 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    g.add(mesh);
    return mesh;
  };
  const len = BACK - MOUTH;
  const tube = new THREE.CylinderGeometry(R, R, len, 16, 1, true);
  tube.rotateX(Math.PI / 2);
  add(tube, olive, 0, 0, (BACK + MOUTH) / 2);
  // Inside it, dark
  const bore = new THREE.CylinderGeometry(R * 0.92, R * 0.92, len, 12, 1, true);
  bore.rotateX(Math.PI / 2);
  add(bore, black, 0, 0, (BACK + MOUTH) / 2);
  // The heat shield round the middle, the flared venturi at the back, a ring at the mouth
  const shield = new THREE.CylinderGeometry(R + 0.006, R + 0.006, 0.22, 16);
  shield.rotateX(Math.PI / 2);
  add(shield, wood, 0, 0, -0.02);
  const flare = new THREE.CylinderGeometry(R + 0.028, R + 0.004, 0.14, 16, 1, true);
  flare.rotateX(Math.PI / 2);
  add(flare, dark, 0, 0, BACK - 0.05);
  add(new THREE.TorusGeometry(R + 0.002, 0.007, 6, 18), dark, 0, 0, MOUTH);
  // Grips under it: the pistol grip and its guard, the foregrip forward
  add(new THREE.BoxGeometry(0.032, 0.11, 0.05), dark, 0, -0.1, 0.05, 0.25);
  add(new THREE.BoxGeometry(0.012, 0.035, 0.07), dark, 0, -0.065, -0.01);
  add(new THREE.BoxGeometry(0.03, 0.1, 0.045), dark, 0, -0.095, -0.28, 0.08);
  add(new THREE.BoxGeometry(0.05, 0.03, 0.12), dark, 0, -0.055, 0.03);
  add(new THREE.BoxGeometry(0.05, 0.03, 0.08), dark, 0, -0.055, -0.28);
  // Sights along the top left: a rear aperture, a front post
  const rear = new THREE.Group();
  rear.position.set(-0.04, 0.05, -0.05);
  rear.add(new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.012), dark));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0012, 6, 18), dark);
  ring.position.y = 0.022;
  rear.add(ring);
  g.add(rear);
  add(new THREE.BoxGeometry(0.004, 0.036, 0.004), dark, -0.04, 0.066, -0.45);
  add(new THREE.BoxGeometry(0.012, 0.04, 0.02), dark, -0.04, 0.03, -0.45);
  // The rocket in it, its warhead out of the mouth
  const rk = rocketGeometry();
  const warhead = new THREE.Group();
  warhead.position.z = MOUTH + 0.02;
  warhead.add(new THREE.Mesh(rk.head, head));
  g.add(warhead);
  const r = new THREE.Object3D();
  r.position.set(0, -0.1, 0.05);
  r.rotation.x = 0.25;
  g.add(r);
  const l = new THREE.Object3D();
  l.position.set(0, -0.095, -0.28);
  l.rotation.x = 0.08;
  g.add(l);
  const muzzle = new THREE.Object3D();
  muzzle.position.z = MOUTH - 0.05;
  g.add(muzzle);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group: g, warhead, grips: { r, l }, muzzle };
}

export class LauncherViewmodel {
  readonly root = new THREE.Group();
  private model: ReturnType<typeof launcherModel>;
  private arms: FirstPersonArms;
  /** The next rocket, in his left hand during a reload. */
  private loadHand = new THREE.Object3D();
  /** 1 stowed .. 0 up on the shoulder. */
  stow = 1;
  aimBlend = 0;
  loaded = 1;
  reloading = false;
  private reloadT = 0;
  private gap = 0;
  private recoil = 0;
  private swayX = 0;
  private swayY = 0;
  private pushed = false;
  onEvent: ((e: LauncherEvent) => void) | null = null;
  /** During the hand-over: where Sanjay holds it (camera space), how far it's come to the shoulder (0..1), how far his hands have got to it (0..1); null otherwise. */
  handoff: { from: THREE.Matrix4; k: number; reach: number } | null = null;

  private readonly hip = new THREE.Vector3(0.19, -0.14, -0.18);
  private readonly hipRot = new THREE.Euler(0.02, -0.055, 0.0);
  /** Sighting: the aperture and the post lined up under the crosshair. */
  private readonly aim = new THREE.Vector3(0.04, -0.082, -0.1);

  private reachR = new THREE.Object3D();
  private reachL = new THREE.Object3D();
  /** Where his hands start from as he reaches for it (camera space): down by his sides. */
  private static readonly REST_R = new THREE.Vector3(0.24, -0.62, -0.12);
  private static readonly REST_L = new THREE.Vector3(-0.24, -0.62, -0.12);

  constructor(private camera: THREE.Camera) {
    this.model = launcherModel();
    camera.add(this.root);
    this.root.add(this.model.group, this.reachR, this.reachL, this.loadHand);
    // The spare rocket for the reload: warhead and motor
    const rk = rocketGeometry();
    const spare = new THREE.Group();
    spare.add(new THREE.Mesh(rk.head, (this.model.warhead.children[0] as THREE.Mesh).material));
    spare.add(new THREE.Mesh(rk.body, new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.5, metalness: 0.4 })));
    spare.position.z = -0.12;
    this.loadHand.add(spare);
    this.loadHand.visible = false;
    this.arms = new FirstPersonArms(this.root, camera).set('r', this.model.grips.r, GRIP_R).set('l', this.model.grips.l, GRIP_L);
    this.root.visible = false;
  }

  get group(): THREE.Group {
    return this.model.group;
  }

  /** Ready to fire: up, loaded, not mid-reload or still settling from the last. */
  get ready(): boolean {
    return this.stow < 0.05 && !this.reloading && this.gap <= 0 && this.loaded > 0 && !this.handoff;
  }

  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.model.muzzle.getWorldPosition(out);
  }

  /** The back of the tube (for the backblast), world. */
  rearWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.model.group.localToWorld(out.set(0, 0, BACK + 0.05));
  }

  /** Pull: the rocket goes. The scene launches it; this does the kick, and the reload follows. */
  fire(): boolean {
    if (!this.ready) return false;
    this.model.warhead.visible = false;
    this.loaded = 0;
    this.recoil = 1;
    this.gap = SHOT_GAP;
    this.onEvent?.('fire');
    return true;
  }

  /** Loaded again at once (a restart, the hand-over). */
  refill(): void {
    this.loaded = 1;
    this.reloading = false;
    this.model.warhead.visible = true;
    this.loadHand.visible = false;
  }

  update(dt: number, player: FPSPlayer, aiming: boolean): void {
    this.gap = Math.max(0, this.gap - dt);
    this.recoil = Math.max(0, this.recoil - dt * 4);
    // Empty and settled from the kick: the next one
    if (this.loaded === 0 && !this.reloading && this.gap <= 0 && this.stow < 0.5) {
      this.reloading = true;
      this.reloadT = 0;
      this.pushed = false;
      this.onEvent?.('reloadStart');
    }
    const sprinting = player.sprinting && player.currentSpeed > 4.5;
    this.aimBlend += ((aiming && !sprinting && !this.reloading && !this.handoff ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 10);
    // ---- The reload: the tube tipped down and in, the left hand down for a rocket, up, into the mouth, back
    let dip = 0;
    let hand = false;
    if (this.reloading) {
      this.reloadT += dt;
      const t = this.reloadT;
      dip = smooth(t / 0.3) * (1 - smooth((t - RELOAD + 0.35) / 0.35));
      hand = t > 0.15 && t < RELOAD - 0.2;
      if (!this.pushed && t >= 1.1) {
        this.pushed = true;
        this.model.warhead.visible = true;
        this.onEvent?.('load');
      }
      if (t >= RELOAD) {
        this.reloading = false;
        this.loaded = 1;
        this.onEvent?.('reloadDone');
      }
    }
    // ---- Sway and bob, heavier than a rifle's
    this.swayX += (-player.lastMouseDX * 0.00007 - this.swayX) * Math.min(1, dt * 7);
    this.swayY += (player.lastMouseDY * 0.00007 - this.swayY) * Math.min(1, dt * 7);
    const { phase, amount } = player.bob;
    const a = this.aimBlend;
    const bob = 1 - 0.7 * a;
    const bx = Math.sin(phase) * 0.012 * amount * bob;
    const by = -Math.abs(Math.sin(phase)) * 0.014 * amount * bob;
    const r = this.recoil * this.recoil;
    const lerp = THREE.MathUtils.lerp;
    const root = this.root;
    root.position.set(
      lerp(this.hip.x, this.aim.x, a) + this.swayX + bx - 0.03 * dip,
      lerp(this.hip.y, this.aim.y, a) + this.swayY + by - 0.06 * dip + 0.015 * r,
      lerp(this.hip.z, this.aim.z, a) + 0.08 * r + 0.05 * dip
    );
    root.rotation.set(this.hipRot.x * (1 - a) + 0.14 * r + this.swayY * 2 - 0.2 * dip, this.hipRot.y * (1 - a) + this.swayX * 2 + 0.3 * dip, -0.35 * dip + this.swayX);
    if (this.stow > 0.0001) {
      root.position.y -= this.stow * 0.6;
      root.position.z += this.stow * 0.1;
      root.rotation.x -= this.stow * 0.9;
    }
    // ---- The hand-over: carried from where it was held out to the shoulder
    const h = this.handoff;
    if (h) {
      const k = smooth(h.k);
      const p0 = new THREE.Vector3();
      const q0 = new THREE.Quaternion();
      const s0 = new THREE.Vector3();
      h.from.decompose(p0, q0, s0);
      root.position.lerpVectors(p0, root.position.clone(), k);
      root.quaternion.slerpQuaternions(q0, root.quaternion.clone(), k);
    }
    root.visible = this.stow < 0.995;
    // ---- His hands
    const reachK = h ? smooth(h.reach) : 1;
    if (reachK < 1) {
      // Coming up from his sides to the grips
      root.updateWorldMatrix(true, true);
      for (const [side, anchor, rest, out] of [
        ['r', this.model.grips.r, LauncherViewmodel.REST_R, this.reachR],
        ['l', this.model.grips.l, LauncherViewmodel.REST_L, this.reachL]
      ] as const) {
        const at = anchor.getWorldPosition(new THREE.Vector3());
        const from = this.camera.localToWorld(rest.clone());
        out.position.copy(root.worldToLocal(from.lerp(at, reachK)));
        out.quaternion.copy(anchor.quaternion);
        this.arms.set(side, out, side === 'r' ? GRIP_R : GRIP_L);
      }
    } else if (hand) {
      // The left hand: down out of sight for the rocket, then up with it to the mouth and in
      const t = this.reloadT;
      const lh = this.loadHand;
      lh.visible = !this.pushed;
      const grip0 = this.model.grips.l.position;
      const low = new THREE.Vector3(-0.12, -0.5, -0.05);
      const below = new THREE.Vector3(-0.02, -0.12, MOUTH - 0.42);
      const inMouth = new THREE.Vector3(0, -0.02, MOUTH - 0.3);
      const out = new THREE.Vector3(-0.06, -0.14, MOUTH - 0.2);
      if (t < 0.45) lh.position.lerpVectors(grip0, low, smooth((t - 0.15) / 0.3));
      else if (t < 0.85) lh.position.lerpVectors(low, below, smooth((t - 0.45) / 0.4));
      else if (t < 1.1) lh.position.lerpVectors(below, inMouth, smooth((t - 0.85) / 0.25));
      else if (t < 1.3) lh.position.lerpVectors(inMouth, out, smooth((t - 1.1) / 0.2));
      else lh.position.lerpVectors(out, grip0, smooth((t - 1.3) / (RELOAD - 0.2 - 1.3)));
      lh.rotation.set(0, 0, 0);
      this.arms.set('r', this.model.grips.r, GRIP_R);
      this.arms.set('l', lh, GRIP_ROCKET);
    } else {
      this.loadHand.visible = false;
      this.arms.set('r', this.model.grips.r, GRIP_R);
      this.arms.set('l', this.model.grips.l, GRIP_L);
    }
    this.arms.update();
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
