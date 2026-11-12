import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The Collective's quad-barrel shotgun, the one in the crate in the lab:
 * four barrels in a square, a long top rail with flip-up sights, a blocky
 * receiver of bolted plates, a loop pump under the barrels, a pistol grip
 * and a skeleton stock — worn black steel and polymer, with red slits that
 * glow along its sides.
 *
 * Gun-local metres, the same frame as the viewmodel's gun: muzzle down −Z,
 * up +Y, the shooter's right +X. The pistol grip is where the old shotgun's
 * wrist was (z ≈ 0.23) and the sight line sits at y ≈ 0.078, so it drops into
 * every pose, hand and reload offset the old one had. The pump parts are in
 * their own group, `pump`, placed at (0, −0.004, −0.2) like the viewmodel's,
 * so the viewmodel can slide it.
 */

let mats: { steel: THREE.MeshStandardMaterial; poly: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; glow: THREE.MeshStandardMaterial; bore: THREE.MeshBasicMaterial } | null = null;

/** Worn steel: a dark base, scuffs and pale scratches where the finish has gone. */
function wornTexture(base: string, scratches: number, seed: number): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  let s = seed;
  const r = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  // Mottling
  for (let i = 0; i < 900; i++) {
    const v = Math.floor(r() * 30);
    g.fillStyle = `rgba(${v + 20},${v + 20},${v + 22},${0.15 + r() * 0.2})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 4, 1 + r() * 4);
  }
  // Scratches and worn edges
  for (let i = 0; i < scratches; i++) {
    g.strokeStyle = `rgba(150,150,150,${0.08 + r() * 0.22})`;
    g.lineWidth = 0.5 + r() * 0.8;
    g.beginPath();
    const x = r() * S;
    const y = r() * S;
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 14);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function materials(): NonNullable<typeof mats> {
  if (mats) return mats;
  const steelMap = wornTexture('#3a3b3d', 140, 7);
  steelMap.repeat.set(3, 3);
  const polyMap = wornTexture('#232324', 40, 19);
  polyMap.repeat.set(4, 4);
  mats = {
    steel: new THREE.MeshStandardMaterial({ color: 0xa4a7ac, map: steelMap, roughness: 0.5, metalness: 0.5 }),
    poly: new THREE.MeshStandardMaterial({ color: 0x8a8a8a, map: polyMap, roughness: 0.85, metalness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x26282b, roughness: 0.45, metalness: 0.55 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x400804, emissive: 0xff2a12, emissiveIntensity: 2.6, roughness: 0.4 }),
    bore: new THREE.MeshBasicMaterial({ color: 0x030303 })
  };
  return mats;
}

type Bucket = THREE.BufferGeometry[];

export interface QuadShotgun {
  group: THREE.Group;
  /** The sliding loop and forend, at (0, −0.004, −0.2) in the gun. */
  pump: THREE.Group;
  /** The middle of the four muzzles. */
  muzzle: THREE.Object3D;
  /** The pressure gauge on its left side: 0..3 charges, the one filling shown part full. */
  setPressure(p: number, flash?: number): void;
}

export function quadShotgunModel(): QuadShotgun {
  const M = materials();
  const group = new THREE.Group();
  group.name = 'quadShotgun';
  const pump = new THREE.Group();
  pump.position.set(0, -0.004, -0.2);
  group.add(pump);
  const B: Record<'steel' | 'poly' | 'dark' | 'glow' | 'bore', Bucket> = { steel: [], poly: [], dark: [], glow: [], bore: [] };
  const P: Record<'steel' | 'poly' | 'dark' | 'glow', Bucket> = { steel: [], poly: [], dark: [], glow: [] };

  const box = (b: Bucket, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    g.translate(x, y, z);
    b.push(g);
  };
  /** A cylinder lying along Z. */
  const tube = (b: Bucket, r: number, len: number, x: number, y: number, z: number, seg = 18): void => {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    b.push(g);
  };
  /** A bolt head on a side face (±X). */
  const bolt = (x: number, y: number, z: number): void => {
    const g = new THREE.CylinderGeometry(0.0045, 0.0045, 0.004, 8);
    g.rotateZ(Math.PI / 2);
    g.translate(x, y, z);
    B.dark.push(g);
  };

  // ---- Four barrels in a square, their muzzles thickened, the bores black
  const BX = 0.019;
  const BY0 = 0.002;
  const BY1 = 0.04;
  for (const x of [-BX, BX]) {
    for (const y of [BY0, BY1]) {
      tube(B.steel, 0.0175, 0.44, x, y, -0.3);
      tube(B.dark, 0.0195, 0.03, x, y, -0.505);
      const ring = new THREE.TorusGeometry(0.0165, 0.003, 6, 18);
      ring.translate(x, y, -0.5205);
      B.dark.push(ring);
      const bore = new THREE.CircleGeometry(0.0135, 14);
      bore.rotateY(Math.PI);
      bore.translate(x, y, -0.519);
      B.bore.push(bore);
    }
  }
  // A clamp band near the muzzle and one by the receiver, holding the four together
  box(B.dark, 0.084, 0.084, 0.026, 0, 0.021, -0.455);
  box(B.dark, 0.082, 0.082, 0.02, 0, 0.021, -0.11);

  // ---- Top rail, its teeth, and the two flip-up sights
  box(B.dark, 0.026, 0.01, 0.62, 0, 0.066, -0.16);
  for (let z = -0.46; z <= 0.13; z += 0.016) box(B.dark, 0.03, 0.006, 0.008, 0, 0.073, z);
  // Front: a post in a hooded frame
  box(B.dark, 0.034, 0.012, 0.03, 0, 0.078, -0.44);
  box(B.dark, 0.006, 0.016, 0.012, -0.012, 0.09, -0.44);
  box(B.dark, 0.006, 0.016, 0.012, 0.012, 0.09, -0.44);
  box(B.dark, 0.004, 0.012, 0.006, 0, 0.088, -0.44);
  // Rear: a blocky aperture housing
  box(B.dark, 0.04, 0.016, 0.05, 0, 0.08, 0.06);
  box(B.dark, 0.008, 0.02, 0.022, -0.014, 0.096, 0.07);
  box(B.dark, 0.008, 0.02, 0.022, 0.014, 0.096, 0.07);
  box(B.dark, 0.026, 0.008, 0.02, 0, 0.092, 0.05);

  // ---- Receiver: stacked plates, chamfered, bolted, with slits of red light
  box(B.steel, 0.066, 0.098, 0.27, 0, 0.012, 0.03);
  box(B.steel, 0.072, 0.05, 0.12, 0, 0.034, -0.03);
  box(B.steel, 0.072, 0.042, 0.1, 0, 0.04, 0.12, 0.18, 0, 0);
  box(B.steel, 0.07, 0.03, 0.08, 0, -0.04, -0.06);
  // Side plates, a little proud, each with a bevelled front
  for (const s of [-1, 1]) {
    box(B.steel, 0.006, 0.044, 0.1, s * 0.037, 0.03, 0.01);
    box(B.steel, 0.006, 0.03, 0.06, s * 0.037, -0.012, 0.1);
    box(B.dark, 0.004, 0.012, 0.05, s * 0.0395, 0.005, -0.05);
    // The red slit and the one on the trigger housing
    box(B.glow, 0.002, 0.004, 0.032, s * 0.0405, 0.005, -0.05);
    bolt(s * 0.041, 0.04, -0.02);
    bolt(s * 0.041, 0.04, 0.045);
    bolt(s * 0.041, -0.015, 0.075);
    bolt(s * 0.034, -0.03, 0.135);
    // A notch cut in the upper plate
    box(B.dark, 0.003, 0.008, 0.024, s * 0.0405, 0.042, -0.062);
  }
  // A charging stub on the right, the ejection port above it
  box(B.dark, 0.016, 0.01, 0.012, 0.042, 0.052, 0.09);
  box(B.dark, 0.003, 0.022, 0.05, 0.034, 0.03, 0.04);

  // ---- Trigger housing, guard and trigger
  box(B.steel, 0.04, 0.03, 0.09, 0, -0.05, 0.17);
  const guard = new THREE.TorusGeometry(0.027, 0.004, 6, 16, Math.PI * 1.15);
  guard.rotateZ(Math.PI * 0.92);
  guard.rotateY(Math.PI / 2);
  guard.translate(0, -0.066, 0.168);
  B.dark.push(guard);
  box(B.dark, 0.006, 0.028, 0.006, 0, -0.07, 0.16, 0.35, 0, 0);

  // ---- Pistol grip: raked back, stippled panels, a red slit on its side
  box(B.poly, 0.036, 0.12, 0.052, 0, -0.1, 0.235, 0.32, 0, 0);
  box(B.poly, 0.04, 0.014, 0.06, 0, -0.158, 0.252, 0.32, 0, 0);
  for (const s of [-1, 1]) {
    box(B.dark, 0.002, 0.07, 0.034, s * 0.019, -0.105, 0.236, 0.32, 0, 0);
    box(B.glow, 0.002, 0.003, 0.016, s * 0.0205, -0.1, 0.25, 0.32, 0, 0);
  }

  // ---- Skeleton stock: top bar, a raked lower strut, a cheek riser, the buttpad
  box(B.poly, 0.05, 0.03, 0.34, 0, 0.032, 0.34);
  box(B.poly, 0.056, 0.028, 0.16, 0, 0.058, 0.36, 0.06, 0, 0);
  box(B.poly, 0.036, 0.022, 0.31, 0, -0.045, 0.37, -0.28, 0, 0);
  box(B.poly, 0.036, 0.09, 0.03, 0, -0.012, 0.25);
  box(B.poly, 0.058, 0.2, 0.05, 0, -0.012, 0.525);
  box(B.dark, 0.06, 0.205, 0.016, 0, -0.012, 0.554);
  for (const s of [-1, 1]) {
    box(B.dark, 0.003, 0.012, 0.11, s * 0.026, 0.032, 0.36);
    box(B.glow, 0.002, 0.003, 0.03, s * 0.0262, 0.0, 0.47);
    box(B.dark, 0.003, 0.06, 0.02, s * 0.0295, -0.03, 0.51);
  }

  // ---- The pump (its own group): a slide under the barrels with a red slit, and the loop
  const pb = (b: Bucket, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): void =>
    box(b, w, h, d, x, y + 0.004, z + 0.2, rx);
  pb(P.steel, 0.07, 0.038, 0.2, 0, -0.03, -0.27);
  pb(P.dark, 0.074, 0.008, 0.19, 0, -0.012, -0.27);
  for (let z = -0.355; z <= -0.19; z += 0.018) pb(P.dark, 0.075, 0.016, 0.006, 0, -0.035, z);
  for (const s of [-1, 1]) pb(P.glow, 0.002, 0.005, 0.03, s * 0.036, -0.03, -0.2);
  // The loop: down and forward from the slide's back, round and up to its front
  const loopPts = [
    new THREE.Vector3(0, -0.045, -0.19),
    new THREE.Vector3(0, -0.085, -0.2),
    new THREE.Vector3(0, -0.11, -0.25),
    new THREE.Vector3(0, -0.105, -0.33),
    new THREE.Vector3(0, -0.075, -0.37),
    new THREE.Vector3(0, -0.048, -0.36)
  ].map((p) => p.add(new THREE.Vector3(0, 0.004, 0.2)));
  const loop = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(loopPts), 24, 0.008, 8, false);
  loop.scale(1.6, 1, 1);
  P.steel.push(loop);
  // The ridged pad along the bottom of the loop
  for (let i = 0; i < 6; i++) pb(P.dark, 0.026, 0.004, 0.008, 0, -0.118 + Math.sin(i * 0.5) * 0.004, -0.255 - i * 0.014, 0.4);

  const add = (parent: THREE.Object3D, b: Bucket, m: THREE.Material): void => {
    if (!b.length) return;
    const geo = mergeGeometries(b.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    if (!geo) return;
    geo.computeVertexNormals();
    // Box UVs at gun scale tile the wear texture far too big; spread them by position instead
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(nrm.getX(i));
      const ay = Math.abs(nrm.getY(i));
      const u = ax > ay ? pos.getZ(i) : pos.getX(i) + pos.getZ(i);
      const v = ax > ay ? pos.getY(i) : ay > 0.5 ? pos.getZ(i) * 0.7 : pos.getY(i);
      uv[i * 2] = u * 4;
      uv[i * 2 + 1] = v * 4;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    parent.add(mesh);
  };
  add(group, B.steel, M.steel);
  add(group, B.poly, M.poly);
  add(group, B.dark, M.dark);
  add(group, B.glow, M.glow);
  add(group, B.bore, M.bore);
  add(pump, P.steel, M.steel);
  add(pump, P.dark, M.dark);
  add(pump, P.glow, M.glow);

  // ---- The pressure gauge, on the left of the receiver, canted up to face him:
  // a canister under the barrels feeding a manifold, and a housing with three
  // sight glasses that fill, one for each charge
  const gauge = new THREE.Group();
  gauge.position.set(-0.062, 0.052, -0.055);
  // Turned back and up toward his eye, so the glasses read from where he holds it
  gauge.rotation.set(0, 0.75, -0.6);
  gauge.scale.setScalar(1.1);
  // Its bracket back to the receiver
  {
    const br = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.05), M.dark);
    br.position.set(-0.045, 0.04, -0.04);
    br.frustumCulled = false;
    group.add(br);
  }
  group.add(gauge);
  const gm = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.frustumCulled = false;
    gauge.add(m);
    return m;
  };
  gm(new THREE.BoxGeometry(0.012, 0.05, 0.132), M.dark, -0.004, 0, 0);
  gm(new THREE.BoxGeometry(0.004, 0.056, 0.006), M.steel, -0.0095, 0, -0.066);
  gm(new THREE.BoxGeometry(0.004, 0.056, 0.006), M.steel, -0.0095, 0, 0.066);
  for (const [y, z] of [[0.02, -0.058], [-0.02, -0.058], [0.02, 0.058], [-0.02, 0.058]]) {
    const b = new THREE.CylinderGeometry(0.0028, 0.0028, 0.003, 6);
    b.rotateZ(Math.PI / 2);
    gm(b, M.steel, -0.0112, y, z);
  }
  const glassBack = new THREE.MeshBasicMaterial({ color: 0x050607 });
  const fills: THREE.Mesh[] = [];
  const fillMats: THREE.MeshStandardMaterial[] = [];
  const CELL_H = 0.034;
  for (let i = 0; i < 3; i++) {
    // Front (muzzle end) cell is the first charge
    const z = -0.04 + i * 0.04;
    gm(new THREE.BoxGeometry(0.002, CELL_H + 0.004, 0.03), glassBack, -0.0105, 0, z);
    const fm = new THREE.MeshStandardMaterial({ color: 0x06222a, emissive: 0x35e0ff, emissiveIntensity: 0.95, roughness: 0.4 });
    const fill = gm(new THREE.BoxGeometry(0.0024, CELL_H, 0.026), fm, -0.0112, 0, z);
    fills.push(fill);
    fillMats.push(fm);
    // Tick marks beside each glass
    for (let k = 0; k < 3; k++) gm(new THREE.BoxGeometry(0.001, 0.0012, 0.005), M.steel, -0.0106, -0.012 + k * 0.012, z + 0.0175);
  }
  // The canister slung under the left barrels, its valve, and the line up to the housing
  const tank = new THREE.CylinderGeometry(0.013, 0.013, 0.12, 12);
  tank.rotateX(Math.PI / 2);
  const tankM = new THREE.Mesh(tank, new THREE.MeshStandardMaterial({ color: 0x1f6f86, roughness: 0.45, metalness: 0.6 }));
  tankM.position.set(-0.052, 0.004, -0.14);
  tankM.frustumCulled = false;
  group.add(tankM);
  for (const z of [-0.2, -0.08]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), M.steel);
    cap.position.set(-0.052, 0.004, z);
    cap.scale.z = 0.6;
    cap.frustumCulled = false;
    group.add(cap);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.034, 0.008), M.dark);
    strap.position.set(-0.047, 0.006, z + (z < -0.1 ? 0.03 : -0.03));
    strap.frustumCulled = false;
    group.add(strap);
  }
  const line = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.052, 0.004, -0.074), new THREE.Vector3(-0.056, 0.012, -0.055), new THREE.Vector3(-0.05, 0.03, -0.045), new THREE.Vector3(-0.046, 0.036, -0.036)]), 10, 0.0032, 6, false),
    M.steel
  );
  line.frustumCulled = false;
  group.add(line);
  const COL_FULL = new THREE.Color(0x35e0ff);
  const COL_FILL = new THREE.Color(0xff9a2a);
  const COL_OUT = new THREE.Color(0xff2a12);
  const setPressure = (p: number, flash = 0): void => {
    for (let i = 0; i < 3; i++) {
      const k = Math.min(1, Math.max(0, p - i));
      const f = fills[i];
      f.visible = k > 0.02 || flash > 0;
      const s = Math.max(k, flash > 0 ? 1 : 0.02);
      f.scale.y = s;
      f.position.y = -CELL_H * (1 - s) * 0.5;
      const m = fillMats[i];
      if (flash > 0 && k < 1) {
        m.emissive.copy(COL_OUT);
        m.emissiveIntensity = 3 * flash;
      } else {
        m.emissive.copy(k >= 1 ? COL_FULL : COL_FILL);
        m.emissiveIntensity = k >= 1 ? 0.95 : 0.85;
      }
    }
  };
  setPressure(3);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, (BY0 + BY1) / 2, -0.525);
  group.add(muzzle);
  return { group, pump, muzzle, setPressure };
}
