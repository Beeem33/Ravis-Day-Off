import * as THREE from 'three';

/**
 * Storm — the weather over the Exterminator Collective's headquarters: rain
 * falling around the camera, splashing on the wet ground, a low ceiling of
 * cloud the skyscraper disappears into, wind that gusts, and lightning.
 *
 * The rain is a fixed lattice of streaks in world space, wrapped round the
 * camera in the vertex shader, so it costs one draw and no CPU per frame,
 * and walking through it has proper parallax. The splashes the same, on the
 * ground. A strike flashes the moon light, the sky, the clouds round where it
 * hit, the reflections and the rain; draws its bolt for the flicker; and
 * tells the scene when to play the thunder (the sound's travel time later).
 *
 * The scene owns the lights; the storm says how bright the flash is
 * (`flash`) and where it was (`strikeAt`), and the scene applies it.
 */

const RAIN = 9000;
const SPLASH = 1600;
const BOX = new THREE.Vector3(56, 34, 56);
const FALL = 15;
/** Below the deck the clouds are patchy scud; the deck itself is solid, and the tower goes up into it. */
export const CLOUD_LOW = 118;
export const CLOUD_DECK = 165;

export interface StrikeEvent {
  /** Where the bolt came down (or into: the tower). */
  at: THREE.Vector3;
  /** How far from the listener, for the thunder. */
  dist: number;
}

export class Storm {
  /** 0..1: how bright the lightning is this frame. */
  flash = 0;
  /** Where the last strike was. */
  readonly strikeAt = new THREE.Vector3(0, 300, -400);
  /** The wind: its steady push (x, z, m/s) and how hard it's gusting (0..1, slow). */
  readonly wind = new THREE.Vector2(2.2, 1.1);
  gust = 0;
  /** Thunder waiting to be heard: seconds to go and how far off. */
  onThunder: ((dist: number) => void) | null = null;
  /** A strike just happened (for the scene: shake the camera a touch, light the tower). */
  onStrike: ((s: StrikeEvent) => void) | null = null;
  /** Strikes keep coming while true. */
  active = true;

  readonly group = new THREE.Group();
  private readonly rainMat: THREE.ShaderMaterial;
  private readonly splashMat: THREE.ShaderMaterial;
  private readonly cloudMats: THREE.ShaderMaterial[] = [];
  private readonly bolt: THREE.Mesh;
  private readonly boltMat: THREE.MeshBasicMaterial;
  private t = 0;
  private next = 3.2;
  /** The flicker of the current strike: pulse times and strengths. */
  private pulses: { at: number; k: number; len: number }[] = [];
  private strikeT = -10;
  private thunder: { t: number; dist: number }[] = [];
  private gustPhase = Math.random() * 10;
  /** Somewhere rain does not fall (under the stairs): min and max corners. */
  readonly shelterMin = new THREE.Vector3(1e6, 1e6, 1e6);
  readonly shelterMax = new THREE.Vector3(1e6, 1e6, 1e6);

  constructor(private camera: THREE.Camera, private listener: () => THREE.Vector3, private tower?: { x: number; z: number; half: number }) {
    this.group.name = 'storm';
    // ---- The rain: two vertices a streak, head and tail
    {
      const pos = new Float32Array(RAIN * 2 * 3);
      const seed = new Float32Array(RAIN * 2 * 4);
      const end = new Float32Array(RAIN * 2);
      for (let i = 0; i < RAIN; i++) {
        const s = [Math.random(), Math.random(), Math.random(), Math.random()];
        for (let k = 0; k < 2; k++) {
          seed.set(s, (i * 2 + k) * 4);
          end[i * 2 + k] = k;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
      g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
      this.rainMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uCam: { value: new THREE.Vector3() },
          uBox: { value: BOX.clone() },
          uWind: { value: new THREE.Vector2() },
          uFlash: { value: 0 },
          uShMin: { value: this.shelterMin },
          uShMax: { value: this.shelterMax }
        },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uCam;
          uniform vec3 uBox;
          uniform vec2 uWind;
          uniform vec3 uShMin;
          uniform vec3 uShMax;
          attribute vec4 aSeed;
          attribute float aEnd;
          varying float vA;
          void main() {
            float speed = ${FALL.toFixed(1)} * (0.85 + 0.3 * aSeed.w);
            vec3 o = aSeed.xyz * uBox;
            o.y -= uTime * speed;
            o.xz += uWind * uTime;
            vec3 c = uCam + vec3(0.0, 0.3 * uBox.y, 0.0);
            vec3 lo = c - 0.5 * uBox;
            vec3 w = lo + mod(o - lo, uBox);
            vec3 dir = normalize(vec3(uWind.x, -speed, uWind.y));
            float len = 0.38 + 0.4 * aSeed.w;
            w -= dir * len * aEnd;
            // Thin out toward the box's edges so the wrap never shows; none under shelter or below the ground
            vec3 d = abs(w - c) / (0.5 * uBox);
            float edge = (1.0 - smoothstep(0.7, 1.0, max(d.x, d.z))) * (1.0 - smoothstep(0.75, 1.0, d.y));
            float inside = step(uShMin.x, w.x) * step(w.x, uShMax.x) * step(uShMin.y, w.y) * step(w.y, uShMax.y) * step(uShMin.z, w.z) * step(w.z, uShMax.z);
            vA = (1.0 - aEnd) * edge * (1.0 - inside) * step(0.0, w.y);
            gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uFlash;
          varying float vA;
          void main() {
            gl_FragColor = vec4(mix(vec3(0.62, 0.68, 0.78), vec3(1.0), uFlash), vA * (0.32 + 0.45 * uFlash));
          }
        `,
        transparent: true,
        depthWrite: false
      });
      const rain = new THREE.LineSegments(g, this.rainMat);
      rain.frustumCulled = false;
      rain.renderOrder = 5;
      rain.name = 'rain';
      this.group.add(rain);
    }
    // ---- Splashes: rings opening on the ground, everywhere round him
    {
      const ring = new THREE.RingGeometry(0.7, 1, 14, 1);
      ring.rotateX(-Math.PI / 2);
      const g = new THREE.InstancedBufferGeometry();
      g.index = ring.index;
      g.setAttribute('position', ring.getAttribute('position'));
      const seed = new Float32Array(SPLASH * 3);
      for (let i = 0; i < SPLASH * 3; i++) seed[i] = Math.random();
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 3));
      g.instanceCount = SPLASH;
      this.splashMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uCam: { value: new THREE.Vector3() },
          uFlash: { value: 0 },
          uShMin: { value: this.shelterMin },
          uShMax: { value: this.shelterMax }
        },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uCam;
          uniform vec3 uShMin;
          uniform vec3 uShMax;
          attribute vec3 aSeed;
          varying float vA;
          const float R = 22.0;
          void main() {
            float rate = 1.6 + aSeed.z * 1.4;
            float ph = uTime * rate + aSeed.x * 7.0;
            float cyc = floor(ph);
            float u = fract(ph);
            // A new spot each cycle
            vec2 h = fract(vec2(sin(cyc * 12.9898 + aSeed.y * 78.233), sin(cyc * 39.346 + aSeed.x * 11.135)) * 43758.5453);
            vec2 at = uCam.xz + (h * 2.0 - 1.0) * R;
            float r = 0.03 + 0.11 * u;
            vec3 w = vec3(at.x, 0.012, at.y) + position * r;
            float inside = step(uShMin.x, w.x) * step(w.x, uShMax.x) * step(uShMin.z, w.z) * step(w.z, uShMax.z);
            vA = (1.0 - u) * (1.0 - u) * (1.0 - smoothstep(R * 0.6, R, length(at - uCam.xz))) * (1.0 - inside);
            gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uFlash;
          varying float vA;
          void main() {
            gl_FragColor = vec4(mix(vec3(0.55, 0.6, 0.68), vec3(1.0), uFlash), vA * (0.4 + 0.4 * uFlash));
          }
        `,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      });
      const splashes = new THREE.Mesh(g, this.splashMat);
      splashes.frustumCulled = false;
      splashes.renderOrder = 4;
      splashes.name = 'splashes';
      this.group.add(splashes);
    }
    // ---- The cloud: patchy scud low, the deck above it
    for (const [y, solid, scale, dark] of [[CLOUD_DECK, 1, 0.0016, 0.085], [CLOUD_LOW, 0, 0.0034, 0.11]] as const) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uFlash: { value: 0 },
          uStrike: { value: new THREE.Vector2() },
          uWind: { value: new THREE.Vector2() },
          uCam: { value: new THREE.Vector3() }
        },
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uFlash;
          uniform vec2 uStrike;
          uniform vec2 uWind;
          uniform vec3 uCam;
          varying vec3 vW;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
            return v;
          }
          void main() {
            vec2 p = vW.xz * ${scale} + uWind * uTime * ${(scale * 3).toFixed(5)};
            float n = fbm(p);
            float m = fbm(p * 2.7 - uTime * 0.01);
            float body = ${solid ? 'smoothstep(0.2, 0.75, n) * 0.3 + 0.93' : 'smoothstep(0.42, 0.8, n * 0.8 + m * 0.35)'};
            float alpha = clamp(body, 0.0, ${solid ? '1.0' : '0.92'});
            // Underside: dark, a little lighter where it's thin; lit up by the strike round where it was
            vec3 col = vec3(${dark.toFixed(3)}, ${(dark + 0.008).toFixed(3)}, ${(dark + 0.022).toFixed(3)}) * (0.8 + 0.6 * m);
            float near = exp(-distance(vW.xz, uStrike) / 520.0);
            col += vec3(0.42, 0.45, 0.6) * uFlash * (0.12 + 1.3 * near) * (0.55 + 0.6 * n);
            // Fade out to the horizon so the edge of the plane never shows
            float far = distance(vW.xz, uCam.xz);
            alpha *= 1.0 - smoothstep(1500.0, 2400.0, far);
            gl_FragColor = vec4(col, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200), mat);
      plane.rotation.x = Math.PI / 2;
      plane.position.y = y;
      plane.frustumCulled = false;
      plane.renderOrder = solid ? 1 : 2;
      plane.name = solid ? 'cloudDeck' : 'cloudScud';
      this.cloudMats.push(mat);
      this.group.add(plane);
    }
    // ---- The bolt: a ribbon, rebuilt each strike, facing the camera
    this.boltMat = new THREE.MeshBasicMaterial({
      color: 0xdfe6ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), this.boltMat);
    this.bolt.frustumCulled = false;
    this.bolt.name = 'bolt';
    this.buildBolt(new THREE.Vector3(200, 0, -900), 3);
    this.group.add(this.bolt);
  }

  /** Lightning, now: at `at` if given, otherwise somewhere out over the city or into the tower. */
  strike(at?: THREE.Vector3): void {
    const L = this.listener();
    let p: THREE.Vector3;
    if (at) p = at.clone();
    else if (this.tower && Math.random() < 0.3) {
      // Into the tower, up in the cloud: it lights the whole black face of it
      const tw = this.tower;
      p = new THREE.Vector3(tw.x + (Math.random() - 0.5) * tw.half, CLOUD_DECK - 10 - Math.random() * 30, tw.z + tw.half * 0.8);
    } else {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6 + (Math.random() < 0.25 ? Math.PI : 0);
      const r = 350 + Math.random() * 900;
      p = new THREE.Vector3(L.x + Math.cos(a) * r, 0, L.z + Math.sin(a) * r);
    }
    this.strikeAt.copy(p);
    const dist = Math.hypot(p.x - L.x, p.z - L.z);
    this.buildBolt(p, dist < 700 ? 4 : 3);
    // Two to four pulses over half a second, the first and the last the brightest
    const n = 2 + Math.floor(Math.random() * 3);
    this.pulses = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      this.pulses.push({ at: t, k: i === 0 || i === n - 1 ? 1 : 0.45 + Math.random() * 0.35, len: 0.06 + Math.random() * 0.07 });
      t += 0.07 + Math.random() * 0.14;
    }
    this.strikeT = 0;
    this.thunder.push({ t: THREE.MathUtils.clamp(dist / 343, 0.25, 4.5), dist });
    this.onStrike?.({ at: p, dist });
  }

  /**
   * The bolt from the cloud down to `to`: a jagged main channel, stepping
   * sideways as it comes down, with a few forks off it. A flat ribbon,
   * turned to the camera when it's built (it's only up for a split second).
   */
  private buildBolt(to: THREE.Vector3, forks: number): void {
    const top = new THREE.Vector3(to.x + (Math.random() - 0.5) * 120, CLOUD_DECK + 4, to.z + (Math.random() - 0.5) * 120);
    const cam = this.camera.position;
    const pos: number[] = [];
    const idx: number[] = [];
    const ribbon = (pts: THREE.Vector3[], w0: number): void => {
      const base = pos.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const along = (i < pts.length - 1 ? pts[i + 1] : p).clone().sub(i > 0 ? pts[i - 1] : p).normalize();
        const view = cam.clone().sub(p).normalize();
        const side = along.clone().cross(view).normalize();
        const w = w0 * (1 - (0.6 * i) / pts.length) * (p.distanceTo(cam) / 600);
        pos.push(p.x + side.x * w, p.y + side.y * w, p.z + side.z * w, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
        if (i > 0) {
          const a = base + (i - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    };
    const channel = (from: THREE.Vector3, end: THREE.Vector3, steps: number, jag: number): THREE.Vector3[] => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        const p = from.clone().lerp(end, k);
        if (i > 0 && i < steps) {
          p.x += (Math.random() - 0.5) * jag;
          p.z += (Math.random() - 0.5) * jag;
          p.y += (Math.random() - 0.5) * jag * 0.3;
        }
        pts.push(p);
      }
      return pts;
    };
    const main = channel(top, to, 22, 26);
    ribbon(main, 4.2);
    for (let f = 0; f < forks; f++) {
      const i = 3 + Math.floor(Math.random() * (main.length - 8));
      const from = main[i];
      const end = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 140, -(30 + Math.random() * 60), (Math.random() - 0.5) * 140));
      ribbon(channel(from, end, 8, 14), 2.0);
    }
    const g = this.bolt.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
  }

  /** Steps the weather; `cam` is where the rain is drawn round. */
  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    // The wind: a steady push, gusting up and dying back over a few seconds
    this.gustPhase += dt;
    const g = 0.5 + 0.5 * Math.sin(this.gustPhase * 0.37) * Math.sin(this.gustPhase * 0.23 + 1.3);
    this.gust += (g - this.gust) * Math.min(1, dt * 0.8);
    const wk = 0.7 + 0.8 * this.gust;
    const wx = 2.2 * wk;
    const wz = 1.1 * wk;
    this.wind.set(wx, wz);
    // Lightning
    if (this.active) {
      this.next -= dt;
      if (this.next <= 0) {
        this.next = 6 + Math.random() * 9;
        this.strike();
      }
    }
    let f = 0;
    if (this.strikeT >= 0) {
      this.strikeT += dt;
      for (const p of this.pulses) {
        const u = (this.strikeT - p.at) / p.len;
        if (u >= 0 && u < 3) f = Math.max(f, p.k * (u < 1 ? 1 : Math.exp(-(u - 1) * 2.4)));
      }
      if (this.strikeT > 1.2) this.strikeT = -10;
    }
    this.flash = f;
    this.boltMat.opacity = f > 0.25 ? Math.min(1, f * 1.3) : 0;
    this.bolt.visible = this.boltMat.opacity > 0;
    for (let i = this.thunder.length - 1; i >= 0; i--) {
      const th = this.thunder[i];
      th.t -= dt;
      if (th.t <= 0) {
        this.thunder.splice(i, 1);
        this.onThunder?.(th.dist);
      }
    }
    // Uniforms
    const cam = this.camera.position;
    const r = this.rainMat.uniforms;
    r.uTime.value = t;
    r.uCam.value.copy(cam);
    r.uWind.value.set(wx, wz);
    r.uFlash.value = f;
    const s = this.splashMat.uniforms;
    s.uTime.value = t;
    s.uCam.value.copy(cam);
    s.uFlash.value = f;
    for (const m of this.cloudMats) {
      m.uniforms.uTime.value = t;
      m.uniforms.uFlash.value = f;
      m.uniforms.uStrike.value.set(this.strikeAt.x, this.strikeAt.z);
      m.uniforms.uWind.value.set(wx, wz);
      m.uniforms.uCam.value.copy(cam);
    }
  }

  /** Make sure the flash's materials compile (the warm-up draws everything once). */
  showAll(): void {
    this.bolt.visible = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.rainMat.dispose();
    this.splashMat.dispose();
    for (const m of this.cloudMats) m.dispose();
    this.boltMat.dispose();
  }
}
