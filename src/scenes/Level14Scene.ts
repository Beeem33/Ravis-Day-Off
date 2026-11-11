import * as THREE from 'three';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level14Builder, type Level14Data, ROOM, HALL, STAND, CRATE } from '../environment/Level14Builder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { Debris } from '../fx/Debris';
import { FPSPlayer, type DeathHandler } from '../entities/FPSPlayer';
import { Arsenal, loadoutFor } from '../entities/Arsenal';
import { Enemy } from '../entities/Enemy';
import { GRIP_L, GRIP_R } from '../entities/ShotgunViewmodel';
import { launcherModel } from '../entities/LauncherViewmodel';
import { FirstPersonArms, RaviVisual, HAND, mixShape, type HandShape, type RaviRig, type Grip, type Side } from '../entities/RaviVisual';
import { FPSHUD } from '../ui/FPSHUD';
import { smooth, clamp01, yawPitchTo, wrapAngle } from './cutscene';

/**
 * Level14Scene — the laboratory.
 *
 *  1. In through the breach. A typed report on a desk: E to pick it up and
 *     read it, E to put it down.
 *  2. Past the open weapons crate: Ravi takes the quad-barrel out of it.
 *  3. Four scientists burst in with syringes and come at him one at a time.
 *     Every attack slows the world down and flashes a key: hit it inside two
 *     seconds and he blocks it and kills them with his hands; miss it and
 *     the syringe goes in, he swells up purple and bursts.
 *  4. A fifth kicks the door in behind him with a rocket launcher. Dodge it,
 *     and it blows the wall out instead; the lab starts to come down.
 *  5. Run the hallway as it caves in behind him, and jump into the portal.
 */

type Phase = 'enter' | 'play' | 'read' | 'pickup' | 'fight' | 'dying' | 'run' | 'portal' | 'dead' | 'done';
type FailKind = 'neck' | 'chest' | 'belly';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const QTE_TIME = 2;
const KEY_POOL = 'QRTYUIOPFGHJKLZXCVBNM';
/** The beats of the fight, in order. */
const BEATS = ['barge', 'stab', 'throw1', 'throw2', 'throw3', 'punch1', 'punch2', 'punch3', 'lull', 'rocket'] as const;
type BeatName = (typeof BEATS)[number];
/** Where the four of them stop once they're in, before they come at him. */
const MARKS = [V(-1.4, 0, 3.2), V(0.4, 0, 4.7), V(2.5, 0, 3.8), V(1.6, 0, 6.0)];
const DOOR_IN = V(-4, 0, 7.2);
/** Where his dive takes him: off the rocket's line, away from the crate. */
const DIVE_TO = V(-1.05, 0, 0.15);

// ================================================================ hands

/** A hand placed in camera space: wrist, back of the hand, palm, the way the forearm leaves, fingers. */
interface HP {
  w: THREE.Vector3;
  along: THREE.Vector3;
  palm: THREE.Vector3;
  toward: THREE.Vector3;
  shape: HandShape;
}
const hp = (w: [number, number, number], along: [number, number, number], palm: [number, number, number], toward: [number, number, number], shape: HandShape): HP => ({
  w: V(...w),
  along: V(...along).normalize(),
  palm: V(...palm).normalize(),
  toward: V(...toward).normalize(),
  shape
});
function mixHP(a: HP, b: HP, k: number): HP {
  return {
    w: a.w.clone().lerp(b.w, k),
    along: a.along.clone().lerp(b.along, k).normalize(),
    palm: a.palm.clone().lerp(b.palm, k).normalize(),
    toward: a.toward.clone().lerp(b.toward, k).normalize(),
    shape: mixShape(a.shape, b.shape, k)
  };
}
const FIST = HAND.fist;
const OPEN = HAND.open;
const GUARD_R = hp([0.16, -0.18, -0.37], [-0.1, 0.8, -0.6], [-1, 0, -0.2], [0.2, -0.7, 0.65], FIST);
const GUARD_L = hp([-0.15, -0.16, -0.41], [0.1, 0.8, -0.6], [1, 0, -0.2], [-0.2, -0.7, 0.65], FIST);
const LOW_R = hp([0.26, -0.5, -0.28], [0, -0.3, -1], [-1, 0, 0], [0.15, -0.5, 0.85], HAND.relaxed);
const LOW_L = hp([-0.26, -0.5, -0.3], [0, -0.3, -1], [1, 0, 0], [-0.15, -0.5, 0.85], HAND.relaxed);
/** Left forearm thrown up across over his eyes, taking the stab on it. */
const BLOCK_L = hp([0.09, 0.08, -0.37], [0.55, 0.6, -0.55], [0, 0.1, -1], [-0.95, -0.3, 0.1], FIST);
/** Swats: from out to the side, back of the hand leading across. */
const SWAT_R0 = hp([0.34, -0.02, -0.3], [-0.2, 0.6, -0.75], [-0.9, 0, -0.4], [0.3, -0.6, 0.7], OPEN);
const SWAT_R1 = hp([-0.2, 0.0, -0.44], [-0.85, 0.35, -0.4], [0.9, 0, 0.3], [0.75, -0.35, 0.55], OPEN);
const SWAT_L0 = hp([-0.34, -0.02, -0.3], [0.2, 0.6, -0.75], [0.9, 0, -0.4], [-0.3, -0.6, 0.7], OPEN);
const SWAT_L1 = hp([0.2, 0.0, -0.44], [0.85, 0.35, -0.4], [-0.9, 0, 0.3], [-0.75, -0.35, 0.55], OPEN);
/** The left forearm sweeping a punch out past his head. */
const PARRY_L0 = hp([-0.06, -0.06, -0.43], [0.15, 0.9, -0.4], [0.4, 0, -0.9], [-0.3, -0.7, 0.6], FIST);
const PARRY_L1 = hp([-0.38, 0.02, -0.36], [-0.25, 0.9, -0.3], [-0.8, 0, -0.6], [0.2, -0.75, 0.6], FIST);
/** The right hook: cocked, then landed. */
const HOOK_R0 = hp([0.32, -0.12, -0.24], [-0.3, 0.25, -0.9], [-0.3, -1, 0], [0.35, -0.4, 0.85], FIST);
const HOOK_R1 = hp([0.0, -0.03, -0.53], [-0.8, 0.1, -0.6], [0, -1, 0.1], [0.85, -0.25, 0.45], FIST);

/** Two of Ravi's arms in front of the camera, each on a hand placed in camera space. */
class MeleeArms {
  readonly root = new THREE.Group();
  private a: Record<Side, THREE.Object3D> = { l: new THREE.Object3D(), r: new THREE.Object3D() };
  private arms: FirstPersonArms;
  now: Record<Side, HP | null> = { l: null, r: null };

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.a.l, this.a.r);
    this.arms = new FirstPersonArms(this.root, camera);
  }

  set(side: Side, p: HP | null): void {
    this.now[side] = p;
    if (!p) {
      this.arms.set(side, null);
      return;
    }
    this.a[side].position.copy(p.w);
    const g: Grip = { wrist: new THREE.Vector3(), along: p.along, palm: p.palm, toward: p.toward, shape: p.shape };
    this.arms.set(side, this.a[side], g);
  }

  update(): void {
    this.arms.update();
  }
}

// ================================================================ props

/** A syringe along X: the needle out of its −X end, the plunger at +X. Purple stuff in it. */
function syringe(): THREE.Group {
  const g = new THREE.Group();
  g.scale.setScalar(1.45);
  const glass = new THREE.MeshStandardMaterial({ color: 0xdde8ee, roughness: 0.1, transparent: true, opacity: 0.4 });
  const serum = new THREE.MeshStandardMaterial({ color: 0x8a2cff, emissive: 0x9a40ff, emissiveIntensity: 1.4 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.25, metalness: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 });
  const along = (geo: THREE.BufferGeometry, m: THREE.Material, x: number): THREE.Mesh => {
    geo.rotateZ(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.x = x;
    g.add(mesh);
    return mesh;
  };
  along(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 12), glass, 0.0);
  along(new THREE.CylinderGeometry(0.0095, 0.0095, 0.07, 10), serum, -0.012);
  along(new THREE.CylinderGeometry(0.004, 0.006, 0.012, 8), white, -0.056);
  along(new THREE.CylinderGeometry(0.0012, 0.0012, 0.07, 6), steel, -0.097);
  along(new THREE.CylinderGeometry(0.003, 0.003, 0.07, 6), white, 0.075);
  along(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 12), white, 0.11);
  const flange = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.012, 0.045), white);
  flange.position.x = 0.05;
  g.add(flange);
  return g;
}

/** The scientist's coat skirt (open down the front) and its pockets, hung on his hips. */
function dressScientist(e: Enemy, _i: number): void {
  e.root.updateMatrixWorld(true);
  const hips = e.root.getObjectByName('Hips');
  const coat = new THREE.MeshStandardMaterial({ color: 0xeef0ec, roughness: 0.85, side: THREE.DoubleSide });
  if (hips) {
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.27, 0.62, 18, 1, true, Math.PI + 0.32, Math.PI * 2 - 0.64), coat);
    skirt.position.copy(e.root.localToWorld(V(0, 0.73, 0.01)));
    skirt.quaternion.copy(e.root.getWorldQuaternion(new THREE.Quaternion()));
    hips.attach(skirt);
    // Pockets with pens in them
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.01), coat);
    pocket.position.copy(e.root.localToWorld(V(0.16, 0.72, -0.22)));
    pocket.quaternion.copy(skirt.quaternion);
    hips.attach(pocket);
  }
}

// ================================================================ scene

interface Sci {
  e: Enemy;
  syr: THREE.Group;
  spare: THREE.Group | null;
  mark: THREE.Vector3;
}

interface QTE {
  code: string;
  t: number;
  state: 'live' | 'ok' | 'fail';
  hold: number;
  done: (ok: boolean) => void;
}

/** What the current beat of the fight is keeping track of. */
interface BeatState {
  tq?: number;
  result?: boolean;
  tr?: number;
  at?: THREE.Vector3;
  from?: THREE.Vector3;
  vel?: THREE.Vector3;
  tRel?: number;
  tc?: number;
  hit?: boolean;
  dead?: boolean;
  failed?: boolean;
  thrown?: boolean;
  fired?: boolean;
  blown?: boolean;
  kicked?: boolean;
  syrStart?: THREE.Vector3;
  arrived?: boolean;
}

export class Level14Scene extends CombatScene<Level14Data> {
  private arsenal!: Arsenal;
  private hud!: FPSHUD;
  private phase: Phase = 'enter';
  private phaseT = 0;
  private t = 0;
  private dead = false;
  private checkpoint = 0;
  private bits!: Debris;
  private shake = 0;
  // ---- Time
  private slow = 1;
  private slowWant = 1;
  private slowHold = 0;
  // ---- The report
  private paperRead = false;
  private paperArms!: FirstPersonArms;
  private paperHome = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private paperOut = false;
  // ---- The crate
  private pickArms!: FirstPersonArms;
  private pickRoot = new THREE.Group();
  private pickA: Record<Side, THREE.Object3D> = { l: new THREE.Object3D(), r: new THREE.Object3D() };
  private gunA: Record<Side, THREE.Object3D> = { l: new THREE.Object3D(), r: new THREE.Object3D() };
  private gunHome = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private swapped = false;
  // ---- The fight
  private melee!: MeleeArms;
  private scis: Sci[] = [];
  private enemies: Enemy[] = [];
  private beatI = 0;
  private bt = 0;
  private bs: BeatState = {};
  private qte: QTE | null = null;
  private look = new THREE.Vector3();
  private lookRate = 6;
  private gunner: Enemy | null = null;
  private launcher: ReturnType<typeof launcherModel> | null = null;
  private rocket: THREE.Group | null = null;
  private dive = 0;
  private diveRoll = 0;
  // ---- Dying
  private body: RaviRig | null = null;
  private bodyMats: THREE.MeshStandardMaterial[] = [];
  private failKind: FailKind = 'neck';
  private failBy: Enemy | null = null;
  private puffs: THREE.Sprite[] = [];
  private puffTex!: THREE.CanvasTexture;
  // ---- The run
  private runT = 0;
  private front = -100;
  private crumbleT = 0;
  private rumble: { set(k: number): void; stop(): void } | null = null;
  private klaxon: { set(k: number): void; stop(): void } | null = null;
  private portalHum: { setDistance(m: number): void; stop(): void } | null = null;
  private slab: THREE.Mesh | null = null;
  private slabV = 0;

  private ui!: HTMLElement;
  private banner!: HTMLElement;
  private fadeEl!: HTMLElement;
  private letterbox!: HTMLElement;
  private card!: HTMLElement;
  private qteEl!: HTMLElement;
  private qteKey!: HTMLElement;
  private qteRing!: SVGCircleElement;
  private tint!: HTMLElement;
  private hintEl!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();

  /** `from`: the checkpoint — 0 the way in, 1 the fight, 2 the run. */
  constructor(ctx: GameContext, private from = 0) {
    super(ctx);
  }

  // ============================================================ lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x070a09);
    this.scene.fog = new THREE.FogExp2(0x0a0e0d, 0.03);
    this.level = new Level14Builder().build();
    const L = this.level;
    this.scene.add(L.group);
    this.world = this.createPhysicsWorld(L.colliders);
    this.checkpoint = Math.min(2, Math.max(0, this.from));
    this.player = new FPSPlayer(L.start.pos.clone(), L.start.yaw, input, audio, bus);
    this.player.camera.far = 300;
    this.player.camera.updateProjectionMatrix();
    this.scene.add(this.player.camera);
    this.ragdollOnDeath(() => (this.arsenal.held.stow < 0.5 ? this.arsenal.active : null));

    this.particles = new ParticleManager(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene, 4);
    this.decals = new BloodDecalSystem(this.scene);
    this.bits = new Debris(this.particles, (x, z) => (z > HALL.pit && x > HALL.x0 && x < HALL.x1 ? -8 : 0));
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
      loadoutFor('level14'),
      'rifle'
    );
    const cam = this.player.camera;
    this.melee = new MeleeArms(cam);
    this.paperArms = new FirstPersonArms(this.melee.root, cam);
    cam.add(this.pickRoot);
    this.pickRoot.add(this.pickA.l, this.pickA.r);
    this.pickArms = new FirstPersonArms(this.pickRoot, cam);
    this.pickRoot.visible = false;

    // The grips on the gun in the crate, where the viewmodel's hands go
    this.gunA.r.position.set(0, -0.038, 0.228);
    this.gunA.r.rotation.x = 0.15;
    L.crate.gun.add(this.gunA.r);
    this.gunA.l.position.set(0, -0.008, 0.01);
    L.crate.gunPump.add(this.gunA.l);
    this.gunHome.p.copy(L.crate.gun.position);
    this.gunHome.q.copy(L.crate.gun.quaternion);
    this.paperHome.p.copy(L.paper.mesh.position);
    this.paperHome.q.copy(L.paper.mesh.quaternion);
    this.buildPaperHands();

    // Light: very little. The fittings, the tanks, the screens
    const hemi = new THREE.HemisphereLight(0x6f8288, 0x0c1010, 0.3);
    this.scene.add(hemi);
    this.puffTex = this.makePuffTex();

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, 0, this.player.maxHealth);
    this.hud.setCounter(null);
    this.hud.setAmmo(...this.arsenal.ammoReadout());
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

    // The scientists, waiting behind the double doors, and the last one behind the south door —
    // built now so their materials compile under the loading card, not mid-fight
    if (this.checkpoint < 2) {
      for (let i = 0; i < 4; i++) {
        const at = V(-4 + (i - 1.5) * 0.55, 0, 10.0 + i * 0.6);
        this.scis.push(this.makeScientist(i, at, 0, MARKS[i]));
      }
      this.makeGunner();
    }

    if (this.checkpoint === 0) this.startEnter();
    else if (this.checkpoint === 1) this.startFight();
    else this.startRunCheckpoint();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('click', this.clickHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.rumble?.stop();
    this.klaxon?.stop();
    this.portalHum?.stop();
    this.hud.destroy();
    this.flashPool.dispose();
    this.ui.remove();
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <style>
        .l14-qte { position:absolute; left:50%; top:66%; transform:translate(-50%,-50%); display:none; flex-direction:column; align-items:center; pointer-events:none; }
        .l14-qte .lbl { font: bold 14px monospace; letter-spacing: 6px; color: #fff; opacity: .85; margin-bottom: 10px; text-shadow: 0 0 8px #000; }
        .l14-qte .box { position:relative; width:120px; height:120px; }
        .l14-qte svg { position:absolute; inset:0; transform: rotate(-90deg); }
        .l14-qte .key { position:absolute; inset:16px; border-radius:16px; background: rgba(10,10,14,.82); border: 3px solid #fff;
          display:flex; align-items:center; justify-content:center; font: bold 54px Arial, sans-serif; color:#fff;
          animation: l14-flash .32s infinite alternate; box-shadow: 0 0 24px rgba(255,255,255,.5); }
        .l14-qte.ok .key { background: rgba(40,200,90,.9); border-color:#bfffcf; animation:none; }
        .l14-qte.fail .key { background: rgba(220,30,30,.9); border-color:#ffb0b0; animation:none; }
        @keyframes l14-flash { from { transform: scale(1); filter: brightness(1); } to { transform: scale(1.1); filter: brightness(1.6); border-color:#ffd24a; color:#ffd24a; } }
      </style>
      <div class="l14-tint" style="position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center, rgba(160,60,255,0.15) 0%, rgba(70,10,120,0.85) 100%)"></div>
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="l14-qte"><div class="lbl">PRESS</div><div class="box">
        <svg viewBox="0 0 120 120" width="120" height="120"><circle cx="60" cy="60" r="56" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="5"/>
        <circle class="ring" cx="60" cy="60" r="56" fill="none" stroke="#ffd24a" stroke-width="5" stroke-dasharray="351.9" stroke-dashoffset="0"/></svg>
        <div class="key">E</div></div></div>
      <div class="l14-hint" style="position:absolute;left:0;right:0;bottom:7%;text-align:center;font:bold 13px monospace;letter-spacing:4px;color:#fff;opacity:0;transition:opacity .3s;text-shadow:0 0 6px #000;pointer-events:none">[ E ] PUT IT DOWN</div>
      <div class="intro-fade" style="opacity:1"></div>
      <div class="hq-card" style="position:absolute;inset:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;
        opacity:0;transition:opacity 1.2s;pointer-events:none;color:#e8e6df;letter-spacing:8px">
        <div style="font-size:13px;opacity:.6;letter-spacing:6px;margin-bottom:18px">LEVEL 14 — THE LABORATORY</div>
        <div style="font-size:42px;font-weight:bold">TO BE CONTINUED</div>
      </div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.banner = el.querySelector('.intro-objective')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
    this.card = el.querySelector('.hq-card')!;
    this.qteEl = el.querySelector('.l14-qte')!;
    this.qteKey = el.querySelector('.l14-qte .key')!;
    this.qteRing = el.querySelector('.l14-qte .ring')! as SVGCircleElement;
    this.tint = el.querySelector('.l14-tint')!;
    this.hintEl = el.querySelector('.l14-hint')!;
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

  private fadeIn(sec = 1): void {
    this.fadeEl.style.transition = `opacity ${sec}s`;
    this.fadeEl.style.opacity = '0';
  }

  // ============================================================ 1. in, and the report

  private startEnter(): void {
    this.phase = 'enter';
    this.phaseT = 0;
    this.player.cinematic = false;
    this.cinema(false);
    this.fadeIn(1.4);
    // Smoke still coming through the hole behind him
    for (let i = 0; i < 4; i++) this.particles.smokeColumn(V(ROOM.x0 + 0.8, 0.2, (Math.random() - 0.5) * 1.6), 1.2, 1);
    this.later(1.2, () => this.setObjective('SEARCH THE LAB'));
    this.phase = 'play';
    this.ctx.input.requestPointerLock();
  }

  private paperPromptOn = false;

  private updateExplore(): void {
    const p = this.player;
    const L = this.level;
    this.paperPromptOn = false;
    if (this.phase !== 'play' || !p.alive) return;
    if (!this.paperRead) {
      const d = Math.hypot(p.position.x - L.paper.front.x, p.position.z - L.paper.front.z);
      const to = Level14Scene.tmpA.copy(L.paper.mesh.position).sub(p.camera.position).normalize();
      const f = p.camera.getWorldDirection(Level14Scene.tmpB);
      if (d < 1.6 && f.dot(to) > 0.75) {
        this.paperPromptOn = true;
        if (this.ctx.input.wasPressed('KeyE')) this.startRead();
      }
    } else if (Math.hypot(p.position.x - CRATE.x, p.position.z - CRATE.z) < 2.3) {
      this.startPickup();
    }
    this.hud.setPrompt(this.paperPromptOn ? '[E] EXAMINE THE REPORT' : null);
  }

  /** His hands on the report's bottom corners: fingers behind it, thumbs on the front. */
  private buildPaperHands(): void {
    const m = this.level.paper.mesh;
    const shape: HandShape = { fingers: [[25, 30, 15], [28, 32, 16], [30, 34, 17], [33, 36, 18]], thumb: [0.45, 0.25, 0.1] };
    const mk = (side: Side): THREE.Object3D => {
      const a = new THREE.Object3D();
      const s = side === 'l' ? -1 : 1;
      a.position.set(s * 0.105, -0.075, 0);
      m.add(a);
      const g: Grip = {
        wrist: V(s * 0.02, -0.07, -0.015),
        along: V(-s * 0.3, 1, 0).normalize(),
        palm: V(0, 0, 1),
        toward: V(s * 0.35, -0.6, 0.72).normalize(),
        shape
      };
      this.paperArms.set(side, a, g);
      return a;
    };
    mk('l');
    mk('r');
    this.paperArms.set('l', null);
    this.paperArms.set('r', null);
    this.paperAnchors = m.children.slice() as THREE.Object3D[];
  }

  private paperAnchors: THREE.Object3D[] = [];

  private startRead(): void {
    const p = this.player;
    this.setObjective('');
    this.phase = 'read';
    this.phaseT = 0;
    p.cinematic = true;
    p.aiming = false;
    this.paperOut = true;
    this.hud.setPrompt(null);
    this.ctx.audio.pocket();
    // Each side edge pinched: fingers flat up the back of it, the thumb across the front
    const shape: HandShape = { fingers: [[4, 6, 3], [4, 6, 3], [6, 8, 4], [8, 10, 5]], thumb: [0.5, 0.3, 0.15] };
    const [al, ar] = this.paperAnchors;
    this.paperArms.set('l', al, { wrist: V(-0.06, -0.035, -0.045), along: V(0.75, 0.65, 0).normalize(), palm: V(0, 0, 1), toward: V(-0.6, -0.5, 0.6).normalize(), shape });
    this.paperArms.set('r', ar, { wrist: V(0.06, -0.035, -0.045), along: V(-0.75, 0.65, 0).normalize(), palm: V(0, 0, 1), toward: V(0.6, -0.5, 0.6).normalize(), shape });
  }

  /** Up off the desk to in front of his face; E (or a click) puts it back. */
  private updateRead(dt: number): void {
    const p = this.player;
    const cam = p.camera;
    const m = this.level.paper.mesh;
    const t = this.phaseT;
    const out = this.paperOut;
    // Where it's held: just under his eyes, tipped back a touch
    cam.updateMatrixWorld(true);
    const held = new THREE.Matrix4().compose(V(0, -0.025, -0.33), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, 0, 0.02)), V(1, 1, 1)).premultiply(cam.matrixWorld);
    const hpos = new THREE.Vector3();
    const hq = new THREE.Quaternion();
    held.decompose(hpos, hq, new THREE.Vector3());
    const k = out ? smooth(t / 0.55) : 1 - smooth(t / 0.45);
    m.position.lerpVectors(this.paperHome.p, hpos, k);
    m.quaternion.slerpQuaternions(this.paperHome.q, hq, k);
    // Reading: the lens closes in a little
    cam.fov += ((out ? 60 : 74) - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
    this.hud.setPrompt(null);
    this.hintEl.style.opacity = out && t > 0.6 ? '1' : '0';
    if (out && t > 0.6 && (this.ctx.input.wasPressed('KeyE') || this.ctx.input.wasPressed('Space'))) {
      this.paperOut = false;
      this.phaseT = 0;
      this.ctx.audio.pocket();
    }
    if (!out && t > 0.45) {
      m.position.copy(this.paperHome.p);
      m.quaternion.copy(this.paperHome.q);
      this.paperArms.set('l', null);
      this.paperArms.set('r', null);
      this.paperRead = true;
      this.hintEl.style.opacity = '0';
      this.phase = 'play';
      this.phaseT = 0;
      p.cinematic = false;
      this.hud.setPrompt(null);
      cam.fov = 74;
      cam.updateProjectionMatrix();
      this.setObjective('KEEP SEARCHING');
    }
  }

  // ============================================================ 2. the crate

  private pickFrom = { p: new THREE.Vector3(), yaw: 0, pitch: 0 };

  private startPickup(): void {
    const p = this.player;
    this.phase = 'pickup';
    this.phaseT = 0;
    p.cinematic = true;
    p.aiming = false;
    this.hud.setPrompt(null);
    this.setObjective('');
    this.cinema(true);
    this.pickFrom.p.copy(p.position);
    this.pickFrom.yaw = p.yaw;
    this.pickFrom.pitch = p.pitch;
    this.pickRoot.visible = true;
    for (const v of this.arsenal.all) v.stow = 1;
    this.pickArms.set('r', this.pickA.r, GRIP_R).set('l', this.pickA.l, GRIP_L);
  }

  /** Blend an anchor under the camera from a camera-space spot to a world object's frame. */
  private blendAnchor(dst: THREE.Object3D, camPos: THREE.Vector3, to: THREE.Object3D, k: number): void {
    const cam = this.player.camera;
    const a = new THREE.Matrix4().compose(camPos, new THREE.Quaternion(), V(1, 1, 1)).premultiply(cam.matrixWorld);
    const ap = new THREE.Vector3();
    const aq = new THREE.Quaternion();
    a.decompose(ap, aq, new THREE.Vector3());
    to.updateWorldMatrix(true, false);
    const bp = new THREE.Vector3();
    const bq = new THREE.Quaternion();
    to.matrixWorld.decompose(bp, bq, new THREE.Vector3());
    const w = new THREE.Matrix4().compose(ap.lerp(bp, k), aq.slerp(bq, k), V(1, 1, 1));
    dst.matrix.copy(cam.matrixWorld).invert().multiply(w);
    dst.matrix.decompose(dst.position, dst.quaternion, dst.scale);
  }

  /** Down into the crate, both hands on it, up to his shoulder; the old gun's gone. */
  private updatePickup(dt: number): void {
    const p = this.player;
    const cam = p.camera;
    const L = this.level;
    const t = this.phaseT;
    // Over to the crate's side, looking down into it
    const go = smooth(t / 0.6);
    p.position.lerpVectors(this.pickFrom.p, STAND, go);
    const gunAt = this.gunHome.p;
    const eye = V(STAND.x, 1.62, STAND.z);
    const down = yawPitchTo(eye, gunAt);
    const rise = smooth((t - 0.95) / 0.8);
    p.yaw = this.pickFrom.yaw + wrapAngle(down.yaw - this.pickFrom.yaw) * go;
    const lookDown = Math.max(down.pitch, -0.95);
    p.pitch = THREE.MathUtils.lerp(this.pickFrom.pitch + (lookDown - this.pickFrom.pitch) * go, -0.05, rise);
    p.update(dt, L.colliders);
    // Bent over it: lower, leaning in
    const bend = go * (1 - rise);
    cam.position.y -= 0.36 * bend;
    const f = p.forwardDir(Level14Scene.tmpA);
    cam.position.addScaledVector(f, 0.22 * bend);
    cam.updateMatrixWorld(true);
    // Hands in, then the gun up with them
    const reach = smooth((t - 0.3) / 0.6);
    this.blendAnchor(this.pickA.r, V(0.26, -0.5, -0.22), this.gunA.r, reach);
    // The left joins it once it's up out of the foam
    this.blendAnchor(this.pickA.l, V(-0.3, -0.62, -0.18), this.gunA.l, smooth((t - 1.35) / 0.5));
    if (t >= 0.9 && t - dt < 0.9) this.ctx.audio.clink();
    if (!this.swapped) {
      // Up out of the foam to in front of him, turned to look it over; then down to where he holds it
      const lift = smooth((t - 1.0) / 0.8);
      const settle = smooth((t - 2.05) / 0.4);
      const pose = (pos: THREE.Vector3, e: THREE.Euler): [THREE.Vector3, THREE.Quaternion] => {
        const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(e), V(1, 1, 1)).premultiply(cam.matrixWorld);
        const pp = new THREE.Vector3();
        const qq = new THREE.Quaternion();
        m.decompose(pp, qq, new THREE.Vector3());
        return [pp, qq];
      };
      const [ap, aq] = pose(V(0.09, -0.13, -0.5), new THREE.Euler(0.08, -0.55, 0.3));
      const [bp, bq] = pose(V(0.2, -0.24, -0.46), new THREE.Euler(0, 0, 0));
      L.crate.gun.position.lerpVectors(this.gunHome.p, ap, lift).lerp(bp, settle);
      L.crate.gun.quaternion.slerpQuaternions(this.gunHome.q, aq, lift).slerp(bq, settle);
    }
    // In his hands for real: the quad-barrel is the shotgun now, and he racks it
    if (t >= 2.47 && !this.swapped) {
      this.swapped = true;
      L.crate.gun.visible = false;
      this.pickRoot.visible = false;
      this.giveQuad();
      this.arsenal.shotgun.rack();
      this.ctx.audio.itemGet();
    }
    if (t > 3.3) this.startFight();
  }

  private giveQuad(): void {
    this.arsenal.shotgun.useQuad();
    this.arsenal.give('shotgun');
    this.arsenal.equip('shotgun', 0);
    this.arsenal.shells = 6;
    this.hud.setAmmo(...this.arsenal.ammoReadout());
  }

  // ============================================================ 3. the fight

  private startFight(): void {
    const p = this.player;
    const L = this.level;
    this.phase = 'fight';
    this.phaseT = 0;
    p.cinematic = true;
    p.aiming = false;
    this.cinema(true);
    this.setObjective('');
    this.hud.setPrompt(null);
    if (this.checkpoint < 1) this.checkpoint = 1;
    this.paperRead = true;
    if (!this.swapped) {
      // Straight in from a restart: gun already in hand, the crate empty
      this.swapped = true;
      L.crate.gun.visible = false;
      this.giveQuad();
      p.position.copy(STAND);
      p.yaw = 0;
      p.pitch = 0;
      this.fadeIn(0.8);
    }
    this.beatI = 0;
    this.bt = 0;
    this.bs = {};
    this.look.set(-1, 1.6, 6);
    this.lookRate = 4;
  }

  /** The last of them, with the launcher on his shoulder, out of sight behind the south door. */
  private makeGunner(): void {
    const e = new Enemy(V(-4, 0, ROOM.z0 - 1.5), 0, 540, { name: 'SCIENTIST', civilian: true });
    e.restyleCrew({ cap: false, shirt: 0xf1f1ec, glasses: true });
    e.hideWeapon();
    e.setSerious();
    this.scene.add(e.root);
    e.update(1 / 60);
    dressScientist(e, 3);
    const lm = launcherModel();
    e.root.add(lm.group);
    lm.group.position.set(0.17, 1.52, -0.12);
    this.launcher = lm;
    this.gunner = e;
    this.enemies.push(e);
    e.pose = { handR: this.bodyHand(e, V(-0.05, -0.18, -0.32)), handL: this.bodyHand(e, V(-0.3, -0.1, -0.6)), curl: 1 };
  }

  private makeScientist(i: number, at: THREE.Vector3, yaw: number, mark: THREE.Vector3): Sci {
    const e = new Enemy(at, yaw, 520 + i * 3, { name: 'SCIENTIST', civilian: true });
    e.restyleCrew({ cap: false, shirt: 0xf1f1ec, glasses: i % 2 === 0 });
    e.hideWeapon();
    e.setSerious();
    this.scene.add(e.root);
    e.update(1 / 60);
    dressScientist(e, i);
    for (const part of e.parts) this.level.shootables.push(part);
    this.enemies.push(e);
    const syr = syringe();
    e.holdProp(syr, 0.02);
    // His hand at his chest, the syringe held like a knife
    e.pose = { handR: this.bodyHand(e, V(0.22, -0.32, -0.32)), thumbR: V(0, 0.55, 0.85), palmR: V(-1, 0, 0), curl: 1 };
    return { e, syr, spare: null, mark: mark.clone() };
  }

  /** A point given relative to his right shoulder, in his body's frame. */
  private bodyHand(e: Enemy, rel: THREE.Vector3): THREE.Vector3 {
    return e.shoulderR(new THREE.Vector3()).add(rel);
  }

  /** A world point in his body's frame. */
  private toBody(e: Enemy, w: THREE.Vector3): THREE.Vector3 {
    e.root.updateMatrixWorld(true);
    return e.root.worldToLocal(w.clone());
  }

  /** In his reach: a body-frame target pulled back to what his arm can get to. */
  private reachable(e: Enemy, target: THREE.Vector3, max = 0.58): THREE.Vector3 {
    const s = e.shoulderR(new THREE.Vector3());
    const d = target.clone().sub(s);
    if (d.length() > max) d.setLength(max);
    return s.add(d);
  }

  private faceTo(e: Enemy, w: THREE.Vector3, dt: number, rate = 10): void {
    const want = Math.atan2(-(w.x - e.position.x), -(w.z - e.position.z));
    e.yaw += wrapAngle(want - e.yaw) * Math.min(1, dt * rate);
    e.root.rotation.y = e.yaw;
  }

  /** Run him at `to`; true once he's there. */
  private runTo(e: Enemy, to: THREE.Vector3, dt: number, speed = 4.4, stopAt = 0.15): boolean {
    const d = Level14Scene.tmpA.copy(to).sub(e.position).setY(0);
    const len = d.length();
    if (len <= stopAt + 0.01) {
      e.setRun(false);
      e.setWalk(0);
      return true;
    }
    e.setRun(true);
    e.setWalk(1);
    this.faceTo(e, to, dt, 12);
    e.position.addScaledVector(d.normalize(), Math.min(len - stopAt, speed * dt));
    return false;
  }

  private get eye(): THREE.Vector3 {
    return this.player.camera.position;
  }

  /** Ravi's own neck, chest and belly, for where things are aimed and stuck. */
  private raviPoint(kind: FailKind | 'face'): THREE.Vector3 {
    const f = this.player.forwardDir(new THREE.Vector3());
    const base = V(STAND.x, 0, STAND.z).addScaledVector(f, 0.08);
    return base.setY(kind === 'face' ? 1.6 : kind === 'neck' ? 1.45 : kind === 'chest' ? 1.28 : 1.02);
  }

  // ---- QTE

  private startQte(code: string, hold: number, done: (ok: boolean) => void): void {
    this.qte = { code, t: 0, state: 'live', hold, done };
    this.qteKey.textContent = code.replace('Key', '');
    this.qteEl.classList.remove('ok', 'fail');
    this.qteEl.style.display = 'flex';
    this.slowWant = 0.06;
    this.ctx.audio.uiBeep(true);
  }

  private resolveQte(ok: boolean): void {
    const q = this.qte;
    if (!q || q.state !== 'live') return;
    q.state = ok ? 'ok' : 'fail';
    this.qteEl.classList.add(ok ? 'ok' : 'fail');
    this.later(0.35, () => {
      if (this.qte === q) this.qteEl.style.display = 'none';
    });
    if (ok) {
      this.slowWant = 0.42;
      this.slowHold = 1.3;
      this.ctx.audio.uiBeep(false);
    } else {
      this.slowWant = 1;
    }
    q.done(ok);
  }

  private updateQte(dt: number): void {
    const q = this.qte;
    if (!q || q.state !== 'live') return;
    q.t += dt;
    this.qteRing.setAttribute('stroke-dashoffset', String(351.9 * Math.min(1, q.t / QTE_TIME)));
    if (q.t >= QTE_TIME) this.resolveQte(false);
  }

  private randomKey(): string {
    return 'Key' + KEY_POOL[Math.floor(Math.random() * KEY_POOL.length)];
  }

  /** Ask for a key at the beat's current time; the beat's own clock holds `hold` past it until it's answered. */
  private ask(code: string, hold = 0.12): void {
    const bs = this.bs;
    bs.tq = this.bt;
    this.startQte(code, this.bt + hold, (ok) => {
      bs.result = ok;
      bs.tr = this.bt;
    });
  }

  // ---- the beats

  private updateFight(dt: number, sdt: number): void {
    const p = this.player;
    const L = this.level;
    // The beat's clock: slowed with the world, held while a key's waited on
    if (this.qte?.state === 'live') this.bt = Math.min(this.bt + sdt, this.qte.hold);
    else this.bt += sdt;
    const name = BEATS[this.beatI];
    let done = false;
    if (name === 'barge') done = this.beatBarge(sdt);
    else if (name === 'stab') done = this.beatStab(sdt);
    else if (name.startsWith('throw')) done = this.beatThrow(Number(name.slice(5)), sdt);
    else if (name.startsWith('punch')) done = this.beatPunch(Number(name.slice(5)), sdt);
    else if (name === 'lull') done = this.beatLull(sdt);
    else if (name === 'rocket') done = this.beatRocket(sdt);
    if (this.phase !== 'fight') return;
    if (done) this.nextBeat();
    if (this.phase !== 'fight') return;
    // The ones waiting their turn: stood at their marks, facing him
    if (name !== 'barge') for (const s of this.scis) if (s.e.alive) this.faceTo(s.e, this.eye, sdt, 4);
    // His eyes on whoever's coming
    p.position.set(STAND.x, 0, STAND.z);
    const want = yawPitchTo(V(STAND.x, 1.62, STAND.z), this.look);
    p.yaw += wrapAngle(want.yaw - p.yaw) * Math.min(1, dt * this.lookRate);
    p.pitch += (want.pitch - p.pitch) * Math.min(1, dt * this.lookRate);
    p.update(dt, L.colliders);
    // The dive: off to the side and down on the floor, rolled over
    if (this.dive > 0) {
      const cam = p.camera;
      const side = DIVE_TO.clone().sub(STAND);
      cam.position.addScaledVector(side, this.dive);
      cam.position.y -= 1.15 * this.diveDrop;
      cam.rotateZ(this.diveRoll);
    }
  }

  private diveDrop = 0;

  private nextBeat(): void {
    this.beatI++;
    this.bt = 0;
    this.bs = {};
    this.qte = null;
    if (this.beatI >= BEATS.length) this.startRun();
  }

  private beatBarge(dt: number): boolean {
    const t = this.bt;
    const L = this.level;
    const bs = this.bs;
    // The doors flung open
    if (!bs.kicked && t > 0.35) {
      bs.kicked = true;
      this.ctx.audio.doorBreach();
      this.shake = 0.5;
      for (const r of L.lights.red) r.intensity = 6;
      this.klaxon = this.ctx.audio.klaxonLoop();
      this.klaxon.set(0.35);
    }
    const open = smooth((t - 0.35) / 0.25);
    L.sciDoor.leaves[0].rotation.y = -1.85 * open;
    L.sciDoor.leaves[1].rotation.y = Math.PI + 1.85 * open;
    if (open > 0.5) L.sciDoor.collider.disabled = true;
    // He turns round to the noise
    this.look.set(-3, 1.5, 7.5);
    this.lookRate = t < 0.35 ? 0.8 : 5;
    this.melee.set('r', mixHP(LOW_R, GUARD_R, smooth((t - 1.2) / 0.5)));
    this.melee.set('l', mixHP(LOW_L, GUARD_L, smooth((t - 1.2) / 0.5)));
    if (t > 0.6) this.arsenal.held.stow = Math.min(1, this.arsenal.held.stow + dt * 4);
    // In they come, one after another, round to their marks
    let all = true;
    this.scis.forEach((s, i) => {
      if (t < 0.45 + i * 0.22) {
        all = false;
        return;
      }
      const e = s.e;
      const via = DOOR_IN;
      if (e.position.z > via.z + 0.3 && !e.root.userData.past) {
        this.runTo(e, via, dt, 4.6, 0);
        all = false;
        return;
      }
      e.root.userData.past = true;
      if (!this.runTo(e, s.mark, dt, 4.6)) all = false;
      else this.faceTo(e, this.eye, dt, 6);
    });
    if (t > 0.7 && t - dt <= 0.7) this.ctx.audio.enemyShout(6);
    if (t > 1.6 && t - dt <= 1.6) this.ctx.audio.enemyShout(4);
    return all && t > 2.6;
  }

  /** The first: runs in, syringe up over his head, and down. E. */
  private beatStab(dt: number): boolean {
    const s = this.scis[0];
    const e = s.e;
    const bs = this.bs;
    const t = this.bt;
    this.look.copy(e.headWorld(Level14Scene.tmpB));
    this.lookRate = 7;
    const toRavi = V(STAND.x, 0, STAND.z);
    const stopAt = toRavi.clone().add(e.position.clone().sub(toRavi).setY(0).setLength(0.95));
    if (!bs.arrived) {
      if (this.runTo(e, stopAt, dt, 4.8, 0.05)) {
        bs.arrived = true;
        bs.tc = t;
        this.ctx.audio.enemyScream(0.8);
      }
      e.pose = { handR: this.bodyHand(e, V(0.15, -0.2, -0.35)), thumbR: V(0, 0.5, 0.85), palmR: V(-1, 0, 0), curl: 1 };
      return false;
    }
    this.faceTo(e, this.eye, dt, 10);
    const tc = bs.tc!;
    const up = smooth((t - tc) / 0.28);
    const raised = this.bodyHand(e, V(0.0, 0.43, 0.1));
    const chest = this.bodyHand(e, V(0.15, -0.2, -0.35));
    const neck = this.reachable(e, this.toBody(e, this.raviPoint('neck')));
    if (bs.tq === undefined && t - tc >= 0.3) this.ask('KeyE', 0.1);
    // Down: slowly while he's waiting on the key, then all the way if he misses
    let down = 0;
    if (bs.tq !== undefined) {
      const tq = bs.tq;
      if (bs.result === undefined) down = clamp01((t - tq) / 0.45);
      else if (bs.result) down = Math.min(clamp01((bs.tr! - tq) / 0.45) + 0.12, 0.35);
      else down = clamp01((bs.tr! - tq) / 0.45 + (t - bs.tr!) / 0.12);
    }
    let hand = chest.clone().lerp(raised, up).lerp(neck, down);
    e.pose = { handR: hand, thumbR: V(0, 0.5, 0.85), palmR: V(-1, 0, 0), curl: 1, lean: 0.12 * down };
    if (bs.result === false) {
      if (down >= 1 && !bs.failed) {
        bs.failed = true;
        this.fail('neck', e);
      }
      return false;
    }
    if (bs.result !== true) {
      this.melee.set('r', GUARD_R);
      this.melee.set('l', GUARD_L);
      return false;
    }
    // Blocked on his forearm, the wrist caught, the syringe turned round into his own face
    const k = t - bs.tr!;
    this.melee.set('l', mixHP(GUARD_L, BLOCK_L, smooth(k / 0.1)));
    const cam = this.player.camera;
    cam.updateMatrixWorld(true);
    const blockW = cam.localToWorld(V(0.02, 0.15, -0.42));
    const face = e.headWorld(new THREE.Vector3()).addScaledVector(e.forwardDir(new THREE.Vector3()), 0.1).add(V(0, -0.02, 0));
    const shove = smooth((k - 0.3) / 0.25);
    if (k > 0.08 && k - this.lastSdt <= 0.08) {
      this.ctx.audio.punchImpact(false);
      this.shake = 0.35;
    }
    const handW = blockW.clone().lerp(face.clone().add(V(0, -0.1, 0)).addScaledVector(e.forwardDir(new THREE.Vector3()), 0.12), shove);
    hand = this.toBody(e, handW);
    e.pose = { handR: hand, thumbR: V(0, 0.5, 0.85), palmR: V(-1, 0, 0), curl: 1, lean: 0.12 - 0.3 * shove };
    // His right hand on the man's wrist, both of them driving it home
    const grab = smooth((k - 0.12) / 0.15);
    const wristCam = cam.worldToLocal(handW.clone()).add(V(0.02, -0.06, 0.06));
    const grabHP: HP = { w: wristCam, along: V(-0.2, 1, -0.3).normalize(), palm: V(0, 0.1, -1).normalize(), toward: V(0.35, -0.6, 0.7).normalize(), shape: FIST };
    this.melee.set('r', mixHP(GUARD_R, grabHP, grab));
    if (shove > 0) {
      const l = this.melee.now.l!;
      this.melee.set('l', mixHP(l, { ...grabHP, w: wristCam.clone().add(V(-0.1, -0.02, 0.04)), palm: V(0.3, 0, -1).normalize(), toward: V(-0.4, -0.6, 0.7).normalize() }, shove));
    }
    // The syringe into his face
    if (shove > 0.15 && !bs.hit) {
      bs.hit = true;
      this.scene.attach(s.syr);
      bs.syrStart = s.syr.position.clone();
    }
    if (bs.hit && !bs.dead) {
      // Up into his face from under it, at a slant, so it reads stuck in him
      const dir = V(-0.45, 0.55, -0.7).normalize().applyQuaternion(cam.quaternion);
      const end = face.clone().addScaledVector(dir, -0.03);
      s.syr.position.lerpVectors(bs.syrStart!, end, shove);
      s.syr.quaternion.setFromUnitVectors(V(-1, 0, 0), dir);
    }
    if (shove >= 1 && !bs.dead) {
      bs.dead = true;
      this.ctx.audio.knifeStab();
      this.ctx.audio.enemyScream(1);
      this.particles.bloodSpray(face, this.eye.clone().sub(face).normalize(), false, 0);
      const head = e.root.getObjectByName('Head');
      if (head) head.attach(s.syr);
      const away = e.position.clone().sub(V(STAND.x, 0, STAND.z)).setY(0.25).normalize();
      e.pose = null;
      e.die(face, away, this.world, 'head', 1.6, { wound: false });
    }
    if (bs.dead) {
      const back = smooth((k - 0.75) / 0.4);
      this.melee.set('l', mixHP(this.melee.now.l!, GUARD_L, back));
      this.melee.set('r', mixHP(this.melee.now.r!, GUARD_R, back));
    }
    return bs.dead === true && k > 1.3;
  }

  private lastSdt = 0;

  /** One of the other three throws his syringe from where he stands. A key: swat it away. */
  private beatThrow(n: number, dt: number): boolean {
    const s = this.scis[n];
    const e = s.e;
    const bs = this.bs;
    const t = this.bt;
    this.faceTo(e, this.eye, dt, 10);
    if (!bs.thrown) this.look.copy(e.headWorld(Level14Scene.tmpB)).lerp(V(STAND.x, 1.5, STAND.z), 0.15);
    this.lookRate = 6;
    // Wind up, behind his head; then forward and let go
    const wind = smooth(t / 0.4);
    const fling = smooth((t - 0.45) / 0.14);
    const chest = this.bodyHand(e, V(0.15, -0.2, -0.35));
    const back = this.bodyHand(e, V(0.08, 0.32, 0.32));
    const fwd = this.bodyHand(e, V(-0.02, 0.05, -0.55));
    e.pose = { handR: chest.clone().lerp(back, wind).lerp(fwd, fling), thumbR: V(0, 0.2, 1), palmR: V(-1, 0, 0), curl: bs.thrown ? 0.2 : 1, lean: -0.15 * wind + 0.35 * fling };
    const right = n !== 2;
    if (!bs.thrown) {
      this.melee.set('r', GUARD_R);
      this.melee.set('l', GUARD_L);
    }
    if (!bs.thrown && t >= 0.52) {
      bs.thrown = true;
      bs.tRel = t;
      this.scene.attach(s.syr);
      bs.from = s.syr.position.clone();
      const aim = this.raviPoint('chest').add(V(0, 0.18, 0));
      bs.vel = aim.clone().sub(bs.from).normalize().multiplyScalar(8);
      this.ctx.audio.punchSwish();
      // A glow of the stuff in it, so it can be seen coming end-on
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, color: 0xb050ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      glow.scale.setScalar(0.16);
      s.syr.add(glow);
    }
    if (!bs.thrown) return false;
    if (bs.tq === undefined && t - bs.tRel! >= 0.08) this.ask(this.randomKey(), 0.08);
    // In flight, needle first
    const fl = t - bs.tRel!;
    const total = this.raviPoint('chest').distanceTo(bs.from!) / 8;
    if (!bs.hit && !bs.dead) {
      // On a hit, it stops a little short of him, where his hand meets it
      const stop = bs.result === true ? Math.max(0, total - 0.45 / 8) : total;
      const at = bs.from!.clone().addScaledVector(bs.vel!, Math.min(fl, stop));
      s.syr.position.copy(at);
      s.syr.quaternion.setFromUnitVectors(V(-1, 0, 0), bs.vel!.clone().normalize());
      this.look.lerp(at, 0.05);
      if (bs.result === false && fl >= total && !bs.failed) {
        bs.failed = true;
        this.fail('chest', e);
        return false;
      }
    }
    if (bs.result !== true) return false;
    // The swat: the hand comes across as it arrives, and it's knocked away
    const contact = bs.tRel! + Math.max(total - 0.45 / 8, bs.tr! - bs.tRel!);
    const sw = smooth((t - (contact - 0.12)) / 0.16);
    this.melee.set(right ? 'r' : 'l', mixHP(right ? SWAT_R0 : SWAT_L0, right ? SWAT_R1 : SWAT_L1, sw));
    if (t < contact - 0.12) this.melee.set(right ? 'r' : 'l', mixHP(right ? GUARD_R : GUARD_L, right ? SWAT_R0 : SWAT_L0, smooth((t - bs.tr!) / 0.1)));
    if (t >= contact && !bs.hit) {
      bs.hit = true;
      this.ctx.audio.clink();
      this.ctx.audio.punchSwish();
      const cam = this.player.camera;
      const side = V(right ? -1 : 1, 0, 0).applyQuaternion(cam.quaternion);
      this.bits.add({ obj: s.syr, vel: side.multiplyScalar(5).add(V(0, 2.2, 0)), spin: V(14, 6, 9), size: 0.03, onLand: () => this.ctx.audio.clink() });
      this.particles.sparks(s.syr.position.clone(), side.clone().normalize(), 6, 0);
    }
    if (bs.hit) {
      const back = smooth((t - contact - 0.3) / 0.35);
      if (back > 0) this.melee.set(right ? 'r' : 'l', mixHP(right ? SWAT_R1 : SWAT_L1, right ? GUARD_R : GUARD_L, back));
    }
    return bs.hit === true && t > contact + 0.8;
  }

  /** The three left come in with their fists. A key: knock it past, and hit him. */
  private beatPunch(n: number, dt: number): boolean {
    const s = this.scis[n];
    const e = s.e;
    const bs = this.bs;
    const t = this.bt;
    this.look.copy(e.headWorld(Level14Scene.tmpB));
    this.lookRate = 7;
    const toRavi = V(STAND.x, 0, STAND.z);
    if (!bs.arrived) {
      const stopAt = toRavi.clone().add(e.position.clone().sub(toRavi).setY(0).setLength(0.9));
      e.pose = { handR: this.bodyHand(e, V(0.05, -0.25, -0.3)), curl: 1, handL: this.bodyHand(e, V(-0.5, -0.25, -0.3)) };
      if (this.runTo(e, stopAt, dt, 4.8, 0.05)) {
        bs.arrived = true;
        bs.tc = t;
        this.ctx.audio.effortGrunt(0.7);
      }
      this.melee.set('r', GUARD_R);
      this.melee.set('l', GUARD_L);
      return false;
    }
    this.faceTo(e, this.eye, dt, 10);
    const tc = bs.tc!;
    const cock = smooth((t - tc) / 0.25);
    const guard = this.bodyHand(e, V(0.05, -0.25, -0.3));
    const back = this.bodyHand(e, V(0.12, -0.08, 0.28));
    const face = this.reachable(e, this.toBody(e, this.raviPoint('face')), 0.6);
    if (bs.tq === undefined && t - tc >= 0.26) this.ask(this.randomKey(), 0.08);
    let swing = 0;
    if (bs.tq !== undefined) {
      if (bs.result === undefined) swing = clamp01((t - bs.tq) / 0.5);
      else if (bs.result) swing = Math.min(clamp01((bs.tr! - bs.tq) / 0.5) + 0.15, 0.45);
      else swing = 1;
    }
    let handR = guard.clone().lerp(back, cock * (1 - swing)).lerp(face, swing);
    const leanK = -0.1 * cock + 0.3 * swing;
    if (bs.result === false) {
      // The fist misses wide; the other hand comes out of his coat with a syringe
      if (!s.spare) {
        s.spare = syringe();
        e.holdProp(s.spare, 0.02, 'L');
        bs.tr = t;
      }
      const k = smooth((t - bs.tr!) / 0.22);
      const belly = this.reachable(e, this.toBody(e, this.raviPoint('belly')), 0.6).setX(-0.05);
      const handL = this.bodyHand(e, V(-0.45, -0.5, -0.1)).lerp(belly, k);
      e.pose = { handR, handL, thumbL: V(0, 0.2, -1), palmL: V(1, 0, 0), curl: 1, lean: leanK };
      if (k >= 1 && !bs.failed) {
        bs.failed = true;
        this.fail('belly', e);
      }
      return false;
    }
    if (bs.result !== true) {
      e.pose = { handR, curl: 1, lean: leanK };
      return false;
    }
    // Parried: the left forearm sweeps the fist out past his head
    const k = t - bs.tr!;
    const parry = smooth(k / 0.12);
    this.melee.set('l', mixHP(PARRY_L0, PARRY_L1, parry));
    const cam = this.player.camera;
    cam.updateMatrixWorld(true);
    const past = this.toBody(e, cam.localToWorld(V(-0.55, 0.05, -0.15)));
    handR = handR.lerp(this.reachable(e, past, 0.6), parry);
    if (k > 0.05 && k - this.lastSdt <= 0.05) this.ctx.audio.punchImpact(false);
    // Then the hook, into his jaw
    const hook = smooth((k - 0.16) / 0.16);
    this.melee.set('r', hook > 0 ? mixHP(HOOK_R0, HOOK_R1, hook) : mixHP(GUARD_R, HOOK_R0, smooth((k - 0.02) / 0.14)));
    if (!bs.dead) e.pose = { handR, curl: 1, lean: leanK + 0.15 * parry, twist: 0.4 * parry };
    if (hook >= 1 && !bs.dead) {
      bs.dead = true;
      const jaw = e.headWorld(new THREE.Vector3()).add(V(0, -0.08, 0));
      const right = V(1, 0, 0).applyQuaternion(cam.quaternion);
      const dir = right.multiplyScalar(-0.6).add(cam.getWorldDirection(new THREE.Vector3())).setY(0.35).normalize();
      this.ctx.audio.punchImpact(true);
      this.ctx.audio.knockoutHit(3);
      this.shake = 0.5;
      e.pose = null;
      e.die(jaw, dir, this.world, 'head', 2.6, { wound: false });
    }
    if (bs.dead) {
      const back2 = smooth((k - 0.55) / 0.4);
      this.melee.set('r', mixHP(HOOK_R1, GUARD_R, back2));
      this.melee.set('l', mixHP(PARRY_L1, GUARD_L, back2));
    }
    return bs.dead === true && k > 1.1;
  }

  /** It goes quiet. He looks round at them. */
  private beatLull(_dt: number): boolean {
    const t = this.bt;
    const lower = smooth(t / 0.6);
    this.melee.set('r', mixHP(GUARD_R, LOW_R, lower));
    this.melee.set('l', mixHP(GUARD_L, LOW_L, lower));
    const sweep = Math.sin(t * 1.2) * 0.5;
    this.look.set(STAND.x + Math.sin(sweep) * 4, 0.4, STAND.z + Math.cos(sweep) * 4);
    this.lookRate = 1.5;
    this.klaxon?.set(0.35 * (1 - lower));
    return t > 1.4;
  }

  /** The door behind him kicked in: the last of them, a launcher on his shoulder. A key: dive. */
  private beatRocket(dt: number): boolean {
    const t = this.bt;
    const bs = this.bs;
    const L = this.level;
    if (!bs.kicked) {
      bs.kicked = true;
      this.ctx.audio.doorBreach();
      this.ctx.audio.kickImpact();
      this.shake = 0.6;
      const e = this.gunner!;
      e.position.set(-4, 0, ROOM.z0 + 0.6);
      e.setFurious();
      this.faceTo(e, V(STAND.x, 0, STAND.z), 1, 1);
    }
    const e = this.gunner!;
    const lm = this.launcher!;
    // Leaf banged open
    L.rocketDoor.leaf.rotation.y = 1.95 * smooth(t / 0.12);
    if (t > 0.1) L.rocketDoor.collider.disabled = true;
    for (const r of L.lights.red) r.intensity = 4 + 3 * Math.sin(this.t * 8);
    // He whips round to it
    const head = e.headWorld(new THREE.Vector3());
    if (!bs.fired) {
      this.look.copy(head).add(V(0, -0.1, 0));
      this.lookRate = t < 0.15 ? 2 : 9;
    }
    // The launcher onto the line to his head
    const aimAt = V(STAND.x, 1.55, STAND.z);
    lm.group.updateWorldMatrix(true, false);
    const shoulder = lm.group.getWorldPosition(new THREE.Vector3());
    const muzzleLocalZ = lm.muzzle.position.z;
    lm.group.lookAt(muzzleLocalZ < 0 ? shoulder.clone().multiplyScalar(2).sub(aimAt) : aimAt);
    if (t > 0.5 && t - this.lastSdt <= 0.5) this.ctx.audio.enemyShout(9);
    if (!bs.fired && t >= 1.05) {
      bs.fired = true;
      bs.tRel = t;
      bs.from = lm.muzzle.getWorldPosition(new THREE.Vector3());
      // On the line through where his head is to the wall behind him
      bs.vel = aimAt.clone().sub(bs.from).normalize().multiplyScalar(11);
      this.rocket = this.makeRocket();
      this.scene.add(this.rocket);
      this.ctx.audio.rocketLaunch(9);
      this.particles.smokeColumn(bs.from.clone(), 0.6, 1);
      this.flashPool.flash(bs.from, 12);
    }
    if (!bs.fired) {
      this.melee.set('r', LOW_R);
      this.melee.set('l', LOW_L);
      return false;
    }
    if (bs.tq === undefined && t - bs.tRel! >= 0.05) this.ask(this.randomKey(), 0.07);
    const fl = t - bs.tRel!;
    if (!bs.blown && this.rocket) {
      const pos = bs.from!.clone().addScaledVector(bs.vel!, fl);
      this.rocket.position.copy(pos);
      this.rocket.quaternion.setFromUnitVectors(V(0, 0, -1), bs.vel!.clone().normalize());
      this.particles.rocketTrail(pos, bs.vel!.clone().normalize().negate(), 0.5);
      if (bs.result !== true) this.look.lerp(pos, 0.04);
      // Missed: straight into him
      if (bs.result === false && pos.distanceTo(this.eye) < 0.8 && !bs.failed) {
        bs.failed = true;
        this.rocketDeath(pos);
        return false;
      }
      // Dodged: on to the wall behind him
      if (pos.z >= ROOM.z1 - 0.3) {
        bs.blown = true;
        this.blowWall();
      }
    }
    if (bs.result !== true) return false;
    // The dive: away to his left, hit the floor, roll
    const k = t - bs.tr!;
    this.dive = smooth(k / 0.32);
    this.diveDrop = smooth(k / 0.38);
    this.diveRoll = 0.55 * Math.sin(Math.PI * clamp01(k / 0.7));
    this.melee.set('r', null);
    this.melee.set('l', null);
    if (k > 0.3 && k - this.lastSdt <= 0.3) {
      this.ctx.audio.bodyThud(1);
      this.shake = Math.max(this.shake, 0.4);
    }
    // Round to the blast (turned by angle, not by dragging the point past his own head)
    if (bs.blown) {
      this.look.copy(L.plug.at);
      this.lookRate = 3;
    }
    // Up again once it's gone off
    if (bs.blown && k > 1.4) {
      const up = smooth((k - 1.4) / 0.6);
      this.diveDrop = 1 - up;
      if (up >= 1) return true;
    }
    return false;
  }

  private makeRocket(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x4e5534, roughness: 0.6 }));
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -0.33;
    g.add(nose);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc060 }));
    flame.position.z = 0.29;
    flame.scale.set(1, 1, 2.2);
    g.add(flame);
    // A glow, not a light: a new light mid-fight would recompile every material
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, color: 0xffa040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    glow.scale.setScalar(0.7);
    glow.position.z = 0.35;
    g.add(glow);
    return g;
  }

  /** The rocket goes into the wall behind him: a hole through to a hallway, and the lab starts coming down. */
  private blowWall(): void {
    const L = this.level;
    const at = L.plug.at.clone();
    if (this.rocket) {
      this.rocket.removeFromParent();
      this.rocket = null;
    }
    L.plug.obj.visible = false;
    L.plug.collider.disabled = true;
    L.plug.edges.visible = true;
    this.particles.explosion(at, 4.2);
    this.particles.explosion(at.clone().add(V(0, 1, -0.8)), 3);
    this.particles.sparks(at, V(0, 0.3, -1), 70, 0);
    this.particles.dust(at.clone().setY(0.2), 4.5, 2);
    this.particles.smokeColumn(at.clone().setY(0.5), 1.4, 1.5);
    this.flashPool.flash(at, 50);
    const d = this.eye.distanceTo(at);
    this.ctx.audio.explosion(d);
    this.ctx.audio.wallCollapse();
    this.shake = Math.max(this.shake, 1.5);
    // Lumps of wall blown across the lab
    for (let i = 0; i < 18; i++) {
      const s = 0.12 + Math.random() * 0.3;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), new THREE.MeshStandardMaterial({ color: 0x8a948e, roughness: 0.95 }));
      m.position.copy(at).add(V((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2.5, -0.3));
      this.scene.add(m);
      this.bits.add({ obj: m, vel: V((Math.random() - 0.5) * 7, 2 + Math.random() * 4, -4 - Math.random() * 6), spin: V(Math.random() * 8, Math.random() * 8, Math.random() * 8), size: s });
    }
    // Whatever's on the far side starts shaking loose
    this.rumble = this.ctx.audio.rumbleLoop();
    this.rumble.set(0.8);
    this.klaxon?.set(0.5);
    this.crumbleT = 0.3;
    // A slab of ceiling comes down on the man with the launcher
    this.later(0.5, () => this.dropSlabOnGunner());
  }

  private dropSlabOnGunner(): void {
    const g = this.gunner;
    if (!g) return;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 1.8), new THREE.MeshStandardMaterial({ color: 0x4b514f, roughness: 0.9 }));
    slab.position.set(g.position.x, ROOM.h - 0.2, g.position.z + 0.2);
    slab.rotation.set(0.15, 0.3, -0.1);
    this.scene.add(slab);
    this.slab = slab;
    this.slabV = 0;
    this.ctx.audio.wallCollapse();
  }

  private updateSlab(dt: number): void {
    const s = this.slab;
    if (!s) return;
    this.slabV += 9.8 * dt;
    s.position.y -= this.slabV * dt;
    const g = this.gunner;
    if (g && g.alive && s.position.y < 2.0) {
      g.pose = null;
      g.die(g.headWorld(new THREE.Vector3()), V(0, -1, 0.2), this.world, 'head', 1.2, { wound: false });
      this.ctx.audio.enemyScream(0.6);
    }
    if (s.position.y <= 0.45) {
      s.position.y = 0.45;
      this.slab = null;
      this.particles.dust(s.position.clone().setY(0.1), 2.4, 1.6);
      this.ctx.audio.stomp(this.eye.distanceTo(s.position));
      this.shake = Math.max(this.shake, 0.6);
      this.launcher?.group.removeFromParent();
    }
  }

  // ============================================================ the deaths

  /** The syringe's in: the camera pulls out to see him, the spot swells and goes purple, and he bursts. */
  private fail(kind: FailKind, by: Enemy): void {
    this.phase = 'dying';
    this.phaseT = 0;
    this.failKind = kind;
    this.failBy = by;
    this.slowWant = 1;
    this.slow = 1;
    this.qteEl.style.display = 'none';
    this.melee.set('l', null);
    this.melee.set('r', null);
    for (const v of this.arsenal.all) v.stow = 1;
    this.ctx.audio.knifeStab();
    this.ctx.audio.fleshHit();
    this.klaxon?.set(0.15);
    // One syringe in him, not a second still in the air or in the hand
    const sci = this.scis.find((x) => x.e === by);
    if (sci) {
      sci.syr.visible = false;
      if (sci.spare) sci.spare.visible = false;
    }
    this.buildBody(kind, by);
    this.inflateSound = this.ctx.audio.inflate(1.6);
  }

  private inflateSound: { stop(): void } | null = null;

  private buildBody(kind: FailKind, by: Enemy): void {
    const rig = RaviVisual.rig('body');
    this.body = rig;
    this.scene.add(rig.root);
    rig.root.position.set(STAND.x, 0, STAND.z);
    const d = by.position.clone().sub(rig.root.position);
    rig.root.rotation.y = Math.atan2(d.x, d.z);
    // His own copy of his materials, to turn purple
    this.bodyMats = [];
    for (const m of rig.meshes) {
      const c = (m.material as THREE.MeshStandardMaterial).clone();
      m.material = c;
      this.bodyMats.push(c);
    }
    const restHip = (s: Side): THREE.Vector3 => RaviVisual.restBone(`thigh_${s}`).modelP.clone();
    const restFoot = (s: Side): THREE.Vector3 => RaviVisual.restBone(`foot_${s}`).modelP.clone();
    const hips = restHip('l').add(restHip('r')).multiplyScalar(0.5).add(V(0, -0.03, 0));
    // Hands clutching at the spot
    const spotY = kind === 'neck' ? 1.45 : kind === 'chest' ? 1.28 : 1.0;
    rig.seat({
      hips,
      lean: [4, 3, 3, 2, 6, -8],
      legs: {
        l: { ankle: restFoot('l').add(V(0.04, 0, 0.05)), knee: V(0.1, 0, 1) },
        r: { ankle: restFoot('r').add(V(-0.04, 0, -0.05)), knee: V(-0.1, 0, 1) }
      },
      arms: {
        l: { wrist: V(0.13, spotY - 0.06, 0.2), along: V(-0.5, 0.3, 0.4).normalize(), palm: V(-0.3, 0, -1).normalize(), elbow: V(1, -0.5, 0.3).normalize(), shape: HAND.open },
        r: { wrist: V(-0.16, spotY - 0.1, 0.24), along: V(0.5, 0.4, 0.3).normalize(), palm: V(0.3, 0, -1).normalize(), elbow: V(-1, -0.5, 0.3).normalize(), shape: HAND.open }
      }
    });
    rig.root.updateMatrixWorld(true);
    // The syringe, in him
    const bone = rig.bones.get(kind === 'neck' ? 'neck_01' : kind === 'chest' ? 'spine_03' : 'spine_01')!;
    const syr = syringe();
    const fwd = V(Math.sin(rig.root.rotation.y), 0, Math.cos(rig.root.rotation.y));
    const at = bone.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, kind === 'neck' ? 0.07 : 0.13).add(V(0.03, kind === 'belly' ? 0.04 : 0.06, 0));
    syr.position.copy(at).addScaledVector(fwd, 0.08);
    syr.quaternion.setFromUnitVectors(V(-1, 0, 0), fwd.clone().negate().add(V(0, -0.25, 0)).normalize());
    this.scene.add(syr);
    bone.attach(syr);
    this.bodySyr = syr;
    // The man who did it, stood there, his hand still out
    by.pose = { handR: this.reachable(by, this.toBody(by, at), 0.6), curl: 0.6 };
  }

  private bodySyr: THREE.Group | null = null;

  /** Which bones swell, and which of their children are shrunk back so only that part does. */
  private swell(kind: FailKind): { grow: string[]; keep: string[] } {
    if (kind === 'neck') return { grow: ['head'], keep: [] };
    if (kind === 'chest') return { grow: ['spine_03'], keep: ['neck_01', 'clavicle_l', 'clavicle_r'] };
    return { grow: ['spine_01'], keep: ['spine_02'] };
  }

  private updateDying(dt: number): void {
    const t = this.phaseT;
    const rig = this.body;
    const p = this.player;
    p.update(dt, this.level.colliders);
    if (!rig) return;
    // The camera out of his head, round to the side to see him
    const cam = p.camera;
    const yaw = rig.root.rotation.y;
    const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
    const side = V(fwd.z, 0, -fwd.x);
    const orbit = 0.4 + t * 0.12;
    const camAt = rig.root.position.clone().addScaledVector(fwd, 1.9 * Math.cos(orbit)).addScaledVector(side, 1.9 * Math.sin(orbit) + 0.6).add(V(0, 1.55, 0));
    const lookY = this.failKind === 'neck' ? 1.55 : this.failKind === 'chest' ? 1.3 : 1.1;
    cam.position.copy(camAt);
    cam.lookAt(rig.root.position.clone().add(V(0, lookY, 0)));
    cam.fov = 58;
    cam.updateProjectionMatrix();
    // Swelling, quicker and quicker, wobbling as it goes; purple spreading over him
    const k = clamp01(t / 1.5);
    const s = 1 + (this.failKind === 'neck' ? 2.3 : 1.6) * k * k + 0.08 * Math.sin(t * 40) * k;
    const { grow, keep } = this.swell(this.failKind);
    if (t < 1.65) {
      for (const n of grow) rig.bones.get(n)!.scale.setScalar(s);
      for (const n of keep) rig.bones.get(n)!.scale.setScalar(1 / s);
      const purple = new THREE.Color(0x7a2ad0);
      const glow = new THREE.Color(0x40106a);
      // His skin, not his clothes
      for (const m of this.bodyMats) {
        if (m.name !== 'SkinGame') continue;
        m.userData.c0 ??= m.color.clone();
        m.color.copy(m.userData.c0 as THREE.Color).lerp(purple, Math.min(1, k * 1.3));
        m.emissive.copy(glow).multiplyScalar(k * (0.6 + 0.4 * Math.sin(t * 18)));
      }
      this.tint.style.opacity = String(0.35 * k);
      this.shake = Math.max(this.shake, 0.15 * k);
      // Shaking on his feet
      rig.root.position.x = STAND.x + (Math.random() - 0.5) * 0.02 * k;
      rig.root.position.z = STAND.z + (Math.random() - 0.5) * 0.02 * k;
    }
    if (t >= 1.65 && rig.root.visible) this.burst();
    if (t > 2.0 && t - dt <= 2.0) {
      this.hud.show();
      this.letterbox.classList.add('open');
      this.tint.style.opacity = '0';
      const quiet: DeathHandler = { begin: () => true, update: () => {} };
      p.deathHandler = quiet;
      p.kill('THE SERUM');
    }
  }

  /** He bursts: purple mist, blood, bits of him everywhere. */
  private burst(): void {
    const rig = this.body!;
    rig.root.visible = false;
    this.inflateSound?.stop();
    const c = rig.root.position.clone().add(V(0, this.failKind === 'neck' ? 1.5 : this.failKind === 'chest' ? 1.3 : 1.05, 0));
    this.ctx.audio.explosion(3);
    this.ctx.audio.fleshHit();
    this.ctx.audio.squelchPop();
    this.shake = 1.1;
    for (let i = 0; i < 12; i++) {
      const d = V(Math.random() - 0.5, Math.random() * 0.8 - 0.1, Math.random() - 0.5).normalize();
      this.particles.bloodSpray(c, d, true, 0);
    }
    // Purple mist
    for (let i = 0; i < 22; i++) {
      const sm = new THREE.SpriteMaterial({ map: this.puffTex, color: new THREE.Color().setHSL(0.78, 0.8, 0.35 + Math.random() * 0.2), transparent: true, opacity: 0.8, depthWrite: false });
      const sp = new THREE.Sprite(sm);
      sp.position.copy(c);
      sp.scale.setScalar(0.3);
      sp.userData.v = V(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(3 + Math.random() * 3);
      sp.userData.life = 0;
      this.scene.add(sp);
      this.puffs.push(sp);
    }
    // Bits of him: purple flesh, his shirt, his trousers
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0x7a2ad0, roughness: 0.4, emissive: 0x30085a, emissiveIntensity: 0.6 }),
      new THREE.MeshStandardMaterial({ color: 0x9a1418, roughness: 0.35 }),
      new THREE.MeshStandardMaterial({ color: 0xa9c4e6, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.8 })
    ];
    for (let i = 0; i < 44; i++) {
      const s = 0.018 + Math.random() * 0.045;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), mats[i % 4]);
      m.position.copy(c).add(V((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3));
      m.scale.set(1, 0.6 + Math.random() * 0.8, 1);
      this.scene.add(m);
      const dir = V(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
      this.bits.add({ obj: m, vel: dir.multiplyScalar(3 + Math.random() * 6), spin: V(Math.random() * 12, Math.random() * 12, Math.random() * 12), size: s });
    }
    if (this.bodySyr) {
      this.scene.attach(this.bodySyr);
      this.bits.add({ obj: this.bodySyr, vel: V(Math.random() - 0.5, 4, Math.random() - 0.5), spin: V(10, 4, 7), size: 0.03 });
    }
    this.flashPool.flash(c, 10);
  }

  private updatePuffs(dt: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const sp = this.puffs[i];
      sp.userData.life += dt;
      const v = sp.userData.v as THREE.Vector3;
      sp.position.addScaledVector(v, dt);
      v.multiplyScalar(Math.max(0, 1 - dt * 2.5));
      const life = sp.userData.life as number;
      sp.scale.setScalar(0.3 + life * 1.1);
      (sp.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.6 * (1 - life / 1.8));
      if (life > 1.8) {
        sp.removeFromParent();
        this.puffs.splice(i, 1);
      }
    }
  }

  /** The rocket to the face. */
  private rocketDeath(at: THREE.Vector3): void {
    this.rocket?.removeFromParent();
    this.rocket = null;
    this.qteEl.style.display = 'none';
    this.particles.explosion(at, 3.5);
    this.flashPool.flash(at, 40);
    this.ctx.audio.explosion(1);
    this.shake = 1.5;
    this.slow = this.slowWant = 1;
    this.melee.set('l', null);
    this.melee.set('r', null);
    this.hud.show();
    this.letterbox.classList.add('open');
    this.phase = 'dead';
    this.player.kill('THE ROCKET', this.gunner?.position.clone().add(V(0, 1.5, 0)));
  }

  // ============================================================ 4. the run

  private startRun(): void {
    const p = this.player;
    this.phase = 'run';
    this.phaseT = 0;
    this.runT = 0;
    this.front = -100;
    this.checkpoint = 2;
    this.dive = 0;
    this.diveDrop = 0;
    this.diveRoll = 0;
    this.melee.set('l', null);
    this.melee.set('r', null);
    p.position.copy(DIVE_TO);
    const toward = yawPitchTo(V(DIVE_TO.x, 1.6, DIVE_TO.z), V(6, 1.4, ROOM.z1));
    p.yaw = toward.yaw;
    p.pitch = 0;
    p.cinematic = false;
    this.cinema(false);
    this.arsenal.equip('shotgun', 0.8);
    this.setObjective('RUN! — HOLD SHIFT — GET THROUGH THE HOLE');
    this.portalHum = this.ctx.audio.portalHum();
    this.ctx.input.requestPointerLock();
  }

  /** Straight in at the run: the fight done, the wall already gone. */
  private startRunCheckpoint(): void {
    const L = this.level;
    this.swapped = true;
    this.paperRead = true;
    L.crate.gun.visible = false;
    this.giveQuad();
    L.sciDoor.leaves[0].rotation.y = -1.85;
    L.sciDoor.leaves[1].rotation.y = Math.PI + 1.85;
    L.sciDoor.collider.disabled = true;
    L.rocketDoor.leaf.rotation.y = 1.95;
    L.rocketDoor.collider.disabled = true;
    L.plug.obj.visible = false;
    L.plug.collider.disabled = true;
    L.plug.edges.visible = true;
    // Them, where they fell
    const spots = [V(-1.0, 0, 2.4), V(1.6, 0, 1.3), V(-2.2, 0, -0.6), V(2.6, 0, 0.4), V(-4, 0, ROOM.z0 + 0.8)];
    spots.forEach((at, i) => {
      const e = new Enemy(at, Math.random() * 6, 520 + i * 3, { name: 'SCIENTIST', civilian: true });
      e.restyleCrew({ cap: false, shirt: 0xf1f1ec, glasses: i % 2 === 0 });
      e.hideWeapon();
      this.scene.add(e.root);
      e.update(1 / 60);
      dressScientist(e, i);
      this.enemies.push(e);
      e.die(e.headWorld(new THREE.Vector3()), V(Math.random() - 0.5, 0.2, Math.random() - 0.5).normalize(), this.world, 'head', 0.6, { wound: false });
    });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 1.8), new THREE.MeshStandardMaterial({ color: 0x4b514f, roughness: 0.9 }));
    slab.position.set(-4, 0.45, ROOM.z0 + 1.0);
    slab.rotation.set(0.15, 0.3, -0.1);
    this.scene.add(slab);
    for (const r of L.lights.red) r.intensity = 5;
    this.rumble = this.ctx.audio.rumbleLoop();
    this.rumble.set(0.8);
    this.klaxon = this.ctx.audio.klaxonLoop();
    this.klaxon.set(0.5);
    this.crumbleT = 0.3;
    this.fadeIn(0.8);
    this.startRun();
  }

  private updateRun(dt: number): void {
    const p = this.player;
    const L = this.level;
    this.runT += dt;
    const inHall = p.position.z > ROOM.z1 - 0.2 && p.position.x > HALL.x0 && p.position.x < HALL.x1;
    // The collapse, chasing him up the hallway
    const START = 2.8;
    const SPEED = 6.0;
    if (this.runT > START) this.front = HALL.z0 - 1 + (this.runT - START) * SPEED;
    for (const piece of L.hallPieces) {
      const ahead = piece.z - this.front;
      if (!piece.fallen && ahead < 1.2) this.dropPiece(piece);
      else if (!piece.fallen && ahead < 7 && piece.kind !== 'ceil') {
        // About to go: shuddering
        piece.obj.rotation.z = (piece.kind === 'wallL' ? -1 : 1) * (0.02 + Math.random() * 0.02) * (1 - ahead / 7);
      }
      if (piece.fallen) this.settlePiece(piece, dt);
    }
    // Bits coming down ahead of it
    if (this.front > HALL.z0 - 2 && Math.random() < dt * 6) {
      const z = this.front + 2 + Math.random() * 6;
      if (z < HALL.pit) this.dropChunk(V(HALL.x0 + 0.4 + Math.random() * 3.2, HALL.h - 0.2, z), 0.1 + Math.random() * 0.2);
    }
    // Caught
    if (p.alive && ((inHall && p.position.z < this.front + 0.3) || (!inHall && this.front > HALL.z0 + 3.5 && p.position.z < HALL.pit))) {
      this.collapseDeath();
      return;
    }
    // Into the portal
    if (p.alive && p.position.z > HALL.pit + 0.5 && inHall) this.startPortal();
    // The rumble and the shaking get worse the nearer it is
    const near = Math.max(0, 1 - Math.abs(p.position.z - this.front) / 14);
    this.shake = Math.max(this.shake, 0.18 + 0.5 * near);
    this.rumble?.set(0.6 + 0.6 * near);
  }

  /** A hall piece goes: walls fall in on their feet, the ceiling drops in a slab. */
  private dropPiece(piece: Level14Data['hallPieces'][number]): void {
    piece.fallen = true;
    piece.obj.userData.t = 0;
    piece.obj.userData.tilt = (Math.random() - 0.5) * 0.4;
    const { x0, x1 } = HALL;
    const z = piece.z;
    piece.collider.box.set(V(x0, 0, z - 1.25), V(x1, 2.2, z + 1.25));
    piece.collider.disabled = false;
    if (piece.kind === 'ceil') {
      this.particles.dust(V((x0 + x1) / 2, 0.3, z), 2.4, 1.4);
      if (Math.random() < 0.6) this.ctx.audio.wallCollapse();
    }
    for (const l of this.level.lights.hall) if (Math.abs(l.position.z - z) < 2) {
      l.intensity = 0;
      this.particles.electricSparks(l.position.clone(), 10);
    }
  }

  private settlePiece(piece: Level14Data['hallPieces'][number], dt: number): void {
    const o = piece.obj;
    const t = (o.userData.t = (o.userData.t as number) + dt);
    const k = Math.min(1, (t * t) / 0.3);
    if (piece.kind === 'wallL') o.rotation.z = -1.05 * k;
    else if (piece.kind === 'wallR') o.rotation.z = 1.05 * k;
    else {
      o.position.y = HALL.h - (HALL.h - 1.1) * k;
      o.rotation.x = (o.userData.tilt as number) * k;
      o.rotation.z = 0.25 * k * Math.sign(o.userData.tilt as number);
    }
  }

  /** A lump of ceiling, from `at`. */
  private dropChunk(at: THREE.Vector3, s: number): void {
    if (this.bits.pieces.length > 160) return;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), new THREE.MeshStandardMaterial({ color: 0x5e6461, roughness: 0.95 }));
    m.position.copy(at);
    this.scene.add(m);
    this.bits.add({
      obj: m,
      vel: V((Math.random() - 0.5) * 0.6, -1, (Math.random() - 0.5) * 0.6),
      spin: V(Math.random() * 5, Math.random() * 5, Math.random() * 5),
      size: s,
      onLand: (dp, sp) => {
        if (sp > 3 && s > 0.2) {
          this.particles.dust(dp.obj.position.clone(), 0.8, 0.6);
          if (Math.random() < 0.3) this.ctx.audio.stomp(this.eye.distanceTo(dp.obj.position) + 6);
        }
      }
    });
  }

  /** The lab coming down round him from the moment the wall goes. */
  private updateCrumble(dt: number): void {
    if (this.crumbleT <= 0) return;
    this.crumbleT -= dt;
    if (this.crumbleT > 0) return;
    this.crumbleT = 0.18 + Math.random() * 0.35;
    const big = Math.random() < 0.3;
    this.dropChunk(V(ROOM.x0 + 1 + Math.random() * 22, ROOM.h - 0.2, ROOM.z0 + 1 + Math.random() * 16), big ? 0.3 + Math.random() * 0.25 : 0.08 + Math.random() * 0.15);
    if (Math.random() < 0.25) this.particles.dust(V(ROOM.x0 + 1 + Math.random() * 22, ROOM.h - 0.3, ROOM.z0 + 1 + Math.random() * 16), 1.5, 0.5);
    // Now and then a light fitting tears out of the ceiling, sparking
    const L = this.level;
    if (Math.random() < 0.12) {
      const live = L.lights.lamps.filter((l) => !l.userData.dead && l.userData.fit);
      const l = live[Math.floor(Math.random() * live.length)];
      if (l) {
        const fit = l.userData.fit as THREE.Object3D;
        l.intensity = 0;
        l.userData.dead = true;
        this.particles.electricSparks(fit.position.clone(), 18);
        this.ctx.audio.electricCrackle(this.eye.distanceTo(fit.position));
        this.bits.add({ obj: fit, vel: V(0, -0.5, 0), spin: V(Math.random() * 3, 0, Math.random() * 3), size: 0.15, onLand: () => this.ctx.audio.glassShatter(this.eye.distanceTo(fit.position)) });
      }
    }
  }

  private collapseDeath(): void {
    const p = this.player;
    this.phase = 'dead';
    this.particles.dust(p.position.clone().add(V(0, 1, 0)), 2.5, 2);
    this.ctx.audio.wallCollapse();
    this.shake = 1.5;
    this.hud.show();
    p.kill('THE COLLAPSE', p.position.clone().add(V(0, 4, -1)));
  }

  // ============================================================ 5. the portal

  private startPortal(): void {
    const p = this.player;
    this.phase = 'portal';
    this.phaseT = 0;
    p.cinematic = true;
    this.cinema(true);
    this.setObjective('');
    this.ctx.audio.slideWhoosh(2.2);
    this.rumble?.set(0.2);
  }

  private updatePortal(dt: number): void {
    const t = this.phaseT;
    const p = this.player;
    const cam = p.camera;
    const c = this.level.portal.center;
    p.update(dt, this.level.colliders);
    // Pulled in: forward into the swirl, rolling, the lens stretching
    const from = this.portalFrom ?? (this.portalFrom = cam.position.clone());
    const k = smooth(t / 1.1);
    cam.position.lerpVectors(from, c.clone().add(V(0, 0, -0.35)), k);
    cam.lookAt(c.clone().add(V(0, 0, 3)));
    cam.rotateZ(t * t * 2.2);
    cam.fov = 74 + 22 * k;
    cam.updateProjectionMatrix();
    this.tint.style.opacity = String(Math.min(1, t * 0.9));
    if (t > 1.0) {
      this.fadeEl.style.transition = 'opacity 0.8s';
      this.fadeEl.style.opacity = '1';
    }
    if (t > 2.0) this.card.style.opacity = '1';
    if (t > 6.5 && this.phase === 'portal') {
      this.phase = 'done';
      this.ctx.bus.emit(Events.Level14Complete);
    }
  }

  private portalFrom: THREE.Vector3 | null = null;

  // ============================================================ the frame

  private get playable(): boolean {
    return (this.phase === 'play' || this.phase === 'run') && this.player.alive;
  }

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    // Slow motion: eased toward what's wanted; held a moment after a key lands
    if (this.slowHold > 0) {
      this.slowHold -= dt;
      if (this.slowHold <= 0 && this.qte?.state !== 'live') this.slowWant = 1;
    }
    this.slow += (this.slowWant - this.slow) * Math.min(1, dt * 12);
    const sdt = dt * this.slow;
    this.lastSdt = sdt;
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
    this.updateQte(dt);

    const busy = this.phase !== 'play' && this.phase !== 'run';
    this.arsenal.preUpdate(dt, input, { canSwitch: this.playable && input.pointerLocked, busy, hold: this.phase === 'fight' || this.phase === 'pickup' });
    const aiming = !busy && input.rightHeld && input.pointerLocked && this.playable && !this.arsenal.reloading && !this.arsenal.switching;
    p.aiming = aiming;

    if (this.phase === 'play' || this.phase === 'run' || this.phase === 'dead') p.update(dt, L.colliders);
    else if (this.phase === 'read') {
      p.update(dt, L.colliders);
      this.updateRead(dt);
    } else if (this.phase === 'pickup') this.updatePickup(dt);
    else if (this.phase === 'fight') this.updateFight(dt, sdt);
    else if (this.phase === 'dying') this.updateDying(dt);
    else if (this.phase === 'portal' || this.phase === 'done') this.updatePortal(dt);
    // Everyone in the room: alive and posed, or a ragdoll settling
    for (const e of this.enemies) e.update(this.phase === 'dying' ? dt : sdt);
    if (this.phase === 'fight' && BEATS[this.beatI] !== 'barge') this.arsenal.held.stow = 1;

    this.updateExplore();
    if (this.phase === 'run') this.updateRun(dt);

    this.arsenal.updateViewmodels(dt, aiming);
    const canFire = this.playable && input.pointerLocked && !busy;
    this.arsenal.updateFire(dt, input, canFire, (r, m, re) => this.hud.setAmmo(r, m, re));
    if (this.phase === 'play' || this.phase === 'run') {
      const targetFov = 74 - this.arsenal.zoomFov;
      if (Math.abs(p.camera.fov - targetFov) > 0.01) {
        p.camera.fov = targetFov;
        p.camera.updateProjectionMatrix();
      }
    }
    this.hud.setAiming(this.arsenal.aimBlend > 0.5);

    // ---- The world
    this.updateSlab(sdt);
    this.updateCrumble(dt);
    this.updateAtmosphere(dt);
    this.updatePuffs(sdt);
    this.hud.setHealth(p.health, p.regenProgress);
    this.bits.update(sdt);
    this.updateDebris(sdt);
    this.decals.update(dt);
    this.particles.update(sdt);
    this.flashPool.update(dt);
    this.world.step(1 / 60, sdt, 3);
    this.applyShake(dt);
    // Last, with the camera where it'll be drawn from: his arms
    p.camera.updateMatrixWorld(true);
    this.melee.update();
    if (this.phase === 'read' || this.paperOut) this.paperArms.update();
    if (this.pickRoot.visible) this.pickArms.update();
    input.endFrame();
  }

  private updateAtmosphere(dt: number): void {
    const L = this.level;
    const cam = this.player.camera.position;
    // Toward the portal, everything goes purple
    const toPortal = clamp01((cam.z - 30) / 25);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setRGB(0.04 + 0.12 * toPortal, 0.055 - 0.03 * toPortal, 0.052 + 0.18 * toPortal);
    fog.density = 0.03 + 0.03 * toPortal;
    (this.scene.background as THREE.Color).copy(fog.color);
    L.portal.mat.uniforms.uT.value = this.t;
    L.portal.ring.rotation.z += dt * 0.3;
    L.portal.light.intensity = 9 + 3 * Math.sin(this.t * 3.1) + 2 * Math.sin(this.t * 7.3);
    for (const s of L.portal.mist) {
      const b = s.userData.base as THREE.Vector3;
      const ph = s.userData.ph as number;
      s.position.set(b.x + Math.sin(this.t * 0.4 + ph) * 0.4, b.y + Math.sin(this.t * 0.6 + ph * 2) * 0.25, b.z + Math.cos(this.t * 0.3 + ph) * 0.4);
    }
    this.portalHum?.setDistance(cam.distanceTo(L.portal.center));
    // The tanks breathe; the things in them turn
    L.tankGlow.forEach((m, i) => (m.emissiveIntensity = 0.8 + 0.25 * Math.sin(this.t * 1.1 + i)));
    L.floaters.forEach((f, i) => {
      f.rotation.y += dt * 0.15 * (i % 2 ? 1 : -1);
      f.position.y = 1.4 + Math.sin(this.t * 0.5 + i) * 0.08;
    });
    // Screens every few frames
    if (Math.floor(this.t * 20) !== Math.floor((this.t - dt) * 20)) for (const s of L.screens) s.draw(this.t);
    // The fittings buzz and flicker; worse once the place is coming down
    const bad = this.crumbleT > 0 || this.phase === 'run' ? 1 : 0;
    L.lights.lamps.forEach((l, i) => {
      if (l.userData.dead) {
        l.intensity = 0;
        return;
      }
      if (l.userData.k === undefined) l.userData.k = l.intensity;
      const f = Math.sin(this.t * (11 + i) + i * 3) * Math.sin(this.t * (3.3 + i * 0.4));
      const out = f < (bad ? -0.6 : -0.93);
      l.intensity = out ? 0.2 : (l.userData.k as number) * (0.9 + 0.1 * f);
    });
    if (this.phase === 'run' || this.crumbleT > 0) for (const r of L.lights.red) r.intensity = 3 + 3 * Math.max(0, Math.sin(this.t * 6));
  }

  private applyShake(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 1.4);
    if (this.shake <= 0) return;
    const s = this.shake * this.shake * 0.03;
    const cam = this.player.camera;
    cam.rotation.x += (Math.random() - 0.5) * s;
    cam.rotation.y += (Math.random() - 0.5) * s;
  }

  // ------------------------------------------------------------ timers

  private timers: { at: number; fn: () => void }[] = [];
  private later(sec: number, fn: () => void): void {
    this.timers.push({ at: this.t + sec, fn });
  }

  private makePuffTex(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // ------------------------------------------------------------ CombatScene

  /** Nobody here dies to a bullet but by the script. */
  protected killEnemy(enemy: Enemy, point: THREE.Vector3, dir: THREE.Vector3, _byPlayer: boolean, _headshot: boolean, hitPart?: string): void {
    enemy.die(point, dir, this.world, hitPart ?? 'torso');
  }

  // ------------------------------------------------------------ input

  private onClick(): void {
    if (this.dead) this.restart();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.ctx.engine.paused) return;
    if (this.dead) {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') this.restart();
      return;
    }
    if (this.qte?.state === 'live' && !e.repeat && e.code.startsWith('Key')) this.resolveQte(e.code === this.qte.code);
  }

  private restart(): void {
    this.ctx.bus.emit(Events.RestartLevel14, { checkpoint: this.checkpoint });
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}

