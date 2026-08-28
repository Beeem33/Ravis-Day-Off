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
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0xffeccd,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const lensMat = new THREE.SpriteMaterial({
      map: glow,
      color: 0xfff6e2,
      transparent: true,
      opacity: 0.95,
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
      lens.scale.setScalar(0.5);
      lens.visible = false;
      scene.add(lens);
      this.lenses.push(lens);

      const patch = new THREE.Mesh(disc, patchMat);
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
    let normal: THREE.Vector3 | null = null;
    const centre = this.probe(from, d, this.range);
    if (centre) {
      len = centre.dist;
      normal = centre.normal;
    }
    // Rim rays: same origin, tilted out to the edge of the cone
    const rim = new THREE.Vector3();
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      rim.copy(d).addScaledVector(sideA, spread * a).addScaledVector(sideB, spread * b).normalize();
      const h = this.probe(from, rim, len);
      if (h && h.dist < len) {
        len = h.dist;
        normal = h.normal;
      }
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
    if (normal) {
      patch.visible = true;
      patch.position.copy(from).addScaledVector(d, len).addScaledVector(normal, 0.02);
      patch.quaternion.setFromUnitVectors(GunBeamPool.FWD, normal);
      // Generous on purpose. The geometric footprint of the cone is only a
      // few tens of centimetres at the ranges these are actually used at —
      // an agent stood a couple of metres off a wall — and at that size the
      // pool is a handful of pixels from down the corridor and might as well
      // not be there. This is the tell; it has to read.
      patch.scale.setScalar(Math.min(3.5, 0.9 + len * 0.6));
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
