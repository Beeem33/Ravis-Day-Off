import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { StreetBlocker } from '../scenes/StreetContracts';
import { bakedCar, box, cylX, cylZ, finish, halfBody, MODELS, roofTop } from './VehicleProps';

/**
 * AirsideProps — Map 11's checkpoint between the airport's taxiway and its
 * runway, and what stands about on the runway side of it.
 *
 * Laid out in StreetBuilder's gate frame: a metres on past the end of the
 * airport road along its tangent, b to the right of it (the apron is a 0..240,
 * the taxiway a 240..408 at b 45..75, the runway a 408..453 along b from −2000
 * to 900, its centreline a 430.5). Paved ground is the frame origin's height;
 * everything off the paving stands on the grass, 25 cm lower.
 *
 *  - The airside security gate across the taxiway at a = 398: a barrier
 *    cabinet each side (b 44 and 76) and a red-and-white boom in two halves,
 *    each hinged at its cabinet and meeting in the middle; a stop line in
 *    front of it and a STOP / SECURITY CHECKPOINT sign on the approach.
 *  - The security hut beside it (a 392, b 80): white, glazed all round,
 *    AIRSIDE SECURITY along its fascia; the security SUV on a hardstand
 *    behind it, white with an orange stripe, AIRPORT SECURITY on its doors and
 *    an amber light bar; a few traffic cones on the verges.
 *  - The airside fence along a = 405 (b −2000..44 and 76..900) and in to the
 *    gate's cabinets: 3 m chain-link on galvanised posts, outriggers leaning
 *    out over the landside with three strands of barbed wire, AUTHORISED
 *    PERSONNEL ONLY — RESTRICTED AREA plates along it.
 *  - Beyond the runway, on hardstands off its far edge: a baggage tug with
 *    two carts in tow, and a fuel bowser. The runway itself is clear.
 *
 * Static pieces are baked into one mesh per material (seven); the two halves
 * of the boom are their own meshes, under `gateArm`. Nothing here is a light.
 */

export interface Airside {
  group: THREE.Group;
  /**
   * The boom: two halves, each pivoting at its cabinet, 1 m up. Set
   * gateArm.rotation.z to lift both together (0 down across the taxiway,
   * ~1.45 standing up); it never turns the pair as a whole. Each half is in
   * gateArm.userData.halves ([b 44 side, b 76 side]) — an Object3D whose own
   * rotation.z lifts it — for breaking them off separately: a half taken out
   * of gateArm is no longer driven by it.
   */
  gateArm: THREE.Object3D;
  /** The middle of the gate line (a 398, b 60) on the paving, and the yaw facing on through it (+f, toward the runway). */
  gate: { pos: THREE.Vector3; yaw: number };
  /** Fence (both runs and the returns to the cabinets), cabinets, hut, the SUV, the stop sign and the runway-side kit. */
  blockers: StreetBlocker[];
  /** The security hut: the middle of its floor, on the ground. */
  hut: THREE.Vector3;
  /** The SUV's amber light-bar lenses: emissiveIntensity 0 is off (as built); ~3 reads as lit. The scene may flash it. */
  beacon: THREE.MeshStandardMaterial;
}

// -------------------------------------------------------------- materials

type Bucket = 'paint' | 'marks' | 'glow' | 'fence' | 'wire' | 'signs' | 'beacon';

/** Atlas regions: [u0, v0, u1, v1]. */
type Region = [number, number, number, number];
type RegionKey = 'airside' | 'restricted' | 'stop' | 'suv' | 'fuel';

interface Mats {
  byBucket: Record<Bucket, THREE.Material>;
  beacon: THREE.MeshStandardMaterial;
  regions: Record<RegionKey, Region>;
}

let shared: Mats | null = null;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('AirsideProps: no 2D canvas');
  return { c, g };
}

function texture(c: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Galvanised chain-link: one 0.6 m tile of diamonds. */
function chainLink(): HTMLCanvasElement {
  const { c, g } = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(196,202,206,1)';
  g.lineWidth = 2;
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

/** A strand of barbed wire: two twisted wires, a four-point barb every 0.3 m tile. */
function barbedWire(): HTMLCanvasElement {
  const { c, g } = canvas(128, 32);
  g.clearRect(0, 0, 128, 32);
  g.strokeStyle = 'rgba(120,124,128,1)';
  g.lineWidth = 2.4;
  for (const ph of [0, Math.PI]) {
    g.beginPath();
    for (let x = 0; x <= 128; x += 2) {
      const y = 16 + Math.sin((x / 128) * Math.PI * 8 + ph) * 2.2;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.lineWidth = 2;
  for (const x of [20, 84]) {
    g.beginPath();
    g.moveTo(x - 7, 7);
    g.lineTo(x + 7, 25);
    g.moveTo(x + 7, 7);
    g.lineTo(x - 7, 25);
    g.stroke();
  }
  return c;
}

/** The signs, one canvas: the hut's fascia, the fence plates, the stop sign, the SUV's doors, the bowser's. */
function signAtlas(): { c: HTMLCanvasElement; regions: Record<RegionKey, Region> } {
  const W = 1024;
  const H = 1024;
  const { c, g } = canvas(W, H);
  g.clearRect(0, 0, W, H);
  const regions = {} as Record<RegionKey, Region>;
  const region = (key: RegionKey, x: number, y: number, w: number, h: number): void => {
    // Half a pixel in, so mipmaps never bleed one sign into the next
    regions[key] = [(x + 1) / W, 1 - (y + h - 1) / H, (x + w - 1) / W, 1 - (y + 1) / H];
  };
  const text = (t: string, x: number, y: number, px: number, colour: string, weight = 'bold', align: CanvasTextAlign = 'center', maxW?: number): void => {
    g.font = `${weight} ${px}px Arial, Helvetica, sans-serif`;
    g.fillStyle = colour;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillText(t, x, y, maxW);
  };

  // AIRSIDE SECURITY: white on navy, a hi-vis rule under it
  g.fillStyle = '#1b2f5e';
  g.fillRect(0, 0, 1024, 160);
  g.fillStyle = '#f2c21b';
  g.fillRect(0, 138, 1024, 14);
  text('AIRSIDE SECURITY', 512, 70, 96, '#f4f4ee', 'bold', 'center', 980);
  region('airside', 0, 0, 1024, 160);

  // AUTHORISED PERSONNEL ONLY — RESTRICTED AREA: a red-headed warning plate
  {
    const x = 0;
    const y = 168;
    g.fillStyle = '#f4f4ee';
    g.fillRect(x, y, 512, 340);
    g.fillStyle = '#c4161c';
    g.fillRect(x, y, 512, 96);
    text('WARNING', x + 256, y + 50, 70, '#f4f4ee');
    text('AUTHORISED', x + 256, y + 138, 50, '#151515', 'bold', 'center', 480);
    text('PERSONNEL ONLY', x + 256, y + 192, 50, '#151515', 'bold', 'center', 480);
    g.fillStyle = '#c4161c';
    g.fillRect(x + 40, y + 226, 432, 5);
    text('RESTRICTED AREA', x + 256, y + 266, 48, '#c4161c', 'bold', 'center', 480);
    text('Airside security zone · Trespassers will be prosecuted', x + 256, y + 314, 19, '#333333', 'normal', 'center', 480);
    g.strokeStyle = '#c4161c';
    g.lineWidth = 8;
    g.strokeRect(x + 4, y + 4, 504, 332);
    region('restricted', x, y, 512, 340);
  }

  // STOP / SECURITY CHECKPOINT
  {
    const x = 512;
    const y = 168;
    g.fillStyle = '#f4f4ee';
    g.fillRect(x, y, 512, 340);
    const cx = x + 120;
    const cy = y + 170;
    g.fillStyle = '#c4161c';
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      const px = cx + Math.cos(a) * 100;
      const py = cy + Math.sin(a) * 100;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = '#f4f4ee';
    g.lineWidth = 6;
    g.stroke();
    text('STOP', cx, cy + 3, 58, '#f4f4ee');
    text('SECURITY', x + 370, y + 110, 46, '#151515', 'bold', 'center', 260);
    text('CHECKPOINT', x + 370, y + 162, 46, '#151515', 'bold', 'center', 260);
    text('ALL VEHICLES', x + 370, y + 226, 30, '#c4161c', 'bold', 'center', 260);
    text('STOP HERE', x + 370, y + 264, 30, '#c4161c', 'bold', 'center', 260);
    g.strokeStyle = '#151515';
    g.lineWidth = 6;
    g.strokeRect(x + 3, y + 3, 506, 334);
    region('stop', x, y, 512, 340);
  }

  // AIRPORT SECURITY, for the SUV's doors: lettering only (the paint shows round it)
  text('AIRPORT SECURITY', 512, 584, 104, '#1c3f7a', 'bold', 'center', 1000);
  region('suv', 0, 516, 1024, 136);

  // The bowser's cab doors and its back: JET A-1, FLAMMABLE
  {
    const y = 664;
    g.fillStyle = '#c4202a';
    g.fillRect(0, y, 1024, 200);
    text('JET A-1', 512, y + 74, 120, '#f4f4ee', 'bold', 'center', 980);
    text('FLAMMABLE  ·  NO SMOKING', 512, y + 160, 50, '#f4f4ee', 'bold', 'center', 980);
    region('fuel', 0, y, 1024, 200);
  }
  return { c, regions };
}

function mats(): Mats {
  if (shared) return shared;
  const atlas = signAtlas();
  const signTex = texture(atlas.c, false);
  // Amber lenses that read as amber unlit; lit, not tone-mapped, so they stay amber rather than going white
  const beacon = new THREE.MeshStandardMaterial({ color: 0x9a5a10, roughness: 0.3, metalness: 0.05, emissive: 0xff5000, emissiveIntensity: 0, toneMapped: false });
  shared = {
    byBucket: {
      paint: new THREE.MeshLambertMaterial({ vertexColors: true }),
      // Paint on the paving: pulled forward in depth so it never fights the asphalt
      marks: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
      fence: new THREE.MeshLambertMaterial({ map: texture(chainLink(), true), transparent: true, alphaTest: 0.05, side: THREE.DoubleSide }),
      wire: new THREE.MeshLambertMaterial({ map: texture(barbedWire(), true), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }),
      // Lit a little from within, so a sign in its own shade still reads
      signs: new THREE.MeshLambertMaterial({
        map: signTex,
        emissive: 0xffffff,
        emissiveMap: signTex,
        emissiveIntensity: 0.25,
        alphaTest: 0.5,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2
      }),
      beacon
    },
    beacon,
    regions: atlas.regions
  };
  return shared;
}

// ------------------------------------------------------------ the baking

const UP = new THREE.Vector3(0, 1, 0);
const GRASS = -0.25;

/** Every static piece, by material, in the world frame. */
class Bake {
  readonly lists: Record<Bucket, THREE.BufferGeometry[]> = { paint: [], marks: [], glow: [], fence: [], wire: [], signs: [], beacon: [] };
  /** A raw geometry, coloured, placed by `m` (or already in the world when null). */
  put(b: Bucket, g: THREE.BufferGeometry, colour: number, m: THREE.Matrix4 | null): void {
    const out = finish(g, colour);
    if (m) out.applyMatrix4(m);
    this.lists[b].push(out);
  }
  /** A geometry already in the attribute set `finish` makes (a baked car's), cloned and placed. */
  putReady(b: Bucket, g: THREE.BufferGeometry, m: THREE.Matrix4, colour?: number): void {
    const out = g.clone();
    if (colour !== undefined) {
      const c = new THREE.Color(colour);
      const a = out.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) a.setXYZ(i, c.r, c.g, c.b);
    }
    out.applyMatrix4(m);
    this.lists[b].push(out);
  }
}

/** A prop being built in its own frame (−Z its front, +X its right, y up from its ground), then placed. */
class Piece {
  private parts: { g: THREE.BufferGeometry; c: number; b: Bucket }[] = [];
  constructor(private readonly regions: Record<RegionKey, Region>) {}
  add(g: THREE.BufferGeometry, c: number, b: Bucket = 'paint'): this {
    this.parts.push({ g, c, b });
    return this;
  }
  /** A box standing on y0. */
  up(w: number, h: number, d: number, x: number, y0: number, z: number, c: number, b: Bucket = 'paint', rx = 0, ry = 0, rz = 0): this {
    return this.add(box(w, h, d, x, y0 + h / 2, z, rx, ry, rz), c, b);
  }
  /** An upright cylinder standing on y0. */
  cyl(rTop: number, rBot: number, h: number, seg: number, x: number, y0: number, z: number, c: number, b: Bucket = 'paint'): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg).translate(x, y0 + h / 2, z), c, b);
  }
  /** A sign w × h centred at (x, y, z), its face turned ry from facing +Z. */
  sign(w: number, h: number, key: RegionKey, x: number, y: number, z: number, ry: number): this {
    const g = new THREE.PlaneGeometry(w, h);
    const [u0, v0, u1, v1] = this.regions[key];
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
    g.rotateY(ry);
    g.translate(x, y, z);
    return this.add(g, 0xffffff, 'signs');
  }
  into(bake: Bake, m: THREE.Matrix4): void {
    for (const p of this.parts) bake.put(p.b, p.g, p.c, m);
    this.parts = [];
  }
}

/** Cheap deterministic numbers: the same luggage every time. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** A box from p to q (world), w square in section. */
function rod(p: THREE.Vector3, q: THREE.Vector3, w: number): THREE.BufferGeometry {
  const d = q.clone().sub(p);
  const len = d.length();
  const g = new THREE.BoxGeometry(w, w, Math.max(0.001, len));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.divideScalar(len || 1)));
  g.translate((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
  return g;
}

/** A flat quad p0 p1 p2 p3 (world, either winding), with its UVs. */
function quad(p: THREE.Vector3[], uv: [number, number][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const order = [0, 1, 2, 0, 2, 3];
  g.setAttribute('position', new THREE.Float32BufferAttribute(order.flatMap((i) => [p[i].x, p[i].y, p[i].z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(order.flatMap((i) => uv[i]), 2));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------ the props

const COL = {
  conc: 0xbdb9b0,
  white: 0xeceae4,
  galv: 0x9aa1a6,
  dark: 0x2a2c30,
  black: 0x151516,
  tyre: 0x161617,
  hub: 0x8a8f94,
  glass: 0x22303a,
  navy: 0x1c3f7a,
  red: 0xc8241c,
  boomRed: 0xd22a1e,
  boomWhite: 0xf2f2ee,
  orange: 0xf26a12,
  hiViz: 0xf2c21b,
  amber: 0xffa21a,
  cartBlue: 0x2d5aa8
};

/** A wheel on the ground, along X. */
function wheelAt(p: Piece, r: number, w: number, x: number, z: number, y0 = 0): void {
  p.add(cylX(r, w, 14, x, y0 + r, z), COL.tyre);
  p.add(cylX(r * 0.5, w + 0.02, 10, x, y0 + r, z), COL.hub);
}

/** A covered baggage cart: a flat deck on four small wheels, a canopy on corner posts, curtains rolled up, luggage, a drawbar to the front. */
function baggageCart(p: Piece, seed: number): void {
  const rnd = rng(seed);
  p.up(1.2, 0.12, 2.6, 0, 0.3, 0, COL.dark);
  p.up(1.5, 0.08, 3.0, 0, 0.44, 0, 0x5a6068);
  for (const sx of [-1, 1]) p.up(0.05, 0.1, 3.0, sx * 0.725, 0.52, 0, COL.cartBlue);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.up(0.06, 1.36, 0.06, sx * 0.72, 0.52, sz * 1.47, COL.cartBlue);
  p.up(1.62, 0.05, 3.12, 0, 1.88, 0, 0xdcdfe2);
  // Curtains rolled up under the canopy's edges, and a rail across each end
  for (const sx of [-1, 1]) p.add(cylZ(0.055, 2.9, 8, sx * 0.76, 1.8, 0), 0x1f4f9a);
  for (const sz of [-1, 1]) p.up(1.44, 0.05, 0.04, 0, 0.92, sz * 1.47, COL.cartBlue);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheelAt(p, 0.2, 0.12, sx * 0.62, sz * 1.1);
  // Drawbar, its front end down on the tarmac, and its ring
  p.add(box(0.07, 0.06, 1.0, 0, 0.27, -1.95, -0.22), COL.dark);
  p.add(new THREE.TorusGeometry(0.06, 0.015, 5, 10).rotateX(Math.PI / 2).translate(0, 0.17, -2.48), COL.dark);
  // Luggage: suitcases and holdalls in a loose row along the deck
  const bags = [0x1d1e21, 0x7c1b1b, 0x1f3f6f, 0x6b6f75, 0x3f5a2b, 0x8a6a3a, 0x2c2c2e, 0x9a2f5a];
  let z = -1.3;
  while (z < 1.2) {
    const l = 0.36 + rnd() * 0.32;
    const w = 0.42 + rnd() * 0.42;
    const h = 0.2 + rnd() * 0.42;
    const x = (rnd() - 0.5) * (1.3 - w);
    p.up(w, h, l, x, 0.52, z + l / 2, bags[Math.floor(rnd() * bags.length)], 'paint', 0, (rnd() - 0.5) * 0.5);
    if (rnd() < 0.45) {
      // A second one on top
      const w2 = w * (0.6 + rnd() * 0.3);
      p.up(w2, 0.18 + rnd() * 0.2, l * 0.85, x + (rnd() - 0.5) * 0.1, 0.52 + h, z + l / 2, bags[Math.floor(rnd() * bags.length)], 'paint', 0, (rnd() - 0.5) * 0.6);
    }
    z += l + 0.06;
  }
}

/** A baggage tug: low and yellow, an open seat under a canopy, a beacon on top, the hitch behind. */
function baggageTug(p: Piece): void {
  p.up(1.3, 0.5, 2.5, 0, 0.28, 0, COL.hiViz);
  p.up(1.32, 0.3, 0.9, 0, 0.78, -0.75, COL.hiViz);
  for (const sz of [-1, 1]) p.up(1.38, 0.18, 0.12, 0, 0.26, sz * 1.3, COL.black);
  // Seat, back, wheel
  p.up(0.55, 0.12, 0.5, 0, 0.78, 0.45, 0x222326);
  p.up(0.55, 0.5, 0.1, 0, 0.9, 0.74, 0x222326, 'paint', -0.15);
  p.add(new THREE.CylinderGeometry(0.025, 0.03, 0.42, 6).rotateX(0.5).translate(0, 1.18, -0.08), COL.black);
  p.add(new THREE.TorusGeometry(0.16, 0.022, 6, 14).rotateX(Math.PI / 2 + 0.5).translate(0, 1.36, 0.02), COL.black);
  // Canopy
  for (const sx of [-1, 1]) for (const z of [-0.27, 0.95]) p.up(0.05, 1.25, 0.05, sx * 0.6, 0.78, z, COL.dark);
  p.up(1.45, 0.06, 1.55, 0, 2.03, 0.34, 0xe8e8e4);
  p.cyl(0.07, 0.08, 0.12, 10, 0, 2.09, 0.34, COL.amber, 'glow');
  // Lamps on the nose
  for (const sx of [-1, 1]) p.up(0.18, 0.08, 0.02, sx * 0.45, 0.88, -1.205, 0xfff2d0, 'glow');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheelAt(p, 0.3, 0.24, sx * 0.6, sz * 0.85);
  p.up(0.12, 0.08, 0.25, 0, 0.35, 1.45, COL.dark);
}

/** A fuel bowser: a cab-forward truck with an elliptical tank, the pumping cabinet and hose reel at the back. */
function fuelBowser(p: Piece): void {
  const WHITE = 0xeeeeea;
  const RED = 0xc4202a;
  p.up(1.0, 0.25, 8.4, 0, 0.62, 0.2, COL.dark);
  // Cab: front at z −4.2
  p.up(2.45, 1.75, 1.7, 0, 0.85, -3.35, WHITE);
  p.up(2.47, 0.32, 1.72, 0, 0.85, -3.35, RED);
  p.up(2.2, 0.72, 0.02, 0, 1.72, -4.205, COL.glass);
  for (const sx of [-1, 1]) p.up(0.02, 0.6, 0.85, sx * 1.226, 1.8, -3.55, COL.glass);
  p.up(2.5, 0.3, 0.16, 0, 0.42, -4.27, COL.black);
  for (const sx of [-1, 1]) p.up(0.3, 0.14, 0.02, sx * 0.85, 1.25, -4.215, 0xfff2d0, 'glow');
  p.cyl(0.08, 0.09, 0.14, 10, 0, 2.6, -3.35, COL.amber, 'glow');
  for (const sx of [-1, 1]) p.sign(0.95, 0.19, 'fuel', sx * 1.237, 1.35, -3.3, sx * (Math.PI / 2));
  // The tank: an ellipse 2.3 wide and 1.7 deep, 5.6 long, white with a red band along each side
  p.add(new THREE.CylinderGeometry(1, 1, 5.6, 22, 1).rotateX(Math.PI / 2).scale(1.15, 0.85, 1).translate(0, 2.0, 0.5), WHITE);
  for (const sx of [-1, 1]) p.up(0.012, 0.2, 5.4, sx * 1.153, 1.9, 0.5, RED);
  p.up(1.2, 0.3, 5.6, 0, 0.85, 0.5, COL.dark);
  // Walkway rails along the top
  for (const sx of [-1, 1]) {
    p.up(0.04, 0.04, 5.0, sx * 0.5, 3.15, 0.5, 0xb0b4b8);
    for (const z of [-1.8, 0.5, 2.8]) p.up(0.03, 0.32, 0.03, sx * 0.5, 2.83, z, 0xb0b4b8);
  }
  // Pumping cabinet and hose reel at the back
  p.up(2.4, 1.4, 1.0, 0, 0.85, 3.9, 0x9a9ea3);
  p.add(cylX(0.36, 1.2, 16, 0, 1.6, 4.45), COL.black);
  p.add(cylX(0.18, 1.24, 10, 0, 1.6, 4.45), 0x5a5d62);
  p.sign(1.6, 0.31, 'fuel', 0, 1.0, 4.405, 0);
  // Ladder up the back of the tank
  for (const sx of [-1, 1]) p.up(0.04, 1.9, 0.04, 1.0 + sx * 0.18, 0.85, 3.36, 0xb0b4b8);
  for (let k = 0; k < 6; k++) p.up(0.4, 0.03, 0.03, 1.0, 1.05 + k * 0.3, 3.36, 0xb0b4b8);
  // Wheels: one axle under the cab, a tandem under the tank
  for (const z of [-3.2, 1.9, 3.1]) {
    for (const sx of [-1, 1]) {
      wheelAt(p, 0.5, 0.36, sx * 1.0, z);
      if (z > 0) p.up(0.4, 0.06, 1.1, sx * 1.0, 1.04, z, COL.black);
    }
  }
}

/** A traffic cone: orange, two white bands, a black square foot. */
function cone(p: Piece, x: number, y0: number, z: number): void {
  p.up(0.38, 0.04, 0.38, x, y0, z, COL.black);
  p.cyl(0.035, 0.16, 0.68, 12, x, y0 + 0.04, z, 0xff5a1a);
  // The cone's radius at height y over its foot, and two reflective bands just proud of it
  const rad = (y: number): number => 0.16 - (0.125 * (y - 0.04)) / 0.68 + 0.004;
  for (const [y, h] of [[0.33, 0.08], [0.48, 0.06]] as const) p.cyl(rad(y + h), rad(y), h, 12, x, y0 + y, z, 0xf0f0ec);
}

/** The airport's security SUV, parked: a baked SUV painted white, the stripe, the lettering and the light bar added. */
function securitySuv(bake: Bake, p: Piece, m: THREE.Matrix4): void {
  const baked = bakedCar('suv');
  const model = MODELS.suv;
  bake.putReady('paint', baked.paint, m, 0xf2f2ee);
  bake.putReady('paint', baked.trim, m);
  bake.putReady('paint', baked.glass, m, 0x1d242c);
  bake.putReady('glow', baked.lamps, m);
  const hw = halfBody(model);
  for (const s of [-1, 1]) {
    // Between the arches, below the handles
    p.add(box(0.008, 0.12, 1.78, s * (hw + 0.004), 0.66, -0.04), COL.orange);
    p.add(box(0.008, 0.026, 1.78, s * (hw + 0.004), 0.575, -0.04), COL.navy);
    p.sign(1.06, 0.14, 'suv', s * (hw + 0.009), 0.82, -0.29, s * (Math.PI / 2));
  }
  // Light bar across the front of the roof, between the rails
  const u = -0.42;
  const yb = roofTop(model, u) + 0.03;
  p.add(box(1.24, 0.035, 0.3, 0, yb - 0.005, -u), COL.black);
  for (const sx of [-1, 1]) p.add(box(0.08, 0.05, 0.2, sx * 0.5, yb - 0.035, -u), COL.black);
  for (const sx of [-1, 1]) p.add(box(0.5, 0.09, 0.26, sx * 0.35, yb + 0.057, -u), 0xffffff, 'beacon');
  p.add(box(0.18, 0.08, 0.24, 0, yb + 0.052, -u), 0xd9dcd6);
  p.into(bake, m);
}

/** The security hut, in its own frame: 2.6 m across (its lane side toward −X), 3.2 m along (−Z toward the runway), on a concrete pad. */
function securityHut(p: Piece): void {
  const hx = 1.3;
  const hz = 1.6;
  p.up(3.6, 0.3, 4.2, 0, GRASS, 0, COL.conc);
  p.up(2.6, 1.0, 3.2, 0, 0.05, 0, COL.white);
  // The window band: glass all round, set in behind the corner posts and mullions
  p.up(2.54, 1.1, 3.14, 0, 1.05, 0, COL.glass);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.up(0.14, 1.1, 0.14, sx * (hx - 0.07), 1.05, sz * (hz - 0.07), COL.white);
  for (const sx of [-1, 1]) for (const z of [-0.53, 0.53]) p.up(0.06, 1.1, 0.06, sx * (hx - 0.02), 1.05, z, COL.white);
  for (const sz of [-1, 1]) p.up(0.06, 1.1, 0.06, 0, 1.05, sz * (hz - 0.02), COL.white);
  p.up(2.64, 0.05, 3.24, 0, 1.03, 0, 0xc9c6bf);
  // The door, on the back (+X)
  p.up(0.04, 2.08, 0.9, hx + 0.012, 0.05, 0.9, 0x9aa3ab);
  p.up(0.03, 0.5, 0.5, hx + 0.03, 1.3, 0.9, COL.glass);
  p.up(0.05, 0.03, 0.14, hx + 0.045, 1.0, 0.6, 0xc9cbcd);
  // Fascia with a navy band, the roof overhanging it
  p.up(2.6, 0.5, 3.2, 0, 2.15, 0, COL.white);
  p.up(2.62, 0.08, 3.22, 0, 2.17, 0, COL.navy);
  p.up(3.1, 0.14, 3.7, 0, 2.65, 0, 0x3a3d42);
  // A/C unit on the back wall, a lamp over the door, a camera on the corner over the lane
  p.up(0.3, 0.45, 0.7, hx + 0.15, 1.3, -0.6, 0xc9cbcd);
  p.up(0.1, 0.06, 0.22, hx + 0.07, 2.2, 0.9, 0xfff0c8, 'glow');
  p.up(0.06, 0.24, 0.06, -(hx + 0.2), 2.79, -(hz + 0.2), COL.dark);
  p.up(0.12, 0.12, 0.28, -(hx + 0.2), 2.93, -(hz + 0.2), 0xe8e8e4, 'paint', 0, 0.6, 0);
  // AIRSIDE SECURITY over the lane, the approach and the runway side; STOP under the lane window
  p.sign(2.3, 0.36, 'airside', -(hx + 0.008), 2.45, 0, -Math.PI / 2);
  p.sign(2.3, 0.36, 'airside', 0, 2.45, hz + 0.008, 0);
  p.sign(2.3, 0.36, 'airside', 0, 2.45, -(hz + 0.008), Math.PI);
  p.sign(0.84, 0.56, 'stop', -(hx + 0.008), 0.55, -0.55, -Math.PI / 2);
  p.sign(0.66, 0.44, 'restricted', -(hx + 0.008), 0.55, 0.65, -Math.PI / 2);
}

/** A barrier cabinet, in its own frame (its approach face toward +Z), on the grass. */
function barrierCabinet(p: Piece): void {
  p.up(0.62, 0.35, 0.56, 0, GRASS, 0, COL.conc);
  p.up(0.42, 0.86, 0.36, 0, 0.1, 0, 0xeeeeea);
  p.up(0.44, 0.12, 0.38, 0, 0.68, 0, COL.red);
  p.up(0.46, 0.05, 0.4, 0, 0.96, 0, COL.dark);
  // Its signal on top, facing the approach: red lit, green dark
  p.up(0.16, 0.3, 0.14, 0, 1.01, 0.05, COL.black);
  p.up(0.09, 0.09, 0.02, 0, 1.2, 0.125, 0xff2a1a, 'glow');
  p.up(0.09, 0.09, 0.02, 0, 1.07, 0.125, 0x0f3a1e, 'glow');
  p.sign(0.36, 0.24, 'restricted', 0, 0.42, 0.184, 0);
}

/** One half of the boom, in its pivot's frame: from the hub out along +X to `len`, red and white in 0.6 m bands, tapering. */
function boomHalf(len: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const x0 = 0.12;
  const n = Math.ceil((len - x0) / 0.6);
  for (let i = 0; i < n; i++) {
    const a = x0 + ((len - x0) * i) / n;
    const b = x0 + ((len - x0) * (i + 1)) / n;
    const t = (a + b) / 2 / len;
    const h = 0.13 + (0.075 - 0.13) * t;
    const d = 0.09 + (0.06 - 0.09) * t;
    parts.push(finish(box(b - a + 0.002, h, d, (a + b) / 2, 0, 0), i % 2 ? COL.boomWhite : COL.boomRed));
  }
  // A rubber tip, the hub and its bracket on the cabinet
  parts.push(finish(box(0.06, 0.085, 0.07, len + 0.02, 0, 0), COL.black));
  parts.push(finish(cylZ(0.1, 0.18, 12, 0, 0, 0), 0x3a3c40));
  parts.push(finish(box(0.2, 0.16, 0.1, 0.08, 0, 0), 0x3a3c40));
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error('AirsideProps: could not merge the boom');
  g.computeBoundingSphere();
  return g;
}

/** The boom's two halves under one parent whose rotation.z lifts them both, and never turns the pair. */
class GateArms extends THREE.Group {
  readonly halves: THREE.Object3D[] = [];
  private static still = new THREE.Quaternion();
  override updateMatrix(): void {
    for (const h of this.halves) if (h.parent === this) h.rotation.z = this.rotation.z;
    this.matrix.compose(this.position, GateArms.still, this.scale);
    this.matrixWorldNeedsUpdate = true;
  }
}

// ------------------------------------------------------------ the build

/**
 * Build the airside: `frame` is StreetBuilder's gate frame — world(a, b) =
 * origin + f·a + r·b, f and r unit and horizontal, r to the right of f
 * (r = (−f.z, 0, f.x)), origin on the paving at the airport road's end.
 */
export function buildAirside(frame: { origin: THREE.Vector3; f: THREE.Vector3; r: THREE.Vector3 }): Airside {
  const { origin, f, r } = frame;
  const M = mats();
  const yawF = Math.atan2(-f.x, -f.z);
  const Y0 = origin.y;
  const W = (a: number, b: number, y = 0): THREE.Vector3 => new THREE.Vector3(origin.x + f.x * a + r.x * b, Y0 + y, origin.z + f.z * a + r.z * b);
  const one = new THREE.Vector3(1, 1, 1);
  /** A prop's frame at (a, b), y up from the paving: facing +f, turned `turn` (+ left) from it. */
  const at = (a: number, b: number, y = 0, turn = 0): THREE.Matrix4 =>
    new THREE.Matrix4().compose(W(a, b, y), new THREE.Quaternion().setFromAxisAngle(UP, yawF + turn), one);
  const blockers: StreetBlocker[] = [];
  const block = (a: number, b: number, turn: number, halfX: number, halfZ: number, minY: number, maxY: number): void => {
    blockers.push({ centre: W(a, b, (minY + maxY) / 2), halfX, halfZ, yaw: yawF + turn, minY: Y0 + minY, maxY: Y0 + maxY });
  };
  const bake = new Bake();
  const p = new Piece(M.regions);
  const group = new THREE.Group();
  group.name = 'airside';

  // ---- the gate: cabinets, the boom, the stop line and the stop sign
  const GATE_A = 398;
  for (const b of [44, 76]) {
    barrierCabinet(p);
    p.into(bake, at(GATE_A, b));
    block(GATE_A, b, 0, 0.3, 0.28, GRASS, 1.3);
  }
  const arms = new GateArms();
  arms.name = 'gateArm';
  const tipGap = 0.05;
  for (const [b, turn] of [[44.31, 0], [75.69, Math.PI]] as const) {
    const pivot = new THREE.Group();
    pivot.name = b < 60 ? 'gateArmL' : 'gateArmR';
    pivot.position.copy(W(GATE_A, b, 1.0));
    pivot.rotation.set(0, yawF + turn, 0);
    const len = Math.abs(60 - b) - tipGap - 0.04;
    const mesh = new THREE.Mesh(boomHalf(len), M.byBucket.paint);
    mesh.userData.surface = 'metal';
    pivot.add(mesh);
    arms.add(pivot);
    arms.halves.push(pivot);
  }
  arms.userData.halves = arms.halves;
  group.add(arms);
  // The stop line, and the sign on the approach's left verge
  {
    const a = 395.4;
    const p0 = W(a - 0.25, 45.3, 0.012);
    const p1 = W(a + 0.25, 45.3, 0.012);
    const p2 = W(a + 0.25, 74.7, 0.012);
    const p3 = W(a - 0.25, 74.7, 0.012);
    // Wound to face up
    bake.put('marks', quad([p0, p3, p2, p1], [[0, 0], [0, 1], [1, 1], [1, 0]]), 0xeeeee6, null);
    // Facing the approach (its frame turned round: −Z toward −f), the post behind the plate
    p.cyl(0.04, 0.04, 2.55, 6, 0, GRASS, 0.07, COL.galv);
    p.up(0.92, 0.62, 0.025, 0, 1.6, 0.02, COL.galv);
    p.sign(0.9, 0.6, 'stop', 0, 1.91, -0.002, Math.PI);
    p.into(bake, at(389, 42.6, 0, Math.PI));
    block(389, 42.6, 0, 0.1, 0.1, GRASS, 2.3);
  }

  // ---- the hut, the SUV on its hardstand, cones on the verges
  const HUT = { a: 392, b: 80 };
  securityHut(p);
  p.into(bake, at(HUT.a, HUT.b));
  block(HUT.a, HUT.b, 0, 1.36, 1.66, GRASS, 2.9);
  p.up(7.6, 0.27, 9.4, 0, GRASS, 0, COL.conc);
  p.into(bake, at(384.4, 81.6));
  securitySuv(bake, p, at(384.6, 81.6, 0.02));
  block(384.6, 81.6, 0, 0.98, 2.4, 0, 1.9);
  for (const [a, b, y] of [[382, 43.3, GRASS], [386, 43.3, GRASS], [390, 43.3, GRASS], [394, 43.3, GRASS], [381.5, 76.8, GRASS], [385.5, 76.8, GRASS], [388.4, 84.9, 0.02], [380.4, 84.9, 0.02]] as const) {
    cone(p, 0, y, 0);
    p.into(bake, at(a, b, 0, a * 0.7));
  }

  // ---- the airside fence: along a = 405 and in to the cabinets, leaning out over the landside
  {
    const H = 3.0;
    const runs: { pts: [number, number][]; out: [number, number][] }[] = [
      // From the left cabinet out to the fence line, then away to the runway's far end (b −2000)
      { pts: [[GATE_A + 0.3, 44], [405, 44], [405, -2000]], out: [[0, -1], [-1, 0]] },
      { pts: [[GATE_A + 0.3, 76], [405, 76], [405, 900]], out: [[0, 1], [-1, 0]] }
    ];
    const T = 0.6;
    for (const run of runs) {
      let acc = 0;
      for (let i = 0; i < run.pts.length - 1; i++) {
        const [a0, b0] = run.pts[i];
        const [a1, b1] = run.pts[i + 1];
        const len = Math.hypot(a1 - a0, b1 - b0);
        const n = Math.max(1, Math.ceil(len / 3.0));
        const [oa, ob] = run.out[i];
        const out = new THREE.Vector3(f.x * oa + r.x * ob, 0, f.z * oa + r.z * ob);
        const arm = out.clone().multiplyScalar(Math.SQRT1_2).add(new THREE.Vector3(0, Math.SQRT1_2, 0));
        const tops: THREE.Vector3[] = [];
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const a = a0 + (a1 - a0) * t;
          const b = b0 + (b1 - b0) * t;
          const top = W(a, b, H);
          tops.push(top);
          // The corner post is the last leg's; it takes this leg's outrigger as well
          if (k > 0 || i === 0) bake.put('paint', new THREE.CylinderGeometry(0.045, 0.045, H + 0.07 - GRASS, 6).translate(top.x, Y0 + (GRASS + H + 0.07) / 2, top.z), COL.galv, null);
          bake.put('paint', rod(top, top.clone().addScaledVector(arm, 0.64), 0.04), COL.galv, null);
        }
        for (let k = 0; k < n; k++) {
          const A = tops[k];
          const B = tops[k + 1];
          bake.put('paint', rod(A, B, 0.045), COL.galv, null);
          // The mesh, from just off the grass to the top rail
          const lo = GRASS + 0.05;
          const s0 = acc + (len * k) / n;
          const s1 = acc + (len * (k + 1)) / n;
          bake.put(
            'fence',
            quad(
              [new THREE.Vector3(A.x, Y0 + lo, A.z), new THREE.Vector3(B.x, Y0 + lo, B.z), new THREE.Vector3(B.x, Y0 + H, B.z), new THREE.Vector3(A.x, Y0 + H, A.z)],
              [[s0 / T, lo / T], [s1 / T, lo / T], [s1 / T, H / T], [s0 / T, H / T]]
            ),
            0xffffff,
            null
          );
          // Three strands of barbed wire along the outriggers
          for (let s = 1; s <= 3; s++) {
            const d = 0.2 * s;
            const a = A.clone().addScaledVector(arm, d);
            const b = B.clone().addScaledVector(arm, d);
            const hh = 0.035;
            bake.put(
              'wire',
              quad([a.clone().setY(a.y - hh), b.clone().setY(b.y - hh), b.clone().setY(b.y + hh), a.clone().setY(a.y + hh)], [[s0 / 0.3, 0], [s1 / 0.3, 0], [s1 / 0.3, 1], [s0 / 0.3, 1]]),
              0xffffff,
              null
            );
          }
        }
        // Blocking the whole of this leg
        const ca = (a0 + a1) / 2;
        const cb = (b0 + b1) / 2;
        if (Math.abs(b1 - b0) > Math.abs(a1 - a0)) block(ca, cb, 0, Math.abs(b1 - b0) / 2 + 0.1, 0.12, GRASS, H + 0.5);
        else block(ca, cb, 0, 0.12, Math.abs(a1 - a0) / 2 + 0.1, GRASS, H + 0.5);
        acc += len;
      }
    }
    // The warning plates, on the landside face
    for (const b of [30, 12, -15, -50, -95, -150, -220, -300, -400, -520, -640, -780, -940, -1120, -1320, -1540, -1780, 90, 110, 140, 185, 250, 340, 460, 600, 760, 880]) {
      p.up(0.92, 0.62, 0.02, 0, 1.3, 0.05, COL.galv);
      p.sign(0.9, 0.6, 'restricted', 0, 1.61, 0.062, 0);
      p.into(bake, at(405, b));
    }
  }

  // ---- beyond the runway: hardstands off its far edge, a tug and two carts, a fuel bowser
  {
    // Turned a quarter (facing −r): the pads' X runs along f, their Z along r
    p.up(8, 0.27, 16, 0, GRASS, 0, COL.conc);
    p.into(bake, at(463, -59, 0, Math.PI / 2));
    baggageTug(p);
    p.into(bake, at(463, -63.2, 0.02, Math.PI / 2));
    block(463, -63.2, Math.PI / 2, 0.72, 1.45, 0, 2.1);
    for (const [b, seed] of [[-59.1, 11], [-54.6, 23]] as const) {
      baggageCart(p, seed);
      p.into(bake, at(463, b, 0.02, Math.PI / 2));
      block(463, b, Math.PI / 2, 0.8, 1.6, 0, 1.95);
    }
    p.up(6, 0.27, 11, 0, GRASS, 0, COL.conc);
    p.into(bake, at(463, -232, 0, Math.PI / 2));
    fuelBowser(p);
    p.into(bake, at(463, -232, 0.02, Math.PI / 2));
    block(463, -231.9, Math.PI / 2, 1.3, 4.4, 0, 3.2);
  }

  // ---- one mesh per material
  for (const [key, list] of Object.entries(bake.lists) as [Bucket, THREE.BufferGeometry[]][]) {
    if (!list.length) continue;
    const g = mergeGeometries(list, false);
    for (const l of list) l.dispose();
    if (!g) throw new Error(`AirsideProps: could not merge the ${key}`);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, M.byBucket[key]);
    mesh.name = `airside:${key}`;
    mesh.userData.surface = 'metal';
    group.add(mesh);
  }

  return {
    group,
    gateArm: arms,
    gate: { pos: W(GATE_A, 60), yaw: yawF },
    blockers,
    hut: W(HUT.a, HUT.b, 0),
    beacon: M.beacon
  };
}
