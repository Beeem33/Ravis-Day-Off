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
  HILL,
  DENS,
  CAVE_MOUTH_Z,
  LAKE_BED,
  CEIL_Y
} from '../environment/Level16Builder';
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
import { dressSuitBody } from '../entities/SuitDress';
import { HelmetVisor } from '../ui/HelmetVisor';
import { AcidBubbles } from '../fx/AcidBubbles';
import { Controls } from '../core/Controls';
import type { Enemy } from '../entities/Enemy';
import { HoundRagdoll } from '../entities/HoundRagdoll';
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
type BossMove = 'idle' | 'mortar' | 'spray' | 'grab' | 'tree' | 'stagger';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};
const SWIM_DEPTH = 1.25;
const HOUND_SPEED = 6.9;
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
  kind: 'terrain' | 'world' | 'trunk' | 'hound' | 'boss' | 'trap' | 'tongue';
  hound?: Hound;
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
  private ragdolls: HoundRagdoll[] = [];
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
  private eating: { t: number; from: THREE.Vector3; done: boolean } | null = null;
  private eatFade: HTMLElement | null = null;
  private wasSwimming = false;
  private tree: { i: number; stage: 'reach' | 'wrap' | 'fall' | 'drag'; t: number; from: THREE.Vector3; to: THREE.Vector3; dir: THREE.Vector3; hit: boolean } | null = null;
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

  constructor(ctx: GameContext, private from = 0) {
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
    this.level = new Level16Builder().build();
    const L = this.level;
    this.scene.add(L.group);
    // The trees round the clearing stand in the way until they're torn up
    for (const t of L.arenaTrees) {
      const c: Collider = { box: new THREE.Box3(V(t.x - 0.4, groundY(t.x, t.z) - 1, t.z - 0.4), V(t.x + 0.4, groundY(t.x, t.z) + 5, t.z + 0.4)) };
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
        for (let j = 0; j < nz; j++) col.push(groundY(X0 + i * es, Z1 - j * es));
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

    this.checkpoint = Math.min(this.from, 4);
    const start = this.checkpointPose(this.checkpoint);
    this.player = new FPSPlayer(start.pos.clone(), start.yaw, input, audio, bus);
    // Lighter gravity out here: higher, floatier jumps
    this.player.gravity = 10.5;
    this.player.jumpSpeed = 5.4;
    this.player.ground = groundY;
    this.player.camera.far = 1300;
    this.player.camera.updateProjectionMatrix();
    this.scene.add(this.player.camera);
    this.lastInside.copy(start.pos);
    this.ragdollOnDeath(() => (!this.arsenal.knifeActive && this.arsenal.held.stow < 0.5 ? this.arsenal.active : null));

    this.particles = new ParticleManager(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene, 4);
    this.decals = new BloodDecalSystem(this.scene);
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
    this.lamp.position.set(0.18, -0.12, 0.05);
    this.lamp.target.position.set(0.05, -0.15, -8);
    this.player.camera.add(this.lamp, this.lamp.target);
    this.acidLight = new THREE.PointLight(ACID, 0, 9, 1.6);
    this.scene.add(this.acidLight);
    this.portalLight = new THREE.PointLight(0x6ae0ff, 6, 30, 1.3);
    this.portalLight.position.copy(L.portal.at).add(V(0, 2.6, 1.5));
    this.scene.add(this.portalLight);

    this.acidShots = new GlowShots(ACID, 0.09, ACID_G, 0.3, 30);
    this.bossAcid = new GlowShots(ACID, 0.17, ACID_G, 0.3, 40);
    this.drops = new Droplets(900);
    this.scene.add(this.acidShots.group, this.bossAcid.group, this.drops.points);
    this.buildPools();
    this.tongue = this.makeTongue(0.028, 1);
    this.bossTongue = this.makeTongue(0.085, 2.4);
    this.tongueHit = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.tongueHit.userData.tongue = true;
    this.scene.add(this.tongueHit);

    // ---- The big one, waiting in its clearing; the packs; the maws
    this.boss = new SpiderBoss(groundY);
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
    Colognes.place(this.scene, 'maw', L.note.cologne, 0.6, () => (this.player && this.player.alive && !this.player.cinematic ? this.player.camera : null));
    const done = [this.checkpoint >= 1, this.checkpoint >= 3, this.checkpoint >= 4];
    done.forEach((d, i) => (this.packs[i].spawned = d));
    for (const s of L.trapSpots) {
      const m = new MawTrap();
      // Sat on the ground, tilted to its slope, not half sunk in it
      const e = 0.5;
      const n = V(groundY(s.x - e, s.z) - groundY(s.x + e, s.z), 2 * e, groundY(s.x, s.z - e) - groundY(s.x, s.z + e)).normalize();
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
    this.bubbles = new AcidBubbles(this.scene, {
      inWater: inLake,
      bed: (x, z) => Math.max(LAKE_BED - 0.4, groundY(x, z)),
      // Under the massif the water runs right up to the rock
      top: (x, z) => (x > MASSIF.x0 && x < MASSIF.x1 && z > MASSIF.z0 && z < MASSIF.z1 ? CEIL_Y : WATER_Y)
    });
    this.keyMarks = { door: Level16Scene.keyMarker(), tablet: Level16Scene.keyMarker() };
    this.scene.add(this.keyMarks.door, this.keyMarks.tablet);
    if (this.checkpoint >= 1) {
      this.openDoor(true);
      this.takeTablet(true);
    }

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
    this.setObjective(this.checkpoint === 0 ? 'RELEASE THE STATION DOOR' : 'FOLLOW THE TRACKER — HOLD [M]');
    input.requestPointerLock();
  }

  exit(): void {
    this.closeNote();
    RaviVisual.dressArms = null;
    RaviVisual.dressBody = null;
    this.eatFade?.remove();
    this.visor?.dispose();
    this.swimArms?.dispose();
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
    this.ui.remove();
  }

  private checkpointPose(c: number): { pos: THREE.Vector3; yaw: number } {
    const at = (x: number, z: number, yaw: number): { pos: THREE.Vector3; yaw: number } => ({ pos: V(x, groundY(x, z), z), yaw });
    switch (c) {
      case 1:
        return at(MEADOW.x - 2, MEADOW.z - 2, 0.2);
      case 2:
        return at(valleyX(CLIFF_Z - 4), CLIFF_Z - 4, 0);
      case 3:
        return at(0, -60, 0);
      case 4:
        return at(valleyX(-80), -80, 0);
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
    const lake = inLake(pos.x, pos.z);
    p.swimming = p.alive && this.phase === 'play' && lake && pos.y < WATER_Y - SWIM_DEPTH && !this.heldBy && !this.grabbed;
    p.swimTop = WATER_Y - 1.45;
    this.underwater = inLake(p.camera.position.x, p.camera.position.z) && p.camera.position.y < WATER_Y - 0.02;
    if (p.swimming && !this.swimHinted) {
      this.swimHinted = true;
      this.ctx.audio.splash(true);
      this.splash(V(pos.x, WATER_Y, pos.z), 30);
      this.hint('SUIT LAMP ON — [W] SWIM WHERE YOU LOOK · [SPACE] UP · [C] DOWN', 7);
    }

    const free = this.playable && input.pointerLocked && !p.swimming;
    const wantTablet = this.hasTablet && free && input.isDown('KeyM') && !this.drink.engaged;
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
    this.visor.update(dt, p.sprinting || p.swimming ? 1 : 0, p.lastMouseDX, p.lastMouseDY, p.bob.phase * Math.min(1, p.bob.amount * 1.5));
    // Up out of the lake: water running down the visor
    if (this.wasSwimming && !p.swimming && p.alive) this.visor.splash();
    this.wasSwimming = p.swimming;
    this.visor.visible = p.alive; // the death camera is out of his head
    this.bubbles.update(dt, pos);
    this.updateMarkers();
    if (this.phase === 'play') {
      const targetFov = 74 - a.zoomFov;
      if (Math.abs(p.camera.fov - targetFov) > 0.01) {
        p.camera.fov = targetFov;
        p.camera.updateProjectionMatrix();
      }
    }
    this.hud.setAiming(a.aimBlend > 0.5);

    // ---- The route
    this.updateDoor(dt);
    this.updateTabletPickup(dt);
    this.updatePacks();
    this.updateHounds(dt);
    this.updateBoss(dt);
    this.updateTongues(dt);
    this.updateAcid(dt);
    this.updateHarvestPrompt();
    this.updateNote();
    if (this.phase === 'play') this.maybeIntro();
    if (this.phase === 'intro') this.updateIntro(dt);
    if (this.phase === 'harvest') this.updateHarvest(dt);
    this.updatePortal(dt);
    this.updateCheckpoints();
    this.updateHints(dt);

    this.updateAtmosphere(dt);
    this.drops.update(dt, groundY);
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
            const y = groundY(t.x, t.z);
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
    if (inCave(pos.x, pos.z) || outside(pos.x, pos.z) < 2.5) {
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
      d.slab.position.y = groundY(0, 134.5) + k * 2.45;
      if (k > 0.9) d.collider.disabled = true;
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
      d.slab.position.y = groundY(0, 134.5) + 2.45;
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
    this.setObjective('FOLLOW THE TRACKER — HOLD [M]');
    this.hint('HOLD [M] TO LOOK AT THE TRACKER — IT HAS A FIX ON AN EXIT PORTAL', 7);
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
    pk.at.forEach((s, i) => {
      const h = new Hound();
      h.group.position.set(s.x, groundY(s.x, s.z), s.z);
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
          const gy = groundY(g.x, g.z);
          if (g.y <= gy) {
            g.y = gy;
            this.flung.delete(h);
          }
        } else {
          h.knock.multiplyScalar(Math.exp(-4 * dt));
          g.x += h.knock.x * dt;
          g.z += h.knock.z * dt;
          g.y = groundY(g.x, g.z);
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
        const gy = groundY(g.x, g.z);
        if (g.y <= gy) {
          g.y = gy;
          const sp = fv.length();
          this.flung.delete(h);
          h.group.rotation.x = 0;
          h.group.rotation.z = 0;
          this.ctx.audio.bodyThud(g.distanceTo(pp));
          this.drops.burst(g.clone().add(V(0, 0.4, 0)), V(0, 1, 0), 14, 2.5, ALIEN_BLOOD);
          this.hurtHound(h, Math.max(1, sp * 0.4), g.clone().add(V(0, 0.6, 0)), fv.clone().normalize());
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
      g.x += h.vel.x * dt;
      g.z += h.vel.z * dt;
      if (h.airV !== 0 || h.air > 0) {
        h.air += h.airV * dt;
        h.airV -= 16 * dt;
        if (h.air <= 0) {
          h.air = 0;
          h.airV = 0;
        }
      }
      let gy = groundY(g.x, g.z);
      if (inLake(g.x, g.z)) gy = Math.max(gy, WATER_Y - 0.55);
      g.y = gy + h.air;
      h.group.rotation.y = h.yaw;
      h.animate(dt, this.t);
    }
  }

  private hurtHound(h: Hound, dmg: number, point: THREE.Vector3, dir: THREE.Vector3, acid = false): void {
    if (!acid) {
      this.drops.burst(point, dir.clone().negate().setY(0.3), 12, 3, ALIEN_BLOOD);
      this.ctx.audio.fleshHit();
    }
    if (!h.alive) return;
    h.hp -= dmg;
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
    h.knock.set(dir.x, 0, dir.z).normalize().multiplyScalar(acid ? 0 : 3 + Math.min(dmg, 4));
    this.drops.burst(point, V(0, 1, 0), acid ? 24 : 30, acid ? 2 : 4, acid ? ACID : ALIEN_BLOOD);
    this.acidFuse.delete(h);
    if (!acid) {
      const fv = this.flung.get(h);
      this.flung.delete(h);
      const v = fv ? fv.clone() : h.knock.clone().multiplyScalar(0.6).add(V(0, 1.5 + Math.min(dmg, 6) * 0.15, 0)).add(h.vel.clone().multiplyScalar(0.4));
      h.group.rotation.x = 0;
      h.group.rotation.z = 0;
      const rd = new HoundRagdoll(this.world, h, v);
      rd.onRest = (at) => this.bloodPool(at.x, at.z, 1.1 + Math.random() * 0.5, 0x6a7a12);
      this.ragdolls.push(rd);
    } else this.bloodPool(h.group.position.x, h.group.position.z, 1.3, 0x7ab01a);
    if (this.t - this.lastGrowl > 1) {
      this.lastGrowl = this.t;
      this.ctx.audio.houndScreech(point.distanceTo(this.player.position));
    }
    for (const hb of h.hitboxes) {
      const i = this.houndHits.indexOf(hb);
      if (i >= 0) this.houndHits.splice(i, 1);
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
      const at = aim ? aim.point : p.camera.position.clone().addScaledVector(dir, 30);
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
      if (h && h.kind === 'hound' && h.hound && h.hound.alive) {
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
    }
    if (T.state === 'hold') {
      const hd = this.holding!;
      if (!hd.alive || !lmb) {
        this.dropHeld(lmb);
      } else {
        // Out in front of him, where he looks: swung round as he turns
        const dir = p.camera.getWorldDirection(new THREE.Vector3());
        const want = p.camera.position.clone().addScaledVector(dir, 4.2);
        want.y = Math.max(want.y - 0.6, groundY(want.x, want.z) + 0.2);
        const g = hd.group.position;
        this.holdPrev.copy(g);
        g.lerp(want, Math.min(1, dt * 12));
        this.holdVel.subVectors(g, this.holdPrev).divideScalar(Math.max(dt, 1e-4));
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
    T.state = 'hold';
    this.holdPrev.copy(h.group.position);
    this.holdVel.set(0, 0, 0);
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
        h.spin.set((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12);
        if (v.length() > 6) this.ctx.audio.kickWhoosh();
      }
    }
    this.tongue.state = 'back';
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
    for (let i = 0; i < 150; i++) {
      const mat = puddleMaterial(Math.random() * 40);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 10, 10), mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      this.puddles.push({ mesh, mat, x: 0, z: 0, r: 1, life: 0, max: 1, enemy: false, burn: 0 });
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5a20, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    for (let i = 0; i < 30; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), ringMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 4;
      this.scene.add(ring);
      this.markers.push({ mesh: ring, t: 0, land: -1, r: 1 });
    }
  }

  /** A pool of acid where something came down: lying on the ground, whatever its shape. */
  private spawnPuddle(x: number, z: number, r: number, enemy: boolean, life = 6): void {
    if (inLake(x, z) && groundY(x, z) < WATER_Y) return;
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
    for (let i = 0; i < pos.count; i++) {
      const px = x + (uv.getX(i) * 2 - 1) * r;
      const pz = z - (uv.getY(i) * 2 - 1) * r;
      pos.setXYZ(i, px, groundY(px, pz) + 0.06, pz);
    }
    pos.needsUpdate = true;
    pd.mesh.geometry.computeBoundingSphere();
    pd.mesh.visible = true;
    this.drops.burst(V(x, groundY(x, z) + 0.1, z), V(0, 1, 0), 16, 3, ACID);
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
    for (let i = 0; i < pos.count; i++) {
      const px = x + (uv.getX(i) * 2 - 1) * r;
      const pz = z - (uv.getY(i) * 2 - 1) * r;
      pos.setXYZ(i, px, groundY(px, pz) + 0.035, pz);
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
    m.mesh.position.set(x, groundY(x, z) + 0.12, z);
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
          this.spawnPuddle(near.x, near.z, 1.7, true);
          return true;
        }
      }
      if (b.y < groundY(b.x, b.z)) {
        this.spawnPuddle(b.x, b.z, 1.9, true, shot.damage);
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
    // ---- Melting: smoking, slowing, three seconds from the first touch
    for (const [h, t0] of this.acidFuse) {
      if (!h.alive) {
        this.acidFuse.delete(h);
        continue;
      }
      const g = h.group.position;
      const k = (this.t - t0) / 3;
      h.speed *= Math.exp(-dt * (1 + k * 3));
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
      if (Math.random() < dt * 3) this.drops.burst(V(pd.x + (Math.random() - 0.5) * pd.r, groundY(pd.x, pd.z) + 0.1, pd.z + (Math.random() - 0.5) * pd.r), V(0, 1, 0), 2, 0.8, ACID);
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
      if (pd.enemy && p.alive && Math.hypot(pp.x - pd.x, pp.z - pd.z) < r && pp.y - groundY(pp.x, pp.z) < 0.4) inAcid = pd;
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
    else if (h.kind === 'boss') this.hurtBoss(s.damage * 2, h.point, dir, !!h.head);
    else if (h.kind === 'trap' && h.trap) this.hurtTrap(h.trap, s.damage * 2, h.point, dir);
    else if (h.kind === 'tongue') this.hurtTongue(3);
    this.spawnPuddle(h.point.x, h.point.z, 1.6, false);
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
    b.at.y = groundY(b.at.x, b.at.z);
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
          const order: BossMove[] = ['mortar', 'grab', 'spray', 'tree'];
          let next = order[this.moveI++ % order.length];
          if (next === 'tree' && this.treeUsed.every((u) => u)) next = 'mortar';
          this.startMove(next);
        }
        break;
      }
      case 'mortar': {
        // Globs one after another, each at him (or near), a ring where it'll come down
        const n = enraged ? 7 : 5;
        if (this.moveShots < n && this.moveT > 0.4 + this.moveShots * 0.32) {
          const spread = this.moveShots === 0 ? 0 : 3.5;
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * spread;
          const lead = p.velocity.clone().multiplyScalar(0.6);
          this.lob(pp.x + lead.x + Math.cos(a) * r, pp.z + lead.z + Math.sin(a) * r, 1.5, 1.9);
          this.moveShots++;
        }
        if (this.moveShots >= n && this.moveT > 0.4 + n * 0.32 + 0.6) this.startMove('idle');
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
          const w = 0.22 + k * 0.1;
          const n = Math.max(2, Math.ceil((2 * w * r) / 2.2) + 1);
          for (let j = 0; j < n; j++) {
            const a = S.base - w + (2 * w * j) / (n - 1);
            this.lob(S.o.x + Math.sin(a) * r, S.o.z + Math.cos(a) * r, 1.6, 0.9, 1.9 + k * 0.05, false);
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
          const target = p.camera.position.clone().add(V(0, -0.4, 0));
          const want2 = target.sub(T.tip).normalize();
          const turn = Math.min(1, dt * 2.2);
          T.dir.lerp(want2, turn).normalize();
          T.tip.addScaledVector(T.dir, (enraged ? 10.5 : 8.5) * dt);
          T.len = T.tip.distanceTo(T.from);
          if (T.tip.distanceTo(p.camera.position) < 1.1 && !this.eating) this.seize();
          else if (T.len > 34 || this.moveT > 7) this.retract(T);
        }
        if (T.state === 'idle' && !this.grabbed) this.startMove('idle');
        break;
      }
      case 'tree':
        this.updateTreeDrag(dt);
        break;
      case 'stagger':
        if (this.moveT > 1.6) this.startMove('idle');
        break;
    }
  }
  private sprayHinted = false;
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
      this.spray.arcs = THREE.MathUtils.clamp(Math.ceil((d + 6 - 4) / 2.4), 4, 9);
      // Far off, the arcs further apart: it still reaches past him
      this.spray.step = Math.max(2.4, (d + 6 - 4) / (this.spray.arcs - 1));
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
      const grabAt = V(t.x, groundY(t.x, t.z) + 2.2, t.z);
      T.dir.copy(grabAt).sub(T.from).normalize();
      this.tree = { i: best, stage: 'reach', t: 0, from: V(t.x, groundY(t.x, t.z), t.z), to: new THREE.Vector3(), dir: new THREE.Vector3(), hit: false };
      this.ctx.audio.giantRoar(0.6, d);
    }
  }

  /** One glob of acid on a high arc from the acid arm to (x, z), landing in `tf` seconds; a ring there till it does. */
  private lob(x: number, z: number, r: number, tf: number, life = 6, ring = true): void {
    const from = this.boss.muzzle(0);
    const y = groundY(x, z);
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
        tr.stage = 'fall';
        tr.t = 0;
        // Dragged toward the big one; it lies across the way it's dragged
        tr.dir.set(b.at.x - tr.from.x, 0, b.at.z - tr.from.z).normalize();
        tr.to.copy(b.at).addScaledVector(tr.dir, -4.5);
        this.treeCols[tr.i].disabled = true;
        this.allCols = [];
        this.ctx.audio.wallCollapse();
        this.shake = Math.max(this.shake, 0.6);
        this.particles.dust(tr.from.clone(), 3);
      }
    } else if (tr.stage === 'fall') {
      // Over toward the big one, the crown swinging down sideways
      const k = smooth(tr.t / 0.45);
      const yaw = Math.atan2(tr.dir.x, tr.dir.z);
      g.rotation.set(0, 0, 0);
      g.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, k * Math.PI * 0.5)));
      g.position.y = groundY(tr.from.x, tr.from.z) + k * 0.35;
      T.tip.copy(tr.from).add(V(0, 2.2 * (1 - k) + 0.4 * k, 0));
      T.len = T.tip.distanceTo(T.from);
      if (tr.t > 0.45) {
        tr.stage = 'drag';
        tr.t = 0;
        // Round it, the way that brings it to him soonest
        const a0 = Math.atan2(tr.from.x - b.at.x, tr.from.z - b.at.z);
        const ap = Math.atan2(this.player.position.x - b.at.x, this.player.position.z - b.at.z);
        tr.dir.set(a0, Math.sin(ap - a0) >= 0 ? 1 : -1, Math.min(14, Math.hypot(tr.from.x - b.at.x, tr.from.z - b.at.z)));
        this.treeR = tr.dir.z;
        this.ctx.audio.bigEngineDrive(5, 0);
      }
    } else {
      // Swung round and round it on the end of the tongue, trailing; the circle drawing in and out
      // (tr.dir holds: x the angle it started at, y the way round, z the radius it started at)
      const enraged = b.hp < b.maxHp * 0.5;
      const w = (enraged ? 1.55 : 1.2) * Math.min(1, tr.t / 0.8);
      const turn = tr.dir.x + tr.dir.y * (tr.t * w - (w * Math.min(tr.t, 0.8)) / 2);
      // Out to where he is, give or take, so it comes round through him
      const pd = Math.hypot(this.player.position.x - b.at.x, this.player.position.z - b.at.z);
      this.treeR += (THREE.MathUtils.clamp(pd, 6, 18) - this.treeR) * Math.min(1, dt * 0.8);
      const R = THREE.MathUtils.lerp(tr.dir.z, this.treeR + 2.5 * Math.sin(tr.t * 0.9), Math.min(1, tr.t / 1.2));
      const base = V(b.at.x + Math.sin(turn) * R, 0, b.at.z + Math.cos(turn) * R);
      base.y = groundY(base.x, base.z) + 0.35;
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
      const lowEnough = pp.y - groundY(pp.x, pp.z) < (behind > 3.2 ? 1.6 : 0.85);
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

  /** Lifted off his feet on the tongue and turned to face its mouth, which opens wide. */
  private startEat(): void {
    const p = this.player;
    this.grabbed = false;
    this.hud.setPrompt(null);
    p.stunned = true;
    p.cinematic = true;
    p.velocity.set(0, 0, 0);
    this.eating = { t: 0, from: p.camera.position.clone(), done: false };
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
    e.t += dt;
    const t = e.t;
    // Its mouth, and the way it faces
    const M = b.mouthCore.getWorldPosition(new THREE.Vector3());
    const C = b.body.getWorldPosition(new THREE.Vector3());
    const F = M.clone().sub(C).normalize();
    const lipFront = M.clone().addScaledVector(F, 1.7);
    const throat = M.clone().addScaledVector(F, -0.5);
    let eye: THREE.Vector3;
    if (t < 1.4) {
      // Up off the ground and round to face it, the mouth stretching open
      const k = smooth(t / 1.4);
      eye = e.from.clone().lerp(lipFront, k);
      eye.y += Math.sin(k * Math.PI) * 0.7;
      b.gape = k;
      this.shake = Math.max(this.shake, 0.15);
    } else {
      // In past the lips, into the dark
      const k = smooth((t - 1.4) / 0.55);
      eye = lipFront.clone().lerp(throat, k);
      b.gape = t < 1.9 ? 1 : Math.max(0, 1 - (t - 1.9) * 7);
    }
    if (this.eatFade) this.eatFade.style.opacity = String(Math.min(1, smooth((t - 1.35) / 0.5)));
    // Where he is, and looking straight into it
    const look = (t < 1.4 ? M : throat.clone().addScaledVector(F, -2)).clone().sub(eye);
    p.position.copy(eye).add(V(0, -p.eyeHeight, 0));
    p.yaw = Math.atan2(-look.x, -look.z);
    p.pitch = Math.atan2(look.y, Math.hypot(look.x, look.z));
    T.tip.copy(eye).add(V(0, -0.45, 0));
    T.len = T.tip.distanceTo(T.from);
    // The jaws close
    if (!e.done && t >= 1.9) {
      e.done = true;
      this.ctx.audio.houndBite(0);
      this.ctx.audio.squelchPop();
      this.ctx.audio.bodyThud(0);
      this.later(0.12, () => this.ctx.audio.houndBite(0));
      this.later(0.3, () => this.ctx.audio.giantRoar(0.6, 2));
      this.shake = Math.max(this.shake, 1.4);
      this.drops.burst(M.clone(), F.clone().setY(0.4), 40, 3.5, BOSS_BLOOD);
      this.retract(T);
      // Dead where he is, in it: no body left lying on the ground
      p.deathHandler = { begin: () => true, update: () => {} };
      p.kill(BOSS_NAME, M);
    }
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
        if (y < groundY(x, z)) {
          let lo = prev;
          let hi = tt;
          for (let k = 0; k < 8; k++) {
            const m = (lo + hi) / 2;
            if (o.y + dir.y * m < groundY(o.x + dir.x * m, o.z + dir.z * m)) hi = m;
            else lo = m;
          }
          const pt = o.clone().addScaledVector(dir, hi);
          const e = 0.3;
          const n = V(groundY(pt.x - e, pt.z) - groundY(pt.x + e, pt.z), 2 * e, groundY(pt.x, pt.z - e) - groundY(pt.x, pt.z + e)).normalize();
          best = { dist: hi, point: pt, normal: n, kind: 'terrain' };
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
        const gy = groundY(t.x, t.z);
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
      const c = this.raycaster.intersectObjects(targets, false)[0];
      if (c) {
        const hound = c.object.userData.hound as Hound | undefined;
        const trap = c.object.userData.trap as MawTrap | undefined;
        best = {
          dist: c.distance,
          point: c.point.clone(),
          normal: dir.clone().negate(),
          kind: hound ? 'hound' : trap ? 'trap' : c.object.userData.tongue ? 'tongue' : 'boss',
          hound,
          trap,
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
      p.y = Math.max(p.y, groundY(p.x, p.z) + 0.75);
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
      const gy = groundY(f.position.x, f.position.z) + 0.14;
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
    if (!this.caveHinted && this.player.position.z < CAVE_MOUTH_Z + 4 && this.phase === 'play') {
      this.caveHinted = true;
      this.hint(on ? 'THE SIGNAL IS COMING FROM INSIDE' : 'THE PORTAL IS DEAD — SOMETHING HAS TO WAKE IT', 6);
    }
    if (!on || this.phase !== 'play' || !this.player.alive) return;
    const d = Math.hypot(this.player.position.x - P.at.x, this.player.position.z - P.at.z);
    if (d < 2.3) this.finish();
  }

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
    if (c < 2 && this.hasTablet && p.z < CLIFF_Z - 2 && p.y > 3.8) c = 2;
    if (c < 3 && p.z < MASSIF.z0 - 14 && !inLake(p.x, p.z)) c = 3;
    if (c !== this.checkpoint) this.checkpoint = c;
  }

  private updateHints(dt: number): void {
    const p = this.player.position;
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.style.opacity = '0';
    }
    if (this.phase !== 'play') return;
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
    const cave = inCave(p.camera.position.x, p.camera.position.z);
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
    const dark = uw ? 0.5 : cave ? 0.18 : 1;
    this.hemi.intensity += (Level16Scene.HEMI * dark + fl * 2.5 - this.hemi.intensity) * Math.min(1, dt * 8 + fl);
    this.moon.intensity += (Level16Scene.MOON * (cave ? 0 : uw ? 0.3 : 1) + fl * 4 - this.moon.intensity) * Math.min(1, dt * 8 + fl);
    L.sky.uniforms.uFlash.value = fl;
    const lampWant = (uw || cave) && p.alive ? 1 : 0;
    this.lampOn += (lampWant - this.lampOn) * Math.min(1, dt * 4);
    this.lamp.intensity = 70 * this.lampOn;
    this.underLoop?.set(uw ? 1 : 0);
    L.water.uniforms.uT.value = this.t;
    L.water.uniforms.fogColor.value.copy(fog.color);
    L.water.uniforms.fogDensity.value = fog.density;
    L.sky.uniforms.uT.value = this.t;
    for (const [i, s] of L.specimens.entries()) s.rotation.y = Math.sin(this.t * 0.4 + i) * 0.4;
    L.glowMats.forEach((m, i) => (m.emissiveIntensity = (m.userData.base ??= m.emissiveIntensity) * (0.75 + 0.25 * Math.sin(this.t * (0.8 + i * 0.3) + i))));
    const px = p.camera.position.x;
    const pz = p.camera.position.z;
    for (const c of L.chunks) {
      const s = c.mesh.boundingSphere;
      if (!s) continue;
      const d = Math.hypot(s.center.x - px, s.center.z - pz) - s.radius;
      c.mesh.visible = d < 150 && (c.lod === 'any' || (c.lod === 'near' ? d < 26 : d >= 26));
    }
    L.cave.visible = pz < -100;
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

  private intro: { t: number; alpha: Hound; pack: { h: Hound; from: THREE.Vector3; to: THREE.Vector3 }[]; q0: THREE.Quaternion } | null = null;
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
    const top = V(HILL.x, groundY(HILL.x, HILL.z), HILL.z);
    const toward = V(p.position.x - top.x, 0, p.position.z - top.z).normalize();
    const away = toward.clone().negate();
    const side = V(-toward.z, 0, toward.x);
    // The big one on the crest, facing him
    const alpha = new Hound();
    alpha.group.scale.setScalar(1.8);
    alpha.hp = 9;
    const at = top.clone().addScaledVector(toward, 0.8);
    alpha.group.position.set(at.x, groundY(at.x, at.z), at.z);
    alpha.yaw = Math.atan2(toward.x, toward.z);
    alpha.group.rotation.y = alpha.yaw;
    alpha.state = 'lurk';
    alpha.stateT = -1e9;
    this.scene.add(alpha.group);
    this.hounds.push(alpha);
    this.houndHits.push(...alpha.hitboxes);
    // Five more behind the hill, out of sight, to come up over it
    const pack: { h: Hound; from: THREE.Vector3; to: THREE.Vector3 }[] = [];
    for (let i = 0; i < 5; i++) {
      const h = new Hound();
      const lat = (i - 2) * 2.2 + (i % 2 ? 0.6 : -0.6);
      const to = top.clone().addScaledVector(away, 1.6 + (i % 2) * 0.8).addScaledVector(side, lat);
      const from = to.clone().addScaledVector(away, 7);
      h.group.position.set(from.x, groundY(from.x, from.z), from.z);
      h.yaw = alpha.yaw;
      h.group.rotation.y = h.yaw;
      h.state = 'lurk';
      h.stateT = -1e9;
      this.scene.add(h.group);
      this.hounds.push(h);
      this.houndHits.push(...h.hitboxes);
      pack.push({ h, from, to });
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
    const look = a.group.position.clone().add(V(0, 0.95 * a.group.scale.x, 0));
    const qLook = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cam.position, look, V(0, 1, 0)));
    cam.quaternion.copy(I.q0).slerp(qLook, smooth(t / 1.2));
    // Zoom in on it; out again as they come
    const fov = 74 - 58 * smooth((t - 1.0) / 1.8) * (1 - smooth((t - 5.6) / 0.5));
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    // It stands there; its mouth working, the head lifting
    a.speed = 0;
    if (t > 2.0 && t - dt <= 2.0) this.ctx.audio.houndScreech(6);
    if (t > 2.6 && t - dt <= 2.6) this.lightning(1);
    // The others up over the crest behind it
    I.pack.forEach((m, i) => {
      const k = smooth((t - 3.0 - i * 0.32) / 1.3);
      const g = m.h.group.position;
      g.lerpVectors(m.from, m.to, k);
      g.y = groundY(g.x, g.z);
      m.h.speed = k > 0 && k < 1 ? 3 : 0;
      if (k > 0.5 && t - dt < 3.0 + i * 0.32 + 0.66 && t >= 3.0 + i * 0.32 + 0.66 && i % 2 === 0) this.ctx.audio.houndScreech(14);
    });
    if (t > 5.3 && t - dt <= 5.3) {
      a.state = 'lunge';
      this.ctx.audio.houndScreech(2);
      this.shake = Math.max(this.shake, 0.5);
    }
    if (t > 6.1) this.endIntro();
  }

  private endIntro(): void {
    const I = this.intro;
    if (!I) return;
    this.intro = null;
    for (const m of I.pack) {
      m.h.group.position.copy(m.to).setY(groundY(m.to.x, m.to.z));
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

  private restart(): void {
    this.ctx.bus.emit(Events.RestartLevel16, { checkpoint: this.checkpoint });
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}
