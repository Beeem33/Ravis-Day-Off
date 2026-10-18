import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { AudioManager } from '../core/AudioManager';
import type { Collider } from '../environment/OfficeLevelBuilder';
import type { DeathHandler, FPSPlayer } from './FPSPlayer';
import { RaviRig, RaviVisual } from './RaviVisual';
import { droppedAK } from './AkModel';
import type { Gun } from './Arsenal';

/** What he can have in his hand when he goes down: the Arsenal's three. */
export type GunKind = Gun;

/** What the death camera must not end up behind. */
export interface CameraBlockers {
  colliders: Collider[];
  /** Level meshes (the shootables): walls and ceilings that are not colliders. Enemies and glass are skipped. */
  meshes: THREE.Object3D[];
}

export interface RaviRagdollOptions {
  scene: THREE.Scene;
  world: CANNON.World;
  player: FPSPlayer;
  audio: AudioManager;
  /** Asked at the moment he dies: which gun is in his hand, if any. */
  gunInHand: () => GunKind | null;
  /** Asked every frame by the death camera. */
  blockers: () => CameraBlockers;
}

// ------------------------------------------------------------------ tuning

/** Ragdoll parts hit the level and loose props (group 1), never each other — as Enemy's do. */
const GROUP_RAGDOLL = 2;
/** The dropped gun: hits the level (and the cars), not his body, so it can't be wedged in his hand. */
const GROUP_GUN = 4;
const MAX_SPEED = 9;
/** Where under the floor the parked copies wait (and are drawn by the warm-up). */
const PARK_Y = -60;
/** How long the camera takes to get from his eyes to the death shot. */
const CAM_BLEND = 1.25;
const CAM_UP = 2.5;
const CAM_BACK = 2.0;

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const I = new THREE.Quaternion();

type Side = 'l' | 'r';
type PartName =
  | 'pelvis'
  | 'chest'
  | 'head'
  | 'upperarm_l'
  | 'lowerarm_l'
  | 'upperarm_r'
  | 'lowerarm_r'
  | 'thigh_l'
  | 'calf_l'
  | 'thigh_r'
  | 'calf_r';

interface PartDef {
  name: PartName;
  parent: PartName | null;
  /** Model-space rest centre of the body. */
  center: THREE.Vector3;
  /** Model-space rest joint with the parent. */
  joint: THREE.Vector3 | null;
  mass: number;
  angularDamping: number;
  shapes: { shape: CANNON.Shape; offset: THREE.Vector3; q: THREE.Quaternion }[];
}

interface Part {
  def: PartDef;
  body: CANNON.Body;
}

/**
 * A cone-twist joint whose twist is measured on a vector of our choosing.
 *
 * cannon's ConeTwistConstraint takes the twist reference from tangents() of
 * each cone axis, which only agree when the two axes are the same vector.
 * Ravi's knees, elbows and hips have their cones centred on a part-bent
 * joint (so a knee folds forward a long way and backward not at all), and
 * there the two tangents come out unrelated — the twist limit would be
 * fighting the joint from the first frame. The twist reference here is the
 * joint's own bend axis instead, the same vector in both bodies at rest: a
 * bend about it leaves it alone, a twist or a sideways buckle turns it, so a
 * small limit makes the joint a hinge with a little give.
 */
class Joint extends CANNON.ConeTwistConstraint {
  private twA: CANNON.Vec3;
  private twB: CANNON.Vec3;
  constructor(
    a: CANNON.Body,
    b: CANNON.Body,
    opts: { pivotA: CANNON.Vec3; pivotB: CANNON.Vec3; axisA: CANNON.Vec3; axisB: CANNON.Vec3; angle: number; twistAngle: number },
    twist: CANNON.Vec3
  ) {
    super(a, b, { ...opts, maxForce: 1e4, collideConnected: false });
    this.twA = twist.clone();
    this.twB = twist.clone();
  }

  update(): void {
    super.update();
    this.bodyA.vectorToWorldFrame(this.twA, this.twistEquation.axisA);
    this.bodyB.vectorToWorldFrame(this.twB, this.twistEquation.axisB);
  }
}

const v3 = (v: THREE.Vector3): CANNON.Vec3 => new CANNON.Vec3(v.x, v.y, v.z);
const rest = (bone: string): THREE.Vector3 => RaviVisual.restBone(bone).modelP.clone();

/** Rotation about `axis` (need not be unit) by `rad`. */
function rot(axis: THREE.Vector3, rad: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), rad);
}

/** `d` turned `rad` toward +Z (negative: toward −Z), keeping it in the plane of d and Z. */
function toward(d: THREE.Vector3, rad: number): THREE.Vector3 {
  return d.clone().applyQuaternion(rot(new THREE.Vector3().crossVectors(d, Z), rad));
}

/** A box laid along a segment, `hx`/`hz` thick, as a shape entry about the body's centre. */
function segBox(a: THREE.Vector3, b: THREE.Vector3, hx: number, hz: number): PartDef['shapes'][number] {
  const d = b.clone().sub(a);
  const len = d.length();
  return {
    shape: new CANNON.Box(new CANNON.Vec3(hx, len / 2, hz)),
    offset: new THREE.Vector3(),
    q: new THREE.Quaternion().setFromUnitVectors(Y, d.normalize())
  };
}

// ------------------------------------------------------------------ gun props

let propMats: { steel: THREE.Material; polymer: THREE.Material; blued: THREE.Material; wood: THREE.Material } | null = null;
function mats(): NonNullable<typeof propMats> {
  propMats ??= {
    steel: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.6 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.75, metalness: 0.05 }),
    blued: new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.5, metalness: 0.6 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.8 })
  };
  return propMats;
}

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  return mesh;
}

/** A Glock-sized pistol, muzzle down −Z, grip under the back of the slide. */
function pistolProp(): THREE.Group {
  const { steel, polymer } = mats();
  const g = new THREE.Group();
  g.add(box(0.026, 0.03, 0.188, steel, 0, 0.034, -0.02)); // slide
  g.add(box(0.024, 0.02, 0.15, polymer, 0, 0.01, -0.03)); // frame and dust cover
  g.add(box(0.028, 0.105, 0.05, polymer, 0, -0.038, 0.045, -0.3)); // grip, raked back
  g.add(box(0.006, 0.018, 0.04, polymer, 0, -0.008, -0.002)); // trigger guard
  return g;
}

/** The pump gun, as Level 4 lays it across Sanjay's lap: muzzle down −Z. */
function shotgunProp(): THREE.Group {
  const { blued, wood } = mats();
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.62, 10), blued);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.052, -0.26);
  g.add(barrel);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.54, 8), blued);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.02, -0.24);
  g.add(tube);
  g.add(box(0.045, 0.072, 0.24, blued, 0, 0.05, 0.06)); // receiver
  g.add(box(0.05, 0.05, 0.17, wood, 0, 0.026, -0.2)); // pump
  g.add(box(0.042, 0.085, 0.3, wood, 0, 0.045, 0.32, -0.09)); // stock
  g.add(box(0.038, 0.05, 0.06, wood, 0, 0.018, 0.18)); // grip
  return g;
}

/** The agents' baked AK, muzzle down −Z (droppedAK lays it on its side; stand it back up). */
function rifleProp(): THREE.Group {
  const g = droppedAK();
  const gun = g.children[0];
  if (gun) {
    gun.rotation.set(0, 0, 0);
    gun.position.set(0, 0, 0);
  }
  return g;
}

const GUN_MASS: Record<GunKind, number> = { pistol: 0.9, shotgun: 3.2, rifle: 3.6 };

/**
 * RaviRagdoll — Ravi's own death, seen from outside him.
 *
 * Built once when the level starts and parked under the floor, hidden: a
 * whole-body RaviRig and a world copy of each gun he might be carrying. They
 * are in the scene from the start so CombatScene.warmUp() (which force-shows
 * everything hidden for its throwaway frame) compiles the full body's
 * shaders — hair, eyes, trousers, shoes, which the first-person arms never
 * draw — and the props', behind the loading fade.
 *
 * When he dies (FPSPlayer.kill → begin()) the rig is stood where he was,
 * facing his way, standing or crouched as he was, and eleven cannon bodies
 * are laid over its rest bones and jointed. They take his running speed and
 * a push away from whoever shot him, the knees buckle, and the joints and
 * the level do the rest; every frame the bodies' rotations are written back
 * into the rig's bones. The gun in his hand leaves it with a spin and
 * clatters off on its own. The camera comes up out of his head to look down
 * on him, keeping clear of the walls.
 */
export class RaviRagdoll implements DeathHandler {
  private rig: RaviRig | null = null;
  private defs: PartDef[] = [];
  private parts = new Map<PartName, Part>();
  private props = new Map<GunKind, { mesh: THREE.Group; half: THREE.Vector3; center: THREE.Vector3 }>();
  private gun: { mesh: THREE.Group; body: CANNON.Body } | null = null;

  private active = false;
  private settled = false;
  private time = 0;
  private thuds = 0;
  private lastClank = -1;
  private lastGunClank = -1;

  // ---- the camera
  private camFrom = new THREE.Vector3();
  private camFromQ = new THREE.Quaternion();
  private focus = new THREE.Vector3();
  /** Unit direction from the focus out to where the camera wants to be. */
  private camDir = new THREE.Vector3();
  private camDist = 0;
  private hidden = new Map<THREE.Object3D, number>();

  private static _v = new THREE.Vector3();
  private static _w = new THREE.Vector3();
  private static _q = new THREE.Quaternion();
  private static _p = new THREE.Quaternion();
  private static _m = new THREE.Matrix4();
  private static _ray = new THREE.Ray();
  private static _caster = new THREE.Raycaster();

  constructor(private o: RaviRagdollOptions) {
    RaviVisual.whenReady(() => this.build());
    for (const kind of ['pistol', 'shotgun', 'rifle'] as GunKind[]) this.buildProp(kind);
  }

  // ------------------------------------------------------------------ setup

  private build(): void {
    const rig = RaviVisual.rig('body');
    rig.root.position.set(0, PARK_Y, 0);
    rig.root.visible = false;
    this.o.scene.add(rig.root);
    this.rig = rig;
    this.defs = this.partDefs();
  }

  private buildProp(kind: GunKind): void {
    const mesh = kind === 'pistol' ? pistolProp() : kind === 'shotgun' ? shotgunProp() : rifleProp();
    mesh.position.set(0, PARK_Y, 0);
    mesh.visible = false;
    this.o.scene.add(mesh);
    // The physics box is the prop's own bounds, in its own frame
    mesh.updateMatrixWorld(true);
    const bb = new THREE.Box3();
    const inv = mesh.matrixWorld.clone().invert();
    mesh.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.computeBoundingBox();
      bb.union(m.geometry.boundingBox!.clone().applyMatrix4(RaviRagdoll._m.multiplyMatrices(inv, m.matrixWorld)));
    });
    if (bb.isEmpty()) bb.set(new THREE.Vector3(-0.02, -0.05, -0.2), new THREE.Vector3(0.02, 0.05, 0.2));
    const half = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.012, 0.012, 0.012));
    this.props.set(kind, { mesh, half, center: bb.getCenter(new THREE.Vector3()) });
  }

  /** The eleven bodies, in model space at rest, off the rig's own bones. */
  private partDefs(): PartDef[] {
    const defs: PartDef[] = [];
    const pelvisC = rest('pelvis').add(new THREE.Vector3(0, -0.02, 0));
    defs.push({
      name: 'pelvis',
      parent: null,
      center: pelvisC,
      joint: null,
      mass: 11,
      angularDamping: 0.2,
      shapes: [{ shape: new CANNON.Box(new CANNON.Vec3(0.155, 0.1, 0.11)), offset: new THREE.Vector3(), q: new THREE.Quaternion() }]
    });
    const s1 = rest('spine_01');
    const neck = rest('neck_01');
    defs.push({
      name: 'chest',
      parent: 'pelvis',
      center: s1.clone().lerp(neck, 0.5),
      joint: s1,
      mass: 22,
      angularDamping: 0.2,
      shapes: [{ shape: new CANNON.Box(new CANNON.Vec3(0.165, (neck.y - s1.y) / 2, 0.115)), offset: new THREE.Vector3(), q: new THREE.Quaternion() }]
    });
    defs.push({
      name: 'head',
      parent: 'chest',
      center: rest('head').add(new THREE.Vector3(0, 0.095, 0.015)),
      joint: neck,
      mass: 5,
      angularDamping: 0.25,
      shapes: [{ shape: new CANNON.Sphere(0.11), offset: new THREE.Vector3(), q: new THREE.Quaternion() }]
    });
    for (const sd of ['l', 'r'] as Side[]) {
      const ua = rest(`upperarm_${sd}`);
      const fa = rest(`lowerarm_${sd}`);
      const hd = rest(`hand_${sd}`);
      const tip = hd.clone().addScaledVector(RaviRig.dir(`hand_${sd}`), 0.15);
      defs.push({
        name: `upperarm_${sd}`,
        parent: 'chest',
        center: ua.clone().lerp(fa, 0.5),
        joint: ua,
        mass: 2.2,
        angularDamping: 0.25,
        shapes: [segBox(ua, fa, 0.05, 0.05)]
      });
      defs.push({
        name: `lowerarm_${sd}`,
        parent: `upperarm_${sd}`,
        center: fa.clone().lerp(tip, 0.5),
        joint: fa,
        mass: 1.7,
        angularDamping: 0.25,
        shapes: [segBox(fa, tip, 0.042, 0.045)]
      });
      const th = rest(`thigh_${sd}`);
      const ca = rest(`calf_${sd}`);
      const ft = rest(`foot_${sd}`);
      const ball = rest(`ball_${sd}`);
      defs.push({
        name: `thigh_${sd}`,
        parent: 'pelvis',
        center: th.clone().lerp(ca, 0.5),
        joint: th,
        mass: 8,
        angularDamping: 0.55,
        shapes: [segBox(th, ca, 0.075, 0.08)]
      });
      const calfC = ca.clone().lerp(ft, 0.5);
      // The foot rides the shin as a second box, sole on the floor at rest,
      // so he lies with his feet flat or on their sides rather than on points
      const footC = new THREE.Vector3((ft.x + ball.x) / 2, 0.045, (ft.z + ball.z) / 2 + 0.01);
      defs.push({
        name: `calf_${sd}`,
        parent: `thigh_${sd}`,
        center: calfC,
        joint: ca,
        mass: 4.5,
        angularDamping: 0.55,
        shapes: [
          segBox(ca, ft, 0.058, 0.062),
          { shape: new CANNON.Box(new CANNON.Vec3(0.045, 0.045, 0.125)), offset: footC.sub(calfC), q: new THREE.Quaternion() }
        ]
      });
    }
    return defs;
  }

  /** Joint limits, in each body's rest (model) frame. */
  private jointFor(def: PartDef, A: CANNON.Body, B: CANNON.Body, parent: PartDef): Joint {
    const J = def.joint!;
    const pivotA = v3(J.clone().sub(parent.center));
    const pivotB = v3(J.clone().sub(def.center));
    const name = def.name;
    const sd = name.slice(-1) as Side;
    let axisA: THREE.Vector3;
    let axisB: THREE.Vector3;
    let angle: number;
    let twistAngle: number;
    let twist: THREE.Vector3;
    if (name === 'chest') {
      // Folds forward at the waist further than it arches back
      axisB = Y.clone();
      axisA = toward(Y, 0.2);
      angle = 0.55;
      twistAngle = 0.35;
      twist = X.clone();
    } else if (name === 'head') {
      // Nods and rolls; turns about a quarter each way — no owl necks
      axisB = Y.clone();
      axisA = toward(Y, 0.15);
      angle = 0.7;
      twistAngle = 0.9;
      twist = X.clone();
    } else if (name.startsWith('upperarm')) {
      // Swings wide but not through the chest
      const d = RaviRig.dir(`upperarm_${sd}`);
      axisA = d.clone();
      axisB = d.clone();
      angle = 1.35;
      twistAngle = 1.1;
      twist = new THREE.Vector3().crossVectors(d, Z).normalize();
    } else if (name.startsWith('lowerarm')) {
      // An elbow: folds forward from straight, never back
      const up = rest(`lowerarm_${sd}`).sub(rest(`upperarm_${sd}`)).normalize();
      axisA = toward(up, 1.05);
      axisB = rest(`hand_${sd}`).sub(rest(`lowerarm_${sd}`)).normalize();
      angle = 1.1;
      twistAngle = 0.35;
      twist = new THREE.Vector3().crossVectors(up, Z).normalize();
    } else if (name.startsWith('thigh')) {
      // The hip lifts the knee a long way forward, only a little back
      const d = rest(`calf_${sd}`).sub(rest(`thigh_${sd}`)).normalize();
      axisA = toward(d, 0.55);
      axisB = d.clone();
      angle = 0.9;
      twistAngle = 0.4;
      twist = X.clone();
    } else {
      // A knee: from straight to well bent, backward not at all
      const t = rest(`calf_${sd}`).sub(rest(`thigh_${sd}`)).normalize();
      axisA = toward(t, -0.8);
      axisB = rest(`foot_${sd}`).sub(rest(`calf_${sd}`)).normalize();
      angle = 0.85;
      twistAngle = 0.2;
      twist = X.clone();
    }
    return new Joint(A, B, { pivotA, pivotB, axisA: v3(axisA), axisB: v3(axisB), angle, twistAngle }, v3(twist));
  }

  // ------------------------------------------------------------------ death

  begin(from: THREE.Vector3 | null): boolean {
    const rig = this.rig;
    if (!rig || this.active) return false;
    this.active = true;
    const { player, world } = this.o;

    // The camera is where his eyes were: the shot starts from there
    const cam = player.camera;
    cam.updateMatrixWorld(true);
    this.camFrom.copy(cam.position);
    this.camFromQ.copy(cam.quaternion);
    this.hideViewmodels();

    // ---- His pose at the moment of death, as model-space rotations from rest
    const D = new Map<PartName, THREE.Quaternion>();
    for (const d of this.defs) D.set(d.name, new THREE.Quaternion());
    if (player.crouching) {
      const lean = rot(X, 0.45);
      for (const n of ['chest', 'head', 'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r'] as PartName[]) D.get(n)!.copy(lean);
      for (const sd of ['l', 'r'] as Side[]) {
        const t = rest(`calf_${sd}`).sub(rest(`thigh_${sd}`));
        const hinge = new THREE.Vector3().crossVectors(t, Z);
        D.get(`thigh_${sd}`)!.copy(rot(hinge, 1.3));
        D.get(`calf_${sd}`)!.copy(rot(hinge, -0.25));
      }
    }

    // ---- Forward kinematics through the joints, model space: every joint
    // starts closed, so nothing snaps on the first step
    const pos = new Map<PartName, THREE.Vector3>();
    for (const d of this.defs) {
      if (!d.parent) {
        pos.set(d.name, d.center.clone());
        continue;
      }
      const pd = this.defs.find((x) => x.name === d.parent)!;
      const J = d.joint!.clone().sub(pd.center).applyQuaternion(D.get(pd.name)!).add(pos.get(pd.name)!);
      pos.set(d.name, d.center.clone().sub(d.joint!).applyQuaternion(D.get(d.name)!).add(J));
    }
    // Crouched, the feet came up off the floor and out in front: put them
    // back under him
    const shift = new THREE.Vector3();
    if (player.crouching) {
      let lift = 0;
      let fwd = 0;
      for (const sd of ['l', 'r'] as Side[]) {
        const cd = this.defs.find((x) => x.name === `calf_${sd}`)!;
        const ankle = rest(`foot_${sd}`).sub(cd.center).applyQuaternion(D.get(cd.name)!).add(pos.get(cd.name)!);
        lift += (ankle.y - rest(`foot_${sd}`).y) / 2;
        fwd += (ankle.z - rest(`foot_${sd}`).z) / 2;
      }
      shift.set(0, -lift, -fwd * 0.6);
    }
    shift.y += 0.015; // just clear of the floor

    // ---- Into the world: model +Z is the way he was facing
    const rootQ = new THREE.Quaternion().setFromAxisAngle(Y, player.yaw + Math.PI);
    const rootP = player.position.clone();
    const facing = player.forwardDir();
    const right = new THREE.Vector3(-facing.z, 0, facing.x);
    // Which way the round pushes him: away from the shooter, else backwards-ish
    const push = new THREE.Vector3();
    if (from) push.copy(player.position).sub(from).setY(0);
    if (push.lengthSq() < 1e-4) push.copy(facing).negate().applyAxisAngle(Y, (Math.random() - 0.5) * 1.2);
    push.normalize();
    const carry = player.velocity.clone();
    carry.y = THREE.MathUtils.clamp(carry.y, -6, 3);

    const r = () => Math.random() - 0.5;
    for (const d of this.defs) {
      const wp = pos.get(d.name)!.clone().add(shift).applyQuaternion(rootQ).add(rootP);
      const wq = rootQ.clone().multiply(D.get(d.name)!);
      const body = new CANNON.Body({
        mass: d.mass,
        position: v3(wp),
        linearDamping: 0.04,
        angularDamping: d.angularDamping,
        collisionFilterGroup: GROUP_RAGDOLL,
        collisionFilterMask: 1
      });
      for (const s of d.shapes) body.addShape(s.shape, v3(s.offset), new CANNON.Quaternion(s.q.x, s.q.y, s.q.z, s.q.w));
      body.quaternion.set(wq.x, wq.y, wq.z, wq.w);
      body.velocity.set(carry.x, carry.y, carry.z);
      body.angularVelocity.set(r() * 1.5, r() * 1.5, r() * 1.5);
      body.sleepSpeedLimit = 0.15;
      body.sleepTimeLimit = 0.6;
      world.addBody(body);
      this.parts.set(d.name, { def: d, body });
    }
    for (const d of this.defs) {
      if (!d.parent) continue;
      const pd = this.defs.find((x) => x.name === d.parent)!;
      world.addConstraint(this.jointFor(d, this.parts.get(pd.name)!.body, this.parts.get(d.name)!.body, pd));
    }

    // ---- The push. Modest: he is dropped, not thrown. The upper body goes
    // with the round, the hips sag and the knees go forward, so he folds
    // as he falls instead of toppling like a plank.
    const add = (n: PartName, v: THREE.Vector3) => {
      const b = this.parts.get(n)!.body;
      b.velocity.x += v.x;
      b.velocity.y += v.y;
      b.velocity.z += v.z;
    };
    const s = 0.8 + Math.random() * 0.4;
    add('head', push.clone().multiplyScalar(2.3 * s));
    add('chest', push.clone().multiplyScalar(1.6 * s).setY(0.15));
    add('pelvis', push.clone().multiplyScalar(0.4 * s).setY(-0.9));
    // One knee goes first, so he twists down onto a side
    const first: Side = Math.random() < 0.5 ? 'l' : 'r';
    for (const sd of ['l', 'r'] as Side[]) {
      const k = sd === first ? 1.1 : 0.6;
      add(`thigh_${sd}`, facing.clone().multiplyScalar(0.9 * k).setY(-0.4 * k));
      add(`calf_${sd}`, facing.clone().multiplyScalar(-0.2 * k));
    }
    for (const sd of ['l', 'r'] as Side[]) {
      add(`lowerarm_${sd}`, new THREE.Vector3(r() * 1.2, 0.3 + Math.random() * 0.6, r() * 1.2));
    }
    // A little roll toward the knee that went
    const roll = facing.clone().multiplyScalar((first === 'l' ? 1 : -1) * (0.8 + Math.random() * 0.8));
    const chest = this.parts.get('chest')!.body;
    chest.angularVelocity.x += roll.x;
    chest.angularVelocity.z += roll.z;

    // Thuds as he lands
    for (const n of ['pelvis', 'chest', 'head'] as PartName[]) {
      this.parts.get(n)!.body.addEventListener('collide', (e: { contact: CANNON.ContactEquation }) => this.onBodyContact(e));
    }

    rig.root.visible = true;
    this.sync();
    this.dropGun(push, right);

    // ---- Where the camera will look from: up and behind him, turned
    // toward whichever side of him has the most room
    this.focus.copy(this.torso(RaviRagdoll._v));
    this.camDir.copy(this.pickCameraDir(facing.clone().negate()));
    this.camDist = this.clearance(this.focus, this.camDir, this.camLen());
    this.time = 0;
    return true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    this.hideViewmodels();

    const awake = !this.settled || [...this.parts.values()].some((p) => p.body.sleepState !== CANNON.Body.SLEEPING);
    if (awake) {
      let speed = 0;
      for (const { body } of this.parts.values()) {
        // As Enemy: cap limb speed, or an arm can tunnel into a wall and jam
        const v = body.velocity.length();
        if (v > MAX_SPEED) body.velocity.scale(MAX_SPEED / v, body.velocity);
        speed += v + body.angularVelocity.length() * 0.5;
      }
      this.sync();
      if (!this.settled && ((this.time > 2.5 && speed < 0.35 * this.parts.size) || this.time > 8)) {
        this.settled = true;
        for (const { body } of this.parts.values()) body.sleep();
      }
    }
    if (this.gun) {
      const b = this.gun.body;
      this.gun.mesh.position.set(b.position.x, b.position.y, b.position.z);
      this.gun.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      if (b.position.y < -20) {
        this.o.world.removeBody(b);
        this.gun.mesh.visible = false;
        this.gun = null;
      }
    }
    this.updateCamera(dt);
  }

  // ------------------------------------------------------------------ the rig

  /** Bodies → bones. The rig's root rides the pelvis; every other bone takes its body's turn from rest. */
  private sync(): void {
    const rig = this.rig!;
    const { _q: q, _p: P, _v: v } = RaviRagdoll;
    const pelvis = this.parts.get('pelvis')!;
    const pb = pelvis.body;
    P.set(pb.quaternion.x, pb.quaternion.y, pb.quaternion.z, pb.quaternion.w);
    rig.root.quaternion.copy(P);
    v.copy(pelvis.def.center).applyQuaternion(P);
    rig.root.position.set(pb.position.x - v.x, pb.position.y - v.y, pb.position.z - v.z);
    const Pinv = P.clone().invert();
    const D = (n: PartName): THREE.Quaternion => {
      const b = this.parts.get(n)!.body.quaternion;
      return Pinv.clone().multiply(q.set(b.x, b.y, b.z, b.w));
    };
    const chest = D('chest');
    const head = D('head');
    rig.clear();
    // The chest box is three vertebrae: share its bend up them
    rig.abs('spine_01', I.clone().slerp(chest, 0.35));
    rig.abs('spine_02', I.clone().slerp(chest, 0.7));
    rig.abs('spine_03', chest);
    rig.abs('neck_01', chest.clone().slerp(head, 0.5));
    rig.abs('head', head);
    for (const sd of ['l', 'r'] as Side[]) {
      rig.abs(`upperarm_${sd}`, D(`upperarm_${sd}`));
      rig.abs(`lowerarm_${sd}`, D(`lowerarm_${sd}`));
      rig.abs(`thigh_${sd}`, D(`thigh_${sd}`));
      rig.abs(`calf_${sd}`, D(`calf_${sd}`));
    }
    rig.apply();
  }

  /** The chest body's centre, world. */
  private torso(out: THREE.Vector3): THREE.Vector3 {
    const c = this.parts.get('chest')!.body.position;
    const p = this.parts.get('pelvis')!.body.position;
    // A little toward the hips, so the whole of him is in frame
    return out.set(c.x * 0.7 + p.x * 0.3, c.y * 0.7 + p.y * 0.3, c.z * 0.7 + p.z * 0.3);
  }

  private onBodyContact(e: { contact: CANNON.ContactEquation }): void {
    if (this.thuds >= 3) return;
    const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (speed < 1.6) return;
    const now = this.o.world.time;
    if (now - this.lastClank < 0.18 && this.thuds > 0) return;
    this.thuds++;
    this.lastClank = now;
    this.o.audio.bodyThud(this.o.player.camera.position.distanceTo(this.focus));
  }

  // ------------------------------------------------------------------ the gun

  private dropGun(push: THREE.Vector3, right: THREE.Vector3): void {
    const kind = this.o.gunInHand();
    if (!kind) return;
    const prop = this.props.get(kind);
    if (!prop) return;
    const { player, world } = this.o;
    const cam = player.camera;
    // Where the viewmodel held it: low and right of his eye, pointing where he looked
    const at = new THREE.Vector3(0.2, -0.24, -0.42).applyMatrix4(cam.matrixWorld);
    const q = cam.quaternion.clone();
    // Not out the far side of a wall he was stood against
    if (this.inside(at)) at.copy(player.position).setY(player.position.y + player.eyeHeight * 0.7);

    const mesh = prop.mesh;
    mesh.visible = true;
    mesh.position.copy(at);
    mesh.quaternion.copy(q);
    const body = new CANNON.Body({
      mass: GUN_MASS[kind],
      position: v3(at),
      linearDamping: 0.1,
      angularDamping: 0.3,
      collisionFilterGroup: GROUP_GUN,
      collisionFilterMask: 1
    });
    body.addShape(new CANNON.Box(v3(prop.half)), v3(prop.center));
    body.quaternion.set(q.x, q.y, q.z, q.w);
    // Out of his hand, away from where the body is going, with a turn on it
    const side = Math.random() < 0.7 ? 1 : -1;
    const v = player.velocity
      .clone()
      .setY(0)
      .multiplyScalar(0.8)
      .addScaledVector(push, -(1.0 + Math.random() * 0.8))
      .addScaledVector(right, side * (0.5 + Math.random() * 0.6));
    v.y = 1.2 + Math.random() * 1.0;
    body.velocity.set(v.x, v.y, v.z);
    const r = () => Math.random() - 0.5;
    body.angularVelocity.set(r() * 9, r() * 6 + side * 3, r() * 9);
    body.sleepSpeedLimit = 0.12;
    body.addEventListener('collide', (e: { contact: CANNON.ContactEquation }) => {
      const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (speed < 0.9) return;
      const now = world.time;
      if (now - this.lastGunClank < 0.1) return;
      this.lastGunClank = now;
      if (speed > 2.2) this.o.audio.boltForward();
      else this.o.audio.magStrike();
    });
    world.addBody(body);
    this.gun = { mesh, body };
  }

  /** Is a point inside any solid collider? */
  private inside(p: THREE.Vector3): boolean {
    for (const c of this.o.blockers().colliders) {
      if (!c.disabled && !c.glass && c.box.containsPoint(p)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ the camera

  private camLen(): number {
    return Math.hypot(CAM_UP, CAM_BACK);
  }

  /**
   * Of eight headings round him, the one behind him unless another has a
   * good deal more room — in a corridor the shot goes along it, not into
   * the wall.
   */
  private pickCameraDir(behind: THREE.Vector3): THREE.Vector3 {
    const len = this.camLen();
    let best = new THREE.Vector3();
    let bestScore = -Infinity;
    for (let i = 0; i < 8; i++) {
      const turn = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 4);
      const h = behind.clone().applyAxisAngle(Y, turn);
      const dir = h.multiplyScalar(CAM_BACK).setY(CAM_UP).normalize();
      const room = this.clearance(this.focus, dir, len);
      const clear = Math.min(1, room / len);
      // And not pressed up against a wall, looking down it
      const gap = this.wallGap(RaviRagdoll._w.copy(this.focus).addScaledVector(dir, room));
      const score = clear - Math.abs(turn) * 0.06 - Math.max(0, 0.7 - gap) * 0.6;
      if (score > bestScore) {
        bestScore = score;
        best = dir;
      }
    }
    return best;
  }

  /** Sideways distance from `p` to the nearest wall-like collider at its height. */
  private wallGap(p: THREE.Vector3): number {
    let gap = Infinity;
    for (const c of this.o.blockers().colliders) {
      if (c.disabled || c.glass) continue;
      const b = c.box;
      if (p.y < b.min.y || p.y > b.max.y || b.containsPoint(this.focus)) continue;
      const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x);
      const dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
      gap = Math.min(gap, Math.hypot(dx, dz));
    }
    return gap;
  }

  /**
   * How far the camera can go from `from` along `dir` (unit) before a wall,
   * ceiling or anything else solid, less a margin so the near plane stays
   * out of it.
   */
  private clearance(from: THREE.Vector3, dir: THREE.Vector3, len: number): number {
    const margin = 0.28;
    let hit = len + margin;
    const ray = RaviRagdoll._ray.set(from, dir);
    const p = RaviRagdoll._w;
    const { colliders, meshes } = this.o.blockers();
    for (const c of colliders) {
      if (c.disabled || c.glass) continue;
      // A box he is lying in (a desk he has folded over) blocks nothing
      if (c.box.containsPoint(from)) continue;
      if (ray.intersectBox(c.box, p)) {
        const d = p.distanceTo(from);
        if (d < hit) hit = d;
      }
    }
    const rc = RaviRagdoll._caster;
    rc.set(from, dir);
    rc.near = 0;
    rc.far = hit;
    const hits = rc.intersectObjects(meshes, false);
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud.enemy || ud.glass) continue;
      if (h.distance < hit) hit = h.distance;
      break;
    }
    return Math.max(0.35, hit - margin);
  }

  private updateCamera(dt: number): void {
    const cam = this.o.player.camera;
    const len = this.camLen();
    // Follow the body, smoothly: the chest jerks about as he lands
    const t = this.torso(RaviRagdoll._v);
    this.focus.lerp(t, 1 - Math.exp(-dt * 7));
    const room = this.clearance(this.focus, this.camDir, len);
    // In at once (never see through a wall), back out gently
    if (room < this.camDist) this.camDist = room;
    else this.camDist += (room - this.camDist) * Math.min(1, dt * 2.5);
    const want = RaviRagdoll._w.copy(this.focus).addScaledVector(this.camDir, this.camDist);

    // Out of his head fast, settling gently into the shot; the view turns
    // down onto him a little behind the rise
    const u = Math.min(1, this.time / CAM_BLEND);
    const ep = 1 - Math.pow(1 - u, 3);
    const er = 1 - Math.pow(1 - u, 2);
    cam.position.lerpVectors(this.camFrom, want, ep);
    const look = RaviRagdoll._q.setFromRotationMatrix(RaviRagdoll._m.lookAt(cam.position, this.focus, Y));
    cam.quaternion.slerpQuaternions(this.camFromQ, look, er);
    cam.updateMatrixWorld();

    // The camera starts inside his head. Until it is clear, the head and
    // neck fold away to nothing — he is only ever seen from outside.
    const h = this.parts.get('head')!.body.position;
    const near = cam.position.distanceTo(RaviRagdoll._v.set(h.x, h.y, h.z)) < 0.55;
    this.rig!.bones.get('neck_01')!.scale.setScalar(near ? 1e-4 : 1);
  }

  /**
   * The first-person viewmodels ride the camera; from out here they'd hang
   * in mid-air. Their meshes go onto a layer the camera doesn't draw — the
   * viewmodels toggle their own `visible` every frame, so that would be
   * undone, and a light is never touched: the number of lights is in every
   * shader's program key (Level 4's torch stays lit, and stays on).
   */
  private hideViewmodels(): void {
    const cam = this.o.player.camera;
    cam.traverse((obj) => {
      if (obj === cam || (obj as THREE.Light).isLight || this.hidden.has(obj)) return;
      this.hidden.set(obj, obj.layers.mask);
      obj.layers.set(31);
    });
  }
}
