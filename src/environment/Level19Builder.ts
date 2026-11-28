import * as THREE from 'three';
import type { Collider, Waypoint } from './OfficeLevelBuilder';
import type { BreakableGlass } from './BreakableGlass';
import { foldProp } from './foldProp';

/**
 * Level19Builder — the inside of the boss's plane: a widebody airliner
 * fitted out as a flying penthouse, at cruise, high over the clouds.
 *
 * One long tube, nose toward −Z, tail toward +Z, the floor at y = 0 and the
 * aisle down x = 0; the main door on the left (−X). From the back:
 *
 *   aft galley   z 23.5 .. 30    where Ravi climbs up out of the hold; the
 *                                main aft door, and the locker of chutes
 *   the suite    z 8 .. 23.5     a corridor down the middle between four
 *                                rooms: the boss's bedroom and bathroom on
 *                                the left, a guest room and his study right
 *   conference   z −6 .. 8       the long table, the screen, the security post
 *   the lounge   z −22 .. −6     sofas, the bar, the boss's own chair
 *   forward      z −28 .. −22    the crew's galley, the cockpit door
 *   cockpit      z −33 .. −28    two seats, the panel, the windscreen
 *
 * The centre doorways all line up, so from the cockpit door you can see all
 * the way down the plane to the back. The windows are real holes: what's
 * outside (the sky dome, the sun, two decks of cloud far below) is drawn in
 * the scene, and the scene scrolls the clouds.
 *
 * Static dressing is folded into one mesh per material (foldProp) — the
 * shootable structure in one fold, the fine trim that bullets don't need to
 * know about in another. Vision is tested against the walls and the tall
 * furniture only, as plain meshes kept for the purpose.
 */

export const HW = 2.8;
export const CEIL = 2.42;
const T = 0.12;
export const Z_AFT = 30;
export const P_GALLEY = 23.5;
export const P_SUITE = 8;
export const P_CONF = -6;
export const P_LOUNGE = -22;
export const P_COCKPIT = -28;
export const Z_NOSE = -33;
/** The main aft door, in the left wall. */
export const DOOR = { z0: 24.7, z1: 26.5, h: 1.95 };
/** Each centre doorway's width. */
const DW = 1.2;
const DH = 2.08;
/** The suite's corridor walls. */
const CX = 0.72;

export interface GuardSpawn {
  pos: THREE.Vector3;
  yaw: number;
  /** How far from where he's posted his patrol goes (0: he stands his post). */
  zone: number;
  /** Which part of the plane he's in, for the checkpoints. */
  section: 'suite' | 'conf' | 'lounge' | 'fwd';
}

export interface Level19Data {
  group: THREE.Group;
  colliders: Collider[];
  shootables: THREE.Object3D[];
  occluders: THREE.Object3D[];
  glassPanes: BreakableGlass[];
  waypoints: Waypoint[];
  /** What's out of the windows: the sky dome, the sun, the cloud decks. Not part of `group`. */
  outside: THREE.Group;
  /** The two cloud decks' maps, for the scene to scroll. */
  cloudMaps: THREE.Texture[];
  playerSpawn: THREE.Vector3;
  playerSpawnYaw: number;
  /** Where a retry from each checkpoint puts him, and which way he faces. */
  checkpoints: { pos: THREE.Vector3; yaw: number }[];
  guards: GuardSpawn[];
  /** The two pilots' seats: where each one's hips go, facing forward. */
  pilotSeats: THREE.Vector3[];
  /** Each pilot's control column (left seat, right seat): pivots at the floor; rotation.x forward is nose down. */
  yokes: THREE.Group[];
  /** The bottles on the bar and its back shelves, each its own mesh: they can be shot. */
  barBottles: THREE.Mesh[];
  /** The cockpit door: its leaf on a hinge (on the left of the frame), and the collider it blocks with. */
  cockpitDoor: { pivot: THREE.Group; collider: Collider; at: THREE.Vector3 };
  /** The aft door: a plug that moves in, then swings out and forward on its arm. */
  aftDoor: { leaf: THREE.Group; collider: Collider; at: THREE.Vector3 };
  /** The locker of chutes across from it: one pack per hook; the scene takes one. */
  chutes: THREE.Object3D[];
  lockerAt: THREE.Vector3;
  /** The closet's two doors, each on its hinge: rotation.y opens them (the first negative, the second positive). */
  closetDoors: THREE.Group[];
  /** The boss's chair in the lounge, and the cigar still going in the ashtray beside it. */
  bossChair: THREE.Vector3;
  cigarTip: THREE.Vector3;
  /** Where the boss has been hiding (his bedroom), and his way from there to the open door. */
  bossHide: THREE.Vector3;
  bossRun: THREE.Vector3[];
  /** The alarm's red lights: there all along at nothing, turned up when the pilots go. */
  alarmLights: THREE.PointLight[];
  alarmMat: THREE.MeshStandardMaterial;
  /** The cabin's own lights, which flicker as she goes into the dive. */
  cabinLights: THREE.PointLight[];
  /** Loose things that fly about when the door goes: glasses, papers, cushions. */
  loose: THREE.Object3D[];
  /** The trap in the galley floor he comes up through. */
  hatch: THREE.Vector3;
  /** The cockpit's screens: the scene can set them flashing. */
  screenMat: THREE.MeshStandardMaterial;
  /** The LED strips and the ceiling's trough: they flicker with the lights. */
  ledMat: THREE.MeshStandardMaterial;
}

// ================================================================ textures

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return c;
}

function tex(c: HTMLCanvasElement, rx = 1, ry = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Seeded, so the plane comes out the same every time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Deep navy carpet with a small gold lattice in it. */
function carpetCanvas(): HTMLCanvasElement {
  return canvas(256, 256, (g) => {
    const r = rng(7);
    g.fillStyle = '#1b2236';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      const v = 20 + r() * 26;
      g.fillStyle = `rgba(${v},${v + 6},${v + 28},0.5)`;
      g.fillRect(r() * 256, r() * 256, 1.5, 1.5);
    }
    g.strokeStyle = 'rgba(176,142,74,0.55)';
    g.lineWidth = 2;
    for (let k = -256; k <= 256; k += 64) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + 256, 256);
      g.stroke();
      g.beginPath();
      g.moveTo(k + 256, 0);
      g.lineTo(k, 256);
      g.stroke();
    }
    g.fillStyle = 'rgba(206,170,96,0.8)';
    for (let x = 0; x <= 256; x += 64) for (let y = 0; y <= 256; y += 64) g.fillRect(x - 3, y - 3, 6, 6);
  });
}

/** Walnut veneer: long dark grain with the odd figure in it. */
function walnutCanvas(): HTMLCanvasElement {
  return canvas(256, 256, (g) => {
    const r = rng(11);
    g.fillStyle = '#4a2c19';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 160; i++) {
      const y = r() * 256;
      const v = r();
      g.strokeStyle = v < 0.5 ? `rgba(30,16,8,${0.08 + r() * 0.16})` : `rgba(122,78,44,${0.05 + r() * 0.12})`;
      g.lineWidth = 0.6 + r() * 2.4;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * (2 + r() * 3));
      g.stroke();
    }
  });
}

/** Cream leather: a soft mottle. */
function leatherCanvas(): HTMLCanvasElement {
  return canvas(128, 128, (g) => {
    const r = rng(3);
    g.fillStyle = '#e8dcc4';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2600; i++) {
      const v = r() < 0.5 ? 'rgba(150,128,96,0.10)' : 'rgba(255,250,240,0.12)';
      g.fillStyle = v;
      const s = 1 + r() * 3;
      g.fillRect(r() * 128, r() * 128, s, s);
    }
  });
}

/** White marble with grey veins, for the galleys and the bathroom. */
function marbleCanvas(): HTMLCanvasElement {
  return canvas(256, 256, (g) => {
    const r = rng(5);
    g.fillStyle = '#ecebe6';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(120,120,128,${0.15 + r() * 0.35})`;
      g.lineWidth = 0.5 + r() * 1.8;
      g.beginPath();
      let x = r() * 256;
      let y = 0;
      g.moveTo(x, y);
      while (y < 256) {
        x += (r() - 0.5) * 30;
        y += 8 + r() * 20;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.strokeStyle = 'rgba(160,160,160,0.5)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, 255, 255);
  });
}

/** The sidewall's lining: warm white panels with a faint seam. */
function liningCanvas(): HTMLCanvasElement {
  return canvas(128, 128, (g) => {
    const r = rng(9);
    g.fillStyle = '#e2d7c3';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(180,170,150,${r() * 0.08})`;
      g.fillRect(r() * 128, r() * 128, 2, 2);
    }
    g.fillStyle = 'rgba(150,140,120,0.35)';
    g.fillRect(0, 0, 1, 128);
  });
}

/** A sign, white on navy, or whatever's asked. */
function signCanvas(lines: string[], bg = '#14213d', fg = '#f2e6c8', w = 512, h = 128): HTMLCanvasElement {
  return canvas(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a75a';
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = Math.floor((h - 30) / lines.length);
    g.font = `bold ${Math.floor(size * 0.72)}px Arial, Helvetica, sans-serif`;
    lines.forEach((l, i) => g.fillText(l, w / 2, 15 + size * (i + 0.5)));
  });
}

/** A grainy security-camera frame of the cabin, green-grey with a timestamp. */
function cctvCanvas(n: number): HTMLCanvasElement {
  return canvas(256, 160, (g) => {
    const r = rng(20 + n);
    const grd = g.createLinearGradient(0, 0, 0, 160);
    grd.addColorStop(0, '#2c3a33');
    grd.addColorStop(1, '#121a16');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 160);
    // A corridor going away: the vanishing lines and a doorway
    g.strokeStyle = 'rgba(170,200,180,0.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 160);
    g.lineTo(108, 70);
    g.moveTo(256, 160);
    g.lineTo(148, 70);
    g.moveTo(0, 0);
    g.lineTo(108, 52);
    g.moveTo(256, 0);
    g.lineTo(148, 52);
    g.stroke();
    g.strokeRect(108, 52, 40, 18);
    if (n % 2 === 0) {
      // Somebody in it
      g.fillStyle = 'rgba(30,40,35,0.9)';
      g.fillRect(118 + r() * 30, 88, 14, 40);
      g.beginPath();
      g.arc(125 + r() * 30, 82, 7, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(200,230,210,${r() * 0.12})`;
      g.fillRect(r() * 256, r() * 160, 1, 1);
    }
    g.fillStyle = '#d8f0dc';
    g.font = 'bold 13px monospace';
    g.fillText(`CAM 0${n + 1}  ${['AFT GALLEY', 'SUITE', 'LOUNGE', 'FWD'][n % 4]}`, 8, 18);
    g.fillText('REC ●', 200, 18);
    g.fillText('41,000 FT  03:12:44', 8, 150);
  });
}

/** The cockpit's glass: attitude, the nav map, engine strips. */
function displayCanvas(): HTMLCanvasElement {
  return canvas(512, 256, (g) => {
    g.fillStyle = '#05070b';
    g.fillRect(0, 0, 512, 256);
    const panel = (x: number, draw: () => void): void => {
      g.save();
      g.translate(x, 0);
      g.strokeStyle = '#2a3340';
      g.lineWidth = 3;
      g.strokeRect(4, 4, 120, 248);
      draw();
      g.restore();
    };
    for (let i = 0; i < 4; i++) {
      panel(i * 128, () => {
        if (i % 2 === 0) {
          // The attitude ball: sky over ground
          g.fillStyle = '#2f7fd9';
          g.fillRect(10, 30, 108, 90);
          g.fillStyle = '#8a5a2b';
          g.fillRect(10, 120, 108, 90);
          g.strokeStyle = '#fff';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(10, 120);
          g.lineTo(118, 120);
          g.stroke();
          g.strokeStyle = '#ffd400';
          g.lineWidth = 4;
          g.beginPath();
          g.moveTo(34, 120);
          g.lineTo(54, 120);
          g.lineTo(64, 128);
          g.lineTo(74, 120);
          g.lineTo(94, 120);
          g.stroke();
          g.fillStyle = '#9ef';
          g.font = 'bold 14px monospace';
          g.fillText('FL410', 30, 232);
        } else {
          // The nav display: a magenta route on black
          g.strokeStyle = '#e040e0';
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(64, 220);
          g.lineTo(70, 150);
          g.lineTo(52, 90);
          g.lineTo(66, 30);
          g.stroke();
          g.strokeStyle = '#ddd';
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(64, 220, 90, Math.PI * 1.15, Math.PI * 1.85);
          g.stroke();
          g.fillStyle = '#3f3';
          g.font = 'bold 13px monospace';
          g.fillText('ISLA', 70, 30);
          g.fillText('GS 488', 14, 24);
        }
      });
    }
  });
}

/**
 * A cloud deck's map, from above: soft white puffs with thin gaps of blue
 * between them, tileable (each puff drawn again wherever it crosses an edge).
 */
function cloudCanvas(seed: number, density: number): HTMLCanvasElement {
  return canvas(512, 512, (g) => {
    const r = rng(seed);
    g.clearRect(0, 0, 512, 512);
    const puff = (x: number, y: number, rad: number, a: number): void => {
      for (const dx of [-512, 0, 512]) {
        for (const dy of [-512, 0, 512]) {
          const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
          gr.addColorStop(0, `rgba(255,255,255,${a})`);
          gr.addColorStop(0.55, `rgba(246,248,252,${a * 0.6})`);
          gr.addColorStop(1, 'rgba(240,244,250,0)');
          g.fillStyle = gr;
          g.beginPath();
          g.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
          g.fill();
        }
      }
    };
    for (let i = 0; i < 140 * density; i++) {
      const x = r() * 512;
      const y = r() * 512;
      const n = 3 + Math.floor(r() * 5);
      for (let k = 0; k < n; k++) puff(x + (r() - 0.5) * 70, y + (r() - 0.5) * 40, 18 + r() * 46, 0.35 + r() * 0.35);
    }
  });
}

/**
 * A box's UVs by the metre, so a texture keeps its scale whatever the size
 * of the box (BoxGeometry stretches the whole map over every face). Faces
 * come ±x, ±y, ±z, four corners each.
 */
function metreUVs(g: THREE.BoxGeometry, w: number, h: number, d: number): void {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }
}

// ================================================================ the jokes

const HAND_FONT = '"Comic Sans MS", "Segoe Print", "Bradley Hand", cursive';

/** The boss as his portraits have him: the cap, the beard, a smile he's very pleased with. */
function bossFace(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = '#d9a57c';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(x + s * r * 0.95, y + r * 0.05, r * 0.18, r * 0.26, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.ellipse(x, y, r, r * 1.12, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#4a2e1c';
  g.beginPath();
  g.ellipse(x, y + r * 0.42, r * 0.98, r * 0.72, 0, 0, Math.PI);
  g.fill();
  g.lineCap = 'round';
  g.strokeStyle = '#8a3026';
  g.lineWidth = r * 0.1;
  g.beginPath();
  g.arc(x + r * 0.1, y + r * 0.36, r * 0.3, 0.25, Math.PI - 0.7);
  g.stroke();
  g.fillStyle = '#1a1a1a';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(x + s * r * 0.36, y - r * 0.06, r * 0.08, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#3a2416';
  g.lineWidth = r * 0.1;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(x + s * r * 0.18, y - r * 0.25);
    g.lineTo(x + s * r * 0.55, y - r * (s > 0 ? 0.38 : 0.3));
    g.stroke();
  }
  g.strokeStyle = '#b07a55';
  g.lineWidth = r * 0.07;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x - r * 0.08, y + r * 0.2);
  g.lineTo(x + r * 0.06, y + r * 0.22);
  g.stroke();
  // The cap: crown, band, peak and its gold badge
  g.fillStyle = '#1c2741';
  g.beginPath();
  g.ellipse(x, y - r * 0.55, r * 1.02, r * 0.62, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillRect(x - r * 1.02, y - r * 0.62, r * 2.04, r * 0.16);
  g.beginPath();
  g.ellipse(x + r * 0.2, y - r * 0.48, r * 0.95, r * 0.15, 0, 0, Math.PI);
  g.fill();
  g.fillStyle = '#c9a24a';
  g.fillRect(x - r * 0.15, y - r * 0.98, r * 0.3, r * 0.2);
}

/** A dark suit's shoulders, a white collar and a gold tie, under a face at (x, y) of size r. */
function bossSuit(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = '#20232b';
  g.beginPath();
  g.ellipse(x, y + r * 2.6, r * 1.9, r * 1.5, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f2f2ee';
  g.beginPath();
  g.moveTo(x - r * 0.45, y + r * 1.15);
  g.lineTo(x + r * 0.45, y + r * 1.15);
  g.lineTo(x, y + r * 1.9);
  g.fill();
  g.fillStyle = '#c9a24a';
  g.beginPath();
  g.moveTo(x - r * 0.12, y + r * 1.2);
  g.lineTo(x + r * 0.12, y + r * 1.2);
  g.lineTo(x + r * 0.16, y + r * 2.0);
  g.lineTo(x, y + r * 2.2);
  g.lineTo(x - r * 0.16, y + r * 2.0);
  g.fill();
}

/** Ravi, as a photo on somebody's wall: brown, short black hair, a worried look, his blue shirt. */
function raviFace(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = '#7fa6d6';
  g.beginPath();
  g.ellipse(x, y + r * 2.5, r * 1.8, r * 1.4, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillStyle = '#8a5c3b';
  g.fillRect(x - r * 0.3, y + r * 0.8, r * 0.6, r * 0.5);
  g.beginPath();
  g.ellipse(x, y, r * 0.9, r * 1.08, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#141010';
  g.beginPath();
  g.ellipse(x, y - r * 0.55, r * 0.92, r * 0.55, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1a1a';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(x + s * r * 0.33, y - r * 0.02, r * 0.08, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#1a1210';
  g.lineWidth = r * 0.09;
  g.lineCap = 'round';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(x + s * r * 0.15, y - r * 0.3);
    g.lineTo(x + s * r * 0.5, y - r * 0.22);
    g.stroke();
  }
  g.strokeStyle = '#4a2a1a';
  g.beginPath();
  g.arc(x, y + r * 0.62, r * 0.22, Math.PI + 0.5, Math.PI * 2 - 0.5);
  g.stroke();
}

/** A gilt-framed portrait of the boss for the corridor, with its little brass caption. */
function portraitCanvas(kind: 'baby' | 'golf' | 'board' | 'nap', caption: string): HTMLCanvasElement {
  return canvas(256, 320, (g) => {
    const bg: Record<typeof kind, [string, string]> = { baby: ['#bcd8f0', '#e8f2fb'], golf: ['#8fc4ef', '#4e9a3c'], board: ['#5a1420', '#2a0a10'], nap: ['#e9dcc0', '#c9b48e'] };
    const gr = g.createLinearGradient(0, 0, 0, 270);
    gr.addColorStop(0, bg[kind][0]);
    gr.addColorStop(1, bg[kind][1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 270);
    if (kind === 'baby') {
      bossSuit(g, 128, 120, 30);
      bossFace(g, 128, 120, 46);
      // A rattle, gold, with a gavel's head
      g.fillStyle = '#c9a24a';
      g.fillRect(196, 150, 8, 70);
      g.fillRect(182, 140, 36, 18);
    } else if (kind === 'golf') {
      bossSuit(g, 84, 118, 30);
      bossFace(g, 84, 118, 30);
      // A trophy bigger than he is
      g.fillStyle = '#e0b648';
      g.beginPath();
      g.moveTo(150, 40);
      g.lineTo(232, 40);
      g.quadraticCurveTo(230, 150, 191, 170);
      g.quadraticCurveTo(152, 150, 150, 40);
      g.fill();
      g.fillRect(183, 168, 16, 50);
      g.fillRect(160, 215, 62, 22);
      g.strokeStyle = '#e0b648';
      g.lineWidth = 8;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.arc(191 + s * 46, 80, 22, s > 0 ? -1.4 : Math.PI - 1.6, s > 0 ? 1.6 : Math.PI + 1.4);
        g.stroke();
      }
      g.fillStyle = '#7a5a18';
      g.font = 'bold 26px Georgia';
      g.textAlign = 'center';
      g.fillText('#1', 191, 110);
    } else if (kind === 'board') {
      // A meeting with the board: him, and him again, shaking his own hand
      for (const x of [72, 184]) {
        bossSuit(g, x, 110, 26);
        bossFace(g, x, 110, 28);
      }
      g.strokeStyle = '#20232b';
      g.lineWidth = 16;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(96, 180);
      g.lineTo(116, 204);
      g.moveTo(160, 180);
      g.lineTo(140, 204);
      g.stroke();
      g.fillStyle = '#d9a57c';
      g.beginPath();
      g.ellipse(128, 205, 20, 12, 0, 0, Math.PI * 2);
      g.fill();
    } else {
      // Hard at work: face down on the desk, out cold
      g.fillStyle = '#5a3a20';
      g.fillRect(0, 190, 256, 80);
      bossSuit(g, 120, 140, 30);
      g.save();
      g.translate(128, 150);
      g.rotate(1.2);
      bossFace(g, 0, 0, 34);
      g.restore();
      g.fillStyle = '#3a3a3a';
      g.font = 'bold 34px ' + HAND_FONT;
      g.fillText('z', 176, 90);
      g.font = 'bold 44px ' + HAND_FONT;
      g.fillText('Z', 198, 60);
    }
    g.fillStyle = '#e8d9a8';
    g.fillRect(0, 270, 256, 50);
    g.fillStyle = '#3a2a10';
    g.font = 'bold 17px Georgia';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const words = caption.split('|');
    words.forEach((w, i) => g.fillText(w, 128, 295 + (i - (words.length - 1) / 2) * 19));
  });
}

/** Paper with lines of print on it: a notice, a certificate, the rules. */
function noticeCanvas(title: string, lines: string[], o: { w?: number; h?: number; bg?: string; fg?: string; accent?: string; hand?: boolean } = {}): HTMLCanvasElement {
  const w = o.w ?? 384;
  const h = o.h ?? 512;
  return canvas(w, h, (g) => {
    g.fillStyle = o.bg ?? '#f4ecd6';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = o.accent ?? '#9a7a30';
    g.lineWidth = 6;
    g.strokeRect(12, 12, w - 24, h - 24);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = o.accent ?? '#7a1a1a';
    g.font = `bold ${Math.round(w / 11)}px ${o.hand ? HAND_FONT : 'Georgia'}`;
    g.fillText(title, w / 2, h * 0.14);
    g.fillStyle = o.fg ?? '#222';
    const size = Math.min(Math.round(w / 15), Math.floor((h * 0.74) / lines.length) - 6);
    g.font = `${o.hand ? '' : 'bold '}${size}px ${o.hand ? HAND_FONT : 'Arial, Helvetica, sans-serif'}`;
    const top = h * 0.26;
    const step = (h * 0.68) / lines.length;
    lines.forEach((l, i) => g.fillText(l, w / 2, top + step * (i + 0.5)));
  });
}

/** The conference room's whiteboard: the plan, in marker. */
function whiteboardCanvas(): HTMLCanvasElement {
  return canvas(512, 320, (g) => {
    g.fillStyle = '#f6f8f6';
    g.fillRect(0, 0, 512, 320);
    g.lineCap = 'round';
    g.fillStyle = '#1d3f9a';
    g.font = 'bold 34px ' + HAND_FONT;
    g.fillText('OPERATION: FIND RAVI', 22, 48);
    g.fillStyle = '#222';
    g.font = '27px ' + HAND_FONT;
    g.fillText('1. Find Ravi', 34, 98);
    g.fillText('2. ???', 34, 140);
    g.fillText('3. Bonuses', 34, 182);
    g.strokeStyle = '#d02020';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(58, 174);
    g.lineTo(168, 174);
    g.stroke();
    g.fillStyle = '#d02020';
    g.fillText('(cancelled)', 178, 184);
    g.fillStyle = '#1a7a2a';
    g.fillText('Morale:', 34, 240);
    // A graph of it: down
    g.strokeStyle = '#1a7a2a';
    g.beginPath();
    g.moveTo(150, 222);
    g.lineTo(190, 236);
    g.lineTo(220, 232);
    g.lineTo(270, 290);
    g.stroke();
    // A stick man with a knife, circled, and "HIM"
    g.strokeStyle = '#222';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(410, 120, 16, 0, Math.PI * 2);
    g.moveTo(410, 136);
    g.lineTo(410, 186);
    g.moveTo(410, 150);
    g.lineTo(384, 170);
    g.moveTo(410, 150);
    g.lineTo(440, 140);
    g.moveTo(410, 186);
    g.lineTo(392, 222);
    g.moveTo(410, 186);
    g.lineTo(428, 222);
    g.stroke();
    g.strokeStyle = '#d02020';
    g.beginPath();
    g.ellipse(410, 165, 58, 82, 0, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#d02020';
    g.font = 'bold 30px ' + HAND_FONT;
    g.fillText('HIM', 382, 286);
    g.fillStyle = '#555';
    g.font = '18px ' + HAND_FONT;
    g.fillText('do NOT wipe — Boss', 300, 312);
  });
}

/** A wanted poster for Ravi: the reward is insulting. */
function wantedCanvas(): HTMLCanvasElement {
  return canvas(256, 340, (g) => {
    g.fillStyle = '#e9d7a8';
    g.fillRect(0, 0, 256, 340);
    g.fillStyle = '#3a2410';
    g.textAlign = 'center';
    g.font = 'bold 50px Georgia';
    g.fillText('WANTED', 128, 58);
    g.fillStyle = '#bfd3ea';
    g.fillRect(48, 76, 160, 150);
    raviFace(g, 128, 140, 40);
    g.fillStyle = '#3a2410';
    g.font = 'bold 30px Georgia';
    g.fillText('RAVI', 128, 262);
    g.font = 'bold 17px Georgia';
    g.fillText('REWARD: $5', 128, 292);
    g.font = 'italic 15px Georgia';
    g.fillText('(negotiable)', 128, 316);
  });
}

/** One of those posters: a big word, a picture, a line of wisdom. This one's a shark. */
function ambitionCanvas(): HTMLCanvasElement {
  return canvas(320, 400, (g) => {
    g.fillStyle = '#060606';
    g.fillRect(0, 0, 320, 400);
    const gr = g.createLinearGradient(0, 30, 0, 270);
    gr.addColorStop(0, '#2e6ea8');
    gr.addColorStop(1, '#0a2846');
    g.fillStyle = gr;
    g.fillRect(30, 30, 260, 240);
    g.strokeStyle = '#d8d8d8';
    g.lineWidth = 2;
    g.strokeRect(30, 30, 260, 240);
    // The fin, and the little boat it's going for
    g.fillStyle = '#5a6874';
    g.beginPath();
    g.moveTo(120, 200);
    g.quadraticCurveTo(150, 120, 196, 106);
    g.quadraticCurveTo(180, 150, 200, 200);
    g.fill();
    g.fillStyle = '#c94a2a';
    g.fillRect(232, 186, 40, 10);
    g.fillStyle = '#ffffff';
    g.fillRect(250, 168, 3, 18);
    g.strokeStyle = '#9cc4e4';
    g.beginPath();
    g.moveTo(30, 200);
    g.lineTo(290, 200);
    g.stroke();
    g.fillStyle = '#f0f0f0';
    g.textAlign = 'center';
    g.font = '34px Georgia';
    g.fillText('A M B I T I O N', 160, 318);
    g.font = 'italic 15px Georgia';
    g.fillText('Eat your colleagues', 160, 350);
    g.fillText('before they eat you.', 160, 370);
  });
}

/** A dartboard's face. */
function dartboardCanvas(): HTMLCanvasElement {
  return canvas(256, 256, (g) => {
    const c = 128;
    g.fillStyle = '#111';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 20; i++) {
      const a0 = (i / 20) * Math.PI * 2 - Math.PI / 20;
      const a1 = a0 + Math.PI / 10;
      for (const [r0, r1, cols] of [[0, 120, ['#151515', '#efe3c4']], [70, 78, ['#c02020', '#1a7a2a']], [112, 120, ['#c02020', '#1a7a2a']]] as [number, number, string[]][]) {
        g.fillStyle = cols[i % 2];
        g.beginPath();
        g.arc(c, c, r1, a0, a1);
        g.arc(c, c, r0, a1, a0, true);
        g.fill();
      }
    }
    g.fillStyle = '#1a7a2a';
    g.beginPath();
    g.arc(c, c, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c02020';
    g.beginPath();
    g.arc(c, c, 6, 0, Math.PI * 2);
    g.fill();
  });
}

/** Ravi's photo, pinned up for the darts, his name on it in red marker. */
function raviPhotoCanvas(): HTMLCanvasElement {
  return canvas(128, 160, (g) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, 128, 160);
    g.fillStyle = '#bcd0e6';
    g.fillRect(8, 8, 112, 112);
    raviFace(g, 64, 62, 26);
    g.fillStyle = '#d01818';
    g.font = 'bold 26px ' + HAND_FONT;
    g.textAlign = 'center';
    g.fillText('RAVI', 64, 148);
  });
}

/** A lit sign: glowing letters on nothing, for an additive plane. */
function neonCanvas(lines: string[], color: string, w = 512, h = 128): HTMLCanvasElement {
  return canvas(w, h, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = Math.floor((h - 16) / lines.length);
    g.font = `bold ${Math.floor(size * 0.78)}px "Brush Script MT", "Segoe Script", ${HAND_FONT}`;
    for (const [blur, col] of [[24, color], [10, color], [0, '#fff4fb']] as [number, string][]) {
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.fillStyle = col;
      lines.forEach((l, i) => g.fillText(l, w / 2, 8 + size * (i + 0.5)));
    }
  });
}

/** signCanvas, but the lettering shrinks to fit the width when the words are long. */
function fitSign(lines: string[], bg = '#14213d', fg = '#f2e6c8', w = 512, h = 128): HTMLCanvasElement {
  return canvas(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a75a';
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = Math.floor((h - 30) / lines.length);
    const font = (px: number): string => `bold ${px}px Arial, Helvetica, sans-serif`;
    let px = Math.floor(size * 0.72);
    g.font = font(px);
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (widest > w - 36) px = Math.floor((px * (w - 36)) / widest);
    g.font = font(px);
    lines.forEach((l, i) => g.fillText(l, w / 2, 15 + size * (i + 0.5)));
  });
}

/** A yellow sticky note in biro. */
function stickyCanvas(lines: string[]): HTMLCanvasElement {
  return canvas(128, 128, (g) => {
    g.fillStyle = '#f7e86a';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#e8d84a';
    g.fillRect(0, 0, 128, 14);
    g.fillStyle = '#1a2a6a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = Math.min(22, Math.floor(100 / lines.length) - 2);
    g.font = `${size}px ${HAND_FONT}`;
    lines.forEach((l, i) => g.fillText(l, 64, 22 + ((i + 0.5) * 100) / lines.length));
  });
}

/** Text round a mug: white china, one line in black. */
function mugCanvas(text: string): HTMLCanvasElement {
  return canvas(256, 64, (g) => {
    g.fillStyle = '#fbfbf8';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#1a1a1a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 15px Arial';
    g.fillText(text, 64, 32);
    g.fillText(text, 192, 32);
  });
}

/** The pips on a die (the same three on every face, nobody's counting). */
function diceCanvas(): HTMLCanvasElement {
  return canvas(64, 64, (g) => {
    g.fillStyle = '#f6f2ff';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#c01a6a';
    for (const [x, y] of [[16, 16], [32, 32], [48, 48]]) {
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// ================================================================ the builder

type Mat = THREE.Material;

export class Level19Builder {
  private group = new THREE.Group();
  /** Shootable static structure and furniture, folded at the end. */
  private statics = new THREE.Group();
  /** Fine trim the bullets needn't know about, folded on its own. */
  private trim = new THREE.Group();
  private colliders: Collider[] = [];
  private occluders: THREE.Object3D[] = [];
  private loose: THREE.Object3D[] = [];
  private yokes: THREE.Group[] = [];
  private barBottles: THREE.Mesh[] = [];
  private cabinLights: THREE.PointLight[] = [];
  private alarmLights: THREE.PointLight[] = [];

  // materials
  private M!: {
    carpet: THREE.MeshStandardMaterial;
    marble: THREE.MeshStandardMaterial;
    lining: THREE.MeshStandardMaterial;
    ceiling: THREE.MeshStandardMaterial;
    walnut: THREE.MeshStandardMaterial;
    leather: THREE.MeshStandardMaterial;
    darkLeather: THREE.MeshStandardMaterial;
    gold: THREE.MeshStandardMaterial;
    steel: THREE.MeshStandardMaterial;
    black: THREE.MeshStandardMaterial;
    plastic: THREE.MeshStandardMaterial;
    led: THREE.MeshStandardMaterial;
    warmLed: THREE.MeshStandardMaterial;
    glass: THREE.MeshStandardMaterial;
    linen: THREE.MeshStandardMaterial;
    navy: THREE.MeshStandardMaterial;
    tunnel: THREE.MeshStandardMaterial;
    screen: THREE.MeshStandardMaterial;
    alarm: THREE.MeshStandardMaterial;
    hole: THREE.MeshBasicMaterial;
  };

  build(): Level19Data {
    this.materials();
    this.group.add(this.statics, this.trim);
    this.shell();
    this.partitions();
    this.galley();
    const boss = this.suite();
    this.conference();
    const lounge = this.lounge();
    this.forward();
    const cockpit = this.cockpit();
    const aftDoor = this.aftDoor();
    const locker = this.locker();
    this.decor();
    this.lights();

    // Fold: every static mesh into one per material. Boxes and cylinders
    // carry a draw group per face; with one material each, those mean nothing
    // here, and the fold won't take a mesh that has them
    for (const root of [this.statics, this.trim]) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !Array.isArray(m.material)) {
          m.geometry = m.geometry.clone();
          m.geometry.clearGroups();
        }
      });
    }
    foldProp(this.statics);
    foldProp(this.trim);
    const shootables: THREE.Object3D[] = [];
    this.statics.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) shootables.push(o);
    });
    // The doors move, so they stay their own meshes, and take bullets as themselves
    for (const leaf of [cockpit.door.pivot, aftDoor.leaf]) leaf.traverse((o) => (o as THREE.Mesh).isMesh && shootables.push(o));

    const outside = this.outside();

    return {
      group: this.group,
      colliders: this.colliders,
      shootables,
      occluders: this.occluders,
      glassPanes: [],
      waypoints: this.waypoints([cockpit.door.collider, aftDoor.collider]),
      outside: outside.group,
      cloudMaps: outside.maps,
      playerSpawn: new THREE.Vector3(1.15, 0, 27.3),
      playerSpawnYaw: 0,
      checkpoints: [
        { pos: new THREE.Vector3(1.15, 0, 27.3), yaw: 0 },
        // Through into the lounge, past the conference room
        { pos: new THREE.Vector3(0, 0, -4.6), yaw: 0 },
        // At the cockpit door, the pilots done
        { pos: new THREE.Vector3(0, 0, -27.0), yaw: Math.PI }
      ],
      guards: this.guards(),
      pilotSeats: cockpit.seats,
      yokes: this.yokes,
      barBottles: this.barBottles,
      cockpitDoor: cockpit.door,
      aftDoor,
      chutes: locker.chutes,
      lockerAt: locker.at,
      closetDoors: locker.doors,
      bossChair: lounge.chair,
      cigarTip: lounge.cigar,
      bossHide: boss.hide,
      bossRun: boss.run,
      alarmLights: this.alarmLights,
      alarmMat: this.M.alarm,
      cabinLights: this.cabinLights,
      loose: this.loose,
      hatch: new THREE.Vector3(1.2, 0, 28.2),
      screenMat: this.M.screen,
      ledMat: this.M.warmLed
    };
  }

  // -------------------------------------------------------------- materials

  private materials(): void {
    const std = (o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial(o);
    this.M = {
      carpet: std({ map: tex(carpetCanvas(), 2, 2), roughness: 0.95 }),
      marble: std({ map: tex(marbleCanvas(), 1, 1), roughness: 0.25 }),
      lining: std({ map: tex(liningCanvas(), 1, 1), roughness: 0.7, side: THREE.DoubleSide }),
      ceiling: std({ color: 0xd8cdb9, roughness: 0.8, side: THREE.DoubleSide }),
      walnut: std({ map: tex(walnutCanvas(), 1, 1), roughness: 0.45 }),
      leather: std({ map: tex(leatherCanvas(), 2, 2), roughness: 0.55 }),
      darkLeather: std({ color: 0x3a2418, roughness: 0.5 }),
      gold: std({ color: 0xc9a24a, metalness: 1, roughness: 0.28 }),
      steel: std({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.32 }),
      black: std({ color: 0x15171b, roughness: 0.4 }),
      plastic: std({ color: 0xdedad2, roughness: 0.6, side: THREE.DoubleSide }),
      led: std({ color: 0xffffff, emissive: 0xdfe9ff, emissiveIntensity: 1.6 }),
      warmLed: std({ color: 0xffffff, emissive: 0xffc98a, emissiveIntensity: 0.9 }),
      glass: std({ color: 0x9fb8c8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, depthWrite: false }),
      linen: std({ color: 0xf6f3ec, roughness: 0.9 }),
      navy: std({ color: 0x1c2741, roughness: 0.75 }),
      tunnel: std({ color: 0x9d968a, roughness: 0.65, side: THREE.BackSide }),
      screen: std({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex(displayCanvas(), 1, 1), emissiveIntensity: 1.1 }),
      alarm: std({ color: 0x400000, emissive: 0xff1a10, emissiveIntensity: 0 }),
      hole: new THREE.MeshBasicMaterial({ color: 0x050505 })
    };
    this.M.walnut.map!.repeat.set(1, 1);
  }

  // -------------------------------------------------------------- helpers

  /**
   * A box, its bottom at y. Into the shootable statics (or the trim), and
   * optionally a collider and a vision blocker.
   */
  private box(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    mat: Mat,
    o: { collide?: boolean; occlude?: boolean; trim?: boolean; surface?: string; ry?: number; rx?: number; rz?: number; into?: THREE.Object3D } = {}
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    if ((mat as THREE.MeshStandardMaterial).map) metreUVs(geo, w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y + h / 2, z);
    if (o.ry) m.rotation.y = o.ry;
    if (o.rx) m.rotation.x = o.rx;
    if (o.rz) m.rotation.z = o.rz;
    m.userData.surface = o.surface ?? 'wood';
    (o.into ?? (o.trim ? this.trim : this.statics)).add(m);
    if (o.collide) {
      m.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(m);
      this.colliders.push({ box: b });
    }
    if (o.occlude) {
      // A plain twin for the eyes: the drawn one is about to be folded away
      const eye = new THREE.Mesh(m.geometry, mat);
      eye.position.copy(m.position);
      eye.rotation.copy(m.rotation);
      eye.updateMatrixWorld(true);
      this.occluders.push(eye);
    }
    return m;
  }

  /** A collider only, nothing drawn. */
  private block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider {
    const c = { box: new THREE.Box3(new THREE.Vector3(Math.min(x0, x1), y0, Math.min(z0, z1)), new THREE.Vector3(Math.max(x0, x1), y1, Math.max(z0, z1))) };
    this.colliders.push(c);
    return c;
  }

  private cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, mat: Mat, seg = 16, o: { trim?: boolean; collide?: boolean; rx?: number; rz?: number } = {}): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y + h / 2, z);
    if (o.rx) m.rotation.x = o.rx;
    if (o.rz) m.rotation.z = o.rz;
    m.userData.surface = 'metal';
    (o.trim ? this.trim : this.statics).add(m);
    if (o.collide) {
      m.updateMatrixWorld(true);
      this.colliders.push({ box: new THREE.Box3().setFromObject(m) });
    }
    return m;
  }

  /** A flat sign/picture facing +Z (or turned by ry). */
  private plane(w: number, h: number, x: number, y: number, z: number, mat: Mat, ry = 0, into: THREE.Object3D = this.trim): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    into.add(m);
    return m;
  }

  // -------------------------------------------------------------- the shell

  /** Which spans of each sidewall have no window (bulkheads, the door, the cockpit). */
  private static noWindow(side: -1 | 1, z: number): boolean {
    if (z > Z_AFT - 0.8 || z < P_COCKPIT + 0.2) return true;
    for (const p of [P_GALLEY, P_SUITE, P_CONF, P_LOUNGE]) if (Math.abs(z - p) < 0.45) return true;
    // The doors, both sides (the right one stays shut: it's drawn as a panel)
    if (z > DOOR.z0 - 0.35 && z < DOOR.z1 + 0.35) return true;
    // The bar's back wall, and the galley's units
    if (side === 1 && z > -13 && z < -6.6) return true;
    return false;
  }

  private shell(): void {
    const M = this.M;
    const len = Z_AFT - P_COCKPIT;
    const midZ = (Z_AFT + P_COCKPIT) / 2;

    // ---- Floor: carpet through the cabins, marble in the galleys
    const floor = (z0: number, z1: number, mat: Mat): void => {
      const m = this.box(HW * 2, 0.3, z1 - z0, 0, -0.3, (z0 + z1) / 2, mat, { surface: 'concrete' });
      m.receiveShadow = true;
      const g = m.geometry as THREE.BoxGeometry;
      // Repeat the map by the metre rather than stretching it
      const uv = g.attributes.uv as THREE.BufferAttribute;
      // By the metre already: the carpet's lattice wants a little bigger than that
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
    };
    // The galley's floor goes round the hatch: 0.8 square at (1.2, 28.2)
    const H0 = 0.8, H1 = 1.6, HZ0 = 27.8, HZ1 = 28.6;
    floor(P_GALLEY, HZ0, M.marble);
    floor(HZ1, Z_AFT, M.marble);
    const strip = (x0: number, x1: number): void => {
      this.box(x1 - x0, 0.3, HZ1 - HZ0, (x0 + x1) / 2, -0.3, (HZ0 + HZ1) / 2, M.marble, { surface: 'concrete' });
    };
    strip(-HW, H0);
    strip(H1, HW);
    floor(P_LOUNGE, P_GALLEY, M.carpet);
    floor(Z_NOSE, P_LOUNGE, M.marble);
    // Under the floor: solid, except the hatch (a body can't drop down it: it's capped just below)
    this.block(-HW - 1, -1, Z_NOSE - 1, HW + 1, 0, HZ0);
    this.block(-HW - 1, -1, HZ1, HW + 1, 0, Z_AFT + 1);
    this.block(-HW - 1, -1, HZ0, H0, 0, HZ1);
    this.block(H1, -1, HZ0, HW + 1, 0, HZ1);
    this.block(H0, -1, HZ0, H1, -0.05, HZ1);
    // The hold under it: a dark box of a room, a ladder up to the hatch, a work lamp
    const holdMat = new THREE.MeshStandardMaterial({ color: 0x3b3c40, roughness: 0.9, side: THREE.DoubleSide });
    const quad = (w: number, h: number, x: number, y: number, z: number, rx: number, ry: number): void => {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), holdMat);
      q.position.set(x, y, z);
      q.rotation.set(rx, ry, 0);
      this.trim.add(q);
    };
    // Its floor, four walls, and a ceiling with the hatch left open in it
    const hx = 1.2, hz = 28.2, HB = -2.6, HT = -0.32, HR = 1.3;
    quad(HR * 2, HR * 2, hx, HB, hz, -Math.PI / 2, 0);
    quad(HR * 2, HT - HB, hx, (HB + HT) / 2, hz - HR, 0, 0);
    quad(HR * 2, HT - HB, hx, (HB + HT) / 2, hz + HR, 0, 0);
    quad(HR * 2, HT - HB, hx - HR, (HB + HT) / 2, hz, 0, Math.PI / 2);
    quad(HR * 2, HT - HB, hx + HR, (HB + HT) / 2, hz, 0, Math.PI / 2);
    quad(HR * 2, HR - 0.4, hx, HT, hz - (HR + 0.4) / 2, Math.PI / 2, 0);
    quad(HR * 2, HR - 0.4, hx, HT, hz + (HR + 0.4) / 2, Math.PI / 2, 0);
    quad(HR - 0.4, 0.8, hx - (HR + 0.4) / 2, HT, hz, Math.PI / 2, 0);
    quad(HR - 0.4, 0.8, hx + (HR + 0.4) / 2, HT, hz, Math.PI / 2, 0);
    // The hatch's own shaft, through the floor's thickness
    for (const [dx, dz, ry] of [[0, -0.392, 0], [0, 0.392, 0], [-0.392, 0, Math.PI / 2], [0.392, 0, Math.PI / 2]] as const) quad(0.784, 0.33, hx + dx, -0.155, hz + dz, 0, ry);
    for (const x of [0.95, 1.45]) this.box(0.04, 2.7, 0.04, x, -2.6, 28.55, M.steel, { trim: true });
    for (let y = -2.3; y < 0.1; y += 0.3) this.box(0.5, 0.03, 0.03, 1.2, y, 28.55, M.steel, { trim: true });
    // His way in: crates, a golf bag
    this.box(0.8, 0.7, 0.6, 0.4, -2.6, 27.4, M.walnut, { trim: true });
    this.cyl(0.14, 0.14, 1.0, 2.1, -2.6, 28.9, M.navy, 12, { trim: true, rz: 0.4 });
    const lamp = new THREE.PointLight(0xffc070, 1.2, 3.5, 1.6);
    lamp.position.set(1.8, -0.9, 27.6);
    this.group.add(lamp);

    // ---- Ceiling, flat between the two shoulders
    const ceil = this.box(4.3, 0.06, len, 0, CEIL, midZ, M.ceiling);
    void ceil;
    this.block(-HW, CEIL, P_COCKPIT, HW, CEIL + 0.6, Z_AFT);
    // A recessed light trough down the middle, and the downlights either side of it
    this.box(0.42, 0.02, len - 0.6, 0, CEIL - 0.015, midZ, M.warmLed, { trim: true });
    for (let z = Z_AFT - 1.2; z > P_COCKPIT + 0.6; z -= 1.6) {
      for (const x of [-1.25, 1.25]) {
        const d = new THREE.Mesh(new THREE.CircleGeometry(0.06, 14), M.led);
        d.rotation.x = Math.PI / 2;
        d.position.set(x, CEIL - 0.005, z);
        this.trim.add(d);
      }
    }

    // ---- The fuselage outside: white, a navy belly, a gold cheatline. Only its
    // outer faces are drawn, so from in the cabin (through a window, or the
    // open door) it's not there, and from the door looking along her it is
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf4f5f7, roughness: 0.35, metalness: 0.1 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0x1c2741, roughness: 0.4, metalness: 0.1 });
    const skin = (r: number, a0: number, a1: number, mat: Mat): void => {
      const g = new THREE.CylinderGeometry(r, r, len + 8, 48, 1, true, a0, a1 - a0);
      const m = new THREE.Mesh(g, mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(0, 0.95, midZ - 1);
      this.trim.add(m);
    };
    // Around from the bottom (θ = 0 is underneath, after the turn)
    skin(3.25, 1.05, Math.PI * 2 - 1.05, skinMat);
    skin(3.26, -1.05, 1.05, bellyMat);
    skin(3.262, 1.0, 1.06, this.M.gold);
    skin(3.262, Math.PI * 2 - 1.06, Math.PI * 2 - 1.0, this.M.gold);

    // ---- The sidewalls, each side: a lower panel, a band with the window
    // holes in it, an upper panel, and the shoulder curving into the ceiling
    for (const side of [-1, 1] as const) {
      const x = side * HW;
      const sx = side * (HW + T / 2);
      // Windows: fewer than an airliner's and bigger, every 1.6 m where the wall allows
      const wins: number[] = [];
      for (let z = Z_AFT - 1.5; z > P_COCKPIT; z -= 1.6) if (!Level19Builder.noWindow(side, z)) wins.push(z);
      const W0 = 0.95;
      const W1 = 1.55;
      const HALF = 0.25;
      // Spans to build solid, as [z0, z1], with the door left open on the left
      // (only a span the door actually falls in is split round it: split every span, and the
      // pieces between the windows each grew into a strip from there to the door, over every window)
      const spans = (z0: number, z1: number, door: boolean): [number, number][] => {
        if (!(door && side === -1) || z1 <= DOOR.z0 || z0 >= DOOR.z1) return [[z0, z1]];
        return ([[z0, DOOR.z0], [DOOR.z1, z1]] as [number, number][]).filter(([a, b]) => b > a);
      };
      for (const [a, b] of spans(P_COCKPIT, Z_AFT, true)) {
        this.box(T, W0, b - a, sx, 0, (a + b) / 2, M.lining, { surface: 'metal' });
        this.box(T, 1.85 - W1, b - a, sx, W1, (a + b) / 2, M.lining, { surface: 'metal' });
      }
      // The band: solid between holes
      const cuts = wins.map((z) => [z - HALF, z + HALF] as [number, number]).sort((p, q) => p[0] - q[0]);
      let at = P_COCKPIT;
      const pier = (a: number, b: number): void => {
        for (const [p, q] of spans(a, b, true)) if (q - p > 0.005) this.box(T, W1 - W0, q - p, sx, W0, (p + q) / 2, M.lining, { surface: 'metal' });
      };
      for (const [c0, c1] of cuts) {
        pier(at, c0);
        at = c1;
      }
      pier(at, Z_AFT);
      // Above the door: the wall carries on over it
      if (side === -1) this.box(T, 1.85 - DOOR.h, DOOR.z1 - DOOR.z0, sx, DOOR.h, (DOOR.z0 + DOOR.z1) / 2, M.lining, { surface: 'metal' });
      // The shoulder: a quarter-ellipse from the top of the wall to the ceiling's edge
      const shape = new THREE.Shape();
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * Math.PI * 0.5;
        pts.push(new THREE.Vector2(side * (2.15 + 0.65 * Math.cos(a)), 1.85 + 0.57 * Math.sin(a)));
      }
      shape.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) shape.lineTo(p.x, p.y);
      for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(pts[i].x + side * 0.06, pts[i].y + 0.06);
      const sh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 1 }), M.lining);
      sh.position.z = P_COCKPIT;
      sh.userData.surface = 'metal';
      this.statics.add(sh);
      // A gold pinstripe along the top of the wall, and an LED wash up the shoulder
      // (all of it stopping either side of the door)
      for (const [a, b] of spans(P_COCKPIT, Z_AFT, true)) {
        const l = b - a;
        const m = (a + b) / 2;
        this.box(0.03, 0.025, l, side * (HW - 0.015), 1.84, m, M.gold, { trim: true });
        this.box(0.02, 0.02, l, side * (HW - 0.06), 1.88, m, M.warmLed, { trim: true });
        // A dado rail of walnut at sill height
        this.box(0.05, 0.08, l, side * (HW - 0.025), 0.86, m, M.walnut, { trim: true });
      }
      this.colliders.push({ box: new THREE.Box3(new THREE.Vector3(side < 0 ? -HW - 0.5 : HW, -0.5, P_COCKPIT - 0.2), new THREE.Vector3(side < 0 ? -HW : HW + 0.5, 3, Z_AFT + 0.2)) });
      // The left wall's collider has a gap at the door: put it back in two halves, the door's own collider in between
      if (side === -1) {
        const c = this.colliders[this.colliders.length - 1];
        c.box.max.z = DOOR.z0;
        this.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-HW - 0.5, -0.5, DOOR.z1), new THREE.Vector3(-HW, 3, Z_AFT + 0.2)) });
        this.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-HW - 0.5, DOOR.h, DOOR.z0), new THREE.Vector3(-HW, 3, DOOR.z1)) });
      }
      // Each window: a moulded bezel round an oval, and a short tunnel out through the skin
      const bezelShape = new THREE.Shape();
      bezelShape.moveTo(-0.33, -0.4);
      bezelShape.lineTo(0.33, -0.4);
      bezelShape.lineTo(0.33, 0.4);
      bezelShape.lineTo(-0.33, 0.4);
      bezelShape.lineTo(-0.33, -0.4);
      const hole = new THREE.Path();
      hole.absellipse(0, 0, 0.21, 0.285, 0, Math.PI * 2, true, 0);
      bezelShape.holes.push(hole);
      const bezelGeo = new THREE.ShapeGeometry(bezelShape, 24);
      const bezelMat = new THREE.MeshStandardMaterial({ color: 0xd6ccb9, roughness: 0.5, side: THREE.DoubleSide });
      // A dark rubber seal round the oval
      const ring = new THREE.RingGeometry(1, 1.12, 32);
      ring.scale(0.21, 0.285, 1);
      const tunnelGeo = new THREE.CylinderGeometry(1, 1, 0.16, 24, 1, true);
      tunnelGeo.rotateZ(Math.PI / 2);
      tunnelGeo.scale(1, 0.285, 0.21);
      for (const z of wins) {
        const bz = new THREE.Mesh(bezelGeo, bezelMat);
        bz.position.set(x - side * 0.005, 1.25, z);
        bz.rotation.y = -side * Math.PI / 2;
        this.trim.add(bz);
        const seal = new THREE.Mesh(ring, M.black);
        seal.position.set(x - side * 0.008, 1.25, z);
        seal.rotation.y = -side * Math.PI / 2;
        this.trim.add(seal);
        const tn = new THREE.Mesh(tunnelGeo, M.tunnel);
        tn.position.set(x + side * 0.08, 1.25, z);
        this.trim.add(tn);
      }
    }
  }

  /** A transverse bulkhead across the whole width at z, a doorway in the middle. */
  private bulkhead(z: number, face: Mat, o: { door?: number; doorX?: number; noDoor?: boolean } = {}): void {
    const w = o.door ?? DW;
    const dx = o.doorX ?? 0;
    const l = dx - w / 2;
    const r = dx + w / 2;
    if (o.noDoor) {
      this.box(HW * 2, CEIL, T * 1.5, 0, 0, z, face, { collide: true, occlude: true });
      return;
    }
    this.box(l + HW, CEIL, T * 1.5, (l - HW) / 2, 0, z, face, { collide: true, occlude: true });
    this.box(HW - r, CEIL, T * 1.5, (r + HW) / 2, 0, z, face, { collide: true, occlude: true });
    this.box(w, CEIL - DH, T * 1.5, dx, DH, z, face, { collide: true, occlude: true });
    // A gold frame round the opening, both faces
    for (const s of [-1, 1]) {
      const fz = z + s * (T * 0.75 + 0.012);
      this.box(0.05, DH, 0.025, l - 0.025, 0, fz, this.M.gold, { trim: true });
      this.box(0.05, DH, 0.025, r + 0.025, 0, fz, this.M.gold, { trim: true });
      this.box(w + 0.1, 0.05, 0.025, dx, DH, fz, this.M.gold, { trim: true });
    }
  }

  private partitions(): void {
    const M = this.M;
    // (the galley's doorway as wide as the corridor that runs into it: no corner to catch on running for the door)
    this.bulkhead(P_GALLEY, M.walnut, { door: 2 * CX - T });
    this.bulkhead(P_SUITE, M.walnut);
    this.bulkhead(P_CONF, M.walnut);
    this.bulkhead(P_LOUNGE, M.walnut);
    // The aft pressure bulkhead and the cockpit's front are the ends of the tube
    this.box(HW * 2, CEIL, T, 0, 0, Z_AFT + T / 2, M.lining, { collide: true, occlude: true, surface: 'metal' });
  }

  // -------------------------------------------------------------- aft galley

  private galley(): void {
    const M = this.M;
    // The units against the back wall: ovens, chillers, the coffee
    const back = Z_AFT - 0.4;
    this.box(3.6, 0.95, 0.75, 0, 0, back, M.steel, { collide: true, surface: 'metal' });
    this.box(3.64, 0.04, 0.8, 0, 0.95, back, M.marble, { trim: true });
    this.box(3.6, 0.9, 0.45, 0, 1.45, back + 0.12, M.steel, { surface: 'metal', collide: true });
    for (let i = 0; i < 4; i++) {
      const x = -1.35 + i * 0.9;
      // Oven doors: dark glass with a steel handle
      this.box(0.7, 0.5, 0.02, x, 1.52, back - 0.11, M.black, { trim: true });
      this.box(0.4, 0.025, 0.03, x, 1.95, back - 0.12, M.steel, { trim: true });
      // The carts' bays below: each cart's front with its latch
      this.box(0.4, 0.82, 0.02, x, 0.06, back - 0.385, M.steel, { trim: true });
      this.box(0.08, 0.06, 0.03, x, 0.75, back - 0.4, M.gold, { trim: true });
    }
    // The coffee machine and a stack of cups on the counter
    this.box(0.38, 0.4, 0.32, -1.1, 0.99, back - 0.05, M.black, { trim: true });
    this.cyl(0.04, 0.035, 0.09, -0.6, 0.99, back - 0.15, M.linen, 10, { trim: true });
    this.cyl(0.04, 0.035, 0.09, -0.5, 0.99, back - 0.1, M.linen, 10, { trim: true });
    // A cart out on the floor, by the right wall: cover to come up behind
    this.box(0.42, 1.0, 0.82, 2.2, 0, 26.6, M.steel, { collide: true, surface: 'metal' });
    this.box(0.44, 0.03, 0.84, 2.2, 1.0, 26.6, M.navy, { trim: true });
    this.box(0.42, 1.0, 0.82, 2.2, 0, 25.6, M.steel, { collide: true, surface: 'metal' });
    // The jump seats on the bulkhead either side of its doorway
    for (const x of [-1.6, 1.6]) {
      this.box(0.9, 0.08, 0.45, x, 0.5, P_GALLEY + 0.32, M.navy, { trim: true });
      this.box(0.9, 0.6, 0.08, x, 0.58, P_GALLEY + 0.13, M.navy, { trim: true });
    }
    // The hatch he comes up through: its panel stood up open on its hinge, aft
    this.box(0.8, 0.8, 0.04, 1.2, 0, 28.75, M.steel, { surface: 'metal', rx: -0.3 });
    for (const x of [0.8, 1.6]) this.box(0.03, 0.02, 0.84, x, 0, 28.2, M.steel, { trim: true });
    // A sign over the doorway into the cabin
    this.plane(0.9, 0.22, 0, 2.2, P_GALLEY + T * 0.75 + 0.02, new THREE.MeshStandardMaterial({ map: tex(signCanvas(['CREW ONLY']), 1, 1), roughness: 0.6 }), 0);
  }

  // -------------------------------------------------------------- the suite

  private suite(): { hide: THREE.Vector3; run: THREE.Vector3[] } {
    const M = this.M;
    const z0 = P_SUITE;
    const z1 = P_GALLEY;
    // The corridor's two walls, each with its doorways
    const corridorWall = (side: -1 | 1, doors: number[]): void => {
      const x = side * CX;
      const edges: [number, number][] = [];
      let at = z0 + T;
      for (const d of doors.sort((a, b) => a - b)) {
        edges.push([at, d - 0.45]);
        at = d + 0.45;
      }
      edges.push([at, z1 - T]);
      for (const [a, b] of edges) this.box(T, CEIL, b - a, x, 0, (a + b) / 2, M.walnut, { collide: true, occlude: true });
      for (const d of doors) this.box(T, CEIL - DH, 0.9, x, DH, d, M.walnut, { collide: true, occlude: true });
      for (const d of doors) {
        for (const s of [-1, 1]) this.box(0.025, DH, 0.05, x - side * 0.075, 0, d + s * 0.475, M.gold, { trim: true });
      }
    };
    // Left: the bedroom (z 12.6 .. 23.5, door at 21.4) and its bathroom (z 8 .. 12.6, door at 9.4)
    // Right: the guest room (z 15.6 .. 23.5, door at 17) and the study (z 8 .. 15.6, door at 9.8)
    corridorWall(-1, [21.4, 9.4]);
    corridorWall(1, [17, 9.8]);
    this.box(HW - CX, CEIL, T, -(HW + CX) / 2, 0, 12.6, M.walnut, { collide: true, occlude: true });
    this.box(HW - CX, CEIL, T, (HW + CX) / 2, 0, 15.6, M.walnut, { collide: true, occlude: true });

    // ---- The bedroom: through the door from the corridor, the bed against
    // the outer wall with its head at the far (forward) end under his
    // portrait; a walkway down the corridor side; his wardrobe beyond the bed
    const bx = -2.1;
    this.box(1.35, 0.42, 2.1, bx, 0, 17.8, M.walnut, { collide: true });
    this.box(1.31, 0.2, 2.02, bx, 0.42, 17.8, M.linen, { trim: true });
    this.box(1.45, 1.15, 0.12, bx, 0, 16.68, M.leather, { collide: true });
    this.box(1.37, 0.06, 1.0, bx, 0.62, 18.3, M.navy, { trim: true });
    for (const px of [bx - 0.34, bx + 0.34]) this.box(0.46, 0.14, 0.32, px, 0.62, 17.0, M.linen, { trim: true });
    // A gold-framed portrait of the boss himself over the bed, of course
    this.box(1.0, 0.7, 0.04, bx, 1.35, 16.6, M.gold, { trim: true });
    this.plane(0.9, 0.6, bx, 1.7, 16.63, new THREE.MeshStandardMaterial({ map: tex(signCanvas(['THE BOSS', 'EMPLOYEE OF', 'EVERY MONTH'], '#5a1420', '#f7e3b0', 256, 180), 1, 1) }), 0);
    // A bench at the bed's foot
    this.box(1.1, 0.42, 0.4, bx, 0, 19.2, M.darkLeather, { collide: true });
    // The wardrobe, forward of the bed: where he waits it out
    this.box(0.55, 2.1, 1.6, -1.05, 0, 14.2, M.walnut, { collide: true, occlude: true });
    this.box(0.02, 1.9, 0.02, -1.34, 0.1, 14.2, M.gold, { trim: true });
    // ---- The bathroom: marble, a basin, a gold tap
    this.box(HW - CX - 0.12, 0.02, 4.4, -(HW + CX) / 2, 0.001, 10.3, M.marble, { trim: true });
    this.box(0.6, 0.85, 1.2, -2.45, 0, 10.6, M.marble, { collide: true });
    this.cyl(0.18, 0.12, 0.1, -2.42, 0.85, 10.6, M.linen, 16, { trim: true });
    this.cyl(0.015, 0.015, 0.2, -2.68, 0.85, 10.6, M.gold, 8, { trim: true });
    this.box(0.02, 0.8, 1.0, -2.78, 1.1, 10.6, M.glass, { trim: true });

    // ---- The guest room: a smaller bed, an armchair
    this.box(1.3, 0.42, 2.0, 1.9, 0, 20.4, M.walnut, { collide: true });
    this.box(1.26, 0.2, 1.92, 1.9, 0.42, 20.4, M.linen, { trim: true });
    this.box(1.36, 1.0, 0.12, 1.9, 0, 21.45, M.leather, { collide: true });
    this.sofa(1.95, 16.4, Math.PI, 1, M.leather);
    // ---- The study: a desk under the windows, a chair, a safe
    this.box(0.7, 0.75, 1.6, 2.35, 0, 12.4, M.walnut, { collide: true });
    this.box(0.5, 0.03, 0.35, 2.4, 0.75, 12.0, M.black, { trim: true });
    this.chair(1.75, 12.4, -Math.PI / 2, M.darkLeather);
    this.box(0.6, 0.8, 0.6, 2.4, 0, 9.0, M.steel, { collide: true, surface: 'metal' });
    this.cyl(0.08, 0.08, 0.03, 2.08, 0.5, 9.0, M.gold, 16, { trim: true, rz: Math.PI / 2 });
    // A rug down the corridor
    this.box(0.9, 0.012, z1 - z0 - 0.6, 0, 0.001, (z0 + z1) / 2, M.navy, { trim: true });
    // Little sconces on the corridor walls
    for (let z = 10; z < 23; z += 3) {
      for (const s of [-1, 1]) this.box(0.04, 0.22, 0.1, s * (CX - 0.08), 1.6, z, M.warmLed, { trim: true });
    }

    // Where the boss hides (in the wardrobe's shadow), and his run from there
    // out of the bedroom, down the corridor and across the galley to the door
    // He waits it out in there, just inside the door; then out into the
    // corridor, where he stops and turns to look up the plane (the scene
    // holds him at the third point), and on at a run to the aft door
    const hide = new THREE.Vector3(-1.35, 0, 21.4);
    const run = [
      hide.clone(),
      new THREE.Vector3(-0.2, 0, 21.25),
      new THREE.Vector3(0, 0, 20.9),
      new THREE.Vector3(0, 0, 22.8),
      new THREE.Vector3(-0.6, 0, 24.6),
      new THREE.Vector3(-2.05, 0, 25.6)
    ];
    return { hide, run };
  }

  // -------------------------------------------------------------- conference

  private conference(): void {
    const M = this.M;
    // The long table, down the middle, chairs either side
    this.box(1.15, 0.05, 6.8, 0, 0.74, 1.4, M.walnut, { collide: true });
    this.box(0.5, 0.74, 5.6, 0, 0, 1.4, M.black, {});
    this.box(0.02, 0.006, 6.6, 0, 0.79, 1.4, M.gold, { trim: true });
    for (let i = 0; i < 6; i++) {
      const z = -1.4 + i * 1.12;
      this.chair(-0.95, z, -Math.PI / 2, M.leather);
      this.chair(0.95, z, Math.PI / 2, M.leather);
      // A folder and a glass at each place
      this.box(0.22, 0.01, 0.3, -0.4, 0.79, z, M.navy, { trim: true });
      this.box(0.22, 0.01, 0.3, 0.4, 0.79, z, M.navy, { trim: true });
    }
    // The screen on the forward bulkhead: the quarterly numbers, all bad
    this.box(1.62, 0.95, 0.06, 1.68, 1.05, P_CONF + 0.12, M.black, { trim: true });
    const chart = canvas(512, 290, (g) => {
      g.fillStyle = '#0c1424';
      g.fillRect(0, 0, 512, 290);
      g.fillStyle = '#f2e6c8';
      g.font = 'bold 26px Arial';
      g.fillText('RAVI-CALL SYSTEMS — Q3', 20, 40);
      g.strokeStyle = '#e04040';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(30, 90);
      g.lineTo(140, 120);
      g.lineTo(220, 110);
      g.lineTo(320, 190);
      g.lineTo(400, 230);
      g.lineTo(490, 275);
      g.stroke();
      g.fillStyle = '#e04040';
      g.font = 'bold 22px Arial';
      g.fillText('WITNESSES: TOO MANY', 230, 80);
    });
    this.plane(1.54, 0.87, 1.68, 1.525, P_CONF + 0.155, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex(chart, 1, 1), emissiveIntensity: 0.9 }), 0);
    // The security post: a desk on the right by the aft bulkhead, a wall of monitors
    this.box(0.7, 0.78, 2.2, 2.35, 0, 5.8, M.black, { collide: true, surface: 'metal' });
    this.box(0.74, 0.03, 2.24, 2.33, 0.78, 5.8, M.steel, { trim: true });
    this.chair(1.6, 5.8, -Math.PI / 2, M.darkLeather);
    for (let i = 0; i < 4; i++) {
      const z = 5.0 + (i % 2) * 0.95 + 0.0;
      const y = 1.05 + Math.floor(i / 2) * 0.55;
      this.box(0.05, 0.5, 0.88, 2.72, y - 0.02, z + 0.0, M.black, { trim: true });
      this.plane(0.82, 0.46, 2.69, y + 0.23, z, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex(cctvCanvas(i), 1, 1), emissiveIntensity: 0.8 }), -Math.PI / 2);
    }
    // A rack of radios and a coffee gone cold
    this.box(0.3, 0.12, 0.5, 2.4, 0.81, 6.6, M.black, { trim: true });
    this.cyl(0.04, 0.035, 0.1, 2.3, 0.81, 5.0, M.linen, 10, { trim: true });
    // Credenza on the left with a model of the plane on it
    this.box(0.5, 0.8, 2.6, -2.5, 0, 4.6, M.walnut, { collide: true });
    this.box(0.08, 0.06, 0.6, -2.5, 0.84, 4.6, M.linen, { trim: true });
    this.box(0.5, 0.01, 0.08, -2.5, 0.88, 4.55, M.linen, { trim: true });
  }

  // -------------------------------------------------------------- the lounge

  private lounge(): { chair: THREE.Vector3; cigar: THREE.Vector3 } {
    const M = this.M;
    // A rug the width of it, navy with a gold border
    this.box(4.4, 0.012, 13.6, 0, 0.001, -14, M.navy, { trim: true });
    for (const s of [-1, 1]) this.box(0.08, 0.014, 13.6, s * 2.16, 0.001, -14, M.gold, { trim: true });
    // ---- Left: two long sofas under the windows, each with its table
    this.sofa(-2.25, -9.6, -Math.PI / 2, 3, M.leather);
    this.sofa(-2.25, -16.8, -Math.PI / 2, 3, M.leather);
    for (const z of [-9.6, -16.8]) {
      this.coffeeTable(-1.15, z);
    }
    this.loose.push(this.glass(-1.1, 0.46, -9.3), this.glass(-1.2, 0.46, -16.6), this.glass(-1.05, 0.46, -17.0));
    // ---- Right, aft: the bar, its back wall of bottles lit from behind
    const barX = 1.95;
    this.box(0.55, 1.08, 4.6, barX - 0.5, 0, -9.4, M.walnut, { collide: true, occlude: false });
    this.box(0.7, 0.05, 4.7, barX - 0.52, 1.08, -9.4, M.marble, { trim: true });
    this.box(0.02, 0.06, 4.6, barX - 0.85, 0.15, -9.4, M.gold, { trim: true });
    // Back bar: shelves, glowing panel, bottles
    this.box(0.3, 2.0, 5.2, 2.62, 0, -9.6, M.black, { collide: true, occlude: true });
    const amber = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff9a3c, emissiveIntensity: 0.55 });
    this.box(0.02, 1.3, 5.0, 2.46, 0.85, -9.6, amber, { trim: true });
    const r = rng(31);
    const bottleCols = [0x6a3a10, 0x2b5a2a, 0xe8e0c0, 0x7a1020, 0x3a3a60, 0xc08a30];
    const bottleMats = bottleCols.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }));
    // Each bottle its own mesh (a lathed body and neck), left out of the fold: they can be shot to pieces
    const bottle = (x: number, y: number, z: number, h: number, mat: THREE.Material): void => {
      const pts = [
        new THREE.Vector2(0.0, 0),
        new THREE.Vector2(0.038, 0),
        new THREE.Vector2(0.04, 0.01),
        new THREE.Vector2(0.04, h * 0.72),
        new THREE.Vector2(0.03, h * 0.8),
        new THREE.Vector2(0.014, h * 0.9),
        new THREE.Vector2(0.013, h),
        new THREE.Vector2(0.0, h)
      ];
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 10), mat);
      m.position.set(x, y, z);
      m.userData.surface = 'glass';
      this.group.add(m);
      this.barBottles.push(m);
    };
    for (const y of [0.95, 1.45]) {
      this.box(0.28, 0.025, 5.0, 2.42, y, -9.6, M.walnut, { trim: true });
      for (let z = -11.9; z < -7.3; z += 0.16 + r() * 0.06) bottle(2.38, y + 0.025, z, 0.32 + r() * 0.12, bottleMats[Math.floor(r() * bottleMats.length)]);
    }
    // And a few out on the bar top, open
    for (const [z, k] of [[-11.4, 0], [-10.6, 3], [-9.7, 5], [-8.0, 2]] as [number, number][]) bottle(barX - 0.45, 1.105, z, 0.34, bottleMats[k]);
    // Bar stools
    for (let i = 0; i < 4; i++) {
      const z = -11.2 + i * 1.2;
      this.cyl(0.2, 0.2, 0.06, barX - 1.05, 0.72, z, M.darkLeather, 16);
      this.cyl(0.025, 0.025, 0.72, barX - 1.05, 0, z, M.gold, 8, { trim: true });
      this.cyl(0.18, 0.2, 0.03, barX - 1.05, 0, z, M.gold, 16, { trim: true });
    }
    this.loose.push(this.glass(barX - 0.5, 1.13, -8.4), this.glass(barX - 0.45, 1.13, -10.2), this.glass(barX - 0.55, 1.13, -11.0));
    // An ice bucket and champagne
    this.cyl(0.11, 0.09, 0.22, barX - 0.5, 1.13, -9.0, M.steel, 14, { trim: true });
    bottle(barX - 0.5, 1.2, -9.0, 0.34, bottleMats[1]);

    // ---- Right, forward: the boss's own corner. Two club chairs and his,
    // bigger, gold-legged, facing down the cabin, the cigar still going
    this.club(1.75, -15.9, 0.2, M.darkLeather);
    this.club(1.75, -19.1, Math.PI - 0.2, M.darkLeather);
    const chair = new THREE.Vector3(0.9, 0, -17.5);
    this.club(chair.x, chair.z, Math.PI, M.darkLeather, 1.25);
    this.coffeeTable(1.85, -17.5);
    // His ashtray, cigar, whisky
    this.cyl(0.08, 0.07, 0.03, 1.7, 0.46, -17.3, M.glass, 14, { trim: true });
    const cigar = this.cyl(0.011, 0.011, 0.14, 1.7, 0.5, -17.3, M.darkLeather, 8, { trim: true, rz: Math.PI / 2 });
    void cigar;
    const cigarTip = new THREE.Vector3(1.77, 0.5, -17.3);
    this.loose.push(this.glass(1.95, 0.46, -17.65));
    // A gold bust of him on a plinth by the forward bulkhead
    this.box(0.5, 1.0, 0.5, 2.3, 0, -21.35, M.black, { collide: true });
    const bust = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14), M.gold);
    head.scale.set(0.9, 1.15, 1);
    head.position.y = 0.42;
    bust.add(head);
    const shoulders = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.26, 0.26, 18), M.gold);
    shoulders.position.y = 0.13;
    bust.add(shoulders);
    bust.position.set(2.3, 1.0, -21.35);
    this.statics.add(bust);
    // The TV on the forward bulkhead, showing the boss's own face, in a frame
    this.box(1.7, 1.0, 0.07, -1.66, 1.05, P_LOUNGE + 0.13, M.black, { trim: true });
    const tv = canvas(512, 290, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 290);
      gr.addColorStop(0, '#1e3c72');
      gr.addColorStop(1, '#2a5298');
      g.fillStyle = gr;
      g.fillRect(0, 0, 512, 290);
      g.fillStyle = '#f7d774';
      g.font = 'bold 40px Georgia';
      g.textAlign = 'center';
      g.fillText('BUSINESS WEEKLY', 256, 70);
      g.fillStyle = '#fff';
      g.font = 'bold 30px Georgia';
      g.fillText('"I WORK HARDER THAN', 256, 150);
      g.fillText('ANY OF MY EMPLOYEES"', 256, 190);
      g.font = '22px Georgia';
      g.fillText('— THE BOSS, FROM HIS JET', 256, 250);
    });
    this.plane(1.62, 0.91, -1.66, 1.55, P_LOUNGE + 0.17, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex(tv, 1, 1), emissiveIntensity: 0.75 }), 0);
    // Cushions to fly about later
    for (const [x, z] of [[-2.1, -8.6], [-2.1, -10.6], [-2.1, -15.8], [-2.1, -17.8]] as const) {
      const c = this.box(0.12, 0.34, 0.34, x, 0.48, z, M.navy, { into: this.group, ry: 0.2 });
      c.userData.cushion = true;
      this.loose.push(c);
    }
    return { chair, cigar: cigarTip };
  }

  // -------------------------------------------------------------- forward

  private forward(): void {
    const M = this.M;
    // The crew's galley along the left: counter, chiller, ovens over
    this.box(0.7, 0.95, 3.4, -2.42, 0, -25.0, M.steel, { collide: true, surface: 'metal' });
    this.box(0.74, 0.04, 3.44, -2.42, 0.95, -25.0, M.marble, { trim: true });
    this.box(0.45, 0.85, 3.4, -2.55, 1.45, -25.0, M.steel, { collide: true, surface: 'metal' });
    this.loose.push(this.glass(-2.3, 0.99, -24.2), this.glass(-2.25, 0.99, -25.8));
    // A lavatory, right, its door shut
    this.box(1.3, CEIL, T, 2.15, 0, -25.6, M.walnut, { collide: true, occlude: true });
    this.box(T, CEIL, 2.2, 1.5, 0, -26.75, M.walnut, { collide: true, occlude: true });
    this.box(0.02, 1.95, 0.7, 1.43, 0, -26.6, M.plastic, { trim: true });
    this.plane(0.25, 0.12, 1.42, 1.7, -26.6, new THREE.MeshStandardMaterial({ map: tex(signCanvas(['OCCUPIED'], '#5a1010', '#fff', 256, 96), 1, 1) }), -Math.PI / 2);
    // The crew's jump seats, right, aft of the lav
    this.box(0.9, 0.08, 0.45, 2.1, 0.5, -24.9, M.navy, { trim: true });
    this.box(0.9, 0.6, 0.08, 2.1, 0.58, -25.5, M.navy, { trim: true });
  }

  // -------------------------------------------------------------- cockpit

  private cockpit(): { seats: THREE.Vector3[]; door: Level19Data['cockpitDoor'] } {
    const M = this.M;
    // The cockpit's own bulkhead, its armoured door (hinged on the left, swinging in)
    const z = P_COCKPIT;
    const dw = 0.86;
    this.box(HW - dw / 2, CEIL, 0.16, -(HW + dw / 2) / 2, 0, z, M.lining, { collide: true, occlude: true, surface: 'metal' });
    this.box(HW - dw / 2, CEIL, 0.16, (HW + dw / 2) / 2, 0, z, M.lining, { collide: true, occlude: true, surface: 'metal' });
    this.box(dw, CEIL - 2.0, 0.16, 0, 2.0, z, M.lining, { collide: true, occlude: true, surface: 'metal' });
    const pivot = new THREE.Group();
    pivot.position.set(-dw / 2, 0, z);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(dw, 2.0, 0.07), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.6, roughness: 0.4 }));
    leaf.position.set(dw / 2, 1.0, 0);
    leaf.userData.surface = 'metal';
    pivot.add(leaf);
    // A keypad and a peephole on its cabin side
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.02), M.black);
    pad.position.set(dw - 0.14, 1.25, 0.045);
    pivot.add(pad);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.01), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 1.5 }));
    lamp.position.set(dw - 0.14, 1.34, 0.056);
    pivot.add(lamp);
    // And a word for whoever knocks
    const knockSign = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshStandardMaterial({ map: tex(fitSign(['PILOTS ONLY', 'KNOCK FOR COFFEE'], '#f2f2ee', '#14213d', 384, 220), 1, 1), roughness: 0.6 }));
    knockSign.position.set(dw / 2, 1.62, 0.037);
    pivot.add(knockSign);
    this.group.add(pivot);
    const collider = this.block(-dw / 2, 0, z - 0.06, dw / 2, 2.0, z + 0.06);
    // A sign over it
    this.plane(0.8, 0.18, 0, 2.18, z + 0.09, new THREE.MeshStandardMaterial({ map: tex(signCanvas(['FLIGHT DECK']), 1, 1) }), 0);

    // The cockpit: narrower, its walls angling in to the nose, grey, with its own low ceiling
    const grey = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.7 });
    this.box(3.6, 0.1, Math.abs(Z_NOSE - z), 0, CEIL - 0.2, (z + Z_NOSE) / 2, grey, { surface: 'metal' });
    const w0 = 1.75;
    const w1 = 1.25;
    for (const s of [-1, 1]) {
      const wall = this.box(T, CEIL, 5.0, s * ((w0 + w1) / 2), 0, (z + Z_NOSE) / 2, grey, { collide: true, occlude: true, surface: 'metal', ry: s * Math.atan2(w0 - w1, 5) });
      void wall;
      // Fill between the angled wall and the tube: nobody gets in there
      this.block(s * w1, 0, Z_NOSE, s * HW, CEIL, z);
      // Side panels with switches
      this.box(0.25, 0.4, 1.6, s * (w0 - 0.3), 0.6, z - 1.6, M.black, { trim: true, ry: s * 0.1 });
    }
    // The panel, the glareshield over it, the screens
    this.box(2.4, 0.95, 0.5, 0, 0, Z_NOSE + 0.6, M.black, { collide: true, surface: 'metal' });
    this.box(2.4, 0.1, 0.62, 0, 1.12, Z_NOSE + 0.6, M.black, { trim: true });
    const panel = this.box(2.2, 0.38, 0.05, 0, 0.72, Z_NOSE + 0.86, M.black, { trim: true, rx: -0.25 });
    void panel;
    this.plane(2.1, 0.33, 0, 0.92, Z_NOSE + 0.89, M.screen, 0).rotation.x = -0.25;
    // The pedestal between the seats: throttles
    this.box(0.36, 0.7, 1.1, 0, 0, Z_NOSE + 1.6, M.black, { collide: true, surface: 'metal' });
    for (const tx of [-0.07, 0.07]) this.box(0.035, 0.18, 0.05, tx, 0.7, Z_NOSE + 1.45, M.steel, { trim: true, rx: 0.3 });
    // Overhead panel
    this.box(1.1, 0.06, 1.6, 0, CEIL - 0.08, Z_NOSE + 1.8, M.black, { trim: true });
    // The windscreen: four panes in a dark frame, angled back, the sky through them
    for (let i = 0; i < 4; i++) {
      const x = -0.9 + i * 0.6;
      this.box(0.05, 0.6, 0.05, x - 0.3, 1.22, Z_NOSE + 0.32, M.black, { trim: true, rx: 0.5 });
      void x;
    }
    this.box(2.4, 0.08, 0.1, 0, 1.82, Z_NOSE + 0.1, M.black, { trim: true });
    this.box(2.6, 0.5, 0.06, 0, 1.86, Z_NOSE + 0.1, grey, { surface: 'metal' });
    // The two seats, each a shell on a rail
    const seats = [new THREE.Vector3(-0.55, 0.48, Z_NOSE + 2.05), new THREE.Vector3(0.55, 0.48, Z_NOSE + 2.05)];
    for (const s of seats) {
      this.box(0.55, 0.12, 0.55, s.x, 0.36, s.z, M.darkLeather, {});
      this.box(0.55, 0.62, 0.12, s.x, 0.48, s.z + 0.36, M.darkLeather, { rx: 0.12 });
      this.box(0.22, 0.36, 0.3, s.x, 0, s.z, M.black, {});
      this.block(s.x - 0.3, 0, s.z - 0.3, s.x + 0.3, 1.3, s.z + 0.45);
    }
    // A coffee on the glareshield
    this.cyl(0.04, 0.035, 0.1, 0.8, 1.17, Z_NOSE + 0.7, M.linen, 10, { trim: true });
    // The control columns, one in front of each seat: a post up from the floor and the yoke's horns on it.
    // Their own objects (not folded): they move — pushed forward, she noses down
    this.yokes = seats.map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s.x, 0.12, s.z - 0.62);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.62, 10), M.black);
      post.position.y = 0.31;
      pivot.add(post);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.05), M.black);
      bar.position.y = 0.66;
      pivot.add(bar);
      for (const sx of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.06), M.black);
        horn.position.set(sx * 0.16, 0.73, 0);
        horn.rotation.z = sx * 0.2;
        pivot.add(horn);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), M.steel);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(0, 0.66, 0.03);
      pivot.add(hub);
      this.group.add(pivot);
      return pivot;
    });
    // The ceilings, as solids, for whatever floats up to them in the dive: the cabin's, and the cockpit's lower one
    this.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-HW, CEIL - 0.03, P_COCKPIT), new THREE.Vector3(HW, CEIL + 0.6, Z_AFT)) });
    this.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-HW, CEIL - 0.25, Z_NOSE), new THREE.Vector3(HW, CEIL + 0.6, P_COCKPIT)) });
    return { seats, door: { pivot, collider, at: new THREE.Vector3(0, 0, z + 0.6) } };
  }

  // -------------------------------------------------------------- the aft door

  private aftDoor(): Level19Data['aftDoor'] {
    const M = this.M;
    const leaf = new THREE.Group();
    const zc = (DOOR.z0 + DOOR.z1) / 2;
    const dl = DOOR.z1 - DOOR.z0;
    leaf.position.set(-HW - T / 2, 0, zc);
    // The plug: a thick panel, lined inside, a window and the big handle
    const slab = new THREE.Mesh(new THREE.BoxGeometry(T + 0.04, DOOR.h - 0.02, dl - 0.04), M.lining);
    slab.position.y = DOOR.h / 2;
    slab.userData.surface = 'metal';
    leaf.add(slab);
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.14, 20), M.hole);
    win.rotation.y = Math.PI / 2;
    win.position.set(T / 2 + 0.025, 1.3, 0);
    leaf.add(win);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.7), M.steel);
    handle.position.set(T / 2 + 0.06, 1.0, 0);
    leaf.add(handle);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06, dl - 0.1), M.alarm);
    stripe.position.set(T / 2 + 0.025, 1.75, 0);
    leaf.add(stripe);
    // Placard: the instructions nobody reads
    const plac = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshStandardMaterial({ map: tex(signCanvas(['DO NOT OPEN', 'IN FLIGHT'], '#d8d2c4', '#7a1010', 256, 128), 1, 1) }));
    plac.rotation.y = Math.PI / 2;
    plac.position.set(T / 2 + 0.025, 0.6, 0);
    leaf.add(plac);
    this.group.add(leaf);
    // The frame round it
    for (const s of [-1, 1]) this.box(0.04, DOOR.h, 0.06, -HW + 0.02, 0, zc + s * (dl / 2 + 0.03), M.steel, { trim: true });
    this.box(0.04, 0.06, dl + 0.12, -HW + 0.02, DOOR.h, zc, M.steel, { trim: true });
    const collider = this.block(-HW - 0.5, 0, DOOR.z0, -HW + 0.02, DOOR.h, DOOR.z1);
    return { leaf, collider, at: new THREE.Vector3(-HW + 0.5, 0, zc) };
  }

  /**
   * The emergency closet across from the door: a walnut cupboard on the right
   * wall with two doors (hung on their outer edges, swinging out into the
   * galley), lit inside, three chutes on hooks in it.
   */
  private locker(): { chutes: THREE.Object3D[]; at: THREE.Vector3; doors: THREE.Group[] } {
    const M = this.M;
    const lz = 24.35;
    const D = 0.6;
    const W = 1.3;
    const H = 2.1;
    const fx = HW - D;
    const inside = new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.8 });
    // The carcass: back, sides, top, floor (open at the front)
    this.box(0.04, H, W, HW - 0.02, 0, lz, inside, {});
    for (const s of [-1, 1]) this.box(D, H, 0.04, HW - D / 2, 0, lz + s * (W / 2 - 0.02), M.walnut, {});
    this.box(D, 0.05, W, HW - D / 2, H - 0.05, lz, M.walnut, {});
    this.box(D, 0.06, W, HW - D / 2, 0, lz, M.walnut, {});
    this.block(fx, 0, lz - W / 2, HW, H, lz + W / 2);
    // A light inside it, and the rail the packs hang from
    this.box(0.03, 0.03, W - 0.1, HW - 0.3, H - 0.25, lz, M.steel, { trim: true });
    this.box(0.02, 0.02, W - 0.2, fx + 0.06, H - 0.1, lz, M.warmLed, { trim: true });
    // Over it, the sign; on it, a red stripe so it stands out from the galley
    this.plane(1.0, 0.24, fx - 0.005, H + 0.17, lz, new THREE.MeshStandardMaterial({ map: tex(signCanvas(['EMERGENCY', 'PARACHUTES'], '#8a1010', '#fff', 256, 96), 1, 1) }), -Math.PI / 2);
    // The two doors, each its own hinge
    const doors: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(fx - 0.02, 0, lz + s * (W / 2));
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.035, H - 0.04, W / 2 - 0.01), M.walnut);
      leaf.position.set(0, H / 2, -s * (W / 4));
      leaf.userData.surface = 'wood';
      hinge.add(leaf);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.025), M.gold);
      handle.position.set(-0.03, 1.05, -s * (W / 2 - 0.08));
      hinge.add(handle);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.08, W / 2 - 0.06), new THREE.MeshStandardMaterial({ color: 0x8a1010, roughness: 0.5 }));
      stripe.position.set(-0.02, 1.6, -s * (W / 4));
      hinge.add(stripe);
      this.group.add(hinge);
      doors.push(hinge);
    }
    const chutes: THREE.Object3D[] = [];
    for (let i = 0; i < 3; i++) {
      const p = parachutePack();
      p.position.set(HW - 0.28, 1.25, lz - 0.38 + i * 0.38);
      p.rotation.y = -Math.PI / 2;
      this.group.add(p);
      chutes.push(p);
    }
    return { chutes, at: new THREE.Vector3(fx - 0.75, 0, lz), doors };
  }

  // -------------------------------------------------------------- decor

  /**
   * The finish, and the jokes. Nothing here moves a wall or a doorway or
   * anything anyone takes cover behind: pictures and signs on the walls,
   * small things on surfaces that were already there, a putting green laid
   * flat on the lounge rug, skirting, the air vents. The few props that
   * stand on the floor (a gold lavatory, a shredder) are tucked into corners
   * nobody walks through.
   */
  private decor(): void {
    const M = this.M;
    const matOf = (c: HTMLCanvasElement, glow = 0): THREE.MeshStandardMaterial =>
      glow > 0
        ? new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex(c, 1, 1), emissiveIntensity: glow })
        : new THREE.MeshStandardMaterial({ map: tex(c, 1, 1), roughness: 0.6 });
    /** A framed picture hung on a wall: (x, y, z) its centre on the wall's face, facing along ry (0 is +Z). */
    const picture = (w: number, h: number, x: number, y: number, z: number, ry: number, c: HTMLCanvasElement, frame: Mat = M.gold, glow = 0): void => {
      const nx = Math.sin(ry);
      const nz = Math.cos(ry);
      this.box(w + 0.07, h + 0.07, 0.022, x + nx * 0.012, y - (h + 0.07) / 2, z + nz * 0.012, frame, { trim: true, ry });
      this.plane(w, h, x + nx * 0.025, y, z + nz * 0.025, matOf(c, glow), ry);
    };
    /** A sign straight on a wall, no frame. */
    const sign = (w: number, h: number, x: number, y: number, z: number, ry: number, c: HTMLCanvasElement, glow = 0): THREE.Mesh =>
      this.plane(w, h, x + Math.sin(ry) * 0.012, y, z + Math.cos(ry) * 0.012, matOf(c, glow), ry);
    const FACE = T * 0.75; // half a bulkhead's thickness
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.9, roughness: 0.35 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.6 });

    // ---- All down the cabin: walnut skirting, and the air vents and reading lights in the shoulders
    for (const side of [-1, 1] as const) {
      const runs: [number, number][] = side === -1 ? [[P_COCKPIT, DOOR.z0], [DOOR.z1, Z_AFT]] : [[P_COCKPIT, Z_AFT]];
      for (const [a, b] of runs) this.box(0.03, 0.11, b - a, side * (HW - 0.015), 0, (a + b) / 2, M.walnut, { trim: true });
      for (let z = Z_AFT - 2.0; z > P_COCKPIT + 0.5; z -= 1.6) {
        const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.025, 12), M.steel);
        vent.position.set(side * 1.9, CEIL - 0.01, z);
        this.trim.add(vent);
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.025, 10), M.warmLed);
        lamp.rotation.x = Math.PI / 2;
        lamp.position.set(side * 1.9, CEIL - 0.024, z + 0.09);
        this.trim.add(lamp);
      }
    }

    // ---- The aft galley: the crew's notices by the jump seats, notes on the ovens, the cake
    picture(0.62, 0.62 * 1.333, -1.6, 1.68, P_GALLEY + FACE, 0,
      noticeCanvas('IN AN EMERGENCY', ['1. SAVE THE BOSS', '2. SAVE HIS CIGARS', '3. SAVE HIS GOLF CLUBS', '4. THERE IS NO STEP 4'], { bg: '#f2f2ee', accent: '#b01818' }), M.black);
    picture(0.62, 0.62 * 1.333, 1.6, 1.68, P_GALLEY + FACE, 0,
      noticeCanvas('STAFF NOTICE', ['SMILING IS MANDATORY', 'BREAKS ARE A MYTH', 'BREATHING IS A', 'PRIVILEGE, NOT A RIGHT', '— MANAGEMENT'], { bg: '#f2f2ee', accent: '#1c2741' }), M.black);
    const back = Z_AFT - 0.4;
    sign(0.15, 0.15, -0.45, 1.86, back - 0.13, Math.PI, stickyCanvas(['DO NOT', 'MICROWAVE', 'FISH', '— the Boss'])).rotation.z = 0.08;
    sign(0.15, 0.15, 0.5, 1.84, back - 0.13, Math.PI, stickyCanvas(['WHO ATE', 'MY YOGHURT??', '— Karen'])).rotation.z = -0.1;
    sign(0.15, 0.15, 1.32, 1.66, back - 0.13, Math.PI, stickyCanvas(['Pilots:', 'decaf ONLY.', 'Trust me.'])).rotation.z = 0.05;
    // A cake on the counter, his name on it, and the card that came with it
    const icing = new THREE.MeshStandardMaterial({ color: 0xfdf6ee, roughness: 0.7 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xe86aa0, roughness: 0.6 });
    this.cyl(0.14, 0.14, 0.1, 0.45, 0.99, back - 0.24, icing, 20, { trim: true });
    this.cyl(0.142, 0.142, 0.018, 0.45, 1.06, back - 0.24, pink, 20, { trim: true });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this.cyl(0.005, 0.005, 0.05, 0.45 + Math.cos(a) * 0.08, 1.09, back - 0.24 + Math.sin(a) * 0.08, M.linen, 6, { trim: true });
    }
    const card = this.plane(0.16, 0.11, 0.75, 1.05, back - 0.25, matOf(noticeCanvas('HAPPY B\'DAY BOSS', ['from: everyone', '(attendance', 'was mandatory)'], { w: 256, h: 176, hand: true, accent: '#c0306a' })), Math.PI);
    card.rotation.x = -0.25;
    // An extinguisher in the corner by the bulkhead
    const red = new THREE.MeshStandardMaterial({ color: 0xb8141a, roughness: 0.4, metalness: 0.2 });
    this.cyl(0.07, 0.07, 0.42, -HW + 0.1, 0.25, P_GALLEY + 0.3, red, 14, { trim: true });
    this.cyl(0.02, 0.03, 0.08, -HW + 0.1, 0.67, P_GALLEY + 0.3, M.black, 8, { trim: true });

    // ---- The suite's corridor: him, in gilt, all the way down, and floor lights along the walls
    const corridor: [number, number, HTMLCanvasElement][] = [
      [-1, 11.5, portraitCanvas('baby', 'AGE 2|ALREADY IN CHARGE')],
      [-1, 14.5, portraitCanvas('golf', 'CLUB CHAMPION|(ONLY ENTRANT)')],
      [-1, 17.6, portraitCanvas('nap', 'HARD AT WORK')],
      [1, 11.5, noticeCanvas('THE RULES', ['1. THE BOSS IS', 'ALWAYS RIGHT', '2. SEE RULE 1', '3. SEE RULE 1'], { w: 256, h: 320 })],
      [1, 14.5, portraitCanvas('board', 'MEETING WITH|THE BOARD')],
      [1, 20.4, noticeCanvas('CERTIFICATE', ['WORLD\'S GREATEST', 'BOSS', '', 'awarded by:', 'THE BOSS'], { w: 256, h: 320, bg: '#fbf5e2' })]
    ];
    for (const [s, z, c] of corridor) picture(0.42, 0.525, s * (CX - T / 2), 1.42, z, -s * Math.PI / 2, c);
    for (const s of [-1, 1]) this.box(0.02, 0.006, Z_AFT - P_SUITE - 7.2, s * (CX - T / 2 - 0.02), 0.012, (P_SUITE + P_GALLEY) / 2, M.warmLed, { trim: true });

    // ---- The bedroom: a teddy on his pillows (loose: it floats in the dive, like everything else)
    const fur = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 1 });
    const teddy = new THREE.Group();
    const ball = (r: number, x: number, y: number, z: number, m: Mat = fur): void => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), m);
      b.position.set(x, y, z);
      teddy.add(b);
    };
    ball(0.075, 0, 0.07, 0);
    ball(0.058, 0, 0.18, -0.01);
    for (const s of [-1, 1]) {
      ball(0.022, s * 0.045, 0.23, -0.01);
      ball(0.028, s * 0.07, 0.1, -0.03);
      ball(0.03, s * 0.045, 0.02, -0.06);
    }
    ball(0.024, 0, 0.17, -0.06, new THREE.MeshStandardMaterial({ color: 0xd8b088, roughness: 1 }));
    ball(0.008, 0, 0.18, -0.083, M.black);
    for (const s of [-1, 1]) ball(0.007, s * 0.022, 0.2, -0.057, M.black);
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.012), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.6, roughness: 0.4 }));
    bow.position.set(0, 0.125, -0.055);
    teddy.add(bow);
    teddy.position.set(-2.1, 0.62, 17.3);
    teddy.rotation.y = Math.PI + 0.25;
    this.group.add(teddy);
    this.loose.push(teddy);
    // ---- The bathroom: a gold lavatory, and a word about it
    this.cyl(0.12, 0.15, 0.36, -2.4, 0, 8.62, M.gold, 16);
    this.cyl(0.2, 0.15, 0.08, -2.4, 0.36, 8.62, M.gold, 18);
    this.cyl(0.21, 0.21, 0.025, -2.4, 0.44, 8.62, M.linen, 18, { trim: true });
    this.box(0.42, 0.4, 0.16, -2.4, 0.42, 8.19, M.gold, {});
    this.box(0.06, 0.02, 0.03, -2.25, 0.84, 8.19, M.linen, { trim: true });
    this.block(-2.62, 0, P_SUITE + FACE, -2.18, 0.82, 8.84);
    picture(0.5, 0.3, -1.55, 1.45, P_SUITE + FACE, 0, noticeCanvas('PLEASE NOTE', ['THIS LAVATORY COST', 'MORE THAN YOUR HOUSE', 'FLUSH WITH RESPECT'], { w: 384, h: 230, bg: '#141414', fg: '#e8cf80', accent: '#c9a24a' }), M.gold);
    // ---- The guest room, and what it's for
    sign(0.56, 0.16, 1.9, 0.82, 21.45 - 0.06, Math.PI, fitSign(['GUEST ROOM', '(NO GUESTS)'], '#5a1420', '#f7e3b0', 384, 110));
    // ---- The study: the shredder, busy
    this.box(0.42, 0.56, 0.3, 2.45, 0, 14.95, M.black, { collide: true, surface: 'metal' });
    this.box(0.36, 0.06, 0.22, 2.45, 0.56, 14.95, M.steel, { trim: true });
    const r = rng(77);
    for (let i = 0; i < 9; i++) this.box(0.012, 0.08 + r() * 0.06, 0.004, 2.32 + i * 0.03, 0.6, 14.92 + (r() - 0.5) * 0.08, M.linen, { trim: true, rz: (r() - 0.5) * 0.5 });
    sign(0.13, 0.13, 2.45, 0.4, 14.95 - 0.151, Math.PI, stickyCanvas(['EVIDENCE', 'GOES', 'HERE →']));

    // ---- The conference room: the plan on the whiteboard, his wanted man, a poster, everyone's place cards
    const wbz = P_SUITE - FACE;
    this.box(1.42, 0.92, 0.03, -1.75, 0.98, wbz - 0.015, M.steel, { trim: true });
    sign(1.34, 0.84, -1.75, 1.44, wbz - 0.03, Math.PI, whiteboardCanvas());
    this.box(0.5, 0.03, 0.06, -1.75, 0.95, wbz - 0.05, M.steel, { trim: true });
    picture(0.44, 0.585, 1.6, 1.45, wbz, Math.PI, wantedCanvas(), darkWood);
    picture(0.62, 0.775, -1.7, 1.42, P_CONF + FACE, 0, ambitionCanvas(), M.black);
    for (let i = 0; i < 6; i++) {
      const z = -1.4 + i * 1.12;
      for (const s of [-1, 1]) {
        const n = i * 2 + (s < 0 ? 1 : 2);
        this.box(0.17, 0.065, 0.006, s * 0.22, 0.79, z, M.linen, { trim: true, ry: s * Math.PI / 2 });
        this.plane(0.16, 0.06, s * 0.224, 0.8225, z, matOf(fitSign([`YES-MAN #${n}`], '#fdfbf4', '#1c2741', 256, 96)), s * Math.PI / 2);
      }
    }
    // Over the doorways: what the rooms are
    sign(0.95, 0.22, 0, 2.22, P_SUITE - FACE, Math.PI, fitSign(['PRIVATE SUITE', 'DO NOT DISTURB']));
    sign(0.95, 0.22, 0, 2.22, P_CONF + FACE, 0, fitSign(['NO BAD NEWS', 'PAST THIS POINT'], '#5a1420', '#f7e3b0'));
    sign(0.95, 0.22, 0, 2.22, P_CONF - FACE, Math.PI, fitSign(['THE BOARDROOM']));

    // ---- The lounge
    // His dartboard, Ravi's photo pinned to it, and the darts in Ravi
    const dz = P_CONF - FACE;
    this.cyl(0.24, 0.24, 0.04, -1.55, 1.42, dz - 0.02, new THREE.MeshStandardMaterial({ map: tex(dartboardCanvas(), 1, 1), roughness: 0.8 }), 32, { trim: true, rx: -Math.PI / 2 });
    const photo = this.plane(0.15, 0.19, -1.5, 1.47, dz - 0.047, matOf(raviPhotoCanvas()), Math.PI);
    photo.rotation.z = 0.12;
    for (const [px, py, a] of [[-1.47, 1.5, 0.2], [-1.53, 1.44, -0.3], [-1.46, 1.41, 0.5]] as const) {
      const dart = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.11, 6), M.steel);
      dart.rotation.set(Math.PI / 2 - 0.25, a, 0);
      dart.position.set(px, py + 0.01, dz - 0.1);
      this.trim.add(dart);
      const flight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.002), new THREE.MeshStandardMaterial({ color: 0xd02020, side: THREE.DoubleSide }));
      flight.position.set(px + Math.sin(a) * 0.05, py + 0.025, dz - 0.15);
      flight.rotation.y = a;
      this.trim.add(flight);
    }
    sign(0.5, 0.34, 1.7, 1.7, dz, Math.PI, noticeCanvas('NO SMOKING', ['(except the Boss)'], { w: 300, h: 204, bg: '#f4f4f0', accent: '#c01818', hand: true }));
    // A neon over the bar's back wall
    const neon = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 0.24),
      new THREE.MeshBasicMaterial({ map: tex(neonCanvas(['Happy Hour 24/7'], '#ff3fa8'), 1, 1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    neon.position.set(2.425, 2.03, -9.6);
    neon.rotation.y = -Math.PI / 2;
    this.trim.add(neon);
    // A tip jar on the bar, and whose tips they are
    this.cyl(0.055, 0.05, 0.14, 1.35, 1.13, -7.55, M.glass, 14, { trim: true });
    for (let i = 0; i < 4; i++) this.box(0.05, 0.004, 0.03, 1.35 + (i - 1.5) * 0.012, 1.14 + i * 0.012, -7.55, new THREE.MeshStandardMaterial({ color: 0x7ab87a }), { trim: true, ry: i });
    this.plane(0.09, 0.05, 1.295, 1.2, -7.55, matOf(fitSign(['TIPS', '(for the Boss)'], '#fdfbf4', '#1c2741', 192, 108)), -Math.PI / 2);
    // A mirror ball, because it's his plane
    const discoMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 1, roughness: 0.15, flatShading: true });
    const disco = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), discoMat);
    disco.position.set(0, CEIL - 0.34, -13.4);
    this.trim.add(disco);
    this.cyl(0.004, 0.004, 0.2, 0, CEIL - 0.2, -13.4, M.steel, 6, { trim: true });
    // The boss's putting green, flat on the rug between the sofas: a hole, a flag, balls, his putter against the wall
    const green = new THREE.MeshStandardMaterial({ color: 0x2f7a32, roughness: 0.95 });
    this.box(1.3, 0.008, 3.4, -1.85, 0.013, -13.2, green, { trim: true });
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), M.black);
    cup.rotation.x = -Math.PI / 2;
    cup.position.set(-2.2, 0.0225, -14.5);
    this.trim.add(cup);
    this.cyl(0.006, 0.006, 0.75, -2.2, 0.02, -14.5, M.linen, 6, { trim: true });
    const flag = this.plane(0.2, 0.13, -2.1, 0.69, -14.5, matOf(fitSign(['18'], '#c01818', '#ffffff', 128, 84)), 0);
    (flag.material as THREE.Material).side = THREE.DoubleSide;
    for (const [bx, bz] of [[-1.45, -12.05], [-1.6, -12.3], [-1.32, -11.85]] as const) {
      const golfBall = new THREE.Mesh(new THREE.SphereGeometry(0.021, 10, 8), M.linen);
      golfBall.position.set(bx, 0.042, bz);
      this.group.add(golfBall);
      this.loose.push(golfBall);
    }
    this.cyl(0.007, 0.007, 0.86, -HW + 0.1, 0, -11.25, M.steel, 6, { trim: true, rz: -0.16 });
    this.box(0.1, 0.03, 0.025, -HW + 0.06, 0.0, -11.25, M.black, { trim: true });
    const stake = this.plane(0.26, 0.16, -1.24, 0.22, -14.95, matOf(fitSign(['PAR 1', 'HE NEVER MISSES'], '#1a4a1c', '#f2e6c8', 256, 160)), Math.PI / 2);
    stake.rotation.x = -0.2;
    this.cyl(0.005, 0.005, 0.18, -1.24, 0.013, -14.95, M.walnut, 6, { trim: true });
    // His mug, on his table by the cigar
    const mug = new THREE.Group();
    const mugBody = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.038, 0.09, 16), new THREE.MeshStandardMaterial({ map: tex(mugCanvas('WORLD\'S BEST BOSS'), 1, 1), roughness: 0.3 }));
    mugBody.position.y = 0.045;
    mug.add(mugBody);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 6, 12), M.linen);
    handle.position.set(0.045, 0.048, 0);
    mug.add(handle);
    mug.position.set(2.02, 0.46, -17.22);
    mug.rotation.y = 2.2;
    this.group.add(mug);
    this.loose.push(mug);
    // A brass plate on the bust's plinth, and the club he's founded
    this.plane(0.36, 0.1, 2.3, 0.78, -21.35 + 0.255, matOf(fitSign(['THE BOSS, IN SOLID GOLD', '(he paid for it himself)'], '#3a2a10', '#f2d68a', 384, 108)), 0);
    picture(0.6, 0.3, 1.2, 1.55, P_LOUNGE + FACE, 0, noticeCanvas('MILE HIGH CLUB', ['FOUNDING MEMBER:', 'THE BOSS', 'MEMBERS: 1'], { w: 384, h: 192, bg: '#1c1208', fg: '#f2d68a', accent: '#c9a24a' }), brass);

    // ---- Forward: the crew's menu, and a word on the flight deck's door (that one's on the door itself, in cockpit())
    picture(0.86, 0.4, -2.3, 1.86, -25.0, Math.PI / 2, noticeCanvas('IN-FLIGHT MENU', ['Caviar ......... the Boss', 'Lobster ........ the Boss', 'Champagne ..... the Boss', 'Tap water ........ staff'], { w: 512, h: 238, bg: '#14181e', fg: '#e8e2d0', accent: '#c9a24a' }), darkWood);

    // ---- The cockpit: dice off the overhead, a nodding boss on the glareshield, the password, the manual
    const diceMat = new THREE.MeshStandardMaterial({ map: tex(diceCanvas(), 1, 1), roughness: 0.9 });
    for (const [dx, drop] of [[0.12, 0.22], [0.2, 0.27]] as const) {
      this.cyl(0.002, 0.002, drop, dx, CEIL - 0.2 - drop, Z_NOSE + 0.85, M.black, 4, { trim: true });
      const die = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.055), diceMat);
      die.position.set(dx, CEIL - 0.2 - drop - 0.03, Z_NOSE + 0.85);
      die.rotation.set(0.3, dx * 4, 0.2);
      this.trim.add(die);
    }
    const nod = new THREE.Group();
    const nbody = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0x20232b }));
    nbody.position.y = 0.035;
    nod.add(nbody);
    const nhead = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd9a57c }));
    nhead.position.y = 0.105;
    nhead.scale.set(1, 1.1, 1);
    nod.add(nhead);
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), new THREE.MeshStandardMaterial({ color: 0x4a2e1c }));
    beard.position.y = 0.105;
    beard.rotation.x = 0.35;
    nod.add(beard);
    const ncap = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.45), M.navy);
    ncap.position.y = 0.112;
    nod.add(ncap);
    nod.position.set(-0.85, 1.22, Z_NOSE + 0.45);
    nod.rotation.y = 0.3;
    this.trim.add(nod);
    const note = this.plane(0.075, 0.075, 0.62, 0.95, Z_NOSE + 0.905, matOf(stickyCanvas(['PASSWORD:', 'boss123'])), 0);
    note.rotation.x = -0.25;
    note.rotation.z = -0.08;
    this.box(0.17, 0.03, 0.24, 0.0, 0.7, Z_NOSE + 1.95, new THREE.MeshStandardMaterial({ color: 0xf2c81a, roughness: 0.7 }), { trim: true, ry: 0.15 });
    const book = this.plane(0.16, 0.23, 0.0, 0.732, Z_NOSE + 1.95, matOf(noticeCanvas('FLYING', ['FOR BEGINNERS', '', 'CH.1: WHICH END', 'IS THE FRONT?'], { w: 256, h: 368, bg: '#f2c81a', fg: '#1a1a1a', accent: '#1a1a1a' })), 0);
    book.rotation.set(-Math.PI / 2, 0, 0.15);
  }

  // -------------------------------------------------------------- furniture

  /** A sofa (n seats) facing `ry` (0: facing −Z). */
  private sofa(x: number, z: number, ry: number, n: number, mat: Mat): void {
    const g = new THREE.Group();
    const W = n * 0.72;
    const part = (w: number, h: number, d: number, px: number, py: number, pz: number, m: Mat = mat): void => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(px, py + h / 2, pz);
      b.userData.surface = 'wood';
      g.add(b);
    };
    part(W, 0.24, 0.85, 0, 0.08, 0);
    part(W, 0.08, 0.85, 0, 0, 0, this.M.walnut);
    for (let i = 0; i < n; i++) part(0.7, 0.12, 0.68, -W / 2 + 0.36 + i * 0.72, 0.32, -0.06);
    part(W, 0.48, 0.18, 0, 0.32, 0.34);
    for (const s of [-1, 1]) part(0.16, 0.36, 0.85, s * (W / 2 + 0.08), 0.08, 0);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.statics.add(g);
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g);
    bb.max.y = Math.min(bb.max.y, 0.55);
    this.colliders.push({ box: bb });
  }

  /** A club armchair, deep and round-armed. */
  private club(x: number, z: number, ry: number, mat: Mat, k = 1): void {
    const g = new THREE.Group();
    const part = (w: number, h: number, d: number, px: number, py: number, pz: number, m: Mat = mat): void => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w * k, h * k, d * k), m);
      b.position.set(px * k, (py + h / 2) * k, pz * k);
      b.userData.surface = 'wood';
      g.add(b);
    };
    part(0.66, 0.26, 0.7, 0, 0.12, 0);
    part(0.6, 0.12, 0.58, 0, 0.38, -0.04);
    part(0.66, 0.52, 0.16, 0, 0.38, 0.3);
    for (const s of [-1, 1]) part(0.14, 0.32, 0.7, s * 0.36, 0.26, 0);
    for (const s of [-1, 1]) for (const t of [-1, 1]) part(0.04, 0.12, 0.04, s * 0.3, 0, t * 0.3, this.M.gold);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.statics.add(g);
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g);
    bb.max.y = 0.6;
    // A touch smaller than its drawn bounds: it's round-armed and turned
    bb.expandByVector(new THREE.Vector3(-0.08, 0, -0.08));
    this.colliders.push({ box: bb });
  }

  private chair(x: number, z: number, ry: number, mat: Mat): void {
    const g = new THREE.Group();
    const part = (w: number, h: number, d: number, px: number, py: number, pz: number, m: Mat = mat): void => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(px, py + h / 2, pz);
      b.userData.surface = 'wood';
      g.add(b);
    };
    part(0.5, 0.1, 0.5, 0, 0.42, 0);
    part(0.5, 0.55, 0.08, 0, 0.5, 0.24);
    part(0.06, 0.42, 0.06, 0, 0, 0, this.M.steel);
    part(0.4, 0.03, 0.4, 0, 0, 0, this.M.steel);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.statics.add(g);
    this.colliders.push({ box: new THREE.Box3(new THREE.Vector3(x - 0.24, 0, z - 0.24), new THREE.Vector3(x + 0.24, 0.52, z + 0.24)) });
  }

  private coffeeTable(x: number, z: number): void {
    this.cyl(0.42, 0.42, 0.03, x, 0.42, z, this.M.walnut, 24);
    this.cyl(0.43, 0.43, 0.012, x, 0.448, z, this.M.gold, 24, { trim: true });
    this.cyl(0.05, 0.08, 0.42, x, 0, z, this.M.gold, 12, { trim: true });
    this.colliders.push({ box: new THREE.Box3(new THREE.Vector3(x - 0.4, 0, z - 0.4), new THREE.Vector3(x + 0.4, 0.45, z + 0.4)) });
  }

  /** A crystal tumbler (loose: it's kept as itself, to fly about later). */
  private glass(x: number, y: number, z: number): THREE.Object3D {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 12), this.M.glass);
    m.position.set(x, y + 0.045, z);
    this.group.add(m);
    return m;
  }

  // -------------------------------------------------------------- lights

  private lights(): void {
    const add = (x: number, y: number, z: number, c: number, i: number, d: number, list = this.cabinLights): THREE.PointLight => {
      const l = new THREE.PointLight(c, i, d, 1.6);
      l.position.set(x, y, z);
      this.group.add(l);
      list.push(l);
      return l;
    };
    add(0, 2.15, 26.6, 0xf2f4ff, 6, 9);
    add(0, 2.15, 15.5, 0xffd7a8, 4.5, 9);
    add(-1.75, 2.1, 17.4, 0xffc890, 3.2, 6);
    add(1.75, 2.1, 12.5, 0xffd7a8, 2.6, 6);
    add(0, 2.2, 1.2, 0xfff0dc, 6.5, 11);
    add(0, 2.2, -10, 0xffcf98, 6.5, 11);
    add(0, 2.2, -17.5, 0xffcf98, 6.5, 11);
    add(2.2, 1.4, -9.6, 0xffa45a, 2.6, 4.5);
    add(0, 2.1, -25.2, 0xf2f4ff, 4.5, 8);
    add(0, 1.9, -30.8, 0x9ab8ff, 1.8, 5);
    // The alarm: two red lamps, there from the start at nothing
    for (const z of [-14, 14]) add(0, 2.25, z, 0xff2010, 0, 18, this.alarmLights);
    for (const z of [-25, -3, 18, 26]) this.box(0.18, 0.05, 0.18, 0, CEIL - 0.05, z, this.M.alarm, { trim: true });
    const hemi = new THREE.HemisphereLight(0xdfe6f2, 0x3a3026, 0.2);
    this.group.add(hemi);
  }

  // -------------------------------------------------------------- enemies

  private guards(): GuardSpawn[] {
    const g = (x: number, z: number, yaw: number, zone: number, section: GuardSpawn['section']): GuardSpawn => ({ pos: new THREE.Vector3(x, 0, z), yaw, zone, section });
    return [
      // The suite: one at the galley door with his back to it, one going
      // round the guest room and out into the corridor, one in the study
      g(0, 22.3, 0, 0, 'suite'),
      g(1.9, 19.2, Math.PI, 2.6, 'suite'),
      g(1.8, 11.0, Math.PI / 2, 0, 'suite'),
      // Conference: two walking round the table, one at the security post
      g(-1.9, 3.5, 0, 5.5, 'conf'),
      g(1.9, -1.5, Math.PI, 5.5, 'conf'),
      g(1.65, 4.3, -Math.PI / 2, 0, 'conf'),
      // The lounge: one at the bar, two walking, one by the boss's chair
      g(0.6, -10.8, -Math.PI / 2, 0, 'lounge'),
      g(-0.6, -13.0, 0, 6, 'lounge'),
      g(0.3, -19.5, Math.PI, 6, 'lounge'),
      g(1.3, -16.0, Math.PI * 0.6, 0, 'lounge'),
      // Forward: one on the cockpit door
      g(0.2, -26.6, Math.PI, 0, 'fwd')
    ];
  }

  // -------------------------------------------------------------- waypoints

  /** Sampled walkable floor, linked wherever a body can be swept between two points. */
  private waypoints(ignore: Collider[]): Waypoint[] {
    const R = 0.36;
    const walls = this.colliders.filter((c) => !ignore.includes(c)).map((c) => c.box).filter((b) => b.min.y < 1.5 && b.max.y > 0.2);
    const clear = (x: number, z: number, r = R): boolean => {
      for (const b of walls) if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return false;
      return true;
    };
    const walkable = (ax: number, az: number, bx: number, bz: number): boolean => {
      const dx = bx - ax;
      const dz = bz - az;
      const n = Math.ceil(Math.hypot(dx, dz) / 0.15);
      for (let i = 1; i < n; i++) if (!clear(ax + (dx * i) / n, az + (dz * i) / n, R + 0.04)) return false;
      return true;
    };
    const pts: [number, number][] = [];
    // The doorways and the corridor's middle first: they're narrower than the grid
    for (const z of [P_GALLEY, P_SUITE, P_CONF, P_LOUNGE]) for (const dz of [-0.6, 0, 0.6]) pts.push([0, z + dz]);
    for (const [x, z] of [[-CX, 21.4], [-CX, 9.4], [CX, 17], [CX, 9.8]] as const) {
      const s = Math.sign(x);
      for (const dx of [-0.55, 0, 0.55]) pts.push([x + s * dx, z]);
    }
    for (let z = Z_AFT - 0.5; z > P_COCKPIT + 0.3; z -= 0.8) {
      for (let x = -HW + 0.45; x <= HW - 0.45; x += 0.8) pts.push([x, z]);
      pts.push([0, z]);
    }
    const ok = pts.filter(([x, z]) => clear(x, z));
    const wps: Waypoint[] = ok.map(([x, z]) => ({ pos: new THREE.Vector3(x, 0, z), links: [] }));
    for (let i = 0; i < wps.length; i++) {
      for (let j = i + 1; j < wps.length; j++) {
        const a = wps[i].pos;
        const b = wps[j].pos;
        if (a.distanceTo(b) > 1.75) continue;
        if (!walkable(a.x, a.z, b.x, b.z)) continue;
        wps[i].links.push(j);
        wps[j].links.push(i);
      }
    }
    // Keep the biggest island only
    const seen = new Set<number>();
    let best: number[] = [];
    for (let i = 0; i < wps.length; i++) {
      if (seen.has(i)) continue;
      const comp: number[] = [];
      const q = [i];
      seen.add(i);
      while (q.length) {
        const c = q.pop()!;
        comp.push(c);
        for (const n of wps[c].links) if (!seen.has(n)) {
          seen.add(n);
          q.push(n);
        }
      }
      if (comp.length > best.length) best = comp;
    }
    const keep = new Map<number, number>();
    best.sort((a, b) => a - b).forEach((old, k) => keep.set(old, k));
    return best.map((old) => ({ pos: wps[old].pos, links: wps[old].links.filter((l) => keep.has(l)).map((l) => keep.get(l)!) }));
  }

  // -------------------------------------------------------------- outside

  /**
   * The sky: a dome, deep blue overhead to a pale haze at the horizon, the
   * sun low on the right; and two decks of cloud far below, the near one
   * broken, the far one solid. All of it fog-free and unlit.
   */
  private outside(): { group: THREE.Group; maps: THREE.Texture[] } {
    const group = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1800, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { sun: { value: new THREE.Vector3(0.8, 0.28, -0.5).normalize() } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          uniform vec3 sun; varying vec3 vDir;
          void main(){
            float h = vDir.y;
            vec3 top = vec3(0.10,0.27,0.62);
            vec3 hor = vec3(0.52,0.70,0.93);
            vec3 below = vec3(0.36,0.52,0.68);
            vec3 c = h > 0.0 ? mix(hor, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(hor, below, clamp(-h*6.0,0.0,1.0));
            float s = max(dot(normalize(vDir), sun), 0.0);
            c += vec3(1.0,0.92,0.75) * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25);
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`
      })
    );
    dome.renderOrder = -2;
    group.add(dome);
    const maps: THREE.Texture[] = [];
    // Each layer thins out to nothing toward its edge, well inside the
    // camera's far plane, so neither a plane's edge nor the clip ever shows
    const fade = new THREE.CanvasTexture(
      canvas(128, 128, (g) => {
        const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        gr.addColorStop(0, '#fff');
        gr.addColorStop(0.45, '#fff');
        gr.addColorStop(1, '#000');
        g.fillStyle = gr;
        g.fillRect(0, 0, 128, 128);
      })
    );
    const deck = (y: number, size: number, rep: number, seed: number, density: number, opacity: number): void => {
      const map = tex(cloudCanvas(seed, density), rep, rep);
      maps.push(map);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ map, alphaMap: fade, color: 0xeef2f8, transparent: true, opacity, depthWrite: false, fog: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.renderOrder = -1;
      group.add(m);
    };
    // The sea, miles down: deep blue, a ripple of light on it
    const seaC = canvas(256, 256, (g) => {
      const r = rng(77);
      g.fillStyle = '#163f66';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1800; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(40,96,140,0.35)' : 'rgba(10,36,64,0.35)';
        g.fillRect(r() * 256, r() * 256, 2 + r() * 6, 1);
      }
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ map: tex(seaC, 16, 16), alphaMap: fade, transparent: true, fog: false, depthWrite: false }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -2600;
    sea.renderOrder = -1.5;
    group.add(sea);
    deck(-1100, 7000, 4, 41, 0.42, 0.85);
    deck(-300, 7000, 9, 42, 0.3, 0.7);
    return { group, maps };
  }
}

/**
 * A parachute pack: the container with its flaps and the ripcord handle, and
 * the harness hanging off it. Its back (the side against a man) faces +Z,
 * its top up. About 0.5 × 0.6 × 0.2.
 */
export function parachutePack(): THREE.Group {
  const g = new THREE.Group();
  const nylon = new THREE.MeshStandardMaterial({ color: 0x1d2a4a, roughness: 0.8 });
  const trimM = new THREE.MeshStandardMaterial({ color: 0xd04020, roughness: 0.6 });
  const strap = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.56, 0.18), nylon);
  g.add(body);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.04), nylon);
  flap.position.set(0, 0.2, -0.1);
  flap.rotation.x = 0.12;
  g.add(flap);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.02, 0.19), trimM);
  edge.position.y = 0.28;
  g.add(edge);
  const pilot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), trimM);
  pilot.rotation.x = Math.PI / 2;
  pilot.position.set(0.16, -0.22, -0.1);
  g.add(pilot);
  for (const s of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.02), strap);
    sh.position.set(s * 0.14, 0.02, 0.1);
    g.add(sh);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.02), metal);
    buckle.position.set(s * 0.14, -0.08, 0.115);
    g.add(buckle);
  }
  return g;
}
