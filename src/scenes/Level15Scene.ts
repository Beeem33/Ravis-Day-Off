import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level15Builder, type Level15Data, PAD, PODIUM, DAIS } from '../environment/Level15Builder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { FPSPlayer } from '../entities/FPSPlayer';
import { FPSHUD } from '../ui/FPSHUD';
import { smooth, clamp01, yawPitchTo, wrapAngle } from './cutscene';

/**
 * Level15Scene — the portal room.
 *
 *  1. Through the fire door, onto the floor; the passage behind him comes
 *     down. Up, and round: the room.
 *  2. The suit, in its alcove: E. He puts it on (in the dark: seals, clips,
 *     the helmet), then holds his arms up and looks it over.
 *  3. Up the steps onto the pad, to the pedestal: three buttons, one at a
 *     time. Each winds the machine up further.
 *  4. The third: it goes. The room shakes, sparks fly, cups and papers come
 *     off the desks, chairs go over, and it gets brighter and brighter until
 *     there's nothing but white. Then it stops. To be continued.
 */

type Phase = 'arrive' | 'play' | 'suit' | 'warp' | 'end';
type Side = 'l' | 'r';
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

// ================================================================ the suit's arms

/** A hand in camera space: wrist, the way the fingers point, the way the palm faces, how curled. */
interface HandKey {
  w: THREE.Vector3;
  f: THREE.Vector3;
  p: THREE.Vector3;
  curl: number;
  /** The index finger on its own (pointing, for a button). */
  index?: number;
}
const hk = (w: [number, number, number], f: [number, number, number], p: [number, number, number], curl: number, index?: number): HandKey => ({
  w: V(...w),
  f: V(...f).normalize(),
  p: V(...p).normalize(),
  curl,
  index
});

/** The orientation whose −Z is `f` and −Y is (the part of) `p` square to it. */
function frameQ(f: THREE.Vector3, p: THREE.Vector3): THREE.Quaternion {
  const z = f.clone().negate().normalize();
  const y = p.clone().negate();
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * Ravi's arms in the field suit, hung off the camera: white shell with a
 * deep clear-coat shine, chrome rings at the elbow and wrist and two round
 * the forearm, round gloves with jointed fingers. Each arm is a two-bone
 * reach from a shoulder just behind and below the camera to a wrist placed
 * in camera space.
 */
class SuitArms {
  readonly root = new THREE.Group();
  private arms: Record<Side, {
    upper: THREE.Mesh;
    fore: THREE.Mesh;
    elbow: THREE.Object3D;
    rings: THREE.Object3D[];
    glove: THREE.Group;
    fingers: THREE.Object3D[][];
    thumb: THREE.Object3D[];
  }>;
  private static readonly A = 0.33;
  private static readonly B = 0.32;

  constructor(camera: THREE.Camera, shell: THREE.Material, chrome: THREE.Material, dark: THREE.Material) {
    camera.add(this.root);
    const make = (side: Side): SuitArms['arms']['r'] => {
      const sx = side === 'r' ? 1 : -1;
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, SuitArms.A - 0.1, 6, 16), shell);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, SuitArms.B - 0.1, 6, 16), shell);
      const elbow = new THREE.Group();
      elbow.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), shell));
      const er = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.013, 8, 24), chrome);
      elbow.add(er);
      const rings: THREE.Object3D[] = [];
      for (const r of [0.066, 0.064, 0.07]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.011, 8, 24), chrome);
        rings.push(ring);
        this.root.add(ring);
      }
      this.root.add(upper, fore, elbow);
      // The glove: a round palm, a cuff, four fingers of three joints, a thumb of two
      const glove = new THREE.Group();
      this.root.add(glove);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 18, 12), shell);
      palm.scale.set(1.0, 0.5, 1.15);
      palm.position.z = -0.055;
      glove.add(palm);
      const knuckles = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.065, 4, 10), shell);
      knuckles.rotation.z = Math.PI / 2;
      knuckles.position.set(0, 0.004, -0.098);
      glove.add(knuckles);
      const cuffBand = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.012, 8, 20), dark);
      cuffBand.position.z = -0.005;
      glove.add(cuffBand);
      const fingers: THREE.Object3D[][] = [];
      [-0.032, -0.011, 0.011, 0.031].forEach((x, i) => {
        const segs: THREE.Object3D[] = [];
        let parent: THREE.Object3D = glove;
        const lens = [0.036 - i * 0.002, 0.026, 0.022];
        let z = -0.104;
        lens.forEach((len, k) => {
          const pivot = new THREE.Group();
          pivot.position.set(k === 0 ? x * sx : 0, k === 0 ? 0 : 0, k === 0 ? z : -lens[k - 1]);
          parent.add(pivot);
          const seg = new THREE.Mesh(new THREE.CapsuleGeometry(0.0115 - k * 0.0012, Math.max(0.002, len - 0.02), 4, 10), shell);
          seg.rotation.x = Math.PI / 2;
          seg.position.z = -len / 2;
          pivot.add(seg);
          segs.push(pivot);
          parent = pivot;
          z = 0;
        });
        fingers.push(segs);
      });
      // Thumb: out from the inside of the palm, angled forward
      const thumb: THREE.Object3D[] = [];
      const t0 = new THREE.Group();
      t0.position.set(-0.042 * sx, -0.006, -0.035);
      t0.rotation.y = 0.75 * sx;
      glove.add(t0);
      const ts0 = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.02, 4, 10), shell);
      ts0.rotation.x = Math.PI / 2;
      ts0.position.z = -0.02;
      t0.add(ts0);
      const t1 = new THREE.Group();
      t1.position.z = -0.04;
      t0.add(t1);
      const ts1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.012, 4, 10), shell);
      ts1.rotation.x = Math.PI / 2;
      ts1.position.z = -0.016;
      t1.add(ts1);
      thumb.push(t0, t1);
      return { upper, fore, elbow, rings, glove, fingers, thumb };
    };
    this.arms = { l: make('l'), r: make('r') };
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.frustumCulled = false;
        (o as THREE.Mesh).renderOrder = 4;
      }
    });
  }

  set visible(on: boolean) {
    this.root.visible = on;
  }

  /** Put one arm's hand at `k` (camera space). */
  pose(side: Side, k: HandKey): void {
    const a = this.arms[side];
    const sx = side === 'r' ? 1 : -1;
    const S = V(0.2 * sx, -0.34, 0.16);
    const W = k.w.clone();
    const A = SuitArms.A;
    const B = SuitArms.B;
    const d0 = W.clone().sub(S);
    const d = THREE.MathUtils.clamp(d0.length(), Math.abs(A - B) + 0.02, A + B - 0.004);
    const dir = d0.normalize();
    // Elbow out and down
    const pole = V(0.75 * sx, -1, 0.25);
    const perp = pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const x = (A * A - B * B + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, A * A - x * x));
    const E = S.clone().addScaledVector(dir, x).addScaledVector(perp, h);
    const Wc = S.clone().addScaledVector(dir, d);
    const Y = V(0, 1, 0);
    const segment = (m: THREE.Object3D, p0: THREE.Vector3, p1: THREE.Vector3): void => {
      m.position.copy(p0).lerp(p1, 0.5);
      m.quaternion.setFromUnitVectors(Y, p1.clone().sub(p0).normalize());
    };
    segment(a.upper, S, E);
    segment(a.fore, E, Wc);
    a.elbow.position.copy(E);
    a.elbow.quaternion.setFromUnitVectors(V(0, 0, 1), Wc.clone().sub(E).normalize());
    const fd = Wc.clone().sub(E).normalize();
    a.rings.forEach((r, i) => {
      r.position.copy(E).lerp(Wc, [0.4, 0.62, 0.93][i]);
      r.quaternion.setFromUnitVectors(V(0, 0, 1), fd);
    });
    a.glove.position.copy(Wc);
    a.glove.quaternion.copy(frameQ(k.f, k.p));
    // Fingers: curled toward the palm, a little more at each joint
    a.fingers.forEach((segs, i) => {
      const c = i === 0 && k.index !== undefined ? k.index : k.curl;
      segs.forEach((s, j) => (s.rotation.x = -c * [1.1, 1.3, 0.9][j]));
    });
    a.thumb[0].rotation.x = -k.curl * 0.5;
    a.thumb[1].rotation.x = -k.curl * 0.8;
  }
}

function mixKey(a: HandKey, b: HandKey, k: number): HandKey {
  const e = k * k * (3 - 2 * k);
  return {
    w: a.w.clone().lerp(b.w, e),
    f: a.f.clone().lerp(b.f, e).normalize(),
    p: a.p.clone().lerp(b.p, e).normalize(),
    curl: a.curl + (b.curl - a.curl) * e,
    index: a.index !== undefined || b.index !== undefined ? (a.index ?? a.curl) + ((b.index ?? b.curl) - (a.index ?? a.curl)) * e : undefined
  };
}

const REST_R = hk([0.26, -0.62, -0.25], [0, 0.4, -1], [0, -1, 0.3], 0.35);
const REST_L = hk([-0.26, -0.62, -0.25], [0, 0.4, -1], [0, -1, 0.3], 0.35);

/** Holding them up and looking them over: [time, right, left, how far he looks down]. */
const EXAMINE: [number, HandKey, HandKey, number][] = [
  [0.0, REST_R, REST_L, 0],
  // Up in front of him, the backs of the hands to his face
  [0.8, hk([0.15, -0.1, -0.42], [-0.25, 0.75, -0.6], [0, 0.1, -1], 0.15), hk([-0.15, -0.1, -0.42], [0.25, 0.75, -0.6], [0, 0.1, -1], 0.15), 0.12],
  // Turned over: palms to him
  [1.7, hk([0.14, -0.08, -0.4], [-0.2, 0.9, -0.3], [0.1, 0, 1], 0.1), hk([-0.14, -0.08, -0.4], [0.2, 0.9, -0.3], [-0.1, 0, 1], 0.1), 0.1],
  // Fists
  [2.2, hk([0.14, -0.09, -0.4], [-0.2, 0.9, -0.3], [0.1, 0, 1], 1.0), hk([-0.14, -0.09, -0.4], [0.2, 0.9, -0.3], [-0.1, 0, 1], 1.0), 0.1],
  // And open, wide
  [2.6, hk([0.15, -0.08, -0.41], [-0.25, 0.9, -0.3], [0.1, 0, 1], 0.0), hk([-0.15, -0.08, -0.41], [0.25, 0.9, -0.3], [-0.1, 0, 1], 0.0), 0.1],
  // The right forearm brought across to look along it; the left down
  [3.4, hk([0.04, -0.06, -0.37], [-0.95, 0.2, -0.25], [0, -0.6, 0.8], 0.3), hk([-0.2, -0.36, -0.4], [0.2, 0.3, -0.95], [0, -1, 0], 0.45), 0.2],
  // Rolled over: the inside of the wrist
  [4.1, hk([0.05, -0.05, -0.37], [-0.95, 0.2, -0.25], [0, 0.85, 0.5], 0.3), hk([-0.2, -0.36, -0.4], [0.2, 0.3, -0.95], [0, -1, 0], 0.45), 0.18],
  [4.5, hk([0.05, -0.05, -0.37], [-0.95, 0.2, -0.25], [0, 0.85, 0.5], 0.3), hk([-0.2, -0.36, -0.4], [0.2, 0.3, -0.95], [0, -1, 0], 0.45), 0.15],
  // Down
  [5.2, REST_R, REST_L, 0]
];

// ================================================================ scene

interface PropBody {
  mesh: THREE.Object3D;
  body: CANNON.Body;
  kind: Level15Data['props'][number]['kind'];
  landed: boolean;
}

export class Level15Scene extends CombatScene<Level15Data> {
  private hud!: FPSHUD;
  private phase: Phase = 'arrive';
  private phaseT = 0;
  private t = 0;
  private shake = 0;
  private suited = false;
  private arms!: SuitArms;
  /** Buttons pressed so far (0..3), and the press in progress. */
  private stage = 0;
  private pressT = -1;
  private pressI = 0;
  private denyT = 0;
  private bodies: PropBody[] = [];
  private hum: { setDistance(m: number): void; stop(): void } | null = null;
  private rumble: { set(k: number): void; stop(): void } | null = null;
  private klaxon: { set(k: number): void; stop(): void } | null = null;
  private exposure0 = 1.05;
  private warpT = 0;
  private sparkT = 0;
  private wave = 0;
  private ledT = 0;
  private screenI = 0;
  private ringSpeed = [0, 0, 0];
  private from = { yaw: 0, pitch: 0, pos: new THREE.Vector3() };

  private ui!: HTMLElement;
  private fadeEl!: HTMLElement;
  private whiteEl!: HTMLElement;
  private helmetEl!: HTMLElement;
  private letterbox!: HTMLElement;
  private card!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);

  constructor(ctx: GameContext) {
    super(ctx);
  }

  // ============================================================ lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x0a0e12);
    this.scene.fog = new THREE.FogExp2(0x10161b, 0.009);
    this.level = new Level15Builder().build();
    const L = this.level;
    this.scene.add(L.group);
    this.world = this.createPhysicsWorld(L.colliders);
    this.player = new FPSPlayer(L.start.pos.clone(), L.start.yaw, input, audio, bus);
    this.player.camera.far = 220;
    this.player.camera.updateProjectionMatrix();
    this.scene.add(this.player.camera);
    this.particles = new ParticleManager(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene, 2);
    this.decals = new BloodDecalSystem(this.scene);

    // Something for the polished suit to shine with
    const renderer = this.ctx.engine.renderer;
    this.exposure0 = renderer.toneMappingExposure;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const shell = new THREE.MeshPhysicalMaterial({ color: 0xf4f5f2, roughness: 0.16, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06, envMap: env, envMapIntensity: 0.9 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xeef2f5, roughness: 0.06, metalness: 1, envMap: env, envMapIntensity: 1.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.35, metalness: 0.6, envMap: env, envMapIntensity: 0.6 });
    for (const m of L.suitMats) {
      m.envMap = env;
      m.envMapIntensity = 1;
      m.needsUpdate = true;
    }
    this.arms = new SuitArms(this.player.camera, shell, chrome, dark);
    this.arms.visible = false;

    const hemi = new THREE.HemisphereLight(0x9ab2c4, 0x1a2026, 1.0);
    this.scene.add(hemi);

    // What the warp will knock about: each a body, asleep where it sits
    for (const pr of L.props) {
      const body = new CANNON.Body({
        mass: pr.mass,
        shape: new CANNON.Box(new CANNON.Vec3(pr.half.x, pr.half.y, pr.half.z)),
        linearDamping: pr.kind === 'paper' ? 0.85 : 0.05,
        angularDamping: pr.kind === 'paper' ? 0.6 : 0.2,
        allowSleep: true,
        sleepSpeedLimit: 0.15
      });
      body.position.set(pr.mesh.position.x, pr.mesh.position.y + 0.01, pr.mesh.position.z);
      body.quaternion.set(pr.mesh.quaternion.x, pr.mesh.quaternion.y, pr.mesh.quaternion.z, pr.mesh.quaternion.w);
      this.world.addBody(body);
      body.sleep();
      this.bodies.push({ mesh: pr.mesh, body, kind: pr.kind, landed: false });
    }

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, 0, this.player.maxHealth);
    this.hud.setCounter(null);
    this.buildUI();
    document.addEventListener('keydown', this.keyHandler);
    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      })
    );
    this.hum = audio.portalHum();
    this.rumble = audio.rumbleLoop();
    this.rumble.set(0);
    this.startArrive();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('keydown', this.keyHandler);
    this.hum?.stop();
    this.rumble?.stop();
    this.klaxon?.stop();
    this.ctx.engine.renderer.toneMappingExposure = this.exposure0;
    this.hud.destroy();
    this.flashPool.dispose();
    this.ui.remove();
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="l15-helmet" style="position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 1s;
        background:radial-gradient(ellipse 78% 72% at 50% 50%, rgba(0,0,0,0) 68%, rgba(170,205,225,0.10) 78%, rgba(30,40,48,0.55) 90%, rgba(4,6,8,0.92) 100%)">
        <div style="position:absolute;left:6%;top:4%;width:38%;height:30%;border-radius:50%;
          background:radial-gradient(ellipse at 40% 40%, rgba(255,255,255,0.07), rgba(255,255,255,0) 70%);transform:rotate(-18deg)"></div>
      </div>
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="l15-white" style="position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none"></div>
      <div class="intro-fade" style="opacity:1"></div>
      <div class="hq-card" style="position:absolute;inset:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;
        opacity:0;transition:opacity 1.6s;pointer-events:none;color:#e8e6df;letter-spacing:8px">
        <div style="font-size:13px;opacity:.6;letter-spacing:6px;margin-bottom:18px">LEVEL 15 — THE PORTAL ROOM</div>
        <div style="font-size:42px;font-weight:bold">TO BE CONTINUED</div>
      </div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.helmetEl = el.querySelector('.l15-helmet')!;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.whiteEl = el.querySelector('.l15-white')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
    this.card = el.querySelector('.hq-card')!;
  }

  private cinema(on: boolean): void {
    this.letterbox.classList.toggle('open', !on);
    if (on) this.hud.hide();
    else this.hud.show();
  }

  // ============================================================ 1. in

  private startArrive(): void {
    this.phase = 'arrive';
    this.phaseT = 0;
    this.player.cinematic = true;
    this.cinema(true);
    this.fadeEl.style.transition = 'opacity 0.6s';
    this.fadeEl.style.opacity = '0';
    this.ctx.audio.bodyThud(0);
    this.shake = 0.8;
  }

  /** On the floor, the passage coming down behind him; up, and round to the room. */
  private updateArrive(dt: number): void {
    const t = this.phaseT;
    const p = this.player;
    const L = this.level;
    // The rubble: down into its heap
    for (const pc of L.rubble.pieces) {
      const k = clamp01((t - 0.15 - pc.delay) / 0.42);
      if (k <= 0) continue;
      pc.mesh.position.lerpVectors(pc.from, pc.to, k * k);
      if (k < 1) pc.mesh.rotation.x += pc.spin.x * dt;
      if (k >= 1 && !pc.mesh.userData.down) {
        pc.mesh.userData.down = true;
        if (Math.random() < 0.15) this.particles.dust(pc.to.clone(), 0.6, 0.3);
      }
    }
    if (t >= 0.2 && t - dt < 0.2) {
      this.ctx.audio.wallCollapse();
      this.shake = 1.2;
    }
    if (t >= 0.75 && t - dt < 0.75) {
      this.particles.dust(L.rubble.at.clone(), 1.6, 0.9);
      this.ctx.audio.stomp(2);
    }
    // Lying on his back looking back at it; up; round
    const up = smooth((t - 1.3) / 1.0);
    const turn = smooth((t - 2.5) / 1.1);
    p.position.set(0, 0, 26.9);
    p.yaw = Math.PI + wrapAngle(0 - Math.PI) * turn;
    p.pitch = THREE.MathUtils.lerp(0.25, -0.02, up) + 0.12 * turn;
    p.update(dt, L.colliders);
    const cam = p.camera;
    cam.position.y = THREE.MathUtils.lerp(0.32, 1.62, up);
    cam.rotateZ(0.45 * (1 - up));
    if (t > 3.7) {
      this.phase = 'play';
      this.phaseT = 0;
      p.cinematic = false;
      p.yaw = 0;
      p.pitch = 0.12;
      this.cinema(false);
      this.ctx.input.requestPointerLock();
    }
  }

  // ============================================================ 2. the suit

  private suitPromptOn = false;

  private startSuit(): void {
    const p = this.player;
    this.phase = 'suit';
    this.phaseT = 0;
    p.cinematic = true;
    this.cinema(true);
    this.hud.setPrompt(null);
    this.from.pos.copy(p.position);
    this.from.yaw = p.yaw;
    this.from.pitch = p.pitch;
  }

  private updateSuit(dt: number): void {
    const t = this.phaseT;
    const p = this.player;
    const L = this.level;
    const audio = this.ctx.audio;
    // Up to it, looking it over
    const go = smooth(t / 0.7);
    p.position.lerpVectors(this.from.pos, L.suit.stand, go);
    const look = yawPitchTo(V(L.suit.stand.x, 1.62, L.suit.stand.z), L.suit.look);
    p.yaw = this.from.yaw + wrapAngle(look.yaw - this.from.yaw) * go;
    p.pitch = this.from.pitch + (look.pitch - this.from.pitch) * go;
    // Into the dark while he gets it on
    if (t >= 0.7 && t - dt < 0.7) {
      this.fadeEl.style.transition = 'opacity 0.45s';
      this.fadeEl.style.opacity = '1';
    }
    const at = (s: number): boolean => t >= s && t - dt < s;
    if (at(1.2)) {
      audio.velcro();
      L.suit.model.visible = false;
      L.suit.light.intensity = 3;
    }
    if (at(1.6)) audio.clink();
    if (at(2.0)) audio.velcro();
    if (at(2.4)) audio.pocket();
    if (at(2.85)) audio.helmetKnock();
    if (at(3.05)) audio.clink();
    if (at(3.1)) this.helmetEl.style.opacity = '1';
    if (at(3.3)) {
      this.fadeEl.style.transition = 'opacity 0.6s';
      this.fadeEl.style.opacity = '0';
      this.arms.visible = true;
      this.ctx.audio.inflate(0.5);
    }
    // Holding his arms up and looking the suit over
    const e = t - 3.4;
    let down = 0;
    if (e >= -0.2) {
      const tt = Math.max(0, e);
      let i = 0;
      while (i < EXAMINE.length - 2 && tt > EXAMINE[i + 1][0]) i++;
      const [t0, r0, l0, d0] = EXAMINE[i];
      const [t1, r1, l1, d1] = EXAMINE[i + 1];
      const k = clamp01((tt - t0) / (t1 - t0));
      this.arms.pose('r', mixKey(r0, r1, k));
      this.arms.pose('l', mixKey(l0, l1, k));
      down = d0 + (d1 - d0) * smooth(k);
    }
    p.update(dt, L.colliders);
    p.camera.rotateX(-down);
    if (e > EXAMINE[EXAMINE.length - 1][0] + 0.2) {
      this.arms.visible = false;
      this.suited = true;
      this.phase = 'play';
      this.phaseT = 0;
      p.cinematic = false;
      this.cinema(false);
    }
  }

  // ============================================================ 3. the buttons

  private padPromptOn = false;

  private updatePodium(dt: number): void {
    const p = this.player;
    const L = this.level;
    const pos = p.position;
    this.padPromptOn = false;
    this.suitPromptOn = false;
    if (this.phase !== 'play' || !p.alive) return;
    // The suit
    if (!this.suited && Math.hypot(pos.x - L.suit.stand.x, pos.z - L.suit.stand.z) < 1.9) {
      this.suitPromptOn = true;
      if (this.ctx.input.wasPressed('KeyE')) {
        this.startSuit();
        return;
      }
    }
    // The pedestal: stood on the pad in front of it
    const onPad = Math.hypot(pos.x, pos.z) < PAD.r + 0.2 && pos.y > DAIS.top - 0.1;
    const near = onPad && Math.hypot(pos.x - L.podium.front.x, pos.z - L.podium.front.z) < 0.85;
    if (near && this.pressT < 0 && this.stage < 3) {
      this.padPromptOn = true;
      if (this.ctx.input.wasPressed('KeyE')) {
        if (!this.suited) {
          this.denyT = 1.2;
          this.ctx.audio.uiBeep(false);
          this.ctx.audio.dryFire();
        } else {
          this.pressT = 0;
          this.pressI = this.stage;
          p.stunned = true;
        }
      }
    }
    // Pressing: the right glove out to the button, the index finger on it, in, and back
    if (this.pressT >= 0) {
      this.pressT += dt;
      const b = L.podium.buttons[this.pressI];
      const cam = p.camera;
      cam.updateMatrixWorld(true);
      const target = cam.worldToLocal(b.at.clone());
      const f = target.clone().sub(V(0.18, -0.25, 0)).normalize();
      const contact = target.clone().addScaledVector(f, -0.155);
      const before = contact.clone().addScaledVector(f, -0.07);
      const press = hk([0, 0, 0], [0, 0, -1], [0, -1, 0], 0.9, 0.05);
      const reach: HandKey = { ...press, w: before, f, p: V(0, -1, 0) };
      const push: HandKey = { ...press, w: contact.clone().addScaledVector(f, 0.02), f, p: V(0, -1, 0) };
      const t = this.pressT;
      let key: HandKey;
      if (t < 0.32) key = mixKey(REST_R, reach, t / 0.32);
      else if (t < 0.42) key = mixKey(reach, push, (t - 0.32) / 0.1);
      else if (t < 0.55) key = mixKey(push, reach, (t - 0.42) / 0.13);
      else key = mixKey(reach, REST_R, Math.min(1, (t - 0.55) / 0.3));
      this.arms.visible = true;
      this.arms.pose('r', key);
      this.arms.pose('l', REST_L);
      b.cap.position.y = b.rest - 0.018 * smooth((t - 0.34) / 0.06) * (1 - smooth((t - 0.5) / 0.1));
      if (t >= 0.4 && t - dt < 0.4) this.pressed(this.pressI);
      if (t > 0.9) {
        this.pressT = -1;
        this.arms.visible = false;
        if (this.stage < 3) p.stunned = false;
        else this.startWarp();
      }
    }
    // The buttons' lights: the next one blinking, the pressed ones lit
    L.podium.buttons.forEach((b, i) => {
      b.mat.emissiveIntensity = i < this.stage ? 2.4 : i === this.stage && this.suited ? 0.8 + 0.8 * Math.max(0, Math.sin(this.t * 6)) : 0.15;
    });
    this.denyT = Math.max(0, this.denyT - dt);
  }

  /** A button down: the machine winds up a stage. */
  private pressed(i: number): void {
    const audio = this.ctx.audio;
    audio.breakerThrow();
    audio.uiBeep(true);
    this.stage = i + 1;
    this.shake = Math.max(this.shake, 0.25 + i * 0.15);
    if (this.stage === 1) audio.powerUp();
    if (this.stage === 2) {
      audio.powerUp();
      this.rumble?.set(0.25);
      this.klaxon = audio.klaxonLoop();
      this.klaxon.set(0.18);
    }
  }

  // ============================================================ 4. the warp

  private startWarp(): void {
    this.phase = 'warp';
    this.phaseT = 0;
    this.warpT = 0;
    this.player.stunned = true;
    this.hud.setPrompt(null);
    this.hud.hide();
    this.klaxon?.set(0.45);
    this.ctx.audio.powerUp();
  }

  private updateWarp(dt: number): void {
    const t = (this.warpT += dt);
    const L = this.level;
    const audio = this.ctx.audio;
    const w = clamp01(t / 10.5);
    // Shaking harder and harder
    this.shake = Math.max(this.shake, 0.15 + 1.0 * w);
    this.rumble?.set(0.35 + 0.65 * w);
    // Sparks off the consoles, the instruments, the pylons
    this.sparkT -= dt;
    if (this.sparkT <= 0) {
      this.sparkT = THREE.MathUtils.lerp(0.5, 0.08, w) * (0.5 + Math.random());
      const pt = L.sparkPoints[Math.floor(Math.random() * L.sparkPoints.length)];
      this.particles.electricSparks(pt.clone(), 10 + Math.floor(20 * w));
      if (Math.random() < 0.5) audio.electricCrackle(this.player.camera.position.distanceTo(pt));
      if (Math.random() < 0.3) this.flashPool.flash(pt, 5);
    }
    // Waves that knock everything off the desks
    const waves = [1.4, 3.2, 4.8, 6.3, 7.6, 8.8, 9.8];
    if (this.wave < waves.length && t >= waves[this.wave]) {
      this.knock(0.6 + this.wave * 0.25);
      this.wave++;
    }
    // Everything loose gets blown outward a little, constantly, papers most
    for (const pb of this.bodies) {
      if (pb.body.sleepState === CANNON.Body.SLEEPING) continue;
      const b = pb.body;
      const out = V(b.position.x, 0, b.position.z).normalize();
      const f = (pb.kind === 'paper' ? 0.05 : 0.15) * b.mass * (2 + 6 * w);
      b.applyForce(new CANNON.Vec3(out.x * f + (Math.random() - 0.5) * f, pb.kind === 'paper' ? f * 0.6 : 0, out.z * f + (Math.random() - 0.5) * f));
    }
    // Brighter and brighter: the lights, the exposure, then everything white
    this.ctx.engine.renderer.toneMappingExposure = this.exposure0 * (1 + 4 * w * w * w);
    this.whiteEl.style.opacity = String(clamp01((t - 7.6) / 3.0));
    const cam = this.player.camera;
    const fov = 74 + 14 * w * w;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    if (t > 11.2 && this.phase === 'warp') this.endWarp();
  }

  /** A wave through the room: everything loose woken and thrown. */
  private knock(power: number): void {
    const audio = this.ctx.audio;
    this.shake = Math.max(this.shake, 0.6 + power * 0.3);
    audio.stomp(4);
    let n = 0;
    for (const pb of this.bodies) {
      // Not all at once: most of them each wave
      if (Math.random() > 0.55 + power * 0.15) continue;
      const b = pb.body;
      b.wakeUp();
      const out = V(b.position.x, 0, b.position.z).normalize();
      const sideways = V(-out.z, 0, out.x).multiplyScalar((Math.random() - 0.5) * 2);
      const v = out.multiplyScalar(0.8 + Math.random() * 1.5 * power).add(sideways).setY(1.2 + Math.random() * 1.6 * power);
      if (pb.kind === 'chair' || pb.kind === 'monitor') v.multiplyScalar(0.7);
      b.velocity.set(b.velocity.x + v.x, b.velocity.y + v.y, b.velocity.z + v.z);
      b.angularVelocity.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      if (pb.kind === 'cup' && n++ < 4) setTimeout(() => audio.glassShatter(this.player.camera.position.distanceTo(pb.mesh.position) + 4), 300 + Math.random() * 400);
    }
    audio.canClatter(6);
  }

  private endWarp(): void {
    this.phase = 'end';
    this.phaseT = 0;
    // It stops: silence, black
    this.hum?.stop();
    this.hum = null;
    this.rumble?.stop();
    this.rumble = null;
    this.klaxon?.stop();
    this.klaxon = null;
    this.shake = 0;
    this.fadeEl.style.transition = 'none';
    this.fadeEl.style.opacity = '1';
    this.whiteEl.style.opacity = '0';
    this.helmetEl.style.opacity = '0';
    this.ctx.engine.renderer.toneMappingExposure = this.exposure0;
    this.later(1.2, () => (this.card.style.opacity = '1'));
    this.later(8.0, () => this.ctx.bus.emit(Events.Level15Complete));
  }

  // ============================================================ the room, alive

  /** The machine's state shown everywhere: the rings, the glows, the beam, the needles, the screens. */
  private updateMachine(dt: number): void {
    const L = this.level;
    const k = this.phase === 'warp' ? 0.6 + 0.4 * clamp01(this.warpT / 10) : this.stage * 0.2;
    const w = this.phase === 'warp' ? clamp01(this.warpT / 10.5) : 0;
    // The gimbal rings: still, then turning, then a blur
    const want = this.phase === 'warp' ? [1.2 + 9 * w * w, 1.6 + 11 * w * w, 2.2 + 14 * w * w] : this.stage === 0 ? [0, 0, 0] : this.stage === 1 ? [0.25, 0.35, 0.5] : [0.6, 0.85, 1.1];
    L.rings.forEach((r, i) => {
      this.ringSpeed[i] += (want[i] - this.ringSpeed[i]) * Math.min(1, dt * 0.8);
      const s = this.ringSpeed[i] * dt;
      if (i === 0) r.rotateX(s);
      else if (i === 1) r.rotateY(s);
      else r.rotateZ(s);
      r.rotateY(s * 0.3);
    });
    const collar = L.emitter.getObjectByName('collar');
    if (collar) collar.rotation.y += dt * (0.2 + this.stage * 0.6 + 12 * w);
    // Glows
    const pulse = 0.5 + 0.5 * Math.sin(this.t * (2 + 10 * k));
    L.pylonGlow.emissiveIntensity = 0.6 + 1.2 * k + 0.6 * pulse * k + 6 * w * w;
    L.cableGlow.emissiveIntensity = 0.4 + 1.5 * k * pulse + 4 * w * w;
    L.padMat.emissiveIntensity = 0.5 + 1.2 * k + 5 * w * w;
    const beam = L.beam.material as THREE.MeshBasicMaterial;
    beam.opacity = this.phase === 'warp' ? clamp01((this.warpT - 1.5) / 6) * (0.7 + 0.3 * Math.sin(this.t * 40)) : this.stage >= 2 ? 0.04 + 0.03 * pulse : 0;
    L.lights.center.intensity = 6 + 6 * this.stage + (this.phase === 'warp' ? 120 * w * w : 0);
    L.lights.center.color.setRGB(0.75 + 0.25 * w, 0.9 + 0.1 * w, 1);
    // The room lights flicker in the warp
    L.lights.ring.forEach((l, i) => {
      l.userData.k ??= l.intensity;
      l.intensity = (l.userData.k as number) * (this.phase === 'warp' && Math.sin(this.t * (23 + i * 7) + i) > 0.6 - w ? 0.25 : 1);
    });
    L.lamps.emissiveIntensity = 2 * (this.phase === 'warp' && Math.sin(this.t * 31) > 0.7 - w ? 0.3 : 1);
    // Beacons spin once it's live
    for (const b of L.beacons) b.rotation.y += dt * (this.stage >= 2 || this.phase === 'warp' ? 9 : 0);
    // Needles
    for (const n of L.needles) n.obj.rotation.z = n.base + Math.sin(this.t * n.rate * (1 + 4 * k) + n.ph) * n.amp * (0.4 + 0.6 * k) + (Math.random() - 0.5) * 0.15 * k;
    // Tape reels, the chart paper, the indicator lamps
    for (const r of L.reels) r.rotateZ(dt * (0.6 + 6 * k));
    L.chart.offset.y -= dt * (0.02 + 0.3 * k);
    this.ledT -= dt;
    if (this.ledT <= 0) {
      this.ledT = 0.25 - 0.18 * k;
      for (const t of L.leds) t.offset.set(Math.floor(Math.random() * 16) / 16, Math.floor(Math.random() * 32) / 32);
    }
    // Screens, a few a frame
    const n = this.phase === 'warp' ? 4 : 3;
    for (let i = 0; i < n && L.screens.length; i++) {
      const s = L.screens[this.screenI++ % L.screens.length];
      if (s === L.podium.screen) this.drawPodium();
      else s.draw(this.t, k);
    }
    // The hum
    const d = this.player.camera.position.length();
    this.hum?.setDistance(Math.max(1, d * (1.4 - 0.25 * this.stage) - 10 * w));
  }

  /** The pedestal's own screen: what it wants. */
  private drawPodium(): void {
    const s = this.level.podium.screen;
    const c = s.tex.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    g.fillStyle = '#04080b';
    g.fillRect(0, 0, c.width, c.height);
    g.textAlign = 'center';
    g.font = 'bold 22px monospace';
    if (this.denyT > 0 && Math.sin(this.t * 20) > -0.3) {
      g.fillStyle = '#ff4a3a';
      g.fillText('OPERATOR SUIT', c.width / 2, 52);
      g.fillText('NOT DETECTED', c.width / 2, 82);
    } else if (!this.suited) {
      g.fillStyle = '#ffb04a';
      g.fillText('AWAITING OPERATOR', c.width / 2, 60);
      g.font = '14px monospace';
      g.fillText('FIELD SUIT REQUIRED', c.width / 2, 90);
    } else {
      g.fillStyle = '#7fe0ff';
      g.fillText(['SEQUENCE READY', 'PRIMARY FIELD ON', 'COHERENCE RISING', 'WARP ENGAGED'][this.stage], c.width / 2, 56);
      g.font = '14px monospace';
      g.fillText(`STAGE ${this.stage} / 3`, c.width / 2, 88);
    }
    g.textAlign = 'left';
    s.tex.needsUpdate = true;
  }

  private updateProps(): void {
    for (const pb of this.bodies) {
      const b = pb.body;
      if (b.sleepState === CANNON.Body.SLEEPING && !pb.mesh.userData.moved) continue;
      pb.mesh.userData.moved = true;
      pb.mesh.position.set(b.position.x, b.position.y, b.position.z);
      pb.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    }
  }

  // ============================================================ the frame

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    this.t += dt;
    this.phaseT += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.t < this.timers[i].at) continue;
      const f = this.timers[i].fn;
      this.timers.splice(i, 1);
      f();
    }
    const p = this.player;
    const L = this.level;
    if (this.phase === 'play' && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();
    if (this.phase === 'arrive') this.updateArrive(dt);
    else if (this.phase === 'suit') this.updateSuit(dt);
    else if (this.phase === 'play' || this.phase === 'warp') p.update(dt, L.colliders);
    else if (this.phase === 'end') p.update(dt, L.colliders);
    this.updatePodium(dt);
    if (this.phase === 'warp') this.updateWarp(dt);
    if (this.phase === 'play') this.hud.setPrompt(this.suitPromptOn ? '[ E ] PUT ON THE SUIT' : this.padPromptOn ? '[ E ] PRESS' : null);
    if (this.phase !== 'end') this.updateMachine(dt);
    this.updateProps();
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.world.step(1 / 60, dt, 3);
    this.applyShake(dt);
    input.endFrame();
  }

  private applyShake(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * (this.phase === 'warp' ? 0.6 : 1.5));
    if (this.shake <= 0) return;
    const s = this.shake * this.shake * 0.022;
    const cam = this.player.camera;
    cam.rotation.x += (Math.random() - 0.5) * s;
    cam.rotation.y += (Math.random() - 0.5) * s;
    cam.position.x += (Math.random() - 0.5) * s * 0.6;
    cam.position.y += (Math.random() - 0.5) * s * 0.6;
  }

  private timers: { at: number; fn: () => void }[] = [];
  private later(sec: number, fn: () => void): void {
    this.timers.push({ at: this.t + sec, fn });
  }

  protected killEnemy(): void {}

  private onKey(e: KeyboardEvent): void {
    if (this.ctx.engine.paused) return;
    if (e.code === 'Escape' && this.phase === 'end') this.ctx.bus.emit(Events.ReturnToMenu);
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}

void PODIUM;
