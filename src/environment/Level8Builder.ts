import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Collider } from './OfficeLevelBuilder';
import { mergeStatic } from './mergeStatic';
import type { CarKind, Level8Data, ParkedSlot, PileSlot } from '../scenes/Level8Contracts';

// ---------------------------------------------------------------- the lot
//
// Level 7's frame, brought down to the ground: x runs east, z runs SOUTH, y
// is up and the asphalt is y = 0 (the player's fall reset, the particle
// floor test and the warm-up's parking spot under the floor all assume the
// ground sits there — Level 7's view of this lot sat 26.4 m below its floor,
// and none of that height is copied). The office tower Ravi came down is to
// the east, its west face on x = 0; the car park runs west from it to the
// gate and the road beyond; the rows of bays lie north to south either side
// of the drive lane that runs straight from Stairwell B's door to the gate.

export const L8 = {
  lot: { x0: -100, x1: -4, z0: -18, z1: 42 },
  /** The concrete footpath along the building: x −4..0. */
  apronX: -4,
  lane: { z0: 9, z1: 15 },
  /** The west face: nine storeys of 3.3 m, a parapet, and the building 32 m deep behind it. */
  facade: { z0: -8, z1: 34, depth: 32, floors: 9, storey: 3.3, skin: 0.3, parapet: 1.8 },
  /** Two long windows a floor, the same z spans Level 7's office looked out through. */
  windows: [[2.2, 9.6], [13.2, 21.8]] as [number, number][],
  sill: 0.8,
  head: 2.6,
  /** Stairwell B: the steel door in the pier between the windows. */
  door: { z: 12, w: 1.1, h: 2.2 },
  gate: { z0: 6, z1: 18 },
  fenceH: 2.2,
  road: { x: -108, w: 12 },
  /** Bay pitch, and the centre of the first bay of each block (eight bays a block). */
  pitch: 2.8,
  north: { first: -14.6, n: 8 },
  south: { first: 18.0, n: 8 },
  zone: { minX: -99, maxX: -83, minZ: -16, maxZ: 40 }
} as const;

/** The middle of things: where the sky is centred and the sun aims. */
const LOT_CENTRE = new THREE.Vector3(-50, 0, 12);

/**
 * Toward the sun: low in the east, a little south of it, about 25° up — the
 * morning after the raid. Behind the building, so its west face is in shade
 * and everything Ravi looks at down the lot (the General included) has the
 * light on its front.
 */
const SUN_DIR = new THREE.Vector3(0.84, 0.42, 0.34).normalize();

/** Everything the scene needs to set itself for this level's daylight. */
export const LEVEL8_ATMOSPHERE = {
  background: 0x9fbbd8,
  /** Optional haze toward the horizon; the sky and the sun are unfogged. */
  fog: { color: 0xd0cfc4, near: 150, far: 560 },
  /** Far enough to see the inside of the sky sphere from anywhere in the lot. */
  cameraFar: 600
} as const;

const WEST = Math.PI / 2; // yaw facing −X
const EAST = -Math.PI / 2; // yaw facing +X
/** How far the stairwell door swings: negative, so it opens out to the west. */
const DOOR_OPEN = -1.9;

/** Single rows, and the back-to-back pairs as [east, west]: in a pair each car faces its own aisle. */
const SINGLES = [-14, -80];
const PAIRS: [number, number][] = [[-26, -31], [-45, -50], [-64, -69]];
const ROWS: { x: number; face: 1 | -1 | 0 }[] = [
  { x: -14, face: 0 },
  { x: -26, face: 1 },
  { x: -31, face: -1 },
  { x: -45, face: 1 },
  { x: -50, face: -1 },
  { x: -64, face: 1 },
  { x: -69, face: -1 },
  { x: -80, face: 0 }
];
/** Bays are 4.8 m deep: the painted lines run 2.4 m either side of a row's centre. */
const BAY_HALF = 2.4;
/** Where the aisles run between the rows, for the arrows painted down them. */
const AISLES = [-7.8, -20, -38, -57, -74.5];

/**
 * How long each kind of car is, near enough. Only used to keep two cars in
 * a back-to-back pair from meeting tail to tail: the real dimensions are
 * VehicleProps' (CAR_SPECS), and these are a little generous on purpose.
 */
const NOMINAL_LENGTH: Record<CarKind, number> = { sedan: 4.75, hatch: 4.15, suv: 4.85, pickup: 5.45 };
/** Gap left between the tails of a back-to-back pair. */
const PAIR_GAP = 0.35;

/** Paints for the parked cars: the greys, whites and dark blues of any staff car park, and a red or two. */
const PAINT = [
  0xb8bcc0, 0x2a2c30, 0xe6e6e2, 0x7a1c1c, 0x1d3a6a, 0x5d6268, 0x4a5a3a, 0xc8b28a, 0x9a9da2, 0x101214, 0x8c2f24, 0x3b5f7d
];

/** Kerbed islands at the ends of the rows: where the trees and the lamp posts stand. */
interface Island {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  tree?: number;
  lamp?: number;
}
const N_ISLAND = { z0: 6.65, z1: 8.75 }; // between the last north bay line (6.4) and the lane (9)
const S_ISLAND = { z0: 39.25, z1: 41.35 }; // past the last south bay line (39.0), short of the fence
const ISLANDS: Island[] = [
  { x0: -16.4, x1: -11.6, ...N_ISLAND, lamp: -14 },
  { x0: -33.4, x1: -23.6, ...N_ISLAND, tree: -30.8, lamp: -26.2 },
  { x0: -52.4, x1: -42.6, ...N_ISLAND, tree: -49.8, lamp: -45.2 },
  { x0: -71.4, x1: -61.6, ...N_ISLAND, tree: -68.8, lamp: -64.2 },
  // Lamp only: a crown here would sit in the reveal shots of the General
  { x0: -82.4, x1: -77.6, ...N_ISLAND, lamp: -80 },
  { x0: -16.4, x1: -11.6, ...S_ISLAND, tree: -14 },
  { x0: -33.4, x1: -23.6, ...S_ISLAND, tree: -28.5, lamp: -32.4 },
  { x0: -52.4, x1: -42.6, ...S_ISLAND, tree: -47.5, lamp: -51.4 },
  { x0: -71.4, x1: -61.6, ...S_ISLAND, tree: -66.5 }
];

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** The same seeded generator every level uses, so the lot is laid out the same way every attempt. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** Bay centres along one block. */
function bayCentres(b: { first: number; n: number }): number[] {
  return Array.from({ length: b.n }, (_, k) => b.first + L8.pitch * k);
}

/** The painted lines between them: one more than there are bays. */
function bayLines(b: { first: number; n: number }): number[] {
  return Array.from({ length: b.n + 1 }, (_, k) => b.first - L8.pitch / 2 + L8.pitch * k);
}

// ---------------------------------------------------------------- the cars

/**
 * Who parked where this morning. About three bays in five taken, seeded so
 * the cover is the same every attempt; yaw exactly ±π/2 (their colliders are
 * axis-aligned boxes, and a few hundredths of a radian of jitter is enough to
 * close the squeeze between two of them); nothing in the lane; and the bays
 * nearest the boss's saloon and the Civic left empty, so the getaways have
 * room and the shots of them are clear.
 */
function parkedSlots(): ParkedSlot[] {
  const rnd = lcg(808);
  const TAKEN = 0.6;
  const kind = (): CarKind => {
    const r = rnd();
    return r < 0.45 ? 'sedan' : r < 0.7 ? 'hatch' : r < 0.9 ? 'suv' : 'pickup';
  };
  const paint = (): number => PAINT[Math.floor(rnd() * PAINT.length) % PAINT.length];
  // Row −80's southern bays sit right by the boss's car (z 26) and the Civic (z 37)
  const keepFree = (x: number, z: number): boolean => x === -80 && z > 22;
  const out: ParkedSlot[] = [];
  for (const z of [...bayCentres(L8.north), ...bayCentres(L8.south)]) {
    for (const x of SINGLES) {
      const take = rnd() < TAKEN;
      const yaw = rnd() < 0.5 ? WEST : EAST;
      const k = kind();
      const c = paint();
      if (take && !keepFree(x, z)) out.push({ x, z, yaw, kind: k, colour: c });
    }
    for (const [e, w] of PAIRS) {
      const takeE = rnd() < TAKEN;
      const takeW = rnd() < TAKEN;
      const kE = kind();
      const kW = kind();
      const cE = paint();
      const cW = paint();
      // Nose out to their own aisles, tails together: if two long ones would
      // meet in the middle, each is pulled forward by half the overlap
      let push = 0;
      if (takeE && takeW) {
        const need = (NOMINAL_LENGTH[kE] + NOMINAL_LENGTH[kW]) / 2 + PAIR_GAP;
        push = Math.max(0, need - (e - w)) / 2;
      }
      if (takeE) out.push({ x: e + push, z, yaw: EAST, kind: kE, colour: cE });
      if (takeW) out.push({ x: w - push, z, yaw: WEST, kind: kW, colour: cW });
    }
  }
  return out;
}

/**
 * The General's scrap pile, hard by the gate's north post: twelve crushed
 * wrecks in six stacks, up to three high, the upper ones turned a little
 * askew on the ones below. They lie across the lot (length along x) in three
 * rows north to south, two stacks end to end in each, so the heap fills
 * x −99..−89.6, z −1.9..5.5: close enough to his reveal at (−89, 9.5) that
 * the nearest wrecks are a stride or two away, and its south face stops short
 * of the gateway (z 6..18) so the getaways have the whole gap.
 *
 * End to end in a row the two stacks leave 0.4 m between them, which only
 * works if the pair at each height are short enough between them (a
 * suv/sedan with a hatch, a pickup only where the south row is moved west to
 * make room); the rows are 2.5 m apart, enough for a little yaw.
 *
 * Each wreck is about 1.1 m high crushed. They are placed a hair apart and
 * lifted for their roll (a wreck rolled about its own length drops one edge
 * by half its width times the sine), so CarSystem.settle() only ever drops
 * them a few centimetres onto each other — never starts them overlapping,
 * which would blow the pile apart on the first physics step.
 */
function pileSlots(): PileSlot[] {
  const CRUSHED = 1.1;
  const HALF_W = 0.97;
  const A = Math.PI / 2;
  const stacks: { x: number; z: number; cars: { kind: CarKind; yaw: number; roll: number }[] }[] = [
    // North row: three high at the fence end, the top of the heap
    {
      x: -96.65,
      z: -0.7,
      cars: [
        { kind: 'suv', yaw: A + 0.03, roll: 0.03 },
        { kind: 'sedan', yaw: -A - 0.07, roll: -0.08 },
        { kind: 'hatch', yaw: A + 0.14, roll: 0.11 }
      ]
    },
    {
      x: -91.7,
      z: -0.7,
      cars: [
        { kind: 'hatch', yaw: -A + 0.04, roll: -0.05 },
        { kind: 'hatch', yaw: A - 0.08, roll: 0.09 }
      ]
    },
    // Middle row
    {
      x: -96.65,
      z: 1.8,
      cars: [
        { kind: 'sedan', yaw: -A - 0.03, roll: 0.04 },
        { kind: 'hatch', yaw: A + 0.08, roll: -0.1 }
      ]
    },
    {
      x: -91.7,
      z: 1.8,
      cars: [
        { kind: 'hatch', yaw: A + 0.02, roll: 0.06 },
        { kind: 'sedan', yaw: -A + 0.07, roll: -0.12 }
      ]
    },
    // South row, nearest the lane and the gate: an old pickup on its own by
    // the post, and two by the end he reaches for first
    { x: -96.95, z: 4.3, cars: [{ kind: 'pickup', yaw: -A + 0.03, roll: 0.05 }] },
    {
      x: -91.7,
      z: 4.3,
      cars: [
        { kind: 'hatch', yaw: A - 0.03, roll: -0.04 },
        { kind: 'suv', yaw: -A + 0.06, roll: 0.07 }
      ]
    }
  ];
  const out: PileSlot[] = [];
  for (const s of stacks) {
    let y = 0;
    let below = 0;
    s.cars.forEach((c, i) => {
      const dip = HALF_W * Math.sin(Math.abs(c.roll));
      y = i === 0 ? dip + 0.02 : y + CRUSHED + below + dip + 0.03;
      below = dip;
      out.push({ pos: V(s.x, y, s.z), yaw: c.yaw, roll: c.roll, kind: c.kind });
    });
  }
  return out;
}

// ---------------------------------------------------------------- geometry

type V3 = [number, number, number];
type RGBA = [number, number, number, number];
const WHITE: RGBA = [1, 1, 1, 1];
const UP: V3 = [0, 1, 0];

/** A colour from a hex, as vertex-colour floats (linear, the way three reads them). */
function rgba(hex: number, a = 1): RGBA {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b, a];
}

/**
 * Flat polygons gathered into one geometry: the ground, the paint on it,
 * the glass, the fence's mesh. Built straight into one buffer, there is
 * nothing to merge afterwards — the painted lines alone are a few hundred
 * quads, which as meshes would have been a few hundred draws.
 */
class Batch {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  get empty(): boolean {
    return this.idx.length === 0;
  }

  /** A convex polygon, fanned from its first corner. `want` turns it to face that way. */
  poly(pts: V3[], uvs: [number, number][], c: RGBA = WHITE, want?: V3): void {
    const [a, b, d] = pts;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const flip = want ? nx * want[0] + ny * want[1] + nz * want[2] < 0 : false;
    if (flip) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const base = this.pos.length / 3;
    pts.forEach((p, i) => {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(c[0], c[1], c[2], c[3]);
    });
    for (let i = 1; i < pts.length - 1; i++) {
      if (flip) this.idx.push(base, base + i + 1, base + i);
      else this.idx.push(base, base + i, base + i + 1);
    }
  }

  /** A level rectangle facing up, its texture laid in metres so every piece of the same stuff lines up. */
  rect(x0: number, x1: number, z0: number, z1: number, y: number, tile: number, c: RGBA = WHITE): void {
    this.poly(
      [[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]],
      [[x0 / tile, -z0 / tile], [x0 / tile, -z1 / tile], [x1 / tile, -z1 / tile], [x1 / tile, -z0 / tile]],
      c,
      UP
    );
  }

  /** A painted stroke on the ground from a to b. */
  strip(ax: number, az: number, bx: number, bz: number, w: number, y: number, c: RGBA): void {
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const px = (-(bz - az) / l) * (w / 2);
    const pz = ((bx - ax) / l) * (w / 2);
    this.poly(
      [[ax + px, y, az + pz], [bx + px, y, bz + pz], [bx - px, y, bz - pz], [ax - px, y, az - pz]],
      [[0, 0], [0, 0], [0, 0], [0, 0]],
      c,
      UP
    );
  }

  /** A quad lying on the ground, corners given round it, mapped onto part of a texture. */
  flatQuad(pts: [number, number][], y: number, uvs: [number, number][], c: RGBA): void {
    this.poly(pts.map(([x, z]) => [x, y, z] as V3), uvs, c, UP);
  }

  geometry(colours: 'none' | 'rgb' | 'rgba'): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (colours === 'rgba') g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    else if (colours === 'rgb') {
      const c: number[] = [];
      for (let i = 0; i < this.col.length; i += 4) c.push(this.col[i], this.col[i + 1], this.col[i + 2]);
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    }
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * Lay a box's texture in world metres, face by face, so walls of every size
 * share one material without the texture stretching across the big ones.
 * The box has already been moved into place.
 */
function planarUVs(geo: THREE.BufferGeometry, tile: number): void {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (ax > 0.5) uv.setXY(i, z / tile, y / tile);
    else if (ay > 0.5) uv.setXY(i, x / tile, z / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
}

/**
 * Bake light into vertex colours, for the unlit far scenery: it costs
 * nothing per light and never recompiles, and with a little of the sun in
 * it a box still reads as a solid thing standing in daylight.
 */
function bakeShade(geo: THREE.BufferGeometry, shade: (nx: number, ny: number, nz: number) => number, tint: [number, number, number] = [1, 1, 1]): void {
  const n = geo.attributes.normal;
  const c = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const s = shade(n.getX(i), n.getY(i), n.getZ(i));
    c[i * 3] = tint[0] * s;
    c[i * 3 + 1] = tint[1] * s;
    c[i * 3 + 2] = tint[2] * s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

/** Sky above, the sun from the east: the shading for anything that never turns. */
const sunShade = (nx: number, ny: number, nz: number): number =>
  0.56 + 0.44 * Math.max(0, nx * SUN_DIR.x + ny * SUN_DIR.y + nz * SUN_DIR.z) + 0.1 * ny;
/** For the backdrop cars, which face both ways: the same either side, so turning one round can't light its shady flank. */
const carShade = (nx: number, ny: number, nz: number): number =>
  ny > 0.5 ? 1 : ny < -0.5 ? 0.4 : 0.72 + 0.12 * Math.abs(nz) + 0.08 * Math.max(0, ny);

function linear(hex: number): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

// ---------------------------------------------------------------- textures

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Repeat-wrapped, mipmapped and filtered smooth: at foot height Nearest turns asphalt into a mosaic. */
function tiling(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function once(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * A seamless noise tile: grain at the pixel, and soft patches wrapped round
 * the edges so the tile repeats without a seam — the patches are what keep
 * a big plain area from looking like a carpet of the same 5 m square.
 */
function noiseTile(
  size: number,
  base: [number, number, number],
  o: { fine: number; blobs?: number; blobAmp?: number; tint?: [number, number, number]; specks?: number; speckAmp?: number }
): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const d = img.data;
  const low = new Float32Array(size * size);
  for (let b = 0; b < (o.blobs ?? 0); b++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const r = size * (0.06 + Math.random() * 0.18);
    const a = (Math.random() - 0.5) * 2 * (o.blobAmp ?? 0);
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const q = ((x - cx) * (x - cx) + (y - cy) * (y - cy)) / r2;
        if (q >= 1) continue;
        const wx = ((x % size) + size) % size;
        const wy = ((y % size) + size) % size;
        low[wy * size + wx] += a * (1 - q) * (1 - q);
      }
    }
  }
  const tint = o.tint ?? [1, 1, 1];
  for (let i = 0; i < size * size; i++) {
    let v = (Math.random() - 0.5) * o.fine;
    if (o.specks && Math.random() < o.specks) v += (Math.random() - 0.35) * (o.speckAmp ?? 30);
    const l = low[i];
    d[i * 4] = base[0] + v + l * tint[0];
    d[i * 4 + 1] = base[1] + v + l * tint[1];
    d[i * 4 + 2] = base[2] + v + l * tint[2];
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Worn asphalt: grey grain, lighter chips of aggregate, darker patches, the odd hairline crack. */
function asphaltCanvas(): HTMLCanvasElement {
  const c = noiseTile(512, [99, 102, 106], { fine: 16, blobs: 30, blobAmp: 9, specks: 0.022, speckAmp: 46 });
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(38,40,43,0.55)';
  g.lineWidth = 1.4;
  for (let i = 0; i < 5; i++) {
    // Kept off the edges: a crack that ran over one would end in a seam
    let x = 70 + Math.random() * 370;
    let y = 70 + Math.random() * 370;
    let a = Math.random() * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 14; s++) {
      a += (Math.random() - 0.5) * 0.9;
      x = Math.min(500, Math.max(12, x + Math.cos(a) * 6));
      y = Math.min(500, Math.max(12, y + Math.sin(a) * 6));
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return c;
}

/** The footpath: 1.2 m concrete flags with their joints. 256 px is 2.4 m, two flags each way. */
function flagsCanvas(): HTMLCanvasElement {
  const c = noiseTile(256, [158, 156, 149], { fine: 12, blobs: 10, blobAmp: 7 });
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(96,94,88,0.85)';
  for (const p of [0, 128]) {
    g.fillRect(p, 0, 2, 256);
    g.fillRect(0, p, 256, 2);
  }
  return c;
}

/** Galvanised chain-link: diamonds of wire on nothing. 64 px is 0.6 m; four diamonds a side. */
function chainLinkCanvas(): HTMLCanvasElement {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(200,206,210,1)';
  g.lineWidth = 2.2;
  for (let k = -64; k <= 128; k += 16) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 64, 64);
    g.stroke();
    g.beginPath();
    g.moveTo(k, 64);
    g.lineTo(k + 64, 0);
    g.stroke();
  }
  return c;
}

/** Red and white, for the barrier arm. */
function stripesCanvas(): HTMLCanvasElement {
  const c = makeCanvas(16, 256);
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#ecebe6' : '#c4232b';
    g.fillRect(0, i * 32, 16, 32);
  }
  return c;
}

/** The sky: the same gradient Level 7's windows looked out on, so the morning matches. */
function skyCanvas(): HTMLCanvasElement {
  const c = makeCanvas(16, 256);
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5f86b8');
  grad.addColorStop(0.42, '#9fbbd8');
  grad.addColorStop(0.5, '#e4d9c4');
  grad.addColorStop(0.56, '#c8c2b0');
  grad.addColorStop(1, '#6d7a5a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  return c;
}

/** The sun: a white-hot point in a wide warm glow, added over the sky. */
function sunCanvas(): HTMLCanvasElement {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,252,240,1)');
  grad.addColorStop(0.1, 'rgba(255,246,222,0.95)');
  grad.addColorStop(0.18, 'rgba(255,232,190,0.4)');
  grad.addColorStop(0.45, 'rgba(255,220,170,0.1)');
  grad.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/**
 * Three soft shapes side by side for everything that only darkens the
 * ground: a round blot (oil stains, the shade under a tree), a rounded
 * oblong (under the backdrop cars, the tyre-worn lane) and a one-sided ramp
 * (the building's shadow). White, its alpha the shape; the material colours it.
 */
function softCanvas(): HTMLCanvasElement {
  const c = makeCanvas(192, 64);
  const g = c.getContext('2d')!;
  const img = g.createImageData(192, 64);
  const d = img.data;
  const sstep = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 192; x++) {
      let a = 0;
      if (x < 64) {
        const r = Math.hypot(x + 0.5 - 32, y + 0.5 - 32) / 31;
        a = r < 1 ? Math.pow(1 - r * r, 1.6) : 0;
      } else if (x < 128) {
        const lx = x - 64 + 0.5;
        const inside = Math.min(lx, 64 - lx, y + 0.5, 64 - (y + 0.5));
        a = sstep(0, 14, inside);
      } else {
        const lx = x - 128 + 0.5;
        a = sstep(0, 12, Math.min(lx, 64 - lx)) * Math.pow(1 - y / 63, 1.3);
      }
      const i = (y * 192 + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** The atlas cells, in UV: the canvas's top row is v = 1. */
const SOFT = {
  disc: [0, 1 / 3],
  box: [1 / 3, 2 / 3],
  ramp: [2 / 3, 1]
} as const;

/** Office glass with the western sky in it, darker toward the sill where the reflection gives way to the room. */
function glassCanvas(): HTMLCanvasElement {
  const c = makeCanvas(32, 256);
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#aec6dc');
  grad.addColorStop(0.4, '#8ba7c1');
  grad.addColorStop(0.72, '#6c849b');
  grad.addColorStop(1, '#4a5866');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 256);
  // A faint band of brighter sky caught across it
  g.fillStyle = 'rgba(235,242,248,0.12)';
  g.fillRect(0, 52, 32, 26);
  return c;
}

/** Far office blocks: one storey and one bay of their windows, 3.0 m by 3.3 m. */
function windowsCanvas(): HTMLCanvasElement {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d')!;
  g.fillStyle = '#d7d2c6';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#4c5866';
  g.fillRect(6, 10, 52, 32);
  g.fillStyle = 'rgba(200,210,220,0.35)';
  g.fillRect(31, 10, 2, 32);
  return c;
}

/** A painted sign: lines of text centred on a plate. */
function signCanvas(
  w: number,
  h: number,
  bg: string,
  lines: { text: string; px: number; y: number; colour: string; bold?: boolean }[],
  border?: string
): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = Math.max(3, h * 0.03);
    g.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h * 0.9);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const l of lines) {
    g.fillStyle = l.colour;
    g.font = `${l.bold === false ? '' : 'bold '}${l.px}px Arial, Helvetica, sans-serif`;
    g.fillText(l.text, w / 2, l.y);
  }
  return c;
}

/** The company's name along the top of the building: white on navy, a little orange headset to the left of it. */
function companyCanvas(): HTMLCanvasElement {
  const c = signCanvas(2048, 192, '#1b2740', [{ text: 'RAVI-CALL SYSTEMS', px: 132, y: 100, colour: '#f2f0ea' }]);
  const g = c.getContext('2d')!;
  // The mark: an orange disc with a headset's band and mouthpiece cut out of it
  const x = 150;
  const y = 96;
  g.fillStyle = '#e8792b';
  g.beginPath();
  g.arc(x, y, 66, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#1b2740';
  g.lineWidth = 11;
  g.beginPath();
  g.arc(x, y + 6, 36, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  g.fillStyle = '#1b2740';
  g.fillRect(x - 44, y + 4, 18, 30);
  g.fillRect(x + 26, y + 4, 18, 30);
  g.beginPath();
  g.moveTo(x + 30, y + 34);
  g.quadraticCurveTo(x + 22, y + 52, x - 4, y + 50);
  g.stroke();
  return c;
}

// ---------------------------------------------------------------- materials

interface Mats {
  asphalt: THREE.MeshLambertMaterial;
  apron: THREE.MeshLambertMaterial;
  grass: THREE.MeshLambertMaterial;
  paint: THREE.MeshLambertMaterial;
  soft: THREE.MeshBasicMaterial;
  kerb: THREE.MeshLambertMaterial;
  facade: THREE.MeshLambertMaterial;
  trim: THREE.MeshLambertMaterial;
  frame: THREE.MeshLambertMaterial;
  glass: THREE.MeshBasicMaterial;
  interior: THREE.MeshLambertMaterial;
  interiorFloor: THREE.MeshLambertMaterial;
  doorSteel: THREE.MeshStandardMaterial;
  doorMetal: THREE.MeshStandardMaterial;
  doorSign: THREE.MeshLambertMaterial;
  stairSign: THREE.MeshLambertMaterial;
  companySign: THREE.MeshBasicMaterial;
  staffSign: THREE.MeshLambertMaterial;
  fence: THREE.MeshLambertMaterial;
  galv: THREE.MeshLambertMaterial;
  lampHead: THREE.MeshLambertMaterial;
  lens: THREE.MeshLambertMaterial;
  yellow: THREE.MeshLambertMaterial;
  stripes: THREE.MeshLambertMaterial;
  sky: THREE.MeshBasicMaterial;
  sun: THREE.MeshBasicMaterial;
  carBody: THREE.MeshBasicMaterial;
  carTrim: THREE.MeshBasicMaterial;
  trunk: THREE.MeshBasicMaterial;
  crown: THREE.MeshBasicMaterial;
  skyline: THREE.MeshBasicMaterial;
  proxy: THREE.MeshBasicMaterial;
}

/** Metres per repeat of each tiling texture. */
const TILE = { asphalt: 5, apron: 2.4, grass: 6, kerb: 1.2, facade: 4, fence: 0.6 } as const;

let shared: Mats | null = null;

/**
 * One set for the level, made the first time it is built and kept: a boss
 * fight gets restarted a lot, and every rebuild drawing its canvases again
 * would leave another copy of each texture on the GPU (nothing disposes
 * them on exit).
 */
function mats(): Mats {
  if (shared) return shared;
  const asphaltTex = tiling(asphaltCanvas());
  const grassTex = tiling(noiseTile(256, [84, 108, 62], { fine: 22, blobs: 26, blobAmp: 14, tint: [0.7, 1, 0.5] }));
  const facadeTex = tiling(noiseTile(128, [182, 177, 167], { fine: 8, blobs: 8, blobAmp: 6 }));
  const kerbTex = tiling(noiseTile(64, [172, 169, 161], { fine: 12, blobs: 3, blobAmp: 6 }));
  const tagged = <M extends THREE.Material>(m: M, tile: number): M => {
    m.userData.tile = tile;
    return m;
  };
  const sign = (c: HTMLCanvasElement): THREE.MeshLambertMaterial =>
    new THREE.MeshLambertMaterial({ map: once(c), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  shared = {
    asphalt: new THREE.MeshLambertMaterial({ map: asphaltTex, vertexColors: true }),
    apron: new THREE.MeshLambertMaterial({ map: tiling(flagsCanvas()) }),
    grass: new THREE.MeshLambertMaterial({ map: grassTex }),
    // Lifted 12 mm and pulled forward in depth as well: from eye height at the
    // far end of the lot the asphalt and the paint are a hair apart on screen
    paint: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    soft: new THREE.MeshBasicMaterial({
      color: 0x0b0e12,
      map: once(softCanvas()),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    }),
    kerb: tagged(new THREE.MeshLambertMaterial({ map: kerbTex }), TILE.kerb),
    facade: tagged(new THREE.MeshLambertMaterial({ map: facadeTex }), TILE.facade),
    trim: new THREE.MeshLambertMaterial({ color: 0x7c776f }),
    frame: new THREE.MeshLambertMaterial({ color: 0x2b2f35 }),
    glass: new THREE.MeshBasicMaterial({ map: once(glassCanvas()), vertexColors: true }),
    // The stairwell's landing: painted block in the shade of the building
    interior: new THREE.MeshLambertMaterial({ color: 0x5c615d }),
    interiorFloor: new THREE.MeshLambertMaterial({ color: 0x303335 }),
    doorSteel: new THREE.MeshStandardMaterial({ color: 0x56675f, roughness: 0.55, metalness: 0.25 }),
    doorMetal: new THREE.MeshStandardMaterial({
      color: 0x8c9296,
      roughness: 0.4,
      metalness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4
    }),
    doorSign: sign(
      signCanvas(256, 170, '#1d7a46', [
        { text: 'FIRE EXIT', px: 50, y: 62, colour: '#f4f4ee' },
        { text: 'KEEP CLEAR', px: 34, y: 118, colour: '#f4f4ee' }
      ], '#f4f4ee')
    ),
    stairSign: sign(
      signCanvas(512, 140, '#2c3138', [
        { text: 'STAIRWELL B', px: 64, y: 58, colour: '#e8e4d8' },
        { text: 'ALL FLOORS', px: 30, y: 106, colour: '#a9b0b8', bold: false }
      ], '#6f7780')
    ),
    // Lit from inside: it reads as clean white on navy even with the face in shade
    companySign: new THREE.MeshBasicMaterial({
      map: once(companyCanvas()),
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4
    }),
    staffSign: sign(
      signCanvas(384, 256, '#f2f1ec', [
        { text: 'STAFF PARKING', px: 46, y: 50, colour: '#1b2740' },
        { text: 'RAVI-CALL SYSTEMS', px: 32, y: 104, colour: '#e8792b' },
        { text: 'PERMIT HOLDERS ONLY', px: 28, y: 156, colour: '#1b2740' },
        { text: "Vehicles left at owner's risk", px: 20, y: 206, colour: '#555b63', bold: false }
      ], '#1b2740')
    ),
    // Blended rather than cut out, so at a distance the wire fades to the faint
    // grey veil a real fence is, instead of vanishing or turning solid
    fence: tagged(
      new THREE.MeshLambertMaterial({ map: tiling(chainLinkCanvas()), transparent: true, alphaTest: 0.05, side: THREE.DoubleSide }),
      TILE.fence
    ),
    galv: new THREE.MeshLambertMaterial({ color: 0x9aa1a6 }),
    lampHead: new THREE.MeshLambertMaterial({ color: 0x2a2d31 }),
    lens: new THREE.MeshLambertMaterial({ color: 0xd9dde0 }),
    yellow: new THREE.MeshLambertMaterial({ color: 0xd6ad2e }),
    stripes: new THREE.MeshLambertMaterial({ map: once(stripesCanvas()) }),
    sky: new THREE.MeshBasicMaterial({ map: once(skyCanvas()), side: THREE.BackSide, fog: false, depthWrite: false }),
    sun: new THREE.MeshBasicMaterial({
      map: once(sunCanvas()),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    }),
    carBody: new THREE.MeshBasicMaterial({ vertexColors: true }),
    carTrim: new THREE.MeshBasicMaterial({ vertexColors: true }),
    trunk: new THREE.MeshBasicMaterial({ vertexColors: true }),
    crown: new THREE.MeshBasicMaterial({ vertexColors: true }),
    skyline: new THREE.MeshBasicMaterial({ map: tiling(windowsCanvas()), vertexColors: true }),
    proxy: new THREE.MeshBasicMaterial({ visible: false })
  };
  return shared;
}

// ---------------------------------------------------------------- builder

/**
 * Level8Builder — the staff car park behind Ravi-Call Systems, the morning
 * after the raid: what Level 7's windows looked down on, now from the ground.
 *
 * A fenced lot of tarmac west of the tower, rows of parked cars across it
 * and one lane straight down the middle from Stairwell B's door to the gate
 * in the west fence; beyond the gate the road, and grass and trees and other
 * people's office blocks out to a morning sky. The General's end is the
 * open ground inside the gate, with the scrap pile beside its north post.
 *
 * The cars themselves (parked, piled, and the two the cutscenes drive) are
 * not built here: this lays out where they go, and CarSystem makes them.
 *
 * Almost everything is static, so almost everything is folded: walls and
 * kerbs by material (mergeShell), props by look (mergeStatic), and the flat
 * stuff — ground, paint, glass, the fence's mesh — built straight into one
 * geometry each. Far scenery is unlit colour, instanced.
 */
export class Level8Builder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  /** Props to be folded into merged dressing. */
  private dressing: THREE.Object3D[] = [];
  /** Plain boxes — the building, the kerbs — merged by material at the end. */
  private shell: THREE.Mesh[] = [];
  private m!: Mats;

  private paint = new Batch();
  private soft = new Batch();
  private grass = new Batch();
  private glass = new Batch();
  private fabric = new Batch();
  /** Invisible hit volumes for things drawn instanced (the island trees' trunks). */
  private proxies: THREE.BufferGeometry[] = [];
  private gateCollider!: Collider;
  private doorPivot!: THREE.Object3D;

  build(): Level8Data {
    this.m = mats();
    this.buildGround();
    this.buildPaint();
    this.buildKerbs();
    this.buildFacade();
    this.buildStairDoor();
    this.buildSigns();
    this.buildFences();
    this.buildGate();
    this.buildLamps();
    this.buildTrees();
    this.buildBackdropCars();
    this.buildSkyline();
    this.buildSky();
    this.buildLighting();
    this.finishBatches();
    this.shootables = mergeStatic(this.group, this.dressing, this.shootables);
    this.mergeShell();

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      glassPanes: [],
      occluders: this.occluders,
      // On the footpath just outside the door, facing down the lane
      playerSpawn: V(-1.2, 0, 12),
      playerSpawnYaw: WEST,
      stairDoor: { pivot: this.doorPivot, openAngle: DOOR_OPEN },
      ravi: {
        // From just inside the door (the landing behind it is built), out
        // over the threshold and down the middle of the lane, easing off at
        // the end. The open door's leaf ends at z 11.55, clear of his line.
        chase: [V(0.9, 0, 12), V(-0.6, 0, 12), V(-3, 0, 12.05), V(-8, 0, 12.15), V(-13, 0, 12.1), V(-16.5, 0, 12.02), V(-19, 0, 12)],
        fightStart: V(-19, 0, 12),
        fightYaw: WEST
      },
      boss: {
        start: V(-46, 0, 12),
        // West down the lane, then round the front-left corner of his own car
        // to the driver's door (straight there would cut through its bonnet)
        run: [V(-46, 0, 12), V(-66, 0, 12.4), V(-86, 0, 13), V(-92.3, 0, 22.4), V(-91.2, 0, 25.5)],
        car: { pos: V(-90, 0, 26), yaw: 0 },
        drive: [V(-90, 0, 26), V(-90, 0, 15), V(-97, 0, 12), V(-104, 0, 9), V(-108, 0, 2), V(-108, 0, -80)]
      },
      general: {
        // Out of the way north of the pile while the chase plays. (The pile
        // stands between him and the gate, not between him and the building:
        // from the door his sightline passes ~4 m north of it.)
        hidden: V(-97, 0, -7),
        // In the lane's north edge, a couple of strides from the pile's south-east end
        reveal: V(-89, 0, 9.5),
        revealYaw: EAST,
        zone: { ...L8.zone }
      },
      civic: {
        pos: V(-94, 0, 37),
        yaw: 0,
        drive: [V(-94, 0, 37), V(-94, 0, 20), V(-97, 0, 13), V(-104, 0, 9), V(-108, 0, 2), V(-108, 0, -90)]
      },
      parked: parkedSlots(),
      pile: pileSlots(),
      arena: { minX: L8.lot.x0, maxX: 0, minZ: L8.lot.z0, maxZ: L8.lot.z1 },
      gate: { collider: this.gateCollider, centre: V(-100, 0, (L8.gate.z0 + L8.gate.z1) / 2) },
      sunDir: SUN_DIR.clone()
    };
  }

  // --------------------------------------------------------------- helpers

  /** Solid box: mesh, collider, bullet target and (by default) vision blocker. `y` is its base. */
  private solid(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    opts: { collide?: boolean; occlude?: boolean; surface?: string } = {}
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    // Into place in the geometry itself, so the texture can be laid in world metres
    geo.translate(x, y + h / 2, z);
    planarUVs(geo, (mat.userData.tile as number | undefined) ?? 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.surface = opts.surface ?? 'concrete';
    this.group.add(mesh);
    this.shootables.push(mesh);
    this.shell.push(mesh);
    if (opts.occlude !== false) this.occluders.push(mesh);
    if (opts.collide !== false) {
      this.colliders.push({
        box: new THREE.Box3(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y + h, z + d / 2))
      });
    }
    return mesh;
  }

  /** A movement-only box: for props folded into the dressing, and things drawn instanced. */
  private blk(x: number, z: number, w: number, d: number, h: number, y = 0): Collider {
    const c = { box: new THREE.Box3(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y + h, z + d / 2)) };
    this.colliders.push(c);
    return c;
  }

  /** A prop, to be folded into the merged dressing. Its meshes still stop bullets. */
  private put(o: THREE.Object3D, x: number, z: number, yaw = 0, y = 0): THREE.Object3D {
    o.position.set(x, y, z);
    o.rotation.y = yaw;
    this.group.add(o);
    this.dressing.push(o);
    o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) {
        if (!m.userData.surface) m.userData.surface = 'metal';
        this.shootables.push(m);
      }
    });
    return o;
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  /** A flat-built geometry as a mesh in the level, optionally a bullet target. */
  private flat(geo: THREE.BufferGeometry, mat: THREE.Material, surface: string | null): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    if (surface) {
      mesh.userData.surface = surface;
      this.shootables.push(mesh);
    }
    return mesh;
  }

  /**
   * The walls, kerbs and trim into one mesh per material. Built as separate
   * boxes the facade alone is several hundred draws — sills, mullions and
   * piers for nine floors — and none of it ever moves. The merged ones take
   * their place as bullet targets and, where the boxes blocked sight, as
   * occluders.
   */
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
      const one = mergeGeometries(geos, false) as THREE.BufferGeometry | null;
      for (const g of geos) g.dispose();
      if (!one) {
        // Could not fold: leave these as they were
        for (const m of list) {
          gone.delete(m);
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

  // ---------------------------------------------------------------- ground

  /**
   * The ground in pieces that meet but never overlap: tarmac over the lot,
   * the gate's throat and the road, flags along the building, grass for the
   * rest. Stacked planes at eye height, 1.65 m over a 600 m far plane, would
   * fight each other half way down the lot.
   *
   * Under it all, one collider two metres thick: a car falls on this lot at
   * twenty-odd metres a second, and against a thin slab it would be through
   * it between two physics steps.
   */
  private buildGround(): void {
    const m = this.m;
    const L = L8.lot;
    const asphalt = new Batch();
    const apron = new Batch();
    const g = this.grass;
    const ta = TILE.asphalt;
    const tg = TILE.grass;
    // The lot, and its throat out through the gate to the road
    asphalt.rect(L.x0, L.x1, L.z0, L.z1, 0, ta);
    asphalt.rect(-102, L.x0, L8.gate.z0 - 1, L8.gate.z1 + 1, 0, ta);
    // The rest of the car park, beyond the fences north and south: older, a shade paler
    asphalt.rect(L.x0, 0, -60, L.z0, 0, ta, [1.06, 1.06, 1.05, 1]);
    asphalt.rect(L.x0, 0, L.z1, 80, 0, ta, [1.06, 1.06, 1.05, 1]);
    // The road, a newer, darker surface
    const r0 = L8.road.x - L8.road.w / 2;
    const r1 = L8.road.x + L8.road.w / 2;
    asphalt.rect(r0, r1, -490, 510, 0, ta, [0.72, 0.74, 0.77, 1]);
    // The footpath along the building
    apron.rect(L8.apronX, 0, L.z0, L.z1, 0, TILE.apron);
    // Grass: west of the road; the verge between road and fence either side of the gate;
    // north and south of everything; and east past the building
    g.rect(-550, r0, -490, 510, 0, tg);
    g.rect(r1, L.x0, -490, L8.gate.z0 - 1, 0, tg);
    g.rect(r1, L.x0, L8.gate.z1 + 1, 510, 0, tg);
    g.rect(L.x0, 450, -490, -60, 0, tg);
    g.rect(L.x0, 450, 80, 510, 0, tg);
    g.rect(0, 450, -60, L8.facade.z0, 0, tg);
    g.rect(0, 450, L8.facade.z1, 80, 0, tg);
    g.rect(L8.facade.depth, 450, L8.facade.z0, L8.facade.z1, 0, tg);
    this.flat(asphalt.geometry('rgb'), m.asphalt, 'concrete');
    this.flat(apron.geometry('none'), m.apron, 'concrete');
    // The grass mesh (and the island beds added to it) is made in finishBatches()

    this.colliders.push({ box: new THREE.Box3(V(-140, -2, -70), V(40, 0, 100)) });
  }

  // ----------------------------------------------------------------- paint

  /**
   * Everything painted on the tarmac, as one mesh: the bay lines, the back
   * lines of the double rows, arrows down the aisles and the lane, the
   * yellow hatched box in front of the fire door, the road's lines. Thin
   * quads 12 mm up, crisp at any distance — a texture across 100 m of lot
   * would be a blur at foot height.
   */
  private buildPaint(): void {
    const p = this.paint;
    const Y = 0.012;
    const W = 0.1;
    const white = rgba(0xdedad0);
    const yellow = rgba(0xd9b23a);
    const rows = (zs: number[]): void => {
      if (!zs.length) return;
      for (const z of zs) {
        for (const x of SINGLES) p.strip(x - BAY_HALF, z, x + BAY_HALF, z, W, Y, white);
        for (const [e, w] of PAIRS) p.strip(w - BAY_HALF, z, e + BAY_HALF, z, W, Y, white);
      }
      const za = zs[0];
      const zb = zs[zs.length - 1];
      for (const [e, w] of PAIRS) p.strip((e + w) / 2, za, (e + w) / 2, zb, W, Y, white);
    };
    rows(bayLines(L8.north));
    rows(bayLines(L8.south));
    // The rest of the car park, beyond the fences
    rows(Array.from({ length: 15 }, (_, k) => -18.8 - L8.pitch * k));
    rows(Array.from({ length: 13 }, (_, k) => 44.6 + L8.pitch * k));

    const arrow = (x: number, z: number, dx: number, dz: number, c: RGBA, len = 2.6): void => {
      const tail = len / 2;
      const neck = len / 2 - 0.95;
      p.strip(x - dx * tail, z - dz * tail, x + dx * neck, z + dz * neck, 0.26, Y, c);
      const hx = -dz * 0.48;
      const hz = dx * 0.48;
      const bx = x + dx * neck;
      const bz = z + dz * neck;
      p.poly(
        [[bx + hx, Y, bz + hz], [x + dx * (len / 2), Y, z + dz * (len / 2)], [bx - hx, Y, bz - hz]],
        [[0, 0], [0, 0], [0, 0]],
        c,
        UP
      );
    };
    // One way round: down one aisle, up the next
    AISLES.forEach((ax, i) => {
      const dz = i % 2 ? 1 : -1;
      arrow(ax, -4.5, 0, dz, white);
      arrow(ax, 28, 0, dz, white);
      arrow(ax, -38, 0, dz, white);
      arrow(ax, 61, 0, dz, white);
    });
    // The lane: out toward the gate on its north side, in toward the building on its south
    for (const x of [-30, -58, -86]) arrow(x, 10.6, -1, 0, white, 3.2);
    for (const x of [-22, -48, -72]) arrow(x, 13.4, 1, 0, white, 3.2);
    // Give-way dashes across the gate's throat
    for (let z = L8.gate.z0 + 0.3; z < L8.gate.z1 - 0.3; z += 1.0) p.strip(-101.2, z, -101.2, z + 0.6, 0.3, Y, white);

    // KEEP CLEAR in front of the stairwell door: a yellow box, hatched
    const k = { x0: -2.2, x1: -0.15, z0: 10.9, z1: 13.1 };
    p.strip(k.x0, k.z0, k.x1, k.z0, W, Y, yellow);
    p.strip(k.x0, k.z1, k.x1, k.z1, W, Y, yellow);
    p.strip(k.x0, k.z0, k.x0, k.z1, W, Y, yellow);
    p.strip(k.x1, k.z0, k.x1, k.z1, W, Y, yellow);
    for (let c = k.x0 + k.z0 + 0.45; c < k.x1 + k.z1; c += 0.45) {
      // The line x + z = c, clipped to the box
      const xa = Math.max(k.x0, c - k.z1);
      const xb = Math.min(k.x1, c - k.z0);
      if (xb - xa < 0.05) continue;
      p.strip(xa, c - xa, xb, c - xb, 0.07, Y, yellow);
    }

    // The road: its centre line, and edge lines broken for the gate
    const rx = L8.road.x;
    const hw = L8.road.w / 2 - 0.4;
    p.strip(rx, -490, rx, 510, 0.15, Y, yellow);
    p.strip(rx - hw, -490, rx - hw, 510, W, Y, white);
    p.strip(rx + hw, -490, rx + hw, L8.gate.z0 - 1, W, Y, white);
    p.strip(rx + hw, L8.gate.z1 + 1, rx + hw, 510, W, Y, white);

    // ---- What darkens the ground (drawn soft, one blended mesh)
    const s = this.soft;
    const rnd = lcg(29);
    const [d0, d1] = SOFT.disc;
    const [b0, b1] = SOFT.box;
    // Oil where engines have stood, in about half the bays
    for (const z of [...bayCentres(L8.north), ...bayCentres(L8.south)]) {
      for (const r of ROWS) {
        if (rnd() > 0.45) continue;
        const cx = r.x + (rnd() - 0.5) * 2.2;
        const cz = z + (rnd() - 0.5) * 0.6;
        const a = rnd() * Math.PI;
        const rx2 = 0.35 + rnd() * 0.5;
        const rz2 = 0.25 + rnd() * 0.35;
        this.softQuad(cx, cz, rx2, rz2, a, 0.006, [d0, d1], 0.18 + rnd() * 0.32);
      }
    }
    // Tyre-worn bands down the lane where everybody drives
    for (const z of [10.6, 13.4]) {
      s.flatQuad([[-99, z - 0.8], [-99, z + 0.8], [-5, z + 0.8], [-5, z - 0.8]], 0.007, [[b0, 0], [b0, 1], [b1, 1], [b1, 0]], [1, 1, 1, 0.14]);
    }

    // The building's shade, soft, thrown west and a little north across the
    // footpath and the first few metres of tarmac. The sun is low enough that
    // the real shadow would cover half the lot; this is the part the eye
    // expects at its foot
    const [r0, r1] = SOFT.ramp;
    const reach = 12;
    const lean = reach * (SUN_DIR.z / SUN_DIR.x);
    const F = L8.facade;
    s.flatQuad(
      [[0, F.z0], [0, F.z1], [-reach, F.z1 - lean], [-reach, F.z0 - lean]],
      0.016,
      [[r0, 1], [r1, 1], [r1, 0], [r0, 0]],
      [1, 1, 1, 0.46]
    );
    // ... and over the kerb's top, which stands above it, at the same depth of
    // shade: the ramp's v at either edge of the kerb, its u along the
    // parallelogram as it has leaned by then
    const kx = L8.apronX;
    const vAt = (x: number): number => 1 + x / reach;
    const shift = lean * (-kx / reach);
    const u = (zz: number): number => r0 + ((zz - (F.z0 - shift)) / (F.z1 - F.z0)) * (r1 - r0);
    for (const [za, zb] of [[L8.lot.z0, 8.6], [15.4, L8.lot.z1]] as [number, number][]) {
      const zl = Math.max(za, F.z0 - shift);
      const zr = Math.min(zb, F.z1 - shift);
      if (zr <= zl) continue;
      s.flatQuad(
        [[kx + 0.1, zl], [kx + 0.1, zr], [kx - 0.1, zr], [kx - 0.1, zl]],
        0.152,
        [[u(zl), vAt(kx + 0.1)], [u(zr), vAt(kx + 0.1)], [u(zr), vAt(kx - 0.1)], [u(zl), vAt(kx - 0.1)]],
        [1, 1, 1, 0.46]
      );
    }
  }

  /** A soft blot on the ground, an ellipse turned by `a`, mapped onto one cell of the soft atlas. */
  private softQuad(x: number, z: number, rx: number, rz: number, a: number, y: number, cell: readonly [number, number], alpha: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const pt = (u: number, v: number): [number, number] => [x + u * rx * c - v * rz * s, z + u * rx * s + v * rz * c];
    this.soft.flatQuad(
      [pt(-1, -1), pt(-1, 1), pt(1, 1), pt(1, -1)],
      y,
      [[cell[0], 0], [cell[0], 1], [cell[1], 1], [cell[1], 0]],
      [1, 1, 1, alpha]
    );
  }

  // ----------------------------------------------------------------- kerbs

  /**
   * The footpath's kerb, dropped across the lane so the run out of the door
   * is flat; a pair of bollards either side of the drop; and the islands at
   * the row ends, kerbed, with grass in them. Low enough to step up (0.15 m),
   * and solid to a car sliding into one.
   */
  private buildKerbs(): void {
    const m = this.m;
    const K = 0.14;
    const x = L8.apronX;
    const L = L8.lot;
    const lo = 8.6;
    const hi = 15.4;
    this.solid(0.2, K, lo - L.z0, x, 0, (L.z0 + lo) / 2, m.kerb, { occlude: false });
    this.solid(0.2, K, L.z1 - hi, x, 0, (hi + L.z1) / 2, m.kerb, { occlude: false });
    const posts = new THREE.Group();
    for (const z of [lo - 0.3, hi + 0.3]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.95, 10), m.yellow);
      b.position.set(x + 0.45, 0.475, z);
      posts.add(b);
      posts.add(this.box(0.23, 0.06, 0.23, m.lampHead, x + 0.45, 0.8, z));
      this.blk(x + 0.45, z, 0.24, 0.24, 0.95);
    }
    this.put(posts, 0, 0);

    for (const isl of ISLANDS) {
      const t = 0.18;
      const h = 0.15;
      const cx = (isl.x0 + isl.x1) / 2;
      const cz = (isl.z0 + isl.z1) / 2;
      const w = isl.x1 - isl.x0;
      const d = isl.z1 - isl.z0;
      const o = { collide: false, occlude: false };
      this.solid(w, h, t, cx, 0, isl.z0 + t / 2, m.kerb, o);
      this.solid(w, h, t, cx, 0, isl.z1 - t / 2, m.kerb, o);
      this.solid(t, h, d - 2 * t, isl.x0 + t / 2, 0, cz, m.kerb, o);
      this.solid(t, h, d - 2 * t, isl.x1 - t / 2, 0, cz, m.kerb, o);
      this.blk(cx, cz, w, d, h);
      // The bed, a little below the kerb's top
      this.grass.rect(isl.x0 + t, isl.x1 - t, isl.z0 + t, isl.z1 - t, 0.12, TILE.grass);
    }
  }

  // ---------------------------------------------------------------- facade

  /**
   * The tower's west face: nine storeys of concrete with the same two long
   * windows on every floor that Level 7's office had (somewhere up there is
   * the one Ravi looked out of), floor bands, corner fins, a parapet. The
   * skin is 0.3 m deep with the glass set back in it; behind it the building
   * is a solid block, closed to the player by one collider. Stairwell B's
   * door is in the ground floor's middle pier, with its landing built behind
   * it — the chase starts in there.
   */
  private buildFacade(): void {
    const m = this.m;
    const F = L8.facade;
    const z0 = F.z0;
    const z1 = F.z1;
    const S = F.storey;
    const sk = F.skin;
    const top = F.floors * S;
    const roof = top + F.parapet;
    const [w0, w1] = L8.windows;
    const D0 = L8.door.z - L8.door.w / 2;
    const D1 = L8.door.z + L8.door.w / 2;
    const DH = L8.door.h;
    const rnd = lcg(61);
    const skin = (za: number, zb: number, ya: number, yb: number): void => {
      if (zb - za < 0.01 || yb - ya < 0.01) return;
      this.solid(sk, yb - ya, zb - za, sk / 2, ya, (za + zb) / 2, m.facade, { collide: false });
    };
    const trimO = { collide: false, occlude: false };
    const frameO = { collide: false, occlude: false, surface: 'metal' };

    for (let f = 0; f < F.floors; f++) {
      const y0 = f * S;
      const ys = y0 + L8.sill;
      const yh = y0 + L8.head;
      if (f === 0) {
        // The ground floor's sill band and middle pier, broken for the door
        skin(z0, D0, y0, ys);
        skin(D1, z1, y0, ys);
        skin(z0, w0[0], ys, yh);
        skin(w0[1], D0, ys, yh);
        skin(D1, w1[0], ys, yh);
        skin(w1[1], z1, ys, yh);
        skin(D0, D1, DH, yh);
      } else {
        skin(z0, z1, y0, ys);
        skin(z0, w0[0], ys, yh);
        skin(w0[1], w1[0], ys, yh);
        skin(w1[1], z1, ys, yh);
        // The floor slab's edge, a band proud of the face
        this.solid(0.06, 0.14, z1 - z0 - 1.0, -0.03, y0 - 0.07, (z0 + z1) / 2, m.trim, trimO);
      }
      skin(z0, z1, yh, y0 + S);

      for (const [a, b] of L8.windows) {
        const mid = (a + b) / 2;
        // Glass, set back in the opening: a little lighter or darker pane to pane
        const v = 0.86 + rnd() * 0.2;
        this.glass.poly(
          [[0.15, ys, a], [0.15, ys, b], [0.15, yh, b], [0.15, yh, a]],
          [[0, 0], [1, 0], [1, 1], [0, 1]],
          [v, v, v * 1.02, 1],
          [-1, 0, 0]
        );
        // Mullions every 1.6 m or so, a transom, the frame round it, the sill under it
        const n = Math.round((b - a) / 1.6);
        for (let k = 1; k < n; k++) this.solid(0.1, yh - ys, 0.06, 0.15, ys, a + ((b - a) * k) / n, m.frame, frameO);
        this.solid(0.1, 0.06, b - a, 0.15, ys + (yh - ys) * 0.72, mid, m.frame, frameO);
        this.solid(0.12, 0.05, b - a, 0.14, yh - 0.05, mid, m.frame, frameO);
        this.solid(0.12, yh - ys, 0.05, 0.14, ys, a + 0.025, m.frame, frameO);
        this.solid(0.12, yh - ys, 0.05, 0.14, ys, b - 0.025, m.frame, frameO);
        // Its top a hair over the opening's floor, so the two never share a plane
        this.solid(0.2, 0.07, b - a + 0.12, 0.04, ys - 0.058, mid, m.trim, trimO);
      }
      // The north and south faces: a band of glass a floor, seen edge-on from the lot
      const yg = y0 + 0.9;
      const yt = y0 + 2.5;
      this.glass.poly([[1.2, yg, z0 - 0.02], [30.8, yg, z0 - 0.02], [30.8, yt, z0 - 0.02], [1.2, yt, z0 - 0.02]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.9, 0.9, 0.92, 1], [0, 0, -1]);
      this.glass.poly([[1.2, yg, z1 + 0.02], [30.8, yg, z1 + 0.02], [30.8, yt, z1 + 0.02], [1.2, yt, z1 + 0.02]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.9, 0.9, 0.92, 1], [0, 0, 1]);
    }
    // Parapet, its coping, the fins at the corners and a plinth along the foot
    skin(z0, z1, top, roof);
    this.solid(0.75, 0.12, z1 - z0 + 0.1, 0.2, roof, (z0 + z1) / 2, m.trim, trimO);
    // (the fins stop under the coping: level with its top they'd share a plane with it)
    this.solid(0.16, roof, 0.5, -0.08, 0, z0 + 0.25, m.trim, trimO);
    this.solid(0.16, roof, 0.5, -0.08, 0, z1 - 0.25, m.trim, trimO);
    this.solid(0.04, 0.45, D0 - 0.1 - (z0 + 0.5), -0.02, 0, (z0 + 0.5 + D0 - 0.1) / 2, m.trim, trimO);
    this.solid(0.04, 0.45, z1 - 0.5 - (D1 + 0.1), -0.02, 0, (D1 + 0.1 + z1 - 0.5) / 2, m.trim, trimO);

    // The building behind the skin: a solid block round the stair landing
    const ld = { x1: 3.2, z0: 10.6, z1: 13.4, h: 3.0 };
    const bx0 = sk;
    const bx1 = F.depth;
    const core = (xa: number, xb: number, za: number, zb: number, ya: number, yb: number): void => {
      this.solid(xb - xa, yb - ya, zb - za, (xa + xb) / 2, ya, (za + zb) / 2, m.facade, { collide: false });
    };
    core(bx0, bx1, z0, ld.z0, 0, roof);
    core(bx0, bx1, ld.z1, z1, 0, roof);
    core(bx0, bx1, ld.z0, ld.z1, ld.h, roof);
    core(ld.x1, bx1, ld.z0, ld.z1, 0, ld.h);
    // The lift motor room on the roof, for a skyline from the far end of the lot
    core(9, 19, 6, 16, roof, roof + 3.2);
    this.colliders.push({ box: new THREE.Box3(V(0, 0, z0), V(F.depth, roof, z1)) });

    // Stairwell B's ground landing, behind the door: lined, floored, dim
    const io = { collide: false, occlude: false };
    const lz = (ld.z0 + ld.z1) / 2;
    const ldw = ld.z1 - ld.z0;
    this.solid(ld.x1, 0.1, ldw, ld.x1 / 2, -0.1, lz, m.interiorFloor, io);
    this.solid(0.05, ld.h, ldw, ld.x1 - 0.025, 0, lz, m.interior, io);
    this.solid(ld.x1 - bx0, ld.h, 0.05, (bx0 + ld.x1) / 2, 0, ld.z0 + 0.025, m.interior, io);
    this.solid(ld.x1 - bx0, ld.h, 0.05, (bx0 + ld.x1) / 2, 0, ld.z1 - 0.025, m.interior, io);
    this.solid(ld.x1 - bx0, 0.05, ldw, (bx0 + ld.x1) / 2, ld.h - 0.05, lz, m.interior, io);
    const f0 = ld.z0 + 0.05;
    const f1 = ld.z1 - 0.05;
    this.solid(0.05, ld.h - 0.05, D0 - 0.08 - f0, bx0 + 0.025, 0, (f0 + D0 - 0.08) / 2, m.interior, io);
    this.solid(0.05, ld.h - 0.05, f1 - (D1 + 0.08), bx0 + 0.025, 0, (D1 + 0.08 + f1) / 2, m.interior, io);
    this.solid(0.05, ld.h - 0.05 - (DH + 0.08), D1 - D0 + 0.16, bx0 + 0.025, DH + 0.08, L8.door.z, m.interior, io);
    // A handrail along the back wall, where the flight goes up
    this.solid(0.05, 0.05, ldw - 0.4, ld.x1 - 0.12, 0.95, lz, m.frame, frameO);
  }

  // ------------------------------------------------------------ stair door

  /**
   * Stairwell B's door: a steel fire door in a steel frame, hung on its
   * north jamb so it swings out, to the west, away from the run down the
   * lane. Its leaf is the scene's to fling open — turn `pivot.rotation.y`
   * from 0 to DOOR_OPEN (negative: +y rotation would swing it into the
   * building). Not merged; everything on the leaf is on the pivot.
   *
   * It has one collider, for the leaf standing open: the door is only ever
   * shut while the opening is playing, when Ravi is on rails.
   */
  private buildStairDoor(): void {
    const m = this.m;
    const D0 = L8.door.z - L8.door.w / 2;
    const D1 = L8.door.z + L8.door.w / 2;
    const DH = L8.door.h;
    const fo = { collide: false, occlude: false, surface: 'metal' };
    // Frame: jambs and head standing a little proud, a steel threshold
    this.solid(0.34, DH + 0.08, 0.1, 0.13, 0, D0 - 0.03, m.frame, fo);
    this.solid(0.34, DH + 0.08, 0.1, 0.13, 0, D1 + 0.03, m.frame, fo);
    this.solid(0.34, 0.1, D1 - D0 + 0.16, 0.13, DH - 0.02, L8.door.z, m.frame, fo);
    this.solid(0.4, 0.02, D1 - D0 - 0.04, 0.1, 0, L8.door.z, m.frame, fo);

    const pivot = new THREE.Object3D();
    // The hinge line: the leaf's outer face at the north jamb
    pivot.position.set(-0.005, 0, D0 + 0.025);
    const W = D1 - D0 - 0.07;
    const LH = DH - 0.03;
    const leaf = this.box(0.05, LH, W, m.doorSteel, 0.025, 0.01 + LH / 2, 0.01 + W / 2);
    // Its hardware — kick plate, key cylinder, three hinges — one mesh, one draw
    const hw: THREE.BufferGeometry[] = [];
    const kick = new THREE.BoxGeometry(0.004, 0.28, W - 0.1);
    kick.translate(-0.002, 0.2, 0.01 + W / 2);
    hw.push(kick);
    const lock = new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10);
    lock.rotateZ(Math.PI / 2);
    lock.translate(-0.01, 1.05, W - 0.06);
    hw.push(lock);
    for (const y of [0.3, 1.1, 1.9]) {
      const hinge = new THREE.BoxGeometry(0.02, 0.12, 0.03);
      hinge.translate(-0.006, y, 0.012);
      hw.push(hinge);
    }
    const hardware = new THREE.Mesh(mergeGeometries(hw, false), m.doorMetal);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.27), m.doorSign);
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(-0.004, 1.55, 0.01 + W / 2);
    pivot.add(leaf, hardware, sign);
    pivot.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      o.userData.surface = 'metal';
      this.shootables.push(o);
    });
    this.occluders.push(leaf);
    this.group.add(pivot);
    this.doorPivot = pivot;

    // Where the leaf stands once it is open
    const c = Math.cos(DOOR_OPEN);
    const s = Math.sin(DOOR_OPEN);
    const open = new THREE.Box3();
    for (const lx of [0, 0.05]) {
      for (const lz of [0.01, 0.01 + W]) {
        open.expandByPoint(V(pivot.position.x + lx * c + lz * s, 0, pivot.position.z - lx * s + lz * c));
      }
    }
    open.min.x -= 0.02;
    open.min.z -= 0.02;
    open.max.x += 0.02;
    open.max.z += 0.02;
    open.max.y = DH;
    this.colliders.push({ box: open });
  }

  // ----------------------------------------------------------------- signs

  /** STAIRWELL B over the door, the company's name along the parapet, and the staff-parking board by the gate. */
  private buildSigns(): void {
    const m = this.m;
    const F = L8.facade;
    const o = { collide: false, occlude: false, surface: 'metal' };
    const face = (w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, yaw: number): void => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.rotation.y = yaw;
      mesh.position.set(x, y, z);
      mesh.userData.surface = 'metal';
      this.group.add(mesh);
      this.shootables.push(mesh);
    };
    // Over the door, on its head
    this.solid(0.04, 0.46, 1.5, -0.02, 2.36, L8.door.z, m.trim, o);
    face(1.44, 0.4, m.stairSign, -0.05, 2.59, L8.door.z, -Math.PI / 2);
    // Along the parapet, over the middle of the face
    const top = F.floors * F.storey;
    const zc = (F.z0 + F.z1) / 2;
    this.solid(0.1, 1.5, 15.2, -0.05, top + 0.15, zc, m.trim, o);
    face(15, 1.38, m.companySign, -0.115, top + 0.9, zc, -Math.PI / 2);
    // On the fence just north of the gate, facing into the lot
    const sz = L8.gate.z0 - 2.6;
    this.solid(0.04, 0.85, 1.25, -99.92, 1.15, sz, m.trim, o);
    face(1.2, 0.8, m.staffSign, -99.885, 1.575, sz, Math.PI / 2);
  }

  // ---------------------------------------------------------------- fences

  /**
   * Chain-link on galvanised posts round the north, south and west of the
   * lot, closed against the building's corners on the east. The mesh is one
   * blended quad a run (one draw for all of it); rounds go through it
   * (`pierce`) and leave nothing on it (`noDecal`: a bullet hole or a blood
   * splash drawn on wire would hang in the air). The posts and rails stop
   * them like any steel.
   *
   * Colliders on the fence line, a metre thick outward: the player meets the
   * inner face, and a car thrown at it at speed meets something it can't be
   * through between two physics steps.
   */
  private buildFences(): void {
    const m = this.m;
    const H = L8.fenceH;
    const T = TILE.fence;
    const posts = new THREE.Group();
    const postGeo = new THREE.CylinderGeometry(0.035, 0.035, H + 0.1, 6);
    postGeo.translate(0, (H + 0.1) / 2, 0);
    const endGeo = new THREE.CylinderGeometry(0.055, 0.055, H + 0.15, 8);
    endGeo.translate(0, (H + 0.15) / 2, 0);
    const run = (ax: number, az: number, bx: number, bz: number, out: V3): void => {
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 3));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = new THREE.Mesh(i === 0 || i === n ? endGeo : postGeo, m.galv);
        p.position.set(ax + (bx - ax) * t, 0, az + (bz - az) * t);
        posts.add(p);
      }
      for (const y of [H, 0.12]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, len, 6), m.galv);
        rail.position.set((ax + bx) / 2, y, (az + bz) / 2);
        if (alongX) rail.rotation.z = Math.PI / 2;
        else rail.rotation.x = Math.PI / 2;
        posts.add(rail);
      }
      const ua = (alongX ? ax : az) / T;
      const ub = (alongX ? bx : bz) / T;
      this.fabric.poly(
        [[ax, 0.04, az], [bx, 0.04, bz], [bx, H, bz], [ax, H, az]],
        [[ua, 0.04 / T], [ub, 0.04 / T], [ub, H / T], [ua, H / T]]
      );
      const box = new THREE.Box3(V(Math.min(ax, bx), 0, Math.min(az, bz)), V(Math.max(ax, bx), H + 0.2, Math.max(az, bz)));
      if (out[0] < 0) box.min.x -= 1;
      if (out[0] > 0) box.max.x += 1;
      if (out[2] < 0) box.min.z -= 1;
      if (out[2] > 0) box.max.z += 1;
      if (alongX) {
        box.min.x -= 0.06;
        box.max.x += 0.06;
      } else {
        box.min.z -= 0.06;
        box.max.z += 0.06;
      }
      this.colliders.push({ box });
    };
    const L = L8.lot;
    run(L.x0, L.z0, 0, L.z0, [0, 0, -1]);
    run(L.x0, L.z1, 0, L.z1, [0, 0, 1]);
    run(L.x0, L.z0, L.x0, L8.gate.z0, [-1, 0, 0]);
    run(L.x0, L8.gate.z1, L.x0, L.z1, [-1, 0, 0]);
    run(0, L.z0, 0, L8.facade.z0, [1, 0, 0]);
    run(0, L8.facade.z1, 0, L.z1, [1, 0, 0]);
    this.put(posts, 0, 0);
  }

  // ------------------------------------------------------------------ gate

  /**
   * The way out: a 12 m gap in the west fence between two square gate
   * posts, a barrier's housing just outside the south one with its arm stood
   * up out of the way. No gate to see — but `gateCollider` closes it to Ravi
   * (the cars are scripted, and drive through).
   */
  private buildGate(): void {
    const m = this.m;
    const x = L8.lot.x0;
    const g = new THREE.Group();
    for (const z of [L8.gate.z0, L8.gate.z1]) {
      g.add(this.box(0.16, 2.7, 0.16, m.galv, x, 1.35, z));
      g.add(this.box(0.22, 0.04, 0.22, m.galv, x, 2.72, z));
      this.blk(x, z, 0.22, 0.22, 2.7);
    }
    const hx = x - 0.75;
    const hz = L8.gate.z1 + 0.7;
    g.add(this.box(0.4, 1.0, 0.36, m.yellow, hx, 0.5, hz));
    g.add(this.box(0.44, 0.05, 0.4, m.lampHead, hx, 1.025, hz));
    // The arm, raised: up from its pivot on the housing's side, leaning a
    // little out over the gap, its counterweight on the short end
    const arm = new THREE.Group();
    arm.position.set(hx + 0.25, 0.92, hz - 0.08);
    arm.rotation.x = -0.12;
    arm.add(this.box(0.08, 6.6, 0.11, m.stripes, 0, 3.3, 0));
    arm.add(this.box(0.12, 0.42, 0.16, m.yellow, 0, -0.16, 0));
    arm.add(this.box(0.1, 0.1, 0.1, m.lampHead, 0.0, 0.0, 0));
    g.add(arm);
    this.put(g, 0, 0);
    this.blk(hx, hz, 0.4, 0.36, 1.0);

    this.gateCollider = { box: new THREE.Box3(V(x - 1, 0, L8.gate.z0), V(x, 2.6, L8.gate.z1)) };
    this.colliders.push(this.gateCollider);
  }

  // ----------------------------------------------------------------- lamps

  /** Lamp posts on the islands: tall, plain, switched off for the day (no lights). */
  private buildLamps(): void {
    const m = this.m;
    const g = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 7.2, 8);
    poleGeo.translate(0, 3.6, 0);
    for (const isl of ISLANDS) {
      if (isl.lamp === undefined) continue;
      const x = isl.lamp;
      const z = (isl.z0 + isl.z1) / 2;
      const y = 0.12;
      const pole = new THREE.Mesh(poleGeo, m.galv);
      pole.position.set(x, y, z);
      g.add(pole);
      g.add(this.box(0.34, 0.5, 0.34, m.galv, x, y + 0.25, z));
      // Two heads on the lane's islands, one on those by the south fence
      const arms = isl.z1 < 20 ? [-1, 1] : [-1];
      for (const s of arms) {
        g.add(this.box(0.07, 0.07, 1.25, m.galv, x, y + 7.05, z + s * 0.62));
        g.add(this.box(0.3, 0.14, 0.62, m.lampHead, x, y + 7.0, z + s * 1.3));
        g.add(this.box(0.24, 0.02, 0.5, m.lens, x, y + 6.92, z + s * 1.3));
      }
      this.blk(x, z, 0.34, 0.34, 7.3);
    }
    this.put(g, 0, 0);
  }

  // ----------------------------------------------------------------- trees

  /**
   * Trees: in the islands, small ones on the verge behind the west fence,
   * along the far side of the road, round the edges of the car park, and a
   * wide band out to the horizon. All one instanced trunk and one crown,
   * their light baked in; the island ones get colliders and a hidden trunk
   * for bullets to stop on, and the shade of their crowns on the bed.
   */
  private buildTrees(): void {
    const m = this.m;
    const rnd = lcg(53);
    const spots: { x: number; y: number; z: number; s: number }[] = [];
    for (const isl of ISLANDS) {
      if (isl.tree === undefined) continue;
      const s = 0.9 + rnd() * 0.15;
      const x = isl.tree;
      const z = (isl.z0 + isl.z1) / 2;
      spots.push({ x, y: 0.12, z, s });
      this.blk(x, z, 0.5 * s + 0.04, 0.5 * s + 0.04, 3.0 * s + 0.12);
      const proxy = new THREE.BoxGeometry(0.48 * s, 3.0 * s, 0.48 * s);
      proxy.translate(x, 0.12 + 1.5 * s, z);
      this.proxies.push(proxy);
      this.softQuad(x - 0.3, z - 0.1, 0.95 * s, 0.85, 0, 0.125, SOFT.disc, 0.4);
    }
    // Behind the west fence, either side of the gate: kept small and to the
    // road side of the verge, so even their widest crowns (2.3 m east of the
    // trunk at this scale) stop at the fence and never reach the General's head
    for (let z = -15; z <= 1; z += 5.5 + rnd() * 2) spots.push({ x: -101.55 - rnd() * 0.2, y: 0, z, s: 0.6 + rnd() * 0.08 });
    for (let z = 24; z <= 40; z += 5.5 + rnd() * 2) spots.push({ x: -101.55 - rnd() * 0.2, y: 0, z, s: 0.6 + rnd() * 0.08 });
    // The far side of the road
    for (let z = -170; z <= 220; z += 7 + rnd() * 4) spots.push({ x: -119 - rnd() * 4, y: 0, z, s: 1 + rnd() * 0.5 });
    // Round the outer edges of the car park
    for (let x = -98; x <= -2; x += 7 + rnd() * 3) {
      spots.push({ x, y: 0, z: -63 - rnd() * 3, s: 0.9 + rnd() * 0.5 });
      spots.push({ x, y: 0, z: 83 + rnd() * 3, s: 0.9 + rnd() * 0.5 });
    }
    // Past the building
    for (let i = 0; i < 16; i++) spots.push({ x: 38 + rnd() * 34, y: 0, z: -40 + rnd() * 112, s: 1 + rnd() * 0.6 });
    // Out to the horizon, clear of the road and the car park
    for (let placed = 0, guard = 0; placed < 230 && guard < 3000; guard++) {
      const a = rnd() * Math.PI * 2;
      const r = 130 + rnd() * 210;
      const x = LOT_CENTRE.x + Math.cos(a) * r;
      const z = LOT_CENTRE.z + Math.sin(a) * r;
      if (Math.abs(x - L8.road.x) < 10) continue;
      if (x > -106 && x < 75 && z > -70 && z < 95) continue;
      spots.push({ x, y: 0, z, s: 1.3 + rnd() * 1.1 });
      placed++;
    }

    const trunkGeo = new THREE.CylinderGeometry(0.17, 0.26, 3.0, 7);
    trunkGeo.translate(0, 1.5, 0);
    bakeShade(trunkGeo, sunShade);
    const lumps: [number, number, number, number][] = [
      [0, 4.4, 0, 1.9],
      [0.85, 5.25, 0.35, 1.45],
      [-0.75, 4.95, -0.45, 1.4],
      [0.1, 5.9, -0.2, 1.1]
    ];
    const crownGeo = mergeGeometries(
      lumps.map(([x, y, z, r]) => {
        const g = new THREE.IcosahedronGeometry(r, 1);
        g.translate(x, y, z);
        bakeShade(g, sunShade);
        return g;
      }),
      false
    );
    const trunks = new THREE.InstancedMesh(trunkGeo, m.trunk, spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, m.crown, spots.length);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    // Never turned: their light is baked facing the sun
    spots.forEach((t, i) => {
      mtx.compose(p.set(t.x, t.y, t.z), q, sc.set(t.s, t.s * (0.9 + rnd() * 0.25), t.s));
      trunks.setMatrixAt(i, mtx);
      crowns.setMatrixAt(i, mtx);
      crowns.setColorAt(i, col.setHSL(0.24 + rnd() * 0.08, 0.36 + rnd() * 0.2, 0.2 + rnd() * 0.09));
      trunks.setColorAt(i, col.setHSL(0.07 + rnd() * 0.03, 0.22 + rnd() * 0.1, 0.12 + rnd() * 0.05));
    });
    for (const im of [trunks, crowns]) {
      im.frustumCulled = false;
      this.group.add(im);
    }
  }

  // --------------------------------------------------------- backdrop cars

  /**
   * The rest of the car park, beyond the north and south fences: the same
   * rows carrying on, about two in three bays taken. Not part of the fight —
   * boxes of colour with their light baked in, three instanced draws for the
   * lot of them, like Level 7's view of them from the top floor.
   */
  private buildBackdropCars(): void {
    const m = this.m;
    const rnd = lcg(31);
    const spots: { x: number; z: number; yaw: number; c: number }[] = [];
    const zs = [
      ...Array.from({ length: 14 }, (_, k) => -20.2 - L8.pitch * k),
      ...Array.from({ length: 12 }, (_, k) => 46.0 + L8.pitch * k)
    ];
    for (const z of zs) {
      for (const r of ROWS) {
        if (rnd() > 0.64) continue;
        const face = r.face === 0 ? (rnd() < 0.5 ? EAST : WEST) : r.face > 0 ? EAST : WEST;
        spots.push({
          x: r.x + (rnd() - 0.5) * 0.3,
          z: z + (rnd() - 0.5) * 0.2,
          yaw: face + (rnd() - 0.5) * 0.06,
          c: PAINT[Math.floor(rnd() * PAINT.length) % PAINT.length]
        });
      }
    }

    // One model, in the cars' shared frame (front to −Z)
    const body = new THREE.BoxGeometry(1.8, 0.72, 4.4);
    body.translate(0, 0.66, 0);
    bakeShade(body, carShade);
    const parts: THREE.BufferGeometry[] = [];
    const part = (g: THREE.BufferGeometry, hex: number): void => {
      bakeShade(g, carShade, linear(hex));
      parts.push(g);
    };
    const cab = new THREE.BoxGeometry(1.6, 0.6, 2.3);
    cab.translate(0, 1.32, 0.3);
    part(cab, 0x1c242c);
    for (const [x, z] of [[-0.8, -1.38], [0.8, -1.38], [-0.8, 1.38], [0.8, 1.38]]) {
      const w = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 10);
      w.rotateZ(Math.PI / 2);
      w.translate(x, 0.33, z);
      part(w, 0x141516);
    }
    for (const z of [-2.22, 2.22]) {
      const b = new THREE.BoxGeometry(1.84, 0.2, 0.14);
      b.translate(0, 0.42, z);
      part(b, 0x232527);
    }
    for (const x of [-0.62, 0.62]) {
      const h = new THREE.BoxGeometry(0.34, 0.12, 0.04);
      h.translate(x, 0.86, -2.21);
      part(h, 0xd8dcd6);
      const t = new THREE.BoxGeometry(0.34, 0.12, 0.04);
      t.translate(x, 0.86, 2.21);
      part(t, 0x8a1a16);
    }
    const trim = mergeGeometries(parts, false);
    const shadow = new THREE.PlaneGeometry(2.3, 4.9);
    shadow.rotateX(-Math.PI / 2);
    shadow.translate(0, 0.018, 0);
    const suv = shadow.attributes.uv;
    for (let i = 0; i < suv.count; i++) suv.setX(i, SOFT.box[0] + suv.getX(i) * (SOFT.box[1] - SOFT.box[0]));
    const shadowCol = new Float32Array(suv.count * 4);
    for (let i = 0; i < suv.count; i++) shadowCol.set([1, 1, 1, 0.62], i * 4);
    shadow.setAttribute('color', new THREE.BufferAttribute(shadowCol, 4));

    const bodies = new THREE.InstancedMesh(body, m.carBody, spots.length);
    const trims = new THREE.InstancedMesh(trim, m.carTrim, spots.length);
    const shadows = new THREE.InstancedMesh(shadow, m.soft, spots.length);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();
    spots.forEach((s, i) => {
      mtx.compose(V(s.x, 0, s.z), q.setFromAxisAngle(up, s.yaw), one);
      bodies.setMatrixAt(i, mtx);
      trims.setMatrixAt(i, mtx);
      shadows.setMatrixAt(i, mtx);
      bodies.setColorAt(i, col.setHex(s.c));
    });
    for (const im of [shadows, bodies, trims]) {
      im.frustumCulled = false;
      this.group.add(im);
    }
  }

  // --------------------------------------------------------------- skyline

  /** Other people's office blocks, out past the trees in every direction: one merged, unlit mesh. */
  private buildSkyline(): void {
    const rnd = lcg(71);
    const geos: THREE.BufferGeometry[] = [];
    const tints = [0xc9c3b6, 0xa9b0b6, 0x8e8a80, 0xd8d2c4, 0x9aa4ae, 0xb7a58e, 0x7f8a94];
    const add = (x: number, z: number, w: number, d: number, h: number): void => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, h / 2, z);
      const p = g.attributes.position;
      const n = g.attributes.normal;
      const uv = g.attributes.uv;
      const xa = x - w / 2;
      const za = z - d / 2;
      for (let i = 0; i < p.count; i++) {
        // Their windows a storey and a bay a repeat; the roofs plain wall
        if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, 0.02, 0.02);
        else if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, (p.getZ(i) - za) / 3.0, p.getY(i) / 3.3);
        else uv.setXY(i, (p.getX(i) - xa) / 3.0, p.getY(i) / 3.3);
      }
      bakeShade(g, sunShade, linear(tints[Math.floor(rnd() * tints.length) % tints.length]));
      geos.push(g);
    };
    const sector = (count: number, x0: number, x1: number, z0: number, z1: number): void => {
      for (let i = 0; i < count; i++) {
        const w = 14 + rnd() * 26;
        const d = 14 + rnd() * 26;
        const h = 9 + rnd() * rnd() * 44;
        const x = x0 + rnd() * (x1 - x0);
        const z = z0 + rnd() * (z1 - z0);
        // Not across the road's line, and inside the sky
        if (Math.abs(x - L8.road.x) < w / 2 + 14) continue;
        if (Math.hypot(x - LOT_CENTRE.x, z - LOT_CENTRE.z) + Math.max(w, d) > 480) continue;
        add(x, z, w, d, h);
      }
    };
    sector(12, -340, -175, -230, 260);
    sector(8, -260, 160, -340, -150);
    sector(8, -260, 160, 175, 350);
    sector(7, 90, 300, -150, 190);
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), this.m.skyline);
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  // ------------------------------------------------------------------- sky

  /**
   * The sky sphere, inside the camera's reach (the scene sets far to 600),
   * drawn first and never in the depth buffer; and the sun low over the
   * building, where the tower's bulk hides it from most of the lot and it
   * comes out over the roofline from the General's end.
   */
  private buildSky(): void {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(520, 32, 16), this.m.sky);
    sky.position.copy(LOT_CENTRE);
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    this.group.add(sky);
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), this.m.sun);
    sun.position.copy(LOT_CENTRE).addScaledVector(SUN_DIR, 470);
    sun.lookAt(LOT_CENTRE);
    this.group.add(sun);
  }

  // -------------------------------------------------------------- lighting

  /**
   * Daylight, and only daylight: the sky's fill, a little ambient, and the
   * low sun from the east. No shadows (the renderer has none) and no point
   * lights — every point light costs on every lit pixel. All three exist
   * from the first frame and are only ever driven by intensity: the number
   * of lights is baked into every shader, and changing it recompiles the lot.
   */
  private buildLighting(): void {
    this.group.add(new THREE.AmbientLight(0xbfc8d2, 0.5));
    this.group.add(new THREE.HemisphereLight(0xcfe0f2, 0x6b6358, 1.25));
    const sun = new THREE.DirectionalLight(0xffe4c2, 2.9);
    sun.position.copy(LOT_CENTRE).addScaledVector(SUN_DIR, 150);
    sun.target.position.copy(LOT_CENTRE);
    this.group.add(sun, sun.target);
  }

  // ---------------------------------------------------------------- finish

  /** The flat-built geometries into meshes. */
  private finishBatches(): void {
    const m = this.m;
    this.flat(this.grass.geometry('none'), m.grass, 'grass');
    this.flat(this.paint.geometry('rgb'), m.paint, null);
    const soft = this.flat(this.soft.geometry('rgba'), m.soft, null);
    soft.renderOrder = 1;
    this.flat(this.glass.geometry('rgb'), m.glass, 'glass');
    const fence = this.flat(this.fabric.geometry('none'), m.fence, 'metal');
    fence.userData.pierce = true;
    fence.userData.noDecal = true;
    if (this.proxies.length) {
      const trunks = new THREE.Mesh(mergeGeometries(this.proxies, false), m.proxy);
      trunks.visible = false;
      trunks.userData.surface = 'wood';
      this.group.add(trunks);
      this.shootables.push(trunks);
      this.occluders.push(trunks);
    }
  }
}
