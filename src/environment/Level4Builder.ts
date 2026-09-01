import * as THREE from 'three';
import { FlickeringLight } from './FlickeringLight';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BreakableGlass } from './BreakableGlass';
import {
  officeChair, trashCan, sodaCan, book, spilledCoffee, chipsBox, rubblePile, wallArt,
  flowerPot, coffeeTable, printer, vent, fireAlarm, breakTable, fileCabinet, paperStack,
  scatteredPaper, vendingMachine, microwave, kitchenSink, wallCupboards, toilet, toiletPaper,
  bathroomVanity, mirrorPanel, waterCooler, fridge, roomSign, deskMonitor,
  namePlate, deskPhone, pcTower, toiletStall, deskWithReturn, STALL_W, STALL_D
} from './OfficeProps';
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
  /** Hinge the leaf hangs on, so it can be swung rather than vanished. */
  mazeDoorPivot: THREE.Group;
  /** Index into `colliders`: everything below this is structure, not furniture. */
  wallColliders: number;
  /** Centre of every doorway, for the build check. */
  doorways: [number, number][];
  /** Staff who did not get out. */
  corpseSpawns: { pos: THREE.Vector3; yaw: number }[];
  /** World box of every prop, kept because the meshes get merged away. */
  dressingBoxes: THREE.Box3[];
  /** Where each wall-mounted item sits and which way it looks. */
  mountProbes: { pos: THREE.Vector3; yaw: number }[];
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
 * Washroom tile. Small squares with a darker grout line between them; the
 * floor version is greyer and a shade smaller, the way it usually is.
 */
function tileCanvas(floor: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const n = floor ? 8 : 6;
  const step = 128 / n;
  g.fillStyle = floor ? '#8d9298' : '#b9c3c6';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 1 + (Math.random() - 0.5) * (floor ? 0.1 : 0.06);
      const base = floor ? [141, 146, 152] : [185, 195, 198];
      g.fillStyle = `rgb(${base[0] * v | 0},${base[1] * v | 0},${base[2] * v | 0})`;
      g.fillRect(x * step + 1.2, y * step + 1.2, step - 2.4, step - 2.4);
    }
  }
  return c;
}

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
  private glassPanes: BreakableGlass[] = [];

  private carpetMat!: THREE.MeshLambertMaterial;
  private wallMat!: THREE.MeshLambertMaterial;
  private ceilMat!: THREE.MeshLambertMaterial;
  private darkMetalMat!: THREE.MeshLambertMaterial;
  private deskMat!: THREE.MeshLambertMaterial;
  private tileMat!: THREE.MeshLambertMaterial;
  private tileFloorMat!: THREE.MeshLambertMaterial;
  private stallMat!: THREE.MeshLambertMaterial;
  private stallDoorMat!: THREE.MeshLambertMaterial;
  private counterMat!: THREE.MeshLambertMaterial;
  private worktopMat!: THREE.MeshLambertMaterial;
  private mazeDoor!: THREE.Mesh;
  private mazeDoorPivot!: THREE.Group;
  private mazeDoorCollider!: Collider;
  /**
   * The centre of every doorway cut into a wall, with the two points either
   * side of it. Seeded into the nav graph — a 1.5m opening is narrower than
   * the sampling grid, so left to chance the grid steps straight over a door
   * and the rooms behind it come out unreachable.
   */
  private doorPoints: [number, number][] = [];
  /** How many colliders are walls rather than furniture. */
  private wallColliders = 0;
  private dressingBoxes: THREE.Box3[] = [];
  private mountProbes: { pos: THREE.Vector3; yaw: number }[] = [];

  build(): Level4Data {
    this.makeMaterials();
    this.buildApproach();
    this.buildShell();
    this.buildRooms();
    this.buildLighting();
    this.buildDressing();
    this.mergeDressing();

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      occluders: this.occluders,
      waypoints: this.makeWaypoints(),
      flickering: this.flickering,
      glassPanes: this.glassPanes,
      playerSpawn: new THREE.Vector3(HALL_X0 + 1.6, 0, 0),
      playerSpawnYaw: -Math.PI / 2, // facing east, down the corridor
      // Propped against the north wall of the approach, most of the way along
      woundedSpot: new THREE.Vector3(-29.5, 0, HALL_Z0 + 0.42),
      woundedYaw: Math.PI, // facing south, across the corridor at the player
      talkX: -32.5,
      backDoorway: new THREE.Vector3(HALL_X0 + 0.4, 0, 0),
      mazeDoor: this.mazeDoor,
      mazeDoorPivot: this.mazeDoorPivot,
      wallColliders: this.wallColliders,
      doorways: this.doorPoints.filter((_, i) => i % 3 === 1),
      // Staff caught on the floor when the team came through. Kept out on open
      // carpet so the ragdoll has somewhere to settle.
      dressingBoxes: this.dressingBoxes,
      mountProbes: this.mountProbes,
      corpseSpawns: [
        { pos: new THREE.Vector3(-17.6, 0, -4.6), yaw: 1.1 },
        { pos: new THREE.Vector3(-9.2, 0, -3.1), yaw: -2.2 },
        { pos: new THREE.Vector3(2.6, 0, -4.2), yaw: 0.4 },
        { pos: new THREE.Vector3(-4.6, 0, 3.6), yaw: 2.7 },
        { pos: new THREE.Vector3(13.2, 0, -3.4), yaw: -0.6 },
        { pos: new THREE.Vector3(-21.4, 0, -10.4), yaw: 1.9 }
      ],
      mazeDoorCollider: this.mazeDoorCollider,
      // One to a room or junction, facing along the run they are covering,
      // so the first thing the player meets is a beam and not a body.
      enemySpawns: [
        // One to a room, working back to front, so the far half of the floor
        // is held as well as the near half. Yaw faces the way each is
        // covering, which is what puts a beam in the doorway before a body.
        { pos: new THREE.Vector3(-16.2, 0, -5.6), yaw: Math.PI / 2 }, // NW-A
        { pos: new THREE.Vector3(-8.8, 0, -8.6), yaw: 0 }, // NW-B
        { pos: new THREE.Vector3(-16.6, 0, 8.2), yaw: Math.PI }, // SW washroom
        { pos: new THREE.Vector3(-11.4, 0, 6.0), yaw: -Math.PI / 2 }, // SW-B
        { pos: new THREE.Vector3(-0.8, 0, -6.2), yaw: Math.PI / 2 }, // NE west bay
        { pos: new THREE.Vector3(5.0, 0, -5.2), yaw: -Math.PI / 2 }, // NE east bay
        { pos: new THREE.Vector3(-1.8, 0, 4.6), yaw: 0 }, // SE, near side
        { pos: new THREE.Vector3(5.8, 0, 7.6), yaw: Math.PI }, // SE blind corner
        { pos: new THREE.Vector3(13.9, 0, -5.5), yaw: Math.PI / 2 }, // east store, north
        { pos: new THREE.Vector3(13.9, 0, 5.5), yaw: -Math.PI / 2 }, // east store, south
        { pos: new THREE.Vector3(V_EAST, 0, -8.6), yaw: Math.PI }, // east corridor
        { pos: new THREE.Vector3(3.0, 0, H_SOUTH), yaw: Math.PI / 2 } // south corridor
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
    this.tileMat = new THREE.MeshLambertMaterial({ map: makeTex(tileCanvas(false), 3, 2) });
    this.tileFloorMat = new THREE.MeshLambertMaterial({ map: makeTex(tileCanvas(true), 5, 9) });
    this.stallMat = new THREE.MeshLambertMaterial({ color: 0x9aa7ad });
    this.stallDoorMat = new THREE.MeshLambertMaterial({ color: 0xa8b4b9 });
    this.counterMat = new THREE.MeshLambertMaterial({ color: 0x8a7457 });
    this.worktopMat = new THREE.MeshLambertMaterial({ color: 0x2f333a });
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
        this.glass(axis, s, e, cross, WIN_SILL, WIN_HEAD - WIN_SILL);
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
    // Re-hang the leaf on a hinge at its north edge. solid() centres a mesh on
    // its own origin, which is no use for a door: swinging that just spins it
    // about its middle.
    this.mazeDoorPivot = new THREE.Group();
    this.mazeDoorPivot.position.set(X0 + 0.12, 0, -0.96);
    this.group.remove(this.mazeDoor);
    this.mazeDoor.position.set(0, this.mazeDoor.position.y, 0.96);
    this.mazeDoorPivot.add(this.mazeDoor);
    this.group.add(this.mazeDoorPivot);
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
    // Solid: this block is the washroom, and a window into a row of cubicles
    // is not something an office has.
    this.wall('z', R_MAIN_S, R_S, R_W0); // west face
    this.wall('x', R_W0, SPLIT_S - T / 2, R_MAIN_S, [{ at: -17.4, w: DOOR_W, kind: 'door' }]); // north face, door onto spine
    this.wall('x', R_W0, SPLIT_S - T / 2, R_S); // south face, solid for the same reason
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
    // Moved off 7.4: at that height it lined up with the washroom door across
    // the corridor, so the window looked straight into a row of cubicles.
    this.wall('z', R_MAIN_S, R_S, R_E1, [{ at: 8.2, w: 1.6, kind: 'window' }]);
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
    // Deliberately under-lit even before the blackout: the point of this floor
    // is the torches, and at the old levels you could read the far end of a
    // corridor without one.
    this.group.add(new THREE.AmbientLight(0x3a3c44, 0.34));
    this.group.add(new THREE.HemisphereLight(0x8b8c96, 0x24262c, 0.22));

    const lamp = (x: number, z: number, intensity = 5, dist = 10): void => {
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
    for (const x of [HALL_X0 + 3, HALL_X0 + 8, HALL_X0 + 13]) lamp(x, 0, 6, 11);
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
      lamp(x, z, 4.2, 8);
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
  /** Glazed pane in a window opening: stops movement, not vision. */
  private glass(axis: 'x' | 'z', a0: number, a1: number, cross: number, yBase: number, h: number): void {
    const width = a1 - a0;
    const pane = new BreakableGlass(width, h, axis);
    if (axis === 'x') pane.group.position.set((a0 + a1) / 2, yBase + h / 2, cross);
    else pane.group.position.set(cross, yBase + h / 2, (a0 + a1) / 2);
    this.group.add(pane.group);
    this.shootables.push(pane.mesh);
    this.glassPanes.push(pane);
    const box =
      axis === 'x'
        ? new THREE.Box3(new THREE.Vector3(a0, yBase, cross - 0.06), new THREE.Vector3(a1, yBase + h, cross + 0.06))
        : new THREE.Box3(new THREE.Vector3(cross - 0.06, yBase, a0), new THREE.Vector3(cross + 0.06, yBase + h, a1));
    pane.colliderIndex = this.colliders.length;
    this.colliders.push({ box, glass: pane });
  }

  // ------------------------------------------------------------- dressing

  /**
   * Drop a prop into the level. Props are shootable so a beam or a stray
   * round finds them, but deliberately NOT occluders: the beam probe casts
   * five rays per agent per frame against that list, and putting a few
   * hundred chair legs on it to buy slightly better shadows is not a trade
   * worth making.
   */
  private prop(o: THREE.Object3D, x: number, z: number, yaw = 0, y = 0): THREE.Object3D {
    o.position.set(x, y, z);
    o.rotation.y = yaw;
    // Tagged so the build check can measure it against the walls. A chair half
    // inside a desk is not something a coordinate list shows you.
    o.userData.placed = true;
    this.group.add(o);
    o.traverse((n) => {
      if ((n as THREE.Mesh).isMesh) this.shootables.push(n);
    });
    return o;
  }

  /**
   * A movement blocker with no mesh of its own, for furniture you should not
   * be able to walk through. Kept a good stride clear of every doorway — the
   * nav graph is rebuilt from these, and a desk parked in a door would strand
   * a whole room.
   */
  private block(x: number, z: number, w: number, d: number, h = 1.0): void {
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2))
    });
  }

  /**
   * Hang something flat on a wall, facing `yaw`.
   *
   * Tagged so the build check can cast a ray back along the facing and prove
   * there is actually a wall behind it — a picture placed a metre off in the
   * middle of a corridor is invisible in code review and obvious in play.
   */
  private onWall(o: THREE.Object3D, x: number, y: number, z: number, yaw: number): void {
    o.position.set(x, y, z);
    o.rotation.y = yaw;
    o.userData.mounted = true;
    this.group.add(o);
    o.traverse((n) => {
      if ((n as THREE.Mesh).isMesh) this.shootables.push(n);
    });
  }

  /** The plaque beside a door, on the corridor side of it. */
  private sign(label: string, sub: string, x: number, z: number, yaw: number): void {
    this.onWall(roomSign(label, sub), x, 2.02, z, yaw);
  }

  /**
   * Tile a washroom: floor, and a wainscot of wall tile all the way round.
   *
   * The panels have to be broken where a doorway is. Drawn as four solid
   * walls, the tile papers straight over the opening — from the corridor the
   * door reads as a hole you can walk through, and from inside the room it is
   * a tiled wall.
   */
  private tileRoom(x0: number, x1: number, z0: number, z1: number): void {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), this.tileFloorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
    this.group.add(floor);
    // Tile up to 2m, which is where a real one stops and paint takes over
    const HT = 2.0;
    const panel = (w: number, px: number, pz: number, yaw: number): void => {
      if (w < 0.06) return;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, HT), this.tileMat);
      m.position.set(px, HT / 2, pz);
      m.rotation.y = yaw;
      this.group.add(m);
      this.shootables.push(m);
    };
    /**
     * One face, split around any doorway that lands on it. `along` is the
     * axis the wall runs on; the doorways are matched by their other
     * coordinate sitting on this face.
     */
    const face = (axis: 'x' | 'z', a0: number, a1: number, cross: number, yaw: number): void => {
      const gaps = this.doorPoints
        .filter((_, i) => i % 3 === 1)
        .filter((d) => Math.abs((axis === 'x' ? d[1] : d[0]) - cross) < 0.35)
        .map((d) => (axis === 'x' ? d[0] : d[1]))
        .filter((c) => c > a0 - 0.9 && c < a1 + 0.9)
        .sort((m, n) => m - n);
      let cursor = a0;
      for (const c of gaps) {
        const s0 = Math.max(a0, c - 0.95);
        const e0 = Math.min(a1, c + 0.95);
        if (s0 > cursor) {
          if (axis === 'x') panel(s0 - cursor, (cursor + s0) / 2, cross, yaw);
          else panel(s0 - cursor, cross, (cursor + s0) / 2, yaw);
        }
        cursor = Math.max(cursor, e0);
      }
      if (a1 > cursor) {
        if (axis === 'x') panel(a1 - cursor, (cursor + a1) / 2, cross, yaw);
        else panel(a1 - cursor, cross, (cursor + a1) / 2, yaw);
      }
    };
    face('x', x0, x1, z0 + 0.01, 0);
    face('x', x0, x1, z1 - 0.01, Math.PI);
    face('z', z0, z1, x0 + 0.01, Math.PI / 2);
    face('z', z0, z1, x1 - 0.01, -Math.PI / 2);
  }

  /**
   * A washroom: a row of pans against one long wall with dividers between
   * them, and a vanity of basins and mirror facing them.
   *
   * `wallX` is the wall the pans back onto and `dir` which way they face
   * (+1 for east, -1 for west), so the same routine does both washrooms on
   * the floor whichever side of the room the plumbing is on.
   */
  /**
   * A washroom: a row of enclosed cubicles down one wall, with a vanity and
   * mirror further along the same wall.
   *
   * Every fixture goes on the SAME side. These rooms are only 3.4m across,
   * and pans down one side facing a vanity down the other left a walkway too
   * narrow for a body — the nav sampler found nothing it could stand on and
   * the whole room dropped off the graph.
   */
  private washroom(x0: number, x1: number, z0: number, z1: number, dir: 1 | -1): void {
    this.tileRoom(x0, x1, z0, z1);
    const wallX = dir > 0 ? x0 : x1;
    // Each cubicle is one prop facing +Z in its own space, so this is a single
    // rotation rather than a dozen hand-placed panels. The hand-placed version
    // hung its doors so they swung into the cubicle next door.
    const yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    const midX = wallX + dir * (STALL_D / 2);

    // Three in a row, started well down the room so the doorway stays walkable
    // Two, not three: the third pushed the first up against the doorway and
    // you clipped its corner walking in.
    const zs = [z0 + 2.95, z0 + 4.15];
    for (let i = 0; i < zs.length; i++) {
      this.prop(toiletStall(i === 1 ? 0.95 : 0.42), midX, zs[i], yaw);
      this.block(midX, zs[i], STALL_D, STALL_W + 0.09, 2.15);
    }

    // Vanity and mirror further along the same wall
    const vz = z0 + 6.4;
    this.prop(bathroomVanity(1.4, 2), wallX + dir * 0.3, vz, yaw);
    this.block(wallX + dir * 0.3, vz, 0.62, 1.5, 0.95);
    this.onWall(mirrorPanel(1.3, 0.9), wallX + dir * 0.07, 1.52, vz, yaw);
    this.prop(trashCan(), wallX + dir * 1.75, z1 - 0.55);
    this.prop(scatteredPaper(3, 0.5), wallX + dir * 1.9, z0 + 0.9);
  }

  /**
   * A desk, its chair, and the clutter of whoever was sitting at it.
   *
   * `yaw` is the way the OCCUPANT faces, so the desk turns to face them.
   */
  private workstation(x: number, z: number, yaw: number, who = '', role = ''): void {
    const ret: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    this.prop(deskWithReturn(1.85, 1.15, ret), x, z, yaw);
    this.block(x, z, 1.95, 0.9, 0.78);
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    // Block the return too, or you can walk straight through it
    this.block(x + side.x * ret * 0.5 + fwd.x * -0.95, z + side.z * ret * 0.5 + fwd.z * -0.95, 0.9, 1.2, 0.78);
    // Chair tucked in behind the desk, clear of the top. At 0.95 it was
    // sitting half inside it.
    // Offset away from the return, or the chair sits half inside it
    const cx = x - fwd.x * 1.05 - side.x * ret * 0.34;
    const cz = z - fwd.z * 1.05 - side.z * ret * 0.34;
    this.prop(officeChair(), cx, cz, yaw + Math.PI + (Math.random() - 0.5) * 0.35);
    this.block(cx, cz, 0.62, 0.62, 0.9);
    const at = (a: number, b: number): [number, number] => [
      x + side.x * a - fwd.x * b,
      z + side.z * a - fwd.z * b
    ];
    let q = at(0.34, -0.1);
    this.prop(deskMonitor(), q[0], q[1], yaw, 0.76);
    q = at(-0.62, -0.12);
    this.prop(deskPhone(), q[0], q[1], yaw + 0.3, 0.76);
    // Under the desk, not behind it — at -1.0 it ended up inside the wall
    q = at(ret * 0.55, -0.16);
    this.prop(pcTower(), q[0], q[1], yaw);
    if (who) {
      // Turned outward. At `yaw` it faced the chair, which is the one person
      // in the building who already knows whose desk it is.
      q = at(-0.12, 0.3);
      this.prop(namePlate(who, role), q[0], q[1], yaw + Math.PI, 0.76);
    }
    q = at(-0.78, 0.14);
    this.prop(paperStack(6), q[0], q[1], Math.random() * 3, 0.76);
  }

  /** Counter run: cupboards over, worktop under, and something on it. */
  private kitchenRun(x: number, z: number, yaw: number): void {
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.86, 0.6), this.counterMat);
    base.position.set(0, 0.43, 0);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.05, 0.64), this.worktopMat);
    top.position.set(0, 0.885, 0);
    const run = new THREE.Group();
    run.add(base, top);
    this.prop(run, x, z, yaw);
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.block(x, z, Math.abs(fwd.z) > 0.5 ? 2.66 : 0.64, Math.abs(fwd.z) > 0.5 ? 0.64 : 2.66, 0.92);
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    // Turned through 180: the sink's taps are on its -Z face, so at the
    // counter's own yaw it stood with the taps against the wall.
    this.prop(kitchenSink(), x - side.x * 0.7, z - side.z * 0.7, yaw + Math.PI, 0.91);
    this.prop(microwave(), x + side.x * 0.85, z + side.z * 0.85, yaw, 0.91);
    this.prop(wallCupboards(2.2), x - fwd.x * 0.12, z - fwd.z * 0.12, yaw, 1.55);
  }

  /**
   * Fold the dressing down to one mesh per material.
   *
   * Every prop is a group of ten to twenty little meshes, and on the long
   * sightlines that is 1205 of 2040 draw calls — measured at 17ms a frame,
   * of which hiding the props alone gave back 10. It is draw-call bound and
   * not light bound: pulling all 39 point lights out of the scene saved under
   * a millisecond.
   *
   * None of this furniture moves, so it can all be baked. The world boxes are
   * kept first, because the build checks measure props against the walls and
   * there are no individual props left afterwards to measure.
   */
  private mergeDressing(): void {
    this.group.updateMatrixWorld(true);
    const roots = this.group.children.filter((o) => o.userData.placed || o.userData.mounted);
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const spent: THREE.Mesh[] = [];

    for (const root of roots) {
      this.dressingBoxes.push(new THREE.Box3().setFromObject(root));
      if (root.userData.mounted) {
        this.mountProbes.push({ pos: root.getWorldPosition(new THREE.Vector3()), yaw: root.rotation.y });
      }
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        // Multi-material meshes (the book covers) and sprites stay as they are
        if (!m.isMesh || Array.isArray(m.material) || !m.geometry) return;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        const mat = m.material as THREE.Material;
        const list = buckets.get(mat);
        if (list) list.push(g);
        else buckets.set(mat, [g]);
        spent.push(m);
      });
    }

    let merged = 0;
    for (const [mat, geos] of buckets) {
      // Every bucket gets rebuilt, including the ones holding a single mesh.
      // Skipping those and then deleting the originals anyway is how the
      // pictures disappeared: each artwork has a material of its own, so its
      // bucket has one entry, so it was never rebuilt and never came back.
      // Everything has to agree on its attributes before it can be merged
      const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
      const keys = Object.keys(flat[0].attributes).sort().join(',');
      if (!flat.every((g) => Object.keys(g.attributes).sort().join(',') === keys)) continue;
      const one = mergeGeometries(flat, false);
      if (!one) continue;
      const mesh = new THREE.Mesh(one, mat);
      mesh.userData.surface = 'wood';
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.shootables.push(mesh);
      merged++;
      for (const g of geos) g.dispose();
    }
    if (merged === 0) return;

    // Drop what was folded in, from the scene and from the bullet targets
    const gone = new Set<THREE.Object3D>(spent);
    for (const root of roots) root.removeFromParent();
    this.shootables = this.shootables.filter((o) => !gone.has(o));
  }

  private buildDressing(): void {
    // Everything before this point is structure; everything after is
    // furniture. The check needs to tell them apart.
    this.wallColliders = this.colliders.length;
    this.dressOffices();
    this.dressBreakRooms();
    this.dressWashrooms();
    this.dressSupply();
    this.dressCorridors();
  }

  private dressOffices(): void {
    // ---- OFFICE 401, north-west corner. Door west at z=-6.4, door south at
    // x=-14.6, so everything lives along the north and east walls.
    this.workstation(-16.9, -8.45, 0, 'D. MEHRA', 'RETENTIONS');
    this.prop(fileCabinet(0.6, 1.5, 1.2, 4), -13.45, -7.8, 0);
    this.block(-13.45, -7.8, 0.6, 1.2, 1.5);
    this.prop(fileCabinet(0.6, 1.5, 1.0, 4), -13.45, -2.9, 0);
    this.block(-13.45, -2.9, 0.6, 1.0, 1.5);
    this.prop(printer(), -18.6, -3.4, Math.PI / 2, 0);
    this.block(-18.6, -3.4, 0.75, 0.8, 0.62);
    this.onWall(wallArt('thumbsup'), -13.2, 1.75, -4.2, -Math.PI / 2);
    this.prop(flowerPot('tall'), -13.6, -2.4);
    this.prop(trashCan(), -18.6, -8.6);
    this.prop(scatteredPaper(5, 0.9), -17.2, -4.4);
    this.sign('OFFICE 401', '', -19.34, -5.3, -Math.PI / 2);

    // ---- OFFICE 402, the big south-west room. One desk, and the filing the
    // rest of the floor evidently sends here.
    this.workstation(-13.6, 3.9, Math.PI, 'P. OKONKWO', 'FLOOR MANAGER');
    for (let i = 0; i < 3; i++) {
      this.prop(fileCabinet(0.6, 1.5, 1.0, 4), -15.18, 5.6 + i * 1.1, Math.PI);
      this.block(-15.18, 5.6 + i * 1.1, 0.6, 1.0, 1.5);
    }
    this.prop(printer(), -8.0, 8.5, Math.PI, 0);
    this.block(-8.0, 8.5, 0.8, 0.75, 0.62);
    this.prop(coffeeTable(), -9.6, 6.4);
    this.block(-9.6, 6.4, 0.9, 0.6, 0.45);
    this.prop(officeChair(), -9.6, 5.4, Math.PI);
    this.prop(officeChair(), -9.6, 7.4, 0);
    this.prop(book('comic'), -9.5, 6.4, 1.1, 0.44);
    this.prop(sodaCan(), -9.9, 6.6, 0, 0.44);
    this.onWall(wallArt('ourhome'), -9.0, 1.72, 8.96, Math.PI);
    this.prop(flowerPot('bushy'), -7.4, 8.6);
    this.prop(scatteredPaper(6, 1.1), -12.4, 4.6);
    this.sign('OFFICE 402', '', -7.3, 1.66, Math.PI);

    // ---- OFFICE 403 / 404, the long north-east room split by its partition
    // Clear of the west door: at -1.6 the desk reached to within half a metre
    // of the opening and you could not get past it into the room.
    this.workstation(0.6, -8.1, 0, 'S. AHMED', 'COMPLIANCE');
    this.prop(fileCabinet(0.6, 1.5, 1.4, 4), 1.5, -8.78, Math.PI / 2);
    this.block(1.5, -8.78, 1.4, 0.6, 1.5);
    this.prop(printer(), -2.5, -3.0, Math.PI / 2, 0);
    this.block(-2.5, -3.0, 0.75, 0.8, 0.62);
    this.onWall(wallArt('coast'), -2.9, 1.72, -5.4, Math.PI / 2);
    this.prop(trashCan(), -2.5, -2.6);
    this.prop(scatteredPaper(4, 0.8), -0.4, -4.0);

    // And clear of the north door, which this one was standing in
    this.workstation(4.0, -8.1, 0, 'T. LARSSON', 'ACCOUNTS');
    this.prop(fileCabinet(0.6, 1.5, 1.2, 4), 7.78, -7.4, 0);
    this.block(7.78, -7.4, 0.6, 1.2, 1.5);
    this.prop(fileCabinet(0.6, 1.5, 1.0, 4), 7.78, -5.9, 0);
    this.block(7.78, -5.9, 0.6, 1.0, 1.5);
    this.onWall(wallArt('peaks'), 7.95, 1.72, -5.5, -Math.PI / 2);
    this.prop(flowerPot('dying'), 7.6, -2.5);
    this.prop(spilledCoffee(), 4.2, -3.4);
    this.sign('OFFICE 403', '', -3.34, -8.6, -Math.PI / 2);
    this.sign('OFFICE 404', '', 6.9, -9.34, Math.PI);
  }

  private dressBreakRooms(): void {
    // ---- BREAK ROOM, north-west. Kitchen along the south wall, table in the
    // middle, machines against the west one.
    this.kitchenRun(-10.4, -2.35, 0);
    this.prop(fridge(), -12.3, -2.4, Math.PI);
    this.block(-12.3, -2.4, 0.72, 0.7, 1.75);
    // breakTable comes with its own four seats — adding chairs round it put
    // them straight through the ones already there.
    this.prop(breakTable(), -9.5, -6.0);
    this.block(-9.5, -6.0, 2.2, 2.2, 0.78);
    this.prop(book('comic'), -10.2, -5.4, 0.3, 0.76);
    this.prop(chipsBox(), -9.5, -5.8, 1.2, 0.76);
    this.prop(sodaCan(), -9.6, -5.3, 0, 0.76);
    this.prop(sodaCan(), -10.4, -5.9, 0, 0.76);
    for (let i = 0; i < 2; i++) {
      this.prop(vendingMachine(), -12.35, -8.4 + i * 1.4, -Math.PI / 2);
      this.block(-12.35, -8.4 + i * 1.4, 0.85, 1.3, 2.0);
    }
    this.prop(trashCan(), -7.4, -2.5);
    this.prop(waterCooler(), -7.4, -8.6);
    this.block(-7.4, -8.6, 0.4, 0.4, 1.0);
    this.onWall(wallArt('dunes'), -8.2, 1.72, -9.0, 0);
    this.prop(scatteredPaper(4, 0.7), -8.4, -6.2);
    this.sign('BREAK ROOM', '', -11.7, -9.34, Math.PI);

    // ---- BREAK ROOM 2, south-east, in front of its blind corner
    this.prop(breakTable(), 0.6, 3.6);
    this.block(0.6, 3.6, 2.2, 2.2, 0.78);
    this.prop(chipsBox(), 0.1, 3.2, 0.5, 0.76);
    this.prop(book('comic'), 0.7, 3.6, 2.2, 0.76);
    this.prop(sodaCan(), 0.9, 3.1, 0, 0.76);
    this.kitchenRun(3.0, 2.25, Math.PI);
    this.prop(fridge(), 7.4, 2.4, 0);
    this.block(7.4, 2.4, 0.72, 0.7, 1.75);
    // Off the west wall entirely: the gap beside the stub is the only way
    // round into the blind corner, and a machine parked in it sealed the lot.
    this.prop(vendingMachine(), 7.7, 5.9, Math.PI / 2);
    this.block(7.7, 5.9, 0.85, 1.3, 2.0);
    this.prop(vendingMachine(), 6.5, 8.45, 0);
    this.block(6.5, 8.45, 1.3, 0.85, 2.0);
    this.prop(waterCooler(), 7.6, 4.6);
    this.block(7.6, 4.6, 0.4, 0.4, 1.0);
    this.onWall(wallArt('thumbsup'), 7.95, 1.75, 3.4, -Math.PI / 2);
    // The blind corner behind the stub: crates and the overflow filing
    this.prop(fileCabinet(0.6, 1.5, 1.4, 4), -2.78, 7.6, Math.PI);
    this.block(-2.78, 7.6, 0.6, 1.4, 1.5);
    this.prop(scatteredPaper(7, 1.2), 0.6, 7.2);
    this.prop(trashCan(), 7.6, 8.5);
    this.prop(spilledCoffee(), 5.0, 7.0);
    this.sign('BREAK ROOM', '', -3.34, 3.9, -Math.PI / 2);
  }

  private dressWashrooms(): void {
    // South-west: pans back onto the west wall
    this.washroom(-19.08, -15.72, 1.92, 9.08, 1);
    this.sign('RESTROOM', '', -16.4, 1.66, Math.PI);
    // East store, south: pans back onto the east wall
    this.washroom(11.92, 15.88, 1.92, 9.08, -1);
    this.sign('RESTROOM', '', 11.66, 5.6, -Math.PI / 2);
  }

  private dressSupply(): void {
    // The north store: where the printers and the paper live
    for (let i = 0; i < 3; i++) {
      this.prop(fileCabinet(0.6, 1.5, 1.2, 4), 15.58, -8.2 + i * 1.35, 0);
      this.block(15.58, -8.2 + i * 1.35, 0.6, 1.2, 1.5);
    }
    // On the bench, not stacked on top of the filing
    this.prop(printer(), 12.3, -7.4, Math.PI / 2, 0.9);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 3.2), this.counterMat);
    // Clear of the door at z=-6.0: a bench across it seals the room off.
    bench.position.set(12.3, 0.45, -8.1);
    this.group.add(bench);
    this.shootables.push(bench);
    this.block(12.3, -8.1, 0.6, 1.8, 0.9);
    this.prop(printer(), 12.3, -8.4, Math.PI / 2, 0.9);
    this.prop(paperStack(9, 0.05), 12.3, -7.6, 0.4, 0.9);
    this.prop(paperStack(7, 0.07), 12.35, -8.9, 1.9, 0.9);
    this.prop(scatteredPaper(8, 1.3), 13.6, -7.2);
    this.prop(trashCan(), 12.4, -2.5);
    this.sign('SUPPLY', '405', 11.66, -5.0, -Math.PI / 2);
  }

  /**
   * The corridors. Coolers and alarms at the junctions, a few pictures on the
   * long runs, and litter where people cut corners.
   */
  private dressCorridors(): void {
    // The taps are on the +Z face, so yaw is the way the jug looks. Half of
    // these were turned into the wall behind them, and three were measured off
    // a wall that stops short, leaving them stood in the middle of the floor.
    const coolers: [number, number, number][] = [
      [X0 + T / 2 + 0.26, -1.2, Math.PI / 2], // west corridor, outer wall
      [R_E0 - T / 2 - 0.26, -3.0, -Math.PI / 2], // mid corridor, room wall
      [R_E1 + T / 2 + 0.26, 2.4, Math.PI / 2], // east corridor, room wall
      [-13.6, Z0 + T / 2 + 0.26, 0], // north corridor, outer wall
      [2.2, Z1 - T / 2 - 0.26, Math.PI], // south corridor, outer wall
      [-18.4, R_MAIN_N - T / 2 - 0.26, 0], // main spine, room wall
      [R_W1 + T / 2 + 0.26, 8.4, Math.PI / 2], // mid corridor, room wall
      [HALL_X0 + 13.2, HALL_Z0 + T / 2 + 0.26, 0]
    ];
    for (const [x, z, yaw] of coolers) {
      this.prop(waterCooler(), x, z, yaw);
      this.block(x, z, 0.42, 0.42, 1.0);
    }

    // Measured off the corridor FACE of a wall that reaches this far, and
    // turned to face the corridor. Four of these were previously buried in
    // the plaster and two were stuck to a wall that stops short of them.
    const alarms: [number, number, number][] = [
      [X0 + T / 2 + 0.02, -8.4, Math.PI / 2],
      [R_W1 + T / 2 + 0.02, 7.2, Math.PI / 2],
      [V_EAST + CW - T / 2 - 0.02, -2.4, -Math.PI / 2],
      [-6.4, Z0 + T / 2 + 0.02, 0],
      [4.6, Z1 - T / 2 - 0.02, Math.PI],
      [HALL_X0 + 5.5, HALL_Z0 + T / 2 + 0.02, 0]
    ];
    for (const [x, z, yaw] of alarms) this.onWall(fireAlarm(), x, 1.45, z, yaw);

    const vents: [number, number, number][] = [
      [-21, Z0 + T / 2 + 0.02, 0],
      [3.4, R_MAIN_S - T / 2 - 0.02, Math.PI],
      [V_EAST + CW - T / 2 - 0.02, 7.2, -Math.PI / 2]
    ];
    for (const [x, z, yaw] of vents) this.onWall(vent(), x, 2.5, z, yaw);

    // Every one of these is measured off the face of a wall that is actually
    // there. The first pass put four of them either inside the plaster or
    // floating in the middle of a corridor with nothing behind them.
    const art: [Parameters<typeof wallArt>[0], number, number, number][] = [
      ['dunes', -18.2, Z0 + T / 2 + 0.02, 0], // north corridor, outer wall
      ['coast', -2.0, Z1 - T / 2 - 0.02, Math.PI], // south corridor, outer wall
      ['peaks', R_W0 - T / 2 - 0.02, 4.4, -Math.PI / 2], // west corridor, room wall
      ['ourhome', -4.0, Z0 + T / 2 + 0.02, 0], // north corridor, outer wall
      // South side of the spine: the north side has a pinch stub standing
      // directly in front of this stretch of wall, hiding whatever hangs on it.
      ['upperfloor', 2.5, R_MAIN_S - T / 2 - 0.02, Math.PI], // main spine, room wall
      ['house', HALL_X0 + 9.0, HALL_Z1 - T / 2 - 0.02, Math.PI]
    ];
    for (const [k, x, z, yaw] of art) this.onWall(wallArt(k), x, 1.72, z, yaw);

    for (const [x, z] of [
      [-21, -4.2], [-13.2, H_NORTH], [-5, 8.4], [4.2, H_MAIN], [V_EAST, -9.6],
      [-17.6, H_SOUTH], [0.8, H_NORTH], [HALL_X0 + 11, 1.2]
    ] as const) {
      this.prop(scatteredPaper(3 + Math.floor(Math.random() * 4), 0.9), x, z);
    }
    for (const [x, z] of [[-21, 6.6], [-5, -4.4], [V_EAST, 4.8], [-9.4, H_NORTH]] as const) {
      this.prop(sodaCan(), x + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6, Math.random() * 3);
    }
    this.prop(chipsBox(), -16.4, H_MAIN + 1.2, 0.8);
    this.prop(spilledCoffee(), -3.4, H_NORTH + 0.6);
    this.prop(flowerPot('tall'), V_WEST - CW + 0.42, -1.9);
    this.prop(flowerPot('bushy'), V_EAST + CW - 0.42, 10.0);
    this.prop(trashCan(), V_MID + CW - 0.42, 11.4);
  }

}
