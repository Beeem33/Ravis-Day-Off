import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { rackAK } from '../entities/AkModel';

/**
 * The coworkers' van and what's in it: a big high-roofed panel van in plain
 * gunmetal grey. A short sloping bonnet that runs up into a raked screen, a
 * proper face (grille in a chrome surround between swept headlamps, a deep
 * black bumper with its intake, fog lamps and plate), black arches, sills and
 * rubbing strips, a sliding side door with its own window, a running board
 * under it, mirrors on arms, tall tail lamps, a step bumper at the back.
 *
 * Inside, a crew bus: two long padded benches facing across a clear aisle,
 * seat belts, a grab rail down each side of the roof with its straps, LED
 * strips, a ribbed rubber floor with tie-down rails, a bulkhead behind the cab
 * with the plan on its whiteboard, a first-aid kit and an extinguisher by the
 * door, kit bags under the benches; and the arsenal on the walls and floor:
 * rifles, shotguns, pistols, crates of grenades, ammo cans, spare vests and
 * helmets. And the badge Sanjay took off a dead contractor.
 *
 * Van frame as the cars': origin on the ground at the middle of the
 * footprint, nose toward −Z, its right +X (the sliding door's side).
 */

export interface VanRig {
  group: THREE.Group;
  /** Everything above the axles: pitch and roll it as it brakes, corners and rides. Pivots at axle height. */
  body: THREE.Group;
  /** Each wheel spins about its own X: add to rotation.x to roll forward. */
  wheels: THREE.Object3D[];
  /** The sliding side door: 0 shut .. 1 slid back open. */
  setDoor(k: number): void;
  /** Van frame, on the floor right under each place's hips, facing across; the driver's seat. Front to back. */
  seats: { left: THREE.Vector3[]; right: THREE.Vector3[]; driver: THREE.Vector3 };
  /** The load bay floor's height (van frame at rest). */
  floorY: number;
  /**
   * The way in and out of the side door, van frame: on the floor just inside
   * it, on its sill, on the running board under it, and on the ground outside.
   */
  doorIn: THREE.Vector3;
  doorSill: THREE.Vector3;
  doorStep: THREE.Vector3;
  doorOut: THREE.Vector3;
  /** Its length and width, for whoever has to know what it runs into. */
  length: number;
  width: number;
  /** The rifles on the rack, each its own object, for taking down. */
  rack: THREE.Object3D[];
  /** The load bay's dome light, and a red work light for the drive (intensity 0 is off; neither ever leaves the scene). */
  light: THREE.PointLight;
  redLight: THREE.PointLight;
  lamp: THREE.MeshStandardMaterial;
  headlights: THREE.MeshStandardMaterial;
  /** The light the headlamps throw down the road ahead: off (0) until it's dark enough to want them. */
  beams: THREE.SpotLight[];
  brakelights: THREE.MeshStandardMaterial;
  /** Every mesh the body carries (for render flags). */
  meshes: THREE.Mesh[];
}

const L = 8.6;
const W = 2.5;
const H = 3.15;
/** Wheel radius, and the height the body pivots at. */
const AXLE = 0.4;
const FLOOR = 0.68;
const WALL = 0.05;
/** The bodywork's bottom edge between the arches. */
const BOT = 0.45;
/** The arches' radius, and where the axles are. */
const ARCH = 0.53;
const AXLE_Z = [-3.05, 2.75];
/** The nose; the bonnet's back edge at the foot of the screen; the screen's top, where the roof starts. */
const NOSE = -L / 2;
const COWL = -3.2;
const ROOF0 = -2.25;
const SCREEN_Y = 1.42;
/** The cab, then the load bay from behind the front seats to the rear doors. */
const BAY0 = -1.7;
const BAY1 = L / 2 - 0.06;
/** The sliding door's opening, along the right side. */
const DOOR0 = -1.55;
const DOOR1 = 0.2;
const DOOR_TOP = 2.75;
/** The running board under the door: its top. */
const STEP_Y = 0.4;

/** A point on the arch over the wheel at axle `z`, `phi` round from its back (0) over the top (π/2) to its front (π). */
const archPt = (z: number, phi: number): [number, number] => [z + Math.cos(phi) * ARCH, AXLE + Math.sin(phi) * ARCH];

/**
 * A flat panel cut from an outline in the van's side plane — (z, y) pairs —
 * with holes, `depth` thick, its outer face at x = `x` (facing out on the
 * side `side` is).
 */
function sidePanel(outline: [number, number][], holes: [number, number][][], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  // Shape x → van z, shape y → van y, extrusion → −x (0 .. −depth)
  g.rotateY(-Math.PI / 2);
  return g;
}

/** The plate on the van: white, a blue band, black letters. */
function plateTexture(text: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 56;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2f1ea';
  g.fillRect(0, 0, 256, 56);
  g.fillStyle = '#25408f';
  g.fillRect(0, 0, 256, 9);
  g.strokeStyle = '#1b1c1e';
  g.lineWidth = 3;
  g.strokeRect(2, 2, 252, 52);
  g.fillStyle = '#16181b';
  g.font = 'bold 38px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ribbed rubber matting for the floor: grooves across, a little wear. */
function floorTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2b2d30';
  g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 8) {
    g.fillStyle = '#1a1b1d';
    g.fillRect(0, y, 64, 3);
    g.fillStyle = '#3a3c40';
    g.fillRect(0, y + 3, 64, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ply lining: pale wood, its grain and the sheet joins. */
function plyTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b8936a';
  g.fillRect(0, 0, 256, 128);
  let seed = 3;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const y = rnd() * 128;
    g.strokeStyle = `rgba(${110 + rnd() * 40},${76 + rnd() * 30},${44 + rnd() * 20},${0.25 + rnd() * 0.3})`;
    g.lineWidth = 1 + rnd() * 2;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(80, y + (rnd() - 0.5) * 10, 170, y + (rnd() - 0.5) * 10, 256, y + (rnd() - 0.5) * 6);
    g.stroke();
  }
  g.fillStyle = 'rgba(60,40,22,0.6)';
  g.fillRect(0, 0, 2, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The plan, in marker on the bulkhead's whiteboard: the Collective's building, the way in, who goes where. */
function planTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3f4f1';
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = '#9aa0a4';
  g.lineWidth = 10;
  g.strokeRect(0, 0, 512, 320);
  const hand = (s: string, x: number, y: number, size: number, col: string, rot = 0): void => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = col;
    g.font = `bold ${size}px "Comic Sans MS", "Segoe Print", "Trebuchet MS", sans-serif`;
    g.fillText(s, 0, 0);
    g.restore();
  };
  hand('EXTERMINATOR COLLECTIVE — HQ', 24, 44, 26, '#1c3d8f', -0.01);
  // The building, its floors, the way in
  g.strokeStyle = '#1b1c1e';
  g.lineWidth = 4;
  g.strokeRect(60, 80, 190, 200);
  for (let y = 120; y < 280; y += 40) {
    g.beginPath();
    g.moveTo(60, y);
    g.lineTo(250, y);
    g.stroke();
  }
  g.strokeStyle = '#c4262e';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(330, 300);
  g.quadraticCurveTo(280, 270, 252, 262);
  g.stroke();
  g.beginPath();
  g.moveTo(252, 262);
  g.lineTo(272, 252);
  g.moveTo(252, 262);
  g.lineTo(270, 276);
  g.stroke();
  hand('VAN', 332, 304, 20, '#c4262e');
  hand('X', 210, 112, 34, '#c4262e');
  hand('BOSS?', 262, 108, 20, '#c4262e', -0.05);
  hand('1. lobby — Dev + Sanjay', 290, 160, 17, '#1b1c1e');
  hand('2. stairs — everyone', 290, 190, 17, '#1b1c1e');
  hand('3. top floor — RAVI', 290, 220, 17, '#1b1c1e');
  hand('NO ONE GETS LEFT', 290, 252, 17, '#1c3d8f', -0.02);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function crewVan(): VanRig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = AXLE;
  group.add(body);
  const meshes: THREE.Mesh[] = [];

  // Grey that reads as grey: little metalness, with no environment map for a metal to reflect
  const paint = new THREE.MeshStandardMaterial({ color: 0x8e959d, roughness: 0.45, metalness: 0.12 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.82 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.7 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc3c8ce, roughness: 0.22, metalness: 0.85 });
  const seam = new THREE.MeshStandardMaterial({ color: 0x3c4147, roughness: 0.6, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x18222b, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
  const tint = new THREE.MeshStandardMaterial({ color: 0x0e1217, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide });
  const lining = new THREE.MeshStandardMaterial({ color: 0xb5b9be, roughness: 0.85, side: THREE.DoubleSide });
  const plyMap = plyTexture();
  plyMap.repeat.set(1.6, 1);
  const ply = new THREE.MeshStandardMaterial({ color: 0xffffff, map: plyMap, roughness: 0.8 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.95 });
  const floorMap = floorTexture();
  floorMap.repeat.set(4, 22);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: floorMap, roughness: 0.92 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x272d3a, roughness: 0.95 });
  const belt = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.8 });
  const peg = new THREE.MeshStandardMaterial({ color: 0x41464c, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.7 });
  const olive = new THREE.MeshStandardMaterial({ color: 0x4b5633, roughness: 0.8 });
  const kit = new THREE.MeshStandardMaterial({ color: 0x353b2c, roughness: 0.88 });
  const bag = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.9 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb3221c, roughness: 0.45 });
  const white = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.6 });
  const headlights = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.15, emissive: 0xfff2d8, emissiveIntensity: 0.5 });
  const brakelights = new THREE.MeshStandardMaterial({ color: 0x7a0d0d, roughness: 0.25, emissive: 0xff1d12, emissiveIntensity: 0.2 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xb8681c, roughness: 0.3, emissive: 0xff8a1e, emissiveIntensity: 0.15 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xfff0d0, emissiveIntensity: 0 });
  const plate = new THREE.MeshStandardMaterial({ map: plateTexture('RVC 247'), roughness: 0.5 });
  const board = new THREE.MeshStandardMaterial({ map: planTexture(), roughness: 0.35 });

  // Everything here is placed in the van frame and hung on the body (which sits at axle height)
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, to: THREE.Object3D = body): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, to === body ? y - AXLE : y, z);
    m.rotation.set(rx, ry, rz);
    to.add(m);
    meshes.push(m);
    return m;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, to?: THREE.Object3D): THREE.Mesh =>
    put(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz, to);
  const round = (w: number, h: number, d: number, r: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, to?: THREE.Object3D): THREE.Mesh =>
    put(new RoundedBoxGeometry(w, h, d, 3, r), mat, x, y, z, rx, ry, rz, to);
  const cyl = (r0: number, r1: number, h: number, seg: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, to?: THREE.Object3D): THREE.Mesh =>
    put(new THREE.CylinderGeometry(r0, r1, h, seg), mat, x, y, z, rx, ry, rz, to);

  const hw = W / 2;

  // ---- The nose: one piece of bodywork from the bumper up over the bonnet to the foot of the screen,
  // its front corners rounded and the front wheel's arch cut out of each side
  {
    const bev = 0.1;
    const out: [number, number][] = [];
    const phiCowl = Math.acos((COWL - AXLE_Z[0]) / ARCH);
    const phiLow = Math.PI - Math.asin((0.56 - AXLE) / ARCH);
    for (let i = 0; i <= 8; i++) out.push(archPt(AXLE_Z[0], phiCowl + ((phiLow - phiCowl) * i) / 8));
    out.push([NOSE + 0.14, 0.56], [NOSE + 0.04, 0.6], [NOSE + bev * 0.2, 0.7], [NOSE, 0.98], [NOSE + 0.03, 1.07], [NOSE + 0.11, 1.14], [NOSE + 0.38, 1.24], [NOSE + 0.7, 1.32], [COWL, SCREEN_Y - 0.02]);
    const shape = new THREE.Shape(out.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: W - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: 0.035, bevelSegments: 4, curveSegments: 8 });
    g.rotateY(-Math.PI / 2);
    g.translate(hw - bev, 0, 0);
    put(g, paint, 0, 0, 0);
  }
  // The cowl panel across the foot of the screen, and the wipers parked on it
  box(W - 0.14, 0.04, 0.26, plastic, 0, SCREEN_Y - 0.005, COWL + 0.04, -0.18);
  for (const sx of [-0.55, 0.2]) box(0.7, 0.015, 0.025, plastic, sx, SCREEN_Y + 0.04, COWL + 0.09, -0.5, 0.08);
  // The bonnet's shut line, just back from the nose
  box(W - 0.3, 0.008, 0.012, seam, 0, 1.145, NOSE + 0.12, -0.35);

  // ---- The face: grille in its chrome surround, headlamps swept round the corners, indicators
  const FACE = NOSE - 0.035;
  const slat = new THREE.MeshStandardMaterial({ color: 0x5c6168, roughness: 0.45, metalness: 0.5 });
  box(1.24, 0.32, 0.05, plastic, 0, 0.855, FACE + 0.012);
  for (const y of [0.745, 0.818, 0.891, 0.964]) box(1.16, 0.034, 0.04, slat, 0, y, FACE - 0.012);
  box(1.32, 0.045, 0.045, chrome, 0, 1.03, FACE - 0.01);
  box(1.32, 0.04, 0.045, chrome, 0, 0.68, FACE - 0.01);
  for (const sx of [-1, 1]) box(0.045, 0.39, 0.045, chrome, sx * 0.64, 0.855, FACE - 0.01);
  // The maker's badge in the middle of it, no name on it
  cyl(0.075, 0.075, 0.025, 20, chrome, 0, 0.855, FACE - 0.04, Math.PI / 2);
  cyl(0.055, 0.055, 0.03, 20, plastic, 0, 0.855, FACE - 0.045, Math.PI / 2);
  for (const sx of [-1, 1]) {
    // Swept lamp: the front lens toed back toward the corner, and its tail round onto the wing
    box(0.5, 0.2, 0.05, plastic, sx * 0.92, 0.92, FACE + 0.02, 0, sx * -0.22);
    box(0.44, 0.15, 0.04, headlights, sx * 0.92, 0.925, FACE - 0.006, 0, sx * -0.22);
    box(0.12, 0.12, 0.02, chrome, sx * 0.8, 0.925, FACE - 0.035, 0, sx * -0.22);
    box(0.04, 0.15, 0.34, headlights, sx * (hw - 0.004), 0.925, NOSE + 0.24);
    box(0.045, 0.2, 0.4, plastic, sx * (hw - 0.012), 0.92, NOSE + 0.24);
    // Indicator under it, and a side repeater on the wing
    box(0.2, 0.05, 0.04, amber, sx * 1.0, 0.79, FACE - 0.004, 0, sx * -0.22);
    box(0.02, 0.04, 0.09, amber, sx * (hw + 0.004), 1.0, AXLE_Z[0] - 0.7);
  }
  // What the headlamps throw: down and ahead, a little out to each side
  const beams: THREE.SpotLight[] = [];
  for (const sx of [-1, 1]) {
    const beam = new THREE.SpotLight(0xfff0d6, 0, 80, 0.5, 0.6, 1.5);
    beam.position.set(sx * 0.92, 0.92 - AXLE, NOSE - 0.1);
    beam.target.position.set(sx * 1.3, -AXLE, NOSE - 24);
    body.add(beam, beam.target);
    beams.push(beam);
  }
  // The bumper: deep black plastic round the front corners; its intake, fog lamps, the plate, a tow eye
  round(W + 0.06, 0.34, 0.36, 0.07, plastic, 0, 0.49, NOSE + 0.1);
  box(1.0, 0.11, 0.03, trim, 0, 0.405, NOSE - 0.075);
  for (let i = 0; i < 6; i++) box(0.012, 0.1, 0.035, plastic, -0.42 + i * 0.168, 0.405, NOSE - 0.085);
  for (const sx of [-1, 1]) {
    cyl(0.055, 0.055, 0.03, 14, headlights, sx * 0.86, 0.41, NOSE - 0.075, Math.PI / 2);
    cyl(0.07, 0.07, 0.025, 14, trim, sx * 0.86, 0.41, NOSE - 0.067, Math.PI / 2);
  }
  box(0.52, 0.115, 0.012, plate, 0, 0.56, NOSE - 0.085);
  box(0.56, 0.135, 0.01, plastic, 0, 0.56, NOSE - 0.078);
  // Mirrors out on their arms
  for (const sx of [-1, 1]) {
    box(0.3, 0.035, 0.04, plastic, sx * (hw + 0.13), 1.86, COWL + 0.22);
    box(0.035, 0.36, 0.04, plastic, sx * (hw + 0.26), 1.86, COWL + 0.22);
    round(0.1, 0.36, 0.2, 0.035, plastic, sx * (hw + 0.29), 1.86, COWL + 0.26);
    box(0.012, 0.3, 0.15, glass, sx * (hw + 0.29), 1.86, COWL + 0.37);
  }

  // ---- The sides: each one panel from the A-pillar to the back, the arches cut round the wheels,
  // the cab's window out of it, and on the right the sliding door's opening
  const sideOutline = (): [number, number][] => {
    const o: [number, number][] = [[COWL, SCREEN_Y], [ROOF0, H - 0.06], [BAY1, H - 0.06], [BAY1, BOT]];
    const lowR = Math.asin((BOT - AXLE) / ARCH);
    for (let i = 0; i <= 12; i++) o.push(archPt(AXLE_Z[1], lowR + ((Math.PI - 2 * lowR) * i) / 12));
    const phiCowl = Math.acos((COWL - AXLE_Z[0]) / ARCH);
    for (let i = 0; i <= 10; i++) o.push(archPt(AXLE_Z[0], lowR + ((phiCowl - lowR) * i) / 10));
    return o;
  };
  // The A-pillar's line, and the cab window inside it
  const pillar = (y: number): number => COWL + ((ROOF0 - COWL) * (y - SCREEN_Y)) / (H - 0.06 - SCREEN_Y);
  const winLo = 1.55;
  const winHi = H - 0.34;
  const cabWin: [number, number][] = [[pillar(winLo) + 0.15, winLo], [BAY0 - 0.12, winLo], [BAY0 - 0.12, winHi], [pillar(winHi) + 0.15, winHi]];
  const doorHole: [number, number][] = [[DOOR0, FLOOR], [DOOR1, FLOOR], [DOOR1, DOOR_TOP], [DOOR0, DOOR_TOP]];
  for (const sx of [-1, 1]) {
    const g = sidePanel(sideOutline(), sx > 0 ? [cabWin, doorHole] : [cabWin], WALL);
    g.translate(sx > 0 ? hw : -hw + WALL, 0, 0);
    put(g, paint, 0, 0, 0);
    // The cab window: glass a little in from the paint, its black rubber round it
    const wz0 = cabWin[0][0];
    const wz1 = BAY0 - 0.12;
    const wy = (winLo + winHi) / 2;
    const glassShape = new THREE.Shape(cabWin.map(([z, y]) => new THREE.Vector2(z, y)));
    const gg = new THREE.ShapeGeometry(glassShape);
    gg.rotateY(-Math.PI / 2);
    put(gg, glass, sx * (hw - 0.025), 0, 0);
    box(0.012, 0.04, wz1 - wz0, plastic, sx * (hw + 0.002), winLo + 0.01, (wz0 + wz1) / 2);
    box(0.012, winHi - winLo, 0.035, plastic, sx * (hw + 0.002), wy, wz1 - 0.01);
    // The cab door: its shut lines, the handle, the lock
    box(0.01, 2.3, 0.012, seam, sx * (hw + 0.003), 1.7, BAY0 - 0.05);
    box(0.01, 0.012, BAY0 - 0.05 - (COWL + 0.25), seam, sx * (hw + 0.003), 0.56, (BAY0 - 0.05 + COWL + 0.25) / 2);
    round(0.035, 0.045, 0.2, 0.012, plastic, sx * (hw + 0.02), 1.42, BAY0 - 0.3);
    // A rubbing strip down the side: on the right it stops either side of the door (the door carries its own piece)
    const strip = (z0: number, z1: number): void => {
      box(0.035, 0.1, z1 - z0, plastic, sx * (hw + 0.016), 0.98, (z0 + z1) / 2);
    };
    if (sx > 0) {
      strip(COWL + 0.15, DOOR0 - 0.06);
      strip(DOOR1 + 0.06, BAY1 - 0.08);
    } else strip(COWL + 0.15, BAY1 - 0.08);
    // Black sill along the bottom between the arches; a marker lamp halfway
    box(0.05, 0.1, AXLE_Z[1] - AXLE_Z[0] - 2 * ARCH - 0.1, plastic, sx * (hw + 0.01), BOT + 0.05, (AXLE_Z[0] + AXLE_Z[1]) / 2);
    box(0.015, 0.05, 0.12, amber, sx * (hw + 0.012), 0.62, 0.9);
    // Arch flares round the tops of both wheels, and the liners inside them
    for (const z of AXLE_Z) {
      const flare = new THREE.TorusGeometry(ARCH + 0.02, 0.045, 6, 20, Math.PI);
      flare.rotateY(Math.PI / 2);
      put(flare, plastic, sx * (hw + 0.012), AXLE, z);
      const liner = new THREE.CylinderGeometry(ARCH - 0.01, ARCH - 0.01, 0.4, 18, 1, true, 0, Math.PI);
      liner.rotateZ(Math.PI / 2);
      put(liner, rubber, sx * (hw - 0.2), AXLE, z, 0, 0, 0);
    }
    // Mud flaps behind the back wheels
    box(0.012, 0.32, 0.26, rubber, sx * (hw - 0.12), 0.28, AXLE_Z[1] + ARCH + 0.06);
  }
  // The fuel flap on the left, behind the cab door
  cyl(0.085, 0.085, 0.012, 16, seam, -hw - 0.004, 1.2, BAY0 + 0.5, 0, 0, Math.PI / 2);
  // The B-pillar's edge where the sliding door shuts against it, and its runner along the side
  box(0.02, 0.025, BAY1 - DOOR1 - 0.4, seam, hw + 0.012, DOOR_TOP - 0.05, (DOOR1 + BAY1) / 2 - 0.2);
  box(0.03, 0.03, BAY1 - DOOR1 - 0.4, seam, hw + 0.012, FLOOR + 0.05, (DOOR1 + BAY1) / 2 - 0.2);

  // ---- The screen, raked back from the cowl to the roof, between its pillars
  {
    const y0 = SCREEN_Y;
    const y1 = H - 0.06;
    const len = Math.hypot(y1 - y0, ROOF0 - COWL);
    const rake = Math.atan2(ROOF0 - COWL, y1 - y0);
    const my = (y0 + y1) / 2;
    const mz = (COWL + ROOF0) / 2;
    box(W - 0.2, len - 0.04, 0.02, glass, 0, my, mz, rake);
    // The black band round it, and the pillars either side
    for (const e of [-1, 1]) box(W - 0.16, 0.07, 0.025, plastic, 0, my + (e * (len - 0.07) * Math.cos(rake)) / 2, mz + (e * (len - 0.07) * Math.sin(rake)) / 2, rake);
    for (const sx of [-1, 1]) {
      box(0.06, len - 0.1, 0.03, plastic, sx * (hw - 0.13), my, mz - 0.005, rake);
      box(0.1, len + 0.02, 0.12, paint, sx * (hw - 0.05), my, mz, rake);
    }
    // A mirror and a sun visor inside
    box(0.22, 0.07, 0.03, plastic, 0, y1 - 0.18, ROOF0 + 0.12);
    for (const sx of [-0.55, 0.55]) box(0.5, 0.02, 0.24, cloth, sx, y1 - 0.08, ROOF0 + 0.2, 0.2);
  }

  // ---- The roof: rounded over its edges, two rails, a vent and an aerial; the ceiling lined
  round(W + 0.02, 0.12, BAY1 + 0.06 - ROOF0 + 0.05, 0.055, paint, 0, H, (BAY1 + 0.06 + ROOF0 - 0.05) / 2);
  for (const sx of [-1, 1]) {
    box(0.045, 0.04, BAY1 - ROOF0 - 0.7, seam, sx * (hw - 0.18), H + 0.1, (BAY1 + ROOF0) / 2);
    for (const z of [ROOF0 + 0.5, (BAY1 + ROOF0) / 2, BAY1 - 0.4]) box(0.06, 0.06, 0.1, seam, sx * (hw - 0.18), H + 0.07, z);
  }
  round(0.55, 0.1, 0.55, 0.03, trim, 0, H + 0.07, 1.4);
  cyl(0.008, 0.012, 0.42, 6, plastic, -0.4, H + 0.27, ROOF0 + 0.3);
  box(W - 0.12, 0.01, BAY1 - BAY0, lining, 0, H - 0.07, (BAY0 + BAY1) / 2);

  // ---- The back: two doors with windows, hinges, the handle; tall lamp clusters, a third brake light; a step bumper
  for (const sx of [-1, 1]) {
    box(hw - 0.02, H - BOT - 0.16, WALL, paint, (sx * hw) / 2, (H + BOT) / 2 - 0.08, BAY1 + 0.03);
    box(hw - 0.36, 0.55, 0.02, tint, (sx * hw) / 2, H - 0.66, BAY1 + 0.062);
    box(hw - 0.3, 0.61, 0.012, plastic, (sx * hw) / 2, H - 0.66, BAY1 + 0.057);
    for (const y of [0.85, 1.75, 2.6]) box(0.06, 0.12, 0.05, plastic, sx * (hw - 0.04), y, BAY1 + 0.07);
    // Tail lamp clusters up the corners: red, amber, white, red
    box(0.15, 0.34, 0.06, brakelights, sx * (hw - 0.09), 1.5, BAY1 + 0.065);
    box(0.15, 0.12, 0.06, amber, sx * (hw - 0.09), 1.26, BAY1 + 0.065);
    box(0.15, 0.1, 0.06, headlights, sx * (hw - 0.09), 1.14, BAY1 + 0.065);
    box(0.15, 0.1, 0.06, brakelights, sx * (hw - 0.09), 1.03, BAY1 + 0.065);
    box(0.17, 0.82, 0.04, plastic, sx * (hw - 0.09), 1.27, BAY1 + 0.055);
    // Reflectors in the bumper's corners
    box(0.12, 0.05, 0.02, brakelights, sx * 0.95, 0.5, BAY1 + 0.29);
  }
  box(0.014, H - BOT - 0.24, 0.012, seam, 0, (H + BOT) / 2, BAY1 + 0.06);
  box(0.06, 0.16, 0.05, plastic, 0.07, 1.5, BAY1 + 0.075);
  box(0.36, 0.05, 0.04, brakelights, 0, H - 0.12, BAY1 + 0.07);
  round(W + 0.06, 0.24, 0.42, 0.06, plastic, 0, 0.52, L / 2 + 0.1);
  box(0.9, 0.025, 0.3, metal, 0, 0.645, L / 2 + 0.16);
  box(0.52, 0.115, 0.012, plate, 0, 0.98, BAY1 + 0.062);
  box(0.12, 0.025, 0.04, chrome, 0, 1.055, BAY1 + 0.07);
  cyl(0.03, 0.03, 0.25, 8, plastic, -0.6, 0.32, L / 2 - 0.2, Math.PI / 2);

  // ---- Underneath: the chassis between the wheels, and the floor of the cab and bay
  box(W - 1.0, 0.24, L - 1.0, rubber, 0, 0.42, 0.2);
  box(W - 0.1, 0.06, BAY1 - COWL, floorMat, 0, FLOOR - 0.03, (BAY1 + COWL) / 2);
  box(W - 0.9, FLOOR - BOT, BAY1 - COWL, trim, 0, (FLOOR + BOT) / 2, (BAY1 + COWL) / 2);
  // Tie-down rails along the floor's edges
  for (const sx of [-1, 1]) box(0.05, 0.02, BAY1 - BAY0 - 0.3, metal, sx * (hw - 0.1), FLOOR + 0.01, (BAY0 + BAY1) / 2);

  // ---- The cab: dash, wheel, two seats, the gear lever
  box(W - 0.12, 0.42, 0.55, plastic, 0, 1.32, COWL + 0.26);
  box(W - 0.14, 0.05, 0.5, trim, 0, 1.56, COWL + 0.3, 0.12);
  box(0.4, 0.14, 0.03, lamp, -0.55, 1.5, COWL + 0.55, -0.4);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.024, 8, 26), plastic);
  wheel.position.set(-0.55, 1.58 - AXLE, COWL + 0.66);
  wheel.rotation.x = -0.95;
  body.add(wheel);
  meshes.push(wheel);
  cyl(0.03, 0.03, 0.4, 8, plastic, -0.55, 1.48, COWL + 0.52, -0.95);
  const seatZ = BAY0 - 0.42;
  for (const sx of [-0.55, 0.55]) {
    round(0.54, 0.13, 0.52, 0.04, cloth, sx, FLOOR + 0.44, seatZ);
    round(0.54, 0.74, 0.11, 0.04, cloth, sx, FLOOR + 0.88, seatZ + 0.26, 0.12);
    round(0.3, 0.2, 0.1, 0.03, cloth, sx, FLOOR + 1.36, seatZ + 0.32, 0.12);
    box(0.4, 0.38, 0.4, plastic, sx, FLOOR + 0.19, seatZ);
  }
  cyl(0.015, 0.015, 0.25, 6, chrome, 0, FLOOR + 0.62, seatZ - 0.35, 0.3);

  // ---- The bulkhead behind the seats: panels each side and a header over the walkway,
  // the plan on its whiteboard, a first-aid kit, an extinguisher by the door
  for (const sx of [-1, 1]) {
    const x0 = 0.48;
    const x1 = hw - WALL;
    box(x1 - x0, H - 0.1 - FLOOR, 0.05, lining, (sx * (x0 + x1)) / 2, (H - 0.1 + FLOOR) / 2, BAY0);
    box(0.03, H - 0.1 - FLOOR, 0.07, metal, sx * x0, (H - 0.1 + FLOOR) / 2, BAY0);
  }
  box(0.96, H - 0.1 - 2.3, 0.05, lining, 0, (H - 0.1 + 2.3) / 2, BAY0);
  box(0.7, 0.44, 0.015, board, -0.85, 1.85, BAY0 + 0.035);
  box(0.74, 0.48, 0.01, metal, -0.85, 1.85, BAY0 + 0.028);
  box(0.3, 0.22, 0.1, white, 0.85, 2.15, BAY0 + 0.08);
  box(0.12, 0.035, 0.012, red, 0.85, 2.15, BAY0 + 0.135);
  box(0.035, 0.12, 0.012, red, 0.85, 2.15, BAY0 + 0.135);
  cyl(0.07, 0.07, 0.42, 12, red, hw - 0.18, FLOOR + 0.3, DOOR1 + 0.16);
  cyl(0.03, 0.03, 0.08, 8, plastic, hw - 0.18, FLOOR + 0.55, DOOR1 + 0.16);

  // ---- The sliding door: in the opening when shut; out and back along the side open.
  // A window in it, lining inside, its handle, and its own piece of the rubbing strip
  const door = new THREE.Group();
  body.add(door);
  const doorLen = DOOR1 - DOOR0 + 0.03;
  const dz0 = -doorLen / 2;
  const dz1 = doorLen / 2;
  const dWin: [number, number][] = [[dz0 + 0.16, 1.72], [dz1 - 0.16, 1.72], [dz1 - 0.16, DOOR_TOP - 0.22], [dz0 + 0.16, DOOR_TOP - 0.22]];
  const dPanel = sidePanel([[dz0, FLOOR - 0.02], [dz1, FLOOR - 0.02], [dz1, DOOR_TOP + 0.02], [dz0, DOOR_TOP + 0.02]], [dWin], WALL);
  dPanel.translate(WALL / 2, -AXLE, 0);
  put(dPanel, paint, 0, 0, 0, 0, 0, 0, door);
  const dGlass = new THREE.ShapeGeometry(new THREE.Shape(dWin.map(([z, y]) => new THREE.Vector2(z, y))));
  dGlass.rotateY(-Math.PI / 2);
  dGlass.translate(-0.01, -AXLE, 0);
  put(dGlass, tint, 0, 0, 0, 0, 0, 0, door);
  box(0.012, DOOR_TOP - 0.22 - 1.72 + 0.06, 0.03, plastic, WALL / 2 + 0.004, (DOOR_TOP - 0.22 + 1.72) / 2 - AXLE, dz0 + 0.16, 0, 0, 0, door);
  box(0.012, DOOR_TOP - 0.22 - 1.72 + 0.06, 0.03, plastic, WALL / 2 + 0.004, (DOOR_TOP - 0.22 + 1.72) / 2 - AXLE, dz1 - 0.16, 0, 0, 0, door);
  box(0.012, 0.03, doorLen - 0.3, plastic, WALL / 2 + 0.004, 1.72 - AXLE, 0, 0, 0, 0, door);
  box(0.012, 0.03, doorLen - 0.3, plastic, WALL / 2 + 0.004, DOOR_TOP - 0.22 - AXLE, 0, 0, 0, 0, door);
  box(0.012, 1.0, doorLen - 0.12, ply, -WALL / 2 - 0.007, FLOOR + 0.55 - AXLE, 0, 0, 0, 0, door);
  box(0.035, 0.1, doorLen - 0.04, plastic, WALL / 2 + 0.016, 0.98 - AXLE, 0, 0, 0, 0, door);
  round(0.035, 0.05, 0.24, 0.012, plastic, WALL / 2 + 0.02, 1.42 - AXLE, dz0 + 0.18, 0, 0, 0, door);
  box(0.012, DOOR_TOP - FLOOR + 0.04, 0.012, seam, WALL / 2 + 0.004, (DOOR_TOP + FLOOR) / 2 - AXLE, dz1, 0, 0, 0, door);
  box(0.012, DOOR_TOP - FLOOR + 0.04, 0.012, seam, WALL / 2 + 0.004, (DOOR_TOP + FLOOR) / 2 - AXLE, dz0, 0, 0, 0, door);
  const doorMid = (DOOR0 + DOOR1) / 2;
  const setDoor = (k: number): void => {
    const c = Math.min(1, Math.max(0, k));
    // Out off its seal for the first fifth (clear of the strip behind it), then back along the runners
    const out = Math.min(1, c / 0.2) * 0.1;
    const back = Math.max(0, (c - 0.2) / 0.8) * (DOOR1 - DOOR0 + 0.06);
    door.position.set(hw - WALL / 2 + out, 0, doorMid + back);
  };
  setDoor(0);
  // The running board under the door, on two brackets; the sill plate on the floor's edge
  box(0.3, 0.05, DOOR1 - DOOR0 - 0.1, rubber, hw + 0.05, STEP_Y - 0.025, doorMid);
  for (const z of [DOOR0 + 0.25, DOOR1 - 0.25]) box(0.24, 0.08, 0.05, metal, hw - 0.02, STEP_Y - 0.07, z);
  box(0.2, 0.012, DOOR1 - DOOR0 - 0.04, metal, hw - 0.08, FLOOR + 0.006, doorMid);
  // A grab handle just inside the opening
  cyl(0.016, 0.016, 0.55, 8, metal, hw - 0.08, 1.75, DOOR1 + 0.06);

  // ---- Wheels: tyre, steel rim, hub, the nuts round it
  const wheels: THREE.Object3D[] = [];
  const tyreGeo = new THREE.CylinderGeometry(AXLE, AXLE, 0.27, 24);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.275, 18);
  rimGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.29, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const nutGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.3, 6);
  nutGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x5f656c, roughness: 0.4, metalness: 0.7 });
  for (const z of AXLE_Z) {
    for (const sx of [-1, 1]) {
      const spin = new THREE.Group();
      spin.position.set(sx * (hw - 0.17), AXLE, z);
      group.add(spin);
      spin.add(new THREE.Mesh(tyreGeo, rubber), new THREE.Mesh(rimGeo, rimMat), new THREE.Mesh(hubGeo, chrome));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const n = new THREE.Mesh(nutGeo, chrome);
        n.position.set(0, Math.cos(a) * 0.13, Math.sin(a) * 0.13);
        spin.add(n);
      }
      wheels.push(spin);
    }
  }

  // ---- The load bay: lined walls (ply to the shoulder, grey above), roof bows, LED strips, grab rails and their straps
  for (const sx of [-1, 1]) {
    const runs: [number, number][] = sx > 0 ? [[DOOR1, BAY1], [BAY0, DOOR0]] : [[BAY0, BAY1]];
    for (const [z0, z1] of runs) {
      box(0.012, 1.1, z1 - z0 - 0.02, ply, sx * (hw - WALL - 0.007), FLOOR + 0.55, (z0 + z1) / 2);
      box(0.01, H - 0.1 - FLOOR - 1.1, z1 - z0 - 0.02, lining, sx * (hw - WALL - 0.006), (H - 0.1 + FLOOR + 1.1) / 2, (z0 + z1) / 2);
    }
    // The grab rail along the roof, its brackets, and loops of strap off it
    cyl(0.018, 0.018, BAY1 - BAY0 - 0.5, 8, metal, sx * 0.62, H - 0.28, (BAY0 + BAY1) / 2, Math.PI / 2);
    for (let z = BAY0 + 0.6; z < BAY1 - 0.3; z += 0.85) {
      box(0.02, 0.17, 0.02, metal, sx * 0.62, H - 0.18, z);
      box(0.025, 0.2, 0.04, belt, sx * 0.62, H - 0.4, z + 0.42);
      box(0.06, 0.04, 0.04, belt, sx * 0.62, H - 0.5, z + 0.42);
    }
  }
  for (let z = BAY0 + 0.4; z < BAY1; z += 0.62) box(W - 0.14, 0.04, 0.06, lining, 0, H - 0.1, z);
  for (const sx of [-0.32, 0.32]) box(0.06, 0.02, BAY1 - BAY0 - 0.6, lamp, sx, H - 0.085, (BAY0 + BAY1) / 2);
  for (const z of [-0.5, 2.3]) box(0.24, 0.03, 0.9, lamp, 0, H - 0.08, z);
  const light = new THREE.PointLight(0xffe7c2, 0, 10, 1.5);
  light.position.set(0, H - 0.3 - AXLE, 0.9);
  body.add(light);
  const redLight = new THREE.PointLight(0xff2a1a, 0, 10, 1.4);
  redLight.position.set(0, H - 0.35 - AXLE, 2.7);
  body.add(redLight);

  // ---- Benches down both sides, facing across the aisle: padded seat and back, a frame and legs under,
  // a belt at each place, kit bags and ammo cans underneath
  const seatH = FLOOR + 0.46;
  const benchZ1 = BAY1 - 0.35;
  for (const sx of [-1, 1]) {
    const z0 = sx > 0 ? DOOR1 + 0.32 : BAY0 + 0.18;
    const len = benchZ1 - z0;
    const zc = z0 + len / 2;
    round(0.5, 0.1, len, 0.03, cloth, sx * (hw - 0.32), seatH - 0.05, zc);
    box(0.46, 0.04, len - 0.04, metal, sx * (hw - 0.32), seatH - 0.12, zc);
    for (let z = z0 + 0.12; z <= benchZ1 - 0.1; z += Math.max(0.6, (len - 0.24) / Math.round((len - 0.24) / 0.9))) {
      box(0.04, seatH - FLOOR - 0.12, 0.04, metal, sx * (hw - 0.54), (seatH - 0.12 + FLOOR) / 2, z);
    }
    round(0.08, 0.6, len, 0.03, cloth, sx * (hw - 0.1), seatH + 0.4, zc);
    box(0.02, 0.05, len, metal, sx * (hw - 0.08), seatH + 0.75, zc);
  }
  // Kit bags and ammo cans under the benches
  const under: [number, number, number][] = [[-1, -0.6, 0.7], [-1, 1.2, 0.55], [-1, 2.9, 0.6], [1, 1.25, 0.6], [1, 3.0, 0.5]];
  for (const [sx, z, l] of under) round(0.34, 0.3, l, 0.1, bag, sx * (hw - 0.34), FLOOR + 0.15, z);
  for (const [sx, z] of [[-1, 0.3], [1, 2.15]] as const) {
    box(0.28, 0.2, 0.14, olive, sx * (hw - 0.33), FLOOR + 0.1, z);
    box(0.09, 0.02, 0.04, metal, sx * (hw - 0.33), FLOOR + 0.215, z);
  }

  // ---- The arsenal
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.7 });
  const blued = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.4, metalness: 0.7 });
  // Pegboard over the right bench, rifles hung along it one above the next, muzzles forward
  box(0.02, 0.92, BAY1 - DOOR1 - 0.6, peg, hw - WALL - 0.02, 2.24, (DOOR1 + BAY1) / 2 + 0.05);
  const rack: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    for (const z of [1.25, 3.05]) {
      const ak = rackAK();
      ak.position.set(hw - WALL - 0.075, 1.94 + i * 0.2 - AXLE, z);
      body.add(ak);
      rack.push(ak);
      // The hooks it hangs on
      for (const dz of [-0.2, 0.18]) box(0.06, 0.012, 0.012, metal, hw - WALL - 0.05, 1.91 + i * 0.2, z + dz);
    }
  }
  // Over the left bench, behind where he sits: shotguns, and a row of pistols
  box(0.02, 0.92, 3.9, peg, -hw + WALL + 0.02, 2.24, 1.7);
  for (let i = 0; i < 3; i++) {
    for (const z of [0.6, 2.5]) {
      const sg = shotgun(wood, blued);
      sg.rotation.set(0, 0, Math.PI / 2);
      sg.position.set(-hw + WALL + 0.06, 2.56 - i * 0.18 - AXLE, z);
      body.add(sg);
    }
  }
  for (let i = 0; i < 9; i++) {
    const p = pistol(blued);
    p.rotation.set(0, 0, Math.PI / 2);
    p.position.set(-hw + WALL + 0.05, 1.94 - AXLE, 0.0 + i * 0.4);
    body.add(p);
  }
  // On the floor at the back: two crates of grenades, lids off; ammo cans; a long case
  for (const cx of [-0.48, 0.38]) {
    const crate = new THREE.Group();
    crate.position.set(cx, FLOOR - AXLE, BAY1 - 0.25);
    body.add(crate);
    box(0.64, 0.28, 0.42, olive, 0, 0.14, 0, 0, 0, 0, crate);
    box(0.68, 0.03, 0.46, olive, -0.32, 0.32, -0.1, 0, 0.5, 0.35, crate);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        const g = grenade();
        g.position.set(-0.21 + c * 0.14, 0.29, -0.09 + r * 0.17);
        g.rotation.set(0.3 * (c % 2), c * 0.9, 0.2 * r);
        crate.add(g);
      }
    }
  }
  for (let i = 0; i < 4; i++) box(0.28, 0.2, 0.14, olive, -0.75 + i * 0.5, FLOOR + 0.1, BAY1 - 0.62);
  box(0.25, 0.15, 1.2, plastic, 0.05, FLOOR + 0.075, 2.6);
  // Spare kit hung on the back doors: vests and helmets
  for (const sx of [-0.66, -0.22, 0.22, 0.66]) {
    box(0.34, 0.42, 0.06, kit, sx, 2.3, BAY1 - 0.06);
    box(0.08, 0.06, 0.04, kit, sx, 2.55, BAY1 - 0.05);
    const helm = new THREE.SphereGeometry(0.12, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    put(helm, plastic, sx, 2.67, BAY1 - 0.14, -Math.PI / 2);
  }

  // Right under each place's hips, along the benches; the two sides facing each other across the aisle
  const seats = {
    left: [-1.2, -0.2, 0.75, 1.7, 2.65, 3.55].map((z) => new THREE.Vector3(-hw + 0.5, FLOOR, z)),
    right: [0.85, 1.75, 2.7, 3.6].map((z) => new THREE.Vector3(hw - 0.5, FLOOR, z)),
    driver: new THREE.Vector3(-0.55, FLOOR, seatZ - 0.1)
  };
  return {
    group,
    body,
    wheels,
    setDoor,
    seats,
    floorY: FLOOR,
    doorIn: new THREE.Vector3(hw - 0.45, FLOOR, doorMid),
    doorSill: new THREE.Vector3(hw - 0.06, FLOOR, doorMid),
    doorStep: new THREE.Vector3(hw + 0.1, STEP_Y, doorMid),
    doorOut: new THREE.Vector3(hw + 0.75, 0, doorMid),
    length: L,
    width: W,
    rack,
    light,
    redLight,
    lamp,
    headlights,
    beams,
    brakelights,
    meshes
  };
}

/** A pump shotgun, muzzle down −Z, real size. */
function shotgun(wood: THREE.Material, steel: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    g.add(m);
  };
  const barrel = new THREE.CylinderGeometry(0.012, 0.012, 0.62, 8);
  barrel.rotateX(Math.PI / 2);
  add(barrel, steel, 0, 0.02, -0.38);
  const tube = new THREE.CylinderGeometry(0.011, 0.011, 0.5, 8);
  tube.rotateX(Math.PI / 2);
  add(tube, steel, 0, -0.005, -0.32);
  add(new THREE.BoxGeometry(0.035, 0.04, 0.16), wood, 0, -0.005, -0.3);
  add(new THREE.BoxGeometry(0.04, 0.06, 0.22), steel, 0, 0.01, 0.0);
  add(new THREE.BoxGeometry(0.035, 0.07, 0.32), wood, 0, -0.03, 0.26, 0.12);
  return g;
}

/** A pistol, muzzle down −Z. */
function pistol(steel: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.032, 0.19), steel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.1, 0.045), steel);
  grip.position.set(0, -0.06, 0.06);
  grip.rotation.x = -0.25;
  g.add(slide, grip);
  return g;
}

let grenadeParts: { body: THREE.BufferGeometry; spoon: THREE.BufferGeometry; ring: THREE.BufferGeometry; mats: THREE.Material[] } | null = null;

/** A fragmentation grenade: the olive egg, its spoon and pin ring. */
export function grenade(): THREE.Group {
  if (!grenadeParts) {
    const egg = new THREE.SphereGeometry(0.032, 12, 9);
    egg.scale(1, 1.25, 1);
    grenadeParts = {
      body: egg,
      spoon: new THREE.BoxGeometry(0.012, 0.06, 0.008),
      ring: new THREE.TorusGeometry(0.012, 0.0025, 5, 12),
      mats: [
        new THREE.MeshStandardMaterial({ color: 0x4f5a33, roughness: 0.6 }),
        new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.35, metalness: 0.7 })
      ]
    };
  }
  const P = grenadeParts;
  const g = new THREE.Group();
  const b = new THREE.Mesh(P.body, P.mats[0]);
  const s = new THREE.Mesh(P.spoon, P.mats[1]);
  s.position.set(0.03, 0.02, 0);
  s.rotation.z = -0.25;
  const r = new THREE.Mesh(P.ring, P.mats[1]);
  r.position.set(-0.016, 0.05, 0);
  g.add(b, s, r);
  return g;
}

/**
 * Todd's ID: the Exterminator Collective's badge Sanjay found on one of
 * them, on a short lanyard strap. Portrait, its face toward +Z, origin in
 * its middle; 8.6 × 12 cm.
 */
export function exterminatorBadge(): THREE.Group {
  const g = new THREE.Group();
  const w = 0.086;
  const h = 0.12;
  const face = new THREE.MeshStandardMaterial({ map: badgeTexture(), roughness: 0.38, metalness: 0.05 });
  const back = new THREE.MeshStandardMaterial({ color: 0xe9ebe6, roughness: 0.5 });
  const edge = new THREE.MeshStandardMaterial({ color: 0xd8dad6, roughness: 0.4 });
  // The card in a clear sleeve: face, back, edges
  const card = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.002), [edge, edge, edge, edge, face, back]);
  g.add(card);
  // The clip and a stub of lanyard off the top
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.014, 0.004), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.8 }));
  clip.position.set(0, h / 2 + 0.005, 0);
  g.add(clip);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.03, 0.0015), new THREE.MeshStandardMaterial({ color: 0x1d6b5c, roughness: 0.8 }));
  strap.position.set(0, h / 2 + 0.025, -0.001);
  g.add(strap);
  return g;
}

/**
 * The badge's face: the Collective's header with its logo, Todd's photo
 * (black suit, sunglasses, a very small smile), his details, a barcode, the
 * fine print — and a cute sticker stuck on slightly crooked.
 */
function badgeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 715;
  const g = c.getContext('2d')!;
  const rr = (x: number, y: number, w: number, h: number, r: number): void => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  // Card
  g.fillStyle = '#f4f3ee';
  rr(0, 0, 512, 715, 26);
  g.fill();
  // The slot punched for the clip
  g.fillStyle = '#c9cbc6';
  rr(206, 18, 100, 18, 9);
  g.fill();
  // Header band
  g.fillStyle = '#16463d';
  g.fillRect(0, 50, 512, 150);
  // Logo: a bug in a red circle, struck through
  const lx = 78;
  const ly = 125;
  g.fillStyle = '#f4f3ee';
  g.beginPath();
  g.arc(lx, ly, 50, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#222';
  g.beginPath();
  g.ellipse(lx, ly + 6, 16, 22, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(lx, ly - 22, 10, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#222';
  g.lineWidth = 4;
  for (const s of [-1, 1]) {
    for (const k of [-10, 4, 18]) {
      g.beginPath();
      g.moveTo(lx + s * 12, ly + k);
      g.lineTo(lx + s * 30, ly + k - 8);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(lx + s * 5, ly - 30);
    g.lineTo(lx + s * 16, ly - 44);
    g.stroke();
  }
  g.strokeStyle = '#c4262e';
  g.lineWidth = 9;
  g.beginPath();
  g.arc(lx, ly, 44, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(lx - 31, ly - 31);
  g.lineTo(lx + 31, ly + 31);
  g.stroke();
  // Name of the outfit
  g.fillStyle = '#f4f3ee';
  g.textBaseline = 'alphabetic';
  g.font = 'bold 50px Impact, "Arial Black", sans-serif';
  g.fillText('EXTERMINATOR', 146, 118);
  g.font = 'bold 44px Impact, "Arial Black", sans-serif';
  g.fillText('COLLECTIVE', 146, 166);
  g.font = 'bold 15px Arial, sans-serif';
  g.fillStyle = '#9fd3c4';
  g.fillText('DISCREET REMOVAL SERVICES  ·  EST. 1997', 146, 190);

  // Photo: grey-blue backdrop, black suit, sunglasses
  const px = 34;
  const py = 230;
  const pw = 190;
  const ph = 240;
  g.fillStyle = '#8fa3b5';
  g.fillRect(px, py, pw, ph);
  g.fillStyle = '#15171a';
  g.beginPath();
  g.ellipse(px + pw / 2, py + ph + 30, 100, 95, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = '#f2f2f2';
  g.beginPath();
  g.moveTo(px + pw / 2 - 22, py + ph - 62);
  g.lineTo(px + pw / 2 + 22, py + ph - 62);
  g.lineTo(px + pw / 2, py + ph - 10);
  g.closePath();
  g.fill();
  g.fillStyle = '#7a1f22';
  g.fillRect(px + pw / 2 - 6, py + ph - 58, 12, 44);
  g.fillStyle = '#d7a27c';
  g.fillRect(px + pw / 2 - 18, py + 130, 36, 40);
  g.beginPath();
  g.ellipse(px + pw / 2, py + 100, 52, 64, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3b2a1f';
  g.beginPath();
  g.ellipse(px + pw / 2, py + 52, 54, 26, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = '#0d0e10';
  rr(px + pw / 2 - 46, py + 86, 40, 22, 8);
  g.fill();
  rr(px + pw / 2 + 6, py + 86, 40, 22, 8);
  g.fill();
  g.fillRect(px + pw / 2 - 8, py + 92, 16, 5);
  g.strokeStyle = '#7d4b3a';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(px + pw / 2, py + 128, 12, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();

  // Details
  const tx = 244;
  g.fillStyle = '#6b6f73';
  g.font = 'bold 15px Arial, sans-serif';
  g.fillText('OPERATIVE', tx, 252);
  g.fillStyle = '#16191c';
  g.font = 'bold 66px Impact, "Arial Black", sans-serif';
  g.fillText('TODD', tx, 318);
  const field = (label: string, value: string, y: number): void => {
    g.fillStyle = '#6b6f73';
    g.font = 'bold 15px Arial, sans-serif';
    g.fillText(label, tx, y);
    g.fillStyle = '#16191c';
    g.font = 'bold 22px Arial, sans-serif';
    g.fillText(value, tx, y + 26);
  };
  field('ID NO.', 'EC-0451', 356);
  field('GRADE', 'FIELD OPERATIVE II', 414);
  g.fillStyle = '#6b6f73';
  g.font = 'bold 15px Arial, sans-serif';
  g.fillText('ASSIGNMENT', 34, 506);
  g.fillStyle = '#16191c';
  g.font = 'bold 24px Arial, sans-serif';
  g.fillText('CALL CENTER — FULL CLEANUP', 34, 536);
  g.fillStyle = '#6b6f73';
  g.font = 'bold 15px Arial, sans-serif';
  g.fillText('CLIENT', 34, 568);
  g.fillStyle = '#16191c';
  g.fillRect(34, 578, 210, 24);
  // Barcode
  let bx = 34;
  let seed = 7;
  while (bx < 470) {
    seed = (seed * 9301 + 49297) % 233280;
    const bw = 2 + (seed % 5);
    if (seed % 3) {
      g.fillStyle = '#16191c';
      g.fillRect(bx, 622, bw, 46);
    }
    bx += bw + 2;
  }
  g.fillStyle = '#6b6f73';
  g.font = 'bold 12px Arial, sans-serif';
  g.fillText('NOT A LAW ENFORCEMENT CREDENTIAL.', 34, 690);

  // The sticker, stuck on crooked over the photo's corner: a pink heart with
  // a face, a white die-cut border, and its message round it
  g.save();
  g.translate(198, 452);
  g.rotate(-0.22);
  g.shadowColor = 'rgba(0,0,0,0.25)';
  g.shadowBlur = 8;
  g.shadowOffsetY = 3;
  g.fillStyle = '#ffffff';
  rr(-92, -64, 184, 128, 40);
  g.fill();
  g.shadowColor = 'transparent';
  g.fillStyle = '#ffd6e7';
  rr(-84, -56, 168, 112, 34);
  g.fill();
  // Heart
  g.fillStyle = '#ff5c9a';
  g.beginPath();
  g.moveTo(-50, -2);
  g.bezierCurveTo(-50, -30, -86, -30, -86, -6);
  g.bezierCurveTo(-86, 12, -62, 24, -50, 36);
  g.bezierCurveTo(-38, 24, -14, 12, -14, -6);
  g.bezierCurveTo(-14, -30, -50, -30, -50, -2);
  g.fill();
  g.fillStyle = '#3a1022';
  g.beginPath();
  g.arc(-60, 2, 3.2, 0, Math.PI * 2);
  g.arc(-40, 2, 3.2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#3a1022';
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(-50, 8, 6, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  g.fillStyle = '#ff9cc2';
  g.beginPath();
  g.arc(-68, 10, 4, 0, Math.PI * 2);
  g.arc(-32, 10, 4, 0, Math.PI * 2);
  g.fill();
  // Sparkles
  g.fillStyle = '#ffffff';
  for (const [sx, sy, s] of [[-80, -40, 6], [-18, -38, 4], [70, -42, 5]] as const) {
    g.beginPath();
    g.moveTo(sx, sy - s);
    g.lineTo(sx + s * 0.35, sy - s * 0.35);
    g.lineTo(sx + s, sy);
    g.lineTo(sx + s * 0.35, sy + s * 0.35);
    g.lineTo(sx, sy + s);
    g.lineTo(sx - s * 0.35, sy + s * 0.35);
    g.lineTo(sx - s, sy);
    g.lineTo(sx - s * 0.35, sy - s * 0.35);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#b3195b';
  g.textAlign = 'left';
  g.font = 'bold 22px "Comic Sans MS", "Chalkboard SE", "Trebuchet MS", sans-serif';
  g.fillText('LETHAL', -6, -14);
  g.fillText('WEAPON', -6, 10);
  g.font = 'bold 17px "Comic Sans MS", "Chalkboard SE", "Trebuchet MS", sans-serif';
  g.fillText('AUTHORIZED!', -6, 33);
  g.restore();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
