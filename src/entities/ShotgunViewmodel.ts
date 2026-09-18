import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FPSPlayer } from './FPSPlayer';
import { FirstPersonArms, grip } from './RaviVisual';

/**
 * Ravi's hands on the two box anchors (each in the box's own frame): the
 * right round the wrist of the stock, trigger finger in the guard; the left
 * wrapped round the pump, riding it through every stroke.
 */
const GRIP_R = grip([0.0375, 0.061, 0.015], [-0.1, -0.6, -0.79], [-1, 0.1, 0], [0.2, -0.35, 0.9], {
  fingers: [[-10, 15, 15], [80, 85, 35], [84, 85, 35], [88, 85, 35]],
  thumb: [0.3, 0.2, 0.1]
});
const GRIP_L = grip([-0.046, -0.017, 0.037], [0.8, 0.05, -0.6], [0, 1, 0], [-0.18, -0.22, 0.3], {
  fingers: [[60, 70, 30], [62, 70, 30], [64, 70, 32], [66, 70, 34]],
  thumb: [0.2, 0.15, 0.1]
});

/**
 * ShotgunViewmodel — Ravi's pump-action shotgun. The gun is a modelled
 * 12-gauge loaded from models/shotgun.glb (walnut furniture with baked grain
 * and checkering, blued barrel, parkerised receiver); the hands, forearms and
 * the shell held during a reload are still built from primitives here.
 *
 * Everything else is as it was: the same procedural sway/bob/recoil treatment
 * as the pistol, a cycling pump (the support hand rides the forend) and a
 * shell-by-shell reload through the loading port.
 */
export class ShotgunViewmodel {
  readonly root = new THREE.Group();
  private gun = new THREE.Group();
  /** The glTF scene, turned so its +X muzzle points down gun-local −Z. */
  private model = new THREE.Group();
  /** Carries the support hand, and slides with the pump stroke. */
  private pump = new THREE.Group();
  /** The wooden forend and action bars, which ride the same stroke. */
  private forend = new THREE.Group();
  private muzzle = new THREE.Object3D();
  private port = new THREE.Object3D();
  private flashSprite: THREE.Sprite;
  /** Wider, dimmer second star, spun independently of the core. */
  private flashHalo!: THREE.Sprite;
  private flashLight: THREE.PointLight;

  /**
   * glb metres → gun-local metres. Picked so the modelled gun lands on the
   * landmarks the primitive one used — bead at (0, 0.057, −0.49), butt plate
   * at z ≈ 0.455 — which keeps every pose, hand and reload offset valid.
   */
  private static readonly SCALE = 0.9455;
  private static readonly MODEL_Y = 0.0038;
  private static readonly MODEL_Z = 0.09;
  /** The 95 mm pump stroke, expressed in the model's own pre-scale units. */
  private static readonly PUMP_TRAVEL = 0.095 / 0.9455;

  private swayX = 0;
  private swayY = 0;
  private recoil = 0;
  private flashTimer = 0;
  /** Scales every recoil-driven movement of the viewmodel (1 = the original). */
  private static readonly KICK = 0.7;

  private basePos = new THREE.Vector3(0.2, -0.24, -0.46);
  /** Aim pose: bead lined up with the crosshair. */
  private aimPos = new THREE.Vector3(0, -0.078, -0.3);
  private sprintPos = new THREE.Vector3(0.08, -0.3, -0.4);
  private sprintRot = new THREE.Euler(-0.45, 0.75, 0.55);

  aimBlend = 0;
  /** 1 = stowed out of frame, 0 = in hand (drives weapon switching). */
  stow = 1;
  private sprintBlend = 0;

  // ---- Pump cycle (after each shot)
  static readonly PUMP_DELAY = 0.14;
  static readonly PUMP_TIME = 0.48;
  private pumpT = Infinity; // time since fire; Infinity = at rest
  /** Hooks for the scene: pump audio + the ejected hull. */
  onPumpEvent: ((e: 'back' | 'eject' | 'forward') => void) | null = null;
  private pumpFired = new Set<string>();
  /** True while the emote borrows the left hand — hides the support hand. */
  hideSupportHand = false;

  // ---- Shell-by-shell reload
  private supportHand!: THREE.Mesh;
  private loadingShell!: THREE.Mesh;
  private handHome = new THREE.Vector3(-0.01, -0.055, -0.16); // on the forend
  /** Ravi's own arms, laid onto the box hands each frame. */
  private arms!: FirstPersonArms;
  reloading = false;
  private reloadT = 0;
  private shellsToLoad = 0;
  private shellsDone = 0;
  static readonly SHELL_TIME = 0.55;
  onReloadEvent: ((e: 'shellIn' | 'done') => void) | null = null;

  /** Begin loading `count` shells. Returns false if already reloading. */
  startReload(count: number): boolean {
    if (this.reloading || count <= 0) return false;
    this.reloading = true;
    this.reloadT = 0;
    this.shellsToLoad = count;
    this.shellsDone = 0;
    return true;
  }

  /** Stop after the shell currently being seated (classic pump-gun interrupt). */
  cancelReload(): void {
    if (!this.reloading) return;
    // Finish the shell already in hand and stop: pin the target now, so it
    // doesn't creep up one shell at a time as each one goes in
    this.shellsToLoad = Math.min(this.shellsToLoad, this.shellsDone + 1);
  }

  constructor(camera: THREE.PerspectiveCamera) {
    camera.add(this.root);
    this.root.position.copy(this.basePos);
    this.root.add(this.gun);

    // The modelled gun: +X muzzle, +Y up, +Z the shooter's right, in metres.
    // Turning it 90° about Y puts the muzzle down gun-local −Z and the
    // ejection port on +X, which is where the primitive version had them.
    this.model.rotation.y = Math.PI / 2;
    this.model.scale.setScalar(ShotgunViewmodel.SCALE);
    this.model.position.set(0, ShotgunViewmodel.MODEL_Y, ShotgunViewmodel.MODEL_Z);
    this.gun.add(this.model);
    this.model.add(this.forend);

    // Ejection port anchor, on the real port in the receiver's right flank
    this.port.position.set(0.021, 0.026, 0.026);
    this.gun.add(this.port);

    // Pump group: the support hand rides it, and the wood moves in step
    this.pump.position.set(0, -0.004, -0.2);
    this.gun.add(this.pump);

    // Hands + forearms — same treatment as the pistol so the arms read on screen
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5c3b, roughness: 0.85 });
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
    // Right hand on the wrist of the stock
    const gripHand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.08), skin);
    gripHand.position.set(0, -0.038, 0.228);
    gripHand.rotation.x = 0.15;
    this.gun.add(gripHand);
    mkForearm(gripHand, new THREE.Vector3(0.15, -0.2, 0.3));
    // Left hand wrapped around the pump — parented to it so it rides the cycle
    this.supportHand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.062, 0.075), skin);
    this.supportHand.position.set(0, -0.008, 0.01);
    this.pump.add(this.supportHand);
    mkForearm(this.supportHand, new THREE.Vector3(-0.18, -0.22, 0.3));
    // A fresh shell held in the left hand during reloads
    this.loadingShell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0105, 0.0105, 0.06, 10),
      new THREE.MeshStandardMaterial({ color: 0xb32222, roughness: 0.6 })
    );
    const brass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0115, 0.0115, 0.014, 10),
      new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.35 })
    );
    brass.position.y = -0.033;
    this.loadingShell.add(brass);
    this.loadingShell.visible = false;
    this.supportHand.add(this.loadingShell);
    // Ravi's real arms ride the two box hands; the boxes stop drawing once his model is in
    this.arms = new FirstPersonArms(this.root, camera).set('r', gripHand, GRIP_R).set('l', this.supportHand, GRIP_L);
    this.arms.replaces(skin, sleeve);

    // Muzzle anchor + flash, on the modelled barrel's bore
    this.muzzle.position.set(0, 0.042, -0.509);
    this.gun.add(this.muzzle);
    const flashTex = ShotgunViewmodel.makeFlashTexture();
    this.flashSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    );
    this.flashSprite.scale.setScalar(0.52);
    this.flashSprite.visible = false;
    this.muzzle.add(this.flashSprite);
    // A second, wider copy spun the other way: two overlapping stars read as
    // one ragged bloom rather than a rubber-stamped sprite
    this.flashHalo = new THREE.Sprite(
      (this.flashSprite.material as THREE.SpriteMaterial).clone()
    );
    this.flashHalo.material.opacity = 0.55;
    this.flashHalo.scale.setScalar(0.78);
    this.flashHalo.position.z = -0.03;
    this.flashHalo.visible = false;
    this.muzzle.add(this.flashHalo);
    this.flashLight = new THREE.PointLight(0xffb45e, 0, 6, 1.8);
    // Stays in the scene for good: switching a light off changes the
    // scene's visible light count, which recompiles every material in it.
    this.muzzle.add(this.flashLight);

    new GLTFLoader().load(`${import.meta.env.BASE_URL}models/shotgun.glb`, (gltf) => {
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
      // Split out the parts that cycle: forend, its cap, and the action bars
      this.model.updateWorldMatrix(true, true);
      for (const name of ['Forend', 'ForendCap', 'ActionBarL', 'ActionBarR']) {
        const part = scene.getObjectByName(name);
        if (part) this.forend.attach(part);
      }
    });
  }

  /**
   * A 12 gauge's flash is a big ragged star, not the pistol's little blob:
   * a white-hot core, petals of burning powder thrown out around it, and a
   * dirty orange haze behind the lot.
   */
  private static makeFlashTexture(): THREE.Texture {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const mid = S / 2;

    // Outer haze
    const haze = g.createRadialGradient(mid, mid, 2, mid, mid, mid);
    haze.addColorStop(0, 'rgba(255,236,190,0.95)');
    haze.addColorStop(0.22, 'rgba(255,186,80,0.7)');
    haze.addColorStop(0.6, 'rgba(226,118,26,0.28)');
    haze.addColorStop(1, 'rgba(150,60,10,0)');
    g.fillStyle = haze;
    g.fillRect(0, 0, S, S);

    // Petals: uneven spikes of burning powder, the way a cylinder bore throws it
    g.globalCompositeOperation = 'lighter';
    const petals = 7;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + Math.random() * 0.5;
      const len = mid * (0.55 + Math.random() * 0.45);
      const wide = 0.12 + Math.random() * 0.14;
      const grad = g.createLinearGradient(mid, mid, mid + Math.cos(a) * len, mid + Math.sin(a) * len);
      grad.addColorStop(0, 'rgba(255,245,215,0.95)');
      grad.addColorStop(0.45, 'rgba(255,178,66,0.5)');
      grad.addColorStop(1, 'rgba(255,120,20,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(mid + Math.cos(a - wide) * mid * 0.16, mid + Math.sin(a - wide) * mid * 0.16);
      g.lineTo(mid + Math.cos(a) * len, mid + Math.sin(a) * len);
      g.lineTo(mid + Math.cos(a + wide) * mid * 0.16, mid + Math.sin(a + wide) * mid * 0.16);
      g.closePath();
      g.fill();
    }

    // White-hot core last, over everything
    const core = g.createRadialGradient(mid, mid, 0, mid, mid, mid * 0.2);
    core.addColorStop(0, 'rgba(255,255,248,1)');
    core.addColorStop(1, 'rgba(255,214,140,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, S, S);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** World-space muzzle position (for pellet tracers). */
  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  /** World-space pose of the ejection port, for spawning the spent hull. */
  ejectedShellPose(): { position: THREE.Vector3; direction: THREE.Vector3 } {
    this.port.updateWorldMatrix(true, false);
    const position = this.port.getWorldPosition(new THREE.Vector3());
    const gunQ = this.gun.getWorldQuaternion(new THREE.Quaternion());
    // Out the right side of the receiver, up and a little back
    const direction = new THREE.Vector3(1, 0.7, 0.3).applyQuaternion(gunQ).normalize();
    return { position, direction };
  }

  /** True while the pump is mid-cycle (no firing until it's forward again). */
  get pumping(): boolean {
    return this.pumpT < ShotgunViewmodel.PUMP_DELAY + ShotgunViewmodel.PUMP_TIME;
  }

  fire(): void {
    this.recoil = 1;
    this.flashTimer = 0.075;
    this.flashSprite.visible = true;
    this.flashHalo.visible = true;
    // Both stars spin, in opposite directions and by different amounts, so
    // no two blasts show the same shape
    const spin = Math.random() * Math.PI * 2;
    this.flashSprite.material.rotation = spin;
    this.flashHalo.material.rotation = -spin * 0.6 + Math.random();
    const size = 0.46 + Math.random() * 0.14;
    this.flashSprite.scale.setScalar(size);
    this.flashHalo.scale.setScalar(size * 1.55);
    this.flashLight.intensity = 9;
    this.pumpT = 0;
    this.pumpFired.clear();
  }

  private pumpEvent(name: 'back' | 'eject' | 'forward'): void {
    if (this.pumpFired.has(name)) return;
    this.pumpFired.add(name);
    this.onPumpEvent?.(name);
  }

  /** Forend travel 0..1 plus a gun-pitch nudge while cycling. */
  private updatePump(dt: number): [number, number] {
    if (this.pumpT === Infinity) return [0, 0];
    this.pumpT += dt;
    const t = this.pumpT - ShotgunViewmodel.PUMP_DELAY;
    if (t < 0) return [0, 0];
    const T = ShotgunViewmodel.PUMP_TIME;
    if (t >= T) {
      this.pumpT = Infinity;
      return [0, 0];
    }
    const ease = (x: number) => x * x * (3 - 2 * x);
    const k = t / T;
    let slide: number;
    if (k < 0.4) {
      slide = ease(k / 0.4);
      if (k > 0.05) this.pumpEvent('back');
    } else if (k < 0.55) {
      slide = 1;
      this.pumpEvent('eject');
    } else {
      slide = 1 - ease((k - 0.55) / 0.45);
      if (k > 0.9) this.pumpEvent('forward');
    }
    // The whole gun dips and pitches with the throw of the arm
    const pitch = 0.09 * Math.sin(Math.min(1, k / 0.9) * Math.PI);
    return [slide, pitch];
  }

  /**
   * Drives the shell-by-shell reload. The gun rolls up and to the left so
   * the loading port under the receiver faces the left hand; the hand
   * cycles: drop to grab a shell, ride up to the port, thumb it in.
   * Returns [rotX, rotY, rotZ, posX, posY, posZ] offsets for the gun root.
   */
  private updateReload(dt: number): [number, number, number, number, number, number] {
    if (!this.reloading) {
      this.supportHand.position.set(0, -0.008, 0.01);
      this.loadingShell.visible = false;
      return [0, 0, 0, 0, 0, 0];
    }
    this.reloadT += dt;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));
    const S = ShotgunViewmodel.SHELL_TIME;

    const idx = Math.floor(this.reloadT / S);
    const totalWanted = this.shellsToLoad;
    // A shell counts on a thin slice of its cycle; a frame longer than that
    // slice (anything under ~70fps) could step clean over it, and a shell
    // never counted meant the tube never filled and the reload never ended.
    // Any shell whose cycle has gone by is in, whether or not a frame landed
    // on its moment.
    while (this.shellsDone < Math.min(idx, totalWanted)) {
      this.shellsDone++;
      this.loadingShell.visible = false;
      this.loadingShell.scale.setScalar(1);
      this.onReloadEvent?.('shellIn');
    }
    if (idx >= totalWanted && this.shellsDone >= totalWanted) {
      // Ease back out over the last 0.2s
      const outK = ease(c01((this.reloadT - totalWanted * S) / 0.2));
      this.supportHand.position.set(0, -0.008, 0.01);
      this.loadingShell.visible = false;
      const inBlend = 1 - outK;
      if (outK >= 1) {
        this.reloading = false;
        this.onReloadEvent?.('done');
      }
      return [0.35 * inBlend, 0.12 * inBlend, -0.55 * inBlend, 0.04 * inBlend, 0.02 * inBlend, 0.1 * inBlend];
    }

    // Pose held for the whole reload: rolled left, port toward the camera-left
    const inBlend = ease(c01(this.reloadT / 0.18));
    const rot: [number, number, number] = [0.35 * inBlend, 0.12 * inBlend, -0.55 * inBlend];
    const pos: [number, number, number] = [0.04 * inBlend, 0.02 * inBlend, 0.1 * inBlend];

    // Per-shell hand cycle, in pump-local space (hand is a child of the pump)
    const k = c01((this.reloadT - idx * S) / S);
    const below = new THREE.Vector3(-0.12, -0.3, 0.14); // down off-screen grabbing a shell
    const atPort = new THREE.Vector3(-0.015, -0.075, 0.24); // under the receiver's port
    if (k < 0.35) {
      // Coming up with a fresh shell
      const j = ease(k / 0.35);
      this.supportHand.position.lerpVectors(below, atPort, j);
      this.loadingShell.visible = true;
      this.loadingShell.position.set(0, 0.01, 0.05);
      this.loadingShell.rotation.set(Math.PI / 2 - 0.3, 0, 0);
    } else if (k < 0.6) {
      // Thumbing it into the tube
      const j = ease((k - 0.35) / 0.25);
      this.supportHand.position.copy(atPort).add(new THREE.Vector3(0, 0.015 * j, -0.02 * j));
      this.loadingShell.position.set(0, 0.01, 0.05 - 0.05 * j);
      this.loadingShell.scale.setScalar(1 - 0.6 * j);
      if (j > 0.9 && this.shellsDone === idx) {
        this.shellsDone++;
        this.loadingShell.visible = false;
        this.loadingShell.scale.setScalar(1);
        this.onReloadEvent?.('shellIn');
      }
    } else {
      // Hand drops away for the next shell (or to wrap up)
      const j = ease((k - 0.6) / 0.4);
      this.supportHand.position.lerpVectors(atPort, below, j);
      this.loadingShell.visible = false;
    }
    return [...rot, ...pos];
  }

  update(dt: number, player: FPSPlayer, mouseDX: number, mouseDY: number, aiming: boolean): void {
    this.supportHand.visible = !this.hideSupportHand;
    const sprinting = player.sprinting && player.currentSpeed > 4.5;
    const [rlX, rlY, rlZ, rlPosX, rlPosY, rlPosZ] = this.updateReload(dt);
    const [pumpSlide, pumpPitch] = this.updatePump(dt);
    this.aimBlend += ((aiming && !sprinting && !this.reloading ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 12);
    this.sprintBlend += ((sprinting ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 8);
    const a = this.aimBlend;
    const sp = this.sprintBlend;

    const swayScale = 1 - 0.75 * a;
    this.swayX += (-mouseDX * 0.00009 * swayScale - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (mouseDY * 0.00009 * swayScale - this.swayY) * Math.min(1, dt * 10);

    const { phase, amount } = player.bob;
    const bobScale = (1 - 0.7 * a) * (1 + 1.6 * sp);
    const bobX = Math.sin(phase) * 0.012 * amount * bobScale;
    const bobY = -Math.abs(Math.sin(phase)) * 0.012 * amount * bobScale - (player.crouching ? 0.02 : 0) * (1 - a);
    const sprintSwayX = Math.sin(phase) * 0.035 * sp;
    const sprintSwayY = Math.sin(phase * 2) * 0.018 * sp;
    const sprintRoll = -Math.sin(phase) * 0.08 * sp;

    // Heavier recoil spring than the pistol — it's a 12 gauge. KICK holds
    // the whole thing down: the gun was throwing itself around too far.
    this.recoil = Math.max(0, this.recoil - dt * 5);
    const r = this.recoil * this.recoil * (1 - 0.3 * a) * ShotgunViewmodel.KICK;

    const px = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.x, this.aimPos.x, a), this.sprintPos.x, sp);
    const py = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.y, this.aimPos.y, a), this.sprintPos.y, sp);
    const pz = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.z, this.aimPos.z, a), this.sprintPos.z, sp);

    this.root.position.set(
      px + this.swayX + bobX + sprintSwayX + rlPosX,
      py + this.swayY + bobY + sprintSwayY + r * 0.02 + rlPosY,
      pz + r * 0.11 + rlPosZ
    );
    this.root.rotation.set(
      -r * 0.42 + this.swayY * 3 + this.sprintRot.x * sp + rlX + pumpPitch,
      this.swayX * 3 + this.sprintRot.y * sp + rlY,
      this.swayX * 1.5 + this.sprintRot.z * sp + sprintRoll + rlZ
    );
    this.pump.position.z = -0.2 + pumpSlide * 0.095;
    // The wood rides the same stroke; inside the model group, back is −X
    this.forend.position.x = -ShotgunViewmodel.PUMP_TRAVEL * pumpSlide;

    // Draw / stow: swing down out of frame
    if (this.stow > 0.0001) {
      const s = this.stow;
      this.root.position.y -= s * 0.55;
      this.root.position.z += s * 0.14;
      this.root.rotation.x -= s * 1.1;
    }
    this.root.visible = this.stow < 0.995;
    this.arms.update();

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.flashLight.intensity *= 0.6;
      // The halo collapses faster than the core, so the star shrinks away
      this.flashHalo.scale.multiplyScalar(0.82);
      this.flashHalo.material.opacity *= 0.7;
      if (this.flashTimer <= 0) {
        this.flashHalo.visible = false;
        this.flashHalo.material.opacity = 0.55;
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
