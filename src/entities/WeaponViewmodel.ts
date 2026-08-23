import * as THREE from 'three';
import type { FPSPlayer } from './FPSPlayer';

/**
 * WeaponViewmodel — Ravi's sidearm, built from primitives and parented to
 * the camera. Procedural idle sway (mouse-driven), movement bob synced to
 * the player's stride, spring recoil, and a muzzle flash light + sprite.
 */
export class WeaponViewmodel {
  readonly root = new THREE.Group();
  private gun = new THREE.Group();
  private slide!: THREE.Mesh;
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
  private sprintRot = new THREE.Euler(0.45, 0.75, -0.55); // muzzle swings to the LEFT

  /** 0..1 — how far into aim-down-sights we are (for FOV zoom + spread). */
  aimBlend = 0;
  private sprintBlend = 0;

  // ---- Reload (John Wick style: flick the empty mag out left, slam a new one in)
  private supportHand!: THREE.Mesh;
  private magazine = new THREE.Group();
  private handHome = new THREE.Vector3(-0.015, -0.1, 0.03);
  reloading = false;
  private reloadT = 0;
  private reloadFired = new Set<string>();
  static readonly RELOAD_TIME = 1.75;
  private slidePull = 0; // 0..1 while the left hand racks the slide
  /** Hook for the scene: 'magOut' | 'magIn' | 'rack' | 'done'. */
  onReloadEvent: ((e: 'magOut' | 'magIn' | 'rack' | 'done') => void) | null = null;

  /** Begin the reload animation. Returns false if one is already running. */
  startReload(): boolean {
    if (this.reloading) return false;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadFired.clear();
    return true;
  }

  private reloadEvent(name: 'magOut' | 'magIn' | 'rack' | 'done'): void {
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
    else if (t < 0.5) roll = 1.45;
    else if (t < 0.78) roll = 1.45 - Math.PI * ease(c01((t - 0.5) / 0.28));
    else if (t < 1.12) roll = flipped;
    else if (t < 1.3) roll = flipped * (1 - ease(c01((t - 1.12) / 0.18)));
    else roll = 0;
    const rotZ = roll;

    const offscreen = new THREE.Vector3(-0.32, -0.42, 0.1); // where the left hand goes to fetch a mag

    if (t < 0.22) {
      // Well swinging to the right; left hand already letting go
      this.supportHand.position.lerpVectors(this.handHome, offscreen, ease(c01(t / 0.22)));
    } else if (t < 0.5) {
      // Mag shot out the well (gun-local -y, which now points screen-right)
      const k = c01((t - 0.22) / 0.28);
      this.reloadEvent('magOut');
      const fly = k * k * 1.6 + k * 0.3;
      this.magazine.position.set(0, -fly, 0.02 * k);
      this.magazine.rotation.set(2.5 * k, 0, 0.6 * k);
      if (k > 0.75) this.magazine.visible = false;
      this.supportHand.position.copy(offscreen);
    } else if (t < 0.78) {
      // Flipping the gun over; hand is off-screen grabbing the fresh mag
      this.magazine.visible = false;
      this.supportHand.position.copy(offscreen);
    } else if (t < 1.12) {
      // Fresh mag rides in along the well (gun-local -y, now screen-left)
      const k = ease(c01((t - 0.78) / 0.34));
      this.magazine.visible = true;
      this.magazine.position.set(0, -0.34 * (1 - k), 0.04 * (1 - k));
      this.magazine.rotation.set(0.5 * (1 - k), 0, 0);
      // Hand cups the baseplate the whole way in
      this.supportHand.position.copy(this.magazine.position).add(new THREE.Vector3(-0.005, -0.14, 0.085));
      this.supportHand.rotation.set(0, 0, 0.2);
      if (k > 0.98) this.reloadEvent('magIn');
    } else if (t < 1.3) {
      // Seated: roll upright, slap the baseplate, gun jolts
      const k = ease(c01((t - 1.12) / 0.18));
      this.magazine.position.set(0, 0, 0);
      this.magazine.rotation.set(0, 0, 0);
      this.supportHand.position.lerpVectors(
        new THREE.Vector3(-0.005, -0.14, 0.085),
        new THREE.Vector3(-0.02, 0.08, 0.03), // heading for the slide
        k
      );
      rotX += -0.12 * Math.sin(k * Math.PI);
    } else if (t < 1.55) {
      // Rack: left hand grips the slide, hauls it back, lets it snap forward
      const k = c01((t - 1.3) / 0.25);
      const pull = k < 0.5 ? ease(k / 0.5) : 1 - ease((k - 0.5) / 0.5) ** 0.35; // slow pull, fast release
      this.slidePull = pull;
      this.supportHand.position.set(-0.02, 0.085, 0.0 + pull * 0.06);
      this.supportHand.rotation.set(0, 0, 0);
      if (k > 0.55) this.reloadEvent('rack');
    } else {
      // Hand back to the support grip, done
      const k = ease(c01((t - 1.55) / 0.18));
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

  constructor(camera: THREE.PerspectiveCamera) {
    camera.add(this.root);
    this.root.position.copy(this.basePos);
    this.root.add(this.gun);

    const metal = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.7 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.5 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x3a3228, roughness: 0.9 });

    // Frame + barrel housing
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.22), metal);
    frame.position.set(0, 0, -0.02);
    this.gun.add(frame);
    // Slide (kicks back on fire)
    this.slide = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.24), darkMetal);
    this.slide.position.set(0, 0.045, -0.03);
    this.gun.add(this.slide);
    // Front sight / rear sight
    const fSight = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.012, 0.01), darkMetal);
    fSight.position.set(0, 0.073, -0.135);
    this.gun.add(fSight);
    const rSight = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.01, 0.012), darkMetal);
    rSight.position.set(0, 0.072, 0.075);
    this.gun.add(rSight);
    // Grip
    const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.11, 0.05), grip);
    gripMesh.position.set(0, -0.07, 0.07);
    gripMesh.rotation.x = 0.22;
    this.gun.add(gripMesh);
    // Trigger guard
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.06), metal);
    guard.position.set(0, -0.045, 0.015);
    this.gun.add(guard);
    // Hands (simple mitts so it doesn't look like a floating gun)
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5c3b, roughness: 0.85 });
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.07), skin);
    hand.position.set(0, -0.075, 0.075);
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

    // ---- Cosmetic detail (no gameplay effect) ----
    const steel = new THREE.MeshStandardMaterial({ color: 0x6c7077, roughness: 0.35, metalness: 0.9 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.95 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, emissive: 0x9a9a9a, roughness: 0.6 });

    // Exposed barrel crown at the slide's mouth
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 10), steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.045, -0.155);
    this.gun.add(barrel);
    // Rear slide serrations — grip cuts on both sides
    // (children of the slide, so they travel with it when it cycles)
    for (let i = 0; i < 5; i++) {
      for (const side of [-1, 1]) {
        const cut = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.03, 0.004), polymer);
        cut.position.set(side * 0.0205, 0, 0.065 + i * 0.011);
        this.slide.add(cut);
      }
    }
    // Ejection port (right side)
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.016, 0.04), polymer);
    port.position.set(0.021, 0.008, -0.005);
    this.slide.add(port);
    // Hammer peeking out the back of the slide
    const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, 0.01), steel);
    hammer.position.set(0, 0.03, 0.095);
    hammer.rotation.x = -0.5;
    this.gun.add(hammer);
    // Trigger inside the guard
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.024, 0.006), steel);
    trigger.position.set(0, -0.03, 0.02);
    trigger.rotation.x = 0.35;
    this.gun.add(trigger);
    // Slide release + thumb safety levers (left side)
    const release = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.008, 0.03), steel);
    release.position.set(-0.02, 0.012, 0.03);
    this.gun.add(release);
    const safety = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.01, 0.012), steel);
    safety.position.set(-0.02, 0.02, 0.085);
    this.gun.add(safety);
    // Stippled grip panels, slightly proud of the frame
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.08, 0.036), polymer);
      panel.position.set(side * 0.019, -0.07, 0.072);
      panel.rotation.x = 0.22;
      this.gun.add(panel);
    }
    // Magazine: body inside the grip + baseplate below it. Grouped so the
    // reload can flick the whole thing out and seat a fresh one.
    const magBody = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.1, 0.04), polymer);
    magBody.position.set(0, -0.075, 0.078);
    magBody.rotation.x = 0.22;
    this.magazine.add(magBody);
    const baseplate = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.012, 0.056), polymer);
    baseplate.position.set(0, -0.128, 0.082);
    baseplate.rotation.x = 0.22;
    this.magazine.add(baseplate);
    // Brass peeking out the top of a fresh mag
    const round = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.018, 8), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.35 }));
    round.rotation.x = Math.PI / 2;
    round.position.set(0, -0.02, 0.07);
    this.magazine.add(round);
    this.gun.add(this.magazine);
    // Accessory rail under the frame
    for (let i = 0; i < 3; i++) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.008), polymer);
      slot.position.set(0, -0.028, -0.06 - i * 0.02);
      this.gun.add(slot);
    }
    // Three-dot sights: white dots you can actually line up when aiming
    const fDot = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 0.002), white);
    fDot.position.set(0, 0.075, -0.1405);
    this.gun.add(fDot);
    for (const side of [-1, 1]) {
      const rDot = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 0.002), white);
      rDot.position.set(side * 0.007, 0.073, 0.0815);
      this.gun.add(rDot);
    }

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
    this.flashLight.visible = false;
    this.muzzle.add(this.flashLight);
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
    this.flashLight.visible = true;
    this.flashLight.intensity = 3.5;
  }

  update(dt: number, player: FPSPlayer, mouseDX: number, mouseDY: number, aiming: boolean): void {
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
    this.slide.position.z = -0.03 + this.slideKick * 0.045 + this.slidePull * 0.06;

    // ---- Muzzle flash decay
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.flashLight.intensity *= 0.6;
      if (this.flashTimer <= 0) {
        this.flashSprite.visible = false;
        this.flashLight.visible = false;
      }
    }
  }
}
