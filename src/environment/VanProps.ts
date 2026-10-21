import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { droppedAK } from '../entities/AkModel';

/**
 * The coworkers' van and what's in it: a big high-roofed panel van in plain
 * gunmetal grey — black bumpers, arches and rubbing strips, a sliding side
 * door, a cab you can see out of from the back — with two long benches
 * facing each other down the load bay for the crew, and an arsenal on its
 * walls and floor: rifles, shotguns, pistols, crates of grenades, ammo cans,
 * spare vests and helmets. And the badge Sanjay took off a dead contractor.
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
  /** Van frame: where people sit (feet on the floor at the bench's front edge), facing across; the driver's seat. Front to back. */
  seats: { left: THREE.Vector3[]; right: THREE.Vector3[]; driver: THREE.Vector3 };
  /** The load bay floor's height (van frame at rest); the middle of the door opening on the floor, and on the ground outside it. */
  floorY: number;
  doorIn: THREE.Vector3;
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

const L = 8.2;
const W = 2.34;
const H = 3.02;
const AXLE = 0.39;
const FLOOR = 0.68;
const WALL = 0.05;
const SILL = 0.8;
/** The load bay runs from the back of the cab to the rear doors. */
const BAY0 = -1.95;
const BAY1 = L / 2 - 0.06;
/** The door opening, along the right side. */
const DOOR0 = -1.8;
const DOOR1 = -0.05;
const DOOR_TOP = 2.7;
/** Where the roof starts, over the top of the windscreen; the bonnet's back edge, at the foot of the screen. */
const ROOF0 = -2.55;
const COWL = -3.25;
const AXLE_Z = [-2.95, 2.6];

export function crewVan(): VanRig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = AXLE;
  group.add(body);
  const meshes: THREE.Mesh[] = [];

  // Grey that reads as grey: little metalness, with no environment map for a metal to reflect
  const paint = new THREE.MeshStandardMaterial({ color: 0x8e959d, roughness: 0.45, metalness: 0.12 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.82 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.25, metalness: 0.85 });
  const seam = new THREE.MeshStandardMaterial({ color: 0x3c4147, roughness: 0.6, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x18222b, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
  const lining = new THREE.MeshStandardMaterial({ color: 0xa4a8ad, roughness: 0.85, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.95 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x272d3a, roughness: 0.95 });
  const peg = new THREE.MeshStandardMaterial({ color: 0x41464c, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x6f747a, roughness: 0.45, metalness: 0.6 });
  const olive = new THREE.MeshStandardMaterial({ color: 0x4b5633, roughness: 0.8 });
  const kit = new THREE.MeshStandardMaterial({ color: 0x353b2c, roughness: 0.88 });
  const headlights = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.15, emissive: 0xfff2d8, emissiveIntensity: 0.5 });
  const brakelights = new THREE.MeshStandardMaterial({ color: 0x7a0d0d, roughness: 0.25, emissive: 0xff1d12, emissiveIntensity: 0.2 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xb8681c, roughness: 0.3, emissive: 0xff8a1e, emissiveIntensity: 0.15 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xfff0d0, emissiveIntensity: 0 });

  // Everything here is placed in the van frame and hung on the body (which sits at axle height)
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, to: THREE.Object3D = body): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, to === body ? y - AXLE : y, z);
    m.rotation.set(rx, ry, rz);
    to.add(m);
    meshes.push(m);
    return m;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, to?: THREE.Object3D): THREE.Mesh =>
    put(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz, to);
  const round = (w: number, h: number, d: number, r: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh =>
    put(new RoundedBoxGeometry(w, h, d, 3, r), mat, x, y, z, rx);

  const hw = W / 2;
  // ---- The shell: sills between the arches, the sides, roof, the back
  const skirt = (z0: number, z1: number): void => {
    for (const sx of [-1, 1]) box(WALL, SILL - 0.4, z1 - z0, paint, sx * (hw - WALL / 2), (SILL + 0.4) / 2, (z0 + z1) / 2);
  };
  skirt(-L / 2 + 0.25, AXLE_Z[0] - 0.55);
  skirt(AXLE_Z[0] + 0.55, AXLE_Z[1] - 0.55);
  skirt(AXLE_Z[1] + 0.55, L / 2 - 0.05);
  box(W - 0.1, 0.06, BAY1 - COWL, rubber, 0, FLOOR - 0.03, (BAY1 + COWL) / 2);
  box(W - 0.12, FLOOR - 0.45, BAY1 - COWL, plastic, 0, (FLOOR + 0.45) / 2, (BAY1 + COWL) / 2);
  const wallH = H - SILL;
  const wallY = SILL + wallH / 2;
  // Left side, cab to back
  box(WALL, wallH, BAY1 - BAY0, paint, -hw + WALL / 2, wallY, (BAY0 + BAY1) / 2);
  box(0.01, H - FLOOR - 0.1, BAY1 - BAY0, lining, -hw + WALL + 0.006, (H + FLOOR) / 2, (BAY0 + BAY1) / 2);
  // Right side: behind the door, above it, and the strip ahead of it
  box(WALL, wallH, BAY1 - DOOR1, paint, hw - WALL / 2, wallY, (DOOR1 + BAY1) / 2);
  box(0.01, H - FLOOR - 0.1, BAY1 - DOOR1, lining, hw - WALL - 0.006, (H + FLOOR) / 2, (DOOR1 + BAY1) / 2);
  box(WALL, H - DOOR_TOP, DOOR1 - BAY0, paint, hw - WALL / 2, (H + DOOR_TOP) / 2, (BAY0 + DOOR1) / 2);
  box(WALL, wallH, DOOR0 - BAY0, paint, hw - WALL / 2, wallY, (BAY0 + DOOR0) / 2);
  box(WALL, SILL - FLOOR + 0.02, DOOR1 - DOOR0, paint, hw - WALL / 2, (SILL + FLOOR) / 2, (DOOR0 + DOOR1) / 2);
  // Roof, its edges rounded over, two rails along it; the ceiling lined
  round(W + 0.02, 0.12, BAY1 + 0.06 - ROOF0, 0.055, paint, 0, H, (BAY1 + 0.06 + ROOF0) / 2);
  for (const sx of [-1, 1]) {
    box(0.04, 0.04, BAY1 - ROOF0 - 0.6, seam, sx * (hw - 0.16), H + 0.08, (BAY1 + ROOF0) / 2);
    for (const z of [ROOF0 + 0.5, (BAY1 + ROOF0) / 2, BAY1 - 0.4]) box(0.05, 0.05, 0.08, seam, sx * (hw - 0.16), H + 0.055, z);
  }
  box(W - 0.12, 0.01, BAY1 - BAY0, lining, 0, H - 0.07, (BAY0 + BAY1) / 2);
  // A rubbing strip down each side; the sliding door's rail
  for (const sx of [-1, 1]) box(0.03, 0.09, L - 1.4, plastic, sx * (hw + 0.012), 1.08, 0.3);
  box(0.02, 0.025, BAY1 - DOOR1 - 0.3, seam, hw + 0.012, 2.02, (DOOR1 + BAY1) / 2 - 0.15);
  // The back: two doors, a window in each, the seam between, the lamps
  for (const sx of [-1, 1]) {
    box(hw - 0.012, H - FLOOR - 0.14, WALL, paint, (sx * hw) / 2, (H + FLOOR) / 2 - 0.07, BAY1 + 0.03);
    box(hw - 0.34, 0.5, 0.02, glass, (sx * hw) / 2, H - 0.62, BAY1 + 0.06);
    box(hw - 0.3, 0.56, 0.01, plastic, (sx * hw) / 2, H - 0.62, BAY1 + 0.055);
    box(0.05, 0.12, 0.04, plastic, sx * 0.14, 1.55, BAY1 + 0.07);
    // Tail lamp clusters up the corners: red, amber, white
    box(0.14, 0.34, 0.06, brakelights, sx * (hw - 0.08), 1.42, BAY1 + 0.06);
    box(0.14, 0.12, 0.06, amber, sx * (hw - 0.08), 1.18, BAY1 + 0.06);
    box(0.14, 0.09, 0.06, headlights, sx * (hw - 0.08), 1.06, BAY1 + 0.06);
  }
  box(0.012, H - FLOOR - 0.2, 0.01, seam, 0, (H + FLOOR) / 2, BAY1 + 0.06);
  box(W + 0.06, 0.24, 0.22, plastic, 0, 0.5, L / 2 + 0.04);
  box(0.9, 0.08, 0.32, plastic, 0, 0.36, L / 2 + 0.12);
  box(0.42, 0.11, 0.01, chrome, 0, 0.78, BAY1 + 0.065);

  // ---- The cab: doors and windows, the screen raked back, bonnet, grille, lamps
  const scr = { y0: 1.45, z0: COWL, y1: H - 0.05, z1: ROOF0 };
  const screenLen = Math.hypot(scr.y1 - scr.y0, scr.z1 - scr.z0);
  const rake = Math.atan2(scr.z1 - scr.z0, scr.y1 - scr.y0);
  const sy = (scr.y0 + scr.y1) / 2;
  const sz = (scr.z0 + scr.z1) / 2;
  box(W - 0.14, screenLen - 0.06, 0.02, glass, 0, sy, sz, rake);
  // Its rubber surround, top and bottom
  for (const e of [-1, 1]) box(W - 0.1, 0.05, 0.03, plastic, 0, sy + (e * (screenLen - 0.03) * Math.cos(rake)) / 2, sz + (e * (screenLen - 0.03) * Math.sin(rake)) / 2, rake);
  for (const sx of [-1, 1]) box(0.09, screenLen, 0.09, paint, sx * (hw - 0.045), sy, sz, rake);
  // Wipers at the foot of it
  for (const sx of [-0.5, 0.25]) box(0.62, 0.015, 0.02, plastic, sx, 1.47, COWL - 0.02, 0, 0.1);
  const cabZ0 = -L / 2 + 0.2;
  for (const sx of [-1, 1]) {
    const x = sx * (hw - WALL / 2);
    box(WALL, 1.55 - SILL, BAY0 - COWL, paint, x, (1.55 + SILL) / 2, (COWL + BAY0) / 2);
    box(WALL, 1.55 - SILL, COWL - cabZ0, paint, x, (1.55 + SILL) / 2, (cabZ0 + COWL) / 2);
    // The side window, cut back where the screen leans over it, in a black frame
    const wz0 = COWL + 0.25;
    box(0.02, 0.55, BAY0 - 0.14 - wz0, glass, x, 1.83, (BAY0 - 0.14 + wz0) / 2);
    box(0.02, 0.55, BAY0 - 0.14 - (ROOF0 + 0.12), glass, x, 2.4, (BAY0 - 0.14 + ROOF0 + 0.12) / 2);
    box(0.012, 1.2, BAY0 - 0.08 - wz0, plastic, x + sx * 0.004, 2.1, (BAY0 - 0.08 + wz0) / 2);
    box(WALL, H - 1.55, 0.14, paint, x, (H + 1.55) / 2, BAY0 - 0.07);
    // The cab door's seams, its handle; the mirror out on its arm
    box(0.012, 1.95, 0.012, seam, x + sx * 0.02, 1.8, BAY0 - 0.15);
    box(0.012, 0.012, BAY0 - COWL, seam, x + sx * 0.02, SILL + 0.03, (COWL + BAY0) / 2);
    box(0.03, 0.04, 0.16, plastic, x + sx * 0.03, 1.48, BAY0 - 0.35);
    box(0.24, 0.035, 0.035, plastic, sx * (hw + 0.1), 1.82, COWL + 0.18);
    round(0.08, 0.3, 0.17, 0.03, plastic, sx * (hw + 0.24), 1.86, COWL + 0.18);
  }
  // The sliding door's handle and edges
  // (the door itself is its own piece, below)
  // Bonnet, sloping down to the nose; the grille's slats; the lamps; the bumper
  round(W - 0.02, 0.24, -COWL - L / 2 + 0.95, 0.06, paint, 0, 1.3, (COWL - L / 2 + 0.05) / 2, -0.16);
  round(W, 0.72, 0.16, 0.05, paint, 0, 0.92, -L / 2 + 0.08);
  box(1.12, 0.32, 0.03, plastic, 0, 1.0, -L / 2 - 0.01);
  for (let i = 0; i < 4; i++) box(1.06, 0.022, 0.035, chrome, 0, 0.88 + i * 0.075, -L / 2 - 0.02);
  for (const sx of [-1, 1]) {
    box(0.36, 0.17, 0.05, plastic, sx * 0.83, 1.08, -L / 2 - 0.005);
    box(0.3, 0.12, 0.04, headlights, sx * 0.83, 1.08, -L / 2 - 0.02);
    box(0.09, 0.07, 0.04, amber, sx * 1.04, 0.99, -L / 2 - 0.015);
    // Fog lamps in the bumper
    box(0.12, 0.06, 0.03, headlights, sx * 0.78, 0.5, -L / 2 - 0.13);
  }
  // What they throw: down and ahead, a little out to each side
  const beams: THREE.SpotLight[] = [];
  for (const sx of [-1, 1]) {
    const beam = new THREE.SpotLight(0xfff0d6, 0, 80, 0.5, 0.6, 1.5);
    beam.position.set(sx * 0.83, 1.08 - AXLE, -L / 2 - 0.1);
    beam.target.position.set(sx * 1.2, -AXLE, -L / 2 - 24);
    body.add(beam, beam.target);
    beams.push(beam);
  }
  box(W + 0.08, 0.28, 0.24, plastic, 0, 0.52, -L / 2 - 0.02);
  box(0.46, 0.11, 0.01, chrome, 0, 0.68, -L / 2 - 0.15);
  // Arches: a black flare round the top of each wheel
  for (const z of AXLE_Z) {
    for (const sx of [-1, 1]) {
      const arch = new THREE.TorusGeometry(AXLE + 0.08, 0.05, 6, 16, Math.PI);
      arch.rotateY(Math.PI / 2);
      put(arch, plastic, sx * (hw + 0.005), AXLE, z, 0, 0, 0);
    }
  }
  // A step under the sliding door
  box(0.2, 0.06, DOOR1 - DOOR0 - 0.1, plastic, hw + 0.05, 0.52, (DOOR0 + DOOR1) / 2);
  // The dash, the wheel, two seats
  box(W - 0.12, 0.34, 0.6, plastic, 0, 1.3, COWL + 0.15);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.024, 8, 26), plastic);
  wheel.position.set(-0.5, 1.55 - AXLE, COWL + 0.62);
  wheel.rotation.x = -0.95;
  body.add(wheel);
  meshes.push(wheel);
  const seatZ = BAY0 - 0.45;
  for (const sx of [-0.5, 0.5]) {
    box(0.52, 0.12, 0.52, cloth, sx, FLOOR + 0.44, seatZ);
    box(0.52, 0.72, 0.1, cloth, sx, FLOOR + 0.86, seatZ + 0.25, 0.12);
    box(0.38, 0.38, 0.38, plastic, sx, FLOOR + 0.19, seatZ);
  }

  // ---- The sliding door: in the opening when shut; out and back along the side open
  const door = new THREE.Group();
  body.add(door);
  const dh = DOOR_TOP - SILL + 0.02;
  box(WALL, dh, DOOR1 - DOOR0 + 0.02, paint, 0, (DOOR_TOP + SILL) / 2 - AXLE, 0, 0, 0, 0, door);
  box(0.01, DOOR_TOP - FLOOR - 0.1, DOOR1 - DOOR0 - 0.1, lining, -0.03, (DOOR_TOP + FLOOR) / 2 - AXLE, 0, 0, 0, 0, door);
  box(0.012, dh, 0.012, seam, 0.03, (DOOR_TOP + SILL) / 2 - AXLE, (DOOR1 - DOOR0) / 2, 0, 0, 0, door);
  box(0.012, dh, 0.012, seam, 0.03, (DOOR_TOP + SILL) / 2 - AXLE, -(DOOR1 - DOOR0) / 2, 0, 0, 0, door);
  box(0.03, 0.045, 0.2, plastic, 0.035, 1.5 - AXLE, -0.55, 0, 0, 0, door);
  const doorMid = (DOOR0 + DOOR1) / 2;
  const setDoor = (k: number): void => {
    const c = Math.min(1, Math.max(0, k));
    // Out off its seal for the first fifth, then back along the runners
    const out = Math.min(1, c / 0.2) * 0.08;
    const back = Math.max(0, (c - 0.2) / 0.8) * (DOOR1 - DOOR0 + 0.05);
    door.position.set(hw - WALL / 2 + out, 0, doorMid + back);
  };
  setDoor(0);

  // ---- Wheels: tyre, steel rim, hub, the nuts round it
  const wheels: THREE.Object3D[] = [];
  const tyreGeo = new THREE.CylinderGeometry(AXLE, AXLE, 0.27, 24);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.235, 0.235, 0.275, 18);
  rimGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.29, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const nutGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.3, 6);
  nutGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x5f656c, roughness: 0.4, metalness: 0.7 });
  for (const z of AXLE_Z) {
    for (const sx of [-1, 1]) {
      const spin = new THREE.Group();
      spin.position.set(sx * (hw - 0.16), AXLE, z);
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

  // ---- The load bay: long benches down both sides, facing in
  const seatH = FLOOR + 0.46;
  const benchZ1 = BAY1 - 0.35;
  for (const sx of [-1, 1]) {
    // Not across the door opening: the right bench starts behind it
    const z0 = sx > 0 ? DOOR1 + 0.08 : BAY0 + 0.15;
    const len = benchZ1 - z0;
    box(0.48, 0.09, len, cloth, sx * (hw - 0.31), seatH - 0.045, z0 + len / 2);
    box(0.42, seatH - FLOOR - 0.09, len - 0.1, plastic, sx * (hw - 0.31), FLOOR + (seatH - FLOOR - 0.09) / 2, z0 + len / 2);
    box(0.07, 0.55, len, cloth, sx * (hw - 0.1), seatH + 0.34, z0 + len / 2);
  }
  // The dome lights down the ceiling, and the lamps that light the bay
  for (const z of [-0.6, 2.2]) box(0.2, 0.03, 1.3, lamp, 0, H - 0.08, z);
  const light = new THREE.PointLight(0xffe7c2, 0, 9, 1.5);
  light.position.set(0, H - 0.3 - AXLE, 0.8);
  body.add(light);
  const redLight = new THREE.PointLight(0xff2a1a, 0, 9, 1.4);
  redLight.position.set(0, H - 0.35 - AXLE, 2.6);
  body.add(redLight);

  // ---- The arsenal
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.7 });
  const blued = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.4, metalness: 0.7 });
  // Pegboard over the right bench, rifles hung along it one above the next, muzzles forward
  box(0.02, 0.92, 3.5, peg, hw - WALL - 0.02, 2.16, (DOOR1 + BAY1) / 2);
  const rack: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    for (const z of [0.95, 2.7]) {
      const ak = droppedAK();
      ak.rotation.z = Math.PI / 2;
      ak.position.set(hw - WALL - 0.08, 1.86 + i * 0.2 - AXLE, z);
      body.add(ak);
      rack.push(ak);
    }
  }
  // Over the left bench, behind where he sits: shotguns, and a row of pistols
  box(0.02, 0.92, 3.6, peg, -hw + WALL + 0.02, 2.16, 1.7);
  for (let i = 0; i < 3; i++) {
    for (const z of [0.6, 2.4]) {
      const sg = shotgun(wood, blued);
      sg.rotation.set(0, 0, Math.PI / 2);
      sg.position.set(-hw + WALL + 0.06, 2.48 - i * 0.18 - AXLE, z);
      body.add(sg);
    }
  }
  for (let i = 0; i < 8; i++) {
    const p = pistol(blued);
    p.rotation.set(0, 0, Math.PI / 2);
    p.position.set(-hw + WALL + 0.05, 1.86 - AXLE, 0.2 + i * 0.4);
    body.add(p);
  }
  // On the floor at the back: two crates of grenades, lids off; ammo cans; a long case
  for (const cx of [-0.45, 0.35]) {
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
  box(0.25, 0.15, 1.2, plastic, 0, FLOOR + 0.075, 2.4);
  // Spare kit hung on the back doors: vests and helmets
  for (const sx of [-0.62, -0.2, 0.22, 0.64]) {
    box(0.34, 0.42, 0.06, kit, sx, 2.25, BAY1 - 0.06);
    box(0.08, 0.06, 0.04, kit, sx, 2.5, BAY1 - 0.05);
    const helm = new THREE.SphereGeometry(0.12, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    put(helm, plastic, sx, 2.62, BAY1 - 0.14, -Math.PI / 2);
  }

  // Feet on the floor at each place along the benches; staggered side to side, so knees go between knees
  const seats = {
    left: [-1.35, -0.4, 0.95, 1.9, 2.85].map((z) => new THREE.Vector3(-hw + 0.5, FLOOR, z)),
    right: [0.5, 1.45, 2.4, 3.35].map((z) => new THREE.Vector3(hw - 0.5, FLOOR, z)),
    driver: new THREE.Vector3(-0.5, FLOOR, seatZ - 0.1)
  };
  return {
    group,
    body,
    wheels,
    setDoor,
    seats,
    floorY: FLOOR,
    doorIn: new THREE.Vector3(hw - 0.5, FLOOR, doorMid),
    doorOut: new THREE.Vector3(hw + 0.85, 0, doorMid),
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
