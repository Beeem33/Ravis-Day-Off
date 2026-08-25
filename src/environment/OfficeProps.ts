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
  const cover = bookCover(spec.t, spec.bg, spec.ink, spec.k);
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

let chipsMat: THREE.MeshLambertMaterial | null = null;

/** PRINTED CHIPS — the vending-machine snack. A boxed, extruded crisp. */
export function chipsBox(): THREE.Group {
  if (!chipsMat) {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#f2a13a');
    grad.addColorStop(1, '#d2691e');
    g.fillStyle = grad;
    g.fillRect(0, 0, 200, 128);
    // A crisp being extruded off a little printer nozzle
    g.fillStyle = '#4a4a52';
    g.fillRect(84, 14, 32, 16);
    g.beginPath();
    g.moveTo(92, 30);
    g.lineTo(108, 30);
    g.lineTo(102, 44);
    g.lineTo(98, 44);
    g.closePath();
    g.fill();
    g.fillStyle = '#f7dd8a';
    g.beginPath();
    g.ellipse(100, 62, 26, 15, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c98a2a';
    g.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.moveTo(100 + i * 9, 50);
      g.lineTo(100 + i * 9, 74);
      g.stroke();
    }
    g.fillStyle = '#2a1a10';
    g.font = 'bold 22px Impact, sans-serif';
    g.textAlign = 'center';
    g.fillText('PRINTED CHIPS', 100, 100);
    g.font = 'bold 9px monospace';
    g.fillText('100% EXTRUDED · 0% POTATO', 100, 115);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    chipsMat = new THREE.MeshLambertMaterial({ map: tex });
  }
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.24, 0.07), chipsMat);
  box.position.y = 0.12;
  g.add(box);
  return g;
}

/**
 * Lateral file cabinet with real drawer fronts, recessed handles and a top
 * lip — the levels were drawing these as a single blank slab.
 * `w` x `d` footprint, `h` tall, split into `drawers` fronts facing -Z.
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

let vendFrontMat: THREE.MeshStandardMaterial | null = null;

/**
 * Snack vending machine: dark cabinet, lit product window with rows of
 * product, keypad and delivery flap. `w` x `d` footprint, 1.95 tall.
 */
export function vendingMachine(): THREE.Group {
  const g = new THREE.Group();
  const W = 1.0;
  const D = 0.78;
  const H = 1.95;
  // Cabinet: sides, top, back
  const shell = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lam(0x1e2228));
  shell.position.y = H / 2;
  g.add(shell);
  // Lit product window on the front (-Z)
  if (!vendFrontMat) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 160;
    const x = c.getContext('2d')!;
    x.fillStyle = '#0e1a24';
    x.fillRect(0, 0, 96, 160);
    // Shelves of product in assorted wrappers
    const cols = ['#c8483c', '#e0a53a', '#3f8a55', '#2f6f9e', '#b0553f', '#7a4f8c'];
    for (let row = 0; row < 6; row++) {
      x.fillStyle = '#26323c';
      x.fillRect(4, 8 + row * 25, 88, 3);
      for (let col = 0; col < 5; col++) {
        x.fillStyle = cols[(row * 5 + col) % cols.length];
        x.fillRect(7 + col * 17, 12 + row * 25, 13, 17);
        x.fillStyle = 'rgba(255,255,255,0.25)';
        x.fillRect(7 + col * 17, 12 + row * 25, 13, 4);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    vendFrontMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0x2a3f55, emissiveIntensity: 0.55 });
  }
  const win = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.62, H * 0.68), vendFrontMat);
  win.position.set(-W * 0.14, H * 0.58, -D / 2 - 0.005);
  win.rotation.y = Math.PI;
  g.add(win);
  // Glass over it
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.64, H * 0.7),
    new THREE.MeshStandardMaterial({ color: 0xbfd6e6, transparent: true, opacity: 0.16, roughness: 0.1 })
  );
  glass.position.set(-W * 0.14, H * 0.58, -D / 2 - 0.012);
  glass.rotation.y = Math.PI;
  g.add(glass);
  // Keypad column, delivery flap, branding strip
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.03), lam(0x2c3138));
  pad.position.set(W * 0.34, H * 0.62, -D / 2 - 0.01);
  g.add(pad);
  for (let i = 0; i < 8; i++) {
    const btn = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.012), lam(0x8c9299));
    btn.position.set(W * 0.3 + (i % 2) * 0.07, H * 0.8 - Math.floor(i / 2) * 0.07, -D / 2 - 0.02);
    g.add(btn);
  }
  const flap = new THREE.Mesh(new THREE.BoxGeometry(W * 0.6, 0.22, 0.03), lam(0x14181d));
  flap.position.set(-W * 0.14, 0.28, -D / 2 - 0.012);
  g.add(flap);
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.94, 0.2, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x12306e, emissive: 0x2b5fd0, emissiveIntensity: 0.8 })
  );
  strip.position.set(0, H - 0.16, -D / 2 - 0.012);
  g.add(strip);
  return g;
}
