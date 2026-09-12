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
  rebar: metal(0x5a4a3e, 0.8, 0.5)
};

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
export function pipe(length: number, r = 0.08, kind: 'grey' | 'green' | 'rust' | 'copper' = 'grey'): THREE.Group {
  const g = new THREE.Group();
  const mat = { grey: M.pipeGrey, green: M.pipeGreen, rust: M.pipeRust, copper: M.pipeCopper }[kind];
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
 * A cable slung through `points`, sagging between them. Heavy rubber, so it
 * reads at a distance in torchlight.
 */
export function cable(points: THREE.Vector3[], r = 0.022): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), r, 6, false), M.rubber);
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

/**
 * Floor-standing control console: a body with a sloped face carrying rows of
 * lamps and push buttons, a dead monitor, and a pair of dials.
 */
export function controlConsole(): THREE.Group {
  const g = new THREE.Group();
  const W = 1.2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, 0.9, 0.62), M.paintGrey);
  body.position.set(0, 0.45, 0);
  g.add(body);
  // Sloped desk face
  const desk = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 0.5), M.darkSteel);
  desk.position.set(0, 0.98, 0.08);
  desk.rotation.x = -0.45;
  g.add(desk);
  // Upper instrument panel
  const upper = new THREE.Mesh(new THREE.BoxGeometry(W, 0.46, 0.14), M.paintGrey);
  upper.position.set(0, 1.28, -0.22);
  g.add(upper);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x0c1410, roughness: 0.2, metalness: 0.4 })
  );
  screen.position.set(-0.26, 1.29, -0.149);
  g.add(screen);
  for (const x of [0.2, 0.42]) {
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), M.steel);
    dial.rotation.x = Math.PI / 2;
    dial.position.set(x, 1.3, -0.14);
    g.add(dial);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), lam(0xe8e4d6));
    face.position.set(x, 1.3, -0.128);
    g.add(face);
  }
  // Rows of lamps and buttons on the desk
  const cols = [lampMats.red, lampMats.green, lampMats.amber];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 7; c++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.02, 0.045), r === 0 ? cols[(c * 2 + 1) % 3] : M.black);
      b.position.set(-0.45 + c * 0.15, 1.0 + r * 0.02, 0.18 - r * 0.12);
      b.rotation.x = -0.45;
      g.add(b);
    }
  }
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
  // Ragged lumps round the sides, all below the top so none sticks up to trip on
  for (let i = 0; i < 6; i++) {
    const cw = 0.2 + rnd() * 0.35;
    const cd = 0.2 + rnd() * 0.35;
    const ch = 0.25 + rnd() * 0.4;
    const lump = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cd), rnd() < 0.5 ? M.concrete : M.concreteDark);
    const side = i % 4;
    const along = (rnd() - 0.5) * 0.8;
    lump.position.set(
      side === 0 ? w / 2 : side === 1 ? -w / 2 : along * w,
      -0.12 - ch / 2 - rnd() * 0.25,
      side === 2 ? d / 2 : side === 3 ? -d / 2 : along * d
    );
    lump.rotation.set(rnd() * 0.5, rnd() * 1.2, rnd() * 0.5);
    g.add(lump);
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

/**
 * The main breaker. A tall cabinet on the wall with its label plate, a
 * red lamp over the switch, and the big lever itself — hung from a pivot
 * so the scene can throw it. Back on z = 0. The lever starts down (off).
 */
export function mainBreaker(): {
  group: THREE.Group;
  lever: THREE.Group;
  lamp: THREE.MeshStandardMaterial;
} {
  const g = new THREE.Group();
  const W = 1.0;
  const H = 1.9;
  const D = 0.34;
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
  label.position.set(0, 1.84, D + 0.014);
  g.add(label);

  // ON / OFF markings either side of the lever's travel
  const oc = document.createElement('canvas');
  oc.width = 128;
  oc.height = 256;
  const o = oc.getContext('2d')!;
  o.fillStyle = '#2c3136';
  o.fillRect(0, 0, 128, 256);
  o.fillStyle = '#e6e2d4';
  o.textAlign = 'center';
  o.font = 'bold 34px Arial, Helvetica, sans-serif';
  o.fillText('ON', 64, 44);
  o.fillText('OFF', 64, 236);
  const otex = new THREE.CanvasTexture(oc);
  otex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.52), new THREE.MeshLambertMaterial({ map: otex }));
  plate.position.set(0, 1.08, D + 0.014);
  g.add(plate);

  // Lamp over the switch: red now, green when thrown
  const lamp = new THREE.MeshStandardMaterial({ color: 0x3a0806, emissive: 0xff2a18, emissiveIntensity: 2.2 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), lamp);
  bulb.position.set(0, 1.5, D + 0.05);
  g.add(bulb);
  const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 16), M.darkSteel);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.set(0, 1.5, D + 0.02);
  g.add(bezel);

  // The lever, on its pivot. Down is off.
  const lever = new THREE.Group();
  lever.position.set(0, 1.08, D + 0.06);
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 16), M.darkSteel);
  boss.rotation.x = Math.PI / 2;
  lever.add(boss);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.05), M.steel);
  arm.position.set(0, -0.21, 0.04);
  lever.add(arm);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 12), lampMats.red.clone());
  (grip.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2;
  grip.rotation.z = Math.PI / 2;
  grip.position.set(0, -0.42, 0.06);
  lever.add(grip);
  g.add(lever);

  g.add(hazardSticker(0.2, 0.34, 0.62, D + 0.014));
  g.add(hazardSticker(0.2, -0.34, 0.62, D + 0.014));
  return { group: g, lever, lamp };
}
