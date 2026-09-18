import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

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

export interface HitmanLook {
  /** A Hair_* mesh in the model, or null for a shaved head. */
  hair: string | null;
  hairColor: number;
  skin: number;
  tie: number;
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
      m.castShadow = false;
      m.receiveShadow = false;
      const src = m.material as THREE.MeshStandardMaterial;
      if (!HitmanVisual.shared.has(src.name)) HitmanVisual.shared.set(src.name, HitmanVisual.plain(src));
    });
    HitmanVisual.template = scene;
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
      m = new THREE.MeshStandardMaterial({ name: 'HM_Skin', color: tone, roughness: 0.55, vertexColors: true });
      HitmanVisual.skinMats.set(tone, m);
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
  static lookFor(index: number): HitmanLook {
    const i = Math.abs(Math.floor(index));
    const hair = STYLE_ORDER[(i * 5 + 3) % STYLE_ORDER.length];
    const tone = (i * 3 + 1) % SKIN_TONES.length;
    const colours = HAIR_FOR_SKIN[tone];
    return {
      hair,
      skin: SKIN_TONES[tone],
      hairColor: colours[(i * 7 + 2) % colours.length],
      tie: TIE_COLOURS[(i * 4 + 1) % TIE_COLOURS.length]
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

    this.buildHitboxes();
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
