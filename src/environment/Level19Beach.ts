import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm } from './Level16Builder';
import { skyDome } from './Level19Sky';
import { crewVan } from './VanProps';

/**
 * Level19Beach — where the sea puts him down: a white beach on the lee side
 * of the island he saw from the air, the reef's turquoise out in front, the
 * palms along the top of the sand and the island's green hill behind, the
 * sun high and hot.
 *
 * Frame: the waterline runs along X; the sea is toward +Z, the land toward
 * −Z, the sand at y ≈ 0 where he lies (the origin). The beach runs a couple
 * of hundred metres each way; the boss is dragging himself off toward −X.
 */

export const BEACH_SUN = new THREE.Vector3(0.35, 0.82, 0.45).normalize();

/** The sand's height: down under the water toward +Z, up into the dunes toward −Z. */
export function sandY(x: number, z: number): number {
  const ripple = fbm(x / 9, z / 9, 3) * 0.06;
  const dune = z < -6 ? Math.min(2.6, Math.pow((-z - 6) / 28, 1.4) * 2.6) + fbm(x / 22, z / 22, 3) * 0.5 * THREE.MathUtils.smoothstep(-z, 8, 30) : 0;
  const shelf = z > 0 ? -Math.pow(z / 18, 1.25) * 1.6 - Math.max(0, z - 40) * 0.08 : 0;
  // The shore swings out and back a little along the beach
  const bay = Math.sin(x / 70) * 1.2 + Math.sin(x / 23 + 1) * 0.4;
  return 0.12 - (z - bay) * 0.035 + dune + shelf + ripple + (z < -2 ? 0 : 0);
}

export interface Beach {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  water: THREE.ShaderMaterial;
  /** Where the boss starts crawling from and where his drag mark in the sand leads. */
  bossFrom: THREE.Vector3;
  update(dt: number, time: number, cam: THREE.Camera): void;
}

function sandTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    const x = i % S;
    const y = Math.floor(i / S);
    const n = 0.9 + 0.1 * Math.random() + 0.05 * Math.sin((x + y * 0.3) * 0.08 + Math.sin(y * 0.05) * 3);
    const v = Math.min(255, Math.round(255 * n));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = Math.round(v * 0.985);
  }
  g.putImageData(img, 0, 0);
  // A few shells and bits of coral
  for (let i = 0; i < 60; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,240,225,0.9)' : 'rgba(190,170,150,0.7)';
    g.beginPath();
    g.ellipse(Math.random() * S, Math.random() * S, 1 + Math.random() * 2.5, 1 + Math.random() * 1.5, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(70, 35);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** One palm: a leaning, ringed trunk and a crown of drooping fronds, as geometry for merging. */
function palm(x: number, z: number, h: number, lean: number, yaw: number, seed: number): { trunk: THREE.BufferGeometry; fronds: THREE.BufferGeometry; nuts: THREE.BufferGeometry } {
  const y0 = sandY(x, z) - 0.2;
  const lx = Math.cos(yaw);
  const lz = Math.sin(yaw);
  const at = (u: number): THREE.Vector3 => {
    const bend = Math.pow(u, 1.6) * lean;
    return new THREE.Vector3(x + lx * bend, y0 + u * h, z + lz * bend);
  };
  const trunkParts: THREE.BufferGeometry[] = [];
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const a = at(i / segs);
    const b = at((i + 1) / segs);
    const r0 = 0.24 - (i / segs) * 0.09;
    const r1 = 0.24 - ((i + 1) / segs) * 0.09;
    const len = a.distanceTo(b);
    const c = new THREE.CylinderGeometry(r1, r0 * 1.06, len, 9, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    c.applyQuaternion(q);
    c.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    // Ring by ring: each segment darker at its base
    const n = c.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const uv = c.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < n; k++) {
      const s = 0.55 + 0.45 * uv.getY(k);
      col.set([0.52 * s, 0.42 * s, 0.31 * s], k * 3);
    }
    c.setAttribute('color', new THREE.BufferAttribute(col, 3));
    trunkParts.push(c.toNonIndexed());
  }
  const top = at(1);
  const frondParts: THREE.BufferGeometry[] = [];
  const nf = 9;
  for (let i = 0; i < nf; i++) {
    const ang = (i / nf) * Math.PI * 2 + seed;
    const len = 3.2 + ((i * 37 + seed * 11) % 7) * 0.12;
    const droop = 0.9 + ((i * 13) % 5) * 0.12;
    // A strip out from the crown, arching up then down, its leaflets as a wide sawtooth
    const pos: number[] = [];
    const col: number[] = [];
    const N = 10;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= N; k++) {
      const u = k / N;
      const out = u * len;
      const y = Math.sin(u * Math.PI * 0.5) * 0.9 - u * u * droop * 2.2;
      pts.push(new THREE.Vector3(Math.cos(ang) * out, y, Math.sin(ang) * out));
    }
    const side = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang));
    for (let k = 0; k < N; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const w0 = Math.sin(((k + 0.5) / N) * Math.PI) * 0.75 + 0.08;
      for (const sd of [1, -1]) {
        const tipA = a.clone().addScaledVector(side, sd * w0).add(new THREE.Vector3(0, -0.28, 0));
        const tipB = b.clone().addScaledVector(side, sd * w0 * 0.8).add(new THREE.Vector3(0, -0.3, 0));
        for (const p of [a, tipA, b, b, tipA, tipB]) pos.push(p.x + top.x, p.y + top.y, p.z + top.z);
        const g0 = 0.6 + 0.4 * (k / N);
        for (let m = 0; m < 6; m++) col.push(0.16 * g0, 0.42 * g0 + 0.05, 0.12 * g0);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    fg.computeVertexNormals();
    frondParts.push(fg);
  }
  const nutParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.SphereGeometry(0.13, 7, 6);
    const a = (i / 4) * Math.PI * 2 + seed * 2;
    s.translate(top.x + Math.cos(a) * 0.2, top.y - 0.22, top.z + Math.sin(a) * 0.2);
    nutParts.push(s.toNonIndexed());
  }
  return { trunk: mergeGeometries(trunkParts, false)!, fronds: mergeGeometries(frondParts, false)!, nuts: mergeGeometries(nutParts, false)! };
}

function rock(x: number, z: number, s: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(s, 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = 1 + fbm(v.x * 1.3 + seed, v.y * 1.3 + v.z, 3) * 0.45;
    v.multiplyScalar(k);
    v.y *= 0.62;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.translate(x, sandY(x, z) + s * 0.2, z);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

export function buildBeach(): Beach {
  const scene = new THREE.Scene();
  const sky = skyDome();
  const su = (sky.material as THREE.ShaderMaterial).uniforms;
  su.uZenith.value.setHex(0x1f6fc4);
  su.uHorizon.value.setHex(0xcfe6f2);
  su.uSun.value.copy(BEACH_SUN);
  scene.add(sky);
  scene.fog = new THREE.Fog(0xcfe6f2, 260, 1800);

  const sun = new THREE.DirectionalLight(0xfff3dc, 3.1);
  sun.position.copy(BEACH_SUN).multiplyScalar(100);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0xf1dfb6, 1.15));

  // ---- the sand
  const W = 520;
  const D = 260;
  const sand = new THREE.PlaneGeometry(W, D, 260, 160);
  sand.rotateX(-Math.PI / 2);
  sand.translate(0, 0, -D / 2 + 70);
  const sp = sand.getAttribute('position') as THREE.BufferAttribute;
  const scol = new Float32Array(sp.count * 3);
  const dry = new THREE.Color(0xf3e6c4);
  const wet = new THREE.Color(0xc9b384);
  const under = new THREE.Color(0xd8cfa8);
  const grass = new THREE.Color(0x7a9a4a);
  const c = new THREE.Color();
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i);
    const z = sp.getZ(i);
    const y = sandY(x, z);
    sp.setY(i, y);
    if (y < -0.05) c.copy(under);
    else if (y < 0.28) c.copy(wet).lerp(dry, THREE.MathUtils.smoothstep(y, 0.05, 0.28));
    else c.copy(dry);
    if (z < -30) c.lerp(grass, THREE.MathUtils.smoothstep(-z, 30, 46) * (0.6 + 0.4 * fbm(x / 8, z / 8, 2)));
    c.multiplyScalar(0.96 + 0.06 * fbm(x / 3, z / 3, 2));
    scol.set([c.r, c.g, c.b], i * 3);
  }
  sand.setAttribute('color', new THREE.BufferAttribute(scol, 3));
  sand.computeVertexNormals();
  const sandMesh = new THREE.Mesh(sand, new THREE.MeshStandardMaterial({ vertexColors: true, map: sandTexture(), roughness: 0.96 }));
  scene.add(sandMesh);

  // ---- the boss's drag mark: a dark, smoothed furrow from where he came out of the sea
  const bossFrom = new THREE.Vector3(-22.5, 0, 2.4);
  {
    const pos: number[] = [];
    const N = 40;
    const from = bossFrom;
    const to = new THREE.Vector3(-24.6, 0, -3.6);
    for (let k = 0; k < N; k++) {
      const a = from.clone().lerp(to, k / N);
      const b = from.clone().lerp(to, (k + 1) / N);
      const wob = (u: number): number => Math.sin(u * 9) * 0.12;
      const w = 0.32;
      // Across the furrow: square to its run, in the ground's plane
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const dl = Math.hypot(dx, dz);
      const sx = (-dz / dl) * w;
      const sz = (dx / dl) * w;
      const ax = a.x + wob(k / N);
      const bx = b.x + wob((k + 1) / N);
      const y = (x: number, z: number): number => sandY(x, z) + 0.02;
      pos.push(ax - sx, y(ax - sx, a.z - sz), a.z - sz, bx - sx, y(bx - sx, b.z - sz), b.z - sz, bx + sx, y(bx + sx, b.z + sz), b.z + sz);
      pos.push(ax - sx, y(ax - sx, a.z - sz), a.z - sz, bx + sx, y(bx + sx, b.z + sz), b.z + sz, ax + sx, y(ax + sx, a.z + sz), a.z + sz);
    }
    // Across it, soft at the edges and streaked along its length where his clothes dragged
    const uvs: number[] = [];
    for (let k = 0; k < N; k++) {
      const v0 = k / N;
      const v1 = (k + 1) / N;
      uvs.push(0, v0, 0, v1, 1, v1, 0, v0, 1, v1, 1, v0);
    }
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 256;
    const cg = cv.getContext('2d')!;
    for (let x = 0; x < 64; x++) {
      const e = Math.sin((x / 63) * Math.PI);
      for (let y = 0; y < 256; y += 2) {
        const streak = 0.6 + 0.4 * Math.sin(x * 1.7 + Math.sin(y * 0.05) * 2);
        cg.fillStyle = `rgba(110,88,55,${(e * 0.8 * streak).toFixed(3)})`;
        cg.fillRect(x, y, 1, 2);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }));
    scene.add(m);
  }

  // ---- the water: shallow and clear over the sand, turquoise out over the reef, deep blue past it
  const wg = new THREE.PlaneGeometry(2400, 1300, 240, 120);
  wg.rotateX(-Math.PI / 2);
  wg.translate(0, 0, 640);
  const wp = wg.getAttribute('position') as THREE.BufferAttribute;
  const depth = new Float32Array(wp.count);
  for (let i = 0; i < wp.count; i++) depth[i] = -sandY(wp.getX(i), Math.min(wp.getZ(i), 120)) - Math.max(0, wp.getZ(i) - 120) * 0.12;
  wg.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  const water = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: BEACH_SUN.clone() },
      uShallow: { value: new THREE.Color(0x6fe3d6) },
      uMid: { value: new THREE.Color(0x14b2c4) },
      uDeep: { value: new THREE.Color(0x0b4f8c) },
      uSky: { value: new THREE.Color(0xbfe0f2) },
      uFog: { value: new THREE.Color(0xcfe6f2) }
    },
    vertexShader: /* glsl */ `
      attribute float aDepth;
      uniform float uTime;
      varying float vDepth;
      varying vec3 vWorld;
      void main() {
        vec3 p = position;
        // The swell, dying away as it comes into the shallows
        float sw = smoothstep(0.0, 2.0, aDepth);
        p.y += (sin(p.z * 0.35 - uTime * 1.3) * 0.06 + sin(p.x * 0.21 + p.z * 0.1 - uTime * 0.9) * 0.04) * sw;
        // The wash running up the sand and back
        p.y += sin(uTime * 0.55) * 0.035 + 0.01;
        vDepth = aDepth;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSun, uShallow, uMid, uDeep, uSky, uFog;
      varying float vDepth;
      varying vec3 vWorld;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        float wash = sin(uTime * 0.55) * 0.035 + 0.01;
        float d = vDepth + wash;
        if (d < -0.02) discard;
        vec2 p = vWorld.xz;
        float rip = n2(p * 0.9 + vec2(uTime * 0.25, uTime * 0.1)) * 0.6 + n2(p * 2.3 - vec2(uTime * 0.3, 0.0)) * 0.4;
        vec3 n = normalize(vec3((rip - 0.5) * 0.35, 1.0, (n2(p * 1.7 + 3.0 + uTime * 0.2) - 0.5) * 0.35));
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 v = toCam / dist;
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 body = mix(uShallow, uMid, smoothstep(0.2, 3.0, d));
        body = mix(body, uDeep, smoothstep(4.0, 22.0, d));
        vec3 col = mix(body, uSky, fres * 0.7);
        float spec = pow(max(dot(reflect(-v, n), uSun), 0.0), 160.0);
        col += vec3(1.0, 0.97, 0.9) * spec * 1.8;
        // Foam where it breaks on the sand, a line of it that comes and goes
        float edge = 1.0 - smoothstep(0.0, 0.12 + rip * 0.08, d);
        float lace = smoothstep(0.45, 0.75, n2(p * 3.0 + uTime * 0.4));
        float band = smoothstep(0.55, 0.8, sin(d * 9.0 - uTime * 1.6) * 0.5 + 0.5) * (1.0 - smoothstep(0.2, 0.9, d)) * lace;
        col = mix(col, vec3(0.97, 0.99, 1.0), clamp(edge * 0.9 + band * 0.6, 0.0, 1.0));
        float alpha = mix(0.45, 0.96, smoothstep(0.0, 1.6, d));
        alpha = max(alpha, edge * 0.85);
        float fogF = smoothstep(260.0, 1800.0, dist);
        col = mix(col, uFog, fogF);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const waterMesh = new THREE.Mesh(wg, water);
  waterMesh.renderOrder = 1;
  scene.add(waterMesh);

  // ---- the palms along the top of the beach, and a couple leaning out over it
  const trunks: THREE.BufferGeometry[] = [];
  const fronds: THREE.BufferGeometry[] = [];
  const nuts: THREE.BufferGeometry[] = [];
  let s = 11;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < 46; i++) {
    const x = -180 + i * 8 + (rnd() - 0.5) * 6;
    const z = -16 - rnd() * 22 - (Math.abs(x) < 12 ? 4 : 0);
    const p = palm(x, z, 7 + rnd() * 5, 1.2 + rnd() * 2.8, Math.PI / 2 + (rnd() - 0.5) * 1.6, rnd() * 6);
    trunks.push(p.trunk);
    fronds.push(p.fronds);
    nuts.push(p.nuts);
  }
  for (const [x, z, lean] of [[14, -11, 4.6], [-22, -10, 5.2], [38, -12, 3.8]] as const) {
    const p = palm(x, z, 8.5, lean, Math.PI / 2 + 0.2, x);
    trunks.push(p.trunk);
    fronds.push(p.fronds);
    nuts.push(p.nuts);
  }
  scene.add(new THREE.Mesh(mergeGeometries(trunks, false)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));
  scene.add(new THREE.Mesh(mergeGeometries(fronds, false)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide })));
  scene.add(new THREE.Mesh(mergeGeometries(nuts, false)!, new THREE.MeshStandardMaterial({ color: 0x5a4126, roughness: 0.8 })));

  // ---- the jungle behind: a green hill, and bushes heaped along its foot
  {
    const g = new THREE.PlaneGeometry(900, 500, 120, 60);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -290);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const k = THREE.MathUtils.smoothstep(-z, 44, 140);
      const y = sandY(x, Math.max(z, -45)) + k * (26 + 52 * Math.exp(-Math.pow(x / 160, 2))) * (0.7 + 0.6 * (fbm(x / 70, z / 70, 4) * 0.5 + 0.5)) - (z > -46 ? 1 : 0);
      p.setY(i, y);
      const g0 = 0.75 + 0.5 * (fbm(x / 20, z / 20, 3) * 0.5 + 0.5);
      col.set([0.12 * g0, 0.33 * g0, 0.12 * g0], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const ng = g.toNonIndexed();
    ng.computeVertexNormals();
    scene.add(new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })));
    const bush = new THREE.IcosahedronGeometry(1, 1);
    const n = 260;
    const inst = new THREE.InstancedMesh(bush, new THREE.MeshStandardMaterial({ color: 0x2f6a2a, roughness: 0.9, flatShading: true }), n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const cc = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = -200 + rnd() * 400;
      const z = -38 - rnd() * 22;
      const sc = 1.2 + rnd() * 2.4;
      q.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd()));
      m.compose(new THREE.Vector3(x, sandY(x, z) + sc * 0.3, z), q, new THREE.Vector3(sc * 1.3, sc, sc * 1.2));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, cc.setHSL(0.27 + rnd() * 0.06, 0.55, 0.2 + rnd() * 0.12));
    }
    scene.add(inst);
    // The forest on the hill: round crowns on short trunks, a few hundred of them, one draw each
    const hillY = (x: number, z: number): number => {
      const k = THREE.MathUtils.smoothstep(-z, 44, 140);
      return sandY(x, Math.max(z, -45)) + k * (26 + 52 * Math.exp(-Math.pow(x / 160, 2))) * (0.7 + 0.6 * (fbm(x / 70, z / 70, 4) * 0.5 + 0.5)) - 1;
    };
    const nt = 1500;
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), nt);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 1, 5), new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.95 }), nt);
    for (let i = 0; i < nt; i++) {
      const x = -300 + rnd() * 600;
      const z = -44 - Math.pow(rnd(), 0.8) * 210;
      const y = hillY(x, z);
      const h = 3 + rnd() * 5;
      const r = 2.2 + rnd() * 2.8;
      m.compose(new THREE.Vector3(x, y + h * 0.5, z), q.identity(), new THREE.Vector3(1, h, 1));
      trunk.setMatrixAt(i, m);
      q.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd()));
      m.compose(new THREE.Vector3(x, y + h + r * 0.5, z), q, new THREE.Vector3(r * 1.15, r * 0.85, r));
      crown.setMatrixAt(i, m);
      crown.setColorAt(i, cc.setHSL(0.24 + rnd() * 0.1, 0.5 + rnd() * 0.2, 0.16 + rnd() * 0.14));
    }
    scene.add(trunk, crown);
  }

  // ---- rocks: a dark spit of them out into the water at the far end, a few on the sand
  {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 18; i++) parts.push(rock(-84 - i * 2.6 + Math.sin(i) * 2, 4 + i * 1.9 + Math.cos(i * 1.7) * 2, 1.2 + (i % 4) * 0.7, i));
    for (let i = 0; i < 12; i++) parts.push(rock(70 + i * 3, 2 + i * 2.2 + Math.sin(i * 2) * 1.5, 1 + (i % 3) * 0.8, i + 40));
    for (const [x, z, sz] of [[9, -4, 0.45], [-14, -7, 0.6], [24, -2, 0.35], [-33, -9, 0.5]] as const) parts.push(rock(x, z, sz, x));
    scene.add(new THREE.Mesh(mergeGeometries(parts, false)!, new THREE.MeshStandardMaterial({ color: 0x4f4a45, roughness: 0.88, flatShading: true })));
  }

  // ---- driftwood, and the van they came in, nose up the beach, still dripping
  {
    const wood = new THREE.MeshStandardMaterial({ color: 0x9c8c78, roughness: 0.95 });
    for (const [x, z, r, l] of [[6, -6, 0.6, 2.8], [-9, -3.6, 2.1, 1.9], [19, -8.5, -0.4, 3.4]] as const) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, l, 7), wood);
      log.rotation.set(Math.PI / 2, 0, r);
      log.position.set(x, sandY(x, z) + 0.08, z);
      scene.add(log);
    }
    const van = crewVan();
    van.group.position.set(9.5, sandY(9.5, 3.5) - 0.18, 3.5);
    van.group.rotation.set(0.03, -2.5, 0.04);
    scene.add(van.group);
  }

  const update = (_dt: number, time: number, cam: THREE.Camera): void => {
    water.uniforms.uTime.value = time;
    sky.position.copy(cam.position);
  };
  return { scene, sun, water, bossFrom, update };
}
