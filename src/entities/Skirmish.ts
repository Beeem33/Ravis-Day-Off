import * as THREE from 'three';
import type { Enemy } from './Enemy';

/**
 * Skirmish — the fights on the office floor that are going on whether or not
 * Ravi is watching: staff and agents slugging it out, an agent on his back
 * being beaten, staff popping up from behind the barricades to shoot, and
 * agents shooting back.
 *
 * None of it is meant to settle anything quickly. Punches land, people
 * stagger, bullets mostly hit desks — the scene keeps the score, slowly, and
 * leaves the deciding to the player. Each piece here only poses and times
 * its people and says when something has happened; what that does is the
 * scene's business, through the hooks.
 */

export interface FightHooks {
  /** A punch has been thrown. */
  thrown(attacker: Enemy): void;
  /**
   * And it has landed: on the face if `head`, along `dir`. `power` is how
   * much of a punch it was — a full swing standing up is 1.
   */
  landed(attacker: Enemy, victim: Enemy, at: THREE.Vector3, dir: THREE.Vector3, head: boolean, power: number): void;
  /** A shot, at `target`: the scene works out where it goes. */
  fire(shooter: Enemy, target: Enemy): void;
}

type Pose = NonNullable<Enemy['pose']>;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Shoulder to fist, on the rig: the reach of an arm held straight. */
const REACH = 0.59;

/** Pull `p` back inside `reach` of `from`, in place. */
function inReach(p: THREE.Vector3, from: THREE.Vector3, reach: number): THREE.Vector3 {
  _c.copy(p).sub(from);
  const d = _c.length();
  if (d > reach) p.copy(from).addScaledVector(_c, reach / d);
  return p;
}

/** Turn `e` towards a heading, at `rate`, through Enemy's own turning. */
const _turn = new THREE.Vector3();
function turnTo(e: Enemy, yaw: number, dt: number, rate: number): void {
  _turn.set(e.position.x - Math.sin(yaw), 0, e.position.z - Math.cos(yaw));
  e.faceToward(_turn, dt, rate);
}

/** One side of a fist fight. */
class Fighter {
  readonly pose: Pose = {
    handR: new THREE.Vector3(),
    handL: new THREE.Vector3(),
    elbow: new THREE.Vector3(0.55, -1, 0.35),
    shift: new THREE.Vector3(),
    lean: -0.1
  };
  /** The punch being thrown, if any: which hand, how far through, and whether it is at the face. */
  swing: { hand: 'R' | 'L'; t: number; landed: boolean; head: boolean } | null = null;
  /** 1 just hit .. 0 recovered; and which way the head went. */
  react = 0;
  reactSide = 1;
  readonly head = new THREE.Euler();
  /** Knocked back by the last one, easing off. */
  readonly push = new THREE.Vector3();
  /** Where the opponent's head is, for the neck to follow between hits. Kept: setHeadLook holds on to it. */
  readonly look = new THREE.Vector3();
  next: 'R' | 'L' = Math.random() < 0.5 ? 'R' : 'L';
  phase = Math.random() * 10;
  constructor(readonly e: Enemy) {}
}

/** Length of a punch, wind-up to recovery. */
const SWING = 0.4;
/** How far apart they stand: close enough that an arm and a lean reach a face. */
const GAP = 0.66;

/**
 * Brawl — an agent and one of the staff at close quarters, guards up,
 * trading punches. The pair turns slowly about where they are fighting, so
 * it reads as a fight and not two men stood in a queue. The agent has his
 * rifle slung across his back; he has not had the chance to use it.
 */
export class Brawl {
  done = false;
  private t = Math.random() * 5;
  private wait = 0.6 + Math.random();
  private fa: Fighter;
  private fs: Fighter;
  private targetA = new THREE.Vector3();
  private targetS = new THREE.Vector3();

  constructor(
    readonly agent: Enemy,
    readonly staff: Enemy,
    private centre: THREE.Vector3,
    private yaw0: number,
    private hooks: FightHooks
  ) {
    this.fa = new Fighter(agent);
    this.fs = new Fighter(staff);
    agent.slingWeapon(true);
    agent.poseCurl = 1;
    staff.poseCurl = 1;
    staff.setFurious();
    this.place(0, true);
    agent.faceToward(staff.position, 1, 100);
    staff.faceToward(agent.position, 1, 100);
  }

  /** Called off: one of them is down, or the agent has better things to do. */
  end(): void {
    if (this.done) return;
    this.done = true;
    for (const f of [this.fa, this.fs]) {
      f.e.pose = null;
      f.e.poseCurl = null;
      f.e.setWalk(0);
      f.e.setHeadLook(null);
    }
  }

  /** Where each should be standing: either side of the centre, on the turning line. */
  private place(dt: number, snap = false): void {
    const ang = this.yaw0 + 0.42 * Math.sin(this.t * 0.31) + 0.15 * Math.sin(this.t * 0.83);
    const u = _a.set(Math.sin(ang), 0, Math.cos(ang));
    this.targetA.copy(this.centre).addScaledVector(u, -GAP / 2).add(this.fa.push);
    this.targetS.copy(this.centre).addScaledVector(u, GAP / 2).add(this.fs.push);
    const k = snap ? 1 : Math.min(1, dt * 5);
    for (const [f, to] of [[this.fa, this.targetA], [this.fs, this.targetS]] as const) {
      const p = f.e.position;
      const bx = p.x;
      const bz = p.z;
      p.x += (to.x - p.x) * k;
      p.z += (to.z - p.z) * k;
      const moved = Math.hypot(p.x - bx, p.z - bz) / Math.max(1e-4, dt);
      f.e.setWalk(snap ? 0 : Math.min(0.35, moved * 0.3));
    }
  }

  update(dt: number): void {
    if (this.done) return;
    const a = this.agent;
    const s = this.staff;
    if (!a.alive || !s.alive) {
      this.end();
      return;
    }
    this.t += dt;
    for (const f of [this.fa, this.fs]) f.push.multiplyScalar(Math.exp(-dt * 4));
    this.place(dt);
    a.faceToward(s.position, dt, 14);
    s.faceToward(a.position, dt, 14);

    // Either of them throws next, now and then a second straight after
    this.wait -= dt;
    if (this.wait <= 0 && !this.fa.swing && !this.fs.swing) {
      const f = Math.random() < 0.5 ? this.fa : this.fs;
      this.throwFrom(f);
      this.wait = Math.random() < 0.3 ? SWING * 0.9 : 0.5 + Math.random() * 0.9;
    }
    this.animate(this.fa, this.fs, dt);
    // A punch can end it: the scene calls the fight off from inside the
    // hook, and the other man must not then be posed back into it
    if (this.done) return;
    this.animate(this.fs, this.fa, dt);
  }

  private throwFrom(f: Fighter): void {
    f.swing = { hand: f.next, t: 0, landed: false, head: Math.random() < 0.7 };
    f.next = f.next === 'R' ? 'L' : 'R';
    this.hooks.thrown(f.e);
  }

  /** Guard, punch, and the knock from the other man's. */
  private animate(f: Fighter, o: Fighter, dt: number): void {
    const e = f.e;
    const p = f.pose;
    f.phase += dt;
    const bob = Math.sin(f.phase * 6.5) * 0.015;
    // Guard: fists up in front of the chin, the left a little further out
    p.handR!.set(0.12, 1.43 + bob, -0.26);
    p.handL!.set(-0.13, 1.47 - bob, -0.3);
    p.shift!.set(0, 0, 0);
    let lean = -0.1;

    if (f.swing) {
      const sw = f.swing;
      sw.t += dt;
      const u = sw.t / SWING;
      e.root.updateMatrixWorld();
      // Aimed afresh every frame: they are both moving
      const tgt = sw.head ? o.e.headWorld(_a) : _a.copy(o.e.position).addScaledVector(UP, 1.2);
      e.root.worldToLocal(tgt);
      // The near surface of it, not the middle
      tgt.z += sw.head ? 0.11 : 0.14;
      const hand = sw.hand === 'R' ? p.handR! : p.handL!;
      const guard = _b.copy(hand);
      // The shoulder goes in behind the punch
      let drive = 0;
      if (u < 0.3) {
        // Drawn back a touch
        hand.z += 0.06 * smooth(u / 0.3);
      } else if (u < 0.52) {
        drive = smooth((u - 0.3) / 0.22);
      } else {
        drive = 1 - smooth((u - 0.52) / 0.48);
      }
      if (drive > 0) {
        p.shift!.set(sw.hand === 'R' ? -0.03 : 0.03, 0, -0.13 * drive);
        const shoulder = _c.set(sw.hand === 'R' ? 0.29 : -0.29, 1.4, 0).add(p.shift!);
        inReach(tgt, shoulder, REACH);
        hand.lerpVectors(guard, tgt, drive);
        lean = -0.1 - 0.22 * drive;
      }
      if (!sw.landed && u >= 0.5) {
        sw.landed = true;
        const at = sw.head ? o.e.headWorld(new THREE.Vector3()) : o.e.position.clone().addScaledVector(UP, 1.2);
        const dir = at.clone().sub(e.position).setY(0).normalize();
        o.react = 1;
        o.reactSide = sw.hand === 'R' ? 1 : -1;
        o.push.addScaledVector(dir, sw.head ? 0.12 : 0.08);
        this.hooks.landed(e, o.e, at, dir, sw.head, 1);
        // That one finished it: the fight is off and both men are free of it
        if (this.done) return;
      }
      if (u >= 1) f.swing = null;
    }

    // Hit: the head snaps round and back, and he gives a step
    f.react = Math.max(0, f.react - dt * 2.8);
    if (f.react > 0.02) {
      const r = smooth(f.react);
      f.head.set(0.3 * r, f.reactSide * 0.42 * r, f.reactSide * 0.16 * r);
      p.head = f.head;
      lean += 0.16 * r;
      e.setHeadLook(null);
    } else {
      p.head = undefined;
      e.setHeadLook(o.e.headWorld(f.look));
    }
    p.lean = lean;
    e.pose = p;
  }
}

/**
 * GroundPound — an agent on his back on the carpet, forearms up over his
 * face, and one of the staff knelt over him raining punches down on him. The
 * agent's head goes with every one. His rifle is somewhere else.
 *
 * The agent is laid down by turning his whole body over onto its back: the
 * rig and the model on it do not know they are lying down, and do not need
 * to. If he dies he dies as he lies, not stood back up first.
 */
export class GroundPound {
  done = false;
  /** Set by the scene when it wants him finished: the next one is the last. */
  finish = false;
  private t = Math.random();
  private period = 0.84;
  private landed = false;
  private readonly staffPose: Pose = {
    handR: new THREE.Vector3(),
    handL: new THREE.Vector3(),
    elbow: new THREE.Vector3(0.7, -0.6, 0.2),
    lean: -0.85,
    shift: new THREE.Vector3(0, -0.33, -0.16)
  };
  private readonly agentPose: Pose = {
    handR: new THREE.Vector3(0.1, 1.5, -0.26),
    handL: new THREE.Vector3(-0.11, 1.53, -0.24),
    elbow: new THREE.Vector3(1, 0.1, 0.25),
    head: new THREE.Euler()
  };
  private react = 0;
  private side = 1;
  /** His face, his chest, and the fist drawn back, in the kneeling man's frame. */
  private face = new THREE.Vector3();
  private chest = new THREE.Vector3();
  private wind = new THREE.Vector3(0.22, 1.08, -0.02);

  constructor(
    readonly agent: Enemy,
    readonly staff: Enemy,
    /** Where his feet are, and the way his head points from them. */
    feet: THREE.Vector3,
    heading: number,
    staffAt: THREE.Vector3,
    staffYaw: number,
    private hooks: FightHooks
  ) {
    // Over onto his back, head along `heading`
    agent.root.rotation.order = 'YXZ';
    agent.root.rotation.set(Math.PI / 2, heading, 0);
    agent.root.position.set(feet.x, 0.13, feet.z);
    agent.yaw = heading;
    agent.ragdollFromPose = true;
    agent.hideWeapon();
    agent.poseCurl = 0.55;
    agent.pose = this.agentPose;

    staff.position.copy(staffAt);
    staff.yaw = staffYaw;
    staff.root.rotation.y = staffYaw;
    staff.setKneeling(true);
    staff.setFurious();
    staff.poseCurl = 1;
    staff.pose = this.staffPose;
  }

  /** The beating stops: the agent is dead, or the man doing it is. */
  end(): void {
    if (this.done) return;
    this.done = true;
    this.staff.pose = null;
    this.staff.poseCurl = null;
    if (this.staff.alive) {
      this.staff.setKneeling(false);
      this.staff.setShaken();
      // Up off his knees, and a step back from him
      const s = this.staff;
      s.position.x += Math.sin(s.yaw) * 0.35;
      s.position.z += Math.cos(s.yaw) * 0.35;
    }
    if (this.agent.alive) {
      // Out cold: arms down on the carpet either side of him
      this.agentPose.handR!.set(0.32, 0.95, 0.02);
      this.agentPose.handL!.set(-0.32, 0.97, 0.02);
      this.agentPose.head!.set(0, 0.5, 0);
      this.agent.poseCurl = 0.3;
    }
  }

  update(dt: number): void {
    if (this.done) return;
    if (!this.agent.alive || !this.staff.alive) {
      this.end();
      return;
    }
    this.t += dt;
    const u = (this.t % this.period) / this.period;
    if (u < 0.1) this.landed = false;
    const s = this.staff;
    s.root.updateMatrixWorld();
    // His face, and his chest for the other hand to pin him by
    this.face.copy(this.agent.headWorld(_a));
    this.face.y += 0.11;
    s.root.worldToLocal(this.face);
    this.agent.root.updateMatrixWorld();
    this.chest.copy(this.agent.root.localToWorld(_b.set(0, 1.18, -0.14)));
    s.root.worldToLocal(this.chest);
    const shift = this.staffPose.shift!;
    // Wind up high, drive it down, come back up
    const hand = this.staffPose.handR!;
    if (u < 0.5) {
      hand.lerpVectors(this.face, this.wind, smooth(u / 0.35));
    } else if (u < 0.66) {
      hand.lerpVectors(this.wind, this.face, smooth((u - 0.5) / 0.16));
    } else {
      hand.lerpVectors(this.face, this.wind, smooth((u - 0.66) / 0.34) * 0.35);
    }
    inReach(hand, _c.set(0.29, 1.02, 0).add(shift), REACH);
    this.staffPose.handL!.copy(this.chest);
    inReach(this.staffPose.handL!, _c.set(-0.29, 1.02, 0).add(shift), REACH);
    this.staffPose.lean = -0.85 + 0.12 * Math.sin(u * Math.PI * 2);

    if (!this.landed && u >= 0.64) {
      this.landed = true;
      this.react = 1;
      this.side = -this.side;
      const at = this.agent.headWorld(new THREE.Vector3());
      this.hooks.landed(s, this.agent, at, new THREE.Vector3(0, -1, 0), true, this.finish ? 100 : 0.35);
      // The last of him: end() has let the man doing it go — leave him be
      if (this.done) return;
    } else if (u > 0.5 && u < 0.53) {
      this.hooks.thrown(s);
    }

    // His head goes with each one; his arms try to cover up
    this.react = Math.max(0, this.react - dt * 3);
    const r = smooth(this.react);
    this.agentPose.head!.set(0.1 * r, this.side * 0.55 * r + Math.sin(this.t * 2.1) * 0.12, 0);
    const flail = Math.sin(this.t * 5.3) * 0.04;
    this.agentPose.handR!.set(0.1 + flail, 1.48 + 0.04 * r, -0.27 + 0.05 * r);
    this.agentPose.handL!.set(-0.11 - flail, 1.52, -0.24);
    this.agent.pose = this.agentPose;
    this.staff.pose = this.staffPose;
  }
}

/**
 * CoverGunner — one of the staff behind an overturned desk with a pistol.
 * Sat with his back to it, gun up by his face; then round onto his knees,
 * up over the top, a couple of shots at the nearest agent with his other
 * hand braced on the desk, and back down again.
 */
export class CoverGunner {
  state: 'hide' | 'rise' | 'aim' | 'drop' | 'off' = 'hide';
  private timer = 1 + Math.random() * 3;
  private shots = 0;
  private gap = 0;
  /** The right arm: aimed at whoever he is shooting at, or held up out of the way. */
  private armQ = new THREE.Quaternion();
  private wantQ = new THREE.Quaternion();
  private static HIDE_ARM = new THREE.Quaternion().setFromUnitVectors(DOWN, new THREE.Vector3(0.08, -0.95, -0.3).normalize());
  private readonly pose: Pose = {
    armR: this.armQ,
    foreR: 2.7,
    handL: new THREE.Vector3(),
    elbow: new THREE.Vector3(0.5, -1, 0)
  };
  /** Who he is shooting at this time up. */
  target: Enemy | null = null;
  private aimAt = new THREE.Vector3();
  /** Where the left hand is going, eased toward each frame: it never jumps across him. */
  private handL = new THREE.Vector3(-0.13, 0.4, -0.34);
  private handGoal = new THREE.Vector3();

  /**
   * @param kneel where he kneels to shoot, facing over the desk
   * @param hide where he sits with his back to it, facing the other way
   * @param facing the way over the desk
   * @param brace the top of the desk in front of him, for his left hand (world)
   */
  constructor(
    readonly e: Enemy,
    readonly kneel: THREE.Vector3,
    readonly hide: THREE.Vector3,
    readonly facing: number,
    private brace: THREE.Vector3,
    private pick: (from: Enemy) => Enemy | null,
    private hooks: FightHooks
  ) {
    e.equipPistol();
    e.position.copy(hide);
    e.yaw = facing + Math.PI;
    e.root.rotation.y = e.yaw;
    e.setSlumped(true);
    e.setFurious();
    e.poseCurl = 1;
    this.armQ.copy(CoverGunner.HIDE_ARM);
    e.pose = this.pose;
  }

  /** Over the top and in sight, or on his way there. */
  get exposed(): boolean {
    return this.state === 'aim' || this.state === 'rise';
  }

  /**
   * Done fighting: sat where he was, back against the desk, the gun down on
   * his thigh. Stood up, he would be stood in among the legs of the desk he
   * was behind.
   */
  rest(): void {
    if (this.state === 'off') return;
    this.state = 'off';
    const e = this.e;
    e.setKneeling(false);
    e.setSlumped(true);
    e.setShaken();
    e.position.copy(this.hide);
    e.yaw = this.facing + Math.PI;
    e.root.rotation.y = e.yaw;
    this.armQ.setFromUnitVectors(DOWN, _b.set(0.18, -0.6, -0.78).normalize());
    this.pose.foreR = 0.25;
    this.pose.handL!.set(-0.13, 0.4, -0.34);
    e.pose = this.pose;
  }

  update(dt: number): void {
    const e = this.e;
    if (!e.alive || this.state === 'off') return;
    this.timer -= dt;
    const up = this.state === 'rise' || this.state === 'aim';
    const want = up ? this.kneel : this.hide;
    e.position.x += (want.x - e.position.x) * Math.min(1, dt * 4);
    e.position.z += (want.z - e.position.z) * Math.min(1, dt * 4);

    switch (this.state) {
      case 'hide':
        turnTo(e, this.facing + Math.PI, dt, 6);
        if (this.timer <= 0) {
          this.target = this.pick(e);
          if (!this.target) {
            this.timer = 1.5;
            break;
          }
          this.state = 'rise';
          this.timer = 0.6;
          e.setSlumped(false);
          e.setKneeling(true);
          e.setFurious();
        }
        break;
      case 'rise':
        turnTo(e, this.facing, dt, 9);
        if (this.timer <= 0) {
          this.state = 'aim';
          this.shots = 1 + Math.floor(Math.random() * 3);
          this.gap = 0.2 + Math.random() * 0.3;
        }
        break;
      case 'aim':
        if (!this.target || !this.target.alive) this.target = this.pick(e);
        if (this.target) e.faceToward(this.target.position, dt, 8);
        this.gap -= dt;
        if (this.gap <= 0 && this.target) {
          this.hooks.fire(e, this.target);
          this.shots--;
          this.gap = 0.45 + Math.random() * 0.45;
          if (this.shots <= 0) {
            this.state = 'drop';
            this.timer = 0.3;
          }
        }
        if (!this.target) {
          this.state = 'drop';
          this.timer = 0.2;
        }
        break;
      case 'drop':
        if (this.timer <= 0) {
          this.state = 'hide';
          this.timer = 1.8 + Math.random() * 3;
          e.setKneeling(false);
          e.setSlumped(true);
          e.setFurious();
        }
        break;
    }
    this.poseArms(dt, up);
  }

  /** Arm out at the target over the desk, the other hand on it; or the gun held up by his face, the other hand on his knee. */
  private poseArms(dt: number, up: boolean): void {
    const e = this.e;
    const p = this.pose;
    e.root.updateMatrixWorld();
    if (up && this.target && this.state === 'aim') {
      const shoulder = e.shoulderR(_a);
      // His chest, in this man's own frame
      this.aimAt.copy(this.target.position);
      this.aimAt.y += 1.25;
      e.root.worldToLocal(this.aimAt);
      this.wantQ.setFromUnitVectors(DOWN, _b.copy(this.aimAt).sub(shoulder).normalize());
      p.foreR = THREE.MathUtils.lerp(p.foreR ?? 0, 0.08, Math.min(1, dt * 10));
    } else if (up) {
      // Coming up: the arm out over the top, level
      this.wantQ.setFromUnitVectors(DOWN, _b.set(-0.15, 0, -1).normalize());
      p.foreR = THREE.MathUtils.lerp(p.foreR ?? 0, 0.3, Math.min(1, dt * 8));
    } else {
      this.wantQ.copy(CoverGunner.HIDE_ARM);
      p.foreR = THREE.MathUtils.lerp(p.foreR ?? 0, 2.7, Math.min(1, dt * 8));
    }
    this.armQ.slerp(this.wantQ, Math.min(1, dt * 10));
    const g = this.handGoal;
    if (up) {
      // Braced on the desk in front of him — once he is round to face it.
      // Coming up, the desk is still behind him or off to his right, and
      // reaching for it there wrenched the arm back across his shoulders.
      g.copy(this.brace);
      e.root.worldToLocal(g);
      if (g.z > -0.2 || g.x > 0.05) g.set(-0.24, 0.82, -0.24);
      inReach(g, _c.set(-0.29, 1.02, 0), REACH);
    } else {
      // On his thigh
      g.set(-0.13, 0.4, -0.34);
    }
    this.handL.lerp(g, Math.min(1, dt * 9));
    p.handL!.copy(this.handL);
    e.pose = p;
  }
}

/**
 * CoverShooter — an agent behind the north barricade, knelt or stood, rifle
 * up over the top, firing at whichever of the staff is nearest: steady,
 * unhurried, and mostly into the desks they are behind.
 */
export class CoverShooter {
  done = false;
  private timer = 0.6 + Math.random() * 2;
  private sway = Math.random() * 10;
  target: Enemy | null = null;
  private home: THREE.Vector3;

  constructor(
    readonly e: Enemy,
    private pick: (from: Enemy) => Enemy | null,
    private hooks: FightHooks,
    private kneel = false
  ) {
    this.home = e.position.clone();
    e.setAiming(true);
    e.setKneeling(kneel);
  }

  end(): void {
    this.done = true;
  }

  update(dt: number): void {
    const e = this.e;
    if (this.done || !e.alive) return;
    this.sway += dt;
    // Stood, a half step either way along the barricade now and then
    const off = this.kneel ? 0 : Math.sin(this.sway * 0.35) * 0.32;
    e.position.x += (this.home.x + off - e.position.x) * Math.min(1, dt * 2);
    e.position.z += (this.home.z - e.position.z) * Math.min(1, dt * 2);
    e.setWalk(this.kneel ? 0 : Math.abs(Math.cos(this.sway * 0.35)) * 0.12);
    if (!this.target || !this.target.alive) this.target = this.pick(e);
    if (this.target) e.faceToward(this.target.position, dt, 6);
    e.setAiming(true);
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 1.3 + Math.random() * 1.6;
      if (this.target) this.hooks.fire(e, this.target);
    }
  }
}

/**
 * Sat behind something with nothing to fight with: hunched forward, chin
 * on his chest, arms wrapped over his head with the elbows in front of his
 * face. Elbows out to the sides, with the head up, read as a man leaning
 * back with his hands behind his head — relaxing, not hiding.
 */
export function coweringPose(): Pose {
  return {
    handR: new THREE.Vector3(0.07, 1.0, -0.13),
    handL: new THREE.Vector3(-0.07, 1.02, -0.11),
    elbow: new THREE.Vector3(0.25, -0.2, -1),
    shift: new THREE.Vector3(0, -0.04, -0.12),
    head: new THREE.Euler(-0.55, 0, 0),
    lean: -0.35
  };
}

/**
 * StandGunner — one of the staff whose fight is over (the agent he was
 * punching went down): a pistol out, stood his ground, putting short
 * bursts into the nearest agent and lowering it between. Only the right arm
 * is posed; the left is the animation's, hanging at his side.
 */
export class StandGunner {
  done = false;
  private timer = 0.4 + Math.random() * 0.6;
  private shots = 0;
  private gap = 0;
  private up = 0;
  private armQ = new THREE.Quaternion();
  private wantQ = new THREE.Quaternion();
  private static LOW_ARM = new THREE.Quaternion().setFromUnitVectors(DOWN, new THREE.Vector3(0.1, -0.96, -0.26).normalize());
  private readonly pose: Pose = { armR: this.armQ, foreR: 0.45 };
  target: Enemy | null = null;
  private aimAt = new THREE.Vector3();

  constructor(
    readonly e: Enemy,
    private pick: (from: Enemy) => Enemy | null,
    private hooks: FightHooks
  ) {
    e.equipPistol();
    e.setKneeling(false);
    e.setSlumped(false);
    e.setFurious();
    e.setWalk(0);
    e.poseCurl = 1;
    this.armQ.copy(StandGunner.LOW_ARM);
    e.pose = this.pose;
  }

  end(): void {
    if (this.done) return;
    this.done = true;
    this.e.pose = null;
    this.e.poseCurl = null;
  }

  update(dt: number): void {
    const e = this.e;
    if (this.done || !e.alive) return;
    this.timer -= dt;
    if (this.target && !this.target.alive) this.target = null;
    if (!this.target && this.timer <= 0) {
      this.target = this.pick(e);
      this.timer = 0.8;
      if (this.target) {
        this.shots = 2 + Math.floor(Math.random() * 3);
        this.gap = 0.45;
      }
    }
    const p = this.pose;
    if (this.target) {
      e.faceToward(this.target.position, dt, 6);
      this.up = Math.min(1, this.up + dt * 4);
      this.gap -= dt;
      if (this.gap <= 0 && this.up > 0.9) {
        this.hooks.fire(e, this.target);
        this.shots--;
        this.gap = 0.4 + Math.random() * 0.4;
        if (this.shots <= 0) {
          this.target = null;
          this.timer = 1.2 + Math.random() * 1.6;
        }
      }
    } else this.up = Math.max(0, this.up - dt * 3);
    e.root.updateMatrixWorld();
    if (this.target) {
      const shoulder = e.shoulderR(_a);
      this.aimAt.copy(this.target.position);
      this.aimAt.y += 1.25;
      e.root.worldToLocal(this.aimAt);
      this.wantQ.setFromUnitVectors(DOWN, _b.copy(this.aimAt).sub(shoulder).normalize());
      this.wantQ.slerp(StandGunner.LOW_ARM, 1 - this.up);
    } else this.wantQ.copy(StandGunner.LOW_ARM);
    p.foreR = THREE.MathUtils.lerp(p.foreR ?? 0, this.target ? 0.08 : 0.45, Math.min(1, dt * 8));
    this.armQ.slerp(this.wantQ, Math.min(1, dt * 10));
    e.pose = p;
  }
}
