import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { StreetBuilder, STREET_ATMOSPHERE } from '../environment/StreetBuilder';
import { buildAirside, type Airside } from '../environment/AirsideProps';
import type { StreetData, Road, RoadId, RoadSample, DriveInput, JetRig, StreetBlocker } from './StreetContracts';
import type { CarRig, CivicRig } from './Level8Contracts';
import { civic, bossCar, WHEEL_RIM } from '../environment/VehicleProps';
import { privateJet } from '../environment/StreetProps';
import { RoadNet } from '../entities/RoadNet';
import { DriveCar, CIVIC_TUNE } from '../entities/DriveCar';
import { Enemy } from '../entities/Enemy';
import { armWithAK } from '../entities/AkModel';
import { RaviVisual, type RaviRig } from '../entities/RaviVisual';
import { RaviStunt, type StuntPose } from '../entities/RaviStunt';
import { WheelGrip, WHEEL_TURN, wheelInModel } from '../entities/WheelGrip';
import { ParticleManager } from '../fx/ParticleManager';
import { smooth, clamp01, wrapAngle } from './cutscene';

/** m/s → mph. */
const MPH = 2.237;
/** The jet's run: how hard it pulls away, how fast it'll go on the ground, and where along the runway (gate-frame b) it unsticks. */
const JET_ACCEL = 2.2;
const JET_TOP = 40;
const LIFT_B = -1650;
/** The runway's far end (gate-frame b): the road runs to it. */
const RUNWAY_END = -2000;
/** Where Ravi starts (the Civic as Level 10 left it, at the airside gate) and where the jet is. */
const CIVIC_AT: [number, number] = [384, 60];
const JET_AT: [number, number] = [430.5, 30];
/**
 * Where the Civic holds station for the leap, jet-local: just clear of the
 * left wingtip (it's at x −9.45), with its roof — where he crouches, 1.27 m
 * behind the car's middle — level with the landing spot on the wing.
 */
const STATION = { x: -11.0, z: 1.3 };
/** He lands well out on the left wing's upper surface (the vent's wingPath starts two-thirds out; this is further). */
const LANDING = new THREE.Vector3(-7.3, 1.8, 2.57);

type Phase = 'intro' | 'drive' | 'leap' | 'failed' | 'done';
type Shot = 'wide' | 'pov' | 'cockpit' | 'emerge' | 'leapSide' | 'wing' | 'vent';

/**
 * Level 11 — the airport. Picks up where the street left off: the Civic at
 * the airside gate, the security team in front of it, the boss's men by his
 * car on the runway shooting, the jet beginning its take-off run. Ravi puts
 * his foot down through the gate and the men on it, out onto the runway and
 * after the jet, and once he's alongside its wing: out of the sunroof, onto
 * the roof, a leap onto the wing in slow motion, a crawl along it to the
 * open vent, and in.
 *
 * The driving is Level 10's (RoadNet + DriveCar, first person from the
 * driver's seat) on a route of its own: from the gate down the taxiway and
 * round onto the runway.
 */
export class AirportScene implements GameScene {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, STREET_ATMOSPHERE.cameraFar);
  private level!: StreetData;
  private airside!: Airside;
  private net!: RoadNet;
  private player!: DriveCar;
  private world!: CANNON.World;
  private particles!: ParticleManager;

  private civicRig!: CivicRig;
  private bossRig!: CarRig;
  private jet!: JetRig;
  private driver: RaviRig | null = null;
  /** His hands round the wheel, turning with it, while he's sat at it. */
  private wheelGrip: WheelGrip | null = null;
  private stunt: RaviStunt | null = null;
  /** The boss's two men by his car, and the airport's security team at the gate. */
  private guards: Enemy[] = [];
  private officers: Enemy[] = [];
  private readonly diveFrom = new Map<Enemy, THREE.Vector3>();
  private readonly diveTo = new Map<Enemy, THREE.Vector3>();
  private readonly diveT = new Map<Enemy, number>();

  private phase: Phase = 'intro';
  private phaseT = 0;
  private shot: Shot = 'wide';
  private timeScale = 1;
  private damage = 0;
  private shake = 0;
  private failT = 0;
  private failWhy = '';
  private crashCd = 0;
  private scrapeCd = 0;
  private gateHit = false;
  private completed = false;

  // ---- The jet's run
  private jetYaw = 0;
  private readonly jetStart = new THREE.Vector3();
  private jetS = 0;
  private jetV = 0;
  private jetPitch = 0;
  private jetUp = 0;
  private lifting = -1;
  /** Route s (on our road) of the jet's start, so gaps are just differences. */
  private jetRoute0 = 0;

  // ---- Shooting
  private fireCd: number[] = [];
  private burstLeft: number[] = [];
  private cracks = 0;

  // ---- The leap
  private leapT = 0;
  private pose: StuntPose = 'seated';
  private readonly leapFrom = new THREE.Vector3();
  private readonly leapTo = new THREE.Vector3();
  private wingPath: THREE.Vector3[] = [];
  private ventMouth = new THREE.Vector3();

  // ---- Sound
  private engine: { setSpeed(mps: number, throttle: number): void; setGain(g: number): void; stop(): void } | null = null;
  private tyres: { set(slide: number): void; stop(): void } | null = null;
  private jetSound: { setThrust(k: number): void; setDistance(m: number): void; stop(): void } | null = null;

  // ---- UI
  private ui!: HTMLElement;
  private letterbox!: HTMLElement;
  private fadeEl!: HTMLElement;
  private objective!: HTMLElement;
  private hud!: HTMLElement;
  private speedEl!: HTMLElement;
  private dmgEl!: HTMLElement;
  private jetEl!: HTMLElement;
  private runwayEl!: HTMLElement;
  private failEl!: HTMLElement;
  private endCard!: HTMLElement;
  private crackCanvas: HTMLCanvasElement | null = null;
  private readonly lookAt = new THREE.Vector3();
  private warmedUp = false;
  private unsubs: (() => void)[] = [];
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private clickHandler = (): void => this.onClick();

  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();
  private static tmpC = new THREE.Vector3();

  constructor(private ctx: GameContext) {}

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
    const ap = this.level.roads.airport;
    const end = ap.samples[ap.samples.length - 1];
    const f = new THREE.Vector3(end.tangent.x, 0, end.tangent.z).normalize();
    this.airside = buildAirside({ origin: end.pos.clone().setY(0), f, r: new THREE.Vector3(-f.z, 0, f.x) });
    this.scene.add(this.airside.group);

    this.net = new RoadNet(this.buildRoads());
    this.player = new DriveCar(this.net, CIVIC_TUNE, 'player');
    this.player.blockers = [...this.airside.blockers];
    this.player.onImpact = (speed, point, other) => this.onImpact(speed, point, other);

    // Ragdolls for whoever the Civic goes through
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -19, 0) });
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.45;
    this.world.defaultContactMaterial.restitution = 0.12;
    const ground = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);

    this.civicRig = civic();
    (this.civicRig as { hubcap?: THREE.Object3D }).hubcap?.removeFromParent();
    this.scene.add(this.civicRig.group);
    this.cockpitGlass();
    this.bossRig = bossCar();
    this.scene.add(this.bossRig.group);
    this.jet = privateJet();
    this.scene.add(this.jet.group);
    this.particles = new ParticleManager(this.scene, { smoke: 1400 });

    this.placeEveryone();
    this.buildDriver();
    this.buildUI();

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.sizeCracks();
      })
    );
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('click', this.clickHandler);
    this.engine = audio.engineLoop();
    this.tyres = audio.tyreSlideLoop();
    this.jetSound = audio.jetEngine();
    this.startIntro();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('click', this.clickHandler);
    this.engine?.stop();
    this.tyres?.stop();
    this.jetSound?.stop();
    this.ctx.audio.stopBossMusic(1);
    this.ui.remove();
    this.ctx.engine.renderer.toneMappingExposure = 1;
  }

  /** The airfield in the gate frame (see StreetBuilder.buildAirport): a past the airport road's end, b to its right. */
  private apt(a: number, b: number, out = new THREE.Vector3()): THREE.Vector3 {
    const ap = this.level.roads.airport;
    const end = ap.samples[ap.samples.length - 1];
    const l = Math.hypot(end.tangent.x, end.tangent.z) || 1;
    const fx = end.tangent.x / l;
    const fz = end.tangent.z / l;
    return out.set(end.pos.x + fx * a - fz * b, 0, end.pos.z + fz * a + fx * b);
  }

  /**
   * The one road Ravi drives: from where the Civic stands, through the
   * airside gate, down the last of the taxiway, round onto the runway and
   * along it to the end. Narrow as the taxiway between the gate posts; on
   * the runway, from the airside fence on the left to the grass well out on
   * the right. The RoadNet wants all five roads: the other four are stubs a
   * long way under the ground, never used.
   */
  private buildRoads(): Record<RoadId, Road> {
    const pts: [number, number][] = [
      [352, 60], [372, 60], [390, 60], [404, 60], [413, 58], [420.5, 53.5], [426.5, 46], [429.7, 37], [430.5, 27], [430.5, 15]
    ];
    // Down the runway in even steps: a Catmull-Rom loops if one span is far longer than its neighbours
    for (let b = 0; b >= RUNWAY_END; b -= 15) pts.push([430.5, b]);
    // A Catmull-Rom through the points, finely, then evenly resampled every 2 m
    const ctrl = pts.map(([a, b]) => this.apt(a, b));
    const fine: THREE.Vector3[] = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)];
      const p1 = ctrl[i];
      const p2 = ctrl[i + 1];
      const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      const n = Math.max(2, Math.ceil(p1.distanceTo(p2) / 0.5));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const t2 = t * t;
        const t3 = t2 * t;
        const c = (a: number, b: number, cc: number, d: number): number =>
          0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
        fine.push(new THREE.Vector3(c(p0.x, p1.x, p2.x, p3.x), 0, c(p0.z, p1.z, p2.z, p3.z)));
      }
    }
    fine.push(ctrl[ctrl.length - 1].clone());
    const cum = [0];
    for (let i = 1; i < fine.length; i++) cum.push(cum[i - 1] + fine[i].distanceTo(fine[i - 1]));
    const total = cum[cum.length - 1];
    const n = Math.round(total / 2);
    const ds = total / n;
    // Where the turn onto the runway starts and ends, as route s
    const sTurn0 = this.routeSOf(fine, cum, this.apt(404, 60));
    const sTurn1 = this.routeSOf(fine, cum, this.apt(430.5, 27));
    const samples: RoadSample[] = [];
    let j = 0;
    for (let i = 0; i <= n; i++) {
      const s = i * ds;
      while (j < fine.length - 2 && cum[j + 1] < s) j++;
      const u = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      const pos = new THREE.Vector3().lerpVectors(fine[j], fine[j + 1], Math.min(1, Math.max(0, u)));
      const tangent = new THREE.Vector3().subVectors(fine[j + 1], fine[j]).normalize();
      const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const k = smooth((s - sTurn0) / Math.max(1, sTurn1 - sTurn0));
      // The taxiway between the posts (b 45..75), then the runway: fence on the left, the grass on the right
      const halfLeft = THREE.MathUtils.lerp(15.4, 24, k);
      const halfRight = THREE.MathUtils.lerp(15.4, 38, k);
      samples.push({ s, pos, tangent, right, halfLeft, halfRight });
    }
    const city: Road = { id: 'city', samples, length: n * ds, lanes: [], next: null, limitMph: 0 };
    const stub = (id: RoadId, x: number): Road => {
      const p0 = new THREE.Vector3(x, -400, 0);
      const p1 = new THREE.Vector3(x, -400, -4);
      const t = new THREE.Vector3(0, 0, -1);
      const r = new THREE.Vector3(1, 0, 0);
      return {
        id,
        samples: [
          { s: 0, pos: p0, tangent: t, right: r, halfLeft: 2, halfRight: 2 },
          { s: 4, pos: p1, tangent: t, right: r, halfLeft: 2, halfRight: 2 }
        ],
        length: 4,
        lanes: [],
        next: null,
        limitMph: 0
      };
    };
    return { city, onramp: stub('onramp', 9000), highway: stub('highway', 9100), exit: stub('exit', 9200), airport: stub('airport', 9300) };
  }

  private routeSOf(fine: THREE.Vector3[], cum: number[], p: THREE.Vector3): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < fine.length; i++) {
      const d = fine[i].distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = cum[i];
      }
    }
    return best;
  }

  /** Everyone where Level 10 left them. */
  private placeEveryone(): void {
    // The jet, on the runway lined up toward −b, door shut
    const ap = this.level.roads.airport;
    const end = ap.samples[ap.samples.length - 1];
    const l = Math.hypot(end.tangent.x, end.tangent.z) || 1;
    const fx = end.tangent.x / l;
    const fz = end.tangent.z / l;
    this.jetYaw = Math.atan2(-fz, fx);
    this.jetStart.copy(this.apt(...JET_AT));
    const g = this.jet.group;
    g.position.copy(this.jetStart);
    g.rotation.order = 'YXZ';
    g.rotation.set(0, this.jetYaw, 0);
    g.updateMatrixWorld(true);
    this.jet.setDoor(0);
    this.jet.setEngines(1);
    this.jetV = 4;
    const at = { road: 'city' as RoadId, s: 0, d: 0 };
    this.net.locateGlobal(this.jetStart, at);
    this.jetRoute0 = this.net.routeS(at);

    // His car beside where the jet stood, past the left wingtip; a blocker
    const stop = this.jetLocal(-11, 0, -6.5);
    this.bossRig.group.position.copy(stop);
    this.bossRig.group.rotation.y = this.jetYaw;
    const carBlock: StreetBlocker = { centre: stop.clone(), halfX: 1.0, halfZ: 2.6, yaw: this.jetYaw, minY: 0, maxY: 1.5 };
    this.player.blockers.push(carBlock);
    // His two men, at the back of the car, rifles on the Civic
    for (let i = 0; i < 2; i++) {
      const e = new Enemy(this.carLocal(i === 0 ? -1.5 : 1.1, i === 0 ? 3.3 : 3.6), this.jetYaw, 11 + i, { name: 'POLICE FORCE AGENT' });
      armWithAK(e);
      e.setAiming(true);
      this.scene.add(e.root);
      this.guards.push(e);
      this.fireCd.push(0.3 + i * 0.5);
      this.burstLeft.push(0);
    }
    // Airport security, across the gate in front of the Civic
    for (let i = 0; i < 4; i++) {
      const e = new Enemy(this.apt(394.5 + (i % 2) * 0.8, 49 + i * 6.2), 0, 20 + i, { name: 'AIRPORT SECURITY', security: true });
      e.faceToward(this.apt(...CIVIC_AT), 1, 100);
      armWithAK(e);
      e.setAiming(true);
      this.scene.add(e.root);
      this.officers.push(e);
      this.fireCd.push(1 + Math.random());
      this.burstLeft.push(0);
    }

    // The Civic, stopped at the gate, square on to it
    const civicAt = this.apt(...CIVIC_AT);
    this.player.setPose(civicAt, faceFrom(civicAt, this.apt(CIVIC_AT[0] + 20, CIVIC_AT[1])), 0);
  }

  /** A point in the jet's frame at the START of its run (nose −Z, its left −X), in the world. */
  private jetLocal(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = Math.cos(this.jetYaw);
    const sn = Math.sin(this.jetYaw);
    return out.set(this.jetStart.x + c * x + sn * z, y, this.jetStart.z - sn * x + c * z);
  }

  /** A point beside the boss's car (its left −X, nose −Z), on the ground. */
  private carLocal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const g = this.bossRig.group;
    const c = Math.cos(g.rotation.y);
    const sn = Math.sin(g.rotation.y);
    return out.set(g.position.x + c * x + sn * z, 0, g.position.z - sn * x + c * z);
  }

  /** Ravi at the wheel, as Level 10 sat him; posed by RaviStunt from here on. */
  private buildDriver(): void {
    const rig = this.civicRig;
    RaviVisual.whenReady(() => {
      const r = RaviVisual.rig('body');
      // RaviStunt's 'seated' root: the seat's hip point, under the body (which pivots at axle height)
      r.root.rotation.y = Math.PI;
      r.root.position.set(rig.seat.hip.x, rig.seat.hip.y - rig.body.position.y, rig.seat.hip.z);
      rig.body.add(r.root);
      this.driver = r;
      this.stunt = new RaviStunt(r);
      this.stunt.set('seated', 0);
      this.wheelGrip = new WheelGrip(r, { ...wheelInModel(rig.seat, rig.seat.hip.y), radius: WHEEL_RIM });
    });
  }

  /** The Civic's wheel turned as he steers, and his hands round it while he's sat at it. */
  private steerWheel(): void {
    const a = -this.player.steerNow * WHEEL_TURN;
    if (this.civicRig.steeringWheel) this.civicRig.steeringWheel.rotation.z = a;
    if (this.pose === 'seated') this.wheelGrip?.update(a);
  }

  /** From the driver's seat the Civic must be a closed box: panels double-sided, glass clearer. */
  private cockpitGlass(): void {
    const done = new Map<THREE.Material, THREE.Material>();
    for (const m of this.civicRig.meshes) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const out = mats.map((mat) => {
        let c = done.get(mat);
        if (!c) {
          c = mat.clone();
          c.side = THREE.DoubleSide;
          if (c.transparent) c.opacity = Math.min(c.opacity, 0.16);
          done.set(mat, c);
        }
        return c;
      });
      m.material = Array.isArray(m.material) ? out : out[0];
    }
  }

  // ------------------------------------------------------------------- UI

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <style>
        .ap-hud { position:absolute; inset:0; pointer-events:none; font-family:'Courier New',monospace; color:#e8f4ec;
          text-shadow:0 1px 3px rgba(0,0,0,0.9); transition:opacity 0.4s; }
        .ap-hud.off { opacity:0; }
        .ap-speed { position:absolute; right:34px; bottom:30px; text-align:right; }
        .ap-speed b { font-size:54px; letter-spacing:2px; }
        .ap-speed span { font-size:13px; letter-spacing:4px; margin-left:8px; color:#c9d6cf; }
        .ap-dmg { position:absolute; right:34px; bottom:104px; display:flex; align-items:center; gap:10px; font-size:11px; letter-spacing:3px; }
        .ap-dmg i { display:block; width:150px; height:7px; border:1px solid rgba(232,244,236,0.6); }
        .ap-dmg i b { display:block; height:100%; width:100%; background:#52e07a; transition:width 0.25s, background 0.25s; }
        .ap-jet { position:absolute; left:50%; top:24px; transform:translateX(-50%); font-size:14px; letter-spacing:4px; }
        .ap-runway { position:absolute; left:50%; top:50px; transform:translateX(-50%); display:flex; align-items:center; gap:10px; font-size:11px; letter-spacing:3px; }
        .ap-runway i { display:block; width:220px; height:6px; border:1px solid rgba(232,244,236,0.6); }
        .ap-runway i b { display:block; height:100%; width:100%; background:#e0c452; }
        .ap-runway.low i b { background:#ff5a46; }
        .ap-fail { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px;
          background:rgba(0,0,0,0.55); opacity:0; transition:opacity 0.6s; font-family:'Courier New',monospace; }
        .ap-fail.show { opacity:1; pointer-events:all; }
        .ap-fail .t { font-size:40px; letter-spacing:10px; color:#ff6a50; font-weight:bold; }
        .ap-fail .s { font-size:13px; letter-spacing:4px; color:#c9d6cf; }
      </style>
      <canvas class="ap-cracks" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0"></canvas>
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="ap-hud off">
        <div class="ap-jet">JET <b>—</b></div>
        <div class="ap-runway">RUNWAY <i><b></b></i></div>
        <div class="ap-dmg">CAR <i><b></b></i></div>
        <div class="ap-speed"><b>0</b><span>MPH</span></div>
      </div>
      <div class="intro-fade" style="opacity:1;transition:opacity 0.8s"></div>
      <div class="ap-fail"><div class="t"></div><div class="s">[ R ] TRY AGAIN &nbsp;&nbsp; [ ESC ] MENU</div></div>
      <div class="ap-end" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        color:#e8f4ec;font-size:22px;letter-spacing:9px;opacity:0;pointer-events:none;transition:opacity 1.2s">TO BE CONTINUED</div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
    this.hud = el.querySelector('.ap-hud')!;
    this.speedEl = el.querySelector('.ap-speed b')!;
    this.dmgEl = el.querySelector('.ap-dmg i b')!;
    this.jetEl = el.querySelector('.ap-jet b')!;
    this.runwayEl = el.querySelector('.ap-runway')!;
    this.failEl = el.querySelector('.ap-fail')!;
    this.endCard = el.querySelector('.ap-end')!;
    this.crackCanvas = el.querySelector('.ap-cracks');
    this.sizeCracks();
  }

  private sizeCracks(): void {
    const c = this.crackCanvas;
    if (!c) return;
    c.width = Math.round(window.innerWidth * Math.min(2, window.devicePixelRatio || 1));
    c.height = Math.round(window.innerHeight * Math.min(2, window.devicePixelRatio || 1));
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
      else if (e.code === 'KeyR' || e.code === 'Space' || e.code === 'Enter') this.ctx.bus.emit(Events.RestartAirport);
    }
  }

  private onClick(): void {
    if (this.phase === 'failed' && this.failT > 1) this.ctx.bus.emit(Events.RestartAirport);
  }

  private readInput(): DriveInput {
    const i = this.ctx.input;
    const down = (...k: string[]): boolean => k.some((c) => i.isDown(c));
    return {
      throttle: (down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0),
      steer: (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0),
      handbrake: down('Space')
    };
  }

  /** The Civic holding station off the jet's left wingtip, driverless or in the cutscene. */
  private holdStation(): DriveInput {
    const p = this.player;
    const want = this.jetWorld(STATION.x, 0, STATION.z, _t1);
    const ahead = _t2.copy(want).addScaledVector(this.jetForward(_t3), 14);
    const yawWant = Math.atan2(-(ahead.x - p.position.x), -(ahead.z - p.position.z));
    const err = wrapAngle(yawWant - p.yaw);
    // Fore-aft: match the jet, and close on the station
    const along = (want.x - p.position.x) * -Math.sin(p.yaw) + (want.z - p.position.z) * -Math.cos(p.yaw);
    const vWant = this.jetV + along * 0.8;
    return { steer: THREE.MathUtils.clamp(-err * 3, -1, 1), throttle: p.speed < vWant - 0.5 ? 1 : p.speed > vWant + 1.5 ? -0.5 : 0.2, handbrake: false };
  }

  // ----------------------------------------------------------------- update

  update(dtReal: number, _time: number): void {
    const dtR = Math.min(dtReal, 0.05);
    const dt = dtR * this.timeScale;
    this.phaseT += dtR;
    this.crashCd -= dtR;
    this.scrapeCd -= dtR;

    let input: DriveInput | null = null;
    if (this.phase === 'drive') input = this.readInput();
    else if (this.phase === 'leap') input = this.leapT < this.leapDone ? this.holdStation() : { throttle: -0.3, steer: 0.25, handbrake: false };
    else if (this.phase === 'failed') input = { throttle: this.failWhy === 'WRECKED' ? -1 : 0, steer: 0, handbrake: false };
    else input = { throttle: 0, steer: 0, handbrake: false };

    this.updateJet(dt);
    this.player.update(dt, input);
    this.player.applyTo(this.civicRig, dt);
    this.steerWheel();
    this.collideJet();
    this.updatePeople(dt);
    this.world.step(1 / 60, dt, 3);

    if (this.phase === 'intro') this.updateIntro();
    else if (this.phase === 'drive') this.updateDrive(dtR);
    else if (this.phase === 'leap') this.updateLeap(dtR, dt);
    else if (this.phase === 'failed') this.failT += dtR;

    this.civicRig.brakelights.emissiveIntensity = this.player.braking ? 2.4 : 0.25;
    this.sound();
    this.updateCamera(dtR);
    this.updateHud();
    this.particles.update(dt);
    this.ctx.input.endFrame();
  }

  // ------------------------------------------------------------- the jet

  private jetForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.jetYaw), 0, -Math.cos(this.jetYaw));
  }

  /** A point in the jet's own (moving) frame, in the world. */
  private jetWorld(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    this.jet.group.updateMatrixWorld(true);
    return out.set(x, y, z).applyMatrix4(this.jet.group.matrixWorld);
  }

  /** The gate-frame b the jet's middle is at. */
  private jetB(): number {
    return JET_AT[1] - this.jetS;
  }

  /**
   * Down the runway, accelerating hard to its top speed — but once Ravi's
   * on its tail flat out it's held a little slower than him, so a clean
   * run catches it and a sloppy one doesn't. Past LIFT_B it rotates and goes.
   */
  private updateJet(dt: number): void {
    const p = this.player;
    if (this.phase === 'intro') {
      this.jetV = Math.min(6, this.jetV + 1.2 * dt);
    } else if (this.phase === 'drive') {
      const gap = this.jetRoute0 + this.jetS - this.net.routeS(p.at);
      let top = JET_TOP;
      // On his tail and flat out: catchable
      if (gap < 120 && p.speed > 24) top = Math.min(top, Math.max(24, p.speed - 7));
      this.jetV = this.jetV < top ? Math.min(top, this.jetV + JET_ACCEL * dt) : Math.max(top, this.jetV - 4 * dt);
    }
    // In the leap it holds its speed until he's down on the wing, then (unseen, from on board) eases off a little
    else if (this.phase === 'leap' && this.leapT > this.beats.land) this.jetV = Math.max(30, this.jetV - 2.5 * dt);
    this.jetS += this.jetV * dt;
    if (this.lifting < 0 && this.jetB() < LIFT_B && this.phase !== 'leap') this.lifting = this.phaseT;
    if (this.lifting >= 0) {
      this.jetV += 5 * dt;
      this.jetPitch += (0.17 - this.jetPitch) * Math.min(1, dt * 1.4);
      this.jetUp += (this.jetV - 45) * 0.3 * dt + this.jetPitch * this.jetV * 0.25 * dt;
    }
    const g = this.jet.group;
    const H = this.jetForward(AirportScene.tmpA);
    g.position.copy(this.jetStart).addScaledVector(H, this.jetS);
    g.position.y = Math.max(0, this.jetUp) + Math.sin(this.jetPitch) * 3;
    g.rotation.x = this.jetPitch;
    this.jet.setEngines(1);
    this.jetSound?.setThrust(1);
    this.jetSound?.setDistance(this.camera.position.distanceTo(g.position));
  }

  /**
   * Don't drive into a jet: its fuselage, wings, tailplane and engines push
   * the Civic out sideways (and hurt it); behind the engines, the blast
   * shoves it and shakes everything.
   */
  private collideJet(): void {
    if (this.jetUp > 2 || this.phase === 'leap') return;
    const p = this.player;
    const g = this.jet.group;
    g.updateMatrixWorld(true);
    const local = AirportScene.tmpB.copy(p.position).applyMatrix4(AirportScene.tmpM.copy(g.matrixWorld).invert());
    const x = local.x;
    const z = local.z;
    let push = 0;
    if (Math.abs(x) < 1.5 + p.halfWidth && z > -10.5 && z < 9.5) push = Math.sign(x || -1) * (1.5 + p.halfWidth - Math.abs(x));
    else if (Math.abs(x) < 9.5 + p.halfWidth && z > -1.2 - p.halfLength && z < 4 + p.halfLength && Math.abs(x) > 1.5) push = Math.sign(x) * (9.5 + p.halfWidth - Math.abs(x));
    if (push !== 0) {
      const right = AirportScene.tmpC.set(Math.cos(this.jetYaw), 0, -Math.sin(this.jetYaw));
      p.position.addScaledVector(right, push);
      p.velocity.addScaledVector(right, Math.sign(push) * 4);
      this.onImpact(8, p.position, 'wall');
    }
    // The blast
    if (z > 10 && z < 70 && Math.abs(x) < 5) {
      const k = (1 - (z - 10) / 60) * (1 - Math.abs(x) / 5);
      const right = AirportScene.tmpC.set(Math.cos(this.jetYaw), 0, -Math.sin(this.jetYaw));
      p.velocity.addScaledVector(right, Math.sign(x || 1) * k * 9 * 0.016);
      this.shake = Math.min(0.8, this.shake + k * 0.05);
    }
  }
  private static tmpM = new THREE.Matrix4();

  // ------------------------------------------------------------ the intro

  /**
   * Where the street left him: across the runway from beside the jet as it
   * starts to roll, his men at the car turning their rifles on the gate —
   * and back behind the wheel. Foot down.
   */
  private startIntro(): void {
    this.phase = 'intro';
    this.phaseT = 0;
    this.shot = 'wide';
    this.cinematic(true);
    this.fadeEl.style.opacity = '0';
  }

  private updateIntro(): void {
    const t = this.phaseT;
    this.shot = t < 2.8 ? 'wide' : 'pov';
    if (t > 4.6) {
      this.phase = 'drive';
      this.phaseT = 0;
      this.shot = 'cockpit';
      this.cinematic(false);
      this.setObjective('STOP THAT JET — GET ALONGSIDE ITS WING');
      this.ctx.audio.startBossMusic();
    }
  }

  // ---------------------------------------------------------------- driving

  private updateDrive(dt: number): void {
    const p = this.player;
    const gate = this.airside.gate.pos;
    // Through the gate
    if (!this.gateHit && p.position.distanceTo(gate) < 3.5 + Math.abs(this.airside.gate.pos.x - p.position.x) * 0) {
      const g = this.airside.gate;
      const toCar = AirportScene.tmpA.copy(p.position).sub(g.pos);
      const fwd = AirportScene.tmpB.set(-Math.sin(g.yaw), 0, -Math.cos(g.yaw));
      if (toCar.dot(fwd) > -1.5) this.smashGate();
    } else if (!this.gateHit) {
      const g = this.airside.gate;
      const toCar = AirportScene.tmpA.copy(p.position).sub(g.pos);
      const fwd = AirportScene.tmpB.set(-Math.sin(g.yaw), 0, -Math.cos(g.yaw));
      if (toCar.dot(fwd) > -1.2 && Math.abs(toCar.dot(AirportScene.tmpC.set(-fwd.z, 0, fwd.x))) < 16) this.smashGate();
    }
    // Alongside the wing: the leap
    const g = this.jet.group;
    g.updateMatrixWorld(true);
    const local = AirportScene.tmpB.copy(p.position).applyMatrix4(AirportScene.tmpM.copy(g.matrixWorld).invert());
    if (this.lifting < 0 && local.x < -9.9 && local.x > -17 && local.z > -3 && local.z < 7 && Math.abs(p.speed - this.jetV) < 10) {
      this.startLeap();
      return;
    }
    // Gone
    if (this.lifting >= 0 && this.phaseT - this.lifting > 2.2) {
      this.fail('HE GOT AWAY');
      return;
    }
    if (this.damage >= 100) this.fail('WRECKED');
  }

  private smashGate(): void {
    this.gateHit = true;
    const { audio } = this.ctx;
    audio.carCrash(0, true);
    this.particles.sparks(this.airside.gate.pos.clone().setY(1), AirportScene.tmpA.set(0, 1, 0), 30);
    this.player.speed *= 0.88;
    this.damage = Math.min(100, this.damage + 3);
    this.shake = Math.min(1, this.shake + 0.6);
  }

  private onImpact(speed: number, point: THREE.Vector3, other: 'wall' | 'traffic' | 'boss' | 'cop' | 'player'): void {
    const { audio } = this.ctx;
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
      this.particles.sparks(point, AirportScene.tmpA.set(0, 0.6, 0), Math.min(20, 6 + speed));
    }
    if (this.phase !== 'drive') dmg = 0;
    this.damage = Math.min(100, this.damage + Math.min(30, dmg));
    this.shake = Math.min(1.2, this.shake + speed * 0.04);
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

  // ------------------------------------------------------------- the people

  /**
   * The boss's men fire from his car at the Civic for as long as it's in
   * range; airport security fire from the gate until it's on them, then
   * dive for it — or don't, and go under it.
   */
  private updatePeople(dt: number): void {
    const p = this.player;
    const shooting = this.phase === 'intro' || this.phase === 'drive';
    const all = [...this.guards, ...this.officers];
    all.forEach((e, i) => {
      e.update(dt);
      if (!e.alive) return;
      // Diving out of the way
      // Diving out of the way (the ones who stood their ground have a time but nowhere to go)
      const dive = this.diveT.get(e);
      const from = this.diveFrom.get(e);
      const to = this.diveTo.get(e);
      if (dive !== undefined && from && to) {
        const k = clamp01((this.phaseT - dive) / 0.45);
        e.position.lerpVectors(from, to, smooth(k));
      }
      // Hit by the Civic
      const rel = AirportScene.tmpA.copy(e.position).sub(p.position).setY(0);
      if (rel.length() < 1.9 && Math.abs(p.speed) > 4) {
        const dir = AirportScene.tmpB.copy(p.velocity).setY(2.5).normalize();
        e.die(e.position.clone().setY(1.0), dir, this.world, 'torso', 1.5 + Math.abs(p.speed) * 0.12, { wound: false });
        this.ctx.audio.carCrash(0, false);
        this.shake = Math.min(1, this.shake + 0.4);
        if (this.phase === 'drive') this.damage = Math.min(100, this.damage + 2);
        return;
      }
      // Seeing it coming: some of them get out of the way
      if (dive === undefined && rel.length() < 14 && p.speed > 10 && rel.dot(AirportScene.tmpB.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw))) > 0) {
        if (Math.random() < 0.5) {
          const side = AirportScene.tmpC.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
          const s = rel.dot(side) >= 0 ? 1 : -1;
          this.diveFrom.set(e, e.position.clone());
          this.diveTo.set(e, e.position.clone().addScaledVector(side, s * 3.4));
        }
        this.diveT.set(e, this.phaseT);
        e.setAiming(false);
        return;
      }
      // Shooting
      if (!shooting || dive !== undefined) return;
      const range = this.guards.includes(e) ? 160 : 60;
      const d = e.position.distanceTo(p.position);
      if (d > range || (this.guards.includes(e) && rel.dot(AirportScene.tmpB.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw))) < -5)) return;
      e.faceToward(p.position, dt, 6);
      this.fireCd[i] -= dt;
      if (this.fireCd[i] > 0) return;
      if (this.burstLeft[i] <= 0) this.burstLeft[i] = this.guards.includes(e) ? 3 + Math.floor(Math.random() * 4) : 2;
      this.burstLeft[i]--;
      this.fireCd[i] = this.burstLeft[i] > 0 ? (this.guards.includes(e) ? 0.11 : 0.3) : 0.6 + Math.random() * 0.9;
      this.shoot(e, d);
    });
  }

  private shoot(e: Enemy, dist: number): void {
    const { audio } = this.ctx;
    const muzzle = e.muzzleWorld(new THREE.Vector3());
    e.flashMuzzle();
    audio.enemyGunshot(this.camera.position.distanceTo(muzzle));
    this.particles.muzzleFlash(muzzle, AirportScene.tmpA.copy(this.camera.position).sub(muzzle).normalize());
    const hitChance = THREE.MathUtils.clamp(0.75 - dist * 0.004 - Math.abs(this.player.speed) * 0.006, 0.12, 0.7);
    if (Math.random() > hitChance) {
      // Wide: a tracer past him
      const miss = AirportScene.tmpC.copy(this.player.position).add(AirportScene.tmpB.set((Math.random() - 0.5) * 8, 1 + Math.random() * 2, (Math.random() - 0.5) * 8));
      this.particles.tracer(muzzle, miss, 0xffe0b0);
      return;
    }
    if (this.phase === 'drive') this.damage = Math.min(100, this.damage + (this.guards.includes(e) ? 0.6 : 0.4));
    const inCar = this.shot === 'cockpit' || this.shot === 'pov';
    if (!inCar) {
      this.particles.tracer(muzzle, AirportScene.tmpC.copy(this.player.position).setY(1), 0xffe0b0);
      return;
    }
    const glass = this.cracks < 7 && (this.cracks === 0 || Math.random() < 0.14);
    const sx = glass ? 0.32 + Math.random() * 0.5 : 0.22 + Math.random() * 0.56;
    const sy = glass ? 0.3 + Math.random() * 0.24 : 0.72 + Math.random() * 0.16;
    const ndc = AirportScene.tmpB.set(sx * 2 - 1, -(sy * 2 - 1), 0.5).unproject(this.camera);
    const ray = ndc.sub(this.camera.position).normalize();
    const hit = AirportScene.tmpC.copy(this.camera.position).addScaledVector(ray, glass ? 0.9 : 1.7);
    this.particles.tracer(muzzle, hit, 0xffe0b0);
    if (glass) {
      this.cracks++;
      this.crack(sx, sy);
      audio.ricochet(1);
    } else {
      this.particles.sparks(hit, AirportScene.tmpA.set(0, 0.5, 0), 5);
      audio.ricochet(2);
    }
    this.shake = Math.min(1, this.shake + 0.1);
  }

  /** A bullet through the windscreen: the hole, the cracks running out from it. */
  private crack(sx: number, sy: number): void {
    const c = this.crackCanvas;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const x = sx * c.width;
    const y = sy * c.height;
    const r = c.height * (0.035 + Math.random() * 0.035);
    g.strokeStyle = 'rgba(235,240,245,0.75)';
    g.lineWidth = Math.max(1, c.height / 700);
    const n = 7 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      let a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      let px = x;
      let py = y;
      g.beginPath();
      g.moveTo(px, py);
      const len = r * (0.6 + Math.random() * 0.9);
      for (let d = 0; d < len; d += r * 0.18) {
        a += (Math.random() - 0.5) * 0.5;
        px += Math.cos(a) * r * 0.18;
        py += Math.sin(a) * r * 0.18;
        g.lineTo(px, py);
      }
      g.stroke();
    }
    for (const k of [0.3, 0.55]) {
      g.beginPath();
      g.arc(x, y, r * k * (0.8 + Math.random() * 0.4), Math.random() * 6, Math.random() * 6 + 3.5);
      g.stroke();
    }
    g.fillStyle = 'rgba(20,22,24,0.85)';
    g.beginPath();
    g.arc(x, y, Math.max(2, c.height / 260), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(240,244,248,0.35)';
    g.beginPath();
    g.arc(x, y, Math.max(4, c.height / 140), 0, Math.PI * 2);
    g.fill();
  }

  // -------------------------------------------------------------- the leap

  /** The cutscene's moves, ends in its own slowed seconds (crawl's length is set when it starts). */
  private beats = { emerge: 1.0, crouch: 1.45, leap: 2.3, land: 2.75, crawl: 6, dive: 7 };
  private crawlN = 8;
  private crawlLen = 1;
  private readonly crawlPts: THREE.Vector3[] = [];
  private readonly diveRoot = new THREE.Vector3();
  private readonly diveQ = new THREE.Quaternion();
  private readonly landRoot = new THREE.Vector3();
  private get leapDone(): number {
    return this.beats.leap;
  }

  /**
   * Alongside the wing flat out: everything slows right down. The sunroof
   * slides back and he comes up out of it; crouched on the roof; the leap
   * across to the wing; down on it; a crawl inboard into the wind and up the
   * fuselage's flank to the open vent; and in head first.
   */
  private startLeap(): void {
    this.phase = 'leap';
    this.phaseT = 0;
    this.leapT = 0;
    this.cinematic(true);
    this.setObjective('');
    this.shot = 'emerge';
    this.timeScale = 0.5;
    this.ctx.audio.stopBossMusic(3);
    // The route over the jet: the landing spot, inboard along the vent's wing path, up the flank to the rim
    const vent = this.jet.vent;
    this.wingPath = vent ? vent.wingPath.map((v) => v.clone()) : [];
    this.ventMouth.copy(vent ? vent.mouth : new THREE.Vector3(-0.615, 2.5, 3.125));
    // The fuselage there: a circle round its axis, radius and centre from the vent's place on it (49° up)
    const R = Math.abs(this.ventMouth.x) / Math.cos((49 * Math.PI) / 180);
    const yc = this.ventMouth.y - R * Math.sin((49 * Math.PI) / 180);
    this.fuse = { R, yc };
    // The dive root: the vent's lower rim (32° up), its up the skin's normal, its +Z up round the fuselage
    const e = (32 * Math.PI) / 180;
    this.diveRoot.set(-R * Math.cos(e), yc + R * Math.sin(e), this.ventMouth.z);
    const n = new THREE.Vector3(-Math.cos(e), Math.sin(e), 0);
    const t = new THREE.Vector3(Math.sin(e), Math.cos(e), 0);
    this.diveQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(n, t), n, t));
    // Landing, and the crawl: from 0.45 on from the landing root (where land ends) through the
    // wing path to 0.955 short of the rim, along the last stretch
    this.landRoot.copy(LANDING);
    this.crawlPts.length = 0;
    this.crawlPts.push(LANDING.clone().add(new THREE.Vector3(0.45, -0.03, 0)));
    for (const p of this.wingPath.slice(0, -1)) if (p.x > this.crawlPts[0].x + 0.2) this.crawlPts.push(p.clone());
    const last = this.crawlPts[this.crawlPts.length - 1];
    const toRim = new THREE.Vector3().subVectors(this.diveRoot, last);
    const back = Math.min(0.955, toRim.length() * 0.9);
    this.crawlPts.push(this.diveRoot.clone().addScaledVector(toRim.normalize(), -back));
    this.crawlLen = this.pathLen(this.crawlPts);
    this.crawlN = Math.max(3, Math.round(this.crawlLen / 0.6));
    this.beats.crawl = this.beats.land + this.crawlN * 0.26;
    this.beats.dive = this.beats.crawl + 1.1;
  }

  private fuse = { R: 0.94, yc: 1.79 };

  /**
   * His root's orientation on the jet at a point, facing along `dir`: up the
   * wing's normal out on the wing, the fuselage's radial normal on its flank.
   */
  private surfaceQuat(p: THREE.Vector3, dir: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
    const onFlank = clamp01((-p.x - 1.25) / -0.4 + 1); // 0 out on the wing (x < −1.25), 1 up the side
    const radial = AirportScene.tmpC.set(p.x, p.y - this.fuse.yc, 0).normalize();
    const n = AirportScene.tmpA.set(0, 1, 0).lerp(radial, onFlank).normalize();
    const f = AirportScene.tmpB.copy(dir).addScaledVector(n, -dir.dot(n)).normalize();
    const x = new THREE.Vector3().crossVectors(n, f);
    return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, n, f));
  }

  private updateLeap(dtR: number, dt: number): void {
    const B = this.beats;
    this.leapT += dt;
    const t = this.leapT;
    const st = this.stunt;
    const r = this.driver;
    // How slow: right down for the jump, back up some for the crawl
    const slow = t < B.emerge ? 0.5 : t < B.leap ? 0.24 : t < B.land ? 0.45 : t < B.crawl ? 1 : 0.7;
    this.timeScale += (slow - this.timeScale) * Math.min(1, dtR * 3);
    this.civicRig.sunroof?.setOpen(smooth(t / 0.4));
    if (!st || !r) return;
    const civ = this.civicRig;
    if (t < B.emerge) {
      this.shot = 'emerge';
      this.setPose('emerge', smooth(t / B.emerge));
    } else if (t < B.crouch) {
      // A cut, and he's out on the roof behind the sunroof, turned to the jet (the car's right)
      this.shot = 'leapSide';
      if (this.pose !== 'crouch') {
        const seatPos = new THREE.Vector3(civ.seat.hip.x, civ.seat.hip.y - civ.body.position.y, civ.seat.hip.z);
        RaviStunt.onRoof(seatPos, Math.PI, r.root.position);
        r.root.rotation.set(0, Math.PI / 2, 0);
      }
      this.setPose('crouch', smooth((t - B.emerge) / (B.crouch - B.emerge)));
    } else if (t < B.leap) {
      this.shot = 'leapSide';
      if (this.pose !== 'leap') {
        // Into the jet's frame for the flight: from his hips over the roof to over the landing spot
        st.pelvis('crouch', 1, AirportScene.tmpA);
        r.root.localToWorld(AirportScene.tmpA);
        this.jet.group.updateMatrixWorld(true);
        this.jet.group.attach(r.root);
        this.leapFrom.copy(AirportScene.tmpA).applyMatrix4(AirportScene.tmpM.copy(this.jet.group.matrixWorld).invert());
        this.leapTo.copy(this.landRoot).add(new THREE.Vector3(0, 0.784, 0));
        this.ctx.audio.kickWhoosh();
      }
      const k = (t - B.crouch) / (B.leap - B.crouch);
      const pos = AirportScene.tmpA.lerpVectors(this.leapFrom, this.leapTo, k);
      pos.y += Math.sin(Math.PI * k) * 0.95;
      r.root.position.copy(pos);
      this.surfaceQuat(this.landRoot, AirportScene.tmpB.set(1, 0, 0), r.root.quaternion);
      this.setPose('leap', k);
    } else if (t < B.land) {
      this.shot = 'wing';
      if (this.pose !== 'land') {
        r.root.position.copy(this.landRoot);
        this.surfaceQuat(this.landRoot, AirportScene.tmpB.set(1, 0, 0), r.root.quaternion);
        this.ctx.audio.bodyThud(3);
        this.shake = 0.5;
      }
      this.setPose('land', smooth((t - B.leap) / (B.land - B.leap)));
    } else if (t < B.crawl) {
      this.shot = 'wing';
      const k = (t - B.land) / (B.crawl - B.land);
      const dir = AirportScene.tmpB;
      const at = this.pathPoint(this.crawlPts, k, new THREE.Vector3(), dir);
      r.root.position.copy(at);
      this.surfaceQuat(at, dir.clone(), r.root.quaternion);
      this.setPose('crawl', k * this.crawlN);
      this.jet.vent?.setOpen(smooth((k - 0.55) / 0.35));
    } else if (t < B.dive) {
      this.shot = 'vent';
      this.jet.vent?.setOpen(1);
      if (this.pose !== 'dive') {
        r.root.position.copy(this.diveRoot);
        r.root.quaternion.copy(this.diveQ);
      }
      const k = smooth((t - B.crawl) / (B.dive - B.crawl));
      this.setPose('dive', k);
      if (k > 0.93) r.root.visible = false;
    } else if (!this.completed) {
      // In. The hatch drops shut behind him; to black
      r.root.visible = false;
      const e = t - B.dive;
      this.jet.vent?.setOpen(1 - smooth(e / 0.35));
      this.timeScale = 1;
      if (this.phase === 'leap' && e > 0.6) {
        this.fadeEl.style.opacity = '1';
        this.phase = 'done';
        setTimeout(() => (this.endCard.style.opacity = '1'), 1300);
        setTimeout(() => {
          this.completed = true;
          this.ctx.bus.emit(Events.AirportComplete);
        }, 5500);
      }
    }
  }

  private setPose(p: StuntPose, k: number): void {
    this.pose = p;
    this.stunt?.set(p, k);
  }

  private pathLen(pts: THREE.Vector3[]): number {
    let n = 0;
    for (let i = 1; i < pts.length; i++) n += pts[i].distanceTo(pts[i - 1]);
    return n;
  }

  /** The point `k` (0..1) of the way along a polyline, and which way it runs there. */
  private pathPoint(pts: THREE.Vector3[], k: number, out: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 {
    let left = clamp01(k) * this.pathLen(pts);
    for (let i = 1; i < pts.length; i++) {
      const L = pts[i].distanceTo(pts[i - 1]);
      if (left <= L || i === pts.length - 1) {
        dir.subVectors(pts[i], pts[i - 1]).normalize();
        return out.lerpVectors(pts[i - 1], pts[i], L > 0 ? Math.min(1, left / L) : 1);
      }
      left -= L;
    }
    return out.copy(pts[pts.length - 1]);
  }

  // ----------------------------------------------------------------- sound

  private sound(): void {
    const p = this.player;
    const inCar = this.shot === 'cockpit' || this.shot === 'pov';
    this.engine?.setSpeed(Math.abs(p.speed), this.phase === 'drive' ? Math.max(0, p.throttleNow) : 0.4);
    this.engine?.setGain(inCar ? 1 : 0.35);
    this.tyres?.set(inCar ? p.slide : 0);
  }

  // ---------------------------------------------------------------- camera

  private eyeInCar(out: THREE.Vector3): THREE.Vector3 {
    const rig = this.civicRig;
    const seat = rig.seat;
    rig.group.updateMatrixWorld(true);
    return out.set(seat.hip.x, seat.hip.y + 0.68 - rig.body.position.y, seat.hip.z + 0.06).applyMatrix4(rig.body.matrixWorld);
  }

  private lookFromCar(yaw: number, out: THREE.Vector3): THREE.Vector3 {
    const rig = this.civicRig;
    const seat = rig.seat;
    return out
      .set(seat.hip.x - Math.sin(yaw) * 10, seat.hip.y + 0.68 - rig.body.position.y - 0.55, seat.hip.z + 0.06 - Math.cos(yaw) * 10)
      .applyMatrix4(rig.body.matrixWorld);
  }

  private updateCamera(dt: number): void {
    const cam = this.camera;
    const p = this.player;
    let fov = 70;
    switch (this.shot) {
      case 'wide': {
        // On the runway behind his car, low: his men at the back of it, rifles up at the gate, the jet starting to roll past them
        this.apt(412, -2, cam.position).setY(1.6);
        this.lookAt.copy(this.jet.group.position).lerp(this.bossRig.group.position, 0.55).setY(1.8);
        fov = 56;
        break;
      }
      case 'pov':
      case 'cockpit': {
        this.eyeInCar(cam.position);
        this.lookFromCar(this.shot === 'cockpit' ? -p.steerNow * 0.13 : 0, this.lookAt);
        fov = this.shot === 'cockpit' ? 74 + 12 * clamp01(Math.abs(p.speed) / 50) : 68;
        break;
      }
      case 'emerge': {
        // Out ahead of the Civic on the jet's side, low, riding along: him coming up out of the roof, the wing above
        const g = this.civicRig.group;
        g.updateMatrixWorld(true);
        cam.position.set(-3.4, 1.3, -5.6).applyMatrix4(g.matrixWorld);
        this.lookAt.set(0.1, 1.6, 0.4).applyMatrix4(g.matrixWorld);
        fov = 58;
        break;
      }
      case 'leapSide': {
        // From out past the wingtip, ahead: him across the gap from the car to the wing
        const r = this.driver?.root;
        this.jetWorld(-17, 3.2, -5, cam.position);
        if (r) r.getWorldPosition(AirportScene.tmpA).y += 0.8;
        this.lookAt.lerp(AirportScene.tmpA, Math.min(1, dt * 8));
        fov = 55;
        break;
      }
      case 'wing': {
        // On the wing with him, out toward the tip and a little ahead of him (behind
        // him are the engines), riding with the jet as he crawls in
        const r = this.driver?.root;
        if (r) {
          const at = AirportScene.tmpC.copy(r.position);
          this.jetWorld(at.x - 2.6, at.y + 1.5, at.z - 2.3, cam.position);
          this.jetWorld(at.x + 1.2, at.y + 0.5, at.z - 0.2, AirportScene.tmpA);
          if (this.phaseT < 0.05) this.lookAt.copy(AirportScene.tmpA);
          this.lookAt.lerp(AirportScene.tmpA, Math.min(1, dt * 8));
        }
        fov = 62;
        break;
      }
      case 'vent': {
        // Ahead of the vent, outboard and above the wing root: him going in head first
        const m = this.ventMouth;
        this.jetWorld(m.x - 3.0, m.y + 0.9, m.z - 2.2, cam.position);
        this.jetWorld(m.x, m.y - 0.2, m.z, AirportScene.tmpA);
        this.lookAt.lerp(AirportScene.tmpA, Math.min(1, dt * 8));
        fov = 55;
        break;
      }
    }
    const inCar = this.shot === 'cockpit' || this.shot === 'pov';
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const s = this.shake * (inCar ? 0.05 : 0.12);
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.lookAt);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * (this.shot === 'cockpit' ? Math.min(1, dt * 3) : 1);
      cam.updateProjectionMatrix();
    }
    const head = this.driver?.bones.get('head');
    if (head) head.scale.setScalar(inCar ? 0.001 : 1);
    if (this.crackCanvas) this.crackCanvas.style.opacity = inCar ? '1' : '0';
  }

  // ------------------------------------------------------------------- HUD

  private updateHud(): void {
    const p = this.player;
    const mph = Math.round(Math.abs(p.speed) * MPH);
    if (this.speedEl.textContent !== String(mph)) this.speedEl.textContent = String(mph);
    const left = 100 - this.damage;
    this.dmgEl.style.width = `${left}%`;
    this.dmgEl.style.background = left > 55 ? '#52e07a' : left > 25 ? '#e0c452' : '#ff5a46';
    const gap = Math.round(this.jetRoute0 + this.jetS - this.net.routeS(p.at));
    const txt = gap > 0 ? `▲ ${gap} m` : 'ALONGSIDE';
    if (this.jetEl.textContent !== txt) this.jetEl.textContent = txt;
    const runway = clamp01((this.jetB() - LIFT_B) / (JET_AT[1] - LIFT_B));
    (this.runwayEl.querySelector('b') as HTMLElement).style.width = `${runway * 100}%`;
    this.runwayEl.classList.toggle('low', runway < 0.3);
  }

  // ---------------------------------------------------------------- render

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.warmedUp) this.warmUp(renderer);
    renderer.render(this.scene, this.camera);
  }

  private warmUp(renderer: THREE.WebGLRenderer): void {
    this.warmedUp = true;
    const far = new THREE.Vector3(0, -60, 0);
    const up = new THREE.Vector3(0, 1, 0);
    this.particles.tyreSmoke(far, up, 1);
    this.particles.sparks(far, up, 4);
    this.particles.dust(far, 1, 1);
    this.particles.muzzleFlash(far, up);
    this.particles.tracer(far, far.clone().add(new THREE.Vector3(0, 0, 3)), 0xffe0b0);
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

const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t3 = new THREE.Vector3();

/** The yaw that faces from `from` to `to`. */
function faceFrom(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}
