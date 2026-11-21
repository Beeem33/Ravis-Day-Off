import * as THREE from 'three';
import type { ParticleManager } from './ParticleManager';
import type { CarRig } from '../scenes/Level8Contracts';

/**
 * FireClouds — what's left hanging over the road when a fuel tanker goes
 * up: a wall of fire and black smoke right across the carriageway, metres
 * high, burning down over several seconds. Nothing can be seen through it;
 * cover() says how much of a viewer's sight it takes (for the scene's
 * screen-wash), inside() how deep in it something is (for the ash and the
 * bits of tanker coming off it).
 */
interface Cloud {
  pos: THREE.Vector3;
  /** Half its width across the road, metres. */
  r: number;
  t: number;
  life: number;
}

const _p = new THREE.Vector3();

export class FireClouds {
  private readonly clouds: Cloud[] = [];

  constructor(private readonly particles: ParticleManager) {}

  /** A new one, centred at `pos` (on the road), `r` across, burning for `life` seconds. */
  add(pos: THREE.Vector3, r = 11, life = 11): void {
    this.clouds.push({ pos: pos.clone(), r, t: 0, life });
  }

  clear(): void {
    this.clouds.length = 0;
  }

  /** How strong a cloud is now (0..1): up in a flash, burning a while, dying back. */
  private strength(c: Cloud): number {
    const up = Math.min(1, c.t / 0.25);
    const down = Math.min(1, (c.life - c.t) / 3.5);
    return Math.max(0, Math.min(up, down));
  }

  update(dt: number): void {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.t += dt;
      if (c.t >= c.life) {
        this.clouds.splice(i, 1);
        continue;
      }
      const k = this.strength(c);
      // Fire right across it, lumps of it at every height; smoke rolling up off the top
      const n = 7;
      for (let j = 0; j < n; j++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random());
        _p.set(c.pos.x + Math.cos(a) * rr * c.r, c.pos.y + 0.2 + Math.random() * 5.5 * k, c.pos.z + Math.sin(a) * rr * c.r * 0.75);
        this.particles.fire(_p, 2.2 + Math.random() * 1.6, 1.3 * k);
      }
      for (let j = 0; j < 2; j++) {
        _p.set(c.pos.x + (Math.random() - 0.5) * c.r * 1.4, c.pos.y + 4 + Math.random() * 3, c.pos.z + (Math.random() - 0.5) * c.r);
        this.particles.smokeColumn(_p, 2.6, k);
      }
    }
  }

  /**
   * How much of the view from `eye` the fire takes (0 clear, 1 nothing but
   * fire). `fwd` (horizontal, the way he's going): once it's behind him it
   * clears fast — he's through it.
   */
  cover(eye: THREE.Vector3, fwd?: THREE.Vector3): number {
    let best = 0;
    for (const c of this.clouds) {
      const dx = c.pos.x - eye.x;
      const dz = c.pos.z - eye.z;
      const d = Math.hypot(dx, dz);
      const k = this.strength(c);
      const behind = fwd ? dx * fwd.x + dz * fwd.z < 0 : false;
      // From a little way off it fills the windscreen; inside, it's all there is; out the far side, gone
      const v = THREE.MathUtils.clamp(1 - (d - c.r * 0.45) / (c.r * (behind ? 0.35 : 1.6)), 0, 1) * k;
      if (eye.y > c.pos.y + 9) continue;
      best = Math.max(best, v);
    }
    return best;
  }

  /** How deep `pos` is in a cloud (0 out of it, 1 in the middle). */
  inside(pos: THREE.Vector3): number {
    let best = 0;
    for (const c of this.clouds) {
      const d = Math.hypot(pos.x - c.pos.x, pos.z - c.pos.z);
      best = Math.max(best, THREE.MathUtils.clamp(1 - d / (c.r + 4), 0, 1) * this.strength(c));
    }
    return best;
  }
}

/**
 * CarHail — ash, embers and little bits of torn metal coming at the car out
 * of a fire cloud as it drives through: flying at the glass, bouncing off
 * it, the bonnet and the roof, and away over the top. Car-local (the rig's
 * group frame: forward −Z), hung off the body like the interior.
 */
interface Bit {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  kind: 'ash' | 'ember' | 'metal';
  hits: number;
}

/** The windscreen, as a plane: its foot, and its outward normal (up and forward). */
const GLASS_FOOT = new THREE.Vector3(0, 0.89, -0.6);
const GLASS_TOP = new THREE.Vector3(0, 1.42, 0.24);
const GLASS_N = new THREE.Vector3(0, 0.84, -0.53).normalize();
const _r = new THREE.Vector3();

export class CarHail {
  private readonly group = new THREE.Group();
  private readonly bits: Bit[] = [];
  private readonly idle: Bit[] = [];
  private acc = 0;
  /** Called when a bit of metal rings off the glass or the panels. */
  onClink: (() => void) | null = null;

  constructor(rig: CarRig) {
    this.group.position.y = -rig.body.position.y;
    rig.body.add(this.group);
    const ashMat = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 1, side: THREE.DoubleSide });
    const greyMat = new THREE.MeshStandardMaterial({ color: 0x6b6762, roughness: 1, side: THREE.DoubleSide });
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff7a1e });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide });
    const flake = new THREE.PlaneGeometry(0.08, 0.06);
    const ember = new THREE.PlaneGeometry(0.03, 0.03);
    const shard = new THREE.BoxGeometry(0.09, 0.008, 0.06);
    const strip = new THREE.BoxGeometry(0.16, 0.006, 0.025);
    for (let i = 0; i < 170; i++) {
      const kind: Bit['kind'] = i % 10 < 6 ? 'ash' : i % 10 < 8 ? 'ember' : 'metal';
      const geo = kind === 'ash' ? flake : kind === 'ember' ? ember : i % 2 ? shard : strip;
      const mat = kind === 'ash' ? (i % 3 ? ashMat : greyMat) : kind === 'ember' ? emberMat : metalMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.idle.push({ mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, kind, hits: 0 });
    }
  }

  /**
   * A step. `rate` (0..1): how thick it's coming (how deep in the cloud the
   * car is). `speed`: the car's forward speed — what it all comes at the glass with.
   */
  update(dt: number, rate: number, speed: number): void {
    if (!(dt > 0)) return;
    // New ones out ahead of the car, coming at it
    this.acc += rate * 260 * dt;
    while (this.acc >= 1 && this.idle.length) {
      this.acc -= 1;
      // Mostly ash; the metal a bit rarer, the embers in between
      const pick = Math.random();
      const want: Bit['kind'] = pick < 0.6 ? 'ash' : pick < 0.82 ? 'ember' : 'metal';
      const k = this.idle.findIndex((b) => b.kind === want);
      const b = this.idle.splice(k >= 0 ? k : 0, 1)[0];
      b.pos.set((Math.random() - 0.5) * 2.4, 0.95 + Math.random() * 1.1, -(2.5 + Math.random() * 5));
      const v = Math.max(8, speed) * (0.85 + Math.random() * 0.2);
      b.vel.set((Math.random() - 0.5) * 2, (Math.random() - 0.6) * 1.5, v);
      b.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
      b.life = 0;
      b.hits = 0;
      b.mesh.visible = true;
      this.bits.push(b);
    }
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life += dt;
      const light = b.kind !== 'metal';
      // Ash floats: a lot of drag, little weight
      b.vel.y -= (light ? 2.5 : 9.8) * dt;
      if (light) b.vel.multiplyScalar(Math.exp(-dt * 0.8));
      b.pos.addScaledVector(b.vel, dt);
      this.bounce(b);
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
      if (b.pos.z > 4 || b.pos.y < 0 || b.life > 2.5) {
        b.mesh.visible = false;
        this.bits.splice(i, 1);
        this.idle.push(b);
      }
    }
  }

  /** Off the glass, the bonnet, the roof: a bounce off whichever it's gone into, scattered. */
  private bounce(b: Bit): void {
    const p = b.pos;
    const inWidth = Math.abs(p.x) < 0.8;
    if (!inWidth) return;
    const e = b.kind === 'metal' ? 0.45 : 0.15;
    // The windscreen
    _r.subVectors(p, GLASS_FOOT);
    const along = _r.y * 0.53 + _r.z * 0.84;
    const len = GLASS_FOOT.distanceTo(GLASS_TOP);
    const sd = _r.dot(GLASS_N);
    if (along > 0 && along < len && sd < 0 && sd > -0.25) {
      const vn = b.vel.dot(GLASS_N);
      if (vn < 0) {
        p.addScaledVector(GLASS_N, -sd + 0.01);
        b.vel.addScaledVector(GLASS_N, -(1 + e) * vn);
        b.vel.x += (Math.random() - 0.5) * 3;
        b.vel.y += Math.random() * 2;
        this.hit(b);
      }
      return;
    }
    // The bonnet, and the roof
    const top = p.z < -0.6 ? 0.93 : p.z > 0.24 && p.z < 1.9 ? 1.44 : -1;
    if (top > 0 && p.y < top && p.y > top - 0.2 && b.vel.y < 0) {
      p.y = top + 0.005;
      b.vel.y = -b.vel.y * e + Math.random();
      b.vel.x += (Math.random() - 0.5) * 2;
      this.hit(b);
    }
  }

  private hit(b: Bit): void {
    b.hits++;
    if (b.kind === 'metal' && b.hits <= 2) this.onClink?.();
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
