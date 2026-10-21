import * as THREE from 'three';
import { RaviRig, elbowToward, type Grip, type HandShape, type Side } from './RaviVisual';

/**
 * WheelGrip — Ravi's hands round a steering wheel that turns.
 *
 *   const grip = new WheelGrip(rig, { centre, facing, radius });  // once he's sat
 *   grip.update(angle);                                           // every frame
 *
 * The body is posed once (RaviRig.seat, or RaviStunt's 'seated'); this only
 * re-lays the arms: each wrist set so the rim runs through the curl of the
 * fist, carried round with the wheel as it turns, the elbows out and down,
 * then the pose written to the bones. Model space throughout (he faces +Z,
 * his left on +X); `facing` is out of the wheel's face toward him.
 */

/** Wrapped round the rim: tighter than a fist round a bar, the thumb over the top. */
const GRIP: HandShape = { fingers: [[78, 88, 52], [80, 90, 52], [82, 92, 54], [84, 94, 56]], thumb: [0.5, 0.45, 0.35] };
/** Where each hand holds the rim at rest, degrees round from the driver's 3 o'clock (anticlockwise as he sees it). */
const AT: Record<Side, number> = { l: 160, r: 20 };
/** How far the wheel turns at the most (radians): past this the hands would cross. */
export const WHEEL_TURN = 1.45;

export class WheelGrip {
  /** Fist hollow from the wrist, in the hand's frame: along the back of the hand, and out of the palm. */
  static tune = { along: 0.082, palm: 0.034, out: 0.25, elbowOut: 0.6, elbowDown: 0.6, elbowBack: 0.4 };

  private readonly c: THREE.Vector3;
  private readonly n: THREE.Vector3;
  private readonly wR = new THREE.Vector3();
  private readonly wU = new THREE.Vector3();
  private readonly shoulder: Record<Side, THREE.Vector3>;
  private readonly radius: number;
  /** Each hand as update() last laid it, model space. */
  private readonly holds: Record<Side, Grip | null> = { l: null, r: null };
  angle = 0;

  constructor(
    private readonly rig: RaviRig,
    wheel: { centre: THREE.Vector3; facing: THREE.Vector3; radius: number }
  ) {
    this.c = wheel.centre.clone();
    this.n = wheel.facing.clone().normalize();
    this.radius = wheel.radius;
    // The driver's right across the face, and up it
    this.wR.set(-1, 0, 0).addScaledVector(this.n, this.n.x).normalize();
    this.wU.crossVectors(this.n, this.wR).normalize();
    this.shoulder = { l: rig.at('upperarm_l'), r: rig.at('upperarm_r') };
  }

  /** Hands on the rim with the wheel turned `angle` (radians, + anticlockwise as he sees it: a left turn). */
  update(angle: number): void {
    this.angle = THREE.MathUtils.clamp(angle, -WHEEL_TURN, WHEEL_TURN);
    const T = WheelGrip.tune;
    const r = this.rig;
    for (const side of ['l', 'r'] as Side[]) {
      const a = THREE.MathUtils.degToRad(AT[side]) + this.angle;
      // Out from the hub to where he holds it, and the rim's run there
      const out = this.wR.clone().multiplyScalar(Math.cos(a)).addScaledVector(this.wU, Math.sin(a));
      const rim = this.c.clone().addScaledVector(out, this.radius);
      // Back of the hand into the wheel's face, a little outward; the palm onto the rim, toward the hub
      const along = this.n.clone().negate().addScaledVector(out, T.out).normalize();
      const palm = out.clone().negate();
      palm.addScaledVector(along, -palm.dot(along)).normalize();
      const wrist = rim.addScaledVector(along, -T.along).addScaledVector(palm, -T.palm);
      // Elbows out to his side, down and back
      const sx = side === 'l' ? 1 : -1;
      const pole = new THREE.Vector3(sx * T.elbowOut, -T.elbowDown, -T.elbowBack);
      const S = this.shoulder[side];
      const toward = elbowToward(wrist, S, pole);
      r.reach(side, wrist, along, palm, toward, S, 0.5, false).hand(side, GRIP);
      this.holds[side] = { wrist, along, palm, toward, shape: GRIP };
    }
    r.apply();
  }

  /**
   * One hand's hold on the rim as update() last laid it, and the shoulder
   * it reaches from, in the rig's model space: for a first-person arm
   * anchored on the rig's root to take the same hold (a viewmodel's, while
   * his own arms are hidden). Null before the first update.
   */
  hold(side: Side): { grip: Grip; shoulder: THREE.Vector3 } | null {
    const g = this.holds[side];
    return g ? { grip: g, shoulder: this.shoulder[side] } : null;
  }
}

/** A seat's wheel in a driver's model space, for a root at the seat's hip point turned to face the car's front. */
export function wheelInModel(seat: { hip: THREE.Vector3; wheel: THREE.Vector3; wheelFacing: THREE.Vector3 }, rootY: number): { centre: THREE.Vector3; facing: THREE.Vector3 } {
  return {
    centre: new THREE.Vector3(-(seat.wheel.x - seat.hip.x), seat.wheel.y - rootY, -(seat.wheel.z - seat.hip.z)),
    facing: new THREE.Vector3(-seat.wheelFacing.x, seat.wheelFacing.y, -seat.wheelFacing.z)
  };
}
