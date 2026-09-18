import * as THREE from 'three';
import { FirstPersonArms, HAND, grip, mixShape, type Side } from './RaviVisual';

const SKIN = 0x8a5c3b;
const SLEEVE = 0x4d6f9c;
const ROPE = 0x9a7b4f;
/** Wrist to elbow, and elbow to shoulder. */
const FORE = 0.29;
const UPPER = 0.3;
const Z = new THREE.Vector3(0, 0, 1);

/** Stretch a mesh one unit long down its Z from `a` to `b`. */
function lay(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  const d = b.clone().sub(a);
  const len = Math.max(d.length(), 1e-4);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.scale.set(1, 1, len);
  m.quaternion.setFromUnitVectors(Z, d.divideScalar(len));
}

/** One of the two: a hand whose fingers close, a rope burn, and the arm behind it. */
class Hand {
  /** Posed by the scene in camera space. Fingers run out along −Z, back of the hand +Y. */
  readonly root = new THREE.Group();
  /** Forearm, the rolled-up sleeve below the elbow, the elbow, the upper arm. */
  private arm = new THREE.Group();
  private fore: THREE.Mesh;
  private roll: THREE.Mesh;
  private elbow: THREE.Mesh;
  private upper: THREE.Mesh;
  private fingers: { knuckle: THREE.Group; mid: THREE.Group }[] = [];
  private thumb = new THREE.Group();
  /** 0 open, 1 a fist. */
  curl = 0;
  /**
   * 0..1: how far the hand is turned to run straight on from the forearm,
   * whatever way the scene posed it. Freed, his wrists are straight; posed
   * hands left alone ended up bent down off the ends of the arms, with the
   * forearm going through the rope band at an angle.
   */
  straight = 0;
  /** Just inside the heel of the palm, where the forearm starts. */
  private static readonly WRIST = new THREE.Vector3(0, -0.004, 0.05);
  /** Which way the forearm leaves the wrist, in the hand's frame, as last solved. */
  readonly toward = new THREE.Vector3(0, -0.2, 1).normalize();
  /** Where the shoulder was, in camera space, as last given. */
  readonly shoulder = new THREE.Vector3();

  constructor(
    camera: THREE.Camera,
    readonly side: 1 | -1,
    skin: THREE.Material,
    sleeve: THREE.Material,
    rope: THREE.Material
  ) {
    camera.add(this.root);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.03, 0.095), skin);
    palm.position.set(0, 0, 0.012);
    this.root.add(palm);
    const lens = [0.07, 0.078, 0.075, 0.062];
    for (let i = 0; i < 4; i++) {
      const knuckle = new THREE.Group();
      // Index finger on the thumb side: inboard, towards the middle of the view
      knuckle.position.set(side * (-0.031 + i * 0.0205), 0.002, -0.036);
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.019, lens[i] * 0.55), skin);
      p1.position.z = (-lens[i] * 0.55) / 2;
      knuckle.add(p1);
      const mid = new THREE.Group();
      mid.position.z = -lens[i] * 0.55;
      const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.017, lens[i] * 0.45), skin);
      p2.position.z = (-lens[i] * 0.45) / 2;
      mid.add(p2);
      knuckle.add(mid);
      this.root.add(knuckle);
      this.fingers.push({ knuckle, mid });
    }
    this.thumb.position.set(side * -0.046, -0.008, 0.0);
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.058), skin);
    t1.position.z = -0.029;
    this.thumb.add(t1);
    this.root.add(this.thumb);

    // Where the rope was: a band still round the wrist and a frayed end
    // hanging from it. The band sits on the forearm just behind the heel of
    // the hand, loose enough to clear it all the way round (the forearm is
    // 0.029 across at the wrist, the band's inside 0.0325), and the end
    // hangs from its underside rather than starting inside the arm.
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.0085, 6, 18), rope);
    band.position.set(0, -0.004, 0.085);
    this.root.add(band);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.006, 0.08, 6), rope);
    tail.position.set(side * 0.012, -0.086, 0.088);
    tail.rotation.z = side * 0.3;
    this.root.add(tail);

    // His arm, the same rolled-up shirt sleeves the gun viewmodels have: bare
    // forearm, the sleeve bunched below the elbow, sleeve up to the shoulder.
    // The forearm is round, not a box — a box's corners came out through
    // the rope band. Its axis is turned onto Z for lay(), wrist end at −Z.
    const foreGeo = new THREE.CylinderGeometry(0.032, 0.029, 1, 10);
    foreGeo.rotateX(Math.PI / 2);
    this.fore = new THREE.Mesh(foreGeo, skin);
    this.roll = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.08, 1), sleeve);
    this.elbow = new THREE.Mesh(new THREE.SphereGeometry(0.043, 10, 8), sleeve);
    this.upper = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.084, 1), sleeve);
    this.arm.add(this.fore, this.roll, this.elbow, this.upper);
    camera.add(this.arm);
    this.visible = false;
  }

  set visible(on: boolean) {
    this.root.visible = on;
    this.arm.visible = on;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * Close the fingers, and hang the arm between the wrist and `shoulder`
   * (camera space): two bones, the elbow out to the side and down. Past the
   * arm's reach the elbow straightens and the upper arm stops short of the
   * shoulder, which is behind the camera by then anyway.
   */
  update(shoulder: THREE.Vector3): void {
    const c = THREE.MathUtils.clamp(this.curl, 0, 1);
    // Down into the palm (the back of the hand is +Y)
    for (const f of this.fingers) {
      f.knuckle.rotation.x = -1.45 * c;
      f.mid.rotation.x = -1.6 * c;
    }
    // Open it sticks out inboard; closed it lies across the front of the fist
    this.thumb.rotation.set(-0.4 * c, this.side * (0.7 * (1 - c) - 1.0 * c), 0);

    let { wrist, elbow, top } = this.solve(shoulder);
    if (this.straight > 0) {
      // Fingers on along the line of the forearm (they run down the hand's
      // −Z), keeping the back of the hand the side the scene had it
      const z = elbow.clone().sub(wrist).normalize();
      const y = new THREE.Vector3(0, 1, 0).applyQuaternion(this.root.quaternion);
      y.addScaledVector(z, -y.dot(z)).normalize();
      const x = new THREE.Vector3().crossVectors(y, z);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      this.root.quaternion.slerp(q, THREE.MathUtils.clamp(this.straight, 0, 1));
      // Turning the hand moves the wrist a little: hang the arm again from there
      ({ wrist, elbow, top } = this.solve(shoulder));
    }
    this.toward.copy(elbow).sub(wrist).applyQuaternion(this.root.quaternion.clone().invert()).normalize();
    this.shoulder.copy(shoulder);
    lay(this.fore, wrist, elbow);
    lay(this.roll, wrist.clone().lerp(elbow, 0.7), elbow);
    this.elbow.position.copy(elbow);
    lay(this.upper, elbow, top);
  }

  /** The wrist where the hand is, and the elbow and shoulder end of an arm hung from it. */
  private solve(shoulder: THREE.Vector3): { wrist: THREE.Vector3; elbow: THREE.Vector3; top: THREE.Vector3 } {
    const wrist = Hand.WRIST.clone().applyQuaternion(this.root.quaternion).add(this.root.position);
    const w = shoulder.clone().sub(wrist);
    const d = THREE.MathUtils.clamp(w.length(), 0.05, (FORE + UPPER) * 0.999);
    w.normalize();
    // The wrist's angle in the triangle wrist–elbow–shoulder
    const a = Math.acos(THREE.MathUtils.clamp((FORE * FORE + d * d - UPPER * UPPER) / (2 * FORE * d), -1, 1));
    const n = new THREE.Vector3(this.side * 0.6, -1, 0.15);
    n.addScaledVector(w, -n.dot(w)).normalize();
    const elbow = wrist.clone().addScaledVector(w, Math.cos(a) * FORE).addScaledVector(n, Math.sin(a) * FORE);
    return { wrist, elbow, top: wrist.clone().addScaledVector(w, d) };
  }
}

/**
 * CaptiveHands — Ravi's own two arms for the start of level six: tied down
 * out of shot, then freed one at a time and brought up into view, and then
 * the right one thrown into a face.
 *
 * Camera-space, like the weapon viewmodels, because they only ever have to
 * be where his eyes are. The scene poses each hand and says where his
 * shoulders are; each arm hangs between the two with a proper elbow, so it
 * runs off the bottom of the frame as an arm rather than a hand on its own.
 * A band of the rope is still round each wrist.
 */
export class CaptiveHands {
  readonly right: Hand;
  readonly left: Hand;
  /** Ravi's own arms, laid onto the two posed hands each frame. */
  private arms: FirstPersonArms;

  constructor(camera: THREE.Camera) {
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 });
    const sleeve = new THREE.MeshStandardMaterial({ color: SLEEVE, roughness: 0.9 });
    const rope = new THREE.MeshStandardMaterial({ color: ROPE, roughness: 0.95 });
    this.right = new Hand(camera, 1, skin, sleeve, rope);
    this.left = new Hand(camera, -1, skin, sleeve, rope);
    // His real arms, each hand where the scene posed it (fingers down −Z, back
    // of the hand +Y), the forearm along the arm this class solves; the rope
    // bands stay on his wrists
    this.arms = new FirstPersonArms(camera, camera);
    this.arms.replaces(skin, sleeve);
  }

  /** Shoulders in camera space — the scene works them out from his body, which the head turns on. */
  update(shoulderR: THREE.Vector3, shoulderL: THREE.Vector3): void {
    if (this.right.visible) this.right.update(shoulderR);
    if (this.left.visible) this.left.update(shoulderL);
    for (const [side, h] of [['r', this.right], ['l', this.left]] as [Side, Hand][]) {
      this.arms.set(
        side,
        h.root,
        grip([0, -0.004, 0.05], [0, 0, -1], [0, -1, 0], [h.toward.x, h.toward.y, h.toward.z], mixShape(HAND.open, HAND.fist, THREE.MathUtils.clamp(h.curl, 0, 1)))
      );
      this.arms.shoulder(side, h.shoulder);
    }
    this.arms.update();
  }
}
