import * as THREE from 'three';

/**
 * TakedownViewmodel — Ravi's arms for the knife execution, parented to the
 * camera like the weapon viewmodels. The left arm reaches out and clamps the
 * side of the target's face while the right hand pulls a bowie knife from
 * the hip and, after a struggle, drives it up under the jaw.
 *
 * The scene owns the choreography (locking the camera on the target); this
 * class only animates the arms and reports timeline events.
 */
export class TakedownViewmodel {
  readonly root = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private knife = new THREE.Group();

  active = false;
  private t = 0;
  private fired = new Set<string>();
  /** 'grab' | 'draw' | 'stab' (blade in, held) | 'release' (the kill) | 'done' */
  onEvent: ((e: 'grab' | 'draw' | 'stab' | 'release' | 'done') => void) | null = null;

  static readonly GRAB_T = 0.35;
  static readonly DRAW_T = 0.5;
  static readonly RAISE_T = 1.0; // knife drawn back at the hip, ready
  static readonly STAB_T = 1.25; // the straight thrust lands in the stomach
  static readonly RELEASE_T = 1.75; // he lets go — and only now do they fall

  static readonly DIE_T = 1.85;
  static readonly TOTAL_T = 2.45;

  constructor(camera: THREE.PerspectiveCamera) {
    camera.add(this.root);
    this.root.visible = false;

    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5c3b, roughness: 0.85 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4d6f9c, roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.25, metalness: 0.9 });
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
    // RIGHT hand does the grabbing (open fingers); LEFT hand holds the knife
    mkArm(this.armL, false);
    mkArm(this.armR, true);

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
    this.armL.add(this.knife);

    this.root.add(this.armL);
    this.root.add(this.armR);
  }

  start(): void {
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

  private event(name: 'grab' | 'draw' | 'stab' | 'release' | 'done'): void {
    if (this.fired.has(name)) return;
    this.fired.add(name);
    this.onEvent?.(name);
  }

  /** 0..1 how violently the pair is struggling right now (for camera shake). */
  get struggle(): number {
    if (!this.active) return 0;
    const T = TakedownViewmodel;
    if (this.t < T.GRAB_T || this.t > T.RELEASE_T + 0.2) return 0;
    if (this.t > T.STAB_T) return 1.4; // the stabs kick hardest
    return Math.min(1, (this.t - T.GRAB_T) / 0.4);
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

    // ---- RIGHT arm: from low off-screen up to clamp the face (screen left
    // of centre — the left side of their face as Ravi sees it)
    const gFrom = new THREE.Vector3(0.42, -0.5, -0.25);
    const gGrab = new THREE.Vector3(-0.055, -0.03, -0.56);
    // The grab hand holds them up the whole time — and LETS GO at the release
    const reach = ease(c01(t / T.GRAB_T)) * (1 - ease(c01((t - T.RELEASE_T) / 0.3)));
    // After the release: drop back out of frame
    const out = ease(c01((t - (T.TOTAL_T - 0.55)) / 0.5));
    this.armR.position.lerpVectors(gFrom, gGrab, reach);
    this.armR.position.x += jx;
    this.armR.position.y += jy;
    this.armR.position.z += jz;
    this.armR.rotation.set(-0.5 + 0.45 * reach + jy * 3, -(0.5 - 0.35 * reach), -(0.35 - 0.35 * reach));
    if (reach >= 1) this.event('grab');

    // ---- LEFT arm: draws the knife low at the hip and drives it STRAIGHT
    // forward into the stomach — no wind-up over the shoulder, no crossing
    // the grab arm — then keeps it buried there until the release.
    const kPocket = new THREE.Vector3(-0.3, -0.55, -0.2);
    const kReady = new THREE.Vector3(-0.28, -0.29, -0.34); // low and wide, blade forward
    const kCock = new THREE.Vector3(-0.32, -0.34, -0.22); // a short pull-back before the thrust
    const kStab = new THREE.Vector3(-0.13, -0.3, -0.58); // buried in the stomach
    if (t < T.DRAW_T) {
      this.armL.position.copy(kPocket);
      this.armL.rotation.set(-0.25, 0.2, 0);
      this.knife.rotation.set(-0.15, 0, 0);
    } else if (t < T.RAISE_T) {
      // Draw to the low ready, blade levelling out toward them
      const k = ease(c01((t - T.DRAW_T) / 0.3));
      this.event('draw');
      this.armL.position.lerpVectors(kPocket, kReady, k);
      this.armL.position.x += jx * 0.7;
      this.armL.position.y += jy * 0.7;
      this.armL.rotation.set(-0.25 + 0.1 * k + jy * 2, 0.2, -0.08 * k);
      this.knife.rotation.set(-0.15 + 0.05 * k, 0.4 * k, 0); // flat rolled to camera so the blade reads
    } else if (t < T.STAB_T) {
      // A short pull-back — the piston loading
      const k = ease(c01((t - T.RAISE_T) / (T.STAB_T - T.RAISE_T)));
      this.armL.position.lerpVectors(kReady, kCock, k);
      this.armL.position.x += jx * 0.7;
      this.armL.position.y += jy * 0.7;
      this.armL.rotation.set(-0.15 + jy * 2, 0.2, -0.08);
      this.knife.rotation.set(-0.1, 0.4, 0);
    } else if (t < T.RELEASE_T) {
      // The thrust: straight in at stomach height — then it STAYS there,
      // hand grinding on the handle while he holds them up.
      const k = ease(c01((t - T.STAB_T) / 0.13));
      this.armL.position.lerpVectors(kCock, kStab, k);
      this.armL.position.x += jx;
      this.armL.position.y += jy;
      const held = t > T.STAB_T + 0.13;
      const grind = held ? Math.sin(t * 9) * 0.05 + Math.sin(t * 14.7) * 0.025 : 0;
      // Leaning his weight onto the buried knife
      const lean = held ? Math.sin((t - T.STAB_T) * 2.1) * 0.02 : 0;
      this.armL.position.z += lean;
      this.armL.rotation.set(-0.12 + grind, 0.2 - 0.08 * k, -0.08 - grind * 0.5);
      // Blade level, nose dipped a touch — driving INTO the gut
      this.knife.rotation.set(-0.1 - 0.15 * k + grind * 0.7, 0.4 - 0.4 * k, 0);
      if (k >= 1) this.event('stab');
    } else {
      // Let go: the right hand releases, the knife is wrenched back out —
      // and THAT is when they drop.
      const k = ease(c01((t - T.RELEASE_T) / 0.3));
      this.event('release');
      this.armL.position.lerpVectors(kStab, new THREE.Vector3(-0.28, -0.38, -0.3), k);
      this.armL.rotation.set(-0.5 - 0.3 * k, 0.2, -0.1);
      this.knife.rotation.set(-0.05 - 0.45 * k, 0, -0.1 * k);
    }

    // Recover: everything sinks out of the frame together
    if (out > 0) {
      this.root.position.y = -0.6 * out;
      this.root.rotation.x = -0.5 * out;
    } else {
      this.root.position.y = 0;
      this.root.rotation.x = 0;
    }

    if (t >= T.TOTAL_T) {
      this.active = false;
      this.root.visible = false;
      this.event('done');
    }
  }
}
