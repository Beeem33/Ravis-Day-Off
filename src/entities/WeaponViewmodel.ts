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
  private sprintPos = new THREE.Vector3(0.12, -0.27, -0.36);
  private sprintRot = new THREE.Euler(0.45, -0.75, 0.55);

  /** 0..1 — how far into aim-down-sights we are (for FOV zoom + spread). */
  aimBlend = 0;
  private sprintBlend = 0;

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
    const supportHand = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 0.06), skin);
    supportHand.position.set(-0.015, -0.1, 0.03);
    supportHand.rotation.z = 0.4;
    this.gun.add(supportHand);

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
    this.aimBlend += ((aiming && !sprinting ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 12);
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
    const sprintRoll = Math.sin(phase) * 0.08 * sp;

    // ---- Recoil spring
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.slideKick = Math.max(0, this.slideKick - dt * 14);
    const r = this.recoil * this.recoil * (1 - 0.4 * a);

    // Base pose = hip → ADS → sprint blend
    const px = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.x, this.aimPos.x, a), this.sprintPos.x, sp);
    const py = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.y, this.aimPos.y, a), this.sprintPos.y, sp);
    const pz = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.z, this.aimPos.z, a), this.sprintPos.z, sp);

    this.root.position.set(
      px + this.swayX + bobX + sprintSwayX,
      py + this.swayY + bobY + sprintSwayY + r * 0.015,
      pz + r * 0.06
    );
    this.root.rotation.set(
      -r * 0.28 + this.swayY * 3 + this.sprintRot.x * sp,
      this.swayX * 3 + this.sprintRot.y * sp,
      this.swayX * 1.5 + this.sprintRot.z * sp + sprintRoll
    );
    this.slide.position.z = -0.03 + this.slideKick * 0.045;

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
