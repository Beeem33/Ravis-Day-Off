import * as THREE from 'three';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level13Builder, type Level13Data, type Ladder, type TurretSite, CH_Y, SEW_Y, SLUDGE_Y, H1, H2, H3, H4, Y6, OFFICE_Y, FALL_Y, HALL } from '../environment/Level13Builder';
import type { Collider as Col } from '../environment/OfficeLevelBuilder';
import { FirstPersonArms, mixGrip } from '../entities/RaviVisual';
import { GRENADE_HOLD, GRENADE_OPEN, GRENADE_PIN } from '../entities/Grenades';
import { grenade as grenadeModel } from '../environment/VanProps';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { FPSPlayer } from '../entities/FPSPlayer';
import { KnifeTwirlViewmodel } from '../entities/KnifeTwirlViewmodel';
import { Arsenal, loadoutFor } from '../entities/Arsenal';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { hideInventory } from '../ui/InventoryUI';
import type { Enemy } from '../entities/Enemy';
import type { Collider } from '../environment/OfficeLevelBuilder';
import { FPSHUD } from '../ui/FPSHUD';

/**
 * Level13Scene — inside the Exterminator Collective.
 *
 *  1. The tube. Through the hole under the stairs and down a pipe in the
 *     dark, faster and faster, out of an outlet high in a sewer wall and
 *     down into the sludge.
 *  2. The sewers: green, buzzing, wading. Through to a chamber with a
 *     ladder up a shaft.
 *  3. The hall: a route of walkways over an abyss. Ladders, a walkway with
 *     no rails, a broken span crossed on beams, a lever that calls a
 *     platform over a gap. Sentry turrets sweep the walkways; in the beam
 *     and in sight, they lock on and fire. Fall, and that's it.
 *  4. The door at the end: a grenade planted on it, and it goes.
 */

type Phase = 'tube' | 'play' | 'plant' | 'done';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};
/** Wading: the most he can make through the sludge. */
const WADE = 2.3;
const CLIMB = 2.4;
const TURRET_RANGE = 30;
/** How wide the beam is that it sees down: either side of where it points, and up and down. */
const SEE_YAW = 0.1;
const SEE_PITCH = 0.22;

// ================================================================ turrets

/**
 * A sentry turret on its post: it sweeps back and forth with its light; if
 * Ravi is in the beam and nothing's between, it stops, locks (beep, the beam
 * goes red), tracks him and fires bursts until it's lost him for a moment.
 */
class Sentry {
  readonly group = new THREE.Group();
  readonly yawG = new THREE.Group();
  readonly pitchG = new THREE.Group();
  readonly meshes: THREE.Mesh[] = [];
  private beamMat: THREE.ShaderMaterial;
  private muzzles: THREE.Object3D[] = [];
  yaw: number;
  pitch: number;
  private ph = Math.random() * 6;
  state: 'sweep' | 'lock' | 'fire' | 'lost' = 'sweep';
  private t = 0;
  private burst = 0;
  private shotT = 0;
  private lostT = 0;
  recoil = 0;

  constructor(readonly site: TurretSite) {
    this.yaw = site.yaw;
    this.pitch = site.pitch;
    this.group.position.copy(site.pos);
    const dark = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.45, metalness: 0.8 });
    const plate = new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.5, metalness: 0.6 });
    const lens = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xeaf2ff, emissiveIntensity: 3 });
    const red = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 3 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.35, 14), dark);
    base.position.y = -0.45;
    this.group.add(base, this.yawG);
    this.yawG.add(this.pitchG);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.9), plate);
    const cheeks = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.32, 0.5), dark);
    cheeks.position.z = 0.1;
    this.pitchG.add(body, cheeks);
    for (const x of [-0.15, 0.15]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 8), dark);
      b.rotation.x = Math.PI / 2;
      b.position.set(x, -0.05, -0.95);
      this.pitchG.add(b);
      const m = new THREE.Object3D();
      m.position.set(x, -0.05, -1.52);
      this.pitchG.add(m);
      this.muzzles.push(m);
    }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.25, 12), dark);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, 0.32, -0.4);
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12), lens);
    l.position.set(0, 0.32, -0.53);
    l.rotation.y = Math.PI;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), red);
    eye.position.set(0.25, 0.1, -0.46);
    this.pitchG.add(lamp, l, eye);
    for (const m of [base, body, cheeks]) {
      m.userData.surface = 'metal';
      m.userData.noDecal = true;
      this.meshes.push(m);
    }
    // The beam: narrow at the lamp, opening out down the line it sees along
    const len = TURRET_RANGE;
    const cone = new THREE.CylinderGeometry(Math.tan(SEE_YAW) * len, 0.1, len, 20, 1, true);
    cone.rotateX(-Math.PI / 2);
    cone.translate(0, 0, -len / 2);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(0.85, 0.92, 1) }, uK: { value: 1 } },
      vertexShader: `varying float vZ; varying vec3 vN; varying vec3 vV; void main(){ vZ = -position.z / ${len.toFixed(1)}; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uCol; uniform float uK; varying float vZ; varying vec3 vN; varying vec3 vV; void main(){ float rim = pow(1.0 - abs(dot(vN, vV)), 0.6); float a = 0.12 * (1.0 - vZ) * (1.0 - vZ) * (0.35 + 0.65 * (1.0 - rim)) * uK; gl_FragColor = vec4(uCol, a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const beam = new THREE.Mesh(cone, this.beamMat);
    beam.position.set(0, 0.32, -0.55);
    beam.frustumCulled = false;
    beam.renderOrder = 6;
    this.pitchG.add(beam);
  }

  /** The gun's eye, in the world. */
  eye(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.site.pos).add(V(0, 0.32, 0));
  }

  /** Is `p` inside the beam (by angle and range, not by what's in the way)? */
  inBeam(p: THREE.Vector3): boolean {
    const e = this.eye(Sentry.tmp);
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const flat = Math.hypot(dx, dz);
    if (flat > TURRET_RANGE || flat < 1) return false;
    let dy = Math.atan2(-dx, -dz) - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const dp = Math.atan2(p.y - e.y, flat) - this.pitch;
    return Math.abs(dy) < SEE_YAW && Math.abs(dp) < SEE_PITCH;
  }

  /** Inside the stretch it guards (a little past its sweep): once locked, it won't follow him off it. */
  inZone(p: THREE.Vector3): boolean {
    const e = this.eye(Sentry.tmp);
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    if (Math.hypot(dx, dz) > TURRET_RANGE) return false;
    let dy = Math.atan2(-dx, -dz) - this.site.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    return Math.abs(dy) < this.site.half + SEE_YAW + 0.04;
  }

  muzzle(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.muzzles[i % 2].getWorldPosition(out);
  }

  /**
   * One frame. `sees`: is Ravi in the beam with a clear line to him; `aim`
   * his eye. Returns 'lock' the moment it locks, 'shot' for every round.
   */
  update(dt: number, sees: boolean, aim: THREE.Vector3): 'lock' | 'shot' | null {
    this.t += dt;
    this.recoil = Math.max(0, this.recoil - dt * 10);
    let out: 'lock' | 'shot' | null = null;
    const track = (rate: number): void => {
      const e = this.eye(Sentry.tmp);
      const want = Math.atan2(-(aim.x - e.x), -(aim.z - e.z));
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
      const wp = Math.atan2(aim.y - e.y, Math.hypot(aim.x - e.x, aim.z - e.z));
      this.pitch += THREE.MathUtils.clamp(wp - this.pitch, -rate * dt, rate * dt);
    };
    if (this.state === 'sweep') {
      this.ph += dt * this.site.rate;
      const want = this.site.yaw + Math.sin(this.ph) * this.site.half;
      this.yaw += THREE.MathUtils.clamp(want - this.yaw, -dt * 1.5, dt * 1.5);
      this.pitch += (this.site.pitch - this.pitch) * Math.min(1, dt * 2);
      if (sees) {
        this.state = 'lock';
        this.t = 0;
        out = 'lock';
      }
    } else if (this.state === 'lock') {
      track(2.4);
      if (this.t > 0.85) {
        this.state = 'fire';
        this.burst = 8;
        this.shotT = 0;
      }
    } else if (this.state === 'fire') {
      track(2.2);
      this.shotT -= dt;
      if (this.shotT <= 0 && this.burst > 0) {
        this.burst--;
        this.shotT = 0.085;
        this.recoil = 1;
        out = 'shot';
      }
      if (this.burst <= 0) {
        this.state = sees ? 'lock' : 'lost';
        this.t = sees ? 0.25 : 0;
        this.lostT = 0;
      }
    } else {
      // Lost him: holds where he was a moment, then back to sweeping
      this.lostT += dt;
      if (sees) {
        this.state = 'lock';
        this.t = 0.2;
      } else if (this.lostT > 1.4) {
        this.state = 'sweep';
        this.ph = Math.asin(THREE.MathUtils.clamp((this.yaw - this.site.yaw) / this.site.half, -1, 1));
      }
    }
    this.yawG.rotation.y = this.yaw;
    this.pitchG.rotation.x = this.pitch;
    this.pitchG.position.z = this.recoil * 0.05;
    const hot = this.state === 'lock' || this.state === 'fire';
    this.beamMat.uniforms.uCol.value.setRGB(hot ? 1 : 0.85, hot ? 0.18 : 0.92, hot ? 0.12 : 1);
    this.beamMat.uniforms.uK.value = hot ? 1.5 : 1;
    return out;
  }

  private static tmp = new THREE.Vector3();
}

// ================================================================ the plant

/**
 * Ravi's hands for the door, his own arms (the same rig as the grenade
 * throw): the right brings the grenade up and presses it flat to the door,
 * the left comes in and pulls the pin, the right lets go and both drop away.
 * The scene takes the grenade off the hand into the world when it's left.
 */
class PlantHands {
  readonly root = new THREE.Group();
  private handR = new THREE.Object3D();
  private handL = new THREE.Object3D();
  readonly nade: THREE.Group;
  private ring: THREE.Object3D;
  private arms: FirstPersonArms;
  private static LOW = new THREE.Vector3(0.24, -0.55, -0.3);
  private static HELD = new THREE.Vector3(0.1, -0.18, -0.36);
  private static AWAY = new THREE.Vector3(0.3, -0.65, -0.2);
  private static REST_L = new THREE.Vector3(-0.3, -0.62, -0.22);
  private static RING_OFF = new THREE.Vector3();
  private static Q_HELD = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.1, 0.25));
  private static Q_PRESS = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.15, Math.PI - 0.25, 0.15, 'YXZ'));
  private static Q_AWAY = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0.3, 0.4));
  private tmp = new THREE.Vector3();

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.handR, this.handL);
    this.nade = grenadeModel();
    this.handR.add(this.nade);
    this.ring = this.nade.children[2];
    this.arms = new FirstPersonArms(this.root, camera).set('r', this.handR, GRENADE_HOLD).set('l', this.handL, GRENADE_PIN);
    this.root.visible = false;
  }

  /**
   * `t` seconds into the plant; `target` where the grenade goes on the door,
   * in camera space. Up (0–0.45 s), onto the door (to 0.8), the pin (0.85),
   * let go (1.25), away (from 1.35).
   */
  pose(t: number, target: THREE.Vector3): void {
    this.root.visible = t < 2.1;
    if (!this.root.visible) return;
    const up = smooth(t / 0.45);
    const press = smooth((t - 0.4) / 0.4);
    const back = smooth((t - 1.35) / 0.55);
    const h = this.handR;
    h.position.lerpVectors(PlantHands.LOW, PlantHands.HELD, up).lerp(target, press).lerp(PlantHands.AWAY, back);
    // Palm up holding it; then turned so the palm faces the door, fingers up, the grenade between
    h.quaternion.copy(PlantHands.Q_HELD).slerp(PlantHands.Q_PRESS, press).slerp(PlantHands.Q_AWAY, back);
    // The left in for the ring, a tug, gone again
    const lIn = smooth((t - 0.5) / 0.3) * (1 - smooth((t - 1.0) / 0.35));
    const tug = smooth((t - 0.82) / 0.1);
    // To the ring wherever it is now, pinching it, then pulled back and out
    this.root.updateMatrixWorld(true);
    this.root.worldToLocal(this.ring.getWorldPosition(this.tmp));
    this.tmp.add(PlantHands.RING_OFF.set(-0.03 - 0.12 * tug, 0.0 - 0.02 * tug, 0.05 + 0.08 * tug));
    this.handL.position.lerpVectors(PlantHands.REST_L, this.tmp, lIn);
    this.handL.rotation.set(0, 0, 0);
    this.handL.visible = lIn > 0.03;
    if (tug > 0.5 && this.ring.visible) this.ring.visible = false;
    this.arms.set('r', h, mixGrip(GRENADE_HOLD, GRENADE_OPEN, smooth((t - 1.2) / 0.12)));
    this.arms.update();
  }
}

// ================================================================ scene

export class Level13Scene extends CombatScene<Level13Data> {
  /** Everything he's carrying; and in his hand to start with, the karambit (slot 4). */
  private arsenal!: Arsenal;
  private knife!: KnifeTwirlViewmodel;
  private drink!: DrinkViewmodel;
  private hud!: FPSHUD;
  private phase: Phase = 'play';
  private phaseT = 0;
  private t = 0;
  private dead = false;
  private checkpoint = 0;
  private sentries: Sentry[] = [];
  private climbing: Ladder | null = null;
  private rungT = 0;
  private wadeT = 0;
  private wasInSludge = false;
  /** The flies: one Points cloud per swarm, and each fly's own wander. */
  private flies: { pts: THREE.Points; base: THREE.Vector3; seed: Float32Array }[] = [];
  private fliesSound: { setDistance(m: number): void; stop(): void } | null = null;
  private ambience: { mix(s: number, h: number): void; stop(): void } | null = null;
  private winch: { set(k: number): void; setDistance(m: number): void; stop(): void } | null = null;
  // ---- Droplets (sludge splashes)
  private drops!: THREE.Points;
  private dropVel: THREE.Vector3[] = [];
  private dropLife: number[] = [];
  private dropNext = 0;
  // ---- The lever and the platform it calls
  private leverPulled = false;
  private leverT = -1;
  private moverState: 'parked' | 'coming' | 'docked' | 'going' | 'arrived' = 'parked';
  private moverT = 0;
  private moverOnT = 0;
  private moverRails: Collider[] = [];
  private moverPrev = new THREE.Vector3();
  // ---- The door
  private hands!: PlantHands;
  private planted: THREE.Group | null = null;
  private beepT = 0;
  private slab: { vel: THREE.Vector3; spin: THREE.Vector3 } | null = null;
  private handedOff = false;
  private falling = false;
  private fallT = 0;
  private shake = 0;
  private flick: number[] = [];

  private ui!: HTMLElement;
  private banner!: HTMLElement;
  private fadeEl!: HTMLElement;
  private letterbox!: HTMLElement;
  private murk!: HTMLElement;
  private card!: HTMLElement;
  private skipEl!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private ray = new THREE.Ray();
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();
  private static tmpC = new THREE.Vector3();

  /** `from`: the checkpoint — 0 the tube and the sewer, 1 the hall, 2 the lever, 3 the last ladder. */
  constructor(ctx: GameContext, private from = 0) {
    super(ctx);
  }

  // ============================================================ lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x1e2a14);
    this.scene.fog = new THREE.FogExp2(0x1e2a14, 0.06);
    this.level = new Level13Builder().build();
    const L = this.level;
    this.scene.add(L.group);
    this.world = this.createPhysicsWorld(L.colliders);
    // What moves (the carts, the crates, the lift and its gates) stays out of the physics world
    L.colliders.push(...L.dyn);
    this.checkpoint = Math.min(this.from, L.checkpoints.length - 1);
    const start = L.checkpoints[this.checkpoint];
    this.player = new FPSPlayer(start.pos.clone(), start.yaw, input, audio, bus);
    this.player.camera.far = 600;
    this.player.camera.updateProjectionMatrix();
    this.scene.add(this.player.camera);
    this.ragdollOnDeath(() => (!this.arsenal.knifeActive && this.arsenal.held.stow < 0.5 ? this.arsenal.active : null));

    this.particles = new ParticleManager(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene, 4);
    this.decals = new BloodDecalSystem(this.scene);
    this.arsenal = new Arsenal(
      {
        player: this.player,
        audio,
        bus,
        world: this.world,
        particles: this.particles,
        castBullet: (o, d) => this.castBullet(o, d, null),
        addDebris: (m, b) => this.addDebris(m, b),
        dropMagazine: (p) => this.dropMagazine(p)
      },
      loadoutFor('hq'),
      'rifle'
    );
    this.arsenal.startWithKnife();
    this.knife = new KnifeTwirlViewmodel(this.player.camera);
    this.knife.onSlash = () => this.knifeSlash();
    this.knife.onCatch = () => audio.pocket();
    this.drink = new DrinkViewmodel(this.player.camera);
    this.drink.onEvent = (e, i) => {
      if (e === 'crack') audio.canCrack();
      else if (e === 'gulp') audio.gulp(i);
      else if (e === 'heal') this.player.healFull();
      else if (e === 'crush') audio.canCrush();
      else if (e === 'toss') this.dropCan(this.drink.tossPose());
    };
    this.hands = new PlantHands(this.player.camera);

    // Light: a cold wash from the roof over the hall, very little in the sewer but its lamps
    this.hemi = new THREE.HemisphereLight(0x9aa4ad, 0x1a1c1c, 0.5);
    this.sun = new THREE.DirectionalLight(0xc8d4e0, 0.6);
    this.sun.position.set(20, 140, 30);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.flick = L.lights.sewer.map(() => Math.random() * 10);

    // Turrets
    for (const site of L.turrets) {
      const s = new Sentry(site);
      this.scene.add(s.group);
      for (const m of s.meshes) L.shootables.push(m);
      this.sentries.push(s);
    }
    // The platform's end rails
    for (let i = 0; i < 2; i++) {
      const c: Collider = { box: new THREE.Box3() };
      L.colliders.push(c);
      this.moverRails.push(c);
    }
    if (this.checkpoint >= 3) this.callMover(true);
    if (this.checkpoint >= 5) this.releaseLadder(true);
    this.liftY = this.checkpoint === 5 ? L.lift.yTop : L.lift.yBottom;
    this.liftAt = this.checkpoint === 5 ? 'top' : 'bottom';
    this.updateRides(0);
    this.syncMover();
    this.buildFlies();
    this.buildRats();
    // A warm lamp over every ladder, so he can see where they go up
    for (const p of L.ladderTops) {
      const l = new THREE.PointLight(0xffc060, 9, 7, 1.6);
      l.position.copy(p);
      this.scene.add(l);
    }
    this.buildDrops();

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, 0, this.player.maxHealth);
    this.hud.setCounter(null);
    this.hud.setGrenades(1);
    this.arsenal.grenades = 1;
    this.buildUI();

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }),
      bus.on(Events.PlayerDied, () => {
        this.dead = true;
      })
    );
    document.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);
    this.ambience = audio.undergroundLoop();
    this.fliesSound = audio.fliesLoop();
    this.winch = audio.winchLoop();

    if (this.from === 0) this.startTube();
    else this.startPlay();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('click', this.clickHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.ambience?.stop();
    this.fliesSound?.stop();
    this.winch?.stop();
    this.hud.destroy();
    hideInventory();
    this.flashPool.dispose();
    this.ui.remove();
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="l13-murk" style="position:absolute;inset:0;pointer-events:none;opacity:0;
        background:radial-gradient(ellipse at center, rgba(70,110,20,0.75) 0%, rgba(20,40,6,0.97) 100%)"></div>
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="intro-skip">[ ENTER ] SKIP</div>
      <div class="intro-fade" style="opacity:1"></div>
      <div class="hq-card" style="position:absolute;inset:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;
        opacity:0;transition:opacity 1.2s;pointer-events:none;color:#e8e6df;letter-spacing:8px">
        <div style="font-size:13px;opacity:.6;letter-spacing:6px;margin-bottom:18px">LEVEL 13 — THE UNDERWORKS</div>
        <div style="font-size:42px;font-weight:bold">COMPLETE</div>
      </div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.murk = el.querySelector('.l13-murk')!;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.banner = el.querySelector('.intro-objective')!;
    this.skipEl = el.querySelector('.intro-skip')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
    this.card = el.querySelector('.hq-card')!;
  }

  private setObjective(text: string): void {
    if (this.banner.textContent === text) return;
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    if (text) this.banner.classList.add('show');
  }

  private cinema(on: boolean): void {
    this.letterbox.classList.toggle('open', !on);
    if (on) this.hud.hide();
    else this.hud.show();
  }

  // ============================================================ the tube

  private startTube(): void {
    this.phase = 'tube';
    this.phaseT = 0;
    this.player.cinematic = true;
    this.cinema(true);
    this.fadeEl.style.transition = 'opacity 0.8s';
    this.fadeEl.style.opacity = '0';
    this.ctx.audio.slideWhoosh(4.3);
  }

  /** Down the tube, out of the outlet, into the sludge, up on his feet. */
  private updateTube(dt: number): void {
    const t = this.phaseT;
    const L = this.level;
    const cam = this.player.camera;
    const SLIDE = 4.2;
    if (t < SLIDE) {
      // Faster and faster: the tube's length eased in, and a roll as it bends
      const u = Math.min(0.995, Math.pow(t / SLIDE, 1.7));
      const p = L.tube.getPointAt(u);
      const ahead = L.tube.getPointAt(Math.min(1, u + 0.03));
      cam.position.copy(p).add(V(0, -0.35, 0));
      cam.up.set(Math.sin(t * 2.3) * 0.25, 1, Math.cos(t * 1.7) * 0.15).normalize();
      cam.lookAt(ahead.clone().add(V(0, -0.5, 0)));
      cam.up.set(0, 1, 0);
      this.shake = 0.25 + 0.3 * u;
      return;
    }
    // Out of the outlet and down: a short arc, then in
    const k = t - SLIDE;
    const o = L.outlet;
    const x = o.x + 0.6 + 3.2 * k;
    const y = o.y - 0.1 + 1.2 * k - 9 * k * k;
    const eyeY = Math.max(SLUDGE_Y - 0.35, y);
    if (y <= SLUDGE_Y && !this.wasInSludge) {
      this.wasInSludge = true;
      this.ctx.audio.splash(true);
      this.splashAt(V(x, SLUDGE_Y, 0), 60, 4.2);
      this.shake = 0.8;
    }
    const under = this.wasInSludge ? smooth((k - 0.55) / 0.7) : 0;
    // Under, then up on his feet out of it
    const standEye = CH_Y + 1.63;
    cam.position.set(Math.min(x, -128.5), this.wasInSludge ? THREE.MathUtils.lerp(SLUDGE_Y - 0.35, standEye, under) : eyeY, 0);
    const look = V(cam.position.x + 3, cam.position.y - 1.2 + 1.2 * under, 0);
    cam.lookAt(look);
    this.murk.style.opacity = this.wasInSludge ? String(Math.max(0, 1 - under * 1.6)) : '0';
    if (k > 1.6) this.startPlay();
  }

  // ============================================================ play

  private startPlay(): void {
    const L = this.level;
    this.phase = 'play';
    this.phaseT = 0;
    this.player.cinematic = false;
    this.cinema(false);
    this.murk.style.opacity = '0';
    this.skipEl.classList.add('gone');
    this.fadeEl.style.transition = 'opacity 0.8s';
    this.fadeEl.style.opacity = '0';
    const s = L.checkpoints[this.checkpoint];
    this.player.position.copy(s.pos);
    this.player.yaw = s.yaw;
    this.player.pitch = 0;
    this.player.camera.fov = 74;
    this.player.camera.updateProjectionMatrix();
    this.setObjective(
      [
        'FIND A WAY UP OUT OF THE SEWERS',
        'CROSS THE WALKWAYS — STAY OUT OF THE TURRETS’ LIGHT',
        'PULL THE LEVER',
        'DROP ONTO A PASSING VAT CART — RIDE IT NORTH',
        'HOP THE CARGO CRATES ACROSS TO THE LIFT',
        'TAKE THE LIFT BACK DOWN — THE LADDER’S DOWN NOW',
        'GET THROUGH THE DOOR AT THE END'
      ][this.checkpoint] ?? ''
    );
    this.ctx.input.requestPointerLock();
  }

  private get playable(): boolean {
    return this.phase === 'play' && this.player.alive && !this.falling;
  }

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    this.t += dt;
    this.phaseT += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.t < this.timers[i].at) continue;
      const f = this.timers[i].fn;
      this.timers.splice(i, 1);
      f();
    }
    if (this.playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();
    const L = this.level;
    const p = this.player;

    if (this.phase === 'tube') this.updateTube(dt);

    // ---- The platform carries whoever's stood on it; so do the carts, the crates and the lift
    this.updateMover(dt);
    if (this.phase !== 'tube') this.updateRides(dt);

    // ---- Ladders: on one, he goes up it
    // ---- His hands: a can of Deadbull on G; nothing in them on a ladder or in a cutscene
    const free = this.playable && input.pointerLocked && !this.climbing;
    if (input.wasPressed('KeyG') && free && !this.arsenal.reloading && !this.knife.busy) this.drink.start();
    if (!p.alive || this.falling) this.drink.abort();
    const busy = !!this.climbing || this.phase !== 'play' || this.drink.engaged;
    this.arsenal.preUpdate(dt, input, { canSwitch: free && !this.knife.busy, busy });
    const aiming = !busy && input.rightHeld && input.pointerLocked && this.playable && !this.arsenal.reloading && !this.arsenal.switching;
    p.aiming = aiming;
    if (this.phase === 'play' || this.dead || this.falling) {
      if (this.climbing) this.climb(dt);
      else this.catchLadder();
      p.update(dt, L.colliders);
      if (this.climbing) this.holdOnLadder();
    }
    this.wade(dt);
    this.checkFall(dt);

    // ---- The knife (a click is a trick), or the guns (they do nothing to the turrets but spark)
    const a = this.arsenal;
    this.knife.stow = a.knifeActive ? a.knifeStow : 1;
    const canFire = this.playable && input.pointerLocked && !busy;
    if (a.knifeActive && a.knifeWanted && canFire && a.knifeStow < 0.15 && input.consumeClick() && this.knife.trick()) this.ctx.audio.punchSwish();
    this.knife.update(dt, p);
    a.updateViewmodels(dt, aiming);
    a.updateFire(dt, input, canFire, (r, m, re) => this.hud.setAmmo(r, m, re));
    this.hud.setAmmoShown(!a.knifeActive && !a.knifeWanted);
    this.drink.update(dt, p);
    if (this.phase === 'play') {
      const targetFov = 74 - a.zoomFov;
      if (Math.abs(p.camera.fov - targetFov) > 0.01) {
        p.camera.fov = targetFov;
        p.camera.updateProjectionMatrix();
      }
    }
    this.hud.setAiming(a.aimBlend > 0.5);

    // ---- The route
    this.updateSentries(dt);
    this.updateOfficeLever(dt);
    this.updateLever(dt);
    this.updateDoor(dt);
    this.updateSewerDoor(dt);
    this.updateCheckpoints();
    if (this.phase === 'plant') this.updatePlant(dt);

    // ---- The world
    this.updateAtmosphere(dt);
    this.updateFlies(dt);
    this.updateRats(dt);
    for (const [i, f] of L.floaters.entries()) {
      f.position.y = SLUDGE_Y + 0.012 + Math.sin(this.t * 1.3 + i) * 0.008;
      f.rotation.y += Math.sin(this.t * 0.2 + i) * dt * 0.05;
    }
    this.updateDrops(dt);
    this.pourT -= dt;
    if (this.pourT <= 0) {
      this.pourT = 0.12;
      for (const at of L.pours) if (at.distanceTo(p.position) < 18) this.splashAt(at, 2, 1.1);
    }
    for (const c of L.carts) {
      const len = c.to - c.from;
      c.u = (((c.u + (c.speed * dt) / len) % 1) + 1) % 1;
      const v = c.from + len * c.u;
      if (c.axis === 'x') c.obj.position.x = v;
      else c.obj.position.z = v;
    }
    this.hud.setHealth(p.health, p.regenProgress);
    this.updateDebris(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.world.step(1 / 60, dt, 3);
    this.applyShake(dt);
    input.endFrame();
  }

  // ------------------------------------------------------------ ladders

  /** At the foot of a ladder, facing it and pushing on: onto it. */
  private catchLadder(): void {
    const p = this.player;
    if (!this.playable || !this.ctx.input.isDown('KeyW')) return;
    for (const l of this.level.ladders) {
      if (l.disabled) continue;
      const d = Math.hypot(p.position.x - l.base.x, p.position.z - l.base.z);
      if (d > 0.75 || p.position.y < l.base.y - 0.3 || p.position.y > l.top - 0.5) continue;
      // Facing it, near enough
      let dy = p.yaw - l.face;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      if (Math.abs(dy) > 1.1) continue;
      this.climbing = l;
      this.rungT = 0;
      return;
    }
  }

  /** On the ladder: W up, S down, Space lets go. At the top he steps off onto the platform. */
  private climb(dt: number): void {
    const l = this.climbing!;
    const p = this.player;
    const input = this.ctx.input;
    const dir = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    // Cancel gravity, set the climb (FPSPlayer subtracts gravity·dt before it moves him)
    p.velocity.set(0, dir * CLIMB + 18 * dt, 0);
    if (dir !== 0) {
      this.rungT -= dt;
      if (this.rungT <= 0) {
        this.rungT = 0.32;
        this.ctx.audio.ladderRung();
      }
    }
    if (p.position.y >= l.top - 0.05) {
      // Up and over onto the deck
      p.position.copy(l.off);
      p.velocity.set(0, 0, 0);
      this.climbing = null;
      return;
    }
    if (input.wasPressed('Space') || (dir < 0 && p.grounded && p.position.y <= l.base.y + 0.05)) this.climbing = null;
  }

  /** Kept on the ladder's line whatever W did to him sideways. */
  private holdOnLadder(): void {
    const l = this.climbing;
    if (!l) return;
    const p = this.player;
    p.position.x = l.base.x;
    p.position.z = l.base.z;
    p.velocity.x = 0;
    p.velocity.z = 0;
  }

  // ------------------------------------------------------------ the sewer

  /** Wading: slow, sloshing, splashes round his legs. */
  private wade(dt: number): void {
    const p = this.player;
    const inIt = this.level.sludge.some((b) => b.containsPoint(HALL_TMP.set(p.position.x, p.position.y + 0.05, p.position.z)));
    if (inIt && this.phase === 'play') {
      const sp = Math.hypot(p.velocity.x, p.velocity.z);
      if (sp > WADE) {
        p.velocity.x *= WADE / sp;
        p.velocity.z *= WADE / sp;
      }
      this.wadeT -= dt;
      if (sp > 0.8 && this.wadeT <= 0) {
        this.wadeT = 0.5;
        this.ctx.audio.splash(false);
        this.splashAt(V(p.position.x, SLUDGE_Y, p.position.z), 8, 1.4);
      }
    }
  }

  // ------------------------------------------------------------ the maintenance room door

  private sewerDoorK = 0;
  private sewerDoorWant = false;

  /** Slides open as he comes up to it (from either side), shut again once he has gone. */
  private updateSewerDoor(dt: number): void {
    const d = this.level.sewerDoor;
    const p = this.player.position;
    const near = Math.hypot(p.x - d.at.x, p.z - d.at.z) < 2.8 && Math.abs(p.y - d.at.y) < 2.5;
    if (near !== this.sewerDoorWant) {
      this.sewerDoorWant = near;
      this.ctx.audio.elevatorDoors(0.75);
    }
    this.sewerDoorK = THREE.MathUtils.clamp(this.sewerDoorK + (near ? dt : -dt) / 0.75, 0, 1);
    d.slab.position.z = THREE.MathUtils.lerp(d.closedZ, d.openZ, smooth(this.sewerDoorK));
    d.collider.disabled = this.sewerDoorK > 0.55;
  }

  // ------------------------------------------------------------ rats

  private rats: { g: THREE.Group; tail: THREE.Object3D; run: number; u: number; dir: number; speed: number; pause: number; ph: number; alive: boolean; deadT: number; knock: THREE.Vector3 }[] = [];
  /** Invisible boxes a little bigger than each rat, for bullets to find. */
  private ratHits: THREE.Mesh[] = [];
  private squeakT = 0;

  /** A rat: grey-brown body, pointed head, pink ears and a long tail. */
  private buildRats(): void {
    const fur = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xc88a84, roughness: 0.7 });
    const eye = new THREE.MeshBasicMaterial({ color: 0x080808 });
    const runs = this.level.ratRuns;
    const hitGeo = new THREE.BoxGeometry(0.2, 0.17, 0.42);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    for (let i = 0; i < 11; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), fur);
      body.scale.set(0.9, 0.75, 1.6);
      body.position.y = 0.06;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 8), fur);
      head.rotation.x = -Math.PI / 2;
      head.position.set(0, 0.065, -0.15);
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.CircleGeometry(0.018, 8), pink);
        ear.position.set(s * 0.028, 0.1, -0.12);
        g.add(ear);
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 4), eye);
        e.position.set(s * 0.022, 0.08, -0.16);
        g.add(e);
      }
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.008, 0.2, 5), pink);
      tail.geometry.translate(0, -0.1, 0);
      tail.rotation.x = -Math.PI / 2 - 0.15;
      tail.position.set(0, 0.04, 0.1);
      g.add(body, head, tail);
      g.scale.setScalar(1.3);
      this.scene.add(g);
      const rat = { g, tail, run: i % runs.length, u: Math.random(), dir: Math.random() < 0.5 ? 1 : -1, speed: 1.4 + Math.random() * 1.4, pause: Math.random() * 2, ph: Math.random() * 10, alive: true, deadT: 0, knock: new THREE.Vector3() };
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.y = 0.07;
      hit.userData.rat = rat;
      g.add(hit);
      this.ratHits.push(hit);
      this.rats.push(rat);
    }
  }

  /** Scurrying along the ledges: a dash, a stop to sniff, on again or back; off fast if he comes near. */
  private updateRats(dt: number): void {
    const runs = this.level.ratRuns;
    const p = this.player.position;
    this.squeakT -= dt;
    for (const r of this.rats) {
      if (!r.alive) {
        // Knocked over by the round, sliding to a stop on its back
        r.deadT += dt;
        if (r.deadT < 0.6) {
          r.g.position.addScaledVector(r.knock, dt);
          r.knock.multiplyScalar(Math.max(0, 1 - dt * 6));
          r.g.rotation.z = Math.min(Math.PI, r.g.rotation.z + dt * 12);
        }
        r.tail.rotation.y = Math.sin(r.deadT * 30) * 0.3 * Math.max(0, 1 - r.deadT);
        continue;
      }
      const [a, b] = runs[r.run];
      const len = a.distanceTo(b);
      const at = Level13Scene.tmpA.lerpVectors(a, b, r.u);
      const near = Math.hypot(at.x - p.x, at.z - p.z) < 3 && Math.abs(at.y - p.y) < 1.5;
      if (near && this.squeakT <= 0 && Math.random() < dt * 2) {
        this.squeakT = 0.6;
        this.ctx.audio.ratSqueak(false, Math.hypot(at.x - p.x, at.z - p.z));
      }
      if (near) {
        // Away from him, fast
        const ahead = Level13Scene.tmpB.lerpVectors(a, b, THREE.MathUtils.clamp(r.u + 0.02 * r.dir, 0, 1));
        if (Math.hypot(ahead.x - p.x, ahead.z - p.z) < Math.hypot(at.x - p.x, at.z - p.z)) r.dir = -r.dir;
        r.pause = 0;
      }
      if (r.pause > 0 && !near) {
        r.pause -= dt;
      } else {
        r.u += (r.dir * r.speed * (near ? 2.2 : 1) * dt) / len;
        if (r.u > 1 || r.u < 0) {
          r.u = THREE.MathUtils.clamp(r.u, 0, 1);
          r.dir = -r.dir;
        }
        if (Math.random() < dt * 0.5) r.pause = 0.4 + Math.random() * 1.8;
        if (Math.random() < dt * 0.15) r.dir = -r.dir;
      }
      const moving = r.pause <= 0 || near;
      r.ph += dt * (moving ? 22 : 3);
      at.lerpVectors(a, b, r.u);
      r.g.position.set(at.x, at.y + (moving ? Math.abs(Math.sin(r.ph)) * 0.012 : 0), at.z);
      r.g.rotation.y = Math.atan2(-(b.x - a.x) * r.dir, -(b.z - a.z) * r.dir);
      r.tail.rotation.y = Math.sin(r.ph * 0.5) * 0.5;
    }
  }

  /** A round has hit a rat: down it goes, squealing; a dead one just jolts. */
  private shootRat(r: Level13Scene['rats'][number], point: THREE.Vector3, dir: THREE.Vector3): void {
    this.particles.bloodSpray(point, dir, false, SEW_Y);
    this.decals.place('blood', V(point.x + dir.x * 0.2, SEW_Y + 0.01, point.z + dir.z * 0.2), V(0, 1, 0), 0.3 + Math.random() * 0.15);
    this.ctx.bus.emit(Events.HitMarker, { lethal: r.alive });
    if (!r.alive) {
      r.knock.set(dir.x, 0, dir.z).multiplyScalar(0.6);
      r.deadT = 0.3;
      return;
    }
    r.alive = false;
    r.deadT = 0;
    r.knock.set(dir.x, 0, dir.z).normalize().multiplyScalar(2.2);
    this.ctx.audio.ratSqueak(true, point.distanceTo(this.player.position));
  }

  /** The slash landing: a rat in reach in front of him, low down, gets it. */
  private knifeSlash(): void {
    const p = this.player.position;
    const f = this.player.forwardDir();
    for (const r of this.rats) {
      if (!r.alive) continue;
      const at = r.g.position;
      const dx = at.x - p.x;
      const dz = at.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.7 || Math.abs(at.y - p.y) > 1.2) continue;
      if ((dx * f.x + dz * f.z) / Math.max(d, 1e-4) < 0.45) continue;
      this.shootRat(r, at.clone().setY(at.y + 0.08), V(dx, 0, dz).normalize());
      this.ctx.audio.knifeStab();
      return;
    }
  }

  /** The player's rounds find the rats first if one is nearer than whatever else is in the way. */
  protected castBullet(origin: THREE.Vector3, dir: THREE.Vector3, shooter: Enemy | null): THREE.Vector3 {
    if (shooter === null && origin.y < H1 - 2 && this.ratHits.length) {
      this.raycaster.set(origin, dir);
      this.raycaster.far = 60;
      const rh = this.raycaster.intersectObjects(this.ratHits, false)[0];
      if (rh) {
        const wh = this.raycaster.intersectObjects(this.level.shootables, false).find((h) => h.distance > 0.02);
        if (!wh || rh.distance < wh.distance) {
          this.shootRat(rh.object.userData.rat, rh.point, dir);
          return rh.point.clone();
        }
      }
    }
    return super.castBullet(origin, dir, shooter);
  }

  private buildFlies(): void {
    // Round, and small: square points read as black squares hanging in the air once he is close
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g2 = c.getContext('2d')!;
    const grad = g2.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 32, 32);
    const mat = new THREE.PointsMaterial({ color: 0x060606, size: 0.018, sizeAttenuation: true, map: new THREE.CanvasTexture(c), alphaTest: 0.5 });
    for (const base of this.level.flies) {
      const n = 60;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const seed = new Float32Array(n * 4);
      for (let i = 0; i < n * 4; i++) seed[i] = Math.random();
      const pts = new THREE.Points(g, mat);
      pts.frustumCulled = false;
      this.scene.add(pts);
      this.flies.push({ pts, base, seed });
    }
  }

  private updateFlies(_dt: number): void {
    const cam = this.player.camera.position;
    let near = Infinity;
    for (const f of this.flies) {
      const d = f.base.distanceTo(cam);
      near = Math.min(near, d);
      f.pts.visible = d < 30;
      if (!f.pts.visible) continue;
      const a = f.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const s = f.seed;
      const t = this.t;
      for (let i = 0; i < a.count; i++) {
        const k = i * 4;
        const r = 0.3 + s[k] * 1.3;
        const w = 1.5 + s[k + 1] * 4;
        a.setXYZ(
          i,
          f.base.x + Math.sin(t * w + s[k + 2] * 20) * r + Math.sin(t * 13 + i) * 0.05,
          f.base.y + Math.sin(t * w * 1.3 + s[k + 3] * 9) * 0.5 * r,
          f.base.z + Math.cos(t * w * 0.9 + s[k + 2] * 13) * r + Math.cos(t * 11 + i) * 0.05
        );
      }
      a.needsUpdate = true;
    }
    this.fliesSound?.setDistance(near);
  }

  // ------------------------------------------------------------ droplets

  private buildDrops(): void {
    const n = 240;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3).fill(-999), 3));
    this.drops = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x5f8a1c, size: 0.06, sizeAttenuation: true }));
    this.drops.frustumCulled = false;
    this.scene.add(this.drops);
    for (let i = 0; i < n; i++) {
      this.dropVel.push(new THREE.Vector3());
      this.dropLife.push(0);
    }
  }

  private splashAt(at: THREE.Vector3, n: number, power: number): void {
    const a = this.drops.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      const k = this.dropNext;
      this.dropNext = (this.dropNext + 1) % a.count;
      const ang = Math.random() * Math.PI * 2;
      const sp = Math.random() * power;
      a.setXYZ(k, at.x + Math.cos(ang) * 0.2, at.y + 0.05, at.z + Math.sin(ang) * 0.2);
      this.dropVel[k].set(Math.cos(ang) * sp * 0.6, power * (0.6 + Math.random() * 0.8), Math.sin(ang) * sp * 0.6);
      this.dropLife[k] = 1.5;
    }
    a.needsUpdate = true;
  }

  private updateDrops(dt: number): void {
    const a = this.drops.geometry.getAttribute('position') as THREE.BufferAttribute;
    let any = false;
    for (let i = 0; i < a.count; i++) {
      if (this.dropLife[i] <= 0) continue;
      any = true;
      this.dropLife[i] -= dt;
      const v = this.dropVel[i];
      v.y -= 14 * dt;
      const y = a.getY(i) + v.y * dt;
      if (y < SLUDGE_Y || this.dropLife[i] <= 0) {
        this.dropLife[i] = 0;
        a.setXYZ(i, 0, -999, 0);
        continue;
      }
      a.setXYZ(i, a.getX(i) + v.x * dt, y, a.getZ(i) + v.z * dt);
    }
    if (any) a.needsUpdate = true;
  }

  // ------------------------------------------------------------ turrets

  private updateSentries(dt: number): void {
    const p = this.player;
    const eye = p.eyePosition(Level13Scene.tmpA);
    const { audio } = this.ctx;
    for (const s of this.sentries) {
      const from = s.eye(Level13Scene.tmpB);
      const near = from.distanceTo(eye) < TURRET_RANGE + 5;
      const sees = near && p.alive && this.phase === 'play' && !this.falling && (s.state === 'sweep' ? s.inBeam(eye) : s.inZone(eye)) && this.clearLine(from, eye);
      const ev = s.update(dt, sees, eye);
      if (ev === 'lock') {
        audio.lockBeep();
        this.hud.setAlert(true);
        window.setTimeout(() => this.hud.setAlert(false), 900);
      } else if (ev === 'shot') this.sentryShot(s, sees);
    }
  }

  private sentryShot(s: Sentry, sees: boolean): void {
    const p = this.player;
    const { audio } = this.ctx;
    const from = s.muzzle(Math.random() < 0.5 ? 0 : 1, Level13Scene.tmpC).clone();
    audio.turretShot(from.distanceTo(p.camera.position));
    this.flashPool.flash(from, 12);
    const eye = p.eyePosition();
    this.particles.muzzleFlash(from, eye.clone().sub(from).normalize());
    if (sees && p.alive && Math.random() < 0.12) {
      this.particles.tracer(from, eye, 0xffc890);
      p.hit('A SENTRY TURRET', from);
      return;
    }
    const miss = eye.clone().add(V((Math.random() - 0.5) * 2.2, (Math.random() - 0.6) * 1.6, (Math.random() - 0.5) * 2.2));
    const dir = miss.sub(from).normalize();
    const end = this.castBullet(from, dir, null);
    this.particles.tracer(from, end, 0xffc890);
    if (end.distanceTo(p.position) < 4) audio.bulletWhiz();
  }

  /** Nothing solid between two points (thin rails don't count: they're seen through). */
  private clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dist = a.distanceTo(b);
    const dir = Level13Scene.tmpC.copy(b).sub(a).divideScalar(dist);
    this.ray.set(a, dir);
    const hit = HALL_TMP2;
    for (const c of this.level.colliders) {
      if (c.disabled) continue;
      const bx = c.box;
      // A rail: thin in plan, not head high
      if (Math.min(bx.max.x - bx.min.x, bx.max.z - bx.min.z) < 0.25 && bx.max.y - bx.min.y < 1.3) continue;
      if (bx.containsPoint(a) || bx.containsPoint(b)) continue;
      if (this.ray.intersectBox(bx, hit) && hit.distanceTo(a) < dist - 0.25) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ the lever and the platform

  private updateLever(dt: number): void {
    const L = this.level;
    const p = this.player;
    const near = this.playable && !this.leverPulled && p.position.distanceTo(L.lever.at) < 1.9;
    if (this.leverT >= 0) {
      this.leverT += dt;
      L.lever.pivot.rotation.z = THREE.MathUtils.lerp(0.7, -0.7, smooth(this.leverT / 0.35));
    }
    if (near && this.ctx.input.wasPressed('KeyE')) {
      this.leverPulled = true;
      this.leverT = 0;
      this.ctx.audio.leverThrow();
      this.later(0.6, () => this.callMover(false));
    }
    if (this.phase === 'play') this.hud.setPrompt(near ? '[ E ] PULL THE LEVER' : this.officePromptOn ? '[ E ] PUSH THE LADDER RELEASE UP' : this.doorPromptOn ? '[ E ] PLANT THE GRENADE ON THE DOOR' : null);
  }

  /** The lever's done: the platform starts over to him (`instant`: already crossed, a restart past it). */
  private callMover(instant: boolean): void {
    if (instant) {
      this.leverPulled = true;
      this.leverT = 1;
      this.moverState = 'arrived';
      return;
    }
    this.moverState = 'coming';
    this.moverT = 0;
    this.setObjective('THE PLATFORM’S COMING — RIDE IT ACROSS');
  }

  private updateMover(dt: number): void {
    const m = this.level.mover;
    const p = this.player;
    this.moverPrev.copy(m.group.position);
    const RUN = 6;
    if (this.moverState === 'coming' || this.moverState === 'going') {
      this.moverT += dt;
      const k = smooth(this.moverT / RUN);
      if (this.moverState === 'coming') m.group.position.lerpVectors(m.from, m.to, k);
      else m.group.position.lerpVectors(m.to, m.from, k);
      this.winch?.set(Math.sin(Math.PI * Math.min(1, this.moverT / RUN)) * 0.8 + 0.2);
      if (this.moverT >= RUN) {
        this.moverState = this.moverState === 'coming' ? 'docked' : 'arrived';
        this.moverOnT = 0;
        this.winch?.set(0);
        this.ctx.audio.leverThrow();
      }
    }
    if (this.moverState === 'docked') {
      // Once he's on it, a moment, and away
      if (this.onMover()) {
        this.moverOnT += dt;
        if (this.moverOnT > 0.9) {
          this.moverState = 'going';
          this.moverT = 0;
        }
      } else this.moverOnT = 0;
    }
    if (this.moverState === 'arrived' && m.group.position.distanceTo(m.from) > 0.01) m.group.position.copy(m.from);
    this.winch?.setDistance(m.group.position.distanceTo(p.camera.position));
    // The beacon blinks while it runs
    const b = m.group.getObjectByName('beacon') as THREE.Mesh | undefined;
    if (b) (b.material as THREE.MeshStandardMaterial).emissiveIntensity = this.moverState === 'coming' || this.moverState === 'going' ? (Math.sin(this.t * 10) > 0 ? 4 : 0.2) : 0.6;
    // Him with it
    const dx = m.group.position.x - this.moverPrev.x;
    const dz = m.group.position.z - this.moverPrev.z;
    if ((dx || dz) && this.onMover()) {
      p.position.x += dx;
      p.position.z += dz;
    }
    this.syncMover();
  }

  private onMover(): boolean {
    const m = this.level.mover;
    const p = this.player.position;
    const c = m.group.position;
    return Math.abs(p.x - c.x) < m.size.x / 2 + 0.2 && Math.abs(p.z - c.z) < m.size.z / 2 + 0.2 && Math.abs(p.y - c.y) < 0.2;
  }

  private syncMover(): void {
    const m = this.level.mover;
    const c = m.group.position;
    const hx = m.size.x / 2;
    const hz = m.size.z / 2;
    m.collider.box.set(V(c.x - hx, c.y - 0.35, c.z - hz), V(c.x + hx, c.y, c.z + hz));
    this.moverRails[0].box.set(V(c.x - hx, c.y, c.z - hz), V(c.x + hx, c.y + 1.12, c.z - hz + 0.1));
    this.moverRails[1].box.set(V(c.x - hx, c.y, c.z + hz - 0.1), V(c.x + hx, c.y + 1.12, c.z + hz));
  }

  // ------------------------------------------------------------ the carts, the crates, the lift

  private pourT = 0;
  private liftY = 0;
  private liftAt: 'bottom' | 'top' = 'bottom';
  private liftState: 'idle' | 'closing' | 'moving' | 'opening' = 'idle';
  private liftT = 0;
  private liftGate = 1;
  private liftArmed = true;
  private liftInT = 0;
  private liftCallT = 0;
  private liftArrived = false;
  /** The velocity of whatever he was last carried on, given to him when he leaves it. */
  private carry = new THREE.Vector3();
  private carrying = false;
  private static RIDE = 6;

  /**
   * Everything that moves and can be stood on: the vat carts down their
   * track, the crates along their monorails, the lift up and down its
   * shaft. Each is moved, its colliders with it; if he's stood on one he
   * goes with it (and keeps its speed when he jumps off); if one runs into
   * him it shoves him.
   */
  private updateRides(dt: number): void {
    const L = this.level;
    const p = this.player;
    const moves: { c: Col; d: THREE.Vector3 }[] = [];
    // The vat carts, north, round through the walls
    const vl = L.vatLine;
    const vlen = vl.z1 - vl.z0;
    for (const c of vl.carts) {
      const prev = c.z;
      c.z += vl.speed * dt;
      if (c.z < vl.z0) c.z += vlen;
      if (c.z > vl.z1) c.z -= vlen;
      c.group.position.z = c.z;
      c.deck.box.set(V(vl.x - 1.2, vl.y - 0.3, c.z - 3.5), V(vl.x + 1.2, vl.y, c.z + 3.5));
      c.vats.forEach((v, i) => v.box.set(V(vl.x - 0.85, vl.y, c.z + (i ? 2.35 : -2.35) - 0.85), V(vl.x + 0.85, vl.y + 2.45, c.z + (i ? 2.35 : -2.35) + 0.85)));
      if (Math.abs(c.z - prev) < 5) {
        const d = V(0, 0, c.z - prev);
        moves.push({ c: c.deck, d }, ...c.vats.map((v) => ({ c: v, d })));
      }
    }
    // The crates, each line its own way
    for (const b of L.cargo.boxes) {
      const l = L.cargo.lines[b.line];
      const len = l.x1 - l.x0;
      const prev = b.x;
      b.x += l.speed * dt;
      if (b.x < l.x0) b.x += len;
      if (b.x > l.x1) b.x -= len;
      b.group.position.x = b.x;
      b.collider.box.set(V(b.x - 1.0, l.top - 1.3, l.z - 1.0), V(b.x + 1.0, l.top, l.z + 1.0));
      if (Math.abs(b.x - prev) < 5) moves.push({ c: b.collider, d: V(b.x - prev, 0, 0) });
    }
    // The lift
    const lift = L.lift;
    const prevY = this.liftY;
    this.updateLift(dt);
    lift.car.position.y = this.liftY;
    lift.floor.box.set(V(lift.x0 + 0.03, this.liftY - 0.2, lift.z0 + 0.03), V(lift.x1 - 0.03, this.liftY, lift.z1 - 0.03));
    moves.push({ c: lift.floor, d: V(0, this.liftY - prevY, 0) });
    if (dt <= 0 || !p.alive || this.climbing) {
      this.carrying = false;
      return;
    }
    // Stood on one of them?
    const pos = p.position;
    const on = moves.find((m) => {
      const b = m.c.box;
      // His footprint on it at all (he stands on an edge as long as any of him is over it)
      return pos.x > b.min.x - 0.31 && pos.x < b.max.x + 0.31 && pos.z > b.min.z - 0.31 && pos.z < b.max.z + 0.31 && Math.abs(pos.y - b.max.y) < 0.18 + Math.abs(m.d.y);
    });
    if (on) {
      if (on.d.y) pos.y = on.c.box.max.y + 0.001;
      if (on.d.x || on.d.z) p.shove(on.d.x, on.d.z, L.colliders);
      this.carry.set(on.d.x / dt, 0, on.d.z / dt);
      this.carrying = true;
    } else if (this.carrying) {
      // Off it: he keeps going the way it was taking him
      this.carrying = false;
      p.velocity.x += this.carry.x;
      p.velocity.z += this.carry.z;
    }
    // Run into by one: shoved along with it
    const me = new THREE.Box3(V(pos.x - 0.33, pos.y + 0.05, pos.z - 0.33), V(pos.x + 0.33, pos.y + 1.7, pos.z + 0.33));
    for (const m of moves) {
      if (m === on || (!m.d.x && !m.d.z) || !me.intersectsBox(m.c.box)) continue;
      pos.x += m.d.x;
      pos.z += m.d.z;
    }
  }

  /** Is he in the car (well inside it, on its floor)? */
  private inLift(): boolean {
    const l = this.level.lift;
    const p = this.player.position;
    return p.x > l.x0 + 0.3 && p.x < l.x1 - 0.3 && p.z > l.z0 + 0.3 && p.z < l.z1 - 0.3 && Math.abs(p.y - this.liftY) < 0.35;
  }

  /**
   * The lift: stand in the car a moment and the gates fold shut, it goes to
   * the other floor and they open again. Get out and back in to go back.
   * Waiting at the gate of the floor it isn't at calls it.
   */
  private updateLift(dt: number): void {
    const l = this.level.lift;
    const p = this.player.position;
    const audio = this.ctx.audio;
    const inside = this.inLift() && this.player.alive;
    if (this.liftState === 'idle') {
      if (!inside) this.liftArmed = true;
      this.liftInT = inside && this.liftArmed ? this.liftInT + dt : 0;
      // Called from the other floor: he's waiting by the gate there
      const otherY = this.liftAt === 'bottom' ? l.yTop : l.yBottom;
      const waiting = Math.abs(p.y - otherY) < 0.4 && p.x > l.x0 - 1 && p.x < l.x1 + 1 && Math.abs(p.z - (l.z0 + l.z1) / 2) < 4.5;
      this.liftCallT = waiting ? this.liftCallT + dt : 0;
      if (this.liftInT > 0.8 || this.liftCallT > 0.8) {
        this.liftState = 'closing';
        this.liftT = 0;
        audio.elevatorDoors(0.6);
      }
    } else if (this.liftState === 'closing') {
      this.liftGate = Math.max(0, this.liftGate - dt / 0.6);
      if (this.liftGate <= 0) {
        this.liftState = 'moving';
        this.liftT = 0;
        audio.elevatorRide(Level13Scene.RIDE);
      }
    } else if (this.liftState === 'moving') {
      this.liftT += dt;
      const k = smooth(this.liftT / Level13Scene.RIDE);
      this.liftY = this.liftAt === 'bottom' ? THREE.MathUtils.lerp(l.yBottom, l.yTop, k) : THREE.MathUtils.lerp(l.yTop, l.yBottom, k);
      if (this.liftT >= Level13Scene.RIDE) {
        this.liftAt = this.liftAt === 'bottom' ? 'top' : 'bottom';
        this.liftY = this.liftAt === 'top' ? l.yTop : l.yBottom;
        this.liftState = 'opening';
        audio.elevatorDing();
        audio.elevatorDoors(0.6);
        if (this.liftAt === 'top' && !this.liftArrived && !this.ladderReleased) this.setObjective('FIND THE RELEASE FOR WALKWAY 7’S LADDER');
        if (this.liftAt === 'top') this.liftArrived = true;
        if (this.liftAt === 'bottom' && this.ladderReleased) this.setObjective('CLIMB THE LADDER TO WALKWAY 7');
      }
    } else {
      this.liftGate = Math.min(1, this.liftGate + dt / 0.6);
      if (this.liftGate >= 1) {
        this.liftState = 'idle';
        this.liftArmed = !inside;
        this.liftInT = 0;
        this.liftCallT = 0;
      }
    }
    for (const g of l.gates) {
      const open = g.level === this.liftAt && this.liftState !== 'moving' ? smooth(this.liftGate) : 0;
      g.pivot.scale.x = 1 - 0.9 * open;
      g.collider.disabled = open > 0.5;
    }
  }

  // ------------------------------------------------------------ the office lever, the drop ladder

  private officePromptOn = false;
  private ladderReleased = false;
  private officeLeverT = -1;
  private ladderDrop = -1;

  private updateOfficeLever(dt: number): void {
    const L = this.level;
    const p = this.player;
    const lv = L.officeLever;
    this.officePromptOn = this.playable && !this.ladderReleased && Math.hypot(p.position.x - lv.at.x, p.position.z - lv.at.z) < 1.5 && Math.abs(p.position.y - lv.at.y) < 0.5;
    if (this.officePromptOn && this.ctx.input.wasPressed('KeyE')) {
      this.releaseLadder(false);
      this.ctx.audio.leverThrow();
    }
    if (this.officeLeverT >= 0 && this.officeLeverT < 1) {
      this.officeLeverT = Math.min(1, this.officeLeverT + dt / 0.35);
      lv.pivot.rotation.z = THREE.MathUtils.lerp(Math.PI - 0.5, 0.45, smooth(this.officeLeverT));
    }
    // The ladder letting down, far below
    const dl = L.dropLadder;
    if (this.ladderDrop >= 0 && this.ladderDrop < 1) {
      this.ladderDrop = Math.min(1, this.ladderDrop + dt / 2.4);
      const k = this.ladderDrop * this.ladderDrop;
      dl.group.position.y = Y6 + dl.raise * (1 - k);
      if (this.ladderDrop >= 1) {
        dl.ladder.disabled = false;
        this.ctx.audio.ladderRung();
      }
    }
  }

  /** The release is pushed up: walkway 7's ladder comes down (`instant` on a restart past it). */
  private releaseLadder(instant: boolean): void {
    const L = this.level;
    this.ladderReleased = true;
    if (instant) {
      this.officeLeverT = 1;
      L.officeLever.pivot.rotation.z = 0.45;
      this.ladderDrop = 1;
      L.dropLadder.group.position.y = Y6;
      L.dropLadder.ladder.disabled = false;
      return;
    }
    this.officeLeverT = 0;
    this.ladderDrop = 0;
    if (this.checkpoint < 5) this.checkpoint = 5;
    this.setObjective('TAKE THE LIFT BACK DOWN — THE LADDER’S DOWN NOW');
  }

  // ------------------------------------------------------------ the door

  private doorPromptOn = false;

  private updateDoor(_dt: number): void {
    const L = this.level;
    const p = this.player;
    this.doorPromptOn = false;
    if (!this.playable || this.planted) return;
    const d = Math.hypot(p.position.x - L.door.front.x, p.position.z - L.door.front.z);
    if (d > 2.2 || Math.abs(p.position.y - L.door.front.y) > 0.5) return;
    // Facing it
    const f = p.forwardDir(Level13Scene.tmpA);
    if (f.x < 0.5) return;
    this.doorPromptOn = true;
    if (this.ctx.input.wasPressed('KeyE')) this.startPlant();
  }

  private startPlant(): void {
    this.phase = 'plant';
    this.phaseT = 0;
    this.player.cinematic = true;
    this.player.aiming = false;
    this.hud.setPrompt(null);
    this.hud.setGrenades(0);
    this.cinema(true);
    this.setObjective('');
    this.ctx.audio.grenadePin();
    this.hands.root.visible = true;
  }

  /** The plant: hands up to the door, pin, back off, beep beep beep, and it goes. */
  private updatePlant(dt: number): void {
    const t = this.phaseT;
    const L = this.level;
    const p = this.player;
    const cam = p.camera;
    const plant = L.door.plant;
    const stand = V(plant.x - 0.45, L.door.front.y, plant.z - 0.12);
    const back = V(L.door.front.x - 4.5, L.door.front.y, L.door.front.z - 3.2);
    // Where he is: up to it, then backing away, crouching behind the crate's side
    const away = smooth((t - 1.6) / 1.1);
    const at = stand.clone().lerp(back, away);
    const eyeH = 1.6 - 0.45 * away;
    cam.position.set(at.x, at.y + eyeH, at.z);
    const look = plant.clone().lerp(V(L.door.front.x + 1.6, L.door.front.y + 1.7, L.door.front.z), away);
    cam.lookAt(look);
    cam.fov = THREE.MathUtils.lerp(cam.fov, 62, Math.min(1, dt * 3));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.hands.pose(t, cam.worldToLocal(plant.clone().add(V(-0.05, 0, 0))));
    if (t >= 0.9 && t - dt < 0.9) this.ctx.audio.grenadePin();
    // Let go: the grenade stays on the door
    if (t >= 1.25 && !this.planted) {
      const g = this.hands.nade;
      g.updateWorldMatrix(true, false);
      const wq = new THREE.Quaternion();
      g.getWorldQuaternion(wq);
      const wp = g.getWorldPosition(new THREE.Vector3());
      g.removeFromParent();
      g.scale.setScalar(1.15);
      g.position.set(L.door.plant.x - 0.03, wp.y, wp.z);
      g.quaternion.copy(wq);
      this.scene.add(g);
      this.planted = g;
      this.beepT = 0;
    }
    if (this.planted && t < 3.9) {
      this.beepT -= dt;
      if (this.beepT <= 0) {
        const urgent = t > 3;
        this.beepT = urgent ? 0.14 : 0.4;
        this.ctx.audio.chargeBeep(urgent);
      }
    }
    if (t >= 3.9 && !this.slab) this.blowDoor();
    if (this.slab) {
      const s = L.door.slab;
      this.slab.vel.y -= 9.8 * dt;
      s.position.addScaledVector(this.slab.vel, dt);
      s.rotation.x += this.slab.spin.x * dt;
      s.rotation.y += this.slab.spin.y * dt;
      s.rotation.z += this.slab.spin.z * dt;
      if (Math.random() < 0.5) this.particles.fire(plant.clone().add(V(0.4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3)), 1.2, 1);
    }
    if (t > 5.4) this.fadeEl.style.transition = 'opacity 1s';
    if (t > 5.4) this.fadeEl.style.opacity = '1';
    if (t > 6.6) this.card.style.opacity = '1';
    if (t > 9 && !this.handedOff) {
      this.handedOff = true;
      this.phase = 'done';
      this.ctx.bus.emit(Events.Level13Complete);
    }
  }

  private blowDoor(): void {
    const L = this.level;
    const at = L.door.plant.clone();
    this.planted?.removeFromParent();
    this.particles.explosion(at, 4.5);
    this.particles.explosion(at.clone().add(V(1, 0.6, 0)), 3.5);
    this.particles.sparks(at, V(-1, 0.4, 0), 60);
    this.particles.dust(at.clone().setY(L.door.front.y + 0.1), 4, 1.5);
    this.ctx.audio.explosion(6);
    this.flashPool.flash(at, 40);
    this.shake = 1.4;
    L.door.collider.disabled = true;
    // Blown off its hinges, in through the opening and away
    this.slab = { vel: V(13, 4.5, (Math.random() - 0.5) * 2), spin: V((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, -4) };
  }

  // ------------------------------------------------------------ checkpoints, falls

  private updateCheckpoints(): void {
    const p = this.player.position;
    if (!this.player.alive || this.phase !== 'play') return;
    let c = this.checkpoint;
    if (c < 1 && p.x > -61 && Math.abs(p.y - H1) < 0.3) c = 1;
    if (c < 2 && p.x > -2 && p.x < 6 && p.z > 30 && p.z < 38 && Math.abs(p.y - H2) < 0.3) c = 2;
    if (c < 3 && Math.abs(p.y - H3) < 0.3 && p.x > 25) c = 3;
    if (c < 4 && Math.abs(p.y - Y6) < 0.3 && p.x > 50 && p.x < 56 && p.z > 6 && p.z < 14) c = 4;
    if (c < 6 && Math.abs(p.y - H4) < 0.3 && p.x > 50 && p.z < -16) c = 6;
    if (c !== this.checkpoint) {
      this.checkpoint = c;
      if (c === 1) this.setObjective('CROSS THE WALKWAYS — STAY OUT OF THE TURRETS’ LIGHT');
      if (c === 2 && !this.leverPulled) this.setObjective('PULL THE LEVER');
      if (c === 3) this.setObjective('DROP ONTO A PASSING VAT CART — RIDE IT NORTH');
      if (c === 4) this.setObjective('HOP THE CARGO CRATES ACROSS TO THE LIFT');
      if (c === 6) this.setObjective('GET THROUGH THE DOOR AT THE END');
    }
  }

  /** Off the edge, into the abyss: down he goes, and that's it. */
  private checkFall(dt: number): void {
    const p = this.player;
    if (!p.alive || this.falling) {
      if (this.falling) {
        this.fallT += dt;
        if (this.fallT > 1.0 && p.alive) p.kill('THE DROP');
      }
      return;
    }
    if (p.position.x > HALL.x0 && p.position.y < FALL_Y) {
      this.falling = true;
      this.fallT = 0;
      this.climbing = null;
    }
  }

  // ------------------------------------------------------------ atmosphere

  private updateAtmosphere(dt: number): void {
    const L = this.level;
    const cam = this.player.camera.position;
    const inSewer = cam.x < HALL.x0 - 0.5 && cam.y < H1 - 1;
    const k = inSewer ? 0 : 1;
    // Fog and sky: the sewer's green murk, the hall's grey haze
    const fog = this.scene.fog as THREE.FogExp2;
    // Thick in the sewer; in the hall enough that the next turret along is a shape in the murk
    const inOffice = cam.y > OFFICE_Y - 0.5 && cam.y < OFFICE_Y + 4 && cam.x > 45 && cam.z < -11 && cam.z > -24;
    const want = inSewer ? 0.06 : inOffice ? 0.016 : 0.036;
    fog.density += (want - fog.density) * Math.min(1, dt * 2);
    const col = (this.scene.background as THREE.Color);
    col.lerp(inSewer ? SEWER_COL : HALL_COL, Math.min(1, dt * 2));
    fog.color.copy(col);
    this.hemi.intensity += ((inSewer ? 0.35 : 0.55) - this.hemi.intensity) * Math.min(1, dt * 2);
    this.sun.intensity += ((inSewer ? 0 : 0.7) - this.sun.intensity) * Math.min(1, dt * 2);
    for (const l of L.lights.hall) l.intensity = inSewer ? 0 : (l.userData.k ??= l.intensity);
    L.lights.sewer.forEach((l, i) => {
      l.userData.k ??= l.intensity;
      // Steady, the faintest hum; one lamp in four now and then stutters for a moment
      const ph = this.flick[i];
      const hum = 1 + 0.02 * Math.sin(this.t * 7 + ph);
      const bad = i % 4 === 0 && Math.sin(this.t * 0.23 + ph) > 0.985;
      const out = bad && Math.sin(this.t * 31 + ph * 3) < -0.2;
      l.intensity = inSewer ? (l.userData.k as number) * (out ? 0.35 : hum) : 0;
    });
    for (const m of L.sludgeMats) {
      m.uniforms.uTime.value = this.t;
      m.uniforms.fogColor.value.copy(fog.color);
      m.uniforms.fogDensity.value = fog.density;
    }
    for (const m of L.vatMats) {
      m.uniforms.uTime.value = this.t;
      m.uniforms.fogColor.value.copy(fog.color);
      m.uniforms.fogDensity.value = fog.density;
    }
    // The fog layers drift
    L.fogLayers.forEach((f, i) => {
      const map = (f.material as THREE.MeshBasicMaterial).map;
      if (map) map.offset.set(this.t * 0.004 * (i % 2 ? 1 : -1), this.t * 0.003);
    });
    this.ambience?.mix(1 - k, k * 0.9);
  }

  private applyShake(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (this.shake <= 0) return;
    const s = this.shake * this.shake * 0.025;
    const cam = this.player.camera;
    cam.rotation.x += (Math.random() - 0.5) * s;
    cam.rotation.y += (Math.random() - 0.5) * s;
  }

  // ------------------------------------------------------------ timers

  private timers: { at: number; fn: () => void }[] = [];
  /** Something to do a little later, on the scene's clock (it stops with the pause). */
  private later(sec: number, fn: () => void): void {
    this.timers.push({ at: this.t + sec, fn });
  }

  // ------------------------------------------------------------ CombatScene

  /** Nobody to kill in here. */
  protected killEnemy(_enemy: Enemy, _point: THREE.Vector3, _dir: THREE.Vector3, _byPlayer: boolean, _headshot: boolean): void {}

  // ------------------------------------------------------------ input

  private onClick(): void {
    if (this.dead) this.restart();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.dead) {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') this.restart();
      return;
    }
    if (e.code === 'Enter' && this.phase === 'tube') this.startPlay();
  }

  private restart(): void {
    this.ctx.bus.emit(Events.RestartLevel13, { checkpoint: this.checkpoint });
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}

const HALL_TMP = new THREE.Vector3();
const HALL_TMP2 = new THREE.Vector3();
const SEWER_COL = new THREE.Color(0x1e2a14);
const HALL_COL = new THREE.Color(0x3a3f42);
void H3;
