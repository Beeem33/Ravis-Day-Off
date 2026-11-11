import * as THREE from 'three';
import { makeCanvas, noiseTile } from './Level8Builder';

/**
 * Level13Props — the small things in the Underworks: the maintenance
 * room's shelves and cleaning kit, the control room's posters, screens,
 * canteen orders, comics and mugs, and the cargo line's crate labels.
 * All procedural, all canvas.
 */

function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const mat = (color: number, roughness = 0.7, metalness = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness, metalness });

function boxAt(g: THREE.Group, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  g.add(b);
  return b;
}

/** Words onto lines no wider than `w`; returns the y below the last line. */
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number): number {
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? line + ' ' + word : word;
    if (g.measureText(test).width > w && line) {
      g.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
  return y + lh;
}

/** The Collective's red hexagon with EC in it. */
function ecHex(g: CanvasRenderingContext2D, x: number, y: number, r: number, color = '#c4261c'): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = Math.max(2, r * 0.16);
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.stroke();
  g.fillStyle = color;
  g.font = `bold ${Math.round(r * 0.95)}px Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('EC', x, y + r * 0.04);
  g.restore();
}

/** A little grey: big head, black almond eyes, thin body. */
function grey(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.save();
  g.fillStyle = '#a9b0b4';
  g.beginPath();
  g.ellipse(x, y, s * 0.55, s * 0.68, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  for (const k of [-1, 1]) {
    g.beginPath();
    g.ellipse(x + k * s * 0.22, y + s * 0.05, s * 0.17, s * 0.09, k * -0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

// ================================================================ posters

export type PosterKind = 'teamwork' | 'safety' | 'hang' | 'payload' | 'employee' | 'specimens';

export function posterTexture(kind: PosterKind): THREE.CanvasTexture {
  const c = makeCanvas(384, 512);
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  if (kind === 'teamwork') {
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#0b1230');
    gr.addColorStop(1, '#1d2a5a');
    g.fillStyle = gr;
    g.fillRect(0, 0, 384, 512);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.7})`;
      g.fillRect(Math.random() * 384, Math.random() * 300, 2, 2);
    }
    g.fillStyle = '#5d8a4a';
    g.beginPath();
    g.arc(192, 470, 230, Math.PI, 0);
    g.fill();
    // Five in hazmat suits, hand in hand on the planet
    for (let i = 0; i < 5; i++) {
      const x = 72 + i * 60;
      g.fillStyle = '#e8c21a';
      g.fillRect(x - 14, 268, 28, 44);
      g.beginPath();
      g.arc(x, 258, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#20303a';
      g.fillRect(x - 9, 252, 18, 9);
      if (i < 4) {
        g.strokeStyle = '#e8c21a';
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(x + 14, 284);
        g.lineTo(x + 46, 284);
        g.stroke();
      }
    }
    g.fillStyle = '#000';
    g.fillRect(0, 352, 384, 160);
    g.strokeStyle = '#d8c58a';
    g.lineWidth = 3;
    g.strokeRect(10, 10, 364, 492);
    g.fillStyle = '#f3ecd6';
    g.font = 'bold 50px Georgia, serif';
    g.fillText('TEAMWORK', 192, 410);
    g.font = 'italic 19px Georgia, serif';
    wrap(g, 'Because the universe won’t exterminate itself.', 192, 446, 320, 24);
  } else if (kind === 'safety') {
    g.fillStyle = '#f4f2ea';
    g.fillRect(0, 0, 384, 512);
    g.fillStyle = '#1f7a3a';
    g.fillRect(0, 0, 384, 96);
    g.fillStyle = '#fff';
    g.font = 'bold 46px Arial, sans-serif';
    g.fillText('SAFETY FIRST', 192, 66);
    g.fillStyle = '#111';
    g.fillRect(92, 132, 200, 150);
    g.fillStyle = '#fff';
    g.fillRect(100, 140, 184, 134);
    g.fillStyle = '#333';
    g.font = 'bold 92px Arial, sans-serif';
    g.fillText('41', 192, 240);
    g.strokeStyle = '#c81c1c';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(112, 160);
    g.lineTo(272, 256);
    g.moveTo(272, 160);
    g.lineTo(112, 256);
    g.stroke();
    g.fillStyle = '#c81c1c';
    g.font = 'bold 74px "Comic Sans MS", cursive';
    g.save();
    g.translate(300, 300);
    g.rotate(-0.2);
    g.fillText('3', 0, 0);
    g.restore();
    g.fillStyle = '#111';
    g.font = 'bold 26px Arial, sans-serif';
    wrap(g, 'DAYS SINCE OUR LAST CONTAINMENT BREACH', 192, 340, 330, 30);
    g.font = '17px Arial, sans-serif';
    g.fillStyle = '#444';
    wrap(g, 'Report all unaccounted-for tentacles to your supervisor immediately.', 192, 440, 320, 21);
  } else if (kind === 'hang') {
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#8fc6ee');
    gr.addColorStop(1, '#e6f2fb');
    g.fillStyle = gr;
    g.fillRect(0, 0, 384, 512);
    g.strokeStyle = '#6b4a2a';
    g.lineWidth = 16;
    g.beginPath();
    g.moveTo(0, 80);
    g.quadraticCurveTo(200, 100, 384, 60);
    g.stroke();
    // A grey hanging on by its long thin arms
    g.strokeStyle = '#a9b0b4';
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(170, 92);
    g.lineTo(178, 200);
    g.moveTo(214, 90);
    g.lineTo(206, 200);
    g.stroke();
    grey(g, 192, 250, 90);
    g.fillStyle = '#a9b0b4';
    g.fillRect(176, 300, 32, 70);
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(182, 368);
    g.lineTo(172, 412);
    g.moveTo(202, 368);
    g.lineTo(212, 412);
    g.stroke();
    g.fillStyle = '#1b2a44';
    g.font = 'bold 46px Arial, sans-serif';
    g.fillText('HANG IN THERE!', 192, 460);
    g.font = 'italic 16px Arial, sans-serif';
    g.fillText('Only 14 more years until the pension.', 192, 490);
  } else if (kind === 'payload') {
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#2a1440');
    gr.addColorStop(0.6, '#d8572a');
    gr.addColorStop(1, '#f6b33c');
    g.fillStyle = gr;
    g.fillRect(0, 0, 384, 512);
    g.fillStyle = '#111';
    g.beginPath();
    g.moveTo(192, 70);
    g.quadraticCurveTo(230, 130, 222, 270);
    g.lineTo(162, 270);
    g.quadraticCurveTo(154, 130, 192, 70);
    g.fill();
    g.beginPath();
    g.moveTo(162, 230);
    g.lineTo(130, 300);
    g.lineTo(166, 270);
    g.moveTo(222, 230);
    g.lineTo(254, 300);
    g.lineTo(218, 270);
    g.fill();
    g.fillStyle = '#ffe48a';
    g.beginPath();
    g.moveTo(170, 272);
    g.lineTo(192, 350);
    g.lineTo(214, 272);
    g.fill();
    g.fillStyle = '#111';
    g.fillRect(0, 396, 384, 116);
    g.fillStyle = '#f6e7c1';
    g.font = 'bold 36px Georgia, serif';
    g.fillText('BELIEVE IN', 192, 440);
    g.fillText('YOUR PAYLOAD', 192, 482);
  } else if (kind === 'employee') {
    g.fillStyle = '#efe6cf';
    g.fillRect(0, 0, 384, 512);
    g.strokeStyle = '#b08d3a';
    g.lineWidth = 14;
    g.strokeRect(14, 14, 356, 484);
    g.fillStyle = '#7a1f1a';
    g.font = 'bold 30px Georgia, serif';
    g.fillText('EMPLOYEE', 192, 72);
    g.fillText('OF THE MONTH', 192, 106);
    g.fillStyle = '#c9cfd4';
    g.fillRect(102, 130, 180, 200);
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(192, 215, 48, 0, Math.PI * 2);
    g.fill();
    g.fillRect(132, 262, 120, 68);
    g.fillStyle = '#000';
    g.fillRect(160, 204, 64, 14);
    g.fillStyle = '#e9e9e9';
    g.fillRect(186, 262, 12, 40);
    g.fillStyle = '#222';
    g.font = 'bold 28px Georgia, serif';
    g.fillText('TODD M.', 192, 376);
    g.font = '17px Georgia, serif';
    g.fillText('Field Operations', 192, 402);
    g.font = 'italic 16px Georgia, serif';
    wrap(g, 'For outstanding achievement in not getting eaten.', 192, 440, 300, 20);
  } else {
    g.fillStyle = '#0d0d0f';
    g.fillRect(0, 0, 384, 512);
    grey(g, 192, 150, 120);
    g.strokeStyle = '#d4d4d4';
    g.lineWidth = 2;
    g.strokeRect(16, 16, 352, 480);
    g.fillStyle = '#f2f2f2';
    g.font = 'bold 26px Arial, sans-serif';
    wrap(g, 'YOU MISS 100% OF THE SPECIMENS YOU DON’T CONTAIN', 192, 300, 320, 32);
    g.font = 'italic 17px Georgia, serif';
    g.fillStyle = '#aaa';
    g.fillText('— Director Halvorsen', 192, 460);
  }
  return tex(c);
}

/** A poster on the wall: the print, a thin frame, facing +Z. */
export function poster(kind: PosterKind, w = 0.66, h = 0.88): THREE.Group {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: posterTexture(kind), roughness: 0.55 }));
  face.position.z = 0.012;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.02), mat(0x1c1c1e, 0.5));
  g.add(frame, face);
  return g;
}

// ================================================================ the canteen orders

const ORDERS: { cls: string; lines: [string, string][]; note: string }[] = [
  { cls: 'CLASS III — GREY', lines: [['40 kg', 'Raw potatoes, unwashed'], ['12 L', 'Milk, warm (not hot)'], ['1', 'Birthday cake for Zorp']], note: 'NO SALT. To them salt is a war crime. — Catering' },
  { cls: 'CLASS V — REPTOID', lines: [['6 kg', 'Crickets, LIVE'], ['2', 'Heat lamps for table 4'], ['30', 'Raw eggs, shell on']], note: 'Seat them away from the Greys’ potatoes.' },
  { cls: 'CLASS II — NORDIC', lines: [['9', 'Oat milk lattes, extra hot'], ['9', 'Quinoa bowls, no onion'], ['1', '“Something with kale”']], note: 'Must be served by somebody calm.' },
  { cls: 'CLASS IX — AMORPHOUS', lines: [['1 drum', 'Lime gelatin (industrial)'], ['200', 'Paper plates'], ['1', 'Replacement serving hatch']], note: 'DO NOT serve in glass. It ate the last one.' },
  { cls: 'CLASS VI — INSECTOID', lines: [['20 L', 'Sugar water'], ['200', 'Bananas, overripe'], ['1', 'Fly paper (DO NOT LEAVE OUT)']], note: 'NO bug spray within 50 m of the canteen!!' }
];

export function orderSheetTexture(i: number): THREE.CanvasTexture {
  const o = ORDERS[i % ORDERS.length];
  const c = makeCanvas(384, 512);
  const g = c.getContext('2d')!;
  g.fillStyle = '#f5f1e6';
  g.fillRect(0, 0, 384, 512);
  ecHex(g, 44, 46, 24);
  g.fillStyle = '#222';
  g.textAlign = 'left';
  g.font = 'bold 20px Arial, sans-serif';
  g.fillText('E.C. CANTEEN SERVICES', 80, 42);
  g.font = '13px Arial, sans-serif';
  g.fillText('CATERING REQUISITION — FORM 7B', 80, 62);
  g.fillRect(20, 84, 344, 2);
  g.font = 'bold 14px Courier New, monospace';
  g.fillText('CLASSIFICATION:', 24, 112);
  g.fillStyle = '#1a3aa0';
  g.font = 'bold 22px "Comic Sans MS", cursive';
  g.fillText(o.cls, 24, 142);
  g.fillStyle = '#222';
  g.font = 'bold 13px Courier New, monospace';
  g.fillText('QTY', 24, 180);
  g.fillText('ITEM', 110, 180);
  g.fillRect(20, 186, 344, 1);
  g.fillStyle = '#1a3aa0';
  g.font = '18px "Comic Sans MS", cursive';
  o.lines.forEach(([q, item], k) => {
    g.fillText(q, 24, 216 + k * 34);
    g.fillText(item, 110, 216 + k * 34);
    g.fillStyle = '#bbb';
    g.fillRect(20, 224 + k * 34, 344, 1);
    g.fillStyle = '#1a3aa0';
  });
  g.fillStyle = '#b01818';
  g.font = 'bold 17px "Comic Sans MS", cursive';
  wrap(g, o.note, 24, 352, 330, 22);
  g.fillStyle = '#222';
  g.font = '12px Arial, sans-serif';
  g.fillText('Approved: D. Mendez, Procurement', 24, 470);
  // The stamp
  g.save();
  g.translate(270, 440);
  g.rotate(-0.25);
  g.strokeStyle = 'rgba(190,30,30,0.75)';
  g.lineWidth = 4;
  g.strokeRect(-70, -24, 140, 44);
  g.fillStyle = 'rgba(190,30,30,0.75)';
  g.font = 'bold 26px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('APPROVED', 0, 8);
  g.restore();
  return tex(c);
}

export function orderSheet(i: number, w = 0.21, h = 0.28): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: orderSheetTexture(i), roughness: 0.9, side: THREE.DoubleSide }));
  return m;
}

// ================================================================ comics

export function comicTexture(i: number): THREE.CanvasTexture {
  const c = makeCanvas(600, 240);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbfaf4';
  g.fillRect(0, 0, 600, 240);
  g.fillStyle = '#111';
  g.font = 'bold 16px "Comic Sans MS", cursive';
  g.textAlign = 'left';
  g.fillText(i % 2 ? 'LAB LIFE   by Gary, Sector 7' : 'CONTAINMENT CORNER   by Priya (Lab 4B)', 10, 20);
  const panel = (k: number): number => {
    const x = 10 + k * 196;
    g.strokeStyle = '#111';
    g.lineWidth = 3;
    g.strokeRect(x, 30, 186, 200);
    return x;
  };
  const sci = (x: number, y: number, singed = false): void => {
    g.fillStyle = '#f0c8a0';
    g.beginPath();
    g.arc(x, y, 16, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.strokeRect(x - 11, y - 4, 9, 7);
    g.strokeRect(x + 2, y - 4, 9, 7);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(x - 20, y + 70);
    g.lineTo(x, y + 18);
    g.lineTo(x + 20, y + 70);
    g.closePath();
    g.fill();
    g.stroke();
    if (singed) {
      g.fillStyle = '#222';
      for (let k = -2; k <= 2; k++) {
        g.beginPath();
        g.arc(x + k * 6, y - 16, 5, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = '#888';
      g.beginPath();
      g.moveTo(x + 6, y - 24);
      g.quadraticCurveTo(x + 14, y - 40, x + 4, y - 52);
      g.stroke();
      g.strokeStyle = '#111';
    }
  };
  const bubble = (x: number, y: number, w: number, text: string, tailX: number, tailY: number): void => {
    g.fillStyle = '#fff';
    g.strokeStyle = '#111';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(x, y, w / 2, 26, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(x - 6, y + 22);
    g.lineTo(tailX, tailY);
    g.lineTo(x + 8, y + 22);
    g.fill();
    g.fillStyle = '#111';
    g.font = '13px "Comic Sans MS", cursive';
    g.textAlign = 'center';
    wrap(g, text, x, y - 4, w - 20, 14);
  };
  const tank = (x: number): void => {
    g.fillStyle = '#c9f0c0';
    g.fillRect(x + 100, 100, 70, 120);
    g.strokeRect(x + 100, 100, 70, 120);
    g.fillStyle = '#4caf50';
    g.beginPath();
    g.ellipse(x + 135, 180, 26, 30, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(x + 128, 172, 4, 0, Math.PI * 2);
    g.arc(x + 143, 172, 4, 0, Math.PI * 2);
    g.fill();
  };
  if (i % 2 === 0) {
    let x = panel(0);
    sci(x + 50, 130);
    tank(x);
    bubble(x + 80, 64, 140, 'Is it hostile?', x + 56, 104);
    x = panel(1);
    sci(x + 50, 130);
    tank(x);
    bubble(x + 120, 64, 90, '...', x + 136, 140);
    x = panel(2);
    sci(x + 50, 130, true);
    tank(x);
    bubble(x + 82, 64, 150, 'Put “mildly” in the report.', x + 56, 104);
  } else {
    let x = panel(0);
    sci(x + 50, 130);
    sci(x + 130, 130);
    bubble(x + 92, 62, 170, 'Who keeps leaving specimens in the staff fridge?', x + 120, 102);
    x = panel(1);
    g.fillStyle = '#e6e6e6';
    g.fillRect(x + 40, 60, 106, 160);
    g.strokeRect(x + 40, 60, 106, 160);
    g.fillStyle = '#9cff5a';
    g.fillRect(x + 72, 120, 40, 50);
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(x + 85, 140, 5, 0, Math.PI * 2);
    g.arc(x + 99, 140, 5, 0, Math.PI * 2);
    g.fill();
    x = panel(2);
    g.fillStyle = '#9cff5a';
    g.fillRect(x + 50, 80, 86, 110);
    g.strokeRect(x + 50, 80, 86, 110);
    g.fillStyle = '#fff';
    g.fillRect(x + 56, 120, 74, 34);
    g.fillStyle = '#111';
    g.font = 'bold 12px "Comic Sans MS", cursive';
    g.textAlign = 'center';
    g.fillText('GARY’S LUNCH', x + 93, 134);
    g.fillText('DO NOT EAT', x + 93, 149);
  }
  return tex(c);
}

export function comic(i: number, w = 0.5): THREE.Mesh {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.4), new THREE.MeshStandardMaterial({ map: comicTexture(i), roughness: 0.9, side: THREE.DoubleSide }));
}

// ================================================================ the mug

let mugParts: { side: THREE.Material; top: THREE.Material; plain: THREE.Material; body: THREE.BufferGeometry; handle: THREE.BufferGeometry } | null = null;

/** PIONEERING EXTRATERRESTRIAL WEAPONRY SINCE 2003 — on both sides, the handle toward +Z. */
export function ecMug(full = true): THREE.Group {
  if (!mugParts) {
    const c = makeCanvas(1024, 256);
    const g = c.getContext('2d')!;
    g.fillStyle = '#f4f2ee';
    g.fillRect(0, 0, 1024, 256);
    for (const cx of [256, 768]) {
      ecHex(g, cx, 76, 42);
      g.fillStyle = '#1d1d1f';
      g.textAlign = 'center';
      g.font = 'bold 30px Arial, sans-serif';
      g.fillText('PIONEERING', cx, 160);
      g.font = 'bold 22px Arial, sans-serif';
      g.fillText('EXTRATERRESTRIAL WEAPONRY', cx, 192);
      g.fillStyle = '#c4261c';
      g.font = 'bold 22px Arial, sans-serif';
      g.fillText('SINCE 2003', cx, 224);
    }
    const body = new THREE.CylinderGeometry(0.043, 0.04, 0.1, 24);
    const handle = new THREE.TorusGeometry(0.027, 0.0075, 6, 14, Math.PI * 1.25);
    handle.rotateY(Math.PI / 2);
    handle.rotateX(-Math.PI * 0.62);
    mugParts = {
      side: new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.3 }),
      top: new THREE.MeshStandardMaterial({ color: 0x2a160a, roughness: 0.15 }),
      plain: new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.3 }),
      body,
      handle
    };
  }
  const P = mugParts;
  const g = new THREE.Group();
  const b = new THREE.Mesh(P.body, [P.side, full ? P.top : P.plain, P.plain]);
  b.position.y = 0.05;
  const h = new THREE.Mesh(P.handle, P.plain);
  h.position.set(0, 0.05, 0.046);
  g.add(b, h);
  return g;
}

// ================================================================ screens

export type ScreenKind = 'sentries' | 'vats' | 'map' | 'cams' | 'specimen' | 'email';

export function screenTexture(kind: ScreenKind, w = 512, h = 320): THREE.CanvasTexture {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  g.fillStyle = '#04100a';
  g.fillRect(0, 0, w, h);
  const green = '#5dff8a';
  const dim = '#2b8a4a';
  g.textAlign = 'left';
  g.font = 'bold 18px Courier New, monospace';
  if (kind === 'sentries') {
    g.fillStyle = green;
    g.fillText('E.C. SECTOR 7 — SENTRY NETWORK', 16, 30);
    g.fillStyle = dim;
    g.fillRect(16, 40, w - 32, 2);
    g.font = '17px Courier New, monospace';
    ['S1  WALKWAY 1    ONLINE   SWEEP 0.30', 'S2  WALKWAY 2    ONLINE   SWEEP 0.42', 'S3  WALKWAY 4    ONLINE   SWEEP 0.42', 'S4  WALKWAY 5    ONLINE   SWEEP 0.40'].forEach((l, i) => {
      g.fillStyle = green;
      g.fillText(l, 16, 76 + i * 30);
    });
    g.fillStyle = '#ffcf3a';
    g.fillText('INTRUDERS DETECTED: 0', 16, 216);
    g.fillStyle = dim;
    g.fillText('LAST CALIBRATION: 14/03   BY: GARY', 16, 250);
    g.fillStyle = green;
    g.fillText('> _', 16, 290);
  } else if (kind === 'vats') {
    g.fillStyle = green;
    g.fillText('VAT LINE 2 — FLOW NOMINAL', 16, 30);
    for (let i = 0; i < 8; i++) {
      const v = 0.35 + ((i * 37) % 60) / 100;
      const x = 24 + i * 60;
      g.fillStyle = i % 3 === 1 ? '#b35cff' : '#7dff5a';
      g.fillRect(x, 270 - v * 200, 36, v * 200);
      g.strokeStyle = dim;
      g.strokeRect(x, 70, 36, 200);
      g.fillStyle = green;
      g.font = '13px Courier New, monospace';
      g.fillText('V-' + String(i + 1).padStart(2, '0'), x, 292);
      g.fillText(Math.round(v * 100) + '%', x, 310);
    }
  } else if (kind === 'map') {
    g.fillStyle = '#041018';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3ad0ff';
    g.lineWidth = 2;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#3ad0ff';
    g.font = 'bold 16px Courier New, monospace';
    g.fillText('SECTOR 7 — CONTAINMENT HALL', 18, 30);
    // The route as it is, roughly: x across, z down
    const X = (x: number): number => 30 + ((x + 60) / 120) * (w - 60);
    const Z = (z: number): number => 44 + ((z + 70) / 140) * (h - 64);
    const r = (x0: number, z0: number, x1: number, z1: number): void => g.strokeRect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0));
    g.lineWidth = 1.5;
    r(-60, -34, -53, -28);
    r(-53, -32, -36, -30);
    r(-36, -36, -28, -27);
    r(-33, -27, -31, -3);
    r(-36, -3, -28, 13);
    r(-28, 9, -2, 11);
    r(-2, 6, 6, 14);
    r(1, 14, 3, 30);
    r(-2, 30, 6, 38);
    r(26, 30, 34, 48);
    r(34, 43, 40, 45);
    g.setLineDash([6, 4]);
    g.beginPath();
    g.moveTo(X(42.5), Z(-70));
    g.lineTo(X(42.5), Z(70));
    for (const z of [4.4, 1.8, -0.8]) {
      g.moveTo(X(46.5), Z(z));
      g.lineTo(X(60), Z(z));
    }
    g.stroke();
    g.setLineDash([]);
    r(44, 8.5, 47, 12.5);
    r(50, 6, 56, 14);
    r(50, -8, 56, -2.4);
    r(48.6, -11, 57.4, -8);
    r(50, -16, 56, -11);
    r(52.4, -24, 54.6, -16.4);
    r(52, -36, 60, -24);
    r(45, -24, 58.6, -11);
    g.fillStyle = '#ff4a3a';
    g.beginPath();
    g.arc(X(51), Z(-17), 6, 0, Math.PI * 2);
    g.fill();
    g.font = 'bold 13px Courier New, monospace';
    g.fillText('YOU ARE HERE', X(51) - 120, Z(-17) + 4);
    g.fillStyle = '#3ad0ff';
    for (const [x, z] of [[-44.5, -50], [-17, -15], [17, 22], [37, 25]] as const) {
      g.beginPath();
      g.arc(X(x), Z(z), 4, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'cams') {
    const labels = ['CAM 03 — SEWER C', 'CAM 07 — VAT LINE', 'CAM 11 — CARGO', 'CAM 12 — LIFT'];
    for (let i = 0; i < 4; i++) {
      const x = (i % 2) * (w / 2);
      const y = Math.floor(i / 2) * (h / 2);
      const n = noiseTile(128, [44 + i * 6, 52, 48], { fine: 30, blobs: 6, blobAmp: 20 });
      g.drawImage(n, x + 4, y + 4, w / 2 - 8, h / 2 - 8);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 4, y + 4, w / 2 - 8, 22);
      g.fillStyle = '#e8e8e8';
      g.font = 'bold 13px Courier New, monospace';
      g.fillText(labels[i], x + 10, y + 20);
      g.fillStyle = '#ff3a2a';
      g.beginPath();
      g.arc(x + w / 2 - 18, y + 15, 5, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'specimen') {
    g.strokeStyle = '#3ad0ff';
    g.lineWidth = 2;
    for (let k = 0; k < 7; k++) {
      g.beginPath();
      g.ellipse(150, 160, 70 - k * 3, 92, 0, 0, Math.PI * 2);
      g.globalAlpha = 0.25 + k * 0.1;
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#3ad0ff';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(150 + s * 28, 160, 20, 10, s * -0.5, 0, Math.PI * 2);
      g.fill();
    }
    g.font = 'bold 16px Courier New, monospace';
    ['SPECIMEN 0451', 'CLASS III — GREY', 'MASS: 31.4 kg', 'MOOD: UNKNOWN', 'STATUS:', 'CONTAINED (MOSTLY)'].forEach((l, i) => g.fillText(l, 260, 70 + i * 34));
  } else {
    g.fillStyle = '#d8e2ea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2b4a7a';
    g.fillRect(0, 0, w, 34);
    g.fillStyle = '#fff';
    g.fillText('E.C. MAIL — INBOX (14)', 12, 24);
    g.font = '15px Arial, sans-serif';
    ['RE: RE: RE: Who took my potatoes', 'Mandatory fun: tentacle-safety seminar', 'Your parking permit for Hangar 2 has expired', 'FW: Canteen menu — Class IX week', 'Turret S3 shot the vending machine again', 'Lost: one (1) jar. Glowing. Answers to Kevin.'].forEach((l, i) => {
      g.fillStyle = i < 2 ? '#111' : '#555';
      g.font = (i < 2 ? 'bold ' : '') + '15px Arial, sans-serif';
      g.fillText(l, 14, 62 + i * 40);
      g.fillStyle = '#b8c4ce';
      g.fillRect(8, 72 + i * 40, w - 16, 1);
    });
  }
  // Scanlines over it all
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  return tex(c);
}

/** A flat screen glowing with `kind`, on a thin bezel; facing +Z. */
export function screenPanel(kind: ScreenKind, w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  boxAt(g, mat(0x16181b, 0.4, 0.3), w + 0.04, h + 0.04, 0.04, 0, 0, -0.02);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: screenTexture(kind, kind === 'map' ? 1024 : 512, kind === 'map' ? 600 : 320), toneMapped: false }));
  s.position.z = 0.002;
  g.add(s);
  return g;
}

/** A desk monitor on its foot with a live screen; faces +Z. */
export function monitor(kind: ScreenKind): THREE.Group {
  const g = new THREE.Group();
  const dark = mat(0x1b1c1f, 0.5);
  boxAt(g, dark, 0.22, 0.015, 0.16, 0, 0.008, 0);
  boxAt(g, dark, 0.04, 0.16, 0.03, 0, 0.09, -0.02);
  const scr = screenPanel(kind, 0.52, 0.32);
  scr.position.set(0, 0.35, 0.0);
  g.add(scr);
  boxAt(g, dark, 0.44, 0.02, 0.14, 0, 0.01, 0.28);
  return g;
}

// ================================================================ cargo

const CARGO = [
  ['LAB EQUIPMENT', 'FRAGILE — GLASS'],
  ['CENTRIFUGE', 'UNIT 4 — THIS WAY UP'],
  ['SPECIMEN TANKS', 'EMPTY — HANDLE WITH CARE'],
  ['PLASMA COILS', 'KEEP DRY'],
  ['MICROSCOPES', 'ATTN: LAB 4B']
];

/** A crate's side: painted steel, a stencil, the hex, a handling mark. */
export function cargoTexture(i: number): THREE.CanvasTexture {
  const [a, b] = CARGO[i % CARGO.length];
  const base: [number, number, number] = [[58, 74, 92], [96, 102, 108], [70, 88, 70]][i % 3] as [number, number, number];
  const c = noiseTile(256, base, { fine: 14, blobs: 8, blobAmp: 10 });
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(20,22,24,0.85)';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 246, 246);
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(5, 5);
  g.lineTo(251, 251);
  g.stroke();
  g.fillStyle = 'rgba(30,32,34,0.55)';
  g.fillRect(28, 66, 200, 120);
  g.fillStyle = '#f3efe3';
  g.textAlign = 'center';
  g.font = 'bold 27px Courier New, monospace';
  g.fillText(a, 128, 112);
  g.fillStyle = '#ff9a2a';
  g.font = 'bold 15px Courier New, monospace';
  g.fillText(b, 128, 142);
  g.fillStyle = '#f3efe3';
  g.font = '12px Courier New, monospace';
  g.fillText('E.C. LOGISTICS — SECTOR 7', 128, 170);
  ecHex(g, 210, 40, 18, '#f3efe3');
  // ↑↑
  g.fillStyle = '#f3efe3';
  for (const x of [40, 64]) {
    g.beginPath();
    g.moveTo(x, 22);
    g.lineTo(x + 9, 38);
    g.lineTo(x + 3, 38);
    g.lineTo(x + 3, 54);
    g.lineTo(x - 3, 54);
    g.lineTo(x - 3, 38);
    g.lineTo(x - 9, 38);
    g.closePath();
    g.fill();
  }
  return tex(c);
}

// ================================================================ the maintenance room

const STEEL = mat(0x7d838a, 0.45, 0.7);
const GREYPAINT = mat(0x59606a, 0.6, 0.3);

/** Steel shelving: four uprights, `n` shelves; footprint w × d, origin at the floor middle. */
export function shelfUnit(w: number, d: number, h: number, n: number): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-w / 2 + 0.02, w / 2 - 0.02]) for (const z of [-d / 2 + 0.02, d / 2 - 0.02]) boxAt(g, GREYPAINT, 0.04, h, 0.04, x, h / 2, z);
  for (let i = 0; i < n; i++) {
    const y = 0.12 + (i * (h - 0.2)) / (n - 1);
    boxAt(g, STEEL, w, 0.025, d, 0, y, 0);
    boxAt(g, GREYPAINT, w, 0.05, 0.02, 0, y - 0.01, d / 2 - 0.01);
  }
  return g;
}

/** Shelf heights of a shelfUnit, for putting things on. */
export function shelfTops(h: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => 0.12 + (i * (h - 0.2)) / (n - 1) + 0.0125);
}

/** A plastic jug of cleaner with a label and a cap. */
export function cleanerJug(color: number, label = '#f2f2f2'): THREE.Group {
  const g = new THREE.Group();
  const body = boxAt(g, mat(color, 0.4), 0.13, 0.24, 0.09, 0, 0.12, 0);
  void body;
  boxAt(g, new THREE.MeshStandardMaterial({ color: label, roughness: 0.6 }), 0.1, 0.1, 0.002, 0, 0.11, 0.046);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.04, 10), mat(color, 0.4));
  neck.position.set(0.03, 0.26, 0);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.025, 10), mat(0x1d1d1d, 0.5));
  cap.position.set(0.03, 0.29, 0);
  // The handle loop
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 5, 10, Math.PI), mat(color, 0.4));
  handle.position.set(-0.025, 0.24, 0);
  g.add(neck, cap, handle);
  return g;
}

/** A spray bottle: body, neck, trigger head. */
export function sprayBottle(color: number): THREE.Group {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.17, 10), mat(color, 0.3));
  b.position.y = 0.085;
  const head = boxAt(g, mat(0xeeeeee, 0.5), 0.03, 0.05, 0.08, 0, 0.2, 0.015);
  void head;
  boxAt(g, mat(0xeeeeee, 0.5), 0.015, 0.04, 0.015, 0, 0.17, 0.04);
  g.add(b);
  return g;
}

export function paintCan(color: number): THREE.Group {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.19, 16), STEEL);
  c.position.y = 0.095;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.087, 0.087, 0.11, 16, 1, true), mat(color, 0.6));
  band.position.y = 0.09;
  g.add(c, band);
  return g;
}

export function cardboardBox(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  boxAt(g, mat(0xa8865a, 0.9), w, h, d, 0, h / 2, 0);
  boxAt(g, mat(0xc9b48a, 0.8), w * 0.98, 0.012, 0.05, 0, h + 0.003, 0);
  return g;
}

/** A pack of toilet rolls in its plastic. */
export function rollPack(): THREE.Group {
  const g = new THREE.Group();
  const roll = new THREE.CylinderGeometry(0.055, 0.055, 0.11, 12);
  const m = mat(0xf6f6f2, 0.9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    const r = new THREE.Mesh(roll, m);
    r.position.set(-0.11 + i * 0.11, 0.055 + k * 0.11, -0.055 + j * 0.11);
    g.add(r);
  }
  return g;
}

/** A yellow mop bucket on castors, wringer on top, the mop stood in it. */
export function mopBucket(): THREE.Group {
  const g = new THREE.Group();
  const yellow = mat(0xe8b70e, 0.45);
  const black = mat(0x1b1b1b, 0.6);
  const bucket = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.34), yellow);
  bucket.position.y = 0.25;
  g.add(bucket);
  boxAt(g, mat(0x56742a, 0.2), 0.38, 0.01, 0.3, 0, 0.38, 0);
  boxAt(g, black, 0.2, 0.18, 0.26, 0.12, 0.5, 0);
  for (const [x, z] of [[-0.18, -0.14], [0.18, -0.14], [-0.18, 0.14], [0.18, 0.14]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 10), black);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.035, z);
    g.add(w);
  }
  g.add(mop(-0.08, 0, -0.18));
  return g;
}

export function mop(x = 0, z = 0, tilt = -0.15): THREE.Group {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.35, 8), mat(0x2b5aa8, 0.4, 0.3));
  stick.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.05, 0.16, 10), mat(0xd8d2c0, 1));
  head.position.y = 0.1;
  g.add(stick, head);
  g.position.set(x, 0.1, z);
  g.rotation.z = tilt;
  return g;
}

export function broom(): THREE.Group {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.3, 8), mat(0x8a6a3a, 0.7));
  stick.position.y = 0.77;
  g.add(stick);
  boxAt(g, mat(0xb4261c, 0.5), 0.32, 0.05, 0.06, 0, 0.11, 0);
  boxAt(g, mat(0x2a2a2a, 0.9), 0.3, 0.09, 0.05, 0, 0.045, 0);
  return g;
}

/** The yellow A-frame: CAUTION WET FLOOR on both faces. */
export function wetFloorSign(): THREE.Group {
  const c = makeCanvas(128, 256);
  const g2 = c.getContext('2d')!;
  g2.fillStyle = '#f2c414';
  g2.fillRect(0, 0, 128, 256);
  g2.fillStyle = '#111';
  g2.textAlign = 'center';
  g2.font = 'bold 22px Arial, sans-serif';
  g2.fillText('CAUTION', 64, 40);
  g2.beginPath();
  g2.moveTo(64, 62);
  g2.lineTo(104, 132);
  g2.lineTo(24, 132);
  g2.closePath();
  g2.lineWidth = 6;
  g2.stroke();
  g2.fillRect(60, 84, 8, 26);
  g2.fillRect(60, 116, 8, 8);
  g2.font = 'bold 20px Arial, sans-serif';
  g2.fillText('WET', 64, 172);
  g2.fillText('FLOOR', 64, 198);
  const m = new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.5, side: THREE.DoubleSide });
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.62), m);
    p.position.set(0, 0.3, s * 0.1);
    p.rotation.x = s * 0.17;
    g.add(p);
  }
  return g;
}

export function toolbox(): THREE.Group {
  const g = new THREE.Group();
  const red = mat(0xb01c16, 0.4, 0.4);
  boxAt(g, red, 0.5, 0.22, 0.24, 0, 0.11, 0);
  boxAt(g, mat(0x8a1410, 0.4, 0.4), 0.5, 0.02, 0.245, 0, 0.17, 0);
  boxAt(g, STEEL, 0.3, 0.02, 0.03, 0, 0.27, 0);
  for (const x of [-0.14, 0.14]) boxAt(g, STEEL, 0.02, 0.06, 0.03, x, 0.25, 0);
  return g;
}

/** Pegboard with its tools hung on it; facing +Z, origin at its middle. */
export function pegboard(w: number, h: number): THREE.Group {
  const c = makeCanvas(256, 128);
  const g2 = c.getContext('2d')!;
  g2.fillStyle = '#b89a6a';
  g2.fillRect(0, 0, 256, 128);
  g2.fillStyle = '#4a3a22';
  for (let y = 6; y < 128; y += 10) for (let x = 6; x < 256; x += 10) g2.fillRect(x, y, 2.4, 2.4);
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), [mat(0x8a7350), mat(0x8a7350), mat(0x8a7350), mat(0x8a7350), new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.9 }), mat(0x8a7350)]);
  g.add(board);
  const tool = new THREE.Group();
  const steel = STEEL;
  const grip = mat(0xc8261c, 0.6);
  // Spanners of three sizes
  for (let i = 0; i < 3; i++) {
    const x = -w / 2 + 0.15 + i * 0.09;
    boxAt(tool, steel, 0.025, 0.2 + i * 0.04, 0.01, x, 0.05, 0.02);
    boxAt(tool, steel, 0.05, 0.03, 0.01, x, 0.15 + i * 0.02, 0.02);
  }
  // A hammer
  boxAt(tool, mat(0x8a6a3a), 0.03, 0.28, 0.02, 0.05, -0.02, 0.025);
  boxAt(tool, steel, 0.14, 0.045, 0.035, 0.05, 0.12, 0.03);
  // Screwdrivers
  for (let i = 0; i < 4; i++) {
    const x = 0.2 + i * 0.05;
    boxAt(tool, grip, 0.025, 0.09, 0.025, x, 0.08, 0.025);
    boxAt(tool, steel, 0.008, 0.12, 0.008, x, -0.03, 0.025);
  }
  // A saw
  boxAt(tool, steel, 0.4, 0.09, 0.004, w / 2 - 0.3, -0.15, 0.02);
  boxAt(tool, grip, 0.1, 0.1, 0.03, w / 2 - 0.08, -0.13, 0.025);
  // Pliers, a roll of tape
  boxAt(tool, grip, 0.02, 0.12, 0.02, -0.2, -0.16, 0.025);
  boxAt(tool, grip, 0.02, 0.12, 0.02, -0.17, -0.16, 0.025);
  const tape = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.02, 6, 14), mat(0x9a9a9a, 0.6));
  tape.position.set(-0.05, -0.17, 0.03);
  tool.add(tape);
  g.add(tool);
  return g;
}

/** A hose reel on its wall bracket; facing +Z. */
export function hoseReel(): THREE.Group {
  const g = new THREE.Group();
  boxAt(g, GREYPAINT, 0.1, 0.4, 0.04, 0, 0, -0.02);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 16), mat(0x2a5a2a, 0.6));
  drum.rotation.x = Math.PI / 2;
  drum.position.z = 0.1;
  const hose = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 22), mat(0x1f6a2a, 0.5));
  hose.position.z = 0.1;
  const hose2 = hose.clone();
  hose2.position.z = 0.15;
  const hose3 = hose.clone();
  hose3.position.z = 0.05;
  g.add(drum, hose, hose2, hose3);
  return g;
}

export function hardHat(color = 0xf2c414): THREE.Group {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(color, 0.4));
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 18), mat(color, 0.4));
  g.add(dome, brim);
  return g;
}

export function rubberBoots(): THREE.Group {
  const g = new THREE.Group();
  const m = mat(0x1d2a1d, 0.55);
  for (const x of [-0.07, 0.07]) {
    boxAt(g, m, 0.1, 0.36, 0.12, x, 0.18, 0);
    boxAt(g, m, 0.1, 0.08, 0.26, x, 0.04, 0.07);
  }
  return g;
}

/** A sturdy steel-topped bench, w long; drawers on one end. */
export function workbench(w: number): THREE.Group {
  const g = new THREE.Group();
  boxAt(g, mat(0x6a5038, 0.8), w, 0.05, 0.7, 0, 0.88, 0);
  boxAt(g, STEEL, w, 0.006, 0.7, 0, 0.91, 0);
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) for (const z of [-0.3, 0.3]) boxAt(g, GREYPAINT, 0.05, 0.86, 0.05, x, 0.43, z);
  boxAt(g, GREYPAINT, w - 0.1, 0.03, 0.6, 0, 0.18, 0);
  boxAt(g, mat(0x2a5a8a, 0.5, 0.3), 0.5, 0.6, 0.62, w / 2 - 0.32, 0.55, 0);
  for (let i = 0; i < 3; i++) boxAt(g, STEEL, 0.2, 0.02, 0.02, w / 2 - 0.32, 0.4 + i * 0.18, 0.32);
  return g;
}

/** The janitor's cart: grey frame, a trash bag hung off one end, bottles in the tray. */
export function janitorCart(): THREE.Group {
  const g = new THREE.Group();
  const grey = mat(0x6a7078, 0.6);
  boxAt(g, grey, 0.9, 0.04, 0.48, 0, 0.18, 0);
  boxAt(g, grey, 0.9, 0.04, 0.48, 0, 0.62, 0);
  for (const x of [-0.43, 0.43]) for (const z of [-0.22, 0.22]) boxAt(g, grey, 0.03, 0.8, 0.03, x, 0.42, z);
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), mat(0x161616, 0.35));
  bag.scale.set(0.9, 1.25, 0.9);
  bag.position.set(0.62, 0.48, 0);
  g.add(bag);
  for (const [i, c] of [0xd8302a, 0x2a8ad8, 0x2ab84a].entries()) {
    const b = sprayBottle(c);
    b.position.set(-0.3 + i * 0.12, 0.64, 0.05);
    g.add(b);
  }
  const j = cleanerJug(0xf2d22a);
  j.position.set(0.15, 0.2, 0.05);
  g.add(j);
  for (const [x, z] of [[-0.4, -0.2], [0.4, -0.2], [-0.4, 0.2], [0.4, 0.2]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10), mat(0x111111));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.04, z);
    g.add(w);
  }
  return g;
}

/** A sign for a door: white on blue, two lines. Facing +Z. */
export function doorSign(top: string, bottom: string, w = 0.9, h = 0.3): THREE.Mesh {
  const c = makeCanvas(384, 128);
  const g = c.getContext('2d')!;
  g.fillStyle = '#1d4f8a';
  g.fillRect(0, 0, 384, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 4;
  g.strokeRect(6, 6, 372, 116);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = 'bold 40px Arial, sans-serif';
  g.fillText(top, 192, 58);
  g.font = 'bold 22px Arial, sans-serif';
  g.fillText(bottom, 192, 96);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.5 }));
}

/** A yellow-on-black warning plate, facing +Z. */
export function warnPlate(text: string, w: number, h: number): THREE.Mesh {
  const c = makeCanvas(512, Math.round((512 * h) / w));
  const g = c.getContext('2d')!;
  g.fillStyle = '#c99a12';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#16140f';
  g.fillRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = '#e0b21a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = Math.round(c.height * 0.5);
  do {
    g.font = `bold ${size}px Courier New, monospace`;
    size -= 1;
  } while (size > 8 && g.measureText(text).width > c.width - 32);
  g.fillText(text, c.width / 2, c.height / 2);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.6 }));
}

/** The lift's collapsible gate: uprights and the scissor lattice between them (holes transparent). */
export function scissorGateTexture(): THREE.CanvasTexture {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = '#b8bcc0';
  g.lineWidth = 7;
  for (let x = 4; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  g.lineWidth = 4;
  for (let x = 4; x < 256; x += 32) {
    for (let y = 0; y < 256; y += 64) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 32, y + 64);
      g.moveTo(x + 32, y);
      g.lineTo(x, y + 64);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
