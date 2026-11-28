import * as THREE from 'three';

/**
 * StreetBackdrop — what's out on the horizon round the street level, drawn
 * the way the sky is: bands on the inside of a cylinder that rides along
 * with the camera, so however far he drives they stay out there at the edge
 * of the world and never come any nearer.
 *
 *   dustStorm(bearing, span)  a haboob: a wall of brown dust hundreds of
 *                             metres high rolling along the horizon, its
 *                             top boiling, centred on a world bearing
 *   mountains()               a ragged range of hazy mountains all the way
 *                             round, low, behind everything
 *
 * Bearings are atan2(x, z) of a world direction. Both are added to a scene
 * and need `update(dt)` each frame (the storm churns).
 */

const NOISE = /* glsl */ `
  float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 5; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s;
  }
`;

/** Rides on the camera (x and z only: it stands on the ground wherever he is). */
function ride(mesh: THREE.Mesh, baseY: number): void {
  const cam = new THREE.Vector3();
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (_r, _s, camera) => {
    cam.setFromMatrixPosition(camera.matrixWorld);
    mesh.matrixWorld.makeTranslation(cam.x, baseY, cam.z);
  };
}

export class Backdrop {
  readonly group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];

  /**
   * The storm. `bearing`: the way it lies from him (radians, atan2(x, z));
   * `span`: how far round the horizon it reaches either side of that.
   * `ground`: the ground's height; `haze`: the fog colour it sits back in.
   */
  dustStorm(bearing: number, span: number, ground: number, haze: THREE.Color): void {
    const R = 1000;
    const H = 460;
    const geo = new THREE.CylinderGeometry(R, R, H, 160, 1, true, bearing - span, span * 2);
    geo.translate(0, H / 2, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.BackSide,
      uniforms: { uTime: { value: 0 }, uCentre: { value: bearing }, uSpan: { value: span }, uHaze: { value: haze.clone() } },
      vertexShader: /* glsl */ `
        varying vec2 vXZ;
        varying float vH;
        void main() {
          vXZ = position.xz;
          vH = position.y / ${H.toFixed(1)};
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uCentre, uSpan;
        uniform vec3 uHaze;
        varying vec2 vXZ;
        varying float vH;
        ${NOISE}
        void main() {
          // (the angle worked out here, not passed down: across the one strip of the band where it wraps round
          // from +pi to -pi, an interpolated angle runs the wrong way the whole way round, and shows as a seam)
          float vAng = atan(vXZ.x, vXZ.y);
          float d = vAng - uCentre;
          d = atan(sin(d), cos(d));
          float a = d / uSpan;                       // -1..1 across it
          float sector = 1.0 - smoothstep(0.62, 1.0, abs(a));
          float t = uTime;
          // Its top: highest in the middle of it, boiling up in great heads, rolling along
          float bulk = 0.45 + 0.42 * (1.0 - a * a);
          float heads = 0.22 * fbm(vec2(d * 9.0 + t * 0.012, t * 0.01)) + 0.12 * fbm(vec2(d * 31.0 - t * 0.03, 3.0 + t * 0.02));
          float top = (bulk * 0.62 + heads) * sector;
          float edge = smoothstep(top, top - 0.09, vH);
          if (edge * sector < 0.01) discard;
          // Inside it: big churning billows, dark and thick low down, lit tan on the tops of them
          float bill = fbm(vec2(d * 22.0 + t * 0.02, vH * 7.0 - t * 0.035));
          float fine = fbm(vec2(d * 70.0 - t * 0.05, vH * 22.0 + t * 0.04));
          vec3 dark = vec3(0.33, 0.21, 0.12);
          vec3 mid = vec3(0.6, 0.41, 0.24);
          vec3 lit = vec3(0.86, 0.68, 0.46);
          float shade = clamp(vH / max(top, 0.05) * 0.6 + (bill - 0.5) * 1.3 + (fine - 0.5) * 0.4, 0.0, 1.0);
          vec3 col = mix(dark, mid, smoothstep(0.0, 0.55, shade));
          col = mix(col, lit, smoothstep(0.55, 1.0, shade));
          // The sun catching the boiling tops of it
          col += vec3(0.08, 0.06, 0.03) * smoothstep(top - 0.12, top - 0.02, vH);
          // Way off: some of the haze in front of it
          col = mix(col, uHaze, 0.1 + 0.12 * (1.0 - vH));
          float alpha = min(1.0, edge * sector * (0.95 + 0.25 * bill));
          // Thinner out at its ends, where it trails off along the horizon
          alpha *= 0.55 + 0.45 * (1.0 - smoothstep(0.35, 0.9, abs(a)));
          gl_FragColor = vec4(col, alpha);
          #include <colorspace_fragment>
        }
      `
    });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'street-duststorm';
    m.renderOrder = -1;
    ride(m, ground - 20);
    this.group.add(m);
    this.mats.push(mat);
  }

  /** A low ragged range of mountains all the way round, far off and blue with it. */
  mountains(ground: number, haze: THREE.Color): void {
    const R = 1120;
    const H = 150;
    const geo = new THREE.CylinderGeometry(R, R, H, 256, 1, true);
    geo.translate(0, H / 2, 0);
    const mat = new THREE.ShaderMaterial({
      depthWrite: false,
      fog: false,
      side: THREE.BackSide,
      uniforms: { uHaze: { value: haze.clone() } },
      vertexShader: /* glsl */ `
        varying vec2 vXZ;
        varying float vH;
        void main() {
          vXZ = position.xz;
          vH = position.y / ${H.toFixed(1)};
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uHaze;
        varying vec2 vXZ;
        varying float vH;
        ${NOISE}
        void main() {
          // (the angle worked out here, not passed down: across the one strip of the band where it wraps round
          // from +pi to -pi, an interpolated angle runs the wrong way the whole way round, and shows as a seam)
          float vAng = atan(vXZ.x, vXZ.y);
          // Two ranges: a nearer, darker, lower one, and a paler taller one behind it
          vec2 q = vec2(cos(vAng), sin(vAng));
          float back = 0.34 + 0.38 * fbm(q * 2.2 + 4.0) + 0.12 * fbm(q * 9.0) + 0.04 * fbm(q * 30.0);
          float front = 0.2 + 0.26 * fbm(q * 3.1 - 7.0) + 0.08 * fbm(q * 14.0 + 2.0) + 0.03 * fbm(q * 45.0);
          vec3 cBack = vec3(0.50, 0.53, 0.61);
          vec3 cFront = vec3(0.40, 0.40, 0.44);
          vec3 col;
          if (vH < front) col = cFront * (0.92 + 0.12 * fbm(q * 60.0 + vH * 9.0));
          else if (vH < back) col = cBack;
          else discard;
          // Lighter toward its feet, in the haze over the plain
          col = mix(col, uHaze, 0.2 + 0.35 * (1.0 - smoothstep(0.0, 0.4, vH)));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `
    });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'street-mountains';
    // (after the sky, which doesn't keep its depth: drawn before it, the sky would paint over them)
    m.renderOrder = -0.5;
    ride(m, ground - 25);
    this.group.add(m);
    this.mats.push(mat);
  }

  update(dt: number): void {
    for (const m of this.mats) if (m.uniforms.uTime) m.uniforms.uTime.value += dt;
  }
}
