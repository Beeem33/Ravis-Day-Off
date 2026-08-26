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
  /** 'grab' | 'draw' | 'stab' (first, the kill) | 'stab2' | 'stab3' | 'done' */
  onEvent: ((e: 'grab' | 'draw' | 'stab' | 'stab2' | 'stab3' | 'done') => void) | null = null;

  static readonly GRAB_T = 0.35;
  static readonly DRAW_T = 0.5;
  static readonly STAB_T = 2.0;
  static readonly STAB_CYCLE = 0.34; // per-stab rhythm of the triple
  static readonly DIE_T = 2.25;
  static readonly TOTAL_T = 3.75;

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
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.3), skin);
      fore.position.set(0, -0.02, 0.19);
      group.add(fore);
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.07), sleeve);
      cuff.position.set(0, -0.02, 0.33);
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
    mkArm(this.armL, true);
    mkArm(this.armR, false);

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
    this.knife.position.set(0, 0.045, -0.04);
    this.armR.add(this.knife);

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

  private event(name: 'grab' | 'draw' | 'stab' | 'stab2' | 'stab3' | 'done'): void {
    if (this.fired.has(name)) return;
    this.fired.add(name);
    this.onEvent?.(name);
  }

  /** 0..1 how violently the pair is struggling right now (for camera shake). */
  get struggle(): number {
    if (!this.active) return 0;
    const T = TakedownViewmodel;
    if (this.t < T.GRAB_T || this.t > T.STAB_T + T.STAB_CYCLE * 3) return 0;
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

    // ---- Left arm: from low off-screen up to clamp the face (screen right
    // of centre — the right side of their face as Ravi sees it)
    const lFrom = new THREE.Vector3(-0.42, -0.5, -0.25);
    const lGrab = new THREE.Vector3(0.13, -0.01, -0.62);
    const reach = ease(c01(t / T.GRAB_T));
    // After the LAST stab: drop back out of frame
    const out = ease(c01((t - (T.TOTAL_T - 0.55)) / 0.5));
    this.armL.position.lerpVectors(lFrom, lGrab, reach);
    this.armL.position.x += jx;
    this.armL.position.y += jy;
    this.armL.position.z += jz;
    this.armL.rotation.set(-0.5 + 0.45 * reach + jy * 3, 0.5 - 0.35 * reach, 0.35 - 0.35 * reach);
    if (reach >= 1) this.event('grab');

    // ---- Right arm: waits at the hip, draws the knife, holds ready during
    // the struggle, then drives up under the jaw
    const rPocket = new THREE.Vector3(0.3, -0.55, -0.2);
    const rReady = new THREE.Vector3(0.26, -0.3, -0.38);
    const rStab = new THREE.Vector3(0.03, -0.08, -0.72); // full extension — the blade buries in the held throat
    // The forearm stays low so the cuff never swallows the frame — it's the
    // KNIFE that pitches up for the thrust, in the hand.
    if (t < T.DRAW_T) {
      this.armR.position.copy(rPocket);
      this.armR.rotation.set(-0.25, -0.2, 0);
      this.knife.rotation.set(-0.15, 0, 0);
    } else if (t < T.STAB_T) {
      const k = ease(c01((t - T.DRAW_T) / 0.3));
      this.event('draw');
      this.armR.position.lerpVectors(rPocket, rReady, k);
      this.armR.position.x += jx * 0.7;
      this.armR.position.y += jy * 0.7;
      // Hand turned in so the blade reads in profile, not edge-on
      this.armR.rotation.set(-0.35 * k - 0.25 * (1 - k) + jy * 2, -0.55 * k - 0.2 * (1 - k), 0.1 * k);
      this.knife.rotation.set(-0.15 - 0.3 * k, 0, 0.35 * k); // blade cocked upward, ready
    } else {
      // THREE fast stabs. The arm drives past the grab hand so the blade
      // visibly buries in the throat (the enemy is held ~0.95m out; the tip
      // reaches ~1.15m at full extension), rips back to mid, drives in again.
      const rPull = new THREE.Vector3(0.17, -0.17, -0.42); // between stabs: blade back out, still up
      const tt = t - T.STAB_T;
      const idx = Math.min(2, Math.floor(tt / T.STAB_CYCLE));
      const ph = tt - idx * T.STAB_CYCLE;
      let k: number;
      if (ph < 0.11) k = ease(c01(ph / 0.11)); // drive in hard
      else if (ph < 0.19) k = 1; // buried to the guard
      else if (idx < 2) k = 1 - ease(c01((ph - 0.19) / 0.12)); // rip it back out
      else k = 1 - 0.3 * ease(c01((ph - 0.19) / 0.5)); // the last one stays in and sags
      const from = idx === 0 ? rReady : rPull;
      this.armR.position.lerpVectors(from, rStab, k);
      this.armR.position.x += jx;
      this.armR.position.y += jy;
      const grind = k >= 1 ? Math.sin(t * 22) * 0.04 : 0;
      this.armR.rotation.set(-0.5 * k - 0.3 * (1 - k) + grind, -0.45 + 0.2 * k, 0.1 + grind * 0.6);
      // Blade stays near-level so the thrust reads as INTO the throat, not up past it
      this.knife.rotation.set(-0.28 - 0.17 * k + grind, 0, 0.3 - 0.2 * k + grind * 0.4);
      if (k >= 1) this.event(idx === 0 ? 'stab' : idx === 1 ? 'stab2' : 'stab3');
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
