import * as THREE from 'three';

const CRT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const CRT_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    // Barrel distortion
    vec2 uv = vUv * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    uv *= 1.0 + 0.055 * r2 + 0.02 * r2 * r2;
    uv = uv * 0.5 + 0.5;

    // Outside the curved tube: black bezel
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Slight chromatic aberration
    float ca = 0.0016 * (1.0 + r2 * 2.0);
    vec3 col;
    col.r = texture2D(uTex, uv + vec2(ca, 0.0)).r;
    col.g = texture2D(uTex, uv).g;
    col.b = texture2D(uTex, uv - vec2(ca, 0.0)).b;

    // Scanlines
    float scan = 0.88 + 0.12 * sin(uv.y * uResolution.y * 3.14159);
    col *= scan;

    // Phosphor triad mask
    float mask = 0.93 + 0.07 * sin(uv.x * uResolution.x * 3.14159);
    col *= mask;

    // Rolling band
    float band = 0.97 + 0.03 * sin(uv.y * 8.0 - uTime * 1.2);
    col *= band;

    // Static noise
    float n = hash(uv * uResolution.xy * 0.5 + uTime * 60.0);
    col += (n - 0.5) * 0.045;

    // Phosphor glow lift + green-ish tint of cheap security CRTs
    col = pow(max(col, 0.0), vec3(0.92));
    col *= vec3(0.96, 1.03, 0.99);

    // Vignette
    float vig = 1.0 - 0.45 * r2;
    col *= vig;

    // Flicker
    col *= 0.985 + 0.015 * sin(uTime * 73.0);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * CRTPass — renders a source scene into an offscreen target, then draws it
 * to screen through a CRT shader (barrel curvature, scanlines, phosphor
 * mask, static noise, vignette, flicker).
 */
export class CRTPass {
  private rt: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;

  constructor(width: number, height: number) {
    this.rt = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.SRGBColorSpace
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: CRT_VERT,
      fragmentShader: CRT_FRAG,
      uniforms: {
        uTex: { value: this.rt.texture },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(width, height) }
      },
      depthTest: false,
      depthWrite: false
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  setSize(width: number, height: number): void {
    this.rt.setSize(width, height);
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(width, height);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    this.material.uniforms.uTime.value = time;
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCam);
  }
}
