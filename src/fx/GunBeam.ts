import * as THREE from 'three';

/** What a beam ran into: how far, and the face it landed on. */
export interface BeamHit {
  dist: number;
  normal: THREE.Vector3;
}

/** Cast a ray for the pool. Return null when nothing is in range. */
export type BeamProbe = (origin: THREE.Vector3, dir: THREE.Vector3, far: number) => BeamHit | null;

const SHAFT_SEGMENTS = 12;

/**
 * The torches clipped to the agents' weapons.
 *
 * On a floor with no power these are the only thing that gives them away: a
 * beam swinging round a corner arrives well before its owner does.
 *
 * Built entirely out of unlit geometry — a shaft, a lens and a patch where it
 * lands — with no actual light source. The previous version used real
 * spotlights, and every problem with it came from that: the light count is
 * baked into every material's shader, an unshadowed cone lights straight
 * through walls, a shadowed one costs a map render each, and the brightness
 * that survives to the wall is the product of intensity, decay, distance
 * windowing, the scene fog and the tone mapping curve. Tuning that to read
 * the same at two metres and at ten was a losing game.
 *
 * Additive meshes have none of that. What is written here is what appears,
 * at any range, and the only thing that can hide a beam is geometry actually
 * in front of it.
 *
 * Occlusion is conservative on purpose. The shaft is cut to the SHORTEST of
 * five rays across its cross-section, so a half-blocked beam stops at the
 * near edge rather than poking a corner through the wall. Slightly short is
 * invisible; slightly long is the bug that has been reported three times.
 */
export class GunBeamPool {
  private shafts: THREE.Mesh[] = [];
  private lenses: THREE.Sprite[] = [];
  private patches: THREE.Mesh[] = [];
  private readonly range: number;
  private readonly halfAngle: number;
  private probe: BeamProbe;

  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();
  private static tmpC = new THREE.Vector3();
  private static DOWN = new THREE.Vector3(0, -1, 0);
  private static FWD = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene, count: number, probe: BeamProbe, range = 16, halfAngle = Math.PI / 14) {
    this.range = range;
    this.halfAngle = halfAngle;
    this.probe = probe;

    // One shared texture for the lens and the patch: a soft round falloff, so
    // neither reads as a hard-edged disc.
    const glow = GunBeamPool.radialTexture();
    // A flat-alpha shell is what made these unreadable. A cone is a thin
    // skin, so head-on you look along the whole surface at once and it stacks
    // into a hard white wedge across the screen — which is what a beam aimed
    // anywhere near the camera looked like.
    //
    // Shading it by dot(normal, view) inverts that. Side-on the near face
    // points at you and the shaft reads solid, while its silhouette falls off
    // to nothing instead of ending on a line. Look down the axis and the whole
    // skin is edge-on, so it fades out and leaves just the lens — which is
    // what you actually see when a torch is pointed at you.
    const shaftMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffeccd) },
        uStrength: { value: 0.5 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec3 vN;
        varying vec3 vV;
        varying float vAlong;
        void main() {
          // Cone v runs 0 at the base to 1 at the apex, and the apex is the
          // muzzle end, so flip it: 0 at the muzzle, 1 where it lands.
          vAlong = 1.0 - uv.y;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = cameraPosition - wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uStrength;
        varying vec3 vN;
        varying vec3 vV;
        varying float vAlong;
        void main() {
          float facing = abs(dot(normalize(vN), normalize(vV)));
          // Soft silhouette, and near-invisible seen end-on
          float edge = pow(facing, 1.7);
          // The cone widens as it goes, so the same light spreads thinner
          float spread = mix(1.0, 0.28, vAlong);
          // Never end on a hard rim, even when it stops in open air
          float tip = smoothstep(1.0, 0.82, vAlong);
          gl_FragColor = vec4(uColor, uStrength * edge * spread * tip);
        }
      `
    });
    const lensMat = new THREE.SpriteMaterial({
      map: glow,
      color: 0xfff6e2,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const patchMat = new THREE.MeshBasicMaterial({
      map: glow,
      color: 0xffe9c4,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // Unit cone: one metre long, apex at the muzzle end, scaled per frame.
    const cone = new THREE.ConeGeometry(Math.tan(halfAngle), 1, SHAFT_SEGMENTS, 1, true);
    const disc = new THREE.PlaneGeometry(1, 1);

    for (let i = 0; i < count; i++) {
      const shaft = new THREE.Mesh(cone, shaftMat);
      shaft.visible = false;
      shaft.frustumCulled = false;
      scene.add(shaft);
      this.shafts.push(shaft);

      const lens = new THREE.Sprite(lensMat);
      lens.scale.setScalar(0.26);
      lens.visible = false;
      scene.add(lens);
      this.lenses.push(lens);

      const patch = new THREE.Mesh(disc, patchMat.clone());
      patch.visible = false;
      patch.frustumCulled = false;
      scene.add(patch);
      this.patches.push(patch);
    }
  }

  /** Soft round falloff, used for the lens and the patch on the wall. */
  private static radialTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,247,228,0.72)');
    grad.addColorStop(0.72, 'rgba(255,240,205,0.2)');
    grad.addColorStop(1, 'rgba(255,236,195,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  get size(): number {
    return this.shafts.length;
  }

  /**
   * Point beam `i` from `from` along `dir`.
   *
   * Five rays are cast — the centre plus four around the rim of the cone —
   * and the shaft is cut to the shortest. That is what keeps a beam whose
   * centre clears a doorway from pushing the rest of its cone through the
   * jamb beside it.
   */
  aim(i: number, from: THREE.Vector3, dir: THREE.Vector3): void {
    if (i >= this.shafts.length) return;
    const d = GunBeamPool.tmpA.copy(dir).normalize();

    // Two axes across the beam, to spread the rim rays over
    const up = Math.abs(d.y) > 0.9 ? GunBeamPool.FWD : GunBeamPool.DOWN;
    const sideA = GunBeamPool.tmpB.copy(d).cross(up).normalize();
    const sideB = GunBeamPool.tmpC.copy(d).cross(sideA).normalize();

    const spread = Math.tan(this.halfAngle);
    let len = this.range;
    // The patch belongs to the CENTRE ray alone. Taking it from whichever of
    // the five was shortest put it on the centre axis but at a side wall's
    // angle — a lit slab hanging in mid-air at the end of the beam, tilted
    // away from anything it could be lying on.
    let normal: THREE.Vector3 | null = null;
    let landed = 0;
    const centre = this.probe(from, d, this.range);
    if (centre) {
      len = centre.dist;
      normal = centre.normal;
      landed = centre.dist;
    }
    // Rim rays: same origin, tilted out to the edge of the cone
    const rim = new THREE.Vector3();
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      rim.copy(d).addScaledVector(sideA, spread * a).addScaledVector(sideB, spread * b).normalize();
      const h = this.probe(from, rim, len);
      if (h && h.dist < len) len = h.dist;
    }
    len = Math.max(0.35, len);

    const shaft = this.shafts[i];
    shaft.visible = true;
    // Apex at the muzzle, so the body is centred half its length along
    shaft.position.copy(from).addScaledVector(d, len / 2);
    shaft.quaternion.setFromUnitVectors(GunBeamPool.DOWN, d);
    shaft.scale.set(len, len, len);


    const lens = this.lenses[i];
    lens.visible = true;
    lens.position.copy(from);

    // The patch where it lands, laid on the surface it hit
    const patch = this.patches[i];
    const patchMatI = patch.material as THREE.MeshBasicMaterial;
    // How squarely it lands. A beam skimming along the floor spreads its light
    // over metres, so a round pool there is wrong twice over — wrong shape and
    // far too bright. Fade it out instead of drawing a slab down the floor.
    const square = normal ? Math.abs(d.dot(normal)) : 0;
    // ...and drop it entirely when a rim ray cut the shaft well short of where
    // the centre landed, because then the centre never reached a surface.
    if (normal && square > 0.18 && landed <= len + 0.3) {
      patch.visible = true;
      patchMatI.opacity = 0.8 * Math.min(1, (square - 0.18) / 0.45);
      patch.position.copy(from).addScaledVector(d, landed).addScaledVector(normal, 0.02);
      patch.quaternion.setFromUnitVectors(GunBeamPool.FWD, normal);
      // Sized off the cone rather than picked by eye. The old version was a
      // flat 3.5m at range, which is where the big lit circles with no visible
      // owner came from — a pool far wider than the beam that made it, on a
      // wall two rooms away.
      patch.scale.setScalar(Math.min(2.4, 2.2 * Math.tan(this.halfAngle) * len + 0.3));
    } else {
      patch.visible = false;
    }
  }

  /** Put beam `i` out — its owner is down. */
  kill(i: number): void {
    if (i >= this.shafts.length) return;
    this.shafts[i].visible = false;
    this.lenses[i].visible = false;
    this.patches[i].visible = false;
  }

  dispose(): void {
    for (const m of this.shafts) m.removeFromParent();
    for (const m of this.lenses) m.removeFromParent();
    for (const m of this.patches) m.removeFromParent();
    this.shafts.length = 0;
    this.lenses.length = 0;
    this.patches.length = 0;
  }
}

/**
 * The bit of light Ravi has on him — no torch, just enough of a warm spill to
 * make out what is directly in front of his feet. Deliberately short-ranged:
 * it is meant to leave the corridor dark, not solve it.
 */
export class PlayerGlow {
  private light: THREE.PointLight;

  constructor(camera: THREE.Camera, intensity = 1.15, distance = 2.6) {
    this.light = new THREE.PointLight(0xffb066, intensity, distance, 1.7);
    this.light.position.set(0, -0.35, -0.25);
    camera.add(this.light);
  }

  dispose(): void {
    this.light.removeFromParent();
  }
}
