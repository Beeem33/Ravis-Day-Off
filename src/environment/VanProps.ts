import * as THREE from 'three';
import { droppedAK } from '../entities/AkModel';

/**
 * The coworkers' van and what's in it: a long-wheelbase white panel van
 * with the call centre's name still on the side, its sliding side door, a
 * cab you can see out of from the back, two benches facing each other down
 * the load bay, and an arsenal on its walls and floor — rifles, shotguns,
 * pistols, a crate of grenades, ammo cans. And the badge Sanjay took off a
 * dead contractor.
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
  /** Van-local, on the body: where people sit (hips on the cushion's front edge), facing across; the driver's seat. */
  seats: { left: THREE.Vector3[]; right: THREE.Vector3[]; driver: THREE.Vector3 };
  /** The load bay floor's height, body frame (= van frame at rest); the middle of the door opening on the floor, and on the ground outside it. */
  floorY: number;
  doorIn: THREE.Vector3;
  doorOut: THREE.Vector3;
  /** The dome light in the load bay (intensity 0 is off; it never leaves the scene). */
  light: THREE.PointLight;
  lamp: THREE.MeshStandardMaterial;
  headlights: THREE.MeshStandardMaterial;
  brakelights: THREE.MeshStandardMaterial;
  /** Every mesh the body carries (for render flags). */
  meshes: THREE.Mesh[];
}

const L = 6.6;
const W = 2.0;
const H = 2.62;
const AXLE = 0.36;
const FLOOR = 0.58;
const WALL = 0.05;
/** The load bay runs from the back of the cab to the rear doors. */
const BAY0 = -1.15;
const BAY1 = L / 2 - 0.05;
/** The door opening, along the right side. */
const DOOR0 = -1.05;
const DOOR1 = 0.4;
const DOOR_TOP = 2.3;
/** Where the roof starts, over the top of the windscreen. */
const ROOF0 = -1.95;

export function whiteVan(): VanRig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = AXLE;
  group.add(body);
  const meshes: THREE.Mesh[] = [];

  const paint = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.42, metalness: 0.12 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.75 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2730, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  const lining = new THREE.MeshStandardMaterial({ color: 0x9ea3a8, roughness: 0.85, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.95 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2d3446, roughness: 0.95 });
  const peg = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x6f747a, roughness: 0.45, metalness: 0.6 });
  const headlights = new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.2, emissive: 0xfff2d8, emissiveIntensity: 0.4 });
  const brakelights = new THREE.MeshStandardMaterial({ color: 0x6e0c0c, roughness: 0.3, emissive: 0xff1d12, emissiveIntensity: 0.2 });
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

  // ---- The shell: skirt and sills, floor, the two sides, roof, the back
  const hw = W / 2;
  box(W, 0.36, L - 0.2, paint, 0, 0.42, 0);
  box(W - 0.1, 0.05, BAY1 - (-2.9), rubber, 0, FLOOR - 0.02, (BAY1 - 2.9) / 2);
  const wallH = H - FLOOR;
  const wallY = FLOOR + wallH / 2;
  // Left side, cab door to the back
  box(WALL, wallH, BAY1 - BAY0, paint, -hw + WALL / 2, wallY, (BAY0 + BAY1) / 2);
  box(0.01, wallH - 0.1, BAY1 - BAY0, lining, -hw + WALL + 0.006, wallY, (BAY0 + BAY1) / 2);
  // Right side, behind the door opening; above it
  box(WALL, wallH, BAY1 - DOOR1, paint, hw - WALL / 2, wallY, (DOOR1 + BAY1) / 2);
  box(0.01, wallH - 0.1, BAY1 - DOOR1, lining, hw - WALL - 0.006, wallY, (DOOR1 + BAY1) / 2);
  box(WALL, H - DOOR_TOP, DOOR1 - BAY0, paint, hw - WALL / 2, (H + DOOR_TOP) / 2, (BAY0 + DOOR1) / 2);
  box(WALL, wallH, DOOR0 - BAY0, paint, hw - WALL / 2, wallY, (BAY0 + DOOR0) / 2);
  // Roof (the load bay's ceiling lined)
  box(W, 0.06, BAY1 - ROOF0, paint, 0, H, (BAY1 + ROOF0) / 2);
  box(W - 0.12, 0.01, BAY1 - BAY0, lining, 0, H - 0.04, (BAY0 + BAY1) / 2);
  // The back: two doors, a window in each, the bumper and the lamps
  for (const sx of [-1, 1]) {
    box(hw - 0.01, wallH - 0.62, WALL, paint, sx * hw / 2, FLOOR + (wallH - 0.62) / 2, BAY1);
    box(hw - 0.01, 0.12, WALL, paint, sx * hw / 2, H - 0.06, BAY1);
    box(hw - 0.22, 0.42, 0.02, glass, sx * hw / 2, H - 0.36, BAY1);
    box(0.12, 0.32, 0.04, brakelights, sx * (hw - 0.07), 1.05, BAY1 + 0.03);
  }
  box(W + 0.04, 0.2, 0.18, trim, 0, 0.42, L / 2 + 0.02);

  // ---- The cab: doors with windows, the screen raked back, bonnet, grille, lamps
  const cabZ0 = -L / 2 + 0.55;
  // The screen, from the back of the bonnet up and back to the roof
  const scr = { y0: 1.25, z0: -2.6, y1: 2.5, z1: ROOF0 };
  const screenLen = Math.hypot(scr.y1 - scr.y0, scr.z1 - scr.z0);
  const rake = Math.atan2(scr.z1 - scr.z0, scr.y1 - scr.y0);
  const sy = (scr.y0 + scr.y1) / 2;
  const sz = (scr.z0 + scr.z1) / 2;
  box(W - 0.06, screenLen, 0.02, glass, 0, sy, sz, rake);
  for (const sx of [-1, 1]) box(0.08, screenLen, 0.06, paint, sx * (hw - 0.04), sy, sz, rake);
  for (const sx of [-1, 1]) {
    const x = sx * (hw - WALL / 2);
    box(WALL, 1.5 - FLOOR, BAY0 - cabZ0, paint, x, (1.5 + FLOOR) / 2, (cabZ0 + BAY0) / 2);
    // The side window, cut back where the screen leans over it
    box(0.02, 0.5, BAY0 - 0.12 - -2.3, glass, x, 1.75, (BAY0 - 0.12 - 2.3) / 2);
    box(0.02, 0.5, BAY0 - 0.12 - (ROOF0 - 0.03), glass, x, 2.25, (BAY0 - 0.12 + ROOF0 - 0.03) / 2);
    box(WALL, H - 1.5, 0.12, paint, x, (H + 1.5) / 2, BAY0 - 0.06);
    // Mirrors
    box(0.06, 0.24, 0.14, trim, sx * (hw + 0.12), 1.75, -2.35);
  }
  box(W, 0.3, 0.75, paint, 0, 1.06, -2.95, -0.2);
  box(W, 0.5, 0.08, paint, 0, 0.68, -L / 2 + 0.02);
  box(1.1, 0.22, 0.03, trim, 0, 0.8, -L / 2 - 0.01);
  for (const sx of [-1, 1]) box(0.3, 0.14, 0.04, headlights, sx * 0.72, 0.95, -L / 2 - 0.01);
  box(W + 0.04, 0.22, 0.2, trim, 0, 0.42, -L / 2 - 0.02);
  // The dash, the wheel, two seats
  box(W - 0.1, 0.3, 0.5, trim, 0, 1.2, cabZ0 + 0.1);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 24), trim);
  wheel.position.set(-0.45, 1.42 - AXLE, cabZ0 + 0.55);
  wheel.rotation.x = -0.9;
  body.add(wheel);
  meshes.push(wheel);
  const seatZ = BAY0 - 0.42;
  for (const sx of [-0.45, 0.45]) {
    box(0.5, 0.12, 0.5, cloth, sx, FLOOR + 0.42, seatZ);
    box(0.5, 0.65, 0.1, cloth, sx, FLOOR + 0.8, seatZ + 0.24, 0.12);
    box(0.36, 0.36, 0.36, trim, sx, FLOOR + 0.18, seatZ);
  }

  // ---- The sliding door: in the opening when shut; out and back along the side open
  const door = new THREE.Group();
  body.add(door);
  box(WALL, DOOR_TOP - FLOOR + 0.02, DOOR1 - DOOR0 + 0.02, paint, 0, (DOOR_TOP + FLOOR) / 2 - AXLE, 0, 0, 0, 0, door);
  box(0.01, DOOR_TOP - FLOOR - 0.1, DOOR1 - DOOR0 - 0.1, lining, -0.03, (DOOR_TOP + FLOOR) / 2 - AXLE, 0, 0, 0, 0, door);
  box(0.03, 0.04, 0.22, trim, 0.035, 1.45 - AXLE, -0.45, 0, 0, 0, door);
  const doorMid = (DOOR0 + DOOR1) / 2;
  const setDoor = (k: number): void => {
    const c = Math.min(1, Math.max(0, k));
    // Out off its seal for the first fifth, then back along the runners
    const out = Math.min(1, c / 0.2) * 0.07;
    const back = Math.max(0, (c - 0.2) / 0.8) * (DOOR1 - DOOR0 + 0.05);
    door.position.set(hw - WALL / 2 + out, 0, doorMid + back);
  };
  setDoor(0);

  // ---- The call centre's name down each side, where it always was
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTexture(), transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const sx of [-1, 1]) {
    const plate = put(new THREE.PlaneGeometry(2.4, 0.6), sideMat, sx * (hw + 0.002), 1.62, 1.75, 0, (sx * Math.PI) / 2);
    plate.renderOrder = 1;
  }

  // ---- Wheels: a tyre and a white steel hub each
  const wheels: THREE.Object3D[] = [];
  const tyreGeo = new THREE.CylinderGeometry(AXLE, AXLE, 0.24, 18);
  tyreGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.5, metalness: 0.3 });
  for (const z of [-2.15, 2.2]) {
    for (const sx of [-1, 1]) {
      const spin = new THREE.Group();
      spin.position.set(sx * (hw - 0.14), AXLE, z);
      group.add(spin);
      const t = new THREE.Mesh(tyreGeo, rubber);
      const hb = new THREE.Mesh(hubGeo, hubMat);
      // A spoke so it can be seen turning
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.3), hubMat);
      spin.add(t, hb, sp);
      wheels.push(spin);
    }
  }

  // ---- The load bay: benches down both sides, facing in
  const benchZ0 = -0.2;
  const benchZ1 = 2.55;
  const seatH = FLOOR + 0.45;
  for (const sx of [-1, 1]) {
    // Not across the door opening: the right bench starts behind it
    const z0 = sx > 0 ? DOOR1 + 0.05 : benchZ0;
    const len = benchZ1 - z0;
    box(0.46, 0.08, len, cloth, sx * (hw - 0.3), seatH - 0.04, z0 + len / 2);
    box(0.4, seatH - FLOOR - 0.08, len - 0.1, trim, sx * (hw - 0.3), FLOOR + (seatH - FLOOR - 0.08) / 2, z0 + len / 2);
    box(0.06, 0.48, len, cloth, sx * (hw - 0.09), seatH + 0.3, z0 + len / 2);
  }
  // The dome light, a strip down the ceiling
  box(0.18, 0.03, 1.4, lamp, 0, H - 0.06, 1.0);
  const light = new THREE.PointLight(0xffe7c2, 0, 7, 1.6);
  light.position.set(0, H - 0.25 - AXLE, 1.0);
  body.add(light);

  // ---- The arsenal
  // Pegboard over each bench
  box(0.02, 0.7, 2.2, peg, hw - WALL - 0.02, 1.95, 1.75);
  box(0.02, 0.7, 2.6, peg, -hw + WALL + 0.02, 1.95, 1.15);
  // Rifles hung along the right wall, one above the next, muzzles forward
  for (let i = 0; i < 3; i++) {
    const ak = droppedAK();
    ak.rotation.z = Math.PI / 2;
    ak.position.set(hw - WALL - 0.08, 1.72 + i * 0.2 - AXLE, 1.85);
    body.add(ak);
  }
  // Shotguns, and pistols in a row, on the left wall
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.7 });
  const blued = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.4, metalness: 0.7 });
  // Along the wall, on their sides against the board
  for (let i = 0; i < 2; i++) {
    const sg = shotgun(wood, blued);
    sg.rotation.set(0, 0, Math.PI / 2);
    sg.position.set(-hw + WALL + 0.06, 2.12 - i * 0.2 - AXLE, 1.0);
    body.add(sg);
  }
  for (let i = 0; i < 4; i++) {
    const p = pistol(blued);
    p.rotation.set(0, 0, Math.PI / 2);
    p.position.set(-hw + WALL + 0.05, 1.74 - AXLE, 1.5 + i * 0.26);
    body.add(p);
  }
  // On the floor at the back: a crate of grenades, lid off; ammo cans; a long case
  const olive = new THREE.MeshStandardMaterial({ color: 0x4e5a35, roughness: 0.8 });
  const crate = new THREE.Group();
  crate.position.set(0.25, FLOOR - AXLE, 2.85);
  body.add(crate);
  box(0.62, 0.26, 0.42, olive, 0, 0.13, 0, 0, 0, 0, crate);
  box(0.66, 0.03, 0.46, olive, -0.3, 0.3, -0.12, 0, 0.5, 0.35, crate);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const g = grenade();
      g.position.set(-0.21 + c * 0.14, 0.27, -0.09 + r * 0.17);
      g.rotation.set(0.3 * (c % 2), c * 0.9, 0.2 * r);
      crate.add(g);
    }
  }
  for (let i = 0; i < 2; i++) {
    const can = new THREE.Group();
    can.position.set(-0.55 + i * 0.32, FLOOR - AXLE, 2.95);
    body.add(can);
    box(0.28, 0.2, 0.14, olive, 0, 0.1, 0, 0, 0, 0, can);
    box(0.12, 0.03, 0.03, metal, 0, 0.22, 0, 0, 0, 0, can);
  }
  box(0.25, 0.14, 1.1, trim, -0.55, FLOOR + 0.07, 2.2);

  // Staggered side to side, so the knees go between each other's
  const seats = {
    left: [0.25, 1.55, 2.35].map((z) => new THREE.Vector3(-hw + 0.48, FLOOR, z)),
    right: [0.95, 2.05].map((z) => new THREE.Vector3(hw - 0.48, FLOOR, z)),
    driver: new THREE.Vector3(-0.45, FLOOR, seatZ - 0.1)
  };
  return {
    group,
    body,
    wheels,
    setDoor,
    seats,
    floorY: FLOOR,
    doorIn: new THREE.Vector3(hw - 0.45, FLOOR, doorMid),
    doorOut: new THREE.Vector3(hw + 0.75, 0, doorMid),
    light,
    lamp,
    headlights,
    brakelights,
    meshes
  };
}

/** "RAVI-CALL SYSTEMS — CUSTOMER CARE", the call centre's van livery. */
function sideTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#1f4f8f';
  g.font = 'bold 100px "Arial Black", Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('RAVI-CALL', 24, 92);
  const wide = g.measureText('RAVI-CALL').width;
  g.fillStyle = '#d23b2a';
  g.font = 'bold 54px Arial, sans-serif';
  g.fillText('SYSTEMS', 24 + wide + 22, 100);
  g.fillStyle = '#3a3f46';
  g.font = 'italic 46px Georgia, serif';
  g.fillText('"Your call matters to us."', 28, 196);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
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
