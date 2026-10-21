import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * HitmanVisual — the modelled man in the suit (models/hitman.glb), worn over
 * an Enemy's rig.
 *
 * The Enemy keeps its own primitive skeleton and all of the code that moves
 * it: the walk cycle, the aim, the IK onto the rifle, cutscene poses, the
 * ragdoll. This reads that skeleton every frame and poses a skinned model to
 * match. Joint ROTATIONS are copied across, not positions, so a model with
 * its own proportions takes the same poses without being stretched to the
 * rig's. The one place that is not enough is the hands: his shoulders are a
 * hand's width narrower than the rig's, so wherever the rig's hand is holding
 * something (a grip, a handguard, a knot) the arm is solved again, onto it.
 *
 * The model's joints are at a man's proportions and scale (1.745 m, shoulders
 * at the rig's 1.40), built in models/hitman_build.py with HM_GAME=1.
 */

/** What one hand should be doing this frame. */
export interface HandGoal {
  /** 0 leaves the rig's own arm; 1 puts the fist exactly on `at`. */
  w: number;
  /** World point the fist closes round. */
  at: THREE.Vector3;
  /** World direction of the fist's axis, thumb end — up a grip, along a handguard. Null keeps the rig's hand. */
  thumb: THREE.Vector3 | null;
  /** World direction the palm faces. Only read with `thumb`. */
  palm: THREE.Vector3 | null;
  /** 0 open and relaxed .. 1 closed round a grip. */
  curl: number;
  /**
   * A point in the model's rest frame on his own head — under the chin,
   * say. When set, `at` is worked out from where his head is this frame,
   * so a hand can be put against his face whatever the rig's proportions.
   */
  onHead?: THREE.Vector3 | null;
}

/** The rig this model follows, and what its hands are doing. */
export interface HitmanDrive {
  pelvis: THREE.Object3D;
  torso: THREE.Object3D;
  head: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  foreL: THREE.Object3D;
  foreR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  shinL: THREE.Object3D;
  shinR: THREE.Object3D;
  /** 0..1 — down on the knees. The model's shins are longer than the rig's. */
  kneel: number;
  /**
   * 0..1 — stood with his feet planted: squatting, or set wide. The model's
   * feet are put flat on the floor, turned only as the legs turn them, and
   * his hips taken up or down to keep the soles on it — its legs are not the
   * rig's length, so the rig's planted feet leave the model's a little off.
   * Left out (or 0), the feet ride the shins as they always have.
   */
  plant?: number;
  handL: HandGoal;
  handR: HandGoal;
}

/**
 * What he is wearing. The agents are the man as modelled: suit, gloves,
 * sunglasses, an earpiece. The call-centre staff are the same man in the
 * floor's uniform — white shirt, blue trousers, a navy cap, bare hands — and
 * the boss is him built heavy, bearded, in a red cap and a striped tie. The
 * General is him built like a wardrobe, in an olive dress uniform with
 * everything a dress uniform can carry. Airport security are him in the
 * airside team's kit: a pale blue short-sleeved shirt with epaulettes, navy
 * trousers, a hi-vis vest, a black peaked cap and a radio on his chest.
 */
export type Outfit = 'agent' | 'staff' | 'boss' | 'general' | 'security';

export interface HitmanLook {
  /** A Hair_* mesh in the model, or null for a shaved head. */
  hair: string | null;
  hairColor: number;
  skin: number;
  tie: number;
  outfit?: Outfit;
}

/** The rig's pelvis, at rest, in its root's frame. */
const PELVIS_REST = new THREE.Vector3(0, 0.96, 0);
/** How much further the model's hips drop to kneel: its shins are longer than the rig's. */
const KNEEL_DROP = 0.06;

type Drive =
  | 'rest'
  | 'hips'
  | 'spine'
  | 'torso'
  | 'neck'
  | 'head'
  | 'armL'
  | 'armR'
  | 'foreL'
  | 'foreR'
  | 'legL'
  | 'legR'
  | 'shinL'
  | 'shinR';

/** The body's bones in parent-first order, and which part of the rig turns each. */
const CHAIN: [string, Drive][] = [
  ['Root', 'rest'],
  ['Hips', 'hips'],
  ['Spine', 'spine'],
  ['Chest', 'torso'],
  ['UpperChest', 'torso'],
  ['Neck', 'neck'],
  ['Head', 'head'],
  ['Shoulder_L', 'rest'],
  ['UpperArm_L', 'armL'],
  ['LowerArm_L', 'foreL'],
  ['Hand_L', 'foreL'],
  ['Shoulder_R', 'rest'],
  ['UpperArm_R', 'armR'],
  ['LowerArm_R', 'foreR'],
  ['Hand_R', 'foreR'],
  ['UpperLeg_L', 'legL'],
  ['LowerLeg_L', 'shinL'],
  ['Foot_L', 'rest'],
  ['Toe_L', 'rest'],
  ['UpperLeg_R', 'legR'],
  ['LowerLeg_R', 'shinR'],
  ['Foot_R', 'rest'],
  ['Toe_R', 'rest']
];

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

/** A bone as the rest pose has it, shared by every copy. */
interface RestBone {
  localQ: THREE.Quaternion;
  localP: THREE.Vector3;
  modelQ: THREE.Quaternion;
  modelP: THREE.Vector3;
}

/** One bone in a copy, with this frame's pose in the model's frame. */
interface Joint {
  bone: THREE.Bone;
  rest: RestBone;
  drive: Drive;
  parent: Joint | null;
  q: THREE.Quaternion;
  p: THREE.Vector3;
  /** A foot: put flat on the floor when the drive plants them. */
  foot: boolean;
}

/** What a hand looks like at rest, for placing it on things. */
interface HandRest {
  /** Across the knuckles, thumb-ward — the axis a closed fist grips along. */
  thumb: THREE.Vector3;
  /** Out of the palm. */
  palm: THREE.Vector3;
  /** From the wrist to the middle of the closed fist. */
  grip: THREE.Vector3;
}

// ------------------------------------------------------------------ looks

export const HAIR_STYLES = [
  'Buzz',
  'Crew',
  'SidePart',
  'Slick',
  'Pompadour',
  'Afro',
  'CurlyTop',
  'Horseshoe',
  'Mohawk',
  'Undercut',
  'Bun'
] as const;

/** Hairstyles in the order the agents are handed them — a shaved head among them. */
const STYLE_ORDER: (string | null)[] = [
  'Crew',
  'Afro',
  'SidePart',
  null,
  'Undercut',
  'Pompadour',
  'Buzz',
  'CurlyTop',
  'Slick',
  'Horseshoe',
  'Bun',
  'Mohawk'
];

/** The short styles, for the staff: anything taller comes up through the cap. */
const STAFF_STYLES: (string | null)[] = ['Crew', 'Buzz', 'SidePart', null, 'Slick', 'Undercut', 'Horseshoe'];

/** Fair to deep. */
export const SKIN_TONES = [0xe6bf9f, 0xd4a27c, 0xbf8a62, 0xa8744e, 0x8a5a3b, 0x6c4229, 0x52301d, 0x3a2114];

const HAIR = {
  black: 0x121010,
  darkBrown: 0x2a1c14,
  brown: 0x4a3122,
  lightBrown: 0x6e4c32,
  dirtyBlond: 0x98784c,
  blond: 0xc6a369,
  ginger: 0x8e421e,
  grey: 0x77736f,
  silver: 0xb3afa9
};
/** Ties: mostly dark and sober, a few with some colour in them. */
export const TIE_COLOURS = [0x111214, 0x7a1418, 0x1a2550, 0x4a0f1c, 0x173a2a, 0x3d1d57, 0x5d6168, 0x8c6a1c, 0x0f3a4a];

/** Hair colours a given skin tone draws from, lightest skins widest. */
const HAIR_FOR_SKIN: number[][] = [
  [HAIR.blond, HAIR.ginger, HAIR.lightBrown, HAIR.dirtyBlond, HAIR.brown, HAIR.darkBrown, HAIR.silver],
  [HAIR.brown, HAIR.dirtyBlond, HAIR.darkBrown, HAIR.ginger, HAIR.black, HAIR.lightBrown, HAIR.grey],
  [HAIR.darkBrown, HAIR.black, HAIR.brown, HAIR.grey, HAIR.lightBrown],
  [HAIR.black, HAIR.darkBrown, HAIR.brown, HAIR.grey],
  [HAIR.black, HAIR.darkBrown, HAIR.grey, HAIR.black],
  [HAIR.black, HAIR.darkBrown, HAIR.grey],
  [HAIR.black, HAIR.darkBrown, HAIR.silver],
  [HAIR.black, HAIR.darkBrown, HAIR.grey]
];

// ------------------------------------------------------------ the template

const NO_HAND_POSE = new THREE.Quaternion();

export class HitmanVisual {
  private static template: THREE.Object3D | null = null;
  private static loading: Promise<void> | null = null;
  private static rest = new Map<string, RestBone>();
  private static handRest: { L: HandRest; R: HandRest } | null = null;
  /** Per finger bone: its local rotation relaxed, and closed round a grip. */
  private static fingerPose = new Map<string, [THREE.Quaternion, THREE.Quaternion]>();
  /** Materials every copy shares, by the model's material name. */
  private static shared = new Map<string, THREE.Material>();
  private static skinMats = new Map<number, THREE.MeshStandardMaterial>();
  private static browMats = new Map<number, THREE.MeshStandardMaterial>();
  private static lipMats = new Map<number, THREE.MeshStandardMaterial>();
  private static hairMats = new Map<string, THREE.MeshStandardMaterial>();
  private static tieMats = new Map<number, THREE.MeshStandardMaterial>();

  /** True once the model has loaded; before then (or if it never does) enemies keep the primitive build. */
  static get ready(): boolean {
    return HitmanVisual.template !== null;
  }

  /** Fetch and prepare the model. Resolves either way — a failed load just means primitive enemies. */
  static load(url: string): Promise<void> {
    if (!HitmanVisual.loading) {
      HitmanVisual.loading = new GLTFLoader()
        .loadAsync(url)
        .then((gltf) => {
          HitmanVisual.prepare(gltf.scene, gltf.animations);
        })
        .catch((err) => {
          console.warn('hitman model failed to load; enemies stay primitive', err);
        });
    }
    return HitmanVisual.loading;
  }

  private static prepare(scene: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    scene.updateMatrixWorld(true);
    const bones = new Map<string, THREE.Bone>();
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    });
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (const [name, b] of bones) {
      b.matrixWorld.decompose(p, q, s);
      HitmanVisual.rest.set(name, {
        localQ: b.quaternion.clone(),
        localP: b.position.clone(),
        modelQ: q.clone(),
        modelP: p.clone()
      });
    }

    // Each hand's axes at rest, from where its knuckles are
    const at = (n: string) => HitmanVisual.rest.get(n)!.modelP;
    const hand = (sd: 'L' | 'R'): HandRest => {
      const wrist = at(`Hand_${sd}`);
      const down = at(`Middle1_${sd}`).clone().sub(wrist).normalize();
      const thumb = at(`Index1_${sd}`).clone().sub(at(`Pinky1_${sd}`));
      thumb.addScaledVector(down, -thumb.dot(down)).normalize();
      // Out of the palm is the one of ±(down × thumb) that faces his thigh
      const palm = new THREE.Vector3().crossVectors(down, thumb).normalize();
      if (palm.x * wrist.x > 0) palm.negate();
      const grip = down.clone().multiplyScalar(0.085).addScaledVector(palm, 0.026);
      return { thumb, palm, grip };
    };
    HitmanVisual.handRest = { L: hand('L'), R: hand('R') };

    // The two hand shapes, as local rotations per finger bone
    const pose = (clipName: string): Map<string, THREE.Quaternion> => {
      const out = new Map<string, THREE.Quaternion>();
      const clip = clips.find((c) => c.name === clipName);
      if (!clip) return out;
      for (const t of clip.tracks) {
        const dot = t.name.lastIndexOf('.');
        if (t.name.slice(dot + 1) !== 'quaternion') continue;
        const v = t.values;
        out.set(t.name.slice(0, dot), new THREE.Quaternion(v[0], v[1], v[2], v[3]));
      }
      return out;
    };
    const relax = pose('Relax');
    const grip = pose('Grip');
    for (const f of FINGERS) {
      for (const sd of ['L', 'R']) {
        for (let k = 1; k <= 3; k++) {
          const n = `${f}${k}_${sd}`;
          const r = relax.get(n) ?? HitmanVisual.rest.get(n)?.localQ ?? NO_HAND_POSE;
          const g = grip.get(n) ?? r;
          HitmanVisual.fingerPose.set(n, [r.clone(), g.clone()]);
        }
      }
    }

    // Plain standard materials: the glTF's sheen and clearcoat buy nothing
    // under the game's lights and cost a heavier shader per man
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh && HitmanVisual.boneNames.length === 0) {
        HitmanVisual.boneNames = sm.skeleton.bones.map((b) => b.name);
      }
      m.castShadow = false;
      m.receiveShadow = false;
      const src = m.material as THREE.MeshStandardMaterial;
      if (!HitmanVisual.shared.has(src.name)) HitmanVisual.shared.set(src.name, HitmanVisual.plain(src));
    });
    HitmanVisual.faceOnHead(scene);
    HitmanVisual.openMouth(scene);
    HitmanVisual.addMouthShapes(scene);
    HitmanVisual.template = scene;
  }

  private static smoothstep(a: number, b: number, x: number): number {
    const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /**
   * The face, all of it, on the head bone. As it came from the file a third
   * to a half of the nose, mouth and chin was skinned to the upper chest, so
   * whenever a head turned the lower face stayed behind with the body and
   * the whole face smeared round after it. Above the jaw line every vertex
   * now follows the head alone; the neck below keeps its blend, so it still
   * twists like a neck. The jaw line runs from under the chin up to the base
   * of the skull at the back.
   */
  private static faceOnHead(scene: THREE.Object3D): void {
    const head = HitmanVisual.boneNames.indexOf('Head');
    if (head < 0) return;
    scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !m.name.startsWith('HitmanFace')) return;
      const g = m.geometry;
      const pos = g.attributes.position;
      const si = g.attributes.skinIndex as THREE.BufferAttribute;
      const sw = g.attributes.skinWeight as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const jaw = 1.49 + THREE.MathUtils.clamp((pos.getZ(v) + 0.05) / 0.13, 0, 1) * 0.07;
        const t = HitmanVisual.smoothstep(jaw - 0.03, jaw + 0.01, pos.getY(v));
        if (t <= 0) continue;
        let slot = -1;
        for (let k = 0; k < 4; k++) if (si.getComponent(v, k) === head && sw.getComponent(v, k) > 0) slot = k;
        if (slot < 0) {
          // No head influence yet: the lightest slot becomes the head's
          let least = 2;
          for (let k = 0; k < 4; k++) {
            const w = sw.getComponent(v, k);
            if (w < least) {
              least = w;
              slot = k;
            }
          }
          si.setComponent(v, slot, head);
        }
        let moved = 0;
        for (let k = 0; k < 4; k++) {
          if (k === slot) continue;
          const w = sw.getComponent(v, k);
          sw.setComponent(v, k, w * (1 - t));
          moved += w * t;
        }
        sw.setComponent(v, slot, sw.getComponent(v, slot) + moved);
      }
      si.needsUpdate = true;
      sw.needsUpdate = true;
    });
  }

  /**
   * Let the lips be the mouth. As modelled the face's skin runs straight on
   * across the mouth a millimetre or two in front of the lips, so only the
   * crest of each lip came through it: two bumps, with skin between them
   * where the mouth should be. The skin the lips cover is cut away — every
   * triangle of it lying wholly within their outline, seen from the front —
   * so the whole of each lip shows and between them there is the dark of
   * the mouth behind. And each lip is marked where it turns in towards the
   * other, for its material to darken: the line where the lips meet.
   */
  private static openMouth(scene: THREE.Object3D): void {
    const skin = scene.getObjectByName('HitmanFace_1') as THREE.Mesh | undefined;
    const lips = scene.getObjectByName('HitmanFace_3') as THREE.Mesh | undefined;
    if (!skin || !lips) return;
    const lg = lips.geometry;
    const lp = lg.attributes.position;
    const li = lg.index!.array;
    const tris: THREE.Triangle[] = [];
    for (let i = 0; i < li.length; i += 3) {
      tris.push(
        new THREE.Triangle(
          new THREE.Vector3().fromBufferAttribute(lp, li[i]),
          new THREE.Vector3().fromBufferAttribute(lp, li[i + 1]),
          new THREE.Vector3().fromBufferAttribute(lp, li[i + 2])
        )
      );
    }
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
    const hit = new THREE.Vector3();
    /** Is there lip at (x, y), no more than a few millimetres behind skin at depth z? */
    const lipAt = (x: number, y: number, z: number): boolean => {
      ray.origin.set(x, y, -1);
      for (const t of tris) {
        if (ray.intersectTriangle(t.a, t.b, t.c, false, hit) && z > hit.z - 0.004) return true;
      }
      return false;
    };
    /**
     * Is the skin at this point lying over a lip? On one, or in the thin gap
     * where the two meet (lip just above it and just below): the edges of
     * the lips' outline have to be really inside it, or the cut shows
     * through past them.
     */
    const covered = (x: number, y: number, z: number): boolean =>
      lipAt(x, y, z) || (lipAt(x, y + 0.0015, z) && lipAt(x, y - 0.0015, z));
    const sg = skin.geometry;
    const sp = sg.attributes.position;
    const si = sg.index!.array;
    const cache = new Map<number, boolean>();
    const isCovered = (v: number): boolean => {
      let c = cache.get(v);
      if (c === undefined) {
        const z = sp.getZ(v);
        c = z < -0.05 && covered(sp.getX(v), sp.getY(v), z);
        cache.set(v, c);
      }
      return c;
    };
    const keep: number[] = [];
    for (let i = 0; i < si.length; i += 3) {
      if (!(isCovered(si[i]) && isCovered(si[i + 1]) && isCovered(si[i + 2]))) keep.push(si[i], si[i + 1], si[i + 2]);
    }
    sg.setIndex(keep);

    // The lips' inner faces: the underside of the upper lip, the top of the lower
    const { of } = HitmanVisual.pieces(lg);
    const mean = new Map<number, [number, number]>();
    for (let v = 0; v < lp.count; v++) {
      const m = mean.get(of[v]) ?? [0, 0];
      m[0] += lp.getY(v);
      m[1]++;
      mean.set(of[v], m);
    }
    const all = [...mean.values()].map(([sum, n]) => sum / n);
    const middle = (Math.max(...all) + Math.min(...all)) / 2;
    const ln = lg.attributes.normal;
    const inner = new Float32Array(lp.count);
    for (let v = 0; v < lp.count; v++) {
      const [sum, n] = mean.get(of[v])!;
      const upper = sum / n > middle;
      const facing = upper ? -ln.getY(v) : ln.getY(v);
      inner[v] = HitmanVisual.smoothstep(0.05, 0.75, facing);
    }
    lg.setAttribute('lipInner', new THREE.BufferAttribute(inner, 1));
  }

  /**
   * Two more shape keys for the mouth, which the model only has a scream
   * for: a smile (the corners out, up and back into the cheeks) and a frown
   * (the corners pulled down). Worked out from where the lips are, onto the
   * skin, the lips and the mouth inside them.
   */
  private static addMouthShapes(scene: THREE.Object3D): void {
    const lips = scene.getObjectByName('HitmanFace_3') as THREE.Mesh | undefined;
    if (!lips) return;
    const lb = new THREE.Box3().setFromBufferAttribute(lips.geometry.attributes.position as THREE.BufferAttribute);
    const cy = (lb.min.y + lb.max.y) / 2;
    const corner = lb.max.x;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.name.startsWith('HitmanFace')) return;
      const g = m.geometry;
      const pos = g.attributes.position;
      const smile = new Float32Array(pos.count * 3);
      const frown = new Float32Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v);
        const y = pos.getY(v);
        const z = pos.getZ(v);
        if (z > -0.02) continue;
        const ax = Math.abs(x);
        const sx = Math.sign(x);
        // Most at the corners, some all along the lips (more towards the sides)
        const atCorner = Math.exp(-((ax - corner) ** 2 + (y - cy) ** 2) / 0.018 ** 2);
        const alongLips = Math.exp(-((y - cy) ** 2) / 0.012 ** 2) * HitmanVisual.smoothstep(0, corner, ax) ** 2 * 0.8;
        const k = Math.max(atCorner, alongLips) * HitmanVisual.smoothstep(-0.02, -0.05, z);
        smile[v * 3] = sx * 0.0065 * k;
        smile[v * 3 + 1] = 0.0115 * k;
        smile[v * 3 + 2] = 0.004 * k;
        frown[v * 3] = -sx * 0.0012 * k;
        frown[v * 3 + 1] = -0.0085 * k;
        frown[v * 3 + 2] = 0.0012 * k;
      }
      const add = (name: string, d: Float32Array) => {
        const a = new THREE.BufferAttribute(d, 3);
        a.name = name;
        (g.morphAttributes.position ??= []).push(a);
        if (g.morphAttributes.normal) g.morphAttributes.normal.push(new THREE.BufferAttribute(new Float32Array(d.length), 3));
      };
      // Rebuilding the dictionary names targets by their attributes, and the
      // file's own ("Scream") may only be named in the dictionary
      const had = { ...(m.morphTargetDictionary ?? {}) };
      g.morphTargetsRelative = true;
      add('Smile', smile);
      add('Frown', frown);
      m.updateMorphTargets();
      Object.assign(m.morphTargetDictionary!, had);
    });
  }

  private static plain(src: THREE.MeshStandardMaterial): THREE.Material {
    const m = new THREE.MeshStandardMaterial({
      name: src.name,
      color: src.color,
      roughness: src.roughness,
      metalness: src.metalness
    });
    switch (src.name) {
      case 'HM_Metal':
        // Full metal reflects an environment, and the levels have none: it
        // would draw black. Half-metal still catches the lights.
        m.metalness = 0.55;
        m.roughness = 0.3;
        break;
      case 'HM_Suit':
        m.roughness = 0.78;
        break;
      case 'HM_Shoe':
        m.roughness = 0.28;
        break;
    }
    return m;
  }

  /** A skin tone. The model's stubble is a mask in its vertex colours, multiplied through. */
  private static skinMat(tone: number): THREE.MeshStandardMaterial {
    let m = HitmanVisual.skinMats.get(tone);
    if (!m) {
      // Both sides: the mouth is cut out of the skin (see openMouth), and a
      // sliver of the cut past a lip's edge shows the inside of the head
      // as skin rather than the room behind it
      m = new THREE.MeshStandardMaterial({ name: 'HM_Skin', color: tone, roughness: 0.55, vertexColors: true, side: THREE.DoubleSide });
      HitmanVisual.skinMats.set(tone, m);
    }
    return m;
  }

  /** Lips: a darker, redder step off whatever skin tone this one has. */
  private static lipMat(tone: number): THREE.MeshStandardMaterial {
    let m = HitmanVisual.lipMats.get(tone);
    if (!m) {
      const c = new THREE.Color(tone).multiplyScalar(0.74);
      c.offsetHSL(-0.012, 0.06, 0);
      const mat = new THREE.MeshStandardMaterial({ name: 'HM_Lip', color: c, roughness: 0.5 });
      // Darkest where each lip turns in to meet the other: the mouth's line
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float lipInner;\nvarying float vInner;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInner = lipInner;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vInner;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.82 * vInner;');
      };
      mat.customProgramCacheKey = () => 'hitman-lip';
      m = mat;
      HitmanVisual.lipMats.set(tone, m);
    }
    return m;
  }

  private static browMat(hair: number): THREE.MeshStandardMaterial {
    let m = HitmanVisual.browMats.get(hair);
    if (!m) {
      const c = new THREE.Color(hair).multiplyScalar(0.8);
      m = new THREE.MeshStandardMaterial({ name: 'HM_Brow', color: c, roughness: 0.7 });
      HitmanVisual.browMats.set(hair, m);
    }
    return m;
  }

  /**
   * Hair: the vertex colour is a density, 1 a full head of it and less where
   * the scalp shows through — clipper-short sides, a soft hairline — so the
   * shader mixes from the skin tone up to the hair colour by it.
   */
  private static hairMat(hair: number, skin: number): THREE.MeshStandardMaterial {
    const key = `${hair}:${skin}`;
    let m = HitmanVisual.hairMats.get(key);
    if (!m) {
      const mat = new THREE.MeshStandardMaterial({ name: 'HM_Hair', color: hair, roughness: 0.62, vertexColors: true });
      const uSkin = { value: new THREE.Color(skin) };
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uSkin = uSkin;
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uSkin;')
          .replace('#include <color_fragment>', 'diffuseColor.rgb = mix( uSkin, diffuseColor.rgb, vColor.r );');
      };
      mat.customProgramCacheKey = () => 'hitman-hair';
      HitmanVisual.hairMats.set(key, mat);
      m = mat;
    }
    return m;
  }

  /** The look for the agent built with this index: every one a little different. */
  static lookFor(index: number, outfit: Outfit = 'agent'): HitmanLook {
    const i = Math.abs(Math.floor(index));
    const tone = (i * 3 + 1) % SKIN_TONES.length;
    const colours = HAIR_FOR_SKIN[tone];
    const hairColor = colours[(i * 7 + 2) % colours.length];
    if (outfit === 'boss') {
      // What shows of his hair under the cap: the sides, going grey
      return { hair: 'Horseshoe', hairColor: HAIR.darkBrown, skin: 0xc08b66, tie: 0, outfit };
    }
    if (outfit === 'general') {
      // Clippered to the scalp and gone to steel under the cap; a face that
      // has stood in a great deal of weather
      return { hair: 'Buzz', hairColor: HAIR.grey, skin: 0xb58262, tie: 0x2c3322, outfit };
    }
    if (outfit === 'staff') {
      // Only what fits under a cap
      return { hair: STAFF_STYLES[(i * 3 + 1) % STAFF_STYLES.length], skin: SKIN_TONES[tone], hairColor, tie: 0, outfit };
    }
    if (outfit === 'security') {
      // Under a peaked cap, the same
      return { hair: STAFF_STYLES[(i * 5 + 2) % STAFF_STYLES.length], skin: SKIN_TONES[tone], hairColor, tie: 0, outfit };
    }
    return {
      hair: STYLE_ORDER[(i * 5 + 3) % STYLE_ORDER.length],
      skin: SKIN_TONES[tone],
      hairColor,
      tie: TIE_COLOURS[(i * 4 + 1) % TIE_COLOURS.length],
      outfit
    };
  }

  private static tieMat(colour: number): THREE.MeshStandardMaterial {
    let m = HitmanVisual.tieMats.get(colour);
    if (!m) {
      const src = HitmanVisual.shared.get('HM_Tie') as THREE.MeshStandardMaterial | undefined;
      m = new THREE.MeshStandardMaterial({ name: 'HM_Tie', color: colour, roughness: src?.roughness ?? 0.4 });
      HitmanVisual.tieMats.set(colour, m);
    }
    return m;
  }

  /**
   * The bone carrying whichever hitbox `p` (world) lies on or nearest — a
   * wound goes there, so it rides the limb that was actually shot.
   */
  /** Where one of the model's bones is in the world, as of its last pose. */
  boneWorld(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    const j = this.byName.get(name);
    if (!j) return out.set(0, 0, 0);
    j.bone.updateWorldMatrix(true, false);
    return j.bone.getWorldPosition(out);
  }

  boneNear(p: THREE.Vector3): THREE.Object3D {
    const H = HitmanVisual;
    let best: THREE.Object3D = this.byName.get('UpperChest')!.bone;
    let bestD = Infinity;
    for (const h of this.hitboxes) {
      h.updateWorldMatrix(true, false);
      const g = h.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const local = H._v.copy(p).applyMatrix4(H._m.copy(h.matrixWorld).invert());
      g.boundingBox!.clampPoint(local, local).applyMatrix4(h.matrixWorld);
      const d = local.distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = h.parent ?? best;
      }
    }
    return best;
  }

  // -------------------------------------------------------------- one copy

  /** Add this to the enemy's root. */
  readonly model: THREE.Object3D;
  /** Invisible shapes riding the bones, for bullets. part = head / torso / arm / leg. */
  readonly hitboxes: THREE.Mesh[] = [];
  private joints: Joint[] = [];
  private byName = new Map<string, Joint>();
  private fingers: { bone: THREE.Bone; relax: THREE.Quaternion; grip: THREE.Quaternion; left: boolean }[] = [];
  private cull = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.25);
  private curlL = -1;
  private curlR = -1;
  /** The face's "Scream" shape key, on each of its meshes. */
  private screamMorphs: { inf: number[]; k: number }[] = [];
  private screamNow = 0;

  /** 0 a closed mouth and level brows .. 1 the jaw dropped wide, brows up in the middle. */
  setScream(w: number): void {
    const v = THREE.MathUtils.clamp(w, 0, 1);
    if (Math.abs(v - this.screamNow) < 0.002) return;
    this.screamNow = v;
    for (const m of this.screamMorphs) m.inf[m.k] = v;
  }

  /** The smile and frown shape keys, on each of the face's meshes. */
  private mouthMorphs: { inf: number[]; smile: number; frown: number }[] = [];
  private smileNow = 0;
  private frownNow = 0;

  /** The corners of the mouth: 0..1 up into a smile, 0..1 down into a frown. */
  setMouth(smile: number, frown: number): void {
    const s = THREE.MathUtils.clamp(smile, 0, 1);
    const f = THREE.MathUtils.clamp(frown, 0, 1);
    if (Math.abs(s - this.smileNow) < 0.002 && Math.abs(f - this.frownNow) < 0.002) return;
    this.smileNow = s;
    this.frownNow = f;
    for (const m of this.mouthMorphs) {
      m.inf[m.smile] = s;
      m.inf[m.frown] = f;
    }
  }

  constructor(look: HitmanLook) {
    const template = HitmanVisual.template;
    if (!template) throw new Error('HitmanVisual used before load()');
    this.model = cloneSkinned(template);
    this.model.name = 'Hitman';
    // One skeleton for the whole man. The body comes in as a skinned mesh per
    // material, and the clone gives each its own copy of the same 53 bones —
    // so every agent recomputed and re-uploaded his bone matrices eleven times
    // a frame. They share bones, inverses and bind pose, so they can share it.
    let skeleton: THREE.Skeleton | null = null;
    this.model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      if (!skeleton) skeleton = sm.skeleton;
      else if (sm.skeleton !== skeleton) {
        sm.skeleton.dispose();
        sm.bind(skeleton, sm.bindMatrix);
      }
      const k = sm.morphTargetDictionary?.Scream;
      if (k !== undefined && sm.morphTargetInfluences) {
        // Closed, whatever weight the file came with
        sm.morphTargetInfluences[k] = 0;
        this.screamMorphs.push({ inf: sm.morphTargetInfluences, k });
      }
      const ks = sm.morphTargetDictionary?.Smile;
      const kf = sm.morphTargetDictionary?.Frown;
      if (ks !== undefined && kf !== undefined && sm.morphTargetInfluences) {
        this.mouthMorphs.push({ inf: sm.morphTargetInfluences, smile: ks, frown: kf });
      }
    });

    const bones = new Map<string, THREE.Bone>();
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    });
    for (const [name, drive] of CHAIN) {
      const bone = bones.get(name)!;
      const parent = bone.parent ? this.byName.get(bone.parent.name) ?? null : null;
      const j: Joint = {
        bone,
        rest: HitmanVisual.rest.get(name)!,
        drive,
        parent,
        q: new THREE.Quaternion(),
        p: new THREE.Vector3(),
        foot: name === 'Foot_L' || name === 'Foot_R'
      };
      this.joints.push(j);
      this.byName.set(name, j);
    }
    for (const f of FINGERS) {
      for (const sd of ['L', 'R']) {
        for (let k = 1; k <= 3; k++) {
          const n = `${f}${k}_${sd}`;
          const [relax, grip] = HitmanVisual.fingerPose.get(n)!;
          this.fingers.push({ bone: bones.get(n)!, relax, grip, left: sd === 'L' });
        }
      }
    }

    // Dress him
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      if (m.name.startsWith('Hair_') || o.parent?.name.startsWith('Hair_')) {
        const style = (m.name.startsWith('Hair_') ? m.name : o.parent!.name).slice(5);
        m.visible = style === look.hair;
        m.material = HitmanVisual.hairMat(look.hairColor, look.skin);
        return;
      }
      if (name === 'HM_Skin') m.material = HitmanVisual.skinMat(look.skin);
      else if (name === 'HM_Lip') m.material = HitmanVisual.lipMat(look.skin);
      else if (name === 'HM_Brow') m.material = HitmanVisual.browMat(look.hairColor);
      else if (name === 'HM_Tie') m.material = HitmanVisual.tieMat(look.tie);
      else m.material = HitmanVisual.shared.get(name) ?? m.material;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
        // Skinned bounds are taken once, in whatever pose they are in. This
        // one sphere is shared by every part of him and follows his hips, so
        // he is culled where he actually is — a body thrown across a room
        // included.
        (m as THREE.SkinnedMesh).boundingSphere = this.cull;
      }
    });

    if (look.outfit === 'staff' || look.outfit === 'boss') this.restyle(look, look.outfit);
    else if (look.outfit === 'general') this.dressGeneral();
    else if (look.outfit === 'security') this.dressSecurity(look);
    this.buildHitboxes();
  }

  // -------------------------------------------------------------- outfits

  /** Bone names in skin-index order — every part of the body is skinned to the same list. */
  private static boneNames: string[] = [];
  private static outfitGeos = new Map<string, THREE.BufferGeometry>();
  private static outfitMats = new Map<string, THREE.Material>();

  private static outfitMat(key: string, make: () => THREE.Material): THREE.Material {
    let m = HitmanVisual.outfitMats.get(key);
    if (!m) {
      m = make();
      HitmanVisual.outfitMats.set(key, m);
    }
    return m;
  }

  private static outfitGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = HitmanVisual.outfitGeos.get(key);
    if (!g) {
      g = make();
      HitmanVisual.outfitGeos.set(key, g);
    }
    return g;
  }

  /** Bare hands in a skin tone, for anyone not in the agents' gloves. */
  private static handMat(tone: number): THREE.Material {
    return HitmanVisual.outfitMat(`hand:${tone}`, () => new THREE.MeshStandardMaterial({ name: 'HM_Hand', color: tone, roughness: 0.6 }));
  }

  /** A geometry with the same attributes as `src` and its own index and groups. */
  private static reindexed(src: THREE.BufferGeometry, groups: number[][]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
    g.morphAttributes = src.morphAttributes;
    g.morphTargetsRelative = src.morphTargetsRelative;
    const all: number[] = [];
    groups.forEach((tris, i) => {
      g.addGroup(all.length, tris.length, i);
      for (const v of tris) all.push(v);
    });
    g.setIndex(all);
    if (src.boundingBox) g.boundingBox = src.boundingBox.clone();
    if (src.boundingSphere) g.boundingSphere = src.boundingSphere.clone();
    return g;
  }

  /** Each vertex's connected piece of the mesh, and each piece's extent. */
  private static pieces(g: THREE.BufferGeometry): {
    of: Int32Array;
    top: Map<number, number>;
    bottom: Map<number, number>;
    front: Map<number, number>;
  } {
    const pos = g.attributes.position;
    const idx = g.index!.array;
    const n = pos.count;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (a: number): number => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    for (let i = 0; i < idx.length; i += 3) {
      const a = find(idx[i]);
      parent[find(idx[i + 1])] = a;
      parent[find(idx[i + 2])] = a;
    }
    const of = new Int32Array(n);
    const top = new Map<number, number>();
    const bottom = new Map<number, number>();
    const front = new Map<number, number>();
    for (let v = 0; v < n; v++) {
      const r = find(v);
      of[v] = r;
      top.set(r, Math.max(top.get(r) ?? -9, pos.getY(v)));
      bottom.set(r, Math.min(bottom.get(r) ?? 9, pos.getY(v)));
      front.set(r, Math.max(front.get(r) ?? -9, pos.getZ(v)));
    }
    return { of, top, bottom, front };
  }

  /**
   * Which triangles of the suit are the staff's shirt and which their
   * trousers. Everything below the waist is trousers; the lapels and pocket
   * flaps (pieces lying wholly on the front of the chest) and the jacket's
   * notched collar (wholly above the shoulders) go; the rest is the shirt.
   */
  private static suitParts(src: THREE.BufferGeometry): { shirt: number[]; trousers: number[] } {
    const { of, top, bottom, front } = HitmanVisual.pieces(src);
    const idx = src.index!.array;
    const shirt: number[] = [];
    const trousers: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const r = of[idx[i]];
      const trim = front.get(r)! < -0.06 || bottom.get(r)! > 1.46;
      const out = top.get(r)! < 1.035 ? trousers : trim ? null : shirt;
      if (out) out.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    return { shirt, trousers };
  }

  /**
   * Where the front of a plain shirt would be across the jacket's V: for
   * each height (1 cm apart from 1.14 m), how far out from the middle the
   * jacket's front is, and how far forward. Taken off the jacket at rest by
   * looking straight at it: across the V the front-most point is on its
   * edge, and a plain shirt's front runs straight on across at that depth.
   */
  private static vTable: { xe: number[]; ze: number[] } | null = null;
  private static readonly V_Y0 = 1.14;

  private static frontTable(): { xe: number[]; ze: number[] } {
    if (HitmanVisual.vTable) return HitmanVisual.vTable;
    const src = (HitmanVisual.template!.getObjectByName('HitmanBody_1') as THREE.Mesh).geometry;
    const { shirt } = HitmanVisual.suitParts(src);
    const pos = src.attributes.position;
    // Only the front of the chest, near the middle
    const tris: THREE.Triangle[] = [];
    for (let i = 0; i < shirt.length; i += 3) {
      const t = new THREE.Triangle(
        new THREE.Vector3().fromBufferAttribute(pos, shirt[i]),
        new THREE.Vector3().fromBufferAttribute(pos, shirt[i + 1]),
        new THREE.Vector3().fromBufferAttribute(pos, shirt[i + 2])
      );
      const ok = [t.a, t.b, t.c].every((p) => Math.abs(p.x) < 0.16 && p.z < -0.02 && p.y > 1.08 && p.y < 1.5);
      if (ok) tris.push(t);
    }
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
    const hit = new THREE.Vector3();
    const xe: number[] = [];
    const ze: number[] = [];
    for (let y = HitmanVisual.V_Y0; y <= 1.465; y += 0.01) {
      let bx = 0;
      let bz = 0;
      for (let x = 0; x <= 0.12; x += 0.004) {
        ray.origin.set(x, y, -1);
        let z = Infinity;
        for (const t of tris) {
          if (ray.intersectTriangle(t.a, t.b, t.c, false, hit) && hit.z < z) z = hit.z;
        }
        if (z < bz) {
          bz = z;
          bx = x;
        }
      }
      xe.push(bx);
      ze.push(bz);
    }
    HitmanVisual.vTable = { xe, ze };
    return HitmanVisual.vTable;
  }

  /**
   * Lay a vertex on the front of the plain shirt, if it is in the V: `p`
   * and `n` are changed in place. `behind` sets it that much back from the
   * shirt's front — the shirt front under the jacket stays just behind it.
   */
  private static onShirtFront(p: THREE.Vector3, n: THREE.Vector3, behind: number): void {
    const S = HitmanVisual.smoothstep;
    const wy = S(1.13, 1.17, p.y) * (1 - S(1.475, 1.49, p.y));
    if (wy <= 0 || p.z > -0.02) return;
    const { xe, ze } = HitmanVisual.frontTable();
    const f = THREE.MathUtils.clamp((p.y - HitmanVisual.V_Y0) / 0.01, 0, xe.length - 1.001);
    const i = Math.floor(f);
    const u = f - i;
    // Up at the neck the jacket curves back from the shirt's front, which
    // stood proud of it as a square plate under the chin: there the jacket
    // is ramped forward, over a wider band, to just behind the shirt's
    // front, and the edges of that tuck back to meet it
    const neck = S(1.435, 1.46, p.y);
    if (behind > 0 && neck > 0) {
      const e = neck * S(0.045, 0.072, Math.abs(p.x));
      p.z += (-0.0905 - p.z) * e;
    }
    const x0 = THREE.MathUtils.lerp(xe[i] + (xe[i + 1] - xe[i]) * u, 0.075, neck);
    const z0 = THREE.MathUtils.lerp(ze[i] + (ze[i + 1] - ze[i]) * u, -0.09, neck);
    const band = 0.008 + 0.034 * neck;
    const w = wy * (1 - S(x0, x0 + band, Math.abs(p.x)));
    // Only ever brought forward: up by the collar the shirt's front is
    // already out in front of where the jacket's curves back to the neck
    if (w <= 0 || z0 + behind >= p.z) return;
    p.z += (z0 + behind - p.z) * w;
    // Facing straight out of the chest, tilted as the chest slopes
    const slope = (ze[i + 1] - ze[i]) / 0.01;
    const flat = new THREE.Vector3(0, slope, -1).normalize();
    n.lerp(flat, w).normalize();
  }

  /** Reshape the vertices `tris` uses, in positions and normals of the geometry's own. */
  private static reshaped(g: THREE.BufferGeometry, tris: number[], behind: number): void {
    const pos = g.attributes.position.clone() as THREE.BufferAttribute;
    const nor = g.attributes.normal.clone() as THREE.BufferAttribute;
    g.setAttribute('position', pos);
    g.setAttribute('normal', nor);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const done = new Set<number>();
    for (const v of tris) {
      if (done.has(v)) continue;
      done.add(v);
      p.fromBufferAttribute(pos, v);
      n.fromBufferAttribute(nor, v);
      HitmanVisual.onShirtFront(p, n, behind);
      pos.setXYZ(v, p.x, p.y, p.z);
      nor.setXYZ(v, n.x, n.y, n.z);
    }
  }

  /**
   * The suit as the staff's clothes: the jacket pieces that stay are a
   * plain white shirt, and the V down its front where the lapels crossed is
   * closed — the edges of it laid flat across the chest — so there is no
   * jacket left in it. Material 0 is the shirt, 1 the trousers.
   */
  private static staffSuit(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const { shirt, trousers } = HitmanVisual.suitParts(src);
    const g = HitmanVisual.reindexed(src, [shirt, trousers]);
    HitmanVisual.reshaped(g, shirt, 0);
    return g;
  }

  /**
   * Six small black buttons down the middle of the shirt's front, from the
   * collar to the waist, each sitting on the cloth (found by looking
   * straight at the shirt at rest) and facing out of it. They are skinned
   * like the cloth under them — each takes the weights of the nearest
   * vertex of the shirt — so they ride every pose and every fall with it.
   */
  private static buttonsFor(suit: THREE.BufferGeometry, shirt: THREE.BufferGeometry): THREE.BufferGeometry {
    const tris: THREE.Triangle[] = [];
    const collect = (g: THREE.BufferGeometry, count: number) => {
      const p = g.attributes.position;
      const idx = g.index!.array;
      for (let i = 0; i < count; i += 3) {
        const t = new THREE.Triangle(
          new THREE.Vector3().fromBufferAttribute(p, idx[i]),
          new THREE.Vector3().fromBufferAttribute(p, idx[i + 1]),
          new THREE.Vector3().fromBufferAttribute(p, idx[i + 2])
        );
        if ([t.a, t.b, t.c].every((q) => q.z < -0.02 && Math.abs(q.x) < 0.06 && q.y > 1.0 && q.y < 1.5)) tris.push(t);
      }
    };
    collect(suit, suit.groups.length ? suit.groups[0].count : suit.index!.count);
    collect(shirt, shirt.index!.count);
    const sp = suit.attributes.position;
    const ski = suit.attributes.skinIndex;
    const skw = suit.attributes.skinWeight;
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
    const hit = new THREE.Vector3();
    const parts: THREE.BufferGeometry[] = [];
    for (const y of [1.43, 1.36, 1.29, 1.22, 1.15, 1.08]) {
      ray.origin.set(0, y, -1);
      let at: THREE.Vector3 | null = null;
      let normal = new THREE.Vector3(0, 0, -1);
      for (const t of tris) {
        if (ray.intersectTriangle(t.a, t.b, t.c, false, hit) && (!at || hit.z < at.z)) {
          at = hit.clone();
          normal = t.getNormal(new THREE.Vector3());
          if (normal.z > 0) normal.negate();
        }
      }
      if (!at) continue;
      const b = new THREE.CylinderGeometry(0.0058, 0.0062, 0.0024, 14);
      b.rotateX(Math.PI / 2);
      b.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), normal));
      b.translate(at.x + normal.x * 0.0012, at.y + normal.y * 0.0012, at.z + normal.z * 0.0012);
      // The weights of the cloth nearest it
      let near = 0;
      let best = Infinity;
      for (let v = 0; v < sp.count; v++) {
        const d = (sp.getX(v) - at.x) ** 2 + (sp.getY(v) - at.y) ** 2 + (sp.getZ(v) - at.z) ** 2;
        if (d < best) {
          best = d;
          near = v;
        }
      }
      const n = b.attributes.position.count;
      const SI = new Uint16Array(n * 4);
      const SW = new Float32Array(n * 4);
      for (let v = 0; v < n; v++) {
        for (let k = 0; k < 4; k++) {
          SI[v * 4 + k] = ski.getComponent(near, k);
          SW[v * 4 + k] = skw.getComponent(near, k);
        }
      }
      b.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
      b.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
      b.deleteAttribute('uv');
      parts.push(b);
    }
    return mergeGeometries(parts) ?? new THREE.BufferGeometry();
  }

  /**
   * The model's shirt for the staff: its collar and cuffs, and the front of
   * it brought forward to sit just behind the closed-up V so the two read as
   * one shirt. The pocket square goes.
   */
  private static staffShirt(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const { of, top, bottom } = HitmanVisual.pieces(src);
    const idx = src.index!.array;
    const keep: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const r = of[idx[i]];
      const square = bottom.get(r)! > 1.3 && top.get(r)! < 1.36;
      if (!square) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    const g = HitmanVisual.reindexed(src, [keep]);
    g.clearGroups();
    HitmanVisual.reshaped(g, keep, 0.0015);
    return g;
  }

  /** Each vertex's weight on each of a set of bones. */
  private static weightOn(g: THREE.BufferGeometry, v: number, names: string[]): number {
    const si = g.attributes.skinIndex;
    const sw = g.attributes.skinWeight;
    let w = 0;
    for (let k = 0; k < 4; k++) {
      if (names.includes(HitmanVisual.boneNames[si.getComponent(v, k)])) w += sw.getComponent(v, k);
    }
    return w;
  }

  /**
   * The boss's build, pushed into the bind pose of one of the model's meshes
   * so it rides every pose the skin does: a belly out in front and wide at
   * the sides, a broad chest, thick arms and thighs, a thick neck, and under
   * the chin a second one.
   */
  private static fattened(src: THREE.BufferGeometry, face: boolean): THREE.BufferGeometry {
    const g = src.clone();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const R = HitmanVisual.rest;
    const P = (n: string) => R.get(n)!.modelP;
    const TORSO = ['Hips', 'Spine', 'Chest', 'UpperChest'];
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const gauss = (x: number, c: number, s: number) => Math.exp(-(((x - c) / s) ** 2));
    const smooth = (a: number, b: number, x: number) => {
      const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };
    /** Thicken round the segment a–b by `k`, as far as the vertex belongs to it. */
    const swell = (a: THREE.Vector3, b: THREE.Vector3, k: number, w: number) => {
      if (w <= 0) return;
      const ab = q.copy(b).sub(a);
      const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
      const on = a.clone().addScaledVector(ab, t);
      p.sub(on).multiplyScalar(1 + k * w).add(on);
    };
    for (let v = 0; v < pos.count; v++) {
      p.fromBufferAttribute(pos, v);
      const tw = HitmanVisual.weightOn(g, v, TORSO);
      if (tw > 0) {
        // Belly: forward, wide, and hanging a little
        const belly = gauss(p.y, 1.06, 0.15) * tw;
        const chest = gauss(p.y, 1.3, 0.12) * tw;
        const fwd = smooth(0.03, -0.09, p.z);
        p.x *= 1 + 0.3 * belly + 0.1 * chest;
        p.z += -0.08 * belly * fwd + 0.025 * belly * (1 - fwd);
        p.y -= 0.018 * belly * fwd;
      }
      for (const sd of ['L', 'R']) {
        swell(P(`UpperArm_${sd}`), P(`LowerArm_${sd}`), 0.28, HitmanVisual.weightOn(g, v, [`UpperArm_${sd}`]));
        swell(P(`LowerArm_${sd}`), P(`Hand_${sd}`), 0.14, HitmanVisual.weightOn(g, v, [`LowerArm_${sd}`]));
        swell(P(`UpperLeg_${sd}`), P(`LowerLeg_${sd}`), 0.34, HitmanVisual.weightOn(g, v, [`UpperLeg_${sd}`]));
        swell(P(`LowerLeg_${sd}`), P(`Foot_${sd}`), 0.12, HitmanVisual.weightOn(g, v, [`LowerLeg_${sd}`]));
      }
      // The neck, and the collars round it, let out
      const nw = HitmanVisual.weightOn(g, v, ['Neck']) + (p.y > 1.44 ? tw * smooth(1.44, 1.47, p.y) : 0);
      if (nw > 0 && p.y < 1.53) {
        const c = new THREE.Vector3(0, p.y, 0.008);
        p.sub(c).multiplyScalar(1 + 0.22 * Math.min(1, nw)).add(c);
      }
      if (face) {
        // The second chin: the throat under the jaw rolled forward and down
        const roll = gauss(p.y, 1.478, 0.022) * gauss(p.x, 0, 0.05) * smooth(0.0, -0.035, p.z);
        p.z -= 0.024 * roll;
        p.y -= 0.006 * roll;
        // And heavy jowls
        const jowl = gauss(p.y, 1.52, 0.03) * smooth(0.03, 0.06, Math.abs(p.x)) * smooth(0.04, -0.02, p.z);
        p.x *= 1 + 0.16 * jowl;
      }
      pos.setXYZ(v, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  /**
   * A beard grown out of the face: the triangles of the jaw, the chin, the
   * cheeks and the lip, lifted off the skin along their normals — so it fits
   * the face exactly and is skinned to the head as the face is. The lips stay
   * bare, and it stops at the ears: nothing round the back.
   */
  private static beardFrom(face: THREE.BufferGeometry): THREE.BufferGeometry {
    const pos = face.attributes.position;
    const nor = face.attributes.normal;
    const idx = face.index!.array;
    const inBeard = (v: number): boolean => {
      const x = Math.abs(pos.getX(v));
      const y = pos.getY(v);
      const z = pos.getZ(v);
      if (z > 0.022) return false; // not behind the ears
      if (z < -0.09 && y > 1.55) return false; // the nose
      // The lips, bare
      if (x < 0.035 && y > 1.506 && y < 1.551 && z < -0.05) return false;
      // Up to the cheek line: under the nose in the middle, higher at the sides
      const topY = 1.566 + 0.024 * THREE.MathUtils.clamp((x - 0.03) / 0.03, 0, 1);
      if (y > topY) return false;
      // Down to the jaw, and no further: the throat below is the second chin
      const lowY = x < 0.035 ? 1.494 : 1.49 + 0.02 * THREE.MathUtils.clamp((x - 0.035) / 0.03, 0, 1);
      return y >= lowY;
    };
    const tris: number[] = [];
    const used = new Map<number, number>();
    const touched = new Set<number>();
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i];
      const b = idx[i + 1];
      const c = idx[i + 2];
      if (inBeard(a) && inBeard(b) && inBeard(c)) tris.push(a, b, c);
      else {
        touched.add(a);
        touched.add(b);
        touched.add(c);
      }
    }
    // Pack the vertices the beard uses into a geometry of its own
    const out = new THREE.BufferGeometry();
    const order: number[] = [];
    const newIdx = tris.map((v) => {
      let k = used.get(v);
      if (k === undefined) {
        k = order.length;
        used.set(v, k);
        order.push(v);
      }
      return k;
    });
    const P = new Float32Array(order.length * 3);
    const N = new Float32Array(order.length * 3);
    const SI = new Uint16Array(order.length * 4);
    const SW = new Float32Array(order.length * 4);
    const si = face.attributes.skinIndex;
    const sw = face.attributes.skinWeight;
    order.forEach((v, k) => {
      // Thick over the jaw, thinning to nothing at its edge so it grows out
      // of the skin rather than standing off it
      const lift = touched.has(v) ? 0.0012 : 0.0055;
      P[k * 3] = pos.getX(v) + nor.getX(v) * lift;
      P[k * 3 + 1] = pos.getY(v) + nor.getY(v) * lift;
      P[k * 3 + 2] = pos.getZ(v) + nor.getZ(v) * lift;
      N[k * 3] = nor.getX(v);
      N[k * 3 + 1] = nor.getY(v);
      N[k * 3 + 2] = nor.getZ(v);
      for (let j = 0; j < 4; j++) {
        SI[k * 4 + j] = si.getComponent(v, j);
        SW[k * 4 + j] = sw.getComponent(v, j);
      }
    });
    out.setAttribute('position', new THREE.BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    out.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    out.setIndex(newIdx);
    out.computeBoundingSphere();
    return out;
  }

  /** Coarse dark hair, flecked lighter and darker by where on the face it is. */
  private static beardMat(): THREE.Material {
    return HitmanVisual.outfitMat('beard', () => {
      const m = new THREE.MeshStandardMaterial({ name: 'HM_Beard', color: 0x2a1d15, roughness: 0.95 });
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            float fleck = fract(sin(dot(floor(vBind * vec3(900.0, 420.0, 900.0)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            diffuseColor.rgb *= fleck < 0.45 ? 0.55 : fleck < 0.85 ? 1.15 : 1.9;`
          );
      };
      m.customProgramCacheKey = () => 'hitman-beard';
      return m;
    });
  }

  /** His tie: broad gold and red stripes on the diagonal, with fine dark rules. */
  private static stripedTieMat(): THREE.Material {
    return HitmanVisual.outfitMat('tie:striped', () => {
      const m = new THREE.MeshStandardMaterial({ name: 'HM_Tie', color: 0xffffff, roughness: 0.45 });
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            float s = fract((vBind.y - vBind.x) * 38.0);
            vec3 red = vec3(0.36, 0.012, 0.018);
            vec3 gold = vec3(0.68, 0.40, 0.03);
            vec3 rule = vec3(0.045, 0.004, 0.006);
            diffuseColor.rgb = s < 0.36 ? gold : (s < 0.42 || s > 0.96) ? rule : red;`
          );
      };
      m.customProgramCacheKey = () => 'hitman-tie-stripes';
      return m;
    });
  }

  /** The eyes: white, with a dark iris — the agents' are behind sunglasses and never modelled. */
  private eyes: THREE.Object3D[] = [];
  private eyeOpen = 1;

  /** 0 shut .. 1 open .. 1.4 wide with fright. */
  setEyes(open: number): void {
    const v = THREE.MathUtils.clamp(open, 0.05, 1.6);
    if (Math.abs(v - this.eyeOpen) < 0.01) return;
    this.eyeOpen = v;
    for (const e of this.eyes) e.scale.y = v;
  }

  /**
   * Close one fist round `o`: it is set in the hand's grip with its +X
   * running along the knuckles towards the thumb, pushed `out` that way so
   * most of it shows past the thumb, and from then on rides the hand bone.
   * Its +Y faces out of the back of the hand.
   */
  holdInHand(sd: 'L' | 'R', o: THREE.Object3D, out = 0.03): void {
    const H = HitmanVisual;
    const rest = H.handRest![sd];
    const wrist = H.rest.get(`Hand_${sd}`)!.modelP;
    o.position.copy(wrist).add(rest.grip).addScaledVector(rest.thumb, out);
    const x = rest.thumb.clone();
    const y = rest.palm.clone().negate();
    y.addScaledVector(x, -y.dot(x)).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.hang(o, `Hand_${sd}`);
  }

  /**
   * Put `o`, placed in the model's rest frame, on bone `name` so it moves
   * with it. Worked from the template's bones, which never leave the rest
   * pose — this copy's may already have been posed.
   */
  private hang(o: THREE.Object3D, name: string): void {
    const rest = HitmanVisual.template!.getObjectByName(name)!;
    rest.updateWorldMatrix(true, false);
    o.updateMatrix();
    HitmanVisual._m.copy(rest.matrixWorld).invert().multiply(o.matrix).decompose(o.position, o.quaternion, o.scale);
    this.byName.get(name)!.bone.add(o);
  }

  /**
   * Out of the agents' kit and into `outfit`: the suit, the gloves and the
   * sunglasses swapped for the staff's uniform or the boss's, eyes where the
   * glasses were, and a cap.
   */
  private restyle(look: HitmanLook, outfit: 'staff' | 'boss'): void {
    const H = HitmanVisual;
    const staff = outfit === 'staff';
    const shirtMat = H.outfitMat('staff:shirt', () => new THREE.MeshStandardMaterial({ name: 'HM_StaffShirt', color: 0xeeebe3, roughness: 0.85 }));
    const trouserMat = H.outfitMat('staff:trousers', () => new THREE.MeshStandardMaterial({ name: 'HM_Chinos', color: 0x2f4a7a, roughness: 0.9 }));
    let face: THREE.SkinnedMesh | null = null;
    let suit: THREE.SkinnedMesh | null = null;
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.Material).name;
      if (mat === 'HM_Lens' || mat === 'HM_Metal' || mat === 'HM_Wire') {
        m.visible = false;
        return;
      }
      if (mat === 'HM_Glove') m.material = H.handMat(look.skin);
      if (staff) {
        if (m.name === 'HitmanBody_1') {
          suit = m;
          m.geometry = H.outfitGeo('staff:suit', () => H.staffSuit(m.geometry));
          m.material = [shirtMat, trouserMat];
        } else if (mat === 'HM_Shirt') {
          m.geometry = H.outfitGeo('staff:shirt', () => H.staffShirt(m.geometry));
          m.material = shirtMat;
        }
        else if (mat === 'HM_Tie') m.visible = false;
        return;
      }
      // The boss: built heavy, the tie in his stripes
      if (m.name === 'HitmanBody_1' || mat === 'HM_Shirt' || mat === 'HM_Tie' || mat === 'HM_Skin') {
        m.geometry = H.outfitGeo(`boss:${m.name}`, () => H.fattened(m.geometry, mat === 'HM_Skin'));
      }
      if (mat === 'HM_Tie') m.material = H.stripedTieMat();
      if (m.name === 'HitmanFace_1') face = m;
    });

    // Eyes, set into the face where the lenses were
    const white = H.outfitMat('eye:white', () => new THREE.MeshStandardMaterial({ name: 'HM_EyeWhite', color: 0xf0ece4, roughness: 0.35 }));
    const iris = H.outfitMat('eye:iris', () => new THREE.MeshStandardMaterial({ name: 'HM_Iris', color: 0x1f140d, roughness: 0.3 }));
    const ball = H.outfitGeo('eye:ball', () => new THREE.SphereGeometry(1, 14, 10));
    for (const sd of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(sd * 0.032, 1.6335, -0.0745);
      const w = new THREE.Mesh(ball, white);
      w.scale.set(0.0125, 0.0082, 0.0055);
      const pupil = new THREE.Mesh(ball, iris);
      pupil.scale.set(0.0052, 0.0056, 0.0022);
      pupil.position.set(0, 0, -0.0048);
      eye.add(w, pupil);
      // The boss: small and narrowed, heavy-lidded
      if (!staff) eye.scale.set(0.9, 0.72, 1);
      this.hang(eye, 'Head');
      this.eyes.push(eye);
    }

    // A cap. The staff wear the floor's navy one; his is red with a gold band
    const capMat = staff
      ? H.outfitMat('cap:navy', () => new THREE.MeshStandardMaterial({ name: 'HM_Cap', color: 0x1d3f6e, roughness: 0.85, side: THREE.DoubleSide }))
      : H.outfitMat('cap:red', () => new THREE.MeshStandardMaterial({ name: 'HM_Cap', color: 0xa3161c, roughness: 0.7, side: THREE.DoubleSide }));
    const cap = new THREE.Group();
    const crown = new THREE.Mesh(
      H.outfitGeo('cap:crown', () => new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
      capMat
    );
    crown.scale.set(0.088, staff ? 0.078 : 0.058, 0.096);
    cap.add(crown);
    const peak = new THREE.Mesh(
      H.outfitGeo('cap:peak', () => new THREE.CylinderGeometry(1, 1, 1, 20, 1, false, Math.PI / 2, Math.PI)),
      capMat
    );
    peak.scale.set(0.082, 0.007, 0.075);
    peak.position.set(0, 0.002, -0.066);
    // Its front edge down a touch
    peak.rotation.x = -0.12;
    cap.add(peak);
    if (!staff) {
      const gold = H.outfitMat('cap:gold', () => new THREE.MeshStandardMaterial({ name: 'HM_Gold', color: 0xd4a52a, roughness: 0.35, metalness: 0.55 }));
      const band = new THREE.Mesh(H.outfitGeo('cap:band', () => new THREE.CylinderGeometry(1, 1, 1, 28, 1, true)), gold);
      band.scale.set(0.0895, 0.017, 0.0975);
      band.position.y = 0.008;
      cap.add(band);
      const btn = new THREE.Mesh(ball, gold);
      btn.scale.setScalar(0.009);
      btn.position.y = 0.058;
      cap.add(btn);
    }
    cap.position.set(0, 1.672, 0.004);
    cap.rotation.x = -0.05;
    cap.name = 'HitmanCap';
    this.hang(cap, 'Head');

    // A plain button-up: a row of black buttons down the front
    if (staff && suit) {
      const body = suit as THREE.SkinnedMesh;
      const shirtMesh = this.model.getObjectByName('HitmanBody_2') as THREE.Mesh;
      const buttons = new THREE.SkinnedMesh(
        H.outfitGeo('staff:buttons', () => H.buttonsFor(body.geometry, shirtMesh.geometry)),
        H.outfitMat('staff:button', () => new THREE.MeshStandardMaterial({ name: 'HM_Button', color: 0x0d0d0f, roughness: 0.35 }))
      );
      buttons.name = 'HitmanButtons';
      body.parent!.add(buttons);
      buttons.position.copy(body.position);
      buttons.quaternion.copy(body.quaternion);
      buttons.scale.copy(body.scale);
      buttons.bind(body.skeleton, body.bindMatrix);
      buttons.boundingSphere = this.cull;
    }

    // His beard, grown out of his (heavier) face
    if (!staff && face) {
      const f = face as THREE.SkinnedMesh;
      const beard = new THREE.SkinnedMesh(H.outfitGeo('boss:beard', () => H.beardFrom(f.geometry)), H.beardMat());
      beard.name = 'HitmanBeard';
      f.parent!.add(beard);
      beard.position.copy(f.position);
      beard.quaternion.copy(f.quaternion);
      beard.scale.copy(f.scale);
      beard.bind(f.skeleton, f.bindMatrix);
      beard.boundingSphere = this.cull;
    }
  }

  // ------------------------------------------------------------ the General

  /**
   * How much further out the General's shoulder joints are than the model's,
   * along each collarbone. Letting out the bind pose cannot by itself make a
   * man broad across the shoulders: the model's arms hang close against his
   * sides, and a chest let out by a third would come out through his
   * sleeves. So his collarbones are longer instead — the arm joints sit 5 cm
   * further out, the arms go with them, and the cloth over the top of each
   * shoulder is let out to meet them (see bulked).
   */
  private static readonly GENERAL_SHOULDERS = 0.05;

  /** How far each arm's joints sit from where the model has them, in its frame; null for everyone but the General. */
  private armShift: { L: THREE.Vector3; R: THREE.Vector3 } | null = null;
  /** Built like a wardrobe: his hitboxes are let out to the size of him. */
  private bulk = false;

  /** The bones of one arm, shoulder joint to fingertips. */
  private static armBones(sd: 'L' | 'R'): string[] {
    const out = [`UpperArm_${sd}`, `LowerArm_${sd}`, `Hand_${sd}`];
    for (const f of FINGERS) for (let k = 1; k <= 3; k++) out.push(`${f}${k}_${sd}`);
    return out;
  }

  /** Where bone `n` is at rest in this copy, model frame: the model's rest, with the General's arms let out. */
  private restP(n: string): THREE.Vector3 {
    const p = HitmanVisual.rest.get(n)!.modelP;
    const s = this.armShift;
    if (!s || n.startsWith('Shoulder') || /Leg|Foot|Toe/.test(n)) return p;
    if (n.endsWith('_L')) return p.clone().add(s.L);
    if (n.endsWith('_R')) return p.clone().add(s.R);
    return p;
  }

  /**
   * Longer collarbones: each arm's joint moved `d` further out along the
   * bone that carries it. The skin is bound to the model's own skeleton, so
   * moving the bone moves every vertex hung on it — the whole arm — and the
   * cloth between it and the chest stretches across the gap.
   */
  private broadenShoulders(d: number): void {
    const H = HitmanVisual;
    this.armShift = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    for (const sd of ['L', 'R'] as const) {
      const j = this.byName.get(`UpperArm_${sd}`)!;
      const r = j.rest;
      this.armShift[sd].copy(r.modelP).sub(H.rest.get(`Shoulder_${sd}`)!.modelP).setLength(d);
      // A rest of his own: the shared one is every agent's
      const localP = r.localP.clone().setLength(r.localP.length() + d);
      j.rest = { localQ: r.localQ, localP, modelQ: r.modelQ, modelP: r.modelP.clone().add(this.armShift[sd]) };
      j.bone.position.copy(localP);
    }
  }

  /**
   * The General's build, pushed into the bind pose of one of the model's
   * meshes the way the boss's is (see fattened), but muscle rather than
   * fat: a chest a good deal broader and deeper with the pectorals standing
   * out under the jacket, the shoulders let out to the longer collarbones,
   * a bull's neck and the slope of muscle down from it to the shoulders,
   * arms half as thick again — the forearms most of all near the elbow —
   * big hands, heavy thighs, and no belly at all. With `face`, a heavy
   * square jaw and a broad chin.
   *
   * The same smooth fields are applied to every layer — coat, lapels,
   * shirt, tie, buttons — so one still lies over the other afterwards.
   * Normals are left as modelled: re-deriving them would split the shading
   * at every seam in the cloth.
   */
  private static bulked(src: THREE.BufferGeometry, face: boolean): THREE.BufferGeometry {
    const H = HitmanVisual;
    const g = src.clone();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const P = (n: string) => H.rest.get(n)!.modelP;
    const S = H.smoothstep;
    const TORSO = ['Hips', 'Spine', 'Chest', 'UpperChest'];
    const SHOULDERS = ['Shoulder_L', 'Shoulder_R'];
    const gauss = (x: number, c: number, s: number) => Math.exp(-(((x - c) / s) ** 2));
    const p = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const on = new THREE.Vector3();
    /** Thicken round the segment a–b by k(t), t running 0 at a to 1 at b, as far as the vertex belongs to it. */
    const swell = (a: THREE.Vector3, b: THREE.Vector3, k: (t: number) => number, w: number) => {
      if (w <= 0) return;
      ab.copy(b).sub(a);
      const t = THREE.MathUtils.clamp(on.copy(p).sub(a).dot(ab) / ab.lengthSq(), 0, 1);
      on.copy(a).addScaledVector(ab, t);
      p.sub(on).multiplyScalar(1 + k(t) * w).add(on);
    };
    // The upper arm only a little thicker where the sleeve is set into the
    // shoulder — swell it there and the sleeve's head stands up off the
    // coat in a ring — and half as thick again from the biceps down; the
    // forearm heaviest by the elbow; the thighs heaviest at the top
    const UPPER = (t: number) => 0.12 + 0.43 * S(0, 0.45, t);
    const FORE = (t: number) => 0.5 - 0.2 * t;
    const HAND = () => 0.12;
    const THIGH = (t: number) => 0.32 - 0.12 * t;
    const CALF = (t: number) => 0.2 - 0.15 * t;
    const sides = (['L', 'R'] as const).map((sd) => ({
      sd,
      sign: sd === 'L' ? -1 : 1,
      arm: H.armBones(sd),
      hand: H.armBones(sd).slice(2),
      clavicle: P(`UpperArm_${sd}`).clone().sub(P(`Shoulder_${sd}`)).normalize()
    }));
    for (let v = 0; v < pos.count; v++) {
      p.fromBufferAttribute(pos, v);
      // The fields are all read off where the vertex was, so the order the
      // changes go in does not move one layer of cloth off another
      const x0 = p.x;
      const y0 = p.y;
      const z0 = p.z;
      const ax = Math.abs(x0);
      const tw = H.weightOn(g, v, TORSO);

      // Limbs, thickened round their bones
      for (const s of sides) {
        const sd = s.sd;
        swell(P(`UpperArm_${sd}`), P(`LowerArm_${sd}`), UPPER, H.weightOn(g, v, [`UpperArm_${sd}`]));
        swell(P(`LowerArm_${sd}`), P(`Hand_${sd}`), FORE, H.weightOn(g, v, [`LowerArm_${sd}`]));
        swell(P(`Hand_${sd}`), P(`Middle1_${sd}`), HAND, H.weightOn(g, v, s.hand));
        swell(P(`UpperLeg_${sd}`), P(`LowerLeg_${sd}`), THIGH, H.weightOn(g, v, [`UpperLeg_${sd}`]));
        swell(P(`LowerLeg_${sd}`), P(`Foot_${sd}`), CALF, H.weightOn(g, v, [`LowerLeg_${sd}`]));
      }

      if (tw > 0) {
        // A little fuller through the chest and the waist. Most of his
        // breadth is the shoulders and the lats going out with the arms
        // (below): out here they would only push into his sleeves
        p.x *= 1 + (0.06 * gauss(y0, 1.27, 0.12) + 0.04 * gauss(y0, 1.04, 0.1)) * tw;
        // A deep chest: the pectorals out either side of the breastbone,
        // which comes most of the way with them so the tie doesn't sink
        // into a trench between them
        const pec = gauss(y0, 1.33, 0.075) * (0.6 + 0.4 * S(0, 0.07, ax)) * (1 - S(0.11, 0.2, ax)) * S(0, -0.07, z0);
        p.z -= 0.028 * pec * tw;
        // And the back of it: shoulder blades and lats
        p.z += 0.016 * gauss(y0, 1.3, 0.1) * S(0.02, 0.09, z0) * tw;
      }

      // A bull's neck, and the collars round it let out
      const nw = H.weightOn(g, v, ['Neck']) + (y0 > 1.44 ? tw * S(1.44, 1.47, y0) : 0);
      if (nw > 0 && y0 < 1.53) {
        const k = 1 + 0.3 * Math.min(1, nw);
        p.x *= k;
        p.z = 0.008 + (p.z - 0.008) * k;
      }
      // The muscle sloping from it down to each shoulder, built up
      const ws = H.weightOn(g, v, SHOULDERS);
      p.y += 0.014 * gauss(ax, 0.1, 0.045) * S(1.4, 1.46, y0) * Math.min(1, tw + ws);

      // The shoulders, and the sides of the chest under them, out with the
      // arms on their longer collarbones: across the top of the shoulder,
      // round the armhole and down the lats, all the way out at the sides
      // and less the nearer the middle of him or his waist. The arm goes out
      // with its bone, so only what the bone doesn't carry is moved here —
      // and the coat round the armhole goes as far as the sleeve set in it
      for (const s of sides) {
        if (x0 * s.sign <= 0) continue;
        const reach = S(0.07, 0.2, ax) * S(1.12, 1.36, y0) - H.weightOn(g, v, s.arm);
        if (reach > 0) p.addScaledVector(s.clavicle, H.GENERAL_SHOULDERS * reach);
      }

      if (face) {
        // A heavy jaw, square at the angles, and a broad chin brought forward
        const jaw = gauss(y0, 1.525, 0.022) * S(0.02, 0.05, ax) * S(0.03, -0.01, z0);
        p.x *= 1 + 0.16 * jaw;
        const chin = gauss(y0, 1.51, 0.013) * (1 - S(0.022, 0.045, ax)) * S(-0.03, -0.06, z0);
        p.x *= 1 + 0.3 * chin;
        p.z -= 0.008 * chin;
        p.y -= 0.003 * chin;
      }
      pos.setXYZ(v, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  /**
   * His dress uniform out of the suit, built heavy: everything below the
   * waist is trousers, everything above it the coat — lapels and all, a
   * dress uniform has them — and the lapels taken in, narrower than a
   * civilian's, to leave the left breast clear for his ribbons. Material 0
   * is the coat, 1 the trousers.
   */
  private static generalSuit(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const H = HitmanVisual;
    const { of, top, bottom, front } = H.pieces(src);
    const idx = src.index!.array;
    const coat: number[] = [];
    const trousers: number[] = [];
    for (let i = 0; i < idx.length; i += 3) (top.get(of[idx[i]])! < 1.035 ? trousers : coat).push(idx[i], idx[i + 1], idx[i + 2]);
    const g = H.reindexed(H.bulked(src, false), [coat, trousers]);
    // The lapels: pieces lying wholly on the front of the chest, below the
    // collar. Each is drawn in towards the opening of the V
    const pos = g.attributes.position as THREE.BufferAttribute;
    const src0 = src.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const r = of[v];
      if (!(front.get(r)! < -0.06 && bottom.get(r)! > 1.1 && top.get(r)! < 1.47)) continue;
      // The opening runs from 1.5 cm off the middle at the bottom of the V
      // to 6 cm at the collar
      const y = src0.getY(v);
      const inner = 0.016 + 0.155 * THREE.MathUtils.clamp(y - 1.18, 0, 0.3);
      const ax = Math.abs(src0.getX(v));
      if (ax <= inner) continue;
      const k = (inner + (ax - inner) * 0.66) / ax;
      pos.setX(v, pos.getX(v) * k);
    }
    pos.needsUpdate = true;
    return g;
  }

  /** The shirt under his coat, built heavy, with no pocket square in the coat over it. */
  private static generalShirt(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const H = HitmanVisual;
    const { of, top, bottom } = H.pieces(src);
    const idx = src.index!.array;
    const keep: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const r = of[idx[i]];
      if (!(bottom.get(r)! > 1.3 && top.get(r)! < 1.36)) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    const g = H.reindexed(H.bulked(src, false), [keep]);
    g.clearGroups();
    return g;
  }

  /**
   * The model's tie mesh carries the coat's buttons as well — down the
   * front and four at each cuff — so it is split: the tie (the knot and the
   * blade, the only pieces of any height) is material 0, the buttons 1.
   * The top button of the front goes with the tie: the blade hangs over
   * it, and in gold it would show through as a bright nick in the tie.
   */
  private static generalTie(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const H = HitmanVisual;
    const { of, top, bottom, front } = H.pieces(src);
    const idx = src.index!.array;
    const tie: number[] = [];
    const buttons: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const r = of[idx[i]];
      const button = top.get(r)! - bottom.get(r)! <= 0.03;
      const underTie = button && bottom.get(r)! > 1.12 && front.get(r)! < -0.08;
      (button && !underTie ? buttons : tie).push(idx[i], idx[i + 1], idx[i + 2]);
    }
    return H.reindexed(H.bulked(src, false), [tie, buttons]);
  }

  /**
   * The agents' wraparounds made aviators: below the middle of each lens
   * the glass is drawn further down, most of all two-thirds of the way out
   * from the nose, so each lens comes to the teardrop that shape is named
   * for. The frame (the bridge and the arms) is left as it is.
   */
  private static aviators(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const g = src.clone();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const mid = 1.6285;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      if (y >= mid) continue;
      const k = 0.5 * Math.exp(-(((Math.abs(pos.getX(v)) - 0.042) / 0.026) ** 2));
      pos.setY(v, mid + (y - mid) * (1 + k));
    }
    pos.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  private static generalMats(): Record<
    'coat' | 'trousers' | 'shirt' | 'tie' | 'gold' | 'glove' | 'lens' | 'frame' | 'crown' | 'band' | 'visor' | 'ribbons' | 'medals',
    THREE.Material
  > {
    const H = HitmanVisual;
    const std = (key: string, p: THREE.MeshStandardMaterialParameters) =>
      H.outfitMat(`general:${key}`, () => new THREE.MeshStandardMaterial(p));
    return {
      coat: std('coat', { name: 'HM_Uniform', color: 0x4a5236, roughness: 0.8 }),
      trousers: std('trousers', { name: 'HM_Uniform', color: 0x3d4430, roughness: 0.82 }),
      shirt: std('shirt', { name: 'HM_Shirt', color: 0xb8a67b, roughness: 0.85 }),
      tie: std('tie', { name: 'HM_Tie', color: 0x2c3322, roughness: 0.5 }),
      gold: std('gold', { name: 'HM_Gold', color: 0xd4a52a, roughness: 0.32, metalness: 0.6 }),
      // Black leather, with a little shine on the knuckles
      glove: std('glove', { name: 'HM_Glove', color: 0x121214, roughness: 0.36 }),
      // Smoked glass with a gold mirror to it: the lights catch it gold
      lens: std('lens', { name: 'HM_Lens', color: 0x2e2616, roughness: 0.1, metalness: 0.7 }),
      frame: std('frame', { name: 'HM_Metal', color: 0xc89b3c, roughness: 0.3, metalness: 0.6 }),
      crown: std('crown', { name: 'HM_Cap', color: 0x4a5236, roughness: 0.75, side: THREE.DoubleSide }),
      band: std('band', { name: 'HM_Cap', color: 0x23271a, roughness: 0.85, side: THREE.DoubleSide }),
      // Patent leather: black, and glossy enough to catch the sky
      visor: std('visor', { name: 'HM_Visor', color: 0x0a0a0c, roughness: 0.14, metalness: 0.35, side: THREE.DoubleSide }),
      ribbons: std('ribbons', { name: 'HM_Ribbon', color: 0xffffff, roughness: 0.62, vertexColors: true }),
      medals: std('medals', { name: 'HM_Medal', color: 0xffffff, roughness: 0.3, metalness: 0.6, vertexColors: true })
    };
  }

  /**
   * Build a mesh out of curved sheets: each a grid of points from `at(i, j)`,
   * i over `rows` and j over `cols`. Every sheet has vertices of its own, so
   * the normals are smooth across a sheet and sharp where two sheets meet —
   * the edge of a visor stays an edge.
   */
  private static sheets(build: (sheet: (rows: number, cols: number, at: (i: number, j: number, out: THREE.Vector3) => void, flip?: boolean) => void) => void): THREE.BufferGeometry {
    const P: number[] = [];
    const I: number[] = [];
    const v = new THREE.Vector3();
    build((rows, cols, at, flip = false) => {
      const base = P.length / 3;
      for (let i = 0; i <= rows; i++) {
        for (let j = 0; j <= cols; j++) {
          at(i, j, v);
          P.push(v.x, v.y, v.z);
        }
      }
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const a = base + i * (cols + 1) + j;
          const b = a + 1;
          const c = a + cols + 1;
          const d = c + 1;
          if (flip) I.push(a, c, b, b, c, d);
          else I.push(a, b, c, b, d, c);
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setIndex(I);
    g.computeVertexNormals();
    return g;
  }

  /** Geometries as one, positions and normals only, for parts that share a material. */
  private static merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const flat = parts.map((p) => {
      const n = p.index ? p.toNonIndexed() : p.clone();
      for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
      return n;
    });
    const g = mergeGeometries(flat, false) ?? new THREE.BufferGeometry();
    for (const p of [...parts, ...flat]) p.dispose();
    g.computeBoundingSphere();
    return g;
  }

  /** His cap's band, in the cap's own frame: an oval just clear of his scalp, from its bottom edge to its top. */
  private static readonly CAP = { rx: 0.085, rz: 0.095, y0: -0.008, y1: 0.034 };

  /**
   * One curved strip round the front of the cap, out from the band's bottom
   * edge and pitched down: the visor (from 0 to 1 of the way out), or the
   * gold on it (a band of that). It narrows to nothing at either end, the
   * way a visor runs back into the band at the sides.
   */
  private static visorStrip(from: number, to: number, lift: number, thick: number): THREE.BufferGeometry {
    const C = HitmanVisual.CAP;
    const N = 30;
    const SPAN = 1.32;
    const DEPTH = 0.058;
    const DROOP = 0.55;
    const at = (i: number, f: number, dy: number, out: THREE.Vector3) => {
      const a = -SPAN + (2 * SPAN * i) / N;
      const reach = DEPTH * Math.pow(Math.max(0, Math.cos((a / SPAN) * (Math.PI / 2))), 0.55) * f;
      // Square to the oval of the band
      let nx = Math.sin(a) / C.rx;
      let nz = -Math.cos(a) / C.rz;
      const nl = Math.hypot(nx, nz);
      nx /= nl;
      nz /= nl;
      const r = reach * Math.cos(DROOP);
      out.set(Math.sin(a) * C.rx + nx * r, C.y0 + 0.002 - reach * Math.sin(DROOP) + lift + dy, -Math.cos(a) * C.rz + nz * r);
    };
    return HitmanVisual.sheets((sheet) => {
      sheet(N, 3, (i, j, o) => at(i, from + ((to - from) * j) / 3, 0, o));
      sheet(N, 3, (i, j, o) => at(i, from + ((to - from) * j) / 3, -thick, o), true);
      sheet(N, 1, (i, j, o) => at(i, to, -thick * j, o), true);
      sheet(N, 1, (i, j, o) => at(i, from, -thick * j, o));
    });
  }

  /**
   * The crown of the cap: out from the top of the band in a flare wider
   * than it, the front stood up higher than the back — the saddle of an
   * officer's cap — and the top falling a touch to the middle.
   */
  private static capCrown(): THREE.BufferGeometry {
    const C = HitmanVisual.CAP;
    const N = 44;
    // Each ring: half widths, then its height at the front and at the back
    const rings: [number, number, number, number][] = [
      [C.rx * 0.985, C.rz * 0.985, C.y1 - 0.002, C.y1 - 0.002],
      [0.107, 0.122, C.y1 + 0.036, C.y1 + 0.02],
      [0.106, 0.121, C.y1 + 0.042, C.y1 + 0.026],
      [0.08, 0.093, C.y1 + 0.044, C.y1 + 0.029]
    ];
    const top = C.y1 + 0.038;
    return HitmanVisual.sheets((sheet) => {
      sheet(rings.length - 1, N, (i, j, o) => {
        const [rx, rz, yf, yb] = rings[i];
        const a = (j / N) * Math.PI * 2;
        o.set(Math.sin(a) * rx, yb + (yf - yb) * ((1 + Math.cos(a)) / 2), -Math.cos(a) * rz);
      });
      // The top: the last ring drawn in to the middle
      sheet(1, N, (i, j, o) => {
        const [rx, rz, yf, yb] = rings[rings.length - 1];
        const a = (j / N) * Math.PI * 2;
        const k = 1 - i;
        o.set(Math.sin(a) * rx * k, (yb + (yf - yb) * ((1 + Math.cos(a)) / 2)) * k + top * (1 - k), -Math.cos(a) * rz * k);
      });
    });
  }

  /**
   * The General's cap, in its own frame (hung on his head at the boss's
   * cap's place): a dark band, the olive crown flaring out over it, the
   * black visor pitched down over his glasses with two rows of gold oak
   * leaves on it, a gold cord across the front of the band held by a button
   * at each end, and the badge — a star in a wreath — on the front of the
   * crown. One mesh per material.
   */
  private generalCap(): THREE.Group {
    const H = HitmanVisual;
    const C = H.CAP;
    const mats = H.generalMats();
    const cap = new THREE.Group();
    cap.name = 'GeneralCap';
    const band = new THREE.Mesh(
      H.outfitGeo('general:cap:band', () => {
        const g = new THREE.CylinderGeometry(1, 1, 1, 44, 1, true);
        g.scale(C.rx, C.y1 - C.y0, C.rz);
        g.translate(0, (C.y0 + C.y1) / 2, 0);
        return g;
      }),
      mats.band
    );
    const crown = new THREE.Mesh(H.outfitGeo('general:cap:crown', () => H.capCrown()), mats.crown);
    const visor = new THREE.Mesh(H.outfitGeo('general:cap:visor', () => H.visorStrip(-0.05, 1, 0, 0.0045)), mats.visor);
    const gold = new THREE.Mesh(
      H.outfitGeo('general:cap:gold', () => {
        const parts: THREE.BufferGeometry[] = [];
        // Oak leaves on the visor, two rows of them
        parts.push(H.visorStrip(0.3, 0.56, 0.0016, 0.0012), H.visorStrip(0.64, 0.92, 0.0016, 0.0012));
        // The cord across the front of the band, a button at each end
        const along = (y: number) => {
          const pts: THREE.Vector3[] = [];
          for (let a = -1.22; a <= 1.2201; a += 0.122) pts.push(new THREE.Vector3(Math.sin(a) * (C.rx + 0.0028), y, -Math.cos(a) * (C.rz + 0.0028)));
          return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0021, 5, false);
        };
        parts.push(along(C.y0 + 0.008), along(C.y0 + 0.014));
        for (const sx of [-1, 1]) {
          const b = new THREE.SphereGeometry(0.0052, 10, 6);
          b.scale(1, 1, 0.6);
          b.rotateY(sx * 1.27);
          b.translate(Math.sin(sx * 1.27) * (C.rx + 0.002), C.y0 + 0.011, -Math.cos(1.27) * (C.rz + 0.002));
          parts.push(b);
        }
        // The badge, tipped forward with the flare of the crown
        const badge: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.0128, 0.0023, 6, 22)];
        const star = new THREE.Shape();
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          const r = k % 2 ? 0.0042 : 0.0098;
          if (k === 0) star.moveTo(Math.sin(a) * r, Math.cos(a) * r);
          else star.lineTo(Math.sin(a) * r, Math.cos(a) * r);
        }
        const sg = new THREE.ExtrudeGeometry(star, { depth: 0.0022, bevelEnabled: false });
        sg.translate(0, 0, -0.0026);
        badge.push(sg);
        const place = new THREE.Matrix4().compose(
          new THREE.Vector3(0, C.y1 + 0.017, -(C.rz + 0.47 * (0.122 - C.rz)) - 0.0024),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.62, 0, 0)),
          new THREE.Vector3(1, 1, 1)
        );
        for (const b of badge) parts.push(b.applyMatrix4(place));
        return H.merged(parts);
      }),
      mats.gold
    );
    cap.add(band, crown, visor, gold);
    cap.position.set(0, 1.672, 0.004);
    cap.rotation.x = -0.04;
    return cap;
  }

  /**
   * Skin `geo` like the cloth under it: every vertex takes the bone weights
   * of the nearest vertex of `cloth`, so whatever is sewn on rides every
   * pose — the shoulder rising with the arm under an epaulette, the chest
   * under the ribbons — exactly as the cloth does. Both in the bind pose.
   */
  private static skinnedLike(geo: THREE.BufferGeometry, cloth: THREE.BufferGeometry): THREE.BufferGeometry {
    const cp = cloth.attributes.position;
    const ci = cloth.attributes.skinIndex;
    const cw = cloth.attributes.skinWeight;
    const gp = geo.attributes.position;
    // Only the cloth anywhere near it is worth searching
    if (!geo.boundingBox) geo.computeBoundingBox();
    const near = geo.boundingBox!.clone().expandByScalar(0.06);
    const cand: number[] = [];
    const v = new THREE.Vector3();
    for (let k = 0; k < cp.count; k++) if (near.containsPoint(v.fromBufferAttribute(cp, k))) cand.push(k);
    const SI = new Uint16Array(gp.count * 4);
    const SW = new Float32Array(gp.count * 4);
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i);
      const y = gp.getY(i);
      const z = gp.getZ(i);
      let best = cand[0] ?? 0;
      let bestD = Infinity;
      for (const k of cand) {
        const d = (cp.getX(k) - x) ** 2 + (cp.getY(k) - y) ** 2 + (cp.getZ(k) - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      for (let k = 0; k < 4; k++) {
        SI[i * 4 + k] = ci.getComponent(best, k);
        SW[i * 4 + k] = cw.getComponent(best, k);
      }
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    return geo;
  }

  /** Colour every vertex of `g` one colour, for the vertex-coloured kit. */
  private static tinted(g: THREE.BufferGeometry, colour: number): THREE.BufferGeometry {
    const c = new THREE.Color(colour);
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = c.r;
      a[i * 3 + 1] = c.g;
      a[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  }

  /** As merged(), keeping each part's vertex colours. */
  private static mergedColoured(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const flat = parts.map((p) => {
      const n = p.index ? p.toNonIndexed() : p.clone();
      for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') n.deleteAttribute(k);
      return n;
    });
    const g = mergeGeometries(flat, false) ?? new THREE.BufferGeometry();
    for (const p of [...parts, ...flat]) p.dispose();
    g.computeBoundingSphere();
    return g;
  }

  /** The kit sewn on his coat, built once: gold (epaulettes, pocket buttons), ribbons, medals. */
  private static generalKitCache: { gold: THREE.BufferGeometry; ribbons: THREE.BufferGeometry; medals: THREE.BufferGeometry } | null = null;

  /**
   * Everything sewn onto his coat, in the bind pose of the coat as built
   * (`coat`: its geometry, let out by bulked) and skinned like it:
   *
   *  - Gold epaulettes on the shoulders — a board along the top of each
   *    from beside the collar out to the shoulder's point, a button at its
   *    inner end, and a heavy bullion fringe hanging off the outer end down
   *    over the top of the arm.
   *  - Gold buttons on the four pocket flaps.
   *  - On his left breast, over the pocket: four rows of ribbons in a rack,
   *    and below it three medals on their ribbons — a gold disc, a silver
   *    star, a bronze cross. Every colour made up; none of them anybody's.
   *
   * Laid on the cloth by looking at it: down onto the shoulders, in at the
   * sides of the arms, straight at the chest.
   */
  private static generalKit(coat: THREE.BufferGeometry): { gold: THREE.BufferGeometry; ribbons: THREE.BufferGeometry; medals: THREE.BufferGeometry } {
    const H = HitmanVisual;
    if (H.generalKitCache) return H.generalKitCache;
    const pos = coat.attributes.position;
    const idx = coat.index!.array;
    const tris: THREE.Triangle[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const t = new THREE.Triangle(
        new THREE.Vector3().fromBufferAttribute(pos, idx[i]),
        new THREE.Vector3().fromBufferAttribute(pos, idx[i + 1]),
        new THREE.Vector3().fromBufferAttribute(pos, idx[i + 2])
      );
      // Above the waist only: the kit is all on the coat
      if (t.a.y > 0.95 || t.b.y > 0.95 || t.c.y > 0.95) tris.push(t);
    }
    const ray = new THREE.Ray();
    const hit = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    /** The first surface along a ray, and which way it faces (towards the ray's origin), or null. */
    const cast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): { p: THREE.Vector3; n: THREE.Vector3 } | null => {
      ray.origin.set(ox, oy, oz);
      ray.direction.set(dx, dy, dz).normalize();
      let best: { p: THREE.Vector3; n: THREE.Vector3 } | null = null;
      let bestD = Infinity;
      for (const t of tris) {
        if (!ray.intersectTriangle(t.a, t.b, t.c, false, hit)) continue;
        const d = hit.distanceToSquared(ray.origin);
        if (d < bestD) {
          bestD = d;
          t.getNormal(nrm);
          if (nrm.dot(ray.direction) > 0) nrm.negate();
          best = { p: hit.clone(), n: nrm.clone() };
        }
      }
      return best;
    };
    const down = (x: number, z: number) => cast(x, 2, z, 0, -1, 0);
    const front = (x: number, y: number) => cast(x, y, -1, 0, 0, 1);

    const gold: THREE.BufferGeometry[] = [];
    const ribbons: THREE.BufferGeometry[] = [];
    const medals: THREE.BufferGeometry[] = [];

    // ---- Epaulettes. Along each shoulder from just clear of the collar
    // (let out with the neck) to the point of the shoulder (let out to the
    // longer collarbones)
    for (const sx of [-1, 1]) {
      const X0 = 0.128;
      const X1 = 0.252;
      const HW = 0.028;
      const ZC = 0.004;
      const NU = 16;
      const NW = 6;
      const surf = new Map<string, number>();
      const topAt = (x: number, z: number) => {
        const key = `${x.toFixed(4)}:${z.toFixed(4)}`;
        let y = surf.get(key);
        if (y === undefined) {
          y = down(sx * x, z)?.p.y ?? 1.45;
          surf.set(key, y);
        }
        return y;
      };
      // A rounded point at the inner end, square at the outer
      const width = (u: number) => (u < 0.18 ? Math.sqrt(Math.max(0, 1 - ((0.18 - u) / 0.18) ** 2)) : 1);
      const pt = (u: number, w: number, lift: number, o: THREE.Vector3) => {
        const x = X0 + (X1 - X0) * u;
        const z = ZC + HW * w * width(u);
        // A little crowned across its width
        const crown = 0.0018 * (1 - w * w);
        o.set(sx * x, topAt(x, z) + 0.0028 + lift + (lift > 0 ? crown : 0), z);
      };
      gold.push(
        H.sheets((sheet) => {
          const T = 0.0055;
          sheet(NU, NW, (i, j, o) => pt(i / NU, -1 + (2 * j) / NW, T, o), sx < 0);
          sheet(NU, NW, (i, j, o) => pt(i / NU, -1 + (2 * j) / NW, 0, o), sx > 0);
          sheet(NU, 1, (i, j, o) => pt(i / NU, -1, T * (1 - j), o), sx > 0);
          sheet(NU, 1, (i, j, o) => pt(i / NU, 1, T * (1 - j), o), sx < 0);
          sheet(NW, 1, (i, j, o) => pt(1, -1 + (2 * i) / NW, T * (1 - j), o), sx < 0);
        })
      );
      // The button at its inner end
      const btn = new THREE.SphereGeometry(0.0062, 10, 6);
      btn.scale(1, 0.55, 1);
      const bx = X0 + (X1 - X0) * 0.1;
      btn.translate(sx * bx, topAt(bx, ZC) + 0.0028 + 0.0055 + 0.002, ZC);
      gold.push(btn);
      // The fringe: bullion, hanging off the outer end and lying down the
      // outside of the arm below it
      const THREADS = 10;
      for (let k = 0; k < THREADS; k++) {
        const z = ZC + HW * (-0.92 + (1.84 * k) / (THREADS - 1));
        const y0 = topAt(X1, z) + 0.004;
        const pts = [new THREE.Vector3(sx * (X1 - 0.004), y0, z)];
        for (const dy of [0.008, 0.02, 0.033, 0.046]) {
          const side = cast(sx * 0.6, y0 - dy, z, -sx, 0, 0);
          const x = side ? Math.abs(side.p.x) + 0.0035 : X1 + 0.004;
          pts.push(new THREE.Vector3(sx * Math.max(x, X1 - 0.002), y0 - dy, z));
        }
        gold.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.003, 5, false));
      }
    }

    // ---- Buttons on the pocket flaps: the breast pockets' and the lower ones'
    for (const [x, y] of [[0.096, 1.312], [0.104, 1.041]]) {
      for (const sx of [-1, 1]) {
        const s = front(sx * x, y);
        if (!s) continue;
        const b = new THREE.SphereGeometry(0.0058, 10, 6);
        b.scale(1, 1, 0.5);
        b.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), s.n));
        b.translate(s.p.x + s.n.x * 0.0018, s.p.y + s.n.y * 0.0018, s.p.z + s.n.z * 0.0018);
        gold.push(b);
      }
    }

    // ---- Ribbons and medals on his left breast. One frame for the lot, off
    // the cloth at the middle of the rack — they are on a bar, not sewn on
    // one by one — and each piece then sat on the cloth along it.
    const CX = -0.128;
    const mid = front(CX, 1.36);
    const out = mid ? mid.n.clone() : new THREE.Vector3(0, 0, -1);
    const right = new THREE.Vector3(1, 0, 0).addScaledVector(out, -out.x).normalize();
    const up = new THREE.Vector3().crossVectors(right, out).normalize().negate();
    if (up.y < 0) up.negate();
    const basis = new THREE.Matrix4().makeBasis(right, up, out.clone().negate());
    /** A box `w` by `h`, `d` deep, its middle at (x, y) on the chest and standing off it by `off`. */
    const plate = (w: number, h: number, d: number, x: number, y: number, off: number, colour: number, into: THREE.BufferGeometry[]) => {
      const s = front(x, y);
      const at = s ? s.p : new THREE.Vector3(x, y, -0.13);
      // Back along the rack's own facing to wherever the cloth is
      const g = H.tinted(new THREE.BoxGeometry(w, h, d), colour);
      g.applyMatrix4(basis);
      g.translate(at.x + out.x * (off + d / 2), at.y + out.y * (off + d / 2), at.z + out.z * (off + d / 2));
      into.push(g);
    };
    const RIBBONS: [number, number, number][] = [
      [0x8c1a1a, 0xe8e0d0, 0x1a2d6b],
      [0xd8a821, 0x1f5a2e, 0xd8a821],
      [0x5a1f6b, 0xe8e0d0, 0x5a1f6b],
      [0x1a2d6b, 0xd8a821, 0x8c1a1a],
      [0x2e6b3a, 0xe8e0d0, 0x8c1a1a],
      [0xc8441a, 0x151515, 0xc8441a],
      [0x1a2d6b, 0xe8e0d0, 0x1a2d6b],
      [0xd8a821, 0x8c1a1a, 0xd8a821],
      [0x6b8fb8, 0xe8e0d0, 0x6b8fb8],
      [0x8c1a1a, 0xd8a821, 0x1f5a2e],
      [0x3a3a3a, 0xd8a821, 0x3a3a3a]
    ];
    const RW = 0.023;
    const RH = 0.0085;
    const GAP = 0.0007;
    /** One ribbon: five stripes, the outer pair, an inner pair and a centre. */
    const ribbon = (x: number, y: number, w: number, h: number, c: [number, number, number], into: THREE.BufferGeometry[]) => {
      const widths = [0.28, 0.13, 0.18, 0.13, 0.28];
      const cols = [c[0], c[1], c[2], c[1], c[0]];
      let left = x - w / 2;
      widths.forEach((f, k) => {
        plate(w * f, h, 0.0026, left + (w * f) / 2, y, 0.0006, cols[k], into);
        left += w * f;
      });
    };
    let n = 0;
    const rows = [3, 3, 3, 2];
    rows.forEach((count, row) => {
      const y = 1.342 + row * (RH + GAP) + RH / 2;
      for (let k = 0; k < count; k++) {
        const x = CX + (k - (count - 1) / 2) * (RW + GAP);
        ribbon(x, y, RW, RH, RIBBONS[n++ % RIBBONS.length], ribbons);
      }
    });
    // Three medals hanging from a bar under the rack
    const MEDAL_Y = 1.3395;
    const metals = [0xd9a92e, 0xc9ced6, 0xa8672e];
    for (let k = 0; k < 3; k++) {
      const x = CX + (k - 1) * 0.025;
      // The ribbon it hangs from, and the bar across its top
      ribbon(x, MEDAL_Y - 0.0125, 0.0135, 0.024, RIBBONS[(k * 4 + 1) % RIBBONS.length], ribbons);
      plate(0.015, 0.0028, 0.0022, x, MEDAL_Y - 0.0006, 0.0016, metals[0], medals);
      // The medal
      const s = front(x, MEDAL_Y - 0.035);
      const at = s ? s.p : new THREE.Vector3(x, MEDAL_Y - 0.035, -0.13);
      let m: THREE.BufferGeometry;
      if (k === 0) {
        m = new THREE.CylinderGeometry(0.0105, 0.0105, 0.0026, 20);
        m.rotateX(Math.PI / 2);
      } else {
        const sh = new THREE.Shape();
        const pts = k === 1 ? 10 : 8;
        for (let i = 0; i < pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          // A star; or a cross, its arms flaring out to their ends
          const r = k === 1 ? (i % 2 ? 0.0052 : 0.013) : i % 2 ? 0.0124 : 0.0068;
          const ang = k === 1 ? a : a + (i % 2 ? 0.28 : 0) - Math.PI / 8;
          if (i === 0) sh.moveTo(Math.sin(ang) * r, Math.cos(ang) * r);
          else sh.lineTo(Math.sin(ang) * r, Math.cos(ang) * r);
        }
        m = new THREE.ExtrudeGeometry(sh, { depth: 0.0024, bevelEnabled: false });
        m.translate(0, 0, -0.0012);
      }
      H.tinted(m, metals[k]);
      m.applyMatrix4(basis);
      m.translate(at.x + out.x * 0.0045, at.y + out.y * 0.0045, at.z + out.z * 0.0045);
      medals.push(m);
    }

    const result = {
      gold: H.skinnedLike(H.merged(gold), coat),
      ribbons: H.skinnedLike(H.mergedColoured(ribbons), coat),
      medals: H.skinnedLike(H.mergedColoured(medals), coat)
    };
    H.generalKitCache = result;
    return result;
  }

  /**
   * Out of the agents' suit and into the General's dress uniform: built
   * like a wardrobe (bulked) on longer collarbones, olive coat and
   * trousers, a khaki shirt and an olive tie, gold buttons, black leather
   * gloves, the sunglasses made aviators with gold frames, no earpiece, a
   * peaked cap, gold epaulettes and a chest of ribbons and medals. His hair
   * — what shows of it under the cap — is the grey buzz cut from his look.
   */
  private dressGeneral(): void {
    const H = HitmanVisual;
    this.bulk = true;
    this.broadenShoulders(H.GENERAL_SHOULDERS);
    const mats = H.generalMats();
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.Material).name;
      if (mat === 'HM_Wire') {
        m.visible = false;
      } else if (m.name === 'HitmanBody_1') {
        m.geometry = H.outfitGeo('general:suit', () => H.generalSuit(m.geometry));
        m.material = [mats.coat, mats.trousers];
      } else if (mat === 'HM_Shirt') {
        m.geometry = H.outfitGeo('general:shirt', () => H.generalShirt(m.geometry));
        m.material = mats.shirt;
      } else if (mat === 'HM_Tie') {
        m.geometry = H.outfitGeo('general:tie', () => H.generalTie(m.geometry));
        m.material = [mats.tie, mats.gold];
      } else if (mat === 'HM_Glove') {
        m.geometry = H.outfitGeo('general:glove', () => H.bulked(m.geometry, false));
        m.material = mats.glove;
      } else if (mat === 'HM_Skin') {
        m.geometry = H.outfitGeo(`general:${m.name}`, () => H.bulked(m.geometry, true));
      } else if (mat === 'HM_Lens' || mat === 'HM_Metal') {
        m.geometry = H.outfitGeo(`general:${m.name}`, () => H.aviators(m.geometry));
        m.material = mat === 'HM_Lens' ? mats.lens : mats.frame;
      }
    });
    this.hang(this.generalCap(), 'Head');

    // What is sewn on the coat, skinned like it
    const body = this.model.getObjectByName('HitmanBody_1') as THREE.SkinnedMesh;
    const kit = H.generalKit(body.geometry);
    const sewn: [THREE.BufferGeometry, THREE.Material, string][] = [
      [kit.gold, mats.gold, 'HitmanBrass'],
      [kit.ribbons, mats.ribbons, 'HitmanRibbons'],
      [kit.medals, mats.medals, 'HitmanMedals']
    ];
    for (const [geo, mat, name] of sewn) {
      const sk = new THREE.SkinnedMesh(geo, mat);
      sk.name = name;
      body.parent!.add(sk);
      sk.position.copy(body.position);
      sk.quaternion.copy(body.quaternion);
      sk.scale.copy(body.scale);
      sk.bind(body.skeleton, body.bindMatrix);
      sk.boundingSphere = this.cull;
    }
  }

  // ------------------------------------------------------- airport security

  /** How far down the arm from the shoulder joint the short sleeves end, metres (the upper arm is 0.29). */
  private static readonly SLEEVE_END = 0.19;

  /**
   * For a vertex of the bind pose mostly carried by an arm: how far down it
   * from the shoulder joint it lies (metres, along the bones) and the nearest
   * point on them. Null for anything not on an arm.
   */
  private static onArm(g: THREE.BufferGeometry, v: number, p: THREE.Vector3): { s: number; axis: THREE.Vector3 } | null {
    const H = HitmanVisual;
    const sd = p.x < 0 ? 'L' : 'R';
    if (H.weightOn(g, v, H.armBones(sd)) < 0.5) return null;
    const a = H.rest.get(`UpperArm_${sd}`)!.modelP;
    const b = H.rest.get(`LowerArm_${sd}`)!.modelP;
    const c = H.rest.get(`Hand_${sd}`)!.modelP;
    const ab = b.clone().sub(a);
    const t1 = p.clone().sub(a).dot(ab) / ab.lengthSq();
    if (t1 <= 1) {
      const t = Math.max(0, t1);
      return { s: t * ab.length(), axis: a.clone().addScaledVector(ab, t) };
    }
    const bc = c.clone().sub(b);
    const t2 = Math.min(1.2, p.clone().sub(b).dot(bc) / bc.lengthSq());
    return { s: ab.length() + t2 * bc.length(), axis: b.clone().addScaledVector(bc, t2) };
  }

  /**
   * The suit as the security team's uniform: the staff's plain shirt out of
   * the jacket (the V closed up), and from a little above the elbow down the
   * sleeve given vertices of its own drawn in toward the bones — a bare arm
   * is slimmer than the sleeve it was — to be skin. The bare arm starts a
   * few centimetres up inside the sleeve; the sleeve itself is cut off
   * cleanly at SLEEVE_END by its material (see securityShirtMat), off the
   * `armS` attribute: each vertex's distance down the arm, 0 off it.
   * Material 0 is the shirt, 1 the trousers, 2 the bare arms.
   */
  private static securitySuit(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const H = HitmanVisual;
    const { shirt, trousers } = H.suitParts(src);
    const base = H.reindexed(src, [shirt, trousers]);
    H.reshaped(base, shirt, 0);
    const pos = base.attributes.position;
    const p = new THREE.Vector3();
    const place = new Map<number, { s: number; axis: THREE.Vector3 } | null>();
    const at = (v: number): { s: number; axis: THREE.Vector3 } | null => {
      if (!place.has(v)) place.set(v, H.onArm(base, v, p.fromBufferAttribute(pos, v)));
      return place.get(v)!;
    };
    // The sleeve keeps every triangle it has a fragment of; the arm takes them from just inside it down
    const sleeve: number[] = [];
    const arm: number[] = [];
    for (let i = 0; i < shirt.length; i += 3) {
      const tri = [shirt[i], shirt[i + 1], shirt[i + 2]];
      const pl = tri.map(at);
      const onArm = pl.every((q) => q !== null);
      const s = pl.map((q) => (q ? q.s : 0));
      if (!onArm || Math.min(...s) < H.SLEEVE_END) sleeve.push(...tri);
      if (onArm && (s[0] + s[1] + s[2]) / 3 > H.SLEEVE_END - 0.05) arm.push(...tri);
    }
    const order: number[] = [];
    const remap = new Map<number, number>();
    for (const v of arm) {
      if (!remap.has(v)) {
        remap.set(v, pos.count + order.length);
        order.push(v);
      }
    }
    const out = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(base.attributes)) {
      const a = attr as THREE.BufferAttribute;
      const n = a.itemSize;
      const Arr = a.array.constructor as new (len: number) => THREE.TypedArray;
      const na = new THREE.BufferAttribute(new Arr((a.count + order.length) * n), n, a.normalized);
      for (let v = 0; v < a.count; v++) for (let k = 0; k < n; k++) na.setComponent(v, k, a.getComponent(v, k));
      order.forEach((v, j) => {
        for (let k = 0; k < n; k++) na.setComponent(a.count + j, k, a.getComponent(v, k));
      });
      out.setAttribute(name, na);
    }
    // In toward the bones, less so at the wrist where the hand has to fit into it
    const np = out.attributes.position as THREE.BufferAttribute;
    order.forEach((v, j) => {
      const q = at(v)!;
      p.fromBufferAttribute(pos, v);
      const k = 0.84 + 0.12 * H.smoothstep(0.49, 0.56, q.s);
      p.sub(q.axis).multiplyScalar(k).add(q.axis);
      np.setXYZ(pos.count + j, p.x, p.y, p.z);
    });
    const armS = new Float32Array(pos.count + order.length);
    for (let v = 0; v < pos.count; v++) armS[v] = at(v)?.s ?? 0;
    order.forEach((v, j) => (armS[pos.count + j] = at(v)!.s));
    out.setAttribute('armS', new THREE.BufferAttribute(armS, 1));
    const tris = [...sleeve, ...trousers, ...arm.map((v) => remap.get(v)!)];
    out.setIndex(tris);
    out.addGroup(0, sleeve.length, 0);
    out.addGroup(sleeve.length, trousers.length, 1);
    out.addGroup(sleeve.length + trousers.length, arm.length, 2);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }

  /** The model's shirt under the uniform: its collar and front, as the staff's, without the pocket square or the cuffs (the sleeves are short). */
  private static securityShirt(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const H = HitmanVisual;
    const { of, top, bottom } = H.pieces(src);
    const pos = src.attributes.position;
    const idx = src.index!.array;
    const p = new THREE.Vector3();
    const cuff = (v: number): boolean => {
      const q = H.onArm(src, v, p.fromBufferAttribute(pos, v));
      return q !== null && q.s > H.SLEEVE_END;
    };
    const keep: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const r = of[idx[i]];
      const square = bottom.get(r)! > 1.3 && top.get(r)! < 1.36;
      if (!square && !(cuff(idx[i]) && cuff(idx[i + 1]) && cuff(idx[i + 2]))) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    const g = H.reindexed(src, [keep]);
    g.clearGroups();
    H.reshaped(g, keep, 0.0015);
    return g;
  }

  /**
   * The shirt's material: pale blue, its sleeves ending at SLEEVE_END down
   * the arm — cut per fragment off the suit's `armS`, so the hem is a clean
   * line round the arm whatever the triangles under it. (The model's own
   * shirt mesh, the collar and front, has no `armS` and reads 0: uncut.)
   */
  private static securityShirtMat(): THREE.Material {
    return HitmanVisual.outfitMat('security:shirt', () => {
      const m = new THREE.MeshStandardMaterial({ name: 'HM_SecurityShirt', color: 0xa9c8e4, roughness: 0.86 });
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float armS;\nvarying float vArmS;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArmS = armS;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vArmS;')
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif (vArmS > ${HitmanVisual.SLEEVE_END.toFixed(3)}) discard;`);
      };
      m.customProgramCacheKey = () => 'hitman-security-shirt';
      return m;
    });
  }

  /**
   * A hi-vis vest out of the shirt it is worn over: the torso from the hips
   * to the shoulders, every vertex lifted 1.1 cm off the cloth along its
   * normal and skinned as the cloth is, so it rides every pose exactly as the
   * shirt does. The triangles are a generous cut; the vest's own outline —
   * the hem, the armholes, the V-neck and the straps over the shoulders — is
   * cut cleanly by its material (vestMat), off the bind pose.
   */
  private static vestFrom(suit: THREE.BufferGeometry): THREE.BufferGeometry {
    const H = HitmanVisual;
    const pos = suit.attributes.position;
    const nor = suit.attributes.normal;
    const idx = suit.index!.array;
    const shirtCount = suit.groups[0].count;
    const ARMS = [...H.armBones('L'), ...H.armBones('R')];
    const p = new THREE.Vector3();
    const ok = new Map<number, boolean>();
    const inVest = (v: number): boolean => {
      let r = ok.get(v);
      if (r === undefined) {
        p.fromBufferAttribute(pos, v);
        r = H.weightOn(suit, v, ARMS) < 0.6 && p.y > 0.92 && p.y < 1.5 && Math.abs(p.x) < 0.2;
        ok.set(v, r);
      }
      return r;
    };
    const tris: number[] = [];
    for (let i = 0; i < shirtCount; i += 3) if (inVest(idx[i]) || inVest(idx[i + 1]) || inVest(idx[i + 2])) tris.push(idx[i], idx[i + 1], idx[i + 2]);
    const order: number[] = [];
    const used = new Map<number, number>();
    const newIdx = tris.map((v) => {
      let k = used.get(v);
      if (k === undefined) {
        k = order.length;
        used.set(v, k);
        order.push(v);
      }
      return k;
    });
    const P = new Float32Array(order.length * 3);
    const N = new Float32Array(order.length * 3);
    const SI = new Uint16Array(order.length * 4);
    const SW = new Float32Array(order.length * 4);
    const si = suit.attributes.skinIndex;
    const sw = suit.attributes.skinWeight;
    order.forEach((v, k) => {
      const lift = 0.011;
      for (let c = 0; c < 3; c++) {
        P[k * 3 + c] = pos.getComponent(v, c) + nor.getComponent(v, c) * lift;
        N[k * 3 + c] = nor.getComponent(v, c);
      }
      for (let j = 0; j < 4; j++) {
        SI[k * 4 + j] = si.getComponent(v, j);
        SW[k * 4 + j] = sw.getComponent(v, j);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    g.setIndex(newIdx);
    g.computeBoundingSphere();
    return g;
  }

  /**
   * Fluorescent yellow, with two bands of silver reflective tape round the
   * body and a pair up over the shoulders. Its outline, in the bind pose
   * (y up, the front toward −Z): the hem at the hips; armholes cut higher
   * and narrower toward the shoulder; a V at the front down to 1.27 m that
   * becomes a slot 17 cm across at the neck, a scoop at the back — leaving a
   * strap over each shoulder.
   */
  private static vestMat(): THREE.Material {
    return HitmanVisual.outfitMat('security:vest', () => {
      const m = new THREE.MeshStandardMaterial({ name: 'HM_Vest', color: 0xd4ee1c, emissive: 0x2c3400, roughness: 0.82, side: THREE.DoubleSide });
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
          .replace(
            '#include <clipping_planes_fragment>',
            `#include <clipping_planes_fragment>
            {
              float ax = abs(vBind.x);
              float y = vBind.y;
              bool hem = y < 0.955 || y > 1.485;
              bool armhole = y > 1.2 && ax > 0.18 - 0.055 * smoothstep(1.2, 1.47, y);
              bool vee = vBind.z < 0.0 && y > 1.27 && ax < min((y - 1.27) / 1.4, 0.085);
              bool scoop = vBind.z >= 0.0 && ax < 0.085 && y > 1.40 + 4.0 * ax * ax;
              if (hem || armhole || vee || scoop) discard;
            }`
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            float ax = abs(vBind.x);
            bool round1 = vBind.y > 1.035 && vBind.y < 1.083;
            bool round2 = vBind.y > 1.14 && vBind.y < 1.188;
            bool brace = vBind.y > 1.188 && ax > 0.082 && ax < 0.122;
            if (round1 || round2 || brace) diffuseColor.rgb = vec3(0.56, 0.58, 0.6);`
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            if ((vBind.y > 1.035 && vBind.y < 1.083) || (vBind.y > 1.14 && vBind.y < 1.188) || (vBind.y > 1.188 && abs(vBind.x) > 0.082 && abs(vBind.x) < 0.122)) totalEmissiveRadiance = vec3(0.0);`
          );
      };
      m.customProgramCacheKey = () => 'hitman-vest';
      return m;
    });
  }

  /** SECURITY, black: lettering only, the vest showing round it. */
  private static securityTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = '#111214';
    g.font = 'bold 50px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SECURITY', 128, 34, 248);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  /**
   * The kit on him, built once off the cloth at rest: the epaulettes on the
   * shirt's shoulders, outboard of the vest's straps (navy boards with two
   * silver bars at the shoulder end, skinned as the cloth is), and what rides
   * the chest with the vest — the radio clipped on his left breast with its
   * aerial, a shoulder mic on the strap and the coiled lead between them, a
   * pass on his right breast, SECURITY across the back and small on the front.
   */
  private static securityKitCache: { boards: THREE.BufferGeometry; radio: THREE.BufferGeometry; patches: THREE.BufferGeometry } | null = null;

  private static securityKit(suit: THREE.BufferGeometry, vest: THREE.BufferGeometry): NonNullable<typeof HitmanVisual.securityKitCache> {
    const H = HitmanVisual;
    if (H.securityKitCache) return H.securityKitCache;
    const tris = (g: THREE.BufferGeometry, count: number, keep: (t: THREE.Triangle) => boolean): THREE.Triangle[] => {
      const pos = g.attributes.position;
      const idx = g.index!.array;
      const out: THREE.Triangle[] = [];
      for (let i = 0; i < count; i += 3) {
        const t = new THREE.Triangle(
          new THREE.Vector3().fromBufferAttribute(pos, idx[i]),
          new THREE.Vector3().fromBufferAttribute(pos, idx[i + 1]),
          new THREE.Vector3().fromBufferAttribute(pos, idx[i + 2])
        );
        if (keep(t)) out.push(t);
      }
      return out;
    };
    const cloth = tris(suit, suit.groups[0].count, (t) => t.a.y > 1.25 || t.b.y > 1.25 || t.c.y > 1.25);
    const shell = tris(vest, vest.index!.count, () => true);
    const ray = new THREE.Ray();
    const hit = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const cast = (on: THREE.Triangle[], o: THREE.Vector3, d: THREE.Vector3): { p: THREE.Vector3; n: THREE.Vector3 } | null => {
      ray.origin.copy(o);
      ray.direction.copy(d).normalize();
      let best: { p: THREE.Vector3; n: THREE.Vector3 } | null = null;
      let bestD = Infinity;
      for (const t of on) {
        if (!ray.intersectTriangle(t.a, t.b, t.c, false, hit)) continue;
        const dd = hit.distanceToSquared(ray.origin);
        if (dd < bestD) {
          bestD = dd;
          t.getNormal(nrm);
          if (nrm.dot(ray.direction) > 0) nrm.negate();
          best = { p: hit.clone(), n: nrm.clone() };
        }
      }
      return best;
    };
    const DOWN = new THREE.Vector3(0, -1, 0);
    const BACKWARD = new THREE.Vector3(0, 0, 1);
    const FORWARD = new THREE.Vector3(0, 0, -1);

    // ---- Epaulettes: a board along the top of each shoulder from the vest's strap out to the shoulder's point
    const boards: THREE.BufferGeometry[] = [];
    const bars: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      const X0 = 0.128;
      const X1 = 0.206;
      const HW = 0.024;
      const ZC = 0.004;
      const top = new Map<string, number>();
      const topAt = (x: number, z: number): number => {
        const key = `${x.toFixed(4)}:${z.toFixed(4)}`;
        let y = top.get(key);
        if (y === undefined) {
          y = cast(cloth, new THREE.Vector3(sx * x, 2, z), DOWN)?.p.y ?? 1.45;
          top.set(key, y);
        }
        return y;
      };
      const pt = (u: number, w: number, lift: number, o: THREE.Vector3): void => {
        const x = X0 + (X1 - X0) * u;
        // Pointed at the collar end
        const z = ZC + HW * w * (u < 0.2 ? Math.sqrt(Math.max(0, 1 - ((0.2 - u) / 0.2) ** 2)) : 1);
        o.set(sx * x, topAt(x, z) + 0.0024 + lift, z);
      };
      const T = 0.0045;
      boards.push(
        H.sheets((sheet) => {
          sheet(12, 4, (i, j, o) => pt(i / 12, -1 + (2 * j) / 4, T, o), sx < 0);
          sheet(12, 4, (i, j, o) => pt(i / 12, -1 + (2 * j) / 4, 0, o), sx > 0);
          sheet(12, 1, (i, j, o) => pt(i / 12, -1, T * (1 - j), o), sx > 0);
          sheet(12, 1, (i, j, o) => pt(i / 12, 1, T * (1 - j), o), sx < 0);
          sheet(4, 1, (i, j, o) => pt(1, -1 + (2 * i) / 4, T * (1 - j), o), sx < 0);
        })
      );
      // Two silver bars across it at the shoulder end, and a button at the collar end
      for (const u of [0.72, 0.86]) {
        const x = X0 + (X1 - X0) * u;
        const b = new THREE.BoxGeometry(0.008, 0.0022, 2 * HW * 0.82);
        b.translate(sx * x, topAt(x, ZC) + 0.0024 + T + 0.0011, ZC);
        bars.push(b);
      }
      const btn = new THREE.SphereGeometry(0.0052, 10, 6);
      btn.scale(1, 0.5, 1);
      const bx = X0 + (X1 - X0) * 0.12;
      btn.translate(sx * bx, topAt(bx, ZC) + 0.0024 + T + 0.0015, ZC);
      bars.push(btn);
    }

    // ---- The radio on his left breast (−X), clipped to the vest, the aerial up off its top corner
    const radio: THREE.BufferGeometry[] = [];
    const RX = -0.098;
    const RY = 1.315;
    const front = cast(shell, new THREE.Vector3(RX, RY, -1), BACKWARD);
    const at = front ? front.p : new THREE.Vector3(RX, RY, -0.13);
    const out = front ? front.n.clone() : new THREE.Vector3(0, 0, -1);
    const lean = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), out);
    const place = (g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry => {
      g.translate(x, y, z);
      g.applyQuaternion(lean);
      g.translate(at.x, at.y, at.z);
      return g;
    };
    radio.push(place(new THREE.BoxGeometry(0.056, 0.105, 0.03), 0, 0, -0.017));
    radio.push(place(new THREE.BoxGeometry(0.03, 0.022, 0.012), 0, 0.068, -0.004));
    radio.push(place(new THREE.CylinderGeometry(0.0055, 0.007, 0.085, 6), 0.016, 0.095, -0.017));
    radio.push(place(new THREE.CylinderGeometry(0.009, 0.009, 0.014, 8).rotateX(Math.PI / 2), -0.014, 0.06, -0.033));
    // The shoulder mic, on the strap just under the collarbone, and the lead to it
    const micAt = cast(shell, new THREE.Vector3(-0.108, 1.405, -1), BACKWARD);
    const mic = micAt ? micAt.p.clone().addScaledVector(micAt.n, 0.012) : new THREE.Vector3(-0.108, 1.405, -0.125);
    const mg = new THREE.BoxGeometry(0.034, 0.05, 0.022);
    if (micAt) mg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), micAt.n));
    mg.translate(mic.x, mic.y, mic.z);
    radio.push(mg);
    const radioTop = new THREE.Vector3(-0.012, 0.055, -0.03).applyQuaternion(lean).add(at);
    const curve = new THREE.CatmullRomCurve3([
      radioTop,
      radioTop.clone().add(new THREE.Vector3(-0.012, 0.03, -0.012)),
      mic.clone().add(new THREE.Vector3(-0.008, -0.04, -0.012)),
      mic.clone().add(new THREE.Vector3(0, -0.024, 0))
    ]);
    radio.push(new THREE.TubeGeometry(curve, 16, 0.0028, 5, false));

    // ---- His pass, on a clip on the right breast
    const passAt = cast(shell, new THREE.Vector3(0.1, 1.235, -1), BACKWARD);
    const pass: THREE.BufferGeometry[] = [];
    if (passAt) {
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), passAt.n);
      const card = new THREE.BoxGeometry(0.054, 0.084, 0.002).applyQuaternion(q);
      const c0 = passAt.p.clone().addScaledVector(passAt.n, 0.003);
      card.translate(c0.x, c0.y, c0.z);
      pass.push(card);
    }

    // ---- SECURITY across the back of the vest, and small over the right breast above the pass
    const patches: THREE.BufferGeometry[] = [];
    const back = cast(shell, new THREE.Vector3(0, 1.33, 1), FORWARD);
    if (back) {
      const g = new THREE.PlaneGeometry(0.27, 0.0675);
      g.translate(back.p.x, back.p.y, back.p.z + 0.004);
      patches.push(g);
    }
    const chest = cast(shell, new THREE.Vector3(0.112, 1.335, -1), BACKWARD);
    if (chest) {
      const g = new THREE.PlaneGeometry(0.1, 0.025);
      g.rotateY(Math.PI);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), chest.n));
      g.translate(chest.p.x + chest.n.x * 0.003, chest.p.y + chest.n.y * 0.003, chest.p.z + chest.n.z * 0.003);
      patches.push(g);
    }

    // One vertex-coloured draw each: the epaulettes (navy boards, silver bars), and the radio with the pass
    const result = {
      boards: H.skinnedLike(H.mergedColoured([...boards.map((g) => H.tinted(g, 0x161d2c)), ...bars.map((g) => H.tinted(g, 0xc9ced6))]), suit),
      radio: H.mergedColoured([...radio.map((g) => H.tinted(g, 0x18191c)), ...pass.map((g) => H.tinted(g, 0xe8ecef))]),
      patches: (() => {
        const g = mergeGeometries(patches.map((x) => x.toNonIndexed()), false) ?? new THREE.BufferGeometry();
        for (const x of patches) x.dispose();
        return g;
      })()
    };
    H.securityKitCache = result;
    return result;
  }

  /**
   * His cap, in its own frame (hung on his head at the other caps' place):
   * the peaked cap's band and flared crown in black, a glossy black visor,
   * a silver cord across the front of the band and a silver badge above it.
   */
  private securityCap(): THREE.Group {
    const H = HitmanVisual;
    const C = H.CAP;
    const black = H.outfitMat('security:cap', () => new THREE.MeshStandardMaterial({ name: 'HM_Cap', color: 0x15161a, roughness: 0.8, side: THREE.DoubleSide }));
    const visorMat = H.outfitMat('security:visor', () => new THREE.MeshStandardMaterial({ name: 'HM_Visor', color: 0x0a0a0c, roughness: 0.14, metalness: 0.35, side: THREE.DoubleSide }));
    const silver = H.outfitMat('security:silver', () => new THREE.MeshStandardMaterial({ name: 'HM_Silver', color: 0xc9ced6, roughness: 0.3, metalness: 0.55 }));
    const cap = new THREE.Group();
    cap.name = 'SecurityCap';
    // The band and the crown flaring out of it, one black shell
    const shell = new THREE.Mesh(
      H.outfitGeo('security:cap:shell', () => {
        const g = new THREE.CylinderGeometry(1, 1, 1, 44, 1, true);
        g.scale(C.rx, C.y1 - C.y0, C.rz);
        g.translate(0, (C.y0 + C.y1) / 2, 0);
        return H.merged([g, H.capCrown()]);
      }),
      black
    );
    const visor = new THREE.Mesh(H.outfitGeo('security:cap:visor', () => H.visorStrip(-0.05, 1, 0, 0.0045)), visorMat);
    const trim = new THREE.Mesh(
      H.outfitGeo('security:cap:silver', () => {
        const parts: THREE.BufferGeometry[] = [];
        const along = (y: number): THREE.BufferGeometry => {
          const pts: THREE.Vector3[] = [];
          for (let a = -1.22; a <= 1.2201; a += 0.122) pts.push(new THREE.Vector3(Math.sin(a) * (C.rx + 0.0028), y, -Math.cos(a) * (C.rz + 0.0028)));
          return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0019, 5, false);
        };
        parts.push(along(C.y0 + 0.01));
        for (const sx of [-1, 1]) {
          const b = new THREE.SphereGeometry(0.0048, 10, 6);
          b.scale(1, 1, 0.6);
          b.translate(Math.sin(sx * 1.27) * (C.rx + 0.002), C.y0 + 0.01, -Math.cos(1.27) * (C.rz + 0.002));
          parts.push(b);
        }
        // The badge: a shield, tipped forward with the flare of the crown
        const sh = new THREE.Shape();
        sh.moveTo(0, 0.016);
        sh.lineTo(0.012, 0.012);
        sh.lineTo(0.011, -0.002);
        sh.quadraticCurveTo(0.008, -0.012, 0, -0.017);
        sh.quadraticCurveTo(-0.008, -0.012, -0.011, -0.002);
        sh.lineTo(-0.012, 0.012);
        sh.closePath();
        const badge = new THREE.ExtrudeGeometry(sh, { depth: 0.0022, bevelEnabled: false, curveSegments: 4 });
        badge.translate(0, 0, -0.0026);
        badge.applyMatrix4(
          new THREE.Matrix4().compose(
            new THREE.Vector3(0, C.y1 + 0.017, -(C.rz + 0.47 * (0.122 - C.rz)) - 0.0024),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.62, 0, 0)),
            new THREE.Vector3(1, 1, 1)
          )
        );
        parts.push(badge);
        return H.merged(parts);
      }),
      silver
    );
    cap.add(shell, visor, trim);
    // Worn a little higher and further back than the General's, so the visor clears his eyes
    cap.position.set(0, 1.683, 0.006);
    cap.rotation.x = 0.06;
    return cap;
  }

  /**
   * Out of the agents' suit and into airport security's kit: a pale blue
   * short-sleeved shirt (the jacket made a shirt as the staff's is, the
   * sleeves cut short and bare forearms below them), navy trousers, bare
   * hands, no glasses or earpiece and eyes where they were, navy epaulettes,
   * a hi-vis vest with silver tape and SECURITY on it, a radio on his chest,
   * a black peaked cap.
   */
  private dressSecurity(look: HitmanLook): void {
    const H = HitmanVisual;
    const shirtMat = H.securityShirtMat();
    const trouserMat = H.outfitMat('security:trousers', () => new THREE.MeshStandardMaterial({ name: 'HM_Trousers', color: 0x1b2333, roughness: 0.88 }));
    const arm = H.handMat(look.skin);
    let suit: THREE.SkinnedMesh | null = null;
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.Material).name;
      if (mat === 'HM_Lens' || mat === 'HM_Metal' || mat === 'HM_Wire' || mat === 'HM_Tie') {
        m.visible = false;
      } else if (mat === 'HM_Glove') {
        m.material = arm;
      } else if (m.name === 'HitmanBody_1') {
        suit = m;
        m.geometry = H.outfitGeo('security:suit', () => H.securitySuit(m.geometry));
        m.material = [shirtMat, trouserMat, arm];
      } else if (mat === 'HM_Shirt') {
        m.geometry = H.outfitGeo('security:shirt', () => H.securityShirt(m.geometry));
        m.material = shirtMat;
      }
    });

    // Eyes, set into the face where the lenses were
    const white = H.outfitMat('eye:white', () => new THREE.MeshStandardMaterial({ name: 'HM_EyeWhite', color: 0xf0ece4, roughness: 0.35 }));
    const iris = H.outfitMat('eye:iris', () => new THREE.MeshStandardMaterial({ name: 'HM_Iris', color: 0x1f140d, roughness: 0.3 }));
    const ball = H.outfitGeo('eye:ball', () => new THREE.SphereGeometry(1, 14, 10));
    for (const sd of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(sd * 0.032, 1.6335, -0.0745);
      const w = new THREE.Mesh(ball, white);
      w.scale.set(0.0125, 0.0082, 0.0055);
      const pupil = new THREE.Mesh(ball, iris);
      pupil.scale.set(0.0052, 0.0056, 0.0022);
      pupil.position.set(0, 0, -0.0048);
      eye.add(w, pupil);
      this.hang(eye, 'Head');
      this.eyes.push(eye);
    }
    this.hang(this.securityCap(), 'Head');
    if (!suit) return;

    // What is worn over the shirt and sewn on it, skinned like it
    const body = suit as THREE.SkinnedMesh;
    const shirtMesh = this.model.getObjectByName('HitmanBody_2') as THREE.Mesh;
    const vestGeo = H.outfitGeo('security:vest', () => H.vestFrom(body.geometry));
    const kit = H.securityKit(body.geometry, vestGeo);
    // Vertex-coloured kit: the epaulettes' navy and silver, the radio's black and the pass's white
    const coloured = H.outfitMat('security:kit', () => new THREE.MeshStandardMaterial({ name: 'HM_Kit', color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.15 }));
    const skinned: [THREE.BufferGeometry, THREE.Material, string][] = [
      [vestGeo, H.vestMat(), 'HitmanVest'],
      [kit.boards, coloured, 'HitmanEpaulettes'],
      [
        H.outfitGeo('security:buttons', () => H.buttonsFor(body.geometry, shirtMesh.geometry)),
        H.outfitMat('staff:button', () => new THREE.MeshStandardMaterial({ name: 'HM_Button', color: 0x0d0d0f, roughness: 0.35 })),
        'HitmanButtons'
      ]
    ];
    for (const [geo, mat, name] of skinned) {
      const sk = new THREE.SkinnedMesh(geo, mat);
      sk.name = name;
      body.parent!.add(sk);
      sk.position.copy(body.position);
      sk.quaternion.copy(body.quaternion);
      sk.scale.copy(body.scale);
      sk.bind(body.skeleton, body.bindMatrix);
      sk.boundingSphere = this.cull;
    }
    // The radio, the pass and the lettering ride the chest with the vest
    const rigid: [THREE.BufferGeometry, THREE.Material][] = [
      [kit.radio, coloured],
      [kit.patches, H.outfitMat('security:patch', () => new THREE.MeshStandardMaterial({ name: 'HM_Patch', map: H.securityTexture(), alphaTest: 0.5, roughness: 0.8 }))]
    ];
    for (const [geo, mat] of rigid) {
      if (!geo.attributes.position) continue;
      this.hang(new THREE.Mesh(geo, mat), 'UpperChest');
    }
  }

  /** Stains soaked into the front of his shirt: centre x, y and half width, height, in the rest frame. */
  private stains = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  /**
   * Body armour over the suit — a plate carrier: front and back plates,
   * shoulder straps, a cummerbund round the sides and pouches across the
   * front, POLICE across the chest and the back — and a helmet over his
   * hair. Whoever wears it takes a good deal more stopping, and it has to
   * show from across a room.
   */
  addArmour(): void {
    const H = HitmanVisual;
    const kit = H.outfitMat('armour:kit', () => new THREE.MeshStandardMaterial({ name: 'HM_Armour', color: 0x262b33, roughness: 0.82 }));
    const vest = new THREE.Mesh(H.outfitGeo('armour:vest', () => H.vestGeometry()), kit);
    this.hang(vest, 'UpperChest');
    const patch = new THREE.Mesh(
      H.outfitGeo('armour:patch', () => H.patchGeometry()),
      H.outfitMat('armour:patch', () => new THREE.MeshStandardMaterial({ name: 'HM_Patch', map: H.policeTexture(), roughness: 0.75 }))
    );
    this.hang(patch, 'UpperChest');
    const helmet = new THREE.Mesh(
      H.outfitGeo('armour:helmet', () => H.helmetGeometry()),
      H.outfitMat('armour:helmet', () => new THREE.MeshStandardMaterial({ name: 'HM_Helmet', color: 0x1f2329, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide }))
    );
    this.hang(helmet, 'Head');
    // Under it, no hair to speak of
    this.model.traverse((o) => {
      if (o.name.startsWith('Hair_')) o.visible = false;
    });
  }

  /**
   * The coworkers' kit (staff only): a plate carrier cut from his own shirt
   * — the torso of it let out a little and skinned to the same bones, so it
   * bends as he sits and turns and never comes through him — with pouches
   * and a pair of grenades on the front riding it; and a helmet where the
   * cap was.
   */
  addCrewKit(): void {
    const H = HitmanVisual;
    const body = this.model.getObjectByName('HitmanBody_1') as THREE.SkinnedMesh | undefined;
    if (body?.isSkinnedMesh) {
      const vest = new THREE.SkinnedMesh(H.outfitGeo('crew:vest', () => H.crewVest(body.geometry)), H.crewVestMat());
      vest.name = 'HitmanCrewVest';
      body.parent!.add(vest);
      vest.position.copy(body.position);
      vest.quaternion.copy(body.quaternion);
      vest.scale.copy(body.scale);
      vest.bind(body.skeleton, body.bindMatrix);
      vest.boundingSphere = this.cull;
    }
    const helmet = new THREE.Mesh(
      H.outfitGeo('armour:helmet', () => H.helmetGeometry()),
      H.outfitMat('armour:helmet', () => new THREE.MeshStandardMaterial({ name: 'HM_Helmet', color: 0x1f2329, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide }))
    );
    this.hang(helmet, 'Head');
    this.model.traverse((o) => {
      if (o.name.startsWith('Hair_') || o.name === 'HitmanCap') o.visible = false;
    });
  }

  /** The crew's carrier: the shirt's torso let out 13 mm, its own weights; pouches and grenades on it, weighted like the cloth under them. */
  private static crewVest(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const names = HitmanVisual.boneNames;
    const ids = (list: string[]): Set<number> => new Set(list.map((n) => names.indexOf(n)).filter((i) => i >= 0));
    const torso = ids(['Hips', 'Spine', 'Chest', 'UpperChest', 'Shoulder_L', 'Shoulder_R']);
    const arm = ids(['UpperArm_L', 'UpperArm_R', 'LowerArm_L', 'LowerArm_R', 'Hand_L', 'Hand_R']);
    const pos = src.attributes.position;
    const nor = src.attributes.normal;
    const ski = src.attributes.skinIndex;
    const skw = src.attributes.skinWeight;
    const idx = src.index!.array;
    const g0 = src.groups[0] ?? { start: 0, count: idx.length };
    // Torso only: above the belt, below the collar, nothing the arms carry
    const keep = (v: number): boolean => {
      const y = pos.getY(v);
      if (y < 1.1 || y > 1.47) return false;
      let onArm = 0;
      let top = -1;
      let topW = 0;
      for (let k = 0; k < 4; k++) {
        const b = ski.getComponent(v, k);
        const w = skw.getComponent(v, k);
        if (arm.has(b)) onArm += w;
        if (w > topW) {
          topW = w;
          top = b;
        }
      }
      return onArm < 0.2 && torso.has(top);
    };
    const OFF = 0.013;
    const P: number[] = [];
    const N: number[] = [];
    const SI: number[] = [];
    const SW: number[] = [];
    const C: number[] = [];
    const WEB: number[] = [];
    const I: number[] = [];
    const cloth = new THREE.Color(0x353b2c);
    const map = new Map<number, number>();
    const vert = (v: number): number => {
      let j = map.get(v);
      if (j !== undefined) return j;
      j = P.length / 3;
      map.set(v, j);
      const nx = nor.getX(v);
      const ny = nor.getY(v);
      const nz = nor.getZ(v);
      P.push(pos.getX(v) + nx * OFF, pos.getY(v) + ny * OFF, pos.getZ(v) + nz * OFF);
      N.push(nx, ny, nz);
      for (let k = 0; k < 4; k++) {
        SI.push(ski.getComponent(v, k));
        SW.push(skw.getComponent(v, k));
      }
      C.push(cloth.r, cloth.g, cloth.b);
      WEB.push(1);
      return j;
    };
    for (let i = g0.start; i < g0.start + g0.count; i += 3) {
      const a = idx[i];
      const b = idx[i + 1];
      const c = idx[i + 2];
      if (keep(a) && keep(b) && keep(c)) I.push(vert(a), vert(b), vert(c));
    }
    // The front of the shell, to stand things on
    const tris: { t: THREE.Triangle; v: number[] }[] = [];
    for (let i = 0; i < I.length; i += 3) {
      const vs = [I[i], I[i + 1], I[i + 2]];
      const t = new THREE.Triangle(...(vs.map((v) => new THREE.Vector3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]));
      if (t.getNormal(new THREE.Vector3()).z < 0) tris.push({ t, v: vs });
    }
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
    const hit = new THREE.Vector3();
    const place = (geo: THREE.BufferGeometry, x: number, y: number, colour: number): void => {
      ray.origin.set(x, y, -1);
      let at: THREE.Vector3 | null = null;
      let normal = new THREE.Vector3(0, 0, -1);
      let near = 0;
      for (const { t, v } of tris) {
        if (ray.intersectTriangle(t.a, t.b, t.c, false, hit) && (!at || hit.z < at.z)) {
          at = hit.clone();
          normal = t.getNormal(new THREE.Vector3());
          near = v[0];
        }
      }
      if (!at) return;
      geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), normal));
      geo.translate(at.x, at.y, at.z);
      const g = geo.index ? geo.toNonIndexed() : geo;
      const gp = g.attributes.position;
      const gn = g.attributes.normal;
      const col = new THREE.Color(colour);
      const base = P.length / 3;
      for (let k = 0; k < gp.count; k++) {
        P.push(gp.getX(k), gp.getY(k), gp.getZ(k));
        N.push(gn.getX(k), gn.getY(k), gn.getZ(k));
        for (let q = 0; q < 4; q++) {
          SI.push(SI[near * 4 + q]);
          SW.push(SW[near * 4 + q]);
        }
        C.push(col.r, col.g, col.b);
        WEB.push(0);
        I.push(base + k);
      }
    };
    // Three magazine pouches across the bottom, a radio pouch up on the left, two grenades up on the right
    for (const px of [-0.085, 0, 0.085]) {
      const b = new THREE.BoxGeometry(0.07, 0.08, 0.034);
      b.translate(0, 0, -0.017);
      place(b, px, 1.17, 0x262a20);
    }
    const radio = new THREE.BoxGeometry(0.05, 0.09, 0.03);
    radio.translate(0, 0, -0.015);
    place(radio, -0.095, 1.35, 0x1c1f19);
    for (const gy of [1.36, 1.28]) {
      const egg = new THREE.SphereGeometry(0.026, 10, 8);
      egg.scale(1, 1.25, 1);
      egg.translate(0, 0, -0.024);
      place(egg, 0.1, gy, 0x5a6638);
    }
    const g =new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setAttribute('aWeb', new THREE.Float32BufferAttribute(WEB, 1));
    g.setIndex(I);
    g.computeBoundingSphere();
    return g;
  }

  /** The carrier's cloth: olive-black, with rows of webbing across the front and back. */
  private static crewVestMat(): THREE.Material {
    return HitmanVisual.outfitMat('crew:vest', () => {
      const m = new THREE.MeshStandardMaterial({ name: 'HM_CrewVest', vertexColors: true, roughness: 0.88 });
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aWeb;\nvarying float vWeb;\nvarying vec3 vBind;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeb = aWeb;\nvBind = position;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vWeb;\nvarying vec3 vBind;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            if (vWeb > 0.5 && vBind.y > 1.13 && vBind.y < 1.42 && abs(vBind.x) < 0.15) {
              if (fract((vBind.y - 1.13) / 0.03) < 0.3) diffuseColor.rgb *= 0.52;
            }`
          );
      };
      return m;
    });
  }

  /** The carrier, in the rest frame: plates front and back, straps, sides and pouches. */
  private static vestGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, tilt = 0): void => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (tilt) g.rotateX(tilt);
      g.translate(x, y, z);
      parts.push(g);
    };
    // Plates: the front leans back a touch with the chest
    box(0.31, 0.34, 0.036, 0, 1.275, -0.163, -0.07);
    box(0.33, 0.37, 0.036, 0, 1.29, 0.16);
    // Cummerbund, round the sides under the arms
    for (const sx of [-1, 1]) box(0.034, 0.15, 0.3, sx * 0.196, 1.17, -0.002);
    // Shoulder straps, front to back over the top
    for (const sx of [-1, 1]) box(0.062, 0.028, 0.33, sx * 0.1, 1.488, -0.003);
    // Magazine pouches across the bottom of the front
    for (const px of [-0.09, 0, 0.09]) box(0.074, 0.09, 0.042, px, 1.16, -0.2);
    const g = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    return g;
  }

  /** POLICE, across the chest and bigger across the back. */
  private static patchGeometry(): THREE.BufferGeometry {
    const front = new THREE.PlaneGeometry(0.2, 0.052);
    front.rotateY(Math.PI);
    front.rotateX(0.07);
    front.translate(0, 1.37, -0.184);
    const back = new THREE.PlaneGeometry(0.27, 0.07);
    back.translate(0, 1.36, 0.1785);
    const g = mergeGeometries([front, back], false)!;
    front.dispose();
    back.dispose();
    return g;
  }

  private static policeTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#20252c';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#f2f0e8';
    g.font = 'bold 50px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('POLICE', 128, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** A ballistic helmet: a shell a little bigger than his skull, tipped back so the front clears his eyes. */
  private static helmetGeometry(): THREE.BufferGeometry {
    const g = new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2 + 0.14);
    g.scale(0.112, 0.104, 0.124);
    g.rotateX(0.14);
    g.translate(0, 1.657, 0.006);
    return g;
  }

  private stainCount = 0;
  private stainColor = new THREE.Color();

  /**
   * Soak a stain into the front of his shirt, centred on (x, y) in the
   * model's rest frame and about w by h. It is painted into the cloth rather
   * than stuck on it, so it follows the curve of his chest and every fold
   * the pose puts in it. His shirt gets a material of its own for it.
   */
  addStain(x: number, y: number, w: number, h: number, color: THREE.Color): void {
    if (this.stainCount >= this.stains.length) return;
    this.stains[this.stainCount++].set(x, y, w / 2, h / 2);
    this.stainColor.copy(color);
    if (this.stainCount > 1) return;
    const uniforms = { uStains: { value: this.stains }, uStainColor: { value: this.stainColor } };
    const stained = (src: THREE.Material): THREE.Material => {
      const m = (src as THREE.MeshStandardMaterial).clone();
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, uniforms);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBind;\nuniform vec4 uStains[4];\nuniform vec3 uStainColor;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            float soak = 0.0;
            for (int i = 0; i < 4; i++) {
              vec4 r = uStains[i];
              if (r.z <= 0.0) continue;
              vec2 d = (vBind.xy - r.xy) / r.zw;
              float ragged = 0.1 * sin(vBind.x * 95.0 + vBind.y * 41.0) + 0.08 * sin(vBind.y * 137.0 - vBind.x * 53.0);
              soak = max(soak, 1.0 - smoothstep(0.82, 1.0, length(d) + ragged));
            }
            // The front of him only
            soak *= smoothstep(0.0, -0.03, vBind.z);
            diffuseColor.rgb = mix(diffuseColor.rgb, uStainColor, soak);`
          );
      };
      m.customProgramCacheKey = () => 'hitman-stain';
      return m;
    };
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (Array.isArray(m.material)) m.material = [stained(m.material[0]), m.material[1]];
      else if (m.name === 'HitmanBody_1' || m.name === 'HitmanBody_2') m.material = stained(m.material);
    });
  }

  // ------------------------------------------------------------- hitboxes

  private static boxMat = new THREE.MeshBasicMaterial({ visible: false });

  /**
   * Plain shapes hung on the bones: capsules for limbs, elliptical drums for
   * the body, an egg for the head. They follow every pose the model is put
   * in, alive or dead, and they are what the bullets are cast against.
   */
  private buildHitboxes(): void {
    // Where this copy's bones are at rest: the General's arms sit further out
    const P = (n: string) => this.restP(n);
    // And the General is a great deal more of a target: every shape is let
    // out to the size bulked() made him, so a round that is seen to hit him
    // does — through the coat over the pectorals, the deltoids, the forearms
    const big = this.bulk;
    const add = (bone: string, part: string, geo: THREE.BufferGeometry, at: THREE.Vector3, q?: THREE.Quaternion, scale?: THREE.Vector3) => {
      const m = new THREE.Mesh(geo, HitmanVisual.boxMat);
      m.visible = false;
      m.userData.part = part;
      m.position.copy(at);
      if (q) m.quaternion.copy(q);
      if (scale) m.scale.copy(scale);
      this.model.add(m);
      m.updateMatrixWorld(true);
      this.byName.get(bone)?.bone.attach(m);
      this.hitboxes.push(m);
    };
    const up = new THREE.Vector3(0, 1, 0);
    const capsule = (bone: string, part: string, a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const d = b.clone().sub(a);
      const len = Math.max(0.01, d.length() - 2 * r * 0.5);
      add(
        bone,
        part,
        new THREE.CapsuleGeometry(r, len, 3, 10),
        a.clone().add(b).multiplyScalar(0.5),
        new THREE.Quaternion().setFromUnitVectors(up, d.normalize())
      );
    };
    const drum = (bone: string, part: string, y0: number, y1: number, rx: number, rz: number, z = 0) =>
      add(
        bone,
        part,
        new THREE.CylinderGeometry(1, 1, y1 - y0, 14),
        new THREE.Vector3(0, (y0 + y1) / 2, z),
        undefined,
        new THREE.Vector3(rx, 1, rz)
      );

    // The model is still at rest, in its own frame
    this.model.updateMatrixWorld(true);
    // Head: chin to crown, ear to ear, nose to the back of the skull
    add(
      'Head',
      'head',
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.Vector3(0, 1.628, -0.004),
      undefined,
      big ? new THREE.Vector3(0.09, 0.126, 0.106) : new THREE.Vector3(0.082, 0.12, 0.1)
    );
    drum('Neck', 'torso', 1.43, 1.53, big ? 0.078 : 0.058, big ? 0.078 : 0.058, 0.009);
    // Body: jacket over the chest, the waist, the hips and the skirt of it
    if (big) {
      drum('UpperChest', 'torso', 1.28, 1.49, 0.262, 0.152, -0.006);
      drum('Chest', 'torso', 1.1, 1.28, 0.214, 0.136, -0.006);
      drum('Hips', 'torso', 0.84, 1.1, 0.194, 0.124, 0.004);
    } else {
      drum('UpperChest', 'torso', 1.28, 1.47, 0.214, 0.126, 0.002);
      drum('Chest', 'torso', 1.1, 1.28, 0.178, 0.114, 0.002);
      drum('Hips', 'torso', 0.84, 1.1, 0.182, 0.118, 0.004);
    }
    for (const sd of ['L', 'R']) {
      const sh = P(`UpperArm_${sd}`);
      const el = P(`LowerArm_${sd}`);
      const wr = P(`Hand_${sd}`);
      const kn = P(`Middle1_${sd}`);
      capsule(`UpperArm_${sd}`, 'arm', sh, el, big ? 0.08 : 0.054);
      capsule(`LowerArm_${sd}`, 'arm', el, wr, big ? 0.068 : 0.045);
      capsule(`Hand_${sd}`, 'arm', wr, kn.clone().sub(wr).multiplyScalar(1.7).add(wr), big ? 0.048 : 0.042);
      const hip = P(`UpperLeg_${sd}`);
      const knee = P(`LowerLeg_${sd}`);
      const ankle = P(`Foot_${sd}`);
      capsule(`UpperLeg_${sd}`, 'leg', hip, knee, big ? 0.114 : 0.088);
      capsule(`LowerLeg_${sd}`, 'leg', knee, ankle, big ? 0.078 : 0.066);
      // The shoe, heel to toe
      add(
        `Foot_${sd}`,
        'leg',
        new THREE.BoxGeometry(0.1, 0.1, 0.29),
        new THREE.Vector3(ankle.x, 0.05, -0.045)
      );
    }
  }

  // ------------------------------------------------------------ the pose

  private static _m = new THREE.Matrix4();
  private static _qRootInv = new THREE.Quaternion();
  private static _q = new THREE.Quaternion();
  private static _q2 = new THREE.Quaternion();
  private static _v = new THREE.Vector3();
  private static _v2 = new THREE.Vector3();
  private static _s = new THREE.Vector3();
  private static _drv: Record<string, THREE.Quaternion> = {
    pelvis: new THREE.Quaternion(),
    torso: new THREE.Quaternion(),
    head: new THREE.Quaternion(),
    armL: new THREE.Quaternion(),
    armR: new THREE.Quaternion(),
    foreL: new THREE.Quaternion(),
    foreR: new THREE.Quaternion(),
    legL: new THREE.Quaternion(),
    legR: new THREE.Quaternion(),
    shinL: new THREE.Quaternion(),
    shinR: new THREE.Quaternion(),
    spine: new THREE.Quaternion(),
    neck: new THREE.Quaternion()
  };
  private static _rootInv = new THREE.Matrix4();

  /** A rig node's rotation in the rig root's frame — alive or in a ragdoll container. */
  private static nodeQ(node: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
    node.updateWorldMatrix(true, false);
    node.matrixWorld.decompose(HitmanVisual._v, out, HitmanVisual._s);
    return out.premultiply(HitmanVisual._qRootInv);
  }

  /** Pose the model to the rig. Call after the Enemy has posed its rig for the frame. */
  sync(d: HitmanDrive): void {
    const H = HitmanVisual;
    // Everything is worked in the model's own frame. Alive that is the rig
    // root's; dead, the model is handed to the scene where it stood (the
    // ragdoll's parts are too), so the frame holds wherever the root goes.
    this.model.updateWorldMatrix(true, false);
    H._rootInv.copy(this.model.matrixWorld).invert();
    this.model.matrixWorld.decompose(H._v, H._qRootInv, H._s);
    H._qRootInv.invert();

    const drv = H._drv;
    const plant = THREE.MathUtils.clamp(d.plant ?? 0, 0, 1);
    H.nodeQ(d.pelvis, drv.pelvis);
    H.nodeQ(d.torso, drv.torso);
    H.nodeQ(d.head, drv.head);
    H.nodeQ(d.armL, drv.armL);
    H.nodeQ(d.armR, drv.armR);
    H.nodeQ(d.foreL, drv.foreL);
    H.nodeQ(d.foreR, drv.foreR);
    H.nodeQ(d.legL, drv.legL);
    H.nodeQ(d.legR, drv.legR);
    H.nodeQ(d.shinL, drv.shinL);
    H.nodeQ(d.shinR, drv.shinR);
    drv.spine.slerpQuaternions(drv.pelvis, drv.torso, 0.5);
    drv.neck.slerpQuaternions(drv.torso, drv.head, 0.5);

    // Forward kinematics down the model's own bones
    for (const j of this.joints) {
      const par = j.parent;
      if (j.drive === 'hips') {
        // Where the rig's pelvis carries the model's hips point
        j.q.copy(drv.pelvis).multiply(j.rest.modelQ);
        j.p
          .copy(j.rest.modelP)
          .sub(PELVIS_REST)
          .applyMatrix4(d.pelvis.matrixWorld)
          .applyMatrix4(H._rootInv);
        j.p.y -= KNEEL_DROP * d.kneel;
        continue;
      }
      if (j.drive === 'rest') {
        if (par) j.q.copy(par.q).multiply(j.rest.localQ);
        else j.q.copy(j.rest.modelQ);
        if (j.foot && plant > 0) this.flatFoot(j, plant);
      } else {
        j.q.copy(drv[j.drive]).multiply(j.rest.modelQ);
      }
      if (par) j.p.copy(j.rest.localP).applyQuaternion(par.q).add(par.p);
      else j.p.copy(j.rest.modelP);
    }

    // Planted, the soles go on the floor. The model's legs are not the
    // rig's length, so wherever the rig has squatted or spread its feet the
    // model's ankles come out a little high or low: all of him is moved up
    // or down by that — by the lower foot, so one lifted to stomp stays up
    if (plant > 0) {
      const ankle = H.rest.get('Foot_L')!.modelP.y;
      const low = Math.min(this.byName.get('Foot_L')!.p.y, this.byName.get('Foot_R')!.p.y);
      const dy = (ankle - low) * plant;
      if (Math.abs(dy) > 1e-6) for (const j of this.joints) if (j.parent) j.p.y += dy;
    }

    // A hand to his own face: where that is, now the head has been placed
    const hj = this.byName.get('Head')!;
    for (const g of [d.handL, d.handR]) {
      if (!g.onHead) continue;
      g.at
        .copy(g.onHead)
        .sub(hj.rest.modelP)
        .applyQuaternion(H._q.copy(hj.rest.modelQ).invert())
        .applyQuaternion(hj.q)
        .add(hj.p)
        .applyMatrix4(this.model.matrixWorld);
    }

    // Hands back onto whatever the rig's hands hold
    this.reach('L', d.handL, d.foreL, d.armL);
    this.reach('R', d.handR, d.foreR, d.armR);

    // Into the bones: each one's rotation relative to its parent's
    for (const j of this.joints) {
      const par = j.parent;
      if (par) {
        j.bone.quaternion.copy(par.q).invert().multiply(j.q);
        if (j.drive === 'hips') j.bone.position.copy(j.p).sub(par.p).applyQuaternion(H._q.copy(par.q).invert());
      } else {
        j.bone.quaternion.copy(j.q);
      }
    }

    this.curl(true, d.handL.curl);
    this.curl(false, d.handR.curl);
    this.cull.center.copy(this.byName.get('Hips')!.p);
  }

  /**
   * A foot flat on the floor, `k` of the way from where its shin has put it:
   * its rest pose, turned only about the vertical — by however far the leg
   * has turned it that way. A squat tips the shin a long way forward, and a
   * foot that went with it would be stood on its toes.
   */
  private flatFoot(j: Joint, k: number): void {
    const H = HitmanVisual;
    // The turn from rest, and of that only the part about the vertical
    const turn = H._q.copy(j.q).multiply(H._q2.copy(j.rest.modelQ).invert());
    const yaw = H._qh.set(0, turn.y, 0, turn.w);
    if (yaw.lengthSq() < 1e-8) yaw.identity();
    else yaw.normalize();
    j.q.slerp(yaw.multiply(j.rest.modelQ), k);
  }

  private curl(left: boolean, c: number): void {
    const k = THREE.MathUtils.clamp(c, 0, 1);
    if (Math.abs(k - (left ? this.curlL : this.curlR)) < 0.004) return;
    if (left) this.curlL = k;
    else this.curlR = k;
    for (const f of this.fingers) if (f.left === left) f.bone.quaternion.slerpQuaternions(f.relax, f.grip, k);
  }

  // --------------------------------------------------------------- reach

  private static _S = new THREE.Vector3();
  private static _E = new THREE.Vector3();
  private static _W = new THREE.Vector3();
  private static _pole = new THREE.Vector3();
  private static _dir = new THREE.Vector3();
  private static _a = new THREE.Vector3();
  private static _b = new THREE.Vector3();
  private static _c = new THREE.Vector3();
  private static _qh = new THREE.Quaternion();
  private static _qua = new THREE.Quaternion();
  private static _qfa = new THREE.Quaternion();
  private static _r = new THREE.Quaternion();
  private static _bRest = new THREE.Matrix4();
  private static _bGoal = new THREE.Matrix4();

  /**
   * Two-bone reach for one arm onto its goal, blended in by the goal's
   * weight. The elbow goes the way the rig's elbow points, the hand takes the
   * grip's orientation, and some of the wrist's twist is handed down the
   * forearm so the glove's cuff does not wring.
   */
  private reach(sd: 'L' | 'R', g: HandGoal, rigFore: THREE.Object3D, rigArm: THREE.Object3D): void {
    if (g.w <= 0.001) return;
    const H = HitmanVisual;
    const ua = this.byName.get(`UpperArm_${sd}`)!;
    const fa = this.byName.get(`LowerArm_${sd}`)!;
    const hd = this.byName.get(`Hand_${sd}`)!;
    const rest = H.handRest![sd];

    // The hand's orientation: from the grip, or the rig's own
    const qh = H._qh;
    if (g.thumb && g.palm) {
      const t = H._a.copy(g.thumb).applyQuaternion(H._qRootInv).normalize();
      const pa = H._b.copy(g.palm).applyQuaternion(H._qRootInv);
      pa.addScaledVector(t, -pa.dot(t)).normalize();
      const n = H._c.crossVectors(t, pa);
      H._bGoal.makeBasis(t, pa, n);
      const n0 = H._v.crossVectors(rest.thumb, rest.palm);
      H._bRest.makeBasis(rest.thumb, rest.palm, n0).transpose();
      qh.setFromRotationMatrix(H._bGoal.multiply(H._bRest)).multiply(hd.rest.modelQ);
    } else {
      qh.copy(hd.q);
    }

    // Where the wrist has to be for the fist to close on the point
    const target = H._W.copy(g.at).applyMatrix4(H._rootInv);
    const rot = H._q.copy(qh).multiply(H._q2.copy(hd.rest.modelQ).invert());
    target.sub(H._v2.copy(rest.grip).applyQuaternion(rot));

    const S = H._S.copy(ua.p);
    const lenA = fa.rest.localP.length();
    const lenB = hd.rest.localP.length();
    const dir = H._dir.copy(target).sub(S);
    const dist = THREE.MathUtils.clamp(dir.length(), Math.abs(lenA - lenB) + 1e-3, (lenA + lenB) * 0.999);
    dir.normalize();

    // Bend towards where the rig's elbow is, relative to its shoulder
    const pole = H._pole.setFromMatrixPosition(rigFore.matrixWorld).sub(H._c.setFromMatrixPosition(rigArm.matrixWorld));
    pole.applyQuaternion(H._qRootInv);
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-6) pole.set(sd === 'L' ? -0.4 : 0.4, -1, 0.3).addScaledVector(dir, -dir.y);
    pole.normalize();
    const cosA = THREE.MathUtils.clamp((lenA * lenA + dist * dist - lenB * lenB) / (2 * lenA * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const E = H._E.copy(S).addScaledVector(dir, lenA * cosA).addScaledVector(pole, lenA * sinA);
    const W = H._v.copy(S).addScaledVector(dir, dist);

    // Upper arm: turned from where it points onto the elbow
    const was = H._a.copy(fa.p).sub(S).normalize();
    H._r.setFromUnitVectors(was, H._b.copy(E).sub(S).normalize());
    const qua = H._qua.copy(H._r).multiply(ua.q);
    // Forearm: carried by that, then turned onto the wrist
    const qfa = H._qfa.copy(H._r).multiply(fa.q);
    const fdir = H._a.copy(hd.p).sub(fa.p).normalize().applyQuaternion(H._r);
    const want = H._b.copy(W).sub(E).normalize();
    qfa.premultiply(H._q.setFromUnitVectors(fdir, want));
    // Hand half the wrist's twist to the forearm
    const local = H._q2.copy(qfa).invert().multiply(qh).multiply(H._q.copy(hd.rest.localQ).invert());
    const axis = H._c.copy(want).applyQuaternion(H._q.copy(qfa).invert());
    const proj = local.x * axis.x + local.y * axis.y + local.z * axis.z;
    const twist = H._q.set(axis.x * proj, axis.y * proj, axis.z * proj, local.w);
    if (twist.lengthSq() > 1e-8) {
      twist.normalize();
      qfa.multiply(twist.slerp(NO_HAND_POSE, 0.45));
    }

    const w = THREE.MathUtils.clamp(g.w, 0, 1);
    ua.q.slerp(qua, w);
    fa.q.slerp(qfa, w);
    hd.q.slerp(qh, w);
    fa.p.copy(fa.rest.localP).applyQuaternion(ua.q).add(ua.p);
    hd.p.copy(hd.rest.localP).applyQuaternion(fa.q).add(fa.p);
  }
}
