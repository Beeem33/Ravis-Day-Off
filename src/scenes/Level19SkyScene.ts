import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Controls } from '../core/Controls';
import { FPSPlayer } from '../entities/FPSPlayer';
import { FPSHUD } from '../ui/FPSHUD';
import { DialogueBox, type DialogueLine } from '../ui/DialogueBox';
import { ParticleManager } from '../fx/ParticleManager';
import { Enemy } from '../entities/Enemy';
import { RaviVisual, RaviRig, FirstPersonArms, grip, elbowToward, type Grip, type HandShape } from '../entities/RaviVisual';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { Arsenal } from '../entities/Arsenal';
import { pistolProp } from '../entities/RaviRagdoll';
import { armWithAK } from '../entities/AkModel';
import { diverQuat, raviFreefall, raviUnderCanopy, enemyCrawl, DiverPose } from '../entities/Skydiver';
import {
  skyDome, ocean, islandMesh, ISLANDS, farIslands, CloudDeck, CanopyRip, Birds, type Flock, bossWidebody, airliner, turboprop, exhaustTrail,
  type Aircraft, canopy, type Canopy, chutePack, letterPatch, HAZE, HAZE_DENSITY, SUN_DIR
} from '../environment/Level19Sky';
import { buildBeach, sandY, type Beach } from '../environment/Level19Beach';
import { smooth, track, yawPitchTo, wrapAngle } from './cutscene';

/**
 * Level19SkyScene — Level 19, part two: out of the back of the boss's plane
 * after him.
 *
 *  1. The door. Ravi tumbles out of the aft door into the slipstream, the
 *     widebody going away above him nose-down with nobody at the controls,
 *     and gets himself flat on the wind. Far below, a speck: the boss.
 *  2. The fall, out of his own eyes: sixty-three seconds of it, from four
 *     kilometres — his left arm out on the wind at the edge of the view, his
 *     pistol in his right (the same pistol as on foot: ten in the magazine,
 *     R to reload); A, D and S track across the sky, W puts his arms in and
 *     takes him head-down, faster. Gulls in
 *     flocks at their own heights that he falls through unless he steers
 *     round them; airliners and a turboprop crossing his column (seen
 *     coming — a trail, the roar, the marker — and swept past if he isn't
 *     out of their way); and the FBI, who jumped after him, closing in from
 *     above and shooting. He has his pistol. Two decks of cloud on the way
 *     down. At the end the boss's canopy opens below him and the boss puts
 *     a last few rounds into him as he drops past.
 *  3. The chute. It opens with a jolt; he looks up at it — and it's full of
 *     bullet holes, the sky through them, rags of it flapping. It isn't
 *     holding him. He looks down: the sea, coming up very fast. Into it.
 *  4. Black, for five seconds.
 *  5. A beach. He comes round on his back with his coworkers stood over him
 *     at the water's edge — in their kit, rifles and all; they came in the
 *     van — and down at the far end of the sand, the boss, dragging himself
 *     away on his belly. They tell him to go and get him.
 *
 * World frame for the fall: metres, the sea at y = 0, he leaves the door at
 * 4 km heading −Z. His height is a fixed function of time (yAt): the fall
 * takes exactly as long every time, whatever he does with it.
 */

type Phase = 'exit' | 'fall' | 'pull' | 'splash' | 'black' | 'beach' | 'dead';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Where he leaves the door. */
const Y_DOOR = 4000;
/** Terminal velocity, belly to earth, and how quickly he gets to it. */
const FALL_V = 54;
const FALL_TAU = 1.8;
/** The tumble out of the door, before the fall is his. */
const EXIT = 5;
/** The fall itself, from control to the pull. */
export const FALL_SECONDS = 63;
/** Retry from here (fall seconds) once he's got this far. */
const CHECKPOINT_T = 31;
/** Black between the sea and the beach. */
const BLACK_SECONDS = 5;
/** Steering: how fast he tracks across the sky (A, D, S), and head-down in the pencil (W). */
const TRACK = 15;
const DIVE = 30;
/** His left hand, open flat on the wind. */
const FLAT_HAND: HandShape = { fingers: [[6, 8, 4], [5, 7, 4], [7, 9, 5], [9, 11, 6]], thumb: [0.05, 0.1, 0.1], spread: 8 };
const MAX_HP = 5;
const SANJAY = 0.88;
const DEV = 0.95;
const RAVI = 1.0;
const BOSS = 0.8;

/** Height above the sea, `tt` seconds after leaving the door. */
function yAt(tt: number): number {
  return Y_DOOR - FALL_V * (tt - FALL_TAU * (1 - Math.exp(-tt / FALL_TAU)));
}

/** One of the FBI, in the air with him. Positions are relative to Ravi: they fall with him. */
interface Diver {
  e: Enemy;
  rel: THREE.Vector3;
  vel: THREE.Vector3;
  hp: number;
  state: 'wait' | 'dive' | 'hold' | 'dead' | 'leave';
  ang: number;
  dist: number;
  dy: number;
  orbit: number;
  fireT: number;
  glint: number;
  burst: number;
  burstT: number;
  deadT: number;
  /** How his body lies on the air. */
  pose: DiverPose;
  spin: THREE.Vector3;
  t: number;
  q: THREE.Quaternion;
  mark: HTMLElement;
  /** When it joins the fall (fall seconds). */
  at: number;
}

/** An aircraft crossing his column: at `P` (world, its height) at fall time `Tc`, going `dir` at `speed`. */
interface Crossing {
  a: Aircraft;
  name: string;
  P: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  Tc: number;
  sound: { setThrust(k: number): void; setDistance(m: number): void; stop(): void };
  missed: boolean;
  mark: HTMLElement;
}

/** A bit of the timeline: something that comes into the fall at fall time `at`. */
interface Cue {
  at: number;
  /** When it reaches him (its whole point), if it's a threat. */
  tc?: number;
  done?: boolean;
  run: () => void;
}

/** A spray of small bright bits in the air (feathers, droplets), each flying free until it's spent. */
class Spray {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  constructor(scene: THREE.Scene, private max: number, colour: number, size: number) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3).fill(-1e5);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: colour, size, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(at: THREE.Vector3, base: THREE.Vector3, spread: number, n: number, life = 1.4): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * 0.6;
      this.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * 0.6;
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.6;
      this.vel[i * 3] = base.x + (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = base.y + (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 2] = base.z + (Math.random() - 0.5) * spread;
      this.life[i] = life * (0.6 + Math.random() * 0.4);
    }
  }
  update(dt: number, gravity: number, drag: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -1e5;
        continue;
      }
      const k = Math.max(0, 1 - drag * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - gravity * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Level19SkyScene implements GameScene {
  private scene = new THREE.Scene();
  /**
   * The world's camera. Its near plane stays well out (anything closer than
   * that is drawn in a pass of its own: the hands and gun in first person,
   * his body and canopy after the pull), so the depth buffer has the
   * precision to keep the islands' shores off the sea all the way down.
   */
  private camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 2.5, 60000);
  /** The close-up pass's camera: the world camera's view, a near plane of centimetres, layer 1 only. */
  private nearCam = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.04, 400);
  private phase: Phase = 'exit';
  /** Seconds since leaving the door, and since the phase began. */
  private tt = 0;
  private pt = 0;
  /** Fall seconds (0 at control, 63 at the pull). */
  private T = 0;
  private time = 0;

  // ---- the world
  private sky!: THREE.Mesh;
  private sea!: THREE.Mesh;
  private islands: THREE.Mesh[] = [];
  private decks: CloudDeck[] = [];
  private birds!: Birds;
  private jet!: Aircraft;
  private jetSound: Crossing['sound'] | null = null;
  private crossings: Crossing[] = [];
  private particles!: ParticleManager;
  private feathers!: Spray;
  private droplets!: Spray;
  private sun!: THREE.DirectionalLight;

  // ---- Ravi
  private rig!: RaviRig;
  private pistol!: THREE.Group;
  private pack!: THREE.Group;
  private chute!: Canopy;
  /** His middle, world. */
  private pos = V(0, Y_DOOR, 0);
  private hv = new THREE.Vector3();
  private yaw = 0;
  private pitch = -0.95;
  private bank = 0;
  private hp = MAX_HP;
  private hurtT = 99;
  private regenT = 0;
  private tumble = 0;
  private tumbleAxis = V(1, 0, 0);
  private alive = true;
  private bodyQ = new THREE.Quaternion();
  private deadVel = new THREE.Vector3();
  private deadSpin = new THREE.Vector3();
  /** Rounds that came close enough to go through the canopy pack: how holed the chute will be. */
  private holesIn = 0;
  private shake = 0;

  // ---- first person
  private player!: FPSPlayer;
  private arsenal!: Arsenal;
  private world!: CANNON.World;
  /** The hands and the gun: drawn over the world in a pass of their own. */
  private vmScene = new THREE.Scene();
  private arms!: FirstPersonArms;
  private armAnchor!: THREE.Object3D;
  private armGrip!: Grip;
  /** Deadbull on G, as on foot. */
  private drink!: DrinkViewmodel;
  /** The left arm back out from the gun after a reload (0..1, 1 when it's out), and where its hand started. */
  private armBack = 1;
  private armFrom = new THREE.Vector3();
  private wasReloading = false;
  private debris: { mesh: THREE.Object3D; body: CANNON.Body; t: number }[] = [];
  /** This frame's mouse movement. */
  private mouse = new THREE.Vector2();
  /** 0 spread in the arch .. 1 head-down with his arms in (W). */
  private pencil = 0;
  private steer = { x: 0, y: 0 };
  private bossPose!: DiverPose;

  // ---- the rest of them
  private divers: Diver[] = [];
  private downed = 0;
  private boss!: Enemy;
  private bossRel = V(22, -235, -95);
  private bossPos = new THREE.Vector3();
  private bossChute!: Canopy;
  private bossOpenT = -1;
  private bossFire = 0;
  private bossVy = -FALL_V;
  private cues: Cue[] = [];
  private birdMarks = new Map<Flock, HTMLElement>();
  private flockN = 0;

  // ---- the beach
  private beach: Beach | null = null;
  private crew: Enemy[] = [];
  private beachBoss: Enemy | null = null;
  private bossCrawlS = 0;
  private fpCam = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 4000);
  private beachStep = 0;
  private sitT = -1;
  private lookYaw = 0;
  private lookPitch = 1.15;

  // ---- UI and sound
  private hud!: FPSHUD;
  private dialogue!: DialogueBox;
  private ui!: HTMLElement;
  private letterbox!: HTMLElement;
  private objective!: HTMLElement;
  private captionEl!: HTMLElement;
  private captionT = 0;
  private altEl!: HTMLElement;
  private warnEl!: HTMLElement;
  private marks!: HTMLElement;
  private bossMark!: HTMLElement;
  private whiteEl!: HTMLElement;
  private waterEl!: HTMLElement;
  private fadeEl!: HTMLElement;
  private lidTop!: HTMLElement;
  private lidBot!: HTMLElement;
  private endEl!: HTMLElement;
  private wind: { set(k: number): void; setRush(k: number): void; stop(): void } | null = null;
  private surf: { set(k: number): void; stop(): void } | null = null;
  private under: { set(k: number): void; stop(): void } | null = null;
  private unsubs: (() => void)[] = [];
  private warmed = false;
  private warmedBeach = false;
  private handedOff = false;
  private deadAt = 0;
  private canvasFilter = false;
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private clickHandler = (): void => this.onClick();
  private raycaster = new THREE.Raycaster();

  private static _a = new THREE.Vector3();
  private static _b = new THREE.Vector3();
  private static _c = new THREE.Vector3();
  private static _q = new THREE.Quaternion();

  constructor(private ctx: GameContext, private checkpoint = 0) {}

  // ================================================================ lifecycle

  enter(): void {
    const { bus, audio } = this.ctx;
    this.scene.fog = new THREE.FogExp2(HAZE.getHex(), HAZE_DENSITY);
    this.scene.background = HAZE.clone();
    this.sky = skyDome();
    this.scene.add(this.sky);
    this.sea = ocean(ISLANDS.map((s) => new THREE.Vector4(s.x, s.z, s.r * 1.05, s.r * 1.9)));
    this.scene.add(this.sea);
    for (const [i, s] of ISLANDS.entries()) {
      // The first is the one he comes down by: built finer, it's seen close
      const m = islandMesh(s, i === 0);
      this.islands.push(m);
      this.scene.add(m);
    }
    // And the rest of the archipelago, out to the horizon every way
    for (const s of farIslands()) this.scene.add(islandMesh(s, false, true));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
    this.sun.position.copy(SUN_DIR).multiplyScalar(100);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    const hemi = new THREE.HemisphereLight(0xc4dcf2, 0x2a4a66, 1.2);
    this.scene.add(hemi);
    this.sun.layers.enable(1);
    hemi.layers.enable(1);
    this.nearCam.layers.set(1);

    // Two decks of cloud to fall through, and a high thin one he starts under
    this.decks.push(new CloudDeck(2500, 220, 950, 2400, 3));
    this.decks.push(new CloudDeck(1300, 180, 850, 2400, 8));
    this.decks.push(new CloudDeck(5200, 60, 450, 2500, 5, 900));
    for (const d of this.decks) this.scene.add(d.mesh);

    this.birds = new Birds(720);
    this.scene.add(this.birds.group);
    this.particles = new ParticleManager(this.scene, { smoke: 600 });
    this.feathers = new Spray(this.scene, 300, 0xf4f4f0, 0.16);
    this.droplets = new Spray(this.scene, 500, 0xe8f6ff, 0.22);

    this.buildUI();
    this.buildFirstPerson();
    this.buildRavi();
    this.buildJet();
    this.buildBoss();
    this.buildDivers();
    this.buildCues();

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, 0, MAX_HP);
    this.hud.setCounter('FBI DOWN', 0);
    const hint = document.querySelector<HTMLElement>('#hud .hud-bottom');
    if (hint) hint.innerHTML = 'A D S steer &nbsp;·&nbsp; W dive &nbsp;·&nbsp; MOUSE look &nbsp;·&nbsp; LMB fire &nbsp;·&nbsp; R reload';
    this.hud.hide();
    this.dialogue = new DialogueBox(this.ctx.uiRoot, audio);

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        for (const c of [this.camera, this.fpCam, this.player.camera, this.nearCam]) {
          c.aspect = window.innerWidth / window.innerHeight;
          c.updateProjectionMatrix();
        }
      })
    );
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('click', this.clickHandler);

    this.wind = audio.windLoop();
    this.wind.set(0.5);
    if (this.checkpoint >= 2) {
      // Straight to the sea and the beach (the end of it, on its own)
      this.letterbox.classList.remove('open');
      this.startBlack();
    } else if (this.checkpoint >= 1) this.startFall(CHECKPOINT_T);
    else this.startExit();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('click', this.clickHandler);
    this.hud.destroy();
    this.dialogue.destroy();
    this.ui.remove();
    this.wind?.stop();
    this.surf?.stop();
    this.under?.stop();
    this.jetSound?.stop();
    for (const c of this.crossings) c.sound.stop();
    this.ctx.audio.stopTrackMusic(0.6);
    this.ctx.audio.hushSfx(false, 0.2);
    if (this.canvasFilter) this.ctx.engine.renderer.domElement.style.filter = '';
  }

  // ================================================================ building

  private buildRavi(): void {
    this.rig = RaviVisual.rig('body');
    this.rig.clear().apply();
    this.rig.root.updateMatrixWorld(true);
    // The pack on his back (his back is −Z)
    this.pack = chutePack(0x15264a, 0xc9a245);
    this.pack.rotation.y = Math.PI;
    this.pack.position.set(0, 1.2, -0.19);
    this.pack.updateMatrixWorld(true);
    this.rig.bones.get('spine_03')!.attach(this.pack);
    for (const m of this.rig.meshes) m.frustumCulled = false;
    this.scene.add(this.rig.root);
    // Seen only from outside him (dying) and when he looks down at himself under the canopy
    this.rig.root.visible = false;
    this.pistol = pistolProp();
    this.pistol.scale.setScalar(1.15);
    this.pistol.visible = false;
    this.scene.add(this.pistol);
    // His canopy, packed until the pull. Navy and gold, the boss's own colours: it was his plane's
    this.chute = canopy({ span: 8, chord: 3, rise: 4.8, colours: [0x15264a, 0xc9a245, 0x15264a, 0xf1efe6, 0x15264a, 0xc9a245, 0x15264a] });
    this.chute.group.visible = false;
    this.scene.add(this.chute.group);
  }

  private buildJet(): void {
    this.jet = bossWidebody();
    this.scene.add(this.jet.group);
    // The aft door he came out of, standing open: the dark of the doorway, the door swung forward against the skin
    const D = Level19SkyScene.DOOR;
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.9), new THREE.MeshBasicMaterial({ color: 0x0d0f12, side: THREE.DoubleSide }));
    hole.rotation.y = -Math.PI / 2;
    hole.position.set(D.x - 0.03, D.y + 0.25, D.z);
    this.jet.group.add(hole);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 1.05), new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.4, metalness: 0.2 }));
    leaf.position.set(D.x - 0.42, D.y + 0.25, D.z - 1.0);
    leaf.rotation.y = 0.5;
    this.jet.group.add(leaf);
  }

  /** The aft left door, in the jet's frame. */
  private static readonly DOOR = V(-2.95, 0.4, 16.5);

  /** Where the jet is `tt` seconds after he left it: going away nose-down, faster and steeper. */
  private poseJet(tt: number): void {
    const g = this.jet.group;
    const pitch = -0.2 - Math.min(0.4, tt * 0.03);
    const roll = Math.sin(tt * 0.3) * 0.08 + tt * 0.01;
    g.rotation.set(pitch, 0, roll, 'YXZ');
    // Along −Z and down, with the speed building as the nose drops
    const s = 88 * tt + 1.2 * tt * tt;
    const sink = 3.2 * tt * tt;
    const door = Level19SkyScene.DOOR.clone().applyEuler(new THREE.Euler(-0.2, 0, 0, 'YXZ'));
    g.position.set(-door.x, Y_DOOR - door.y - sink, -door.z - s);
    g.visible = g.position.y > 30;
  }

  private buildBoss(): void {
    const b = new Enemy(V(0, -9000, 0), 0, 7, { name: 'THE BOSS', boss: true });
    const pack = chutePack(0x111111, 0xc9a245);
    pack.position.set(0, 1.2, 0.2);
    b.wear(pack, 'UpperChest');
    b.equipPistol();
    this.scene.add(b.root);
    this.boss = b;
    this.bossPose = new DiverPose(b);
    this.bossChute = canopy({ span: 7.5, chord: 2.8, rise: 4.4, colours: [0x111111, 0xc9a245, 0x111111, 0xc9a245, 0x111111, 0xc9a245, 0x111111] });
    this.bossChute.group.visible = false;
    this.bossChute.setOpen(0);
    this.scene.add(this.bossChute.group);
  }

  /** Every agent the fall will throw at him, built now (the warm-up compiles them) and sent in by the timeline. */
  private buildDivers(): void {
    const waves: [number, number][] = [
      [8, 2],
      [20, 2],
      [30, 2],
      [39, 3],
      [48.5, 2],
      [55, 2]
    ];
    let idx = 0;
    for (const [at, n] of waves) {
      for (let i = 0; i < n; i++) {
        const e = new Enemy(V(0, -9000, 0), 0, 11 + idx * 3, { name: 'FBI AGENT' });
        e.equipPistol();
        const pack = chutePack(0x1b1f27, 0x2a2f38);
        pack.position.set(0, 1.2, 0.2);
        const fbi = letterPatch('FBI', 0.34, 0.17);
        fbi.position.set(0, -0.04, 0.081);
        pack.add(fbi);
        e.wear(pack, 'UpperChest');
        e.root.visible = false;
        this.scene.add(e.root);
        const mark = this.mark('mk-fbi', '');
        this.divers.push({
          e,
          rel: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          hp: 2,
          state: 'wait',
          ang: 0,
          dist: 16,
          dy: 0,
          orbit: 0,
          fireT: 0,
          glint: 0,
          burst: 0,
          burstT: 0,
          deadT: 0,
          pose: new DiverPose(e),
          spin: new THREE.Vector3(),
          t: Math.random() * 10,
          q: new THREE.Quaternion(),
          mark,
          at: at + i * 0.9
        });
        idx++;
      }
    }
    if (this.checkpoint >= 1) for (const d of this.divers) if (d.at < CHECKPOINT_T) d.at = Infinity;
  }

  /**
   * The fall's timeline: each flock as the time he'd reach its height
   * (dead in his path if he holds his course), each crossing aircraft as
   * the time it crosses his column.
   */
  private buildCues(): void {
    const flock = (Tc: number, n: number, shape: 'ball' | 'v', r: number): Cue => ({ at: Tc - 7, tc: Tc, run: () => this.spawnFlock(Tc, shape === 'ball' ? Math.round(n * 1.35) : n, shape, r) });
    const plane = (Tc: number, kind: 'liner' | 'prop', v = 0): Cue => ({ at: Tc - 7.5, tc: Tc, run: () => this.spawnCrossing(Tc, kind, v) });
    this.cues = [
      flock(6, 22, 'ball', 9),
      flock(12, 15, 'v', 10),
      plane(17, 'prop'),
      flock(17.5, 30, 'ball', 11),
      flock(21, 17, 'v', 12),
      flock(27.8, 34, 'ball', 12),
      plane(36, 'liner', 0),
      flock(34, 40, 'ball', 13),
      flock(38, 19, 'v', 13),
      flock(44, 44, 'ball', 13),
      flock(49.6, 36, 'ball', 12),
      plane(52.5, 'liner', 1),
      flock(55.8, 46, 'ball', 14),
      flock(58.6, 21, 'v', 13),
      // Scenery: a couple of flocks off to the side that he only sees go by
      { at: 2, run: () => this.spawnFlock(14, 26, 'ball', 14, 90) },
      { at: 30, run: () => this.spawnFlock(40, 30, 'ball', 16, -120) }
    ];
    // From the checkpoint: whatever would have reached him in the first moments is skipped, the rest come in late
    if (this.checkpoint >= 1) for (const c of this.cues) if ((c.tc ?? c.at) < CHECKPOINT_T + 3) c.done = true;
  }

  // ================================================================ UI

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="l19-white" style="position:absolute;inset:0;background:#f4f8fb;opacity:0;pointer-events:none"></div>
      <div class="l19-water" style="position:absolute;inset:0;opacity:0;pointer-events:none;background:radial-gradient(ellipse at 50% 0%, rgba(80,170,190,0.92), rgba(6,40,66,0.98) 70%)"></div>
      <div class="l19-marks" style="position:absolute;inset:0;pointer-events:none;overflow:hidden"></div>
      <div class="intro-letterbox open"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="l19-alt" style="position:absolute;right:28px;top:22px;text-align:right;color:#eaf6ff;font-family:'Courier New',monospace;letter-spacing:2px;text-shadow:0 0 8px rgba(0,0,0,0.8);opacity:0;transition:opacity .4s">
        <div style="font-size:11px;opacity:.75">ALTITUDE</div>
        <div class="v" style="font-size:30px;font-weight:bold">4000 M</div>
      </div>
      <div class="l19-warn" style="position:absolute;left:50%;top:14%;transform:translateX(-50%);color:#ffcf4a;font-family:'Courier New',monospace;font-size:17px;letter-spacing:4px;font-weight:bold;text-shadow:0 0 10px rgba(0,0,0,0.9);opacity:0;white-space:nowrap"></div>
      <div class="l19-caption" style="position:absolute;left:50%;bottom:13%;transform:translateX(-50%);max-width:70vw;text-align:center;background:rgba(0,0,0,0.5);padding:8px 16px;border-radius:3px;color:#fff3cf;font-family:'Courier New',monospace;font-size:17px;letter-spacing:1px;text-shadow:0 0 6px #000,0 0 14px rgba(0,0,0,0.9);opacity:0;transition:opacity .35s"></div>
      <div class="l19-lid" style="position:absolute;left:0;right:0;top:0;height:50.5%;background:#000;transform-origin:top;transform:scaleY(0);pointer-events:none"></div>
      <div class="l19-lid2" style="position:absolute;left:0;right:0;bottom:0;height:50.5%;background:#000;transform-origin:bottom;transform:scaleY(0);pointer-events:none"></div>
      <div class="intro-fade"></div>
      <div class="l19-end" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff3cf;font-family:'Courier New',monospace;font-size:28px;letter-spacing:10px;opacity:0;transition:opacity 1.4s;pointer-events:none">TO BE CONTINUED</div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.captionEl = el.querySelector('.l19-caption')!;
    this.altEl = el.querySelector('.l19-alt')!;
    this.warnEl = el.querySelector('.l19-warn')!;
    this.marks = el.querySelector('.l19-marks')!;
    this.whiteEl = el.querySelector('.l19-white')!;
    this.waterEl = el.querySelector('.l19-water')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
    this.lidTop = el.querySelector('.l19-lid')!;
    this.lidBot = el.querySelector('.l19-lid2')!;
    this.endEl = el.querySelector('.l19-end')!;
    this.bossMark = this.mark('mk-boss', 'THE BOSS');
  }

  /** A screen marker: corner brackets round a thing, and a label under it. */
  private mark(cls: string, label: string): HTMLElement {
    const m = document.createElement('div');
    m.className = cls;
    const colour = cls === 'mk-boss' ? '#f2c919' : cls === 'mk-fbi' ? '#ff5a4a' : '#ffcf4a';
    m.style.cssText = `position:absolute;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;display:none;color:${colour};font-family:'Courier New',monospace;font-size:10px;letter-spacing:2px;text-align:center;`;
    m.innerHTML = `
      <span style="position:absolute;left:0;top:0;width:9px;height:9px;border-left:2px solid currentColor;border-top:2px solid currentColor"></span>
      <span style="position:absolute;right:0;top:0;width:9px;height:9px;border-right:2px solid currentColor;border-top:2px solid currentColor"></span>
      <span style="position:absolute;left:0;bottom:0;width:9px;height:9px;border-left:2px solid currentColor;border-bottom:2px solid currentColor"></span>
      <span style="position:absolute;right:0;bottom:0;width:9px;height:9px;border-right:2px solid currentColor;border-bottom:2px solid currentColor"></span>
      <b style="position:absolute;left:50%;top:38px;transform:translateX(-50%);white-space:nowrap;text-shadow:0 0 5px #000">${label}</b>`;
    this.marks.appendChild(m);
    return m;
  }

  /**
   * Put a marker over a world point. Off the screen (or behind the camera),
   * `edge` pins it to the nearest edge with an arrow toward it instead of
   * hiding it — for the things that can kill him.
   */
  private place(m: HTMLElement, at: THREE.Vector3, on: boolean, label?: string, size = 34, edge = false): void {
    if (!on) {
      if (m.style.display !== 'none') m.style.display = 'none';
      return;
    }
    const w = this.ctx.uiRoot.clientWidth || window.innerWidth;
    const h = this.ctx.uiRoot.clientHeight || window.innerHeight;
    const v = Level19SkyScene._c.copy(at).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = v.z > -0.1;
    const p = Level19SkyScene._c.copy(at).project(this.camera);
    let sx = p.x;
    let sy = p.y;
    let pinned = false;
    if (behind || Math.abs(sx) > 1 || Math.abs(sy) > 1) {
      if (!edge) {
        m.style.display = 'none';
        return;
      }
      if (behind) {
        sx = -sx;
        sy = -sy;
      }
      const k = 0.9 / Math.max(Math.abs(sx), Math.abs(sy), 1e-3);
      sx *= k;
      sy *= k;
      pinned = true;
    }
    m.style.display = 'block';
    m.style.transform = `translate(${((sx + 1) / 2) * w}px, ${((1 - sy) / 2) * h}px)`;
    const s = Math.round(pinned ? 26 : size);
    if (m.dataset.size !== String(s)) {
      m.dataset.size = String(s);
      m.style.width = m.style.height = `${s}px`;
      m.style.margin = `${-s / 2}px 0 0 ${-s / 2}px`;
      m.querySelector('b')!.style.top = `${s + 4}px`;
    }
    if (label !== undefined) {
      const arrow = pinned ? (Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? ' \u25b6' : ' \u25c0') : sy > 0 ? ' \u25b2' : ' \u25bc') : '';
      const text = pinned && arrow ? (Math.abs(sx) > Math.abs(sy) && sx < 0 ? arrow.trim() + ' ' + label : label + arrow) : label;
      const b = m.querySelector('b')!;
      if (b.textContent !== text) b.textContent = text;
    }
  }

  private setObjective(text: string): void {
    this.objective.textContent = text;
    this.objective.classList.remove('show');
    void this.objective.offsetWidth;
    this.objective.classList.add('show');
  }

  /** A line said in the air: no waiting on a click, it shows for a few seconds and goes. */
  private say(speaker: string, text: string, pitch: number, seconds = 3.2): void {
    this.captionEl.innerHTML = `<span style="color:#f2c919;letter-spacing:3px">${speaker}</span><br>${text}`;
    this.captionEl.style.opacity = '1';
    this.captionT = seconds;
    this.ctx.audio.dialogueBlip(pitch);
  }

  private warn(text: string): void {
    if (this.warnEl.textContent !== text) this.warnEl.textContent = text;
    this.warnEl.style.opacity = text ? String(0.6 + 0.4 * Math.abs(Math.sin(this.time * 6))) : '0';
  }

  // ================================================================ input

  private onClick(): void {
    if (this.dialogue.isActive) {
      this.dialogue.advance();
      return;
    }
    if (this.phase === 'dead' && performance.now() - this.deadAt > 1500) this.restart();
    if ((this.phase === 'fall' || this.phase === 'exit') && !this.ctx.input.pointerLocked) this.ctx.input.requestPointerLock();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.phase === 'dead') {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') && performance.now() - this.deadAt > 1500) this.restart();
      return;
    }
    if (this.dialogue.isActive && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) {
      e.preventDefault();
      this.dialogue.advance();
    }
  }

  private restart(): void {
    if (this.handedOff) return;
    this.handedOff = true;
    this.ctx.bus.emit(Events.RestartLevel19b, { checkpoint: this.T >= CHECKPOINT_T || this.checkpoint >= 1 ? 1 : 0 });
  }

  // ================================================================ his eyes

  /**
   * Ravi in first person, as on foot everywhere else: an FPSPlayer to carry
   * the camera and the viewmodels (held in a cutscene so it never walks or
   * falls on its own — the scene puts it where his eyes are and turns it),
   * the Arsenal with just the pistol, and his own left arm out in the arch
   * at the edge of the view, the right one on the gun. The viewmodels draw in
   * a pass of their own (vmScene) over the world: the world wants a camera
   * that sees forty kilometres, the hands one that sees four centimetres.
   */
  private buildFirstPerson(): void {
    const { input, audio, bus } = this.ctx;
    const p = new FPSPlayer(this.pos.clone(), 0, input, audio, bus);
    p.cinematic = true;
    this.player = p;
    const cam = p.camera;
    cam.near = 0.04;
    cam.far = 60;
    cam.updateProjectionMatrix();
    this.vmScene.add(cam);
    this.vmScene.add(new THREE.HemisphereLight(0xc4dcf2, 0x2a4a66, 1.3));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.copy(SUN_DIR);
    this.vmScene.add(sun);
    // Nothing falls in here: what comes out of the gun is simply left behind, up into the wind
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
    this.arsenal = new Arsenal(
      {
        player: p,
        audio,
        bus,
        world: this.world,
        particles: this.particles,
        castBullet: (o, d) => this.castBullet(o, d),
        addDebris: (m, b) => this.addDebris(m, b),
        dropMagazine: (pose) => this.dropMagazine(pose)
      },
      ['pistol'],
      'pistol'
    );
    // One-handed: the left arm is out on the wind
    this.arsenal.hideSupportHand = true;
    this.arsenal.pistol.stow = 1;
    // His left arm, laid each frame onto a hand placed in camera space
    this.armAnchor = new THREE.Object3D();
    cam.add(this.armAnchor);
    this.armGrip = grip([-0.5, -0.04, -0.46], [-0.55, 0.2, -0.8], [0, -1, 0], [-0.2, -0.35, 0.9], FLAT_HAND);
    this.arms = new FirstPersonArms(cam, cam).set('l', this.armAnchor, this.armGrip);
    // A Deadbull, on G: both hands off the gun, three seconds, full health
    this.drink = new DrinkViewmodel(cam);
    this.drink.onEvent = (e, i) => {
      if (e === 'crack') audio.canCrack();
      else if (e === 'gulp') audio.gulp(i);
      else if (e === 'heal') {
        this.hp = MAX_HP;
        this.regenT = 0;
      } else if (e === 'crush') audio.canCrush();
      else if (e === 'toss') this.dropCan(this.drink.tossPose());
    };
  }

  /** The empty can, flicked away: the wind has it. */
  private dropCan(pose: { position: THREE.Vector3; quaternion: THREE.Quaternion; velocity: THREE.Vector3 }): void {
    const mesh = DrinkViewmodel.crushedCan();
    mesh.position.copy(pose.position);
    mesh.quaternion.copy(pose.quaternion);
    const body = new CANNON.Body({ mass: 0.016, shape: new CANNON.Box(new CANNON.Vec3(0.042, 0.03, 0.042)), position: new CANNON.Vec3(pose.position.x, pose.position.y, pose.position.z) });
    body.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
    body.velocity.set(pose.velocity.x, pose.velocity.y, pose.velocity.z);
    body.angularVelocity.set((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 26, (Math.random() - 0.5) * 26);
    this.addDebris(mesh, body);
  }

  /** Where his eyes are: up off his back, toward his head. */
  private eyeAt(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos).add(V(-Math.sin(this.yaw) * 0.55, 0.22, -Math.cos(this.yaw) * 0.55));
  }

  /**
   * The camera and the hands, this frame. `look` is where the view points
   * (the scene's yaw and pitch, plus whatever it's adding); `flail` 0..1
   * throws the left arm about (the tumble); `pencil` 0..1 sweeps it back
   * to his side, out of view.
   */
  private drive(dt: number, look: { yaw: number; pitch: number; roll: number }, flail: number, busy: boolean, aiming: boolean): void {
    const p = this.player;
    const eye = this.eyeAt(Level19SkyScene._a);
    p.yaw = look.yaw;
    p.pitch = THREE.MathUtils.clamp(look.pitch, -1.5, 1.5);
    p.position.copy(eye).y -= p.eyeHeight;
    p.aiming = aiming;
    this.arsenal.preUpdate(dt, this.ctx.input, { canSwitch: false, busy });
    p.update(dt, []);
    p.lastMouseDX = this.mouse.x;
    p.lastMouseDY = this.mouse.y;
    const cam = p.camera;
    // Buffeted: the air hammering at him, harder the faster he's going
    const t = this.time;
    const pk = this.pencil;
    const a = (0.0022 + 0.0055 * pk) * (this.phase === 'exit' ? 1.6 : 1);
    cam.rotation.x += Math.sin(t * 31) * a + Math.sin(t * 17.3 + 1) * a * 0.8 + Math.sin(t * 5.1) * a * 1.5;
    cam.rotation.y += Math.sin(t * 27.7 + 2) * a * 0.7 + Math.sin(t * 4.3) * a;
    cam.rotation.z = look.roll + Math.sin(t * 23.1) * a * 0.8 + Math.sin(t * 3.7 + 1) * a * 1.2;
    const shake = this.shake * this.shake * 0.05;
    cam.rotation.x += (Math.random() - 0.5) * shake;
    cam.rotation.y += (Math.random() - 0.5) * shake;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    // Wider as he dives: it reads as speed
    const fov = 74 - this.arsenal.zoomFov + 16 * pk;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
    // A reload: the left hand comes off the wind for the magazine. Once it's gone down out of
    // shot to fetch one, the gun's own left hand (the one every other level reloads with) takes
    // over, seats it and racks the slide; when it's done the arm goes back out from the grip.
    const vm = this.arsenal.pistol as unknown as { reloadT: number; supportHand: THREE.Object3D };
    const reloading = this.arsenal.pistol.reloading;
    const handOver = reloading && vm.reloadT >= 0.28;
    this.arsenal.hideSupportHand = !handOver;
    this.arsenal.updateViewmodels(dt, aiming);
    if (this.wasReloading && !reloading) {
      // Back out from where the gun's hand finished, on the grip
      this.armBack = 0;
      this.armFrom.copy(vm.supportHand.getWorldPosition(new THREE.Vector3())).applyMatrix4(cam.matrixWorldInverse);
    }
    this.wasReloading = reloading;
    this.armBack = Math.min(1, this.armBack + dt / 0.4);
    const fetch = reloading ? Math.min(1, vm.reloadT / 0.26) : 0;
    this.layArm(flail, pk, fetch, handOver);
    this.drink.update(dt, p);
  }

  /**
   * The left arm out on the wind, palm to the ground, fluttering; swept back
   * along his side in the dive (`pk`); off to fetch a magazine (`fetch`), or
   * handed over to the gun's own left hand altogether (`gone`). Laid with a
   * proper two-bone solve from his own shoulder: the hand kept within reach,
   * the elbow out and a little down, the way a spread arm's is.
   */
  private static readonly SHOULDER_L = V(-0.172, -0.22, 0.08);
  private static armLen = 0;

  private layArm(flail: number, pk: number, fetch: number, gone: boolean): void {
    const t = this.time;
    const g = this.armGrip;
    const cam = this.player.camera;
    if (!Level19SkyScene.armLen) Level19SkyScene.armLen = RaviRig.len('upperarm_l', 'lowerarm_l') + RaviRig.len('lowerarm_l', 'hand_l');
    const reach = Level19SkyScene.armLen * 0.92;
    const fl = (k: number): number => Math.sin(t * (9 + k) + k) * 0.006 + Math.sin(t * (2.3 + k * 0.4) + k * 2) * 0.012;
    const S = Level19SkyScene.SHOULDER_L;
    // The spread: out to the side and forward of the shoulder, level, at the edge of the view
    const steer = this.steer;
    const out = V(-0.4 - steer.x * 0.06, 0.16 + steer.x * 0.08, -0.9);
    out.x += Math.sin(t * 7.1) * 0.35 * flail + fl(1) * 2;
    out.y += Math.cos(t * 6.3) * 0.4 * flail + fl(2) * 2;
    out.z += Math.sin(t * 5.2 + 1) * 0.2 * flail;
    const W = S.clone().addScaledVector(out.normalize(), reach);
    // Swept back: down along his side, behind the view
    const k = pk * pk * (3 - 2 * pk);
    W.lerp(S.clone().add(V(-0.12, -0.5, 0.12)), k);
    // Off for a magazine: down and in, below the view
    const f = fetch * fetch * (3 - 2 * fetch);
    W.lerp(S.clone().add(V(0.05, -0.45, -0.2)), f);
    // Back out after the reload, from the grip
    const back = this.armBack * this.armBack * (3 - 2 * this.armBack);
    if (back < 1) W.copy(this.armFrom).lerp(W, back);
    // Within reach of the shoulder, always: past it the arm can only fold the wrong way
    const d = W.clone().sub(S);
    if (d.length() > reach) W.copy(S).addScaledVector(d.normalize(), reach);
    // The elbow out to his left and a touch down, never in toward his chest
    const toward = elbowToward(W, S, V(-1, -0.45, 0.15).normalize());
    const elbow = W.clone().addScaledVector(toward, RaviRig.len('lowerarm_l', 'hand_l'));
    g.wrist.copy(W);
    // The hand carries on from the forearm, flattened out a little onto the wind
    g.along.copy(W).sub(elbow).normalize().add(V(-0.2, 0.1 + fl(4) * 3, -0.15).multiplyScalar(1 - k)).normalize();
    g.palm.set(0, -1, 0).applyQuaternion(Level19SkyScene._q.copy(cam.quaternion).invert());
    g.palm.addScaledVector(g.along, -g.palm.dot(g.along)).normalize();
    g.toward.copy(toward);
    this.armAnchor.visible = !gone && k < 0.92;
    this.arms.update();
  }

  // ================================================================ 1. the door

  /**
   * Out of the door. His first frame is the plane's last: looking out and
   * down from just outside the aft left door, the view the plane's own scene
   * handed over on. The slipstream takes him: he goes over backwards, sees
   * the jet's flank and tail go over his head and away, nose down with
   * nobody flying it, and fights his way flat onto the wind facing the way
   * it went. The pistol comes up as he steadies.
   */
  private startExit(): void {
    this.phase = 'exit';
    this.tt = 0;
    this.pt = 0;
    this.pos.set(0, Y_DOOR, 0);
    this.hv.set(-3.5, 0, -88);
    this.yaw = 0;
    this.pitch = -0.95;
    this.poseJet(0);
    this.jetSound = this.ctx.audio.jetEngine();
    this.jetSound.setThrust(1);
  }

  private updateExit(dt: number): void {
    const tt = this.tt;
    // Off the door with the jet's speed, the air taking it off him; down, faster and faster
    this.hv.multiplyScalar(Math.exp(-dt / 1.15));
    this.pos.x += this.hv.x * dt;
    this.pos.z += this.hv.z * dt;
    this.pos.y = yAt(tt);
    this.poseJet(tt);
    this.jetSound?.setDistance(this.jet.group.position.distanceTo(this.pos));
    this.bossPos.copy(this.pos).add(this.bossRel);
    this.bodyQ.copy(diverQuat(V(0, 0, -1), 0, 0, 'ravi', new THREE.Quaternion()));
    // Where he's looking: out of the door, then over backwards at the jet — its tail going over
    // him, then the whole of it going away ahead — then flat, forward and down, the way it went
    const settle = smooth((tt - 1.0) / 3.4);
    const baseYaw = THREE.MathUtils.lerp(Math.PI / 2, 0, settle);
    const basePitch = THREE.MathUtils.lerp(-0.7, -0.95, settle);
    const g = this.jet.group;
    const tail = V(0, 8.6, 22.5).lerp(V(0, 0.5, 0), smooth((tt - 0.5) / 1.4));
    const target = g.localToWorld(tail);
    const eye = this.eyeAt(Level19SkyScene._b);
    const yp = yawPitchTo(eye, target);
    const w = track([[0, 0], [0.4, 0.88], [2.4, 0.88], [3.5, 0.35], [4.6, 0]], tt);
    const tumble = 1 - smooth((tt - 2.4) / 2.2);
    const wob = (f: number, k: number): number => (Math.sin(tt * f + k) * 0.6 + Math.sin(tt * f * 1.7 + k * 2) * 0.4) * tumble;
    const look = {
      yaw: baseYaw + wrapAngle(yp.yaw - baseYaw) * w + wob(2.3, 1) * 0.16,
      pitch: THREE.MathUtils.lerp(basePitch, yp.pitch, w) + wob(2.9, 2) * 0.14,
      roll: track([[0, 0], [0.5, 0.5], [1.2, -0.38], [2.0, 0.22], [2.9, -0.1], [3.8, 0]], tt) + wob(3.4, 3) * 0.08
    };
    this.yaw = look.yaw;
    this.pitch = look.pitch;
    this.steer.x = 0;
    this.drive(dt, look, 1 - smooth((tt - 1.6) / 2.4), tt < 4.1, false);
    // The world's camera follows his eyes (the markers and the sky read it)
    this.syncCamera();
    this.wind?.set(0.45 + 0.5 * smooth(tt / 2.5));
    if (this.pt > 0.9 && this.pt - dt <= 0.9) this.say('RAVI', 'Arms out. Arms out. Like the card in the seat pocket.', RAVI, 2.6);
    if (tt > 3.6 && tt - dt <= 3.6) this.say('RAVI', 'There. That speck. That’s him.', RAVI, 2.2);
    if (tt >= EXIT) this.startFall(0);
  }

  // ================================================================ 2. the fall

  private startFall(T: number): void {
    this.phase = 'fall';
    this.T = T;
    this.tt = EXIT + T;
    this.pt = 0;
    if (T > 0) {
      // A retry from the checkpoint: straight into the fall, flat and steady, the pistol up
      this.pos.set(0, yAt(this.tt), 0);
      this.hv.set(0, 0, 0);
      this.yaw = 0;
      this.pitch = -0.95;
      this.poseJet(this.tt);
      this.arsenal.pistol.stow = 0;
    }
    this.hv.set(this.hv.x * 0.2, 0, this.hv.z * 0.2);
    this.hud.show();
    this.hud.setAmmo(...this.arsenal.ammoReadout());
    this.altEl.style.opacity = '1';
    this.setObjective(T > 0 ? 'CHECKPOINT — STAY ALIVE TILL THE PULL' : 'AFTER HIM — STAY ALIVE TILL THE PULL');
    this.ctx.input.requestPointerLock();
    this.ctx.audio.startTrackMusic('audio/street.mp3', 0, 0, 0.42, 2);
  }

  private updateFall(dt: number): void {
    const { input } = this.ctx;
    this.T += dt;
    const T = this.T;
    this.pos.y = yAt(this.tt);

    // ---- look: the mouse, as on foot
    if (input.pointerLocked) {
      this.yaw -= this.mouse.x * 0.0021 * FPSPlayer.lookScale;
      this.pitch -= this.mouse.y * 0.0021 * FPSPlayer.lookScale * (FPSPlayer.invertY ? -1 : 1);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 0.3);
    }
    // ---- W: the pencil — arms in to his sides, head down, going
    const tumbling = this.tumble > 0;
    const wantPencil = input.isDown(Controls.key('forward')) && !tumbling && !this.drink.engaged;
    this.pencil += ((wantPencil ? 1 : 0) - this.pencil) * Math.min(1, dt * 6);
    const pk = this.pencil;
    // ---- A, D and S: tracking across the sky, relative to where he's looking
    const sx = (input.isDown(Controls.key('right')) ? 1 : 0) - (input.isDown(Controls.key('left')) ? 1 : 0);
    const back = input.isDown(Controls.key('back')) ? 1 : 0;
    this.steer.x += (sx - this.steer.x) * Math.min(1, dt * 8);
    const fwd = V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const want = new THREE.Vector3().addScaledVector(right, sx * TRACK).addScaledVector(fwd, -back * TRACK * 0.7 + pk * DIVE);
    if (tumbling) want.multiplyScalar(0.2);
    const acc = 1 - Math.exp(-dt * (tumbling ? 1.5 : 4.5));
    this.hv.x += (want.x - this.hv.x) * acc;
    this.hv.z += (want.z - this.hv.z) * acc;
    this.pos.x += this.hv.x * dt;
    this.pos.z += this.hv.z * dt;
    // His body, for the pull and for a death seen from outside
    const lat = this.hv.dot(right) / TRACK;
    this.bank += (lat * 0.4 - this.bank) * Math.min(1, dt * 5);
    this.bodyQ.copy(diverQuat(fwd, this.bank, pk * 0.9, 'ravi', new THREE.Quaternion()));
    let roll = -this.bank * 0.35;
    let flail = 0;
    if (tumbling) {
      this.tumble = Math.max(0, this.tumble - dt);
      const k = Math.sin((1 - this.tumble / 0.9) * Math.PI);
      roll += this.tumbleAxis.x * k * 0.9;
      flail = k;
    }
    const look = { yaw: this.yaw, pitch: this.pitch - 0.32 * pk + (tumbling ? Math.sin(this.time * 9) * 0.1 * flail : 0), roll };

    // ---- the pistol: the same as on foot, put away while he's pencilled in
    if (input.wasPressed('KeyG') && !tumbling && pk < 0.2 && !this.arsenal.reloading && this.hp < MAX_HP + 1) this.drink.start();
    const busy = pk > 0.35 || tumbling || this.drink.engaged;
    const aiming = input.rightHeld && input.pointerLocked && !busy && !this.arsenal.reloading;
    this.drive(dt, look, flail, busy, aiming);
    this.syncCamera();
    const canFire = input.pointerLocked && !busy && this.arsenal.pistol.stow < 0.2;
    this.arsenal.updateFire(dt, input, canFire, (r, m, re) => this.hud.setAmmo(r, m, re));
    this.hud.setAiming(this.arsenal.aimBlend > 0.5);
    this.updateDebris(dt);

    // ---- the timeline, and everything in the air with him
    for (const c of this.cues) {
      if (!c.done && T >= c.at) {
        c.done = true;
        c.run();
      }
    }
    this.updateBirds(dt);
    this.updateCrossings(dt);
    if (!this.alive) return;
    this.updateDivers(dt);
    this.updateBossFall(dt);
    this.poseJet(this.tt);
    this.jetSound?.setDistance(this.jet.group.position.distanceTo(this.pos));
    if (this.jet.group.position.y < 400 && this.jetSound) {
      this.jetSound.stop();
      this.jetSound = null;
    }

    // ---- health: back a point every six seconds he goes without being hit
    this.hurtT += dt;
    if (this.hp < MAX_HP && this.hurtT > 4) {
      this.regenT += dt;
      if (this.regenT >= 6) {
        this.regenT = 0;
        this.hp++;
      }
    } else this.regenT = 0;
    this.hud.setHealth(this.hp, this.hp < MAX_HP && this.hurtT > 4 ? this.regenT / 6 : 0);

    // ---- the readouts, and the rush of it
    (this.altEl.querySelector('.v') as HTMLElement).textContent = `${Math.round(this.pos.y)} M`;
    const speed = this.hv.length();
    this.wind?.set(0.85 + 0.15 * Math.min(1, speed / DIVE) + 0.15 * pk);
    this.wind?.setRush(pk * 0.8 + Math.min(1, speed / DIVE) * 0.3);
    if (T >= CHECKPOINT_T && T - dt < CHECKPOINT_T && this.checkpoint < 1) this.setObjective('CHECKPOINT');

    // ---- the pull
    if (T >= FALL_SECONDS && this.alive) this.startPull();
  }

  /** The world camera sees what his eyes see (the far pass, the markers and the sky all read it). */
  private syncCamera(): void {
    const pc = this.player.camera;
    pc.updateMatrixWorld(true);
    this.camera.position.copy(pc.position);
    this.camera.quaternion.copy(pc.quaternion);
    if (this.camera.fov !== pc.fov) {
      this.camera.fov = pc.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld(true);
  }

  /** Draw this (and all of it) in the close-up pass instead of the world's. */
  private toNearPass(o: THREE.Object3D): void {
    o.traverse((x) => x.layers.set(1));
  }

  private applyShake(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const s = this.shake * this.shake * 0.08 + 0.003;
    this.camera.rotateX((Math.random() - 0.5) * s);
    this.camera.rotateY((Math.random() - 0.5) * s);
  }

  /**
   * His whole body, for when he's seen from outside it (dying) or looking
   * down himself (under the canopy): flat on the wind, the root put so his
   * middle is at `pos`.
   */
  private poseRavi(steer: { x: number; y: number }, flail: number): void {
    const r = this.rig.root;
    r.quaternion.copy(this.bodyQ);
    r.position.copy(this.pos).sub(V(0, 1.0, 0).applyQuaternion(this.bodyQ));
    r.updateMatrixWorld(true);
    raviFreefall(this.rig, { aim: null, aimK: 0, steer, t: this.time, flail });
    this.holdPistol();
  }

  /** The pistol laid in his right fist (the whole-body Ravi's, seen from outside). */
  private holdPistol(): void {
    this.rig.root.updateMatrixWorld(true);
    const w = this.rig.bones.get('hand_r')!.getWorldPosition(new THREE.Vector3());
    const k = this.rig.bones.get('middle_01_r')!.getWorldPosition(new THREE.Vector3());
    const along = k.sub(w).normalize();
    const ix = this.rig.bones.get('index_01_r')!.getWorldPosition(new THREE.Vector3());
    const pk = this.rig.bones.get('pinky_01_r')!.getWorldPosition(new THREE.Vector3());
    const across = ix.sub(pk).normalize();
    const z = along.clone().negate();
    const y = across.clone().addScaledVector(z, -across.dot(z)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    this.pistol.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.pistol.position.copy(w).addScaledVector(along, 0.07).addScaledVector(y, -0.01);
  }

  /**
   * Where one of his rounds goes: the Arsenal fires it down the crosshair
   * from his eye, and it stops in whichever agent it meets first.
   */
  private castBullet(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 {
    const { audio, bus } = this.ctx;
    // What he's aiming at is the red box round each of them: a round that goes through the box
    // hits him. The box is drawn a fixed size on screen whatever his limbs are doing, so the test
    // is against that — the box carried out to the man's distance, square to the view — not the
    // thin body inside it.
    const cam = this.camera;
    cam.updateMatrixWorld(true);
    const right = Level19SkyScene._a.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = Level19SkyScene._b.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const h = this.ctx.uiRoot.clientHeight || window.innerHeight;
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h;
    let best: Diver | null = null;
    let bestT = Infinity;
    let bestCore = false;
    const C = new THREE.Vector3();
    const off = new THREE.Vector3();
    for (const d of this.divers) {
      if (d.state !== 'dive' && d.state !== 'hold' && d.state !== 'leave') continue;
      C.copy(this.pos).add(d.rel);
      const t = off.copy(C).sub(origin).dot(dir);
      if (t < 1 || t > 400 || t >= bestT) continue;
      off.copy(C).sub(origin).addScaledVector(dir, -t);
      const camDist = cam.position.distanceTo(C);
      const sizePx = THREE.MathUtils.clamp(1400 / Math.max(1, camDist), 24, 90);
      // Half the box, in metres out where he is (and never smaller than the man himself)
      const half = Math.max(0.75, (sizePx / 2) * perPx * t);
      const ox = Math.abs(off.dot(right));
      const oy = Math.abs(off.dot(up));
      if (ox > half || oy > half) continue;
      best = d;
      bestT = t;
      // Dead centre of the box: that's his head and chest, and it's the end of him
      bestCore = Math.max(ox, oy) < half * 0.35;
    }
    const end = origin.clone().addScaledVector(dir, Math.min(bestT, 400));
    if (!best) return end;
    const d = best;
    d.hp -= bestCore ? 2 : 1;
    const at = d.e.chest.getWorldPosition(new THREE.Vector3());
    this.particles.bloodSpray(at, dir.clone().negate(), bestCore, -1e9);
    audio.fleshHit();
    bus.emit(Events.HitMarker, { lethal: d.hp <= 0 });
    if (d.hp <= 0) this.killDiver(d, dir);
    else d.e.flinch(1);
    return at;
  }

  /** What comes out of the gun (a spent case, an empty magazine): left behind, up into the wind. */
  private addDebris(mesh: THREE.Object3D, body: CANNON.Body): void {
    this.scene.add(mesh);
    body.velocity.x += this.hv.x;
    body.velocity.z += this.hv.z;
    body.velocity.y -= FALL_V * 0.8;
    this.world.addBody(body);
    this.debris.push({ mesh, body, t: 0 });
  }

  private dropMagazine(pose: { position: THREE.Vector3; quaternion: THREE.Quaternion; direction: THREE.Vector3 }): void {
    const polymer = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.95 });
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.1, 0.04), polymer));
    mesh.position.copy(pose.position);
    mesh.quaternion.copy(pose.quaternion);
    const body = new CANNON.Body({ mass: 0.15, shape: new CANNON.Box(new CANNON.Vec3(0.013, 0.05, 0.02)), position: new CANNON.Vec3(pose.position.x, pose.position.y, pose.position.z), linearDamping: 0.05 });
    body.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
    const v = pose.direction.clone().multiplyScalar(3);
    body.velocity.set(v.x, v.y, v.z);
    body.angularVelocity.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    this.addDebris(mesh, body);
  }

  private updateDebris(dt: number): void {
    if (!this.debris.length) return;
    this.world.step(1 / 60, dt, 3);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += dt;
      d.mesh.position.set(d.body.position.x, d.body.position.y, d.body.position.z);
      d.mesh.quaternion.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w);
      if (d.t > 3) {
        this.scene.remove(d.mesh);
        this.world.removeBody(d.body);
        this.debris.splice(i, 1);
      }
    }
  }

  private killDiver(d: Diver, dir: THREE.Vector3): void {
    const { audio } = this.ctx;
    d.state = 'dead';
    d.deadT = 0;
    // Shot through, the arch goes: he flips over and drops out of it, up and away from Ravi as the air takes him
    d.vel.copy(dir).setY(0).normalize().multiplyScalar(4).add(V(0, 7, 0));
    d.spin.set(Math.random() * 3 - 1.5, Math.random() * 2 - 1, Math.random() * 3 - 1.5);
    d.e.hideWeapon();
    audio.killConfirm();
    audio.enemyScream(0.6);
    this.downed++;
    this.hud.setCounter('FBI DOWN', this.downed);
  }

  // ---- hits on him

  private hurt(n: number, by: string, tumble = 0, axis?: THREE.Vector3): void {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - n);
    this.hurtT = 0;
    this.shake = Math.min(1.4, this.shake + 0.5 + n * 0.3);
    this.ctx.bus.emit(Events.PlayerDamaged, { health: this.hp, maxHealth: MAX_HP });
    if (tumble > 0) {
      this.tumble = tumble;
      this.tumbleAxis.copy(axis && axis.lengthSq() > 1e-6 ? axis : V(Math.random() - 0.5, 0, Math.random() - 0.5)).normalize();
    }
    if (this.hp <= 0) this.die(by, null);
  }

  /**
   * Dead. Out of his eyes: the camera stays where they were and he goes
   * away from it, limp and turning over, falling on without it.
   */
  private die(by: string, fling: THREE.Vector3 | null): void {
    if (!this.alive) return;
    this.drink.abort();
    this.alive = false;
    this.phase = 'dead';
    this.pt = 0;
    this.deadAt = performance.now();
    this.deadVel.copy(fling ?? V(0, -6, 0));
    this.deadSpin.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3).multiplyScalar(fling ? 2.5 : 1);
    this.syncCamera();
    this.toNearPass(this.rig.root);
    this.toNearPass(this.pistol);
    this.camera.position.addScaledVector(V(0, 1, 0), 1.2);
    this.rig.root.visible = true;
    this.pistol.visible = true;
    this.ctx.audio.stopTrackMusic(0.5);
    this.ctx.input.exitPointerLock();
    this.warn('');
    for (const d of this.divers) d.mark.style.display = 'none';
    for (const c of this.crossings) c.mark.style.display = 'none';
    for (const m of this.birdMarks.values()) m.style.display = 'none';
    this.bossMark.style.display = 'none';
    this.ctx.bus.emit(Events.PlayerDied, { killer: by });
  }

  private updateDead(dt: number): void {
    this.deadVel.y -= 3 * dt;
    this.pos.addScaledVector(this.deadVel, dt);
    const q = Level19SkyScene._q.setFromEuler(new THREE.Euler(this.deadSpin.x * dt, this.deadSpin.y * dt, this.deadSpin.z * dt));
    this.bodyQ.premultiply(q);
    this.poseRavi({ x: 0, y: 0 }, 1);
    this.camera.lookAt(this.pos);
    this.birds.update(dt);
    for (const c of this.crossings) {
      c.a.group.position.addScaledVector(c.dir, c.speed * dt);
      for (const p of c.a.props) p.rotation.z += dt * 40;
    }
    for (const d of this.divers) if (d.state !== 'wait') d.e.update(dt);
  }

  // ---- the gulls

  private spawnFlock(Tc: number, n: number, shape: 'ball' | 'v', r: number, aside = 0): void {
    const lead = Tc - this.T;
    const y = yAt(EXIT + Tc);
    // Aimed where he'll be if he keeps going: holding a course is no way through them, every other flock
    this.flockN = (this.flockN + 1) % 2;
    const at = this.pos.clone().addScaledVector(this.hv, lead * (this.flockN ? 0.9 : 0.45));
    at.x += (Math.random() - 0.5) * r * 0.5 + aside;
    at.z += (Math.random() - 0.5) * r * 0.5 + aside * 0.4;
    const a = Math.random() * Math.PI * 2;
    const vel = V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(5 + Math.random() * 4);
    const c = at.clone().addScaledVector(vel, -lead);
    c.y = y;
    const f = this.birds.add(c, vel, n, shape, r, Math.floor(Tc * 13 + n));
    if (f && aside !== 0) f.warned = true;
  }

  private updateBirds(dt: number): void {
    this.birds.update(dt);
    let warn = false;
    const p = Level19SkyScene._a;
    for (const f of this.birds.flocks) {
      if (!f.alive) continue;
      const dy = this.pos.y - f.centre.y;
      if (dy < -260) {
        this.birds.retire(f);
        this.birdMarks.get(f)?.remove();
        this.birdMarks.delete(f);
        continue;
      }
      // Coming up: a marker on it, and the warning, inside five seconds
      const soon = dy > 0 && dy < FALL_V * 5 && !f.warned;
      let m = this.birdMarks.get(f);
      if (soon && !m) {
        m = this.mark('mk-birds', 'BIRDS');
        this.birdMarks.set(f, m);
        this.ctx.audio.gullCry(dy * 0.4);
      }
      if (m) {
        if (!soon) {
          m.remove();
          this.birdMarks.delete(f);
        } else {
          const d = this.camera.position.distanceTo(f.centre);
          const size = THREE.MathUtils.clamp((f.radius * 2 * 900) / Math.max(1, d), 26, 260);
          this.place(m, f.centre, true, 'BIRDS', size);
        }
      }
      if (soon) {
        const flat = Math.hypot(f.centre.x - this.pos.x, f.centre.z - this.pos.z);
        if (flat < f.radius + 6) warn = true;
      }
      // Into them: any bird within reach of him is hit, and so is he
      if (Math.abs(dy) < f.radius * 0.5 + 3) {
        for (let i = 0; i < f.birds.length; i++) {
          const b = f.birds[i];
          if (b.gone) continue;
          this.birds.birdAt(f, i, p);
          if (p.distanceToSquared(this.pos) < 1.9 * 1.9) {
            b.gone = true;
            this.feathers.emit(p, V(this.hv.x, -FALL_V * 0.55, this.hv.z), 6, 26);
            this.ctx.audio.fleshHit();
            this.ctx.audio.bodyThud(2);
            if (Math.random() < 0.6) this.ctx.audio.gullCry(4);
            this.hurt(1, 'A SEAGULL', 0.9, p.clone().sub(this.pos).cross(V(0, 1, 0)));
            if (!this.alive) return;
          }
        }
        // The rest of the flock scatters as he goes through
        if (Math.abs(dy) < 4) for (const b of f.birds) b.off.addScaledVector(b.scatter, dt * 0.6);
      }
    }
    if (warn) this.warn('⚠ BIRDS BELOW — STEER CLEAR');
    else if (!this.crossings.some((c) => c.Tc - this.T < 6 && c.Tc - this.T > -0.3)) this.warn('');
  }

  // ---- aircraft

  private spawnCrossing(Tc: number, kind: 'liner' | 'prop', variant: number): void {
    const a = kind === 'prop' ? turboprop() : airliner(variant);
    const speed = kind === 'prop' ? 72 : 96;
    const lead = Tc - this.T;
    // Across where he'll be if he holds his course: he has to see it coming and change it
    const P = this.pos.clone().addScaledVector(this.hv, lead * 0.6);
    P.y = yAt(EXIT + Tc);
    // Across in front of him, so he sees it coming the whole way, its line a few metres off his: a near thing unless he steers into it
    const ang = this.yaw + Math.PI / 2 + (Math.random() - 0.5) * 0.9 + (Math.random() < 0.5 ? Math.PI : 0);
    const dir = V(-Math.sin(ang), 0, -Math.cos(ang));
    // Its line far enough off his that the wingtip, not the fuselage, is what goes past: a wingspan's half and a few metres more
    P.addScaledVector(V(-dir.z, 0, dir.x), (Math.random() < 0.5 ? -1 : 1) * (a.span / 2 + 4 + Math.random() * 5));
    a.group.rotation.y = Math.atan2(-dir.x, -dir.z);
    // Jets draw a faint trail behind each engine; the turboprop doesn't
    if (kind === 'liner') {
      for (const ex of a.exhausts) {
        const t = exhaustTrail(260, 1.5);
        t.position.copy(ex);
        a.group.add(t);
      }
    }
    this.scene.add(a.group);
    const sound = this.ctx.audio.jetEngine();
    sound.setThrust(kind === 'prop' ? 0.7 : 1);
    const name = kind === 'prop' ? 'AN ISLAND HOPPER' : 'A PASSING AIRLINER';
    const c: Crossing = { a, name, P, dir, speed, Tc, sound, missed: false, mark: this.mark('mk-plane', 'AIRCRAFT') };
    this.crossings.push(c);
    this.positionCrossing(c);
  }

  private positionCrossing(c: Crossing): void {
    c.a.group.position.copy(c.P).addScaledVector(c.dir, (this.T - c.Tc) * c.speed);
  }

  private updateCrossings(dt: number): void {
    let warn = '';
    for (let i = this.crossings.length - 1; i >= 0; i--) {
      const c = this.crossings[i];
      this.positionCrossing(c);
      for (const p of c.a.props) p.rotation.z += dt * 40;
      const g = c.a.group;
      const dist = g.position.distanceTo(this.camera.position);
      c.sound.setDistance(dist);
      const left = c.Tc - this.T;
      if (left < 6 && left > -0.3) warn = left > 0 ? `⚠ AIRCRAFT CROSSING — ${left.toFixed(1)}s` : '⚠ AIRCRAFT';
      this.place(c.mark, g.position, left > -0.2 && left < 7.5, left > 0 ? `AIRCRAFT ${Math.round(dist)}M` : 'AIRCRAFT', THREE.MathUtils.clamp((c.a.span * 900) / Math.max(1, dist), 30, 300), true);
      // Swept by it?
      g.updateMatrixWorld(true);
      const local = g.worldToLocal(Level19SkyScene._a.copy(this.pos));
      if (Math.abs(left) < 0.6 && c.a.hits(local, 0.7)) {
        this.ctx.audio.carCrash(0, true);
        this.shake = 2;
        this.die(c.name, c.dir.clone().multiplyScalar(c.speed * 0.4).add(V(0, 12, 0)));
        return;
      }
      if (!c.missed && left < -0.15) {
        c.missed = true;
        const near = this.pos.distanceTo(g.position);
        if (near < c.a.span) {
          this.shake = Math.min(1.6, this.shake + 1.2 * (1 - near / c.a.span));
          this.ctx.audio.kickWhoosh();
          // The wake: a shove away from where it went by
          this.hv.addScaledVector(Level19SkyScene._b.copy(this.pos).sub(g.position).setY(0).normalize(), 6 * (1 - near / c.a.span));
          if (near < c.a.span * 0.6) this.say('RAVI', ['WHOA—', 'That one had my name on it.', 'Is NOBODY looking out the window?!'][i % 3], RAVI, 2);
        }
      }
      if (left < -9) {
        c.sound.stop();
        this.scene.remove(g);
        c.mark.remove();
        this.crossings.splice(i, 1);
      }
    }
    if (warn) this.warn(warn);
  }

  // ---- the FBI

  /**
   * The agents: down from above head-first, then flat on the wind holding
   * their distance off to one side of him and a little below — where he can
   * see them as he looks down past his hands — working slowly round him and
   * shooting. They don't close on him. Before a burst the marker goes red and
   * the right arm comes round and out at him; the burst is two rounds, and
   * it's a while before the next. Shot, they go limp and turn over and the
   * air takes them away. Anyone still up after a while pulls and is gone.
   */
  private updateDivers(dt: number): void {
    const { audio } = this.ctx;
    const tmp = Level19SkyScene._b;
    let wave = -1;
    for (const d of this.divers) {
      if (d.state === 'wait') {
        if (this.T >= d.at) {
          this.sendIn(d, wave !== Math.floor(d.at));
          wave = Math.floor(d.at);
        }
        if (d.state === 'wait') continue;
      }
      d.t += dt;
      const e = d.e;
      const pose = d.pose;
      if (d.state === 'dead') {
        // Limp: nothing holding him flat, turning over, the air taking him up and away
        d.deadT += dt;
        pose.limp = Math.min(1, pose.limp + dt * 4);
        pose.aimK = Math.max(0, pose.aimK - dt * 6);
        d.rel.addScaledVector(d.vel, dt);
        d.vel.y += 3.5 * dt;
        d.q.premultiply(Level19SkyScene._q.setFromEuler(new THREE.Euler(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt)));
        this.putDiver(d);
        e.update(dt);
        d.mark.style.display = 'none';
        if (d.deadT > 7) {
          e.root.visible = false;
          d.state = 'wait';
          d.at = Infinity;
        }
        continue;
      }
      if (d.state === 'leave') {
        // Pulled: his canopy takes him up and out of it
        d.deadT += dt;
        d.vel.y = Math.min(48, d.vel.y + dt * 80);
        pose.aimK = Math.max(0, pose.aimK - dt * 6);
        pose.hang = Math.min(1, pose.hang + dt * 3);
        d.q.slerp(Level19SkyScene._q.setFromEuler(new THREE.Euler(0, Math.atan2(d.rel.x, d.rel.z), 0)), Math.min(1, dt * 4));
        d.rel.addScaledVector(d.vel, dt);
        this.putDiver(d);
        e.update(dt);
        d.mark.style.display = 'none';
        if (d.deadT > 4) {
          e.root.visible = false;
          d.state = 'wait';
          d.at = Infinity;
        }
        continue;
      }
      // Anybody still up after fifteen seconds or so pulls and is gone
      if (d.t > 15 + (d.dist % 3) && d.burst <= 0 && d.glint <= 0) {
        d.state = 'leave';
        d.deadT = 0;
        d.vel.set(d.rel.x * 0.1, 10, d.rel.z * 0.1);
        audio.velcro();
        continue;
      }
      if (d.state === 'dive') {
        // Head-down from above, steering in toward his slot round Ravi, flattening out as he gets there
        const slot = tmp.set(Math.cos(d.ang) * d.dist, d.dy, Math.sin(d.ang) * d.dist);
        const to = slot.clone().sub(d.rel);
        const dist = to.length();
        d.vel.lerp(to.normalize().multiplyScalar(Math.min(30, dist * 1.3)), Math.min(1, dt * 1.6));
        d.rel.addScaledVector(d.vel, dt);
        const head = d.vel.clone().setY(0);
        const want = diverQuat(head.lengthSq() > 0.1 ? head : V(-d.rel.x, 0, -d.rel.z), 0, THREE.MathUtils.clamp(-d.vel.y / 30, 0, 1) * 1.1, 'enemy', new THREE.Quaternion());
        d.q.slerp(want, Math.min(1, dt * 5));
        if (dist < 3) {
          d.state = 'hold';
          d.fireT = 2.5 + Math.random() * 1.5;
        }
      } else {
        // Holding off: his distance, slowly round him, bobbing a little on the air
        d.ang += d.orbit * dt;
        const slot = tmp.set(Math.cos(d.ang) * d.dist, d.dy + Math.sin(d.t * 0.7) * 1.2, Math.sin(d.ang) * d.dist);
        d.vel.lerp(slot.clone().sub(d.rel).multiplyScalar(1.4), Math.min(1, dt * 2));
        d.rel.addScaledVector(d.vel, dt);
        // Facing him, turning into the drift
        const toRavi = d.rel.clone().negate();
        const want = diverQuat(toRavi, d.orbit * 1.2 + Math.sin(d.t * 0.9) * 0.08, 0.1, 'enemy', new THREE.Quaternion());
        d.q.slerp(want, Math.min(1, dt * 3));
        // Shooting: the marker goes red and the arm comes up, then two rounds
        d.fireT -= dt;
        if (d.fireT <= 0 && d.glint <= 0 && d.burst <= 0) d.glint = 0.75;
        if (d.glint > 0) {
          d.glint -= dt;
          if (d.glint <= 0) {
            d.burst = 2;
            d.burstT = 0;
          }
        }
        if (d.burst > 0) {
          d.burstT -= dt;
          if (d.burstT <= 0) {
            d.burst--;
            d.burstT = 0.2;
            this.diverShot(d);
            if (!this.alive) return;
            if (d.burst === 0) d.fireT = 3.6 + Math.random() * 2.2;
          }
        }
        const aiming = d.glint > 0 || d.burst > 0 || d.fireT > 3.2;
        pose.aimK += ((aiming ? 1 : 0) - pose.aimK) * Math.min(1, dt * 5);
        pose.steer = THREE.MathUtils.clamp(d.orbit * 3, -1, 1);
      }
      if (pose.aimK > 0.01) {
        // The arm out at him: his chest to Ravi's, in his own frame
        const chest = this.pos.clone().sub(e.chest.getWorldPosition(Level19SkyScene._c));
        pose.aim.copy(chest.applyQuaternion(Level19SkyScene._q.copy(d.q).invert())).normalize();
      }
      this.putDiver(d);
      e.update(dt);
      const dist = d.rel.length();
      const at = tmp.copy(this.pos).add(d.rel);
      const danger = d.glint > 0;
      this.place(d.mark, at, dist > 4, danger ? '! FBI !' : 'FBI', THREE.MathUtils.clamp(1400 / Math.max(1, this.camera.position.distanceTo(at)), 24, 90), danger);
      d.mark.style.color = danger ? '#ff2a2a' : '#ff8a70';
    }
  }

  private sendIn(d: Diver, firstOfWave: boolean): void {
    d.state = 'dive';
    d.hp = 2;
    d.t = 0;
    d.pose.limp = 0;
    d.pose.hang = 0;
    d.pose.aimK = 0;
    const a = this.yaw - Math.PI / 2 + (Math.random() - 0.5) * 2.4 + (Math.random() < 0.5 ? Math.PI : 0);
    d.rel.set(Math.cos(a) * 40, 85 + Math.random() * 20, Math.sin(a) * 40);
    d.vel.set(0, -25, 0);
    d.q.copy(diverQuat(V(-d.rel.x, 0, -d.rel.z), 0, 1, 'enemy', new THREE.Quaternion()));
    // His slot: well off to one side and below, in front of where Ravi's looking more often than not
    d.ang = a + (Math.random() - 0.5) * 0.8;
    d.dist = 15 + Math.random() * 8;
    d.dy = -7 - Math.random() * 8;
    d.orbit = (Math.random() < 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.06);
    d.e.root.visible = true;
    if (!firstOfWave) return;
    if (d.at < 9) this.say('RAVI', 'The FBI? They jumped too?! Since when is the FBI on this?!', RAVI, 3);
    else if (Math.random() < 0.6) this.say('FBI AGENT', ['Federal agents! Keep your arms where we can see them!', 'Put the gun down, sir! You have nowhere to go!', 'Suspect is falling, I repeat, suspect is falling!'][Math.floor(Math.random() * 3)], 0.82, 2.6);
  }

  /** Put the agent's body where he is, his middle at his place relative to Ravi. */
  private putDiver(d: Diver): void {
    const r = d.e.root;
    r.quaternion.copy(d.q);
    r.position.copy(this.pos).add(d.rel).sub(V(0, 1.0, 0).applyQuaternion(d.q));
  }

  private diverShot(d: Diver): void {
    const { audio } = this.ctx;
    const from = d.e.pistolMuzzleWorld(new THREE.Vector3());
    const dist = d.rel.length();
    // Not easy, from a falling man at twenty metres: harder still if Ravi's moving, and hardly at all with him pencilled in
    const p = THREE.MathUtils.clamp(0.26 - this.hv.length() / 45 - dist / 140 - this.pencil * 0.15, 0.03, 0.26);
    const hit = Math.random() < p;
    const to = this.pos.clone();
    if (!hit) to.add(V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1.2 + Math.random() * 2.2));
    const dir = to.clone().sub(from).normalize();
    this.particles.muzzleFlash(from, dir);
    this.particles.tracer(from, to.clone().addScaledVector(dir, hit ? 0 : 40), 0xffc890);
    audio.enemyGunshot(dist);
    if (hit) {
      this.hurt(1, 'AN FBI AGENT');
      this.holesIn += 1;
    } else {
      if (Math.random() < 0.5) this.holesIn += 0.5;
      audio.bulletWhiz();
    }
  }

  // ---- the boss, below

  private updateBossFall(dt: number): void {
    const b = this.boss;
    const T = this.T;
    if (this.bossOpenT < 0) {
      // Before his canopy: falling with Ravi, far below; drifting under Ravi's line toward the end
      const k = smooth((T - 50) / 6);
      const target = V(22 - 12 * k, -235, -95 + 88 * k);
      this.bossRel.lerp(target, Math.min(1, dt * 0.5));
      this.bossPos.copy(this.pos).add(this.bossRel);
      if (T >= 57) {
        this.bossOpenT = 0;
        this.bossVy = -FALL_V;
        this.ctx.audio.velcro();
      }
      const q = diverQuat(V(0, 0, -1), Math.sin(this.time * 0.6) * 0.1, 0, 'enemy', new THREE.Quaternion());
      b.root.quaternion.copy(q);
      b.root.position.copy(this.bossPos).sub(V(0, 1, 0).applyQuaternion(q));
    } else {
      // Under his canopy: slowing to a drift, swinging round to face Ravi as he comes down past, shooting
      this.bossOpenT += dt;
      const ot = this.bossOpenT;
      this.bossVy += (-6 - this.bossVy) * Math.min(1, dt * 2.2);
      this.bossPos.y += this.bossVy * dt;
      this.bossPos.x += 1.5 * dt;
      const ch = this.bossChute;
      ch.group.visible = true;
      ch.setOpen(smooth(ot / 1.1));
      const toRavi = this.pos.clone().sub(this.bossPos).setY(0);
      const yaw = Math.atan2(-toRavi.x, -toRavi.z);
      const upright = smooth(ot / 0.8);
      const hang = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
      const flatQ = diverQuat(V(0, 0, -1), 0, 0, 'enemy', new THREE.Quaternion());
      b.root.quaternion.copy(flatQ).slerp(hang, upright);
      b.root.position.copy(this.bossPos).sub(V(0, 1, 0).applyQuaternion(b.root.quaternion));
      ch.group.position.copy(this.bossPos).add(V(0, 0.45, 0));
      ch.group.rotation.set(Math.sin(ot * 1.3) * 0.08, yaw, Math.sin(ot * 0.9) * 0.06);
      // Shooting up at him as he comes down past
      const rel = this.pos.clone().sub(this.bossPos);
      const d = rel.length();
      if (ot > 1.4 && d < 160 && this.pos.y > this.bossPos.y - 40) {
        this.bossPose.aim.copy(rel).applyQuaternion(b.root.quaternion.clone().invert()).normalize();
        this.bossPose.aimK = Math.min(1, this.bossPose.aimK + dt * 4);
        this.bossFire -= dt;
        if (this.bossFire <= 0) {
          this.bossFire = 0.42 + Math.random() * 0.3;
          const from = b.pistolMuzzleWorld(new THREE.Vector3());
          const hit = Math.random() < 0.12;
          const to = this.pos.clone().add(hit ? V(0, 0, 0) : V(Math.random() - 0.5, 0.4 + Math.random(), Math.random() - 0.5).multiplyScalar(2));
          this.particles.muzzleFlash(from, to.clone().sub(from).normalize());
          this.particles.tracer(from, to, 0xffd9a0);
          this.ctx.audio.enemyGunshot(d);
          this.holesIn += hit ? 1 : 0.7;
          if (hit) this.hurt(1, 'THE BOSS');
          else if (d < 50) this.ctx.audio.bulletWhiz();
        }
      } else this.bossPose.aimK = Math.max(0, this.bossPose.aimK - dt * 4);
      this.bossPose.hang = upright;
      if (ot > 1.6 && ot - dt <= 1.6) this.say('THE BOSS', 'RAVI! You are FIRED! Do you hear me? FIRED!', BOSS, 3);
      if (ot > 5.0 && ot - dt <= 5.0) this.say('RAVI', 'I quit at nine this morning. Check your email.', RAVI, 2.6);
    }
    b.update(dt);
    const far = this.pos.distanceTo(this.bossPos);
    this.place(this.bossMark, this.bossPos, far > 25 && (this.phase === 'fall' || this.tt > 3.3), `THE BOSS ${Math.round(far)}M`);
  }

  // ================================================================ 3. the chute

  private pullCam = new THREE.Vector3();
  private pullYaw = 0;
  private pullPitch = -0.95;
  private rip: CanopyRip | null = null;

  private startPull(): void {
    this.drink.abort();
    this.phase = 'pull';
    this.pt = 0;
    this.hud.hide();
    this.warn('');
    this.setObjective('');
    this.altEl.style.opacity = '0';
    this.letterbox.classList.remove('open');
    for (const d of this.divers) d.mark.style.display = 'none';
    for (const c of this.crossings) c.mark.style.display = 'none';
    for (const m of this.birdMarks.values()) m.remove();
    this.birdMarks.clear();
    this.bossMark.style.display = 'none';
    this.ctx.input.exitPointerLock();
    this.ctx.audio.stopTrackMusic(1.5);
    this.ctx.audio.velcro();
    this.ctx.audio.kickWhoosh();
    this.pullCam.copy(this.camera.position);
    this.pullYaw = this.yaw;
    this.pullPitch = this.pitch;
    // Out of the first-person rig and into his own body: he'll look down at it
    this.rig.root.visible = true;
    this.poseRavi({ x: 0, y: 0 }, 0);
    this.camera.fov = 78;
    this.camera.updateProjectionMatrix();
    // Him and his canopy are drawn in their own close-up pass (layer 1): the world's camera keeps
    // a near plane far enough out that the island's shore and the sea don't fight for the same depth
    this.toNearPass(this.rig.root);
    this.toNearPass(this.pistol);
    // The holes: however many rounds came his way, and never fewer than a handful
    const n = THREE.MathUtils.clamp(Math.round(5 + this.holesIn * 0.6), 8, 18);
    const holes: { u: number; v: number; r: number }[] = [];
    for (let i = 0; i < n; i++) holes.push({ u: 0.06 + Math.random() * 0.88, v: 0.14 + Math.random() * 0.72, r: 0.009 + Math.random() * (i < 3 ? 0.045 : 0.02) });
    this.scene.remove(this.chute.group);
    this.chute = canopy({ span: 8, chord: 3, rise: 4.8, colours: [0x15264a, 0xc9a245, 0x15264a, 0xf1efe6, 0x15264a, 0xc9a245, 0x15264a], holes });
    this.chute.setOpen(0);
    this.scene.add(this.chute.group);
    this.toNearPass(this.chute.group);
    // The island he'll wash up on: put where he'll see its beach as he comes down
    const head = V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const s = ISLANDS[0];
    const land = this.pos.clone().addScaledVector(head, 70);
    const cx = land.x + head.x * (s.r + 140);
    const cz = land.z + head.z * (s.r + 140);
    this.islands[0].position.set(cx - s.x, 0, cz - s.z);
    const sh = (this.sea.material as THREE.ShaderMaterial).uniforms.uShoals.value as THREE.Vector4[];
    sh[0].set(cx, cz, s.r * 1.05, s.r * 1.9);
    // The agents left fall on past him, out of it
    for (const d of this.divers) d.e.root.visible = false;
  }

  /** When the wind takes what's left of it (pull seconds), and when he goes over head-first after it. */
  private static readonly RIP_AT = 4.9;
  private static readonly DROP_AT = 5.9;

  private updatePull(dt: number): void {
    const p = this.pt;
    const RIP = Level19SkyScene.RIP_AT;
    const DROP = Level19SkyScene.DROP_AT;
    // How fast he's coming down: the jolt off terminal, a moment of hanging under it, and then
    // nothing over him at all — head-down, faster than he's gone all day
    const v = track([[0, FALL_V], [0.9, 13], [3.8, 17], [RIP, 19], [RIP + 0.6, 30], [DROP + 0.5, 60], [DROP + 1.5, 78]], p);
    this.pos.y -= v * dt;
    const head = V(-Math.sin(this.pullYaw), 0, -Math.cos(this.pullYaw));
    this.pos.addScaledVector(head, 6 * dt);
    // The canopy: out of the pack and open over him, sagging with the air going out through the holes —
    // and then the wind gets into them and it comes apart, cell after cell
    const open = smooth(p / 0.9);
    const sag = p > 4 ? 1 - 0.22 * smooth((p - 4) / 0.9) + Math.sin(p * 9) * 0.05 * smooth(p - 4) : 1;
    this.chute.group.visible = true;
    this.chute.setOpen(open * sag);
    const spin = this.pullYaw + Math.min(p, RIP) * 0.42 + smooth((Math.min(p, DROP) - 4.5) / 4) * 1.4;
    this.chute.group.rotation.set(Math.sin(p * 2.3) * 0.06 * open + (p > 4 ? Math.sin(p * 13) * 0.04 : 0), spin, Math.sin(p * 1.7) * 0.08 * open);
    for (const [i, t] of this.chute.tatters.entries()) t.rotation.set(Math.sin(p * 13 + i) * 0.9, 0, Math.sin(p * 9 + i * 2) * 0.5);
    if (p >= RIP && !this.rip) {
      this.rip = new CanopyRip(this.chute, this.scene, 1);
      for (const t of this.chute.tatters) t.visible = false;
      this.ctx.audio.fabricRip(true);
      this.shake = 1.2;
      this.say('RAVI', 'No no no no NO—', RAVI, 1.6);
    }
    if (this.rip) {
      const before = this.rip.torn;
      this.rip.update(dt, p - RIP);
      if (this.rip.torn > before && this.rip.torn > 1) this.ctx.audio.fabricRip(false);
    }
    // Him: flat on the wind, snapped upright under it; then over, head-first, nothing holding him
    const up = smooth((p - 0.15) / 0.6);
    const fall = smooth((p - DROP) / 0.7);
    const hang = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(p * 2) * 0.05, spin + Math.PI, 0));
    if (p < 0.35) {
      this.poseRavi({ x: 0, y: 0 }, smooth(p / 0.35));
    } else if (fall <= 0) {
      this.bodyQ.slerp(hang, up);
      const r = this.rig.root;
      r.quaternion.copy(this.bodyQ);
      r.position.copy(this.pos).sub(V(0, 1.0, 0).applyQuaternion(this.bodyQ));
      raviUnderCanopy(this.rig, this.time, 1 + smooth(p - RIP) * 2);
      this.holdPistol();
    } else {
      // Head-down: his head to the sea, his front the way he was facing, arms everywhere
      const f = V(-Math.sin(spin + Math.PI), 0, -Math.cos(spin + Math.PI)).negate();
      const y = V(0, -1, 0);
      const x = new THREE.Vector3().crossVectors(y, f).normalize();
      const dive = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)));
      this.bodyQ.copy(hang).slerp(dive, fall);
      this.poseRavi({ x: 0, y: 0 }, 1);
    }
    this.pistol.visible = p < 0.5;
    // The risers come off his shoulders: the canopy's origin a little over his head
    const headAt = this.rig.bones.get('neck_01')!.getWorldPosition(new THREE.Vector3());
    // A ram-air wing flies a little ahead of the man under it
    const ahead = V(-Math.sin(spin), 0, -Math.cos(spin));
    if (!this.rip || p - RIP < 0.8) this.chute.group.position.set(headAt.x, this.rig.root.position.y + 1.55, headAt.z).addScaledVector(ahead, 0.9 * up);
    // Camera: his own eyes all the way — the jolt as it opens, his head yanked up to it, a long look
    // as it goes to pieces, then over and straight down at the sea coming up, face first into it
    const headPos = this.rig.bones.get('head')!.getWorldPosition(Level19SkyScene._a);
    const face = V(-Math.sin(spin), 0, -Math.cos(spin));
    this.camera.position.copy(headPos).add(V(0, 0.1 * (1 - fall) - 0.18 * fall, 0)).addScaledVector(face, 0.16 * up * (1 - fall));
    const pitch = track([[0, this.pullPitch], [0.2, this.pullPitch - 0.25], [1.0, 1.36], [RIP, 1.47], [DROP, 1.4], [DROP + 0.8, -1.55]], p);
    const yaw = this.pullYaw + wrapAngle(spin - this.pullYaw) * up + Math.sin(p * 0.8) * 0.1 * up * (1 - fall);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(pitch, yaw, Math.sin(p * 1.6) * 0.04 + fall * Math.sin(p * 3) * 0.12);
    if (p > 0.15 && p - dt <= 0.15) this.shake = 1.4;
    this.shake = Math.max(this.shake, p > RIP ? 0.45 : p > 4 ? 0.25 : 0.1);
    this.applyShake(dt);
    if (p > 0.35 && p - dt <= 0.35) {
      this.ctx.audio.kickImpact();
      this.ctx.audio.effortGrunt(0.8);
    }
    if (p > 2.1 && p - dt <= 2.1) this.say('RAVI', '...Huh.', RAVI, 1.3);
    if (p > 3.2 && p - dt <= 3.2) this.say('RAVI', 'Those are bullet holes.', RAVI, 1.4);
    if (p > 4.2 && p - dt <= 4.2) this.say('RAVI', 'That is a LOT of bullet holes.', RAVI, 0.7);
    if (p > DROP + 1 && this.pos.y < 160 && this.captionT <= 0) this.say('RAVI', 'OH NO OH NO OH NO—', RAVI, 3);
    this.wind?.set(0.35 + Math.min(1.2, v / FALL_V) * 0.6);
    this.wind?.setRush(Math.max(0, (v - FALL_V) / 24));
    this.updateBossAbove(dt);
    this.birds.update(dt);
    this.T += dt;
    for (const c of this.crossings) this.positionCrossing(c);
    // Face first: his head is the first of him into it
    if (this.camera.position.y <= 0.3) this.startSplash();
  }

  /** The boss after the pull: drifting on above, out of it. */
  private updateBossAbove(dt: number): void {
    this.bossPos.y += -6 * dt;
    this.bossPos.x += 1.5 * dt;
    const b = this.boss;
    b.root.position.copy(this.bossPos).sub(V(0, 1, 0).applyQuaternion(b.root.quaternion));
    this.bossChute.group.position.copy(this.bossPos).add(V(0, 0.45, 0));
    this.bossPose.aimK = Math.max(0, this.bossPose.aimK - dt * 3);
    this.bossPose.hang = 1;
    b.update(dt);
  }

  // ================================================================ the sea

  private startSplash(): void {
    this.phase = 'splash';
    this.pt = 0;
    const { audio } = this.ctx;
    audio.splash(true);
    audio.bodyThud(0);
    this.wind?.stop();
    this.wind = null;
    this.under = audio.underwaterLoop();
    this.under.set(1);
    this.droplets.emit(V(this.pos.x, 0.5, this.pos.z), V(0, 9, 0), 9, 260, 1.6);
    this.whiteEl.style.transition = 'none';
    this.whiteEl.style.opacity = '0.95';
    this.captionEl.style.opacity = '0';
  }

  private updateSplash(dt: number): void {
    const p = this.pt;
    // Under: the white of the hit, then the blue closing over, then nothing
    this.whiteEl.style.opacity = String(Math.max(0, 0.95 - p * 5));
    this.waterEl.style.opacity = String(smooth(p / 0.3));
    this.fadeEl.style.opacity = String(smooth((p - 1.1) / 0.6));
    this.camera.position.y -= Math.max(0, 8 - p * 10) * dt;
    this.droplets.update(dt, 9.8, 0.4);
    if (p >= 1.75) this.startBlack();
  }

  // ================================================================ 4. black

  private startBlack(): void {
    this.phase = 'black';
    this.pt = 0;
    // Nothing from the fall carries over: whatever was still marked goes with it
    this.marks.style.display = 'none';
    this.fadeEl.style.transition = 'none';
    this.fadeEl.style.opacity = '1';
    this.waterEl.style.opacity = '0';
    this.under?.stop();
    this.under = null;
    this.wind?.stop();
    this.wind = null;
    this.jetSound?.stop();
    this.jetSound = null;
    for (const c of this.crossings) c.sound.stop();
    this.ctx.audio.hushSfx(true, 0.4);
  }

  private updateBlack(): void {
    // Build the beach while there's nothing to see; five seconds, to the frame, of black
    if (!this.beach && this.pt > 0.1) this.buildBeachScene();
    if (this.pt >= BLACK_SECONDS) this.startBeach();
  }

  // ================================================================ 5. the beach

  private buildBeachScene(): void {
    const b = buildBeach();
    this.beach = b;
    // His coworkers, stood round him at the water's edge, in their kit
    const names: [string, number, { cap?: boolean; glasses?: boolean }, [number, number]][] = [
      ['SANJAY', 6, {}, [0.35, -1.25]],
      ['DEV', 4, { cap: false, glasses: true }, [1.15, -0.65]],
      ['MARCUS', 9, {}, [1.55, 0.35]],
      ['OWEN', 7, { cap: false }, [1.15, 1.35]],
      ['NIKHIL', 3, {}, [0.15, 1.85]],
      ['TOMMY', 5, { cap: false }, [-0.95, -1.15]],
      ['RAJ', 2, { cap: false }, [-0.75, 1.55]]
    ];
    for (const [name, idx, look, [x, z]] of names) {
      const e = new Enemy(V(x, sandY(x, z), z), 0, idx, { name, civilian: true });
      e.restyleCrew(look);
      e.wearCrewKit();
      armWithAK(e);
      // Leant in over him, rifles hanging, until he's up
      e.setConcerned();
      e.pose = { lean: 0.42 };
      e.yaw = Math.atan2(x, z);
      e.root.rotation.y = e.yaw;
      b.scene.add(e.root);
      this.crew.push(e);
    }
    const stain = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.012), new THREE.MeshStandardMaterial({ color: 0xd88a86, roughness: 0.5 }));
    stain.position.set(-0.02, -0.06, -0.141);
    this.crew[0].addChestPatch(stain);
    // And the boss, at the far end, crawling
    const boss = new Enemy(V(-24.6, 0, -3.6), 0, 7, { name: 'THE BOSS', boss: true });
    boss.setFurious();
    b.scene.add(boss.root);
    this.beachBoss = boss;
    this.bossCrawlS = 0;
    this.placeBeachBoss(0);
    this.fpCam.position.set(0, 0.2, 0.05);
  }

  /** Where the boss has got to, crawling on up and along from the end of his drag mark. */
  private placeBeachBoss(k: number): void {
    const b = this.beachBoss!;
    const dir = V(-0.3, 0, -0.95).normalize();
    const at = V(-24.6, 0, -3.6).addScaledVector(dir, this.bossCrawlS);
    at.y = sandY(at.x, at.z) + 0.16;
    const q = diverQuat(dir, Math.sin(k * Math.PI * 2) * 0.06, -0.08, 'enemy', new THREE.Quaternion());
    b.root.quaternion.copy(q);
    b.root.position.copy(at).sub(V(0, 1, 0).applyQuaternion(q));
    enemyCrawl(b, k);
  }

  private beachLines1(): DialogueLine[] {
    return [
      { speaker: 'SANJAY', text: 'Ravi? Ravi! He is breathing. Dev, he is breathing.', pitch: SANJAY },
      { speaker: 'DEV', text: 'Told you. Nobody drowns on their day off. It is in the handbook.', pitch: DEV },
      { speaker: 'RAVI', text: 'Sanjay...? Dev? How are you all here? I fell out of a plane.', pitch: RAVI },
      { speaker: 'SANJAY', text: 'It was on the news. A big jet with nobody flying it, going down over the islands. Dev said: that is Ravi’s plane.', pitch: SANJAY },
      { speaker: 'DEV', text: 'So we took the van.', pitch: DEV },
      { speaker: 'RAVI', text: '...The van.', pitch: RAVI },
      { speaker: 'DEV', text: 'It floats now. Do not ask about the van.', pitch: DEV }
    ];
  }

  private beachLines2(): DialogueLine[] {
    return [
      { speaker: 'SANJAY', text: 'And look who washed up with you.', pitch: SANJAY },
      { speaker: 'DEV', text: 'He has been crawling like that for twenty minutes. He has made it about four metres.', pitch: DEV },
      { speaker: 'SANJAY', text: 'He is not getting off this island, Ravi. Whatever he has got left, we are right behind you. All of us.', pitch: SANJAY },
      { speaker: 'DEV', text: 'The kill switch is still on him. Go and finish your shift.', pitch: DEV },
      { speaker: 'RAVI', text: '...Alright. Let’s go get our boss.', pitch: RAVI }
    ];
  }

  private startBeach(): void {
    const { audio, engine } = this.ctx;
    this.phase = 'beach';
    this.pt = 0;
    this.beachStep = 0;
    this.scene = this.beach!.scene;
    this.fadeEl.style.transition = 'opacity 1.2s';
    this.fadeEl.style.opacity = '0';
    this.lidTop.style.transform = this.lidBot.style.transform = 'scaleY(1)';
    this.letterbox.classList.remove('open');
    audio.hushSfx(false, 1.5);
    this.surf = audio.surfLoop();
    this.surf.set(0.9);
    audio.wakeRing(6);
    engine.renderer.domElement.style.filter = 'blur(8px) brightness(1.5)';
    this.canvasFilter = true;
    this.lookYaw = Math.atan2(-0.35, 1.25);
    this.lookPitch = 0.85;
  }

  private updateBeach(dt: number): void {
    const p = this.pt;
    const b = this.beach!;
    const { audio, engine } = this.ctx;
    // Coming round: the eyes flicker open and shut and open; the blur and the glare go
    const lid = track([[0, 1], [0.8, 1], [1.2, 0.55], [1.5, 1], [2.3, 0.35], [2.6, 0.75], [3.4, 0]], p);
    this.lidTop.style.transform = this.lidBot.style.transform = `scaleY(${lid.toFixed(3)})`;
    if (p < 5.5) {
      const blur = 8 * (1 - smooth((p - 0.8) / 4.5));
      const glare = 1 + 0.5 * (1 - smooth((p - 0.8) / 3.5));
      engine.renderer.domElement.style.filter = `blur(${blur.toFixed(2)}px) brightness(${glare.toFixed(2)})`;
    } else if (this.canvasFilter) {
      engine.renderer.domElement.style.filter = '';
      this.canvasFilter = false;
    }
    if (p > 1.4 && p - dt <= 1.4) audio.groan(0.8);
    // The dialogue: first lying there, then sat up looking down the beach
    if (this.beachStep === 0 && p > 3.6) {
      this.beachStep = 1;
      this.dialogue.play(this.beachLines1(), () => {
        this.beachStep = 2;
        this.sitT = 0;
        // Up straight, rifles up: now they're ready for him
        for (const e of this.crew) {
          e.setSerious();
          e.pose = null;
          e.setRestCarry(true);
        }
        audio.groan(0.5);
      });
    }
    if (this.beachStep === 2) {
      this.sitT += dt;
      if (this.sitT > 2.9) {
        this.beachStep = 3;
        this.dialogue.play(this.beachLines2(), () => {
          this.beachStep = 4;
          this.sitT = 0;
        });
      }
    } else if (this.beachStep === 3) this.sitT += dt;
    if (this.beachStep === 4) {
      this.sitT += dt;
      this.fadeEl.style.transition = 'none';
      this.fadeEl.style.opacity = String(smooth((this.sitT - 1.2) / 1.6));
      if (this.sitT > 3) this.endEl.style.opacity = '1';
      if (this.sitT > 7.5 && !this.handedOff) {
        this.handedOff = true;
        this.ctx.bus.emit(Events.Level19Complete);
      }
    }
    // The camera: his eyes, on his back looking up at them, then sitting up and round to the boss
    const sitting = this.beachStep >= 2;
    const sit = sitting ? smooth((this.beachStep === 2 ? this.sitT : 9) / 2.2) : 0;
    const eye = V(0, 0.2 + sit * 0.62, 0.05 + sit * 0.28);
    eye.y += sandY(eye.x, eye.z);
    this.fpCam.position.copy(eye);
    let wantYaw: number;
    let wantPitch: number;
    const sp = this.speakerHead();
    if (sitting) {
      // The boss, down the far end; back round to Sanjay when he says his piece
      const bp = this.beachBoss!.root.position.clone().add(V(0, 0.3, 0));
      const yb = yawPitchTo(eye, bp);
      const toSanjay = this.beachStep === 3 && this.dialogue.speaker === 'SANJAY' && this.lineIndex() >= 2 && sp;
      const k = this.beachStep === 2 ? smooth((this.sitT - 0.6) / 1.8) : 1;
      const ys = toSanjay ? yawPitchTo(eye, sp) : yb;
      wantYaw = toSanjay ? ys.yaw : this.lookYaw + wrapAngle(yb.yaw - this.lookYaw) * k;
      wantPitch = toSanjay ? ys.pitch : THREE.MathUtils.lerp(0.85, yb.pitch, k);
      // A long lens on him while they talk about him
      const zoom = this.beachStep === 3 && !toSanjay ? 1 : 0;
      const fov = zoom ? 18 : 70;
      this.fpCam.fov += (fov - this.fpCam.fov) * Math.min(1, dt * 2);
      this.fpCam.updateProjectionMatrix();
    } else if (sp) {
      // Lying down: from one face to the next as they speak
      const yp = yawPitchTo(eye, sp);
      wantYaw = yp.yaw;
      wantPitch = Math.min(1.35, yp.pitch);
    } else {
      wantYaw = Math.atan2(-0.35, 1.25) + Math.sin(p * 0.3) * 0.1;
      wantPitch = 0.85;
    }
    this.lookYaw += wrapAngle(wantYaw - this.lookYaw) * Math.min(1, dt * 2.2);
    this.lookPitch += (wantPitch - this.lookPitch) * Math.min(1, dt * 2.2);
    this.fpCam.rotation.order = 'YXZ';
    this.fpCam.rotation.set(this.lookPitch, this.lookYaw, sitting ? 0 : 0.08);
    // Them, looking at him; the boss, still going
    for (const e of this.crew) {
      e.setHeadLook(eye);
      e.update(dt);
    }
    const pull = (this.time * 0.55) % 1;
    this.bossCrawlS += dt * 0.12 * Math.max(0, Math.sin(pull * Math.PI * 2));
    this.placeBeachBoss(pull);
    this.beachBoss!.update(dt);
    b.update(dt, this.time, this.fpCam);
  }

  private lineIndex(): number {
    return (this.dialogue as unknown as { index: number }).index ?? 0;
  }

  /** The head of whoever is talking, if it's one of them. */
  private speakerHead(): THREE.Vector3 | null {
    const s = this.dialogue.speaker;
    if (!s) return null;
    const e = this.crew.find((c) => c.name === s);
    return e ? e.headWorld(new THREE.Vector3()) : null;
  }

  // ================================================================ frame

  update(dt: number, _time: number): void {
    this.time += dt;
    this.pt += dt;
    if (this.phase === 'exit' || this.phase === 'fall') this.tt += dt;
    if (this.captionT > 0) {
      this.captionT -= dt;
      if (this.captionT <= 0) this.captionEl.style.opacity = '0';
    }
    const { input } = this.ctx;
    if ((this.phase === 'fall' || this.phase === 'exit') && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();
    // The mouse, once a frame: the fall turns his head with it
    const md = input.consumeMouseDelta();
    this.mouse.set(md.dx, md.dy);
    switch (this.phase) {
      case 'exit':
        this.updateExit(dt);
        if (this.phase === 'exit') {
          this.updateBossFall(dt);
          this.birds.update(dt);
        }
        break;
      case 'fall':
        this.updateFall(dt);
        break;
      case 'pull':
        this.updatePull(dt);
        break;
      case 'splash':
        this.updateSplash(dt);
        break;
      case 'black':
        this.updateBlack();
        break;
      case 'beach':
        this.updateBeach(dt);
        break;
      case 'dead':
        this.updateDead(dt);
        break;
    }
    if (this.phase !== 'beach' && this.phase !== 'black') {
      // The sky stays round the camera; the cloud decks white the view out as he goes through them
      this.sky.position.copy(this.camera.position);
      (this.sea.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
      let white = 0;
      for (const d of this.decks) white = Math.max(white, d.inside(this.camera.position.y));
      if (this.phase !== 'splash') this.whiteEl.style.opacity = String(Math.min(0.78, white * 1.1));
      if (white > 0.3 && this.phase === 'fall') this.hv.multiplyScalar(1 - dt * 0.1);
      this.particles.update(dt);
      this.feathers.update(dt, 0, 1.2);
      if (this.phase !== 'splash') this.droplets.update(dt, 9.8, 0.4);
    }
    this.dialogue.update(dt);
    input.endFrame();
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (this.phase === 'black') {
      // Nothing to see but black; compile the beach behind it
      if (this.beach && !this.warmedBeach) {
        this.warmedBeach = true;
        renderer.compile(this.beach.scene, this.fpCam);
      }
      return;
    }
    if (this.phase === 'beach') {
      renderer.render(this.scene, this.fpCam);
      return;
    }
    if (!this.warmed) {
      this.warmed = true;
      // Everyone the fall will need, compiled now rather than on the frame they turn up
      const was = this.divers.map((d) => ({ v: d.e.root.visible, p: d.e.root.position.clone() }));
      for (const d of this.divers) {
        d.e.root.visible = true;
        if (d.state === 'wait') d.e.root.position.copy(this.pos).add(V(0, -20, -30));
      }
      const chuteWas = this.chute.group.visible;
      const bossChuteWas = this.bossChute.group.visible;
      const rigWas = this.rig.root.visible;
      this.chute.group.visible = true;
      this.bossChute.group.visible = true;
      this.rig.root.visible = true;
      const tmp = [turboprop(), airliner(0)];
      for (const a of tmp) {
        a.group.position.copy(this.pos).add(V(0, -60, -80));
        this.scene.add(a.group);
      }
      renderer.compile(this.scene, this.camera);
      renderer.compile(this.vmScene, this.player.camera);
      for (const a of tmp) this.scene.remove(a.group);
      this.divers.forEach((d, i) => {
        d.e.root.visible = was[i].v;
        d.e.root.position.copy(was[i].p);
      });
      this.chute.group.visible = chuteWas;
      this.bossChute.group.visible = bossChuteWas;
      this.rig.root.visible = rigWas;
    }
    renderer.render(this.scene, this.camera);
    if (this.phase === 'pull' || this.phase === 'splash' || this.phase === 'dead') {
      // Him (and his canopy) close up, over the world
      this.camera.updateMatrixWorld(true);
      this.nearCam.position.copy(this.camera.position);
      this.nearCam.quaternion.copy(this.camera.quaternion);
      if (this.nearCam.fov !== this.camera.fov || this.nearCam.aspect !== this.camera.aspect) {
        this.nearCam.fov = this.camera.fov;
        this.nearCam.aspect = this.camera.aspect;
        this.nearCam.updateProjectionMatrix();
      }
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      // (A colour background would clear the world's pass away: none for this one)
      const bg = this.scene.background;
      this.scene.background = null;
      renderer.render(this.scene, this.nearCam);
      this.scene.background = bg;
      renderer.autoClear = auto;
    }
    if (this.phase === 'exit' || this.phase === 'fall') {
      // His hands, the gun and the rush of air, over the world
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(this.vmScene, this.player.camera);
      renderer.autoClear = auto;
    }
  }
}
