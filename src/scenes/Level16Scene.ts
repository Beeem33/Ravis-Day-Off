import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import {
  Level16Builder,
  type Level16Data,
  type TreeTrunk,
  groundY,
  inLake,
  WATER_Y,
  CLIFF_Z,
  MASSIF,
  ARENA,
  MEADOW
} from '../environment/Level16Builder';
import type { Collider } from '../environment/OfficeLevelBuilder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { FPSPlayer } from '../entities/FPSPlayer';
import { KnifeTwirlViewmodel, karambit, GRIP_HOLD } from '../entities/KnifeTwirlViewmodel';
import { Arsenal, loadoutFor } from '../entities/Arsenal';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { hideInventory } from '../ui/InventoryUI';
import { FPSHUD } from '../ui/FPSHUD';
import { FirstPersonArms, grip, mixGrip } from '../entities/RaviVisual';
import { Hound, SpiderBoss, GlowShots, Droplets, glowSprite, type GlowShot } from '../entities/AlienCreatures';
import { AlienBlaster } from '../entities/AlienBlaster';
import { TrackerTablet } from '../entities/TrackerTablet';
import type { Enemy } from '../entities/Enemy';

/**
 * Level16Scene — the far side.
 *
 *  1. The station: he comes to in a little survey station. A button by the
 *     door lifts it, and there's the planet.
 *  2. The meadow: a crashed drone, smoke going up, its beacon blinking; the
 *     tracker in the sponge beside it. Hounds come out of the trees on the
 *     way. The tracker (hold M) shows the exit portal's coordinates.
 *  3. North: the forest, then a cliff across the valley — over it with the
 *     pressure shotgun; the massif, and under it through the lake, with a
 *     torch, round the turns, up on the other side.
 *  4. The big one in its clearing. Kill it, take its arm (E), wear it.
 *  5. The portal.
 */

type Phase = 'play' | 'harvest' | 'end';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};
/** Feet this far under the surface and he's swimming. */
const SWIM_DEPTH = 1.25;
const HOUND_SPEED = 6.9;
const BOSS_NAME = 'THE MAW';
const ALIEN_BLOOD = 0x9ad02a;
const BOSS_BLOOD = 0x9a2a6a;
const GOO = 0x46b8ff;

interface Hit {
  dist: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  kind: 'terrain' | 'world' | 'trunk' | 'hound' | 'boss';
  hound?: Hound;
  head?: boolean;
}

/** A pack of hounds, and where they come out. */
interface Pack {
  /** He goes past this (z less than it) and they come. */
  trigger: number;
  at: { x: number; z: number }[];
  spawned: boolean;
  /** Only once he has the tracker (the first lot), or once the arm's his (the last). */
  needs?: 'tablet' | 'harvest';
}

// ================================================================ the harvest

/** Left fist round a handle running up the anchor's +Y. */
const L_HOLD = grip([-0.024, -0.004, 0.07], [-0.08, 0.04, -1], [1, 0, -0.1], [-0.3, -0.4, 0.86], {
  fingers: [[70, 90, 56], [74, 92, 58], [76, 94, 58], [78, 94, 58]],
  thumb: [0.5, 0.7, 0.55]
});
const L_OPEN = grip([-0.03, -0.004, 0.075], [-0.06, 0.12, -1], [0.9, 0.42, -0.1], [-0.3, -0.4, 0.86], {
  fingers: [[10, 14, 8], [10, 14, 8], [12, 16, 10], [16, 20, 12]],
  thumb: [0.05, 0.12, 0.1],
  spread: 5
});

/**
 * His hands for taking the arm: the karambit in his right for the cuts,
 * his left to pick the thing up and bring it to his right forearm. The
 * blaster (his right fist, the arm going on it) is its own viewmodel.
 */
class HarvestHands {
  readonly knifeRoot = new THREE.Group();
  readonly knifeHand = new THREE.Group();
  readonly leftRoot = new THREE.Group();
  readonly leftHand = new THREE.Group();
  private knifeArms: FirstPersonArms;
  private leftArms: FirstPersonArms;

  constructor(camera: THREE.Camera) {
    camera.add(this.knifeRoot, this.leftRoot);
    this.knifeRoot.add(this.knifeHand);
    const k = karambit();
    const piv = new THREE.Group();
    piv.position.y = -0.064;
    k.rotation.y = Math.PI / 2;
    piv.add(k);
    this.knifeHand.add(piv);
    this.knifeArms = new FirstPersonArms(this.knifeRoot, camera).set('r', this.knifeHand, GRIP_HOLD);
    this.leftRoot.add(this.leftHand);
    this.leftArms = new FirstPersonArms(this.leftRoot, camera).set('l', this.leftHand, L_OPEN);
    this.knifeRoot.visible = false;
    this.leftRoot.visible = false;
  }

  update(leftClosed: number): void {
    if (this.knifeRoot.visible) this.knifeArms.update();
    if (this.leftRoot.visible) {
      this.leftArms.set('l', this.leftHand, mixGrip(L_OPEN, L_HOLD, leftClosed));
      this.leftArms.update();
    }
  }
}

/** A torch for under the water, in his left hand, low. */
class WaterTorch {
  readonly root = new THREE.Group();
  readonly hand = new THREE.Group();
  readonly light: THREE.SpotLight;
  private arms: FirstPersonArms;
  /** 0 away .. 1 out. */
  out = 0;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.hand);
    const body = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.6 });
    const torch = new THREE.Group();
    torch.rotation.x = -Math.PI / 2;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 14), body);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.02, 0.05, 16), body);
    head.position.y = 0.1;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 16), new THREE.MeshBasicMaterial({ color: 0xf8fbff, toneMapped: false }));
    lens.position.y = 0.126;
    lens.rotation.x = -Math.PI / 2;
    const grip1 = new THREE.Mesh(new THREE.CylinderGeometry(0.0195, 0.0195, 0.07, 14), dark);
    grip1.position.y = -0.03;
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 16), dark);
    strap.position.y = -0.08;
    torch.add(barrel, head, lens, grip1, strap);
    this.hand.add(torch);
    const glow = glowSprite(0xe8f4ff, 0.18, 0.9);
    glow.position.z = -0.13;
    this.hand.add(glow);
    this.light = new THREE.SpotLight(0xe8f4ff, 0, 34, 0.5, 0.45, 1.2);
    this.light.position.set(-0.15, -0.15, -0.3);
    this.light.target.position.set(-0.05, -0.1, -8);
    camera.add(this.light, this.light.target);
    this.arms = new FirstPersonArms(this.root, camera).set('l', this.hand, L_HOLD);
    this.root.visible = false;
  }

  update(dt: number, want: boolean, t: number): void {
    this.out = Math.max(0, Math.min(1, this.out + (want ? dt * 3 : -dt * 3)));
    const k = smooth(this.out);
    this.root.visible = this.out > 0.01;
    this.light.intensity = 60 * k;
    if (!this.root.visible) return;
    this.hand.position.set(-0.2, -0.24 - 0.4 * (1 - k) + Math.sin(t * 1.7) * 0.008, -0.38);
    this.hand.rotation.set(0.05 + Math.sin(t * 1.3) * 0.02, -0.12, 0.15);
    this.arms.update();
  }
}

// ================================================================ scene

export class Level16Scene extends CombatScene<Level16Data> {
  private arsenal!: Arsenal;
  private knife!: KnifeTwirlViewmodel;
  private drink!: DrinkViewmodel;
  private blaster!: AlienBlaster;
  private tablet!: TrackerTablet;
  private torch!: WaterTorch;
  private hands!: HarvestHands;
  private hud!: FPSHUD;
  private phase: Phase = 'play';
  private phaseT = 0;
  private t = 0;
  private dead = false;
  private checkpoint = 0;
  private hounds: Hound[] = [];
  private houndHits: THREE.Mesh[] = [];
  private packs: Pack[] = [];
  private boss!: SpiderBoss;
  private bossAwake = false;
  private bossVel = new THREE.Vector3();
  private bossFireT = 3;
  private bossVolley = 0;
  private bossSide = 1;
  private bossSideT = 0;
  private bossArm = 0;
  private bossShots = 0;
  private bolts!: GlowShots;
  private goo!: GlowShots;
  private drops!: Droplets;
  private gooLight!: THREE.PointLight;
  private portalLight!: THREE.PointLight;
  private hasTablet = false;
  private harvested = false;
  private doorT = -1;
  private underwater = false;
  private swimHinted = false;
  private cliffHinted = false;
  private tabletHinted = 0;
  private smokeT = 0;
  private bubbleT = 0;
  private shake = 0;
  private harvestArm = 0;
  private harvestFrom = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private severedArm: THREE.Group | null = null;
  /** The trunks (and boulders) near enough to bump into, as boxes, refreshed as he moves. */
  private nearCols: Collider[] = [];
  private nearPool: Collider[] = [];
  private nearAt = new THREE.Vector3(1e9, 0, 0);
  private trunkGrid = new Map<string, TreeTrunk[]>();
  private allCols: Collider[] = [];
  private floorBody!: CANNON.Body;
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private ui!: HTMLElement;
  private banner!: HTMLElement;
  private fadeEl!: HTMLElement;
  private letterbox!: HTMLElement;
  private murk!: HTMLElement;
  private card!: HTMLElement;
  private hintEl!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private clickHandler = (): void => this.onClick();
  private underLoop: { set(k: number): void; stop(): void } | null = null;
  private static readonly FOG_AIR = new THREE.Color(0x1c0e2a);
  private static readonly FOG_WATER = new THREE.Color(0x0b3a14);

  constructor(ctx: GameContext, private from = 0) {
    super(ctx);
  }

  // ============================================================ lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(Level16Scene.FOG_AIR.getHex(), 0.011);
    this.level = new Level16Builder().build();
    const L = this.level;
    this.scene.add(L.group);
    this.world = this.createPhysicsWorld(L.colliders);
    // The ground for anything physical (his body, if it comes to that; dropped mags): a plane kept under him
    this.floorBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    this.floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(this.floorBody);
    for (const t of L.trunks) {
      const k = `${Math.floor(t.x / 8)},${Math.floor(t.z / 8)}`;
      let a = this.trunkGrid.get(k);
      if (!a) this.trunkGrid.set(k, (a = []));
      a.push(t);
    }
    for (let i = 0; i < 24; i++) this.nearPool.push({ box: new THREE.Box3() });

    this.checkpoint = Math.min(this.from, 4);
    const start = this.checkpointPose(this.checkpoint);
    this.player = new FPSPlayer(start.pos.clone(), start.yaw, input, audio, bus);
    this.player.ground = groundY;
    this.player.camera.far = 1300;
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
    const a = this.arsenal;
    a.shotgun.useQuad();
    a.shells = 6;
    a.pressureOn = true;
    a.pressure = Arsenal.PRESSURE_MAX;
    a.hasKnife = true;
    a.equip('rifle', 0);
    a.onPressureShot = () => (this.shake = Math.max(this.shake, 0.5));
    this.knife = new KnifeTwirlViewmodel(this.player.camera);
    this.knife.onSlash = () => this.knifeSlash();
    this.knife.onCatch = () => audio.pocket();
    this.knife.stow = 1;
    this.drink = new DrinkViewmodel(this.player.camera);
    this.drink.onEvent = (e, i) => {
      if (e === 'crack') audio.canCrack();
      else if (e === 'gulp') audio.gulp(i);
      else if (e === 'heal') this.player.healFull();
      else if (e === 'crush') audio.canCrush();
      else if (e === 'toss') this.dropCan(this.drink.tossPose());
    };
    this.blaster = new AlienBlaster(this.player.camera);
    this.tablet = new TrackerTablet(this.player.camera, L.mapCanvas, L.mapBounds);
    this.torch = new WaterTorch(this.player.camera);
    this.hands = new HarvestHands(this.player.camera);

    // ---- Light: a dim purple sky overhead, a pale light off the big planet, the ground bouncing green
    this.hemi = new THREE.HemisphereLight(0xa898d8, 0x7a8a50, 2.4);
    this.sun = new THREE.DirectionalLight(0xe8dcff, 2.6);
    this.sun.position.set(180, 320, 240);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.gooLight = new THREE.PointLight(0x46b8ff, 0, 9, 1.6);
    this.scene.add(this.gooLight);
    this.portalLight = new THREE.PointLight(0x6ae0ff, 4, 22, 1.4);
    this.portalLight.position.copy(L.portal.at).add(V(0, 2.6, 0));
    this.scene.add(this.portalLight);

    // ---- Shots, splashes
    this.bolts = new GlowShots(0x4ac8ff, 0.12, 0, 0, 40);
    this.goo = new GlowShots(GOO, 0.075, 5, 0.25, 40);
    this.drops = new Droplets(700);
    this.scene.add(this.bolts.group, this.goo.group, this.drops.points);

    // ---- The big one, waiting in its clearing; the packs
    this.boss = new SpiderBoss(groundY);
    this.scene.add(this.boss.group);
    this.boss.place(ARENA.x, ARENA.z - 8, 0);
    this.packs = [
      { trigger: 121, at: [{ x: 6, z: 104 }, { x: 22, z: 110 }, { x: -6, z: 98 }], spawned: false },
      { trigger: 26, at: [{ x: -14, z: 8 }, { x: 14, z: 6 }, { x: -6, z: 2 }, { x: 18, z: 14 }], spawned: false, needs: 'tablet' },
      { trigger: -58, at: [{ x: -16, z: -70 }, { x: 14, z: -72 }, { x: 0, z: -78 }, { x: 22, z: -66 }], spawned: false },
      { trigger: 999, at: [{ x: -18, z: -134 }, { x: 16, z: -136 }, { x: -6, z: -140 }, { x: 8, z: -142 }, { x: 24, z: -130 }, { x: -24, z: -128 }], spawned: false, needs: 'harvest' }
    ];
    this.hud = new FPSHUD(this.ctx.uiRoot, bus, 0, this.player.maxHealth);
    this.hud.setCounter(null);
    this.hud.setAmmo(...a.ammoReadout());
    this.buildUI();
    // Where he starts from: what's already done
    if (this.checkpoint >= 1) {
      this.openDoor(true);
      this.takeTablet(true);
    }
    for (let i = 0; i < this.packs.length; i++) {
      // Packs behind the checkpoint are done with
      if ((this.checkpoint >= 1 && i === 0) || (this.checkpoint >= 2 && i === 1) || (this.checkpoint >= 3 && i === 2)) this.packs[i].spawned = true;
    }

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }),
      bus.on(Events.PlayerDied, () => {
        this.dead = true;
        this.hud.setBoss(null, 0);
      })
    );
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('click', this.clickHandler);
    this.underLoop = audio.underwaterLoop();
    audio.startTrackMusic('audio/dark-amb.mp3', 0, 0, 0.45, 4);

    this.player.camera.fov = 74;
    this.player.camera.updateProjectionMatrix();
    this.fadeEl.style.transition = 'opacity 1.6s';
    this.later(0.05, () => (this.fadeEl.style.opacity = '0'));
    this.setObjective(['RELEASE THE STATION DOOR', 'FOLLOW THE TRACKER — HOLD [M]', 'FOLLOW THE TRACKER — HOLD [M]', 'FOLLOW THE TRACKER — HOLD [M]', 'FOLLOW THE TRACKER — HOLD [M]'][this.checkpoint]);
    input.requestPointerLock();
  }

  exit(): void {
    this.ctx.audio.stopTrackMusic(0.8);
    this.ctx.audio.stopBossMusic(0.5);
    this.underLoop?.stop();
    for (const u of this.unsubs) u();
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('click', this.clickHandler);
    this.hud.destroy();
    hideInventory();
    this.flashPool.dispose();
    this.ui.remove();
  }

  private checkpointPose(c: number): { pos: THREE.Vector3; yaw: number } {
    const at = (x: number, z: number, yaw: number): { pos: THREE.Vector3; yaw: number } => ({ pos: V(x, groundY(x, z), z), yaw });
    switch (c) {
      case 1:
        return at(MEADOW.x - 2, MEADOW.z - 2, 0.2);
      case 2:
        return at(0, CLIFF_Z - 4, 0);
      case 3:
        return at(0, -60, 0);
      case 4:
        return at(0, -82, 0);
      default:
        return this.level.start;
    }
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="l16-murk" style="position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .25s;
        background:radial-gradient(ellipse at center, rgba(40,140,50,0.25) 0%, rgba(8,50,14,0.85) 100%)"></div>
      <div class="intro-letterbox open"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="l16-hint" style="position:absolute;left:50%;bottom:17%;transform:translateX(-50%);color:#e8f0ea;font:bold 15px 'Courier New',monospace;
        letter-spacing:2px;text-shadow:0 0 6px #000,0 0 2px #000;opacity:0;transition:opacity .4s;pointer-events:none;text-align:center"></div>
      <div class="intro-fade" style="opacity:1"></div>
      <div class="hq-card" style="position:absolute;inset:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;
        opacity:0;transition:opacity 1.6s;pointer-events:none;color:#e8e6df;letter-spacing:8px">
        <div style="font-size:13px;opacity:.6;letter-spacing:6px;margin-bottom:18px">LEVEL 16 — THE FAR SIDE</div>
        <div style="font-size:42px;font-weight:bold">TO BE CONTINUED</div>
      </div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.murk = el.querySelector('.l16-murk')!;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.banner = el.querySelector('.intro-objective')!;
    this.hintEl = el.querySelector('.l16-hint')!;
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

  private hintTimer = 0;
  private hint(text: string, sec = 5): void {
    this.hintEl.textContent = text;
    this.hintEl.style.opacity = '1';
    this.hintTimer = sec;
  }

  private cinema(on: boolean): void {
    this.letterbox.classList.toggle('open', !on);
    if (on) this.hud.hide();
    else this.hud.show();
  }

  private get playable(): boolean {
    return this.phase === 'play' && this.player.alive;
  }

  // ============================================================ frame

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
    const a = this.arsenal;

    // ---- Water: deep enough and he swims
    const pos = p.position;
    const lake = inLake(pos.x, pos.z);
    p.swimming = p.alive && this.phase === 'play' && lake && pos.y < WATER_Y - SWIM_DEPTH;
    p.swimTop = WATER_Y - 1.45;
    const camY = p.camera.position.y;
    this.underwater = inLake(p.camera.position.x, p.camera.position.z) && camY < WATER_Y - 0.02;
    if (p.swimming && !this.swimHinted) {
      this.swimHinted = true;
      this.ctx.audio.splash(true);
      this.splash(V(pos.x, WATER_Y, pos.z), 30);
      this.hint('UNDERWATER: [W] SWIM WHERE YOU LOOK · [SPACE] UP · [C] DOWN', 7);
    }

    // ---- His hands: the tracker on M; a can on G
    const free = this.playable && input.pointerLocked && !p.swimming;
    const wantTablet = this.hasTablet && free && input.isDown('KeyM') && !this.drink.engaged;
    if (input.wasPressed('KeyG') && free && !a.reloading && !this.knife.busy && !wantTablet) this.drink.start();
    if (!p.alive) this.drink.abort();
    const busy = this.phase !== 'play' || p.swimming || this.drink.engaged || this.tablet.up > 0.05 || wantTablet;
    a.preUpdate(dt, input, { canSwitch: free && !this.knife.busy, busy, hold: this.phase === 'harvest' });
    const aiming = !busy && input.rightHeld && input.pointerLocked && this.playable && !a.reloading && !a.switching && !a.pressureArmed;
    p.aiming = aiming;

    // ---- Moving: the boxes and the trees near him
    if (this.phase === 'play' || this.dead) {
      this.refreshNear();
      p.update(dt, this.allCols);
    }
    this.floorBody.position.set(0, groundY(pos.x, pos.z), 0);

    // ---- Weapons
    const sideOut = a.knifeActive;
    this.knife.stow = sideOut && a.side === 'knife' ? a.knifeStow : 1;
    if (this.phase !== 'harvest') this.blaster.stow = sideOut && a.side === 'blaster' ? a.knifeStow : 1;
    const canFire = this.playable && input.pointerLocked && !busy;
    if (sideOut && a.side === 'knife' && a.knifeWanted && canFire && a.knifeStow < 0.15 && input.consumeClick() && this.knife.trick()) this.ctx.audio.punchSwish();
    if (sideOut && a.side === 'blaster') {
      input.consumeClick();
      if (canFire && input.mouseHeld && !p.sprinting && this.blaster.fire()) this.fireGoo();
    }
    this.knife.update(dt, p);
    if (this.phase !== 'harvest') this.blaster.update(dt, p);
    a.updateViewmodels(dt, aiming);
    a.updateFire(dt, input, canFire, (r, m, re) => this.hud.setAmmo(r, m, re));
    this.hud.setAmmoShown(!a.knifeActive && !a.knifeWanted);
    this.hud.setPressure(a.pressureArmed ? a.pressure : null);
    this.drink.update(dt, p);
    this.tablet.update(dt, wantTablet, pos, p.yaw, L.portal.at, p.bob);
    this.torch.update(dt, this.underwater && p.alive, this.t);
    if (this.phase === 'play') {
      const targetFov = 74 - a.zoomFov;
      if (Math.abs(p.camera.fov - targetFov) > 0.01) {
        p.camera.fov = targetFov;
        p.camera.updateProjectionMatrix();
      }
    }
    this.hud.setAiming(a.aimBlend > 0.5);

    // ---- The route
    this.updateDoor(dt);
    this.updateTabletPickup(dt);
    this.updatePacks();
    this.updateHounds(dt);
    this.updateBoss(dt);
    this.updateShots(dt);
    this.updateHarvestPrompt();
    if (this.phase === 'harvest') this.updateHarvest(dt);
    this.updatePortal(dt);
    this.updateCheckpoints();
    this.updateHints(dt);

    // ---- The world
    this.updateAtmosphere(dt);
    this.drops.update(dt, groundY);
    this.hud.setHealth(p.health, p.regenProgress);
    this.updateDebris(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.gooLight.intensity = Math.max(0, this.gooLight.intensity - dt * 60);
    this.world.step(1 / 60, dt, 3);
    this.applyShake(dt);
    input.endFrame();
  }

  /** The level's boxes, and boxes for the trunks and boulders within a few metres of him. */
  private refreshNear(): void {
    const p = this.player.position;
    if (this.nearAt.distanceToSquared(p) > 1 || this.allCols.length === 0) {
      this.nearAt.copy(p);
      this.nearCols.length = 0;
      const cx = Math.floor(p.x / 8);
      const cz = Math.floor(p.z / 8);
      let n = 0;
      for (let i = cx - 1; i <= cx + 1; i++)
        for (let j = cz - 1; j <= cz + 1; j++) {
          for (const t of this.trunkGrid.get(`${i},${j}`) ?? []) {
            if (n >= this.nearPool.length) break;
            if (Math.hypot(t.x - p.x, t.z - p.z) > 6) continue;
            const c = this.nearPool[n++];
            const r = t.r * 0.85;
            const y = groundY(t.x, t.z);
            c.box.min.set(t.x - r, y - 1, t.z - r);
            c.box.max.set(t.x + r, y + t.h, t.z + r);
            this.nearCols.push(c);
          }
        }
      this.allCols = this.level.colliders.concat(this.nearCols);
    }
  }

  // ============================================================ the station

  private updateDoor(dt: number): void {
    const L = this.level;
    const p = this.player;
    const d = L.door;
    if (this.doorT < 0) {
      const eye = p.camera.position;
      const near = eye.distanceTo(d.button) < 1.7;
      const look = p.camera.getWorldDirection(new THREE.Vector3()).dot(d.button.clone().sub(eye).normalize()) > 0.75;
      d.buttonMat.emissiveIntensity = 0.9 + 0.6 * Math.sin(this.t * 5);
      if (this.playable && near && look) {
        this.hud.setPrompt('[ E ] RELEASE DOOR');
        if (this.ctx.input.wasPressed('KeyE')) this.openDoor(false);
      } else this.hud.setPrompt(null);
      return;
    }
    if (this.doorT < 3) {
      this.doorT += dt;
      const k = smooth((this.doorT - 0.6) / 2.2);
      d.slab.position.y = groundY(0, 134.5) + k * 2.45;
      if (k > 0.9) d.collider.disabled = true;
      if (this.doorT < 0.6) this.shake = Math.max(this.shake, 0.15);
    }
  }

  private openDoor(instant: boolean): void {
    const d = this.level.door;
    d.buttonMat.emissive.setHex(0x20ff40);
    d.buttonMat.emissiveIntensity = 1.2;
    this.hud.setPrompt(null);
    if (instant) {
      this.doorT = 3;
      d.slab.position.y = groundY(0, 134.5) + 2.45;
      d.collider.disabled = true;
      return;
    }
    this.doorT = 0;
    this.ctx.audio.breakerThrow();
    this.later(0.4, () => this.ctx.audio.doorOpen());
    this.later(1.0, () => this.ctx.audio.elevatorDoors(1.8));
    this.later(2.6, () => {
      this.setObjective('INVESTIGATE THE CRASHED DRONE');
      this.hint('SMOKE, AND A RED BEACON — OFF TO THE RIGHT', 6);
    });
  }

  // ============================================================ the tracker

  private updateTabletPickup(dt: number): void {
    const L = this.level;
    // The drone smokes and its beacon blinks till he's been to it
    L.tablet.beacon.emissiveIntensity = Math.sin(this.t * 6) > 0.3 ? 3 : 0.2;
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.35;
      if (this.player.position.distanceTo(L.tablet.at) < 140) this.particles.smokeColumn(L.tablet.at.clone().add(V(1.8, 0.4, -0.8)), 0.9, 1);
    }
    if (this.hasTablet || !this.playable) return;
    const d = this.player.position.distanceTo(L.tablet.at);
    if (d < 2.2) {
      this.hud.setPrompt('[ E ] PICK UP THE TRACKER');
      if (this.ctx.input.wasPressed('KeyE')) this.takeTablet(false);
    } else if (this.doorT >= 0) this.hud.setPrompt(null);
  }

  private takeTablet(silent: boolean): void {
    this.hasTablet = true;
    this.level.tablet.obj.visible = false;
    this.hud.setPrompt(null);
    if (silent) return;
    this.ctx.audio.itemGet();
    this.checkpoint = Math.max(this.checkpoint, 1);
    this.setObjective('FOLLOW THE TRACKER — HOLD [M]');
    this.hint('HOLD [M] TO LOOK AT THE TRACKER — IT HAS A FIX ON AN EXIT PORTAL', 7);
    this.tabletHinted = 1;
  }

  // ============================================================ hounds

  private updatePacks(): void {
    const z = this.player.position.z;
    for (const pk of this.packs) {
      if (pk.spawned) continue;
      if (pk.needs === 'tablet' && !this.hasTablet) continue;
      if (pk.needs === 'harvest') continue;
      if (z < pk.trigger && this.playable) this.spawnPack(pk);
    }
  }

  private spawnPack(pk: Pack): void {
    pk.spawned = true;
    pk.at.forEach((s, i) => {
      const h = new Hound();
      const y = groundY(s.x, s.z);
      h.group.position.set(s.x, y, s.z);
      h.yaw = Math.atan2(this.player.position.x - s.x, this.player.position.z - s.z);
      h.group.rotation.y = h.yaw;
      h.state = 'lurk';
      h.stateT = -i * 0.35 - Math.random() * 0.4;
      this.scene.add(h.group);
      this.hounds.push(h);
      this.houndHits.push(...h.hitboxes);
    });
    this.later(0.3, () => this.ctx.audio.houndScreech(this.player.position.distanceTo(V(pk.at[0].x, 0, pk.at[0].z)) * 0.5));
  }

  private updateHounds(dt: number): void {
    const p = this.player;
    const pp = p.position;
    const tmp = new THREE.Vector3();
    for (const h of this.hounds) {
      const g = h.group.position;
      h.stateT += dt;
      if (!h.alive) {
        h.deadT += dt;
        h.knock.multiplyScalar(Math.exp(-4 * dt));
        g.x += h.knock.x * dt;
        g.z += h.knock.z * dt;
        g.y = groundY(g.x, g.z);
        h.animate(dt, this.t);
        continue;
      }
      const dx = pp.x - g.x;
      const dz = pp.z - g.z;
      const dist = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      let target = 0;
      if (h.state === 'lurk') {
        // Crouched, mouth working, then off
        target = 0;
        if (h.stateT > 0.6) {
          h.state = 'run';
          h.stateT = 0;
          this.ctx.audio.houndScreech(dist * 0.6);
        }
      } else if (h.state === 'run') {
        target = p.alive && this.phase === 'play' ? HOUND_SPEED : 0;
        if (dist < 2.8 && p.alive && this.phase === 'play' && Math.abs(Math.atan2(Math.sin(want - h.yaw), Math.cos(want - h.yaw))) < 0.5) {
          h.state = 'lunge';
          h.stateT = 0;
          h.bit = false;
          h.airV = 3.6;
          h.vel.set(Math.sin(h.yaw), 0, Math.cos(h.yaw)).multiplyScalar(9);
          this.ctx.audio.houndScreech(dist);
        }
        h.screechT -= dt;
        if (h.screechT <= 0) {
          h.screechT = 2 + Math.random() * 3;
          this.ctx.audio.houndScreech(dist);
        }
      } else if (h.state === 'lunge') {
        if (!h.bit && dist < 1.5 && Math.abs(h.air + g.y - pp.y) < 1.4) {
          h.bit = true;
          this.ctx.audio.houndBite(0);
          this.drops.burst(p.camera.position.clone().addScaledVector(p.forwardDir(), 0.5), V(0, 0.4, 0), 10, 2.5, 0xa01010);
          this.shake = Math.max(this.shake, 0.5);
          p.hit('AN ALIEN HOUND', g.clone());
        }
        if (h.stateT > 0.25 && h.air <= 0) {
          h.state = 'recover';
          h.stateT = 0;
        }
      } else if (h.state === 'recover') {
        // Backs off a step after a go at him, before the next
        target = h.bit ? -3 : -1.5;
        if (h.stateT > (h.bit ? 1.1 : 0.5)) {
          h.state = 'run';
          h.stateT = 0;
        }
      }
      // Turn toward him (not mid-lunge)
      if (h.state !== 'lunge') {
        const d = Math.atan2(Math.sin(want - h.yaw), Math.cos(want - h.yaw));
        h.yaw += THREE.MathUtils.clamp(d, -dt * 6, dt * 6);
        h.speed += (target - h.speed) * Math.min(1, dt * 4);
        h.vel.set(Math.sin(h.yaw), 0, Math.cos(h.yaw)).multiplyScalar(h.speed);
      } else {
        h.speed = 9;
      }
      // Keep off each other and out of the trees
      for (const o of this.hounds) {
        if (o === h || !o.alive) continue;
        tmp.subVectors(g, o.group.position).setY(0);
        const l = tmp.length();
        if (l < 1.3 && l > 1e-3) h.vel.addScaledVector(tmp, ((1.3 - l) / l) * 4);
      }
      for (const t of this.trunkGrid.get(`${Math.floor(g.x / 8)},${Math.floor(g.z / 8)}`) ?? []) {
        tmp.set(g.x - t.x, 0, g.z - t.z);
        const l = tmp.length();
        const r = t.r + 0.45;
        if (l < r && l > 1e-3) {
          g.x += (tmp.x / l) * (r - l);
          g.z += (tmp.z / l) * (r - l);
        }
      }
      // Not through him
      if (dist < 0.9 && dist > 1e-3) {
        g.x -= (dx / dist) * (0.9 - dist);
        g.z -= (dz / dist) * (0.9 - dist);
      }
      g.x += h.vel.x * dt;
      g.z += h.vel.z * dt;
      // In the air on a lunge
      if (h.airV !== 0 || h.air > 0) {
        h.air += h.airV * dt;
        h.airV -= 16 * dt;
        if (h.air <= 0) {
          h.air = 0;
          h.airV = 0;
        }
      }
      let gy = groundY(g.x, g.z);
      if (inLake(g.x, g.z)) gy = Math.max(gy, WATER_Y - 0.55);
      g.y = gy + h.air;
      h.group.rotation.y = h.yaw;
      h.animate(dt, this.t);
    }
  }

  private hurtHound(h: Hound, dmg: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    this.drops.burst(point, dir.clone().negate().setY(0.3), 12, 3, ALIEN_BLOOD);
    this.ctx.audio.fleshHit();
    if (!h.alive) return;
    h.hp -= dmg;
    this.ctx.bus.emit(Events.HitMarker, { lethal: h.hp <= 0 });
    if (h.hp > 0) {
      // Staggered
      h.speed *= 0.4;
      return;
    }
    h.alive = false;
    h.state = 'dead';
    h.deadT = 0;
    h.air = 0;
    h.airV = 0;
    h.knock.set(dir.x, 0, dir.z).normalize().multiplyScalar(3 + dmg);
    this.drops.burst(point, V(0, 1, 0), 30, 4, ALIEN_BLOOD);
    this.ctx.audio.houndScreech(point.distanceTo(this.player.position));
    for (const hb of h.hitboxes) {
      const i = this.houndHits.indexOf(hb);
      if (i >= 0) this.houndHits.splice(i, 1);
    }
  }

  /** The karambit's slash: a hound in reach in front of him gets it. */
  private knifeSlash(): void {
    const p = this.player.position;
    const f = this.player.forwardDir();
    for (const h of this.hounds) {
      if (!h.alive) continue;
      const at = h.group.position;
      const dx = at.x - p.x;
      const dz = at.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.0) continue;
      if ((dx * f.x + dz * f.z) / Math.max(d, 1e-4) < 0.4) continue;
      this.hurtHound(h, 2, at.clone().setY(at.y + 0.7), V(dx, 0, dz).normalize());
      this.ctx.audio.knifeStab();
      return;
    }
  }

  // ============================================================ the big one

  private updateBoss(dt: number): void {
    const b = this.boss;
    const p = this.player;
    if (!b.alive) {
      b.update(dt, this.bossVel.set(0, 0, 0), [null, null]);
      if (this.severedArm && this.phase !== 'harvest') this.severedArm.visible = false;
      return;
    }
    if (!this.bossAwake) {
      b.update(dt, this.bossVel.set(0, 0, 0), [null, null]);
      if (this.playable && p.position.z < -82) this.wakeBoss();
      return;
    }
    const pp = p.position;
    const to = V(pp.x - b.at.x, 0, pp.z - b.at.z);
    const dist = to.length();
    to.normalize();
    // Circle him at a distance, switching direction now and then; back off if he's close
    this.bossSideT -= dt;
    if (this.bossSideT <= 0) {
      this.bossSideT = 4 + Math.random() * 4;
      this.bossSide = Math.random() < 0.5 ? -1 : 1;
    }
    const enraged = b.hp < b.maxHp * 0.5;
    const ideal = 15;
    const radial = THREE.MathUtils.clamp((dist - ideal) * 0.5, -3.5, 2.5);
    const tang = V(-to.z, 0, to.x).multiplyScalar(this.bossSide * (enraged ? 3.2 : 2.2));
    const want = to.clone().multiplyScalar(radial).add(tang);
    // Stay in the clearing
    const off = V(b.at.x - ARENA.x, 0, b.at.z - ARENA.z);
    if (off.length() > 22) want.addScaledVector(off.normalize(), -3);
    if (!p.alive || this.phase !== 'play') want.set(0, 0, 0);
    this.bossVel.lerp(want, Math.min(1, dt * 1.5));
    b.at.x += this.bossVel.x * dt;
    b.at.z += this.bossVel.z * dt;
    b.at.y = groundY(b.at.x, b.at.z);
    const face = Math.atan2(to.x, to.z);
    const dy = Math.atan2(Math.sin(face - b.yaw), Math.cos(face - b.yaw));
    b.yaw += THREE.MathUtils.clamp(dy, -dt * 1.6, dt * 1.6);
    const aim = p.camera.position.clone().add(V(0, -0.3, 0));
    b.update(dt, this.bossVel, [aim, aim]);
    // He's in its way: it shoves him off
    if (dist < 3.2 && p.alive) {
      p.launch(V(to.x, 0.35, to.z).normalize(), 7);
      if (this.t - this.lastStomp > 1.2) {
        this.lastStomp = this.t;
        p.hit(BOSS_NAME, b.at.clone());
        this.ctx.audio.stomp(dist);
        this.shake = Math.max(this.shake, 0.7);
      }
    }
    // ---- Shooting: volleys from one arm then the other; enraged, longer and quicker
    if (!p.alive || this.phase !== 'play') return;
    this.bossFireT -= dt;
    if (this.bossFireT <= 0) {
      if (this.bossShots > 0) {
        this.bossShots--;
        this.boltFrom(this.bossArm, enraged ? 0.08 : 0.06);
        this.bossFireT = this.bossShots > 0 ? (enraged ? 0.2 : 0.28) : enraged ? 1.4 : 2.0;
        if (this.bossShots === 0) this.bossArm = 1 - this.bossArm;
      } else {
        this.bossVolley++;
        if (this.bossVolley % 4 === 0) {
          // A spray: both arms, a fan of them
          this.ctx.audio.giantRoar(0.7, dist);
          for (let k = -3; k <= 3; k++) this.later(0.5 + Math.abs(k) * 0.03, () => this.boltFan(k));
          this.bossFireT = 2.2;
        } else {
          this.bossShots = enraged ? 4 : 3;
          this.bossFireT = 0.01;
        }
      }
    }
    this.hud.setBoss(BOSS_NAME, b.hp / b.maxHp);
  }
  private lastStomp = 0;

  private wakeBoss(): void {
    this.bossAwake = true;
    this.checkpoint = Math.max(this.checkpoint, 4);
    this.ctx.audio.giantRoar(1, this.player.position.distanceTo(this.boss.at));
    this.shake = 0.8;
    this.ctx.audio.stopTrackMusic(1.5);
    this.ctx.audio.startBossMusic();
    this.setObjective('KILL IT');
    this.bossFireT = 2.0;
  }

  /** One bolt from arm i at him, a little ahead of where he's going. */
  private boltFrom(i: number, spread: number): void {
    const b = this.boss;
    const p = this.player;
    const from = b.muzzle(i);
    const target = p.camera.position.clone().add(V(0, -0.35, 0));
    const lead = from.distanceTo(target) / 24;
    target.addScaledVector(p.velocity, lead * 0.35);
    const dir = target.sub(from).normalize();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread * 2;
    this.bolts.fire(from, dir.normalize().multiplyScalar(24), 'enemy');
    b.kick[i] = 1;
    this.ctx.audio.alienBolt(from.distanceTo(p.position));
  }

  /** The spray: bolts fanned out either side of him. */
  private boltFan(k: number): void {
    const b = this.boss;
    if (!b.alive) return;
    for (const i of [0, 1]) {
      const from = b.muzzle(i);
      const dir = this.player.camera.position.clone().sub(from).normalize();
      dir.applyAxisAngle(V(0, 1, 0), k * 0.13 + (i ? 0.04 : -0.04));
      this.bolts.fire(from, dir.multiplyScalar(19), 'enemy');
      b.kick[i] = 1;
    }
    if (k === 0) this.ctx.audio.alienBolt(b.at.distanceTo(this.player.position));
  }

  private hurtBoss(dmg: number, point: THREE.Vector3, dir: THREE.Vector3, head: boolean): void {
    const b = this.boss;
    this.drops.burst(point, dir.clone().negate().setY(0.2), head ? 14 : 8, 3, BOSS_BLOOD);
    if (!b.alive) return;
    if (!this.bossAwake) this.wakeBoss();
    b.hp -= dmg * (head ? 2 : 1);
    this.ctx.bus.emit(Events.HitMarker, { lethal: b.hp <= 0 });
    if (b.hp > 0) return;
    b.hp = 0;
    b.alive = false;
    this.hud.setBoss(null, 0);
    this.bolts.clear();
    this.ctx.audio.giantRoar(1.2, this.player.position.distanceTo(b.at));
    this.later(0.9, () => this.ctx.audio.giantFall());
    this.later(1.1, () => (this.shake = Math.max(this.shake, 0.9)));
    this.ctx.audio.stopBossMusic(3);
    // Its body, down on the ground, is something to walk round, not through
    this.later(1.2, () => {
      const c = Math.abs(Math.cos(b.yaw));
      const s = Math.abs(Math.sin(b.yaw));
      const hx = c * 1.4 + s * 2.2;
      const hz = s * 1.4 + c * 2.2;
      const y = b.at.y;
      this.level.colliders.push({ box: new THREE.Box3(V(b.at.x - hx, y, b.at.z - hz), V(b.at.x + hx, y + 2.3, b.at.z + hz)) });
      this.allCols = [];
    });
    this.later(2.5, () => {
      this.setObjective('HARVEST ITS ARM');
      this.hint('GO UP TO ONE OF ITS ARMS', 5);
    });
  }

  // ============================================================ shots

  private fireGoo(): void {
    const p = this.player;
    const from = this.blaster.muzzleWorld();
    const dir = p.camera.getWorldDirection(new THREE.Vector3());
    // Aim at what the crosshair is on, from the muzzle
    const hit = this.trace(p.camera.position, dir, 120, true);
    const aimAt = hit ? hit.point : p.camera.position.clone().addScaledVector(dir, 120);
    const v = aimAt.sub(from).normalize();
    v.x += (Math.random() - 0.5) * 0.02;
    v.y += (Math.random() - 0.5) * 0.02 + 0.015;
    v.z += (Math.random() - 0.5) * 0.02;
    this.goo.fire(from, v.normalize().multiplyScalar(36), 'player', 3);
    this.ctx.audio.gooShot();
    this.gooLight.position.copy(from);
    this.gooLight.intensity = 14;
    this.shake = Math.max(this.shake, 0.12);
    this.ctx.bus.emit(Events.Sound, { position: p.position.clone(), radius: 30, kind: 'gunshot' });
  }

  private updateShots(dt: number): void {
    const p = this.player;
    const seg = new THREE.Vector3();
    // Its bolts: him, or the ground, or something in the way
    this.bolts.update(dt, this.t, (s, a, b) => {
      seg.subVectors(b, a);
      const len = seg.length();
      if (len < 1e-5) return false;
      seg.divideScalar(len);
      // Him: the nearest the bolt came to the middle of him
      if (p.alive) {
        const c = p.position.clone().add(V(0, 0.95, 0));
        const t = THREE.MathUtils.clamp(c.clone().sub(a).dot(seg), 0, len);
        const near = a.clone().addScaledVector(seg, t);
        if (Math.abs(near.x - c.x) < 0.36 && Math.abs(near.z - c.z) < 0.36 && Math.abs(near.y - c.y) < 0.9) {
          this.burstBlue(near, seg.clone().negate(), 16);
          this.shake = Math.max(this.shake, 0.45);
          p.hit(BOSS_NAME, a.clone());
          return true;
        }
      }
      const h = this.trace(a, seg, len, false);
      if (h) {
        this.burstBlue(h.point, h.normal, 14);
        this.ctx.audio.electricCrackle(h.point.distanceTo(p.position));
        return true;
      }
      return false;
    });
    // His goo: whatever's in front of it
    this.goo.update(dt, this.t, (s, a, b) => {
      seg.subVectors(b, a);
      const len = seg.length();
      if (len < 1e-5) return false;
      seg.divideScalar(len);
      const h = this.trace(a, seg, len, true);
      if (!h) return false;
      this.gooHit(s, h, seg);
      return true;
    });
  }

  private gooHit(s: GlowShot, h: Hit, dir: THREE.Vector3): void {
    this.drops.burst(h.point, h.normal, 18, 3.2, GOO);
    this.ctx.audio.gooSplat(h.point.distanceTo(this.player.position));
    if (h.kind === 'hound' && h.hound) this.hurtHound(h.hound, s.damage, h.point, dir);
    else if (h.kind === 'boss') this.hurtBoss(s.damage * 0.9, h.point, dir, !!h.head);
    else this.decals.place('blood', h.point, h.normal, 0.35);
  }

  private burstBlue(at: THREE.Vector3, n: THREE.Vector3, count: number): void {
    this.drops.burst(at, n, count, 3.5, 0x6ad8ff);
    this.particles.electricSparks(at, 6);
  }

  // ============================================================ ballistics

  /**
   * What's first along a ray, within `far`: the ground (marched, the
   * terrain's too big to raycast), a tree trunk or boulder, the level's
   * meshes, and (with `creatures`) the hounds and the big one.
   */
  private trace(o: THREE.Vector3, dir: THREE.Vector3, far: number, creatures: boolean): Hit | null {
    let best: Hit | null = null;
    // ---- The ground: step along it till under, then halve back to the surface
    {
      const step = 0.6;
      let prev = 0;
      for (let t = step; t <= far + step; t += step) {
        const tt = Math.min(t, far);
        const x = o.x + dir.x * tt;
        const y = o.y + dir.y * tt;
        const z = o.z + dir.z * tt;
        if (y < groundY(x, z)) {
          let lo = prev;
          let hi = tt;
          for (let k = 0; k < 8; k++) {
            const m = (lo + hi) / 2;
            if (o.y + dir.y * m < groundY(o.x + dir.x * m, o.z + dir.z * m)) hi = m;
            else lo = m;
          }
          const pt = o.clone().addScaledVector(dir, hi);
          const e = 0.3;
          const n = V(groundY(pt.x - e, pt.z) - groundY(pt.x + e, pt.z), 2 * e, groundY(pt.x, pt.z - e) - groundY(pt.x, pt.z + e)).normalize();
          best = { dist: hi, point: pt, normal: n, kind: 'terrain' };
          break;
        }
        prev = tt;
        if (tt >= far) break;
      }
    }
    // ---- Trunks and boulders: upright cylinders
    const lim = best ? best.dist : far;
    const hd = Math.hypot(dir.x, dir.z);
    if (hd > 1e-4) {
      const ux = dir.x / hd;
      const uz = dir.z / hd;
      let bestT = lim;
      let bt: TreeTrunk | null = null;
      for (const t of this.level.trunks) {
        const rx = t.x - o.x;
        const rz = t.z - o.z;
        const along = rx * ux + rz * uz;
        if (along < 0 || along / hd > bestT + t.r) continue;
        const perp = Math.abs(rx * uz - rz * ux);
        if (perp > t.r) continue;
        const h = (along - Math.sqrt(t.r * t.r - perp * perp)) / hd;
        if (h < 0 || h >= bestT) continue;
        const y = o.y + dir.y * h;
        const gy = groundY(t.x, t.z);
        if (y < gy || y > gy + t.h) continue;
        bestT = h;
        bt = t;
      }
      if (bt) {
        const pt = o.clone().addScaledVector(dir, bestT);
        best = { dist: bestT, point: pt, normal: V(pt.x - bt.x, 0, pt.z - bt.z).normalize(), kind: 'trunk' };
      }
    }
    // ---- Meshes
    this.raycaster.set(o, dir);
    this.raycaster.far = best ? best.dist : far;
    const w = this.raycaster.intersectObjects(this.level.shootables, false).find((h) => h.distance > 0.02);
    if (w) {
      const n = (w.face?.normal ?? V(0, 1, 0)).clone().transformDirection(w.object.matrixWorld);
      best = { dist: w.distance, point: w.point.clone(), normal: n, kind: 'world' };
    }
    if (creatures) {
      this.raycaster.far = best ? best.dist : far;
      const targets: THREE.Object3D[] = this.boss.alive ? this.houndHits.concat(this.boss.hitMeshes as THREE.Mesh[]) : this.houndHits;
      const c = this.raycaster.intersectObjects(targets, false)[0];
      if (c) {
        const hound = c.object.userData.hound as Hound | undefined;
        best = {
          dist: c.distance,
          point: c.point.clone(),
          normal: dir.clone().negate(),
          kind: hound ? 'hound' : 'boss',
          hound,
          head: !!c.object.userData.head
        };
      }
    }
    return best;
  }

  /** Every round of his: what it hits, and what that does. */
  protected castBullet(origin: THREE.Vector3, dir: THREE.Vector3, shooter: Enemy | null): THREE.Vector3 {
    const h = this.trace(origin, dir, 120, shooter === null);
    if (!h) return origin.clone().addScaledVector(dir, 120);
    const gun = this.arsenal.firing;
    const dmg = gun === 'shotgun' ? 0.5 : gun === 'pistol' ? 1.5 : 1;
    if (h.kind === 'hound' && h.hound) this.hurtHound(h.hound, dmg * (h.head ? 1.6 : 1), h.point, dir);
    else if (h.kind === 'boss') this.hurtBoss(dmg, h.point, dir, !!h.head);
    else {
      const tint = h.kind === 'terrain' ? 0xc8c49a : h.kind === 'trunk' ? 0x5a4a40 : 0xa8a49a;
      this.particles.concreteChips(h.point, h.normal, tint);
      if (h.kind !== 'trunk') this.decals.place('bullethole', h.point, h.normal);
      if (h.kind === 'world') this.ctx.audio.ricochet(h.point.distanceTo(this.player.position));
    }
    return h.point;
  }

  protected killEnemy(): void {}

  // ============================================================ the harvest

  private updateHarvestPrompt(): void {
    if (this.boss.alive || this.harvested || this.phase !== 'play' || !this.player.alive) return;
    if (this.boss.deadT < 2) return;
    const pp = this.player.position;
    let best = -1;
    let bd = 3.6;
    for (const i of [0, 1]) {
      const s = this.boss.shoulder(i);
      const d = Math.hypot(s.x - pp.x, s.z - pp.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) {
      this.hud.setPrompt(null);
      return;
    }
    this.hud.setPrompt('[ E ] HARVEST THE ARM');
    if (this.ctx.input.wasPressed('KeyE')) this.startHarvest(best);
  }

  private startHarvest(i: number): void {
    this.phase = 'harvest';
    this.phaseT = 0;
    this.harvestArm = i;
    this.hud.setPrompt(null);
    this.player.cinematic = true;
    this.cinema(true);
    const a = this.arsenal;
    for (const v of a.all) v.stow = 1;
    a.knifeActive = false;
    a.knifeWanted = false;
    a.knifeStow = 1;
    this.knife.stow = 1;
    this.harvestFrom.p.copy(this.player.camera.position);
    this.harvestFrom.q.copy(this.player.camera.quaternion);
    this.blaster.stow = 1;
    this.blaster.grip = 0;
    this.severedArm = null;
  }

  /**
   * Down beside the arm. Three cuts at the joint with the karambit and it
   * comes away; it writhes and draws itself in, smaller; his left hand
   * takes it, brings it to his right forearm and lets it slide on, and its
   * feelers close round his arm.
   */
  private updateHarvest(dt: number): void {
    const t = this.phaseT;
    const b = this.boss;
    const i = this.harvestArm;
    const cam = this.player.camera;
    const H = this.hands;
    const sh = b.shoulder(i);
    // ---- The camera: in close, down over the joint; then up again, looking at his arm
    const pp = this.player.position;
    const away = V(pp.x - sh.x, 0, pp.z - sh.z).normalize();
    // (close enough for his arm to reach the joint; off to the side so the shoulder doesn't fill the view)
    const side = V(-away.z, 0, away.x);
    const kneel = sh.clone().addScaledVector(away, 0.95).addScaledVector(side, 0.25).add(V(0, 0.6, 0));
    const look = sh.clone().add(V(0, -0.12, 0)).addScaledVector(side, -0.05);
    const kIn = smooth(t / 1.0);
    const kOut = smooth((t - 3.9) / 0.8);
    const stand = pp.clone().add(V(0, 1.63, 0));
    cam.position.lerpVectors(this.harvestFrom.p, kneel, kIn).lerp(stand, kOut);
    const m = new THREE.Matrix4().lookAt(cam.position, look, V(0, 1, 0));
    const qLook = new THREE.Quaternion().setFromRotationMatrix(m);
    // Standing again: looking ahead and down at his own arm
    const yaw = Math.atan2(-away.x, -away.z);
    const qArm = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, yaw, 0, 'YXZ'));
    cam.quaternion.copy(this.harvestFrom.q).slerp(qLook, kIn).slerp(qArm, kOut);
    cam.updateMatrixWorld(true);
    // ---- The knife: up, three cuts across the joint, away
    // Where the cuts go: just down the arm from the joint (lower in his view, so his arm stays out of it)
    const cutAt = this.severedArm ? sh.clone() : b.arms[i].root.localToWorld(V(0, 0, 0.45));
    const shC = cam.worldToLocal(cutAt.clone());
    const kUp = smooth((t - 0.5) / 0.4) * (1 - smooth((t - 3.0) / 0.4));
    H.knifeRoot.visible = kUp > 0.01;
    const cuts = [1.05, 1.6, 2.2];
    let swing = -1;
    for (const c of cuts) if (t >= c && t < c + 0.42) swing = (t - c) / 0.42;
    const rest = V(0.22, -0.3, -0.42);
    const hand = H.knifeHand;
    if (swing >= 0) {
      const s = smooth(swing / 0.45);
      const back = smooth((swing - 0.55) / 0.45);
      // At arm's length, across the line to the joint: on screen the blade goes through it
      const k = 0.47 / Math.max(0.3, -shC.z);
      const cx = shC.x * k;
      const cy = shC.y * k;
      const a0 = V(cx + 0.2, cy + 0.11, -0.42);
      const a1 = V(cx - 0.02, cy - 0.12, -0.47);
      hand.position.lerpVectors(a0, a1, s).lerp(rest, back);
      hand.rotation.set(-0.3 - 0.9 * s, 0.3, 0.9 - 1.6 * s);
    } else {
      hand.position.copy(rest).add(V(0, -0.5 * (1 - kUp), 0));
      hand.rotation.set(-0.4, 0.2, 0.3);
    }
    for (const [k, c] of cuts.entries()) {
      if (t - dt < c + 0.15 && t >= c + 0.15) {
        this.drops.burst(cutAt, away.clone().setY(0.6), 26, 3.2, BOSS_BLOOD);
        this.ctx.audio.knifeStab();
        this.ctx.audio.fleshHit();
        this.shake = Math.max(this.shake, 0.35);
        if (k === cuts.length - 1) {
          this.severedArm = b.sever(i, this.scene);
          this.armS0 = this.severedArm.scale.x;
          this.ctx.audio.squelchPop();
        }
      }
    }
    // ---- The arm, off: it writhes and draws itself in to the size of his forearm
    const arm = this.severedArm;
    if (arm && t < 3.85) {
      const k = smooth((t - 2.4) / 1.1);
      // (to the blaster's size: its arm is the same shape, 0.62 m to the boss's 2.4)
      arm.scale.setScalar(this.armS0 + (0.62 / 2.4 - this.armS0) * k);
      arm.rotation.z += Math.sin(t * 17) * 0.04;
      arm.rotation.x += Math.sin(t * 11) * 0.02;
      // Falling away from the joint, toward him, where he can reach it
      const near = cam.position.clone().addScaledVector(cam.getWorldDirection(new THREE.Vector3()), 0.75);
      near.y = Math.max(groundY(near.x, near.z) + 0.2, cam.position.y - 0.65);
      arm.position.lerp(near, Math.min(1, dt * 2.2) * k);
    }
    // ---- The left hand: out to it, takes it, brings it in
    const piece = this.blaster.arm.root;
    const lIn = smooth((t - 3.1) / 0.5);
    H.leftRoot.visible = t > 3.0 && t < 6.2;
    let closed = 0;
    if (H.leftRoot.visible) {
      const restL = V(-0.25, -0.45, -0.3);
      if (t < 3.65 && arm) {
        const target = cam.worldToLocal(arm.localToWorld(V(0, 0, 1.2)));
        H.leftHand.position.lerpVectors(restL, target, lIn);
        H.leftHand.rotation.set(-0.6, 0.3, -0.4);
      } else {
        if (arm && arm.visible) {
          // Taken: the arm in the world gone, the blaster's own piece in his hand instead
          arm.visible = false;
          H.leftHand.add(piece);
          // Held round its middle, running up out of his fist
          piece.rotation.set(-Math.PI / 2, 0, 0);
          piece.position.set(0, -0.3, 0);
          this.ctx.audio.squelchPop();
        }
        closed = 1;
        // Up in front of him (as the camera rises), then over to his right forearm
        // Low and forward: not across his face
        const carry = V(0.0, -0.3, -0.52);
        const kC = smooth((t - 3.7) / 0.9);
        H.leftHand.position.lerp(carry, Math.min(1, dt * 6) * (0.4 + kC));
        H.leftHand.rotation.set(-0.35, 0.6 * kC, -0.2 - 0.8 * kC);
        if (t > 4.7 && piece.parent === H.leftHand) {
          // Slide it on
          this.blaster.hand.attach(piece);
          this.harvestFrom2.p.copy(piece.position);
          this.harvestFrom2.q.copy(piece.quaternion);
          this.ctx.audio.squelchPop();
        }
        if (t > 4.7) {
          const kS = smooth((t - 4.7) / 0.7);
          const seat = new THREE.Object3D();
          this.blaster.seat(seat);
          piece.position.lerpVectors(this.harvestFrom2.p, seat.position, kS);
          piece.quaternion.copy(this.harvestFrom2.q).slerp(seat.quaternion, kS);
          H.leftHand.position.add(V(-0.6, -0.4, 0.2).multiplyScalar(dt * smooth((t - 5.3) / 0.4) * 1.5));
          closed = 1 - smooth((t - 5.2) / 0.2);
        }
      }
    }
    // ---- His right fist: up, out, waiting for it
    if (t > 3.8) {
      this.blaster.stow = Math.max(0, 1 - smooth((t - 3.8) / 0.7));
      this.blaster.grip = smooth((t - 5.3) / 1.0);
      this.blaster.update(dt, this.player);
      if (t > 5.3 && t - dt <= 5.3) {
        this.ctx.audio.groan(0.6);
        this.ctx.audio.electricCrackle(0);
        this.shake = Math.max(this.shake, 0.6);
      }
      if (t > 5.4 && t < 6.4 && Math.random() < 0.3) this.drops.burst(this.blaster.muzzleWorld(), V(0, 0.5, 0), 2, 1, GOO);
    }
    H.update(closed);
    if (t > 6.6) this.endHarvest();
  }
  private harvestFrom2 = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private armS0 = 1;

  private endHarvest(): void {
    this.harvested = true;
    this.phase = 'play';
    this.phaseT = 0;
    const p = this.player;
    // Back in his own head where the camera's looking
    const e = new THREE.Euler().setFromQuaternion(p.camera.quaternion, 'YXZ');
    p.yaw = e.y;
    p.pitch = e.x;
    p.cinematic = false;
    this.cinema(false);
    this.hands.knifeRoot.visible = false;
    this.hands.leftRoot.visible = false;
    this.blaster.grip = 1;
    // Make sure the piece is seated
    const piece = this.blaster.arm.root;
    if (piece.parent !== this.blaster.hand) this.blaster.hand.add(piece);
    this.blaster.seat(piece);
    const a = this.arsenal;
    a.hasBlaster = true;
    a.knifeWanted = true;
    a.knifeActive = true;
    a.side = 'blaster';
    a.sideWant = 'blaster';
    a.knifeStow = 0;
    a.showInventory();
    this.ctx.audio.itemGet();
    this.setObjective('REACH THE EXIT PORTAL');
    this.hint('ALIEN BLASTER — HOLD [LMB] · [5] TO SWITCH TO IT', 6);
    this.ctx.audio.portalHum();
    this.ctx.audio.startTrackMusic('audio/dark-amb.mp3', 0, 0, 0.45, 3);
    // And more of them, between him and the way out
    this.later(2.5, () => this.spawnPack(this.packs[3]));
  }

  // ============================================================ the portal

  private updatePortal(dt: number): void {
    const P = this.level.portal;
    const on = this.harvested;
    const u = P.disc.uniforms;
    u.uT.value = this.t;
    u.uK.value += ((on ? 1 : 0.2) - u.uK.value) * Math.min(1, dt * 1.5);
    this.portalLight.intensity = 3 + 22 * u.uK.value + Math.sin(this.t * 3) * 2;
    if (!on || this.phase !== 'play' || !this.player.alive) return;
    const d = Math.hypot(this.player.position.x - P.at.x, this.player.position.z - P.at.z);
    if (d < 2.3) this.finish();
  }

  private finish(): void {
    this.phase = 'end';
    this.phaseT = 0;
    this.player.cinematic = true;
    this.cinema(true);
    this.ctx.audio.portalHum();
    this.ctx.audio.revealSting();
    this.fadeEl.style.transition = 'opacity 0.5s';
    this.fadeEl.style.background = '#e8fbff';
    this.fadeEl.style.opacity = '1';
    this.later(1.0, () => (this.card.style.opacity = '1'));
    this.later(7.5, () => this.ctx.bus.emit(Events.Level16Complete));
  }

  // ============================================================ progress

  private updateCheckpoints(): void {
    const p = this.player.position;
    if (!this.player.alive || this.phase !== 'play') return;
    let c = this.checkpoint;
    if (c < 2 && this.hasTablet && p.z < CLIFF_Z - 2 && p.y > 3.8) c = 2;
    if (c < 3 && p.z < MASSIF.z0 - 14 && !inLake(p.x, p.z)) c = 3;
    if (c !== this.checkpoint) this.checkpoint = c;
  }

  private updateHints(dt: number): void {
    const p = this.player.position;
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.style.opacity = '0';
    }
    if (this.phase !== 'play') return;
    if (!this.cliffHinted && this.hasTablet && p.z < CLIFF_Z + 7 && p.z > CLIFF_Z && p.y < 3) {
      this.cliffHinted = true;
      this.hint('TOO HIGH TO CLIMB — SHOTGUN [2], JUMP, LOOK STRAIGHT DOWN AND [RMB] A PRESSURE SHOT', 9);
    }
    if (this.tabletHinted === 1 && p.z < 18 && p.z > 6 && p.y > 3.5) {
      this.tabletHinted = 2;
      this.hint('THE ROCK BLOCKS THE VALLEY — THE WAY ON IS UNDER IT, THROUGH THE WATER', 7);
    }
  }

  private updateAtmosphere(dt: number): void {
    const L = this.level;
    const fog = this.scene.fog as THREE.FogExp2;
    const uw = this.underwater;
    fog.color.lerp(uw ? Level16Scene.FOG_WATER : Level16Scene.FOG_AIR, uw ? 1 : Math.min(1, dt * 6));
    fog.density = uw ? 0.13 : fog.density + (0.011 - fog.density) * Math.min(1, dt * 6);
    this.murk.style.opacity = uw ? '1' : '0';
    this.hemi.intensity = uw ? 0.5 : 2.4;
    this.sun.intensity = uw ? 0.4 : 2.6;
    // The forest lost in the haze isn't drawn
    const pz = this.player.camera.position.z;
    const px = this.player.camera.position.x;
    for (const c of L.chunks) {
      const s = c.boundingSphere;
      if (s) c.visible = Math.hypot(s.center.x - px, s.center.z - pz) - s.radius < 190;
    }
    this.underLoop?.set(uw ? 1 : 0);
    L.water.uniforms.uT.value = this.t;
    L.water.uniforms.fogColor.value.copy(fog.color);
    L.water.uniforms.fogDensity.value = fog.density;
    L.sky.uniforms.uT.value = this.t;
    for (const [i, s] of L.specimens.entries()) s.rotation.y = Math.sin(this.t * 0.4 + i) * 0.4;
    // Bubbles breaking the surface here and there near him
    this.bubbleT -= dt;
    if (this.bubbleT <= 0) {
      this.bubbleT = 0.12;
      const pp = this.player.position;
      const spot = L.bubbleSpots[Math.floor(Math.random() * L.bubbleSpots.length)];
      if (Math.hypot(spot.x - pp.x, spot.z - pp.z) < 60) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * spot.r;
        this.drops.burst(V(spot.x + Math.cos(a) * r, spot.y + 0.02, spot.z + Math.sin(a) * r), V(0, 1, 0), 3, 0.9, 0x9aff6a);
      }
    }
    // The planets turn, very slowly
    L.planets.forEach((pl, i) => (pl.rotation.y = this.t * 0.004 * (i + 1)));
  }

  private splash(at: THREE.Vector3, n: number): void {
    this.drops.burst(at, V(0, 1, 0), n, 3, 0x7aff5a);
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
  private later(sec: number, fn: () => void): void {
    this.timers.push({ at: this.t + sec, fn });
  }

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
    if (e.code === 'Escape' && this.phase === 'end') this.ctx.bus.emit(Events.ReturnToMenu);
  }

  private restart(): void {
    this.ctx.bus.emit(Events.RestartLevel16, { checkpoint: this.checkpoint });
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}
