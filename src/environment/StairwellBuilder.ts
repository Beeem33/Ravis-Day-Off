import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type Collider, type Waypoint, noiseCanvas, makeTex } from './OfficeLevelBuilder';
import { mergeStatic } from './mergeStatic';
import { rubble, debrisPlatform, cable, warningSign } from './MechanicalProps';
import { rubblePile, scatteredPaper, fireAlarm } from './OfficeProps';

// ---------------------------------------------------------------- the shaft
//
// Stairwell B, from the top floor down to the ground: a concrete box 8.4 m
// by 6 m, nine floors of it. x runs east, z south, y up, and the ground
// floor is y = 0 (the player's fall reset and the particle floors want the
// bottom at zero, so the top floor is 26.4 m up).
//
// Floors are counted from 0, the ground floor, to 8, the ninth and top
// floor; the signs on the walls say 'G' and 2..9. Storey f is the stretch
// from floor f down to floor f-1, and every storey is the same dog-leg: the
// FLOOR LANDING on the west end at the floor's level, flight A running east
// down the north side to the HALF LANDING on the east end, half a storey
// down, and flight B running back west down the south side to the floor
// landing below. Between the two flights the well, open top to bottom.
//
// It is not intact. Coming down it, in order:
//   storey 8   as it was (the agents wait on the eighth floor's landing)
//   storey 7   its half landing broken across the middle, burning below:
//              jump the gap
//   storeys 6, 5   gone: what is left on the walls and what came to rest in
//              the shaft, a zig-zag of jumps down to the fifth floor
//   storey 4   flight A buried under burning rubble; a steel beam across
//              the well instead
//   storey 3   a ceiling slab down over flight A — crawl under it — and a
//              fire across the half landing
//   storey 2   flight B fallen out, onto a heap in the well: down onto it,
//              and up from it onto the second floor's landing
//   storey 1   as it was, and the ground floor's door out to the car park

export const SW = {
  /** Storeys between the top floor and the ground. */
  storeys: 8,
  /** Floor to floor. */
  H: 3.3,
  x1: 8.4,
  z1: 6,
  /** Floor landings x 0..land, half landings x x1-land..x1. */
  land: 2.2,
  /** Flight A z 0..2, the well z 2..4, flight B z 4..6. */
  flight: 2,
  steps: 10
} as const;

const T = 0.3;
const H = SW.H;
const RISE = H / 2 / SW.steps;
/** The flights' west and east ends. */
const XA = SW.land;
const XB = SW.x1 - SW.land;
const RUN = (XB - XA) / SW.steps;
/** Colliders go well down under every walking surface, so a long fall can't step through one. */
const THICK = 0.6;
const RAIL_H = 1.0;
/** The floor whose landing is gone (the sixth), and the one whose door is open (the fifth). */
const LOST = 5;
const OPEN = 4;

/** The floor's level: 0 the ground floor, 8 the top. */
export const floorY = (f: number): number => f * H;
/** The half landing's level, storey f. */
export const halfY = (f: number): number => f * H - H / 2;
/** Top of step i of flight A, storey f. */
const stepA = (f: number, i: number): number => floorY(f) - (i + 1) * RISE;
/** Top of step j of flight B, storey f. */
const stepB = (f: number, j: number): number => halfY(f) - (j + 1) * RISE;

export interface StairAgent {
  pos: THREE.Vector3;
  yaw: number;
  armour: boolean;
  /** Stood with his rifle up the stairs, rather than at rest. */
  aim: boolean;
  /** Where he is kept: the landing he holds. */
  area: THREE.Box3;
  /** The last checkpoint he is still there for: a restart from a later one finds him gone. */
  upTo: number;
  /** His group: they wake together. */
  group: number;
}

export interface StairFire {
  pos: THREE.Vector3;
  /** How big a fire: 1 a heap of burning rubble. */
  size: number;
  /** Where it burns him, if it is where he can go. */
  zone: THREE.Box3 | null;
}

export interface StairwellData {
  group: THREE.Group;
  colliders: Collider[];
  shootables: THREE.Object3D[];
  occluders: THREE.Object3D[];
  glassPanes: [];
  /** One small island of points per landing the agents hold. */
  waypoints: Waypoint[];
  /**
   * Where each checkpoint puts him, facing which way, and the box that
   * reaches it. 0 is the top landing, where he comes in from the top floor.
   */
  checkpoints: { pos: THREE.Vector3; yaw: number; reach: THREE.Box3 }[];
  agents: StairAgent[];
  fires: StairFire[];
  /** The fires' lights, flickered by the scene (intensity only: the count is fixed). */
  fireLights: THREE.PointLight[];
  /** Cut cables that spark. */
  sparks: THREE.Vector3[];
  /** The ground floor's door: through it is the car park. */
  exitTrigger: THREE.Box3;
}

/** Eastward and westward, as a yaw (forward is (−sin yaw, 0, −cos yaw)). */
const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;

/**
 * StairwellBuilder — Stairwell B, from the top floor where Level 7 left Ravi
 * at its door, all the way down to the car park.
 */
export class StairwellBuilder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private dressing: THREE.Object3D[] = [];
  /** Plain boxes — walls, slabs, steps — merged by material at the end. */
  private shell: THREE.Mesh[] = [];
  private fires: StairFire[] = [];
  private fireLights: THREE.PointLight[] = [];
  private sparks: THREE.Vector3[] = [];

  private wallNS!: THREE.MeshLambertMaterial;
  private wallEW!: THREE.MeshLambertMaterial;
  private concrete!: THREE.MeshLambertMaterial;
  private concreteDark!: THREE.MeshLambertMaterial;
  private nosing!: THREE.MeshLambertMaterial;
  private steel!: THREE.MeshLambertMaterial;
  private char!: THREE.MeshLambertMaterial;
  private door!: THREE.MeshLambertMaterial;

  build(): StairwellData {
    this.makeMaterials();
    this.buildShell();
    this.buildStoreys();
    this.buildDoors();
    this.buildCollapse();
    this.buildBeam();
    this.buildCrawl();
    this.buildHeap();
    this.buildFires();
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
        // In through the top floor's door, facing down the first flight
        { pos: new THREE.Vector3(0.9, floorY(8), 1.0), yaw: EAST, reach: new THREE.Box3() },
        // The seventh floor's landing, at the top of the collapse
        { pos: new THREE.Vector3(1.0, floorY(6), 1.0), yaw: EAST, reach: box3(0, floorY(6), 0, XA, floorY(6) + 2, SW.z1) },
        // What is left of the half landing at the bottom of it
        { pos: new THREE.Vector3(7.6, halfY(5), 1.6), yaw: Math.PI, reach: box3(6.5, halfY(5), 0, SW.x1, halfY(5) + 2, SW.z1) },
        // On the heap two floors from the bottom
        { pos: new THREE.Vector3(4.4, 2.45, 3.0), yaw: WEST, reach: box3(2.6, 2.4, 2.15, 5.8, 4.4, 3.85) }
      ],
      agents: this.agents(),
      fires: this.fires,
      fireLights: this.fireLights,
      sparks: this.sparks,
      exitTrigger: box3(-0.2, 0, 2.4, 0.75, 2.2, 3.6)
    };
  }

  // ------------------------------------------------------------- materials

  private makeMaterials(): void {
    const storey = storeyWallCanvas();
    // A storey of the painted wall to every 3.3 m, across and up
    const tex = (w: number): THREE.Texture => {
      const t = makeTex(storey, w / H, 1);
      t.magFilter = THREE.LinearFilter;
      return t;
    };
    this.wallNS = new THREE.MeshLambertMaterial({ map: tex(SW.x1 + 2 * T) });
    this.wallEW = new THREE.MeshLambertMaterial({ map: tex(SW.z1 + 2 * T) });
    this.concrete = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([128, 126, 120], 12), 2, 2) });
    this.concreteDark = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([86, 84, 80], 12), 2, 2) });
    this.nosing = new THREE.MeshLambertMaterial({ color: 0xc9a22a });
    this.steel = new THREE.MeshLambertMaterial({ color: 0x5c6167 });
    this.char = new THREE.MeshLambertMaterial({ color: 0x1d1916 });
    this.door = new THREE.MeshLambertMaterial({ color: 0x6b2a24 });
  }

  // --------------------------------------------------------------- helpers

  /** A plain solid box, min corner to max corner: drawn, walked on, shot, and (unless told) blocking sight. */
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

  /** A movement-only box. */
  private blk(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.colliders.push({ box: box3(x0, y0, z0, x1, y1, z1) });
  }

  /** A prop, folded into the merged dressing; its meshes still stop bullets. */
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

  /**
   * A slab of broken stair or floor to stand on, its top at `top`: a ragged
   * block with a flat face, its collider honest to the face and deep enough
   * below it that nothing falls through.
   */
  /** A length of rebar from a to b — scenery, showing what a piece hangs by. */
  private rebar(a: THREE.Vector3, b: THREE.Vector3): void {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, a.distanceTo(b), 5), this.steel);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.put(new THREE.Group().add(bar), (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  }

  private platform(x0: number, z0: number, x1: number, z1: number, top: number, seed: number, depth = 0.9): void {
    const w = x1 - x0;
    const d = z1 - z0;
    this.put(debrisPlatform(w, d, depth, seed), (x0 + x1) / 2, top, (z0 + z1) / 2);
    // Exactly as deep as it looks: one hanging over a way through below must
    // leave a man's height under it (a tall body can't fall through a thin one)
    this.colliders.push({ box: box3(x0, top - depth, z0, x1, top, z1) });
    // Its bulk hides what is behind it from an agent's eye
    const occ = new THREE.Mesh(new THREE.BoxGeometry(w, depth, d), this.concreteDark);
    occ.position.set((x0 + x1) / 2, top - depth / 2, (z0 + z1) / 2);
    occ.visible = false;
    this.group.add(occ);
    this.occluders.push(occ);
  }

  // ----------------------------------------------------------------- shell

  /** The four walls, the ground floor and the roof over the top floor. */
  private buildShell(): void {
    const top = floorY(SW.storeys) + H;
    const X = SW.x1;
    const Z = SW.z1;
    // Walls a storey at a time, so the painted dado lines up with the floors
    for (let f: number = 0; f <= SW.storeys; f++) {
      const y0 = floorY(f);
      const y1 = y0 + H;
      this.solid(-T, y0, -T, X + T, y1, 0, this.wallNS);
      this.solid(-T, y0, Z, X + T, y1, Z + T, this.wallNS);
      this.solid(X, y0, 0, X + T, y1, Z, this.wallEW);
      if (f === OPEN) {
        // The fifth floor's door is open, and what is behind it is burning
        this.solid(-T, y0, 0, 0, y1, 2.5, this.wallEW);
        this.solid(-T, y0, 3.5, 0, y1, Z, this.wallEW);
        this.solid(-T, y0 + 2.1, 2.5, 0, y1, 3.5, this.wallEW);
      } else {
        this.solid(-T, y0, 0, 0, y1, Z, this.wallEW);
      }
    }
    this.solid(-T, -0.4, -T, X + T, 0, Z + T, this.concrete);
    this.solid(-T, top, -T, X + T, top + 0.3, Z + T, this.concrete);
  }

  // --------------------------------------------------------------- storeys

  /**
   * Every storey's landings and flights, as they were — less whatever has
   * come down. What is missing from each is listed here; the set pieces
   * that replace it are built after.
   */
  private buildStoreys(): void {
    for (let f: number = SW.storeys; f >= 0; f--) {
      if (f !== LOST) this.floorLanding(f);
      if (f === 0) break;
      const a = this.missingA(f);
      const b = this.missingB(f);
      for (let i = 0; i < SW.steps; i++) if (!a.has(i)) this.step(f, 'A', i);
      for (let j = 0; j < SW.steps; j++) if (!b.has(j)) this.step(f, 'B', j);
      // The collapse took both of its storeys' half landings; the third
      // floor's lost its south side with flight B
      if (f !== 6 && f !== 5) this.halfLanding(f, f === 2 ? 'north' : f === 7 ? 'split' : 'whole');
      this.railings(f, a, b);
    }
  }

  /** Flight A's missing steps, storey f. */
  private missingA(f: number): Set<number> {
    if (f === 6 || f === 5) return new Set(range(SW.steps)); // the collapse
    return new Set();
  }

  /** Flight B's missing steps, storey f. */
  private missingB(f: number): Set<number> {
    if (f === 6) return new Set(range(SW.steps));
    if (f === 5) return new Set([3, 4, 5]); // what is left of it, but for a gap
    if (f === 2) return new Set(range(SW.steps)); // fell out onto the heap
    return new Set();
  }

  private floorLanding(f: number): void {
    if (f === 0) return; // the ground floor is the shell's slab
    const y = floorY(f);
    this.solid(0, y - 0.3, 0, XA, y, SW.z1, this.concrete);
    this.blk(0, y - THICK, 0, XA, y - 0.3, SW.z1);
    // A yellow line along its edge at the well
    this.solid(XA - 0.06, y, 2, XA - 0.01, y + 0.005, 4, this.nosing, { collide: false, occlude: false });
  }

  private halfLanding(f: number, part: 'whole' | 'north' | 'split'): void {
    const y = halfY(f);
    if (part === 'split') {
      // Broken right across between the two flights: a gap to jump, and the
      // collapse under it
      this.solid(XB, y - 0.3, 0, SW.x1, y, 2.0, this.concrete);
      this.blk(XB, y - THICK, 0, SW.x1, y - 0.3, 2.0);
      this.solid(XB, y - 0.3, 3.3, SW.x1, y, SW.z1, this.concrete);
      this.blk(XB, y - THICK, 3.3, SW.x1, y - 0.3, SW.z1);
      this.put(rubble(0.7, 9), 7.3, y - 0.25, 2.05, 0.4);
      this.put(rubble(0.7, 11), 7.0, y - 0.25, 3.35, 2.4);
      return;
    }
    const z1 = part === 'whole' ? SW.z1 : 2.6;
    this.solid(XB, y - 0.3, 0, SW.x1, y, z1, this.concrete);
    this.blk(XB, y - THICK, 0, SW.x1, y - 0.3, z1);
    // The broken edge: chunks hanging off it
    if (part === 'north') this.put(rubble(0.8, 7), 7.3, y - 0.25, z1 + 0.1, 0.4);
  }

  /** One step: a solid block from its tread down, with a yellow nosing on its front edge. */
  private step(f: number, flight: 'A' | 'B', i: number): void {
    const top = flight === 'A' ? stepA(f, i) : stepB(f, i);
    const x0 = flight === 'A' ? XA + i * RUN : XB - (i + 1) * RUN;
    const x1 = x0 + RUN;
    const z0 = flight === 'A' ? 0 : 4;
    const z1 = z0 + SW.flight;
    this.solid(x0, top - RISE - 0.22, z0, x1, top, z1, this.concrete);
    this.blk(x0, top - THICK, z0, x1, top - RISE - 0.22, z1);
    // The nosing, on the edge you step down off
    const nx = flight === 'A' ? x1 - 0.05 : x0;
    this.solid(nx, top, z0 + 0.06, nx + 0.05, top + 0.006, z1 - 0.06, this.nosing, { collide: false, occlude: false });
  }

  /**
   * The balustrades: a rail along each flight's well side, up its slope,
   * and across the ends of the landings. Where a flight is missing, so is
   * its rail; where the beam goes, and over the heap, the rail has been
   * knocked out.
   */
  private railings(f: number, missA: Set<number>, missB: Set<number>): void {
    // Knocked out: the start of storey 7's flight B, clear of the gap, and all
    // of the flight buried under the beam's mound
    const bent = (flight: 'A' | 'B', i: number): boolean =>
      (f === 7 && flight === 'B' && i < 2) || (f === OPEN && flight === 'A');
    for (const flight of ['A', 'B'] as const) {
      const miss = flight === 'A' ? missA : missB;
      const z = flight === 'A' ? 2 : 4;
      let run: number[] = [];
      const flush = (): void => {
        if (run.length >= 2) this.rail(f, flight, run[0], run[run.length - 1], z);
        run = [];
      };
      for (let i = 0; i < SW.steps; i++) {
        if (miss.has(i) || bent(flight, i)) {
          flush();
          continue;
        }
        run.push(i);
        const top = flight === 'A' ? stepA(f, i) : stepB(f, i);
        const x0 = flight === 'A' ? XA + i * RUN : XB - (i + 1) * RUN;
        this.blk(x0, top, z - 0.05, x0 + RUN, top + RAIL_H, z + 0.05);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, RAIL_H, 0.035), this.steel);
        post.position.set(x0 + RUN / 2, top + RAIL_H / 2, z);
        this.put(new THREE.Group().add(post), 0, 0, 0);
      }
      flush();
    }
    // Across the end of the floor landing above this storey, at the well:
    // none where it is gone, an opening where the beam leaves it, none on the
    // second floor's, which is where he climbs up off the heap
    const yF = floorY(f);
    if (f === OPEN) {
      this.endRail(XA, yF, 2, 2.65);
      this.endRail(XA, yF, 3.35, 4);
    } else if (f !== LOST && f !== 1) this.endRail(XA, yF, 2, 4);
    // And across the end of the half landing; the beam comes down onto storey 4's
    if (f === 4) {
      this.endRail(XB, halfY(f), 2, 2.65);
      this.endRail(XB, halfY(f), 3.35, 4);
    } else if (f !== 7 && f !== 6 && f !== 5 && f !== 2) this.endRail(XB, halfY(f), 2, 4);
  }

  /** A sloping handrail along steps i0 to i1 of a flight. */
  private rail(f: number, flight: 'A' | 'B', i0: number, i1: number, z: number): void {
    const xa = flight === 'A' ? XA + (i0 + 0.5) * RUN : XB - (i0 + 0.5) * RUN;
    const xb = flight === 'A' ? XA + (i1 + 0.5) * RUN : XB - (i1 + 0.5) * RUN;
    const ya = (flight === 'A' ? stepA(f, i0) : stepB(f, i0)) + RAIL_H;
    const yb = (flight === 'A' ? stepA(f, i1) : stepB(f, i1)) + RAIL_H;
    const len = Math.hypot(xb - xa, yb - ya);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 8), this.steel);
    m.position.set((xa + xb) / 2, (ya + yb) / 2, z);
    m.rotation.z = -Math.atan2(xb - xa, yb - ya);
    this.put(new THREE.Group().add(m), 0, 0, 0);
  }

  /** A level rail across a landing's end, z0 to z1. */
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

  /** A fire door and the floor's number on every landing; the top one he came in by, the ground floor's the way out. */
  private buildDoors(): void {
    const win = new THREE.MeshLambertMaterial({ color: 0x1a1f22 });
    for (let f: number = 0; f <= SW.storeys; f++) {
      if (f === LOST) continue;
      const y = floorY(f);
      if (f !== OPEN) {
        // Shut: a leaf on the wall, a wired window, a push bar
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
        this.put(g, 0, y, 3.0);
      }
      // The floor's number, big, stencilled on the wall beside the door
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), floorSignMat(f === 0 ? 'G' : String(f + 1)));
      sign.position.set(0.012, y + 1.55, 1.4);
      sign.rotation.y = Math.PI / 2;
      this.put(new THREE.Group().add(sign), 0, 0, 0);
    }
    // The way out: EXIT over the ground floor's door, and where it goes
    const exit = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.16, 0.44),
      new THREE.MeshStandardMaterial({ color: 0x0b2a12, emissive: 0x2bff6a, emissiveIntensity: 1.4 })
    );
    exit.position.set(0.04, 2.45, 3.0);
    this.group.add(exit);
    const car = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.26), labelMat('CAR PARK  ▶', '#e8e4d8', '#2c3138'));
    car.position.set(0.012, 2.2, 1.85);
    car.rotation.y = Math.PI / 2;
    this.put(new THREE.Group().add(car), 0, 0, 0);
    // The fifth floor's door, blown off its hinges: the floor behind it on fire
    const y5 = floorY(OPEN);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 2.0), this.door);
    leaf.rotation.set(0.05, 0.4, 0.12);
    this.put(new THREE.Group().add(leaf), 0.95, y5 + 0.05, 3.6);
    // A short burnt-out corridor: you can see into it, not go in
    this.solid(-2.6, y5 - 0.3, 2.2, -T, y5, 3.8, this.char);
    this.solid(-2.6, y5 + 2.4, 2.2, -T, y5 + 2.7, 3.8, this.char, { collide: false });
    this.solid(-2.6, y5, 2.1, -T, y5 + 2.4, 2.2, this.char);
    this.solid(-2.6, y5, 3.8, -T, y5 + 2.4, 3.9, this.char);
    this.solid(-2.7, y5, 2.1, -2.6, y5 + 2.4, 3.9, this.char);
    this.blk(-0.05, y5, 2.5, 0.0, y5 + 2.1, 3.5);
    this.fires.push({ pos: new THREE.Vector3(-1.8, y5, 3.0), size: 1.2, zone: null });
  }

  // -------------------------------------------------------------- collapse

  /**
   * The two storeys below the seventh floor are gone: flights, half
   * landings, the sixth floor's landing but a corner of it. What there is
   * to stand on is what is left on the walls and what came to rest in the
   * shaft — a zig-zag of it going down, every gap a jump, none of them far.
   */
  private buildCollapse(): void {
    // Each one's depth matters as much as its top: anything hanging over a
    // way through below it has to leave a man's height under it
    const P: [number, number, number, number, number, number][] = [
      // x0, z0, x1, z1, top, depth
      [3.0, 0.3, 4.4, 1.8, 19.0, 0.6], // a piece of the old flight, still on the north wall
      [5.0, 2.2, 6.2, 3.6, 18.2, 0.9], // jammed in the well
      [7.0, 0.0, 8.4, 2.6, 18.15, 0.6], // the seventh floor's half landing, what is left of it
      [6.6, 3.6, 8.0, 5.8, 17.2, 0.35],
      [3.0, 4.3, 5.4, 5.8, 16.7, 0.35], // a run of flight B, hanging off the south wall
      [0.0, 3.4, 1.8, 6.0, 16.3, 0.6], // the sixth floor's landing, its last corner
      [3.0, 0.6, 4.6, 2.6, 15.5, 0.6],
      [5.2, 0.2, 6.3, 1.8, 14.3, 0.6] // a step down, and a jump back up onto the landing
    ];
    P.forEach(([x0, z0, x1, z1, top, depth], i) => this.platform(x0, z0, x1, z1, top, i + 3, depth));
    // What the ones off the walls hang by: their rebar, still in the walls —
    // and the one in the middle, by two lengths up to the broken landing.
    // Each clear of the line he jumps along
    const bars: [number, number, number, number, number, number][] = [
      [3.15, 18.95, 0.32, 3.0, 19.9, 0], [4.25, 18.95, 0.32, 4.45, 19.8, 0],
      [5.05, 18.15, 2.25, 5.2, 20.6, 0], [6.15, 18.15, 3.55, 6.6, 20.85, 3.5],
      [7.95, 17.15, 4.0, SW.x1, 18.0, 4.2], [7.9, 17.15, 5.75, 8.2, 18.0, SW.z1],
      [3.3, 16.65, 5.8, 3.1, 17.6, SW.z1], [5.1, 16.65, 5.8, 5.3, 17.5, SW.z1],
      [3.2, 15.4, 0.62, 3.0, 16.4, 0], [4.4, 15.4, 0.62, 4.7, 16.3, 0],
      [5.4, 14.25, 0.2, 5.3, 15.2, 0], [6.1, 14.25, 0.2, 6.3, 15.1, 0]
    ];
    for (const [ax, ay, az, bx, by, bz] of bars) {
      this.rebar(new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz));
      this.rebar(new THREE.Vector3(ax + 0.12, ay, az), new THREE.Vector3(bx + 0.1, by - 0.05, bz));
    }
    // Storey 5's half landing, at the bottom of it: the most of it left
    const yb = halfY(5);
    this.solid(6.5, yb - 0.3, 0, SW.x1, yb, SW.z1, this.concrete);
    this.blk(6.5, yb - THICK, 0, SW.x1, yb - 0.3, SW.z1);
    this.put(rubble(0.9, 13), 6.45, yb - 0.3, 3.0, 1.2);
    // The ragged ends of the seventh floor's landing, and of the hole in flight A above
    this.put(rubble(0.8, 21), XA + 0.1, floorY(6) - 0.3, 1.0, 0.3);
    this.put(rubble(0.7, 23), XA + 0.1, floorY(6) - 0.3, 4.6, 2.0);
    // Bits of stair hanging off the walls, and slabs leant in the shaft — scenery
    const deco: [number, number, number, number, number, number][] = [
      // x, y, z, length, rotX, rotZ
      [4.2, 17.6, 0.3, 1.6, 0.5, 0.25],
      [7.6, 16.0, 5.7, 1.4, -0.4, -0.6],
      [2.0, 18.0, 5.6, 1.2, 0.3, 0.9],
      [6.0, 15.4, 5.6, 1.8, -0.2, 0.3],
      [1.2, 14.6, 0.4, 1.5, 0.6, -0.4]
    ];
    for (const [x, y, z, len, rx, rz] of deco) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, 0.9), this.concreteDark);
      slab.rotation.set(rx, 0, rz);
      this.put(new THREE.Group().add(slab), x, y, z);
    }
    for (let i = 0; i < 9; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.9 + (i % 3) * 0.4, 5), this.steel);
      bar.rotation.set(0.4 + i * 0.7, 0, 0.9 + i * 0.5);
      this.put(new THREE.Group().add(bar), 1 + ((i * 2.3) % 7), 14.5 + ((i * 1.7) % 5), 0.2 + ((i * 3.1) % 5.6));
    }
    // The sign where the floor stops
    this.put(warningSign(['DANGER', 'STRUCTURAL', 'COLLAPSE']), 0.02, floorY(6) + 1.5, 4.6, WEST);
    // Cut cables down the shaft, live
    const c = new THREE.Vector3(8.2, floorY(6) + 1.0, 0.4);
    this.put(new THREE.Group().add(cable([c, c.clone().add(new THREE.Vector3(-0.1, -1.2, 0.2)), c.clone().add(new THREE.Vector3(-0.3, -2.4, 0.5))], 0.018)), 0, 0, 0);
    this.sparks.push(c.clone().add(new THREE.Vector3(-0.3, -2.42, 0.5)));
  }

  // ----------------------------------------------------------------- beam

  /**
   * Below the fifth floor, flight A is under a mound of burning rubble. A
   * steel beam has come down across the well instead, from the edge of the
   * fifth floor's landing to the half landing below: walk it.
   */
  private buildBeam(): void {
    const f = OPEN;
    const yF = floorY(f);
    const yH = halfY(f);
    const xa = XA - 0.15;
    const xb = XB + 0.25;
    const zc = 3.0;
    const W = 0.44;
    // The I-beam itself: top flange, web, bottom flange, rusty
    const len = Math.hypot(xb - xa, yF - yH);
    const g = new THREE.Group();
    const rust = new THREE.MeshLambertMaterial({ color: 0x5a3d2c });
    const flange = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, W), rust);
    flange.position.y = -0.02;
    const web = new THREE.Mesh(new THREE.BoxGeometry(len, 0.36, 0.05), rust);
    web.position.y = -0.22;
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, W * 0.9), rust);
    bottom.position.y = -0.42;
    const tilt = new THREE.Group().add(flange, web, bottom);
    tilt.rotation.z = -Math.atan2(yF - yH, xb - xa);
    g.add(tilt);
    this.put(g, (xa + xb) / 2, (yF + yH) / 2, zc);
    // Walked as a run of thin steps down its length
    const n = 18;
    for (let i = 0; i < n; i++) {
      const u0 = i / n;
      const u1 = (i + 1) / n;
      const top = THREE.MathUtils.lerp(yF, yH, (u0 + u1) / 2);
      this.blk(xa + (xb - xa) * u0, top - 0.3, zc - W / 2, xa + (xb - xa) * u1, top, zc + W / 2);
    }
    // The mound over flight A: a wall of it at the top, and burning
    for (let i = 0; i < 5; i++) {
      this.put(rubblePile(0.7 + (i % 2) * 0.2), XA + 0.5 + i * 0.85, stepA(f, Math.min(9, i * 2 + 1)) - 0.1, 1.0, i * 0.9);
    }
    this.put(rubble(1.4, 41), XA + 0.4, yF - 0.2, 1.2, 0.2);
    // Its underside where the flight's was: a man stood on the landing below
    // has to clear it with his head
    this.blk(XA, stepA(f, 2) - 0.75, 0, XA + 0.9, yF + 2.4, 2.05);
    this.blk(XA + 0.9, yH, 0, XB, yF + 0.7, 2.05);
    this.fires.push({ pos: new THREE.Vector3(3.6, stepA(f, 3) + 0.3, 1.0), size: 1.4, zone: box3(XA, yH, 0, XB, yF + 1.2, 2.0) });
    this.fires.push({ pos: new THREE.Vector3(5.4, stepA(f, 8) + 0.2, 1.1), size: 1.0, zone: null });
    // And where it ends, spilling onto the half landing
    this.put(rubble(0.9, 43), 7.0, yH, 0.7, 0.4);
    this.fires.push({ pos: new THREE.Vector3(7.4, yH, 0.7), size: 0.8, zone: box3(XB, yH, 0, SW.x1, yH + 0.6, 1.4) });
    this.put(warningSign(['DANGER', 'DO NOT', 'USE STAIRS']), 0.02, yF + 1.55, 4.6, WEST);
  }

  // ----------------------------------------------------------------- crawl

  /**
   * Below the fourth floor a slab of ceiling has come down over flight A,
   * leaving a crawlspace under it: crouch. At the bottom, another fire
   * across the half landing — jump it.
   */
  private buildCrawl(): void {
    const f = 3;
    for (let i = 3; i < SW.steps; i++) {
      const top = stepA(f, i);
      // Room for a crouch coming down off the step above, not for a man stood up
      this.blk(XA + i * RUN, top + 1.4, 0, XA + (i + 1) * RUN, top + 1.95, 2.0);
    }
    const x0 = XA + 3 * RUN;
    const x1 = XB;
    const ya = stepA(f, 3) + 1.53;
    const yb = stepA(f, 9) + 1.53;
    const len = Math.hypot(x1 - x0, yb - ya);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(len + 0.4, 0.26, 2.3), this.concreteDark);
    const tilt = new THREE.Group().add(slab);
    tilt.rotation.z = -Math.atan2(ya - yb, x1 - x0);
    this.put(new THREE.Group().add(tilt), (x0 + x1) / 2, (ya + yb) / 2, 1.0);
    // Rubble on it
    this.put(rubble(0.7, 51), (x0 + x1) / 2, (ya + yb) / 2 + 0.15, 1.1, 0.7);
    this.put(rubble(0.6, 53), x0 + 0.6, ya + 0.15, 0.8, 2.1);
    // The fire across the half landing, from wall to wall where he has to cross
    const yH = halfY(f);
    this.fires.push({ pos: new THREE.Vector3(7.3, yH, 3.0), size: 1.3, zone: box3(XB, yH, 2.0, SW.x1, yH + 0.55, 4.0) });
    this.put(rubblePile(0.55), 7.3, yH, 3.0, 0.6);
  }

  // ------------------------------------------------------------------ heap

  /**
   * Below the third floor, flight B fell out altogether, and so did the
   * half landing's south side; what came down made a heap in the well two
   * metres under the half landing. Down onto it, and up from it onto the
   * second floor's landing — it is just low enough to climb.
   */
  private buildHeap(): void {
    this.platform(2.6, 2.15, 5.8, 3.85, 2.45, 61, 2.45);
    this.put(rubblePile(0.6), 3.4, 2.45, 3.4, 0.5);
    this.put(rubble(1.0, 63), 5.3, 2.2, 2.6, 1.4);
    // Bits of the fallen flight on it
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 1.4), this.concrete);
      s.rotation.set(0.3 - i * 0.2, i * 0.5, 0.4 + i * 0.3);
      this.put(new THREE.Group().add(s), 3.2 + i * 0.7, 2.55 + (i % 2) * 0.1, 3.2);
    }
  }

  // ----------------------------------------------------------------- fires

  /** The other fires: across the seventh floor's half landing, and on the ground floor. */
  private buildFires(): void {
    // Below the eighth floor: burning in the gap across the half landing,
    // wreckage caught on the broken edge — and on the far side, against the wall
    const yH = halfY(7);
    this.fires.push({ pos: new THREE.Vector3(7.4, yH - 0.55, 2.7), size: 1.3, zone: null });
    this.fires.push({ pos: new THREE.Vector3(8.0, yH, 5.2), size: 0.8, zone: box3(7.6, yH, 4.5, SW.x1, yH + 0.6, SW.z1) });
    this.put(rubblePile(0.45), 8.0, yH, 5.2, 1.1);
    const snag = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.8), this.char);
    snag.rotation.set(0.5, 0.2, 0.15);
    this.put(new THREE.Group().add(snag), 7.4, yH - 0.65, 2.7);
    // On the ground floor, under the stairs
    this.fires.push({ pos: new THREE.Vector3(7.2, 0, 5.1), size: 1.0, zone: box3(6.2, 0, 4.2, 8.4, 0.6, 6.0) });
    this.put(rubblePile(0.5), 7.2, 0, 5.1, 0.3);
    // Scorched walls where they burn
    for (const [y, z, w, h] of [
      [yH + 1.2, 3.0, 2.4, 2.6],
      [halfY(3) + 1.2, 3.0, 2.4, 2.6],
      [halfY(OPEN) + 1.0, 0.8, 1.8, 2.2],
      [1.1, 5.0, 2.0, 2.2]
    ] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), scorchMat());
      m.position.set(SW.x1 - 0.01, y, z);
      m.rotation.y = -Math.PI / 2;
      this.group.add(m);
    }
  }

  // -------------------------------------------------------------- dressing

  private buildDressing(): void {
    // Paper, dust and bits all the way down
    for (let f: number = 0; f <= SW.storeys; f++) {
      if (f === LOST) continue;
      const y = floorY(f);
      this.put(scatteredPaper(4, 0.7), 1.0, y, 1.0 + (f % 3) * 1.6, f * 0.7);
      if (f % 2 === 0) this.put(rubble(0.5, 70 + f), 1.6, y, 5.2, f);
    }
    // Fire alarms on the landings
    for (const f of [8, 4, 0]) this.put(fireAlarm(), 0.02, floorY(f) + 1.35, 5.1, WEST);
    // Emergency lamps on every floor's wall: lit boxes; the light itself is the scene's few
    const lamp = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xfff3dc, emissiveIntensity: 1.3 });
    for (let f: number = 0; f <= SW.storeys; f++) {
      if (f === LOST) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.34), lamp);
      m.position.set(0.04, floorY(f) + 2.75, 4.6);
      this.put(new THREE.Group().add(m), 0, 0, 0);
    }
  }

  private buildLighting(): void {
    this.group.add(new THREE.AmbientLight(0x6a6560, 0.4));
    this.group.add(new THREE.HemisphereLight(0x9aa4ae, 0x2a2018, 0.34));
    // The emergency lighting that is still on: top, middle, bottom
    for (const y of [floorY(8) + 2.6, floorY(OPEN) + 2.6, 2.6]) {
      const l = new THREE.PointLight(0xfff0dc, 5.5, 13, 1.4);
      l.position.set(1.2, y, 3.0);
      this.group.add(l);
    }
    // One light for each of the big fires, orange, flickered by the scene
    for (const p of [
      new THREE.Vector3(7.3, halfY(7) - 0.2, 2.7),
      new THREE.Vector3(4.0, floorY(OPEN) - 0.4, 1.2),
      new THREE.Vector3(7.3, halfY(3) + 0.9, 3.0),
      new THREE.Vector3(6.9, 0.9, 5.2)
    ]) {
      const l = new THREE.PointLight(0xff7a2a, 7, 11, 1.5);
      l.position.copy(p);
      this.group.add(l);
      this.fireLights.push(l);
    }
  }

  // ------------------------------------------------------------- the cast

  /** Nine of them, a few to a landing, on the landings he has to come down to. */
  private agents(): StairAgent[] {
    const landing = (f: number): THREE.Box3 => box3(0.35, floorY(f) - 0.1, 0.45, XA - 0.3, floorY(f) + 2, SW.z1 - 0.45);
    const a = (pos: THREE.Vector3, armour: boolean, aim: boolean, upTo: number, group: number, area: THREE.Box3): StairAgent => ({
      pos,
      yaw: EAST,
      armour,
      aim,
      area,
      upTo,
      group
    });
    const at = (x: number, f: number, z: number): THREE.Vector3 => new THREE.Vector3(x, floorY(f), z);
    return [
      // The eighth floor: waiting for whoever comes down from the top
      a(at(1.1, 7, 1.4), false, true, 0, 0, landing(7)),
      a(at(1.4, 7, 4.7), false, false, 0, 0, landing(7)),
      // The fifth floor, at the bottom of the collapse
      a(at(1.0, OPEN, 1.3), false, true, 2, 1, landing(OPEN)),
      a(at(1.1, OPEN, 4.4), true, false, 2, 1, landing(OPEN)),
      // The third floor
      a(at(1.2, 2, 1.5), false, true, 2, 2, landing(2)),
      a(at(1.5, 2, 4.6), false, false, 2, 2, landing(2)),
      // The ground floor by the door out, and one on the last half landing
      a(at(1.3, 0, 1.0), false, true, 3, 3, box3(0.35, -0.1, 0.45, 1.9, 2, 5.55)),
      a(at(1.0, 0, 5.0), true, false, 3, 3, box3(0.35, -0.1, 0.45, 1.9, 2, 5.55)),
      a(new THREE.Vector3(7.4, halfY(1), 3.0), false, true, 3, 3, box3(6.5, halfY(1) - 0.1, 0.5, 8.1, halfY(1) + 2, 5.5))
    ];
  }

  // ------------------------------------------------------------ waypoints

  /** A little grid on each landing an agent holds, joined up; each landing its own island. */
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
    island(0.5, 1.9, 0.6, 5.4, floorY(7));
    island(0.5, 1.9, 0.6, 5.4, floorY(OPEN));
    island(0.5, 1.9, 0.6, 5.4, floorY(2));
    island(0.5, 1.9, 0.6, 5.4, 0);
    island(6.6, 8.0, 0.6, 5.4, halfY(1));
    return wps;
  }

  // ----------------------------------------------------------------- merge

  /** The walls, slabs and steps into one mesh per material: they were the better part of a thousand draws. */
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

function box3(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/**
 * One storey of stairwell wall: painted green-grey to a little over a
 * metre, a dark band, off-white above, grimy, with the odd crack — tiled up
 * the shaft a storey to every tile.
 */
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
  // Grime running down from the top
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

/** A floor's number, stencilled black on a white square. */
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

/** A painted label: text on a plate. */
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

/** Soot up a wall over a fire: black at the bottom, fading out above. */
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
