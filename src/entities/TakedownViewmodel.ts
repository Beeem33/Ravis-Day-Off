import * as THREE from 'three';
import { FirstPersonArms, HAND, grip, mixGrip } from './RaviVisual';

/** One stab, two, or the counter: he catches the knife and gets two punches instead. */
export type TakedownVariant = 'single' | 'double' | 'counter';
export type TakedownEvent = 'grab' | 'draw' | 'stab' | 'caught' | 'swing' | 'punch' | 'release' | 'done';

/**
 * Ravi's hands on the takedown's anchors. The right is a fist round the
 * bowie's handle (in the knife's frame), knuckles across, blade out of the
 * little-finger side, so it turns with the knife. The left (in its arm's
 * frame) is flat on the man's chest, fingers up, and balls into a fist with
 * the knuckles leading when the counter's punches come.
 */
const GRIP_KNIFE = grip([0.075, 0.026, 0], [-1, 0, 0], [0, -1, 0], [0.75, -0.1, 0.65], HAND.fist);
const GRIP_CLAMP = grip([0, -0.035, 0.03], [0, 0.9, -0.4], [0, -0.4, -0.9], [0, -0.2, 1], {
  fingers: [[18, 22, 10], [16, 20, 10], [18, 22, 10], [20, 24, 12]],
  thumb: [0.2, 0.1, 0.1],
  spread: 8
});
const GRIP_FIST = grip([0, 0, 0.045], [0, 0.1, -1], [0, -1, -0.1], [0, -0.05, 1], HAND.fist);

/**
 * TakedownViewmodel — Ravi's arms for the knife execution, parented to the
 * camera like the weapon viewmodels. The left hand reaches in and takes hold
 * of him while the right pulls a bowie knife from the hip and, after a
 * struggle, drives it into his side — the side on Ravi's right, so each arm
 * stays on its own half of the frame and neither ever reaches across.
 *
 * It ends one of three ways, rolled on every start: one stab, two, or the
 * counter — he catches the knife arm short of his stomach and holds it off,
 * so Ravi lets go with his left and puts him down with a fist to the gut and
 * a hook to the side of the head.
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
  /** How this one ends — rolled by start(). */
  variant: TakedownVariant = 'single';
  /** How many times the blade goes in (0 on a counter). */
  stabs = 1;
  private releaseT = TakedownViewmodel.RELEASE_T;
  private totalT = TakedownViewmodel.RELEASE_T + TakedownViewmodel.TAIL;
  /**
   * 'stab' fires once per thrust with `index` 0 or 1, and 'release' is the
   * kill. On a counter there is no 'stab' or 'release': 'caught' is him
   * getting both hands on the knife arm, 'swing' each fist setting off, and
   * 'punch' each one landing — index 1, the hook, is the kill.
   */
  onEvent: ((e: TakedownEvent, index: number) => void) | null = null;

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
  // The counter. The thrust starts as always and he catches it 30% of the
  // way, a hand's breadth short of him; Ravi's left comes off his chest as he
  // steps in, and throws two. Each punch is held cocked in frame before it
  // goes — at 8 frames a swing, one that starts off-screen is never seen.
  static readonly CATCH_T = 1.32;
  static readonly LETGO_T = 1.45;
  static readonly STEP_T = 1.7; // stepped in, fist chambered low
  static readonly JAB_T = 1.78;
  static readonly JAB_HIT = 1.88;
  static readonly JAB_OUT = 2.02; // left in him while he folds over it
  static readonly HOOK_T = 2.32; // wound up out wide, level with his head
  static readonly HOOK_HIT = 2.44;

  /**
   * Where the knife arm is caught, found by sweeping it against his reach.
   * The knife is over half a metre fist to point, so any catch far enough out
   * to keep the point off him is also out of his arms' 0.6m reach: 30% of the
   * way down the thrust left his hands 25-55cm short. So it's caught close —
   * the fist a quarter of a metre off his stomach, near his centreline where
   * both hands can get to it — and the blade is turned hard out (`twist`) so
   * it runs past his flank instead of into him. Measured: both hands on the
   * arm to within the struggle's own wobble, the whole blade 10cm clear.
   */
  private static readonly CATCH = {
    at: new THREE.Vector3(0.08, -0.26, -0.74),
    // He forces it aside and down — low enough that the tangle of hands is
    // under his stomach, not in front of it where the gut punch has to land
    push: new THREE.Vector3(0.06, -0.08, 0),
    twist: -1.45,
    armYaw: 0.4
  };
  /**
   * How far Ravi actually stands off the man this frame, fed by the scene.
   * The camera eases toward standOff rather than sitting on it, so anything
   * that has to stay put in the world while he steps in has to use this.
   */
  gap = 0.95;
  private gapAtCatch = 0.95;

  /** His stomach and head in the arms' own space, fed by aimAt() every frame. */
  private belly = new THREE.Vector3(0, -0.26, -0.62);
  private head = new THREE.Vector3(0, 0.02, -0.72);
  /** The grab hand's fingers: splayed to clamp, curled into a fist to punch. */
  private fingers: THREE.Mesh[] = [];
  private gripHand: THREE.Mesh | null = null;
  private static _q = new THREE.Quaternion();
  private static _d = new THREE.Vector3();
  private static readonly FWD = new THREE.Vector3(0, 0, -1);
  /** Ravi's own arms, laid onto the two arm anchors each frame. */
  private arms: FirstPersonArms;

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
        this.gripHand = hand;
        // Fingers splayed forward — a clamping grip, not a fist
        for (let i = 0; i < 4; i++) {
          const finger = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.05, 0.016), skin);
          finger.position.set(-0.015 + i * 0.012, 0.045, -0.03 + (i === 0 || i === 3 ? 0.008 : 0));
          finger.rotation.x = -0.35;
          group.add(finger);
          this.fingers.push(finger);
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

    // Ravi's real arms ride the knife and the grab arm; the boxes stop drawing once his model is in
    this.arms = new FirstPersonArms(this.root, camera).set('r', this.knife, GRIP_KNIFE).set('l', this.armL, GRIP_CLAMP);
    this.arms.replaces(skin, sleeve);
  }

  /**
   * Begin. Half the time he counters; the other half is the knife, once or
   * twice with even odds. Pass a variant to pin it (tests, anything scripted).
   */
  start(variant: TakedownVariant = TakedownViewmodel.roll()): void {
    const T = TakedownViewmodel;
    this.variant = variant;
    this.stabs = variant === 'double' ? 2 : variant === 'single' ? 1 : 0;
    // On a counter the hook is the end of it: that's when the jitter stops
    this.releaseT = variant === 'double' ? T.RELEASE2_T : variant === 'single' ? T.RELEASE_T : T.HOOK_HIT;
    this.totalT = variant === 'counter' ? T.HOOK_HIT + 0.8 : this.releaseT + T.TAIL;
    this.active = true;
    this.t = 0;
    this.fired.clear();
    this.root.visible = true;
    this.makeFist(0);
  }

  /**
   * 0 the grab's open clamp .. 1 a fist: the hand balls up wider than the
   * wrist and the fingers roll forward into a row of knuckles along its top
   * edge. From behind, that lumpy knob is what says "fist" — a plain box the
   * width of the forearm read as the end of a plank.
   */
  private makeFist(k: number): void {
    this.arms?.set('l', this.armL, mixGrip(GRIP_CLAMP, GRIP_FIST, k));
    this.gripHand?.scale.set(1 + 0.22 * k, 1 + 0.1 * k, 1 - 0.08 * k);
    this.fingers.forEach((f, i) => {
      const x = (-0.015 + i * 0.012) * (1 + 0.25 * k);
      const zOpen = -0.03 + (i === 0 || i === 3 ? 0.008 : 0);
      const zFist = -0.046 + (i === 1 || i === 2 ? -0.004 : 0);
      f.position.set(x, 0.045 + (0.03 - 0.045) * k, zOpen + (zFist - zOpen) * k);
      f.rotation.x = -0.35 + (1.25 + 0.35) * k;
      f.scale.set(1 + 0.35 * k, 1, 1 + 0.25 * k);
    });
  }

  /** Hard stop (player died mid-takedown) — arms vanish, no 'done' event. */
  abort(): void {
    this.active = false;
    this.root.visible = false;
  }

  private static roll(): TakedownVariant {
    const r = Math.random();
    return r < 0.5 ? 'counter' : r < 0.75 ? 'single' : 'double';
  }

  /**
   * How far off the man Ravi stands. The knife reaches from where the grab
   * puts him; a fist doesn't, so on a counter he steps in as his left hand
   * comes off — the scene closes the gap to this.
   */
  get standOff(): number {
    if (this.variant !== 'counter') return 0.95;
    const T = TakedownViewmodel;
    const k = Math.min(1, Math.max(0, (this.t - T.LETGO_T) / (T.STEP_T - T.LETGO_T)));
    return 0.95 - 0.21 * k * k * (3 - 2 * k);
  }

  /**
   * Ravi's weight going into each punch, as a nudge on the camera: a lunge
   * and a dip into the gut punch, a turn to the right and a roll with the
   * hook. Builds over the swing, snaps at the hit, dies away. Call after the
   * player has set the camera for the frame; it's rewritten every frame, so
   * nothing accumulates.
   */
  applyJolt(camera: THREE.Camera): void {
    if (!this.active || this.variant !== 'counter') return;
    const T = TakedownViewmodel;
    const t = this.t;
    const pulse = (t0: number, t1: number) => {
      if (t < t0) return 0;
      if (t < t1) {
        const u = (t - t0) / (t1 - t0);
        return u * u;
      }
      return Math.exp(-(t - t1) * 8);
    };
    const jab = pulse(T.JAB_T, T.JAB_HIT);
    const hook = pulse(T.HOOK_T, T.HOOK_HIT);
    camera.translateZ(-0.05 * jab - 0.035 * hook);
    camera.rotateX(-0.03 * jab);
    camera.rotateY(-0.07 * hook);
    camera.rotateZ(-0.035 * hook);
  }

  /** Where his stomach and head are this frame, in world space — the two fists aim at these. */
  aimAt(belly: THREE.Vector3, head: THREE.Vector3): void {
    // Frozen once the hook has landed: his head is going somewhere else by
    // then, and the follow-through must not chase it
    if (this.t > TakedownViewmodel.HOOK_HIT) return;
    this.root.updateWorldMatrix(true, false);
    this.root.worldToLocal(this.belly.copy(belly));
    this.root.worldToLocal(this.head.copy(head));
  }

  private event(name: TakedownEvent, index = 0): void {
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
  holdPoints(a: THREE.Vector3, b: THREE.Vector3, knife: THREE.Vector3, knife2: THREE.Vector3): void {
    this.root.updateWorldMatrix(true, true);
    this.armL.localToWorld(a.set(0, -0.02, 0.06));
    this.armL.localToWorld(b.set(0, 0.03, 0));
    this.armR.localToWorld(knife.set(0, -0.01, 0.1));
    // The top of the fist, for the hand that crosses his body to catch it —
    // the nearest part of the arm to him
    this.armR.localToWorld(knife2.set(0, 0.03, -0.01));
  }

  /**
   * The counter's knife arm. Driven at him as always, but his hands meet it
   * on the way in: the point is wrenched out past his flank and the arm
   * stops dead a quarter of a metre off his stomach, then is forced further
   * aside and down, shaking with the struggle. It is in his hands, so it
   * stays put in the world while Ravi steps in — back toward the camera by
   * however far Ravi has actually moved.
   */
  private counterKnife(t: number, kCock: THREE.Vector3, kPocket: THREE.Vector3, jx: number, jy: number): void {
    const T = TakedownViewmodel;
    const c01 = (x: number) => Math.min(1, Math.max(0, x));
    const ease = (x: number) => x * x * (3 - 2 * x);
    const C = TakedownViewmodel.CATCH;
    // His hands go for it the moment it moves, so they meet it on the way in
    if (t >= T.STAB_T + 0.02) this.event('caught');
    // Driven in, and wrenched aside as it goes: the point is turned out past
    // him before the fist gets close. It stops dead rather than landing.
    const k = ease(c01((t - T.STAB_T) / (T.CATCH_T + 0.03 - T.STAB_T)));
    if (t < T.CATCH_T) this.gapAtCatch = this.gap;
    const w = ease(c01((t - T.CATCH_T) / 0.2)); // then forced further aside and down
    this.armR.position.lerpVectors(kCock, C.at, k);
    this.armR.position.x += C.push.x * w + jx * k;
    this.armR.position.y += C.push.y * w + jy * k;
    this.armR.position.z += C.push.z * w + (this.gapAtCatch - this.gap);
    this.armR.rotation.set(0.2 - 0.05 * w + jy * 2 * k, 0.3 + (C.armYaw - 0.3) * k, -0.08 - 0.2 * w);
    this.knife.rotation.set(-0.1, 0.1 + (C.twist - 0.1) * ease(c01((t - T.STAB_T) / 0.08)), 0);
    // He's dead: nothing holding it now, and it drops away
    const drop = ease(c01((t - T.HOOK_HIT - 0.08) / 0.35));
    if (drop > 0) this.armR.position.lerp(kPocket, drop);
  }

  /**
   * The counter's left hand: off his chest and balled into a fist, drawn
   * back low on the left of the frame and HELD there a moment so you see it
   * coming, then a short straight shot into his stomach that stays in him
   * while he folds over it. Out wide again, cocked beside Ravi's head in
   * frame, and a hook swung round into the side of his. Both accelerate into
   * what they hit — a punch that eases into its target reads as a push.
   *
   * The fist is aimed from where his body actually is (aimAt), because by
   * the time it lands he has leaned from the knife and been folded by the
   * first one; the knuckles are 4.5cm in front of the arm's origin, so
   * that's where the arm stops short of the target.
   */
  private counterLeft(t: number, grab: THREE.Vector3): void {
    const T = TakedownViewmodel;
    const c01 = (x: number) => Math.min(1, Math.max(0, x));
    const ease = (x: number) => x * x * (3 - 2 * x);
    const V = THREE.Vector3;
    const K = 0.045;
    // Chambered low on the left, well inside the frame; the last few cm of
    // the hold are the fist drawing back, loading
    const load1 = new V(-0.17, -0.11, -0.38);
    const cock1 = new V(-0.19, -0.12, -0.33);
    // Cocked out wide beside his own head for the hook — at the frame's edge,
    // not past it
    const load2 = new V(-0.3, 0.03, -0.42);
    const cock2 = new V(-0.34, 0.05, -0.38);
    const jabDir = new V().subVectors(this.belly, cock1).normalize();
    const jabAt = new V().copy(this.belly).addScaledVector(jabDir, -K);
    // The near side of his head, and a control point out wide of it so the
    // fist comes round rather than straight in
    const temple = new V(this.head.x - 0.12, this.head.y, this.head.z);
    const ctrl = new V(temple.x - 0.2, temple.y + 0.02, temple.z + 0.06);
    const hookDir = new V().subVectors(temple, ctrl).normalize();
    const hookAt = new V().copy(temple).addScaledVector(hookDir, -K);
    // The grab's own facing, so letting go doesn't snap the wrist round
    const grabDir = TakedownViewmodel._d.set(0, 0, -1).applyEuler(new THREE.Euler(-0.05, -0.15, 0));
    const toCtrl = new V().subVectors(ctrl, cock2).normalize();

    this.makeFist(ease(c01((t - T.LETGO_T) / 0.12)));
    const pos = new V();
    const dir = new V();
    if (t < T.STEP_T) {
      // Off his chest and back to the chamber as Ravi steps in
      const k = ease(c01((t - T.LETGO_T) / (T.STEP_T - T.LETGO_T)));
      pos.lerpVectors(grab, load1, k);
      dir.lerpVectors(grabDir, jabDir, k);
    } else if (t < T.JAB_T) {
      const k = ease(c01((t - T.STEP_T) / (T.JAB_T - T.STEP_T)));
      pos.lerpVectors(load1, cock1, k);
      dir.copy(jabDir);
    } else if (t < T.JAB_OUT) {
      this.event('swing', 0);
      const k = c01((t - T.JAB_T) / (T.JAB_HIT - T.JAB_T));
      pos.lerpVectors(cock1, jabAt, k * k * k);
      dir.copy(jabDir);
      if (k >= 1) {
        this.event('punch', 0);
        // Driven on in as he folds round it, riding his stomach down
        pos.addScaledVector(jabDir, 0.03 * ease(c01((t - T.JAB_HIT) / 0.06)));
      }
    } else if (t < T.HOOK_T) {
      // Back out of him and out wide, turning the fist to come round — then
      // held there, loading
      const k = ease(c01((t - T.JAB_OUT) / (T.HOOK_T - 0.07 - T.JAB_OUT)));
      const c = ease(c01((t - (T.HOOK_T - 0.07)) / 0.07));
      pos.lerpVectors(jabAt, load2, k).lerp(cock2, c);
      dir.lerpVectors(jabDir, toCtrl, k);
    } else if (t < T.HOOK_HIT) {
      this.event('swing', 1);
      const u = c01((t - T.HOOK_T) / (T.HOOK_HIT - T.HOOK_T));
      const e = u * u;
      // Quadratic Bézier, and its tangent for which way the knuckles face
      pos.copy(cock2).multiplyScalar((1 - e) * (1 - e)).addScaledVector(ctrl, 2 * e * (1 - e)).addScaledVector(hookAt, e * e);
      dir.copy(ctrl).sub(cock2).multiplyScalar(1 - e).add(new V().subVectors(hookAt, ctrl).multiplyScalar(e));
    } else {
      this.event('punch', 1);
      // Through where his head was, then away
      const k = ease(c01((t - T.HOOK_HIT) / 0.14));
      pos.copy(hookAt).addScaledVector(hookDir, 0.1 * k);
      pos.y -= 0.12 * ease(c01((t - T.HOOK_HIT - 0.14) / 0.3));
      dir.copy(hookDir);
    }
    this.armL.position.copy(pos);
    this.armL.quaternion.setFromUnitVectors(TakedownViewmodel.FWD, dir.normalize());
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
    if (this.variant === 'counter' && t >= T.LETGO_T) this.counterLeft(t, gGrab);

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
    } else if (this.variant === 'counter') {
      this.counterKnife(t, kCock, kPocket, jx, jy);
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
    this.arms.update();

    if (t >= this.totalT) {
      this.active = false;
      this.root.visible = false;
      this.event('done');
    }
  }
}
