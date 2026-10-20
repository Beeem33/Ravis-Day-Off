import * as THREE from 'three';
import { Enemy } from './Enemy';
import type { ChargeLine, GeneralAction, GeneralEvent, GeneralWorld, IGeneral, ThrowKind } from '../scenes/Level8Contracts';

/**
 * THE GENERAL — commander of the POLICE FORCE, about 3.2 m of him, and the
 * man who came to the car park to buy the drive. Level 8's boss.
 *
 * He is an ordinary Enemy (the General's build, opts.general) scaled up, but
 * none of the Enemy's own behaviour is used: no EnemyAI (its radii and its
 * rifle are a man's), and never die() (its ragdoll is man-sized and would
 * implode at this scale). Everything he does is a pose — Enemy.pose, set
 * fresh every frame from one persistent object — the way Skirmish's Brawl
 * and GroundPound drive their people: hands placed in his body frame and
 * reached by the arm IK, a chest lean, a squat, a wide stance, a lifted foot,
 * a twist of the chest, the head. Each action is written as eased phases,
 * and every action begins from wherever the last one left him, blending in,
 * so nothing ever snaps from one to the next.
 *
 * Body frame (the rig's, unscaled — the Enemy's numbers hold at any scale):
 * +x his right, −z his front, y up from his feet. His shoulders are at
 * (±0.36, 1.4, 0), his head at 1.585, and an arm reaches 0.6 at most; a
 * target further than that and the hand stops short along the line, so
 * every hand target here is pulled back inside REACH of where his shoulder
 * will actually be this frame (see shoulder()). That matters most for the
 * car: it is placed from the same hand targets the IK is given, so it is
 * frame-exact between his fists only if the fists really get there.
 *
 * Two modes. 'script': play() and scriptThrow() drive him, for the
 * cutscenes. 'fight': his brain runs — DESIGN.md's fight rules: go and get
 * a car, heave it overhead, turn on Ravi and throw it (lob, drive or bowl),
 * again and again, quicker as he is hurt; stamp the ground if Ravi gets in
 * under him; beat his chest and roar as each third of him goes. Every few
 * cars, something else: the rocket launcher off his back, swept across the
 * lot from one corner to the next; or a rush straight at Ravi down a line
 * he paints on the ground first, and straight back to where he was. What
 * any of it does to Ravi is the scene's business: he only says what is
 * happening, through onEvent.
 */

export const GENERAL_SCALE = 1.85;
export const GENERAL_HP = 3600;

type Pose = NonNullable<Enemy['pose']>;

const S = GENERAL_SCALE;
/** The General's rig (Enemy's shoulderX / hipX for opts.general). */
const SHOULDER_X = 0.36;
const HIP_X = 0.14;
/** Shoulder to fist, held straight: a little inside the IK's own 0.5994, so a target we give is a target he reaches. */
const REACH = 0.585;
/** Thigh plus shin, and how far the walk swings a leg (Enemy's walk cycle). */
const LEG = 0.82;
const SWING = 0.55;
/** Body units the front foot travels per step at a full stride. */
const STRIDE = 2 * LEG * Math.sin(SWING);
const HEAD_Y = 1.585;
/**
 * Car-local height of the underside his palms are under, held overhead. The
 * wheels hang below that, out at the corners, clear of his cap.
 */
const GRIP_H = 0.22;
/** Half the width and length of a car's footprint (the biggest of them, near enough). */
const CAR_HALF_W = 0.92;
const CAR_HALF_L = 2.2;
/** How far his feet stop from the side of a car he is going to pick up, metres: his knees come forward in the squat. */
const STAND_OFF = 0.8;
/** Parked cars he will rip out of the rows: only these close (he rips Ravi's cover away if Ravi hides near him). */
const NEAR_CAR = 7.5;
const STOMP_RANGE = 9;
const STOMP_RADIUS = 11;
const STOMP_COOLDOWN = 4;
/** A stagger every time this much of him has gone since the last one. */
const STAGGER_EVERY = 0.18;
/** At this much of him left he stops throwing and starts charging. */
const RAGE_AT = 0.15;
/** Flat out, m/s (Ravi sprints at 6.6), and how quickly he gets there. */
const CHARGE_SPEED = 15;
const CHARGE_ACCEL = 24;
/** Head down and pawing the ground before each run: the tell. */
const PAW_TIME = 1.0;
/** How far past where Ravi was he carries on. */
const OVERSHOOT = 10;
/** Ravi this close to him, flat, at speed: run down. */
const TRAMPLE_R = 1.75;
/** Cars this close to his front go flying. */
const RAM_R = 1.3;

/** Cars thrown between his specials (the rockets, the rush), by phase. */
const THROWS_PER_SPECIAL: Record<1 | 2 | 3, number> = { 1: 2, 2: 2, 3: 1 };
/** Getting the launcher off his back and up onto his shoulder: the tell. And putting it away. */
const SHOULDER_TIME = 1.25;
const UNSHOULDER_TIME = 0.75;
/** A rocket every this-many seconds through the sweep, by phase, at this speed (m/s). */
const ROCKET_EVERY: Record<1 | 2 | 3, number> = { 1: 0.08, 2: 0.065, 3: 0.055 };
const ROCKET_SPEED = 42;
/** The sweep goes round at this rate (rad/s), in no less and no more time than these. */
const SWEEP_RATE = 0.6;
const SWEEP_MIN = 1.6;
const SWEEP_MAX = 3.4;
/**
 * Each rocket is aimed to pass this high over the ground at Ravi's range:
 * high enough over the rows between to get there, low enough that the car
 * he is down behind takes it.
 */
const ROCKET_AT_H = 0.6;
/** The rush: only at Ravi this near; the line shows this long before he goes, still for the last part of it. */
const RUSH_RANGE = 60;
const RUSH_PAW = 1.5;
const RUSH_LOCK = 0.75;
/** How far past where Ravi was a rush carries him. */
const RUSH_OVERSHOOT = 4;
/** The enraged charge's line stops following Ravi this long before he goes. */
const RAGE_LOCK = 0.35;

/**
 * How he fights in each phase. `pace` speeds his heavy animations up (the
 * reach, the heave, the follow-through: not the 0.35 s wind-up, which is
 * the telegraph); `cycle` is DESIGN.md's release-to-release cadence, which
 * he waits out with the car held overhead if he is early.
 */
interface Tune {
  pace: number;
  walk: number;
  cycle: number;
  aim: number;
  lead: number;
  scatter: number;
  turn: number;
  aimTurn: number;
}
const TUNE: Record<1 | 2 | 3, Tune> = {
  1: { pace: 1.15, walk: 2.2, cycle: 3.4, aim: 0.9, lead: 0.55, scatter: 2.0, turn: 0.8, aimTurn: 1.3 },
  2: { pace: 1.55, walk: 2.5, cycle: 2.6, aim: 0.7, lead: 0.85, scatter: 1.2, turn: 1.0, aimTurn: 1.6 },
  3: { pace: 2.2, walk: 2.8, cycle: 1.9, aim: 0.5, lead: 0.85, scatter: 0.8, turn: 1.25, aimTurn: 2.0 }
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};
const easeIn = (x: number): number => {
  const u = clamp01(x);
  return u * u;
};
const easeOut = (x: number): number => {
  const u = clamp01(x);
  return 1 - (1 - u) * (1 - u);
};
/** 0 before a, 1 after b, eased between. */
const seg = (u: number, a: number, b: number): number => smooth((u - a) / (b - a));
const lerp = THREE.MathUtils.lerp;
const TAU = Math.PI * 2;
const wrap = (a: number): number => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

/**
 * How far the hips come down for pose.crouch and pose.stance — and with them
 * the chest, the shoulders and the head. Enemy.plantLegs's own sum, so the
 * shoulders can be known before the rig is posed.
 */
function hipsDown(crouch: number, stance: number): number {
  const c = clamp01(crouch);
  const s = clamp01(stance);
  const k = clamp01(Math.max(c, s) / 0.15);
  return (0.82 - (0.82 - 0.42 * c) * Math.cos(0.2 * s)) * k;
}
/** And how far back the seat goes in the squat (plantLegs again). */
function hipsBack(crouch: number, stance: number): number {
  const c = clamp01(crouch);
  return 0.06 * c * clamp01(Math.max(c, clamp01(stance)) / 0.15);
}

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _p3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _s1 = new THREE.Vector3();

/**
 * His rocket launcher: a four-tube pod, olive drab, with a pistol grip and
 * a front grip under it and the sight on its left. Body units (he scales
 * it); its own −Z is the muzzle end, the tubes' mouths at z = −0.5.
 */
function rocketLauncher(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'rocketLauncher';
  const olive = new THREE.MeshStandardMaterial({ color: 0x4e5534, roughness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23251d, roughness: 0.55, metalness: 0.3 });
  const black = new THREE.MeshBasicMaterial({ color: 0x060606 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material): void => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
  };
  box(0.2, 0.2, 0.92, 0, 0, 0, olive);
  box(0.226, 0.226, 0.06, 0, 0, -0.44, dark);
  box(0.226, 0.226, 0.06, 0, 0, 0.44, dark);
  box(0.226, 0.03, 0.5, 0, 0.1, 0, dark);
  box(0.045, 0.14, 0.06, 0, -0.17, -0.2, dark);
  box(0.035, 0.035, 0.14, 0, -0.115, -0.25, dark);
  box(0.04, 0.12, 0.05, -0.02, -0.16, -0.32, dark);
  box(0.035, 0.08, 0.12, -0.125, 0.05, -0.14, dark);
  // The four tubes' mouths, at both ends
  const mouth = new THREE.CircleGeometry(0.043, 12);
  for (const end of [-1, 1]) {
    for (const x of [-0.05, 0.05]) {
      for (const y of [-0.05, 0.05]) {
        const c = new THREE.Mesh(mouth, black);
        c.position.set(x, y, end * 0.4705);
        if (end < 0) c.rotation.y = Math.PI;
        g.add(c);
      }
    }
  }
  return g;
}

/** Pull `p` back inside `reach` of `from`, in place. */
function inReach(p: THREE.Vector3, from: THREE.Vector3, reach: number): void {
  _c.copy(p).sub(from);
  const d = _c.length();
  if (d > reach) p.copy(from).addScaledVector(_c, reach / d);
}

/**
 * Everything one frame of him is posed by, in one place, so an action can
 * be blended from the last one's: both hands and the elbows' pole, the
 * chest's lean and twist, the legs' squat, stance and lifted feet, the
 * head, the roar on his face and how the car in his hands is tipped.
 */
class Shape {
  readonly hR = new THREE.Vector3(0.43, 0.88, -0.06);
  readonly hL = new THREE.Vector3(-0.43, 0.88, -0.06);
  readonly elbow = new THREE.Vector3(0.8, -0.3, 0.5);
  lean = 0;
  crouch = 0;
  stance = 0;
  twist = 0;
  liftL = 0;
  liftR = 0;
  headP = 0;
  headY = 0;
  headR = 0;
  roar = 0;
  /** The held car tipped about his shoulders' line (the car's own length): + takes its roof back over him. */
  carPitch = 0;

  copy(o: Shape): this {
    this.hR.copy(o.hR);
    this.hL.copy(o.hL);
    this.elbow.copy(o.elbow);
    this.lean = o.lean;
    this.crouch = o.crouch;
    this.stance = o.stance;
    this.twist = o.twist;
    this.liftL = o.liftL;
    this.liftR = o.liftR;
    this.headP = o.headP;
    this.headY = o.headY;
    this.headR = o.headR;
    this.roar = o.roar;
    this.carPitch = o.carPitch;
    return this;
  }

  /** This = a part of the way to b. */
  mix(a: Shape, b: Shape, k: number): this {
    this.hR.lerpVectors(a.hR, b.hR, k);
    this.hL.lerpVectors(a.hL, b.hL, k);
    this.elbow.lerpVectors(a.elbow, b.elbow, k);
    this.lean = lerp(a.lean, b.lean, k);
    this.crouch = lerp(a.crouch, b.crouch, k);
    this.stance = lerp(a.stance, b.stance, k);
    this.twist = lerp(a.twist, b.twist, k);
    this.liftL = lerp(a.liftL, b.liftL, k);
    this.liftR = lerp(a.liftR, b.liftR, k);
    this.headP = lerp(a.headP, b.headP, k);
    this.headY = lerp(a.headY, b.headY, k);
    this.headR = lerp(a.headR, b.headR, k);
    this.roar = lerp(a.roar, b.roar, k);
    this.carPitch = lerp(a.carPitch, b.carPitch, k);
    return this;
  }

  /** Both hands, mirrored: the right at (x, y, z), the left at (−x, y, z). */
  arms(x: number, y: number, z: number): this {
    this.hR.set(x, y, z);
    this.hL.set(-x, y, z);
    return this;
  }
}

type Act =
  | 'idle'
  | 'walk'
  | 'pound'
  | 'roar'
  | 'point'
  | 'reach'
  | 'lift'
  | 'aim'
  | 'windup'
  | 'release'
  | 'follow'
  | 'stomp'
  | 'stagger'
  | 'paw'
  | 'charge'
  | 'skid'
  | 'shoulder'
  | 'barrage'
  | 'unshoulder'
  | 'return'
  | 'death';

/** What a walk is for: what he does when he gets there. */
type WalkFor = 'script' | 'car' | 'vantage';

/** The heave overhead: the hands' keyframes, the right hand's (the left mirrors x). */
const LIFT_K1 = new THREE.Vector3(0.3, 1.22, -0.5); // ripped up to the front of his chest
const LIFT_K2 = new THREE.Vector3(0.3, 1.72, -0.38); // driven up in front of his face
const LIFT_K3 = new THREE.Vector3(0.3, 1.95, 0.03); // locked out overhead
const LIFT_KNOTS = [0.3, 0.62] as const;

export class General implements IGeneral {
  readonly enemy: Enemy;
  readonly scale = GENERAL_SCALE;
  readonly maxHp = GENERAL_HP;
  hp = GENERAL_HP;
  mode: 'script' | 'fight' = 'script';
  onEvent: ((e: GeneralEvent) => void) | null = null;
  /**
   * Set by the scene through a cutscene in the fight: whatever he is in the
   * middle of plays out (a stride, a breath, the car held up), but his brain
   * takes no new decision — no throw, no stomp, no next car — until it is
   * cleared. Scripted actions (play, scriptThrow) ignore it.
   */
  paused = false;
  /** His ground in the fight: he never walks out of it. The scene sets it; by default a 20 m box round where he was made. */
  zone: { minX: number; maxX: number; minZ: number; maxZ: number };

  private _phase: 1 | 2 | 3 = 1;
  private _dead = false;
  get phase(): 1 | 2 | 3 {
    return this._phase;
  }
  get dead(): boolean {
    return this._dead;
  }
  /** Beating his chest, or staggered, or roaring as a phase goes: hit him now. */
  get vulnerable(): boolean {
    if (this.dying) return false;
    return this.act === 'pound' || this.act === 'stagger' || this.act === 'skid' || (this.act === 'roar' && this.phaseShow);
  }
  get holding(): number {
    return this.carHeld;
  }
  get chargeLine(): ChargeLine | null {
    if (!this.lineShown) return null;
    this.line.locked = this.lineLocked;
    this.line.back = this.lineBack;
    return this.line;
  }

  // ---- The pose, and the shapes it is blended from
  private readonly pHandR = new THREE.Vector3();
  private readonly pHandL = new THREE.Vector3();
  private readonly pElbow = new THREE.Vector3();
  private readonly pShift = new THREE.Vector3();
  private readonly pHead = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly pose: Pose;
  /** What is on him this frame; what the action started from; what the action wants. */
  private readonly cur = new Shape();
  private readonly from = new Shape();
  private readonly tgt = new Shape();
  private readonly shR = new THREE.Vector3();
  private readonly shL = new THREE.Vector3();

  // ---- The action under way
  private act: Act = 'idle';
  private actT = 0;
  private actDur = Infinity;
  private blendIn = 0.4;
  private ease: (x: number) => number = smooth;
  private time = 0;

  // ---- Script
  private readonly atPoint = new THREE.Vector3();
  private hasAt = false;
  /** In the middle of scriptThrow: nothing the brain wants gets in its way. */
  private scriptedThrow = false;
  private thenFight = false;
  private readonly throwAt = new THREE.Vector3();
  /** The scripted chest-beat and roar run into idle, not into the brain. */
  private phaseShow = false;

  // ---- Walking (a mirror of the Enemy's own walk cycle, so his feet are known)
  private walkW = 0;
  private sb = 0;
  private phaseW = 0;
  private cadence = 1;
  private moving = false;
  private readonly moveDir = new THREE.Vector3();
  private moveLeft = 0;
  private readonly walkTo = new THREE.Vector3();
  private walkFor: WalkFor = 'script';
  private walkLimit = 0;
  private shuf = 0;
  private shufOn = false;

  // ---- Looking
  private lookY = 0;
  private lookP = 0;
  private readonly lookPt = new THREE.Vector3();

  // ---- What he knows of Ravi, this frame
  private readonly tgtPos = new THREE.Vector3();
  private readonly tgtVel = new THREE.Vector3();
  private tgtAlive = false;
  private tgtSeen = false;

  // ---- The car
  private carId = -1;
  private carHeld = -1;
  private readonly carAt = new THREE.Vector3();
  private carYaw = 0;
  /** Its ground centre where it stood, worked out from the roof point findCar gives. */
  private readonly carOrigin0 = new THREE.Vector3();
  private carH = 1.45;
  /** Where he stands to pick it up, and where his hands go on it. */
  private readonly standW = new THREE.Vector3();
  private readonly grabW = new THREE.Vector3();
  private grabPending = false;
  /** The car from his hands when he took it (metres, his heading's frame), its heading relative to his, and where both are going. */
  private readonly o0 = new THREE.Vector3();
  private yawRel0 = 0;
  private yawRelEnd = Math.PI / 2;
  /** The heave's blends: the car up onto his palms (e1), then in over his head and turned across him (e2), tossed up off them as it goes (toss, metres). */
  private carE1 = 1;
  private carE2 = 1;
  private carToss = 0;
  private throwKind: ThrowKind = 'lob';
  private readonly carM = new THREE.Matrix4();
  private readonly carQ = new THREE.Quaternion();
  private readonly qYaw = new THREE.Quaternion();
  private readonly qTmp = new THREE.Quaternion();
  private readonly carOriginW = new THREE.Vector3();
  private readonly midB = new THREE.Vector3();
  private readonly midW = new THREE.Vector3();
  private readonly off = new THREE.Vector3();

  // ---- The brain
  private nextReleaseAt = 0;
  private stompCD = 0;
  private readonly stompAt = new THREE.Vector3();
  private stomped = false;
  private pendingPhase = false;
  private repositioned = false;
  private gloated = false;
  private replanAt = -1;
  private staggerAcc = 0;
  private readonly staggerFrom = new THREE.Vector3();
  /** Fist phases of the chest-beat last frame, to catch each one landing; and how many have. */
  private prevUR = 0;
  private prevUL = 0;
  private pounds = 0;
  private sincePound = 9;

  // ---- The charge (his last 15%)
  private enraged = false;
  private pendingRage = false;
  private readonly chargeDir = new THREE.Vector3();
  private chargeSpeed = 0;
  private chargeLeft = 0;
  private trampled = false;
  private skidCrashed = false;

  // ---- The specials: the rocket sweep, and the rush and the run back
  private throwsSince = 0;
  private nextSpecial: 'rockets' | 'rush' = 'rockets';
  private rushing = false;
  private readonly home = new THREE.Vector3();
  private lineShown = false;
  private lineLocked = false;
  private lineBack = false;
  private readonly line: ChargeLine = { from: new THREE.Vector3(), to: new THREE.Vector3(), locked: false, back: false, halfWidth: TRAMPLE_R };
  private sweepFrom = 0;
  private sweepBy = 0;
  private rocketT = 0;
  private rocketN = 0;
  private aimPitch = -0.1;
  private recoil = 0;
  /** The launcher, its seat on his back (chest-local), and how far it is from there onto his shoulder (0..1). */
  private readonly launcher: THREE.Group;
  private readonly backSeat = new THREE.Matrix4();
  private lnch = 0;

  // ---- Dying
  private dying = false;
  private readonly deathFrom = new THREE.Vector3();
  private readonly heel = new THREE.Vector3();
  private deathYaw = 0;
  private deathStage = 0;

  constructor(
    private scene: THREE.Scene,
    private world: GeneralWorld,
    pos: THREE.Vector3,
    yaw: number
  ) {
    this.enemy = new Enemy(pos, yaw, 0, { name: 'THE GENERAL', general: true });
    const e = this.enemy;
    e.root.scale.setScalar(GENERAL_SCALE);
    // Yaw outermost, so his fall (rotation.x) tips him about his own heels'
    // line whichever way he faces
    e.root.rotation.order = 'YXZ';
    e.root.rotation.set(0, yaw, 0);
    e.yaw = yaw;
    e.poseCurl = 0.8;
    e.onStep = (side) => this.footfall(side);
    scene.add(e.root);
    this.zone = { minX: pos.x - 10, maxX: pos.x + 10, minZ: pos.z - 10, maxZ: pos.z + 10 };
    this.pose = {
      handR: this.pHandR,
      handL: this.pHandL,
      elbow: this.pElbow,
      shift: this.pShift,
      head: this.pHead,
      lean: 0,
      crouch: 0,
      stance: 0,
      twist: 0,
      liftL: 0,
      liftR: 0
    };
    this.cadence = this.cadenceFor(TUNE[1].walk);
    // The launcher, slung across his back, muzzle up over his right shoulder
    this.launcher = rocketLauncher();
    this.launcher.matrixAutoUpdate = false;
    scene.add(this.launcher);
    this.backSeat.compose(
      new THREE.Vector3(0.02, -0.03, 0.27),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0.42, 0.9, 0.06).normalize()),
      ONE
    );
    // Start already stood in his idle, not blending into it from nothing
    this.idleShape(this.cur);
    this.from.copy(this.cur);
    this.begin('idle', Infinity, 0);
  }

  // ===================================================================== public

  play(action: GeneralAction, opts: { at?: THREE.Vector3; to?: THREE.Vector3; duration?: number } = {}): number {
    if (this.dying) return 0;
    if (this.carHeld >= 0) this.dropCar();
    this.scriptedThrow = false;
    this.phaseShow = false;
    this.hasAt = !!opts.at;
    if (opts.at) this.atPoint.copy(opts.at);
    switch (action) {
      case 'idle':
        this.beginIdle(opts.duration ?? Infinity);
        return opts.duration ?? 0;
      case 'walk': {
        if (!opts.to) {
          this.beginIdle(Infinity);
          return 0;
        }
        this.walkTo.set(opts.to.x, this.enemy.position.y, opts.to.z);
        const p = this.enemy.position;
        const dist = Math.hypot(this.walkTo.x - p.x, this.walkTo.z - p.z);
        const turn = Math.abs(wrap(Math.atan2(-(this.walkTo.x - p.x), -(this.walkTo.z - p.z)) - this.enemy.yaw));
        this.beginWalk('script');
        // The stride takes a moment to open out, and he turns before he goes
        return dist / TUNE[1].walk + turn / 1.6 + 0.4;
      }
      case 'chestPound': {
        const d = opts.duration ?? 2.4;
        this.beginPound(d);
        return d;
      }
      case 'roar': {
        const d = opts.duration ?? 2;
        this.beginRoar(d);
        return d;
      }
      case 'point': {
        const d = opts.duration ?? 1.2;
        this.begin('point', Math.max(0.5, d - 0.3), 0.3);
        this.enemy.poseCurl = 0.9;
        return d;
      }
    }
    return 0;
  }

  scriptThrow(at: THREE.Vector3, thenFight: boolean): void {
    if (this.dying) return;
    if (this.carHeld >= 0) this.dropCar();
    this.phaseShow = false;
    this.throwAt.copy(at);
    this.thenFight = thenFight;
    const c = this.world.findCar(_a.copy(this.enemy.position), 90);
    if (!c) {
      // Nothing to throw: no 'throw' will come. Let the fight have him.
      this.scriptedThrow = false;
      if (thenFight) {
        this.mode = 'fight';
        this.decide();
      } else this.beginIdle(Infinity);
      return;
    }
    this.scriptedThrow = true;
    this.takeCar(c);
    this.goForCar();
  }

  damage(dmg: number, _part: string, _point: THREE.Vector3): void {
    if (this.dying || !(dmg > 0)) return;
    const d = dmg * (this.vulnerable ? 1.5 : 1);
    this.hp = Math.max(0, this.hp - d);
    this.enemy.flinch(1);
    if (this.hp <= 0) {
      this.beginDeath();
      return;
    }
    const f = this.hp / this.maxHp;
    const ph: 1 | 2 | 3 = f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
    if (ph > this._phase) {
      this._phase = ph;
      this.pendingPhase = true;
      this.emit({ type: 'phase', phase: ph });
    }
    // Nearly done: no more throwing. He gets rid of whatever he has and comes for Ravi himself
    if (!this.enraged && this.hp <= RAGE_AT * this.maxHp && !this.scriptedThrow) {
      this.enraged = true;
      this.pendingRage = true;
      this.emit({ type: 'enrage' });
    }
    this.staggerAcc += d;
    // Each eighth or so of him that goes rocks him back on his heels — and
    // whatever he had in his hands comes down. Not while he is already
    // beating his chest or reeling, and never in the middle of the cutscene's
    // throw, which the scene is waiting on
    if (
      this.staggerAcc >= STAGGER_EVERY * this.maxHp &&
      this.act !== 'pound' &&
      this.act !== 'roar' &&
      this.act !== 'stagger' &&
      this.act !== 'paw' &&
      this.act !== 'charge' &&
      this.act !== 'return' &&
      !this.scriptedThrow
    ) {
      this.staggerAcc = 0;
      this.beginStagger();
    }
  }

  update(dt: number): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    if (this.deathStage === 5) {
      // Laid out for good: the Enemy holds him as he lies
      this.enemy.update(dt);
      return;
    }
    this.time += dt;
    if (this.stompCD > 0) this.stompCD -= dt;
    if (this.sincePound < 9) this.sincePound += dt;
    this.sense();
    this.walkW = 0;
    this.moving = false;
    this.actT += dt;
    this.brainChecks();
    this.step(dt);
    this.mirrorWalk(dt);
    this.look(dt);
    this.shape(this.tgt);
    const k = this.blendIn > 1e-4 ? this.ease(this.actT / this.blendIn) : 1;
    this.cur.mix(this.from, this.tgt, k);
    this.applyPose();
    if (this.carHeld >= 0) this.placeCar();
    const e = this.enemy;
    e.cadence = this.cadence;
    e.setWalk(this.walkW);
    e.pose = this.pose;
    // Last: the rig and the model posed off everything above
    e.update(dt);
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 7);
    this.placeLauncher(dt);
  }

  dispose(): void {
    this.enemy.onStep = null;
    this.onEvent = null;
    this.scene.remove(this.enemy.root);
    this.scene.remove(this.launcher);
  }

  // ===================================================================== the frame

  private emit(e: GeneralEvent): void {
    this.onEvent?.(e);
  }

  private sense(): void {
    const t = this.world.target();
    this.tgtPos.copy(t.pos);
    this.tgtVel.set(t.vel.x, 0, t.vel.z);
    this.tgtAlive = t.alive;
    this.tgtSeen = true;
  }

  private get tune(): Tune {
    return TUNE[this._phase];
  }

  /** The walk cycle's rate for a ground speed, so the planted foot keeps pace with the ground (no sliding). */
  private cadenceFor(speed: number): number {
    // Feet cover STRIDE·S per step, and a full stride turns over at
    // 7.5·1.5 rad/s of phase, π of it per step
    return (speed * Math.PI) / (STRIDE * S * 7.5 * 1.5);
  }

  private begin(act: Act, dur: number, blendIn: number, ease: (x: number) => number = smooth): void {
    this.act = act;
    this.actT = 0;
    this.actDur = dur;
    this.blendIn = blendIn;
    this.ease = ease;
    this.from.copy(this.cur);
  }

  /** The things that cut into whatever he is doing, in the fight: a phase going, Ravi under his feet. */
  private brainChecks(): void {
    if (this.mode !== 'fight' || this.dying || this.scriptedThrow) return;
    // Handed over from a cutscene's open-ended idle: take it from here
    if (this.act === 'idle' && this.actDur === Infinity) {
      this.decide();
      return;
    }
    // Ravi down: whatever he was doing, he stops to stand over it and roar
    // (a run, a sweep and the run home play out first)
    if (!this.tgtAlive) {
      const a = this.act;
      const busy = a === 'roar' || a === 'stagger' || a === 'stomp' || a === 'charge' || a === 'skid' || a === 'return' || a === 'barrage' || a === 'unshoulder';
      if (!this.gloated && !busy) this.decide();
      return;
    }
    if (this.pendingRage) {
      // Whatever he is in the middle of, he stops: the car goes down and he roars
      if (this.act !== 'stagger') {
        this.endSpecial();
        this.pendingRage = false;
        this.pendingPhase = false;
        if (this.carHeld >= 0) this.dropCar();
        this.carId = -1;
        this.beginRoar(2.2);
      }
      return;
    }
    // Charging now: decide() picks the next run when each one is done
    if (this.enraged) return;
    if (this.paused || this.carHeld >= 0) return;
    const a = this.act;
    if (a !== 'idle' && a !== 'walk' && a !== 'reach' && a !== 'follow') return;
    if (this.pendingPhase) this.beginPhaseShow();
    else if (this.stompReady()) this.beginStomp();
  }

  /** Each action's intent this frame: turning, walking, and when it is over. */
  private step(dt: number): void {
    const t = this.tune;
    switch (this.act) {
      case 'idle': {
        // Squared up to Ravi (or whatever the cutscene has him watch), with
        // a slow giant's turn — and if he has a long way round to go, a few
        // shuffling steps to take him there
        const at = this.facePoint();
        let err = 0;
        if (at) err = this.turnToward(at.x, at.z, dt, t.turn * (this.shuf > 0.5 ? 1.3 : 1), 2.5);
        const ae = Math.abs(err);
        if (ae > 0.5) this.shufOn = true;
        else if (ae < 0.12) this.shufOn = false;
        this.shuf += ((this.shufOn ? 1 : 0) - this.shuf) * Math.min(1, dt * 5);
        if (this.shuf > 0.75) {
          this.walkW = 0.32;
          this.cadence = this.cadenceFor(t.walk) * 1.4;
        }
        if (this.actT >= this.actDur) this.endAct();
        break;
      }
      case 'walk':
        this.stepWalk(dt);
        break;
      case 'pound':
      case 'roar': {
        const at = this.facePoint();
        if (at) this.turnToward(at.x, at.z, dt, 0.5, 2);
        if (this.actT >= this.actDur) this.endAct();
        break;
      }
      case 'point': {
        const at = this.facePoint();
        if (at) this.turnToward(at.x, at.z, dt, 1.2, 3);
        if (this.actT >= this.actDur) this.endAct();
        break;
      }
      case 'reach': {
        // Square up to it first: he may have come in with it beside him or
        // behind him, and a car grabbed behind his back would be heaved up
        // through him. Shuffling round, the reach waits at its start
        const err = this.turnToward(this.grabW.x, this.grabW.z, dt, 2.6, 5);
        if (Math.abs(err) > 0.25 && this.actT < 0.1) {
          this.actT = Math.min(this.actT, 0.04);
          this.walkW = 0.32;
          this.cadence = this.cadenceFor(this.tune.walk) * 1.4;
        }
        if (this.actT >= this.actDur) this.endAct();
        break;
      }
      case 'aim': {
        const p = this.scriptedThrow ? this.throwAt : this.tgtPos;
        const err = this.turnToward(p.x, p.z, dt, t.aimTurn, 3);
        const done = (this.actT >= this.actDur && Math.abs(err) < 0.12) || this.actT >= this.actDur + 1.5;
        if (done && (this.scriptedThrow || !this.paused)) this.endAct();
        break;
      }
      case 'windup': {
        const p = this.scriptedThrow ? this.throwAt : this.tgtPos;
        this.turnToward(p.x, p.z, dt, 0.8, 2);
        if (this.actT >= this.actDur) this.endAct();
        break;
      }
      case 'stomp':
        if (this.actT < 0.6) this.turnToward(this.tgtPos.x, this.tgtPos.z, dt, 2, 3);
        if (!this.stomped && this.actT >= 0.8) {
          this.stomped = true;
          this.stompCD = STOMP_COOLDOWN;
          this.footSpot(1, 0.85, this.stompAt);
          this.emit({ type: 'stomp', pos: this.stompAt.clone(), radius: STOMP_RADIUS });
        }
        if (this.actT >= this.actDur) this.endAct();
        break;
      case 'stagger': {
        // Rocked back a stride, staying inside his ground
        const k = smooth(this.actT / 0.55);
        const f = this.enemy.forwardDir(_a);
        const p = this.enemy.position;
        p.x = this.staggerFrom.x - f.x * 0.75 * k;
        p.z = this.staggerFrom.z - f.z * 0.75 * k;
        if (this.mode === 'fight') this.clampZone(p);
        if (this.actT >= this.actDur) this.endAct();
        break;
      }
      case 'paw':
        // Squaring up to him, quickly: this is where the run will go, and
        // the line on the ground goes with him — until the last moment of
        // it, when it stops: what it shows then is where he goes
        if (this.actT < this.actDur - (this.rushing ? RUSH_LOCK : RAGE_LOCK)) {
          this.turnToward(this.tgtPos.x, this.tgtPos.z, dt, 3.2, 8);
          this.planRun();
        } else {
          this.lineLocked = true;
          this.turnToward(this.line.to.x, this.line.to.z, dt, 3.2, 8);
        }
        if (this.actT >= this.actDur) this.beginCharge();
        break;
      case 'charge':
        this.stepCharge(dt);
        break;
      case 'skid':
        this.stepSkid(dt);
        break;
      case 'return':
        this.stepReturn(dt);
        break;
      case 'shoulder': {
        // Round to where the sweep starts while he gets it up
        const p = this.enemy.position;
        const err = this.turnToward(p.x - Math.sin(this.sweepFrom) * 10, p.z - Math.cos(this.sweepFrom) * 10, dt, 2.4, 5);
        if (Math.abs(err) > 0.3) {
          this.walkW = 0.32;
          this.cadence = this.cadenceFor(t.walk) * 1.4;
        }
        this.aimAt(dt);
        if (this.actT >= this.actDur) this.endAct();
        break;
      }
      case 'barrage': {
        // Swinging round with the sweep, a rocket away every beat
        const e = this.enemy;
        const want = wrap(this.sweepFrom + this.sweepBy * clamp01(this.actT / this.actDur));
        e.yaw = wrap(e.yaw + THREE.MathUtils.clamp(wrap(want - e.yaw), -5 * dt, 5 * dt));
        e.root.rotation.y = e.yaw;
        this.walkW = 0.3;
        this.cadence = this.cadenceFor(t.walk) * 1.2;
        this.aimAt(dt);
        this.rocketT -= dt;
        while (this.rocketT <= 0 && this.actT < this.actDur) {
          this.rocketT += ROCKET_EVERY[this._phase];
          this.fireRocket();
        }
        if (this.actT >= this.actDur) this.endAct();
        break;
      }
      case 'death':
        this.stepDeath();
        break;
      default:
        if (this.actT >= this.actDur) this.endAct();
    }
  }

  /** An action has run its course: what comes after it. */
  private endAct(): void {
    switch (this.act) {
      case 'reach':
        // Hands on it: it is his
        this.world.grab(this.carId);
        this.carHeld = this.carId;
        this.grabPending = true;
        this.enemy.poseCurl = 1;
        this.emit({ type: 'lift', carId: this.carId });
        this.begin('lift', 1.1 / this.paceNow(), 0);
        return;
      case 'lift':
        this.carE1 = this.carE2 = 1;
        this.carToss = 0;
        this.beginAim();
        return;
      case 'aim':
        this.throwKind = this.chooseKind();
        this.emit({ type: 'windup', carId: this.carHeld, kind: this.throwKind });
        this.begin('windup', 0.35, 0.35);
        return;
      case 'windup':
        // The throw itself: overhead it is a short, accelerating heave;
        // bowled, a longer swing down to the ground
        this.begin('release', this.throwKind === 'bowl' ? 0.3 : 0.14, 0);
        return;
      case 'release':
        this.release();
        this.begin('follow', 0.55 / this.paceNow(), 0.3 * (0.55 / this.paceNow()), easeOut);
        this.enemy.poseCurl = 0.8;
        return;
      case 'follow':
        if (this.scriptedThrow) {
          this.scriptedThrow = false;
          if (this.thenFight) {
            this.mode = 'fight';
            this.decide();
          } else this.beginIdle(Infinity);
          return;
        }
        this.decide();
        return;
      case 'pound':
        if (this.phaseShow) {
          this.beginRoar(2);
          return;
        }
        break;
      case 'roar':
        this.phaseShow = false;
        break;
      case 'walk':
        this.arrive();
        return;
      case 'shoulder':
        this.rocketT = 0;
        this.rocketN = 0;
        this.begin('barrage', this.sweepDur, 0.2);
        return;
      case 'barrage':
        this.begin('unshoulder', UNSHOULDER_TIME, 0.25);
        return;
      case 'unshoulder':
        this.throwsSince = 0;
        this.emit({ type: 'specialDone' });
        break;
      case 'skid':
        // A rush: straight back to where he came from
        if (this.rushing) {
          this.beginReturn();
          return;
        }
        break;
    }
    if (this.mode === 'fight') this.decide();
    else this.beginIdle(Infinity);
  }

  /**
   * How quickly the heavy parts of a throw go (the reach, the heave, the
   * follow-through): his phase's pace, and up to half as fast again when a
   * walk to the car has put him behind his cadence.
   */
  private paceNow(): number {
    if (this.scriptedThrow) return 1;
    const t = this.tune;
    const late = this.time - (this.nextReleaseAt - t.cycle) - 0.5 * t.cycle;
    return t.pace * THREE.MathUtils.clamp(1 + late / t.cycle, 1, 1.5);
  }

  // ===================================================================== the brain

  /** What next, in the fight. */
  private decide(): void {
    if (this.dying) return;
    if (this.mode !== 'fight') {
      this.beginIdle(Infinity);
      return;
    }
    if (!this.tgtSeen) this.sense();
    if (!this.tgtAlive) {
      // Ravi is down: stand over the lot, roar once, and wait
      this.endSpecial();
      if (this.carHeld >= 0) this.dropCar();
      if (!this.gloated) {
        this.gloated = true;
        this.beginRoar(2);
        return;
      }
      this.beginIdle(1);
      return;
    }
    this.gloated = false;
    if (this.paused) {
      this.beginIdle(0.25);
      return;
    }
    if (this.enraged) {
      this.pendingPhase = false;
      this.beginPaw();
      return;
    }
    if (this.pendingPhase) {
      this.beginPhaseShow();
      return;
    }
    if (this.stompReady()) {
      this.beginStomp();
      return;
    }
    // Every few cars, something else: the rockets, or a rush at him — the
    // two in turn, but a rush only at a Ravi near enough to reach
    if (!this.scriptedThrow && this.throwsSince >= THROWS_PER_SPECIAL[this._phase]) {
      this.throwsSince = 0;
      if (this.nextSpecial === 'rush' && this.flatDist(this.tgtPos) <= RUSH_RANGE) {
        this.nextSpecial = 'rockets';
        this.rushing = true;
        this.home.copy(this.enemy.position);
        this.beginPaw();
      } else {
        this.nextSpecial = 'rush';
        this.beginRockets();
      }
      return;
    }
    // Hidden from him behind the rows: a few strides along his ground to
    // get a line on Ravi again (once between throws; the lob arcs over
    // cover anyway, so it is not worth more)
    if (!this.repositioned && Math.random() < 0.4 && !this.lineToTarget()) {
      this.repositioned = true;
      if (this.pickVantage(this.walkTo)) {
        this.beginWalk('vantage');
        return;
      }
    }
    const c = this.pickCar();
    if (!c) {
      this.beginIdle(1.2);
      return;
    }
    this.takeCar(c);
    this.goForCar();
  }

  /**
   * The next car: one within arm's length of where he is (a parked car —
   * Ravi's cover, if Ravi is hiding near him), else the nearest he can get
   * at without leaving his ground: the scrap pile, a car at the end of a
   * row along its edge, a wreck that came down inside it. findCar only ever
   * answers with the nearest car to a point, so the ground is searched from
   * a grid of points over it, and what lies too far outside it to be
   * reached from inside is passed over (cars he has thrown, out on the lot).
   */
  private pickCar(): { id: number; at: THREE.Vector3; yaw: number } | null {
    const near = this.world.findCar(_a.copy(this.enemy.position), NEAR_CAR);
    if (near) return near;
    const z = this.zone;
    const w = z.maxX - z.minX;
    const h = z.maxZ - z.minZ;
    const nx = Math.max(1, Math.ceil(w / 8));
    const nz = Math.max(1, Math.ceil(h / 8));
    let best: { id: number; at: THREE.Vector3; yaw: number } | null = null;
    let bd = Infinity;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        _a.set(z.minX + ((i + 0.5) * w) / nx, 0, z.minZ + ((j + 0.5) * h) / nz);
        const c = this.world.findCar(_a, 9);
        if (!c) continue;
        // How far outside his ground it is
        const ox = Math.max(z.minX - c.at.x, 0, c.at.x - z.maxX);
        const oz = Math.max(z.minZ - c.at.z, 0, c.at.z - z.maxZ);
        if (Math.hypot(ox, oz) > 3.2) continue;
        const d = this.flatDist(c.at);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
    }
    return best;
  }

  private stompReady(): boolean {
    return this.stompCD <= 0 && this.tgtAlive && this.flatDist(this.tgtPos) < STOMP_RANGE;
  }

  /** Can he see Ravi's chest from up where a held car would be? */
  private lineToTarget(): boolean {
    const p = this.enemy.position;
    _a.set(p.x, p.y + 3.3, p.z);
    _b.copy(this.tgtPos);
    _b.y += 1.1;
    return this.world.clearLine(_a, _b);
  }

  /** A spot a few strides off, inside his ground, with a clear line to Ravi; false if none of them has one. */
  private pickVantage(out: THREE.Vector3): boolean {
    const p = this.enemy.position;
    let dx = this.tgtPos.x - p.x;
    let dz = this.tgtPos.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    const flip = Math.random() < 0.5 ? 1 : -1;
    // Across the line to him either way, nearer first, then a step toward him
    const tries: [number, number][] = [
      [4.5 * flip, 0],
      [-4.5 * flip, 0],
      [7.5 * flip, 1],
      [-7.5 * flip, 1],
      [0, 4]
    ];
    _b.copy(this.tgtPos);
    _b.y += 1.1;
    for (const [side, ahead] of tries) {
      out.set(p.x - dz * side + dx * ahead, 0, p.z + dx * side + dz * ahead);
      this.clampZone(out);
      if (this.flatDist(out) < 2.2) continue;
      _a.set(out.x, 3.3, out.z);
      if (this.world.clearLine(_a, _b)) return true;
    }
    return false;
  }

  /**
   * Note the car down and work out how he picks it up. findCar gives the
   * middle of its roof and its heading; its ground centre is under that —
   * on the ground if the roof is low enough to be a car standing there, or
   * a car's height below it if it is stacked on the pile. His hands go on
   * the top of its body on the side nearest him (the door tops from the
   * side, the bonnet's edge from the front), and he stands just off it.
   */
  private takeCar(c: { id: number; at: THREE.Vector3; yaw: number }): void {
    this.carId = c.id;
    this.carAt.copy(c.at);
    this.carYaw = c.yaw;
    const oy = c.at.y < 2 ? 0 : c.at.y - 1.45;
    this.carOrigin0.set(c.at.x, oy, c.at.z);
    this.carH = Math.max(0.6, c.at.y - oy);
    // His position in the car's own frame, and the nearest point of its footprint
    const p = this.enemy.position;
    const sy = Math.sin(c.yaw);
    const cy = Math.cos(c.yaw);
    const rx = p.x - c.at.x;
    const rz = p.z - c.at.z;
    const lx = rx * cy - rz * sy;
    const lz = rx * sy + rz * cy;
    let nx = THREE.MathUtils.clamp(lx, -CAR_HALF_W, CAR_HALF_W);
    let nz = THREE.MathUtils.clamp(lz, -CAR_HALF_L, CAR_HALF_L);
    // Which way is out from that edge, car-local: toward him, unless he is
    // stood inside its footprint (it came down on him), when it is the
    // nearer side's own outward way
    let outX = 0;
    let outZ = 0;
    if (Math.abs(nx) < CAR_HALF_W && Math.abs(nz) < CAR_HALF_L) {
      if (CAR_HALF_W - Math.abs(nx) < CAR_HALF_L - Math.abs(nz)) {
        outX = Math.sign(nx || 1);
        nx = outX * CAR_HALF_W;
      } else {
        outZ = Math.sign(nz || 1);
        nz = outZ * CAR_HALF_L;
      }
    }
    // Back to the world: the edge point, and out from it
    const ex = c.at.x + nx * cy + nz * sy;
    const ez = c.at.z - nx * sy + nz * cy;
    let ox = outX || outZ ? outX * cy + outZ * sy : p.x - ex;
    let oz = outX || outZ ? -outX * sy + outZ * cy : p.z - ez;
    let ol = Math.hypot(ox, oz);
    if (ol < 0.05) {
      ox = ex - c.at.x;
      oz = ez - c.at.z;
      ol = Math.hypot(ox, oz) || 1;
    }
    ox /= ol;
    oz /= ol;
    this.standW.set(ex + ox * STAND_OFF, 0, ez + oz * STAND_OFF);
    if (!this.scriptedThrow) this.clampZone(this.standW);
    // Hands a hand's breadth in over the edge, on the top of the body
    const gy = Math.min(this.carH * 0.68, 1.0);
    this.grabW.set(ex - ox * 0.12, oy + gy, ez - oz * 0.12);
  }

  /** Off to the car if he isn't stood at it, else straight down to it. */
  private goForCar(): void {
    this.walkTo.copy(this.standW);
    if (this.flatDist(this.walkTo) > 0.35) this.beginWalk('car');
    else this.beginReach();
  }

  private beginReach(): void {
    // Make sure it is still there and still the one: a car can be knocked
    // about by another landing while he walks over to it
    // (Something still there is enough: stacked wrecks share a roof point
    // near enough that findCar may answer with the one under it.) Once a
    // frame at most, so a re-plan that lands straight back here can't loop
    const c = this.world.findCar(_a.copy(this.carAt), 1.2);
    if (!c && this.replanAt !== this.time) {
      this.replanAt = this.time;
      if (this.scriptedThrow) {
        const any = this.world.findCar(_a.copy(this.enemy.position), 90);
        if (any) {
          this.takeCar(any);
          this.goForCar();
          return;
        }
        this.scriptedThrow = false;
      }
      this.decide();
      return;
    }
    if (c && c.id === this.carId) {
      this.carAt.copy(c.at);
      this.carYaw = c.yaw;
    }
    this.emit({ type: 'reach', carId: this.carId });
    const d = 0.6 / this.paceNow();
    this.begin('reach', d, d);
    this.enemy.poseCurl = 0.35;
  }

  private beginAim(): void {
    // He holds it up until he has turned on Ravi and his time is up — and
    // longer, if he is ahead of his phase's cadence
    let d = this.scriptedThrow ? 0.6 : this.tune.aim;
    if (!this.scriptedThrow) {
      const relDur = 0.14;
      d = Math.max(d, Math.min(2.6, this.nextReleaseAt - this.time - 0.35 - relDur));
    }
    this.begin('aim', d, 0.25);
  }

  private chooseKind(): ThrowKind {
    if (this.scriptedThrow || this._phase === 1) return 'lob';
    if (this._phase === 3 && Math.random() < 0.3) return 'bowl';
    _a.copy(this.carOriginW);
    _a.y += 0.7;
    _b.copy(this.tgtPos);
    _b.y += 1.1;
    if (Math.random() < 0.45 && this.world.clearLine(_a, _b)) return 'drive';
    return 'lob';
  }

  /**
   * Let go. The car leaves from where it was last held (the CarSystem has it
   * there already) with the velocity that carries it onto Ravi:
   *  - lob: a ballistic arc, flight time by distance, landing on where he
   *    will be (his velocity times the lead) give or take the scatter.
   *    v = (aim − p0)/T − ½·g·T, g pointing down. A gentle tumble.
   *  - drive: flat and fast at his chest, ~28 m/s, the same sum with T from
   *    the speed — a shallow arc. Cover stops it. A moderate spin.
   *  - bowl: low along the ground at 20 m/s, rolling end over end across its
   *    own length, which lies across the way it goes: a heavy cartwheel.
   */
  private release(): void {
    const id = this.carHeld;
    if (id < 0) return;
    const p0 = this.carOriginW;
    const g = this.world.gravity;
    const vel = new THREE.Vector3();
    const spin = new THREE.Vector3();
    const aim = new THREE.Vector3();
    const kind = this.throwKind;
    const t = this.tune;
    // High, so it comes down steeply onto the ring rather than skating in
    // flat and short — and at range that is a long, readable flight; up
    // close a short one
    const lobT = (x: number, z: number) => THREE.MathUtils.clamp(1.0 + Math.hypot(x - p0.x, z - p0.z) / 38, 1.15, 2.5);
    if (this.scriptedThrow) {
      // The cutscene's: exactly where it was asked to come down
      aim.copy(this.throwAt);
      const T = lobT(aim.x, aim.z);
      vel.copy(aim).sub(p0).divideScalar(T);
      vel.y += 0.5 * g * T;
    } else if (kind === 'lob') {
      let T = lobT(this.tgtPos.x, this.tgtPos.z);
      aim.copy(this.tgtPos).addScaledVector(this.tgtVel, T * t.lead);
      T = lobT(aim.x, aim.z);
      aim.copy(this.tgtPos).addScaledVector(this.tgtVel, T * t.lead);
      this.scatter(aim, t.scatter);
      vel.copy(aim).sub(p0).divideScalar(T);
      vel.y += 0.5 * g * T;
    } else if (kind === 'drive') {
      let T = Math.max(0.3, Math.hypot(this.tgtPos.x - p0.x, this.tgtPos.z - p0.z) / 28);
      aim.copy(this.tgtPos).addScaledVector(this.tgtVel, T * t.lead);
      T = Math.max(0.3, Math.hypot(aim.x - p0.x, aim.z - p0.z) / 28);
      aim.copy(this.tgtPos).addScaledVector(this.tgtVel, T * t.lead);
      this.scatter(aim, t.scatter * 0.5);
      // At his chest
      vel.copy(aim).sub(p0);
      vel.y += 1.1;
      vel.divideScalar(T);
      vel.y += 0.5 * g * T;
    } else {
      const T = Math.hypot(this.tgtPos.x - p0.x, this.tgtPos.z - p0.z) / 20;
      aim.copy(this.tgtPos).addScaledVector(this.tgtVel, T * t.lead);
      this.scatter(aim, t.scatter * 0.5);
      vel.set(aim.x - p0.x, 0, aim.z - p0.z);
      if (vel.lengthSq() < 1e-6) this.enemy.forwardDir(vel);
      vel.normalize().multiplyScalar(20);
      vel.y = 1.2;
    }
    // Spin about the car's length (which lies across the throw): forward
    // over the top, the way a wheel rolls toward where it is going
    _a.set(vel.x, 0, vel.z);
    if (_a.lengthSq() < 1e-6) this.enemy.forwardDir(_a);
    _a.normalize();
    spin.crossVectors(UP, _a);
    const wob = Math.random() < 0.5 ? -1 : 1;
    if (kind === 'bowl') spin.multiplyScalar(9).addScaledVector(_a, 0.4 * wob);
    else if (kind === 'drive') spin.multiplyScalar(3.2).addScaledVector(UP, 0.8 * wob);
    // A lob turns over only lazily, so it comes down near flat and on the ring
    else spin.multiplyScalar(0.45 + Math.random() * 0.35).addScaledVector(UP, 0.5 * wob);
    this.world.launch(id, vel, spin, this.scriptedThrow ? 'lob' : kind, aim);
    this.carHeld = -1;
    this.nextReleaseAt = this.time + t.cycle;
    this.repositioned = false;
    if (!this.scriptedThrow) this.throwsSince++;
    this.emit({ type: 'throw', carId: id, kind: this.scriptedThrow ? 'lob' : kind, aim: aim.clone() });
  }

  /** Off somewhere within `r` of where it was, evenly over the disc. */
  private scatter(p: THREE.Vector3, r: number): void {
    const d = r * Math.sqrt(Math.random());
    const a = Math.random() * TAU;
    p.x += Math.cos(a) * d;
    p.z += Math.sin(a) * d;
  }

  /** Let go of the car without throwing it: tipped off forward, clear of his head, the CarSystem's physics from there. */
  private dropCar(): void {
    const id = this.carHeld;
    if (id < 0) return;
    const f = this.enemy.forwardDir(new THREE.Vector3());
    const vel = f.clone().multiplyScalar(5);
    vel.y = 2.5;
    const spin = new THREE.Vector3().crossVectors(UP, f).multiplyScalar(1.5);
    const aim = this.carOriginW.clone().addScaledVector(f, 2.5);
    aim.y = 0;
    this.world.launch(id, vel, spin, 'lob', aim);
    this.carHeld = -1;
    this.grabPending = false;
  }

  // ===================================================================== actions

  private beginIdle(dur: number): void {
    this.begin('idle', dur, 0.45);
    this.enemy.poseCurl = 0.8;
  }

  private beginWalk(why: WalkFor): void {
    this.walkFor = why;
    const d = this.flatDist(this.walkTo);
    this.walkLimit = d / 0.8 + 5;
    this.begin('walk', Infinity, 0.3);
    this.enemy.poseCurl = 0.75;
  }

  private beginPound(d: number): void {
    this.begin('pound', d, 0.3);
    this.enemy.poseCurl = 1;
    // The first fist lands a beat after the arms come up
    this.prevUR = this.prevUL = 0;
  }

  private beginRoar(d: number): void {
    this.begin('roar', d, 0.3);
    this.enemy.poseCurl = 1;
    this.emit({ type: 'roar' });
  }

  private beginPhaseShow(): void {
    this.pendingPhase = false;
    this.phaseShow = true;
    this.beginPound(2.4);
  }

  private beginStomp(): void {
    this.stomped = false;
    this.footSpot(1, 0.85, this.stompAt);
    this.emit({ type: 'stompWarn', pos: this.stompAt.clone() });
    this.begin('stomp', 1.45, 0.25);
    this.enemy.poseCurl = 1;
  }

  private beginStagger(): void {
    this.endSpecial();
    if (this.carHeld >= 0) this.dropCar();
    // Whatever he was going to do with it, he isn't now
    if (this.act === 'reach' || this.act === 'lift') this.carId = -1;
    this.staggerFrom.copy(this.enemy.position);
    this.emit({ type: 'stagger' });
    this.begin('stagger', 0.9, 0.12);
    this.enemy.poseCurl = 0.5;
  }

  /**
   * Head down, a hoof scraping the ground: the tell before every run. The
   * line he will run down goes onto the ground as he starts.
   */
  private beginPaw(): void {
    this.begin('paw', this.rushing ? RUSH_PAW : PAW_TIME, 0.25);
    this.enemy.poseCurl = 1;
    this.lineShown = true;
    this.lineLocked = false;
    this.lineBack = false;
    this.planRun();
    this.emit({ type: 'chargeWarn', pos: this.enemy.position.clone(), at: this.tgtPos.clone() });
  }

  /**
   * Where the run goes from here: at Ravi and on past him, a rush only as
   * far as the lot (it pulls up short of the fence) and the enraged charge
   * on into it if that is where it leads. The line shows it, stopping at the
   * fence either way.
   */
  private planRun(): void {
    const p = this.enemy.position;
    this.chargeDir.set(this.tgtPos.x - p.x, 0, this.tgtPos.z - p.z);
    const d = this.chargeDir.length();
    if (d < 0.01) this.enemy.forwardDir(this.chargeDir).setY(0);
    this.chargeDir.normalize();
    const edge = this.toEdge(p, this.chargeDir, 1.6);
    this.chargeLeft = this.rushing ? Math.min(d + RUSH_OVERSHOOT, edge) : Math.min(70, d + OVERSHOOT);
    const shown = Math.min(this.chargeLeft, edge);
    this.line.from.set(p.x, 0, p.z);
    this.line.to.set(p.x + this.chargeDir.x * shown, 0, p.z + this.chargeDir.z * shown);
  }

  /** Off, down the line. */
  private beginCharge(): void {
    if (!this.lineLocked) this.planRun();
    this.lineLocked = true;
    this.chargeSpeed = 2;
    this.trampled = false;
    this.begin('charge', Infinity, 0.2);
    this.enemy.poseCurl = 1;
    this.emit({ type: 'charge', dir: this.chargeDir.clone() });
  }

  /**
   * The run: flat out down the line he showed, no turning off it. Cars in
   * the way go flying; Ravi in the way goes under him. He stops a way past
   * where Ravi was, or at the edge of the lot.
   */
  private stepCharge(dt: number): void {
    const e = this.enemy;
    const p = e.position;
    e.yaw = Math.atan2(-this.chargeDir.x, -this.chargeDir.z);
    e.root.rotation.y = e.yaw;
    this.chargeSpeed = Math.min(CHARGE_SPEED, this.chargeSpeed + CHARGE_ACCEL * dt);
    const v = this.chargeSpeed;
    this.walkW = 1;
    this.cadence = 2.1 * (0.4 + 0.6 * (v / CHARGE_SPEED));
    const step = Math.min(v * dt, Math.max(0, this.chargeLeft));
    p.addScaledVector(this.chargeDir, step);
    this.chargeLeft -= step;
    this.line.from.set(p.x, 0, p.z);
    this.ramAndTrample(v);
    // The edge of the lot pulls him up hard; the end of the run, gently
    const A = this.world.arena ?? this.zone;
    const m = 1.6;
    const out = p.x < A.minX + m || p.x > A.maxX - m || p.z < A.minZ + m || p.z > A.maxZ - m;
    if (out) {
      p.x = THREE.MathUtils.clamp(p.x, A.minX + m, A.maxX - m);
      p.z = THREE.MathUtils.clamp(p.z, A.minZ + m, A.maxZ - m);
      this.beginSkid(v > 8);
    } else if (this.chargeLeft <= 0) this.beginSkid(false);
  }

  /** At speed, his front through the cars and over Ravi. */
  private ramAndTrample(v: number): void {
    const p = this.enemy.position;
    // Through the cars: his front, at bumper height
    if (this.world.ram) {
      _b.copy(p).addScaledVector(this.chargeDir, 0.9 * S).setY(p.y + 0.8);
      const n = this.world.ram(_b, this.chargeDir, v, RAM_R);
      if (n > 0) {
        this.emit({ type: 'ram', pos: _b.clone(), count: n });
        // Every car costs him a little speed, never all of it
        this.chargeSpeed *= Math.pow(0.82, n);
      }
    }
    // Ravi: run down — the end of him, once he's enraged
    if (!this.trampled && this.tgtAlive && v > 5 && this.flatDist(this.tgtPos) < TRAMPLE_R && this.tgtPos.y < p.y + 2.2) {
      this.trampled = true;
      this.emit({ type: 'trample', from: p.clone().addScaledVector(this.chargeDir, -1.2), dir: this.chargeDir.clone(), lethal: this.enraged });
    }
  }

  private beginSkid(crashed: boolean): void {
    this.skidCrashed = crashed;
    this.lineShown = false;
    if (crashed) this.chargeSpeed = Math.min(this.chargeSpeed, 3);
    this.begin('skid', this.rushing ? (crashed ? 1.5 : 0.9) : crashed ? 2.3 : 1.4, 0.15);
    this.enemy.poseCurl = 0.6;
    this.emit({ type: 'skid', pos: this.enemy.position.clone(), crashed });
  }

  /**
   * Digging his heels in, sliding to a stop; then round to face Ravi for the
   * next one — or, after a rush, round toward home, with the line back there
   * going down on the ground.
   */
  private stepSkid(dt: number): void {
    const p = this.enemy.position;
    if (this.chargeSpeed > 0) {
      this.chargeSpeed = Math.max(0, this.chargeSpeed - 26 * dt);
      p.addScaledVector(this.chargeDir, this.chargeSpeed * dt);
      const A = this.world.arena ?? this.zone;
      p.x = THREE.MathUtils.clamp(p.x, A.minX + 1.6, A.maxX - 1.6);
      p.z = THREE.MathUtils.clamp(p.z, A.minZ + 1.6, A.maxZ - 1.6);
    }
    // Shaking it off, then coming round
    const turnFrom = this.rushing ? (this.skidCrashed ? 0.8 : 0.25) : this.skidCrashed ? 1.3 : 0.5;
    if (this.actT > turnFrom) {
      const at = this.rushing ? this.home : this.tgtPos;
      const err = this.turnToward(at.x, at.z, dt, this.rushing ? 4 : 2.2, 5);
      if (Math.abs(err) > 0.4) {
        this.walkW = 0.32;
        this.cadence = this.cadenceFor(this.tune.walk) * 1.4;
      }
    }
    if (this.rushing && this.actT > turnFrom && this.flatDist(this.home) > 0.8) {
      this.lineShown = true;
      this.lineLocked = true;
      this.lineBack = true;
      this.line.from.set(p.x, 0, p.z);
      this.line.to.set(this.home.x, 0, this.home.z);
    }
    if (this.actT >= this.actDur) this.endAct();
  }

  /** Back where he came from, as fast as he went: the rush is over, and the cars are waiting. */
  private beginReturn(): void {
    const p = this.enemy.position;
    this.chargeDir.set(this.home.x - p.x, 0, this.home.z - p.z);
    const d = this.chargeDir.length();
    if (d < 0.8) {
      this.finishRush();
      return;
    }
    this.chargeDir.divideScalar(d);
    this.chargeLeft = d;
    this.chargeSpeed = 2;
    this.trampled = false;
    this.lineShown = true;
    this.lineLocked = true;
    this.lineBack = true;
    this.begin('return', Infinity, 0.2);
    this.enemy.poseCurl = 1;
  }

  /** Flat out home, coming round to face it as he goes, and pulling up on the spot. */
  private stepReturn(dt: number): void {
    const p = this.enemy.position;
    const err = this.turnToward(this.home.x, this.home.z, dt, 7, 12);
    const brake = Math.sqrt(2 * 22 * Math.max(0, this.chargeLeft)) + 1;
    const accel = Math.abs(err) < 0.6 ? CHARGE_ACCEL : CHARGE_ACCEL * 0.3;
    this.chargeSpeed = Math.min(CHARGE_SPEED, brake, this.chargeSpeed + accel * dt);
    const v = this.chargeSpeed;
    this.walkW = 1;
    this.cadence = 2.1 * (0.4 + 0.6 * (v / CHARGE_SPEED));
    const step = Math.min(v * dt, this.chargeLeft);
    p.addScaledVector(this.chargeDir, step);
    this.chargeLeft -= step;
    this.line.from.set(p.x, 0, p.z);
    this.ramAndTrample(v);
    if (this.chargeLeft <= 0.02) this.finishRush();
  }

  private finishRush(): void {
    this.rushing = false;
    this.lineShown = false;
    this.throwsSince = 0;
    this.emit({ type: 'specialDone' });
    // A breath, squaring up to Ravi; then the cars again
    this.beginIdle(0.5);
  }

  /** Whatever special he was in the middle of, he isn't now: no line on the ground, the launcher back over his shoulder. */
  private endSpecial(): void {
    const a = this.act;
    const was = this.rushing || a === 'shoulder' || a === 'barrage' || a === 'unshoulder' || a === 'return';
    this.rushing = false;
    this.lineShown = false;
    if (was) this.emit({ type: 'specialDone' });
  }

  /** How far from `p` along `dir` (flat, unit) to the lot's edge, `m` in from it. */
  private toEdge(p: THREE.Vector3, dir: THREE.Vector3, m: number): number {
    const A = this.world.arena ?? this.zone;
    let t = Infinity;
    if (dir.x > 1e-6) t = Math.min(t, (A.maxX - m - p.x) / dir.x);
    else if (dir.x < -1e-6) t = Math.min(t, (A.minX + m - p.x) / dir.x);
    if (dir.z > 1e-6) t = Math.min(t, (A.maxZ - m - p.z) / dir.z);
    else if (dir.z < -1e-6) t = Math.min(t, (A.minZ + m - p.z) / dir.z);
    return Math.max(0, t);
  }

  // ------------------------------------------------------------- the rockets

  private sweepDur = 2;

  /**
   * The launcher off his back: the sweep goes from one corner of the lot
   * round to the next, across whichever side of it Ravi is in — so it
   * passes over him wherever he is — starting from the corner further round
   * from him, so he has the most time to get behind something.
   */
  private beginRockets(): void {
    const A = this.world.arena ?? this.zone;
    const p = this.enemy.position;
    const cs: [number, number][] = [
      [A.minX, A.minZ],
      [A.maxX, A.minZ],
      [A.maxX, A.maxZ],
      [A.minX, A.maxZ]
    ];
    const yawTo = (x: number, z: number): number => Math.atan2(-(x - p.x), -(z - p.z));
    const yr = yawTo(this.tgtPos.x, this.tgtPos.z);
    let ia = -1;
    for (let i = 0; i < 4; i++) {
      const a = yawTo(cs[i][0], cs[i][1]);
      const j = (i + 1) % 4;
      const d = wrap(yawTo(cs[j][0], cs[j][1]) - a);
      const r = wrap(yr - a);
      if (d >= 0 ? r >= 0 && r <= d : r <= 0 && r >= d) {
        ia = i;
        break;
      }
    }
    let from: THREE.Vector3;
    let to: THREE.Vector3;
    if (ia < 0) {
      // (Outside the lot? Then just across him.)
      this.sweepFrom = wrap(yr - 0.7);
      this.sweepBy = 1.4;
      from = new THREE.Vector3(p.x - Math.sin(this.sweepFrom) * 30, 0, p.z - Math.cos(this.sweepFrom) * 30);
      to = new THREE.Vector3(p.x - Math.sin(yr + 0.7) * 30, 0, p.z - Math.cos(yr + 0.7) * 30);
    } else {
      let i0 = ia;
      let i1 = (ia + 1) % 4;
      const y0 = yawTo(cs[i0][0], cs[i0][1]);
      const y1 = yawTo(cs[i1][0], cs[i1][1]);
      if (Math.abs(wrap(yr - y0)) < Math.abs(wrap(y1 - yr))) {
        const k = i0;
        i0 = i1;
        i1 = k;
      }
      this.sweepFrom = yawTo(cs[i0][0], cs[i0][1]);
      this.sweepBy = wrap(yawTo(cs[i1][0], cs[i1][1]) - this.sweepFrom);
      from = new THREE.Vector3(cs[i0][0], 0, cs[i0][1]);
      to = new THREE.Vector3(cs[i1][0], 0, cs[i1][1]);
    }
    this.sweepDur = THREE.MathUtils.clamp(Math.abs(this.sweepBy) / SWEEP_RATE, SWEEP_MIN, SWEEP_MAX);
    this.begin('shoulder', SHOULDER_TIME, 0.3);
    this.enemy.poseCurl = 1;
    this.emit({ type: 'rocketWarn', from, to });
  }

  /** The launcher's pitch: down at a man's knees at Ravi's range. */
  private aimAt(dt: number): void {
    const d = Math.max(6, this.flatDist(this.tgtPos));
    const want = -Math.atan2(2.9 - ROCKET_AT_H, d);
    this.aimPitch += (want - this.aimPitch) * Math.min(1, dt * 6);
  }

  /**
   * One rocket, out of the next of the four tubes along where the launcher
   * points now, at knee height at Ravi's range (or the fence, if that is
   * nearer) and on into the ground beyond: whatever he is behind takes it.
   */
  private fireRocket(): void {
    const e = this.enemy;
    const p = e.position;
    const fx = -Math.sin(e.yaw);
    const fz = -Math.cos(e.yaw);
    const i = this.rocketN++ % 4;
    const m = new THREE.Vector3((i & 1 ? 1 : -1) * 0.05, (i & 2 ? 1 : -1) * 0.05, -0.5).applyMatrix4(this.launcher.matrix);
    _c.set(fx, 0, fz);
    const d = THREE.MathUtils.clamp(this.flatDist(this.tgtPos), 6, Math.max(6, this.toEdge(p, _c, 0.3)));
    const aim = _a.set(p.x + fx * d, ROCKET_AT_H, p.z + fz * d);
    this.scatter(aim, 0.6);
    const dir = aim.sub(m).normalize();
    this.recoil = 1;
    this.emit({ type: 'rocket', pos: m, dir: dir.clone(), speed: ROCKET_SPEED });
  }

  /**
   * Where the launcher is: across his back, off the chest so it leans and
   * turns with him; on his right shoulder, aimed down the sweep; or on its
   * way between, up over the shoulder. Placed from the pose he has just
   * been given, so it rides him exactly.
   */
  private placeLauncher(dt: number): void {
    const a = this.act;
    const u = this.actDur > 0 && this.actDur < Infinity ? clamp01(this.actT / this.actDur) : 0;
    if (a === 'shoulder') this.lnch = seg(u, 0.25, 0.75);
    else if (a === 'barrage') this.lnch = 1;
    else if (a === 'unshoulder') this.lnch = 1 - seg(u, 0.05, 0.6);
    else this.lnch = Math.max(0, this.lnch - dt * 3);
    const chest = this.enemy.chest;
    chest.updateWorldMatrix(true, false);
    const m = this.launcher.matrix;
    m.multiplyMatrices(chest.matrixWorld, this.backSeat);
    if (this.lnch > 0.001) {
      const k = smooth(this.lnch);
      m.decompose(_p1, _q1, _s1);
      this.shoulderSeat(this.cur, _p2, _q2);
      _p1.lerp(_p2, k);
      _p1.y += Math.sin(Math.PI * k) * 0.3 * S;
      _q1.slerp(_q2, k);
      m.compose(_p1, _q1, _s1.setScalar(S));
    }
    this.launcher.matrixWorldNeedsUpdate = true;
  }

  /** The launcher on his right shoulder for shape `o`, aimed by aimPitch: world position and rotation. */
  private shoulderSeat(o: Shape, pos: THREE.Vector3, q: THREE.Quaternion): void {
    this.shoulder(1, o, _p3);
    _p3.x -= 0.07;
    _p3.y += 0.15 + 0.015 * this.recoil;
    _p3.z += 0.02 + 0.06 * this.recoil;
    this.toWorld(_p3, pos);
    q.setFromAxisAngle(UP, this.enemy.yaw).multiply(_q3.setFromAxisAngle(X_AXIS, this.aimPitch + 0.05 * this.recoil));
  }

  /** A point on the launcher (its own frame), as it was last placed, in his body frame. */
  private onLauncher(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return this.toBody(_p3.set(x, y, z).applyMatrix4(this.launcher.matrix), out);
  }

  private beginDeath(): void {
    this.endSpecial();
    if (this.carHeld >= 0) this.dropCar();
    this.dying = true;
    this.scriptedThrow = false;
    this.phaseShow = false;
    this.pendingPhase = false;
    this.deathFrom.copy(this.enemy.position);
    this.deathYaw = this.enemy.yaw;
    this.deathStage = 0;
    this.begin('death', Infinity, 0.15);
    this.enemy.poseCurl = 0.45;
  }

  /** Walking: turn toward where he is going and stride there, his feet keeping pace with the ground. */
  private stepWalk(dt: number): void {
    const p = this.enemy.position;
    const dx = this.walkTo.x - p.x;
    const dz = this.walkTo.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.06 || this.actT > this.walkLimit) {
      this.endAct();
      return;
    }
    const speed = this.walkFor === 'script' ? TUNE[1].walk : this.tune.walk;
    this.cadence = this.cadenceFor(speed);
    const pace = Math.sqrt(this.walkFor === 'script' ? 1 : this.tune.pace);
    const ae = Math.abs(wrap(Math.atan2(-dx, -dz) - this.enemy.yaw));
    const err = this.turnToward(this.walkTo.x, this.walkTo.z, dt, (ae > 0.6 ? 2.4 : 1.6) * pace, 4);
    // A shuffle while he comes round, a short stride as he straightens up,
    // full strides once he is pointed at it, and shortening them coming in
    // to stop
    let w = Math.abs(err) > 1 ? 0.32 : Math.abs(err) > 0.5 ? 0.6 : 1;
    if (dist < 0.9) w = Math.min(w, Math.max(0.45, dist / 0.9));
    this.walkW = w;
    this.moving = true;
    this.moveDir.set(dx / dist, 0, dz / dist);
    this.moveLeft = dist;
  }

  private arrive(): void {
    switch (this.walkFor) {
      case 'car':
        this.beginReach();
        return;
      case 'script':
        this.beginIdle(Infinity);
        return;
      default:
        this.decide();
    }
  }

  /**
   * The Enemy's walk cycle, run alongside it with the same sums in the same
   * order so it comes out the same to the last bit: the stride easing in and
   * out, the phase turning over at the cadence. With those known, his body
   * is carried forward at exactly the speed the planted foot goes back —
   * no sliding — and the sway and bob it gives his shoulders are known
   * before the rig is posed.
   */
  private mirrorWalk(dt: number): void {
    this.sb += (this.walkW - this.sb) * Math.min(1, dt * 6);
    if (this.walkW > 0.05 || this.sb > 0.02) this.phaseW += dt * 7.5 * (0.5 + this.walkW) * this.cadence;
    if (this.moving) {
      const v = 2 * LEG * Math.sin(SWING * this.sb) * ((7.5 * (0.5 + this.walkW) * this.cadence) / Math.PI) * S;
      const d = Math.min(v * dt, this.moveLeft);
      this.enemy.position.addScaledVector(this.moveDir, d);
    }
  }

  /** A foot has come down (from the Enemy's walk): where, and how hard. */
  private footfall(side: 'l' | 'r'): void {
    if (this.dying) return;
    _a.set((side === 'l' ? -1 : 1) * HIP_X, 0, -LEG * Math.sin(SWING * this.sb));
    const pos = this.toWorld(_a, new THREE.Vector3());
    pos.y = this.enemy.position.y;
    this.emit({ type: 'step', pos, heavy: this.walkW >= 0.6 });
  }

  /** Where a planted foot is on the ground, in a stance this wide (side +1 right). */
  private footSpot(side: number, stance: number, out: THREE.Vector3): THREE.Vector3 {
    _b.set(side * (HIP_X + LEG * Math.tan(0.2 * stance)), 0, -0.03);
    this.toWorld(_b, out);
    out.y = this.enemy.position.y;
    return out;
  }

  /** Where he turns to, standing about: Ravi in the fight, the cutscene's point in a script. */
  private facePoint(): THREE.Vector3 | null {
    if (this.mode === 'fight' && !this.scriptedThrow && this.tgtSeen) return this.tgtPos;
    return this.hasAt ? this.atPoint : null;
  }

  /** The neck's share of looking: at Ravi, at the cutscene's point, at the car he is reaching for, or ahead. */
  private look(dt: number): void {
    const e = this.enemy;
    const p = e.position;
    let at: THREE.Vector3 | null = null;
    const a = this.act;
    const scripted = this.mode === 'script' || this.scriptedThrow;
    if (a === 'reach') at = this.grabW;
    else if (this.scriptedThrow && (a === 'aim' || a === 'windup' || a === 'release')) at = this.throwAt;
    else if (this.mode === 'script' && this.hasAt) at = this.atPoint;
    else if (scripted && a === 'walk') at = null;
    else if (this.tgtSeen) at = this.lookPt.copy(this.tgtPos).setY(this.tgtPos.y + 1.5);
    let wy = 0;
    let wp = 0;
    if (at) {
      const dx = at.x - p.x;
      const dz = at.z - p.z;
      const h = Math.hypot(dx, dz);
      if (h > 0.4) {
        wy = THREE.MathUtils.clamp(wrap(Math.atan2(-dx, -dz) - e.yaw), -1.1, 1.1);
        const eye = p.y + (HEAD_Y - hipsDown(this.cur.crouch, this.cur.stance)) * S;
        wp = THREE.MathUtils.clamp(Math.atan2(at.y - eye, h), -0.75, 0.55);
      }
    }
    // Walking with nothing to watch, eyes on where he is going
    if (!at && this.act === 'walk') wy = wp = 0;
    const k = Math.min(1, dt * 4);
    this.lookY += (wy - this.lookY) * k;
    this.lookP += (wp - this.lookP) * k;
  }

  /** Turn his whole body toward a point, a heavy man's turn: proportional, but never faster than maxRate. Returns what is left. */
  private turnToward(x: number, z: number, dt: number, maxRate: number, k: number): number {
    const e = this.enemy;
    const dx = x - e.position.x;
    const dz = z - e.position.z;
    if (dx * dx + dz * dz < 0.09) return 0;
    const err = wrap(Math.atan2(-dx, -dz) - e.yaw);
    const step = THREE.MathUtils.clamp(err * Math.min(1, k * dt), -maxRate * dt, maxRate * dt);
    e.yaw = wrap(e.yaw + step);
    e.root.rotation.y = e.yaw;
    return err - step;
  }

  // ===================================================================== shapes

  /** What the action wants him to look like this frame. */
  private shape(o: Shape): void {
    switch (this.act) {
      case 'idle':
        this.idleShape(o);
        break;
      case 'walk':
        this.walkShape(o);
        break;
      case 'pound':
        this.poundShape(o);
        break;
      case 'roar':
        this.roarShape(o);
        break;
      case 'point':
        this.pointShape(o);
        break;
      case 'reach':
        this.reachShape(o);
        break;
      case 'lift':
        this.liftShape(o);
        break;
      case 'aim':
        this.aimShape(o);
        break;
      case 'windup':
        this.windupShape(o);
        break;
      case 'release':
        this.releaseShape(o);
        break;
      case 'follow':
        this.followShape(o);
        break;
      case 'stomp':
        this.stompShape(o);
        break;
      case 'stagger':
        this.staggerShape(o);
        break;
      case 'paw':
        this.pawShape(o);
        break;
      case 'charge':
        this.chargeShape(o);
        break;
      case 'skid':
        this.skidShape(o);
        break;
      case 'return':
        this.chargeShape(o);
        break;
      case 'shoulder':
      case 'barrage':
      case 'unshoulder':
        this.rocketShape(o);
        break;
      case 'death':
        this.deathShape(o);
        break;
    }
  }

  /**
   * Stood his ground: feet set wide, knees soft, the arms standing off his
   * sides with the fists loosely closed, and breathing like a bull — a slow,
   * deep heave of the chest every three seconds, the mouth coming open on
   * the breath out. The head follows whatever he is watching.
   */
  private idleShape(o: Shape): void {
    const br = Math.sin(this.time * 2);
    const sh = this.shuf;
    // Out of the stance quickly as a shuffle starts, so the feet are free
    // to step by the time they do
    const planted = Math.max(0, 1 - 1.4 * sh);
    o.stance = 0.75 * planted;
    o.crouch = (0.12 + 0.025 * br) * planted;
    o.twist = 0;
    o.liftL = o.liftR = 0;
    o.carPitch = 0;
    const dn = hipsDown(o.crouch, o.stance);
    o.arms(0.43, 0.9 - dn + 0.012 * br, -0.06);
    o.elbow.set(0.8, -0.3, 0.5);
    o.lean = -0.03 + 0.035 * br;
    o.headP = this.lookP + 0.03 * br;
    o.headY = this.lookY;
    o.headR = 0;
    o.roar = 0.06 + 0.06 * Math.max(0, -br);
  }

  /**
   * Giant strides: the legs are the Enemy's walk (the pose leaves them alone
   * with no squat or stance), the arms swung against them — right arm with
   * the left leg — and the shoulders turning a little against the hips.
   */
  private walkShape(o: Shape): void {
    const sw = Math.sin(this.phaseW) * this.sb;
    const lift = Math.abs(Math.sin(this.phaseW)) * 0.02 * this.sb;
    o.stance = 0;
    o.crouch = 0;
    o.liftL = o.liftR = 0;
    o.carPitch = 0;
    o.hR.set(0.44, 0.88 - lift, -0.17 * sw);
    o.hL.set(-0.44, 0.88 - lift, 0.17 * sw);
    o.elbow.set(0.8, -0.3, 0.5);
    o.lean = -0.07;
    o.twist = 0.07 * sw;
    o.headP = this.lookP;
    o.headY = this.lookY;
    o.headR = 0;
    o.roar = 0.05;
  }

  /**
   * The gorilla's chest-beat. Feet planted wide and the knees bent, chest
   * thrown out and the head up and back, elbows flared high and wide, and
   * the fists driving alternately into his chest — each at 2 Hz, so a blow
   * lands every quarter second. Each fist accelerates into the hit and comes
   * off it slower, back out to the wind-out point; the chest twists into
   * every blow (the right fist's turns him left) so he rocks side to side
   * with it, and the targets turn with the chest, so it is the chest each
   * fist lands on. The face is half open, a bark at every blow.
   */
  private poundShape(o: Shape): void {
    const t = this.actT;
    const uR = (((t - 0.3) * 2 + 0.32) % 1 + 1) % 1;
    const uL = (uR + 0.5) % 1;
    const tw = 0.12 * Math.cos(TAU * (uR - 0.32));
    o.stance = 1;
    o.crouch = 0.26 + 0.03 * Math.cos(TAU * 2 * (uR - 0.32));
    o.liftL = o.liftR = 0;
    o.carPitch = 0;
    o.lean = 0.1;
    o.twist = tw;
    const dn = hipsDown(o.crouch, o.stance);
    const bk = hipsBack(o.crouch, o.stance);
    this.fist(o.hR, uR, 1, dn, bk, tw);
    this.fist(o.hL, uL, -1, dn, bk, tw);
    o.elbow.set(1, 0.45, 0.15);
    o.headP = 0.38;
    o.headY = this.lookY * 0.4;
    o.headR = 0.05 * Math.sin(TAU * (uR - 0.32));
    // A blow lands as a fist's phase passes the contact point (not in the
    // first moment, while the arms are still coming up)
    if (t > 0.15) {
      if (this.prevUR < 0.32 && uR >= 0.32) this.landPound();
      if (this.prevUL < 0.32 && uL >= 0.32) this.landPound();
    }
    this.prevUR = uR;
    this.prevUL = uL;
    o.roar = 0.5 + 0.3 * Math.exp(-this.sincePound * 8);
  }

  private landPound(): void {
    this.sincePound = 0;
    this.emit({ type: 'pound', i: this.pounds++ });
  }

  /** One fist of the chest-beat: wind-out to the chest (accelerating) by 0.32 of its cycle, then back out. */
  private fist(out: THREE.Vector3, u: number, side: number, dn: number, bk: number, tw: number): void {
    // The chest's front is about 0.16 in front of the spine at the
    // pectorals (the General is built out there), plus the fist itself
    _a.set(side * 0.34, 1.5 - dn, -0.42 + bk); // wound out, high and wide
    _b.set(side * 0.1, 1.31 - dn, -0.2 + bk); // on the chest
    if (u < 0.32) out.lerpVectors(_a, _b, easeIn(u / 0.32));
    else out.lerpVectors(_b, _a, easeOut((u - 0.32) / 0.68));
    // Turned with the chest, about the spine (pose.twist's own rotation)
    const c = Math.cos(tw);
    const s = Math.sin(tw);
    const x = out.x;
    const z = out.z - bk;
    out.x = x * c + z * s;
    out.z = bk - x * s + z * c;
  }

  /**
   * The roar: head flung back to the sky, chest out, arms spread wide and
   * down with the fists clenched and shaking, the jaw as wide as it goes.
   */
  private roarShape(o: Shape): void {
    const u = this.actT / this.actDur;
    const tr = 0.008 * Math.sin(this.time * 31);
    o.stance = 0.95;
    o.crouch = 0.2;
    o.liftL = o.liftR = 0;
    o.twist = 0;
    o.carPitch = 0;
    const dn = hipsDown(o.crouch, o.stance);
    o.hR.set(0.78, 1.04 - dn + tr, -0.06);
    o.hL.set(-0.78, 1.04 - dn - tr, -0.06);
    o.elbow.set(1, -0.2, 0.4);
    o.lean = 0.22;
    o.headP = 0.6;
    o.headY = this.lookY * 0.3;
    o.headR = 0.04 * Math.sin(this.time * 7);
    o.roar = lerp(1, 0.25, seg(u, 0.8, 1));
  }

  /** The right arm out straight at it, the rest of him stood as he stands. */
  private pointShape(o: Shape): void {
    this.idleShape(o);
    o.stance = 0.6;
    o.lean = -0.05;
    const at = this.hasAt ? this.atPoint : this.lookPt.copy(this.tgtPos).setY(this.tgtPos.y + 1.2);
    const sh = this.shoulder(1, o, _b);
    this.toBody(at, _a).sub(sh);
    if (_a.lengthSq() < 1e-6) _a.set(0, 0, -1);
    o.hR.copy(sh).addScaledVector(_a.normalize(), 0.58);
    o.elbow.set(0.2, -1, 0);
  }

  /**
   * Down to the car: squatting as low as its height needs, leaning in over
   * it, the hands open and going to its edge on his side either side of
   * where he faces. The whole reach is one ease from wherever he was.
   */
  private reachShape(o: Shape): void {
    const gb = this.toBody(this.grabW, _a);
    o.crouch = THREE.MathUtils.clamp((1.2 - gb.y) / 0.62, 0.15, 1);
    o.stance = 0.55;
    o.lean = -THREE.MathUtils.clamp((1.3 - gb.y) * 0.85, 0.1, 0.62);
    o.twist = 0;
    o.liftL = o.liftR = 0;
    o.carPitch = 0;
    o.hR.set(gb.x + 0.28, gb.y, gb.z);
    o.hL.set(gb.x - 0.28, gb.y, gb.z);
    o.elbow.set(0.9, -0.3, 0.1);
    o.headP = this.lookP;
    o.headY = this.lookY;
    o.headR = 0;
    o.roar = 0.15;
  }

  /**
   * The heave. Three pulls, each eased to a moment's check at the end —
   * ripped up off the ground to the front of his chest as he stands out of
   * the squat; driven up in front of his face as he gets his palms under it
   * (the car rides up onto them: e1); then pressed up and back over his
   * head to lock out, the car coming in over him and turning across him as
   * it goes (e2) — but only once it is up on his palms, and with a jerk
   * that sends it up off them while it swings round and comes in, to land
   * back on his locked-out arms: held by its end, a car's length would
   * otherwise pass through his cap on the way.
   */
  private liftShape(o: Shape): void {
    const u = this.actT / this.actDur;
    const f = this.from;
    const [k1, k2] = LIFT_KNOTS;
    const k4 = (a: number, b: number, c: number, d: number): number =>
      u < k1 ? lerp(a, b, smooth(u / k1)) : u < k2 ? lerp(b, c, smooth((u - k1) / (k2 - k1))) : lerp(c, d, smooth((u - k2) / (1 - k2)));
    // A wreck taken off the top of the pile is already up at his chest or
    // over it: it isn't dragged down to be lifted up again
    const fy = (f.hR.y + f.hL.y) / 2;
    const k1y = Math.max(LIFT_K1.y, fy);
    const k2y = Math.max(LIFT_K2.y, k1y);
    if (u < k1) {
      const s = smooth(u / k1);
      o.hR.lerpVectors(f.hR, _a.set(LIFT_K1.x, k1y, LIFT_K1.z), s);
      o.hL.lerpVectors(f.hL, _a.set(-LIFT_K1.x, k1y, LIFT_K1.z), s);
    } else if (u < k2) {
      const s = smooth((u - k1) / (k2 - k1));
      o.hR.set(lerp(LIFT_K1.x, LIFT_K2.x, s), lerp(k1y, k2y, s), lerp(LIFT_K1.z, LIFT_K2.z, s));
      o.hL.set(-o.hR.x, o.hR.y, o.hR.z);
    } else {
      // Up first, then back: the car only comes in over him once it is as
      // high as his arms will put it
      const s = (u - k2) / (1 - k2);
      o.hR.set(lerp(LIFT_K2.x, LIFT_K3.x, smooth(s)), lerp(k2y, LIFT_K3.y, easeOut(s)), lerp(LIFT_K2.z, LIFT_K3.z, smooth(easeIn(s))));
      o.hL.set(-o.hR.x, o.hR.y, o.hR.z);
    }
    o.crouch = k4(f.crouch, 0.35, 0.15, 0.04);
    o.stance = k4(f.stance, 0.8, 0.8, 0.75);
    o.lean = k4(f.lean, -0.08, 0.06, 0.05);
    o.twist = 0;
    o.liftL = o.liftR = 0;
    o.carPitch = 0;
    o.elbow.set(lerp(0.9, 1, u), lerp(-0.3, 0.1, u), lerp(0.1, 0.3, u));
    o.headP = this.lookP + 0.1 * seg(u, 0.4, 1);
    o.headY = this.lookY;
    o.headR = 0;
    o.roar = u < 0.15 ? lerp(f.roar, 0.65, u / 0.15) : u < 0.75 ? 0.65 : lerp(0.65, 0.3, (u - 0.75) / 0.25);
    this.carE1 = seg(u, 0.4, 0.68);
    this.carE2 = seg(u, 0.72, 1);
    // The jerk: driven up off his palms as he locks out, so it is in the air
    // above his cap while its length swings round and it comes in over him,
    // and caught on straight arms
    this.carToss = 0.7 * Math.sin(Math.PI * seg(u, 0.62, 1));
  }

  /** Locked out overhead, arms shaking under it, turning on Ravi. */
  private aimShape(o: Shape): void {
    const tr = 0.01 * Math.sin(this.time * 9);
    o.stance = 0.75;
    o.crouch = 0.03;
    o.twist = 0;
    o.liftL = o.liftR = 0;
    o.carPitch = 0;
    o.hR.set(0.3, 1.95 + tr, 0.03);
    o.hL.set(-0.3, 1.95 - tr, 0.03);
    o.elbow.set(1, 0.1, 0.3);
    o.lean = 0.05;
    o.headP = this.lookP;
    o.headY = this.lookY;
    o.headR = 0;
    o.roar = 0.25 + 0.08 * Math.sin(this.time * 5);
  }

  /**
   * The wind-up, 0.35 s: the telegraph. Overhead, the car drawn back over
   * his head and its roof tipped back, him leaning back under it. For a
   * bowl, the other way: tipped forward over its front, held out high in
   * front of him, ready to bring down.
   */
  private windupShape(o: Shape): void {
    o.twist = 0;
    o.liftL = o.liftR = 0;
    o.elbow.set(1, 0.2, 0.2);
    o.headY = this.lookY;
    o.headR = 0;
    o.roar = 0.55;
    if (this.throwKind === 'bowl') {
      o.arms(0.3, 1.75, -0.4);
      o.crouch = 0.12;
      o.stance = 0.85;
      o.lean = -0.08;
      o.carPitch = -1;
      o.headP = this.lookP;
    } else {
      o.arms(0.28, 1.84, 0.2);
      o.crouch = 0.1;
      o.stance = 0.85;
      o.lean = 0.28;
      o.carPitch = 0.35;
      o.headP = this.lookP - 0.05;
    }
  }

  /**
   * The throw. Overhead: a short, accelerating heave from behind his head
   * to out in front of it, arcing up over his cap on the way so the car
   * clears it, and let go at the end of it. Bowled: swung down in front of
   * him into a deep squat, the car going on over onto its side to roll.
   */
  private releaseShape(o: Shape): void {
    const u = this.actT / this.actDur;
    const f = this.from;
    o.twist = 0;
    o.liftL = o.liftR = 0;
    o.headY = this.lookY;
    o.headR = 0;
    o.roar = 0.95;
    if (this.throwKind === 'bowl') {
      const s = smooth(u);
      o.hR.lerpVectors(f.hR, _a.set(0.3, 0.74, -0.47), s);
      o.hL.lerpVectors(f.hL, _a.set(-0.3, 0.74, -0.47), s);
      const bulge = 0.08 * Math.sin(Math.PI * s);
      o.hR.z -= bulge;
      o.hL.z -= bulge;
      o.crouch = lerp(f.crouch, 0.85, s);
      o.stance = lerp(f.stance, 0.9, s);
      o.lean = lerp(f.lean, -0.25, s);
      o.carPitch = lerp(f.carPitch, -Math.PI / 2, s);
      o.elbow.set(1, -0.2, 0);
      o.headP = this.lookP;
    } else {
      const s = easeIn(u);
      const arc = 0.13 * Math.sin(Math.PI * s);
      o.hR.lerpVectors(f.hR, _a.set(0.28, 1.7, -0.42), s);
      o.hL.lerpVectors(f.hL, _a.set(-0.28, 1.7, -0.42), s);
      o.hR.y += arc;
      o.hL.y += arc;
      o.crouch = lerp(f.crouch, 0.2, s);
      o.stance = lerp(f.stance, 0.85, s);
      o.lean = lerp(f.lean, -0.2, s);
      o.carPitch = lerp(f.carPitch, -0.3, s);
      o.elbow.set(1, 0.1, 0.1);
      o.headP = this.lookP;
    }
  }

  /** Carried on through by his own weight, then gathering himself. */
  private followShape(o: Shape): void {
    const u = this.actT / this.actDur;
    o.twist = 0;
    o.liftL = o.liftR = 0;
    o.carPitch = 0;
    o.headP = this.lookP;
    o.headY = this.lookY;
    o.headR = 0;
    o.roar = lerp(0.6, 0.15, u);
    o.elbow.set(0.9, -0.2, 0.3);
    if (this.throwKind === 'bowl') {
      o.crouch = 0.7;
      o.stance = 0.9;
      o.lean = -0.3;
      const dn = hipsDown(o.crouch, o.stance);
      o.arms(0.36, 1.25 - dn, -0.48);
    } else {
      o.crouch = 0.35;
      o.stance = 0.85;
      o.lean = -0.4;
      const dn = hipsDown(o.crouch, o.stance);
      o.arms(0.33, 1.15 - dn, -0.48);
    }
  }

  /**
   * The stamp. Feet set wide, he leans back and brings the right knee up
   * high — arms out for his balance — over 0.7 s; then it comes down like a
   * pile driver, 0.1 s, accelerating, his weight dropping into a squat and
   * the arms coming down with it; and he straightens back up into his
   * stance.
   */
  private stompShape(o: Shape): void {
    const t = this.actT;
    o.twist = 0;
    o.liftL = 0;
    o.carPitch = 0;
    o.headY = this.lookY;
    o.headR = 0;
    if (t < 0.7) {
      const s = smooth(t / 0.7);
      o.stance = 0.85;
      o.crouch = 0.08;
      o.liftR = s;
      o.lean = 0.14 * s;
      o.arms(0.62, 1.5, -0.1);
      o.elbow.set(1, 0, 0.3);
      o.headP = this.lookP;
      o.roar = 0.35;
    } else if (t < 0.8) {
      const k = easeIn((t - 0.7) / 0.1);
      o.stance = 0.85;
      o.crouch = 0.08 + 0.37 * k;
      o.liftR = 1 - k;
      o.lean = 0.14 - 0.42 * k;
      const dn = hipsDown(o.crouch, o.stance);
      o.hR.set(lerp(0.62, 0.5, k), lerp(1.5, 1.05 - dn, k), lerp(-0.1, -0.3, k));
      o.hL.set(-o.hR.x, o.hR.y, o.hR.z);
      o.elbow.set(1, 0, 0.3);
      o.headP = this.lookP - 0.15 * k;
      o.roar = lerp(0.35, 0.95, k);
    } else {
      // The slam, then back up into his stance
      const r = smooth((t - 0.8) / 0.65);
      this.idleShape(o);
      const crouch = o.crouch;
      const stance = o.stance;
      o.crouch = lerp(0.45, crouch, r);
      o.stance = lerp(0.85, stance, r);
      o.lean = lerp(-0.28, o.lean, r);
      const dn = hipsDown(o.crouch, o.stance);
      const iy = o.hR.y;
      o.hR.set(lerp(0.5, 0.43, r), lerp(1.05 - dn, iy, r), lerp(-0.3, -0.06, r));
      o.hL.set(-o.hR.x, o.hR.y, o.hR.z);
      o.headP = lerp(this.lookP - 0.15, o.headP, r);
      o.roar = lerp(0.95, o.roar, r);
    }
  }

  /** Rocked back on his heels: chest and head thrown back, arms flung out, a stumbling step, then himself again. */
  private staggerShape(o: Shape): void {
    const u = this.actT / this.actDur;
    const hit = 1 - seg(u, 0.2, 1);
    o.stance = 0.6;
    o.crouch = 0.1 + 0.25 * Math.sin(Math.PI * u);
    o.twist = 0;
    o.liftR = 0;
    o.liftL = 0.35 * Math.sin(Math.PI * clamp01((u - 0.1) / 0.45));
    o.carPitch = 0;
    o.lean = 0.05 + 0.32 * hit;
    const dn = hipsDown(o.crouch, o.stance);
    o.hR.set(lerp(0.43, 0.56, hit), lerp(0.9 - dn, 1.3, hit), lerp(-0.06, 0.12, hit));
    o.hL.set(-o.hR.x, o.hR.y, o.hR.z);
    o.elbow.set(0.8, -0.2, 0.5);
    o.headP = lerp(this.lookP, 0.35, hit);
    o.headY = this.lookY * (1 - hit);
    o.headR = 0;
    o.roar = 0.15 + 0.3 * hit;
  }

  /**
   * Like a bull about to go: low, the head down and forward, the fists
   * balled at his hips, and one foot scraping back at the ground — twice.
   * Snorting.
   */
  private pawShape(o: Shape): void {
    const t = this.actT;
    const scrape = Math.max(0, Math.sin(t * 2 * TAU));
    o.stance = 0.55;
    o.crouch = 0.3;
    o.twist = 0;
    o.liftL = 0;
    o.liftR = 0.45 * scrape;
    o.carPitch = 0;
    o.lean = -0.6;
    const dn = hipsDown(o.crouch, o.stance);
    o.arms(0.5, 0.78 - dn, -0.2);
    o.elbow.set(0.9, -0.2, 0.3);
    o.headP = 0.2 + 0.4 * this.lookP;
    o.headY = this.lookY * 0.5;
    o.headR = 0;
    o.roar = 0.25 + 0.35 * scrape;
  }

  /** Flat out like a rhino: bent right over, head down, the arms driving. */
  private chargeShape(o: Shape): void {
    const sw = Math.sin(this.phaseW) * this.sb;
    o.stance = 0;
    o.crouch = 0;
    o.liftL = o.liftR = 0;
    o.carPitch = 0;
    o.hR.set(0.47, 0.8 + 0.1 * Math.max(0, sw), 0.1 - 0.36 * sw);
    o.hL.set(-0.47, 0.8 + 0.1 * Math.max(0, -sw), 0.1 + 0.36 * sw);
    o.elbow.set(0.8, -0.4, 0.3);
    o.lean = -1.05;
    o.twist = 0.12 * sw;
    o.headP = 0.4;
    o.headY = 0;
    o.headR = 0;
    o.roar = 0.75;
  }

  /**
   * The launcher. Getting it: the right hand up over his shoulder for the
   * end of it, and swinging it over onto the shoulder; then braced, feet
   * wide, the chest turned a little right so the left hand comes across to
   * the front grip, the right on the pistol grip, head down at the sight —
   * each rocket kicking it back into him. Putting it away, the same
   * backwards. The hands go where the launcher's grips are.
   */
  private rocketShape(o: Shape): void {
    const a = this.act;
    const u = clamp01(this.actT / this.actDur);
    const up = smooth(this.lnch);
    const hold = a === 'shoulder' ? seg(u, 0, 0.25) : a === 'unshoulder' ? 1 - seg(u, 0.6, 0.95) : 1;
    o.stance = a === 'barrage' ? 0.3 : 0.7;
    o.crouch = 0.12 + 0.04 * up;
    o.liftL = o.liftR = 0;
    o.carPitch = 0;
    o.lean = 0.06 * up - 0.06 * this.recoil;
    o.twist = -0.3 * up;
    const dn = hipsDown(o.crouch, o.stance);
    o.arms(0.43, 0.9 - dn, -0.06);
    // Right: the end of it over his shoulder, then the pistol grip
    this.onLauncher(0, 0, -0.4, _b);
    this.onLauncher(0, -0.19, -0.2, _c);
    _b.lerp(_c, up);
    o.hR.lerp(_b, hold);
    // Left: across to the front grip once it is up
    this.onLauncher(-0.05, -0.14, -0.3, _c);
    o.hL.lerp(_c, seg(up, 0.55, 1));
    o.elbow.set(0.8, -0.35, 0.45);
    o.headP = lerp(this.lookP, 0.12 - this.aimPitch * 0.5, up);
    o.headY = lerp(this.lookY, -0.22, up);
    o.headR = 0.06 * up;
    o.roar = 0.1 + 0.25 * this.recoil;
  }

  /** Heels dug in and leaning back against it; dazed if it was the fence that stopped him. */
  private skidShape(o: Shape): void {
    const u = clamp01(this.actT / this.actDur);
    const slide = 1 - seg(u, 0.1, 0.45);
    const daze = this.skidCrashed ? Math.sin(Math.PI * clamp01(u / 0.8)) : 0;
    o.stance = 0.9 * slide + 0.5 * (1 - slide);
    o.crouch = 0.3 * slide + 0.15 * daze;
    o.twist = 0;
    o.liftL = o.liftR = 0;
    o.carPitch = 0;
    o.lean = 0.25 * slide - 0.05 + 0.2 * daze;
    const dn = hipsDown(o.crouch, o.stance);
    o.arms(lerp(0.43, 0.7, slide), lerp(0.9 - dn, 1.15, slide), lerp(-0.06, 0.1, slide));
    o.elbow.set(0.8, -0.2, 0.5);
    o.headP = this.lookP * (1 - daze) + 0.3 * daze * Math.sin(this.actT * 7);
    o.headY = this.lookY * (1 - daze) + 0.25 * daze * Math.sin(this.actT * 4.3);
    o.headR = 0.15 * daze;
    o.roar = 0.3 + 0.3 * slide;
  }

  // ===================================================================== dying

  /**
   * Felled. The last round rocks him back two heavy steps, arms flung out;
   * he sinks to one knee, head down; a moment; then he goes over backward,
   * stiff as a tree, about his heels — slowly at first and faster all the
   * way down — straightening as he goes, arms out wide, and lands flat on
   * his back with a little bounce. Then he is still for good.
   */
  private stepDeath(): void {
    const t = this.actT;
    const e = this.enemy;
    const f = _a.set(-Math.sin(this.deathYaw), 0, -Math.cos(this.deathYaw));
    if (t < 0.9) {
      // Two steps back, a stride each
      const back = 0.65 * smooth(t / 0.45) + 0.65 * smooth((t - 0.45) / 0.45);
      e.position.set(this.deathFrom.x - f.x * back, this.deathFrom.y, this.deathFrom.z - f.z * back);
      if (this.deathStage === 0 && t >= 0.45) {
        this.deathStage = 1;
        this.emit({ type: 'step', pos: this.footSpot(1, 0.4, new THREE.Vector3()), heavy: true });
      }
    } else if (this.deathStage === 1) {
      this.deathStage = 2;
      this.emit({ type: 'step', pos: this.footSpot(-1, 0.4, new THREE.Vector3()), heavy: true });
    }
    if (t < 2.1) return;
    if (this.deathStage < 3) {
      this.deathStage = 3;
      // The pivot: his heels, a little behind the root, on the ground
      this.heel.set(
        e.position.x + Math.sin(this.deathYaw) * 0.12 * S,
        e.position.y,
        e.position.z + Math.cos(this.deathYaw) * 0.12 * S
      );
      this.emit({ type: 'fall' });
    }
    const FALL = 1.5;
    const LAID = Math.PI / 2 - 0.04;
    let th: number;
    if (t < 2.1 + FALL) th = LAID * Math.pow((t - 2.1) / FALL, 2.3);
    else {
      const v = (t - 2.1 - FALL) / 0.55;
      th = v < 1 ? LAID - 0.07 * Math.sin(Math.PI * v) * (1 - 0.4 * v) : LAID;
    }
    // About the heels: the root goes round them on the yawed X axis.
    // Positive X tips his up toward his back (+z), face to the sky
    const sinT = Math.sin(th);
    const cosT = Math.cos(th);
    const r = 0.12 * S;
    const lift = 0.06 * S * Math.pow(sinT, 4);
    e.root.rotation.set(th, this.deathYaw, 0);
    e.position.set(
      this.heel.x - r * cosT * Math.sin(this.deathYaw),
      this.heel.y + r * sinT + lift,
      this.heel.z - r * cosT * Math.cos(this.deathYaw)
    );
    if (this.deathStage === 3 && t >= 2.1 + FALL) {
      this.deathStage = 4;
      this._dead = true;
      const head = new THREE.Vector3(0, 1.62 * S, 0).applyQuaternion(e.root.quaternion).add(e.position);
      head.y = this.heel.y;
      this.emit({ type: 'fell', pos: head });
    }
    if (this.deathStage === 4 && t >= 2.1 + FALL + 0.7) {
      // Still. With no ragdoll to sync, the Enemy now holds him exactly as
      // he lies, and a round into him finds a corpse, not a man
      this.deathStage = 5;
      e.alive = false;
    }
  }

  private deathShape(o: Shape): void {
    const t = this.actT;
    o.twist = 0;
    o.carPitch = 0;
    o.headY = 0;
    o.headR = 0;
    if (t < 0.9) {
      o.stance = 0.4;
      o.crouch = 0.12;
      o.liftR = 0.4 * Math.sin(Math.PI * clamp01(t / 0.45));
      o.liftL = 0.4 * Math.sin(Math.PI * clamp01((t - 0.45) / 0.45));
      o.lean = 0.32;
      o.arms(0.6, 1.42, 0.12);
      o.elbow.set(1, -0.1, 0.4);
      o.headP = 0.3;
      o.roar = lerp(0.75, 0.4, t / 0.9);
    } else if (t < 2.1) {
      // Down on one knee: the left forward, the right under him
      const k = smooth((t - 0.9) / 0.8);
      const sway = 0.02 * Math.sin(t * 3) * seg(t, 1.6, 2.1);
      o.stance = lerp(0.4, 0.45, k);
      o.crouch = lerp(0.12, 0.8, k);
      o.liftR = 0;
      o.liftL = 0.22 * k;
      o.lean = lerp(0.32, -0.32, k) + sway;
      const dn = hipsDown(o.crouch, o.stance);
      o.hR.set(lerp(0.6, 0.3, k), lerp(1.42, 1.0 - dn, k), lerp(0.12, -0.32, k));
      o.hL.set(lerp(-0.6, -0.47, k), lerp(1.42, 0.98 - dn, k), lerp(0.12, 0.04, k));
      o.elbow.set(0.8, -0.4, 0.3);
      o.headP = lerp(0.3, -0.35, k) + 0.3 * seg(t, 1.7, 2.1);
      o.roar = lerp(0.4, 0.2, k);
    } else {
      // Going over: straightened out stiff by halfway, arms flung wide
      const u = clamp01((t - 2.1) / 1.5);
      const k = smooth(u / 0.45);
      o.stance = lerp(0.45, 0.25, k);
      o.crouch = lerp(0.8, 0, k);
      o.liftR = 0;
      o.liftL = lerp(0.22, 0, k);
      o.lean = lerp(-0.32, 0.12, k);
      const dn = hipsDown(o.crouch, o.stance);
      o.hR.set(lerp(0.3, 0.86, k), lerp(1.0 - dn, 1.48, k), lerp(-0.32, 0.06, k));
      o.hL.set(lerp(-0.47, -0.86, k), lerp(0.98 - dn, 1.48, k), lerp(0.04, 0.06, k));
      o.elbow.set(1, 0, 0.3);
      o.headP = lerp(-0.05, 0.2, k);
      o.roar = lerp(0.55, 0.25, seg(u, 0.6, 1));
    }
  }

  // ===================================================================== posing

  /**
   * Where his shoulder will be this frame, in the body frame, for a shape:
   * the Enemy's own sums — the walk's sway and bob, the squat's drop and
   * the seat going back, the lean's shift (below), the twist turning them
   * round the spine.
   */
  private shoulder(side: number, o: Shape, out: THREE.Vector3): THREE.Vector3 {
    const sway = Math.sin(this.phaseW) * 0.018 * this.sb;
    const bob = -Math.abs(Math.sin(this.phaseW)) * 0.042 * this.sb;
    const lower = hipsDown(o.crouch, o.stance);
    const back = hipsBack(o.crouch, o.stance);
    const l = o.lean;
    out.set(
      side * SHOULDER_X + sway * 0.7,
      1.4 + bob - lower - (0.2 * (1 - Math.cos(l / 2)) + 0.2 * (1 - Math.cos(l))),
      back + 0.2 * Math.sin(l / 2) + 0.2 * Math.sin(l)
    );
    if (o.twist !== 0) {
      const c = Math.cos(o.twist);
      const s = Math.sin(o.twist);
      const cx = sway * 0.85;
      const x = out.x - cx;
      const z = out.z - back;
      out.x = cx + x * c + z * s;
      out.z = back - x * s + z * c;
    }
    return out;
  }

  /**
   * Onto the rig. The hands are pulled inside his reach first, so where we
   * put them is where they go — and so where the car goes. The rig's
   * shoulders hang off the root, not the chest, so a lean wouldn't carry
   * them; the model's do go with it (they ride the spine), so pose.shift
   * takes the rig's along the same way, and the arm IK reaches from about
   * where the model's shoulders really are. (Shift moves nothing you see.)
   */
  private applyPose(): void {
    const c = this.cur;
    const p = this.pose;
    inReach(c.hR, this.shoulder(1, c, this.shR), REACH);
    inReach(c.hL, this.shoulder(-1, c, this.shL), REACH);
    this.pHandR.copy(c.hR);
    this.pHandL.copy(c.hL);
    this.pElbow.copy(c.elbow);
    const l = c.lean;
    this.pShift.set(0, -(0.2 * (1 - Math.cos(l / 2)) + 0.2 * (1 - Math.cos(l))), 0.2 * Math.sin(l / 2) + 0.2 * Math.sin(l));
    p.lean = l;
    p.crouch = clamp01(c.crouch);
    p.stance = clamp01(c.stance);
    p.twist = c.twist;
    p.liftL = clamp01(c.liftL);
    p.liftR = clamp01(c.liftR);
    this.pHead.set(c.headP, c.headY, c.headR, 'YXZ');
    this.enemy.roar = clamp01(c.roar);
  }

  /**
   * The car in his hands, from the same body-frame hand targets the arms
   * were given: its floor pan on his palms, upright, its length across him.
   * During the heave it rides from where it stood (taken relative to his
   * hands the frame he grabbed it, so it doesn't jump) up onto his palms and
   * in over his head, turning across him as it goes. Tipped by carPitch
   * about its own length for the wind-up and the throw.
   */
  private placeCar(): void {
    const c = this.cur;
    const e = this.enemy;
    this.midB.copy(c.hR).add(c.hL).multiplyScalar(0.5);
    this.toWorld(this.midB, this.midW);
    this.qYaw.setFromAxisAngle(UP, e.yaw);
    if (this.grabPending) {
      this.grabPending = false;
      this.o0.copy(this.carOrigin0).sub(this.midW).applyQuaternion(this.qTmp.copy(this.qYaw).invert());
      this.yawRel0 = wrap(this.carYaw - e.yaw);
      // Whichever way round across him is the lesser turn
      this.yawRelEnd =
        Math.abs(wrap(this.yawRel0 - Math.PI / 2)) <= Math.abs(wrap(this.yawRel0 + Math.PI / 2)) ? Math.PI / 2 : -Math.PI / 2;
      this.carE1 = this.carE2 = 0;
      this.carToss = 0;
    }
    const pitch = c.carPitch;
    const e1 = this.carE1;
    const e2 = this.carE2;
    // (0, −GRIP_H, 0) tipped by the pitch: the ground centre below his palms
    this.off.set(
      lerp(this.o0.x, 0, e2),
      lerp(this.o0.y, -GRIP_H * Math.cos(pitch), e1) + this.carToss,
      lerp(this.o0.z, -GRIP_H * Math.sin(pitch), e2)
    );
    const yr = this.yawRel0 + wrap(this.yawRelEnd - this.yawRel0) * e2;
    this.carQ
      .copy(this.qYaw)
      .multiply(this.qTmp.setFromAxisAngle(X_AXIS, pitch))
      .multiply(_q.setFromAxisAngle(UP, yr));
    this.carOriginW.copy(this.off.applyQuaternion(this.qYaw)).add(this.midW);
    if (this.carOriginW.y < 0) this.carOriginW.y = 0;
    this.carM.compose(this.carOriginW, this.carQ, ONE);
    this.world.hold(this.carHeld, this.carM);
  }

  // ===================================================================== frames

  /** Body frame (unscaled rig units) to world, while he stands upright. */
  private toWorld(b: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const p = this.enemy.position;
    const yaw = this.enemy.yaw;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    return out.set(p.x + (b.x * c + b.z * s) * S, p.y + b.y * S, p.z + (-b.x * s + b.z * c) * S);
  }

  /** World to the body frame. */
  private toBody(w: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const p = this.enemy.position;
    const yaw = this.enemy.yaw;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const dx = w.x - p.x;
    const dz = w.z - p.z;
    return out.set((dx * c - dz * s) / S, (w.y - p.y) / S, (dx * s + dz * c) / S);
  }

  private flatDist(p: THREE.Vector3): number {
    const q = this.enemy.position;
    return Math.hypot(p.x - q.x, p.z - q.z);
  }

  private clampZone(p: THREE.Vector3): void {
    const z = this.zone;
    p.x = THREE.MathUtils.clamp(p.x, z.minX, z.maxX);
    p.z = THREE.MathUtils.clamp(p.z, z.minZ, z.maxZ);
  }
}

