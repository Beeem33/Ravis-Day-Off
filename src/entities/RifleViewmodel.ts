import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FPSPlayer } from './FPSPlayer';

/**
 * RifleViewmodel — the AK-47, loaded from models/ak47.glb and parented to
 * the camera like the pistol and shotgun. Same sway / bob / recoil
 * treatment, full-auto with a cycling bolt, and a speed reload driven off
 * the model's own pivots:
 *
 *   1. the left hand drops off-frame and comes back up holding a fresh mag
 *   2. the fresh mag's spine knocks the release and flicks the empty mag
 *      out FORWARD (it becomes a real object in the level)
 *   3. the fresh mag hooks its front lug and rocks back into the well
 *   4. the left hand comes over the top and racks the charging handle
 *
 * The butt-cheek keychain on the receiver is a real pendulum: it is driven
 * by the world-space acceleration of its hinge, so it swings with head bob,
 * mouse flicks, recoil, jumps and reloads and settles when Ravi stands still.
 */
export type RifleReloadEvent = 'grab' | 'strike' | 'magOut' | 'magDrop' | 'magIn' | 'rackBack' | 'rack' | 'done';

const SCALE = 0.72;
/** glb metres → gun-local metres. The glb points its muzzle down +X; the viewmodel convention is −Z. */
const gl = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(z * SCALE, y * SCALE, -x * SCALE);

export class RifleViewmodel {
  readonly root = new THREE.Group();
  private gun = new THREE.Group();
  /** The glTF scene, rotated so its +X muzzle points down gun-local −Z. */
  private model = new THREE.Group();
  private muzzle = new THREE.Object3D();
  private magCentre = new THREE.Object3D();
  private flashSprite: THREE.Sprite;
  private flashLight: THREE.PointLight;
  private magPivot: THREE.Object3D | null = null;
  private boltPivot: THREE.Object3D | null = null;
  private charmPivot: THREE.Object3D | null = null;
  /** A second magazine, carried by the left hand during the reload. */
  private handMag: THREE.Group | null = null;
  private magTemplate: THREE.Group | null = null;
  loaded = false;

  private swayX = 0;
  private swayY = 0;
  private recoil = 0;
  private boltKick = 0;
  private flashTimer = 0;
  /** Scales every recoil-driven movement of the viewmodel (1 = the original). */
  private static readonly KICK = 0.8;

  private basePos = new THREE.Vector3(0.2, -0.235, -0.47);
  private baseRot = new THREE.Euler(0.02, -0.07, 0);
  /** Aim pose: rear sight notch under the crosshair. */
  private aimPos = new THREE.Vector3(0, -0.056, -0.3);
  private sprintPos = new THREE.Vector3(0.08, -0.3, -0.45);
  private sprintRot = new THREE.Euler(-0.4, 0.7, 0.5);

  aimBlend = 0;
  /** 1 = stowed out of frame, 0 = in hand (drives weapon switching). */
  stow = 1;
  private sprintBlend = 0;

  // ---- Hands
  private supportHand!: THREE.Mesh;
  private handHome = gl(0.255, -0.035, 0); // under the lower handguard
  /** True while the emote borrows the left hand — hides the support hand. */
  hideSupportHand = false;

  // ---- Reload
  reloading = false;
  private reloadT = 0;
  private reloadFired = new Set<string>();
  static readonly RELOAD_TIME = 2.35;
  onReloadEvent: ((e: RifleReloadEvent) => void) | null = null;
  // Per-reload imperfection, rolled in startReload(): cadence, hand tremor,
  // strike overshoot and mag tilt all drift so no two reloads land the same
  private rSpeed = 1;
  private rWob = 1;
  private rMiss = 0;
  private rTilt = 0;
  private rP1 = 0;
  private rP2 = 0;
  private rP3 = 0;
  /** The animated mag's measured world velocity, for a seamless physics handoff. */
  private magVel = new THREE.Vector3();
  private magSpin = 0;
  private magPrevWorld = new THREE.Vector3();
  private magTracked = false;

  // ---- Keychain pendulum (angles in the glb frame: X forward, Y up, Z right)
  private charm = { swing: 0, side: 0, vSwing: 0, vSide: 0, ready: false };
  private charmPrevPos = new THREE.Vector3();
  private charmPrevVel = new THREE.Vector3();
  private static readonly CHARM_LENGTH = 0.045;

  constructor(camera: THREE.PerspectiveCamera) {
    camera.add(this.root);
    this.root.position.copy(this.basePos);
    this.root.add(this.gun);
    this.model.rotation.y = Math.PI / 2;
    this.model.scale.setScalar(SCALE);
    this.gun.add(this.model);
    this.muzzle.position.copy(gl(0.58, 0.022, 0));
    this.gun.add(this.muzzle);
    this.magCentre.position.copy(gl(0.1, -0.08, 0));
    this.gun.add(this.magCentre);

    // Hands + forearms, same treatment as the other guns so the arms read on screen
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
    // Right hand around the wooden grip
    const gripHand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.06), skin);
    gripHand.position.copy(gl(-0.08, -0.05, 0));
    gripHand.rotation.x = 0.4;
    this.gun.add(gripHand);
    mkForearm(gripHand, new THREE.Vector3(0.15, -0.2, 0.3));
    // Left hand cupping the handguard
    this.supportHand = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.06, 0.075), skin);
    this.supportHand.position.copy(this.handHome);
    this.gun.add(this.supportHand);
    mkForearm(this.supportHand, new THREE.Vector3(-0.18, -0.22, 0.3));

    // Muzzle flash sprite + light
    const flashTex = RifleViewmodel.makeFlashTexture();
    this.flashSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    );
    this.flashSprite.scale.setScalar(0.2);
    this.flashSprite.visible = false;
    this.muzzle.add(this.flashSprite);
    // In the scene for good, at zero between shots: switching a light's
    // visibility moves the scene's light count, and that recompiles every
    // material in it — which it used to do on every single round.
    this.flashLight = new THREE.PointLight(0xffb45e, 0, 5, 1.9);
    this.muzzle.add(this.flashLight);

    new GLTFLoader().load(`${import.meta.env.BASE_URL}models/ak47.glb`, (gltf) => {
      const scene = gltf.scene;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
          m.frustumCulled = false; // it lives inside the near plane's neighbourhood
        }
      });
      this.model.add(scene);
      this.magPivot = scene.getObjectByName('MagPivot') ?? null;
      this.boltPivot = scene.getObjectByName('BoltPivot') ?? null;
      this.charmPivot = scene.getObjectByName('CharmPivot') ?? null;
      if (this.magPivot) {
        // A copy of the magazine for the left hand to carry in, and one to
        // stamp out physical dropped mags from
        this.magTemplate = new THREE.Group();
        for (const child of this.magPivot.children) this.magTemplate.add(child.clone(true));
        this.handMag = this.magTemplate.clone(true);
        this.handMag.rotation.y = Math.PI / 2;
        this.handMag.scale.setScalar(SCALE);
        this.handMag.visible = false;
        this.supportHand.add(this.handMag);
      }
      this.loaded = true;
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

  /**
   * Where the magazine actually is, and how fast it is actually travelling,
   * at the instant the animation hands it to the level. Both are read off
   * the animated mag itself — spawning the physics copy anywhere else (the
   * well, say) teleports it backwards on the handoff frame.
   */
  ejectedMagPose(): {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    velocity: THREE.Vector3;
    angularVelocity: THREE.Vector3;
  } {
    this.root.updateWorldMatrix(true, true);
    const quaternion = this.magPivot
      ? this.magPivot.getWorldQuaternion(new THREE.Quaternion())
      : this.gun.getWorldQuaternion(new THREE.Quaternion());
    // The dropped prop's origin is its own centre of mass, so hand over the
    // centre of the animated mag rather than its lug
    const position = this.magPivot
      ? new THREE.Box3().setFromObject(this.magPivot).getCenter(new THREE.Vector3())
      : this.magCentre.getWorldPosition(new THREE.Vector3());
    // Carry the tumble over, about the axis the animation was spinning it,
    // plus a bit of wobble off that axis so it does not cartwheel flatly
    const angularVelocity = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(quaternion)
      .multiplyScalar(-this.magSpin)
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 5,
          (Math.random() - 0.5) * 5,
          (Math.random() - 0.5) * 5
        )
      );
    return { position, quaternion, velocity: this.magVel.clone(), angularVelocity };
  }

  /** A fresh copy of the magazine mesh at world scale, for the dropped-mag prop. */
  makeDroppedMag(): THREE.Group | null {
    if (!this.magTemplate) return null;
    const g = new THREE.Group();
    const copy = this.magTemplate.clone(true);
    copy.scale.setScalar(SCALE);
    g.add(copy);
    // The template's origin is the mag's front lug. Shift it so the group's
    // origin sits on the body's centre — that is where the physics body and
    // its collision box are, and where the handoff pose is measured.
    const centre = new THREE.Box3().setFromObject(copy).getCenter(new THREE.Vector3());
    copy.position.sub(centre);
    return g;
  }

  /** Begin the reload animation. Returns false if one is already running. */
  startReload(): boolean {
    if (this.reloading) return false;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadFired.clear();
    // Roll this reload's imperfections
    this.rSpeed = 0.94 + Math.random() * 0.14;
    this.rWob = 0.6 + Math.random() * 0.9;
    this.rMiss = Math.random();
    this.rTilt = (Math.random() - 0.5) * 0.14;
    this.rP1 = Math.random() * Math.PI * 2;
    this.rP2 = Math.random() * Math.PI * 2;
    this.rP3 = Math.random() * Math.PI * 2;
    this.magVel.set(0, 0, 0);
    this.magSpin = 0;
    this.magTracked = false;
    return true;
  }

  private reloadEvent(name: RifleReloadEvent): void {
    if (this.reloadFired.has(name)) return;
    this.reloadFired.add(name);
    this.onReloadEvent?.(name);
  }

  fire(): void {
    this.recoil = 1;
    this.boltKick = 1;
    this.flashTimer = 0.04;
    this.flashSprite.visible = true;
    this.flashSprite.material.rotation = Math.random() * Math.PI * 2;
    this.flashLight.intensity = 4;
    // The keychain gets a jolt off every shot
    this.charm.vSwing += 6 + Math.random() * 3;
    this.charm.vSide += (Math.random() - 0.5) * 5;
  }

  /**
   * Drives the reload. Returns [rotX, rotY, rotZ, posX, posY, posZ] offsets
   * for the gun root; mutates the model's pivots and the left hand directly.
   */
  private updateReload(dt: number): [number, number, number, number, number, number] {
    const mag = this.magPivot;
    const bolt = this.boltPivot;
    if (!this.reloading) {
      this.supportHand.position.copy(this.handHome);
      this.supportHand.rotation.set(0, 0, 0);
      if (this.handMag) this.handMag.visible = false;
      if (mag) {
        mag.visible = true;
        mag.rotation.set(0, 0, 0);
        mag.position.set(0.109, 0, 0);
      }
      return [0, 0, 0, 0, 0, 0];
    }
    // Cadence drifts a little per reload — some are hurried, some lazy
    this.reloadT += dt * this.rSpeed;
    const t = this.reloadT;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c01 = (x: number) => Math.min(1, Math.max(0, x));
    const T = RifleViewmodel.RELOAD_TIME;

    // Bring the rifle in and cant it so the mag well faces the camera, hold
    // that for the mag swap, then roll the other way to expose the charging
    // handle for the rack, then back to the ready.
    const inBlend = ease(c01(t / 0.3)) * (1 - ease(c01((t - (T - 0.32)) / 0.32)));
    const rackBlend = ease(c01((t - 1.46) / 0.24)) * (1 - ease(c01((t - 2.12) / 0.25)));
    // Camera sits off the rifle's left flank, so: lift the gun into frame,
    // pull it toward the centre, muzzle up a touch, and roll the top AWAY so
    // the underside / mag well (and later the charging handle) face the eye.
    const posX = -0.12 * inBlend;
    const posY = 0.11 * inBlend;
    const posZ = 0.04 * inBlend;
    let rotX = 0.3 * inBlend - 0.08 * rackBlend;
    const rotY = 0.2 * inBlend + 0.1 * rackBlend;
    let rotZ = -0.6 * inBlend + 0.25 * rackBlend;

    const offscreen = new THREE.Vector3(-0.28, -0.46, 0.06);
    const windUp = gl(0.09, -0.29, -0.02); // cocked below and BEHIND the well, ready to swing
    const strikeAt = gl(0.145, -0.185, -0.015); // mag spine on the release paddle
    // Follow-through past the well, chasing the old mag out — overshoots more
    // on a sloppy rep
    const strikeThrough = gl(0.24 + 0.05 * this.rMiss, -0.21, -0.015);
    const seatFrom = gl(0.17, -0.19, -0.01); // lug hooked, mag still tilted forward
    const seatAt = gl(0.11, -0.17, 0); // rocked back and latched
    const overTop = gl(0.03, 0.09, -0.06); // hand travelling over the receiver
    const onHandle = gl(0.03, 0.055, -0.045); // fingers on the charging handle
    const tImp = 0.7; // schedule time the fresh mag cracks the paddle
    const handMagLocal = (rot: number) => {
      // The lug rides 7 cm above the palm; tilt is about the mag's own lug
      if (!this.handMag) return;
      this.handMag.position.set(0, 0.07, 0);
      this.handMag.rotation.set(0, Math.PI / 2, 0);
      this.handMag.rotateZ(rot);
    };
    /**
     * Quadratic Bézier from `a` to `c` that passes exactly through `b` at
     * u = 0.5 — one continuous arc for the swing, so there is no corner
     * where a straight approach used to meet a straight follow-through.
     */
    const arc = (out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, u: number) => {
      const iu = 1 - u;
      const w0 = iu * iu;
      const w1 = 2 * iu * u;
      const w2 = u * u;
      out.set(
        w0 * a.x + w1 * (2 * b.x - 0.5 * a.x - 0.5 * c.x) + w2 * c.x,
        w0 * a.y + w1 * (2 * b.y - 0.5 * a.y - 0.5 * c.y) + w2 * c.y,
        w0 * a.z + w1 * (2 * b.z - 0.5 * a.z - 0.5 * c.z) + w2 * c.z
      );
    };

    if (t < 0.34) {
      // Hand lets go of the handguard and drops out of frame for a mag
      const k = ease(c01(t / 0.34));
      this.supportHand.position.lerpVectors(this.handHome, offscreen, k);
      this.supportHand.rotation.set(0.3 * k, 0, 0);
      if (this.handMag) this.handMag.visible = false;
      if (k > 0.5) this.reloadEvent('grab');
    } else if (t < 0.6) {
      // Up it comes with a fresh mag, winding up low and behind the well
      const k = ease(c01((t - 0.34) / 0.26));
      if (this.handMag) this.handMag.visible = true;
      this.supportHand.position.lerpVectors(offscreen, windUp, k);
      this.supportHand.rotation.set(0.25, 0, 0.1);
      handMagLocal(0.6 + this.rTilt);
    } else if (t < 0.8) {
      // The flick: the fresh mag swings forward THROUGH the paddle on one
      // continuous arc, batting the old mag out ahead of the gun and
      // following it through. Cosine easing puts peak speed exactly at
      // contact and bleeds it off after, so the swing carries rather than
      // snapping between poses.
      const k = c01((t - 0.6) / 0.2);
      const u = 0.5 * (1 - Math.cos(Math.PI * k));
      arc(this.supportHand.position, windUp, strikeAt, strikeThrough, u);
      this.supportHand.rotation.set(0.25 - 0.2 * u, 0, 0.1);
      handMagLocal(0.6 - 0.22 * u + this.rTilt * (1 - u));
      if (t >= tImp) {
        this.reloadEvent('strike');
        this.reloadEvent('magOut');
      }
    } else if (t < 1.1) {
      // Follow-through spent; draw back to hook the lug
      const k = ease(c01((t - 0.8) / 0.3));
      this.supportHand.position.lerpVectors(strikeThrough, seatFrom, k);
      this.supportHand.rotation.set(0.05 + 0.1 * k, 0, 0.1);
      handMagLocal(0.38 + 0.07 * k);
    } else if (t < 1.46) {
      // Hook the front lug and rock the mag back into the well
      const k = ease(c01((t - 1.1) / 0.36));
      this.supportHand.position.lerpVectors(seatFrom, seatAt, k);
      this.supportHand.rotation.set(0.15 * (1 - k), 0, 0.1 * (1 - k));
      handMagLocal(0.45 * (1 - k));
      if (k > 0.985) {
        if (this.handMag) this.handMag.visible = false;
        if (mag) {
          mag.visible = true;
          mag.rotation.set(0, 0, 0);
          mag.position.set(0.109, 0, 0);
        }
        this.reloadEvent('magIn');
      }
      // Latching jolt
      rotX += -0.06 * Math.sin(c01((k - 0.84) / 0.16) * Math.PI);
    } else if (t < 1.76) {
      // Left hand sweeps up and over the receiver to the charging handle —
      // one arc through the top of the travel, not two lerps meeting at a
      // dead stop
      const k = ease(c01((t - 1.46) / 0.3));
      arc(this.supportHand.position, seatAt, overTop, onHandle, k);
      this.supportHand.rotation.set(-0.5 * k, 0, 0.9 * k);
    } else if (t < 2.12) {
      // Rack: haul the bolt back (slow), let it fly forward (fast)
      const k = c01((t - 1.76) / 0.36);
      const pull = k < 0.62 ? ease(k / 0.62) : 1 - ease(((k - 0.62) / 0.38) ** 0.55);
      if (bolt) bolt.position.set(0.03 - 0.105 * pull, bolt.position.y, bolt.position.z);
      this.supportHand.position.copy(onHandle).add(new THREE.Vector3(0, 0, 0.105 * SCALE * pull));
      this.supportHand.rotation.set(-0.5, 0, 0.9);
      if (k > 0.58) this.reloadEvent('rackBack');
      if (k > 0.75) this.reloadEvent('rack');
      rotX += 0.05 * Math.sin(k * Math.PI);
    } else {
      // Hand back to the handguard, done
      const k = ease(c01((t - 2.12) / 0.23));
      if (bolt) bolt.position.set(0.03, bolt.position.y, bolt.position.z);
      this.supportHand.position.lerpVectors(onHandle, this.handHome, k);
      this.supportHand.rotation.set(-0.5 * (1 - k), 0, 0.9 * (1 - k));
      if (t >= T) {
        this.reloading = false;
        this.reloadEvent('done');
      }
    }

    // The old mag's exit is driven off the moment of impact, not the hand:
    // batted forward, tumbling, gravity taking over — then the level's
    // physics copy takes it from there
    if (mag && this.reloadFired.has('magOut') && !this.reloadFired.has('magIn')) {
      const dI = t - tImp;
      if (dI < 0.085) {
        // Knocked clear rather than dropped: the fresh mag's spine drives it
        // out along the well and away to the gun's right, tumbling. It is
        // handed to the level's physics the moment it is clear of the well,
        // carrying that speed, so the arc and the landing are real.
        const travel = dI * ease(c01(dI / 0.04));
        this.magSpin = 11 * this.rSpeed;
        mag.rotation.set(0, 0, Math.min(1.4, 11 * travel));
        mag.position.set(
          0.109 + 3.4 * travel, // driven forward along the magwell
          -2.2 * travel * travel, // barely dropping yet — it was hit, not released
          1.5 * travel // and out, clear of the gun
        );
      } else if (mag.visible) {
        this.reloadEvent('magDrop');
        mag.visible = false;
      }
    }
    // The whack shivers through the whole rifle
    if (t >= tImp && t < tImp + 0.2) {
      const j = c01((t - tImp) / 0.2);
      const shiver = Math.sin(j * Math.PI) ** 1.4;
      rotX += -0.07 * shiver;
      rotZ += 0.035 * shiver;
    }

    // Nobody's hands are servo motors: a low tremor rides the support hand
    // the whole way through, heavier on some reloads than others
    const wob = 0.0045 * this.rWob * inBlend;
    this.supportHand.position.x += Math.sin(t * 10.7 + this.rP1) * wob;
    this.supportHand.position.y += Math.sin(t * 8.3 + this.rP2) * wob;
    this.supportHand.position.z += Math.sin(t * 13.9 + this.rP3) * wob * 0.7;
    // …and the rifle itself drifts under the working hand
    rotX += 0.012 * this.rWob * inBlend * Math.sin(t * 9.1 + this.rP2);
    rotZ += 0.016 * this.rWob * inBlend * Math.sin(t * 6.7 + this.rP1);

    return [rotX, rotY, rotZ, posX, posY, posZ];
  }

  /**
   * The animated mag's world velocity, measured frame to frame. Measuring it
   * (rather than deriving it from the local animation) means the gun's own
   * motion — walking, turning, the reload swinging the rifle about — is
   * already in the number the physics copy launches with.
   */
  private trackMagVelocity(dt: number): void {
    const mag = this.magPivot;
    if (!mag || !this.reloading || dt <= 0) {
      this.magTracked = false;
      return;
    }
    this.root.updateWorldMatrix(true, true);
    const p = mag.getWorldPosition(new THREE.Vector3());
    if (this.magTracked) this.magVel.subVectors(p, this.magPrevWorld).divideScalar(dt);
    this.magPrevWorld.copy(p);
    this.magTracked = true;
  }

  /**
   * Keychain pendulum. Uses the hinge's world-space motion between frames as
   * the drive, so anything that moves the gun — walking, sprinting, jumping,
   * turning, recoil, the reload itself — swings it, and gravity always pulls
   * it toward the world's "down" however the rifle is tilted.
   */
  private updateCharm(dt: number): void {
    const pivot = this.charmPivot;
    if (!pivot || dt <= 0) return;
    const c = this.charm;
    const L = RifleViewmodel.CHARM_LENGTH;
    this.root.updateWorldMatrix(true, true);
    const pos = pivot.getWorldPosition(new THREE.Vector3());
    if (!c.ready || !this.root.visible) {
      this.charmPrevPos.copy(pos);
      this.charmPrevVel.set(0, 0, 0);
      c.ready = true;
      pivot.rotation.set(0, 0, 0);
      return;
    }
    const vel = pos.clone().sub(this.charmPrevPos).divideScalar(dt);
    const acc = vel.clone().sub(this.charmPrevVel).divideScalar(dt);
    this.charmPrevPos.copy(pos);
    this.charmPrevVel.copy(vel);

    // Into the glb frame (X forward, Y up, Z right) of the rifle
    const invQ = this.model.getWorldQuaternion(new THREE.Quaternion()).invert();
    acc.applyQuaternion(invQ);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(invQ);
    const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    const ax = clamp(acc.x, 40);
    const az = clamp(acc.z, 40);
    const restSwing = Math.atan2(down.x, -down.y); // where it hangs with the gun tilted fore/aft
    const restSide = Math.atan2(-down.z, -down.y);
    const g = 9.81 / L;
    const damp = 2.4;
    c.vSwing += (-g * Math.sin(c.swing - restSwing) - damp * c.vSwing - ax / L) * dt;
    c.vSide += (-g * Math.sin(c.side - restSide) - damp * c.vSide + az / L) * dt;
    c.swing = clamp(c.swing + c.vSwing * dt, 1.35);
    c.side = clamp(c.side + c.vSide * dt, 1.35);
    pivot.rotation.set(c.side, 0, c.swing);
  }

  update(dt: number, player: FPSPlayer, mouseDX: number, mouseDY: number, aiming: boolean): void {
    this.supportHand.visible = !this.hideSupportHand;
    const sprinting = player.sprinting && player.currentSpeed > 4.5;
    const [rlX, rlY, rlZ, rlPosX, rlPosY, rlPosZ] = this.updateReload(dt);
    this.trackMagVelocity(dt);
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

    // Rifle recoil: sharp, and the bolt carrier cycles with every shot.
    // KICK holds the butt down — the stock was throwing itself around far
    // more than the round warrants.
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.boltKick = Math.max(0, this.boltKick - dt * 16);
    const r = this.recoil * this.recoil * (1 - 0.35 * a) * RifleViewmodel.KICK;
    if (this.boltPivot && !this.reloading) {
      const cycle = Math.sin(Math.min(1, this.boltKick) * Math.PI);
      this.boltPivot.position.x = 0.03 - 0.105 * cycle;
    }

    const px = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.x, this.aimPos.x, a), this.sprintPos.x, sp);
    const py = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.y, this.aimPos.y, a), this.sprintPos.y, sp);
    const pz = THREE.MathUtils.lerp(THREE.MathUtils.lerp(this.basePos.z, this.aimPos.z, a), this.sprintPos.z, sp);

    this.root.position.set(
      px + this.swayX + bobX + sprintSwayX + rlPosX,
      py + this.swayY + bobY + sprintSwayY + r * 0.012 + rlPosY,
      pz + r * 0.07 + rlPosZ
    );
    this.root.rotation.set(
      -r * 0.22 + this.swayY * 3 + this.sprintRot.x * sp + rlX + this.baseRot.x * (1 - a),
      this.swayX * 3 + this.sprintRot.y * sp + rlY + this.baseRot.y * (1 - a),
      this.swayX * 1.5 + this.sprintRot.z * sp + sprintRoll + rlZ + (Math.random() - 0.5) * r * 0.04
    );

    // Draw / stow: swing down out of frame
    if (this.stow > 0.0001) {
      const s = this.stow;
      this.root.position.y -= s * 0.55;
      this.root.position.z += s * 0.14;
      this.root.rotation.x -= s * 1.1;
    }
    this.root.visible = this.stow < 0.995;

    this.updateCharm(dt);

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.flashLight.intensity *= 0.55;
      if (this.flashTimer <= 0) {
        this.flashSprite.visible = false;
        this.flashLight.intensity = 0;
      }
    }
  }
}
