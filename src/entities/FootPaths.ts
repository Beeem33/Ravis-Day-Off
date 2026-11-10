import * as THREE from 'three';
import type { Enemy } from './Enemy';

/**
 * FootPaths — people walked about a cutscene on foot: through a list of
 * points, each leg timed; a leg that changes height (the step up into a van,
 * the drop down out of it) taken as a step, the leading knee up and the
 * other leg bending to push him up or let him down. When a walk ends he
 * turns to whatever he was told to face, and keeps turning to it.
 *
 * Getting up off a bench and sitting back down on one are here too: hands on
 * the thighs and a lean into it to stand, a lean and the hands back down to
 * sit.
 *
 * The scene says where the ground is (`ground`): a flat leg higher than half
 * a metre above it is inside something (the van), and walked more slowly.
 */

/** On foot: how fast they walk, outside and indoors; how long a step up or down takes. */
export const WALK = 1.45;
export const WALK_IN = 1.0;
export const STEP_UP = 0.62;
export const STEP_DOWN = 0.55;

/** Sat on a bench, hands resting on the thighs, palms down (body frame: his right +X, forward −Z). */
export const SEATED_HANDS = (): Enemy['pose'] => ({
  handR: new THREE.Vector3(0.15, 0.62, -0.3),
  handL: new THREE.Vector3(-0.15, 0.62, -0.3),
  palmR: new THREE.Vector3(0, -1, 0),
  thumbR: new THREE.Vector3(-1, 0, -0.2),
  palmL: new THREE.Vector3(0, -1, 0),
  thumbL: new THREE.Vector3(1, 0, -0.2),
  curl: 0.25
});

interface Walk {
  pts: THREE.Vector3[];
  legT: number[];
  steps: number[];
  total: number;
  t: number;
  face?: THREE.Vector3;
  done?: () => void;
  /** The last leg is backed down, already turned to `face` (onto a bench). */
  backLast: boolean;
  /** A step's pose is on him, to be taken off. */
  stepPosed: boolean;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();

export class FootPaths {
  readonly walks = new Map<Enemy, Walk>();
  /** Who's turning to look at what, once they've stopped. */
  readonly faceGoal = new Map<Enemy, THREE.Vector3>();
  /** Standing up off the bench or sitting down on it: since when, and which way. */
  readonly benchMove = new Map<Enemy, { t: number; up: boolean }>();

  /** `ground`: the height of the ground where the walking is, now. */
  constructor(private ground: () => number) {}

  /** Walk `e` through `pts` (a leg that changes height is a step up or down), turning to `face` at the end; `inside`: the pace in the van. */
  walk(e: Enemy, pts: THREE.Vector3[], speed: number, face?: THREE.Vector3, done?: () => void, backLast = false, inside = WALK_IN): void {
    const legs = FootPaths.legTimes(pts, speed, this.ground() + 0.5, inside);
    this.walks.set(e, {
      pts: pts.map((p) => p.clone()),
      legT: legs.t,
      steps: legs.step,
      total: legs.t.reduce((a, b) => a + b, 0),
      t: 0,
      face: face?.clone(),
      done,
      backLast,
      stepPosed: false
    });
    this.faceGoal.delete(e);
  }

  /** Stop a walk where he is (nothing called). */
  stop(e: Enemy): void {
    const w = this.walks.get(e);
    if (!w) return;
    this.walks.delete(e);
    if (w.stepPosed) e.pose = null;
    e.setWalk(0);
  }

  has(e: Enemy): boolean {
    return this.walks.has(e);
  }

  /** Up off the bench onto his feet, where he sits. */
  standUp(e: Enemy): void {
    e.setSitting(false);
    this.benchMove.set(e, { t: 0, up: true });
  }

  /** Down onto the bench he's stood at (the scene has put him where he sits). */
  sitDown(e: Enemy): void {
    e.setSitting(true);
    this.benchMove.set(e, { t: 0, up: false });
  }

  /**
   * How long each leg of a walk takes: a step up or down (a short leg that
   * changes height) its fixed time; on the flat, its length at `speed` — or
   * at the slower pace indoors, for a leg up off the ground (above
   * `insideAbove`).
   */
  static legTimes(pts: THREE.Vector3[], speed: number, insideAbove: number, inside = WALK_IN): { t: number[]; step: number[] } {
    const t: number[] = [];
    const step: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const flat = Math.hypot(b.x - a.x, b.z - a.z);
      const dy = b.y - a.y;
      if (Math.abs(dy) > 0.12 && flat < 0.9) {
        t.push(dy > 0 ? STEP_UP : STEP_DOWN);
        step.push(Math.sign(dy));
      } else {
        t.push(Math.max(0.05, flat / (Math.min(a.y, b.y) > insideAbove ? Math.min(speed, inside) : speed)));
        step.push(0);
      }
    }
    return { t, step };
  }

  /**
   * Where a walk is `t` seconds in (into `out`): on the flat straight along
   * the leg; a step up rises late in it (the foot's up on the step first, then
   * the weight goes onto it), a step down drops in the middle of it.
   */
  static alongTimed(pts: THREE.Vector3[], legT: number[], steps: number[], t: number, out: THREE.Vector3): { leg: number; u: number; step: number; dir: THREE.Vector3 } {
    let i = 0;
    let t0 = 0;
    while (i < legT.length - 1 && t > t0 + legT[i]) {
      t0 += legT[i];
      i++;
    }
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const u = clamp01((t - t0) / (legT[i] || 1));
    const step = steps[i] ?? 0;
    const k = step ? smooth(u) : u;
    out.lerpVectors(a, b, k);
    if (step > 0) out.y = a.y + (b.y - a.y) * smooth((u - 0.28) / 0.6);
    else if (step < 0) out.y = a.y + (b.y - a.y) * smooth((u - 0.2) / 0.6);
    const dir = _dir.subVectors(b, a).setY(0);
    if (dir.lengthSq() > 1e-8) dir.normalize();
    return { leg: i, u, step, dir };
  }

  update(dt: number): void {
    for (const [e, w] of this.walks) {
      w.t = Math.min(w.total, w.t + dt);
      const r = FootPaths.alongTimed(w.pts, w.legT, w.steps, w.t, e.position);
      const last = r.leg === w.legT.length - 1;
      // Facing the way he goes — except backing onto a bench at the end, already turned to sit
      if (w.backLast && last && w.face) e.faceToward(w.face, dt, 8);
      else if (r.dir.lengthSq() > 1e-6) e.faceToward(_to.copy(e.position).add(r.dir), dt, 7);
      if (r.step) {
        // A step: the leading knee comes up (and reaches down, going down), the other leg bends
        // to lower him or push him up, and follows; leading with alternate legs, step to step
        const u = r.u;
        const up = r.step > 0;
        const lead = up ? 0.9 * Math.sin(Math.PI * clamp01(u / 0.72)) : 0.38 * Math.sin(Math.PI * clamp01(u / 0.75));
        const trail = up ? 0.65 * Math.sin(Math.PI * clamp01((u - 0.42) / 0.58)) : 0.48 * Math.sin(Math.PI * clamp01((u - 0.4) / 0.6));
        const crouch = up ? 0.18 * Math.sin(Math.PI * clamp01(u / 0.6)) : 0.24 * Math.sin(Math.PI * clamp01(u / 0.85));
        const right = r.leg % 2 === 0;
        e.pose = { liftR: right ? lead : trail, liftL: right ? trail : lead, crouch, lean: (up ? 0.24 : 0.12) * Math.sin(Math.PI * u) };
        w.stepPosed = true;
        e.setWalk(0);
      } else {
        if (w.stepPosed) {
          e.pose = null;
          w.stepPosed = false;
        }
        e.setWalk(w.t < w.total ? (w.backLast && last ? 0.25 : 0.6) : 0);
      }
      e.cadence = 1;
      if (w.t >= w.total) {
        this.walks.delete(e);
        if (w.stepPosed) e.pose = null;
        e.setWalk(0);
        if (w.face) this.faceGoal.set(e, w.face);
        w.done?.();
      }
    }
    // Stopped, they turn to whatever they're looking at
    for (const [e, goal] of this.faceGoal) if (!this.walks.has(e)) e.faceToward(goal, dt, 5);
    this.updateBench(dt);
  }

  /**
   * Getting up off the bench and sitting back down on it: hands on the thighs
   * and a lean into it to get up; a lean and a hand back down to sit.
   */
  private updateBench(dt: number): void {
    for (const [e, m] of this.benchMove) {
      m.t += dt;
      const t = m.t;
      if (m.up) {
        const lean = 0.42 * Math.sin(Math.PI * clamp01(t / 0.75));
        e.pose = t < 0.42 ? { ...SEATED_HANDS(), lean } : t < 0.75 ? { lean } : null;
        if (t >= 0.75) this.benchMove.delete(e);
      } else {
        const lean = 0.3 * Math.sin(Math.PI * clamp01(t / 0.8));
        e.pose = t < 0.35 ? { lean } : { ...SEATED_HANDS(), lean };
        if (t >= 0.8) {
          e.pose = SEATED_HANDS();
          this.benchMove.delete(e);
        }
      }
    }
  }
}
