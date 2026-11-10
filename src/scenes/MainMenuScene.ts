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
  hips: V3(0, 0.17, 0.0),
  lean: [-52, -6, -4, -2, 22, 18],
  legs: {
    // Legs crossed at the ankle out over the front of the ring: the right over the left
    l: { ankle: V3(-0.03, 0.06, 0.74), knee: V3(0.3, 1, 0.35), turn: -6 },
    r: { ankle: V3(0.07, 0.16, 0.76), knee: V3(-0.3, 1, 0.35), turn: 10 }
  }
};
/** His grip on the phone: fingers round the back of it, thumb on the side. */
const PHONE_HAND: HandShape = { fingers: [[30, 45, 30], [38, 50, 32], [45, 55, 34], [52, 60, 36]], thumb: [0.35, 0.3, 0.2] };

/** The waves, shared by the water's shader and the float riding them: [dirX, dirZ, length, height, speed]. */
const WAVES: [number, number, number, number, number][] = [
  [1, 0.35, 9, 0.09, 1.0],
  [0.4, 1, 5.5, 0.06, 1.3],
  [-0.7, 0.6, 3.2, 0.025, 1.7],
  [0.9, -0.5, 2.1, 0.014, 2.2]
];

function waveAt(x: number, z: number, t: number): number {
  let h = 0;
  for (const [dx, dz, len, amp, sp] of WAVES) {
    const l = Math.hypot(dx, dz);
    const k = (Math.PI * 2) / len;
    h += amp * Math.sin(k * ((dx / l) * x + (dz / l) * z) - t * sp * Math.sqrt(9.8 * k) * 0.35);
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
        ${WAVES.map((w, i) => `const vec4 W${i} = vec4(${(w[0] / Math.hypot(w[0], w[1])).toFixed(4)}, ${(w[1] / Math.hypot(w[0], w[1])).toFixed(4)}, ${((Math.PI * 2) / w[2]).toFixed(4)}, ${w[3].toFixed(4)}); const float S${i} = ${(w[4] * Math.sqrt((9.8 * Math.PI * 2) / w[2]) * 0.35).toFixed(4)};`).join('\n')}
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
        void main() {
          vec3 V = normalize(cameraPosition - vW);
          // A little extra ripple in the normal for the sparkle
          vec2 rp = vW.xz * 1.7 + vec2(uT * 0.4, uT * 0.25);
          vec3 N = normalize(vN + vec3(noise(rp) - 0.5, 0.0, noise(rp + 7.3) - 0.5) * 0.18);
          float dist = length(vW.xz - cameraPosition.xz);
          // Clear turquoise over the sand near, sapphire further out
          vec3 shallow = vec3(0.22, 0.86, 0.83);
          vec3 mid = vec3(0.07, 0.62, 0.78);
          vec3 deep = vec3(0.03, 0.33, 0.62);
          vec3 base = mix(shallow, mid, smoothstep(6.0, 45.0, dist));
          base = mix(base, deep, smoothstep(45.0, 240.0, dist));
          // Light through the waves onto the sand: soft caustic lace, near only
          float caus = pow(noise(vW.xz * 1.3 + uT * 0.3) * noise(vW.xz * 1.9 - uT * 0.25), 2.0);
          base += vec3(0.25, 0.35, 0.3) * caus * (1.0 - smoothstep(4.0, 30.0, dist));
          float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
          vec3 col = mix(base, uSky * 1.05, clamp(fres, 0.0, 0.85));
          vec3 R = reflect(-V, N);
          float sp = max(dot(R, uSun), 0.0);
          col += vec3(1.0, 0.95, 0.85) * (pow(sp, 260.0) * 3.0 + pow(sp, 60.0) * 0.1);
          // Foamy little crests on the near waves
          col += vec3(0.3) * smoothstep(0.13, 0.19, vW.y) * (1.0 - smoothstep(10.0, 40.0, dist));
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
    s.fog = new THREE.Fog(0xb4dcf2, 120, 620);
    const isle = new THREE.Group();
    // Left of frame is +X (he, and the camera, look down +Z)
    isle.position.set(98, -0.6, 265);
    s.add(isle);
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(24, 28, 1.6, 40), new THREE.MeshStandardMaterial({ color: 0xf2e2b8, roughness: 1 }));
    sand.scale.set(1.25, 1, 0.8);
    isle.add(sand);
    // The green: a few overlapping squashed domes, bumpy, deep and bright greens
    const greens = [0x2f7d32, 0x3f9a3a, 0x276b2b, 0x4caf50];
    const lumps: [number, number, number, number, number][] = [
      [0, 0, 0, 17, 9], [-9, 0, 3, 11, 7], [10, 0, -2, 12, 6.5], [3, 0, -6, 9, 10.5], [-4, 0, -4, 8, 8]
    ];
    lumps.forEach(([x, , z, r, h], i) => {
      const g = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
      const p = g.getAttribute('position');
      for (let k = 0; k < p.count; k++) {
        const vx = p.getX(k);
        const vy = p.getY(k);
        const vz = p.getZ(k);
        const n = 1 + 0.08 * Math.sin(vx * 7 + i) * Math.sin(vz * 6 - i) + 0.05 * Math.sin(vx * 17 + vz * 13);
        p.setXYZ(k, vx * n, vy * n, vz * n);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: greens[i % greens.length], roughness: 0.9, flatShading: true }));
      m.scale.set(r, h, r * 0.85);
      m.position.set(x, 0.6, z);
      isle.add(m);
    });
    // Palms round the beach, leaning out
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.9 });
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x2e8b3a, roughness: 0.8, side: THREE.DoubleSide });
    const frond = new THREE.PlaneGeometry(1.6, 6);
    frond.translate(0, 3, 0);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + Math.sin(i * 3.7) * 0.2;
      const r = 17 + Math.sin(i * 5.1) * 3;
      const palm = new THREE.Group();
      palm.position.set(Math.cos(a) * r * 1.2, 0.8, Math.sin(a) * r * 0.8);
      const h = 9 + (i % 3) * 2;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, h, 7), trunkMat);
      trunk.position.y = h / 2;
      palm.add(trunk);
      for (let k = 0; k < 7; k++) {
        const f = new THREE.Mesh(frond, frondMat);
        f.position.y = h;
        f.rotation.set(0, (k / 7) * Math.PI * 2, 1.1 + Math.sin(k * 2.3) * 0.2, 'YXZ');
        palm.add(f);
      }
      // Leaning away from the middle of the island
      palm.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
      isle.add(palm);
    }
    // Surf breaking white round the edge
    const surf = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.06, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    surf.rotation.x = -Math.PI / 2;
    surf.scale.set(30 * 1.12, 28 * 0.85, 1);
    surf.position.y = 0.62;
    isle.add(surf);
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
    const curry = new THREE.Mesh(new THREE.CircleGeometry(0.075, 28), new THREE.MeshStandardMaterial({ color: 0xc9681c, roughness: 0.35 }));
    curry.rotation.x = -Math.PI / 2;
    curry.position.y = 0.052;
    bowl.add(curry);
    // Chunks in it, a mound of rice to one side, a leaf of coriander
    const chunkCols = [0xe0b070, 0xa8421a, 0xd8c09a, 0x8a3a12];
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(new THREE.DodecahedronGeometry(0.011 + Math.random() * 0.008, 0), new THREE.MeshStandardMaterial({ color: chunkCols[i % 4], roughness: 0.6 }));
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.05;
      c.position.set(Math.cos(a) * r + 0.012, 0.057, Math.sin(a) * r);
      bowl.add(c);
    }
    const rice = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xfaf6ea, roughness: 0.9 }));
    rice.scale.set(1, 0.6, 1);
    rice.position.set(-0.03, 0.05, 0.01);
    bowl.add(rice);
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.008, 6), new THREE.MeshStandardMaterial({ color: 0x2f8a2a, roughness: 0.6, side: THREE.DoubleSide }));
      leaf.rotation.x = -Math.PI / 2 + 0.3;
      leaf.position.set(0.02 + i * 0.012, 0.064, -0.015 + i * 0.01);
      bowl.add(leaf);
    }
    const spoon = new THREE.Mesh(new THREE.CapsuleGeometry(0.004, 0.11, 2, 6), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.8 }));
    spoon.position.set(0.04, 0.085, 0);
    spoon.rotation.set(0, 0, 0.9);
    bowl.add(spoon);
    // Sat on top of the ring, out by his left elbow
    bowl.position.set(0.44, TUBE_R - 0.004, 0.26);
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
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: wisp, transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData.ph = i / 6;
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
    const twist = [0, 0, 0, 0, -6 + Math.sin(time * 0.31) * 4, -6 + Math.sin(time * 0.37) * 5];
    const roll = [0, 0, 0, 0, 0, 10];
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
    this.phone.position.copy(ear).addScaledVector(out, 0.022).addScaledVector(upO, -0.04);
    // The hand round the back of the base: the wrist below and outside it
    const wrist = this.phone.position.clone().addScaledVector(upO, -0.075).addScaledVector(out, 0.035).addScaledVector(fwd, 0.005);
    rig.seat({
      ...trunk,
      arms: {
        r: { wrist, along: upO.clone().addScaledVector(out, -0.25).normalize(), palm: out.clone().negate(), elbow: V3(-1, -0.6, 0.2), shape: PHONE_HAND },
        l: { wrist: V3(0.36, 0.25, 0.06), along: V3(0.25, -0.15, 1).normalize(), palm: V3(0.15, -1, 0).normalize(), elbow: V3(0.8, -0.5, -0.6), shape: HAND.relaxed }
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
    f.rotation.set(sz * 0.8, Math.sin(time * 0.05) * 0.25, -sx * 0.8, 'YXZ');
    this.poseRavi(time);

    // Steam off the curry
    for (const sp of this.steam) {
      const u = (time * 0.35 + sp.userData.ph) % 1;
      sp.position.set(Math.sin(time * 1.3 + sp.userData.ph * 9) * 0.015 * (1 + u * 2), 0.07 + u * 0.22, Math.cos(time * 1.1 + sp.userData.ph * 7) * 0.012);
      const s = 0.04 + u * 0.09;
      sp.scale.set(s, s, 1);
      (sp.material as THREE.SpriteMaterial).opacity = Math.sin(Math.PI * u) * 0.5;
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
