import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import {
  Level16Builder,
  type Level16Data,
  type TreeTrunk,
  groundY,
  inLake,
  inCave,
  outside,
  valleyX,
  WATER_Y,
  CLIFF_Z,
  MASSIF,
  ARENA,
  MEADOW,
  PONDS,
  HILL,
  DENS,
  CAVE_MOUTH_Z,
  LAKE_BED,
  CEIL_Y,
  inChasm,
  PILLARS
} from '../environment/Level16Builder';
import { Level16CaveBuilder, caveGround, caveSolid, caveConfine, caveNormal, type CaveExtras } from '../environment/Level16CaveBuilder';
import type { Collider } from '../environment/OfficeLevelBuilder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { FPSPlayer } from '../entities/FPSPlayer';
import { KnifeTwirlViewmodel, karambit, GRIP_HOLD } from '../entities/KnifeTwirlViewmodel';
import { Arsenal, loadoutFor } from '../entities/Arsenal';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { hideInventory } from '../ui/InventoryUI';
import { FPSHUD } from '../ui/FPSHUD';
import { FirstPersonArms, RaviVisual, grip, mixGrip } from '../entities/RaviVisual';
import { dressSuit } from '../entities/SuitDress';
import { Hound, SpiderBoss, MawTrap, GlowShots, Droplets, grabberHead, wetFlesh, KIND_GLOW, type GlowShot } from '../entities/AlienCreatures';
import { AlienBlaster } from '../entities/AlienBlaster';
import { TrackerTablet } from '../entities/TrackerTablet';
import { SwimArms } from '../entities/SwimArms';
import { PanicArms } from '../entities/PanicArms';
import { pistolProp, shotgunProp, rifleProp } from '../entities/RaviRagdoll';
import type { RaviRig } from '../entities/RaviVisual';
import { dressSuitBody } from '../entities/SuitDress';
import { HelmetVisor } from '../ui/HelmetVisor';
import { AcidBubbles } from '../fx/AcidBubbles';
import { Controls } from '../core/Controls';
import type { Enemy } from '../entities/Enemy';
import { HoundRagdoll } from '../entities/HoundRagdoll';
import { Spiderling, SpiderlingRagdoll } from '../entities/Spiderling';
import { AlienReticle } from '../ui/AlienReticle';
import { Colognes } from '../entities/Colognes';

/**
 * Level16Scene — the far side.
 *
 *  1. The station: he comes to in a little survey station, in the suit. A
 *     button by the door lifts it, and there's the planet.
 *  2. The canyon: a crashed drone in a meadow, smoke going up, its beacon
 *     blinking; the tracker in the sponge beside it. Hounds come out of the
 *     trees on the way; maws lie open in the ground.
 *  3. A cliff — over it with the pressure shotgun; the massif, and under it
 *     through the lake, the suit's lamp on.
 *  4. The big one in its clearing: it lobs acid, sprays it, reaches for him
 *     with its grabber, tears trees up and drags them at him. Kill it, take
 *     both its cannons (E): the acid on his right arm, the grabber on his left.
 *  5. The cave in the canyon's end wall, and the portal at the back of it.
 */

type Phase = 'play' | 'intro' | 'harvest' | 'end';

/**
 * The world the scene plays in, asked through here so the one scene can play
 * both parts of the level: the canyon (part one) and the cave (part two).
 */
interface World16 {
  groundY(x: number, z: number): number;
  inLake(x: number, z: number): boolean;
  inCave(x: number, z: number): boolean;
  outside(x: number, z: number): number;
  /** Inside rock at this point (the cave's walls and roof, for shots). */
  solid(x: number, y: number, z: number): boolean;
  /** Pushed back inside the walls (the cave's): true if it had to be. */
  confine(p: THREE.Vector3, r: number): boolean;
  /** Which way the ground or rock faces at a point on it. */
  normal(x: number, y: number, z: number): THREE.Vector3;
}
/** The slope of a height function at (x, z). */
function slopeNormal(f: (x: number, z: number) => number, x: number, z: number): THREE.Vector3 {
  const e = 0.3;
  return new THREE.Vector3(f(x - e, z) - f(x + e, z), 2 * e, f(x, z - e) - f(x, z + e)).normalize();
}
const CANYON: World16 = { groundY, inLake, inCave, outside, solid: () => false, confine: () => false, normal: (x, _y, z) => slopeNormal(groundY, x, z) };
const CAVE: World16 = { groundY: caveGround, inLake: () => false, inCave: () => true, outside: () => -1, solid: caveSolid, confine: caveConfine, normal: caveNormal };
const W: World16 = { ...CANYON };
type BossMove = 'idle' | 'mortar' | 'spray' | 'grab' | 'tree' | 'brood' | 'stagger';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};
const SWIM_DEPTH = 1.25;
/** Under his sprint (6.6), over his walk: he can get away, but not by strolling. */
const HOUND_SPEED = 4.8;
/** The boss's acid pools, and the rings that warn of them: the same size. */
const PUDDLE_R = 1.9;
/** A hound on the grabber: how far its body stands off what it's swung into. */
const HELD_R = 0.45;
/** Swung into the rock this hard (m/s) it's hurt; this hard, it's dead. Nothing else kills one he's holding. */
const SLAM_HURT = 4.5;
const SLAM_KILL = 14;
/** What acid turns a body as it dies in it. */
const ACID_GREEN = new THREE.Color(0x8cff2a);
const ACID_GLOW = new THREE.Color(0x2f8a08);
const BOSS_NAME = 'THE MAW';
const ALIEN_BLOOD = 0x9ad02a;
const BOSS_BLOOD = 0x9a2a6a;
const ACID = KIND_GLOW.acid;
/** Acid globs fall this hard. */
const ACID_G = 11;
/** F presses to tear free of its grabber. */
const BREAK_FREE = 10;

interface Hit {
  dist: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  kind: 'terrain' | 'world' | 'trunk' | 'hound' | 'boss' | 'trap' | 'tongue' | 'spider';
  hound?: Hound;
  spider?: Spiderling;
  trap?: MawTrap;
  head?: boolean;
}

interface Pack {
  trigger: number;
  at: { x: number; z: number }[];
  spawned: boolean;
  needs?: 'tablet' | 'harvest';
}

/** A pool of acid on the ground: it eats whatever stands in it, then dries away. */
interface Puddle {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  x: number;
  z: number;
  r: number;
  life: number;
  max: number;
  enemy: boolean;
  /** For Ravi's hurt in it: time since the last burn. */
  burn: number;
}

/** A warning ring where a glob is going to come down. */
interface Marker {
  mesh: THREE.Mesh;
  t: number;
  land: number;
  r: number;
}

/** A tongue: the grabber's, his or the big one's — a stretch of flesh with a mouth on the end. */
interface Tongue {
  state: 'idle' | 'out' | 'hold' | 'back';
  from: THREE.Vector3;
  tip: THREE.Vector3;
  dir: THREE.Vector3;
  len: number;
  mesh: THREE.Mesh;
  head: THREE.Group;
  radius: number;
}

// ================================================================ the harvest

/** Left hand closed round something thick (the cannon's barrel). */
const L_HOLD = grip([-0.024, -0.004, 0.07], [-0.08, 0.04, -1], [1, 0, -0.1], [-0.3, -0.4, 0.86], {
  fingers: [[52, 66, 40], [56, 70, 42], [58, 72, 42], [60, 72, 42]],
  thumb: [0.4, 0.55, 0.45]
});
const L_OPEN = grip([-0.03, -0.004, 0.075], [-0.06, 0.12, -1], [0.9, 0.42, -0.1], [-0.3, -0.4, 0.86], {
  fingers: [[10, 14, 8], [10, 14, 8], [12, 16, 10], [16, 20, 12]],
  thumb: [0.05, 0.12, 0.1],
  spread: 5
});

/** His hands for the cutting: the karambit in his right, his left holding the thing still. */
class HarvestHands {
  readonly knifeRoot = new THREE.Group();
  readonly knifeHand = new THREE.Group();
  readonly leftRoot = new THREE.Group();
  readonly leftHand = new THREE.Group();
  private knifeArms: FirstPersonArms;
  private leftArms: FirstPersonArms;

  constructor(camera: THREE.Camera) {
    camera.add(this.knifeRoot, this.leftRoot);
    this.knifeRoot.add(this.knifeHand);
    const k = karambit();
    const piv = new THREE.Group();
    piv.position.y = -0.064;
    k.rotation.y = Math.PI / 2;
    piv.add(k);
    this.knifeHand.add(piv);
    this.knifeArms = new FirstPersonArms(this.knifeRoot, camera).set('r', this.knifeHand, GRIP_HOLD);
    this.leftRoot.add(this.leftHand);
    this.leftArms = new FirstPersonArms(this.leftRoot, camera).set('l', this.leftHand, L_OPEN);
    this.knifeRoot.visible = false;
    this.leftRoot.visible = false;
  }

  update(leftClosed: number): void {
    if (this.knifeRoot.visible) this.knifeArms.update();
    if (this.leftRoot.visible) {
      this.leftArms.set('l', this.leftHand, mixGrip(L_OPEN, L_HOLD, leftClosed));
      this.leftArms.update();
    }
  }
}

// ================================================================ acid

let puddleShader: { vertexShader: string; fragmentShader: string } | null = null;
function puddleMaterial(seed: number): THREE.ShaderMaterial {
  puddleShader ??= {
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform float uT; uniform float uFade; uniform float uSeed; uniform vec3 uCol;
      varying vec2 vUv; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p);
        float a = atan(p.y, p.x);
        float edge = 0.78 + 0.18 * n(vec2(a * 2.5 + uSeed, uSeed * 3.0));
        if (r > edge) discard;
        float b = n(vW.xz * 3.5 + vec2(uT * 0.5, -uT * 0.3));
        vec3 c = mix(uCol * 0.35, uCol * 1.5, b);
        vec2 cell = floor(vW.xz * 3.0); vec2 f = fract(vW.xz * 3.0) - 0.5;
        float rr = h(cell + uSeed); float life = fract(uT * (0.6 + rr) + rr * 7.0);
        c += vec3(0.9, 1.0, 0.7) * smoothstep(0.07, 0.0, abs(length(f) - life * 0.42)) * step(0.55, rr) * (1.0 - life);
        c = mix(c, uCol * 0.2, smoothstep(edge - 0.06, edge, r) * 0.6);
        gl_FragColor = vec4(c, smoothstep(edge, edge - 0.1, r) * 0.9 * uFade);
      }`
  };
  return new THREE.ShaderMaterial({
    ...puddleShader,
    uniforms: { uT: { value: 0 }, uFade: { value: 0 }, uSeed: { value: seed }, uCol: { value: new THREE.Color(ACID) } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4
  });
}

// ================================================================ scene

export class Level16Scene extends CombatScene<Level16Data> {
  private arsenal!: Arsenal;
  private knife!: KnifeTwirlViewmodel;
  private drink!: DrinkViewmodel;
  /** The two cannons on his arms: the acid on the right, the grabber on the left. */
  private acidArm!: AlienBlaster;
  private grabArm!: AlienBlaster;
  private tablet!: TrackerTablet;
  /** Looking out through his helmet's visor. */
  private visor!: HelmetVisor;
  /** His arms doing the breaststroke in the lake. */
  private swimArms!: SwimArms;
  private bubbles!: AcidBubbles;
  /** A floating key over the door button and over the tracker, until each is used. */
  private keyMarks: { door: THREE.Sprite; tablet: THREE.Sprite } | null = null;
  private hands!: HarvestHands;
  private hud!: FPSHUD;
  private phase: Phase = 'play';
  private phaseT = 0;
  private t = 0;
  private dead = false;
  private checkpoint = 0;
  private hounds: Hound[] = [];
  private houndHits: THREE.Mesh[] = [];
  private flung = new Map<Hound, THREE.Vector3>();
  /** Thrown off the grabber and not landed yet: it can't die of it. */
  private thrown = new Set<Hound>();
  /** When the last slam into the rock was (one per contact, not one a frame). */
  private slamAt = -9;
  private slamHinted = false;
  /** Bodies dying in acid: going green, smoking. */
  private greening: { root: THREE.Object3D; t: number; mats: { m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; c0: THREE.Color; e0: THREE.Color | null }[] | null }[] = [];
  private ragdolls: HoundRagdoll[] = [];
  /** The blood's colour in the spray: theirs is yellow-green. */
  protected bloodHue = 0.2;
  // ---- The spiderlings out of its sacs
  private spiders: Spiderling[] = [];
  private spiderHits: THREE.Mesh[] = [];
  private spiderRags: SpiderlingRagdoll[] = [];
  private broodHinted = false;
  // ---- An egg on the end of the grabber, coming in to be eaten
  private eggGrab: { egg: { mesh: THREE.Object3D; at: THREE.Vector3; eaten: boolean }; stage: 'reel' | 'eat'; t: number; bites: number } | null = null;
  private reticle: AlienReticle | null = null;
  private reticleT = 0;
  private reticleOn = false;
  /** One light for the chasm's pillars, moved to the one nearest him (a light per pillar is a light on every surface). */
  private pillarLight: THREE.PointLight | null = null;
  /** The cave's eggs' glow: a few lights kept on the eggs nearest him. */
  private eggLights: THREE.PointLight[] = [];
  private eggLightT = 0;
  /** Walking in at the cave's mouth: seconds in (−1 not yet). */
  private caveWalk = -1;
  /** Hounds that have been in acid: when they first touched it. Three seconds and they're gone. */
  private acidFuse = new Map<Hound, number>();
  private bloodPools: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; r: number; t: number }[] = [];
  private packs: Pack[] = [];
  private traps: MawTrap[] = [];
  private trapHits: THREE.Mesh[] = [];
  private heldBy: MawTrap | null = null;
  private heldBite = 0;
  // ---- the big one
  private boss!: SpiderBoss;
  private bossAwake = false;
  private bossVel = new THREE.Vector3();
  private bossSide = 1;
  private bossSideT = 0;
  private move: BossMove = 'idle';
  private moveT = 0;
  private moveI = 0;
  private moveShots = 0;
  private lastStomp = 0;
  private bossTongue!: Tongue;
  private tongueHit!: THREE.Mesh;
  private tongueHp = 0;
  /** Its grabber has him: presses of F so far. */
  private grabbed = false;
  private presses = 0;
  /** Didn't break free: up to its mouth, in, and eaten. */
  private eating: {
    t: number;
    from: THREE.Vector3;
    /** He's dead (the very end). */
    done: boolean;
    /** Cut from his eyes to outside, where it's chewing on him. */
    cut: boolean;
    munches: number;
    lastChew: number;
    gun: THREE.Object3D | null;
    gunVel: THREE.Vector3;
    gunSpin: THREE.Vector3;
    gunDown: boolean;
    body: RaviRig | null;
    scream: { set(distance: number): void; stop(): void } | null;
    swallowed: boolean;
  } | null = null;
  /** His hands up in front of him, shoving at it and shaking. */
  private panic!: PanicArms;
  /** The tracker's up (M toggles it). */
  private tabletOn = false;
  private eatFade: HTMLElement | null = null;
  private wasSwimming = false;
  private tree: {
    i: number;
    stage: 'reach' | 'wrap' | 'lift' | 'carry' | 'drag';
    t: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    dir: THREE.Vector3;
    hit: boolean;
    p0: THREE.Vector3;
    q0: THREE.Quaternion;
  } | null = null;
  private treeCols: Collider[] = [];
  private treeUsed: boolean[] = [];
  // ---- his arms
  private tongue!: Tongue;
  private holding: Hound | null = null;
  private holdPrev = new THREE.Vector3();
  private holdVel = new THREE.Vector3();
  private lmbWas = false;
  private acidShots!: GlowShots;
  private bossAcid!: GlowShots;
  private puddles: Puddle[] = [];
  private markers: Marker[] = [];
  private drops!: Droplets;
  private acidLight!: THREE.PointLight;
  private portalLight!: THREE.PointLight;
  private lamp!: THREE.SpotLight;
  private lampSpill!: THREE.PointLight;
  private lampOn = 0;
  private hasTablet = false;
  private harvested = false;
  private doorT = -1;
  private underwater = false;
  private swimHinted = false;
  private cliffHinted = false;
  private trapHinted = false;
  private tabletHinted = 0;
  private caveHinted = false;
  private smokeT = 0;
  private bubbleT = 0;
  private hissT = 0;
  private burnT = 0.5;
  private shake = 0;
  private flashT = 9;
  private flash = 0;
  private lastGrowl = -10;
  // ---- the harvest
  private harvestOrder = [0, 1];
  private harvestFrom = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private fallen: (THREE.Group | null)[] = [null, null];
  private fallV = [0, 0];
  private leapFrom: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
  private lastInside = new THREE.Vector3();
  private nearCols: Collider[] = [];
  private nearPool: Collider[] = [];
  private nearAt = new THREE.Vector3(1e9, 0, 0);
  private trunkGrid = new Map<string, TreeTrunk[]>();
  private allCols: Collider[] = [];
  private floorBody!: CANNON.Body;
  private hemi!: THREE.HemisphereLight;
  private moon!: THREE.DirectionalLight;
  private ui!: HTMLElement;
  private banner!: HTMLElement;
  private fadeEl!: HTMLElement;
  private letterbox!: HTMLElement;
  private murk!: HTMLElement;
  private vignette!: HTMLElement;
  private card!: HTMLElement;
  private hintEl!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private clickHandler = (): void => this.onClick();
  private underLoop: { set(k: number): void; stop(): void } | null = null;
  private static readonly FOG_AIR = new THREE.Color(0x0d0716);
  private static readonly FOG_CAVE = new THREE.Color(0x020204);
  private static readonly FOG_WATER = new THREE.Color(0x082a0e);
  private static readonly HEMI = 1.35;
  private static readonly MOON = 2.6;

  constructor(
    ctx: GameContext,
    private from = 0,
    /** 1 the canyon; 2 the cave. */
    private part: 1 | 2 = 1
  ) {
    super(ctx);
  }

  // ============================================================ lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    RaviVisual.dressArms = dressSuit;
    // ...and all of him, for when he dies out here
    RaviVisual.dressBody = dressSuitBody;
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(Level16Scene.FOG_AIR.getHex(), 0.022);
    Object.assign(W, this.part === 2 ? CAVE : CANYON);
    this.level = this.part === 2 ? new Level16CaveBuilder().build() : new Level16Builder().build();
    const L = this.level;
    this.scene.add(L.group);
    // The trees round the clearing stand in the way until they're torn up
    for (const t of L.arenaTrees) {
      const c: Collider = { box: new THREE.Box3(V(t.x - 0.4, W.groundY(t.x, t.z) - 1, t.z - 0.4), V(t.x + 0.4, W.groundY(t.x, t.z) + 5, t.z + 0.4)) };
      L.colliders.push(c);
      this.treeCols.push(c);
      this.treeUsed.push(false);
    }
    this.world = this.createPhysicsWorld(L.colliders);
    // Lighter gravity out here for everything that falls, as for him
    this.world.gravity.set(0, -12, 0);
    {
      const es = 2;
      const X0 = -150;
      const Z1 = 165;
      const nx = 151;
      const nz = 200;
      const data: number[][] = [];
      for (let i = 0; i < nx; i++) {
        const col: number[] = [];
        for (let j = 0; j < nz; j++) col.push(W.groundY(X0 + i * es, Z1 - j * es));
        data.push(col);
      }
      this.floorBody = new CANNON.Body({ mass: 0, shape: new CANNON.Heightfield(data, { elementSize: es }) });
      this.floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      this.floorBody.position.set(X0, 0, Z1);
      this.world.addBody(this.floorBody);
    }
    for (const t of L.trunks) {
      const k = `${Math.floor(t.x / 8)},${Math.floor(t.z / 8)}`;
      let a = this.trunkGrid.get(k);
      if (!a) this.trunkGrid.set(k, (a = []));
      a.push(t);
    }
    for (let i = 0; i < 32; i++) this.nearPool.push({ box: new THREE.Box3() });

    this.checkpoint = Math.min(this.from, this.part === 2 ? 1 : 5);
    const start = this.checkpointPose(this.checkpoint);
    this.player = new FPSPlayer(start.pos.clone(), start.yaw, input, audio, bus);
    // Lighter gravity out here: higher, floatier jumps
    this.player.gravity = 10.5;
    this.player.jumpSpeed = 5.4;
    this.player.ground = (x, z) => W.groundY(x, z);
    this.player.camera.far = 1300;
    this.player.camera.updateProjectionMatrix();
    this.scene.add(this.player.camera);
    this.lastInside.copy(start.pos);
    this.ragdollOnDeath(() => (!this.arsenal.knifeActive && this.arsenal.held.stow < 0.5 ? this.arsenal.active : null));

    this.particles = new ParticleManager(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene, 4);
    this.decals = new BloodDecalSystem(this.scene, { alien: true });
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
    const a = this.arsenal;
    a.shotgun.useQuad();
    a.shells = 6;
    a.pressureOn = true;
    a.pressure = Arsenal.PRESSURE_MAX;
    a.hasKnife = true;
    a.equip('rifle', 0);
    a.onPressureShot = () => (this.shake = Math.max(this.shake, 0.5));
    this.knife = new KnifeTwirlViewmodel(this.player.camera);
    this.knife.onSlash = () => this.knifeSlash();
    this.knife.onCatch = () => audio.pocket();
    this.knife.stow = 1;
    this.drink = new DrinkViewmodel(this.player.camera);
    this.drink.onEvent = (e, i) => {
      if (e === 'crack') audio.canCrack();
      else if (e === 'gulp') audio.gulp(i);
      else if (e === 'heal') this.player.healFull();
      else if (e === 'crush') audio.canCrush();
      else if (e === 'toss') this.dropCan(this.drink.tossPose());
    };
    this.acidArm = new AlienBlaster(this.player.camera, 'r', 'acid');
    this.grabArm = new AlienBlaster(this.player.camera, 'l', 'grabber');
    this.tablet = new TrackerTablet(this.player.camera, L.mapCanvas, L.mapBounds);
    this.hands = new HarvestHands(this.player.camera);

    // ---- Light
    this.hemi = new THREE.HemisphereLight(0x5a4c86, 0x1c1a14, Level16Scene.HEMI);
    this.moon = new THREE.DirectionalLight(0xa8b0e8, Level16Scene.MOON);
    this.moon.position.set(280, 210, 40);
    this.scene.add(this.hemi, this.moon, this.moon.target);
    this.lamp = new THREE.SpotLight(0xe8f4ff, 0, 40, 0.55, 0.5, 1.2);
    // Out past his hands, so it lights what's ahead and not his own arms a foot from it
    this.lamp.position.set(0.05, 0.02, -0.95);
    this.lamp.target.position.set(0.02, -0.4, -9);
    this.player.camera.add(this.lamp, this.lamp.target);
    // The lamp's spill back on his own arms: soft, and only a metre
    this.lampSpill = new THREE.PointLight(0xdfe8ff, 0, 1.6, 1.2);
    this.lampSpill.position.set(0, 0.25, -0.15);
    this.player.camera.add(this.lampSpill);
    this.acidLight = new THREE.PointLight(ACID, 0, 9, 1.6);
    this.scene.add(this.acidLight);
    this.portalLight = new THREE.PointLight(0x6ae0ff, 6, 30, 1.3);
    // Part one's is out in front of the cave's mouth, lighting the arch and not the way in
    this.portalLight.position.copy(L.portal.at).add(this.part === 1 ? V(0, 3.2, 7) : V(0, 2.6, 1.5));
    if (this.part === 1) this.portalLight.distance = 55;
    this.scene.add(this.portalLight);
    if (this.part === 1) {
      this.pillarLight = new THREE.PointLight(0x5affc0, 0, 12, 1.4);
      this.pillarLight.position.set(0, -500, 0);
      this.scene.add(this.pillarLight);
    }

    this.acidShots = new GlowShots(ACID, 0.09, ACID_G, 0.3, 30);
    this.bossAcid = new GlowShots(ACID, 0.17, ACID_G, 0.3, 160);
    this.drops = new Droplets(900);
    this.scene.add(this.acidShots.group, this.bossAcid.group, this.drops.points);
    this.buildPools();
    this.tongue = this.makeTongue(0.028, 1);
    this.bossTongue = this.makeTongue(0.085, 2.4);
    this.tongueHit = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.tongueHit.userData.tongue = true;
    this.scene.add(this.tongueHit);

    // ---- The big one, waiting in its clearing; the packs; the maws
    this.boss = new SpiderBoss((x, z) => W.groundY(x, z));
    this.scene.add(this.boss.group);
    this.boss.place(ARENA.x, ARENA.z - 8, 0);
    const at = (z: number, dx: number): { x: number; z: number } => ({ x: valleyX(z) + dx, z });
    void at;
    // Out of a den: in a bunch just inside its mouth
    const den = (i: number, n: number): { x: number; z: number }[] => {
      const d = DENS[i];
      const side = V(Math.cos(d.yaw), 0, -Math.sin(d.yaw));
      const out = V(Math.sin(d.yaw), 0, Math.cos(d.yaw));
      return Array.from({ length: n }, (_, k) => {
        const p = d.inner.clone().addScaledVector(side, (k - (n - 1) / 2) * 0.7).addScaledVector(out, -(k % 2) * 0.6);
        return { x: p.x, z: p.z };
      });
    };
    this.packs = [
      { trigger: 121, at: [], spawned: true },
      { trigger: 26, at: den(0, 4), spawned: false, needs: 'tablet' },
      { trigger: -60, at: den(1, 4), spawned: false },
      { trigger: 999, at: den(2, 6), spawned: false, needs: 'harvest' },
      { trigger: -146, at: den(3, 4), spawned: false, needs: 'harvest' }
    ];
    this.introDone = this.checkpoint > 0;
    // The dead explorer's cologne
    if (this.part === 1)
      Colognes.place(this.scene, 'maw', L.note.cologne, 0.6, () => (this.player && this.player.alive && !this.player.cinematic ? this.player.camera : null));
    const done = [this.checkpoint >= 1, this.checkpoint >= 3, this.checkpoint >= 4];
    // (the first is the hill's pack: the cutscene brings those, so it's always "spawned")
    done.forEach((d, i) => (this.packs[i].spawned = this.packs[i].spawned || d));
    for (const s of L.trapSpots) {
      const m = new MawTrap();
      // Sat on the ground, tilted to its slope, not half sunk in it
      const e = 0.5;
      const n = V(W.groundY(s.x - e, s.z) - W.groundY(s.x + e, s.z), 2 * e, W.groundY(s.x, s.z - e) - W.groundY(s.x, s.z + e)).normalize();
      m.group.quaternion.setFromUnitVectors(V(0, 1, 0), n).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.random() * 6.28));
      m.group.position.set(s.x, s.y + 0.1, s.z);
      this.scene.add(m.group);
      this.traps.push(m);
      this.trapHits.push(m.hitbox);
    }

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, 0, this.player.maxHealth);
    this.hud.setCounter(null);
    this.hud.setAmmo(...a.ammoReadout());
    this.buildUI();
    // The HUD from the start: his health, and the prompts (it used to stay hidden until the boss fight's cutscene)
    this.hud.show();
    this.visor = new HelmetVisor(this.ctx.uiRoot);
    this.swimArms = new SwimArms(this.player.camera);
    this.panic = new PanicArms(this.player.camera);
    this.bubbles = new AcidBubbles(this.scene, {
      inWater: (x, z) => W.inLake(x, z),
      bed: (x, z) => Math.max(LAKE_BED - 0.4, W.groundY(x, z)),
      // Under the massif the water runs right up to the rock
      top: (x, z) => (x > MASSIF.x0 && x < MASSIF.x1 && z > MASSIF.z0 && z < MASSIF.z1 ? CEIL_Y : WATER_Y)
    });
    this.keyMarks = { door: Level16Scene.keyMarker(), tablet: Level16Scene.keyMarker() };
    this.scene.add(this.keyMarks.door, this.keyMarks.tablet);
    if (this.checkpoint >= 1 || this.part === 2) {
      this.openDoor(true);
      this.takeTablet(true);
    }
    if (this.part === 2) this.setupCave();
    else if (this.checkpoint >= 5) this.pastTheBoss();

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }),
      bus.on(Events.PlayerDied, () => {
        this.dead = true;
        this.hud.setBoss(null, 0);
        this.release();
        this.grabbed = false;
      })
    );
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('click', this.clickHandler);
    this.underLoop = audio.underwaterLoop();
    audio.startTrackMusic('audio/dark-amb.mp3', 0, 0, 0.5, 4);

    this.player.camera.fov = 74;
    this.player.camera.updateProjectionMatrix();
    this.fadeEl.style.transition = 'opacity 1.6s';
    this.later(0.05, () => (this.fadeEl.style.opacity = '0'));
    this.setObjective(this.checkpoint === 0 ? 'RELEASE THE STATION DOOR' : 'FOLLOW THE TRACKER — [M]');
    input.requestPointerLock();
  }

  exit(): void {
    this.closeNote();
    RaviVisual.dressArms = null;
    RaviVisual.dressBody = null;
    this.eatFade?.remove();
    this.visor?.dispose();
    this.swimArms?.dispose();
    this.panic?.dispose();
    this.eating?.scream?.stop();
    this.bubbles?.dispose();
    this.ctx.audio.stopTrackMusic(0.8);
    this.ctx.audio.stopBossMusic(0.5);
    this.underLoop?.stop();
    for (const u of this.unsubs) u();
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('click', this.clickHandler);
    this.hud.destroy();
    hideInventory();
    this.flashPool.dispose();
    this.reticle?.dispose();
    this.ui.remove();
  }

  private checkpointPose(c: number): { pos: THREE.Vector3; yaw: number } {
    const at = (x: number, z: number, yaw: number): { pos: THREE.Vector3; yaw: number } => ({ pos: V(x, W.groundY(x, z), z), yaw });
    if (this.part === 2) return c >= 1 ? at(6, -54, 0) : this.level.start;
    switch (c) {
      case 1:
        return at(MEADOW.x - 2, MEADOW.z - 2, 0.2);
      case 2:
        return at(valleyX(CLIFF_Z - 4), CLIFF_Z - 4, 0);
      case 3:
        return at(0, -60, 0);
      case 4:
        return at(valleyX(-80), -80, 0);
      case 5:
        return at(valleyX(-142), -142, 0);
      default:
        return this.level.start;
    }
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="l16-vig" style="position:absolute;inset:0;pointer-events:none;
        background:radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(4,0,10,0.62) 100%)"></div>
      <div class="l16-hurt" style="position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .15s;
        background:radial-gradient(ellipse at center, rgba(120,0,10,0) 40%, rgba(120,0,10,0.55) 100%)"></div>
      <div class="l16-murk" style="position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .25s;
        background:radial-gradient(ellipse at center, rgba(40,140,50,0.22) 0%, rgba(6,40,10,0.88) 100%)"></div>
      <div class="intro-letterbox open"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="l16-hint" style="position:absolute;left:50%;bottom:17%;transform:translateX(-50%);color:#e8f0ea;font:bold 15px 'Courier New',monospace;
        letter-spacing:2px;text-shadow:0 0 6px #000,0 0 2px #000;opacity:0;transition:opacity .4s;pointer-events:none;text-align:center"></div>
      <div class="intro-fade" style="opacity:1"></div>
      <div class="hq-card" style="position:absolute;inset:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;
        opacity:0;transition:opacity 1.6s;pointer-events:none;color:#e8e6df;letter-spacing:8px">
        <div style="font-size:13px;opacity:.6;letter-spacing:6px;margin-bottom:18px">LEVEL 16 — THE FAR SIDE</div>
        <div style="font-size:42px;font-weight:bold">TO BE CONTINUED</div>
      </div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.murk = el.querySelector('.l16-murk')!;
    this.vignette = el.querySelector('.l16-hurt')!;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.banner = el.querySelector('.intro-objective')!;
    this.hintEl = el.querySelector('.l16-hint')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
    this.card = el.querySelector('.hq-card')!;
  }

  private setObjective(text: string): void {
    if (this.banner.textContent === text) return;
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    if (text) this.banner.classList.add('show');
  }

  private hintTimer = 0;
  private hint(text: string, sec = 5): void {
    this.hintEl.textContent = text;
    this.hintEl.style.opacity = '1';
    this.hintTimer = sec;
  }

  private cinema(on: boolean): void {
    this.letterbox.classList.toggle('open', !on);
    if (on) this.hud.hide();
    else this.hud.show();
  }

  private get playable(): boolean {
    return this.phase === 'play' && this.player.alive;
  }

  /** Something else has the prompt (a maw, its grabber): leave it be. */
  private get promptBusy(): boolean {
    return !!this.heldBy || this.grabbed;
  }

  // ============================================================ frame

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    this.t += dt;
    this.phaseT += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.t < this.timers[i].at) continue;
      const f = this.timers[i].fn;
      this.timers.splice(i, 1);
      f();
    }
    if (this.playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();
    const L = this.level;
    const p = this.player;
    const a = this.arsenal;

    const pos = p.position;
    const lake = W.inLake(pos.x, pos.z);
    p.swimming = p.alive && this.phase === 'play' && lake && pos.y < WATER_Y - SWIM_DEPTH && !this.heldBy && !this.grabbed;
    p.swimTop = WATER_Y - 1.45;
    this.underwater = W.inLake(p.camera.position.x, p.camera.position.z) && p.camera.position.y < WATER_Y - 0.02;
    if (p.swimming && !this.swimHinted) {
      this.swimHinted = true;
      this.ctx.audio.splash(true);
      this.splash(V(pos.x, WATER_Y, pos.z), 30);
      this.hint('SUIT LAMP ON — [W] SWIM WHERE YOU LOOK · [SPACE] UP · [C] DOWN', 7);
    }

    const free = this.playable && input.pointerLocked && !p.swimming;
    // M puts the tracker up, M again puts it away
    if (this.hasTablet && free && !this.drink.engaged && input.wasPressed('KeyM')) this.tabletOn = !this.tabletOn;
    if (!this.hasTablet || !free || this.drink.engaged) this.tabletOn = false;
    const wantTablet = this.tabletOn;
    if (input.wasPressed('KeyG') && free && !a.reloading && !this.knife.busy && !wantTablet) this.drink.start();
    if (!p.alive) this.drink.abort();
    const busy = this.phase !== 'play' || p.swimming || !!this.eating || this.drink.engaged || this.tablet.up > 0.05 || wantTablet;
    a.preUpdate(dt, input, { canSwitch: free && !this.knife.busy, busy, hold: this.phase === 'harvest' });
    const aiming = !busy && input.rightHeld && input.pointerLocked && this.playable && !a.reloading && !a.switching && !a.pressureArmed;
    p.aiming = aiming;

    if (this.phase === 'play' || this.dead) {
      this.refreshNear();
      p.update(dt, this.allCols);
      this.keepInside();
    }
    this.updateTraps(dt);
    this.updateBossGrip(dt);
    this.updateEat(dt);

    // ---- Weapons: the guns, the knife, or the two alien arms
    const sideOut = a.knifeActive;
    const armsOut = sideOut && a.side === 'blaster';
    this.knife.stow = sideOut && a.side === 'knife' ? a.knifeStow : 1;
    if (this.phase !== 'harvest') {
      this.acidArm.stow = armsOut ? a.knifeStow : 1;
      this.grabArm.stow = armsOut ? a.knifeStow : 1;
    }
    const canFire = this.playable && input.pointerLocked && !busy;
    if (sideOut && a.side === 'knife' && a.knifeWanted && canFire && a.knifeStow < 0.15 && input.consumeClick() && this.knife.trick()) this.ctx.audio.punchSwish();
    if (armsOut) {
      input.consumeClick();
      this.updateArms(dt, canFire && !p.sprinting);
    } else if (this.tongue.state !== 'idle') this.retract(this.tongue);
    this.lmbWas = input.mouseHeld;
    this.knife.update(dt, p);
    if (this.phase !== 'harvest') {
      this.acidArm.update(dt, p);
      this.grabArm.update(dt, p);
    }
    a.updateViewmodels(dt, aiming);
    a.updateFire(dt, input, canFire, (r, m, re) => this.hud.setAmmo(r, m, re));
    this.hud.setAmmoShown(!a.knifeActive && !a.knifeWanted);
    this.hud.setPressure(a.pressureArmed ? a.pressure : null);
    this.drink.update(dt, p);
    this.tablet.update(dt, wantTablet, pos, p.yaw, L.portal.at, p.bob);
    this.swimArms.update(dt, p.swimming && p.alive, p.velocity.length());
    this.panic.update(dt);
    this.visor.update(dt, p.sprinting || p.swimming ? 1 : 0, p.lastMouseDX, p.lastMouseDY, p.bob.phase * Math.min(1, p.bob.amount * 1.5));
    // Up out of the lake: water running down the visor
    if (this.wasSwimming && !p.swimming && p.alive) this.visor.splash();
    this.wasSwimming = p.swimming;
    this.visor.visible = p.alive && !this.eating?.cut; // the death camera, and the last of the cutscene, are out of his head
    this.bubbles.update(dt, pos);
    this.updateMarkers();
    if (this.phase === 'play') {
      const targetFov = 74 - a.zoomFov;
      if (Math.abs(p.camera.fov - targetFov) > 0.01) {
        p.camera.fov = targetFov;
        p.camera.updateProjectionMatrix();
      }
    }
    this.hud.setAiming(a.aimBlend > 0.5 || this.reticleOn);
    this.updateReticle(dt, armsOut && this.playable && !p.swimming);

    // ---- The route
    this.updateDoor(dt);
    this.updateTabletPickup(dt);
    this.updatePacks();
    this.updateHounds(dt);
    this.updateSpiders(dt);
    this.updateLocalLights(dt);
    this.updateBoss(dt);
    this.updateTongues(dt);
    this.updateAcid(dt);
    this.updateGreening(dt);
    this.updateHarvestPrompt();
    this.updateNote();
    if (this.part === 2) this.updateCave(dt);
    if (this.phase === 'play') this.maybeIntro();
    if (this.phase === 'intro') this.updateIntro(dt);
    if (this.phase === 'harvest') this.updateHarvest(dt);
    this.updatePortal(dt);
    this.updateCheckpoints();
    this.updateHints(dt);

    this.updateAtmosphere(dt);
    this.drops.update(dt, (x, z) => W.groundY(x, z));
    this.hud.setHealth(p.health, p.regenProgress);
    this.updateDebris(dt);
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      this.ragdolls[i].update(dt);
      if (this.ragdolls[i].done) this.ragdolls.splice(i, 1);
    }
    this.updateBloodPools(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.acidLight.intensity = Math.max(0, this.acidLight.intensity - dt * 50);
    this.world.step(1 / 60, dt, 3);
    this.applyShake(dt);
    input.endFrame();
  }

  private refreshNear(): void {
    const p = this.player.position;
    if (this.nearAt.distanceToSquared(p) > 1 || this.allCols.length === 0) {
      this.nearAt.copy(p);
      this.nearCols.length = 0;
      const cx = Math.floor(p.x / 8);
      const cz = Math.floor(p.z / 8);
      let n = 0;
      for (let i = cx - 1; i <= cx + 1; i++)
        for (let j = cz - 1; j <= cz + 1; j++) {
          for (const t of this.trunkGrid.get(`${i},${j}`) ?? []) {
            if (n >= this.nearPool.length) break;
            if (Math.hypot(t.x - p.x, t.z - p.z) > 6 + t.r) continue;
            const c = this.nearPool[n++];
            const r = t.r * 0.85;
            const y = W.groundY(t.x, t.z);
            c.box.min.set(t.x - r, y - 1, t.z - r);
            c.box.max.set(t.x + r, y + t.h, t.z + r);
            this.nearCols.push(c);
          }
        }
      this.allCols = this.level.colliders.concat(this.nearCols);
    }
  }

  private keepInside(): void {
    const p = this.player;
    if (!p.alive) return;
    const pos = p.position;
    if (this.part === 2) {
      W.confine(pos, 0.38);
      return;
    }
    if (W.inCave(pos.x, pos.z) || W.outside(pos.x, pos.z) < 2.5) {
      this.lastInside.copy(pos);
      return;
    }
    pos.x = this.lastInside.x;
    pos.z = this.lastInside.z;
    p.velocity.x = 0;
    p.velocity.z = 0;
    p.boost.set(0, 0, 0);
  }

  // ============================================================ the markers

  /** A key, floating: "E" in a rounded box with a little arrow under it, always drawn on top. */
  private static keyMarker(): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 160;
    const g = c.getContext('2d')!;
    const key = Controls.label('E');
    g.fillStyle = 'rgba(10, 14, 12, 0.75)';
    g.strokeStyle = '#7dffb0';
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(14, 10, 100, 100, 18);
    g.fill();
    g.stroke();
    g.fillStyle = '#e8fff0';
    g.font = `bold ${key.length > 2 ? 34 : 64}px "Courier New", monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(key, 64, 62);
    g.fillStyle = '#7dffb0';
    g.beginPath();
    g.moveTo(44, 122);
    g.lineTo(84, 122);
    g.lineTo(64, 150);
    g.closePath();
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    s.renderOrder = 999;
    s.scale.set(0.32, 0.4, 1);
    s.visible = false;
    return s;
  }

  /** Over the door button until it's pressed, over the tracker until it's picked up, when he's near enough to see them. */
  private updateMarkers(): void {
    const m = this.keyMarks;
    if (!m) return;
    const L = this.level;
    const eye = this.player.camera.position;
    const bob = Math.sin(this.t * 3) * 0.04;
    m.door.position.copy(L.door.button).add(V(0, 0.32 + bob, 0));
    m.door.visible = this.doorT < 0 && this.playable && eye.distanceTo(L.door.button) < 10;
    m.tablet.position.copy(L.tablet.at).add(V(0, 0.75 + bob, 0));
    m.tablet.scale.set(0.42, 0.52, 1);
    m.tablet.visible = !this.hasTablet && this.playable && eye.distanceTo(L.tablet.at) < 18;
  }

  // ============================================================ the station

  private updateDoor(dt: number): void {
    const L = this.level;
    const p = this.player;
    const d = L.door;
    if (this.doorT < 0) {
      const eye = p.camera.position;
      const near = eye.distanceTo(d.button) < 1.7;
      const look = p.camera.getWorldDirection(new THREE.Vector3()).dot(d.button.clone().sub(eye).normalize()) > 0.75;
      d.buttonMat.emissiveIntensity = 0.9 + 0.6 * Math.sin(this.t * 5);
      if (this.playable && near && look) {
        this.hud.setPrompt('[ E ] RELEASE DOOR');
        if (this.ctx.input.wasPressed('KeyE')) this.openDoor(false);
      } else this.hud.setPrompt(null);
      return;
    }
    if (this.doorT < 3) {
      this.doorT += dt;
      const k = smooth((this.doorT - 0.6) / 2.2);
      d.open(k);
      if (k > 0.75) d.collider.disabled = true;
      if (this.doorT > 0.6 && this.doorT - dt <= 0.6) this.particles.dust(V(0, W.groundY(0, 131.3) + 0.2, 131.3), 2);
      if (this.doorT < 0.6) this.shake = Math.max(this.shake, 0.15);
    }
  }

  private openDoor(instant: boolean): void {
    const d = this.level.door;
    d.buttonMat.emissive.setHex(0x20ff40);
    d.buttonMat.emissiveIntensity = 1.2;
    this.hud.setPrompt(null);
    if (instant) {
      this.doorT = 3;
      d.open(1);
      d.collider.disabled = true;
      return;
    }
    this.doorT = 0;
    this.ctx.audio.breakerThrow();
    this.later(0.4, () => this.ctx.audio.doorOpen());
    this.later(1.0, () => this.ctx.audio.elevatorDoors(1.8));
    this.later(2.6, () => {
      this.setObjective('INVESTIGATE THE CRASHED DRONE');
      this.hint('SMOKE, AND A RED BEACON — DOWN THE CANYON', 6);
    });
  }

  // ============================================================ the tracker

  private updateTabletPickup(dt: number): void {
    const L = this.level;
    L.tablet.beacon.emissiveIntensity = Math.sin(this.t * 6) > 0.3 ? 3 : 0.2;
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.35;
      if (this.player.position.distanceTo(L.tablet.at) < 140) this.particles.smokeColumn(L.tablet.at.clone().add(V(1.8, 0.4, -0.8)), 0.9, 1);
    }
    if (this.hasTablet || !this.playable) return;
    const d = this.player.position.distanceTo(L.tablet.at);
    if (d < 2.2) {
      this.hud.setPrompt('[ E ] PICK UP THE TRACKER');
      if (this.ctx.input.wasPressed('KeyE')) this.takeTablet(false);
    } else if (this.doorT >= 0 && !this.promptBusy) this.hud.setPrompt(null);
  }

  private takeTablet(silent: boolean): void {
    this.hasTablet = true;
    this.level.tablet.obj.visible = false;
    this.hud.setPrompt(null);
    if (silent) return;
    this.ctx.audio.itemGet();
    this.checkpoint = Math.max(this.checkpoint, 1);
    this.setObjective('FOLLOW THE TRACKER — [M]');
    this.hint('PRESS [M] TO BRING UP THE TRACKER (AND AGAIN TO PUT IT AWAY) — IT HAS A FIX ON AN EXIT PORTAL', 7);
    this.tabletHinted = 1;
  }

  // ============================================================ maws

  private updateTraps(dt: number): void {
    const p = this.player;
    const pos = p.position;
    for (const m of this.traps) {
      m.update(dt);
      if (m.state === 'shut' && m.stateT > 6) {
        m.state = 'open';
        m.stateT = 0;
      }
      if (m.state !== 'open' || this.heldBy || this.grabbed || !p.alive || this.phase !== 'play' || p.swimming) continue;
      const g = m.group.position;
      if (Math.hypot(pos.x - g.x, pos.z - g.z) < MawTrap.REACH && pos.y - g.y < 0.6) {
        m.snap();
        this.heldBy = m;
        this.heldBite = 0;
        this.ctx.audio.mawSnap();
        this.shake = Math.max(this.shake, 0.8);
        this.drops.burst(pos.clone().add(V(0, 0.4, 0)), V(0, 1, 0), 20, 3, 0xa01010);
        p.hit('A MAW IN THE GROUND', g.clone());
        if (!this.trapHinted) {
          this.trapHinted = true;
          this.hint('IT HAS YOU — LOOK DOWN AND SHOOT IT', 5);
        }
      }
    }
    const m = this.heldBy;
    if (!m) {
      if (!this.grabbed) {
        p.stunned = false;
        this.vignette.style.opacity = '0';
      }
      return;
    }
    const g = m.group.position;
    p.stunned = true;
    pos.x += (g.x - pos.x) * Math.min(1, dt * 10);
    pos.z += (g.z - pos.z) * Math.min(1, dt * 10);
    p.velocity.set(0, Math.min(0, p.velocity.y), 0);
    p.boost.set(0, 0, 0);
    this.vignette.style.opacity = String(0.6 + 0.3 * Math.sin(this.t * 9));
    this.heldBite += dt;
    if (this.heldBite > 1.4 && p.alive) {
      this.heldBite = 0;
      this.ctx.audio.houndBite(0);
      this.shake = Math.max(this.shake, 0.5);
      p.hit('A MAW IN THE GROUND', g.clone());
    }
    if (m.stateT > 3.2) {
      m.state = 'shut';
      m.stateT = 0;
      this.release();
    }
  }

  private release(): void {
    this.heldBy = null;
    this.player.stunned = this.grabbed;
  }

  private hurtTrap(m: MawTrap, dmg: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    this.drops.burst(point, dir.clone().negate().setY(0.5), 10, 2.5, 0xa01828);
    this.ctx.audio.fleshHit();
    if (m.state === 'dead') return;
    m.hp -= dmg;
    this.ctx.bus.emit(Events.HitMarker, { lethal: m.hp <= 0 });
    if (m.hp > 0) return;
    m.state = 'dead';
    m.stateT = 0;
    this.bloodPool(m.group.position.x, m.group.position.z, 1.4, 0x5a0a18);
    const i = this.trapHits.indexOf(m.hitbox);
    if (i >= 0) this.trapHits.splice(i, 1);
    if (this.heldBy === m) this.release();
  }

  // ============================================================ hounds

  private updatePacks(): void {
    const z = this.player.position.z;
    for (const pk of this.packs) {
      if (pk.spawned) continue;
      if (pk.needs === 'tablet' && !this.hasTablet) continue;
      if (pk.needs === 'harvest' && (!this.harvested || pk.trigger > 900)) continue;
      if (z < pk.trigger && this.playable) this.spawnPack(pk);
    }
  }

  private spawnPack(pk: Pack): void {
    pk.spawned = true;
    if (!pk.at.length) return; // nothing to bring (and nothing to screech from)
    pk.at.forEach((s, i) => {
      const h = new Hound();
      h.group.position.set(s.x, W.groundY(s.x, s.z), s.z);
      h.yaw = Math.atan2(this.player.position.x - s.x, this.player.position.z - s.z);
      h.group.rotation.y = h.yaw;
      h.state = 'lurk';
      h.stateT = -i * 0.35 - Math.random() * 0.4;
      this.scene.add(h.group);
      this.hounds.push(h);
      this.houndHits.push(...h.hitboxes);
    });
    this.later(0.4, () => this.ctx.audio.houndScreech(this.player.position.distanceTo(V(pk.at[0].x, 0, pk.at[0].z)) * 0.6));
  }

  private updateHounds(dt: number): void {
    const p = this.player;
    const pp = p.position;
    const tmp = new THREE.Vector3();
    for (const h of this.hounds) {
      const g = h.group.position;
      h.stateT += dt;
      if (!h.alive) {
        h.deadT += dt;
        if (h.ragdoll) continue;
        const fv = this.flung.get(h);
        if (fv) {
          // Still flying when it died: it lands
          fv.y -= 18 * dt;
          g.addScaledVector(fv, dt);
          const gy = W.groundY(g.x, g.z);
          if (g.y <= gy) {
            g.y = gy;
            this.flung.delete(h);
          }
        } else {
          h.knock.multiplyScalar(Math.exp(-4 * dt));
          g.x += h.knock.x * dt;
          g.z += h.knock.z * dt;
          g.y = W.groundY(g.x, g.z);
        }
        h.animate(dt, this.t);
        continue;
      }
      if (h.held) {
        h.animate(dt, this.t);
        continue;
      }
      // Thrown: through the air till it lands, and the landing hurts
      const fv = this.flung.get(h);
      if (fv) {
        fv.y -= 18 * dt;
        // Into a wall, a rock, a trunk on the way: it hits it and drops (and if he threw it, it lives)
        const sp0 = fv.length();
        if (sp0 > 0.5) {
          const d = fv.clone().divideScalar(sp0);
          const wall = this.trace(g.clone().add(V(0, 0.6, 0)), d, sp0 * dt + HELD_R, false);
          if (wall && Math.abs(wall.normal.y) < 0.75) {
            const into = Math.max(0, -fv.dot(wall.normal));
            fv.addScaledVector(wall.normal, into * 1.3).multiplyScalar(0.35);
            g.copy(wall.point).addScaledVector(d, -HELD_R).sub(V(0, 0.6, 0));
            if (into > 3) {
              this.wallSplat(wall.point, wall.normal, d, into > SLAM_KILL);
              this.ctx.audio.bodyThud(g.distanceTo(pp));
              this.hurtHound(h, Math.max(1, into * 0.15), wall.point.clone(), d);
            }
          }
        }
        g.addScaledVector(fv, dt);
        h.group.rotation.x += h.spin.x * dt;
        h.group.rotation.z += h.spin.z * dt;
        // Into another one on the way
        for (const o of this.hounds) {
          if (o === h || !o.alive || o.held) continue;
          if (o.group.position.distanceTo(g) < 1.3) {
            o.knock.copy(fv).setY(0).multiplyScalar(0.8);
            this.hurtHound(o, 99, o.group.position.clone().add(V(0, 0.7, 0)), fv.clone().normalize());
            fv.multiplyScalar(0.5);
          }
        }
        const gy = W.groundY(g.x, g.z);
        if (g.y <= gy) {
          g.y = gy;
          const sp = fv.length();
          this.flung.delete(h);
          h.group.rotation.x = 0;
          h.group.rotation.z = 0;
          this.ctx.audio.bodyThud(g.distanceTo(pp));
          this.drops.burst(g.clone().add(V(0, 0.4, 0)), V(0, 1, 0), 14, 2.5, ALIEN_BLOOD);
          this.hurtHound(h, Math.max(1, sp * 0.4), g.clone().add(V(0, 0.6, 0)), fv.clone().normalize());
          this.thrown.delete(h);
          if (h.alive) {
            h.state = 'recover';
            h.stateT = -0.8;
          }
        }
        h.animate(dt, this.t);
        continue;
      }
      const dx = pp.x - g.x;
      const dz = pp.z - g.z;
      const dist = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      let target = 0;
      if (h.state === 'lurk') {
        if (h.stateT > 0.6) {
          h.state = 'run';
          h.stateT = 0;
        }
      } else if (h.state === 'run') {
        target = p.alive && this.phase === 'play' ? HOUND_SPEED : 0;
        if (dist < 2.8 && p.alive && this.phase === 'play' && Math.abs(Math.atan2(Math.sin(want - h.yaw), Math.cos(want - h.yaw))) < 0.5) {
          h.state = 'lunge';
          h.stateT = 0;
          h.bit = false;
          h.airV = 3.6;
          h.vel.set(Math.sin(h.yaw), 0, Math.cos(h.yaw)).multiplyScalar(9);
        }
        h.growlT -= dt;
        if (h.growlT <= 0) {
          h.growlT = 6 + Math.random() * 6;
          if (this.t - this.lastGrowl > 2.5) {
            this.lastGrowl = this.t;
            this.ctx.audio.houndScreech(dist);
          }
        }
      } else if (h.state === 'lunge') {
        if (!h.bit && dist < 1.5 && Math.abs(h.air + g.y - pp.y) < 1.4) {
          h.bit = true;
          this.ctx.audio.houndBite(0);
          this.drops.burst(p.camera.position.clone().addScaledVector(p.forwardDir(), 0.5), V(0, 0.4, 0), 10, 2.5, 0xa01010);
          this.shake = Math.max(this.shake, 0.5);
          p.hit('AN ALIEN HOUND', g.clone());
        }
        if (h.stateT > 0.25 && h.air <= 0) {
          h.state = 'recover';
          h.stateT = 0;
        }
      } else if (h.state === 'recover') {
        target = h.bit ? -3 : -1.5;
        if (h.stateT > (h.bit ? 1.1 : 0.5)) {
          h.state = 'run';
          h.stateT = 0;
        }
      }
      if (h.state !== 'lunge') {
        const d = Math.atan2(Math.sin(want - h.yaw), Math.cos(want - h.yaw));
        h.yaw += THREE.MathUtils.clamp(d, -dt * 6, dt * 6);
        h.speed += (target - h.speed) * Math.min(1, dt * 4);
        h.vel.set(Math.sin(h.yaw), 0, Math.cos(h.yaw)).multiplyScalar(h.speed);
      } else {
        h.speed = 9;
      }
      for (const o of this.hounds) {
        if (o === h || !o.alive) continue;
        tmp.subVectors(g, o.group.position).setY(0);
        const l = tmp.length();
        if (l < 1.3 && l > 1e-3) h.vel.addScaledVector(tmp, ((1.3 - l) / l) * 4);
      }
      for (const t of this.trunkGrid.get(`${Math.floor(g.x / 8)},${Math.floor(g.z / 8)}`) ?? []) {
        tmp.set(g.x - t.x, 0, g.z - t.z);
        const l = tmp.length();
        const r = t.r + 0.45;
        if (l < r && l > 1e-3) {
          g.x += (tmp.x / l) * (r - l);
          g.z += (tmp.z / l) * (r - l);
        }
      }
      if (dist < 0.9 && dist > 1e-3) {
        g.x -= (dx / dist) * (0.9 - dist);
        g.z -= (dz / dist) * (0.9 - dist);
      }
      const nx = g.x + h.vel.x * dt;
      const nz = g.z + h.vel.z * dt;
      if (this.part === 1 && inChasm(nx, nz) && !inChasm(g.x, g.z)) {
        // At the edge: no further (they can't see, but they know where the ground stops)
        h.vel.set(0, 0, 0);
        if (h.state === 'lunge') h.state = 'recover';
      } else {
        g.x = nx;
        g.z = nz;
      }
      W.confine(g, 0.5);
      if (h.airV !== 0 || h.air > 0) {
        h.air += h.airV * dt;
        h.airV -= 16 * dt;
        if (h.air <= 0) {
          h.air = 0;
          h.airV = 0;
        }
      }
      let gy = W.groundY(g.x, g.z);
      if (W.inLake(g.x, g.z)) gy = Math.max(gy, WATER_Y - 0.55);
      g.y = gy + h.air;
      h.group.rotation.y = h.yaw;
      h.animate(dt, this.t);
      if (this.part === 1 && h.alive && inChasm(g.x, g.z) && gy < 0) this.hurtHound(h, 99, g.clone().add(V(0, 0.6, 0)), V(0, -1, 0));
    }
  }

  /**
   * `o.knock`: how hard it's thrown back if it dies (else by the damage).
   * One on the grabber, or thrown off it and still in the air, is hurt but
   * never killed by this: only a slam into the rock kills one he's got hold of.
   */
  private hurtHound(h: Hound, dmg: number, point: THREE.Vector3, dir: THREE.Vector3, acid = false, o: { knock?: number } = {}): void {
    if (!acid) {
      this.drops.burst(point, dir.clone().negate().setY(0.3), 12, 3, ALIEN_BLOOD);
      this.ctx.audio.fleshHit();
      if (h.alive) this.alienSpatter(point, dir, dmg >= 2 || h.hp - dmg <= 0);
    }
    if (!h.alive) return;
    h.hp -= dmg;
    if ((h.held || this.thrown.has(h)) && h.hp < 1) h.hp = 1;
    if (!acid) this.ctx.bus.emit(Events.HitMarker, { lethal: h.hp <= 0 });
    if (h.hp > 0) {
      if (!acid) h.speed *= 0.4;
      return;
    }
    if (acid) this.ctx.bus.emit(Events.HitMarker, { lethal: true });
    h.alive = false;
    h.state = 'dead';
    h.deadT = 0;
    h.air = 0;
    h.airV = 0;
    h.melted = acid;
    if (h.held) this.dropHeld(false);
    h.knock.set(dir.x, 0, dir.z).normalize().multiplyScalar(acid ? 0 : o.knock ?? 6.5 + Math.min(dmg, 6) * 1.3);
    this.drops.burst(point, V(0, 1, 0), acid ? 24 : 30, acid ? 2 : 4, acid ? ACID : ALIEN_BLOOD);
    this.acidFuse.delete(h);
    if (!acid) {
      const fv = this.flung.get(h);
      this.flung.delete(h);
      const v = fv ? fv.clone() : h.knock.clone().add(V(0, o.knock !== undefined ? 1.5 + o.knock * 0.3 : 3.2 + Math.min(dmg, 6) * 0.5, 0)).add(h.vel.clone().multiplyScalar(0.5));
      h.group.rotation.x = 0;
      h.group.rotation.z = 0;
      const rd = new HoundRagdoll(this.world, h, v);
      rd.onRest = (at) => {
        this.bloodPool(at.x, at.z, 1.1 + Math.random() * 0.5, 0x6a7a12);
        this.groundSplat(at, 1.6 + Math.random() * 0.6, 'pool');
      };
      this.ragdolls.push(rd);
    } else {
      // Its legs go and it falls over into it, limp, and goes green through as the acid takes it
      this.bloodPool(h.group.position.x, h.group.position.z, 1.3, 0x7ab01a);
      const rd = new HoundRagdoll(this.world, h, V(0, 0.3, 0).add(h.vel.clone().multiplyScalar(0.3)), 1);
      rd.topple();
      this.ragdolls.push(rd);
      this.greening.push({ root: h.group, t: 0, mats: null });
    }
    if (this.t - this.lastGrowl > 1) {
      this.lastGrowl = this.t;
      this.ctx.audio.houndScreech(point.distanceTo(this.player.position));
    }
    for (const hb of h.hitboxes) {
      const i = this.houndHits.indexOf(hb);
      if (i >= 0) this.houndHits.splice(i, 1);
    }
  }

  // ============================================================ blood, the way a man's goes

  /** Their blood thrown from a hit: on whatever's behind (rocks, trees, the station) and splashed over the ground past it. */
  private alienSpatter(point: THREE.Vector3, dir: THREE.Vector3, big: boolean): void {
    this.spatter(point, dir, big);
    const d = V(dir.x, 0, dir.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    d.normalize();
    const n = big ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const r = 0.4 + Math.random() * (big ? 2.6 : 1.3);
      const q = point.clone().addScaledVector(d, r).add(V((Math.random() - 0.5) * 0.9, 0, (Math.random() - 0.5) * 0.9));
      this.groundSplat(q, (big ? 0.75 : 0.45) + Math.random() * 0.6, 'blood', d);
    }
  }

  /** A splat of it on the ground at (x, z), lying on the slope there. */
  private groundSplat(at: THREE.Vector3, size: number, kind: 'blood' | 'pool', stretch?: THREE.Vector3): void {
    if (W.inLake(at.x, at.z) || (this.part === 1 && inChasm(at.x, at.z))) return;
    const y = W.groundY(at.x, at.z);
    if (y > at.y + 1) return;
    const e = 0.3;
    const n = V(W.groundY(at.x - e, at.z) - W.groundY(at.x + e, at.z), 2 * e, W.groundY(at.x, at.z - e) - W.groundY(at.x, at.z + e)).normalize();
    if (n.y < 0.6) return;
    this.decals.place(kind, V(at.x, y, at.z), n, size, stretch, stretch ? 1.8 : 1);
  }

  // ============================================================ the spiderlings

  /** Out of a burst sac at `at`: `n` of them, flung out and down. */
  private hatch(at: THREE.Vector3, n: number): void {
    const b = this.boss;
    this.drops.burst(at, V(0, 0.5, 0), 26, 3.5, 0xffa060);
    for (let k = 0; k < n; k++) {
      const s = new Spiderling();
      s.group.position.copy(at).add(V((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4));
      const out = V(at.x - b.at.x, 0, at.z - b.at.z).normalize();
      const side = V(-out.z, 0, out.x).multiplyScalar((Math.random() - 0.5) * 3);
      s.vel.copy(out).multiplyScalar(3 + Math.random() * 2.5).add(side).add(V(0, 3 + Math.random() * 2, 0));
      s.yaw = Math.atan2(out.x, out.z);
      s.state = 'hatch';
      this.scene.add(s.group);
      this.spiders.push(s);
      this.spiderHits.push(s.hitbox);
    }
  }

  private hurtSpider(s: Spiderling, point: THREE.Vector3, dir: THREE.Vector3, k: number, acid = false): void {
    if (!s.alive) return;
    s.alive = false;
    s.state = 'dead';
    this.ctx.bus.emit(Events.HitMarker, { lethal: true });
    this.drops.burst(point, V(0, 1, 0), 18, 3, acid ? ACID : ALIEN_BLOOD);
    if (acid) {
      this.ctx.audio.gooSplat(point.distanceTo(this.player.position));
      this.greening.push({ root: s.group, t: 0, mats: null });
    } else {
      this.ctx.audio.fleshHit();
      this.alienSpatter(point, dir, false);
    }
    const v = acid ? V((Math.random() - 0.5) * 1.2, 0.8, (Math.random() - 0.5) * 1.2) : V(dir.x, 0, dir.z).normalize().multiplyScalar(6 * k + 2.5).add(V(0, 3 + Math.random() * 2.5, 0));
    const rd = new SpiderlingRagdoll(this.world, s, v);
    rd.onRest = (at) => this.groundSplat(at, 0.55 + Math.random() * 0.4, 'pool');
    this.spiderRags.push(rd);
    const i = this.spiderHits.indexOf(s.hitbox);
    if (i >= 0) this.spiderHits.splice(i, 1);
  }

  /** At him, weaving, low and fast; a leap and a bite at the end. Acid on the ground melts them. */
  private updateSpiders(dt: number): void {
    for (let i = this.spiderRags.length - 1; i >= 0; i--) {
      this.spiderRags[i].update(dt);
      if (this.spiderRags[i].done) this.spiderRags.splice(i, 1);
    }
    const p = this.player;
    const pp = p.position;
    for (const s of this.spiders) {
      if (!s.alive) continue;
      s.stateT += dt;
      const g = s.group.position;
      if (s.state === 'hatch' || s.state === 'leap') {
        s.vel.y -= 14 * dt;
        g.addScaledVector(s.vel, dt);
        if (s.state === 'leap' && !s.bit && p.alive && g.distanceTo(V(pp.x, pp.y + 0.7, pp.z)) < 1.0) {
          s.bit = true;
          p.hit('A SPIDERLING', g.clone());
          this.ctx.audio.houndBite(0);
          this.shake = Math.max(this.shake, 0.3);
          this.drops.burst(p.camera.position.clone().addScaledVector(p.forwardDir(), 0.4), V(0, 0.3, 0), 6, 2, 0xa01010);
          s.vel.multiplyScalar(-0.3);
        }
        const gy = W.groundY(g.x, g.z);
        if (g.y <= gy && s.vel.y < 0) {
          g.y = gy;
          s.state = 'run';
          s.stateT = 0;
          s.vel.set(0, 0, 0);
        }
        s.animate(dt, s.state === 'hatch' ? 3 : 0);
      } else {
        const dx = pp.x - g.x;
        const dz = pp.z - g.z;
        const dist = Math.hypot(dx, dz) || 1;
        const want = Math.atan2(dx, dz) + Math.sin(this.t * 3.2 + s.weave * 5) * 0.65 * Math.min(1, dist / 7);
        const d = Math.atan2(Math.sin(want - s.yaw), Math.cos(want - s.yaw));
        s.yaw += THREE.MathUtils.clamp(d, -dt * 9, dt * 9);
        const sp = p.alive ? 6.2 : 0;
        const nx = g.x + Math.sin(s.yaw) * sp * dt;
        const nz = g.z + Math.cos(s.yaw) * sp * dt;
        if (!(this.part === 1 && inChasm(nx, nz))) {
          g.x = nx;
          g.z = nz;
        }
        for (const o of this.spiders) {
          if (o === s || !o.alive) continue;
          const ox = g.x - o.group.position.x;
          const oz = g.z - o.group.position.z;
          const l = Math.hypot(ox, oz);
          if (l < 0.7 && l > 1e-3) {
            g.x += (ox / l) * (0.7 - l) * 0.5;
            g.z += (oz / l) * (0.7 - l) * 0.5;
          }
        }
        g.y = W.groundY(g.x, g.z);
        if (dist < 2.8 && s.stateT > 0.5 && p.alive) {
          s.state = 'leap';
          s.stateT = 0;
          s.bit = false;
          s.vel.set((dx / dist) * 7.5, 4.4, (dz / dist) * 7.5);
          s.yaw = Math.atan2(dx, dz);
        }
        s.animate(dt, sp);
        // His acid on the ground eats them
        for (const pd of this.puddles) {
          if (pd.life <= 0 || pd.enemy) continue;
          if (Math.hypot(g.x - pd.x, g.z - pd.z) < pd.r) {
            this.hurtSpider(s, g.clone().add(V(0, 0.25, 0)), V(0, 1, 0), 0.3, true);
            break;
          }
        }
      }
      if (s.alive) s.group.rotation.set(0, s.yaw, 0);
    }
  }

  // ============================================================ an egg on the grabber

  /** An uneaten egg the tongue passes through between a and b, or null. */
  private eggOnSegment(a: THREE.Vector3, b: THREE.Vector3, r = 0.6): { mesh: THREE.Object3D; at: THREE.Vector3; eaten: boolean } | null {
    const C = this.level as Level16Data & Partial<CaveExtras>;
    const ab = b.clone().sub(a);
    const l2 = Math.max(1e-6, ab.lengthSq());
    for (const e of C.eggs ?? []) {
      if (e.eaten) continue;
      const u = THREE.MathUtils.clamp(e.at.clone().sub(a).dot(ab) / l2, 0, 1);
      if (a.clone().addScaledVector(ab, u).distanceTo(e.at) < r) return e;
    }
    return null;
  }

  /**
   * The egg the crosshair's right on (the ray from `o` along `dir` through
   * its shell, give or take a hand's width), nearest first; none past
   * `clear` (the first rock or body along the ray), so none behind a wall.
   */
  private eggUnderAim(o: THREE.Vector3, dir: THREE.Vector3, clear: number): { mesh: THREE.Object3D; at: THREE.Vector3; eaten: boolean } | null {
    const C = this.level as Level16Data & Partial<CaveExtras>;
    let best: { mesh: THREE.Object3D; at: THREE.Vector3; eaten: boolean } | null = null;
    let bd = Infinity;
    const to = new THREE.Vector3();
    for (const e of C.eggs ?? []) {
      if (e.eaten) continue;
      to.subVectors(e.at, o);
      const along = to.dot(dir);
      if (along < 0.3 || along > Math.min(26, clear + 0.6) || along > bd) continue;
      const r = 0.3 * e.mesh.scale.x + 0.08;
      if (to.addScaledVector(dir, -along).length() > r) continue;
      bd = along;
      best = e;
    }
    return best;
  }

  /** The tongue's got an egg: off the wall, on its way in. */
  private grabEgg(egg: { mesh: THREE.Object3D; at: THREE.Vector3; eaten: boolean }): void {
    egg.eaten = true;
    egg.mesh.userData.grabbed = true;
    this.scene.attach(egg.mesh);
    egg.mesh.userData.off = egg.mesh.position.clone().sub(egg.at);
    egg.mesh.userData.pos = egg.at.clone();
    egg.mesh.userData.scale0 = egg.mesh.scale.x;
    this.eggGrab = { egg, stage: 'reel', t: 0, bites: 0 };
    this.tongue.state = 'hold';
    this.tongue.tip.copy(egg.at);
    this.ctx.audio.squelchPop();
    this.ctx.audio.houndBite(this.tongue.len);
    this.drops.burst(egg.at, V(0, 0.4, 0), 14, 2, 0xffa060);
  }

  /** Reeled in to the grabber's mouth; then the mouth eats it, bite by bite, and he heals. */
  private updateEggGrab(dt: number): void {
    const E = this.eggGrab!;
    const T = this.tongue;
    const arm = this.grabArm;
    const m = E.egg.mesh;
    const pos = m.userData.pos as THREE.Vector3;
    const off = m.userData.off as THREE.Vector3;
    E.t += dt;
    const mouthAt = arm.muzzleWorld();
    if (E.stage === 'reel') {
      const sp = Math.min(24, 6 + E.t * 40);
      const to = mouthAt.clone().sub(pos);
      const d = to.length();
      pos.addScaledVector(to.normalize(), Math.min(d, sp * dt));
      // Smaller as it comes (the mouth takes it in; it doesn't fill his view)
      const s0 = m.userData.scale0 as number;
      const kk = 1 - 0.55 * smooth(1 - Math.min(1, d / 3));
      m.scale.setScalar(s0 * kk);
      m.position.copy(pos).add(off.clone().multiplyScalar(kk));
      m.rotation.x += dt * 4;
      T.tip.copy(pos);
      T.len = T.tip.distanceTo(T.from);
      arm.chomp = Math.min(1, E.t * 4);
      arm.tremor = 0.4;
      arm.recoil = Math.max(arm.recoil, 0.3);
      if (d < 0.32 || E.t > 2.5) {
        E.stage = 'eat';
        E.t = 0;
        T.state = 'idle';
        T.len = 0;
      }
      return;
    }
    // Eating: the arm brought up in front of him, the mouth working on it, juice running
    const t = E.t;
    const up = smooth(Math.min(1, t / 0.25)) * (1 - smooth((t - 1.15) / 0.3));
    const rest = { p: V(0.25, -0.31, -0.34), r: new THREE.Euler(0.05, 0.06, -0.06) };
    const eat = { p: V(0.08, -0.17, -0.27), r: new THREE.Euler(0.6, 0.5, 0.3) };
    arm.pose = {
      p: rest.p.clone().lerp(eat.p, up),
      r: new THREE.Euler(THREE.MathUtils.lerp(rest.r.x, eat.r.x, up), THREE.MathUtils.lerp(rest.r.y, eat.r.y, up), THREE.MathUtils.lerp(rest.r.z, eat.r.z, up))
    };
    const chew = t < 1.0 ? 0.5 + 0.5 * Math.sin(t * 17) : 0;
    arm.chomp = chew;
    arm.tremor = 0.25;
    const left = 1 - smooth(t / 0.95);
    const sz = 0.45 * left;
    m.scale.setScalar(Math.max(0.001, (m.userData.scale0 as number) * sz * (t < 0.95 ? 1 : 0)));
    m.position.copy(mouthAt).add(off.clone().multiplyScalar(sz)).addScaledVector(this.player.camera.getWorldDirection(new THREE.Vector3()), 0.08);
    const bite = Math.floor(t * 17 / (Math.PI * 2));
    if (bite > E.bites && t < 1.0) {
      E.bites = bite;
      this.drops.burst(mouthAt, V(0, 0.2, 0), 10, 1.4, 0xffa060);
      this.ctx.audio.squelchPop();
      this.shake = Math.max(this.shake, 0.12);
    }
    if (t >= 0.95 && m.visible) {
      m.visible = false;
      const p = this.player;
      p.health = Math.min(p.maxHealth, p.health + 2);
      this.ctx.audio.gulp(0);
      this.drops.burst(mouthAt, V(0, 0.4, 0), 18, 2, 0xffa060);
    }
    if (t > 1.45) {
      arm.pose = null;
      arm.chomp = 0;
      arm.tremor = 0;
      this.eggGrab = null;
    }
  }

  // ============================================================ the reticle

  private reticleTarget = false;
  /** The egg the grabber's tongue was aimed at, if any. */
  private tongueEgg: { mesh: THREE.Object3D; at: THREE.Vector3; eaten: boolean } | null = null;

  /** The alien arms' crosshair: up while they're out, the guns' put away; it looks for something alive under it. */
  private updateReticle(dt: number, on: boolean): void {
    if (!this.reticle) this.reticle = new AlienReticle(this.ctx.uiRoot);
    this.reticleOn = on;
    this.reticle.visible = on;
    if (!on) return;
    this.reticleT -= dt;
    if (this.reticleT <= 0) {
      this.reticleT = 0.1;
      const cam = this.player.camera;
      const dir = cam.getWorldDirection(new THREE.Vector3());
      const h = this.trace(cam.position, dir, 35, true);
      this.reticleTarget = (!!h && ['hound', 'spider', 'boss', 'trap', 'tongue'].includes(h.kind)) || (this.part === 2 && !!this.eggUnderAim(cam.position, dir, h ? h.dist : 35));
    }
    this.reticle.update(dt, {
      acid: this.acidArm.recoil,
      grab: this.eggGrab || this.tongue.state === 'hold' ? 'hold' : this.tongue.state === 'out' ? 'out' : 'idle',
      target: this.reticleTarget
    });
  }

  /** The chasm's light over the pillar nearest him; the cave's over its nearest eggs. */
  private updateLocalLights(dt: number): void {
    const pp = this.player.position;
    if (this.pillarLight) {
      let best = PILLARS[0];
      let bd = Infinity;
      for (const q of PILLARS) {
        const d = Math.hypot(q.x - pp.x, q.z - pp.z);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      const on = pp.z < -128 && bd < 40;
      this.pillarLight.position.set(best.x, best.y + 1.6, best.z);
      this.pillarLight.intensity += ((on ? 6 : 0) - this.pillarLight.intensity) * Math.min(1, dt * 3);
    }
    if (this.eggLights.length) {
      this.eggLightT -= dt;
      if (this.eggLightT > 0) return;
      this.eggLightT = 0.4;
      const C = this.level as Level16Data & Partial<CaveExtras>;
      const near = (C.eggs ?? []).filter((e) => !e.eaten).sort((a, b) => a.at.distanceToSquared(pp) - b.at.distanceToSquared(pp));
      this.eggLights.forEach((l, i) => {
        const e = near[i];
        if (e) l.position.copy(e.at);
        else l.position.set(0, -500, 0);
      });
    }
  }

  private knifeSlash(): void {
    const p = this.player.position;
    const f = this.player.forwardDir();
    for (const h of this.hounds) {
      if (!h.alive || h.held) continue;
      const at = h.group.position;
      const dx = at.x - p.x;
      const dz = at.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.0) continue;
      if ((dx * f.x + dz * f.z) / Math.max(d, 1e-4) < 0.4) continue;
      this.hurtHound(h, 2, at.clone().setY(at.y + 0.7), V(dx, 0, dz).normalize());
      this.ctx.audio.knifeStab();
      return;
    }
    if (this.heldBy) {
      this.hurtTrap(this.heldBy, 2, this.heldBy.group.position.clone().add(V(0, 0.4, 0)), V(0, -1, 0));
      this.ctx.audio.knifeStab();
    }
  }

  // ============================================================ his alien arms

  /**
   * Right mouse: the acid arm lobs a glob that bursts into a pool. Left
   * mouse: the grabber's tongue shoots out; if it takes a hound, he has it
   * on the end while he holds the button — swing it about with the mouse,
   * let go and it's thrown.
   */
  private updateArms(dt: number, canFire: boolean): void {
    const { input } = this.ctx;
    const p = this.player;
    // ---- Acid
    if (canFire && input.rightHeld && this.acidArm.fire(0.42)) {
      const from = this.acidArm.muzzleWorld();
      const dir = p.camera.getWorldDirection(new THREE.Vector3());
      const v = dir.multiplyScalar(25).add(V(0, 2.2, 0)).add(p.velocity.clone().multiplyScalar(0.5));
      this.acidShots.fire(from, v, 'player', 1.5);
      this.ctx.audio.gooShot();
      this.acidLight.position.copy(from);
      this.acidLight.intensity = 12;
      this.shake = Math.max(this.shake, 0.1);
    }
    // ---- The grabber
    const T = this.tongue;
    const lmb = input.mouseHeld && canFire;
    T.from.copy(this.grabArm.muzzleWorld());
    if (lmb && !this.lmbWas && T.state === 'idle' && this.grabArm.stow < 0.1) {
      // Out along where he's aiming
      const dir = p.camera.getWorldDirection(new THREE.Vector3());
      const aim = this.trace(p.camera.position, dir, 30, true);
      let at = aim ? aim.point : p.camera.position.clone().addScaledVector(dir, 30);
      // In the cave: an egg he's got the crosshair right on, in plain sight (not behind rock), the tongue goes for it
      this.tongueEgg = this.part === 2 ? this.eggUnderAim(p.camera.position, dir, aim ? aim.dist : 30) : null;
      if (this.tongueEgg) at = this.tongueEgg.at.clone();
      T.dir.copy(at).sub(T.from).normalize();
      T.state = 'out';
      T.len = 0;
      this.ctx.audio.kickWhoosh();
      this.ctx.audio.squelchPop();
    }
    if (T.state === 'out') {
      const before = T.len;
      T.len += 46 * dt;
      T.tip.copy(T.from).addScaledVector(T.dir, T.len);
      this.grabArm.recoil = Math.max(this.grabArm.recoil, 0.6);
      const a = T.from.clone().addScaledVector(T.dir, before);
      const h = this.trace(a, T.dir, T.len - before, true);
      // An egg it gets to before anything else in the way: the one he aimed at, or one square on its line.
      // (Eggs sit on the rock, so the rock just behind the one he aimed at doesn't count as in the way.)
      const reach = h ? before + h.dist : T.len;
      const aimed = this.tongueEgg;
      let egg = aimed && !aimed.eaten && aimed.at.distanceTo(T.from) <= reach + 0.45 ? aimed : null;
      if (!egg && this.part === 2) egg = this.eggOnSegment(a, h ? h.point : T.tip, 0.38);
      if (egg) this.grabEgg(egg);
      else if (h && h.kind === 'spider' && h.spider) {
        this.hurtSpider(h.spider, h.point, T.dir, 1);
        T.tip.copy(h.point);
        T.state = 'back';
        this.ctx.audio.squelchPop();
      } else if (h && h.kind === 'hound' && h.hound && h.hound.alive) {
        this.takeHold(h.hound);
      } else if (h && h.kind === 'trap' && h.trap) {
        // Torn out of the ground
        this.hurtTrap(h.trap, 99, h.point, T.dir);
        this.ctx.audio.squelchPop();
        T.state = 'back';
      } else if (h) {
        T.tip.copy(h.point);
        T.state = 'back';
        this.drops.burst(h.point, h.normal, 6, 1.5, 0xc04a8a);
      } else if (T.len > 26 || !lmb) T.state = 'back';
      if (T.state !== 'out') this.tongueEgg = null;
    }
    if (this.eggGrab) this.updateEggGrab(dt);
    else if (T.state === 'hold' && this.holding) {
      const hd = this.holding;
      if (!hd.alive || !lmb) {
        this.dropHeld(lmb);
      } else {
        // Out in front of him, where he looks: swung round as he turns
        const dir = p.camera.getWorldDirection(new THREE.Vector3());
        const want = p.camera.position.clone().addScaledVector(dir, 4.2);
        // (Not up a wall's height: the cave's floor "rises" 12 m inside its rock)
        want.y = Math.max(want.y - 0.6, Math.min(W.groundY(want.x, want.z), p.position.y + 1.2) - 0.4);
        const g = hd.group.position;
        this.holdPrev.copy(g);
        const vIn = this.holdVel.clone();
        const next = g.clone().lerp(want, Math.min(1, dt * 12));
        // Whatever rock is in the way (a wall, a boulder, a trunk, the ground): it stops against it
        const mv = next.clone().sub(g);
        const L = mv.length();
        let hit: Hit | null = null;
        if (L > 1e-4) {
          const d = mv.clone().divideScalar(L);
          hit = this.trace(g.clone().add(V(0, 0.6, 0)), d, L + HELD_R, false);
          if (hit) {
            next.copy(hit.point).addScaledVector(d, -HELD_R).sub(V(0, 0.6, 0));
            if (next.clone().sub(g).dot(d) < 0) next.copy(g);
          }
        }
        g.copy(next);
        this.holdVel.subVectors(g, this.holdPrev).divideScalar(Math.max(dt, 1e-4));
        if (hit) this.slamHeld(hd, hit, vIn, mv.normalize());
      }
      if (this.holding === hd && hd.alive) {
        const g = hd.group.position;
        hd.group.rotation.y = p.yaw + Math.PI;
        T.tip.copy(g).add(V(0, 0.75, 0));
        T.len = T.tip.distanceTo(T.from);
        this.grabArm.tremor = 0.6;
        this.grabArm.recoil = Math.max(this.grabArm.recoil, 0.4);
        // Swung into the others
        const sp = this.holdVel.length();
        if (sp > 3.5)
          for (const o of this.hounds) {
            if (o === hd || !o.alive || o.held) continue;
            if (o.group.position.distanceTo(g) < 1.5) {
              // Knocked flying with the swing
              const d = this.holdVel.clone().setY(0).normalize();
              o.knock.copy(d).multiplyScalar(Math.min(14, sp * 1.2));
              this.hurtHound(o, 99, o.group.position.clone().add(V(0, 0.7, 0)), d);
              this.hurtHound(hd, 1, g.clone().add(V(0, 0.7, 0)), d.clone().negate());
              this.ctx.audio.bodyThud(0);
              this.shake = Math.max(this.shake, 0.35);
            }
          }
      }
    } else this.grabArm.tremor = 0;
  }

  private takeHold(h: Hound): void {
    const T = this.tongue;
    this.holding = h;
    h.held = true;
    h.air = 0;
    h.airV = 0;
    h.state = 'recover';
    this.flung.delete(h);
    this.thrown.delete(h);
    this.acidFuse.delete(h);
    T.state = 'hold';
    this.holdPrev.copy(h.group.position);
    this.holdVel.set(0, 0, 0);
    if (!this.slamHinted) {
      this.slamHinted = true;
      this.hint('SWING IT INTO THE ROCK — HARD — TO KILL IT', 5);
    }
    this.ctx.audio.houndBite(0);
    this.ctx.audio.houndScreech(T.len);
    this.shake = Math.max(this.shake, 0.3);
  }

  /** Let go of what's on the end: thrown (`throwIt`) or just dropped as the tongue comes back. */
  private dropHeld(stillHeld: boolean): void {
    const h = this.holding;
    this.holding = null;
    if (h) {
      h.held = false;
      if (h.alive || !stillHeld) {
        const v = this.holdVel.clone().multiplyScalar(1.15).add(V(0, 2.5, 0));
        if (v.length() > 26) v.setLength(26);
        this.flung.set(h, v);
        if (h.alive) this.thrown.add(h);
        h.spin.set((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12);
        if (v.length() > 6) this.ctx.audio.kickWhoosh();
      }
    }
    this.tongue.state = 'back';
  }

  /**
   * The hound on the grabber's just been swung into `hit` at `vIn`. Hard
   * enough and it bursts against it, dead, blood across the rock; less hard
   * and it's hurt, a smear where it hit; gently, nothing.
   */
  private slamHeld(hd: Hound, hit: Hit, vIn: THREE.Vector3, d: THREE.Vector3): void {
    const n = hit.normal;
    const speed = Math.max(-vIn.dot(n), vIn.dot(d) * 0.8);
    if (speed < SLAM_HURT || this.t - this.slamAt < 0.3) return;
    this.slamAt = this.t;
    const kill = speed >= SLAM_KILL;
    const at = hit.point;
    this.wallSplat(at, n, vIn.lengthSq() > 1e-4 ? vIn.clone().normalize() : d, kill);
    this.ctx.audio.bodyThud(0);
    this.ctx.audio.punchImpact(kill);
    this.drops.burst(at.clone().addScaledVector(n, 0.2), n, kill ? 40 : 14, kill ? 5 : 3, ALIEN_BLOOD);
    if (kill) {
      // Let go of it: it drops off the rock, broken
      this.holding = null;
      hd.held = false;
      this.tongue.state = 'back';
      this.holdVel.set(0, 0, 0);
      this.shake = Math.max(this.shake, 0.6);
      this.ctx.audio.kickImpact();
      const away = n.clone().setY(Math.max(0, n.y));
      if (away.lengthSq() < 1e-4) away.copy(d).negate();
      this.hurtHound(hd, 99, at.clone().addScaledVector(n, 0.3), away.normalize(), false, { knock: 1.5 + speed * 0.1 });
    } else {
      this.shake = Math.max(this.shake, 0.25);
      this.ctx.audio.houndScreech(0);
      this.hurtHound(hd, 1, at.clone().addScaledVector(n, 0.3), d);
    }
  }

  /** Blood across the rock where something hit it: a burst, stretched the way it was going, flecks round it; it runs. */
  private wallSplat(at: THREE.Vector3, n: THREE.Vector3, d: THREE.Vector3, big: boolean): void {
    const tang = d.clone().addScaledVector(n, -d.dot(n));
    this.decals.place('blood', at, n, big ? 1.2 + Math.random() * 0.5 : 0.55 + Math.random() * 0.3, tang.lengthSq() > 0.01 ? tang : undefined, big ? 1.7 : 1.3);
    // Round it, each found on the rock itself (it's not flat)
    const u = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0)).normalize();
    const w = new THREE.Vector3().crossVectors(n, u);
    const k = big ? 8 : 3;
    const back = n.clone().negate();
    for (let i = 0; i < k; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.3 + Math.random()) * (big ? 1.5 : 0.7);
      const off = u.clone().multiplyScalar(Math.cos(a) * r).addScaledVector(w, Math.sin(a) * r).addScaledVector(tang, 0.4 * r);
      const h = this.trace(at.clone().add(off).addScaledVector(n, 0.6), back, 1.5, false);
      if (h) this.decals.place('blood', h.point, h.normal, 0.15 + Math.random() * (big ? 0.55 : 0.3), off, 1.6);
    }
    // And a pool below, where it runs down to
    if (big) this.groundSplat(at.clone().addScaledVector(n, 0.5), 0.9 + Math.random() * 0.5, 'pool');
  }

  /** Bodies dying in acid: through green, glowing faintly, smoking. */
  private updateGreening(dt: number): void {
    for (let i = this.greening.length - 1; i >= 0; i--) {
      const b = this.greening[i];
      b.t += dt;
      if (!b.mats) {
        // Its own copies of its materials, to colour (they're shared by every one of them)
        b.mats = [];
        const seen = new Map<THREE.Material, THREE.Material>();
        b.root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !m.visible) return;
          const src = m.material as THREE.Material;
          if (Array.isArray(src) || !('color' in src)) return;
          let c = seen.get(src);
          if (!c) {
            c = src.clone();
            seen.set(src, c);
            const mm = c as THREE.MeshStandardMaterial;
            b.mats!.push({ m: mm, c0: mm.color.clone(), e0: mm.emissive ? mm.emissive.clone() : null });
          }
          m.material = c;
        });
      }
      const k = smooth(Math.min(1, b.t / 1.8));
      for (const e of b.mats) {
        e.m.color.copy(e.c0).lerp(ACID_GREEN, k * 0.9);
        if (e.e0) (e.m as THREE.MeshStandardMaterial).emissive.copy(e.e0).lerp(ACID_GLOW, k * 0.6);
      }
      const at = b.root.getWorldPosition(new THREE.Vector3());
      if (b.t < 3.5 && Math.random() < dt * 5) this.particles.smokeColumn(at.clone().add(V(0, 0.3, 0)), 0.3, 1);
      if (b.t < 2.5 && Math.random() < dt * 6) this.drops.burst(at.clone().add(V(0, 0.4, 0)), V(0, 1, 0), 3, 1.2, ACID);
      if (b.t > 4) this.greening.splice(i, 1);
    }
  }

  private retract(T: Tongue): void {
    if (T === this.tongue && this.holding) this.dropHeld(false);
    if (T.state !== 'idle') T.state = 'back';
  }

  private makeTongue(radius: number, headScale: number): Tongue {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), wetFlesh(4));
    mesh.frustumCulled = false;
    mesh.visible = false;
    const head = grabberHead().group;
    head.scale.setScalar(headScale);
    head.visible = false;
    this.scene.add(mesh, head);
    return { state: 'idle', from: new THREE.Vector3(), tip: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), len: 0, mesh, head, radius };
  }

  /** Both tongues: drawn from where they leave the arm to their tips, a sag in them, ribbed. */
  private updateTongues(dt: number): void {
    for (const T of [this.tongue, this.bossTongue]) {
      if (T.state === 'back') {
        T.len = Math.max(0, T.len - 55 * dt);
        T.dir.copy(T.tip).sub(T.from).normalize();
        T.tip.copy(T.from).addScaledVector(T.dir, T.len);
        if (T.len < 0.3) T.state = 'idle';
      }
      const on = T.state !== 'idle' && T.len > 0.05;
      T.mesh.visible = on;
      T.head.visible = on;
      if (!on) continue;
      const a = T.from;
      const b = T.tip;
      const len = a.distanceTo(b);
      const mid = a.clone().lerp(b, 0.5).add(V(0, -Math.min(1.5, len * 0.06), 0));
      const w = a.clone().lerp(b, 0.25).add(V(Math.sin(this.t * 13) * 0.05 * len * 0.05, 0, Math.cos(this.t * 11) * 0.05 * len * 0.05));
      const curve = new THREE.CatmullRomCurve3([a.clone(), w, mid, b.clone()]);
      const segs = 28;
      const radial = 8;
      const g = new THREE.TubeGeometry(curve, segs, T.radius, radial, false);
      const pp = g.getAttribute('position') as THREE.BufferAttribute;
      const c = new THREE.Vector3();
      const v = new THREE.Vector3();
      const col = new Float32Array(pp.count * 3);
      for (let i = 0; i < pp.count; i++) {
        const u = Math.floor(i / (radial + 1)) / segs;
        curve.getPointAt(Math.min(1, u), c);
        const rib = 1 + 0.25 * Math.max(0, Math.sin(u * len * 9));
        v.fromBufferAttribute(pp, i).sub(c).multiplyScalar(rib);
        pp.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
        col[i * 3] = 0.75;
        col[i * 3 + 1] = 0.25;
        col[i * 3 + 2] = 0.45;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      T.mesh.geometry.dispose();
      T.mesh.geometry = g;
      T.head.position.copy(b);
      T.head.lookAt(b.clone().add(curve.getTangentAt(1)));
    }
    // The big one's tongue-tip is a thing to shoot
    const BT = this.bossTongue;
    this.tongueHit.position.copy(BT.tip);
    this.tongueHit.visible = BT.state === 'out';
  }

  // ============================================================ acid

  private buildPools(): void {
    for (let i = 0; i < 280; i++) {
      const mat = puddleMaterial(Math.random() * 40);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 10, 10), mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      this.puddles.push({ mesh, mat, x: 0, z: 0, r: 1, life: 0, max: 1, enemy: false, burn: 0 });
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5a20, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    for (let i = 0; i < 48; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), ringMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 4;
      this.scene.add(ring);
      this.markers.push({ mesh: ring, t: 0, land: -1, r: 1 });
    }
  }

  /** A pool of acid where something came down: lying on the ground, whatever its shape. */
  /**
   * Where a pool lands at (x, z) from a splash at height `y`: if that's up a
   * wall (the ground there far above the splash), out from the wall to the
   * floor at its foot. Its height there.
   */
  private floorAt(x: number, y: number, z: number): { x: number; z: number; y: number } {
    let gy = W.groundY(x, z);
    if (gy <= y + 0.6) return { x, z, y: gy };
    const n = W.normal(x, y, z).setY(0);
    if (n.lengthSq() < 1e-4) n.set(-x, 0, -z);
    n.normalize();
    for (let k = 0; k < 24 && gy > y + 0.6; k++) {
      x += n.x * 0.25;
      z += n.z * 0.25;
      gy = W.groundY(x, z);
    }
    return { x, z, y: gy };
  }

  /**
   * A point of a pool's outline (`u`, `v` in −1..1 across it) laid on the
   * ground round its middle at height `y0`: where the ground steps up a wall
   * or drops away, the outline's pulled in short of it rather than climbing it.
   */
  private drape(cx: number, cz: number, r: number, u: number, v: number, y0: number, out: THREE.Vector3): THREE.Vector3 {
    let s = 1;
    let x = cx + u * r;
    let z = cz + v * r;
    let gy = W.groundY(x, z);
    for (let k = 0; k < 8 && Math.abs(gy - y0) > 0.45; k++) {
      s *= 0.72;
      x = cx + u * r * s;
      z = cz + v * r * s;
      gy = W.groundY(x, z);
    }
    return out.set(x, THREE.MathUtils.clamp(gy, y0 - 0.45, y0 + 0.45), z);
  }

  private spawnPuddle(x0: number, z0: number, r: number, enemy: boolean, life = 6, fromY = Infinity): void {
    const f = this.floorAt(x0, fromY, z0);
    const x = f.x;
    const z = f.z;
    const y0 = f.y;
    if (W.inLake(x, z) && y0 < WATER_Y) return;
    const pd = this.puddles.reduce((a, b) => (b.life < a.life ? b : a));
    pd.x = x;
    pd.z = z;
    pd.r = r;
    pd.life = life;
    pd.max = life;
    pd.enemy = enemy;
    pd.burn = 0.5;
    const pos = pd.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = pd.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const q = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      this.drape(x, z, r, uv.getX(i) * 2 - 1, -(uv.getY(i) * 2 - 1), y0, q);
      pos.setXYZ(i, q.x, q.y + 0.06, q.z);
    }
    pos.needsUpdate = true;
    pd.mesh.geometry.computeBoundingSphere();
    pd.mesh.visible = true;
    this.drops.burst(V(x, y0 + 0.1, z), V(0, 1, 0), 16, 3, ACID);
    this.ctx.audio.gooSplat(Math.hypot(x - this.player.position.x, z - this.player.position.z));
  }

  private static poolTex: THREE.CanvasTexture | null = null;
  private bloodPool(x: number, z: number, r: number, color: number): void {
    if (!Level16Scene.poolTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * 6.28;
        const d = Math.random() * 30;
        g.beginPath();
        g.ellipse(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 18 + Math.random() * 22, 14 + Math.random() * 18, Math.random() * 3, 0, Math.PI * 2);
        g.fill();
      }
      for (let k = 0; k < 20; k++) {
        g.beginPath();
        const a = Math.random() * 6.28;
        g.arc(64 + Math.cos(a) * (40 + Math.random() * 18), 64 + Math.sin(a) * (40 + Math.random() * 18), 2 + Math.random() * 5, 0, Math.PI * 2);
        g.fill();
      }
      Level16Scene.poolTex = new THREE.CanvasTexture(c);
    }
    const geo = new THREE.PlaneGeometry(2, 2, 8, 8);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const y0 = W.groundY(x, z);
    const q = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      this.drape(x, z, r, uv.getX(i) * 2 - 1, -(uv.getY(i) * 2 - 1), y0, q);
      pos.setXYZ(i, q.x, q.y + 0.035, q.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color, alphaMap: Level16Scene.poolTex, transparent: true, opacity: 0.92, roughness: 0.08, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    mesh.scale.setScalar(0.01);
    this.scene.add(mesh);
    this.bloodPools.push({ mesh, mat, r, t: 0 });
    if (this.bloodPools.length > 40) {
      const old = this.bloodPools.shift()!;
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      old.mat.dispose();
    }
  }

  /** Spreading out from the middle (the geometry's in world space, so it grows about its own centre). */
  private updateBloodPools(dt: number): void {
    for (const b of this.bloodPools) {
      if (b.t >= 3) continue;
      b.t += dt;
      const k = Math.min(1, b.t / 3);
      const s = 0.15 + 0.85 * (1 - Math.pow(1 - k, 2));
      const pos = b.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      b.mesh.geometry.computeBoundingSphere();
      const c = b.mesh.geometry.boundingSphere!.center;
      b.mesh.position.set(c.x * (1 - s), 0, c.z * (1 - s));
      b.mesh.scale.set(s, 1, s);
      void pos;
    }
  }

  private mark(x: number, z: number, r: number, land: number): void {
    const m = this.markers.find((k) => k.land < 0);
    if (!m) return;
    m.t = 0;
    m.land = land;
    m.r = r;
    m.mesh.position.set(x, W.groundY(x, z) + 0.12, z);
    m.mesh.visible = true;
  }

  private updateAcid(dt: number): void {
    const p = this.player;
    const pp = p.position;
    const seg = new THREE.Vector3();
    // ---- His globs: whatever they hit, a pool where they land
    this.acidShots.update(dt, this.t, (s, a, b) => {
      seg.subVectors(b, a);
      const len = seg.length();
      if (len < 1e-5) return false;
      seg.divideScalar(len);
      const h = this.trace(a, seg, len, true);
      if (!h) return false;
      this.acidHit(s, h, seg);
      return true;
    });
    // ---- Its globs: on him, or on the ground
    this.bossAcid.update(dt, this.t, (shot, a, b) => {
      seg.subVectors(b, a);
      const len = seg.length();
      if (len < 1e-5) return false;
      seg.divideScalar(len);
      if (p.alive) {
        const c = pp.clone().add(V(0, 0.95, 0));
        const t = THREE.MathUtils.clamp(c.clone().sub(a).dot(seg), 0, len);
        const near = a.clone().addScaledVector(seg, t);
        if (Math.abs(near.x - c.x) < 0.4 && Math.abs(near.z - c.z) < 0.4 && Math.abs(near.y - c.y) < 0.95) {
          this.shake = Math.max(this.shake, 0.4);
          this.vignette.style.opacity = '0.8';
          p.hit('ACID', a.clone());
          this.spawnPuddle(near.x, near.z, 1.7, true, 6, near.y);
          return true;
        }
      }
      if (b.y < W.groundY(b.x, b.z)) {
        this.spawnPuddle(b.x, b.z, PUDDLE_R, true, shot.damage, a.y);
        return true;
      }
      return false;
    });
    // ---- The warning rings: closing in on where it'll land, pulsing
    for (const m of this.markers) {
      if (m.land < 0) continue;
      m.t += dt;
      const k = Math.min(1, m.t / m.land);
      m.mesh.scale.setScalar(m.r * (1 + (1 - k) * 1.3));
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.35 * Math.abs(Math.sin(m.t * (6 + k * 10)));
      if (m.t >= m.land) {
        m.land = -1;
        m.mesh.visible = false;
      }
    }
    // ---- Melting: stopped where it stands, smoking, and down in it a second and a half from the first touch
    for (const [h, t0] of this.acidFuse) {
      if (!h.alive) {
        this.acidFuse.delete(h);
        continue;
      }
      const g = h.group.position;
      const k = (this.t - t0) / 1.6;
      h.speed *= Math.exp(-dt * (5 + k * 8));
      h.knock.multiplyScalar(Math.exp(-dt * 6));
      if (Math.random() < dt * 6) this.particles.smokeColumn(g.clone().add(V(0, 0.5, 0)), 0.35, 1);
      if (Math.random() < dt * 5) this.drops.burst(g.clone().add(V(0, 0.6, 0)), V(0, 1, 0), 3, 1.2, ACID);
      if (this.hissT <= 0) {
        this.hissT = 0.45;
        this.ctx.audio.fireCrackle(g.distanceTo(pp));
      }
      if (k >= 1) this.hurtHound(h, 999, g.clone().add(V(0, 0.5, 0)), V(0, 1, 0), true);
    }
    // ---- The pools: eat what's in them, then dry up
    this.hissT -= dt;
    let inAcid: Puddle | null = null;
    for (const pd of this.puddles) {
      if (pd.life <= 0) continue;
      pd.life -= dt;
      const grow = Math.min(1, (pd.max - pd.life) / 0.25);
      pd.mat.uniforms.uFade.value = Math.min(1, pd.life / 1.5) * grow;
      pd.mat.uniforms.uT.value = this.t;
      if (pd.life <= 0) {
        pd.mesh.visible = false;
        continue;
      }
      const r = pd.r * 0.82;
      if (Math.random() < dt * 3) this.drops.burst(V(pd.x + (Math.random() - 0.5) * pd.r, W.groundY(pd.x, pd.z) + 0.1, pd.z + (Math.random() - 0.5) * pd.r), V(0, 1, 0), 2, 0.8, ACID);
      // Hounds that step in it are done for
      for (const h of this.hounds) {
        if (!h.alive || h.held || this.flung.has(h)) continue;
        const g = h.group.position;
        if (Math.hypot(g.x - pd.x, g.z - pd.z) > r + 0.3) continue;
        if (!this.acidFuse.has(h)) this.acidFuse.set(h, this.t);
      }
      // Maws in it die
      for (const m of this.traps) {
        if (m.state === 'dead') continue;
        const g = m.group.position;
        if (Math.hypot(g.x - pd.x, g.z - pd.z) < r + 0.4) {
          m.hp -= dt * 1.5;
          if (m.hp <= 0) this.hurtTrap(m, 1, g.clone().add(V(0, 0.3, 0)), V(0, 1, 0));
        }
      }
      // Its acid burns him
      if (pd.enemy && p.alive && Math.hypot(pp.x - pd.x, pp.z - pd.z) < r && pp.y - W.groundY(pp.x, pp.z) < 0.4) inAcid = pd;
    }
    if (inAcid) {
      this.burnT += dt;
      this.vignette.style.opacity = '0.55';
      if (this.burnT > 0.85) {
        this.burnT = 0;
        this.ctx.audio.fireCrackle(0);
        this.shake = Math.max(this.shake, 0.25);
        p.hit('ACID', V(inAcid.x, pp.y, inAcid.z));
      }
    } else this.burnT = Math.min(this.burnT, 0.5);
  }

  private acidHit(s: GlowShot, h: Hit, dir: THREE.Vector3): void {
    this.drops.burst(h.point, h.normal, 14, 2.6, ACID);
    if (h.kind === 'hound' && h.hound) {
      if (!this.acidFuse.has(h.hound)) this.acidFuse.set(h.hound, this.t - 0.5);
      this.hurtHound(h.hound, s.damage, h.point, dir, true);
    }
    else if (h.kind === 'spider' && h.spider) this.hurtSpider(h.spider, h.point, dir, 0.6);
    else if (h.kind === 'boss') this.hurtBoss(s.damage * 2, h.point, dir, !!h.head);
    else if (h.kind === 'trap' && h.trap) this.hurtTrap(h.trap, s.damage * 2, h.point, dir);
    else if (h.kind === 'tongue') this.hurtTongue(3);
    this.spawnPuddle(h.point.x, h.point.z, 1.6, false, 6, h.point.y);
  }

  // ============================================================ the big one

  /**
   * It circles him; every so often it does one of four things. It lobs acid
   * at him (rings on the ground where it'll land); it sprays a whole field
   * of it round him (get out — the pressure shotgun); it sends its grabber
   * for him (shoot the tongue-tip, or if it gets him, F to tear free before
   * it pulls him in to its mouth); or it reaches for a tree, tears it up and
   * drags it along the ground through where he's standing (jump it, or get
   * out of the way).
   */
  private updateBoss(dt: number): void {
    const b = this.boss;
    const p = this.player;
    if (!b.alive) {
      b.update(dt, this.bossVel.set(0, 0, 0), [null, null]);
      return;
    }
    if (!this.bossAwake) {
      b.update(dt, this.bossVel.set(0, 0, 0), [null, null]);
      if (this.playable && p.position.z < -82) this.wakeBoss();
      return;
    }
    const pp = p.position;
    const to = V(pp.x - b.at.x, 0, pp.z - b.at.z);
    const dist = to.length();
    to.normalize();
    const enraged = b.hp < b.maxHp * 0.5;
    // ---- Moving: circling him, standing still while it reaches
    const still = this.move === 'grab' || this.move === 'tree' || this.move === 'stagger' || this.move === 'spray';
    this.bossSideT -= dt;
    if (this.bossSideT <= 0) {
      this.bossSideT = 4 + Math.random() * 4;
      this.bossSide = Math.random() < 0.5 ? -1 : 1;
    }
    const radial = THREE.MathUtils.clamp((dist - 15) * 0.5, -3.5, 2.5);
    const want = to.clone().multiplyScalar(radial).add(V(-to.z, 0, to.x).multiplyScalar(this.bossSide * (enraged ? 3.2 : 2.2)));
    const off = V(b.at.x - ARENA.x, 0, b.at.z - ARENA.z);
    if (off.length() > 20) want.addScaledVector(off.normalize(), -3);
    if (!p.alive || this.phase !== 'play' || still) want.set(0, 0, 0);
    this.bossVel.lerp(want, Math.min(1, dt * 1.5));
    b.at.x += this.bossVel.x * dt;
    b.at.z += this.bossVel.z * dt;
    b.at.y = W.groundY(b.at.x, b.at.z);
    // Faces him (or, reaching for a tree, the tree)
    let faceAt = pp;
    if (this.tree && this.tree.stage !== 'drag') faceAt = this.bossTongue.tip;
    const face = Math.atan2(faceAt.x - b.at.x, faceAt.z - b.at.z);
    const dy = Math.atan2(Math.sin(face - b.yaw), Math.cos(face - b.yaw));
    b.yaw += THREE.MathUtils.clamp(dy, -dt * 1.6, dt * 1.6);
    // Arms: the acid one up for a lob, the grabber at its tongue's tip
    const up = b.at.clone().addScaledVector(to, 6).add(V(0, 14, 0));
    const aimAcid = this.move === 'mortar' || this.move === 'spray' ? up : p.camera.position.clone();
    const aimGrab = this.bossTongue.state !== 'idle' ? this.bossTongue.tip.clone() : p.camera.position.clone();
    b.update(dt, this.bossVel, [aimAcid, aimGrab]);
    // He's in its way: it shoves him off
    if (dist < 3.4 && p.alive && !this.grabbed && !this.eating) {
      p.launch(V(to.x, 0.35, to.z).normalize(), 7);
      if (this.t - this.lastStomp > 1.2) {
        this.lastStomp = this.t;
        p.hit(BOSS_NAME, b.at.clone());
        this.ctx.audio.stomp(dist);
        this.shake = Math.max(this.shake, 0.7);
      }
    }
    this.hud.setBoss(BOSS_NAME, b.hp / b.maxHp);
    if (!p.alive || this.phase !== 'play') return;
    // ---- What it's doing
    this.moveT += dt;
    const T = this.bossTongue;
    T.from.copy(b.muzzle(1));
    switch (this.move) {
      case 'idle': {
        if (this.moveT > (enraged ? 1.3 : 2.1)) {
          const order: BossMove[] = ['mortar', 'grab', 'brood', 'spray', 'tree'];
          let next = order[this.moveI++ % order.length];
          if (next === 'tree' && this.treeUsed.every((u) => u)) next = 'mortar';
          if (next === 'brood' && (b.ripeSacs() < 3 || this.spiders.filter((s) => s.alive).length > 3)) next = 'grab';
          this.startMove(next);
        }
        break;
      }
      case 'mortar': {
        // A barrage up into the air, coming down all over the ground round him: a ring where each will land,
        // spaced so there's somewhere between them to stand — he has to get into a gap before it comes down
        const pts = this.mortarPts;
        const n = pts.length;
        while (this.moveShots < n && this.moveT > 0.35 + this.moveShots * 0.07) {
          const q = pts[this.moveShots];
          this.lob(q.x, q.z, PUDDLE_R, 2.1 + this.moveShots * 0.02);
          this.moveShots++;
        }
        if (this.moveShots >= n && this.moveT > 0.35 + n * 0.07 + 2.8) this.startMove('idle');
        break;
      }
      case 'spray': {
        // Arc after arc of it, out from its feet toward him, each wider than the last; the near ones dry first,
        // so the way out is over the wave toward the tip (a pressure shot)
        const S = this.spray;
        const gap = enraged ? 0.32 : 0.38;
        if (this.moveShots < S.arcs && this.moveT >= 0.7 + this.moveShots * gap) {
          const k = this.moveShots;
          const r = 4 + k * S.step;
          // Each arc fans wider than the last: by the far ones, well over a right angle across
          const w = 0.38 + k * 0.17;
          const n = Math.max(3, Math.ceil((2 * w * r) / 3.1) + 1);
          for (let j = 0; j < n; j++) {
            const a = S.base - w + (2 * w * j) / (n - 1);
            this.lob(S.o.x + Math.sin(a) * r, S.o.z + Math.cos(a) * r, PUDDLE_R, 0.9, 1.9 + k * 0.05, false);
          }
          this.moveShots++;
          this.shake = Math.max(this.shake, 0.2);
          if (k === 0 && !this.sprayHinted) {
            this.sprayHinted = true;
            this.hint('A WAVE OF ACID — JUMP IT WITH A PRESSURE SHOT, TOWARD WHERE IT STARTED (IT DRIES THERE FIRST)', 6);
          }
        }
        if (this.moveShots >= S.arcs && this.moveT > 0.7 + S.arcs * gap + 1.4) this.startMove('idle');
        break;
      }
      case 'grab': {
        // Its tongue comes for him, steering after him; shoot the tip
        if (T.state === 'out') {
          // Locked on: it goes for where he is now, whatever he does; it can't be outrun or dodged, only shot
          const target = p.camera.position.clone().add(V(0, -0.35, 0));
          T.dir.copy(target).sub(T.tip).normalize();
          const sp = (enraged ? 11 : 9) + Math.min(4, this.moveT * 0.8);
          T.tip.addScaledVector(T.dir, Math.min(sp * dt, T.tip.distanceTo(target)));
          T.len = T.tip.distanceTo(T.from);
          if (T.tip.distanceTo(target) < 0.9) {
            if (this.eating || this.grabbed) this.retract(T);
            else this.seize();
          } else if (this.moveT > 16) this.retract(T);
        }
        if (T.state === 'idle' && !this.grabbed) this.startMove('idle');
        break;
      }
      case 'tree':
        this.updateTreeDrag(dt);
        break;
      case 'brood': {
        // Its sacs swell, pulse, glow; then they burst and what's in them comes out running
        b.swell = Math.min(1, this.moveT / 1.6);
        if (Math.random() < dt * 8) this.shake = Math.max(this.shake, 0.1 * b.swell);
        if (this.moveShots === 0 && this.moveT > 1.6) {
          this.moveShots = 1;
          for (const at of b.popSacs()) this.hatch(at, enraged ? 3 : 2);
          this.ctx.audio.gooSplat(this.player.position.distanceTo(b.at));
          this.ctx.audio.houndScreech(this.player.position.distanceTo(b.at));
          this.shake = Math.max(this.shake, 0.45);
          if (!this.broodHinted) {
            this.broodHinted = true;
            this.hint('ITS SACS BURST — KILL EVERY ONE OF THEM BEFORE THEY GET TO YOU', 6);
          }
        }
        if (this.moveT > 3.2) this.startMove('idle');
        break;
      }
      case 'stagger':
        if (this.moveT > 1.6) this.startMove('idle');
        break;
    }
  }
  private sprayHinted = false;
  private mortarPts: { x: number; z: number }[] = [];
  /** Under half its health: angrier. */
  private bossHalf(): boolean {
    return this.boss.hp < this.boss.maxHp * 0.5;
  }
  private treeHitT = -10;
  private treeR = 12;
  /** The spray: where it comes from, which way, how many arcs. */
  private spray = { o: new THREE.Vector3(), base: 0, arcs: 6, step: 2.4 };
  private grabHinted = false;

  private startMove(m: BossMove): void {
    this.move = m;
    this.moveT = 0;
    this.moveShots = 0;
    const b = this.boss;
    const T = this.bossTongue;
    const d = this.player.position.distanceTo(b.at);
    if (m === 'spray') {
      this.ctx.audio.giantRoar(0.8, d);
      const pp = this.player.position;
      this.spray.o.copy(b.at);
      this.spray.base = Math.atan2(pp.x - b.at.x, pp.z - b.at.z);
      this.spray.arcs = THREE.MathUtils.clamp(Math.ceil((d + 12 - 4) / 2.6), 5, 12);
      // Far off, the arcs further apart: it still reaches well past him
      this.spray.step = Math.max(2.6, (d + 12 - 4) / (this.spray.arcs - 1));
    }
    if (m === 'mortar') {
      // Where it all comes down: one on him (where he's heading), the rest thrown over the ground round him,
      // never closer than 5.4 m to each other, so a ring's width of clear ground lies between them
      const pp = this.player.position;
      const lead = this.player.velocity.clone().multiplyScalar(0.5);
      const pts: { x: number; z: number }[] = [{ x: pp.x + lead.x, z: pp.z + lead.z }];
      const want = this.bossHalf() ? 18 : 14;
      for (let tries = 0; tries < 600 && pts.length < want; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.sqrt(Math.random()) * 11;
        const x = pp.x + Math.cos(a) * r;
        const z = pp.z + Math.sin(a) * r;
        if (pts.every((q) => Math.hypot(q.x - x, q.z - z) > 5.4)) pts.push({ x, z });
      }
      // Fired nearest-first, so the ones close to him are up first
      this.mortarPts = pts.sort((u, v) => Math.hypot(u.x - pp.x, u.z - pp.z) - Math.hypot(v.x - pp.x, v.z - pp.z));
    }
    if (m === 'grab') {
      T.from.copy(b.muzzle(1));
      T.tip.copy(T.from);
      T.dir.copy(this.player.camera.position).sub(T.from).normalize();
      T.state = 'out';
      T.len = 0;
      this.tongueHp = 4.5;
      this.ctx.audio.kickWhoosh();
      this.ctx.audio.houndScreech(d);
      if (!this.grabHinted) {
        this.grabHinted = true;
        this.hint('ITS GRABBER — SHOOT THE TIP BEFORE IT GETS YOU', 5);
      }
    }
    if (m === 'tree') {
      // The tree with him most nearly between it and the big one
      let best = -1;
      let bestScore = Infinity;
      const pp = this.player.position;
      this.level.arenaTrees.forEach((t, i) => {
        if (this.treeUsed[i]) return;
        const ax = t.x;
        const az = t.z;
        const dx = b.at.x - ax;
        const dz = b.at.z - az;
        const l2 = dx * dx + dz * dz;
        const u = THREE.MathUtils.clamp(((pp.x - ax) * dx + (pp.z - az) * dz) / l2, 0, 1);
        const off = Math.hypot(pp.x - ax - dx * u, pp.z - az - dz * u);
        const score = off + (u < 0.1 || u > 0.9 ? 20 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      });
      if (best < 0) {
        this.startMove('idle');
        return;
      }
      this.treeUsed[best] = true;
      const t = this.level.arenaTrees[best];
      T.from.copy(b.muzzle(1));
      T.tip.copy(T.from);
      T.state = 'out';
      T.len = 0;
      this.tongueHp = 99;
      const grabAt = V(t.x, W.groundY(t.x, t.z) + 2.2, t.z);
      T.dir.copy(grabAt).sub(T.from).normalize();
      this.tree = { i: best, stage: 'reach', t: 0, from: V(t.x, W.groundY(t.x, t.z), t.z), to: new THREE.Vector3(), dir: new THREE.Vector3(), hit: false, p0: new THREE.Vector3(), q0: new THREE.Quaternion() };
      this.ctx.audio.giantRoar(0.6, d);
    }
  }

  /** One glob of acid on a high arc from the acid arm to (x, z), landing in `tf` seconds; a ring there till it does. */
  private lob(x: number, z: number, r: number, tf: number, life = 6, ring = true): void {
    const from = this.boss.muzzle(0);
    const y = W.groundY(x, z);
    const v = V((x - from.x) / tf, (y - from.y) / tf + 0.5 * ACID_G * tf, (z - from.z) / tf);
    // (the shot's 'damage' is how long the pool it leaves lasts)
    this.bossAcid.fire(from, v, 'enemy', life);
    if (ring) this.mark(x, z, r, tf);
    this.boss.kick[0] = 1;
    this.ctx.audio.gooShot();
  }

  /** The tree: the tongue to it, round it, it comes down across the way, and it's dragged at him. */
  private updateTreeDrag(dt: number): void {
    const tr = this.tree;
    const b = this.boss;
    const T = this.bossTongue;
    if (!tr) {
      this.startMove('idle');
      return;
    }
    const tree = this.level.arenaTrees[tr.i];
    const g = tree.group;
    tr.t += dt;
    if (tr.stage === 'reach') {
      const target = tr.from.clone().add(V(0, 2.2, 0));
      T.dir.copy(target).sub(T.tip).normalize();
      T.tip.addScaledVector(T.dir, Math.min(18 * dt, T.tip.distanceTo(target)));
      T.len = T.tip.distanceTo(T.from);
      if (T.tip.distanceTo(target) < 0.2) {
        tr.stage = 'wrap';
        tr.t = 0;
        this.ctx.audio.houndBite(T.len);
        this.drops.burst(target, V(0, 1, 0), 10, 2, 0x6a5040);
      }
    } else if (tr.stage === 'wrap') {
      g.rotation.z = Math.sin(tr.t * 30) * 0.03;
      if (tr.t > 0.5) {
        tr.stage = 'lift';
        tr.t = 0;
        this.treeCols[tr.i].disabled = true;
        this.allCols = [];
        this.ctx.audio.wallCollapse();
        this.shake = Math.max(this.shake, 0.6);
        this.particles.dust(tr.from.clone(), 3);
        this.drops.burst(tr.from.clone().add(V(0, 0.2, 0)), V(0, 1, 0), 30, 4, 0x5a4a30);
        g.rotation.z = 0;
        tr.q0.copy(g.quaternion);
      }
    } else if (tr.stage === 'lift') {
      // Torn up out of the ground, roots and all, shaking
      const k = smooth(tr.t / 0.55);
      g.quaternion.copy(tr.q0).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.sin(tr.t * 25) * 0.05 * (1 - k))));
      g.position.set(tr.from.x + Math.sin(tr.t * 40) * 0.04 * (1 - k), tr.from.y + k * 1.8, tr.from.z);
      T.tip.copy(g.position).add(V(0, 2.2, 0));
      T.len = T.tip.distanceTo(T.from);
      if (Math.random() < 0.5) this.particles.dust(tr.from.clone(), 1.2);
      if (tr.t > 0.55) {
        // Where it'll be set down to drag from: on a circle round it, the way round that brings it to him soonest
        const a0 = Math.atan2(tr.from.x - b.at.x, tr.from.z - b.at.z);
        const ap = Math.atan2(this.player.position.x - b.at.x, this.player.position.z - b.at.z);
        const R0 = THREE.MathUtils.clamp(Math.hypot(tr.from.x - b.at.x, tr.from.z - b.at.z), 7, 14);
        tr.dir.set(a0, Math.sin(ap - a0) >= 0 ? 1 : -1, R0);
        this.treeR = R0;
        tr.p0.copy(g.position);
        tr.q0.copy(g.quaternion);
        tr.stage = 'carry';
        tr.t = 0;
        this.ctx.audio.kickWhoosh();
      }
    } else if (tr.stage === 'carry') {
      // Swung through the air on the tongue to where it starts, turning to lie down as it comes, and slammed down
      const D = 0.8;
      const k = smooth(Math.min(1, tr.t / D));
      const a0 = tr.dir.x;
      const R0 = tr.dir.z;
      const tan = V(Math.cos(a0), 0, -Math.sin(a0)).multiplyScalar(tr.dir.y);
      tr.to.set(b.at.x + Math.sin(a0) * R0, 0, b.at.z + Math.cos(a0) * R0);
      tr.to.y = W.groundY(tr.to.x, tr.to.z) + 0.35;
      const q1 = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), tan.clone().negate());
      g.position.lerpVectors(tr.p0, tr.to, k);
      g.position.y += Math.sin(k * Math.PI) * 3.4;
      g.quaternion.copy(tr.q0).slerp(q1, k);
      T.tip.copy(g.position).add(V(0, THREE.MathUtils.lerp(2.2, 0.4, k), 0).applyQuaternion(g.quaternion));
      T.len = T.tip.distanceTo(T.from);
      if (tr.t >= D) {
        tr.stage = 'drag';
        tr.t = 0;
        this.shake = Math.max(this.shake, 0.7);
        this.ctx.audio.stomp(this.player.position.distanceTo(g.position));
        this.particles.dust(g.position.clone(), 4);
        this.ctx.audio.bigEngineDrive(5, 0);
      }
    } else {
      // Swung round and round it on the end of the tongue, trailing; the circle drawing in and out
      // (tr.dir holds: x the angle it started at, y the way round, z the radius it started at)
      const enraged = b.hp < b.maxHp * 0.5;
      const w = (enraged ? 1.95 : 1.55) * Math.min(1, tr.t / 0.8);
      const turn = tr.dir.x + tr.dir.y * (tr.t * w - (w * Math.min(tr.t, 0.8)) / 2);
      // Out to where he is, give or take, so it comes round through him
      const pd = Math.hypot(this.player.position.x - b.at.x, this.player.position.z - b.at.z);
      this.treeR += (THREE.MathUtils.clamp(pd, 6, 18) - this.treeR) * Math.min(1, dt * 0.8);
      const R = THREE.MathUtils.lerp(tr.dir.z, this.treeR + 2.5 * Math.sin(tr.t * 0.9), Math.min(1, tr.t / 1.2));
      const base = V(b.at.x + Math.sin(turn) * R, 0, b.at.z + Math.cos(turn) * R);
      base.y = W.groundY(base.x, base.z) + 0.35;
      const tan = V(Math.cos(turn), 0, -Math.sin(turn)).multiplyScalar(tr.dir.y);
      g.position.copy(base);
      g.quaternion.setFromUnitVectors(V(0, 1, 0), tan.clone().negate());
      T.tip.copy(base).add(V(0, 0.4, 0));
      T.len = T.tip.distanceTo(T.from);
      if (Math.random() < 0.6) this.particles.dust(base.clone(), 1.5);
      if (Math.random() < 0.3) this.shake = Math.max(this.shake, 0.15);
      // What it sweeps over: the trunk (0.8 high) and the crown behind it
      const p = this.player;
      const pp = p.position;
      const rel = V(pp.x - base.x, 0, pp.z - base.z);
      const behind = -rel.dot(tan);
      const radial = Math.abs(rel.x * tan.z - rel.z * tan.x);
      const lowEnough = pp.y - W.groundY(pp.x, pp.z) < (behind > 3.2 ? 1.6 : 0.85);
      if (this.t - this.treeHitT > 1.2 && p.alive && behind > -0.6 && behind < 5.8 && radial < 1.1 && lowEnough) {
        this.treeHitT = this.t;
        p.hit('A TREE', base.clone());
        p.launch(V(tan.x, 0.6, tan.z).normalize(), 9);
        this.shake = Math.max(this.shake, 0.8);
        this.ctx.audio.bodyThud(0);
      }
      for (const h of this.hounds) {
        if (!h.alive) continue;
        const r2 = V(h.group.position.x - base.x, 0, h.group.position.z - base.z);
        const bh = -r2.dot(tan);
        if (bh > -0.6 && bh < 5.8 && Math.abs(r2.x * tan.z - r2.z * tan.x) < 1.2) {
          h.knock.copy(tan).multiplyScalar(9);
          this.hurtHound(h, 99, h.group.position.clone().add(V(0, 0.6, 0)), tan);
        }
      }
      // A turn and a half, then let go: it rolls away and lies there
      if (tr.t * w > Math.PI * 3) {
        this.retract(T);
        this.tree = null;
        this.startMove('idle');
      }
    }
  }

  /** Its grabber has him: pulled in toward its mouth; F, again and again, to tear free. */
  private seize(): void {
    this.grabbed = true;
    this.presses = 0;
    this.bossTongue.state = 'hold';
    this.player.stunned = true;
    this.ctx.audio.houndBite(0);
    this.shake = Math.max(this.shake, 0.7);
    this.player.hit(BOSS_NAME, this.boss.at.clone());
    this.hud.setPrompt(`[ F ] BREAK FREE  ${BREAK_FREE}`);
  }

  private updateBossGrip(dt: number): void {
    if (!this.grabbed) return;
    const p = this.player;
    const b = this.boss;
    const T = this.bossTongue;
    if (!p.alive || !b.alive) {
      this.grabbed = false;
      p.stunned = !!this.heldBy;
      this.retract(T);
      this.hud.setPrompt(null);
      return;
    }
    const pp = p.position;
    // Pulled in
    const to = V(b.at.x - pp.x, 0, b.at.z - pp.z);
    const d = to.length();
    to.normalize();
    pp.addScaledVector(to, 2.3 * dt);
    p.velocity.set(0, Math.min(0, p.velocity.y), 0);
    p.boost.set(0, 0, 0);
    T.tip.copy(p.camera.position).add(V(0, -0.5, 0));
    T.len = T.tip.distanceTo(T.from);
    this.vignette.style.opacity = String(0.5 + 0.3 * Math.sin(this.t * 10));
    this.shake = Math.max(this.shake, 0.12);
    if (this.ctx.input.wasPressed('KeyF')) {
      this.presses++;
      this.shake = Math.max(this.shake, 0.3);
      this.ctx.audio.effortGrunt(0.6);
      this.drops.burst(T.tip.clone(), V(0, 0.5, 0), 4, 1.5, 0xc04a8a);
    }
    const need = b.hp < b.maxHp * 0.5 ? BREAK_FREE + 3 : BREAK_FREE;
    this.hud.setPrompt(`[ F ] BREAK FREE  ${Math.max(0, need - this.presses)}`);
    if (this.presses >= need) {
      // Torn free: the tongue snaps back, the big one reels
      this.grabbed = false;
      p.stunned = !!this.heldBy;
      this.hud.setPrompt(null);
      this.retract(T);
      this.drops.burst(T.tip.clone(), V(0, 1, 0), 30, 3, BOSS_BLOOD);
      this.ctx.audio.squelchPop();
      p.launch(to.clone().negate().setY(0.4).normalize(), 6);
      this.stagger();
    } else if (d < 4.2) {
      // He didn't get free: up to its mouth, and in
      this.startEat();
    }
  }

  /**
   * Eaten. First through his own eyes: the gun goes out of his hand, his
   * hands come up shaking and he screams, as the tongue hauls him up to the
   * mouth gaping open in front of him and in past the teeth. Then outside:
   * his legs hanging out of its mouth, kicking, as it chews him down — mouth
   * open, jaws shut, again and again — and swallows.
   */
  private startEat(): void {
    const p = this.player;
    this.grabbed = false;
    this.hud.setPrompt(null);
    this.tabletOn = false;
    p.stunned = true;
    p.cinematic = true;
    p.velocity.set(0, 0, 0);
    this.eating = {
      t: 0,
      from: p.camera.position.clone(),
      done: false,
      cut: false,
      munches: 0,
      lastChew: 0,
      gun: null,
      gunVel: V(0, 0, 0),
      gunSpin: V(0, 0, 0),
      gunDown: false,
      body: null,
      scream: null,
      swallowed: false
    };
    this.cinema(true);
    this.ctx.audio.giantRoar(1, 3);
    this.shake = Math.max(this.shake, 0.6);
    if (!this.eatFade) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;z-index:5;background:radial-gradient(ellipse at 50% 50%, rgba(90,0,10,0.75) 0%, rgba(20,0,2,0.97) 60%, #000 100%);';
      this.ctx.uiRoot.appendChild(el);
      this.eatFade = el;
    }
  }

  private updateEat(dt: number): void {
    const e = this.eating;
    if (!e) return;
    const p = this.player;
    const b = this.boss;
    const T = this.bossTongue;
    const audio = this.ctx.audio;
    e.t += dt;
    const t = e.t;
    // Its mouth, the way it faces, and the plane of its lips
    const M = b.mouthCore.getWorldPosition(new THREE.Vector3());
    const C = b.body.getWorldPosition(new THREE.Vector3());
    const F = M.clone().sub(C).normalize();
    const lips = M.clone().addScaledVector(F, 0.85);
    this.updateDroppedGun(dt);

    if (!e.cut) {
      // ---- through his eyes
      const lipFront = M.clone().addScaledVector(F, 1.8);
      let eye: THREE.Vector3;
      if (t < 1.45) {
        const k = smooth(t / 1.45);
        eye = e.from.clone().lerp(lipFront, k);
        eye.y += Math.sin(k * Math.PI) * 0.7;
        b.gape = 0.25 + 0.75 * k;
      } else {
        const k = smooth((t - 1.45) / 0.5);
        eye = lipFront.clone().lerp(lips.clone().addScaledVector(F, -0.2), k);
        b.gape = 1;
      }
      this.shake = Math.max(this.shake, 0.12 + (t > 1.45 ? 0.25 : 0));
      // The gun goes, and his hands come up
      if (!e.gun && t > 0.2) this.dropGun();
      this.panic.active = t > 0.25;
      this.panic.push = Math.min(1, 0.3 + t * 0.45);
      this.panic.fear = 1 + Math.max(0, t - 1) * 0.6;
      if (!e.scream && t > 0.3) {
        e.scream = audio.fallScream();
        audio.enemyScream(1);
      }
      e.scream?.set(0);
      if (this.eatFade) this.eatFade.style.opacity = String(Math.min(1, smooth((t - 1.55) / 0.4)));
      const look = M.clone().sub(eye);
      p.position.copy(eye).add(V(0, -p.eyeHeight, 0));
      p.yaw = Math.atan2(-look.x, -look.z);
      p.pitch = Math.atan2(look.y, Math.hypot(look.x, look.z));
      T.tip.copy(eye).add(V(0, -0.45, 0));
      T.len = T.tip.distanceTo(T.from);
      if (t >= 2.0) this.cutToChewing(M, F);
      return;
    }

    // ---- outside: chewing him down
    const tm = t - 2.0;
    const CHEW = 0.62;
    const c = (tm % CHEW) / CHEW;
    if (!e.swallowed) {
      // Open wide... and shut
      b.gape = c < 0.62 ? 0.2 + 0.8 * smooth(c / 0.62) : Math.max(0.12, 1 - smooth((c - 0.62) / 0.12) * 0.9);
      const chew = Math.floor(tm / CHEW);
      if (c > 0.72 && chew >= e.lastChew) {
        e.lastChew = chew + 1;
        e.munches++;
        audio.houndBite(4);
        audio.squelchPop();
        if (e.munches % 2) audio.bodyThud(4);
        this.shake = Math.max(this.shake, 0.45);
        this.drops.burst(lips.clone(), F.clone().setY(0.5), 16, 2.6, BOSS_BLOOD);
        this.drops.burst(lips.clone(), F.clone().setY(0.2), 8, 2, 0x8a1010);
      }
      // Further in with every bite; kicking, then less, then not at all
      const ins = Math.min(1.75, 0.3 + e.munches * 0.24 + smooth(c) * 0.06);
      this.poseEaten(e.body!, lips, F, ins, Math.max(0, 1 - e.munches / 5), t);
      if (e.munches >= 6) {
        // And down
        e.swallowed = true;
        e.body!.root.visible = false;
        audio.squelchPop();
        audio.giantRoar(0.9, 6);
        this.shake = Math.max(this.shake, 0.8);
        b.gape = 0;
      }
    } else {
      b.gape = Math.max(0, b.gape - dt * 3);
    }
    T.tip.copy(lips);
    T.len = T.tip.distanceTo(T.from);
    if (e.swallowed && !e.done && tm > CHEW * 6 + 1.2) {
      e.done = true;
      this.retract(T);
      // Dead where he is, in it: the camera stays out here, no body on the ground
      p.deathHandler = { begin: () => true, update: () => {} };
      p.kill(BOSS_NAME, M);
    }
  }

  /** The gun out of his hand: tumbling down past his feet to the ground. */
  private dropGun(): void {
    const e = this.eating!;
    const p = this.player;
    const kind = this.arsenal.active;
    const prop = kind === 'pistol' ? pistolProp() : kind === 'shotgun' ? shotgunProp() : rifleProp();
    const cam = p.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(fwd, V(0, 1, 0)).normalize();
    prop.position.copy(cam.position).addScaledVector(fwd, 0.45).addScaledVector(right, 0.18).add(V(0, -0.32, 0));
    prop.quaternion.copy(cam.quaternion);
    this.scene.add(prop);
    e.gun = prop;
    e.gunVel.copy(fwd).multiplyScalar(0.8).add(V(0, -0.6, 0));
    e.gunSpin.set(Math.random() * 6 - 3, Math.random() * 4 - 2, 4 + Math.random() * 3);
    // ...and out of his hand in first person
    this.arsenal.held.stow = 1;
  }

  private updateDroppedGun(dt: number): void {
    const e = this.eating;
    if (!e?.gun || e.gunDown) return;
    const g = e.gun;
    e.gunVel.y -= 10.5 * dt;
    g.position.addScaledVector(e.gunVel, dt);
    g.rotation.x += e.gunSpin.x * dt;
    g.rotation.y += e.gunSpin.y * dt;
    g.rotation.z += e.gunSpin.z * dt;
    const floor = W.groundY(g.position.x, g.position.z) + 0.06;
    if (g.position.y <= floor) {
      g.position.y = floor;
      e.gunDown = true;
      // Down flat on its side
      g.rotation.set(0, g.rotation.y, Math.PI / 2);
      this.ctx.audio.clink();
      this.ctx.audio.bodyThud(this.player.camera.position.distanceTo(g.position));
    }
  }

  /** Cut to outside: his body, head first in its mouth, legs out; the camera off to one side of it. */
  private cutToChewing(M: THREE.Vector3, F: THREE.Vector3): void {
    const e = this.eating!;
    const p = this.player;
    e.cut = true;
    e.scream?.stop();
    e.scream = null;
    // (one last one, muffled by the mouth closing on it)
    this.ctx.audio.enemyScream(0.6);
    this.panic.hide();
    if (this.eatFade) this.eatFade.style.opacity = '0';
    const body = RaviVisual.rig('body');
    RaviVisual.dressBody?.(body);
    this.scene.add(body.root);
    e.body = body;
    // The camera: out to one side of its face, a little low, looking at the mouth
    const side = new THREE.Vector3().crossVectors(F, V(0, 1, 0)).normalize();
    const lips = M.clone().addScaledVector(F, 0.85);
    const cam = lips.clone().addScaledVector(F, 3.3).addScaledVector(side, 2.5);
    cam.y = Math.max(W.groundY(cam.x, cam.z) + 1.0, lips.y + 0.1);
    const look = lips.clone().addScaledVector(F, 0.9).sub(cam);
    p.position.copy(cam).add(V(0, -p.eyeHeight, 0));
    p.yaw = Math.atan2(-look.x, -look.z);
    p.pitch = Math.atan2(look.y, Math.hypot(look.x, look.z));
    this.shake = Math.max(this.shake, 0.6);
    this.ctx.audio.houndBite(4);
  }

  /**
   * His body, head first `ins` metres into its mouth, legs drooping out of
   * it; `kick` 0..1 how hard his legs are going.
   */
  private poseEaten(rig: RaviRig, lips: THREE.Vector3, F: THREE.Vector3, ins: number, kick: number, t: number): void {
    // Out of its mouth and sagging down under his own weight
    const out = F.clone().add(V(0, -0.35, 0)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), out.clone().negate());
    // Turned onto his front, so his legs bend down the way legs do
    q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI));
    rig.root.quaternion.copy(q);
    // His head `ins` inside the lips: the feet (model origin) that far back out along the sag
    const jolt = Math.sin(t * 40) * 0.015 * kick;
    rig.root.position.copy(lips).addScaledVector(out, 1.65 - ins + jolt);
    rig.clear();
    const k = Math.sin(t * 13);
    rig.turn('thigh_l', [1, 0, 0], 28 * kick * k - 8);
    rig.turn('thigh_r', [1, 0, 0], -28 * kick * k - 8);
    rig.turn('calf_l', [1, 0, 0], -(30 + 25 * kick * Math.max(0, k)));
    rig.turn('calf_r', [1, 0, 0], -(30 + 25 * kick * Math.max(0, -k)));
    rig.turn('upperarm_l', [0, 0, 1], -60);
    rig.turn('upperarm_r', [0, 0, 1], 60);
    rig.apply();
  }

  private hurtTongue(dmg: number): void {
    if (this.move !== 'grab' || this.bossTongue.state !== 'out') return;
    this.tongueHp -= dmg;
    this.drops.burst(this.bossTongue.tip.clone(), V(0, 0.5, 0), 6, 2, BOSS_BLOOD);
    this.ctx.bus.emit(Events.HitMarker, { lethal: this.tongueHp <= 0 });
    if (this.tongueHp > 0) return;
    // Shot off: it pulls back, hurt
    this.drops.burst(this.bossTongue.tip.clone(), V(0, 1, 0), 30, 3, BOSS_BLOOD);
    this.ctx.audio.squelchPop();
    this.retract(this.bossTongue);
    this.boss.hp -= 4;
    this.stagger();
  }

  private stagger(): void {
    this.move = 'stagger';
    this.moveT = 0;
    this.ctx.audio.giantRoar(0.9, this.player.position.distanceTo(this.boss.at));
    this.shake = Math.max(this.shake, 0.4);
  }

  private wakeBoss(): void {
    this.bossAwake = true;
    this.checkpoint = Math.max(this.checkpoint, 4);
    this.ctx.audio.giantRoar(1, this.player.position.distanceTo(this.boss.at));
    this.shake = 0.8;
    this.ctx.audio.stopTrackMusic(1.5);
    this.ctx.audio.startBossMusic();
    this.setObjective('KILL IT');
    this.move = 'idle';
    this.moveT = -0.5;
    this.lightning(1);
  }

  private hurtBoss(dmg: number, point: THREE.Vector3, dir: THREE.Vector3, head: boolean): void {
    const b = this.boss;
    this.drops.burst(point, dir.clone().negate().setY(0.2), head ? 14 : 8, 3, BOSS_BLOOD);
    if (!b.alive) return;
    if (!this.bossAwake) this.wakeBoss();
    b.hp -= dmg * (head ? 2 : 1);
    this.ctx.bus.emit(Events.HitMarker, { lethal: b.hp <= 0 });
    if (b.hp > 0) return;
    b.hp = 0;
    b.alive = false;
    this.hud.setBoss(null, 0);
    this.bossAcid.clear();
    for (const m of this.markers) {
      m.land = -1;
      m.mesh.visible = false;
    }
    this.retract(this.bossTongue);
    if (this.grabbed) {
      this.grabbed = false;
      this.player.stunned = !!this.heldBy;
      this.hud.setPrompt(null);
    }
    this.ctx.audio.giantRoar(1.2, this.player.position.distanceTo(b.at));
    this.later(0.9, () => this.ctx.audio.giantFall());
    this.later(1.1, () => (this.shake = Math.max(this.shake, 0.9)));
    this.ctx.audio.stopBossMusic(3);
    this.later(1.2, () => {
      const c = Math.abs(Math.cos(b.yaw));
      const s = Math.abs(Math.sin(b.yaw));
      const hx = c * 1.5 + s * 2.4;
      const hz = s * 1.5 + c * 2.4;
      const y = b.at.y;
      this.level.colliders.push({ box: new THREE.Box3(V(b.at.x - hx, y, b.at.z - hz), V(b.at.x + hx, y + 2.4, b.at.z + hz)) });
      this.allCols = [];
    });
    this.later(2.5, () => {
      this.setObjective('TAKE ITS CANNONS');
      this.hint('GO TO THE END OF ONE OF ITS ARMS', 5);
    });
  }

  // ============================================================ ballistics

  private trace(o: THREE.Vector3, dir: THREE.Vector3, far: number, creatures: boolean): Hit | null {
    let best: Hit | null = null;
    {
      const step = 0.6;
      let prev = 0;
      for (let t = step; t <= far + step; t += step) {
        const tt = Math.min(t, far);
        const x = o.x + dir.x * tt;
        const y = o.y + dir.y * tt;
        const z = o.z + dir.z * tt;
        if (y < W.groundY(x, z) || W.solid(x, y, z)) {
          let lo = prev;
          let hi = tt;
          for (let k = 0; k < 8; k++) {
            const m = (lo + hi) / 2;
            const mx = o.x + dir.x * m;
            const my = o.y + dir.y * m;
            const mz = o.z + dir.z * m;
            if (my < W.groundY(mx, mz) || W.solid(mx, my, mz)) hi = m;
            else lo = m;
          }
          const pt = o.clone().addScaledVector(dir, hi);
          best = { dist: hi, point: pt, normal: W.normal(pt.x, pt.y, pt.z), kind: 'terrain' };
          break;
        }
        prev = tt;
        if (tt >= far) break;
      }
    }
    const lim = best ? best.dist : far;
    const hd = Math.hypot(dir.x, dir.z);
    if (hd > 1e-4) {
      const ux = dir.x / hd;
      const uz = dir.z / hd;
      let bestT = lim;
      let bt: TreeTrunk | null = null;
      for (const t of this.level.trunks) {
        const rx = t.x - o.x;
        const rz = t.z - o.z;
        const along = rx * ux + rz * uz;
        if (along < 0 || along / hd > bestT + t.r) continue;
        const perp = Math.abs(rx * uz - rz * ux);
        if (perp > t.r) continue;
        const h = (along - Math.sqrt(t.r * t.r - perp * perp)) / hd;
        if (h < 0 || h >= bestT) continue;
        const y = o.y + dir.y * h;
        const gy = W.groundY(t.x, t.z);
        if (y < gy || y > gy + t.h) continue;
        bestT = h;
        bt = t;
      }
      if (bt) {
        const pt = o.clone().addScaledVector(dir, bestT);
        best = { dist: bestT, point: pt, normal: V(pt.x - bt.x, 0, pt.z - bt.z).normalize(), kind: 'trunk' };
      }
    }
    this.raycaster.set(o, dir);
    this.raycaster.far = best ? best.dist : far;
    const w = this.raycaster.intersectObjects(this.level.shootables, false).find((h) => h.distance > 0.02);
    if (w) {
      const n = (w.face?.normal ?? V(0, 1, 0)).clone().transformDirection(w.object.matrixWorld);
      best = { dist: w.distance, point: w.point.clone(), normal: n, kind: 'world' };
    }
    if (creatures) {
      this.raycaster.far = best ? best.dist : far;
      const held = this.holding;
      const targets: THREE.Object3D[] = (this.houndHits as THREE.Object3D[]).filter((m) => !held || !held.hitboxes.includes(m as THREE.Mesh)).concat(this.trapHits);
      if (this.boss.alive) targets.push(...this.boss.hitMeshes);
      if (this.tongueHit.visible) targets.push(this.tongueHit);
      targets.push(...this.spiderHits);
      const c = this.raycaster.intersectObjects(targets, false)[0];
      if (c) {
        const hound = c.object.userData.hound as Hound | undefined;
        const trap = c.object.userData.trap as MawTrap | undefined;
        const spider = c.object.userData.spider as Spiderling | undefined;
        best = {
          dist: c.distance,
          point: c.point.clone(),
          normal: dir.clone().negate(),
          kind: hound ? 'hound' : trap ? 'trap' : spider ? 'spider' : c.object.userData.tongue ? 'tongue' : 'boss',
          hound,
          trap,
          spider,
          head: !!c.object.userData.head
        };
      }
    }
    return best;
  }

  protected castBullet(origin: THREE.Vector3, dir: THREE.Vector3, shooter: Enemy | null): THREE.Vector3 {
    const h = this.trace(origin, dir, 120, shooter === null);
    if (!h) return origin.clone().addScaledVector(dir, 120);
    const gun = this.arsenal.firing;
    const dmg = gun === 'shotgun' ? 0.5 : gun === 'pistol' ? 1.5 : 1;
    if (h.kind === 'hound' && h.hound) this.hurtHound(h.hound, dmg * (h.head ? 1.6 : 1), h.point, dir);
    else if (h.kind === 'spider' && h.spider) this.hurtSpider(h.spider, h.point, dir, 1);
    else if (h.kind === 'boss') this.hurtBoss(dmg, h.point, dir, !!h.head);
    else if (h.kind === 'trap' && h.trap) this.hurtTrap(h.trap, dmg, h.point, dir);
    else if (h.kind === 'tongue') this.hurtTongue(dmg);
    else {
      const tint = h.kind === 'terrain' ? 0xc8c49a : h.kind === 'trunk' ? 0x5a4a40 : 0xa8a49a;
      this.particles.concreteChips(h.point, h.normal, tint);
      if (h.kind !== 'trunk') this.decals.place('bullethole', h.point, h.normal);
      if (h.kind === 'world') this.ctx.audio.ricochet(h.point.distanceTo(this.player.position));
    }
    return h.point;
  }

  protected killEnemy(): void {}

  // ============================================================ the harvest

  private updateHarvestPrompt(): void {
    if (this.boss.alive || this.harvested || this.phase !== 'play' || !this.player.alive) return;
    if (this.boss.deadT < 2) return;
    const pp = this.player.position;
    let best = -1;
    let bd = 3.2;
    for (const i of [0, 1]) {
      const s = this.boss.wrist(i);
      const d = Math.hypot(s.x - pp.x, s.z - pp.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) {
      if (!this.promptBusy) this.hud.setPrompt(null);
      return;
    }
    this.hud.setPrompt('[ E ] TAKE ITS CANNONS');
    if (this.ctx.input.wasPressed('KeyE')) this.startHarvest(best);
  }

  private startHarvest(i: number): void {
    this.phase = 'harvest';
    this.phaseT = 0;
    this.harvestOrder = [i, 1 - i];
    this.hud.setPrompt(null);
    this.player.cinematic = true;
    this.cinema(true);
    const a = this.arsenal;
    for (const v of a.all) v.stow = 1;
    a.knifeActive = false;
    a.knifeWanted = false;
    a.knifeStow = 1;
    this.knife.stow = 1;
    this.harvestFrom.p.copy(this.player.camera.position);
    this.harvestFrom.q.copy(this.player.camera.quaternion);
    for (const arm of [this.acidArm, this.grabArm]) {
      arm.stow = 1;
      arm.grip = 0;
      arm.open = 1;
      arm.gun.root.visible = false;
      arm.pose = { p: V(0.2, -0.3, -0.5), r: new THREE.Euler(0.25, 0.12, -0.1) };
    }
    this.fallen = [null, null];
    this.fallV = [0, 0];
  }

  /**
   * A hand target (camera space) brought back within his reach: no further
   * from that shoulder than his arm goes, and kept out in front of the lens.
   */
  private static reach(v: THREE.Vector3, side: number): THREE.Vector3 {
    const sh = V(0.19 * side, -0.27, 0.02);
    const d = v.clone().sub(sh);
    if (d.length() > 0.56) d.setLength(0.56);
    const out = sh.add(d);
    out.z = Math.min(out.z, -0.28);
    out.y = Math.min(out.y, -0.08);
    return out;
  }

  /** The blaster that the cannon off boss arm i goes on: its right arm's (the acid) on his right. */
  private armFor(i: number): AlienBlaster {
    return i === 0 ? this.acidArm : this.grabArm;
  }

  /**
   * Both cannons. Down on one knee by the end of one arm: his left hand
   * holds the cannon-head, the karambit saws through the wrist, and it drops.
   * Then the other arm, the same. Up on his feet, both hands out, open: the
   * two heads on the ground twitch, then spring up and onto his forearms, his
   * right and his left, and their feelers close round them.
   */
  private updateHarvest(dt: number): void {
    const t = this.phaseT;
    const b = this.boss;
    const cam = this.player.camera;
    const H = this.hands;
    const pp = this.player.position;
    const [ia, ib] = this.harvestOrder;
    // ---- Where the camera is: by the first wrist, then the second, then standing
    const kneelAt = (i: number): { p: THREE.Vector3; look: THREE.Vector3 } => {
      const w = b.wrist(i);
      const away = V(pp.x - w.x, 0, pp.z - w.z).normalize();
      if (away.lengthSq() < 0.5) away.set(0, 0, 1);
      const side = V(-away.z, 0, away.x);
      const p = w.clone().addScaledVector(away, 0.6).addScaledVector(side, 0.15).add(V(0, 0.6, 0));
      p.y = Math.max(p.y, W.groundY(p.x, p.z) + 0.75);
      const head = this.fallen[i] ?? b.arms[i].head.root;
      return { p, look: this.fallen[i] ? w : head.localToWorld(V(0, 0, 0.2)) };
    };
    const A = kneelAt(ia);
    const B = kneelAt(ib);
    const kIn = smooth(t / 1.0);
    const kMove = smooth((t - 2.8) / 0.9);
    const kOut = smooth((t - 5.6) / 0.8);
    const stand = pp.clone().add(V(0, 1.63, 0));
    cam.position.lerpVectors(this.harvestFrom.p, A.p, kIn).lerp(B.p, kMove).lerp(stand, kOut);
    const look = (at: THREE.Vector3): THREE.Quaternion => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, at, V(0, 1, 0)));
    // Standing: looking down at the two heads lying in front of him
    const mid = (this.fallen[0] && this.fallen[1] ? this.fallen[0].position.clone().lerp(this.fallen[1].position, 0.5) : b.wrist(0).lerp(b.wrist(1), 0.5)).setY(pp.y);
    const yaw = Math.atan2(-(mid.x - pp.x), -(mid.z - pp.z));
    const qStand = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.42 + 0.2 * smooth((t - 6.6) / 0.6), yaw, 0, 'YXZ'));
    cam.quaternion.copy(this.harvestFrom.q).slerp(look(A.look), kIn).slerp(look(B.look), kMove).slerp(qStand, kOut);
    cam.updateMatrixWorld(true);
    // ---- The two cuts: the same each time, at 0 and at 2.8 seconds
    const cut = (i: number, t0: number): number => {
      const tt = t - t0;
      if (tt < 0 || tt > 2.8) return 0;
      const head = b.arms[i].head.root;
      const wrist = b.wrist(i);
      const away = V(pp.x - wrist.x, 0, pp.z - wrist.z).normalize();
      // His left hand on the cannon
      if (!this.fallen[i]) {
        const grabAt = cam.worldToLocal(head.localToWorld(V(0.0, -0.04, 0.3)));
        H.leftHand.position.lerpVectors(V(-0.24, -0.5, -0.3), Level16Scene.reach(grabAt, -1), smooth((tt - 0.45) / 0.45));
        H.leftHand.rotation.set(-0.7, 0.5, -0.9);
      } else H.leftHand.position.lerp(V(-0.26, -0.6, -0.25), Math.min(1, dt * 6));
      // The karambit sawing
      const kUp = smooth((tt - 0.8) / 0.35) * (1 - smooth((tt - 2.55) / 0.3));
      const wC = cam.worldToLocal(wrist.clone());
      const k = 0.46 / Math.max(0.3, -wC.z);
      const saw = tt > 1.1 && tt < 2.5 ? Math.sin((tt - 1.1) * 11) : 0;
      H.knifeHand.position.copy(Level16Scene.reach(V(wC.x * k + 0.09 + saw * 0.07, wC.y * k + 0.02 + saw * 0.025, -0.46), 1)).lerp(V(0.25, -0.55, -0.3), 1 - kUp);
      H.knifeHand.rotation.set(-0.5 + saw * 0.12, 0.35, 0.9 + saw * 0.3);
      if (tt > 1.1 && tt < 2.5 && Math.floor((tt - dt - 1.1) / 0.28) !== Math.floor((tt - 1.1) / 0.28)) {
        this.drops.burst(wrist, away.clone().setY(0.7), 14, 2.6, BOSS_BLOOD);
        this.ctx.audio.fleshHit();
        this.shake = Math.max(this.shake, 0.2);
      }
      // Through: it drops
      if (tt >= 2.55 && !this.fallen[i]) {
        this.fallen[i] = b.sever(i, this.scene);
        this.drops.burst(wrist, away.clone().setY(1), 40, 4, BOSS_BLOOD);
        this.ctx.audio.squelchPop();
        this.ctx.audio.knifeStab();
        this.shake = Math.max(this.shake, 0.6);
      }
      return kUp;
    };
    const k1 = cut(ia, 0);
    const k2 = cut(ib, 2.8);
    H.knifeRoot.visible = Math.max(k1, k2) > 0.01;
    H.leftRoot.visible = (t > 0.45 && t < 2.75) || (t > 3.25 && t < 5.55);
    const closed = (t > 0.85 && t < 2.6) || (t > 3.65 && t < 5.4) ? 1 : 0;
    // ---- The heads, once off: down onto the ground, twitching
    for (const i of [0, 1]) {
      const f = this.fallen[i];
      if (!f || f.parent !== this.scene) continue;
      const gy = W.groundY(f.position.x, f.position.z) + 0.14;
      if (f.position.y > gy) {
        this.fallV[i] -= 14 * dt;
        f.position.y = Math.max(gy, f.position.y + this.fallV[i] * dt);
      }
      f.rotation.z += Math.sin(t * (17 + i * 5)) * 0.015;
    }
    // ---- His hands out, open (6.0); the heads leap onto his forearms (6.7–7.4)
    if (t > 5.9) {
      for (const arm of [this.acidArm, this.grabArm]) arm.stow = Math.max(0, 1 - smooth((t - 5.9) / 0.6));
    }
    for (const i of [0, 1]) {
      const f = this.fallen[i];
      const arm = this.armFor(i);
      if (!f) continue;
      const t0 = 6.7 + i * 0.15;
      if (t >= t0 && f.parent === this.scene) {
        cam.attach(f);
        this.leapFrom[i] = { p: f.position.clone(), q: f.quaternion.clone(), s: f.scale.clone() };
        this.ctx.audio.squelchPop();
        this.ctx.audio.kickWhoosh();
      }
      if (t >= t0 && f.visible && this.leapFrom[i]) {
        const kL = smooth((t - t0) / 0.6);
        arm.hand.updateMatrix();
        const seat = new THREE.Object3D();
        arm.seat(seat);
        seat.updateMatrix();
        const m = arm.hand.matrix.clone().multiply(seat.matrix);
        const tp = new THREE.Vector3();
        const tq = new THREE.Quaternion();
        const ts = new THREE.Vector3();
        m.decompose(tp, tq, ts);
        const L = this.leapFrom[i];
        f.position.lerpVectors(L.p, tp, kL).add(V(0, Math.sin(kL * Math.PI) * 0.35, 0));
        f.quaternion.copy(L.q).slerp(tq, kL);
        f.scale.lerpVectors(L.s, ts, kL);
        if (kL >= 1) {
          f.visible = false;
          arm.gun.root.visible = true;
          this.ctx.audio.squelchPop();
          this.ctx.audio.groan(0.6);
          this.ctx.audio.electricCrackle(0);
          this.shake = Math.max(this.shake, 0.6);
        }
      }
      // It takes hold
      const tg = t0 + 0.6;
      arm.grip = smooth((t - tg) / 1.0);
      arm.open = t > 5.8 ? 1 - smooth((t - tg - 0.3) / 0.4) : 1;
      arm.tremor = t > tg ? Math.max(0, 1 - (t - tg) / 1.4) : 0;
      if (t > tg && t < tg + 1 && Math.random() < 0.25) this.drops.burst(arm.muzzleWorld(), V(0, 0.5, 0), 2, 1, KIND_GLOW[arm.kind]);
    }
    if (t > 8.5 && t - dt <= 8.5) {
      this.acidArm.recoil = 1;
      this.grabArm.recoil = 1;
      this.ctx.audio.electricCrackle(0);
    }
    if (t > 5.8) {
      this.acidArm.update(dt, this.player);
      this.grabArm.update(dt, this.player);
    }
    H.update(closed);
    if (t > 9.0) this.endHarvest();
  }

  private endHarvest(): void {
    this.harvested = true;
    this.phase = 'play';
    this.phaseT = 0;
    const p = this.player;
    const e = new THREE.Euler().setFromQuaternion(p.camera.quaternion, 'YXZ');
    p.yaw = e.y;
    p.pitch = e.x;
    p.cinematic = false;
    this.cinema(false);
    this.hands.knifeRoot.visible = false;
    this.hands.leftRoot.visible = false;
    for (const arm of [this.acidArm, this.grabArm]) {
      arm.grip = 1;
      arm.open = 0;
      arm.tremor = 0;
      arm.pose = null;
      arm.gun.root.visible = true;
    }
    for (const f of this.fallen) if (f) f.visible = false;
    const a = this.arsenal;
    a.hasBlaster = true;
    a.knifeWanted = true;
    a.knifeActive = true;
    a.side = 'blaster';
    a.sideWant = 'blaster';
    a.knifeStow = 0;
    a.showInventory();
    this.ctx.audio.itemGet();
    this.setObjective('FIND THE EXIT PORTAL — THE CAVE');
    this.hint('[LMB] GRABBER — HOLD TO KEEP HOLD, SWING, LET GO TO THROW · [RMB] ACID · [5] ALIEN ARMS', 8);
    this.ctx.audio.portalHum();
    this.ctx.audio.startTrackMusic('audio/dark-amb.mp3', 0, 0, 0.5, 3);
    this.later(2.5, () => this.spawnPack(this.packs[3]));
    this.lightning(1);
  }

  // ============================================================ the portal

  private updatePortal(dt: number): void {
    const P = this.level.portal;
    const on = this.harvested;
    const u = P.disc.uniforms;
    u.uT.value = this.t;
    u.uK.value += ((on ? 1 : 0.2) - u.uK.value) * Math.min(1, dt * 1.5);
    this.portalLight.intensity = 4 + 30 * u.uK.value + Math.sin(this.t * 3) * 3;
    if (this.part === 1) {
      this.updateCaveMouth();
      return;
    }
    if (!on || this.phase !== 'play' || !this.player.alive) return;
    const d = Math.hypot(this.player.position.x - P.at.x, this.player.position.z - P.at.z);
    if (d < 2.3) this.finish();
  }

  /**
   * The cave's mouth at the end of the canyon: shut till he has the big
   * one's cannons; then in he goes, and the rest of the level loads (part two).
   */
  private updateCaveMouth(): void {
    const P = this.level.portal;
    const L = this.level;
    L.caveGate.disabled = this.harvested;
    const d = Math.hypot(this.player.position.x - P.at.x, this.player.position.z - P.at.z);
    if (!this.caveHinted && d < 7 && this.phase === 'play') {
      this.caveHinted = true;
      this.hint(this.harvested ? 'THE SIGNAL IS COMING FROM INSIDE' : 'SOMETHING IN THERE KNOWS THE WAY OUT — BUT NOT WITHOUT WHAT THE BIG ONE CARRIES', 6);
    }
    if (this.caveWalk >= 0) {
      // On in, a few steps into the dark, the light behind him going
      const p = this.player;
      this.caveWalk += 1 / 60;
      const dir = V(P.at.x - p.position.x, 0, P.at.z - 6 - p.position.z);
      if (dir.length() > 0.2) p.position.addScaledVector(dir.normalize(), 1.7 / 60);
      p.position.y = W.groundY(p.position.x, p.position.z);
      p.yaw += (Math.atan2(-(P.at.x - p.position.x), -(P.at.z - 6 - p.position.z)) - p.yaw) * 0.05;
      p.pitch += (-0.05 - p.pitch) * 0.05;
      p.camera.position.copy(p.position).add(V(0, 1.63, 0));
      p.camera.quaternion.setFromEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'));
      return;
    }
    if (!this.harvested || this.phase !== 'play' || !this.player.alive || d > 2.6) return;
    this.phase = 'end';
    this.caveWalk = 0;
    this.player.cinematic = true;
    this.cinema(true);
    this.hud.setPrompt(null);
    this.fadeEl.style.transition = 'opacity 1.9s ease-in';
    this.fadeEl.style.background = '#000';
    this.fadeEl.style.opacity = '1';
    this.ctx.audio.stopTrackMusic(1.6);
    this.ctx.audio.drip(2);
    this.later(2.2, () => this.ctx.bus.emit(Events.Level16Cave));
  }

  /** The big one's arms on his: both cannons, out. */
  private giveArms(): void {
    for (const arm of [this.acidArm, this.grabArm]) {
      arm.grip = 1;
      arm.open = 0;
      arm.tremor = 0;
      arm.pose = null;
      arm.gun.root.visible = true;
    }
    const a = this.arsenal;
    a.hasBlaster = true;
    a.knifeWanted = true;
    a.knifeActive = true;
    a.side = 'blaster';
    a.sideWant = 'blaster';
    a.knifeStow = 0;
  }

  /** Starting past the clearing (the chasm's checkpoint): the big one's dead and its cannons are his. */
  private pastTheBoss(): void {
    this.scene.remove(this.boss.group);
    this.boss.alive = false;
    this.boss.deadT = 99;
    this.harvested = true;
    this.giveArms();
    this.packs[3].spawned = true;
    this.setObjective('CROSS THE CHASM — THE CAVE');
  }

  /** Part two: in the cave, already armed, the big one long behind him; its packs, its eggs, its drips. */
  private setupCave(): void {
    const C = this.level as Level16Data & Partial<CaveExtras>;
    this.introDone = true;
    this.scene.remove(this.boss.group);
    this.boss.alive = false;
    this.boss.deadT = 99;
    this.harvested = true;
    this.giveArms();
    this.packs = (C.packs ?? []).map((p) => ({ trigger: p.trigger, at: p.at, spawned: false }));
    this.setObjective('FIND THE PORTAL — FOLLOW THE TRACKER [M]');
    // The eggs' glow on the rock round them: a few warm lights among the clusters
    for (let k = 0; k < 3; k++) {
      const l = new THREE.PointLight(0xff7a3a, 2.4, 8, 1.6);
      l.position.set(0, -500, 0);
      this.scene.add(l);
      this.eggLights.push(l);
    }
    // In out of the dark
    this.fadeEl.style.transition = 'none';
    this.fadeEl.style.background = '#000';
    this.fadeEl.style.opacity = '1';
    this.later(0.15, () => {
      this.fadeEl.style.transition = 'opacity 1.8s';
      this.fadeEl.style.opacity = '0';
    });
    this.later(2, () => this.hint('THE EGGS ON THE WALLS — [E], OR GRAB ONE WITH THE GRABBER [LMB]: IT HEALS', 7));
  }

  /** The cave's eggs (E: eaten, he heals) and its drips. */
  private updateCave(dt: number): void {
    const C = this.level as Level16Data & Partial<CaveExtras>;
    const p = this.player;
    const eye = p.camera.position;
    let near: CaveExtras['eggs'][number] | null = null;
    let nd = 1.9;
    for (const e of C.eggs ?? []) {
      if (e.eaten) {
        if (e.mesh.userData.grabbed) continue;
        // Burst: collapsing, gone
        const s = e.mesh.scale.x;
        if (s > 0.01) e.mesh.scale.setScalar(Math.max(0, s - dt * 3));
        continue;
      }
      e.mesh.children[1]?.scale.setScalar(0.9 + 0.12 * Math.sin(this.t * 2.5 + e.at.x));
      const d = e.at.distanceTo(eye);
      if (d < nd) {
        nd = d;
        near = e;
      }
    }
    if (near && this.playable && !this.promptBusy) {
      this.hud.setPrompt('[ E ] EAT THE EGG');
      if (this.ctx.input.wasPressed('KeyE')) {
        near.eaten = true;
        this.drops.burst(near.at, V(0, 0.6, 0), 24, 2.2, 0xffa060);
        this.ctx.audio.squelchPop();
        this.later(0.25, () => this.ctx.audio.gulp(0));
        p.health = Math.min(p.maxHealth, p.health + 2);
        this.shake = Math.max(this.shake, 0.15);
        this.hud.setPrompt(null);
      }
    } else if (!near && this.cavePrompt) this.hud.setPrompt(null);
    this.cavePrompt = !!near;
    // Drips off the roof, splashing into the puddles under them
    for (const d of C.drips ?? []) {
      d.t -= dt;
      if (d.t > 0) continue;
      d.t = d.every;
      this.drops.burst(d.top, V(0, -0.1, 0), 1, 0.05, 0x9ad8ff);
      const fall = Math.sqrt((2 * Math.max(0.1, d.top.y - d.floor)) / 14);
      this.later(fall, () => {
        this.drops.burst(V(d.top.x, d.floor + 0.05, d.top.z), V(0, 1, 0), 4, 0.9, 0x9ad8ff);
        const dist = Math.hypot(d.top.x - p.position.x, d.top.z - p.position.z);
        if (dist < 14) this.ctx.audio.drip(dist);
      });
    }
  }
  private cavePrompt = false;

  private finish(): void {
    this.phase = 'end';
    this.phaseT = 0;
    this.player.cinematic = true;
    this.cinema(true);
    this.ctx.audio.portalHum();
    this.ctx.audio.revealSting();
    this.fadeEl.style.transition = 'opacity 0.5s';
    this.fadeEl.style.background = '#e8fbff';
    this.fadeEl.style.opacity = '1';
    this.later(1.0, () => (this.card.style.opacity = '1'));
    this.later(7.5, () => this.ctx.bus.emit(Events.Level16Complete));
  }

  // ============================================================ progress

  private updateCheckpoints(): void {
    const p = this.player.position;
    if (!this.player.alive || this.phase !== 'play') return;
    let c = this.checkpoint;
    if (this.part === 2) {
      if (c < 1 && p.z < -50) this.checkpoint = 1;
      return;
    }
    if (inChasm(p.x, p.z) && p.y < -1) {
      this.player.kill('THE CHASM');
      return;
    }
    if (c < 5 && this.harvested && p.z < -138) c = 5;
    if (c < 2 && this.hasTablet && p.z < CLIFF_Z - 2 && p.y > 3.8) c = 2;
    if (c < 3 && p.z < MASSIF.z0 - 14 && !W.inLake(p.x, p.z)) c = 3;
    if (c !== this.checkpoint) this.checkpoint = c;
  }

  private updateHints(dt: number): void {
    const p = this.player.position;
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.style.opacity = '0';
    }
    if (this.phase !== 'play' || this.part === 2) return;
    if (!this.chasmHinted && this.harvested && p.z < -141) {
      this.chasmHinted = true;
      this.hint('TOO FAR TO JUMP — SHOTGUN [2], JUMP, THEN A PRESSURE SHOT [RMB] LOOKING DOWN AND BACK', 9);
    }
    if (!this.cliffHinted && this.hasTablet && p.z < CLIFF_Z + 7 && p.z > CLIFF_Z && p.y < 3) {
      this.cliffHinted = true;
      this.hint('TOO HIGH TO CLIMB — SHOTGUN [2], JUMP, LOOK STRAIGHT DOWN AND [RMB] A PRESSURE SHOT', 9);
    }
    if (this.tabletHinted === 1 && p.z < 18 && p.z > 6 && p.y > 3.5) {
      this.tabletHinted = 2;
      this.hint('THE ROCK BLOCKS THE CANYON — THE WAY ON IS UNDER IT, THROUGH THE WATER', 7);
    }
  }

  // ============================================================ the atmosphere

  private lightning(strength = 0.7): void {
    this.flash = strength;
    const a = Math.random() * Math.PI * 2;
    this.level.sky.uniforms.uFlashDir.value.set(Math.cos(a), Math.sin(a));
    this.later(0.12, () => (this.flash = Math.max(this.flash, strength * 0.4)));
    this.later(0.22, () => (this.flash = Math.max(this.flash, strength * 0.9)));
    this.later(1.2 + Math.random() * 1.8, () => this.ctx.audio.thunder(400 + Math.random() * 600));
  }

  private updateAtmosphere(dt: number): void {
    const L = this.level;
    const p = this.player;
    const fog = this.scene.fog as THREE.FogExp2;
    const uw = this.underwater;
    const cave = W.inCave(p.camera.position.x, p.camera.position.z);
    this.flashT -= dt;
    if (this.flashT <= 0) {
      this.flashT = 9 + Math.random() * 14;
      if (!cave && !uw) this.lightning(0.5 + Math.random() * 0.5);
    }
    this.flash = Math.max(0, this.flash - dt * 4.5);
    const fl = cave || uw ? 0 : this.flash;
    const want = uw ? Level16Scene.FOG_WATER : cave ? Level16Scene.FOG_CAVE : Level16Scene.FOG_AIR;
    fog.color.lerp(want, uw ? 1 : Math.min(1, dt * 3));
    const dens = uw ? 0.13 : cave ? 0.05 : 0.03;
    L.groundFog.uniforms.uT.value = this.t;
    L.groundFog.uniforms.uScale.value = Math.max(window.innerHeight, 400) * 0.75;
    L.groundFog.uniforms.uAlpha.value = cave || uw ? 0 : 0.16;
    fog.density = uw ? dens : fog.density + (dens - fog.density) * Math.min(1, dt * 3);
    this.murk.style.opacity = uw ? '1' : '0';
    const dark = uw ? 0.5 : this.part === 2 ? 0.3 : cave ? 0.18 : 1;
    this.hemi.intensity += (Level16Scene.HEMI * dark + fl * 2.5 - this.hemi.intensity) * Math.min(1, dt * 8 + fl);
    this.moon.intensity += (Level16Scene.MOON * (cave ? 0 : uw ? 0.3 : 1) + fl * 4 - this.moon.intensity) * Math.min(1, dt * 8 + fl);
    L.sky.uniforms.uFlash.value = fl;
    const lampWant = (uw || cave) && p.alive ? 1 : 0;
    this.lampOn += (lampWant - this.lampOn) * Math.min(1, dt * 4);
    this.lamp.intensity = 70 * this.lampOn;
    this.lampSpill.intensity = 1.4 * this.lampOn;
    this.underLoop?.set(uw ? 1 : 0);
    L.water.uniforms.uT.value = this.t;
    L.water.uniforms.fogColor.value.copy(fog.color);
    L.water.uniforms.fogDensity.value = fog.density;
    L.sky.uniforms.uT.value = this.t;
    for (const [i, s] of L.specimens.entries()) s.rotation.y = Math.sin(this.t * 0.4 + i) * 0.4;
    L.station.update(this.t, dt, p.camera.position, p.camera);
    L.glowMats.forEach((m, i) => (m.emissiveIntensity = (m.userData.base ??= m.emissiveIntensity) * (0.75 + 0.25 * Math.sin(this.t * (0.8 + i * 0.3) + i))));
    const px = p.camera.position.x;
    const pz = p.camera.position.z;
    for (const c of L.chunks) {
      const s = c.mesh.boundingSphere;
      if (!s) continue;
      const d = Math.hypot(s.center.x - px, s.center.z - pz) - s.radius;
      c.mesh.visible = d < 150 && (c.lod === 'any' || (c.lod === 'near' ? d < 26 : d >= 26));
    }
    this.bubbleT -= dt;
    if (this.bubbleT <= 0) {
      this.bubbleT = 0.12;
      const spot = L.bubbleSpots[Math.floor(Math.random() * L.bubbleSpots.length)];
      if (Math.hypot(spot.x - px, spot.z - pz) < 60) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * spot.r;
        this.drops.burst(V(spot.x + Math.cos(a) * r, spot.y + 0.02, spot.z + Math.sin(a) * r), V(0, 1, 0), 3, 0.9, 0x9aff6a);
      }
    }
    L.planets.forEach((pl, i) => (pl.rotation.y = this.t * 0.004 * (i + 1)));
  }

  private splash(at: THREE.Vector3, n: number): void {
    this.drops.burst(at, V(0, 1, 0), n, 3, 0x7aff5a);
  }

  private applyShake(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (this.shake <= 0) return;
    const s = this.shake * this.shake * 0.025;
    const cam = this.player.camera;
    cam.rotation.x += (Math.random() - 0.5) * s;
    cam.rotation.y += (Math.random() - 0.5) * s;
  }

  private timers: { at: number; fn: () => void }[] = [];
  private later(sec: number, fn: () => void): void {
    this.timers.push({ at: this.t + sec, fn });
  }

  private onClick(): void {
    if (this.dead) this.restart();
  }

  // ============================================================ the pack on the hill

  private intro: { t: number; alpha: Hound; pack: { h: Hound; from: THREE.Vector3; to: THREE.Vector3; at: number }[]; q0: THREE.Quaternion } | null = null;
  private introDone = false;

  /** Out of the station, a few steps: up on the hill ahead, one of them. */
  private maybeIntro(): void {
    if (this.introDone || this.doorT < 3 || !this.player.alive || this.player.position.z > 128.5) return;
    this.introDone = true;
    const p = this.player;
    this.phase = 'intro';
    this.phaseT = 0;
    p.cinematic = true;
    this.cinema(true);
    this.hud.setPrompt(null);
    const top = V(HILL.x, W.groundY(HILL.x, HILL.z), HILL.z);
    const toward = V(p.position.x - top.x, 0, p.position.z - top.z).normalize();
    const away = toward.clone().negate();
    const side = V(-toward.z, 0, toward.x);
    // The big one on the crest, facing him
    const alpha = new Hound();
    alpha.group.scale.setScalar(1.8);
    alpha.hp = 9;
    const at = top.clone().addScaledVector(toward, 0.8);
    alpha.group.position.set(at.x, W.groundY(at.x, at.z), at.z);
    alpha.yaw = Math.atan2(toward.x, toward.z);
    alpha.group.rotation.y = alpha.yaw;
    alpha.state = 'lurk';
    alpha.stateT = -1e9;
    this.scene.add(alpha.group);
    this.hounds.push(alpha);
    this.houndHits.push(...alpha.hitboxes);
    // A horde behind the hill, out of sight, to come up over it in waves: the first five
    // full-grown, the rest the pack's runts (smaller, and one good hit each), from further back
    const pack: { h: Hound; from: THREE.Vector3; to: THREE.Vector3; at: number }[] = [];
    const N = 4;
    for (let i = 0; i < N; i++) {
      const h = new Hound();
      const wave = i < 5 ? 0 : 1 + Math.floor((i - 5) / 5);
      if (i >= 5) {
        h.group.scale.setScalar(0.72 + Math.random() * 0.18);
        h.hp = 1;
      }
      const inRow = i < 5 ? i : (i - 5) % 5;
      const lat = (inRow - 2) * (2.3 + wave * 0.5) + (Math.random() - 0.5) * 1.4;
      // Up onto the crest itself, either side of it, against the sky
      const to = top.clone().addScaledVector(away, 0.2 + wave * 1.6 + Math.random() * 0.4).addScaledVector(side, lat);
      const from = to.clone().addScaledVector(away, 7 + wave * 4);
      h.group.position.set(from.x, W.groundY(from.x, from.z), from.z);
      h.yaw = alpha.yaw;
      h.group.rotation.y = h.yaw;
      h.state = 'lurk';
      h.stateT = -1e9;
      this.scene.add(h.group);
      this.hounds.push(h);
      this.houndHits.push(...h.hitboxes);
      pack.push({ h, from, to, at: 2.9 + wave * 0.45 + inRow * 0.14 + Math.random() * 0.1 });
    }
    this.intro = { t: 0, alpha, pack, q0: p.camera.quaternion.clone() };
    this.ctx.audio.stopTrackMusic(1.5);
  }

  /**
   * He looks up: the thing on the crest. The view closes in on it, standing
   * there, its mouth working; thunder; then heads come up over the hill
   * behind it, five of them. It screams, and they all come down at him.
   */
  private updateIntro(dt: number): void {
    const I = this.intro;
    if (!I) return;
    I.t += dt;
    const t = I.t;
    const p = this.player;
    const cam = p.camera;
    const a = I.alpha;
    cam.position.copy(p.position).add(V(0, 1.63, 0));
    // On it; then, as they come, back to take in the lot of them pouring down the hill
    const look = a.group.position.clone().add(V(0, 0.95 * a.group.scale.x, 0));
    const mid = new THREE.Vector3();
    for (const m of I.pack) mid.add(m.h.group.position);
    mid.divideScalar(I.pack.length).add(V(0, 0.6, 0));
    look.lerp(mid, smooth((t - 5.2) / 0.8) * 0.6);
    const qLook = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, look, V(0, 1, 0)));
    cam.quaternion.copy(I.q0).slerp(qLook, smooth(t / 1.2));
    // Zoom in on it; out again, wide, as they come
    const fov = 74 - 58 * smooth((t - 1.0) / 1.8) + 30 * smooth((t - 5.2) / 0.8) + 28 * smooth((t - 6.9) / 0.5);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    // It stands there; its mouth working, the head lifting
    a.speed = 0;
    if (t > 2.0 && t - dt <= 2.0) this.ctx.audio.houndScreech(6);
    if (t > 2.6 && t - dt <= 2.6) this.lightning(1);
    // The others up over the crest behind it
    const pp = p.position;
    // The line across the valley from him to the hill, and its side-to-side
    const ax = HILL.x - pp.x;
    const az = HILL.z - pp.z;
    const al = Math.hypot(ax, az) || 1;
    const sx = -az / al;
    const sz = ax / al;
    const charge = (h: Hound, sp: number, lane: number): void => {
      // Down the hill at him, flat out, each fanning out to its own lane so they come as a line,
      // not a column; and stop short (control comes back before they reach him)
      const g = h.group.position;
      let dx = pp.x + sx * lane - g.x;
      let dz = pp.z + sz * lane - g.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      // Round the acid ponds, not through them (they would sink out of sight): slide along the edge
      for (const pd of PONDS) {
        const ox = g.x - pd.x;
        const oz = g.z - pd.z;
        const od = Math.hypot(ox, oz);
        if (od > pd.r + 2.5 || od < 0.01) continue;
        const nx = ox / od;
        const nz = oz / od;
        const k = 1 - Math.max(0, (od - pd.r) / 2.5);
        const inward = dx * nx + dz * nz;
        if (inward < 0) {
          dx -= nx * inward * k;
          dz -= nz * inward * k;
        }
        if (od < pd.r + 0.5) {
          dx += nx * 0.6;
          dz += nz * 0.6;
        }
        const n = Math.hypot(dx, dz) || 1;
        dx /= n;
        dz /= n;
      }
      h.yaw = Math.atan2(dx, dz);
      h.group.rotation.y = h.yaw;
      const go = d > 7;
      if (go) {
        g.x += dx * sp * dt;
        g.z += dz * sp * dt;
      }
      g.y = W.groundY(g.x, g.z);
      h.speed = go ? sp : 0;
    };
    I.pack.forEach((m, i) => {
      if (t > 5.4) {
        charge(m.h, 3.2 + (i % 2) * 0.3, (i - 1.5) * 3.2);
        return;
      }
      const k = smooth((t - m.at) / 1.2);
      const g = m.h.group.position;
      g.lerpVectors(m.from, m.to, k);
      g.y = W.groundY(g.x, g.z);
      m.h.speed = k > 0 && k < 1 ? 3 : 0;
      if (k > 0.5 && t - dt < m.at + 0.6 && t >= m.at + 0.6 && i % 4 === 0) this.ctx.audio.houndScreech(14 + i);
    });
    if (t > 5.3 && t - dt <= 5.3) {
      a.state = 'lunge';
      this.ctx.audio.houndScreech(2);
      this.later(0.25, () => this.ctx.audio.houndScreech(8));
      this.later(0.5, () => this.ctx.audio.houndScreech(12));
      this.shake = Math.max(this.shake, 0.6);
    }
    if (t > 5.4) charge(a, 3.5, 0);
    if (t > 7.3) this.endIntro();
  }

  private endIntro(): void {
    const I = this.intro;
    if (!I) return;
    this.intro = null;
    for (const m of I.pack) {
      const g = m.h.group.position;
      g.y = W.groundY(g.x, g.z);
    }
    for (const h of [I.alpha, ...I.pack.map((m) => m.h)]) {
      h.state = 'run';
      h.stateT = 0;
    }
    const p = this.player;
    const cam = p.camera;
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    p.yaw = e.y;
    p.pitch = e.x;
    cam.fov = 74;
    cam.updateProjectionMatrix();
    p.cinematic = false;
    this.phase = 'play';
    this.phaseT = 0;
    this.cinema(false);
    this.setObjective('KILL THE PACK');
    this.ctx.audio.startTrackMusic('audio/dark-amb.mp3', 0, 0, 0.5, 2);
    this.later(9, () => {
      if (this.phase === 'play') this.setObjective(this.hasTablet ? 'FOLLOW THE TRACKER — HOLD [M]' : 'INVESTIGATE THE CRASHED DRONE');
    });
  }

  // ============================================================ the explorer's note

  private noteEl: HTMLElement | null = null;

  /** By the body: E to read what he wrote; E again (or walking off) to put it down. */
  private updateNote(): void {
    const N = this.level.note;
    const p = this.player;
    const near = this.playable && p.position.distanceTo(N.at) < 2.2;
    if (this.noteEl) {
      if (!near || this.ctx.input.wasPressed('KeyE')) this.closeNote();
      return;
    }
    if (!near) return;
    if (!this.promptBusy) this.hud.setPrompt('[ E ] READ THE NOTE');
    if (this.ctx.input.wasPressed('KeyE')) this.openNote();
  }

  private openNote(): void {
    this.ctx.audio.pocket();
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-1.5deg);width:min(520px,86vw);padding:30px 34px;background:#e9e2cf;' +
      'color:#2a2418;font:17px/1.55 "Segoe Print","Bradley Hand","Comic Sans MS",cursive;box-shadow:0 10px 40px rgba(0,0,0,.7);z-index:20;pointer-events:none;' +
      'background-image:repeating-linear-gradient(transparent 0 25px, rgba(60,90,140,.18) 25px 26px)';
    el.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px">SURVEY TEAM 2 — LOG, by hand (the tablet's dead)</div>
      <div><b>Day 9.</b> Lost the drone over the north canyon. The hounds took Marek at the meadow. They don't see. They <i>hear</i> you. They live in holes in the canyon walls and they come out all at once.</div>
      <div style="margin-top:8px"><b>Day 11.</b> The portal signal's real. It's past the big one, the thing with the arms. One arm spits acid. The other one reaches for you. Don't let it.</div>
      <div style="margin-top:8px"><b>Day 12.</b> Can't feel my legs. The suit keeps telling me my heart rate like that's going to help.</div>
      <div style="margin-top:8px">If you're reading this: stay out of the green. Stay away from the holes. And take the bottle in my pocket — it's the only thing on this planet that doesn't smell like the inside of a mouth.</div>
      <div style="margin-top:14px;font-size:13px;opacity:.6">[ ${'E'} ] put it down</div>`;
    this.ctx.uiRoot.appendChild(el);
    this.noteEl = el;
    this.hud.setPrompt(null);
  }

  private closeNote(): void {
    this.noteEl?.remove();
    this.noteEl = null;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Enter' && this.phase === 'intro') {
      this.endIntro();
      return;
    }
    if (this.dead) {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') this.restart();
      return;
    }
    if (e.code === 'Escape' && this.phase === 'end') this.ctx.bus.emit(Events.ReturnToMenu);
  }

  private chasmHinted = false;

  private restart(): void {
    this.ctx.bus.emit(this.part === 2 ? Events.RestartLevel16b : Events.RestartLevel16, { checkpoint: this.checkpoint });
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}
