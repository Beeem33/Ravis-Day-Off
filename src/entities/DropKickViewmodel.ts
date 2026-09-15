import * as THREE from 'three';
import type { FPSPlayer } from './FPSPlayer';

/**
 * DropKickViewmodel — Ravi's legs, and the ride they take the camera on.
 *
 * A drop kick is four separate things happening in under two seconds: a
 * coil, a leap with the body rotating past horizontal, both boots into a
 * chest, and then the landing flat on his back that he has to get up from.
 * The legs are the easy half. The camera is the move.
 *
 * The scene owns the consequences — who gets hit, when they die, whether
 * Ravi slides forward — and calls applyCamera() right after player.update()
 * so these offsets land on top of the normal eye position rather than
 * fighting it.
 */
export class DropKickViewmodel {
  readonly root = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private kneeL = new THREE.Group();
  private kneeR = new THREE.Group();

  active = false;
  /**
   * Did the boots actually find anybody? Set by the scene on impact. A whiff
   * that rattles the screen as hard as a connection is the single most
   * broken-looking thing this move can do.
   */
  hit = false;
  private t = 0;
  /** Camera roll, kept so the legs can be counter-rolled out of it. */
  private roll = 0;
  private legRoll = 0;
  private fired = new Set<string>();
  onEvent: ((e: 'launch' | 'impact' | 'land' | 'up' | 'done') => void) | null = null;

  static readonly COIL_T = 0.16; // knees bend, weight drops
  static readonly IMPACT_T = 0.4; // boots arrive
  static readonly LAND_T = 0.76; // his back arrives
  static readonly RISE_T = 1.02; // he starts getting up
  static readonly TOTAL_T = 1.78;

  /** Eye height flat on his back, measured from the floor. */
  private static readonly FLOOR_EYE = 0.33;

  constructor(camera: THREE.PerspectiveCamera) {
    camera.add(this.root);
    this.root.visible = false;

    // A faint emissive floor on all three. The kick happens wherever the
    // player presses Q, and on the dark floor a pair of unlit navy boxes
    // swinging up into frame is indistinguishable from nothing happening.
    const denim = new THREE.MeshStandardMaterial({ color: 0x415270, roughness: 0.92, emissive: 0x0a0e16 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x2c2724, roughness: 0.7, emissive: 0x0a0908 });
    const sole = new THREE.MeshStandardMaterial({ color: 0x494949, roughness: 0.95, emissive: 0x0b0b0b });

    // A leg, built along -Z from a hip pivot, so rotation.x alone swings it
    // from hanging under the camera to pointing straight out of the screen.
    const mkLeg = (leg: THREE.Group, knee: THREE.Group, side: number): void => {
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.15, 0.44), denim);
      thigh.position.set(0, 0, -0.22);
      leg.add(thigh);

      knee.position.set(0, 0, -0.44);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.125, 0.42), denim);
      shin.position.set(0, 0, -0.21);
      knee.add(shin);
      // Cuff bunched at the ankle — without it the trouser and the boot read
      // as one long box and the leg loses its joint
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.135, 0.07), denim);
      cuff.position.set(0, 0, -0.4);
      knee.add(cuff);

      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.115, 0.27), boot);
      shoe.position.set(0, -0.012, -0.55);
      knee.add(shoe);
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.03, 0.28), sole);
      tread.position.set(0, -0.062, -0.555);
      knee.add(tread);
      // The toe cap catches the light and tells you which way the foot points
      const toe = new THREE.Mesh(new THREE.BoxGeometry(0.118, 0.095, 0.05), boot);
      toe.position.set(0, -0.018, -0.685);
      knee.add(toe);

      leg.add(knee);
      // Hips at roughly a real stance width, set back so the thighs run away
      // from the camera rather than starting in front of the near plane.
      leg.position.set(side * 0.105, -0.24, 0.12);
      this.root.add(leg);
    };
    mkLeg(this.legL, this.kneeL, -1);
    mkLeg(this.legR, this.kneeR, 1);
    // The thighs run back past the camera for most of the move, so their
    // bounding spheres sit behind the near plane and three.js would cull the
    // legs outright — the same reason every weapon viewmodel does this.
    this.root.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  start(): boolean {
    if (this.active) return false;
    this.active = true;
    this.hit = false;
    this.roll = 0;
    this.legRoll = 0;
    this.t = 0;
    this.fired.clear();
    this.root.visible = true;
    return true;
  }

  /** Killed mid-kick: legs vanish, no 'done', the scene hands control back. */
  abort(): void {
    this.active = false;
    this.root.visible = false;
  }

  /** True from the first frame of the coil to the moment he is upright again. */
  get engaged(): boolean {
    return this.active;
  }

  /**
   * 0..1 of the way through the lunge. The scene slides Ravi toward his
   * target by this, so the leap covers real ground — the legs alone would
   * just be an animation played standing still.
   */
  get lunge(): number {
    if (!this.active) return 0;
    const D = DropKickViewmodel;
    const k = Math.min(1, Math.max(0, (this.t - D.COIL_T) / (D.IMPACT_T - D.COIL_T)));
    return k * k * (3 - 2 * k);
  }

  /** 0..1 shake for the scene to spend on whatever it likes. */
  get shake(): number {
    if (!this.active) return 0;
    const D = DropKickViewmodel;
    const sinceHit = this.t - D.IMPACT_T;
    const sinceLand = this.t - D.LAND_T;
    let s = 0;
    if (sinceHit >= 0 && sinceHit < 0.28) s = (1 - sinceHit / 0.28) * (this.hit ? 1 : 0.15);
    // The landing shakes either way — that one is his own back on the floor
    if (sinceLand >= 0 && sinceLand < 0.22) s = Math.max(s, 0.55 * (1 - sinceLand / 0.22));
    return s;
  }

  private event(name: 'launch' | 'impact' | 'land' | 'up' | 'done'): void {
    if (this.fired.has(name)) return;
    this.fired.add(name);
    this.onEvent?.(name);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const D = DropKickViewmodel;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));

    // Hip swing and knee fold, in the leg's own frame. Hanging is -1.5;
    // straight out of the screen is about -0.1. The knee is tucked at +1.9
    // and locked at 0.
    let hip: number;
    let knee: number;
    let spread = 0; // how far apart the boots are — they close on the target
    let dangle = 0; // the legs swinging under him while he's flat on his back

    if (t < D.COIL_T) {
      // Coiling: knees come up a little before they go anywhere
      const k = ease(c01(t / D.COIL_T));
      hip = -1.5 + 0.15 * k;
      knee = 1.55 + 0.35 * k;
      spread = 0.02 * k;
    } else if (t < D.IMPACT_T) {
      // The snap. The hip leads and the knee straightens LATE — a knee that
      // extends with the hip reads as a stiff-legged shove, not a kick.
      const k = ease(c01((t - D.COIL_T) / (D.IMPACT_T - D.COIL_T)));
      const late = ease(c01((k - 0.35) / 0.65));
      this.event('launch');
      hip = -1.35 + 1.27 * k;
      knee = 1.9 - 1.9 * late;
      spread = 0.02 - 0.05 * late;
    } else if (t < D.LAND_T) {
      // Contact, then the recoil: the boots stop dead and the knees buckle
      // back while the rest of him keeps going over.
      const k = ease(c01((t - D.IMPACT_T) / (D.LAND_T - D.IMPACT_T)));
      this.event('impact');
      hip = -0.08 - 0.5 * k;
      knee = 0.1 + 0.85 * k;
      spread = -0.03 + 0.1 * k;
    } else if (t < D.RISE_T) {
      // Flat on his back, legs folded up over him
      const k = ease(c01((t - D.LAND_T) / (D.RISE_T - D.LAND_T)));
      this.event('land');
      hip = -0.58 - 0.35 * k;
      knee = 0.95 + 0.5 * k;
      spread = 0.07;
      dangle = 0.1 * Math.sin((t - D.LAND_T) * 11) * (1 - k);
    } else {
      // Feet planted and he pushes up, so the legs swing back under the
      // camera and out of frame the way they came in.
      const k = ease(c01((t - D.RISE_T) / (D.TOTAL_T - D.RISE_T)));
      this.event('up');
      hip = -0.93 - 0.62 * k;
      knee = 1.45 + 0.2 * k;
      spread = 0.07 - 0.05 * k;
    }

    // Counter-roll: the legs hang off the camera, so without this they roll
    // with his head and he reads as a tilted photograph rather than a man
    // with his ear on the carpet — his hips are not on their side. Eased in
    // rather than copied, so the fast shoulder-slam doesn't shear them off.
    this.legRoll += (-this.roll * 0.85 - this.legRoll) * Math.min(1, dt * 14);
    this.root.rotation.z = this.legRoll;

    this.legL.rotation.set(hip + dangle, -spread, 0.04);
    this.legR.rotation.set(hip + dangle, spread, -0.04);
    this.kneeL.rotation.x = knee;
    this.kneeR.rotation.x = knee;

    if (t >= D.TOTAL_T) {
      this.active = false;
      this.root.visible = false;
      this.event('done');
    }
  }

  /**
   * The ride. Called right after player.update() so it layers on top of the
   * ordinary eye position instead of being overwritten by it.
   *
   * The whole shape of the move lives here: a dip, a rise as he leaves the
   * floor, then a long fall to 0.33m as he goes over backwards, with the
   * pitch swinging up to the ceiling and a roll onto one shoulder. Getting
   * up is the same curve run backwards, slower.
   */
  applyCamera(player: FPSPlayer): void {
    if (!this.active) return;
    const t = this.t;
    const D = DropKickViewmodel;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));

    // How far the eye sits from where it would be stood up
    const floorDrop = DropKickViewmodel.FLOOR_EYE - player.eyeHeight;
    let rise: number;
    let pitch: number;
    let roll: number;
    let yaw = 0;

    if (t < D.COIL_T) {
      const k = ease(c01(t / D.COIL_T));
      rise = -0.15 * k;
      pitch = 0.07 * k;
      roll = 0;
    } else if (t < D.IMPACT_T) {
      // Off the floor and leaning back into it
      const k = ease(c01((t - D.COIL_T) / (D.IMPACT_T - D.COIL_T)));
      rise = -0.15 + 0.47 * k;
      pitch = 0.07 - 0.24 * k;
      roll = -0.06 * k;
    } else if (t < D.LAND_T) {
      // Over backwards. Gravity is not linear and neither is this: the fall
      // is squared so he hangs at the top of it for a moment after the hit
      // and then drops, which is also what hides the hit-stop.
      const raw = c01((t - D.IMPACT_T) / (D.LAND_T - D.IMPACT_T));
      const fall = raw * raw;
      rise = 0.32 + (floorDrop - 0.32) * fall;
      pitch = -0.17 + 1.05 * ease(raw);
      roll = -0.06 + 0.62 * ease(raw);
      yaw = 0.14 * ease(raw);
    } else if (t < D.RISE_T) {
      // Landed. One hard jolt, then he is just lying there.
      const k = c01((t - D.LAND_T) / 0.18);
      const jolt = Math.sin(k * Math.PI * 2) * (1 - k) * 0.07;
      rise = floorDrop + jolt;
      pitch = 0.88 - 0.05 * k;
      roll = 0.56;
      yaw = 0.14;
    } else {
      // Up. Slower than the way down, because getting off the floor with a
      // rifle on you always is.
      const k = ease(c01((t - D.RISE_T) / (D.TOTAL_T - D.RISE_T)));
      rise = floorDrop * (1 - k);
      pitch = 0.83 * (1 - k);
      roll = 0.56 * (1 - k);
      yaw = 0.14 * (1 - k);
    }

    this.roll = roll;
    const cam = player.camera;
    cam.position.y += rise;
    // Two incommensurate sines so the shake reads as impact rather than buzz
    const s = this.shake;
    if (s > 0) {
      const j = s * s * 0.055;
      cam.position.x += (Math.sin(t * 71) * 0.6 + Math.sin(t * 43.3) * 0.4) * j;
      cam.position.y += (Math.sin(t * 63.7) * 0.6 + Math.sin(t * 39.1) * 0.4) * j;
    }
    cam.rotation.set(player.pitch + pitch, player.yaw + yaw, roll + (s > 0 ? Math.sin(t * 57) * s * s * 0.05 : 0));
  }
}
