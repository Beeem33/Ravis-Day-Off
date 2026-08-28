import * as THREE from 'three';

/**
 * OfficeProps — shared set-dressing built from primitives, used by both
 * levels. Everything returns a THREE.Group positioned at its own origin on
 * the floor (y = 0 is the base), so callers just place and rotate it.
 *
 * These are decoration: no colliders and not registered as shoot targets
 * unless the caller does so itself.
 */

const lam = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color });

// Materials are shared across every prop instance — these are the same few
// mass-produced objects repeated across an office, so one material each.
const MAT = {
  darkPlastic: lam(0x24272c),
  midPlastic: lam(0x3c4148),
  chrome: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.8 }),
  fabric: lam(0x2b3138),
  fabricAlt: lam(0x3a3340),
  paper: lam(0xe9e7dd),
  paperDim: lam(0xd8d5c8),
  steel: lam(0x8e959c),
  binGrey: lam(0x44494f)
};

/**
 * Office task chair: five-star castor base, gas cylinder, seat pan, and a
 * reclined back with armrests. Replaces the floating slab the levels used
 * to draw. `seatH` is the top of the seat cushion.
 */
export function officeChair(seatH = 0.46, fabric: THREE.Material = MAT.fabric): THREE.Group {
  const g = new THREE.Group();
  const baseY = 0.045;

  // Five-star base: tapered arms out to a castor each
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 0.055), MAT.midPlastic);
    arm.position.set(Math.cos(a) * 0.15, baseY, Math.sin(a) * 0.15);
    arm.rotation.y = -a;
    g.add(arm);
    const castor = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.022, 10), MAT.darkPlastic);
    castor.rotation.z = Math.PI / 2;
    castor.position.set(Math.cos(a) * 0.28, 0.028, Math.sin(a) * 0.28);
    g.add(castor);
  }
  // Hub + gas cylinder
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 12), MAT.midPlastic);
  hub.position.y = baseY + 0.03;
  g.add(hub);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, seatH - 0.16, 10), MAT.chrome);
  cyl.position.y = (seatH - 0.16) / 2 + 0.08;
  g.add(cyl);

  // Seat: cushion with a slight lip, on a plastic pan
  const pan = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.42), MAT.darkPlastic);
  pan.position.y = seatH - 0.075;
  g.add(pan);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.075, 0.44), fabric);
  seat.position.y = seatH - 0.037;
  g.add(seat);

  // Back: reclined, on a short spine
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), MAT.darkPlastic);
  spine.position.set(0, seatH + 0.08, 0.19);
  spine.rotation.x = -0.18;
  g.add(spine);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.07), fabric);
  back.position.set(0, seatH + 0.29, 0.235);
  back.rotation.x = -0.14;
  g.add(back);
  const lumbar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.04), MAT.darkPlastic);
  lumbar.position.set(0, seatH + 0.12, 0.2);
  lumbar.rotation.x = -0.14;
  g.add(lumbar);

  // Armrests
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.035), MAT.darkPlastic);
    post.position.set(side * 0.24, seatH + 0.06, 0.05);
    g.add(post);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.22), MAT.darkPlastic);
    pad.position.set(side * 0.24, seatH + 0.15, 0.02);
    g.add(pad);
  }
  return g;
}

/** Round mesh-style waste bin with a bit of rubbish poking out. */
export function trashCan(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.36, 14, 1, true), MAT.binGrey);
  body.position.y = 0.18;
  body.material.side = THREE.DoubleSide;
  g.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 16), MAT.midPlastic);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.36;
  g.add(rim);
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 14), MAT.darkPlastic);
  bottom.position.y = 0.01;
  g.add(bottom);
  // Crumpled paper, just over the rim
  for (let i = 0; i < 3; i++) {
    const ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.045 + Math.random() * 0.02, 0),
      i % 2 ? MAT.paper : MAT.paperDim
    );
    ball.position.set((Math.random() - 0.5) * 0.14, 0.35 + Math.random() * 0.05, (Math.random() - 0.5) * 0.14);
    ball.rotation.set(Math.random(), Math.random(), Math.random());
    g.add(ball);
  }
  return g;
}

let deadbullMat: THREE.MeshLambertMaterial | null = null;

/** Wrap texture for the DEADBULL can: silver and blue, with the logo. */
function deadbullTexture(): THREE.MeshLambertMaterial {
  if (deadbullMat) return deadbullMat;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  // Silver body with a blue diagonal band, the energy-drink look
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#d9dde2');
  grad.addColorStop(0.5, '#f2f4f6');
  grad.addColorStop(1, '#b9bfc6');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#1a3f8f';
  g.beginPath();
  g.moveTo(0, 18);
  g.lineTo(256, 4);
  g.lineTo(256, 44);
  g.lineTo(0, 58);
  g.closePath();
  g.fill();
  g.fillStyle = '#12306e';
  g.fillRect(0, 96, 256, 32);

  // The bull: on its back, legs in the air, X for an eye
  const bull = (ox: number): void => {
    g.fillStyle = '#c62828';
    g.beginPath(); // body
    g.ellipse(ox + 34, 76, 22, 12, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath(); // head, tipped back
    g.ellipse(ox + 8, 70, 10, 8, -0.4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c62828';
    g.lineWidth = 3.5;
    g.lineCap = 'round';
    g.beginPath(); // four legs straight up
    for (const lx of [22, 32, 42, 52]) {
      g.moveTo(ox + lx, 66);
      g.lineTo(ox + lx + (lx % 20 === 2 ? 4 : -3), 50);
    }
    g.stroke();
    g.beginPath(); // horns
    g.moveTo(ox + 2, 63);
    g.lineTo(ox - 4, 55);
    g.moveTo(ox + 12, 61);
    g.lineTo(ox + 10, 52);
    g.stroke();
    g.strokeStyle = '#f2f4f6'; // dead eye
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ox + 5, 67);
    g.lineTo(ox + 11, 73);
    g.moveTo(ox + 11, 67);
    g.lineTo(ox + 5, 73);
    g.stroke();
    g.strokeStyle = '#c62828';
  };
  bull(20);
  bull(148);

  g.fillStyle = '#f2f4f6';
  g.font = 'bold 21px Impact, sans-serif';
  g.textAlign = 'center';
  g.fillText('DEADBULL', 64, 40);
  g.fillText('DEADBULL', 192, 38);
  g.fillStyle = '#9fb6e8';
  g.font = 'bold 9px monospace';
  g.fillText('IT GIVES YOU NOTHING', 64, 117);
  g.fillText('IT GIVES YOU NOTHING', 192, 117);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  deadbullMat = new THREE.MeshLambertMaterial({ map: tex });
  return deadbullMat;
}

/** A tall can of DEADBULL. Origin at the base. */
export function sodaCan(): THREE.Group {
  const g = new THREE.Group();
  const R = 0.05;
  const H = 0.19;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 18), deadbullTexture());
  body.position.y = H / 2 + 0.008;
  g.add(body);
  for (const [y, r] of [[0.004, R * 0.88], [H + 0.01, R * 0.86]] as const) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.016, 18), MAT.chrome);
    cap.position.y = y;
    g.add(cap);
  }
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.005, 0.018), MAT.chrome);
  tab.position.set(0.012, H + 0.021, 0);
  g.add(tab);
  return g;
}

// ------------------------------------------------------------------ reading

const bookMats = new Map<string, THREE.MeshLambertMaterial>();

/**
 * Cover texture for a paperback: a solid spine colour with the title set
 * across it. Cached per title, since the same books repeat around the floor.
 */
function bookCover(title: string, bg: string, ink: string, kicker: string): THREE.MeshLambertMaterial {
  const key = `${title}|${bg}`;
  const hit = bookMats.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 176;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 128, 176);
  // A band and a rule, so it reads as a cover and not a coloured slab
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(0, 116, 128, 60);
  g.strokeStyle = ink;
  g.lineWidth = 2;
  g.strokeRect(7, 7, 114, 162);
  g.fillStyle = ink;
  g.font = 'bold 15px Georgia, serif';
  g.textAlign = 'center';
  const words = title.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 11) {
      lines.push(line.trim());
      line = w;
    } else line += ' ' + w;
  }
  lines.push(line.trim());
  lines.forEach((l, i) => g.fillText(l, 64, 46 + i * 19));
  g.font = 'italic 9px Georgia, serif';
  g.fillText(kicker, 64, 150);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshLambertMaterial({ map: tex });
  bookMats.set(key, m);
  return m;
}

/**
 * A paperback lying face-up. The cover is on the top face, the rest is
 * page-edge white, so it reads as a book from any angle.
 */
export function book(kind: 'persuade' | 'scamming' | 'comic'): THREE.Group {
  const g = new THREE.Group();
  const spec = {
    persuade: { t: 'HOW TO PERSUADE ANYONE', bg: '#1d3f6e', ink: '#f4e9c8', k: 'closing, every time' },
    scamming: { t: 'THE ART OF SCAMMING', bg: '#6e1d1d', ink: '#f0dfc0', k: 'a practical guide' },
    comic: { t: 'CAPTAIN VOIP', bg: '#d8a13a', ink: '#2a1a52', k: 'issue #12 · hold music!' }
  }[kind];
  const cover = kind === 'comic' ? comicCover() : bookCover(spec.t, spec.bg, spec.ink, spec.k);
  const pages = MAT.paper;
  const W = kind === 'comic' ? 0.17 : 0.14;
  const D = kind === 'comic' ? 0.26 : 0.21;
  const H = kind === 'comic' ? 0.012 : 0.035;
  // Cover on top (+Y), pages everywhere else
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [
    pages, pages, cover, pages, pages, pages
  ]);
  body.position.y = H / 2;
  g.add(body);
  return g;
}

/** A spill of coffee with the cup that made it lying alongside. */
export function spilledCoffee(): THREE.Group {
  const g = new THREE.Group();
  const stainMat = new THREE.MeshLambertMaterial({ color: 0x3b2317, transparent: true, opacity: 0.88 });
  // An irregular puddle: a few overlapping flattened discs
  for (let i = 0; i < 5; i++) {
    const r = 0.09 + Math.random() * 0.13;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 14), stainMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set((Math.random() - 0.5) * 0.22, 0.003 + i * 0.0008, (Math.random() - 0.5) * 0.22);
    disc.scale.set(1, 1 + Math.random() * 0.5, 1);
    g.add(disc);
  }
  // The cup, on its side
  const cupMat = new THREE.MeshLambertMaterial({ color: 0xe4e0d6 });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.034, 0.1, 12, 1, true), cupMat);
  cup.material.side = THREE.DoubleSide;
  cup.rotation.z = Math.PI / 2;
  cup.rotation.y = Math.random() * Math.PI;
  cup.position.set(0.17, 0.042, -0.04);
  g.add(cup);
  const cupBase = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.008, 12), cupMat);
  cupBase.rotation.z = Math.PI / 2;
  cupBase.position.set(0.216, 0.042, -0.04);
  g.add(cupBase);
  return g;
}

const CHIP_W = 0.17;
const CHIP_H = 0.24;
const CHIP_D = 0.07;
let chipsMats: THREE.Material[] | null = null;

function chipsCanvas(px: number, py: number, draw: (g: CanvasRenderingContext2D) => void): THREE.MeshLambertMaterial {
  const S = 2;
  const c = document.createElement('canvas');
  c.width = px * S;
  c.height = py * S;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.scale(S, S);
  const grad = g.createLinearGradient(0, 0, 0, py);
  grad.addColorStop(0, '#f2a13a');
  grad.addColorStop(1, '#c85f1a');
  g.fillStyle = grad;
  g.fillRect(0, 0, px, py);
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  return new THREE.MeshLambertMaterial({ map: tex });
}

/**
 * PRINTED CHIPS — the vending-machine snack.
 *
 * Each face gets its own material at its own aspect ratio. A single texture
 * across a BoxGeometry stretches badly, because every face takes the same
 * 0..1 UVs regardless of how differently shaped it is: the 0.07-deep sides
 * were squeezing the whole label into a strip.
 */
export function chipsBox(): THREE.Group {
  if (!chipsMats) {
    // Front: the printer, the crisp, the wordmark. Canvas matches the face.
    const front = chipsCanvas(170, 240, (g) => {
      g.fillStyle = '#4a4a52'; // extruder head
      g.fillRect(60, 26, 50, 26);
      g.beginPath();
      g.moveTo(72, 52);
      g.lineTo(98, 52);
      g.lineTo(90, 74);
      g.lineTo(80, 74);
      g.closePath();
      g.fill();
      g.fillStyle = '#f7dd8a'; // the crisp coming off it
      g.beginPath();
      g.ellipse(85, 108, 46, 28, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#c98a2a';
      g.lineWidth = 3;
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(85 + i * 16, 86);
        g.lineTo(85 + i * 16, 130);
        g.stroke();
      }
      g.fillStyle = '#2a1a10';
      g.textAlign = 'center';
      g.font = 'bold 27px Impact, sans-serif';
      g.fillText('PRINTED', 85, 174);
      g.fillText('CHIPS', 85, 200);
      g.font = 'bold 10px monospace';
      g.fillText('100% EXTRUDED', 85, 219);
      g.fillText('0% POTATO', 85, 232);
    });
    // Back: a nutrition-panel look rather than a mirrored wordmark
    const back = chipsCanvas(170, 240, (g) => {
      g.fillStyle = 'rgba(255,248,235,0.9)';
      g.fillRect(18, 30, 134, 180);
      g.fillStyle = '#2a1a10';
      g.textAlign = 'left';
      g.font = 'bold 13px monospace';
      g.fillText('NUTRITION', 26, 48);
      g.font = '10px monospace';
      const rows = ['Filament .... 41g', 'Salt ........ 2.1g', 'Resin ....... 0.4g', 'Potato ...... 0g', 'Regret ...... 88%'];
      rows.forEach((r, i) => g.fillText(r, 26, 70 + i * 18));
      g.strokeStyle = '#2a1a10';
      g.lineWidth = 1;
      for (let i = 0; i < rows.length; i++) {
        g.beginPath();
        g.moveTo(26, 75 + i * 18);
        g.lineTo(144, 75 + i * 18);
        g.stroke();
      }
      // Barcode
      g.fillStyle = '#111';
      for (let i = 0; i < 22; i++) g.fillRect(30 + i * 5, 168, 1 + (i % 3), 30);
    });
    // Narrow sides and the ends: a plain wrapper with a stripe, no text to squash
    const side = chipsCanvas(70, 240, (g) => {
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(0, 96, 70, 48);
      g.fillStyle = '#2a1a10';
      g.textAlign = 'center';
      g.font = 'bold 10px monospace';
      g.save();
      g.translate(35, 120);
      g.rotate(-Math.PI / 2);
      g.fillText('PRINTED CHIPS', 0, 4);
      g.restore();
    });
    const end = chipsCanvas(170, 70, (g) => {
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fillRect(0, 24, 170, 22);
    });
    // BoxGeometry face order: px nx py ny pz nz
    chipsMats = [side, side, end, end, front, back];
  }
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(CHIP_W, CHIP_H, CHIP_D), chipsMats);
  box.position.y = CHIP_H / 2;
  g.add(box);
  return g;
}

let fbiMat: THREE.MeshLambertMaterial | null = null;

/** FBI livery for the truck flanks: blue band, big white lettering. */
function fbiLivery(): THREE.MeshLambertMaterial {
  if (fbiMat) return fbiMat;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#20252b';
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = '#12306e';
  g.fillRect(0, 44, 512, 74);
  g.fillStyle = '#d8dde2';
  g.fillRect(0, 36, 512, 8);
  g.fillRect(0, 118, 512, 8);
  g.fillStyle = '#f4f6f8';
  g.textBaseline = 'middle';
  // Mark on the left third, long name stacked on the right, both left-aligned
  // from fixed columns so the two can never run into each other.
  g.textAlign = 'left';
  g.font = 'bold 78px Impact, Arial Black, sans-serif';
  g.fillText('FBI', 26, 82);
  g.fillStyle = '#9fb6e8';
  g.fillRect(196, 52, 4, 58);
  g.fillStyle = '#f4f6f8';
  g.font = 'bold 20px monospace';
  g.fillText('FEDERAL BUREAU', 218, 66);
  g.fillText('OF INVESTIGATION', 218, 90);
  g.font = 'bold 13px monospace';
  g.fillStyle = '#9fb6e8';
  g.fillText('TACTICAL RESPONSE UNIT', 218, 110);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  fbiMat = new THREE.MeshLambertMaterial({ map: tex });
  return fbiMat;
}

/**
 * FBI breaching truck. Built nose-first along +Z: cab and push bumper at the
 * +Z end, so driving it forward leads with the ram. Armoured box behind, a
 * roof hatch with a pintle-mounted LMG, and a side door toward the rear that
 * swings open to let the team out.
 */
export function swatTruck(): {
  group: THREE.Group;
  doorPivot: THREE.Group;
  gunMount: THREE.Group;
  gunYaw: THREE.Group;
  doorMouth: THREE.Vector3;
  /** World height of the roof deck, where the gunner stands. */
  roofY: number;
  /** Solid footprint in truck-local space, for the level colliders. */
  bounds: { hw: number; z0: number; z1: number; top: number };
} {
  const g = new THREE.Group();
  // Painted steel: light enough to read in a dark office and metallic, so
  // the fixtures pick it out. Flat black just swallowed all the light.
  const hull = new THREE.MeshStandardMaterial({ color: 0x4a545e, roughness: 0.42, metalness: 0.72 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.5, metalness: 0.8 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x6d8496, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.55,
    emissive: 0x1b2836, emissiveIntensity: 0.5
  });

  const L = 6.4;
  const W = 2.6;
  const H = 1.95; // low enough that a roof gunner clears an indoor ceiling
  const DECK = 0.55; // chassis height
  const roofY = DECK + H;

  // Armoured box: the rear two thirds, so towards -Z. Built as panels rather
  // than one solid block — the side door opens onto a real bay, and walking
  // round the back of a sealed box with a door glued to it looked wrong.
  const boxL = L * 0.62;
  const boxZ = -L * 0.16;
  const SKIN = 0.07;
  const doorW = 1.9;
  const doorZ = boxZ - boxL * 0.1;
  const doorH = H - 0.2;
  const bayFloorY = DECK + SKIN / 2;

  const panel = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hull);
    m.position.set(x, y, z);
    g.add(m);
  };
  // Roof and bay floor
  panel(W, SKIN, boxL, 0, DECK + H - SKIN / 2, boxZ);
  panel(W, SKIN, boxL, 0, bayFloorY, boxZ);
  // Blind flank, front bulkhead and rear wall
  panel(SKIN, H, boxL, -(W / 2 - SKIN / 2), DECK + H / 2, boxZ);
  panel(W, H, SKIN, 0, DECK + H / 2, boxZ + boxL / 2 - SKIN / 2);
  panel(W, H, SKIN, 0, DECK + H / 2, boxZ - boxL / 2 + SKIN / 2);
  // Door flank, split round the opening: a pillar fore and aft, header above
  const flankX = W / 2 - SKIN / 2;
  const foreLen = boxZ + boxL / 2 - (doorZ + doorW / 2);
  const aftLen = doorZ - doorW / 2 - (boxZ - boxL / 2);
  if (foreLen > 0.01) panel(SKIN, H, foreLen, flankX, DECK + H / 2, doorZ + doorW / 2 + foreLen / 2);
  if (aftLen > 0.01) panel(SKIN, H, aftLen, flankX, DECK + H / 2, doorZ - doorW / 2 - aftLen / 2);
  panel(SKIN, H - doorH, doorW, flankX, DECK + doorH + (H - doorH) / 2, doorZ);

  // Bay interior: dark lining, a bench down each side and a grab rail
  const bayMat = lam(0x2a3038);
  const liner = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bayMat);
    m.position.set(x, y, z);
    g.add(m);
  };
  liner(W - SKIN * 2.4, 0.02, boxL - SKIN * 2.4, 0, bayFloorY + SKIN / 2 + 0.011, boxZ);
  for (const sx of [-1, 1]) {
    const benchZ = boxZ + 0.1;
    const benchL = boxL - SKIN * 3;
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, benchL), lam(0x1d2228));
    bench.position.set(sx * (W / 2 - 0.28), DECK + 0.52, benchZ);
    g.add(bench);
    const backRest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, benchL), lam(0x222830));
    backRest.position.set(sx * (W / 2 - SKIN - 0.03), DECK + 0.75, benchZ);
    g.add(backRest);
    for (const lz of [benchZ - benchL / 2 + 0.2, benchZ + benchL / 2 - 0.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.05), lam(0x1d2228));
      leg.position.set(sx * (W / 2 - 0.28), DECK + 0.26, lz);
      g.add(leg);
    }
  }
  // Grab rail along the ceiling of the bay
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, boxL - 0.5, 8), MAT.chrome);
  rail.rotation.x = Math.PI / 2;
  rail.position.set(0, DECK + H - 0.22, boxZ);
  g.add(rail);
  // A dome light so the bay is not a black hole when the door swings
  const domeY = DECK + H - SKIN - 0.03;
  const dome = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.04, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x1b1f24, emissive: 0xffd9a8, emissiveIntensity: 1.1 })
  );
  dome.position.set(0, domeY, boxZ + 0.3);
  g.add(dome);
  const bayLight = new THREE.PointLight(0xffd2a0, 2.2, 3.4, 2);
  bayLight.position.set(0, domeY - 0.15, boxZ);
  g.add(bayLight);
  // FBI livery down both flanks
  for (const sx of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(boxL * 0.92, H * 0.62), fbiLivery());
    panel.position.set(sx * (W / 2 + 0.012), DECK + H * 0.52, boxZ);
    panel.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(panel);
  }
  const rear = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, H - 0.12, 0.06), trim);
  rear.position.set(0, DECK + H / 2, boxZ - boxL / 2 - 0.02);
  g.add(rear);

  // Cab at the FRONT (+Z)
  const cabL = L * 0.3;
  const cabZ = L * 0.34;
  const cabH = H * 0.86;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, cabH, cabL), hull);
  cab.position.set(0, DECK + cabH / 2, cabZ);
  g.add(cab);
  // Bridge cab to box — they were separate blocks with daylight between them
  const joinZ0 = boxZ + boxL / 2;
  const joinZ1 = cabZ - cabL / 2;
  const join = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, cabH, Math.max(0.05, joinZ1 - joinZ0) + 0.08), hull);
  join.position.set(0, DECK + cabH / 2, (joinZ0 + joinZ1) / 2);
  g.add(join);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, cabH, 0.05), trim);
  seam.position.set(0, DECK + cabH / 2, joinZ1);
  g.add(seam);
  // Windscreen in a frame, so its edges read instead of being a black void
  const wsW = W - 0.42;
  const wsH = cabH * 0.44;
  const wsZ = cabZ + cabL / 2 + 0.02;
  const wsY = DECK + cabH * 0.68;
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(wsW, wsH, 0.05), glassMat);
  windshield.position.set(0, wsY, wsZ);
  g.add(windshield);
  for (const [fw, fh, fx, fy] of [
    [wsW + 0.12, 0.07, 0, wsY + wsH / 2], [wsW + 0.12, 0.07, 0, wsY - wsH / 2],
    [0.07, wsH + 0.14, wsW / 2, wsY], [0.07, wsH + 0.14, -wsW / 2, wsY]
  ] as const) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.07), trim);
    f.position.set(fx, fy, wsZ + 0.005);
    g.add(f);
  }
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.05, wsH, 0.07), trim);
  pillar.position.set(0, wsY, wsZ + 0.005);
  g.add(pillar);
  for (const wx of [-0.55, 0.55]) {
    const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), trim);
    wiper.position.set(wx, wsY - wsH / 2 + 0.08, wsZ + 0.05);
    wiper.rotation.z = wx > 0 ? 0.22 : -0.22;
    g.add(wiper);
  }
  for (const sx of [-1, 1]) {
    const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(0.06, cabH * 0.36, cabL * 0.5), glassMat);
    sideGlass.position.set(sx * (W / 2 - 0.06), DECK + cabH * 0.7, cabZ);
    g.add(sideGlass);
  }

  // Push bumper — this is the end that goes through the wall
  const noseZ = cabZ + cabL / 2;
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.66, 0.3), trim);
  bumper.position.set(0, 0.82, noseZ + 0.2);
  g.add(bumper);
  for (const bx of [-0.86, -0.29, 0.29, 0.86]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.18), trim);
    bar.position.set(bx, 1.12, noseZ + 0.28);
    g.add(bar);
  }
  for (const hx of [-0.9, 0.9]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.18, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x2a2c30, emissive: 0xfff0c0, emissiveIntensity: 1.3 })
    );
    lamp.position.set(hx, 1.3, noseZ + 0.02);
    g.add(lamp);
  }

  // Wheels
  for (const wz of [cabZ - 0.25, boxZ + 0.7, boxZ - boxL * 0.32]) {
    for (const wx of [-1, 1]) {
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.34, 16), lam(0x0e1013));
      tyre.rotation.z = Math.PI / 2;
      tyre.position.set(wx * (W / 2 - 0.06), 0.55, wz);
      g.add(tyre);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 10), lam(0x5a6068));
      hub.rotation.z = Math.PI / 2;
      hub.position.set(wx * (W / 2 - 0.05), 0.55, wz);
      g.add(hub);
    }
  }

  // Light bar sitting ON the cab roof rather than hovering above it
  const barY = DECK + cabH + 0.03;
  const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.26), trim);
  barBase.position.set(0, barY, cabZ);
  g.add(barBase);
  for (const [lx, col] of [[-0.44, 0x2b5fd0], [0.44, 0xd02b2b]] as const) {
    const l = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.12, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x101318, emissive: col, emissiveIntensity: 1.6 })
    );
    l.position.set(lx, barY + 0.09, cabZ);
    g.add(l);
  }

  // Side door leaf, hinged at the -Z edge of the opening cut above
  const doorPivot = new THREE.Group();
  doorPivot.position.set(W / 2, DECK, doorZ + doorW / 2);
  g.add(doorPivot);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, doorH, doorW), hull);
  leaf.position.set(0, doorH / 2, -doorW / 2);
  doorPivot.add(leaf);
  // Inner face is the bay lining colour, so the open leaf reads two-sided
  const leafInner = new THREE.Mesh(new THREE.BoxGeometry(0.012, doorH - 0.08, doorW - 0.08), bayMat);
  leafInner.position.set(-0.036, doorH / 2, -doorW / 2);
  doorPivot.add(leafInner);
  const doorBar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), MAT.chrome);
  doorBar.position.set(0.06, doorH * 0.55, -0.35);
  doorPivot.add(doorBar);
  // Step down out of the bay
  const step = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, doorW - 0.3), lam(0x1d2228));
  step.position.set(W / 2 + 0.12, DECK - 0.16, doorZ);
  g.add(step);

  // Pintle-mounted LMG on the roof: yaw ring, mount, gun, spade grips
  const gunYaw = new THREE.Group();
  gunYaw.position.set(0, roofY, boxZ + boxL * 0.16);
  g.add(gunYaw);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.58, 0.14, 16), trim);
  ring.position.y = 0.07;
  gunYaw.add(ring);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.62, 10), MAT.midPlastic);
  post.position.y = 0.44;
  gunYaw.add(post);
  const gunMount = new THREE.Group();
  gunMount.position.y = 0.78;
  gunYaw.add(gunMount);
  gunMount.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.17, 0.84), lam(0x1a1c20)));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.95, 10), lam(0x121417));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.86;
  gunMount.add(barrel);
  const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.36), lam(0x22252a));
  shroud.position.z = -0.58;
  gunMount.add(shroud);
  const ammoBox = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.28), lam(0x2e3a22));
  ammoBox.position.set(0.19, -0.1, 0.12);
  gunMount.add(ammoBox);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.46, 0.05), lam(0x2a2f35));
  shield.position.set(0, 0.08, -0.3);
  gunMount.add(shield);
  for (const sx of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.045), lam(0x15171a));
    grip.position.set(sx * 0.15, -0.02, 0.36);
    grip.rotation.x = -0.25;
    gunMount.add(grip);
  }

  return {
    group: g, doorPivot, gunMount, gunYaw,
    doorMouth: new THREE.Vector3(W / 2 + 0.8, 0, doorZ),
    roofY,
    bounds: { hw: W / 2 + 0.15, z0: boxZ - boxL / 2 - 0.1, z1: noseZ + 0.4, top: roofY }
  };
}


/** Broken masonry and twisted rebar, for the hole the truck came through. */
export function rubblePile(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const stone = [lam(0x8d8a80), lam(0x76736a), lam(0x9c988c)];
  for (let i = 0; i < 9; i++) {
    const s = (0.18 + Math.random() * 0.4) * scale;
    const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stone[i % 3]);
    chunk.position.set((Math.random() - 0.5) * 1.6 * scale, s * 0.5, (Math.random() - 0.5) * 1.2 * scale);
    chunk.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    chunk.scale.y = 0.6 + Math.random() * 0.4;
    g.add(chunk);
  }
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8 + Math.random() * 0.7, 5), lam(0x6b4a35));
    bar.position.set((Math.random() - 0.5) * 1.4 * scale, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 1.0 * scale);
    bar.rotation.set(Math.random() * 2, Math.random() * 2, 0.7 + Math.random());
    g.add(bar);
  }
  return g;
}

const artMats = new Map<string, THREE.MeshLambertMaterial>();

/**
 * Framed wall art. Motivational tat for the call floor, plus a few
 * landscapes — the sort of thing bought by the metre for an office.
 */
export function wallArt(
  kind: 'together' | 'dial' | 'dunes' | 'coast' | 'peaks' | 'house' | 'newcar' | 'thumbsup' | 'ourhome'
): THREE.Group {
  const W = kind === 'together' ? 1.7 : kind === 'dial' ? 1.0 : kind === 'newcar' ? 1.3 : kind === 'thumbsup' ? 1.0 : kind === 'ourhome' ? 1.2 : 1.15;
  const H = kind === 'together' ? 1.05 : kind === 'dial' ? 1.3 : kind === 'newcar' ? 0.92 : kind === 'thumbsup' ? 1.15 : kind === 'ourhome' ? 0.86 : 0.8;

  let mat = artMats.get(kind);
  if (!mat) {
    const px = Math.round(W * 260);
    const py = Math.round(H * 260);
    const c = document.createElement('canvas');
    c.width = px;
    c.height = py;
    const g = c.getContext('2d')!;

    if (kind === 'together') {
      g.fillStyle = '#101828';
      g.fillRect(0, 0, px, py);
      g.fillStyle = '#f4f2ec';
      g.textAlign = 'center';
      g.font = `bold ${Math.round(py * 0.14)}px Impact, Arial Black, sans-serif`;
      g.fillText('CALL TOGETHER,', px / 2, py * 0.21);
      g.fillText('FALL TOGETHER', px / 2, py * 0.37);

      // A line of the floor staff in their own uniform — white shirt, blue
      // chinos, ball cap — hands joined all the way along. The end two get
      // their outer arm as well, hanging at their side: the chain has to
      // finish somewhere, but nobody should look like they lost a limb.
      const n = 5;
      const footY = py * 0.965;
      const gapX = px / n;
      const unit = py * 0.062; // one body-width, everything scales off this
      for (let i = 0; i < n; i++) {
        const x = gapX * (i + 0.5);
        const headR = unit * 0.5;
        const headY = footY - unit * 6.0;
        const shoulderY = footY - unit * 5.1;
        const hipY = footY - unit * 2.9;

        // Legs — blue chinos, with a gap between them
        g.fillStyle = '#33507d';
        g.fillRect(x - unit * 0.52, hipY, unit * 0.44, footY - hipY);
        g.fillRect(x + unit * 0.08, hipY, unit * 0.44, footY - hipY);
        g.fillStyle = '#15171a';
        g.fillRect(x - unit * 0.58, footY - unit * 0.16, unit * 0.5, unit * 0.16);
        g.fillRect(x + unit * 0.08, footY - unit * 0.16, unit * 0.5, unit * 0.16);

        // Shirt
        g.fillStyle = '#f2f2ee';
        g.fillRect(x - unit * 0.6, shoulderY, unit * 1.2, hipY - shoulderY);
        // Collar and placket, so it reads as a shirt not a vest
        g.strokeStyle = '#c9c9c2';
        g.lineWidth = Math.max(1, px * 0.0022);
        g.beginPath();
        g.moveTo(x, shoulderY);
        g.lineTo(x, hipY);
        g.stroke();
        g.fillStyle = '#c9c9c2';
        g.fillRect(x - unit * 0.6, shoulderY, unit * 1.2, unit * 0.12);

        // Head and cap
        g.fillStyle = '#c98d63';
        g.beginPath();
        g.arc(x, headY, headR, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#1d3f6e';
        g.beginPath();
        g.arc(x, headY - headR * 0.15, headR * 1.02, Math.PI, 0);
        g.fill();
        g.fillRect(x - headR * 1.02, headY - headR * 0.2, headR * 2.04, headR * 0.22);
        // Peak, alternating side so the row is not five clones
        const peak = i % 2 ? 1 : -1;
        g.fillRect(x + (peak > 0 ? headR * 0.9 : -headR * 2.0), headY - headR * 0.1, headR * 1.1, headR * 0.2);
        // Neck
        g.fillStyle = '#b07c56';
        g.fillRect(x - unit * 0.14, headY + headR * 0.75, unit * 0.28, shoulderY - (headY + headR * 0.75) + 0.5);

        // Arms. Inner ones reach across to meet the neighbour's halfway; the
        // outer arm on each end figure hangs down at their side.
        g.strokeStyle = '#c98d63';
        g.lineWidth = unit * 0.26;
        g.lineCap = 'round';
        const armY = shoulderY + unit * 0.35;
        const joinY = shoulderY + unit * 1.5;
        for (const side of [-1, 1]) {
          const linked = side < 0 ? i > 0 : i < n - 1;
          g.beginPath();
          g.moveTo(x + side * unit * 0.5, armY);
          if (linked) {
            g.lineTo(x + side * gapX * 0.5, joinY);
          } else {
            // Hanging arm: out a little, then straight down past the hip
            g.lineTo(x + side * unit * 0.78, armY + unit * 1.1);
            g.lineTo(x + side * unit * 0.7, hipY + unit * 0.25);
          }
          g.stroke();
        }
      }
      // Joined hands, drawn last so they sit on top of both arms
      g.fillStyle = '#e0a87e';
      for (let i = 0; i < n - 1; i++) {
        g.beginPath();
        g.arc(gapX * (i + 1), footY - py * 0.062 * 5.1 + py * 0.062 * 1.5, py * 0.062 * 0.2, 0, Math.PI * 2);
        g.fill();
      }
    } else if (kind === 'dial') {
      g.fillStyle = '#f6f1e2';
      g.fillRect(0, 0, px, py);
      g.fillStyle = '#b8271f';
      g.fillRect(0, 0, px, py * 0.05);
      g.fillRect(0, py * 0.95, px, py * 0.05);
      g.fillStyle = '#b8271f';
      g.textAlign = 'center';
      g.font = `bold ${Math.round(py * 0.1)}px Impact, Arial Black, sans-serif`;
      g.fillText('DIAL LIKE', px / 2, py * 0.22);
      g.fillText('YOU MEAN IT!', px / 2, py * 0.34);
      // Desk phone: base, cradle, handset, coiled cord, keypad
      const bx = px / 2;
      const by = py * 0.62;
      g.fillStyle = '#24272c';
      g.beginPath();
      g.roundRect(bx - px * 0.25, by, px * 0.5, py * 0.19, px * 0.02);
      g.fill();
      g.fillStyle = '#3a3f46';
      g.beginPath();
      g.roundRect(bx - px * 0.27, by - py * 0.11, px * 0.54, py * 0.1, px * 0.035);
      g.fill();
      g.fillStyle = '#8d939b';
      for (let r = 0; r < 3; r++) {
        for (let col = 0; col < 3; col++) {
          g.fillRect(bx - px * 0.12 + col * px * 0.09, by + py * 0.03 + r * py * 0.045, px * 0.055, py * 0.03);
        }
      }
      g.strokeStyle = '#24272c';
      g.lineWidth = Math.max(2, px * 0.014);
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const cx = bx + px * 0.24 + Math.sin(i * 1.7) * px * 0.035;
        g.moveTo(cx, by - py * 0.04 + i * py * 0.026);
        g.lineTo(cx + px * 0.05, by - py * 0.03 + i * py * 0.026);
      }
      g.stroke();
    } else if (kind === 'house') {
      // Somebody's place out in the suburbs — the kind of snapshot people pin
      // up because it is what the money is supposed to be for.
      const sky = g.createLinearGradient(0, 0, 0, py * 0.72);
      sky.addColorStop(0, '#8fb9de');
      sky.addColorStop(1, '#d9e7ef');
      g.fillStyle = sky;
      g.fillRect(0, 0, px, py * 0.72);
      g.fillStyle = '#fdf6d8';
      g.beginPath();
      g.arc(px * 0.17, py * 0.16, py * 0.075, 0, Math.PI * 2);
      g.fill();
      // Lawn
      g.fillStyle = '#6f9c4c';
      g.fillRect(0, py * 0.7, px, py * 0.3);
      g.fillStyle = '#628c43';
      g.fillRect(0, py * 0.7, px, py * 0.035);
      // Path up to the door
      g.fillStyle = '#c9c3b2';
      g.beginPath();
      g.moveTo(px * 0.46, py * 0.78);
      g.lineTo(px * 0.54, py * 0.78);
      g.lineTo(px * 0.6, py);
      g.lineTo(px * 0.4, py);
      g.closePath();
      g.fill();
      // Walls
      const hx = px * 0.26;
      const hw = px * 0.48;
      const hy = py * 0.4;
      const hh = py * 0.38;
      g.fillStyle = '#e6ded0';
      g.fillRect(hx, hy, hw, hh);
      g.fillStyle = '#d3c9b8';
      g.fillRect(hx, hy, hw, py * 0.02);
      // Roof
      g.fillStyle = '#8e5a44';
      g.beginPath();
      g.moveTo(hx - px * 0.05, hy);
      g.lineTo(hx + hw / 2, hy - py * 0.2);
      g.lineTo(hx + hw + px * 0.05, hy);
      g.closePath();
      g.fill();
      // Chimney with a curl of smoke
      g.fillStyle = '#7d4f3c';
      g.fillRect(hx + hw * 0.72, hy - py * 0.19, px * 0.045, py * 0.15);
      g.strokeStyle = 'rgba(255,255,255,0.62)';
      g.lineWidth = Math.max(2, px * 0.007);
      for (let i = 0; i < 5; i++) {
        const smokeX = hx + hw * 0.74 + Math.sin(i * 1.3) * px * 0.02;
        g.beginPath();
        g.moveTo(smokeX, hy - py * (0.2 + i * 0.03));
        g.lineTo(smokeX + px * 0.02, hy - py * (0.215 + i * 0.03));
        g.stroke();
      }
      // Door and windows, lit from inside
      g.fillStyle = '#5e4632';
      g.fillRect(px * 0.455, hy + hh * 0.42, px * 0.09, hh * 0.58);
      g.fillStyle = '#d8b24a';
      g.beginPath();
      g.arc(px * 0.532, hy + hh * 0.72, px * 0.008, 0, Math.PI * 2);
      g.fill();
      for (const wx of [0.33, 0.62]) {
        g.fillStyle = '#f6df9a';
        g.fillRect(px * wx, hy + hh * 0.2, px * 0.1, hh * 0.28);
        g.strokeStyle = '#e6ded0';
        g.lineWidth = Math.max(2, px * 0.008);
        g.beginPath();
        g.moveTo(px * (wx + 0.05), hy + hh * 0.2);
        g.lineTo(px * (wx + 0.05), hy + hh * 0.48);
        g.moveTo(px * wx, hy + hh * 0.34);
        g.lineTo(px * (wx + 0.1), hy + hh * 0.34);
        g.stroke();
      }
      // A tree either side
      for (const tx of [0.1, 0.9]) {
        g.fillStyle = '#5c4327';
        g.fillRect(px * tx - px * 0.012, py * 0.56, px * 0.024, py * 0.18);
        g.fillStyle = '#4f7d3a';
        g.beginPath();
        g.arc(px * tx, py * 0.52, py * 0.1, 0, Math.PI * 2);
        g.fill();
      }
    } else if (kind === 'newcar') {
      // The staff snapshot: somebody grinning beside the car the bonus bought.
      g.fillStyle = '#e9e4d8';
      g.fillRect(0, 0, px, py);
      const iw = px * 0.9;
      const ih = py * 0.74;
      const ix = (px - iw) / 2;
      const iy = py * 0.05;
      const forecourt = g.createLinearGradient(0, iy, 0, iy + ih * 0.6);
      forecourt.addColorStop(0, '#6ea3d4');
      forecourt.addColorStop(1, '#c5dcea');
      g.fillStyle = forecourt;
      g.fillRect(ix, iy, iw, ih * 0.6);
      g.fillStyle = '#6b6f74';
      g.fillRect(ix, iy + ih * 0.6, iw, ih * 0.4);
      g.fillStyle = '#7a7f85';
      g.fillRect(ix, iy + ih * 0.6, iw, ih * 0.02);
      // Dealership bunting across the sky
      g.strokeStyle = '#f2f2f2';
      g.lineWidth = Math.max(1, px * 0.004);
      g.beginPath();
      g.moveTo(ix, iy + ih * 0.1);
      g.lineTo(ix + iw, iy + ih * 0.06);
      g.stroke();
      for (let i = 0; i < 11; i++) {
        const fx = ix + (iw * i) / 10;
        const fy = iy + ih * (0.1 - (i / 10) * 0.04);
        g.fillStyle = ['#d94b3f', '#e8c34a', '#3f7fd9'][i % 3];
        g.beginPath();
        g.moveTo(fx, fy);
        g.lineTo(fx + px * 0.016, fy);
        g.lineTo(fx + px * 0.008, fy + ih * 0.06);
        g.closePath();
        g.fill();
      }
      // The car: a low red saloon, three-quarter on
      const carX = ix + iw * 0.62;
      const carY = iy + ih * 0.78;
      const carW = iw * 0.52;
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath();
      g.ellipse(carX, carY + ih * 0.1, carW * 0.55, ih * 0.035, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#c0271e';
      g.beginPath();
      g.roundRect(carX - carW / 2, carY - ih * 0.12, carW, ih * 0.17, ih * 0.03);
      g.fill();
      g.beginPath();
      g.moveTo(carX - carW * 0.3, carY - ih * 0.11);
      g.lineTo(carX - carW * 0.16, carY - ih * 0.26);
      g.lineTo(carX + carW * 0.2, carY - ih * 0.26);
      g.lineTo(carX + carW * 0.32, carY - ih * 0.11);
      g.closePath();
      g.fill();
      g.fillStyle = '#9fc4dd';
      g.beginPath();
      g.moveTo(carX - carW * 0.25, carY - ih * 0.13);
      g.lineTo(carX - carW * 0.14, carY - ih * 0.235);
      g.lineTo(carX + carW * 0.17, carY - ih * 0.235);
      g.lineTo(carX + carW * 0.26, carY - ih * 0.13);
      g.closePath();
      g.fill();
      g.fillStyle = '#1a1a1c';
      for (const wx of [-0.3, 0.3]) {
        g.beginPath();
        g.arc(carX + carW * wx, carY + ih * 0.055, ih * 0.055, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#8d939b';
      for (const wx of [-0.3, 0.3]) {
        g.beginPath();
        g.arc(carX + carW * wx, carY + ih * 0.055, ih * 0.022, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#f4e7b0';
      g.fillRect(carX - carW / 2 - px * 0.004, carY - ih * 0.07, px * 0.022, ih * 0.035);
      // The employee, arm up, keys in hand
      const mx = ix + iw * 0.2;
      const groundY = carY + ih * 0.12;
      g.fillStyle = '#c98d63';
      g.beginPath();
      g.arc(mx, groundY - ih * 0.5, ih * 0.062, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#221a14';
      g.beginPath();
      g.arc(mx, groundY - ih * 0.53, ih * 0.064, Math.PI, 0);
      g.fill();
      g.strokeStyle = '#4a2e22';
      g.lineWidth = Math.max(2, px * 0.005);
      g.beginPath();
      g.arc(mx, groundY - ih * 0.495, ih * 0.03, 0.25, Math.PI - 0.25);
      g.stroke();
      g.fillStyle = '#2b2b2b';
      for (const ex of [-0.022, 0.022]) {
        g.beginPath();
        g.arc(mx + ih * ex, groundY - ih * 0.515, ih * 0.008, 0, Math.PI * 2);
        g.fill();
      }
      // Shirt and chinos — the floor uniform
      g.fillStyle = '#f2f2ee';
      g.fillRect(mx - ih * 0.062, groundY - ih * 0.44, ih * 0.124, ih * 0.19);
      g.fillStyle = '#33507d';
      g.fillRect(mx - ih * 0.062, groundY - ih * 0.25, ih * 0.055, ih * 0.25);
      g.fillRect(mx + ih * 0.007, groundY - ih * 0.25, ih * 0.055, ih * 0.25);
      g.fillStyle = '#1e1e20';
      g.fillRect(mx - ih * 0.068, groundY - ih * 0.02, ih * 0.062, ih * 0.02);
      g.fillRect(mx + ih * 0.006, groundY - ih * 0.02, ih * 0.062, ih * 0.02);
      // Near arm down, far arm thrown up with the keys
      g.strokeStyle = '#c98d63';
      g.lineWidth = ih * 0.028;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(mx - ih * 0.055, groundY - ih * 0.42);
      g.lineTo(mx - ih * 0.085, groundY - ih * 0.27);
      g.moveTo(mx + ih * 0.055, groundY - ih * 0.42);
      g.lineTo(mx + ih * 0.12, groundY - ih * 0.55);
      g.stroke();
      g.fillStyle = '#d8d8d8';
      g.beginPath();
      g.arc(mx + ih * 0.128, groundY - ih * 0.575, ih * 0.012, 0, Math.PI * 2);
      g.fill();
      // Caption on the mount below the photo
      g.fillStyle = '#2b2b2b';
      g.textAlign = 'center';
      g.font = 'bold ' + Math.round(py * 0.075) + 'px Georgia, serif';
      g.fillText('TOP CLOSER — Q3', px / 2, py * 0.92);
    } else if (kind === 'thumbsup') {
      // A staff photo of somebody delighted with very little. Dressed like the
      // rest of the floor: white shirt, sleeves to the wrist, dark tie.
      g.fillStyle = '#cfd6dd';
      g.fillRect(0, 0, px, py);
      g.fillStyle = '#b9c2cb';
      g.fillRect(0, py * 0.6, px, py * 0.4);
      const cx = px / 2;
      const headR = px * 0.115;
      const headY = py * 0.29;

      // Shirt
      g.fillStyle = '#f2f2ee';
      g.beginPath();
      g.moveTo(cx - px * 0.19, py * 0.8);
      g.lineTo(cx - px * 0.155, py * 0.44);
      g.lineTo(cx + px * 0.155, py * 0.44);
      g.lineTo(cx + px * 0.19, py * 0.8);
      g.closePath();
      g.fill();
      // Collar and tie
      g.fillStyle = '#e2e2dc';
      g.beginPath();
      g.moveTo(cx - px * 0.07, py * 0.435);
      g.lineTo(cx, py * 0.51);
      g.lineTo(cx + px * 0.07, py * 0.435);
      g.closePath();
      g.fill();
      g.fillStyle = '#7d2733';
      g.beginPath();
      g.moveTo(cx, py * 0.5);
      g.lineTo(cx - px * 0.028, py * 0.55);
      g.lineTo(cx, py * 0.75);
      g.lineTo(cx + px * 0.028, py * 0.55);
      g.closePath();
      g.fill();

      // The raised arm, in a SLEEVE — upper arm out, forearm up
      g.strokeStyle = '#f2f2ee';
      g.lineWidth = px * 0.072;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx + px * 0.13, py * 0.5);
      g.lineTo(cx + px * 0.215, py * 0.45);
      g.lineTo(cx + px * 0.2, py * 0.35);
      g.stroke();
      // Cuff, then the bare wrist below the hand
      g.strokeStyle = '#e2e2dc';
      g.lineWidth = px * 0.076;
      g.beginPath();
      g.moveTo(cx + px * 0.202, py * 0.365);
      g.lineTo(cx + px * 0.199, py * 0.335);
      g.stroke();

      // The hand: a closed fist, with the thumb laid up its SIDE at an angle.
      // Short, thick and offset — a long straight digit on top of a fist is
      // the other gesture entirely.
      const fx = cx + px * 0.198;
      const fy = py * 0.285;
      g.fillStyle = '#d59b73';
      g.beginPath();
      g.ellipse(fx, fy, px * 0.052, py * 0.042, 0, 0, Math.PI * 2);
      g.fill();
      // Curled fingers, drawn as two soft ridges across the fist
      g.strokeStyle = '#bd865f';
      g.lineWidth = px * 0.008;
      g.beginPath();
      g.moveTo(fx - px * 0.03, fy - py * 0.006);
      g.lineTo(fx + px * 0.03, fy - py * 0.004);
      g.moveTo(fx - px * 0.028, fy + py * 0.014);
      g.lineTo(fx + px * 0.028, fy + py * 0.016);
      g.stroke();
      // Thumb: up and outboard, thick, stopping well short of finger length
      g.strokeStyle = '#d59b73';
      g.lineWidth = px * 0.036;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(fx - px * 0.03, fy - py * 0.018);
      g.lineTo(fx - px * 0.052, fy - py * 0.06);
      g.stroke();

      // Head, hair, and a face that means it
      g.fillStyle = '#d59b73';
      g.beginPath();
      g.arc(cx, headY, headR, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2a1f18';
      g.beginPath();
      g.arc(cx, headY - headR * 0.26, headR * 0.99, Math.PI * 1.03, Math.PI * 1.97);
      g.fill();
      g.fillStyle = '#241a14';
      g.beginPath();
      g.arc(cx - headR * 0.36, headY - headR * 0.03, headR * 0.1, 0, Math.PI * 2);
      g.arc(cx + headR * 0.36, headY - headR * 0.03, headR * 0.1, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#241a14';
      g.lineWidth = px * 0.012;
      g.beginPath();
      g.arc(cx, headY + headR * 0.2, headR * 0.45, 0.22 * Math.PI, 0.78 * Math.PI);
      g.stroke();

      g.fillStyle = '#1d232a';
      g.fillRect(0, py * 0.83, px, py * 0.17);
      g.fillStyle = '#f2efe6';
      g.textAlign = 'center';
      g.font = 'bold ' + Math.round(py * 0.085) + 'px Impact, Arial Black, sans-serif';
      g.fillText("ALL IN A DAY'S WORK", px / 2, py * 0.945);
    } else if (kind === 'ourhome') {
      // The building, drawn with all the affection of a stock clipart licence
      g.fillStyle = '#9fb6cc';
      g.fillRect(0, 0, px, py);
      g.fillStyle = '#7f9a5c';
      g.fillRect(0, py * 0.7, px, py * 0.3);
      const bw = px * 0.44;
      const bh = py * 0.46;
      const bx = px / 2 - bw / 2;
      const by = py * 0.7 - bh;
      g.fillStyle = '#8c8f93';
      g.fillRect(bx, by, bw, bh);
      g.fillStyle = '#75787c';
      g.fillRect(bx + bw, by + py * 0.03, px * 0.05, bh - py * 0.03);
      // Windows, in a dull grid
      g.fillStyle = '#5d7285';
      const cols = 4;
      const rows = 5;
      for (let r = 0; r < rows; r++) {
        for (let cc = 0; cc < cols; cc++) {
          g.fillRect(bx + bw * (0.12 + cc * 0.22), by + bh * (0.1 + r * 0.16), bw * 0.13, bh * 0.09);
        }
      }
      // Door
      g.fillStyle = '#3f4c58';
      g.fillRect(px / 2 - bw * 0.07, py * 0.7 - bh * 0.12, bw * 0.14, bh * 0.12);
      g.fillStyle = '#f0f2f4';
      g.fillRect(bx, by, bw, py * 0.012);
      g.fillStyle = '#1d232a';
      g.textAlign = 'center';
      g.font = 'bold ' + Math.round(py * 0.095) + 'px Georgia, serif';
      g.fillText('OUR BELOVED HOME', px / 2, py * 0.88);
    } else {
      // Landscapes: banded sky, a sun, a horizon silhouette
      const palettes = {
        dunes: ['#f3c98b', '#e8a765', '#c9703c', '#8c4a2f'],
        coast: ['#bfe3f0', '#79c2dd', '#3f8fb5', '#1d4f6b'],
        peaks: ['#dfe7f2', '#a9bcd4', '#6d84a3', '#3c4a63']
      }[kind];
      for (let i = 0; i < 4; i++) {
        g.fillStyle = palettes[i];
        g.fillRect(0, (py * i) / 4, px, py / 4 + 1);
      }
      g.fillStyle = 'rgba(255,247,222,0.9)';
      g.beginPath();
      g.arc(px * 0.72, py * 0.28, py * 0.11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = palettes[3];
      g.beginPath();
      g.moveTo(0, py);
      for (let i = 0; i <= 10; i++) {
        const hx = (px * i) / 10;
        const hy = py * (kind === 'peaks' ? 0.5 + Math.abs(Math.sin(i * 1.1)) * 0.22 : 0.66 + Math.sin(i * 0.8) * 0.05);
        g.lineTo(hx, hy);
      }
      g.lineTo(px, py);
      g.closePath();
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshLambertMaterial({ map: tex });
    artMats.set(kind, mat);
  }

  const g2 = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.09, H + 0.09, 0.05), lam(0x2b2118));
  g2.add(frame);
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
  pic.position.z = 0.028;
  g2.add(pic);
  return g2;
}

/**
 * Potted plant. `kind` picks the silhouette: a tall rubber-plant on a
 * stem for corners, a low bushy fern for desks and counters, and a
 * half-dead one for the corners nobody waters. Radius is roughly
 * 0.24m for 'tall' and 0.2m otherwise, so callers can size colliders.
 */
export function flowerPot(kind: 'tall' | 'bushy' | 'dying' = 'bushy'): THREE.Group {
  const g = new THREE.Group();
  const dying = kind === 'dying';
  const potR = kind === 'tall' ? 0.17 : 0.145;
  const potH = kind === 'tall' ? 0.3 : 0.24;
  const clay = lam(dying ? 0x8a5a44 : 0xa8624a);

  // Tapered pot with a rim lip, and soil sunk just below it
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(potR, potR * 0.72, potH, 14), clay);
  pot.position.y = potH / 2;
  g.add(pot);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(potR * 1.07, potR * 1.07, 0.03, 14), clay);
  rim.position.y = potH - 0.012;
  g.add(rim);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(potR * 0.95, potR * 0.95, 0.02, 12), lam(0x2e241b));
  soil.position.y = potH - 0.022;
  g.add(soil);

  const leafMat = lam(dying ? 0x6d6a33 : kind === 'tall' ? 0x2f6b34 : 0x3d7f3a);
  const base = potH - 0.02;

  if (kind === 'tall') {
    // Woody stem with leaves paired off it, drooping a little further out
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.72, 8), lam(0x4a3a26));
    stem.position.y = base + 0.36;
    g.add(stem);
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const yaw = i * 2.4;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.015, 0.12), leafMat);
      leaf.position.set(Math.sin(yaw) * 0.12, base + 0.22 + t * 0.52, Math.cos(yaw) * 0.12);
      leaf.rotation.y = -yaw;
      leaf.rotation.z = -0.42 + t * 0.16;
      g.add(leaf);
    }
  } else {
    // Fronds fanning out of the soil, each a flattened box tipped outward
    const n = dying ? 6 : 9;
    for (let i = 0; i < n; i++) {
      const yaw = (i / n) * Math.PI * 2 + (i % 2) * 0.3;
      const len = (dying ? 0.2 : 0.3) + (i % 3) * 0.035;
      const tilt = dying ? 1.15 : 0.62;
      const frond = new THREE.Mesh(new THREE.BoxGeometry(len, 0.012, 0.08), leafMat);
      frond.position.set(
        Math.sin(yaw) * len * 0.42,
        base + Math.cos(tilt) * len * 0.42 + 0.03,
        Math.cos(yaw) * len * 0.42
      );
      frond.rotation.y = -yaw + Math.PI / 2;
      frond.rotation.x = dying ? tilt : -tilt;
      g.add(frond);
    }
    if (!dying) {
      // A few flower heads sitting up out of the foliage
      for (let i = 0; i < 4; i++) {
        const yaw = i * 1.7;
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.032, 7, 5),
          lam([0xd9556b, 0xe0a03c, 0xd9556b, 0xc8659e][i])
        );
        head.position.set(Math.sin(yaw) * 0.075, base + 0.15 + (i % 2) * 0.045, Math.cos(yaw) * 0.075);
        g.add(head);
      }
    } else {
      // Shed leaves collecting on the soil
      for (let i = 0; i < 4; i++) {
        const yaw = i * 1.9;
        const dead = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.008, 0.04), lam(0x6b5228));
        dead.position.set(Math.sin(yaw) * 0.07, base + 0.005, Math.cos(yaw) * 0.07);
        dead.rotation.y = yaw;
        g.add(dead);
      }
    }
  }
  return g;
}

/**
 * Low waiting-area coffee table: glass top on a wooden frame, with a
 * magazine shelf underneath. 1.0 x 0.55 footprint, 0.42 tall.
 */
export function coffeeTable(): THREE.Group {
  const g = new THREE.Group();
  const W = 1.0;
  const D = 0.55;
  const H = 0.42;
  const wood = lam(0x6f5741);
  // Glass top, sat proud of the frame
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(W, 0.02, D),
    new THREE.MeshStandardMaterial({
      color: 0x9fb6c4, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.42
    })
  );
  top.position.y = H;
  g.add(top);
  // Frame rails round the edge of the glass
  for (const sz of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 0.05), wood);
    rail.position.set(0, H - 0.035, sz * (D / 2 - 0.025));
    g.add(rail);
  }
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, D - 0.1), wood);
    rail.position.set(sx * (W / 2 - 0.025), H - 0.035, 0);
    g.add(rail);
  }
  // Legs and a lower shelf
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, H - 0.06, 0.05), wood);
      leg.position.set(sx * (W / 2 - 0.05), (H - 0.06) / 2, sz * (D / 2 - 0.05));
      g.add(leg);
    }
  }
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.16, 0.025, D - 0.16), wood);
  shelf.position.y = 0.13;
  g.add(shelf);
  // A couple of magazines fanned on the shelf
  for (let i = 0; i < 3; i++) {
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.008, 0.17),
      lam([0xc4553f, 0x3f6ac4, 0xd8c14a][i])
    );
    mag.position.set(-0.18 + i * 0.13, 0.148 + i * 0.009, (i % 2) * 0.05 - 0.02);
    mag.rotation.y = (Math.random() - 0.5) * 0.5;
    g.add(mag);
  }
  return g;
}

/** Office laser printer on a stand: paper tray, output shelf, control panel. */
export function printer(): THREE.Group {
  const g = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.62, 0.6), lam(0x33383f));
  stand.position.y = 0.31;
  g.add(stand);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.52, 0.64), lam(0xd7d9d4));
  body.position.y = 0.88;
  g.add(body);
  // Output shelf, scooped out of the top
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.44), lam(0xb9bcb7));
  shelf.position.set(0, 1.15, -0.04);
  g.add(shelf);
  const stack = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.02, 0.29), MAT.paper);
  stack.position.set(0.02, 1.175, -0.06);
  g.add(stack);
  // Paper tray sticking out the front (-Z)
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.09, 0.16), lam(0xc3c6c1));
  tray.position.set(0, 0.72, -0.36);
  g.add(tray);
  // Control panel, and a green ready lamp
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.11, 0.03), MAT.darkPlastic);
  panel.position.set(0.22, 1.03, -0.33);
  panel.rotation.x = -0.5;
  g.add(panel);
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.02, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x0a2a12, emissive: 0x35ff6a, emissiveIntensity: 1.4 })
  );
  lamp.position.set(0.15, 1.0, -0.34);
  g.add(lamp);
  return g;
}

/** Ceiling or wall air vent: louvred grille in a frame. */
export function vent(w = 0.6, h = 0.34): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), lam(0x9aa0a6));
  g.add(frame);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(w - 0.07, h - 0.07, 0.02), lam(0x14181c));
  inner.position.z = 0.012;
  g.add(inner);
  const slats = Math.max(3, Math.floor((h - 0.09) / 0.05));
  for (let i = 0; i < slats; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w - 0.09, 0.022, 0.03), lam(0x8f959b));
    s.position.set(0, -(h - 0.09) / 2 + 0.025 + i * ((h - 0.09) / slats), 0.02);
    s.rotation.x = -0.5;
    g.add(s);
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 6), MAT.chrome);
      screw.rotation.x = Math.PI / 2;
      screw.position.set((sx * (w - 0.03)) / 2, (sy * (h - 0.03)) / 2, 0.022);
      g.add(screw);
    }
  }
  return g;
}

/** Wall fire alarm: red pull station with a white bar. Purely scenery. */
export function fireAlarm(): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.19, 0.05), lam(0xb01c14));
  g.add(box);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.045, 0.02), lam(0xf0efe9));
  bar.position.set(0, -0.02, 0.033);
  g.add(bar);
  const lens = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.03, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x3a0a08, emissive: 0xff3020, emissiveIntensity: 0.5 })
  );
  lens.position.set(0, 0.062, 0.033);
  g.add(lens);
  return g;
}

/** Breakroom table with four chairs round it. */
export function breakTable(): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 20), lam(0xb9a888));
  top.position.y = 0.73;
  g.add(top);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10), MAT.chrome);
  col.position.y = 0.35;
  g.add(col);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.03, 16), MAT.midPlastic);
  foot.position.y = 0.015;
  g.add(foot);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const c = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), lam(0x46505c));
    seat.position.y = 0.45;
    c.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.05), lam(0x46505c));
    back.position.set(0, 0.68, 0.19);
    c.add(back);
    for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.45, 0.03), MAT.midPlastic);
      leg.position.set(lx, 0.225, lz);
      c.add(leg);
    }
    c.position.set(Math.cos(a) * 1.02, 0, Math.sin(a) * 1.02);
    c.rotation.y = -a + Math.PI / 2;
    g.add(c);
  }
  return g;
}

const snackMats = new Map<string, THREE.Material[]>();

/**
 * Vending snacks. Same six-face treatment as the chips box — every face
 * gets a canvas at its own aspect so nothing stretches.
 */
export function snack(kind: 'nutbar' | 'gumdrops' | 'cakes' | 'jerky'): THREE.Group {
  const spec = {
    nutbar: { w: 0.055, h: 0.19, d: 0.03, bg: '#6b4423', ink: '#f2e2c0', name: 'NUT\nSLAB', sub: 'now with nuts' },
    gumdrops: { w: 0.11, h: 0.16, d: 0.05, bg: '#127a5c', ink: '#eafff4', name: 'GUM\nDROPS', sub: 'chew responsibly' },
    cakes: { w: 0.15, h: 0.1, d: 0.07, bg: '#c2185b', ink: '#ffe9f2', name: 'CUBE\nCAKES', sub: 'six per pack' },
    jerky: { w: 0.1, h: 0.17, d: 0.035, bg: '#5d2f18', ink: '#f7d9a8', name: 'DESK\nJERKY', sub: 'meat-adjacent' }
  }[kind];

  let mats = snackMats.get(kind);
  if (!mats) {
    const face = (px: number, py: number, big: boolean): THREE.MeshLambertMaterial => {
      const c = document.createElement('canvas');
      c.width = Math.max(24, Math.round(px));
      c.height = Math.max(24, Math.round(py));
      const g2 = c.getContext('2d')!;
      g2.fillStyle = spec.bg;
      g2.fillRect(0, 0, c.width, c.height);
      g2.fillStyle = 'rgba(255,255,255,0.14)';
      g2.fillRect(0, c.height * 0.62, c.width, c.height * 0.14);
      if (big) {
        g2.fillStyle = spec.ink;
        g2.textAlign = 'center';
        const lines = spec.name.split('\n');
        const size = Math.min(c.width / 4.4, c.height / 4.2);
        g2.font = `bold ${size.toFixed(0)}px Impact, sans-serif`;
        lines.forEach((l, i) => g2.fillText(l, c.width / 2, c.height * 0.34 + i * size * 1.05));
        g2.font = `${Math.max(6, size * 0.34).toFixed(0)}px monospace`;
        g2.fillText(spec.sub, c.width / 2, c.height * 0.85);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.anisotropy = 4;
      return new THREE.MeshLambertMaterial({ map: tex });
    };
    const K = 2400; // pixels per metre — the labels have to be legible in hand
    const side = face(spec.d * K, spec.h * K, false);
    const end = face(spec.w * K, spec.d * K, false);
    const front = face(spec.w * K, spec.h * K, true);
    mats = [side, side, end, end, front, front];
    snackMats.set(kind, mats);
  }
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), mats);
  box.position.y = spec.h / 2;
  g.add(box);
  return g;
}

/**
 * Lateral file cabinet with real drawer fronts, recessed handles and a top
 * lip — the levels were drawing these as a single blank slab.
 * `w` x `d` footprint, `h` tall, split into `drawers` fronts facing -X — so
 * the bank runs along Z and yaw pi turns the drawers to face +X.
 */
export function fileCabinet(w = 0.6, h = 1.5, d = 2.4, drawers = 4): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(0x3c4148));
  shell.position.y = h / 2;
  g.add(shell);
  // Top lip
  const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, 0.025, d + 0.03), lam(0x2c3138));
  top.position.y = h + 0.008;
  g.add(top);
  // Kick plate
  const kick = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, 0.07, d - 0.06), lam(0x22262b));
  kick.position.y = 0.035;
  g.add(kick);
  // Drawer fronts down the long face (-X side), each with a handle
  const gap = 0.012;
  const usable = h - 0.11;
  const dh = usable / drawers - gap;
  for (let i = 0; i < drawers; i++) {
    const y = 0.08 + dh / 2 + i * (dh + gap);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.02, dh, d - 0.07), lam(0x474d55));
    front.position.set(-w / 2 - 0.008, y, 0);
    g.add(front);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.022, d * 0.34), MAT.chrome);
    handle.position.set(-w / 2 - 0.026, y + dh * 0.28, 0);
    g.add(handle);
    // Label holder
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 0.14), lam(0xd8d5c8));
    label.position.set(-w / 2 - 0.022, y - dh * 0.22, -d * 0.3);
    g.add(label);
  }
  return g;
}

/**
 * A stack of paperwork that reads as paper: sheets fanned at slightly
 * different angles rather than one solid block, with a clip on top.
 */
export function paperStack(sheets = 7, spread = 0.06): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < sheets; i++) {
    const s = new THREE.Mesh(
      new THREE.BoxGeometry(0.21, 0.0018, 0.288),
      i % 3 === 0 ? MAT.paperDim : MAT.paper
    );
    s.position.set((Math.random() - 0.5) * spread, i * 0.0022, (Math.random() - 0.5) * spread);
    s.rotation.y = (Math.random() - 0.5) * 0.28;
    g.add(s);
  }
  if (Math.random() < 0.5) {
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.004, 0.05), MAT.chrome);
    clip.position.set(-0.07, sheets * 0.0022 + 0.002, -0.1);
    clip.rotation.y = 0.2;
    g.add(clip);
  }
  return g;
}
/** A few sheets scattered flat on the floor, as if swept off a desk. */
export function scatteredPaper(count = 5, radius = 0.8): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * radius;
    const s = new THREE.Mesh(
      new THREE.BoxGeometry(0.21, 0.0016, 0.288),
      Math.random() < 0.3 ? MAT.paperDim : MAT.paper
    );
    s.position.set(Math.cos(a) * r, 0.001 + i * 0.0018, Math.sin(a) * r);
    s.rotation.y = Math.random() * Math.PI;
    s.rotation.z = (Math.random() - 0.5) * 0.05; // a slight curl off the floor
    g.add(s);
  }
  return g;
}


/** The drinks the machines actually stock, and what their cans look like. */
const DRINKS: { name: string; sub: string; body: string; band: string; ink: string }[] = [
  { name: 'DEADBULL', sub: 'IT GIVES YOU NOTHING', body: '#dfe3e8', band: '#1a3f8f', ink: '#f2f4f6' },
  { name: 'DR PUH', sub: '23 MYSTERY FLAVOURS', body: '#7a1d18', band: '#4a0f0c', ink: '#f6e3c8' },
  { name: 'COK', sub: 'THE REAL-ISH THING', body: '#c1121f', band: '#8b0d16', ink: '#fdfdfd' },
  { name: 'BERRY BALLS', sub: 'SPHERICAL FRUIT SODA', body: '#6b2fa0', band: '#431c68', ink: '#f0e2ff' },
  { name: 'LEMN', sub: 'CITRUS ADJACENT', body: '#e0c534', band: '#a8901c', ink: '#3a3208' },
  { name: 'GRAY WATER', sub: 'STILL. VERY STILL.', body: '#9aa6ad', band: '#697680', ink: '#1c2226' }
];

let vendFrontMat: THREE.MeshStandardMaterial | null = null;

/** Front graphic: lit shelves of named product behind the glass. */
function vendingFront(): THREE.MeshStandardMaterial {
  if (vendFrontMat) return vendFrontMat;
  // Drawn at 2x and sampled with NearestFilter: readable up close, and the
  // hard edges give the labels a deliberate pixel-art look rather than a
  // smeared one.
  const S = 2;
  const px = 260 * S;
  const py = 420 * S;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = py;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  x.scale(S, S);
  x.fillStyle = '#0e1a24';
  x.fillRect(0, 0, px, py);

  // Two shelves of cans up top, snacks in coils below
  const rows = 3;
  const perRow = 4;
  for (let r = 0; r < rows; r++) {
    const shelfY = 26 + r * 92;
    x.fillStyle = '#1d2a35';
    x.fillRect(6, shelfY + 74, px - 12, 6);
    for (let i = 0; i < perRow; i++) {
      const d = DRINKS[(r * perRow + i) % DRINKS.length];
      const cx = 20 + i * 58;
      // Can body
      x.fillStyle = d.body;
      x.fillRect(cx, shelfY, 40, 74);
      x.fillStyle = d.band;
      x.fillRect(cx, shelfY + 26, 40, 26);
      // Silver top and bottom
      x.fillStyle = '#c9ced4';
      x.fillRect(cx, shelfY, 40, 6);
      x.fillRect(cx, shelfY + 68, 40, 6);
      // Name down the can, rotated to fit
      x.save();
      x.translate(cx + 20, shelfY + 39);
      x.rotate(-Math.PI / 2);
      x.fillStyle = d.ink;
      x.textAlign = 'center';
      x.font = 'bold 15px Impact, Arial Black, sans-serif';
      x.fillText(d.name, 0, 5);
      x.restore();
      // Selection code under each slot
      x.fillStyle = '#7f8b95';
      x.font = 'bold 11px monospace';
      x.textAlign = 'center';
      x.fillText(`${String.fromCharCode(65 + r)}${i + 1}`, cx + 20, shelfY + 88);
    }
  }
  // Bottom row: snack bags on coils
  const snackY = 26 + rows * 92;
  x.fillStyle = '#1d2a35';
  x.fillRect(6, snackY + 62, px - 12, 6);
  const bagCols = ['#d2691e', '#6b4423', '#127a5c', '#c2185b'];
  for (let i = 0; i < 4; i++) {
    x.fillStyle = bagCols[i];
    x.fillRect(16 + i * 58, snackY + 6, 44, 54);
    x.fillStyle = 'rgba(255,255,255,0.22)';
    x.fillRect(16 + i * 58, snackY + 6, 44, 12);
    // Coil in front
    x.strokeStyle = '#5d666e';
    x.lineWidth = 2;
    x.beginPath();
    for (let t = 0; t < 8; t++) {
      x.moveTo(16 + i * 58, snackY + 12 + t * 6);
      x.lineTo(60 + i * 58, snackY + 15 + t * 6);
    }
    x.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  vendFrontMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0x2a3f55, emissiveIntensity: 0.65 });
  return vendFrontMat;
}

let vendSideMat: THREE.MeshLambertMaterial | null = null;

/** Branded flank for the machine cabinet. */
function vendingSide(): THREE.MeshLambertMaterial {
  if (vendSideMat) return vendSideMat;
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 840;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.scale(2, 2);
  const grad = g.createLinearGradient(0, 0, 0, 420);
  grad.addColorStop(0, '#243040');
  grad.addColorStop(1, '#161d27');
  g.fillStyle = grad;
  g.fillRect(0, 0, 200, 420);
  g.fillStyle = '#12306e';
  g.fillRect(0, 60, 200, 90);
  g.save();
  g.translate(100, 250);
  g.rotate(-Math.PI / 2);
  g.fillStyle = '#f0f3f6';
  g.textAlign = 'center';
  g.font = 'bold 34px Impact, Arial Black, sans-serif';
  g.fillText('REFRESH-O-MAT', 0, 0);
  g.font = 'bold 13px monospace';
  g.fillStyle = '#9fb6e8';
  g.fillText('COINS · CARD · REGRET', 0, 26);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  vendSideMat = new THREE.MeshLambertMaterial({ map: tex });
  return vendSideMat;
}

/**
 * Drinks and snack machine: lit product window with named stock behind
 * glass, a keypad with real buttons, coin slot, card reader, coin return
 * and a delivery flap.
 */
export function vendingMachine(): THREE.Group {
  const g = new THREE.Group();
  const W = 1.0;
  const D = 0.78;
  const H = 1.95;
  const side = vendingSide();
  const shell = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [
    side, side, lam(0x1a2029), lam(0x14181c), lam(0x1e2228), lam(0x1a2029)
  ]);
  shell.position.y = H / 2;
  g.add(shell);
  // Kick plate and levelling feet
  const kick = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.09, D - 0.06), lam(0x0d1116));
  kick.position.y = 0.045;
  g.add(kick);

  // Lit product window on the front (-Z)
  const win = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.62, H * 0.7), vendingFront());
  win.position.set(-W * 0.15, H * 0.58, -D / 2 - 0.005);
  win.rotation.y = Math.PI;
  g.add(win);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.64, H * 0.72),
    new THREE.MeshStandardMaterial({ color: 0xbfd6e6, transparent: true, opacity: 0.14, roughness: 0.06 })
  );
  glass.position.set(-W * 0.15, H * 0.58, -D / 2 - 0.014);
  glass.rotation.y = Math.PI;
  g.add(glass);
  // Window surround
  for (const [fw, fh, fx, fy] of [
    [W * 0.68, 0.04, -W * 0.15, H * 0.58 + (H * 0.72) / 2],
    [W * 0.68, 0.04, -W * 0.15, H * 0.58 - (H * 0.72) / 2],
    [0.04, H * 0.76, -W * 0.15 - (W * 0.64) / 2, H * 0.58],
    [0.04, H * 0.76, -W * 0.15 + (W * 0.64) / 2, H * 0.58]
  ] as const) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.03), lam(0x2c3138));
    f.position.set(fx, fy, -D / 2 - 0.018);
    g.add(f);
  }

  // Control column: keypad, coin slot, card reader, coin return
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.03), lam(0x2c3138));
  pad.position.set(W * 0.33, H * 0.66, -D / 2 - 0.014);
  g.add(pad);
  const codes = ['A', 'B', 'C', '1', '2', '3', '4', '5'];
  codes.forEach((_, i) => {
    const btn = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.038, 0.014), lam(i < 3 ? 0xb8b23a : 0x9aa1a8));
    btn.position.set(W * 0.28 + (i % 2) * 0.09, H * 0.92 - Math.floor(i / 2) * 0.06, -D / 2 - 0.026);
    g.add(btn);
  });
  const readout = new THREE.Mesh(
    new THREE.BoxGeometry(0.17, 0.06, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x0a1a10, emissive: 0x35ff6a, emissiveIntensity: 1.1 })
  );
  readout.position.set(W * 0.33, H * 0.53, -D / 2 - 0.024);
  g.add(readout);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.012), MAT.chrome);
  slot.position.set(W * 0.36, H * 0.44, -D / 2 - 0.024);
  g.add(slot);
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.02), lam(0x1c2026));
  card.position.set(W * 0.31, H * 0.37, -D / 2 - 0.026);
  g.add(card);
  const coinReturn = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.02), lam(0x0d1116));
  coinReturn.position.set(W * 0.32, 0.5, -D / 2 - 0.022);
  g.add(coinReturn);

  // Delivery flap with a rubber lip
  const flap = new THREE.Mesh(new THREE.BoxGeometry(W * 0.58, 0.24, 0.03), lam(0x0d1116));
  flap.position.set(-W * 0.15, 0.3, -D / 2 - 0.016);
  g.add(flap);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(W * 0.6, 0.03, 0.05), lam(0x25292f));
  lip.position.set(-W * 0.15, 0.43, -D / 2 - 0.02);
  g.add(lip);

  // Lit header
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.94, 0.22, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x12306e, emissive: 0x2b5fd0, emissiveIntensity: 0.9 })
  );
  strip.position.set(0, H - 0.16, -D / 2 - 0.014);
  g.add(strip);
  return g;
}

/** Countertop microwave: door with a window, handle, keypad, vents. */
export function microwave(): THREE.Group {
  const g = new THREE.Group();
  const W = 0.52;
  const H = 0.31;
  const D = 0.38;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lam(0xd3d6d1));
  body.position.y = H / 2;
  g.add(body);
  // Door on the front (-Z), with a dark mesh window
  const door = new THREE.Mesh(new THREE.BoxGeometry(W * 0.68, H - 0.03, 0.02), lam(0xc4c8c3));
  door.position.set(-W * 0.14, H / 2, -D / 2 - 0.012);
  g.add(door);
  const win = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, H - 0.11, 0.014), lam(0x14181b));
  win.position.set(-W * 0.14, H / 2 + 0.015, -D / 2 - 0.024);
  g.add(win);
  const meshFront = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.46, H - 0.13),
    new THREE.MeshLambertMaterial({ color: 0x2e3438 })
  );
  meshFront.position.set(-W * 0.14, H / 2 + 0.015, -D / 2 - 0.032);
  meshFront.rotation.y = Math.PI;
  g.add(meshFront);
  // Handle
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, H - 0.08, 0.03), lam(0x8f959b));
  handle.position.set(W * 0.16, H / 2, -D / 2 - 0.04);
  g.add(handle);
  // Keypad and display
  const pad = new THREE.Mesh(new THREE.BoxGeometry(W * 0.2, H - 0.05, 0.015), lam(0x2c3138));
  pad.position.set(W * 0.34, H / 2, -D / 2 - 0.014);
  g.add(pad);
  const disp = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.16, 0.035, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x0a1a10, emissive: 0x35d86a, emissiveIntensity: 1.0 })
  );
  disp.position.set(W * 0.34, H * 0.78, -D / 2 - 0.024);
  g.add(disp);
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.022, 0.01), lam(0x9aa1a8));
    b.position.set(W * 0.29 + (i % 2) * 0.045, H * 0.6 - Math.floor(i / 2) * 0.045, -D / 2 - 0.023);
    g.add(b);
  }
  // Cooling vents down the side
  for (let i = 0; i < 5; i++) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, D * 0.5), lam(0xa8aca7));
    v.position.set(W / 2 + 0.004, H * 0.3 + i * 0.032, 0.02);
    g.add(v);
  }
  return g;
}

/** Stainless sink set into a run of counter: bowl, mixer tap, dirty plates. */
export function kitchenSink(): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bdc2, roughness: 0.28, metalness: 0.85 });
  // Draining board and rim
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.03, 0.52), steel);
  rim.position.y = 0.015;
  g.add(rim);
  // Bowl: four walls and a base, so it reads as recessed
  const bw = 0.44;
  const bd = 0.36;
  const bh = 0.17;
  for (const [w, d, x, z] of [
    [bw, 0.02, -0.16, -bd / 2], [bw, 0.02, -0.16, bd / 2],
    [0.02, bd, -0.16 - bw / 2, 0], [0.02, bd, -0.16 + bw / 2, 0]
  ] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, bh, d), steel);
    wall.position.set(x, -bh / 2, z);
    g.add(wall);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.02, bd), steel);
  base.position.set(-0.16, -bh, 0);
  g.add(base);
  const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 12), lam(0x6e757b));
  drain.position.set(-0.16, -bh + 0.012, 0);
  g.add(drain);
  // Draining grooves on the right half
  for (let i = 0; i < 5; i++) {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.36), lam(0x9aa1a6));
    groove.position.set(0.16 + i * 0.05, 0.028, 0);
    g.add(groove);
  }
  // Mixer tap
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.26, 10), steel);
  spout.position.set(-0.16, 0.14, -0.21);
  g.add(spout);
  const neck = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.017, 6, 12, Math.PI / 2), steel);
  neck.position.set(-0.16, 0.27, -0.12);
  neck.rotation.set(0, Math.PI / 2, 0);
  g.add(neck);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.02), steel);
  lever.position.set(-0.07, 0.24, -0.21);
  lever.rotation.z = 0.35;
  g.add(lever);
  // Somebody's washing up, left in the bowl
  const plateMat = lam(0xe8e6de);
  for (let i = 0; i < 3; i++) {
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.105, 0.014, 16), plateMat);
    plate.position.set(-0.16 + (Math.random() - 0.5) * 0.08, -bh + 0.03 + i * 0.018, (Math.random() - 0.5) * 0.08);
    plate.rotation.z = (Math.random() - 0.5) * 0.25;
    g.add(plate);
  }
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 12), lam(0xb4463c));
  mug.position.set(-0.05, -bh + 0.07, 0.1);
  mug.rotation.z = 1.2;
  g.add(mug);
  return g;
}

/** A run of wall cupboards above a counter. */
export function wallCupboards(width = 1.8): THREE.Group {
  const g = new THREE.Group();
  const doors = Math.max(2, Math.round(width / 0.6));
  const carcass = new THREE.Mesh(new THREE.BoxGeometry(width, 0.6, 0.34), lam(0x9a8a70));
  g.add(carcass);
  const dw = (width - 0.04) / doors;
  for (let i = 0; i < doors; i++) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(dw - 0.02, 0.56, 0.02), lam(0xb0a086));
    door.position.set(-width / 2 + 0.02 + dw / 2 + i * dw, 0, -0.18);
    g.add(door);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.012), MAT.chrome);
    handle.position.set(door.position.x + dw / 2 - 0.06, -0.18, -0.2);
    g.add(handle);
  }
  return g;
}

// ---------------------------------------------------------------- washrooms

const ceramic = new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.22, metalness: 0.04 });

/**
 * Toilet, tank at the back. Built so local -Z is the wall side: place it with
 * the yaw of the wall it stands against and the pan faces out into the room.
 */
export function toilet(): THREE.Group {
  const g = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.58, 0.18), ceramic);
  tank.position.set(0, 0.72, -0.1);
  g.add(tank);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.04, 0.21), ceramic);
  lid.position.set(0, 1.03, -0.1);
  g.add(lid);
  // Pedestal, narrowing towards the floor the way a real one does
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.42, 12), ceramic);
  foot.position.set(0, 0.21, 0.06);
  g.add(foot);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.2, 16), ceramic);
  bowl.position.set(0, 0.52, 0.08);
  g.add(bowl);
  // Seat ring, with the lid standing up behind it
  const seat = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.028, 8, 20), lam(0xe6e4de));
  seat.rotation.x = Math.PI / 2;
  seat.position.set(0, 0.63, 0.08);
  g.add(seat);
  const seatLid = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.035, 0.42), lam(0xe6e4de));
  seatLid.position.set(0, 0.85, -0.16);
  seatLid.rotation.x = -0.28;
  g.add(seatLid);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), MAT.chrome);
  handle.position.set(-0.17, 0.95, 0);
  g.add(handle);
  return g;
}

/** Roll on a wall bracket, mounted at its own origin. */
export function toiletPaper(spare = false): THREE.Group {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), MAT.chrome);
  bar.rotation.z = Math.PI / 2;
  g.add(bar);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.11, 14), MAT.paper);
  roll.rotation.z = Math.PI / 2;
  g.add(roll);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.118, 8), lam(0xa78b63));
  core.rotation.z = Math.PI / 2;
  g.add(core);
  // The loose sheet hanging off it, which is most of what sells the shape
  const tail = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, 0.14),
    new THREE.MeshLambertMaterial({ color: 0xe9e7dd, side: THREE.DoubleSide })
  );
  tail.position.set(0, -0.11, 0.05);
  g.add(tail);
  if (spare) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.11, 14), MAT.paper);
    s.rotation.z = Math.PI / 2;
    s.position.set(0, -0.21, 0);
    g.add(s);
  }
  return g;
}

/**
 * A run of washroom vanity: counter, recessed basins, taps. Local -Z is the
 * wall side.
 */
export function bathroomVanity(width = 1.6, basins = 2): THREE.Group {
  const g = new THREE.Group();
  const counter = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, 0.52), lam(0x3b3f45));
  counter.position.set(0, 0.85, 0);
  g.add(counter);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(width - 0.06, 0.79, 0.46), lam(0x6d5f4c));
  cab.position.set(0, 0.43, -0.02);
  g.add(cab);
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bdc2, roughness: 0.3, metalness: 0.8 });
  for (let i = 0; i < basins; i++) {
    const x = basins === 1 ? 0 : -width / 2 + width * ((i + 0.5) / basins);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.11, 0.13, 16, 1, true), ceramic);
    bowl.position.set(x, 0.82, 0.02);
    g.add(bowl);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 16), ceramic);
    base.position.set(x, 0.762, 0.02);
    g.add(base);
    // Tap: a riser and a spout reaching out over the basin
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.15, 8), steel);
    riser.position.set(x, 0.95, -0.17);
    g.add(riser);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.15, 8), steel);
    spout.rotation.x = Math.PI / 2;
    spout.position.set(x, 1.02, -0.11);
    g.add(spout);
  }
  return g;
}

/**
 * Wall mirror. There is no reflection — a real one needs a second render —
 * but a dark, near-smooth metal panel catches the agents' torches the way
 * glass does, and in an unlit washroom that is the whole effect.
 */
export function mirrorPanel(w = 1.5, h = 0.9): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.03), lam(0x9aa1a8));
  g.add(frame);
  // Metalness 0.95 with nothing in the scene to reflect gives a black slab —
  // a mirror-metal reflecting an empty environment reflects nothing. A pale,
  // mostly dielectric surface with a tight clearcoat highlight reads as glass
  // instead, and still catches the torches.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshPhysicalMaterial({
      color: 0xc3d0d7,
      roughness: 0.05,
      metalness: 0.08,
      reflectivity: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      emissive: 0x2b3a44,
      emissiveIntensity: 0.55
    })
  );
  glass.position.z = 0.019;
  g.add(glass);
  return g;
}

// ------------------------------------------------------------- break rooms

/** Bottled water cooler: jug, body, two taps and a drip tray. */
export function waterCooler(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.92, 0.34), lam(0xd8dade));
  body.position.y = 0.46;
  g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.1, 14), lam(0xc9ccd1));
  neck.position.y = 0.96;
  g.add(neck);
  // The jug, upended into the top
  const jug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.13, 0.42, 16),
    new THREE.MeshLambertMaterial({ color: 0x6fa8c8, transparent: true, opacity: 0.65 })
  );
  jug.position.y = 1.21;
  g.add(jug);
  const jugNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.09, 12), lam(0x8fc2dd));
  jugNeck.position.y = 0.98;
  g.add(jugNeck);
  const taps: [number, number][] = [
    [-0.07, 0x3f6ea8],
    [0.07, 0xa8443f]
  ];
  for (const [x, c] of taps) {
    const tap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.06), lam(c));
    tap.position.set(x, 0.7, 0.19);
    g.add(tap);
  }
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.1), MAT.steel);
  tray.position.set(0, 0.56, 0.2);
  g.add(tray);
  return g;
}

/** Kitchen fridge, door on +Z. */
export function fridge(): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0xc6cace, roughness: 0.42, metalness: 0.45 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.72, 0.66), shell);
  body.position.y = 0.86;
  g.add(body);
  // The seam between freezer and fridge, with a handle on each
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.69, 0.015, 0.02), lam(0x8c9196));
  seam.position.set(0, 1.24, 0.335);
  g.add(seam);
  for (const y of [1.36, 0.86]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.26, 8), MAT.chrome);
    handle.position.set(0.26, y, 0.35);
    g.add(handle);
  }
  return g;
}

// ------------------------------------------------------------------ office

/** Plain office desk: top, modesty panel and a pedestal of drawers. */
export function officeDesk(w = 1.5): THREE.Group {
  const g = new THREE.Group();
  const wood = lam(0x7d6a52);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.75), wood);
  top.position.y = 0.72;
  g.add(top);
  const modesty = new THREE.Mesh(new THREE.BoxGeometry(w - 0.12, 0.4, 0.03), lam(0x6b5a45));
  modesty.position.set(0, 0.5, -0.33);
  g.add(modesty);
  const ped = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.68, 0.6), wood);
  ped.position.set(w / 2 - 0.26, 0.34, 0);
  g.add(ped);
  for (let i = 0; i < 3; i++) {
    const pull = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), MAT.steel);
    pull.position.set(w / 2 - 0.26, 0.15 + i * 0.2, 0.31);
    g.add(pull);
  }
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), MAT.midPlastic);
  leg.position.set(-w / 2 + 0.08, 0.35, 0.3);
  g.add(leg);
  const leg2 = leg.clone();
  leg2.position.z = -0.3;
  g.add(leg2);
  return g;
}

const signMats = new Map<string, THREE.MeshLambertMaterial>();

/**
 * The engraved plaque beside a door. Cached per label, because a floor has a
 * lot of doors and most of them say the same few things.
 */
export function roomSign(label: string, sub = ''): THREE.Group {
  const key = label + '|' + sub;
  let mat = signMats.get(key);
  if (!mat) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2c3138';
    g.fillRect(0, 0, 256, 96);
    g.strokeStyle = '#6f7780';
    g.lineWidth = 3;
    g.strokeRect(5, 5, 246, 86);
    g.fillStyle = '#e8e4d8';
    g.textAlign = 'center';
    g.font = 'bold 40px Arial, Helvetica, sans-serif';
    g.fillText(label, 128, sub ? 47 : 60);
    if (sub) {
      g.font = '24px Arial, Helvetica, sans-serif';
      g.fillStyle = '#a9b0b8';
      g.fillText(sub, 128, 78);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshLambertMaterial({ map: tex });
    signMats.set(key, mat);
  }
  const g2 = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.012), lam(0x22262b));
  g2.add(plate);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), mat);
  face.position.z = 0.008;
  g2.add(face);
  return g2;
}

let comicMat: THREE.MeshLambertMaterial | null = null;

/**
 * The comic's cover, drawn rather than typeset: a speed-line burst, a caped
 * figure mid-punch, and the title over the top. A block of colour with a
 * title on it reads as a textbook; the figure is what makes it a comic at a
 * glance, which is all you ever get of a prop on a break-room table.
 */
function comicCover(): THREE.MeshLambertMaterial {
  if (comicMat) return comicMat;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 176;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f0b429';
  g.fillRect(0, 0, 128, 176);

  // Speed lines radiating from behind him
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 3;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 26, 96 + Math.sin(a) * 26);
    g.lineTo(64 + Math.cos(a) * 90, 96 + Math.sin(a) * 90);
    g.stroke();
  }

  // Cape, thrown out behind him
  g.fillStyle = '#8f1d2f';
  g.beginPath();
  g.moveTo(58, 74);
  g.lineTo(20, 104);
  g.lineTo(38, 112);
  g.lineTo(30, 138);
  g.lineTo(64, 116);
  g.closePath();
  g.fill();

  // Torso, legs, and the fist coming at you
  g.fillStyle = '#1f4fa0';
  g.beginPath();
  g.moveTo(52, 72);
  g.lineTo(78, 72);
  g.lineTo(84, 116);
  g.lineTo(48, 116);
  g.closePath();
  g.fill();
  g.fillStyle = '#16326a';
  g.fillRect(52, 114, 12, 34);
  g.fillRect(68, 114, 12, 30);
  g.fillStyle = '#d9a066';
  g.beginPath();
  g.arc(66, 60, 13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2a1a12';
  g.beginPath();
  g.arc(66, 54, 13, Math.PI * 1.05, Math.PI * 1.95);
  g.fill();
  // Mask band
  g.fillStyle = '#1f4fa0';
  g.fillRect(54, 56, 24, 7);
  // The punching arm, foreshortened, with an oversized fist
  g.strokeStyle = '#d9a066';
  g.lineWidth = 11;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(76, 82);
  g.lineTo(94, 92);
  g.stroke();
  g.fillStyle = '#e0aa73';
  g.beginPath();
  g.arc(99, 94, 13, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8a5a34';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(90, 90);
  g.lineTo(108, 90);
  g.moveTo(90, 96);
  g.lineTo(108, 96);
  g.stroke();
  // A little chest emblem: a handset
  g.fillStyle = '#f0b429';
  g.beginPath();
  g.arc(65, 86, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#16326a';
  g.fillRect(61, 82, 8, 3);
  g.fillRect(61, 89, 8, 3);
  g.fillRect(60, 82, 3, 10);

  // Title, and the strapline in a banner along the bottom
  g.fillStyle = '#d3172c';
  g.fillRect(0, 4, 128, 30);
  g.fillStyle = '#ffe9a8';
  g.textAlign = 'center';
  g.font = 'bold 21px Impact, Arial Black, sans-serif';
  g.fillText('CAPTAIN', 64, 20);
  g.font = 'bold 15px Impact, Arial Black, sans-serif';
  g.fillText('V O I P', 64, 32);
  g.fillStyle = '#16326a';
  g.fillRect(0, 152, 128, 24);
  g.fillStyle = '#ffffff';
  g.font = 'bold 11px Arial, sans-serif';
  g.fillText('ISSUE #12 - HOLD MUSIC!', 64, 168);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  comicMat = new THREE.MeshLambertMaterial({ map: tex });
  return comicMat;
}

/** Desk monitor on a stand — dark, because nothing on this floor has power. */
export function deskMonitor(): THREE.Group {
  const g = new THREE.Group();
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.14), MAT.darkPlastic);
  foot.position.y = 0.008;
  g.add(foot);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), MAT.darkPlastic);
  stem.position.y = 0.09;
  g.add(stem);
  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.33, 0.035), MAT.darkPlastic);
  shell.position.y = 0.33;
  g.add(shell);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.48, 0.29),
    new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.18, metalness: 0.5 })
  );
  face.position.set(0, 0.33, 0.019);
  g.add(face);
  const kb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.15), MAT.darkPlastic);
  kb.position.set(0, 0.01, 0.28);
  g.add(kb);
  return g;
}

const plateMats = new Map<string, THREE.MeshLambertMaterial>();

/** The little angled wedge with somebody's name on it, for a desk. */
export function namePlate(name: string, role = ''): THREE.Group {
  let mat = plateMats.get(name);
  if (!mat) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1f242a';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#e8e2d2';
    g.textAlign = 'center';
    g.font = 'bold 30px Georgia, serif';
    g.fillText(name, 128, role ? 30 : 42);
    if (role) {
      g.fillStyle = '#9aa2ab';
      g.font = '18px Georgia, serif';
      g.fillText(role, 128, 52);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshLambertMaterial({ map: tex });
    plateMats.set(name, mat);
  }
  const g2 = new THREE.Group();
  const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.075, 0.05), lam(0x2a2f35));
  wedge.position.set(0, 0.038, 0);
  wedge.rotation.x = -0.32;
  g2.add(wedge);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.06), mat);
  face.position.set(0, 0.04, 0.028);
  face.rotation.x = -0.32;
  g2.add(face);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.07), lam(0x22262b));
  foot.position.y = 0.006;
  g2.add(foot);
  return g2;
}

/** Desk phone with a handset across the cradle. */
export function deskPhone(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.22), MAT.darkPlastic);
  base.position.y = 0.025;
  base.rotation.x = -0.12;
  g.add(base);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.09), lam(0x4a5058));
  pad.position.set(0.04, 0.055, 0.05);
  g.add(pad);
  const handset = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.045, 0.21), MAT.midPlastic);
  handset.position.set(-0.065, 0.07, 0);
  g.add(handset);
  for (const z of [-0.085, 0.085]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.05), MAT.midPlastic);
    ear.position.set(-0.065, 0.055, z);
    g.add(ear);
  }
  return g;
}

/** Tower unit, for under a desk. */
export function pcTower(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.44, 0.46), lam(0x2f343a));
  body.position.y = 0.22;
  g.add(body);
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.4, 0.42), lam(0x3d434a));
  face.position.set(0.105, 0.22, 0);
  g.add(face);
  const bay = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.3), lam(0x22262b));
  bay.position.set(0.113, 0.36, 0);
  g.add(bay);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.012), lam(0x1b3a1f));
  led.position.set(0.113, 0.29, 0.12);
  g.add(led);
  return g;
}
