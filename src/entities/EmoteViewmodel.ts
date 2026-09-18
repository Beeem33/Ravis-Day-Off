import * as THREE from 'three';
import type { FPSPlayer } from './FPSPlayer';
import { FirstPersonArms, grip } from './RaviVisual';

/**
 * Ravi's left hand on the box fist (in its frame): palm to his face, back of
 * the hand to the room, every finger shut but the middle one.
 */
const GRIP_L = grip([0, -0.052, 0.004], [0, 1, 0], [0, 0, 1], [0.03, -0.97, 0.22], {
  fingers: [[88, 100, 60], [0, 3, 2], [88, 100, 60], [90, 100, 60]],
  thumb: [0.55, 0.9, 0.8]
});

/**
 * EmoteViewmodel — Ravi's left arm raised with the middle finger up,
 * parented to the camera like the weapon viewmodels. Toggled with T; the
 * scene cancels it when the left hand is needed for something else
 * (reloading, the knife) so the hand can go back to work.
 *
 * While it's up, the active weapon's support hand is hidden — one left
 * hand at a time.
 */
export class EmoteViewmodel {
  readonly root = new THREE.Group();
  /** Target state — toggled by the scene on T. */
  active = false;
  private blend = 0; // 0 = out of frame, 1 = up and proud
  private t = 0;

  private upPos = new THREE.Vector3(-0.24, -0.195, -0.46);
  private downPos = new THREE.Vector3(-0.32, -0.62, -0.5);
  /** Ravi's own arm, laid onto the box fist each frame. */
  private arms: FirstPersonArms;

  constructor(camera: THREE.PerspectiveCamera) {
    camera.add(this.root);
    this.root.visible = false;

    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5c3b, roughness: 0.85 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4d6f9c, roughness: 0.9 });

    // Forearm running down toward the bottom of frame, cuff at the elbow end
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.3, 0.062), skin);
    fore.position.set(0.008, -0.19, 0.05);
    fore.rotation.x = -0.22;
    this.root.add(fore);
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), sleeve);
    cuff.position.set(0.012, -0.33, 0.085);
    this.root.add(cuff);

    // Fist, knuckles toward the room
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.092, 0.075), skin);
    this.root.add(fist);
    // Folded fingers: a ridge across the top front of the fist
    const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.032, 0.024), skin);
    knuckles.position.set(0, 0.05, -0.032);
    this.root.add(knuckles);
    // Thumb clamped across the side
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.05, 0.028), skin);
    thumb.position.set(0.047, 0.008, -0.022);
    thumb.rotation.z = -0.45;
    this.root.add(thumb);

    // The message: middle finger, two segments, straight up
    const seg1 = new THREE.Mesh(new THREE.BoxGeometry(0.019, 0.055, 0.021), skin);
    seg1.position.set(0, 0.075, -0.024);
    this.root.add(seg1);
    const seg2 = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.05, 0.019), skin);
    seg2.position.set(0, 0.122, -0.02);
    seg2.rotation.x = -0.08;
    this.root.add(seg2);

    // Ravi's real arm rides the box fist; the boxes stop drawing once his model is in
    this.arms = new FirstPersonArms(this.root, camera).set('l', fist, GRIP_L);
    this.arms.replaces(skin, sleeve);
  }

  /** Flip it up / put it away. Returns the new state. */
  toggle(): boolean {
    this.active = !this.active;
    return this.active;
  }

  /** Lower the hand (reload started, knife out, died…). Stays down until T again. */
  cancel(): void {
    this.active = false;
  }

  /** True while the hand is up or on its way — the gun's left hand is spoken for. */
  get engaged(): boolean {
    return this.active || this.blend > 0.03;
  }

  update(dt: number, player: FPSPlayer): void {
    this.t += dt;
    this.blend += ((this.active ? 1 : 0) - this.blend) * Math.min(1, dt * 9);
    this.root.visible = this.blend > 0.01;
    if (!this.root.visible) return;

    const k = this.blend * this.blend * (3 - 2 * this.blend);
    // A little defiant waggle once it's up, plus the walk bob
    const waggle = Math.sin(this.t * 2.2) * 0.045 * k;
    const { phase, amount } = player.bob;
    const bobY = -Math.abs(Math.sin(phase)) * 0.01 * amount;

    this.root.position.lerpVectors(this.downPos, this.upPos, k);
    this.root.position.y += bobY;
    this.root.rotation.set(
      -0.9 * (1 - k) + 0.12 * k,
      0.3 * k,
      0.12 * k + waggle
    );
    this.arms.update();
  }
}
