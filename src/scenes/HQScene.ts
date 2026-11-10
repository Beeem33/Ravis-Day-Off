import * as THREE from 'three';
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
import { EnemyAI } from '../entities/EnemyAI';
import { armWithAK, rackAK } from '../entities/AkModel';
import { CarSystem } from '../entities/CarSystem';
import { Rockets } from '../entities/Rockets';
import { OutpostTower, type TurretTarget } from '../entities/OutpostTower';
import { LauncherViewmodel, launcherModel } from '../entities/LauncherViewmodel';
import { GrenadeThrow, Grenades } from '../entities/Grenades';
import { CrewAI, type CrewTarget } from '../entities/CrewAI';
import { FootPaths, WALK } from '../entities/FootPaths';
import { RaviVisual, HAND, type RaviRig, type HandShape } from '../entities/RaviVisual';
import { FPSHUD } from '../ui/FPSHUD';
import { track, smooth, clamp01, yawPitchTo, wrapAngle } from './cutscene';

/**
 * HQScene — Level 12: the assault on the Exterminator Collective's
 * headquarters, at night, in a storm.
 *
 *  1. Arrival. The van comes up the road and through the security gates —
 *     one leaf thrown open, the other torn off and skidding across the lot —
 *     and slides to a stop. The towers' guns open up on it. From his seat
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

type Phase = 'arrive' | 'towers' | 'advance' | 'talk' | 'hole' | 'ending';

/** What it takes to put one of the Collective's men down. */
const AGENT_HP = 100;
const ARMOURED_HP = 150;
const AK_DAMAGE: Record<string, number> = { torso: 25, arm: 18, leg: 18, head: 100 };
const GUN_SCALE: Record<Gun, number> = { rifle: 1, pistol: 1.2, shotgun: 0.45 };
const ARMOUR_LETS = { torso: 0.6, head: 0.5 };
/** The crew's rounds hurt them less than Ravi's: they're there to help, not to win it for him. */
const CREW_SCALE = 0.65;
/** A grenade going off: kills inside KILL, hurts Ravi inside HURT. */
const NADE_KILL = 4.4;
const NADE_HURT = 4.6;
const ROCKET_KILL = 5.2;
const ROCKET_HURT = 5.0;
/** A rocket landing this close to a tower's frame brings it down. */
const TOWER_REACH = 2.8;
/** How often the dead drop a grenade. */
const DROP_CHANCE = 0.34;
/** The arrival's beats (seconds). */
const T = {
  klaxon: 1.1,
  cutB: 2.3,
  impact: 2.62,
  stop: 5.75,
  cutC: 6.3,
  door: 6.5,
  crewOut: 6.9,
  raviUp: 8.7,
  hand: 11.8,
  reach: 12.15,
  take: 12.6,
  control: 13.9
};
/** When each of the crew gets up: Sanjay and Dev first, the rest after Ravi's out of the way. */
const CREW_UP = [6.9, 7.3, 9.9, 10.25, 10.6, 10.95, 11.3];
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
  private readonly bgFlash = new THREE.Color(0x4a5470);
  private readonly moonCol = new THREE.Color(0x8ea4d0);

  // ---- The gate
  private gateL = { a: 0, w: 0 };
  private gateR: { pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; landed: boolean } | null = null;

  // ---- Third-person Ravi for the cutscenes
  private ravi: RaviRig | null = null;
  private raviGun: THREE.Group | null = null;
  private stage = new THREE.Vector3();

  // ---- UI
  private ui!: HTMLElement;
  private banner!: HTMLElement;
  private objective!: HTMLElement;
  private subs!: HTMLElement;
  private fadeEl!: HTMLElement;
  private letterbox!: HTMLElement;
  private card!: HTMLElement;
  private skipEl!: HTMLElement;
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

    const start = L.starts[Math.min(this.from, 2)];
    this.player = new FPSPlayer(start.pos.clone(), start.yaw, input, audio, bus);
    this.player.camera.far = 3200;
    this.player.camera.updateProjectionMatrix();
    this.scene.add(this.player.camera);
    this.ragdollOnDeath(() => (this.launcherUp ? null : this.arsenal.held.stow < 0.5 ? this.arsenal.active : null));

    this.particles = new ParticleManager(this.scene, { smoke: 1500 });
    this.flashPool = new MuzzleFlashPool(this.scene, 3);
    Enemy.flashPool = this.flashPool;
    this.decals = new BloodDecalSystem(this.scene);
    this.debrisFx = new Debris(this.particles, () => 0);

    this.buildLights();
    this.buildEnvironmentMap();
    this.storm = new Storm(this.player.camera, () => this.player.camera.position, L.tower);
    this.storm.shelterMin.copy(L.shelter.min);
    this.storm.shelterMax.copy(L.shelter.max);
    this.storm.onThunder = (d) => audio.thunder(d);
    this.storm.onStrike = (s) => {
      if (s.dist < 500) this.shake = Math.max(this.shake, 0.15);
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

    // ---- Parked cars
    this.cars = new CarSystem({ scene: this.scene, world: this.world, level: L, particles: this.particles, audio });
    for (const s of L.parked) this.cars.addParked(s);
    this.cars.settle();

    // ---- The van
    this.van = crewVan();
    this.van.light.intensity = 0;
    this.van.redLight.removeFromParent();
    this.van.headlights.emissiveIntensity = 2.4;
    for (const b of this.van.beams) b.intensity = 60;
    for (const m of this.van.meshes) m.castShadow = true;
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
    this.rockets.onBurst = (pos, dir) => this.explode(pos, dir, 'rocket');
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
      })
    );
    document.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);

    this.rain = audio.rainLoop();
    this.klaxon = audio.klaxonLoop();

    if (this.from === 0) this.startArrival();
    else if (this.from === 1) this.startTowers(true);
    else this.startAdvance(true);
  }

  exit(): void {
    for (const u of this.unsubs) u();
    for (const a of this.agents) a.ai?.dispose();
    this.rain?.stop();
    this.klaxon?.stop();
    this.ctx.audio.stopBossMusic(1);
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
    c.left = -48;
    c.right = 48;
    c.top = 48;
    c.bottom = -48;
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
      armWithAK(e, true);
      this.scene.add(e.root);
      e.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
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
    const stain = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.012), new THREE.MeshStandardMaterial({ color: 0xd88a86, roughness: 0.5 }));
    stain.position.set(-0.02, -0.06, -0.141);
    this.sanjay.addChestPatch(stain);
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
      <div class="intro-fade" style="opacity:1"></div>
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
  }

  private get cutscene(): boolean {
    return this.phase === 'arrive' || this.phase === 'talk' || this.phase === 'ending';
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

  /** The gate takes the van: the left leaf flung open on its hinges, the right torn off and sent skidding. */
  private crashGate(): void {
    const L = this.level;
    const g = L.gate;
    g.collider.disabled = true;
    this.gateL.w = 7.5;
    const r = g.right;
    const p = new THREE.Vector3();
    r.getWorldPosition(p);
    this.gateR = { pos: p, vel: V(-9.5, 4.6, -8.5), rot: new THREE.Euler(0, 0, 0), spin: V(-3.2, 2.0, 1.2), landed: false };
    const at = V(0, 1.4, 0);
    this.particles.sparks(at, V(0, 0.4, -1), 60);
    this.particles.concreteChips(at, V(0, 0, -1), 0x5a5e64);
    this.particles.dust(V(0, 0.1, -1), 4, 1.4);
    this.ctx.audio.gateCrash(this.player.camera.position.distanceTo(at));
    this.shake = 0.6;
  }

  private updateGate(dt: number): void {
    const L = this.level;
    // Left leaf: a hard swing open, a bounce off the wall, a wobble to rest
    if (this.gateL.w !== 0 || this.gateL.a !== 0) {
      const target = 1.42;
      const acc = (target - this.gateL.a) * 22 - this.gateL.w * 2.6;
      this.gateL.w += acc * dt;
      this.gateL.a += this.gateL.w * dt;
      if (this.gateL.a > 1.72) {
        this.gateL.a = 1.72;
        this.gateL.w = -Math.abs(this.gateL.w) * 0.35;
      }
      L.gate.left.rotation.set(0, this.gateL.a, -0.05 * Math.min(1, this.gateL.a));
    }
    // Right leaf: through the air, down flat, sliding along the wet in sparks
    const r = this.gateR;
    if (!r) return;
    const leaf = L.gate.right;
    if (!r.landed) {
      r.vel.y -= 9.8 * dt;
      r.pos.addScaledVector(r.vel, dt);
      r.rot.x += r.spin.x * dt;
      r.rot.y += r.spin.y * dt;
      r.rot.z += r.spin.z * dt;
      if (r.pos.y < 0.15 && r.vel.y < 0) {
        r.landed = true;
        r.pos.y = 0.12;
        r.vel.y = 0;
        this.particles.sparks(r.pos.clone().add(V(-3, 0.2, 0)), V(0, 1, 0), 40);
        this.particles.dust(r.pos, 3, 1);
        this.ctx.audio.carCrash(this.player.camera.position.distanceTo(r.pos), false);
      }
    } else {
      const sp = Math.hypot(r.vel.x, r.vel.z);
      if (sp > 0.05) {
        r.vel.multiplyScalar(Math.max(0, 1 - dt * 1.6));
        r.pos.addScaledVector(r.vel, dt);
        if (Math.random() < 0.6) this.particles.sparks(r.pos.clone().add(V(-3.5 + Math.random() * 7, 0.1, 0)), V(-r.vel.x, 0.5, -r.vel.z).normalize(), 3);
      }
      // Settling flat, face down
      r.rot.x += (-Math.PI / 2 - r.rot.x) * Math.min(1, dt * 6);
      r.rot.z += (0 - r.rot.z) * Math.min(1, dt * 6);
    }
    leaf.position.copy(r.pos);
    leaf.rotation.copy(r.rot);
  }

  /** The gate as it was left, for a restart: one leaf hanging open, the other lying in the lot. */
  private gateWrecked(): void {
    const g = this.level.gate;
    g.collider.disabled = true;
    this.gateL.a = 1.42;
    this.gateL.w = 0;
    g.left.rotation.set(0, 1.42, -0.05);
    g.right.position.set(-5.5, 0.12, -13.5);
    g.right.rotation.set(-Math.PI / 2, 1.9, 0);
    this.gateR = null;
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
    for (let i = 0; i < 5; i++) this.spawnAgent(L.spawns.near[i % L.spawns.near.length]);
    this.spawnT = 6;
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
    const alive = this.agents.filter((a) => a.e.alive).length;
    this.spawnT -= dt;
    const cap = 12 + this.towersDown() * 3;
    if (this.spawnT <= 0 && alive < 6 && this.spawned < cap) {
      this.spawnT = 4 + Math.random() * 3;
      const pool = this.towers[0].alive || this.towers[1].alive ? this.level.spawns.near : this.level.spawns.far;
      this.spawnAgent(this.pickSpawn(pool));
    }
    // The crew move up as the near towers fall
    if (!this.towers[0].alive && !this.towers[1].alive && !this.movedMid) {
      this.movedMid = true;
      this.crewAI.forEach((c, i) => c.goTo(this.level.posts.mid[i], 0.4 + (i % 3) * 1.2));
      this.say([{ who: 'SANJAY', text: 'Two down! Move up — next row!', dur: 2.6 }]);
    }
    if (this.towersDown() >= 4 && this.phaseT > 0.5) this.startAdvance(false);
  }

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
      this.van.setDoor(1);
      this.gateWrecked();
      this.vanCollider();
      for (const tw of this.towers) tw.wreckInstant(this.debrisFx, this.scene);
      this.crew.forEach((e, i) => {
        this.scene.add(e.root);
        e.setSitting(false);
        e.setRestCarry(false);
        this.cs.get(e)!.out = true;
        this.crewAI[i].placeAt(L.posts.far[i]);
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
      // Bounding up: half go, then the other half
      this.crewAI.forEach((c, i) => c.goTo(L.posts.far[i], i % 2 ? 2.6 : 0.3));
      this.klaxon?.set(0.5);
    }
    // The launcher's done: he lets it drop
    this.dropLauncher(!restart);
    this.hud.setCounter(null);
    this.setObjective('OBJECTIVE: ADVANCE TO THE EC HEADQUARTERS');
    for (let i = 0; i < 4; i++) this.spawnAgent(this.pickSpawn(L.spawns.podium));
    this.spawnT = 5;
    this.advanceSpawned = 4;
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
    const alive = this.agents.filter((a) => a.e.alive).length;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && alive < 6 && this.advanceSpawned < 14) {
      this.spawnT = 4.5 + Math.random() * 3;
      this.advanceSpawned++;
      this.spawnAgent(this.pickSpawn(L.spawns.podium));
    }
    // Up to the stairs with him
    if (!this.stairsMoved && p.z < -126) {
      this.stairsMoved = true;
      this.crewAI.forEach((c, i) => c.goTo(L.posts.stairs[i], i % 2 ? 2 : 0.2));
      this.say([{ who: 'MARCUS', text: 'Stairs ahead! Get to the columns!', dur: 2.4 }]);
    }
    if (p.z < -157.5 && this.player.alive) this.startTalk();
  }

  // ---------------------------------------------------------------- 4 talk

  /** Where the talk happens: beside the foot of the stairs, the hole in sight under them. */
  private startTalk(): void {
    const L = this.level;
    this.setPhase('talk');
    this.cinema(true);
    this.player.cinematic = true;
    this.player.aiming = false;
    this.launcherUp = false;
    this.stage.set(-16.2, 0, -166.5);
    // Sanjay comes running from his post
    const s = this.sanjay;
    const ai = this.crewAI[0];
    ai.state = 'idle';
    const mark = V(this.stage.x + 0.5, 0, this.stage.z - 1.35);
    s.position.set(this.stage.x + 6.5, 0, this.stage.z + 5.5);
    s.setAiming(false);
    s.setRestCarry(true);
    this.paths.walk(s, [s.position.clone(), mark], 4.6, this.stage.clone().setY(1.5));
    s.setRun(true);
    // Ravi, seen
    if (this.ravi) {
      this.ravi.root.visible = true;
      this.ravi.root.position.copy(this.stage);
      this.ravi.root.rotation.y = Math.atan2(mark.x - this.stage.x, mark.z - this.stage.z);
    }
    this.say([
      { who: 'SANJAY', text: 'Ravi! Over here — look, under the stairs.', dur: 2.6 },
      { who: 'SANJAY', text: "Wall's blown clean through. That's your way in.", dur: 2.6 },
      { who: 'SANJAY', text: "Sneak in. We'll keep them busy out here and work our way in after you.", dur: 3.4 },
      { who: 'RAVI', text: 'Got it. Don’t die out here.', dur: 2.2 }
    ], 0.5);
  }

  private updateTalk(dt: number): void {
    const t = this.phaseT;
    const L = this.level;
    const s = this.sanjay;
    this.paths.update(dt);
    if (!this.paths.has(s)) s.setRun(false);
    const hole = L.hole.centre;
    const st = this.stage;
    const r = this.ravi;
    const sanjayHead = s.position.clone().setY(1.6);
    // Sanjay: points at the hole while he talks about it, then at Ravi
    const pointing = t > 3.0 && t < 7.4;
    if (pointing) {
      const d = hole.clone().sub(s.position).setY(0).normalize();
      // In his body frame: his right +X, forward −Z
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      const bx = d.x * c - d.z * sn;
      const bz = d.x * sn + d.z * c;
      const reach = smooth((t - 3.0) / 0.4) * (1 - smooth((t - 7.0) / 0.4));
      // With his left: the rifle's in his right
      s.pose = { handL: V(-0.18 + bx * 0.62 * reach, 1.36 + 0.06 * reach - 0.45 * (1 - reach), bz * 0.62 * reach - 0.1), curl: 0.55 };
      s.setHeadLook(t < 5.2 ? hole.clone().setY(1.5) : r ? r.root.position.clone().setY(1.6) : null);
    } else {
      s.pose = null;
      s.setHeadLook(r ? r.root.position.clone().setY(1.6) : null);
    }
    if (!this.paths.has(s)) s.faceToward(st, dt, 5);
    // Ravi: looking at Sanjay, then at the hole when he's shown it, then a nod and a thumb up
    const nod = t > 10.4 && t < 11.6 ? Math.sin(((t - 10.4) / 1.2) * Math.PI * 2) * 11 : 0;
    const thumb = smooth((t - 10.6) / 0.35) * (1 - smooth((t - 12.0) / 0.4));
    const lookHole = t > 4.0 && t < 7.6;
    this.poseRavi({ nod, thumb, look: lookHole ? hole : sanjayHead });
    // ---- Shots
    const A = HQScene.tmpA;
    const B = HQScene.tmpB;
    const rp = st;
    if (t < 2.6) {
      // Over his shoulder: Sanjay running in
      A.set(rp.x - 0.9, 1.75, rp.z + 1.7);
      B.copy(s.position).setY(1.3);
      this.setCam(A, B, 52, t < 0.05 ? 1 : 0.12);
    } else if (t < 4.6) {
      // The two of them, from the side
      A.set(rp.x - 3.6, 1.55, rp.z - 0.4);
      B.set(rp.x + 0.25, 1.45, rp.z - 0.7);
      this.setCam(A, B, 46);
    } else if (t < 7.6) {
      // What he's pointing at: the hole, under the stairs — the camera in under the slab, pushing in on it
      const k = smooth((t - 4.6) / 3);
      A.set(hole.x + 6.2, 1.25, hole.z + 10.5).lerp(V(hole.x + 3.4, 1.35, hole.z + 6.2), k);
      B.copy(hole).setY(1.45);
      this.setCam(A, B, THREE.MathUtils.lerp(46, 40, k));
    } else if (t < 10.2) {
      // Sanjay, close, finishing it
      A.set(rp.x + 0.2, 1.62, rp.z - 0.3);
      B.copy(sanjayHead).setY(1.58);
      this.setCam(A, B, 38);
    } else if (t < 12.4) {
      // Ravi, close: the nod, the thumb
      A.set(rp.x + 1.1, 1.58, rp.z - 1.4);
      B.set(rp.x, 1.45, rp.z);
      this.setCam(A, B, 36);
    } else {
      // Back behind his eyes, looking at the hole
      this.endTalk();
    }
  }

  private endTalk(): void {
    const L = this.level;
    this.setPhase('hole');
    if (this.ravi) this.ravi.root.visible = false;
    const p = this.player;
    p.position.copy(this.stage);
    const look = yawPitchTo(p.eyePosition(), L.hole.centre.clone().setY(1.4));
    p.yaw = look.yaw;
    p.pitch = look.pitch;
    p.cinematic = false;
    this.camInit = false;
    p.camera.fov = 74;
    p.camera.updateProjectionMatrix();
    this.cinema(false);
    this.arsenal.equip('rifle', 1);
    // Sanjay back to the fight
    const s = this.sanjay;
    s.pose = null;
    s.setHeadLook(null);
    s.setRestCarry(false);
    this.crewAI[0].goTo(L.posts.stairs[0], 0.2);
    this.setObjective('GET INSIDE: THE HOLE UNDER THE STAIRS');
    this.ctx.input.requestPointerLock();
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

  private pickSpawn(pool: HQSpawn[]): HQSpawn {
    const p = this.player.position;
    // Somewhere not right on top of him, and not too far either
    const ok = pool.filter((s) => {
      const d = s.pos.distanceTo(p);
      return d > 22 && d < 85;
    });
    const list = ok.length ? ok : pool;
    return list[Math.floor(Math.random() * list.length)];
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
    e.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    for (const part of e.parts) L.shootables.push(part);
    const ai = new EnemyAI(e, {
      player: this.player,
      waypoints: L.waypoints,
      occluders: L.occluders,
      colliders: L.colliders,
      bus: this.ctx.bus,
      audio: this.ctx.audio,
      enemyFire: (x) => this.enemyFire(x)
    });
    ai.alert(this.player.position);
    const a: Agent = { e, hp: armour ? ARMOURED_HP : AGENT_HP, armour, ai, pooled: false, push: 2 + Math.random() * 3 };
    this.agents.push(a);
    this.agentOf.set(e, a);
    this.spawned++;
  }

  private updateAgents(dt: number): void {
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
      }
    }
  }

  /** In the opening, nobody's out yet to fight. */
  private get cutsceneFreeze(): boolean {
    return this.phase === 'arrive';
  }

  /** What the crew can shoot at: the Collective's men, and the towers' guns. */
  private crewTargets(): CrewTarget[] {
    const out: CrewTarget[] = [];
    for (const a of this.agents) if (a.e.alive) out.push({ pos: a.e.position.clone().setY(a.e.position.y + 1.42), kind: 'man', ref: a });
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
    let chance = 0.58 - dist * 0.022 - speed * 0.25 - (player.crouching ? 0.1 : 0);
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
      tw.userData.next = 1.4 + Math.random() * 1.6;
      const gun = tw.gunWorld(HQScene.tmpB);
      chest.copy(p.position).setY(p.position.y + (p.crouching ? 0.75 : 1.25));
      const seesRavi = p.alive && !this.cutscene && tw.canReach(chest) && this.clearLine(gun, chest);
      if (seesRavi && Math.random() < 0.7) {
        tw.target = { pos: chest.clone(), ravi: true };
        continue;
      }
      const crew = this.crew.filter((e) => e.root.parent === this.scene && tw.canReach(e.position));
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
    let k = 0.52 - Math.max(0, gun.distanceTo(p.position) - 30) * 0.004;
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

  private explode(pos: THREE.Vector3, dir: THREE.Vector3, kind: 'rocket' | 'grenade'): void {
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
      this.killEnemy(e, chest, away.clone().setY(0.6).normalize(), true, false, 'torso', 2.4, { wound: false });
      const k = (1 - d / kill) * (big ? 9 : 7) + 2;
      e.launch(V(away.x * k, 3 + k * 0.5, away.z * k));
    }
    for (let i = 0; i < this.crew.length; i++) if (this.crew[i].position.distanceTo(at) < 7) this.crewAI[i].flinch();
    this.cars.blast(at, big ? 5 : 3.5);
    // Ravi, if he's too close
    if (p.alive && !this.cutscene) {
      const d = Math.hypot(p.position.x - at.x, p.position.z - at.z);
      const hurt = big ? ROCKET_HURT : NADE_HURT;
      if (d < hurt * 0.4) this.hurtRavi(4, kind === 'rocket' ? 'HIS OWN ROCKET' : 'HIS OWN GRENADE');
      else if (d < hurt) this.hurtRavi(d < hurt * 0.7 ? 2 : 1, kind === 'rocket' ? 'HIS OWN ROCKET' : 'HIS OWN GRENADE');
    }
    void dir;
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

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
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
      case 'talk':
        this.updateTalk(dt);
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
    const tdTarget = this.stepTakedown(dt, this.agents.filter((a) => a.e.alive).map((a) => a.e), !cut && this.player.alive && !this.arsenal.reloading && !this.drink.engaged && !this.dropKick.engaged && !this.nadeVm.busy && !this.launcherUp, (on) => this.hud.setTakedownHint(on));
    void tdTarget;
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
    if (this.phase !== 'arrive') {
      if (this.phase !== 'talk' && this.phase !== 'ending') {
        this.paths.update(dt);
        this.crewOut();
      }
      for (let i = 0; i < this.crew.length; i++) {
        const c = this.crewAI[i];
        if (this.phase === 'talk' && c.e === this.sanjay) continue;
        if (!this.cs.get(c.e)!.out) continue;
        c.update(dt);
      }
    }
    for (const e of this.crew) e.update(dt);
    this.rockets.update(dt);
    this.debrisFx.update(dt);
    this.updateBarks(dt);
    this.updateSubs();

    // ---- The world
    this.updateWeather(dt);
    this.hud.setHealth(this.player.health, this.player.regenProgress);
    this.updateDebris(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.world.step(1 / 60, dt, 3);
    this.cars.suspendCrush = cut;
    this.cars.update(dt, this.player, this.player.camera);
    this.applyShake(dt);
    input.endFrame();
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
    sh.intensity = 0.55 + 3.6 * f;
    sh.color.copy(this.moonCol).lerp(HQScene.WHITE, f);
    this.hemi.intensity = 0.9 + 1.1 * f;
    (this.scene.background as THREE.Color).copy(this.bg).lerp(this.bgFlash, f);
    (this.scene.fog as THREE.FogExp2).color.copy(this.bg).lerp(this.bgFlash, f * 0.8);
    this.scene.environmentIntensity = 0.6 + 0.9 * f;
    // Blast light dying away; borrowed in the talk as a soft fill on their faces
    this.blastK = Math.max(0, this.blastK - dt * 3.2);
    if (this.phase === 'talk' && this.blastK < 0.05) {
      this.blast.color.setHex(0xc8d6ff);
      this.blast.position.copy(this.stage).add(HQScene.tmpC.set(1.6, 2.3, -2.2));
      this.blast.intensity = 9;
    } else {
      this.blast.color.setHex(0xffa04a);
      this.blast.intensity = 700 * this.blastK * this.blastK;
    }
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
    // The red lights up the tower, blinking; the searchlights sweeping the cloud
    L.aviation.color.setRGB(Math.sin(this.t * 2.2) > 0 ? 1 : 0.12, 0.08, 0.04);
    L.beams.forEach((b, i) => {
      b.rotation.set(0.35 * Math.sin(this.t * 0.21 + i * 2), 0, 0.3 * Math.cos(this.t * 0.17 + i * 1.3) + (i ? -0.2 : 0.2));
    });
    // Sparks off the cable by the hole
    if (Math.random() < dt * 1.6 && L.hole.spark.distanceTo(p) < 60) {
      this.particles.electricSparks(L.hole.spark, 4 + Math.floor(Math.random() * 6));
      if (L.hole.spark.distanceTo(p) < 20) this.ctx.audio.electricCrackle(L.hole.spark.distanceTo(p));
    }
    // The work lamp by the hole, on a bad connection
    const flick = Math.sin(this.t * 17) * Math.sin(this.t * 5.3);
    L.hole.light.intensity = flick < -0.8 ? 2 : 13 + 4 * flick;
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
    a.hp -= dmg;
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
    return this.kickTargetFrom(this.agents.filter((a) => a.e.alive).map((a) => a.e));
  }

  // ================================================================== input

  private onClick(): void {
    if (this.dead) this.restart();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.dead) {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') this.restart();
      return;
    }
    // Skip the arrival: straight to the towers
    if (e.code === 'Enter' && this.phase === 'arrive' && this.phaseT < T.control - 1 && !this.skipping) {
      this.skipping = true;
      this.ctx.bus.emit(Events.RestartHQ, { checkpoint: 1 });
    }
  }

  private restart(): void {
    const cp = this.phase === 'advance' || this.phase === 'talk' || this.phase === 'hole' || this.phase === 'ending' ? 2 : 1;
    this.ctx.bus.emit(Events.RestartHQ, { checkpoint: cp });
  }

  // ================================================================= render

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}
