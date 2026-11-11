import * as THREE from 'three';
import type { Collider } from './OfficeLevelBuilder';
import type { CombatLevel } from '../scenes/CombatScene';
import { makeCanvas, tiling } from './Level8Builder';
import { mergeStatic } from './mergeStatic';
import { quadShotgunModel } from '../entities/QuadShotgun';

/**
 * Level14Builder — the laboratory behind the blast door.
 *
 *  The lab (x −12..12, z −9..9, floor at 0): Ravi comes in through the
 *  smoking breach in the west wall. Benches of flasks and microscopes, a desk
 *  with a typed report on it, operating tables under surgical lamps, tanks of
 *  green fluid with things floating in them, posters of organs nobody has
 *  heard of, giant machines along the east wall. An open weapons crate in
 *  the middle with a quad-barrel shotgun in it. Double doors in the north
 *  wall (the scientists come through those), a single door in the south wall
 *  (the last one, with the launcher).
 *
 *  The hallway (x 4..8, z 9..62) runs north from behind the north wall; a
 *  plug of wall hides its mouth until the rocket takes it out. Its walls and
 *  ceiling come in as separate pieces so the scene can cave them in. At its
 *  end the floor drops away into a pit of purple mist, the portal hung over it.
 */

export const ROOM = { x0: -12, x1: 12, z0: -9, z1: 9, h: 4.6 };
export const HALL = { x0: 4, x1: 8, z0: 9, z1: 62, h: 3.8, pit: 54.5 };
/** Where he stands to take the gun out of the crate (facing −Z), and the crate. */
export const STAND = new THREE.Vector3(0.5, 0, -1.02);
export const CRATE = new THREE.Vector3(0.5, 0, -1.75);

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export interface HallPiece {
  /** Pivot group: a wall's along its foot, the ceiling's at its middle. */
  obj: THREE.Group;
  kind: 'wallL' | 'wallR' | 'ceil';
  z: number;
  /** Shut off until it's down, then it blocks the way. */
  collider: Collider;
  fallen: boolean;
}

export interface Level14Data extends CombatLevel {
  start: { pos: THREE.Vector3; yaw: number };
  paper: { mesh: THREE.Mesh; front: THREE.Vector3 };
  crate: { gun: THREE.Group; gunPump: THREE.Group };
  sciDoor: { leaves: THREE.Group[]; collider: Collider; at: THREE.Vector3 };
  rocketDoor: { leaf: THREE.Group; collider: Collider; at: THREE.Vector3 };
  plug: { obj: THREE.Group; collider: Collider; at: THREE.Vector3; edges: THREE.Group };
  hallPieces: HallPiece[];
  portal: { center: THREE.Vector3; mat: THREE.ShaderMaterial; ring: THREE.Mesh; light: THREE.PointLight; mist: THREE.Sprite[] };
  lights: { lamps: THREE.PointLight[]; hall: THREE.PointLight[]; red: THREE.PointLight[] };
  /** The ceiling fittings, which come down with the room. */
  fixtures: THREE.Object3D[];
  tankGlow: THREE.MeshStandardMaterial[];
  floaters: THREE.Object3D[];
  screens: { tex: THREE.CanvasTexture; draw: (t: number) => void }[];
  breach: THREE.Vector3;
}

// ----------------------------------------------------------------- textures

function floorTex(): THREE.CanvasTexture {
  const c = makeCanvas(512, 512);
  const g = c.getContext('2d')!;
  g.fillStyle = '#8d9690';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const v = 128 + Math.floor((Math.random() - 0.5) * 16);
      g.fillStyle = `rgb(${v + 8},${v + 16},${v + 10})`;
      g.fillRect(i * 128 + 2, j * 128 + 2, 124, 124);
    }
  for (let k = 0; k < 2600; k++) {
    const v = Math.floor(Math.random() * 60 + 60);
    g.fillStyle = `rgba(${v},${v + 4},${v},${Math.random() * 0.18})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // Grime in the grout and blooms of old stains
  for (let k = 0; k < 14; k++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 20 + Math.random() * 60;
    const gr = g.createRadialGradient(x, y, 2, x, y, r);
    gr.addColorStop(0, `rgba(${60 + Math.random() * 30},${50 + Math.random() * 20},40,0.22)`);
    gr.addColorStop(1, 'rgba(60,50,40,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(40,44,40,0.8)';
  g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * 128, 0);
    g.lineTo(i * 128, 512);
    g.moveTo(0, i * 128);
    g.lineTo(512, i * 128);
    g.stroke();
  }
  return tiling(c);
}

function wallTex(): THREE.CanvasTexture {
  const c = makeCanvas(512, 512);
  const g = c.getContext('2d')!;
  // Upper half painted, lower half small ceramic tiles
  g.fillStyle = '#7f8c86';
  g.fillRect(0, 0, 512, 256);
  for (let k = 0; k < 1800; k++) {
    g.fillStyle = `rgba(40,50,45,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 512, Math.random() * 256, 3, 3);
  }
  // Drips of something down the paint
  for (let k = 0; k < 7; k++) {
    const x = Math.random() * 512;
    const len = 30 + Math.random() * 140;
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, 'rgba(70,60,30,0.25)');
    gr.addColorStop(1, 'rgba(70,60,30,0)');
    g.fillStyle = gr;
    g.fillRect(x, 0, 2 + Math.random() * 4, len);
  }
  g.fillStyle = '#3f4a46';
  g.fillRect(0, 250, 512, 10);
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 8; j++) {
      const v = 190 + Math.floor(Math.random() * 20);
      g.fillStyle = `rgb(${v - 20},${v},${v - 8})`;
      g.fillRect(i * 32 + 1, 260 + j * 32 + 1, 30, 30);
    }
  for (let k = 0; k < 900; k++) {
    g.fillStyle = `rgba(60,70,60,${Math.random() * 0.12})`;
    g.fillRect(Math.random() * 512, 260 + Math.random() * 252, 3, 3);
  }
  return tiling(c);
}

function ceilTex(): THREE.CanvasTexture {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d')!;
  g.fillStyle = '#4b514f';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#5d6462';
  g.fillRect(4, 4, 120, 120);
  g.fillRect(132, 4, 120, 120);
  g.fillRect(4, 132, 120, 120);
  g.fillRect(132, 132, 120, 120);
  for (let k = 0; k < 600; k++) {
    g.fillStyle = `rgba(20,20,20,${Math.random() * 0.15})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  return tiling(c);
}

/** Wraps `text` to lines no wider than `w` pixels in the context's current font. */
function wrap(g: CanvasRenderingContext2D, text: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (g.measureText(t).width > w && line) {
      out.push(line);
      line = word;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** The typed report on the desk. */
export function paperTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 1448;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  // Aged paper: off-white, fibres, a darker edge, a coffee ring
  g.fillStyle = '#ebe3cd';
  g.fillRect(0, 0, W, H);
  for (let k = 0; k < 9000; k++) {
    const v = 190 + Math.random() * 50;
    g.fillStyle = `rgba(${v},${v - 8},${v - 30},${Math.random() * 0.1})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 1);
  }
  const edge = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
  edge.addColorStop(0, 'rgba(120,90,40,0)');
  edge.addColorStop(1, 'rgba(120,90,40,0.28)');
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(120,80,40,0.22)';
  g.lineWidth = 9;
  g.beginPath();
  g.arc(W * 0.78, H * 0.83, 110, 0.3, Math.PI * 1.85);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.arc(W * 0.78, H * 0.83, 98, 0, Math.PI * 2);
  g.stroke();
  // A fold across the middle
  g.fillStyle = 'rgba(90,70,40,0.08)';
  g.fillRect(0, H * 0.48, W, 4);
  // Letterhead
  g.fillStyle = '#2a2a2a';
  g.font = 'bold 30px "Courier New", Courier, monospace';
  g.fillText('EXTERMINATOR COLLECTIVE — BIOLOGICAL DIVISION', 80, 110);
  g.fillRect(80, 128, W - 160, 3);
  g.font = '24px "Courier New", Courier, monospace';
  g.fillText('INTERNAL — NOT FOR DISTRIBUTION', 80, 165);
  // The body, typed: slightly uneven ink, each character on its own
  const type = (s: string, x: number, y: number, size: number, bold = false): void => {
    g.font = `${bold ? 'bold ' : ''}${size}px "Courier New", Courier, monospace`;
    let cx = x;
    for (const ch of s) {
      g.fillStyle = `rgba(25,22,20,${0.78 + Math.random() * 0.22})`;
      g.fillText(ch, cx + (Math.random() - 0.5) * 1.2, y + (Math.random() - 0.5) * 1.6);
      cx += g.measureText(ch).width;
    }
  };
  let y = 290;
  type('-Documentation Day-1006', 80, y, 46, true);
  y += 120;
  g.font = '40px "Courier New", Courier, monospace';
  const para = (text: string): void => {
    for (const l of wrap(g, text, W - 170)) {
      type(l, 80, y, 40);
      y += 58;
    }
    y += 40;
  };
  para('Subject 54 - new class assigned - lethal: piercing properties');
  para('Subject 102 - Updated Trait: elastic ability increased');
  y += 40;
  para('Subjects unready for unregulated public release');
  para('[Command leash still ineffective].');
  // A stamp, crooked, and a scrawled initial
  g.save();
  g.translate(W * 0.66, H * 0.2);
  g.rotate(-0.18);
  g.strokeStyle = 'rgba(170,30,30,0.75)';
  g.lineWidth = 7;
  g.strokeRect(-170, -48, 340, 96);
  g.fillStyle = 'rgba(170,30,30,0.75)';
  g.font = 'bold 54px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('CLASSIFIED', 0, 20);
  g.restore();
  g.strokeStyle = 'rgba(20,30,90,0.8)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(640, 1270);
  g.bezierCurveTo(680, 1210, 700, 1300, 740, 1240);
  g.bezierCurveTo(760, 1220, 780, 1290, 860, 1250);
  g.stroke();
  type('Dr. ', 560, 1262, 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * A biology wall chart: the title, a drawing of an organ (or a chart of
 * subjects) made by `draw`, callouts, and the division's footer. Organs
 * nobody has heard of, drawn the way a textbook draws a liver.
 */
function poster(title: string, sub: string, draw: (g: CanvasRenderingContext2D, label: (x: number, y: number, tx: number, ty: number, s: string) => void) => void, tint = '#e9e4d4'): THREE.CanvasTexture {
  const W = 512;
  const H = 720;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = tint;
  g.fillRect(0, 0, W, H);
  for (let k = 0; k < 2500; k++) {
    g.fillStyle = `rgba(120,100,70,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  g.fillStyle = '#22312c';
  g.fillRect(0, 0, W, 92);
  g.fillStyle = '#e8efe9';
  g.font = 'bold 34px Georgia, serif';
  g.textAlign = 'center';
  g.fillText(title, W / 2, 48);
  g.font = 'italic 18px Georgia, serif';
  g.fillText(sub, W / 2, 76);
  g.textAlign = 'left';
  const label = (x: number, y: number, tx: number, ty: number, s: string): void => {
    g.strokeStyle = '#222';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(tx, ty);
    g.stroke();
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
    g.font = 'bold 15px Arial, sans-serif';
    const right = tx > W / 2;
    g.textAlign = right ? 'left' : 'right';
    g.fillText(s, tx + (right ? 4 : -4), ty + 5);
    g.textAlign = 'left';
  };
  draw(g, label);
  g.fillStyle = '#22312c';
  g.fillRect(0, H - 46, W, 46);
  g.fillStyle = '#b8c8bf';
  g.font = '13px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('EC BIOLOGICAL DIVISION  •  REFERENCE ' + (100 + Math.floor(Math.random() * 800)) + '  •  RESTRICTED', W / 2, H - 18);
  // Wear: a torn corner, tape at the top
  g.fillStyle = 'rgba(220,210,170,0.7)';
  g.fillRect(W / 2 - 40, -6, 80, 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A fleshy blob: a closed curve wobbling round (cx, cy), filled with a shaded gradient. */
function blob(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, wob: number, col: [string, string], seed: number): void {
  g.beginPath();
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const k = 1 + wob * (Math.sin(a * 3 + seed) * 0.6 + Math.sin(a * 5 + seed * 2) * 0.4);
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  const gr = g.createRadialGradient(cx - rx * 0.3, cy - ry * 0.3, 4, cx, cy, Math.max(rx, ry) * 1.1);
  gr.addColorStop(0, col[0]);
  gr.addColorStop(1, col[1]);
  g.fillStyle = gr;
  g.fill();
  g.strokeStyle = 'rgba(60,20,20,0.7)';
  g.lineWidth = 2;
  g.stroke();
}

function veins(g: CanvasRenderingContext2D, x: number, y: number, n: number, len: number, col: string): void {
  g.strokeStyle = col;
  for (let i = 0; i < n; i++) {
    g.lineWidth = 1 + Math.random() * 1.5;
    g.beginPath();
    let px = x;
    let py = y;
    g.moveTo(px, py);
    let a = Math.random() * Math.PI * 2;
    for (let s = 0; s < 6; s++) {
      a += (Math.random() - 0.5) * 0.9;
      px += Math.cos(a) * len / 6;
      py += Math.sin(a) * len / 6;
      g.lineTo(px, py);
    }
    g.stroke();
  }
}

function posterTextures(): THREE.CanvasTexture[] {
  const spitter = poster('THE SPITTER', 'Ventral projection gland — cross section', (g, label) => {
    // The sac, its lining, the duct up to a ring of nozzles
    blob(g, 250, 400, 120, 150, 0.08, ['#d79a7c', '#8a3f35'], 1);
    blob(g, 250, 410, 80, 105, 0.1, ['#c9d27a', '#6f7a28'], 2);
    for (let i = 0; i < 9; i++) blob(g, 200 + Math.random() * 100, 360 + Math.random() * 110, 9, 7, 0.2, ['#eef5b0', '#9aa63c'], i);
    g.fillStyle = '#a8524a';
    g.beginPath();
    g.moveTo(232, 260);
    g.bezierCurveTo(226, 210, 246, 180, 238, 140);
    g.lineTo(266, 140);
    g.bezierCurveTo(272, 180, 262, 220, 270, 260);
    g.fill();
    g.stroke();
    for (let i = -2; i <= 2; i++) {
      g.fillStyle = '#5a2420';
      g.beginPath();
      g.ellipse(252 + i * 13, 134, 5, 9, i * 0.25, 0, Math.PI * 2);
      g.fill();
    }
    veins(g, 250, 400, 10, 150, 'rgba(120,30,40,0.6)');
    label(240, 140, 90, 130, 'EJECTION RING');
    label(252, 220, 410, 200, 'PRESSURE DUCT');
    label(250, 420, 410, 470, 'CAUSTIC RESERVOIR');
    label(150, 380, 70, 330, 'MUSCLE WALL');
    label(220, 500, 90, 580, 'SECRETION NODES');
    g.fillStyle = '#333';
    g.font = '14px Georgia, serif';
    g.fillText('Fig. 3 — Range under load: 11–14 m. See Appendix C.', 60, 640);
  });
  const sponge = poster('SPINAL SPONGES', 'Dorsal absorption tissue — lateral view', (g, label) => {
    // A column of vertebrae with spongy pads swelling out between them
    for (let i = 0; i < 8; i++) {
      const y = 150 + i * 58;
      g.fillStyle = '#e8dcc0';
      g.strokeStyle = '#6d6250';
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(190, y, 90, 34, 8);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(280, y + 8);
      g.lineTo(330, y - 6);
      g.lineTo(334, y + 8);
      g.lineTo(280, y + 26);
      g.fill();
      g.stroke();
      if (i < 7) {
        blob(g, 238, y + 46, 62 + Math.sin(i) * 10, 14, 0.25, ['#f0c3a0', '#b8604e'], i * 1.7);
        for (let p = 0; p < 14; p++) {
          g.fillStyle = 'rgba(110,40,30,0.55)';
          g.beginPath();
          g.arc(190 + Math.random() * 100, y + 40 + Math.random() * 12, 1.5 + Math.random() * 2, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    label(190, 223, 80, 200, 'DORSAL SPONGE');
    label(300, 290, 420, 270, 'MARROW WICK');
    label(240, 380, 420, 410, 'FLUID RESERVOIR');
    label(200, 495, 80, 520, 'EXPANSION SEAM');
    g.fillStyle = '#333';
    g.font = '14px Georgia, serif';
    g.fillText('Volume at full saturation: approx. x3.6 resting.', 70, 640);
  });
  const heart = poster('THE HOLLOW HEART', 'Six-chamber circulatory pump', (g, label) => {
    blob(g, 256, 380, 130, 150, 0.06, ['#c55a50', '#6a1f22'], 4);
    const ch: [number, number][] = [[205, 320], [305, 320], [190, 420], [320, 420], [255, 480], [255, 370]];
    ch.forEach(([x, y], i) => blob(g, x, y, 34, 38, 0.15, ['#e3958a', '#8f3330'], i * 2));
    g.strokeStyle = '#4a6fa0';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(230, 240);
    g.bezierCurveTo(220, 180, 170, 170, 150, 140);
    g.moveTo(290, 240);
    g.bezierCurveTo(300, 170, 360, 180, 380, 130);
    g.stroke();
    label(205, 320, 70, 280, 'FORE-ATRIUM');
    label(305, 320, 430, 280, 'ECHO CHAMBER');
    label(255, 480, 420, 560, '6th VENTRICLE');
    label(190, 420, 70, 470, 'REFLUX VALVE');
    label(150, 145, 70, 120, 'COLD RETURN');
  });
  const quill = poster('QUILL GLAND', 'Keratin lance formation — stages I–IV', (g, label) => {
    for (let s = 0; s < 4; s++) {
      const x = 90 + s * 112;
      blob(g, x, 470, 40, 34, 0.1, ['#d9a58e', '#8a4a3c'], s);
      const L = 40 + s * 70;
      g.fillStyle = '#e6e1cf';
      g.strokeStyle = '#555';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x - 7, 450);
      g.lineTo(x, 450 - L);
      g.lineTo(x + 7, 450);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#333';
      g.font = 'bold 16px Arial';
      g.textAlign = 'center';
      g.fillText(['I', 'II', 'III', 'IV'][s], x, 540);
      g.textAlign = 'left';
    }
    label(426, 200, 300, 150, 'TIP: MINERALISED');
    label(90, 470, 60, 600, 'ROOT SAC');
    g.fillStyle = '#333';
    g.font = '14px Georgia, serif';
    g.fillText('Penetration test: 6 mm steel plate — PASS', 70, 640);
  });
  const chart = poster('SUBJECT TRAIT INDEX', 'Quarterly assessment — class assignments', (g) => {
    const rows = [['S-17', 'REGEN', 0.4], ['S-31', 'DENSITY', 0.62], ['S-54', 'PIERCING', 0.93], ['S-77', 'ACID', 0.55], ['S-102', 'ELASTIC', 0.88], ['S-118', 'MIMIC', 0.21]] as const;
    rows.forEach(([id, trait, v], i) => {
      const y = 150 + i * 72;
      // A silhouette, more wrong the higher the score
      g.fillStyle = '#3a3a3a';
      g.beginPath();
      g.arc(70, y + 10, 12, 0, Math.PI * 2);
      g.fill();
      g.fillRect(62 + (v > 0.8 ? -6 : 0), y + 22, 16 + (v > 0.8 ? 12 : 0), 30);
      g.font = 'bold 16px Arial';
      g.fillStyle = '#222';
      g.fillText(id, 100, y + 22);
      g.font = '14px Arial';
      g.fillText(trait, 100, y + 42);
      g.fillStyle = '#cfcab8';
      g.fillRect(200, y + 18, 260, 22);
      g.fillStyle = v > 0.8 ? '#9a2a22' : '#3d6b55';
      g.fillRect(200, y + 18, 260 * v, 22);
      g.strokeStyle = '#555';
      g.strokeRect(200, y + 18, 260, 22);
    });
    g.fillStyle = '#9a2a22';
    g.font = 'bold 15px Arial';
    g.fillText('RED: EXCEEDS CONTAINMENT RATING', 70, 610);
  }, '#ece8da');
  const cell = poster('CELL DIVISION', 'Accelerated mitosis under compound K-6', (g, label) => {
    for (let i = 0; i < 4; i++) {
      const x = 130 + (i % 2) * 250;
      const y = 230 + Math.floor(i / 2) * 230;
      blob(g, x, y, 80 + i * 4, 70, 0.05, ['#cfe3d6', '#6f9a86'], i);
      blob(g, x - 20 + i * 8, y, 22, 20, 0.1, ['#7b5ea0', '#3a2a5a'], i + 3);
      if (i > 1) blob(g, x + 26, y + 6, 18, 16, 0.1, ['#7b5ea0', '#3a2a5a'], i + 5);
      g.fillStyle = '#333';
      g.font = 'bold 15px Arial';
      g.fillText(['00:00', '00:40', '01:10', '01:25'][i], x - 22, y + 100);
    }
    label(130, 230, 60, 130, 'NUCLEUS (ENLARGED)');
  });
  return [spitter, sponge, heart, quill, chart, cell];
}

/** A screen's face: a waveform, a readout, scrolling numbers. */
function screen(kind: number): { tex: THREE.CanvasTexture; draw: (t: number) => void } {
  const c = makeCanvas(256, 160);
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const col = ['#5dff9a', '#6fd8ff', '#ffb050'][kind % 3];
  const draw = (t: number): void => {
    g.fillStyle = '#04100a';
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = 'rgba(80,140,100,0.25)';
    g.lineWidth = 1;
    for (let x = 0; x < 256; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 160);
      g.stroke();
    }
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x < 256; x += 2) {
      const u = x / 256 + t * 0.4;
      const y = kind % 2
        ? 80 + Math.sin(u * 30) * 18 * Math.sin(u * 3) + (Math.sin(u * 97) > 0.97 ? -40 : 0)
        : 90 - Math.max(0, Math.sin(u * 14) ** 30) * 60 + Math.sin(u * 60) * 3;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = col;
    g.font = 'bold 14px monospace';
    g.fillText(['SUBJ 54  VITALS', 'SUBJ 102 ELAST.', 'CHAMBER 3 TEMP'][kind % 3], 8, 18);
    g.fillText((Math.sin(t * 0.7 + kind) * 40 + 120).toFixed(1), 190, 150);
    tex.needsUpdate = true;
  };
  draw(0);
  return { tex, draw };
}

// ----------------------------------------------------------------- builder

export class Level14Builder {
  private group = new THREE.Group();
  private props = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private M = {
    floor: new THREE.MeshStandardMaterial({ roughness: 0.75 }),
    wall: new THREE.MeshStandardMaterial({ roughness: 0.85 }),
    ceil: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.35, metalness: 0.75 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x3a4044, roughness: 0.5, metalness: 0.7 }),
    epoxy: new THREE.MeshStandardMaterial({ color: 0x1d2021, roughness: 0.3 }),
    cabinet: new THREE.MeshStandardMaterial({ color: 0x8e9c94, roughness: 0.6, metalness: 0.2 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.75 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x343b2a, roughness: 0.8 }),
    foam: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xcfeef0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false }),
    sheet: new THREE.MeshStandardMaterial({ color: 0xc9d6d2, roughness: 0.95 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
    lampLens: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f4ff, emissiveIntensity: 1.6 }),
    red: new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2010, emissiveIntensity: 2 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6 }),
    rubble: new THREE.MeshStandardMaterial({ color: 0x6f716c, roughness: 0.95 }),
    flesh: new THREE.MeshStandardMaterial({ color: 0xc28a7c, roughness: 0.55, emissive: 0x301010, emissiveIntensity: 0.3 })
  };
  private tankGlow: THREE.MeshStandardMaterial[] = [];
  private floaters: THREE.Object3D[] = [];
  private fixtures: THREE.Object3D[] = [];
  private screens: { tex: THREE.CanvasTexture; draw: (t: number) => void }[] = [];
  private lamps: THREE.PointLight[] = [];
  private red: THREE.PointLight[] = [];

  build(): Level14Data {
    const M = this.M;
    const ft = floorTex();
    M.floor.map = ft;
    ft.repeat.set(12, 9);
    const wt = wallTex();
    M.wall.map = wt;
    const ct = ceilTex();
    M.ceil.map = ct;
    ct.repeat.set(10, 8);
    this.group.add(this.props);

    this.buildRoom();
    const paper = this.buildDesk();
    this.buildBenches();
    this.buildOperatingTables();
    this.buildTanks();
    this.buildMachines();
    this.buildPosters();
    const crate = this.buildCrate();
    const sciDoor = this.buildSciDoor();
    const rocketDoor = this.buildRocketDoor();
    const plug = this.buildPlug();
    const hall = this.buildHall();
    this.buildBreach();
    this.buildLights();

    this.shootables = mergeStatic(this.group, [this.props], this.shootables);

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      glassPanes: [],
      start: { pos: V(-11.2, 0, 0.2), yaw: -Math.PI / 2 },
      paper,
      crate,
      sciDoor,
      rocketDoor,
      plug,
      hallPieces: hall.pieces,
      portal: hall.portal,
      lights: { lamps: this.lamps, hall: hall.lights, red: this.red },
      fixtures: this.fixtures,
      tankGlow: this.tankGlow,
      floaters: this.floaters,
      screens: this.screens,
      breach: V(ROOM.x0, 0, 0)
    };
  }

  // ------------------------------------------------------------- helpers

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.props): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, o: { collide?: boolean; parent?: THREE.Object3D; shoot?: boolean } = {}): THREE.Mesh {
    const m = this.mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, o.parent);
    if (o.collide) this.colliders.push({ box: new THREE.Box3(V(x - w / 2, y - h / 2, z - d / 2), V(x + w / 2, y + h / 2, z + d / 2)) });
    if (o.shoot !== false) this.shootables.push(m);
    return m;
  }

  private collide(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider {
    const c: Collider = { box: new THREE.Box3(V(x0, y0, z0), V(x1, y1, z1)) };
    this.colliders.push(c);
    return c;
  }

  private cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, mat: THREE.Material, seg = 16, parent?: THREE.Object3D): THREE.Mesh {
    return this.mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, parent);
  }

  /** A wall slab with UVs set to the wall texture's 2.3 m repeat, its texture's tiles from the floor up. */
  private wall(x: number, z: number, len: number, alongX: boolean, h = ROOM.h, mat = this.M.wall, parent: THREE.Object3D = this.props): THREE.Mesh {
    const T = 0.3;
    const geo = new THREE.BoxGeometry(alongX ? len : T, h, alongX ? T : len);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const a = alongX ? pos.getX(i) : pos.getZ(i);
      uv.setXY(i, (a + len / 2) / 2.3, (pos.getY(i) + h / 2) / 2.3);
    }
    const m = this.mesh(geo, mat, x, h / 2, z, parent);
    this.shootables.push(m);
    return m;
  }

  // ------------------------------------------------------------- the room

  private buildRoom(): void {
    const { x0, x1, z0, z1, h } = ROOM;
    const M = this.M;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), M.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    this.props.add(floor);
    this.shootables.push(floor);
    this.collide(x0 - 1, -1, z0 - 1, x1 + 1, 0, z1 + 1);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), M.ceil);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, h, 0);
    this.props.add(ceil);
    // West wall round the breach (z −1.3..1.3, up to 3.1)
    this.wall(x0, (z0 - 1.3) / 2, -1.3 - z0, false);
    this.wall(x0, (z1 + 1.3) / 2, z1 - 1.3, false);
    this.box(0.3, h - 3.1, 2.6, x0, 3.1 + (h - 3.1) / 2, 0, M.wall);
    this.collide(x0 - 0.5, 0, z0, x0 + 0.15, h, -1.3);
    this.collide(x0 - 0.5, 0, 1.3, x0 + 0.15, h, z1);
    // East wall
    this.wall(x1, 0, z1 - z0, false);
    this.collide(x1 - 0.15, 0, z0, x1 + 0.5, h, z1);
    // South wall round its door (x −4.65..−3.35, 2.3 high)
    this.wall((x0 - 4.65) / 2, z0, -4.65 - x0, true);
    this.wall((x1 - 3.35) / 2, z0, x1 + 3.35, true);
    this.box(1.3, h - 2.3, 0.3, -4, 2.3 + (h - 2.3) / 2, z0, M.wall);
    this.collide(x0, 0, z0 - 0.5, -4.65, h, z0 + 0.15);
    this.collide(-3.35, 0, z0 - 0.5, x1, h, z0 + 0.15);
    // North wall: round the double doors (x −5.3..−2.7, 2.6 high) and the plug (x 4..8)
    this.wall((x0 - 5.3) / 2, z1, -5.3 - x0, true);
    this.box(2.6, h - 2.6, 0.3, -4, 2.6 + (h - 2.6) / 2, z1, M.wall);
    this.wall(0.65, z1, 6.7, true);
    this.wall(10, z1, 4, true);
    this.box(4, h - HALL.h, 0.3, 6, HALL.h + (h - HALL.h) / 2, z1, M.wall);
    this.collide(x0, 0, z1 - 0.15, -5.3, h, z1 + 0.5);
    this.collide(-2.7, 0, z1 - 0.15, 4, h, z1 + 0.5);
    this.collide(8, 0, z1 - 0.15, x1, h, z1 + 0.5);
    // Skirting, conduits along the top of the walls, a cable tray
    this.box(x1 - x0, 0.12, 0.04, 0, 0.06, z0 + 0.17, M.darkSteel, { shoot: false });
    for (const z of [z0 + 0.25, z1 - 0.25]) this.cyl(0.05, 0.05, x1 - x0, 0, h - 0.35, z, M.steel, 10).rotation.z = Math.PI / 2;
    for (const x of [x0 + 0.25, x1 - 0.25]) this.cyl(0.04, 0.04, z1 - z0, x, h - 0.3, 0, M.darkSteel, 10).rotation.x = Math.PI / 2;
    this.box(0.5, 0.06, z1 - z0, 0, h - 0.5, 0, M.darkSteel, { shoot: false });
    // A floor drain, a yellow hazard line round the middle
    this.cyl(0.25, 0.25, 0.01, 2.5, 0.006, 1.5, M.darkSteel, 16);
    for (const [x, z, w, d] of [[0.5, -4.2, 9, 0.08], [0.5, 4.2, 9, 0.08], [-4, 0, 0.08, 8.4], [5, 0, 0.08, 8.4]] as const)
      this.box(w, 0.005, d, x, 0.003, z, M.yellow, { shoot: false });
  }

  // ------------------------------------------------------------- the desk and the report

  private buildDesk(): Level14Data['paper'] {
    const M = this.M;
    const x = -7.6;
    const z = -3.3;
    // A steel desk against nothing, a chair pushed back, a lamp
    this.box(1.8, 0.05, 0.85, x, 0.88, z, M.epoxy, { collide: true });
    for (const [dx, dz] of [[-0.85, -0.38], [0.85, -0.38], [-0.85, 0.38], [0.85, 0.38]]) this.box(0.05, 0.86, 0.05, x + dx, 0.43, z + dz, M.steel);
    this.box(0.5, 0.6, 0.75, x + 0.6, 0.55, z, M.cabinet);
    this.collide(x - 0.9, 0, z - 0.43, x + 0.9, 0.9, z + 0.43);
    // Chair
    this.box(0.46, 0.06, 0.46, x - 0.3, 0.48, z + 0.85, M.rubber);
    this.box(0.46, 0.5, 0.06, x - 0.3, 0.78, z + 1.08, M.rubber);
    this.cyl(0.03, 0.03, 0.45, x - 0.3, 0.24, z + 0.85, M.steel, 8);
    // Lamp: base, arm, shade
    this.cyl(0.08, 0.1, 0.03, x + 0.65, 0.92, z - 0.25, M.darkSteel, 12);
    const arm = this.box(0.025, 0.45, 0.025, x + 0.6, 1.12, z - 0.18, M.darkSteel, { shoot: false });
    arm.rotation.x = 0.4;
    const shade = this.cyl(0.04, 0.12, 0.12, x + 0.52, 1.3, z - 0.02, M.darkSteel, 12);
    shade.rotation.x = -0.7;
    // A microscope on the desk, a stack of folders, a mug
    this.microscope(x - 0.55, 0.905, z - 0.15, 0.6);
    for (let i = 0; i < 4; i++) {
      const f = this.box(0.32, 0.02, 0.24, x + 0.15 + (Math.random() - 0.5) * 0.04, 0.915 + i * 0.022, z - 0.2, i % 2 ? M.yellow : M.sheet, { shoot: false });
      f.rotation.y = (Math.random() - 0.5) * 0.3;
    }
    this.cyl(0.045, 0.04, 0.1, x + 0.55, 0.955, z + 0.2, M.sheet, 12);
    // The report, face up, angled toward whoever comes in
    const mat = new THREE.MeshStandardMaterial({ map: paperTexture(), roughness: 0.9, emissive: 0x302a20, emissiveIntensity: 0.25 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), mat);
    mesh.rotation.set(-Math.PI / 2, 0, -0.35 - Math.PI / 2);
    mesh.position.set(x - 0.05, 0.907, z + 0.12);
    this.group.add(mesh);
    // A small warm pool of light on it
    const l = new THREE.PointLight(0xffd8a0, 3.5, 2.6, 1.6);
    l.position.set(x + 0.4, 1.35, z);
    this.group.add(l);
    return { mesh, front: V(x - 0.05, 0, z + 1.1) };
  }

  private microscope(x: number, y: number, z: number, ry: number): void {
    const M = this.M;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = ry;
    this.props.add(g);
    this.mesh(new THREE.BoxGeometry(0.16, 0.03, 0.22), M.cabinet, 0, 0.015, 0, g);
    const arm = this.mesh(new THREE.BoxGeometry(0.04, 0.26, 0.06), M.cabinet, 0, 0.15, 0.07, g);
    arm.rotation.x = -0.25;
    this.mesh(new THREE.BoxGeometry(0.11, 0.012, 0.1), M.darkSteel, 0, 0.11, -0.01, g);
    const tube = this.mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.16, 12), M.epoxy, 0, 0.25, 0.0, g);
    tube.rotation.x = 0.45;
    const eye = this.mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.06, 10), M.epoxy, 0, 0.33, 0.04, g);
    eye.rotation.x = 0.45;
    this.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), M.steel, 0, 0.165, -0.02, g);
    for (const s of [-1, 1]) {
      const k = this.mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.015, 12), M.darkSteel, s * 0.035, 0.12, 0.08, g);
      k.rotation.z = Math.PI / 2;
    }
  }

  /** Glassware with something in it: a conical flask, a round flask, a beaker or a cylinder. */
  private flask(x: number, y: number, z: number, kind: number, colour: number): void {
    const M = this.M;
    const liquid = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.55, roughness: 0.2, transparent: true, opacity: 0.85 });
    if (kind === 0) {
      this.cyl(0.018, 0.07, 0.14, x, y + 0.07, z, M.glass, 14);
      this.cyl(0.018, 0.018, 0.07, x, y + 0.175, z, M.glass, 10);
      this.cyl(0.04, 0.064, 0.06, x, y + 0.031, z, liquid, 14);
    } else if (kind === 1) {
      this.mesh(new THREE.SphereGeometry(0.06, 14, 10), M.glass, x, y + 0.06, z);
      this.cyl(0.015, 0.015, 0.1, x, y + 0.15, z, M.glass, 10);
      this.mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), liquid, x, y + 0.06, z);
    } else if (kind === 2) {
      this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.11, 14, 1, true), M.glass, x, y + 0.055, z);
      this.cyl(0.042, 0.042, 0.06, x, y + 0.031, z, liquid, 14);
    } else {
      this.cyl(0.016, 0.016, 0.26, x, y + 0.13, z, M.glass, 10);
      this.cyl(0.035, 0.035, 0.01, x, y + 0.005, z, M.glass, 12);
      this.cyl(0.014, 0.014, 0.16, x, y + 0.085, z, liquid, 10);
    }
  }

  private testTubeRack(x: number, y: number, z: number): void {
    const M = this.M;
    this.box(0.3, 0.02, 0.08, x, y + 0.06, z, M.steel, { shoot: false });
    this.box(0.3, 0.02, 0.08, x, y + 0.01, z, M.steel, { shoot: false });
    const cols = [0x6aff6a, 0xff6a3a, 0x8a5aff, 0x40d0ff, 0xffe040, 0xff40a0];
    for (let i = 0; i < 6; i++) {
      this.cyl(0.011, 0.011, 0.14, x - 0.125 + i * 0.05, y + 0.08, z, M.glass, 8);
      const c = cols[i];
      const liquid = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6 });
      this.cyl(0.009, 0.009, 0.05 + Math.random() * 0.04, x - 0.125 + i * 0.05, y + 0.05, z, liquid, 8);
    }
  }

  private buildBenches(): void {
    const M = this.M;
    // Two long benches along the south wall and one along the north, either side of the doors
    const benches: [number, number, number, number][] = [
      [-8.4, -7.9, 5.4, 0],
      [5.9, -7.9, 3.0, 0],
      [-8.6, 7.9, 5.2, Math.PI],
      [0.4, 7.9, 4.6, Math.PI]
    ];
    const cols = [0x5dff7a, 0x41c8ff, 0xffb040, 0xc060ff, 0xff4060, 0x9aff40];
    benches.forEach(([x, z, len, ry]) => {
      const d = 0.8;
      this.box(len, 0.05, d, x, 0.92, z, M.epoxy, { collide: true });
      this.box(len - 0.1, 0.85, d - 0.08, x, 0.45, z, M.cabinet);
      this.collide(x - len / 2, 0, z - d / 2, x + len / 2, 0.95, z + d / 2);
      // Drawer lines and handles
      for (let i = 0; i < Math.floor(len / 0.6); i++) {
        const dx = x - len / 2 + 0.3 + i * 0.6;
        const fz = z + (ry ? -1 : 1) * (d / 2 - 0.035);
        this.box(0.56, 0.008, 0.01, dx, 0.6, fz, M.darkSteel, { shoot: false });
        this.box(0.12, 0.02, 0.02, dx, 0.7, fz + (ry ? -0.01 : 0.01), M.steel, { shoot: false });
      }
      // A shelf over it on the wall, bottles on the shelf
      const wz = z + (ry ? 0.3 : -0.3);
      this.box(len, 0.03, 0.3, x, 1.75, wz, M.steel, { shoot: false });
      for (let i = 0; i < len * 3; i++) {
        const bx = x - len / 2 + 0.15 + i / 3;
        const c = cols[Math.floor(Math.random() * cols.length)];
        if (Math.random() < 0.7) this.flask(bx, 1.765, wz + (Math.random() - 0.5) * 0.1, Math.floor(Math.random() * 4), c);
      }
      // Glassware, racks and microscopes along the top
      for (let s = -len / 2 + 0.3; s < len / 2 - 0.2; s += 0.42 + Math.random() * 0.3) {
        const bx = x + s;
        const bz = z + (Math.random() - 0.5) * 0.35;
        const r = Math.random();
        if (r < 0.15) this.microscope(bx, 0.945, bz, ry + (Math.random() - 0.5) * 0.6);
        else if (r < 0.3) this.testTubeRack(bx, 0.945, bz);
        else this.flask(bx, 0.945, bz, Math.floor(Math.random() * 4), cols[Math.floor(Math.random() * cols.length)]);
      }
      // A screen on an arm over each bench
      const sc = screen(this.screens.length);
      this.screens.push(sc);
      const scr = this.box(0.6, 0.38, 0.04, x + len * 0.25, 1.28, wz + (ry ? -0.1 : 0.1), M.epoxy, { shoot: false });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.33), new THREE.MeshBasicMaterial({ map: sc.tex }));
      face.position.set(0, 0, 0.022);
      scr.add(face);
      if (ry) scr.rotation.y = Math.PI;
    });
  }

  private buildOperatingTables(): void {
    const M = this.M;
    const tables: [number, number, number][] = [
      [8.2, -4.6, 0.15],
      [-8.6, 4.4, -0.1]
    ];
    tables.forEach(([x, z, ry], ti) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      this.props.add(g);
      // Steel top with a drain gutter, the pedestal, the base
      this.mesh(new THREE.BoxGeometry(0.75, 0.07, 2.05), M.steel, 0, 0.92, 0, g);
      this.mesh(new THREE.BoxGeometry(0.8, 0.03, 2.1), M.darkSteel, 0, 0.88, 0, g);
      this.mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 14), M.darkSteel, 0, 0.45, 0, g);
      this.mesh(new THREE.BoxGeometry(0.6, 0.06, 1.0), M.darkSteel, 0, 0.03, 0, g);
      // Restraints
      for (const sz of [-0.6, 0.1, 0.75]) this.mesh(new THREE.BoxGeometry(0.8, 0.012, 0.07), M.rubber, 0, 0.962, sz, g);
      // A sheet over something on the first one, its shape wrong
      if (ti === 0) {
        const sheet = this.mesh(new THREE.SphereGeometry(1, 20, 12), M.sheet, 0, 0.98, 0, g);
        sheet.scale.set(0.3, 0.12, 0.9);
        const bump = this.mesh(new THREE.SphereGeometry(1, 14, 10), M.sheet, 0.08, 1.04, -0.55, g);
        bump.scale.set(0.16, 0.1, 0.22);
        const spur = this.mesh(new THREE.ConeGeometry(0.05, 0.22, 8), M.sheet, -0.18, 1.0, 0.3, g);
        spur.rotation.z = 1.1;
      } else {
        // Dark stains on bare steel, and a tray of instruments
        const stain = this.mesh(new THREE.CircleGeometry(0.25, 16), new THREE.MeshStandardMaterial({ color: 0x3a1210, roughness: 0.3 }), 0.05, 0.957, 0.2, g);
        stain.rotation.x = -Math.PI / 2;
      }
      this.mesh(new THREE.BoxGeometry(0.5, 0.02, 0.32), M.steel, 0.75, 1.05, -0.4, g);
      this.mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.05, 8), M.steel, 0.75, 0.52, -0.4, g);
      for (let i = 0; i < 5; i++) {
        const tool = this.mesh(new THREE.BoxGeometry(0.008, 0.006, 0.16 + Math.random() * 0.06), M.steel, 0.58 + i * 0.07, 1.065, -0.4, g);
        tool.rotation.y = (Math.random() - 0.5) * 0.3;
      }
      // The surgical lamp overhead: arm from the ceiling, two round heads
      this.mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8), M.steel, 0, ROOM.h - 0.7, 0, g);
      for (const s of [-1, 1]) {
        const head = new THREE.Group();
        head.position.set(s * 0.35, ROOM.h - 1.55, s * 0.25);
        g.add(head);
        this.mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.12, 20), M.cabinet, 0, 0, 0, head);
        const lens = this.mesh(new THREE.CircleGeometry(0.19, 20), M.lampLens, 0, -0.061, 0, head);
        lens.rotation.x = Math.PI / 2;
        this.mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), M.steel, -s * 0.18, 0.2, -s * 0.12, head).rotation.z = s * 0.8;
        this.fixtures.push(head);
      }
      const spot = new THREE.SpotLight(0xf2f8ff, 10, 5, 0.7, 0.6, 1.4);
      spot.position.set(x, ROOM.h - 1.6, z);
      spot.target.position.set(x, 0.9, z);
      this.group.add(spot, spot.target);
      this.collide(x - 0.45, 0, z - 1.1, x + 0.45, 0.98, z + 1.1);
    });
  }

  /** Specimen tanks: tall glass cylinders of lit green fluid, each with something floating in it. */
  private buildTanks(): void {
    const M = this.M;
    const spots: [number, number][] = [[-10.6, -6.6], [-10.6, 6.6], [10.9, 7.4], [2.2, -7.9], [3.3, 7.6]];
    spots.forEach(([x, z], i) => {
      const glow = new THREE.MeshStandardMaterial({ color: 0x2c8a3a, emissive: 0x42ff6a, emissiveIntensity: 0.9, transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false });
      this.tankGlow.push(glow);
      this.cyl(0.55, 0.6, 0.35, x, 0.175, z, M.darkSteel, 20);
      this.cyl(0.55, 0.55, 0.3, x, 2.65, z, M.darkSteel, 20);
      this.mesh(new THREE.CylinderGeometry(0.47, 0.47, 2.1, 22, 1, true), M.glass, x, 1.4, z);
      const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.95, 22), glow);
      fluid.position.set(x, 1.37, z);
      fluid.renderOrder = 2;
      this.group.add(fluid);
      // Pipes up into the ceiling
      for (const s of [-1, 1]) this.cyl(0.04, 0.04, ROOM.h - 2.8, x + s * 0.25, 2.8 + (ROOM.h - 2.8) / 2, z, M.steel, 8);
      // The specimen: a lumpy organ, or a curled thing with a tail, tethered by tubes
      const body = new THREE.Group();
      body.position.set(x, 1.4, z);
      this.group.add(body);
      const geo = new THREE.IcosahedronGeometry(0.22, 3);
      const p = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, k);
        const n = 1 + 0.18 * Math.sin(v.x * 18 + i) * Math.sin(v.y * 14) + 0.12 * Math.sin(v.z * 22 + i * 2);
        v.multiplyScalar(n);
        if (i % 2) v.y *= 1.5;
        p.setXYZ(k, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      const flesh = M.flesh.clone();
      flesh.color.setHex([0xb88576, 0x9a7d8a, 0xa69a7a, 0xc0907a, 0x8a8e9a][i]);
      body.add(new THREE.Mesh(geo, flesh));
      if (i % 2 === 0) {
        const tail = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 8, 20, Math.PI * 1.4), flesh);
        tail.position.set(0.05, -0.2, 0);
        tail.rotation.set(0.3, 0.5, 0.4);
        body.add(tail);
      }
      for (let t = 0; t < 3; t++) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 6), M.sheet);
        tube.position.set((t - 1) * 0.08, 0.6, 0);
        body.add(tube);
      }
      this.floaters.push(body);
      const l = new THREE.PointLight(0x58ff7a, 2.2, 3.4, 1.8);
      l.position.set(x, 1.4, z);
      this.group.add(l);
      this.collide(x - 0.62, 0, z - 0.62, x + 0.62, 2.8, z + 0.62);
    });
  }

  /** The big apparatus along the east wall: a scanner ring, a reactor drum, cabinets of lights. */
  private buildMachines(): void {
    const M = this.M;
    // The ring: a standing torus on a cradle, a bed running through it
    const ring = new THREE.Group();
    ring.position.set(9.6, 0, 2.0);
    this.props.add(ring);
    const tor = this.mesh(new THREE.TorusGeometry(1.25, 0.42, 20, 40), M.cabinet, 0, 1.7, 0, ring);
    tor.rotation.y = Math.PI / 2;
    const inner = this.mesh(new THREE.TorusGeometry(0.86, 0.06, 10, 40), M.darkSteel, 0, 1.7, 0, ring);
    inner.rotation.y = Math.PI / 2;
    for (const s of [-1, 1]) this.mesh(new THREE.TorusGeometry(1.25, 0.05, 8, 40), M.red, s * 0.42, 1.7, 0, ring).rotation.y = Math.PI / 2;
    this.mesh(new THREE.BoxGeometry(1.4, 0.5, 2.0), M.darkSteel, 0, 0.25, 0, ring);
    this.mesh(new THREE.BoxGeometry(3.4, 0.12, 0.7), M.sheet, -0.6, 1.0, 0, ring);
    this.mesh(new THREE.BoxGeometry(3.0, 0.88, 0.5), M.cabinet, -0.8, 0.5, 0, ring);
    this.collide(7.3, 0, 0.6, 12, 3.4, 3.4);
    // The reactor drum in the south-east corner, ribbed, piped to the ceiling
    const dx = 10.2;
    const dz = -7.0;
    this.cyl(1.2, 1.25, 3.2, dx, 1.6, dz, M.darkSteel, 28);
    for (let y = 0.3; y < 3.2; y += 0.4) this.mesh(new THREE.TorusGeometry(1.24, 0.04, 6, 28), M.steel, dx, y, dz).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      this.cyl(0.12, 0.12, ROOM.h - 3.2, dx + Math.cos(a) * 0.7, 3.2 + (ROOM.h - 3.2) / 2, dz + Math.sin(a) * 0.7, M.steel, 10);
    }
    const win = this.mesh(new THREE.CircleGeometry(0.3, 18), new THREE.MeshStandardMaterial({ color: 0x103010, emissive: 0x66ff44, emissiveIntensity: 1.6 }), dx - 1.255, 1.6, dz);
    win.rotation.y = -Math.PI / 2;
    this.collide(dx - 1.3, 0, dz - 1.3, dx + 1.3, 3.3, dz + 1.3);
    // Cabinets of lights and screens along the east wall
    for (let i = 0; i < 4; i++) {
      const z = -3.8 + i * 1.1;
      if (z > 0.4) break;
      this.box(0.7, 2.3, 1.0, 11.45, 1.15, z, M.cabinet, { collide: true });
      for (let k = 0; k < 12; k++) {
        const led = this.box(0.01, 0.03, 0.05, 11.09, 1.4 + Math.floor(k / 4) * 0.12, z - 0.3 + (k % 4) * 0.12, Math.random() < 0.3 ? M.red : M.lampLens, { shoot: false });
        led.userData.blink = true;
      }
      const sc = screen(this.screens.length);
      this.screens.push(sc);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshBasicMaterial({ map: sc.tex }));
      face.position.set(11.09, 0.9, z);
      face.rotation.y = -Math.PI / 2;
      this.group.add(face);
    }
    // Gas cylinders chained in the north-east
    for (let i = 0; i < 4; i++) this.cyl(0.13, 0.13, 1.5, 11.5 - (i % 2) * 0.3, 0.75, 4.6 + i * 0.32, i % 2 ? M.yellow : M.steel, 12);
    this.collide(10.9, 0, 4.3, 12, 1.6, 5.9);
  }

  private buildPosters(): void {
    const tex = posterTextures();
    // On the walls, at eye height, clear of the doors and the shelves
    const spots: [number, number, number, number][] = [
      [-11.84, 1.9, -3.4, Math.PI / 2],
      [-11.84, 1.9, 3.9, Math.PI / 2],
      [-7.0, 2.45, 8.84, Math.PI],
      [-0.6, 2.45, -8.84, 0],
      [3.6, 2.45, -8.84, 0],
      [11.84, 2.5, -1.9, -Math.PI / 2]
    ];
    spots.forEach(([x, y, z, ry], i) => {
      const mat = new THREE.MeshStandardMaterial({ map: tex[i % tex.length], roughness: 0.8 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.2), mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.group.add(m);
    });
    // Hazard signs
    const sign = makeCanvas(256, 256);
    const g = sign.getContext('2d')!;
    g.fillStyle = '#e8c22a';
    g.beginPath();
    g.moveTo(128, 10);
    g.lineTo(246, 230);
    g.lineTo(10, 230);
    g.closePath();
    g.fill();
    g.strokeStyle = '#111';
    g.lineWidth = 10;
    g.stroke();
    g.fillStyle = '#111';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.arc(128 + Math.cos(i * 2.094 - 1.57) * 36, 150 + Math.sin(i * 2.094 - 1.57) * 36, 26, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#e8c22a';
    g.beginPath();
    g.arc(128, 150, 14, 0, Math.PI * 2);
    g.fill();
    const st = new THREE.CanvasTexture(sign);
    st.colorSpace = THREE.SRGBColorSpace;
    const sm = new THREE.MeshStandardMaterial({ map: st, transparent: true, roughness: 0.6 });
    for (const [x, y, z, ry] of [[-4, 3.1, 8.84, Math.PI], [-2.2, 2.0, -8.84, 0], [11.84, 2.6, 4.0, -Math.PI / 2]] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), sm);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.group.add(m);
    }
  }

  // ------------------------------------------------------------- the crate

  private buildCrate(): Level14Data['crate'] {
    const M = this.M;
    const { x, z } = CRATE;
    // A long weapons crate on two skids, lid hinged open toward the far side
    this.box(1.3, 0.08, 0.7, x, 0.04, z, M.wood, { collide: false });
    this.box(1.3, 0.5, 0.7, x, 0.33, z, M.crate);
    this.box(1.16, 0.02, 0.56, x, 0.56, z, M.foam, { shoot: false });
    for (const s of [-1, 1]) {
      this.box(1.32, 0.06, 0.04, x, 0.42, z + s * 0.36, M.darkSteel, { shoot: false });
      this.box(0.04, 0.5, 0.72, x + s * 0.55, 0.33, z, M.darkSteel, { shoot: false });
    }
    this.collide(x - 0.66, 0, z - 0.36, x + 0.66, 0.58, z + 0.36);
    const lid = this.box(1.3, 0.05, 0.7, x, 0.95, z - 0.36, M.crate);
    lid.rotation.x = -1.35;
    lid.position.set(x, 0.58 + 0.34 * Math.sin(1.35), z - 0.35 - 0.34 * Math.cos(1.35));
    // Stencils
    const c = makeCanvas(512, 128);
    const g = c.getContext('2d')!;
    g.fillStyle = '#343b2a';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#d8d2b4';
    g.font = 'bold 54px Arial';
    g.fillText('EC ARMORY', 20, 62);
    g.font = 'bold 30px Arial';
    g.fillText('CLASSIFIED — QB-4 PROTOTYPE', 20, 108);
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.8 }));
    label.position.set(x, 0.33, z + 0.352);
    this.group.add(label);
    // The gun in its foam, muzzle to the east, on its side a little
    const q = quadShotgunModel();
    q.group.position.set(x, 0.62, z + 0.02);
    q.group.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.08);
    this.group.add(q.group);
    // A small cold light in the lid, so it catches the eye
    const l = new THREE.PointLight(0xdfefff, 2.4, 2.2, 1.4);
    l.position.set(x, 1.1, z - 0.2);
    this.group.add(l);
    return { gun: q.group, gunPump: q.pump };
  }

  // ------------------------------------------------------------- doors

  private doorLeaf(w: number, h: number, mat: THREE.Material, window = true): THREE.Group {
    const M = this.M;
    const leaf = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), mat);
    slab.position.set(w / 2, h / 2, 0);
    leaf.add(slab);
    this.shootables.push(slab);
    if (window) {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x1a2a2a, roughness: 0.1, metalness: 0.4 }));
      glass.position.set(w / 2, h * 0.7, 0.037);
      leaf.add(glass);
      const g2 = glass.clone();
      g2.position.z = -0.037;
      g2.rotation.y = Math.PI;
      leaf.add(g2);
    }
    const kick = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, 0.25, 0.08), M.steel);
    kick.position.set(w / 2, 0.15, 0);
    leaf.add(kick);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.05, 0.1), M.steel);
    bar.position.set(w / 2, 1.05, 0);
    leaf.add(bar);
    return leaf;
  }

  private buildSciDoor(): Level14Data['sciDoor'] {
    const M = this.M;
    const z = ROOM.z1;
    const mat = new THREE.MeshStandardMaterial({ color: 0x56635c, roughness: 0.6, metalness: 0.3 });
    // Frame
    this.box(2.8, 0.12, 0.36, -4, 2.66, z, M.darkSteel, { shoot: false });
    for (const s of [-1, 1]) this.box(0.1, 2.6, 0.36, -4 + s * 1.35, 1.3, z, M.darkSteel, { shoot: false });
    const l = this.doorLeaf(1.28, 2.58, mat);
    l.position.set(-5.3, 0, z);
    const r = this.doorLeaf(1.28, 2.58, mat);
    r.position.set(-2.7, 0, z);
    r.rotation.y = Math.PI;
    // Its hinge on the right: the right leaf is the left one turned round its own hinge
    this.group.add(l, r);
    const c = this.collide(-5.3, 0, z - 0.15, -2.7, 2.6, z + 0.15);
    // A red lamp over it
    const lamp = this.box(0.3, 0.12, 0.1, -4, 2.95, z - 0.2, M.red, { shoot: false });
    lamp.userData.alarm = true;
    const red = new THREE.PointLight(0xff2a1a, 0, 6, 1.6);
    red.position.set(-4, 2.8, z - 0.6);
    this.group.add(red);
    this.red.push(red);
    return { leaves: [l, r], collider: c, at: V(-4, 0, z) };
  }

  private buildRocketDoor(): Level14Data['rocketDoor'] {
    const M = this.M;
    const z = ROOM.z0;
    this.box(1.5, 0.12, 0.36, -4, 2.36, z, M.darkSteel, { shoot: false });
    for (const s of [-1, 1]) this.box(0.1, 2.3, 0.36, -4 + s * 0.7, 1.15, z, M.darkSteel, { shoot: false });
    const leaf = this.doorLeaf(1.28, 2.28, new THREE.MeshStandardMaterial({ color: 0x4a5250, roughness: 0.6, metalness: 0.3 }));
    leaf.position.set(-4.64, 0, z);
    this.group.add(leaf);
    const c = this.collide(-4.65, 0, z - 0.15, -3.35, 2.3, z + 0.15);
    const red = new THREE.PointLight(0xff2a1a, 0, 5, 1.6);
    red.position.set(-4, 2.6, z + 0.6);
    this.group.add(red);
    this.red.push(red);
    return { leaf, collider: c, at: V(-4, 0, z) };
  }

  /** The wall in front of the hallway's mouth — whole until the rocket — and the ragged edge it leaves. */
  private buildPlug(): Level14Data['plug'] {
    const obj = new THREE.Group();
    this.group.add(obj);
    const m = this.wall(6, ROOM.z1, 4, true, HALL.h, this.M.wall, obj);
    m.position.y = HALL.h / 2;
    // A poster on it, the last thing it'll have
    const c = this.collide(4, 0, ROOM.z1 - 0.15, 8, HALL.h, ROOM.z1 + 0.5);
    // The torn edge round the hole: broken blocks, rebar, hidden till then
    const edges = new THREE.Group();
    edges.visible = false;
    this.group.add(edges);
    for (let i = 0; i < 26; i++) {
      const side = i % 3;
      const s = 0.2 + Math.random() * 0.35;
      const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), this.M.rubble);
      if (side === 0) chunk.position.set(4.1 + Math.random() * 0.25, Math.random() * HALL.h, ROOM.z1 + (Math.random() - 0.5) * 0.3);
      else if (side === 1) chunk.position.set(7.9 - Math.random() * 0.25, Math.random() * HALL.h, ROOM.z1 + (Math.random() - 0.5) * 0.3);
      else chunk.position.set(4 + Math.random() * 4, HALL.h - 0.1 - Math.random() * 0.25, ROOM.z1);
      chunk.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      edges.add(chunk);
    }
    // Rubble heaped on the floor either side of the gap
    for (let i = 0; i < 18; i++) {
      const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1 + Math.random() * 0.25, 0), this.M.rubble);
      const sx = Math.random() < 0.5 ? 4.3 + Math.random() * 0.6 : 7.1 + Math.random() * 0.6;
      chunk.position.set(sx, 0.08, ROOM.z1 + (Math.random() - 0.4) * 2.2);
      chunk.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      edges.add(chunk);
    }
    return { obj, collider: c, at: V(6, 1.6, ROOM.z1), edges };
  }

  // ------------------------------------------------------------- the hallway and the portal

  private buildHall(): { pieces: HallPiece[]; portal: Level14Data['portal']; lights: THREE.PointLight[] } {
    const M = this.M;
    const { x0, x1, z0, z1, h, pit } = HALL;
    const cx = (x0 + x1) / 2;
    const hall = new THREE.Group();
    this.group.add(hall);
    // Floor up to the pit, and the pit's lip
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, pit - z0), M.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0.001, (z0 + pit) / 2);
    hall.add(floor);
    this.shootables.push(floor);
    this.collide(x0, -1, z0 - 0.5, x1, 0, pit);
    this.box(x1 - x0, 0.1, 0.1, cx, -0.05, pit, M.yellow, { shoot: false });
    // The pit's walls going down into the mist
    for (const s of [-1, 1]) this.box(0.3, 8, z1 - pit, s < 0 ? x0 : x1, -4, (pit + z1) / 2, M.darkSteel, { shoot: false });
    this.box(x1 - x0, 8, 0.3, cx, -4.1, pit + 0.1, M.darkSteel, { shoot: false });
    // End wall and the hall's sides (solid colliders behind the pieces that cave in)
    this.box(x1 - x0 + 0.6, h, 0.3, cx, h / 2, z1, M.wall);
    this.collide(x0, -10, z1 - 0.15, x1, h + 2, z1 + 0.5);
    this.collide(x0 - 0.5, -10, z0, x0 + 0.1, h + 2, z1);
    this.collide(x1 - 0.1, -10, z0, x1 + 0.5, h + 2, z1);
    // The walls and the ceiling in 2.5 m pieces, each on its own pivot
    const pieces: HallPiece[] = [];
    const SEG = 2.5;
    const wallMat = M.wall;
    for (let z = z0; z < z1 - 0.1; z += SEG) {
      const len = Math.min(SEG, z1 - z);
      const mid = z + len / 2;
      for (const kind of ['wallL', 'wallR'] as const) {
        const x = kind === 'wallL' ? x0 : x1;
        const g = new THREE.Group();
        g.position.set(x, 0, mid);
        hall.add(g);
        const geo = new THREE.BoxGeometry(0.25, h, len - 0.02);
        const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getZ(i) + mid) / 2.3, (pos.getY(i) + h / 2) / 2.3);
        const w = new THREE.Mesh(geo, wallMat);
        w.position.set(0, h / 2, 0);
        g.add(w);
        // A pipe run along it, and a light strip
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 8), M.steel);
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(kind === 'wallL' ? 0.2 : -0.2, h - 0.5, 0);
        g.add(pipe);
        if (Math.round((z - z0) / SEG) % 2 === 0) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, len * 0.6), M.lampLens);
          strip.position.set(kind === 'wallL' ? 0.14 : -0.14, h - 0.25, 0);
          g.add(strip);
        }
        if (mid > pit) continue;
        const c: Collider = { box: new THREE.Box3(), disabled: true };
        this.colliders.push(c);
        pieces.push({ obj: g, kind, z: mid, collider: c, fallen: false });
      }
      const cg = new THREE.Group();
      cg.position.set(cx, h, mid);
      hall.add(cg);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.2, len - 0.02), M.ceil);
      slab.position.y = 0.1;
      cg.add(slab);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.25, 0.2), M.darkSteel);
      beam.position.set(0, -0.12, -len / 2 + 0.1);
      cg.add(beam);
      if (mid < pit) {
        const c: Collider = { box: new THREE.Box3(), disabled: true };
        this.colliders.push(c);
        pieces.push({ obj: cg, kind: 'ceil', z: mid, collider: c, fallen: false });
      }
    }
    // Lights down the hall, cold, every 7.5 m
    const lights: THREE.PointLight[] = [];
    for (let z = z0 + 4; z < pit; z += 7.5) {
      const l = new THREE.PointLight(0xc8dcff, 5, 9, 1.5);
      l.position.set(cx, h - 0.4, z);
      this.group.add(l);
      lights.push(l);
    }
    // The portal: a ring of dark iron hung over the pit, a swirling disc, mist
    const center = V(cx, 1.7, pit + 3.4);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uK: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uT; uniform float uK; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0) discard;
          float a = atan(p.y, p.x);
          float sw = a + 3.5 / (r + 0.25) - uT * 1.6;
          // Sampled round a circle, so there is no seam where the angle wraps
          float v = n(vec2(cos(sw), sin(sw)) * 2.2 + vec2(r * 4.0 - uT * 0.8, 0.0)) * 0.6 + n(vec2(cos(sw * 2.0), sin(sw * 2.0)) * 3.0 + vec2(0.0, r * 9.0 + uT)) * 0.4;
          vec3 deep = vec3(0.12, 0.0, 0.22);
          vec3 mid = vec3(0.55, 0.12, 0.85);
          vec3 hot = vec3(1.0, 0.75, 1.0);
          vec3 c = mix(deep, mid, smoothstep(0.25, 0.75, v));
          c = mix(c, hot, smoothstep(0.78, 0.98, v) * (1.0 - r));
          c += vec3(0.9, 0.6, 1.0) * pow(1.0 - r, 6.0) * 1.4;
          float edge = smoothstep(1.0, 0.82, r);
          gl_FragColor = vec4(c * uK, edge);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.45, 48), mat);
    disc.position.copy(center);
    this.group.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 12, 48), new THREE.MeshStandardMaterial({ color: 0x2a2030, roughness: 0.4, metalness: 0.8, emissive: 0x6a20a0, emissiveIntensity: 0.6 }));
    ring.position.copy(center);
    this.group.add(ring);
    // Struts holding it to the walls
    for (const s of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1), M.darkSteel);
      st.position.set(center.x + s * 1.75, center.y, center.z);
      this.group.add(st);
    }
    const light = new THREE.PointLight(0xa040ff, 9, 14, 1.4);
    light.position.copy(center).add(V(0, 0, -1));
    this.group.add(light);
    // Heavy purple mist: sprites piled over the pit and spilling up the hall
    const mc = makeCanvas(128, 128);
    const mg = mc.getContext('2d')!;
    const gr = mg.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    mg.fillStyle = gr;
    mg.fillRect(0, 0, 128, 128);
    const mt = new THREE.CanvasTexture(mc);
    const mist: THREE.Sprite[] = [];
    for (let i = 0; i < 46; i++) {
      const sm = new THREE.SpriteMaterial({ map: mt, color: new THREE.Color().setHSL(0.76 + Math.random() * 0.06, 0.7, 0.35 + Math.random() * 0.2), transparent: true, opacity: 0.32, depthWrite: false });
      const s = new THREE.Sprite(sm);
      const zz = pit - 6 + Math.random() * (z1 - pit + 6);
      s.position.set(x0 + 0.4 + Math.random() * (x1 - x0 - 0.8), zz > pit ? -0.6 + Math.random() * 3.2 : Math.random() * 0.9, zz);
      s.scale.setScalar(1.6 + Math.random() * 2.2);
      s.userData.base = s.position.clone();
      s.userData.ph = Math.random() * 10;
      this.group.add(s);
      mist.push(s);
    }
    return { pieces, portal: { center, mat, ring, light, mist }, lights };
  }

  /** The way in: a blown-through hole in the west wall, its door bent on the floor, rubble. */
  private buildBreach(): void {
    const M = this.M;
    const x = ROOM.x0;
    for (let i = 0; i < 22; i++) {
      const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08 + Math.random() * 0.22, 0), M.rubble);
      chunk.position.set(x + 0.5 + Math.random() * 2.2, 0.06, (Math.random() - 0.5) * 3.4);
      chunk.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.props.add(chunk);
    }
    // Scorch round the hole
    const sc = makeCanvas(256, 256);
    const g = sc.getContext('2d')!;
    const gr = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    gr.addColorStop(0, 'rgba(10,8,6,0.95)');
    gr.addColorStop(1, 'rgba(10,8,6,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    const st = new THREE.CanvasTexture(sc);
    const scorch = new THREE.Mesh(new THREE.PlaneGeometry(5, 4.4), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
    scorch.position.set(x + 0.16, 1.6, 0);
    scorch.rotation.y = Math.PI / 2;
    this.group.add(scorch);
    const floorScorch = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), scorch.material);
    floorScorch.rotation.x = -Math.PI / 2;
    floorScorch.position.set(x + 1.4, 0.004, 0);
    this.group.add(floorScorch);
    // The door slab from Level 13, on its back on the floor, buckled
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 2.6), M.darkSteel);
    slab.position.set(x + 3.6, 0.09, 2.6);
    slab.rotation.set(0.05, 0.6, 0.08);
    this.props.add(slab);

  }

  private buildLights(): void {
    const M = this.M;
    // Strip fittings in rows; a few dead, the rest dim and cold
    const rows: [number, number][] = [];
    for (const x of [-8, -2.5, 3, 8.5]) for (const z of [-4.5, 0.2, 4.6]) rows.push([x, z]);
    rows.forEach(([x, z], i) => {
      const fit = new THREE.Group();
      fit.position.set(x, ROOM.h - 0.08, z);
      this.group.add(fit);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.3), M.darkSteel);
      fit.add(housing);
      const dead = i === 2 || i === 7 || i === 10;
      const tube = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.18), dead ? M.sheet : M.lampLens);
      tube.position.y = -0.05;
      fit.add(tube);
      this.fixtures.push(fit);
      if (dead) return;
      const l = new THREE.PointLight(0xcfe2ff, 2.7, 8, 1.5);
      l.position.set(x, ROOM.h - 0.4, z);
      l.userData.fit = fit;
      this.group.add(l);
      this.lamps.push(l);
    });
  }
}
