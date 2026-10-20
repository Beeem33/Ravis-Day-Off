import type * as THREE from 'three';
import type { CarKind, CarRig } from './Level8Contracts';

/**
 * Level 10 — the street. Ravi in the Civic, after the boss's black saloon:
 * down a city avenue through traffic, up the on-ramp onto the elevated
 * highway, past a highway cop eating a doughnut (who comes after them both),
 * off at the airport exit, and into the airport where the boss runs for his
 * private jet. The shared contracts between the pieces, so each can be built
 * on its own:
 *
 *   environment/StreetBuilder.ts  the route, the city, the highway, the airport (StreetData)
 *   environment/StreetProps.ts    the police cruiser, the jet, the cop, the doughnut, the radar
 *   entities/RoadNet.ts           queries on the route (RoadNet)
 *   entities/DriveCar.ts          the arcade car physics (DriveCar), Ravi's and the AIs'
 *   entities/Traffic.ts           every other car on the road (ITraffic)
 *   entities/Chasers.ts           the boss's driving and the cop's (BossDriver, CopDriver)
 *   scenes/StreetScene.ts         the cutscenes, the chase, the HUD, failing and finishing
 *
 * World frame, as every level: x runs east, z runs SOUTH, y is up, the
 * ground is y = 0. Yaw 0 faces −Z (north); forward is (−sin yaw, 0, −cos yaw);
 * +π/2 faces west. Car models keep Level 8's frame (origin on the ground at
 * the middle of the footprint, FRONT toward −Z, driver on −X).
 *
 * Distances are metres and speeds m/s (the HUD shows mph: × 2.237).
 */

// ------------------------------------------------------------------ the route

/** One sampled point along a road's centreline. */
export interface RoadSample {
  /** Distance along this road from its start, metres. */
  s: number;
  /** The centreline, on the road surface (y is the deck's height there). */
  pos: THREE.Vector3;
  /** Unit, along the road in the direction of increasing s (may climb: y component allowed). */
  tangent: THREE.Vector3;
  /** Unit, horizontal, to the right of the tangent: (−tangent.z, 0, tangent.x) normalised. */
  right: THREE.Vector3;
  /** Drivable half-width from the centreline to the barrier / kerb, each side, metres. */
  halfLeft: number;
  halfRight: number;
}

/** A lane: an offset from the centreline (+ right) and which way its traffic goes. */
export interface Lane {
  offset: number;
  /** +1 drives toward increasing s; −1 against it (oncoming). */
  dir: 1 | -1;
  /** Traffic's cruising speed in this lane, m/s. */
  speed: number;
}

export type RoadId = 'city' | 'onramp' | 'highway' | 'exit' | 'airport';

/**
 * One road of the route. Roads join end to start ('next'), and the exit
 * leaves the highway part way along ('branch'): the exit ramp's first samples
 * lie over the highway's right-hand lanes and peel away from them, so for a
 * stretch a car is on both. The highway itself carries on past the exit for
 * a few hundred metres and then ends in a closed-off construction zone — the
 * way you lose him if you miss the exit.
 */
export interface Road {
  id: RoadId;
  /** Evenly spaced (about 2 m), first at s = 0, last at s = length. */
  samples: RoadSample[];
  length: number;
  lanes: Lane[];
  /** Where this road leads, if anywhere, when s runs out. */
  next: RoadId | null;
  /** For the exit: the road it leaves, and the s on that road where it starts. */
  from?: { road: RoadId; s: number };
  /** Speed limit text for signs and the radar gag (mph). */
  limitMph: number;
}

/** A place on the route: which road and how far along it, and how far right of the centreline. */
export interface RoadPos {
  road: RoadId;
  s: number;
  /** + right of the centreline. */
  d: number;
}

/** A static solid the cars can hit (barrier ends, pillars at the gore, the jet, hangar walls). Horizontal footprint, oriented box. */
export interface StreetBlocker {
  centre: THREE.Vector3;
  halfX: number;
  halfZ: number;
  yaw: number;
  /** Bottom and top, for the elevated deck vs. the street under it. */
  minY: number;
  maxY: number;
}

export interface StreetData {
  /** Everything static, already merged where it can be. */
  group: THREE.Group;
  roads: Record<RoadId, Road>;
  blockers: StreetBlocker[];
  /** Where it starts: the Civic coming out of the parking lot onto the avenue, and the boss already ahead. */
  start: { civic: RoadPos; boss: RoadPos };
  /** The highway cop, parked on the right shoulder facing the traffic flow, set back off the lanes. */
  cop: { pos: THREE.Vector3; yaw: number; s: number };
  /** Where on the highway the exit ramp begins (= roads.exit.from.s), for the signs and the objective. */
  exitS: number;
  /** Past this s on the highway with the boss on the exit: he's gone. (The construction closure.) */
  missedExitS: number;
  /** The airport: the gate the boss smashes through, his jet and where he stops, where the Civic skids in. */
  airport: {
    gate: { pos: THREE.Vector3; yaw: number };
    /** The barrier arm at the gate: the scene swings it up/breaks it. Pivot at its post; rotation.z lifts it. */
    gateArm: THREE.Object3D;
    jet: { pos: THREE.Vector3; yaw: number };
    /** The boss's car's stop beside the jet, and the foot of the airstair he runs to. */
    bossStop: { pos: THREE.Vector3; yaw: number };
    stairFoot: THREE.Vector3;
    civicStop: { pos: THREE.Vector3; yaw: number };
    /** A drivable path through the airport from the end of the airport road to bossStop, for the cutscene (ground points). */
    bossPath: THREE.Vector3[];
    civicPath: THREE.Vector3[];
  };
  sunDir: THREE.Vector3;
}

// ------------------------------------------------------------------ props

/** The highway patrol cruiser: a CarRig with a roof light bar and a siren. */
export interface PoliceRig extends CarRig {
  /** Red and blue lamp materials on the light bar: emissiveIntensity 0 = off. The scene flashes them. */
  lightRed: THREE.MeshStandardMaterial;
  lightBlue: THREE.MeshStandardMaterial;
  /** The radar unit on the dash: shows a number. */
  radar: RadarUnit;
}

export interface RadarUnit {
  /** In the cruiser (car-local). */
  object: THREE.Object3D;
  /** Red digits: speed in mph, or null for blank. `alarm` flashes the panel red. */
  show(mph: number | null, alarm: boolean): void;
}

/** The cop at the wheel: a whole seated man the scene animates through a handful of poses. */
export interface CopRig {
  /** Car-local placement: put it in the cruiser's group (it sits in the driver's seat by itself). */
  root: THREE.Object3D;
  /**
   * 'feetUp': leant back, boots up on the dash, doughnut in his right hand;
   * 'bite': same, the doughnut at his mouth (blend with `k`);
   * 'startled': feet down, bolt upright, hands up, doughnut gone;
   * 'driving': both hands on the wheel, leaning into it.
   */
  pose(p: 'feetUp' | 'bite' | 'startled' | 'driving', k?: number): void;
  /** Advance blends and any idle motion. */
  update(dt: number): void;
  /** The doughnut, as its own object (in his hand until thrown: the scene can reparent it and fling it). */
  doughnut: THREE.Object3D;
}

/** The private jet: a mid-size business jet with an airstair door. */
export interface JetRig {
  group: THREE.Group;
  /** 0 shut .. 1 the airstair door folded down onto the tarmac. */
  setDoor(k: number): void;
  /** The top of the airstair, in jet-local: where the boss disappears inside. */
  doorTop: THREE.Vector3;
  /** The foot of the airstair, jet-local. */
  stairFoot: THREE.Vector3;
  /** Engines' glow / heat for spool-up, 0..1. */
  setEngines(k: number): void;
}

// ------------------------------------------------------------------ the driving

/**
 * Arcade car physics on the route. Position on the ground plane, yaw, a
 * forward speed and a sideways slip; it rides on the road under it (y and
 * pitch from the deck), and the road's edges are walls it scrapes along.
 */
export interface DriveInput {
  /** −1 full brake/reverse .. +1 full throttle. */
  throttle: number;
  /** −1 full left .. +1 full right. */
  steer: number;
  handbrake: boolean;
}

export interface DriveTune {
  /** m/s. */
  topSpeed: number;
  accel: number;
  brake: number;
  /** Steering lock at standstill and at top speed (radians of front wheel). */
  steerLow: number;
  steerHigh: number;
  /** How quickly sideways slip is scrubbed off (grip), higher = grippier. */
  grip: number;
  mass: number;
  length: number;
  width: number;
}

export interface ICar {
  readonly position: THREE.Vector3;
  yaw: number;
  /** Forward speed, m/s (negative reversing). */
  speed: number;
  /** World-space velocity (forward + slip). */
  readonly velocity: THREE.Vector3;
  /** Where it is on the route (kept up to date by the car). */
  readonly at: RoadPos;
  /** Front wheel angle now (for the rig), and pitch/roll for the body. */
  readonly steerAngle: number;
  readonly pitch: number;
  readonly roll: number;
  /** Sliding: how much sideways the car is going (0..1), for tyre smoke and squeal. */
  readonly slide: number;
  /** One step. `input` null = keep coasting. */
  update(dt: number, input: DriveInput | null): void;
  /** Snap onto the route at a place, facing along it at a speed. */
  place(at: RoadPos, speed: number): void;
  /** Copy pose into a rig (position, yaw, body pitch/roll, wheel spin and steer). */
  applyTo(rig: CarRig, dt: number): void;
  /** Called on hitting a wall or another car: impact speed along the normal, m/s, and where. */
  onImpact: ((speed: number, point: THREE.Vector3, other: 'wall' | 'traffic' | 'boss' | 'cop' | 'player') => void) | null;
}

/** A traffic car as the others see it, for collision and for avoiding. */
export interface TrafficCar {
  id: number;
  kind: CarKind;
  position: THREE.Vector3;
  yaw: number;
  speed: number;
  at: RoadPos;
  /** Knocked out of its lane by a hit: it slides and spins to a stop and stays a wreck. */
  wrecked: boolean;
  halfLength: number;
  halfWidth: number;
}

export interface ITraffic {
  /** Everything it draws: add once. */
  readonly object: THREE.Object3D;
  /** Fill the road around `around` (and re-fill as it moves): cars ahead and behind on every lane. */
  update(dt: number, around: RoadPos, others: ICar[]): void;
  readonly cars: readonly TrafficCar[];
  /** Hit a traffic car: shove it with this velocity change and spin, and wreck it. */
  hit(id: number, impulse: THREE.Vector3, spin: number): void;
  /** Clear a stretch (e.g. in front of a cutscene shot). */
  clear(road: RoadId, s0: number, s1: number): void;
  /** Stop spawning (the airport). */
  enabled: boolean;
  /** Horns, near misses: the scene plays sound off these. */
  onHorn: ((pos: THREE.Vector3) => void) | null;
}

// ------------------------------------------------------------------ queries on the route

/**
 * The route as one thing: city → onramp → highway, and off the highway at
 * exitS either on along it (to the closure) or down the exit → airport.
 * "Route distance" (routeS) runs on through the joins, so how far apart two
 * cars are is just the difference — the exit and the highway past the fork
 * share the highway's numbers up to the fork and carry on from there.
 */
export interface IRoadNet {
  readonly roads: Record<RoadId, Road>;
  /** The centreline at s on a road, interpolated between samples (s clamped to the road). */
  sample(road: RoadId, s: number): { pos: THREE.Vector3; tangent: THREE.Vector3; right: THREE.Vector3; halfLeft: number; halfRight: number };
  /** The world point at a RoadPos (on the deck). */
  point(at: RoadPos, out: THREE.Vector3): THREE.Vector3;
  /**
   * Which road a world point is on and where: nearest centreline among the
   * hint's road and its neighbours (previous, next, the branch either way),
   * preferring the hint's road while the point is within its width. Writes
   * and returns `out`.
   */
  locate(p: THREE.Vector3, hint: RoadPos, out: RoadPos): RoadPos;
  /** Route distance of a place (see above). */
  routeS(at: RoadPos): number;
  /** Move a place `ds` metres on along the route (negative: back), onto the next road at a join; at the fork, down the exit if `takeExit`. */
  advance(at: RoadPos, ds: number, takeExit: boolean, out: RoadPos): RoadPos;
}

// ------------------------------------------------------------------ the chasers

/** The boss's driving: a maniac, but always just about catchable. */
export interface IBossDriver {
  readonly car: ICar;
  /** 'drive': his own brain; 'hold': coast in lane at the current speed (cutscenes). */
  mode: 'drive' | 'hold';
  /** Gap ahead of Ravi he wants, metres of route; he rubber-bands to it (faster when caught, slower when far ahead, never so slow it looks it). */
  update(dt: number, ravi: ICar, traffic: ITraffic): void;
}

/** The highway cop, once he's after them: hangs on behind Ravi, lights and siren going. */
export interface ICopDriver {
  readonly car: ICar;
  /** 'parked' on the shoulder; 'launch' pulling out (for the cutscene); 'chase'. */
  mode: 'parked' | 'launch' | 'chase';
  update(dt: number, ravi: ICar, traffic: ITraffic): void;
}
