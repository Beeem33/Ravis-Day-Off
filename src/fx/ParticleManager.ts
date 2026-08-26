import * as THREE from 'three';

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
  floorY: number; // particles settle/die at this height (approx; -1 = never)
}

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (240.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.15, d);
    gl_FragColor = vec4(vColor, vAlpha * soft);
  }
`;

/**
 * One CPU-simulated particle pool rendered as a THREE.Points cloud.
 */
class ParticlePool {
  particles: Particle[] = [];
  points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private alphas: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, private max: number, additive: boolean) {
    for (let i = 0; i < max; i++) {
      this.particles.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        color: new THREE.Color(),
        gravity: 0,
        drag: 0,
        floorY: -1
      });
    }
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.alphas = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    life: number,
    size: number,
    color: THREE.Color,
    gravity: number,
    drag: number,
    floorY = -1
  ): void {
    const p = this.particles.find((x) => !x.alive) ?? this.particles[0];
    p.alive = true;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.color.copy(color);
    p.gravity = gravity;
    p.drag = drag;
    p.floorY = floorY;
  }

  /** Kill every live particle. The shader warm-up spawns throwaways. */
  clear(): void {
    for (const p of this.particles) p.alive = false;
    this.geo.setDrawRange(0, 0);
  }

  update(dt: number): void {
    let n = 0;
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      if (p.drag > 0) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.floorY > -0.5 && p.pos.y < p.floorY + 0.01) {
        p.pos.y = p.floorY + 0.01;
        p.vel.set(0, 0, 0);
        p.gravity = 0;
      }
      const i3 = n * 3;
      this.positions[i3] = p.pos.x;
      this.positions[i3 + 1] = p.pos.y;
      this.positions[i3 + 2] = p.pos.z;
      this.colors[i3] = p.color.r;
      this.colors[i3 + 1] = p.color.g;
      this.colors[i3 + 2] = p.color.b;
      this.sizes[n] = p.size;
      this.alphas[n] = Math.min(1, (p.life / p.maxLife) * 2);
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

/**
 * ParticleManager — pooled sparks, blood, debris, glass shards and tracers.
 */
export class ParticleManager {
  private solid: ParticlePool; // blood, chips, glass (normal blending)
  private glow: ParticlePool; // muzzle sparks (additive)
  private tracers: Tracer[] = [];
  private tracerGeo: THREE.CylinderGeometry;
  private scene: THREE.Scene;

  private static tmpV = new THREE.Vector3();
  private static UP = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.solid = new ParticlePool(scene, 1600, false);
    this.glow = new ParticlePool(scene, 400, true);
    this.tracerGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 5, 1, true);
  }

  update(dt: number): void {
    this.solid.update(dt);
    this.glow.update(dt);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      const mat = t.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, t.life / t.maxLife) * 0.75;
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        mat.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  /** Scatter velocity around a base direction. */
  private scatter(dir: THREE.Vector3, spread: number, speed: number): THREE.Vector3 {
    return new THREE.Vector3(
      dir.x + (Math.random() - 0.5) * spread,
      dir.y + (Math.random() - 0.5) * spread,
      dir.z + (Math.random() - 0.5) * spread
    )
      .normalize()
      .multiplyScalar(speed * (0.4 + Math.random() * 0.9));
  }

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3): void {
    const col = new THREE.Color(1.0, 0.75, 0.3);
    for (let i = 0; i < 6; i++) {
      this.glow.spawn(pos, this.scatter(dir, 0.9, 5), 0.05 + Math.random() * 0.05, 0.5, col, 0, 6);
    }
    this.glow.spawn(pos, new THREE.Vector3(0, 0.3, 0), 0.06, 1.4, new THREE.Color(1, 0.9, 0.6), 0, 0);
  }

  /**
   * Wound spray. Most of it is an EXIT jet continuing along the bullet's
   * path (tight cone, fast), with a smaller entry splash back toward the
   * shooter and a little mist — so every kill reads as "bullet went
   * through" in that direction, and no two look alike.
   */
  bloodSpray(pos: THREE.Vector3, dir: THREE.Vector3, big: boolean, floorY: number): void {
    const jet = (big ? 34 : 14) + Math.floor(Math.random() * 10);
    const exitSpeed = 5 + Math.random() * 3.5;
    const cone = 0.35 + Math.random() * 0.3; // per-kill variation in how tight the jet is
    const exitPos = pos.clone().addScaledVector(dir, 0.18); // start just behind the body
    for (let i = 0; i < jet; i++) {
      const c = new THREE.Color().setHSL(0.995, 0.9, 0.1 + Math.random() * 0.2);
      this.solid.spawn(
        exitPos,
        this.scatter(dir, cone, exitSpeed),
        0.4 + Math.random() * 0.55,
        0.12 + Math.random() * 0.22,
        c,
        13,
        0.5,
        floorY
      );
    }
    // Entry splash: a few drops kicked back toward the shooter
    const back = dir.clone().negate();
    for (let i = 0; i < (big ? 8 : 4); i++) {
      const c = new THREE.Color().setHSL(0.995, 0.9, 0.15 + Math.random() * 0.15);
      this.solid.spawn(pos, this.scatter(back, 1.6, 1.8), 0.3 + Math.random() * 0.3, 0.1 + Math.random() * 0.12, c, 12, 0.8, floorY);
    }
    // Fine mist hanging at the wound, drifting with the exit direction
    for (let i = 0; i < (big ? 18 : 8); i++) {
      const c = new THREE.Color().setHSL(0.99, 0.85, 0.22);
      this.solid.spawn(pos, this.scatter(dir, 1.8, 1.6), 0.18 + Math.random() * 0.25, 0.08, c, 5, 1.6, floorY);
    }
  }

  concreteChips(pos: THREE.Vector3, normal: THREE.Vector3, tint = 0xb9b3a8): void {
    const base = new THREE.Color(tint);
    for (let i = 0; i < 10; i++) {
      const c = base.clone().multiplyScalar(0.7 + Math.random() * 0.5);
      this.solid.spawn(pos, this.scatter(normal, 1.6, 3.2), 0.25 + Math.random() * 0.3, 0.06 + Math.random() * 0.08, c, 12, 0.8);
    }
    this.glow.spawn(pos, normal.clone().multiplyScalar(1.5), 0.05, 0.35, new THREE.Color(1, 0.85, 0.5), 0, 0);
  }

  glassShards(pos: THREE.Vector3, dir: THREE.Vector3, floorY: number): void {
    const c1 = new THREE.Color(0.75, 0.88, 0.92);
    for (let i = 0; i < 34; i++) {
      const c = c1.clone().multiplyScalar(0.6 + Math.random() * 0.6);
      this.solid.spawn(
        pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.2)),
        this.scatter(dir, 2.4, 3.5),
        0.5 + Math.random() * 0.6,
        0.05 + Math.random() * 0.09,
        c,
        16,
        0.4,
        floorY
      );
    }
  }

  /** Drop every live particle and tracer — used after the shader warm-up. */
  clear(): void {
    this.solid.clear();
    this.glow.clear();
    for (const t of this.tracers) this.scene.remove(t.mesh);
    this.tracers.length = 0;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffd9a0): void {
    const len = from.distanceTo(to);
    if (len < 0.4) return;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(this.tracerGeo, mat);
    const dir = ParticleManager.tmpV.copy(to).sub(from).normalize();
    mesh.quaternion.setFromUnitVectors(ParticleManager.UP, dir);
    mesh.position.copy(from).addScaledVector(dir, len / 2);
    mesh.scale.set(1, len, 1);
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.07, maxLife: 0.07 });
  }
}
