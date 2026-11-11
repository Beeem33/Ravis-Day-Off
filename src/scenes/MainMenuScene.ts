import * as THREE from 'three';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { MenuUI } from '../ui/MenuUI';
import { RaviVisual, HAND, type HandShape, type RaviRig, type SeatPose } from '../entities/RaviVisual';

const V3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/**
 * MainMenuScene — Ravi's day off, finally. Out on a calm, clear sea the
 * colour of the Bahamas, lying back in a pink frosted-doughnut float, a flip
 * phone at his ear, a bowl of curry steaming on the rim by his arm. The
 * camera sits behind him, looking past his head out to the horizon; the float
 * rides the small waves. A clean picture, as if a camera were really out there.
 *
 * Everything is in the float's frame, which is the model's: Y up, he faces
 * +Z, his left on +X (so his right hand, with the phone, is on −X).
 */

/** The float: the ring's radius to the middle of its tube, and the tube's. */
const RING_R = 0.5;
const TUBE_R = 0.22;

/** Lying back in the hole: hips low, the back on the rear of the ring, the legs over the front, the head up looking out. */
const RECLINE: Pick<SeatPose, 'hips' | 'lean' | 'legs'> = {
  // Seat sunk down through the hole (below the ring's middle), his back against the inside of the rear tube
  hips: V3(0, -0.06, 0.14),
  lean: [-50, -8, -6, -2, 26, 22],
  legs: {
    // Legs crossed at the ankle out over the front of the ring: the right over the left
    // (ankles drawn in and up so the knees bend up over the tube: thighs and calves rest on it, not through it)
    l: { ankle: V3(-0.05, 0.31, 0.69), knee: V3(0.1, 1, 0.05), turn: -6 },
    r: { ankle: V3(0.06, 0.39, 0.71), knee: V3(-0.1, 1, 0.05), turn: 10 }
  }
};
// Dev builds: the pose, to tune it live from the console
if (import.meta.env.DEV) (window as unknown as { __menuPose: unknown }).__menuPose = RECLINE;

/** His grip on the phone: fingers round the back of it, thumb on the side. */
const PHONE_HAND: HandShape = { fingers: [[30, 45, 30], [38, 50, 32], [45, 55, 34], [52, 60, 36]], thumb: [0.35, 0.3, 0.2] };

/** The waves, shared by the water's shader and the float riding them: [dirX, dirZ, length, height, speed]. */
const WAVES: [number, number, number, number, number][] = [
  [1, 0.35, 9, 0.09, 1.0],
  [0.4, 1, 5.5, 0.06, 1.3],
  [-0.7, 0.6, 3.2, 0.025, 1.7],
  [0.9, -0.5, 2.1, 0.014, 2.2]
];

/** How fast the swell runs: slow, a lazy day. */
const WAVE_PACE = 0.19;

function waveAt(x: number, z: number, t: number): number {
  let h = 0;
  for (const [dx, dz, len, amp, sp] of WAVES) {
    const l = Math.hypot(dx, dz);
    const k = (Math.PI * 2) / len;
    h += amp * Math.sin(k * ((dx / l) * x + (dz / l) * z) - t * sp * Math.sqrt(9.8 * k) * WAVE_PACE);
  }
  return h;
}

export class MainMenuScene implements GameScene {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private ui: MenuUI | null = null;
  private unsubs: (() => void)[] = [];
  private musicRetry = 0;

  /** The float and everything on it, riding the waves. */
  private float = new THREE.Group();
  private rig: RaviRig | null = null;
  private phone!: THREE.Group;
  private lid!: THREE.Object3D;
  private bowl!: THREE.Group;
  private steam: THREE.Sprite[] = [];
  private gulls: THREE.Mesh[] = [];
  private waterMat!: THREE.ShaderMaterial;
  private sunDir = V3(-0.35, 0.42, 1).normalize();
  private mouse = { x: 0, y: 0 };
  private mouseHandler = (e: MouseEvent): void => {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  };

  constructor(private ctx: GameContext) {
    this.camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.05, 900);
    this.buildSea();
    this.buildFloat();
    this.buildProps();
    this.buildRavi();
  }

  // ------------------------------------------------------------------- sea

  private buildSea(): void {
    const s = this.scene;
    const sky = new THREE.Color(0x9fd3f2);
    s.background = sky;
    // The sky: deep blue overhead to a pale haze on the horizon, the sun's glow round it
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: this.sunDir } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uSun; varying vec3 vD;
        void main(){
          float h = max(vD.y, 0.0);
          vec3 col = mix(vec3(0.78, 0.9, 0.97), vec3(0.18, 0.5, 0.88), pow(h, 0.55));
          float s = max(dot(normalize(vD), uSun), 0.0);
          col += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 4.0 + pow(s, 24.0) * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), skyMat);
    s.add(dome);
    // Fair-weather clouds low over the horizon
    const cloudTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 128;
      const g = c.getContext('2d')!;
      for (let i = 0; i < 26; i++) {
        const x = 40 + Math.random() * 176;
        const y = 50 + Math.random() * 40 - Math.abs(x - 128) * 0.12;
        const r = 14 + Math.random() * 26;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.95)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 256, 128);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    for (let i = 0; i < 9; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.85 }));
      const a = -0.9 + (i / 8) * 1.8 + (Math.random() - 0.5) * 0.15;
      const d = 520 + Math.random() * 180;
      sp.position.set(Math.sin(a) * d, 30 + Math.random() * 60, Math.cos(a) * d);
      sp.scale.set(160 + Math.random() * 120, 60 + Math.random() * 40, 1);
      s.add(sp);
    }
    // The water: turquoise over white sand close by, deepening to blue out to the horizon;
    // small waves; the sun glittering on it
    const geo = new THREE.PlaneGeometry(900, 900, 260, 260);
    geo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uSun: { value: this.sunDir }, uSky: { value: sky } },
      vertexShader: `
        uniform float uT;
        varying vec3 vW;
        varying vec3 vN;
        ${WAVES.map((w, i) => `const vec4 W${i} = vec4(${(w[0] / Math.hypot(w[0], w[1])).toFixed(4)}, ${(w[1] / Math.hypot(w[0], w[1])).toFixed(4)}, ${((Math.PI * 2) / w[2]).toFixed(4)}, ${w[3].toFixed(4)}); const float S${i} = ${(w[4] * Math.sqrt((9.8 * Math.PI * 2) / w[2]) * WAVE_PACE).toFixed(4)};`).join('\n')}
        void wave(vec4 w, float s, vec2 p, inout float h, inout vec2 d) {
          float ph = w.z * dot(w.xy, p) - uT * s;
          h += w.w * sin(ph);
          d += w.xy * (w.w * w.z * cos(ph));
        }
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float h = 0.0;
          vec2 d = vec2(0.0);
          // Waves die down to nothing with distance: far off it's flat, glittering sea
          float fade = 1.0 - smoothstep(60.0, 260.0, length(wp.xz - cameraPosition.xz));
          ${WAVES.map((_, i) => `wave(W${i}, S${i}, wp.xz, h, d);`).join(' ')}
          wp.y += h * fade;
          vN = normalize(vec3(-d.x * fade, 1.0, -d.y * fade));
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uT;
        uniform vec3 uSun;
        uniform vec3 uSky;
        varying vec3 vW;
        varying vec3 vN;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.07 + 13.1; a *= 0.5; } return v; }
        // A rippled normal from noise: the slope of fbm, sampled either side
        vec2 slope(vec2 p){ float e = 0.12; return vec2(fbm(p + vec2(e, 0.0)) - fbm(p - vec2(e, 0.0)), fbm(p + vec2(0.0, e)) - fbm(p - vec2(0.0, e))) / (2.0 * e); }
        void main() {
          float t = uT * 0.55;
          vec3 V = normalize(cameraPosition - vW);
          float dist = length(vW.xz - cameraPosition.xz);
          float near = 1.0 - smoothstep(8.0, 70.0, dist);
          // Ripples on the swell, three sizes, each drifting its own way (fine ones only close by)
          vec2 s1 = slope(vW.xz * 0.45 + vec2(t * 0.11, t * 0.05));
          vec2 s2 = slope(vW.xz * 1.6 + vec2(-t * 0.16, t * 0.12));
          vec2 s3 = slope(vW.xz * 5.0 + vec2(t * 0.3, -t * 0.22));
          vec2 rip = s1 * 0.22 + s2 * 0.14 * (0.4 + 0.6 * near) + s3 * 0.07 * near;
          vec3 N = normalize(vN + vec3(-rip.x, 0.0, -rip.y));
          // Colour: turquoise over white sand close in, patches of deeper water and pale sandbars
          // across the sea (large, slow noise), sapphire out toward the horizon
          vec3 shallow = vec3(0.24, 0.87, 0.84);
          vec3 bright = vec3(0.45, 0.93, 0.88);
          vec3 mid = vec3(0.07, 0.62, 0.78);
          vec3 deep = vec3(0.03, 0.32, 0.6);
          float patchy = fbm(vW.xz * 0.018 + 4.0);
          vec3 base = mix(shallow, mid, smoothstep(0.42, 0.7, patchy));
          base = mix(base, bright, smoothstep(0.62, 0.8, fbm(vW.xz * 0.03 - 9.0)) * 0.6);
          base = mix(base, mid, smoothstep(10.0, 60.0, dist) * 0.55);
          base = mix(base, deep, smoothstep(70.0, 260.0, dist));
          // Sunlight through the waves onto the sand: the caustic lace, near only
          float c1 = noise(vW.xz * 1.4 + vec2(t * 0.35, t * 0.2));
          float c2 = noise(vW.xz * 2.1 - vec2(t * 0.25, t * 0.3));
          float caus = pow(1.0 - abs(c1 - c2) * 2.0, 6.0);
          base += vec3(0.22, 0.32, 0.28) * caus * (1.0 - smoothstep(3.0, 25.0, dist));
          // Light inside the swell: crests a touch greener, troughs a touch deeper
          base += vec3(0.02, 0.07, 0.04) * clamp(vW.y * 7.0, -1.0, 1.0);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
          vec3 col = mix(base, uSky * 1.04, clamp(fres, 0.0, 0.8));
          vec3 R = reflect(-V, N);
          float sp = max(dot(R, uSun), 0.0);
          col += vec3(1.0, 0.95, 0.85) * (pow(sp, 300.0) * 2.6 + pow(sp, 70.0) * 0.08);
          // Glitter: tiny bright points where the fine ripples catch the sun
          float g = step(0.985, hash(floor(vW.xz * 9.0) + floor(t * 3.0))) * pow(sp, 6.0);
          col += vec3(1.0, 0.97, 0.9) * g * 1.4 * smoothstep(9.0, 22.0, dist) * (1.0 - smoothstep(60.0, 160.0, dist));
          // Thin lines of foam along the crests, broken up
          float crest = smoothstep(0.1, 0.16, vW.y) * smoothstep(0.45, 0.75, fbm(vW.xz * 0.9 + t * 0.1));
          col = mix(col, vec3(0.92, 0.97, 0.97), crest * 0.45 * near);
          // Into the haze at the horizon
          col = mix(col, uSky, smoothstep(220.0, 440.0, dist));
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    const water = new THREE.Mesh(geo, this.waterMat);
    water.frustumCulled = false;
    s.add(water);

    // Daylight: a high sun ahead and to his right, the sky's blue fill, a warm bounce off the water
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.copy(this.sunDir).multiplyScalar(30);
    s.add(sun);
    s.add(new THREE.HemisphereLight(0xbfe4ff, 0x4fc3c0, 1.35));
    const back = new THREE.DirectionalLight(0xffe2c0, 1.6);
    back.position.set(1.5, 3, -4);
    s.add(back);
    s.add(this.float);
    this.buildIsland();
  }

  /**
   * A little island off to the left, far out: a white sand beach round a
   * lush green hump, palms leaning out over the water, softened by the haze.
   */
  private buildIsland(): void {
    const s = this.scene;
    // Haze for anything solid far off (the water and sky do their own)
    s.fog = new THREE.Fog(0xb4dcf2, 140, 700);
    const isle = new THREE.Group();
    // Left of frame is +X (he, and the camera, look down +Z)
    isle.position.set(150, -0.6, 420);
    s.add(isle);
    let seed = 7;
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // The lagoon: pale turquoise shallows spreading out round it, fading into the sea
    {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(128, 128, 40, 128, 128, 128);
      grad.addColorStop(0, 'rgba(150,240,225,0.95)');
      grad.addColorStop(0.45, 'rgba(90,225,215,0.7)');
      grad.addColorStop(1, 'rgba(60,200,210,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const lagoon = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      lagoon.rotation.x = -Math.PI / 2;
      lagoon.scale.set(62, 50, 1);
      lagoon.position.y = 0.66;
      lagoon.renderOrder = 1;
      isle.add(lagoon);
    }
    // Sand: a wet darker rim, the dry white beach on it
    const wet = new THREE.Mesh(new THREE.CylinderGeometry(30, 31.5, 0.9, 48), new THREE.MeshStandardMaterial({ color: 0xcdb98c, roughness: 0.6 }));
    wet.scale.set(1.25, 1, 0.82);
    wet.position.y = 0.2;
    isle.add(wet);
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(25, 29, 1.6, 48), new THREE.MeshStandardMaterial({ color: 0xf6e9c6, roughness: 1 }));
    sand.scale.set(1.25, 1, 0.8);
    sand.position.y = 0.3;
    isle.add(sand);
    // Surf breaking white round the edge
    const surf = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.05, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
    surf.rotation.x = -Math.PI / 2;
    surf.scale.set(31.5 * 1.25, 31.5 * 0.82, 1);
    surf.position.y = 0.68;
    isle.add(surf);
    // The green: overlapping bumpy hills, deep and bright greens, a peak off-centre
    const greens = [0x2f7d32, 0x3f9a3a, 0x276b2b, 0x4caf50, 0x1f5f25, 0x5cbf4a];
    const lumps: [number, number, number, number][] = [
      [0, 0, 17, 9], [-9, 3, 11, 7], [10, -2, 12, 6.5], [3, -6, 9, 13], [-4, -4, 8, 9.5], [14, 5, 7, 5], [-15, -3, 6, 4.5]
    ];
    lumps.forEach(([x, z, r, h], i) => {
      const g = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      const p = g.getAttribute('position');
      for (let k = 0; k < p.count; k++) {
        const vx = p.getX(k);
        const vy = p.getY(k);
        const vz = p.getZ(k);
        const n = 1 + 0.09 * Math.sin(vx * 7 + i) * Math.sin(vz * 6 - i) + 0.06 * Math.sin(vx * 17 + vz * 13) + 0.04 * Math.sin(vx * 31 - vz * 23 + i);
        p.setXYZ(k, vx * n, vy * n, vz * n);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: greens[i % greens.length], roughness: 0.9, flatShading: true }));
      m.scale.set(r, h, r * 0.85);
      m.position.set(x, 0.9, z);
      isle.add(m);
    });
    // Undergrowth: clumps of bushes round the foot of the hills, down to the sand
    const bush = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 12 + rnd() * 9;
      const b = new THREE.Mesh(bush, new THREE.MeshStandardMaterial({ color: greens[Math.floor(rnd() * greens.length)], roughness: 0.9, flatShading: true }));
      const sc = 1.2 + rnd() * 2.2;
      b.scale.set(sc, sc * 0.7, sc);
      b.position.set(Math.cos(a) * r * 1.2, 1 + sc * 0.3, Math.sin(a) * r * 0.8);
      isle.add(b);
    }
    // Rocks at the water's edge on one side
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = -0.6 + rnd() * 1.1;
      const r = 28 + rnd() * 4;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8 + rnd() * 1.6, 0), rockMat);
      rock.position.set(Math.cos(a) * r * 1.2, 0.6, Math.sin(a) * r * 0.8);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      isle.add(rock);
    }
    // Palms: curved trunks, drooping fronds, coconuts
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.9 });
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x2e8b3a, roughness: 0.8, side: THREE.DoubleSide });
    const frondMat2 = new THREE.MeshStandardMaterial({ color: 0x46a33f, roughness: 0.8, side: THREE.DoubleSide });
    const nutMat = new THREE.MeshStandardMaterial({ color: 0x5a3f22, roughness: 0.8 });
    // A frond: a long tapering leaf, bending down along its length
    const frond = new THREE.PlaneGeometry(1.4, 6.5, 1, 10);
    frond.translate(0, 3.25, 0);
    {
      const p = frond.getAttribute('position');
      for (let k = 0; k < p.count; k++) {
        const u = p.getY(k) / 6.5;
        p.setX(k, p.getX(k) * (1 - u * 0.85));
        p.setZ(k, u * u * 2.6);
      }
      frond.computeVertexNormals();
    }
    const palm = (x: number, z: number, h: number, leanA: number, lean: number): void => {
      const tree = new THREE.Group();
      tree.position.set(x, 0.9, z);
      // The trunk bends over toward its lean, in segments
      const bend = (u: number): THREE.Vector3 => V3(Math.cos(leanA) * lean * u * u * h, u * h, Math.sin(leanA) * lean * u * u * h);
      const segs = 5;
      for (let k = 0; k < segs; k++) {
        const a = bend(k / segs);
        const b = bend((k + 1) / segs);
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - ((k + 1) / segs) * 0.15, 0.48 - (k / segs) * 0.15, a.distanceTo(b), 7), trunkMat);
        seg.position.copy(a).lerp(b, 0.5);
        seg.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
        tree.add(seg);
      }
      const crown = new THREE.Group();
      crown.position.copy(bend(1));
      tree.add(crown);
      const n = 8 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const f = new THREE.Mesh(frond, k % 2 ? frondMat : frondMat2);
        f.rotation.set(1.05 + rnd() * 0.45, (k / n) * Math.PI * 2 + rnd() * 0.3, 0, 'YXZ');
        crown.add(f);
      }
      for (let k = 0; k < 4; k++) {
        const c = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), nutMat);
        c.position.set(Math.cos(k * 1.7) * 0.45, -0.35, Math.sin(k * 1.7) * 0.45);
        crown.add(c);
      }
      isle.add(tree);
    };
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rnd() * 0.3;
      const r = 15 + rnd() * 8;
      // Leaning out over the water
      palm(Math.cos(a) * r * 1.2, Math.sin(a) * r * 0.8, 8 + rnd() * 5, a + (rnd() - 0.5) * 0.6, 0.18 + rnd() * 0.22);
    }
    for (let i = 0; i < 6; i++) palm((rnd() - 0.5) * 16, (rnd() - 0.5) * 10, 9 + rnd() * 4, rnd() * 6.28, 0.08);
    // A beach hut on stilts with a thatched roof, and a little jetty out from it
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a7650, roughness: 0.9 });
    const thatch = new THREE.MeshStandardMaterial({ color: 0xc8a25c, roughness: 1 });
    const hut = new THREE.Group();
    hut.position.set(-6, 0.9, -22);
    hut.rotation.y = 0.4;
    for (const [hx, hz] of [[-2, -1.6], [2, -1.6], [-2, 1.6], [2, 1.6]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2, 6), wood);
      post.position.set(hx, 1, hz);
      hut.add(post);
    }
    const room = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.4, 3.6), wood);
    room.position.y = 3.2;
    hut.add(room);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 2.6, 4), thatch);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 5.6;
    roof.scale.set(1.25, 1, 1);
    hut.add(roof);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.7), new THREE.MeshStandardMaterial({ color: 0x3a2a1a }));
    door.position.set(0, 2.95, -1.81);
    door.rotation.y = Math.PI;
    hut.add(door);
    isle.add(hut);
    const jetty = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 12), wood);
    jetty.position.set(-9, 1.0, -30);
    jetty.rotation.y = 0.4;
    isle.add(jetty);
    for (let k = 0; k < 5; k++) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6), wood);
      pile.position.set(-9 - Math.sin(0.4) * (k * 2.6 - 5), 0.3, -30 - Math.cos(0.4) * (k * 2.6 - 5));
      isle.add(pile);
    }
    // Gulls wheeling over it
    const gull = new THREE.BufferGeometry();
    gull.setAttribute('position', new THREE.Float32BufferAttribute([-0.9, 0.25, 0, 0, 0, 0.12, 0.9, 0.25, 0, 0, 0.06, -0.15], 3));
    gull.setIndex([0, 1, 3, 1, 2, 3]);
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Mesh(gull, new THREE.MeshBasicMaterial({ color: 0xf5f5f5, side: THREE.DoubleSide }));
      b.scale.setScalar(1.6);
      b.userData = { r: 14 + k * 6, h: 18 + k * 3, w: 0.15 + k * 0.04, a: k * 1.6 };
      isle.add(b);
      this.gulls.push(b);
    }
  }

  // ----------------------------------------------------------------- float

  /** A doughnut float: golden dough underneath, pink frosting with a dripping edge on top, sprinkles. */
  private buildFloat(): void {
    const dough = new THREE.MeshStandardMaterial({ color: 0xe4a860, roughness: 0.45, metalness: 0.0 });
    const frost = new THREE.MeshStandardMaterial({ color: 0xff80b4, roughness: 0.22, metalness: 0.0 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R, TUBE_R, 28, 72), dough);
    ring.rotation.x = -Math.PI / 2;
    this.float.add(ring);
    // The frosting: the same torus a hair fatter, its lower part pulled in under the dough
    // along a wavy line, so it reads as icing poured over the top and dripping down
    const fg = new THREE.TorusGeometry(RING_R, TUBE_R * 1.035, 28, 96);
    const p = fg.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      // Before the turn flat: the float's "up" is the torus's +Z
      const ang = Math.atan2(v.y, v.x);
      const edge = -0.05 + 0.045 * Math.sin(ang * 9) + 0.03 * Math.sin(ang * 23 + 1.3);
      if (v.z < edge) {
        const cx = Math.cos(ang) * RING_R;
        const cy = Math.sin(ang) * RING_R;
        v.set(cx + (v.x - cx) * 0.9, cy + (v.y - cy) * 0.9, v.z * 0.9);
        p.setXYZ(i, v.x, v.y, v.z);
      }
    }
    fg.computeVertexNormals();
    const icing = new THREE.Mesh(fg, frost);
    icing.rotation.x = -Math.PI / 2;
    this.float.add(icing);
    // Sprinkles scattered over the frosting
    const colours = [0xffffff, 0x4fc3ff, 0xfff05a, 0x7dff7a, 0xff5a5a, 0xb87dff];
    const sprinkle = new THREE.CapsuleGeometry(0.008, 0.035, 2, 6);
    for (let i = 0; i < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.5) * 1.6; // round the top of the tube
      const m = new THREE.Mesh(sprinkle, new THREE.MeshStandardMaterial({ color: colours[i % colours.length], roughness: 0.4 }));
      const r = RING_R + Math.sin(b) * TUBE_R * 1.04;
      m.position.set(Math.cos(a) * r, Math.cos(b) * TUBE_R * 1.04, Math.sin(a) * r);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.float.add(m);
    }
  }

  // ----------------------------------------------------------------- props

  private buildProps(): void {
    // The flip phone: open, the lid against his ear, the base down toward his mouth; a stubby antenna
    const silver = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.5, metalness: 0.4 });
    const screen = new THREE.MeshStandardMaterial({ color: 0x0a1a12, emissive: 0x6fd6a8, emissiveIntensity: 0.9 });
    const phone = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.085, 0.013), silver);
    base.position.set(0, -0.0425, 0);
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.038, 0.06), dark);
    keys.position.set(0, -0.045, 0.0068);
    phone.add(base, keys);
    const lid = new THREE.Group();
    const lidBody = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.08, 0.01), silver);
    lidBody.position.set(0, 0.04, 0);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.042), screen);
    scr.position.set(0, 0.045, 0.0055);
    lid.add(lidBody, scr);
    // Open past straight, the way they sit against a face
    lid.rotation.x = -0.32;
    phone.add(lid);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0045, 0.04, 8), dark);
    antenna.position.set(0.018, 0.096, -0.004);
    lid.add(antenna);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), dark);
    tip.position.set(0.018, 0.117, -0.004);
    lid.add(tip);
    this.lid = lid;
    this.phone = phone;
    this.float.add(phone);

    // The curry: a white bowl on the rim by his left arm, steaming
    const bowl = new THREE.Group();
    const profile = [V3(0, 0, 0), V3(0.045, 0, 0), V3(0.05, 0.008, 0), V3(0.075, 0.03, 0), V3(0.085, 0.06, 0), V3(0.08, 0.062, 0), V3(0.07, 0.034, 0), V3(0, 0.03, 0)].map((q) => new THREE.Vector2(q.x, q.y));
    const ceramic = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.25 }));
    bowl.add(ceramic);
    // The curry itself: a glossy, slightly lumpy surface, darker at the edge where it's reduced
    const sauce = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
      grad.addColorStop(0, '#d6782a');
      grad.addColorStop(0.75, '#c2611a');
      grad.addColorStop(1, '#8e3e10');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      // Spice flecks and little pools of oil
      for (let i = 0; i < 120; i++) {
        g.fillStyle = Math.random() < 0.6 ? 'rgba(120,40,8,0.6)' : 'rgba(255,180,60,0.5)';
        g.beginPath();
        g.arc(Math.random() * 128, Math.random() * 128, 0.6 + Math.random() * 1.6, 0, Math.PI * 2);
        g.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const surf = new THREE.CircleGeometry(0.076, 28, 0, Math.PI * 2);
    {
      const p = surf.getAttribute('position');
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 140) * Math.cos(p.getY(i) * 120) * 0.0025);
      surf.computeVertexNormals();
    }
    const curry = new THREE.Mesh(surf, new THREE.MeshStandardMaterial({ map: sauce, roughness: 0.18, metalness: 0.05 }));
    curry.rotation.x = -Math.PI / 2;
    curry.position.y = 0.052;
    bowl.add(curry);
    // In it: cubes of potato, pieces of chicken, chickpeas, rings of red chilli
    const potato = new THREE.MeshStandardMaterial({ color: 0xe8c070, roughness: 0.55 });
    const chicken = new THREE.MeshStandardMaterial({ color: 0xc88a50, roughness: 0.6 });
    const pea = new THREE.MeshStandardMaterial({ color: 0xd8b070, roughness: 0.5 });
    const chilli = new THREE.MeshStandardMaterial({ color: 0xc8201a, roughness: 0.4 });
    for (let i = 0; i < 18; i++) {
      const k = i % 4;
      const g =
        k === 0 ? new THREE.BoxGeometry(0.016, 0.014, 0.016) :
        k === 1 ? new THREE.DodecahedronGeometry(0.012 + Math.random() * 0.006, 0) :
        k === 2 ? new THREE.SphereGeometry(0.006, 8, 6) :
        new THREE.TorusGeometry(0.006, 0.0022, 5, 10);
      const c = new THREE.Mesh(g, [potato, chicken, pea, chilli][k]);
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.055;
      c.position.set(Math.cos(a) * r + 0.014, 0.056 + (k === 3 ? 0.002 : 0), Math.sin(a) * r);
      c.rotation.set(k === 3 ? Math.PI / 2 : Math.random() * 3, Math.random() * 3, Math.random() * 3);
      bowl.add(c);
    }
    // A swirl of cream across the top
    const swirl = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0028, 5, 24, Math.PI * 1.4), new THREE.MeshStandardMaterial({ color: 0xfaf4e6, roughness: 0.4 }));
    swirl.rotation.x = Math.PI / 2;
    swirl.position.set(0.02, 0.0565, 0.005);
    bowl.add(swirl);
    // Rice heaped to one side: lumpy, grains on it
    const riceGeo = new THREE.IcosahedronGeometry(0.036, 2);
    {
      const p = riceGeo.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const k = 1 + (Math.random() - 0.5) * 0.12;
        p.setXYZ(i, p.getX(i) * k, Math.max(0, p.getY(i)) * k, p.getZ(i) * k);
      }
      riceGeo.computeVertexNormals();
    }
    const riceMat = new THREE.MeshStandardMaterial({ color: 0xfaf6ea, roughness: 0.9 });
    const rice = new THREE.Mesh(riceGeo, riceMat);
    rice.scale.set(1, 0.65, 1);
    rice.position.set(-0.032, 0.05, 0.01);
    bowl.add(rice);
    for (let i = 0; i < 26; i++) {
      const grain = new THREE.Mesh(new THREE.CapsuleGeometry(0.0016, 0.005, 2, 4), riceMat);
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * 1.2;
      grain.position.set(-0.032 + Math.cos(a) * Math.sin(b) * 0.036, 0.05 + Math.cos(b) * 0.024, 0.01 + Math.sin(a) * Math.sin(b) * 0.036);
      grain.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      bowl.add(grain);
    }
    // Coriander leaves scattered over it
    for (let i = 0; i < 8; i++) {
      const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.007 + Math.random() * 0.003, 6), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x2f8a2a : 0x3f9f35, roughness: 0.6, side: THREE.DoubleSide }));
      leaf.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.6, Math.random() * 3, 0);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.05;
      leaf.position.set(Math.cos(a) * r + 0.01, 0.06, Math.sin(a) * r);
      bowl.add(leaf);
    }
    // A piece of naan leant on the rim
    const naan = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 8), new THREE.MeshStandardMaterial({ color: 0xe6c08a, roughness: 0.85 }));
    naan.scale.set(1.3, 0.12, 0.85);
    naan.rotation.set(0.2, 0.4, 0.75);
    naan.position.set(-0.07, 0.07, -0.03);
    bowl.add(naan);
    for (let i = 0; i < 5; i++) {
      const char = new THREE.Mesh(new THREE.CircleGeometry(0.006, 6), new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.9, side: THREE.DoubleSide }));
      char.position.set((Math.random() - 0.5) * 0.08, 0.0065, (Math.random() - 0.5) * 0.05);
      char.rotation.x = -Math.PI / 2;
      naan.add(char);
    }
    const spoon = new THREE.Mesh(new THREE.CapsuleGeometry(0.004, 0.11, 2, 6), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.8 }));
    spoon.position.set(0.04, 0.085, 0);
    spoon.rotation.set(0, 0, 0.9);
    bowl.add(spoon);
    // Sat on top of the ring, out by his left elbow
    bowl.position.set(0.45, TUBE_R - 0.01, 0.33);
    this.bowl = bowl;
    this.float.add(bowl);
    // Steam: a few soft wisps rising and fading
    const wisp = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    // Plenty of it, hot: big soft puffs and thinner wisps curling up through them
    for (let i = 0; i < 16; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: wisp, transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData.ph = i / 16;
      sp.userData.big = i % 3 === 0;
      bowl.add(sp);
      this.steam.push(sp);
    }
  }

  // ----------------------------------------------------------------- Ravi

  private buildRavi(): void {
    RaviVisual.whenReady(() => {
      this.rig = RaviVisual.rig('body');
      this.float.add(this.rig.root);
      this.poseRavi(0);
    });
  }

  /**
   * Lying back in the float: the trunk first (to find his head), then the
   * phone put at his right ear wherever the head is, and his hands — the
   * right closed round the phone, the left resting on the ring by the bowl.
   */
  private poseRavi(time: number): void {
    const rig = this.rig;
    if (!rig) return;
    // Talking: the head nods a touch, turns a little toward the phone now and then
    const talk = Math.sin(time * 1.7) * 2 + Math.sin(time * 0.6) * 3;
    const lean = [...RECLINE.lean];
    lean[5] += talk;
    // Head up straight over his shoulders (tipped onto the phone, it hid his right shoulder)
    const twist = [0, 0, 0, 0, Math.sin(time * 0.31) * 3, Math.sin(time * 0.37) * 4];
    const roll = [0, 0, -3, -3, -4, -2];
    const breath = Math.sin(time * 0.9) * 1.2;
    lean[2] += breath;
    const trunk: SeatPose = { hips: RECLINE.hips, lean, twist, roll, legs: RECLINE.legs, arms: {} };
    rig.seat(trunk);
    // Where his head is now, and how it's turned from rest (model frame)
    rig.root.updateMatrixWorld(true);
    const headBone = rig.bones.get('head')!;
    const rest = RaviVisual.restBone('head');
    const inv = new THREE.Quaternion();
    rig.root.getWorldQuaternion(inv).invert();
    const qNow = inv.clone().multiply(headBone.getWorldQuaternion(new THREE.Quaternion()));
    const R = qNow.multiply(rest.modelQ.clone().invert());
    const headP = rig.root.worldToLocal(headBone.getWorldPosition(new THREE.Vector3()));
    const inHead = (v: THREE.Vector3): THREE.Vector3 => v.clone().applyQuaternion(R).add(headP);
    const dirHead = (v: THREE.Vector3): THREE.Vector3 => v.clone().applyQuaternion(R).normalize();
    // The phone: lid's screen against his right ear, base angled down to the corner of his mouth
    const ear = inHead(V3(-0.1, 0.075, 0.0));
    const up = dirHead(V3(0.0, 1, -0.55));
    const out = dirHead(V3(-1, 0, 0.1));
    const fwd = new THREE.Vector3().crossVectors(out, up).normalize();
    const upO = new THREE.Vector3().crossVectors(fwd, out).normalize();
    // Phone frame: its +Y up the phone (lid end), +Z out of its face; the face is to his head (−out)
    this.phone.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(upO, out.clone().negate()), upO, out.clone().negate()));
    this.phone.position.copy(ear).addScaledVector(out, 0.03).addScaledVector(upO, -0.04);
    // The hand round the back of the base: the wrist below and outside it
    // The hand cupped under and behind it, fingers up its back: the wrist just under the jaw line
    const wrist = this.phone.position.clone().addScaledVector(upO, -0.1).addScaledVector(out, 0.03).addScaledVector(fwd, 0.015);
    rig.seat({
      ...trunk,
      arms: {
        // Elbow down and out in front of his chest, the forearm up to his ear — not cocked up behind his head
        r: { wrist, along: upO.clone().addScaledVector(out, -0.15).normalize(), palm: out.clone().negate(), elbow: fwd.clone().multiplyScalar(0.35).add(V3(-1, -0.7, 0)).normalize(), shape: PHONE_HAND },
        // Elbow up and out onto the top of the tube, not sunk into it
        l: { wrist: V3(0.38, 0.34, 0.03), along: V3(0.25, -0.15, 1).normalize(), palm: V3(0.15, -1, 0).normalize(), elbow: V3(0.85, 0.45, -0.4).normalize(), shape: HAND.relaxed }
      }
    });
  }

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    this.ui = new MenuUI(this.ctx.uiRoot, this.ctx.bus, this.ctx.audio);
    document.addEventListener('mousemove', this.mouseHandler);
    this.unsubs.push(
      this.ctx.bus.on(Events.Resize, () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
      })
    );
    // Kick the music immediately if the browser lets us; otherwise the
    // update loop keeps retrying and it starts on the first click.
    this.ctx.audio.unlock();
    this.ctx.audio.startMenuMusic();
  }

  exit(): void {
    this.ui?.destroy();
    this.ui = null;
    document.removeEventListener('mousemove', this.mouseHandler);
    for (const u of this.unsubs) u();
    this.ctx.audio.stopMenuMusic();
  }

  update(dt: number, time: number): void {
    void dt;
    // Keep nudging until the track is actually going (autoplay policy)
    this.musicRetry -= dt;
    if (this.musicRetry <= 0 && !this.ctx.audio.menuMusicPlaying) {
      this.musicRetry = 0.5;
      this.ctx.audio.startMenuMusic();
    }
    this.waterMat.uniforms.uT.value = time;

    // The float rides the waves: up and down with them, tipped with their slope, turning slowly
    const f = this.float;
    const h = waveAt(f.position.x, f.position.z, time);
    const e = 0.4;
    const sx = (waveAt(f.position.x + e, f.position.z, time) - waveAt(f.position.x - e, f.position.z, time)) / (2 * e);
    const sz = (waveAt(f.position.x, f.position.z + e, time) - waveAt(f.position.x, f.position.z - e, time)) / (2 * e);
    // Riding high, as a float does with a man sat in it: the hole's above the water
    f.position.y = 0.05 + h;
    f.rotation.set(sz * 0.55, Math.sin(time * 0.03) * 0.18, -sx * 0.55, 'YXZ');
    this.poseRavi(time);

    // Gulls wheeling over the island, flapping now and then, gliding between
    for (const b of this.gulls) {
      const d = b.userData as { r: number; h: number; w: number; a: number };
      const a = d.a + time * d.w;
      b.position.set(Math.cos(a) * d.r, d.h + Math.sin(time * 0.4 + d.a) * 1.5, Math.sin(a) * d.r * 0.8);
      const flap = Math.sin(time * 0.7 + d.a) > 0.3 ? 1 : 0.15;
      b.rotation.set(Math.sin(time * 6 + d.a) * 0.35 * flap, -a, 0.15);
    }

    // Steam off the curry
    for (const sp of this.steam) {
      const big = sp.userData.big as boolean;
      const ph = sp.userData.ph as number;
      const u = (time * (big ? 0.28 : 0.42) + ph) % 1;
      // Curling as it rises, drifting a little off with the breeze
      const curl = Math.sin(time * 1.7 + ph * 11 + u * 6) * 0.02 * (0.5 + u * 1.5);
      sp.position.set(curl + u * 0.03 + (ph - 0.5) * 0.06, 0.065 + u * (big ? 0.3 : 0.36), Math.cos(time * 1.3 + ph * 7 + u * 5) * 0.015 * (0.5 + u) + (ph - 0.5) * 0.03);
      const s = big ? 0.06 + u * 0.16 : 0.025 + u * 0.08;
      sp.scale.set(s, s * (big ? 1 : 1.6), 1);
      (sp.material as THREE.SpriteMaterial).opacity = Math.sin(Math.PI * Math.min(1, u * 1.2)) * (big ? 0.42 : 0.6);
    }

    // Behind him, a little above, looking past his head out to sea; drifting, with a touch of mouse parallax
    const cam = this.camera;
    const local = V3(0.3 + Math.sin(time * 0.07) * 0.08 + this.mouse.x * 0.12, 1.12 - this.mouse.y * 0.07 + Math.sin(time * 0.05) * 0.04, -2.35);
    const target = V3(-0.05, 0.42, 1.2);
    // Riding the float's yaw (not its rocking, which would be sickening)
    const yaw = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), f.rotation.y);
    cam.position.copy(local.applyQuaternion(yaw)).add(V3(f.position.x, 0, f.position.z));
    cam.lookAt(target.applyQuaternion(yaw).add(V3(f.position.x, f.position.y * 0.5, f.position.z)));
  }

  private drawSize = new THREE.Vector2();

  render(renderer: THREE.WebGLRenderer): void {
    // Built in a tab that had no size yet, the aspect would be 0/0 and nothing but the sky colour drawn
    renderer.getSize(this.drawSize);
    const aspect = this.drawSize.y > 0 ? this.drawSize.x / this.drawSize.y : 0;
    if (aspect > 0 && !(Math.abs(this.camera.aspect - aspect) <= 1e-3)) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    renderer.render(this.scene, this.camera);
  }
}
