import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Collider, Waypoint } from './OfficeLevelBuilder';
import type { CombatLevel } from '../scenes/CombatScene';
import type { CarKind, ParkedSlot } from '../scenes/Level8Contracts';
import { CAR_COLOURS } from './VehicleProps';
import { makeCanvas, tiling, noiseTile, asphaltCanvas } from './Level8Builder';

/**
 * HQBuilder — the Exterminator Collective's headquarters at night, in the
 * rain: the security gates, the parking lot in front of it — four outpost
 * towers, rows of parked cars, blast walls, barriers, containers and sandbag
 * nests — and the building itself, a black tower going straight up into the
 * cloud from a stone podium, with a great flight of stairs up to its doors
 * and, under the stairs, a hole blown in the podium wall.
 *
 * World: +Y up; the gate on z = 0, the lot running away from it to −Z, the
 * stairs and the podium at its far end. Everything solid is axis-aligned.
 */

export interface TowerSite {
  pos: THREE.Vector3;
  /** Which way its cabin's door faces (cosmetic). */
  yaw: number;
}

/** Somewhere for one of the crew to fight from: where to stand, and which way the trouble is. */
export interface Post {
  pos: THREE.Vector3;
  /** What to look at from there. */
  face: THREE.Vector3;
  /** Low cover: crouch behind it between shots. */
  low: boolean;
}

export interface HQSpawn {
  pos: THREE.Vector3;
  yaw: number;
}

/** A tree, for the wind: its instance in the trunks and the crowns, and how it sways. */
export interface Sway {
  index: number;
  base: THREE.Vector3;
  scale: number;
  phase: number;
  /** How far it gives to the wind (radians at full gust). */
  give: number;
}

export interface HQData extends CombatLevel {
  occluders: THREE.Object3D[];
  waypoints: Waypoint[];
  parked: ParkedSlot[];
  towers: TowerSite[];
  gate: {
    left: THREE.Group;
    right: THREE.Group;
    /** The closed gate, as a wall; off once it's been driven through. */
    collider: Collider;
    half: number;
    height: number;
  };
  trees: { trunks: THREE.InstancedMesh; crowns: THREE.InstancedMesh; list: Sway[]; flutter: { value: number }; gust: { value: number } };
  stair: { x0: number; x1: number; zFoot: number; zTop: number; topY: number };
  hole: { centre: THREE.Vector3; trigger: THREE.Box3; light: THREE.PointLight; spark: THREE.Vector3 };
  /** Under the stairs: no rain. */
  shelter: THREE.Box3;
  /** The skyscraper's footprint (the lightning likes it). */
  tower: { x: number; z: number; half: number };
  entranceLight: THREE.PointLight;
  /** Blinking red on the corners of the tower, going up into the cloud. */
  aviation: THREE.MeshBasicMaterial;
  /** Searchlights on the podium roof, sweeping the cloud. */
  beams: THREE.Object3D[];
  /** The van's line in through the gate and where it ends up. */
  vanStop: { pos: THREE.Vector3; yaw: number };
  /** Where Ravi stands to fight from at each checkpoint: 1 the towers, 2 the advance. */
  starts: { pos: THREE.Vector3; yaw: number }[];
  /** The crew's places: round the van to start, then further up as the towers fall, then on to the stairs. */
  posts: { van: Post[]; mid: Post[]; far: Post[]; stairs: Post[] };
  /** Where the Collective's men come from: by the towers, and out of the podium. */
  spawns: { near: HQSpawn[]; far: HQSpawn[]; podium: HQSpawn[] };
  /** For the reflections: a little scene of the sky and the lights, to bake into an environment map. */
  envScene: THREE.Scene;
  /** The ground's wet sheen, for the lightning to brighten. */
  ground: THREE.MeshStandardMaterial;
  /** Lamp heads and lit glass, for the flicker of a strike to leave alone. */
  lamps: THREE.MeshStandardMaterial;
}

// ------------------------------------------------------------------ layout

export const GATE_HALF = 7.5;
const GATE_H = 6;
const WALL_H = 5;
const LOT_X = 74;
const LOT_Z = -180;
/** The podium's front face; the stairs run up to it. */
const PODIUM_Z = -188;
const PODIUM_H = 9;
const PODIUM_X = 52;
const STAIR_X = 13;
const STAIR_STEPS = 56;
const STAIR_RISE = PODIUM_H / STAIR_STEPS;
const STAIR_RUN = 0.45;
const STAIR_FOOT = PODIUM_Z + STAIR_STEPS * STAIR_RUN;
/** The tower above the podium. */
const TOWER_X = 0;
const TOWER_Z = -228;
const TOWER_HALF = 27;
const TOWER_H = 640;
/** The hole under the stairs. */
const HOLE = { x: -3.6, w: 3.3, h: 3.1 };
/** The stairs' slab under each step is this thick, so you can walk under where it's high enough. */
const SLAB = 0.55;

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A box's geometry, moved to (x, y, z) — y is its bottom — and turned `ry`. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false) ?? list[0];
  for (const x of list) if (x !== g) x.dispose();
  return g;
}

/** UVs from world position, `tile` metres a repeat, picking the plane by the face's normal. */
function worldUVs(g: THREE.BufferGeometry, tile: number): void {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (ny > nx && ny > Math.abs(n.getZ(i))) {
      uv[i * 2] = x / tile;
      uv[i * 2 + 1] = z / tile;
    } else if (nx > Math.abs(n.getZ(i))) {
      uv[i * 2] = z / tile;
      uv[i * 2 + 1] = y / tile;
    } else {
      uv[i * 2] = x / tile;
      uv[i * 2 + 1] = y / tile;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ---------------------------------------------------------------- textures

/** Where the lot holds water: the roughness map — near black (mirror) in the puddles, grey where it's only wet. */
function puddleCanvas(): HTMLCanvasElement {
  const S = 512;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(118,118,118)';
  g.fillRect(0, 0, S, S);
  const r = lcg(77);
  // Wet grain
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    const v = (r() - 0.5) * 40;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 118 + v;
  }
  g.putImageData(img, 0, 0);
  // Puddles: soft dark blobs, wrapped so the tile repeats
  for (let k = 0; k < 26; k++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 14 + r() * 60;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + ox, y + oy, rad * 0.2, x + ox, y + oy, rad);
        gr.addColorStop(0, 'rgba(14,14,14,0.95)');
        gr.addColorStop(0.7, 'rgba(24,24,24,0.8)');
        gr.addColorStop(1, 'rgba(24,24,24,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.ellipse(x + ox, y + oy, rad * (1 + r() * 0.8), rad, r() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  return c;
}

/** Wet concrete: grey, mottled, darker in patches where the water sits. */
function concreteCanvas(): HTMLCanvasElement {
  return noiseTile(256, [96, 96, 94], { fine: 14, blobs: 22, blobAmp: 12, specks: 0.01, speckAmp: 30 });
}

/** The tower's skin: black glass and steel, the floor lines and the mullions, a few windows lit. */
function towerCanvases(): { map: HTMLCanvasElement; glow: HTMLCanvasElement } {
  // 13 bays across a face, 160 floors up it: 4 px a bay column, 12 px a floor
  const W = 208;
  const H = 1920;
  const floors = 160;
  const fh = H / floors;
  const bays = 13;
  const bw = W / bays;
  const map = makeCanvas(W, H);
  const glow = makeCanvas(W, H);
  const g = map.getContext('2d')!;
  const e = glow.getContext('2d')!;
  g.fillStyle = '#0a0b0e';
  g.fillRect(0, 0, W, H);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const r = lcg(1312);
  for (let f = 0; f < floors; f++) {
    const y = H - (f + 1) * fh;
    // Spandrel: the floor slab's band, a little lighter
    g.fillStyle = '#16181c';
    g.fillRect(0, y + fh - 2.5, W, 2.5);
  }
  for (let b = 0; b <= bays; b++) {
    g.fillStyle = '#1c1e23';
    g.fillRect(b * bw - 1, 0, 2, H);
  }
  // Lit: only a few floors, and only some of the windows on them; a cold light, one or two warm
  const lit = [2, 3, 7, 12, 13, 19, 26, 33, 34, 41];
  for (const f of lit) {
    const y = H - (f + 1) * fh;
    const warm = r() < 0.25;
    for (let b = 0; b < bays; b++) {
      if (r() < 0.35) continue;
      const k = 0.55 + r() * 0.45;
      e.fillStyle = warm ? `rgba(255,${190 + r() * 30},${120 + r() * 40},${k})` : `rgba(${150 + r() * 40},${190 + r() * 30},255,${k})`;
      e.fillRect(b * bw + 2, y + 1.5, bw - 4, fh - 4.5);
    }
  }
  return { map, glow };
}

/** City windows for the skyline: a dark grid, a scatter lit. */
function skylineCanvas(): HTMLCanvasElement {
  const W = 256;
  const H = 256;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = '#07080a';
  g.fillRect(0, 0, W, H);
  const r = lcg(9);
  for (let y = 0; y < H; y += 8) {
    for (let x = 0; x < W; x += 8) {
      if (r() < 0.16) {
        const warm = r() < 0.6;
        g.fillStyle = warm ? `rgba(255,${180 + r() * 50},${110 + r() * 40},${0.5 + r() * 0.5})` : `rgba(170,205,255,${0.4 + r() * 0.5})`;
        g.fillRect(x + 2, y + 2, 4, 4);
      }
    }
  }
  return c;
}

/** The Collective's mark: a hexagon round a stylised E over C, and the name under it. Red on black. */
function logoCanvas(): HTMLCanvasElement {
  const c = makeCanvas(1024, 512);
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 512);
  const cx = 512;
  const cy = 200;
  g.strokeStyle = '#ff2a1c';
  g.lineWidth = 16;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const x = cx + Math.cos(a) * 150;
    const y = cy + Math.sin(a) * 150;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.stroke();
  g.fillStyle = '#ff2a1c';
  g.font = 'bold 170px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('EC', cx, cy + 6);
  g.font = 'bold 64px Arial, sans-serif';
  g.fillText('EXTERMINATOR  COLLECTIVE', cx, 440);
  return c;
}

/** A warning sign on the gate and the wall: yellow on black. */
function signCanvas(lines: string[]): HTMLCanvasElement {
  const c = makeCanvas(512, 256);
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8c31c';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#111';
  g.fillRect(12, 12, 488, 232);
  g.fillStyle = '#e8c31c';
  g.textAlign = 'center';
  g.font = 'bold 52px Arial, sans-serif';
  lines.forEach((l, i) => g.fillText(l, 256, 86 + i * 70));
  return c;
}

/** Light falling on the wet ground under a lamp: a soft round pool. */
function poolCanvas(): HTMLCanvasElement {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/** Corrugated container side: ribs and rust streaks; the colour comes from the instance. */
function containerCanvas(): HTMLCanvasElement {
  const c = makeCanvas(256, 128);
  const g = c.getContext('2d')!;
  for (let x = 0; x < 256; x += 16) {
    const gr = g.createLinearGradient(x, 0, x + 16, 0);
    gr.addColorStop(0, '#9a9a9a');
    gr.addColorStop(0.5, '#ffffff');
    gr.addColorStop(1, '#8a8a8a');
    g.fillStyle = gr;
    g.fillRect(x, 0, 16, 128);
  }
  const r = lcg(5);
  for (let k = 0; k < 18; k++) {
    g.fillStyle = `rgba(90,50,30,${0.15 + r() * 0.25})`;
    const x = r() * 256;
    g.fillRect(x, r() * 40, 2 + r() * 4, 30 + r() * 90);
  }
  return c;
}

// ------------------------------------------------------------------ builder

interface Place {
  x: number;
  z: number;
  /** Quarter turns only for anything solid. */
  ry?: number;
  y?: number;
  s?: number;
  colour?: number;
}

export class HQBuilder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private envScene = new THREE.Scene();
  private M!: {
    asphalt: THREE.MeshStandardMaterial;
    concrete: THREE.MeshStandardMaterial;
    darkConcrete: THREE.MeshStandardMaterial;
    steel: THREE.MeshStandardMaterial;
    darkSteel: THREE.MeshStandardMaterial;
    stone: THREE.MeshStandardMaterial;
    paint: THREE.MeshStandardMaterial;
    yellow: THREE.MeshStandardMaterial;
    lamp: THREE.MeshStandardMaterial;
    sandbag: THREE.MeshStandardMaterial;
    void: THREE.MeshBasicMaterial;
  };
  private glints: { x: number; z: number; y: number; colour: THREE.Color; size: number }[] = [];

  build(): HQData {
    this.makeMaterials();
    const ground = this.buildGround();
    this.buildMarkings();
    const gate = this.buildPerimeter();
    const parked = this.parkedCars();
    const towers: TowerSite[] = [
      { pos: V(-34, 0, -58), yaw: 0.4 },
      { pos: V(38, 0, -62), yaw: -0.5 },
      { pos: V(-40, 0, -103), yaw: 0.2 },
      { pos: V(34, 0, -106), yaw: -0.3 }
    ];
    this.buildCover(towers);
    const lights = this.buildPoles();
    const trees = this.buildTrees();
    const hq = this.buildHeadquarters();
    this.buildCity();
    this.buildGlints();
    const waypoints = this.waypointGrid(parked, towers);
    this.buildEnv();

    const look = (x: number, z: number): THREE.Vector3 => V(x, 1.2, z);
    const post = (x: number, z: number, low: boolean, fx = x * 0.6, fz = z - 40): Post => ({ pos: V(x, 0, z), face: look(fx, fz), low });
    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      glassPanes: [],
      occluders: this.occluders,
      waypoints,
      parked,
      towers,
      gate,
      trees,
      stair: { x0: -STAIR_X, x1: STAIR_X, zFoot: STAIR_FOOT, zTop: PODIUM_Z, topY: PODIUM_H },
      hole: hq.hole,
      shelter: hq.shelter,
      tower: { x: TOWER_X, z: TOWER_Z, half: TOWER_HALF },
      entranceLight: hq.entrance,
      aviation: hq.aviation,
      beams: hq.beams,
      vanStop: { pos: V(2.6, 0, -24), yaw: 0.32 },
      starts: [
        { pos: V(7.6, 0, -23.5), yaw: 0.1 },
        { pos: V(7.6, 0, -23.5), yaw: 0.1 },
        { pos: V(4, 0, -90), yaw: 0 }
      ],
      posts: {
        // Round the van and behind the first row of cars, the towers ahead
        van: [
          post(11.2, -27.1, true, 30, -60),
          post(-11.2, -27.1, true, -30, -58),
          post(15.4, -30.6, true, 38, -62),
          post(-15.4, -30.6, true, -34, -58),
          post(21, -30.6, true, 38, -62),
          post(-21, -30.6, true, -34, -58),
          post(26.6, -30.6, true, 38, -62)
        ],
        // Behind the second row, with the far pair still up
        mid: [
          post(-15.4, -74.6, true, -40, -103),
          post(15.4, -74.6, true, 34, -106),
          post(-21, -74.6, true, -40, -103),
          post(21, -74.6, true, 34, -106),
          post(-26.6, -74.6, true, -40, -103),
          post(4, -64.8, true, 10, -110),
          post(26.6, -74.6, true, 34, -106)
        ],
        // The far rows: pushing up the middle toward the stairs
        far: [
          post(-15.4, -116.6, true, -12, -175),
          post(15.4, -116.6, true, 12, -175),
          post(-4.6, -96.8, true, -10, -175),
          post(3.6, -106.8, true, 10, -175),
          post(-21, -116.6, true, -25, -180),
          post(21, -116.6, true, 25, -180),
          post(-3.6, -132.8, true, 0, -178)
        ],
        // At the foot of the stairs: the colonnade
        stairs: [
          post(-17.1, -156.6, false, -30, -186),
          post(17.1, -156.6, false, 30, -186),
          post(-26.1, -156.6, false, -36, -186),
          post(26.1, -156.6, false, 36, -186),
          post(2, -132.8, true, 20, -186),
          post(-8.1, -156.6, false, -20, -186),
          post(35.1, -156.6, false, 40, -186)
        ]
      },
      spawns: {
        near: [
          { pos: V(-44, 0, -66), yaw: Math.PI },
          { pos: V(-26, 0, -66), yaw: Math.PI },
          { pos: V(46, 0, -70), yaw: Math.PI },
          { pos: V(30, 0, -70), yaw: Math.PI },
          { pos: V(-56, 0, -60), yaw: Math.PI },
          { pos: V(56, 0, -64), yaw: Math.PI }
        ],
        far: [
          { pos: V(-48, 0, -110), yaw: Math.PI },
          { pos: V(-32, 0, -112), yaw: Math.PI },
          { pos: V(42, 0, -114), yaw: Math.PI },
          { pos: V(26, 0, -114), yaw: Math.PI },
          { pos: V(-58, 0, -106), yaw: Math.PI },
          { pos: V(58, 0, -108), yaw: Math.PI }
        ],
        podium: [
          { pos: V(-30, 0, -184), yaw: Math.PI },
          { pos: V(30, 0, -184), yaw: Math.PI },
          { pos: V(-44, 0, -176), yaw: Math.PI },
          { pos: V(44, 0, -176), yaw: Math.PI },
          { pos: V(-22, 0, -172), yaw: Math.PI },
          { pos: V(22, 0, -172), yaw: Math.PI }
        ]
      },
      envScene: this.envScene,
      ground,
      lamps: lights
    };
  }

  // ------------------------------------------------------------ materials

  private makeMaterials(): void {
    const asphaltMap = tiling(asphaltCanvas());
    asphaltMap.repeat.set(1, 1);
    const wet = tiling(puddleCanvas());
    wet.colorSpace = THREE.NoColorSpace;
    const conc = tiling(concreteCanvas());
    this.M = {
      asphalt: new THREE.MeshStandardMaterial({ color: 0x4a4d52, map: asphaltMap, roughness: 1, roughnessMap: wet, metalness: 0, envMapIntensity: 1.5 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x9a9890, map: conc, roughness: 0.55, envMapIntensity: 0.8 }),
      darkConcrete: new THREE.MeshStandardMaterial({ color: 0x5c5c58, map: conc, roughness: 0.6, envMapIntensity: 0.7 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x5a5e64, roughness: 0.42, metalness: 0.75, envMapIntensity: 1 }),
      darkSteel: new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.45, metalness: 0.7, envMapIntensity: 1 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x34363b, map: conc, roughness: 0.34, metalness: 0.1, envMapIntensity: 1.3 }),
      paint: new THREE.MeshStandardMaterial({ color: 0xc9cbc8, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xc8a21a, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      lamp: new THREE.MeshStandardMaterial({ color: 0x202020, emissive: 0xdde8ff, emissiveIntensity: 3.2 }),
      sandbag: new THREE.MeshStandardMaterial({ color: 0x5f5a45, roughness: 0.85, envMapIntensity: 0.6 }),
      void: new THREE.MeshBasicMaterial({ color: 0x010101 })
    };
  }

  /** Something solid in the level: drawn, shot at, seen through or not, walked into. */
  private solid(
    mesh: THREE.Mesh,
    o: { collide?: THREE.Box3[] | 'self'; shoot?: boolean; occlude?: boolean; surface?: string; cast?: boolean; receive?: boolean } = {}
  ): THREE.Mesh {
    this.group.add(mesh);
    mesh.castShadow = o.cast ?? true;
    mesh.receiveShadow = o.receive ?? true;
    if (o.shoot !== false) {
      mesh.userData.surface = o.surface ?? 'concrete';
      this.shootables.push(mesh);
    }
    if (o.occlude) this.occluders.push(mesh);
    if (o.collide === 'self') {
      mesh.geometry.computeBoundingBox();
      mesh.updateMatrixWorld(true);
      this.colliders.push({ box: mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld) });
    } else if (o.collide) {
      for (const b of o.collide) this.colliders.push({ box: b });
    }
    return mesh;
  }

  private collide(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): THREE.Box3 {
    return new THREE.Box3(V(minX, minY, minZ), V(maxX, maxY, maxZ));
  }

  /**
   * The same thing in many places, one draw: an instanced mesh of `geo`
   * (built with its base at y = 0, centred), and a collider for each copy
   * from its footprint (`size`, before the quarter turn).
   */
  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: Place[], size: THREE.Vector3 | null, o: { occlude?: boolean; surface?: string; cast?: boolean; colours?: boolean } = {}): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    list.forEach((p, i) => {
      q.setFromAxisAngle(V(0, 1, 0), p.ry ?? 0);
      s.setScalar(p.s ?? 1);
      m.compose(V(p.x, p.y ?? 0, p.z), q, s);
      im.setMatrixAt(i, m);
      if (o.colours && p.colour !== undefined) im.setColorAt(i, new THREE.Color(p.colour));
      if (size) {
        const turned = Math.abs(Math.sin(p.ry ?? 0)) > 0.5;
        const hx = ((turned ? size.z : size.x) / 2) * (p.s ?? 1);
        const hz = ((turned ? size.x : size.z) / 2) * (p.s ?? 1);
        this.colliders.push({ box: this.collide(p.x - hx, p.y ?? 0, p.z - hz, p.x + hx, (p.y ?? 0) + size.y * (p.s ?? 1), p.z + hz) });
      }
    });
    im.computeBoundingSphere();
    im.castShadow = o.cast ?? true;
    im.receiveShadow = true;
    im.userData.surface = o.surface ?? 'concrete';
    this.group.add(im);
    this.shootables.push(im);
    if (o.occlude) this.occluders.push(im);
    return im;
  }

  // --------------------------------------------------------------- ground

  private buildGround(): THREE.MeshStandardMaterial {
    // The lot, the plaza in front of the podium and the road outside: one wet slab
    const g = new THREE.PlaneGeometry(900, 1100, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -120);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 7, pos.getZ(i) / 7);
    // The puddles at a different scale from the grain: a second UV set for the roughness map
    const uv2 = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv2[i * 2] = pos.getX(i) / 26;
      uv2[i * 2 + 1] = pos.getZ(i) / 26;
    }
    g.setAttribute('uv1', new THREE.BufferAttribute(uv2, 2));
    const mat = this.M.asphalt;
    mat.roughnessMap!.channel = 1;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'ground';
    mesh.receiveShadow = true;
    mesh.userData.surface = 'concrete';
    this.group.add(mesh);
    this.shootables.push(mesh);
    // The floor everyone stands on (the van's path in from the road included)
    this.colliders.push({ box: this.collide(-450, -2, -700, 450, 0, 450) });
    // Kerbs along the road outside and the sidewalks
    const kerbs: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      kerbs.push(box(4, 0.16, 330, sx * 11, 0, 165));
      kerbs.push(box(0.25, 0.18, 330, sx * 9, 0, 165));
    }
    const kerb = new THREE.Mesh(merge(kerbs), this.M.concrete);
    worldUVs(kerb.geometry, 3);
    this.solid(kerb, { cast: false });
    return mat;
  }

  /** Paint: the bays, the drive up the middle, the hatching round the towers, arrows. */
  private buildMarkings(): void {
    const white: THREE.BufferGeometry[] = [];
    const yellow: THREE.BufferGeometry[] = [];
    const strip = (list: THREE.BufferGeometry[], x: number, z: number, w: number, d: number, ry = 0): void => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      if (ry) g.rotateY(ry);
      g.translate(x, 0.004, z);
      list.push(g);
    };
    // Bay lines for each row of cars, both blocks
    for (const zc of [-37, -81, -123, -151]) {
      for (const sx of [-1, 1]) {
        for (let k = 0; k <= 19; k++) {
          const x = sx * (14 + k * 2.8);
          strip(white, x, zc, 0.12, 10.6);
        }
        strip(white, sx * 40.6, zc, 53.2, 0.12);
      }
    }
    // The drive: dashed centre line from the gate to the stairs, edge lines
    for (let z = -4; z > STAIR_FOOT + 4; z -= 6) strip(white, 0, z, 0.16, 3);
    for (const sx of [-1, 1]) strip(white, sx * 8.6, (STAIR_FOOT + 2) / 2, 0.14, -STAIR_FOOT - 2);
    // A stop line and EC hatching at the gate
    strip(yellow, 0, -3, 15, 0.4);
    for (let k = -6; k <= 6; k++) strip(yellow, k * 1.15, -1.4, 0.35, 2.4, 0.6);
    // Arrows down the drive
    for (const z of [-20, -60, -100, -140]) {
      strip(white, 0, z, 0.35, 3.2);
      strip(white, -0.45, z - 1.6, 0.3, 1.2, 0.7);
      strip(white, 0.45, z - 1.6, 0.3, 1.2, -0.7);
    }
    this.group.add(new THREE.Mesh(merge(white), this.M.paint));
    this.group.add(new THREE.Mesh(merge(yellow), this.M.yellow));
    for (const c of this.group.children.slice(-2)) c.receiveShadow = true;
  }

  // ---------------------------------------------------------- the perimeter

  /** The wall round the lot, the barbed wire on it, the gate posts, and the gate itself. */
  private buildPerimeter(): HQData['gate'] {
    const M = this.M;
    // The wall: along the front either side of the gate, down both sides to the podium
    const walls: [number, number, number, number][] = [
      [-LOT_X, -0.5, -GATE_HALF - 0.9, 0.5],
      [GATE_HALF + 0.9, -0.5, LOT_X, 0.5],
      [-LOT_X - 1, PODIUM_Z, -LOT_X, 0.5],
      [LOT_X, PODIUM_Z, LOT_X + 1, 0.5],
      // Closing off the back corners either side of the podium
      [-LOT_X - 1, PODIUM_Z - 1, -PODIUM_X, PODIUM_Z],
      [PODIUM_X, PODIUM_Z - 1, LOT_X + 1, PODIUM_Z]
    ];
    const wallGeos: THREE.BufferGeometry[] = [];
    for (const [x0, z0, x1, z1] of walls) {
      wallGeos.push(box(x1 - x0, WALL_H, z1 - z0, (x0 + x1) / 2, 0, (z0 + z1) / 2));
      this.colliders.push({ box: this.collide(x0, 0, z0, x1, WALL_H, z1) });
      // A coping along the top
      wallGeos.push(box(x1 - x0 + 0.2, 0.18, z1 - z0 + 0.2, (x0 + x1) / 2, WALL_H, (z0 + z1) / 2));
    }
    // Buttresses every 6 m on the inside face
    for (let x = -LOT_X + 3; x < LOT_X; x += 6) if (Math.abs(x) > GATE_HALF + 2) wallGeos.push(box(0.5, WALL_H - 0.4, 0.4, x, 0, -0.7));
    for (const sx of [-1, 1]) for (let z = -6; z > PODIUM_Z; z -= 6) wallGeos.push(box(0.4, WALL_H - 0.4, 0.5, sx * (LOT_X - 0.2), 0, z));
    const wall = new THREE.Mesh(merge(wallGeos), M.concrete);
    worldUVs(wall.geometry, 4);
    this.solid(wall, { occlude: true });

    // Barbed wire: coils along the top of the wall on angled brackets
    const coil = this.coilGeometry(3);
    const coils: Place[] = [];
    for (let x = -LOT_X + 1.5; x < LOT_X; x += 3) if (Math.abs(x) > GATE_HALF + 2) coils.push({ x, z: 0, y: WALL_H + 0.45 });
    for (const sx of [-1, 1]) for (let z = -1.5; z > PODIUM_Z; z -= 3) coils.push({ x: sx * (LOT_X + 0.5), z, y: WALL_H + 0.45, ry: Math.PI / 2 });
    const wire = new THREE.InstancedMesh(coil, M.steel, coils.length);
    const m = new THREE.Matrix4();
    coils.forEach((c, i) => {
      m.compose(V(c.x, c.y!, c.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), c.ry ?? 0), V(1, 1, 1));
      wire.setMatrixAt(i, m);
    });
    this.group.add(wire);

    // Signs on the wall either side of the gate
    const signMat = new THREE.MeshStandardMaterial({ map: tiling(signCanvas(['RESTRICTED AREA', 'EXTERMINATOR', 'COLLECTIVE'])), roughness: 0.4 });
    signMat.map!.wrapS = signMat.map!.wrapT = THREE.ClampToEdgeWrapping;
    for (const sx of [-1, 1]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), signMat);
      s.position.set(sx * 14, 2.6, 0.52);
      this.group.add(s);
    }

    // The gate posts: tall concrete pillars, a floodlight on each, the gantry across with the name
    const postGeos: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      postGeos.push(box(1.6, 8, 1.6, sx * (GATE_HALF + 0.85), 0, 0));
      this.colliders.push({ box: this.collide(sx * (GATE_HALF + 0.85) - 0.8, 0, -0.8, sx * (GATE_HALF + 0.85) + 0.8, 8, 0.8) });
      postGeos.push(box(1.9, 0.3, 1.9, sx * (GATE_HALF + 0.85), 8, 0));
    }
    postGeos.push(box(GATE_HALF * 2 + 3.4, 1.4, 0.9, 0, 8.3, 0));
    const posts = new THREE.Mesh(merge(postGeos), M.darkConcrete);
    worldUVs(posts.geometry, 3);
    this.solid(posts, { occlude: true });
    const logo = new THREE.MeshStandardMaterial({ map: tiling(logoCanvas()), emissive: 0xffffff, emissiveMap: tiling(logoCanvas()), emissiveIntensity: 0.7, roughness: 0.5 });
    for (const t of [logo.map!, logo.emissiveMap!]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    for (const face of [1, -1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.2), logo);
      plate.position.set(0, 9, face * 0.46);
      if (face < 0) plate.rotation.y = Math.PI;
      this.group.add(plate);
    }
    // Floodlight heads on the posts, aimed down at the gate
    const heads: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) heads.push(box(0.9, 0.5, 0.5, sx * (GATE_HALF + 0.85), 8.32, 0.9));
    const headMesh = new THREE.Mesh(merge(heads), M.lamp);
    this.group.add(headMesh);
    for (const sx of [-1, 1]) this.glints.push({ x: sx * (GATE_HALF + 0.85), z: 1.2, y: 8.5, colour: new THREE.Color(0xdde8ff), size: 1.4 });

    // The guard booth inside the gate
    const booth: THREE.BufferGeometry[] = [box(3, 2.6, 2.4, 12.5, 0, -4.5), box(3.4, 0.25, 2.8, 12.5, 2.6, -4.5)];
    const boothMesh = new THREE.Mesh(merge(booth), M.darkConcrete);
    worldUVs(boothMesh.geometry, 3);
    this.solid(boothMesh, { collide: [this.collide(11, 0, -5.7, 14, 2.85, -3.3)], occlude: true });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), new THREE.MeshBasicMaterial({ color: 0x9fc4ff }));
    glow.position.set(12.5, 1.6, -3.29);
    this.group.add(glow);

    // The gate itself: two leaves, hinged at the posts, swinging in
    const left = this.gateLeaf(1);
    const right = this.gateLeaf(-1);
    left.position.set(-GATE_HALF, 0, 0);
    right.position.set(GATE_HALF, 0, 0);
    this.group.add(left, right);
    const collider: Collider = { box: this.collide(-GATE_HALF, 0, -0.3, GATE_HALF, GATE_H, 0.3) };
    this.colliders.push(collider);
    return { left, right, collider, half: GATE_HALF, height: GATE_H };
  }

  /**
   * One leaf of the gate: a steel frame, vertical bars close together, a
   * diagonal brace, wire coiled along the top and a warning plate. Its
   * origin is the hinge; it runs along +X (`dir` 1) or −X from there.
   */
  private gateLeaf(dir: number): THREE.Group {
    const g = new THREE.Group();
    const L = GATE_HALF - 0.05;
    const parts: THREE.BufferGeometry[] = [];
    const bar = (x: number, y: number, w: number, h: number, d = 0.12): void => {
      parts.push(box(w, h, d, dir * x, y, 0));
    };
    bar(0.09, 0, 0.18, GATE_H);
    bar(L - 0.09, 0, 0.18, GATE_H);
    for (const y of [0.15, GATE_H / 2, GATE_H - 0.2]) bar(L / 2, y, L, 0.16);
    for (let x = 0.3; x < L - 0.2; x += 0.22) bar(x, 0.2, 0.05, GATE_H - 0.4, 0.05);
    // The brace, corner to corner
    const brace = new THREE.BoxGeometry(Math.hypot(L, GATE_H / 2) - 0.2, 0.12, 0.1);
    brace.rotateZ(dir * Math.atan2(GATE_H / 2 - 0.3, L));
    brace.translate((dir * L) / 2, GATE_H / 4 + 0.1, 0.06);
    parts.push(brace);
    // Spikes along the top
    for (let x = 0.15; x < L; x += 0.22) {
      const s = new THREE.ConeGeometry(0.035, 0.22, 4);
      s.translate(dir * x, GATE_H + 0.1, 0);
      parts.push(s);
    }
    const mesh = new THREE.Mesh(merge(parts), this.M.darkSteel);
    mesh.castShadow = true;
    mesh.userData.surface = 'metal';
    g.add(mesh);
    const coil = new THREE.Mesh(this.coilGeometry(L), this.M.steel);
    coil.position.set((dir * L) / 2, GATE_H + 0.35, 0);
    coil.castShadow = true;
    g.add(coil);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.8),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(signCanvas(['NO ENTRY', 'USE OF FORCE', 'AUTHORISED'])), roughness: 0.4, side: THREE.DoubleSide })
    );
    (plate.material as THREE.MeshStandardMaterial).map!.colorSpace = THREE.SRGBColorSpace;
    plate.position.set((dir * L) / 2, 2.2, 0.08);
    g.add(plate);
    return g;
  }

  /** A length of razor wire: a coil along X, `len` long, about 0.7 m across. */
  private coilGeometry(len: number): THREE.BufferGeometry {
    const loops = Math.round(len * 3.2);
    const pts: THREE.Vector3[] = [];
    const n = loops * 10;
    for (let i = 0; i <= n; i++) {
      const a = (i / 10) * Math.PI * 2;
      pts.push(V(-len / 2 + (i / n) * len, Math.sin(a) * 0.34, Math.cos(a) * 0.34));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, 0.012, 3, false);
  }

  // ----------------------------------------------------------------- cars

  /** The rows of parked cars: both blocks either side of the drive, about half the bays taken. */
  private parkedCars(): ParkedSlot[] {
    const r = lcg(2024);
    const kinds: CarKind[] = ['sedan', 'sedan', 'hatch', 'suv', 'suv', 'pickup'];
    const out: ParkedSlot[] = [];
    // Each row: its centre line, which way the noses point
    const rows: [number, number][] = [
      [-34, 0], [-40, Math.PI],
      [-78, 0], [-84, Math.PI],
      [-120, 0], [-126, Math.PI],
      [-148, 0], [-154, Math.PI]
    ];
    // The crew fight from behind these bays (see the posts): always taken
    const keep = new Set([-34, -78, -120]);
    for (const [z, yaw] of rows) {
      for (const sx of [-1, 1]) {
        for (let k = 0; k < 19; k++) {
          const x = sx * (15.4 + k * 2.8);
          const forced = keep.has(z) && (k === 0 || k === 2 || k === 4);
          const tight = Math.abs(z) > 140 && Math.abs(x) > 40;
          if (!forced && (r() < 0.45 || tight)) continue;
          out.push({ x: x + (forced ? 0 : (r() - 0.5) * 0.3), z: z + (forced ? 0 : (r() - 0.5) * 0.4), yaw: yaw + (r() - 0.5) * 0.08, kind: kinds[Math.floor(r() * kinds.length)], colour: CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)] });
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- cover

  /**
   * Everything else in the lot to fight from: blast walls and barriers, sandbag
   * nests round the towers, containers, generators, crates, tank traps, the
   * planters along the drive, and the colonnade at the foot of the stairs.
   */
  private buildCover(towers: TowerSite[]): void {
    const M = this.M;
    // ---- Jersey barriers: 3.6 m long, waist high; along the drive and in short runs
    const jersey = (() => {
      const s = new THREE.Shape();
      s.moveTo(-0.32, 0);
      s.lineTo(0.32, 0);
      s.lineTo(0.3, 0.08);
      s.lineTo(0.12, 0.3);
      s.lineTo(0.1, 0.84);
      s.lineTo(-0.1, 0.84);
      s.lineTo(-0.12, 0.3);
      s.lineTo(-0.3, 0.08);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 3.6, bevelEnabled: false });
      g.translate(0, 0, -1.8);
      g.rotateY(Math.PI / 2);
      g.computeVertexNormals();
      worldUVs(g, 2);
      return g;
    })();
    const jerseys: Place[] = [];
    const run = (x: number, z: number, n: number, along: 'x' | 'z'): void => {
      for (let i = 0; i < n; i++) jerseys.push(along === 'x' ? { x: x + i * 3.7, z } : { x, z: z - i * 3.7, ry: Math.PI / 2 });
    };
    // Staggered across the drive further up, for the advance
    run(-5.5, -52, 2, 'x');
    run(2.2, -66, 2, 'x');
    run(-6.5, -98, 2, 'x');
    run(1.8, -108, 2, 'x');
    run(-5.5, -134, 3, 'x');
    run(-3.6, -140.5, 1, 'x');
    run(3.6, -140.5, 1, 'x');
    // Runs flanking the drive between the rows
    for (const sx of [-1, 1]) {
      run(sx * 10.6, -46, 2, 'z');
      run(sx * 10.6, -90, 2, 'z');
      run(sx * 10.6, -132, 2, 'z');
    }
    this.instanced(jersey, M.concrete, jerseys, V(3.6, 0.84, 0.64), {});

    // ---- T-walls: tall blast walls round the towers and by the containers
    const twall = (() => {
      const parts = [box(1.5, 0.35, 1.4, 0, 0, 0), box(1.5, 3.4, 0.32, 0, 0.35, 0.0), box(0.5, 0.25, 0.22, 0, 3.75, 0)];
      const g = merge(parts);
      worldUVs(g, 2);
      return g;
    })();
    const twalls: Place[] = [];
    for (const t of towers) {
      // A short wall of them on the side of each tower facing the gate, a gap to shoot through
      for (const dx of [-4.2, -2.7, 2.7, 4.2]) twalls.push({ x: t.pos.x + dx, z: t.pos.z + 6.5 });
      for (const dz of [-1.5, 0, 1.5]) twalls.push({ x: t.pos.x + Math.sign(-t.pos.x) * 7, z: t.pos.z + dz, ry: Math.PI / 2 });
    }
    // By the gate, where the guards were
    for (const x of [-22, -20.5, 20.5, 22]) twalls.push({ x, z: -9 });
    this.instanced(twall, M.darkConcrete, twalls, V(1.5, 3.85, 0.5), { occlude: true });

    // ---- Sandbag nests: a horseshoe of bags at the foot of each tower, and a couple in the open
    const bagRow = (len: number): THREE.BufferGeometry => {
      const parts: THREE.BufferGeometry[] = [];
      for (let layer = 0; layer < 4; layer++) {
        const off = layer % 2 ? 0.3 : 0;
        for (let x = -len / 2 + 0.3 + off; x < len / 2 - 0.25; x += 0.6) {
          const b = new THREE.SphereGeometry(0.32, 8, 5);
          b.scale(1, 0.42, 0.62);
          b.translate(x, 0.13 + layer * 0.25, 0);
          parts.push(b);
        }
      }
      return merge(parts);
    };
    const bags = bagRow(4.2);
    const nests: Place[] = [];
    for (const t of towers) {
      nests.push({ x: t.pos.x, z: t.pos.z + 3.6 });
      nests.push({ x: t.pos.x - 3.6, z: t.pos.z, ry: Math.PI / 2 });
      nests.push({ x: t.pos.x + 3.6, z: t.pos.z, ry: Math.PI / 2 });
    }
    nests.push({ x: -17, z: -60 }, { x: 18, z: -98 }, { x: -24, z: -138 }, { x: 25, z: -140 });
    this.instanced(bags, M.sandbag, nests, V(4.2, 1.0, 0.7), { surface: 'wood' });

    // ---- Shipping containers: big hard cover in the open, a few stacked two high
    const ctex = tiling(containerCanvas());
    const cmat = new THREE.MeshStandardMaterial({ map: ctex, roughness: 0.5, metalness: 0.5, envMapIntensity: 0.9 });
    const cgeo = box(6.1, 2.6, 2.44, 0, 0, 0);
    {
      const uv = cgeo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i));
    }
    const containers: Place[] = [
      { x: -60, z: -18, colour: 0x6b2a22 },
      { x: -60, z: -18, y: 2.6, colour: 0x2d4a5e },
      { x: -52, z: -14, ry: Math.PI / 2, colour: 0x3e5a35 },
      { x: 58, z: -20, colour: 0x8a6420 },
      { x: 50, z: -14, ry: Math.PI / 2, colour: 0x6b2a22 },
      { x: -58, z: -96, ry: Math.PI / 2, colour: 0x2d4a5e },
      { x: -58, z: -96, ry: Math.PI / 2, y: 2.6, colour: 0x5a5a58 },
      { x: 60, z: -92, ry: Math.PI / 2, colour: 0x3e5a35 },
      { x: -46, z: -164, colour: 0x8a6420 },
      { x: 46, z: -166, colour: 0x6b2a22 },
      { x: 46, z: -166, y: 2.6, colour: 0x2d4a5e }
    ];
    this.instanced(cgeo, cmat, containers, V(6.1, 2.6, 2.44), { occlude: true, surface: 'metal', colours: true });

    // ---- Generators: boxes on skids with a cowl, vents and a fuel cap
    const gen = merge([
      box(2.4, 0.18, 1.3, 0, 0, 0),
      box(2.2, 1.25, 1.15, 0, 0.18, 0),
      box(2.25, 0.12, 1.2, 0, 1.43, 0),
      box(0.12, 0.5, 0.12, 0.8, 1.55, 0.3),
      box(0.6, 0.4, 0.04, -0.6, 0.6, 0.6)
    ]);
    const gens: Place[] = [{ x: -20, z: -12 }, { x: 24.5, z: -47, ry: Math.PI / 2 }, { x: -26, z: -92 }, { x: 22, z: -134 }];
    this.instanced(gen, new THREE.MeshStandardMaterial({ color: 0x5a6a3a, roughness: 0.6, metalness: 0.35 }), gens, V(2.4, 1.55, 1.3), { surface: 'metal' });

    // ---- Crates and pallets: low stacks
    const crate = box(1.2, 1.1, 1.2, 0, 0, 0);
    worldUVs(crate, 1.2);
    const crates: Place[] = [
      { x: -18.5, z: -14 }, { x: -18.5, z: -14, y: 1.1 }, { x: -17.2, z: -15.3 },
      { x: 30, z: -26 }, { x: 31.3, z: -26 }, { x: -48, z: -48 }, { x: -48, z: -49.3 },
      { x: 50, z: -52 }, { x: 16, z: -104 }, { x: 17.3, z: -104 }, { x: -15, z: -142 }, { x: -15, z: -142, y: 1.1 }
    ];
    this.instanced(crate, new THREE.MeshStandardMaterial({ color: 0x6e5a3e, map: tiling(noiseTile(64, [120, 96, 64], { fine: 30 })), roughness: 0.85 }), crates, V(1.2, 1.1, 1.2), { surface: 'wood' });

    // ---- Tank traps: three crossed girders (no colliders, they're see-through, but they block a car)
    const hedge = merge([0, 1, 2].map((i) => {
      const g = new THREE.BoxGeometry(0.14, 1.8, 0.14);
      g.rotateZ(0.95);
      g.rotateY((i * Math.PI) / 3);
      g.translate(0, 0.62, 0);
      return g;
    }));
    const traps: Place[] = [];
    for (let x = -60; x <= 60; x += 6) if (Math.abs(x) > 14) traps.push({ x, z: -6 - (Math.abs(x) % 12 === 0 ? 1.5 : 0), ry: x * 0.7 });
    for (let x = -40; x <= 40; x += 7) if (Math.abs(x) > 16) traps.push({ x, z: -170, ry: x });
    const trapMesh = new THREE.InstancedMesh(hedge, M.darkSteel, traps.length);
    traps.forEach((p, i) => trapMesh.setMatrixAt(i, new THREE.Matrix4().compose(V(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), p.ry ?? 0), V(1, 1, 1))));
    trapMesh.castShadow = true;
    this.group.add(trapMesh);

    // ---- Planters along the drive (the trees go in them; see buildTrees)
    const planter = merge([box(3, 0.95, 3, 0, 0, 0), box(3.2, 0.1, 3.2, 0, 0.95, 0)]);
    worldUVs(planter, 2);
    const planters: Place[] = [];
    for (const z of [-30, -72, -114]) for (const sx of [-1, 1]) planters.push({ x: sx * 11.2, z });
    this.planterSpots = planters.map((p) => V(p.x, 0.95, p.z));
    this.instanced(planter, M.concrete, planters, V(3.2, 1.05, 3.2), {});
    const soil = new THREE.InstancedMesh(box(2.8, 0.02, 2.8, 0, 0.94, 0), new THREE.MeshStandardMaterial({ color: 0x1f1a14, roughness: 0.95 }), planters.length);
    planters.forEach((p, i) => soil.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, 0.0, p.z)));
    this.group.add(soil);

    // ---- The colonnade: square stone columns in a line across the foot of the stairs, a beam along the top
    const cols: THREE.BufferGeometry[] = [];
    for (let k = -4; k <= 4; k++) {
      if (k === 0) continue;
      const x = k * 9 - Math.sign(k) * 0.9;
      cols.push(box(1.8, 7, 1.8, x, 0, -158.5));
      cols.push(box(2.2, 0.5, 2.2, x, 0, -158.5));
      this.colliders.push({ box: this.collide(x - 0.9, 0, -159.4, x + 0.9, 7, -157.6) });
    }
    for (const sx of [-1, 1]) cols.push(box(30, 0.9, 1.4, sx * 23, 7, -158.5));
    const colMesh = new THREE.Mesh(merge(cols), M.stone);
    worldUVs(colMesh.geometry, 4);
    this.solid(colMesh, { occlude: true });

    // ---- Concrete bollards along the drive's edge near the gate
    const bollard = new THREE.CylinderGeometry(0.28, 0.32, 1.05, 10);
    bollard.translate(0, 0.525, 0);
    const bollards: Place[] = [];
    for (const sx of [-1, 1]) for (let z = -8; z > -26; z -= 3.5) bollards.push({ x: sx * 9.6, z });
    this.instanced(bollard, M.concrete, bollards, V(0.6, 1.05, 0.6), {});
  }

  private planterSpots: THREE.Vector3[] = [];

  // ---------------------------------------------------------------- lights

  /** Light poles round the lot, their heads lit, a pool of light on the wet ground under each. */
  private buildPoles(): THREE.MeshStandardMaterial {
    const M = this.M;
    const spots: [number, number][] = [];
    for (const z of [-16, -58, -100, -140]) for (const sx of [-1, 1]) spots.push([sx * 11.6, z]);
    for (const z of [-30, -88, -132]) for (const sx of [-1, 1]) spots.push([sx * 45, z]);
    for (let z = 30; z <= 230; z += 40) for (const sx of [-1, 1]) spots.push([sx * 11.5, z]);
    const pole = merge([
      (() => {
        const g = new THREE.CylinderGeometry(0.1, 0.16, 10, 8);
        g.translate(0, 5, 0);
        return g;
      })(),
      box(0.12, 0.12, 1.8, 0, 9.9, -0.8)
    ]);
    const head = box(0.5, 0.18, 0.9, 0, 9.78, -1.6);
    const poles = new THREE.InstancedMesh(pole, M.darkSteel, spots.length);
    const heads = new THREE.InstancedMesh(head, M.lamp, spots.length);
    const pools = new THREE.InstancedMesh(
      (() => {
        const g = new THREE.PlaneGeometry(1, 1);
        g.rotateX(-Math.PI / 2);
        return g;
      })(),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(poolCanvas()), color: 0x6a7a96, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      spots.length
    );
    spots.forEach(([x, z], i) => {
      // Each arm reaches over the drive or the bays: turned toward the middle of the lot
      const ry = x > 0 ? -Math.PI / 2 : Math.PI / 2;
      const m = new THREE.Matrix4().compose(V(x, 0, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(1, 1, 1));
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      const hx = x + (x > 0 ? -1.6 : 1.6);
      pools.setMatrixAt(i, new THREE.Matrix4().compose(V(hx, 0.02, z), new THREE.Quaternion(), V(17, 1, 17)));
      this.glints.push({ x: hx, z, y: 9.7, colour: new THREE.Color(0xc8d8ff), size: 1 });
      this.colliders.push({ box: this.collide(x - 0.17, 0, z - 0.17, x + 0.17, 10, z + 0.17) });
    });
    poles.castShadow = true;
    this.group.add(poles, heads, pools);
    poles.userData.surface = 'metal';
    this.shootables.push(poles);
    return M.lamp;
  }

  // ---------------------------------------------------------------- trees

  /** Trees: in the planters, along the road outside, along the inside of the side walls. Instanced; the scene sways them. */
  private buildTrees(): HQData['trees'] {
    const at: THREE.Vector3[] = [...this.planterSpots];
    for (let z = 14; z <= 200; z += 15) for (const sx of [-1, 1]) at.push(V(sx * (14.5 + ((z * 7) % 3)), 0, z));
    for (let z = -14; z > -176; z -= 18) for (const sx of [-1, 1]) at.push(V(sx * (LOT_X - 3.2), 0, z - (sx > 0 ? 6 : 0)));
    const r = lcg(31);
    const trunk = new THREE.CylinderGeometry(0.09, 0.17, 4.2, 6);
    trunk.translate(0, 2.1, 0);
    const blobs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const b = new THREE.IcosahedronGeometry(1.1 + r() * 0.5, 1);
      const p = b.getAttribute('position');
      for (let k = 0; k < p.count; k++) {
        const n = 0.82 + r() * 0.36;
        p.setXYZ(k, p.getX(k) * n, p.getY(k) * n * 0.85, p.getZ(k) * n);
      }
      b.translate((r() - 0.5) * 1.8, 4.2 + r() * 1.8, (r() - 0.5) * 1.8);
      blobs.push(b);
    }
    const crown = merge(blobs);
    crown.computeVertexNormals();
    const flutter = { value: 0 };
    const gust = { value: 0 };
    const leaves = new THREE.MeshStandardMaterial({ color: 0x1d2a17, roughness: 0.8, flatShading: true, envMapIntensity: 0.4 });
    leaves.onBeforeCompile = (sh) => {
      sh.uniforms.uFlutter = flutter;
      sh.uniforms.uGust = gust;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uFlutter;\nuniform float uGust;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float hgt = max(0.0, position.y - 3.4);
          transformed.x += sin(uFlutter * 5.3 + position.x * 2.1 + position.y * 1.7) * 0.06 * (0.4 + uGust) * hgt;
          transformed.z += cos(uFlutter * 4.7 + position.z * 2.3 + position.y * 1.3) * 0.06 * (0.4 + uGust) * hgt;`
        );
    };
    leaves.customProgramCacheKey = () => 'hq-leaves';
    const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.9 }), at.length);
    const crowns = new THREE.InstancedMesh(crown, leaves, at.length);
    const list: Sway[] = at.map((p, i) => {
      const s = 0.85 + r() * 0.45;
      const sw: Sway = { index: i, base: p.clone(), scale: s, phase: r() * 10, give: 0.035 + r() * 0.03 };
      const m = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), r() * 6), V(s, s, s));
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      return sw;
    });
    for (const im of [trunks, crowns]) {
      im.castShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      this.group.add(im);
    }
    return { trunks, crowns, list, flutter, gust };
  }

  // ------------------------------------------------------ the headquarters

  /**
   * The podium and its wall with the hole in it, the stairs up to the
   * terrace on piers so there's a way in under them, the black tower on top
   * going up into the cloud, its few lit floors, the red lights up its
   * corners, the name over the doors, searchlights on the roof.
   */
  private buildHeadquarters(): { hole: HQData['hole']; shelter: THREE.Box3; entrance: THREE.PointLight; aviation: THREE.MeshBasicMaterial; beams: THREE.Object3D[] } {
    const M = this.M;
    const H = PODIUM_H;
    // ---- The podium: its front face in three pieces round the hole, the sides and the roof
    const pod: THREE.BufferGeometry[] = [];
    const hx0 = HOLE.x - HOLE.w / 2;
    const hx1 = HOLE.x + HOLE.w / 2;
    const depth = 70;
    pod.push(box(hx0 + PODIUM_X, H, 1.2, (-PODIUM_X + hx0) / 2, 0, PODIUM_Z - 0.6));
    pod.push(box(PODIUM_X - hx1, H, 1.2, (PODIUM_X + hx1) / 2, 0, PODIUM_Z - 0.6));
    pod.push(box(HOLE.w, H - HOLE.h, 1.2, HOLE.x, HOLE.h, PODIUM_Z - 0.6));
    pod.push(box(PODIUM_X * 2, H, depth - 1.2, 0, 0, PODIUM_Z - 1.2 - (depth - 1.2) / 2 - 4.5));
    // A cornice along the front
    pod.push(box(PODIUM_X * 2 + 0.6, 0.6, 1.6, 0, H - 0.6, PODIUM_Z - 0.4));
    const podium = new THREE.Mesh(merge(pod), M.stone);
    worldUVs(podium.geometry, 6);
    this.solid(podium, { occlude: true });
    this.colliders.push({ box: this.collide(-PODIUM_X, 0, PODIUM_Z - 1.2, hx0, H, PODIUM_Z) });
    this.colliders.push({ box: this.collide(hx1, 0, PODIUM_Z - 1.2, PODIUM_X, H, PODIUM_Z) });
    this.colliders.push({ box: this.collide(hx0, HOLE.h, PODIUM_Z - 1.2, hx1, H, PODIUM_Z) });
    this.colliders.push({ box: this.collide(-PODIUM_X, 0, PODIUM_Z - depth - 4, PODIUM_X, H, PODIUM_Z - 5.7) });
    // Behind the hole: a dark space a few metres deep, its back wall, so there's nothing to see through
    const back: THREE.BufferGeometry[] = [box(HOLE.w + 3, 0.2, 4.6, HOLE.x, -0.19, PODIUM_Z - 3.5), box(HOLE.w + 3, 0.3, 4.6, HOLE.x, HOLE.h + 0.6, PODIUM_Z - 3.5)];
    back.push(box(HOLE.w + 3, HOLE.h + 1, 0.3, HOLE.x, 0, PODIUM_Z - 5.8));
    for (const sx of [-1, 1]) back.push(box(0.3, HOLE.h + 1, 4.6, HOLE.x + sx * (HOLE.w / 2 + 1.5), 0, PODIUM_Z - 3.5));
    const voidMesh = new THREE.Mesh(merge(back), M.void);
    this.group.add(voidMesh);
    // The broken edge round the hole: lumps of concrete standing proud, bent rebar
    const r = lcg(66);
    const lumps: THREE.BufferGeometry[] = [];
    const edgePts: [number, number][] = [];
    for (let k = 0; k <= 10; k++) edgePts.push([hx0 + (k / 10) * HOLE.w, HOLE.h + (r() - 0.3) * 0.5]);
    for (let k = 0; k <= 6; k++) edgePts.push([hx0 + (r() - 0.5) * 0.4, (k / 6) * HOLE.h]);
    for (let k = 0; k <= 6; k++) edgePts.push([hx1 + (r() - 0.5) * 0.4, (k / 6) * HOLE.h]);
    for (const [x, y] of edgePts) {
      const l = new THREE.DodecahedronGeometry(0.22 + r() * 0.25, 0);
      l.scale(1, 0.8 + r() * 0.6, 0.7);
      l.rotateX(r() * 3);
      l.rotateY(r() * 3);
      l.translate(x, y, PODIUM_Z + 0.05 - r() * 0.4);
      lumps.push(l);
    }
    // Rubble spilled out in front of it
    for (let k = 0; k < 24; k++) {
      const l = new THREE.DodecahedronGeometry(0.12 + r() * 0.32, 0);
      l.scale(1, 0.6 + r() * 0.5, 1);
      l.rotateY(r() * 3);
      const a = (r() - 0.5) * Math.PI;
      const d = r() * 2.6;
      l.translate(HOLE.x + Math.sin(a) * d * 1.3, 0.08, PODIUM_Z + 0.4 + Math.cos(a) * d);
      lumps.push(l);
    }
    const rubble = new THREE.Mesh(merge(lumps), M.darkConcrete);
    rubble.castShadow = true;
    rubble.receiveShadow = true;
    this.group.add(rubble);
    const rebar: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 9; k++) {
      const x = hx0 + 0.2 + r() * (HOLE.w - 0.4);
      const y = HOLE.h - 0.1 + r() * 0.2;
      const pts = [V(x, y + 0.3, PODIUM_Z - 0.6), V(x + (r() - 0.5) * 0.3, y - 0.2, PODIUM_Z - 0.2), V(x + (r() - 0.5) * 0.6, y - 0.6 - r() * 0.5, PODIUM_Z + 0.2 + r() * 0.3)];
      rebar.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.014, 4, false));
    }
    this.group.add(new THREE.Mesh(merge(rebar), new THREE.MeshStandardMaterial({ color: 0x4a2e22, roughness: 0.7, metalness: 0.5 })));
    // Scorching on the wall round it
    const scorch = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 5.5),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(poolCanvas()), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    );
    scorch.position.set(HOLE.x, HOLE.h * 0.6, PODIUM_Z + 0.01);
    this.group.add(scorch);
    const holeLight = new THREE.PointLight(0xffa860, 14, 16, 1.6);
    holeLight.position.set(HOLE.x + 2.6, HOLE.h + 0.9, PODIUM_Z + 1.4);
    this.group.add(holeLight);
    const lamp = new THREE.Group();
    lamp.position.set(HOLE.x + 2.6, HOLE.h + 1.25, PODIUM_Z + 0.35);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.24, 8), M.darkSteel);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd6a0 }));
    bulb.position.y = -0.1;
    const flex = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.9, 4), M.darkSteel);
    flex.position.set(0.1, 0.4, -0.15);
    flex.rotation.x = 0.4;
    lamp.add(cage, bulb, flex);
    lamp.rotation.z = 0.35;
    this.group.add(lamp);

    // ---- The stairs: steps on a slab, the slab on piers
    const steps: THREE.BufferGeometry[] = [];
    for (let i = 0; i < STAIR_STEPS; i++) {
      const top = (i + 1) * STAIR_RISE;
      const z1 = STAIR_FOOT - i * STAIR_RUN;
      const z0 = z1 - STAIR_RUN;
      const bottom = Math.max(0, top - SLAB);
      steps.push(box(STAIR_X * 2, top - bottom, STAIR_RUN, 0, bottom, (z0 + z1) / 2));
      this.colliders.push({ box: this.collide(-STAIR_X, bottom, z0, STAIR_X, top, z1) });
    }
    // Nosing strips: a lighter edge on every tread
    const nosing: THREE.BufferGeometry[] = [];
    for (let i = 0; i < STAIR_STEPS; i++) nosing.push(box(STAIR_X * 2, 0.012, 0.06, 0, (i + 1) * STAIR_RISE, STAIR_FOOT - i * STAIR_RUN - 0.03));
    const stairMesh = new THREE.Mesh(merge(steps), M.stone);
    worldUVs(stairMesh.geometry, 3);
    this.solid(stairMesh, { occlude: true });
    this.group.add(new THREE.Mesh(merge(nosing), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.4 })));
    // Piers, and a beam under the slab along each line of them
    const piers: THREE.BufferGeometry[] = [];
    const pierXs = [-STAIR_X + 0.6, 5.2, STAIR_X - 0.6];
    for (const x of pierXs) {
      for (const z of [-172, -178.5, -185]) {
        const under = (STAIR_FOOT - z) / STAIR_RUN * STAIR_RISE - SLAB + STAIR_RISE;
        piers.push(box(0.9, under, 0.9, x, 0, z));
        this.colliders.push({ box: this.collide(x - 0.45, 0, z - 0.45, x + 0.45, under, z + 0.45) });
      }
    }
    const pierMesh = new THREE.Mesh(merge(piers), M.stone);
    worldUVs(pierMesh.geometry, 3);
    this.solid(pierMesh, { occlude: true });
    // Balustrades up both sides: posts and a rail
    const rail: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (let i = 0; i < STAIR_STEPS; i += 4) {
        const z = STAIR_FOOT - i * STAIR_RUN - 0.2;
        rail.push(box(0.08, 1.05, 0.08, sx * (STAIR_X - 0.2), (i + 1) * STAIR_RISE, z));
      }
      const len = Math.hypot(STAIR_STEPS * STAIR_RUN, H);
      const g = new THREE.BoxGeometry(0.1, 0.08, len);
      g.rotateX(Math.atan2(H, STAIR_STEPS * STAIR_RUN));
      g.translate(sx * (STAIR_X - 0.2), H / 2 + 1.05, (STAIR_FOOT + PODIUM_Z) / 2);
      rail.push(g);
    }
    this.group.add(new THREE.Mesh(merge(rail), M.steel));
    // Under the stairs is out of the rain
    const shelter = new THREE.Box3(V(-STAIR_X, -1, PODIUM_Z - 1), V(STAIR_X, 4.5, -173));

    // ---- The terrace on the podium, the tower on it
    const tc = towerCanvases();
    const map = tiling(tc.map);
    const glow = tiling(tc.glow);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 1.6, roughness: 0.22, metalness: 0.85, envMapIntensity: 1.4 });
    const tower = new THREE.BoxGeometry(TOWER_HALF * 2, TOWER_H, TOWER_HALF * 2);
    tower.translate(TOWER_X, H + TOWER_H / 2, TOWER_Z);
    {
      // Each face: across it u 0..1, up it v 0..1 (the canvas holds the whole height)
      const p = tower.getAttribute('position');
      const n = tower.getAttribute('normal');
      const uv = tower.getAttribute('uv');
      for (let i = 0; i < p.count; i++) {
        const v = (p.getY(i) - H) / TOWER_H;
        const across = Math.abs(n.getX(i)) > 0.5 ? (p.getZ(i) - TOWER_Z) / (TOWER_HALF * 2) + 0.5 : (p.getX(i) - TOWER_X) / (TOWER_HALF * 2) + 0.5;
        uv.setXY(i, across, v);
      }
    }
    const towerMesh = new THREE.Mesh(tower, towerMat);
    towerMesh.name = 'skyscraper';
    towerMesh.receiveShadow = true;
    this.group.add(towerMesh);
    // Vertical fins up the front, catching the lightning
    const fins: THREE.BufferGeometry[] = [];
    for (let k = -6; k <= 6; k++) fins.push(box(0.35, TOWER_H - 6, 0.9, TOWER_X + k * 4.15, H + 6, TOWER_Z + TOWER_HALF + 0.45));
    for (let k = -6; k <= 6; k++) fins.push(box(0.9, TOWER_H - 6, 0.35, TOWER_X + TOWER_HALF + 0.45, H + 6, TOWER_Z + k * 4.15));
    for (let k = -6; k <= 6; k++) fins.push(box(0.9, TOWER_H - 6, 0.35, TOWER_X - TOWER_HALF - 0.45, H + 6, TOWER_Z + k * 4.15));
    this.group.add(new THREE.Mesh(merge(fins), new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.3, metalness: 0.9, envMapIntensity: 1.2 })));
    // The lobby: tall glass doors at the head of the stairs, a canopy over them, cold light inside
    const lobby = new THREE.Mesh(new THREE.PlaneGeometry(16, 6.5), new THREE.MeshStandardMaterial({ color: 0x0c1218, emissive: 0x6f8fb8, emissiveIntensity: 0.55, roughness: 0.1, metalness: 0.6 }));
    lobby.position.set(0, H + 3.25, TOWER_Z + TOWER_HALF + 0.02);
    this.group.add(lobby);
    const mull: THREE.BufferGeometry[] = [];
    for (let k = -4; k <= 4; k++) mull.push(box(0.12, 6.5, 0.12, k * 2, H, TOWER_Z + TOWER_HALF + 0.06));
    mull.push(box(16.4, 0.15, 0.15, 0, H + 3.3, TOWER_Z + TOWER_HALF + 0.06));
    mull.push(box(20, 0.45, 5, 0, H + 7, TOWER_Z + TOWER_HALF + 2.5));
    this.group.add(new THREE.Mesh(merge(mull), M.darkSteel));
    // The name, big and red, over the doors
    const logoMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tiling(logoCanvas()), emissiveIntensity: 2.2, roughness: 0.3 });
    logoMat.emissiveMap!.wrapS = logoMat.emissiveMap!.wrapT = THREE.ClampToEdgeWrapping;
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), logoMat);
    logo.position.set(0, H + 22, TOWER_Z + TOWER_HALF + 1.0);
    this.group.add(logo);
    const entrance = new THREE.PointLight(0x8fb2ff, 40, 34, 2);
    entrance.position.set(0, H + 5, TOWER_Z + TOWER_HALF + 6);
    this.group.add(entrance);
    // Red aviation lights up the corners, into the cloud
    const aviation = new THREE.MeshBasicMaterial({ color: 0xff2010, fog: false, toneMapped: false });
    const red = new THREE.SphereGeometry(0.5, 8, 6);
    const reds: THREE.BufferGeometry[] = [];
    for (let y = H + 30; y < 300; y += 34) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const g = red.clone();
        g.translate(TOWER_X + sx * (TOWER_HALF + 0.6), y, TOWER_Z + sz * (TOWER_HALF + 0.6));
        reds.push(g);
      }
    }
    this.group.add(new THREE.Mesh(merge(reds), aviation));
    // The doors on the podium's face either side, where they come out from
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x101418, emissive: 0xbfd2ff, emissiveIntensity: 0.9 });
    for (const sx of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.4), doorMat);
      d.position.set(sx * 30, 1.7, PODIUM_Z + 0.02);
      this.group.add(d);
      const hood = new THREE.Mesh(box(5, 0.25, 1.4, sx * 30, 3.6, PODIUM_Z + 0.7), M.darkSteel);
      this.group.add(hood);
      this.glints.push({ x: sx * 30, z: PODIUM_Z + 1.5, y: 1.9, colour: new THREE.Color(0xbfd2ff), size: 2.2 });
    }
    // Searchlights on the podium roof, sweeping the cloud
    const beamGeo = new THREE.CylinderGeometry(4, 0.4, 150, 16, 1, true);
    beamGeo.translate(0, 75, 0);
    const beamMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `varying float vY; void main(){ vY = position.y / 150.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vY; void main(){ gl_FragColor = vec4(0.75, 0.82, 1.0, 0.07 * (1.0 - vY) * (1.0 - vY)); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const beams: THREE.Object3D[] = [];
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(beamGeo, beamMat);
      b.position.set(sx * 44, H + 0.5, PODIUM_Z - 4);
      b.frustumCulled = false;
      this.group.add(b);
      beams.push(b);
    }
    // The terrace's parapet either side of the stairs
    const parapet: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) parapet.push(box(PODIUM_X - STAIR_X, 1.1, 0.4, sx * (STAIR_X + (PODIUM_X - STAIR_X) / 2), H, PODIUM_Z - 0.3));
    const par = new THREE.Mesh(merge(parapet), M.stone);
    this.solid(par, { shoot: true });

    const centre = V(HOLE.x, 0, PODIUM_Z + 0.3);
    return {
      hole: {
        centre,
        trigger: new THREE.Box3(V(hx0 + 0.2, -1, PODIUM_Z - 1.6), V(hx1 - 0.2, 3, PODIUM_Z + 0.8)),
        light: holeLight,
        spark: V(hx1 - 0.3, HOLE.h - 0.2, PODIUM_Z + 0.1)
      },
      shelter,
      entrance,
      aviation,
      beams
    };
  }

  // ------------------------------------------------------------- the city

  /** The city round about: dark blocks with a scatter of lit windows, fading into the rain. */
  private buildCity(): void {
    const r = lcg(404);
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 90; i++) {
      const a = r() * Math.PI * 2;
      const d = 320 + r() * 900;
      const x = Math.cos(a) * d;
      const z = -120 + Math.sin(a) * d;
      const w = 20 + r() * 40;
      const dpt = 20 + r() * 40;
      const h = 25 + r() * r() * 160;
      const g = box(w, h, dpt, x, 0, z, 0);
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      const uv = g.getAttribute('uv');
      for (let k = 0; k < p.count; k++) {
        const across = Math.abs(n.getX(k)) > 0.5 ? p.getZ(k) : p.getX(k);
        uv.setXY(k, across / 32, p.getY(k) / 32);
      }
      geos.push(g);
    }
    const tex = tiling(skylineCanvas());
    const city = new THREE.Mesh(merge(geos), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.8, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, map: tex }));
    city.name = 'city';
    this.group.add(city);
  }

  // ------------------------------------------------------------ reflections

  /**
   * The lights on the wet ground: a streak under every lamp, stretched
   * toward whoever's looking (they're turned in the vertex shader), the way
   * a light on wet tarmac smears down toward you.
   */
  private buildGlints(): void {
    const n = this.glints.length;
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    const at = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    this.glints.forEach((l, i) => {
      at.set([l.x, l.z, l.y, l.size], i * 4);
      col.set([l.colour.r, l.colour.g, l.colour.b], i * 3);
    });
    g.setAttribute('aAt', new THREE.InstancedBufferAttribute(at, 4));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uBright: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 aAt;
        attribute vec3 aCol;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          vec3 base = vec3(aAt.x, 0.015, aAt.y);
          vec3 cam = cameraPosition;
          vec2 toCam = cam.xz - base.xz;
          float d = length(toCam);
          vec2 f = toCam / max(d, 0.001);
          vec2 side = vec2(-f.y, f.x);
          // The streak runs from under the lamp toward the eye; longer the higher the lamp
          float len = min(d * 0.85, aAt.z * 1.6 + 2.0) * clamp(2.4 / max(cam.y, 0.1), 0.12, 1.0);
          float w = aAt.w * 0.55;
          vec3 p = base + vec3(side.x, 0.0, side.y) * position.x * w + vec3(f.x, 0.0, f.y) * position.y * len;
          vUv = vec2(position.x, position.y);
          vCol = aCol;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uBright;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          float across = 1.0 - smoothstep(0.0, 0.5, abs(vUv.x));
          float along = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
          gl_FragColor = vec4(vCol * across * along * 0.55 * uBright, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.name = 'glints';
    mesh.renderOrder = 3;
    this.group.add(mesh);
  }

  /** The little world the reflections are baked from: a dark sky, the city glow low down, a few lamps. */
  private buildEnv(): void {
    const s = this.envScene;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 top = vec3(0.035, 0.04, 0.055); vec3 hor = vec3(0.12, 0.11, 0.12); vec3 low = vec3(0.02, 0.02, 0.025); vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.5)) : mix(hor, low, pow(-h, 0.4)); gl_FragColor = vec4(c, 1.0); }`
      })
    );
    s.add(sky);
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdde8ff).multiplyScalar(6) });
    const r = lcg(3);
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), lamp);
      m.position.set(Math.cos(a) * 30, 12 + r() * 10, Math.sin(a) * 30);
      s.add(m);
    }
    const city = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb070).multiplyScalar(0.6) });
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(2 + r() * 4, 0.6 + r() * 2, 0.5), city);
      m.position.set(Math.cos(a) * 46, 1 + r() * 4, Math.sin(a) * 46);
      m.lookAt(0, m.position.y, 0);
      s.add(m);
    }
  }

  // ------------------------------------------------------------ waypoints

  /** A grid over the lot, every 7 m, minus anywhere something stands; linked to its clear neighbours. */
  private waypointGrid(parked: ParkedSlot[], towers: TowerSite[]): Waypoint[] {
    const step = 7;
    const blocked = (x: number, z: number): boolean => {
      for (const c of this.colliders) {
        const b = c.box;
        if (b.max.y < 0.2 || b.min.y > 1.6) continue;
        if (x > b.min.x - 0.7 && x < b.max.x + 0.7 && z > b.min.z - 0.7 && z < b.max.z + 0.7) return true;
      }
      for (const p of parked) if (Math.abs(x - p.x) < 1.6 && Math.abs(z - p.z) < 3) return true;
      for (const t of towers) if (Math.hypot(x - t.pos.x, z - t.pos.z) < 3.2) return true;
      return false;
    };
    const nodes: Waypoint[] = [];
    const index = new Map<string, number>();
    for (let gx = -10; gx <= 10; gx++) {
      for (let gz = 1; gz <= 25; gz++) {
        const x = gx * step;
        const z = -gz * step;
        if (Math.abs(x) > LOT_X - 2 || z < LOT_Z + 2 || blocked(x, z)) continue;
        index.set(`${gx}:${gz}`, nodes.length);
        nodes.push({ pos: V(x, 0, z), links: [] });
      }
    }
    for (const [key, i] of index) {
      const [gx, gz] = key.split(':').map(Number);
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const j = index.get(`${gx + dx}:${gz + dz}`);
        if (j === undefined) continue;
        const a = nodes[i].pos;
        const b = nodes[j].pos;
        let clear = true;
        for (let k = 1; k < 6 && clear; k++) {
          const t = k / 6;
          if (blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) clear = false;
        }
        if (!clear) continue;
        nodes[i].links.push(j);
        nodes[j].links.push(i);
      }
    }
    return nodes;
  }
}
