import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * RaviVisual — the player's own body, from models/ravi.glb (built by
 * models/ravi_build.py): one skinned mesh on a 55-bone rig, three joints in
 * every finger.
 *
 * Nothing here decides where Ravi's hands go. Every viewmodel still animates
 * the same anchors it always did (the old box hands); a FirstPersonArms reads
 * those anchors each frame and lays his real arm onto them: the hand where the
 * box was, the forearm along the line the box forearm took, the fingers in a
 * shape that fits what the hand is holding.
 *
 * Posing works like the Blender build's Pose class: each bone gets a rotation
 * in the model's rest space, either absolute or on top of its parent's, and
 * the local rotations are worked out from those.
 */

export type Side = 'l' | 'r';
export type Curl3 = [number, number, number];

/**
 * A hand shape. `fingers` is index, middle, ring, pinky: extra bend in
 * degrees at the knuckle, middle and end joints. `thumb` is the same for the
 * thumb's three bones, as fractions of 60°. `spread` fans the fingers (deg);
 * `splay` swings each finger on its own at the knuckle, + toward the thumb.
 */
export interface HandShape {
  fingers: [Curl3, Curl3, Curl3, Curl3];
  thumb: Curl3;
  spread?: number;
  splay?: [number, number, number, number];
}

export const HAND = {
  /** Hanging loose. */
  relaxed: { fingers: [[14, 20, 12], [16, 24, 14], [18, 27, 15], [21, 30, 17]], thumb: [0.15, 0.25, 0.25] } as HandShape,
  /** Flat and open. */
  open: { fingers: [[3, 4, 2], [3, 4, 2], [4, 5, 3], [5, 6, 4]], thumb: [0.0, 0.1, 0.1], spread: 4 } as HandShape,
  /** Tight fist, thumb across the front. */
  fist: { fingers: [[85, 100, 63], [85, 100, 63], [85, 100, 63], [85, 100, 63]], thumb: [0.55, 0.9, 0.8] } as HandShape
};

const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
const I = new THREE.Quaternion();

interface RestBone {
  name: string;
  parent: string | null;
  localQ: THREE.Quaternion;
  localP: THREE.Vector3;
  modelQ: THREE.Quaternion;
  modelP: THREE.Vector3;
}

/**
 * 'body' is the whole man. 'arms' and 'legs' are just those limbs, for the
 * first-person view. 'seated' is him without his head (the camera is where
 * it would be), his arms kept apart from the rest so each can go on its own.
 */
export type Parts = 'body' | 'arms' | 'legs' | 'seated';
type Limb = 'arm' | 'leg';
const LIMB_BONES: Record<Limb, RegExp> = {
  arm: /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/,
  leg: /^(thigh|calf|foot|ball)_/
};
/** His head, neck and eyes: what a view from his own eyes leaves out. */
const HEAD_BONES = /^(head|neck_01|eye_l|eye_r)$/;
const HEAD_MATS = new Set(['G_Hair', 'Eye']);
/** What a leg is made of: the shirt tail and belt ride the thighs too, and stay behind. */
const LEG_MATS = new Set(['G_Trousers', 'G_Socks', 'G_Shoes', 'G_Soles']);

interface Prim {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  /** Per limb and side, just the triangles that belong to it (built on first use). */
  cut: Map<string, THREE.BufferGeometry | null>;
  /** Per bone set, which vertices are mostly on it. */
  masks: Map<string, Uint8Array>;
}

// ------------------------------------------------------------------ vectors
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** Rotation whose Y column is `y` and Z column is `z` (made perpendicular). */
function basisQ(y: THREE.Vector3, z: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const Y = _v.copy(y).normalize();
  const Z = _w.copy(z).addScaledVector(Y, -z.dot(Y)).normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  _m.makeBasis(X, Y, Z);
  return out.setFromRotationMatrix(_m);
}

/** Rotation taking rest vectors (a0, b0) onto (a1, b1), b's made perpendicular to a's. */
function frameQ(a0: THREE.Vector3, b0: THREE.Vector3, a1: THREE.Vector3, b1: THREE.Vector3): THREE.Quaternion {
  const q0 = basisQ(a0, b0, new THREE.Quaternion());
  const q1 = basisQ(a1, b1, new THREE.Quaternion());
  return q1.multiply(q0.invert());
}

/** The part of `q` that turns about unit `axis`, as an angle. */
function twistAngle(q: THREE.Quaternion, axis: THREE.Vector3): number {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  return 2 * Math.atan2(d, q.w);
}

// ------------------------------------------------------------------ the model
export class RaviVisual {
  private static rest = new Map<string, RestBone>();
  /** Bone names parents-first. */
  private static order: string[] = [];
  /** Skin joint order, and the inverse bind matrices that go with it. */
  private static joints: string[] = [];
  private static inverses: THREE.Matrix4[] = [];
  private static bindMatrix = new THREE.Matrix4();
  private static prims: Prim[] = [];
  private static loading: Promise<void> | null = null;
  private static waiting: (() => void)[] = [];
  private static ok = false;

  /** Each hand's axes at rest (model space). */
  static handRest: Record<Side, { along: THREE.Vector3; palm: THREE.Vector3; thumb: THREE.Vector3 }> | null = null;

  static get ready(): boolean {
    return RaviVisual.ok;
  }

  /** Fetch and prepare the model. Resolves either way; a failed load leaves the old box arms in place. */
  static load(url: string): Promise<void> {
    if (!RaviVisual.loading) {
      RaviVisual.loading = new GLTFLoader()
        .loadAsync(url)
        .then((gltf) => {
          RaviVisual.prepare(gltf.scene);
          RaviVisual.ok = true;
          const w = RaviVisual.waiting;
          RaviVisual.waiting = [];
          for (const cb of w) cb();
        })
        .catch((err) => {
          console.warn('Ravi model failed to load; the box arms stay', err);
        });
    }
    return RaviVisual.loading;
  }

  /** Run `cb` once the model is in (straight away if it already is). */
  static whenReady(cb: () => void): void {
    if (RaviVisual.ok) cb();
    else RaviVisual.waiting.push(cb);
  }

  private static prepare(scene: THREE.Object3D): void {
    scene.updateMatrixWorld(true);
    let skinned: THREE.SkinnedMesh | null = null;
    const meshes: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        meshes.push(m);
        skinned ??= m;
      }
    });
    if (!skinned) throw new Error('no skinned mesh in ravi.glb');
    const skel = (skinned as THREE.SkinnedMesh).skeleton;
    RaviVisual.bindMatrix.copy((skinned as THREE.SkinnedMesh).bindMatrix);
    RaviVisual.joints = skel.bones.map((b) => b.name);
    RaviVisual.inverses = skel.boneInverses.map((m) => m.clone());

    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const walk = (b: THREE.Object3D, parent: string | null) => {
      if (!(b as THREE.Bone).isBone) return;
      b.matrixWorld.decompose(p, q, s);
      RaviVisual.rest.set(b.name, {
        name: b.name,
        parent,
        localQ: b.quaternion.clone(),
        localP: b.position.clone(),
        modelQ: q.clone(),
        modelP: p.clone()
      });
      RaviVisual.order.push(b.name);
      for (const c of b.children) walk(c, b.name);
    };
    walk(skel.bones.find((b) => !(b.parent as THREE.Bone)?.isBone)!, null);

    const at = (n: string) => RaviVisual.rest.get(n)!.modelP;
    const axes = (sd: Side) => {
      const r = RaviVisual.rest.get(`hand_${sd}`)!;
      const along = new THREE.Vector3(0, 1, 0).applyQuaternion(r.modelQ);
      const palm = new THREE.Vector3(0, 0, 1).applyQuaternion(r.modelQ);
      const thumb = at(`index_01_${sd}`).clone().sub(at(`pinky_01_${sd}`));
      thumb.addScaledVector(along, -thumb.dot(along)).normalize();
      return { along, palm, thumb };
    };
    RaviVisual.handRest = { l: axes('l'), r: axes('r') };

    // Plain standard materials, as the agents get: the glTF's specular and
    // clearcoat extensions buy nothing under the game's lights
    const mats = new Map<string, THREE.Material>();
    for (const m of meshes) {
      const src = m.material as THREE.MeshStandardMaterial;
      let mat = mats.get(src.name);
      if (!mat) {
        mat = RaviVisual.plain(src);
        mats.set(src.name, mat);
      }
      RaviVisual.prims.push({ geo: m.geometry, mat, cut: new Map(), masks: new Map() });
    }
  }

  private static plain(src: THREE.MeshStandardMaterial): THREE.Material {
    const m = new THREE.MeshStandardMaterial({
      name: src.name,
      color: src.color,
      map: src.map,
      roughness: src.roughness,
      metalness: src.metalness
    });
    switch (src.name) {
      case 'SkinGame':
        // The colour lives in the vertices: lighter palms and nail beds, lips, stubble
        m.vertexColors = true;
        m.roughness = 0.62;
        break;
      case 'G_Metal':
      case 'G_Markers':
        // Full metal reflects an environment, and the levels have none
        m.metalness = 0.55;
        m.roughness = 0.3;
        break;
      case 'G_Shirt':
        m.roughness = 0.88;
        break;
    }
    return m;
  }

  static restBone(name: string): RestBone {
    return RaviVisual.rest.get(name)!;
  }

  static get boneOrder(): readonly string[] {
    return RaviVisual.order;
  }

  /** Per vertex, 1 where at least half its weight is on bones matching `test`. */
  private static mask(prim: Prim, key: string, test: (bone: string) => boolean): Uint8Array {
    const have = prim.masks.get(key);
    if (have) return have;
    const set = new Set<number>();
    RaviVisual.joints.forEach((n, i) => {
      if (test(n)) set.add(i);
    });
    const ji = prim.geo.getAttribute('skinIndex');
    const jw = prim.geo.getAttribute('skinWeight');
    const out = new Uint8Array(ji.count);
    for (let v = 0; v < ji.count; v++) {
      let w = 0;
      for (let c = 0; c < 4; c++) if (set.has(ji.getComponent(v, c))) w += jw.getComponent(v, c);
      out[v] = w >= 0.5 ? 1 : 0;
    }
    prim.masks.set(key, out);
    return out;
  }

  /** A geometry sharing `prim`'s attributes with just the triangles `keep` passes (by corner flags). */
  private static cutBy(prim: Prim, key: string, keep: (a: number, b: number, c: number) => boolean): THREE.BufferGeometry | null {
    const have = prim.cut.get(key);
    if (have !== undefined) return have;
    const idx = prim.geo.getIndex()!;
    const tris: number[] = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      if (keep(a, b, c)) tris.push(a, b, c);
    }
    let out: THREE.BufferGeometry | null = null;
    if (tris.length) {
      out = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(prim.geo.attributes)) out.setAttribute(name, attr);
      out.setIndex(tris);
    }
    prim.cut.set(key, out);
    return out;
  }

  /**
   * One limb's triangles: those whose three corners are each at least half
   * weighted to its bones (upper arm down to the fingertips, or thigh to toe).
   */
  private static limbGeometry(prim: Prim, limb: Limb, side: Side): THREE.BufferGeometry | null {
    const key = `${limb}_${side}`;
    if (limb === 'leg' && !LEG_MATS.has(prim.mat.name)) return null;
    const m = RaviVisual.mask(prim, key, (n) => n.endsWith(`_${side}`) && LIMB_BONES[limb].test(n));
    return RaviVisual.cutBy(prim, key, (a, b, c) => !!(m[a] & m[b] & m[c]));
  }

  /** Everything but his head and his two arms. */
  private static trunkGeometry(prim: Prim): THREE.BufferGeometry | null {
    if (HEAD_MATS.has(prim.mat.name)) return null;
    const h = RaviVisual.mask(prim, 'head', (n) => HEAD_BONES.test(n));
    const l = RaviVisual.mask(prim, 'arm_l', (n) => n.endsWith('_l') && LIMB_BONES.arm.test(n));
    const r = RaviVisual.mask(prim, 'arm_r', (n) => n.endsWith('_r') && LIMB_BONES.arm.test(n));
    const arm = (v: number) => l[v] | r[v];
    return RaviVisual.cutBy(prim, 'trunk', (a, b, c) => !(h[a] | h[b] | h[c]) && !(arm(a) & arm(b) & arm(c)));
  }

  /**
   * A posable copy. 'body' is the whole man; 'arms' and 'legs' are just those
   * limbs, each side shown or hidden on its own, for the first-person view.
   */
  static rig(parts: Parts): RaviRig {
    return new RaviRig(parts);
  }

  /** Internal: what RaviRig needs to build itself. */
  static build(parts: Parts, skeleton: THREE.Skeleton): { mesh: THREE.SkinnedMesh; side: Side | null }[] {
    const out: { mesh: THREE.SkinnedMesh; side: Side | null }[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, side: Side | null) => {
      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.bind(skeleton, RaviVisual.bindMatrix);
      mesh.frustumCulled = false; // the bind-pose bounds are no use once posed
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      out.push({ mesh, side });
    };
    for (const prim of RaviVisual.prims) {
      if (parts === 'body') {
        add(prim.geo, prim.mat, null);
        continue;
      }
      if (parts === 'seated') {
        const g = RaviVisual.trunkGeometry(prim);
        if (g) add(g, prim.mat, null);
      }
      for (const sd of ['l', 'r'] as Side[]) {
        const g = RaviVisual.limbGeometry(prim, parts === 'legs' ? 'leg' : 'arm', sd);
        if (g) add(g, prim.mat, sd);
      }
    }
    return out;
  }

  static get jointNames(): readonly string[] {
    return RaviVisual.joints;
  }

  static get boneInverses(): readonly THREE.Matrix4[] {
    return RaviVisual.inverses;
  }
}

/** The trunk, pelvis to head, in the order SeatPose's arrays run. */
const TRUNK = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'];

/** Where the middle joint of a two-bone limb goes, `a` then `b` long from `root` to `end`, bending toward `pole`. */
function twoBone(root: THREE.Vector3, end: THREE.Vector3, a: number, b: number, pole: THREE.Vector3): THREE.Vector3 {
  const w = end.clone().sub(root);
  const d = THREE.MathUtils.clamp(w.length(), Math.abs(a - b) + 1e-3, (a + b) * 0.999);
  w.normalize();
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const n = pole.clone().addScaledVector(w, -pole.dot(w)).normalize();
  return root.clone().addScaledVector(w, x).addScaledVector(n, h);
}

/** A sitting pose, all in model space (he faces +Z, his left on +X). */
export interface SeatPose {
  /** Where the midpoint of his two hip joints goes. */
  hips: THREE.Vector3;
  /** Degrees forward (+) or back for pelvis, spine_01, spine_02, spine_03, neck_01, head. */
  lean: number[];
  /** Degrees turned to his left (+), same bones. */
  twist?: number[];
  /** Degrees tipped about his front-to-back axis (+ drops his right side), same bones. */
  roll?: number[];
  /** Each ankle joint, and which way that knee points. */
  legs: Record<Side, { ankle: THREE.Vector3; knee: THREE.Vector3; turn?: number }>;
  /** Each arm that is doing something: wrist, back of the hand, palm, elbow pole, fingers. */
  arms: Partial<Record<Side, { wrist: THREE.Vector3; along: THREE.Vector3; palm: THREE.Vector3; elbow: THREE.Vector3; shape: HandShape }>>;
}

// ------------------------------------------------------------------ a copy
export class RaviRig {
  /** Put this in the scene. Model space is its local space: Y up, facing +Z, his left on +X. */
  readonly root = new THREE.Group();
  readonly bones = new Map<string, THREE.Bone>();
  private parts: { mesh: THREE.SkinnedMesh; side: Side | null }[];
  private ent = new Map<string, ['abs' | 'rel', THREE.Quaternion]>();
  private shift = new Map<string, THREE.Vector3>();
  private tot = new Map<string, THREE.Quaternion>();

  constructor(parts: Parts) {
    for (const name of RaviVisual.boneOrder) {
      const r = RaviVisual.restBone(name);
      const b = new THREE.Bone();
      b.name = name;
      b.position.copy(r.localP);
      b.quaternion.copy(r.localQ);
      (r.parent ? this.bones.get(r.parent)! : this.root).add(b);
      this.bones.set(name, b);
    }
    const skeleton = new THREE.Skeleton(
      RaviVisual.jointNames.map((n) => this.bones.get(n)!),
      RaviVisual.boneInverses.map((m) => m.clone())
    );
    this.parts = RaviVisual.build(parts, skeleton);
    for (const p of this.parts) this.root.add(p.mesh);
  }

  /** Show or hide one side's limb (arms and legs copies only). */
  showSide(side: Side, on: boolean): void {
    for (const p of this.parts) if (p.side === side) p.mesh.visible = on;
  }

  /** Every mesh, for callers that want to tweak render flags. */
  get meshes(): THREE.SkinnedMesh[] {
    return this.parts.map((p) => p.mesh);
  }

  // ---- posing
  /** Clear the pose back to rest. */
  clear(): this {
    this.ent.clear();
    this.shift.clear();
    return this;
  }

  /** Set a bone's rotation from rest, in model space, regardless of its parent. */
  abs(name: string, q: THREE.Quaternion): this {
    this.ent.set(name, ['abs', q.clone()]);
    return this;
  }

  /** Rotate a bone on top of whatever its parent does, about a model-space rest axis. */
  rel(name: string, q: THREE.Quaternion): this {
    this.ent.set(name, ['rel', q.clone()]);
    return this;
  }

  /** `rel` about `axis` (model space, rest) by `deg` degrees. */
  turn(name: string, axis: THREE.Vector3 | [number, number, number], deg: number): this {
    const a = Array.isArray(axis) ? new THREE.Vector3(...axis) : axis.clone();
    return this.rel(name, new THREE.Quaternion().setFromAxisAngle(a.normalize(), THREE.MathUtils.degToRad(deg)));
  }

  /** Move a bone's head by `d` (model space) from where its parent would put it. */
  move(name: string, d: THREE.Vector3): this {
    this.shift.set(name, d.clone());
    return this;
  }

  /** Model-space rest direction of a bone (head toward tail). */
  static dir(name: string): THREE.Vector3 {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(RaviVisual.restBone(name).modelQ);
  }

  /** Rest length of a bone: head to its first child's head. */
  static len(name: string, child: string): number {
    return RaviVisual.restBone(name).modelP.distanceTo(RaviVisual.restBone(child).modelP);
  }

  /** Curl the fingers of one hand into `shape`. */
  hand(side: Side, shape: HandShape): this {
    const hr = RaviVisual.handRest![side];
    const sgn = side === 'l' ? 1 : -1;
    FINGERS.forEach((f, i) => {
      const sp = ({ index: 1.0, middle: 0.2, ring: -0.6, pinky: -1.2 } as const)[f] * (shape.spread ?? 0) + (shape.splay?.[i] ?? 0);
      for (let j = 0; j < 3; j++) {
        const nm = `${f}_0${j + 1}_${side}`;
        const d = restDir(nm);
        const axis = new THREE.Vector3().crossVectors(d, hr.palm).normalize();
        const q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(shape.fingers[i][j]));
        if (j === 0 && sp) q.premultiply(new THREE.Quaternion().setFromAxisAngle(hr.palm, THREE.MathUtils.degToRad(sp) * sgn));
        this.rel(nm, q);
      }
    });
    const pad = hr.palm.clone().multiplyScalar(0.55).addScaledVector(hr.thumb, -0.83).normalize();
    for (let j = 0; j < 3; j++) {
      const nm = `thumb_0${j + 1}_${side}`;
      const axis = new THREE.Vector3().crossVectors(restDir(nm), pad).normalize();
      this.rel(nm, new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(shape.thumb[j] * 60)));
    }
    return this;
  }

  /**
   * Lay one arm onto a target, all in model space: the wrist at `wrist`, the
   * back of the hand running `along` (wrist to middle knuckle), the palm
   * facing `palm`, the forearm leaving the wrist toward `elbowDir`. The
   * shoulder is put where the upper arm, at its real length, reaches toward
   * `shoulder` from that elbow; the collarbone moves to meet it (it is never
   * drawn in first person). Half the wrist's turn is taken up by the forearm
   * so the skin at the wrist does not wring.
   */
  reach(
    side: Side,
    wrist: THREE.Vector3,
    along: THREE.Vector3,
    palm: THREE.Vector3,
    elbowDir: THREE.Vector3,
    shoulder: THREE.Vector3,
    twistShare = 0.5,
    /** False when the shoulder is his own (a whole body): the collarbone stays put. */
    freeShoulder = true
  ): this {
    const ua = `upperarm_${side}`;
    const fa = `lowerarm_${side}`;
    const h = `hand_${side}`;
    const a = RaviRig.len(ua, fa);
    const b = RaviRig.len(fa, h);
    const E = wrist.clone().addScaledVector(elbowDir.clone().normalize(), b);
    const S = E.clone().addScaledVector(shoulder.clone().sub(E).normalize(), a);
    const dua = E.clone().sub(S).normalize();
    const dfa = wrist.clone().sub(E).normalize();
    const U1 = restDir(ua);
    const U2 = restDir(fa);
    const Hr = new THREE.Vector3().crossVectors(U1, U2).normalize();
    const Hn = new THREE.Vector3().crossVectors(dua, dfa);
    if (Hn.lengthSq() < 1e-8) {
      // Dead straight: any hinge square to the arm will do; take the one the palm suggests
      Hn.crossVectors(dua, palm);
      if (Hn.lengthSq() < 1e-8) Hn.set(1, 0, 0).cross(dua);
    }
    Hn.normalize();
    const Dua = frameQ(U1, Hr, dua, Hn);
    const Dfa = frameQ(U2, Hr, dfa, Hn);
    const Wh = basisQ(along, palm);
    const Dh = Wh.multiply(_q.copy(RaviVisual.restBone(h).modelQ).invert());
    const R = Dfa.clone().invert().multiply(Dh);
    const tw = twistAngle(R, U2);
    Dfa.multiply(new THREE.Quaternion().setFromAxisAngle(U2, tw * twistShare));
    this.abs(ua, Dua).abs(fa, Dfa).abs(h, Dh);
    if (freeShoulder) this.move(`clavicle_${side}`, S.sub(RaviVisual.restBone(ua).modelP));
    return this;
  }

  /**
   * Lay one leg, in model space: the hip joint at `hip`, the thigh running
   * `thighDir`, the shin `shinDir`, the front of the thigh (kneecap) facing
   * `front`. The knee is a hinge, so the shin shares the thigh's side-to-side
   * axis; the foot keeps its angle to the shin.
   */
  leg(
    side: Side,
    hip: THREE.Vector3,
    thighDir: THREE.Vector3,
    shinDir: THREE.Vector3,
    front: THREE.Vector3,
    /** False when the hip is his own (a whole body): the thigh stays in its socket. */
    freeHip = true
  ): this {
    const th = `thigh_${side}`;
    const ca = `calf_${side}`;
    const T0 = restDir(th);
    const C0 = restDir(ca);
    const hinge0 = new THREE.Vector3().crossVectors(T0, new THREE.Vector3(0, 0, 1)).normalize();
    const hinge = new THREE.Vector3().crossVectors(thighDir, front).normalize();
    this.abs(th, frameQ(T0, hinge0, thighDir, hinge)).abs(ca, frameQ(C0, hinge0, shinDir, hinge));
    if (freeHip) this.move(th, hip.clone().sub(RaviVisual.restBone(th).modelP));
    return this;
  }

  /** Where a bone's head is right now, in model space (after apply()). */
  at(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    _m.copy(this.root.matrixWorld).invert().multiply(this.bones.get(name)!.matrixWorld);
    return out.setFromMatrixPosition(_m);
  }

  /** The meshes that make up one side's limb ('arms', 'legs' and 'seated' copies). */
  sideMeshes(side: Side): THREE.SkinnedMesh[] {
    return this.parts.filter((p) => p.side === side).map((p) => p.mesh);
  }

  /**
   * Sit him down (a whole-body copy), in model space. The trunk bends first,
   * forward from the pelvis up; then the pelvis is moved so his hip joints
   * are at `hips`; then each leg reaches its ankle with the knee toward its
   * pole and the foot flat, and each arm given reaches its wrist with the
   * elbow toward its pole.
   */
  seat(p: SeatPose): void {
    this.clear();
    const X = new THREE.Vector3(1, 0, 0);
    const Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3(0, 0, 1);
    TRUNK.forEach((n, i) => {
      const q = new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(p.lean[i] ?? 0));
      const tw = p.twist?.[i] ?? 0;
      if (tw) q.premultiply(new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(tw)));
      const rl = p.roll?.[i] ?? 0;
      if (rl) q.premultiply(new THREE.Quaternion().setFromAxisAngle(Z, THREE.MathUtils.degToRad(rl)));
      this.rel(n, q);
    });
    this.apply();
    const mid = this.at('thigh_l').add(this.at('thigh_r')).multiplyScalar(0.5);
    this.move('pelvis', p.hips.clone().sub(mid));
    this.apply();
    for (const side of ['l', 'r'] as Side[]) {
      const lg = p.legs[side];
      const H = this.at(`thigh_${side}`);
      const K = twoBone(H, lg.ankle, RaviRig.len(`thigh_${side}`, `calf_${side}`), RaviRig.len(`calf_${side}`, `foot_${side}`), lg.knee);
      const thigh = K.clone().sub(H).normalize();
      const shin = lg.ankle.clone().sub(K).normalize();
      const front = lg.knee.clone().addScaledVector(thigh, -lg.knee.dot(thigh)).normalize();
      this.leg(side, H, thigh, shin, front, false);
      // Flat on the floor, turned out a little if asked
      this.abs(`foot_${side}`, new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(lg.turn ?? 0)));
    }
    this.apply();
    for (const side of ['l', 'r'] as Side[]) {
      const a = p.arms[side];
      if (!a) continue;
      const S = this.at(`upperarm_${side}`);
      const toward = elbowToward(a.wrist, S, a.elbow);
      this.reach(side, a.wrist, a.along, a.palm, toward, S, 0.5, false).hand(side, a.shape);
    }
    this.apply();
  }

  /** Write the pose into the bones. */
  apply(): void {
    this.tot.clear();
    for (const name of RaviVisual.boneOrder) {
      const r = RaviVisual.restBone(name);
      const pt = r.parent ? this.tot.get(r.parent)! : I;
      const e = this.ent.get(name);
      const t = !e ? pt : e[0] === 'abs' ? e[1] : pt.clone().multiply(e[1]);
      this.tot.set(name, t);
      const b = this.bones.get(name)!;
      // local = Wrest_p⁻¹ · T_p⁻¹ · T · Wrest
      const wp = r.parent ? RaviVisual.restBone(r.parent).modelQ : I;
      b.quaternion
        .copy(wp)
        .invert()
        .multiply(_q.copy(pt).invert())
        .multiply(t)
        .multiply(r.modelQ);
      b.position.copy(r.localP);
      const d = this.shift.get(name);
      if (d) {
        // Into the parent's posed frame
        const pq = _q.copy(pt).multiply(wp).invert();
        b.position.add(_v.copy(d).applyQuaternion(pq));
      }
    }
  }
}

function restDir(name: string): THREE.Vector3 {
  return RaviRig.dir(name);
}

// ------------------------------------------------------------------ first person
/**
 * How a hand sits on the anchor a viewmodel animates, in that anchor's own
 * frame: where the wrist is, which way the back of the hand runs (wrist to
 * middle knuckle), which way the palm faces, which way the forearm leaves the
 * wrist (the old box forearm's `toward`), and the finger shape.
 */
export interface Grip {
  wrist: THREE.Vector3;
  along: THREE.Vector3;
  palm: THREE.Vector3;
  toward: THREE.Vector3;
  shape: HandShape;
}

export function grip(
  wrist: [number, number, number],
  along: [number, number, number],
  palm: [number, number, number],
  toward: [number, number, number],
  shape: HandShape
): Grip {
  return {
    wrist: new THREE.Vector3(...wrist),
    along: new THREE.Vector3(...along).normalize(),
    palm: new THREE.Vector3(...palm).normalize(),
    toward: new THREE.Vector3(...toward).normalize(),
    shape
  };
}

/** Part way from hand shape `a` to `b`. */
export function mixShape(a: HandShape, b: HandShape, k: number): HandShape {
  const l = (x: number, y: number) => x + (y - x) * k;
  const l3 = (x: Curl3, y: Curl3): Curl3 => [l(x[0], y[0]), l(x[1], y[1]), l(x[2], y[2])];
  return {
    fingers: [l3(a.fingers[0], b.fingers[0]), l3(a.fingers[1], b.fingers[1]), l3(a.fingers[2], b.fingers[2]), l3(a.fingers[3], b.fingers[3])],
    thumb: l3(a.thumb, b.thumb),
    spread: l(a.spread ?? 0, b.spread ?? 0),
    splay: [0, 1, 2, 3].map((i) => l(a.splay?.[i] ?? 0, b.splay?.[i] ?? 0)) as [number, number, number, number]
  };
}

/** Part way from grip `a` to `b`, hand shape and all. */
export function mixGrip(a: Grip, b: Grip, k: number): Grip {
  return {
    wrist: a.wrist.clone().lerp(b.wrist, k),
    along: a.along.clone().lerp(b.along, k).normalize(),
    palm: a.palm.clone().lerp(b.palm, k).normalize(),
    toward: a.toward.clone().lerp(b.toward, k).normalize(),
    shape: mixShape(a.shape, b.shape, k)
  };
}

/**
 * A grip written in one frame, carried into another by `m` (that frame's
 * matrix in the other's space). Scale in `m` moves the wrist; directions
 * only turn.
 */
export function reframe(g: Grip, m: THREE.Matrix4): Grip {
  const q = new THREE.Quaternion();
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return {
    wrist: g.wrist.clone().applyMatrix4(m),
    along: g.along.clone().applyQuaternion(q),
    palm: g.palm.clone().applyQuaternion(q),
    toward: g.toward.clone().applyQuaternion(q),
    shape: g.shape
  };
}

/** Where his shoulders are from his eyes (camera space: x right, y up, z back). */
const SHOULDER: Record<Side, THREE.Vector3> = {
  r: new THREE.Vector3(0.172, -0.22, 0.08),
  l: new THREE.Vector3(-0.172, -0.22, 0.08)
};
/** His eyes in model space, and the model turned to look down the camera's −Z. */
const EYES = new THREE.Vector3(0, 1.622, 0.07);
const FACE_CAMERA = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/**
 * Which way the forearm should leave a wrist at `wrist` for the arm to reach
 * a shoulder at `shoulder` with a natural elbow, bent toward `pole`. Any
 * space, as long as all three share it.
 */
export function elbowToward(wrist: THREE.Vector3, shoulder: THREE.Vector3, pole: THREE.Vector3): THREE.Vector3 {
  const a = RaviRig.len('upperarm_r', 'lowerarm_r');
  const b = RaviRig.len('lowerarm_r', 'hand_r');
  const w = shoulder.clone().sub(wrist);
  const d = THREE.MathUtils.clamp(w.length(), 0.05, (a + b) * 0.999);
  w.normalize();
  const ang = Math.acos(THREE.MathUtils.clamp((b * b + d * d - a * a) / (2 * b * d), -1, 1));
  const n = pole.clone().addScaledVector(w, -pole.dot(w)).normalize();
  return w.multiplyScalar(Math.cos(ang)).addScaledVector(n, Math.sin(ang));
}

/** Holds a limbs-only copy of Ravi to the camera and hides it with its parent. */
abstract class FirstPersonLimbs {
  protected rig: RaviRig | null = null;
  protected holder = new THREE.Group();
  /** Box materials to switch off once the real limbs are in. */
  private boxes: THREE.Material[] = [];

  constructor(
    protected parent: THREE.Object3D,
    protected camera: THREE.Object3D | null,
    parts: 'arms' | 'legs'
  ) {
    parent.add(this.holder);
    this.holder.matrixAutoUpdate = false;
    RaviVisual.whenReady(() => {
      this.rig = RaviVisual.rig(parts);
      this.holder.add(this.rig.root);
      for (const m of this.boxes) m.visible = false;
      this.built(this.rig);
    });
  }

  /** Hook for a subclass to adjust the copy once it exists. */
  protected built(_rig: RaviRig): void {}

  /** The old box limbs' materials: drawn until the model arrives, then switched off. */
  replaces(...mats: THREE.Material[]): this {
    this.boxes.push(...mats);
    if (this.rig) for (const m of mats) m.visible = false;
    return this;
  }

  get ready(): boolean {
    return this.rig !== null;
  }

  protected static shown(o: THREE.Object3D, stop: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p && p !== stop; p = p.parent) if (!p.visible) return false;
    return true;
  }

  /**
   * Put the model where his eyes are the camera, facing where it looks; with
   * no camera, `at` (world) says where his model-space origin goes.
   */
  protected place(at?: THREE.Vector3): { toModel: THREE.Matrix4; rot: THREE.Quaternion } {
    const rig = this.rig!;
    this.parent.updateWorldMatrix(true, false);
    const want = new THREE.Matrix4();
    if (this.camera) {
      this.camera.updateWorldMatrix(true, false);
      want.compose(new THREE.Vector3(), FACE_CAMERA, new THREE.Vector3(1, 1, 1));
      want.multiply(new THREE.Matrix4().makeTranslation(-EYES.x, -EYES.y, -EYES.z));
      want.premultiply(this.camera.matrixWorld);
    } else if (at) {
      want.makeTranslation(at.x, at.y, at.z);
    }
    this.holder.matrix.copy(this.parent.matrixWorld).invert().multiply(want);
    this.holder.matrixWorldNeedsUpdate = true;
    this.holder.updateWorldMatrix(false, true);
    const toModel = rig.root.matrixWorld.clone().invert();
    return { toModel, rot: new THREE.Quaternion().setFromRotationMatrix(toModel) };
  }
}

/**
 * Ravi's two arms for a first-person viewmodel. Parent it to the viewmodel's
 * root so it hides when the viewmodel does; each frame, after the viewmodel
 * has moved its anchors, update() lays each arm onto its anchor. An arm shows
 * only while its anchor would (a hidden support hand hides the left arm).
 *
 * Without a camera (a hand posed in the world) give each arm a world-space
 * shoulder with shoulder().
 */
export class FirstPersonArms extends FirstPersonLimbs {
  private drive: Record<Side, { anchor: THREE.Object3D; grip: Grip } | null> = { l: null, r: null };
  private shoulderAt: Record<Side, { p: THREE.Vector3; world: boolean } | null> = { l: null, r: null };

  constructor(parent: THREE.Object3D, camera: THREE.Object3D | null) {
    super(parent, camera, 'arms');
  }

  /** Drive one arm from `anchor` held by `grip`; null takes the arm away. */
  set(side: Side, anchor: THREE.Object3D | null, g: Grip | null = null): this {
    this.drive[side] = anchor && g ? { anchor, grip: g } : null;
    return this;
  }

  /** Change just the hand shape of an arm already set. */
  shape(side: Side, s: HandShape): void {
    const d = this.drive[side];
    if (d) d.grip = { ...d.grip, shape: s };
  }

  /** Where a shoulder is: camera space, or world with `world`. Null goes back to his own. */
  shoulder(side: Side, p: THREE.Vector3 | null, world = false): this {
    this.shoulderAt[side] = p ? { p: p.clone(), world } : null;
    return this;
  }

  private shoulderWorld(side: Side): THREE.Vector3 {
    const o = this.shoulderAt[side];
    if (o?.world) return o.p.clone();
    const p = (o?.p ?? SHOULDER[side]).clone();
    return this.camera ? p.applyMatrix4(this.camera.matrixWorld) : p;
  }

  update(): void {
    const rig = this.rig;
    if (!rig) return;
    const anyShoulder = this.shoulderAt.r?.world ? this.shoulderAt.r.p : this.shoulderAt.l?.world ? this.shoulderAt.l.p : undefined;
    const at = anyShoulder?.clone().sub(RaviVisual.restBone('upperarm_r').modelP);
    const { toModel, rot } = this.place(at);
    rig.clear();
    for (const side of ['l', 'r'] as Side[]) {
      const d = this.drive[side];
      const on = !!d && FirstPersonLimbs.shown(d.anchor, this.parent);
      rig.showSide(side, on);
      if (!d || !on) continue;
      d.anchor.updateWorldMatrix(true, false);
      const aw = d.anchor.matrixWorld;
      const aq = new THREE.Quaternion().setFromRotationMatrix(aw);
      const g = d.grip;
      const wrist = g.wrist.clone().applyMatrix4(aw).applyMatrix4(toModel);
      const along = g.along.clone().applyQuaternion(aq).applyQuaternion(rot);
      const palm = g.palm.clone().applyQuaternion(aq).applyQuaternion(rot);
      const toward = g.toward.clone().applyQuaternion(aq).applyQuaternion(rot);
      const shoulder = this.shoulderWorld(side).applyMatrix4(toModel);
      rig.reach(side, wrist, along, palm, toward, shoulder).hand(side, g.shape);
    }
    rig.apply();
  }
}

/**
 * Ravi's legs for the drop kick. Each is driven from a hip group whose −Z
 * runs down the thigh and whose +Y is the front of the leg, plus that leg's
 * knee angle. The knee bends the way a knee does (the shin folds back behind
 * the thigh), the foot keeps its angle to the shin, so at full extension the
 * soles are what arrive.
 */
export class FirstPersonLegs extends FirstPersonLimbs {
  private drive: Record<Side, { hip: THREE.Object3D; knee: () => number } | null> = { l: null, r: null };

  constructor(parent: THREE.Object3D, camera: THREE.Object3D, private glow = 0x000000) {
    super(parent, camera, 'legs');
  }

  /** Dark trousers vanish on a dark floor; give this copy its own lifted materials. */
  protected built(rig: RaviRig): void {
    if (!this.glow) return;
    const done = new Map<THREE.Material, THREE.Material>();
    for (const m of rig.meshes) {
      const src = m.material as THREE.MeshStandardMaterial;
      let c = done.get(src);
      if (!c) {
        const cm = src.clone();
        cm.emissive = new THREE.Color(this.glow);
        c = cm;
        done.set(src, c);
      }
      m.material = c;
    }
  }

  set(side: Side, hip: THREE.Object3D, knee: () => number): this {
    this.drive[side] = { hip, knee };
    return this;
  }

  update(): void {
    const rig = this.rig;
    if (!rig) return;
    const { toModel, rot } = this.place();
    rig.clear();
    for (const side of ['l', 'r'] as Side[]) {
      const d = this.drive[side];
      const on = !!d && FirstPersonLimbs.shown(d.hip, this.parent);
      rig.showSide(side, on);
      if (!d || !on) continue;
      d.hip.updateWorldMatrix(true, false);
      const hw = d.hip.matrixWorld;
      const hq = new THREE.Quaternion().setFromRotationMatrix(hw).premultiply(rot);
      const k = d.knee();
      const hip = new THREE.Vector3().applyMatrix4(hw).applyMatrix4(toModel);
      const thigh = new THREE.Vector3(0, 0, -1).applyQuaternion(hq);
      const front = new THREE.Vector3(0, 1, 0).applyQuaternion(hq);
      const shin = new THREE.Vector3(0, -Math.sin(k), -Math.cos(k)).applyQuaternion(hq);
      rig.leg(side, hip, thigh, shin, front);
    }
    rig.apply();
  }
}
