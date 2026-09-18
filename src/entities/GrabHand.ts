import * as THREE from 'three';
import { FirstPersonArms, elbowToward, grip, mixShape, type HandShape } from './RaviVisual';

/** Ravi's complexion and shirt, as on every viewmodel. */
const SKIN = 0x8a5c3b;
const SLEEVE = 0x4d6f9c;
/** Ravi's hand open and reaching, and shut over the top of the bar and down behind it. */
const OPEN: HandShape = { fingers: [[10, 12, 6], [10, 12, 6], [12, 14, 7], [14, 16, 8]], thumb: [0.0, 0.1, 0.1], spread: 6 };
const SHUT: HandShape = { fingers: [[88, 90, 40], [88, 90, 40], [88, 90, 40], [88, 90, 40]], thumb: [0.6, 0.5, 0.3] };
/** His wrist in the hand's frame: under the knuckles, behind the back of the hand. */
const RAVI_WRIST = new THREE.Vector3(0, -0.055, 0.05);

/**
 * GrabHand — Ravi's right hand and forearm as a world-space prop, for a
 * cutscene where the hand has to take hold of something in the level and go
 * wherever it goes: the main breaker's lever.
 *
 * The weapon viewmodels live in camera space, which is right for a gun and
 * wrong for a hand clamped on a lever that swings through half a circle while
 * the camera shakes. So this one lives in the world, and the scene poses
 * `root` each frame in the frame of the bar it holds: X along the bar, Z from
 * the bar towards the eye, Y the third way (up, near enough).
 *
 * The hand is on the near side of the bar with the back of it to the eye and
 * the fingers hooked over the top and down behind — the grip that reads as a
 * grip from where Ravi is looking. The bar is round, so as the lever swings
 * the scene keeps Z on the eye and lets the bar roll in the hand rather than
 * turning the hand over with it; clamped rigidly, the hand ended the throw
 * behind the bar with its forearm through it.
 *
 * The forearm is laid each frame from the wrist back to a shoulder point the
 * scene gives, under the camera, so however the hand is placed the arm still
 * comes from Ravi.
 */
export class GrabHand {
  /** The hand. Origin at the middle of the bar it closes round. */
  readonly root = new THREE.Group();
  private arm = new THREE.Group();
  private fore: THREE.Mesh;
  private cuff: THREE.Mesh;
  private fingers: { knuckle: THREE.Group; mid: THREE.Group }[] = [];
  private thumb = new THREE.Group();
  /** 0 open and reaching, 1 closed round the bar. */
  curl = 0;

  /** Where the forearm leaves the hand, in the hand's own frame. */
  private static readonly WRIST = new THREE.Vector3(0, -0.07, 0.056);
  /** Long enough that the cuff is out of shot, not glowing in the fill light by the lens. */
  private static readonly FORE_MAX = 0.75;
  private wrist = new THREE.Vector3();
  private dir = new THREE.Vector3();
  /** Ravi's own right arm, laid onto the posed hand each frame. */
  private arms: FirstPersonArms;

  constructor(scene: THREE.Scene) {
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 });
    const sleeve = new THREE.MeshStandardMaterial({ color: SLEEVE, roughness: 0.9 });

    // Back of the hand, on the near side of the bar and standing up past its top
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.12, 0.03), skin);
    palm.position.set(0, -0.012, 0.057);
    this.root.add(palm);
    // The row of knuckles along the top of it
    const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.024, 0.028), skin);
    knuckles.position.set(0, 0.04, 0.06);
    this.root.add(knuckles);

    // Four fingers from the knuckles: open they point on up out of the hand;
    // closed, the first joint lays them over the top of the bar and the second
    // hooks the ends down behind it
    const lens = [0.082, 0.09, 0.088, 0.078];
    for (let i = 0; i < 4; i++) {
      const knuckle = new THREE.Group();
      knuckle.position.set(-0.031 + i * 0.0205, 0.046, 0.05);
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.018, lens[i], 0.018), skin);
      p1.position.y = lens[i] / 2;
      knuckle.add(p1);
      const mid = new THREE.Group();
      mid.position.y = lens[i];
      const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.045, 0.017), skin);
      p2.position.y = 0.0225;
      mid.add(p2);
      knuckle.add(mid);
      this.root.add(knuckle);
      this.fingers.push({ knuckle, mid });
    }
    // The thumb from the low inside corner of the hand, round under the bar
    this.thumb.position.set(-0.046, -0.042, 0.048);
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.023, 0.023, 0.07), skin);
    t1.position.z = -0.035;
    this.thumb.add(t1);
    this.root.add(this.thumb);

    // Forearm, bare to the rolled-up sleeve. Unit length, stretched per frame.
    this.fore = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.064, 1), skin);
    this.cuff = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.086, 0.12), sleeve);
    this.arm.add(this.fore, this.cuff);

    this.root.visible = false;
    this.arm.visible = false;
    scene.add(this.root, this.arm);

    // His real arm: the back of the hand to the eye, fingers up over the bar,
    // the forearm hung from the shoulder the scene gives
    this.arms = new FirstPersonArms(this.root, null);
    this.arms.replaces(skin, sleeve);
  }

  set visible(on: boolean) {
    this.root.visible = on;
    this.arm.visible = on;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * Close the fingers to `curl` and lay the forearm from the wrist towards
   * `shoulder` (world). Call after posing `root`.
   */
  update(shoulder: THREE.Vector3): void {
    const c = THREE.MathUtils.clamp(this.curl, 0, 1);
    for (const f of this.fingers) {
      f.knuckle.rotation.x = (-Math.PI / 2) * c;
      f.mid.rotation.x = (-Math.PI / 2) * c;
    }
    // Open it sticks out to the side; closed it runs in under the bar
    this.thumb.rotation.set(0.35 * (1 - c) - 0.12 * c, 1.1 * (1 - c) - 0.25 * c, 0);

    this.root.updateMatrixWorld(true);
    this.wrist.copy(GrabHand.WRIST).applyMatrix4(this.root.matrixWorld);
    this.dir.copy(shoulder).sub(this.wrist);
    const len = Math.min(this.dir.length(), GrabHand.FORE_MAX);
    this.dir.normalize();
    this.fore.scale.set(1, 1, len);
    this.fore.position.copy(this.wrist).addScaledVector(this.dir, len / 2);
    this.fore.lookAt(this.wrist.clone().addScaledVector(this.dir, len));
    this.cuff.position.copy(this.wrist).addScaledVector(this.dir, len * 0.8);
    this.cuff.quaternion.copy(this.fore.quaternion);

    // Ravi's arm: the elbow hangs below the line from the wrist to the shoulder
    const w = RAVI_WRIST.clone().applyMatrix4(this.root.matrixWorld);
    const toward = elbowToward(w, shoulder, new THREE.Vector3(0, -1, 0)).transformDirection(
      this.root.matrixWorld.clone().invert()
    );
    this.arms
      .set('r', this.root, grip(RAVI_WRIST.toArray(), [0, 1, 0], [0, 0, -1], toward.toArray(), mixShape(OPEN, SHUT, c)))
      .shoulder('r', shoulder, true)
      .update();
  }

  dispose(): void {
    this.root.removeFromParent();
    this.arm.removeFromParent();
  }
}
