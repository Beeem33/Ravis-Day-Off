import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Collider, type Waypoint, noiseCanvas, makeTex } from './OfficeLevelBuilder';
import { mergeStatic } from './mergeStatic';
import { rubble, cable, warningSign } from './MechanicalProps';
import { rubblePile, scatteredPaper, fireAlarm } from './OfficeProps';

// ---------------------------------------------------------------- the shaft
//
// Stairwell B, from the top floor down to the ground: a concrete box 10 m
// by 8 m, nine floors of it at 4.4 m a floor — tall enough that a missed
// jump is a whole storey or more, and that kills. x runs east, z south, y
// up, and the ground floor is y = 0.
//
// Floors are counted from 0, the ground floor, to 8, the top; the signs on
// the walls say 'G' and 2..9. Storey f is the stretch from floor f down to
// floor f-1, a dog-leg: the FLOOR LANDING on the west end, flight A running
// east down the north side to the HALF LANDING on the east end, flight B back
// west down the south side to the floor landing below. Between the flights
// the well, 3.6 m across and open top to bottom — and through a hatch in
// the roof, the way the man off the roof comes down it.
//
// North of the stairwell, behind its wall, the lifts: a double shaft.
//
// Coming down it, in order:
//   storey 8   as it was
//   storey 7   flight A broken across the middle: jump it. A fire and a
//              mine on the half landing, a lane between them
//   storeys 6, 5   the collapse: what is left of the stairs is what is still
//              on the walls — a corner of landing, runs of steps, the half
//              landing's north end — five jumps down it, mines on three
//   storey 5   live cables swinging across flight A; the half landing
//              flooded from a burst main with a live wire in it, a dry
//              strip along the wall
//   storey 4   the ceiling down over the half landing: crawl under it
//   storey 3   no stairs: through the wall into the lift shaft, down onto
//              one car's roof, across to the other's, and out
//   storeys 2, 1   as they were, near enough, to the door out

export const SW = {
  storeys: 8,
  H: 4.4,
  x1: 10,
  z1: 8,
  /** Floor landings x 0..land, half landings x x1-land..x1. */
  land: 2.4,
  /** Flight A z 0..flight, the well, flight B z1-flight..z1. */
  flight: 2.2,
  steps: 13
} as const;

const T = 0.3;
const H = SW.H;
const RISE = H / 2 / SW.steps;
const XA = SW.land;
const XB = SW.x1 - SW.land;
const RUN = (XB - XA) / SW.steps;
const ZA = SW.flight;
const ZB = SW.z1 - SW.flight;
/** Colliders go well down under every walking surface, so a long fall can't step through one. */
const THICK = 0.6;
const RAIL_H = 1.0;
/** The floor whose door is blown open, a fire behind it. */
const OPEN = 4;
/** The lift shaft, north of the stairwell's north wall. */
const SHAFT = { x0: 0.3, x1: 9.7, z0: -3.3, z1: -T, pit: -2 };

export const floorY = (f: number): number => f * H;
export const halfY = (f: number): number => f * H - H / 2;
const stepA = (f: number, i: number): number => floorY(f) - (i + 1) * RISE;
const stepB = (f: number, j: number): number => halfY(f) - (j + 1) * RISE;

export interface StairAgent {
  pos: THREE.Vector3;
  yaw: number;
  armour: boolean;
  aim: boolean;
  area: THREE.Box3;
  upTo: number;
  group: number;
}

export interface StairFire {
  pos: THREE.Vector3;
  size: number;
  zone: THREE.Box3 | null;
}

/** A mine on the rubble: step near it and it goes. The LED's material is its own, for blinking. */
export interface StairMine {
  pos: THREE.Vector3;
  led: THREE.MeshStandardMaterial;
  obj: THREE.Object3D;
}

/** A live cable hanging from `pivot`, swinging across the flight along `axis`. */
export interface LiveCable {
  pivot: THREE.Vector3;
  length: number;
  axis: THREE.Vector3;
  amp: number;
  period: number;
  phase: number;
  mesh: THREE.Mesh;
  tip: THREE.Mesh;
}

/** Water from a leak: drops from `from` to the surface at `toY`, `rate` a second. */
export interface StairDrip {
  from: THREE.Vector3;
  toY: number;
  rate: number;
}

export interface StairwellData {
  group: THREE.Group;
  colliders: Collider[];
  shootables: THREE.Object3D[];
  occluders: THREE.Object3D[];
  glassPanes: [];
  waypoints: Waypoint[];
  checkpoints: { pos: THREE.Vector3; yaw: number; reach: THREE.Box3 }[];
  agents: StairAgent[];
  fires: StairFire[];
  fireLights: THREE.PointLight[];
  sparks: THREE.Vector3[];
  exitTrigger: THREE.Box3;
  mines: StairMine[];
  cables: LiveCable[];
  /** Live water: in it, he is dead. */
  shockZones: THREE.Box3[];
  drips: StairDrip[];
  /** Coming up to the crawl: the place to tell him to get down. */
  crouchHint: THREE.Box3;
  /** Where the man off the roof comes down: the well's middle, from the hatch. */
  fall: { x: number; z: number; top: number };
}

const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;
const NORTH = 0;
const SOUTH = Math.PI;

export class StairwellBuilder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private dressing: THREE.Object3D[] = [];
  private shell: THREE.Mesh[] = [];
  private fires: StairFire[] = [];
  private fireLights: THREE.PointLight[] = [];
  private sparks: THREE.Vector3[] = [];
  private mines: StairMine[] = [];
  private cables: LiveCable[] = [];
  private shockZones: THREE.Box3[] = [];
  private drips: StairDrip[] = [];

  private wallNS!: THREE.MeshLambertMaterial;
  private wallEW!: THREE.MeshLambertMaterial;
  private concrete!: THREE.MeshLambertMaterial;
  private concreteDark!: THREE.MeshLambertMaterial;
  private broken!: THREE.MeshLambertMaterial;
  private nosing!: THREE.MeshLambertMaterial;
  private steel!: THREE.MeshLambertMaterial;
  private rust!: THREE.MeshLambertMaterial;
  private char!: THREE.MeshLambertMaterial;
  private door!: THREE.MeshLambertMaterial;
  private shaftWall!: THREE.MeshLambertMaterial;
  private carMat!: THREE.MeshLambertMaterial;
  private pipeMat!: THREE.MeshLambertMaterial;
  private unseen = new THREE.MeshBasicMaterial({ visible: false });

  build(): StairwellData {
    this.makeMaterials();
    this.buildShell();
    this.buildStoreys();
    this.buildDoors();
    this.buildBreaks();
    this.buildCollapse();
    this.buildLiveWires();
    this.buildCrawl();
    this.buildShaft();
    this.buildFires();
    this.buildPipes();
    this.buildDressing();
    this.buildLighting();
    this.shootables = mergeStatic(this.group, this.dressing, this.shootables);
    this.mergeShell();

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      occluders: this.occluders,
      glassPanes: [],
      waypoints: this.makeWaypoints(),
      checkpoints: [
        // In through the top floor's door, facing out over the well
        { pos: new THREE.Vector3(1.2, floorY(8), 2.6), yaw: EAST, reach: new THREE.Box3() },
        // The eighth floor's landing, above the first of the breaks
        { pos: new THREE.Vector3(1.0, floorY(7), 1.2), yaw: EAST, reach: box3(0, floorY(7), 0, XA, floorY(7) + 2, SW.z1) },
        // The sixth floor's landing, at the bottom of the collapse
        { pos: new THREE.Vector3(1.4, floorY(5), 1.2), yaw: EAST, reach: box3(0, floorY(5), 0, XA, floorY(5) + 2, SW.z1) },
        // The fourth floor's landing, before the lift shaft
        { pos: new THREE.Vector3(1.4, floorY(3), 3.4), yaw: NORTH, reach: box3(0, floorY(3), 0, XA, floorY(3) + 2, SW.z1) },
        // Out of the shaft onto the half landing
        { pos: new THREE.Vector3(8.8, halfY(3), 1.8), yaw: SOUTH, reach: box3(XB, halfY(3), 0, SW.x1, halfY(3) + 2, SW.z1) }
      ],
      agents: this.agents(),
      fires: this.fires,
      fireLights: this.fireLights,
      sparks: this.sparks,
      exitTrigger: box3(-0.2, 0, 3.4, 0.75, 2.2, 4.6),
      mines: this.mines,
      cables: this.cables,
      shockZones: this.shockZones,
      drips: this.drips,
      crouchHint: box3(XB, halfY(4) - 0.1, 0, SW.x1, halfY(4) + 2, 2.6),
      fall: { x: 5.0, z: 4.0, top: floorY(8) + H - 0.6 }
    };
  }

  // ------------------------------------------------------------- materials

  private makeMaterials(): void {
    const storey = storeyWallCanvas();
    const tex = (w: number): THREE.Texture => {
      const t = makeTex(storey, w / H, 1);
      t.magFilter = THREE.LinearFilter;
      return t;
    };
    this.wallNS = new THREE.MeshLambertMaterial({ map: tex(SW.x1 + 2 * T) });
    this.wallEW = new THREE.MeshLambertMaterial({ map: tex(SW.z1 + 2 * T) });
    this.concrete = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([128, 126, 120], 12), 2, 2) });
    this.concreteDark = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([86, 84, 80], 12), 2, 2) });
    // A broken face: rougher, darker, the aggregate showing
    this.broken = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([104, 99, 92], 30), 1, 1) });
    this.nosing = new THREE.MeshLambertMaterial({ color: 0xc9a22a });
    this.steel = new THREE.MeshLambertMaterial({ color: 0x5c6167 });
    this.rust = new THREE.MeshLambertMaterial({ color: 0x6a3f28 });
    this.char = new THREE.MeshLambertMaterial({ color: 0x1d1916 });
    this.door = new THREE.MeshLambertMaterial({ color: 0x6b2a24 });
    this.shaftWall = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([70, 70, 68], 16), 3, 3) });
    this.carMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([150, 154, 158], 10), 2, 1) });
    this.pipeMat = new THREE.MeshLambertMaterial({ color: 0x7a3c2a });
  }

  // --------------------------------------------------------------- helpers

  private solid(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    mat: THREE.Material, opts: { occlude?: boolean; collide?: boolean; surface?: string } = {}
  ): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.userData.surface = opts.surface ?? 'concrete';
    this.group.add(m);
    this.shootables.push(m);
    this.shell.push(m);
    if (opts.occlude !== false) this.occluders.push(m);
    if (opts.collide !== false) this.colliders.push({ box: box3(x0, y0, z0, x1, y1, z1) });
    return m;
  }

  private blk(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.colliders.push({ box: box3(x0, y0, z0, x1, y1, z1) });
  }

  private put(o: THREE.Object3D, x: number, y: number, z: number, yaw = 0): THREE.Object3D {
    o.position.set(x, y, z);
    o.rotation.y = yaw;
    this.group.add(o);
    this.dressing.push(o);
    o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) {
        if (!m.userData.surface) m.userData.surface = 'concrete';
        this.shootables.push(m);
      }
    });
    return o;
  }

  /** A loose mesh into the dressing, placed where it already is. */
  private add(m: THREE.Object3D): void {
    this.put(new THREE.Group().add(m), 0, 0, 0);
  }

  /** A bar from a to b: rebar, a pipe, a cable stay — scenery. */
  private bar(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): void {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    this.add(m);
  }

  /** A seeded random stream. */
  private rnd(seed: number): () => number {
    let s = seed * 9301 + 49297;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  /**
   * The broken end of a run of stairs or a landing: the slab torn off along
   * a line, chunks of it still hanging by their steel below the edge, rebar
   * sticking out of the face. `along` is the way out of the face (unit, flat),
   * `across` the edge's length, `y` the walking surface there.
   */
  private brokenEdge(at: THREE.Vector3, along: THREE.Vector3, across: number, y: number, seed: number, hangs = true): void {
    const r = this.rnd(seed);
    const side = new THREE.Vector3(-along.z, 0, along.x);
    const n = Math.max(3, Math.round(across / 0.32));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n - 0.5;
      const base = at.clone().addScaledVector(side, u * across);
      // A jagged lip: lumps of the slab's edge at different lengths
      const lump = new THREE.Mesh(new THREE.BoxGeometry(0.22 + r() * 0.2, 0.18 + r() * 0.2, 0.2 + r() * 0.2), this.broken);
      lump.position.copy(base).addScaledVector(along, 0.02 + r() * 0.08);
      lump.position.y = y - 0.12 - r() * 0.25;
      lump.rotation.set(r() * 0.8, r() * 1.2, r() * 0.8);
      this.add(lump);
      // Rebar out of the face, bent down
      if (r() < 0.75) {
        const a = base.clone().setY(y - 0.12 - r() * 0.2);
        const b = a.clone().addScaledVector(along, 0.25 + r() * 0.35).addScaledVector(side, (r() - 0.5) * 0.15);
        b.y -= 0.05 + r() * 0.3;
        this.bar(a, b, 0.012, this.rust);
      }
    }
    // A piece still hanging by its steel under the edge
    if (!hangs) return;
    const hang = new THREE.Mesh(new THREE.BoxGeometry(across * 0.35, 0.16, 0.5), this.broken);
    hang.position.copy(at).addScaledVector(along, 0.15).addScaledVector(side, (r() - 0.5) * across * 0.4);
    hang.position.y = y - 0.7;
    hang.rotation.set(0.9 + r() * 0.3, r() * 0.4, 0.2);
    this.add(hang);
    this.bar(at.clone().setY(y - 0.2), hang.position.clone().setY(y - 0.62), 0.012, this.rust);
  }

  // ----------------------------------------------------------------- shell

  /** The four walls, the ground and the roof — with the roof hatch, and two holes into the lift shaft. */
  private buildShell(): void {
    const top = floorY(SW.storeys) + H;
    const X = SW.x1;
    const Z = SW.z1;
    for (let f: number = 0; f <= SW.storeys; f++) {
      const y0 = floorY(f);
      const y1 = y0 + H;
      // North wall: the lift shaft's two breaches are in this storey's and the one below's
      if (f === 3) this.wallWithHole(y0, y1, 0.5, 2.0, y0, y0 + 2.3);
      else if (f === 2) this.wallWithHole(y0, y1, 8.0, 9.6, halfY(3), halfY(3) + 2.1);
      else this.solid(-T, y0, -T, X + T, y1, 0, this.wallNS);
      this.solid(-T, y0, Z, X + T, y1, Z + T, this.wallNS);
      this.solid(X, y0, 0, X + T, y1, Z, this.wallEW);
      if (f === OPEN) {
        this.solid(-T, y0, 0, 0, y1, 3.5, this.wallEW);
        this.solid(-T, y0, 4.5, 0, y1, Z, this.wallEW);
        this.solid(-T, y0 + 2.1, 3.5, 0, y1, 4.5, this.wallEW);
      } else {
        this.solid(-T, y0, 0, 0, y1, Z, this.wallEW);
      }
    }
    this.solid(-T, -0.4, -T, X + T, 0, Z + T, this.concrete);
    // The roof, and the hatch in it the man comes through
    const hx0 = 4.3;
    const hx1 = 5.7;
    const hz0 = 3.3;
    const hz1 = 4.7;
    this.solid(-T, top, -T, X + T, top + 0.3, hz0, this.concrete);
    this.solid(-T, top, hz1, X + T, top + 0.3, Z + T, this.concrete);
    this.solid(-T, top, hz0, hx0, top + 0.3, hz1, this.concrete);
    this.solid(hx1, top, hz0, X + T, top + 0.3, hz1, this.concrete);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ color: 0x8a96a3, fog: false }));
    sky.rotation.x = Math.PI / 2;
    sky.position.set(5.0, top + 0.6, 4.0);
    this.group.add(sky);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 1.5), this.steel);
    lid.position.set(5.9, top + 0.75, 4.6);
    lid.rotation.set(0.2, 0.3, 1.2);
    this.add(lid);
  }

  /** A storey of north wall with a ragged hole through it (x0..x1, y0h..y1h). */
  private wallWithHole(y0: number, y1: number, hx0: number, hx1: number, hy0: number, hy1: number): void {
    const X = SW.x1;
    this.solid(-T, y0, -T, hx0, y1, 0, this.wallNS);
    this.solid(hx1, y0, -T, X + T, y1, 0, this.wallNS);
    if (hy0 > y0) this.solid(hx0, y0, -T, hx1, hy0, 0, this.wallNS);
    this.solid(hx0, hy1, -T, hx1, y1, 0, this.wallNS);
    // Its ragged edges, both faces
    const r = this.rnd(Math.round(hx0 * 10));
    for (let i = 0; i < 9; i++) {
      const u = i / 8;
      for (const zf of [0.02, -T - 0.02]) {
        const side = i % 2 === 0;
        const lump = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.12), this.broken);
        if (side) lump.position.set(i < 4 ? hx0 + 0.05 : hx1 - 0.05, hy0 + u * (hy1 - hy0), zf);
        else lump.position.set(hx0 + u * (hx1 - hx0), hy1 - 0.05, zf);
        lump.rotation.set(r(), r(), r());
        this.add(lump);
      }
      this.bar(new THREE.Vector3(hx0 + u * (hx1 - hx0), hy1 + 0.05, -T / 2), new THREE.Vector3(hx0 + u * (hx1 - hx0) + 0.1, hy1 - 0.35 - r() * 0.3, -T / 2), 0.01, this.rust);
    }
  }

  // --------------------------------------------------------------- storeys

  private buildStoreys(): void {
    for (let f: number = SW.storeys; f >= 0; f--) {
      this.floorLanding(f);
      if (f === 0) break;
      const a = this.missingA(f);
      const b = this.missingB(f);
      for (let i = 0; i < SW.steps; i++) if (!a.has(i)) this.step(f, 'A', i);
      for (let j = 0; j < SW.steps; j++) if (!b.has(j)) this.step(f, 'B', j);
      this.halfLanding(f);
      this.railings(f, a, b);
    }
  }

  private missingA(f: number): Set<number> {
    if (f === 7) return new Set([4, 5, 6, 7, 8, 9]);
    if (f === 6) return new Set([5, 6, 7, 8, 9]);
    if (f === 3) return new Set(range(SW.steps));
    return new Set();
  }

  private missingB(f: number): Set<number> {
    if (f === 7) return new Set([6, 7, 8, 9, 10, 11, 12]);
    if (f === 6) return new Set([0, 1, 7, 8, 9, 10, 11, 12]);
    return new Set();
  }

  /** The floor's landing: all of it, but on the sixth floor only its south-west corner is left. */
  private floorLanding(f: number): void {
    if (f === 0) return;
    const y = floorY(f);
    const z0 = f === 6 ? 4.0 : 0;
    this.solid(0, y - 0.3, z0, XA, y, SW.z1, this.concrete);
    this.blk(0, y - THICK, z0, XA, y - 0.3, SW.z1);
    if (f === 6) {
      this.brokenEdge(new THREE.Vector3(XA / 2, y, z0), new THREE.Vector3(0, 0, -1), XA, y, 61);
      this.brokenEdge(new THREE.Vector3(XA, y, (z0 + SW.z1) / 2), new THREE.Vector3(1, 0, 0), SW.z1 - z0, y, 62);
    } else {
      this.solid(XA - 0.06, y, ZA, XA - 0.01, y + 0.005, ZB, this.nosing, { collide: false, occlude: false });
    }
  }

  /** The half landing: whole, or on storey 6 its north end only. */
  private halfLanding(f: number): void {
    const y = halfY(f);
    const z1 = f === 6 ? 4.5 : SW.z1;
    this.solid(XB, y - 0.3, 0, SW.x1, y, z1, this.concrete);
    this.blk(XB, y - THICK, 0, SW.x1, y - 0.3, z1);
    if (f === 6) {
      this.brokenEdge(new THREE.Vector3((XB + SW.x1) / 2, y, z1), new THREE.Vector3(0, 0, 1), SW.x1 - XB, y, 71);
      this.brokenEdge(new THREE.Vector3(XB, y, (ZA + z1) / 2), new THREE.Vector3(-1, 0, 0), z1 - ZA, y, 72);
    }
  }

  /** One step: a solid block from its tread down, a yellow nosing on its front edge, and the flight's soffit under it. */
  private step(f: number, flight: 'A' | 'B', i: number): void {
    const top = flight === 'A' ? stepA(f, i) : stepB(f, i);
    const x0 = flight === 'A' ? XA + i * RUN : XB - (i + 1) * RUN;
    const x1 = x0 + RUN;
    const z0 = flight === 'A' ? 0 : ZB;
    const z1 = z0 + SW.flight;
    this.solid(x0, top - RISE - 0.3, z0, x1, top, z1, this.concrete);
    this.blk(x0, top - THICK, z0, x1, top - RISE - 0.3, z1);
    const nx = flight === 'A' ? x1 - 0.05 : x0;
    this.solid(nx, top, z0 + 0.06, nx + 0.05, top + 0.006, z1 - 0.06, this.nosing, { collide: false, occlude: false });
    // Where a run of steps stops short, it is broken off
    const miss = flight === 'A' ? this.missingA(f) : this.missingB(f);
    const down = i + 1;
    const up = i - 1;
    // The way down the flight (A runs east, B west) and its broken faces
    const dir = flight === 'A' ? 1 : -1;
    if (down < SW.steps && miss.has(down)) {
      const ex = flight === 'A' ? x1 : x0;
      this.brokenEdge(new THREE.Vector3(ex, top, (z0 + z1) / 2), new THREE.Vector3(dir, 0, 0), SW.flight, top, f * 31 + i);
    }
    if (up >= 0 && miss.has(up)) {
      const ex = flight === 'A' ? x0 : x1;
      this.brokenEdge(new THREE.Vector3(ex, top, (z0 + z1) / 2), new THREE.Vector3(-dir, 0, 0), SW.flight, top + RISE, f * 37 + i);
    }
  }

  /**
   * The balustrades along each flight's well side and across the landings'
   * ends. Where a flight is broken its rail is gone with it; the collapse's
   * remnants have none (they are jumped onto from the well side).
   */
  private railings(f: number, missA: Set<number>, missB: Set<number>): void {
    const bent = (flight: 'A' | 'B'): boolean => f === 6 || (f === 7 && flight === 'B');
    for (const flight of ['A', 'B'] as const) {
      if (bent(flight)) continue;
      const miss = flight === 'A' ? missA : missB;
      const z = flight === 'A' ? ZA : ZB;
      let run: number[] = [];
      const flush = (): void => {
        if (run.length >= 2) this.rail(f, flight, run[0], run[run.length - 1], z);
        run = [];
      };
      for (let i = 0; i < SW.steps; i++) {
        if (miss.has(i)) {
          flush();
          continue;
        }
        run.push(i);
        const top = flight === 'A' ? stepA(f, i) : stepB(f, i);
        const x0 = flight === 'A' ? XA + i * RUN : XB - (i + 1) * RUN;
        this.blk(x0, top, z - 0.05, x0 + RUN, top + RAIL_H, z + 0.05);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, RAIL_H, 0.035), this.steel);
        post.position.set(x0 + RUN / 2, top + RAIL_H / 2, z);
        this.add(post);
      }
      flush();
    }
    const yF = floorY(f);
    if (f !== 6) this.endRail(XA, yF, ZA, ZB);
    if (f !== 6) this.endRail(XB, halfY(f), ZA, ZB);
  }

  private rail(f: number, flight: 'A' | 'B', i0: number, i1: number, z: number): void {
    const xa = flight === 'A' ? XA + (i0 + 0.5) * RUN : XB - (i0 + 0.5) * RUN;
    const xb = flight === 'A' ? XA + (i1 + 0.5) * RUN : XB - (i1 + 0.5) * RUN;
    const ya = (flight === 'A' ? stepA(f, i0) : stepB(f, i0)) + RAIL_H;
    const yb = (flight === 'A' ? stepA(f, i1) : stepB(f, i1)) + RAIL_H;
    this.bar(new THREE.Vector3(xa, ya, z), new THREE.Vector3(xb, yb, z), 0.025, this.steel);
  }

  private endRail(x: number, y: number, z0: number, z1: number): void {
    this.blk(x - 0.05, y, z0, x + 0.05, y + RAIL_H, z1);
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, z1 - z0), this.steel);
    top.position.set(0, RAIL_H, 0);
    g.add(top);
    for (let z = 0.2; z < z1 - z0; z += 0.5) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, RAIL_H, 0.035), this.steel);
      post.position.set(0, RAIL_H / 2, z - (z1 - z0) / 2);
      g.add(post);
    }
    this.put(g, x, y, (z0 + z1) / 2);
  }

  // ----------------------------------------------------------------- doors

  private buildDoors(): void {
    const win = new THREE.MeshLambertMaterial({ color: 0x1a1f22 });
    for (let f: number = 0; f <= SW.storeys; f++) {
      const y = floorY(f);
      if (f === 6) continue; // the landing is gone and the door with it
      if (f !== OPEN) {
        const g = new THREE.Group();
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.2, 1.12), this.steel);
        frame.position.set(0.02, 1.1, 0);
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, 1.0), this.door);
        leaf.position.set(0.05, 1.05, 0);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.22), win);
        glass.position.set(0.085, 1.45, -0.22);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.8), this.steel);
        bar.position.set(0.12, 1.0, 0);
        g.add(frame, leaf, glass, bar);
        this.put(g, 0, y, 4.0);
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), floorSignMat(f === 0 ? 'G' : String(f + 1)));
      sign.position.set(0.012, y + 1.55, 2.4);
      sign.rotation.y = Math.PI / 2;
      this.add(sign);
    }
    const exit = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.16, 0.44),
      new THREE.MeshStandardMaterial({ color: 0x0b2a12, emissive: 0x2bff6a, emissiveIntensity: 1.4 })
    );
    exit.position.set(0.04, 2.45, 4.0);
    this.group.add(exit);
    const car = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.26), labelMat('CAR PARK  ▶', '#e8e4d8', '#2c3138'));
    car.position.set(0.012, 2.2, 5.2);
    car.rotation.y = Math.PI / 2;
    this.add(car);
    // The fifth floor's door, blown off its hinges: the corridor behind it burning
    const y5 = floorY(OPEN);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 2.0), this.door);
    leaf.rotation.set(0.05, 0.4, 0.12);
    this.put(new THREE.Group().add(leaf), 0.95, y5 + 0.05, 4.6);
    this.solid(-2.6, y5 - 0.3, 3.2, -T, y5, 4.8, this.char);
    this.solid(-2.6, y5 + 2.4, 3.2, -T, y5 + 2.7, 4.8, this.char, { collide: false });
    this.solid(-2.6, y5, 3.1, -T, y5 + 2.4, 3.2, this.char);
    this.solid(-2.6, y5, 4.8, -T, y5 + 2.4, 4.9, this.char);
    this.solid(-2.7, y5, 3.1, -2.6, y5 + 2.4, 4.9, this.char);
    this.blk(-0.05, y5, 3.5, 0.0, y5 + 2.1, 4.5);
    this.fires.push({ pos: new THREE.Vector3(-1.8, y5, 4.0), size: 1.2, zone: null });
  }

  // ---------------------------------------------------------------- breaks

  /**
   * Storey 7: flight A broken across its middle, a gap of six steps to jump;
   * the half landing burning on its south side, a mine in the lane past it.
   */
  private buildBreaks(): void {
    const yH = halfY(7);
    this.fires.push({ pos: new THREE.Vector3(9.0, yH, 6.6), size: 1.3, zone: box3(8.35, yH, 5.4, SW.x1, yH + 0.6, SW.z1) });
    this.put(rubblePile(0.55), 9.0, yH, 6.6, 0.4);
    this.mine(8.85, yH, 3.6);
    this.put(warningSign(['DANGER', 'STAIRS', 'COLLAPSED']), 0.02, floorY(7) + 1.5, 6.4, WEST);
  }

  /** A mine: an olive disc on the rubble, its red light blinking. */
  private mine(x: number, y: number, z: number): void {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.07, 16), new THREE.MeshLambertMaterial({ color: 0x3f4430 }));
    body.position.y = 0.035;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 12), new THREE.MeshLambertMaterial({ color: 0x2a2d22 }));
    cap.position.y = 0.085;
    const led = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a10, emissiveIntensity: 2.5 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), led);
    bulb.position.set(0.09, 0.08, 0);
    // A glow round the light, so it reads from a storey up
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2010, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    );
    halo.position.copy(bulb.position);
    g.add(body, cap, bulb, halo);
    g.position.set(x, y, z);
    this.group.add(g);
    this.mines.push({ pos: new THREE.Vector3(x, y, z), led, obj: g });
  }

  // -------------------------------------------------------------- collapse

  /**
   * Storeys 6 and 5: the stairs have gone but for what is still on the
   * walls. Down it: off the end of flight B onto the corner of landing
   * left on the south wall; across to the top of flight A on the north
   * wall; along it and over its gap onto its bottom steps and what is left
   * of the half landing; across the well onto a run of flight B on the
   * south wall; off its end onto the floor below. Mines on three of them.
   */
  private buildCollapse(): void {
    this.mine(0.75, floorY(6), 7.3);
    this.mine(8.55, halfY(6), 3.3);
    this.mine(0.7, floorY(5), 7.1);
    // What fell, down in the well and on the landings below it
    this.put(rubble(1.1, 81), 4.6, floorY(5) + 0.05, 1.0, 0.5);
    this.put(rubblePile(0.6), 1.6, floorY(5), 3.4, 1.1);
    this.put(rubble(0.9, 83), 6.0, stepB(5, 4) + 0.02, 7.0, 2.2);
    this.put(warningSign(['DANGER', 'STRUCTURAL', 'COLLAPSE']), 0.02, floorY(6) + 1.5, 6.6, WEST);
    // Cut cables down the shaft, live
    const c = new THREE.Vector3(9.8, floorY(6) + 1.2, 0.4);
    this.add(cable([c, c.clone().add(new THREE.Vector3(-0.1, -1.2, 0.2)), c.clone().add(new THREE.Vector3(-0.3, -2.4, 0.5))], 0.018));
    this.sparks.push(c.clone().add(new THREE.Vector3(-0.3, -2.42, 0.5)));
  }

  // ------------------------------------------------------------ live wires

  /**
   * Storey 5: cables come down from the wreck above and hang across flight
   * A, live, swinging from wall to rail; the half landing flooded from a
   * burst main, with a live wire lying in the water — a dry strip along the
   * east wall the only way across.
   */
  private buildLiveWires(): void {
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x88ccff, emissiveIntensity: 1.5 });
    const cableMat = new THREE.MeshLambertMaterial({ color: 0x151515 });
    for (const [x, pivotY, i, period, phase] of [
      [3.6, floorY(6) - 1.2, 3, 2.2, 0],
      [6.2, halfY(6) + 0.1, 9, 2.7, 1.9]
    ] as const) {
      const end = stepA(5, i) + 0.28;
      const pivot = new THREE.Vector3(x, pivotY, ZA / 2);
      const length = pivotY - end;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6), cableMat);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), tipMat);
      this.group.add(mesh, tip);
      this.cables.push({ pivot, length, axis: new THREE.Vector3(0, 0, 1), amp: Math.asin(Math.min(0.95, 1.0 / length)), period, phase, mesh, tip });
    }
    // The flooded half landing
    const y = halfY(5);
    const x0 = XB - 0.05;
    const x1 = 9.15;
    const z0 = 1.9;
    const z1 = 6.1;
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, z1 - z0),
      new THREE.MeshPhongMaterial({ color: 0x0f1820, specular: 0x9fb8d0, shininess: 140, transparent: true, opacity: 0.82 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set((x0 + x1) / 2, y + 0.012, (z0 + z1) / 2);
    this.group.add(water);
    this.shockZones.push(box3(x0, y - 0.1, z0, x1, y + 0.45, z1));
    // The live wire in it, its end fizzing
    const w0 = new THREE.Vector3(XB + 0.2, y + 2.2, 0.3);
    const wEnd = new THREE.Vector3(8.2, y + 0.02, 3.9);
    this.add(cable([w0, new THREE.Vector3(XB + 0.4, y + 0.8, 1.6), new THREE.Vector3(7.9, y + 0.05, 3.0), wEnd], 0.02));
    this.sparks.push(wEnd.clone().setY(y + 0.08));
    this.sparks.push(new THREE.Vector3(8.6, y + 0.05, 5.2));
    this.put(warningSign(['DANGER', 'LIVE', 'WIRES']), XB + 0.02, y + 1.4, 7.4, WEST);
  }

  // ------------------------------------------------------------------ crawl

  /**
   * Storey 4: the slab above has come down onto the half landing and lies
   * on what fell with it — 1.25 m clear under it, wall to wall across the
   * landing. Down on hands and knees under it, or nothing.
   */
  private buildCrawl(): void {
    const y = halfY(4);
    const z0 = 2.0;
    const z1 = 6.0;
    const clear = 1.25;
    // The slab: collider honest to its underside, a little tilted look
    this.blk(XB - 0.3, y + clear, z0, SW.x1, y + clear + 0.45, z1);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(SW.x1 - XB + 0.4, 0.42, z1 - z0 + 0.3), this.concreteDark);
    slab.position.set((XB + SW.x1) / 2, y + clear + 0.22, (z0 + z1) / 2);
    slab.rotation.set(0.03, 0, -0.025);
    this.add(slab);
    const occ = new THREE.Mesh(new THREE.BoxGeometry(SW.x1 - XB, 0.45, z1 - z0), this.unseen);
    occ.position.set((XB + SW.x1) / 2, y + clear + 0.22, (z0 + z1) / 2);
    this.group.add(occ);
    this.occluders.push(occ);
    // Its broken edges, both ends, and the steel through it
    this.brokenEdge(new THREE.Vector3((XB + SW.x1) / 2, y + clear + 0.45, z0), new THREE.Vector3(0, 0, -1), SW.x1 - XB, y + clear + 0.45, 91, false);
    this.brokenEdge(new THREE.Vector3((XB + SW.x1) / 2, y + clear + 0.45, z1), new THREE.Vector3(0, 0, 1), SW.x1 - XB, y + clear + 0.45, 92, false);
    // What it lies on: rubble along the wall and against the rail, low
    for (let z = z0 + 0.3; z < z1; z += 0.9) {
      this.put(rubble(0.55, Math.round(z * 10)), 9.85, y, z, z);
    }
    // A rubble wall along the well side, so there is no going round it
    this.blk(XB - 0.3, y, z0, XB + 0.05, y + clear, z1);
    for (let z = z0 + 0.2; z < z1; z += 0.7) this.put(rubble(0.6, 40 + Math.round(z * 10)), XB - 0.05, y, z, z * 2);
    // Ceiling hanging down over the north end where it broke away
    this.put(warningSign(['DANGER', 'LOW', 'CLEARANCE']), SW.x1 - 0.02, y + 1.6, 1.2, EAST);
    this.fires.push({ pos: new THREE.Vector3(9.4, y, 7.2), size: 0.75, zone: box3(9.0, y, 6.7, SW.x1, y + 0.6, SW.z1) });
    this.put(rubblePile(0.4), 9.4, y, 7.2, 0.3);
  }

  // ------------------------------------------------------------------ shaft

  /**
   * Storey 3 has no stairs. The way down is through the wall off the fourth
   * floor's landing into the lift shaft: onto the west car's roof, a jump
   * across to the east car's, a little lower, and out through the second
   * hole onto the half landing. Between the cars, and round them, nothing
   * all the way to the pit.
   */
  private buildShaft(): void {
    const S = SHAFT;
    const yTop = floorY(4) + 1.0;
    // The shaft's walls, floor and lid
    this.solid(-T, S.pit, S.z0 - 0.3, SW.x1 + T, yTop, S.z0, this.shaftWall);
    this.solid(-T, S.pit, S.z0, S.x0, yTop, S.z1, this.shaftWall);
    this.solid(S.x1, S.pit, S.z0, SW.x1 + T, yTop, S.z1, this.shaftWall);
    this.solid(-T, S.pit - 0.4, S.z0 - 0.3, SW.x1 + T, S.pit, 0, this.shaftWall);
    this.solid(-T, yTop, S.z0 - 0.3, SW.x1 + T, yTop + 0.3, 0, this.shaftWall);
    // The stairwell's north wall below and above the storeys built: the
    // shaft side of it, down to the pit
    this.solid(-T, S.pit, S.z1, SW.x1 + T, 0, 0, this.shaftWall);
    // Rails up the walls, and the divider's columns between the cars
    for (const x of [0.55, 4.6, 5.4, 9.45]) this.solid(x - 0.06, S.pit, S.z0 + 0.05, x + 0.06, yTop, S.z0 + 0.2, this.steel, { occlude: false });
    for (const z of [S.z0 + 0.3, S.z1 - 0.3]) this.solid(4.92, S.pit, z - 0.08, 5.08, yTop, z + 0.08, this.steel, { occlude: false });
    for (const y of [3, 7]) this.solid(4.92, y, S.z0 + 0.3, 5.08, y + 0.2, S.z1 - 0.3, this.steel, { occlude: false });
    // The cars
    this.car(0.6, 4.4, floorY(3) - 1.6, 101);
    this.car(6.4, 9.4, halfY(3) + 0.2, 102);
    this.mine(3.3, floorY(3) - 1.6, -1.8);
    // Where flight A was: torn off at the landing above and the half landing below
    this.brokenEdge(new THREE.Vector3(XA, floorY(3), ZA / 2), new THREE.Vector3(1, 0, 0), ZA, floorY(3), 121);
    this.brokenEdge(new THREE.Vector3(XB, halfY(3), ZA / 2), new THREE.Vector3(-1, 0, 0), ZA, halfY(3), 122);
    // The cables, up into the dark
    for (const [x, y] of [[2.5, floorY(3) - 1.3], [7.9, halfY(3) + 0.5]] as const) {
      for (const dz of [-0.15, 0.15]) this.bar(new THREE.Vector3(x, y, -1.8 + dz), new THREE.Vector3(x, yTop, -1.8 + dz), 0.018, this.steel);
    }
    // Snapped ones hanging, and the pit's wreckage
    this.add(cable([new THREE.Vector3(5.6, yTop, -2.6), new THREE.Vector3(5.7, yTop - 4, -2.4), new THREE.Vector3(5.4, yTop - 7.5, -2.0)], 0.02));
    this.put(rubble(1.2, 111), 3.0, S.pit, -1.6, 0.4);
    this.put(rubble(1.0, 113), 7.6, S.pit, -2.2, 1.7);
    this.fires.push({ pos: new THREE.Vector3(5.0, S.pit, -1.8), size: 1.4, zone: null });
    // Signs on the stairwell side of the hole
    this.put(warningSign(['LIFT', 'SHAFT', 'NO ENTRY']), 2.25, floorY(3) + 1.5, 0.02, SOUTH);
  }

  /** A lift car stuck in the shaft, its roof at `roof`: walked on, a hatch and the crosshead on top. */
  private car(x0: number, x1: number, roof: number, seed: number): void {
    const S = SHAFT;
    const z0 = S.z0 + 0.2;
    const z1 = S.z1 - 0.2;
    const h = 2.5;
    this.solid(x0, roof - h, z0, x1, roof, z1, this.carMat, { surface: 'metal' });
    this.blk(x0, roof - THICK, z0, x1, roof - 0.01, z1);
    // The crosshead over the middle: low enough to step over
    const cx = (x0 + x1) / 2 + 0.3;
    this.solid(cx - 0.12, roof, z0 + 0.2, cx + 0.12, roof + 0.3, z1 - 0.2, this.steel, { surface: 'metal', occlude: false });
    // Hatch, buckled
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.6), this.steel);
    hatch.position.set(x0 + 0.7, roof + 0.02, (z0 + z1) / 2);
    hatch.rotation.set(0.1, 0.3, 0.05);
    this.add(hatch);
    const r = this.rnd(seed);
    for (let i = 0; i < 3; i++) this.put(rubble(0.35, seed + i), x0 + 0.5 + r() * (x1 - x0 - 1), roof, z0 + 0.3 + r() * (z1 - z0 - 0.6), r() * 6);
  }

  // ----------------------------------------------------------------- fires

  private buildFires(): void {
    // Storey 2's half landing, in the corner
    this.fires.push({ pos: new THREE.Vector3(9.3, halfY(2), 0.8), size: 0.9, zone: box3(8.6, halfY(2), 0, SW.x1, halfY(2) + 0.6, 1.6) });
    this.put(rubblePile(0.45), 9.3, halfY(2), 0.8, 1.1);
    // The ground floor, under the stairs
    this.fires.push({ pos: new THREE.Vector3(7.0, 0, 6.8), size: 1.0, zone: box3(6.0, 0, 5.8, 8.2, 0.6, SW.z1) });
    this.put(rubblePile(0.5), 7.0, 0, 6.8, 0.3);
    for (const [x, y, z, w, h, ry] of [
      [SW.x1 - 0.01, halfY(7) + 1.3, 6.6, 2.6, 2.8, -Math.PI / 2],
      [SW.x1 - 0.01, halfY(2) + 1.1, 0.8, 1.8, 2.2, -Math.PI / 2],
      [SW.x1 - 0.01, halfY(4) + 1.0, 7.2, 1.6, 2.0, -Math.PI / 2],
      [7.0, 1.1, SW.z1 - 0.01, 2.0, 2.2, Math.PI]
    ] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), scorchMat());
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.group.add(m);
    }
  }

  // ----------------------------------------------------------------- pipes

  /**
   * The risers in two corners, top to bottom, rusted and leaking at their
   * joints onto the landings; and the main along the east wall over the
   * sixth floor's half landing, burst, pouring onto it.
   */
  private buildPipes(): void {
    const top = floorY(SW.storeys) + H;
    this.bar(new THREE.Vector3(0.16, 0, 0.16), new THREE.Vector3(0.16, top, 0.16), 0.07, this.pipeMat);
    this.bar(new THREE.Vector3(SW.x1 - 0.16, 0, SW.z1 - 0.16), new THREE.Vector3(SW.x1 - 0.16, top, SW.z1 - 0.16), 0.07, this.pipeMat);
    const joint = (x: number, y: number, z: number): void => {
      const j = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.12, 8), this.rust);
      j.position.set(x, y, z);
      this.add(j);
    };
    for (let f: number = 0; f <= SW.storeys; f++) {
      joint(0.16, floorY(f) + 3.4, 0.16);
      joint(SW.x1 - 0.16, floorY(f) + 1.2, SW.z1 - 0.16);
    }
    for (const f of [8, 7, 5, 2]) this.drips.push({ from: new THREE.Vector3(0.3, floorY(f) + 3.35, 0.3), toY: floorY(f), rate: 2.5 });
    for (const f of [7, 4, 2, 1]) this.drips.push({ from: new THREE.Vector3(SW.x1 - 0.3, halfY(f) + 3.4, SW.z1 - 0.3), toY: halfY(f), rate: 2.5 });
    // The burst main over the flooded half landing
    const y = halfY(5) + 2.7;
    this.bar(new THREE.Vector3(SW.x1 - 0.16, y, SW.z1 - 0.16), new THREE.Vector3(SW.x1 - 0.16, y, 1.2), 0.08, this.pipeMat);
    joint(SW.x1 - 0.16, y, 3.6);
    const split = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.3, 8, 1, true), this.rust);
    split.rotation.x = Math.PI / 2;
    split.position.set(SW.x1 - 0.16, y, 3.9);
    this.add(split);
    for (const z of [3.7, 3.85, 4.0]) this.drips.push({ from: new THREE.Vector3(SW.x1 - 0.3, y - 0.08, z), toY: halfY(5), rate: 14 });
  }

  // -------------------------------------------------------------- dressing

  private buildDressing(): void {
    for (let f: number = 0; f <= SW.storeys; f++) {
      if (f === 6) continue;
      const y = floorY(f);
      this.put(scatteredPaper(4, 0.7), 1.0, y, 1.4 + (f % 3) * 2.0, f * 0.7);
      if (f % 2 === 0) this.put(rubble(0.5, 70 + f), 1.6, y, 6.8, f);
    }
    for (const f of [8, 4, 0]) this.put(fireAlarm(), 0.02, floorY(f) + 1.35, 6.6, WEST);
    const lamp = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xfff3dc, emissiveIntensity: 1.3 });
    for (let f: number = 0; f <= SW.storeys; f++) {
      if (f === 6) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.34), lamp);
      m.position.set(0.04, floorY(f) + 2.75, 5.8);
      this.add(m);
    }
  }

  private buildLighting(): void {
    this.group.add(new THREE.AmbientLight(0x6a6560, 0.42));
    this.group.add(new THREE.HemisphereLight(0x9aa4ae, 0x2a2018, 0.36));
    for (const y of [floorY(8) + 2.6, floorY(5) + 2.6, floorY(2) + 2.6, 2.6]) {
      const l = new THREE.PointLight(0xfff0dc, 6, 15, 1.4);
      l.position.set(1.2, y, 4.0);
      this.group.add(l);
    }
    // The fires', flickered by the scene
    for (const p of [
      new THREE.Vector3(8.8, halfY(7) + 0.9, 6.4),
      new THREE.Vector3(8.6, halfY(5) + 1.4, 4.0), // the sparking water: blue-white, flickered too
      new THREE.Vector3(9.0, halfY(4) + 0.9, 7.0),
      new THREE.Vector3(5.0, SHAFT.pit + 1.5, -1.8),
      new THREE.Vector3(8.6, halfY(2) + 0.9, 1.0),
      new THREE.Vector3(6.8, 0.9, 6.6)
    ]) {
      const l = new THREE.PointLight(0xff7a2a, 7, 12, 1.5);
      l.position.copy(p);
      this.group.add(l);
      this.fireLights.push(l);
    }
    this.fireLights[1].color.setHex(0x9fc8ff);
    // A work lamp still burning in the lift shaft, over the cars
    const lamp = new THREE.PointLight(0xffc890, 5, 11, 1.3);
    lamp.position.set(5.0, floorY(3) + 1.4, -1.8);
    this.group.add(lamp);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
    bulb.position.copy(lamp.position);
    this.group.add(bulb);
    this.bar(lamp.position.clone(), lamp.position.clone().setY(floorY(4) + 1.0), 0.008, this.steel);
  }

  // ------------------------------------------------------------- the cast

  private agents(): StairAgent[] {
    const landing = (f: number): THREE.Box3 => box3(0.35, floorY(f) - 0.1, 0.45, XA - 0.3, floorY(f) + 2, SW.z1 - 0.45);
    const half = (f: number): THREE.Box3 => box3(XB + 0.3, halfY(f) - 0.1, 0.5, SW.x1 - 0.4, halfY(f) + 2, SW.z1 - 0.5);
    const a = (pos: THREE.Vector3, yaw: number, armour: boolean, aim: boolean, upTo: number, group: number, area: THREE.Box3): StairAgent => ({
      pos, yaw, armour, aim, area, upTo, group
    });
    const at = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    return [
      // The eighth floor's landing
      a(at(1.1, floorY(7), 1.4), EAST, false, true, 0, 0, landing(7)),
      a(at(1.4, floorY(7), 6.6), EAST, false, false, 0, 0, landing(7)),
      // The fifth floor's, under the live wires
      a(at(1.0, floorY(4), 1.3), EAST, false, true, 2, 1, landing(4)),
      a(at(1.1, floorY(4), 6.2), EAST, true, false, 2, 1, landing(4)),
      // The fourth floor's, by the hole into the shaft
      a(at(1.2, floorY(3), 3.6), EAST, false, true, 2, 2, landing(3)),
      a(at(1.6, floorY(3), 6.6), EAST, false, false, 2, 2, landing(3)),
      // The third floor's
      a(at(1.2, floorY(2), 1.5), EAST, false, true, 4, 3, landing(2)),
      a(at(1.5, floorY(2), 6.4), EAST, true, false, 4, 3, landing(2)),
      // The ground floor by the door out, and one on the last half landing
      a(at(1.3, 0, 1.2), EAST, false, true, 4, 4, box3(0.35, -0.1, 0.45, 2.1, 2, 7.55)),
      a(at(1.0, 0, 6.6), EAST, true, false, 4, 4, box3(0.35, -0.1, 0.45, 2.1, 2, 7.55)),
      a(at(8.6, halfY(1), 4.0), WEST, false, true, 4, 4, half(1))
    ];
  }

  // ------------------------------------------------------------ waypoints

  private makeWaypoints(): Waypoint[] {
    const wps: Waypoint[] = [];
    const island = (x0: number, x1: number, z0: number, z1: number, y: number): void => {
      const start = wps.length;
      for (let x = x0; x <= x1 + 1e-6; x += 0.7) {
        for (let z = z0; z <= z1 + 1e-6; z += 0.8) wps.push({ pos: new THREE.Vector3(x, y, z), links: [] });
      }
      for (let i = start; i < wps.length; i++) {
        for (let j = i + 1; j < wps.length; j++) {
          if (wps[i].pos.distanceTo(wps[j].pos) < 1.2) {
            wps[i].links.push(j);
            wps[j].links.push(i);
          }
        }
      }
    };
    for (const f of [7, 4, 3, 2]) island(0.5, 1.9, 0.6, 7.4, floorY(f));
    island(0.5, 1.9, 0.6, 7.4, 0);
    island(XB + 0.4, SW.x1 - 0.5, 0.6, 7.4, halfY(1));
    return wps;
  }

  // ----------------------------------------------------------------- merge

  private mergeShell(): void {
    this.group.updateMatrixWorld(true);
    const buckets = new Map<THREE.Material, THREE.Mesh[]>();
    for (const m of this.shell) {
      const mat = m.material as THREE.Material;
      const list = buckets.get(mat);
      if (list) list.push(m);
      else buckets.set(mat, [m]);
    }
    const gone = new Set<THREE.Object3D>(this.shell);
    const occluding = new Set<THREE.Object3D>(this.occluders);
    this.shootables = this.shootables.filter((o) => !gone.has(o));
    this.occluders = this.occluders.filter((o) => !gone.has(o));
    for (const [mat, list] of buckets) {
      const geos = list.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld));
      const one = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!one) {
        for (const m of list) {
          this.shootables.push(m);
          if (occluding.has(m)) this.occluders.push(m);
        }
        continue;
      }
      const mesh = new THREE.Mesh(one, mat);
      mesh.userData.surface = list[0].userData.surface;
      this.group.add(mesh);
      this.shootables.push(mesh);
      if (list.some((m) => occluding.has(m))) this.occluders.push(mesh);
      for (const m of list) {
        m.removeFromParent();
        m.geometry.dispose();
      }
    }
    this.shell = [];
  }
}

// ---------------------------------------------------------------- helpers

const UP = new THREE.Vector3(0, 1, 0);

function box3(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function storeyWallCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  const dado = Math.round(128 * (1 - 1.15 / H));
  g.fillStyle = '#b9b6ad';
  g.fillRect(0, 0, 128, dado);
  g.fillStyle = '#5b6a5e';
  g.fillRect(0, dado, 128, 128 - dado);
  g.fillStyle = '#3a3f3a';
  g.fillRect(0, dado - 3, 128, 3);
  for (let i = 0; i < 1400; i++) {
    const v = Math.random() * 40 - 20;
    const c8 = v < 0 ? 0 : 255;
    g.fillStyle = 'rgba(' + c8 + ',' + c8 + ',' + c8 + ',' + Math.abs(v) / 400 + ')';
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * 128;
    const grad = g.createLinearGradient(0, 0, 0, 70);
    grad.addColorStop(0, 'rgba(40,36,30,0.25)');
    grad.addColorStop(1, 'rgba(40,36,30,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 4 + Math.random() * 8, 70);
  }
  g.strokeStyle = 'rgba(30,28,24,0.5)';
  g.lineWidth = 1;
  g.beginPath();
  let x = 20;
  let y = 30;
  g.moveTo(x, y);
  for (let i = 0; i < 8; i++) {
    x += Math.random() * 10 - 2;
    y += 6 + Math.random() * 6;
    g.lineTo(x, y);
  }
  g.stroke();
  return c;
}

const floorSigns = new Map<string, THREE.MeshLambertMaterial>();

function floorSignMat(label: string): THREE.MeshLambertMaterial {
  let m = floorSigns.get(label);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e6e2d6';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#16181a';
  g.font = 'bold 96px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 64, 70);
  g.font = 'bold 12px Arial, sans-serif';
  g.fillText('STAIRWELL B', 64, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshLambertMaterial({ map: t });
  floorSigns.set(label, m);
  return m;
}

function labelMat(text: string, fg: string, bg: string): THREE.MeshLambertMaterial {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 84;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 84);
  g.fillStyle = fg;
  g.font = 'bold 36px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({ map: t });
}

let scorch: THREE.MeshBasicMaterial | null = null;

function scorchMat(): THREE.MeshBasicMaterial {
  if (scorch) return scorch;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 120, 4, 32, 100, 90);
  grad.addColorStop(0, 'rgba(10,8,6,0.95)');
  grad.addColorStop(0.5, 'rgba(14,12,10,0.6)');
  grad.addColorStop(1, 'rgba(14,12,10,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  scorch = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return scorch;
}
