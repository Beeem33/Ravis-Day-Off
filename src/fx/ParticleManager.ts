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
 * The same droplet, but taking the scene's lights (the renderer fills in
 * three's light uniforms when a material asks for them). A droplet has no
 * facing to speak of, so it takes a bit over half of each light, as a round
 * drop does on average; the colour is its albedo, not a glow. In the dark,
 * spray is only seen in the torch.
 */
const LIT_POINT_VERT = /* glsl */ `
  #include <common>
  #include <lights_pars_begin>
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 ambient = ambientLightColor;
    vec3 direct = vec3(0.0);
    IncidentLight l;
    #if NUM_POINT_LIGHTS > 0
    for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
      getPointLightInfo(pointLights[i], mv.xyz, l);
      direct += l.color;
    }
    #endif
    #if NUM_SPOT_LIGHTS > 0
    for (int i = 0; i < NUM_SPOT_LIGHTS; i++) {
      getSpotLightInfo(spotLights[i], mv.xyz, l);
      direct += l.color;
    }
    #endif
    #if NUM_DIR_LIGHTS > 0
    for (int i = 0; i < NUM_DIR_LIGHTS; i++) direct += directionalLights[i].color;
    #endif
    #if NUM_HEMI_LIGHTS > 0
    for (int i = 0; i < NUM_HEMI_LIGHTS; i++) ambient += 0.5 * (hemisphereLights[i].skyColor + hemisphereLights[i].groundColor);
    #endif
    vec3 light = ambient + 0.6 * direct;
    vColor = pow(aColor, vec3(2.2)) * light * RECIPROCAL_PI;
    gl_PointSize = aSize * (240.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const LIT_POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.15, d);
    gl_FragColor = vec4(vColor, vAlpha * soft);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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

  constructor(scene: THREE.Scene, private max: number, additive: boolean, lit = false) {
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
      vertexShader: lit ? LIT_POINT_VERT : POINT_VERT,
      fragmentShader: lit ? LIT_POINT_FRAG : POINT_FRAG,
      uniforms: lit ? THREE.UniformsUtils.clone(THREE.UniformsLib.lights) : {},
      lights: lit,
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

// ------------------------------------------------------------------ smoke

/**
 * A puff of smoke or dust. Not a droplet like the rest: a soft, lumpy card
 * that swells as it ages, fades in as well as out, turns slowly, and either
 * lifts (warm smoke) or hangs low (dust). Sizes are real diameters in metres.
 */
interface Puff {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  /** Diameter at birth and at death, metres. It swells fast, then slowly. */
  size0: number;
  size1: number;
  /** Peak opacity, reached after `fadeIn` of its life. */
  alpha: number;
  fadeIn: number;
  color: THREE.Color;
  /** Upward acceleration, m/s²: warm smoke rises, dust barely does. */
  lift: number;
  drag: number;
  /** The ground under it: the puff's middle is held a fifth of its width above this. */
  floorY: number;
  /** How much of the breeze takes it, 0..1. */
  wind: number;
  angle: number;
  spin: number;
  seed: number;
}

const NO_FLOOR = -1e9;

/**
 * A light breeze across everything, m/s. Smoke that only ever rises straight
 * up reads as indoors; a little drift to one side is what makes a cloud of it
 * look like it is out in the open air. It only takes a puff once the puff has
 * lost the shove it was born with.
 */
const BREEZE = new THREE.Vector3(0.5, 0, -0.22);

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Lighting for the dark levels, the same as the lit droplets above: a puff
 * takes the ambient and a bit over half of each light. Kept apart so the smoke
 * shader can be built with or without it.
 */
const SMOKE_LIGHT = /* glsl */ `
    vec3 ambient = ambientLightColor;
    vec3 direct = vec3(0.0);
    IncidentLight l;
    #if NUM_POINT_LIGHTS > 0
    for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
      getPointLightInfo(pointLights[i], mv.xyz, l);
      direct += l.color;
    }
    #endif
    #if NUM_SPOT_LIGHTS > 0
    for (int i = 0; i < NUM_SPOT_LIGHTS; i++) {
      getSpotLightInfo(spotLights[i], mv.xyz, l);
      direct += l.color;
    }
    #endif
    #if NUM_DIR_LIGHTS > 0
    for (int i = 0; i < NUM_DIR_LIGHTS; i++) direct += directionalLights[i].color;
    #endif
    #if NUM_HEMI_LIGHTS > 0
    for (int i = 0; i < NUM_HEMI_LIGHTS; i++) ambient += 0.5 * (hemisphereLights[i].skyColor + hemisphereLights[i].groundColor);
    #endif
    vColor = pow(iColor, vec3(2.2)) * (ambient + 0.6 * direct) * RECIPROCAL_PI;
`;

/**
 * Smoke is drawn as camera-facing cards, not GL points like the droplets.
 * A point's size is in pixels and every GPU caps it (often at a few hundred), so a
 * three-metre cloud of tyre smoke a few metres from the camera would stop
 * growing on screen just as it should fill it — and a point can't be turned.
 * A card is sized in metres, so it looks the same at any resolution and any
 * field of view (the chase zooms in to 48°), and it can roll as it billows.
 *
 * Two more tricks, both about getting close. A flat card through the middle
 * of a puff is cut off in a hard line wherever something solid passes in
 * front of its middle — so each card is drawn pulled toward the camera by
 * half its radius (its depth is the front of the puff, not the middle; the
 * size is corrected so it covers the same patch of screen). And a puff fades
 * out as the camera gets inside it, rather than slapping a wall of grey
 * across the lens.
 */
const smokeVert = (lit: boolean): string => /* glsl */ `
  ${lit ? '#include <common>\n  #include <lights_pars_begin>' : ''}
  attribute vec3 iPos;
  attribute vec4 iParams; // diameter (m), opacity, turn (rad), seed
  attribute vec3 iColor;
  varying vec2 vQ;
  varying vec2 vUp;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    ${lit ? SMOKE_LIGHT : 'vColor = iColor;'}
    float r = 0.5 * iParams.x;
    float len = length(mv.xyz);
    float pull = min(0.5 * r, max(0.0, len - 0.3));
    float k = 1.0 - pull / max(len, 1e-4);
    mv.xyz *= k;
    float c = cos(iParams.z);
    float s = sin(iParams.z);
    vec2 q = position.xy;
    mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y) * iParams.x * k;
    vQ = q;
    vUp = vec2(s, c); // screen-up, in the card's own turned frame
    vSeed = iParams.w;
    vAlpha = iParams.y * smoothstep(0.3 * r, 1.1 * r + 0.35, len);
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * The puff itself: two octaves of value noise (seeded per puff, turning with
 * the card) eat into a soft disc, so the rim is lumpy and the inside clotted
 * — a cloud of these overlapping reads as billowing rather than as a stack of
 * discs. It is lit from above (the top of a puff is in the sun, its belly in
 * its own shade) and thinner at the bottom, where it meets the ground.
 */
const smokeFrag = (lit: boolean): string => /* glsl */ `
  varying vec2 vQ;
  varying vec2 vUp;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  void main() {
    float d = length(vQ) * 2.0;
    if (d > 1.0) discard;
    vec2 o = vec2(vSeed * 61.7, vSeed * 23.3);
    float n = 0.62 * vnoise(vQ * 3.6 + o) + 0.38 * vnoise(vQ * 8.2 - o);
    float body = 1.0 - smoothstep(0.18, 0.92, d + (n - 0.5) * 0.5);
    body *= 1.0 - smoothstep(0.78, 1.0, d);
    float dens = body * (0.55 + 0.9 * n);
    float h = dot(vQ, vUp) * 2.0; // -1 underneath .. 1 on top
    float shade = 0.9 + 0.15 * h + 0.16 * (n - 0.5);
    float a = vAlpha * dens * (0.7 + 0.3 * smoothstep(-1.0, 0.1, h));
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * shade, min(a, 1.0));
    ${lit ? '#include <tonemapping_fragment>\n    #include <colorspace_fragment>' : ''}
  }
`;

/**
 * Its own pool, so a burnout can't starve the blood: tyre smoke, exhaust and
 * dust all live here. Spawning walks from a cursor rather than from the start
 * — puffs die in about the order they were born, so the next slot along is
 * nearly always free and a burst of twenty costs twenty steps, not twenty
 * scans of the pool. When it is full, the one under the cursor (the oldest,
 * near enough, and so the faintest) is recycled.
 */
class SmokePool {
  readonly mesh: THREE.Mesh;
  private puffs: Puff[] = [];
  private cursor = 0;
  private geo: THREE.InstancedBufferGeometry;
  private iPos: THREE.InstancedBufferAttribute;
  private iParams: THREE.InstancedBufferAttribute;
  private iColor: THREE.InstancedBufferAttribute;
  /** Each instanced attribute and its floats per puff, for the per-frame upload. */
  private uploads: [THREE.InstancedBufferAttribute, number][];

  constructor(scene: THREE.Scene, private max: number, lit: boolean) {
    for (let i = 0; i < max; i++) {
      this.puffs.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        life: 1,
        size0: 1,
        size1: 1,
        alpha: 1,
        fadeIn: 0.1,
        color: new THREE.Color(),
        lift: 0,
        drag: 0,
        floorY: NO_FLOOR,
        wind: 1,
        angle: 0,
        spin: 0,
        seed: 0
      });
    }
    // One unit card, drawn once per live puff
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3)
    );
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.iParams = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.uploads = [
      [this.iPos, 3],
      [this.iParams, 4],
      [this.iColor, 3]
    ];
    for (const [a] of this.uploads) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iParams', this.iParams);
    this.geo.setAttribute('iColor', this.iColor);
    this.geo.instanceCount = 0;

    const mat = new THREE.ShaderMaterial({
      vertexShader: smokeVert(lit),
      fragmentShader: smokeFrag(lit),
      uniforms: lit ? THREE.UniformsUtils.clone(THREE.UniformsLib.lights) : {},
      lights: lit,
      transparent: true,
      depthWrite: false,
      // The cards always face the camera; no culling, and one pass (three
      // would otherwise draw a transparent double-sided thing twice)
      side: THREE.DoubleSide,
      forceSinglePass: true,
      blending: THREE.NormalBlending
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    // The base card sits at the origin; nothing should ever be able to hit it
    this.mesh.raycast = () => {};
    scene.add(this.mesh);
  }

  /** A fresh puff with sensible defaults; the caller fills in the rest. */
  spawn(): Puff {
    let p: Puff | null = null;
    for (let k = 0; k < this.max; k++) {
      const i = (this.cursor + k) % this.max;
      if (!this.puffs[i].alive) {
        p = this.puffs[i];
        this.cursor = (i + 1) % this.max;
        break;
      }
    }
    if (!p) {
      p = this.puffs[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
    }
    p.alive = true;
    p.age = 0;
    p.fadeIn = 0.1;
    p.lift = 0;
    p.drag = 0;
    p.floorY = NO_FLOOR;
    p.wind = 1;
    p.angle = Math.random() * Math.PI * 2;
    p.spin = (Math.random() - 0.5) * 1.1;
    p.seed = Math.random();
    return p;
  }

  clear(): void {
    for (const p of this.puffs) p.alive = false;
    this.geo.instanceCount = 0;
  }

  update(dt: number): void {
    const pos = this.iPos.array as Float32Array;
    const par = this.iParams.array as Float32Array;
    const col = this.iColor.array as Float32Array;
    let n = 0;
    for (const p of this.puffs) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      const t = p.age / p.life;
      p.vel.y += p.lift * dt;
      if (p.drag > 0) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const w = p.wind * Math.min(1, p.age * 0.8) * dt;
      p.pos.x += BREEZE.x * w;
      p.pos.z += BREEZE.z * w;
      // Swells fast while it's fresh, then hardly at all
      const size = p.size0 + (p.size1 - p.size0) * (1 - (1 - t) * (1 - t));
      // A puff can't sink into the ground, so as it grows it spreads upward
      // instead: a cloud on the asphalt keeps its belly on the asphalt.
      const minY = p.floorY + size * 0.2;
      if (p.pos.y < minY) {
        p.pos.y = minY;
        if (p.vel.y < 0) p.vel.y = 0;
      }
      p.angle += p.spin * dt;
      const fin = p.fadeIn > 0 ? smoothstep(0, p.fadeIn, t) : 1;
      const alpha = p.alpha * fin * (1 - smoothstep(0.3, 1, t));

      const i3 = n * 3;
      const i4 = n * 4;
      pos[i3] = p.pos.x;
      pos[i3 + 1] = p.pos.y;
      pos[i3 + 2] = p.pos.z;
      par[i4] = size;
      par[i4 + 1] = alpha;
      par[i4 + 2] = p.angle;
      par[i4 + 3] = p.seed;
      col[i3] = p.color.r;
      col[i3 + 1] = p.color.g;
      col[i3 + 2] = p.color.b;
      n++;
    }
    this.geo.instanceCount = n;
    if (n === 0) return;
    // Only the live part goes to the GPU
    for (const [a, size] of this.uploads) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * size);
      a.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ sparks

/** One hot fleck of metal, drawn as a streak: head where it is, tail where it was a moment ago. */
interface Spark {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  /** 0..1, how bright it starts (a few are duller, which keeps a burst from looking stamped). */
  heat: number;
  gravity: number;
  drag: number;
  floorY: number;
}

const SPARK_VERT = /* glsl */ `
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SPARK_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

/**
 * Metal sparks as additive line streaks. A point spark is a dot, and a dot
 * thirty metres off — a round glancing off the General's armour — is a
 * pixel; a spark the eye actually reads is the smear it leaves, so each is
 * a segment from where it is back along its velocity (about a camera
 * shutter's worth). The head is white-yellow and the tail fades to black,
 * which under additive blending is nothing, so every streak tapers. They
 * cool from yellow to deep orange as they fall, and skitter when they hit
 * the ground instead of stopping dead.
 */
class SparkPool {
  readonly lines: THREE.LineSegments;
  private sparks: Spark[] = [];
  private cursor = 0;
  private positions: Float32Array;
  private colors: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  /** Both of the above, for the per-frame upload (kept, not rebuilt every frame). */
  private uploads: THREE.BufferAttribute[];
  private geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, private max: number) {
    for (let i = 0; i < max; i++) {
      this.sparks.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        life: 1,
        heat: 1,
        gravity: 0,
        drag: 0,
        floorY: -1
      });
    }
    this.positions = new Float32Array(max * 6);
    this.colors = new Float32Array(max * 6);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.uploads = [this.posAttr, this.colAttr];
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aColor', this.colAttr);
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.lines = new THREE.LineSegments(this.geo, mat);
    this.lines.frustumCulled = false;
    this.lines.raycast = () => {};
    scene.add(this.lines);
  }

  spawn(): Spark {
    let s: Spark | null = null;
    for (let k = 0; k < this.max; k++) {
      const i = (this.cursor + k) % this.max;
      if (!this.sparks[i].alive) {
        s = this.sparks[i];
        this.cursor = (i + 1) % this.max;
        break;
      }
    }
    if (!s) {
      s = this.sparks[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
    }
    s.alive = true;
    s.age = 0;
    return s;
  }

  clear(): void {
    for (const s of this.sparks) s.alive = false;
    this.geo.setDrawRange(0, 0);
  }

  update(dt: number): void {
    let n = 0;
    for (const s of this.sparks) {
      if (!s.alive) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.alive = false;
        continue;
      }
      // The same integration as the glow pool, so a spark and the hot point
      // spawned with it travel together for as long as the point lives
      s.vel.y -= s.gravity * dt;
      if (s.drag > 0) s.vel.multiplyScalar(Math.max(0, 1 - s.drag * dt));
      s.pos.addScaledVector(s.vel, dt);
      if (s.floorY > -0.5 && s.pos.y < s.floorY + 0.005 && s.vel.y < 0) {
        // Skitter: a low bounce that loses most of its run each time
        s.pos.y = s.floorY + 0.005;
        s.vel.y *= -0.3;
        s.vel.x *= 0.55;
        s.vel.z *= 0.55;
      }
      const t = s.age / s.life;
      // White-yellow when it leaves, through orange, to a dull red ember
      const fade = Math.pow(1 - t, 1.3) * s.heat;
      const r = fade;
      const g = fade * (0.92 - 0.6 * t);
      const b = fade * Math.max(0, 0.55 - 1.1 * t);
      // The tail: back along the velocity, as far as a shutter would smear it
      const speed = s.vel.length();
      let tl = Math.min(0.6, Math.max(0.035, speed * 0.032));
      let tx = 0;
      let ty = 1;
      let tz = 0;
      if (speed > 0.05) {
        tx = s.vel.x / speed;
        ty = s.vel.y / speed;
        tz = s.vel.z / speed;
      } else tl = 0.03;

      const i6 = n * 6;
      this.positions[i6] = s.pos.x;
      this.positions[i6 + 1] = s.pos.y;
      this.positions[i6 + 2] = s.pos.z;
      this.positions[i6 + 3] = s.pos.x - tx * tl;
      this.positions[i6 + 4] = s.pos.y - ty * tl;
      this.positions[i6 + 5] = s.pos.z - tz * tl;
      this.colors[i6] = r;
      this.colors[i6 + 1] = g;
      this.colors[i6 + 2] = b;
      this.colors[i6 + 3] = r * 0.1;
      this.colors[i6 + 4] = g * 0.06;
      this.colors[i6 + 5] = 0;
      n++;
    }
    this.geo.setDrawRange(0, n * 2);
    if (n === 0) return;
    for (const a of this.uploads) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 6);
      a.needsUpdate = true;
    }
  }
}

/** Tyre smoke puffs per second at amount 1, for each tyre that calls it every frame. */
const TYRE_SMOKE_RATE = 46;
/** Most puffs one call may spawn, however long the frame or large the amount. */
const TYRE_SMOKE_CAP = 18;

/**
 * ParticleManager — pooled sparks, blood, debris, glass shards and tracers,
 * and (in pools of their own) smoke, dust and metal sparks.
 */
export class ParticleManager {
  private solid: ParticlePool; // blood, chips, glass (normal blending)
  private smoke: SmokePool; // tyre smoke, exhaust, dust clouds (soft cards)
  private glow: ParticlePool; // muzzle sparks (additive)
  private streaks: SparkPool; // metal sparks (additive lines)
  private tracers: Tracer[] = [];
  private tracerGeo: THREE.CylinderGeometry;
  private scene: THREE.Scene;
  /** Last frame's step, so an emitter called every frame emits at a steady rate whatever the frame rate. */
  private frameDt = 1 / 60;

  private static tmpV = new THREE.Vector3();
  private static tmpD = new THREE.Vector3();
  /** Scratch colour for spawns: the pools copy it, so one does for every call. */
  private static tmpC = new THREE.Color();
  private static UP = new THREE.Vector3(0, 1, 0);
  /** The sparks' white-hot heads and the flash where they strike. A scrape calls sparks() every frame. */
  private static SPARK_HOT = new THREE.Color(1, 0.86, 0.52);
  private static SPARK_FLASH = new THREE.Color(1, 0.8, 0.45);

  /** `lit`: blood, chips and smoke take the scene's lighting (dark levels). */
  constructor(scene: THREE.Scene, opts: { lit?: boolean } = {}) {
    this.scene = scene;
    this.solid = new ParticlePool(scene, 1600, false, opts.lit ?? false);
    // Made between the two point pools, so it draws after the blood and
    // before the glow: sparks stay bright in front of a cloud.
    this.smoke = new SmokePool(scene, 720, opts.lit ?? false);
    this.glow = new ParticlePool(scene, 400, true);
    this.streaks = new SparkPool(scene, 320);
    this.tracerGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 5, 1, true);
  }

  update(dt: number): void {
    // Only a real step counts: the shader warm-up (and any paused frame)
    // steps by zero, and latching that would leave every emitter silent for
    // the frame after — a burnout that starts with a stutter of no smoke.
    if (dt > 0) this.frameDt = Math.min(0.1, dt);
    this.solid.update(dt);
    this.smoke.update(dt);
    this.glow.update(dt);
    this.streaks.update(dt);
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
   * A 12 gauge's parting gift: burning powder thrown out of the bore, then
   * the smoke it leaves hanging. Spawned in world space, so it stays where
   * the shot was fired rather than riding the camera around.
   */
  barrelSmoke(pos: THREE.Vector3, dir: THREE.Vector3): void {
    // The bright head of it — unburnt powder, gone in a blink
    const ember = new THREE.Color(1.0, 0.62, 0.22);
    for (let i = 0; i < 10; i++) {
      this.glow.spawn(pos, this.scatter(dir, 0.5, 7), 0.06 + Math.random() * 0.07, 0.35, ember, 0, 7);
    }
    // The cloud: shoved out of the bore, slowed hard by drag, then drifting
    // up. Mixed sizes and lifetimes so it breaks up instead of moving as one
    // lump, and a negative gravity because warm smoke lifts.
    const ahead = pos.clone().addScaledVector(dir, 0.12);
    for (let i = 0; i < 22; i++) {
      const shade = 0.34 + Math.random() * 0.26;
      const col = new THREE.Color(shade, shade * 0.97, shade * 0.92);
      const vel = this.scatter(dir, 0.55, 1.6);
      vel.y += 0.25 + Math.random() * 0.4;
      this.solid.spawn(
        ahead.clone().addScaledVector(dir, Math.random() * 0.18),
        vel,
        0.75 + Math.random() * 0.85,
        0.16 + Math.random() * 0.22,
        col,
        -0.22,
        2.6
      );
    }
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

  /**
   * The air punched out of a man: a short burst of spit from the mouth, pale
   * and fast, falling almost at once. What makes a gut punch read as landing.
   */
  spit(pos: THREE.Vector3, dir: THREE.Vector3, floorY: number): void {
    for (let i = 0; i < 18; i++) {
      const c = new THREE.Color().setHSL(0.1, 0.1, 0.55 + Math.random() * 0.2);
      this.solid.spawn(pos, this.scatter(dir, 0.9, 2.6), 0.25 + Math.random() * 0.3, 0.02 + Math.random() * 0.03, c, 11, 1.2, floorY);
    }
  }

  /** Sparks off a short: a burst of hot blue-white points that fall and die. */
  electricSparks(pos: THREE.Vector3, count = 10): void {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const c = new THREE.Color().setHSL(0.52 + Math.random() * 0.08, 0.9, 0.7 + Math.random() * 0.25);
      this.glow.spawn(pos, this.scatter(up, 1.4, 3.6), 0.18 + Math.random() * 0.3, 0.05 + Math.random() * 0.05, c, 9, 0.6);
    }
    this.glow.spawn(pos, up.clone().multiplyScalar(0.2), 0.07, 0.5, new THREE.Color(0.7, 0.95, 1), 0, 0);
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

  // ------------------------------------------------------------- the car park

  /** `dir` as a unit vector (in a scratch vector), or zero if it hasn't one. */
  private unit(dir: THREE.Vector3): THREE.Vector3 {
    const d = ParticleManager.tmpD.copy(dir);
    const l = d.length();
    return l > 1e-5 ? d.multiplyScalar(1 / l) : d.set(0, 0, 0);
  }

  /**
   * Burnout smoke off a spinning tyre: big, pale, sunlit puffs thrown off
   * the contact patch along `dir` (the way the tread is flinging it — behind
   * a driven wheel), shoved out fast, then swelling to three or four metres
   * and lifting as the rubber smoke cools, until the breeze takes it.
   *
   * An emitter: call it every frame for each smoking tyre, `pos` at the
   * tyre's contact patch. It spawns at a steady rate (about 46 puffs a second
   * at amount 1) whatever the frame rate, so `amount` is how hard the tyre is
   * smoking — 1 a full burnout, 0.3 a chirp pulling away. A one-off call
   * spawns a puff at most; for a single burst pass a large amount.
   */
  tyreSmoke(pos: THREE.Vector3, dir: THREE.Vector3, amount = 1): void {
    if (!(amount > 0)) return;
    const n = Math.min(TYRE_SMOKE_CAP, Math.floor(amount * TYRE_SMOKE_RATE * this.frameDt + Math.random()));
    if (n <= 0) return;
    const d = this.unit(dir);
    // Light smoke is thin smoke, not just less of it
    const thick = 0.55 + 0.45 * Math.min(1, amount);
    for (let i = 0; i < n; i++) {
      const p = this.smoke.spawn();
      p.pos.set(pos.x + (Math.random() - 0.5) * 0.35, pos.y + Math.random() * 0.12, pos.z + (Math.random() - 0.5) * 0.35);
      const sp = 1.6 + Math.random() * 2.8;
      p.vel.set(
        d.x * sp + (Math.random() - 0.5) * 1.6,
        d.y * sp + 0.45 + Math.random() * 0.9,
        d.z * sp + (Math.random() - 0.5) * 1.6
      );
      p.drag = 1.15;
      p.lift = 0.35 + Math.random() * 0.35;
      p.life = 2 + Math.random() * 1.5;
      p.size0 = 0.55 + Math.random() * 0.35;
      p.size1 = 2.6 + Math.random() * 1.3;
      p.alpha = (0.4 + Math.random() * 0.22) * thick;
      p.fadeIn = 0.07;
      // Off-white, a touch cool: burnt rubber smoke in daylight
      const shade = 0.82 + Math.random() * 0.09;
      p.color.setRGB(shade, shade * 1.005, shade * 1.025);
      p.floorY = pos.y - 0.12;
      p.wind = 1;
    }
  }

  /**
   * A heavy landing kicking up the lot: a ring of grey-brown dust punched
   * out along the ground from `pos` — fast at first, dragging to a stop at
   * about `radius` — with a lazier cloud rolling up in the middle and a few
   * chunks of grit thrown out. One call per landing (a thrown car, a stomp,
   * the General going down); `amount` (up to 2) scales how much of it there is.
   */
  dust(pos: THREE.Vector3, radius: number, amount = 1): void {
    if (!(amount > 0)) return;
    const r = Math.max(0.5, radius);
    const k = Math.min(2, amount);
    // Sizes grow with the blast, so a stomp's ring isn't just a car landing's with more puffs
    const d0 = 0.5 + 0.07 * r;
    const d1 = 1.5 + 0.2 * r;
    const tint = (p: Puff): void => {
      const v = 0.88 + Math.random() * 0.22;
      p.color.setRGB(0.6 * v, 0.55 * v, 0.47 * v);
    };

    // The ring. With drag D a puff coasts about v/D before it stops, so each
    // one's speed is picked for where it should come to rest.
    const DRAG = 3.2;
    const ring = Math.min(56, Math.max(6, Math.round((12 + r * 2.6) * k)));
    for (let i = 0; i < ring; i++) {
      const a = ((i + (Math.random() - 0.5) * 0.8) / ring) * Math.PI * 2;
      const sp = r * (0.55 + Math.random() * 0.45) * DRAG;
      const p = this.smoke.spawn();
      p.pos.set(pos.x + Math.cos(a) * 0.3, pos.y + 0.1, pos.z + Math.sin(a) * 0.3);
      p.vel.set(Math.cos(a) * sp, 0.3 + Math.random() * 0.7, Math.sin(a) * sp);
      p.drag = DRAG;
      p.lift = 0.15;
      p.life = 1.3 + Math.random() * 1.1;
      p.size0 = d0 * (0.7 + Math.random() * 0.4);
      p.size1 = d1 * (0.75 + Math.random() * 0.45);
      p.alpha = 0.42 + Math.random() * 0.18;
      p.fadeIn = 0.03;
      tint(p);
      p.floorY = pos.y;
      p.wind = 0.4;
    }

    // The middle: a slower column that rolls up and hangs
    const core = Math.min(14, Math.max(2, Math.round((3 + r * 0.6) * k)));
    for (let i = 0; i < core; i++) {
      const p = this.smoke.spawn();
      p.pos.set(pos.x + (Math.random() - 0.5) * 0.6, pos.y + 0.2, pos.z + (Math.random() - 0.5) * 0.6);
      p.vel.set((Math.random() - 0.5) * 3, 0.8 + Math.random() * 1.4, (Math.random() - 0.5) * 3);
      p.drag = 1.6;
      p.lift = 0.25;
      p.life = 1.8 + Math.random() * 1.1;
      p.size0 = d0 * 1.2;
      p.size1 = d1 * (1 + Math.random() * 0.3);
      p.alpha = 0.38 + Math.random() * 0.16;
      p.fadeIn = 0.05;
      tint(p);
      p.floorY = pos.y;
      p.wind = 0.6;
    }

    // Grit and bits of asphalt: they fly, fall, and lie where they land
    const chunks = Math.min(14, Math.max(2, Math.round((4 + r * 0.7) * k)));
    const floor = pos.y > -0.5 ? pos.y + 0.01 : -1;
    const vel = ParticleManager.tmpV;
    for (let i = 0; i < chunks; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4 + r * 0.2;
      vel.set(Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp);
      const v = 0.18 + Math.random() * 0.22;
      const c = ParticleManager.tmpC.setRGB(v * 1.08, v, v * 0.9);
      this.solid.spawn(pos, vel, 0.6 + Math.random() * 0.5, 0.06 + Math.random() * 0.08, c, 16, 0.4, floor);
    }
  }

  /**
   * Metal on metal or on asphalt: orange-yellow sparks thrown along `dir`
   * (the surface's normal, or the way a scrape is going) that fall, cool and
   * skitter — rounds off armour, a car dragged across the lot. `floorY` is
   * the ground they bounce on (the lot is at 0; -1 for none).
   */
  sparks(pos: THREE.Vector3, dir: THREE.Vector3, count = 12, floorY = 0): void {
    const d = this.unit(dir);
    const n = Math.min(48, Math.max(0, Math.round(count)));
    const vel = ParticleManager.tmpV;
    const hot = ParticleManager.SPARK_HOT;
    for (let i = 0; i < n; i++) {
      // A cone around `dir`, a little lift, a wide spread of speeds
      vel.set(d.x + (Math.random() - 0.5) * 1.3, d.y + (Math.random() - 0.5) * 1.3 + 0.35, d.z + (Math.random() - 0.5) * 1.3);
      if (vel.lengthSq() < 1e-6) vel.set(0, 1, 0);
      vel.normalize().multiplyScalar(3 + Math.random() * 7.5);
      const s = this.streaks.spawn();
      s.pos.copy(pos);
      s.vel.copy(vel);
      s.life = 0.35 + Math.random() * 0.55;
      s.heat = 0.65 + Math.random() * 0.35;
      s.gravity = 11;
      s.drag = 0.9;
      s.floorY = floorY;
      // A white-hot core riding the head of every other one, for its first instant
      if (i % 2 === 0) this.glow.spawn(pos, vel, 0.1 + Math.random() * 0.12, 0.04 + Math.random() * 0.03, hot, 11, 0.9);
    }
    // The flash where it struck (the pools copy what they're given, so the scratch vector will do)
    this.glow.spawn(pos, vel.copy(d).multiplyScalar(0.5), 0.06, 0.55, ParticleManager.SPARK_FLASH, 0, 0);
  }

  /**
   * A cough from a tailpipe: a few small dark-grey puffs pushed out along
   * `dir` (the pipe's axis), slowed at once, lifting and thinning. One call
   * per cough or blip of the throttle.
   */
  exhaust(pos: THREE.Vector3, dir: THREE.Vector3): void {
    const d = this.unit(dir);
    const n = 3 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const p = this.smoke.spawn();
      const o = Math.random() * 0.08;
      p.pos.set(pos.x + d.x * o, pos.y + d.y * o, pos.z + d.z * o);
      const sp = 1.3 + Math.random() * 1.4;
      p.vel.set(
        d.x * sp + (Math.random() - 0.5) * 0.35,
        d.y * sp + 0.25 + Math.random() * 0.3,
        d.z * sp + (Math.random() - 0.5) * 0.35
      );
      p.drag = 2.4;
      p.lift = 0.45;
      p.life = 0.8 + Math.random() * 0.6;
      p.size0 = 0.14 + Math.random() * 0.08;
      p.size1 = 0.6 + Math.random() * 0.35;
      p.alpha = 0.38 + Math.random() * 0.17;
      p.fadeIn = 0.05;
      const shade = 0.2 + Math.random() * 0.1;
      p.color.setRGB(shade, shade * 1.02, shade * 1.06);
      p.floorY = pos.y - 0.3;
      p.wind = 1;
    }
  }

  /** Drop every live particle and tracer — used after the shader warm-up. */
  clear(): void {
    this.solid.clear();
    this.smoke.clear();
    this.glow.clear();
    this.streaks.clear();
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
