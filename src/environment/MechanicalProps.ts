import * as THREE from 'three';

/**
 * MechanicalProps — the basement's plant: pipes, drums, consoles, generators,
 * cabling, lamps and the main breaker.
 *
 * Same conventions as OfficeProps: every prop is a Group standing on its own
 * origin at floor level, front facing +Z at yaw 0, and wall-mounted pieces
 * have their back on the z = 0 plane. Materials are shared across instances
 * — the level folds its dressing into one mesh per material, and that only
 * pays off if the same few materials recur.
 */

const lam = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color });
const metal = (color: number, rough = 0.5, met = 0.6): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: met });

const M = {
  pipeGrey: metal(0x6d747b, 0.55, 0.55),
  pipeGreen: metal(0x3f5a45, 0.6, 0.45),
  pipeRust: metal(0x6e4630, 0.75, 0.4),
  pipeCopper: metal(0x9a6440, 0.45, 0.7),
  flange: metal(0x4d5358, 0.5, 0.6),
  steel: metal(0x8a9197, 0.45, 0.6),
  darkSteel: metal(0x3b4046, 0.5, 0.55),
  paintGrey: lam(0x727a80),
  paintGreen: lam(0x3e5c3f),
  paintYellow: lam(0xc9a22a),
  black: lam(0x1d2023),
  rubber: lam(0x16181a),
  drumYellow: lam(0xc79a1e),
  drumBlue: lam(0x2d4f86),
  drumRust: lam(0x7a3f26),
  concrete: lam(0x7f8184),
  concreteDark: lam(0x5f6164),
  rebar: metal(0x5a4a3e, 0.8, 0.5),
  screen: new THREE.MeshStandardMaterial({ color: 0x0c1410, roughness: 0.2, metalness: 0.4 }),
  dialFace: lam(0xe8e4d6),
  needle: lam(0x9a1a12),
  chrome: metal(0xb9bec4, 0.3, 0.85),
  estop: lam(0xb3201a)
};

export type PipeKind = 'grey' | 'green' | 'rust' | 'copper';
const pipeMat = (kind: PipeKind): THREE.MeshStandardMaterial =>
  ({ grey: M.pipeGrey, green: M.pipeGreen, rust: M.pipeRust, copper: M.pipeCopper })[kind];
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);

const lampMats = {
  red: new THREE.MeshStandardMaterial({ color: 0x3a0806, emissive: 0xff2a18, emissiveIntensity: 1.3 }),
  green: new THREE.MeshStandardMaterial({ color: 0x0a2a10, emissive: 0x33ff66, emissiveIntensity: 1.2 }),
  amber: new THREE.MeshStandardMaterial({ color: 0x3a2806, emissive: 0xffb02a, emissiveIntensity: 1.2 })
};

// ------------------------------------------------------------------- pipes

/**
 * A straight pipe run along local X, centred on the origin, with flanged
 * joints every couple of metres. Lay it along a wall or the ceiling.
 */
export function pipe(length: number, r = 0.08, kind: PipeKind = 'grey'): THREE.Group {
  const g = new THREE.Group();
  const mat = pipeMat(kind);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, length, 12), mat);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const joints = Math.max(2, Math.round(length / 2.4) + 1);
  for (let i = 0; i < joints; i++) {
    const x = -length / 2 + (length * i) / (joints - 1);
    const f = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.45, r * 1.45, 0.06, 12), M.flange);
    f.rotation.z = Math.PI / 2;
    f.position.x = Math.max(-length / 2 + 0.03, Math.min(length / 2 - 0.03, x));
    g.add(f);
  }
  return g;
}

/** A bracket holding pipes off a wall: a strut and a strap per pipe. */
export function pipeBracket(drop = 0.22): THREE.Group {
  const g = new THREE.Group();
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, drop), M.darkSteel);
  strut.position.z = drop / 2;
  g.add(strut);
  return g;
}

/** Flange ring round a pipe of radius `r` at `at`, square to `dir`. */
function flangeAt(g: THREE.Group, at: THREE.Vector3, dir: THREE.Vector3, r: number, grow = 1.4, thick = 0.05): void {
  const f = new THREE.Mesh(new THREE.CylinderGeometry(r * grow, r * grow, thick, 14), M.flange);
  f.position.copy(at);
  f.quaternion.setFromUnitVectors(UP, dir);
  g.add(f);
}

/**
 * One continuous pipe laid through the world-space points `pts`: straight
 * runs, joined at every change of direction by a long-radius elbow (bend
 * radius three times the pipe's), with a flange either side of each elbow
 * and every few metres along the runs.
 *
 * This is how a pipe gets round a corner. The old corridors laid each one
 * as a separate straight that stopped dead at the end of its wall, and the
 * next corridor started a fresh one — so every bend was a row of cut ends.
 *
 * Where an end meets a wall, floor or ceiling (`ends`), the run carries on a
 * few centimetres into it and a collar sits on the face, so it reads as
 * going through rather than stopping short. Built in world space: add the
 * group at the origin.
 */
export function pipeRoute(
  pts: THREE.Vector3[],
  r: number,
  kind: PipeKind,
  ends: { start: boolean; end: boolean } = { start: true, end: true },
  flangeEvery = 3.0
): THREE.Group {
  const g = new THREE.Group();
  const mat = pipeMat(kind);
  const bend = r * 3;
  const n = pts.length;
  const dirs: THREE.Vector3[] = [];
  for (let i = 0; i < n - 1; i++) dirs.push(pts[i + 1].clone().sub(pts[i]).normalize());

  // How far each run stops short of its corner to make room for the elbow
  const trim = new Array<number>(n).fill(0);
  const turn = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const th = Math.acos(THREE.MathUtils.clamp(dirs[i - 1].dot(dirs[i]), -1, 1));
    turn[i] = th;
    trim[i] = th > 1e-3 ? bend * Math.tan(th / 2) : 0;
  }

  for (let i = 0; i < n - 1; i++) {
    const d = dirs[i];
    const a = pts[i].clone().addScaledVector(d, trim[i]);
    const b = pts[i + 1].clone().addScaledVector(d, -trim[i + 1]);
    if (i === 0 && ends.start) a.addScaledVector(d, -0.06);
    if (i === n - 2 && ends.end) b.addScaledVector(d, 0.06);
    const len = a.distanceTo(b);
    if (len < 1e-3) continue;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    body.position.copy(a).add(b).multiplyScalar(0.5);
    body.quaternion.setFromUnitVectors(UP, d);
    g.add(body);
    // Joints along the run, kept clear of the fittings at either end
    const clear = 0.45;
    const span = len - 2 * clear;
    const joints = Math.floor(span / flangeEvery);
    for (let k = 1; k <= joints; k++) {
      flangeAt(g, a.clone().addScaledVector(d, clear + (span * k) / (joints + 1)), d, r);
    }
  }

  // The elbows
  for (let i = 1; i < n - 1; i++) {
    if (turn[i] < 1e-3) continue;
    const d1 = dirs[i - 1];
    const d2 = dirs[i];
    // In the plane of the turn, square to the incoming run, towards the outgoing one
    const side = d2.clone().addScaledVector(d1, -d1.dot(d2)).normalize();
    const start = pts[i].clone().addScaledVector(d1, -trim[i]);
    const centre = start.clone().addScaledVector(side, bend);
    // TorusGeometry sweeps from +X towards +Y about Z: +X is centre→start,
    // +Y the direction of travel at the start
    const X = side.clone().negate();
    const Y = d1.clone();
    const Z = X.clone().cross(Y);
    const elbow = new THREE.Mesh(new THREE.TorusGeometry(bend, r, 12, 10, turn[i]), mat);
    elbow.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    elbow.position.copy(centre);
    g.add(elbow);
    flangeAt(g, start, d1, r);
    flangeAt(g, pts[i].clone().addScaledVector(d2, trim[i]), d2, r);
  }

  // Collars where it goes into the structure
  if (ends.start) flangeAt(g, pts[0].clone().addScaledVector(dirs[0], 0.018), dirs[0], r, 1.75, 0.036);
  if (ends.end) flangeAt(g, pts[n - 1].clone().addScaledVector(dirs[n - 2], -0.018), dirs[n - 2], r, 1.75, 0.036);
  return g;
}

/**
 * A clamp holding a pipe off the wall behind it: a band round the pipe and
 * a strut back to the wall. Origin at the pipe's centre; `toWall` is the way
 * to the wall and `reach` how far it is from the pipe's surface.
 */
export function pipeClamp(r: number, along: THREE.Vector3, toWall: THREE.Vector3, reach: number): THREE.Group {
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(r + 0.009, 0.01, 5, 16), M.darkSteel);
  band.quaternion.setFromUnitVectors(FWD, along);
  g.add(band);
  const L = reach + 0.03; // into the wall a touch, so there is no gap at the face
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.036, L), M.darkSteel);
  strut.quaternion.setFromUnitVectors(FWD, toWall);
  strut.position.copy(toWall).multiplyScalar(r + L / 2);
  g.add(strut);
  return g;
}

/** A band and a drop rod to the ceiling `rise` metres above the pipe's top. */
export function pipeHanger(r: number, along: THREE.Vector3, rise: number): THREE.Group {
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(r + 0.009, 0.01, 5, 16), M.darkSteel);
  band.quaternion.setFromUnitVectors(FWD, along);
  g.add(band);
  const L = rise + 0.04;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, L, 6), M.darkSteel);
  rod.position.y = r + L / 2;
  g.add(rod);
  return g;
}

/** Rectangular ventilation duct along local X, with its seams. */
export function duct(length: number, w = 0.6, h = 0.42): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(length, h, w), M.steel);
  g.add(body);
  const seams = Math.max(2, Math.round(length / 1.5) + 1);
  for (let i = 0; i < seams; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, h + 0.03, w + 0.03), M.darkSteel);
    s.position.x = -length / 2 + (length * i) / (seams - 1);
    g.add(s);
  }
  return g;
}

/**
 * The frame round a duct where it goes into a wall square to its run (local
 * X): four bars round the w × h section, flat on the face.
 */
export function ductWallCollar(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const t = 0.05;
  const bar = (sy: number, sz: number, y: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, sy, sz), M.darkSteel);
    m.position.set(0, y, z);
    g.add(m);
  };
  bar(t, w + 2 * t, h / 2 + t / 2, 0);
  bar(t, w + 2 * t, -h / 2 - t / 2, 0);
  bar(h, t, 0, w / 2 + t / 2);
  bar(h, t, 0, -w / 2 - t / 2);
  return g;
}

/** The same frame lying flat, where a riser goes up through the ceiling. */
export function ductCeilingCollar(lx: number, w: number): THREE.Group {
  const g = new THREE.Group();
  const t = 0.05;
  const bar = (sx: number, sz: number, x: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.03, sz), M.darkSteel);
    m.position.set(x, 0, z);
    g.add(m);
  };
  bar(lx + 2 * t, t, 0, w / 2 + t / 2);
  bar(lx + 2 * t, t, 0, -w / 2 - t / 2);
  bar(t, w, lx / 2 + t / 2, 0);
  bar(t, w, -lx / 2 - t / 2, 0);
  return g;
}

/** Where a duct turns up into the slab: an upright box of its own section. */
export function ductRiser(lx: number, h: number, w: number): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(lx, h, w), M.steel));
  // A seam round it just above the run it turns out of
  const seam = new THREE.Mesh(new THREE.BoxGeometry(lx + 0.03, 0.04, w + 0.03), M.darkSteel);
  seam.position.y = -h / 2 + 0.36;
  g.add(seam);
  return g;
}

/**
 * A cable slung through `points`, sagging between them. Heavy rubber, so it
 * reads at a distance in torchlight.
 */
export function cable(points: THREE.Vector3[], r = 0.022): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), r, 6, false), M.rubber);
}

/**
 * A heavy cable laid through the world-space corners `corners` — straight
 * lengths with each corner rounded off to a gentle bend — for anything that
 * has to lie on the floor or run tight to a wall.
 *
 * `cable()` threads a spline through its points, and a spline overshoots:
 * coming down off a generator steeply and then along the floor, it carried
 * on past the floor point and back, dipping a few centimetres into the
 * concrete between every pair of floor points. Straight runs and circular
 * bends cannot overshoot, so a corner at y = r puts the cable exactly on the
 * floor, touching it and never through it.
 */
export function routedCable(corners: THREE.Vector3[], r = 0.03, fillet = 0.14): THREE.Mesh {
  const n = corners.length;
  const dirs: THREE.Vector3[] = [];
  const lens: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = corners[i + 1].clone().sub(corners[i]);
    lens.push(d.length());
    dirs.push(d.normalize());
  }
  const path = new THREE.CurvePath<THREE.Vector3>();
  let cursor = corners[0].clone();
  for (let i = 1; i < n - 1; i++) {
    const d1 = dirs[i - 1];
    const d2 = dirs[i];
    const th = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
    if (th < 1e-3) continue;
    // Bend radius, shrunk if a leg is too short to take the full one
    const rb = Math.min(fillet, (0.45 * Math.min(lens[i - 1], lens[i])) / Math.tan(th / 2));
    const t = rb * Math.tan(th / 2);
    const start = corners[i].clone().addScaledVector(d1, -t);
    const end = corners[i].clone().addScaledVector(d2, t);
    path.add(new THREE.LineCurve3(cursor, start));
    const side = d2.clone().addScaledVector(d1, -d1.dot(d2)).normalize();
    const centre = start.clone().addScaledVector(side, rb);
    const axis = d1.clone().cross(d2).normalize();
    const from = start.clone().sub(centre);
    const steps = 8;
    let prev = start;
    for (let k = 1; k <= steps; k++) {
      const p = centre.clone().add(from.clone().applyAxisAngle(axis, (th * k) / steps));
      path.add(new THREE.LineCurve3(prev, p));
      prev = p;
    }
    cursor = end;
  }
  path.add(new THREE.LineCurve3(cursor, corners[n - 1].clone()));
  const segments = Math.max(16, Math.round(path.getLength() / 0.035));
  return new THREE.Mesh(new THREE.TubeGeometry(path, segments, r, 8, false), M.rubber);
}

// ------------------------------------------------------------------- drums

/** Steel drum: body, two rolling hoops, and a lid with its bung. */
export function barrel(kind: 'yellow' | 'blue' | 'rust' = 'blue'): THREE.Group {
  const g = new THREE.Group();
  const mat = { yellow: M.drumYellow, blue: M.drumBlue, rust: M.drumRust }[kind];
  const R = 0.29;
  const H = 0.88;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 18), mat);
  body.position.y = H / 2;
  g.add(body);
  for (const y of [H * 0.33, H * 0.66]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(R + 0.005, 0.014, 6, 20), mat);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
    g.add(hoop);
  }
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.01, 0.012, 6, 20), M.darkSteel);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = H;
  g.add(rim);
  const bung = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), M.darkSteel);
  bung.position.set(0.14, H + 0.01, 0.05);
  g.add(bung);
  if (kind === 'yellow') {
    // A black band, the way the hazardous ones are marked
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.003, R + 0.003, 0.12, 18, 1, true), M.black);
    band.position.y = H * 0.5;
    g.add(band);
  }
  return g;
}

// ----------------------------------------------------------------- consoles

/** Console height, for the collider the level puts round it. */
export const CONSOLE_H = 1.52;

/**
 * Floor-standing control console, operator side on +Z. The top of the
 * cabinet slopes DOWN towards whoever stands at it, so the rows of lamps,
 * buttons and switches on it face them, and an upright instrument panel
 * along the back carries a dead monitor, two gauges and a strip of status
 * lamps.
 *
 * The desk used to be tilted the other way — high at the front edge and
 * falling away to the back — with its buttons laid on the opposite slope,
 * sunk into the face along one row and standing off it along the other.
 * From the front that is a panel turned away from you with its controls
 * upside down. Everything on the desk now hangs off one frame laid exactly
 * on the slope, so it cannot drift off the surface again.
 */
export function controlConsole(): THREE.Group {
  const g = new THREE.Group();
  const W = 1.2;
  const FRONT = 0.31;
  const BACK = -0.31;
  const LIP_Y = 0.86; // front edge of the desk, nearest the operator
  const DESK_Z = -0.14; // where the desk runs up into the instrument panel
  const DESK_Y = 1.06;

  // The cabinet is one extruded side profile, so the slope has proper
  // sides rather than a gap under a tilted board
  const profile = new THREE.Shape();
  profile.moveTo(FRONT, 0);
  profile.lineTo(FRONT, LIP_Y);
  profile.lineTo(DESK_Z, DESK_Y);
  profile.lineTo(DESK_Z, CONSOLE_H);
  profile.lineTo(BACK, CONSOLE_H);
  profile.lineTo(BACK, 0);
  profile.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(profile, { depth: W, bevelEnabled: false });
  // Profile x is the console's z; the extrusion runs across its width
  bodyGeo.rotateY(-Math.PI / 2);
  bodyGeo.translate(W / 2, 0, 0);
  g.add(new THREE.Mesh(bodyGeo, M.paintGrey));
  // Toe kick and a steel lip along the front edge of the desk
  const kick = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 0.08, 0.012), M.black);
  kick.position.set(0, 0.04, FRONT + 0.004);
  g.add(kick);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(W + 0.01, 0.026, 0.03), M.darkSteel);
  lip.position.set(0, LIP_Y - 0.004, FRONT - 0.008);
  g.add(lip);

  // ---- The desk: a frame lying on the slope, +Y out of the face and +Z
  // running down it towards the operator
  const run = FRONT - DESK_Z;
  const rise = DESK_Y - LIP_Y;
  const len = Math.hypot(run, rise);
  const desk = new THREE.Group();
  desk.position.set(0, (LIP_Y + DESK_Y) / 2, (FRONT + DESK_Z) / 2);
  desk.rotation.x = Math.atan2(rise, run);
  g.add(desk);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(W - 0.12, 0.012, len - 0.07), M.darkSteel);
  plate.position.y = 0.006;
  desk.add(plate);
  const onDesk = (m: THREE.Mesh, x: number, z: number, h: number): void => {
    m.position.set(x, 0.012 + h / 2, z);
    desk.add(m);
  };
  // Top row: square lamp buttons, lit
  const lampCols = [lampMats.green, lampMats.amber, lampMats.red, lampMats.green];
  for (let c = 0; c < 8; c++) {
    onDesk(new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.018, 0.046), lampCols[c % 4]), -0.42 + c * 0.12, -0.15, 0.018);
  }
  // Middle row: round push buttons
  for (let c = 0; c < 6; c++) {
    onDesk(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.02, 14), M.black), -0.3 + c * 0.12, -0.035, 0.02);
  }
  // Bottom row: toggle switches on their plates, all thrown towards the operator
  for (let c = 0; c < 6; c++) {
    const x = -0.3 + c * 0.12;
    onDesk(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.042), M.steel), x, 0.085, 0.008);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.05, 6), M.chrome);
    lever.position.set(x, 0.035, 0.095);
    lever.rotation.x = 0.45;
    desk.add(lever);
  }
  // Rotary selectors at the left end, each with a pointer line
  for (const z of [-0.035, 0.085]) {
    onDesk(new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.028, 16), M.black), -0.46, z, 0.028);
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.003, 0.022), M.dialFace);
    tick.position.set(-0.46, 0.0415, z - 0.008);
    desk.add(tick);
  }
  // Emergency stop at the right end: red mushroom on a yellow collar
  onDesk(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 18), M.paintYellow), 0.46, 0.03, 0.01);
  const estop = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.03, 18), M.estop);
  estop.position.set(0.46, 0.022 + 0.015, 0.03);
  desk.add(estop);

  // ---- The instrument panel, facing the operator over the desk
  const face = DESK_Z;
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.02), M.black);
  bezel.position.set(-0.27, 1.29, face + 0.01);
  g.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), M.screen);
  screen.position.set(-0.27, 1.29, face + 0.021);
  g.add(screen);
  const needleAngles = [0.7, -0.35];
  [0.15, 0.37].forEach((x, i) => {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.024, 20), M.darkSteel);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 1.29, face + 0.012);
    g.add(ring);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.063, 20), M.dialFace);
    dial.position.set(x, 1.29, face + 0.0245);
    g.add(dial);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.003), M.needle);
    needle.geometry.translate(0, 0.022, 0);
    needle.position.set(x, 1.29, face + 0.027);
    needle.rotation.z = needleAngles[i];
    g.add(needle);
  });
  // Status lamps along the top of the panel
  const stripCols = [lampMats.green, lampMats.green, lampMats.amber, lampMats.green, lampMats.red, lampMats.amber];
  stripCols.forEach((m, i) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.014, 12), m);
    l.rotation.x = Math.PI / 2;
    l.position.set(-0.45 + i * 0.18, 1.465, face + 0.007);
    g.add(l);
  });
  return g;
}

/**
 * Wall-mounted electrical cabinet: door with a seam and handle, a hazard
 * sticker, and the conduit it is fed through. Back on z = 0.
 */
export function electricalBox(w = 0.6, h = 0.8): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.22), M.paintGrey);
  box.position.set(0, 0, 0.11);
  g.add(box);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.01, h - 0.06, 0.005), M.black);
  seam.position.set(w * 0.2, 0, 0.222);
  g.add(seam);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.12, 0.03), M.darkSteel);
  handle.position.set(w * 0.3, 0, 0.235);
  g.add(handle);
  g.add(hazardSticker(0.14, 0, h * 0.18, 0.223));
  const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8), M.darkSteel);
  conduit.position.set(-w * 0.3, h / 2 + 0.6, 0.06);
  g.add(conduit);
  return g;
}

/** Yellow warning triangle with a bolt, as a flat decal. */
function hazardSticker(size: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), hazardMat());
  m.position.set(x, y, z);
  return m;
}

let hazardMatCache: THREE.MeshLambertMaterial | null = null;
function hazardMat(): THREE.MeshLambertMaterial {
  if (hazardMatCache) return hazardMatCache;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, 64, 64);
  x.fillStyle = '#e8b62a';
  x.beginPath();
  x.moveTo(32, 4);
  x.lineTo(61, 58);
  x.lineTo(3, 58);
  x.closePath();
  x.fill();
  x.strokeStyle = '#111';
  x.lineWidth = 4;
  x.stroke();
  x.fillStyle = '#111';
  x.beginPath();
  x.moveTo(35, 18);
  x.lineTo(24, 38);
  x.lineTo(32, 38);
  x.lineTo(28, 52);
  x.lineTo(41, 30);
  x.lineTo(33, 30);
  x.closePath();
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  hazardMatCache = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5 });
  return hazardMatCache;
}

// --------------------------------------------------------------- generators

/**
 * A diesel standby set: skid, housing with its radiator grille at one end,
 * an exhaust stack, and the control box with a status lamp. About 2.5m long
 * on local X and 1.1m deep.
 */
export function generator(): THREE.Group {
  const g = new THREE.Group();
  const skid = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 1.15), M.darkSteel);
  skid.position.y = 0.07;
  g.add(skid);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.25, 1.0), M.paintGreen);
  housing.position.set(-0.15, 0.14 + 0.625, 0);
  g.add(housing);
  // Louvred side panels
  for (let i = 0; i < 6; i++) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.02), M.black);
    l.position.set(-0.4, 0.45 + i * 0.12, 0.51);
    g.add(l);
  }
  // Radiator end with its grille
  const rad = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.2, 0.98), M.darkSteel);
  rad.position.set(1.04, 0.14 + 0.6, 0);
  g.add(rad);
  for (let i = 0; i < 9; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.05, 0.03), M.black);
    slat.position.set(1.19, 0.14 + 0.6, -0.4 + i * 0.1);
    g.add(slat);
  }
  // Exhaust stack and its rain cap
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 10), M.pipeRust);
  stack.position.set(-0.8, 0.14 + 1.25 + 0.45, -0.2);
  g.add(stack);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.06, 10), M.pipeRust);
  cap.position.set(-0.8, 0.14 + 1.25 + 0.93, -0.2);
  g.add(cap);
  // Control box
  const ctl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.2), M.paintGrey);
  ctl.position.set(-0.5, 1.12, 0.6);
  g.add(ctl);
  const status = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), lampMats.amber);
  status.position.set(-0.36, 1.22, 0.71);
  g.add(status);
  g.add(hazardSticker(0.16, 0.35, 1.05, 0.505));
  return g;
}

// ------------------------------------------------------------------- lamps

/** Wall-mounted caged emergency lamp with a red dome. Back on z = 0. */
export function cageLamp(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.05), M.darkSteel);
  base.position.z = 0.025;
  g.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), lampMats.red);
  dome.rotation.x = Math.PI / 2;
  dome.position.z = 0.05;
  g.add(dome);
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.006, 4, 12, Math.PI), M.darkSteel);
    bar.rotation.set(0, Math.PI / 2, (i / 4) * Math.PI);
    bar.position.z = 0.05;
    g.add(bar);
  }
  return g;
}

/**
 * Industrial fluorescent fixture, hung from the ceiling. `tube` is the
 * material the scene switches when the power comes back.
 */
export function ceilingFixture(tube: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.26), M.paintGrey);
  g.add(body);
  const t = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.14), tube);
  t.position.y = -0.05;
  g.add(t);
  for (const x of [-0.5, 0.5]) {
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 4), M.darkSteel);
    chain.position.set(x, 0.19, 0);
    g.add(chain);
  }
  return g;
}

// ------------------------------------------------------------------- signs

const signCache = new Map<string, THREE.MeshLambertMaterial>();

/** Yellow-and-black warning sign, lines of text under a hazard bar. */
export function warningSign(lines: string[], w = 0.7, h = 0.45): THREE.Group {
  const key = lines.join('|');
  let mat = signCache.get(key);
  if (!mat) {
    const c = document.createElement('canvas');
    c.width = 280;
    c.height = 180;
    const x = c.getContext('2d')!;
    x.fillStyle = '#e8b62a';
    x.fillRect(0, 0, 280, 180);
    // Hazard stripes across the top
    x.save();
    x.beginPath();
    x.rect(0, 0, 280, 36);
    x.clip();
    x.fillStyle = '#111';
    for (let i = -2; i < 16; i++) {
      x.beginPath();
      x.moveTo(i * 24, 0);
      x.lineTo(i * 24 + 12, 0);
      x.lineTo(i * 24 - 24, 36);
      x.lineTo(i * 24 - 36, 36);
      x.closePath();
      x.fill();
    }
    x.restore();
    x.fillStyle = '#111';
    x.textAlign = 'center';
    const size = lines.length > 2 ? 26 : 32;
    x.font = 'bold ' + size + 'px Arial, Helvetica, sans-serif';
    lines.forEach((l, i) => x.fillText(l, 140, 36 + (i + 1) * ((180 - 36) / (lines.length + 1)) + size * 0.35));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshLambertMaterial({ map: tex });
    signCache.set(key, mat);
  }
  const g = new THREE.Group();
  const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.012), M.darkSteel);
  back.position.z = 0.006;
  g.add(back);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  face.position.z = 0.013;
  g.add(face);
  return g;
}

// ------------------------------------------------------------------ debris

/**
 * A slab of broken floor standing out of the water: a flat top at y = 0 so
 * the collider under it is honest, ragged chunks hanging off its sides below
 * the walking surface, and rebar bent out of the broken edges.
 */
export function debrisPlatform(w: number, d: number, depth = 1.05, seed = 1): THREE.Group {
  const g = new THREE.Group();
  let s = seed * 9301 + 49297;
  const rnd = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const core = new THREE.Mesh(new THREE.BoxGeometry(w, depth, d), M.concrete);
  core.position.y = -depth / 2;
  g.add(core);
  // Broken edges. These are pieces of a floor that was torn apart, not cut,
  // so the sides want to be a mess of wedges canted every which way — angled
  // steeply enough to read as fracture rather than trim. Everything sits
  // below the walking face so none of it can be tripped on.
  for (let i = 0; i < 11; i++) {
    const cw = 0.14 + rnd() * 0.3;
    const cd = 0.14 + rnd() * 0.3;
    const ch = 0.22 + rnd() * 0.55;
    const lump = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cd), rnd() < 0.5 ? M.concrete : M.concreteDark);
    const side = i % 4;
    const along = (rnd() - 0.5) * 0.95;
    lump.position.set(
      side === 0 ? w / 2 + (rnd() - 0.3) * 0.12 : side === 1 ? -w / 2 - (rnd() - 0.3) * 0.12 : along * w,
      -0.1 - ch / 2 - rnd() * 0.3,
      side === 2 ? d / 2 + (rnd() - 0.3) * 0.12 : side === 3 ? -d / 2 - (rnd() - 0.3) * 0.12 : along * d
    );
    lump.rotation.set((rnd() - 0.5) * 1.5, rnd() * Math.PI, (rnd() - 0.5) * 1.5);
    g.add(lump);
  }
  // Shards still hanging off the broken lip, tipped out and down
  for (let i = 0; i < 4; i++) {
    const side = i < 2 ? 1 : -1;
    const sw = 0.1 + rnd() * 0.16;
    const shard = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.05, 0.1 + rnd() * 0.2), M.concreteDark);
    shard.position.set(side * (w / 2 - 0.02 + rnd() * 0.14), -0.05 - rnd() * 0.1, (rnd() - 0.5) * d * 0.85);
    shard.rotation.set((rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.9, side * (0.35 + rnd() * 0.55));
    g.add(shard);
  }
  // A darker skin on the top so the walkable face reads against the water
  const top = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, 0.02, d - 0.04), M.concreteDark);
  top.position.y = -0.005;
  g.add(top);
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5 + rnd() * 0.4, 5), M.rebar);
    const side = i % 2 === 0 ? 1 : -1;
    bar.position.set(side * (w / 2 + 0.1), -0.08, (rnd() - 0.5) * d * 0.7);
    bar.rotation.set(rnd() * 0.6, 0, side * (1.0 + rnd() * 0.5));
    g.add(bar);
  }
  return g;
}

/** A heap of smaller rubble, for the broken edges of the floor. */
export function rubble(scale = 1, seed = 3): THREE.Group {
  const g = new THREE.Group();
  let s = seed * 7919 + 104729;
  const rnd = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < 7; i++) {
    const w = (0.12 + rnd() * 0.3) * scale;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, w * (0.5 + rnd() * 0.6), w * (0.7 + rnd() * 0.6)), rnd() < 0.6 ? M.concrete : M.concreteDark);
    m.position.set((rnd() - 0.5) * 0.7 * scale, w * 0.3, (rnd() - 0.5) * 0.7 * scale);
    m.rotation.set(rnd(), rnd() * 3, rnd());
    g.add(m);
  }
  return g;
}

// ----------------------------------------------------------------- breaker

/** Top of the breaker cabinet, where the feed comes in. */
export const BREAKER_TOP = 2.15;
/** The lever's travel: 0 hangs straight down (off), this is thrown (on). */
export const LEVER_ON = -0.78 * Math.PI;

/**
 * The main breaker. A tall cabinet on the wall with its label plate, a
 * lamp beside the switch, and the big lever itself — hung from a pivot so
 * the scene can throw it, with `grip` marking the middle of its handle for
 * a hand to take hold of. Back on z = 0. The lever starts down (off).
 *
 * The switch sits at chest height, where somebody standing at it would
 * actually take hold of it; the lamp is off to one side so the handle,
 * thrown, does not end up in front of it.
 */
export function mainBreaker(): {
  group: THREE.Group;
  lever: THREE.Group;
  grip: THREE.Object3D;
  lamp: THREE.MeshStandardMaterial;
} {
  const g = new THREE.Group();
  const W = 1.0;
  const H = BREAKER_TOP - 0.25;
  const D = 0.34;
  const PIVOT_Y = 1.3;
  const ARM = 0.36;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), M.paintGrey);
  cab.position.set(0, H / 2 + 0.25, D / 2);
  g.add(cab);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, 0.25, D + 0.06), M.darkSteel);
  plinth.position.set(0, 0.125, D / 2);
  g.add(plinth);
  // Door outline and hinges
  const door = new THREE.Mesh(new THREE.BoxGeometry(W - 0.08, H - 0.1, 0.012), M.steel);
  door.position.set(0, H / 2 + 0.25, D + 0.006);
  g.add(door);

  // The label: this is the thing you came down here for
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 150;
  const x = c.getContext('2d')!;
  x.fillStyle = '#b8231c';
  x.fillRect(0, 0, 320, 150);
  x.strokeStyle = '#f4efe2';
  x.lineWidth = 5;
  x.strokeRect(8, 8, 304, 134);
  x.fillStyle = '#f7f3e8';
  x.textAlign = 'center';
  // Sized to fit: at 46px the name ran off both ends of the plate
  x.font = 'bold 38px Arial, Helvetica, sans-serif';
  x.fillText('MAIN BREAKER', 160, 64);
  x.font = 'bold 24px Arial, Helvetica, sans-serif';
  x.fillText('BUILDING POWER — 480V', 160, 112);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.34), new THREE.MeshLambertMaterial({ map: tex }));
  label.position.set(0, 1.9, D + 0.014);
  g.add(label);

  // The switch's backing plate, the lever's travel marked on it
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.66, 0.02), M.darkSteel);
  back.position.set(0, PIVOT_Y, D + 0.018);
  g.add(back);

  // ON / OFF, beside the lever where the handle cannot cover them
  const oc = document.createElement('canvas');
  oc.width = 100;
  oc.height = 250;
  const o = oc.getContext('2d')!;
  o.fillStyle = '#2c3136';
  o.fillRect(0, 0, 100, 250);
  o.fillStyle = '#e6e2d4';
  o.textAlign = 'center';
  o.font = 'bold 32px Arial, Helvetica, sans-serif';
  o.fillText('ON', 50, 44);
  o.fillText('OFF', 50, 232);
  // An arrow up the middle: which way is on
  o.fillRect(46, 80, 8, 96);
  o.beginPath();
  o.moveTo(34, 86);
  o.lineTo(50, 62);
  o.lineTo(66, 86);
  o.closePath();
  o.fill();
  const otex = new THREE.CanvasTexture(oc);
  otex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.5), new THREE.MeshLambertMaterial({ map: otex }));
  plate.position.set(0.25, PIVOT_Y, D + 0.014);
  g.add(plate);

  // Lamp to the other side of the switch: red now, green when thrown
  const lamp = new THREE.MeshStandardMaterial({ color: 0x3a0806, emissive: 0xff2a18, emissiveIntensity: 2.2 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), lamp);
  bulb.position.set(-0.27, PIVOT_Y + 0.14, D + 0.05);
  g.add(bulb);
  const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 16), M.darkSteel);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.set(-0.27, PIVOT_Y + 0.14, D + 0.02);
  g.add(bezel);

  // The lever, on its pivot. Down is off.
  const lever = new THREE.Group();
  lever.position.set(0, PIVOT_Y, D + 0.06);
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 16), M.darkSteel);
  boss.rotation.x = Math.PI / 2;
  lever.add(boss);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, ARM, 0.05), M.steel);
  arm.position.set(0, -ARM / 2, 0.04);
  lever.add(arm);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 12), lampMats.red.clone());
  (handle.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2;
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, -ARM, 0.06);
  lever.add(handle);
  const grip = new THREE.Object3D();
  grip.position.copy(handle.position);
  lever.add(grip);
  g.add(lever);

  g.add(hazardSticker(0.2, 0.34, 0.62, D + 0.014));
  g.add(hazardSticker(0.2, -0.34, 0.62, D + 0.014));
  return { group: g, lever, grip, lamp };
}

/**
 * A length of broken service pipe, still bracketed to the wall, standing
 * just clear of the water — the only way across the far end of the flooded
 * hall. The pipe's top is at y = 0 so the caller can drop it straight onto
 * the walking height; the brackets and the torn ends hang below.
 *
 * @param len   how far it runs along X
 * @param r     pipe radius
 */
export function brokenPipeStep(len: number, r = 0.17, seed = 1): THREE.Group {
  const g = new THREE.Group();
  let s = seed * 9301 + 49297;
  const rnd = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const yc = -r; // so the crown of the pipe is the walking surface at y = 0

  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), M.pipeRust);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.y = yc;
  g.add(pipe);
  // A flat of grip worn along the crown — walking on a bare cylinder reads
  // as balancing on nothing
  const tread = new THREE.Mesh(new THREE.BoxGeometry(len - 0.04, 0.012, r * 1.1), M.darkSteel);
  tread.position.y = -0.004;
  g.add(tread);

  // Torn ends: a collar of jagged steel where the run snapped
  for (const end of [-1, 1]) {
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.14, r * 1.14, 0.05, 12), M.flange);
    collar.rotation.z = Math.PI / 2;
    collar.position.set((end * len) / 2, yc, 0);
    g.add(collar);
    for (let i = 0; i < 4; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.05 + rnd() * 0.07, 0.05, 0.05), M.darkSteel);
      const a = rnd() * Math.PI * 2;
      tooth.position.set((end * (len + 0.06)) / 2, yc + Math.sin(a) * r * 0.85, Math.cos(a) * r * 0.85);
      tooth.rotation.set(rnd(), rnd(), rnd());
      g.add(tooth);
    }
  }

  // Wall brackets, and the stubs of the smaller lines that ran with it
  for (const bx of [-len * 0.3, len * 0.3]) {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(r * 1.2, 0.022, 6, 12), M.steel);
    strap.rotation.y = Math.PI / 2;
    strap.position.set(bx, yc, 0);
    g.add(strap);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), M.darkSteel);
    arm.position.set(bx, yc, 0.3);
    g.add(arm);
  }
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len * 0.8, 8), M.pipeCopper);
  stub.rotation.z = Math.PI / 2;
  stub.position.set(rnd() * 0.1, yc - r - 0.09, 0.16);
  g.add(stub);
  // Something dripping off it
  const drip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 5), M.pipeGrey);
  drip.position.set((rnd() - 0.5) * len * 0.6, yc - r - 0.07, 0);
  g.add(drip);
  return g;
}

/** Hi-vis orange, and the yellow of a site helmet. */
const WORKER = {
  vest: lam(0xd8571a),
  band: lam(0xd9dde0),
  shirt: lam(0x9aa3ad),
  trouser: lam(0x2f3a4a),
  skin: lam(0x8a5c3b),
  helmet: lam(0xd9b023),
  boot: lam(0x1b1d20)
};

/**
 * One of the maintenance crew, face-down in the water.
 *
 * Built to be seen from above and from one side only: what breaks the
 * surface is the back of the vest, the shoulders and the backs of the legs,
 * with the head and the limbs hanging below where the water hides how
 * little of them there is. The group's origin is the waterline.
 */
export function floatingWorker(seed = 1): THREE.Group {
  const g = new THREE.Group();
  let s = seed * 9301 + 49297;
  const rnd = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };

  // Torso: the high point. It has to ride properly proud of the surface —
  // sunk to the waterline it read as a plank floating there, not a man.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.62), WORKER.vest);
  torso.position.set(0, 0.02, 0);
  torso.rotation.x = -0.06;
  g.add(torso);
  // Reflective bands across the back of the vest
  for (const bz of [-0.14, 0.12]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.06, 0.085), WORKER.band);
    band.position.set(0, 0.09, bz);
    g.add(band);
  }
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.1), WORKER.shirt);
  collar.position.set(0, 0.0, -0.33);
  g.add(collar);

  // Head, face-down: the back of the skull is what breaks the surface
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.23, 0.25), WORKER.skin);
  head.position.set(0, -0.05, -0.48);
  head.rotation.x = -0.3;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.08, 0.26), lam(0x1a1410));
  hair.position.set(0, 0.055, -0.475);
  hair.rotation.x = -0.3;
  g.add(hair);

  // Arms out to the sides, floating at the surface
  for (const side of [-1, 1]) {
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.13, 0.14), WORKER.shirt);
    upper.position.set(side * 0.38, -0.01, -0.16);
    upper.rotation.y = side * (0.15 + rnd() * 0.2);
    g.add(upper);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.11, 0.12), WORKER.skin);
    fore.position.set(side * 0.68, -0.04, -0.05 + rnd() * 0.16);
    fore.rotation.y = side * (0.3 + rnd() * 0.35);
    fore.rotation.z = side * 0.08;
    g.add(fore);
  }

  // Legs trailing under the surface, one knee bent
  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.18, 0.42), WORKER.trouser);
    thigh.position.set(side * 0.12, -0.04, 0.5);
    g.add(thigh);
    const bend = side * (rnd() * 0.3);
    const calf = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.14, 0.4), WORKER.trouser);
    calf.position.set(side * 0.12 + bend, -0.11, 0.88);
    calf.rotation.y = bend;
    g.add(calf);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.24), WORKER.boot);
    boot.position.set(side * 0.12 + bend * 1.8, -0.16, 1.16);
    g.add(boot);
  }
  return g;
}

/**
 * A site helmet on its own, floating brim-down like an upturned bowl —
 * whoever it belongs to is face-down somewhere nearby. Origin is the
 * waterline.
 */
export function floatingHelmet(seed = 1): THREE.Group {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), WORKER.helmet);
  dome.position.y = -0.02;
  g.add(dome);
  // The ridge along the crown
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.26), WORKER.helmet);
  ridge.position.y = 0.11;
  g.add(ridge);
  // Brim, sitting at the waterline
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.022, 14), WORKER.helmet);
  brim.position.y = -0.02;
  g.add(brim);
  const peak = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.02, 0.1), WORKER.helmet);
  peak.position.set(0, -0.02, -0.2);
  g.add(peak);
  g.rotation.y = seed * 1.7;
  return g;
}
