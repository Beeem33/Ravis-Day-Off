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
  handL: HandGoal;
  handR: HandGoal;
}

/**
 * What he is wearing. The agents are the man as modelled: suit, gloves,
 * sunglasses, an earpiece. The call-centre staff are the same man in the
 * floor's uniform — white shirt, blue trousers, a navy cap, bare hands — and
 * the boss is him built heavy, bearded, in a red cap and a striped tie.
 */
export type Outfit = 'agent' | 'staff' | 'boss';

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
    if (outfit === 'staff') {
      // Only what fits under a cap
      return { hair: STAFF_STYLES[(i * 3 + 1) % STAFF_STYLES.length], skin: SKIN_TONES[tone], hairColor, tie: 0, outfit };
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
        p: new THREE.Vector3()
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

  /** Stains soaked into the front of his shirt: centre x, y and half width, height, in the rest frame. */
  private stains = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
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
    const R = HitmanVisual.rest;
    const P = (n: string) => R.get(n)!.modelP;
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
    add('Head', 'head', new THREE.SphereGeometry(1, 14, 10), new THREE.Vector3(0, 1.628, -0.004), undefined, new THREE.Vector3(0.082, 0.12, 0.1));
    drum('Neck', 'torso', 1.43, 1.53, 0.058, 0.058, 0.009);
    // Body: jacket over the chest, the waist, the hips and the skirt of it
    drum('UpperChest', 'torso', 1.28, 1.47, 0.214, 0.126, 0.002);
    drum('Chest', 'torso', 1.1, 1.28, 0.178, 0.114, 0.002);
    drum('Hips', 'torso', 0.84, 1.1, 0.182, 0.118, 0.004);
    for (const sd of ['L', 'R']) {
      const sh = P(`UpperArm_${sd}`);
      const el = P(`LowerArm_${sd}`);
      const wr = P(`Hand_${sd}`);
      const kn = P(`Middle1_${sd}`);
      capsule(`UpperArm_${sd}`, 'arm', sh, el, 0.054);
      capsule(`LowerArm_${sd}`, 'arm', el, wr, 0.045);
      capsule(`Hand_${sd}`, 'arm', wr, kn.clone().sub(wr).multiplyScalar(1.7).add(wr), 0.042);
      const hip = P(`UpperLeg_${sd}`);
      const knee = P(`LowerLeg_${sd}`);
      const ankle = P(`Foot_${sd}`);
      capsule(`UpperLeg_${sd}`, 'leg', hip, knee, 0.088);
      capsule(`LowerLeg_${sd}`, 'leg', knee, ankle, 0.066);
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
      } else {
        j.q.copy(drv[j.drive]).multiply(j.rest.modelQ);
      }
      if (par) j.p.copy(j.rest.localP).applyQuaternion(par.q).add(par.p);
      else j.p.copy(j.rest.modelP);
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
