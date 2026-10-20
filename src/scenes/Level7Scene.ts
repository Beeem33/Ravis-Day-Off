import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level7Builder, drawStatic, type Level7Data } from '../environment/Level7Builder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { FPSPlayer } from '../entities/FPSPlayer';
import { Arsenal, loadoutFor, type Gun } from '../entities/Arsenal';
import { EmoteViewmodel } from '../entities/EmoteViewmodel';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { DropKickViewmodel } from '../entities/DropKickViewmodel';
import { Enemy } from '../entities/Enemy';
import { EnemyAI } from '../entities/EnemyAI';
import { Brawl, CoverGunner, CoverShooter, GroundPound, StandGunner, coweringPose, type FightHooks } from '../entities/Skirmish';
import { armWithAK, droppedAK } from '../entities/AkModel';
import { FPSHUD } from '../ui/FPSHUD';
import { dataDrive } from '../environment/OfficeProps';

/**
 * What it takes to put one of them down. With an AK in his hands a single
 * round was always the end of a man, and the floor went down too easily:
 * here it is four in the body, one in the head — and the ones in plate
 * carriers and helmets take a good deal more.
 */
const AGENT_HP = 100;
const ARMOURED_HP = 140;
/** One of Ravi's AK rounds, by where it lands. */
const AK_DAMAGE: Record<string, number> = { torso: 25, arm: 18, leg: 18, head: 100 };
/**
 * The other two against that: a pistol round hits a little harder than one
 * of the AK's, but comes far slower; a shotgun pellet is under half of one,
 * and there are eight of them — murder up close, little at range. The AK
 * stays the gun for this floor.
 */
const GUN_SCALE: Record<Gun, number> = { rifle: 1, pistol: 1.2, shotgun: 0.45 };
/** How much of a round gets through a plate, or a helmet. */
const ARMOUR_LETS = { torso: 0.6, head: 0.5 };

/**
 * The staff's fights with the agents run on the same hit points, but slowly:
 * left alone, a fist fight goes on two minutes or more and the beating longer.
 * The deciding is meant to be Ravi's.
 */
const STAFF_HP = 100;
const PINNED_HP = 150;
const DAMAGE = { rifle: 9, pistol: 10, punch: 1.4, pound: 2.5 };
/** An agent's round gone wide, into one of the staff: it hurts, it does not always kill. */
const STRAY_DAMAGE = 30;
/** Chance a round finds the man it was fired at — when he can be seen at all. */
const HIT_CHANCE = { rifle: 0.12, pistol: 0.08 };
/** The most bullet holes the staff and agents leave between them: each one is a draw. */
const NPC_HOLES = 50;

const GUNNER_NAMES = ['MARCUS', 'KEVIN', 'DOUG', 'RAJ'];
const BRAWLER_NAMES = ['TONY', 'GREG'];
const POUNDER_NAME = 'BIG STEVE';
const COWER_NAMES = ['NEIL', 'PAUL', 'DEV'];

/** The squad that comes in when the floor is going badly for them, and how many of it are in armour. */
const SQUAD = 4;
const SQUAD_ARMOURED = 2;

type AgentRole = 'shooter' | 'brawler' | 'pinned' | 'guard' | 'squad';

/** One of the police force on this floor, and what he is busy with. */
interface Agent {
  e: Enemy;
  role: AgentRole;
  hp: number;
  armoured: boolean;
  /** Fighting Ravi: null while he is still busy with the staff, or not yet woken. */
  ai: EnemyAI | null;
  shooter: CoverShooter | null;
  brawl: Brawl | null;
  /** Seconds until he turns on Ravi, once something has told him Ravi is here; -1 until then. */
  wake: number;
  /** A guard's post, and how far he patrols from it. */
  post: { pos: THREE.Vector3; radius: number } | null;
  /** Counts toward INTRUDERS REMAINING. The man on his back does not: he is out of the fight. */
  counted: boolean;
  /** On the floor. The squad is built at the start, out of sight, and only arrives later. */
  here: boolean;
}

/** One of the staff, fighting back. */
interface Staff {
  e: Enemy;
  hp: number;
  gunner: CoverGunner | null;
  brawl: Brawl | null;
  /** Out of his fist fight: a pistol out, on his feet, shooting at the agents. */
  stand: StandGunner | null;
  /** The face of the desk he is behind: where the agents' rounds go while he is down. */
  shield: THREE.Vector3 | null;
}

type Stage = 'find' | 'fight' | 'cleared';

/**
 * Water: the burst sprinkler over the hole in the office ceiling dripping on
 * the carpet, and the pipe under the restroom basins spraying across the
 * tiles. One instanced mesh of drops, falling under gravity and respawned
 * where they came from — a single draw for all of it.
 */
class WaterFx {
  private mesh: THREE.InstancedMesh;
  private drops: { p: THREE.Vector3; v: THREE.Vector3; wait: number; src: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private d = new THREE.Vector3();
  private static ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  private static UP = new THREE.Vector3(0, 1, 0);

  constructor(
    parent: THREE.Object3D,
    private drips: THREE.Vector3[],
    private spray: { at: THREE.Vector3; dir: THREE.Vector3 }
  ) {
    const geo = new THREE.BoxGeometry(0.008, 0.06, 0.008);
    const mat = new THREE.MeshBasicMaterial({ color: 0xc4d8e8, transparent: true, opacity: 0.5, depthWrite: false });
    const perDrip = 6;
    const n = drips.length * perDrip + 28;
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    for (let i = 0; i < n; i++) {
      const src = i < drips.length * perDrip ? i % drips.length : -1;
      this.drops.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), wait: Math.random() * 1.4, src });
      this.mesh.setMatrixAt(i, WaterFx.ZERO);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (d.wait > 0) {
        d.wait -= dt;
        if (d.wait > 0) continue;
        this.spawn(d);
      }
      d.v.y -= 9.8 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y <= 0.01) {
        // Landed: gone, and another along in a moment
        d.wait = d.src >= 0 ? 0.08 + Math.random() * 0.6 : Math.random() * 0.12;
        this.mesh.setMatrixAt(i, WaterFx.ZERO);
        continue;
      }
      const speed = d.v.length();
      this.q.setFromUnitVectors(WaterFx.UP, this.d.copy(d.v).divideScalar(Math.max(1e-4, speed)));
      this.s.set(1, 0.5 + Math.min(1.8, speed * 0.3), 1);
      this.mesh.setMatrixAt(i, this.m.compose(d.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private spawn(d: { p: THREE.Vector3; v: THREE.Vector3; src: number }): void {
    if (d.src >= 0) {
      d.p.copy(this.drips[d.src]);
      d.p.x += (Math.random() - 0.5) * 0.06;
      d.p.z += (Math.random() - 0.5) * 0.06;
      d.v.set(0, -0.2, 0);
    } else {
      d.p.copy(this.spray.at);
      d.v.copy(this.spray.dir).multiplyScalar(2.2 + Math.random() * 1.3);
      d.v.x += (Math.random() - 0.5) * 0.7;
      d.v.y += (Math.random() - 0.5) * 0.5;
      d.v.z += (Math.random() - 0.5) * 0.7;
    }
  }
}

/**
 * Level7Scene — the top floor.
 *
 * Ravi comes out of the boss's office into the fight the raid has turned
 * into. The staff did not run this time: the desks are on their sides, the
 * agents are dug in along the north side of the office and the staff along
 * the south, shooting at each other over the top, with two fist fights and
 * a beating going on in the ground between. None of them are winning fast —
 * that is Ravi's job, and it is not a quick one: the agents take several
 * rounds each, some are in armour, and once the floor starts going against
 * them more come up out of the lifts. With every one of them down, the
 * stairwell door's lock lets go, and the boss went down those stairs.
 */
export class Level7Scene extends CombatScene<Level7Data> {
  private arsenal!: Arsenal;
  private emote!: EmoteViewmodel;
  private drink!: DrinkViewmodel;
  private dropKick!: DropKickViewmodel;
  private kickVictim: Enemy | null = null;
  private hud!: FPSHUD;
  private water!: WaterFx;

  private agents: Agent[] = [];
  private staff: Staff[] = [];
  private agentOf = new Map<Enemy, Agent>();
  private staffOf = new Map<Enemy, Staff>();
  private brawls: Brawl[] = [];
  private pound: GroundPound | null = null;
  private corpses: Enemy[] = [];
  private pooled = new Set<Enemy>();
  private hooks!: FightHooks;
  private remaining = 0;

  private stage: Stage = 'find';
  private over = false;
  private dead = false;
  private t = 0;
  /** Any agent on the office floor has turned on Ravi: the rest look for him too. */
  private floorAlert = false;
  /** Seconds since the floor turned on him. */
  private alertT = 0;
  /** The squad: called (and seconds until it arrives), and the ! CONTACT ! banner for it. */
  private squadCalled = false;
  private squadT = -1;
  private bannerT = 0;
  /** Seconds since the last agent on the office floor went down, or -1. */
  private clearT = -1;
  private senseT = 0;
  private sparkT = 1;
  private snowAcc = 0;
  private npcHoles = 0;
  private released = false;
  private lockedTold = false;
  private leaving = false;
  private leaveT = 0;
  private handedOff = false;

  private ui!: HTMLElement;
  private objective!: HTMLElement;
  private fadeEl!: HTMLElement;
  /** The boss, sat for his portrait on the first frame and gone after it. */
  private sitter: Enemy | null = null;
  private photoTaken = false;
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);

  private ray = new THREE.Ray();
  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();
  private static tmpC = new THREE.Vector3();
  private static tmpD = new THREE.Vector3();
  private static tmpE = new THREE.Vector3();
  private static tmpN = new THREE.Vector3();

  constructor(ctx: GameContext) {
    super(ctx);
  }

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x9fbbd8);
    // Haze from the fight; the view outside is unfogged and stays clear
    this.scene.fog = new THREE.Fog(0x2c3036, 16, 48);

    this.level = new Level7Builder().build();
    this.scene.add(this.level.group);
    this.world = this.createPhysicsWorld(this.level.colliders);
    const L = this.level;

    this.player = new FPSPlayer(L.playerSpawn, L.playerSpawnYaw, input, audio, bus);

    // Dead: he goes over as a ragdoll and the gun in his hands drops

    this.ragdollOnDeath(() => (this.arsenal.held.stow < 0.5 ? this.arsenal.active : null));
    // Far enough to see the car park and the sky round it
    this.player.camera.far = 600;
    this.player.camera.updateProjectionMatrix();
    this.scene.add(this.player.camera);

    this.emote = new EmoteViewmodel(this.player.camera);
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
      if (e === 'launch') {
        audio.kickWhoosh();
      } else if (e === 'impact') {
        const victim = this.kickVictim?.alive ? this.kickVictim : this.kickTarget();
        this.kickVictim = null;
        if (!victim) return;
        this.dropKick.hit = true;
        this.dropKickEnemy(victim);
      } else if (e === 'land') {
        audio.backLanding();
        bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 9, kind: 'footstep' });
      } else if (e === 'up') {
        audio.scuff();
      } else if (e === 'done') {
        this.player.cinematic = false;
        this.endKickRun();
      }
    };

    this.particles = new ParticleManager(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene, 4);
    Enemy.flashPool = this.flashPool;
    this.decals = new BloodDecalSystem(this.scene);
    // Everything he has picked up on the way: the pistol, the shotgun, and the
    // AK he took off the agent downstairs — that one out and ready
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
      loadoutFor('level7'),
      'rifle'
    );
    this.bakeBulletHoles(L.bulletHoles);
    this.water = new WaterFx(this.scene, L.drips, L.spray);

    this.hooks = {
      thrown: (a) => this.onThrown(a),
      landed: (a, v, at, dir, head, power) => this.onLanded(a, v, at, dir, head, power),
      fire: (s, target) => this.npcFire(s, target)
    };
    this.castFight();
    this.layOutDead();
    this.seatSitter();

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, this.remaining, this.player.maxHealth);
    this.hud.show();
    this.hud.setAmmo(...this.arsenal.ammoReadout());
    this.buildUI();

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }),
      bus.on(Events.PlayerDied, () => {
        this.dead = true;
        this.over = true;
      })
    );
    document.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);
    input.requestPointerLock();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    for (const a of this.agents) a.ai?.dispose();
    document.removeEventListener('click', this.clickHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.hud.destroy();
    this.flashPool.dispose();
    this.ui.remove();
    Enemy.flashPool = null;
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="intro-objective"></div>
      <div class="intro-fade" style="opacity:1"></div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.objective = el.querySelector('.intro-objective')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
  }

  private setObjective(text: string): void {
    if (this.objective.textContent === text) return;
    this.objective.textContent = text;
    this.objective.classList.remove('show');
    void this.objective.offsetWidth;
    this.objective.classList.add('show');
  }

  // ------------------------------------------------------------- the cast

  private addAgent(pos: THREE.Vector3, yaw: number, index: number, role: AgentRole, armour = false): Agent {
    const e = new Enemy(pos, yaw, index, { name: 'POLICE FORCE AGENT' });
    if (role !== 'pinned') armWithAK(e);
    if (armour) e.wearArmour();
    this.scene.add(e.root);
    const here = role !== 'squad';
    if (here) for (const p of e.parts) this.level.shootables.push(p);
    const a: Agent = {
      e,
      role,
      hp: role === 'pinned' ? PINNED_HP : armour ? ARMOURED_HP : AGENT_HP,
      armoured: armour,
      ai: null,
      shooter: null,
      brawl: null,
      wake: -1,
      post: null,
      counted: role !== 'pinned',
      here
    };
    this.agents.push(a);
    this.agentOf.set(e, a);
    if (a.counted) this.remaining++;
    return a;
  }

  private addStaff(pos: THREE.Vector3, yaw: number, index: number, name: string): Staff {
    const e = new Enemy(pos, yaw, index, { name, civilian: true });
    this.scene.add(e.root);
    for (const p of e.parts) this.level.shootables.push(p);
    const s: Staff = { e, hp: STAFF_HP, gunner: null, brawl: null, stand: null, shield: null };
    this.staff.push(s);
    this.staffOf.set(e, s);
    return s;
  }

  /**
   * Everyone on the floor, in the middle of it: agents shooting from their
   * line, staff shooting from theirs, two fist fights, a man on his back
   * taking a beating, staff hiding, guards posted round the rest — and a
   * squad, built now so nothing about them costs a frame later, held out of
   * sight under the floor until they are sent in.
   */
  private castFight(): void {
    const L = this.level;
    L.shooters.forEach((sp, i) => {
      const a = this.addAgent(sp.pos, sp.yaw, 20 + i, 'shooter', sp.armour);
      a.shooter = new CoverShooter(a.e, (from) => this.staffTarget(from), this.hooks, sp.kneel);
    });
    L.brawls.forEach((b, i) => {
      const a = this.addAgent(b.centre, 0, 30 + i, 'brawler');
      const s = this.addStaff(b.centre, 0, 12 + i, BRAWLER_NAMES[i]);
      const brawl = new Brawl(a.e, s.e, b.centre, b.yaw, this.hooks);
      a.brawl = brawl;
      s.brawl = brawl;
      this.brawls.push(brawl);
    });
    const P = L.pound;
    const pinned = this.addAgent(P.feet, 0, 40, 'pinned');
    const pounder = this.addStaff(P.employee.pos, P.employee.yaw, 15, POUNDER_NAME);
    pounder.hp = STAFF_HP * 2; // nobody is hitting him back
    this.pound = new GroundPound(pinned.e, pounder.e, P.feet, P.axisYaw, P.employee.pos, P.employee.yaw, this.hooks);
    // His rifle, kicked away across the carpet
    const gun = droppedAK();
    gun.position.set(P.feet.x + 0.6, 0, P.feet.z - 1.3);
    gun.rotation.y = 2.2;
    this.scene.add(gun);
    L.gunners.forEach((g, i) => {
      const s = this.addStaff(g.hide, Math.PI, 2 + i, GUNNER_NAMES[i]);
      s.gunner = new CoverGunner(s.e, g.kneel, g.hide, 0, g.brace, (from) => this.agentTarget(from), this.hooks);
      s.shield = g.shield;
    });
    L.cowering.forEach((c, i) => {
      const s = this.addStaff(c.pos, c.yaw, 17 + i, COWER_NAMES[i]);
      s.e.setSlumped(true);
      s.e.setScared();
      s.e.pose = coweringPose();
      s.e.poseCurl = 0.25;
    });
    L.guards.forEach((g, i) => {
      const a = this.addAgent(g.spot.pos, g.spot.yaw, 50 + i, 'guard', g.armour);
      a.e.setRestCarry(true, true);
      a.post = { pos: g.spot.pos.clone(), radius: g.radius };
    });
    for (let i = 0; i < SQUAD; i++) {
      const a = this.addAgent(new THREE.Vector3(i * 2, -60, 0), 0, 60 + i, 'squad', i < SQUAD_ARMOURED);
      a.e.root.visible = false;
    }
  }

  /**
   * The dead from before Ravi got here — two of the staff and an agent on
   * the office floor, and the boss's two agents where they fell in his
   * office — dropped and left to settle while the loading card is still up,
   * so they are lying still by the first frame.
   */
  private layOutDead(): void {
    const L = this.level;
    const drop = (e: Enemy, rifle: boolean): void => {
      if (!rifle) e.hideWeapon();
      this.scene.add(e.root);
      e.root.updateMatrixWorld(true);
      const chest = e.position.clone();
      chest.y += 1.25;
      const dir = new THREE.Vector3(Math.sin(e.yaw), -0.15, Math.cos(e.yaw)).normalize();
      e.die(chest, dir, this.world, Math.random() < 0.4 ? 'head' : 'torso', 0.7);
      this.corpses.push(e);
    };
    L.corpses.forEach((c, i) => {
      const e = c.civilian
        ? new Enemy(c.spot.pos, c.spot.yaw, 25 + i, { name: 'STAFF', civilian: true })
        : new Enemy(c.spot.pos, c.spot.yaw, 44, { name: 'POLICE FORCE AGENT' });
      if (!c.civilian) armWithAK(e);
      drop(e, !c.civilian);
    });
    // In the boss's office: the one Ravi punched, and the one he shot
    L.bossRoomBodies.forEach((b, i) => drop(new Enemy(b.pos, b.yaw, 3 + i * 2, { name: 'POLICE FORCE AGENT' }), false));
    const gun = droppedAK();
    gun.position.copy(L.droppedRifle.pos);
    gun.rotation.y = L.droppedRifle.yaw;
    this.scene.add(gun);
    // Let them fall
    for (let i = 0; i < 150; i++) {
      this.world.step(1 / 60);
      for (const e of this.corpses) e.update(1 / 60);
    }
    for (const e of this.corpses) {
      this.poolUnder(e);
      this.pooled.add(e);
    }
  }

  /** The boss, sat at his desk for his portrait to be taken again: the room's picture is of him. */
  private seatSitter(): void {
    const L = this.level;
    const b = new Enemy(L.bossSeat.pos, L.bossSeat.yaw, 7, { name: 'THE BOSS', boss: true });
    b.setSitting(true, true);
    b.holdProp(dataDrive(), 0.045);
    b.pose = {
      shift: new THREE.Vector3(0, -0.03, -0.13),
      handR: new THREE.Vector3(0.05, 0.965, -0.2),
      handL: new THREE.Vector3(-0.05, 0.965, -0.2),
      elbow: new THREE.Vector3(0.35, -1, -0.25),
      head: new THREE.Euler(0.1, 0, 0),
      lean: -0.4
    };
    this.scene.add(b.root);
    this.sitter = b;
  }

  // ---------------------------------------------------------------- update

  private get playable(): boolean {
    return this.player.alive && !this.over && !this.leaving;
  }

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    this.t += dt;
    if (this.sitter) this.sitter.update(dt);

    if (this.playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();

    // ---- The knife (F), the Deadbull (G) and the drop kick (Q), as downstairs
    const grab: Enemy[] = [];
    for (const a of this.agents) if (a.e.alive && a.here && a.role !== 'pinned') grab.push(a.e);
    this.stepTakedown(dt, grab, this.playable && !this.arsenal.reloading && !this.drink.engaged && !this.dropKick.engaged, (on) =>
      this.hud.setTakedownHint(on)
    );
    if (input.wasPressed('KeyG') && this.playable && input.pointerLocked && !this.arsenal.reloading && !this.dropKick.engaged && !this.inTakedown) {
      this.drink.start();
    }
    if (!this.player.alive) this.drink.abort();
    if (input.wasPressed('KeyQ') && this.playable && input.pointerLocked && !this.arsenal.reloading && !this.drink.engaged && !this.inTakedown && this.player.grounded) {
      if (this.dropKick.start()) {
        this.emote.cancel();
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
    const busy = this.drink.engaged || this.dropKick.engaged || this.inTakedown;
    // 1/2/3, and the gun going down out of the way while his hands are full
    this.arsenal.preUpdate(dt, input, { canSwitch: this.playable && input.pointerLocked, busy });

    const aiming =
      !busy && input.rightHeld && input.pointerLocked && this.playable && !this.arsenal.reloading && !this.arsenal.switching;
    this.player.aiming = aiming;
    this.player.update(dt, this.level.colliders);
    this.dropKick.applyCamera(this.player);
    this.holdTakedown();

    this.updateStory(dt);
    this.updateFight(dt);
    this.updateCast(dt);

    // ---- The guns
    if (input.wasPressed('KeyT') && this.playable && input.pointerLocked && !this.arsenal.reloading) this.emote.toggle();
    if (this.arsenal.reloading || !this.player.alive) this.emote.cancel();
    this.arsenal.hideSupportHand = this.emote.engaged;
    this.arsenal.updateViewmodels(dt, aiming);
    this.emote.update(dt, this.player);
    this.drink.update(dt, this.player);
    const targetFov = 74 - this.arsenal.zoomFov - 10 * this.takedownCinema;
    this.hud.setCinematic(this.takedownCinema > 0.5);
    if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
      this.player.camera.fov = targetFov;
      this.player.camera.updateProjectionMatrix();
    }
    this.hud.setAiming(this.arsenal.aimBlend > 0.5);
    this.updateShooting(dt, busy);

    this.updateAmbience(dt);
    this.hud.setHealth(this.player.health, this.player.regenProgress);
    this.updateDebris(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.world.step(1 / 60, dt, 3);
    input.endFrame();
  }

  /** Everyone's animation, and the bodies settling: a body is pooled and stops being a target once it lies still. */
  private updateCast(dt: number): void {
    for (const a of this.agents) if (a.here) this.tick(a.e, dt);
    for (const s of this.staff) this.tick(s.e, dt);
    for (const e of this.corpses) e.update(dt);
  }

  private tick(e: Enemy, dt: number): void {
    e.update(dt);
    if (!e.alive && e.settled && !this.pooled.has(e)) {
      this.pooled.add(e);
      this.poolUnder(e);
      for (const p of e.parts) {
        const k = this.level.shootables.indexOf(p);
        if (k >= 0) this.level.shootables.splice(k, 1);
      }
    }
  }

  // -------------------------------------------------------------- the floor

  private updateStory(dt: number): void {
    const { audio } = this.ctx;
    const L = this.level;
    const p = this.player.position;

    // In from black
    if (this.t < 1.4) this.fadeEl.style.opacity = String(Math.max(0, 1 - this.t / 1.2));
    else if (!this.leaving && this.fadeEl.style.opacity !== '0') this.fadeEl.style.opacity = '0';
    if (this.t >= 1.2 && this.t - dt < 1.2 && this.stage === 'find') this.setObjective('FIND THE BOSS');

    // Into the office: the fight is the first thing in the way
    if (this.stage === 'find' && L.officeBox.containsPoint(p)) {
      this.stage = 'fight';
      this.setObjective('CLEAR THE FLOOR');
    }

    // The office gone quiet: everyone on it down, the squad that came in for them too
    if (this.stage !== 'cleared' && this.officeLeft(true) === 0) {
      this.stage = 'cleared';
      this.clearT = 0;
      // The guards in the corridors hear it stop, and start moving about
      for (const a of this.agents) if (a.role === 'guard' && a.e.alive && !a.ai) this.postGuard(a);
      if (this.pound && !this.pound.done) this.pound.finish = true;
    }
    if (this.stage === 'cleared') {
      const was = this.clearT;
      this.clearT += dt;
      if (was < 1.2 && this.clearT >= 1.2) this.standDown();
    }

    // Every one of them down: the stairwell's lock lets go
    if (!this.released && this.remaining === 0) this.release();

    // The stairwell door
    const atDoor = this.player.alive && L.exitTrigger.containsPoint(Level7Scene.tmpA.set(p.x, p.y + 0.9, p.z));
    if (atDoor && !this.leaving) {
      if (this.released) this.leave();
      else if (!this.lockedTold) {
        this.lockedTold = true;
        audio.uiBeep(false);
        this.setObjective('LOCKED — CLEAR THE FLOOR FIRST');
      }
    } else if (!atDoor) {
      this.lockedTold = false;
    }
    if (this.leaving) this.updateLeaving(dt);
  }

  /** Agents still fighting on the office floor; with `squad`, the squad that comes in for them counts too. */
  private officeLeft(squad: boolean): number {
    let n = 0;
    for (const a of this.agents) {
      if (!a.e.alive) continue;
      if (a.role === 'shooter' || a.role === 'brawler' || (squad && a.role === 'squad')) n++;
    }
    return n;
  }

  /** The shooting has stopped: the staff stay down where they were, guns lowered, and look round at Ravi. */
  private standDown(): void {
    for (const s of this.staff) {
      if (!s.e.alive) continue;
      s.gunner?.rest();
      if (s.gunner || s.brawl) s.e.setHeadLook(this.player.camera.position);
    }
  }

  /** The stairwell door's lock lets go: red to green. */
  private release(): void {
    const L = this.level;
    this.released = true;
    L.exitPanel.emissive.setHex(0x2bff6a);
    L.exitPanel.color.setHex(0x0a2a12);
    L.exitLight.color.setHex(0x2bff6a);
    this.ctx.audio.uiBeep(true);
    this.setObjective('STAIRWELL B IS OPEN');
  }

  private leave(): void {
    this.leaving = true;
    this.leaveT = 0;
    this.setObjective('');
    this.ctx.audio.doorOpen();
    this.ctx.input.exitPointerLock();
  }

  /** To black, and down the stairs after him: the car park is the next level. */
  private updateLeaving(dt: number): void {
    this.leaveT += dt;
    this.fadeEl.style.opacity = String(Math.min(1, this.leaveT / 0.8));
    if (this.leaveT > 1.4 && !this.handedOff) {
      this.handedOff = true;
      this.ctx.bus.emit(Events.Level7Complete);
    }
  }

  // ---------------------------------------------------------------- the fight

  private updateFight(dt: number): void {
    for (const b of this.brawls) b.update(dt);
    this.pound?.update(dt);
    for (const s of this.staff) {
      s.gunner?.update(dt);
      s.stand?.update(dt);
    }

    this.senseT -= dt;
    const sense = this.senseT <= 0;
    if (sense) this.senseT = 0.15;
    for (const a of this.agents) {
      if (!a.e.alive || !a.here) continue;
      // A man in Ravi's arms is out of it
      if (a.e.beingExecuted) continue;
      if (a.ai) {
        a.ai.update(dt);
        continue;
      }
      a.shooter?.update(dt);
      if (a.wake > 0) {
        a.wake -= dt;
        if (a.wake <= 0) this.turnOnRavi(a);
      } else if (sense && a.wake < 0 && a.role !== 'pinned') {
        this.senseRavi(a);
      }
    }

    // More of them, once the floor is going against them — or has been going on too long
    if (this.floorAlert) this.alertT += dt;
    if (!this.squadCalled && (this.officeLeft(false) <= 3 || this.alertT > 45)) {
      this.squadCalled = true;
      this.squadT = 3;
      this.ctx.audio.radioChirp(8);
    }
    if (this.squadT > 0) {
      this.squadT -= dt;
      if (this.squadT <= 0 && !this.bringSquad()) this.squadT = 1;
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.hud.setAlert(false);
    }
  }

  /**
   * The squad, in: at whichever way in Ravi cannot see and is not stood
   * next to — out of a lift, or up the stairs — straight at him.
   */
  private bringSquad(): boolean {
    const L = this.level;
    const p = this.player.position;
    const eye = this.player.eyePosition(Level7Scene.tmpE);
    let at: THREE.Vector3 | null = null;
    let lift = false;
    L.squad.forEach((s, i) => {
      if (at) return;
      if (Math.hypot(s.x - p.x, s.z - p.z) < 7) return;
      if (this.clearLine(eye, Level7Scene.tmpD.set(s.x, 1.6, s.z))) return;
      at = s;
      lift = i < 2;
    });
    if (!at) return false;
    const from = at as THREE.Vector3;
    const offsets = [[-0.45, -0.35], [0.45, -0.35], [-0.45, 0.4], [0.45, 0.4]];
    let k = 0;
    for (const a of this.agents) {
      if (a.role !== 'squad' || a.here || !a.e.alive) continue;
      const [ox, oz] = offsets[k++ % offsets.length];
      a.e.position.set(from.x + ox, 0, from.z + oz);
      a.e.root.visible = true;
      a.here = true;
      for (const part of a.e.parts) this.level.shootables.push(part);
      a.ai = this.makeAI(a.e);
      a.ai.alert(this.player.position);
    }
    const { audio } = this.ctx;
    if (lift) audio.elevatorDing();
    else audio.doorOpen();
    audio.enemyShout(from.distanceTo(p));
    this.floorAlert = true;
    this.hud.setAlert(true);
    this.bannerT = 2.2;
    return true;
  }

  /** Is Ravi where this agent would notice him? Then he will turn on him, after a moment. */
  private senseRavi(a: Agent): void {
    if (!this.player.alive) return;
    const e = a.e;
    const p = this.player.position;
    const d = Math.hypot(p.x - e.position.x, p.z - e.position.z);
    if (d < 2.5) {
      this.wake(a, 0.15);
      return;
    }
    const eye = e.eyePosition(Level7Scene.tmpB);
    const sees = (range: number, halfAngle: number): boolean =>
      d < range && this.inCone(e, p, halfAngle) && this.clearLine(eye, this.player.eyePosition(Level7Scene.tmpC));
    switch (a.role) {
      case 'shooter':
        // Facing the staff, and so the way he comes in. And once one of them
        // has turned round, the rest are looking for him too.
        if (sees(16, 1.3)) this.wake(a, 0.35 + Math.random() * 0.7);
        else if (this.floorAlert && sees(26, Math.PI)) this.wake(a, 0.6 + Math.random() * 1.0);
        break;
      case 'brawler':
        // Busy: only right next to them
        if (sees(6, Math.PI)) this.wake(a, 0.3);
        break;
      case 'guard':
        if (sees(12, 1.2) || d < 4) this.wake(a, 0.35);
        break;
      default:
        break;
    }
  }

  private inCone(e: Enemy, p: THREE.Vector3, halfAngle: number): boolean {
    if (halfAngle >= Math.PI) return true;
    const f = e.forwardDir(Level7Scene.tmpD);
    const dx = p.x - e.position.x;
    const dz = p.z - e.position.z;
    const len = Math.hypot(dx, dz) || 1;
    return Math.acos(THREE.MathUtils.clamp((f.x * dx + f.z * dz) / len, -1, 1)) <= halfAngle;
  }

  private wake(a: Agent, delay: number): void {
    if (a.ai || a.wake >= 0 || !a.e.alive || a.role === 'pinned' || !a.here) return;
    a.wake = delay;
  }

  private makeAI(e: Enemy): EnemyAI {
    return new EnemyAI(e, {
      player: this.player,
      waypoints: this.level.waypoints,
      occluders: this.level.occluders,
      colliders: this.level.colliders,
      bus: this.ctx.bus,
      audio: this.ctx.audio,
      enemyFire: (x) => this.enemyFire(x)
    });
  }

  /** Done with the staff: he has seen Ravi, and Ravi is the one that matters. */
  private turnOnRavi(a: Agent): void {
    a.wake = 0;
    const e = a.e;
    a.shooter?.end();
    a.shooter = null;
    if (a.brawl) this.endBrawl(a.brawl);
    e.setKneeling(false);
    e.slingWeapon(false);
    e.setRestCarry(false);
    e.pose = null;
    e.poseCurl = null;
    e.setHeadLook(null);
    if (!a.ai) {
      a.ai = this.makeAI(e);
      if (a.post) a.ai.setPatrolZone(a.post.pos, a.post.radius);
    }
    a.ai.alert(this.player.position);
    if (a.role !== 'guard') this.floorAlert = true;
  }

  /** A guard, posted: walking his patch from now on, eyes and ears open. */
  private postGuard(a: Agent): void {
    a.ai = this.makeAI(a.e);
    if (a.post) a.ai.setPatrolZone(a.post.pos, a.post.radius);
  }

  /** A fist fight is over: whoever is still standing goes back to the war. */
  private endBrawl(b: Brawl): void {
    if (b.done) return;
    b.end();
    const a = this.agentOf.get(b.agent);
    const s = this.staffOf.get(b.staff);
    if (a) a.brawl = null;
    if (s) {
      s.brawl = null;
      // His man is down: he gets a pistol out and turns it on the rest of them
      if (s.e.alive) this.arm(s);
    }
    if (a && a.e.alive && !a.ai) {
      a.e.slingWeapon(false);
      if (this.floorAlert) this.wake(a, 0.3);
      else {
        // He won: rifle off his back, and looking for the next one
        a.ai = this.makeAI(a.e);
        a.ai.setPatrolZone(a.e.position, 7);
      }
    }
  }

  /** One of the staff, done with his fist fight, onto his feet with a pistol. */
  private arm(s: Staff): void {
    if (s.stand || !s.e.alive) return;
    s.e.setHeadLook(null);
    s.stand = new StandGunner(s.e, (from) => this.agentTarget(from), this.hooks);
  }

  /** The nearest of the staff for an agent to shoot at: one of the gunners. */
  private staffTarget(from: Enemy): Enemy | null {
    let best: Enemy | null = null;
    let bestD = 22;
    for (const s of this.staff) {
      if (!s.gunner || !s.e.alive || s.gunner.state === 'off') continue;
      const d = s.e.position.distanceTo(from.position) + (Math.random() - 0.5) * 3;
      if (d < bestD) {
        bestD = d;
        best = s.e;
      }
    }
    return best;
  }

  /** The nearest agent for one of the staff to shoot at: never into a fist fight, or at the man on the floor. */
  private agentTarget(from: Enemy): Enemy | null {
    let best: Enemy | null = null;
    let bestD = 22;
    for (const a of this.agents) {
      if (!a.e.alive || !a.here || a.brawl || a.role === 'pinned' || a.role === 'guard') continue;
      if (!this.level.officeBox.containsPoint(a.e.position)) continue;
      const d = a.e.position.distanceTo(from.position) + (Math.random() - 0.5) * 3;
      if (d < bestD) {
        bestD = d;
        best = a.e;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ their hits

  private onThrown(a: Enemy): void {
    const d = a.position.distanceTo(this.player.position);
    if (d < 7 && Math.random() < 0.5) this.ctx.audio.punchSwish();
  }

  private onLanded(attacker: Enemy, victim: Enemy, at: THREE.Vector3, dir: THREE.Vector3, head: boolean, power: number): void {
    const d = at.distanceTo(this.player.position);
    const { audio } = this.ctx;
    audio.distantPunch(d, head);
    if (Math.random() < 0.45) audio.distantGrunt(d + 0.5);
    // A little blood off the face, now and then, where Ravi can see it
    if (head && d < 16 && Math.random() < 0.3) this.particles.spit(at, dir, 0.02);
    const pound = this.pound && attacker === this.pound.staff;
    this.damage(victim, (pound ? DAMAGE.pound : DAMAGE.punch) * power, at, dir, attacker, 'punch');
  }

  /**
   * Somebody else's round, staff at agent or agent at staff. It never goes
   * through castBullet — the fight between them runs on its own, slower
   * terms. Whether it finds its man is a roll; where a miss goes is a ray
   * against the level's own boxes, which is all a stray round needs and
   * costs next to nothing.
   */
  private npcFire(shooter: Enemy, target: Enemy): void {
    if (!shooter.alive || !target.alive || this.over) return;
    const { audio } = this.ctx;
    const fromStaff = this.staffOf.has(shooter);
    const from = fromStaff ? shooter.pistolMuzzleWorld(new THREE.Vector3()) : shooter.muzzleWorld(new THREE.Vector3());
    const heard = from.distanceTo(this.player.position);
    if (fromStaff) audio.npcPistol(heard);
    else audio.enemyGunshot(heard);
    this.flashPool.flash(from, fromStaff ? 6 : 9);

    const ts = this.staffOf.get(target);
    let exposed = true;
    const aim = Level7Scene.tmpA;
    if (ts?.gunner && !ts.gunner.exposed && ts.shield) {
      // Down behind his desk: the round goes into the top of it
      exposed = false;
      aim.copy(ts.shield);
      aim.x += (Math.random() - 0.5) * 1.2;
      aim.y = 0.12 + Math.random() * 0.58;
    } else {
      target.headWorld(aim);
      aim.y -= 0.22 + Math.random() * 0.25;
    }
    const dir = Level7Scene.tmpB.copy(aim).sub(from).normalize();
    if (exposed && Math.random() < (fromStaff ? HIT_CHANCE.pistol : HIT_CHANCE.rifle)) {
      this.particles.tracer(from, aim, 0xffe0b0);
      this.damage(target, fromStaff ? DAMAGE.pistol : DAMAGE.rifle, aim.clone(), dir.clone(), shooter, 'bullet');
      return;
    }
    if (exposed) {
      // Past him, into whatever is behind
      dir.x += (Math.random() - 0.5) * 0.1;
      dir.y += (Math.random() - 0.4) * 0.06;
      dir.z += (Math.random() - 0.5) * 0.1;
      dir.normalize();
    }
    const hit = this.rayBoxes(from, dir, 45);
    const end = hit ? hit.clone() : from.clone().addScaledVector(dir, 45);
    this.particles.tracer(from, end, 0xffe0b0);
    if (!hit) return;
    const n = Level7Scene.tmpN;
    this.particles.concreteChips(hit, n, ts?.gunner && !exposed ? 0x9a7d55 : 0xb9b3a8);
    const near = hit.distanceTo(this.player.position);
    if (this.npcHoles < NPC_HOLES && near < 18 && Math.random() < 0.3) {
      this.npcHoles++;
      this.decals.place('bullethole', hit, n.clone());
    }
    if (near < 2.5 && this.player.alive) audio.bulletWhiz();
  }

  /**
   * An agent fires at Ravi. As everywhere else, whether it connects is a
   * roll on distance and how fast he is moving — a little steadier hands on
   * this floor — but here the desks are cover: with one between the rifle
   * and his chest, most of what is aimed at him goes into that instead, and
   * crouched behind it, nearly all of it.
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
    let chance = 0.74 - dist * 0.026 - speed * 0.26 - (player.crouching ? 0.1 : 0);
    const chest = player.eyePosition();
    chest.y -= player.crouching ? 0.3 : 0.45;
    const toChest = chest.clone().sub(muzzle);
    const len = toChest.length();
    toChest.divideScalar(len);
    const cover = this.rayBoxes(muzzle, toChest, len - 0.35);
    const coverN = Level7Scene.tmpN.clone();
    if (cover) chance *= player.crouching ? 0.12 : 0.35;
    chance = THREE.MathUtils.clamp(chance, 0.04, 0.92);

    if (Math.random() < chance && player.alive) {
      const target = player.eyePosition().add(
        new THREE.Vector3((Math.random() - 0.5) * 0.2, -0.2 - Math.random() * 0.4, (Math.random() - 0.5) * 0.2)
      );
      this.particles.tracer(muzzle, target, 0xffe0b0);
      player.hit(enemy.name, muzzle);
      return;
    }
    if (cover) {
      // Into whatever he is behind: chips off it, inches from him
      this.particles.tracer(muzzle, cover, 0xffe0b0);
      this.particles.concreteChips(cover, coverN, 0x9a8f80);
      const near = cover.distanceTo(player.position);
      if (near < 3 && player.alive) audio.ricochet(near);
      return;
    }
    // Wide: past him, and into whatever is behind him
    const target = player.eyePosition();
    const off = 0.35 + Math.random() * 0.7;
    target.add(new THREE.Vector3((Math.random() - 0.5) * off * 2, (Math.random() - 0.5) * off, (Math.random() - 0.5) * off * 2));
    const dir = target.sub(muzzle).normalize();
    const end = this.castBullet(muzzle, dir, enemy);
    this.particles.tracer(muzzle, end, 0xffe0b0);
    if (player.alive) audio.bulletWhiz();
  }

  /**
   * Where a ray first meets the level's boxes — walls, slabs, barricades,
   * desks — within `far`; the face's normal is left in tmpN.
   */
  private rayBoxes(from: THREE.Vector3, dir: THREE.Vector3, far: number): THREE.Vector3 | null {
    this.ray.set(from, dir);
    let best = far;
    let box: THREE.Box3 | null = null;
    const p = Level7Scene.tmpC;
    for (const c of this.level.colliders) {
      if (c.disabled) continue;
      if (!this.ray.intersectBox(c.box, p)) continue;
      const d = p.distanceTo(from);
      if (d > 0.05 && d < best) {
        best = d;
        box = c.box;
      }
    }
    if (!box) return null;
    const at = from.clone().addScaledVector(dir, best);
    // The face it came in through
    const faces: [number, number, number, number][] = [
      [Math.abs(at.x - box.min.x), -1, 0, 0], [Math.abs(at.x - box.max.x), 1, 0, 0],
      [Math.abs(at.y - box.min.y), 0, -1, 0], [Math.abs(at.y - box.max.y), 0, 1, 0],
      [Math.abs(at.z - box.min.z), 0, 0, -1], [Math.abs(at.z - box.max.z), 0, 0, 1]
    ];
    let f = faces[0];
    for (const g of faces) if (g[0] < f[0]) f = g;
    Level7Scene.tmpN.set(f[1], f[2], f[3]);
    at.addScaledVector(Level7Scene.tmpN, 0.004);
    return at;
  }

  /** Nothing in the way between two points, as far as the level's boxes go? */
  private clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dist = a.distanceTo(b);
    this.ray.set(a, Level7Scene.tmpD.copy(b).sub(a).divideScalar(dist || 1));
    const p = Level7Scene.tmpN;
    for (const c of this.level.colliders) {
      if (c.disabled) continue;
      if (c.box.containsPoint(a) || c.box.containsPoint(b)) continue;
      if (this.ray.intersectBox(c.box, p) && p.distanceTo(a) < dist - 0.1) return false;
    }
    return true;
  }

  /** Hurt, by one of their own kind of fight: down if it is the last of him. */
  private damage(victim: Enemy, amount: number, at: THREE.Vector3, dir: THREE.Vector3, by: Enemy, kind: 'punch' | 'bullet'): void {
    const rec = this.agentOf.get(victim) ?? this.staffOf.get(victim);
    if (!rec || !victim.alive) return;
    rec.hp -= amount;
    victim.flinch(kind === 'bullet' ? 1 : 0.7);
    if (kind === 'bullet' && at.distanceTo(this.player.position) < 25) this.particles.bloodSpray(at, dir, false, 0.02);
    if (rec.hp > 0) return;
    if (kind === 'punch') {
      victim.die(at, dir, this.world, 'head', 0.7, { wound: false });
      this.particles.bloodSpray(at, dir, false, 0.02);
    } else {
      victim.die(at, dir, this.world, Math.random() < 0.25 ? 'head' : 'torso', 1);
      this.spatter(at, dir, false);
    }
    this.afterDeath(victim, by.name, false);
  }

  /**
   * A round into a living man. An agent takes it out of his hit points —
   * less of it through a plate or a helmet — and goes on, unless that was
   * the last of him. One of the staff, hit by an agent's stray, likewise.
   * Ravi's own rounds into the staff are as final as ever.
   */
  protected absorbHit(enemy: Enemy, point: THREE.Vector3, dir: THREE.Vector3, shooter: Enemy | null, part: string): boolean {
    const byRavi = shooter === null;
    const a = this.agentOf.get(enemy);
    if (a) {
      const head = part === 'head';
      const plated = a.armoured && (head || part === 'torso');
      // Ravi's round, by the gun it came out of; an agent's stray is an AK's
      let dmg = (AK_DAMAGE[part] ?? AK_DAMAGE.torso) * (byRavi ? GUN_SCALE[this.arsenal.firing] : 1);
      if (plated) dmg *= head ? ARMOUR_LETS.head : ARMOUR_LETS.torso;
      a.hp -= dmg;
      if (a.hp <= 0) return false;
      this.hurt(enemy, point, dir, plated, byRavi);
      if (byRavi) this.shotAt(a);
      return true;
    }
    const s = this.staffOf.get(enemy);
    if (s && !byRavi) {
      s.hp -= STRAY_DAMAGE;
      if (s.hp <= 0) return false;
      this.hurt(enemy, point, dir, false, false);
      return true;
    }
    return false;
  }

  /** A round that did not drop him: blood, or sparks off the plate — and he feels it. */
  private hurt(e: Enemy, at: THREE.Vector3, dir: THREE.Vector3, plated: boolean, byRavi: boolean): void {
    const { audio, bus } = this.ctx;
    const d = at.distanceTo(this.player.position);
    if (plated) {
      this.particles.concreteChips(at, Level7Scene.tmpE.copy(dir).negate(), 0x6e747c);
      this.particles.electricSparks(at, 3);
      audio.armourHit(d);
    } else {
      this.particles.bloodSpray(at, dir, false, 0.02);
      if (byRavi) audio.fleshHit();
    }
    if (byRavi) bus.emit(Events.HitMarker, { lethal: false });
    e.flinch(1);
    // It knocks him back a little
    e.position.x += dir.x * 0.05;
    e.position.z += dir.z * 0.05;
  }

  /** Shot at by Ravi: whatever he was busy with, he is busy with Ravi now. */
  private shotAt(a: Agent): void {
    if (!a.e.alive || !a.here || a.role === 'pinned') return;
    if (a.ai) a.ai.alert(this.player.position);
    else this.turnOnRavi(a);
  }

  /** Whatever a death means to the fight, whoever did it. */
  private afterDeath(victim: Enemy, by: string, headshot: boolean): void {
    const { bus } = this.ctx;
    const a = this.agentOf.get(victim);
    if (a) {
      a.ai?.dispose();
      a.ai = null;
      a.shooter?.end();
      a.shooter = null;
      if (a.brawl) this.endBrawl(a.brawl);
      if (this.pound && victim === this.pound.agent) {
        this.pound.end();
        const p = this.staffOf.get(this.pound.staff);
        if (p) this.arm(p);
      }
      if (a.counted) this.remaining = Math.max(0, this.remaining - 1);
      bus.emit(Events.EnemyKilled, { name: victim.name, remaining: this.remaining, headshot, by });
      // The ones near him hear it
      if (by === 'RAVI') {
        for (const o of this.agents) {
          if (o !== a && !o.ai && o.e.alive && o.here && o.e.position.distanceTo(victim.position) < 12) this.wake(o, 0.3 + Math.random() * 0.5);
        }
      }
      return;
    }
    const s = this.staffOf.get(victim);
    if (s) {
      s.stand?.end();
      s.stand = null;
      if (s.brawl) this.endBrawl(s.brawl);
      if (this.pound && victim === this.pound.staff) this.pound.end();
      bus.emit(Events.EnemyKilled, { name: victim.name, remaining: this.remaining, headshot, by });
    }
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
    if (!enemy.alive) return;
    enemy.die(point, dir, this.world, hitPart === 'head' ? 'head' : 'torso', impulseScale, opts);
    if (byPlayer) this.ctx.bus.emit(Events.HitMarker, { lethal: true });
    this.afterDeath(enemy, byPlayer ? 'RAVI' : 'POLICE FORCE AGENT', headshot);
  }

  /** Grabbed: whatever he was in the middle of, he isn't now. */
  protected onTakedownStart(victim: Enemy): void {
    const a = this.agentOf.get(victim);
    if (!a) return;
    a.shooter?.end();
    a.shooter = null;
    if (a.brawl) this.endBrawl(a.brawl);
    a.ai?.dispose();
    a.ai = null;
    a.wake = 0;
    victim.setKneeling(false);
    victim.pose = null;
    victim.poseCurl = null;
    victim.setHeadLook(null);
  }

  /** Who the boot would land on: an agent on his feet, never the staff, and not the man on the floor. */
  private kickTarget(): Enemy | null {
    if (!this.playable) return null;
    const list: Enemy[] = [];
    for (const a of this.agents) if (a.e.alive && a.here && a.role !== 'pinned') list.push(a.e);
    return this.kickTargetFrom(list);
  }

  // -------------------------------------------------------------- his guns

  /** The trigger and R, through the arsenal; every shot is heard. */
  private updateShooting(dt: number, busy: boolean): void {
    const { input } = this.ctx;
    const canFire = this.playable && input.pointerLocked && !busy;
    const fired = this.arsenal.updateFire(dt, input, canFire, (r, m, re) => this.hud.setAmmo(r, m, re));
    if (fired) this.heardShot();
  }

  /** A gun going off in the room is not something the agents can miss. The guards, posted further off, only close by. */
  private heardShot(): void {
    const p = this.player.position;
    for (const a of this.agents) {
      if (!a.e.alive || !a.here || a.ai || a.wake >= 0) continue;
      const d = a.e.position.distanceTo(p);
      if (a.role === 'shooter' && d < 26 && Math.random() < 0.5) this.wake(a, 0.3 + Math.random() * 0.7);
      else if (a.role === 'brawler' && d < 10) this.wake(a, 0.25);
      else if (a.role === 'guard' && d < 14) this.wake(a, 0.45);
    }
  }

  // ------------------------------------------------------------ the floor

  /** The alarm going round, the lights that are failing, the cut cables, the water, and the dead CCTV feeds. */
  private updateAmbience(dt: number): void {
    const L = this.level;
    const k = Math.max(0, Math.sin(this.t * 5.2));
    L.alarm.intensity = 3.2 * k * k;
    L.alarmMat.emissiveIntensity = 0.35 + 2.4 * k * k;
    for (const f of L.flickering) f.update(dt);
    this.sparkT -= dt;
    if (this.sparkT <= 0 && L.sparks.length) {
      this.sparkT = 0.9 + Math.random() * 2.8;
      const at = L.sparks[Math.floor(Math.random() * L.sparks.length)];
      this.particles.electricSparks(at, 5 + Math.floor(Math.random() * 8));
      this.ctx.audio.electricCrackle(at.distanceTo(this.player.position));
    }
    this.water.update(dt);
    // Snow on the dead feeds: a dozen frames a second, and only while he is near enough to see it
    this.snowAcc += dt;
    if (this.snowAcc > 1 / 12 && this.player.position.distanceTo(L.screens.at) < 9) {
      this.snowAcc = 0;
      drawStatic(L.screens.snow.canvas);
      L.screens.snow.texture.needsUpdate = true;
    }
  }

  /**
   * The bullet holes from before Ravi got here, all in one mesh. Placed as
   * decals they would be fifty-odd draws on their own.
   */
  private bakeBulletHoles(holes: { pos: THREE.Vector3; normal: THREE.Vector3 }[]): void {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 1, 32, 32, 30);
    grad.addColorStop(0, 'rgba(8,8,8,1)');
    grad.addColorStop(0.22, 'rgba(22,20,18,0.95)');
    grad.addColorStop(0.42, 'rgba(70,64,58,0.55)');
    grad.addColorStop(1, 'rgba(110,104,96,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const q = new THREE.Quaternion();
    const Z = new THREE.Vector3(0, 0, 1);
    const geos = holes.map((h, i) => {
      const s = 0.07 + ((i * 37) % 10) * 0.006;
      const geo = new THREE.PlaneGeometry(s, s);
      geo.rotateZ(i * 1.7);
      geo.applyQuaternion(q.setFromUnitVectors(Z, h.normal));
      geo.translate(h.pos.x + h.normal.x * 0.004, h.pos.y + h.normal.y * 0.004, h.pos.z + h.normal.z * 0.004);
      return geo;
    });
    if (!geos.length) return;
    const merged = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- input

  /** A click is the gun's — except once he is dead, when it is the restart. */
  private onClick(): void {
    if (this.dead) this.ctx.bus.emit(Events.RestartLevel7);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.dead) return;
    if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
    else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') this.ctx.bus.emit(Events.RestartLevel7);
  }

  // ---------------------------------------------------------------- render

  /**
   * The portrait over the boss's desk is a photograph of the room with him
   * in it, taken on the first frame, as it was downstairs. He has gone, so
   * he sits for it once more — in his chair, the vent's cover back on —
   * and then the room goes back to how he left it, and so does he.
   */
  private takePhoto(renderer: THREE.WebGLRenderer): void {
    const L = this.level;
    const room = L.bossRoom;
    const g = L.bossRoomGroup;
    g.updateMatrixWorld(true);
    const { from, to, fov, aspect } = room.photoCam;
    const cam = new THREE.PerspectiveCamera(fov, aspect, 0.05, 20);
    cam.position.copy(from).applyMatrix4(g.matrixWorld);
    cam.lookAt(to.clone().applyMatrix4(g.matrixWorld));
    cam.updateMatrixWorld();
    const chairPos = room.bossChair.position.clone();
    const chairYaw = room.bossChair.rotation.y;
    room.bossChair.position.set(room.bossAt.x, 0, room.bossAt.z);
    room.bossChair.rotation.y = Math.PI;
    const ventPos = room.ventCover.position.clone();
    const ventRot = room.ventCover.rotation.clone();
    room.ventCover.position.set(0, 0.27, -2.988);
    room.ventCover.rotation.set(0, 0, 0);
    const target = new THREE.WebGLRenderTarget(1024, 768, { type: THREE.HalfFloatType });
    room.photoMesh.visible = false;
    this.scene.updateMatrixWorld(true);
    renderer.setRenderTarget(target);
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(null);
    room.photoMesh.visible = true;
    room.photo.map = target.texture;
    room.photo.emissiveMap = target.texture;
    room.photo.color.setHex(0xffffff);
    room.photo.emissiveIntensity = 0.35;
    room.photo.needsUpdate = true;
    room.bossChair.position.copy(chairPos);
    room.bossChair.rotation.y = chairYaw;
    room.ventCover.position.copy(ventPos);
    room.ventCover.rotation.copy(ventRot);
    if (this.sitter) {
      this.scene.remove(this.sitter.root);
      this.sitter = null;
    }
    this.photoTaken = true;
  }

  render(renderer: THREE.WebGLRenderer): void {
    // The photograph first: it gives the picture's material a texture it did
    // not have, which is a different shader — compiled with the rest in the
    // warm-up, instead of the first time Ravi faces that wall
    if (!this.photoTaken) this.takePhoto(renderer);
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}
