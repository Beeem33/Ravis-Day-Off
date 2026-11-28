import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm } from './Level16Builder';

/**
 * Level19Sky — everything outside the boss's plane, for the fall: the sky
 * and its sun, the sea four kilometres down with islands in it, two decks of
 * cloud to fall through, the aircraft that cross the fall (the boss's own
 * widebody going away nose-down above, airliners and a turboprop below),
 * the gulls, and the parachutes.
 *
 * Scale is real: metres, the sea at y = 0, Ravi leaving the door at 4 km.
 * The haze is the scene's FogExp2; the shaders here that draw their own
 * colour (sky, sea, clouds) work the same haze out for themselves so the
 * horizon is one colour whatever it is made of.
 */

export const SUN_DIR = new THREE.Vector3(-0.42, 0.62, -0.66).normalize();
export const HAZE = new THREE.Color(0xbfd3e2);
export const HAZE_DENSITY = 0.000105;
export const ZENITH = new THREE.Color(0x2c64ab);

const HAZE_GLSL = /* glsl */ `
  uniform vec3 uHaze;
  uniform float uHazeDensity;
  vec3 haze(vec3 col, float d) {
    float f = 1.0 - exp(-uHazeDensity * uHazeDensity * d * d);
    return mix(col, uHaze, clamp(f, 0.0, 1.0));
  }
`;

// ================================================================ sky

/**
 * The sky: a dome kept centred on the camera, deep blue overhead down to the
 * pale haze at the horizon, and below the horizon the haze itself (the sea
 * fades into it long before the dome is reached). The sun is a hot disc
 * with a wide soft bloom round it, stronger toward the horizon.
 */
export function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: ZENITH.clone() },
      uHorizon: { value: HAZE.clone() },
      uSun: { value: SUN_DIR.clone() },
      uBright: { value: 1 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uSun;
      uniform float uBright;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float up = clamp(d.y, -1.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
        // A little warmth low down toward the sun's side
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.86, 0.62) * pow(s, 6.0) * 0.18 * (1.0 - clamp(up, 0.0, 1.0));
        col += vec3(1.0, 0.95, 0.85) * (pow(s, 64.0) * 0.55 + pow(s, 900.0) * 6.0);
        if (up < 0.0) col = mix(col, uHorizon, clamp(-up * 6.0, 0.0, 1.0));
        gl_FragColor = vec4(col * uBright, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  m.name = 'sky';
  return m;
}

// ================================================================ sea

/**
 * The sea: one huge quad, coloured per pixel — deep blue looking straight
 * down, the sky in it toward the horizon (fresnel), a sun path glittering
 * off a few layers of moving swell, and the haze over all of it with
 * distance. Shallower and greener inside `uShoals` (the islands' reefs).
 */
export function ocean(shoals: THREE.Vector4[]): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: SUN_DIR.clone() },
      uHaze: { value: HAZE.clone() },
      uHazeDensity: { value: HAZE_DENSITY },
      uDeep: { value: new THREE.Color(0x06305e) },
      uSky: { value: new THREE.Color(0x8db6d6) },
      uShallow: { value: new THREE.Color(0x2fc3b8) },
      uShoals: { value: shoals.slice(0, 12).concat(Array.from({ length: Math.max(0, 12 - shoals.length) }, () => new THREE.Vector4(0, 0, 0, 0))) }
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSun, uDeep, uSky, uShallow;
      uniform vec4 uShoals[12];
      varying vec3 vWorld;
      ${HAZE_GLSL}
      float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), f.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      vec2 wave(vec2 p, vec2 dir, float k, float a, float sp) {
        float ph = dot(p, dir) * k + uTime * sp;
        return dir * cos(ph) * a * k;
      }
      void main() {
        vec2 p = vWorld.xz;
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 v = toCam / dist;
        // The finer swells only close to: far off they would shimmer into a moire
        float f3 = 1.0 - smoothstep(300.0, 1400.0, dist);
        float f4 = 1.0 - smoothstep(80.0, 500.0, dist);
        float f2 = 1.0 - smoothstep(1500.0, 5000.0, dist) * 0.7;
        vec2 g = wave(p, normalize(vec2(1.0, 0.3)), 0.021, 0.45 * f2, 1.1)
               + wave(p, normalize(vec2(0.3, 1.0)), 0.017, 0.4 * f2, 0.9)
               + wave(p, normalize(vec2(-0.4, 1.0)), 0.047, 0.25 * f2, 1.7)
               + (vec2(vnoise(p * 0.004), vnoise(p * 0.004 + 7.3)) - 0.5) * 0.06
               + wave(p, normalize(vec2(0.8, -0.7)), 0.11, 0.12 * f3, 2.6)
               + wave(p, normalize(vec2(-0.9, -0.2)), 0.31, 0.035 * f4, 4.1);
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        // Shallow water over the reefs, fading out to the deep
        float sh = 0.0;
        for (int i = 0; i < 12; i++) {
          vec4 s = uShoals[i];
          if (s.w <= 0.0) continue;
          float d = length(p - s.xy);
          sh = max(sh, 1.0 - smoothstep(s.z, s.w, d));
        }
        vec3 body = mix(uDeep, uShallow, sh * 0.85);
        vec3 col = mix(body, uSky, fres);
        vec3 r = reflect(-v, n);
        float spec = pow(max(dot(r, uSun), 0.0), 220.0);
        col += vec3(1.0, 0.95, 0.82) * spec * 2.4;
        // Whitecaps: little broken streaks of white on the open sea, for a sense of how far down it is
        float caps = vnoise(p * vec2(0.16, 0.08) + vec2(uTime * 0.03, 0.0)) * vnoise(p * 0.03 - uTime * 0.01);
        caps = smoothstep(0.6, 0.72, caps) * (1.0 - sh) * (1.0 - smoothstep(500.0, 2500.0, dist));
        col = mix(col, vec3(0.93, 0.96, 0.98), caps * 0.22);
        col = haze(col, dist);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const geo = new THREE.PlaneGeometry(200000, 200000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.name = 'sea';
  return m;
}

// ================================================================ islands

export interface IslandSite {
  x: number;
  z: number;
  /** Radius of the land at the waterline. */
  r: number;
  /** Height of its peak. */
  h: number;
  seed: number;
}

/** Height of an island's land above the sea at a point, metres (negative off it). */
export function islandHeight(s: IslandSite, x: number, z: number): number {
  const dx = x - s.x;
  const dz = z - s.z;
  const a = Math.atan2(dz, dx);
  const wob = 1 + 0.28 * fbm(Math.cos(a) * 1.7 + s.seed, Math.sin(a) * 1.7 - s.seed, 3);
  const k = Math.hypot(dx, dz) / (s.r * wob);
  if (k > 1.25) return -4;
  const hill = Math.pow(Math.max(0, 1 - k), 1.6) * s.h * (0.75 + 0.5 * fbm(dx / 180 + s.seed, dz / 180, 4));
  const beach = (1 - THREE.MathUtils.smoothstep(k, 0.86, 1.05)) * 3.2;
  return Math.max(hill, beach) - THREE.MathUtils.smoothstep(k, 0.98, 1.2) * 6;
}

/**
 * One island seen from altitude: a disc of land, sand round its edge, green
 * and darker green up the hill, bare rock on the top of the tall ones —
 * vertex coloured and flat shaded, so its folds read from four kilometres.
 */
export function islandMesh(s: IslandSite, fine = false, far = false): THREE.Mesh {
  const rings = fine ? 44 : far ? 12 : 22;
  const segs = fine ? 180 : far ? 40 : 72;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const sand = new THREE.Color(0xe9dcb4);
  const wet = new THREE.Color(0xbfae84);
  const green = new THREE.Color(0x3f8a3a);
  const dark = new THREE.Color(0x225f2b);
  const rock = new THREE.Color(0x857a6a);
  const c = new THREE.Color();
  const R = s.r * 1.3;
  pos.push(s.x, islandHeight(s, s.x, s.z), s.z);
  c.copy(dark);
  col.push(c.r, c.g, c.b);
  for (let i = 1; i <= rings; i++) {
    const rr = R * Math.pow(i / rings, 0.8);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = s.x + Math.cos(a) * rr;
      const z = s.z + Math.sin(a) * rr;
      const y = islandHeight(s, x, z);
      pos.push(x, y, z);
      const n = fbm(x / 60, z / 60, 2) * 0.5 + 0.5;
      if (y < 0.4) c.copy(wet);
      else if (y < 3.6) c.copy(sand).lerp(wet, 0.15 * n);
      else if (y > s.h * 0.78) c.copy(rock).lerp(dark, 0.3 * n);
      else c.copy(green).lerp(dark, THREE.MathUtils.clamp(y / (s.h * 0.7) + n * 0.4 - 0.2, 0, 1));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = 1 + (i - 1) * segs + j;
      const b = 1 + (i - 1) * segs + ((j + 1) % segs);
      const cc = 1 + i * segs + j;
      const d = 1 + i * segs + ((j + 1) % segs);
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  const m = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.name = 'island';
  return m;
}

/** The islands down below: the one he will wash up on dead ahead, the rest scattered. */
export const ISLANDS: IslandSite[] = [
  { x: 260, z: -2600, r: 520, h: 120, seed: 1.3 },
  { x: -2400, z: -5200, r: 900, h: 340, seed: 4.1 },
  { x: 3100, z: -6900, r: 640, h: 210, seed: 7.7 },
  { x: -4700, z: -1500, r: 380, h: 70, seed: 2.2 },
  { x: 5200, z: -2200, r: 1100, h: 420, seed: 9.4 },
  { x: 1600, z: 2600, r: 300, h: 50, seed: 5.5 },
  { x: -1900, z: 3900, r: 700, h: 260, seed: 3.8 },
  { x: 7600, z: -9800, r: 1500, h: 600, seed: 6.6 },
  { x: -8200, z: -8600, r: 1300, h: 520, seed: 8.1 }
];

/**
 * The rest of the archipelago, out to the horizon: islands every few
 * kilometres in every direction, so wherever he looks from four kilometres
 * up there is more of it going away into the haze, not a sea that stops.
 */
export function farIslands(): IslandSite[] {
  const out: IslandSite[] = [];
  let s = 4242;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 9000 + Math.pow(rnd(), 0.8) * 26000;
    const r = 300 + Math.pow(rnd(), 2) * 2600;
    out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d - 3000, r, h: r * (0.15 + rnd() * 0.35), seed: rnd() * 10 });
  }
  return out;
}

// ================================================================ clouds

function puffTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * 2;
  const g = cv.getContext('2d')!;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * S;
    const oy = Math.floor(v / 2) * S;
    // A heap of soft round blobs, denser in the middle and flatter underneath
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.pow(rnd(), 0.7) * S * 0.3;
      const x = ox + S / 2 + Math.cos(a) * rr;
      const y = oy + S * 0.52 + Math.sin(a) * rr * 0.62 - rnd() * S * 0.06;
      const r = S * (0.08 + rnd() * 0.13) * (1 - rr / (S * 0.45));
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(0.55, 'rgba(255,255,255,0.28)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * A deck of cloud: hundreds of big soft billboards, one draw. Each puff is
 * lit from the sun's side (bright on top, blue-grey underneath where it
 * shades itself), goes into the haze with distance like everything else,
 * and fades out as the camera comes into it so falling through a deck is a
 * white-out that comes and goes, not cards slicing past the lens.
 */
export class CloudDeck {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(
    readonly y: number,
    readonly thick: number,
    count: number,
    spread: number,
    seed: number,
    /** Kept clear in a ring of this radius round the origin (0: none). */
    private hole = 0
  ) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const off = new Float32Array(count * 3);
    const info = new Float32Array(count * 3);
    let s = seed * 9301 + 49297;
    const rnd = (): number => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    // Clustered: puffs gathered round centres, not sprinkled evenly. The centres thin out with
    // distance — thick round the fall, scattered and bigger out toward the horizon, where the
    // haze takes them — so the deck has no edge anywhere you can see. `spread` is how far the
    // thick of it reaches; it goes on, thinning, to eight times that.
    const centres: [number, number, number, number][] = [];
    const nc = Math.max(8, Math.floor(count / 16));
    const far = spread * 8;
    for (let i = 0; i < nc; i++) {
      let r = 0;
      let a = 0;
      do {
        r = far * Math.pow(rnd(), 1.9);
        a = rnd() * Math.PI * 2;
      } while (this.hole > 0 && r < this.hole);
      // Further out, each cluster stands for more sky: bigger, so the coverage holds up
      const sc = 1 + Math.max(0, r - spread) / (spread * 1.2);
      centres.push([Math.cos(a) * r, Math.sin(a) * r, (160 + rnd() * 420) * sc, sc]);
    }
    for (let i = 0; i < count; i++) {
      const c = centres[i % nc];
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 0.6) * c[2];
      off[i * 3] = c[0] + Math.cos(a) * r;
      off[i * 3 + 1] = y + (rnd() - 0.35) * thick * (1 - (r / c[2]) * 0.6);
      off[i * 3 + 2] = c[1] + Math.sin(a) * r;
      info[i * 3] = (150 + rnd() * 260) * (0.6 + 0.6 * (1 - r / c[2])) * c[3]; // size
      info[i * 3 + 1] = Math.floor(rnd() * 4); // which of the four puffs
      info[i * 3 + 2] = rnd(); // shade jitter
    }
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 3));
    g.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uMap: { value: puffTexture() },
        uSun: { value: SUN_DIR.clone() },
        uHaze: { value: HAZE.clone() },
        uHazeDensity: { value: HAZE_DENSITY },
        uBase: { value: y },
        uThick: { value: thick },
        uOpacity: { value: 1 }
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec3 aInfo;
        uniform float uBase, uThick;
        varying vec2 vUv;
        varying float vShade, vNear, vDist;
        void main() {
          vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
          float size = aInfo.x;
          mv.xy += position.xy * size;
          vec2 tile = vec2(mod(aInfo.y, 2.0), floor(aInfo.y / 2.0)) * 0.5;
          vUv = tile + uv * 0.5;
          vShade = clamp((aOffset.y - uBase) / uThick + 0.55, 0.0, 1.0) * 0.6 + aInfo.z * 0.25 + position.y * 0.35;
          float d = -mv.z;
          vDist = length(mv.xyz);
          // Gone as the lens comes into it, back when it is behind
          vNear = smoothstep(size * 0.15, size * 0.75, d);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vShade, vNear, vDist;
        ${HAZE_GLSL}
        void main() {
          float a = texture2D(uMap, vUv).a;
          if (a < 0.01) discard;
          vec3 lit = vec3(1.0, 0.99, 0.96);
          vec3 shade = vec3(0.62, 0.69, 0.79);
          vec3 col = mix(shade, lit, clamp(vShade, 0.0, 1.0));
          col = haze(col, vDist * 0.8);
          gl_FragColor = vec4(col, min(1.0, a * 1.45) * vNear * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'clouds';
  }

  /** How deep into the deck a height is: 0 clear of it, 1 in the middle. */
  inside(y: number): number {
    const d = Math.abs(y - (this.y + this.thick * 0.1)) / (this.thick * 0.4);
    return Math.max(0, 1 - d);
  }

  set opacity(k: number) {
    this.mat.uniforms.uOpacity.value = k;
  }
}

// ================================================================ aircraft

export interface Livery {
  body: number;
  belly: number;
  stripe: number;
  cheat?: number;
  tail: number;
  windows?: number;
}

export interface Aircraft {
  group: THREE.Group;
  /** Nose to tail, and wingtip to wingtip. */
  length: number;
  span: number;
  radius: number;
  /** Where the wing's quarter-chord crosses the fuselage (local z), and its chord there. */
  wingZ: number;
  chord: number;
  /** Engine exhausts, local: where the trails and the roar come from. */
  exhausts: THREE.Vector3[];
  /** Propellers to spin, if any (about their local Z). */
  props: THREE.Object3D[];
  /** Is a local point inside the airframe (with `pad` metres to spare)? */
  hits(p: THREE.Vector3, pad: number): boolean;
}

function liveryTexture(L: Livery, len: number, R: number, cabin: [number, number]): THREE.CanvasTexture {
  const W = 1024;
  const H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
  g.fillStyle = hex(L.body);
  g.fillRect(0, 0, W, H);
  // u: round from the crown (0) through his right (0.25), the keel (0.5), the left (0.75)
  const band = (c0: number, c1: number, colour: number): void => {
    // Between two heights on the side (as cosines of the angle from the crown), down both sides
    g.fillStyle = hex(colour);
    const a = Math.acos(Math.max(c0, c1)) / (2 * Math.PI);
    const b = Math.acos(Math.min(c0, c1)) / (2 * Math.PI);
    g.fillRect(a * W, 0, (b - a) * W, H);
    g.fillRect((1 - b) * W, 0, (b - a) * W, H);
  };
  // Belly
  g.fillStyle = hex(L.belly);
  const bellyA = Math.acos(-0.42) / (2 * Math.PI);
  g.fillRect(bellyA * W, 0, (1 - 2 * bellyA) * W, H);
  band(-0.18, -0.3, L.stripe);
  if (L.cheat !== undefined) band(-0.08, -0.12, L.cheat);
  // Windows: a row of rounded dark ovals each side over the cabin
  g.fillStyle = hex(L.windows ?? 0x1c2630);
  const uWin = Math.acos(0.32) / (2 * Math.PI);
  const n = Math.floor(((cabin[1] - cabin[0]) * len) / 0.95);
  for (let i = 0; i < n; i++) {
    const v = cabin[0] + ((i + 0.5) / n) * (cabin[1] - cabin[0]);
    for (const u of [uWin, 1 - uWin]) {
      g.beginPath();
      g.ellipse(u * W, v * H, (0.24 / (2 * Math.PI * R)) * W, (0.3 / len) * H, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // The flight deck's windscreen, wrapped round the nose
  g.fillStyle = '#121a22';
  const vNose = 0.035;
  for (const u of [0.13, 0.19, 0.81, 0.87]) g.fillRect(u * W - 22, vNose * H, 40, 0.014 * H);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A swept, tapered lifting surface in its own XZ plane (root along z at x = 0), `t` thick. */
function surface(span: number, rootChord: number, tipChord: number, sweep: number, t: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(0, -rootChord * 0.25);
  sh.lineTo(span, -tipChord * 0.25 + sweep);
  sh.lineTo(span, tipChord * 0.75 + sweep);
  sh.lineTo(0, rootChord * 0.75);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: true, bevelThickness: t * 0.4, bevelSize: t * 0.4, bevelSegments: 1, steps: 1 });
  // Shape XY → our XZ, extruded up Y
  g.rotateX(Math.PI / 2);
  g.translate(0, t / 2, 0);
  return g;
}

/**
 * An airliner, built in its own frame: nose toward −Z, +Y up, its middle at
 * the origin. A lathed fuselage carrying the livery (belly, stripe, a row of
 * windows each side), low swept wings with winglets, two engines on pylons
 * under them (or turboprops on a straight high wing, `props`), a fin and
 * tailplane. Five draws.
 */
export function aircraft(o: { length: number; radius: number; span: number; livery: Livery; props?: boolean }): Aircraft {
  const { length: L, radius: R, span: S } = o;
  const props = !!o.props;
  const group = new THREE.Group();
  // ---- fuselage: lathed profile, nose (top of the profile) to tail
  const prof: THREE.Vector2[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const u = i / N; // 0 tail .. 1 nose
    const y = -L / 2 + u * L;
    let r = R;
    if (u > 0.9) r = R * Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.9) / 0.1, 2.2)));
    if (u < 0.22) r = R * (0.18 + 0.82 * Math.pow(u / 0.22, 0.75));
    prof.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const fus = new THREE.LatheGeometry(prof, 40);
  // Lathe's v runs up the profile, tail (0) to nose (1); the canvas is flipped onto it, so its top row is the nose
  fus.rotateX(-Math.PI / 2);
  // Tail cone swept up: lift the aft end so the keel line rises to the tail
  const p = fus.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const u = (z + L / 2) / L; // 0 nose .. 1 tail
    if (u > 0.74) p.setY(i, p.getY(i) + Math.pow((u - 0.74) / 0.26, 1.6) * R * 0.72);
  }
  fus.computeVertexNormals();
  const tex = liveryTexture(o.livery, L, R, [0.12, 0.8]);
  const skin = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.38, metalness: 0.25 });
  group.add(new THREE.Mesh(fus, skin));
  // ---- wings, tailplane, fin (one material, merged)
  const parts: THREE.BufferGeometry[] = [];
  const wingZ = props ? -L * 0.06 : L * 0.02;
  const chord = props ? R * 1.25 : R * 2.6;
  const wy = props ? R * 0.85 : -R * 0.55;
  for (const side of [1, -1]) {
    const w = surface(S / 2 - R * 0.5, chord, chord * (props ? 0.6 : 0.3), props ? 0.4 : S * 0.2, props ? 0.22 : 0.42);
    // Dihedral, built on the right wing; the mirror makes the left
    w.rotateZ(props ? -0.02 : 0.09);
    if (side < 0) w.scale(-1, 1, 1);
    w.translate(side * R * 0.5, wy, wingZ);
    parts.push(w);
    if (!props) {
      // Winglet
      const wl = surface(1.9, chord * 0.32, chord * 0.14, 0.9, 0.16);
      wl.rotateZ(Math.PI / 2 - 0.25);
      if (side < 0) wl.scale(-1, 1, 1);
      wl.translate(side * (S / 2 - 0.05), wy + (S / 2) * 0.09 + 0.1, wingZ + S * 0.2);
      parts.push(wl);
    }
    const hs = surface(S * 0.17, R * 1.3, R * 0.5, S * 0.07, 0.2);
    if (side < 0) hs.scale(-1, 1, 1);
    hs.translate(side * R * 0.25, R * 0.45, L / 2 - R * 1.6);
    parts.push(hs);
  }
  const fin = surface(R * 2.4, R * 2.0, R * 0.85, R * 1.5, 0.24);
  fin.rotateZ(Math.PI / 2);
  fin.translate(0.12, R * 0.62, L / 2 - R * 2.15);
  parts.push(fin);
  const wingMat = new THREE.MeshStandardMaterial({ color: o.livery.body, roughness: 0.42, metalness: 0.3, side: THREE.DoubleSide });
  const wings = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
  wings.computeVertexNormals();
  group.add(new THREE.Mesh(wings, wingMat));
  // The fin in the tail colour, a thin skin over the merged one
  const tailG = surface(R * 2.35, R * 1.92, R * 0.82, R * 1.5, 0.3);
  tailG.rotateZ(Math.PI / 2);
  tailG.translate(0.15, R * 0.7, L / 2 - R * 2.15);
  group.add(new THREE.Mesh(tailG, new THREE.MeshStandardMaterial({ color: o.livery.tail, roughness: 0.4, metalness: 0.25 })));
  // ---- engines
  const exhausts: THREE.Vector3[] = [];
  const propList: THREE.Object3D[] = [];
  const engParts: THREE.BufferGeometry[] = [];
  const engR = props ? R * 0.32 : R * 0.42;
  const engL = props ? R * 2.0 : R * 1.75;
  for (const side of [1, -1]) {
    const x = side * S * (props ? 0.2 : 0.18);
    const y = props ? wy - engR * 0.2 : wy - engR * 1.25;
    const z = wingZ - chord * (props ? 0.55 : 0.45) + (props ? 0 : S * 0.2 * 0.18 * 0);
    const nac = new THREE.CylinderGeometry(engR * (props ? 0.6 : 0.82), engR, engL, 20, 1, false);
    nac.rotateX(Math.PI / 2);
    nac.translate(x, y, z + engL * 0.3);
    engParts.push(nac);
    if (!props) {
      const py = new THREE.BoxGeometry(0.35, engR * 0.9, engL * 0.6);
      py.translate(x, y + engR * 0.8, z + engL * 0.45);
      engParts.push(py);
    }
    exhausts.push(new THREE.Vector3(x, y, z + engL * 0.8));
    if (props) {
      const hub = new THREE.Group();
      hub.position.set(x, y, z - engL * 0.22);
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0x202124, roughness: 0.6 });
      for (let b = 0; b < 4; b++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(0.22, R * 1.05, 0.05), bladeMat);
        bl.position.y = R * 0.52;
        const arm = new THREE.Group();
        arm.rotation.z = (b / 4) * Math.PI * 2;
        arm.add(bl);
        hub.add(arm);
      }
      group.add(hub);
      propList.push(hub);
    }
  }
  const engMat = new THREE.MeshStandardMaterial({ color: props ? o.livery.body : 0xc9ced3, roughness: 0.35, metalness: 0.55 });
  group.add(new THREE.Mesh(mergeGeometries(engParts.map((g) => g.toNonIndexed()), false)!, engMat));
  group.traverse((x) => {
    const m = x as THREE.Mesh;
    if (m.isMesh) m.frustumCulled = false;
  });
  const hits = (q: THREE.Vector3, pad: number): boolean => {
    // Fuselage
    if (Math.abs(q.z) < L / 2 + pad && Math.hypot(q.x, q.y) < R + pad) return true;
    // Wings: a slab from the root to the tip, swept back
    const ax = Math.abs(q.x);
    if (ax < S / 2 + pad && Math.abs(q.y - wy - (props ? 0 : ax * 0.09)) < 0.9 + pad) {
      const sw = props ? 0 : (ax / (S / 2)) * S * 0.2;
      const c = chord * (1 - (ax / (S / 2)) * (props ? 0.4 : 0.7));
      if (q.z > wingZ + sw - c * 0.25 - pad && q.z < wingZ + sw + c * 0.75 + pad) return true;
    }
    // Tailplane and fin
    if (q.z > L / 2 - R * 3 - pad && q.z < L / 2 + pad) {
      if (ax < S * 0.18 + pad && Math.abs(q.y - R * 0.45) < 0.6 + pad) return true;
      if (ax < 0.6 + pad && q.y > 0 && q.y < R * 3.1 + pad) return true;
    }
    return false;
  };
  return { group, length: L, span: S, radius: R, wingZ, chord, exhausts, props: propList, hits };
}

/** The boss's widebody: white, the navy belly and stripe, the thin gold line between. */
export function bossWidebody(): Aircraft {
  return aircraft({ length: 58, radius: 2.95, span: 56, livery: { body: 0xf4f4f1, belly: 0x15264a, stripe: 0x15264a, cheat: 0xc9a245, tail: 0x15264a } });
}

/** Somebody's ordinary airliner, on its way somewhere else. */
export function airliner(variant: number): Aircraft {
  const liveries: Livery[] = [
    { body: 0xf6f6f6, belly: 0xb9bec4, stripe: 0xc2272d, tail: 0xc2272d },
    { body: 0xf3f5f8, belly: 0x2f6db5, stripe: 0x2f6db5, cheat: 0xf2b134, tail: 0x2f6db5 },
    { body: 0xeef1ee, belly: 0xd6d9dc, stripe: 0x1f8a5b, tail: 0x1f8a5b }
  ];
  return aircraft({ length: 38, radius: 2.0, span: 35, livery: liveries[variant % liveries.length] });
}

/** A twin turboprop island-hopper: high straight wing, four-bladed props. */
export function turboprop(): Aircraft {
  return aircraft({ length: 22, radius: 1.35, span: 25, props: true, livery: { body: 0xf7f7f2, belly: 0xf7f7f2, stripe: 0xe07a1f, cheat: 0x1b3d6e, tail: 0xe07a1f } });
}

/**
 * A fading ribbon behind an aircraft's engine, laid flat in the air: what
 * the eye catches first of something crossing below at a hundred metres a
 * second. One quad, its alpha a gradient from the engine back.
 */
export function exhaustTrail(len: number, width: number): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = 8;
  cv.height = 256;
  const g = cv.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(255,255,255,0.4)');
  grd.addColorStop(0.15, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(cv);
  const geo = new THREE.PlaneGeometry(width, len);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, len / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true }));
  m.frustumCulled = false;
  return m;
}

// ================================================================ birds

export interface Flock {
  /** Where the middle of it is, and which way (and how fast) it is going. */
  centre: THREE.Vector3;
  vel: THREE.Vector3;
  /** Each bird's place in it, its own phase, and whether it has been hit. */
  birds: { off: THREE.Vector3; phase: number; rate: number; gone: boolean; scatter: THREE.Vector3 }[];
  /** How far the flock reaches from its middle (for the warning, and the cull). */
  radius: number;
  /** Slot range in the instanced meshes. */
  first: number;
  alive: boolean;
  warned: boolean;
}

/**
 * The gulls: every bird in every flock is one instance in each of three
 * instanced meshes (the body, and each wing on a hinge at the shoulder),
 * so a sky full of them is three draws. White with grey backs and black
 * wingtips, so they stand out over the dark sea a long way down.
 */
export class Birds {
  readonly group = new THREE.Group();
  readonly flocks: Flock[] = [];
  private body: THREE.InstancedMesh;
  private wingL: THREE.InstancedMesh;
  private wingR: THREE.InstancedMesh;
  private used = 0;
  private t = 0;
  private static _m = new THREE.Matrix4();
  private static _w = new THREE.Matrix4();
  private static _q = new THREE.Quaternion();
  private static _e = new THREE.Euler();
  private static _p = new THREE.Vector3();
  private static _s = new THREE.Vector3(1, 1, 1);
  private static _z = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(readonly max: number) {
    const bodyG = new THREE.SphereGeometry(0.16, 8, 6);
    bodyG.scale(0.8, 0.75, 2.6);
    const head = new THREE.SphereGeometry(0.1, 6, 5);
    head.translate(0, 0.05, -0.42);
    const tail = new THREE.ConeGeometry(0.12, 0.3, 4);
    tail.rotateX(Math.PI / 2);
    tail.scale(1.4, 0.3, 1);
    tail.translate(0, 0, 0.5);
    const colour = (g: THREE.BufferGeometry, c: number): THREE.BufferGeometry => {
      const n = g.getAttribute('position').count;
      const col = new THREE.Color(c);
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g.index ? g.toNonIndexed() : g;
    };
    const beak = new THREE.ConeGeometry(0.03, 0.12, 4);
    beak.rotateX(-Math.PI / 2);
    beak.translate(0, 0.04, -0.56);
    const b = mergeGeometries([colour(bodyG, 0xf2f2ee), colour(head, 0xf7f7f4), colour(tail, 0xe6e6e2), colour(beak, 0xe8b23a)], false)!;
    b.computeVertexNormals();
    // A wing: out along +X from the shoulder, swept back, grey on top with a black tip
    const wing = (): THREE.BufferGeometry => {
      const pos: number[] = [];
      const col: number[] = [];
      const grey = new THREE.Color(0x9ba3ab);
      const black = new THREE.Color(0x1b1c1e);
      const quad = (pts: number[][], c: THREE.Color): void => {
        for (const i of [0, 1, 2, 0, 2, 3]) {
          pos.push(...pts[i]);
          col.push(c.r, c.g, c.b);
        }
      };
      quad([[0, 0, -0.16], [0.55, 0.02, -0.12], [0.55, 0.02, 0.16], [0, 0, 0.2]], grey);
      quad([[0.55, 0.02, -0.12], [0.95, 0.0, 0.02], [0.95, 0.0, 0.18], [0.55, 0.02, 0.16]], grey);
      quad([[0.95, 0.0, 0.02], [1.15, -0.02, 0.16], [1.15, -0.02, 0.26], [0.95, 0.0, 0.18]], black);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      return g;
    };
    const wl = wing();
    const wr = wing();
    wr.scale(-1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    this.body = new THREE.InstancedMesh(b, mat, max);
    this.wingL = new THREE.InstancedMesh(wl, mat, max);
    this.wingR = new THREE.InstancedMesh(wr, mat, max);
    for (const m of [this.body, this.wingL, this.wingR]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < max; i++) m.setMatrixAt(i, Birds._z);
      this.group.add(m);
    }
  }

  /**
   * A flock of `n` with its middle at `centre`, flying at `vel`: a loose
   * murmuring ball, or a V of geese-style gulls (`v`), each bird a size `scale`.
   */
  add(centre: THREE.Vector3, vel: THREE.Vector3, n: number, shape: 'ball' | 'v', radius: number, seed: number): Flock | null {
    if (this.used + n > this.max) return null;
    let s = seed * 7919 + 13;
    const rnd = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const dir = vel.clone().setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const birds: Flock['birds'] = [];
    for (let i = 0; i < n; i++) {
      const off = new THREE.Vector3();
      if (shape === 'v') {
        const k = Math.ceil(i / 2);
        const sd = i % 2 ? 1 : -1;
        off.addScaledVector(dir, -k * 2.4).addScaledVector(side, sd * k * 2.1).add(new THREE.Vector3(0, (rnd() - 0.5) * 1.2, 0));
        off.addScaledVector(dir, radius * 0.45);
      } else {
        const a = rnd() * Math.PI * 2;
        const r = Math.pow(rnd(), 0.5) * radius;
        off.set(Math.cos(a) * r, (rnd() - 0.5) * radius * 0.35, Math.sin(a) * r);
      }
      birds.push({ off, phase: rnd() * 10, rate: 7 + rnd() * 3, gone: false, scatter: new THREE.Vector3((rnd() - 0.5) * 8, rnd() * 6, (rnd() - 0.5) * 8) });
    }
    const f: Flock = { centre: centre.clone(), vel: vel.clone(), birds, radius: shape === 'v' ? Math.max(radius, n * 1.3) : radius, first: this.used, alive: true, warned: false };
    this.used += n;
    this.flocks.push(f);
    return f;
  }

  /** Where one bird is right now. */
  birdAt(f: Flock, i: number, out: THREE.Vector3): THREE.Vector3 {
    const b = f.birds[i];
    out.copy(f.centre).add(b.off);
    // A ball murmurs: each bird wanders round its place
    out.x += Math.sin(this.t * 0.9 + b.phase) * 0.8;
    out.y += Math.sin(this.t * 1.3 + b.phase * 1.7) * 0.5;
    out.z += Math.cos(this.t * 0.8 + b.phase * 0.6) * 0.8;
    return out;
  }

  update(dt: number): void {
    this.t += dt;
    const m = Birds._m;
    const w = Birds._w;
    const q = Birds._q;
    const p = Birds._p;
    let dirty = false;
    for (const f of this.flocks) {
      if (!f.alive) continue;
      f.centre.addScaledVector(f.vel, dt);
      const yaw = Math.atan2(-f.vel.x, -f.vel.z);
      for (let i = 0; i < f.birds.length; i++) {
        const b = f.birds[i];
        const slot = f.first + i;
        if (b.gone) {
          this.body.setMatrixAt(slot, Birds._z);
          this.wingL.setMatrixAt(slot, Birds._z);
          this.wingR.setMatrixAt(slot, Birds._z);
          continue;
        }
        this.birdAt(f, i, p);
        const flap = Math.sin(this.t * b.rate + b.phase);
        q.setFromEuler(Birds._e.set(Math.sin(this.t + b.phase) * 0.08, yaw + Math.sin(this.t * 0.7 + b.phase) * 0.2, flap * 0.05));
        m.compose(p, q, Birds._s.set(1.6, 1.6, 1.6));
        this.body.setMatrixAt(slot, m);
        const lift = flap * 0.75 + 0.15;
        w.makeRotationZ(lift);
        this.wingL.setMatrixAt(slot, w.premultiply(m));
        w.makeRotationZ(-lift);
        this.wingR.setMatrixAt(slot, w.premultiply(m));
      }
      dirty = true;
    }
    if (dirty) {
      this.body.instanceMatrix.needsUpdate = true;
      this.wingL.instanceMatrix.needsUpdate = true;
      this.wingR.instanceMatrix.needsUpdate = true;
    }
  }

  /** A flock done with: every bird of it gone from the sky. */
  retire(f: Flock): void {
    f.alive = false;
    for (let i = 0; i < f.birds.length; i++) {
      const slot = f.first + i;
      this.body.setMatrixAt(slot, Birds._z);
      this.wingL.setMatrixAt(slot, Birds._z);
      this.wingR.setMatrixAt(slot, Birds._z);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.wingL.instanceMatrix.needsUpdate = true;
    this.wingR.instanceMatrix.needsUpdate = true;
  }
}

// ================================================================ parachutes

/**
 * A ram-air canopy: a span of cells, cambered on top and arched across,
 * with the lines fanning down from its underside to two risers. In its own
 * frame the risers meet at the origin, the canopy `rise` above, its span
 * along X and its leading edge toward −Z. `holes` punches bullet holes
 * right through it — the sky shows through them — with a few torn flaps
 * hanging off the worst.
 */
export interface Canopy {
  group: THREE.Group;
  /** The fabric, to swell and sag. */
  wing: THREE.Mesh;
  lines: THREE.LineSegments;
  tatters: THREE.Mesh[];
  /** Where each riser hangs from, local. */
  risers: [THREE.Vector3, THREE.Vector3];
  /** 0 a bundle .. 1 open. */
  setOpen(k: number): void;
}

export function canopy(o: { span: number; chord: number; rise: number; colours: number[]; holes?: { u: number; v: number; r: number }[] }): Canopy {
  const { span, chord, rise } = o;
  const cells = o.colours.length;
  // ---- the fabric's texture: cell colours, rib seams, and the holes cut out of the alpha
  const W = 512;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
  for (let i = 0; i < cells; i++) {
    g.fillStyle = hex(o.colours[i]);
    g.fillRect((i / cells) * W, 0, W / cells + 1, H);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect((i / cells) * W, 0, 2, H);
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, W, 6);
  const am = document.createElement('canvas');
  am.width = W;
  am.height = H;
  const a = am.getContext('2d')!;
  a.fillStyle = '#fff';
  a.fillRect(0, 0, W, H);
  let seed = 31;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (const h of o.holes ?? []) {
    // A ragged hole: a jagged ring of points round its middle, scorched round the rim
    const cx = h.u * W;
    const cy = h.v * H;
    const r = h.r * W;
    g.fillStyle = 'rgba(30,20,10,0.55)';
    g.beginPath();
    g.arc(cx, cy, r * 1.35, 0, Math.PI * 2);
    g.fill();
    a.fillStyle = '#000';
    a.beginPath();
    for (let k = 0; k < 14; k++) {
      const ang = (k / 14) * Math.PI * 2;
      const rr = r * (0.65 + rnd() * 0.7);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      if (k === 0) a.moveTo(x, y);
      else a.lineTo(x, y);
    }
    a.closePath();
    a.fill();
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const alpha = new THREE.CanvasTexture(am);
  // Lit from above, so from underneath it glows with the sun through it
  const fabric = new THREE.MeshStandardMaterial({ map, alphaMap: alpha, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.5 });
  // ---- the wing's surface: span along X (arched down at the tips), chord along Z (cambered up)
  const geo = new THREE.PlaneGeometry(span, chord, 28, 8);
  geo.rotateX(-Math.PI / 2);
  const base = (geo.getAttribute('position') as THREE.BufferAttribute).array.slice() as Float32Array;
  const group = new THREE.Group();
  const wing = new THREE.Mesh(geo, fabric);
  wing.frustumCulled = false;
  group.add(wing);
  // Lines: from points under each rib down to the two risers
  const risers: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(-0.22, 0, 0), new THREE.Vector3(0.22, 0, 0)];
  const lineGeo = new THREE.BufferGeometry();
  const ribs = cells + 1;
  const lineCount = ribs * 3;
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lineCount * 6), 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.75 }));
  lines.frustumCulled = false;
  group.add(lines);
  // A few torn flaps hanging from the worst holes
  const tatters: THREE.Mesh[] = [];
  const tatMat = new THREE.MeshStandardMaterial({ color: o.colours[0], side: THREE.DoubleSide, roughness: 0.9 });
  for (const h of (o.holes ?? []).filter((x) => x.r > 0.03).slice(0, 4)) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.55, 1, 4), tatMat.clone());
    (t.material as THREE.MeshStandardMaterial).color.setHex(o.colours[Math.min(cells - 1, Math.floor(h.u * cells))]);
    t.geometry.translate(0, -0.27, 0);
    t.userData.uv = [h.u, h.v];
    tatters.push(t);
    group.add(t);
  }
  const shapeAt = (u: number, v: number, k: number, out: THREE.Vector3): THREE.Vector3 => {
    // u 0..1 across the span, v 0..1 leading edge to trailing; k how open
    const x = (u - 0.5) * span * (0.18 + 0.82 * k);
    const arch = Math.pow(Math.abs(u - 0.5) * 2, 2) * span * 0.2 * k;
    const camber = Math.sin(Math.min(1, v * 1.15) * Math.PI) * chord * 0.09 * k;
    out.set(x, rise * (0.25 + 0.75 * k) - arch + camber, (v - 0.4) * chord * (0.3 + 0.7 * k));
    return out;
  };
  const tmp = new THREE.Vector3();
  const setOpen = (k: number): void => {
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const nx = 29;
    for (let i = 0; i < p.count; i++) {
      const ix = i % nx;
      const iz = Math.floor(i / nx);
      shapeAt(ix / 28, iz / 8, k, tmp);
      // A wave of breathing in the cells
      tmp.y += Math.sin(ix * 1.7) * 0.03 * k;
      p.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    void base;
    p.needsUpdate = true;
    geo.computeVertexNormals();
    const lp = lineGeo.getAttribute('position') as THREE.BufferAttribute;
    let n = 0;
    for (let r = 0; r < ribs; r++) {
      for (const v of [0.15, 0.5, 0.85]) {
        shapeAt(r / cells, v, k, tmp);
        tmp.y -= 0.05;
        const riser = r / cells < 0.5 ? risers[0] : risers[1];
        lp.setXYZ(n++, tmp.x, tmp.y, tmp.z);
        lp.setXYZ(n++, riser.x, riser.y, riser.z);
      }
    }
    lp.needsUpdate = true;
    for (const t of tatters) {
      const [u, v] = t.userData.uv as [number, number];
      shapeAt(u, v, k, tmp);
      t.position.copy(tmp);
      t.visible = k > 0.5;
    }
    wing.visible = lines.visible = k > 0.02;
  };
  setOpen(1);
  return { group, wing, lines, tatters, risers, setOpen };
}

/** The pack on a jumper's back, the pilot chute's handle at the bottom of it. */
export function chutePack(colour = 0x1d2636, trim = 0xc9a245): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.15), mat);
  g.add(box);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.03), new THREE.MeshStandardMaterial({ color: trim, roughness: 0.6 }));
  flap.position.set(0, 0.2, 0.08);
  g.add(flap);
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  for (const sx of [-0.13, 0.13]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.03), strapMat);
    s.position.set(sx, 0, -0.07);
    g.add(s);
  }
  return g;
}

/** Big yellow letters on a dark ground, for the FBI's backs. */
export function letterPatch(text: string, w: number, h: number): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, 256, 128);
  g.fillStyle = '#f2c919';
  g.font = 'bold 104px Arial Black, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 70);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.7, emissive: 0x3a2e00, emissiveMap: t, polygonOffset: true, polygonOffsetFactor: -2 }));
  return m;
}

// ================================================================ the rush of it

/**
 * Speed lines: a few hundred short streaks of air hung off the camera,
 * each tearing past him the way the air is — up from below at terminal
 * velocity, back from ahead as he tracks — drawn as a line its own speed
 * long, bright at the head and gone at the tail. They wrap round a box in
 * front of the lens, so the rush never thins. Brighter, longer and more of
 * them in a dive.
 */
export class WindStreaks {
  private lines: THREE.LineSegments;
  private pos: Float32Array;
  private seg: Float32Array;
  private mat: THREE.LineBasicMaterial;
  private static readonly N = 260;
  private static readonly BOX = new THREE.Vector3(9, 9, 26);
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();

  constructor(private camera: THREE.Camera) {
    const N = WindStreaks.N;
    this.pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) this.respawn(i, true);
    this.seg = new Float32Array(N * 6);
    const col = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) col.set([1, 1, 1, 0, 0, 0], i * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.seg, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 5;
    camera.add(this.lines);
  }

  private respawn(i: number, anywhere: boolean, from?: THREE.Vector3): void {
    const B = WindStreaks.BOX;
    let x = (Math.random() * 2 - 1) * B.x;
    let y = (Math.random() * 2 - 1) * B.y;
    let z = -1.5 - Math.random() * B.z;
    if (!anywhere && from) {
      // Back in on the side the air comes from
      const ax = Math.abs(from.x) / B.x;
      const ay = Math.abs(from.y) / B.y;
      const az = Math.abs(from.z) / (B.z * 0.5);
      if (ax >= ay && ax >= az) x = -Math.sign(from.x) * B.x;
      else if (ay >= az) y = -Math.sign(from.y) * B.y;
      else z = from.z > 0 ? -1.5 - B.z : -1.5;
    }
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
  }

  set visible(on: boolean) {
    this.lines.visible = on;
  }

  /** `hv` his horizontal velocity (world), `fall` how fast he's dropping, `dive` 0..1, `k` overall strength. */
  update(dt: number, hv: THREE.Vector3, fall: number, dive: number, k: number): void {
    const N = WindStreaks.N;
    const B = WindStreaks.BOX;
    // The air past him, world: up from below, and against the way he's tracking — then into the camera's frame
    this.q.copy(this.camera.quaternion).invert();
    const v = this.v.set(-hv.x, fall * (1 + dive * 0.5), -hv.z).applyQuaternion(this.q);
    const len = 0.022 + dive * 0.03;
    const shown = Math.round(N * (0.55 + 0.45 * dive));
    for (let i = 0; i < N; i++) {
      let x = this.pos[i * 3] + v.x * dt;
      let y = this.pos[i * 3 + 1] + v.y * dt;
      let z = this.pos[i * 3 + 2] + v.z * dt;
      if (Math.abs(x) > B.x || Math.abs(y) > B.y || z > -1.5 || z < -1.5 - B.z) {
        this.respawn(i, false, v);
        x = this.pos[i * 3];
        y = this.pos[i * 3 + 1];
        z = this.pos[i * 3 + 2];
      }
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const o = i * 6;
      if (i >= shown) {
        this.seg.fill(0, o, o + 6);
        continue;
      }
      this.seg[o] = x;
      this.seg[o + 1] = y;
      this.seg[o + 2] = z;
      this.seg[o + 3] = x - v.x * len;
      this.seg[o + 4] = y - v.y * len;
      this.seg[o + 5] = z - v.z * len;
    }
    (this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.mat.opacity = (0.09 + 0.28 * dive) * k;
  }
}
