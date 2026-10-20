import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CopRig, JetRig, PoliceRig, RadarUnit } from '../scenes/StreetContracts';
import {
  assemble,
  box,
  buildCar,
  C,
  carMaterials,
  clamp01,
  cylX,
  cylZ,
  facet,
  finish,
  halfBody,
  Kit,
  lerp,
  merge,
  type Model,
  rigLamps,
  roofTop,
  seatOf,
  V
} from './VehicleProps';

/**
 * StreetProps — the things Level 10 needs that no other level has: the
 * highway patrol cruiser and the cop asleep at its wheel (his doughnut, his
 * radar gun's counting unit on the dash), and the boss's private jet.
 *
 * The cruiser is built with VehicleProps' kit, so it is the same kind of car
 * as the Civic and the boss's saloon and keeps their frame (Level8Contracts:
 * origin on the ground at the middle of the footprint, FRONT toward −Z, the
 * driver on −X). The cop and the jet are built here.
 *
 * Nothing here is a light. Every lamp is an emissive material the scene
 * drives; the radar's digits and the decals are canvas textures.
 */

// =================================================================== the cruiser

/**
 * A full-size body-on-frame saloon of the kind every highway patrol drove for
 * thirty years: long bonnet, long boot, a big square cabin. Its numbers are
 * VehicleProps' Model (side view: u forward, y up), with skinRear set so the
 * rig gets an open cabin and seats.
 */
const COP_CAR: Model = {
  L: 5.25, W: 1.94, H: 1.47, R: 0.34, arch: 0.03, tyreW: 0.235, rimR: 0.215, track: 0.82,
  uF: 1.52, uR: -1.42, clear: 0.18, belt: 0.95, noseY: 0.78, noseLow: 0.22, tailY: 1.0, tailLow: 0.26,
  bumperH: 0.26, cowlU: 0.7, roofFU: 0.0, roofRU: -1.2, roofDrop: 0.03, rearU: -1.8, rearY: 1.0,
  tumble: 0.12, doors: [0.78, -0.3, -1.15], doorFront: 0.78, doorRear: -0.3, bPillar: -0.3,
  dloRear: [-1.05, -1.32], skinRear: -0.98, bumper: 'black', grille: 'slot', blackMirrors: true
};

/** The livery: white doors and roof, black bonnet, boot and wings (sRGB). */
const LIVERY_WHITE = 0xf1f1ec;
const LIVERY_BLACK = 0x0d0e10;

/** The greenhouse's half-width at the belt, and its tumblehome, as VehicleProps builds them. */
const hwG = (m: Model, y: number): number => (halfBody(m) - 0.1) * (1 - m.tumble * clamp01((y - m.belt) / (m.H - m.belt)));
/** The windscreen's u at height y (it runs from the cowl at the belt up to the roof's front). */
const screenU = (m: Model, y: number): number => m.cowlU + ((m.roofFU - m.cowlU) * (y - m.belt)) / (roofTop(m, m.roofFU) - m.belt);

const glsl = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/**
 * The body's paint, in two tones. The lower body is one extruded profile, so
 * the black-and-white split cannot be done by parts: the fragment shader
 * picks the colour from where on the car it is (car-local, from the body
 * mesh's own vertex positions). White along the doors between the front
 * door's leading shut line and the rear door's trailing one, below the belt
 * and down the sides only (not the bonnet's back edge between the wings);
 * white for the whole greenhouse above the boot deck; black everywhere else.
 */
function twoTonePaint(m: Model): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.36, metalness: 0.16 });
  const w = new THREE.Color(LIVERY_WHITE);
  const b = new THREE.Color(LIVERY_BLACK);
  const hw = halfBody(m);
  const doorRear = m.doors[m.doors.length - 1];
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vCarPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vCarPos = position;');
    sh.fragmentShader =
      'varying vec3 vCarPos;\n' +
      sh.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `
        float carU = -vCarPos.z;
        float carY = vCarPos.y + ${glsl(m.R)};
        bool doorBand = carU <= ${glsl(m.doorFront)} && carU >= ${glsl(doorRear)} && carY < ${glsl(m.belt + 0.06)}
          && (abs(vCarPos.x) > ${glsl(hw - 0.16)} || carU < ${glsl(m.cowlU - 0.02)});
        bool cabin = carY > ${glsl(m.rearY + 0.005)} && carU < ${glsl(m.cowlU + 0.05)} && carU > ${glsl(m.rearU - 0.05)};
        vec3 tone = (doorBand || cabin) ? vec3(${glsl(+w.r.toFixed(4))}, ${glsl(+w.g.toFixed(4))}, ${glsl(+w.b.toFixed(4))})
                                        : vec3(${glsl(+b.r.toFixed(4))}, ${glsl(+b.g.toFixed(4))}, ${glsl(+b.b.toFixed(4))});
        vec4 diffuseColor = vec4( diffuse * tone, opacity );`
      );
  };
  mat.customProgramCacheKey = (): string => 'street-police-two-tone';
  return mat;
}

/** The door and roof lettering: one canvas, two regions (the door's, the roof number's). */
function decalTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 512;
  const g = cv.getContext('2d');
  if (!g) throw new Error('StreetProps: no 2D canvas');
  g.clearRect(0, 0, 1024, 512);

  // ---- the door (0..1024 × 0..384): a gold seven-point star, POLICE, HIGHWAY PATROL
  const sx = 170;
  const sy = 190;
  const star = (r0: number, r1: number): void => {
    g.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 7;
      const r = i % 2 === 0 ? r0 : r1;
      const x = sx + Math.cos(a) * r;
      const y = sy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  };
  star(160, 92);
  g.fillStyle = '#1a1308';
  g.fill();
  star(146, 82);
  g.fillStyle = '#d6a632';
  g.fill();
  // Ball tips on the points
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 7;
    g.beginPath();
    g.arc(sx + Math.cos(a) * 150, sy + Math.sin(a) * 150, 15, 0, Math.PI * 2);
    g.fillStyle = '#1a1308';
    g.fill();
    g.beginPath();
    g.arc(sx + Math.cos(a) * 150, sy + Math.sin(a) * 150, 10, 0, Math.PI * 2);
    g.fillStyle = '#e8bc4a';
    g.fill();
  }
  g.beginPath();
  g.arc(sx, sy, 70, 0, Math.PI * 2);
  g.fillStyle = '#1d2a44';
  g.fill();
  g.beginPath();
  g.arc(sx, sy, 60, 0, Math.PI * 2);
  g.fillStyle = '#e8bc4a';
  g.fill();
  g.fillStyle = '#1d2a44';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 34px Arial, Helvetica, sans-serif';
  g.fillText('HWY', sx, sy - 14);
  g.font = 'bold 30px Arial, Helvetica, sans-serif';
  g.fillText('PTRL', sx, sy + 20);

  g.fillStyle = '#0c0c0e';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.font = '900 172px "Arial Black", Arial, Helvetica, sans-serif';
  const word = 'POLICE';
  const ww = g.measureText(word).width;
  const left = 350;
  const room = 1010 - left;
  g.save();
  g.translate(left, 230);
  g.scale(Math.min(1, room / ww), 1);
  g.fillText(word, 0, 0);
  g.restore();
  g.fillRect(left, 254, room, 8);
  g.font = 'bold 66px Arial, Helvetica, sans-serif';
  const sub = 'HIGHWAY PATROL';
  const sw = g.measureText(sub).width;
  g.save();
  g.translate(left, 330);
  g.scale(Math.min(1, room / sw), 1);
  g.fillText(sub, 0, 0);
  g.restore();

  // ---- the roof number (0..256 × 384..512), read from the air
  g.font = '900 120px "Arial Black", Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('27', 128, 450);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A plane w × h facing `facing` (±X or +Y), its UVs mapped onto an atlas region (u0, v0)–(u1, v1). */
function decalPlane(w: number, h: number, facing: 'left' | 'right' | 'up', uv: [number, number, number, number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, lerp(uv[0], uv[2], a.getX(i)), lerp(uv[1], uv[3], a.getY(i)));
  if (facing === 'left') g.rotateY(-Math.PI / 2);
  else if (facing === 'right') g.rotateY(Math.PI / 2);
  else g.rotateX(-Math.PI / 2);
  return g;
}

/** The push bar across the nose: two uprights with rubber pads, two cross tubes, brackets into the bumper. */
function pushBar(k: Kit, m: Model): void {
  const nose = m.L / 2;
  const u = nose + 0.12;
  const y0 = m.noseLow + 0.02;
  const y1 = m.noseY + 0.1;
  const col = 0x1e2022;
  for (const x of [-0.33, 0.33]) {
    k.trim(box(0.06, y1 - y0, 0.06, x, (y0 + y1) / 2, -u), col);
    k.trim(box(0.075, (y1 - y0) * 0.8, 0.03, x, (y0 + y1) / 2 + 0.02, -(u + 0.04)), 0x0b0b0c);
    for (const y of [0.36, 0.62]) k.trim(box(0.05, 0.05, 0.16, x, y, -(nose + 0.05)), col);
  }
  for (const y of [0.5, y1 - 0.06]) k.trim(cylX(0.026, 0.82, 8, 0, y, -u), col);
  // A pair of small red/blue grille lamps are on the light materials (see policeCruiser)
}

/** Light bar housing: a black base on two feet, a clear centre section; the red and blue lenses are their own meshes. */
const BAR = { u: -0.42, half: 0.64, depth: 0.27, h: 0.1 };

function barBase(m: Model): number {
  return roofTop(m, BAR.u) + 0.035;
}

function lightBarHousing(k: Kit, m: Model): void {
  const yb = barBase(m);
  const z = -BAR.u;
  k.trim(box(BAR.half * 2 + 0.02, 0.035, BAR.depth + 0.02, 0, yb - 0.0175, z), 0x141516);
  for (const x of [-0.56, 0.56]) k.trim(box(0.08, 0.06, 0.18, x, yb - 0.05, z), 0x141516);
  // The clear centre (takedown lamps) and the dividers
  k.trim(box(0.22, BAR.h, BAR.depth, 0, yb + BAR.h / 2, z), 0xd8dcd6);
  k.trim(box(0.24, 0.012, BAR.depth + 0.01, 0, yb + BAR.h + 0.004, z), 0x141516);
  for (const x of [-0.11, 0.11]) k.trim(box(0.012, BAR.h + 0.01, BAR.depth + 0.012, x, yb + BAR.h / 2, z), 0x141516);
  // Siren speaker in the middle of the base, facing forward
  k.trim(box(0.2, 0.03, 0.06, 0, yb - 0.005, z - BAR.depth / 2 - 0.02), 0x2a2c2e);
}

/** The red (driver's side) and blue lenses of the bar, plus the grille's pair, as two geometries. */
function lightLenses(m: Model): { red: THREE.BufferGeometry; blue: THREE.BufferGeometry } {
  const yb = barBase(m);
  const z = -BAR.u;
  const make = (s: number): THREE.BufferGeometry => {
    const parts: THREE.BufferGeometry[] = [];
    const x0 = 0.11;
    const x1 = BAR.half - BAR.depth / 2;
    parts.push(box(x1 - x0, BAR.h, BAR.depth, s * (x0 + x1) / 2, yb + BAR.h / 2, z));
    // Rounded ends: a half-drum
    const cap = new THREE.CylinderGeometry(BAR.depth / 2, BAR.depth / 2, BAR.h, 12, 1, false, s > 0 ? 0 : Math.PI, Math.PI);
    cap.translate(s * x1, yb + BAR.h / 2, z);
    parts.push(cap.toNonIndexed());
    // Grille lamps behind the push bar
    parts.push(box(0.14, 0.05, 0.03, s * 0.22, m.noseY - 0.08, -(m.L / 2 - 0.05)));
    const flat = parts.map((p) => {
      const q = p.index ? p.toNonIndexed() : p;
      if (q !== p) p.dispose();
      for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') q.deleteAttribute(k);
      return q;
    });
    return merge(flat, 'light bar lenses');
  };
  // Shift the lenses from car-local to the body frame later (with everything else on the body)
  return { red: make(-1), blue: make(1) };
}

/** The A-pillar spotlight on the driver's side: chrome can, clear lens, a bracket, the handle through the pillar. */
function spotlight(k: Kit, m: Model): void {
  const y = m.belt + 0.2;
  const u = screenU(m, y) - 0.06;
  const x = -(hwG(m, y) + 0.1);
  k.trim(cylZ(0.075, 0.17, 12, x, y, -u, 0.065), C.chrome);
  const lens = new THREE.CircleGeometry(0.066, 12);
  lens.rotateY(Math.PI);
  lens.translate(x, y, -(u + 0.086));
  k.trim(lens, 0xeceee0);
  k.trim(box(0.06, 0.05, 0.05, x + 0.05, y - 0.02, -u + 0.03), C.chrome);
  k.trim(cylX(0.012, 0.24, 6, x + 0.13, y - 0.02, -u + 0.05), C.chrome);
}

/** The radar's own antenna head on the passenger side of the dash, and two whips on the boot. */
function aerials(k: Kit, m: Model): void {
  const dashTop = m.belt + 0.03;
  k.trim(cylZ(0.05, 0.16, 10, 0.62, dashTop + 0.07, -(screenU(m, dashTop + 0.07) - 0.12)), 0x1a1b1c);
  k.trim(box(0.05, 0.05, 0.06, 0.62, dashTop + 0.025, -(screenU(m, dashTop) - 0.16)), 0x1a1b1c);
  for (const x of [-0.42, 0.42]) {
    const g = new THREE.CylinderGeometry(0.003, 0.005, 0.75, 4);
    g.translate(x, m.tailY + 0.375, 2.15);
    k.trim(g, 0x111111);
    k.trim(cylX(0.018, 0.03, 6, x, m.tailY + 0.01, 2.15), 0x111111);
  }
}

// ------------------------------------------------------------------ the radar

/** Seven-segment bits, gfedcba. */
const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/**
 * The radar's counting unit: a small black box on the dash, its face toward
 * the driver, three red seven-segment digits in a window labelled TARGET and
 * a FAST lamp. The face is a canvas texture, redrawn only when the number or
 * the blink phase changes.
 */
function radarUnit(m: Model): RadarUnit {
  const W = 320;
  const H = 120;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  if (!g) throw new Error('StreetProps: no 2D canvas');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const seg = (x0: number, y0: number, w: number, h: number, t: number, bits: number, on: string, off: string): void => {
    const gap = 2;
    const hseg = (xa: number, xb: number, yc: number): void => {
      g.beginPath();
      g.moveTo(xa + gap, yc);
      g.lineTo(xa + gap + t / 2, yc - t / 2);
      g.lineTo(xb - gap - t / 2, yc - t / 2);
      g.lineTo(xb - gap, yc);
      g.lineTo(xb - gap - t / 2, yc + t / 2);
      g.lineTo(xa + gap + t / 2, yc + t / 2);
      g.closePath();
    };
    const vseg = (xc: number, ya: number, yb: number): void => {
      g.beginPath();
      g.moveTo(xc, ya + gap);
      g.lineTo(xc + t / 2, ya + gap + t / 2);
      g.lineTo(xc + t / 2, yb - gap - t / 2);
      g.lineTo(xc, yb - gap);
      g.lineTo(xc - t / 2, yb - gap - t / 2);
      g.lineTo(xc - t / 2, ya + gap + t / 2);
      g.closePath();
    };
    const ym = y0 + h / 2;
    const draws: [number, () => void][] = [
      [0, () => hseg(x0, x0 + w, y0)],
      [1, () => vseg(x0 + w, y0, ym)],
      [2, () => vseg(x0 + w, ym, y0 + h)],
      [3, () => hseg(x0, x0 + w, y0 + h)],
      [4, () => vseg(x0, ym, y0 + h)],
      [5, () => vseg(x0, y0, ym)],
      [6, () => hseg(x0, x0 + w, ym)]
    ];
    for (const [bit, path] of draws) {
      path();
      const lit = (bits >> bit) & 1;
      g.fillStyle = lit ? on : off;
      g.shadowBlur = lit ? 10 : 0;
      g.shadowColor = '#ff2010';
      g.fill();
    }
    g.shadowBlur = 0;
  };

  const draw = (mph: number | null, alarm: boolean, flash: boolean): void => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1b1c1e';
    g.fillRect(0, 0, W, H);
    // The display window
    g.fillStyle = alarm && flash ? '#4a0604' : '#090404';
    g.fillRect(84, 10, 226, 100);
    if (alarm && flash) {
      g.strokeStyle = '#ff2a1a';
      g.lineWidth = 6;
      g.strokeRect(87, 13, 220, 94);
    }
    g.fillStyle = '#9a9c9e';
    g.font = 'bold 15px Arial, Helvetica, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText('TARGET', 10, 14);
    g.font = 'bold 12px Arial, Helvetica, sans-serif';
    g.fillText('MPH', 10, 34);
    // The FAST lamp
    g.fillStyle = alarm ? (flash ? '#ff3a22' : '#a3170c') : '#2a0907';
    g.fillRect(10, 58, 64, 22);
    g.fillStyle = alarm ? '#200402' : '#4a1410';
    g.font = 'bold 15px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.fillText('FAST', 42, 62);
    // Two small round buttons
    for (const x of [24, 58]) {
      g.beginPath();
      g.arc(x, 98, 8, 0, Math.PI * 2);
      g.fillStyle = '#3a3c3f';
      g.fill();
    }
    // The digits, slanted a touch like a real counting unit's
    g.setTransform(1, 0, -0.08, 1, 8, 0);
    const n = mph === null ? null : Math.max(0, Math.min(999, Math.round(mph)));
    const text = n === null ? '' : String(n);
    const on = alarm && flash ? '#ffd0c0' : '#ff3420';
    for (let i = 0; i < 3; i++) {
      const ch = text.length - 3 + i >= 0 ? text[text.length - 3 + i] : '';
      const bits = ch ? SEG[+ch] : 0;
      seg(112 + i * 66, 22, 46, 76, 11, bits, on, '#2c0907');
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    tex.needsUpdate = true;
  };

  let key = '';
  const show = (mph: number | null, alarm: boolean): void => {
    const flash = alarm && Math.floor(performance.now() / 160) % 2 === 0;
    const k = `${mph === null ? '-' : Math.round(mph)}|${alarm ? (flash ? 'A' : 'a') : ''}`;
    if (k === key) return;
    key = k;
    draw(mph, alarm, flash);
  };
  draw(null, false, false);
  key = '-|';

  // The box: on a bracket on the dash, just right of centre, turned and tipped up toward the driver
  const dashTop = m.belt + 0.03;
  const object = new THREE.Group();
  object.name = 'radar';
  const bw = 0.23;
  const bh = 0.088;
  const bd = 0.12;
  const hk = new Kit();
  hk.trim(box(bw, bh, bd, 0, 0, 0), 0x16171a);
  hk.trim(box(bw - 0.012, 0.01, bd + 0.004, 0, bh / 2 - 0.004, 0), 0x2a2c30);
  hk.trim(box(0.14, 0.03, 0.09, 0, -bh / 2 - 0.01, 0.0), 0x16171a);
  const housing = new THREE.Mesh(merge(hk.parts.map((p) => p.g), 'radar housing'), carMaterials().trim);
  housing.userData.surface = 'metal';
  object.add(housing);
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(bw - 0.01, bh - 0.01), faceMat);
  face.position.set(0, 0, bd / 2 + 0.001);
  face.userData.surface = 'glass';
  object.add(face);
  const y = dashTop + bh / 2 + 0.018;
  const u = Math.min(m.cowlU - 0.3 + 0.05, screenU(m, y + bh / 2) - bd / 2 - 0.02);
  object.position.set(0.42, y, -u);
  object.rotation.set(-0.22, -0.42, 0, 'YXZ');
  return { object, show };
}

/**
 * The highway patrol cruiser: a black-and-white full-size saloon on steel
 * wheels, a push bar across the nose, a red-and-blue light bar on the roof,
 * POLICE / HIGHWAY PATROL and a gold star on the front doors, unit 27 on the
 * roof, a spotlight on the driver's A-pillar, the radar's counting unit on
 * the dash and see-through glass so the cop shows at the wheel.
 *
 * Frame and fields as every CarRig (Level8Contracts). The lamp bar's red
 * (driver's side) and blue lenses, and the pair of grille lamps, are
 * `lightRed` / `lightBlue`: emissiveIntensity 0 is off; ~3–4 reads as lit.
 */
export function policeCruiser(): PoliceRig {
  const m = COP_CAR;
  const parts = buildCar(m, { rig: true, wheels: { fl: 'steel', fr: 'steel', rl: 'steel', rr: 'steel' } });
  // The driver's door is white all over (its own material: the two-tone shader is in the body's frame)
  for (const p of parts) if (p.node === 'door' && p.layer === 'paint') p.layer = 'primer';
  const k = new Kit();
  pushBar(k, m);
  lightBarHousing(k, m);
  spotlight(k, m);
  aerials(k, m);
  parts.push(...k.parts);

  const rig = assemble(
    m,
    parts,
    {
      paint: twoTonePaint(m),
      primer: new THREE.MeshStandardMaterial({ color: LIVERY_WHITE, roughness: 0.36, metalness: 0.16 }),
      glass: new THREE.MeshStandardMaterial({
        color: 0x2a3540,
        roughness: 0.15,
        metalness: 0.1,
        transparent: true,
        opacity: 0.36,
        depthWrite: false
      }),
      ...rigLamps()
    },
    V(0.5, m.tailLow - 0.03, m.L / 2)
  );
  const { hubcap: _none, ...car } = rig;
  const body = car.body;
  const toBody = new THREE.Matrix4().makeTranslation(0, -m.R, 0);

  // ---- the light bar's lenses
  // Not tone-mapped: lit, they stay pure red and blue rather than going orange and white under ACES
  const lightRed = new THREE.MeshStandardMaterial({ color: 0x6a0a08, roughness: 0.22, metalness: 0.05, emissive: 0xff1208, emissiveIntensity: 0, toneMapped: false });
  const lightBlue = new THREE.MeshStandardMaterial({ color: 0x0a1a6a, roughness: 0.22, metalness: 0.05, emissive: 0x1a40ff, emissiveIntensity: 0, toneMapped: false });
  const lenses = lightLenses(m);
  for (const [g, mat, name] of [[lenses.red, lightRed, 'lightRed'], [lenses.blue, lightBlue, 'lightBlue']] as const) {
    g.applyMatrix4(toBody);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.userData.surface = 'glass';
    body.add(mesh);
    car.meshes.push(mesh);
  }

  // ---- lettering: the right door and the roof on the body, the left door on the door
  const decalMat = new THREE.MeshStandardMaterial({
    map: decalTexture(),
    roughness: 0.4,
    metalness: 0.1,
    alphaTest: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  const hw = halfBody(m);
  const dw = 1.0;
  const dh = 0.375;
  const du = (m.doorFront + m.doorRear) / 2 + 0.02;
  const dy = 0.6;
  const doorUV: [number, number, number, number] = [0, 0.25, 1, 1];
  const right = decalPlane(dw, dh, 'right', doorUV);
  right.translate(hw + 0.011, dy, -du);
  const roofU = -0.86;
  const roof = decalPlane(0.56, 0.28, 'up', [0, 0, 0.25, 0.25]);
  roof.translate(0, roofTop(m, roofU) + 0.004, -roofU);
  const onBody = mergeGeometries([right, roof], false);
  if (!onBody) throw new Error('StreetProps: could not merge the decals');
  onBody.applyMatrix4(toBody);
  const decals = new THREE.Mesh(onBody, decalMat);
  decals.userData.surface = 'metal';
  body.add(decals);
  car.meshes.push(decals);
  const door = body.children.find((c): c is THREE.Group => (c as THREE.Group).isGroup === true);
  if (!door) throw new Error('StreetProps: the cruiser has no door');
  const left = decalPlane(dw, dh, 'left', doorUV);
  // Car-local → the door's frame (its hinge)
  left.translate(-(hw + 0.011) - door.position.x, dy - m.R - door.position.y, -du - door.position.z);
  const leftMesh = new THREE.Mesh(left, decalMat);
  leftMesh.userData.surface = 'metal';
  door.add(leftMesh);
  car.meshes.push(leftMesh);

  // ---- the radar
  const radar = radarUnit(m);
  radar.object.position.y -= m.R;
  body.add(radar.object);
  radar.object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) car.meshes.push(o as THREE.Mesh);
  });

  return { ...car, lightRed, lightBlue, radar };
}

// ======================================================================= the cop

/** The cop's bones, one per rigid piece. */
enum B {
  pelvis, torso, head, jaw,
  armL, foreL, handL, armR, foreR, handR,
  thighL, shinL, footL, thighR, shinR, footR,
  count
}

/** His proportions: a big man gone soft, about 1.8 m stood up. */
const MAN = {
  hipW: 0.105, // hip joint |x| from the pelvis centre
  lumbar: 0.1, // pelvis centre to the torso's joint
  shoulderY: 0.4,
  shoulderX: 0.215,
  neckY: 0.47,
  upper: 0.29,
  fore: 0.27,
  thigh: 0.45,
  shin: 0.44
};

const SKIN = 0xd2967a;
const SHIRT = 0xc6a368;
const SHIRT_DK = 0xae8b55;
const TROUSER = 0x564631;
const STRIPE = 0x18181b;
const BOOT = 0x111113;
const FELT = 0x8a6a3e;
const GOLD = 0xd8aa3a;

/** Collects the cop's pieces, each rigidly bound to one bone. */
class Rigger {
  readonly parts: THREE.BufferGeometry[] = [];
  add(bone: B, g: THREE.BufferGeometry, col: number): void {
    const f = finish(g, col);
    const n = f.attributes.position.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = bone;
      sw[i * 4] = 1;
    }
    f.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    f.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this.parts.push(f);
  }
}

function sph(r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ws = 10, hs = 8): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

function capsule(r: number, len: number, y: number, x = 0, z = 0, sx = 1, sz = 1): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(r, len, 3, 9);
  g.scale(sx, 1, sz);
  g.translate(x, y, z);
  return g;
}

function rot(g: THREE.BufferGeometry, rx: number, ry: number, rz: number): THREE.BufferGeometry {
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  return g;
}

/** The whole man, each piece in its bone's frame (limbs hang along −Y from their joint, +Z their front). */
function copGeometry(): THREE.BufferGeometry {
  const r = new Rigger();
  // ---- pelvis: the seat of his trousers, the duty belt, holster and cuffs
  r.add(B.pelvis, sph(0.2, 0, -0.01, 0.015, 1.0, 0.6, 0.86), TROUSER);
  r.add(B.pelvis, rot(new THREE.CylinderGeometry(0.205, 0.2, 0.065, 14), 0, 0, 0).scale(1, 1, 0.82).translate(0, 0.075, 0), 0x17130f);
  r.add(B.pelvis, box(0.07, 0.05, 0.02, 0, 0.075, -0.168), GOLD);
  r.add(B.pelvis, box(0.06, 0.17, 0.11, 0.215, -0.01, 0.03), 0x17130f);
  r.add(B.pelvis, box(0.04, 0.07, 0.05, 0.215, 0.1, 0.05, 0.2), 0x2a2a2c);
  r.add(B.pelvis, box(0.05, 0.06, 0.07, -0.2, 0.07, 0.08), 0x17130f);
  r.add(B.pelvis, box(0.09, 0.06, 0.05, 0.12, 0.07, 0.145), 0x17130f);

  // ---- torso: the gut, the chest, the shirt's pockets, badge, tie, epaulettes, the radio
  r.add(B.torso, sph(0.215, 0, 0.12, -0.055, 1.0, 0.95, 1.02, 12, 10), SHIRT);
  r.add(B.torso, sph(0.215, 0, 0.31, 0.0, 1.06, 0.82, 0.74, 12, 8), SHIRT);
  for (const s of [-1, 1]) r.add(B.torso, sph(0.085, s * 0.2, 0.39, 0.0, 1, 1, 1, 8, 6), SHIRT);
  r.add(B.torso, new THREE.CylinderGeometry(0.075, 0.09, 0.08, 10).translate(0, 0.45, 0.005), SHIRT);
  r.add(B.torso, new THREE.CylinderGeometry(0.06, 0.065, 0.1, 9).translate(0, 0.49, 0.012), SKIN);
  // Tie: knot at the collar, down the chest and out over the gut
  r.add(B.torso, box(0.04, 0.035, 0.03, 0, 0.44, -0.07), 0x3a2817);
  r.add(B.torso, box(0.05, 0.17, 0.014, 0, 0.35, -0.155, 0.12), 0x3a2817);
  r.add(B.torso, box(0.055, 0.12, 0.014, 0, 0.215, -0.215, 0.62), 0x3a2817);
  for (const s of [-1, 1]) {
    // Pocket flaps
    r.add(B.torso, box(0.095, 0.035, 0.012, s * 0.1, 0.355, -0.15, 0.1), SHIRT_DK);
    r.add(B.torso, box(0.09, 0.08, 0.008, s * 0.1, 0.31, -0.148, 0.12), SHIRT_DK);
    // Epaulettes
    r.add(B.torso, box(0.07, 0.014, 0.1, s * 0.17, 0.455, 0.0, 0, 0, s * -0.25), SHIRT_DK);
  }
  // The badge: a gold star over the left pocket, a name bar over the right
  r.add(B.torso, rot(new THREE.CylinderGeometry(0.034, 0.034, 0.01, 7), Math.PI / 2, 0, 0).translate(-0.1, 0.405, -0.143), GOLD);
  r.add(B.torso, box(0.07, 0.016, 0.008, 0.1, 0.4, -0.142), GOLD);
  // Radio mic clipped on the left shoulder
  r.add(B.torso, box(0.05, 0.065, 0.03, -0.13, 0.43, -0.09, 0.2), 0x1a1a1c);

  // ---- head: a big face, jowls, a nose, a moustache, aviators, the campaign hat
  r.add(B.head, sph(0.118, 0, 0.13, -0.005, 0.96, 1.08, 1.0, 12, 10), SKIN);
  for (const s of [-1, 1]) {
    r.add(B.head, sph(0.056, s * 0.058, 0.06, -0.04, 1, 1, 1, 8, 6), SKIN);
    r.add(B.head, box(0.025, 0.055, 0.035, s * 0.115, 0.125, 0.0), 0xc4866a);
  }
  r.add(B.head, box(0.036, 0.05, 0.05, 0, 0.115, -0.122, -0.15), 0xc97e66);
  // Moustache: a thick brush, the ends turned down
  r.add(B.head, box(0.085, 0.028, 0.03, 0, 0.078, -0.121), 0x5a3b24);
  for (const s of [-1, 1]) r.add(B.head, box(0.026, 0.045, 0.026, s * 0.046, 0.062, -0.112, 0, 0, s * 0.25), 0x5a3b24);
  // The mouth's inside, shown when the jaw drops
  r.add(B.head, box(0.07, 0.06, 0.04, 0, 0.04, -0.09), 0x3a0f0e);
  // Aviators: two dark lenses on a gold wire frame
  for (const s of [-1, 1]) {
    r.add(B.head, box(0.052, 0.036, 0.012, s * 0.037, 0.152, -0.131, 0, s * 0.2, s * 0.08), 0x0c0f14);
    r.add(B.head, box(0.054, 0.006, 0.014, s * 0.037, 0.171, -0.131, 0, s * 0.2, 0), GOLD);
    r.add(B.head, box(0.006, 0.006, 0.12, s * 0.106, 0.16, -0.07), GOLD);
  }
  r.add(B.head, box(0.026, 0.006, 0.008, 0, 0.165, -0.135), GOLD);
  // Hair showing under the hat at the back and sides
  r.add(B.head, sph(0.112, 0, 0.17, 0.02, 1.0, 0.75, 1.0, 10, 6), 0x4a3524);
  // Campaign hat: a flat brim and the four-dent Montana-peak crown
  r.add(B.head, new THREE.CylinderGeometry(0.205, 0.205, 0.012, 22).translate(0, 0.215, 0.0), FELT);
  r.add(B.head, rot(new THREE.CylinderGeometry(0.035, 0.155, 0.13, 4), 0, Math.PI / 4, 0).translate(0, 0.285, 0.0), FELT);
  r.add(B.head, rot(new THREE.CylinderGeometry(0.152, 0.158, 0.026, 4), 0, Math.PI / 4, 0).translate(0, 0.235, 0.0), 0x3b2a1a);

  // ---- jaw: chin and a double chin; its origin is the hinge, in the head's frame at (0, 0.085, −0.02)
  r.add(B.jaw, sph(0.072, 0, -0.03, -0.055, 1.12, 0.7, 0.95, 10, 6), SKIN);
  r.add(B.jaw, box(0.05, 0.012, 0.02, 0, -0.008, -0.105), 0xb86a5a);

  // ---- arms: short sleeves, thick forearms, mitten hands with a thumb
  for (const [ua, fa, ha, s] of [[B.armL, B.foreL, B.handL, -1], [B.armR, B.foreR, B.handR, 1]] as const) {
    r.add(ua, capsule(0.068, 0.17, -0.12), SHIRT);
    r.add(ua, new THREE.CylinderGeometry(0.074, 0.074, 0.03, 10).translate(0, -0.215, 0), SHIRT_DK);
    r.add(fa, capsule(0.056, 0.17, -0.13), SKIN);
    if (s < 0) r.add(fa, new THREE.CylinderGeometry(0.052, 0.052, 0.025, 10).translate(0, -0.245, 0), 0x2a2a2c);
    r.add(ha, box(0.085, 0.1, 0.045, 0, -0.055, 0), SKIN);
    r.add(ha, box(0.026, 0.06, 0.03, s * 0.042, -0.035, -0.025, 0.3, 0, s * 0.35), SKIN);
  }

  // ---- legs: brown trousers with a black stripe down the outside, black boots
  for (const [th, sh, ft, s] of [[B.thighL, B.shinL, B.footL, -1], [B.thighR, B.shinR, B.footR, 1]] as const) {
    // A limb's local +X is the car's −X for a leg pointing forward (see orient), so the outside is +X on the left leg
    const out = -s;
    r.add(th, capsule(0.092, 0.3, -0.22, 0, 0, 1.0, 1.06), TROUSER);
    r.add(th, box(0.012, 0.36, 0.035, out * 0.09, -0.22, 0), STRIPE);
    r.add(sh, capsule(0.068, 0.3, -0.21), TROUSER);
    r.add(sh, box(0.012, 0.3, 0.03, out * 0.066, -0.2, 0), STRIPE);
    r.add(ft, new THREE.CylinderGeometry(0.068, 0.072, 0.15, 10).translate(0, 0.0, 0), BOOT);
    r.add(ft, box(0.11, 0.085, 0.25, 0, -0.05, -0.065), BOOT);
    r.add(ft, sph(0.058, 0, -0.045, -0.18, 1, 0.75, 1.1, 8, 6), BOOT);
    // Worn tan soles and heels: what you see of his boots through the windscreen
    r.add(ft, box(0.118, 0.022, 0.29, 0, -0.098, -0.075), 0x8a7356);
    r.add(ft, box(0.112, 0.034, 0.075, 0, -0.112, 0.035), 0x6e5a42);
    for (let i = 0; i < 4; i++) r.add(ft, box(0.1, 0.004, 0.012, 0, -0.11, -0.19 + i * 0.045), 0x4a3c2c);
  }
  return merge(r.parts, 'cop');
}

/** The doughnut: a ring of fried dough, pink frosting on top, sprinkles. Ring flat in XZ, frosting up (+Y). */
function doughnutMesh(): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const R = 0.047;
  const r = 0.023;
  parts.push(finish(new THREE.TorusGeometry(R, r, 8, 20), 0xd09650));
  const icing = new THREE.TorusGeometry(R, r * 1.03, 8, 20);
  icing.scale(1.0, 1.0, 0.72);
  icing.translate(0, 0, 0.0085);
  parts.push(finish(icing, 0xf08ab6));
  const cols = [0xffffff, 0xffe14a, 0x4ac8ff, 0x7aea5a, 0xff5a4a, 0xa070ff];
  let s = 11;
  const rnd = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < 28; i++) {
    const a = rnd() * Math.PI * 2;
    const rho = R + (rnd() - 0.5) * 1.5 * r;
    const top = 0.0085 + 0.72 * Math.sqrt(Math.max(0, (r * 1.03) ** 2 - (rho - R) ** 2));
    const g = box(0.011, 0.0032, 0.0032, Math.cos(a) * rho, Math.sin(a) * rho, top + 0.0008, 0, 0, rnd() * Math.PI);
    parts.push(finish(g, cols[i % cols.length]));
  }
  const g = merge(parts, 'doughnut');
  g.rotateX(-Math.PI / 2);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }));
  mesh.name = 'doughnut';
  return mesh;
}

type V3 = THREE.Vector3;
type CopPoseName = 'feetUp' | 'bite' | 'startled' | 'driving';

/** A pose: where his joints go (car-local) and how his trunk and head are turned. */
interface Pose {
  /** Pelvis centre, and its turn (yaw, + to his left) and tilt (pitch, + leaning back). */
  hip: V3;
  pelYaw: number;
  pelPitch: number;
  /** The torso on the pelvis, and the head on the torso. */
  spPitch: number;
  spYaw: number;
  hdPitch: number;
  hdYaw: number;
  hdRoll: number;
  /** 0 shut .. 1 wide open. */
  jaw: number;
  /** Ankles and wrists (car-local), and which way knees and elbows point. */
  ankL: V3;
  ankR: V3;
  kneeL: V3;
  kneeR: V3;
  wristL: V3;
  wristR: V3;
  elbowL: V3;
  elbowR: V3;
  /** Boot pitch (toe elevation from forward-horizontal, radians) and yaw (+ toe to his left). */
  footPL: number;
  footPR: number;
  footYL: number;
  footYR: number;
  /** Hand roll about the forearm. */
  rollL: number;
  rollR: number;
}

const POSE_V = ['hip', 'ankL', 'ankR', 'kneeL', 'kneeR', 'wristL', 'wristR', 'elbowL', 'elbowR'] as const;
const POSE_N = ['pelYaw', 'pelPitch', 'spPitch', 'spYaw', 'hdPitch', 'hdYaw', 'hdRoll', 'jaw', 'footPL', 'footPR', 'footYL', 'footYR', 'rollL', 'rollR'] as const;

function clonePose(p: Pose): Pose {
  const q = { ...p };
  for (const k of POSE_V) q[k] = p[k].clone();
  return q;
}

function lerpPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  for (const k of POSE_V) out[k].lerpVectors(a[k], b[k], t);
  for (const k of POSE_N) out[k] = lerp(a[k], b[k], t);
  return out;
}

/** The trunk's frames for a pose: pelvis, torso, head, jaw (car-local matrices). */
interface Trunk {
  pelvis: THREE.Matrix4;
  torso: THREE.Matrix4;
  head: THREE.Matrix4;
  jaw: THREE.Matrix4;
}

function trunkOf(p: Pose, out?: Trunk): Trunk {
  const t = out ?? { pelvis: new THREE.Matrix4(), torso: new THREE.Matrix4(), head: new THREE.Matrix4(), jaw: new THREE.Matrix4() };
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const local = new THREE.Matrix4();
  t.pelvis.compose(p.hip, q.setFromEuler(e.set(p.pelPitch, p.pelYaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
  local.compose(V(0, MAN.lumbar, 0), q.setFromEuler(e.set(p.spPitch, p.spYaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
  t.torso.multiplyMatrices(t.pelvis, local);
  local.compose(V(0, MAN.neckY, 0.012), q.setFromEuler(e.set(p.hdPitch, p.hdYaw, p.hdRoll, 'YXZ')), new THREE.Vector3(1, 1, 1));
  t.head.multiplyMatrices(t.torso, local);
  local.compose(V(0, 0.085, -0.02), q.setFromEuler(e.set(-0.55 * p.jaw, 0, 0)), new THREE.Vector3(1, 1, 1));
  t.jaw.multiplyMatrices(t.head, local);
  return t;
}

const at = (m: THREE.Matrix4, x: number, y: number, z: number): V3 => V(x, y, z).applyMatrix4(m);

/** Two-bone IK: from `a` toward `t`, lengths l1 then l2, bending toward `pole`. Writes the middle joint and the reached end. */
function twoBone(a: V3, t: V3, l1: number, l2: number, pole: V3, mid: V3, end: V3, bend: V3): void {
  const d = t.clone().sub(a);
  const len = d.length() || 1e-6;
  const u = d.divideScalar(len);
  const dist = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, len));
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const w = pole.clone().addScaledVector(u, -pole.dot(u));
  if (w.lengthSq() < 1e-8) w.set(0, 1, 0).addScaledVector(u, -u.y);
  w.normalize();
  bend.copy(w);
  mid.copy(a).addScaledVector(u, l1 * cosA).addScaledVector(w, l1 * sinA);
  end.copy(a).addScaledVector(u, dist);
}

/** A limb segment's rotation: its −Y along `dir`, its +Z toward `front` (made square to it). */
function orient(dir: V3, front: V3, out: THREE.Quaternion): THREE.Quaternion {
  const y = dir.clone().normalize().negate();
  const z = front.clone().addScaledVector(y, -front.dot(y));
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * The poses, worked out from the seat. Car-local: hip, wheel and the dash
 * come from the cruiser's model, so he sits in it wherever its numbers put
 * the seat.
 */
function copPoses(m: Model): Record<CopPoseName, Pose> {
  const seat = seatOf(m);
  const dashTop = m.belt + 0.03;
  const dashRearU = m.cowlU - 0.3;
  const hx = seat.hip.x;
  const hz = seat.hip.z;
  const f = seat.wheelFacing;
  // The wheel's own "up", in its plane
  const wUp = V(0, f.z, -f.y).normalize();
  const rim = 0.185;
  const grip = (s: number, clock: number): V3 =>
    seat.wheel.clone().addScaledVector(V(1, 0, 0), s * rim * Math.sin(clock)).addScaledVector(wUp, rim * Math.cos(clock)).addScaledVector(f, 0.03);

  const base: Pose = {
    hip: V(hx, 0.49, hz - 0.02),
    pelYaw: 0,
    pelPitch: 0.08,
    spPitch: 0.12,
    spYaw: 0,
    hdPitch: -0.1,
    hdYaw: 0,
    hdRoll: 0,
    jaw: 0,
    ankL: V(hx - 0.12, 0.47, hz - 0.62),
    ankR: V(hx + 0.12, 0.47, hz - 0.62),
    kneeL: V(-0.3, 1, -0.6),
    kneeR: V(0.3, 1, -0.6),
    wristL: V(hx - 0.2, 0.62, hz - 0.3),
    wristR: V(hx + 0.2, 0.62, hz - 0.3),
    elbowL: V(-0.5, -1, 0.4),
    elbowR: V(0.5, -1, 0.4),
    footPL: 0.15,
    footPR: 0.15,
    footYL: 0.12,
    footYR: -0.12,
    rollL: 0,
    rollR: 0
  };

  // ---- feetUp: slid down and leant right back, boots up on the dash right of the wheel, doughnut on his gut
  const feetUp = clonePose(base);
  feetUp.hip.set(hx + 0.03, 0.47, hz - 0.1);
  feetUp.pelYaw = -0.32;
  feetUp.pelPitch = 0.3;
  feetUp.spPitch = 0.08;
  feetUp.spYaw = 0.18;
  feetUp.hdPitch = -0.3;
  feetUp.hdYaw = 0.1;
  feetUp.hdRoll = 0.05;
  const heelU = dashRearU + 0.07;
  feetUp.ankL.set(0.0, dashTop + 0.06, -(heelU - 0.03));
  feetUp.ankR.set(0.2, dashTop + 0.06, -(heelU + 0.02));
  feetUp.kneeL.set(0, 1, 0.1);
  feetUp.kneeR.set(0, 1, 0.1);
  feetUp.footPL = 2.0;
  feetUp.footPR = 2.05;
  feetUp.footYL = 0.35;
  feetUp.footYR = -0.25;
  const tFU = trunkOf(feetUp);
  // Right hand resting on the top of his gut, the doughnut in it; left hand behind his head
  feetUp.wristR.copy(at(tFU.torso, 0.07, 0.13, -0.3));
  feetUp.elbowR.set(1, -0.6, 0.4);
  feetUp.rollR = 0;
  feetUp.wristL.copy(at(tFU.head, -0.07, 0.1, 0.13));
  feetUp.elbowL.set(-1, 0.5, 0.1);
  feetUp.rollL = 0;

  // ---- bite: the same, head down to meet the doughnut, which is at his mouth
  const bite = clonePose(feetUp);
  bite.hdPitch = -0.12;
  bite.hdYaw = 0.05;
  bite.jaw = 0.75;
  const tB = trunkOf(bite);
  bite.wristR.copy(at(tB.head, 0.03, -0.02, -0.25));
  bite.elbowR.set(0.8, -1, 0.3);

  // ---- startled: feet slammed down, bolt upright, hands up and out, mouth open
  const startled = clonePose(base);
  startled.hip.set(hx, 0.49, hz - 0.03);
  startled.pelPitch = 0.02;
  startled.spPitch = 0.02;
  startled.hdPitch = 0.12;
  startled.jaw = 1;
  startled.ankL.set(hx - 0.16, 0.46, hz - 0.5);
  startled.ankR.set(hx + 0.16, 0.46, hz - 0.5);
  startled.kneeL.set(-0.35, 1, -0.5);
  startled.kneeR.set(0.35, 1, -0.5);
  startled.footPL = 0.05;
  startled.footPR = 0.05;
  const tS = trunkOf(startled);
  startled.wristL.copy(at(tS.torso, -0.4, 0.62, -0.18));
  startled.wristR.copy(at(tS.torso, 0.4, 0.62, -0.18));
  startled.elbowL.set(-1, -0.6, 0.3);
  startled.elbowR.set(1, -0.6, 0.3);
  startled.rollL = 0.4;
  startled.rollR = -0.4;

  // ---- driving: hands at ten to two, hunched forward over the wheel, chin down
  const driving = clonePose(base);
  driving.hip.set(hx, 0.49, hz - 0.03);
  driving.pelPitch = 0.0;
  driving.spPitch = -0.1;
  driving.hdPitch = 0.02;
  driving.jaw = 0;
  driving.ankL.set(hx - 0.14, 0.45, hz - 0.72);
  driving.ankR.set(hx + 0.13, 0.45, hz - 0.74);
  driving.kneeL.set(-0.45, 1, -0.4);
  driving.kneeR.set(0.45, 1, -0.4);
  driving.footPL = 0.55;
  driving.footPR = 0.6;
  driving.wristL.copy(grip(-1, Math.PI / 3));
  driving.wristR.copy(grip(1, Math.PI / 3));
  driving.elbowL.set(-1, -0.7, 0.2);
  driving.elbowR.set(1, -0.7, 0.2);
  driving.rollL = 0;
  driving.rollR = 0;

  return { feetUp, bite, startled, driving };
}

/** How quickly each pose is reached (exponential rate, 1/s): the startle is a jolt, the drive a settle. */
const POSE_RATE: Record<CopPoseName, number> = { feetUp: 6, bite: 7, startled: 18, driving: 5 };

/**
 * The highway cop: a big man in a tan short-sleeved uniform, brown trousers
 * with a black stripe, a campaign hat, aviators and a moustache, sat in the
 * cruiser's driver's seat. One skinned mesh, rigidly bound (one bone a
 * piece), posed by placing his trunk and solving his arms and legs onto
 * points in the car.
 *
 * `root` is car-local (the cruiser's frame): add it to the cruiser's group.
 * The doughnut starts in his right hand; while it is still there,
 * 'startled' and 'driving' hide it (he has let go of it) and 'feetUp' /
 * 'bite' bring it back. To fling it, reparent it (scene.attach keeps where it
 * is) and move it yourself.
 */
export function copRig(): CopRig {
  const m = COP_CAR;
  const poses = copPoses(m);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 });
  const geo = copGeometry();
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = 'cop';
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < B.count; i++) {
    const b = new THREE.Bone();
    bones.push(b);
    mesh.add(b);
  }
  mesh.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
  // He never leaves the car, and his pose changes his extent: never culled on a stale bound
  mesh.frustumCulled = false;
  mesh.userData.surface = 'flesh';
  const root = new THREE.Group();
  root.name = 'copRig';
  root.add(mesh);

  const doughnut = doughnutMesh();
  // In the right hand's fingers, ring across the palm
  doughnut.position.set(0.01, -0.1, -0.05);
  doughnut.rotation.set(1.2, 0, 0.2);
  bones[B.handR].add(doughnut);
  const doughnutHome = { pos: doughnut.position.clone(), rot: doughnut.rotation.clone() };

  let target: Pose = clonePose(poses.feetUp);
  const cur: Pose = clonePose(poses.feetUp);
  const work: Pose = clonePose(poses.feetUp);
  let name: CopPoseName = 'feetUp';
  let biteK = 0;
  let snap = true;
  let time = 0;
  let hidDoughnut = false;
  const trunk = trunkOf(cur);

  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const mid = new THREE.Vector3();
  const end = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const place = (b: B, p: V3, quat: THREE.Quaternion): void => {
    bones[b].position.copy(p);
    bones[b].quaternion.copy(quat);
  };
  const fromMatrix = (b: B, mm: THREE.Matrix4): void => {
    mm.decompose(bones[b].position, bones[b].quaternion, tmp);
  };

  const apply = (p: Pose): void => {
    trunkOf(p, trunk);
    fromMatrix(B.pelvis, trunk.pelvis);
    fromMatrix(B.torso, trunk.torso);
    fromMatrix(B.head, trunk.head);
    fromMatrix(B.jaw, trunk.jaw);
    // Legs
    for (const [side, th, sh, ft, ank, knee, fp, fy] of [
      [-1, B.thighL, B.shinL, B.footL, p.ankL, p.kneeL, p.footPL, p.footYL],
      [1, B.thighR, B.shinR, B.footR, p.ankR, p.kneeR, p.footPR, p.footYR]
    ] as const) {
      const hipJ = at(trunk.pelvis, side * MAN.hipW, -0.03, 0);
      twoBone(hipJ, ank, MAN.thigh, MAN.shin, knee, mid, end, bend);
      place(th, hipJ, orient(mid.clone().sub(hipJ), bend, q));
      place(sh, mid, orient(end.clone().sub(mid), bend, q));
      place(ft, end, q.setFromEuler(e.set(fp, fy + p.pelYaw * 0.5, 0, 'YXZ')));
    }
    // Arms
    for (const [side, ua, fa, ha, wrist, elbow, roll] of [
      [-1, B.armL, B.foreL, B.handL, p.wristL, p.elbowL, p.rollL],
      [1, B.armR, B.foreR, B.handR, p.wristR, p.elbowR, p.rollR]
    ] as const) {
      const sh = at(trunk.torso, side * MAN.shoulderX, MAN.shoulderY, 0.0);
      twoBone(sh, wrist, MAN.upper, MAN.fore, elbow, mid, end, bend);
      place(ua, sh, orient(mid.clone().sub(sh), bend, q));
      const fq = orient(end.clone().sub(mid), bend, new THREE.Quaternion());
      place(fa, mid, fq);
      const hq = fq.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), roll));
      place(ha, end, hq);
    }
  };
  apply(cur);

  const rig: CopRig = {
    root,
    doughnut,
    pose(p, k = 1): void {
      name = p;
      if (p === 'bite') {
        biteK = clamp01(k);
        target = lerpPose(clonePose(poses.feetUp), poses.feetUp, poses.bite, biteK);
      } else {
        biteK = 0;
        target = clonePose(poses[p]);
      }
      if (snap) {
        lerpPose(cur, target, target, 0);
        apply(cur);
      }
    },
    update(dt: number): void {
      snap = false;
      time += dt;
      const a = 1 - Math.exp(-POSE_RATE[name] * Math.max(0, dt));
      lerpPose(cur, cur, target, a);
      // Idle on top of the pose: breathing; chewing with a bite in; a boot wagging on the dash; a little wheel-work
      lerpPose(work, cur, cur, 0);
      const breathe = Math.sin(time * 1.6);
      work.spPitch += 0.012 * breathe;
      work.hdPitch -= 0.008 * breathe;
      if (name === 'bite') work.jaw = cur.jaw * (0.65 + 0.35 * Math.sin(time * 9)) * (0.4 + 0.6 * biteK);
      if (name === 'feetUp' || name === 'bite') {
        work.footYR += 0.18 * Math.sin(time * 2.2);
        work.hdRoll += 0.03 * Math.sin(time * 0.7);
      }
      if (name === 'driving') {
        const w = 0.012 * Math.sin(time * 1.3);
        work.wristL.y += w;
        work.wristR.y -= w;
        work.hdYaw += 0.04 * Math.sin(time * 0.9);
      }
      if (name === 'startled') work.hdYaw += 0.05 * Math.sin(time * 23) * Math.exp(-time * 0.2);
      apply(work);
      // The doughnut: gone from his hand when he is startled, back when he is not (if the scene has not taken it)
      if (doughnut.parent === bones[B.handR]) {
        const hide = name === 'startled' || name === 'driving';
        if (hide !== hidDoughnut) {
          doughnut.visible = !hide;
          hidDoughnut = hide;
          if (!hide) {
            doughnut.position.copy(doughnutHome.pos);
            doughnut.rotation.copy(doughnutHome.rot);
          }
        }
      } else if (hidDoughnut) {
        doughnut.visible = true;
        hidDoughnut = false;
      }
    }
  };
  return rig;
}

// ======================================================================== the jet

/**
 * The jet's numbers. Its local frame: origin on the ground under the middle
 * of the fuselage (y = 0 is the tarmac its tyres stand on), the nose toward
 * −Z, +Y up, its left side (the airstair door) toward −X — the same frame as
 * a car, so rotation.y = yaw points it the way a car with that yaw points.
 */
const JET = {
  R: 0.95,
  cy: 1.78,
  nose: -10,
  noseEnd: -6.6,
  tailStart: 2.4,
  tail: 10,
  /** The airstair door: its z extent, and the sill and top elevations on the fuselage (radians above the side's horizontal). */
  door: { z0: -6.05, z1: -5.2, phi0: Math.asin((1.18 - 1.78) / 0.95), phi1: Math.asin((2.62 - 1.78) / 0.95) }
};

const JC = {
  white: 0xeef0f2,
  belly: 0xc9cdd2,
  navy: 0x1d2a44,
  gold: 0xc9a14a,
  black: 0x111214,
  glass: 0x12161c,
  screen: 0x2a3a4c,
  metal: 0xa9aeb4,
  dark: 0x2c2e32,
  tyre: 0x18181a
};

/** The fuselage's cross-section at z: centre height and half-width / half-height. */
function section(z: number): { cy: number; rx: number; ry: number } {
  const { R, cy } = JET;
  if (z <= JET.noseEnd) {
    const t = clamp01((z - JET.nose) / (JET.noseEnd - JET.nose));
    const s = 1 - (1 - t) ** 2;
    const tipY = cy - 0.3;
    const top = tipY + (cy + R - tipY) * s ** 0.78;
    const bot = tipY - (tipY - (cy - R)) * s ** 0.5;
    return { cy: (top + bot) / 2, rx: R * s ** 0.6, ry: (top - bot) / 2 };
  }
  if (z >= JET.tailStart) {
    const t = clamp01((z - JET.tailStart) / (JET.tail - JET.tailStart));
    const top = cy + R - 0.2 * t ** 1.4;
    const bot = cy - R + (2 * R - 0.2 - 0.06) * t ** 1.3;
    return { cy: (top + bot) / 2, rx: R * Math.max(0, 1 - t ** 1.7) ** 0.75, ry: Math.max(0, (top - bot) / 2) };
  }
  return { cy, rx: R, ry: R };
}

/** The fuselage surface at angle a (0 = top, π/2 = right, 3π/2 = left) and z, pushed out along its normal by `off`. */
function hullPoint(a: number, z: number, off = 0, n?: V3): V3 {
  const s = section(z);
  const p = V(s.rx * Math.sin(a), s.cy + s.ry * Math.cos(a), z);
  if (off !== 0 || n) {
    const nn = hullNormal(a, z);
    if (n) n.copy(nn);
    p.addScaledVector(nn, off);
  }
  return p;
}

function hullNormal(a: number, z: number): V3 {
  const e = 1e-3;
  const pa0 = hullPoint(a - e, z);
  const pa1 = hullPoint(a + e, z);
  const z0 = Math.max(JET.nose, z - e);
  const z1 = Math.min(JET.tail, z + e);
  const pz0 = hullPoint(a, z0);
  const pz1 = hullPoint(a, z1);
  const da = pa1.sub(pa0);
  const dz = pz1.sub(pz0);
  const n = new THREE.Vector3().crossVectors(dz, da);
  if (n.lengthSq() < 1e-12) return V(0, 0, z < 0 ? -1 : 1);
  n.normalize();
  const s = section(z);
  const outward = V(Math.sin(a), Math.cos(a), 0);
  if (n.dot(outward) < 0 && s.rx > 1e-3) n.negate();
  return n;
}

/** Elevation above the side's horizontal (radians), from a (left side a ∈ (π, 2π), right side a ∈ (0, π)). */
function elevation(a: number): number {
  const w = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return w > Math.PI ? w - 1.5 * Math.PI : 0.5 * Math.PI - w;
}

const deg = (d: number): number => (d * Math.PI) / 180;

/** The paint at a point of the fuselage: white, a pale belly, and the navy / gold / black cheatlines along the side. */
function livery(a: number, z: number): number {
  const phi = elevation(a);
  if (phi < deg(-58)) return JC.belly;
  if (z > -7.7 && z < 8.3) {
    if (phi >= deg(-6) && phi <= deg(7)) return JC.navy;
    if (phi >= deg(-11.5) && phi <= deg(-8.5)) return JC.gold;
    if (phi >= deg(-14.5) && phi <= deg(-12.8)) return JC.black;
  }
  return JC.white;
}

const STRIPE_EDGES = [-14.5, -12.8, -11.5, -8.5, -6, 7];

/** A geometry from raw triangle soup, in the attribute set `finish` makes (position, normal, uv, colour). */
function soup(pos: number[], nrm: number[], col: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/**
 * A patch of the fuselage over angles `as` and stations `zs`, pushed `off`
 * out along the normal, coloured per quad by `paint` (or skipped where it
 * returns null). Shared normals: smooth across the patch.
 */
function hullPatch(as: number[], zs: number[], off: number, paint: (a: number, z: number) => number | null, flip = false): THREE.BufferGeometry {
  const P: V3[][] = [];
  const N: V3[][] = [];
  for (const z of zs) {
    const pr: V3[] = [];
    const nr: V3[] = [];
    for (const a of as) {
      const n = new THREE.Vector3();
      pr.push(hullPoint(a, z, off, n));
      nr.push(flip ? n.negate() : n);
    }
    P.push(pr);
    N.push(nr);
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < as.length - 1; j++) {
      const hex = paint((as[j] + as[j + 1]) / 2, (zs[i] + zs[i + 1]) / 2);
      if (hex === null) continue;
      c.set(hex);
      // Outward-facing winding (a runs round clockwise seen from the nose, z runs aft)
      const quad: [number, number][] = flip
        ? [[i, j], [i, j + 1], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i + 1, j]]
        : [[i, j], [i + 1, j], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i, j + 1]];
      for (const [ii, jj] of quad) {
        const p = P[ii][jj];
        const n = N[ii][jj];
        pos.push(p.x, p.y, p.z);
        nrm.push(n.x, n.y, n.z);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  return soup(pos, nrm, col);
}

function uniq(list: number[]): number[] {
  const s = [...list].sort((x, y) => x - y);
  return s.filter((v, i) => i === 0 || v - s[i - 1] > 1e-5);
}

/** A closed outline (a loop of points) swept through sections: the wings, the tail, the winglets. Smooth normals; caps at either end. */
function loft(sections: V3[][], colour: number, caps: [boolean, boolean] = [true, true]): THREE.BufferGeometry {
  const n = sections[0].length;
  const pos: number[] = [];
  for (const s of sections) for (const p of s) pos.push(p.x, p.y, p.z);
  const idx: number[] = [];
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j;
      const b = i * n + ((j + 1) % n);
      const c = (i + 1) * n + ((j + 1) % n);
      const d = (i + 1) * n + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  // Wind it so the faces point out
  const cen = sections[0].reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(n);
  const p0 = sections[0][0];
  const p1 = sections[0][1];
  const p2 = sections[1][1];
  const nn = new THREE.Vector3().crossVectors(p1.clone().sub(p0), p2.clone().sub(p0));
  const mid = p0.clone().add(p1).multiplyScalar(0.5).sub(cen);
  if (nn.dot(mid) < 0) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const list = [finish(g, colour)];
  const centre = (s: V3[]): V3 => s.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(s.length);
  if (caps[0]) list.push(finish(facet(sections[0], centre(sections[0]).sub(centre(sections[1]))), colour));
  const L = sections.length - 1;
  if (caps[1]) list.push(finish(facet(sections[L], centre(sections[L]).sub(centre(sections[L - 1]))), colour));
  return merge(list, 'loft');
}

const AF = [1, 0.78, 0.55, 0.36, 0.22, 0.12, 0.055, 0.018, 0];

/**
 * An aerofoil section: leading edge at `le`, chord running back along +Z,
 * thickness ratio t, the thickness along `thick` (Y for a wing, X for a fin).
 */
function aerofoil(le: V3, chord: number, t: number, thick: 'x' | 'y', camber = 0.7): V3[] {
  const yt = (c: number): number => 5 * t * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
  const pts: [number, number][] = [];
  for (const c of AF) pts.push([c, yt(c)]);
  for (const c of [...AF].reverse().slice(1, -1)) pts.push([c, -camber * yt(c)]);
  return pts.map(([c, o]) => (thick === 'y' ? V(le.x, le.y + o * chord, le.z + c * chord) : V(le.x + o * chord, le.y, le.z + c * chord)));
}

function lathe(points: [number, number][], seg: number, x: number, y: number, z: number, colour: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(points.map(([r, h]) => new THREE.Vector2(r, h)), seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return finish(g, colour);
}

/** A wheel standing on the ground: tyre, hub, along X. */
function jetWheel(list: THREE.BufferGeometry[], x: number, z: number, r: number, w: number): void {
  list.push(finish(cylX(r, w, 16, x, r, z), JC.tyre));
  list.push(finish(cylX(r * 0.55, w + 0.02, 12, x, r, z), JC.metal));
}

/**
 * The boss's private jet: a mid-size business jet about 20 m long, 19 m
 * across the winglets and 6 m to the top of its T-tail. White, with a navy
 * stripe and gold and black cheatlines down the side, a navy fin; a rounded
 * nose with a wrap-round windscreen, a row of oval cabin windows each side,
 * low swept wings with winglets, two engines on pylons either side of the
 * rear fuselage, the gear down on the tarmac. An airstair door in the left
 * side, 4 m behind the nose, folds down out of the fuselage onto the ground.
 *
 * Frame: origin on the ground under the middle of the fuselage, nose toward
 * −Z, +Y up, the door on the left (−X). Four draws: the airframe (one
 * vertex-coloured mesh), the door, the engines' exhaust glow and their
 * intake spinners.
 */
export function privateJet(): JetRig {
  const group = new THREE.Group();
  group.name = 'privateJet';
  const { R, cy } = JET;
  const D = JET.door;
  const aD0 = 1.5 * Math.PI + D.phi0;
  const aD1 = 1.5 * Math.PI + D.phi1;
  const list: THREE.BufferGeometry[] = [];

  // ---- the fuselage, with the door's hole left out
  const as: number[] = [];
  for (let i = 0; i <= 44; i++) as.push((i / 44) * Math.PI * 2);
  for (const d of STRIPE_EDGES) as.push(1.5 * Math.PI + deg(d), 0.5 * Math.PI - deg(d));
  as.push(aD0, aD1, 1.5 * Math.PI + deg(-58), 0.5 * Math.PI + deg(58));
  const A = uniq(as);
  const zs: number[] = [-10, -9.995, -9.98, -9.95, -9.9, -9.83, -9.74, -9.62, -9.48];
  for (let z = -9.3; z < 9.95; z += 0.2) zs.push(z);
  zs.push(JET.tail, -7.7, 8.3, D.z0, D.z1);
  const Z = uniq(zs.filter((z) => z >= JET.nose && z <= JET.tail));
  const inDoor = (a: number, z: number): boolean => a > aD0 && a < aD1 && z > D.z0 && z < D.z1;
  list.push(hullPatch(A, Z, 0, (a, z) => (inDoor(a, z) ? null : livery(a, z))));

  // ---- the doorway: a lining round the hole, a bulkhead behind it, floor and ceiling
  {
    const xb = -0.2;
    const lo = hullPoint(aD0, D.z0);
    const hi = hullPoint(aD1, D.z0);
    const lining = 0x9a9ea3;
    // Bulkhead, facing out (−X)
    list.push(finish(facet([V(xb, lo.y, D.z0), V(xb, lo.y, D.z1), V(xb, hi.y, D.z1), V(xb, hi.y, D.z0)], V(-1, 0, 0)), 0x6e665c));
    // Floor (up) and ceiling (down)
    list.push(finish(facet([V(lo.x, lo.y, D.z0), V(xb, lo.y, D.z0), V(xb, lo.y, D.z1), V(lo.x, lo.y, D.z1)], V(0, 1, 0)), 0x3a3632));
    list.push(finish(facet([V(hi.x, hi.y, D.z0), V(xb, hi.y, D.z0), V(xb, hi.y, D.z1), V(hi.x, hi.y, D.z1)], V(0, -1, 0)), 0x5a5650));
    // The jambs: the hull's curve between sill and top, out to the bulkhead
    const curve: number[] = A.filter((a) => a >= aD0 && a <= aD1);
    for (const [z, face] of [[D.z0, 1], [D.z1, -1]] as const) {
      for (let i = 0; i < curve.length - 1; i++) {
        const p = hullPoint(curve[i], z);
        const q = hullPoint(curve[i + 1], z);
        list.push(finish(facet([p, q, V(xb, q.y, z), V(xb, p.y, z)], V(0, 0, face)), lining));
      }
    }
  }

  // ---- the windscreen and the cockpit side windows, on a black painted surround
  {
    const pane = (a0: number, a1: number, z0: number, z1: number, off: number, col: number, na = 6, nz = 4): void => {
      const as2: number[] = [];
      for (let i = 0; i <= na; i++) as2.push(lerp(a0, a1, i / na));
      const zs2: number[] = [];
      for (let i = 0; i <= nz; i++) zs2.push(lerp(z0, z1, i / nz));
      list.push(hullPatch(as2, zs2, off, () => col));
    };
    pane(-1.2, 1.2, -9.02, -7.72, 0.005, 0x14161a, 16, 6);
    pane(-0.6, -0.04, -8.95, -8.32, 0.009, JC.screen);
    pane(0.04, 0.6, -8.95, -8.32, 0.009, JC.screen);
    pane(0.7, 1.12, -8.4, -7.82, 0.009, JC.screen);
    pane(-1.12, -0.7, -8.4, -7.82, 0.009, JC.screen);
  }

  // ---- cabin windows: ovals along the side at seated eye height
  const oval = (a: number, z: number, into: THREE.BufferGeometry[], off = 0.009): void => {
    const hwz = 0.15;
    const hh = 0.2;
    const s = section(z);
    const da = hh / Math.max(0.3, s.ry);
    const n = 18;
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color(JC.glass);
    const nc = new THREE.Vector3();
    const pc = hullPoint(a, z, off, nc);
    const ring: { p: V3; n: V3 }[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const nn = new THREE.Vector3();
      const p = hullPoint(a + Math.sin(t) * da, z + Math.cos(t) * hwz, off, nn);
      ring.push({ p, n: nn });
    }
    for (let i = 0; i < n; i++) {
      // Wound to face out whichever side it is on
      const r0 = ring[i];
      const r1 = ring[i + 1];
      const tri = [pc, r0.p, r1.p];
      const fn = new THREE.Vector3().crossVectors(r0.p.clone().sub(pc), r1.p.clone().sub(pc));
      const ordered = fn.dot(nc) >= 0 ? tri : [pc, r1.p, r0.p];
      const ns = fn.dot(nc) >= 0 ? [nc, r0.n, r1.n] : [nc, r1.n, r0.n];
      ordered.forEach((p, k) => {
        pos.push(p.x, p.y, p.z);
        nrm.push(ns[k].x, ns[k].y, ns[k].z);
        col.push(c.r, c.g, c.b);
      });
    }
    into.push(soup(pos, nrm, col));
  };
  const winPhi = deg(22);
  for (const z of [-4.55, -3.6, -2.65, -1.7, -0.75, 0.2, 1.15]) oval(1.5 * Math.PI + winPhi, z, list);
  for (const z of [-5.75, -4.55, -3.6, -2.65, -1.7, -0.75, 0.2, 1.15]) oval(0.5 * Math.PI - winPhi, z, list);

  // ---- wings: low and swept, with dihedral, winglets at the tips; the fairing under the middle
  const wing = { rootX: 0.5, rootY: cy - 0.56, rootLE: -1.15, rootC: 3.75, tipX: 9.0, tipLE: 3.1, tipC: 1.2, dihedral: deg(4) };
  for (const s of [-1, 1]) {
    const tipY = wing.rootY + (wing.tipX - wing.rootX) * Math.tan(wing.dihedral);
    const root = aerofoil(V(s * wing.rootX, wing.rootY, wing.rootLE), wing.rootC, 0.13, 'y');
    const midX = lerp(wing.rootX, wing.tipX, 0.35);
    const mid = aerofoil(V(s * midX, lerp(wing.rootY, tipY, 0.35), lerp(wing.rootLE, wing.tipLE, 0.35)), lerp(wing.rootC, wing.tipC, 0.35), 0.115, 'y');
    const tip = aerofoil(V(s * wing.tipX, tipY, wing.tipLE), wing.tipC, 0.1, 'y');
    list.push(loft([root, mid, tip], JC.white, [false, true]));
    // Winglet: canted out, swept, from the tip up
    const wl0 = aerofoil(V(s * (wing.tipX + 0.02), tipY - 0.02, wing.tipLE + 0.03), wing.tipC - 0.06, 0.09, 'x', 1);
    const wl1 = aerofoil(V(s * (wing.tipX + 0.18), tipY + 0.45, wing.tipLE + 0.32), 0.85, 0.09, 'x', 1);
    const wl2 = aerofoil(V(s * (wing.tipX + 0.42), tipY + 1.35, wing.tipLE + 0.95), 0.45, 0.08, 'x', 1);
    list.push(loft([wl0, wl1, wl2], JC.navy, [true, true]));
    // Navigation lamps: red on the left tip, green on the right
    list.push(finish(box(0.05, 0.05, 0.1, s * (wing.tipX + 0.06), tipY, wing.tipLE + 0.1), s < 0 ? 0xd01818 : 0x18c040));
    // Flap track fairings under the wing
    for (const f of [0.3, 0.55]) {
      const x = lerp(wing.rootX + 0.8, wing.tipX, f);
      const le = lerp(wing.rootLE, wing.tipLE, (x - wing.rootX) / (wing.tipX - wing.rootX));
      const ch = lerp(wing.rootC, wing.tipC, (x - wing.rootX) / (wing.tipX - wing.rootX));
      const y = lerp(wing.rootY, tipY, (x - wing.rootX) / (wing.tipX - wing.rootX));
      list.push(finish(sph(0.12, s * x, y - 0.08, le + ch * 0.85, 0.6, 0.6, 5, 8, 6), JC.belly));
    }
  }
  list.push(finish(sph(1, 0, cy - 0.66, 0.9, 1.05, 0.4, 2.9, 16, 10), JC.belly));

  // ---- the T-tail: a navy fin with a gold band, the tailplane across its top, a bullet fairing
  {
    const finRoot = { y: cy + R - 0.35, le: 5.7, c: 3.6 };
    const finTop = { y: 5.92, le: 8.2, c: 1.75 };
    const at2 = (t: number): V3[] =>
      aerofoil(V(0, lerp(finRoot.y, finTop.y, t), lerp(finRoot.le, finTop.le, t)), lerp(finRoot.c, finTop.c, t), lerp(0.12, 0.1, t), 'x', 1);
    list.push(loft([at2(0), at2(0.72)], JC.navy, [true, false]));
    list.push(loft([at2(0.72), at2(0.79)], JC.gold, [false, false]));
    list.push(loft([at2(0.79), at2(1)], JC.navy, [false, true]));
    // A dorsal fillet running forward from the fin's root
    list.push(loft([aerofoil(V(0, cy + R - 0.1, 4.6), 1.6, 0.12, 'x', 1), aerofoil(V(0, cy + R + 0.25, 5.65), 1.0, 0.18, 'x', 1)], JC.navy));
    for (const s of [-1, 1]) {
      const root = aerofoil(V(0, finTop.y + 0.02, 8.15), 1.85, 0.1, 'y');
      const tip = aerofoil(V(s * 3.3, finTop.y + 0.12, 9.45), 0.8, 0.09, 'y');
      list.push(loft([root, tip], JC.white, [false, true]));
    }
    list.push(finish(sph(1, 0, finTop.y + 0.04, 9.05, 0.17, 0.2, 1.25, 10, 8), JC.navy));
    list.push(finish(box(0.06, 0.05, 0.12, 0, finTop.y + 0.25, 9.3), 0xd01818));
  }

  // ---- engines: nacelles on pylons either side of the rear fuselage
  const glowGeo: THREE.BufferGeometry[] = [];
  const spinGeo: THREE.BufferGeometry[] = [];
  const eng = { x: 1.82, y: cy + 0.55, z: 4.35, len: 2.95 };
  for (const s of [-1, 1]) {
    const x = s * eng.x;
    // Lip, cowling and exhaust ring as their own lathes, so the colours change crisply
    list.push(lathe([[0.4, 0.14], [0.43, 0.02], [0.47, 0.0], [0.52, 0.04], [0.545, 0.14]], 22, x, eng.y, eng.z, JC.metal));
    list.push(lathe([[0.545, 0.14], [0.565, 0.6], [0.56, 1.6], [0.51, 2.45], [0.45, 2.85]], 22, x, eng.y, eng.z, JC.white));
    list.push(lathe([[0.45, 2.85], [0.425, 2.95], [0.37, 2.93], [0.35, 2.7]], 22, x, eng.y, eng.z, JC.dark));
    // The duct and the fan's face
    list.push(lathe([[0.39, 0.48], [0.4, 0.14]], 22, x, eng.y, eng.z, JC.dark));
    const fan = new THREE.CircleGeometry(0.39, 22);
    fan.rotateY(Math.PI);
    fan.translate(x, eng.y, eng.z + 0.48);
    list.push(finish(fan, 0x1c1d20));
    // Spinner (its own material, for the spool-up tint)
    const spin = new THREE.ConeGeometry(0.13, 0.26, 14);
    spin.rotateX(-Math.PI / 2);
    spin.translate(x, eng.y, eng.z + 0.48 - 0.13);
    spinGeo.push(spin.toNonIndexed());
    // Exhaust: the hot core (glow material) and the tail cone plug
    const core = new THREE.CircleGeometry(0.35, 22);
    core.translate(x, eng.y, eng.z + 2.7);
    glowGeo.push(core.toNonIndexed());
    const plug = new THREE.ConeGeometry(0.17, 0.42, 14);
    plug.rotateX(Math.PI / 2);
    plug.translate(x, eng.y, eng.z + 2.7 + 0.21);
    list.push(finish(plug, 0x4a4c50));
    // Pylon: a thin swept slab from the fuselage side to the nacelle
    const inner = section(eng.z + 1.4).rx * 0.7;
    const py0 = aerofoil(V(s * inner, eng.y - 0.04, eng.z + 0.7), 1.9, 0.09, 'y');
    const py1 = aerofoil(V(s * (eng.x - 0.35), eng.y, eng.z + 0.8), 1.7, 0.09, 'y');
    list.push(loft([py0, py1], JC.white, [false, false]));
  }

  // ---- landing gear: twin nosewheels, twin wheels each main leg
  {
    const nz = -7.35;
    const nb = section(nz);
    const top = nb.cy - nb.ry + 0.05;
    list.push(finish(new THREE.CylinderGeometry(0.055, 0.055, top - 0.22, 8).translate(0, (top + 0.22) / 2, nz), JC.metal));
    list.push(finish(new THREE.CylinderGeometry(0.075, 0.075, 0.3, 8).translate(0, top - 0.25, nz), JC.dark));
    list.push(finish(box(0.3, 0.05, 0.08, 0, 0.24, nz), JC.metal));
    jetWheel(list, -0.13, nz, 0.23, 0.13);
    jetWheel(list, 0.13, nz, 0.23, 0.13);
    for (const s of [-1, 1]) list.push(finish(box(0.02, 0.45, 0.85, s * 0.28, top - 0.2, nz + 0.1), JC.white));
    for (const s of [-1, 1]) {
      const mx = s * 1.68;
      const mz = 1.75;
      const wy = wing.rootY - 0.12;
      list.push(finish(new THREE.CylinderGeometry(0.07, 0.07, wy - 0.33, 8).translate(mx, (wy + 0.33) / 2, mz), JC.metal));
      list.push(finish(new THREE.CylinderGeometry(0.095, 0.095, 0.35, 8).translate(mx, wy - 0.25, mz), JC.dark));
      list.push(finish(box(0.42, 0.07, 0.1, mx, 0.33, mz), JC.metal));
      jetWheel(list, mx - 0.17, mz, 0.33, 0.17);
      jetWheel(list, mx + 0.17, mz, 0.33, 0.17);
      // The leg's door, hanging from the wing beside it
      list.push(finish(box(0.02, 0.62, 0.7, mx + s * 0.32, wy - 0.33, mz), JC.white));
    }
  }

  // A red beacon under the belly
  list.push(finish(box(0.12, 0.06, 0.12, 0, cy - R + 0.0, 0.6), 0xd01818));

  const jetMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.08 });
  const body = new THREE.Mesh(merge(list, 'jet'), jetMat);
  body.name = 'jetBody';
  body.userData.surface = 'metal';
  body.geometry.computeBoundingSphere();
  group.add(body);

  // ---- engine glow and spinners
  const glow = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.9, metalness: 0, emissive: 0xff7a30, emissiveIntensity: 0 });
  const glowMesh = new THREE.Mesh(merge(glowGeo.map((g) => stripTo(g)), 'jet glow'), glow);
  glowMesh.name = 'jetGlow';
  group.add(glowMesh);
  const spinner = new THREE.MeshStandardMaterial({ color: 0x3c3f44, roughness: 0.35, metalness: 0.3, emissive: 0xc8d8ea, emissiveIntensity: 0 });
  const spinMesh = new THREE.Mesh(merge(spinGeo.map((g) => stripTo(g)), 'jet spinners'), spinner);
  spinMesh.name = 'jetSpinners';
  group.add(spinMesh);

  // ---- the airstair door
  const sill = hullPoint(aD0, (D.z0 + D.z1) / 2);
  const pivot = new THREE.Group();
  pivot.name = 'airstair';
  pivot.position.set(sill.x, sill.y, (D.z0 + D.z1) / 2);
  group.add(pivot);
  const dl: THREE.BufferGeometry[] = [];
  const gap = 0.012;
  const da = gap / R;
  const dA: number[] = A.filter((a) => a > aD0 + da && a < aD1 - da);
  dA.unshift(aD0 + da);
  dA.push(aD1 - da);
  const dZ = [D.z0 + gap, lerp(D.z0, D.z1, 0.25), lerp(D.z0, D.z1, 0.5), lerp(D.z0, D.z1, 0.75), D.z1 - gap];
  dl.push(hullPatch(dA, dZ, 0.002, (a, z) => livery(a, z)));
  const th = 0.06;
  dl.push(hullPatch(dA, dZ, -th, () => 0xb8bcc0, true));
  // Its edges
  {
    const edge = 0x9a9ea3;
    for (const z of [dZ[0], dZ[dZ.length - 1]]) {
      for (let i = 0; i < dA.length - 1; i++) {
        const p0 = hullPoint(dA[i], z, 0.002);
        const p1 = hullPoint(dA[i + 1], z, 0.002);
        const q0 = hullPoint(dA[i], z, -th);
        const q1 = hullPoint(dA[i + 1], z, -th);
        dl.push(finish(facet([p0, p1, q1, q0], V(0, 0, z < (D.z0 + D.z1) / 2 ? -1 : 1)), edge));
      }
    }
    for (const a of [dA[0], dA[dA.length - 1]]) {
      const p0 = hullPoint(a, dZ[0], 0.002);
      const p1 = hullPoint(a, dZ[dZ.length - 1], 0.002);
      const q0 = hullPoint(a, dZ[0], -th);
      const q1 = hullPoint(a, dZ[dZ.length - 1], -th);
      const out = V(0, a < (aD0 + aD1) / 2 ? -1 : 1, 0);
      dl.push(finish(facet([p0, p1, q1, q0], out), edge));
    }
  }
  oval(1.5 * Math.PI + winPhi, (D.z0 + D.z1) / 2, dl, 0.011);

  // Where it opens to: turned about the sill (+Z axis) until its far edge rests on the tarmac
  const outline: V3[] = [];
  for (const a of dA) for (const z of [dZ[0], dZ[dZ.length - 1]]) outline.push(hullPoint(a, z, -th), hullPoint(a, z, 0.002));
  const lowest = (ang: number): number => {
    let lo = Infinity;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    for (const p of outline) {
      const x = p.x - pivot.position.x;
      const y = p.y - pivot.position.y;
      lo = Math.min(lo, pivot.position.y + x * s + y * c);
    }
    return lo;
  };
  let lo = 0.5;
  let hi = Math.PI;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (lowest(mid) > 0.0) lo = mid;
    else hi = mid;
  }
  const openAngle = lo;

  // The stairs, built where the open door puts them (treads level, on its inner face), then turned back into its shut frame
  {
    const toShut = new THREE.Matrix4()
      .makeTranslation(pivot.position.x, pivot.position.y, pivot.position.z)
      .multiply(new THREE.Matrix4().makeRotationZ(-openAngle))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.position.x, -pivot.position.y, -pivot.position.z));
    const openM = new THREE.Matrix4()
      .makeTranslation(pivot.position.x, pivot.position.y, pivot.position.z)
      .multiply(new THREE.Matrix4().makeRotationZ(openAngle))
      .multiply(new THREE.Matrix4().makeTranslation(-pivot.position.x, -pivot.position.y, -pivot.position.z));
    // The inner face's line, open, from the sill out to the far edge, across the door's middle
    const innerOpen = dA.map((a) => hullPoint(a, (D.z0 + D.z1) / 2, -th).applyMatrix4(openM));
    const surfaceAt = (x: number): number => {
      // Height of the open inner face under x (it runs from the sill outward and down)
      for (let i = 0; i < innerOpen.length - 1; i++) {
        const p = innerOpen[i];
        const q = innerOpen[i + 1];
        if ((x <= p.x && x >= q.x) || (x >= p.x && x <= q.x)) return lerp(p.y, q.y, (x - p.x) / (q.x - p.x || 1));
      }
      return innerOpen[innerOpen.length - 1].y;
    };
    const top = innerOpen[0];
    const foot = innerOpen[innerOpen.length - 1];
    const nSteps = 5;
    const width = D.z1 - D.z0 - 0.1;
    const zc = (D.z0 + D.z1) / 2;
    const stairs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < nSteps; i++) {
      // Each step a wedge sitting on the face: a level tread whose back edge meets the face, its
      // front edge `depth` further out, a riser down to the face, and its underside along the face
      const yTop = lerp(0.2, top.y - 0.03, i / (nSteps - 0.6));
      let xBack = foot.x;
      for (let k = 0; k <= 60; k++) {
        const xx = lerp(foot.x, top.x, k / 60);
        if (surfaceAt(xx) <= yTop) xBack = xx;
      }
      const depth = 0.22;
      const xFront = Math.max(foot.x, xBack - depth);
      const yFoot = surfaceAt(xFront);
      const shape = new THREE.Shape([new THREE.Vector2(xBack, yTop), new THREE.Vector2(xFront, yTop), new THREE.Vector2(xFront, yFoot)]);
      const wedge = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, steps: 1, curveSegments: 1 });
      wedge.translate(0, 0, zc - width / 2);
      stairs.push(finish(wedge, i % 2 ? 0x5a5d62 : 0x55585c));
      // A black rubber nosing along the tread's front edge
      stairs.push(finish(box(0.04, 0.02, width + 0.004, xFront + 0.02, yTop - 0.008, zc), 0x1e1f21));
    }
    // Posts at the foot of the stair, both sides, for the handrails to hang from
    const postTop: V3[] = [];
    for (const z of [D.z0 + 0.04, D.z1 - 0.04]) {
      const base = V(foot.x + 0.18, surfaceAt(foot.x + 0.18), z);
      stairs.push(finish(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6).translate(base.x, base.y + 0.45, z), JC.metal));
      postTop.push(V(base.x, base.y + 0.9, z));
    }
    for (const g of stairs) {
      g.applyMatrix4(toShut);
      dl.push(g);
    }
    const doorGeo = merge(dl, 'airstair');
    doorGeo.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
    doorGeo.computeBoundingSphere();
    const doorMesh = new THREE.Mesh(doorGeo, jetMat);
    doorMesh.name = 'airstairDoor';
    doorMesh.userData.surface = 'metal';
    pivot.add(doorMesh);

    // Handrails: a rail from each post's top to the doorway's upper corner. The posts ride the door; the corners stay put.
    const corner = [V(hullPoint(aD1, D.z0).x + 0.04, hullPoint(aD1, D.z0).y - 0.1, D.z0 + 0.04), V(hullPoint(aD1, D.z1).x + 0.04, hullPoint(aD1, D.z1).y - 0.1, D.z1 - 0.04)];
    const postShut = postTop.map((p) => p.clone().applyMatrix4(toShut).sub(pivot.position));
    const railGeo = new THREE.BufferGeometry();
    const railPos = new Float32Array(2 * 36 * 3);
    railGeo.setAttribute('position', new THREE.BufferAttribute(railPos, 3));
    railGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(2 * 36 * 3), 3));
    const railMesh = new THREE.Mesh(railGeo, new THREE.MeshStandardMaterial({ color: JC.metal, roughness: 0.4, metalness: 0.3 }));
    railMesh.name = 'airstairRails';
    railMesh.frustumCulled = false;
    group.add(railMesh);
    const proto = new THREE.BoxGeometry(0.025, 0.025, 1).toNonIndexed();
    const pp = proto.attributes.position as THREE.BufferAttribute;
    const pn = proto.attributes.normal as THREE.BufferAttribute;
    const tmpM = new THREE.Matrix4();
    const tq = new THREE.Quaternion();
    const tv = new THREE.Vector3();
    const tn = new THREE.Vector3();
    const updateRails = (): void => {
      const posA = railGeo.attributes.position as THREE.BufferAttribute;
      const nrmA = railGeo.attributes.normal as THREE.BufferAttribute;
      for (let r = 0; r < 2; r++) {
        const a = postShut[r].clone().applyQuaternion(pivot.quaternion).add(pivot.position);
        const b = corner[r];
        const d = b.clone().sub(a);
        const len = Math.max(0.001, d.length());
        tq.setFromUnitVectors(V(0, 0, 1), d.clone().divideScalar(len));
        tmpM.compose(a.clone().add(b).multiplyScalar(0.5), tq, V(1, 1, len));
        for (let i = 0; i < 36; i++) {
          tv.fromBufferAttribute(pp, i).applyMatrix4(tmpM);
          tn.fromBufferAttribute(pn, i).applyQuaternion(tq);
          posA.setXYZ(r * 36 + i, tv.x, tv.y, tv.z);
          nrmA.setXYZ(r * 36 + i, tn.x, tn.y, tn.z);
        }
      }
      posA.needsUpdate = true;
      nrmA.needsUpdate = true;
    };

    const doorTop = V(sill.x + 0.35, sill.y + 0.01, zc);
    const stairFoot = V(foot.x - 0.4, 0, zc);

    const rig: JetRig = {
      group,
      setDoor(k: number): void {
        const t = clamp01(k);
        pivot.rotation.z = t * openAngle;
        pivot.updateMatrix();
        updateRails();
      },
      doorTop,
      stairFoot,
      setEngines(k: number): void {
        const t = clamp01(k);
        glow.emissiveIntensity = 2.4 * t * t;
        spinner.emissiveIntensity = 0.45 * t;
      }
    };
    rig.setDoor(0);
    return rig;
  }
}

/** Reduce a geometry to position + normal (+ uv), non-indexed, so plain-material pieces merge. */
function stripTo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') out.deleteAttribute(k);
  return out;
}
