import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { makeCanvas } from './Level8Builder';

/**
 * The inside of the survey station, where he comes out: the receiver (a
 * small Atom Warper — a ring of coil pylons under a hoop, a pad he arrives
 * standing on), the console that brought him through and says so, and the
 * room itself in detail — specimen jars, rock samples, the locker, the cot,
 * the desk, the bench, the generator, the crates — with somebody's meal not
 * long abandoned on the desk, the coffee still steaming.
 *
 * Everything is built into the station's group, whose origin is at floor
 * level under (0, 0) of the world's x/z (so x/z here are the world's).
 */

export interface StationAnim {
  /** Every frame: `t` seconds since the level began; `eye` where he's looking from. */
  update(t: number, dt: number, eye: THREE.Vector3, cam?: THREE.Camera): void;
}

export interface StationOut {
  anim: StationAnim;
  /** Things in the jars, turned slowly by the scene. */
  specimens: THREE.Object3D[];
  /** Where he arrives: the middle of the pad. */
  pad: THREE.Vector3;
}

/** Solid boxes in the station's own coordinates (x0, y0, z0, x1, y1, z1), floor at y 0. */
type Solid = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void;

export const RECEIVER = { x: 0, z: 134.6, r: 1.3, h: 2.5 };
const CONSOLE = { x: 1.95, z: 132.75 };

// ---------------------------------------------------------------- small helpers

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise3(x: number, y: number, z: number): number {
  return Math.sin(x * 1.7 + Math.sin(y * 2.3 + z * 0.7)) * 0.5 + Math.sin(y * 2.9 + Math.sin(z * 1.9 + x * 1.1)) * 0.3 + Math.sin(z * 3.7 + x * 2.2) * 0.2;
}

function rbox(w: number, h: number, d: number, r = 0.015, seg = 3): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
}

/** A lump: an icosphere pushed about by noise. */
function lumpGeo(r: number, rough: number, seed: number, detail = 4, squash = 1): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(r, detail);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const k = 1 + noise3(n.x * 3 + seed, n.y * 3 - seed, n.z * 3) * rough + noise3(n.x * 9, n.y * 9 + seed, n.z * 9) * rough * 0.35;
    v.multiplyScalar(k);
    v.y *= squash;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = makeCanvas(w, h);
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function softDot(): THREE.CanvasTexture {
  return canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
}

// ---------------------------------------------------------------- the console's screen

const LOG = [
  'WARP SEQUENCE INITIATED — ORIGIN: HQ SUBLEVEL 4',
  'PATTERN CAPTURE ......................... OK',
  'CARRIER LOCK K09-A ...................... OK',
  'TRANSIT 0.0041 s — DRIFT 0.2 mm',
  'REASSEMBLY .............................. OK',
  'NEURAL CONTINUITY ....................... OK',
  'SUBJECT: 1 — SUIT SEAL ................ GREEN',
  'ATMOS: 0.71 bar  O2 19.8%  — DO NOT UNSEAL',
  'RETURN LINK ......................... OFFLINE',
  'AWAITING RECALL SIGNAL FROM EXIT GATE'
];

/** Dots on the planet: land, more or less. */
const LAND: [number, number][] = [];
for (let i = 0; i < 520; i++) {
  const lat = Math.asin(hash(i, 1) * 2 - 1);
  const lon = hash(i, 2) * Math.PI * 2;
  const k = Math.sin(lon * 3 + lat * 2) + Math.sin(lon * 5 - lat * 4) * 0.6 + Math.cos(lat * 3);
  if (k > 0.6) LAND.push([lat, lon]);
}

function drawScreen(c: CanvasRenderingContext2D, t: number): void {
  const W = 1024;
  const H = 640;
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#04131f');
  bg.addColorStop(1, '#010710');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  c.lineWidth = 1;
  c.strokeStyle = 'rgba(70,170,230,0.07)';
  c.beginPath();
  for (let x = 0; x <= W; x += 32) {
    c.moveTo(x, 44);
    c.lineTo(x, H);
  }
  for (let y = 44; y <= H; y += 32) {
    c.moveTo(0, y);
    c.lineTo(W, y);
  }
  c.stroke();
  // Header
  c.fillStyle = 'rgba(40,150,230,0.2)';
  c.fillRect(0, 0, W, 44);
  c.fillStyle = '#86d8ff';
  c.font = 'bold 20px "Courier New", monospace';
  c.textAlign = 'left';
  c.fillText('ATOM WARPER  //  RECEIVER NODE K09-A/2', 18, 29);
  c.textAlign = 'right';
  const s = Math.floor(t);
  c.fillText(`T+${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((t % 1) * 100)).padStart(2, '0')}`, W - 18, 29);
  c.textAlign = 'left';

  // ---- The planet, turning, the landing site on it, the line he came in on
  const cx = 250;
  const cy = 330;
  const R = 175;
  const rot = t * 0.22;
  const tilt = 0.38;
  const proj = (lat: number, lon: number): [number, number, number] => {
    const x = Math.cos(lat) * Math.sin(lon + rot);
    const y = Math.sin(lat);
    const z = Math.cos(lat) * Math.cos(lon + rot);
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
    const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
    return [cx + x * R, cy - y2 * R, z2];
  };
  const glow = c.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 1.25);
  glow.addColorStop(0, 'rgba(60,200,140,0.0)');
  glow.addColorStop(0.5, 'rgba(60,200,140,0.18)');
  glow.addColorStop(1, 'rgba(60,200,140,0)');
  c.fillStyle = glow;
  c.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
  const body = c.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
  body.addColorStop(0, '#16402e');
  body.addColorStop(1, '#03110c');
  c.fillStyle = body;
  c.beginPath();
  c.arc(cx, cy, R, 0, Math.PI * 2);
  c.fill();
  const line = (pts: [number, number, number][]): void => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const front = a[2] > 0 && b[2] > 0;
      c.strokeStyle = front ? 'rgba(110,255,180,0.55)' : 'rgba(110,255,180,0.1)';
      c.beginPath();
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
      c.stroke();
    }
  };
  for (let lat = -75; lat <= 75; lat += 15) {
    const pts: [number, number, number][] = [];
    for (let k = 0; k <= 64; k++) pts.push(proj((lat * Math.PI) / 180, (k / 64) * Math.PI * 2));
    line(pts);
  }
  for (let lon = 0; lon < 360; lon += 20) {
    const pts: [number, number, number][] = [];
    for (let k = 0; k <= 40; k++) pts.push(proj(-Math.PI / 2 + (k / 40) * Math.PI, (lon * Math.PI) / 180));
    line(pts);
  }
  for (const [lat, lon] of LAND) {
    const [x, y, z] = proj(lat, lon);
    if (z <= 0) continue;
    c.fillStyle = `rgba(150,255,190,${0.25 + z * 0.6})`;
    c.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  c.strokeStyle = 'rgba(140,255,200,0.9)';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(cx, cy, R, 0, Math.PI * 2);
  c.stroke();
  // The site: pulsing rings; the inbound line to it
  const [mx, my] = proj(0.32, 0.25);
  c.setLineDash([10, 8]);
  c.lineDashOffset = -t * 40;
  c.strokeStyle = 'rgba(255,200,90,0.85)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(520, 70);
  c.quadraticCurveTo(420, 120, mx, my);
  c.stroke();
  c.setLineDash([]);
  for (let k = 0; k < 3; k++) {
    const ph = (t * 0.8 + k / 3) % 1;
    c.strokeStyle = `rgba(255,210,100,${1 - ph})`;
    c.beginPath();
    c.arc(mx, my, 6 + ph * 34, 0, Math.PI * 2);
    c.stroke();
  }
  c.fillStyle = '#ffd36a';
  c.beginPath();
  c.arc(mx, my, 5, 0, Math.PI * 2);
  c.fill();
  c.font = 'bold 14px "Courier New", monospace';
  c.fillText('LANDING: SURVEY STN 2', mx + 14, my - 10);
  c.fillStyle = 'rgba(134,216,255,0.8)';
  c.fillText('K09-A  ·  1.08 g  ·  ROT 31.4 h', 40, 560);
  c.fillText('ORBIT 2  ·  DIST 41.2 ly', 40, 580);

  // ---- The verdict
  const px = 520;
  c.strokeStyle = 'rgba(110,255,170,0.6)';
  c.lineWidth = 2;
  c.strokeRect(px, 66, 482, 196);
  c.fillStyle = 'rgba(30,120,70,0.16)';
  c.fillRect(px, 66, 482, 196);
  c.fillStyle = '#9fe9ff';
  c.font = 'bold 22px "Courier New", monospace';
  c.fillText('TRANSPORTATION TO', px + 24, 104);
  c.font = 'bold 72px "Courier New", monospace';
  c.fillStyle = '#e8fff4';
  c.fillText('K09 - A', px + 22, 172);
  const blink = 0.75 + 0.25 * Math.sin(t * 5);
  c.font = 'bold 48px "Courier New", monospace';
  c.fillStyle = `rgba(90,255,140,${0.18 * blink})`;
  for (const [ox, oy] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) c.fillText('SUCCESSFUL', px + 22 + ox, 236 + oy);
  c.fillStyle = `rgba(90,255,140,${blink})`;
  c.fillText('SUCCESSFUL', px + 22, 236);
  // A tick in a box
  c.strokeStyle = '#5aff96';
  c.lineWidth = 5;
  c.strokeRect(px + 400, 182, 54, 54);
  c.beginPath();
  c.moveTo(px + 410, 210);
  c.lineTo(px + 424, 226);
  c.lineTo(px + 446, 192);
  c.stroke();

  // ---- Readouts
  const bars: [string, number, string][] = [
    ['MATTER COHERENCE', 0.9998, '99.98%'],
    ['PATTERN BUFFER', 1, '100%'],
    ['BIO-SIGN LOCK', 1, '1 SUBJECT'],
    ['RETURN LINK', 0, 'OFFLINE']
  ];
  c.font = 'bold 15px "Courier New", monospace';
  bars.forEach(([name, v, txt], i) => {
    const y = 290 + i * 34;
    c.fillStyle = 'rgba(134,216,255,0.85)';
    c.fillText(name, px, y + 14);
    c.strokeStyle = 'rgba(134,216,255,0.5)';
    c.lineWidth = 1;
    c.strokeRect(px + 190, y, 200, 18);
    const off = v === 0;
    c.fillStyle = off ? `rgba(255,70,60,${0.4 + 0.4 * Math.sin(t * 6)})` : 'rgba(90,255,150,0.85)';
    c.fillRect(px + 192, y + 2, off ? 196 * (0.08 + 0.04 * Math.sin(t * 9)) : 196 * v, 14);
    c.fillStyle = off ? '#ff6a5a' : '#bfffd6';
    c.fillText(txt, px + 402, y + 14);
  });

  // ---- The warp's trace, still ringing
  const ox = 520;
  const oy = 440;
  c.strokeStyle = 'rgba(134,216,255,0.4)';
  c.strokeRect(ox, oy, 482, 70);
  c.strokeStyle = '#5ad8ff';
  c.lineWidth = 2;
  c.beginPath();
  for (let x = 0; x <= 480; x += 3) {
    const u = x / 480;
    const y = oy + 35 + Math.sin(u * 40 - t * 6) * 22 * Math.exp(-u * 2.2) * (0.7 + 0.3 * Math.sin(t * 1.3)) + Math.sin(u * 140 + t * 20) * 2;
    if (x === 0) c.moveTo(ox + 1 + x, y);
    else c.lineTo(ox + 1 + x, y);
  }
  c.stroke();

  // ---- The log, typed out
  c.font = '14px "Courier New", monospace';
  const shown = Math.min(LOG.length, Math.floor(t * 1.6) + 1);
  const first = Math.max(0, shown - 5);
  for (let i = first; i < shown; i++) {
    const y = 540 + (i - first) * 19;
    const ln = LOG[i];
    const typing = i === shown - 1 && shown < LOG.length;
    const txt = typing ? ln.slice(0, Math.floor(((t * 1.6) % 1) * ln.length)) : ln;
    c.fillStyle = ln.includes('OFFLINE') ? '#ff7a6a' : 'rgba(170,255,200,0.9)';
    c.fillText(`> ${txt}${typing && Math.sin(t * 12) > 0 ? '_' : ''}`, ox, y);
  }
  // Scan lines over the lot, and a slow bright band rolling down
  c.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
  const band = ((t * 0.15) % 1.3) * H - 80;
  const bgr = c.createLinearGradient(0, band, 0, band + 80);
  bgr.addColorStop(0, 'rgba(120,220,255,0)');
  bgr.addColorStop(0.5, 'rgba(120,220,255,0.05)');
  bgr.addColorStop(1, 'rgba(120,220,255,0)');
  c.fillStyle = bgr;
  c.fillRect(0, band, W, 80);
}

// ================================================================ the room

export function furnishStation(g: THREE.Group, solid: Solid, room: { x0: number; x1: number; z0: number; z1: number; h: number }): StationOut {
  const { x0, x1, z0, z1, h } = room;
  const specimens: THREE.Object3D[] = [];
  const updates: ((t: number, dt: number, eye: THREE.Vector3) => void)[] = [];
  const add = <T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0, parent: THREE.Object3D = g): T => {
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, parent: THREE.Object3D = g): THREE.Mesh => add(new THREE.Mesh(geo, m), x, y, z, parent);

  // ---- Materials
  const std = (o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial(o);
  const M = {
    dark: std({ color: 0x2b3036, roughness: 0.45, metalness: 0.65 }),
    darker: std({ color: 0x16191d, roughness: 0.5, metalness: 0.5 }),
    steel: std({ color: 0x9aa3aa, roughness: 0.28, metalness: 0.9 }),
    brushed: std({ color: 0xb8bec4, roughness: 0.38, metalness: 0.85 }),
    white: std({ color: 0xe6e8e6, roughness: 0.42, metalness: 0.1 }),
    rubber: std({ color: 0x141414, roughness: 0.85 }),
    yellow: std({ color: 0xd8b21c, roughness: 0.5, metalness: 0.2 }),
    copper: std({ color: 0xb8673a, roughness: 0.3, metalness: 0.95 }),
    olive: std({ color: 0x3e5a3c, roughness: 0.55, metalness: 0.45 }),
    blueGrey: std({ color: 0x46566a, roughness: 0.4, metalness: 0.55 }),
    wood: std({ color: 0x6a5240, roughness: 0.55 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xd8f0f4, roughness: 0.04, metalness: 0, transmission: 0.0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 })
  };
  const glow = (c: number, e: number, k = 1.6): THREE.MeshStandardMaterial => std({ color: c, emissive: e, emissiveIntensity: k, roughness: 0.3 });

  // =============================================================== the receiver
  const R = RECEIVER;
  const rec = add(new THREE.Group(), R.x, 0, R.z);
  const coilGlow = glow(0x0a2a3a, 0x48d0ff, 1.2);
  const padGlowMat = std({ color: 0x0a1c26, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.25, metalness: 0.4 });
  padGlowMat.emissiveMap = canvasTex(512, 512, (c) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, 512, 512);
    c.translate(256, 256);
    for (const [r, w, a] of [[244, 6, 0.9], [210, 2, 0.6], [170, 3, 0.7], [120, 2, 0.5], [70, 4, 0.8]] as [number, number, number][]) {
      c.strokeStyle = `rgba(90,210,255,${a})`;
      c.lineWidth = w;
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.stroke();
    }
    c.strokeStyle = 'rgba(90,210,255,0.35)';
    c.lineWidth = 2;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      c.beginPath();
      c.moveTo(Math.cos(a) * 75, Math.sin(a) * 75);
      c.lineTo(Math.cos(a) * 205, Math.sin(a) * 205);
      c.stroke();
    }
    c.font = 'bold 22px "Courier New", monospace';
    c.fillStyle = 'rgba(255,200,60,0.85)';
    c.textAlign = 'center';
    c.fillText('RECEIVER K09-A/2', 0, 150);
    c.fillText('STAND CLEAR', 0, -136);
  });
  padGlowMat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  // The base: a low stepped disc, a ribbed collar, the pad set into it
  mesh(new THREE.CylinderGeometry(R.r + 0.22, R.r + 0.3, 0.06, 72), M.dark, 0, 0.03, 0, rec);
  mesh(new THREE.CylinderGeometry(R.r - 0.05, R.r + 0.05, 0.1, 72), M.brushed, 0, 0.07, 0, rec);
  const collar = mesh(new THREE.TorusGeometry(R.r - 0.02, 0.03, 12, 96), M.yellow, 0, 0.12, 0, rec);
  collar.rotation.x = Math.PI / 2;
  const pad = mesh(new THREE.CircleGeometry(R.r - 0.1, 72), padGlowMat, 0, 0.122, 0, rec);
  pad.rotation.x = -Math.PI / 2;
  pad.rotation.z = Math.PI;
  // Hazard ring at its foot
  const hz = canvasTex(1024, 32, (c) => {
    c.fillStyle = '#d8b21c';
    c.fillRect(0, 0, 1024, 32);
    c.fillStyle = '#111';
    for (let x = -32; x < 1024; x += 48) {
      c.beginPath();
      c.moveTo(x, 32);
      c.lineTo(x + 24, 0);
      c.lineTo(x + 48, 0);
      c.lineTo(x + 24, 32);
      c.fill();
    }
  });
  hz.wrapS = THREE.RepeatWrapping;
  const hzRing = mesh(new THREE.RingGeometry(R.r + 0.31, R.r + 0.45, 96, 1), std({ map: hz, roughness: 0.7 }), 0, 0.003, 0, rec);
  hzRing.rotation.x = -Math.PI / 2;
  // The coil pylons: six, a gap toward the door (−z)
  const N = 6;
  const pylonTop = R.h;
  for (let k = 0; k < N; k++) {
    const a = ((k + 0.5) / N) * Math.PI * 2;
    const px = Math.sin(a) * R.r;
    const pz = Math.cos(a) * R.r;
    const p = add(new THREE.Group(), px, 0, pz, rec);
    p.rotation.y = a;
    mesh(rbox(0.3, 0.22, 0.3, 0.03), M.dark, 0, 0.11, 0, p);
    for (const s of [-1, 1]) for (const t of [-1, 1]) mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8), M.steel, s * 0.11, 0.225, t * 0.11, p);
    mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.3, 24), M.brushed, 0, 0.37, 0, p);
    // The core and its winding: a tight helix of copper
    mesh(new THREE.CylinderGeometry(0.05, 0.05, pylonTop - 0.75, 20), M.darker, 0, 0.52 + (pylonTop - 0.75) / 2, 0, p);
    const helix: THREE.Vector3[] = [];
    const turns = 34;
    for (let i = 0; i <= turns * 8; i++) {
      const u = i / (turns * 8);
      const aa = u * turns * Math.PI * 2;
      helix.push(new THREE.Vector3(Math.cos(aa) * 0.066, 0.62 + u * (pylonTop - 1.05), Math.sin(aa) * 0.066));
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), turns * 8, 0.009, 4), M.copper, 0, 0, 0, p);
    // Glowing insulator rings up it
    for (let i = 0; i < 4; i++) {
      const ring = mesh(new THREE.TorusGeometry(0.08, 0.016, 10, 32), coilGlow, 0, 0.6 + i * ((pylonTop - 1.0) / 3), 0, p);
      ring.rotation.x = Math.PI / 2;
    }
    mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.16, 24), M.brushed, 0, pylonTop - 0.33, 0, p);
    mesh(new THREE.SphereGeometry(0.075, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.steel, 0, pylonTop - 0.25, 0, p);
    // A cable from its foot, down and out along the floor (the console's side gets them gathered)
    solid(R.x + px - 0.15, 0, R.z + pz - 0.15, R.x + px + 0.15, pylonTop, R.z + pz + 0.15);
  }
  // The hoop over them, and the brackets holding it
  const hoop = mesh(new THREE.TorusGeometry(R.r, 0.05, 16, 128), M.brushed, 0, pylonTop - 0.12, 0, rec);
  hoop.rotation.x = Math.PI / 2;
  const hoopGlow = mesh(new THREE.TorusGeometry(R.r - 0.06, 0.014, 8, 128), coilGlow, 0, pylonTop - 0.17, 0, rec);
  hoopGlow.rotation.x = Math.PI / 2;
  // The arrival: a column of light that was full a moment ago, fading
  const colMat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 1 }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uK; uniform float uT; varying vec2 vUv;
      void main(){
        float s = sin(vUv.x * 62.83 + uT * 3.0) * 0.5 + 0.5;
        float a = (0.45 + 0.55 * (1.0 - vUv.y)) * (0.55 + 0.45 * s) * uK;
        a *= smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
        gl_FragColor = vec4(vec3(0.6, 0.92, 1.0) * (2.0 + s), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const column = mesh(new THREE.CylinderGeometry(R.r - 0.15, R.r - 0.12, pylonTop - 0.2, 64, 1, true), colMat, 0, 0.12 + (pylonTop - 0.2) / 2, 0, rec);
  column.renderOrder = 5;
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xcff4ff, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.BackSide, toneMapped: false });
  const flash = mesh(new THREE.SphereGeometry(0.6, 24, 16), flashMat, 0, 1.6, 0, rec);
  flash.renderOrder = 10;
  const recLight = new THREE.PointLight(0x7ad8ff, 3, 5, 1.6);
  add(recLight, 0, 1.4, 0, rec);

  // =============================================================== the console
  const con = add(new THREE.Group(), CONSOLE.x, 0, CONSOLE.z);
  con.rotation.y = Math.atan2(R.x - CONSOLE.x, R.z - CONSOLE.z);
  // A desk-height cabinet, a sloped deck with the keyboard on it, the big screen over it
  mesh(rbox(1.1, 0.74, 0.62, 0.025), M.blueGrey, 0, 0.37, 0, con);
  for (const s of [-1, 1]) mesh(rbox(0.5, 0.6, 0.012, 0.004), M.dark, s * 0.27, 0.36, 0.312, con);
  for (const s of [-1, 1]) mesh(rbox(0.12, 0.02, 0.02, 0.006), M.steel, s * 0.27, 0.6, 0.33, con);
  for (let k = 0; k < 6; k++) mesh(new THREE.BoxGeometry(0.18, 0.008, 0.004), M.darker, -0.32, 0.12 + k * 0.025, 0.319, con);
  const deck = mesh(rbox(1.16, 0.05, 0.42, 0.015), M.dark, 0, 0.78, 0.08, con);
  deck.rotation.x = 0.22;
  // Keyboard: a slab and its keys, instanced
  const kb = add(new THREE.Group(), 0, 0.81, 0.13, con);
  kb.rotation.x = 0.22;
  mesh(rbox(0.5, 0.022, 0.17, 0.008), M.darker, 0, 0, 0, kb);
  const keyGeo = rbox(0.026, 0.012, 0.026, 0.004, 2);
  const keys = new THREE.InstancedMesh(keyGeo, std({ color: 0x3a4048, roughness: 0.6 }), 15 * 5);
  const m4 = new THREE.Matrix4();
  let ki = 0;
  for (let r = 0; r < 5; r++)
    for (let cI = 0; cI < 15; cI++) {
      m4.makeTranslation(-0.21 + cI * 0.03 + (r % 2) * 0.008, 0.016, -0.06 + r * 0.03);
      keys.setMatrixAt(ki++, m4);
    }
  kb.add(keys);
  // A row of lit buttons and a big red one, a trackball
  const btnCols = [0x40ff80, 0xffc040, 0x40c0ff, 0x40ff80, 0xff5040, 0x40c0ff];
  btnCols.forEach((col, i) => {
    const b = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 16), glow(col, col, 1.1), 0.33 + (i % 3) * 0.045, 0.82, 0.04 + Math.floor(i / 3) * 0.05, con);
    b.rotation.x = 0.22;
  });
  mesh(new THREE.SphereGeometry(0.028, 24, 16), std({ color: 0x8a1010, roughness: 0.25 }), -0.36, 0.83, 0.12, con);
  // The screen: a slim frame on an arm, the face drawn live
  const monitor = add(new THREE.Group(), 0, 1.38, -0.12, con);
  monitor.rotation.x = -0.08;
  mesh(rbox(1.02, 0.66, 0.06, 0.02), M.darker, 0, 0, 0, monitor);
  mesh(rbox(0.3, 0.22, 0.06, 0.02), M.dark, 0, 0, -0.06, monitor);
  mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.5, 16), M.steel, 0, -0.42, -0.06, monitor);
  const sc = makeCanvas(512, 320);
  const sctx = sc.getContext('2d')!;
  sctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
  drawScreen(sctx, 0);
  const stex = new THREE.CanvasTexture(sc);
  stex.colorSpace = THREE.SRGBColorSpace;
  stex.anisotropy = 8;
  const face = mesh(new THREE.PlaneGeometry(0.96, 0.6), new THREE.MeshBasicMaterial({ map: stex, toneMapped: false }), 0, 0, 0.031, monitor);
  void face;

  // A tower beside it, LEDs down its face
  const tower = add(new THREE.Group(), 0.72, 0, -0.05, con);
  mesh(rbox(0.24, 0.62, 0.5, 0.02), M.darker, 0, 0.31, 0, tower);
  for (let k = 0; k < 10; k++) mesh(new THREE.BoxGeometry(0.18, 0.006, 0.004), M.dark, 0, 0.12 + k * 0.035, 0.252, tower);
  const leds: THREE.MeshStandardMaterial[] = [];
  for (let k = 0; k < 6; k++) {
    const mat = glow(0x103010, k % 3 === 2 ? 0xffb040 : 0x40ff80, 1.5);
    leds.push(mat);
    mesh(new THREE.BoxGeometry(0.012, 0.012, 0.004), mat, -0.08 + k * 0.03, 0.56, 0.252, tower);
  }
  solid(CONSOLE.x - 0.62, 0, CONSOLE.z - 0.62, CONSOLE.x + 0.62, 1.1, CONSOLE.z + 0.62);
  // Cables: from the console's back, along the floor, to the pylons' feet
  con.updateMatrixWorld(true);
  g.updateMatrixWorld(true);
  const back = new THREE.Vector3(0, 0.03, -0.31).applyMatrix4(con.matrix);
  const cableMats = [std({ color: 0x111111, roughness: 0.7 }), std({ color: 0x1a3a6a, roughness: 0.6 }), std({ color: 0x8a1a12, roughness: 0.6 })];
  for (let k = 0; k < 3; k++) {
    const a = ((k + 0.5) / N) * Math.PI * 2 + Math.PI * 0.67;
    const foot = new THREE.Vector3(R.x + Math.sin(a) * R.r, 0.03, R.z + Math.cos(a) * R.r);
    const start = back.clone().add(new THREE.Vector3((k - 1) * 0.08, 0, 0));
    const pts = [start, start.clone().lerp(foot, 0.35).add(new THREE.Vector3(0.12 * (k - 1), 0, 0.1)), start.clone().lerp(foot, 0.7).add(new THREE.Vector3(-0.1, 0, 0.08 * k)), foot];
    pts.forEach((p) => (p.y = 0.025 + k * 0.001));
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.018, 8), cableMats[k]);
  }
  // A cable tray from it up the wall to the ceiling's trays
  for (let k = 0; k < 3; k++) {
    const pts = [back.clone().setY(0.02), new THREE.Vector3(x1 - 0.15, 0.03, back.z + 0.2 * k - 0.2), new THREE.Vector3(x1 - 0.06, 0.5, back.z + 0.2 * k - 0.2), new THREE.Vector3(x1 - 0.06, h - 0.25, back.z + 0.2 * k - 0.2)];
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012, 6), cableMats[k]);
  }

  // =============================================================== specimen jars (east wall)
  {
    const cx = x1 - 0.42;
    const cz = 134.6;
    mesh(rbox(0.72, 0.88, 4.3, 0.03), M.blueGrey, cx, 0.44, cz);
    for (let k = 0; k < 4; k++) {
      mesh(rbox(0.012, 0.7, 1.0, 0.004), M.dark, cx - 0.36, 0.42, cz - 1.6 + k * 1.07);
      mesh(rbox(0.02, 0.02, 0.14, 0.006), M.steel, cx - 0.375, 0.68, cz - 1.6 + k * 1.07);
    }
    mesh(rbox(0.76, 0.04, 4.34, 0.012), M.brushed, cx, 0.9, cz);
    solid(cx - 0.38, 0, cz - 2.17, cx + 0.38, 0.92, cz + 2.17);
    const fluid = std({ color: 0x1a6a2a, emissive: 0x2ec050, emissiveIntensity: 0.75, transparent: true, opacity: 0.6, depthWrite: false, roughness: 0.1 });
    const flesh = new THREE.MeshPhysicalMaterial({ color: 0x9a5a6a, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const fleshB = new THREE.MeshPhysicalMaterial({ color: 0x6a6a8a, roughness: 0.3, clearcoat: 0.5 });
    const bubbleMat = std({ color: 0xc8ffd8, emissive: 0x70ff90, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, depthWrite: false });
    const bubbles: { m: THREE.Mesh; base: number; sp: number; ph: number }[] = [];
    for (let k = 0; k < 4; k++) {
      const z = cz - 1.6 + k * 1.07;
      const jar = add(new THREE.Group(), cx, 0.92, z);
      mesh(new THREE.CylinderGeometry(0.235, 0.25, 0.07, 48), M.dark, 0, 0.035, 0, jar);
      for (let b = 0; b < 8; b++) {
        const a = (b / 8) * Math.PI * 2;
        mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.015, 8), M.steel, Math.cos(a) * 0.215, 0.075, Math.sin(a) * 0.215, jar);
      }
      const gl = mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.64, 48, 1, true), M.glass, 0, 0.39, 0, jar);
      gl.renderOrder = 3;
      for (const yy of [0.075, 0.71]) {
        const rim = mesh(new THREE.TorusGeometry(0.207, 0.012, 10, 64), M.steel, 0, yy, 0, jar);
        rim.rotation.x = Math.PI / 2;
      }
      const fl = mesh(new THREE.CylinderGeometry(0.196, 0.196, 0.56, 48), fluid, 0, 0.35, 0, jar);
      fl.renderOrder = 2;
      mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.06, 48), M.dark, 0, 0.74, 0, jar);
      mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.06, 16), M.brushed, 0, 0.8, 0, jar);
      const valve = mesh(new THREE.TorusGeometry(0.035, 0.008, 8, 24), std({ color: 0xaa2020, roughness: 0.4 }), 0, 0.84, 0, jar);
      valve.rotation.x = Math.PI / 2;
      // A hose from the lid to the wall
      mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.82, 0), new THREE.Vector3(0.12, 0.95, 0), new THREE.Vector3(0.3, 0.9, 0.05), new THREE.Vector3(0.36, 0.6, 0.05)]), 24, 0.012, 8),
        std({ color: 0xc8d4d8, roughness: 0.3, transparent: true, opacity: 0.7 }),
        0,
        0,
        0,
        jar
      );
      const spec = add(new THREE.Group(), 0, 0.36, 0, jar);
      if (k === 0) {
        const pts: THREE.Vector3[] = [];
        for (let s = 0; s < 60; s++) {
          const a = s * 0.24;
          pts.push(new THREE.Vector3(Math.cos(a) * (0.12 - s * 0.0016), -0.22 + s * 0.0075, Math.sin(a) * (0.12 - s * 0.0016)));
        }
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.026, 16);
        // Taper it to a point
        const tp = tube.getAttribute('position') as THREE.BufferAttribute;
        const cen = new THREE.CatmullRomCurve3(pts);
        for (let i = 0; i < tp.count; i++) {
          const ring = Math.floor(i / 17);
          const u = ring / 160;
          const c0 = cen.getPointAt(Math.min(1, u));
          const v = new THREE.Vector3().fromBufferAttribute(tp, i).sub(c0).multiplyScalar(1 - u * 0.85).add(c0);
          tp.setXYZ(i, v.x, v.y, v.z);
        }
        tube.computeVertexNormals();
        spec.add(new THREE.Mesh(tube, flesh));
        // Suckers along it
        for (let s = 4; s < 54; s += 3) {
          const u = s / 60;
          const p = cen.getPointAt(u);
          const su = mesh(new THREE.TorusGeometry(0.009 * (1 - u * 0.7), 0.004, 6, 14), std({ color: 0xd8a0a8, roughness: 0.4 }), p.x * 1.18, p.y - 0.02, p.z * 1.18, spec);
          su.lookAt(new THREE.Vector3(p.x * 3, p.y, p.z * 3).add(jar.position));
        }
      } else if (k === 1) {
        const eyeTex = canvasTex(256, 128, (c) => {
          c.fillStyle = '#efe6d2';
          c.fillRect(0, 0, 256, 128);
          c.strokeStyle = 'rgba(170,30,30,0.6)';
          for (let v = 0; v < 26; v++) {
            c.lineWidth = 0.6 + Math.random();
            let x = Math.random() * 256;
            let y = 128;
            c.beginPath();
            c.moveTo(x, y);
            for (let s = 0; s < 8; s++) {
              x += (Math.random() - 0.5) * 18;
              y -= 6 + Math.random() * 6;
              c.lineTo(x, y);
            }
            c.stroke();
          }
        });
        const eye = mesh(new THREE.SphereGeometry(0.13, 48, 32), new THREE.MeshPhysicalMaterial({ map: eyeTex, roughness: 0.2, clearcoat: 1 }), 0, 0, 0, spec);
        const iris = mesh(new THREE.SphereGeometry(0.131, 48, 16, 0, Math.PI * 2, 0, 0.5), std({ color: 0xc87a10, emissive: 0x6a3000, emissiveIntensity: 0.6, roughness: 0.3 }), 0, 0, 0, eye);
        iris.rotation.x = Math.PI / 2;
        const pupil = mesh(new THREE.SphereGeometry(0.132, 32, 8, -0.06, 0.12, 0, 0.42), std({ color: 0x050505, roughness: 0.2 }), 0, 0, 0, eye);
        pupil.rotation.x = Math.PI / 2;
        // The nerve trailing off it
        mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -0.12), new THREE.Vector3(0.03, -0.08, -0.2), new THREE.Vector3(-0.02, -0.18, -0.18)]), 24, 0.018, 10), flesh, 0, 0, 0, eye);
        eye.rotation.y = 0.7;
        specimens.push(eye);
      } else if (k === 2) {
        // A claw: three hooked, jointed segments on a knuckle
        mesh(lumpGeo(0.05, 0.15, 3, 3), fleshB, 0, -0.17, 0, spec);
        for (let f = 0; f < 3; f++) {
          const finger = add(new THREE.Group(), (f - 1) * 0.04, -0.14, 0, spec);
          finger.rotation.z = (f - 1) * 0.25;
          let y = 0;
          for (let s = 0; s < 3; s++) {
            const len = 0.09 - s * 0.018;
            const seg = mesh(new THREE.CapsuleGeometry(0.016 - s * 0.003, len, 6, 14), fleshB, 0, y + len / 2, s * 0.012, finger);
            seg.rotation.x = s * 0.35;
            y += len * 0.95;
          }
          const nail = mesh(new THREE.ConeGeometry(0.01, 0.06, 14), std({ color: 0x1a1a1a, roughness: 0.25, metalness: 0.2 }), 0, y + 0.03, 0.05, finger);
          nail.rotation.x = 0.8;
        }
      } else {
        const lump = mesh(lumpGeo(0.12, 0.3, 7, 5, 1.25), flesh, 0, 0, 0, spec);
        specimens.push(lump);
        // Veins over it
        for (let v = 0; v < 5; v++) {
          const pts: THREE.Vector3[] = [];
          const a = v * 1.3;
          for (let s = 0; s < 8; s++) {
            const th = -1.1 + s * 0.3;
            pts.push(new THREE.Vector3(Math.cos(a + s * 0.15) * Math.cos(th) * 0.135, Math.sin(th) * 0.16, Math.sin(a + s * 0.15) * Math.cos(th) * 0.135));
          }
          mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.004, 6), std({ color: 0x3a1a4a, roughness: 0.4 }), 0, 0, 0, lump);
        }
      }
      for (let b = 0; b < 6; b++) {
        const m = mesh(new THREE.SphereGeometry(0.008 + hash(k, b) * 0.008, 10, 8), bubbleMat, (hash(b, k) - 0.5) * 0.25, 0.1, (hash(k + 3, b) - 0.5) * 0.25, jar);
        bubbles.push({ m, base: 0.1, sp: 0.05 + hash(b, k + 9) * 0.07, ph: hash(k, b + 4) });
      }
      // Its label
      const lt = canvasTex(256, 64, (c) => {
        c.fillStyle = '#efece0';
        c.fillRect(0, 0, 256, 64);
        c.fillStyle = '#c02020';
        c.fillRect(0, 0, 256, 10);
        c.fillStyle = '#222';
        c.font = 'bold 26px "Courier New", monospace';
        c.fillText(`SPC-${410 + k * 7}-${'ABCD'[k]}`, 12, 44);
      });
      const label = mesh(new THREE.PlaneGeometry(0.2, 0.05), std({ map: lt, roughness: 0.8 }), -0.21, 0.16, 0, jar);
      label.rotation.y = -Math.PI / 2;
    }
    updates.push((t) => {
      for (const b of bubbles) {
        const u = (t * b.sp + b.ph) % 1;
        b.m.position.y = 0.1 + u * 0.52;
        b.m.position.x += Math.sin(t * 3 + b.ph * 10) * 0.0003;
      }
    });
  }

  // =============================================================== rock samples (west wall)
  {
    const sx = x0 + 0.28;
    const sz = 134.0;
    const L = 3.2;
    for (const dz of [-L / 2, -L / 6, L / 6, L / 2]) {
      for (const dx of [-0.2, 0.2]) mesh(rbox(0.035, 2.0, 0.035, 0.008), M.steel, sx + dx, 1.0, sz + dz);
    }
    for (const y of [0.12, 0.7, 1.3, 1.9]) {
      mesh(rbox(0.46, 0.025, L + 0.06, 0.008), M.brushed, sx, y, sz);
      for (const dx of [-0.225, 0.225]) mesh(new THREE.BoxGeometry(0.01, 0.04, L + 0.06), M.steel, sx + dx, y + 0.02, sz);
      if (y < 0.2) continue;
      for (let k = 0; k < 6; k++) {
        const z = sz - L / 2 + 0.3 + k * 0.52;
        const purple = (k + Math.round(y * 10)) % 3 === 0;
        const seed = k * 7 + y * 13;
        if (purple) {
          // A crystal cluster on a lump of matrix
          const base = mesh(lumpGeo(0.06, 0.35, seed, 3, 0.6), M.dark, sx, y + 0.045, z);
          const cm = std({ color: 0x5a2a7a, emissive: 0x7a20c0, emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.1 });
          for (let c = 0; c < 6; c++) {
            const cr = mesh(new THREE.CylinderGeometry(0, 0.016 + hash(c, seed) * 0.01, 0.07 + hash(seed, c) * 0.08, 6), cm, (hash(c, 1) - 0.5) * 0.06, 0.04, (hash(c, 2) - 0.5) * 0.06, base);
            cr.rotation.set((hash(c, 3) - 0.5) * 0.9, 0, (hash(c, 4) - 0.5) * 0.9);
          }
        } else {
          const r = mesh(lumpGeo(0.05 + hash(seed, 1) * 0.05, 0.4, seed, 4, 0.7), std({ color: [0x5a5048, 0x6a6a64, 0x3a3430][k % 3], roughness: 0.85, flatShading: false }), sx, y + 0.05, z);
          r.rotation.y = seed;
        }
        const tag = mesh(rbox(0.008, 0.035, 0.08, 0.002), std({ color: 0xe8e4d8, roughness: 0.8 }), sx + 0.235, y + 0.03, z);
        void tag;
      }
      // A sample bag or two
      const bag = mesh(lumpGeo(0.07, 0.2, y * 3, 2, 0.5), std({ color: 0xd8dccc, roughness: 0.4, transparent: true, opacity: 0.8 }), sx - 0.05, y + 0.04, sz + L / 2 - 0.12);
      void bag;
    }
    solid(x0, 0, sz - L / 2 - 0.05, x0 + 0.52, 2.0, sz + L / 2 + 0.05);
  }

  // =============================================================== locker (NW corner)
  {
    const lx = x0 + 0.42;
    const lz = z0 + 0.38;
    const lk = add(new THREE.Group(), lx, 0, lz);
    const lm = std({ color: 0x4a5a6a, roughness: 0.42, metalness: 0.55 });
    mesh(rbox(0.62, 1.92, 0.52, 0.02), lm, 0, 0.96, 0, lk);
    for (const s of [-1, 1]) {
      mesh(rbox(0.29, 1.8, 0.012, 0.006), lm, s * 0.152, 0.98, 0.262, lk);
      for (let k = 0; k < 6; k++) mesh(new THREE.BoxGeometry(0.18, 0.012, 0.006), M.darker, s * 0.152, 1.6 + k * 0.035, 0.27, lk);
      mesh(rbox(0.025, 0.16, 0.03, 0.006), M.steel, s * 0.03, 1.0, 0.28, lk);
      for (const y of [0.3, 1.65]) mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 10), M.steel, s * 0.3, y, 0.265, lk);
    }
    const nt = canvasTex(128, 32, (c) => {
      c.fillStyle = '#e8e4d0';
      c.fillRect(0, 0, 128, 32);
      c.fillStyle = '#222';
      c.font = 'bold 18px Arial';
      c.fillText('MAREK', 30, 23);
    });
    mesh(new THREE.PlaneGeometry(0.12, 0.03), std({ map: nt }), -0.152, 1.85, 0.27, lk);
    // The spare helmet on top
    const hm = new THREE.MeshPhysicalMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.2, clearcoat: 0.8 });
    const helm = mesh(new THREE.SphereGeometry(0.16, 48, 32), hm, 0, 2.08, 0, lk);
    helm.scale.set(1, 1.08, 1.05);
    const vis = mesh(new THREE.SphereGeometry(0.135, 48, 24, -1.0, 2.0, 0.85, 0.95), new THREE.MeshPhysicalMaterial({ color: 0xd99a22, roughness: 0.05, metalness: 1, clearcoat: 1 }), 0, 0.0, 0.035, helm);
    void vis;
    const ring = mesh(new THREE.TorusGeometry(0.13, 0.022, 12, 48), M.dark, 0, -0.12, 0, helm);
    ring.rotation.x = Math.PI / 2;
    solid(x0, 0, z0, x0 + 0.75, 1.92, z0 + 0.66);
  }

  // =============================================================== cot (west side)
  {
    const cx = -2.2;
    const cz = 134.4;
    const frame: THREE.Vector3[] = [];
    const hw = 0.36;
    const hl = 0.94;
    for (const [x, z] of [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl], [-hw, -hl]]) frame.push(new THREE.Vector3(cx + x, 0.42, cz + z));
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(frame, true, 'catmullrom', 0.02), 80, 0.017, 10, true), std({ color: 0x5a6a5a, roughness: 0.4, metalness: 0.6 }));
    for (const s of [-1, 1])
      for (const t of [-0.85, 0, 0.85]) {
        // X legs
        const leg = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 10), M.steel, cx + s * 0.3, 0.21, cz + t);
        leg.rotation.x = s * 0.35;
        mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), M.rubber, cx + s * 0.3, 0.01, cz + t + s * 0.08);
      }
    // The canvas, sagging
    const can = new THREE.PlaneGeometry(hw * 2 - 0.02, hl * 2 - 0.02, 16, 40);
    can.rotateX(-Math.PI / 2);
    const cp = can.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i) / hw;
      const z = cp.getZ(i) / hl;
      cp.setY(i, -0.05 * (1 - x * x) * (1 - z * z * 0.6));
    }
    can.computeVertexNormals();
    mesh(can, std({ color: 0x4a5a3a, roughness: 0.95, side: THREE.DoubleSide }), cx, 0.43, cz);
    // The blanket, thrown back, rumpled; the pillow, dented
    const bl = new THREE.PlaneGeometry(0.8, 1.15, 40, 56);
    bl.rotateX(-Math.PI / 2);
    const bp = bl.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      const z = bp.getZ(i);
      let y = 0.03 + noise3(x * 8, z * 6, 1) * 0.025 + Math.max(0, Math.sin(z * 9 + x * 3)) * 0.03;
      if (Math.abs(x) > 0.36) y -= (Math.abs(x) - 0.36) * 1.6;
      // Folded back at the head end
      if (z < -0.4) y += (-0.4 - z) * 0.6;
      bp.setY(i, y);
    }
    bl.computeVertexNormals();
    const blanketTex = canvasTex(256, 256, (c) => {
      c.fillStyle = '#7a3a22';
      c.fillRect(0, 0, 256, 256);
      c.strokeStyle = 'rgba(30,10,5,0.4)';
      c.lineWidth = 6;
      for (let k = 0; k < 256; k += 32) {
        c.beginPath();
        c.moveTo(k, 0);
        c.lineTo(k, 256);
        c.stroke();
        c.beginPath();
        c.moveTo(0, k);
        c.lineTo(256, k);
        c.stroke();
      }
    });
    mesh(bl, std({ map: blanketTex, roughness: 0.95, side: THREE.DoubleSide }), cx, 0.4, cz + 0.32);
    const pil = rbox(0.5, 0.12, 0.32, 0.05, 5);
    const pp = pil.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i);
      const z = pp.getZ(i);
      if (pp.getY(i) > 0) pp.setY(i, pp.getY(i) - Math.exp(-((x * x) / 0.02 + (z * z) / 0.015)) * 0.05);
    }
    pil.computeVertexNormals();
    mesh(pil, std({ color: 0xe0dccf, roughness: 0.95 }), cx, 0.5, cz - 0.72);
    solid(cx - 0.38, 0, cz - 0.96, cx + 0.38, 0.45, cz + 0.96);
  }

  // =============================================================== desk, chair, laptop — and the meal
  const dx = 2.25;
  const dz = 135.55;
  {
    const top = mesh(rbox(1.3, 0.04, 0.66, 0.015), M.wood, dx, 0.76, dz);
    void top;
    mesh(rbox(0.42, 0.72, 0.6, 0.015), M.dark, dx + 0.42, 0.37, dz);
    for (let k = 0; k < 3; k++) {
      mesh(rbox(0.38, 0.2, 0.012, 0.005), M.blueGrey, dx + 0.42, 0.16 + k * 0.22, dz - 0.305);
      mesh(rbox(0.1, 0.015, 0.025, 0.006), M.steel, dx + 0.42, 0.22 + k * 0.22, dz - 0.32);
    }
    for (const sz of [-1, 1]) mesh(rbox(0.04, 0.72, 0.04, 0.01), M.steel, dx - 0.6, 0.37, dz + sz * 0.28);
    solid(dx - 0.65, 0, dz - 0.33, dx + 0.65, 0.78, dz + 0.33);
    // Chair, pushed back from it, turned a little — somebody got up
    const ch = add(new THREE.Group(), dx - 0.15, 0, dz - 0.75);
    ch.rotation.y = 2.7;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const leg = mesh(rbox(0.3, 0.03, 0.04, 0.01), M.darker, Math.cos(a) * 0.15, 0.07, Math.sin(a) * 0.15, ch);
      leg.rotation.y = -a;
      mesh(new THREE.SphereGeometry(0.025, 12, 10), M.rubber, Math.cos(a) * 0.29, 0.025, Math.sin(a) * 0.29, ch);
    }
    mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.36, 16), M.steel, 0, 0.26, 0, ch);
    mesh(rbox(0.46, 0.07, 0.44, 0.03, 4), std({ color: 0x23262a, roughness: 0.8 }), 0, 0.47, 0, ch);
    const backr = mesh(rbox(0.44, 0.5, 0.06, 0.03, 4), std({ color: 0x23262a, roughness: 0.8 }), 0, 0.8, 0.2, ch);
    backr.rotation.x = -0.12;
    for (const s of [-1, 1]) mesh(rbox(0.04, 0.03, 0.26, 0.01), M.darker, s * 0.24, 0.62, 0.02, ch);
    // The laptop, open, still on
    const lap = add(new THREE.Group(), dx - 0.2, 0.78, dz + 0.02);
    lap.rotation.y = Math.PI + 0.15;
    mesh(rbox(0.34, 0.016, 0.24, 0.006), M.brushed, 0, 0.008, 0, lap);
    const kt = canvasTex(256, 128, (c) => {
      c.fillStyle = '#1a1c1f';
      c.fillRect(0, 0, 256, 128);
      c.fillStyle = '#2c2f33';
      for (let r = 0; r < 5; r++) for (let k = 0; k < 14; k++) c.fillRect(8 + k * 17.5 + (r % 2) * 4, 8 + r * 15, 15, 13);
      c.fillRect(70, 86, 116, 13);
      c.fillStyle = '#2a2d31';
      c.fillRect(90, 104, 76, 20);
    });
    const kp = mesh(new THREE.PlaneGeometry(0.31, 0.15), std({ map: kt, roughness: 0.7 }), 0, 0.0165, 0.035, lap);
    kp.rotation.x = -Math.PI / 2;
    kp.rotation.z = Math.PI;
    const lidG = add(new THREE.Group(), 0, 0.016, 0.12, lap);
    lidG.rotation.x = -1.85;
    mesh(rbox(0.34, 0.22, 0.01, 0.006), M.brushed, 0, 0.11, 0, lidG);
    const lst = canvasTex(320, 200, (c) => {
      c.fillStyle = '#04120c';
      c.fillRect(0, 0, 320, 200);
      c.fillStyle = '#4dff8a';
      c.font = '13px "Courier New", monospace';
      ['SURVEY LOG 0417', 'DRONE-2 SIGNAL LOST', 'BIO-SIGNS: CANYON N', 'MAREK — MEADOW, 06:40?', 'GONE TO LOOK. BACK SOON.', '— D.'].forEach((s, i) => c.fillText(s, 12, 24 + i * 22));
    });
    const ls = mesh(new THREE.PlaneGeometry(0.31, 0.19), new THREE.MeshBasicMaterial({ map: lst, toneMapped: false }), 0, 0.11, -0.0055, lidG);
    ls.rotation.y = Math.PI;
    // Papers, a pen
    const paperM = std({ color: 0xeeeae0, roughness: 0.9, side: THREE.DoubleSide });
    for (let k = 0; k < 4; k++) {
      const pp2 = mesh(new THREE.PlaneGeometry(0.21, 0.29), paperM, dx + 0.36 + (k % 2) * 0.04, 0.782 + k * 0.0015, dz + 0.08 - k * 0.03);
      pp2.rotation.set(-Math.PI / 2, 0, (k - 1.5) * 0.3);
    }
    const pen = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 10), std({ color: 0x1a3aa0, roughness: 0.3 }), dx + 0.3, 0.79, dz - 0.1);
    pen.rotation.set(Math.PI / 2, 0, 0.6);
    // A desk lamp: weighted foot, two arms, the shade, the bulb lit
    const lampG = add(new THREE.Group(), dx + 0.5, 0.78, dz + 0.2);
    mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 32), M.darker, 0, 0.01, 0, lampG);
    const a1 = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 10), M.steel, -0.04, 0.15, 0, lampG);
    a1.rotation.z = 0.3;
    const a2 = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 10), M.steel, -0.16, 0.32, 0, lampG);
    a2.rotation.z = 1.2;
    const shade = mesh(new THREE.ConeGeometry(0.06, 0.1, 32, 1, true), std({ color: 0xd8b21c, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }), -0.28, 0.33, 0, lampG);
    shade.rotation.z = 2.4;
    mesh(new THREE.SphereGeometry(0.022, 16, 12), glow(0xfff0c0, 0xffe0a0, 2.5), -0.27, 0.32, 0, lampG);

  }
  // ---- The meal: a plate with half a sandwich (bitten), crumbs, a fork; a mug, still steaming; a crushed chip bag
  const steamAt = new THREE.Vector3();
  {
    const top = 0.78;
    const plate = add(new THREE.Group(), dx - 0.32, top, dz - 0.18);
    const ceramic = new THREE.MeshPhysicalMaterial({ color: 0xf2f0ea, roughness: 0.25, clearcoat: 0.8 });
    const plateGeo = new THREE.LatheGeometry(
      [
        [0, 0.002],
        [0.08, 0.002],
        [0.095, 0.008],
        [0.12, 0.016],
        [0.125, 0.018],
        [0.12, 0.019],
        [0.095, 0.011],
        [0.08, 0.006],
        [0, 0.006]
      ].map(([x, y]) => new THREE.Vector2(x, y)),
      64
    );
    mesh(plateGeo, ceramic, 0, 0, 0, plate);
    // The half sandwich: bread, lettuce, cheese, ham, bread — a bite out of its long side
    const r = 0.028;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.12, 0);
    const mx = 0.06;
    const my = 0.06;
    const ux = -Math.SQRT1_2;
    const uy = Math.SQRT1_2;
    shape.lineTo(mx - ux * r, my - uy * r);
    shape.absarc(mx, my, r, -Math.PI / 4, (3 * Math.PI) / 4, true);
    shape.lineTo(0, 0.12);
    shape.closePath();
    const slab = (d: number, bevel: number): THREE.ExtrudeGeometry => {
      const e = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 24 });
      e.rotateX(-Math.PI / 2);
      e.translate(-0.045, 0, 0.045);
      return e;
    };
    const breadIn = std({ color: 0xe8d3a0, roughness: 0.95 });
    const crust = std({ color: 0xa8662a, roughness: 0.8 });
    const sand = add(new THREE.Group(), 0, 0.012, 0, plate);
    sand.rotation.y = 0.5;
    mesh(slab(0.008, 0.004), [crust, breadIn], 0, 0.004, 0, sand);
    const lettuce = slab(0.002, 0.003);
    const lp = lettuce.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) lp.setY(i, lp.getY(i) + Math.sin(lp.getX(i) * 140) * 0.002);
    const lt = mesh(lettuce, std({ color: 0x5aa03a, roughness: 0.6 }), 0, 0.017, 0, sand);
    lt.scale.set(1.06, 1, 1.06);
    mesh(slab(0.002, 0.001), std({ color: 0xf0c030, roughness: 0.5 }), 0.004, 0.021, -0.004, sand);
    mesh(slab(0.004, 0.002), std({ color: 0xd88a8a, roughness: 0.55 }), -0.002, 0.024, 0.002, sand);
    mesh(slab(0.008, 0.004), [crust, breadIn], 0, 0.032, 0, sand);
    // Crumbs on the plate and the desk
    const crumbs = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.003, 0), std({ color: 0xc89a5a, roughness: 0.9 }), 40);
    for (let k = 0; k < 40; k++) {
      const a = hash(k, 1) * Math.PI * 2;
      const rr = k < 25 ? 0.03 + hash(k, 2) * 0.07 : 0.13 + hash(k, 2) * 0.12;
      m4.compose(new THREE.Vector3(Math.cos(a) * rr, k < 25 ? 0.009 : 0.001, Math.sin(a) * rr), new THREE.Quaternion().setFromEuler(new THREE.Euler(a, a * 2, 0)), new THREE.Vector3(1, 0.6, 1).multiplyScalar(0.6 + hash(k, 3)));
      crumbs.setMatrixAt(k, m4);
    }
    plate.add(crumbs);
    // A fork across the plate's edge
    const fork = add(new THREE.Group(), 0.06, 0.02, 0.05, plate);
    fork.rotation.set(0, -0.7, 0.04);
    mesh(rbox(0.012, 0.003, 0.11, 0.0015, 2), M.steel, 0, 0, 0.04, fork);
    for (let k = 0; k < 4; k++) mesh(rbox(0.0022, 0.0025, 0.04, 0.001, 2), M.steel, -0.0045 + k * 0.003, 0, -0.035, fork);
    mesh(rbox(0.014, 0.003, 0.02, 0.0015, 2), M.steel, 0, 0, -0.012, fork);

    // The mug: walls with thickness, a handle, coffee in it
    const mugG = add(new THREE.Group(), dx + 0.05, top, dz - 0.2);
    const mugProf = [
      [0, 0],
      [0.038, 0],
      [0.042, 0.004],
      [0.044, 0.1],
      [0.046, 0.104],
      [0.041, 0.104],
      [0.039, 0.1],
      [0.037, 0.01],
      [0, 0.01]
    ].map(([x, y]) => new THREE.Vector2(x, y));
    mesh(new THREE.LatheGeometry(mugProf, 48), new THREE.MeshPhysicalMaterial({ color: 0x2a6a9a, roughness: 0.3, clearcoat: 0.7 }), 0, 0, 0, mugG);
    const handle = mesh(new THREE.TorusGeometry(0.03, 0.007, 12, 32, Math.PI * 1.15), new THREE.MeshPhysicalMaterial({ color: 0x2a6a9a, roughness: 0.3, clearcoat: 0.7 }), 0.044, 0.055, 0, mugG);
    handle.rotation.z = -Math.PI * 0.57;
    const coffee = mesh(new THREE.CircleGeometry(0.038, 32), new THREE.MeshPhysicalMaterial({ color: 0x2a140a, roughness: 0.05, clearcoat: 1 }), 0, 0.085, 0, mugG);
    coffee.rotation.x = -Math.PI / 2;
    steamAt.set(dx + 0.05, top + 0.09, dz - 0.2);
    // A crushed bag of chips: foil, crumpled, open, a few spilled
    const bag = mesh(lumpGeo(0.06, 0.45, 11, 3, 0.35), new THREE.MeshStandardMaterial({ color: 0xc83a20, roughness: 0.25, metalness: 0.7 }), dx + 0.15, top + 0.02, dz + 0.22);
    bag.scale.set(1.4, 1, 0.9);
    bag.rotation.y = 0.8;
    const chip = new THREE.SphereGeometry(0.014, 12, 6, 0, Math.PI * 2, 0, 0.9);
    for (let k = 0; k < 5; k++) {
      const c = mesh(chip, std({ color: 0xe0b050, roughness: 0.6, side: THREE.DoubleSide }), dx + 0.06 + hash(k, 5) * 0.12, top + 0.004, dz + 0.12 + hash(k, 6) * 0.08);
      c.rotation.set(Math.PI + hash(k, 7) * 0.5, hash(k, 8) * 3, 0);
      c.scale.y = 0.4;
    }
  }
  // ---- On the crates: a ration tray, half eaten, the foil peeled back, a spork in it; a soda can
  const crateX = x1 - 0.72;
  const crateZ = z1 - 0.46;
  {
    const crateTex = canvasTex(256, 192, (c) => {
      c.fillStyle = '#5a6070';
      c.fillRect(0, 0, 256, 192);
      for (let k = 0; k < 600; k++) {
        c.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
        c.fillRect(Math.random() * 256, Math.random() * 192, 2 + Math.random() * 10, 1 + Math.random() * 2);
      }
    });
    const stencil = canvasTex(256, 160, (c) => {
      c.fillStyle = 'rgba(240,240,230,0.85)';
      c.font = 'bold 40px "Courier New", monospace';
      c.textAlign = 'center';
      c.fillText('SURVEY', 128, 60);
      c.font = 'bold 24px "Courier New", monospace';
      c.fillText('RATIONS · 24', 128, 98);
      c.fillText('THIS SIDE UP ↑', 128, 134);
    });
    const stMat = new THREE.MeshStandardMaterial({ map: stencil, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    const cm = std({ map: crateTex, roughness: 0.6, metalness: 0.3 });
    const crate = (w: number, hh: number, d: number, x: number, y: number, z: number, ry: number): void => {
      const c = add(new THREE.Group(), x, y, z);
      c.rotation.y = ry;
      mesh(rbox(w, hh, d, 0.02), cm, 0, 0, 0, c);
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1]) mesh(rbox(0.06, 0.06, 0.06, 0.012), M.dark, (sx * (w - 0.05)) / 2, (sy * (hh - 0.05)) / 2, (sz * (d - 0.05)) / 2, c);
      for (const sx of [-0.25, 0.25]) mesh(rbox(0.04, hh + 0.006, d + 0.006, 0.004), std({ color: 0x1a1a1a, roughness: 0.8 }), sx * w, 0, 0, c);
      const front = mesh(new THREE.PlaneGeometry(w * 0.42, hh * 0.6), stMat, 0, 0, -d / 2 - 0.002, c);
      front.rotation.y = Math.PI;
      const side = mesh(new THREE.PlaneGeometry(d * 0.6, hh * 0.6), stMat, -w / 2 - 0.002, 0, 0, c);
      side.rotation.y = -Math.PI / 2;
    };
    crate(0.82, 0.6, 0.6, crateX, 0.3, crateZ, 0);
    crate(0.6, 0.44, 0.48, crateX - 0.04, 0.82, crateZ, 0.18);
    solid(crateX - 0.42, 0, crateZ - 0.31, crateX + 0.42, 1.05, crateZ + 0.31);
    const tray = add(new THREE.Group(), crateX - 0.05, 1.045, crateZ + 0.02);
    tray.rotation.y = -0.3;
    const foil = std({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.9 });
    mesh(rbox(0.26, 0.035, 0.18, 0.008), std({ color: 0x5a6a4a, roughness: 0.6 }), 0, 0.0175, 0, tray);
    // Its compartments: a stew, mash, peas
    const stew = mesh(lumpGeo(0.05, 0.25, 21, 3, 0.25), std({ color: 0x6a3a1a, roughness: 0.35 }), -0.06, 0.03, 0, tray);
    stew.scale.set(1.1, 1, 1.4);
    const mash = mesh(lumpGeo(0.035, 0.3, 4, 3, 0.45), std({ color: 0xe8dcb0, roughness: 0.8 }), 0.07, 0.035, -0.04, tray);
    void mash;
    const peas = new THREE.InstancedMesh(new THREE.SphereGeometry(0.006, 10, 8), std({ color: 0x5aa030, roughness: 0.5 }), 14);
    for (let k = 0; k < 14; k++) {
      m4.makeTranslation(0.05 + hash(k, 1) * 0.06, 0.036 + hash(k, 3) * 0.004, 0.02 + hash(k, 2) * 0.05);
      peas.setMatrixAt(k, m4);
    }
    tray.add(peas);
    // The foil lid, peeled back and curling
    const lid = new THREE.PlaneGeometry(0.26, 0.18, 20, 12);
    const lp = lid.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) {
      const y = lp.getY(i) + 0.09;
      const a = y * 9;
      lp.setXYZ(i, lp.getX(i) + Math.sin(lp.getY(i) * 30) * 0.002, Math.sin(a) / 9, -(1 - Math.cos(a)) / 9);
    }
    lid.computeVertexNormals();
    mesh(lid, new THREE.MeshStandardMaterial({ color: 0xd0d4d8, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide }), 0, 0.036, 0.09, tray);
    const spork = add(new THREE.Group(), 0.0, 0.05, -0.02, tray);
    spork.rotation.set(0.35, 0.9, 0);
    mesh(rbox(0.012, 0.004, 0.12, 0.002, 2), std({ color: 0xd8d0c0, roughness: 0.5 }), 0, 0, 0.05, spork);
    const bowl = mesh(new THREE.SphereGeometry(0.018, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std({ color: 0xd8d0c0, roughness: 0.5, side: THREE.DoubleSide }), 0, 0.004, -0.02, spork);
    bowl.scale.set(0.8, 0.4, 1.1);
    void foil;
    // A soda can, opened, beside the tray
    const canG = add(new THREE.Group(), crateX + 0.2, 1.04, crateZ - 0.1);
    const canTex = canvasTex(256, 128, (c) => {
      const gr = c.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, '#d82020');
      gr.addColorStop(1, '#801010');
      c.fillStyle = gr;
      c.fillRect(0, 0, 256, 128);
      c.fillStyle = '#fff';
      c.font = 'italic bold 44px Arial';
      c.fillText('FIZZ', 70, 80);
      c.fillRect(0, 100, 256, 6);
    });
    const canProf = [
      [0, 0],
      [0.026, 0],
      [0.032, 0.008],
      [0.033, 0.11],
      [0.027, 0.12],
      [0.026, 0.122],
      [0, 0.12]
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const cg = new THREE.LatheGeometry(canProf, 48);
    mesh(cg, std({ map: canTex, roughness: 0.25, metalness: 0.7 }), 0, 0, 0, canG);
    const tab = mesh(rbox(0.012, 0.002, 0.02, 0.001, 2), M.steel, 0, 0.123, 0.008, canG);
    tab.rotation.x = -0.4;
    mesh(new THREE.CircleGeometry(0.006, 16), M.darker, 0, 0.1215, -0.012, canG).rotation.x = -Math.PI / 2;
  }
  // ---- The bench at the south wall: drawers, a microscope, sample tubes, an apple core
  {
    const bx = -0.75;
    const bz = z1 - 0.38;
    mesh(rbox(2.6, 0.05, 0.7, 0.015), std({ color: 0x2e3338, roughness: 0.35, metalness: 0.5 }), bx, 0.9, bz);
    mesh(rbox(2.5, 0.84, 0.62, 0.02), M.blueGrey, bx, 0.43, bz + 0.02);
    for (let k = 0; k < 4; k++) {
      mesh(rbox(0.58, 0.36, 0.012, 0.005), M.dark, bx - 0.93 + k * 0.62, 0.62, bz - 0.295);
      mesh(rbox(0.14, 0.018, 0.025, 0.006), M.steel, bx - 0.93 + k * 0.62, 0.7, bz - 0.31);
      mesh(rbox(0.58, 0.36, 0.012, 0.005), M.dark, bx - 0.93 + k * 0.62, 0.22, bz - 0.295);
    }
    solid(bx - 1.3, 0, bz - 0.35, bx + 1.3, 0.93, bz + 0.35);
    // Microscope: foot, pillar, arm, stage with clips, turret of objectives, head, eyepieces
    const mic = add(new THREE.Group(), bx + 0.55, 0.925, bz - 0.02);
    mic.rotation.y = Math.PI + 0.3;
    const micM = new THREE.MeshPhysicalMaterial({ color: 0xeceae6, roughness: 0.35, clearcoat: 0.5 });
    mesh(rbox(0.18, 0.03, 0.22, 0.012), micM, 0, 0.015, 0, mic);
    const armGeo = new THREE.TorusGeometry(0.11, 0.022, 12, 32, Math.PI * 0.7);
    const arm = mesh(armGeo, micM, 0, 0.14, 0.07, mic);
    arm.rotation.set(0, Math.PI / 2, 0.4);
    mesh(rbox(0.13, 0.012, 0.11, 0.004), M.darker, 0, 0.12, -0.01, mic);
    for (const s of [-1, 1]) mesh(rbox(0.008, 0.004, 0.05, 0.002), M.steel, s * 0.04, 0.128, -0.02, mic);
    mesh(rbox(0.076, 0.026, 0.002, 0.0005), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0 }), 0, 0.128, -0.01, mic).rotation.x = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 32), M.darker, 0, 0.2, -0.01, mic);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.04, 16), M.steel, Math.cos(a) * 0.018, 0.175, -0.01 + Math.sin(a) * 0.018, mic);
    }
    const head = mesh(rbox(0.07, 0.05, 0.09, 0.015), micM, 0, 0.235, 0.0, mic);
    void head;
    for (const s of [-1, 1]) {
      const ep = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 20), M.darker, s * 0.018, 0.28, 0.035, mic);
      ep.rotation.x = -0.5;
    }
    for (const s of [-1, 1]) {
      const kn = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 24), M.darker, s * 0.06, 0.08, 0.07, mic);
      kn.rotation.z = Math.PI / 2;
    }
    // A rack of sample tubes, coloured fluids
    const rack = add(new THREE.Group(), bx - 0.25, 0.925, bz + 0.05);
    mesh(rbox(0.3, 0.012, 0.08, 0.004), M.steel, 0, 0.005, 0, rack);
    mesh(rbox(0.3, 0.012, 0.08, 0.004), M.steel, 0, 0.07, 0, rack);
    for (const s of [-1, 1]) mesh(rbox(0.01, 0.075, 0.08, 0.003), M.steel, s * 0.145, 0.037, 0, rack);
    const cols = [0x40ff80, 0xff6040, 0x60a0ff, 0xffd040, 0xc040ff, 0x40ff80];
    cols.forEach((col, i) => {
      const x = -0.12 + i * 0.048;
      const tube = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.11, 16, 1, true), M.glass, x, 0.06, 0, rack);
      tube.renderOrder = 3;
      mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.05 + (i % 3) * 0.015, 16), std({ color: col, emissive: col, emissiveIntensity: 0.35, transparent: true, opacity: 0.8 }), x, 0.03 + (i % 3) * 0.0075, 0, rack);
      mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.014, 16), std({ color: [0xd03030, 0x3060d0, 0xe0e0e0][i % 3], roughness: 0.5 }), x, 0.12, 0, rack);
    });
    // The bench's own screen: the atmosphere, on a stand
    const scrTex = canvasTex(512, 320, (c) => {
      c.fillStyle = '#04100a';
      c.fillRect(0, 0, 512, 320);
      c.strokeStyle = '#4dff8a';
      c.lineWidth = 3;
      c.beginPath();
      for (let x = 0; x < 512; x += 2) c.lineTo(x, 160 + Math.sin(x * 0.04) * 60 * Math.sin(x * 0.0065));
      c.stroke();
      c.fillStyle = '#4dff8a';
      c.font = '24px "Courier New", monospace';
      c.fillText('ATMOS 0.71 bar  O2 19.8%', 16, 36);
      c.fillText('SAMPLE 4C — LIVE TISSUE', 16, 296);
    });
    const sm = add(new THREE.Group(), bx - 0.85, 0.925, bz + 0.12);
    sm.rotation.y = Math.PI;
    mesh(rbox(0.2, 0.015, 0.14, 0.005), M.darker, 0, 0.008, 0, sm);
    mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 12), M.steel, 0, 0.12, 0.02, sm);
    mesh(rbox(0.62, 0.4, 0.03, 0.012), M.darker, 0, 0.36, 0.01, sm);
    mesh(new THREE.PlaneGeometry(0.58, 0.36), new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false }), 0, 0.36, -0.0055, sm).rotation.y = Math.PI;
    // An apple core by the microscope, browning
    const core = add(new THREE.Group(), bx + 0.2, 0.925, bz - 0.18);
    core.rotation.z = Math.PI / 2;
    const v2 = (a: number[][]): THREE.Vector2[] => a.map(([x, y]) => new THREE.Vector2(x, y));
    const skin = new THREE.MeshPhysicalMaterial({ color: 0xb01c14, roughness: 0.35, clearcoat: 0.6 });
    const fleshM = std({ color: 0xe9d6a0, roughness: 0.75 });
    // Bottom: skin round to the bitten edge; the bitten-in waist, flesh browning; top: skin again
    mesh(new THREE.LatheGeometry(v2([[0, 0], [0.018, 0.002], [0.032, 0.01], [0.038, 0.02]]), 40), skin, 0, 0, 0, core);
    const waist = mesh(new THREE.LatheGeometry(v2([[0.038, 0.02], [0.024, 0.026], [0.015, 0.036], [0.013, 0.046], [0.016, 0.058], [0.026, 0.068], [0.037, 0.074]]), 40), fleshM, 0, 0, 0, core);
    void waist;
    mesh(new THREE.LatheGeometry(v2([[0.037, 0.074], [0.032, 0.084], [0.02, 0.09], [0.006, 0.088], [0, 0.084]]), 40), skin, 0, 0, 0, core);
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1;
      const pip = mesh(new THREE.SphereGeometry(0.004, 10, 8), std({ color: 0x2a1408, roughness: 0.3 }), Math.cos(a) * 0.013, 0.044 + k * 0.004, Math.sin(a) * 0.013, core);
      pip.scale.set(1, 1.6, 0.7);
    }
    mesh(new THREE.CylinderGeometry(0.0016, 0.0022, 0.022, 8), std({ color: 0x4a3018, roughness: 0.8 }), 0.002, 0.097, 0, core).rotation.z = 0.2;
    mesh(new THREE.CylinderGeometry(0.004, 0.0, 0.006, 8), std({ color: 0x3a2a14, roughness: 0.9 }), 0, -0.002, 0, core);
    core.position.y = 0.965;
  }

  // =============================================================== generator (SW corner)
  {
    const gx = x0 + 0.72;
    const gz = z1 - 0.72;
    const gen = add(new THREE.Group(), gx, 0, gz);
    const gm = std({ color: 0x3e5a3c, roughness: 0.5, metalness: 0.5 });
    mesh(rbox(1.04, 1.3, 0.92, 0.04), gm, 0, 0.67, 0, gen);
    mesh(rbox(1.1, 0.06, 0.98, 0.02), M.darker, 0, 0.03, 0, gen);
    // Cooling fins down its face (toward the room: +x)
    for (let k = 0; k < 14; k++) mesh(rbox(0.03, 0.9, 0.012, 0.004), M.dark, 0.53, 0.65, -0.36 + k * 0.055, gen);
    // Gauges on the north side
    const gauge = (x: number, y: number, label: string): void => {
      const tex = canvasTex(128, 128, (c) => {
        c.fillStyle = '#f0ece0';
        c.beginPath();
        c.arc(64, 64, 62, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#222';
        c.lineWidth = 2;
        for (let k = 0; k <= 10; k++) {
          const a = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5;
          c.beginPath();
          c.moveTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50);
          c.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
          c.stroke();
        }
        c.strokeStyle = '#c02020';
        c.lineWidth = 6;
        c.beginPath();
        c.arc(64, 64, 54, Math.PI * 1.95, Math.PI * 2.25);
        c.stroke();
        c.fillStyle = '#222';
        c.font = 'bold 16px Arial';
        c.textAlign = 'center';
        c.fillText(label, 64, 100);
      });
      const gg = add(new THREE.Group(), x, y, -0.465, gen);
      gg.rotation.y = Math.PI;
      mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 32), M.steel, 0, 0, 0, gg).rotation.x = Math.PI / 2;
      mesh(new THREE.CircleGeometry(0.052, 32), std({ map: tex, roughness: 0.4 }), 0, 0, 0.016, gg);
      const needle = add(new THREE.Group(), 0, 0, 0.018, gg);
      mesh(new THREE.BoxGeometry(0.004, 0.045, 0.002), std({ color: 0x111111 }), 0, 0.02, 0, needle);
      const base = -0.6 + Math.random() * 0.8;
      updates.push((t) => (needle.rotation.z = base + Math.sin(t * 2.1 + x * 10) * 0.05 + Math.sin(t * 13) * 0.01));
    };
    gauge(-0.25, 1.05, 'PSI');
    gauge(0.0, 1.05, 'kW');
    gauge(0.25, 1.05, '°C');
    const lab = canvasTex(256, 96, (c) => {
      c.fillStyle = '#f2c400';
      c.fillRect(0, 0, 256, 96);
      c.fillStyle = '#111';
      c.font = 'bold 26px Arial';
      c.textAlign = 'center';
      c.fillText('⚡ HIGH VOLTAGE', 128, 42);
      c.font = 'bold 18px Arial';
      c.fillText('FUEL CELL GEN-4 · 12 kW', 128, 76);
    });
    const ll = mesh(new THREE.PlaneGeometry(0.4, 0.15), std({ map: lab, roughness: 0.6 }), 0, 0.6, -0.465, gen);
    ll.rotation.y = Math.PI;
    for (const dzz of [-0.25, 0.25]) {
      mesh(new THREE.CylinderGeometry(0.05, 0.05, h - 1.32, 16), M.steel, -0.1, 1.32 + (h - 1.32) / 2, dzz, gen);
      for (const y of [1.4, h - 0.1]) mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 16), M.brushed, -0.1, y, dzz, gen);
    }
    const genLed = glow(0x103010, 0x40ff60, 2);
    mesh(new THREE.SphereGeometry(0.012, 12, 8), genLed, 0.35, 1.2, -0.462, gen);
    solid(gx - 0.55, 0, gz - 0.5, gx + 0.55, 1.32, gz + 0.5);
  }

  // =============================================================== on the walls and overhead
  {
    // Cable trays the length of the room
    for (const sx of [-1, 1]) {
      mesh(rbox(0.32, 0.04, z1 - z0 - 0.2, 0.008), M.steel, sx * 2.6, h - 0.15, (z0 + z1) / 2);
      for (let k = 0; k < 5; k++) {
        const cab = mesh(new THREE.CylinderGeometry(0.014, 0.014, z1 - z0 - 0.2, 10), std({ color: [0x1a1a1a, 0xaa2222, 0x2244aa, 0xd8b21c, 0x1a1a1a][k], roughness: 0.6 }), sx * 2.6 - 0.12 + k * 0.06, h - 0.11, (z0 + z1) / 2);
        cab.rotation.x = Math.PI / 2;
      }
      for (let z = z0 + 0.6; z < z1; z += 1.2) mesh(rbox(0.36, 0.12, 0.03, 0.006), M.dark, sx * 2.6, h - 0.08, z);
    }
    // A water pipe along the south wall, flanged
    const pipe = mesh(new THREE.CylinderGeometry(0.05, 0.05, x1 - x0 - 0.2, 20), M.steel, 0, h - 0.32, z1 - 0.3);
    pipe.rotation.z = Math.PI / 2;
    for (let x = x0 + 0.6; x < x1; x += 1.4) mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 20), M.brushed, x, h - 0.32, z1 - 0.3).rotation.z = Math.PI / 2;
    // The vent: a frame and louvres
    const vent = add(new THREE.Group(), 1.6, h - 0.01, 133);
    mesh(rbox(0.64, 0.02, 0.44, 0.006), M.dark, 0, 0, 0, vent);
    for (let k = 0; k < 8; k++) {
      const lv = mesh(new THREE.BoxGeometry(0.58, 0.004, 0.04), M.steel, 0, -0.015, -0.17 + k * 0.05, vent);
      lv.rotation.x = 0.6;
    }
    // The ceiling light: a housing and a diffuser
    mesh(rbox(2.8, 0.06, 0.32, 0.015), M.brushed, 0, h - 0.04, (z0 + z1) / 2 - 1.1);
    mesh(new THREE.BoxGeometry(2.6, 0.01, 0.22), std({ color: 0xffffff, emissive: 0xe8f4ff, emissiveIntensity: 2 }), 0, h - 0.075, (z0 + z1) / 2 - 1.1);
    // First aid, an extinguisher by the door
    const fa = add(new THREE.Group(), x1 - 0.32, 1.5, z0 + 0.07);
    mesh(rbox(0.36, 0.28, 0.1, 0.02), M.white, 0, 0, 0, fa);
    mesh(new THREE.BoxGeometry(0.06, 0.18, 0.01), std({ color: 0xcc1111 }), 0, 0, 0.052, fa);
    mesh(new THREE.BoxGeometry(0.18, 0.06, 0.01), std({ color: 0xcc1111 }), 0, 0, 0.052, fa);
    mesh(rbox(0.04, 0.02, 0.02, 0.005), M.steel, 0.15, 0, 0.055, fa);
    const ex = add(new THREE.Group(), x1 - 0.85, 0, z0 + 0.15);
    mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.5, 32), std({ color: 0xc01818, roughness: 0.3, metalness: 0.3 }), 0, 0.3, 0, ex);
    mesh(new THREE.SphereGeometry(0.075, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: 0xc01818, roughness: 0.3, metalness: 0.3 }), 0, 0.55, 0, ex);
    mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.06, 16), M.darker, 0, 0.63, 0, ex);
    mesh(rbox(0.1, 0.015, 0.03, 0.005), M.darker, 0.03, 0.67, 0, ex);
    mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.02, 0.64, 0), new THREE.Vector3(0.09, 0.6, 0.03), new THREE.Vector3(0.09, 0.3, 0.05), new THREE.Vector3(0.06, 0.2, 0.06)]), 24, 0.01, 8),
      M.rubber,
      0,
      0,
      0,
      ex
    );
    solid(x1 - 0.95, 0, z0, x1 - 0.75, 0.7, z0 + 0.25);
    // The warning plate by the door
    const wp = canvasTex(420, 300, (c) => {
      c.fillStyle = '#f2c400';
      c.fillRect(0, 0, 420, 300);
      c.fillStyle = '#111';
      c.fillRect(10, 10, 400, 4);
      c.fillRect(10, 286, 400, 4);
      c.font = 'bold 44px Arial';
      c.textAlign = 'center';
      c.fillText('WARNING', 210, 80);
      c.font = 'bold 30px Arial';
      c.fillText('SUIT SEALED', 210, 160);
      c.fillText('AT ALL TIMES', 210, 205);
      c.font = '20px Arial';
      c.fillText('ATMOSPHERE UNBREATHABLE', 210, 256);
    });
    mesh(new THREE.PlaneGeometry(0.42, 0.3), std({ map: wp, roughness: 0.6 }), -2.75, 1.9, z0 + 0.012);
    // The canyon map pinned over the bench
    const mp = canvasTex(400, 560, (c) => {
      c.fillStyle = '#d8d0b0';
      c.fillRect(0, 0, 400, 560);
      c.strokeStyle = 'rgba(106,90,58,0.3)';
      for (let k = 0; k < 40; k++) {
        c.beginPath();
        for (let y = 0; y <= 560; y += 10) c.lineTo(200 + Math.sin(y * 0.015 + k * 0.4) * 60 + (k - 20) * 9, y);
        c.stroke();
      }
      c.strokeStyle = '#6a5a3a';
      c.lineWidth = 4;
      for (const s of [-1, 1]) {
        c.beginPath();
        for (let y = 0; y <= 560; y += 6) c.lineTo(200 + Math.sin(y * 0.015) * 80 + s * 50, y);
        c.stroke();
      }
      c.fillStyle = '#cc2222';
      c.font = 'bold 26px Arial';
      c.fillText('X', 184, 40);
      c.fillText('BASE', 160, 540);
      c.fillStyle = '#2a8a4a';
      c.fillRect(140, 280, 120, 34);
    });
    const mapM = mesh(new THREE.PlaneGeometry(0.5, 0.7), std({ map: mp, roughness: 0.9 }), 0.9, 1.6, z1 - 0.02);
    mapM.rotation.y = Math.PI;
    for (const [px, py] of [[0.7, 1.92], [1.1, 1.92], [0.7, 1.28], [1.1, 1.28]]) mesh(new THREE.SphereGeometry(0.01, 10, 8), std({ color: 0xd02020 }), px, py, z1 - 0.025);
  }

  // =============================================================== the steam off the coffee
  const dot = softDot();
  const puffs: { s: THREE.Sprite; ph: number }[] = [];
  for (let k = 0; k < 9; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    s.scale.setScalar(0.03);
    g.add(s);
    puffs.push({ s, ph: k / 9 });
  }
  updates.push((t) => {
    for (const p of puffs) {
      const u = (t * 0.42 + p.ph) % 1;
      p.s.position.set(steamAt.x + Math.sin(t * 1.3 + p.ph * 9) * 0.012 * (1 + u * 3), steamAt.y + u * 0.22, steamAt.z + Math.cos(t * 1.1 + p.ph * 7) * 0.01 * (1 + u * 2));
      p.s.scale.setScalar(0.025 + u * 0.07);
      p.s.material.opacity = Math.sin(u * Math.PI) * 0.22;
    }
  });

  // =============================================================== it all moving
  let last = -1;
  const screenAt = new THREE.Vector3(CONSOLE.x, 1.3, CONSOLE.z);
  const camDir = new THREE.Vector3();
  const anim: StationAnim = {
    update(t, dt, eye, cam) {
      const near = Math.abs(eye.x - screenAt.x) < 14 && Math.abs(eye.z - screenAt.z) < 14;
      if (!near) return;
      for (const u of updates) u(t, dt, eye);
      // The receiver: blazing as he arrives, settling to a hum
      const arrive = Math.exp(-t / 1.1);
      colMat.uniforms.uK.value = arrive;
      colMat.uniforms.uT.value = t;
      column.visible = arrive > 0.01;
      flashMat.opacity = Math.max(0, 1 - t / 0.6) * 0.85;
      flash.visible = flashMat.opacity > 0.005;
      padGlowMat.emissiveIntensity = 0.9 + 0.25 * Math.sin(t * 2.2) + 4 * arrive;
      coilGlow.emissiveIntensity = 1.1 + 0.4 * Math.sin(t * 7) * Math.sin(t * 1.3) + 5 * arrive;
      recLight.intensity = 2.2 + 0.5 * Math.sin(t * 2.2) + 18 * arrive;
      leds.forEach((m, i) => (m.emissiveIntensity = Math.sin(t * (3 + i * 1.7) + i) > -0.2 ? 1.6 : 0.1));
      // The console's face, redrawn a dozen times a second
      // The console's face, redrawn eight times a second while he's close enough to read it and facing it
      const sx = screenAt.x - eye.x;
      const sz = screenAt.z - eye.z;
      const facing = cam ? (cam.getWorldDirection(camDir).x * sx + camDir.z * sz) / Math.max(0.01, Math.hypot(sx, sz)) > 0.3 : true;
      if (Math.hypot(sx, sz) < 7 && facing && (t - last > 1 / 8 || t < last)) {
        last = t;
        drawScreen(sctx, t);
        stex.needsUpdate = true;
      }

    }
  };
  return { anim, specimens, pad: new THREE.Vector3(R.x, 0.122, R.z) };
}

// ================================================================ the airlock

/**
 * The station's door: a heavy airlock housing on the inside of the north
 * wall round a 2 m × 2.5 m opening, its two leaves meeting in the middle at
 * an amber seam and sliding apart into the housing either side. A hazard
 * frame round the opening, inside and out; a beacon over it that turns and
 * flashes while it moves; a small window in each leaf. `open(k)`: 0 shut,
 * 1 fully open.
 */
export function airlock(g: THREE.Group, solid: Solid, room: { z0: number; h: number }): { open: (k: number) => void } {
  const z0 = room.z0;
  const D = 0.32;
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.42, metalness: 0.75 });
  const housingTex = canvasTex(512, 512, (c) => {
    c.fillStyle = '#4a525a';
    c.fillRect(0, 0, 512, 512);
    // Panels, their seams and bolts
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 4;
    for (let y = 0; y <= 512; y += 128) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(512, y);
      c.stroke();
    }
    for (let x = 0; x <= 512; x += 256) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, 512);
      c.stroke();
    }
    c.fillStyle = '#2a3036';
    for (let y = 12; y < 512; y += 128) for (let x = 12; x < 512; x += 64) c.fillRect(x, y, 6, 6);
    for (let k = 0; k < 500; k++) {
      c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.04)`;
      c.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 20, 1 + Math.random() * 2);
    }
  });
  housingTex.wrapS = housingTex.wrapT = THREE.RepeatWrapping;
  const housingMat = new THREE.MeshStandardMaterial({ map: housingTex, roughness: 0.5, metalness: 0.6 });
  const hz = canvasTex(64, 512, (c) => {
    c.fillStyle = '#e0b81c';
    c.fillRect(0, 0, 64, 512);
    c.fillStyle = '#141414';
    for (let y = -64; y < 512; y += 64) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(64, y + 32);
      c.lineTo(64, y + 64);
      c.lineTo(0, y + 32);
      c.fill();
    }
  });
  hz.wrapT = THREE.RepeatWrapping;
  const blk = (x0: number, y0: number, x1: number, y1: number): void => {
    const geo = rbox(x1 - x0, y1 - y0, D, 0.03);
    const m = new THREE.Mesh(geo, housingMat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z0 + D / 2);
    g.add(m);
    solid(x0, y0, z0, x1, y1, z0 + D);
  };
  blk(-2.15, 0, -1.0, 2.5);
  blk(1.0, 0, 2.15, 2.5);
  blk(-2.15, 2.5, 2.15, 3.0);
  // The hazard frame round the opening, inside face and out
  const strip = (w: number, h: number, x: number, y: number, z: number, rot = 0, ry = 0): void => {
    const t = hz.clone();
    t.repeat.set(1, Math.max(1, Math.round(Math.max(w, h) / 0.35)));
    t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w, h), Math.max(w, h)), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
    m.position.set(x, y, z);
    m.rotation.set(0, ry, rot);
    g.add(m);
  };
  for (const [z, ry] of [[z0 + D + 0.004, 0], [z0 - 0.204, Math.PI]] as [number, number][]) {
    strip(0.14, 2.5, -1.07, 1.25, z, 0, ry);
    strip(0.14, 2.5, 1.07, 1.25, z, 0, ry);
    strip(2.28, 0.14, 0, 2.57, z, Math.PI / 2, ry);
  }
  // Steel jamb faces inside the opening
  for (const sx of [-1, 1]) {
    const j = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.5, D + 0.2), steel);
    j.position.set(sx * 1.03, 1.25, z0 + D / 2 - 0.1);
    g.add(j);
  }
  // The beacon over it
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x3a2400, emissive: 0xffa020, emissiveIntensity: 0.4, roughness: 0.3, transparent: true, opacity: 0.9 });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 24), beaconMat);
  beacon.position.set(0, 2.82, z0 + D + 0.06);
  g.add(beacon);
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.03, 24), steel);
  cage.position.set(0, 2.75, z0 + D + 0.06);
  g.add(cage);
  // The leaves
  const leafTex = (right: boolean): THREE.CanvasTexture =>
    canvasTex(256, 640, (c) => {
      c.fillStyle = '#5a636c';
      c.fillRect(0, 0, 256, 640);
      // A recessed panel, top and bottom
      for (const [y, h] of [[40, 230], [330, 270]]) {
        c.fillStyle = '#4a5259';
        c.fillRect(24, y, 208, h);
        c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.lineWidth = 4;
        c.strokeRect(24, y, 208, h);
        c.strokeStyle = 'rgba(255,255,255,0.12)';
        c.lineWidth = 2;
        c.strokeRect(28, y + 4, 200, h - 8);
      }
      // Chevrons by the meeting edge
      c.save();
      c.beginPath();
      c.rect(right ? 0 : 196, 330, 60, 270);
      c.clip();
      c.fillStyle = '#e0b81c';
      c.fillRect(right ? 0 : 196, 330, 60, 270);
      c.fillStyle = '#141414';
      for (let y = 300; y < 640; y += 40) {
        c.beginPath();
        c.moveTo(right ? 0 : 196, y);
        c.lineTo(right ? 60 : 256, y + (right ? 30 : -30) + 30);
        c.lineTo(right ? 60 : 256, y + 50);
        c.lineTo(right ? 0 : 196, y + 20);
        c.fill();
      }
      c.restore();
      // Rivets along the edges
      c.fillStyle = '#2c3237';
      for (let y = 16; y < 640; y += 32) {
        c.fillRect(8, y, 6, 6);
        c.fillRect(242, y, 6, 6);
      }
      c.fillStyle = '#e8e4d0';
      c.font = 'bold 22px Arial';
      c.textAlign = 'center';
      c.fillText(right ? 'AIRLOCK' : 'A-1', 128, 312);
    });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9ac8e0, emissive: 0x1a3040, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.2 });
  const seam = new THREE.MeshStandardMaterial({ color: 0x3a2400, emissive: 0xffa020, emissiveIntensity: 1.4 });
  const leaves: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const leaf = new THREE.Group();
    leaf.position.set(sx * 0.5, 0, z0 + D / 2);
    g.add(leaf);
    const tex = leafTex(sx > 0);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.48, 0.09), [steel, steel, steel, steel, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.65 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.65 })]);
    panel.position.y = 1.24;
    leaf.add(panel);
    // A round porthole, its rim
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.11, 32), glassMat);
    win.position.set(sx * -0.18, 1.72, 0.047);
    leaf.add(win);
    const win2 = win.clone();
    win2.position.z = -0.047;
    win2.rotation.y = Math.PI;
    leaf.add(win2);
    for (const zz of [0.05, -0.05]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.018, 10, 36), steel);
      rim.position.set(sx * -0.18, 1.72, zz);
      leaf.add(rim);
    }
    // The amber seam down its meeting edge, and a grab handle
    const sm = new THREE.Mesh(new THREE.BoxGeometry(0.025, 2.4, 0.1), seam);
    sm.position.set(-sx * 0.495, 1.24, 0);
    leaf.add(sm);
    const handle = new THREE.Mesh(rbox(0.04, 0.42, 0.05, 0.015), steel);
    handle.position.set(-sx * 0.36, 1.1, 0.07);
    leaf.add(handle);
    leaves.push(leaf);
  }
  let t = 0;
  return {
    open(k: number) {
      t += 0.05;
      leaves.forEach((l, i) => (l.position.x = (i === 0 ? -1 : 1) * (0.5 + k * 1.06)));
      const moving = k > 0.001 && k < 0.999;
      beaconMat.emissiveIntensity = moving ? 1.2 + 1.8 * Math.max(0, Math.sin(t * 6)) : k >= 0.999 ? 0.25 : 0.4;
      beacon.rotation.y += moving ? 0.3 : 0;
      seam.emissiveIntensity = k > 0.02 ? 0.3 : 1.4;
    }
  };
}
