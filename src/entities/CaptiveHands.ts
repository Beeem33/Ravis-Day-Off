import * as THREE from 'three';

const SKIN = 0x8a5c3b;
const SLEEVE = 0x4d6f9c;
const ROPE = 0x9a7b4f;

/** One of the two: a hand whose fingers close, a rope burn, and a forearm. */
class Hand {
  /** Posed by the scene in camera space. Fingers run out along −Z, back of the hand +Y. */
  readonly root = new THREE.Group();
  readonly fore: THREE.Mesh;
  readonly cuff: THREE.Mesh;
  private fingers: { knuckle: THREE.Group; mid: THREE.Group }[] = [];
  private thumb = new THREE.Group();
  /** 0 open, 1 a fist. */
  curl = 0;
  private static readonly WRIST = new THREE.Vector3(0, -0.005, 0.062);

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

    // Where the rope was: a band still round the wrist and a frayed end hanging
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.009, 6, 16), rope);
    band.position.set(0, -0.004, 0.085);
    this.root.add(band);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.006, 0.11, 6), rope);
    tail.position.set(side * 0.02, -0.06, 0.09);
    tail.rotation.z = side * 0.35;
    this.root.add(tail);

    this.fore = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1), skin);
    this.cuff = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.11), sleeve);
    camera.add(this.fore, this.cuff);
    this.visible = false;
  }

  set visible(on: boolean) {
    this.root.visible = on;
    this.fore.visible = on;
    this.cuff.visible = on;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** Close the fingers and lay the forearm back to `shoulder` (camera space). */
  update(shoulder: THREE.Vector3): void {
    const c = THREE.MathUtils.clamp(this.curl, 0, 1);
    // Down into the palm (the back of the hand is +Y)
    for (const f of this.fingers) {
      f.knuckle.rotation.x = -1.45 * c;
      f.mid.rotation.x = -1.6 * c;
    }
    // Open it sticks out inboard; closed it lies across the front of the fist
    this.thumb.rotation.set(-0.4 * c, this.side * (0.7 * (1 - c) - 1.0 * c), 0);
    const wrist = Hand.WRIST.clone().applyQuaternion(this.root.quaternion).add(this.root.position);
    const dir = shoulder.clone().sub(wrist);
    const len = Math.min(dir.length(), 0.7);
    dir.normalize();
    this.fore.scale.set(1, 1, len);
    this.fore.position.copy(wrist).addScaledVector(dir, len / 2);
    this.fore.lookAt(wrist.clone().addScaledVector(dir, len));
    this.cuff.position.copy(wrist).addScaledVector(dir, len * 0.82);
    this.cuff.quaternion.copy(this.fore.quaternion);
  }
}

/**
 * CaptiveHands — Ravi's own two hands for the start of level six: tied down
 * out of shot, then freed one at a time and brought up into view, and then
 * the right one thrown into a face.
 *
 * Camera-space, like the weapon viewmodels, because they only ever have to
 * be where his eyes are. The scene poses each hand; each forearm is laid
 * back to a shoulder point under the frame so it always reads as his arm.
 * A band of the rope is still round each wrist.
 */
export class CaptiveHands {
  readonly right: Hand;
  readonly left: Hand;
  private shoulderR = new THREE.Vector3(0.24, -0.56, 0.16);
  private shoulderL = new THREE.Vector3(-0.24, -0.56, 0.16);

  constructor(camera: THREE.Camera) {
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 });
    const sleeve = new THREE.MeshStandardMaterial({ color: SLEEVE, roughness: 0.9 });
    const rope = new THREE.MeshStandardMaterial({ color: ROPE, roughness: 0.95 });
    this.right = new Hand(camera, 1, skin, sleeve, rope);
    this.left = new Hand(camera, -1, skin, sleeve, rope);
  }

  update(): void {
    if (this.right.visible) this.right.update(this.shoulderR);
    if (this.left.visible) this.left.update(this.shoulderL);
  }
}
