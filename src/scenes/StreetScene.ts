import * as THREE from 'three';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { StreetBuilder, STREET_ATMOSPHERE } from '../environment/StreetBuilder';
import type { StreetData, RoadPos, DriveInput, CopRig, JetRig, PoliceRig } from './StreetContracts';
import type { CarRig } from './Level8Contracts';
import { civic, bossCar } from '../environment/VehicleProps';
import { policeCruiser, copRig, privateJet } from '../environment/StreetProps';
import { dataDrive } from '../environment/OfficeProps';
import { RoadNet } from '../entities/RoadNet';
import { DriveCar, CIVIC_TUNE, resolveCollisions } from '../entities/DriveCar';
import { Traffic } from '../entities/Traffic';
import { BossDriver, CopDriver } from '../entities/Chasers';
import { Enemy } from '../entities/Enemy';
import { RaviVisual } from '../entities/RaviVisual';
import { ParticleManager } from '../fx/ParticleManager';
import { track, smooth, clamp01, alongPath, pathLength, wrapAngle } from './cutscene';

/** m/s → mph, for the speedo and the radar. */
const MPH = 2.237;
/** Past this far ahead of Ravi (route metres) the boss is getting away; held there this long, he's gone. */
const LOSING_GAP = 200;
const LOST_GAP = 280;
const LOST_TIME = 4;
/** The cop cutscene starts with the boss this far short of the cop (route metres). */
const COP_LEAD = 170;
/** And Ravi this far behind the boss, both flat out. */
const COP_RAVI_GAP = 45;
const COP_BOSS_SPEED = 49.5;
const COP_RAVI_SPEED = 47;
/** Highway route metres past the cop where a retry from the checkpoint puts Ravi. */
const CHECKPOINT_AHEAD = 140;
/** The airport cutscene takes over with the boss this far short of the gate (the end of the airport road). */
const AIRPORT_CUT = 130;

type Phase = 'intro' | 'drive' | 'cop' | 'airport' | 'failed' | 'done';
type Shot = 'chase' | 'roadside' | 'cabin' | 'radar' | 'behindCop' | 'launch' | 'gate' | 'apron' | 'stairs' | 'arrive';

/**
 * Level 10 — the street. Ravi in the Civic after the boss: the avenue, the
 * on-ramp, the elevated highway, the cop who joins in, the airport exit, and
 * the boss running for his jet. Third-person behind the car.
 *
 * `checkpoint` 1 starts on the highway just past the cop, him already after
 * them (a retry once that far).
 */
export class StreetScene implements GameScene {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, STREET_ATMOSPHERE.cameraFar);
  private level!: StreetData;
  private net!: RoadNet;
  private traffic!: Traffic;
  private player!: DriveCar;
  private boss!: BossDriver;
  private cop!: CopDriver;
  private particles!: ParticleManager;

  private civicRig!: CarRig;
  private bossRig!: CarRig;
  private police!: PoliceRig;
  private copMan!: CopRig;
  private jet!: JetRig;
  private bossMan!: Enemy;
  private driver: THREE.Object3D | null = null;

  private phase: Phase = 'intro';
  private phaseT = 0;
  private shot: Shot = 'chase';
  private copDone = false;
  private copChasing = false;
  private damage = 0;
  private lostT = 0;
  private bustT = 0;
  private failT = 0;
  private failWhy = '';
  private exitTold = false;
  private shake = 0;
  private hornCd = 0;
  private scrapeCd = 0;
  private crashCd = 0;
  private lightT = 0;

  // ---- The chase camera: a yaw that trails the car's, and the lens
  private camYaw = 0;
  private camY = 0;
  private camReady = false;
  private readonly lookAt = new THREE.Vector3();

  // ---- Sound
  private engine: { setSpeed(mps: number, throttle: number): void; setGain(g: number): void; stop(): void } | null = null;
  private tyres: { set(slide: number): void; stop(): void } | null = null;
  private siren: { setDistance(m: number): void; stop(): void } | null = null;
  /** Which traffic cars were ahead of Ravi last frame and how far, for the fly-by whooshes. */
  private passing = new Map<number, number>();

  // ---- The cop cutscene
  private doughnutVel = new THREE.Vector3();
  private doughnutFlying = false;
  private radarBossShown = false;
  private radarRaviShown = false;

  // ---- The airport
  private bossPath: THREE.Vector3[] = [];
  private bossPathLen = 0;
  private bossPathS = 0;
  private bossV = 0;
  private civicPath: THREE.Vector3[] = [];
  private civicPathLen = 0;
  private civicPathS = 0;
  private civicV = 0;
  private copPathS = 0;
  private copV = 0;
  private gateHit = false;
  private bossStoppedAt = -1;
  private bossOnFoot = -1;
  private civicStoppedAt = -1;
  private readonly runPts: THREE.Vector3[] = [];
  private runLen = 0;
  private endT = -1;
  private completed = false;
  private readonly apronCam = new THREE.Vector3();

  // ---- UI
  private ui!: HTMLElement;
  private letterbox!: HTMLElement;
  private fadeEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private objective!: HTMLElement;
  private hud!: HTMLElement;
  private speedEl!: HTMLElement;
  private dmgEl!: HTMLElement;
  private bossEl!: HTMLElement;
  private copEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private failEl!: HTMLElement;
  private endCard!: HTMLElement;
  private warmedUp = false;
  private unsubs: (() => void)[] = [];
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private clickHandler = (): void => this.onClick();

  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();
  private static tmpC = new THREE.Vector3();
  private static tmpPos: RoadPos = { road: 'city', s: 0, d: 0 };

  constructor(
    private ctx: GameContext,
    private checkpoint = 0
  ) {}

  // ------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, audio } = this.ctx;
    const A = STREET_ATMOSPHERE;
    this.scene.background = new THREE.Color(A.background);
    this.scene.fog = new THREE.Fog(A.fog.color, A.fog.near, A.fog.far);
    this.ctx.engine.renderer.toneMappingExposure = A.exposure;
    this.scene.add(this.camera);

    this.level = new StreetBuilder().build();
    this.scene.add(this.level.group);
    this.net = new RoadNet(this.level.roads);
    // Busy, but with room to drive: about half the builder's default traffic
    this.traffic = new Traffic(this.net, {
      seed: (Math.random() * 1e6) | 0,
      density: { city: 0.5, onramp: 0.45, highway: 0.5, exit: 0, airport: 0 }
    });
    this.scene.add(this.traffic.object);

    this.player = new DriveCar(this.net, CIVIC_TUNE, 'player');
    this.boss = new BossDriver(this.net);
    this.cop = new CopDriver(this.net);
    for (const c of [this.player, this.boss.car, this.cop.car]) c.blockers = this.level.blockers;
    this.player.onImpact = (speed, point, other) => this.onPlayerImpact(speed, point, other);
    this.traffic.onHorn = (pos) => {
      if (this.hornCd > 0 || this.phase === 'airport') return;
      this.hornCd = 0.5;
      audio.horn(pos.distanceTo(this.player.position));
    };

    this.civicRig = civic();
    this.bossRig = bossCar();
    this.police = policeCruiser();
    this.copMan = copRig();
    this.police.group.add(this.copMan.root);
    this.jet = privateJet();
    for (const r of [this.civicRig, this.bossRig, this.police]) this.scene.add(r.group);
    // The hubcap came off in the parking lot
    (this.civicRig as { hubcap?: THREE.Object3D }).hubcap?.removeFromParent();
    const J = this.level.airport.jet;
    this.jet.group.position.copy(J.pos);
    this.jet.group.rotation.y = J.yaw;
    this.jet.setDoor(1);
    this.scene.add(this.jet.group);
    this.buildDriver();
    this.bossMan = new Enemy(new THREE.Vector3(0, -60, 0), 0, 7, { name: 'THE BOSS', boss: true });
    this.bossMan.holdProp(dataDrive(), 0.045);
    this.bossMan.root.visible = false;
    this.scene.add(this.bossMan.root);

    this.particles = new ParticleManager(this.scene, { smoke: 1600 });

    this.buildUI();
    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
      })
    );
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('click', this.clickHandler);

    this.engine = audio.engineLoop();
    this.tyres = audio.tyreSlideLoop();

    this.placeCast();
    if (this.checkpoint >= 1) this.startDrive(true);
    else this.startIntro();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('click', this.clickHandler);
    this.engine?.stop();
    this.tyres?.stop();
    this.siren?.stop();
    this.ctx.audio.stopBossMusic(1);
    this.traffic.dispose();
    this.ui.remove();
    this.ctx.engine.renderer.toneMappingExposure = 1;
  }

  /** Everyone where the run (or the checkpoint) starts them. */
  private placeCast(): void {
    const L = this.level;
    this.cop.park(L.cop.pos, L.cop.yaw);
    if (this.checkpoint >= 1) {
      const hw = L.roads.highway;
      const lane = hw.lanes.filter((l) => l.dir === 1)[1] ?? hw.lanes[0];
      const s = L.cop.s + CHECKPOINT_AHEAD;
      this.player.place({ road: 'highway', s, d: lane.offset }, 40);
      this.boss.place({ road: 'highway', s: s + 55, d: lane.offset }, 42);
      this.cop.car.place({ road: 'highway', s: s - 50, d: lane.offset }, 42);
      this.cop.mode = 'chase';
      this.copDone = true;
      this.copChasing = true;
      this.copMan.pose('driving');
      this.traffic.clear('highway', s - 80, s + 120);
    } else {
      this.player.place(L.start.civic, 22);
      this.boss.place(L.start.boss, 26);
      this.copMan.pose('feetUp');
    }
    this.traffic.update(0.001, this.player.at, [this.player, this.boss.car, this.cop.car]);
  }

  /** Ravi at the wheel, seen through the glass: the whole modelled man, as Level 8's getaway sat him. */
  private buildDriver(): void {
    const rig = this.civicRig;
    RaviVisual.whenReady(() => {
      const r = RaviVisual.rig('body');
      r.root.rotation.y = Math.PI;
      const axle = rig.body.position.y;
      r.root.position.set(rig.seat.hip.x, -axle, rig.seat.hip.z);
      rig.body.add(r.root);
      const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
      const fwd = rig.seat.hip.z - rig.seat.wheel.z;
      const wy = rig.seat.wheel.y;
      const grip = { fingers: [[70, 80, 40], [72, 82, 40], [74, 84, 42], [76, 86, 44]], thumb: [0.45, 0.5, 0.3] } as const;
      const shape = (): never => ({ fingers: grip.fingers.map((f) => [...f]), thumb: [...grip.thumb] }) as never;
      r.seat({
        hips: V(0, rig.seat.hip.y, 0),
        lean: [-10, 3, 3, 2, 2, -2],
        legs: {
          l: { ankle: V(0.16, 0.14, fwd + 0.42), knee: V(0.12, 0.8, 1) },
          r: { ankle: V(-0.14, 0.14, fwd + 0.42), knee: V(-0.12, 0.8, 1) }
        },
        arms: {
          l: { wrist: V(0.17, wy + 0.04, fwd - 0.06), along: V(-0.25, 0.55, 0.8), palm: V(-0.75, -0.1, 0.6), elbow: V(0.6, -0.6, -0.4), shape: shape() },
          r: { wrist: V(-0.17, wy + 0.04, fwd - 0.06), along: V(0.25, 0.55, 0.8), palm: V(0.75, -0.1, 0.6), elbow: V(-0.6, -0.6, -0.4), shape: shape() }
        }
      });
      this.driver = r.root;
    });
  }

  // ------------------------------------------------------------------- UI

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <style>
        .st-hud { position:absolute; inset:0; pointer-events:none; font-family:'Courier New',monospace; color:#e8f4ec;
          text-shadow:0 1px 3px rgba(0,0,0,0.9); transition:opacity 0.4s; }
        .st-hud.off { opacity:0; }
        .st-speed { position:absolute; right:34px; bottom:30px; text-align:right; }
        .st-speed b { font-size:54px; letter-spacing:2px; }
        .st-speed span { font-size:13px; letter-spacing:4px; margin-left:8px; color:#c9d6cf; }
        .st-dmg { position:absolute; right:34px; bottom:104px; display:flex; align-items:center; gap:10px; font-size:11px; letter-spacing:3px; }
        .st-dmg i { display:block; width:150px; height:7px; border:1px solid rgba(232,244,236,0.6); }
        .st-dmg i b { display:block; height:100%; width:100%; background:#52e07a; transition:width 0.25s, background 0.25s; }
        .st-boss { position:absolute; left:50%; top:24px; transform:translateX(-50%); font-size:14px; letter-spacing:4px; }
        .st-boss.far { color:#ff6a50; animation:st-blink 0.5s steps(2,jump-none) infinite; }
        .st-cop { position:absolute; left:34px; bottom:34px; font-size:13px; letter-spacing:4px; opacity:0; transition:opacity 0.4s; }
        .st-cop.on { opacity:1; animation:st-cop 0.5s steps(2,jump-none) infinite; }
        @keyframes st-cop { 0% { color:#ff4646; } 100% { color:#4f8bff; } }
        @keyframes st-blink { 0% { opacity:1; } 100% { opacity:0.35; } }
        .st-hint { position:absolute; left:50%; bottom:13vh; transform:translateX(-50%); font-size:13px; letter-spacing:3px;
          white-space:nowrap; opacity:0; transition:opacity 0.6s; }
        .st-hint.show { opacity:1; }
        .st-hint .k { display:inline-block; padding:2px 6px; margin:0 4px 0 14px; color:#050608; background:#f0efe9; border-radius:3px; text-shadow:none; }
        .st-fail { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px;
          background:rgba(0,0,0,0.55); opacity:0; transition:opacity 0.6s; font-family:'Courier New',monospace; }
        .st-fail.show { opacity:1; pointer-events:all; }
        .st-fail .t { font-size:40px; letter-spacing:10px; color:#ff6a50; font-weight:bold; }
        .st-fail .s { font-size:13px; letter-spacing:4px; color:#c9d6cf; }
      </style>
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="st-hud off">
        <div class="st-boss">BOSS <b>—</b></div>
        <div class="st-dmg">CAR <i><b></b></i></div>
        <div class="st-speed"><b>0</b><span>MPH</span></div>
        <div class="st-cop">◆ POLICE PURSUIT ◆</div>
        <div class="st-hint"><span class="k">W</span>GAS<span class="k">S</span>BRAKE<span class="k">A</span><span class="k" style="margin-left:0">D</span>STEER<span class="k">SPACE</span>HANDBRAKE</div>
      </div>
      <div class="st-title" style="position:absolute;left:0;right:0;bottom:22vh;text-align:center;pointer-events:none;
        opacity:0;transition:opacity 0.9s, transform 3.5s ease-out;transform:translateY(8px)">
        <div style="font-size:15px;letter-spacing:6px;color:#c9b77a;margin-bottom:6px">LEVEL 10</div>
        <div style="font-size:54px;letter-spacing:14px;color:#f1ece0;font-weight:bold;text-shadow:0 3px 18px rgba(0,0,0,0.7)">THE STREET</div>
      </div>
      <div class="intro-fade" style="opacity:1;transition:opacity 0.8s"></div>
      <div class="st-fail"><div class="t"></div><div class="s">[ R ] TRY AGAIN &nbsp;&nbsp; [ ESC ] MENU</div></div>
      <div class="st-end" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        color:#e8f4ec;font-size:22px;letter-spacing:9px;opacity:0;pointer-events:none;transition:opacity 1.2s">TO BE CONTINUED</div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
    this.titleEl = el.querySelector('.st-title')!;
    this.hud = el.querySelector('.st-hud')!;
    this.speedEl = el.querySelector('.st-speed b')!;
    this.dmgEl = el.querySelector('.st-dmg i b')!;
    this.bossEl = el.querySelector('.st-boss')!;
    this.copEl = el.querySelector('.st-cop')!;
    this.hintEl = el.querySelector('.st-hint')!;
    this.failEl = el.querySelector('.st-fail')!;
    this.endCard = el.querySelector('.st-end')!;
  }

  private setObjective(text: string): void {
    if (this.objective.textContent === text) return;
    this.objective.textContent = text;
    this.objective.classList.remove('show');
    void this.objective.offsetWidth;
    if (text) this.objective.classList.add('show');
  }

  private cinematic(on: boolean): void {
    this.letterbox.classList.toggle('open', !on);
    this.hud.classList.toggle('off', on);
  }

  // ---------------------------------------------------------------- input

  private onKey(e: KeyboardEvent): void {
    if (this.phase === 'failed' && this.failT > 1) {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if (e.code === 'KeyR' || e.code === 'Space' || e.code === 'Enter') this.retry();
    }
  }

  private onClick(): void {
    if (this.phase === 'failed' && this.failT > 1) this.retry();
  }

  private retry(): void {
    this.ctx.bus.emit(Events.RestartStreet, { checkpoint: this.copDone ? 1 : 0 });
  }

  /** The keyboard, as the car's controls. */
  private readInput(): DriveInput {
    const i = this.ctx.input;
    const down = (...k: string[]): boolean => k.some((c) => i.isDown(c));
    const gas = down('KeyW', 'ArrowUp') ? 1 : 0;
    const brake = down('KeyS', 'ArrowDown') ? 1 : 0;
    const left = down('KeyA', 'ArrowLeft') ? 1 : 0;
    const right = down('KeyD', 'ArrowRight') ? 1 : 0;
    return { throttle: gas - brake, steer: right - left, handbrake: down('Space') };
  }

  private readonly autoIn: DriveInput = { throttle: 0, steer: 0, handbrake: false };

  /**
   * Ravi's hands while a cutscene has the camera: hold the nearest lane
   * going his way at about `speed`.
   */
  private autopilot(speed: number): DriveInput {
    const p = this.player;
    const exit = this.boss.car.at.road === 'exit' || this.boss.car.at.road === 'airport';
    const ahead = this.net.advance(p.at, Math.max(14, p.speed * 0.55), exit, StreetScene.tmpPos);
    // The lane on the road ahead nearest where he is (a road with no lanes: down the middle)
    const road = this.net.roads[ahead.road];
    let d = 0;
    let best = Infinity;
    for (const l of road.lanes) {
      if (l.dir !== 1) continue;
      const dd = Math.abs(l.offset - p.at.d);
      if (dd < best) {
        best = dd;
        d = l.offset;
      }
    }
    ahead.d = d;
    const tgt = this.net.point(ahead, StreetScene.tmpA);
    const want = Math.atan2(-(tgt.x - p.position.x), -(tgt.z - p.position.z));
    const err = wrapAngle(want - p.yaw);
    const o = this.autoIn;
    o.steer = THREE.MathUtils.clamp(-err * 3, -1, 1);
    o.throttle = p.speed < speed - 0.5 ? 1 : p.speed > speed + 2 ? -0.4 : 0.15;
    o.handbrake = false;
    return o;
  }

  // ----------------------------------------------------------------- update

  update(dt: number, _time: number): void {
    dt = Math.min(dt, 0.05);
    this.phaseT += dt;
    this.hornCd -= dt;
    this.scrapeCd -= dt;
    this.crashCd -= dt;
    this.lightT += dt;

    // ---- Who drives
    let input: DriveInput | null;
    switch (this.phase) {
      case 'intro':
        input = this.autopilot(26);
        break;
      case 'drive':
        input = this.readInput();
        break;
      case 'cop':
        input = this.autopilot(COP_RAVI_SPEED);
        break;
      case 'failed':
        input = { throttle: this.failWhy === 'BUSTED' || this.damage >= 100 ? -1 : 0, steer: 0, handbrake: false };
        break;
      default:
        input = null;
    }

    if (this.phase !== 'airport' && this.phase !== 'done') {
      this.boss.update(dt, this.player, this.traffic, this.cop.car);
      this.cop.update(dt, this.player, this.traffic, this.boss.car);
      this.player.update(dt, input);
      this.traffic.update(dt, this.player.at, [this.player, this.boss.car, this.cop.car]);
      resolveCollisions([this.player, this.boss.car, this.cop.car], this.traffic);
      if (this.cop.mode === 'launch' && this.cop.merged) this.cop.mode = 'chase';
    } else {
      this.updateAirport(dt);
    }

    if (this.phase === 'intro') this.updateIntro();
    else if (this.phase === 'drive') this.updateDrive(dt);
    else if (this.phase === 'cop') this.updateCop(dt);
    else if (this.phase === 'failed') this.failT += dt;

    // ---- The cars onto their rigs
    if (this.phase !== 'airport' && this.phase !== 'done') {
      this.player.applyTo(this.civicRig, dt);
      this.boss.car.applyTo(this.bossRig, dt);
      this.cop.car.applyTo(this.police, dt);
    }
    this.lamps();
    this.copMan.update(dt);
    this.bossMan.update(dt);
    this.effects(dt);
    this.sound();
    this.updateCamera(dt);
    this.updateHud();
    this.particles.update(dt);
    this.ctx.input.endFrame();
  }

  // ----------------------------------------------------------------- intro

  /**
   * Out of the parking lot and onto the avenue: the boss's saloon goes past
   * the camera on the kerb with the Civic in its slipstream, and the title
   * comes up behind the car. Then he's Ravi's to drive.
   */
  private startIntro(): void {
    this.phase = 'intro';
    this.phaseT = 0;
    this.cinematic(true);
    this.fadeEl.style.opacity = '0';
    this.shot = 'roadside';
    this.ctx.audio.tyreSqueal(1.2);
  }

  private updateIntro(): void {
    const t = this.phaseT;
    this.shot = t < 2.6 ? 'roadside' : 'chase';
    if (t > 2.8 && this.titleEl.style.opacity !== '1') {
      this.titleEl.style.opacity = '1';
      this.titleEl.style.transform = 'translateY(0)';
    }
    if (t > 5.0) this.startDrive(false);
  }

  /** Hands on the wheel. */
  private startDrive(fromCheckpoint: boolean): void {
    this.phase = 'drive';
    this.phaseT = 0;
    this.shot = 'chase';
    this.cinematic(false);
    this.fadeEl.style.opacity = '0';
    this.ctx.audio.startBossMusic();
    // The title has had its moment
    setTimeout(() => (this.titleEl.style.opacity = '0'), 900);
    if (fromCheckpoint) {
      this.siren ??= this.ctx.audio.sirenLoop();
      this.setObjective('LOSE THE COP — STAY ON THE BOSS');
    } else {
      this.setObjective('CHASE THE BOSS');
      this.hintEl.classList.add('show');
      setTimeout(() => this.hintEl.classList.remove('show'), 6000);
    }
  }

  // ---------------------------------------------------------------- driving

  private updateDrive(dt: number): void {
    const L = this.level;
    const p = this.player;
    const gap = this.net.routeS(this.boss.car.at) - this.net.routeS(p.at);

    // ---- The cop, as they come up on him
    if (!this.copDone && this.boss.car.at.road === 'highway' && this.boss.car.at.s > L.cop.s - COP_LEAD) {
      this.startCop();
      return;
    }
    // ---- The exit
    if (!this.exitTold && this.boss.car.at.road === 'highway' && this.boss.car.at.s > L.exitS - 260) {
      this.exitTold = true;
      this.setObjective('HE\'S GOING FOR THE AIRPORT EXIT — STAY ON HIM');
    }
    // The last stretch to the gate: from here it's the cutscene's
    const ap = L.roads.airport;
    if (this.boss.car.at.road === 'airport' && this.boss.car.at.s > ap.length - AIRPORT_CUT && (p.at.road === 'exit' || p.at.road === 'airport')) {
      this.startAirport();
      return;
    }

    // ---- He's always out in front. Closing on his bumper, the Civic's
    // flat out drops to just under his — it can't get past him on pace —
    // and if he's been boxed in and Ravi gets by, it's held right down
    // until he's back in front
    const bv = Math.max(0, this.boss.car.speed);
    let top = CIVIC_TUNE.topSpeed;
    if (gap < 0) top = Math.min(top, Math.max(14, bv * 0.75));
    else if (gap < 30) top = Math.min(top, Math.max(18, bv - 2.5 + gap * 0.3));
    this.player.tune.topSpeed += (top - this.player.tune.topSpeed) * Math.min(1, dt * 3);

    // ---- Losing him
    if (p.at.road === 'highway' && p.at.s > L.missedExitS && (this.boss.car.at.road === 'exit' || this.boss.car.at.road === 'airport')) {
      this.fail('YOU MISSED THE EXIT');
      return;
    }
    if (gap > LOST_GAP) this.lostT += dt;
    else this.lostT = Math.max(0, this.lostT - dt);
    if (this.lostT > LOST_TIME) {
      this.fail('YOU LOST HIM');
      return;
    }
    // ---- Pulled over
    if (this.copChasing && Math.abs(p.speed) < 2.5 && p.position.distanceTo(this.cop.car.position) < 9) this.bustT += dt;
    else this.bustT = Math.max(0, this.bustT - dt * 2);
    if (this.bustT > 2.5) {
      this.fail('BUSTED');
      return;
    }
    if (this.damage >= 100) this.fail('WRECKED');
  }

  private onPlayerImpact(speed: number, point: THREE.Vector3, other: 'wall' | 'traffic' | 'boss' | 'cop' | 'player'): void {
    const { audio } = this.ctx;
    if (this.phase === 'done') return;
    let dmg = 0;
    if (other === 'wall') {
      dmg = Math.max(0, speed - 5) * 1.1;
      if (speed > 7 && this.crashCd <= 0) {
        this.crashCd = 0.25;
        audio.carCrash(0, speed > 14);
      } else if (this.scrapeCd <= 0) {
        this.scrapeCd = 0.35;
        audio.carScrape(0);
      }
      this.particles.sparks(point, StreetScene.tmpA.set(0, 0.6, 0), Math.min(26, 6 + speed * 1.2));
    } else {
      dmg = Math.max(0, speed - 3) * (other === 'traffic' ? 1.7 : 1.2);
      if (this.crashCd <= 0) {
        this.crashCd = 0.2;
        audio.carCrash(0, speed > 10);
      }
      if (speed > 6) this.particles.sparks(point, StreetScene.tmpA.set(0, 0.8, 0), Math.min(30, speed * 1.5));
    }
    // Cutscenes are on autopilot: no damage while Ravi isn't driving
    if (this.phase !== 'drive') dmg = 0;
    this.damage = Math.min(100, this.damage + Math.min(35, dmg));
    this.shake = Math.min(1.2, this.shake + speed * 0.045);
  }

  private fail(why: string): void {
    this.phase = 'failed';
    this.failT = 0;
    this.failWhy = why;
    (this.failEl.querySelector('.t') as HTMLElement).textContent = why;
    setTimeout(() => this.failEl.classList.add('show'), 900);
    this.ctx.audio.stopBossMusic(2);
    this.setObjective('');
  }

  // ------------------------------------------------------------ the cop

  /**
   * Flat out past the cop on his shoulder, feet up on the dash with a
   * doughnut. The boss goes by and the radar screams; Ravi goes by; the
   * doughnut goes flying, and the cruiser comes off the shoulder after
   * them, lights and siren.
   */
  private startCop(): void {
    const L = this.level;
    this.phase = 'cop';
    this.phaseT = 0;
    this.copDone = true;
    this.cinematic(true);
    this.hintEl.classList.remove('show');
    // Lined up for the shot: the boss COP_LEAD short of the cop, Ravi on his tail (hidden by the cut)
    const bossS = L.cop.s - COP_LEAD;
    const lane = this.boss.car.at.d;
    this.boss.place({ road: 'highway', s: bossS, d: lane }, COP_BOSS_SPEED);
    this.boss.mode = 'hold';
    const rLane = this.nearestLane('highway', this.player.at.road === 'highway' ? this.player.at.d : lane);
    this.player.place({ road: 'highway', s: bossS - COP_RAVI_GAP, d: rLane }, COP_RAVI_SPEED);
    this.player.tune.topSpeed = CIVIC_TUNE.topSpeed;
    // Room to get by, and for him to pull out
    this.traffic.clear('highway', bossS - COP_RAVI_GAP - 60, L.cop.s + 300);
    this.copMan.pose('feetUp');
    this.police.radar.show(null, false);
    this.radarBossShown = false;
    this.radarRaviShown = false;
    this.engine?.setGain(0.3);
  }

  private nearestLane(road: 'highway', d: number): number {
    let best = d;
    let bd = Infinity;
    for (const l of this.net.roads[road].lanes) {
      if (l.dir !== 1) continue;
      const dd = Math.abs(l.offset - d);
      if (dd < bd) {
        bd = dd;
        best = l.offset;
      }
    }
    return best;
  }

  private updateCop(dt: number): void {
    const t = this.phaseT;
    const { audio } = this.ctx;
    const L = this.level;
    const bossPast = this.boss.car.at.s - L.cop.s;
    const raviPast = this.player.at.s - L.cop.s;
    // Shots: in the cruiser with him; the radar as the boss goes by; behind the cruiser as Ravi does; the doughnut; the launch
    if (t < 2.9) this.shot = 'cabin';
    else if (t < 3.95) this.shot = 'radar';
    else if (t < 5.05) this.shot = 'behindCop';
    else if (t < 6.2) this.shot = 'cabin';
    else this.shot = 'launch';

    // He eats
    if (t < 5.05) this.copMan.pose('bite', track([[0.5, 0], [1.1, 1], [1.9, 1], [2.4, 0]], t));
    // The radar locks on
    if (!this.radarBossShown && bossPast > -12) {
      this.radarBossShown = true;
      this.police.radar.show(Math.round(this.boss.car.speed * MPH), true);
      audio.radarBeep();
      audio.carWhoosh(4);
    }
    if (!this.radarRaviShown && raviPast > -10) {
      this.radarRaviShown = true;
      this.police.radar.show(Math.round(this.player.speed * MPH), true);
      audio.radarBeep();
      audio.carWhoosh(3);
    }
    // He sees it
    if (t >= 5.05 && !this.doughnutFlying && t < 5.2) {
      this.copMan.pose('startled');
      const d = this.copMan.doughnut;
      this.scene.attach(d);
      const f = Math.sin(this.police.group.rotation.y);
      const g = Math.cos(this.police.group.rotation.y);
      this.doughnutVel.set(-f * 1.2 + (Math.random() - 0.5), 3.2, -g * 1.2);
      this.doughnutFlying = true;
    }
    if (this.doughnutFlying) {
      const d = this.copMan.doughnut;
      this.doughnutVel.y -= 9.8 * dt;
      d.position.addScaledVector(this.doughnutVel, dt);
      d.rotation.x += dt * 9;
      d.rotation.z += dt * 5;
      if (t > 7) {
        d.visible = false;
        this.doughnutFlying = false;
      }
    }
    // After them
    if (t >= 6.2 && this.cop.mode === 'parked') {
      this.copMan.pose('driving');
      this.cop.mode = 'launch';
      this.copChasing = true;
      this.siren ??= audio.sirenLoop();
      audio.tyreSqueal(1.6, 8);
      this.police.radar.show(null, false);
    }
    if (t > 8.4) {
      this.boss.mode = 'drive';
      this.phase = 'drive';
      this.phaseT = 0;
      this.shot = 'chase';
      this.cinematic(false);
      this.engine?.setGain(1);
      this.setObjective('THE COPS ARE ON YOU — STAY ON THE BOSS');
    }
  }

  // ------------------------------------------------------------ the airport

  /**
   * He's off the exit and onto the airport road: from here it's scripted.
   * Through the gate (the arm goes flying), across the apron to the jet,
   * out of the car and up the airstair; the Civic and the cop skid in
   * behind him as the door comes up.
   */
  private startAirport(): void {
    const L = this.level;
    this.phase = 'airport';
    this.phaseT = 0;
    this.cinematic(true);
    this.traffic.enabled = false;
    this.ctx.audio.stopBossMusic(4);
    this.setObjective('');
    const ap = this.net.roads.airport;
    const pathOn = (from: THREE.Vector3, s0: number, tail: THREE.Vector3[]): THREE.Vector3[] => {
      const pts = [from.clone().setY(0)];
      for (let s = s0 + 10; s < ap.length; s += 10) pts.push(this.net.sample('airport', s).pos.clone().setY(0));
      for (const q of tail) pts.push(q.clone().setY(0));
      return pts;
    };
    this.bossPath = pathOn(this.boss.car.position, this.boss.car.at.s, L.airport.bossPath);
    this.bossPathLen = pathLength(this.bossPath);
    this.bossPathS = 0;
    this.bossV = Math.max(26, this.boss.car.speed);
    const ravi = this.player;
    // Ravi has to be behind him for this: if he's alongside or past (the
    // boss boxed in somewhere), the cut to the gate puts him back on his tail
    if (this.net.routeS(ravi.at) > this.net.routeS(this.boss.car.at) - 25) {
      const back = this.net.advance(this.boss.car.at, -35, true, StreetScene.tmpPos);
      back.d = 0;
      ravi.place(back, Math.max(20, this.boss.car.speed));
    }
    const rs = ravi.at.road === 'airport' ? ravi.at.s : 0;
    const head = ravi.at.road === 'exit' ? [ravi.position.clone(), this.net.sample('airport', 0).pos.clone()] : [ravi.position.clone()];
    this.civicPath = [...head.map((v) => v.setY(0)), ...pathOn(this.net.sample('airport', rs).pos, rs, L.airport.civicPath).slice(1)];
    this.civicPathLen = pathLength(this.civicPath);
    this.civicPathS = 0;
    this.civicV = Math.max(16, ravi.speed);
    // The cop rides the Civic's line, a way behind it
    this.copPathS = -Math.min(45, Math.max(18, ravi.position.distanceTo(this.cop.car.position)));
    this.copV = this.civicV;
    this.jet.setEngines(0.25);
  }

  private updateAirport(dt: number): void {
    const t = this.phaseT;
    const { audio } = this.ctx;
    const L = this.level;
    // ---- His car: hard all the way, then on the brakes for the jet
    const bossLeft = this.bossPathLen - this.bossPathS;
    if (this.bossStoppedAt < 0) {
      const vStop = Math.sqrt(2 * 9 * Math.max(0, bossLeft));
      this.bossV = Math.min(Math.min(32, this.bossV + 6 * dt), vStop);
      this.bossPathS = Math.min(this.bossPathLen, this.bossPathS + this.bossV * dt);
      if (bossLeft < 0.15) {
        this.bossStoppedAt = t;
        audio.tyreSqueal(0.6, this.camera.position.distanceTo(this.bossRig.group.position));
      }
    }
    this.carOnPath(this.bossRig, this.bossPath, this.bossPathS, this.bossStoppedAt < 0 ? this.bossV : 0, dt, bossLeft < 25 && this.bossStoppedAt < 0);

    // ---- The gate
    if (!this.gateHit && this.bossRig.group.position.distanceTo(L.airport.gate.pos) < 5) {
      this.gateHit = true;
      audio.carCrash(this.camera.position.distanceTo(L.airport.gate.pos), true);
      this.particles.sparks(L.airport.gate.pos.clone().setY(1), StreetScene.tmpA.set(0, 1, 0), 30);
    }
    if (this.gateHit) {
      const arm = L.airport.gateArm;
      arm.rotation.z = Math.min(1.45, arm.rotation.z + dt * 9);
    }

    // ---- The Civic and the cop, behind him
    const civicLeft = this.civicPathLen - this.civicPathS;
    if (this.civicStoppedAt < 0) {
      const vStop = Math.sqrt(2 * 8 * Math.max(0, civicLeft));
      this.civicV = Math.min(Math.max(this.civicV, 20), vStop);
      this.civicPathS = Math.min(this.civicPathLen, this.civicPathS + this.civicV * dt);
      if (civicLeft < 0.15) {
        this.civicStoppedAt = t;
        audio.tyreSqueal(0.9, 6);
      }
    }
    this.carOnPath(this.civicRig, this.civicPath, this.civicPathS, this.civicStoppedAt < 0 ? this.civicV : 0, dt, civicLeft < 22 && this.civicStoppedAt < 0);
    const copEnd = this.civicPathLen - 11;
    const copLeft = copEnd - this.copPathS;
    this.copV = Math.min(Math.max(this.copV, 18), Math.sqrt(2 * 8 * Math.max(0, copLeft)));
    if (copLeft > 0.1) this.copPathS += this.copV * dt;
    if (this.copPathS >= 0) {
      this.carOnPath(this.police, this.civicPath, Math.min(this.copPathS, copEnd), copLeft > 0.1 ? this.copV : 0, dt, copLeft < 20 && copLeft > 0.1, 2.6);
    } else {
      // Not on the Civic's line yet: on the road behind it
      const back = Math.min(this.copPathS, 0);
      const dir = StreetScene.tmpB.copy(this.civicPath[1] ?? this.civicPath[0]).sub(this.civicPath[0]).normalize();
      this.police.group.position.copy(this.civicPath[0]).addScaledVector(dir, back);
    }

    // ---- Out and running
    if (this.bossStoppedAt >= 0 && this.bossOnFoot < 0 && t - this.bossStoppedAt > 0.5) this.leaveCar();
    if (this.bossOnFoot >= 0) this.runForIt(dt);

    // ---- Shots
    if (this.bossOnFoot < 0) this.shot = !this.gateHit || this.bossRig.group.position.distanceTo(L.airport.gate.pos) < 14 ? 'gate' : 'apron';
    else if (this.endT < 0) this.shot = 'stairs';
    else this.shot = 'arrive';
    this.jet.setEngines(Math.min(1, 0.25 + 0.75 * clamp01((t - 2) / 8)));

    // ---- The end: the door comes up, to black, the card, and on
    if (this.endT >= 0 && !this.completed) {
      const e = t - this.endT;
      this.jet.setDoor(1 - smooth(e / 1.6));
      if (e > 4.2 && this.phase === 'airport') {
        this.phase = 'done';
        this.fadeEl.style.opacity = '1';
      }
      if (e > 5.4) this.endCard.style.opacity = '1';
      if (e > 9) {
        this.completed = true;
        this.ctx.bus.emit(Events.StreetComplete);
      }
    }
  }

  /** A rig driven along a ground path at distance `s`, nose along it, wheels turning, a little squat under braking. */
  private carOnPath(rig: CarRig, path: THREE.Vector3[], s: number, v: number, dt: number, braking: boolean, back = 0): void {
    const dir = StreetScene.tmpB;
    alongPath(path, Math.max(0, s - back), rig.group.position, dir);
    const yaw = Math.atan2(-dir.x, -dir.z);
    const cur = rig.group.rotation.y;
    rig.group.rotation.y = cur + wrapAngle(yaw - cur) * Math.min(1, dt * 8);
    rig.group.rotation.x = 0;
    rig.group.rotation.z = 0;
    const spin = (v * dt) / 0.32;
    for (const w of [rig.wheels.fl, rig.wheels.fr, rig.wheels.rl, rig.wheels.rr]) w.rotation.x -= spin;
    rig.body.rotation.x = THREE.MathUtils.lerp(rig.body.rotation.x, braking ? -0.05 : 0, Math.min(1, dt * 6));
    rig.brakelights.emissiveIntensity = braking ? 2.2 : 0.2;
    if (braking && v > 6) {
      const back2 = StreetScene.tmpC.copy(rig.group.position).addScaledVector(dir, -1.4).setY(0.3);
      this.particles.tyreSmoke(back2, StreetScene.tmpA.copy(dir).negate(), 0.8);
    }
  }

  /** The door, and him: out of the driver's side with the drive, and away to the jet. */
  private leaveCar(): void {
    const { audio } = this.ctx;
    const L = this.level;
    this.bossOnFoot = this.phaseT;
    this.bossRig.setDoor(1);
    audio.carDoor(true, this.camera.position.distanceTo(this.bossRig.group.position));
    const g = this.bossRig.group;
    // The driver's side: −X, car-local
    const out = new THREE.Vector3(-1.35, 0, -0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).add(g.position);
    out.y = 0;
    const jet = this.jet.group;
    jet.updateMatrixWorld(true);
    const foot = this.jet.stairFoot.clone().applyMatrix4(jet.matrixWorld);
    const top = this.jet.doorTop.clone().applyMatrix4(jet.matrixWorld);
    // Round the end of the car rather than through it, then to the stair and up it
    this.runPts.length = 0;
    this.runPts.push(out, L.airport.stairFoot.clone().setY(0).lerp(foot, 0.5), foot, top);
    this.runLen = pathLength(this.runPts);
    this.bossMan.position.copy(out);
    this.bossMan.root.visible = true;
  }

  private runS = 0;

  private runForIt(dt: number): void {
    const t = this.phaseT - this.bossOnFoot;
    const b = this.bossMan;
    if (t < 0.35) return;
    if (t > 0.8) this.bossRig.setDoor(Math.max(0, 1 - (t - 0.8) * 3));
    const climbing = this.runS > this.runLen - this.runPts[2].distanceTo(this.runPts[3]);
    const speed = climbing ? 2.6 : 5.4;
    this.runS = Math.min(this.runLen, this.runS + speed * dt);
    const dir = StreetScene.tmpB;
    alongPath(this.runPts, this.runS, b.position, dir);
    b.faceToward(StreetScene.tmpC.copy(b.position).add(dir.setY(0)), dt, 14);
    b.cadence = climbing ? 1.2 : 1.55;
    b.setWalk(this.runS < this.runLen ? (climbing ? 0.8 : 1.35) : 0);
    if (this.runS >= this.runLen && this.endT < 0) {
      // In: gone, and the door comes up
      b.root.visible = false;
      this.endT = this.phaseT;
      this.ctx.audio.bigEngineDrive(5, this.camera.position.distanceTo(this.jet.group.position));
    }
  }

  // ------------------------------------------------------------- the world

  /** Brake lights, the cop's light bar, the boss's lamps. */
  private lamps(): void {
    const p = this.player;
    if (this.phase !== 'airport' && this.phase !== 'done') {
      this.civicRig.brakelights.emissiveIntensity = p.braking ? 2.4 : 0.25;
      this.bossRig.brakelights.emissiveIntensity = this.boss.car.braking ? 2.4 : 0.25;
      this.police.brakelights.emissiveIntensity = this.cop.car.braking ? 2.4 : 0.25;
    }
    // Red, blue, red, blue — a double flash each side
    if (this.copChasing) {
      const ph = (this.lightT * 2.2) % 1;
      const flash = (a: number): number => (Math.sin(ph * 2 * Math.PI * 4) > 0 && ((ph - a + 1) % 1) < 0.5 ? 3 : 0);
      this.police.lightRed.emissiveIntensity = flash(0);
      this.police.lightBlue.emissiveIntensity = flash(0.5);
    } else {
      this.police.lightRed.emissiveIntensity = 0;
      this.police.lightBlue.emissiveIntensity = 0;
    }
  }

  /** Tyre smoke, a smoking engine once he's hurt the car, the fly-by whooshes. */
  private effects(dt: number): void {
    const p = this.player;
    const dir = StreetScene.tmpA.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    if (p.slide > 0.35 && Math.abs(p.speed) > 6 && this.phase !== 'airport') {
      const back = StreetScene.tmpB.copy(p.position).addScaledVector(dir, -1.4).setY(p.position.y + 0.3);
      this.particles.tyreSmoke(back, StreetScene.tmpC.copy(dir).negate(), p.slide);
    }
    for (const car of [this.boss.car, this.cop.car]) {
      if (car.slide > 0.45 && Math.abs(car.speed) > 6) {
        const f = StreetScene.tmpB.set(-Math.sin(car.yaw), 0, -Math.cos(car.yaw));
        const back = StreetScene.tmpC.copy(car.position).addScaledVector(f, -1.5).setY(car.position.y + 0.3);
        this.particles.tyreSmoke(back, f.negate(), car.slide * 0.8);
      }
    }
    if (this.damage > 55 && Math.random() < dt * (4 + this.damage * 0.1)) {
      const g = this.civicRig.group;
      const bonnet = StreetScene.tmpB.set(0, 1.05, -1.4).applyQuaternion(g.quaternion).add(g.position);
      this.particles.exhaust(bonnet, StreetScene.tmpC.set(0, 1, 0));
    }
    // Fly-bys: a car going past within a lane's width, quickly
    if (this.phase === 'drive' || this.phase === 'intro') {
      for (const c of this.traffic.cars) {
        const rx = c.position.x - p.position.x;
        const rz = c.position.z - p.position.z;
        const along = rx * dir.x + rz * dir.z;
        const lat = Math.abs(rx * dir.z - rz * dir.x);
        const prev = this.passing.get(c.id);
        if (Math.abs(along) < 30 && lat < 4) {
          if (prev !== undefined && prev > 0 && along <= 0 && Math.abs(p.speed - c.speed) > 12) this.ctx.audio.carWhoosh(lat);
          this.passing.set(c.id, along);
        } else this.passing.delete(c.id);
      }
    }
  }

  private sound(): void {
    const p = this.player;
    const driving = this.phase !== 'airport' && this.phase !== 'done';
    this.engine?.setSpeed(driving ? Math.abs(p.speed) : this.civicStoppedAt < 0 ? this.civicV : 0, driving ? Math.max(0, p.throttleNow) : 0.3);
    this.tyres?.set(driving && this.shot === 'chase' ? p.slide : 0);
    if (this.siren) {
      const copPos = this.police.group.position;
      this.siren.setDistance(this.camera.position.distanceTo(copPos));
    }
  }

  // ---------------------------------------------------------------- camera

  private updateCamera(dt: number): void {
    const cam = this.camera;
    const p = this.player;
    let fov = 68;
    switch (this.shot) {
      case 'chase': {
        // Behind and above, trailing the car's heading; further back and wider the faster he goes
        if (!this.camReady) {
          this.camYaw = p.yaw;
          this.camY = p.position.y;
          this.camReady = true;
        }
        this.camYaw += wrapAngle(p.yaw - this.camYaw) * Math.min(1, dt * 5.5);
        this.camY += (p.position.y - this.camY) * Math.min(1, dt * 7);
        const v = Math.abs(p.speed);
        const k = clamp01(v / 50);
        const back = 6.4 + 1.6 * k;
        const fx = -Math.sin(this.camYaw);
        const fz = -Math.cos(this.camYaw);
        cam.position.set(p.position.x - fx * back, this.camY + 2.3 + 0.2 * k, p.position.z - fz * back);
        this.lookAt.set(p.position.x + fx * 7, this.camY + 1.1, p.position.z + fz * 7);
        fov = 66 + 16 * k;
        break;
      }
      case 'roadside': {
        // On the kerb, watching them come and go by
        const L = this.level;
        const at = this.net.point({ road: 'city', s: L.start.civic.s + 70, d: L.roads.city.samples[0].halfRight - 0.6 }, StreetScene.tmpA);
        cam.position.set(at.x, at.y + 0.9, at.z);
        const tgt = this.phaseT < 1.2 ? this.boss.car.position : p.position;
        this.lookAt.lerp(StreetScene.tmpB.copy(tgt).setY(tgt.y + 0.9), this.phaseT < 0.05 ? 1 : Math.min(1, dt * 6));
        fov = 55;
        break;
      }
      case 'cabin': {
        // The passenger seat, on him
        const g = this.police.group;
        g.updateMatrixWorld(true);
        cam.position.set(0.62, 1.2, 0.3).applyMatrix4(g.matrixWorld);
        this.lookAt.set(-0.36, 1.03, -0.32).applyMatrix4(g.matrixWorld);
        fov = 64;
        break;
      }
      case 'radar': {
        const g = this.police.group;
        g.updateMatrixWorld(true);
        const r = this.police.radar.object;
        r.updateMatrixWorld(true);
        const face = r.getWorldPosition(StreetScene.tmpB);
        cam.position.set(-0.15, 1.2, 0.05).applyMatrix4(g.matrixWorld);
        this.lookAt.copy(face);
        fov = 34;
        break;
      }
      case 'behindCop': {
        // Out in front of the parked cruiser, by the barrier, looking back
        // past it up the road: the Civic comes out of the distance and
        // goes by him
        const g = this.police.group;
        const yaw = this.level.cop.yaw;
        const f = StreetScene.tmpB.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        cam.position.copy(this.level.cop.pos).addScaledVector(f, 8).add(StreetScene.tmpC.set(Math.cos(yaw) * 1.4, 1.15, -Math.sin(yaw) * 1.4));
        // From the cruiser, onto Ravi as he comes up on it
        const k = smooth((this.phaseT - 4.05) / 0.5);
        const at = StreetScene.tmpC.copy(g.position).setY(g.position.y + 0.9).lerp(StreetScene.tmpA.copy(p.position).setY(p.position.y + 0.8), k);
        if (this.phaseT - 3.95 < 0.05) this.lookAt.copy(at);
        this.lookAt.lerp(at, Math.min(1, dt * 9));
        fov = 60;
        break;
      }
      case 'launch': {
        // Out front of the cruiser, as it comes off the shoulder
        const L = this.level;
        const yaw = L.cop.yaw;
        const f = StreetScene.tmpB.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        cam.position.copy(L.cop.pos).addScaledVector(f, 16).add(StreetScene.tmpC.set(-f.z * 2.5, 1.1, f.x * 2.5));
        this.lookAt.lerp(StreetScene.tmpC.copy(this.police.group.position).setY(this.police.group.position.y + 0.9), Math.min(1, dt * 8));
        fov = 52;
        break;
      }
      case 'gate': {
        // Just inside the gate by the booth, low, a long lens down the road:
        // the saloon comes at the barrier flat out and through it
        const g = this.level.airport.gate;
        const f = StreetScene.tmpB.set(-Math.sin(g.yaw), 0, -Math.cos(g.yaw));
        cam.position.copy(g.pos).addScaledVector(f, 5).add(StreetScene.tmpC.set(f.z * 4.5, 1.0, -f.x * 4.5));
        const tgt = this.bossRig.group.position;
        this.lookAt.lerp(StreetScene.tmpC.copy(tgt).setY(1), this.phaseT < 0.05 ? 1 : Math.min(1, dt * 7));
        fov = 38;
        break;
      }
      case 'apron': {
        // Alongside him across the apron, a little behind, low
        const g = this.bossRig.group;
        const f = StreetScene.tmpB.set(-Math.sin(g.rotation.y), 0, -Math.cos(g.rotation.y));
        const want = StreetScene.tmpC.copy(g.position).addScaledVector(f, -6).add(StreetScene.tmpA.set(f.z * 8, 1.5, -f.x * 8));
        if (this.apronCam.lengthSq() === 0) this.apronCam.copy(want);
        this.apronCam.lerp(want, Math.min(1, dt * 3));
        cam.position.copy(this.apronCam);
        this.lookAt.lerp(StreetScene.tmpC.copy(g.position).addScaledVector(f, 3).setY(1), Math.min(1, dt * 6));
        fov = 55;
        break;
      }
      case 'stairs': {
        // Off the jet's left wingtip, low: he runs for the stair
        const j = this.jet.group;
        j.updateMatrixWorld(true);
        cam.position.set(-14, 2.2, 6).applyMatrix4(j.matrixWorld);
        const tgt = this.bossMan.position;
        this.lookAt.lerp(StreetScene.tmpC.copy(tgt).setY(tgt.y + 1.3), Math.min(1, dt * 4));
        fov = 50;
        break;
      }
      case 'arrive': {
        // Behind the Civic as it skids in, the jet's door coming up
        const g = this.civicRig.group;
        const f = StreetScene.tmpB.set(-Math.sin(g.rotation.y), 0, -Math.cos(g.rotation.y));
        cam.position.copy(g.position).addScaledVector(f, -7).add(StreetScene.tmpC.set(f.z * 1.8, 2.4, -f.x * 1.8));
        this.lookAt.lerp(StreetScene.tmpC.copy(this.jet.group.position).setY(2.5), Math.min(1, dt * 3));
        fov = 55;
        break;
      }
    }
    // Knocks
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const s = this.shake * 0.12;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.lookAt);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * (this.shot === 'chase' ? Math.min(1, dt * 3) : 1);
      cam.updateProjectionMatrix();
    }
    // Ravi is only seen from outside
    if (this.driver) this.driver.visible = true;
  }

  // ------------------------------------------------------------------- HUD

  private updateHud(): void {
    const p = this.player;
    const mph = Math.round(Math.abs(p.speed) * MPH);
    if (this.speedEl.textContent !== String(mph)) this.speedEl.textContent = String(mph);
    const left = 100 - this.damage;
    this.dmgEl.style.width = `${left}%`;
    this.dmgEl.style.background = left > 55 ? '#52e07a' : left > 25 ? '#e0c452' : '#ff5a46';
    const gap = Math.round(this.net.routeS(this.boss.car.at) - this.net.routeS(p.at));
    const txt = gap > 0 ? `▲ ${gap} m` : '▼';
    const b = this.bossEl.querySelector('b')!;
    if (b.textContent !== txt) b.textContent = txt;
    this.bossEl.classList.toggle('far', gap > LOSING_GAP);
    this.copEl.classList.toggle('on', this.copChasing && this.phase === 'drive');
  }

  // ---------------------------------------------------------------- render

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.warmedUp) this.warmUp(renderer);
    renderer.render(this.scene, this.camera);
  }

  /**
   * Everything's shaders, and the GPU copies of every mesh, behind the
   * loading card: whatever is hidden (the boss on foot, Ravi's model, the
   * doughnut) is shown for one throwaway frame with nothing culled.
   */
  private warmUp(renderer: THREE.WebGLRenderer): void {
    this.warmedUp = true;
    const far = new THREE.Vector3(0, -60, 0);
    this.particles.tyreSmoke(far, new THREE.Vector3(0, 1, 0), 1);
    this.particles.sparks(far, new THREE.Vector3(0, 1, 0), 4);
    this.particles.exhaust(far, new THREE.Vector3(0, 1, 0));
    this.particles.dust(far, 1, 1);
    const hidden: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
      if (!o.visible && !(o as THREE.Light).isLight) {
        hidden.push(o);
        o.visible = true;
      }
    });
    renderer.compile(this.scene, this.camera);
    renderer.render(this.scene, this.camera);
    for (const o of hidden) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
  }
}
