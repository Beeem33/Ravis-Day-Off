import * as THREE from 'three';
import { islandHeight, HAZE, HAZE_DENSITY, type IslandSite } from './Level19Sky';

/**
 * Level19Crash — the boss's jet, with nobody flying it, going in.
 *
 * JetCrashPath: from the door Ravi left by, the jet carries on nose-down and
 * swings round in a long descending turn onto an island picked at random a
 * few kilometres off, and hits its hillside. The way there is a curve over
 * the sea (a quadratic Bézier, walked at the jet's own building speed); the
 * height comes down on its own schedule, accelerating, to arrive on the
 * hill at the same moment. Everything is a function of the time since the
 * door, so any moment of it can be asked for (a checkpoint retry).
 *
 * CrashFx: what it leaves. Black smoke from it on the way down, a fireball
 * when it hits, and a column of smoke that goes on rising and spreading for
 * as long as Ravi is in the air to see it. Drawn as soft round points (one
 * draw each for the smoke and the fire), so nothing in it has an "up" to
 * turn with the view.
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export class JetCrashPath {
  readonly site: IslandSite;
  /** Where it hits (world). */
  readonly impact: THREE.Vector3;
  /** Seconds after the door that it hits. */
  readonly Ti: number;
  private p0: THREE.Vector2;
  private p1: THREE.Vector2;
  private p2: THREE.Vector2;
  private y0: number;
  private cum: number[] = [];
  private total = 0;
  private static readonly N = 256;

  /** `start`: the jet's origin as he leaves the door, with it heading −Z. */
  constructor(start: THREE.Vector3, sites: IslandSite[]) {
    // An island ahead or off to the side, a few kilometres off: never one behind (it couldn't turn round)
    const ok = sites.filter((s) => {
      const d = Math.hypot(s.x - start.x, s.z - start.z);
      return d > 3500 && d < 6500 && s.z < start.z - 1000;
    });
    const pool = ok.length ? ok : sites;
    this.site = pool[Math.floor(Math.random() * pool.length)];
    const s = this.site;
    this.p0 = new THREE.Vector2(start.x, start.z);
    // Into the near slope of its hill, from the way it comes in
    const c = new THREE.Vector2(s.x, s.z);
    const D = c.distanceTo(this.p0);
    const lead = Math.min(2600, D * 0.45);
    this.p1 = new THREE.Vector2(start.x, start.z - lead);
    const inDir = c.clone().sub(this.p1).normalize();
    this.p2 = c.clone().addScaledVector(inDir, -s.r * 0.42);
    const hitY = Math.max(2, islandHeight(s, this.p2.x, this.p2.y));
    this.y0 = start.y;
    // The length of the way, for walking it at the jet's speed
    let prev = this.p0.clone();
    this.cum.push(0);
    for (let i = 1; i <= JetCrashPath.N; i++) {
      const p = this.bez(i / JetCrashPath.N, new THREE.Vector2());
      this.total += p.distanceTo(prev);
      this.cum.push(this.total);
      prev = p;
    }
    // When it gets there: 88 m/s at the door, building 2.4 m/s every second
    this.Ti = (-88 + Math.sqrt(88 * 88 + 4 * 1.2 * this.total)) / (2 * 1.2);
    this.impact = V(this.p2.x, hitY, this.p2.y);
  }

  private bez(u: number, out: THREE.Vector2): THREE.Vector2 {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    return out.set(a * this.p0.x + b * this.p1.x + c * this.p2.x, a * this.p0.y + b * this.p1.y + c * this.p2.y);
  }

  private uAt(dist: number): number {
    const d = Math.min(this.total, Math.max(0, dist));
    let lo = 0;
    let hi = JetCrashPath.N;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] < d) lo = m;
      else hi = m;
    }
    const span = this.cum[hi] - this.cum[lo] || 1;
    return (lo + (d - this.cum[lo]) / span) / JetCrashPath.N;
  }

  private yawAt(u: number): number {
    const a = this.bez(Math.max(0, u - 0.002), new THREE.Vector2());
    const b = this.bez(Math.min(1, u + 0.002), new THREE.Vector2());
    return Math.atan2(-(b.x - a.x), -(b.y - a.y));
  }

  /** Where the jet is, and how it's lying, `tt` seconds after the door. */
  pose(tt: number, pos: THREE.Vector3, rot: THREE.Euler): void {
    const t = Math.min(tt, this.Ti);
    const dist = 88 * t + 1.2 * t * t;
    const u = this.uAt(dist);
    const p = this.bez(u, new THREE.Vector2());
    const k = t / this.Ti;
    const y = this.y0 - (this.y0 - this.impact.y) * k * k;
    pos.set(p.x, y, p.y);
    // Nose down along the way it's going down, steeper and steeper
    const vy = (2 * (this.y0 - this.impact.y) * t) / (this.Ti * this.Ti);
    const vh = 88 + 2.4 * t;
    const pitch = Math.min(-0.2 - Math.min(0.4, t * 0.03), -Math.atan2(vy, vh) - 0.04);
    // Banked into the turn (yaw going +: turning left, left wing down)
    const yaw = this.yawAt(u);
    const ahead = this.uAt(dist + vh * 0.5);
    let dy = this.yawAt(ahead) - yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const roll = THREE.MathUtils.clamp((dy / 0.5) * 2.2, -1.0, 1.0) + Math.sin(tt * 0.3) * 0.08;
    rot.set(pitch, yaw, roll, 'YXZ');
  }
}

/** A pool of soft round points: smoke (blended) or fire (added). */
class PointCloud {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private size: Float32Array;
  private col: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private rgb: Float32Array;
  private next = 0;
  private mat: THREE.ShaderMaterial;

  constructor(private max: number, additive: boolean) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.col = new Float32Array(max * 4);
    this.age = new Float32Array(max).fill(1e9);
    this.life = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.rgb = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 400 }, uHaze: { value: HAZE.clone() }, uDensity: { value: HAZE_DENSITY }, uAdd: { value: additive ? 1 : 0 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute vec4 aCol;
        uniform float uScale;
        varying vec4 vCol;
        varying float vDepth;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_PointSize = aCol.a > 0.0 ? clamp(aSize * uScale / max(1.0, -mv.z), 0.0, 1024.0) : 0.0;
          vCol = aCol;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uHaze;
        uniform float uDensity, uAdd;
        varying vec4 vCol;
        varying float vDepth;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.25, d) * vCol.a;
          if (a < 0.003) discard;
          float f = 1.0 - exp(-uDensity * uDensity * vDepth * vDepth);
          vec3 c = uAdd > 0.5 ? vCol.rgb : mix(vCol.rgb, uHaze, f);
          gl_FragColor = vec4(c, a * (uAdd > 0.5 ? (1.0 - f * 0.85) : 1.0));
          #include <colorspace_fragment>
        }
      `
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, life: number, s0: number, s1: number, alpha: number, c: THREE.Color): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.a0[i] = alpha;
    this.rgb.set([c.r, c.g, c.b], i * 3);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, height: number, drag: number, rise: number): void {
    this.mat.uniforms.uScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const k = Math.exp(-dt * drag);
    for (let i = 0; i < this.max; i++) {
      const age = (this.age[i] += dt);
      const life = this.life[i];
      if (age >= life) {
        this.col[i * 4 + 3] = 0;
        continue;
      }
      const f = age / life;
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + rise * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - f) * (1 - f));
      const fade = Math.min(1, age / 0.25) * (1 - f) * (1 - f);
      this.col[i * 4] = this.rgb[i * 3];
      this.col[i * 4 + 1] = this.rgb[i * 3 + 1];
      this.col[i * 4 + 2] = this.rgb[i * 3 + 2];
      this.col[i * 4 + 3] = this.a0[i] * fade;
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aCol') as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class CrashFx {
  readonly group = new THREE.Group();
  private smoke = new PointCloud(900, false);
  private fire = new PointCloud(260, true);
  private trailT = 0;
  private columnT = 0;
  /** Seconds since it went in (−1: not yet). */
  burning = -1;
  private at = new THREE.Vector3();
  private static _c = new THREE.Color();

  constructor() {
    this.group.add(this.smoke.points, this.fire.points);
  }

  /** Black smoke off the jet on its way down (`from`: its tail, world). */
  trail(dt: number, from: THREE.Vector3, k: number): void {
    this.trailT -= dt;
    if (this.trailT > 0 || k <= 0) return;
    this.trailT = 0.12;
    const c = CrashFx._c.setRGB(0.16, 0.15, 0.15);
    this.smoke.spawn(from, V((Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3), 28, 14, 120 + 80 * k, 0.75 * k, c);
  }

  /** It hits, at `p`. */
  ignite(p: THREE.Vector3): void {
    this.at.copy(p);
    this.burning = 0;
    // The fireball: a great boil of it, up and out, white-hot at the heart
    for (let i = 0; i < 120; i++) {
      const dir = V(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize();
      const sp = 70 + Math.random() * 190;
      const hot = Math.random();
      const c = CrashFx._c.setRGB(1.0, 0.32 + hot * 0.38, 0.06 + hot * 0.16);
      this.fire.spawn(p, dir.multiplyScalar(sp), 2.6 + Math.random() * 3.2, 120, 420 + Math.random() * 380, 0.6, c);
    }
    // And the first of the smoke, rolling out of it
    for (let i = 0; i < 80; i++) {
      const dir = V(Math.random() - 0.5, Math.random() * 0.6 + 0.2, Math.random() - 0.5).normalize();
      const c = CrashFx._c.setRGB(0.12, 0.11, 0.1);
      this.smoke.spawn(p, dir.multiplyScalar(50 + Math.random() * 110), 35 + Math.random() * 20, 200, 700 + Math.random() * 400, 0.9, c);
    }
  }

  update(dt: number, camera: THREE.PerspectiveCamera, height: number): void {
    if (this.burning >= 0) {
      this.burning += dt;
      // The column: it keeps coming, thick and black at the bottom, going grey and spreading as it climbs
      this.columnT -= dt;
      while (this.columnT <= 0) {
        this.columnT += 0.09;
        const c = CrashFx._c.setRGB(0.1 + Math.random() * 0.05, 0.095, 0.09);
        const p = this.at.clone().add(V((Math.random() - 0.5) * 200, 20, (Math.random() - 0.5) * 200));
        this.smoke.spawn(p, V((Math.random() - 0.5) * 12 + 8, 55 + Math.random() * 35, (Math.random() - 0.5) * 12), 50, 200, 800 + Math.random() * 450, 0.85, c);
      }
      // Fire still going at the foot of it
      if (Math.random() < dt * 14) {
        const c = CrashFx._c.setRGB(1.0, 0.5 + Math.random() * 0.3, 0.15);
        const p = this.at.clone().add(V((Math.random() - 0.5) * 240, 10, (Math.random() - 0.5) * 240));
        this.fire.spawn(p, V(0, 25 + Math.random() * 30, 0), 1.6 + Math.random(), 120, 260, 0.55, c);
      }
    }
    // (smoke slows in the air and lifts; the fireball's rush dies fast and it rises on its heat)
    this.smoke.update(dt, camera, height, 0.35, 1.5);
    this.fire.update(dt, camera, height, 1.6, 12);
  }

  /** Straight to `secs` after it went in, as if he'd been watching it burn all along (a checkpoint retry). */
  burnFor(p: THREE.Vector3, secs: number, camera: THREE.PerspectiveCamera, height: number): void {
    this.at.copy(p);
    this.burning = 0;
    for (let t = 0; t < Math.min(secs, 40); t += 0.1) this.update(0.1, camera, height);
  }
}
