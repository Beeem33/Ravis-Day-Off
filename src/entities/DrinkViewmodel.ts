import * as THREE from 'three';
import type { FPSPlayer } from './FPSPlayer';
import { deadbullWrap } from '../environment/OfficeProps';

/**
 * DrinkViewmodel — the can of Deadbull Ravi keeps somewhere on his person,
 * parented to the camera like the weapons. G brings it up, he cracks it,
 * drinks it, crushes the empty and throws it away; somewhere in the middle
 * of that he is back to full health.
 *
 * Deliberately NOT cinematic: the player keeps the mouse and their feet the
 * whole time. The cost of a full heal is that the gun is out of frame for
 * three seconds, which in a firefight is a long time to be holding a drink.
 *
 * The scene owns the consequences (the heal itself, stowing the gun, handing
 * the empty to physics); this class only animates and reports its beats.
 */
export class DrinkViewmodel {
  readonly root = new THREE.Group();
  private arm = new THREE.Group();
  private can = new THREE.Group();
  private tab: THREE.Mesh;
  /** The can body, scaled down when he crushes it. */
  private shell = new THREE.Group();

  active = false;
  private t = 0;
  private fired = new Set<string>();
  /** `index` is which swallow this is (0-2) on a 'gulp', and 0 otherwise. */
  onEvent: ((e: 'crack' | 'gulp' | 'heal' | 'crush' | 'toss' | 'done', index: number) => void) | null = null;

  // The beats. Three seconds sounds long written down and reads as about
  // right in the hand — a swig you could actually take is slower than the
  // one you picture.
  static readonly CRACK_T = 0.42;
  static readonly LIFT_T = 0.62; // starts travelling to his mouth
  static readonly GULP1_T = 0.92;
  static readonly GULP2_T = 1.26;
  static readonly GULP3_T = 1.6;
  static readonly HEAL_T = 1.6; // the last swallow is the one that counts
  static readonly LOWER_T = 1.86;
  static readonly CRUSH_T = 2.14;
  static readonly TOSS_T = 2.44;
  static readonly TOTAL_T = 2.78; // dead frame at the end reads as a stall

  // Camera-space poses. The middle-finger emote sits at (-0.24, -0.195, -0.46)
  // for the left hand; this is its right-handed mirror, near enough.
  // Camera-space positions of the can's RIM (see the offset in the ctor).
  private posDown = new THREE.Vector3(0.32, -0.63, -0.52);
  private posReady = new THREE.Vector3(0.175, -0.08, -0.6);
  // The rim sits just below the bottom edge of frame: his mouth is AT the
  // camera, so the only honest place for the lip is off-screen. What you
  // see is the barrel leaning back out of the bottom-right corner.
  private posMouth = new THREE.Vector3(0.095, -0.295, -0.335);
  private posToss = new THREE.Vector3(0.23, -0.11, -0.56);

  constructor(camera: THREE.PerspectiveCamera) {
    camera.add(this.root);
    this.root.visible = false;

    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5c3b, roughness: 0.85 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4d6f9c, roughness: 0.9 });
    // Bare aluminium: bright and quite metallic, so the unprinted rims catch
    // the level's lights and the thing reads as a can and not a painted tube.
    const alu = new THREE.MeshStandardMaterial({ color: 0xc9ced7, roughness: 0.28, metalness: 0.85 });
    // The same wrap the desk cans use, at four times the resolution — this
    // one is held at arm's length rather than seen across a room.
    const label = new THREE.MeshStandardMaterial({ map: deadbullWrap(4), roughness: 0.45, metalness: 0.35 });

    // The desk cans are R 0.05 — deliberately chunky so they read from across
    // a room. Held at arm's length that is a bucket, so this one is pulled in
    // to a real 500ml: 84mm across, 190mm tall, and the same wrap.
    const R = 0.042;
    // CylinderGeometry groups its faces side / top / bottom, so the printed
    // sleeve and the bare ends can be separate materials on one mesh.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.19, 22, 1), [label, alu, alu]);
    body.rotation.y = -Math.PI / 2;
    this.shell.add(body);
    // Necked-in top and the rolled rim above it
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.8, R, 0.016, 22), alu);
    neck.position.y = 0.103;
    this.shell.add(neck);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.84, R * 0.84, 0.005, 22), alu);
    rim.position.y = 0.1125;
    this.shell.add(rim);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.92, R * 0.92, 0.006, 22), alu);
    base.position.y = -0.098;
    this.shell.add(base);
    // The tab, which is the only part that has to move before he drinks
    this.tab = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.016), alu);
    this.tab.position.set(0.014, 0.1155, 0);
    this.shell.add(this.tab);
    this.can.add(this.shell);

    // ---- The hand round it. What sells a grip in first person is not the
    // palm — that is behind the can and you never see it — it is fingers
    // crossing the FRONT of the barrel, over the print. So each one is laid
    // along a chord that starts out in free air to the right of the can
    // (x 0.062, z -0.012) and ends on its camera-facing surface (x 0.004,
    // z -0.042): 0.066 long, turned -0.48 rad about Y to follow that line.
    // Half-buried in the barrel is right — that is a finger pressing on it.
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.086, 0.06), skin);
    hand.position.set(0.078, -0.03, 0.024);
    hand.rotation.y = -0.3;
    this.can.add(hand);
    for (let i = 0; i < 4; i++) {
      // Thinner than they are spaced, so there is a real gap of can showing
      // between them — four touching boxes read as one mitt, not as fingers.
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.015), skin);
      finger.position.set(0.026, -0.058 + i * 0.023, -0.028);
      // The outer two sit a little proud, the way a hand actually lies on a tin
      finger.rotation.set(0, -0.48, i === 0 ? -0.07 : i === 3 ? 0.06 : 0);
      this.can.add(finger);
    }
    // Thumb up the near face, reaching for the tab
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.019, 0.052, 0.018), skin);
    thumb.position.set(0.016, 0.03, -0.042);
    thumb.rotation.set(0.1, -0.15, 0.42);
    this.can.add(thumb);

    // Forearm running back out of frame, cuff at the wrist. Rolled inward so
    // it reads as an arm coming off his shoulder and not a plank laid
    // alongside the can.
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.082, 0.07), sleeve);
    cuff.position.set(0.098, -0.1, 0.08);
    cuff.rotation.set(-0.32, -0.2, 0);
    this.can.add(cuff);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.066, 0.34), skin);
    fore.position.set(0.124, -0.162, 0.237);
    fore.rotation.set(0.5, -0.2, 0);
    this.can.add(fore);

    // Drop the whole can so its RIM sits on the root's origin. Everything
    // rotates about the root, and when you drink, the thing that stays put is
    // the lip against your mouth while the base swings up and away — pivot
    // about the middle instead and the can just rolls over and shows you its
    // lid, which is the one view a drinker never gets.
    this.can.position.y = -0.115;
    this.arm.add(this.can);
    this.root.add(this.arm);
    // Half this arm is behind the camera at the start and end of the move, so
    // its bounding sphere is behind the near plane and three.js would cull it
    // outright — the same reason every weapon viewmodel does this.
    this.root.traverse((o) => {
      o.frustumCulled = false;
    });
  }

  /** Bring it out. False if one is already on the go. */
  start(): boolean {
    if (this.active) return false;
    this.active = true;
    this.t = 0;
    this.fired.clear();
    this.root.visible = true;
    this.shell.scale.set(1, 1, 1);
    this.shell.rotation.set(0, 0, 0);
    this.tab.rotation.set(0, 0, 0);
    this.tab.position.set(0.014, 0.1155, 0);
    return true;
  }

  /** Hard stop — he was shot mid-swig. No 'done', no empty to throw. */
  abort(): void {
    this.active = false;
    this.root.visible = false;
  }

  /** True while the can is out — the gun stays stowed and the emote stays down. */
  get engaged(): boolean {
    return this.active;
  }

  /**
   * Where the empty is, and how fast it is going, at the moment he lets go.
   * Taken off the live world matrix rather than a nominal offset, because the
   * can is mid-throw and a guessed position pops by a good 10cm.
   */
  tossPose(): { position: THREE.Vector3; quaternion: THREE.Quaternion; velocity: THREE.Vector3 } {
    this.shell.updateWorldMatrix(true, false);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    this.shell.getWorldPosition(position);
    this.shell.getWorldQuaternion(quaternion);
    // Flicked away forward and to his right, off the back of the wrist snap.
    // Direction comes from the camera so it follows wherever he is looking.
    const cam = this.root.parent as THREE.Object3D;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    const velocity = fwd
      .multiplyScalar(2.6 + Math.random() * 0.7)
      .addScaledVector(right, 1.5 + Math.random() * 0.5);
    velocity.y += 1.4;
    return { position, quaternion, velocity };
  }

  private event(key: string, name: 'crack' | 'gulp' | 'heal' | 'crush' | 'toss' | 'done', index = 0): void {
    if (this.fired.has(key)) return;
    this.fired.add(key);
    this.onEvent?.(name, index);
  }

  update(dt: number, player: FPSPlayer): void {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    const D = DrinkViewmodel;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));

    // Walking with a drink in your hand still bobs
    const { phase, amount } = player.bob;
    const bobY = -Math.abs(Math.sin(phase)) * 0.012 * amount;
    const bobX = Math.sin(phase) * 0.008 * amount;

    let pos: THREE.Vector3;
    let rotX = 0;
    let rotY = 0;
    let rotZ = 0;

    if (t < D.CRACK_T) {
      // Up from the hip, label rolling round to face the camera as it comes.
      // The roll is the whole reason you can read the thing: held still it is
      // a 66mm cylinder at arm's length and the print is edge-on half the time.
      const k = ease(c01(t / D.CRACK_T));
      pos = new THREE.Vector3().lerpVectors(this.posDown, this.posReady, k);
      rotX = -0.55 * (1 - k) + 0.06 * k;
      rotY = -1.1 * (1 - k);
      rotZ = 0.3 * (1 - k) - 0.16 * k;
    } else if (t < D.LIFT_T) {
      // The thumb goes through the tab. Held at chest height for a fifth of a
      // second, which is just long enough to register the can before it moves.
      const k = ease(c01((t - D.CRACK_T) / (D.LIFT_T - D.CRACK_T)));
      this.event('crack', 'crack');
      pos = this.posReady.clone();
      pos.y += 0.008 * Math.sin(k * Math.PI); // the little bump of the tab giving
      rotX = 0.06;
      rotZ = -0.16;
      this.tab.rotation.z = -0.9 * k;
      this.tab.position.y = 0.1155 + 0.005 * k;
    } else if (t < D.LOWER_T) {
      // At the mouth. The can tips further back with every swallow — rotating
      // about +X takes the open top toward the camera, i.e. toward his face —
      // and each gulp is a short jolt on top of that.
      const k = ease(c01((t - D.LIFT_T) / (D.GULP1_T - D.LIFT_T)));
      const drained = c01((t - D.GULP1_T) / (D.GULP3_T - D.GULP1_T));
      pos = new THREE.Vector3().lerpVectors(this.posReady, this.posMouth, k);
      // Past 90 degrees, so the base is up and away from his face rather
      // than pointed at the camera. It keeps going as the can empties.
      rotX = 0.06 + (1.45 + 0.34 * drained) * k;
      rotY = 0.22 * k;
      rotZ = -0.16 + 0.24 * k;
      for (let i = 0; i < 3; i++) {
        const at = [D.GULP1_T, D.GULP2_T, D.GULP3_T][i];
        if (t >= at) this.event(`gulp${i}`, 'gulp', i);
        // Each swallow pulls the can up a touch and rocks his wrist
        const since = t - at;
        if (since >= 0 && since < 0.2) {
          const g = Math.sin((since / 0.2) * Math.PI);
          rotX += 0.1 * g;
          pos.y += 0.007 * g;
        }
      }
      if (t >= D.HEAL_T) this.event('heal', 'heal');
    } else if (t < D.CRUSH_T) {
      // Away from the mouth, and for a beat it hangs upside down and empty —
      // the one frame that tells you he actually finished it.
      const k = ease(c01((t - D.LOWER_T) / (D.CRUSH_T - D.LOWER_T)));
      pos = new THREE.Vector3().lerpVectors(this.posMouth, this.posToss, k);
      rotX = 1.85 - 1.17 * k;
      rotY = 0.22 - 0.5 * k;
      rotZ = 0.08 - 0.5 * k;
    } else if (t < D.TOSS_T) {
      // The crush. Aluminium goes all at once, so this is fast and then over:
      // the shell loses two thirds of its height and bulges as it buckles.
      const k = ease(c01((t - D.CRUSH_T) / 0.16));
      this.event('crush', 'crush');
      pos = this.posToss.clone();
      pos.x += 0.02 * k;
      rotX = 0.68;
      rotY = -0.28;
      rotZ = -0.42 - 0.25 * k;
      this.shell.scale.set(1 + 0.3 * k, 1 - 0.62 * k, 1 + 0.22 * k);
      this.shell.rotation.set(0.22 * k, 0, -0.3 * k); // it never folds square
    } else {
      // Wrist snap, the empty goes, and the hand drops out of frame after it.
      const k = ease(c01((t - D.TOSS_T) / (D.TOTAL_T - D.TOSS_T)));
      this.event('toss', 'toss');
      // Once it has been handed to physics the viewmodel copy must go, or
      // there are two cans — one flying, one still in his fist.
      this.shell.visible = t < D.TOSS_T + 0.04;
      pos = new THREE.Vector3().lerpVectors(this.posToss, this.posDown, k);
      rotX = 0.68 - 1.2 * k;
      rotZ = -0.67 + 0.9 * k;
    }

    this.root.position.set(pos.x + bobX, pos.y + bobY, pos.z);
    this.root.rotation.set(rotX, rotY, rotZ);

    if (t >= D.TOTAL_T) {
      this.active = false;
      this.root.visible = false;
      this.shell.visible = true;
      this.event('done', 'done');
    }
  }

  /**
   * The crushed empty as a free-standing object, so the scene can hand it to
   * physics without knowing how a can is put together. Built squat and wide
   * with a kink in it — a can that lands looking like a neat cylinder reads
   * as a prop that was never crushed at all.
   */
  static crushedCan(): THREE.Group {
    const g = new THREE.Group();
    const alu = new THREE.MeshStandardMaterial({ color: 0xc9ced7, roughness: 0.3, metalness: 0.85 });
    const label = new THREE.MeshStandardMaterial({ map: deadbullWrap(1), roughness: 0.45, metalness: 0.35 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.072, 14, 1), [label, alu, alu]);
    g.add(body);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.048, 0.014, 14), alu);
    lid.position.set(0.009, 0.042, 0.006);
    lid.rotation.set(0.3, 0, 0.22);
    g.add(lid);
    return g;
  }

}
