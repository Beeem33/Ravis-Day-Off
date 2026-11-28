import * as THREE from 'three';
import { FirstPersonArms, HAND, grip } from './RaviVisual';

export type NeckStabEvent = 'grab' | 'draw' | 'stab' | 'yank' | 'release' | 'done';

/**
 * The right hand round the knife's handle (in the knife's frame), as in the
 * plane's other takedown. The left (in its arm's frame, which stays square to
 * the camera) is a cupped hand on the side of a man's head: palm to the right
 * against his temple, fingers up into his hair, the elbow down and out left.
 */
const GRIP_KNIFE = grip([0.075, 0.026, 0], [-1, 0, 0], [0, -1, 0], [0.75, -0.1, 0.65], HAND.fist);
const GRIP_FACE = grip([-0.012, -0.075, 0.025], [0.12, 0.86, -0.5], [1, 0, 0.1], [-0.35, -0.55, 0.75], {
  fingers: [[28, 34, 20], [26, 32, 18], [28, 34, 20], [30, 36, 22]],
  thumb: [0.3, 0.2, 0.15],
  spread: 10
});

/**
 * NeckStabViewmodel — the plane's second F kill. Ravi's left hand takes the
 * man by the side of the face and shoves his head over, stretching the right
 * side of his neck; the right drives the bowie into it under the jaw, holds it
 * there while he chokes on it, then rips it back out the way it went in. The
 * body goes with the blade for an instant, and drops.
 *
 * Like TakedownViewmodel it only animates the arms and reports the beats; the
 * scene does the man (where his temple and neck are this frame, fed back in
 * by track()), the blood and the kill.
 */
export class NeckStabViewmodel {
  readonly root = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private knife = new THREE.Group();
  /** The blade's front half, wet, once it's been in him. */
  private blood: THREE.Mesh;

  active = false;
  private t = 0;
  private fired = new Set<string>();
  onEvent: ((e: NeckStabEvent) => void) | null = null;

  static readonly GRAB_T = 0.3; // the hand is on his face
  static readonly COCK_T = 0.56; // the knife is up at his neck, drawn back
  static readonly STAB_T = 0.6; // and goes in…
  static readonly THRUST = 0.09; // …this much later
  static readonly YANK_T = 1.1; // held in him till here, then ripped out
  static readonly YANK = 0.11;
  static readonly TOTAL = 2.05;

  /** Close in: his face is in reach of a hand, not just a knife. */
  readonly standOff = 0.74;
  /** Looked at his neck and jaw, not his chest — and once the knife's out, down after him as he drops. */
  get aimHeight(): number {
    const k = Math.min(1, Math.max(0, (this.t - NeckStabViewmodel.YANK_T - 0.08) / 0.7));
    return 1.45 - 0.45 * k * k * (3 - 2 * k);
  }
  gap = 0.74;

  /** His temple (where the palm goes) and the side of his neck (where the blade goes), in the arms' space. */
  private temple = new THREE.Vector3(-0.1, -0.06, -0.62);
  private neck = new THREE.Vector3(-0.04, -0.2, -0.64);
  /** The way the blade went in, fixed at the thrust: it comes out the same way. */
  private stabDir = new THREE.Vector3(0, 0, -1);
  private stabAt = new THREE.Vector3();
  private frozen = false;
  private arms: FirstPersonArms;

  private static readonly FWD = new THREE.Vector3(0, 0, -1);
  /** Ravi's right shoulder, roughly, in the arms' space: what the thrust drives from. */
  private static readonly SHOULDER = new THREE.Vector3(0.42, -0.24, -0.12);
  /** Knife's frame to the point on the blade that sits at the skin when it's in: the rest (about 9cm) is in him. */
  private static readonly SKIN = new THREE.Vector3(0, -0.055, -0.47);

  constructor(camera: THREE.PerspectiveCamera) {
    camera.add(this.root);
    this.root.visible = false;

    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5c3b, roughness: 0.85 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4d6f9c, roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xc4c8cf, roughness: 0.32, metalness: 0.45 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.7 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x3f2a18, roughness: 0.85 });
    const gore = new THREE.MeshStandardMaterial({ color: 0x5e0508, roughness: 0.25, metalness: 0.1 });

    // Stand-in arms, until his own model is in (then they stop drawing)
    for (const g of [this.armL, this.armR]) {
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.66), skin);
      fore.position.set(0, -0.02, 0.36);
      g.add(fore);
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.078, 0.09), sleeve);
      cuff.position.set(0, -0.02, 0.2);
      g.add(cuff);
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.09), skin));
    }

    // The same bowie as the other takedown
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
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.034, 0.09), steel);
    tip.position.set(0, -0.005, -0.485);
    tip.rotation.x = -0.16;
    this.knife.add(tip);
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.0095, 0.009, 0.33), darkSteel);
    fuller.position.set(0, 0.02, -0.24);
    this.knife.add(fuller);
    this.blood = new THREE.Mesh(new THREE.BoxGeometry(0.0105, 0.058, 0.17), gore);
    this.blood.position.set(0, 0.004, -0.43);
    this.blood.visible = false;
    this.knife.add(this.blood);
    this.knife.position.set(0, -0.055, -0.025);
    this.armR.add(this.knife);

    this.root.add(this.armR, this.armL);
    this.arms = new FirstPersonArms(this.root, camera).set('r', this.knife, GRIP_KNIFE).set('l', this.armL, GRIP_FACE);
    this.arms.replaces(skin, sleeve);
  }

  start(): void {
    this.active = true;
    this.t = 0;
    this.frozen = false;
    this.fired.clear();
    this.blood.visible = false;
    this.root.visible = true;
  }

  abort(): void {
    this.active = false;
    this.root.visible = false;
  }

  private event(e: NeckStabEvent): void {
    if (this.fired.has(e)) return;
    this.fired.add(e);
    this.onEvent?.(e);
  }

  /** Where his temple and the side of his neck are this frame (world). Ignored once the blade is on its way out. */
  track(temple: THREE.Vector3, neck: THREE.Vector3): void {
    if (this.frozen) return;
    this.root.updateWorldMatrix(true, false);
    this.root.worldToLocal(this.temple.copy(temple));
    this.root.worldToLocal(this.neck.copy(neck));
  }

  /** Not used: track() is what this one aims by. */
  aimAt(_belly: THREE.Vector3, _head: THREE.Vector3): void {}

  /** 0..1, the letterbox and the longer lens. */
  get cinema(): number {
    if (!this.active) return 0;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));
    return ease(c01(this.t / 0.3)) * (1 - ease(c01((this.t - (NeckStabViewmodel.TOTAL - 0.5)) / 0.5)));
  }

  /** 0..1 how hard his head is being shoved over by the hand on it — the scene leans his head by this. */
  get shove(): number {
    if (!this.active) return 0;
    const T = NeckStabViewmodel;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));
    return ease(c01((this.t - T.GRAB_T + 0.05) / 0.22)) * (1 - ease(c01((this.t - T.YANK_T) / 0.12)));
  }

  /** The way the blade is coming out of him (world), for the blood and the way the body goes. */
  yankDir(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return out.copy(this.stabDir).negate().add(new THREE.Vector3(0.55, -0.15, 0)).normalize().transformDirection(this.root.matrixWorld);
  }

  /** Where the blade went in (world). */
  woundWorld(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return this.root.localToWorld(out.copy(this.stabAt));
  }

  /** The stab shoves Ravi's weight in behind it; the yank throws his shoulder back and round. */
  applyJolt(camera: THREE.Camera): void {
    if (!this.active) return;
    const T = NeckStabViewmodel;
    const t = this.t;
    const pulse = (t0: number, t1: number, decay: number) => (t < t0 ? 0 : t < t1 ? ((t - t0) / (t1 - t0)) ** 2 : Math.exp(-(t - t1) * decay));
    const stab = pulse(T.STAB_T, T.STAB_T + T.THRUST, 7);
    const yank = pulse(T.YANK_T, T.YANK_T + T.YANK, 4.5);
    camera.translateZ(-0.03 * stab + 0.03 * yank);
    camera.rotateY(-0.05 * stab - 0.09 * yank);
    camera.rotateZ(0.02 * stab - 0.05 * yank);
    camera.rotateX(0.02 * yank);
  }

  holdPoints(a: THREE.Vector3, b: THREE.Vector3, knife: THREE.Vector3, knife2: THREE.Vector3): void {
    this.root.updateWorldMatrix(true, true);
    // His hands go to the wrist of the one on his face and the back of it…
    this.armL.localToWorld(a.set(-0.01, -0.09, 0.05));
    this.armL.localToWorld(b.set(-0.025, -0.02, 0.0));
    // …and, once it's in him, the knife wrist
    this.armR.localToWorld(knife.set(0, -0.01, 0.08));
    this.armR.localToWorld(knife2.set(0, 0.03, -0.01));
  }

  private static _q = new THREE.Quaternion();
  private static _v = new THREE.Vector3();

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const T = NeckStabViewmodel;
    const t = this.t;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));
    const V = THREE.Vector3;

    // Him fighting the hand, and then shuddering on the blade
    const s = t < T.GRAB_T ? 0 : t < T.STAB_T ? 1 : t < T.YANK_T ? 0.55 : 0;
    const jx = (Math.sin(t * 13.2) * 0.6 + Math.sin(t * 7.7 + 2.1) * 0.4) * 0.012 * s;
    const jy = (Math.sin(t * 11.4 + 0.8) * 0.6 + Math.sin(t * 8.9 + 3.0) * 0.4) * 0.01 * s;

    // ---- LEFT: up from low left onto the side of his face, shove, and at
    // the yank a last push of his head away before it lets go
    const lFrom = new V(-0.4, -0.5, -0.2);
    const lOn = new V(this.temple.x - 0.035, this.temple.y, this.temple.z + 0.01);
    const reach = ease(c01(t / T.GRAB_T));
    const off = ease(c01((t - T.YANK_T - 0.04) / 0.28));
    this.armL.position.lerpVectors(lFrom, lOn, reach);
    const push = ease(c01((t - T.YANK_T) / 0.08)) * (1 - off);
    this.armL.position.x += jx + 0.05 * push + 0.03 * this.shove;
    this.armL.position.y += jy;
    this.armL.position.z += -0.04 * push;
    if (off > 0) this.armL.position.lerp(NeckStabViewmodel._v.set(-0.3, -0.48, -0.32), off);
    this.armL.rotation.set(0, 0, -0.15 * (1 - reach));
    if (reach >= 1) this.event('grab');
    if (off > 0) this.event('release');

    // ---- RIGHT: the knife out from the hip and up beside his neck, drawn
    // back; in under the jaw; held and worked; ripped out back the way it
    // came and on out to the right, the blade flicking up wet
    const q = NeckStabViewmodel._q;
    const pocket = new V(0.32, -0.55, -0.22);
    if (!this.frozen) this.stabDir.subVectors(this.neck, T.SHOULDER).normalize();
    q.setFromUnitVectors(T.FWD, this.stabDir);
    const skin = NeckStabViewmodel._v.copy(T.SKIN).applyQuaternion(q);
    const inAt = new V().subVectors(this.neck, skin); // the arm's origin with the blade in
    const cock = inAt.clone().addScaledVector(this.stabDir, -0.24).add(new V(0.05, -0.03, 0.02));
    const kq = new THREE.Quaternion();
    if (t < T.COCK_T) {
      if (t > 0.08) this.event('draw');
      const k = ease(c01((t - 0.08) / (T.COCK_T - 0.08)));
      this.armR.position.lerpVectors(pocket, cock, k);
      this.armR.quaternion.setFromEuler(new THREE.Euler(0.1, 0.3, 0)).slerp(q, k);
      this.knife.rotation.set(-0.15 * (1 - k), 0, 0);
    } else if (t < T.YANK_T) {
      const k = c01((t - T.STAB_T) / T.THRUST);
      const drive = k * k * (2 - k); // fast and hard, no easing into him
      this.armR.position.lerpVectors(cock, inAt, drive);
      this.armR.quaternion.copy(q);
      if (k >= 1) {
        this.event('stab');
        if (!this.blood.visible) {
          this.blood.visible = true;
          this.stabAt.copy(this.neck);
        }
        // Worked in him: the wrist grinding, a twist of the blade
        const held = t - (T.STAB_T + T.THRUST);
        const grind = Math.sin(held * 10) * 0.06 + Math.sin(held * 16.3) * 0.03;
        this.armR.position.x += jx;
        this.armR.position.y += jy;
        this.armR.position.addScaledVector(this.stabDir, 0.012 * Math.sin(held * 7));
        kq.setFromEuler(new THREE.Euler(grind * 0.5, grind * 0.3, 0.5 * ease(c01(held / 0.25)) + grind));
        this.armR.quaternion.multiply(kq);
      }
    } else {
      // Ripped out. Fixed where it was in him, so the blade leaves along its own
      // line whatever he does next — and only then is he free to go
      if (!this.frozen) {
        this.frozen = true;
        this.event('yank');
      }
      const k = c01((t - T.YANK_T) / T.YANK);
      const out = 1 - (1 - k) * (1 - k) * (1 - k);
      const back = inAt.clone().addScaledVector(this.stabDir, -0.42).add(new V(0.2, -0.08, 0.1));
      const after = new V(0.36, -0.3, -0.36);
      const settle = ease(c01((t - T.YANK_T - T.YANK) / 0.4));
      this.armR.position.lerpVectors(inAt, back, out).lerp(after, settle);
      // The wrist snaps up and out as it comes free, then turns the wet blade to the light
      kq.setFromEuler(new THREE.Euler(0.55 * out - 0.25 * settle, -0.5 * out, 0.5 - 0.2 * out));
      this.armR.quaternion.copy(q).multiply(kq);
    }

    // Everything sinks out of frame together at the end
    const sink = ease(c01((t - (T.TOTAL - 0.5)) / 0.45));
    this.root.position.y = -0.6 * sink;
    this.root.rotation.x = -0.5 * sink;
    this.arms.update();

    if (t >= T.TOTAL) {
      this.active = false;
      this.root.visible = false;
      this.event('done');
    }
  }
}
