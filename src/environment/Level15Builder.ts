import * as THREE from 'three';
import type { Collider } from './OfficeLevelBuilder';
import type { CombatLevel } from '../scenes/CombatScene';
import { makeCanvas, tiling } from './Level8Builder';
import { mergeStatic } from './mergeStatic';
import { suitModel } from '../entities/FieldSuit';

/**
 * Level15Builder — the portal room.
 *
 *  A round hall, 52 m across, a dome over it. Ravi comes in from the south
 *  through a short service passage whose far end has just come down behind
 *  him. In the middle, up three steps, the Atom Warper: a ring of eight coil
 *  pylons joined at the top by a great hoop, three gimbal rings hung round a
 *  glowing pad, and on the pad a pedestal with three buttons. An emitter
 *  hangs over it from the dome. Cables from everywhere — the consoles, the
 *  racks round the wall, the dome — run in to it.
 *
 *  Round it, banks of consoles nobody could make sense of, monitoring
 *  instruments, racks of blinking equipment round the wall, a gallery above.
 *  In an alcove in the west wall, the suit.
 *
 * Floor at 0, the centre at the origin, the way in at +z.
 */

export const ROOM = { r: 26, h: 18, dome: 12 };
export const DAIS = { top: 0.75, steps: [[7.2, 0.25], [6.6, 0.5], [6.0, 0.75]] as [number, number][] };
export const PYLON = { r: 5.2, h: 8.6 };
export const RING_Y = DAIS.top + 8.9;
export const PAD = { r: 1.45 };
/** Where the pedestal stands on the pad (its front toward +z, where he stands). */
export const PODIUM = new THREE.Vector3(0, DAIS.top, -0.95);
/** The passage he comes in by. */
export const ENTRY = { x0: -1.7, x1: 1.7, z0: ROOM.r - 0.5, z1: 31.5, h: 3.2 };
/** The suit's alcove: its angle round the room (0 the way in, −π/2 the west wall). */
const SUIT_ANGLE = -1.43;

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
/** A point at angle `a` round the room (0 = +z, the way in) and radius `r`. */
const polar = (a: number, r: number, y = 0): THREE.Vector3 => V(Math.sin(a) * r, y, Math.cos(a) * r);

export interface KnockProp {
  mesh: THREE.Object3D;
  /** Half-size of its box for the physics. */
  half: THREE.Vector3;
  mass: number;
  kind: 'cup' | 'paper' | 'clipboard' | 'binder' | 'monitor' | 'chair' | 'box' | 'bottle';
}

export interface ScreenSurface {
  tex: THREE.CanvasTexture;
  draw: (t: number, k: number) => void;
}

export interface Level15Data extends CombatLevel {
  start: { pos: THREE.Vector3; yaw: number };
  /** The passage's far end coming down behind him: the chunks fall to where they lie. */
  rubble: { pieces: { mesh: THREE.Mesh; to: THREE.Vector3; from: THREE.Vector3; delay: number; spin: THREE.Vector3 }[]; at: THREE.Vector3 };
  suit: { model: THREE.Group; stand: THREE.Vector3; look: THREE.Vector3; light: THREE.PointLight };
  /** Materials of the suit (on the rack and on his arms): the scene gives them an environment to shine in. */
  suitMats: THREE.MeshStandardMaterial[];
  podium: { buttons: { cap: THREE.Mesh; mat: THREE.MeshStandardMaterial; at: THREE.Vector3; rest: number }[]; screen: ScreenSurface; front: THREE.Vector3 };
  rings: THREE.Group[];
  pylonGlow: THREE.MeshStandardMaterial;
  cableGlow: THREE.MeshStandardMaterial;
  padMat: THREE.MeshStandardMaterial;
  beam: THREE.Mesh;
  emitter: THREE.Group;
  screens: ScreenSurface[];
  needles: { obj: THREE.Object3D; base: number; amp: number; rate: number; ph: number }[];
  leds: THREE.Texture[];
  chart: THREE.Texture;
  reels: THREE.Object3D[];
  beacons: THREE.Object3D[];
  props: KnockProp[];
  sparkPoints: THREE.Vector3[];
  lights: { center: THREE.PointLight; ring: THREE.PointLight[]; entry: THREE.PointLight };
  lamps: THREE.MeshStandardMaterial;
}

// ================================================================ textures

function floorTexture(): THREE.CanvasTexture {
  const S = 2048;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  const cx = S / 2;
  const px = S / (ROOM.r * 2);
  g.fillStyle = '#1d2226';
  g.fillRect(0, 0, S, S);
  // Big polished tiles, each its own shade
  const tile = 1.5 * px;
  for (let x = 0; x < S; x += tile)
    for (let y = 0; y < S; y += tile) {
      const v = 30 + Math.floor(Math.random() * 10);
      g.fillStyle = `rgb(${v},${v + 5},${v + 9})`;
      g.fillRect(x + 1, y + 1, tile - 2, tile - 2);
    }
  for (let k = 0; k < 9000; k++) {
    g.fillStyle = `rgba(200,220,240,${Math.random() * 0.04})`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // Painted rings round the machine, radial lines, a hazard band at the foot of its steps
  const ring = (r: number, w: number, col: string): void => {
    g.strokeStyle = col;
    g.lineWidth = w * px;
    g.beginPath();
    g.arc(cx, cx, r * px, 0, Math.PI * 2);
    g.stroke();
  };
  ring(7.7, 0.5, '#c9a227');
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    g.strokeStyle = '#121212';
    g.lineWidth = 0.22 * px;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 7.45 * px, cx + Math.sin(a) * 7.45 * px);
    g.lineTo(cx + Math.cos(a + 0.05) * 7.95 * px, cx + Math.sin(a + 0.05) * 7.95 * px);
    g.stroke();
  }
  ring(9.2, 0.08, 'rgba(120,180,220,0.5)');
  ring(12.0, 0.06, 'rgba(120,180,220,0.35)');
  ring(19.5, 0.06, 'rgba(120,180,220,0.3)');
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.strokeStyle = 'rgba(120,180,220,0.25)';
    g.lineWidth = 0.05 * px;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 8.2 * px, cx + Math.sin(a) * 8.2 * px);
    g.lineTo(cx + Math.cos(a) * 24 * px, cx + Math.sin(a) * 24 * px);
    g.stroke();
  }
  // Stencilled designations round the inner ring
  g.fillStyle = 'rgba(200,210,215,0.45)';
  g.font = `bold ${Math.round(0.42 * px)}px Arial`;
  g.textAlign = 'center';
  const words = ['AW-1', 'ZONE A', 'NO STANDING', 'AW-1', 'ZONE B', 'NO STANDING', 'AW-1', 'ZONE C'];
  words.forEach((w, i) => {
    const a = (i / words.length) * Math.PI * 2 + 0.2;
    g.save();
    g.translate(cx + Math.cos(a) * 8.6 * px, cx + Math.sin(a) * 8.6 * px);
    g.rotate(a + Math.PI / 2);
    g.fillText(w, 0, 0);
    g.restore();
  });
  // Scuffs and wheel marks
  for (let k = 0; k < 40; k++) {
    g.strokeStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.1})`;
    g.lineWidth = 2 + Math.random() * 6;
    g.beginPath();
    const x = Math.random() * S;
    const y = Math.random() * S;
    g.moveTo(x, y);
    g.quadraticCurveTo(x + (Math.random() - 0.5) * 300, y + (Math.random() - 0.5) * 300, x + (Math.random() - 0.5) * 400, y + (Math.random() - 0.5) * 400);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function wallTexture(): THREE.CanvasTexture {
  const c = makeCanvas(512, 512);
  const g = c.getContext('2d')!;
  g.fillStyle = '#2b3136';
  g.fillRect(0, 0, 512, 512);
  // Riveted panels
  for (let x = 0; x < 512; x += 128)
    for (let y = 0; y < 512; y += 256) {
      const v = 40 + Math.floor(Math.random() * 10);
      g.fillStyle = `rgb(${v},${v + 6},${v + 11})`;
      g.fillRect(x + 3, y + 3, 122, 250);
      g.fillStyle = '#1a1e21';
      for (const [rx, ry] of [[10, 10], [118, 10], [10, 244], [118, 244], [64, 10], [64, 244]]) {
        g.beginPath();
        g.arc(x + rx, y + ry, 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  for (let k = 0; k < 2500; k++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
  }
  return tiling(c);
}

/** A grid of indicator lamps, most off, some lit in four colours: scrolled to make them blink. */
function ledTexture(seed: number): THREE.CanvasTexture {
  const c = makeCanvas(128, 256);
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 256);
  let s = seed;
  const r = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const cols = ['#40ff70', '#ffb030', '#ff3a2a', '#4ab8ff'];
  for (let y = 4; y < 256; y += 8)
    for (let x = 4; x < 128; x += 8) {
      if (r() < 0.55) continue;
      g.fillStyle = cols[Math.floor(r() * (r() < 0.6 ? 1 : 4))];
      g.fillRect(x - 2, y - 2, 4, 4);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The chart recorder's paper: a scrolling trace and its grid. */
function chartTexture(): THREE.CanvasTexture {
  const c = makeCanvas(256, 512);
  const g = c.getContext('2d')!;
  g.fillStyle = '#efe9d8';
  g.fillRect(0, 0, 256, 512);
  g.strokeStyle = 'rgba(200,80,80,0.35)';
  for (let x = 0; x < 256; x += 16) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 512);
    g.stroke();
  }
  for (let y = 0; y < 512; y += 16) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  for (const [col, off] of [['#1a2a8a', 0], ['#8a1a1a', 3]] as const) {
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.beginPath();
    let x = 128;
    for (let y = 0; y <= 512; y += 3) {
      x += (Math.random() - 0.5) * 18 + Math.sin(y * 0.05 + off) * 3;
      x = Math.max(20, Math.min(236, x));
      if (y === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Notation nobody outside this room could read: tensors, bra-kets, half-invented operators. */
const GLYPHS = ['Ψ', 'Φ', 'Ω', '∂', '∇', '∮', '⊗', '⊕', 'λ', 'ξ', 'ζ', 'ℏ', '∑', '∫', 'Δ', 'ρ', 'σ', 'τ', 'ℵ', '≜', '⟨', '⟩', '∞', '√'];
function gibberish(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    s += r < 0.35 ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : r < 0.6 ? String(Math.floor(Math.random() * 10)) : r < 0.75 ? '.' : r < 0.88 ? ' ' : '·';
  }
  return s;
}

/** A screen's face: what it shows depends on `kind`; `k` is how far the warp has wound up (0..1). */
function screenSurface(kind: number, w = 256, h = 160): ScreenSurface {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const lines = Array.from({ length: 14 }, () => gibberish(28));
  const hue = ['#7fe0ff', '#9dffb0', '#ffc070', '#d0a0ff', '#ff8a8a'][kind % 5];
  const draw = (t: number, k: number): void => {
    g.fillStyle = '#04080b';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,140,170,0.18)';
    g.lineWidth = 1;
    for (let x = 0; x < w; x += 16) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 0; y < h; y += 16) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    g.fillStyle = hue;
    g.strokeStyle = hue;
    const m = kind % 6;
    if (m === 0) {
      // Interfering waves
      g.lineWidth = 2;
      for (let j = 0; j < 3; j++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const y = h / 2 + Math.sin(x * (0.04 + j * 0.03) + t * (2 + j) * (1 + 4 * k)) * (h * 0.15 + j * 6) * (1 + k) + Math.sin(x * 0.31 + t * 9) * 6 * k;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.globalAlpha = 1 - j * 0.3;
        g.stroke();
      }
      g.globalAlpha = 1;
    } else if (m === 1) {
      // A spectrum
      const n = 40;
      for (let i = 0; i < n; i++) {
        const v = (0.25 + 0.6 * Math.abs(Math.sin(i * 0.7 + t * 1.3) * Math.cos(i * 0.23 - t * 0.7))) * (0.6 + 0.4 * k + 0.3 * Math.random() * k);
        g.fillRect(i * (w / n) + 1, h - v * h * 0.85, w / n - 2, v * h * 0.85);
      }
    } else if (m === 2) {
      // Rolling data
      g.font = '10px monospace';
      const off = Math.floor(t * (3 + 20 * k));
      for (let i = 0; i < 13; i++) g.fillText(lines[(i + off) % lines.length], 6, 14 + i * 11);
    } else if (m === 3) {
      // A field plot: a lattice warping as it winds up
      g.lineWidth = 1;
      for (let i = -6; i <= 6; i++) {
        g.beginPath();
        for (let j = -8; j <= 8; j++) {
          const x = w / 2 + j * 14;
          const d = Math.hypot(j, i) + 0.5;
          const y = h / 2 + i * 11 + Math.sin(t * 2 + d) * (2 + 18 * k) / d;
          if (j === -8) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    } else if (m === 4) {
      // A radial scope
      g.lineWidth = 1.5;
      for (let r = 12; r < h / 2; r += 14) {
        g.beginPath();
        g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        g.globalAlpha = 0.35;
        g.stroke();
      }
      g.globalAlpha = 1;
      const a = t * (1.5 + 8 * k);
      g.beginPath();
      g.moveTo(w / 2, h / 2);
      g.lineTo(w / 2 + Math.cos(a) * h * 0.45, h / 2 + Math.sin(a) * h * 0.45);
      g.stroke();
      for (let i = 0; i < 8; i++) {
        const b = i * 1.7 + t * 0.2;
        g.fillRect(w / 2 + Math.cos(b) * (20 + i * 6) - 2, h / 2 + Math.sin(b) * (20 + i * 6) - 2, 4, 4);
      }
    } else {
      // Big readouts nobody could parse
      g.font = 'bold 22px monospace';
      g.fillText(`${GLYPHS[(Math.floor(t * 2) + kind) % GLYPHS.length]}= ${(Math.sin(t * 0.7 + kind) * 4.2 + 9 * k).toFixed(4)}`, 8, 40);
      g.font = '13px monospace';
      g.fillText(`∂Ψ/∂τ  ${(1e-7 * (1 + k * 900)).toExponential(3)}`, 8, 72);
      g.fillText(`⟨ξ|Ω⊗Ω|ξ⟩ ${(0.5 + 0.5 * Math.sin(t * 3)).toFixed(6)}`, 8, 94);
      g.fillText(`COH ${(97.2 + 2.7 * k).toFixed(2)}%   ℵ ${Math.floor(t * 17) % 999}`, 8, 116);
      g.fillText(gibberish(22), 8, 140);
    }
    // Header strip
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, 0, w, 12);
    g.fillStyle = hue;
    g.font = '9px monospace';
    g.fillText(['FLUX', 'SPECTRA', 'TELEMETRY', 'FIELD', 'LATTICE', 'STATE'][m] + ' ' + gibberish(10), 4, 9);
    if (k > 0.6 && Math.sin(t * 30) > 0.4) {
      g.fillStyle = 'rgba(255,60,40,0.25)';
      g.fillRect(0, 0, w, h);
    }
    tex.needsUpdate = true;
  };
  draw(0, 0);
  return { tex, draw };
}

/** A safety sign: black and yellow, a big headline and lines under it. */
function signTexture(title: string, lines: string[], w = 1024, h = 512, style: 'yellow' | 'red' = 'yellow'): THREE.CanvasTexture {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  g.fillStyle = style === 'yellow' ? '#f2c400' : '#c81e1e';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#111';
  g.fillRect(14, 14, w - 28, h - 28);
  g.fillStyle = style === 'yellow' ? '#f2c400' : '#fff';
  g.fillRect(24, 24, w - 48, h * 0.3);
  g.fillStyle = '#111';
  g.textAlign = 'center';
  let size = Math.round(h * 0.17);
  do {
    g.font = `bold ${size}px Arial, sans-serif`;
    size -= 2;
  } while (g.measureText(title).width > w - 80 && size > 10);
  g.fillText(title, w / 2, 24 + h * 0.15 + size * 0.36);
  g.fillStyle = style === 'yellow' ? '#f2c400' : '#fff';
  const lh = (h * 0.62) / Math.max(lines.length, 1);
  lines.forEach((l, i) => {
    let s2 = Math.round(Math.min(lh * 0.62, h * 0.11));
    do {
      g.font = `bold ${s2}px Arial, sans-serif`;
      s2 -= 2;
    } while (g.measureText(l).width > w - 90 && s2 > 8);
    g.fillText(l, w / 2, 24 + h * 0.3 + lh * (i + 0.72));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The ride-style restrictions board: who mustn't step in, each with its pictogram. */
function restrictionsTexture(): THREE.CanvasTexture {
  const W = 768;
  const H = 1024;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f1e8';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#c81e1e';
  g.fillRect(0, 0, W, 190);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = 'bold 68px Arial';
  g.fillText('WARNING', W / 2, 92);
  g.font = 'bold 30px Arial';
  g.fillText('FOR YOUR SAFETY', W / 2, 150);
  g.fillStyle = '#111';
  g.font = 'bold 30px Arial';
  g.fillText('DO NOT ENTER THE ATOM WARPER', W / 2, 250);
  g.fillText('IF YOU ARE:', W / 2, 290);
  const rows = ['PREGNANT', 'PRONE TO MOTION SICKNESS', 'UNDER 18 YEARS OF AGE', 'UNDER 48 INCHES (122 cm) TALL'];
  rows.forEach((text, i) => {
    const y = 340 + i * 150;
    // Its pictogram in a red-ringed circle, struck through
    const cx = 110;
    const cy = y + 55;
    g.fillStyle = '#111';
    g.lineCap = 'round';
    g.lineWidth = 9;
    g.strokeStyle = '#111';
    if (i === 0) {
      g.beginPath();
      g.arc(cx, cy - 30, 11, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(cx - 4, cy - 16);
      g.quadraticCurveTo(cx + 26, cy + 4, cx - 2, cy + 22);
      g.lineTo(cx - 8, cy + 22);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(cx - 4, cy + 22);
      g.lineTo(cx - 8, cy + 46);
      g.moveTo(cx + 2, cy + 22);
      g.lineTo(cx + 6, cy + 46);
      g.stroke();
    } else if (i === 1) {
      g.beginPath();
      g.arc(cx, cy - 18, 20, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 5;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.arc(cx, cy - 18, 30 + k * 8, -0.4 + k, 0.8 + k);
        g.stroke();
      }
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(cx, cy + 2);
      g.lineTo(cx, cy + 46);
      g.stroke();
    } else if (i === 2) {
      g.font = 'bold 54px Arial';
      g.fillText('18', cx, cy + 18);
    } else {
      g.fillRect(cx + 22, cy - 46, 8, 96);
      for (let k = 0; k < 6; k++) g.fillRect(cx + 14, cy - 44 + k * 18, 16, 4);
      g.beginPath();
      g.arc(cx - 12, cy - 4, 9, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(cx - 12, cy + 6);
      g.lineTo(cx - 12, cy + 30);
      g.moveTo(cx - 12, cy + 30);
      g.lineTo(cx - 20, cy + 48);
      g.moveTo(cx - 12, cy + 30);
      g.lineTo(cx - 4, cy + 48);
      g.stroke();
    }
    g.strokeStyle = '#c81e1e';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(cx, cy, 60, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 42, cy - 42);
    g.lineTo(cx + 42, cy + 42);
    g.stroke();
    g.fillStyle = '#111';
    g.textAlign = 'left';
    let s = 40;
    do {
      g.font = `bold ${s}px Arial`;
      s -= 2;
    } while (g.measureText(text).width > W - 230);
    g.fillText(text, 200, cy + 14);
    g.textAlign = 'center';
  });
  g.fillStyle = '#555';
  g.font = '20px Arial';
  g.fillText('KEEP ARMS AND LEGS INSIDE THE FIELD AT ALL TIMES', W / 2, H - 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The pad's face: rings, a lattice, hazard edge. Mostly emissive. */
function padTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  g.fillStyle = '#060a0e';
  g.fillRect(0, 0, S, S);
  const cx = S / 2;
  for (let r = 30; r < S / 2 - 30; r += 26) {
    g.strokeStyle = `rgba(140,220,255,${0.4 + 0.5 * (r / (S / 2))})`;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cx, r, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.strokeStyle = 'rgba(140,220,255,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 30, cx + Math.sin(a) * 30);
    g.lineTo(cx + Math.cos(a) * (S / 2 - 34), cx + Math.sin(a) * (S / 2 - 34));
    g.stroke();
  }
  for (let i = 0; i < 48; i++) {
    const a0 = (i / 48) * Math.PI * 2;
    g.strokeStyle = i % 2 ? '#f2c400' : '#111';
    g.lineWidth = 22;
    g.beginPath();
    g.arc(cx, cx, S / 2 - 14, a0, a0 + (Math.PI * 2) / 48);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ================================================================ builder

export class Level15Builder {
  private group = new THREE.Group();
  /** Everything that doesn't move: folded into one mesh per material at the end. */
  private props = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private cables = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private screens: ScreenSurface[] = [];
  private needles: Level15Data['needles'] = [];
  private leds: THREE.Texture[] = [];
  private reels: THREE.Object3D[] = [];
  private beacons: THREE.Object3D[] = [];
  private kprops: KnockProp[] = [];
  private sparkPoints: THREE.Vector3[] = [];
  private M = {
    floor: new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.35 }),
    wall: new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.25, color: 0xb8c4cc }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8e979e, roughness: 0.35, metalness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.45, metalness: 0.7 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.6, metalness: 0.3 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x3c464d, roughness: 0.5, metalness: 0.5 }),
    beige: new THREE.MeshStandardMaterial({ color: 0xb9b19a, roughness: 0.6, metalness: 0.15 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb06a3a, roughness: 0.35, metalness: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.85 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xd4561a, roughness: 0.6 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xd8b21c, roughness: 0.55 }),
    red: new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff2414, emissiveIntensity: 2 }),
    green: new THREE.MeshStandardMaterial({ color: 0x002a08, emissive: 0x32ff60, emissiveIntensity: 1.8 }),
    amber: new THREE.MeshStandardMaterial({ color: 0x2a1600, emissive: 0xffa020, emissiveIntensity: 1.8 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x001a2a, emissive: 0x40b8ff, emissiveIntensity: 1.8 }),
    white: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f4ff, emissiveIntensity: 2 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fd0e0, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.22, depthWrite: false }),
    gauge: new THREE.MeshStandardMaterial({ color: 0xece6d2, roughness: 0.5, emissive: 0x2a2820, emissiveIntensity: 0.6 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xece9e0, roughness: 0.9, side: THREE.DoubleSide })
  };
  private pylonGlow = new THREE.MeshStandardMaterial({ color: 0x0a1a24, emissive: 0x58c8ff, emissiveIntensity: 0.6, roughness: 0.3 });
  private cableGlow = new THREE.MeshStandardMaterial({ color: 0x08141c, emissive: 0x3aa8ff, emissiveIntensity: 0.4, roughness: 0.4 });
  private suitMats: THREE.MeshStandardMaterial[] = [];

  build(): Level15Data {
    const M = this.M;
    const ft = floorTexture();
    M.floor.map = ft;
    const wt = wallTexture();
    wt.repeat.set(24, 2);
    M.wall.map = wt;
    this.group.add(this.props);

    this.buildRoom();
    const entry = this.buildEntry();
    const dais = this.buildDais();
    this.buildPylons();
    const emitter = this.buildEmitter();
    const rings = this.buildRings();
    const podium = this.buildPodium();
    this.buildSigns();
    this.buildConsoles();
    this.buildInstruments();
    this.buildRacks();
    this.buildGallery();
    this.buildCables();
    const suit = this.buildSuitAlcove();
    const lights = this.buildLights();
    this.flushCables();

    this.shootables = mergeStatic(this.group, [this.props], this.shootables);

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      glassPanes: [],
      start: { pos: V(0, 0, 27.0), yaw: 0 },
      rubble: entry,
      suit,
      suitMats: this.suitMats,
      podium,
      rings,
      pylonGlow: this.pylonGlow,
      cableGlow: this.cableGlow,
      padMat: dais.padMat,
      beam: dais.beam,
      emitter,
      screens: this.screens,
      needles: this.needles,
      leds: this.leds,
      chart: this.chartTex!,
      reels: this.reels,
      beacons: this.beacons,
      props: this.kprops,
      sparkPoints: this.sparkPoints,
      lights,
      lamps: M.white
    };
  }

  // ------------------------------------------------------------- helpers

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.props): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, parent: THREE.Object3D = this.props): THREE.Mesh {
    return this.mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
  }

  private cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, mat: THREE.Material, seg = 16, parent: THREE.Object3D = this.props): THREE.Mesh {
    return this.mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, parent);
  }

  private collide(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider {
    const c: Collider = { box: new THREE.Box3(V(x0, y0, z0), V(x1, y1, z1)) };
    this.colliders.push(c);
    return c;
  }

  /** A disc of floor raised to `top`: an axis-aligned stack of slices (the player's boxes can't be round). */
  private discCollider(r: number, top: number, slice = 0.4): void {
    for (let z = -r; z < r; z += slice) {
      const zm = Math.min(Math.abs(z), Math.abs(z + slice));
      const hx = Math.sqrt(Math.max(0, r * r - zm * zm));
      this.collide(-hx, -0.5, z, hx, top, z + slice);
    }
  }

  /** A run of small boxes along a line, for things that aren't square to the axes. */
  private lineCollider(a: THREE.Vector3, b: THREE.Vector3, half: number, y0: number, y1: number, step = 0.45): void {
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      this.collide(p.x - half, y0, p.z - half, p.x + half, y1, p.z + half);
    }
  }

  /** Something placed round the room: at angle `a`, radius `r`, turned to face the middle. */
  private place(o: THREE.Object3D, a: number, r: number, y = 0): THREE.Object3D {
    o.position.copy(polar(a, r, y));
    o.rotation.y = a + Math.PI;
    return o;
  }

  /** A cable: a tube along the points, to be merged with all the others of its material. */
  private cable(pts: THREE.Vector3[], r: number, mat: THREE.Material, seg = 24): void {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const g = new THREE.TubeGeometry(curve, seg, r, 6, false);
    let list = this.cables.get(mat);
    if (!list) this.cables.set(mat, (list = []));
    list.push(g);
  }

  private flushCables(): void {
    for (const [mat, list] of this.cables) {
      for (const g of list) this.props.add(new THREE.Mesh(g, mat));
    }
    this.cables.clear();
  }

  // ------------------------------------------------------------- the hall

  private buildRoom(): void {
    const M = this.M;
    const { r, h, dome } = ROOM;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(r + 0.5, 96), M.floor);
    floor.rotation.x = -Math.PI / 2;
    this.props.add(floor);
    this.shootables.push(floor);
    this.collide(-r - 2, -1, -r - 2, r + 2, 0, r + 2);
    // The wall: open cylinder seen from inside, and a heavy skirting round its foot
    M.wall.side = THREE.DoubleSide;
    const gapA = Math.asin((ENTRY.x1 + 0.3) / r);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 96, 1, true, gapA, Math.PI * 2 - gapA * 2), M.wall);
    wall.position.y = h / 2;
    this.props.add(wall);
    const over = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h - ENTRY.h, 6, 1, true, -gapA, gapA * 2), M.wall);
    over.position.y = ENTRY.h + (h - ENTRY.h) / 2;
    this.props.add(over);
    const skirtMat = M.dark.clone();
    skirtMat.side = THREE.DoubleSide;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.08, r - 0.08, 0.5, 96, 1, true, gapA, Math.PI * 2 - gapA * 2), skirtMat);
    skirt.position.y = 0.25;
    this.props.add(skirt);
    // Ribs up the wall every 15°, a band at the gallery, another under the dome
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      if (Math.abs(Math.sin(a / 2)) < 0.08) continue; // not across the way in
      const rib = this.place(new THREE.Mesh(new THREE.BoxGeometry(0.7, h, 0.5), M.dark), a, r - 0.25, h / 2);
      this.props.add(rib);
    }
    for (const y of [7.0, h - 0.5]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.3, r - 0.3, 0.8, 96, 1, true), skirtMat);
      band.position.y = y;
      this.props.add(band);
    }
    // The dome: a shallow half-sphere, its meridian ribs meeting at a hub over the machine
    const domeGeo = new THREE.SphereGeometry(r, 64, 20, 0, Math.PI * 2, 0, Math.PI / 2);
    domeGeo.scale(1, dome / r, 1);
    const domeMat = new THREE.MeshStandardMaterial({ color: 0x3a444b, roughness: 0.7, metalness: 0.2, side: THREE.BackSide });
    const dm = new THREE.Mesh(domeGeo, domeMat);
    dm.position.y = h;
    this.props.add(dm);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 12; k++) {
        const th = (k / 12) * (Math.PI / 2);
        const rr = Math.cos(th) * (r - 0.4);
        pts.push(V(Math.sin(a) * rr, h + Math.sin(th) * (dome - 0.4), Math.cos(a) * rr));
      }
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.22, 6, false);
      this.props.add(new THREE.Mesh(g, M.dark));
    }
    // Rings of lamps round the dome
    for (const [rr, y, n] of [[21, h + 6.8, 24], [13, h + 10.2, 16]] as const) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const p = polar(a, rr, y);
        this.box(0.9, 0.12, 0.35, p.x, p.y, p.z, M.dark).rotation.y = a;
        this.box(0.8, 0.04, 0.25, p.x, p.y - 0.07, p.z, M.white).rotation.y = a;
      }
    }
    // Wall colliders: small boxes round the circle
    for (let i = 0; i < 220; i++) {
      const a = (i / 220) * Math.PI * 2;
      const p = polar(a, r + 0.2);
      if (Math.abs(p.x) < ENTRY.x1 && p.z > 0) continue;
      this.collide(p.x - 0.45, 0, p.z - 0.45, p.x + 0.45, h, p.z + 0.45);
    }
  }

  /** The service passage he comes in by, and the far end of it that's just come down. */
  private buildEntry(): Level15Data['rubble'] {
    const M = this.M;
    const { x0, x1, z0, z1, h } = ENTRY;
    // Walls, ceiling, a frame where it meets the hall
    this.box(0.3, h, z1 - z0, x0 - 0.15, h / 2, (z0 + z1) / 2, M.wall);
    this.box(0.3, h, z1 - z0, x1 + 0.15, h / 2, (z0 + z1) / 2, M.wall);
    this.box(x1 - x0 + 0.6, 0.3, z1 - z0, 0, h + 0.15, (z0 + z1) / 2, M.dark);
    this.collide(x0 - 0.6, 0, z0, x0, h, z1 + 1);
    this.collide(x1, 0, z0, x1 + 0.6, h, z1 + 1);
    this.box(x1 - x0 + 1.2, 0.5, 0.6, 0, h + 0.25, z0, M.dark);
    for (const s of [-1, 1]) this.box(0.4, h, 0.6, s * (x1 + 0.2), h / 2, z0, M.dark);
    // A strip lamp down the middle of its ceiling, a conduit, a fire extinguisher on its wall
    this.box(0.12, 0.05, 2.4, 0, h - 0.03, (z0 + z1) / 2, M.white);
    this.cyl(0.05, 0.05, z1 - z0, x1 - 0.15, h - 0.3, (z0 + z1) / 2, M.steel, 8).rotation.x = Math.PI / 2;
    this.cyl(0.09, 0.09, 0.5, x0 + 0.12, 0.95, z0 + 2.2, M.red, 12);
    // The fire door he came through, torn off and flat on the floor
    const door = this.box(1.3, 0.08, 2.3, 0.2, 0.04, z1 - 1.6, new THREE.MeshStandardMaterial({ color: 0x7a2a22, roughness: 0.55, metalness: 0.3 }));
    door.rotation.set(0.05, 0.25, 0.04);
    // The back of the passage: the ceiling and walls fallen in, a heap of slabs and lumps
    const pieces: Level15Data['rubble']['pieces'] = [];
    const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x6b6f6c, roughness: 0.95 });
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x4d5250, roughness: 0.9 });
    for (let i = 0; i < 26; i++) {
      const big = i < 6;
      const s = big ? 0.6 + Math.random() * 0.5 : 0.15 + Math.random() * 0.35;
      const geo = big ? new THREE.BoxGeometry(s * 2.2, s * 0.5, s * 1.6) : new THREE.DodecahedronGeometry(s, 0);
      const m = new THREE.Mesh(geo, big ? slabMat : rubbleMat);
      const to = V(x0 + 0.3 + Math.random() * (x1 - x0 - 0.6), big ? s * 0.25 + Math.random() * 1.6 : s * 0.6 + Math.random() * 1.9, z1 - 0.2 - Math.random() * 1.6);
      to.y = Math.min(to.y, h - 0.2);
      const from = to.clone().setY(h + 0.4);
      m.position.copy(from);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.group.add(m);
      pieces.push({ mesh: m, to, from, delay: Math.random() * 0.5 + (big ? 0 : 0.15), spin: V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3) });
    }
    // Rebar and a bent duct poking out of it
    for (let i = 0; i < 6; i++) {
      const rb = this.cyl(0.015, 0.015, 1.4 + Math.random(), x0 + 0.4 + Math.random() * 2.6, 1.2 + Math.random(), z1 - 0.6 - Math.random() * 0.8, M.copper, 5);
      rb.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
    }
    this.collide(x0, 0, z1 - 2.1, x1, h, z1 + 0.5);
    return { pieces, at: V(0, 1.2, z1 - 1.2) };
  }

  // ------------------------------------------------------------- the Atom Warper

  private chartTex: THREE.Texture | null = null;

  private buildDais(): { padMat: THREE.MeshStandardMaterial; beam: THREE.Mesh } {
    const M = this.M;
    const deck = new THREE.MeshStandardMaterial({ color: 0x3a4248, roughness: 0.3, metalness: 0.75 });
    for (const [r, top] of DAIS.steps) {
      this.cyl(r, r, 0.25, 0, top - 0.125, 0, deck, 96);
      // A nosing of yellow round each step's edge, and a lit strip under it
      const nose = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 96), M.yellow);
      nose.rotation.x = Math.PI / 2;
      nose.position.y = top - 0.02;
      this.props.add(nose);
      const glow = new THREE.Mesh(new THREE.TorusGeometry(r + 0.01, 0.018, 4, 96), this.cableGlow);
      glow.rotation.x = Math.PI / 2;
      glow.position.y = top - 0.18;
      this.props.add(glow);
      this.discCollider(r, top);
    }
    // Grates set in the top, radially
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const p = polar(a, 3.6, DAIS.top + 0.004);
      const grate = this.box(0.5, 0.01, 1.2, p.x, p.y, p.z, M.black);
      grate.rotation.y = a;
    }
    // The pad: a disc set into the deck, glowing rings, a raised collar round it
    const padMat = new THREE.MeshStandardMaterial({ color: 0x0a1218, emissive: 0xffffff, emissiveMap: padTexture(), emissiveIntensity: 0.5, roughness: 0.25, metalness: 0.4 });
    const pad = new THREE.Mesh(new THREE.CircleGeometry(PAD.r, 64), padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = DAIS.top + 0.012;
    this.group.add(pad);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(PAD.r + 0.06, 0.06, 10, 64), M.steel);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = DAIS.top + 0.03;
    this.props.add(collar);
    // The beam: a column of light from the emitter down to the pad, dark until the warp
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xcfeeff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, PAD.r, 11, 32, 1, true), beamMat);
    beam.position.y = DAIS.top + 5.5;
    beam.renderOrder = 8;
    this.group.add(beam);
    // Railing round the top's edge, open at the front where the steps come up
    const railR = DAIS.steps[2][0] - 0.2;
    const gap = 0.32;
    for (let i = 0; i < 64; i++) {
      const a0 = (i / 64) * Math.PI * 2;
      const a1 = ((i + 1) / 64) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      if (Math.abs(Math.atan2(Math.sin(am), Math.cos(am))) < gap) continue;
      const p0 = polar(a0, railR, DAIS.top);
      const p1 = polar(a1, railR, DAIS.top);
      const len = p0.distanceTo(p1);
      for (const y of [0.55, 1.05]) {
        const rail = this.cyl(0.025, 0.025, len, (p0.x + p1.x) / 2, DAIS.top + y, (p0.z + p1.z) / 2, M.steel, 6);
        rail.lookAt(p1.x, DAIS.top + y, p1.z);
        rail.rotateX(Math.PI / 2);
      }
      if (i % 2 === 0) this.cyl(0.03, 0.03, 1.05, p0.x, DAIS.top + 0.525, p0.z, M.steel, 6);
      this.lineCollider(p0, p1, 0.08, DAIS.top, DAIS.top + 1.1, 0.4);
    }
    return { padMat, beam };
  }

  private buildPylons(): void {
    const M = this.M;
    const base = DAIS.top;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const p = polar(a, PYLON.r);
      const g = new THREE.Group();
      g.position.set(p.x, base, p.z);
      g.rotation.y = a;
      this.props.add(g);
      // A plinth, the tower, coil stacks, insulators, a capacitor bank on its back
      this.box(1.3, 0.5, 1.3, 0, 0.25, 0, M.dark, g);
      this.box(1.36, 0.06, 1.36, 0, 0.5, 0, M.yellow, g);
      this.box(0.7, PYLON.h, 0.7, 0, PYLON.h / 2, 0, M.panel, g);
      for (const s of [-1, 1]) this.box(0.08, PYLON.h, 0.08, s * 0.36, PYLON.h / 2, 0.36, M.steel, g);
      for (let k = 0; k < 9; k++) {
        const y = 1.1 + k * 0.82;
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.12, 10, 28), k % 3 === 1 ? this.pylonGlow : M.copper);
        coil.rotation.x = Math.PI / 2;
        coil.position.y = y;
        g.add(coil);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 28), M.beige);
        disc.position.y = y + 0.38;
        g.add(disc);
      }
      // Its glowing slot facing the pad
      this.box(0.12, PYLON.h - 1.2, 0.04, 0, PYLON.h / 2 + 0.3, -0.37, this.pylonGlow, g);
      // Capacitors on its outer face
      for (let k = 0; k < 4; k++) {
        this.cyl(0.14, 0.14, 0.6, -0.18 + (k % 2) * 0.36, 1.0 + Math.floor(k / 2) * 0.75, 0.55, M.steel, 12, g);
        this.cyl(0.05, 0.05, 0.08, -0.18 + (k % 2) * 0.36, 1.34 + Math.floor(k / 2) * 0.75, 0.55, M.red, 8, g);
      }
      // A beacon on its plinth, to spin in the warp
      const bc = new THREE.Group();
      bc.position.set(0.5, 0.6, -0.5);
      g.add(bc);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.amber);
      bc.add(dome);
      // The beacon's rotating reflector: a little vane inside it
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.01), M.white);
      vane.position.y = 0.04;
      bc.add(vane);
      this.group.attach(bc);
      this.beacons.push(vane);
      const top = polar(a, PYLON.r, base + PYLON.h);
      this.sparkPoints.push(top.clone().add(V(0, -0.3, 0)), polar(a, PYLON.r - 0.5, base + 3));
      this.collide(p.x - 0.68, 0, p.z - 0.68, p.x + 0.68, base + PYLON.h, p.z + 0.68);
    }
    // The hoop across their tops
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(PYLON.r, 0.38, 16, 96), M.dark);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = RING_Y;
    this.props.add(hoop);
    const hoopGlow = new THREE.Mesh(new THREE.TorusGeometry(PYLON.r - 0.36, 0.08, 8, 96), this.pylonGlow);
    hoopGlow.rotation.x = Math.PI / 2;
    hoopGlow.position.y = RING_Y;
    this.props.add(hoopGlow);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const p = polar(a, PYLON.r, RING_Y);
      const clamp = this.box(0.25, 0.9, 0.9, p.x, p.y, p.z, M.steel);
      clamp.rotation.y = a;
    }
  }

  /** The emitter hanging from the dome over the pad: a stack of drums, coils, a lens pointing down. */
  private buildEmitter(): THREE.Group {
    const M = this.M;
    const g = new THREE.Group();
    g.position.set(0, ROOM.h + ROOM.dome - 0.5, 0);
    this.group.add(g);
    const parts: [number, number, number, number, THREE.Material][] = [
      [1.6, 1.6, 1.2, -0.6, M.dark],
      [2.4, 2.2, 0.8, -1.6, M.panel],
      [1.8, 1.4, 2.2, -3.1, M.dark],
      [1.2, 0.9, 1.6, -5.0, M.steel],
      [0.9, 0.5, 1.0, -6.3, M.dark]
    ];
    for (const [rt, rb, h, y, m] of parts) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 32), m);
      c.position.y = y;
      g.add(c);
    }
    for (let k = 0; k < 6; k++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(1.55 - k * 0.08, 0.1, 8, 32), k % 2 ? this.pylonGlow : M.copper);
      coil.rotation.x = Math.PI / 2;
      coil.position.y = -2.2 - k * 0.32;
      g.add(coil);
    }
    // Fins round the middle drum
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.8, 0.9), M.steel);
      fin.position.set(Math.sin(a) * 2.0, -3.1, Math.cos(a) * 2.0);
      fin.rotation.y = a;
      g.add(fin);
    }
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.45, 32), this.pylonGlow);
    lens.rotation.x = Math.PI / 2;
    lens.position.y = -6.81;
    g.add(lens);
    // Its spinning collar (the scene turns it in the warp)
    const collar = new THREE.Group();
    collar.position.y = -4.3;
    g.add(collar);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.2), M.steel);
      arm.position.set(Math.sin(a) * 1.4, 0, Math.cos(a) * 1.4);
      arm.rotation.y = a;
      collar.add(arm);
      const node = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), this.pylonGlow);
      node.position.set(Math.sin(a) * 2.0, 0, Math.cos(a) * 2.0);
      collar.add(node);
    }
    collar.name = 'collar';
    this.sparkPoints.push(V(0, g.position.y - 6.5, 0), V(1.5, g.position.y - 4.3, 0));
    return g;
  }

  /** Three gimbal rings round the pad, tilted, still until the warp. */
  private buildRings(): THREE.Group[] {
    const M = this.M;
    const out: THREE.Group[] = [];
    [2.7, 2.35, 2.0].forEach((r, i) => {
      const g = new THREE.Group();
      g.position.set(0, DAIS.top + 2.2, 0);
      this.group.add(g);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07 + i * 0.01, 10, 96), M.steel);
      g.add(ring);
      const inner = new THREE.Mesh(new THREE.TorusGeometry(r - 0.09, 0.025, 6, 96), this.pylonGlow);
      g.add(inner);
      // Nodes round it
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const n = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.22), M.dark);
        n.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
        n.rotation.z = a;
        g.add(n);
      }
      g.rotation.set([0.4, 1.2, -0.7][i], [0, 0.9, 1.8][i], [0.2, -0.3, 0.6][i]);
      out.push(g);
    });
    // The outermost ring's pivots: arms out to two of the pylons
    for (const s of [-1, 1]) {
      const arm = this.box(PYLON.r - 3.1, 0.12, 0.12, s * (2.75 + (PYLON.r - 3.1) / 2), DAIS.top + 2.2, 0, M.dark);
      arm.rotation.y = 0;
    }
    return out;
  }

  /** The pedestal on the pad: a column, a sloped desk with three guarded buttons, a small screen. */
  private buildPodium(): Level15Data['podium'] {
    const M = this.M;
    const g = new THREE.Group();
    g.position.copy(PODIUM);
    this.group.add(g);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.2, 20), M.dark);
    body.position.y = 0.6;
    g.add(body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 8, 24), this.pylonGlow);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    const desk = new THREE.Group();
    desk.position.set(0, 1.25, 0.12);
    desk.rotation.x = 0.55;
    g.add(desk);
    desk.add(new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 0.5), M.panel));
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.01, 0.44), M.black);
    face.position.y = 0.045;
    desk.add(face);
    const screen = screenSurface(5, 256, 128);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.17), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }));
    scr.rotation.x = -Math.PI / 2;
    scr.position.set(0, 0.052, -0.13);
    desk.add(scr);
    const buttons: Level15Data['podium']['buttons'] = [];
    const labelC = makeCanvas(256, 64);
    const lg = labelC.getContext('2d')!;
    lg.fillStyle = '#111';
    lg.fillRect(0, 0, 256, 64);
    lg.fillStyle = '#e8e8e8';
    lg.font = 'bold 34px Arial';
    lg.textAlign = 'center';
    ['I', 'II', 'III'].forEach((s, i) => lg.fillText(s, 42 + i * 86, 46));
    const lt = new THREE.CanvasTexture(labelC);
    lt.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.07), new THREE.MeshBasicMaterial({ map: lt }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, 0.052, 0.19);
    desk.add(label);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.24;
      const z = 0.06;
      // A guard ring, the cap (mushroom), its lit rim
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.015, 6, 20), M.yellow);
      guard.rotation.x = Math.PI / 2;
      guard.position.set(x, 0.065, z);
      desk.add(guard);
      const mat = new THREE.MeshStandardMaterial({ color: [0x7a1010, 0x7a5a10, 0x107a2a][i], emissive: [0xff3020, 0xffb020, 0x30ff60][i], emissiveIntensity: 0.15, roughness: 0.3 });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.045, 20), mat);
      cap.position.set(x, 0.075, z);
      desk.add(cap);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), M.steel);
      stem.position.set(x, 0.05, z);
      desk.add(stem);
      g.updateMatrixWorld(true);
      buttons.push({ cap, mat, at: cap.getWorldPosition(new THREE.Vector3()), rest: 0.075 });
    }
    this.collide(PODIUM.x - 0.35, 0, PODIUM.z - 0.35, PODIUM.x + 0.35, DAIS.top + 1.35, PODIUM.z + 0.3);
    this.screens.push(screen);
    return { buttons, screen, front: V(PODIUM.x, DAIS.top, PODIUM.z + 0.68) };
  }

  // ------------------------------------------------------------- signs

  private buildSigns(): void {
    const M = this.M;
    // An arch over the way up the steps: two posts and the board between them
    const z = DAIS.steps[0][0] + 0.9;
    for (const s of [-1, 1]) {
      this.box(0.18, 3.2, 0.18, s * 1.9, 1.6, z, M.dark);
      this.box(0.3, 0.12, 0.3, s * 1.9, 0.06, z, M.yellow);
      this.collide(s * 1.9 - 0.12, 0, z - 0.12, s * 1.9 + 0.12, 3.2, z + 0.12);
    }
    const archTex = signTexture('CAREFUL', ['AS YOU STEP INTO THE ATOM WARPER'], 1024, 256);
    const arch = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.9), new THREE.MeshStandardMaterial({ map: archTex, emissiveMap: archTex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5 }));
    arch.position.set(0, 2.85, z + 0.02);
    this.props.add(arch);
    this.box(3.9, 1.0, 0.06, 0, 2.85, z - 0.03, M.dark);
    // Lamps either side of the board, lit amber
    for (const s of [-1, 1]) this.box(0.14, 0.14, 0.14, s * 1.9, 3.32, z, M.amber);
    // The restrictions board on its own post by the steps, and the height check by the other side
    const rt = restrictionsTexture();
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.53), new THREE.MeshStandardMaterial({ map: rt, emissiveMap: rt, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.55 }));
    board.position.set(-3.1, 1.55, z + 0.4);
    board.rotation.y = 0.35;
    this.props.add(board);
    const back = this.box(1.25, 1.63, 0.05, -3.1, 1.55, z + 0.37, M.dark);
    back.rotation.y = 0.35;
    this.box(0.1, 0.8, 0.1, -3.1 - Math.sin(0.35) * 0.05, 0.4, z + 0.35, M.dark);
    this.collide(-3.75, 0, z + 0.1, -2.45, 2.4, z + 0.65);
    // "You must be this tall": a post with a ruler and a cut-out hand held out at 48 inches
    const hx = 3.0;
    const hz = z + 0.5;
    this.box(0.12, 2.1, 0.12, hx, 1.05, hz, M.yellow);
    for (let k = 0; k <= 20; k++) this.box(k % 5 === 0 ? 0.1 : 0.06, 0.012, 0.02, hx - 0.07, 0.2 + k * 0.08, hz + 0.06, M.black);
    const hand = this.box(0.42, 0.06, 0.16, hx - 0.25, 1.22, hz, M.yellow);
    hand.rotation.z = 0.05;
    const tallC = makeCanvas(512, 160);
    const tg = tallC.getContext('2d')!;
    tg.fillStyle = '#f2c400';
    tg.fillRect(0, 0, 512, 160);
    tg.fillStyle = '#111';
    tg.textAlign = 'center';
    tg.font = 'bold 44px Arial';
    tg.fillText('YOU MUST BE', 256, 62);
    tg.fillText('THIS TALL ↓  48"', 256, 120);
    const tt = new THREE.CanvasTexture(tallC);
    tt.colorSpace = THREE.SRGBColorSpace;
    const tallSign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.22), new THREE.MeshStandardMaterial({ map: tt, emissiveMap: tt, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6 }));
    tallSign.position.set(hx - 0.25, 1.52, hz + 0.07);
    this.props.add(tallSign);
    this.collide(hx - 0.12, 0, hz - 0.12, hx + 0.12, 2.1, hz + 0.12);
    // Plates on the dais's front and round the room
    const plate = (title: string, lines: string[], w: number, h: number, x: number, y: number, zz: number, ry: number, style: 'yellow' | 'red' = 'yellow'): void => {
      const st = signTexture(title, lines, 1024, Math.round((1024 * h) / w), style);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: st, emissiveMap: st, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5 }));
      m.position.set(x, y, zz);
      m.rotation.y = ry;
      this.props.add(m);
    };
    plate('ATOM WARPER AW-1', ['PRIMARY FIELD ASSEMBLY'], 2.4, 0.6, 0, 0.13, DAIS.steps[0][0] + 0.01, 0);
    plate('DANGER', ['HIGH FIELD AREA', 'AUTHORIZED PERSONNEL ONLY'], 1.6, 0.9, polar(0.7, ROOM.r - 0.6).x, 2.4, polar(0.7, ROOM.r - 0.6).z, 0.7 + Math.PI);
    plate('PROTECTIVE SUIT', ['MUST BE WORN ON THE PAD'], 1.6, 0.8, polar(-0.6, ROOM.r - 0.6).x, 2.4, polar(-0.6, ROOM.r - 0.6).z, -0.6 + Math.PI);
    plate('NO OPEN FLAMES', ['NO MAGNETIC MEDIA', 'BEYOND THIS POINT'], 1.4, 0.8, polar(2.3, ROOM.r - 0.6).x, 2.4, polar(2.3, ROOM.r - 0.6).z, 2.3 + Math.PI);
    plate('EMERGENCY STOP', ['DISENGAGED'], 1.2, 0.6, polar(-2.5, ROOM.r - 0.6).x, 2.1, polar(-2.5, ROOM.r - 0.6).z, -2.5 + Math.PI, 'red');
  }

  // ------------------------------------------------------------- consoles

  /**
   * The control banks: five curved runs of desk facing the machine, each
   * made of straight sections crammed with switches, knobs, faders, rows of
   * lamps, patch bays, analog meters and screens; a sloped upper panel of
   * more. Coffee cups, papers, binders and clipboards on them, chairs at
   * them: things the warp will knock over.
   */
  private buildConsoles(): void {
    const banks = [-0.95, 0.95, 2.0, -2.0, Math.PI];
    banks.forEach((a, bi) => {
      for (let s = -1; s <= 1; s++) this.consoleSection(a + s * 0.14, 14.2, bi * 3 + s + 1);
      // Two chairs at each bank, pushed back
      for (const s of [-0.12, 0.12]) this.chair(polar(a + s, 15.35), a + s + (Math.random() - 0.5) * 0.7);
    });
  }

  private consoleSection(a: number, r: number, seed: number): void {
    const M = this.M;
    const g = new THREE.Group();
    this.place(g, a, r);
    this.props.add(g);
    const W = 1.95;
    // Body, kick plate, desk top, the sloped upper panel and its hood
    this.box(W, 0.85, 0.75, 0, 0.425, 0.05, M.panel, g);
    this.box(W, 0.1, 0.7, 0, 0.05, 0.02, M.black, g);
    this.box(W + 0.02, 0.05, 0.85, 0, 0.88, -0.02, M.dark, g);
    const upper = new THREE.Group();
    upper.position.set(0, 0.9, 0.36);
    upper.rotation.x = -0.45;
    g.add(upper);
    this.box(W, 0.9, 0.1, 0, 0.45, 0, M.panel, upper);
    this.box(W, 0.06, 0.25, 0, 0.92, -0.08, M.dark, upper);
    // The desk's surface: a dense field of controls (as small boxes and cylinders, merged)
    const rnd = (): number => Math.random();
    for (let i = 0; i < 16; i++) {
      const x = -W / 2 + 0.08 + (i / 15) * (W - 0.16);
      // A row of toggle switches with guards
      this.box(0.012, 0.03, 0.012, x, 0.92, -0.32, M.steel, g).rotation.x = rnd() < 0.5 ? 0.5 : -0.5;
      this.box(0.03, 0.006, 0.03, x, 0.907, -0.32, M.black, g);
      // Lamps
      this.box(0.022, 0.012, 0.022, x, 0.911, -0.24, [M.red, M.green, M.amber, M.blue, M.black, M.black][Math.floor(rnd() * 6)], g);
      // Knobs
      if (i % 2 === 0) this.cyl(0.022, 0.026, 0.03, x, 0.92, -0.14, M.black, 10, g);
      // Faders
      if (i % 3 === 0) {
        this.box(0.012, 0.004, 0.14, x, 0.906, 0.02, M.black, g);
        this.box(0.03, 0.02, 0.02, x, 0.915, -0.03 + rnd() * 0.1, M.beige, g);
      }
    }
    // Keyboard and a trackball
    this.box(0.55, 0.025, 0.18, -0.3, 0.915, -0.36, M.dark, g);
    for (let k = 0; k < 4; k++) this.box(0.5, 0.004, 0.025, -0.3, 0.93, -0.425 + k * 0.04, M.beige, g);
    this.cyl(0.04, 0.05, 0.03, 0.2, 0.915, -0.38, M.dark, 12, g);
    this.mesh(new THREE.SphereGeometry(0.03, 10, 8), M.red, 0.2, 0.935, -0.38, g);
    // The upper panel: two screens, analog meters, a patch bay with cords, rows of lamps
    const scA = screenSurface(seed, 256, 160);
    const scB = screenSurface(seed + 2, 256, 160);
    this.screens.push(scA, scB);
    for (const [sc, x] of [[scA, -0.5], [scB, 0.5]] as const) {
      this.box(0.62, 0.42, 0.04, x, 0.5, -0.06, M.black, upper);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.36), new THREE.MeshBasicMaterial({ map: sc.tex, toneMapped: false }));
      face.position.set(x, 0.5, -0.081);
      face.rotation.y = Math.PI;
      upper.add(face);
    }
    // Meters: a cream dial, a needle the scene wobbles
    for (const x of [-0.12, 0.12]) {
      this.cyl(0.085, 0.085, 0.03, x, 0.62, -0.06, M.dark, 20, upper).rotation.x = Math.PI / 2;
      const dial = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), M.gauge);
      dial.position.set(x, 0.62, -0.077);
      dial.rotation.y = Math.PI;
      upper.add(dial);
      // The needle lives in the room, not the console (the console gets merged): placed in the dial's frame
      const needle = new THREE.Group();
      const n = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.065, 0.002), M.red);
      n.position.y = 0.03;
      needle.add(n);
      g.updateMatrixWorld(true);
      needle.position.copy(V(x, 0.6, -0.085).applyMatrix4(upper.matrixWorld));
      needle.quaternion.copy(upper.getWorldQuaternion(new THREE.Quaternion()));
      this.group.add(needle);
      this.needles.push({ obj: needle, base: 0, amp: 0.4 + Math.random() * 0.5, rate: 0.5 + Math.random() * 2, ph: Math.random() * 6 });
    }
    // Patch bay: jacks in rows, cords looped between them
    for (let row = 0; row < 3; row++)
      for (let k = 0; k < 10; k++) this.cyl(0.008, 0.008, 0.01, -0.3 + k * 0.066, 0.2 + row * 0.06, -0.06, M.black, 6, upper).rotation.x = Math.PI / 2;
    for (let k = 0; k < 5; k++) {
      const x0 = -0.3 + Math.floor(Math.random() * 10) * 0.066;
      const x1 = -0.3 + Math.floor(Math.random() * 10) * 0.066;
      const y0 = 0.2 + Math.floor(Math.random() * 3) * 0.06;
      const y1 = 0.2 + Math.floor(Math.random() * 3) * 0.06;
      const pts = [V(x0, y0, -0.07), V((x0 + x1) / 2, Math.min(y0, y1) - 0.12, -0.12), V(x1, y1, -0.07)];
      const curve = new THREE.CatmullRomCurve3(pts);
      upper.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.005, 4, false), [M.red, M.yellow, M.blue, M.orange, M.green][k]));
    }
    // A strip of lamps across the hood
    for (let k = 0; k < 24; k++) this.box(0.03, 0.02, 0.01, -0.9 + k * 0.078, 0.86, -0.065, [M.green, M.amber, M.black, M.red][(k * 7 + seed) % 4], upper);
    // Collision: along its front edge
    g.updateMatrixWorld(true);
    const a0 = g.localToWorld(V(-W / 2, 0, 0));
    const a1 = g.localToWorld(V(W / 2, 0, 0));
    this.lineCollider(a0, a1, 0.38, 0, 0.92, 0.35);
    // What's on the desk, loose: a cup or two, papers, a clipboard, a binder
    const top = 0.905;
    const loose = (o: THREE.Object3D, lx: number, lz: number, half: THREE.Vector3, mass: number, kind: KnockProp['kind'], ry = 0): void => {
      const w = g.localToWorld(V(lx, top + half.y, lz));
      o.position.copy(w);
      o.rotation.y = g.rotation.y + ry;
      this.group.add(o);
      this.kprops.push({ mesh: o, half, mass, kind });
    };
    if (seed % 2 === 0) loose(this.cup(), 0.6, 0.2, V(0.045, 0.05, 0.045), 0.3, 'cup');
    if (seed % 3 !== 1) loose(this.cup(), -0.82, 0.05, V(0.045, 0.05, 0.045), 0.3, 'cup');
    for (let k = 0; k < 2 + (seed % 2); k++) loose(this.paper(), -0.05 + k * 0.18 + Math.random() * 0.1, 0.12 + Math.random() * 0.1, V(0.105, 0.003, 0.148), 0.02, 'paper', (Math.random() - 0.5) * 0.8);
    if (seed % 2 === 1) loose(this.clipboard(), 0.45, 0.1, V(0.12, 0.008, 0.16), 0.25, 'clipboard', 0.3);
    if (seed % 3 === 0) loose(this.binder(), 0.85, 0.15, V(0.04, 0.15, 0.13), 0.9, 'binder', 0.1);
    this.sparkPoints.push(g.localToWorld(V(0, 1.3, 0.3)));
  }

  private cupMats = [0xe8e4da, 0x2a4a7a, 0x8a2a22, 0x2a6a3a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }));
  private coffee = new THREE.MeshStandardMaterial({ color: 0x2a1508, roughness: 0.2 });

  private cup(): THREE.Group {
    const g = new THREE.Group();
    const mat = this.cupMats[Math.floor(Math.random() * this.cupMats.length)];
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.1, 16, 1, true), mat);
    body.material = mat;
    (body.material as THREE.Material).side = THREE.DoubleSide;
    g.add(body);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16), mat);
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -0.05;
    g.add(bottom);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.039, 16), this.coffee);
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.y = 0.03;
    g.add(coffee);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 6, 12, Math.PI * 1.2), mat);
    handle.position.set(0.045, 0.0, 0);
    handle.rotation.z = -Math.PI * 0.6;
    g.add(handle);
    return g;
  }

  private paperTex: THREE.CanvasTexture | null = null;
  private paper(): THREE.Mesh {
    if (!this.paperTex) {
      const c = makeCanvas(128, 180);
      const gg = c.getContext('2d')!;
      gg.fillStyle = '#efece4';
      gg.fillRect(0, 0, 128, 180);
      gg.fillStyle = '#333';
      gg.font = '7px monospace';
      for (let y = 16; y < 172; y += 9) gg.fillText(gibberish(22), 8, y);
      this.paperTex = new THREE.CanvasTexture(c);
      this.paperTex.colorSpace = THREE.SRGBColorSpace;
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.002, 0.297), new THREE.MeshStandardMaterial({ map: this.paperTex, roughness: 0.9 }));
    return m;
  }

  private clipboard(): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.012, 0.32), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.7 })));
    const p = this.paper();
    p.position.y = 0.008;
    p.scale.set(0.95, 1, 0.9);
    g.add(p);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.03), this.M.steel);
    clip.position.set(0, 0.01, -0.15);
    g.add(clip);
    return g;
  }

  private binder(): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.26), new THREE.MeshStandardMaterial({ color: [0x2a4aa0, 0xa02a2a, 0x2a2a2a][Math.floor(Math.random() * 3)], roughness: 0.6 })));
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.1, 0.12), this.M.paper);
    label.position.y = 0.05;
    g.add(label);
    return g;
  }

  private chair(at: THREE.Vector3, ry: number): void {
    const g = new THREE.Group();
    const M = this.M;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.46), M.rubber);
    seat.position.y = 0.5;
    g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.06), M.rubber);
    back.position.set(0, 0.82, 0.22);
    g.add(back);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), M.steel);
    post.position.y = 0.28;
    g.add(post);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.3), M.dark);
      leg.position.set(Math.sin(a) * 0.15, 0.06, Math.cos(a) * 0.15);
      leg.rotation.y = a;
      g.add(leg);
    }
    // Its physics box is centred on the seat: shift the meshes so the group's origin is there
    for (const c of g.children) c.position.y -= 0.5;
    g.position.copy(at).setY(0.5);
    g.rotation.y = ry;
    this.group.add(g);
    this.kprops.push({ mesh: g, half: V(0.26, 0.5, 0.26), mass: 9, kind: 'chair' });
  }

  // ------------------------------------------------------------- monitoring instruments

  /**
   * A row of instruments on carts and benches between the banks: oscilloscopes,
   * a chart recorder, a cluster of big gauges on a pillar, two tape units.
   */
  private buildInstruments(): void {
    const M = this.M;
    // Oscilloscope carts
    for (const [a, r] of [[0.45, 11.0], [-0.45, 11.0], [1.45, 11.4], [-1.45, 11.4], [2.55, 11.2], [-2.55, 11.2]] as const) {
      const g = new THREE.Group();
      this.place(g, a, r);
      this.props.add(g);
      this.box(0.7, 0.04, 0.5, 0, 0.8, 0, M.steel, g);
      this.box(0.7, 0.04, 0.5, 0, 0.3, 0, M.steel, g);
      for (const sx of [-0.32, 0.32]) for (const sz of [-0.22, 0.22]) this.cyl(0.015, 0.015, 0.8, sx, 0.4, sz, M.steel, 6, g);
      // The scope: a beige case, a round green screen, rows of knobs
      this.box(0.5, 0.32, 0.42, 0, 0.98, 0, M.beige, g);
      const sc = screenSurface(Math.round(r * 10) % 5 === 1 ? 0 : 4, 128, 128);
      this.screens.push(sc);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), new THREE.MeshBasicMaterial({ map: sc.tex, toneMapped: false }));
      face.position.set(-0.08, 1.0, 0.212);
      g.add(face);
      for (let k = 0; k < 8; k++) this.cyl(0.015, 0.015, 0.02, 0.1 + (k % 2) * 0.07, 0.9 + Math.floor(k / 2) * 0.06, 0.215, M.black, 8, g).rotation.x = Math.PI / 2;
      // A second unit under it with a needle meter
      this.box(0.5, 0.2, 0.4, 0, 0.42, 0, M.panel, g);
      g.updateMatrixWorld(true);
      const p = g.localToWorld(V(0, 0, 0));
      this.collide(p.x - 0.4, 0, p.z - 0.4, p.x + 0.4, 0.84, p.z + 0.4);
      this.sparkPoints.push(g.localToWorld(V(0, 1.1, 0)));
      // A cup on the cart
      if (a > 0) {
        const cup = this.cup();
        cup.position.copy(g.localToWorld(V(0.24, 0.87, 0.12)));
        this.group.add(cup);
        this.kprops.push({ mesh: cup, half: V(0.045, 0.05, 0.045), mass: 0.3, kind: 'cup' });
      }
    }
    // The chart recorder: a cabinet, the paper drum under glass, pens on arms
    {
      const g = new THREE.Group();
      this.place(g, 0.75, 17);
      this.props.add(g);
      this.box(1.0, 1.1, 0.55, 0, 0.55, 0, M.beige, g);
      this.box(1.02, 0.06, 0.57, 0, 1.12, 0, M.dark, g);
      const chart = chartTexture();
      this.chartTex = chart;
      const drum = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshStandardMaterial({ map: chart, roughness: 0.9, emissive: 0x111111 }));
      const glassF = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.5), M.glass);
      glassF.position.set(0, 0.75, 0.285);
      g.add(glassF);
      g.updateMatrixWorld(true);
      // (the paper drum isn't merged: its texture scrolls)
      drum.position.copy(g.localToWorld(V(0, 0.75, 0.28)));
      drum.rotation.y = g.rotation.y;
      this.group.add(drum);
      for (let k = 0; k < 2; k++) {
        const pen = this.box(0.01, 0.01, 0.2, -0.05 + k * 0.1, 0.8 - k * 0.08, 0.36, M.dark, g);
        pen.rotation.y = 0.3;
      }
      const p = g.localToWorld(V(0, 0, 0));
      this.collide(p.x - 0.55, 0, p.z - 0.55, p.x + 0.55, 1.15, p.z + 0.55);
    }
    // A pillar of big gauges, and the tape units either side of it
    for (const a of [-0.75, 2.75]) {
      const g = new THREE.Group();
      this.place(g, a, 17.5);
      this.props.add(g);
      this.box(0.9, 2.6, 0.6, 0, 1.3, 0, M.dark, g);
      for (let k = 0; k < 6; k++) {
        const x = (k % 2) * 0.4 - 0.2;
        const y = 0.8 + Math.floor(k / 2) * 0.6;
        this.cyl(0.17, 0.17, 0.05, x, y, 0.31, M.steel, 24, g).rotation.x = Math.PI / 2;
        const dial = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), M.gauge);
        dial.position.set(x, y, 0.338);
        g.add(dial);
        g.updateMatrixWorld(true);
        const needle = new THREE.Group();
        const n = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.13, 0.003), M.red);
        n.position.y = 0.055;
        needle.add(n);
        needle.position.copy(g.localToWorld(V(x, y, 0.342)));
        needle.quaternion.copy(g.getWorldQuaternion(new THREE.Quaternion()));
        this.group.add(needle);
        this.needles.push({ obj: needle, base: 0, amp: 0.6 + Math.random() * 0.6, rate: 0.3 + Math.random(), ph: Math.random() * 6 });
      }
      // Tape units: tall cabinets, two reels each (turned by the scene)
      for (const s of [-1, 1]) {
        const tg = new THREE.Group();
        tg.position.copy(g.localToWorld(V(s * 1.15, 0, 0)));
        tg.rotation.y = g.rotation.y;
        this.props.add(tg);
        this.box(0.8, 1.9, 0.55, 0, 0.95, 0, M.beige, tg);
        this.box(0.7, 0.8, 0.02, 0, 1.4, 0.28, M.black, tg);
        tg.updateMatrixWorld(true);
        for (const ry of [1.6, 1.2]) {
          const reel = new THREE.Group();
          const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 24), M.steel);
          disc.rotation.x = Math.PI / 2;
          reel.add(disc);
          for (let k = 0; k < 3; k++) {
            const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 10), M.black);
            hole.rotation.x = Math.PI / 2;
            hole.position.set(Math.cos(k * 2.09) * 0.08, Math.sin(k * 2.09) * 0.08, 0);
            reel.add(hole);
          }
          const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.022, 20), M.rubber);
          tape.rotation.x = Math.PI / 2;
          reel.add(tape);
          reel.position.copy(tg.localToWorld(V(0, ry, 0.31)));
          reel.quaternion.copy(tg.getWorldQuaternion(new THREE.Quaternion()));
          this.group.add(reel);
          this.reels.push(reel);
        }
        const tp = tg.position;
        this.collide(tp.x - 0.5, 0, tp.z - 0.5, tp.x + 0.5, 1.9, tp.z + 0.5);
      }
      const p = g.position;
      this.collide(p.x - 0.55, 0, p.z - 0.55, p.x + 0.55, 2.6, p.z + 0.55);
    }
  }

  // ------------------------------------------------------------- equipment round the wall

  private buildRacks(): void {
    const M = this.M;
    const ledTex = [ledTexture(11), ledTexture(37), ledTexture(73)];
    this.leds.push(...ledTex);
    const ledMats = ledTex.map((t) => new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.6 }));
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const aa = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(aa) < 0.16) continue; // the way in
      if (Math.abs(aa - SUIT_ANGLE) < 0.2) continue; // the suit's alcove
      const g = new THREE.Group();
      this.place(g, a, ROOM.r - 0.9);
      this.props.add(g);
      const h = 2.2 + (i % 3) * 0.2;
      this.box(1.9, h, 0.9, 0, h / 2, 0, i % 4 === 0 ? M.beige : M.panel, g);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, h - 0.5), ledMats[i % 3]);
      face.position.set(0, h / 2 + 0.1, 0.455);
      g.add(face);
      // Handles and vents
      for (let k = 0; k < 4; k++) this.box(1.7, 0.02, 0.02, 0, 0.25 + k * 0.05, 0.46, M.black, g);
      for (const s of [-1, 1]) this.box(0.03, 0.3, 0.03, s * 0.85, h / 2, 0.47, M.steel, g);
      g.updateMatrixWorld(true);
      // Cable bundles up out of its top to the tray on the wall
      const top = g.localToWorld(V(0, h, 0));
      const up = polar(a, ROOM.r - 0.35, 5.5);
      this.cable([top, top.clone().add(V(0, 0.6, 0)), up.clone().setY(4.5), up], 0.06, i % 2 ? M.rubber : M.orange, 10);
    }
    // A cable tray round the wall at 5.5 m
    const tray = new THREE.Mesh(new THREE.TorusGeometry(ROOM.r - 0.4, 0.14, 4, 128), M.dark);
    tray.rotation.x = Math.PI / 2;
    tray.position.y = 5.5;
    tray.scale.set(1, 1, 0.5);
    this.props.add(tray);
  }

  /** A gallery round the wall at 7 m, and the observation windows over it. */
  private buildGallery(): void {
    const M = this.M;
    const y = 7.0;
    const deck = new THREE.Mesh(new THREE.RingGeometry(ROOM.r - 2.2, ROOM.r - 0.3, 96, 1), new THREE.MeshStandardMaterial({ color: 0x2f363b, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }));
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = y;
    this.props.add(deck);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const p = polar(a, ROOM.r - 2.2, y);
      this.cyl(0.03, 0.03, 1.1, p.x, y + 0.55, p.z, M.steel, 6);
      const br = this.box(0.1, 0.1, 2.0, polar(a, ROOM.r - 1.3).x, y - 0.6, polar(a, ROOM.r - 1.3).z, M.dark);
      br.rotation.y = a;
    }
    for (const yy of [y + 1.1, y + 0.55]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(ROOM.r - 2.2, 0.03, 4, 128), M.steel);
      rail.rotation.x = Math.PI / 2;
      rail.position.y = yy;
      this.props.add(rail);
    }
    // Windows: dark glass with dim lit rooms behind
    const win = new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: 0x18303a, emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.4 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.13;
      const w = this.place(new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), win), a, ROOM.r - 0.34, y + 2.4);
      this.props.add(w);
      const frame = this.place(new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.8, 0.1), M.dark), a, ROOM.r - 0.25, y + 2.4);
      this.props.add(frame);
    }
  }

  // ------------------------------------------------------------- cables

  /**
   * Cables, everywhere, to the machine: bundles across the floor from every
   * bank of consoles up the steps to the pylons' feet; from the racks along
   * the floor to the banks; and from the dome down to the hoop and the
   * emitter, sagging.
   */
  private buildCables(): void {
    const M = this.M;
    const mats = [M.rubber, M.rubber, M.orange, M.rubber, M.yellow, this.cableGlow, M.rubber, M.red];
    const banks = [-0.95, 0.95, 2.0, -2.0, Math.PI];
    // From the banks to the pylons
    banks.forEach((a, bi) => {
      for (let k = 0; k < 7; k++) {
        const off = (k - 3) * 0.035;
        const pi = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4) - 0.5 + (k % 3) - 1);
        const pa = (((pi + 8) % 8) / 8) * Math.PI * 2 + Math.PI / 8;
        const pts: THREE.Vector3[] = [];
        pts.push(polar(a + off, 13.6, 0.4));
        pts.push(polar(a + off, 13.2, 0.06));
        for (let s = 1; s <= 4; s++) {
          const u = s / 5;
          const aa = a + (pa - a) * u * 0.9 + off + Math.sin(s * 1.7 + k) * 0.03;
          const rr = 13.2 + (7.6 - 13.2) * u;
          pts.push(polar(aa, rr, 0.06));
        }
        // Up the steps and along the deck to the pylon's plinth
        pts.push(polar(pa + off * 0.5, 7.3, 0.08));
        pts.push(polar(pa + off * 0.5, 6.85, 0.3));
        pts.push(polar(pa + off * 0.5, 6.3, 0.55));
        pts.push(polar(pa + off * 0.5, 5.9, DAIS.top + 0.06));
        pts.push(polar(pa + off * 0.3, 5.95, DAIS.top + 0.3));
        this.cable(pts, k % 4 === 0 ? 0.07 : 0.045, mats[(k + bi) % mats.length], 40);
      }
    });
    // From the racks to the banks, round the floor
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.17;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.3) continue;
      const b = banks.reduce((x, y) => (Math.abs(Math.atan2(Math.sin(y - a), Math.cos(y - a))) < Math.abs(Math.atan2(Math.sin(x - a), Math.cos(x - a))) ? y : x));
      const pts = [polar(a, ROOM.r - 1.5, 0.3), polar(a, ROOM.r - 2.0, 0.05), polar(a + (b - a) * 0.4, 20, 0.05), polar(a + (b - a) * 0.8, 16.5, 0.05), polar(b + (i % 3 - 1) * 0.12, 15.0, 0.25)];
      this.cable(pts, 0.05, mats[i % mats.length], 28);
      if (i % 2) this.cable(pts.map((p) => p.clone().add(V(0.08, 0, 0.08))), 0.035, M.rubber, 28);
    }
    // From the dome to the hoop: heavy cables sagging between, and up from the emitter
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const from = polar(a, 19, ROOM.h + 7.2);
      const to = polar(a + 0.1, PYLON.r + 0.2, RING_Y + 0.3);
      const mid = from.clone().lerp(to, 0.5);
      mid.y -= 2.2 + (i % 3) * 0.6;
      this.cable([from, from.clone().lerp(mid, 0.5).add(V(0, -0.8, 0)), mid, to], i % 4 === 0 ? 0.12 : 0.07, i % 6 === 0 ? this.cableGlow : M.rubber, 24);
    }
    const eY = ROOM.h + ROOM.dome - 0.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const from = polar(a, 1.2, eY - 3.0);
      const to = polar(a + 0.3, PYLON.r - 0.3, RING_Y + 0.2);
      const mid = from.clone().lerp(to, 0.5);
      mid.y -= 1.2;
      this.cable([from, mid, to], 0.06, i % 3 === 0 ? this.cableGlow : M.rubber, 20);
    }
    // Floor cable covers where the main runs cross the walkway to the steps
    for (let k = 0; k < 3; k++) {
      const z = 9 + k * 2.5;
      this.box(2.6, 0.05, 0.4, 0, 0.025, z, M.yellow);
    }
  }

  // ------------------------------------------------------------- the suit

  /** The alcove in the west wall: a frame, lights, a bench, lockers, and the suit hung on its rack. */
  private buildSuitAlcove(): Level15Data['suit'] {
    const M = this.M;
    const a = SUIT_ANGLE;
    const g = new THREE.Group();
    this.place(g, a, ROOM.r - 1.6);
    // Local +z out toward the wall: the booth's back
    g.rotation.y = a;
    this.props.add(g);
    // The booth: back wall, sides, a canopy with a lamp strip, a raised floor plate
    this.box(3.4, 3.2, 0.15, 0, 1.6, 1.4, M.panel, g);
    for (const s of [-1, 1]) this.box(0.15, 3.2, 1.6, s * 1.7, 1.6, 0.6, M.dark, g);
    this.box(3.6, 0.2, 1.8, 0, 3.2, 0.6, M.dark, g);
    this.box(3.0, 0.04, 0.2, 0, 3.08, 0.3, M.white, g);
    this.box(3.2, 0.06, 1.4, 0, 0.03, 0.6, M.steel, g);
    // Lockers on one side, a bench on the other, a hose reel
    for (let k = 0; k < 2; k++) {
      this.box(0.5, 1.9, 0.5, -1.25 + k * 0.52, 0.95, 1.05, M.beige, g);
      for (let v = 0; v < 4; v++) this.box(0.3, 0.015, 0.01, -1.25 + k * 0.52, 1.6 - v * 0.03, 0.795, M.black, g);
    }
    this.box(0.9, 0.06, 0.35, 1.15, 0.45, 0.9, M.dark, g);
    for (const s of [-1, 1]) this.box(0.05, 0.42, 0.3, 1.15 + s * 0.4, 0.21, 0.9, M.steel, g);
    // The rack: an upright with a yoke the suit hangs from, hoses to its back
    this.box(0.12, 2.6, 0.12, 0, 1.3, 1.15, M.steel, g);
    this.box(0.8, 0.08, 0.1, 0, 2.35, 1.0, M.steel, g);
    // The plate over it
    const pc = makeCanvas(512, 128);
    const pg = pc.getContext('2d')!;
    pg.fillStyle = '#d8d6cf';
    pg.fillRect(0, 0, 512, 128);
    pg.fillStyle = '#1b2a6e';
    pg.font = 'bold 44px Arial';
    pg.textAlign = 'center';
    pg.fillText('FIELD SUIT — AW CLASS', 256, 58);
    pg.font = '26px Arial';
    pg.fillText('INSPECT SEALS BEFORE USE', 256, 102);
    const pt = new THREE.CanvasTexture(pc);
    pt.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshStandardMaterial({ map: pt, roughness: 0.6 }));
    plate.position.set(0, 2.75, 1.32);
    plate.rotation.y = Math.PI;
    g.add(plate);
    g.updateMatrixWorld(true);
    // The suit itself, not merged: it goes when he puts it on
    const model = suitModel(this.suitMats);
    model.position.copy(g.localToWorld(V(0, 0.08, 0.9)));
    model.rotation.y = g.rotation.y + Math.PI;
    this.group.add(model);
    // Its light
    const light = new THREE.PointLight(0xe8f2ff, 7, 7, 1.4);
    light.position.copy(g.localToWorld(V(0, 2.8, -0.4)));
    this.group.add(light);
    // Collision: the booth's walls and the lockers
    const c0 = g.localToWorld(V(-1.7, 0, 1.2));
    const c1 = g.localToWorld(V(1.7, 0, 1.2));
    this.lineCollider(c0, c1, 0.3, 0, 3.2, 0.4);
    for (const s of [-1, 1]) this.lineCollider(g.localToWorld(V(s * 1.7, 0, 1.3)), g.localToWorld(V(s * 1.7, 0, -0.2)), 0.12, 0, 3.2, 0.3);
    const ml = g.localToWorld(V(-1.0, 0, 1.0));
    this.collide(ml.x - 0.55, 0, ml.z - 0.55, ml.x + 0.55, 1.9, ml.z + 0.55);
    const st = g.localToWorld(V(0, 0, 0.9));
    this.collide(st.x - 0.35, 0, st.z - 0.35, st.x + 0.35, 2.4, st.z + 0.35);
    return { model, stand: g.localToWorld(V(0, 0, -0.4)).setY(0), look: g.localToWorld(V(0, 1.4, 0.9)), light };
  }

  // ------------------------------------------------------------- lights

  private buildLights(): Level15Data['lights'] {
    const center = new THREE.PointLight(0xbfe6ff, 10, 24, 1.1);
    center.position.set(0, DAIS.top + 4, 0);
    this.group.add(center);
    const ring: THREE.PointLight[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const l = new THREE.PointLight(0xcfe0f0, 26, 38, 1.1);
      l.position.copy(polar(a, 15, 10));
      this.group.add(l);
      ring.push(l);
    }
    const entry = new THREE.PointLight(0xdfe8ef, 4, 8, 1.5);
    entry.position.set(0, ENTRY.h - 0.4, 28);
    this.group.add(entry);
    return { center, ring, entry };
  }
}
