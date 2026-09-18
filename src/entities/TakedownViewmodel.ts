import * as THREE from 'three';

/**
 * TakedownViewmodel — Ravi's arms for the knife execution, parented to the
 * camera like the weapon viewmodels. The left hand reaches in and takes hold
 * of him while the right pulls a bowie knife from the hip and, after a
 * struggle, drives it into his side — the side on Ravi's right, so each arm
 * stays on its own half of the frame and neither ever reaches across. Half
 * the time it comes out and goes in again.
 *
 * The scene owns the choreography (locking the camera on the target); this
 * class only animates the arms and reports timeline events.
 */
export class TakedownViewmodel {
  readonly root = new THREE.Group();
  /** Left arm: the grab. */
  private armL = new THREE.Group();
  /** Right arm: the knife. */
  private armR = new THREE.Group();
  private knife = new THREE.Group();

  active = false;
  private t = 0;
  private fired = new Set<string>();
  /** How many times the blade goes in this time — rolled by start(). */
  stabs: 1 | 2 = 1;
  private releaseT = TakedownViewmodel.RELEASE_T;
  private totalT = TakedownViewmodel.RELEASE_T + TakedownViewmodel.TAIL;
  /** 'stab' fires once per thrust with `index` 0 or 1; 'release' is the kill. */
  onEvent: ((e: 'grab' | 'draw' | 'stab' | 'release' | 'done', index: number) => void) | null = null;

  static readonly GRAB_T = 0.35;
  static readonly DRAW_T = 0.5;
  static readonly RAISE_T = 1.0; // knife drawn back at the hip, ready
  static readonly STAB_T = 1.25; // the first thrust starts…
  static readonly THRUST = 0.13; // …and lands this much later
  // A double only: the blade comes most of the way back out, and goes in again
  static readonly PULL_T = 1.6;
  static readonly STAB2_T = 1.74;
  // He lets go — and only now do they fall. Later when there are two.
  static readonly RELEASE_T = 1.75;
  static readonly RELEASE2_T = 2.25;
  /** Release to both arms out of frame. */
  static readonly TAIL = 0.7;

  constructor(camera: THREE.PerspectiveCamera) {
    camera.add(this.root);
    this.root.visible = false;

    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5c3b, roughness: 0.85 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4d6f9c, roughness: 0.9 });
    // Half as metallic as real steel would be. The scene has no environment
    // map, so a 0.9-metal blade has almost nothing to reflect and renders
    // near-black — the stab read as a dark stick going into a dark suit.
    const steel = new THREE.MeshStandardMaterial({ color: 0xc4c8cf, roughness: 0.32, metalness: 0.45 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.7 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x3f2a18, roughness: 0.85 });

    // An arm: forearm running back toward the shoulder, cuff, hand
    const mkArm = (group: THREE.Group, handOpen: boolean) => {
      // Runs well back past the near plane: at full extension a 0.3 forearm
      // stopped in mid-air in front of the camera and you saw the end of it.
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.66), skin);
      fore.position.set(0, -0.02, 0.36);
      group.add(fore);
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.078, 0.09), sleeve);
      cuff.position.set(0, -0.02, 0.2);
      group.add(cuff);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.09), skin);
      group.add(hand);
      if (handOpen) {
        // Fingers splayed forward — a clamping grip, not a fist
        for (let i = 0; i < 4; i++) {
          const finger = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.05, 0.016), skin);
          finger.position.set(-0.015 + i * 0.012, 0.045, -0.03 + (i === 0 || i === 3 ? 0.008 : 0));
          finger.rotation.x = -0.35;
          group.add(finger);
        }
      }
    };
    // LEFT hand does the grabbing (open fingers); RIGHT hand holds the knife
    mkArm(this.armR, false);
    mkArm(this.armL, true);

    // Bowie knife in the right hand: broad clip-point blade, brass guard,
    // wooden handle. Blade runs along -Z with the edge up for the thrust.
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.035, 0.11), wood);
    this.knife.add(handle);
    const pommel = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.04, 0.018), darkSteel);
    pommel.position.set(0, 0, 0.06);
    this.knife.add(pommel);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.085, 0.014), darkSteel);
    guard.position.set(0, 0, -0.06);
    this.knife.add(guard);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.055, 0.38), steel);
    blade.position.set(0, 0.005, -0.255);
    this.knife.add(blade);
    // Clip point: a narrowing tip section angled down to a point
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.034, 0.09), steel);
    tip.position.set(0, -0.005, -0.485);
    tip.rotation.x = -0.16;
    this.knife.add(tip);
    // Fuller groove line along the flat
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.0095, 0.009, 0.33), darkSteel);
    fuller.position.set(0, 0.02, -0.24);
    this.knife.add(fuller);
    // ICEPICK grip: the handle sits IN the fist and the blade exits the
    // pinky side — under the hand — so the overhand strike reads right-way-up.
    this.knife.position.set(0, -0.055, -0.025);
    this.armR.add(this.knife);

    this.root.add(this.armR);
    this.root.add(this.armL);
  }

  /**
   * Begin. Half the time he goes in twice — the only chance in the move, and
   * enough that it doesn't play out identically every time. Pass `stabs` to
   * pin it (tests, anything scripted).
   */
  start(stabs: 1 | 2 = Math.random() < 0.5 ? 2 : 1): void {
    const T = TakedownViewmodel;
    this.stabs = stabs;
    this.releaseT = stabs === 2 ? T.RELEASE2_T : T.RELEASE_T;
    this.totalT = this.releaseT + T.TAIL;
    this.active = true;
    this.t = 0;
    this.fired.clear();
    this.root.visible = true;
  }

  /** Hard stop (player died mid-takedown) — arms vanish, no 'done' event. */
  abort(): void {
    this.active = false;
    this.root.visible = false;
  }

  private event(name: 'grab' | 'draw' | 'stab' | 'release' | 'done', index = 0): void {
    const key = name + index;
    if (this.fired.has(key)) return;
    this.fired.add(key);
    this.onEvent?.(name, index);
  }

  /** 0..1 how violently the pair is struggling right now (drives the arm jitter). */
  get struggle(): number {
    if (!this.active) return 0;
    const T = TakedownViewmodel;
    if (this.t < T.GRAB_T || this.t > this.releaseT + 0.2) return 0;
    if (this.t > T.STAB_T) return 1.4; // the stabs kick hardest
    return Math.min(1, (this.t - T.GRAB_T) / 0.4);
  }

  /**
   * 0..1 how far into "cutscene" the frame should be — the letterbox, the
   * tighter lens, the grade. Up over the first third of a second; down over
   * the last half, so the bars are already opening as the arms drop away.
   */
  get cinema(): number {
    if (!this.active) return 0;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));
    return ease(c01(this.t / 0.35)) * (1 - ease(c01((this.t - (this.totalT - 0.5)) / 0.5)));
  }

  /**
   * Where the victim can take hold of Ravi, in world space: the wrist of the
   * hand that has him, the back of that hand, and the knife wrist. Call
   * after the camera has moved for the frame.
   *
   * The second point is the hand itself because it is on his chest, inside
   * his reach from either shoulder. A point further up Ravi's forearm was
   * 13cm beyond what his left arm could reach across his own body.
   */
  holdPoints(a: THREE.Vector3, b: THREE.Vector3, knife: THREE.Vector3): void {
    this.root.updateWorldMatrix(true, true);
    this.armL.localToWorld(a.set(0, -0.02, 0.06));
    this.armL.localToWorld(b.set(0, 0.03, 0));
    this.armR.localToWorld(knife.set(0, -0.01, 0.1));
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const T = TakedownViewmodel;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));

    // Struggle jitter shared by both arms — two incommensurate sines so it
    // reads as fighting, not vibrating
    const s = this.struggle;
    const jx = (Math.sin(t * 13.2) * 0.6 + Math.sin(t * 7.7 + 2.1) * 0.4) * 0.014 * s;
    const jy = (Math.sin(t * 11.4 + 0.8) * 0.6 + Math.sin(t * 8.9 + 3.0) * 0.4) * 0.012 * s;
    const jz = Math.sin(t * 9.6 + 1.5) * 0.012 * s;

    // ---- LEFT arm: up from low off-screen LEFT to take hold of him, just
    // left of centre. It used to swing in from the lower right, which only
    // worked while the knife was on the left; with the knife on the right
    // now, coming from that side would sweep it straight through the draw.
    const gFrom = new THREE.Vector3(-0.42, -0.5, -0.25);
    const gGrab = new THREE.Vector3(-0.055, -0.03, -0.56);
    // The grab hand holds them up the whole time — and LETS GO at the release
    const reach = ease(c01(t / T.GRAB_T)) * (1 - ease(c01((t - this.releaseT) / 0.3)));
    // After the release: drop back out of frame
    const out = ease(c01((t - (this.totalT - 0.55)) / 0.5));
    this.armL.position.lerpVectors(gFrom, gGrab, reach);
    this.armL.position.x += jx;
    this.armL.position.y += jy;
    this.armL.position.z += jz;
    this.armL.rotation.set(-0.5 + 0.45 * reach + jy * 3, -(0.5 - 0.35 * reach), -(0.35 - 0.35 * reach));
    if (reach >= 1) this.event('grab');

    // ---- RIGHT arm: draws the knife from his right hip and drives it
    // straight into the side of the man that is on Ravi's right — the same
    // side it came from, then keeps it buried there until the release. The
    // yaw on this arm is what makes it read as a RIGHT arm: it swings the
    // forearm's back end out toward the right shoulder. Put the hand left of
    // centre with that yaw (as it used to be) and the forearm has to come up
    // out of the middle of the screen, which is the reach-across that looked
    // wrong.
    //
    // Heights are against the takedown camera, which looks down about 18° at
    // his face from 0.95m: -0.2 at this depth is his waist, not his crotch.
    // The pitch on the arm is positive so its back end drops toward the elbow
    // at Ravi's hip — an underhand thrust, blade rising slightly into him.
    const kPocket = new THREE.Vector3(0.32, -0.55, -0.22);
    const kReady = new THREE.Vector3(0.3, -0.24, -0.42); // low and wide, blade forward
    const kCock = new THREE.Vector3(0.34, -0.29, -0.32); // a short pull-back before the thrust
    const kStab = new THREE.Vector3(0.19, -0.2, -0.58); // buried in his side
    const kPull = new THREE.Vector3(0.25, -0.24, -0.44); // a double: most of the way back out
    const kStab2 = new THREE.Vector3(0.18, -0.212, -0.61); // and in again, a touch deeper
    // One thrust and the hold after it. The wrist turns out as it drives,
    // against the arm's inward yaw, so the blade goes into his side rather
    // than angling across to his navel — the forearm still reads as coming
    // from the right shoulder.
    const drive = (from: THREE.Vector3, to: THREE.Vector3, t0: number, wrist0: number, index: number): void => {
      const k = ease(c01((t - t0) / T.THRUST));
      this.armR.position.lerpVectors(from, to, k);
      this.armR.position.x += jx;
      this.armR.position.y += jy;
      const held = t > t0 + T.THRUST;
      const grind = held ? Math.sin(t * 9) * 0.05 + Math.sin(t * 14.7) * 0.025 : 0;
      // Leaning his weight onto the buried knife
      this.armR.position.z += held ? Math.sin((t - t0) * 2.1) * 0.02 : 0;
      this.armR.rotation.set(0.2 + 0.1 * k + grind, 0.3 + 0.08 * k, -0.08 - grind * 0.5);
      this.knife.rotation.set(-0.1 - 0.15 * k + grind * 0.7, wrist0 + (-0.22 - wrist0) * k, 0);
      if (k >= 1) this.event('stab', index);
    };
    if (t < T.DRAW_T) {
      this.armR.position.copy(kPocket);
      this.armR.rotation.set(0.1, 0.3, 0);
      this.knife.rotation.set(-0.15, 0, 0);
    } else if (t < T.RAISE_T) {
      // Draw to the low ready, blade levelling out toward them
      const k = ease(c01((t - T.DRAW_T) / 0.3));
      this.event('draw');
      this.armR.position.lerpVectors(kPocket, kReady, k);
      this.armR.position.x += jx * 0.7;
      this.armR.position.y += jy * 0.7;
      this.armR.rotation.set(0.1 + 0.1 * k + jy * 2, 0.3, -0.08 * k);
      // Rolled a touch so the flat catches the camera; with the arm's own yaw
      // that's plenty for the blade to read
      this.knife.rotation.set(-0.15 + 0.05 * k, 0.1 * k, 0);
    } else if (t < T.STAB_T) {
      // A short pull-back — the piston loading
      const k = ease(c01((t - T.RAISE_T) / (T.STAB_T - T.RAISE_T)));
      this.armR.position.lerpVectors(kReady, kCock, k);
      this.armR.position.x += jx * 0.7;
      this.armR.position.y += jy * 0.7;
      this.armR.rotation.set(0.2 + jy * 2, 0.3, -0.08);
      this.knife.rotation.set(-0.1, 0.1, 0);
    } else if (t < this.releaseT) {
      if (this.stabs === 1 || t < T.PULL_T) {
        drive(kCock, kStab, T.STAB_T, 0.1, 0);
      } else if (t < T.STAB2_T) {
        // Most of the way back out — quick, and with his hands on the wrist
        const k = ease(c01((t - T.PULL_T) / (T.STAB2_T - T.PULL_T)));
        this.armR.position.lerpVectors(kStab, kPull, k);
        this.armR.position.x += jx;
        this.armR.position.y += jy;
        this.armR.rotation.set(0.3 - 0.1 * k, 0.38 - 0.08 * k, -0.08);
        this.knife.rotation.set(-0.25 + 0.15 * k, -0.22 + 0.12 * k, 0);
      } else {
        drive(kPull, kStab2, T.STAB2_T, -0.1, 1);
      }
    } else {
      // Let go: the left hand releases, the knife is wrenched back out —
      // and THAT is when they drop.
      const k = ease(c01((t - this.releaseT) / 0.3));
      this.event('release');
      this.armR.position.lerpVectors(this.stabs === 2 ? kStab2 : kStab, new THREE.Vector3(0.3, -0.36, -0.34), k);
      this.armR.rotation.set(0.3 - 0.5 * k, 0.38, -0.1);
      this.knife.rotation.set(-0.05 - 0.45 * k, -0.22 * (1 - k), -0.1 * k);
    }

    // Recover: everything sinks out of the frame together
    if (out > 0) {
      this.root.position.y = -0.6 * out;
      this.root.rotation.x = -0.5 * out;
    } else {
      this.root.position.y = 0;
      this.root.rotation.x = 0;
    }

    if (t >= this.totalT) {
      this.active = false;
      this.root.visible = false;
      this.event('done');
    }
  }
}
