import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level8Builder } from '../environment/Level8Builder';
import { bossCar, civic, CAR_SPECS } from '../environment/VehicleProps';
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
import { CarSystem } from '../entities/CarSystem';
import { General } from '../entities/General';
import { RaviVisual, HAND, type RaviRig } from '../entities/RaviVisual';
import { FPSHUD } from '../ui/FPSHUD';
import { DialogueBox } from '../ui/DialogueBox';
import { dataDrive, swatTruck } from '../environment/OfficeProps';
import type { CarRig, CivicRig, GeneralEvent, GeneralWorld, Level8Data } from './Level8Contracts';
import { track, clamp01, smooth, yawPitchTo, wrapAngle, alongPath, pathLength } from './cutscene';

/** The cannon world's gravity (CombatScene.createPhysicsWorld): the thrown cars fly under it. */
const GRAVITY = 19;

/**
 * One of Ravi's rounds into the General, by where it lands, at full effect.
 * He takes a great many: this is a fight of minutes, not of a magazine.
 */
const AK_DAMAGE: Record<string, number> = { head: 55, torso: 22, arm: 14, leg: 14 };
/**
 * The other two against him, as a share of an AK round: the pistol's single
 * heavier round hits a little harder but comes slower and ten to a mag; a
 * shotgun pellet is a fraction of one, eight to a shell, and only up close.
 * The AK stays the tool for this fight.
 */
const GUN_DAMAGE: Record<Gun, number> = { rifle: 1, pistol: 1.2, shotgun: 0.4 };
/**
 * Rounds lose their bite with range — full within 14 m, half at 27, a tenth
 * past 38 — which is the whole shape of the fight: he can only be hurt by
 * someone who has crossed the lot to him under the cars, and hurt properly
 * only from close, where he stamps and where the throws come quickest.
 */
const rangeFactor = (d: number): number => Math.min(1, Math.max(0.1, (40 - d) / 26));
/** Past this the rounds spark off his kit instead of drawing blood. */
const SPARK_RANGE = 26;
/**
 * Buckshot falls off far faster: full within 5 m, half at about 9, next to
 * nothing past 13 — where it sparks off him like the rest do from afar.
 */
const pelletFactor = (d: number): number => Math.min(1, Math.max(0.04, (13.5 - d) / 8.5));
const PELLET_SPARK_RANGE = 13;

/** A glancing blow from a car: this many hit points, and a shove this far. */
const GLANCE_DAMAGE = 2;
const GLANCE_SHOVE = 3;
/** The stomp's shockwave: what it costs a man on the ground inside it. */
const STOMP_DAMAGE = 1;
const STOMP_SHOVE = 5;

/** The boss running for his car. Enemy has no run, so the walk is driven faster, with a longer stride. */
const BOSS_SPEED = 7;
/** How near the Civic's door Ravi has to be to get in. */
const CIVIC_REACH = 2.4;

type Phase = 'opening' | 'reveal' | 'fight' | 'won' | 'outro';

/**
 * Level8Scene — the car park.
 *
 * Ravi comes out of Stairwell B at a run. The boss is well ahead of him,
 * the drive in his fist, making for the black saloon by the gate; he gets
 * there, and it is gone up the road. What steps into the gateway after it is
 * the man he was selling the drive to: the General, commander of the police
 * force, half again the height of anyone else on the lot. He beats his chest,
 * he roars, and he starts throwing cars.
 *
 * The fight is a crossing. From the building the General is seventy metres
 * off and Ravi's rounds do nothing to him; the rows of parked cars between
 * them are cover from his flat throws but not from the ones he lobs, which
 * come down where Ravi is going to be, under a red ring. He only goes down
 * to someone who has got close — and close is where he stamps, and where he
 * rips up the cover to throw it.
 *
 * When he falls there is a car left that nobody would want: the Civic in
 * the corner. It does not start the first time.
 */
export class Level8Scene extends CombatScene<Level8Data> {
  /** Pistol, shotgun and AK: everything he has picked up on the way here. */
  private arsenal!: Arsenal;
  private emote!: EmoteViewmodel;
  private drink!: DrinkViewmodel;
  private dropKick!: DropKickViewmodel;
  private hud!: FPSHUD;
  private dialogue!: DialogueBox;

  private cars!: CarSystem;
  private general!: General;
  private boss!: Enemy;
  private bossRig!: CarRig;
  private civicRig!: CivicRig;
  /** Ravi at the wheel, for the outro: built when the model is in, hidden until then. */
  private driver: RaviRig | null = null;

  private phase: Phase = 'opening';
  private t = 0;
  private dead = false;
  /** Seconds since he died: the restart waits until the death screen has been up a moment. */
  private deadT = 0;
  private toldTooFar = false;
  private wonT = 0;
  private escapeT = 0;
  private handedOff = false;

  // ---- the opening
  private runPhase = 0;
  private bossS = 0;
  private bossLen = 0;
  private bossRun: THREE.Vector3[] = [];
  /** The cut from Ravi's eyes to the boss's car has happened. */
  private carShot = false;
  /** Where a third-person shot is looking, eased so a moving subject doesn't jerk the frame. */
  private lookPt = new THREE.Vector3();
  private bossInCarT = -1;
  private carS = 0;
  private carV = 0;
  private carYaw = 0;
  private carLen = 0;
  private genWalkT = -1;
  private genWalkDur = 0;
  private revealT = 0;
  private revealThrown = false;
  private liftedAt = -1;
  private thrownAt = -1;
  private beats = new Set<string>();
  /** The camera's smoothed look while the scene drives it. */
  private camYaw = Math.PI / 2;
  private camPitch = 0;
  private camFov = 74;
  /** Third-person shots: where the camera is and what it looks at, written after player.update. */
  private shot: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;

  // ---- the outro
  private civicS = 0;
  private civicV = 0;
  private civicYaw = 0;
  private civicLen = 0;
  private wheelSpin = 0;
  private hubcap: THREE.Object3D | null = null;
  private hubcapV = new THREE.Vector3();
  private hubcapSpin = 0;
  private hubcapT = 0;

  // ---- feel
  private shake = 0;
  private shoveDir = new THREE.Vector3();
  private shoveLeft = 0;
  private hazardT = 0;
  private smokeAcc = 0;

  private ui!: HTMLElement;
  private objective!: HTMLElement;
  private fadeEl!: HTMLElement;
  private letterbox!: HTMLElement;
  private skipEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private endCard!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);

  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();
  private static tmpC = new THREE.Vector3();
  private static tmpD = new THREE.Vector3();
  private static tmpQ = new THREE.Quaternion();
  /** The boss's walker reads these; kept apart from the scratch vectors above. */
  private bossDir = new THREE.Vector3();
  private headLook = new THREE.Vector3();

  constructor(ctx: GameContext, private retry = false) {
    super(ctx);
  }

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x9fbbd8);

    this.level = new Level8Builder().build();
    this.scene.add(this.level.group);
    const L = this.level;

    // The Civic goes in before the physics world is made, so its colliders
    // become static bodies with everything else: thrown cars bounce off it
    this.civicRig = civic();
    this.civicRig.group.position.copy(L.civic.pos);
    this.civicRig.group.rotation.y = L.civic.yaw;
    this.scene.add(this.civicRig.group);
    this.civicYaw = L.civic.yaw;
    this.addCarColliders(this.civicRig, L.civic.pos, L.civic.yaw, 'hatch');

    this.world = this.createPhysicsWorld(L.colliders);
    // The lamp posts stay solid to Ravi, but not to a car in the air: a
    // seven-metre pole caught a lobbed car by its tail and dropped it
    // thirty metres short. Thrown cars go over them.
    // Nor is the gate's: it keeps Ravi in, not the cars, and as a body it
    // was a twelve-metre invisible wall across the open gateway.
    const gate = L.gate.collider.box.getCenter(new THREE.Vector3());
    for (const body of [...this.world.bodies]) {
      const box = body.shapes[0] as CANNON.Box | undefined;
      if (body.type !== CANNON.Body.STATIC || body.shapes.length !== 1 || !(box instanceof CANNON.Box)) continue;
      const h = box.halfExtents;
      const isGate = Math.abs(body.position.x - gate.x) < 0.01 && Math.abs(body.position.z - gate.z) < 0.01 && Math.abs(body.position.y - gate.y) < 0.01;
      if ((h.y > 2 && h.x < 0.4 && h.z < 0.4) || isGate) this.world.removeBody(body);
    }

    this.player = new FPSPlayer(L.playerSpawn, L.playerSpawnYaw, input, audio, bus);

    // Dead: he goes over as a ragdoll and the gun in his hands drops

    this.ragdollOnDeath(() => (this.arsenal.held.stow < 0.5 ? this.arsenal.active : null));
    this.player.camera.far = 700;
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
    this.dropKick = new DropKickViewmodel(this.player.camera);
    this.dropKick.onEvent = (e) => {
      // Nobody on this lot can be kicked: the boss is gone and the General is
      // three metres tall. The kick still goes, and lands on nothing.
      if (e === 'launch') audio.kickWhoosh();
      else if (e === 'land') {
        audio.backLanding();
        bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 9, kind: 'footstep' });
      } else if (e === 'up') audio.scuff();
      else if (e === 'done') {
        this.player.cinematic = false;
        this.endKickRun();
      }
    };

    this.particles = new ParticleManager(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene, 4);
    Enemy.flashPool = this.flashPool;
    this.decals = new BloodDecalSystem(this.scene);

    // All three guns, the AK in hand. Out of shot but not hidden: hiding it
    // would take its muzzle light out of the scene's light count and
    // recompile everything when it came back
    this.arsenal = new Arsenal(
      {
        player: this.player,
        audio,
        bus,
        world: this.world,
        particles: this.particles,
        castBullet: (o, d) => {
          // He moves every frame: his hitboxes have to be where he is now
          this.general.enemy.root.updateMatrixWorld(true);
          return this.castBullet(o, d, null);
        },
        addDebris: (m, b) => this.addDebris(m, b),
        dropMagazine: (p) => this.dropMagazine(p)
      },
      loadoutFor('level8'),
      'rifle'
    );
    this.arsenal.equip('rifle', 0.99);
    // The AK came up slowly in this fight before there were three; keep its pace
    this.arsenal.drawRate = 3;

    // Every car on the lot
    this.cars = new CarSystem({
      scene: this.scene,
      world: this.world,
      level: { colliders: L.colliders, shootables: L.shootables, occluders: L.occluders },
      particles: this.particles,
      audio
    });
    for (const s of L.parked) this.cars.addParked(s);
    for (const s of L.pile) this.cars.addPile(s);
    this.cars.settle();
    this.cars.onCrush = (c) => this.onCrush(c.lethal, c.push);
    this.cars.onImpact = (i) => {
      if (!this.player.alive) return;
      // A landing near him shakes the ground under his feet
      const k = i.dist < 3.5 ? 1 : Math.max(0, 1 - (i.dist - 3.5) / 30);
      this.addShake(k * Math.min(1, i.speed / 14) * 1.1);
    };

    this.buildBoss();
    this.parkTruck();
    this.buildGeneral();
    this.buildDriver();

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, 1, this.player.maxHealth);
    this.hud.setAmmo(...this.arsenal.ammoReadout());
    this.dialogue = new DialogueBox(this.ctx.uiRoot, audio);
    this.buildUI();

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }),
      bus.on(Events.PlayerDied, () => {
        this.dead = true;
        this.deadT = 0;
      })
    );
    document.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);
    input.requestPointerLock();

    if (this.retry) this.skipToFight();
    else this.startOpening();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('click', this.clickHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.ctx.audio.stopBossMusic(0.4);
    this.cars.dispose();
    this.general.dispose();
    this.hud.destroy();
    this.dialogue.destroy();
    this.flashPool.dispose();
    this.ui.remove();
    this.ctx.engine.domElement.style.filter = '';
    Enemy.flashPool = null;
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-skip">[ SPACE ] SKIP</div>
      <div class="intro-objective"></div>
      <div class="l8-title" style="position:absolute;left:0;right:0;bottom:22vh;text-align:center;pointer-events:none;
        opacity:0;transition:opacity 0.9s, transform 3.5s ease-out;transform:translateY(8px)">
        <div style="font-size:15px;letter-spacing:6px;color:#c9b77a;margin-bottom:6px">COMMANDER, POLICE FORCE</div>
        <div style="font-size:54px;letter-spacing:14px;color:#f1ece0;font-weight:bold;text-shadow:0 3px 18px rgba(0,0,0,0.7)">THE GENERAL</div>
      </div>
      <div class="intro-fade" style="opacity:1"></div>
      <div class="l8-end" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        color:#e8f4ec;font-size:22px;letter-spacing:9px;opacity:0;pointer-events:none;transition:opacity 1.2s">TO BE CONTINUED</div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.skipEl = el.querySelector('.intro-skip')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.titleEl = el.querySelector('.l8-title')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
    this.endCard = el.querySelector('.l8-end')!;
  }

  private setObjective(text: string): void {
    if (this.objective.textContent === text) return;
    this.objective.textContent = text;
    this.objective.classList.remove('show');
    void this.objective.offsetWidth;
    if (text) this.objective.classList.add('show');
  }

  /**
   * A car's boxes as player colliders (and, made before the physics world,
   * as static bodies too). Only for cars that stand still at a right angle,
   * so the axis-aligned boxes are exact.
   */
  private addCarColliders(rig: CarRig, pos: THREE.Vector3, yaw: number, kind: keyof typeof CAR_SPECS): void {
    const spec = CAR_SPECS[kind];
    const q = Level8Scene.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (const b of spec.boxes) {
      const c = new THREE.Vector3(...b.c).applyQuaternion(q).add(pos);
      const h = new THREE.Vector3(...b.h).applyQuaternion(q);
      h.set(Math.abs(h.x), Math.abs(h.y), Math.abs(h.z));
      this.level.colliders.push({ box: new THREE.Box3(c.clone().sub(h), c.clone().add(h)) });
    }
    for (const m of rig.meshes) {
      m.userData.noDecal = true;
      this.level.shootables.push(m);
    }
  }

  // ------------------------------------------------------------- the cast

  /** The boss: running for his car with the drive, never a target — he is the next level's business. */
  private buildBoss(): void {
    const L = this.level;
    const b = new Enemy(L.boss.start, Math.PI / 2, 7, { name: 'THE BOSS', boss: true });
    b.holdProp(dataDrive(), 0.045);
    this.scene.add(b.root);
    this.boss = b;
    // His run starts just ahead of the stairwell door — Ravi sees him go —
    // and joins the lot's own route to his car
    this.bossRun = [new THREE.Vector3(BOSS_FROM_X, 0, L.boss.run[0].z), ...L.boss.run];
    this.bossLen = pathLength(this.bossRun);

    this.bossRig = bossCar();
    this.bossRig.group.position.copy(L.boss.car.pos);
    this.bossRig.group.rotation.y = L.boss.car.yaw;
    this.scene.add(this.bossRig.group);
    this.carYaw = L.boss.car.yaw;
    this.carLen = pathLength(L.boss.drive);
  }

  private buildGeneral(): void {
    const L = this.level;
    const world: GeneralWorld = {
      target: () => ({
        pos: this.player.position,
        vel: this.player.velocity,
        grounded: this.player.grounded,
        alive: this.player.alive
      }),
      findCar: (from, range) => this.cars.throwableNear(from, range),
      grab: (id) => this.cars.grab(id),
      hold: (id, m) => this.cars.hold(id, m),
      launch: (id, vel, spin, kind, aim) => this.cars.launch(id, vel, spin, kind, aim),
      clearLine: (a, b) => this.cars.clearLine(a, b),
      gravity: GRAVITY
    };
    this.general = new General(this.scene, world, L.general.hidden, L.general.revealYaw);
    this.general.zone = { ...L.general.zone };
    this.general.mode = 'script';
    this.general.paused = true;
    this.general.onEvent = (e) => this.onGeneral(e);
    for (const p of this.general.enemy.parts) L.shootables.push(p);
    // A wreck put back on the pile never lands on him
    this.cars.keepClear = { pos: this.general.enemy.root.position, radius: 4 };
  }

  /**
   * Ravi at the wheel of the Civic, for the getaway: the whole modelled man,
   * sat in the driver's seat with his hands on the wheel. Hidden until he
   * gets in; built now so the warm-up compiles him.
   */
  private buildDriver(): void {
    const rig = this.civicRig;
    RaviVisual.whenReady(() => {
      const r = RaviVisual.rig('body');
      // Model space faces +Z with his left on +X; the car faces −Z
      r.root.rotation.y = Math.PI;
      // Under the body, so he rides its squat and shake. The body pivots at
      // axle height, so the seat point comes down by that much.
      const axle = rig.body.position.y;
      r.root.position.set(rig.seat.hip.x, -axle, rig.seat.hip.z);
      rig.body.add(r.root);
      const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
      // The wheel, in his model space: ahead of the hips (model +Z) and up
      const fwd = rig.seat.hip.z - rig.seat.wheel.z;
      const wy = rig.seat.wheel.y;
      const grip = { fingers: [[70, 80, 40], [72, 82, 40], [74, 84, 42], [76, 86, 44]], thumb: [0.45, 0.5, 0.3] } as const;
      r.seat({
        hips: V(0, rig.seat.hip.y, 0),
        lean: [-10, 3, 3, 2, 2, -2],
        legs: {
          l: { ankle: V(0.16, 0.14, fwd + 0.42), knee: V(0.12, 0.8, 1) },
          r: { ankle: V(-0.14, 0.14, fwd + 0.42), knee: V(-0.12, 0.8, 1) }
        },
        arms: {
          l: { wrist: V(0.17, wy + 0.04, fwd - 0.06), along: V(-0.25, 0.55, 0.8), palm: V(-0.75, -0.1, 0.6), elbow: V(0.6, -0.6, -0.4), shape: { fingers: grip.fingers.map((f) => [...f]) as never, thumb: [...grip.thumb] as never } },
          r: { wrist: V(-0.17, wy + 0.04, fwd - 0.06), along: V(0.25, 0.55, 0.8), palm: V(0.75, -0.1, 0.6), elbow: V(-0.6, -0.6, -0.4), shape: { fingers: grip.fingers.map((f) => [...f]) as never, thumb: [...grip.thumb] as never } }
        }
      });
      void HAND;
      r.root.visible = false;
      this.driver = r;
    });
  }

  /**
   * The police force's truck that brought him, parked on the road outside
   * the lot. Its interior lamp is taken out first — a light added to the
   * scene is a light in every material's shader, and this one would never
   * be seen.
   */
  private parkTruck(): void {
    const t = swatTruck();
    const lights: THREE.Object3D[] = [];
    t.group.traverse((o) => {
      if ((o as THREE.Light).isLight) lights.push(o);
    });
    for (const l of lights) l.parent?.remove(l);
    t.group.position.copy(TRUCK_AT);
    t.group.rotation.y = Math.PI; // nose north, up the road
    t.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.userData.surface = 'metal';
        m.userData.noDecal = true;
        this.level.shootables.push(m);
      }
    });
    this.scene.add(t.group);
  }

  // ------------------------------------------------------------ the opening

  private beat(key: string, at: number, now: number, fn: () => void): void {
    if (now < at || this.beats.has(key)) return;
    this.beats.add(key);
    fn();
  }

  /** Bars on, the HUD away, the gun out of shot, and Ravi on rails out of the door. */
  private startOpening(): void {
    const L = this.level;
    this.phase = 'opening';
    this.player.cinematic = true;
    this.player.position.copy(L.ravi.chase[0]);
    this.player.yaw = L.playerSpawnYaw;
    this.player.pitch = -0.03;
    this.camYaw = this.player.yaw;
    this.camPitch = this.player.pitch;
    this.hud.hide();
    // The boss has a head start: out of the door a few seconds before him
    this.bossS = 0;
    alongPath(this.bossRun, 0, this.boss.position);
    // The General is out of sight on the road until the reveal cuts to him
    this.general.enemy.root.visible = false;
    this.placeGeneral(GENERAL_HIDE, Math.PI / 2);
  }

  /** Put the General somewhere, facing somewhere, between actions. */
  private placeGeneral(at: THREE.Vector3, yaw: number): void {
    const e = this.general.enemy;
    this.general.play('idle');
    e.root.position.set(at.x, 0, at.z);
    e.yaw = yaw;
    e.root.rotation.y = yaw;
  }

  /**
   * The chase, on rails: out of the door at a run along the lane, the
   * camera on the boss; then down by his car as he dives in and it tears
   * away through the gate.
   */
  private updateOpening(dt: number): void {
    const { audio } = this.ctx;
    const L = this.level;
    const t = this.t;

    // In from black, the door kicked open
    this.fadeEl.style.opacity = String(Math.max(0, 1 - t / 1.0));
    this.beat('door', 0.05, t, () => audio.stairDoorBang());
    const doorK = clamp01((t - 0.05) / 0.28);
    // Flung open: past where it stops, and back
    L.stairDoor.pivot.rotation.y = L.stairDoor.openAngle * (1 - Math.pow(1 - doorK, 3) + Math.sin(doorK * Math.PI) * 0.12);

    // The cut: from Ravi's eyes as he pulls up, to down by the boss's car as
    // the boss comes running up to it (the cut takes the run's middle out)
    if (!this.carShot && t > RUN_TIME + 0.15) {
      this.carShot = true;
      this.player.position.copy(L.ravi.fightStart);
      this.bossS = Math.max(this.bossS, this.bossLen - BOSS_LAST_STRETCH);
      this.lookPt.copy(alongPath(this.bossRun, this.bossS, Level8Scene.tmpA)).setY(1.3);
    }

    // The boss running for it
    if (this.bossInCarT < 0) {
      const was = this.bossS;
      this.bossS = Math.min(this.bossLen, this.bossS + BOSS_SPEED * dt);
      const at = alongPath(this.bossRun, this.bossS, Level8Scene.tmpA, this.bossDir);
      this.boss.position.set(at.x, 0, at.z);
      this.boss.faceToward(Level8Scene.tmpB.copy(at).add(this.bossDir), dt, 14);
      this.boss.cadence = 1.55;
      this.boss.setWalk(this.bossS < this.bossLen ? 1.35 : 0);
      if (was < this.bossLen && this.bossS >= this.bossLen) this.bossInCarT = t;
      this.boss.update(dt);
    } else {
      this.updateBossCar(dt, t - this.bossInCarT);
    }

    // Once the car is out of the gate and away: cut to him, coming in through it
    if (this.carS > CAR_GATE + 6) this.startReveal();
  }

  private genLeg = 0;
  private nextGeneralLeg(): void {
    this.genWalkT = 0;
    this.genWalkDur = this.general.play('walk', { to: GENERAL_WALK_IN[this.genLeg] });
  }

  /** Ravi's eye on the run: the camera's position and the look for this frame, before player.update. */
  private openingPose(dt: number): void {
    const L = this.level;
    const t = this.t;
    const p = this.player;
    const len = pathLength(L.ravi.chase);
    const u = clamp01((t - 0.12) / RUN_TIME);
    // Out of the door at a sprint, slowing to a stop where the lane opens up
    const s = len * (1 - Math.pow(1 - u, 2.2));
    alongPath(L.ravi.chase, s, p.position);
    p.velocity.set(0, 0, 0);
    const speed = u < 1 ? (2.2 * len * Math.pow(1 - u, 1.2)) / RUN_TIME : 0;
    this.runPhase += dt * (4 + speed * 1.15);
    if (speed > 1 && Math.sin(this.runPhase) * Math.sin(this.runPhase - dt * 8) < 0) this.ctx.audio.footstep(true, false);

    // What he looks at: down the lane, then the boss, then the car, then the man walking in
    const look = Level8Scene.tmpC;
    if (t < 1.4) look.set(-60, 1.4, 12);
    else if (this.bossInCarT < 0) this.boss.headWorld(look);
    else if (this.genWalkT < 0 || this.genWalkT < 0.6) look.copy(this.bossRig.group.position).setY(1.0);
    else this.general.enemy.headWorld(look).y -= 0.6;
    const eye = Level8Scene.tmpD.copy(p.position).setY(p.position.y + p.eyeHeight);
    const { yaw, pitch } = yawPitchTo(eye, look);
    const k = 1 - Math.exp(-dt * (t < 1.4 ? 6 : 3.2));
    this.camYaw += wrapAngle(yaw - this.camYaw) * k;
    this.camPitch += (pitch - this.camPitch) * k;
    p.yaw = this.camYaw;
    p.pitch = this.camPitch;
    this.camFov = track([[0, 74], [2.0, 74], [RUN_TIME, 62]], t);
    if (this.carShot) this.carShotCamera(dt);
  }

  /**
   * Down by the boss's car, low behind it: him running up and diving in, the
   * car tearing out past the camera through its own smoke and away through
   * the gate — and, past the gate, the truck, and what steps out from behind it.
   */
  private carShotCamera(dt: number): void {
    const want = Level8Scene.tmpA;
    if (this.bossInCarT < 0) this.boss.headWorld(want).y -= 0.3;
    else if (this.genWalkT < 0) want.copy(this.bossRig.group.position).setY(0.9);
    else this.general.enemy.headWorld(want).y -= 0.9;
    this.lookPt.lerp(want, 1 - Math.exp(-dt * 3));
    this.setShot(CAR_CAM, this.lookPt, 40);
  }

  /** On the run, the camera bounces: added after player.update has put it at his eye. */
  private runBob(): void {
    const t = this.t;
    const runK = clamp01(1 - (t - 0.12) / RUN_TIME) * clamp01(t / 0.2);
    if (runK <= 0) return;
    const cam = this.player.camera;
    cam.position.y += Math.abs(Math.sin(this.runPhase)) * 0.075 * runK;
    cam.position.x += Math.sin(this.runPhase) * 0.035 * runK;
    cam.rotation.z += Math.sin(this.runPhase) * 0.012 * runK;
    cam.updateMatrixWorld();
  }

  /**
   * The boss's car: his door, him in, the door, the lights, and away —
   * hard, the back wheels smoking — through the gate and up the road.
   * `ct` is seconds since he got to the door.
   */
  private updateBossCar(dt: number, ct: number): void {
    const { audio } = this.ctx;
    const L = this.level;
    const rig = this.bossRig;
    const d = rig.group.position.distanceTo(this.player.position);

    rig.setDoor(ct < 0.4 ? smooth(ct / 0.35) : 1 - smooth((ct - 0.55) / 0.3));
    this.beat('bossDoor', 0.0, ct, () => audio.carDoor(true, d));
    this.beat('bossIn', 0.45, ct, () => {
      // In: gone from the world (hidden and moved away, as level six's boss is)
      this.boss.root.visible = false;
      this.boss.root.position.set(0, -60, 0);
    });
    this.beat('bossShut', 0.82, ct, () => audio.carDoor(false, d));
    this.beat('bossLights', 1.0, ct, () => {
      rig.headlights.emissiveIntensity = 2.6;
      rig.brakelights.emissiveIntensity = 2.2;
      audio.bigEngineDrive(5.5, d);
    });
    this.beat('bossGo', CAR_GO, ct, () => audio.tyreSqueal(1.3, d));
    if (ct < CAR_GO) return;

    // Away: hard on the throttle up to speed
    this.carV = Math.min(17, this.carV + 7.5 * dt);
    this.carS = Math.min(this.carLen, this.carS + this.carV * dt);
    const at = alongPath(L.boss.drive, this.carS, Level8Scene.tmpA, Level8Scene.tmpB);
    const heading = Math.atan2(-Level8Scene.tmpB.x, -Level8Scene.tmpB.z);
    const turn = wrapAngle(heading - this.carYaw);
    this.carYaw += turn * Math.min(1, dt * 5);
    rig.group.position.set(at.x, 0, at.z);
    rig.group.rotation.y = this.carYaw;
    this.driveRig(rig, dt, this.carV, turn, CAR_SPECS.sedan.wheelRadius);
    rig.brakelights.emissiveIntensity = 0.7;
    // The back wheels light up as it goes
    if (ct < CAR_GO + 1.1) this.wheelSmoke(rig, 'rear', dt, 0.8);
    if (this.carS >= this.carLen) rig.group.visible = false;
  }

  /** Wheels round, front wheels steered into the turn, the body rolled out of it and squatting under power. */
  private driveRig(rig: CarRig, dt: number, v: number, turn: number, radius: number, spinFront = 0): void {
    const roll = v * dt / radius;
    rig.wheels.rl.rotation.x += roll;
    rig.wheels.rr.rotation.x += roll;
    rig.wheels.fl.rotation.x += roll + spinFront * dt;
    rig.wheels.fr.rotation.x += roll + spinFront * dt;
    const steer = THREE.MathUtils.clamp(turn * 2.2, -0.5, 0.5);
    rig.steer.l.rotation.y = steer;
    rig.steer.r.rotation.y = steer;
    rig.body.rotation.z = THREE.MathUtils.clamp(-turn * v * 0.02, -0.07, 0.07);
  }

  /** Tyre smoke off one pair of wheels, at a rate that doesn't flood the pool. */
  private wheelSmoke(rig: CarRig, pair: 'front' | 'rear', dt: number, amount: number): void {
    this.smokeAcc += dt * 30 * amount;
    const wheels = pair === 'front' ? [rig.wheels.fl, rig.wheels.fr] : [rig.wheels.rl, rig.wheels.rr];
    const back = Level8Scene.tmpD.set(0, 0.25, 1).applyQuaternion(rig.group.quaternion);
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      for (const w of wheels) {
        const at = w.getWorldPosition(Level8Scene.tmpC);
        at.y = 0.25;
        this.particles.tyreSmoke(at, back, 1);
      }
    }
  }

  // -------------------------------------------------------------- the reveal

  /** Cut to him: the bars stay, the camera leaves Ravi's eyes. */
  private startReveal(): void {
    if (this.phase !== 'opening') return;
    this.phase = 'reveal';
    this.revealT = 0;
    this.beats.clear();
    this.bossRig.group.visible = false;
    this.boss.root.visible = false;
    // Ravi has stopped where the lane opens out: it is where the fight starts
    this.player.position.copy(this.level.ravi.fightStart);
    // He is in the gateway when the shot opens, and the rest of his walk is
    // toward the camera
    this.general.enemy.root.visible = true;
    this.placeGeneral(GATE_IN, -Math.PI / 2);
    this.genLeg = 0;
    this.nextGeneralLeg();
  }

  /**
   * Low on the asphalt as he comes in through the gate; his name; the chest;
   * the roar; and then he goes for a car. The last shot is back in Ravi's
   * eyes, watching it come.
   */
  private updateReveal(dt: number): void {
    const { audio } = this.ctx;
    const L = this.level;
    const g = this.general;
    const e = g.enemy;
    this.revealT += dt;
    const t = this.revealT;

    // Walking on in to his mark
    if (this.genWalkT >= 0 && this.genLeg < GENERAL_WALK_IN.length) {
      this.genWalkT += dt;
      if (this.genWalkT >= this.genWalkDur) {
        this.genLeg++;
        if (this.genLeg < GENERAL_WALK_IN.length) this.nextGeneralLeg();
        else this.beats.add('arrived');
      }
    }
    const arrived = this.beats.has('arrived');
    this.beat('title', 1.0, t, () => {
      this.titleEl.style.opacity = '1';
      this.titleEl.style.transform = 'translateY(0)';
      audio.revealSting();
    });
    this.beat('titleOut', 5.6, t, () => (this.titleEl.style.opacity = '0'));

    // At his mark: the chest, then the roar
    if (arrived && !this.beats.has('pound')) {
      this.beats.add('pound');
      this.poundAt = t;
      this.poundDur = g.play('chestPound', { at: this.player.position });
    }
    if (this.poundAt >= 0 && t > this.poundAt + this.poundDur && !this.beats.has('roar')) {
      this.beats.add('roar');
      this.roarAt = t;
      this.roarDur = g.play('roar', { at: this.player.position });
      audio.startBossMusic();
    }
    // Then a car: lobbed to come down in front of Ravi, short
    if (this.roarAt >= 0 && t > this.roarAt + this.roarDur && !this.revealThrown) {
      this.revealThrown = true;
      this.throwAt = t;
      const to = Level8Scene.tmpA.copy(e.root.position).sub(L.ravi.fightStart).setY(0).normalize();
      const land = L.ravi.fightStart.clone().addScaledVector(to, 11);
      g.scriptThrow(land, true);
    }

    // The camera
    const gp = e.root.position;
    const head = e.headWorld(Level8Scene.tmpB);
    if (!arrived || this.poundAt < 0) {
      // A: low on the ground ahead of him, rising as he comes on
      const k = smooth(t / 5.5);
      const look = Level8Scene.tmpC.copy(gp).lerp(head, 0.15 + 0.75 * k);
      this.setShot(REVEAL_CAM_A.clone().setY(0.35 + 1.1 * k), look, 48);
    } else if (this.roarAt < 0) {
      // B: the chest-beating, square on
      const k = smooth((t - this.poundAt) / this.poundDur);
      const pos = Level8Scene.tmpC.set(gp.x + 8.5 - 1.2 * k, 2.3, gp.z + 1.4);
      this.setShot(pos, Level8Scene.tmpD.copy(head).setY(head.y - 0.8), 46);
    } else if (!this.revealThrown || this.liftedAt < 0 || t < this.liftedAt + 0.7) {
      // C: low and close for the roar; then wide as he goes for the pile
      if (!this.revealThrown) {
        const pos = Level8Scene.tmpC.set(gp.x + 4.6, 1.0, gp.z + 2.4);
        this.setShot(pos, head, 50);
      } else {
        const pos = Level8Scene.tmpC.set(gp.x + 7.5, 2.6, gp.z + 6.5);
        this.setShot(pos, Level8Scene.tmpD.copy(gp).setY(2.2), 52);
      }
    } else {
      // D: back in Ravi's eyes for the throw
      this.shot = null;
      const eye = this.player.eyePosition(Level8Scene.tmpC);
      const { yaw, pitch } = yawPitchTo(eye, Level8Scene.tmpD.copy(gp).setY(3.2));
      this.player.yaw = yaw;
      this.player.pitch = pitch;
      this.camYaw = yaw;
      this.camPitch = pitch;
      // On him down a long lens with the car over his head; opening right
      // out as it leaves his hands, so the handover is at the game's own lens
      this.camFov = this.thrownAt < 0 ? 24 : 24 + (74 - 24) * smooth((t - this.thrownAt) / 0.85);
    }
    // Hand over once it is in the air; or if no car ever came, after a wait
    if (this.thrownAt >= 0 && t > this.thrownAt + 0.9) this.startFight();
    else if (this.revealThrown && t > this.throwAt + 12) this.startFight();
  }

  private poundAt = -1;
  private poundDur = 0;
  private roarAt = -1;
  private roarDur = 0;
  private throwAt = -1;

  private setShot(pos: THREE.Vector3, look: THREE.Vector3, fov: number): void {
    if (!this.shot) this.shot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov };
    this.shot.pos.copy(pos);
    this.shot.look.copy(look);
    this.shot.fov = fov;
  }

  /** A third-person shot: the scene's camera put where the shot wants it, after player.update. */
  private applyShot(): void {
    if (!this.shot) return;
    const cam = this.player.camera;
    cam.position.copy(this.shot.pos);
    cam.lookAt(this.shot.look);
    cam.updateMatrixWorld();
    this.camFov = this.shot.fov;
  }

  /**
   * Straight to the fight — a Space press during the opening, or a retry
   * after a death. The boss and his car long gone, the General at his mark
   * facing down the lot, Ravi where the lane opens out.
   */
  private skipToFight(): void {
    const L = this.level;
    this.boss.root.visible = false;
    this.boss.root.position.set(0, -60, 0);
    this.bossRig.group.visible = false;
    this.bossRig.headlights.emissiveIntensity = 0;
    L.stairDoor.pivot.rotation.y = L.stairDoor.openAngle;
    this.general.enemy.root.visible = true;
    this.placeGeneral(L.general.reveal, L.general.revealYaw);
    this.player.position.copy(L.ravi.fightStart);
    this.player.velocity.set(0, 0, 0);
    this.player.yaw = L.ravi.fightYaw;
    this.player.pitch = 0;
    this.camYaw = this.player.yaw;
    this.camPitch = 0;
    this.titleEl.style.opacity = '0';
    this.fadeEl.style.opacity = '0';
    this.ctx.audio.startBossMusic();
    this.startFight();
  }

  /** Control back: bars away, HUD and his health up, the gun out, and he starts throwing. */
  private startFight(): void {
    if (this.phase === 'fight') return;
    const { input } = this.ctx;
    this.phase = 'fight';
    this.shot = null;
    this.player.cinematic = false;
    this.player.yaw = this.camYaw;
    this.player.pitch = this.camPitch;
    this.player.crouching = false;
    this.letterbox.classList.add('open');
    this.skipEl.classList.add('gone');
    this.titleEl.style.opacity = '0';
    this.hud.show();
    this.hud.setAmmo(...this.arsenal.ammoReadout());
    this.general.mode = 'fight';
    this.general.paused = false;
    this.level.gate.collider.disabled = false;
    this.setObjective('DODGE THE CARS — GET CLOSE — TAKE HIM DOWN');
    input.requestPointerLock();
    // Anything Space or a click queued up during the cutscene is not a shot or a jump
    input.consumeClick();
  }

  // ---------------------------------------------------------------- the fight

  private onGeneral(e: GeneralEvent): void {
    const { audio } = this.ctx;
    const me = this.player.position;
    const at = this.general.enemy.root.position;
    const dist = at.distanceTo(me);
    switch (e.type) {
      case 'step': {
        audio.giantStep(e.pos.distanceTo(me));
        const d = e.pos.distanceTo(me);
        if (e.heavy && d < 30) this.addShake(0.22 * (1 - d / 30));
        break;
      }
      case 'pound':
        audio.chestPound(e.i, dist);
        if (this.shot) this.addShake(0.08);
        break;
      case 'roar':
        audio.giantRoar(1, dist);
        this.addShake(this.shot ? 0.55 : 0.35);
        break;
      case 'lift':
        audio.carLift(dist);
        if (this.phase === 'reveal' && this.liftedAt < 0) this.liftedAt = this.revealT;
        break;
      case 'throw':
        if (this.phase === 'reveal' && this.thrownAt < 0) this.thrownAt = this.revealT;
        break;
      case 'stomp': {
        const d = e.pos.distanceTo(me);
        audio.stomp(d);
        this.particles.dust(e.pos, e.radius * 0.7, 2);
        this.addShake(d < e.radius ? 1.4 : 0.5);
        if (this.phase === 'fight' && this.player.alive && this.player.grounded && d < e.radius) {
          this.hurtRavi(STOMP_DAMAGE);
          const away = Level8Scene.tmpA.copy(me).sub(e.pos).setY(0);
          if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
          this.startShove(away.normalize(), STOMP_SHOVE);
        }
        break;
      }
      case 'fall':
        audio.giantRoar(0.55, dist);
        break;
      case 'fell':
        audio.giantFall();
        this.cars.alarmsNear(e.pos, 14);
        this.particles.dust(e.pos, 9, 3);
        this.addShake(1.5);
        audio.stopBossMusic(3.5);
        break;
      default:
        break;
    }
  }

  /** Damage without the death-flash rule bending: the HUD flashes on any hit that leaves him standing. */
  private hurtRavi(n: number): void {
    const p = this.player;
    if (!p.alive) return;
    const per = p.damagePerHit;
    p.damagePerHit = n;
    // From where he stands, so a stomp that kills throws Ravi away from him
    p.hit('THE GENERAL', this.general.enemy.position);
    p.damagePerHit = per;
  }

  /** A car got him. Coming down on him or ploughing through him is the end; a glancing blow knocks him flying. */
  private onCrush(lethal: boolean, push: THREE.Vector3): void {
    if (!this.player.alive || (this.phase !== 'fight' && this.phase !== 'won')) return;
    if (lethal) {
      this.addShake(1.6);
      // Flung the way the car was going
      this.player.kill('THE GENERAL', this.player.position.clone().sub(push));
      return;
    }
    this.addShake(1.0);
    this.hurtRavi(GLANCE_DAMAGE);
    this.startShove(push, GLANCE_SHOVE);
  }

  private startShove(dir: THREE.Vector3, dist: number): void {
    this.shoveDir.copy(dir).setY(0).normalize();
    this.shoveLeft = dist;
  }

  /** Knocked along the ground over a few frames, walls solid (FPSPlayer.shove). */
  private applyShove(dt: number): void {
    if (this.shoveLeft <= 0 || !this.player.alive) return;
    const step = Math.min(this.shoveLeft, 16 * dt);
    this.shoveLeft -= step;
    this.player.shove(this.shoveDir.x * step, this.shoveDir.z * step, this.level.colliders);
  }

  /**
   * A round into him. The range decides what it is worth — and what it
   * looks like: from far off it sparks off his kit, close up it draws
   * blood. He is never killed through killEnemy: the ragdoll is a man's.
   */
  protected absorbHit(enemy: Enemy, point: THREE.Vector3, dir: THREE.Vector3, shooter: Enemy | null, part: string): boolean {
    const g = this.general;
    if (enemy !== g.enemy) return false;
    if (shooter !== null || g.dead || g.hp <= 0) return true;
    const { audio, bus } = this.ctx;
    const d = this.player.eyePosition(Level8Scene.tmpA).distanceTo(point);
    const gun = this.arsenal.firing;
    const falloff = gun === 'shotgun' ? Math.min(rangeFactor(d), pelletFactor(d)) : rangeFactor(d);
    const dmg = (AK_DAMAGE[part] ?? AK_DAMAGE.torso) * GUN_DAMAGE[gun] * falloff;
    g.damage(dmg, part, point);
    if (d > (gun === 'shotgun' ? PELLET_SPARK_RANGE : SPARK_RANGE)) {
      this.particles.sparks(point, Level8Scene.tmpB.copy(dir).negate(), 6);
      audio.armourHit(d);
      if (!this.toldTooFar && this.phase === 'fight') {
        this.toldTooFar = true;
        this.setObjective('TOO FAR — GET CLOSER');
      }
    } else {
      this.particles.bloodSpray(point, dir, false, 0.02);
      audio.fleshHit();
    }
    bus.emit(Events.HitMarker, { lethal: g.hp <= 0 });
    if (g.hp <= 0) this.generalDown(part === 'head');
    return true;
  }

  protected killEnemy(enemy: Enemy, point: THREE.Vector3, dir: THREE.Vector3, byPlayer: boolean, headshot: boolean, hitPart?: string): void {
    // Nobody here dies the ordinary way: the boss is gone, the General is handled in absorbHit
    void enemy; void point; void dir; void byPlayer; void headshot; void hitPart;
  }

  /** He's finished: on the kill feed, his bar gone; the fall plays out and he stops being a target. */
  private generalDown(headshot: boolean): void {
    if (this.generalDowned) return;
    this.generalDowned = true;
    const { bus } = this.ctx;
    bus.emit(Events.EnemyKilled, { name: 'THE GENERAL', remaining: 0, headshot, by: 'RAVI' });
    this.hud.setBoss(null, 0);
    this.phase = 'won';
    this.wonT = 0;
    this.setObjective('');
  }
  private generalDowned = false;

  private updateFight(dt: number): void {
    void dt;
    const g = this.general;
    this.hud.setBoss('THE GENERAL', Math.max(0, g.hp / g.maxHp), 'COMMANDER, POLICE FORCE');
    // However he came to be finished, the fight is over
    if (g.hp <= 0) this.generalDown(false);
  }

  /** He's down. Once he's lain still a moment: the Civic, hazards going, and a way out. */
  private updateWon(dt: number): void {
    const { input, audio } = this.ctx;
    this.wonT += dt;
    if (this.general.dead && !this.partsPulled) {
      this.partsPulled = true;
      for (const p of this.general.enemy.parts) {
        const k = this.level.shootables.indexOf(p);
        if (k >= 0) this.level.shootables.splice(k, 1);
      }
    }
    if (this.wonT > 5) {
      this.setObjective('GET TO THE CIVIC');
      // Hazards on: it is the only car on the lot that's going anywhere
      this.hazardT += dt;
      this.civicRig.indicators.emissiveIntensity = Math.sin(this.hazardT * Math.PI * 2 * 1.4) > 0 ? 2.4 : 0;
    }
    const door = this.civicRig.group.localToWorld(Level8Scene.tmpA.set(-1.25, 0, 0.25));
    const near = this.wonT > 5 && this.player.alive && door.distanceTo(this.player.position) < CIVIC_REACH;
    this.hud.setPrompt(near ? '[ E ] GET IN' : null);
    if (near && input.wasPressed('KeyE')) {
      audio.carDoor(true, 0);
      this.startOutro();
    }
  }
  private partsPulled = false;

  // ------------------------------------------------------------- the getaway

  private startOutro(): void {
    this.phase = 'outro';
    this.escapeT = 0;
    this.beats.clear();
    this.hud.setPrompt(null);
    this.hud.hide();
    this.setObjective('');
    this.cancelKick();
    this.drink.abort();
    this.emote.cancel();
    this.player.cinematic = true;
    this.player.aiming = false;
    this.letterbox.classList.remove('open');
    this.civicRig.indicators.emissiveIntensity = 0;
    this.ctx.input.exitPointerLock();
  }

  private cancelKick(): void {
    if (!this.dropKick.engaged) return;
    this.dropKick.abort();
    this.endKickRun();
  }

  /**
   * The Civic. A cut to outside: he's in, the door goes, it won't start, it
   * does; the front wheels light up in their own smoke, a hubcap goes, and
   * it's out of the gate and away up the road after the boss.
   */
  private updateOutro(dt: number): void {
    const { audio } = this.ctx;
    const L = this.level;
    const rig = this.civicRig;
    this.escapeT += dt;
    const t = this.escapeT;
    const C = rig.group.position;

    // Cut through black
    this.fadeEl.style.opacity = String(t < 0.25 ? t / 0.25 : t < 0.35 ? 1 : Math.max(0, 1 - (t - 0.35) / 0.4));
    this.beat('in', 0.3, t, () => {
      if (this.driver) this.driver.root.visible = true;
      rig.setDoor(1);
    });
    if (t > 0.3) rig.setDoor(1 - smooth((t - 0.45) / 0.32));
    this.beat('slam', 0.76, t, () => {
      audio.carDoor(false, 4);
      this.addShake(0.12);
    });
    this.beat('crank1', 1.1, t, () => audio.engineCrank(false));
    this.beat('line', 1.4, t, () => {
      this.dialogue.play([{ speaker: 'RAVI', text: 'Come on, come on…', pitch: 1.0 }], () => undefined);
    });
    this.beat('lineEnd', 3.0, t, () => this.dialogue.close());
    this.beat('crank2', 3.2, t, () => audio.engineCrank(true));
    this.beat('catch', 4.1, t, () => {
      this.particles.exhaust(rig.exhaust.getWorldPosition(Level8Scene.tmpA), Level8Scene.tmpB.set(0, 0.2, 1).applyQuaternion(rig.group.quaternion));
    });
    // Headlights stutter on as it catches
    if (t > 4.1) rig.headlights.emissiveIntensity = t < 4.5 ? (Math.sin(t * 60) > 0 ? 2.2 : 0.3) : 2.4;
    this.beat('rev', 4.5, t, () => audio.engineRev(4.2));
    this.beat('squeal', 4.8, t, () => audio.tyreSqueal(2.4, 3));

    // Cranking and idling: it shakes on its springs
    const crank = (t > 1.1 && t < 2.2) || (t > 3.2 && t < 4.1);
    const idle = t >= 4.1;
    const shakeK = crank ? 0.012 : idle ? 0.006 : 0;
    rig.body.position.y = rig.body.userData.restY ?? (rig.body.userData.restY = rig.body.position.y);
    rig.body.position.y += Math.sin(t * 47) * shakeK;
    rig.body.rotation.z = Math.sin(t * 31) * shakeK * 0.6;

    // The burnout: front wheels spinning in place, then away
    const spinning = t > 4.8 && this.civicV < 11;
    if (spinning) {
      this.wheelSpin = Math.min(55, this.wheelSpin + dt * 90);
      this.wheelSmoke(rig, 'front', dt, 1.6);
      // Front wheel drive: the nose digs down as it spins
      rig.body.rotation.x = -0.02;
    } else {
      this.wheelSpin = Math.max(0, this.wheelSpin - dt * 60);
      rig.body.rotation.x = 0;
    }
    if (t > 4.5 && t < 6.6 && Math.floor(t * 6) !== Math.floor((t - dt) * 6)) {
      this.particles.exhaust(rig.exhaust.getWorldPosition(Level8Scene.tmpA), Level8Scene.tmpB.set(0, 0.2, 1).applyQuaternion(rig.group.quaternion));
    }
    let turn = 0;
    if (t > LAUNCH) {
      this.civicV = Math.min(22, this.civicV + 8.5 * dt);
      this.civicS = Math.min(this.civicLen || (this.civicLen = pathLength(L.civic.drive)), this.civicS + this.civicV * dt);
      const at = alongPath(L.civic.drive, this.civicS, Level8Scene.tmpA, Level8Scene.tmpB);
      const heading = Math.atan2(-Level8Scene.tmpB.x, -Level8Scene.tmpB.z);
      turn = wrapAngle(heading - this.civicYaw);
      this.civicYaw += turn * Math.min(1, dt * 4.5);
      // A twitch of the tail as the spinning wheels find grip
      const fish = Math.sin((t - LAUNCH) * 7) * 0.09 * Math.exp(-(t - LAUNCH) * 1.6);
      C.set(at.x, 0, at.z);
      rig.group.rotation.y = this.civicYaw + fish;
    }
    this.driveRig(rig, dt, this.civicV, turn, CAR_SPECS.hatch.wheelRadius, this.wheelSpin);

    // The hubcap: off as it launches, and away across the lot on its own
    this.beat('hubcap', LAUNCH + 0.35, t, () => this.dropHubcap());
    this.updateHubcap(dt);

    // The camera
    if (t < 4.6) {
      // Front three-quarter: him at the wheel through the glass
      this.setShot(
        rig.group.localToWorld(Level8Scene.tmpA.set(-3.4, 1.25, -4.3)),
        rig.group.localToWorld(Level8Scene.tmpB.set(-0.2, 0.95, 0.2)),
        44
      );
    } else if (t < LAUNCH + 0.25) {
      // Down by the front wheel in the smoke
      this.setShot(
        Level8Scene.tmpA.set(C.x - 3.0, 0.5, C.z - 2.2),
        rig.group.localToWorld(Level8Scene.tmpB.set(-0.6, 0.45, -1.1)),
        50
      );
    } else {
      // From across the road, panning with it out through the gate and away
      this.setShot(OUTRO_CAM, Level8Scene.tmpB.copy(C).setY(0.8), 50);
    }

    // To black, the card, and on
    if (t > 10.2) this.fadeEl.style.opacity = String(Math.min(1, (t - 10.2) / 0.9));
    if (t > 11.4) this.endCard.style.opacity = '1';
    if (t > 15.4 && !this.handedOff) {
      this.handedOff = true;
      this.ctx.bus.emit(Events.Level8Complete);
    }
  }

  private dropHubcap(): void {
    const cap = this.civicRig.hubcap;
    this.scene.attach(cap);
    this.hubcap = cap;
    // Off to the car's left, rolling, a bit faster than the car is going
    const left = Level8Scene.tmpA.set(-1, 0, -0.35).applyQuaternion(this.civicRig.group.quaternion).normalize();
    this.hubcapV.copy(left).multiplyScalar(3.4).setY(1.2);
    this.hubcapSpin = 18;
    this.hubcapT = 0;
    this.ctx.audio.carScrape(3);
  }

  private updateHubcap(dt: number): void {
    const cap = this.hubcap;
    if (!cap) return;
    this.hubcapT += dt;
    this.hubcapV.y -= 9.8 * dt;
    cap.position.addScaledVector(this.hubcapV, dt);
    if (cap.position.y < 0.18) {
      cap.position.y = 0.18;
      if (this.hubcapV.y < 0) this.hubcapV.y *= -0.3;
      this.hubcapV.x *= 1 - dt * 0.35;
      this.hubcapV.z *= 1 - dt * 0.35;
    }
    // Rolling on its edge, then wobbling down flat
    this.hubcapSpin *= 1 - dt * 0.4;
    cap.rotation.x += this.hubcapSpin * dt;
    const fallK = smooth((this.hubcapT - 2.2) / 1.2);
    cap.rotation.z = fallK * (Math.PI / 2) + Math.sin(this.hubcapT * 14) * 0.15 * (1 - fallK) * clamp01(this.hubcapT - 1.2);
    if (fallK >= 1) cap.position.y = Math.max(0.02, cap.position.y - dt);
  }

  // ---------------------------------------------------------------- update

  private get playable(): boolean {
    return this.player.alive && (this.phase === 'fight' || this.phase === 'won');
  }

  private get cutscene(): boolean {
    return this.phase === 'opening' || this.phase === 'reveal' || this.phase === 'outro';
  }

  private addShake(k: number): void {
    this.shake = Math.min(1.8, Math.max(this.shake, k));
  }

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    this.t += dt;
    if (this.dead) this.deadT += dt;
    const playable = this.playable;

    if (playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();

    // ---- Deadbull (G) and the drop kick (Q)
    if (input.wasPressed('KeyG') && playable && input.pointerLocked && !this.arsenal.reloading && !this.dropKick.engaged) {
      this.drink.start();
    }
    if (!this.player.alive) this.drink.abort();
    if (input.wasPressed('KeyQ') && playable && input.pointerLocked && !this.arsenal.reloading && !this.drink.engaged && this.player.grounded) {
      if (this.dropKick.start()) {
        this.emote.cancel();
        this.player.cinematic = true;
        this.player.aiming = false;
        this.beginKickRun(null);
      }
    }
    if (this.dropKick.engaged && !this.player.alive) {
      this.dropKick.abort();
      this.player.cinematic = false;
      this.endKickRun();
    }
    this.runKick(this.dropKick, dt);
    this.dropKick.update(dt);
    const busy = this.drink.engaged || this.dropKick.engaged;

    // ---- The guns: 1/2/3 and the stow. In a cutscene the one in hand sits
    // just out of shot (0.99, never hidden) and the other two are away
    const hideGun = this.cutscene;
    if (hideGun) {
      const held = this.arsenal.held;
      for (const v of this.arsenal.all) if (v !== held) v.stow = 1;
      held.stow = Math.min(0.99, held.stow + dt * 6);
    }
    this.arsenal.preUpdate(dt, input, { canSwitch: playable && input.pointerLocked, busy, hold: hideGun });

    const aiming = !busy && input.rightHeld && input.pointerLocked && playable && !this.arsenal.reloading;
    this.player.aiming = aiming;

    // ---- Where the camera is, before the player's update writes it
    if (this.phase === 'opening') this.openingPose(dt);
    this.applyShove(dt);
    this.player.update(dt, this.level.colliders);
    this.keepInArena();
    this.dropKick.applyCamera(this.player);
    if (this.phase === 'opening') this.runBob();

    // ---- The story
    if (this.phase === 'opening') this.updateOpening(dt);
    else if (this.phase === 'reveal') this.updateReveal(dt);
    else if (this.phase === 'fight') this.updateFight(dt);
    else if (this.phase === 'won') this.updateWon(dt);
    else if (this.phase === 'outro') this.updateOutro(dt);
    this.general.update(dt);
    this.applyShot();
    this.applyShake(dt);

    // ---- The gun
    if (input.wasPressed('KeyT') && playable && input.pointerLocked && !this.arsenal.reloading) this.emote.toggle();
    if (this.arsenal.reloading || !this.player.alive || this.cutscene) this.emote.cancel();
    this.arsenal.hideSupportHand = this.emote.engaged;
    this.arsenal.updateViewmodels(dt, aiming);
    this.emote.update(dt, this.player);
    this.drink.update(dt, this.player);
    const targetFov = this.cutscene ? this.camFov : 74 - this.arsenal.zoomFov;
    if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
      this.player.camera.fov = targetFov;
      this.player.camera.updateProjectionMatrix();
    }
    this.hud.setAiming(this.arsenal.aimBlend > 0.5);
    if (playable) {
      this.arsenal.updateFire(dt, input, input.pointerLocked && !busy, (r, m, reloading) => this.hud.setAmmo(r, m, reloading));
    } else input.consumeClick();

    this.hud.setHealth(this.player.health, this.player.regenProgress);
    this.dialogue.update(dt);
    this.updateDebris(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.world.step(1 / 60, dt, 3);
    this.cars.suspendCrush = this.cutscene;
    this.cars.update(dt, this.player, this.player.camera);
    input.endFrame();
  }

  /**
   * The lot's edge, as a hard limit. The fences stop him on the ground, but
   * a wreck by the fence is a step up onto it — he could vault from the pile
   * onto the fence top and walk off into the road, where the Civic is out of
   * reach. So during the fight he stays inside, whatever he climbs.
   */
  private keepInArena(): void {
    if (this.phase !== 'fight' && this.phase !== 'won') return;
    const a = this.level.arena;
    const p = this.player.position;
    p.x = THREE.MathUtils.clamp(p.x, a.minX + 0.45, a.maxX - 0.45);
    p.z = THREE.MathUtils.clamp(p.z, a.minZ + 0.45, a.maxZ - 0.45);
  }

  /** The ground jumping under him: after the camera is placed, and never once he's dead (the death camera keeps x and z). */
  private applyShake(dt: number): void {
    if (this.shake <= 0) return;
    this.shake = Math.max(0, this.shake - dt * 1.7);
    if (!this.player.alive) return;
    const s = this.shake * this.shake * 0.07;
    const cam = this.player.camera;
    cam.position.x += (Math.random() - 0.5) * s;
    cam.position.y += (Math.random() - 0.5) * s;
    cam.position.z += (Math.random() - 0.5) * s;
    cam.rotation.z += (Math.random() - 0.5) * s * 0.6;
    cam.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- input

  /** A click is the gun's — except once he is dead, when it is the restart (after a beat, so the trigger finger doesn't do it). */
  private onClick(): void {
    if (this.dead && this.deadT > 1.0) this.ctx.bus.emit(Events.RestartLevel8);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.dead) {
      if (this.deadT < 1.0) return;
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') this.ctx.bus.emit(Events.RestartLevel8);
      return;
    }
    // Skip the opening — but not once he has gone for the car: that throw is the handover
    if (e.code === 'Space' && this.t > 0.5 && (this.phase === 'opening' || (this.phase === 'reveal' && !this.revealThrown))) {
      e.preventDefault();
      this.skipToFight();
    }
  }

  // ---------------------------------------------------------------- render

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}

/** Seconds into the getaway that the Civic finds some grip and goes. */
const LAUNCH = 6.5;
/**
 * The last shot: across the road from the gate, panning with the Civic as
 * it comes out at the camera, swings up the road and is gone. (From inside
 * the lot the scrap pile hid the road.)
 */
const OUTRO_CAM = new THREE.Vector3(-116, 2.2, 13);

/** Where the boss's run starts, down the lane from the stairwell door. */
const BOSS_FROM_X = -11;
/** How much of his run is left when the shot cuts to his car, metres. */
const BOSS_LAST_STRETCH = 21;
/** The camera for the boss's getaway: low, behind his car and off to the side. */
const CAR_CAM = new THREE.Vector3(-84.5, 1.15, 31.5);
/** Ravi's sprint out of the door to where the lane opens up, seconds. */
const RUN_TIME = 4.2;
/** Seconds after the boss reaches his door that the car pulls away. */
const CAR_GO = 1.4;
/** Metres along its route at which the boss's car is out through the gate. */
const CAR_GATE = 22;
/**
 * The police force's truck, on the road south of the gate (it brought him),
 * and where he waits out of sight until the reveal. Clear of the getaway's
 * last shot, which looks across the road at the gate.
 */
const TRUCK_AT = new THREE.Vector3(-106, 0, 34);
const GENERAL_HIDE = new THREE.Vector3(-110.4, 0, 30);
/** Where he is when the reveal cuts to him: just inside the gateway. */
const GATE_IN = new THREE.Vector3(-100.2, 0, 11.9);
/** In from the gateway to his mark. */
const GENERAL_WALK_IN = [new THREE.Vector3(-95.5, 0, 10.8), new THREE.Vector3(-89, 0, 9.5)];
/** The first shot of the reveal: low on the asphalt, ahead of him, as he comes in. */
const REVEAL_CAM_A = new THREE.Vector3(-82.5, 0.35, 11.4);
