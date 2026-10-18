import type * as THREE from 'three';
import type { Collider } from '../environment/OfficeLevelBuilder';
import type { BreakableGlass } from '../environment/BreakableGlass';

/**
 * Level 8 — the parking lot. The shared contracts between the pieces that
 * make it up, so each can be built on its own:
 *
 *   environment/VehicleProps.ts   the car models (CarRig, baked instancing sets)
 *   environment/Level8Builder.ts  the lot itself (Level8Data)
 *   entities/CarSystem.ts         every car in the fight: parked, piled, held, thrown
 *   entities/General.ts           the giant and his brain (IGeneral, GeneralWorld)
 *   scenes/Level8Scene.ts         the cutscenes, the fight, the escape
 *
 * World frame (the same as Level 7's): x runs east, z runs SOUTH, y is up and
 * the ground is y = 0. Yaw 0 faces −Z (north); forward is (−sin yaw, 0, −cos yaw),
 * so yaw +π/2 faces west (−X) and −π/2 faces east (+X).
 */

// ------------------------------------------------------------------ cars

export type CarKind = 'sedan' | 'hatch' | 'suv' | 'pickup';

/**
 * Every car model shares one local frame: origin on the ground at the middle
 * of the footprint, +Y up, the FRONT toward −Z, the driver's (left) side toward
 * −X. A car placed with rotation.y = yaw therefore faces the same way an
 * Enemy or the player with that yaw does.
 */
export interface CarSpec {
  length: number;
  width: number;
  height: number;
  /** kg, for the physics body. */
  mass: number;
  /**
   * The car as boxes, car-local: centre and half extents. Two of them — the
   * lower body up to the beltline, and the cabin on top — used for the
   * physics compound shape, the player collider and the invisible bullet
   * proxy. The body box's top is under 1.1 m so the player can vault onto
   * the bonnet (FPSPlayer vaults anything 0.45–1.3 m above his feet).
   */
  boxes: { c: [number, number, number]; h: [number, number, number] }[];
  wheelRadius: number;
}

/**
 * One car model baked for instancing: each part a single BufferGeometry in
 * the car-local frame, meant for one InstancedMesh per part (CarSystem draws
 * every parked and thrown car with these, a handful of draws in all).
 *  - paint: the panels. White vertex colour; the instance colour paints it.
 *  - trim:  tyres, wheels, bumpers, grille, mirrors, chrome. Vertex colours.
 *  - glass: windows. Dark tinted.
 *  - lamps: head and tail lamps. Vertex colours, drawn emissive.
 */
export interface BakedCar {
  paint: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  lamps: THREE.BufferGeometry;
}

/**
 * A single, hand-animated car: the boss's black saloon and Ravi's Civic.
 * Same car-local frame as above.
 */
export interface CarRig {
  /** Place this: position on the ground, rotation.y = yaw. */
  group: THREE.Group;
  /** Everything above the axles. Pitch it for squat and dive, roll it in a turn. Pivots at axle height. */
  body: THREE.Object3D;
  /** Each wheel spins about its own local X: add to rotation.x (positive rolls the car forward, toward −Z). */
  wheels: { fl: THREE.Object3D; fr: THREE.Object3D; rl: THREE.Object3D; rr: THREE.Object3D };
  /** Front wheel steering pivots: rotation.y, positive turns the car to its left. */
  steer: { l: THREE.Object3D; r: THREE.Object3D };
  /** Driver's door: 0 shut .. 1 swung wide open (about 70°, out to the left). */
  setDoor(k: number): void;
  /** Emissive materials the scene drives (intensity 0 = off). Never toggle visibility. */
  headlights: THREE.MeshStandardMaterial;
  brakelights: THREE.MeshStandardMaterial;
  /** Amber indicators (both sides), for hazards. */
  indicators: THREE.MeshStandardMaterial;
  /** The tailpipe's tip, car-local, for exhaust and smoke. */
  exhaust: THREE.Object3D;
  /** Where the driver sits, car-local: hip point, steering-wheel centre and the wheel's facing (toward the driver). */
  seat: { hip: THREE.Vector3; wheel: THREE.Vector3; wheelFacing: THREE.Vector3 };
  /** Every mesh, each already tagged userData.surface = 'metal' (glass 'glass'), for the bullet raycast. */
  meshes: THREE.Mesh[];
}

/** The Civic: a CarRig plus its loose front-left hubcap, which comes off when he peels out. */
export interface CivicRig extends CarRig {
  hubcap: THREE.Object3D;
}

// ------------------------------------------------------------------ the lot

/** A parked car in the arena. The CarSystem turns each into a real, shovable car. */
export interface ParkedSlot {
  x: number;
  z: number;
  yaw: number;
  kind: CarKind;
  colour: number;
}

/** One wreck in the General's scrap pile, stacked: the CarSystem places these. */
export interface PileSlot {
  pos: THREE.Vector3; // car-local origin (ground centre of the car) in world space
  yaw: number;
  /** Roll about the car's own length axis, radians: wrecks lie a little askew. */
  roll: number;
  kind: CarKind;
}

export interface Level8Data {
  group: THREE.Group;
  colliders: Collider[];
  /** The bullet raycast set (non-recursive: meshes, not groups). */
  shootables: THREE.Object3D[];
  glassPanes: BreakableGlass[];
  occluders: THREE.Object3D[];

  /** Just outside Stairwell B's door in the building's west wall. */
  playerSpawn: THREE.Vector3;
  playerSpawnYaw: number;
  /** Stairwell B's door. Turn pivot.rotation.y from 0 to openAngle to fling it open. */
  stairDoor: { pivot: THREE.Object3D; openAngle: number };

  ravi: {
    /** His run out of the door in the chase cutscene, feet positions. */
    chase: THREE.Vector3[];
    /** Where he stands, and faces, when the fight is handed over (and on a retry). */
    fightStart: THREE.Vector3;
    fightYaw: number;
  };
  boss: {
    /** Where the boss is when the level opens (already well ahead), and his run to his car's driver door. */
    start: THREE.Vector3;
    run: THREE.Vector3[];
    /** His car, parked. */
    car: { pos: THREE.Vector3; yaw: number };
    /** The car's route out: through the gate and away up the road. */
    drive: THREE.Vector3[];
  };
  general: {
    /** Behind the scrap pile, out of sight from the building: where he waits during the chase. */
    hidden: THREE.Vector3;
    /** Where he steps out to, in the lane in front of the gate, facing east down the lot. */
    reveal: THREE.Vector3;
    revealYaw: number;
    /** His ground in the fight: he never leaves it. */
    zone: { minX: number; maxX: number; minZ: number; maxZ: number };
  };
  civic: {
    pos: THREE.Vector3;
    yaw: number;
    /** Ravi's getaway: out of the bay, through the gate, up the road. */
    drive: THREE.Vector3[];
  };
  parked: ParkedSlot[];
  pile: PileSlot[];
  /** Where the player can be (inside the fences). */
  arena: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Closes the gate to the player during the fight (the cars and the cutscenes ignore it). */
  gate: { collider: Collider; centre: THREE.Vector3 };
  /** Unit vector toward the sun. */
  sunDir: THREE.Vector3;
}

// ------------------------------------------------------------------ the General

export type ThrowKind = 'lob' | 'drive' | 'bowl';

export type GeneralEvent =
  | { type: 'step'; pos: THREE.Vector3; heavy: boolean }
  | { type: 'pound'; i: number }
  | { type: 'roar' }
  | { type: 'reach'; carId: number }
  | { type: 'lift'; carId: number }
  | { type: 'windup'; carId: number; kind: ThrowKind }
  | { type: 'throw'; carId: number; kind: ThrowKind; aim: THREE.Vector3 }
  | { type: 'stompWarn'; pos: THREE.Vector3 }
  | { type: 'stomp'; pos: THREE.Vector3; radius: number }
  | { type: 'stagger' }
  | { type: 'phase'; phase: 1 | 2 | 3 }
  | { type: 'fall' }
  | { type: 'fell'; pos: THREE.Vector3 }
  /** Down to his last 15%: he drops the car and roars. From now on he charges. */
  | { type: 'enrage' }
  /** Head down, pawing the ground: a charge is coming from `pos` toward `at`. */
  | { type: 'chargeWarn'; pos: THREE.Vector3; at: THREE.Vector3 }
  /** Off, flat out. */
  | { type: 'charge'; dir: THREE.Vector3 }
  /** Through `count` cars at `pos`. */
  | { type: 'ram'; pos: THREE.Vector3; count: number }
  /** Ran Ravi down. `from` is where the General was. */
  | { type: 'trample'; from: THREE.Vector3; dir: THREE.Vector3 }
  /** Pulling up at the end of a run; `crashed` if it was the lot's edge that stopped him. */
  | { type: 'skid'; pos: THREE.Vector3; crashed: boolean };

/** What the General needs from the world. The scene builds this, bridging to the CarSystem. */
export interface GeneralWorld {
  /** Ravi: feet, velocity, and whether he is alive and on the ground. */
  target(): { pos: THREE.Vector3; vel: THREE.Vector3; grounded: boolean; alive: boolean };
  /** The nearest car he could pick up within `range` of `from` (roof centre to put his hands on), or null. */
  findCar(from: THREE.Vector3, range: number): { id: number; at: THREE.Vector3; yaw: number } | null;
  /** Take car `id` out of the world: it is his now, and follows hold() until launch(). */
  grab(id: number): void;
  /** This frame's world transform for the car in his hands (car-local origin = ground centre of the car). */
  hold(id: number, m: THREE.Matrix4): void;
  /** Let go of it: a real physics body from here, with this velocity and spin (rad/s). `aim` is where a lob will come down. */
  launch(id: number, vel: THREE.Vector3, spin: THREE.Vector3, kind: ThrowKind, aim: THREE.Vector3): void;
  /** Is the straight line a→b free of cars and solid cover? (For flat throws.) */
  clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** Physics gravity, m/s² (positive). The cars fly under this. */
  gravity: number;
  /** Smash every car within `radius` of `pos` out of his way; how many. (The charge.) */
  ram?(pos: THREE.Vector3, dir: THREE.Vector3, speed: number, radius: number): number;
  /** The whole lot: where a charge has to stop. Defaults to his zone. */
  arena?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export type GeneralAction =
  /** Stand, breathe, face `at` if given. */
  | 'idle'
  /** Walk to `to` (giant strides), facing the way he goes. */
  | 'walk'
  /** Beat his chest like a gorilla, both fists alternating. */
  | 'chestPound'
  /** Head back, arms out, roar. */
  | 'roar'
  /** Point at `at` with his right arm. */
  | 'point';

export interface IGeneral {
  /** The modelled giant: an Enemy (opts.general) at `scale`. Its root, hitbox parts etc. */
  readonly enemy: import('../entities/Enemy').Enemy;
  readonly scale: number;
  readonly maxHp: number;
  hp: number;
  readonly phase: 1 | 2 | 3;
  readonly dead: boolean;
  /** 'script': play() drives him (cutscenes). 'fight': his brain runs. */
  mode: 'script' | 'fight';
  onEvent: ((e: GeneralEvent) => void) | null;
  /** Scripted action for cutscenes; returns how long it takes, seconds. */
  play(action: GeneralAction, opts?: { at?: THREE.Vector3; to?: THREE.Vector3; duration?: number }): number;
  /** Cutscene throw: go and get a car (nearest to him), and lob it to land on `at`. Switches to the fight afterwards if `thenFight`. */
  scriptThrow(at: THREE.Vector3, thenFight: boolean): void;
  /** A round has landed: `dmg` already worked out by the scene. Flinches, staggers, phase changes, death. */
  damage(dmg: number, part: string, point: THREE.Vector3): void;
  /** True for a brief window (chest-pounding, staggered) when he takes extra damage. */
  readonly vulnerable: boolean;
  /** Is he holding a car right now (its id), or -1. */
  readonly holding: number;
  update(dt: number): void;
  dispose(): void;
}

// ------------------------------------------------------------------ the cars

export type CarState = 'parked' | 'pile' | 'held' | 'flying' | 'resting';

export interface CrushInfo {
  id: number;
  /** A car coming down on him, or ploughing into him fast: he is dead. Otherwise a glancing blow. */
  lethal: boolean;
  speed: number;
  /** Horizontal unit vector away from the car, to shove him along. */
  push: THREE.Vector3;
}

export interface ImpactInfo {
  pos: THREE.Vector3;
  /** Speed into the hit, m/s. */
  speed: number;
  /** How far from the player it happened. */
  dist: number;
  /** Was it the ground (true) or another car (false)? */
  ground: boolean;
}

export interface ICarSystem {
  addParked(slot: ParkedSlot): number;
  addPile(slot: PileSlot): number;
  /** Let everything settle before the first frame (runs the physics quietly). */
  settle(): void;
  throwableNear(from: THREE.Vector3, range: number): { id: number; at: THREE.Vector3; yaw: number } | null;
  grab(id: number): void;
  hold(id: number, m: THREE.Matrix4): void;
  launch(id: number, vel: THREE.Vector3, spin: THREE.Vector3, kind: ThrowKind, aim: THREE.Vector3): void;
  state(id: number): CarState;
  position(id: number, out: THREE.Vector3): THREE.Vector3;
  clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** After world.step: sync the drawing, colliders and bullet proxies; crush and impact checks. */
  update(dt: number, player: import('../entities/FPSPlayer').FPSPlayer, camera: THREE.Camera): void;
  onCrush: ((c: CrushInfo) => void) | null;
  onImpact: ((i: ImpactInfo) => void) | null;
  dispose(): void;
}
