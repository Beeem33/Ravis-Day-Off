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
 * Then a horn, and a big grey van comes down the taxiway flat out and
 * through every one of them, skids round on the runway and comes back up
 * beside him. He gets out; his coworkers pile out of it. Sanjay has been
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
 * The van's run: down the taxiway past the Civic, through the security team
 * and the boss's two men; on the brakes and round in a skid on the runway;
 * and back up the far side of the taxiway to pull up on the Civic's right.
 */
const VAN_RUN: [number, number][] = [
  [300, 67], [350, 67.5], [372, 67], [384, 64.5], [392, 59.5], [400, 52.5], [408, 44], [415, 36.5],
  [422, 30.5], [430, 26.5], [438, 28], [442.5, 34], [441.5, 42], [436, 50], [426, 57], [414, 62], [403, 64.4], [395, 64.8], [388.7, 64.8]
];
/** Where on the run it brakes for the turn, where it comes out of it, and where the cut back to Ravi comes. */
const TURN_IN: [number, number] = [422, 30.5];
const TURN_OUT: [number, number] = [436, 50];
const BACK_AT: [number, number] = [414, 62];
/** Where the security team and the two men walk up to as they close in on the car, all of them in the van's way. */
const OFFICER_TO: [number, number][] = [[399, 53.4], [395, 57], [391, 60.2], [387.5, 62.8]];
const GUARD_TO: [number, number][] = [[408.8, 43.2], [414.2, 37.4]];
/** Ravi, out of the car and round its nose, facing the van's door; his coworkers round him in an arc (Sanjay first). */
const RAVI_AT: [number, number] = [387.1, 60.0];
const CREW_AT: [number, number][] = [[387.4, 61.5], [385.9, 61.9], [388.9, 61.95], [385.0, 62.55], [389.9, 62.6], [384.3, 61.7], [390.8, 61.7]];
/** The way out: back the way it came, down the taxiway. */
const VAN_AWAY: [number, number][] = [[388.7, 64.8], [380, 65.5], [360, 67], [330, 67.3], [280, 67]];
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
  /** Route s along the van's run: of each man in its way, and of the turn. */
  private readonly hitS = new Map<Enemy, number>();
  private turnS0 = 0;
  private turnS1 = 0;
  private backS = 0;
  private gateDown = false;
  private montageS = MONTAGE_S0;

  // ---- The people on foot
  private readonly walks = new Map<Enemy, { pts: THREE.Vector3[]; len: number; s: number; speed: number; face?: THREE.Vector3; done?: () => void }>();

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
    this.turnS0 = this.sOnPath(run, this.apt(...TURN_IN));
    this.turnS1 = this.sOnPath(run, this.apt(...TURN_OUT));
    this.backS = this.sOnPath(run, this.apt(...BACK_AT));
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
    this.crew = [this.sanjay, this.dev, mk('STAFF', 9), mk('STAFF', 15), mk('STAFF', 17), mk('STAFF', 21), mk('STAFF', 24)];
    // Right bench: Sanjay and three; left: Dev beside Ravi and two more
    const places: { at: THREE.Vector3; yaw: number }[] = [
      { at: v.seats.right[0], yaw: Math.PI / 2 },
      { at: v.seats.left[1], yaw: -Math.PI / 2 },
      { at: v.seats.right[1], yaw: Math.PI / 2 },
      { at: v.seats.left[2], yaw: -Math.PI / 2 },
      { at: v.seats.right[2], yaw: Math.PI / 2 },
      { at: v.seats.left[3], yaw: -Math.PI / 2 },
      { at: v.seats.right[3], yaw: Math.PI / 2 }
    ];
    this.crew.forEach((e, i) => this.seatOf.set(e, places[i]));
    this.wheelman = mk('STAFF', 13);
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

  /** Sat on the van's seat at `at` (van frame), turned `yaw`, riding with it. */
  private seatIn(e: Enemy, at: THREE.Vector3, yaw: number): void {
    this.van.body.add(e.root);
    e.position.set(at.x, at.y - this.van.body.position.y, at.z);
    e.yaw = yaw;
    e.root.rotation.y = yaw;
    e.setWalk(0);
    e.setSitting(true, true);
    e.root.visible = true;
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
      const k = clamp01((t - 0.6) / 5.2);
      e.position.lerpVectors(from, to, smooth(k));
      e.setWalk(k > 0 && k < 1 ? 0.55 : 0);
      e.cadence = 1;
      e.faceToward(this.civicRig.group.position, dt, 6);
    }
    // The van, on its way: flat out through them, round on the runway, and back up to him
    if (t > 6.5 && !this.vanMoving) {
      const t0 = this.turnS0;
      this.startVan(
        this.vanPath,
        28,
        (s, left) => (s < t0 - 14 ? 28 : s < t0 ? THREE.MathUtils.lerp(28, 11, (s - t0 + 14) / 14) : s < this.turnS1 ? 10.5 : Math.min(17, Math.sqrt(2 * 6.5 * Math.max(0, left)))),
        7,
        16
      );
    }
    if (t > 6.8 && t - dt <= 6.8) this.ctx.audio.horn(70);
    if (t > 7.6 && t - dt <= 7.6) this.ctx.audio.horn(45);
    if (t > 8.2) this.setBeat('van');
  }

  /** The van's run: who it goes through, the skid round, and back to him. */
  private updateVanRun(dt: number): void {
    const t = this.beatT;
    if (this.vanS > this.turnS0 - 4 && this.vanS - this.vanV * dt <= this.turnS0 - 4) {
      this.ctx.audio.tyreSqueal(1.6, this.camera.position.distanceTo(this.van.group.position));
    }
    // The gate's boom, if it's in the way
    if (!this.gateDown && this.van.group.position.distanceTo(this.airside.gate.pos) < 9) {
      this.gateDown = true;
      this.ctx.audio.carCrash(this.camera.position.distanceTo(this.airside.gate.pos), false);
      this.particles.sparks(this.airside.gate.pos.clone().setY(1), RunwayScene.tmpA.set(0, 1, 0), 24);
    }
    if (this.gateDown) {
      const arm = this.airside.gateArm;
      arm.rotation.z = Math.min(1.45, arm.rotation.z + dt * 9);
    }
    // Round the turn, smoke off all four
    if (this.vanS > this.turnS0 && this.vanS < this.turnS1) {
      const g = this.van.group;
      for (const [x, z] of [[-1, 2.6], [1, 2.6], [-1, -2.9], [1, -2.9]]) {
        const p = RunwayScene.tmpC.set(x, 0.3, z).applyMatrix4(g.matrixWorld);
        this.particles.tyreSmoke(p, RunwayScene.tmpA.set(0, 0.4, 0), 1.1);
      }
    }
    this.runOver();
    if (this.vanStoppedAt >= 0 && t - this.vanStoppedAt > 0.5) this.setBeat('exit');
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
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(v.group.quaternion).multiplyScalar(Math.sign(p.x || 1) * 4);
      e.launch(this.vanVel.clone().multiplyScalar(0.7).add(side).setY(5 + Math.random() * 2));
      const d = this.camera.position.distanceTo(hitAt);
      this.ctx.audio.bodyThud(d);
      this.ctx.audio.carCrash(d, false);
      this.particles.bloodSpray(hitAt, dir, true, 0);
      this.shake = Math.min(1, this.shake + 0.35);
      // The boss's two men: a beat of slow motion for each
      if (this.guards.includes(e)) this.slowT = 0.75;
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
    civic.setDoor(smooth(t / 0.5));
    if (t > 0.05 && t - 0.02 <= 0.05) this.ctx.audio.carDoor(true, 1);
    if (this.driver) this.driver.root.visible = t < 0.55;
    if (this.crackCanvas && t > 0.6) this.crackCanvas.style.opacity = '0';
    // His eyes: out of the seat and through the door, then round the front
    civic.group.updateMatrixWorld(true);
    const seat = this.seatEye(RunwayScene.tmpA);
    const out = new THREE.Vector3(-1.45, 1.64, 0.15).applyMatrix4(civic.group.matrixWorld);
    const round = [out.clone(), this.apt(386.9, 58.35).setY(1.64), this.apt(387.3, 59.3).setY(1.64), this.apt(...RAVI_AT).setY(1.64)];
    if (t < 0.5) this.standEye.copy(seat);
    else if (t < 1.4) this.standEye.lerpVectors(seat, out, smooth((t - 0.5) / 0.9));
    else {
      const k = smooth((t - 1.4) / 2.2);
      alongPath(round, k * pathLength(round), this.standEye);
      // A step's bob
      this.standEye.y += Math.abs(Math.sin(k * Math.PI * 4)) * 0.025 * (k < 1 ? 1 : 0);
    }
    // The van's door, and out they come
    const v = this.van;
    v.setDoor(smooth((t - 1.0) / 0.9));
    if (t > 1.0 && t - 0.02 <= 1.0) this.ctx.audio.carDoor(true, 4);
    const ravi = this.apt(...RAVI_AT);
    this.crew.forEach((e, i) => {
      if (t < 1.6 + i * 0.38 || this.walks.has(e) || e.root.visible) return;
      e.root.visible = true;
      this.scene.add(e.root);
      e.setSitting(false, true);
      e.pose = null;
      const inside = this.vanWorld(v.doorIn);
      const step = this.vanWorld(v.doorOut);
      e.position.copy(inside);
      this.walk(e, [inside, step, this.apt(...CREW_AT[i])], 2.4, ravi);
    });
    const allOut = this.crew.every((e) => e.root.visible && !this.walks.has(e));
    if (t > 3.7 && allOut) {
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

  /** Back into the van, all of them, him last; the door slides shut and they're away. */
  private updateBoard(): void {
    const t = this.beatT;
    const v = this.van;
    // The furthest seats fill first
    this.crew.forEach((e, i) => {
      const order = [5, 6, 3, 4, 1, 2, 0][i];
      if (t < 0.15 + order * 0.26 || this.walks.has(e) || e.root.parent === v.body) return;
      const place = this.seatOf.get(e)!;
      const step = this.vanWorld(v.doorOut);
      const inside = this.vanWorld(v.doorIn);
      const aisle = this.vanWorld(new THREE.Vector3(0, v.floorY, place.at.z));
      this.walk(e, [e.position.clone(), step, inside, aisle], 3, undefined, () => this.seatIn(e, place.at, place.yaw));
    });
    // Him: to the door, up and in, and down onto the bench up by the cab
    const ravi = this.apt(...RAVI_AT).setY(1.64);
    const step = this.vanWorld(v.doorOut).setY(1.64);
    const inside = this.vanWorld(RunwayScene.tmpB.copy(v.doorIn).setY(v.floorY + 1.55));
    const seat = this.vanWorld(RunwayScene.tmpC.copy(v.seats.left[0]).add(new THREE.Vector3(0.12, 1.22, -0.05)));
    if (t < 3.3) this.standEye.copy(ravi);
    else if (t < 4.3) this.standEye.lerpVectors(ravi, step, smooth((t - 3.3) / 1.0));
    else if (t < 4.8) this.standEye.lerpVectors(step, inside, smooth((t - 4.3) / 0.5));
    else this.standEye.lerpVectors(inside, seat, smooth((t - 4.8) / 0.8));
    // The light on in the back; the door shut behind him
    v.light.intensity = THREE.MathUtils.lerp(0, 5, clamp01((t - 3.8) / 0.6));
    v.lamp.emissiveIntensity = v.light.intensity > 0.1 ? 1.4 : 0;
    if (t > 5.7) v.setDoor(1 - smooth((t - 5.7) / 0.8));
    if (t > 5.7 && t - 0.02 <= 5.7) this.ctx.audio.carDoor(false, 1);
    if (t > 6.7) this.setBeat('leave');
  }

  /** Outside, by the car he's leaving: the van pulls away back down the taxiway, and gone. */
  private updateLeave(): void {
    const t = this.beatT;
    if (t < 0.05 && !this.vanMoving) {
      this.startVan(this.aptPath(VAN_AWAY), 0, () => 30, 6, 14, false);
      this.vanEngine?.setGain(1);
      this.ctx.audio.tyreSqueal(0.8, 12);
    }
    if (t > 3.0) this.fadeEl.style.opacity = '1';
    if (t > 4.0) this.startMontage();
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
    const sat = (e: Enemy): void => {
      e.pose = e.armoured && this.armed ? null : SEATED_HANDS();
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

    // Sanjay: arms up and over, the cut, and he's in it, pulling the straps tight
    if (shot === 'm-vest') {
      if (t < 8.1) {
        const k = smooth((t - 7.2) / 0.7);
        const up = (sx: number): THREE.Vector3 => new THREE.Vector3(sx * 0.15, 0.62, -0.3).lerp(new THREE.Vector3(sx * 0.12, 1.62, -0.05), k);
        sanjay.pose = { handR: up(1), handL: up(-1), curl: 0.75 };
      } else {
        const tug = 0.03 * Math.sin((t - 8.1) * 10);
        sanjay.pose = {
          handR: new THREE.Vector3(0.1, 0.93 + tug, -0.19),
          handL: new THREE.Vector3(-0.1, 0.93 - tug, -0.19),
          palmR: new THREE.Vector3(0, 0, 1),
          thumbR: new THREE.Vector3(0, 1, 0),
          palmL: new THREE.Vector3(0, 0, 1),
          thumbL: new THREE.Vector3(0, 1, 0),
          curl: 0.85
        };
      }
    }
    if (cut(8.1)) {
      sanjay.wearCrewKit();
      this.ctx.audio.kickWhoosh();
    }

    // Two across the aisle, helmets on
    if (shot === 'm-helmets') {
      const k = t < 10.6 ? smooth((t - 9.8) / 0.6) : 1 - smooth((t - 10.9) / 0.6);
      for (const e of [s0, s1]) {
        const at = (sx: number): THREE.Vector3 => new THREE.Vector3(sx * 0.15, 0.62, -0.3).lerp(new THREE.Vector3(sx * 0.13, 1.32, 0.0), k);
        e.pose = { handR: at(1), handL: at(-1), palmR: new THREE.Vector3(-1, 0, 0), thumbR: new THREE.Vector3(0, 1, -0.3), palmL: new THREE.Vector3(1, 0, 0), thumbL: new THREE.Vector3(0, 1, -0.3), curl: 0.3 };
      }
    }
    if (cut(10.6)) {
      s0.wearCrewKit();
      s1.wearCrewKit();
      this.ctx.audio.kickWhoosh();
    }

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
    }
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
        e.pose = { handR: new THREE.Vector3(0.15, 0.62, -0.3).lerp(to, k), handL: new THREE.Vector3(-0.15, 0.62, -0.3), curl: 1 };
      }
      if (cut(22.7)) this.ctx.audio.bodyThud(0.6);
    }

    // Everyone armed, rifles between their knees, racking a round one after another
    if (cut(23.8)) {
      this.armed = true;
      for (const e of this.crew) {
        armWithAK(e, true);
        e.setRestCarry(true, true);
        e.pose = null;
      }
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
    for (const at of [24.3, 24.8, 25.3, 25.8, 26.2]) {
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
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(lerpC(0xd08868, 0x3c3450, dusk));
    this.ctx.engine.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 0.92, dusk);
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

  /** Walk `e` along `pts` (a ramp where it steps up or down), facing `face` at the end. */
  private walk(e: Enemy, pts: THREE.Vector3[], speed: number, face?: THREE.Vector3, done?: () => void): void {
    this.walks.set(e, { pts: pts.map((p) => p.clone()), len: pathLength(pts), s: 0, speed, face: face?.clone(), done });
  }

  private updateWalks(dt: number): void {
    for (const [e, w] of this.walks) {
      w.s = Math.min(w.len, w.s + w.speed * dt);
      const dir = RunwayScene.tmpB;
      alongPath(w.pts, w.s, e.position, dir);
      if (Math.hypot(dir.x, dir.z) > 1e-3) e.faceToward(RunwayScene.tmpC.copy(e.position).add(dir.setY(0)), dt, 10);
      e.setWalk(w.s < w.len ? 0.7 : 0);
      e.cadence = 1.3;
      if (w.s >= w.len) {
        this.walks.delete(e);
        if (w.face) e.faceToward(w.face, 1, 100);
        e.setWalk(0);
        w.done?.();
      }
    }
    // Stood still, they look at him
    if (this.beat === 'talk1' || this.beat === 'badge' || this.beat === 'talk2') {
      const me = this.apt(...RAVI_AT);
      for (const e of this.crew) if (!this.walks.has(e)) e.faceToward(me, dt, 5);
    }
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
        const first = this.hitS.get(this.officers[3])!;
        const lastOfficer = this.hitS.get(this.officers[0])!;
        const s = this.vanS;
        if (s < first + 2.5) {
          // Low on the taxiway beside the Civic: it comes at the lens and past
          key = 'taxi';
          this.eye.copy(this.apt(381, 71.5)).setY(0.75);
          this.aim(RunwayScene.tmpC.copy(vp).setY(1.4), dt, key !== this.shotKey, 9);
          fov = 58;
        } else if (s < lastOfficer + 4) {
          key = 'line';
          this.eye.copy(this.apt(390, 42)).setY(1.4);
          this.aim(RunwayScene.tmpC.copy(vp).setY(1.3), dt, key !== this.shotKey, 7);
          fov = 54;
        } else if (s < this.turnS0 + 3) {
          key = 'car';
          this.eye.copy(this.apt(430, 47)).setY(1.1);
          this.aim(RunwayScene.tmpC.copy(vp).setY(1.3), dt, key !== this.shotKey, 6);
          fov = 50;
        } else if (s < this.backS) {
          // Up high off the runway's edge: round in a skid, smoke everywhere, and back
          key = 'turn';
          this.eye.copy(this.apt(421, 48)).setY(5.5);
          this.aim(RunwayScene.tmpC.copy(vp).setY(1.0), dt, key !== this.shotKey, 5);
          fov = 52;
        } else {
          // His eyes: it comes back up the taxiway and pulls in on his right
          key = 'pov-back';
          this.eye.copy(this.seatEye(RunwayScene.tmpA));
          this.aim(RunwayScene.tmpC.copy(vp).setY(1.5), dt, key !== this.shotKey, 4);
          fov = 66;
        }
        break;
      }
      case 'exit': {
        key = 'pov-out';
        this.eye.copy(this.standEye);
        // Toward the door as he gets out, then round to the van
        const door = RunwayScene.tmpC;
        if (t < 1.2) door.copy(fromCar(-3.2, 1.45, -2.2));
        else this.vanWorld(this.van.doorIn, door).setY(1.45);
        this.aim(door, dt, key !== this.shotKey, 3.5);
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
        let tgt: THREE.Vector3;
        if (t < 3.3) tgt = this.vanWorld(RunwayScene.tmpC.copy(v.doorIn).setY(v.floorY + 1.0));
        else if (t < 4.8) tgt = this.vanWorld(RunwayScene.tmpC.copy(v.doorIn).setY(v.floorY + 1.1));
        else tgt = this.vanWorld(RunwayScene.tmpC.set(0.6, v.floorY + 1.0, 0.5));
        this.aim(tgt, dt, false, 4);
        fov = 72;
        break;
      }
      case 'leave': {
        key = 'leave';
        this.eye.copy(this.apt(389.5, 59.2)).setY(1.1);
        this.aim(RunwayScene.tmpC.copy(vp).setY(1.6), dt, key !== this.shotKey, 5);
        fov = 55;
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
    const inCivic = key === 'pov-jet' || key === 'pov-duck' || key === 'pov-back';
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
