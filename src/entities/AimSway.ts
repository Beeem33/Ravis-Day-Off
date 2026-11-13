/**
 * AimSway — the little life in a held aim: a slow drift with his breathing
 * (a fraction of a degree, never a full one), and now and then a light
 * twitch, out and back in a quarter of a second. It eases in as he comes up
 * on the sights and out again as he lowers. Radians, added to the view's
 * yaw and pitch, so the shot goes where the sights have drifted to.
 */
export class AimSway {
  /** Add these to the view (radians). */
  yaw = 0;
  pitch = 0;
  private t = Math.random() * 100;
  private k = 0;
  private twitch = 0;
  private twYaw = 0;
  private twPitch = 0;
  private next = 2 + Math.random() * 4;

  update(dt: number, aiming: boolean): void {
    this.k += ((aiming ? 1 : 0) - this.k) * Math.min(1, dt * 4);
    if (this.k < 0.001 && !aiming) {
      this.yaw = this.pitch = 0;
      return;
    }
    this.t += dt;
    const t = this.t;
    // Breathing: a slow lazy figure, a touch of shake on top
    const drift = 0.0017;
    const yaw = Math.sin(t * 0.83) * drift * 0.7 + Math.sin(t * 2.1 + 1.7) * drift * 0.25;
    const pitch = Math.sin(t * 0.41) * drift + Math.sin(t * 1.66 + 0.6) * drift * 0.45;
    // Every few seconds, a twitch: out and straight back
    this.next -= dt;
    if (aiming && this.next <= 0) {
      this.next = 2.5 + Math.random() * 5.5;
      this.twitch = 1;
      this.twYaw = (Math.random() - 0.5) * 0.0065;
      this.twPitch = (Math.random() - 0.5) * 0.0055;
    }
    this.twitch = Math.max(0, this.twitch - dt * 4.5);
    const env = this.twitch * (1 - this.twitch) * 4;
    this.yaw = (yaw + this.twYaw * env) * this.k;
    this.pitch = (pitch + this.twPitch * env) * this.k;
  }
}
