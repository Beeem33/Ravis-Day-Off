import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Collider } from '../environment/OfficeLevelBuilder';
import { CAR_SPECS, WRECK_COLOURS, bakedCar, carMaterials } from '../environment/VehicleProps';
import type { ParticleManager } from '../fx/ParticleManager';
import type { AudioManager } from '../core/AudioManager';
import type { FPSPlayer } from './FPSPlayer';
import type {
  BakedCar,
  CarKind,
  CarSpec,
  CarState,
  CrushInfo,
  ICarSystem,
  ImpactInfo,
  ParkedSlot,
  PileSlot,
  ThrowKind
} from '../scenes/Level8Contracts';

/**
 * CarSystem — every car in the Level 8 fight: the parked rows Ravi hides
 * behind, the General's scrap pile, the one in his hands, the ones in the air
 * and the ones lying where they came down.
 *
 * Each car is three things kept in step:
 *
 *  - a cannon-es DYNAMIC body, a compound of the car's two CarSpec boxes
 *    (lower body, cabin). Its origin is the car's centre of mass, not the
 *    car-local ground origin every model and every caller talks in, so each
 *    car keeps `com` — the body origin in the car-local frame — and every
 *    conversion goes through it: ground origin = body position − R·com.
 *  - one instance in each of four InstancedMeshes per (kind, wrecked) set —
 *    paint (instance colour), trim, glass, lamps — so sixty-odd cars are a
 *    couple of dozen draws, plus an instanced blob shadow under every car.
 *  - what the rest of the game sees: AABB Colliders for the player (pushed
 *    into level.colliders once, rewritten in place, toggled with .disabled —
 *    never spliced, because other code holds collider indices) and an
 *    invisible box mesh per car box for bullets and AI sight lines.
 *
 * The player is not a cannon body, so a car can't physically hit him: the
 * crush test is ours, run after the scene's world.step, and the scene decides
 * what a crush costs him. Everything here is written to allocate nothing per
 * frame except on rare events (an impact, a crush, a recycle).
 */

// ----------------------------------------------------------------- tuning

/** A wreck's cabin is crushed to a bit over half its height (VehicleProps' crush squashes it to 0.42–0.58). */
const WRECK_CABIN = 0.55;
/**
 * Player colliders per car box, cut along the car's length. When a car is
 * square to the axes the pieces tile its box exactly; when one comes to rest
 * at 30° a single AABB would be a fat invisible wall a metre off its flanks,
 * three slices of it hug the car to within a few tens of centimetres.
 */
const SEGMENTS = [3, 2];
const PLAYER_RADIUS = 0.34;

/** Car against the lot: it grips, and two tonnes of steel barely bounce. */
const FRICTION = 0.55;
const RESTITUTION = 0.08;
const LINEAR_DAMPING = 0.05;
const ANGULAR_DAMPING = 0.2;
/** Sleep a little sooner than cannon's default (0.1 m/s for 1 s): a car rocking on its springs is still a car at rest. */
const SLEEP_SPEED = 0.25;
const SLEEP_TIME = 0.6;

/** Below this (and not spinning) a car is solid to the player again. */
const SOLID_SPEED = 1.5;
const SOLID_SPIN = 2;
/** A thrown car is down once it has been slower than this for REST_TIME (or cannon put it to sleep). */
const REST_SPEED = 0.5;
const REST_SPIN = 0.8;
const REST_TIME = 0.5;
/** A parked car shoved further than this (or turned more than REST_TURN) is a different car now: 'resting'. */
const PARKED_SHOVE = 0.35;
const PILE_SHOVE = 0.6;
const REST_TURN = 0.15;

const CRUSH_SPEED = 3;
const CRUSH_COOLDOWN = 0.8;
/** cannon reports one bounce over several steps; one bang per car per this many seconds. */
const IMPACT_GAP = 0.12;
const CRASH_SPEED = 4;
const SCRAPE_SLIDE = 6;
const ALARM_HIT = 5;
const MAX_ALARMS = 2;
/** AudioManager.carAlarm gives up after 12 s on its own. */
const ALARM_LIFE = 12;

const RING_POOL = 4;
const RING_TIMEOUT = 3;
const MIN_PILE = 4;
const RECYCLE_DIST = 25;
const RECYCLE_EVERY = 0.5;
/** Highest a recycled car may be stacked (its ground origin): three wrecks high and no more. */
const RECYCLE_MAX_Y = 3.2;

/**
 * Peak darkening of a blob shadow, as the (linear) colour fed to the
 * multiply blend. The renderer encodes it to sRGB on the way out, so 0.17
 * leaves the ground at about 55% of its brightness under the car.
 */
const SHADOW_K = 0.17;
const SHADOW_FADE_H = 12;

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const SLEEPING = CANNON.Body.SLEEPING;

// Scratch: one of each, shared by every method (none of them re-enter)
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _rot = new THREE.Matrix4();
const _col = new THREE.Color();
const _sphere = new THREE.Sphere();
const _cv = new CANNON.Vec3();
const _cv2 = new CANNON.Vec3();

// ------------------------------------------------------------------ types

interface LocalBox {
  /** Centre and half extents, car-local (ground origin). */
  c: THREE.Vector3;
  h: THREE.Vector3;
}

/** One (kind, wrecked) look: four InstancedMeshes sharing VehicleProps' baked geometry and materials. */
interface VisualSet {
  key: string;
  baked: BakedCar;
  meshes: THREE.InstancedMesh[];
  capacity: number;
  count: number;
  dirty: boolean;
}

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  car: Car | null;
  t: number;
  radius: number;
  phase: number;
}

interface PileHome {
  pos: THREE.Vector3;
  yaw: number;
  roll: number;
  kind: CarKind;
  /** The car lying in it, or -1 when it's free for a recycled one. */
  occupant: number;
}

interface CollideEvent {
  body: CANNON.Body;
  contact: CANNON.ContactEquation;
}

interface Car {
  id: number;
  kind: CarKind;
  wrecked: boolean;
  spec: CarSpec;
  /** The two physics/proxy boxes, car-local (a wreck's cabin crushed down). */
  boxes: LocalBox[];
  /** The player-collider slices of those boxes, car-local, parallel to `colliders`. */
  segs: LocalBox[];
  /** The body origin (centre of mass) in the car-local frame. */
  com: THREE.Vector3;
  body: CANNON.Body;
  listener: (e: CollideEvent) => void;
  state: CarState;
  set: VisualSet;
  slot: number;
  colour: THREE.Color;
  colliders: Collider[];
  proxies: THREE.Mesh[];
  /** Union of its collider boxes, world: kept current whenever the car moves. */
  aabb: THREE.Box3;
  /** Its ground origin and orientation as of the last sync. */
  origin: THREE.Vector3;
  quat: THREE.Quaternion;
  solid: boolean;
  awakeLast: boolean;
  speed: number;
  spin: number;
  slowFor: number;
  flyTime: number;
  /** Shoved hard enough (by a thrown car) that it may not be where it was put. */
  knocked: boolean;
  /** Where it was parked / piled, to tell a nudge from a shove. */
  home: THREE.Vector3;
  homeQ: THREE.Quaternion;
  pileSlot: number;
  /** Has he ever thrown it (only those get recycled). */
  thrown: boolean;
  restSeq: number;
  lastImpact: number;
  lastCrush: number;
  /** world.time before which its contacts make no noise (a recycled car settling onto the pile). */
  quietUntil: number;
  alarmed: boolean;
  ring: Ring | null;
  whooshed: boolean;
}

// ----------------------------------------------------------- the system

export class CarSystem implements ICarSystem {
  onCrush: ((c: CrushInfo) => void) | null = null;
  onImpact: ((i: ImpactInfo) => void) | null = null;
  /**
   * Optional: somewhere a recycled car must not appear (the scene can point
   * this at the General, so a wreck never materialises inside him while he
   * stands at the pile). Not part of ICarSystem; null means anywhere.
   */
  keepClear: { pos: THREE.Vector3; radius: number } | null = null;
  /** No crushing while the scene has Ravi in a cutscene. */
  suspendCrush = false;
  /** When the last few crash sounds started, for the global cap below. */
  private crashTimes: number[] = [];

  private readonly scene: THREE.Scene;
  private readonly world: CANNON.World;
  private readonly level: { colliders: Collider[]; shootables: THREE.Object3D[]; occluders: THREE.Object3D[] };
  private readonly particles: ParticleManager;
  private readonly audio: AudioManager;

  private readonly cars: Car[] = [];
  private readonly byBody = new Map<number, Car>();
  private readonly sets = new Map<string, VisualSet>();
  private readonly mine = new Set<Collider>();
  private readonly pileHomes: PileHome[] = [];

  private readonly carMat = new CANNON.Material('car');
  /** Given to the level's static bodies (which have none), so the car contact material reaches them. */
  private readonly lotMat = new CANNON.Material('lot');

  private readonly shadowGeo: THREE.PlaneGeometry;
  private readonly shadowTex: THREE.CanvasTexture;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private shadows: THREE.InstancedMesh;
  private shadowCap = 0;
  private shadowDirty = false;

  private readonly ringGeo: THREE.BufferGeometry;
  private readonly rings: Ring[] = [];

  private readonly proxyGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

  private readonly alarms: { handle: { stop(): void }; until: number }[] = [];
  private readonly staticTall: Collider[] = [];
  private staticSeen = -1;

  private player: FPSPlayer | null = null;
  private clock = 0;
  private restCounter = 0;
  private recycleTimer = 0;
  /** True while settle() runs the world: no bangs, no dust, no alarms. */
  private quiet = false;
  private disposed = false;

  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();

  constructor(opts: {
    scene: THREE.Scene;
    world: CANNON.World;
    level: { colliders: Collider[]; shootables: THREE.Object3D[]; occluders: THREE.Object3D[] };
    particles: ParticleManager;
    audio: AudioManager;
  }) {
    this.scene = opts.scene;
    this.world = opts.world;
    this.level = opts.level;
    this.particles = opts.particles;
    this.audio = opts.audio;

    // Contact materials. cannon only looks one up when BOTH bodies carry a
    // material, and the level's static bodies (CombatScene.createPhysicsWorld)
    // carry none — so a car-vs-defaultMaterial pair alone would never apply
    // against the ground. The statics get a material of their own, paired
    // only with the car's: every other body (cans, mags, ragdolls) still
    // meets them under the world's default contact, exactly as before.
    const carGround = { friction: FRICTION, restitution: RESTITUTION };
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.carMat, this.world.defaultMaterial, carGround));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.carMat, this.lotMat, carGround));
    // Car on car: panels grind rather than glide, and nothing springs back
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.carMat, this.carMat, { friction: 0.5, restitution: 0.05 }));
    for (const b of this.world.bodies) {
      if (b.type === CANNON.Body.STATIC && !b.material) b.material = this.lotMat;
    }

    // Blob shadows. A multiply blend (dst × (1 − src)) driven entirely by
    // colour, so the per-instance colour can fade each car's shadow on its
    // own — an InstancedMesh has no per-instance opacity. No fog (a fogged
    // source would darken the distant lot), no tone mapping, no depth write.
    this.shadowTex = blobTexture();
    this.shadowGeo = new THREE.PlaneGeometry(1, 1);
    this.shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTex,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
      // Leave the canvas's alpha alone: the colour factor applied to alpha
      // as well zeroed it under every shadow, and the page's black showed
      // through the canvas there — hard black rectangles under the cars
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    this.shadows = this.makeShadowMesh(64);

    // Landing rings: a bold outer band and a thin inner one, so it reads as
    // a target painted on the ground rather than a hoop. Pooled up front so
    // the warm-up compiles them; hidden until a lob is in the air.
    const outer = new THREE.RingGeometry(0.84, 1, 56, 1);
    const inner = new THREE.RingGeometry(0.46, 0.52, 40, 1);
    this.ringGeo = mergeGeometries([outer, inner]) ?? outer;
    if (this.ringGeo !== outer) outer.dispose();
    inner.dispose();
    this.ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff4a1c,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.name = 'landingRing';
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.rings.push({ mesh, mat, car: null, t: 0, radius: 1, phase: i * 1.7 });
    }
  }

  // ------------------------------------------------------------ adding cars

  addParked(slot: ParkedSlot): number {
    const car = this.makeCar(slot.kind, false, slot.colour);
    // A few millimetres up: exactly touching the slab is a contact on the
    // first step, and parked cars should sleep through until something hits them
    _v.set(slot.x, 0.003, slot.z);
    _q.setFromAxisAngle(UP, slot.yaw);
    this.place(car, _v, _q);
    car.state = 'parked';
    car.body.sleep();
    this.syncCar(car);
    car.home.copy(car.origin);
    car.homeQ.copy(car.quat);
    this.setSolid(car, true);
    return car.id;
  }

  addPile(slot: PileSlot): number {
    const colour = WRECK_COLOURS[(this.pileHomes.length * 7 + 3) % WRECK_COLOURS.length];
    const car = this.makeCar(slot.kind, true, colour);
    // Yaw about the vertical, then roll about the car's own length (local Z).
    // Locals, not the shared scratch: syncCar below writes all over that.
    const q = new THREE.Quaternion().setFromAxisAngle(UP, slot.yaw);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), slot.roll));
    const pos = slot.pos.clone();
    this.place(car, pos, q);
    this.syncCar(car);
    // The builder stacks wrecks for a 1.1 m crush; ours keep a bit more cabin
    // (and an SUV's or a pickup's a lot more). Lift each one clear of those
    // already stacked under it, so settle() only ever drops wrecks onto each
    // other and never starts them interpenetrating — which would fire them apart.
    const lift = this.liftClear(car);
    if (lift > 0) {
      pos.y += lift;
      this.place(car, pos, q);
      this.syncCar(car);
    }
    car.state = 'pile';
    car.body.sleep();
    car.home.copy(car.origin);
    car.homeQ.copy(car.quat);
    car.pileSlot = this.pileHomes.length;
    this.pileHomes.push({ pos: slot.pos.clone(), yaw: slot.yaw, roll: slot.roll, kind: slot.kind, occupant: car.id });
    this.setSolid(car, true);
    return car.id;
  }

  /**
   * Run the world quietly so the pile's wrecks come to rest on each other,
   * then put every car to sleep. Parked cars stay asleep throughout: they
   * stand square on the ground already, and keeping them still keeps their
   * axis-aligned colliders exact.
   */
  settle(): void {
    this.quiet = true;
    for (const car of this.cars) if (car.state === 'pile') car.body.wakeUp();
    for (let i = 0; i < 150; i++) {
      this.world.step(1 / 60);
      // A wreck the builder left touching its neighbour gets shoved apart by
      // the solver; keep that a nudge, not a launch
      for (const car of this.cars) {
        if (car.state !== 'pile') continue;
        clampVec(car.body.velocity, 2);
        clampVec(car.body.angularVelocity, 2);
      }
    }
    for (const car of this.cars) {
      if (car.state === 'held') continue;
      car.body.sleep();
      this.syncCar(car);
      car.home.copy(car.origin);
      car.homeQ.copy(car.quat);
      car.awakeLast = false;
      car.knocked = false;
      this.setSolid(car, true);
    }
    this.flush();
    this.quiet = false;
  }

  // ---------------------------------------------------- the General's side

  throwableNear(from: THREE.Vector3, range: number): { id: number; at: THREE.Vector3; yaw: number } | null {
    let best: Car | null = null;
    let bestScore = Infinity;
    for (const car of this.cars) {
      if (car.state !== 'pile' && car.state !== 'parked' && car.state !== 'resting') continue;
      // Still rolling from a hit: not something to put his hands on yet
      if (car.speed > 1) continue;
      const d = Math.hypot(car.origin.x - from.x, car.origin.z - from.z);
      if (d > range) continue;
      // Never pull one out from under another
      if (this.covered(car)) continue;
      // Among the pile, the higher the better (he takes them off the top)
      const score = d - (car.state === 'pile' ? 0.6 * car.origin.y : 0);
      if (score < bestScore) {
        bestScore = score;
        best = car;
      }
    }
    if (!best) return null;
    return { id: best.id, at: this.roofPoint(best, new THREE.Vector3()), yaw: this.yawOf(best) };
  }

  grab(id: number): void {
    const car = this.cars[id];
    if (!car || car.state === 'held') return;
    // Anything resting on it would be left hanging asleep in mid-air
    this.wakeAbove(car);
    this.freePileSlot(car);
    this.releaseRing(car);
    car.state = 'held';
    car.knocked = false;
    // Out of the collisions altogether (a zero filter never even reaches the
    // broadphase's pair list): it is a prop in his hands until launch()
    const b = car.body;
    b.type = CANNON.Body.KINEMATIC;
    b.collisionFilterGroup = 0;
    b.collisionFilterMask = 0;
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.allowSleep = false;
    b.wakeUp();
    this.setSolid(car, false);
  }

  hold(id: number, m: THREE.Matrix4): void {
    const car = this.cars[id];
    if (!car || car.state !== 'held') return;
    // m is the car-local ground origin; the body sits at its centre of mass.
    // Any scale in m (his hands are on a scaled rig) is dropped.
    m.decompose(_v, _q, _v2);
    _v3.copy(car.com).applyQuaternion(_q);
    const b = car.body;
    b.position.set(_v.x + _v3.x, _v.y + _v3.y, _v.z + _v3.z);
    b.quaternion.set(_q.x, _q.y, _q.z, _q.w);
    b.aabbNeedsUpdate = true;
  }

  launch(id: number, vel: THREE.Vector3, spin: THREE.Vector3, kind: ThrowKind, aim: THREE.Vector3): void {
    const car = this.cars[id];
    if (!car || car.state !== 'held') return;
    const b = car.body;
    b.type = CANNON.Body.DYNAMIC;
    b.collisionFilterGroup = 1;
    b.collisionFilterMask = -1;
    b.allowSleep = true;
    b.velocity.set(vel.x, vel.y, vel.z);
    b.angularVelocity.set(spin.x, spin.y, spin.z);
    // No damping in the air: the General's sums are plain ballistics, and the
    // resting damping (a few percent a second) put every lob metres short
    b.linearDamping = 0;
    b.angularDamping = 0.02;
    b.updateInertiaWorld(true);
    b.aabbNeedsUpdate = true;
    b.wakeUp();
    car.state = 'flying';
    car.thrown = true;
    car.flyTime = 0;
    car.slowFor = 0;
    car.speed = vel.length();
    car.spin = spin.length();
    car.whooshed = false;
    if (kind === 'lob') this.showRing(car, aim);
    // The whoosh is a fly-by (it sweeps up as it comes and down as it goes),
    // so it plays when the car is close to Ravi — here if he is already near
    // the General, otherwise on the way (see update)
    const d = this.playerDist(car.origin);
    if (d < 12) {
      this.audio.carWhoosh(d);
      car.whooshed = true;
    }
  }

  state(id: number): CarState {
    return this.cars[id]?.state ?? 'resting';
  }

  position(id: number, out: THREE.Vector3): THREE.Vector3 {
    const car = this.cars[id];
    if (!car) return out.set(0, 0, 0);
    const b = car.body;
    _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    _v.copy(car.com).applyQuaternion(_q);
    return out.set(b.position.x - _v.x, b.position.y - _v.y, b.position.z - _v.z);
  }

  /**
   * Is the segment a→b free of cars and solid cover? Slab tests against every
   * enabled car collider and the level's static colliders taller than 0.9 m
   * (kerbs, the ground slab and bay islands don't stop a car in flight).
   */
  clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    for (const car of this.cars) {
      if (!car.solid) continue;
      if (!segHitsBox(a, dx, dy, dz, car.aabb)) continue;
      for (const c of car.colliders) {
        if (!c.disabled && segHitsBox(a, dx, dy, dz, c.box)) return false;
      }
    }
    this.refreshStatic();
    for (const c of this.staticTall) {
      if (!c.disabled && segHitsBox(a, dx, dy, dz, c.box)) return false;
    }
    return true;
  }

  /**
   * Set off the alarms of up to `max` parked cars near `pos` (the General
   * going down shakes the whole lot). Not part of ICarSystem: a convenience
   * for the scene, sharing the two-at-once limit and the handles dispose stops.
   */
  alarmsNear(pos: THREE.Vector3, radius: number, max = MAX_ALARMS): void {
    let started = 0;
    for (const car of this.cars) {
      if (started >= max) break;
      if (car.state !== 'parked' || car.wrecked || car.alarmed) continue;
      if (Math.hypot(car.origin.x - pos.x, car.origin.z - pos.z) > radius) continue;
      if (this.startAlarm(car)) started++;
    }
  }

  // ---------------------------------------------------------------- frame

  /**
   * After the scene's world.step (and after whatever calls hold() this
   * frame): draw the cars where their bodies are, keep the player colliders
   * and the bullet proxies on them, and run the crush test.
   */
  update(dt: number, player: FPSPlayer, camera: THREE.Camera): void {
    if (this.disposed) return;
    this.player = player;
    this.clock += dt;

    for (const car of this.cars) {
      const b = car.body;
      const held = car.state === 'held';
      const awake = held || b.sleepState !== SLEEPING;
      // One more sync the frame after it falls asleep: its last step's pose
      const moved = awake || car.awakeLast;
      car.awakeLast = awake;
      if (moved) {
        if (!held && b.position.y < -4) this.rescue(car);
        this.syncCar(car);
      }
      if (held || !awake) {
        car.speed = 0;
        car.spin = 0;
      } else {
        car.speed = b.velocity.length();
        car.spin = b.angularVelocity.length();
      }
      if (held) continue;

      // Solid to the player only once it's slow and he isn't inside it —
      // FPSPlayer resolves an overlap by lifting him onto the box's top, so a
      // collider switched on around him would stand him on the roof
      if (car.speed >= SOLID_SPEED || car.spin >= SOLID_SPIN) {
        if (car.solid) this.setSolid(car, false);
      } else if (!car.solid) {
        if (!this.overlapsPlayer(car)) this.setSolid(car, true);
      } else if (moved && this.overlapsPlayer(car)) {
        // Crept into him at walking pace: let go until he steps out of it
        this.setSolid(car, false);
      }

      // Coming to rest
      if (awake) {
        if (car.speed < REST_SPEED && car.spin < REST_SPIN) car.slowFor += dt;
        else car.slowFor = 0;
      }
      const settled = !awake || car.slowFor >= REST_TIME;
      if (car.state === 'flying') {
        car.flyTime += dt;
        if (settled && car.flyTime > 0.3) this.toResting(car);
        else if (!car.whooshed && car.speed > 6) {
          const d = this.playerDist(car.origin);
          if (d < Math.max(9, car.speed * 0.45)) {
            this.audio.carWhoosh(d);
            car.whooshed = true;
          }
        }
      } else if (car.state === 'parked' || car.state === 'pile') {
        if (awake && car.speed > SOLID_SPEED) car.knocked = true;
        if (car.knocked && settled) {
          car.knocked = false;
          const moveLimit = car.state === 'pile' ? PILE_SHOVE : PARKED_SHOVE;
          if (car.origin.distanceTo(car.home) > moveLimit || car.quat.angleTo(car.homeQ) > REST_TURN) {
            this.toResting(car);
          } else if (car.state === 'pile') {
            // Rocked and settled back: this is where it lies now
            car.home.copy(car.origin);
            car.homeQ.copy(car.quat);
          }
        }
      }
    }

    // The scene says when a cutscene has him (not player.cinematic, which the
    // drop kick sets too — a kick under a falling car must not be a shield)
    if (player.alive && !this.suspendCrush) this.crushChecks(player);
    this.updateRings(dt);
    this.recycleTimer -= dt;
    if (this.recycleTimer <= 0) {
      this.recycleTimer = RECYCLE_EVERY;
      this.recycle(camera);
    }
    this.pruneAlarms();
    this.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const a of this.alarms) a.handle.stop();
    this.alarms.length = 0;
    for (const car of this.cars) {
      car.body.removeEventListener('collide', car.listener);
      this.world.removeBody(car.body);
      for (const c of car.colliders) c.disabled = true;
      for (const p of car.proxies) {
        const i = this.level.shootables.indexOf(p);
        if (i >= 0) this.level.shootables.splice(i, 1);
        const j = this.level.occluders.indexOf(p);
        if (j >= 0) this.level.occluders.splice(j, 1);
      }
    }
    this.byBody.clear();
    // Our InstancedMeshes; the geometry and materials in them are VehicleProps' (shared, cached) and stay
    for (const set of this.sets.values()) {
      for (const m of set.meshes) {
        this.scene.remove(m);
        m.dispose();
      }
      set.meshes.length = 0;
    }
    this.scene.remove(this.shadows);
    this.shadows.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.shadowTex.dispose();
    for (const r of this.rings) {
      this.scene.remove(r.mesh);
      r.mat.dispose();
    }
    this.ringGeo.dispose();
    this.proxyGeo.dispose();
    this.proxyMat.dispose();
  }

  // ------------------------------------------------------------- building

  private makeCar(kind: CarKind, wrecked: boolean, colour: number): Car {
    const spec = CAR_SPECS[kind];
    const boxes: LocalBox[] = spec.boxes.map((b) => ({
      c: new THREE.Vector3(b.c[0], b.c[1], b.c[2]),
      h: new THREE.Vector3(b.h[0], b.h[1], b.h[2])
    }));
    if (wrecked && boxes.length > 1) {
      // The roof is caved in: the cabin box comes down with it, sitting on the belt
      const belt = boxes[0].c.y + boxes[0].h.y;
      boxes[1].h.y *= WRECK_CABIN;
      boxes[1].c.y = belt + boxes[1].h.y;
    }

    // Centre of mass: the lower body is the car (engine, floorpan, axles),
    // the cabin mostly air and glass — weight it at a third by volume. It
    // lands a little above the axles, which is where a real one is, and a
    // low centre of mass is what makes a thrown car tumble believably.
    const com = new THREE.Vector3();
    let wSum = 0;
    boxes.forEach((b, i) => {
      const w = b.h.x * b.h.y * b.h.z * (i === 0 ? 1 : 0.33);
      com.addScaledVector(b.c, w);
      wSum += w;
    });
    com.multiplyScalar(1 / (wSum || 1));
    com.x = 0;

    // The shapes go on while the body is still at the identity pose: cannon
    // approximates the inertia from the body's WORLD AABB at addShape time,
    // so a body already turned a quarter round would get its axes swapped
    const body = new CANNON.Body({
      mass: spec.mass,
      material: this.carMat,
      linearDamping: LINEAR_DAMPING,
      angularDamping: ANGULAR_DAMPING,
      allowSleep: true,
      sleepSpeedLimit: SLEEP_SPEED,
      sleepTimeLimit: SLEEP_TIME
    });
    for (const b of boxes) {
      body.addShape(new CANNON.Box(new CANNON.Vec3(b.h.x, b.h.y, b.h.z)), new CANNON.Vec3(b.c.x - com.x, b.c.y - com.y, b.c.z - com.z));
    }

    const id = this.cars.length;
    const set = this.setFor(kind, wrecked);
    const slot = this.claimSlot(set);
    const col = new THREE.Color(colour);
    set.meshes[0].setColorAt(slot, col);
    if (set.meshes[0].instanceColor) set.meshes[0].instanceColor.needsUpdate = true;

    // Player colliders: each box cut into slices along its length
    const segs: LocalBox[] = [];
    const colliders: Collider[] = [];
    boxes.forEach((b, k) => {
      const n = SEGMENTS[k] ?? 1;
      for (let i = 0; i < n; i++) {
        const hz = b.h.z / n;
        segs.push({
          c: new THREE.Vector3(b.c.x, b.c.y, b.c.z - b.h.z + hz * (2 * i + 1)),
          h: new THREE.Vector3(b.h.x, b.h.y, hz)
        });
        const c: Collider = { box: new THREE.Box3(), disabled: true };
        colliders.push(c);
        this.mine.add(c);
        // Pushed once, never spliced: other code keeps collider indices
        this.level.colliders.push(c);
      }
    });

    // Bullet proxies: invisible boxes (raycasting ignores visibility). Kept
    // out of the scene graph — nothing ever needs to draw them, and the
    // warm-up would otherwise force them visible for a frame — and their
    // matrixWorld kept current by hand after every move.
    const proxies = boxes.map((b) => {
      const p = new THREE.Mesh(this.proxyGeo, this.proxyMat);
      p.visible = false;
      p.scale.set(b.h.x * 2, b.h.y * 2, b.h.z * 2);
      p.userData.surface = 'metal';
      // It gets thrown: a bullet hole or a splash of blood left on it would hang in the air where it had been
      p.userData.noDecal = true;
      p.userData.carId = id;
      this.level.shootables.push(p);
      this.level.occluders.push(p);
      return p;
    });

    this.ensureShadows(id + 1);

    const car: Car = {
      id,
      kind,
      wrecked,
      spec,
      boxes,
      segs,
      com,
      body,
      listener: () => {},
      state: 'parked',
      set,
      slot,
      colour: col,
      colliders,
      proxies,
      aabb: new THREE.Box3(),
      origin: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      solid: false,
      awakeLast: false,
      speed: 0,
      spin: 0,
      slowFor: 0,
      flyTime: 0,
      knocked: false,
      home: new THREE.Vector3(),
      homeQ: new THREE.Quaternion(),
      pileSlot: -1,
      thrown: false,
      restSeq: 0,
      lastImpact: -1,
      lastCrush: -10,
      quietUntil: 0,
      alarmed: false,
      ring: null,
      whooshed: false
    };
    car.listener = (e: CollideEvent) => this.onCollide(car, e);
    body.addEventListener('collide', car.listener);
    this.world.addBody(body);
    this.byBody.set(body.id, car);
    this.cars.push(car);
    return car;
  }

  /** Put a car's ground origin at `pos` with orientation `q` (the body goes to origin + q·com). */
  private place(car: Car, pos: THREE.Vector3, q: THREE.Quaternion): void {
    _v3.copy(car.com).applyQuaternion(q);
    const b = car.body;
    b.position.set(pos.x + _v3.x, pos.y + _v3.y, pos.z + _v3.z);
    b.quaternion.set(q.x, q.y, q.z, q.w);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.aabbNeedsUpdate = true;
    b.updateInertiaWorld(true);
  }

  private setFor(kind: CarKind, wrecked: boolean): VisualSet {
    const key = `${kind}${wrecked ? ':wreck' : ''}`;
    let set = this.sets.get(key);
    if (!set) {
      set = { key, baked: bakedCar(kind, wrecked), meshes: [], capacity: 0, count: 0, dirty: true };
      this.sets.set(key, set);
    }
    return set;
  }

  private claimSlot(set: VisualSet): number {
    if (set.count >= set.capacity) this.growSet(set, Math.max(8, set.capacity * 2));
    const slot = set.count++;
    for (const m of set.meshes) m.count = set.count;
    return slot;
  }

  /**
   * (Re)make a set's InstancedMeshes with room for `cap` cars, carrying the
   * matrices and colours over. Cars are all added at load, before the first
   * render, so a grow costs nothing on the GPU: what gets uploaded and
   * compiled (in the warm-up) is only ever the final set.
   */
  private growSet(set: VisualSet, cap: number): void {
    const mats = carMaterials();
    const parts: [THREE.BufferGeometry, THREE.Material][] = [
      [set.baked.paint, mats.paint],
      [set.baked.trim, mats.trim],
      [set.baked.glass, mats.glass],
      [set.baked.lamps, mats.lamps]
    ];
    const next = parts.map(([g, mat], i) => {
      const m = new THREE.InstancedMesh(g, mat, cap);
      m.name = `cars ${set.key} ${['paint', 'trim', 'glass', 'lamps'][i]}`;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Thrown cars fly anywhere; the set's bounds would be stale the moment one moved
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      const old = set.meshes[i];
      if (old) (m.instanceMatrix.array as Float32Array).set((old.instanceMatrix.array as Float32Array).subarray(0, set.count * 16));
      return m;
    });
    // Paint takes the instance colour
    const paint = next[0];
    const colours = new Float32Array(cap * 3).fill(1);
    const oldColour = set.meshes[0]?.instanceColor;
    if (oldColour) colours.set((oldColour.array as Float32Array).subarray(0, set.count * 3));
    paint.instanceColor = new THREE.InstancedBufferAttribute(colours, 3);
    for (const m of set.meshes) {
      this.scene.remove(m);
      m.dispose();
    }
    for (const m of next) {
      m.count = set.count;
      this.scene.add(m);
    }
    set.meshes = next;
    set.capacity = cap;
    set.dirty = true;
  }

  private makeShadowMesh(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.shadowGeo, this.shadowMat, cap);
    m.name = 'carShadows';
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.renderOrder = 1;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    this.shadowCap = cap;
    return m;
  }

  private ensureShadows(n: number): void {
    if (n > this.shadowCap) {
      const old = this.shadows;
      const next = this.makeShadowMesh(Math.max(n, this.shadowCap * 2));
      (next.instanceMatrix.array as Float32Array).set((old.instanceMatrix.array as Float32Array).subarray(0, old.count * 16));
      if (old.instanceColor && next.instanceColor) {
        (next.instanceColor.array as Float32Array).set((old.instanceColor.array as Float32Array).subarray(0, old.count * 3));
      }
      this.scene.remove(old);
      old.dispose();
      this.shadows = next;
    }
    if (!this.shadows.parent) this.scene.add(this.shadows);
    this.shadows.count = Math.max(this.shadows.count, n);
  }

  // ------------------------------------------------------------- syncing

  /** Everything that follows a car — its instances, colliders, proxies and shadow — from its body. */
  private syncCar(car: Car): void {
    const b = car.body;
    const q = car.quat.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    _v.copy(car.com).applyQuaternion(q);
    const o = car.origin.set(b.position.x - _v.x, b.position.y - _v.y, b.position.z - _v.z);

    _m.compose(o, q, ONE);
    for (const m of car.set.meshes) m.setMatrixAt(car.slot, _m);
    car.set.dirty = true;

    // Column-major: R·v = (e0 x + e4 y + e8 z, e1 x + e5 y + e9 z, e2 x + e6 y + e10 z)
    const e = _rot.makeRotationFromQuaternion(q).elements;
    car.aabb.makeEmpty();
    car.segs.forEach((s, i) => {
      const cx = o.x + e[0] * s.c.x + e[4] * s.c.y + e[8] * s.c.z;
      const cy = o.y + e[1] * s.c.x + e[5] * s.c.y + e[9] * s.c.z;
      const cz = o.z + e[2] * s.c.x + e[6] * s.c.y + e[10] * s.c.z;
      const hx = Math.abs(e[0]) * s.h.x + Math.abs(e[4]) * s.h.y + Math.abs(e[8]) * s.h.z;
      const hy = Math.abs(e[1]) * s.h.x + Math.abs(e[5]) * s.h.y + Math.abs(e[9]) * s.h.z;
      const hz = Math.abs(e[2]) * s.h.x + Math.abs(e[6]) * s.h.y + Math.abs(e[10]) * s.h.z;
      const box = car.colliders[i].box;
      box.min.set(cx - hx, cy - hy, cz - hz);
      box.max.set(cx + hx, cy + hy, cz + hz);
      car.aabb.union(box);
    });

    car.boxes.forEach((bx, i) => {
      const p = car.proxies[i];
      p.position.set(
        o.x + e[0] * bx.c.x + e[4] * bx.c.y + e[8] * bx.c.z,
        o.y + e[1] * bx.c.x + e[5] * bx.c.y + e[9] * bx.c.z,
        o.z + e[2] * bx.c.x + e[6] * bx.c.y + e[10] * bx.c.z
      );
      p.quaternion.copy(q);
      // The bullet raycast reads matrixWorld; parentless, so this is all it takes
      p.updateMatrixWorld(true);
    });

    this.placeShadow(car, e);
  }

  /**
   * The blob under a car: centred under its lower body, turned to its length,
   * sized to its footprint as seen from above, shrinking and fading as it
   * rises — so a car coming down shows where it will land, darkening and
   * tightening as it drops.
   */
  private placeShadow(car: Car, e: ArrayLike<number>): void {
    const b0 = car.boxes[0];
    const o = car.origin;
    const cx = o.x + e[0] * b0.c.x + e[4] * b0.c.y + e[8] * b0.c.z;
    const cz = o.z + e[2] * b0.c.x + e[6] * b0.c.y + e[10] * b0.c.z;
    // Lowest point of the lower body above the ground
    let low = Infinity;
    for (let i = 0; i < (SEGMENTS[0] ?? 1); i++) low = Math.min(low, car.colliders[i].box.min.y);
    const h = Math.max(0, low);

    // Heading of its length on the ground; a car stood on its nose has none, so its up decides
    let ux = e[8];
    let uz = e[10];
    if (ux * ux + uz * uz < 0.04) {
      ux = e[4];
      uz = e[6];
    }
    const yaw = Math.atan2(ux, uz);
    const sy = Math.sin(yaw);
    const cyw = Math.cos(yaw);
    // Its extent along (u) and across (v) that heading, from all three of its axes
    const W = b0.h.x * 2;
    const H = car.spec.height;
    const L = b0.h.z * 2;
    const along = Math.abs(e[0] * sy + e[2] * cyw) * W + Math.abs(e[4] * sy + e[6] * cyw) * H + Math.abs(e[8] * sy + e[10] * cyw) * L;
    const across = Math.abs(e[0] * cyw - e[2] * sy) * W + Math.abs(e[4] * cyw - e[6] * sy) * H + Math.abs(e[8] * cyw - e[10] * sy) * L;

    const f = Math.min(1, h / SHADOW_FADE_H);
    const shrink = 1 - 0.45 * f;
    _v.set(cx, 0.02, cz);
    _q2.setFromAxisAngle(UP, yaw);
    _v2.set((across + 0.9) * shrink, 1, (along + 0.9) * shrink);
    _m.compose(_v, _q2, _v2);
    this.shadows.setMatrixAt(car.id, _m);
    const k = SHADOW_K * (1 - 0.7 * f);
    this.shadows.setColorAt(car.id, _col.setRGB(k, k, k));
    this.shadowDirty = true;
  }

  /** Upload what moved this frame. */
  private flush(): void {
    for (const set of this.sets.values()) {
      if (!set.dirty) continue;
      set.dirty = false;
      for (const m of set.meshes) m.instanceMatrix.needsUpdate = true;
    }
    if (this.shadowDirty) {
      this.shadowDirty = false;
      this.shadows.instanceMatrix.needsUpdate = true;
      if (this.shadows.instanceColor) this.shadows.instanceColor.needsUpdate = true;
    }
  }

  private setSolid(car: Car, on: boolean): void {
    car.solid = on;
    for (const c of car.colliders) c.disabled = !on;
  }

  /**
   * Does the player's box overlap any of the car's collider boxes? Strict, with
   * a little slack on top: standing on the bonnet (feet on its top face) is
   * not being inside it.
   */
  private overlapsPlayer(car: Car): boolean {
    const pl = this.player;
    if (!pl) return false;
    const p = pl.position;
    const top = p.y + pl.eyeHeight + 0.12;
    const r = PLAYER_RADIUS - 0.01;
    if (p.x + r <= car.aabb.min.x || p.x - r >= car.aabb.max.x || p.z + r <= car.aabb.min.z || p.z - r >= car.aabb.max.z) return false;
    for (const c of car.colliders) {
      const b = c.box;
      if (p.x + r > b.min.x && p.x - r < b.max.x && p.z + r > b.min.z && p.z - r < b.max.z && top > b.min.y + 0.02 && p.y < b.max.y - 0.06) {
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ states

  private toResting(car: Car): void {
    this.freePileSlot(car);
    this.releaseRing(car);
    car.state = 'resting';
    car.body.linearDamping = LINEAR_DAMPING;
    car.body.angularDamping = ANGULAR_DAMPING;
    car.restSeq = ++this.restCounter;
    car.knocked = false;
    car.home.copy(car.origin);
    car.homeQ.copy(car.quat);
  }

  private freePileSlot(car: Car): void {
    if (car.pileSlot < 0) return;
    const home = this.pileHomes[car.pileSlot];
    if (home && home.occupant === car.id) home.occupant = -1;
    car.pileSlot = -1;
  }

  /** Fell through the world (a tunnelling hit): stand it back on the ground where it went through. */
  private rescue(car: Car): void {
    const b = car.body;
    _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    _v.set(0, 0, -1).applyQuaternion(_q);
    _q.setFromAxisAngle(UP, Math.atan2(-_v.x, -_v.z));
    _v.copy(car.com).applyQuaternion(_q);
    _v2.set(b.position.x - _v.x, 0.05, b.position.z - _v.z);
    this.place(car, _v2, _q);
    b.wakeUp();
  }

  /** Is another car lying on top of this one? */
  private covered(car: Car): boolean {
    const a = car.aabb;
    for (const o of this.cars) {
      if (o === car || o.state === 'held' || o.state === 'flying') continue;
      const b = o.aabb;
      if (b.min.y < a.min.y + 0.3 || o.origin.y < car.origin.y + 0.4) continue;
      if (b.min.x < a.max.x - 0.25 && b.max.x > a.min.x + 0.25 && b.min.z < a.max.z - 0.25 && b.max.z > a.min.z + 0.25) return true;
    }
    return false;
  }

  /** Wake everything resting on this car, before it is taken away from under them. */
  private wakeAbove(car: Car): void {
    const a = car.aabb;
    for (const o of this.cars) {
      if (o === car || o.state === 'held') continue;
      const b = o.aabb;
      if (b.min.y < a.min.y + 0.3) continue;
      if (b.min.x < a.max.x && b.max.x > a.min.x && b.min.z < a.max.z && b.max.z > a.min.z) o.body.wakeUp();
    }
  }

  /** How far to raise a just-added pile wreck to clear the wrecks already stacked where it is. */
  private liftClear(car: Car): number {
    const a = car.aabb;
    let lift = 0;
    for (const o of this.cars) {
      if (o === car || o.state !== 'pile') continue;
      // Same stack only: the neighbouring stacks' AABBs reach across the gap when a wreck is turned
      if (Math.hypot(o.origin.x - car.origin.x, o.origin.z - car.origin.z) > 1.6) continue;
      const b = o.aabb;
      if (b.min.x >= a.max.x - 0.1 || b.max.x <= a.min.x + 0.1 || b.min.z >= a.max.z - 0.1 || b.max.z <= a.min.z + 0.1) continue;
      if (b.min.y > a.min.y) continue;
      lift = Math.max(lift, b.max.y - a.min.y + 0.02);
    }
    return lift;
  }

  /** The middle of its top, over its ground centre (where the General puts his hands), world. */
  private roofPoint(car: Car, out: THREE.Vector3): THREE.Vector3 {
    _v.set(0, 1, 0).applyQuaternion(car.quat);
    if (_v.y > 0.7) return out.set(car.origin.x, car.aabb.max.y, car.origin.z);
    // On its side or its roof: its ground origin is up in the air; use the middle of what's there
    car.aabb.getCenter(out);
    out.y = car.aabb.max.y;
    return out;
  }

  /** The heading of its nose (Level8Contracts' yaw: forward = (−sin, 0, −cos)). */
  private yawOf(car: Car): number {
    _v.set(0, 0, -1).applyQuaternion(car.quat);
    if (_v.x * _v.x + _v.z * _v.z < 0.04) _v.set(0, 1, 0).applyQuaternion(car.quat);
    return Math.atan2(-_v.x, -_v.z);
  }

  private playerDist(p: THREE.Vector3): number {
    const pl = this.player;
    if (!pl) return 999;
    const q = pl.position;
    return Math.hypot(p.x - q.x, p.y - (q.y + 1.2), p.z - q.z);
  }

  // -------------------------------------------------------------- impacts

  /**
   * A car touched something. cannon fires this once when a pair first comes
   * into contact (not every step they stay touching), for both bodies, inside
   * world.step. One bang per car per IMPACT_GAP; both cars of a pair are
   * marked, so a car-on-car crash plays once, not twice.
   */
  private onCollide(car: Car, e: CollideEvent): void {
    if (this.quiet || this.disposed) return;
    const other = this.byBody.get(e.body.id) ?? null;
    // A lob's ring goes the moment it comes down (on the ground or on a car)
    if (car.ring && car.flyTime > 0.05) this.releaseRing(car);
    if (other && other.ring && other.flyTime > 0.05) this.releaseRing(other);

    const c = e.contact;
    const vn = Math.abs(c.getImpactVelocityAlongNormal());
    const bi = c.bi;
    const bj = c.bj;
    // How fast it slid along the surface: a car coming in flat drags, it doesn't bang
    const rx = bi.velocity.x - bj.velocity.x;
    const ry = bi.velocity.y - bj.velocity.y;
    const rz = bi.velocity.z - bj.velocity.z;
    const n = c.ni;
    const along = rx * n.x + ry * n.y + rz * n.z;
    const vt = Math.hypot(rx - n.x * along, ry - n.y * along, rz - n.z * along);
    const crash = vn >= CRASH_SPEED;
    const scrape = !crash && vn > 0.5 && vt > SCRAPE_SLIDE;
    if (!crash && !scrape) return;

    const now = this.world.time;
    if (now - car.lastImpact < IMPACT_GAP || now < car.quietUntil) return;
    if (other && (now - other.lastImpact < IMPACT_GAP || now < other.quietUntil)) return;
    car.lastImpact = now;
    if (other) other.lastImpact = now;

    // The contact point: body i's position plus its contact offset
    const pos = new THREE.Vector3(bi.position.x + c.ri.x, bi.position.y + c.ri.y, bi.position.z + c.ri.z);
    const dist = this.playerDist(pos);
    const ground = !other;

    // A car bowled into the rows can set off a chain of impacts in half a
    // second, each a crash of a hundred-odd voices: no more than three
    // crashes in any 0.15 s, and nothing past the lot's far end
    if (dist < 75) {
      const ct = this.crashTimes;
      while (ct.length && now - ct[0] > 0.15) ct.shift();
      if (ct.length < 3) {
        ct.push(now);
        if (crash) this.audio.carCrash(dist, vn > 10);
        else this.audio.carScrape(dist);
      }
    }

    if (ground && pos.y < 0.6) {
      if (crash) this.particles.dust(_v.set(pos.x, 0.05, pos.z), 1.6 + vn * 0.16, Math.min(2, Math.max(0.35, vn / 10)));
      // Steel dragged over tarmac
      if (vt > 5) {
        _v2.set(rx - n.x * along, 0, rz - n.z * along).normalize();
        _v2.y = 0.4;
        this.particles.sparks(pos, _v2, Math.min(28, Math.round(vt * 1.6)));
      }
    } else {
      // Metal on metal (or a car into a wall or a post)
      _v2.set(n.x, n.y, n.z);
      if (_v2.y < 0) _v2.negate();
      _v2.y += 0.5;
      this.particles.sparks(pos, _v2, Math.min(32, Math.max(6, Math.round(vn * 1.5))));
    }

    // A parked car taking a real hit sets its alarm off
    if (vn > ALARM_HIT) {
      if (car.state === 'parked' && !car.wrecked) this.startAlarm(car);
      if (other && other.state === 'parked' && !other.wrecked) this.startAlarm(other);
    }

    if (crash) this.onImpact?.({ pos, speed: vn, dist, ground });
  }

  private startAlarm(car: Car): boolean {
    if (car.alarmed) return false;
    this.pruneAlarms();
    if (this.alarms.length >= MAX_ALARMS) return false;
    car.alarmed = true;
    this.alarms.push({ handle: this.audio.carAlarm(this.playerDist(car.origin)), until: this.clock + ALARM_LIFE });
    return true;
  }

  private pruneAlarms(): void {
    for (let i = this.alarms.length - 1; i >= 0; i--) {
      if (this.alarms[i].until <= this.clock) this.alarms.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- crush

  /**
   * Any car moving fast that overlaps Ravi's box. His box goes into the
   * body's frame as its AABB there (|Rᵀ|·half extents), so the test is
   * right whichever way up the car is tumbling.
   */
  private crushChecks(player: FPSPlayer): void {
    const height = player.eyeHeight + 0.12;
    const hy = height / 2;
    const p = player.position;
    for (const car of this.cars) {
      if (car.state === 'held' || car.speed < CRUSH_SPEED) continue;
      if (this.clock - car.lastCrush < CRUSH_COOLDOWN) continue;
      // Cheap reject first: nowhere near him
      const a = car.aabb;
      if (p.x + PLAYER_RADIUS < a.min.x || p.x - PLAYER_RADIUS > a.max.x || p.z + PLAYER_RADIUS < a.min.z || p.z - PLAYER_RADIUS > a.max.z) continue;
      if (p.y + height < a.min.y || p.y > a.max.y) continue;

      const b = car.body;
      _cv.set(p.x, p.y + hy, p.z);
      b.pointToLocalFrame(_cv, _cv2);
      const e = _rot.makeRotationFromQuaternion(car.quat).elements;
      const ex = Math.abs(e[0]) * PLAYER_RADIUS + Math.abs(e[1]) * hy + Math.abs(e[2]) * PLAYER_RADIUS;
      const ey = Math.abs(e[4]) * PLAYER_RADIUS + Math.abs(e[5]) * hy + Math.abs(e[6]) * PLAYER_RADIUS;
      const ez = Math.abs(e[8]) * PLAYER_RADIUS + Math.abs(e[9]) * hy + Math.abs(e[10]) * PLAYER_RADIUS;
      let hit = false;
      for (const bx of car.boxes) {
        const dx = _cv2.x - (bx.c.x - car.com.x);
        const dy = _cv2.y - (bx.c.y - car.com.y);
        const dz = _cv2.z - (bx.c.z - car.com.z);
        if (Math.abs(dx) < bx.h.x + ex && Math.abs(dy) < bx.h.y + ey && Math.abs(dz) < bx.h.z + ez) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;

      car.lastCrush = this.clock;
      const v = b.velocity;
      const speed = car.speed;
      // Coming down on him is the end; so is one ploughing through him at
      // speed. A car settling or tumbling to a stop only knocks him flying.
      const lethal = (speed > 10 && v.y < -4) || speed > 15;
      // Shove him away from the car's middle; dead under it, the way it was going
      const push = new THREE.Vector3(p.x - b.position.x, 0, p.z - b.position.z);
      if (push.lengthSq() < 0.0025) push.set(v.x, 0, v.z);
      if (push.lengthSq() < 1e-6) push.set(1, 0, 0);
      push.normalize();
      this.onCrush?.({ id: car.id, lethal, speed, push });
      if (!player.alive) return;
    }
  }

  // ---------------------------------------------------------------- rings

  private showRing(car: Car, aim: THREE.Vector3): void {
    let ring = this.rings.find((r) => !r.car) ?? null;
    if (!ring) {
      // Four lobs in the air at once: take the oldest ring
      ring = this.rings.reduce((a, b) => (a.t >= b.t ? a : b));
      if (ring.car) ring.car.ring = null;
    }
    ring.car = car;
    ring.t = 0;
    ring.radius = car.spec.length / 2 + 0.6;
    car.ring = ring;
    ring.mesh.position.set(aim.x, Math.max(0, aim.y) + 0.035, aim.z);
    ring.mesh.scale.setScalar(ring.radius);
    ring.mesh.visible = true;
  }

  private releaseRing(car: Car): void {
    const ring = car.ring;
    if (!ring) return;
    ring.car = null;
    ring.mesh.visible = false;
    car.ring = null;
  }

  private updateRings(dt: number): void {
    for (const r of this.rings) {
      if (!r.car) continue;
      r.t += dt;
      if (r.t > RING_TIMEOUT || r.car.state !== 'flying') {
        this.releaseRing(r.car);
        continue;
      }
      // A pulse that quickens as the car's time in the air runs on
      const w = 9 + r.t * 6;
      const s = 0.5 + 0.5 * Math.sin(this.clock * w + r.phase);
      r.mesh.scale.setScalar(r.radius * (1 + 0.05 * s));
      r.mat.opacity = 0.55 + 0.35 * s;
    }
  }

  // ------------------------------------------------------------ recycling

  /**
   * Infinite ammunition: when the pile runs low, the oldest car he has
   * thrown — lying far from Ravi where he can't see it — is quietly put back
   * on the pile. Where it reappears should be out of sight too; only when the
   * pile is all but empty will one appear in view, and then only far off.
   */
  private recycle(camera: THREE.Camera): void {
    const pl = this.player;
    if (!pl) return;
    let piled = 0;
    for (const car of this.cars) if (car.state === 'pile') piled++;
    if (piled >= MIN_PILE || this.pileHomes.length === 0) return;

    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);

    let pick: Car | null = null;
    for (const car of this.cars) {
      if (car.state !== 'resting' || !car.thrown || car.body.sleepState !== SLEEPING) continue;
      if (Math.hypot(car.origin.x - pl.position.x, car.origin.z - pl.position.z) < RECYCLE_DIST) continue;
      car.aabb.getBoundingSphere(_sphere);
      if (this.frustum.intersectsSphere(_sphere)) continue;
      if (!pick || car.restSeq < pick.restSeq) pick = car;
    }
    if (!pick) return;

    const urgent = piled <= 1;
    const b0 = pick.boxes[0];
    let best = -1;
    let bestY = Infinity;
    this.pileHomes.forEach((home, i) => {
      if (home.occupant >= 0) return;
      const kc = this.keepClear;
      if (kc && Math.hypot(home.pos.x - kc.pos.x, home.pos.z - kc.pos.z) < kc.radius + b0.h.z) return;
      const y = this.dropHeight(pick!, home.pos.x, home.pos.z, home.yaw);
      if (y > RECYCLE_MAX_Y) return;
      _sphere.center.set(home.pos.x, y + 0.8, home.pos.z);
      _sphere.radius = b0.h.z + 0.5;
      if (this.frustum.intersectsSphere(_sphere)) {
        if (!urgent || Math.hypot(home.pos.x - pl.position.x, home.pos.z - pl.position.z) < 35) return;
      }
      if (y < bestY) {
        bestY = y;
        best = i;
      }
    });
    if (best < 0) return;

    const home = this.pileHomes[best];
    // Flat on whatever is there, a hair above it, awake so it settles the
    // last centimetres itself (and quiet while it does)
    _q.setFromAxisAngle(UP, home.yaw);
    _v.set(home.pos.x, bestY, home.pos.z);
    this.place(pick, _v, _q);
    pick.body.wakeUp();
    pick.quietUntil = this.world.time + 2;
    pick.state = 'pile';
    pick.pileSlot = best;
    home.occupant = pick.id;
    pick.thrown = false;
    pick.knocked = false;
    pick.slowFor = 0;
    pick.awakeLast = true;
    this.syncCar(pick);
    pick.home.copy(pick.origin);
    pick.homeQ.copy(pick.quat);
    this.setSolid(pick, !this.overlapsPlayer(pick));
  }

  /** Where a car's ground origin would rest dropped flat at (x, z, yaw): on top of whatever is there. */
  private dropHeight(car: Car, x: number, z: number, yaw: number): number {
    const b0 = car.boxes[0];
    const s = Math.abs(Math.sin(yaw));
    const c = Math.abs(Math.cos(yaw));
    const hx = c * b0.h.x + s * b0.h.z - 0.15;
    const hz = s * b0.h.x + c * b0.h.z - 0.15;
    let top = 0;
    for (const o of this.cars) {
      if (o === car || o.state === 'held' || o.state === 'flying') continue;
      const b = o.aabb;
      if (b.min.x < x + hx && b.max.x > x - hx && b.min.z < z + hz && b.max.z > z - hz) top = Math.max(top, b.max.y);
    }
    return top + 0.03;
  }

  // ---------------------------------------------------------- clear line

  /** The level's own tall colliders (walls, fences, posts, the Civic), refreshed if the list grows. */
  private refreshStatic(): void {
    const list = this.level.colliders;
    if (this.staticSeen === list.length) return;
    this.staticSeen = list.length;
    this.staticTall.length = 0;
    for (const c of list) {
      if (this.mine.has(c)) continue;
      if (c.box.max.y - c.box.min.y > 0.9) this.staticTall.push(c);
    }
  }
}

// ----------------------------------------------------------------- helpers

/** Segment a + t·d, t ∈ [0, 1], against an AABB (slab test). */
function segHitsBox(a: THREE.Vector3, dx: number, dy: number, dz: number, box: THREE.Box3): boolean {
  let t0 = 0;
  let t1 = 1;
  const o = [a.x, a.y, a.z];
  const d = [dx, dy, dz];
  const mn = [box.min.x, box.min.y, box.min.z];
  const mx = [box.max.x, box.max.y, box.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return false;
      continue;
    }
    let ta = (mn[i] - o[i]) / d[i];
    let tb = (mx[i] - o[i]) / d[i];
    if (ta > tb) {
      const t = ta;
      ta = tb;
      tb = t;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

function clampVec(v: CANNON.Vec3, max: number): void {
  const l = v.length();
  if (l > max) v.scale(max / l, v);
}

/**
 * The blob shadow's soft oval: white in the middle, falling away to black
 * at the rim. Its colour is the darkening (the multiply blend reads it), so
 * there is no alpha to speak of.
 */
function blobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 128);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 63);
    grad.addColorStop(0, 'rgb(255,255,255)');
    grad.addColorStop(0.45, 'rgb(226,226,226)');
    grad.addColorStop(0.75, 'rgb(108,108,108)');
    grad.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  // Linear values straight to the blend: no sRGB decode
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
