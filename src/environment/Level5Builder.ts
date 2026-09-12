import * as THREE from 'three';
import type { BreakableGlass } from './BreakableGlass';
import { Collider, noiseCanvas, ceilingTileCanvas, makeTex } from './OfficeLevelBuilder';
import { vent } from './OfficeProps';
import {
  pipe, duct, cable, barrel, controlConsole, electricalBox, generator, cageLamp, ceilingFixture,
  warningSign, debrisPlatform, rubble, mainBreaker
} from './MechanicalProps';
import { mergeStatic } from './mergeStatic';

/** Everything the scene needs to drive one lift car. */
export interface ElevatorCar {
  /** Where the car's doors sit: the west face of the car, at z = 0. */
  doorX: number;
  leftDoor: THREE.Mesh;
  rightDoor: THREE.Mesh;
  /** Spans the opening; live only while the doors are shut. */
  doorCollider: Collider;
  /** The control panel plate, which is what E has to be aimed at. */
  panel: THREE.Object3D;
  /** Each button's lamp, by label: '5' … '1', and 'MR'. */
  buttons: Map<string, THREE.MeshStandardMaterial>;
  /** The floor display above the door, and the faces it can show. */
  indicator: THREE.MeshBasicMaterial;
  indicatorFaces: Record<'2' | '1' | 'MR' | 'down', THREE.Texture>;
  /** Inside the car, for "has he stepped in yet". */
  interior: THREE.Box3;
}

export interface Level5Data {
  group: THREE.Group;
  colliders: Collider[];
  shootables: THREE.Object3D[];
  glassPanes: BreakableGlass[];
  playerSpawn: THREE.Vector3;
  playerSpawnYaw: number;
  /** Car A is at the end of the hallway; car B, the same car, in the basement. */
  carA: ElevatorCar;
  carB: ElevatorCar;
  /**
   * B minus A. The two cars are built identically and face the same way, so
   * the ride is a pure translation: the player steps out of B exactly where
   * he was standing in A, looking the same way.
   */
  carOffset: THREE.Vector3;
  /** The emergency lamp in each car, for a flicker on arrival. */
  carLights: THREE.PointLight[];

  /** The flooded pit: over it and below deathY, the water has you. */
  pit: { x0: number; x1: number; z0: number; z1: number; waterY: number; deathY: number };
  water: THREE.Mesh;
  waterMat: THREE.MeshStandardMaterial;
  /** The cold flicker over the water, driven by the arcs. */
  waterLight: THREE.PointLight;
  /** Where arcs can strike: round the foot of each slab and across open water. */
  arcSpots: THREE.Vector3[];
  /** The shorting junction box on the pit wall. */
  sparkAt: THREE.Vector3;
  /** Back on the near ledge, facing the crossing, after a fall. */
  checkpoint: { pos: THREE.Vector3; yaw: number };

  breaker: {
    lever: THREE.Group;
    lamp: THREE.MeshStandardMaterial;
    /** What E has to be aimed at. */
    target: THREE.Object3D;
    light: THREE.PointLight;
  };
  /** Emergency lamps, dimmed once the power is back. */
  redLights: THREE.PointLight[];
  /** The proper lighting: at zero until the breaker is thrown. */
  mainLights: THREE.PointLight[];
  tubeMat: THREE.MeshStandardMaterial;
  ambient: THREE.AmbientLight;
}

/** One rectangle of the basement plan. Walls are generated round the union. */
interface Cell {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Ceiling height. */
  h: number;
  /** Lay the standard floor slab. The flooded hall builds its own. */
  floor?: boolean;
  /** Where this cell's walls start, if its floor is sunk. */
  floorY?: number;
  /** Edges not to wall, because something else is built there. */
  skip?: ('w' | 'e' | 'n' | 's')[];
}

// ---- The flooded hall's crossing
const PIT = { x0: 165.3, x1: 182.7, z0: 4, z1: 20, waterY: -0.25 };
/** Slab tops stand a shade above the ledges, and 0.27m above the water. */
const PLATFORM_TOP = 0.02;
/**
 * [x0, x1, z0, z1, seed] for each slab on the route across.
 *
 * Sized off the player's own jump, measured with the real physics: a walking
 * jump carries about 2.7m and a sprinting one about 4.1m, and air control is
 * too weak to do much about it once you are off. Slabs are 2.6m deep with
 * 1.4m gaps, which catches both — a walking jump from anywhere in the last
 * metre, and a sprinting jump taken right on the lip. At 2.0m deep a sprint
 * jump from the lip cleared the next slab entirely and came down in the gap
 * after it, which is the one way to fall in that feels like the game's fault.
 *
 * Each overlaps its neighbours by a metre or more across the width, so the
 * jumps can be taken straight rather than threaded at an angle.
 */
const PLATFORMS: [number, number, number, number, number][] = [
  [178.7, 181.3, 11.0, 12.8, 1],
  [174.7, 177.3, 10.5, 12.3, 2],
  [170.7, 173.3, 11.2, 13.0, 3],
  [166.7, 169.3, 10.6, 12.4, 4]
];
/** [x, z, w, d, seed]: slabs barely breaking the surface. No colliders. */
const DECOYS: [number, number, number, number, number][] = [
  [176.2, 16.4, 1.1, 0.9, 5],
  [172.8, 6.8, 0.9, 1.1, 6],
  [179.6, 17.4, 0.8, 0.8, 7],
  [169.6, 16.8, 1.0, 0.9, 8],
  [178.6, 6.2, 0.9, 0.7, 9],
  [167.4, 6.9, 0.9, 0.8, 10]
];

const T = 0.24;

// ---- The hallway down to the lift. Deliberately plain and deliberately dark.
const HALL_X0 = 0;
const HALL_X1 = 18;
const HALL_HW = 1.7; // half width
const HALL_H = 3.0;

// ---- The car. Inside dimensions.
const CAR_D = 2.1; // back to front, along x
const CAR_HW = 1.1; // half width, along z
const CAR_H = 2.5;
const DOOR_HW = 0.62; // half the opening
const DOOR_H = 2.15;

// ---- The basement: a long way off in x, so neither area can see the other.
const OFFSET = new THREE.Vector3(200, 0, 0);

/**
 * Level5Builder — the lift down, and the mechanical room it stops at.
 *
 * One level holds both. The hallway and its car sit at the origin; the
 * mechanical room and an identical car sit 200m east. When the car "moves"
 * the scene fades to black and slides the player across by exactly that
 * offset, which is why the two cars must be built the same way round.
 */
export class Level5Builder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private carLights: THREE.PointLight[] = [];
  private dressing: THREE.Object3D[] = [];
  private redLights: THREE.PointLight[] = [];
  private mainLights: THREE.PointLight[] = [];
  private arcSpots: THREE.Vector3[] = [];
  private sparkAt = new THREE.Vector3();
  private water!: THREE.Mesh;
  private waterMat!: THREE.MeshStandardMaterial;
  private waterLight!: THREE.PointLight;
  private breakerLever!: THREE.Group;
  private breakerLamp!: THREE.MeshStandardMaterial;
  private breakerTarget!: THREE.Object3D;
  private breakerLight!: THREE.PointLight;
  private ambient!: THREE.AmbientLight;
  private tubeMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, emissive: 0xf4f8ff, emissiveIntensity: 0 });
  private basementFloorMat!: THREE.MeshLambertMaterial;

  private wallMat!: THREE.MeshLambertMaterial;
  private floorMat!: THREE.MeshLambertMaterial;
  private ceilMat!: THREE.MeshLambertMaterial;
  private concreteMat!: THREE.MeshLambertMaterial;
  private steelMat!: THREE.MeshStandardMaterial;
  private carFloorMat!: THREE.MeshLambertMaterial;
  private darkMetalMat!: THREE.MeshLambertMaterial;
  private doorMat!: THREE.MeshStandardMaterial;

  build(): Level5Data {
    this.makeMaterials();
    this.buildHallway();
    const carA = this.buildCar(HALL_X1, '2');
    this.buildBasement();
    const carB = this.buildCar(HALL_X1 + OFFSET.x, 'MR');
    this.buildLighting();
    this.shootables = mergeStatic(this.group, this.dressing, this.shootables);

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      glassPanes: [],
      playerSpawn: new THREE.Vector3(HALL_X0 + 1.4, 0, 0),
      playerSpawnYaw: -Math.PI / 2, // facing east, down the hallway at the lift
      carA,
      carB,
      carOffset: OFFSET.clone(),
      carLights: this.carLights,
      pit: { ...PIT, deathY: -0.08 },
      water: this.water,
      waterMat: this.waterMat,
      waterLight: this.waterLight,
      arcSpots: this.arcSpots,
      sparkAt: this.sparkAt,
      checkpoint: { pos: new THREE.Vector3(184.7, 0, 12), yaw: Math.PI / 2 },
      breaker: { lever: this.breakerLever, lamp: this.breakerLamp, target: this.breakerTarget, light: this.breakerLight },
      redLights: this.redLights,
      mainLights: this.mainLights,
      tubeMat: this.tubeMat,
      ambient: this.ambient
    };
  }

  // ------------------------------------------------------------- materials

  private makeMaterials(): void {
    this.wallMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([150, 146, 138], 7), 4, 2) });
    this.floorMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([44, 46, 52], 12), 10, 2) });
    this.ceilMat = new THREE.MeshLambertMaterial({ map: makeTex(ceilingTileCanvas(), 10, 2) });
    this.concreteMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([96, 98, 100], 16), 12, 10) });
    this.steelMat = new THREE.MeshStandardMaterial({ color: 0x8d949b, metalness: 0.55, roughness: 0.42 });
    this.carFloorMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([34, 35, 38], 10), 2, 2) });
    this.darkMetalMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
    this.doorMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.6, roughness: 0.35 });
    this.basementFloorMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([74, 76, 78], 14), 10, 10) });
  }

  // --------------------------------------------------------------- helpers

  /** Solid box: mesh, collider and bullet target. */
  private solid(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    opts: { collide?: boolean; surface?: string } = {}
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.userData.surface = opts.surface ?? 'concrete';
    this.group.add(mesh);
    this.shootables.push(mesh);
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
    this.group.add(m);
    this.shootables.push(m);
    this.colliders.push({ box: new THREE.Box3(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y + 0.3, z1)) });
  }

  /** A wall running along z at `x`, with the lift opening left in it at z = 0. */
  private endWall(x: number, z0: number, z1: number, h: number, mat: THREE.Material): void {
    this.solid(T, h, -DOOR_HW - z0, x, 0, (z0 - DOOR_HW) / 2, mat);
    this.solid(T, h, z1 - DOOR_HW, x, 0, (z1 + DOOR_HW) / 2, mat);
    this.solid(T, h - DOOR_H, DOOR_HW * 2, x, DOOR_H, 0, mat);
  }

  // -------------------------------------------------------------- hallway

  /** The corridor down to the lift. Nothing in it: the point is the dark. */
  private buildHallway(): void {
    this.slab(HALL_X0, HALL_X1, -HALL_HW, HALL_HW, -0.3, this.floorMat);
    this.slab(HALL_X0, HALL_X1, -HALL_HW, HALL_HW, HALL_H, this.ceilMat);
    this.solid(HALL_X1 - HALL_X0, HALL_H, T, (HALL_X0 + HALL_X1) / 2, 0, -HALL_HW, this.wallMat);
    this.solid(HALL_X1 - HALL_X0, HALL_H, T, (HALL_X0 + HALL_X1) / 2, 0, HALL_HW, this.wallMat);
    this.solid(T, HALL_H, HALL_HW * 2, HALL_X0, 0, 0, this.wallMat);
    // The door he came through, shut behind him
    this.solid(0.08, 2.2, 1.5, HALL_X0 + 0.16, 0, 0, this.doorMat, { surface: 'metal', collide: false });
    this.solid(0.05, 0.05, 1.05, HALL_X0 + 0.22, 1.02, 0, this.darkMetalMat, { surface: 'metal', collide: false });
    this.endWall(HALL_X1, -HALL_HW, HALL_HW, HALL_H, this.wallMat);
  }

  // ------------------------------------------------------------- basement

  /**
   * The basement, as a set of rectangles. Walls are generated round the union
   * of them — openings wherever two cells touch, headers where a taller cell
   * meets a lower one — so a corridor can never end in a gap and a doorway
   * can never be walled over by hand.
   */
  private buildCells(cells: Cell[]): void {
    const EPS = 0.01;
    for (const c of cells) {
      if (c.floor !== false) this.slab(c.x0, c.x1, c.z0, c.z1, -0.3, this.basementFloorMat);
      this.slab(c.x0, c.x1, c.z0, c.z1, c.h, this.concreteMat);
      const edges: { side: 'w' | 'e' | 'n' | 's'; fixed: number; a0: number; a1: number; axis: 'x' | 'z' }[] = [
        { side: 'w', fixed: c.x0, a0: c.z0, a1: c.z1, axis: 'z' },
        { side: 'e', fixed: c.x1, a0: c.z0, a1: c.z1, axis: 'z' },
        { side: 'n', fixed: c.z0, a0: c.x0, a1: c.x1, axis: 'x' },
        { side: 's', fixed: c.z1, a0: c.x0, a1: c.x1, axis: 'x' }
      ];
      for (const e of edges) {
        if (c.skip?.includes(e.side)) continue;
        const shared: { s: number; e: number; h: number }[] = [];
        for (const n of cells) {
          if (n === c) continue;
          let touches = false;
          let s0 = 0;
          let s1 = 0;
          if (e.side === 'w' || e.side === 'e') {
            touches = Math.abs((e.side === 'w' ? n.x1 : n.x0) - e.fixed) < EPS;
            s0 = Math.max(n.z0, c.z0);
            s1 = Math.min(n.z1, c.z1);
          } else {
            touches = Math.abs((e.side === 'n' ? n.z1 : n.z0) - e.fixed) < EPS;
            s0 = Math.max(n.x0, c.x0);
            s1 = Math.min(n.x1, c.x1);
          }
          if (touches && s1 - s0 > EPS) shared.push({ s: s0, e: s1, h: n.h });
        }
        shared.sort((p, q) => p.s - q.s);
        let cursor = e.a0;
        for (const sh of shared) {
          if (sh.s > cursor + EPS) this.cellWall(e.axis, e.fixed, cursor, sh.s, c.floorY ?? 0, c.h - (c.floorY ?? 0));
          // The taller of the two builds the header over the opening
          if (c.h > sh.h + EPS) this.cellWall(e.axis, e.fixed, sh.s, sh.e, sh.h, c.h - sh.h);
          cursor = Math.max(cursor, sh.e);
        }
        if (e.a1 > cursor + EPS) this.cellWall(e.axis, e.fixed, cursor, e.a1, c.floorY ?? 0, c.h - (c.floorY ?? 0));
      }
    }
  }

  /** A wall along `axis` at `fixed` over a0..a1, padded at the ends so corners close. */
  private cellWall(axis: 'x' | 'z', fixed: number, a0: number, a1: number, y: number, h: number): void {
    const s = a0 - T / 2;
    const e = a1 + T / 2;
    if (axis === 'z') this.solid(T, h, e - s, fixed, y, (s + e) / 2, this.concreteMat);
    else this.solid(e - s, h, T, (s + e) / 2, y, fixed, this.concreteMat);
  }

  /** Drop a prop, tagged so the dressing merge folds it in. */
  private put(o: THREE.Object3D, x: number, z: number, yaw = 0, y = 0): void {
    o.position.set(x, y, z);
    o.rotation.y = yaw;
    o.userData.placed = true;
    this.group.add(o);
    this.dressing.push(o);
  }

  /** Furniture you cannot walk through. */
  private blk(x: number, z: number, w: number, d: number, h: number): void {
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2))
    });
  }

  /** A pipe laid along x (yaw 0) or z (yaw PI/2). */
  private pipeRun(len: number, r: number, kind: 'grey' | 'green' | 'rust' | 'copper', x: number, y: number, z: number, alongZ = false): void {
    this.put(pipe(len, r, kind), x, z, alongZ ? Math.PI / 2 : 0, y);
  }

  /** Caged red emergency lamp on a wall, and the dim light it throws. */
  private redLamp(x: number, y: number, z: number, yaw: number): void {
    this.put(cageLamp(), x, z, yaw, y);
    const out = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const l = new THREE.PointLight(0xff2a18, 1.4, 8, 1.6);
    l.position.set(x + out.x * 0.35, y - 0.1, z + out.z * 0.35);
    this.group.add(l);
    this.redLights.push(l);
  }

  /** A ceiling fitting that stays dark until the breaker goes back on. */
  private mainLight(x: number, y: number, z: number, alongZ = false): void {
    this.put(ceilingFixture(this.tubeMat), x, z, alongZ ? Math.PI / 2 : 0, y);
    // Present from the start at zero, never added later: the number of lights
    // is baked into every shader, and adding them on the frame the power comes
    // back would stall the whole level to recompile.
    const l = new THREE.PointLight(0xeef3ff, 0, 11, 1.4);
    l.position.set(x, y - 0.3, z);
    this.group.add(l);
    this.mainLights.push(l);
  }

  /**
   * Lift lobby → a corridor west → north past the generator room → west again
   * → the flooded hall → the breaker room.
   */
  private buildBasement(): void {
    const cells: Cell[] = [
      // Lift lobby. Its east edge is the lift wall, built separately.
      { x0: 213, x1: 218, z0: -2.4, z1: 2.4, h: 3.2, skip: ['e'] },
      { x0: 201, x1: 213, z0: -1.4, z1: 1.4, h: 3.0 },
      { x0: 198.2, x1: 201, z0: -1.4, z1: 13.4, h: 3.0 },
      // Generator room, off the side of the second corridor
      { x0: 191, x1: 198.2, z0: 2.5, z1: 8.5, h: 3.6 },
      { x0: 186, x1: 198.2, z0: 10.6, z1: 13.4, h: 3.0 },
      // The flooded hall: its floor is built by hand, and its walls go down
      // to the bottom of the pit
      { x0: 162, x1: 186, z0: 4, z1: 20, h: 5.0, floor: false, floorY: -1.2 },
      { x0: 154, x1: 162, z0: 9, z1: 15, h: 3.2 }
    ];
    this.buildCells(cells);
    this.endWall(218, -2.4, 2.4, 3.2, this.concreteMat);
    this.buildFloodedHall();
    this.dressBasement();
    this.buildBreaker();
  }

  /**
   * The broken floor. A solid ledge at each end, a pit between them with the
   * water standing in it, and slabs of the old floor sticking up out of it
   * just high enough to jump between.
   *
   * Gaps are 1.0-1.4m edge to edge. A walking jump carries about 2.7m and the
   * player is 0.68m across, so every one is a comfortable jump — but none can
   * be stepped or straddled, which is the point.
   */
  private buildFloodedHall(): void {
    const { x0, x1, z0, z1, waterY } = PIT;
    // Ledges, solid from the pit floor up so the pit has real sides
    this.solid(186 - x1, 1.2, 16, (186 + x1) / 2, -1.2, 12, this.basementFloorMat);
    this.solid(x0 - 162, 1.2, 16, (162 + x0) / 2, -1.2, 12, this.basementFloorMat);
    // The pit bottom
    this.solid(x1 - x0, 0.3, z1 - z0, (x0 + x1) / 2, -1.5, (z0 + z1) / 2, this.concreteMat);

    // The water
    // Mottled, and drifted by the scene, so the surface moves
    const ripple = makeTex(noiseCanvas([150, 190, 200], 60), 6, 8);
    this.waterMat = new THREE.MeshStandardMaterial({
      map: ripple,
      color: 0x0c1a1e,
      roughness: 0.12,
      metalness: 0.4,
      emissive: 0x0d4a5a,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.9
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0 - T), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((x0 + x1) / 2, waterY, (z0 + z1) / 2);
    this.group.add(water);
    this.water = water;

    // The way across
    for (const [px0, px1, pz0, pz1, seed] of PLATFORMS) {
      const w = px1 - px0;
      const d = pz1 - pz0;
      this.colliders.push({
        box: new THREE.Box3(new THREE.Vector3(px0, -1.2, pz0), new THREE.Vector3(px1, PLATFORM_TOP, pz1))
      });
      this.put(debrisPlatform(w, d, 1.2, seed), (px0 + px1) / 2, (pz0 + pz1) / 2, 0, PLATFORM_TOP);
      // Arcs play round the foot of each one
      this.arcSpots.push(new THREE.Vector3(px0 - 0.1, waterY + 0.02, (pz0 + pz1) / 2));
      this.arcSpots.push(new THREE.Vector3(px1 + 0.1, waterY + 0.02, pz0 + 0.3));
    }
    // Debris just breaking the surface: something to look at, nothing to stand on
    for (const [cx, cz, w, d, seed] of DECOYS) {
      this.put(debrisPlatform(w, d, 0.9, seed), cx, cz, seed * 0.7, waterY + 0.07);
      this.arcSpots.push(new THREE.Vector3(cx, waterY + 0.02, cz));
    }
    // Open water, for the arcs that are not at anything in particular
    for (let i = 0; i < 10; i++) {
      this.arcSpots.push(new THREE.Vector3(x0 + 0.8 + ((i * 3.7) % (x1 - x0 - 1.6)), waterY + 0.02, z0 + 1 + ((i * 5.3) % (z1 - z0 - 2))));
    }
    // Broken edges: rubble on the lips of both ledges
    for (const [rx, rz, s] of [[x1 + 0.35, 7.2, 1.1], [x1 + 0.3, 16.6, 0.9], [x0 - 0.35, 6.5, 1.0], [x0 - 0.3, 17.4, 1.2]] as const) {
      this.put(rubble(s, Math.round(rx + rz)), rx, rz);
    }
    // The shorting junction box the scene throws sparks from
    this.put(electricalBox(0.5, 0.6), 176.4, z0 + T / 2, 0, 0.35);
    this.sparkAt.set(176.4, 0.25, z0 + 0.3);

    // A cold flicker over the water, driven by the scene
    this.waterLight = new THREE.PointLight(0x6fe8ff, 0, 14, 1.4);
    this.waterLight.position.set((x0 + x1) / 2, 1.2, (z0 + z1) / 2);
    this.group.add(this.waterLight);
  }

  /** The thing he came down for, on the far wall of the last room. */
  private buildBreaker(): void {
    const b = mainBreaker();
    b.group.position.set(154 + T / 2, 0, 12);
    b.group.rotation.y = Math.PI / 2;
    this.group.add(b.group);
    b.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.shootables.push(o);
    });
    this.blk(154 + T / 2 + 0.2, 12, 0.42, 1.1, 2.2);
    this.breakerLever = b.lever;
    this.breakerLamp = b.lamp;
    this.breakerTarget = b.group;
    this.breakerLight = new THREE.PointLight(0xff2a18, 2.4, 7, 1.5);
    this.breakerLight.position.set(155.1, 1.8, 12);
    this.group.add(this.breakerLight);
  }

  /** Everything that makes it a plant room rather than a concrete maze. */
  private dressBasement(): void {
    // ---- Lift lobby
    this.pipeRun(4.8, 0.1, 'green', 215.5, 2.62, 2.12);
    this.pipeRun(4.8, 0.06, 'copper', 215.5, 2.36, 2.16);
    this.put(controlConsole(), 215.6, -1.83);
    this.blk(215.6, -1.83, 1.2, 0.64, 1.3);
    this.put(warningSign(['AUTHORISED', 'PERSONNEL ONLY']), 214.2, 2.28 - 0.001, Math.PI, 1.55);
    this.redLamp(216.9, 2.5, 2.28, Math.PI);
    this.mainLight(215.5, 2.95, 0);

    // ---- First corridor, heading west
    this.pipeRun(12, 0.09, 'grey', 207, 2.55, 1.12);
    this.pipeRun(12, 0.055, 'copper', 207, 2.3, 1.17);
    this.pipeRun(12, 0.13, 'green', 207, 2.58, -1.08);
    this.put(duct(11.6, 0.55, 0.34), 207, 0.1, 0, 2.8);
    this.put(electricalBox(0.6, 0.8), 206.5, -1.28, 0, 1.45);
    this.put(electricalBox(0.45, 0.6), 205.6, -1.28, 0, 1.3);
    this.put(
      cable([
        new THREE.Vector3(212.6, 2.2, -1.2),
        new THREE.Vector3(209.5, 1.7, -1.18),
        new THREE.Vector3(207.1, 1.95, -1.18),
        new THREE.Vector3(206.6, 1.85, -1.14)
      ]),
      0,
      0
    );
    for (const [bx, kind] of [[202.1, 'blue'], [202.75, 'rust'], [203.4, 'yellow']] as const) {
      this.put(barrel(kind), bx, 0.95, bx);
      this.blk(bx, 0.95, 0.6, 0.6, 0.9);
    }
    this.put(vent(), 211.4, 1.28, Math.PI, 0.45);
    this.redLamp(209.2, 2.3, -1.28, 0);
    this.redLamp(204.0, 2.3, 1.28, Math.PI);
    this.mainLight(210, 2.72, -0.35);
    this.mainLight(204, 2.72, -0.35);

    // ---- Second corridor, heading north
    this.pipeRun(14.6, 0.1, 'rust', 200.7, 2.6, 6, true);
    this.pipeRun(14.6, 0.07, 'grey', 200.72, 2.35, 6, true);
    this.pipeRun(14.6, 0.12, 'green', 198.5, 2.62, 6, true);
    this.put(electricalBox(0.7, 0.9), 200.88, 6.4, -Math.PI / 2, 1.4);
    this.put(warningSign(['GENERATOR', 'ROOM'], 0.6, 0.38), 198.32, 9.55, Math.PI / 2, 2.1);
    this.put(barrel('rust'), 198.66, -0.9, 0.4);
    this.blk(198.66, -0.9, 0.6, 0.6, 0.9);
    this.put(barrel('blue'), 199.3, -0.95, 1.9);
    this.blk(199.3, -0.95, 0.6, 0.6, 0.9);
    this.redLamp(200.88, 2.3, 3.8, -Math.PI / 2);
    this.redLamp(198.32, 2.3, 0.6, Math.PI / 2);
    this.mainLight(199.6, 2.72, 1.6, true);
    this.mainLight(199.6, 2.72, 9.6, true);

    // ---- Generator room
    this.put(generator(), 194.1, 3.32);
    this.blk(194.1, 3.32, 2.7, 1.2, 1.7);
    this.put(generator(), 194.1, 7.68, Math.PI);
    this.blk(194.1, 7.68, 2.7, 1.2, 1.7);
    this.put(electricalBox(0.8, 1.0), 191.12, 5.5, Math.PI / 2, 1.5);
    this.put(
      cable([
        new THREE.Vector3(193.6, 1.0, 3.95),
        new THREE.Vector3(192.7, 0.06, 4.5),
        new THREE.Vector3(191.7, 0.06, 5.1),
        new THREE.Vector3(191.3, 0.95, 5.35)
      ], 0.03),
      0,
      0
    );
    this.put(
      cable([
        new THREE.Vector3(194.6, 1.0, 7.05),
        new THREE.Vector3(193.0, 0.06, 6.6),
        new THREE.Vector3(191.7, 0.06, 6.0),
        new THREE.Vector3(191.3, 0.95, 5.65)
      ], 0.03),
      0,
      0
    );
    this.put(duct(7.0, 0.7, 0.4), 194.6, 5.5, 0, 3.3);
    this.put(barrel('yellow'), 191.6, 3.1, 0.2);
    this.blk(191.6, 3.1, 0.6, 0.6, 0.9);
    this.put(barrel('yellow'), 191.6, 7.9, 1.3);
    this.blk(191.6, 7.9, 0.6, 0.6, 0.9);
    this.redLamp(192.3, 2.9, 2.62, 0);
    // A second one across the room, or the far generator is only a silhouette
    this.redLamp(196.2, 2.9, 8.38, Math.PI);
    this.mainLight(194.6, 3.3, 5.5);

    // ---- Third corridor, heading west to the hall
    this.pipeRun(12.2, 0.1, 'grey', 192.1, 2.58, 13.1);
    this.pipeRun(12.2, 0.06, 'copper', 192.1, 2.32, 13.14);
    this.pipeRun(12.2, 0.12, 'rust', 192.1, 2.6, 10.9);
    this.put(controlConsole(), 192.5, 12.96, Math.PI);
    this.blk(192.5, 12.96, 1.2, 0.64, 1.3);
    this.put(barrel('blue'), 196.6, 10.99, 0.7);
    this.blk(196.6, 10.99, 0.6, 0.6, 0.9);
    this.put(barrel('rust'), 197.25, 11.0, 2.4);
    this.blk(197.25, 11.0, 0.6, 0.6, 0.9);
    this.put(warningSign(['DANGER', 'HIGH VOLTAGE']), 187.3, 10.72, 0, 1.65);
    this.put(warningSign(['FLOODED AREA', 'KEEP CLEAR']), 187.3, 13.28, Math.PI, 1.65);
    this.redLamp(194.6, 2.3, 10.72, 0);
    this.redLamp(189.0, 2.3, 13.28, Math.PI);
    this.mainLight(195, 2.72, 12);
    this.mainLight(189, 2.72, 12);

    // ---- The hall
    this.pipeRun(23.6, 0.18, 'green', 174, 4.2, 19.6);
    this.pipeRun(23.6, 0.14, 'rust', 174, 4.0, 4.4);
    this.pipeRun(23.6, 0.08, 'grey', 174, 4.55, 4.35);
    this.put(duct(23.2, 0.8, 0.5), 174, 12, 0, 4.6);
    this.put(warningSign(['DANGER', 'ELECTRIFIED WATER']), 184.2, 4.12, 0, 1.75);
    this.put(warningSign(['DANGER', 'ELECTRIFIED WATER']), 184.2, 19.88, Math.PI, 1.75);
    this.redLamp(185.88, 3.4, 7.0, -Math.PI / 2);
    this.redLamp(162.12, 3.4, 17.0, Math.PI / 2);
    this.mainLight(184, 4.62, 12);
    this.mainLight(174, 4.62, 8);
    this.mainLight(174, 4.62, 16);
    this.mainLight(164, 4.62, 12);

    // ---- Breaker room
    this.pipeRun(7.8, 0.08, 'grey', 158, 2.7, 14.7);
    this.pipeRun(7.8, 0.06, 'copper', 158, 2.45, 14.74);
    this.put(electricalBox(0.6, 0.8), 157.2, 9.12, 0, 1.5);
    this.put(electricalBox(0.6, 0.8), 158.2, 9.12, 0, 1.5);
    this.put(controlConsole(), 159.2, 14.56, Math.PI);
    this.blk(159.2, 14.56, 1.2, 0.64, 1.3);
    this.put(warningSign(['MAIN', 'ELECTRICAL'], 0.6, 0.38), 154.12, 14.1, Math.PI / 2, 2.1);
    this.mainLight(158, 2.95, 12);
  }

  // ------------------------------------------------------------------- car

  /**
   * One lift car, its doors on the west face at `doorX`.
   *
   * Local layout, looking in from the door: the control panel is on the
   * right-hand (south) wall just inside, the emergency-power sign faces you
   * on the back wall, and the floor display is over the door.
   */
  private buildCar(doorX: number, litFloor: '2' | 'MR'): ElevatorCar {
    const x0 = doorX + T / 2; // inside face of the front wall
    const x1 = doorX + CAR_D;
    const cx = (x0 + x1) / 2;

    // Shell
    this.slab(doorX, x1 + T / 2, -CAR_HW - T / 2, CAR_HW + T / 2, -0.3, this.carFloorMat);
    this.slab(doorX, x1 + T / 2, -CAR_HW - T / 2, CAR_HW + T / 2, CAR_H, this.steelMat);
    this.solid(x1 - doorX, CAR_H, T, (doorX + x1) / 2, 0, -CAR_HW, this.steelMat, { surface: 'metal' });
    this.solid(x1 - doorX, CAR_H, T, (doorX + x1) / 2, 0, CAR_HW, this.steelMat, { surface: 'metal' });
    this.solid(T, CAR_H, CAR_HW * 2 + T, x1, 0, 0, this.steelMat, { surface: 'metal' });
    // The inside face of the front wall is steel too, not corridor plaster
    this.solid(0.02, CAR_H, CAR_HW - DOOR_HW, x0 + 0.01, 0, -(CAR_HW + DOOR_HW) / 2, this.steelMat, {
      surface: 'metal',
      collide: false
    });
    this.solid(0.02, CAR_H, CAR_HW - DOOR_HW, x0 + 0.01, 0, (CAR_HW + DOOR_HW) / 2, this.steelMat, {
      surface: 'metal',
      collide: false
    });
    this.solid(0.02, CAR_H - DOOR_H, DOOR_HW * 2, x0 + 0.01, DOOR_H, 0, this.steelMat, {
      surface: 'metal',
      collide: false
    });
    // Handrail round the back
    this.solid(0.05, 0.05, CAR_HW * 2 - 0.3, x1 - T / 2 - 0.07, 0.92, 0, this.darkMetalMat, {
      surface: 'metal',
      collide: false
    });

    // Doors: two leaves meeting in the middle, sliding back into the wall.
    // They live inside the wall's own thickness, so open they are hidden in it.
    const leafW = DOOR_HW;
    const mk = (z: number): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, DOOR_H, leafW), this.doorMat);
      m.position.set(doorX, DOOR_H / 2, z);
      m.userData.surface = 'metal';
      this.group.add(m);
      this.shootables.push(m);
      return m;
    };
    const leftDoor = mk(-leafW * 1.5); // open: both start slid away
    const rightDoor = mk(leafW * 1.5);
    const doorCollider: Collider = {
      box: new THREE.Box3(
        new THREE.Vector3(doorX - T / 2, 0, -DOOR_HW),
        new THREE.Vector3(doorX + T / 2, DOOR_H, DOOR_HW)
      ),
      disabled: true
    };
    this.colliders.push(doorCollider);

    // Emergency lamp: a dim warm panel in the ceiling, and the light itself
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2419, emissive: 0xffd9a0, emissiveIntensity: 0.9 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.5), lampMat);
    lamp.position.set(cx, CAR_H - 0.02, 0);
    this.group.add(lamp);
    const light = new THREE.PointLight(0xffdcaa, 1.5, 6.5, 1.5);
    light.position.set(cx, CAR_H - 0.25, 0);
    this.group.add(light);
    this.carLights.push(light);

    // Control panel on the south wall, just inside the door
    const { panel, buttons } = this.controlPanel();
    panel.position.set(x0 + 0.42, 1.28, -CAR_HW + T / 2 + 0.012);
    this.group.add(panel);
    buttons.get(litFloor)!.emissiveIntensity = 2.2;

    // Emergency power sign and its green lamp, on the back wall
    const sign = this.emergencySign();
    sign.position.set(x1 - T / 2 - 0.012, 1.72, 0.42);
    sign.rotation.y = -Math.PI / 2;
    this.group.add(sign);

    // Floor display over the door, facing into the car
    const faces = {
      '2': this.indicatorFace('2'),
      '1': this.indicatorFace('1'),
      MR: this.indicatorFace('MR'),
      down: this.indicatorFace('↓')
    };
    const indicator = new THREE.MeshBasicMaterial({ map: faces[litFloor] });
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.42), this.darkMetalMat);
    housing.position.set(x0 + 0.025, DOOR_H + 0.17, 0);
    this.group.add(housing);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.16), indicator);
    screen.position.set(x0 + 0.042, DOOR_H + 0.17, 0);
    screen.rotation.y = Math.PI / 2;
    this.group.add(screen);

    return {
      doorX,
      leftDoor,
      rightDoor,
      doorCollider,
      panel,
      buttons,
      indicator,
      indicatorFaces: faces,
      interior: new THREE.Box3(new THREE.Vector3(x0, 0, -CAR_HW + T / 2), new THREE.Vector3(x1 - T / 2, CAR_H, CAR_HW - T / 2))
    };
  }

  /**
   * The button column: 5 at the top down to 1, then the mechanical room on
   * its own below a gap. Each button has its own lamp material so the scene
   * can light any one of them. Built facing +Z.
   */
  private controlPanel(): { panel: THREE.Group; buttons: Map<string, THREE.MeshStandardMaterial> } {
    const g = new THREE.Group();
    const W = 0.3;
    const H = 0.78;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(W, H, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.7, roughness: 0.3 })
    );
    g.add(plate);

    // Engraved labels, drawn once
    const c = document.createElement('canvas');
    c.width = 150;
    c.height = 390;
    const x = c.getContext('2d')!;
    x.fillStyle = '#8f969d';
    x.fillRect(0, 0, 150, 390);
    x.fillStyle = '#1c2026';
    x.textAlign = 'center';
    x.font = 'bold 26px Arial, Helvetica, sans-serif';
    const labels = ['5', '4', '3', '2', '1'];
    const rowY = (i: number): number => 42 + i * 52;
    labels.forEach((l, i) => x.fillText(l, 42, rowY(i) + 9));
    // Set apart from the floors by a rule and a clear gap, so it reads as
    // its own thing rather than a sixth floor crowding the 1
    x.fillStyle = '#5d646b';
    x.fillRect(18, 283, 114, 2);
    x.fillStyle = '#1c2026';
    x.font = 'bold 15px Arial, Helvetica, sans-serif';
    x.fillText('MECHANICAL', 75, 342);
    x.fillText('ROOM', 75, 360);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.94, H * 0.94), new THREE.MeshLambertMaterial({ map: tex }));
    face.position.z = 0.011;
    g.add(face);

    // The buttons themselves, as raised discs with their own lamps
    const buttons = new Map<string, THREE.MeshStandardMaterial>();
    const toLocal = (px: number, py: number): [number, number] => [
      (px / 150 - 0.5) * W * 0.94,
      (0.5 - py / 390) * H * 0.94
    ];
    const disc = (label: string, px: number, py: number): void => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xd9dde0,
        emissive: 0xffc45a,
        emissiveIntensity: 0,
        metalness: 0.3,
        roughness: 0.4
      });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 16), mat);
      b.rotation.x = Math.PI / 2;
      const [lx, ly] = toLocal(px, py);
      b.position.set(lx, ly, 0.017);
      g.add(b);
      buttons.set(label, mat);
    };
    labels.forEach((l, i) => disc(l, 100, rowY(i)));
    disc('MR', 75, 312);
    return { panel: g, buttons };
  }

  /** "EMERGENCY BACKUP ELEVATOR POWER", with a green lamp over it. Faces +Z. */
  private emergencySign(): THREE.Group {
    const g = new THREE.Group();
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = '#1b2a1f';
    x.fillRect(0, 0, 256, 128);
    x.strokeStyle = '#5bd27a';
    x.lineWidth = 3;
    x.strokeRect(6, 6, 244, 116);
    x.fillStyle = '#dff5e4';
    x.textAlign = 'center';
    x.font = 'bold 26px Arial, Helvetica, sans-serif';
    x.fillText('EMERGENCY', 128, 42);
    x.fillText('BACKUP', 128, 72);
    x.font = 'bold 19px Arial, Helvetica, sans-serif';
    x.fillText('ELEVATOR POWER', 128, 102);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 0.015), this.darkMetalMat);
    g.add(plate);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.22),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 })
    );
    face.position.z = 0.009;
    g.add(face);
    // The green lamp, lit: this is what says the car has its own supply
    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16),
      new THREE.MeshStandardMaterial({ color: 0x0b2a14, emissive: 0x2cff62, emissiveIntensity: 1.25 })
    );
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, 0.2, 0.012);
    g.add(lamp);
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 16), this.darkMetalMat);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(0, 0.2, 0.004);
    g.add(bezel);
    return g;
  }

  /** One face of the floor display: amber digits on black. */
  private indicatorFace(text: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 192;
    c.height = 80;
    const x = c.getContext('2d')!;
    x.fillStyle = '#080604';
    x.fillRect(0, 0, 192, 80);
    x.fillStyle = '#ffb23a';
    x.textAlign = 'center';
    x.font = 'bold 56px "Courier New", monospace';
    x.fillText(text, 96, 60);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // -------------------------------------------------------------- lighting

  /**
   * No power anywhere except in the lift. The hallway gets only a trace of
   * ambient so the walls are there if you look hard; the rest is the torch
   * and whatever spills out of the open car.
   */
  private buildLighting(): void {
    this.ambient = new THREE.AmbientLight(0x1c2129, 0.2);
    this.group.add(this.ambient);
    this.group.add(new THREE.HemisphereLight(0x3a3f4a, 0x0d0f12, 0.12));
  }
}
