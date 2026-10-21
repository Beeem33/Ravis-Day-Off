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
import { whiteVan, exterminatorBadge, grenade, type VanRig } from '../environment/VanProps';
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
 * Then a horn, and a long white van — the call centre's own — comes down
 * the taxiway flat out and through every one of them. Out jump his
 * coworkers. Sanjay has been doing some research on the bodies: Todd's ID,
 * the Exterminator Collective. Not police at all — the boss hired them to
 * get rid of everyone who could ever talk. It's them or us. Into the van,
 * and a montage of the crew suiting up out of the arsenal in the back as
 * they drive to the Collective's headquarters.
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
/** The van's run: down the taxiway past the Civic, through the security team and the boss's two men, to a stop on the runway. */
const VAN_RUN: [number, number][] = [
  [300, 67], [350, 67.5], [372, 67], [384, 64.5], [392, 59.5], [400, 52.5], [408, 44], [415, 36.5], [423, 30], [432, 26.5], [442, 26]
];
/** Where the security team and the two men walk up to as they close in on the car, all of them in the van's way. */
const OFFICER_TO: [number, number][] = [[399, 53.4], [395, 57], [391, 60.2], [387.5, 62.8]];
const GUARD_TO: [number, number][] = [[408.8, 43.2], [414.2, 37.4]];
/** Ravi out of the car, by its open door; the van pulled up beside him with its door his way. */
const RAVI_AT: [number, number] = [384.3, 58.4];
const VAN_STOP: [number, number] = [386.4, 54.2];
/** Where the van leaves by: on along the taxiway and round onto the runway, after the jet. */
const VAN_AWAY: [number, number][] = [[386.4, 54.2], [400, 54.2], [414, 53], [424, 47.5], [429, 38], [430.5, 25], [430.5, 0], [430.5, -120]];
/** The montage: down the highway, in its middle lane. */
const MONTAGE_S0 = 700;
const MONTAGE_LANE = -3.6;

/** Sat on a bench, hands resting on the thighs (body frame: his right +X, forward −Z). */
const SEATED_HANDS = (): { handR: THREE.Vector3; handL: THREE.Vector3 } => ({ handR: new THREE.Vector3(0.15, 0.62, -0.3), handL: new THREE.Vector3(-0.15, 0.62, -0.3) });

type Beat = 'pinned' | 'van' | 'regroup' | 'crew' | 'talk1' | 'badge' | 'talk2' | 'board' | 'leave' | 'montage' | 'end';

/**
 * Ravi's right hand holding the badge up from behind: fingers flat up its
 * back, the thumb round its bottom corner onto the face, so the face is all
 * there to read (badge frame: face +Z, its right +X, up +Y).
 */
const BADGE_GRIP = grip([0.06, -0.14, -0.024], [-0.22, 0.9, -0.36], [0, 0, 1], [0.3, -0.8, 0.45], {
  fingers: [[12, 16, 10], [14, 18, 10], [16, 20, 12], [18, 22, 12]],
  thumb: [0.45, 0.35, 0.2]
});

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
  private sanjay!: Enemy;
  private dev!: Enemy;
  private staff!: Enemy;
  private wheelman!: Enemy;
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
  /** Brake to a stop at the end of the path (else hold speed off its end). */
  private vanStops = true;
  private vanStoppedAt = -1;
  private vanTop = 28;
  private vanAccel = 0;
  private readonly vanVel = new THREE.Vector3();
  private readonly vanPrev = new THREE.Vector3();
  /** Route s along the van's run of each man in its way, for when the cuts come. */
  private readonly hitS = new Map<Enemy, number>();
  private gateDown = false;
  private regrouped = false;
  private montageS = MONTAGE_S0;

  // ---- The people on foot
  private readonly walks = new Map<Enemy, { pts: THREE.Vector3[]; len: number; s: number; t0: number; speed: number; face?: THREE.Vector3; done?: () => void }>();

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
  /** Where his eyes are while he stands outside, and while he walks to the van. */
  private readonly standEye = new THREE.Vector3();
  private shotKey = '';

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
    this.van = whiteVan();
    this.scene.add(this.van.group);
    this.particles = new ParticleManager(this.scene, { smoke: 1400 });
    this.dialogue = new DialogueBox(this.ctx.uiRoot, audio);

    this.placeEveryone();
    this.buildCrew();
    this.buildDriver();
    this.buildViewmodels();
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

    // The van, out of sight up the taxiway, and where its run goes
    this.vanPath = this.aptPath(VAN_RUN);
    this.vanLen = pathLength(this.vanPath);
    for (const e of [...this.officers, ...this.guards]) this.hitS.set(e, this.sOnPath(this.vanPath, this.closeAt.get(e)!));
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
   * one more off the floor, and whoever's driving — seated at the wheel the
   * whole way, the others out of sight in the back until the door opens.
   */
  private buildCrew(): void {
    const mk = (name: string, idx: number): Enemy => {
      const e = new Enemy(new THREE.Vector3(0, -60, 0), 0, idx, { name, civilian: true });
      this.scene.add(e.root);
      e.root.visible = false;
      return e;
    };
    this.sanjay = mk('SANJAY', 6);
    this.dev = mk('DEV', 4);
    this.staff = mk('STAFF', 9);
    this.wheelman = mk('STAFF', 13);
    const stain = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.012), new THREE.MeshStandardMaterial({ color: 0xd88a86, roughness: 0.5 }));
    stain.position.set(-0.02, -0.06, -0.141);
    this.sanjay.addChestPatch(stain);
    this.seatIn(this.wheelman, this.van.seats.driver, 0);
    // Todd's badge, in Sanjay's fist until it changes hands
    this.sanjayBadge = exterminatorBadge();
    const holder = new THREE.Group();
    holder.add(this.sanjayBadge);
    this.sanjayBadge.rotation.set(0, Math.PI / 2, 0);
    this.sanjayBadge.position.set(0, 0.07, 0);
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
    e.pose = e === this.wheelman ? { handR: new THREE.Vector3(0.17, 1.0, -0.42), handL: new THREE.Vector3(-0.17, 1.0, -0.42) } : SEATED_HANDS();
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

  /**
   * In the back of the van for the montage: sat on the left bench, elbows on
   * his knees, the way the others sit.
   */
  private seatRaviInVan(): void {
    const r = this.driver;
    if (!r) return;
    this.van.body.add(r.root);
    const at = this.van.seats.left[0];
    r.root.position.set(at.x, at.y - this.van.body.position.y, at.z);
    r.root.rotation.y = Math.PI / 2;
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    r.seat({
      hips: V(0, 0.53, -0.16),
      lean: [-4, 6, 6, 4, 2, -2],
      legs: {
        l: { ankle: V(0.15, 0.09, 0.32), knee: V(0.2, 0.7, 1) },
        r: { ankle: V(-0.15, 0.09, 0.32), knee: V(-0.2, 0.7, 1) }
      },
      arms: {
        l: { wrist: V(0.13, 0.62, 0.24), along: V(-0.3, -0.25, 1), palm: V(-0.2, -1, 0), elbow: V(0.7, -0.4, -0.3), shape: HAND.relaxed },
        r: { wrist: V(-0.13, 0.62, 0.24), along: V(0.3, -0.25, 1), palm: V(0.2, -1, 0), elbow: V(-0.7, -0.4, -0.3), shape: HAND.relaxed }
      }
    });
    r.root.visible = true;
    const head = r.bones.get('head');
    if (head) head.scale.setScalar(1);
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
      case 'regroup':
        this.updateRegroup();
        break;
      case 'crew':
        this.updateCrewOut();
        break;
      case 'talk1':
      case 'talk2':
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
    }

    this.updateJet(dts);
    this.updateVan(dts);
    this.updateWalks(dts);
    if (this.beat === 'pinned' || this.beat === 'van') this.updateGunmen(dts);
    for (const e of [...this.guards, ...this.officers]) e.update(dts);
    const talking = this.dialogue.typing ? this.dialogue.speaker : null;
    for (const e of [this.sanjay, this.dev, this.staff, this.wheelman]) {
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
   * outside to the men firing, and back — down behind the dash as the glass
   * goes. A horn, from somewhere back up the taxiway.
   */
  private updatePinned(dt: number): void {
    const t = this.beatT;
    if (t < 0.05) this.fadeEl.style.opacity = '0';
    // They close in, from where they stood, all firing
    for (const e of [...this.officers, ...this.guards]) {
      const from = this.startAt.get(e)!;
      const to = this.closeAt.get(e)!;
      const k = clamp01((t - 0.6) / 5.2);
      e.position.lerpVectors(from, to, smooth(k));
      e.setWalk(k > 0 && k < 1 ? 0.55 : 0);
      e.cadence = 1;
      e.faceToward(this.civicRig.group.position, dt, 6);
    }
    // The van, on its way: off up the taxiway, flat out
    if (t > 6.5 && !this.vanMoving) this.startVan(this.vanPath, 0, 28, false);
    if (t > 6.8 && t - dt <= 6.8) this.ctx.audio.horn(70);
    if (t > 7.6 && t - dt <= 7.6) this.ctx.audio.horn(45);
    if (t > 8.2) this.setBeat('van');
  }

  /** The van's run, and who it goes through. */
  private updateVanRun(_dt: number): void {
    const t = this.beatT;
    // Its brakes once it's through the last of them
    const lastS = Math.max(...this.hitS.values());
    if (this.vanS > lastS + 3 && this.vanStops === false) {
      this.vanStops = true;
      this.ctx.audio.tyreSqueal(1.2, this.camera.position.distanceTo(this.van.group.position));
    }
    // The gate's boom, if it's in the way
    if (!this.gateDown && this.van.group.position.distanceTo(this.airside.gate.pos) < 9) {
      this.gateDown = true;
      this.ctx.audio.carCrash(this.camera.position.distanceTo(this.airside.gate.pos), false);
      this.particles.sparks(this.airside.gate.pos.clone().setY(1), RunwayScene.tmpA.set(0, 1, 0), 24);
    }
    if (this.gateDown) {
      const arm = this.airside.gateArm;
      arm.rotation.z = Math.min(1.45, arm.rotation.z + _dt * 9);
    }
    this.runOver();
    if (this.vanStoppedAt >= 0 && t - this.vanStoppedAt > 1.4) this.setBeat('regroup');
  }

  /** Anyone in the van's footprint goes under it: thrown, and a ragdoll from there. */
  private runOver(): void {
    const v = this.van;
    v.group.updateMatrixWorld(true);
    const inv = RunwayScene.tmpC;
    for (const e of [...this.officers, ...this.guards]) {
      if (!e.alive) continue;
      const p = v.group.worldToLocal(inv.copy(e.position));
      if (Math.abs(p.x) > 1.3 || Math.abs(p.z) > 3.5) continue;
      const hitAt = e.position.clone().setY(1.0);
      const dir = this.vanVel.clone().normalize();
      e.die(hitAt, dir, this.world, 'torso', 1.5);
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(v.group.quaternion).multiplyScalar(Math.sign(p.x || 1) * 3.5);
      e.launch(this.vanVel.clone().multiplyScalar(1.05).add(side).setY(5.5 + Math.random() * 2));
      const d = this.camera.position.distanceTo(hitAt);
      this.ctx.audio.bodyThud(d);
      this.ctx.audio.carCrash(d, false);
      this.particles.bloodSpray(hitAt, dir, true, 0);
      this.shake = Math.min(1, this.shake + 0.35);
      // The boss's two men: a beat of slow motion for each
      if (this.guards.includes(e)) this.slowT = 0.75;
    }
  }

  /** Out of the car: he's stood by its door as the van comes back round and pulls up beside him. */
  private updateRegroup(): void {
    const t = this.beatT;
    if (!this.regrouped) {
      this.regrouped = true;
      // The cut: he's out, the door open behind him; the van coming up from behind
      this.civicRig.setDoor(1);
      if (this.driver) this.driver.root.visible = false;
      if (this.crackCanvas) this.crackCanvas.style.opacity = '0';
      const stop = this.apt(...VAN_STOP);
      const from = this.apt(VAN_STOP[0] - 16, VAN_STOP[1]);
      this.startVan([from, stop], 0, 9, true);
      this.vanS = 0;
      this.vanOnPath(9, 0);
      this.standEye.copy(this.apt(...RAVI_AT)).setY(1.64);
    }
    if (this.vanStoppedAt >= 0 && t - this.vanStoppedAt > 0.4) this.setBeat('crew');
  }

  /** The door slides back and out they come: Sanjay to him, Dev and the other one either side. */
  private updateCrewOut(): void {
    const t = this.beatT;
    const v = this.van;
    v.setDoor(smooth(t / 0.9));
    if (t > 0.05 && t - 0.016 <= 0.05) this.ctx.audio.carDoor(true, 3);
    const ravi = this.apt(...RAVI_AT);
    const toVan = RunwayScene.tmpA.copy(this.vanWorld(v.doorOut)).sub(ravi).setY(0).normalize();
    const side = new THREE.Vector3(-toVan.z, 0, toVan.x);
    const spot = (fwd: number, lat: number): THREE.Vector3 => ravi.clone().addScaledVector(toVan, fwd).addScaledVector(side, lat);
    const out = (e: Enemy, at: number, to: THREE.Vector3): void => {
      if (t < at || this.walks.has(e) || e.root.visible) return;
      e.root.visible = true;
      this.scene.add(e.root);
      e.setSitting(false, true);
      const inside = this.vanWorld(v.doorIn);
      const step = this.vanWorld(v.doorOut);
      e.position.copy(inside);
      this.walk(e, [inside, step, to], 2.3, ravi);
    };
    out(this.sanjay, 0.8, spot(1.45, 0));
    out(this.staff, 1.35, spot(2.15, 1.35));
    out(this.dev, 1.9, spot(2.0, -1.05));
    if (t > 2 && ![this.sanjay, this.staff, this.dev].some((e) => this.walks.has(e))) {
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

  /**
   * Todd's badge: Sanjay holds it out, Ravi takes it and brings it up to
   * look at it properly — for as long as it takes to read — then puts it
   * away, and Sanjay goes on.
   */
  private updateBadge(): void {
    const t = this.beatT;
    const s = this.sanjay;
    const badge = this.badgeAnchor.userData.badge as THREE.Group;
    // Sanjay's hand out with it, and back down once it's taken
    const reach = track([[0, 0], [0.9, 1], [1.6, 1], [2.3, 0]], t);
    const rest = new THREE.Vector3(0.2, 0.92, -0.08);
    const offer = new THREE.Vector3(0.08, 1.24, -0.42);
    s.pose = reach > 0.001 ? { handR: rest.clone().lerp(offer, reach) } : null;
    this.sanjayBadge.visible = t < 1.55;
    // Where it is in his hand, as Ravi sees it: where Ravi's hand goes to take it.
    // Its face turned to Ravi, whatever the fist is doing
    if (t < 1.55) {
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
    }
  }

  /** Back into the van, all of them, him last; the door slides shut and they're away. */
  private updateBoard(): void {
    const t = this.beatT;
    const v = this.van;
    const board = (e: Enemy, at: number, seat: THREE.Vector3, yaw: number): void => {
      if (t < at || this.walks.has(e) || e.root.parent === v.body) return;
      const step = this.vanWorld(v.doorOut);
      const inside = this.vanWorld(v.doorIn);
      this.walk(e, [e.position.clone(), step, inside], 2.4, undefined, () => this.seatIn(e, seat, yaw));
    };
    board(this.sanjay, 0.1, v.seats.right[0], Math.PI / 2);
    board(this.staff, 0.5, v.seats.right[1], Math.PI / 2);
    board(this.dev, 0.9, v.seats.left[1], -Math.PI / 2);
    // Him: to the door, up and in, and down onto the bench
    const ravi = this.apt(...RAVI_AT).setY(1.64);
    const step = this.vanWorld(v.doorOut).setY(1.64);
    const inside = this.vanWorld(RunwayScene.tmpB.copy(v.doorIn).setY(v.floorY + 1.55));
    const seat = this.vanWorld(RunwayScene.tmpC.copy(v.seats.left[0]).add(new THREE.Vector3(0.05, 1.2, -0.05)));
    if (t < 1.4) this.standEye.copy(ravi);
    else if (t < 3.0) this.standEye.lerpVectors(ravi, step, smooth((t - 1.4) / 1.6));
    else if (t < 3.6) this.standEye.lerpVectors(step, inside, smooth((t - 3.0) / 0.6));
    else this.standEye.lerpVectors(inside, seat, smooth((t - 3.6) / 0.9));
    // The light on in the back; the door shut behind him
    v.light.intensity = THREE.MathUtils.lerp(0, 5, clamp01((t - 2.6) / 0.6));
    v.lamp.emissiveIntensity = v.light.intensity > 0.1 ? 1.4 : 0;
    if (t > 4.6) v.setDoor(1 - smooth((t - 4.6) / 0.8));
    if (t > 4.6 && t - 0.016 <= 4.6) this.ctx.audio.carDoor(false, 1);
    if (t > 5.6) this.setBeat('leave');
  }

  /** Outside, by the car he's leaving: the van pulls away down the taxiway, round onto the runway, and gone. */
  private updateLeave(): void {
    const t = this.beatT;
    if (t < 0.05 && !this.vanMoving) {
      this.startVan(this.aptPath(VAN_AWAY), 0, 30, false, 6);
      this.vanEngine?.setGain(1);
      this.ctx.audio.tyreSqueal(0.8, 12);
    }
    if (t > 3.0) this.fadeEl.style.opacity = '1';
    if (t > 4.0) this.startMontage();
  }

  /**
   * Suiting up, on the way: on the highway now, a run of short shots in the
   * back of the van — the rack, Sanjay into a vest, Ravi loading the AK,
   * Dev with a grenade, the van from outside — and everyone kitted out, the
   * city ahead.
   */
  private startMontage(): void {
    this.setBeat('montage');
    this.vanMoving = false;
    this.vanStoppedAt = -1;
    this.montageS = MONTAGE_S0;
    this.placeVanOnHighway(0, 0);
    this.seatRaviInVan();
    this.ctx.audio.startBossMusic();
    this.vanEngine?.setSpeed(26, 0.6);
    this.vanEngine?.setGain(0.7);
    this.fadeEl.style.opacity = '0';
    this.grenadeProp = grenade();
  }

  private updateMontage(dt: number): void {
    const t = this.beatT;
    this.montageS += 26 * dt;
    this.placeVanOnHighway(t, dt);
    const cut = (at: number): boolean => t >= at && t - dt < at;
    // Quick flashes on the cuts
    const flash = [3, 5.6, 6.5, 8.6, 11.6, 14.2, 17.2, 20.2].some((c) => t > c && t < c + 0.08);
    this.flashEl.style.opacity = flash ? '0.55' : '0';
    // Sanjay into his vest: arms up and over his head, the cut, and he's in it, pulling the straps tight
    if (cut(6.5)) {
      this.sanjay.wearArmour();
      this.ctx.audio.kickWhoosh();
    }
    // Hands on their thighs, but for what each shot has them doing — and once they hold rifles, on those
    const sat = t < 17.2;
    if (t > 5.6 && t < 8.6) {
      if (t < 6.5) {
        const k = smooth((t - 5.6) / 0.7);
        const up = (sx: number): THREE.Vector3 => new THREE.Vector3(sx * 0.15, 0.62, -0.3).lerp(new THREE.Vector3(sx * 0.12, 1.62, -0.05), k);
        this.sanjay.pose = { handR: up(1), handL: up(-1) };
      } else {
        const tug = 0.025 * Math.sin((t - 6.5) * 9);
        this.sanjay.pose = { handR: new THREE.Vector3(0.11, 1.12 + tug, -0.15), handL: new THREE.Vector3(-0.11, 1.12 - tug, -0.15) };
      }
    } else this.sanjay.pose = sat ? SEATED_HANDS() : null;
    this.staff.pose = sat ? SEATED_HANDS() : null;
    // Ravi loads the AK
    if (cut(8.6)) this.rifle.stow = 0.6;
    if (t > 8.6 && t < 11.6) this.rifle.stow += (0 - this.rifle.stow) * Math.min(1, dt * 6);
    else this.rifle.stow = 1;
    if (cut(9.1)) this.rifle.startReload();
    // Dev, armoured, turning a grenade over in his hand
    if (cut(11.6)) {
      this.dev.wearArmour();
      this.staff.wearArmour();
      if (this.grenadeProp) this.dev.holdProp(this.grenadeProp, 0.02);
    }
    if (t > 11.6 && t < 14.2) {
      this.dev.pose = { handR: new THREE.Vector3(0.08, 1.12 + 0.02 * Math.sin(t * 2), -0.32), handL: SEATED_HANDS().handL, head: new THREE.Euler(0.35, 0.15, 0) };
    } else this.dev.pose = sat ? SEATED_HANDS() : null;
    if (cut(14.2)) this.grenadeProp?.removeFromParent();
    // Everyone kitted out, rifles between their knees
    if (cut(17.2)) {
      this.wheelman.wearArmour();
      for (const e of [this.sanjay, this.dev, this.staff]) {
        armWithAK(e, true);
        e.setRestCarry(true, true);
      }
    }
    if (cut(17.7) || cut(18.2) || cut(18.7)) {
      this.ctx.audio.boltBack();
      setTimeout(() => this.ctx.audio.boltForward(), 140);
    }
    if (t > 22.4) this.fadeEl.style.opacity = '1';
    if (t > 23.6) {
      this.setBeat('end');
      this.ctx.audio.stopBossMusic(3);
      this.vanEngine?.setGain(0);
    }
  }

  private updateEnd(): void {
    const t = this.beatT;
    if (t > 0.8) this.endCard.style.opacity = '1';
    if (t > 7 && !this.completed) {
      this.completed = true;
      this.ctx.bus.emit(Events.RunwayComplete);
    }
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

  private startVan(path: THREE.Vector3[], v0: number, top: number, stops: boolean, accel = 0): void {
    this.vanPath = path;
    this.vanLen = pathLength(path);
    this.vanS = 0;
    this.vanV = v0;
    this.vanTop = top;
    this.vanAccel = accel;
    this.vanStops = stops;
    this.vanMoving = true;
    this.vanStoppedAt = -1;
    this.van.group.visible = true;
    this.vanOnPath(v0, 0);
    this.vanPrev.copy(this.van.group.position);
  }

  private updateVan(dt: number): void {
    if (!this.vanMoving) return;
    const left = this.vanLen - this.vanS;
    const vStop = this.vanStops ? Math.sqrt(2 * 9 * Math.max(0, left)) : Infinity;
    const vWant = this.vanAccel > 0 ? Math.min(this.vanTop, this.vanV + this.vanAccel * dt) : this.vanTop;
    this.vanV = Math.min(vWant, vStop);
    this.vanS = Math.min(this.vanLen, this.vanS + this.vanV * dt);
    if (this.vanStops && left < 0.12 && this.vanStoppedAt < 0) {
      this.vanStoppedAt = this.beatT;
      this.vanV = 0;
    }
    if (!this.vanStops && this.vanS >= this.vanLen) this.vanMoving = false;
    this.vanOnPath(this.vanV, dt, this.vanStops && left < 20 && this.vanV > 1);
    if (dt > 0) this.vanVel.subVectors(this.van.group.position, this.vanPrev).divideScalar(dt);
    this.vanPrev.copy(this.van.group.position);
    this.vanEngine?.setSpeed(this.vanV, this.vanV > 2 ? 0.9 : 0.2);
    this.vanEngine?.setGain(this.beat === 'pinned' || this.beat === 'van' || this.beat === 'leave' || this.beat === 'regroup' ? Math.max(0.15, 1 - this.camera.position.distanceTo(this.van.group.position) / 90) : 0.6);
  }

  /** The van along its path at vanS: nose along it, wheels turning, the body dipping under the brakes. */
  private vanOnPath(v: number, dt: number, braking = false): void {
    const g = this.van.group;
    const dir = RunwayScene.tmpB;
    alongPath(this.vanPath, this.vanS, g.position, dir);
    const yaw = Math.atan2(-dir.x, -dir.z);
    g.rotation.y = dt > 0 ? g.rotation.y + wrapAngle(yaw - g.rotation.y) * Math.min(1, dt * 7) : yaw;
    for (const w of this.van.wheels) w.rotation.x -= (v * dt) / 0.36;
    const b = this.van.body;
    b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, braking ? -0.045 : v > 3 && this.vanAccel > 0 ? 0.03 : 0, Math.min(1, dt * 6));
    this.van.brakelights.emissiveIntensity = braking ? 2.4 : 0.25;
    if (braking && v > 6) {
      for (const sx of [-0.8, 0.8]) {
        const p = RunwayScene.tmpC.set(sx, 0.3, 2.2).applyMatrix4(g.matrixWorld);
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
    b.position.y = 0.36 + Math.sin(t * 7.3) * 0.008 + Math.sin(t * 3.1) * 0.006;
    b.rotation.z = Math.sin(t * 1.7) * 0.012;
    b.rotation.x = Math.sin(t * 2.3) * 0.006;
    for (const w of this.van.wheels) w.rotation.x -= (26 * dt) / 0.36;
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

  /** Walk `e` along `pts` (a hop where it steps up or down), facing `face` at the end. */
  private walk(e: Enemy, pts: THREE.Vector3[], speed: number, face?: THREE.Vector3, done?: () => void): void {
    this.walks.set(e, { pts: pts.map((p) => p.clone()), len: pathLength(pts), s: 0, t0: this.beatT, speed, face: face?.clone(), done });
  }

  private updateWalks(dt: number): void {
    for (const [e, w] of this.walks) {
      w.s = Math.min(w.len, w.s + w.speed * dt);
      const dir = RunwayScene.tmpB;
      alongPath(w.pts, w.s, e.position, dir);
      // A hop on the way down from (or up into) the van
      const flat = Math.hypot(dir.x, dir.z);
      if (flat > 1e-3) e.faceToward(RunwayScene.tmpC.copy(e.position).add(dir.setY(0)), dt, 10);
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
      for (const e of [this.sanjay, this.dev, this.staff]) if (!this.walks.has(e)) e.faceToward(me, dt, 5);
    }
  }

  // ---------------------------------------------------------------- camera

  private updateCamera(dt: number): void {
    const cam = this.camera;
    const t = this.beatT;
    let key = '';
    let fov = 70;
    const civic = this.civicRig.group;
    const seated = (): THREE.Vector3 => {
      const rig = this.civicRig;
      rig.group.updateMatrixWorld(true);
      return RunwayScene.tmpA.set(rig.seat.hip.x, rig.seat.hip.y + 0.68 - rig.body.position.y, rig.seat.hip.z + 0.06).applyMatrix4(rig.body.matrixWorld);
    };
    const fromCar = (x: number, y: number, z: number): THREE.Vector3 => RunwayScene.tmpB.set(x, y, z).applyMatrix4(civic.matrixWorld);
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
          this.eye.copy(seated());
          const jet = RunwayScene.tmpC.copy(this.jet.group.position).setY(this.jet.group.position.y + 2);
          const fwd = fromCar(-0.37, 1.0, -12);
          const k = 1 - smooth((t - 3.5) / 0.8);
          this.aim(fwd.lerp(jet, k), dt, key !== this.shotKey, 6);
          fov = 64;
        } else if (t < 6.2) {
          // Outside: behind the security team, firing on the car, the jet climbing out past them
          key = 'gunline';
          this.eye.copy(this.apt(405, 47)).setY(1.5);
          this.aim(RunwayScene.tmpC.copy(civic.position).setY(1.1), dt, key !== this.shotKey, 8);
          fov = 52;
        } else {
          // Back in his seat, flinching from the glass, eyes on the men closing in
          key = 'pov-duck';
          this.eye.copy(seated());
          const flinch = Math.sin(t * 13) * 0.04 * (1 - smooth((t - 6.2) / 2));
          this.aim(fromCar(-0.37 + flinch, 0.7, -12), dt, key !== this.shotKey, 8);
          fov = 66;
        }
        break;
      }
      case 'van': {
        const first = this.hitS.get(this.officers[3])!;
        const lastOfficer = this.hitS.get(this.officers[0])!;
        const vp = this.van.group.position;
        if (this.vanS < first + 2.5) {
          // Low on the taxiway beside the Civic: it comes at the lens and past
          key = 'taxi';
          this.eye.copy(this.apt(381, 71.5)).setY(0.75);
          this.aim(RunwayScene.tmpC.copy(vp).setY(1.3), dt, key !== this.shotKey, 9);
          fov = 58;
        } else if (this.vanS < lastOfficer + 4) {
          key = 'line';
          this.eye.copy(this.apt(390, 42)).setY(1.4);
          this.aim(RunwayScene.tmpC.copy(vp).setY(1.2), dt, key !== this.shotKey, 7);
          fov = 54;
        } else {
          key = 'car';
          this.eye.copy(this.apt(430, 47)).setY(1.1);
          this.aim(RunwayScene.tmpC.copy(vp).setY(1.2), dt, key !== this.shotKey, 6);
          fov = 50;
        }
        break;
      }
      case 'regroup':
      case 'crew':
      case 'talk1':
      case 'talk2':
      case 'badge': {
        key = 'pov-stand';
        this.eye.copy(this.standEye);
        let tgt: THREE.Vector3;
        if (this.beat === 'regroup') tgt = RunwayScene.tmpC.copy(this.van.group.position).setY(1.4);
        else if (this.beat === 'crew' && t < 1.2) tgt = this.vanWorld(this.van.doorIn, RunwayScene.tmpC).setY(1.5);
        else tgt = RunwayScene.tmpC.copy(this.sanjay.position).setY(this.sanjay.position.y + 1.58);
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
        if (t < 1.4) tgt = RunwayScene.tmpC.copy(this.sanjay.position).setY(1.5);
        else if (t < 3.6) tgt = this.vanWorld(RunwayScene.tmpC.copy(v.doorIn).setY(v.floorY + 1.2));
        else tgt = this.vanWorld(RunwayScene.tmpC.set(0.6, v.floorY + 0.95, 1.2));
        this.aim(tgt, dt, false, 4);
        fov = 72;
        break;
      }
      case 'leave': {
        key = 'leave';
        this.eye.copy(this.apt(377, 50.5)).setY(1.25);
        this.aim(RunwayScene.tmpC.copy(this.van.group.position).setY(1.4), dt, key !== this.shotKey, 5);
        fov = 55;
        break;
      }
      case 'montage':
      case 'end': {
        const m = this.montageShot(t);
        key = m.key;
        this.eye.copy(m.eye);
        // Inside, the look rides with the van (eased in the world, it'd fall behind at 26 m/s)
        this.aim(m.look, dt, key !== this.shotKey || key !== 'm-road', m.follow);
        fov = m.fov;
        break;
      }
    }
    const inCivic = key.startsWith('pov-jet') || key.startsWith('pov-duck');
    if (this.crackCanvas) this.crackCanvas.style.opacity = inCivic ? '1' : '0';
    if (this.driver && this.beat !== 'montage' && this.beat !== 'end') {
      const head = this.driver.bones.get('head');
      if (head) head.scale.setScalar(inCivic ? 0.001 : 1);
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

  /** The montage's shots, in van frame (nose −Z, its right +X, floor at floorY) — or, outside, on the highway. */
  private montageShot(t: number): { key: string; eye: THREE.Vector3; look: THREE.Vector3; fov: number; follow: number } {
    const v = this.van;
    const fy = v.floorY;
    const W = (x: number, y: number, z: number): THREE.Vector3 => this.vanWorld(new THREE.Vector3(x, y, z));
    const r = this.driver;
    const pov = (t >= 8.6 && t < 11.6) || t >= 20.2;
    if (r) {
      r.root.visible = !pov;
      const head = r.bones.get('head');
      if (head) head.scale.setScalar(pov ? 0.001 : 1);
    }
    const ravi = v.seats.left[0];
    const raviEye = (): THREE.Vector3 => W(ravi.x + 0.08, fy + 1.24, ravi.z - 0.12);
    if (t < 3) {
      // From the back doors: the whole crew, the benches, the road ahead through the screen
      return { key: 'm-wide', eye: W(0.15, fy + 1.6, 2.95 - t * 0.12), look: W(0, fy + 1.0, -2.6), fov: 66, follow: 8 };
    }
    if (t < 5.6) {
      // Along the rack
      const k = (t - 3) / 2.6;
      return { key: 'm-rack', eye: W(0.15, fy + 1.4, 1.2 + k * 0.7), look: W(0.95, fy + 1.35, 1.55 + k * 0.7), fov: 50, follow: 20 };
    }
    if (t < 8.6) {
      // Sanjay into his vest: from the aisle, a little ahead of him
      const s = v.seats.right[0];
      return { key: 'm-vest', eye: W(-0.12, fy + 1.32, s.z - 0.8), look: W(s.x - 0.05, fy + 1.1, s.z), fov: 52, follow: 20 };
    }
    if (t < 11.6) {
      // His own eyes: the AK, loaded
      return { key: 'm-load', eye: raviEye(), look: W(0.4, fy + 0.85, ravi.z - 0.2), fov: 68, follow: 20 };
    }
    if (t < 14.2) {
      // Dev, with a grenade, the pistols on the wall behind him
      const d = v.seats.left[1];
      return { key: 'm-grenade', eye: W(0.3, fy + 1.3, d.z - 0.35), look: W(d.x + 0.12, fy + 1.15, d.z - 0.05), fov: 48, follow: 20 };
    }
    if (t < 17.2) {
      // Outside: up the highway from in front, the van coming on and past
      if (this.shotKey !== 'm-road') {
        const f = this.net.sample('highway', this.montageS + 70);
        this.roadCam.copy(f.pos).addScaledVector(f.right, MONTAGE_LANE - 6).setY(f.pos.y + 1.6);
      }
      return { key: 'm-road', eye: this.roadCam, look: RunwayScene.tmpC.copy(v.group.position).setY(v.group.position.y + 1.4), fov: 50, follow: 8 };
    }
    if (t < 20.2) {
      // Everyone kitted out: from up by the cab, looking back down the bay
      return { key: 'm-ready', eye: W(-0.1, fy + 1.55, -0.75 + (t - 17.2) * 0.08), look: W(0, fy + 0.95, 2.6), fov: 64, follow: 8 };
    }
    // His eyes again: up the van, out of the screen, the city coming
    return { key: 'm-ahead', eye: raviEye(), look: W(-0.25, fy + 1.45, -4.5), fov: 70, follow: 3 };
  }

  private readonly roadCam = new THREE.Vector3();

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
