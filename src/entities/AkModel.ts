import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Enemy } from './Enemy';

/**
 * The AK-47 model, loaded and parsed once for the whole game.
 *
 * The viewmodel and every agent who carries one used to load the glb for
 * themselves. The bytes came out of the browser's cache, but each copy was
 * parsed again and arrived whenever it arrived — after the level was up,
 * so its materials compiled on whatever frame it first appeared, mid-level.
 * Now main holds the first level behind its loading card until this has
 * arrived, and everyone takes a copy of the same one: the geometry and the
 * materials are shared, and there is nothing left to compile late.
 */
let loading: Promise<THREE.Group> | null = null;
let template: THREE.Group | null = null;

export function loadAK(): Promise<THREE.Group> {
  if (!loading) {
    loading = new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}models/ak47.glb`)
      .then((gltf) => (template = gltf.scene));
  }
  return loading;
}

/**
 * A copy of the AK for `fn`: straight away if it has arrived, or as soon as
 * it does. Each call gets its own copy, sharing the original's geometry and
 * materials.
 */
export function withAK(fn: (copy: THREE.Group) => void): void {
  if (template) {
    fn(template.clone(true));
    return;
  }
  void loadAK().then((t) => fn(t.clone(true)));
}

/**
 * The AK in an agent's hands: real size, and its landmarks in the glb's own
 * frame, where the muzzle points down +X.
 */
const AK_SCALE = 0.95;
const AK_GRIP = [-0.08, -0.05] as const;
const AK_GUARD = [0.255, -0.035] as const;
const AK_MUZZLE = [0.58, 0.022] as const;

/** glb (x, y) → weapon space, muzzle down −Z, as the viewmodel maps it. */
function akPoint(p: readonly [number, number]): THREE.Vector3 {
  return new THREE.Vector3(0, p[1] * AK_SCALE, -p[0] * AK_SCALE);
}

/**
 * The agents' AK: the same gun, baked down to two meshes — the metal, and
 * everything else — with each part's texture taken down to the colour it
 * averages to. In an agent's hands it is a few pixels across, and the full
 * model is seventy-three meshes over ten materials: a floor of agents
 * carrying one each was most of the frame's draws. Baked once, shared by
 * every copy.
 */
let lite: { geos: THREE.BufferGeometry[]; mats: THREE.Material[] } | null = null;

/** A material's colour with its texture, if it has one, averaged in. */
function averageColour(m: THREE.MeshStandardMaterial): THREE.Color {
  const c = m.color ? m.color.clone() : new THREE.Color(0xffffff);
  const img = m.map?.image as CanvasImageSource | undefined;
  if (!img) return c;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 8;
  const g = cv.getContext('2d');
  if (!g) return c;
  try {
    g.drawImage(img, 0, 0, 8, 8);
  } catch {
    return c;
  }
  const d = g.getImageData(0, 0, 8, 8).data;
  let r = 0;
  let gr = 0;
  let b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    gr += d[i + 1];
    b += d[i + 2];
  }
  const n = (d.length / 4) * 255;
  return c.multiply(new THREE.Color().setRGB(r / n, gr / n, b / n, THREE.SRGBColorSpace));
}

/** A float copy of an attribute, whatever it was stored as. */
function floats(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) {
    out[i * 3] = a.getX(i);
    out[i * 3 + 1] = a.getY(i);
    out[i * 3 + 2] = a.getZ(i);
  }
  return new THREE.BufferAttribute(out, 3);
}

function bakeLite(t: THREE.Group): { geos: THREE.BufferGeometry[]; mats: THREE.Material[] } {
  t.updateMatrixWorld(true);
  // Template space → weapon space, as the agents carry it: turned so the
  // barrel runs down −Z, and at their scale
  const toWeapon = new THREE.Matrix4()
    .makeRotationY(Math.PI / 2)
    .multiply(new THREE.Matrix4().makeScale(AK_SCALE, AK_SCALE, AK_SCALE))
    .multiply(t.matrixWorld.clone().invert());
  const metal: THREE.BufferGeometry[] = [];
  const rest: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  t.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const src = mesh.geometry;
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', floats(src.attributes.position));
    if (src.attributes.normal) g.setAttribute('normal', floats(src.attributes.normal));
    if (src.index) g.setIndex(src.index.clone());
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(m.multiplyMatrices(toWeapon, mesh.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const col = averageColour(mat);
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      cols[i * 3] = col.r;
      cols[i * 3 + 1] = col.g;
      cols[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    ((mat.metalness ?? 0) > 0.5 ? metal : rest).push(g);
  });
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const add = (list: THREE.BufferGeometry[], mat: THREE.Material): void => {
    const one = list.length ? mergeGeometries(list, false) : null;
    for (const g of list) g.dispose();
    if (!one) return;
    geos.push(one);
    mats.push(mat);
  };
  add(metal, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.85 }));
  add(rest, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }));
  return { geos, mats };
}

/** The agents' AK, in weapon space: barrel down −Z, at their scale. */
function liteAK(t: THREE.Group): THREE.Group {
  if (!lite) lite = bakeLite(t);
  const g = new THREE.Group();
  lite.geos.forEach((geo, i) => g.add(new THREE.Mesh(geo, lite!.mats[i])));
  return g;
}

/** The whole model at an agent's scale, every part and texture: for one seen up close. */
function fullAK(copy: THREE.Group): THREE.Group {
  const wrap = new THREE.Group();
  copy.rotation.y = Math.PI / 2;
  copy.scale.setScalar(AK_SCALE);
  wrap.add(copy);
  return wrap;
}

/**
 * Put a real AK in an agent's hands, in place of the stand-in rifle: baked
 * down, or with `full` the whole model — for the few seen from a couple of
 * metres away in a cutscene, where the wood grain shows.
 */
export function armWithAK(e: Enemy, full = false): void {
  const equip = (model: THREE.Group): void => e.equipWeapon(model, akPoint(AK_GRIP), akPoint(AK_GUARD), akPoint(AK_MUZZLE));
  if (full) withAK((copy) => equip(fullAK(copy)));
  else withTemplate((t) => equip(liteAK(t)));
}

/** The loaded original, not a copy: for baking from. */
function withTemplate(fn: (t: THREE.Group) => void): void {
  if (template) fn(template);
  else void loadAK().then(fn);
}

/**
 * An AK lying on the floor where somebody dropped it: on its side, at an
 * agent's scale. The group comes back at once; the gun goes into it as soon
 * as the model is there.
 */
export function droppedAK(): THREE.Group {
  const g = new THREE.Group();
  withTemplate((t) => {
    const gun = liteAK(t);
    // On its side on the carpet: the barrel along the floor, the top turned over
    gun.rotation.z = Math.PI / 2;
    gun.position.y = 0.035;
    g.add(gun);
  });
  return g;
}
