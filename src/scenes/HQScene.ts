import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { HQBuilder, type HQData, type Post, type HQSpawn } from '../environment/HQBuilder';
import { crewVan, type VanRig } from '../environment/VanProps';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { Debris } from '../fx/Debris';
import { Storm } from '../fx/Storm';
import { FPSPlayer } from '../entities/FPSPlayer';
import { Arsenal, loadoutFor, type Gun } from '../entities/Arsenal';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { DropKickViewmodel } from '../entities/DropKickViewmodel';
import { Enemy } from '../entities/Enemy';
import { EnemyAI, type CoverSpot } from '../entities/EnemyAI';
import { armWithAK, rackAK } from '../entities/AkModel';
import { CarSystem } from '../entities/CarSystem';
import { Rockets } from '../entities/Rockets';
import { OutpostTower, type TurretTarget } from '../entities/OutpostTower';
import { LauncherViewmodel, launcherModel } from '../entities/LauncherViewmodel';
import { GrenadeThrow, Grenades } from '../entities/Grenades';
import { CrewAI, type CrewTarget } from '../entities/CrewAI';
import { JetpackTrooper } from '../entities/JetpackTrooper';
import { FootPaths, WALK } from '../entities/FootPaths';
import { RaviVisual, HAND, type RaviRig, type HandShape } from '../entities/RaviVisual';
import { FPSHUD } from '../ui/FPSHUD';
import { track, smooth, clamp01, yawPitchTo, wrapAngle } from './cutscene';

/**
 * HQScene — Level 12: the assault on the Exterminator Collective's
 * headquarters, at night, in a storm.
 *
 *  1. Arrival. The van comes up the road and through the security gates —
 *     both leaves smashed open on their hinges — and slides to a stop. The towers' guns open up on it. From his seat
 *     Ravi watches the door go back and the crew pile out; then he follows.
 *  2. The towers. Sanjay hands him the rocket launcher. Four outpost towers,
 *     an automated turret on each; one rocket brings one down. The crew take
 *     cover round the van and fight; the Collective's men come at them
 *     across the lot.
 *  3. The advance. Towers down, the launcher goes and the objective is the
 *     building: the crew run up the lot from cover to cover, fighting.
 *  4. At the foot of the stairs Sanjay catches him and points out the hole
 *     blown in the wall under them: Ravi goes in alone; they'll keep the
 *     Collective busy out here and work their way in.
 *  5. He walks to the hole. In he goes; a last shot of him slipping into the
 *     dark with the fight behind him; to be continued.
 *
 * The crew don't die. Ravi does: back to the start of the phase he died in
 * (the towers, without the gate again; or the advance, the towers still down).
 */

type Phase = 'arrive' | 'towers' | 'advance' | 'breach' | 'hole' | 'ending';

/** What it takes to put one of the Collective's men down. */
const AGENT_HP = 80;
const ARMOURED_HP = 120;
/** The jetpack men: no plates (they'd never get off the ground), and one good burst brings them down. */
const JET_HP = 70;
const AK_DAMAGE: Record<string, number> = { torso: 25, arm: 18, leg: 18, head: 100 };
const GUN_SCALE: Record<Gun, number> = { rifle: 1, pistol: 1.2, shotgun: 0.45 };
const ARMOUR_LETS = { torso: 0.6, head: 0.5 };
/** The crew's rounds hurt them less than Ravi's: they're there to help, not to win it for him. */
const CREW_SCALE = 0.9;
/** A grenade going off: kills inside KILL, hurts Ravi inside HURT. */
const NADE_KILL = 4.4;
const NADE_HURT = 4.6;
const ROCKET_KILL = 5.2;
const ROCKET_HURT = 5.0;
/** A rocket landing this close to a tower's frame brings it down. */
const TOWER_REACH = 2.8;
/** How many of the Collective's dead stay on the ground before the oldest is cleared away. */
const MAX_CORPSES = 4;
/** How many of the advance's men have to go down before the crew blow the wall (of ADVANCE_QUOTA). */
const BREACH_KILLS = 15;
/** Where Sanjay fires the rocket at the wall from: off the side of the stairs, a clear line in under them. */
const SANJAY_FIRE = new THREE.Vector3(-24, 0, -176);
/** How often the dead drop a grenade. */
const DROP_CHANCE = 0.34;
/** How many of the Collective come at them in each phase, all of whom have to go down before they can move on. */
const TOWER_QUOTA = 24;
const ADVANCE_QUOTA = 22;
/**
 * The crew go up the lot a section at a time, as the Collective's men go
 * down: this many of them down in the towers phase and they move up to the
 * near cover, this many and on to the second row (the near towers down
 * sends them too). In the advance: this many down and on from the cover
 * past the second row to the far rows, this many and up to the stairs.
 * Each move waits for Ravi to be up with them.
 */
const TOWER_STEPS = [4, 10];
const ADVANCE_STEPS = [4, 9];
/** How far behind the crew's line Ravi can be and still count as with them. */
const WITH_CREW = 10;
/** The cover the in-between sections are made of: how far down the lot (z). */
const SECTION_A_Z = -50;
const SECTION_B_Z = -96;
/** Ravi's death: the song, and how long before a click can take him back (ms). */
const DEATH_SONG = 'audio/death.wav';
const DEATH_HOLD = 2500;
/** How far out in front of the fight's front line the Collective's men come in. */
const SPAWN_AHEAD = 18;
/** Ravi's flashlight, on (candela). */
const TORCH_ON = 28;
/** The arrival's beats (seconds). */
const T = {
  klaxon: 1.1,
  cutB: 2.3,
  impact: 2.62,
  stop: 5.75,
  cutC: 6.3,
  door: 6.5,
  crewOut: 6.9,
  raviUp: 9.4,
  hand: 12.6,
  reach: 12.95,
  take: 13.4,
  control: 14.7
};
/** When each of the crew gets up: five of them first, then Ravi, then the last two at his back. */
const CREW_UP = [6.9, 7.3, 7.75, 8.2, 8.65, 11.3, 11.75];
const VAN_FROM = 64;
const VAN_SPEED = 22;

/** One of the Collective's men. */
interface Agent {
  e: Enemy;
  hp: number;
  armour: boolean;
  ai: EnemyAI | null;
  pooled: boolean;
  /** Seconds until he's told again where Ravi is (they press in on him, not wait to be found). */
  push: number;
}

/** A line of dialogue for the subtitles. */
interface Line {
  who: string;
  text: string;
  dur: number;
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export class HQScene extends CombatScene<HQData> {
  private arsenal!: Arsenal;
  private drink!: DrinkViewmodel;
  private dropKick!: DropKickViewmodel;
  private kickVictim: Enemy | null = null;
  private hud!: FPSHUD;
  private launcher!: LauncherViewmodel;
  /** The launcher is his for now (the towers), and whether it's the thing in his hands. */
  private launcherOwned = false;
  private launcherUp = false;
  private nadeVm!: GrenadeThrow;
  private grenades!: Grenades;
  private storm!: Storm;
  private towers: OutpostTower[] = [];
  private cars!: CarSystem;
  private debrisFx!: Debris;
  private rockets!: Rockets;
  private van!: VanRig;
  private paths!: FootPaths;
  private crew: Enemy[] = [];
  private crewAI: CrewAI[] = [];
  private sanjay!: Enemy;
  /** Each of the crew in the opening: their seat in the van, and whether they're out yet. */
  private cs = new Map<Enemy, { seat: THREE.Vector3; yaw: number; out: boolean; talked: boolean }>();
  private sanjayLauncher: THREE.Group | null = null;
  private agents: Agent[] = [];
  private agentOf = new Map<Enemy, Agent>();
  private spawned = 0;
  private spawnT = 0;
  /** At the wheel the whole time: he got them here and he's keeping the engine running. */
  private driver: Enemy | null = null;
  // ---- The jetpack men
  private jets: JetpackTrooper[] = [];
  private jetOf = new Map<Enemy, JetpackTrooper>();
  private jetLoops = new Map<JetpackTrooper, { setThrust(k: number): void; setDistance(m: number): void; stop(): void }>();
  /** Who brought each one down (Ravi, or the crew). */
  private jetByRavi = new Map<JetpackTrooper, boolean>();
  private jetT = 12;
  private jetsSpawned = 0;
  private jetWarned = false;
  /** The next bang somewhere out in the lot. */
  private boomT = 5;

  private phase: Phase = 'arrive';
  private phaseT = 0;
  private t = 0;
  private dead = false;
  private handedOff = false;
  private skipping = false;

  // ---- Lights and weather
  private hemi!: THREE.HemisphereLight;
  private moon!: THREE.DirectionalLight;
  private blast!: THREE.PointLight;
  private blastK = 0;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private rain: { set(k: number): void; stop(): void } | null = null;
  private klaxon: { set(k: number): void; stop(): void } | null = null;
  private shake = 0;
  private readonly bg = new THREE.Color(0x0c1018);
  private readonly bgFlash = new THREE.Color(0x485270);
  private readonly moonCol = new THREE.Color(0x8ea4d0);

  // ---- The gate
  /** Each leaf's swing open on its hinge (radians) and how fast it's going. */
  private gateL = { a: 0, w: 0 };
  private gateR = { a: 0, w: 0 };

  // ---- Ravi's flashlight: F, when there's nobody in reach to grab
  private torch!: THREE.SpotLight;
  private torchOn = false;
  /** Where the Collective's men take cover in the lot. */
  private coverSpots: CoverSpot[] = [];
  /** The Collective's men down in the towers phase (what moves the crew up). */
  private towerKills = 0;
  /** The crew's section in each phase (towers: 0 the van, 1 the near cover, 2 the second row; advance: 0 the second row, 1 the cover past it, 2 the far rows, 3 the stairs). */
  private towerSec = 0;
  private advSec = 0;
  /** The in-between sections' posts, picked out of the lot's cover; and which cover spot each post is. */
  private secA: Post[] = [];
  private secB: Post[] = [];
  private postSpot = new Map<Post, CoverSpot>();
  /** Seconds till Sanjay next calls Ravi up, when he's hanging back. */
  private nagT = 0;
  /** When he died (performance.now()), for the hold before a click restarts. */
  private deadAt = 0;

  // ---- Third-person Ravi for the cutscenes
  private ravi: RaviRig | null = null;
  private raviGun: THREE.Group | null = null;

  // ---- UI
  private ui!: HTMLElement;
  private banner!: HTMLElement;
  private objective!: HTMLElement;
  private subs!: HTMLElement;
  private fadeEl!: HTMLElement;
  private letterbox!: HTMLElement;
  private card!: HTMLElement;
  private skipEl!: HTMLElement;
  private marker!: HTMLElement;
  private markerText!: HTMLElement;
  private lines: (Line & { at: number })[] = [];
  private lineT = 0;
  private barkT = 8;
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);

  private ray = new THREE.Ray();
  /** Things to do a little later, on the scene's clock (so a paused or stepped scene keeps them in order). */
  private timers: { at: number; fn: () => void }[] = [];
  private later(sec: number, fn: () => void): void {
    this.timers.push({ at: this.t + sec, fn });
  }
  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();
  private static tmpC = new THREE.Vector3();
  private static tmpN = new THREE.Vector3();
  private static WHITE = new THREE.Color(1, 1, 1);

  /** `from`: 0 the gate crash, 1 the towers, 2 the advance. */
  constructor(ctx: GameContext, private from = 0) {
    super(ctx);
  }

  // ============================================================== lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    const renderer = this.ctx.engine.renderer;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMappingExposure = 1.3;
    this.scene.background = this.bg.clone();
    this.scene.fog = new THREE.FogExp2(this.bg.getHex(), 0.0052);

    this.level = new HQBuilder().build();
    const L = this.level;
    this.scene.add(L.group);
    this.world = this.createPhysicsWorld(L.colliders);

    const start = L.starts[Math.min(this.from, 3)];
    this.player = new FPSPlayer(start.pos.clone(), start.yaw, input, audio, bus);
    this.player.camera.far = 3200;
    this.player.camera.updateProjectionMatrix();
    this.scene.add(this.player.camera);
    // His flashlight. Made now, at nothing, and driven by intensity only: a
    // light added or hidden later changes the count every material's shader
    // is built for, and the whole lot would recompile mid-fight. Out past the
    // muzzle, so the gun isn't the brightest thing in it.
    this.torch = new THREE.SpotLight(0xffe6c0, 0, 48, Math.PI / 9, 0.45, 1.0);
    this.torch.position.set(0.06, -0.1, -0.7);
    this.torch.target.position.set(0.06, -0.18, -1.7);
    this.player.camera.add(this.torch);
    this.player.camera.add(this.torch.target);

    this.particles = new ParticleManager(this.scene, { smoke: 1000 });
    this.flashPool = new MuzzleFlashPool(this.scene, 3);
    Enemy.flashPool = this.flashPool;
    this.decals = new BloodDecalSystem(this.scene, { max: 180 });
    this.debrisFx = new Debris(this.particles, () => 0, 15);

    this.buildLights();
    this.buildEnvironmentMap();
    this.storm = new Storm(this.player.camera, () => this.player.camera.position, L.tower);
    this.storm.shelterMin.copy(L.shelter.min);
    this.storm.shelterMax.copy(L.shelter.max);
    this.storm.onThunder = (d) => audio.thunder(d);
    this.storm.onStrike = (s) => {
      if (s.close) this.shake = Math.max(this.shake, 0.4);
      else if (s.dist < 500) this.shake = Math.max(this.shake, 0.18);
    };
    this.scene.add(this.storm.group);

    // ---- The towers
    L.towers.forEach((site) => {
      const tw = new OutpostTower(site.pos, site.yaw);
      tw.particlesRef = this.particles;
      this.scene.add(tw.group);
      for (const c of tw.colliders) L.colliders.push(c);
      for (const s of tw.shootables) L.shootables.push(s);
      tw.onEvent = (e, at) => this.onTowerEvent(tw, e, at);
      tw.onShot = (from, to, tg) => this.turretShot(tw, from, to, tg);
      this.towers.push(tw);
    });
    // Their colliders weren't there when the physics world was built
    this.world = this.createPhysicsWorld(L.colliders);
    // Ravi's ragdoll goes in this world, the one that's stepped: hooked up
    // before it, his body went into the first one, never moved, and he died
    // stood in a T
    this.ragdollOnDeath(() => (this.launcherUp ? null : this.arsenal.held.stow < 0.5 ? this.arsenal.active : null));

    // ---- Parked cars
    this.cars = new CarSystem({ scene: this.scene, world: this.world, level: L, particles: this.particles, audio });
    for (const s of L.parked) this.cars.addParked(s);
    this.cars.settle();
    this.buildCoverSpots();
    this.secA = this.sectionPosts(SECTION_A_Z);
    this.secB = this.sectionPosts(SECTION_B_Z);
    // A few already burnt out from the fighting before they got here, three of them still alight
    {
      let seed = 4242;
      const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 8; i++) this.cars.burn(Math.floor(rnd() * this.cars.count), i < 3 ? Infinity : 0);
    }

    // ---- The van
    this.van = crewVan();
    this.van.light.removeFromParent();
    this.van.redLight.removeFromParent();
    for (const b of this.van.beams) {
      b.target.removeFromParent();
      b.removeFromParent();
    }
    this.van.headlights.emissiveIntensity = 2.4;
    this.van.body.add(this.headlampGlow());
    this.scene.add(this.van.group);
    this.paths = new FootPaths(() => 0);

    // ---- Guns, the launcher, grenades, the drink, the boot
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
    this.arsenal.grenades = 2;
    this.launcher = new LauncherViewmodel(this.player.camera);
    this.launcher.onEvent = (e) => {
      if (e === 'reloadStart') audio.launcherReload(0.2);
    };
    this.rockets = new Rockets(this.scene, this.particles, (a, b) => this.rocketHit(a, b));
    this.rockets.onBurst = (pos, dir) => {
      if (this.phase === 'breach' && !this.breached && pos.distanceTo(this.level.hole.centre) < 4.5) this.breachWall(false);
      this.explode(pos, dir, 'rocket');
    };
    this.nadeVm = new GrenadeThrow(this.player.camera);
    this.nadeVm.onPin = () => audio.grenadePin();
    this.nadeVm.onRelease = (from) => {
      const v = this.aimDir().multiplyScalar(15.5).add(V(0, 3.8, 0)).add(this.player.velocity);
      this.grenades.throw(from, v);
      audio.punchSwish();
    };
    this.grenades = new Grenades(this.scene, () => this.level.colliders);
    this.grenades.onExplode = (at) => this.explode(at, V(0, 1, 0), 'grenade');
    this.grenades.onBounce = (at) => audio.grenadeBounce(at.distanceTo(this.player.position));
    this.grenades.warm().forEach((o) => this.scene.add(o));
    this.drink = new DrinkViewmodel(this.player.camera);
    this.drink.onEvent = (e, i) => {
      if (e === 'crack') audio.canCrack();
      else if (e === 'gulp') audio.gulp(i);
      else if (e === 'heal') this.player.healFull();
      else if (e === 'crush') audio.canCrush();
      else if (e === 'toss') this.dropCan(this.drink.tossPose());
    };
    this.setupTakedown();
    this.dropKick = new DropKickViewmodel(this.player.camera);
    this.dropKick.onEvent = (e) => {
      if (e === 'launch') audio.kickWhoosh();
      else if (e === 'impact') {
        const victim = this.kickVictim?.alive ? this.kickVictim : this.kickTarget();
        this.kickVictim = null;
        if (!victim) return;
        this.dropKick.hit = true;
        this.dropKickEnemy(victim);
      } else if (e === 'land') audio.backLanding();
      else if (e === 'up') audio.scuff();
      else if (e === 'done') {
        this.player.cinematic = false;
        this.endKickRun();
      }
    };

    // ---- The crew
    this.buildCrew();
    this.buildRavi();

    // ---- HUD and the rest of the UI
    this.hud = new FPSHUD(this.ctx.uiRoot, bus, 0, this.player.maxHealth);
    this.hud.setCounter('TOWERS STANDING', 4);
    this.hud.setGrenades(this.arsenal.grenades);
    this.buildUI();

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }),
      bus.on(Events.PlayerDied, () => {
        this.dead = true;
        this.deathScene();
      })
    );
    document.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);

    this.rain = audio.rainLoop();
    this.klaxon = audio.klaxonLoop();

    if (this.from === 0) this.startArrival();
    else if (this.from === 1) this.startTowers(true);
    else if (this.from === 2) this.startAdvance(true);
    else this.startPastBreach();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    for (const a of this.agents) a.ai?.dispose();
    for (const l of this.jetLoops.values()) l.stop();
    this.jetLoops.clear();
    this.rain?.stop();
    this.klaxon?.stop();
    this.ctx.audio.stopBossMusic(1);
    this.ctx.audio.stopTrackMusic(0.4);
    const canvas = this.ctx.engine.renderer.domElement;
    canvas.style.transition = '';
    canvas.style.filter = '';
    document.removeEventListener('click', this.clickHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.hud.destroy();
    this.flashPool.dispose();
    this.ui.remove();
    this.cars.dispose();
    this.storm.dispose();
    this.envRT?.dispose();
    Enemy.flashPool = null;
    const renderer = this.ctx.engine.renderer;
    renderer.shadowMap.enabled = false;
    renderer.toneMappingExposure = 1.05;
  }

  // ================================================================= setup

  private buildLights(): void {
    this.hemi = new THREE.HemisphereLight(0x48546e, 0x14120f, 0.9);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(this.moonCol.getHex(), 0.5);
    this.moon.castShadow = true;
    const sh = this.moon.shadow;
    sh.mapSize.set(2048, 2048);
    const c = sh.camera as THREE.OrthographicCamera;
    c.left = -40;
    c.right = 40;
    c.top = 40;
    c.bottom = -40;
    c.near = 10;
    c.far = 400;
    sh.bias = -0.0012;
    sh.normalBias = 0.09;
    this.scene.add(this.moon, this.moon.target);
    this.blast = new THREE.PointLight(0xffa04a, 0, 48, 1.5);
    this.blast.position.set(0, -50, 0);
    this.scene.add(this.blast);
  }

  /** The reflections in the wet: the little sky-and-lamps scene baked once. */
  private buildEnvironmentMap(): void {
    const pmrem = new THREE.PMREMGenerator(this.ctx.engine.renderer);
    this.envRT = pmrem.fromScene(this.level.envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
  }

  /** What the van's headlamps throw on the wet road ahead of it: two long soft pools, added on. */
  private headlampGlow(): THREE.Object3D {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: 0x8a8070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const glow = new THREE.Group();
    for (const sx of [-1, 1]) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 16), mat);
      q.rotation.x = -Math.PI / 2;
      q.position.set(sx * 1.1, -0.38, -this.van.length / 2 - 8.5);
      glow.add(q);
    }
    return glow;
  }

  /** Sanjay, Dev and five more off the floor: kitted out, armed, in the back of the van to start. */
  private buildCrew(): void {
    const names: [string, number, { cap?: boolean; glasses?: boolean }][] = [
      ['SANJAY', 6, {}],
      ['DEV', 4, { cap: false, glasses: true }],
      ['MARCUS', 9, {}],
      ['OWEN', 7, { cap: false }],
      ['NIKHIL', 3, {}],
      ['TOMMY', 5, { cap: false }],
      ['RAJ', 2, { cap: false }]
    ];
    const L = this.level;
    for (const [name, idx, look] of names) {
      const e = new Enemy(V(0, -60, 0), 0, idx, { name, civilian: true });
      e.restyleCrew(look);
      e.wearCrewKit();
      e.setSerious();
      armWithAK(e);
      this.scene.add(e.root);
      this.crew.push(e);
      this.cs.set(e, { seat: new THREE.Vector3(), yaw: 0, out: false, talked: false });
      this.crewAI.push(
        new CrewAI(e, {
          waypoints: L.waypoints,
          colliders: L.colliders,
          clear: (a, b) => this.clearLine(a, b),
          targets: () => this.crewTargets(),
          shoot: (who, from, at, t) => this.crewShot(who, from, at, t),
          all: () => this.crew,
          avoid: () => (this.phase === 'arrive' ? this.player.camera.position : this.player.position)
        })
      );
    }
    this.sanjay = this.crew[0];
    // The wheelman: one more off the floor, kitted out like the rest, never leaves his seat
    const d = new Enemy(V(0, -60, 0), 0, 8, { name: 'WHEELMAN', civilian: true });
    d.restyleCrew({ cap: false });
    d.wearCrewKit();
    d.setSerious();
    this.driver = d;
    const stain = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.012), new THREE.MeshStandardMaterial({ color: 0xd88a86, roughness: 0.5 }));
    stain.position.set(-0.02, -0.06, -0.141);
    this.sanjay.addChestPatch(stain);
  }

  /** The wheelman in the driver's seat, hands on the wheel (the van's own frame). */
  private seatDriver(): void {
    const d = this.driver;
    if (!d) return;
    const v = this.van;
    const at = v.seats.driver;
    v.body.add(d.root);
    d.position.set(at.x, at.y - v.body.position.y, at.z);
    d.yaw = 0;
    d.root.rotation.y = 0;
    d.setWalk(0);
    d.setSitting(true, true);
    d.pose = { handR: V(0.17, 1.02, -0.42), handL: V(-0.17, 1.02, -0.42), curl: 0.85 };
  }

  /** Ravi's whole body, for the shots that see him: his AK slung on his back. */
  private buildRavi(): void {
    RaviVisual.whenReady(() => {
      const r = RaviVisual.rig('body');
      r.root.visible = false;
      for (const m of r.meshes) m.castShadow = true;
      this.scene.add(r.root);
      this.ravi = r;
      const gun = rackAK();
      gun.scale.setScalar(1);
      // Across his back, the muzzle up over his left shoulder
      gun.rotation.set(0, Math.PI / 2, 0);
      const holder = new THREE.Group();
      holder.add(gun);
      holder.position.set(0.02, 1.2, -0.17);
      holder.rotation.set(0, 0, 0.95);
      r.root.add(holder);
      this.raviGun = holder;
      this.poseRavi({});
    });
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="hq-obj" style="position:absolute;left:24px;top:84px;color:#e8f4ec;font-size:12px;letter-spacing:2px;
        text-shadow:0 1px 3px rgba(0,0,0,0.95);max-width:42vw;opacity:0;transition:opacity .5s"></div>
      <div class="hq-subs" style="position:absolute;left:50%;bottom:15vh;transform:translateX(-50%);max-width:70vw;text-align:center;
        color:#f2f2ee;font-size:17px;letter-spacing:.5px;text-shadow:0 1px 4px #000,0 0 10px rgba(0,0,0,.9);opacity:0;transition:opacity .25s"></div>
      <div class="intro-skip">[ ENTER ] SKIP</div>
      <div class="hq-marker" style="position:absolute;left:0;top:0;display:none;color:#ffd85e;font-size:12px;letter-spacing:2px;
        text-align:center;text-shadow:0 1px 3px #000,0 0 8px rgba(0,0,0,.8);pointer-events:none;white-space:nowrap">
        <span></span><div style="font-size:20px;line-height:1">▼</div></div>
      <div class="intro-fade" style="opacity:1"></div>
      <div class="hq-whiteout" style="position:absolute;inset:0;pointer-events:none;opacity:0;
        background:radial-gradient(ellipse at center, rgba(255,246,220,1) 0%, rgba(255,170,80,0.85) 60%, rgba(255,120,40,0.6) 100%)"></div>
      <div class="hq-card" style="position:absolute;inset:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;
        opacity:0;transition:opacity 1.2s;pointer-events:none;color:#e8e6df;letter-spacing:8px">
        <div style="font-size:13px;opacity:.6;letter-spacing:6px;margin-bottom:18px">LEVEL 12 — THE EXTERMINATOR COLLECTIVE</div>
        <div style="font-size:42px;font-weight:bold">TO BE CONTINUED</div>
      </div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.banner = el.querySelector('.intro-objective')!;
    this.objective = el.querySelector('.hq-obj')!;
    this.subs = el.querySelector('.hq-subs')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.card = el.querySelector('.hq-card')!;
    this.skipEl = el.querySelector('.intro-skip')!;
    this.marker = el.querySelector('.hq-marker')!;
    this.markerText = this.marker.querySelector('span')!;
    this.whiteout = el.querySelector('.hq-whiteout')!;
  }

  /** The objective: announced across the middle, then kept top left. */
  private setObjective(text: string): void {
    this.objective.textContent = text;
    this.objective.style.opacity = text ? '1' : '0';
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    if (text) this.banner.classList.add('show');
  }

  private cinema(on: boolean): void {
    this.letterbox.classList.toggle('open', !on);
    if (on) this.hud.hide();
    else this.hud.show();
    this.objective.style.display = on ? 'none' : '';
  }

  /** Lines to play, one after another, from now. */
  private say(lines: Line[], at = 0): void {
    let t = this.t + at;
    const last = this.lines[this.lines.length - 1];
    if (last) t = Math.max(t, last.at + last.dur);
    for (const l of lines) {
      this.lines.push({ ...l, at: t });
      t += l.dur;
    }
  }

  private updateSubs(): void {
    while (this.lines.length && this.t > this.lines[0].at + this.lines[0].dur) this.lines.shift();
    const l = this.lines[0];
    const on = !!l && this.t >= l.at;
    if (on) {
      const html = `<span style="color:#ffd85e;letter-spacing:2px;font-size:13px">${l.who}</span>&nbsp;&nbsp;${l.text}`;
      if (this.subs.innerHTML !== html) this.subs.innerHTML = html;
    }
    this.subs.style.opacity = on ? '1' : '0';
  }

  // =============================================================== phases

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
    // A wave still coming out belongs to the phase that called it
    this.waveQueue.length = 0;
  }

  private get cutscene(): boolean {
    return this.phase === 'arrive' || this.phase === 'breach' || this.phase === 'ending';
  }

  private get playable(): boolean {
    return this.player.alive && !this.cutscene;
  }

  // ------------------------------------------------------------- 1 arrival

  private startArrival(): void {
    this.setPhase('arrive');
    this.cinema(true);
    this.player.cinematic = true;
    // The van on the road, coming
    this.placeVan(0);
    this.seatDriver();
    // The crew in the back, Ravi up front on the left bench
    const v = this.van;
    const seats = [v.seats.right[0], v.seats.left[2], v.seats.right[1], v.seats.left[3], v.seats.right[2], v.seats.left[4], v.seats.right[3]];
    this.crew.forEach((e, i) => {
      const yaw = seats[i].x > 0 ? Math.PI / 2 : -Math.PI / 2;
      v.body.add(e.root);
      e.position.set(seats[i].x, seats[i].y - v.body.position.y, seats[i].z);
      e.yaw = yaw;
      e.root.rotation.y = yaw;
      e.setSitting(true, true);
      e.setRestCarry(true, true);
      this.cs.set(e, { seat: seats[i], yaw, out: false, talked: false });
    });
    // Sanjay's got the launcher across his knees
    const lm = launcherModel();
    this.sanjayLauncher = lm.group;
    this.sanjay.root.add(lm.group);
    lm.group.position.set(0, 0.72, -0.32);
    lm.group.rotation.set(0, Math.PI / 2, 0);
    this.sanjay.slingWeapon(true);
    this.arsenal.equip('rifle', 1);
    this.fadeEl.style.transition = 'opacity 1.2s';
    this.fadeEl.style.opacity = '0';
    this.say([
      { who: 'SANJAY', text: 'Gate! Hold on to something!', dur: 2.2 },
      { who: 'DEV', text: 'Towers are tracking us — heads down!', dur: 2.6 }
    ], 0.6);
  }

  /** Where the van is `t` seconds into the arrival: down the road, through the gate, braking hard, sliding to a stop. */
  private placeVan(t: number): void {
    const v = this.van;
    const L = this.level;
    const stop = L.vanStop;
    const zImp = 4.3;
    let z: number;
    let speed: number;
    if (t < T.impact) {
      z = VAN_FROM - VAN_SPEED * t;
      speed = VAN_SPEED;
    } else {
      // After the gate: braking from 17 m/s to rest at the stop line
      const v0 = 17;
      const dist = zImp - stop.pos.z;
      const dur = (2 * dist) / v0;
      const u = Math.min(1, (t - T.impact) / dur);
      const s = dist * (1 - (1 - u) * (1 - u));
      z = zImp - s;
      speed = v0 * (1 - u);
    }
    const k = smooth((zImp - z) / (zImp - stop.pos.z));
    v.group.position.set(0.3 + (stop.pos.x - 0.3) * k, 0, z);
    v.group.rotation.y = stop.yaw * smooth((k - 0.35) / 0.65) + 0.04 * Math.sin(t * 9) * (t > T.impact && t < T.stop ? 1 : 0);
    // The body: nose dips under the brakes, rolls into the slide, rocks at the hit
    const hit = t > T.impact ? Math.exp(-(t - T.impact) * 5) : 0;
    const braking = t > T.impact && t < T.stop + 0.4 ? 1 : 0;
    v.body.rotation.x = -0.05 * braking * (speed > 1 ? 1 : 0) + 0.06 * hit * Math.sin((t - T.impact) * 30) + (t > T.stop ? 0.025 * Math.exp(-(t - T.stop) * 4) * Math.sin((t - T.stop) * 14) : 0);
    v.body.rotation.z = -0.04 * k * braking;
    for (const w of v.wheels) w.rotation.x -= (speed * (1 / 60)) / 0.4;
  }

  private updateArrival(dt: number): void {
    const t = this.phaseT;
    const L = this.level;
    const { audio } = this.ctx;
    if (t < T.control + 0.5) this.placeVan(Math.min(t, T.stop + 1));
    this.skipEl.classList.toggle('gone', t > T.control - 1);
    if (t >= T.klaxon && t - this.dtLast < T.klaxon) {
      this.klaxon?.set(1);
      for (const tw of this.towers) tw.onEvent?.('servo', tw.gunWorld());
    }
    // ---- Through the gate
    if (t >= T.impact && t - this.dtLast < T.impact) this.crashGate();
    this.updateGate(dt);
    // The towers on the van, then on whoever's getting out
    if (t > 3.4) {
      for (const tw of this.towers) {
        if (!tw.alive) continue;
        if (!tw.target || Math.random() < dt * 0.4) {
          const pick = t < T.crewOut + 1 || Math.random() < 0.5 ? null : this.crew[Math.floor(Math.random() * this.crew.length)];
          tw.target = pick && pick.root.parent === this.scene ? { pos: pick.position.clone().setY(1.3), ravi: false } : { pos: this.van.group.position.clone().add(V((Math.random() - 0.5) * 3, 1.6, (Math.random() - 0.5) * 6)), ravi: false };
        }
      }
    }
    // ---- In the van: the door, the crew out, then him
    if (t >= T.stop + 0.2 && !this.vanCol) this.vanCollider();
    if (t >= T.door) this.van.setDoor(smooth((t - T.door) / 0.8));
    if (t >= T.door && t - this.dtLast < T.door) audio.carDoor(true, 1);
    const v = this.van;
    this.crew.forEach((e, i) => {
      if (t >= CREW_UP[i] && t - this.dtLast < CREW_UP[i]) this.walkOut(e, i);
    });
    this.paths.update(dt);
    this.crewOut();
    for (let i = 0; i < this.crew.length; i++) if (this.cs.get(this.crew[i])!.out && this.crew[i] !== this.sanjay) this.crewAI[i].update(dt);
    // ---- The camera
    const cam = this.player.camera;
    const A = HQScene.tmpA;
    const B = HQScene.tmpB;
    if (t < T.cutB) {
      // Beside the van on the road, the gate coming
      const vp = v.group.position;
      A.set(vp.x - 3.4, 1.9, vp.z + 2.5 - t * 0.6);
      B.set(vp.x - 0.4, 1.4, vp.z - 22);
      this.setCam(A, B, 58);
    } else if (t < T.cutC) {
      // In the lot, low, looking back at the gate: it comes through, and the camera swings round after it
      A.set(-6.2, 1.1, -19.5);
      const vp = v.group.position;
      const follow = smooth((t - T.impact + 0.15) / 0.6);
      B.set(THREE.MathUtils.lerp(0, vp.x, follow), THREE.MathUtils.lerp(2.6, 1.3, follow), THREE.MathUtils.lerp(1, vp.z - 1.5, follow));
      this.setCam(A, B, THREE.MathUtils.lerp(44, 56, follow));
    } else {
      this.arrivalPOV(t);
    }
    // ---- The hand-over
    if (t >= T.hand) this.updateHandoff(t);
    if (t >= T.control) this.startTowers(false);
  }

  private dtLast = 0;

  /** The gate takes the van: both leaves flung open on their hinges, never quite the same twice. */
  private crashGate(): void {
    const L = this.level;
    const g = L.gate;
    g.collider.disabled = true;
    this.gateL.w = 6.6 + Math.random() * 2;
    this.gateR.w = 6.6 + Math.random() * 2;
    const at = V(0, 1.4, 0);
    this.particles.sparks(at, V(0, 0.4, -1), 60);
    this.particles.concreteChips(at, V(0, 0, -1), 0x5a5e64);
    this.particles.dust(V(0, 0.1, -1), 4, 1.4);
    this.ctx.audio.gateCrash(this.player.camera.position.distanceTo(at));
    this.shake = 0.6;
  }

  private updateGate(dt: number): void {
    const L = this.level;
    // Each leaf: a hard swing open, a bounce off the wall, a wobble to rest.
    // The left one swings one way about its hinge, the right the other.
    for (const [s, leaf, side] of [[this.gateL, L.gate.left, 1], [this.gateR, L.gate.right, -1]] as [{ a: number; w: number }, THREE.Group, number][]) {
      if (s.w === 0 && s.a === 0) continue;
      const target = 1.42;
      const acc = (target - s.a) * 22 - s.w * 2.6;
      s.w += acc * dt;
      s.a += s.w * dt;
      if (s.a > 1.72) {
        s.a = 1.72;
        s.w = -Math.abs(s.w) * 0.35;
      }
      leaf.rotation.set(0, side * s.a, -side * 0.05 * Math.min(1, s.a));
    }
  }

  /** The gate as it was left, for a restart: both leaves hanging open. */
  private gateWrecked(): void {
    const g = this.level.gate;
    g.collider.disabled = true;
    this.gateL.a = this.gateR.a = 1.42;
    this.gateL.w = this.gateR.w = 0;
    g.left.rotation.set(0, 1.42, -0.05);
    g.right.rotation.set(0, -1.42, 0.05);
  }

  /** Off the bench, up the aisle, out of the door and down the step. */
  private walkOut(e: Enemy, i: number): void {
    const v = this.van;
    const st = this.cs.get(e)!;
    const seat = st.seat;
    const side = Math.sign(seat.x) || 1;
    const F = v.floorY;
    const at = this.vanWorld(seat);
    this.scene.add(e.root);
    e.position.copy(at);
    e.yaw = wrapAngle(v.group.rotation.y + st.yaw);
    e.root.rotation.y = e.yaw;
    this.paths.standUp(e);
    const spread = [[0, 0], [2.4, -2.4], [3.6, 0.6], [2.2, -3.6], [4.2, -1.2], [2.6, 2.4], [4.4, 1.8]][i];
    const outside = this.vanWorld(V(v.doorOut.x + spread[0], 0, v.doorOut.z + spread[1]));
    const pts = [
      at,
      this.vanWorld(V(side * 0.22, F, seat.z)),
      this.vanWorld(V(0.22, F, v.doorIn.z + 0.45)),
      this.vanWorld(v.doorIn),
      this.vanWorld(v.doorSill),
      this.vanWorld(v.doorStep),
      this.vanWorld(v.doorOut),
      e === this.sanjay ? this.handMark() : outside
    ];
    // Out at a hurry, the rifle in their hands
    this.paths.walk(e, pts, WALK * 1.5, e === this.sanjay ? this.level.starts[1].pos.clone().setY(1.5) : undefined, undefined, false, 1.7);
  }

  /** Anyone just down out of the van goes to his post (Sanjay waits for Ravi). */
  private crewOut(): void {
    this.crew.forEach((e, i) => {
      const st = this.cs.get(e)!;
      if (st.out || e.root.parent !== this.scene || this.paths.has(e)) return;
      st.out = true;
      if (e === this.sanjay && this.phase === 'arrive') return;
      e.setRestCarry(false);
      e.setSitting(false);
      this.crewAI[i].goTo(this.level.posts.van[i], 0);
    });
  }

  /** Where Sanjay stands to hand it over: in front of Ravi's stand point. */
  private handMark(): THREE.Vector3 {
    const s = this.level.starts[1];
    return V(s.pos.x - Math.sin(s.yaw) * 1.3, 0, s.pos.z - Math.cos(s.yaw) * 1.3);
  }

  private vanWorld(p: THREE.Vector3): THREE.Vector3 {
    this.van.group.updateMatrixWorld(true);
    return this.van.group.localToWorld(p.clone());
  }

  /** From his seat: the door going back, the crew getting out; then him, up, down the aisle, out onto the tarmac. */
  private arrivalPOV(t: number): void {
    const v = this.van;
    const seat = v.seats.left[0];
    const F = v.floorY;
    const seatEye = this.vanWorld(V(seat.x + 0.12, F + 1.14, seat.z));
    const crew = this.vanWorld(V(0.55, F + 1.0, 1.9));
    const door = this.vanWorld(V(1.6, F + 0.95, v.doorIn.z));
    const s = this.level.starts[1];
    const out = V(s.pos.x, 1.62, s.pos.z);
    if (t < T.raviUp) {
      // Sat, looking down the bay at the crew getting up; following them to the door
      const look = crew.clone().lerp(door, smooth((t - T.crewOut - 0.6) / 2.2));
      this.setCam(seatEye, look, 68);
      return;
    }
    // Up and out: the same walk the crew took, his eyes on it
    const pts = [
      V(seat.x + 0.12, F + 1.14, seat.z),
      V(seat.x + 0.2, F + 1.62, seat.z),
      V(0.22, F + 1.62, v.doorIn.z - 0.3),
      V(v.doorIn.x, F + 1.62, v.doorIn.z),
      V(v.doorSill.x, v.doorSill.y + 1.62, v.doorSill.z),
      V(v.doorStep.x, v.doorStep.y + 1.62, v.doorStep.z),
      V(v.doorOut.x, 1.62, v.doorOut.z)
    ].map((p) => this.vanWorld(p));
    pts.push(out);
    const u = t - T.raviUp;
    const legs = [0.55, 0.5, 0.45, 0.3, 0.32, 0.32, 0.8];
    let k = u;
    let i = 0;
    while (i < legs.length - 1 && k > legs[i]) {
      k -= legs[i];
      i++;
    }
    const f = smooth(Math.min(1, k / legs[i]));
    const eye = pts[i].clone().lerp(pts[i + 1], f);
    const done = u >= legs.reduce((a, b) => a + b, 0);
    // Looking where he goes; at the end, at Sanjay holding it out
    const ahead = pts[Math.min(i + 2, pts.length - 1)].clone();
    ahead.y = eye.y - 0.25;
    const sanjayFace = this.sanjay.position.clone().setY(1.45);
    const look = done || i >= 6 ? sanjayFace : ahead;
    const bob = Math.sin(u * 9) * 0.02 * (done ? 0 : 1);
    eye.y += bob;
    this.setCam(eye, look, 70, Math.min(1, (done ? 1 : 0.35)));
  }

  private camLook = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camInit = false;

  /** Put the camera at `pos` looking at `at`; `ease` (0..1 a frame) smooths the look and the move. */
  private setCam(pos: THREE.Vector3, at: THREE.Vector3, fov: number, ease = 1): void {
    const cam = this.player.camera;
    if (!this.camInit || ease >= 1) {
      this.camPos.copy(pos);
      this.camLook.copy(at);
      this.camInit = true;
    } else {
      this.camPos.lerp(pos, ease);
      this.camLook.lerp(at, ease * 0.5);
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Sanjay holds it out; Ravi's hands come up for it; it comes to his shoulder
   * as Sanjay lets go and turns to fight.
   */
  private updateHandoff(t: number): void {
    const s = this.sanjay;
    const lm = this.sanjayLauncher;
    const u = t - T.hand;
    const st = this.cs.get(s)!;
    if (u < 0.05 && !st.talked) {
      st.talked = true;
      this.say([{ who: 'SANJAY', text: "Ravi — take it! One rocket a tower. Bring 'em down!", dur: 3.2 }]);
    }
    if (lm) {
      // Up from carry to held out, at chest height, toward him
      const k = smooth(u / 0.5);
      lm.position.set(0, THREE.MathUtils.lerp(1.0, 1.16, k), THREE.MathUtils.lerp(-0.36, -0.5, k));
      lm.rotation.set(0, Math.PI / 2, 0.05 * k);
      s.pose = {
        handR: V(0.24, THREE.MathUtils.lerp(0.95, 1.08, k), THREE.MathUtils.lerp(-0.38, -0.52, k)),
        handL: V(-0.24, THREE.MathUtils.lerp(0.95, 1.08, k), THREE.MathUtils.lerp(-0.38, -0.52, k)),
        curl: 0.9
      };
      s.setHeadLook(this.player.camera.position);
      if (t >= T.reach) {
        // From here the pack is drawn as the viewmodel's, exactly where Sanjay holds it, so Ravi's hands
        // can go to it; once they have it (T.take) it's carried to his shoulder
        lm.visible = false;
        lm.updateWorldMatrix(true, false);
        const cam = this.player.camera;
        cam.updateMatrixWorld(true);
        const from = new THREE.Matrix4().copy(cam.matrixWorld).invert().multiply(lm.matrixWorld);
        const h = this.launcher.handoff;
        if (!h) {
          this.launcher.handoff = { from, k: 0, reach: 0 };
          this.launcher.stow = 0;
          this.launcher.refill();
        } else if (t < T.take) h.from.copy(from);
        this.launcher.handoff!.reach = clamp01((t - T.reach) / 0.45);
        if (t >= T.take) {
          lm.removeFromParent();
          this.sanjayLauncher = null;
          this.launcherOwned = true;
          this.launcherUp = true;
        }
      }
    }
    const h = this.launcher.handoff;
    if (h && t >= T.take) {
      h.k = clamp01((t - T.take) / 1.0);
      h.reach = 1;
      // Sanjay's hands stay on it a moment, then let go
      if (h.k > 0.3 && s.pose) {
        s.pose = null;
        s.slingWeapon(false);
        s.setAiming(false);
      }
      if (h.k >= 1) this.launcher.handoff = null;
    }
  }

  // ------------------------------------------------------------- 2 towers

  private startTowers(restart: boolean): void {
    const L = this.level;
    this.setPhase('towers');
    this.player.cinematic = false;
    this.cinema(false);
    this.camInit = false;
    this.fadeEl.style.opacity = '0';
    this.skipEl.classList.add('gone');
    // Ravi on his feet where he got out, looking up the lot
    const s = L.starts[1];
    if (restart) {
      this.player.position.copy(s.pos);
      this.player.yaw = s.yaw;
      this.player.pitch = 0.08;
      this.placeVan(T.stop + 2);
      this.seatDriver();
      this.van.setDoor(1);
      this.gateWrecked();
      this.crew.forEach((e, i) => {
        this.scene.add(e.root);
        e.setSitting(false);
        e.setRestCarry(false);
        this.cs.get(e)!.out = true;
        this.crewAI[i].placeAt(L.posts.van[i]);
      });
      this.sanjay.slingWeapon(false);
      this.launcher.stow = 0;
      this.launcher.refill();
      this.launcherOwned = true;
      this.launcherUp = true;
      this.klaxon?.set(1);
    } else {
      // Where the camera ended up is where he is
      const cam = this.player.camera;
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      this.player.position.set(s.pos.x, 0, s.pos.z);
      this.player.yaw = Math.atan2(-fwd.x, -fwd.z);
      this.player.pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
      this.crewAI[0].goTo(L.posts.van[0], 0.1);
      this.sanjay.setHeadLook(null);
    }
    this.cs.get(this.sanjay)!.out = true;
    // The van is cover now: a box round it
    this.vanCollider();
    this.player.camera.fov = 74;
    this.player.camera.updateProjectionMatrix();
    this.setObjective(`DESTROY THE OUTPOST TOWERS (${this.towersDown()}/4)`);
    this.hud.setCounter('TOWERS STANDING', 4 - this.towersDown());
    this.ctx.audio.startBossMusic();
    this.ctx.input.requestPointerLock();
    // The Collective come out to meet them
    for (let i = 0; i < 8; i++) this.waveQueue.push(L.spawns.near[i % L.spawns.near.length]);
    this.phaseSpawned = 8;
    this.spawnT = 4;
    this.barkT = 5;
    this.say([{ who: 'DEV', text: 'Contact! They’re coming out from the towers!', dur: 2.6 }], 1.5);
  }

  private vanCol: THREE.Box3 | null = null;

  /**
   * The van, stopped, is cover: solid to walk into and to shoot at. It's
   * stopped turned, so it's four boxes down its length rather than one
   * round the lot of it (which would stand a metre proud of its sides).
   */
  private vanCollider(): void {
    if (this.vanCol) return;
    const v = this.van;
    v.group.updateMatrixWorld(true);
    const len = v.length;
    const hw = v.width / 2;
    const all = new THREE.Box3();
    const boxes: THREE.Box3[] = [];
    for (let k = 0; k < 4; k++) {
      const z0 = -len / 2 + (k * len) / 4;
      const z1 = z0 + len / 4;
      const box = new THREE.Box3();
      for (const x of [-hw, hw]) for (const z of [z0, z1]) box.expandByPoint(v.group.localToWorld(V(x, 0, z)));
      box.min.y = 0;
      box.max.y = 2.9;
      box.expandByScalar(-0.06);
      this.level.colliders.push({ box });
      all.union(box);
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
      box.getCenter(proxy.position);
      box.getSize(proxy.scale);
      proxy.userData.surface = 'metal';
      proxy.userData.noDecal = true;
      this.scene.add(proxy);
      this.level.shootables.push(proxy);
      this.level.occluders.push(proxy);
      boxes.push(box.clone().expandByScalar(0.7));
    }
    this.vanCol = all;
    // The waypoints under it are gone, and the links across it
    const wps = this.level.waypoints;
    const seg = new THREE.Ray();
    const hit = new THREE.Vector3();
    const blocked = (a: THREE.Vector3, b: THREE.Vector3): boolean => {
      const d = b.clone().sub(a);
      const len = d.length();
      seg.set(V(a.x, 1, a.z), d.setY(0).normalize());
      return boxes.some((bx) => bx.containsPoint(V(a.x, 1, a.z)) || (seg.intersectBox(bx, hit) !== null && hit.distanceTo(seg.origin) < len));
    };
    wps.forEach((w, i) => {
      w.links = w.links.filter((j) => !blocked(w.pos, wps[j].pos) && !blocked(wps[j].pos, w.pos));
      if (boxes.some((bx) => bx.containsPoint(V(w.pos.x, 1, w.pos.z)))) w.links = [];
      void i;
    });
    wps.forEach((w, i) => (w.links = w.links.filter((j) => wps[j].links.includes(i))));
  }

  private towersDown(): number {
    return this.towers.filter((t) => !t.alive).length;
  }

  private updateTowersPhase(dt: number): void {
    // Reinforcements: keep a few coming, from further up once the near pair's down
    const alive = this.agentsUp();
    this.spawnT -= dt;
    if (this.spawnT <= 0 && alive < 9 && this.phaseSpawned < TOWER_QUOTA) {
      this.spawnT = this.towersDown() >= 4 ? 0.7 : 2.4 + Math.random() * 2.4;
      const pool = this.towers[0].alive || this.towers[1].alive ? this.level.spawns.near : this.level.spawns.far;
      this.spawnAgent(this.pickSpawn(pool));
      this.phaseSpawned++;
    }
    // The crew go up the lot a section at a time as the Collective thin out (the near
    // pair of towers down sends them on to the second row), never more than one step
    // at once and never without Ravi; the Collective come in from up the lot ahead of them
    const nearDown = !this.towers[0].alive && !this.towers[1].alive;
    const want = nearDown || this.towerKills >= TOWER_STEPS[1] ? 2 : this.towerKills >= TOWER_STEPS[0] ? 1 : 0;
    if (want > this.towerSec) {
      if (this.raviWithCrew()) {
        this.towerSec++;
        this.moveCrew(this.towerSec === 1 ? this.secA : this.level.posts.mid, 0.3);
        this.movedMid = this.towerSec === 2;
        this.say([
          this.towerSec === 1
            ? { who: 'SANJAY', text: 'Off the van! Up to that cover — together!', dur: 2.6 }
            : nearDown
              ? { who: 'SANJAY', text: 'Two down! Move up — next row!', dur: 2.6 }
              : { who: 'SANJAY', text: 'Next row! Move up with us, Ravi!', dur: 2.6 }
        ]);
      } else this.callRaviUp(dt);
    }
    // All four down isn't enough: every one of the Collective's men out here has to be dealt with too
    if (this.towersDown() >= 4 && this.phaseT > 0.5) {
      const left = this.enemiesLeft();
      this.showLeft(left, 'TOWERS DOWN — CLEAR OUT THE EC FORCES');
      this.mopUp(dt, left, TOWER_QUOTA - this.phaseSpawned);
      if (left === 0) this.startAdvance(false);
    }
  }

  /** The Collective's men still to deal with in this phase: those still to come and those up. */
  private enemiesLeft(): number {
    const towers = this.phase === 'towers';
    const quota = towers ? TOWER_QUOTA : ADVANCE_QUOTA;
    const spawned = towers ? this.phaseSpawned : this.advanceSpawned;
    return Math.max(0, quota - spawned) + this.agentsUp();
  }

  private leftShown = -1;
  private leftWhat = '';
  /** The count on the HUD and in the objective, when it changes. */
  private showLeft(left: number, what: string): void {
    if (left === this.leftShown && what === this.leftWhat) return;
    this.leftShown = left;
    this.hud.setCounter('EC FORCES LEFT', left);
    if (left > 0) {
      // The banner across the middle only when the job changes; after that just the line top left
      const text = `${what} (${left} LEFT)`;
      if (what !== this.leftWhat) this.setObjective(text);
      else {
        this.objective.textContent = text;
        this.objective.style.opacity = '1';
      }
      this.leftWhat = what;
    }
    // The last few come looking for him, so nobody's left hiding somewhere
    if (left > 0 && left <= 4) for (const a of this.agents) if (a.e.alive) a.ai?.alert(this.player.position);
  }

  private phaseSpawned = 0;

  private movedMid = false;

  // ------------------------------------------------------------- 3 advance

  private startAdvance(restart: boolean): void {
    const L = this.level;
    this.setPhase('advance');
    if (restart) {
      const s = L.starts[2];
      this.player.position.copy(s.pos);
      this.player.yaw = s.yaw;
      this.player.pitch = 0.05;
      this.player.cinematic = false;
      this.cinema(false);
      this.fadeEl.style.opacity = '0';
      this.skipEl.classList.add('gone');
      this.placeVan(T.stop + 2);
      this.seatDriver();
      this.van.setDoor(1);
      this.gateWrecked();
      this.vanCollider();
      for (const tw of this.towers) tw.wreckInstant(this.debrisFx, this.scene);
      this.crew.forEach((e, i) => {
        this.scene.add(e.root);
        e.setSitting(false);
        e.setRestCarry(false);
        this.cs.get(e)!.out = true;
        this.crewAI[i].placeAt(this.secB[i]);
        this.advSec = 1;
      });
      this.sanjay.slingWeapon(false);
      this.movedMid = true;
      this.ctx.audio.startBossMusic();
      this.ctx.input.requestPointerLock();
      this.klaxon?.set(0.5);
    } else {
      this.say([
        { who: 'SANJAY', text: "That's all four! Drop the tube — we're going for the building!", dur: 3.2 },
        { who: 'DEV', text: 'Move, move! Cover to cover!', dur: 2.4 }
      ]);
      // Up one section, not the length of the lot: the cover past the second row
      // (or the second row itself, if they never got that far)
      if (this.towerSec < 2) {
        this.advSec = 0;
        this.moveCrew(L.posts.mid, 0.3);
      } else {
        this.advSec = 1;
        this.moveCrew(this.secB, 0.3);
      }
      this.klaxon?.set(0.5);
    }
    // The launcher's done: he lets it drop
    this.dropLauncher(!restart);
    this.hud.setCounter(null);
    this.setObjective('OBJECTIVE: ADVANCE TO THE EC HEADQUARTERS');
    for (let i = 0; i < 7; i++) this.waveQueue.push(this.pickSpawn(L.spawns.podium));
    this.spawnT = 4;
    this.advanceSpawned = 7;
    this.stairsMoved = false;
  }

  private advanceSpawned = 0;
  private stairsMoved = false;

  /** The launcher out of his hands for good: thrown down on the tarmac if he had it, and gone from what he carries. */
  private dropLauncher(throwIt: boolean): void {
    if (throwIt && this.launcherUp) {
      const lm = launcherModel();
      const at = this.launcher.muzzleWorld(new THREE.Vector3());
      lm.group.position.copy(at);
      lm.group.quaternion.copy(this.player.camera.quaternion);
      this.scene.add(lm.group);
      const f = this.player.forwardDir();
      this.debrisFx.add({ obj: lm.group, vel: V(f.x * 1.5 + 1.2, 1.2, f.z * 1.5), spin: V(2, 1, 3), size: 0.25, onLand: (_p, sp) => {
        if (sp > 1) this.ctx.audio.carScrape(this.player.position.distanceTo(lm.group.position));
      } });
    }
    this.launcherOwned = false;
    this.launcherUp = false;
    this.launcher.stow = 1;
    this.launcher.root.visible = false;
    this.hud.setPrompt(null);
  }

  private updateAdvance(dt: number): void {
    const L = this.level;
    const p = this.player.position;
    const alive = this.agentsUp();
    this.spawnT -= dt;
    if (this.spawnT <= 0 && alive < 9 && this.advanceSpawned < ADVANCE_QUOTA) {
      this.spawnT = p.z < -138 ? 0.7 : 2.8 + Math.random() * 2.5;
      this.advanceSpawned++;
      this.spawnAgent(this.pickSpawn(L.spawns.podium));
    }
    // On up the lot a section at a time with him: the cover past the second row, the far rows, the stairs
    const want = this.advKills >= ADVANCE_STEPS[1] || p.z < -112 ? 3 : this.advKills >= ADVANCE_STEPS[0] ? 2 : 1;
    if (want > this.advSec) {
      // (a long while held up waiting for him, and they go anyway)
      if (this.raviWithCrew() || this.phaseT > 60) {
        this.advSec++;
        const posts = [L.posts.mid, this.secB, L.posts.far, L.posts.stairs][this.advSec];
        this.moveCrew(posts, 0.2);
        if (this.advSec === 3) {
          this.stairsMoved = true;
          this.say([{ who: 'MARCUS', text: 'Stairs ahead! Get to the columns!', dur: 2.4 }]);
        } else this.say([{ who: this.advSec === 2 ? 'DEV' : 'SANJAY', text: this.advSec === 2 ? 'Moving up! Cover me!' : 'Next cover! Go, go!', dur: 2.2 }]);
      } else this.callRaviUp(dt);
    }
    // Fight through most of them and the crew blow a way in; how many more, on the HUD
    const need = Math.max(0, BREACH_KILLS - this.advKills);
    this.showLeft(need, 'FIGHT YOUR WAY TO THE EC HEADQUARTERS');
    this.mopUp(dt, this.agentsUp(), ADVANCE_QUOTA - this.advanceSpawned);
    if (need === 0 && this.player.alive) this.startBreach();
  }

  private advKills = 0;

  /**
   * The last few of them, once there are no more to come: they come for him
   * (showLeft), but one stuck somewhere he can't get at, or a jetpack man
   * hanging about out of reach, mustn't hold the level up. If the count
   * hasn't moved for a while, the crew finish them.
   */
  private mopUp(dt: number, left: number, toCome: number): void {
    if (left !== this.mopLeft) {
      this.mopLeft = left;
      this.mopT = 0;
    }
    if (left === 0 || left > 5 || toCome > 0 || !this.player.alive) return;
    this.mopT += dt;
    if (this.mopT < 22) return;
    this.mopT = 0;
    for (const a of this.agents) {
      if (!a.e.alive) continue;
      const jet = this.jetOf.get(a.e);
      if (jet) {
        // Shot down: he comes out of the sky on his own
        if (jet.alive) this.downJet(jet, V(0, -1, 0), false);
        continue;
      }
      if (a.e.alive) this.killEnemy(a.e, a.e.position.clone().setY(a.e.position.y + 1.3), V(0, 0.2, 1).normalize(), false, false, 'torso');
    }
    this.say([{ who: 'DEV', text: 'Got the last of them!', dur: 2 }]);
  }

  private mopLeft = -1;
  private mopT = 0;

  // -------------------------------------------------------------- 4 the breach

  private breachLauncher: THREE.Group | null = null;
  private breached = false;

  /**
   * The wall goes: Sanjay, off the side of the stairs with the spare tube on
   * his shoulder, puts a rocket into it; the wall under the stairs blows out;
   * he yells at Ravi to go for it, and the crew charge the building.
   */
  private startBreach(): void {
    this.setPhase('breach');
    this.cinema(true);
    this.player.cinematic = true;
    this.player.aiming = false;
    this.launcherUp = false;
    this.camInit = false;
    this.hud.setCounter(null);
    this.setObjective('');
    // That's the last of them coming: from here the crew take it to the rest
    this.advanceSpawned = ADVANCE_QUOTA;
    const s = this.sanjay;
    const hole = this.level.hole.centre;
    this.crewAI[0].state = 'idle';
    this.paths.stop(s);
    s.position.copy(SANJAY_FIRE);
    s.yaw = Math.atan2(-(hole.x - SANJAY_FIRE.x), -(hole.z - SANJAY_FIRE.z));
    s.root.rotation.y = s.yaw;
    s.slingWeapon(true);
    s.setAiming(false);
    s.setRestCarry(false);
    s.setRun(false);
    s.setWalk(0);
    // On his right shoulder, the tube down his line of sight
    const lm = launcherModel();
    lm.group.position.set(0.17, 1.5, -0.12);
    s.root.add(lm.group);
    this.breachLauncher = lm.group;
    s.pose = { handR: V(0.17, 1.33, -0.24), handL: V(0.1, 1.39, -0.55), curl: 0.9 };
    s.setHeadLook(hole.clone().setY(1.5));
    this.say([
      { who: 'SANJAY', text: 'The wall under the stairs — heads down!', dur: 2.6 },
      { who: 'SANJAY', text: "That's our way in! Ravi — GO! We'll hold them off out here!", dur: 3.4 },
      { who: 'RAVI', text: 'Going!', dur: 1.6 }
    ], 0.1);
  }

  private updateBreach(dt: number): void {
    const t = this.phaseT;
    const L = this.level;
    const hole = L.hole.centre;
    const s = this.sanjay;
    const at = SANJAY_FIRE;
    // The rocket, at the wall
    if (t >= 0.75 && t - dt < 0.75 && this.breachLauncher) {
      this.breachLauncher.updateWorldMatrix(true, false);
      const from = this.breachLauncher.localToWorld(V(0, 0, -0.7));
      const dir = hole.clone().setY(1.5).sub(from).normalize();
      this.rockets.fire(from.clone().addScaledVector(dir, 0.2), dir, 34);
      this.ctx.audio.rocketLaunch(from.distanceTo(this.player.camera.position));
      this.particles.muzzleFlash(from, dir);
      this.flashPool.flash(from, 25);
      const rear = this.breachLauncher.localToWorld(V(0, 0, 0.5));
      this.particles.tyreSmoke(rear, dir.clone().negate().setY(0.4), 0.35);
    }
    // However it went, the wall's down by now
    if (t >= 2.2 && !this.breached) this.breachWall(false);
    // He drops the tube and brings his rifle up; the crew go for it
    if (t >= 2.9 && t - dt < 2.9) this.crewCharge();
    if (t >= 4.2 && t - dt < 4.2) {
      const lm = this.breachLauncher;
      if (lm) {
        const wp = lm.getWorldPosition(new THREE.Vector3());
        const wq = lm.getWorldQuaternion(new THREE.Quaternion());
        lm.removeFromParent();
        this.scene.add(lm);
        lm.position.copy(wp);
        lm.quaternion.copy(wq);
        this.debrisFx.add({ obj: lm, vel: V(0.5, 0.8, 0.4), spin: V(1.5, 0.5, 2), size: 0.25 });
        this.breachLauncher = null;
      }
      s.pose = null;
      s.setHeadLook(null);
      s.slingWeapon(false);
      this.crewAI[0].goTo(L.posts.charge[0], 0);
    }
    // ---- Shots
    const A = HQScene.tmpA;
    const B = HQScene.tmpB;
    if (t < 1.05) {
      // Over Sanjay's shoulder: the wall in under the stairs, the tube on his shoulder
      const f = HQScene.tmpC.copy(hole).sub(at).setY(0).normalize();
      A.copy(at).addScaledVector(f, -1.8).add(V(-f.z * 0.8, 1.9, f.x * 0.8));
      B.copy(hole).setY(1.4);
      this.setCam(A, B, 50);
    } else if (t < 3.6) {
      // The wall itself, from in under the stairs: the rocket comes in, it blows, the hole's there
      const k = smooth((t - 1.05) / 2.5);
      A.set(hole.x + 6.6, 1.5, hole.z + 10.5).lerp(V(hole.x + 5.6, 1.4, hole.z + 8.8), k);
      B.copy(hole).setY(1.6);
      this.setCam(A, B, 48);
    } else if (t < 7.4) {
      // The crew going for it: low on the plaza beside the stairs, looking back at the columns as they
      // break cover, come through the gaps and run past, the camera turning after them
      const k = smooth((t - 3.9) / 3.2);
      A.set(-21 + 0.6 * k, 1.3, -168 - 0.8 * k);
      B.set(THREE.MathUtils.lerp(-15, -19, k), THREE.MathUtils.lerp(1.6, 1.3, k), THREE.MathUtils.lerp(-158, -175, k));
      this.setCam(A, B, 56);
    } else {
      this.endBreach();
    }
  }

  /** Everyone up and at the building, in two waves. */
  private crewCharge(): void {
    this.crewAI.forEach((c, i) => {
      if (c.e === this.sanjay) return;
      c.goTo(this.level.posts.charge[i], i % 2 ? 0.5 : 0);
    });
  }

  /** The wall under the stairs, blown: gone from where it stood, the broken hole there instead. */
  private breachWall(instant: boolean): void {
    if (this.breached) return;
    this.breached = true;
    const H = this.level.hole;
    H.wall.mesh.visible = false;
    H.wall.collider.disabled = true;
    const L = this.level;
    const oi = H.wall.occluder ? L.occluders.indexOf(H.wall.occluder) : -1;
    if (oi >= 0) L.occluders.splice(oi, 1);
    const si = L.shootables.indexOf(H.wall.mesh);
    if (si >= 0) L.shootables.splice(si, 1);
    for (const d of H.dressing) d.visible = true;
    if (instant) return;
    // Out of the wall: chunks of it thrown out across the plaza, dust, a lot of noise
    const c = H.centre.clone().setY(1.6);
    this.particles.explosion(c, 5);
    this.particles.dust(H.centre.clone().setY(0.2), 4.5, 2);
    this.particles.sparks(c, V(0, 0.4, 1), 40);
    const chunk = new THREE.DodecahedronGeometry(0.3, 0);
    const mat = (H.wall.mesh.material as THREE.Material);
    for (let k = 0; k < 16; k++) {
      const m = new THREE.Mesh(chunk, mat);
      const sz = 0.5 + Math.random() * 1.2;
      m.scale.setScalar(sz);
      m.position.set(c.x + (Math.random() - 0.5) * 2.6, 0.4 + Math.random() * 2.4, c.z + 0.3);
      this.scene.add(m);
      this.debrisFx.add({ obj: m, vel: V((Math.random() - 0.5) * 9, 2 + Math.random() * 5, 5 + Math.random() * 9), spin: V((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10), size: 0.5 * sz, smoke: k < 4 ? 3 : 0 });
    }
    this.ctx.audio.wallCollapse();
    this.ctx.audio.explosion(c.distanceTo(this.player.camera.position));
    this.shake = Math.max(this.shake, 0.8);
  }

  private endBreach(): void {
    this.setPhase('hole');
    const p = this.player;
    p.cinematic = false;
    this.camInit = false;
    p.camera.fov = 74;
    p.camera.updateProjectionMatrix();
    this.cinema(false);
    this.setObjective('GET INSIDE: THE BREACH UNDER THE STAIRS');
    this.ctx.input.requestPointerLock();
  }

  /** A restart past the breach: the wall's down, the crew are up by the building, a few of them still about. */
  private startPastBreach(): void {
    this.startAdvance(true);
    this.advanceSpawned = ADVANCE_QUOTA;
    let keep = 2;
    for (const a of this.agents) {
      if (!a.e.alive) continue;
      if (keep-- > 0) continue;
      a.ai?.dispose();
      a.ai = null;
      a.e.root.removeFromParent();
      a.e.alive = false;
      for (const p of a.e.parts) {
        const k = this.level.shootables.indexOf(p);
        if (k >= 0) this.level.shootables.splice(k, 1);
      }
    }
    this.agents = this.agents.filter((a) => a.e.alive);
    this.crew.forEach((e, i) => this.crewAI[i].placeAt(this.level.posts.charge[i]));
    this.breachWall(true);
    const s = this.level.starts[3];
    this.player.position.copy(s.pos);
    this.player.yaw = s.yaw;
    this.setPhase('hole');
    this.hud.setCounter(null);
    this.setObjective('GET INSIDE: THE BREACH UNDER THE STAIRS');
  }

  /** Over the breach once it's open, wherever he's looking: a marker and how far. */
  private updateMarker(): void {
    const on = this.phase === 'hole' && this.player.alive;
    this.marker.style.display = on ? '' : 'none';
    if (!on) return;
    const cam = this.player.camera;
    const at = HQScene.tmpA.copy(this.level.hole.centre).setY(2.0);
    const d = Math.round(Math.hypot(at.x - this.player.position.x, at.z - this.player.position.z));
    const v = HQScene.tmpB.copy(at).project(cam);
    const W = window.innerWidth;
    const H = window.innerHeight;
    let x = (v.x * 0.5 + 0.5) * W;
    let y = (-v.y * 0.5 + 0.5) * H;
    // Behind him: pinned to the bottom edge, on the side to turn to
    if (v.z > 1) {
      x = v.x > 0 ? 40 : W - 40;
      y = H * 0.75;
    }
    x = THREE.MathUtils.clamp(x, 40, W - 40);
    y = THREE.MathUtils.clamp(y, 70, H - 70);
    this.marker.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
    const text = `BREACH ${d}m`;
    if (this.markerText.textContent !== text) this.markerText.textContent = text;
  }

  // ---------------------------------------------------------------- 5 in

  private updateHole(): void {
    const L = this.level;
    const p = this.player.position;
    const feet = HQScene.tmpA.set(p.x, p.y + 0.3, p.z);
    if (this.player.alive && L.hole.trigger.containsPoint(feet)) this.startEnding();
  }

  private startEnding(): void {
    this.setPhase('ending');
    this.cinema(true);
    this.player.cinematic = true;
    this.player.aiming = false;
    this.setObjective('');
    this.ctx.input.exitPointerLock();
    this.camInit = false;
    if (this.ravi) this.ravi.root.visible = true;
  }

  private updateEnding(): void {
    const t = this.phaseT;
    const L = this.level;
    const hole = L.hole.centre;
    // He comes in under the stairs out of the rain, ducks through the hole past the camera, and is gone into the dark
    const pts = [V(hole.x - 8.2, 0, hole.z + 5.6), V(hole.x - 0.2, 0, hole.z + 0.6), V(hole.x - 1.4, 0, hole.z - 3.4)];
    const legs = [pts[0].distanceTo(pts[1]), pts[1].distanceTo(pts[2])];
    const s = Math.min(legs[0] + legs[1], t * 2.1);
    const leg = s < legs[0] ? 0 : 1;
    const u = leg === 0 ? s / legs[0] : (s - legs[0]) / legs[1];
    const at = pts[leg].clone().lerp(pts[leg + 1], u);
    if (this.ravi) {
      this.ravi.root.position.copy(at);
      const d = pts[leg + 1].clone().sub(pts[leg]);
      const want = Math.atan2(d.x, d.z);
      this.ravi.root.rotation.y += wrapAngle(want - this.ravi.root.rotation.y) * Math.min(1, this.dtLast * 6);
      const duck = smooth((s - legs[0] + 1.2) / 1.0) * (1 - smooth((s - legs[0] - 1.6) / 0.8));
      this.poseRavi({ walk: t * 7.4, duck: duck * 0.6, look: pts[2].clone().setY(1.4) });
    }
    // The fight still going behind him
    if (t > 0.7 && t - this.dtLast <= 0.7) this.distantBlast(V(-34, 0.6, -150));
    if (t > 2.3 && t - this.dtLast <= 2.3) this.distantBlast(V(-24, 0.6, -132));
    // From just inside the breach, looking back out past the side of the stairs at the lot
    this.setCam(V(hole.x + 1.1, 1.05, hole.z - 2.3), V(hole.x - 13, 1.9, hole.z + 12), 52);
    if (t > 3.6) this.fadeEl.style.opacity = String(clamp01((t - 3.6) / 1.0));
    if (t > 4.8) this.card.style.opacity = '1';
    if (t > 9.5 && !this.handedOff) {
      this.handedOff = true;
      this.ctx.bus.emit(Events.HQComplete);
    }
  }

  // ================================================================= Ravi seen

  /**
   * Ravi's body for the cutscenes: stood (or walking), relaxed hands, his
   * head turned to `look`; a nod; his left thumb up; ducking under something.
   */
  private poseRavi(o: { nod?: number; thumb?: number; look?: THREE.Vector3; walk?: number; duck?: number }): void {
    const r = this.ravi;
    if (!r) return;
    const hipRest = RaviVisual.restBone('thigh_l').modelP;
    const footRest = RaviVisual.restBone('foot_l').modelP;
    const H = (hipRest.y + RaviVisual.restBone('thigh_r').modelP.y) / 2;
    const A = footRest.y;
    const hx = Math.abs(hipRest.x);
    const duck = o.duck ?? 0;
    const walking = o.walk !== undefined;
    const ph = o.walk ?? 0;
    const stride = walking ? 0.24 * (1 - 0.35 * duck) : 0;
    const legs: Record<'l' | 'r', { ankle: THREE.Vector3; knee: THREE.Vector3 }> = {
      l: { ankle: V(hx + 0.02, A, 0.02), knee: V(0.05, 0, 1) },
      r: { ankle: V(-hx - 0.02, A, 0.02), knee: V(-0.05, 0, 1) }
    };
    if (walking) {
      for (const [side, off] of [['l', 0], ['r', Math.PI]] as const) {
        const a = ph + off;
        legs[side].ankle.z = stride * Math.sin(a);
        legs[side].ankle.y = A + 0.1 * Math.max(0, Math.cos(a));
      }
    }
    const hips = V(0, H - 0.025 - (walking ? 0.03 * Math.abs(Math.sin(ph)) : 0) - 0.3 * duck, -0.05 * duck);
    // Head toward what he's looking at (model space: +Z his front, +X his left)
    let headYaw = 0;
    let headPitch = 0;
    if (o.look) {
      const local = r.root.worldToLocal(o.look.clone());
      headYaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z) * 57.3, -60, 60);
      headPitch = THREE.MathUtils.clamp(-Math.atan2(local.y - 1.6, Math.hypot(local.x, local.z)) * 57.3, -25, 30);
    }
    const nod = o.nod ?? 0;
    const lean = [2 + 22 * duck, 2 + 8 * duck, 2 + 6 * duck, 1, headPitch * 0.3 + nod * 0.3, headPitch * 0.7 + nod];
    const twist = [0, 0, headYaw * 0.1, headYaw * 0.15, headYaw * 0.3, headYaw * 0.45];
    const swing = walking ? Math.sin(ph) * 0.12 : 0;
    const shoulderY = 1.38 - 0.3 * duck;
    const thumb = o.thumb ?? 0;
    const thumbShape: HandShape = { fingers: [[88, 100, 70], [88, 100, 70], [88, 100, 70], [88, 100, 70]], thumb: [-0.1, 0, 0] };
    const lWrist = V(0.2, 0.86 - 0.25 * duck, 0.02 - swing).lerp(V(0.13, 1.28, 0.34), thumb);
    r.seat({
      hips,
      lean,
      twist,
      legs,
      arms: {
        l: {
          wrist: lWrist,
          along: V(0.05, -1, 0.1).lerp(V(0, 0.45, 1), thumb).normalize(),
          palm: V(-1, 0, 0.1).normalize(),
          elbow: V(0.6, -0.3, -0.6),
          shape: thumb > 0.5 ? thumbShape : HAND.relaxed
        },
        r: {
          wrist: V(-0.2, 0.86 - 0.25 * duck, 0.02 + swing),
          along: V(-0.05, -1, 0.1).normalize(),
          palm: V(1, 0, 0.1).normalize(),
          elbow: V(-0.6, -0.3, -0.6),
          shape: HAND.relaxed
        }
      }
    });
    void shoulderY;
  }

  // ================================================================ the fight

  /** The crew's line: the mean z of the posts they've been sent to. */
  private crewLineZ(): number {
    let sum = 0;
    let n = 0;
    for (const c of this.crewAI) {
      if (!c.post) continue;
      sum += c.post.pos.z;
      n++;
    }
    return n ? sum / n : this.player.position.z;
  }

  /** Is Ravi up with the crew (not hanging back down the lot behind them)? */
  private raviWithCrew(): boolean {
    return this.player.position.z < this.crewLineZ() + WITH_CREW;
  }

  /** Ravi's hanging back and they want to move: now and then, somebody tells him so. */
  private callRaviUp(dt: number): void {
    this.nagT -= dt;
    if (this.nagT > 0) return;
    this.nagT = 11;
    const lines: Line[] = [
      { who: 'SANJAY', text: 'Ravi! Up here with us — we move together!', dur: 2.6 },
      { who: 'DEV', text: 'Ravi, catch up! We can\u2019t push without you!', dur: 2.6 },
      { who: 'MARCUS', text: 'On me, Ravi! Get up here!', dur: 2.2 }
    ];
    this.say([lines[Math.floor(Math.random() * lines.length)]]);
  }

  /**
   * The crew to a new section, staggered so they don't all break cover at
   * once; each takes his cover spot, so none of the Collective goes for it.
   */
  private moveCrew(posts: Post[], delay: number): void {
    for (const sp of this.postSpot.values()) if (this.crew.includes(sp.taken as Enemy)) sp.taken = null;
    this.crewAI.forEach((c, i) => {
      const post = posts[i % posts.length];
      c.goTo(post, delay + (i % 2) * 1.6 + Math.floor(i / 2) * 0.35);
      const sp = this.postSpot.get(post);
      if (sp) sp.taken = c.e;
    });
  }

  /**
   * A section of the crew's line out of the lot's own cover, about `z` down
   * it: for each of the seven, the nearest free spot to his place across the
   * lot that's on the gate side of its cover (so the cover's between him and
   * the building), spread a couple of metres apart. Somewhere with nothing
   * near, he gets the bare place.
   */
  private sectionPosts(z: number): Post[] {
    const across = [-15, 15, -21, 21, -6, 6, 27];
    const used: CoverSpot[] = [];
    return across.map((x) => {
      let best: CoverSpot | null = null;
      let bd = Infinity;
      for (const sp of this.coverSpots) {
        if (sp.pos.z < sp.box.max.z || Math.abs(sp.pos.z - z) > 7 || Math.abs(sp.pos.x) > 40) continue;
        if (used.some((u) => u.pos.distanceTo(sp.pos) < 2.2)) continue;
        const d = Math.abs(sp.pos.x - x) + Math.abs(sp.pos.z - z) * 0.6;
        if (d < bd) {
          bd = d;
          best = sp;
        }
      }
      if (!best || bd > 9) return { pos: V(x, 0, z), face: V(x * 0.6, 1.2, z - 40), low: true };
      used.push(best);
      const post: Post = { pos: best.pos.clone(), face: V(best.pos.x * 0.6, 1.2, best.pos.z - 40), low: best.box.max.y < 1.7 };
      this.postSpot.set(post, best);
      return post;
    });
  }

  /**
   * Ravi's down: the HUD goes, the colour drains out of the picture, the
   * world slows, the camera drifts round him where he lies, and the song
   * comes up. The restart prompt fades in after a few seconds, over the
   * bottom of the shot, not across it.
   */
  private deathScene(): void {
    const { audio } = this.ctx;
    this.deadAt = performance.now();
    this.slowT = 4.5;
    const canvas = this.ctx.engine.renderer.domElement;
    canvas.style.transition = 'filter 1.8s ease-out';
    canvas.style.filter = 'grayscale(1) contrast(1.12) brightness(0.82)';
    this.ui.style.transition = 'opacity 0.5s';
    this.ui.style.opacity = '0';
    const over = document.getElementById('death-overlay');
    const hudRoot = over?.parentElement;
    if (hudRoot) for (const c of Array.from(hudRoot.children)) if (c !== over) (c as HTMLElement).style.visibility = 'hidden';
    this.hud.setCinematic(false);
    this.hud.setPrompt(null);
    if (over) {
      over.style.transition = 'opacity 2.5s';
      over.style.opacity = '0';
      over.style.background = 'linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(0,0,0,0.78) 100%)';
      over.style.justifyContent = 'flex-end';
      over.style.paddingBottom = '10vh';
      window.setTimeout(() => (over.style.opacity = '1'), 5000);
    }
    if (this.raviRagdoll) this.raviRagdoll.orbit = 0.16;
    this.klaxon?.set(0.12);
    audio.stopBossMusic(1.2);
    audio.startTrackMusic(DEATH_SONG, 0, 0, 0.85, 2.5);
  }

  /**
   * The fight's front line, as a z down the lot (it runs from the gate to
   * −Z, so further up is smaller): where the crew have been sent to, or
   * Ravi, if he's out ahead of them.
   */
  private frontZ(): number {
    let sum = 0;
    let n = 0;
    for (const c of this.crewAI) {
      if (!c.post) continue;
      sum += c.post.pos.z;
      n++;
    }
    const p = this.player.position.z;
    return n ? Math.min(sum / n, p) : p;
  }

  /**
   * Where the next man comes from: out in front of the front line — never
   * back down the lot behind Ravi or the crew, at the van they've left —
   * not right on top of him, and not too far either. From `pool` if it
   * has anywhere that'll do, else the next spawns up the lot.
   */
  private pickSpawn(pool: HQSpawn[]): HQSpawn {
    const p = this.player.position;
    const S = this.level.spawns;
    const front = this.frontZ() - SPAWN_AHEAD;
    for (const list of [pool, S.near, S.far, S.podium]) {
      const ok = list.filter((s) => {
        const d = s.pos.distanceTo(p);
        return s.pos.z < front && d > 22 && d < 95;
      });
      if (ok.length) return ok[Math.floor(Math.random() * ok.length)];
    }
    // Nowhere in reach up ahead (he's right up at the podium): the doors, whatever the distance
    return S.podium[Math.floor(Math.random() * S.podium.length)];
  }

  /**
   * Where the Collective's men can get down out of the line of fire: round
   * everything about chest high in the lot (the parked cars, the barriers,
   * the sandbags, the vans), a step out from each side. Boxes that touch
   * (a car is several, cut along its length) are one piece of cover.
   */
  private buildCoverSpots(): void {
    const all = this.level.colliders.filter((c) => !c.disabled).map((c) => c.box);
    const cand = all.filter((b) => {
      const h = b.max.y;
      return b.min.y < 0.3 && h > 0.8 && h < 3.2 && b.max.x - b.min.x < 16 && b.max.z - b.min.z < 16;
    });
    // Touching boxes into one
    const parent = cand.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    const grown = cand.map((b) => b.clone().expandByScalar(0.06));
    for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) if (grown[i].intersectsBox(grown[j])) parent[root(i)] = root(j);
    const groups = new Map<number, THREE.Box3>();
    cand.forEach((b, i) => {
      const r = root(i);
      const g = groups.get(r);
      if (g) g.union(b);
      else groups.set(r, b.clone());
    });
    const blocked = (x: number, z: number): boolean => {
      // (not the ground: it's a collider too, a slab under the whole lot)
      for (const b of all) if (b.max.y > 0.1 && x > b.min.x - 0.45 && x < b.max.x + 0.45 && z > b.min.z - 0.45 && z < b.max.z + 0.45 && b.min.y < 1.6) return true;
      return false;
    };
    const OUT = 0.75;
    for (const box of groups.values()) {
      const sx = box.max.x - box.min.x;
      const sz = box.max.z - box.min.z;
      if (sx > 18 || sz > 18) continue;
      const add = (x: number, z: number): void => {
        if (Math.abs(x) > 68 || z > -8 || z < -178) return;
        if (blocked(x, z)) return;
        this.coverSpots.push({ pos: V(x, 0, z), box, taken: null });
      };
      // Along each face, a spot every couple of metres or so
      const nx = Math.max(1, Math.round(sx / 2.4));
      for (let k = 0; k < nx; k++) {
        const x = box.min.x + ((k + 0.5) / nx) * sx;
        add(x, box.min.z - OUT);
        add(x, box.max.z + OUT);
      }
      const nz = Math.max(1, Math.round(sz / 2.4));
      for (let k = 0; k < nz; k++) {
        const z = box.min.z + ((k + 0.5) / nz) * sz;
        add(box.min.x - OUT, z);
        add(box.max.x + OUT, z);
      }
    }
  }

  private spawnAgent(at: HQSpawn): void {
    const L = this.level;
    const pos = at.pos.clone().add(V((Math.random() - 0.5) * 2.5, 0, (Math.random() - 0.5) * 2.5));
    const e = new Enemy(pos, at.yaw, 300 + this.spawned, { name: 'EC OPERATIVE' });
    armWithAK(e);
    const armour = Math.random() < 0.4;
    if (armour) e.wearArmour();
    e.setAiming(true);
    this.scene.add(e.root);
    for (const part of e.parts) L.shootables.push(part);
    const ai = new EnemyAI(e, {
      player: this.player,
      waypoints: L.waypoints,
      occluders: L.occluders,
      colliders: L.colliders,
      bus: this.ctx.bus,
      audio: this.ctx.audio,
      enemyFire: (x) => this.enemyFire(x),
      coverSpots: this.coverSpots
    });
    ai.alert(this.player.position);
    const a: Agent = { e, hp: armour ? ARMOURED_HP : AGENT_HP, armour, ai, pooled: false, push: 2 + Math.random() * 3 };
    this.agents.push(a);
    this.agentOf.set(e, a);
    this.spawned++;
  }

  /**
   * A wave comes out one man a frame, not all in one: each is a whole
   * hitman built and uploaded (several ms), and eight at once was a 40 ms
   * hitch as the fight began. Queued, they count as up already, so every
   * count and the HUD read as they always did.
   */
  private waveQueue: HQSpawn[] = [];

  /** The Collective's men up and fighting, with any of a wave still coming out. */
  private agentsUp(): number {
    return this.agents.filter((a) => a.e.alive).length + this.waveQueue.length;
  }

  private updateAgents(dt: number): void {
    const next = this.waveQueue.shift();
    if (next) this.spawnAgent(next);
    for (const a of this.agents) {
      const e = a.e;
      // Pressing in: every few seconds, those out of sight of him are told where he is now
      if (e.alive && a.ai && !this.cutscene && this.player.alive) {
        a.push -= dt;
        if (a.push <= 0) {
          a.push = 3.5 + Math.random() * 2.5;
          if (e.position.distanceTo(this.player.position) > 15) a.ai.alert(this.player.position);
        }
      }
      if (e.alive && a.ai && !this.cutsceneFreeze) a.ai.update(dt);
      e.update(dt);
      if (!e.alive && e.settled && !a.pooled) {
        a.pooled = true;
        this.poolUnder(e);
        for (const p of e.parts) {
          const k = this.level.shootables.indexOf(p);
          if (k >= 0) this.level.shootables.splice(k, 1);
        }
        this.corpses.push(a);
      }
    }
    // The oldest go once there are more than a few: drawn and simulated, they were costing every frame
    while (this.corpses.length > MAX_CORPSES) {
      // (a jetpack man still coming down, his pack burning, isn't done with yet)
      if (this.jets.some((j) => j.e === this.corpses[0].e)) break;
      const old = this.corpses.shift()!;
      old.e.removeCorpse();
      this.agentOf.delete(old.e);
      const k = this.agents.indexOf(old);
      if (k >= 0) this.agents.splice(k, 1);
    }
  }

  private corpses: Agent[] = [];

  // ------------------------------------------------------------- jetpacks

  /** One of the jetpack men, coming in high from the building's end of the lot. */
  private spawnJet(): void {
    const L = this.level;
    const p = this.player.position;
    // Out ahead of the front line, like the men on foot: never in over the van once the crew have left it
    const from = V((Math.random() - 0.5) * 80, 24 + Math.random() * 8, Math.max(-175, Math.min(p.z - 70, this.frontZ() - SPAWN_AHEAD - 40) - Math.random() * 20));
    const e = new Enemy(from, 0, 360 + this.jetsSpawned, { name: 'EC JETPACK' });
    armWithAK(e);
    e.setAiming(true);
    this.scene.add(e.root);
    for (const part of e.parts) L.shootables.push(part);
    const a: Agent = { e, hp: JET_HP, armour: false, ai: null, pooled: false, push: 0 };
    this.agents.push(a);
    this.agentOf.set(e, a);
    this.spawned++;
    const jet = new JetpackTrooper(e, {
      target: () => this.player.position,
      fire: (x) => this.enemyFire(x),
      crash: (t, at, vel) => this.jetCrash(t, at, vel),
      particles: this.particles
    });
    this.jets.push(jet);
    this.jetOf.set(e, jet);
    this.jetLoops.set(jet, this.ctx.audio.jetpackLoop());
    this.jetsSpawned++;
    if (!this.jetWarned) {
      this.jetWarned = true;
      this.say([{ who: 'DEV', text: 'Jetpacks! Up high — shoot them out of the sky!', dur: 2.6 }]);
    }
  }

  private updateJets(dt: number): void {
    // More of them while the fight's on: one or two up at a time
    if ((this.phase === 'towers' || this.phase === 'advance') && this.player.alive) {
      this.jetT -= dt;
      const up = this.jets.filter((j) => j.alive).length;
      // Only while there are more of them to come on the ground (the count to clear stays finite)
      const more = this.phase === 'towers' ? this.phaseSpawned < TOWER_QUOTA : this.advanceSpawned < ADVANCE_QUOTA;
      if (this.jetT <= 0 && up < 2 && this.jetsSpawned < 12 && more) {
        this.jetT = 13 + Math.random() * 9;
        this.spawnJet();
      }
    }
    const cam = this.player.camera.position;
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.update(dt);
      const loop = this.jetLoops.get(j);
      if (loop) {
        loop.setDistance(j.e.position.distanceTo(cam));
        loop.setThrust(j.thrust);
      }
      if (j.state === 'done') this.jets.splice(i, 1);
    }
  }

  /** Shot down (by a round, or caught in a blast): into its death spiral. */
  private downJet(j: JetpackTrooper, dir: THREE.Vector3, byRavi: boolean): void {
    if (!j.alive) return;
    this.jetByRavi.set(j, byRavi);
    j.shotDown(dir);
    this.ctx.audio.electricCrackle(j.e.position.distanceTo(this.player.camera.position));
    if (byRavi) this.ctx.bus.emit(Events.HitMarker, { lethal: true });
  }

  /** Into the ground: the pack blows, he's thrown, the pack goes cartwheeling off burning. */
  private jetCrash(j: JetpackTrooper, at: THREE.Vector3, vel: THREE.Vector3): void {
    this.jetLoops.get(j)?.stop();
    this.jetLoops.delete(j);
    const e = j.e;
    // The pack, off him and flying
    const pk = j.pack;
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    pk.getWorldPosition(wp);
    pk.getWorldQuaternion(wq);
    pk.removeFromParent();
    this.scene.add(pk);
    pk.position.copy(wp).setY(Math.max(0.5, wp.y));
    pk.quaternion.copy(wq);
    const ox = (Math.random() - 0.5) * 6;
    const oz = (Math.random() - 0.5) * 6;
    this.debrisFx.add({ obj: pk, vel: V(vel.x * 0.25 + ox, 7 + Math.random() * 4, vel.z * 0.25 + oz), spin: V((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 16), size: 0.35, fire: 7, smoke: 10 });
    const ground = at.clone().setY(0.4);
    this.explode(ground, V(0, 1, 0), 'grenade', this.jetByRavi.get(j) ?? true);
    this.particles.sparks(ground, V(0, 1, 0), 50);
    // And him: thrown up out of it
    if (e.alive) {
      const dir = vel.clone().normalize();
      this.killEnemy(e, e.position.clone().setY(Math.max(0.6, e.position.y + 0.8)), dir, this.jetByRavi.get(j) ?? true, false, 'torso', 1.6, { wound: false });
      e.launch(V(vel.x * 0.3 + (Math.random() - 0.5) * 3, 6 + Math.random() * 3, vel.z * 0.3 + (Math.random() - 0.5) * 3));
    }
  }

  /** Somewhere out in the lot, every few seconds: the crew's grenades, the Collective's, a car going up. */
  private updateBooms(dt: number): void {
    if ((this.phase !== 'towers' && this.phase !== 'advance') || !this.player.alive) return;
    this.boomT -= dt;
    if (this.boomT > 0) return;
    this.boomT = 3.5 + Math.random() * 5.5;
    const p = this.player.position;
    const ok = (x: number, z: number): boolean => {
      if (Math.hypot(x - p.x, z - p.z) < 17) return false;
      if (Math.abs(x) > 70 || z > -6 || z < -172) return false;
      for (const c of this.crew) if (Math.hypot(x - c.position.x, z - c.position.z) < 7) return false;
      return true;
    };
    // Sometimes it's one of the cars
    if (Math.random() < 0.35 && this.cars.count) {
      const pos = new THREE.Vector3();
      for (let k = 0; k < 12; k++) {
        const id = Math.floor(Math.random() * this.cars.count);
        if (this.cars.state(id) !== 'parked') continue;
        this.cars.position(id, pos);
        if (!ok(pos.x, pos.z) || pos.distanceTo(p) > 70) continue;
        this.cars.rocketBlast(pos.clone().add(V((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)), 3.2, p);
        this.explode(pos.clone().setY(0.6), V(0, 1, 0), 'grenade', false);
        return;
      }
    }
    for (let k = 0; k < 10; k++) {
      const x = p.x + (Math.random() - 0.5) * 100;
      const z = p.z - 8 - Math.random() * 55;
      if (!ok(x, z)) continue;
      const at = V(x, 0.3, z);
      this.explode(at, V(0, 1, 0), 'grenade', false);
      this.particles.dust(at, 3, 1.2);
      this.particles.concreteChips(at, V(0, 1, 0), 0x6a6862);
      return;
    }
  }

  /** In the opening, nobody's out yet to fight. */
  private get cutsceneFreeze(): boolean {
    return this.phase === 'arrive';
  }

  /** What the crew can shoot at: the Collective's men, and the towers' guns. */
  private crewTargets(): CrewTarget[] {
    const out: CrewTarget[] = [];
    for (const a of this.agents) {
      if (!a.e.alive) continue;
      const jet = this.jetOf.get(a.e);
      if (jet && !jet.alive) continue;
      out.push({ pos: a.e.position.clone().setY(a.e.position.y + 1.42), kind: 'man', ref: a });
    }
    for (const tw of this.towers) if (tw.alive) out.push({ pos: tw.gunWorld(), kind: 'turret', ref: tw });
    return out;
  }

  /** One of the crew's rounds: a real bullet, a little scatter on it. */
  private crewShot(who: Enemy, from: THREE.Vector3, at: THREE.Vector3, t: CrewTarget): void {
    const spread = t.kind === 'man' ? 0.03 : 0.03;
    const dir = at.sub(from).normalize();
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    const end = this.castBullet(from, dir, who);
    this.particles.tracer(from, end, 0xffe6b8);
    this.ctx.audio.enemyGunshot(from.distanceTo(this.player.position) * 1.1);
  }

  /**
   * One of the Collective fires at Ravi: the usual roll on distance and how
   * fast he's moving, and cover — something solid between them takes the
   * round. Never during a cutscene, and less once the crew are drawing
   * their fire at the end.
   */
  protected enemyFire(enemy: Enemy): void {
    const { audio, bus } = this.ctx;
    const player = this.player;
    const dist = player.position.distanceTo(enemy.position);
    audio.enemyGunshot(dist);
    enemy.flashMuzzle();
    bus.emit(Events.Sound, { position: enemy.position.clone(), radius: 25, kind: 'gunshot' });
    const muzzle = enemy.muzzleWorld();
    const speed = Math.min(1, player.currentSpeed / 6.6);
    let chance = 0.45 - dist * 0.02 - speed * 0.25 - (player.crouching ? 0.1 : 0);
    const chest = player.eyePosition();
    chest.y -= player.crouching ? 0.3 : 0.45;
    const to = chest.clone().sub(muzzle);
    const len = to.length();
    to.divideScalar(len);
    const cover = this.rayBoxes(muzzle, to, len - 0.4);
    if (cover) chance *= player.crouching ? 0.1 : 0.3;
    if (this.phase === 'hole') chance *= 0.35;
    chance = THREE.MathUtils.clamp(chance, 0.03, 0.85);
    if (this.cutscene) chance = 0;
    if (Math.random() < chance && player.alive) {
      const target = player.eyePosition().add(V((Math.random() - 0.5) * 0.2, -0.2 - Math.random() * 0.4, (Math.random() - 0.5) * 0.2));
      this.particles.tracer(muzzle, target, 0xffe0b0);
      player.hit(enemy.name, muzzle);
      return;
    }
    if (cover) {
      this.particles.tracer(muzzle, cover, 0xffe0b0);
      this.particles.concreteChips(cover, HQScene.tmpN.clone(), 0x9a958c);
      const near = cover.distanceTo(player.position);
      if (near < 3 && player.alive) audio.ricochet(near);
      return;
    }
    const target = player.eyePosition();
    const off = 0.4 + Math.random() * 0.8;
    target.add(V((Math.random() - 0.5) * off * 2, (Math.random() - 0.5) * off, (Math.random() - 0.5) * off * 2));
    const dir = target.sub(muzzle).normalize();
    const end = this.castBullet(muzzle, dir, enemy);
    this.particles.tracer(muzzle, end, 0xffe0b0);
    if (player.alive && !this.cutscene) audio.bulletWhiz();
  }

  /** Where a ray first meets the level's boxes within `far`; the face's normal is left in tmpN. */
  private rayBoxes(from: THREE.Vector3, dir: THREE.Vector3, far: number): THREE.Vector3 | null {
    this.ray.set(from, dir);
    let best = far;
    let box: THREE.Box3 | null = null;
    const p = HQScene.tmpC;
    for (const c of this.level.colliders) {
      if (c.disabled || c.box.max.y < 0.05) continue;
      if (c.box.containsPoint(from)) continue;
      if (!this.ray.intersectBox(c.box, p)) continue;
      const d = p.distanceTo(from);
      if (d > 0.05 && d < best) {
        best = d;
        box = c.box;
      }
    }
    if (!box) return null;
    const at = from.clone().addScaledVector(dir, best);
    const faces: [number, number, number, number][] = [
      [Math.abs(at.x - box.min.x), -1, 0, 0], [Math.abs(at.x - box.max.x), 1, 0, 0],
      [Math.abs(at.y - box.min.y), 0, -1, 0], [Math.abs(at.y - box.max.y), 0, 1, 0],
      [Math.abs(at.z - box.min.z), 0, 0, -1], [Math.abs(at.z - box.max.z), 0, 0, 1]
    ];
    let f = faces[0];
    for (const g of faces) if (g[0] < f[0]) f = g;
    HQScene.tmpN.set(f[1], f[2], f[3]);
    at.addScaledVector(HQScene.tmpN, 0.004);
    return at;
  }

  /** Nothing solid between two points? */
  private clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dist = a.distanceTo(b);
    if (dist < 0.01) return true;
    const dir = HQScene.tmpB.copy(b).sub(a).divideScalar(dist);
    this.ray.set(a, dir);
    const p = HQScene.tmpN;
    for (const c of this.level.colliders) {
      if (c.disabled || c.box.max.y < 0.05) continue;
      if (c.box.containsPoint(a) || c.box.containsPoint(b)) continue;
      if (this.ray.intersectBox(c.box, p) && p.distanceTo(a) < dist - 0.2) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- turrets

  /** Who each tower's gun is after: Ravi if it can see him, often; one of the crew otherwise; nobody, sweeping. */
  private updateTurrets(dt: number): void {
    const p = this.player;
    const chest = HQScene.tmpA;
    for (const tw of this.towers) {
      tw.camDist = tw.pos.distanceTo(p.camera.position);
      tw.update(dt);
      if (!tw.alive || this.phase === 'arrive') continue;
      if (tw.firing) {
        // Tracking whoever it's on
        if (tw.target?.ravi) tw.target.pos.copy(p.eyePosition()).setY(p.position.y + (p.crouching ? 0.75 : 1.25));
        continue;
      }
      tw.userData.next -= dt;
      if (tw.target?.ravi) tw.target.pos.copy(p.eyePosition()).setY(p.position.y + (p.crouching ? 0.75 : 1.25));
      if (tw.userData.next > 0) continue;
      tw.userData.next = 0.5 + Math.random() * 0.8;
      const gun = tw.gunWorld(HQScene.tmpB);
      chest.copy(p.position).setY(p.position.y + (p.crouching ? 0.75 : 1.25));
      const seesRavi = p.alive && !this.cutscene && tw.canReach(chest) && this.clearLine(gun, chest);
      if (seesRavi && Math.random() < 0.7) {
        tw.target = { pos: chest.clone(), ravi: true };
        continue;
      }
      const crew = this.crew.filter((e) => e.alive && e.root.parent === this.scene && tw.canReach(e.position));
      const c = crew[Math.floor(Math.random() * crew.length)];
      if (c && Math.random() < 0.8) tw.target = { pos: c.position.clone().setY(1.2), ravi: false };
      else tw.target = null;
    }
  }

  /** A round from a turret: at Ravi, it's cover and the roll; anyone else, near enough to make them duck. */
  private turretShot(tw: OutpostTower, from: THREE.Vector3, to: THREE.Vector3, tg: TurretTarget): void {
    const { audio } = this.ctx;
    const p = this.player;
    audio.turretShot(from.distanceTo(p.camera.position));
    this.flashPool.flash(from, 18);
    this.particles.muzzleFlash(from, to.clone().sub(from).normalize());
    if (tg.ravi && p.alive && !this.cutscene) {
      const dir = to.clone().sub(from);
      const len = dir.length();
      dir.divideScalar(len);
      const cover = this.rayBoxes(from, dir, len - 0.3);
      if (cover) {
        this.particles.tracer(from, cover, 0xffc890);
        this.particles.concreteChips(cover, HQScene.tmpN.clone(), 0x9a958c);
        if (Math.random() < 0.3) this.particles.sparks(cover, HQScene.tmpN.clone(), 4, 0);
        const near = cover.distanceTo(p.position);
        if (near < 4) audio.ricochet(near);
        return;
      }
      // A burst that was always going to find him finds him a few rounds in; the rest walk round him
      tw.userData.shot++;
      if (tw.userData.willHit && !tw.userData.hitThisBurst && tw.userData.shot >= 3) {
        tw.userData.hitThisBurst = true;
        this.particles.tracer(from, to, 0xffc890);
        p.hit('AN EC TURRET', from);
        return;
      }
      const miss = to.clone().add(V((Math.random() - 0.5) * 2.4, (Math.random() - 0.4) * 1.6, (Math.random() - 0.5) * 2.4));
      const md = miss.sub(from).normalize();
      const end = this.castBullet(from, md, null);
      this.particles.tracer(from, end, 0xffc890);
      if (end.distanceTo(p.position) < 4) audio.bulletWhiz();
      return;
    }
    // At the crew, or the van
    const aim = to.clone().add(V((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.6));
    const dir = aim.sub(from).normalize();
    const end = this.castBullet(from, dir, null);
    this.particles.tracer(from, end, 0xffc890);
    if (this.phase === 'arrive' && end.distanceTo(this.van.group.position) < 5) this.particles.sparks(end, V(0, 1, 0), 3);
    for (let i = 0; i < this.crew.length; i++) if (this.crew[i].position.distanceTo(end) < 2.5) this.crewAI[i].flinch();
  }

  /**
   * The odds a turret's burst on Ravi lands one: fair if he's stood still in
   * the open, a good deal less on the move or down low, and slim tucked in
   * behind something — the guns fire down from fifteen metres, so it's the
   * cover right by him that counts.
   */
  private turretOdds(tw: OutpostTower): number {
    const p = this.player;
    const gun = tw.gunWorld(HQScene.tmpB);
    // (They fire twice as often as they did: each burst's odds are a bit lower to keep a hit on him rare)
    let k = 0.38 - Math.max(0, gun.distanceTo(p.position) - 30) * 0.004;
    const speed = Math.min(1, p.currentSpeed / 6.6);
    k *= 1 - 0.5 * speed;
    if (p.crouching) k *= 0.4;
    // Something solid a step or two toward the tower from him, waist high
    const to = HQScene.tmpC.set(gun.x - p.position.x, 0, gun.z - p.position.z).normalize();
    const probe = HQScene.tmpA;
    let covered = false;
    for (const d of [0.8, 1.6, 2.4]) {
      probe.set(p.position.x + to.x * d, p.position.y + 0.6, p.position.z + to.z * d);
      if (this.level.colliders.some((c) => !c.disabled && c.box.max.y > p.position.y + 0.75 && c.box.containsPoint(probe))) {
        covered = true;
        break;
      }
    }
    if (covered) k *= p.crouching ? 0.25 : 0.55;
    return THREE.MathUtils.clamp(k, 0.02, 0.5);
  }

  private onTowerEvent(tw: OutpostTower, e: string, at: THREE.Vector3): void {
    const { audio } = this.ctx;
    const d = at.distanceTo(this.player.camera.position);
    if (e === 'servo') audio.turretServo(d);
    else if (e === 'lock') {
      tw.userData.hitThisBurst = false;
      tw.userData.shot = 0;
      tw.userData.willHit = !!tw.target?.ravi && Math.random() < this.turretOdds(tw);
      if (tw.target?.ravi) {
        audio.lockBeep();
        this.hud.setAlert(true);
        this.later(0.9, () => this.hud.setAlert(false));
      }
    } else if (e === 'boom') {
      audio.explosion(d);
      this.flashBlast(at, 1);
      this.shake = Math.max(this.shake, THREE.MathUtils.clamp(1.2 - d / 60, 0.1, 0.8));
    } else if (e === 'creak') audio.towerCollapse(d);
    else if (e === 'crash') {
      audio.stomp(d);
      audio.carCrash(d, true);
      this.shake = Math.max(this.shake, THREE.MathUtils.clamp(1 - d / 80, 0.1, 0.7));
      this.cars.blast(at, 9);
    }
  }

  // ------------------------------------------------------------ explosions

  /** A rocket's flight a→b: the first thing it meets — a tower, something solid, one of them. */
  private rocketHit(a: THREE.Vector3, b: THREE.Vector3): { t: number; direct: boolean } | null {
    let best = 2;
    const d = HQScene.tmpC.copy(b).sub(a);
    const len = d.length();
    if (len < 1e-6) return null;
    this.ray.set(a, d.clone().divideScalar(len));
    const p = HQScene.tmpN;
    const test = (box: THREE.Box3): void => {
      if (box.containsPoint(a)) return;
      if (this.ray.intersectBox(box, p)) {
        const t = p.distanceTo(a) / len;
        if (t < best) best = t;
      }
    };
    for (const tw of this.towers) if (tw.alive) test(tw.bounds);
    for (const c of this.level.colliders) if (!c.disabled && c.box.max.y > 0.05) test(c.box);
    for (const ag of this.agents) {
      if (!ag.e.alive) continue;
      const c = ag.e.position;
      const box = new THREE.Box3(V(c.x - 0.35, c.y, c.z - 0.35), V(c.x + 0.35, c.y + 1.8, c.z + 0.35));
      test(box);
    }
    return best <= 1 ? { t: best, direct: false } : null;
  }

  private explode(pos: THREE.Vector3, dir: THREE.Vector3, kind: 'rocket' | 'grenade', byRavi = true): void {
    const { audio } = this.ctx;
    const p = this.player;
    const at = pos.clone();
    if (at.y < 0.3) at.y = 0.3;
    const big = kind === 'rocket';
    this.particles.explosion(at, big ? 4 : 3.2);
    this.particles.sparks(at, V(0, 1, 0), big ? 30 : 18);
    const dist = at.distanceTo(p.camera.position);
    audio.explosion(dist);
    this.flashBlast(at, big ? 1 : 0.7);
    this.shake = Math.max(this.shake, THREE.MathUtils.clamp((big ? 1.3 : 1) - dist / 40, 0, 1));
    this.ctx.bus.emit(Events.Sound, { position: at.clone(), radius: 40, kind: 'gunshot' });
    // A tower near enough goes
    if (big) {
      for (const tw of this.towers) {
        if (!tw.alive) continue;
        if (tw.bounds.distanceToPoint(at) < TOWER_REACH) this.towerDown(tw, at);
      }
    }
    // The men round it
    const kill = big ? ROCKET_KILL : NADE_KILL;
    for (const a of this.agents) {
      const e = a.e;
      if (!e.alive) continue;
      // A jetpack man caught in it: the pack's gone
      const jet = this.jetOf.get(e);
      if (jet) {
        if (jet.alive && e.position.distanceTo(at) < kill + 1) this.downJet(jet, HQScene.tmpA.copy(e.position).sub(at).normalize(), byRavi);
        continue;
      }
      const d = Math.hypot(e.position.x - at.x, e.position.z - at.z);
      if (d > kill * 1.6) continue;
      if (d > kill) {
        e.flinch(1);
        a.ai?.alert(this.player.position);
        continue;
      }
      const away = HQScene.tmpA.set(e.position.x - at.x, 0, e.position.z - at.z);
      if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
      away.normalize();
      const chest = e.position.clone().setY(e.position.y + 1.2);
      this.killEnemy(e, chest, away.clone().setY(0.6).normalize(), byRavi, false, 'torso', 2.4, { wound: false });
      const k = (1 - d / kill) * (big ? 9 : 7) + 2;
      e.launch(V(away.x * k, 3 + k * 0.5, away.z * k));
    }
    // The crew: caught close by it, they're killed and thrown (all but Sanjay, who has to get Ravi inside); further out, they duck
    for (let i = 0; i < this.crew.length; i++) {
      const c = this.crew[i];
      if (!c.alive || c.root.parent !== this.scene) continue;
      const d = Math.hypot(c.position.x - at.x, c.position.z - at.z);
      if (d < kill && c !== this.sanjay && !this.cutscene) this.killCrew(i, at, kill, big);
      else if (d < 7) this.crewAI[i].flinch();
    }
    // A rocket among the cars throws them: the nearest blow up, the rest flip (none onto Ravi)
    // Among the cars it throws them: the nearest blow up, the rest flip (none onto Ravi); a grenade's reach is shorter
    this.cars.rocketBlast(at, big ? 7.5 : 4.8, p.alive ? p.position : null);
    // Ravi, if he's too close
    if (p.alive && !this.cutscene) {
      const d = Math.hypot(p.position.x - at.x, p.position.z - at.z);
      const hurt = big ? ROCKET_HURT : NADE_HURT;
      const by = !byRavi ? 'A BLAST' : kind === 'rocket' ? 'HIS OWN ROCKET' : 'HIS OWN GRENADE';
      if (d < hurt * 0.4) this.hurtRavi(4, by);
      else if (d < hurt) this.hurtRavi(d < hurt * 0.7 ? 2 : 1, by);
    }
    void dir;
  }

  /** One of the crew blown off his feet by a blast at `at`: dead, thrown away from it, his AI stood down. */
  private killCrew(i: number, at: THREE.Vector3, reach: number, big: boolean): void {
    const e = this.crew[i];
    const away = HQScene.tmpA.set(e.position.x - at.x, 0, e.position.z - at.z);
    if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
    away.normalize();
    const d = Math.hypot(e.position.x - at.x, e.position.z - at.z);
    const chest = e.position.clone().setY(e.position.y + 1.2);
    e.die(chest, away.clone().setY(0.6).normalize(), this.world, 'torso', 2.4, { wound: false });
    const k = (1 - d / reach) * (big ? 9 : 7) + 2;
    e.launch(V(away.x * k, 3 + k * 0.5, away.z * k));
    this.crewAI[i].state = 'idle';
    this.spatter(chest, away.clone().setY(0.3).normalize(), true);
    this.later(1.2, () => this.poolUnder(e));
  }

  /** Somewhere out in the lot, a grenade or a car going up: seen and heard, nobody hurt. */
  private distantBlast(at: THREE.Vector3): void {
    this.particles.explosion(at, 3);
    this.particles.sparks(at, V(0, 1, 0), 20);
    this.ctx.audio.explosion(at.distanceTo(this.player.camera.position));
    this.flashBlast(at, 0.8);
  }

  private flashBlast(at: THREE.Vector3, k: number): void {
    this.blast.position.copy(at).setY(Math.max(1.2, at.y));
    this.blastK = Math.max(this.blastK, k);
  }

  private hurtRavi(n: number, by: string): void {
    const p = this.player;
    if (!p.alive) return;
    const per = p.damagePerHit;
    p.damagePerHit = n;
    p.hit(by);
    p.damagePerHit = per;
  }

  private towerDown(tw: OutpostTower, at: THREE.Vector3): void {
    tw.destroy(at, this.debrisFx, this.particles, this.scene);
    // A big deal: the screen flashes, time stutters for a moment, the ground
    // shakes (hard close up, still felt from across the lot), a deep boom
    const d = Math.hypot(this.player.position.x - tw.pos.x, this.player.position.z - tw.pos.z);
    if (d < 95) this.shake = Math.max(this.shake, 0.6 + 0.85 * Math.max(0, 1 - d / 60));
    this.flashBlast(tw.gunWorld(), 1.6);
    this.slowT = 0.55;
    this.whiteout.style.transition = 'none';
    this.whiteout.style.opacity = String(THREE.MathUtils.clamp(0.95 - d / 140, 0.35, 0.85));
    void this.whiteout.offsetWidth;
    this.whiteout.style.transition = 'opacity 0.9s ease-out';
    this.whiteout.style.opacity = '0';
    this.ctx.audio.explosion(d * 0.4);
    this.later(0.12, () => this.ctx.audio.explosion(d * 0.6));
    this.later(0.35, () => this.ctx.audio.towerCollapse(d * 0.7));
    const n = this.towersDown();
    this.hud.setCounter('TOWERS STANDING', 4 - n);
    this.setObjective(n < 4 ? `DESTROY THE OUTPOST TOWERS (${n}/4)` : '');
    this.ctx.audio.uiBeep(true);
    const cheers: Line[] = [
      { who: 'DEV', text: "Tower's down! Nice shot, Ravi!", dur: 2.4 },
      { who: 'OWEN', text: "That's two! Keep going!", dur: 2.2 },
      { who: 'NIKHIL', text: 'Three! One left!', dur: 2.2 },
      { who: 'SANJAY', text: 'That got it!', dur: 1.6 }
    ];
    if (n < 4 && !(n === 2 && !this.towers[0].alive && !this.towers[1].alive)) this.say([cheers[n - 1]]);
  }

  // ================================================================== frame

  /** A tower's just gone: half a second of slow motion, and the white-orange flash over the screen. */
  private slowT = 0;
  private whiteout!: HTMLElement;

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    if (this.slowT > 0) {
      this.slowT -= dt;
      dt *= 0.35;
    }
    this.t += dt;
    this.phaseT += dt;
    this.dtLast = dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.t < this.timers[i].at) continue;
      const fn = this.timers[i].fn;
      this.timers.splice(i, 1);
      fn();
    }
    if (this.playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();

    switch (this.phase) {
      case 'arrive':
        this.updateArrival(dt);
        break;
      case 'towers':
        this.updateTowersPhase(dt);
        break;
      case 'advance':
        this.updateAdvance(dt);
        break;
      case 'breach':
        this.updateBreach(dt);
        break;
      case 'hole':
        this.updateHole();
        break;
      case 'ending':
        this.updateEnding();
        break;
    }

    // ---- Ravi in control: the knife, the drink, the boot, a grenade, the launcher and the guns
    const cut = this.cutscene;
    const free = this.playable && input.pointerLocked;
    const tdTarget = this.stepTakedown(dt, this.agents.filter((a) => a.e.alive && !this.jetOf.has(a.e)).map((a) => a.e), !cut && this.player.alive && !this.arsenal.reloading && !this.drink.engaged && !this.dropKick.engaged && !this.nadeVm.busy && !this.launcherUp, (on) => this.hud.setTakedownHint(on));
    // F: the flashlight, when there's nobody in reach to grab (then F's the knife). Off in the cutscenes.
    if (input.wasPressed('KeyF') && free && !tdTarget && !this.inTakedown && this.player.alive) {
      this.torchOn = !this.torchOn;
      this.ctx.audio.uiBeep(this.torchOn);
    }
    this.torch.intensity = this.torchOn && !cut ? TORCH_ON : 0;
    if (input.wasPressed('KeyG') && !this.inTakedown && free && !this.arsenal.reloading && !this.dropKick.engaged && !this.nadeVm.busy) this.drink.start();
    if (!this.player.alive) this.drink.abort();
    if (input.wasPressed('KeyQ') && !this.inTakedown && free && !this.arsenal.reloading && !this.drink.engaged && this.player.grounded && !this.nadeVm.busy) {
      if (this.dropKick.start()) {
        this.player.cinematic = true;
        this.player.aiming = false;
        this.kickVictim = this.kickTarget();
        this.beginKickRun(this.kickVictim);
      }
    }
    if (this.dropKick.engaged && !this.player.alive) {
      this.dropKick.abort();
      this.player.cinematic = false;
      this.kickVictim = null;
      this.endKickRun();
    }
    this.runKick(this.dropKick, dt);
    this.dropKick.update(dt);
    // T: a grenade, if he's got one
    if (input.wasPressed('KeyT') && free && !this.inTakedown && !this.drink.engaged && !this.dropKick.engaged && !this.nadeVm.busy && !this.arsenal.reloading && !this.launcher.reloading) {
      if (this.arsenal.takeGrenade()) {
        this.nadeVm.start();
        this.hud.setGrenades(this.arsenal.grenades);
      } else {
        this.ctx.audio.dryFire();
      }
    }
    // The wheel, round the guns he's got and the launcher, whatever's in his hands now
    // (the launcher too: it used to take a number key to get off it before the wheel did anything)
    if (this.launcherOwned && free && !this.inTakedown && !this.drink.engaged && !this.dropKick.engaged && !this.nadeVm.busy && !this.arsenal.reloading && !this.launcher.reloading) {
      const w = input.consumeWheel();
      if (w) this.cycleWeapon(Math.sign(w));
    }
    // 4 the launcher, 1-3 the guns
    if (this.launcherOwned && free) {
      if (input.wasPressed('Digit4') && !this.launcherUp) this.launcherUp = true;
      if (this.launcherUp) {
        for (const [key, g] of [['Digit1', 'pistol'], ['Digit2', 'shotgun'], ['Digit3', 'rifle']] as [string, Gun][]) {
          if (input.wasPressed(key) && this.arsenal.owns(g)) {
            this.launcherUp = false;
            this.arsenal.wanted = g;
          }
        }
      }
    }
    const busy = this.drink.engaged || this.dropKick.engaged || this.inTakedown || this.nadeVm.busy || this.launcherUp || cut;
    this.arsenal.preUpdate(dt, input, { canSwitch: free, busy });
    // The launcher up only once the gun's away, and out of the way for a grenade or a can
    const launcherWant = this.launcherUp && !this.nadeVm.busy && !this.drink.engaged && !this.dropKick.engaged && !this.inTakedown;
    if (!this.launcher.handoff) {
      if (launcherWant && this.arsenal.held.stow > 0.9) this.launcher.stow = Math.max(0, this.launcher.stow - dt * 3.2);
      else if (!launcherWant) this.launcher.stow = Math.min(1, this.launcher.stow + dt * 5);
    }

    const aiming = !busy && input.rightHeld && free && !this.arsenal.reloading && !this.arsenal.switching;
    const launcherAim = this.launcherUp && input.rightHeld && free && this.launcher.stow < 0.05 && !this.launcher.reloading;
    this.player.aiming = aiming || launcherAim;
    if (!cut || this.dead) this.player.update(dt, this.level.colliders);
    this.dropKick.applyCamera(this.player);
    this.holdTakedown();

    // ---- Firing
    this.arsenal.hideSupportHand = false;
    this.arsenal.updateViewmodels(dt, aiming);
    const canFire = free && !busy;
    if (this.launcherUp && free && this.launcher.ready && input.consumeClick()) this.fireRocket();
    const fired = this.arsenal.updateFire(dt, input, canFire, (r, m, re) => {
      if (!this.launcherUp) this.hud.setAmmo(r, m, re);
    });
    if (fired) this.alertNear(this.player.position, 30);
    this.launcher.update(dt, this.player, launcherAim);
    if (this.launcherUp || this.launcher.handoff) this.hud.setAmmo(this.launcher.loaded, 1, this.launcher.reloading, 'ROCKET · 1-3 GUNS');
    else if (!this.arsenal.switching) this.hud.setAmmo(...this.arsenal.ammoReadout());
    this.hud.setPrompt(this.launcherOwned && !this.launcherUp && free ? '[ 4 ] ROCKET LAUNCHER' : null);
    this.nadeVm.update(dt);
    this.drink.update(dt, this.player);
    this.hud.setCinematic(this.takedownCinema > 0.5);
    if (!cut) {
      const zoom = this.launcherUp ? 14 * this.launcher.aimBlend : this.arsenal.zoomFov;
      const targetFov = -10 * this.takedownCinema + 74 - zoom;
      if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
        this.player.camera.fov = targetFov;
        this.player.camera.updateProjectionMatrix();
      }
    }
    this.hud.setAiming(this.launcherUp ? this.launcher.aimBlend > 0.5 : this.arsenal.aimBlend > 0.5);

    // ---- Grenades on the ground
    if (this.player.alive && !cut) {
      const room = 6 - this.arsenal.grenades;
      if (room > 0) {
        const n = this.grenades.pickUp(this.player.position, room);
        if (n > 0) {
          this.arsenal.addGrenades(n);
          this.hud.setGrenades(this.arsenal.grenades);
          this.ctx.audio.itemGet();
        }
      }
    }
    this.grenades.update(dt);

    // ---- Everyone else
    this.updateTurrets(dt);
    this.updateAgents(dt);
    this.updateJets(dt);
    this.updateBooms(dt);
    if (this.phase !== 'arrive') {
      if (this.phase !== 'ending') {
        this.paths.update(dt);
        this.crewOut();
      }
      for (let i = 0; i < this.crew.length; i++) {
        const c = this.crewAI[i];
        if (this.phase === 'breach' && c.e === this.sanjay && this.phaseT < 4.2) continue;
        if (!this.cs.get(c.e)!.out) continue;
        c.update(dt);
      }
    }
    for (const e of this.crew) e.update(dt);
    this.driver?.update(dt);
    this.rockets.update(dt);
    this.debrisFx.update(dt);
    this.updateBarks(dt);
    this.updateSubs();
    this.updateMarker();

    // ---- The world
    this.updateWeather(dt);
    this.hud.setHealth(this.player.health, this.player.regenProgress);
    this.updateDebris(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.flashPool.update(dt);
    // Nothing awake (a lot full of parked cars and settled bodies, most of the time): nothing to step
    if (this.physicsAwake()) this.world.step(1 / 60, dt, 3);
    this.cars.suspendCrush = cut;
    this.cars.update(dt, this.player, this.player.camera);
    this.applyShake(dt);
    input.endFrame();
  }

  /** One notch of the wheel: on to the next gun he has, or the launcher, round and round. */
  private cycleWeapon(dir: number): void {
    const slots: (Gun | 'launcher')[] = [...(['pistol', 'shotgun', 'rifle'] as Gun[]).filter((g) => this.arsenal.owns(g)), 'launcher'];
    const cur = this.launcherUp ? 'launcher' : this.arsenal.wanted;
    const i = Math.max(0, slots.indexOf(cur));
    const next = slots[(i + dir + slots.length) % slots.length];
    if (next === 'launcher') this.launcherUp = true;
    else {
      this.launcherUp = false;
      this.arsenal.wanted = next;
    }
    this.arsenal.showInventory();
  }

  private physicsAwake(): boolean {
    for (const b of this.world.bodies) if (b.type === CANNON.Body.DYNAMIC && b.sleepState !== CANNON.Body.SLEEPING) return true;
    return false;
  }

  /** Away it goes: from the tube that's next, at whatever's under the crosshair. */
  private fireRocket(): void {
    const { audio } = this.ctx;
    if (!this.launcher.fire()) return;
    const from = this.launcher.muzzleWorld(new THREE.Vector3());
    const cam = this.player.camera;
    const fwd = this.aimDir();
    // What the crosshair's on, within reach
    this.raycaster.set(cam.position, fwd);
    this.raycaster.far = 260;
    const objs: THREE.Object3D[] = [...this.level.shootables];
    const hit = this.raycaster.intersectObjects(objs, false).find((h) => h.distance > 1.5);
    const target = hit ? hit.point : cam.position.clone().addScaledVector(fwd, 200);
    const dir = target.clone().sub(from).normalize();
    this.rockets.fire(from.clone().addScaledVector(dir, 0.3), dir, 68);
    audio.rocketLaunch(0);
    this.flashPool.flash(from, 25);
    this.particles.muzzleFlash(from, dir);
    // The backblast
    const rear = this.launcher.rearWorld(new THREE.Vector3());
    const back = dir.clone().negate();
    for (let i = 0; i < 3; i++) this.particles.tyreSmoke(rear, back, 1.2);
    this.particles.sparks(rear, back, 10);
    this.shake = Math.max(this.shake, 0.35);
    this.alertNear(this.player.position, 45);
  }

  private aimDir(): THREE.Vector3 {
    const d = new THREE.Vector3();
    this.player.camera.getWorldDirection(d);
    return d;
  }

  /** A shot of his: the Collective's men near enough to hear come for him. */
  private alertNear(at: THREE.Vector3, r: number): void {
    for (const a of this.agents) if (a.e.alive && a.ai && a.e.position.distanceTo(at) < r) a.ai.alert(at);
  }

  /** Somebody in the crew says something now and then, while the fight's on. */
  private updateBarks(dt: number): void {
    if (this.phase !== 'towers' && this.phase !== 'advance') return;
    this.barkT -= dt;
    if (this.barkT > 0 || this.lines.length) return;
    this.barkT = 9 + Math.random() * 8;
    const pool: Line[] =
      this.phase === 'towers'
        ? [
            { who: 'MARCUS', text: 'Turret’s locking on — get down!', dur: 2.2 },
            { who: 'DEV', text: 'Reloading! Cover me!', dur: 1.8 },
            { who: 'TOMMY', text: 'Ravi, the towers! Hit the towers!', dur: 2.2 },
            { who: 'RAJ', text: 'More of them coming out of the rows!', dur: 2.2 },
            { who: 'OWEN', text: 'Stay behind the cars!', dur: 1.8 },
            { who: 'NIKHIL', text: 'They’ve got grenades on them — grab what they drop!', dur: 2.6 }
          ]
        : [
            { who: 'SANJAY', text: 'Keep moving! Don’t stop in the open!', dur: 2.2 },
            { who: 'DEV', text: 'Coming out of the building — left side!', dur: 2.2 },
            { who: 'MARCUS', text: 'Covering! Go!', dur: 1.6 },
            { who: 'RAJ', text: 'Doors either side of the stairs — watch them!', dur: 2.4 }
          ];
    this.say([pool[Math.floor(Math.random() * pool.length)]]);
  }

  // ------------------------------------------------------------- the world

  private updateWeather(dt: number): void {
    const L = this.level;
    const s = this.storm;
    s.update(dt);
    const f = s.flash;
    const p = this.player.camera.position;
    // The moon (and the lightning) follow him, its shadows over the ground round him
    const sh = this.moon;
    const target = HQScene.tmpA.set(Math.round(p.x / 4) * 4, 0, Math.round(p.z / 4) * 4);
    sh.target.position.copy(target);
    sh.position.copy(target).add(HQScene.tmpB.set(70, 160, 95));
    sh.intensity = 0.55 + 6.5 * f;
    sh.color.copy(this.moonCol).lerp(HQScene.WHITE, f);
    this.hemi.intensity = 0.9 + 2.6 * f;
    (this.scene.background as THREE.Color).copy(this.bg).lerp(this.bgFlash, f);
    (this.scene.fog as THREE.FogExp2).color.copy(this.bg).lerp(this.bgFlash, f * 0.8);
    this.scene.environmentIntensity = 0.6 + 1.6 * f;
    // Blast light dying away; borrowed in the talk as a soft fill on their faces
    this.blastK = Math.max(0, this.blastK - dt * 3.2);
    this.blast.intensity = 700 * this.blastK * this.blastK;
    // The trees in the wind
    const tr = L.trees;
    tr.flutter.value = this.t;
    tr.gust.value = s.gust;
    const wind = s.wind;
    const wl = Math.hypot(wind.x, wind.y) || 1;
    const axis = HQScene.tmpB.set(wind.y / wl, 0, -wind.x / wl);
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const sc = new THREE.Vector3();
    for (const sw of tr.list) {
      const ang = sw.give * (0.35 + 0.9 * s.gust) * (0.65 + 0.35 * Math.sin(this.t * 1.6 + sw.phase)) + 0.012 * Math.sin(this.t * 4.3 + sw.phase * 2);
      q.setFromAxisAngle(axis, ang);
      sc.setScalar(sw.scale);
      m.compose(sw.base, q, sc);
      tr.trunks.setMatrixAt(sw.index, m);
      tr.crowns.setMatrixAt(sw.index, m);
    }
    tr.trunks.instanceMatrix.needsUpdate = true;
    tr.crowns.instanceMatrix.needsUpdate = true;
    // The cloud the tower goes into, and the banks round it, lit by the lightning; drifting
    L.cloudTint.value.setRGB(0.09 + 0.3 * f, 0.098 + 0.32 * f, 0.115 + 0.4 * f);
    for (const sp of L.scud) {
      sp.userData.a += sp.userData.w * dt;
      sp.position.x = L.tower.x + Math.cos(sp.userData.a) * sp.userData.r;
      sp.position.z = L.tower.z + Math.sin(sp.userData.a) * sp.userData.r;
      (sp.material as THREE.SpriteMaterial).color.setRGB(0.022 + 0.14 * f, 0.025 + 0.15 * f, 0.032 + 0.19 * f);
    }
    // The red lights up the tower, blinking; the searchlights sweeping the cloud
    L.aviation.color.setRGB(Math.sin(this.t * 2.2) > 0 ? 1 : 0.12, 0.08, 0.04);
    L.beams.forEach((b, i) => {
      b.rotation.set(0.35 * Math.sin(this.t * 0.21 + i * 2), 0, 0.3 * Math.cos(this.t * 0.17 + i * 1.3) + (i ? -0.2 : 0.2));
    });
    // Once the wall's blown: sparks off the cable torn out with it, and the work lamp on a bad connection
    if (this.breached) {
      if (Math.random() < dt * 1.6 && L.hole.spark.distanceTo(p) < 60) {
        this.particles.electricSparks(L.hole.spark, 4 + Math.floor(Math.random() * 6));
        if (L.hole.spark.distanceTo(p) < 20) this.ctx.audio.electricCrackle(L.hole.spark.distanceTo(p));
      }
      const flick = Math.sin(this.t * 17) * Math.sin(this.t * 5.3);
      L.hole.light.intensity = flick < -0.8 ? 2 : 13 + 4 * flick;
    } else L.hole.light.intensity = 0;
    // The drums burning about the lot
    for (const b of L.burning) {
      const d = b.distanceTo(p);
      if (d > 95) continue;
      this.particles.fire(b, 0.75, 1);
      if (Math.random() < dt * 1.2) this.particles.smokeColumn(HQScene.tmpC.copy(b).setY(2.2), 0.7, 0.6);
    }
    // Rain quieter under the stairs
    const under = L.shelter.containsPoint(p);
    this.rain?.set(under ? 0.45 : 1);
  }

  private applyShake(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 1.8);
    if (this.shake <= 0) return;
    const k = this.shake * this.shake * 0.03;
    const cam = this.player.camera;
    cam.rotation.x += (Math.random() - 0.5) * k;
    cam.rotation.y += (Math.random() - 0.5) * k;
  }

  // ================================================================= deaths

  protected absorbHit(enemy: Enemy, point: THREE.Vector3, dir: THREE.Vector3, shooter: Enemy | null, part: string): boolean {
    const a = this.agentOf.get(enemy);
    if (!a) return this.crew.includes(enemy);
    const byRavi = shooter === null;
    const head = part === 'head';
    const plated = a.armour && (head || part === 'torso');
    let dmg = (AK_DAMAGE[part] ?? AK_DAMAGE.torso) * (byRavi ? GUN_SCALE[this.arsenal.firing] : CREW_SCALE);
    if (plated) dmg *= head ? ARMOUR_LETS.head : ARMOUR_LETS.torso;
    const jet = this.jetOf.get(enemy);
    if (jet && !jet.alive) {
      // Already going down: the rounds spark off him and the pack
      this.particles.sparks(point, HQScene.tmpB.copy(dir).negate(), 6);
      if (byRavi) this.ctx.bus.emit(Events.HitMarker, { lethal: false });
      return true;
    }
    a.hp -= dmg;
    if (a.hp <= 0 && jet) {
      this.particles.bloodSpray(point, dir, false, -1);
      this.downJet(jet, dir, byRavi);
      return true;
    }
    if (a.hp <= 0) return false;
    const { audio, bus } = this.ctx;
    const d = point.distanceTo(this.player.position);
    if (plated) {
      this.particles.concreteChips(point, HQScene.tmpB.copy(dir).negate(), 0x6e747c);
      this.particles.electricSparks(point, 3);
      audio.armourHit(d);
    } else {
      this.particles.bloodSpray(point, dir, false, -1);
      if (byRavi) audio.fleshHit();
    }
    if (byRavi) {
      bus.emit(Events.HitMarker, { lethal: false });
      a.ai?.alert(this.player.position);
    }
    enemy.flinch(1);
    return true;
  }

  protected killEnemy(
    enemy: Enemy,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    byPlayer: boolean,
    headshot: boolean,
    hitPart?: string,
    impulseScale = 1,
    opts: { wound?: boolean; keepWeapon?: boolean } = {}
  ): void {
    if (!enemy.alive || this.crew.includes(enemy)) return;
    enemy.die(point, dir, this.world, hitPart === 'head' ? 'head' : 'torso', impulseScale, opts);
    if (this.phase === 'advance') this.advKills++;
    else if (this.phase === 'towers') this.towerKills++;
    const a = this.agentOf.get(enemy);
    if (a) {
      a.ai?.dispose();
      a.ai = null;
    }
    // Some of them were carrying one
    if (Math.random() < DROP_CHANCE && this.grenades.pickups.length < 6) {
      const at = enemy.position.clone();
      this.later(0.4, () => this.grenades.drop(at.add(V((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6))));
    }
    if (byPlayer) this.ctx.bus.emit(Events.HitMarker, { lethal: true });
    const by = byPlayer ? 'RAVI' : 'THE CREW';
    this.ctx.bus.emit(Events.EnemyKilled, { name: enemy.name, remaining: 0, headshot, by });
  }

  private kickTarget(): Enemy | null {
    if (!this.playable) return null;
    return this.kickTargetFrom(this.agents.filter((a) => a.e.alive && !this.jetOf.has(a.e)).map((a) => a.e));
  }

  // ================================================================== input

  private onClick(): void {
    // (a few seconds of it first: he was likely still firing when he went down)
    if (this.dead && performance.now() - this.deadAt > DEATH_HOLD) this.restart();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.dead) {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') && performance.now() - this.deadAt > DEATH_HOLD) this.restart();
      return;
    }
    // Skip the arrival: straight to the towers
    if (e.code === 'Enter' && this.phase === 'arrive' && this.phaseT < T.control - 1 && !this.skipping) {
      this.skipping = true;
      this.ctx.bus.emit(Events.RestartHQ, { checkpoint: 1 });
    }
  }

  private restart(): void {
    // Past the breach he comes back past it; dying in the advance, back to the start of the advance
    const cp = this.phase === 'hole' || this.phase === 'ending' ? 3 : this.phase === 'advance' || this.phase === 'breach' ? 2 : 1;
    this.ctx.bus.emit(Events.RestartHQ, { checkpoint: cp });
  }

  // ================================================================= render

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}
