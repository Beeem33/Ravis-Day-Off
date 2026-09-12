import * as THREE from 'three';
import type { BreakableGlass } from './BreakableGlass';
import { Collider, noiseCanvas, ceilingTileCanvas, makeTex } from './OfficeLevelBuilder';
import { vent } from './OfficeProps';
import {
  duct, cable, routedCable, barrel, controlConsole, CONSOLE_H, electricalBox, generator, cageLamp, ceilingFixture,
  warningSign, debrisPlatform, rubble, mainBreaker, brokenPipeStep, floatingWorker, floatingHelmet,
  pipeRoute, pipeClamp, pipeHanger, ductWallCollar, ductCeilingCollar, ductRiser, BREAKER_TOP, type PipeKind
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
  /** The additive sheet of glints riding over the water. */
  waterGlintMat: THREE.MeshBasicMaterial;
  /** What is floating in it — bobbed by the scene. */
  floaters: THREE.Object3D[];
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
    /** Middle of the lever's handle, riding with it: where the hand takes hold. */
    grip: THREE.Object3D;
    lamp: THREE.MeshStandardMaterial;
    /** What E has to be aimed at. */
    target: THREE.Object3D;
    light: THREE.PointLight;
    /** Face of the cabinet: x of its front, and the z it is centred on. */
    faceX: number;
    z: number;
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
/**
 * The hall used to be a 16m-wide barn with the route straight down the
 * middle, leaving seven metres of nothing either side. Narrowed about the
 * same centre line so the far wall is somewhere you can see. The pit runs
 * further west than the room's old ledge to make room for the pipe traverse
 * at the end of the crossing.
 */
const HALL = { x0: 162, x1: 186, z0: 6.4, z1: 17.6 };
const PIT = { x0: 163.4, x1: 182.7, z0: HALL.z0, z1: HALL.z1, waterY: -0.25 };
/** Slab tops stand a shade above the ledges, and 0.27m above the water. */
const PLATFORM_TOP = 0.02;
/**
 * [x0, x1, z0, z1, seed] for each slab on the route across.
 *
 * Sized off the player's own jump, measured with the real physics: a walking
 * jump carries about 2.7m and a sprinting one about 4.1m, and air control is
 * too weak to do much about it once you are off. The slabs are small now —
 * 1.3 x 0.9, half what they were — so each is a footing rather than a floor,
 * and the gaps came down to 1.8m to match: a walking jump from anywhere on
 * the slab makes it, but nothing can be stepped or straddled.
 *
 * The route also bends north over the last two, which walks the player into
 * the pipe traverse along the wall rather than dropping them at it.
 */
const PLATFORMS: [number, number, number, number, number][] = [
  [179.6, 180.9, 11.55, 12.45, 1],
  [176.5, 177.8, 12.15, 13.05, 2],
  [173.4, 174.7, 13.35, 14.25, 3],
  [170.3, 171.6, 14.55, 15.45, 4]
];
/**
 * [x0, x1, z, seed] — the last stretch. The floor gave out entirely at this
 * end, and what is left to cross on is the service run that was clipped to
 * the north wall: two lengths of broken pipe, still bracketed up, standing
 * just clear of the water. Narrow enough that they have to be walked.
 */
const PIPE_STEPS: [number, number, number, number][] = [
  [167.6, 168.8, 16.55, 11],
  [164.9, 166.1, 16.55, 12]
];
/**
 * How wide a footing each pipe gives. Wider than the pipe itself: landing a
 * jump on a bare 0.34m cylinder is a coin toss rather than a test of nerve,
 * and the pipe reads as something you balance along either way.
 */
const PIPE_WALK = 0.52;
/** [x, z, w, d, seed]: slabs barely breaking the surface. No colliders. */
const DECOYS: [number, number, number, number, number][] = [
  [177.4, 15.9, 1.1, 0.9, 5],
  [173.2, 8.3, 0.9, 1.1, 6],
  [180.2, 16.6, 0.8, 0.8, 7],
  [169.2, 9.4, 1.0, 0.9, 8],
  [179.1, 7.8, 0.9, 0.7, 9],
  [166.3, 11.7, 0.9, 0.8, 10]
];

const T = 0.24;
/** The main breaker's back, on the breaker room's far wall, and its centre line. */
const BREAKER_X = 154 + T / 2;
const BREAKER_Z = 12;

/**
 * A tangent-space normal map of shallow overlapping ripples. Three sine
 * gratings at different angles and wavelengths are summed into a height
 * field, and the map stores its slope — so the water's highlights bend the
 * way a disturbed surface bends them, instead of a flat plane sliding a
 * picture of ripples along underneath itself.
 */
function rippleNormalCanvas(size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const waves = [
    { ax: 1.0, az: 0.25, k: 7.0, amp: 1.0 },
    { ax: -0.4, az: 1.0, k: 11.0, amp: 0.65 },
    { ax: 0.7, az: -0.8, k: 17.0, amp: 0.35 }
  ];
  const h = (u: number, v: number): number => {
    let s = 0;
    for (const w of waves) s += w.amp * Math.sin((u * w.ax + v * w.az) * w.k * Math.PI * 2);
    return s;
  };
  const e = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Central differences give the slope; scale sets how steep it reads
      const dx = (h(u + e, v) - h(u - e, v)) * 0.09;
      const dy = (h(u, v + e) - h(u, v - e)) * 0.09;
      const len = Math.hypot(-dx, -dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Sparse specular glints, for the additive sheet that rides over the water. */
function glintCanvas(size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  // Few, long and soft. Many short ones read as rain on a window rather than
  // light lying along a swell, and they have to fade out at both ends or the
  // texture's own tiling shows up as dashes.
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const w = 14 + Math.random() * 46;
    const h = 1.2 + Math.random() * 2.2;
    const grad = g.createLinearGradient(x - w / 2, y, x + w / 2, y);
    grad.addColorStop(0, 'rgba(120,210,235,0)');
    grad.addColorStop(0.35, `rgba(170,235,255,${0.1 + Math.random() * 0.16})`);
    grad.addColorStop(0.55, `rgba(200,245,255,${0.16 + Math.random() * 0.22})`);
    grad.addColorStop(1, 'rgba(120,210,235,0)');
    g.fillStyle = grad;
    g.fillRect(x - w / 2, y - h / 2, w, h);
  }
  return c;
}

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
  private waterGlintMat!: THREE.MeshBasicMaterial;
  private waterLight!: THREE.PointLight;
  /** Bodies and helmets riding the surface; the scene bobs them. */
  private floaters: THREE.Object3D[] = [];
  private breakerLever!: THREE.Group;
  private breakerGrip!: THREE.Object3D;
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
      waterGlintMat: this.waterGlintMat,
      floaters: this.floaters,
      waterLight: this.waterLight,
      arcSpots: this.arcSpots,
      sparkAt: this.sparkAt,
      checkpoint: { pos: new THREE.Vector3(184.7, 0, 12), yaw: Math.PI / 2 },
      breaker: {
        lever: this.breakerLever,
        grip: this.breakerGrip,
        lamp: this.breakerLamp,
        target: this.breakerTarget,
        light: this.breakerLight,
        faceX: BREAKER_X + 0.34,
        z: BREAKER_Z
      },
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

  /** Is `p` inside anything solid? */
  private insideSolid(p: THREE.Vector3): boolean {
    for (const c of this.colliders) if (!c.disabled && c.box.containsPoint(p)) return true;
    return false;
  }

  /**
   * Lay one pipe through world points and hold it up: a clamp back to the
   * wall every couple of metres wherever there is wall behind it, and a rod
   * up to the ceiling where there is not — across the mouth of the generator
   * room, where the run carries straight on over the opening.
   */
  private pipeLine(pts: THREE.Vector3[], r: number, kind: PipeKind, ends = { start: true, end: true }): void {
    this.put(pipeRoute(pts, r, kind, ends), 0, 0);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const d = pts[i + 1].clone().sub(a);
      const len = d.length();
      d.normalize();
      const keep = r * 3 + 0.35; // clear of the elbows and their flanges
      const span = len - 2 * keep;
      if (span < 0.3) continue;
      const count = Math.max(1, Math.round(span / 2.2));
      for (let k = 0; k < count; k++) {
        this.pipeSupport(a.clone().addScaledVector(d, keep + (span * (k + 0.5)) / count), d, r);
      }
    }
  }

  private pipeSupport(p: THREE.Vector3, along: THREE.Vector3, r: number): void {
    const sides =
      Math.abs(along.y) > 0.9
        ? [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]
        : [new THREE.Vector3(-along.z, 0, along.x).normalize(), new THREE.Vector3(along.z, 0, -along.x).normalize()];
    const q = new THREE.Vector3();
    let best: { s: THREE.Vector3; reach: number } | null = null;
    for (const s of sides) {
      for (let t = r + 0.01; t <= r + 0.36; t += 0.01) {
        if (!this.insideSolid(q.copy(p).addScaledVector(s, t))) continue;
        if (!best || t - r < best.reach) best = { s, reach: t - r };
        break;
      }
    }
    if (best) {
      this.put(pipeClamp(r, along, best.s, best.reach), p.x, p.z, 0, p.y);
      return;
    }
    for (let y = p.y + r + 0.01; y < p.y + 2.5; y += 0.02) {
      if (!this.insideSolid(q.set(p.x, y, p.z))) continue;
      this.put(pipeHanger(r, along, y - (p.y + r)), p.x, p.z, 0, p.y);
      return;
    }
  }

  /**
   * The two pipe bundles that follow the route from the lift to the breaker,
   * one down each side, taking every corner with it.
   *
   * Each pipe sits `r + 0.1` off whatever wall it is running along — a hand's
   * width behind it for the clamps and the conduit — and keeps that gap from
   * both walls through a corner, so on an inside corner it cuts across and on
   * an outside one it swings round the end of the wall. In the tall flooded
   * hall both bundles climb up to run high round its walls and come back down
   * to go on into the breaker room: the higher pipe of each pair always
   * climbs first and comes down last, so neither ever crosses the other.
   *
   * The left bundle ends in the main breaker itself, dropping into the top of
   * its cabinet. Everything else ends in a wall, with a collar on the face.
   */
  private pipeworks(): void {
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    // Inside faces of the walls the bundles follow
    const LIFT = 217.88;
    const LOBBY_W = 213.12;
    const B_N = 1.28;
    const B_S = -1.28;
    const LOBBY_N = 2.28;
    const LOBBY_S = -2.28;
    const C_E = 200.88;
    const C_W = 198.32;
    const E_N = 13.28;
    const E_S = 10.72;
    const F_E = HALL.x1 - T / 2;
    const F_W = HALL.x0 + T / 2;
    const F_N = HALL.z1 - T / 2;
    const F_S = HALL.z0 + T / 2;
    const G_N = 14.88;
    const G_S = 9.12;
    const G_W = 154.12;

    // Left-hand bundle: grey over copper. [radius, kind, low y, high y, climb z, drop z]
    // (The drop is kept south of the red lamp on the hall's west wall.)
    const left: [number, PipeKind, number, number, number, number][] = [
      [0.09, 'grey', 2.58, 4.25, 14.3, 15.5],
      [0.055, 'copper', 2.32, 4.0, 14.75, 15.95]
    ];
    for (const [r, kind, lo, hi, climb, drop] of left) {
      const d = r + 0.1;
      const pts = [
        V(LIFT, lo, LOBBY_N - d),
        V(LOBBY_W + d, lo, LOBBY_N - d),
        V(LOBBY_W + d, lo, B_N - d),
        V(C_E - d, lo, B_N - d),
        V(C_E - d, lo, E_N - d),
        V(F_E - d, lo, E_N - d),
        V(F_E - d, lo, climb),
        V(F_E - d, hi, climb),
        V(F_E - d, hi, F_N - d),
        V(F_W + d, hi, F_N - d),
        V(F_W + d, hi, drop),
        V(F_W + d, lo, drop),
        V(F_W + d, lo, G_N - d)
      ];
      if (kind === 'grey') {
        // Round onto the breaker wall and down into the top of the cabinet
        pts.push(V(G_W + d, lo, G_N - d), V(G_W + d, lo, 12.2), V(G_W + d, BREAKER_TOP, 12.2));
      } else {
        pts.push(V(G_W, lo, G_N - d));
      }
      this.pipeLine(pts, r, kind);
    }

    // Right-hand bundle: green over rust
    const right: [number, PipeKind, number, number, number, number][] = [
      [0.12, 'green', 2.62, 4.3, 9.9, 7.65],
      [0.07, 'rust', 2.36, 4.05, 9.45, 7.2]
    ];
    for (const [r, kind, lo, hi, climb, drop] of right) {
      const d = r + 0.1;
      this.pipeLine(
        [
          V(LIFT, lo, LOBBY_S + d),
          V(LOBBY_W + d, lo, LOBBY_S + d),
          V(LOBBY_W + d, lo, B_S + d),
          V(C_W + d, lo, B_S + d),
          // Straight on across the mouth of the generator room, hung from the ceiling
          V(C_W + d, lo, E_S + d),
          V(F_E - d, lo, E_S + d),
          V(F_E - d, lo, climb),
          V(F_E - d, hi, climb),
          V(F_E - d, hi, F_S + d),
          V(F_W + d, hi, F_S + d),
          V(F_W + d, hi, drop),
          V(F_W + d, lo, drop),
          V(F_W + d, lo, G_S + d),
          V(G_W, lo, G_S + d)
        ],
        r,
        kind
      );
    }

    // The hall's own mains, wall to wall below the bundles
    this.pipeLine([V(F_E, 3.35, F_N - 0.26), V(F_W, 3.35, F_N - 0.26)], 0.16, 'rust');
    this.pipeLine([V(F_E, 3.35, F_S + 0.3), V(F_W, 3.35, F_S + 0.3)], 0.2, 'green');
  }

  /**
   * A straight duct that runs into a wall at each end, with a frame on the
   * wall face where it goes through. `x0 < x1`; the ends are the wall faces.
   */
  private ductRun(x0: number, x1: number, y: number, z: number, w: number, h: number): void {
    this.put(duct(x1 - x0 + 0.08, w, h), (x0 + x1) / 2, z, 0, y);
    this.put(ductWallCollar(w, h), x0 + 0.02, z, 0, y);
    this.put(ductWallCollar(w, h), x1 - 0.02, z, 0, y);
  }

  /**
   * A duct that comes down out of the ceiling, runs along x and goes back up
   * into it: a riser box of its own section at each end, into the slab.
   */
  private ductDrop(x0: number, x1: number, y: number, z: number, w: number, h: number, ceiling: number): void {
    const boot = 0.36;
    this.put(duct(x1 - x0 - 2 * boot, w, h), (x0 + x1) / 2, z, 0, y);
    const bottom = y - h / 2;
    const riseH = ceiling + 0.04 - bottom;
    for (const x of [x0 + boot / 2, x1 - boot / 2]) {
      this.put(ductRiser(boot, riseH, w), x, z, 0, bottom + riseH / 2);
      this.put(ductCeilingCollar(boot, w), x, z, 0, ceiling - 0.015);
    }
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
      { x0: HALL.x0, x1: HALL.x1, z0: HALL.z0, z1: HALL.z1, h: 5.0, floor: false, floorY: -1.2 },
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
    const zc = (z0 + z1) / 2;
    const zd = z1 - z0;
    // Ledges, solid from the pit floor up so the pit has real sides
    this.solid(HALL.x1 - x1, 1.2, zd, (HALL.x1 + x1) / 2, -1.2, zc, this.basementFloorMat);
    this.solid(x0 - HALL.x0, 1.2, zd, (HALL.x0 + x0) / 2, -1.2, zc, this.basementFloorMat);
    // The pit bottom
    this.solid(x1 - x0, 0.3, zd, (x0 + x1) / 2, -1.5, zc, this.concreteMat);

    // ---- The water.
    //
    // A flat lit plane never reads as liquid however it is coloured: what
    // sells it is the surface catching light at angles that keep changing.
    // So the standing water is two sheets. The lower one is the body of it —
    // dark, glossy, nearly a mirror — with a rippled NORMAL map, which is
    // what actually bends the highlights about as the scene drifts it. The
    // upper one is a thin additive sheet of glints drifting the other way at
    // a different scale; crossing the two makes the interference pattern
    // moving water has, which a single scrolling texture cannot.
    const ripple = makeTex(noiseCanvas([150, 190, 200], 40), 5, 6);
    const normals = makeTex(rippleNormalCanvas(), 7, 9);
    this.waterMat = new THREE.MeshStandardMaterial({
      map: ripple,
      normalMap: normals,
      // Shallow, so the ripples disturb the reflection rather than shredding it
      normalScale: new THREE.Vector2(0.55, 0.55),
      color: 0x0a1418,
      roughness: 0.06,
      metalness: 0.85,
      emissive: 0x0b3f4e,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.93
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0 - T), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((x0 + x1) / 2, waterY, (z0 + z1) / 2);
    this.group.add(water);
    this.water = water;
    // The glint sheet, a hair above the body of the water
    this.waterGlintMat = new THREE.MeshBasicMaterial({
      map: makeTex(glintCanvas(), 1.6, 2.2),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const glint = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0 - T), this.waterGlintMat);
    glint.rotation.x = -Math.PI / 2;
    glint.position.set((x0 + x1) / 2, waterY + 0.012, (z0 + z1) / 2);
    glint.renderOrder = 2;
    this.group.add(glint);

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
    // ---- The last stretch: the floor is gone entirely, and what is left to
    // cross on is the service run bracketed to the north wall. Narrow, so it
    // has to be walked rather than strolled over.
    for (const [px0, px1, pz, seed] of PIPE_STEPS) {
      this.colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(px0, -1.2, pz - PIPE_WALK / 2),
          new THREE.Vector3(px1, PLATFORM_TOP, pz + PIPE_WALK / 2)
        )
      });
      this.put(brokenPipeStep(px1 - px0, 0.22, seed), (px0 + px1) / 2, pz, 0, PLATFORM_TOP);
      this.arcSpots.push(new THREE.Vector3(px0 - 0.15, waterY + 0.02, pz));
      this.arcSpots.push(new THREE.Vector3(px1 + 0.15, waterY + 0.02, pz - 0.2));
    }
    // The rest of the run, snapped off and hanging above the water — the
    // stumps of what the two footings used to be part of
    for (const [sx, sz, len] of [[169.9, 16.55, 0.7], [163.9, 16.55, 0.5], [166.9, 17.25, 1.6]] as const) {
      const stub = brokenPipeStep(len, 0.15, Math.round(sx));
      stub.rotation.z = 0.16;
      this.put(stub, sx, sz, 0, waterY + 0.32);
    }

    // Debris just breaking the surface: something to look at, nothing to stand on
    for (const [cx, cz, w, d, seed] of DECOYS) {
      this.put(debrisPlatform(w, d, 0.9, seed), cx, cz, seed * 0.7, waterY + 0.07);
      this.arcSpots.push(new THREE.Vector3(cx, waterY + 0.02, cz));
    }

    // ---- The crew who were down here when it flooded. Two of them face
    // down in the water, and the helmets that came off them drifting
    // separately — kept off the route so they are something you look at
    // rather than something you land on.
    for (const [fx, fz, yaw, seed] of [[178.2, 8.6, 0.7, 21], [168.4, 10.2, 2.4, 22]] as const) {
      const body = floatingWorker(seed);
      body.position.set(fx, waterY, fz);
      body.rotation.y = yaw;
      this.group.add(body);
      this.floaters.push(body);
      this.shootables.push(body);
    }
    for (const [hx, hz, seed] of [[176.9, 9.4, 23], [171.6, 8.1, 24], [165.2, 13.4, 25]] as const) {
      const hat = floatingHelmet(seed);
      hat.position.set(hx, waterY, hz);
      this.group.add(hat);
      this.floaters.push(hat);
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
    b.group.position.set(BREAKER_X, 0, BREAKER_Z);
    b.group.rotation.y = Math.PI / 2;
    this.group.add(b.group);
    b.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.shootables.push(o);
    });
    this.blk(BREAKER_X + 0.2, BREAKER_Z, 0.42, 1.1, 2.2);
    this.breakerLever = b.lever;
    this.breakerGrip = b.grip;
    this.breakerLamp = b.lamp;
    this.breakerTarget = b.group;
    this.breakerLight = new THREE.PointLight(0xff2a18, 2.4, 7, 1.5);
    this.breakerLight.position.set(155.1, 1.8, BREAKER_Z);
    this.group.add(this.breakerLight);
  }

  /**
   * Everything that makes it a plant room rather than a concrete maze.
   *
   * Lamps on the corridor walls sit at 2.0m, under the pipe bundles rather
   * than in among them.
   */
  private dressBasement(): void {
    this.pipeworks();

    // ---- Lift lobby
    this.put(controlConsole(), 215.6, -1.83);
    this.blk(215.6, -1.83, 1.2, 0.64, CONSOLE_H);
    this.put(warningSign(['AUTHORISED', 'PERSONNEL ONLY']), 214.2, 2.28 - 0.001, Math.PI, 1.55);
    this.redLamp(216.9, 2.0, 2.28, Math.PI);
    this.mainLight(215.5, 2.95, 0);

    // ---- First corridor, heading west
    // The duct comes down out of the ceiling past the lobby and goes back up
    // into it short of the turn: no open ends hanging in the corridor
    this.ductDrop(201.8, 212.4, 2.7, 0.1, 0.55, 0.34, 3.0);
    this.put(electricalBox(0.6, 0.8), 206.5, -1.28, 0, 1.45);
    this.put(electricalBox(0.45, 0.6), 205.6, -1.28, 0, 1.3);
    // Down out of the ceiling, along the wall and into the top of the box
    this.put(
      cable([
        new THREE.Vector3(212.72, 3.06, -1.236),
        new THREE.Vector3(212.66, 2.18, -1.235),
        new THREE.Vector3(209.5, 1.66, -1.22),
        new THREE.Vector3(207.1, 1.92, -1.2),
        new THREE.Vector3(206.64, 1.9, -1.16),
        new THREE.Vector3(206.62, 1.8, -1.16)
      ]),
      0,
      0
    );
    for (const [bx, kind] of [[202.1, 'blue'], [202.75, 'rust'], [203.4, 'yellow']] as const) {
      this.put(barrel(kind), bx, 0.95, bx);
      this.blk(bx, 0.95, 0.6, 0.6, 0.9);
    }
    this.put(vent(), 211.4, 1.28, Math.PI, 0.45);
    this.redLamp(209.2, 2.0, -1.28, 0);
    this.redLamp(204.0, 2.0, 1.28, Math.PI);
    this.mainLight(210, 2.72, -0.35);
    this.mainLight(204, 2.72, -0.35);

    // ---- Second corridor, heading north
    this.put(electricalBox(0.7, 0.9), 200.88, 6.4, -Math.PI / 2, 1.4);
    this.put(warningSign(['GENERATOR', 'ROOM'], 0.6, 0.38), 198.32, 9.55, Math.PI / 2, 1.9);
    this.put(barrel('rust'), 198.66, -0.9, 0.4);
    this.blk(198.66, -0.9, 0.6, 0.6, 0.9);
    this.put(barrel('blue'), 199.3, -0.95, 1.9);
    this.blk(199.3, -0.95, 0.6, 0.6, 0.9);
    this.redLamp(200.88, 2.0, 3.8, -Math.PI / 2);
    this.redLamp(198.32, 2.0, 0.6, Math.PI / 2);
    this.mainLight(199.6, 2.72, 1.6, true);
    this.mainLight(199.6, 2.72, 9.6, true);

    // ---- Generator room
    this.put(generator(), 194.1, 3.32);
    this.blk(194.1, 3.32, 2.7, 1.2, 1.7);
    this.put(generator(), 194.1, 7.68, Math.PI);
    this.blk(194.1, 7.68, 2.7, 1.2, 1.7);
    this.put(electricalBox(0.8, 1.0), 191.12, 5.5, Math.PI / 2, 1.5);
    // Each set's output: out of the bottom of its control box, straight down
    // clear of the skid, across the floor lying ON it, and up the wall into
    // the distribution box
    const onFloor = 0.03 + 0.004;
    const atWall = 191.12 + 0.03 + 0.004;
    this.put(
      routedCable([
        new THREE.Vector3(193.6, 0.93, 3.96),
        new THREE.Vector3(193.6, onFloor, 3.96),
        new THREE.Vector3(192.55, onFloor, 4.62),
        new THREE.Vector3(atWall, onFloor, 5.3),
        new THREE.Vector3(atWall, 1.04, 5.3)
      ]),
      0,
      0
    );
    this.put(
      routedCable([
        new THREE.Vector3(194.6, 0.93, 7.04),
        new THREE.Vector3(194.6, onFloor, 7.04),
        new THREE.Vector3(193.1, onFloor, 6.42),
        new THREE.Vector3(atWall, onFloor, 5.7),
        new THREE.Vector3(atWall, 1.04, 5.7)
      ]),
      0,
      0
    );
    // Wall to header, straight through the room overhead
    this.ductRun(191.12, 198.08, 3.3, 5.5, 0.7, 0.4);
    this.put(barrel('yellow'), 191.6, 3.1, 0.2);
    this.blk(191.6, 3.1, 0.6, 0.6, 0.9);
    this.put(barrel('yellow'), 191.6, 7.9, 1.3);
    this.blk(191.6, 7.9, 0.6, 0.6, 0.9);
    this.redLamp(192.3, 2.9, 2.62, 0);
    // A second one across the room, or the far generator is only a silhouette
    this.redLamp(196.2, 2.9, 8.38, Math.PI);
    this.mainLight(194.6, 3.3, 5.5);

    // ---- Third corridor, heading west to the hall
    this.put(controlConsole(), 192.5, 12.96, Math.PI);
    this.blk(192.5, 12.96, 1.2, 0.64, CONSOLE_H);
    this.put(barrel('blue'), 196.6, 10.99, 0.7);
    this.blk(196.6, 10.99, 0.6, 0.6, 0.9);
    this.put(barrel('rust'), 197.25, 11.0, 2.4);
    this.blk(197.25, 11.0, 0.6, 0.6, 0.9);
    this.put(warningSign(['DANGER', 'HIGH VOLTAGE']), 187.3, 10.72, 0, 1.65);
    this.put(warningSign(['FLOODED AREA', 'KEEP CLEAR']), 187.3, 13.28, Math.PI, 1.65);
    this.redLamp(194.6, 2.0, 10.72, 0);
    this.redLamp(189.0, 2.0, 13.28, Math.PI);
    this.mainLight(195, 2.72, 12);
    this.mainLight(189, 2.72, 12);

    // ---- The hall
    // The big duct runs wall to wall down the middle. The two fittings that
    // were on the centre line hung inside it; they sit either side now.
    this.ductRun(162.12, 185.88, 4.6, 12, 0.8, 0.5);
    this.put(warningSign(['DANGER', 'ELECTRIFIED WATER']), 184.2, HALL.z0 + 0.12, 0, 1.75);
    this.put(warningSign(['DANGER', 'ELECTRIFIED WATER']), 184.2, HALL.z1 - 0.12, Math.PI, 1.75);
    this.redLamp(185.88, 3.4, HALL.z0 + 0.9, -Math.PI / 2);
    this.redLamp(162.12, 3.4, HALL.z1 - 0.9, Math.PI / 2);
    this.mainLight(184, 4.62, 14.4);
    this.mainLight(174, 4.62, HALL.z0 + 2.4);
    this.mainLight(174, 4.62, HALL.z1 - 2.4);
    // Over the pipe traverse, so the last stretch is not crossed blind
    this.mainLight(166.5, 4.62, HALL.z1 - 1.6);
    this.mainLight(164, 4.62, 9.6);

    // ---- Breaker room
    this.put(electricalBox(0.6, 0.8), 157.2, 9.12, 0, 1.5);
    this.put(electricalBox(0.6, 0.8), 158.2, 9.12, 0, 1.5);
    this.put(controlConsole(), 159.2, 14.56, Math.PI);
    this.blk(159.2, 14.56, 1.2, 0.64, CONSOLE_H);
    this.put(warningSign(['MAIN', 'ELECTRICAL'], 0.6, 0.38), 154.12, 14.1, Math.PI / 2, 1.95);
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
