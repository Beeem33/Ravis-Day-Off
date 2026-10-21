import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { StreetBuilder, STREET_ATMOSPHERE } from '../environment/StreetBuilder';
import type { StreetData, JetRig, RoadPos } from './StreetContracts';
import type { CarRig, CivicRig } from './Level8Contracts';
import { civic, bossCar, WHEEL_RIM } from '../environment/VehicleProps';
import { privateJet } from '../environment/StreetProps';
import { buildAirside, type Airside } from '../environment/AirsideProps';
import { crewVan, exterminatorBadge, grenade, type VanRig } from '../environment/VanProps';
import { rackAK } from '../entities/AkModel';
import { RoadNet } from '../entities/RoadNet';
import { Enemy } from '../entities/Enemy';
import { armWithAK } from '../entities/AkModel';
import { RaviVisual, FirstPersonArms, grip, HAND, type RaviRig } from '../entities/RaviVisual';
import { WheelGrip, wheelInModel } from '../entities/WheelGrip';
import { RifleViewmodel } from '../entities/RifleViewmodel';
import type { FPSPlayer } from '../entities/FPSPlayer';
import { ParticleManager } from '../fx/ParticleManager';
import { DialogueBox, type DialogueLine } from '../ui/DialogueBox';
import { track, smooth, clamp01, alongPath, pathLength, wrapAngle } from './cutscene';

/**
 * Level 11, the alternate — left on the runway. Where Level 10 left him:
 * the Civic stopped short of the airside gate, the boss's jet away down the
 * runway, and his men and the airport's security pouring rounds into the
 * car. He can't stop it: the jet lifts and is gone, and they close in.
 *
 * Then a horn, and a big grey van comes in off the apron flat out, through
 * the boss's two men and the gate's boom and straight at him through the
 * security team — all of it through his windscreen — and skids round to a
 * stop broadside across his front. He gets out and goes over to it as his
 * coworkers get up off its benches and climb down out of it. Sanjay has been
 * doing some research on the bodies: Todd's ID, the Exterminator
 * Collective. Not police at all — the boss hired them to get rid of
 * everyone who could ever talk. It's them or us. Into the van, and as the
 * sun goes down on the highway, the crew suit up out of the arsenal in the
 * back for the Collective's headquarters.
 *
 * All of it a cutscene; the lines wait for a click as they do everywhere.
 */

const SANJAY = 0.88;
const DEV = 0.95;
const RAVI = 1.0;
/** The airfield frame (see StreetBuilder.buildAirport): a past the airport road's end, b to its right. */
const CIVIC_AT: [number, number] = [384, 60];
const JET_AT: [number, number] = [430.5, 30];
/** How far the jet has rolled, and how fast it is going, when Level 10 went to black. */
const JET_ROLLED = 60;
const JET_V0 = 30;
/**
 * The van's run, all of it in front of Ravi's windscreen: in off the apron
 * from his left, through the boss's two men, through the gate's boom, and
 * straight at him through the security team — then hard on the brakes and
 * round to its left, skidding to a stop broadside across his front right
 * with its side door facing him.
 */
const VAN_RUN: [number, number][] = [
  [466, 4], [446, 20], [432, 31], [421.5, 40.2], [414.6, 47.3], [406, 55.5], [400, 59.3], [396.2, 59.7],
  [393.6, 60.0], [391.7, 61.3], [390.7, 63.4], [390.4, 66.0], [390.35, 68.6]
];
/** Where the boom is across its path. */
const GATE_AT: [number, number] = [398, 59.5];
/** Where the security team and the two men walk up to as they close in on the car, all of them in the van's way. */
const OFFICER_TO: [number, number][] = [[396.0, 59.0], [394.0, 60.9], [392.5, 59.2], [391.3, 62.2]];
const GUARD_TO: [number, number][] = [[414.5, 47.6], [421.0, 40.5]];
/**
 * Out of the van and round him, van frame (its door on +X): Ravi stood back
 * from the door facing it, and his coworkers in an arc between him and it,
 * Sanjay in front — [out from the side, along it from the door's middle].
 */
const RAVI_OFF: [number, number] = [2.95, 0];
const CREW_OFF: [number, number][] = [[1.5, 0], [1.82, -1.13], [1.82, 1.13], [2.65, -1.67], [2.65, 1.67], [0.62, -1.15], [0.62, 1.15]];
/** The way out: on round to its left and back down the approach road, the way they all came in. */
const VAN_AWAY: [number, number][] = [[390.35, 68.6], [390.1, 71.4], [388.3, 73.5], [384.5, 74.3], [376, 73.2], [360, 70], [330, 68], [280, 67]];
/** On foot: how fast they walk, outside and in the van; how long a step up or down takes. */
const WALK = 1.45;
const WALK_IN = 1.0;
const STEP_UP = 0.62;
const STEP_DOWN = 0.55;
/** Tyre marks the van can lay as it slides. */
const SKID_MARKS = 220;
/** The montage: down the highway, in its middle lane, as the sun goes down. */
const MONTAGE_S0 = 700;
const MONTAGE_LANE = -3.6;
const MONTAGE_LEN = 30;

/** Sat on a bench, hands resting on the thighs, palms down (body frame: his right +X, forward −Z). */
const SEATED_HANDS = (): Enemy['pose'] => ({
  handR: new THREE.Vector3(0.15, 0.62, -0.3),
  handL: new THREE.Vector3(-0.15, 0.62, -0.3),
  palmR: new THREE.Vector3(0, -1, 0),
  thumbR: new THREE.Vector3(-1, 0, -0.2),
  palmL: new THREE.Vector3(0, -1, 0),
  thumbL: new THREE.Vector3(1, 0, -0.2),
  curl: 0.25
});

/**
 * Sat with a rifle stood up between his knees, butt on the floor: both hands
 * round its handguard, the right under the left, elbows out over his knees.
 * `rack` (0..1) takes the right hand down to the cocking handle and back.
 */
const RIFLE_HANDS = (rack = 0): Enemy['pose'] => ({
  handR: new THREE.Vector3(0.035, 0.64, -0.3).lerp(new THREE.Vector3(0.08, 0.5, -0.24), rack),
  handL: new THREE.Vector3(-0.03, 0.77, -0.3),
  palmR: new THREE.Vector3(-1, 0, -0.15),
  thumbR: new THREE.Vector3(0, 1, 0),
  palmL: new THREE.Vector3(1, 0, -0.15),
  thumbL: new THREE.Vector3(0, 1, 0),
  elbow: new THREE.Vector3(0.8, -0.45, 0.2),
  curl: 0.9,
  lean: 0.1
});

type Beat = 'pinned' | 'van' | 'exit' | 'talk1' | 'badge' | 'talk2' | 'board' | 'leave' | 'montage' | 'end';

/**
 * Ravi's right hand holding the badge up from behind: fingers flat up its
 * back, the thumb round its bottom corner onto the face, so the face is all
 * there to read (badge frame: face +Z, its right +X, up +Y).
 */
const BADGE_GRIP = grip([0.06, -0.14, -0.024], [-0.22, 0.9, -0.36], [0, 0, 1], [0.3, -0.8, 0.45], {
  fingers: [[12, 16, 10], [14, 18, 10], [16, 20, 12], [18, 22, 12]],
  thumb: [0.45, 0.35, 0.2]
});

/** The montage's shots, in order, and when each cuts in. */
const SHOTS = [
  ['m-sunset', 0], ['m-wide', 3], ['m-rack', 5.4], ['m-vest', 7.2], ['m-helmets', 9.8], ['m-load', 11.8],
  ['m-grenade', 14.6], ['m-drone', 16.6], ['m-red', 19.4], ['m-bump', 21.8], ['m-ready', 23.8], ['m-ahead', 26.8]
] as const;
type ShotKey = (typeof SHOTS)[number][0];

export class RunwayScene implements GameScene {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, STREET_ATMOSPHERE.cameraFar);
  private level!: StreetData;
  private airside!: Airside;
  private net!: RoadNet;
  private world!: CANNON.World;
  private particles!: ParticleManager;
  private dialogue!: DialogueBox;

  private civicRig!: CivicRig;
  private bossRig!: CarRig;
  private jet!: JetRig;
  private van!: VanRig;
  private driver: RaviRig | null = null;
  private wheelGrip: WheelGrip | null = null;
  private guards: Enemy[] = [];
  private officers: Enemy[] = [];
  /** Sanjay, Dev, and five more off the floor; whoever's driving. */
  private crew: Enemy[] = [];
  private sanjay!: Enemy;
  private dev!: Enemy;
  private wheelman!: Enemy;
  /** Where each of the crew sits in the van (van frame) and which way he faces. */
  private readonly seatOf = new Map<Enemy, { at: THREE.Vector3; yaw: number }>();
  private readonly startAt = new Map<Enemy, THREE.Vector3>();
  private readonly closeAt = new Map<Enemy, THREE.Vector3>();
  private fireCd = new Map<Enemy, number>();
  private burst = new Map<Enemy, number>();
  private cracks = 0;

  // ---- The timeline
  private beat: Beat = 'pinned';
  private beatT = 0;
  private timeScale = 1;
  private slowT = 0;
  private shake = 0;
  private completed = false;

  // ---- The jet
  private jetYaw = 0;
  private readonly jetStart = new THREE.Vector3();
  private jetS = JET_ROLLED;
  private jetV = JET_V0;
  private jetPitch = 0;
  private jetUp = 0;

  // ---- The van
  private vanPath: THREE.Vector3[] = [];
  private vanLen = 0;
  private vanS = 0;
  private vanV = 0;
  private vanMoving = false;
  private vanStoppedAt = -1;
  /** What speed it wants at a distance along its path, and how hard it may speed up and slow down to get it. */
  private vanWant: (s: number, left: number) => number = () => 0;
  private vanAccel = 7;
  private vanBrake = 14;
  private readonly vanVel = new THREE.Vector3();
  private readonly vanPrev = new THREE.Vector3();
  /** Route s along the van's run: of each man in its way, and of the boom. */
  private readonly hitS = new Map<Enemy, number>();
  private gateS = 0;
  private gateDown = false;
  private slowDone = false;
  private gateT = 0;
  private montageS = MONTAGE_S0;

  // ---- The people on foot
  /**
   * A walk: through `pts`, each leg timed — on the flat at `speed`, a step up
   * or down (a leg that changes height) taking STEP_UP / STEP_DOWN with the
   * knees in it — then turning to `face`, and `done`.
   */
  private readonly walks = new Map<
    Enemy,
    { pts: THREE.Vector3[]; legT: number[]; steps: number[]; total: number; t: number; face?: THREE.Vector3; done?: () => void; backLast: boolean; stepPosed: boolean }
  >();
  /** Who's turning to look at what, once they've stopped. */
  private readonly faceGoal = new Map<Enemy, THREE.Vector3>();
  /** Standing up off the bench or sitting down on it: since when, and which way. */
  private readonly benchMove = new Map<Enemy, { t: number; up: boolean }>();
  /** The crew's places round Ravi outside the van, his own, and when each of them gets up to come out. */
  private readonly standAt = new Map<Enemy, THREE.Vector3>();
  private readonly raviAt = new THREE.Vector3();
  /** His own way out of the car and round to them, and back into the van: points his eyes go through. */
  private raviPath: THREE.Vector3[] = [];
  private raviLegT: number[] = [];
  private raviT0 = 0;

  // ---- The badge, in Ravi's hand
  private badgeRoot = new THREE.Group();
  private badgeAnchor = new THREE.Group();
  private badgeArms!: FirstPersonArms;
  private sanjayBadge!: THREE.Group;
  private readonly handover = new THREE.Vector3();
  private grenadeProp: THREE.Group | null = null;
  private rifle!: RifleViewmodel;

  // ---- The camera
  private readonly eye = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private fov = 70;
  /** Where his eyes are once he's out of the car: walking round it, stood, walking to the van and into it. */
  private readonly standEye = new THREE.Vector3();
  private shotKey = '';
  private readonly fixedCam = new THREE.Vector3();

  // ---- The sun going down
  private sunDir = new THREE.Vector3(0.95, 0.07, -0.3).normalize();
  private sunsetOn = false;
  private skyMat: THREE.MeshBasicMaterial | null = null;
  private sunMat: THREE.MeshBasicMaterial | null = null;
  private winMat: THREE.MeshLambertMaterial | null = null;
  private lights: { amb?: THREE.AmbientLight; hemi?: THREE.HemisphereLight; sun?: THREE.DirectionalLight } = {};

  // ---- Sound and UI
  private jetSound: { setThrust(k: number): void; setDistance(m: number): void; stop(): void } | null = null;
  private vanEngine: { setSpeed(mps: number, throttle: number): void; setGain(g: number): void; stop(): void } | null = null;
  private ui!: HTMLElement;
  private fadeEl!: HTMLElement;
  private flashEl!: HTMLElement;
  private endCard!: HTMLElement;
  private crackCanvas: HTMLCanvasElement | null = null;
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
    this.net = new RoadNet(this.level.roads);
    const ap = this.level.roads.airport;
    const end = ap.samples[ap.samples.length - 1];
    const f = new THREE.Vector3(end.tangent.x, 0, end.tangent.z).normalize();
    this.airside = buildAirside({ origin: end.pos.clone().setY(0), f, r: new THREE.Vector3(-f.z, 0, f.x) });
    this.scene.add(this.airside.group);

    // Ragdolls, for whoever the van goes through
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
    this.van = crewVan();
    this.scene.add(this.van.group);
    this.particles = new ParticleManager(this.scene, { smoke: 1400 });

    this.placeEveryone();
    this.dressApron();
    this.buildCrew();
    this.buildDriver();
    this.buildViewmodels();
    this.buildSunset();
    this.buildUI();
    // The box over the letterbox's bottom bar, not behind it
    this.dialogue = new DialogueBox(this.ctx.uiRoot, audio);
    const boxes = this.ctx.uiRoot.querySelectorAll<HTMLElement>('.dialogue-box');
    const box = boxes[boxes.length - 1];
    if (box) box.style.bottom = 'calc(12vh + 18px)';

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.sizeCracks();
      })
    );
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('click', this.clickHandler);
    this.jetSound = audio.jetEngine();
    this.vanEngine = audio.engineLoop();
    this.vanEngine.setGain(0);
    this.setBeat('pinned');
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('click', this.clickHandler);
    this.jetSound?.stop();
    this.vanEngine?.stop();
    this.ctx.audio.stopBossMusic(1);
    this.dialogue.destroy();
    this.ui.remove();
    this.ctx.engine.renderer.toneMappingExposure = 1;
  }

  // ------------------------------------------------------------------ setup

  private apt(a: number, b: number, out = new THREE.Vector3()): THREE.Vector3 {
    const ap = this.level.roads.airport;
    const end = ap.samples[ap.samples.length - 1];
    const l = Math.hypot(end.tangent.x, end.tangent.z) || 1;
    const fx = end.tangent.x / l;
    const fz = end.tangent.z / l;
    return out.set(end.pos.x + fx * a - fz * b, 0, end.pos.z + fz * a + fx * b);
  }

  private aptPath(pts: [number, number][]): THREE.Vector3[] {
    return pts.map(([a, b]) => this.apt(a, b));
  }

  /** A point in the jet's frame at the start of its run (nose −Z, its left −X), on the ground. */
  private jetLocal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = Math.cos(this.jetYaw);
    const sn = Math.sin(this.jetYaw);
    return out.set(this.jetStart.x + c * x + sn * z, 0, this.jetStart.z - sn * x + c * z);
  }

  /** A point beside the boss's car (its left −X, nose −Z), on the ground. */
  private carLocal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const g = this.bossRig.group;
    const c = Math.cos(g.rotation.y);
    const sn = Math.sin(g.rotation.y);
    return out.set(g.position.x + c * x + sn * z, 0, g.position.z - sn * x + c * z);
  }

  /** Everyone where Level 10 left them. */
  private placeEveryone(): void {
    const ap = this.level.roads.airport;
    const end = ap.samples[ap.samples.length - 1];
    const l = Math.hypot(end.tangent.x, end.tangent.z) || 1;
    this.jetYaw = Math.atan2(-end.tangent.z / l, end.tangent.x / l);
    this.jetStart.copy(this.apt(...JET_AT));
    const g = this.jet.group;
    g.rotation.order = 'YXZ';
    g.rotation.set(0, this.jetYaw, 0);
    this.jet.setDoor(0);
    this.jet.setEngines(1);
    this.placeJet();

    // His car by where the jet stood, and his two men at its back
    this.bossRig.group.position.copy(this.jetLocal(-11, -6.5));
    this.bossRig.group.rotation.y = this.jetYaw;
    for (let i = 0; i < 2; i++) {
      const e = new Enemy(this.carLocal(i === 0 ? -1.5 : 1.1, i === 0 ? 3.3 : 3.6), this.jetYaw, 11 + i, { name: 'POLICE FORCE AGENT' });
      armWithAK(e);
      e.setAiming(true);
      this.scene.add(e.root);
      this.guards.push(e);
      this.startAt.set(e, e.position.clone());
      this.closeAt.set(e, this.apt(...GUARD_TO[i]));
      this.fireCd.set(e, 0.2 + i * 0.4);
    }
    // The security team, across the gate
    for (let i = 0; i < 4; i++) {
      const e = new Enemy(this.apt(394.5 + (i % 2) * 0.8, 49 + i * 6.2), 0, 20 + i, { name: 'AIRPORT SECURITY', security: true });
      e.faceToward(this.apt(...CIVIC_AT), 1, 100);
      armWithAK(e);
      e.setAiming(true);
      this.scene.add(e.root);
      this.officers.push(e);
      this.startAt.set(e, e.position.clone());
      this.closeAt.set(e, this.apt(...OFFICER_TO[i]));
      this.fireCd.set(e, 0.6 + Math.random());
    }
    // The Civic, stopped short of the gate, its nose to it
    const civicAt = this.apt(...CIVIC_AT);
    this.civicRig.group.position.copy(civicAt);
    this.civicRig.group.rotation.y = faceFrom(civicAt, this.apt(CIVIC_AT[0] + 20, CIVIC_AT[1]));

    // The van's run, and where on it things happen
    const run = this.aptPath(VAN_RUN);
    for (const e of [...this.officers, ...this.guards]) this.hitS.set(e, this.sOnPath(run, this.closeAt.get(e)!));
    this.gateS = this.sOnPath(run, this.apt(...GATE_AT));
    this.vanPath = run;
    this.vanLen = pathLength(run);
    this.vanS = 0;
    this.vanOnPath(0, 0);
    // Out of sight until it's on its way
    this.van.group.visible = false;
  }

  /** The take-off run, from where Level 10 left it: down the runway, rotate, unstick, and climb away. */
  private placeJet(): void {
    const g = this.jet.group;
    const H = RunwayScene.tmpA.set(-Math.sin(this.jetYaw), 0, -Math.cos(this.jetYaw));
    g.position.copy(this.jetStart).addScaledVector(H, this.jetS);
    g.position.y = this.jetUp + Math.sin(this.jetPitch) * 3;
    g.rotation.x = this.jetPitch;
  }

  private updateJet(dt: number): void {
    if (this.jetUp > 900) return;
    this.jetV += (this.jetV < 60 ? 8 : 4) * dt;
    this.jetS += this.jetV * dt;
    const pitchT = this.jetV > 46 ? 0.2 : 0;
    this.jetPitch += (pitchT - this.jetPitch) * Math.min(1, dt * 1.4);
    if (this.jetV > 54) this.jetUp += (this.jetV - 54) * 0.35 * dt + this.jetPitch * this.jetV * 0.3 * dt;
    this.placeJet();
    this.jet.setEngines(1);
    this.jetSound?.setThrust(1);
    this.jetSound?.setDistance(this.camera.position.distanceTo(this.jet.group.position));
  }

  /**
   * His coworkers, in the van: Sanjay (the ketchup mostly washed out), Dev,
   * five more off the floor, and whoever's driving — at the wheel the whole
   * way, the rest out of sight in the back until the door opens.
   */
  private buildCrew(): void {
    const v = this.van;
    const mk = (name: string, idx: number): Enemy => {
      const e = new Enemy(new THREE.Vector3(0, -60, 0), 0, idx, { name, civilian: true });
      this.scene.add(e.root);
      e.root.visible = false;
      return e;
    };
    this.sanjay = mk('SANJAY', 6);
    this.dev = mk('DEV', 4);
    // The floor's whites, as every day they've worked there; caps on or off, Dev in his glasses (indices picked for eight different faces)
    this.crew = [this.sanjay, this.dev, mk('STAFF', 9), mk('STAFF', 7), mk('STAFF', 3), mk('STAFF', 5), mk('STAFF', 2)];
    const looks: { cap?: boolean; glasses?: boolean }[] = [{}, { cap: false, glasses: true }, {}, { cap: false }, {}, { cap: false }, { cap: false }];
    this.crew.forEach((e, i) => e.restyleCrew(looks[i]));
    // Facing each other across the aisle, pair by pair down the bay: Sanjay and Dev nearest the door
    const places: { at: THREE.Vector3; yaw: number }[] = [
      { at: v.seats.right[0], yaw: Math.PI / 2 },
      { at: v.seats.left[2], yaw: -Math.PI / 2 },
      { at: v.seats.right[1], yaw: Math.PI / 2 },
      { at: v.seats.left[3], yaw: -Math.PI / 2 },
      { at: v.seats.right[2], yaw: Math.PI / 2 },
      { at: v.seats.left[4], yaw: -Math.PI / 2 },
      { at: v.seats.right[3], yaw: Math.PI / 2 }
    ];
    this.crew.forEach((e, i) => this.seatOf.set(e, places[i]));
    // In the back the whole way, riding with it until the door opens
    this.crew.forEach((e, i) => this.seatIn(e, places[i].at, places[i].yaw));
    this.wheelman = mk('STAFF', 8);
    const stain = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.012), new THREE.MeshStandardMaterial({ color: 0xd88a86, roughness: 0.5 }));
    stain.position.set(-0.02, -0.06, -0.141);
    this.sanjay.addChestPatch(stain);
    this.seatIn(this.wheelman, v.seats.driver, 0);
    // Todd's badge, in Sanjay's fist until it changes hands
    this.sanjayBadge = exterminatorBadge();
    const holder = new THREE.Group();
    holder.add(this.sanjayBadge);
    this.sanjayBadge.position.set(0, 0.06, 0);
    this.sanjay.holdProp(holder, 0.02);
    this.sanjayBadge.visible = false;
  }

  /** Sat on the van's seat at `at` (van frame), turned `yaw`, riding with it: there already, or (`instant` false) sitting down onto it. */
  private seatIn(e: Enemy, at: THREE.Vector3, yaw: number, instant = true): void {
    this.van.body.add(e.root);
    e.position.set(at.x, at.y - this.van.body.position.y, at.z);
    e.yaw = yaw;
    e.root.rotation.y = yaw;
    e.setWalk(0);
    e.root.visible = true;
    this.faceGoal.delete(e);
    if (!instant) {
      e.setSitting(true);
      this.benchMove.set(e, { t: 0, up: false });
      return;
    }
    e.setSitting(true, true);
    // The wheel for the driver; for the rest, hands on their thighs (sat, they'd otherwise be at a keyboard)
    e.pose =
      e === this.wheelman
        ? { handR: new THREE.Vector3(0.17, 1.02, -0.42), handL: new THREE.Vector3(-0.17, 1.02, -0.42), curl: 0.85 }
        : SEATED_HANDS();
  }

  /** Ravi at the wheel, as Level 10 sat him, his hands round it. */
  private buildDriver(): void {
    const rig = this.civicRig;
    RaviVisual.whenReady(() => {
      const r = RaviVisual.rig('body');
      r.root.rotation.y = Math.PI;
      r.root.position.set(rig.seat.hip.x, -rig.body.position.y, rig.seat.hip.z);
      rig.body.add(r.root);
      const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
      const fwd = rig.seat.hip.z - rig.seat.wheel.z;
      r.seat({
        hips: V(0, rig.seat.hip.y, 0),
        lean: [-10, 3, 3, 2, 2, -2],
        legs: {
          l: { ankle: V(0.16, 0.14, fwd + 0.42), knee: V(0.12, 0.8, 1) },
          r: { ankle: V(-0.14, 0.14, fwd + 0.42), knee: V(-0.12, 0.8, 1) }
        },
        arms: {}
      });
      this.driver = r;
      this.wheelGrip = new WheelGrip(r, { ...wheelInModel(rig.seat, 0), radius: WHEEL_RIM });
      this.wheelGrip.update(0);
    });
  }

  /** In the back of the van for the montage: sat on the left bench up by the cab, elbows on his knees. */
  private seatRaviInVan(): void {
    const r = this.driver;
    if (!r) return;
    this.van.body.add(r.root);
    const at = this.van.seats.left[0];
    r.root.position.set(at.x, at.y - this.van.body.position.y, at.z);
    r.root.rotation.y = Math.PI / 2;
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    r.seat({
      hips: V(0, 0.53, -0.18),
      lean: [-4, 8, 8, 4, 2, -4],
      legs: {
        l: { ankle: V(0.15, 0.09, 0.3), knee: V(0.2, 0.7, 1) },
        r: { ankle: V(-0.15, 0.09, 0.3), knee: V(-0.2, 0.7, 1) }
      },
      arms: {
        l: { wrist: V(0.13, 0.62, 0.22), along: V(-0.3, -0.25, 1), palm: V(-0.2, -1, 0), elbow: V(0.7, -0.4, -0.3), shape: HAND.relaxed },
        r: { wrist: V(-0.13, 0.62, 0.22), along: V(0.3, -0.25, 1), palm: V(0.2, -1, 0), elbow: V(-0.7, -0.4, -0.3), shape: HAND.relaxed }
      }
    });
    r.root.visible = true;
  }

  /** The badge in Ravi's hand, and the AK for the montage: both on the camera. */
  private buildViewmodels(): void {
    this.camera.add(this.badgeRoot);
    this.badgeRoot.add(this.badgeAnchor);
    const badge = exterminatorBadge();
    this.badgeAnchor.add(badge);
    badge.visible = false;
    this.badgeAnchor.userData.badge = badge;
    this.badgeArms = new FirstPersonArms(this.badgeRoot, this.camera).set('r', this.badgeAnchor, BADGE_GRIP);
    this.badgeRoot.visible = false;
    this.rifle = new RifleViewmodel(this.camera);
    this.rifle.stow = 1;
    this.rifle.onReloadEvent = (e) => {
      const a = this.ctx.audio;
      if (e === 'magOut') a.magOut();
      else if (e === 'magIn') a.magIn();
      else if (e === 'rackBack') a.boltBack();
      else if (e === 'rack') a.boltForward();
    };
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
      <canvas class="rw-cracks" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0"></canvas>
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="rw-flash" style="position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none"></div>
      <div class="intro-fade" style="opacity:1;transition:opacity 0.8s"></div>
      <div class="rw-end" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
        font-family:'Courier New',monospace;color:#e8f4ec;opacity:0;pointer-events:none;transition:opacity 1.2s">
        <div style="font-size:22px;letter-spacing:9px">TO BE CONTINUED</div>
        <div style="font-size:13px;letter-spacing:5px;color:#9fd3c4">NEXT — THE EXTERMINATOR COLLECTIVE</div>
      </div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.fadeEl = el.querySelector('.intro-fade')!;
    this.flashEl = el.querySelector('.rw-flash')!;
    this.endCard = el.querySelector('.rw-end')!;
    this.crackCanvas = el.querySelector('.rw-cracks');
    this.sizeCracks();
  }

  private sizeCracks(): void {
    const c = this.crackCanvas;
    if (!c) return;
    c.width = Math.round(window.innerWidth * Math.min(2, window.devicePixelRatio || 1));
    c.height = Math.round(window.innerHeight * Math.min(2, window.devicePixelRatio || 1));
  }

  /** A round through the windscreen in front of him: the hole, and the cracks running out of it. */
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
    g.fillStyle = 'rgba(20,22,24,0.85)';
    g.beginPath();
    g.arc(x, y, Math.max(2, c.height / 260), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(240,244,248,0.35)';
    g.beginPath();
    g.arc(x, y, Math.max(4, c.height / 140), 0, Math.PI * 2);
    g.fill();
  }

  private onClick(): void {
    if (this.dialogue.isActive) this.dialogue.advance();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.dialogue.isActive && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) {
      e.preventDefault();
      this.dialogue.advance();
    }
  }

  // ---------------------------------------------------------------- update

  private setBeat(b: Beat): void {
    this.beat = b;
    this.beatT = 0;
  }

  update(dt: number, _time: number): void {
    dt = Math.min(dt, 0.05);
    // The odd moment in slow motion: real time ticks it down
    if (this.slowT > 0) {
      this.slowT -= dt;
      this.timeScale += (0.32 - this.timeScale) * Math.min(1, dt * 12);
    } else this.timeScale += (1 - this.timeScale) * Math.min(1, dt * 4);
    const dts = dt * this.timeScale;
    this.beatT += dts;

    switch (this.beat) {
      case 'pinned':
        this.updatePinned(dts);
        break;
      case 'van':
        this.updateVanRun(dts);
        break;
      case 'exit':
        this.updateExit();
        break;
      case 'badge':
        this.updateBadge();
        break;
      case 'board':
        this.updateBoard();
        break;
      case 'leave':
        this.updateLeave();
        break;
      case 'montage':
        this.updateMontage(dts);
        break;
      case 'end':
        this.updateEnd();
        break;
      default:
        break;
    }

    this.updateJet(dts);
    this.updateVan(dts);
    this.updateWalks(dts);
    this.updateDebris(dts);
    if (this.beat === 'pinned' || this.beat === 'van') this.updateGunmen(dts);
    for (const e of [...this.guards, ...this.officers]) e.update(dts);
    const talking = this.dialogue.typing ? this.dialogue.speaker : null;
    for (const e of [...this.crew, this.wheelman]) {
      e.speaking = (e === this.sanjay && talking === 'SANJAY') || (e === this.dev && talking === 'DEV');
      e.update(dts);
    }
    this.world.step(1 / 60, dts, 3);
    this.dialogue.update(dt);
    this.updateCamera(dt);
    if (this.badgeRoot.visible) this.badgeArms.update();
    // (Every frame: it's what hides it while it's stowed)
    const fake = { sprinting: false, currentSpeed: 0, crouching: false, bob: { phase: 0, amount: 0 } } as unknown as FPSPlayer;
    this.rifle.update(dts, fake, 0, 0, false);
    this.particles.update(dts);
    this.ctx.input.endFrame();
  }

  // ------------------------------------------------------------- the beats

  /**
   * Pinned down: the jet runs, lifts and climbs away; the security team and
   * the two men walk in on the car, firing as they come. In his eyes, a cut
   * outside to the men firing, and back. A horn, from back up the taxiway.
   */
  private updatePinned(dt: number): void {
    const t = this.beatT;
    if (t < 0.05) this.fadeEl.style.opacity = '0';
    for (const e of [...this.officers, ...this.guards]) {
      const from = this.startAt.get(e)!;
      const to = this.closeAt.get(e)!;
      // The boss's two men have further to come: they jog it
      const guard = this.guards.includes(e);
      const k = clamp01((t - (guard ? 0.2 : 0.6)) / (guard ? 6.2 : 5.2));
      e.position.lerpVectors(from, to, smooth(k));
      e.setWalk(k > 0 && k < 1 ? (guard ? 0.85 : 0.55) : 0);
      e.cadence = guard ? 1.25 : 1;
      e.faceToward(this.civicRig.group.position, dt, 6);
    }
    // The van, on its way in off the apron: flat out at the boom, on the brakes through the security team, round, stopped
    if (t > 6.4 && !this.vanMoving) {
      const g = this.gateS;
      this.startVan(this.vanPath, 26, (s, left) => (s < g - 12 ? 26 : s < g ? THREE.MathUtils.lerp(26, 15, (s - g + 12) / 12) : Math.min(15, Math.sqrt(2 * 9 * Math.max(0, left)))), 6, 13);
    }
    if (t > 6.6 && t - dt <= 6.6) this.ctx.audio.horn(80);
    if (t > 7.3 && t - dt <= 7.3) this.ctx.audio.horn(60);
    if (t > 7.4) this.setBeat('van');
  }

  /** The van's run: the two men, the boom, the security team, and round to a stop in front of him. */
  private updateVanRun(dt: number): void {
    const t = this.beatT;
    const g = this.van.group;
    // On the brakes for the turn: the tyres let go, and it slides round on smoke off all four
    if (this.vanS > this.gateS + 2 && this.vanS - this.vanV * dt <= this.gateS + 2) {
      this.ctx.audio.tyreSqueal(1.8, this.camera.position.distanceTo(g.position));
    }
    if (this.vanS > this.gateS + 2 && this.vanV > 3) {
      this.laySkids();
      // Mostly off the back wheels, the ones sliding out
      for (const [x, z, k] of [[-1.05, 2.75, 0.5], [1.05, 2.75, 0.5], [-1.05, -3.05, 0.2], [1.05, -3.05, 0.2]]) {
        const p = RunwayScene.tmpC.set(x, 0.3, z).applyMatrix4(g.matrixWorld);
        this.particles.tyreSmoke(p, RunwayScene.tmpA.set(0, 0.4, 0), k * Math.min(1, this.vanV / 10));
      }
    }
    // The gate's boom, straight through it: both halves thrown up and bent back off their hinges
    if (!this.gateDown && this.vanS > this.gateS - this.van.length / 2) {
      this.gateDown = true;
      this.gateT = 0;
      // Out of the pair's group, which would otherwise hold them level together, so each can go its own way
      const halves = this.airside.gateArm.userData.halves as THREE.Object3D[] | undefined;
      for (const h of halves ?? []) this.airside.group.attach(h);
      const at = this.apt(...GATE_AT).setY(1.0);
      this.ctx.audio.carCrash(this.camera.position.distanceTo(at), true);
      this.particles.sparks(at, RunwayScene.tmpA.set(0, 1, 0), 30);
      this.throwDebris(at, this.vanVel.clone().setY(0).normalize());
      this.shake = Math.min(1, this.shake + 0.4);
    }
    if (this.gateDown) {
      this.gateT += dt;
      const halves = this.airside.gateArm.userData.halves as THREE.Object3D[] | undefined;
      if (halves) {
        const k = 1 - Math.exp(-this.gateT * 9);
        const wobble = Math.exp(-this.gateT * 3) * Math.sin(this.gateT * 22) * 0.12;
        halves[0].rotation.z = 1.25 * k + wobble;
        halves[1].rotation.z = 1.02 * k - wobble;
      }
    }
    this.runOver();
    if (this.vanStoppedAt >= 0 && t - this.vanStoppedAt > 0.7) this.setBeat('exit');
  }

  /** Anyone in the van's footprint goes under it: thrown, and a ragdoll from there. */
  private runOver(): void {
    const v = this.van;
    v.group.updateMatrixWorld(true);
    const inv = RunwayScene.tmpC;
    for (const e of [...this.officers, ...this.guards]) {
      if (!e.alive) continue;
      const p = v.group.worldToLocal(inv.copy(e.position));
      if (Math.abs(p.x) > v.width / 2 + 0.3 || Math.abs(p.z) > v.length / 2 + 0.2) continue;
      const hitAt = e.position.clone().setY(1.0);
      const dir = this.vanVel.clone().normalize();
      e.die(hitAt, dir, this.world, 'torso', 1.5);
      // Off the corner they were caught by, more out to the side than on ahead of it (it's coming at him)
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(v.group.quaternion).multiplyScalar(Math.sign(p.x || (Math.random() - 0.5)) * 5.5);
      e.launch(this.vanVel.clone().multiplyScalar(0.45).add(side).setY(4.5 + Math.random() * 1.8));
      const d = this.camera.position.distanceTo(hitAt);
      this.ctx.audio.bodyThud(d);
      this.ctx.audio.carCrash(d, false);
      this.particles.bloodSpray(hitAt, dir, true, 0);
      this.shake = Math.min(1, this.shake + 0.35);
      // The first of the security team, right in front of him: a beat of slow motion
      if (this.officers.includes(e) && !this.slowDone) {
        this.slowDone = true;
        this.slowT = 0.7;
      }
    }
  }

  /**
   * Out he gets — the door, out and up, and round the Civic's nose to face
   * the van — as its side door slides back and his coworkers pile out and
   * come round him, Sanjay to the front.
   */
  private updateExit(): void {
    const t = this.beatT;
    const civic = this.civicRig;
    const v = this.van;
    if (t < 0.02 && this.raviPath.length === 0) this.planExit();
    civic.setDoor(smooth(t / 0.5));
    if (t > 0.05 && t - 0.02 <= 0.05) this.ctx.audio.carDoor(true, 1);
    if (this.driver) this.driver.root.visible = t < 0.55;
    if (this.crackCanvas && t > 0.6) this.crackCanvas.style.opacity = '0';
    // His eyes: out of the seat and through the door, up on his feet, then round the nose and over to them
    civic.group.updateMatrixWorld(true);
    const seat = this.seatEye(RunwayScene.tmpA);
    const out = this.raviPath[0];
    if (t < 0.5) this.standEye.copy(seat);
    else if (t < 1.5) {
      // Swing the legs out, then up: low and out first, rising at the end
      const k = (t - 0.5) / 1.0;
      this.standEye.lerpVectors(seat, out, smooth(k));
      this.standEye.y = THREE.MathUtils.lerp(seat.y, out.y, smooth(clamp01((k - 0.35) / 0.65))) - Math.sin(Math.PI * k) * 0.08;
    } else this.raviAlong(t - 1.5);
    // The van's side door back, and out they come: up off the bench, down the aisle, down the steps, round him
    v.setDoor(smooth((t - 0.7) / 1.0));
    if (t > 0.7 && t - 0.02 <= 0.7) this.ctx.audio.carDoor(true, 4);
    this.crew.forEach((e, i) => {
      const rise = 1.3 + i * 0.75;
      if (t >= rise && !this.benchMove.has(e) && e.root.parent === v.body) this.standUp(e);
      if (t >= rise + 0.7 && e.root.parent === v.body) this.walkOut(e);
    });
    // Once they're down out of the van, they look at him as they come
    for (const e of this.crew) if (e.root.parent !== v.body && !this.walksInside(e)) e.setHeadLook(this.standEye);
    const allOut = this.crew.every((e) => e.root.parent !== v.body && !this.walks.has(e));
    if (allOut && t > this.raviT0 + 1.5 + 0.3) {
      this.setBeat('talk1');
      this.dialogue.play(
        [
          { speaker: 'SANJAY', text: 'Ravi, so glad to see you again. How was the traffic?', pitch: SANJAY },
          { speaker: 'SANJAY', text: 'Ravi, I found this on one of the invaders’ bodies.', pitch: SANJAY }
        ],
        () => this.setBeat('badge')
      );
    }
  }

  /** His eyes, sat in the Civic. */
  private seatEye(out: THREE.Vector3): THREE.Vector3 {
    const rig = this.civicRig;
    rig.group.updateMatrixWorld(true);
    return out.set(rig.seat.hip.x, rig.seat.hip.y + 0.68 - rig.body.position.y, rig.seat.hip.z + 0.06).applyMatrix4(rig.body.matrixWorld);
  }

  /**
   * Todd's badge: Sanjay holds it out, Ravi takes it and brings it up to
   * look at it properly — for as long as it takes to read — then puts it
   * away, and Sanjay goes on.
   */
  private updateBadge(): void {
    const t = this.beatT;
    const s = this.sanjay;
    const badge = this.badgeAnchor.userData.badge as THREE.Group;
    // Sanjay's hand out with it — steady, thumb up, the badge stood up in his fingers — and down once it's taken
    const reach = track([[0, 0], [0.9, 1], [1.6, 1], [2.3, 0]], t);
    const rest = new THREE.Vector3(0.2, 0.92, -0.08);
    const offer = new THREE.Vector3(0.06, 1.22, -0.44);
    s.pose =
      reach > 0.001
        ? { handR: rest.clone().lerp(offer, reach), palmR: new THREE.Vector3(-1, 0.1, -0.15), thumbR: new THREE.Vector3(0, 1, -0.15), curl: 0.85 }
        : null;
    this.sanjayBadge.visible = t < 1.55;
    // Stood up out of the top of his fist, its bottom edge in his grip, its
    // face turned to Ravi — and where Ravi's hand goes to take it
    if (t < 1.55) {
      const holder = this.sanjayBadge.parent!;
      holder.updateWorldMatrix(true, false);
      const fist = holder.getWorldPosition(RunwayScene.tmpA);
      this.sanjayBadge.position.copy(holder.worldToLocal(fist.add(RunwayScene.tmpB.set(0, 0.064, 0))));
      this.sanjayBadge.lookAt(this.camera.position);
      this.sanjayBadge.updateWorldMatrix(true, false);
      this.camera.updateMatrixWorld(true);
      this.handover.copy(this.camera.worldToLocal(this.sanjayBadge.getWorldPosition(RunwayScene.tmpA)));
    }
    // Ravi's hand: up to it, takes it, brings it close, holds it there, puts it away
    this.badgeRoot.visible = t > 0.9 && t < 9.3;
    badge.visible = t >= 1.55;
    const a = this.badgeAnchor;
    const close = new THREE.Vector3(0.0, -0.01, -0.29);
    const below = new THREE.Vector3(0.16, -0.42, -0.3);
    const away = new THREE.Vector3(0.3, -0.55, -0.12);
    if (t < 1.55) {
      a.position.lerpVectors(below, this.handover, smooth((t - 0.9) / 0.65));
      a.rotation.set(0, -0.5, 0);
    } else if (t < 2.7) {
      const k = smooth((t - 1.55) / 1.15);
      a.position.lerpVectors(this.handover, close, k);
      a.rotation.set(-0.06 * k, -0.5 * (1 - k) - 0.06 * k, 0.04 * k);
    } else if (t < 8.3) {
      // Held up to read; a hand isn't a stand
      const h = t - 2.7;
      a.position.copy(close).add(RunwayScene.tmpB.set(Math.sin(h * 1.3) * 0.003, Math.sin(h * 1.9) * 0.0025, 0));
      a.rotation.set(-0.06 + Math.sin(h * 0.9) * 0.015, -0.06 + Math.sin(h * 0.7) * 0.02, 0.04);
    } else {
      const k = smooth((t - 8.3) / 0.9);
      a.position.lerpVectors(close, away, k);
      a.rotation.set(-0.06 - 0.9 * k, -0.06 - 0.4 * k, 0.04 + 0.6 * k);
    }
    if (t > 9.4) {
      s.pose = null;
      this.badgeRoot.visible = false;
      this.setBeat('talk2');
      this.dialogue.play(
        [
          { speaker: 'SANJAY', text: 'I guess these guys aren’t police after all.', pitch: SANJAY },
          { speaker: 'SANJAY', text: 'The boss hired them to get rid of us. ALL OF US.', pitch: SANJAY },
          { speaker: 'SANJAY', text: 'He wanted anything or anybody that could say something against him gone, just so he could leave the call center.', pitch: SANJAY },
          { speaker: 'SANJAY', text: 'After all those years of threatening us with his scare tactics...', pitch: SANJAY },
          { speaker: 'SANJAY', text: 'Anyway, we are here to take him and the Exterminator Collective down.', pitch: SANJAY },
          { speaker: 'DEV', text: 'So it’s them or us now.', pitch: DEV },
          { speaker: 'RAVI', text: 'Then it’s them. All of us, together.', pitch: RAVI }
        ] satisfies DialogueLine[],
        () => this.setBeat('board')
      );
      // It's sunk in: no more smiles
      for (const e of this.crew) e.setSerious();
    }
  }

  /**
   * Back into the van, all of them, him last: the furthest places fill
   * first, one up the steps at a time; each along the aisle to his place,
   * turned and back down onto the bench. Then him, up and in and down on the
   * bench up by the cab — and the door slides shut across the airfield.
   */
  private updateBoard(): void {
    const t = this.beatT;
    const v = this.van;
    const [sanjay, dev, s0, s1, s2, s3, s4] = this.crew;
    const order = [s4, s2, s3, s0, s1, sanjay, dev];
    order.forEach((e, k) => {
      if (t >= 0.4 + k * 0.72 && !this.boarded.has(e)) {
        this.boarded.add(e);
        this.walkIn(e);
      }
    });
    // Him, once the last of them is up the steps
    const go = 0.4 + order.length * 0.72 + 0.9;
    if (t >= go && this.raviStart < 0) this.planBoard(go);
    if (this.raviStart < 0) this.standEye.copy(this.raviAt).setY(this.raviAt.y + 1.64);
    else this.raviAlong(t - this.raviStart);
    // The light on in the back as he comes up to it; the door shut behind him once he's down
    v.light.intensity = THREE.MathUtils.lerp(0, 5, clamp01((t - 1.2) / 0.8));
    v.lamp.emissiveIntensity = v.light.intensity > 0.1 ? 1.4 : 0;
    const shut = this.raviStart < 0 ? Infinity : this.raviStart + this.raviT0 + 0.3;
    if (t > shut) v.setDoor(1 - smooth((t - shut) / 0.9));
    if (t > shut && t - 0.02 <= shut) this.ctx.audio.carDoor(false, 1);
    if (t > shut + 1.3) this.setBeat('leave');
  }

  private readonly boarded = new Set<Enemy>();
  private raviStart = -1;

  /** His own way in: to the door, up the steps, along to the bench up by the cab, turned and sat. */
  private planBoard(at: number): void {
    const v = this.van;
    const F = v.floorY;
    const E = 1.64;
    const up = (p: THREE.Vector3, h = E): THREE.Vector3 => this.vanWorld(p).add(RunwayScene.tmpA.set(0, h, 0));
    const seat = v.seats.left[0];
    this.raviPath = [
      this.standEye.clone(),
      up(v.doorOut),
      up(v.doorStep),
      up(v.doorSill),
      up(v.doorIn),
      up(new THREE.Vector3(-0.15, F, seat.z + 0.1)),
      this.vanWorld(new THREE.Vector3(seat.x + 0.12, F + 1.24, seat.z - 0.05))
    ];
    const legs = this.legTimes(this.raviPath, 1.4, this.van.group.position.y + E + 0.5);
    // The last leg is turning round and sitting down: not a step
    legs.t[legs.t.length - 1] = 1.0;
    legs.step[legs.step.length - 1] = 0;
    this.raviLegT = legs.t;
    this.raviSteps = legs.step;
    this.raviT0 = legs.t.reduce((a, b) => a + b, 0);
    this.raviStart = at;
  }

  /** Outside, by the car he's leaving: the van pulls round and away back down the approach road, and gone. */
  private updateLeave(): void {
    const t = this.beatT;
    if (t < 0.05 && !this.vanMoving) {
      this.startVan(this.aptPath(VAN_AWAY), 0, (s) => Math.min(28, 4 + s * 0.9), 4.5, 14, false);
      this.vanEngine?.setGain(1);
      this.ctx.audio.tyreSqueal(0.6, 14);
    }
    if (t > 3.4) this.fadeEl.style.opacity = '1';
    if (t > 4.4) this.startMontage();
  }

  // ------------------------------------------------------------ the montage

  /**
   * Suiting up on the way, as the sun goes down: out on the highway, a run of
   * short hard shots in the back of the van — the rack, Sanjay into his kit,
   * helmets on, Ravi loading the AK, Dev with a grenade, the van from above
   * and from the road, the crew in the red work light, a fist bump across the
   * aisle, everyone armed and racking a round — and the last of the sun ahead.
   */
  private startMontage(): void {
    this.setBeat('montage');
    this.vanMoving = false;
    this.vanStoppedAt = -1;
    this.montageS = MONTAGE_S0;
    this.placeVanOnHighway(0, 0);
    this.seatRaviInVan();
    // The sun ahead of them, low, a touch to the right of the road
    const f = this.net.sample('highway', MONTAGE_S0 + 400);
    this.sunDir.copy(f.tangent).setY(0).normalize().addScaledVector(f.right, 0.25).setY(0.07).normalize();
    this.sunsetOn = true;
    this.applySunset(0);
    this.van.headlights.emissiveIntensity = 2.2;
    this.ctx.audio.startBossMusic();
    this.vanEngine?.setSpeed(26, 0.6);
    this.vanEngine?.setGain(0.7);
    this.fadeEl.style.opacity = '0';
    this.grenadeProp = grenade();
    if (!this.vestProp) this.buildMontageProps();
    for (const e of this.crew) e.setSerious();
    this.wheelman.setSerious();
  }

  private shotAt(t: number): ShotKey {
    let k: ShotKey = SHOTS[0][0];
    for (const [key, t0] of SHOTS) if (t >= t0) k = key;
    return k;
  }

  private updateMontage(dt: number): void {
    const t = this.beatT;
    const v = this.van;
    this.montageS += 26 * dt;
    this.placeVanOnHighway(t, dt);
    this.applySunset(clamp01(t / MONTAGE_LEN));
    const cut = (at: number): boolean => t >= at && t - dt < at;
    const shot = this.shotAt(t);
    // Hard cuts, a flash on some of them
    const flash = [5.4, 8.1, 10.6, 11.8, 16.6, 19.4, 23.8].some((c) => t > c && t < c + 0.07);
    this.flashEl.style.opacity = flash ? '0.6' : '0';
    const [sanjay, dev, s0, s1, s2, s3, s4] = this.crew;
    const racks = [24.2, 24.55, 24.9, 25.25, 25.6, 25.95, 26.3];
    const sat = (e: Enemy): void => {
      const i = this.crew.indexOf(e);
      const rack = Math.sin(Math.PI * clamp01((t - racks[i]) / 0.45));
      e.pose = this.armed && this.kneeRifles.has(e) ? RIFLE_HANDS(t > racks[i] ? rack : 0) : SEATED_HANDS();
    };
    for (const e of this.crew) sat(e);

    // The rack: a rifle lifted up off its hooks and away along the wall (one high at the back, where the shot looks, clear of their heads)
    const rifle = v.rack[5];
    if (shot === 'm-rack') {
      const k = smooth((t - 5.9) / 1.1);
      rifle.position.copy(this.rackHome(rifle)).add(RunwayScene.tmpA.set(-0.04 * k, 0.16 * k, -0.6 * k * k));
      rifle.rotation.set(0.25 * k, 0, Math.PI / 2 - 0.15 * k);
      if (cut(5.9)) this.ctx.audio.boltBack();
    } else if (t > 7.2) rifle.visible = false;

    // Sanjay: the vest up off his lap by its shoulders and over his head, the cut, and he's in it, pulling the straps tight
    const vest = this.vestProp;
    if (shot === 'm-vest' && t < 8.1) {
      // Up off his lap to his chest, then up and over: hands wide on its shoulders, elbows out and down
      const k1 = smooth((t - 7.25) / 0.35);
      const k2 = smooth((t - 7.6) / 0.45);
      const at = (sx: number): THREE.Vector3 =>
        new THREE.Vector3(sx * 0.2, 0.8, -0.36).lerp(new THREE.Vector3(sx * 0.2, 1.0, -0.38), k1).lerp(new THREE.Vector3(sx * 0.19, 1.5, -0.14), k2);
      sanjay.pose = {
        handR: at(1),
        handL: at(-1),
        palmR: new THREE.Vector3(-0.3, 0, 1),
        thumbR: new THREE.Vector3(0, 1, 0),
        palmL: new THREE.Vector3(0.3, 0, 1),
        thumbL: new THREE.Vector3(0, 1, 0),
        elbow: new THREE.Vector3(1, -0.55, 0.15),
        curl: 0.8,
        lean: 0.12 * (1 - k2)
      };
      if (vest) this.holdBetween(vest, sanjay, at(1), at(-1), -0.24);
    } else {
      if (vest) vest.visible = false;
      if (shot === 'm-vest') {
        const tug = 0.03 * Math.sin((t - 8.1) * 10);
        sanjay.pose = {
          handR: new THREE.Vector3(0.12, 0.9 + tug, -0.18),
          handL: new THREE.Vector3(-0.12, 0.9 - tug, -0.18),
          palmR: new THREE.Vector3(0, 0, 1),
          thumbR: new THREE.Vector3(0, 1, 0),
          palmL: new THREE.Vector3(0, 0, 1),
          thumbL: new THREE.Vector3(0, 1, 0),
          elbow: new THREE.Vector3(1, -0.4, 0.4),
          curl: 0.85
        };
      }
    }
    if (cut(8.1)) {
      sanjay.wearCrewKit();
      this.ctx.audio.kickWhoosh();
      this.ctx.audio.velcro();
    }
    // The straps, ripped open and pressed home
    if (cut(8.55) || cut(9.2)) this.ctx.audio.velcro();

    // Two across the aisle, helmets on
    // Up off the lap in both hands, held over the head, and pulled down onto it; then the hands come back down
    if (shot === 'm-helmets') {
      const k = t < 10.6 ? smooth((t - 9.8) / 0.5) : 1 - smooth((t - 10.9) / 0.6);
      const on = smooth((t - 10.15) / 0.4);
      [s0, s1].forEach((e, n) => {
        const at = (sx: number): THREE.Vector3 => new THREE.Vector3(sx * 0.16, 0.66, -0.3).lerp(new THREE.Vector3(sx * 0.15, 1.46 - 0.13 * on, -0.02), k);
        e.pose = {
          handR: at(1),
          handL: at(-1),
          palmR: new THREE.Vector3(-1, 0, 0),
          thumbR: new THREE.Vector3(0, 1, -0.4),
          palmL: new THREE.Vector3(1, 0, 0),
          thumbL: new THREE.Vector3(0, 1, -0.4),
          elbow: new THREE.Vector3(1, 0.35, -0.4),
          curl: 0.35
        };
        const h = this.helmetProps[n];
        if (h && t < 10.6) this.holdBetween(h, e, at(1), at(-1), -0.02);
        else if (h) h.visible = false;
      });
    } else for (const h of this.helmetProps) h.visible = false;
    if (cut(10.6)) {
      s0.wearCrewKit();
      s1.wearCrewKit();
      this.ctx.audio.kickWhoosh();
      this.ctx.audio.helmetKnock();
    }
    // A knuckle rapped on one, to be sure
    if (cut(10.75)) this.ctx.audio.helmetKnock();
    if (cut(11.0)) this.ctx.audio.clink();

    // His own hands: the AK, loaded and racked
    if (cut(11.8)) this.rifle.stow = 0.6;
    if (shot === 'm-load') this.rifle.stow += (0 - this.rifle.stow) * Math.min(1, dt * 6);
    else this.rifle.stow = 1;
    if (cut(12.2)) this.rifle.startReload();

    // Dev, kitted, turning a grenade over in his hand, then onto his vest with it
    if (cut(14.6)) {
      dev.wearCrewKit();
      s2.wearCrewKit();
      if (this.grenadeProp) dev.holdProp(this.grenadeProp, 0.02);
      this.ctx.audio.clink();
    }
    // Its pin ring knocking; then home in the pouch
    if (cut(15.1)) this.ctx.audio.clink();
    if (cut(16.2)) this.ctx.audio.velcro();
    if (shot === 'm-grenade') {
      const k = smooth((t - 15.7) / 0.6);
      dev.pose = {
        handR: new THREE.Vector3(0.08, 1.14 + 0.02 * Math.sin(t * 2), -0.32).lerp(new THREE.Vector3(0.1, 1.05, -0.16), k),
        handL: new THREE.Vector3(-0.15, 0.62, -0.3),
        head: new THREE.Euler(0.35 + 0.15 * k, 0.15, 0),
        curl: 0.7
      };
    }
    if (cut(16.6)) this.grenadeProp?.removeFromParent();

    // The red work light: everyone in kit now
    if (cut(19.4)) {
      for (const e of [s3, s4, this.wheelman]) e.wearCrewKit();
      this.ctx.audio.velcro();
      v.light.intensity = 0.6;
      v.redLight.intensity = 6;
      v.lamp.emissiveIntensity = 0.25;
    }
    // A fist bump across the aisle: Dev and Sanjay
    if (shot === 'm-bump') {
      const k = t < 22.7 ? smooth((t - 21.9) / 0.8) : 1 - smooth((t - 23.0) / 0.6);
      const mid = this.vanWorld(new THREE.Vector3(0, v.floorY + 1.0, (this.seatOf.get(dev)!.at.z + this.seatOf.get(sanjay)!.at.z) / 2));
      for (const e of [dev, sanjay]) {
        e.root.updateMatrixWorld(true);
        const to = e.root.worldToLocal(mid.clone());
        e.pose = { handR: new THREE.Vector3(0.15, 0.62, -0.3).lerp(to, k), handL: new THREE.Vector3(-0.15, 0.62, -0.3), elbow: new THREE.Vector3(0.6, -0.8, 0.1), curl: 1, lean: 0.34 * k };
      }
      if (cut(22.7)) this.ctx.audio.bodyThud(0.6);
    }

    // Everyone armed, rifles between their knees, racking a round one after another
    if (cut(23.8)) {
      this.armed = true;
      for (const e of this.crew) this.rifleBetweenKnees(e);
      v.light.intensity = 2.2;
      v.redLight.intensity = 4;
      v.lamp.emissiveIntensity = 0.8;
    }
    // Up front for the last shot: the lamp over the cab, so there's something to see by in it
    if (cut(26.8)) {
      v.light.position.set(0.2, 2.45 - v.body.position.y, -2.3);
      v.light.intensity = 2.4;
      v.redLight.intensity = 1.2;
    }
    for (const at of racks.map((r) => r + 0.12)) {
      if (cut(at)) {
        this.ctx.audio.boltBack();
        setTimeout(() => this.ctx.audio.boltForward(), 130);
      }
    }
    if (t > MONTAGE_LEN - 1.1) this.fadeEl.style.opacity = '1';
    if (t > MONTAGE_LEN) {
      this.setBeat('end');
      this.ctx.audio.stopBossMusic(3);
      this.vanEngine?.setGain(0);
    }
  }

  private armed = false;
  /** The vest Sanjay lifts over his head, the helmets two of them put on, and the rifles stood between their knees. */
  private vestProp: THREE.Group | null = null;
  private helmetProps: THREE.Mesh[] = [];
  private readonly kneeRifles = new Map<Enemy, THREE.Object3D>();
  private akButt = -1;

  /** In the van's back for the montage: a vest and two helmets, hidden until they're in somebody's hands. */
  private buildMontageProps(): void {
    const kit = new THREE.MeshStandardMaterial({ color: 0x353b2c, roughness: 0.88 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x23271d, roughness: 0.9 });
    const vest = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.07), kit);
    vest.add(panel);
    for (const sx of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.03), strap);
      sh.position.set(sx * 0.13, 0.3, 0);
      vest.add(sh);
      const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.05), strap);
      pouch.position.set(sx * 0.11, -0.12, -0.055);
      vest.add(pouch);
    }
    vest.visible = false;
    this.van.body.add(vest);
    this.vestProp = vest;
    const shell = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6 });
    for (let i = 0; i < 2; i++) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell);
      h.scale.set(1, 0.95, 1.12);
      h.visible = false;
      this.van.body.add(h);
      this.helmetProps.push(h);
    }
  }

  /** `prop` (riding on the van's body) held between `e`'s two hands at `a` and `b` (his own frame), `dy` up from their middle, square to him. */
  private holdBetween(prop: THREE.Object3D, e: Enemy, a: THREE.Vector3, b: THREE.Vector3, dy: number): void {
    e.root.updateMatrixWorld(true);
    const mid = RunwayScene.tmpA.copy(a).add(b).multiplyScalar(0.5);
    mid.y += dy;
    e.root.localToWorld(mid);
    this.van.body.updateMatrixWorld(true);
    prop.position.copy(this.van.body.worldToLocal(mid));
    prop.rotation.set(0, e.yaw, 0);
    prop.visible = true;
  }

  /** A rifle stood up between his knees, butt on the floor, its sights toward him: still, riding with the van. */
  private rifleBetweenKnees(e: Enemy): void {
    const place = this.seatOf.get(e)!;
    const gun = rackAK();
    if (this.akButt < 0) {
      gun.updateMatrixWorld(true);
      this.akButt = Math.max(0.3, new THREE.Box3().setFromObject(gun).max.z);
    }
    gun.rotation.set(Math.PI / 2, place.yaw, 0, 'YXZ');
    gun.position.set(place.at.x - Math.sin(place.yaw) * 0.3, place.at.y - this.van.body.position.y + this.akButt + 0.01, place.at.z - Math.cos(place.yaw) * 0.3);
    this.van.body.add(gun);
    this.kneeRifles.set(e, gun);
  }

  private readonly rackHomes = new Map<THREE.Object3D, THREE.Vector3>();
  private rackHome(o: THREE.Object3D): THREE.Vector3 {
    let p = this.rackHomes.get(o);
    if (!p) {
      p = o.position.clone();
      this.rackHomes.set(o, p);
    }
    return p;
  }

  private updateEnd(): void {
    const t = this.beatT;
    if (t > 0.8) this.endCard.style.opacity = '1';
    if (t > 7 && !this.completed) {
      this.completed = true;
      this.ctx.bus.emit(Events.RunwayComplete);
    }
  }

  // ------------------------------------------------------------- the sunset

  /** Its own sky and sun, so the street's shared ones are left as they are for every other level. */
  private buildSunset(): void {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#1c2150');
    grad.addColorStop(0.24, '#3a3c76');
    grad.addColorStop(0.36, '#7a568a');
    grad.addColorStop(0.44, '#d4716a');
    grad.addColorStop(0.485, '#ffa45a');
    grad.addColorStop(0.505, '#ffc878');
    grad.addColorStop(0.54, '#7a5446');
    grad.addColorStop(1, '#241e22');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 256);
    const sky = new THREE.CanvasTexture(c);
    sky.colorSpace = THREE.SRGBColorSpace;
    this.skyMat = new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false, depthWrite: false });
    const s = document.createElement('canvas');
    s.width = s.height = 128;
    const sg = s.getContext('2d')!;
    const r = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,236,190,1)');
    r.addColorStop(0.12, 'rgba(255,196,110,0.95)');
    r.addColorStop(0.24, 'rgba(255,140,60,0.45)');
    r.addColorStop(0.55, 'rgba(255,110,50,0.12)');
    r.addColorStop(1, 'rgba(255,100,40,0)');
    sg.fillStyle = r;
    sg.fillRect(0, 0, 128, 128);
    const sun = new THREE.CanvasTexture(s);
    sun.colorSpace = THREE.SRGBColorSpace;
    this.sunMat = new THREE.MeshBasicMaterial({ map: sun, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    // The offices lighting up as it gets dark: their own copy of the facade's material, its panes lit from
    // an atlas of one bay eight by eight, a few warm and most dark, so no two tiles side by side match
    const win = this.level.group.getObjectByName('street-windows') as THREE.Mesh | undefined;
    if (win) {
      const c2 = document.createElement('canvas');
      c2.width = c2.height = 1024;
      const lg = c2.getContext('2d')!;
      lg.fillStyle = '#000';
      lg.fillRect(0, 0, 1024, 1024);
      const warm = ['#ffd38a', '#ffe2a8', '#fff0d2', '#ffc06a', '#dfe8ff'];
      let seed = 11;
      const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let cy = 0; cy < 8; cy++) {
        for (let cx = 0; cx < 8; cx++) {
          const r = rnd();
          if (r > 0.42) continue;
          const x = cx * 128;
          const y = cy * 128;
          lg.fillStyle = warm[Math.floor(rnd() * warm.length) % warm.length];
          // One side of the mullion only, now and then; a blind half down in some
          if (r < 0.1) lg.fillRect(x + (rnd() < 0.5 ? 16 : 66), y + 16, 46, 86);
          else lg.fillRect(x + 16, y + 16, 96, 86);
          if (rnd() < 0.3) {
            lg.fillStyle = 'rgba(0,0,0,0.6)';
            lg.fillRect(x + 16, y + 16, 96, 32);
          }
          lg.fillStyle = '#000';
          lg.fillRect(x + 62, y + 16, 4, 86);
          lg.fillRect(x + 16, y + 54, 96, 3);
        }
      }
      const lit = new THREE.CanvasTexture(c2);
      lit.colorSpace = THREE.SRGBColorSpace;
      lit.wrapS = lit.wrapT = THREE.RepeatWrapping;
      lit.repeat.set(1 / 8, 1 / 8);
      const m = (win.material as THREE.MeshLambertMaterial).clone();
      m.emissive.set(0xffffff);
      m.emissiveMap = lit;
      m.emissiveIntensity = 0;
      win.material = m;
      this.winMat = m;
    }
    this.level.group.traverse((o) => {
      if ((o as THREE.AmbientLight).isAmbientLight) this.lights.amb = o as THREE.AmbientLight;
      else if ((o as THREE.HemisphereLight).isHemisphereLight) this.lights.hemi = o as THREE.HemisphereLight;
      else if ((o as THREE.DirectionalLight).isDirectionalLight) this.lights.sun = o as THREE.DirectionalLight;
    });
  }

  /** The light at `u` of the way through the sun going down: low gold, then orange and rose, then blue dusk. */
  private applySunset(u: number): void {
    if (!this.sunsetOn) return;
    const L = this.level.group;
    const sky = L.getObjectByName('street-sky') as THREE.Mesh | undefined;
    const sunMesh = L.getObjectByName('street-sun') as THREE.Mesh | undefined;
    if (sky && this.skyMat && sky.material !== this.skyMat) sky.material = this.skyMat;
    if (sunMesh && this.sunMat && sunMesh.material !== this.sunMat) {
      sunMesh.material = this.sunMat;
      const cam = new THREE.Vector3();
      const sp = new THREE.Vector3();
      const scale = new THREE.Matrix4();
      sunMesh.onBeforeRender = (_r, _s, camera) => {
        cam.setFromMatrixPosition(camera.matrixWorld);
        sp.copy(cam).addScaledVector(this.sunDir, 1080);
        sunMesh.matrixWorld.lookAt(cam, sp, THREE.Object3D.DEFAULT_UP);
        sunMesh.matrixWorld.multiply(scale.makeScale(2.4, 2.4, 1));
        sunMesh.matrixWorld.setPosition(sp);
      };
    }
    // The sun sinks to the horizon and under it; the sky goes from gold to dusk
    this.sunDir.y = THREE.MathUtils.lerp(0.075, -0.03, u);
    this.sunDir.normalize();
    const dusk = smooth((u - 0.35) / 0.65);
    if (this.skyMat) this.skyMat.color.setRGB(1 - 0.5 * dusk, 1 - 0.52 * dusk, 1 - 0.3 * dusk);
    if (this.sunMat) this.sunMat.opacity = 1 - smooth((u - 0.8) / 0.2) * 0.85;
    const lerpC = (a: number, b: number, k: number): THREE.Color => new THREE.Color(a).lerp(new THREE.Color(b), k);
    const { amb, hemi, sun } = this.lights;
    if (amb) {
      amb.color.copy(lerpC(0xb48c84, 0x4e4a6a, dusk));
      amb.intensity = THREE.MathUtils.lerp(0.45, 0.22, dusk);
    }
    if (hemi) {
      hemi.color.copy(lerpC(0xffa679, 0x55578a, dusk));
      hemi.groundColor.copy(lerpC(0x4a3430, 0x1e1a24, dusk));
      hemi.intensity = THREE.MathUtils.lerp(1.0, 0.45, dusk);
    }
    if (sun) {
      sun.color.copy(lerpC(0xffa25a, 0xff6a40, dusk));
      sun.intensity = THREE.MathUtils.lerp(2.1, 0.15, dusk);
      sun.position.copy(sun.target.position).addScaledVector(this.sunDir, 300);
    }
    // Lights coming on: windows across the city, and the van's headlamps on the road
    if (this.winMat) this.winMat.emissiveIntensity = 1.15 * smooth((u - 0.3) / 0.55);
    for (const b of this.van.beams) b.intensity = 160 * smooth((u - 0.2) / 0.5);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(lerpC(0xd08868, 0x3c3450, dusk));
    this.ctx.engine.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 0.92, dusk);
  }

  // -------------------------------------------------------------- dressing

  /**
   * More of the airfield round where it all happens: floodlight masts over the
   * apron, a windsock out by the runway, the taxiway's signs and its holding
   * markings beyond the gate, jersey barriers along the approach's left verge,
   * a tug and its baggage carts left by the hut, another jet out on a remote
   * stand, and the brass the security team has been spending all over the
   * concrete. Only this scene's: nobody walks here.
   */
  private dressApron(): void {
    const g = new THREE.Group();
    g.name = 'runway-dressing';
    this.scene.add(g);
    const ap = this.level.roads.airport;
    const end = ap.samples[ap.samples.length - 1];
    const yawA = Math.atan2(-end.tangent.x, -end.tangent.z);
    const mat = (color: number, rough = 0.7, metal = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const galv = mat(0x9aa1a6, 0.45, 0.6);
    const conc = mat(0xc9c6bf, 0.9);
    const yellow = mat(0xe8b21e, 0.6);
    const dark = mat(0x2a2d31, 0.8);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], a: number, b: number, y: number, turn = 0, to: THREE.Object3D = g): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.copy(this.apt(a, b)).setY(y);
      mesh.rotation.y = yawA + turn;
      to.add(mesh);
      return mesh;
    };
    const signTex = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.MeshStandardMaterial => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d')!);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
    };

    // ---- Floodlight masts: a tall pole, a frame at the top, four lamps on it turned in over the apron
    const lens = mat(0xe6e2d4, 0.3);
    for (const [a, b, turn] of [[401.5, 37.5, -0.9], [378, 90, 2.4], [414, 84, Math.PI + 0.7]] as const) {
      add(new THREE.CylinderGeometry(0.16, 0.28, 18, 10), galv, a, b, 9, 0);
      add(new THREE.CylinderGeometry(0.5, 0.6, 0.4, 10), conc, a, b, 0.2, 0);
      const head = new THREE.Group();
      head.position.copy(this.apt(a, b)).setY(18);
      head.rotation.y = yawA + turn;
      g.add(head);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), galv);
      head.add(frame);
      for (let i = 0; i < 4; i++) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.22), dark);
        lamp.position.set(-0.96 + i * 0.64, -0.12, -0.12);
        lamp.rotation.x = -0.45;
        head.add(lamp);
        const face = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.33, 0.02), lens);
        face.position.set(-0.96 + i * 0.64, -0.2, -0.25);
        face.rotation.x = -0.45;
        head.add(face);
      }
    }

    // ---- The windsock out by the runway's edge: a striped cone off a pole, lifting in the breeze
    {
      add(new THREE.CylinderGeometry(0.06, 0.08, 6.5, 8), galv, 409, 104, 3.25);
      const sock = new THREE.Group();
      sock.position.copy(this.apt(409, 104)).setY(6.2);
      sock.rotation.y = yawA + 2.2;
      g.add(sock);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 6, 16), galv);
      sock.add(ring);
      const orange = mat(0xf26a1b, 0.8);
      const white = mat(0xf2f2ee, 0.8);
      for (let i = 0; i < 5; i++) {
        const r0 = 0.36 - i * 0.05;
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0 - 0.05, 0.62, 14, 1, true), i % 2 ? white : orange);
        seg.material.side = THREE.DoubleSide;
        seg.rotation.x = Math.PI / 2;
        seg.position.set(0, -0.04 * i * i * 0.6, -0.31 - i * 0.6);
        sock.add(seg);
      }
      this.windsock = sock;
    }

    // ---- Beyond the gate: the taxiway's location and direction signs, the runway's holding sign, and the holding markings
    {
      const loc = signTex(256, 128, (c) => {
        c.fillStyle = '#0d0d0d';
        c.fillRect(0, 0, 256, 128);
        c.strokeStyle = '#f2c21b';
        c.lineWidth = 6;
        c.strokeRect(8, 8, 240, 112);
        c.fillStyle = '#f2c21b';
        c.font = 'bold 92px Arial, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('A', 128, 70);
      });
      const dir = signTex(512, 128, (c) => {
        c.fillStyle = '#f2c21b';
        c.fillRect(0, 0, 512, 128);
        c.fillStyle = '#0d0d0d';
        c.font = 'bold 84px Arial, sans-serif';
        c.textBaseline = 'middle';
        c.fillText('← B', 24, 70);
        c.fillRect(252, 10, 8, 108);
        c.fillText('C →', 300, 70);
      });
      const hold = signTex(512, 128, (c) => {
        c.fillStyle = '#c4161c';
        c.fillRect(0, 0, 512, 128);
        c.fillStyle = '#ffffff';
        c.font = 'bold 84px Arial, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('09 – 27', 256, 70);
      });
      const board = (a: number, b: number, w: number, m: THREE.Material): void => {
        // Facing back down the taxiway at whoever's coming out through the gate
        add(new THREE.BoxGeometry(w, 0.75, 0.12), [dark, dark, dark, dark, dark, m], a, b, 0.75, Math.PI);
        for (const dx of [-w * 0.35, w * 0.35]) {
          const leg = add(new THREE.BoxGeometry(0.06, 0.4, 0.06), galv, a, b, 0.2, 0);
          leg.position.addScaledVector(new THREE.Vector3(Math.cos(yawA), 0, -Math.sin(yawA)), dx);
        }
      };
      board(410.5, 41.2, 0.75, loc);
      board(410.5, 43.4, 2.2, dir);
      board(410.5, 79.3, 2.3, hold);
      // Holding position markings across the taxiway: two solid, two dashed
      const paint = new THREE.MeshBasicMaterial({ color: 0xe0b42a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      for (const [k, dashed] of [[0, false], [0.45, false], [1.05, true], [1.5, true]] as const) {
        const a = 406.6 + k;
        if (!dashed) {
          const line = add(new THREE.PlaneGeometry(0.15, 30), paint, a, 60, 0.013, 0);
          line.rotation.set(-Math.PI / 2, yawA + Math.PI / 2, 0, 'YXZ');
        } else {
          for (let b = 45.5; b < 75; b += 2.2) {
            const dash = add(new THREE.PlaneGeometry(0.15, 1.2), paint, a, b, 0.013, 0);
            dash.rotation.set(-Math.PI / 2, yawA + Math.PI / 2, 0, 'YXZ');
          }
        }
      }
    }

    // ---- Jersey barriers down the approach's left verge, short of the stop sign
    {
      const shape = new THREE.Shape([new THREE.Vector2(-0.3, 0), new THREE.Vector2(0.3, 0), new THREE.Vector2(0.3, 0.08), new THREE.Vector2(0.13, 0.32), new THREE.Vector2(0.1, 0.82), new THREE.Vector2(-0.1, 0.82), new THREE.Vector2(-0.13, 0.32), new THREE.Vector2(-0.3, 0.08)]);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.95, bevelEnabled: false });
      geo.translate(0, 0, -0.975);
      for (let a = 370.5; a < 387; a += 2.05) {
        add(geo, conc, a, 41.6 + Math.sin(a) * 0.08, 0, Math.sin(a * 3.1) * 0.03);
      }
    }

    // ---- A baggage tug and two carts, left on the hardstand past the hut
    {
      const tugBody = mat(0xe0a71c, 0.6);
      const tug = new THREE.Group();
      tug.position.copy(this.apt(372.5, 88.5));
      tug.rotation.y = yawA + Math.PI / 2;
      g.add(tug);
      const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, to: THREE.Object3D = tug): void => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, y, z);
        to.add(mesh);
      };
      part(new THREE.BoxGeometry(1.3, 0.7, 2.6), tugBody, 0, 0.62, 0);
      part(new THREE.BoxGeometry(1.2, 0.9, 0.9), tugBody, 0, 1.4, 0.55);
      part(new THREE.BoxGeometry(1.1, 0.5, 0.05), dark, 0, 1.45, 0.08);
      part(new THREE.BoxGeometry(1.36, 0.06, 1.2), dark, 0, 1.88, 0.55);
      const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 14);
      wheelGeo.rotateZ(Math.PI / 2);
      for (const [x, z] of [[-0.62, -0.85], [0.62, -0.85], [-0.62, 0.85], [0.62, 0.85]]) part(wheelGeo, dark, x, 0.3, z);
      const cartGeo = new THREE.BoxGeometry(1.4, 0.12, 2.6);
      const bags = [0x2b4b8c, 0x7a2b2b, 0x23272b, 0x5d6f78, 0x8a5a36];
      for (let c = 0; c < 2; c++) {
        const cart = new THREE.Group();
        cart.position.set(0, 0, -3.1 - c * 3.0);
        tug.add(cart);
        part(cartGeo, dark, 0, 0.55, 0, cart);
        for (const sx of [-0.68, 0.68]) part(new THREE.BoxGeometry(0.04, 0.5, 2.6), galv, sx, 0.85, 0, cart);
        part(new THREE.BoxGeometry(1.4, 0.05, 2.6), galv, 0, 1.6, 0, cart);
        for (const [x, z] of [[-0.6, -1.1], [0.6, -1.1], [-0.6, 1.1], [0.6, 1.1]]) part(new THREE.CylinderGeometry(0.2, 0.2, 0.15, 10).rotateZ(Math.PI / 2), dark, x, 0.2, z, cart);
        for (let i = 0; i < 7; i++) {
          const w = 0.35 + ((i * 37) % 10) / 40;
          part(new THREE.BoxGeometry(w, 0.28 + ((i * 13) % 5) / 25, 0.55), mat(bags[(i + c * 2) % bags.length], 0.85), -0.35 + (i % 2) * 0.62, 0.78 + Math.floor(i / 4) * 0.34, -0.95 + (i % 4) * 0.62, cart);
        }
      }
    }

    // ---- Another jet out on a remote stand, shut up for the night
    {
      const jet = privateJet();
      jet.group.position.copy(this.apt(476, 128));
      jet.group.rotation.y = yawA + Math.PI * 0.8;
      jet.setDoor(0);
      jet.setEngines(0);
      g.add(jet.group);
    }

    // ---- Spent brass where the security team stood and fired, and round the two men
    {
      const brass = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.006, 0.006, 0.039, 6), new THREE.MeshStandardMaterial({ color: 0xc8a046, roughness: 0.35, metalness: 0.85 }), 90);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      let n = 0;
      for (const [a, b] of [...OFFICER_TO, [394.5, 49], [395.3, 55.2], [394.5, 61.4], [395.3, 67.6]] as [number, number][]) {
        for (let i = 0; i < 10 && n < 90; i++, n++) {
          const p = this.apt(a + (Math.random() - 0.3) * 2.2, b + (Math.random() - 0.5) * 2.2).setY(0.007);
          q.setFromEuler(e.set(Math.PI / 2, Math.random() * Math.PI * 2, 0, 'YXZ'));
          brass.setMatrixAt(n, m4.compose(p, q, new THREE.Vector3(1, 1, 1)));
        }
      }
      brass.count = n;
      g.add(brass);
    }

    // ---- The van's tyre marks, laid as it slides: all of them there from the start, parked until they're laid
    {
      const marks = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.26, 0.5).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x0e0f10, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
        SKID_MARKS
      );
      const park = new THREE.Matrix4().makeTranslation(0, -80, 0);
      for (let i = 0; i < SKID_MARKS; i++) marks.setMatrixAt(i, park);
      marks.frustumCulled = false;
      g.add(marks);
      this.skidMarks = marks;
    }
  }

  private windsock: THREE.Group | null = null;
  private skidMarks: THREE.InstancedMesh | null = null;
  private skidN = 0;
  private readonly skidLast: THREE.Vector3[] = [];

  /** Under each back tyre, a dark smear for every half metre it slides. */
  private laySkids(): void {
    const marks = this.skidMarks;
    if (!marks) return;
    const g = this.van.group;
    g.updateMatrixWorld(true);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    [[-1.05, 2.75], [1.05, 2.75], [-1.05, -3.05], [1.05, -3.05]].forEach(([x, z], i) => {
      const p = new THREE.Vector3(x, 0, z).applyMatrix4(g.matrixWorld).setY(0.012);
      const last = this.skidLast[i];
      if (!last) {
        this.skidLast[i] = p.clone();
        return;
      }
      const d = last.distanceTo(p);
      if (d < 0.4) return;
      // One smear from where this tyre was to where it is, the way it actually slid
      if (this.skidN < SKID_MARKS) {
        q.setFromAxisAngle(up, Math.atan2(-(p.x - last.x), -(p.z - last.z)));
        const mid = last.clone().add(p).multiplyScalar(0.5);
        marks.setMatrixAt(this.skidN++, m4.compose(mid, q, new THREE.Vector3(1, 1, (d + 0.08) / 0.5)));
        marks.instanceMatrix.needsUpdate = true;
      }
      last.copy(p);
    });
  }

  /** The boom's broken ends, thrown off the van's nose as it goes through: pieces of red and white tumbling down onto the paving. */
  private readonly debris: { mesh: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3 }[] = [];

  private throwDebris(at: THREE.Vector3, dir: THREE.Vector3): void {
    const red = new THREE.MeshStandardMaterial({ color: 0xc4262e, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.6 });
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.5 + Math.random() * 0.7), i % 2 ? white : red);
      mesh.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 0.4, (Math.random() - 0.5) * 1.5));
      this.scene.add(mesh);
      const v = dir.clone().multiplyScalar(8 + Math.random() * 6).add(new THREE.Vector3((Math.random() - 0.5) * 7, 4 + Math.random() * 4, (Math.random() - 0.5) * 7));
      this.debris.push({ mesh, v, spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12) });
    }
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      if (d.mesh.position.y <= 0.05 && d.v.lengthSq() < 0.01) continue;
      d.v.y -= 19 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.mesh.position.y < 0.05) {
        d.mesh.position.y = 0.05;
        d.v.multiplyScalar(0.35);
        d.v.y = Math.abs(d.v.y) > 1.5 ? Math.abs(d.v.y) * 0.4 : 0;
        d.spin.multiplyScalar(0.4);
        if (d.v.lengthSq() < 0.5) {
          d.v.set(0, 0, 0);
          d.spin.set(0, 0, 0);
          d.mesh.rotation.x = Math.round(d.mesh.rotation.x / Math.PI) * Math.PI;
          d.mesh.rotation.z = Math.round(d.mesh.rotation.z / Math.PI) * Math.PI;
        }
      }
    }
    // The sock lifting and falling in the breeze
    if (this.windsock) this.windsock.rotation.z = Math.sin(this.beatT * 0.9) * 0.05;
  }

  // --------------------------------------------------------------- gunfire

  /** The men on the car: bursts into it, through the glass in front of him when he's in it. */
  private updateGunmen(dt: number): void {
    const civicPos = this.civicRig.group.position;
    for (const e of [...this.officers, ...this.guards]) {
      if (!e.alive) continue;
      e.setAiming(true);
      let cd = (this.fireCd.get(e) ?? 1) - dt;
      if (cd <= 0) {
        let b = this.burst.get(e) ?? 0;
        if (b <= 0) b = 3 + Math.floor(Math.random() * 4);
        b--;
        this.burst.set(e, b);
        cd = b > 0 ? 0.11 : 0.5 + Math.random() * 0.7;
        this.shoot(e, civicPos);
      }
      this.fireCd.set(e, cd);
    }
  }

  private shoot(e: Enemy, at: THREE.Vector3): void {
    const { audio } = this.ctx;
    const muzzle = e.muzzleWorld(new THREE.Vector3());
    e.flashMuzzle();
    audio.enemyGunshot(this.camera.position.distanceTo(muzzle));
    this.particles.muzzleFlash(muzzle, RunwayScene.tmpA.copy(at).sub(muzzle).normalize());
    const pov = this.shotKey.startsWith('pov');
    if (pov) {
      // As he sees it: the glass in front of him, or the bonnet
      const glass = this.cracks < 9 && (this.cracks === 0 || Math.random() < 0.16);
      const sx = glass ? 0.25 + Math.random() * 0.6 : 0.2 + Math.random() * 0.6;
      const sy = glass ? 0.25 + Math.random() * 0.3 : 0.72 + Math.random() * 0.15;
      const ndc = RunwayScene.tmpB.set(sx * 2 - 1, -(sy * 2 - 1), 0.5).unproject(this.camera);
      const ray = ndc.sub(this.camera.position).normalize();
      const hit = RunwayScene.tmpC.copy(this.camera.position).addScaledVector(ray, glass ? 0.9 : 1.7);
      this.particles.tracer(muzzle, hit, 0xffe0b0);
      if (glass) {
        this.cracks++;
        this.crack(sx, sy);
        audio.ricochet(1);
      } else {
        // Six of them firing: a spark off the bonnet now and then, not every round
        if (Math.random() < 0.35) this.particles.sparks(hit, RunwayScene.tmpA.set(0, 0.2, 0), 2);
        audio.ricochet(2);
      }
      this.shake = Math.min(1, this.shake + 0.1);
    } else {
      const hit = RunwayScene.tmpC.copy(at).add(RunwayScene.tmpB.set((Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.9, (Math.random() - 0.5) * 3));
      this.particles.tracer(muzzle, hit, 0xffe0b0);
      if (Math.random() < 0.4) this.particles.sparks(hit, RunwayScene.tmpA.set(0, 0.3, 0), 3);
    }
  }

  // ------------------------------------------------------------------- van

  /**
   * Set the van off along `path` at `v0`, wanting the speed `want` gives at
   * each point (`left` metres from the end), getting there no harder than
   * `accel` and `brake` allow; with `stops`, it comes to rest at the end.
   */
  private startVan(path: THREE.Vector3[], v0: number, want: (s: number, left: number) => number, accel: number, brake: number, stops = true): void {
    this.vanPath = path;
    this.vanLen = pathLength(path);
    this.vanS = 0;
    this.vanV = v0;
    this.vanWant = want;
    this.vanAccel = accel;
    this.vanBrake = brake;
    this.vanStops = stops;
    this.vanMoving = true;
    this.vanStoppedAt = -1;
    this.van.group.visible = true;
    this.vanOnPath(v0, 0);
    this.vanPrev.copy(this.van.group.position);
  }

  private vanStops = true;

  private updateVan(dt: number): void {
    if (!this.vanMoving) return;
    const left = this.vanLen - this.vanS;
    let want = this.vanWant(this.vanS, left);
    if (this.vanStops) want = Math.min(want, Math.sqrt(2 * this.vanBrake * 0.8 * Math.max(0, left)));
    const v0 = this.vanV;
    this.vanV = want > v0 ? Math.min(want, v0 + this.vanAccel * dt) : Math.max(want, v0 - this.vanBrake * dt);
    this.vanS = Math.min(this.vanLen, this.vanS + this.vanV * dt);
    if (this.vanStops && left < 0.1 && this.vanStoppedAt < 0) {
      this.vanStoppedAt = this.beatT;
      this.vanV = 0;
      this.vanMoving = false;
    }
    if (!this.vanStops && this.vanS >= this.vanLen) this.vanMoving = false;
    this.vanOnPath(this.vanV, dt, this.vanV < v0 - 0.05 && this.vanV > 1);
    if (dt > 0) this.vanVel.subVectors(this.van.group.position, this.vanPrev).divideScalar(dt);
    this.vanPrev.copy(this.van.group.position);
    this.vanEngine?.setSpeed(this.vanV, this.vanV > v0 ? 0.95 : 0.25);
    this.vanEngine?.setGain(Math.max(0.15, 1 - this.camera.position.distanceTo(this.van.group.position) / 90));
  }

  /** The van along its path at vanS: nose along it, wheels turning, the body dipping under the brakes and leaning in the turn. */
  private vanOnPath(v: number, dt: number, braking = false): void {
    const g = this.van.group;
    const dir = RunwayScene.tmpB;
    alongPath(this.vanPath, this.vanS, g.position, dir);
    const yaw = Math.atan2(-dir.x, -dir.z);
    const turn = dt > 0 ? wrapAngle(yaw - g.rotation.y) : 0;
    g.rotation.y = dt > 0 ? g.rotation.y + turn * Math.min(1, dt * 7) : yaw;
    for (const w of this.van.wheels) w.rotation.x -= (v * dt) / 0.39;
    const b = this.van.body;
    const k = Math.min(1, dt * 6);
    b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, braking ? -0.04 : 0, k);
    b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, dt > 0 ? THREE.MathUtils.clamp((turn / dt) * v * -0.004, -0.07, 0.07) : 0, k);
    this.van.brakelights.emissiveIntensity = braking ? 2.4 : 0.25;
    if (braking && v > 6) {
      for (const sx of [-0.9, 0.9]) {
        const p = RunwayScene.tmpC.set(sx, 0.3, 2.6).applyMatrix4(g.matrixWorld);
        this.particles.tyreSmoke(p, RunwayScene.tmpA.copy(dir).negate(), 0.7);
      }
    }
  }

  /** The van on the highway for the montage, riding and swaying a little. */
  private placeVanOnHighway(t: number, dt: number): void {
    const pos: RoadPos = { road: 'highway', s: this.montageS, d: MONTAGE_LANE };
    const g = this.van.group;
    this.net.point(pos, g.position);
    const f = this.net.sample('highway', this.montageS).tangent;
    g.rotation.y = Math.atan2(-f.x, -f.z);
    const b = this.van.body;
    b.position.y = 0.39 + Math.sin(t * 7.3) * 0.008 + Math.sin(t * 3.1) * 0.006;
    b.rotation.z = Math.sin(t * 1.7) * 0.012;
    b.rotation.x = Math.sin(t * 2.3) * 0.006;
    for (const w of this.van.wheels) w.rotation.x -= (26 * dt) / 0.39;
  }

  /** Van frame → world, through its body (riding with it). */
  private vanWorld(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.van.body;
    b.updateWorldMatrix(true, false);
    return out.set(p.x, p.y - b.position.y, p.z).applyMatrix4(b.matrixWorld);
  }

  /** How far along a path its nearest point to `p` is. */
  private sOnPath(path: THREE.Vector3[], p: THREE.Vector3): number {
    let best = 0;
    let bd = Infinity;
    const len = pathLength(path);
    const q = new THREE.Vector3();
    for (let s = 0; s <= len; s += 0.5) {
      alongPath(path, s, q);
      const d = q.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  // --------------------------------------------------------------- walking

  /** Walk `e` through `pts` (a leg that changes height is a step up or down), turning to `face` at the end. */
  private walk(e: Enemy, pts: THREE.Vector3[], speed: number, face?: THREE.Vector3, done?: () => void, backLast = false): void {
    const legs = this.legTimes(pts, speed, this.van.group.position.y + 0.5);
    this.walks.set(e, { pts: pts.map((p) => p.clone()), legT: legs.t, steps: legs.step, total: legs.t.reduce((a, b) => a + b, 0), t: 0, face: face?.clone(), done, backLast, stepPosed: false });
    this.faceGoal.delete(e);
  }

  /**
   * How long each leg of a walk takes: a step up or down (a short leg that
   * changes height) its fixed time; on the flat, its length at `speed` — or
   * at the slower pace inside the van, for a leg up off the ground (above
   * `insideAbove`).
   */
  private legTimes(pts: THREE.Vector3[], speed: number, insideAbove: number): { t: number[]; step: number[] } {
    const t: number[] = [];
    const step: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const flat = Math.hypot(b.x - a.x, b.z - a.z);
      const dy = b.y - a.y;
      if (Math.abs(dy) > 0.12 && flat < 0.9) {
        t.push(dy > 0 ? STEP_UP : STEP_DOWN);
        step.push(Math.sign(dy));
      } else {
        t.push(Math.max(0.05, flat / (Math.min(a.y, b.y) > insideAbove ? Math.min(speed, WALK_IN) : speed)));
        step.push(0);
      }
    }
    return { t, step };
  }

  /**
   * Where a walk is `t` seconds in (into `out`): on the flat straight along
   * the leg; a step up rises late in it (the foot's up on the step first, then
   * the weight goes onto it), a step down drops in the middle of it.
   */
  private alongTimed(pts: THREE.Vector3[], legT: number[], steps: number[], t: number, out: THREE.Vector3): { leg: number; u: number; step: number; dir: THREE.Vector3 } {
    let i = 0;
    let t0 = 0;
    while (i < legT.length - 1 && t > t0 + legT[i]) {
      t0 += legT[i];
      i++;
    }
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const u = clamp01((t - t0) / (legT[i] || 1));
    const step = steps[i] ?? 0;
    const k = step ? smooth(u) : u;
    out.lerpVectors(a, b, k);
    if (step > 0) out.y = a.y + (b.y - a.y) * smooth(clamp01((u - 0.28) / 0.6));
    else if (step < 0) out.y = a.y + (b.y - a.y) * smooth(clamp01((u - 0.2) / 0.6));
    const dir = RunwayScene.tmpB.subVectors(b, a).setY(0);
    if (dir.lengthSq() > 1e-8) dir.normalize();
    return { leg: i, u, step, dir };
  }

  private updateWalks(dt: number): void {
    for (const [e, w] of this.walks) {
      w.t = Math.min(w.total, w.t + dt);
      const r = this.alongTimed(w.pts, w.legT, w.steps, w.t, e.position);
      const last = r.leg === w.legT.length - 1;
      // Facing the way he goes — except backing onto a bench at the end, already turned to sit
      if (w.backLast && last && w.face) e.faceToward(w.face, dt, 8);
      else if (r.dir.lengthSq() > 1e-6) e.faceToward(RunwayScene.tmpC.copy(e.position).add(r.dir), dt, 7);
      if (r.step) {
        // A step: the leading knee comes up (and reaches down, going down), the other leg bends
        // to lower him or push him up, and follows; leading with alternate legs, step to step
        const u = r.u;
        const up = r.step > 0;
        const lead = up ? 0.9 * Math.sin(Math.PI * clamp01(u / 0.72)) : 0.38 * Math.sin(Math.PI * clamp01(u / 0.75));
        const trail = up ? 0.65 * Math.sin(Math.PI * clamp01((u - 0.42) / 0.58)) : 0.48 * Math.sin(Math.PI * clamp01((u - 0.4) / 0.6));
        const crouch = up ? 0.18 * Math.sin(Math.PI * clamp01(u / 0.6)) : 0.24 * Math.sin(Math.PI * clamp01(u / 0.85));
        const right = r.leg % 2 === 0;
        e.pose = { liftR: right ? lead : trail, liftL: right ? trail : lead, crouch, lean: (up ? 0.24 : 0.12) * Math.sin(Math.PI * u) };
        w.stepPosed = true;
        e.setWalk(0);
      } else {
        if (w.stepPosed) {
          e.pose = null;
          w.stepPosed = false;
        }
        e.setWalk(w.t < w.total ? (w.backLast && last ? 0.25 : 0.6) : 0);
      }
      e.cadence = 1;
      if (w.t >= w.total) {
        this.walks.delete(e);
        if (w.stepPosed) e.pose = null;
        e.setWalk(0);
        if (w.face) this.faceGoal.set(e, w.face);
        w.done?.();
      }
    }
    // Stopped, they turn to whatever they're looking at
    for (const [e, goal] of this.faceGoal) if (!this.walks.has(e)) e.faceToward(goal, dt, 5);
    this.updateBench(dt);
  }

  /**
   * Getting up off the bench and sitting back down on it: hands on the thighs
   * and a lean into it to get up; a lean and a hand back down to sit.
   */
  private updateBench(dt: number): void {
    for (const [e, m] of this.benchMove) {
      m.t += dt;
      const t = m.t;
      if (m.up) {
        const lean = 0.42 * Math.sin(Math.PI * clamp01(t / 0.75));
        e.pose = t < 0.42 ? { ...SEATED_HANDS(), lean } : t < 0.75 ? { lean } : null;
        if (t >= 0.75) this.benchMove.delete(e);
      } else {
        const lean = 0.3 * Math.sin(Math.PI * clamp01(t / 0.8));
        e.pose = t < 0.35 ? { lean } : { ...SEATED_HANDS(), lean };
        if (t >= 0.8) {
          e.pose = SEATED_HANDS();
          this.benchMove.delete(e);
        }
      }
    }
  }

  /** Up off the bench onto his feet, where he sits. */
  private standUp(e: Enemy): void {
    e.setSitting(false);
    this.benchMove.set(e, { t: 0, up: true });
  }

  /** Where everyone stands once they're out, and his own way out of the car and round to them, now the van has stopped. */
  private planExit(): void {
    const v = this.van;
    const gy = v.group.position.y;
    const off = (x: number, z: number): THREE.Vector3 => this.vanWorld(new THREE.Vector3(v.width / 2 + x, 0, v.doorIn.z + z)).setY(gy);
    this.raviAt.copy(off(...RAVI_OFF));
    this.crew.forEach((e, i) => this.standAt.set(e, off(...CREW_OFF[i])));
    const c = this.civicRig.group;
    c.updateMatrixWorld(true);
    const L = (x: number, z: number): THREE.Vector3 => new THREE.Vector3(x, 1.64, z).applyMatrix4(c.matrixWorld);
    this.raviPath = [L(-1.45, 0.15), L(-1.35, -2.45), L(0.2, -3.25), this.raviAt.clone().setY(gy + 1.64)];
    const legs = this.legTimes(this.raviPath, 1.6, gy + 99);
    this.raviLegT = legs.t;
    this.raviSteps = legs.step;
    this.raviT0 = legs.t.reduce((a, b) => a + b, 0);
  }

  private raviSteps: number[] = [];

  /** His eyes `t` seconds along his own walk: a step's bob in them, and a dip at a step up or down. */
  private raviAlong(t: number): void {
    const r = this.alongTimed(this.raviPath, this.raviLegT, this.raviSteps, t, this.standEye);
    if (t >= this.raviT0) return;
    if (r.step) this.standEye.y -= (r.step > 0 ? 0.07 : 0.1) * Math.sin(Math.PI * r.u);
    else this.standEye.y += 0.012 - Math.abs(Math.sin(t * Math.PI * 1.85)) * 0.026;
  }

  /** From his place on the bench, out of the van's frame into the world's: down the aisle, out of the door and down the steps, round to his place. */
  private walkOut(e: Enemy): void {
    const v = this.van;
    const place = this.seatOf.get(e)!;
    const side = Math.sign(place.at.x) || 1;
    const F = v.floorY;
    const at = this.vanWorld(place.at);
    this.scene.add(e.root);
    e.position.copy(at);
    e.yaw = wrapAngle(v.group.rotation.y + place.yaw);
    e.root.rotation.y = e.yaw;
    const pts = [
      at,
      this.vanWorld(new THREE.Vector3(side * 0.22, F, place.at.z)),
      this.vanWorld(new THREE.Vector3(0.22, F, v.doorIn.z + 0.45)),
      this.vanWorld(v.doorIn),
      this.vanWorld(v.doorSill),
      this.vanWorld(v.doorStep),
      this.vanWorld(v.doorOut),
      this.standAt.get(e)!.clone()
    ];
    this.walk(e, pts, WALK, this.raviAt);
  }

  /** Is he still on the van's floor, on his way out? */
  private walksInside(e: Enemy): boolean {
    const w = this.walks.get(e);
    return !!w && e.position.y > this.van.group.position.y + 0.3;
  }

  /** From where he stands, up the steps into the van and along the aisle to his place; turned, back onto the bench, and down. */
  private walkIn(e: Enemy): void {
    // Eyes on where he's going now
    e.setHeadLook(null);
    const v = this.van;
    const place = this.seatOf.get(e)!;
    const side = Math.sign(place.at.x) || 1;
    const F = v.floorY;
    const across = this.vanWorld(new THREE.Vector3(-side * 1.5, F, place.at.z));
    const pts = [
      e.position.clone(),
      this.vanWorld(v.doorOut),
      this.vanWorld(v.doorStep),
      this.vanWorld(v.doorSill),
      this.vanWorld(v.doorIn),
      this.vanWorld(new THREE.Vector3(0.22, F, v.doorIn.z + 0.45)),
      this.vanWorld(new THREE.Vector3(side * 0.22, F, place.at.z)),
      this.vanWorld(place.at)
    ];
    this.walk(e, pts, WALK, across, () => this.seatIn(e, place.at, place.yaw, false), true);
  }

  // ---------------------------------------------------------------- camera

  private updateCamera(dt: number): void {
    const cam = this.camera;
    const t = this.beatT;
    let key = '';
    let fov = 70;
    let roll = 0;
    const civic = this.civicRig.group;
    const fromCar = (x: number, y: number, z: number): THREE.Vector3 => RunwayScene.tmpB.set(x, y, z).applyMatrix4(civic.matrixWorld);
    const vp = this.van.group.position;
    switch (this.beat) {
      case 'pinned': {
        if (t < 2.8) {
          // Low behind the Civic: the jet away down the runway, lifting, gone
          key = 'runway';
          this.eye.copy(this.apt(377.5, 64.5)).setY(1.15);
          const jet = RunwayScene.tmpC.copy(this.jet.group.position);
          jet.y += 2;
          this.aim(jet.lerp(RunwayScene.tmpA.copy(civic.position).setY(1), 0.25), dt, key !== this.shotKey, 5);
          fov = 46;
        } else if (t < 4.4) {
          // His eyes, after it as it climbs, and back to the men on the car
          key = 'pov-jet';
          this.eye.copy(this.seatEye(RunwayScene.tmpA));
          const jet = RunwayScene.tmpC.copy(this.jet.group.position).setY(this.jet.group.position.y + 2);
          const fwd = fromCar(-0.37, 1.0, -12);
          const k = 1 - smooth((t - 3.5) / 0.8);
          this.aim(fwd.lerp(jet, k), dt, key !== this.shotKey, 6);
          fov = 64;
        } else if (t < 6.2) {
          // Outside: behind the security team, firing on the car
          key = 'gunline';
          this.eye.copy(this.apt(405, 47)).setY(1.5);
          this.aim(RunwayScene.tmpC.copy(civic.position).setY(1.1), dt, key !== this.shotKey, 8);
          fov = 52;
        } else {
          // Back in his seat, flinching from the glass, eyes on the men closing in
          key = 'pov-duck';
          this.eye.copy(this.seatEye(RunwayScene.tmpA));
          const flinch = Math.sin(t * 13) * 0.04 * (1 - smooth((t - 6.2) / 2));
          this.aim(fromCar(-0.37 + flinch, 0.7, -12), dt, key !== this.shotKey, 8);
          fov = 66;
        }
        break;
      }
      case 'van': {
        // His eyes, through the glass: it comes in off the apron, through the two men and the boom, straight at
        // him through the security team, and round, broadside, to a stop across his front. His head goes with it,
        // a little behind it, and back a touch as it comes at him
        key = 'pov-van';
        this.eye.copy(this.seatEye(RunwayScene.tmpA));
        const tgt = RunwayScene.tmpC.copy(vp).setY(vp.y + 1.3);
        tgt.lerp(fromCar(-0.37, 1.0, -12), 0.18);
        this.aim(tgt, dt, false, 3.2);
        fov = 66 + 6 * smooth(clamp01((this.vanS - this.gateS + 6) / 8));
        break;
      }
      case 'exit': {
        key = 'pov-out';
        this.eye.copy(this.standEye);
        // At the door as he gets out of the car; then at the van's door, and whoever's coming out of it
        const look = RunwayScene.tmpC;
        if (t < 1.2) look.copy(fromCar(-3.2, 1.45, -2.2));
        else {
          const out = this.crew.find((e) => this.walks.has(e) && e.root.parent !== this.van.body);
          if (out) look.copy(out.position).setY(out.position.y + 1.35);
          else this.vanWorld(this.van.doorSill, look).setY(this.van.group.position.y + 1.4);
          if (this.crew.every((e) => !this.walks.has(e) && e.root.parent !== this.van.body)) look.copy(this.sanjay.position).setY(this.sanjay.position.y + 1.55);
        }
        this.aim(look, dt, key !== this.shotKey, 2.6);
        fov = 70;
        break;
      }
      case 'talk1':
      case 'talk2':
      case 'badge': {
        key = 'pov-stand';
        this.eye.copy(this.standEye);
        const tgt = RunwayScene.tmpC.copy(this.sanjay.position).setY(this.sanjay.position.y + 1.55);
        // A little down at the badge while it's up
        if (this.beat === 'badge') tgt.y -= 0.1 * track([[0.6, 0], [1.4, 1], [8.6, 1], [9.4, 0]], t);
        this.aim(tgt, dt, key !== this.shotKey, 4);
        fov = this.beat === 'badge' ? 70 - 16 * track([[1.6, 0], [2.6, 1], [8.3, 1], [9.2, 0]], t) : 70;
        break;
      }
      case 'board': {
        key = 'pov-board';
        this.eye.copy(this.standEye);
        const v = this.van;
        const F = v.floorY;
        let tgt: THREE.Vector3;
        const going = this.raviStart >= 0 ? t - this.raviStart : -1;
        if (going < 0) {
          // Watching them up the steps and in, one after another
          const e = this.crew.find((c) => this.walks.has(c));
          tgt = e ? RunwayScene.tmpC.copy(e.position).setY(e.position.y + 1.1) : this.vanWorld(RunwayScene.tmpC.copy(v.doorIn).setY(F + 1.0));
        } else if (going < this.raviLegT.slice(0, 3).reduce((a, b) => a + b, 0)) tgt = this.vanWorld(RunwayScene.tmpC.set(-0.4, F + 1.2, v.doorIn.z + 0.3));
        else if (going < this.raviT0 - 1.0) tgt = this.vanWorld(RunwayScene.tmpC.set(-0.35, F + 1.3, v.seats.left[0].z - 1.4));
        else tgt = this.vanWorld(RunwayScene.tmpC.set(1.6, F + 1.1, v.seats.left[0].z + 0.6));
        this.aim(tgt, dt, false, 3);
        fov = 72;
        break;
      }
      case 'leave': {
        // Low by the Civic left standing: the van pulls round and away down the approach road
        key = 'leave';
        this.eye.copy(this.apt(383.2, 63.4)).setY(0.95);
        this.aim(RunwayScene.tmpC.copy(vp).setY(1.5), dt, key !== this.shotKey, 4);
        fov = 50;
        break;
      }
      case 'montage':
      case 'end': {
        const m = this.montageShot(t);
        key = m.key;
        this.eye.copy(m.eye);
        // Inside, the look rides with the van (eased in the world, it'd fall behind at 26 m/s)
        this.aim(m.look, dt, key !== this.shotKey || !m.world, m.follow);
        fov = m.fov;
        roll = m.roll;
        break;
      }
    }
    const inCivic = key === 'pov-jet' || key === 'pov-duck' || key === 'pov-van';
    if (this.crackCanvas && this.beat !== 'exit') this.crackCanvas.style.opacity = inCivic ? '1' : '0';
    if (this.driver && this.beat !== 'montage' && this.beat !== 'end') {
      const head = this.driver.bones.get('head');
      if (head) head.scale.setScalar(inCivic || this.beat === 'exit' ? 0.001 : 1);
    }
    this.shotKey = key;
    cam.position.copy(this.eye);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const s = this.shake * (inCivic ? 0.04 : 0.1);
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.lookAt);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(this.fov - fov) > 0.01 || Math.abs(cam.fov - fov) > 0.01) {
      this.fov += (fov - this.fov) * Math.min(1, dt * 5);
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Swing the look onto `tgt` (snap on a cut). */
  private aim(tgt: THREE.Vector3, dt: number, snap: boolean, rate: number): void {
    if (snap) this.lookAt.copy(tgt);
    else this.lookAt.lerp(tgt, Math.min(1, dt * rate));
  }

  /**
   * The montage's shots, in van frame (nose −Z, its right +X, floor at
   * floorY) — or, outside, fixed in the world (`world`) or riding along.
   * `roll` tips the frame.
   */
  private montageShot(t: number): { key: string; eye: THREE.Vector3; look: THREE.Vector3; fov: number; follow: number; roll: number; world?: boolean } {
    const v = this.van;
    const fy = v.floorY;
    const W = (x: number, y: number, z: number): THREE.Vector3 => this.vanWorld(new THREE.Vector3(x, y, z));
    const key = this.shotAt(t);
    const r = this.driver;
    const pov = key === 'm-load';
    if (r) {
      r.root.visible = !pov;
      const head = r.bones.get('head');
      if (head) head.scale.setScalar(pov ? 0.001 : 1);
    }
    const ravi = v.seats.left[0];
    const raviEye = (): THREE.Vector3 => W(ravi.x + 0.12, fy + 1.24, ravi.z - 0.05);
    const seat = (e: Enemy): THREE.Vector3 => this.seatOf.get(e)!.at;
    const [sanjay, dev, s0, s1] = this.crew;
    const vpos = v.group.position;
    const fwd = RunwayScene.tmpA.set(0, 0, -1).applyQuaternion(v.group.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(v.group.quaternion);
    switch (key) {
      case 'm-sunset': {
        // Low on the shoulder: the van roars past and away, into the last of the sun
        if (this.shotKey !== key) this.fixedCam.copy(vpos).addScaledVector(fwd, 16).addScaledVector(right, -3.2).setY(vpos.y + 0.55);
        return { key, eye: this.fixedCam, look: RunwayScene.tmpC.copy(vpos).setY(vpos.y + 1.6), fov: 44, follow: 6, roll: -0.05, world: true };
      }
      case 'm-wide': {
        // From the back doors, pushing slowly in down the aisle
        const k = (t - 3) / 2.4;
        return { key, eye: W(0.1, fy + 1.75, 3.6 - k * 0.6), look: W(0, fy + 1.05, -2.8), fov: 64, follow: 8, roll: 0 };
      }
      case 'm-rack': {
        // Tight on the rack as a rifle comes off it
        return { key, eye: W(0.05, fy + 1.55, 1.75), look: W(1.1, fy + 1.45, 2.6), fov: 46, follow: 20, roll: 0.06 };
      }
      case 'm-vest': {
        // Low, looking up at Sanjay
        const s = seat(sanjay);
        return { key, eye: W(-0.05, fy + 0.62, s.z - 0.7), look: W(s.x - 0.05, fy + 1.15, s.z), fov: 56, follow: 20, roll: 0.14 };
      }
      case 'm-helmets': {
        // Down the aisle between the two of them
        const a = seat(s0);
        const b = seat(s1);
        const z = (a.z + b.z) / 2;
        return { key, eye: W(0.0, fy + 1.3, z - 1.4), look: W(0, fy + 1.2, z + 0.3), fov: 58, follow: 20, roll: -0.08 };
      }
      case 'm-load': {
        // His own eyes: the AK, loaded
        return { key, eye: raviEye(), look: W(0.4, fy + 0.85, ravi.z + 0.3), fov: 68, follow: 20, roll: 0 };
      }
      case 'm-grenade': {
        // Dev, with a grenade, the pistols on the wall behind him
        const d = seat(dev);
        return { key, eye: W(0.35, fy + 1.3, d.z - 0.3), look: W(d.x + 0.12, fy + 1.15, d.z - 0.05), fov: 46, follow: 20, roll: 0.05 };
      }
      case 'm-drone': {
        // High and behind, riding with it: the highway, the city, the sun going down ahead
        return { key, eye: W(-5, 15, 24), look: W(0, 1, -30), fov: 55, follow: 20, roll: 0 };
      }
      case 'm-red': {
        // In the red work light, slowly along their faces
        const k = (t - 19.4) / 2.4;
        return { key, eye: W(-0.35, fy + 1.3, -0.2 + k * 1.6), look: W(0.7, fy + 1.25, 0.5 + k * 2.4), fov: 50, follow: 20, roll: 0.1 };
      }
      case 'm-bump': {
        // Side on, close: knuckles across the aisle
        const z = (seat(dev).z + seat(sanjay).z) / 2;
        return { key, eye: W(0.05, fy + 1.12, z - 1.05), look: W(0, fy + 1.02, z), fov: 48, follow: 20, roll: 0 };
      }
      case 'm-ready': {
        // From up by the cab, looking back down the bay: all of them armed; a slow push and a lean
        const k = (t - 23.8) / 3;
        return { key, eye: W(-0.1, fy + 1.62, -1.75 + k * 0.5), look: W(0, fy + 1.0, 3.2), fov: 62, follow: 20, roll: -0.06 - 0.04 * k };
      }
      default: {
        // Leant up between the front seats, out of the screen: the sun gone down ahead, the city's lights coming
        const k = (t - 26.8) / 3.2;
        return { key, eye: W(0.2, fy + 1.38, -1.95 - k * 0.2), look: W(-0.05, fy + 1.0, -9), fov: 60, follow: 20, roll: 0 };
      }
    }
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
    this.particles.bloodSpray(far, up, true, -61);
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

/** The yaw that faces from `from` to `to`. */
function faceFrom(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}
