import * as THREE from 'three';

/**
 * The small sums every cutscene in the game does: a smoothstepped keyframe
 * track, the eases, and turning a look at a point into the yaw and pitch the
 * player's camera takes. The older scenes each carry a private copy of these;
 * new ones share this.
 */

/** Smoothstepped keyframe track: [time, value] pairs. Flat outside the range; a repeated value holds. */
export function track(keys: readonly (readonly [number, number])[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t <= t1) {
      const u = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (u * u * (3 - 2 * u));
    }
  }
  return keys[keys.length - 1][1];
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export const smooth = (x: number): number => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};

/** The yaw and pitch that point a camera at `from` toward `to` (yaw 0 looks down −Z). */
export function yawPitchTo(from: THREE.Vector3, to: THREE.Vector3): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** `a` wrapped into −π..π. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * A point a distance `s` along a polyline, and which way it is heading there.
 * Out-of-range `s` clamps to the ends.
 */
export function alongPath(pts: readonly THREE.Vector3[], s: number, out: THREE.Vector3, dir?: THREE.Vector3): THREE.Vector3 {
  let left = Math.max(0, s);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = a.distanceTo(b);
    if (left <= len || i === pts.length - 2) {
      const u = len > 1e-6 ? Math.min(1, left / len) : 1;
      out.lerpVectors(a, b, u);
      if (dir && len > 1e-6) dir.subVectors(b, a).normalize();
      return out;
    }
    left -= len;
  }
  return out.copy(pts[pts.length - 1]);
}

/** A polyline's length. */
export function pathLength(pts: readonly THREE.Vector3[]): number {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) n += pts[i].distanceTo(pts[i + 1]);
  return n;
}
