import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FPSPlayer } from './FPSPlayer';
import { FirstPersonArms, grip, mixGrip, type Grip } from './RaviVisual';

/**
 * How Ravi's hands sit on the two box anchors below (each in the box's own
 * frame): the shooting hand wrapped round the grip, trigger finger in the
 * guard; the support hand cupped under it, thumb along the frame.
 *
 * The shooting hand is fitted to the Glock's own geometry: the web of the
 * hand high under the back of the slide, the trigger finger laid along the
 * right of the frame and bent in at the middle joint so its pad is on the
 * face of the trigger, the other three wrapped across the front strap under
 * the guard, the thumb along the left side. It used to sit a hand's depth
 * too low, the finger hooked under the guard and out the other side.
 */
const GRIP_R = grip([0.0128, -0.0058, 0.0717], [0.172, 0.077, -0.982], [-0.912, -0.003, -0.411], [0.16, -0.22, 0.34], {
  fingers: [[-5, 39, 63], [72, 57, 35], [73, 57, 35], [70, 57, 35]],
  thumb: [0.2, -0.09, 0.1],
  spread: 3.4
});
const GRIP_L = grip([-0.057, -0.012, 0.074], [0.458, 0.186, -0.87], [0.958, 0.083, 0.2], [-0.2, -0.2, 0.26], {
  fingers: [[45, 60, 30], [50, 62, 30], [55, 64, 32], [60, 66, 34]],
  thumb: [0.2, 0.15, 0.1]
});
/**
 * The support hand racking the slide, in the gun's own frame with the slide
 * home: over the top from the left, palm on the back of the slide, the four
 * fingers wrapped down its right side across the rear serrations, the thumb
 * down the left. It rides the slide back and forward as it is hauled.
 */
const GRIP_RACK = grip([-0.071, 0.115, 0.051], [0.938, -0.218, 0.268], [-0.316, -0.948, -0.034], [-0.647, -0.539, 0.539], {
  fingers: [[31, 59, 30], [38, 59, 30], [34, 59, 30], [27, 59, 30]],
  thumb: [0.14, 1, 0.2],
  spread: -8
});

/**
 * WeaponViewmodel — Ravi's sidearm, a modelled Glock 17 (models/glock.glb)
 * parented to the camera. Procedural idle sway (mouse-driven), movement bob synced to
 * the player's stride, spring recoil, and a muzzle flash light + sprite.
 */
export class WeaponViewmodel {
  readonly root = new THREE.Group();
  private gun = new THREE.Group();
  private model = new THREE.Group();
  private slide = new THREE.Group();
  private muzzle = new THREE.Object3D();
  private flashSprite: THREE.Sprite;
  private flashLight: THREE.PointLight;

  private swayX = 0;
  private swayY = 0;
  private recoil = 0; // 1 right after a shot, springs back to 0
  private slideKick = 0;
  private flashTimer = 0;

  private basePos = new THREE.Vector3(0.23, -0.21, -0.42);
  /** Aim-down-sights pose: gun centered so the sights line up with the crosshair. */
  private aimPos = new THREE.Vector3(0, -0.073, -0.3);
  /** Sprint pose: gun dropped and canted diagonally across the body. */
  private sprintPos = new THREE.Vector3(0.1, -0.27, -0.36);
  private sprintRot = new THREE.Euler(-0.45, 0.75, 0.55); // muzzle down, swung left, canted IN toward the body

  /** 0..1 — how far into aim-down-sights we are (for FOV zoom + spread). */
  aimBlend = 0;
  /**
   * 1 = stowed out of frame, 0 = fully in hand. The intro starts at 1 and
   * eases to 0 as Ravi lifts the gun out of his desk drawer.
   */
  stow = 0;
  /**
   * 1 = out where it was lying on the desk, 0 = normal hold. The intro
   * blends this down as Ravi closes his shooting hand round it and lifts.
   */
  reach = 0;
  private sprintBlend = 0;

  // ---- Reload (John Wick style: flick the empty mag out left, slam a new one in)
  private supportHand!: THREE.Mesh;
  private magazine = new THREE.Group();
  private handHome = new THREE.Vector3(-0.015, -0.075, 0.014);
  reloading = false;
  private reloadT = 0;
  private reloadFired = new Set<string>();
  static readonly RELOAD_TIME = 1.63;
  private slidePull = 0; // 0..1 while the left hand racks the slide
  /** Ravi's own arms, laid onto the box hands each frame. */
  private arms: FirstPersonArms;
  private static _m = new THREE.Matrix4();
  private static _q = new THREE.Quaternion();
  /** Hook for the scene: 'magOut' | 'magDrop' | 'magIn' | 'rack' | 'done'. */
  onReloadEvent: ((e: 'magOut' | 'magDrop' | 'magIn' | 'rack' | 'done') => void) | null = null;
  /** True while the emote borrows the left hand — hides the support hand. */
  hideSupportHand = false;

  /**
   * World-space pose of the magazine right now plus the direction it's
   * flying (gun-local −Y), so the scene can spawn a physical copy that
   * lands in the level when the viewmodel's mag is hidden.
   */
  ejectedMagPose(): { position: THREE.Vector3; quaternion: THREE.Quaternion; direction: THREE.Vector3 } {
    this.magazine.updateWorldMatrix(true, false);
    const position = this.magazine.getWorldPosition(new THREE.Vector3());
    const quaternion = this.magazine.getWorldQuaternion(new THREE.Quaternion());
    const gunQ = this.gun.getWorldQuaternion(new THREE.Quaternion());
    const direction = new THREE.Vector3(0, -1, 0).applyQuaternion(gunQ).normalize();
    return { position, quaternion, direction };
  }

  /** Begin the reload animation. Returns false if one is already running. */
  startReload(): boolean {
    if (this.reloading) return false;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadFired.clear();
    return true;
  }

  private reloadEvent(name: 'magOut' | 'magDrop' | 'magIn' | 'rack' | 'done'): void {
    if (this.reloadFired.has(name)) return;
    this.reloadFired.add(name);
    this.onReloadEvent?.(name);
  }

  /**
   * Drives the reload. The gun is brought up close to the face so both arms
   * are in shot, then:
   *   1. rolls LEFT so the mag well faces right — the empty mag is shot out
   *   2. flips 180° so the well faces the left hand
   *   3. left hand brings a fresh mag up from the bottom-left and seats it
   *   4. gun rolls upright, left hand racks the slide, back to the ready
   * Returns [rotX, rotY, rotZ, posX, posY, posZ] offsets for the gun root.
   */
  private updateReload(dt: number): [number, number, number, number, number, number] {
    if (!this.reloading) {
      this.magazine.position.set(0, 0, 0);
      this.magazine.rotation.set(0, 0, 0);
      this.magazine.visible = true;
      this.supportHand.position.copy(this.handHome);
      this.supportHand.rotation.set(0, 0, 0.4);
      this.slidePull = 0;
      return [0, 0, 0, 0, 0, 0];
    }
    this.reloadT += dt;
    const t = this.reloadT;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));
    const T = WeaponViewmodel.RELOAD_TIME;

    // Bring the gun in close and centred for the whole reload (arms in shot)
    const inBlend = ease(c01(t / 0.2)) * (1 - ease(c01((t - (T - 0.25)) / 0.25)));
    const posX = (-0.14 + 0.0) * inBlend; // slide it toward screen centre
    const posY = 0.06 * inBlend; // raise it
    const posZ = 0.1 * inBlend; // pull it nearer the camera
    let rotX = 0.15 * inBlend;
    let rotY = 0.25 * inBlend;

    // Roll schedule: 0 → +1.45 (well faces right) → −1.69 (flipped the DOWNWARD
    // way, well faces left) → 0. Same end orientations as before; the 180° now
    // swings the gun and forearm down through the bottom instead of up.
    const flipped = 1.45 - Math.PI;
    let roll: number;
    if (t < 0.22) roll = 1.45 * ease(c01(t / 0.22));
    else if (t < 0.38) roll = 1.45;
    else if (t < 0.66) roll = 1.45 - Math.PI * ease(c01((t - 0.38) / 0.28));
    else if (t < 1.0) roll = flipped;
    else if (t < 1.18) roll = flipped * (1 - ease(c01((t - 1.0) / 0.18)));
    else roll = 0;
    const rotZ = roll;

    const offscreen = new THREE.Vector3(-0.32, -0.42, 0.1); // where the left hand goes to fetch a mag

    if (t < 0.22) {
      // Well swinging to the right; left hand already letting go
      this.supportHand.position.lerpVectors(this.handHome, offscreen, ease(c01(t / 0.22)));
    } else if (t < 0.38) {
      // Mag shot out the well (gun-local -y, which now points screen-right)
      const k = c01((t - 0.22) / 0.16);
      this.reloadEvent('magOut');
      const fly = k * k * 1.6 + k * 0.3;
      this.magazine.position.set(0, -fly, 0.02 * k);
      this.magazine.rotation.set(2.5 * k, 0, 0.6 * k);
      if (k > 0.75) {
        if (this.magazine.visible) this.reloadEvent('magDrop'); // hand the mag over to the world
        this.magazine.visible = false;
      }
      this.supportHand.position.copy(offscreen);
    } else if (t < 0.66) {
      // Flipping the gun over; hand is off-screen grabbing the fresh mag
      this.magazine.visible = false;
      this.supportHand.position.copy(offscreen);
    } else if (t < 1.0) {
      // Fresh mag rides in along the well (gun-local -y, now screen-left)
      const k = ease(c01((t - 0.66) / 0.34));
      this.magazine.visible = true;
      this.magazine.position.set(0, -0.34 * (1 - k), 0.04 * (1 - k));
      this.magazine.rotation.set(0.5 * (1 - k), 0, 0);
      // Hand cups the baseplate the whole way in
      this.supportHand.position.copy(this.magazine.position).add(new THREE.Vector3(-0.005, -0.14, 0.085));
      this.supportHand.rotation.set(0, 0, 0.2);
      if (k > 0.98) this.reloadEvent('magIn');
    } else if (t < 1.18) {
      // Seated: roll upright, slap the baseplate, gun jolts
      const k = ease(c01((t - 1.0) / 0.18));
      this.magazine.position.set(0, 0, 0);
      this.magazine.rotation.set(0, 0, 0);
      this.supportHand.position.lerpVectors(
        new THREE.Vector3(-0.005, -0.14, 0.085),
        new THREE.Vector3(-0.02, 0.08, 0.03), // heading for the slide
        k
      );
      rotX += -0.12 * Math.sin(k * Math.PI);
    } else if (t < 1.43) {
      // Rack: left hand grips the slide, hauls it back, lets it snap forward
      const k = c01((t - 1.18) / 0.25);
      const pull = k < 0.5 ? ease(k / 0.5) : 1 - ease((k - 0.5) / 0.5) ** 0.35; // slow pull, fast release
      this.slidePull = pull;
      this.supportHand.position.set(-0.02, 0.085, 0.0 + pull * 0.06);
      this.supportHand.rotation.set(0, 0, 0);
      if (k > 0.55) this.reloadEvent('rack');
    } else {
      // Hand back to the support grip, done
      const k = ease(c01((t - 1.43) / 0.18));
      this.slidePull = 0;
      this.supportHand.position.lerpVectors(new THREE.Vector3(-0.02, 0.085, 0.0), this.handHome, k);
      this.supportHand.rotation.set(0, 0, 0.4 * k);
      if (t >= T) {
        this.reloading = false;
        this.reloadEvent('done');
      }
    }
    return [rotX, rotY, rotZ, posX, posY, posZ];
  }

  /**
   * The support hand's grip this frame, in its box's frame: cupped under the
   * shooting hand, except through the rack, where it goes over onto the
   * slide, holds it all the way back and forward, and comes off again.
   */
  private leftGrip(): Grip {
    if (!this.reloading) return GRIP_L;
    const t = this.reloadT;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));
    const k = t < 1.18 ? ease(c01((t - 1.0) / 0.18)) : t < 1.43 ? 1 : 1 - ease(c01((t - 1.43) / 0.18));
    if (k <= 0) return GRIP_L;
    // Gun frame into the box's, the wrist carried back with the slide
    this.supportHand.updateMatrix();
    const m = WeaponViewmodel._m.copy(this.supportHand.matrix).invert();
    const q = WeaponViewmodel._q.setFromRotationMatrix(m);
    const rack: Grip = {
      wrist: GRIP_RACK.wrist.clone().setZ(GRIP_RACK.wrist.z + this.slide.position.z).applyMatrix4(m),
      along: GRIP_RACK.along.clone().applyQuaternion(q),
      palm: GRIP_RACK.palm.clone().applyQuaternion(q),
      toward: GRIP_RACK.toward.clone().applyQuaternion(q),
      shape: GRIP_RACK.shape
    };
    return k >= 1 ? rack : mixGrip(GRIP_L, rack, k);
  }

  constructor(camera: THREE.PerspectiveCamera) {
    camera.add(this.root);
    this.root.position.copy(this.basePos);
    this.root.add(this.gun);

    // The modelled pistol: +X muzzle, +Y up, +Z the shooter's right, in metres.
    // Turning it 90° about Y puts the muzzle down gun-local −Z and the ejection
    // port on +X, which is where the primitive version had them. It is built at
    // viewmodel scale already, so it needs no scale or offset: the muzzle lands
    // on z = −0.150 and the sight plane on y = +0.073, which is what aimPos
    // lines up with the crosshair.
    this.model.rotation.y = Math.PI / 2;
    this.gun.add(this.model);
    // The two parts that move on their own. The glb's meshes get attached into
    // these once it loads, so recoil and the reload drive them exactly as they
    // drove the primitive slide and magazine.
    this.gun.add(this.slide);
    this.gun.add(this.magazine);
    // Hands (simple mitts so it doesn't look like a floating gun)
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5c3b, roughness: 0.85 });
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.07), skin);
    hand.position.set(0, -0.055, 0.058);
    hand.rotation.x = 0.22;
    this.gun.add(hand);
    this.supportHand = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 0.06), skin);
    this.supportHand.position.copy(this.handHome);
    this.supportHand.rotation.z = 0.4;
    this.gun.add(this.supportHand);

    // Forearms so the arms read on screen (rolled-up shirt sleeves at the cuff)
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4d6f9c, roughness: 0.9 });
    const mkForearm = (parent: THREE.Object3D, toward: THREE.Vector3) => {
      const len = toward.length();
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, len), skin);
      arm.position.copy(toward).multiplyScalar(0.5);
      arm.lookAt(toward.clone().multiplyScalar(2));
      parent.add(arm);
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), sleeve);
      cuff.position.copy(toward).multiplyScalar(0.72);
      cuff.lookAt(toward.clone().multiplyScalar(2));
      parent.add(cuff);
    };
    // Right forearm runs from the grip hand back toward the right shoulder
    mkForearm(hand, new THREE.Vector3(0.16, -0.22, 0.34));
    // Left forearm hangs off the support hand toward the lower-left
    mkForearm(this.supportHand, new THREE.Vector3(-0.2, -0.2, 0.26));

    // Ravi's real arms ride the two box hands, which stay as the anchors the
    // recoil and reload animate; the boxes stop drawing once his model is in
    this.arms = new FirstPersonArms(this.root, camera).set('r', hand, GRIP_R).set('l', this.supportHand, GRIP_L);
    this.arms.replaces(skin, sleeve);

    // Muzzle anchor at barrel tip
    this.muzzle.position.set(0, 0.045, -0.16);
    this.gun.add(this.muzzle);

    // Muzzle flash sprite + light
    const flashTex = WeaponViewmodel.makeFlashTexture();
    this.flashSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    );
    this.flashSprite.scale.setScalar(0.16);
    this.flashSprite.visible = false;
    this.muzzle.add(this.flashSprite);
    this.flashLight = new THREE.PointLight(0xffb45e, 0, 4.5, 2.0);
    // Stays in the scene for good: switching a light off changes the
    // scene's visible light count, which recompiles every material in it.
    this.muzzle.add(this.flashLight);

    new GLTFLoader().load(`${import.meta.env.BASE_URL}models/glock.glb`, (gltf) => {
      const scene = gltf.scene;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
          m.frustumCulled = false; // it sits inside the near plane's neighbourhood
        }
      });
      this.model.add(scene);
      // attach() keeps world position, so park the two moving groups at rest
      // first — otherwise a reload mid-load would bake its offset into them.
      this.slide.position.set(0, 0, 0);
      this.magazine.position.set(0, 0, 0);
      this.magazine.rotation.set(0, 0, 0);
      this.model.updateWorldMatrix(true, true);
      const slidePart = scene.getObjectByName('Slide');
      if (slidePart) this.slide.attach(slidePart);
      const magPart = scene.getObjectByName('Magazine');
      if (magPart) this.magazine.attach(magPart);
    });
  }

  private static makeFlashTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 1, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,250,220,1)');
    grad.addColorStop(0.3, 'rgba(255,190,90,0.85)');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    // star spikes
    g.strokeStyle = 'rgba(255,230,160,0.9)';
    g.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI + Math.random() * 0.3;
      g.beginPath();
      g.moveTo(32 - Math.cos(a) * 30, 32 - Math.sin(a) * 30);
      g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** World-space muzzle position (for tracers). */
  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  fire(): void {
    this.recoil = 1;
    this.slideKick = 1;
    this.flashTimer = 0.045;
    this.flashSprite.visible = true;
    this.flashSprite.material.rotation = Math.random() * Math.PI * 2;
    this.flashLight.intensity = 3.5;
  }

  update(dt: number, player: FPSPlayer, mouseDX: number, mouseDY: number, aiming: boolean): void {
    // Left hand off the gun while the emote has it (forearm rides along as a child)
    this.supportHand.visible = !this.hideSupportHand;

    // ---- Pose blends: ADS snaps in fast, sprint pose is a touch lazier
    const sprinting = player.sprinting && player.currentSpeed > 4.5;
    const [rlX, rlY, rlZ, rlPosX, rlPosY, rlPosZ] = this.updateReload(dt);
    this.aimBlend += ((aiming && !sprinting && !this.reloading ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 12);
    this.sprintBlend += ((sprinting ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 8);
    const a = this.aimBlend;
    const sp = this.sprintBlend;

    // ---- Sway follows inverse mouse motion, spring back (tighter when aiming)
    const swayScale = 1 - 0.75 * a;
    this.swayX += (-mouseDX * 0.00009 * swayScale - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (mouseDY * 0.00009 * swayScale - this.swayY) * Math.min(1, dt * 10);

    // ---- Movement bob (synced with the player's stride)
    const { phase, amount } = player.bob;
    const bobScale = (1 - 0.7 * a) * (1 + 1.6 * sp); // calmer aimed, heavier at a sprint
    const bobX = Math.sin(phase) * 0.012 * amount * bobScale;
    const bobY = -Math.abs(Math.sin(phase)) * 0.012 * amount * bobScale - (player.crouching ? 0.02 : 0) * (1 - a);
    // Sprint: the gun pumps diagonally with the arms
    const sprintSwayX = Math.sin(phase) * 0.035 * sp;
    const sprintSwayY = Math.sin(phase * 2) * 0.018 * sp;
    const sprintRoll = -Math.sin(phase) * 0.08 * sp;

    // ---- Recoil spring
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.slideKick = Math.max(0, this.slideKick - dt * 14);
    const r = this.recoil * this.recoil * (1 - 0.4 * a);

    // Base pose = hip → ADS → sprint blend
    const px = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.x, this.aimPos.x, a), this.sprintPos.x, sp);
    const py = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.y, this.aimPos.y, a), this.sprintPos.y, sp);
    const pz = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.z, this.aimPos.z, a), this.sprintPos.z, sp);

    this.root.position.set(
      px + this.swayX + bobX + sprintSwayX + rlPosX,
      py + this.swayY + bobY + sprintSwayY + r * 0.015 + rlPosY,
      pz + r * 0.06 + rlPosZ
    );
    this.root.rotation.set(
      -r * 0.28 + this.swayY * 3 + this.sprintRot.x * sp + rlX,
      this.swayX * 3 + this.sprintRot.y * sp + rlY,
      this.swayX * 1.5 + this.sprintRot.z * sp + sprintRoll + rlZ
    );
    this.slide.position.z = this.slideKick * 0.045 + this.slidePull * 0.06;

    // ---- Taking it off the desk. The hand sweeps in from the right edge of
    // frame, low and across the desktop, and the gun comes up out of the
    // sweep. Holding it out at arm's length instead just looked like the
    // pistol drifting in on its own.
    if (this.reach > 0.0001) {
      const r = this.reach;
      this.root.position.x = THREE.MathUtils.lerp(this.root.position.x, 0.62, r); // off to the right
      this.root.position.y = THREE.MathUtils.lerp(this.root.position.y, -0.52, r); // down at desk height
      this.root.position.z = THREE.MathUtils.lerp(this.root.position.z, -0.52, r);
      this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, -0.95, r); // muzzle towards the desk
      this.root.rotation.y = THREE.MathUtils.lerp(this.root.rotation.y, 0.95, r); // swung across
      this.root.rotation.z = THREE.MathUtils.lerp(this.root.rotation.z, 0.55, r); // still on its side
    }

    // ---- Draw / stow: swing the whole gun down out of frame
    if (this.stow > 0.0001) {
      const s = this.stow;
      this.root.position.y -= s * 0.5;
      this.root.position.z += s * 0.14;
      this.root.rotation.x -= s * 1.1;
    }
    this.root.visible = this.stow < 0.995;
    this.arms.set('l', this.supportHand, this.leftGrip());
    this.arms.update();

    // ---- Muzzle flash decay
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.flashLight.intensity *= 0.6;
      if (this.flashTimer <= 0) {
        this.flashSprite.visible = false;
        // The light stays in the scene for good — switching one off moves
        // the visible light count and recompiles every material. Zeroing
        // the intensity is what actually puts it out; without this line it
        // decayed for three frames and then sat at 0.76 forever.
        this.flashLight.intensity = 0;
      }
    }
  }
}
