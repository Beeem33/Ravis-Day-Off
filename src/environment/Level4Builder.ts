import * as THREE from 'three';
import { FlickeringLight } from './FlickeringLight';
import type { BreakableGlass } from './BreakableGlass';
import { Collider, Waypoint, EnemySpawn, noiseCanvas, ceilingTileCanvas, makeTex } from './OfficeLevelBuilder';

export interface Level4Data {
  group: THREE.Group;
  colliders: Collider[];
  shootables: THREE.Object3D[];
  occluders: THREE.Object3D[];
  waypoints: Waypoint[];
  flickering: FlickeringLight[];
  /** No breakable glass on this floor yet; the shared ballistics wants the list. */
  glassPanes: BreakableGlass[];
  playerSpawn: THREE.Vector3;
  playerSpawnYaw: number;
  /** Where the wounded man is propped against the corridor wall. */
  woundedSpot: THREE.Vector3;
  woundedYaw: number;
  /** Crossing this x in the corridor starts the hand-over. */
  talkX: number;
  /** The door back to level 3, which he leaves through. */
  backDoorway: THREE.Vector3;
  /** The door into the maze. Shut until the cutscene is done. */
  mazeDoor: THREE.Mesh;
  mazeDoorCollider: Collider;
  /** Where the sweep teams start. Spread so no two share a room. */
  enemySpawns: EnemySpawn[];
  /** Every ceiling fixture, so the scene can kill them all at the blackout. */
  lights: THREE.PointLight[];
  lampMats: THREE.MeshStandardMaterial[];
}

// ---- Footprint -------------------------------------------------------------
// A tight grid of corridors with rooms in the blocks between them. Everything
// keys off these so a corridor and the rooms either side of it stay flush.
const T = 0.24; // wall thickness
export const CEILING_H = 3.0; // ceiling — lower than the raid floor; nothing drives through it
const H = CEILING_H;

// The approach corridor, carried over from level 3's door
const HALL_X0 = -40;
const HALL_X1 = -24;
const HALL_Z0 = -2.2;
const HALL_Z1 = 2.2;

// The maze shell
const X0 = -24;
const X1 = 16;
const Z0 = -13;
const Z1 = 13;

// Corridor centre lines and half-width. 1.8 gives a 3.6m run — narrower than
// the 4.4m approach, so the maze feels like it closes in.
const CW = 1.8;
const V_WEST = -21;
const V_MID = -5;
const V_EAST = 10;
const H_NORTH = -11;
const H_MAIN = 0;
const H_SOUTH = 11;

/** Room edges, derived so they land exactly on the corridor walls. */
const R_W0 = V_WEST + CW; // -19.2  west block, west edge
const R_W1 = V_MID - CW; // -6.8   west block, east edge
const R_E0 = V_MID + CW; // -3.2   east block, west edge
const R_E1 = V_EAST - CW; // 8.2   east block, east edge
const R_N = H_NORTH + CW; // -9.2  blocks, north edge
const R_S = H_SOUTH - CW; // 9.2   blocks, south edge
const R_MAIN_N = H_MAIN - CW; // -1.8
const R_MAIN_S = H_MAIN + CW; // 1.8
const SPLIT_N = -13; // the north-west block splits evenly
const SPLIT_S = -15.6; // the south-west one does not, so the two differ

const DOOR_W = 1.5;
const WIN_SILL = 1.0;
const WIN_HEAD = 2.1;
const DOOR_H = 2.2;

/**
 * Level4Builder — the dark floor.
 *
 * Laid out as a loop of corridors around and through a block of rooms, so
 * every room can be approached from at least two sides and no corridor is a
 * single long shooting gallery. Rooms open onto the corridors through
 * doorways and waist-height windows; the windows matter as much as the doors,
 * because they let a room be fought from outside it rather than only entered.
 *
 * Layout only for now — no props, no enemies.
 */
export class Level4Builder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private flickering: FlickeringLight[] = [];
  private lights: THREE.PointLight[] = [];
  private lampMats: THREE.MeshStandardMaterial[] = [];

  private carpetMat!: THREE.MeshLambertMaterial;
  private wallMat!: THREE.MeshLambertMaterial;
  private ceilMat!: THREE.MeshLambertMaterial;
  private darkMetalMat!: THREE.MeshLambertMaterial;
  private deskMat!: THREE.MeshLambertMaterial;
  private mazeDoor!: THREE.Mesh;
  private mazeDoorCollider!: Collider;
  /**
   * The centre of every doorway cut into a wall, with the two points either
   * side of it. Seeded into the nav graph — a 1.5m opening is narrower than
   * the sampling grid, so left to chance the grid steps straight over a door
   * and the rooms behind it come out unreachable.
   */
  private doorPoints: [number, number][] = [];

  build(): Level4Data {
    this.makeMaterials();
    this.buildApproach();
    this.buildShell();
    this.buildRooms();
    this.buildLighting();

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      occluders: this.occluders,
      waypoints: this.makeWaypoints(),
      flickering: this.flickering,
      glassPanes: [],
      playerSpawn: new THREE.Vector3(HALL_X0 + 1.6, 0, 0),
      playerSpawnYaw: -Math.PI / 2, // facing east, down the corridor
      // Propped against the north wall of the approach, most of the way along
      woundedSpot: new THREE.Vector3(-29.5, 0, HALL_Z0 + 0.42),
      woundedYaw: Math.PI, // facing south, across the corridor at the player
      talkX: -32.5,
      backDoorway: new THREE.Vector3(HALL_X0 + 0.4, 0, 0),
      mazeDoor: this.mazeDoor,
      mazeDoorCollider: this.mazeDoorCollider,
      // One to a room or junction, facing along the run they are covering,
      // so the first thing the player meets is a beam and not a body.
      enemySpawns: [
        { pos: new THREE.Vector3(-16, 0, -5.5), yaw: Math.PI / 2 },
        { pos: new THREE.Vector3(-10, 0, -5.5), yaw: -Math.PI / 2 },
        { pos: new THREE.Vector3(-17.4, 0, 5.5), yaw: 0 },
        { pos: new THREE.Vector3(-11, 0, 5.5), yaw: Math.PI },
        { pos: new THREE.Vector3(-0.5, 0, -5.5), yaw: Math.PI / 2 },
        { pos: new THREE.Vector3(6.0, 0, -4.0), yaw: -Math.PI / 2 },
        { pos: new THREE.Vector3(-1.2, 0, 3.4), yaw: 0 },
        { pos: new THREE.Vector3(6.0, 0, 4.0), yaw: Math.PI },
        { pos: new THREE.Vector3(V_EAST, 0, -3.5), yaw: 0 },
        { pos: new THREE.Vector3(-13, 0, H_NORTH), yaw: -Math.PI / 2 },
        { pos: new THREE.Vector3(3, 0, H_SOUTH), yaw: Math.PI / 2 },
        { pos: new THREE.Vector3(V_WEST, 0, 3.5), yaw: Math.PI }
      ],
      lights: this.lights,
      lampMats: this.lampMats
    };
  }

  // ------------------------------------------------------------- materials

  private makeMaterials(): void {
    this.carpetMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([38, 40, 48], 12), 20, 14) });
    this.wallMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([182, 178, 168], 7), 4, 2) });
    this.ceilMat = new THREE.MeshLambertMaterial({ map: makeTex(ceilingTileCanvas(), 20, 14) });
    this.darkMetalMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
    this.deskMat = new THREE.MeshLambertMaterial({ color: 0x7d6a52 });
  }

  // --------------------------------------------------------------- helpers

  /** Solid box: mesh, collider, bullet target and vision blocker. */
  private solid(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material = this.wallMat,
    opts: { collide?: boolean; occlude?: boolean; surface?: string } = {}
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.userData.surface = opts.surface ?? 'concrete';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.shootables.push(mesh);
    if (opts.occlude !== false) this.occluders.push(mesh);
    if (opts.collide !== false) {
      this.colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(x - w / 2, y, z - d / 2),
          new THREE.Vector3(x + w / 2, y + h, z + d / 2)
        )
      });
    }
    return mesh;
  }

  private slab(x0: number, x1: number, z0: number, z1: number, y: number, mat: THREE.Material): void {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, y + 0.15, (z0 + z1) / 2);
    m.receiveShadow = true;
    this.group.add(m);
    this.shootables.push(m);
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y + 0.3, z1))
    });
  }

  /**
   * A run of wall along one axis with openings punched through it.
   *
   * `axis` is the direction the wall RUNS. Openings are given as spans along
   * that axis: a door is a full-height gap with a header over it, a window is
   * a gap between sill and head that can be seen and shot through.
   */
  private wall(
    axis: 'x' | 'z',
    a0: number,
    a1: number,
    cross: number,
    openings: { at: number; w: number; kind: 'door' | 'window' }[] = []
  ): void {
    const put = (from: number, to: number, y: number, h: number): void => {
      if (to - from < 0.01 || h < 0.01) return;
      if (axis === 'x') this.solid(to - from, h, T, (from + to) / 2, y, cross);
      else this.solid(T, h, to - from, cross, y, (from + to) / 2);
    };
    const sorted = [...openings].sort((p, q) => p.at - q.at);
    let cursor = a0;
    for (const o of sorted) {
      const s = o.at - o.w / 2;
      const e = o.at + o.w / 2;
      put(cursor, s, 0, H); // solid pier before the opening
      if (o.kind === 'door') {
        put(s, e, DOOR_H, H - DOOR_H); // header over the doorway
        // Through the opening, and a stride either side of it
        for (const off of [-0.85, 0, 0.85]) {
          this.doorPoints.push(axis === 'x' ? [o.at, cross + off] : [cross + off, o.at]);
        }
      } else {
        put(s, e, 0, WIN_SILL); // sill below
        put(s, e, WIN_HEAD, H - WIN_HEAD); // head above
      }
      cursor = e;
    }
    put(cursor, a1, 0, H);
  }

  // -------------------------------------------------------------- approach

  /**
   * The corridor in from level 3. Deliberately plain: the only thing in it is
   * the man on the floor, and the door at the far end.
   */
  private buildApproach(): void {
    this.slab(HALL_X0, HALL_X1 + 0.2, HALL_Z0, HALL_Z1, -0.3, this.carpetMat);
    this.slab(HALL_X0, HALL_X1 + 0.2, HALL_Z0, HALL_Z1, H, this.ceilMat);
    this.wall('x', HALL_X0, HALL_X1, HALL_Z0);
    this.wall('x', HALL_X0, HALL_X1, HALL_Z1);
    // The door back to level 3, at the west end, standing open-ish
    this.wall('z', HALL_Z0, HALL_Z1, HALL_X0, [{ at: 0, w: 2.0, kind: 'door' }]);
    for (const dz of [-1.0, 1.0]) {
      this.solid(0.3, DOOR_H, 0.1, HALL_X0 + 0.05, 0, dz, this.darkMetalMat, {
        surface: 'metal',
        collide: false
      });
    }
  }

  // ----------------------------------------------------------------- shell

  private buildShell(): void {
    this.slab(X0, X1, Z0, Z1, -0.3, this.carpetMat);
    this.slab(X0, X1, Z0, Z1, H, this.ceilMat);
    this.wall('x', X0, X1, Z0); // north
    this.wall('x', X0, X1, Z1); // south
    this.wall('z', Z0, Z1, X1); // east
    // West wall, with the door in from the approach corridor
    this.wall('z', Z0, Z1, X0, [{ at: 0, w: 2.0, kind: 'door' }]);
    this.buildMazeDoor();
  }

  /** The door out of the approach. Shut and solid until the cutscene ends. */
  private buildMazeDoor(): void {
    for (const dz of [-1.0, 1.0]) {
      this.solid(0.3, DOOR_H, 0.1, X0, 0, dz, this.darkMetalMat, { surface: 'metal', collide: false });
    }
    this.solid(0.3, 0.12, 2.0, X0, DOOR_H, 0, this.darkMetalMat, { surface: 'metal', collide: false });
    this.mazeDoor = this.solid(0.1, 2.15, 1.92, X0 + 0.12, 0, 0, this.deskMat, {
      surface: 'wood',
      collide: false
    });
    this.mazeDoorCollider = {
      box: new THREE.Box3(new THREE.Vector3(X0 + 0.02, 0, -1.0), new THREE.Vector3(X0 + 0.22, 2.15, 1.0))
    };
    this.colliders.push(this.mazeDoorCollider);
    this.solid(0.07, 0.26, 0.07, X0 + 0.22, 1.0, 0.62, this.darkMetalMat, {
      surface: 'metal',
      occlude: false,
      collide: false
    });
  }

  // ----------------------------------------------------------------- rooms

  /**
   * The eight rooms in the blocks between the corridors.
   *
   * Openings are placed so no room is a single-entrance box: everything has
   * either two ways in, or one way in and a window covering the other
   * approach. That is what makes it worth clearing carefully rather than
   * running through.
   */
  private buildRooms(): void {
    // ---- North-west pair: NW-A against the west corridor, NW-B beside it
    this.wall('z', R_N, R_MAIN_N, R_W0, [{ at: -6.4, w: DOOR_W, kind: 'door' }]); // west face, door onto W corridor
    this.wall('x', R_W0, SPLIT_N - T / 2, R_N, [{ at: -16.4, w: 1.6, kind: 'window' }]); // north face, window onto N corridor
    this.wall('x', R_W0, SPLIT_N - T / 2, R_MAIN_N, [{ at: -14.6, w: DOOR_W, kind: 'door' }]); // south face, door onto spine
    this.wall('z', R_N, R_MAIN_N, SPLIT_N, [{ at: -5.0, w: DOOR_W, kind: 'door' }]); // internal wall, door between the pair
    this.wall('x', SPLIT_N + T / 2, R_W1, R_N, [{ at: -10.2, w: DOOR_W, kind: 'door' }]); // NW-B north face, door onto N corridor
    this.wall('x', SPLIT_N + T / 2, R_W1, R_MAIN_N, [{ at: -9.0, w: 1.6, kind: 'window' }]); // NW-B south face, window onto spine
    this.wall('z', R_N, R_MAIN_N, R_W1, [{ at: -7.2, w: 1.6, kind: 'window' }]); // east face, window onto mid corridor

    // ---- South-west pair, mirrored but not identical
    this.wall('z', R_MAIN_S, R_S, R_W0, [{ at: 7.0, w: 1.6, kind: 'window' }]); // west face, window onto W corridor
    this.wall('x', R_W0, SPLIT_S - T / 2, R_MAIN_S, [{ at: -17.4, w: DOOR_W, kind: 'door' }]); // north face, door onto spine
    this.wall('x', R_W0, SPLIT_S - T / 2, R_S, [{ at: -17.4, w: 1.6, kind: 'window' }]); // south face, window onto S corridor
    this.wall('z', R_MAIN_S, R_S, SPLIT_S); // internal wall, solid: the two halves are separate rooms
    this.wall('x', SPLIT_S + T / 2, R_W1, R_MAIN_S, [
      { at: -13.0, w: 1.6, kind: 'window' },
      { at: -8.6, w: DOOR_W, kind: 'door' }
    ]);
    this.wall('x', SPLIT_S + T / 2, R_W1, R_S, [{ at: -11.4, w: DOOR_W, kind: 'door' }]); // south face, door onto S corridor
    this.wall('z', R_MAIN_S, R_S, R_W1, [{ at: 4.6, w: DOOR_W, kind: 'door' }]); // east face, door onto mid corridor

    // ---- North-east: one long room with a partition part-way across, so it
    // has to be taken in two bites rather than seen all at once from the door
    this.wall('z', R_N, R_MAIN_N, R_E0, [{ at: -7.4, w: DOOR_W, kind: 'door' }]); // west face, door onto mid corridor
    this.wall('x', R_E0, R_E1, R_N, [
      { at: -0.6, w: 1.6, kind: 'window' },
      { at: 6.0, w: DOOR_W, kind: 'door' }
    ]);
    this.wall('x', R_E0, R_E1, R_MAIN_N, [
      { at: -1.4, w: DOOR_W, kind: 'door' },
      { at: 5.2, w: 1.6, kind: 'window' }
    ]);
    this.wall('z', R_N, R_MAIN_N, R_E1, [{ at: -3.6, w: DOOR_W, kind: 'door' }]); // east face, door onto E corridor
    // Interior partition, standing off both ends so you can walk round it
    this.solid(T, H, 4.4, 2.4, 0, -6.6);

    // ---- South-east: an L, with a blind corner that has to be cleared
    this.wall('z', R_MAIN_S, R_S, R_E0, [{ at: 3.0, w: DOOR_W, kind: 'door' }]);
    this.wall('x', R_E0, R_E1, R_MAIN_S, [
      { at: -1.0, w: 1.6, kind: 'window' },
      { at: 6.2, w: DOOR_W, kind: 'door' }
    ]);
    this.wall('x', R_E0, R_E1, R_S, [{ at: 1.6, w: DOOR_W, kind: 'door' }]);
    this.wall('z', R_MAIN_S, R_S, R_E1, [{ at: 7.4, w: 1.6, kind: 'window' }]);
    // The blind corner: a stub wall you cannot see behind from either door
    this.solid(5.0, H, T, 0.9, 0, 5.6);
    this.solid(T, H, 2.2, 3.4, 0, 6.7);

    this.buildPinches();
    // ---- The two narrow stores east of the east corridor
    this.wall('z', R_N, R_MAIN_N, V_EAST + CW, [{ at: -6.0, w: DOOR_W, kind: 'door' }]);
    this.wall('z', R_MAIN_S, R_S, V_EAST + CW, [{ at: 6.6, w: DOOR_W, kind: 'door' }]);
    this.wall('x', V_EAST + CW, X1, R_N);
    this.wall('x', V_EAST + CW, X1, R_MAIN_N);
    this.wall('x', V_EAST + CW, X1, R_MAIN_S);
    this.wall('x', V_EAST + CW, X1, R_S);
  }

  /**
   * Stubs projecting into the long corridor runs, from alternating sides.
   *
   * Without them the north and south corridors are 37m of dead straight
   * sightline, which is a shooting gallery rather than something to clear.
   * Each stub leaves a 2.1m gap on one side, so the run has to be taken as a
   * series of corners: cover to work up to, and a blind side beyond it.
   */
  private buildPinches(): void {
    const stub = (x: number, z: number, depth: number, axis: 'x' | 'z'): void => {
      if (axis === 'x') this.solid(T, H, depth, x, 0, z);
      else this.solid(depth, H, T, x, 0, z);
    };
    // North corridor: from the outer wall on one side, then the room side
    stub(-16.5, Z0 + T / 2 + 1.1, 2.2, 'x');
    stub(-8.5, H_NORTH + CW - 1.1, 2.2, 'x');
    stub(6.0, Z0 + T / 2 + 1.1, 2.2, 'x');
    // South corridor, offset from the north ones so the two are not the same
    stub(-18.0, H_SOUTH - CW + 1.1, 2.2, 'x');
    stub(-9.5, Z1 - T / 2 - 1.1, 2.2, 'x');
    stub(4.0, H_SOUTH - CW + 1.1, 2.2, 'x');
    // Main spine: one pinch either side of the middle junction
    stub(-16.0, H_MAIN - CW + 1.05, 2.1, 'x');
    stub(1.0, H_MAIN + CW - 1.05, 2.1, 'x');
    stub(-9.0, H_MAIN - CW + 1.05, 2.1, 'x');
    stub(7.0, H_MAIN - CW + 1.05, 2.1, 'x');
    // The three north-south runs are 25m end to end, so they get the same
    // treatment: a stub from alternating flanks at roughly third points.
    stub(V_WEST - CW + 1.1, -7.5, 2.2, 'z');
    stub(V_WEST + CW - 1.1, 6.0, 2.2, 'z');
    stub(V_MID + CW - 1.1, -6.5, 2.2, 'z');
    stub(V_MID - CW + 1.1, 6.5, 2.2, 'z');
    stub(V_EAST - CW + 1.1, -6.0, 2.2, 'z');
    stub(V_EAST + CW - 1.1, 8.8, 2.2, 'z');
    // A short dead-end alcove off the west corridor — somewhere to be missed
    this.solid(T, H, 2.4, V_WEST - CW + 1.9, 0, -4.4);
    this.solid(1.9, H, T, V_WEST - CW + 0.95, 0, -3.2);
  }

  // -------------------------------------------------------------- lighting

  /**
   * Ceiling fixtures. Every one is created up front and stays in the scene
   * for good — the blackout drops them to zero intensity rather than hiding
   * them, because the number of visible lights is baked into every material's
   * shader and changing it recompiles the whole level mid-fight.
   */
  private buildLighting(): void {
    this.group.add(new THREE.AmbientLight(0x3a3c44, 0.5));
    this.group.add(new THREE.HemisphereLight(0x8b8c96, 0x24262c, 0.35));

    const lamp = (x: number, z: number, intensity = 7, dist = 11): void => {
      const l = new THREE.PointLight(0xfff2dc, intensity, dist, 1.6);
      l.position.set(x, H - 0.22, z);
      this.group.add(l);
      this.lights.push(l);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x999999,
        emissive: 0xfff6e0,
        emissiveIntensity: 1.4
      });
      this.lampMats.push(mat);
      const fix = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 0.26), mat);
      fix.position.set(x, H - 0.08, z);
      this.group.add(fix);
    };

    // Approach corridor
    for (const x of [HALL_X0 + 3, HALL_X0 + 8, HALL_X0 + 13]) lamp(x, 0, 8, 12);
    // Corridor runs
    for (const x of [-21, -13, -5, 3, 10]) {
      lamp(x, H_NORTH);
      lamp(x, H_MAIN);
      lamp(x, H_SOUTH);
    }
    for (const z of [-7, 6]) {
      lamp(V_WEST, z);
      lamp(V_MID, z);
      lamp(V_EAST, z);
    }
    // One in each room, so a cleared room reads differently from a dark one
    for (const [x, z] of [
      [-16, -5.5], [-10, -5.5], [-17.4, 5.5], [-11, 5.5],
      [-0.5, -5.5], [5.5, -5.5], [-1.2, 3.4], [6.0, 4.0],
      [13.4, -5.5], [13.4, 5.5]
    ] as const) {
      lamp(x, z, 6, 9);
    }
  }

  // ------------------------------------------------------------- waypoints

  /** Corridor junctions and room centres, for whoever ends up patrolling. */
  /**
   * A walkable graph, built from the level rather than written by hand.
   *
   * The old version listed corridor junctions and room centres and joined
   * anything within nine metres of anything else. Nothing checked whether a
   * wall was in the way, so a room centre linked straight through its own
   * wall to the corridor beyond, and an agent routed along that link walked
   * face-first into the plaster and stayed there. That is the wall-hugging.
   *
   * Instead: sample the floor on a grid, keep every point a body actually
   * fits at, and join two points only when the whole width of a body can be
   * swept between them without touching anything. Corners cannot be cut,
   * doorways link only through the doorway, and there is no edge that leads
   * into a wall.
   */
  /**
   * A walkable graph, built from the level rather than written by hand.
   *
   * The old version listed corridor junctions and room centres and joined
   * anything within nine metres of anything else. Nothing checked whether a
   * wall was in the way, so a room centre linked straight through its own
   * wall to the corridor beyond, and an agent routed along that link walked
   * face-first into the plaster and stayed there. That is the wall-hugging.
   *
   * Instead: sample the floor, keep every point a body actually fits at, seed
   * in the doorways (1.5m is narrower than the sampling grid, so left to
   * chance the grid steps clean over a door and the rooms behind it come out
   * unreachable), and join two points only when a whole body can be swept
   * between them. Corners cannot be cut and no edge leads into a wall.
   */
  private makeWaypoints(): Waypoint[] {
    const R = 0.42; // body radius, with a little room so they do not scrape
    const STEP = 1.3;
    // The maze door is scripted open the moment the player has control, so
    // it must not divide the graph — leave it in and the approach corridor
    // comes out as its own island and gets thrown away.
    const walls = this.colliders
      .filter((c) => c !== this.mazeDoorCollider)
      .map((c) => c.box)
      .filter((b) => b.min.y < 1.6 && b.max.y > 0.4);

    const clear = (x: number, z: number, r = R): boolean => {
      for (const b of walls) {
        if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return false;
      }
      return true;
    };
    const walkable = (ax: number, az: number, bx: number, bz: number): boolean => {
      const dx = bx - ax;
      const dz = bz - az;
      const steps = Math.ceil(Math.hypot(dx, dz) / 0.18);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        // A shade wider along the run than at the nodes, so an edge cannot
        // shave a corner that a body would actually catch on.
        if (!clear(ax + dx * t, az + dz * t, R + 0.07)) return false;
      }
      return true;
    };

    const pts: [number, number][] = [];
    for (const d of this.doorPoints) if (clear(d[0], d[1])) pts.push(d);
    for (let x = X0 + 1.0; x <= X1 - 1.0; x += STEP) {
      for (let z = Z0 + 1.0; z <= Z1 - 1.0; z += STEP) {
        if (clear(x, z)) pts.push([x, z]);
      }
    }
    for (let x = HALL_X0 + 1.2; x <= HALL_X1; x += STEP) if (clear(x, 0)) pts.push([x, 0]);

    const wps: Waypoint[] = pts.map(([x, z]) => ({ pos: new THREE.Vector3(x, 0, z), links: [] }));
    const REACH = STEP * 2.3;
    for (let i = 0; i < wps.length; i++) {
      for (let j = i + 1; j < wps.length; j++) {
        const a = wps[i].pos;
        const b = wps[j].pos;
        if (a.distanceTo(b) > REACH) continue;
        if (!walkable(a.x, a.z, b.x, b.z)) continue;
        wps[i].links.push(j);
        wps[j].links.push(i);
      }
    }

    // Keep the biggest island. Anything else is a nook a body fits in but
    // cannot walk to, and routing somebody there would strand them.
    const seen = new Set<number>();
    let best: number[] = [];
    for (let i = 0; i < wps.length; i++) {
      if (seen.has(i)) continue;
      const comp: number[] = [];
      const queue = [i];
      seen.add(i);
      while (queue.length) {
        const cur = queue.pop()!;
        comp.push(cur);
        for (const n of wps[cur].links) {
          if (seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
        }
      }
      if (comp.length > best.length) best = comp;
    }
    const keep = best.sort((a, b) => a - b);
    const remap = new Map(keep.map((old, k) => [old, k]));
    return keep.map((old) => ({
      pos: wps[old].pos,
      links: wps[old].links.filter((n) => remap.has(n)).map((n) => remap.get(n)!)
    }));
  }
}
