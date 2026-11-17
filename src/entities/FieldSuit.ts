import * as THREE from 'three';

/**
 * The field suit of Level 15: white hard-shell armour over a black undersuit,
 * a full helmet with a gold visor.
 *
 * Nothing here is a primitive dropped in place. The body is lofted: each
 * part (torso, legs, arms, hands, boots, helmet) is a skin stretched over a
 * run of cross-sections along a path, the sections rounded squares rather
 * than circles, so the limbs flow into the trunk with no joints to gap. The
 * armour is plates raised off those same skins — each a patch of the surface
 * lifted to a height, its edges rolled over and sunk back into the body, with
 * chamfered corners and panel lines cut in — so every plate hugs what it sits
 * on. Built standing, feet at the origin, facing +Z.
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);

/** One cross-section: centre, half-width, half-depth, and how square it is (2 an ellipse, 4 nearly a box). */
type Ring = [x: number, y: number, z: number, rx: number, rz: number, n?: number];

interface Sample {
  c: THREE.Vector3;
  rx: number;
  rz: number;
  n: number;
  q: THREE.Quaternion;
}

/**
 * A run of cross-sections, made smooth: the rings are joined by a spline, and
 * a frame is carried along it without twisting, so a path can bend (up an arm
 * and over a shoulder) and its "front" stays its front.
 */
class Path {
  private T: Sample[] = [];
  private static N = 96;

  constructor(rings: Ring[], q0?: THREE.Quaternion) {
    const n = rings.length;
    const get = (i: number, j: number): number => {
      const r = rings[Math.min(n - 1, Math.max(0, i))];
      return j === 5 ? r[5] ?? 2 : (r[j] as number);
    };
    const cr = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
      0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    for (let k = 0; k <= Path.N; k++) {
      const f = (k / Path.N) * (n - 1);
      const i = Math.min(n - 2, Math.floor(f));
      const t = f - i;
      const v = [0, 1, 2, 3, 4, 5].map((j) => cr(get(i - 1, j), get(i, j), get(i + 1, j), get(i + 2, j), t));
      this.T.push({ c: V(v[0], v[1], v[2]), rx: Math.max(0.001, v[3]), rz: Math.max(0.001, v[4]), n: Math.max(2, v[5]), q: new THREE.Quaternion() });
    }
    // Frames: the first from straight up (or as given), each next turned by as little as takes one tangent to the next
    const tan = (k: number): THREE.Vector3 =>
      this.T[Math.min(Path.N, k + 1)].c
        .clone()
        .sub(this.T[Math.max(0, k - 1)].c)
        .normalize();
    let prev = tan(0);
    this.T[0].q.copy(q0 ?? new THREE.Quaternion().setFromUnitVectors(Y, prev));
    for (let k = 1; k <= Path.N; k++) {
      const t = tan(k);
      this.T[k].q.copy(new THREE.Quaternion().setFromUnitVectors(prev, t).multiply(this.T[k - 1].q));
      prev = t;
    }
  }

  at(v: number): Sample {
    const f = Math.min(1, Math.max(0, v)) * Path.N;
    const i = Math.min(Path.N - 1, Math.floor(f));
    const t = f - i;
    const a = this.T[i];
    const b = this.T[i + 1];
    return { c: a.c.clone().lerp(b.c, t), rx: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t, n: a.n + (b.n - a.n) * t, q: a.q.clone().slerp(b.q, t) };
  }

  /** A point on the skin at `v` along and `phi` round (0 the front, toward +X), `grow` out from it. */
  point(v: number, phi: number, grow = 0): THREE.Vector3 {
    const s = this.at(v);
    const e = 2 / s.n;
    const sn = Math.sin(phi);
    const cs = Math.cos(phi);
    const x = Math.sign(sn) * Math.pow(Math.abs(sn), e) * (s.rx + grow);
    const z = Math.sign(cs) * Math.pow(Math.abs(cs), e) * (s.rz + grow);
    return V(x, 0, z).applyQuaternion(s.q).add(s.c);
  }

  /** Where along it the centre line reaches `value` on `axis` (for a path that runs steadily along that axis). */
  where(axis: 'y' | 'z', value: number): number {
    const up = this.T[Path.N].c[axis] > this.T[0].c[axis];
    for (let k = 0; k < Path.N; k++) {
      const a = this.T[k].c[axis];
      const b = this.T[k + 1].c[axis];
      if (up ? a <= value && b >= value : a >= value && b <= value) return (k + (b === a ? 0 : (value - a) / (b - a))) / Path.N;
    }
    return (up ? value < this.T[0].c[axis] : value > this.T[0].c[axis]) ? 0 : 1;
  }

  length(v0: number, v1: number): number {
    let len = 0;
    let p = this.at(v0).c;
    for (let i = 1; i <= 12; i++) {
      const c = this.at(v0 + ((v1 - v0) * i) / 12).c;
      len += c.distanceTo(p);
      p = c;
    }
    return len;
  }
}

/** The skin over a path: a closed tube, capped where asked; `ribs` swells or pinches it along its length. */
function loft(p: Path, o: { seg?: number; rows?: number; v0?: number; v1?: number; grow?: number; capStart?: boolean; capEnd?: boolean; ribs?: (v: number) => number; uv?: [number, number] } = {}): THREE.BufferGeometry {
  const seg = o.seg ?? 28;
  const rows = o.rows ?? 40;
  const v0 = o.v0 ?? 0;
  const v1 = o.v1 ?? 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const [ru, rv] = o.uv ?? [1, 1];
  for (let i = 0; i <= rows; i++) {
    const v = v0 + ((v1 - v0) * i) / rows;
    const g = (o.grow ?? 0) + (o.ribs ? o.ribs(v) : 0);
    for (let j = 0; j <= seg; j++) {
      const pt = p.point(v, (j / seg) * Math.PI * 2, g);
      pos.push(pt.x, pt.y, pt.z);
      uv.push((j / seg) * ru, (i / rows) * rv);
    }
  }
  const W = seg + 1;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * W + j;
      idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
    }
  const cap = (row: number, v: number, flip: boolean): void => {
    const c = p.at(v).c;
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    uv.push(0.5, 0.5);
    for (let j = 0; j < seg; j++) {
      const a = row * W + j;
      if (flip) idx.push(ci, a + 1, a);
      else idx.push(ci, a, a + 1);
    }
  };
  if (o.capStart) cap(0, v0, true);
  if (o.capEnd) cap(rows, v1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // The seam: the first and last of each row are the same point, so they share a normal
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i <= rows; i++) {
    const a = i * W;
    const b = a + seg;
    const n = V(nrm.getX(a) + nrm.getX(b), nrm.getY(a) + nrm.getY(b), nrm.getZ(a) + nrm.getZ(b)).normalize();
    nrm.setXYZ(a, n.x, n.y, n.z);
    nrm.setXYZ(b, n.x, n.y, n.z);
  }
  return g;
}

/** Extra shaping for a plate, in metres across (x) and along (y) it; `W`,`H` its size. */
type Field = (x: number, y: number, W: number, H: number) => number;

interface PlateOpts {
  /** The middle of it round the path, and how far it reaches either side (radians). */
  phi: number;
  half: number;
  /** From and to, along the path: heights by default, or `axis: 'z'`, or raw 0..1 with `axis: 'v'`. */
  a: number;
  b: number;
  axis?: 'y' | 'z' | 'v';
  /** How far its face stands off the skin. */
  top: number;
  bevel?: number;
  nu?: number;
  nv?: number;
  /** Right round the path: no edges at the sides. */
  closed?: boolean;
  /** Signed distance (m) to an extra edge: positive is plate, negative is cut away. */
  cut?: Field;
  /** Depth (m) taken out of the face: panel lines. */
  groove?: Field;
  /** Extra stand-off (m): a flare, a ridge. */
  lift?: Field;
}

/**
 * A plate of armour: a patch of the path's skin raised to `top`, its edge
 * rolled over a `bevel` and sunk back under the skin, so it reads as a thick
 * shell with a soft highlight along every edge and no gap beneath it.
 */
function plate(p: Path, o: PlateOpts): THREE.BufferGeometry {
  const nu = o.nu ?? 26;
  const nv = o.nv ?? 26;
  const axis = o.axis ?? 'y';
  const v0 = axis === 'v' ? o.a : p.where(axis, o.a);
  const v1 = axis === 'v' ? o.b : p.where(axis, o.b);
  const mid = p.at((v0 + v1) / 2);
  const W = 2 * o.half * ((mid.rx + mid.rz) / 2 + o.top);
  const H = Math.max(0.001, p.length(v0, v1));
  // (tight: a hard shell's edge, not a cushion's)
  const bevel = (o.bevel ?? 0.01) * 0.6;
  const base = -0.005;
  // Samples bunched toward the edges, where the shape turns
  const bunch = (s: number): number => 0.5 - 0.5 * Math.cos(Math.PI * s);
  const pos: number[] = [];
  const col: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nv; i++) {
    const tv = bunch(i / nv);
    for (let j = 0; j <= nu; j++) {
      const tu = o.closed ? j / nu : bunch(j / nu);
      const x = tu * W;
      const y = tv * H;
      let d = Math.min(y, H - y);
      if (!o.closed) d = Math.min(d, x, W - x);
      if (o.cut) d = Math.min(d, o.cut(x, y, W, H));
      // The edge: up through the skin on a quarter-sine (a finite slope where it crosses, so a
      // slanted cut comes out as a clean line, not steps), and carried on down under the skin outside it
      const rise = o.top + (o.lift ? o.lift(x, y, W, H) : 0) - base;
      let h: number;
      let shade = 1;
      if (d > 0) {
        const k = Math.min(1, d / bevel);
        h = base + rise * Math.sin((k * Math.PI) / 2);
        // (the panel lines themselves are drawn into the plate's texture, below: the mesh is too coarse to cut them crisply)
        if (o.groove) h -= o.groove(x, y, W, H) * k * 0.25;
        // A little shade right at the edge, where a plate meets what's under it
        shade = 0.8 + 0.2 * k;
      } else h = base + (rise * (Math.PI / 2) * d) / bevel;
      const pt = p.point(v0 + (v1 - v0) * tv, o.phi + (tu - 0.5) * 2 * o.half, Math.max(h, -0.03));
      pos.push(pt.x, pt.y, pt.z);
      col.push(shade, shade, shade);
      uvs.push(tu, tv);
    }
  }
  const Wn = nu + 1;
  for (let i = 0; i < nv; i++)
    for (let j = 0; j < nu; j++) {
      const a = i * Wn + j;
      idx.push(a, a + 1, a + Wn, a + 1, a + Wn + 1, a + Wn);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // The panel lines, drawn at a pixel to the millimetre or so: dark in the colour, cut in by the bump
  if (o.groove) {
    const px = (m: number): number => Math.max(48, Math.min(256, Math.round(m / 0.0011)));
    const cw = px(W);
    const ch = px(H);
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(cw, ch);
    for (let yy = 0; yy < ch; yy++)
      for (let xx = 0; xx < cw; xx++) {
        const gr = o.groove(((xx + 0.5) / cw) * W, (1 - (yy + 0.5) / ch) * H, W, H) / 0.0045;
        const t = Math.min(1, Math.max(0, (gr - 0.5) / 0.3));
        const v = Math.round(255 * (1 - 0.82 * t * t * (3 - 2 * t)));
        const k = (yy * cw + xx) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
        img.data[k + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    g.userData.lines = c;
  }
  if (o.closed) {
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i <= nv; i++) {
      const a = i * Wn;
      const b = a + nu;
      const n = V(nrm.getX(a) + nrm.getX(b), nrm.getY(a) + nrm.getY(b), nrm.getZ(a) + nrm.getZ(b)).normalize();
      nrm.setXYZ(a, n.x, n.y, n.z);
      nrm.setXYZ(b, n.x, n.y, n.z);
    }
  }
  return g;
}

/** Corners cut off at 45°: bottom-left, bottom-right, top-left, top-right (m; 0 leaves one square). */
const cham = (bl: number, br: number, tl: number, tr: number): Field => (x, y, W, H) => {
  let d = 1;
  if (bl) d = Math.min(d, (x + y - bl) / Math.SQRT2);
  if (br) d = Math.min(d, (W - x + y - br) / Math.SQRT2);
  if (tl) d = Math.min(d, (x + H - y - tl) / Math.SQRT2);
  if (tr) d = Math.min(d, (W - x + H - y - tr) / Math.SQRT2);
  return d;
};
/** A panel line `w` wide and `depth` deep along a signed distance. */
const line = (dist: number, w = 0.0035, depth = 0.0045): number => depth * Math.exp(-(dist * dist) / (w * w));

/** A slab with rounded corners and a bevel all round, `d` deep: lying in x/y, its back at z = 0. */
function slab(w: number, h: number, d: number, r: number, bevel = 0.006): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = w / 2 - bevel;
  const y = h / 2 - bevel;
  const rr = Math.max(0.001, r - bevel);
  s.moveTo(-x + rr, -y);
  s.lineTo(x - rr, -y);
  s.quadraticCurveTo(x, -y, x, -y + rr);
  s.lineTo(x, y - rr);
  s.quadraticCurveTo(x, y, x - rr, y);
  s.lineTo(-x + rr, y);
  s.quadraticCurveTo(-x, y, -x, y - rr);
  s.lineTo(-x, -y + rr);
  s.quadraticCurveTo(-x, -y, -x + rr, -y);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
  return g;
}

// ------------------------------------------------------------------ materials

export interface SuitMats {
  /** White shell. */
  armor: THREE.MeshPhysicalMaterial;
  /** The second colour: a cool light grey. */
  trim: THREE.MeshPhysicalMaterial;
  /** Gunmetal: joints' plates, clamps, the belt's fittings. */
  gun: THREE.MeshStandardMaterial;
  /** The undersuit: black, a fine weave. */
  under: THREE.MeshStandardMaterial;
  /** Ribbed rubber at the neck and the joints. */
  rubber: THREE.MeshStandardMaterial;
  visor: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  mark: THREE.MeshStandardMaterial;
}

function weave(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 64, 64);
  // A fine diamond weave: light threads one way, dark the other
  for (let i = -64; i < 128; i += 8) {
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 64, 64);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.moveTo(i + 64, 0);
    g.lineTo(i, 64);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function suitMaterials(): SuitMats {
  const bump = weave();
  bump.repeat.set(26, 40);
  return {
    armor: new THREE.MeshPhysicalMaterial({ color: 0xb4b9bf, roughness: 0.44, metalness: 0.1, clearcoat: 0.35, clearcoatRoughness: 0.3, side: THREE.DoubleSide, vertexColors: true }),
    trim: new THREE.MeshPhysicalMaterial({ color: 0x4f565e, roughness: 0.45, metalness: 0.3, clearcoat: 0.25, clearcoatRoughness: 0.3, side: THREE.DoubleSide, vertexColors: true }),
    gun: new THREE.MeshStandardMaterial({ color: 0x2c3035, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide, vertexColors: true }),
    under: new THREE.MeshStandardMaterial({ color: 0x131518, roughness: 0.78, metalness: 0.1, bumpMap: bump, bumpScale: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.6, metalness: 0.15 }),
    visor: new THREE.MeshStandardMaterial({ color: 0xd99a22, roughness: 0.1, metalness: 1, side: THREE.DoubleSide }),
    glow: new THREE.MeshStandardMaterial({ color: 0x06201e, emissive: 0x2ff2d8, emissiveIntensity: 2.2 }),
    mark: new THREE.MeshStandardMaterial({ color: 0xe0701a, roughness: 0.5, side: THREE.DoubleSide })
  };
}

/** The material for a piece: the plain one, or — for a plate with panel lines — a copy carrying its lines. */
function lined(geo: THREE.BufferGeometry, m: THREE.Material, mats?: THREE.MeshStandardMaterial[]): THREE.Material {
  const c = geo.userData.lines as HTMLCanvasElement | undefined;
  if (!c || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m;
  const copy = (m as THREE.MeshStandardMaterial).clone();
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(c);
  copy.map = map;
  copy.bumpMap = bump;
  copy.bumpScale = 1.6;
  mats?.push(copy);
  return copy;
}

// ------------------------------------------------------------------ the suit

const D = Math.PI / 180;

/** The whole suit, standing. Its materials go on `mats` for the scene to give an environment to. */
export function suitModel(mats: THREE.MeshStandardMaterial[], M: SuitMats = suitMaterials()): THREE.Group {
  mats.push(M.armor, M.trim, M.gun, M.under, M.rubber, M.visor);
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, lined(geo, m, mats));
    g.add(mesh);
    return mesh;
  };

  // ============================================================ the trunk
  const torso = new Path([
    [0, 0.8, 0, 0.13, 0.098, 2.4],
    [0, 0.88, 0, 0.168, 0.118, 2.4],
    [0, 0.96, 0, 0.178, 0.122, 2.4],
    [0, 1.04, 0, 0.16, 0.108, 2.3],
    [0, 1.1, 0.004, 0.15, 0.104, 2.3],
    [0, 1.2, 0.01, 0.165, 0.115, 2.4],
    [0, 1.3, 0.014, 0.188, 0.128, 2.5],
    [0, 1.39, 0.014, 0.204, 0.134, 2.5],
    [0, 1.46, 0.006, 0.2, 0.118, 2.4],
    [0, 1.505, 0, 0.14, 0.092, 2.2],
    [0, 1.545, 0, 0.068, 0.07, 2],
    [0, 1.62, 0, 0.056, 0.06, 2]
  ]);
  add(loft(torso, { seg: 36, rows: 60, capStart: true, v1: torso.where('y', 1.5) }), M.under);
  // The neck: a ribbed rubber seal up into the helmet
  add(loft(torso, { seg: 28, rows: 36, v0: torso.where('y', 1.49), v1: 1, ribs: (v) => 0.004 + 0.003 * Math.sin(v * 520) }), M.rubber);

  // Chest: one big plate, its lower edge drawn up to a point either side of the sternum, seams cut in
  add(
    plate(torso, {
      phi: 0,
      half: 84 * D,
      a: 1.262,
      b: 1.5,
      top: 0.024,
      bevel: 0.012,
      nu: 44,
      nv: 36,
      cut: (x, y, W, H) => Math.min(y - 0.012 - Math.abs(x - W / 2) * 0.32 + 0.03, cham(0, 0, 0.1, 0.1)(x, y, W, H), Math.hypot(x - W / 2, y - H - 0.02) - 0.085),
      groove: (x, y, W, H) => line(x - W / 2, 0.003, 0.005) + line(y - H * 0.5 - Math.abs(x - W / 2) * 0.25, 0.003, 0.004) * (Math.abs(x - W / 2) > 0.03 ? 1 : 0) + line(Math.abs(x - W / 2) - W * 0.34, 0.003, 0.003),
      lift: (x, _y, W) => 0.008 * Math.max(0, 1 - Math.abs(x - W / 2) / 0.09)
    }),
    M.armor
  );
  // The chest unit's light, and a small grey access plate opposite
  add(plate(torso, { phi: 30 * D, half: 7 * D, a: 1.37, b: 1.4, top: 0.034, bevel: 0.004, nu: 10, nv: 8, cut: cham(0.008, 0, 0, 0.008) }), M.glow);
  add(plate(torso, { phi: 30 * D, half: 10 * D, a: 1.36, b: 1.41, top: 0.031, bevel: 0.005, nu: 12, nv: 10, cut: cham(0.01, 0, 0, 0.01) }), M.gun);
  add(plate(torso, { phi: -30 * D, half: 9 * D, a: 1.365, b: 1.405, top: 0.031, bevel: 0.005, nu: 12, nv: 10, groove: (_x, y) => line(y - 0.013, 0.002, 0.003) + line(y - 0.027, 0.002, 0.003) }), M.trim);
  // The collar: a raised ring the helmet locks into, a grey yoke under it
  add(plate(torso, { phi: 0, half: Math.PI, closed: true, a: 1.492, b: 1.552, top: 0.03, bevel: 0.012, nu: 40, nv: 12, groove: (_x, y) => line(y - 0.03, 0.003, 0.004) }), M.armor);
  add(plate(torso, { phi: 0, half: 46 * D, a: 1.45, b: 1.5, top: 0.036, bevel: 0.008, nu: 26, nv: 10, cut: cham(0.03, 0.03, 0, 0) }), M.trim);
  // Abdomen: three lapped gunmetal plates over the black
  for (const [a, b] of [[1.066, 1.124], [1.132, 1.19], [1.198, 1.256]]) {
    add(plate(torso, { phi: 0, half: 44 * D, a, b, top: 0.014, bevel: 0.007, nu: 30, nv: 10, cut: cham(0.018, 0.018, 0.008, 0.008), groove: (x, _y, W) => line(x - W / 2, 0.003, 0.003) }), M.gun);
  }
  // Flank plates under the arms
  for (const s of [-1, 1]) {
    add(plate(torso, { phi: s * 100 * D, half: 24 * D, a: 1.16, b: 1.3, top: 0.016, bevel: 0.008, nu: 14, nv: 14, cut: cham(0.02, 0.02, 0.012, 0.012), groove: (_x, y, _W, H) => line(y - H * 0.5, 0.003, 0.003) }), M.armor);
  }
  // Back: the plate, and the pack on it
  add(
    plate(torso, {
      phi: Math.PI,
      half: 86 * D,
      a: 1.2,
      b: 1.5,
      top: 0.022,
      bevel: 0.012,
      nu: 40,
      nv: 30,
      cut: cham(0.05, 0.05, 0.09, 0.09),
      groove: (x, y, W, H) => line(Math.abs(x - W / 2) - 0.07, 0.003, 0.004) + line(y - H * 0.3, 0.003, 0.003)
    }),
    M.armor
  );
  const pack = add(slab(0.25, 0.3, 0.085, 0.035, 0.012), M.armor);
  pack.rotation.y = Math.PI;
  pack.position.set(0, 1.345, -0.145);
  const packTop = add(slab(0.19, 0.07, 0.06, 0.02, 0.008), M.trim);
  packTop.rotation.y = Math.PI;
  packTop.position.set(0, 1.515, -0.14);
  // Vents down the pack, a status light, a canister low on each side
  for (let i = 0; i < 4; i++) {
    const vent = add(slab(0.15, 0.014, 0.012, 0.005, 0.003), M.gun);
    vent.rotation.y = Math.PI;
    vent.position.set(0, 1.4 - i * 0.03, -0.228);
  }
  const packLight = add(slab(0.05, 0.012, 0.01, 0.004, 0.003), M.glow);
  packLight.rotation.y = Math.PI;
  packLight.position.set(0, 1.445, -0.229);
  for (const s of [-1, 1]) {
    const can = new Path([[s * 0.085, 1.19, -0.2, 0.012, 0.012, 2], [s * 0.085, 1.205, -0.2, 0.03, 0.03, 2.6], [s * 0.085, 1.3, -0.2, 0.03, 0.03, 2.6], [s * 0.085, 1.318, -0.2, 0.014, 0.014, 2]]);
    add(loft(can, { seg: 18, rows: 16, capStart: true, capEnd: true }), M.gun);
  }
  // Belt: a grey band right round, a buckle, a pouch on each hip
  add(plate(torso, { phi: 0, half: Math.PI, closed: true, a: 0.952, b: 1.022, top: 0.017, bevel: 0.008, nu: 48, nv: 10, groove: (_x, y, _W, H) => line(y - H * 0.5, 0.003, 0.003) }), M.trim);
  const buckle = add(slab(0.1, 0.06, 0.03, 0.012, 0.006), M.gun);
  buckle.position.copy(torso.point(torso.where('y', 0.987), 0, 0.01));
  buckle.position.z -= 0.004;
  add(plate(torso, { phi: 0, half: 6 * D, a: 0.975, b: 1.0, top: 0.048, bevel: 0.004, nu: 8, nv: 6 }), M.glow);
  for (const s of [-1, 1]) {
    const pouch = add(slab(0.075, 0.085, 0.04, 0.014, 0.007), M.gun);
    const at = torso.point(torso.where('y', 0.975), s * 62 * D, 0.008);
    pouch.position.copy(at);
    pouch.rotation.y = s * 62 * D;
  }
  // The hips: a plate each side, the front and the seat in gunmetal
  for (const s of [-1, 1]) {
    add(plate(torso, { phi: s * 88 * D, half: 36 * D, a: 0.842, b: 0.948, top: 0.018, bevel: 0.009, nu: 18, nv: 14, cut: cham(0.035, 0.035, 0, 0), groove: (x, _y, W) => line(x - W / 2, 0.003, 0.003) }), M.armor);
  }
  add(plate(torso, { phi: 0, half: 30 * D, a: 0.815, b: 0.948, top: 0.015, bevel: 0.008, nu: 18, nv: 16, cut: cham(0.045, 0.045, 0, 0), groove: (x, _y, W) => line(x - W / 2, 0.003, 0.003) }), M.gun);
  add(plate(torso, { phi: Math.PI, half: 44 * D, a: 0.83, b: 0.948, top: 0.014, bevel: 0.008, nu: 20, nv: 14, cut: cham(0.04, 0.04, 0, 0) }), M.gun);

  // ============================================================ arms and legs
  for (const s of [-1, 1]) {
    // ---- The leg, ankle to hip, run up inside the pelvis
    const leg = new Path([
      [s * 0.118, 0.085, 0, 0.047, 0.052, 2],
      [s * 0.12, 0.2, -0.005, 0.052, 0.062, 2.1],
      [s * 0.122, 0.34, -0.012, 0.062, 0.076, 2.1],
      [s * 0.122, 0.46, 0, 0.058, 0.064, 2.2],
      [s * 0.12, 0.52, 0.008, 0.064, 0.068, 2.3],
      [s * 0.117, 0.62, 0.005, 0.078, 0.085, 2.2],
      [s * 0.112, 0.76, 0, 0.094, 0.102, 2.2],
      [s * 0.105, 0.88, 0, 0.098, 0.108, 2.2],
      [s * 0.09, 0.97, 0, 0.082, 0.098, 2.2]
    ]);
    add(loft(leg, { seg: 28, rows: 56 }), M.under);
    // Behind the knee: ribbed rubber
    add(plate(leg, { phi: Math.PI, half: 62 * D, a: 0.46, b: 0.58, top: 0.006, bevel: 0.005, nu: 14, nv: 22, groove: (_x, y) => 0.003 * (0.5 + 0.5 * Math.sin(y * 420)) }), M.rubber);
    // Thigh: the big plate on the front and outside, corners cut, a seam, the orange marker low on it
    add(
      plate(leg, {
        phi: s * 48 * D,
        half: 92 * D,
        a: 0.585,
        b: 0.868,
        top: 0.021,
        bevel: 0.011,
        nu: 34,
        nv: 34,
        cut: cham(0.045, 0.045, 0.03, 0.03),
        groove: (x, y, W, H) => line(y - H * 0.72, 0.003, 0.004) + line(x - W * 0.5, 0.003, 0.003) * (y < H * 0.72 ? 1 : 0)
      }),
      M.armor
    );
    add(plate(leg, { phi: s * 30 * D, half: 9 * D, a: 0.632, b: 0.672, top: 0.026, bevel: 0.004, nu: 10, nv: 10, cut: (x, y, W, H) => (Math.min(x, W - x) * 2 * (H / W) - y) / 1.4 }), M.mark);
    // The back of the thigh, lighter
    add(plate(leg, { phi: s * -132 * D, half: 50 * D, a: 0.62, b: 0.84, top: 0.012, bevel: 0.008, nu: 16, nv: 20, cut: cham(0.03, 0.03, 0.02, 0.02) }), M.gun);
    // Knee: a boxy cap standing well proud, a lower lip under it
    add(
      plate(leg, {
        phi: 0,
        half: 70 * D,
        a: 0.452,
        b: 0.592,
        top: 0.036,
        bevel: 0.014,
        nu: 26,
        nv: 26,
        cut: cham(0.03, 0.03, 0.022, 0.022),
        groove: (x, y, W, H) => line(Math.max(Math.abs(x - W / 2) - W * 0.2, Math.abs(y - H * 0.52) - H * 0.2), 0.003, 0.004)
      }),
      M.armor
    );
    add(plate(leg, { phi: 0, half: 52 * D, a: 0.395, b: 0.462, top: 0.022, bevel: 0.008, nu: 18, nv: 10, cut: cham(0.02, 0.02, 0, 0) }), M.gun);
    // Shin: a long grey guard down the front, a calf plate behind
    add(
      plate(leg, {
        phi: 0,
        half: 78 * D,
        a: 0.135,
        b: 0.402,
        top: 0.019,
        bevel: 0.01,
        nu: 28,
        nv: 32,
        cut: cham(0.02, 0.02, 0.03, 0.03),
        groove: (x, y, W, H) => line(x - W / 2, 0.003, 0.004) + line(y - H * 0.3, 0.003, 0.003),
        lift: (x, _y, W) => 0.006 * Math.max(0, 1 - Math.abs(x - W / 2) / 0.03)
      }),
      M.trim
    );
    add(plate(leg, { phi: Math.PI, half: 64 * D, a: 0.19, b: 0.42, top: 0.013, bevel: 0.008, nu: 18, nv: 22, cut: cham(0.02, 0.02, 0.03, 0.03), groove: (_x, y, _W, H) => line(y - H * 0.5, 0.003, 0.003) }), M.gun);
    // Ankle clamp
    add(plate(leg, { phi: 0, half: Math.PI, closed: true, a: 0.09, b: 0.15, top: 0.016, bevel: 0.007, nu: 30, nv: 8 }), M.gun);

    // ---- The boot: the foot lofted heel to toe, a sole under it, toe cap and straps over
    const foot = new Path(
      [
        [s * 0.118, 0.066, -0.092, 0.036, 0.046, 2.6],
        [s * 0.118, 0.072, -0.05, 0.05, 0.062, 2.8],
        [s * 0.118, 0.07, 0.02, 0.055, 0.06, 2.8],
        [s * 0.118, 0.058, 0.09, 0.056, 0.048, 2.8],
        [s * 0.118, 0.047, 0.155, 0.052, 0.037, 2.8],
        [s * 0.118, 0.04, 0.2, 0.04, 0.03, 2.6],
        [s * 0.118, 0.038, 0.218, 0.016, 0.016, 2.2]
      ],
      new THREE.Quaternion().setFromUnitVectors(Y, V(0, 0, 1))
    );
    add(loft(foot, { seg: 26, rows: 36, capStart: true, capEnd: true }), M.under);
    // Sole: a hard dark tread, heel and forefoot
    const soleShape = new THREE.Shape();
    soleShape.moveTo(-0.04, -0.1);
    soleShape.quadraticCurveTo(-0.058, -0.03, -0.056, 0.06);
    soleShape.quadraticCurveTo(-0.06, 0.17, -0.03, 0.222);
    soleShape.quadraticCurveTo(0, 0.238, 0.03, 0.222);
    soleShape.quadraticCurveTo(0.06, 0.17, 0.056, 0.06);
    soleShape.quadraticCurveTo(0.058, -0.03, 0.04, -0.1);
    soleShape.quadraticCurveTo(0, -0.115, -0.04, -0.1);
    const sole = add(new THREE.ExtrudeGeometry(soleShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 10 }), M.rubber);
    sole.rotation.x = Math.PI / 2;
    sole.position.set(s * 0.118, 0.028, 0);
    // (the foot's frame turns its "front" to face the floor: its top is phi = π)
    add(loft(foot, { seg: 26, rows: 14, v0: foot.where('z', 0.138), v1: 1, grow: 0.009, capEnd: true }), M.trim);
    for (const [a, b] of [[-0.02, 0.03], [0.045, 0.095]]) {
      add(plate(foot, { phi: Math.PI, half: 118 * D, a, b, axis: 'z', top: 0.011, bevel: 0.006, nu: 22, nv: 8, groove: (x, _y, W) => line(x - W / 2, 0.012, 0.003) }), M.gun);
    }
    add(plate(foot, { phi: Math.PI, half: 100 * D, a: -0.092, b: -0.045, axis: 'z', top: 0.011, bevel: 0.006, nu: 18, nv: 8 }), M.gun);

    // ---- The arm, wrist to shoulder and on into the chest
    const arm = new Path([
      [s * 0.33, 0.9, 0.065, 0.031, 0.036, 2],
      [s * 0.326, 0.97, 0.045, 0.04, 0.043, 2.1],
      [s * 0.318, 1.07, 0.02, 0.05, 0.05, 2.1],
      [s * 0.308, 1.16, 0, 0.046, 0.047, 2.1],
      [s * 0.296, 1.26, -0.005, 0.053, 0.056, 2.1],
      [s * 0.275, 1.36, -0.003, 0.057, 0.061, 2.1],
      [s * 0.25, 1.435, 0, 0.061, 0.065, 2.1],
      [s * 0.2, 1.468, 0, 0.061, 0.066, 2.1],
      [s * 0.13, 1.47, 0, 0.055, 0.06, 2.1]
    ]);
    add(loft(arm, { seg: 24, rows: 60 }), M.under);
    // Inside the elbow: ribbed rubber
    add(plate(arm, { phi: 0, half: 70 * D, a: 1.1, b: 1.22, top: 0.005, bevel: 0.004, nu: 14, nv: 22, groove: (_x, y) => 0.003 * (0.5 + 0.5 * Math.sin(y * 420)) }), M.rubber);
    // Bracer: a big plate round the outside of the forearm, flared toward the elbow; a gunmetal one inside
    add(
      plate(arm, {
        phi: s * 90 * D,
        half: 126 * D,
        a: 0.925,
        b: 1.125,
        top: 0.02,
        bevel: 0.01,
        nu: 34,
        nv: 28,
        cut: cham(0.02, 0.02, 0.045, 0.045),
        groove: (x, y, W, H) => line(y - H * 0.35, 0.003, 0.004) + line(x - W / 2, 0.003, 0.003) * (y > H * 0.35 ? 1 : 0),
        lift: (_x, y, _W, H) => 0.014 * Math.pow(y / H, 2)
      }),
      M.armor
    );
    add(plate(arm, { phi: s * -90 * D, half: 46 * D, a: 0.94, b: 1.09, top: 0.01, bevel: 0.006, nu: 14, nv: 18, cut: cham(0.015, 0.015, 0.015, 0.015) }), M.gun);
    add(plate(arm, { phi: s * 90 * D, half: 10 * D, a: 0.99, b: 1.02, top: 0.027, bevel: 0.004, nu: 8, nv: 8 }), M.glow);
    // Wrist clamp, elbow cap
    add(plate(arm, { phi: 0, half: Math.PI, closed: true, a: 0.9, b: 0.932, top: 0.013, bevel: 0.006, nu: 26, nv: 8 }), M.gun);
    add(plate(arm, { phi: s * 150 * D, half: 62 * D, a: 1.125, b: 1.21, top: 0.02, bevel: 0.009, nu: 18, nv: 14, cut: cham(0.02, 0.02, 0.02, 0.02) }), M.trim);
    // Upper arm: a band of plate round the outside, under the pauldron
    add(plate(arm, { phi: s * 90 * D, half: 80 * D, a: 1.215, b: 1.31, top: 0.012, bevel: 0.007, nu: 20, nv: 14, cut: cham(0.02, 0.02, 0, 0), groove: (_x, y, _W, H) => line(y - H * 0.5, 0.003, 0.003) }), M.gun);

    // ---- Pauldron: its own, fuller run of sections up the arm and over the shoulder to the collar,
    //      two lapped plates on it — the lower tucked under the upper
    const shoulder = new Path([
      [s * 0.3, 1.25, -0.004, 0.064, 0.068, 2.7],
      [s * 0.29, 1.33, -0.003, 0.074, 0.08, 2.7],
      [s * 0.27, 1.41, 0, 0.084, 0.09, 2.7],
      [s * 0.238, 1.478, 0, 0.088, 0.094, 2.7],
      [s * 0.185, 1.508, 0, 0.078, 0.088, 2.7],
      [s * 0.13, 1.512, 0, 0.062, 0.078, 2.7]
    ]);
    add(plate(shoulder, { phi: s * 90 * D, half: 86 * D, a: 0.02, b: 0.4, axis: 'v', top: 0.012, bevel: 0.009, nu: 26, nv: 18, cut: cham(0.03, 0.03, 0, 0), groove: (_x, y, _W, H) => line(y - H * 0.45, 0.003, 0.003) }), M.armor);
    add(
      plate(shoulder, {
        phi: s * 90 * D,
        half: 104 * D,
        a: 0.28,
        b: 0.97,
        axis: 'v',
        top: 0.026,
        bevel: 0.013,
        nu: 38,
        nv: 34,
        cut: cham(0.04, 0.04, 0.035, 0.035),
        groove: (x, y, W, H) => line(y - H * 0.62, 0.003, 0.004) + line(Math.abs(x - W / 2) - W * 0.3, 0.003, 0.003) * (y < H * 0.62 ? 1 : 0),
        lift: (x, y, W, H) => 0.01 * Math.max(0, 1 - Math.abs(x - W / 2) / 0.035) * (y < H * 0.62 ? 1 : 0)
      }),
      M.armor
    );
    add(plate(shoulder, { phi: s * 90 * D, half: 40 * D, a: 0.66, b: 0.93, axis: 'v', top: 0.034, bevel: 0.008, nu: 16, nv: 14, cut: cham(0.02, 0.02, 0.015, 0.015) }), M.trim);

    // ---- The hand: palm lofted knuckles to wrist, four fingers and a thumb, a plate on the back of it
    const hx = s * 0.332;
    const hand = new Path([
      [hx, 0.806, 0.09, 0.0165, 0.04, 2.8],
      [hx, 0.85, 0.08, 0.02, 0.044, 2.8],
      [hx, 0.895, 0.068, 0.023, 0.038, 2.6],
      [hx, 0.93, 0.058, 0.03, 0.034, 2.2]
    ]);
    add(loft(hand, { seg: 20, rows: 20, capStart: true }), M.rubber);
    add(plate(hand, { phi: s * 90 * D, half: 62 * D, a: 0.816, b: 0.89, top: 0.008, bevel: 0.005, nu: 14, nv: 14, cut: cham(0.012, 0.012, 0.008, 0.008), groove: (_x, y, _W, H) => line(y - H * 0.4, 0.002, 0.002) }), M.trim);
    [-0.03, -0.01, 0.01, 0.029].forEach((dz, i) => {
      const zk = 0.09 + dz;
      const len = [0.082, 0.092, 0.088, 0.07][i];
      const f = new Path([
        [hx - s * 0.03, 0.81 - len, zk + 0.016, 0.0072, 0.0072, 2],
        [hx - s * 0.02, 0.81 - len * 0.74, zk + 0.013, 0.0082, 0.0084, 2.2],
        [hx - s * 0.007, 0.81 - len * 0.4, zk + 0.007, 0.0092, 0.0094, 2.2],
        [hx, 0.812, zk, 0.0098, 0.0098, 2.2]
      ]);
      add(loft(f, { seg: 12, rows: 18, capStart: true }), M.rubber);
      // A knuckle pad
      add(plate(f, { phi: s * 90 * D, half: 60 * D, a: 0.86, b: 1.0, axis: 'v', top: 0.004, bevel: 0.003, nu: 8, nv: 6 }), M.gun);
    });
    const thumb = new Path([
      [hx - s * 0.024, 0.792, 0.136, 0.0085, 0.0085, 2],
      [hx - s * 0.016, 0.822, 0.126, 0.0105, 0.0105, 2.2],
      [hx - s * 0.006, 0.862, 0.108, 0.013, 0.013, 2.2],
      [hx, 0.89, 0.09, 0.014, 0.015, 2.2]
    ]);
    add(loft(thumb, { seg: 12, rows: 16, capStart: true }), M.rubber);
  }

  // ============================================================ the helmet
  const helm = new Path([
    [0, 1.582, 0.012, 0.086, 0.104, 2.5],
    [0, 1.63, 0.015, 0.108, 0.129, 2.6],
    [0, 1.7, 0.008, 0.121, 0.139, 2.6],
    [0, 1.77, 0, 0.119, 0.135, 2.5],
    [0, 1.83, -0.008, 0.101, 0.116, 2.35],
    [0, 1.868, -0.012, 0.064, 0.076, 2.15],
    [0, 1.887, -0.014, 0.01, 0.012, 2]
  ]);
  add(loft(helm, { seg: 40, rows: 44, capStart: true, capEnd: true }), M.armor);
  // The visor: gold, wrapped across the face, its lower corners cut back along the cheek
  add(
    plate(helm, {
      phi: 0,
      half: 58 * D,
      a: 1.66,
      b: 1.792,
      top: 0.008,
      bevel: 0.008,
      nu: 40,
      nv: 26,
      cut: (x, y, W, H) => Math.min(cham(0.06, 0.06, 0.018, 0.018)(x, y, W, H), y + 0.012 - Math.max(0, Math.abs(x - W / 2) - W * 0.2) * 0.12)
    }),
    M.visor
  );
  // Its frame: a grey brow over it, a gunmetal jaw under it with a breather either side
  add(plate(helm, { phi: 0, half: 70 * D, a: 1.79, b: 1.836, top: 0.016, bevel: 0.008, nu: 34, nv: 10, cut: cham(0, 0, 0.022, 0.022), groove: (x, _y, W) => line(x - W / 2, 0.003, 0.004) }), M.trim);
  add(
    plate(helm, {
      phi: 0,
      half: 74 * D,
      a: 1.588,
      b: 1.658,
      top: 0.015,
      bevel: 0.008,
      nu: 36,
      nv: 12,
      cut: cham(0.03, 0.03, 0, 0),
      groove: (x, y, W, H) => line(x - W / 2, 0.003, 0.004) + 0.004 * (Math.abs(Math.abs(x - W / 2) - W * 0.25) < 0.022 && Math.abs(y - H * 0.5) < 0.016 ? 0.5 + 0.5 * Math.sin(x * 900) : 0)
    }),
    M.gun
  );
  // Cheek guards either side of the visor, a guard round the back of the neck
  for (const s of [-1, 1]) {
    add(plate(helm, { phi: s * 96 * D, half: 28 * D, a: 1.6, b: 1.79, top: 0.014, bevel: 0.008, nu: 14, nv: 22, cut: cham(0.02, 0.02, 0.03, 0.03), groove: (_x, y, _W, H) => line(y - H * 0.42, 0.003, 0.003) }), M.trim);
  }
  add(plate(helm, { phi: Math.PI, half: 62 * D, a: 1.588, b: 1.672, top: 0.014, bevel: 0.008, nu: 26, nv: 12, cut: cham(0.025, 0.025, 0.02, 0.02) }), M.gun);
  // The crest: a ridge from the brow over the crown and down the back
  add(plate(helm, { phi: 0, half: 11 * D, a: 1.838, b: 1.884, top: 0.012, bevel: 0.006, nu: 8, nv: 14 }), M.armor);
  add(plate(helm, { phi: Math.PI, half: 11 * D, a: 1.675, b: 1.884, top: 0.012, bevel: 0.006, nu: 8, nv: 26, groove: (_x, y, _W, H) => line(y - H * 0.5, 0.003, 0.003) }), M.armor);
  // The ear modules: a hexagonal boss each side, a ring of light in it
  for (const s of [-1, 1]) {
    const at = helm.point(helm.where('y', 1.71), s * 92 * D, 0.012);
    const boss = new Path([[at.x - s * 0.012, at.y, at.z, 0.02, 0.02, 2], [at.x, at.y, at.z, 0.038, 0.038, 2], [at.x + s * 0.016, at.y, at.z, 0.036, 0.036, 2], [at.x + s * 0.024, at.y, at.z, 0.022, 0.022, 2]], new THREE.Quaternion().setFromUnitVectors(Y, V(s, 0, 0)));
    add(loft(boss, { seg: 6, rows: 10, capEnd: true }), M.gun).geometry.computeVertexNormals();
    const eye = new Path([[at.x + s * 0.02, at.y, at.z, 0.014, 0.014, 2], [at.x + s * 0.027, at.y, at.z, 0.013, 0.013, 2]], new THREE.Quaternion().setFromUnitVectors(Y, V(s, 0, 0)));
    add(loft(eye, { seg: 14, rows: 2, capEnd: true }), M.glow);
  }
  return g;
}

// ------------------------------------------------------------------ pieces for the first-person arms

/**
 * The suit's arm as he sees it: each piece built along +Y from 0 to `len`,
 * for the scene to lay between his shoulder, elbow and wrist.
 */
export function suitArmPieces(M: SuitMats): {
  upper(len: number): THREE.Group;
  fore(len: number): THREE.Group;
  palm(): THREE.Group;
  elbow(): THREE.Group;
} {
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => new THREE.Mesh(geo, lined(geo, m));
  return {
    upper(len: number): THREE.Group {
      const g = new THREE.Group();
      const p = new Path([[0, -0.03, 0, 0.066, 0.068, 2.2], [0, len * 0.35, 0, 0.064, 0.066, 2.2], [0, len * 0.8, 0, 0.056, 0.058, 2.2], [0, len + 0.03, 0, 0.052, 0.054, 2.2]]);
      g.add(mesh(loft(p, { seg: 22, rows: 20, uv: [0.5, 0.5] }), M.under));
      const b = new Path([[0, 0, 0, 0.07, 0.07, 3.4], [0, len, 0, 0.058, 0.058, 3.4]]);
      g.add(mesh(plate(b, { phi: 0, half: Math.PI, closed: true, a: len * 0.28, b: len * 0.74, top: 0.01, bevel: 0.007, nu: 36, nv: 14, groove: (x, y, W, H) => line(y - H * 0.5, 0.0025, 0.0045) + line(((x / W) * 4) % 1 - 0.5, 0.012, 0.004) * (y > H * 0.5 ? 1 : 0) }), M.gun));
      return g;
    },
    fore(len: number): THREE.Group {
      // Its own +Z is the back of the forearm (the scene keeps it turned to the back of his hand)
      const g = new THREE.Group();
      const p = new Path([[0, -0.02, 0, 0.05, 0.052, 2.2], [0, len * 0.3, 0, 0.055, 0.056, 2.3], [0, len * 0.7, 0, 0.047, 0.049, 2.3], [0, len + 0.02, 0, 0.038, 0.04, 2.2]]);
      g.add(mesh(loft(p, { seg: 22, rows: 20, uv: [0.5, 0.5] }), M.under));
      // The bracer rides a squarer, fuller section than the sleeve: flat faces, not a tube
      const b = new Path([[0, 0, 0, 0.058, 0.057, 3.6], [0, len * 0.3, 0, 0.06, 0.058, 3.6], [0, len * 0.7, 0, 0.052, 0.05, 3.6], [0, len, 0, 0.044, 0.042, 3.4]]);
      // The top plate: over the back and both sides, corners cut, a spine down it, an inset panel, a cross seam
      g.add(
        mesh(
          plate(b, {
            phi: 0,
            half: 112 * D,
            a: len * 0.1,
            b: len * 0.9,
            top: 0.012,
            bevel: 0.009,
            nu: 40,
            nv: 30,
            cut: cham(0.035, 0.035, 0.016, 0.016),
            groove: (x, y, W, H) =>
              line(y - H * 0.64, 0.003, 0.0045) +
              line(Math.max(Math.abs(x - W / 2) - W * 0.13, Math.abs(y - H * 0.32) - H * 0.17), 0.0025, 0.0045) +
              line(Math.abs(x - W / 2) - W * 0.3, 0.0025, 0.004) * (y < H * 0.64 ? 1 : 0) +
              line(x - W / 2, 0.0025, 0.004) * (y > H * 0.64 ? 1 : 0),
            lift: (x, y, W, H) => 0.012 * Math.pow(1 - y / H, 2) + 0.004 * Math.max(0, 1 - Math.abs(x - W / 2) / 0.02) * (y > H * 0.64 ? 1 : 0)
          }),
          M.armor
        )
      );
      // A raised lip at the elbow end, a small strip of light set in the top, a status pip by the wrist
      g.add(mesh(plate(b, { phi: 0, half: 84 * D, a: len * 0.06, b: len * 0.17, top: 0.026, bevel: 0.007, nu: 24, nv: 8, cut: cham(0.02, 0.02, 0.008, 0.008) }), M.trim));
      g.add(mesh(plate(b, { phi: 0, half: 9 * D, a: len * 0.24, b: len * 0.4, top: 0.0165, bevel: 0.003, nu: 6, nv: 10 }), M.glow));
      g.add(mesh(plate(b, { phi: 34 * D, half: 5 * D, a: len * 0.74, b: len * 0.79, top: 0.016, bevel: 0.003, nu: 6, nv: 6 }), M.glow));
      // Underneath: gunmetal, ribbed, where the forearm bends against it
      g.add(mesh(plate(b, { phi: Math.PI, half: 60 * D, a: len * 0.16, b: len * 0.86, top: 0.007, bevel: 0.006, nu: 18, nv: 26, cut: cham(0.02, 0.02, 0.012, 0.012), groove: (_x, y) => 0.0032 * (0.5 + 0.5 * Math.sin(y * 300)) }), M.gun));
      // The clamp at the wrist
      g.add(mesh(plate(b, { phi: 0, half: Math.PI, closed: true, a: len * 0.9, b: len * 1.0, top: 0.012, bevel: 0.006, nu: 28, nv: 8, groove: (_x, y, _W, H) => line(y - H * 0.5, 0.002, 0.004) }), M.gun));
      return g;
    },
    /** The glove's palm, in the hand's own frame: fingers toward −Z, the back of the hand +Y. */
    palm(): THREE.Group {
      const g = new THREE.Group();
      const p = new Path(
        [
          [0, 0, 0.012, 0.036, 0.03, 2.4],
          [0, 0, -0.04, 0.046, 0.022, 2.8],
          [0, 0, -0.085, 0.048, 0.019, 2.8],
          [0, 0, -0.108, 0.044, 0.015, 2.6]
        ],
        new THREE.Quaternion().setFromUnitVectors(Y, V(0, 0, -1))
      );
      g.add(mesh(loft(p, { seg: 22, rows: 18, capStart: true, capEnd: true }), M.rubber));
      // A plate on the back of the hand, a guard over the knuckles, the clamp at the wrist
      g.add(mesh(plate(p, { phi: 0, half: 72 * D, a: -0.022, b: -0.082, axis: 'z', top: 0.007, bevel: 0.006, nu: 16, nv: 14, cut: cham(0.012, 0.012, 0.01, 0.01), groove: (x, _y, W) => line(x - W / 2, 0.002, 0.004) }), M.trim));
      g.add(mesh(plate(p, { phi: 0, half: 80 * D, a: -0.086, b: -0.108, axis: 'z', top: 0.008, bevel: 0.005, nu: 16, nv: 6 }), M.armor));
      g.add(mesh(plate(p, { phi: 0, half: Math.PI, closed: true, a: 0.012, b: -0.012, axis: 'z', top: 0.012, bevel: 0.006, nu: 26, nv: 6 }), M.gun));
      return g;
    },
    elbow(): THREE.Group {
      const g = new THREE.Group();
      // A ribbed rubber joint, a cap of plate over the point of it (its own +Z runs down the forearm)
      const p = new Path([[0, 0, -0.06, 0.048, 0.05, 2.2], [0, 0, -0.02, 0.058, 0.06, 2.2], [0, 0, 0.02, 0.058, 0.06, 2.2], [0, 0, 0.06, 0.048, 0.05, 2.2]], new THREE.Quaternion().setFromUnitVectors(Y, V(0, 0, 1)));
      g.add(mesh(loft(p, { seg: 22, rows: 22, capStart: true, capEnd: true, ribs: (v) => 0.003 * Math.sin(v * 60) }), M.rubber));
      g.add(mesh(plate(p, { phi: 0, half: 80 * D, a: -0.04, b: 0.04, axis: 'z', top: 0.016, bevel: 0.008, nu: 18, nv: 14, cut: cham(0.02, 0.02, 0.02, 0.02) }), M.trim));
      return g;
    }
  };
}
