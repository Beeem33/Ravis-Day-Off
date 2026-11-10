import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Collider } from '../environment/OfficeLevelBuilder';
import type { ParticleManager } from '../fx/ParticleManager';
import type { Debris } from '../fx/Debris';

/**
 * OutpostTower — one of the four watchtowers in the Collective's car park: a
 * concrete footing, four steel legs braced up to a platform, an armoured
 * cabin on it and, on the cabin roof, an automated turret — a twin-barrelled
 * gun on a slewing mount with a searchlight beside it.
 *
 * The turret hunts. It sweeps its light over the lot until the scene gives
 * it a target, slews onto it (servos whining), holds it in the beam for a
 * moment — the warning — and fires a burst; then looks for the next.
 *
 * A rocket brings the whole thing down: the cabin goes up, the turret is
 * thrown off the roof burning, the legs buckle and the tower folds over and
 * comes down across the lot, throwing concrete and sparks, and burns where
 * it lies.
 */

const LEG_TOP = 12;
const CABIN_Y = 12.3;
const CABIN_H = 2.6;
/** The gun's pivot above the footing. */
const GUN_Y = CABIN_Y + CABIN_H + 0.75;
const RANGE = 72;
const BURST = 11;
const BURST_GAP = 0.06;

export type TowerEvent = 'servo' | 'lock' | 'shot' | 'boom' | 'crash' | 'creak';

export interface TurretTarget {
  /** Where to put the rounds (a chest). */
  pos: THREE.Vector3;
  /** Is it Ravi (the scene decides what a hit on him means). */
  ravi: boolean;
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}

/** A strut of square section from `a` to `b`. */
function strut(a: THREE.Vector3, b: THREE.Vector3, w: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, len, w);
  g.applyMatrix4(_m.compose(_a.copy(a).add(b).multiplyScalar(0.5), _q.setFromUnitVectors(V(0, 1, 0), _b.copy(b).sub(a).normalize()), V(1, 1, 1)));
  return g;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false) ?? list[0];
  for (const x of list) if (x !== g) x.dispose();
  return g;
}

/** Materials shared by all four. */
let MATS: {
  concrete: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  armour: THREE.MeshStandardMaterial;
  slit: THREE.MeshStandardMaterial;
  gun: THREE.MeshStandardMaterial;
  lens: THREE.MeshStandardMaterial;
  beacon: THREE.MeshStandardMaterial;
  beam: THREE.ShaderMaterial;
  wreck: THREE.MeshStandardMaterial;
} | null = null;

function mats(): NonNullable<typeof MATS> {
  if (MATS) return MATS;
  MATS = {
    concrete: new THREE.MeshStandardMaterial({ color: 0x77766f, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.45, metalness: 0.75 }),
    armour: new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.5, metalness: 0.6 }),
    slit: new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xff3a22, emissiveIntensity: 0.6 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.4, metalness: 0.8 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xeaf2ff, emissiveIntensity: 4 }),
    beacon: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 3 }),
    beam: new THREE.ShaderMaterial({
      uniforms: { uK: { value: 1 } },
      vertexShader: `varying float vZ; varying vec3 vN; varying vec3 vV; void main(){ vZ = -position.z / 70.0; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uK; varying float vZ; varying vec3 vN; varying vec3 vV; void main(){ float rim = pow(1.0 - abs(dot(vN, vV)), 0.6); float a = 0.11 * (1.0 - vZ) * (1.0 - vZ) * (0.4 + 0.6 * (1.0 - rim)) * uK; gl_FragColor = vec4(0.85, 0.9, 1.0, a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    }),
    wreck: new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.8, metalness: 0.3 })
  };
  return MATS;
}

export class OutpostTower {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  alive = true;
  /** Everything Ravi can't walk through (the footing and the legs' feet). */
  readonly colliders: Collider[] = [];
  /** What bullets hit (metal and concrete; they do nothing to it). */
  readonly shootables: THREE.Object3D[] = [];
  /** The whole thing's bounds, for rockets. */
  readonly bounds: THREE.Box3;
  /** Its floodlight: lights the tower and the ground round it; becomes the fire's glow when it's down. */
  readonly light: THREE.PointLight;
  /** Somebody to shoot at, asked for whenever it's free. */
  target: TurretTarget | null = null;
  onEvent: ((e: TowerEvent, at: THREE.Vector3) => void) | null = null;
  /** A round leaving the gun: from, toward. */
  onShot: ((from: THREE.Vector3, to: THREE.Vector3, t: TurretTarget) => void) | null = null;

  /** Everything above the footing, which folds over when it goes. */
  private upper = new THREE.Group();
  private cabin = new THREE.Group();
  private yawPivot = new THREE.Group();
  private pitchPivot = new THREE.Group();
  private beam: THREE.Mesh;
  private beamMat: THREE.ShaderMaterial;
  private muzzles: THREE.Object3D[] = [];
  private barrels: THREE.Object3D[] = [];
  private beacon: THREE.Mesh;
  private t = Math.random() * 10;
  private yaw = 0;
  private pitch = -0.2;
  private sweep = Math.random() * 6;
  private lockT = 0;
  private burstLeft = 0;
  private burstT = 0;
  private coolT = 1 + Math.random() * 2;
  private servoT = 0;
  private recoil = 0;
  /** Coming down: how far into it, which way it falls. */
  private fall: { t: number; dir: THREE.Vector3; axis: THREE.Vector3; landed: boolean; booms: number[] } | null = null;
  private fires: THREE.Vector3[] = [];
  private ball: THREE.Mesh;
  private ballT = -1;
  private fireT = 0;
  private sparkT = 0;

  constructor(at: THREE.Vector3, yaw: number) {
    const M = mats();
    this.pos = at.clone();
    this.group.position.copy(at);
    // ---- Footing
    const foot = new THREE.Mesh(merge([boxAt(4.6, 1.2, 4.6, 0, 0, 0), boxAt(3.8, 0.25, 3.8, 0, 1.2, 0)]), M.concrete);
    foot.castShadow = foot.receiveShadow = true;
    foot.userData.surface = 'concrete';
    this.group.add(foot);
    this.shootables.push(foot);
    this.colliders.push({ box: new THREE.Box3(V(at.x - 2.3, 0, at.z - 2.3), V(at.x + 2.3, 1.45, at.z + 2.3)) });
    // ---- Legs, braced, up to the platform
    this.group.add(this.upper);
    const legs: THREE.BufferGeometry[] = [];
    const lo = 1.75;
    const hi = 1.3;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push(strut(V(sx * lo, 1.45, sz * lo), V(sx * hi, LEG_TOP, sz * hi), 0.32));
    for (const [y0, y1] of [[1.6, 5.2], [5.2, 8.7], [8.7, LEG_TOP]]) {
      const w0 = lo + (hi - lo) * ((y0 - 1.45) / (LEG_TOP - 1.45));
      const w1 = lo + (hi - lo) * ((y1 - 1.45) / (LEG_TOP - 1.45));
      for (const s of [-1, 1]) {
        legs.push(strut(V(-w0, y0, s * w0), V(w1, y1, s * w1), 0.1), strut(V(w0, y0, s * w0), V(-w1, y1, s * w1), 0.1));
        legs.push(strut(V(s * w0, y0, -w0), V(s * w1, y1, w1), 0.1), strut(V(s * w0, y0, w0), V(s * w1, y1, -w1), 0.1));
      }
      legs.push(strut(V(-w1, y1, -w1), V(w1, y1, -w1), 0.14), strut(V(-w1, y1, w1), V(w1, y1, w1), 0.14));
      legs.push(strut(V(-w1, y1, -w1), V(-w1, y1, w1), 0.14), strut(V(w1, y1, -w1), V(w1, y1, w1), 0.14));
    }
    // A ladder up one side
    for (const s of [-0.25, 0.25]) legs.push(strut(V(s, 1.45, lo + 0.25), V(s, LEG_TOP, hi + 0.25), 0.05));
    for (let y = 1.8; y < LEG_TOP; y += 0.4) {
      const z = lo + 0.25 + (hi - lo) * ((y - 1.45) / (LEG_TOP - 1.45));
      legs.push(strut(V(-0.25, y, z), V(0.25, y, z), 0.035));
    }
    // The platform and its rail
    legs.push(boxAt(4.4, 0.3, 4.4, 0, LEG_TOP, 0));
    for (const s of [-1, 1]) {
      legs.push(boxAt(4.4, 0.06, 0.06, 0, LEG_TOP + 1.05, s * 2.17), boxAt(0.06, 0.06, 4.4, s * 2.17, LEG_TOP + 1.05, 0));
      for (const k of [-1, 0, 1]) legs.push(boxAt(0.06, 1.05, 0.06, k * 2.1, LEG_TOP + 0.3, s * 2.17), boxAt(0.06, 1.05, 0.06, s * 2.17, LEG_TOP + 0.3, k * 2.1));
    }
    const frame = new THREE.Mesh(merge(legs), M.steel);
    frame.castShadow = true;
    frame.userData.surface = 'metal';
    this.upper.add(frame);
    this.shootables.push(frame);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.colliders.push({ box: new THREE.Box3(V(at.x + sx * lo - 0.25, 1.45, at.z + sz * lo - 0.25), V(at.x + sx * lo + 0.25, 4, at.z + sz * lo + 0.25)) });
    // ---- The cabin: armoured, red slits for windows, a beacon on the roof
    this.cabin.position.y = CABIN_Y;
    this.cabin.rotation.y = yaw;
    this.upper.add(this.cabin);
    const shell = new THREE.Mesh(merge([boxAt(3.3, CABIN_H, 3.3, 0, 0, 0), boxAt(3.6, 0.2, 3.6, 0, CABIN_H, 0), boxAt(1.4, 0.35, 1.4, 0, CABIN_H + 0.2, 0)]), M.armour);
    shell.castShadow = true;
    shell.userData.surface = 'metal';
    this.cabin.add(shell);
    this.shootables.push(shell);
    const slits: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const g = new THREE.BoxGeometry(2.2, 0.16, 0.02);
      g.translate(0, CABIN_H * 0.68, 1.66);
      g.rotateY((k * Math.PI) / 2);
      slits.push(g);
    }
    this.cabin.add(new THREE.Mesh(merge(slits), M.slit));
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.26, 10), M.beacon);
    this.beacon.position.set(1.3, CABIN_H + 0.33, 1.3);
    this.cabin.add(this.beacon);
    const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.4, 4), M.steel);
    aerial.position.set(-1.35, CABIN_H + 1.4, -1.35);
    this.cabin.add(aerial);
    // ---- The turret: slewing base, the gun housing and its two barrels, the searchlight
    this.yawPivot.position.y = GUN_Y;
    this.upper.add(this.yawPivot);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.4, 14), M.gun);
    base.position.y = -0.38;
    base.castShadow = true;
    this.yawPivot.add(base);
    this.yawPivot.add(this.pitchPivot);
    const housing = new THREE.Mesh(merge([boxAt(0.95, 0.62, 1.35, 0, -0.31, 0.05), boxAt(0.5, 0.18, 0.4, 0, 0.3, 0.2), boxAt(0.3, 0.3, 0.5, 0.62, -0.25, 0.2)]), M.gun);
    housing.castShadow = true;
    housing.userData.surface = 'metal';
    this.pitchPivot.add(housing);
    this.shootables.push(housing);
    for (const x of [-0.2, 0.2]) {
      const barrel = new THREE.Group();
      barrel.position.set(x, -0.05, -0.6);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 1.7, 8), M.gun);
      tube.rotation.x = Math.PI / 2;
      tube.position.z = -0.85;
      const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 8), M.gun);
      shroud.rotation.x = Math.PI / 2;
      shroud.position.z = -0.3;
      barrel.add(tube, shroud);
      const muzzle = new THREE.Object3D();
      muzzle.position.z = -1.75;
      barrel.add(muzzle);
      this.pitchPivot.add(barrel);
      this.barrels.push(barrel);
      this.muzzles.push(muzzle);
    }
    const lamp = new THREE.Group();
    lamp.position.set(-0.78, -0.1, -0.1);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.5, 12), M.gun);
    can.rotation.x = Math.PI / 2;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.24, 14), M.lens);
    lens.position.z = -0.26;
    lens.rotation.y = Math.PI;
    lamp.add(can, lens);
    this.pitchPivot.add(lamp);
    // The beam: a long cone of light out of the lamp, down the gun's line —
    // narrow at the lens, opening out as it goes (the cylinder's top is the
    // far end once it's turned down −Z)
    const cone = new THREE.CylinderGeometry(4.2, 0.22, 70, 18, 1, true);
    cone.rotateX(-Math.PI / 2);
    cone.translate(0, 0, -35);
    this.beamMat = M.beam.clone();
    this.beam = new THREE.Mesh(cone, this.beamMat);
    this.beam.position.set(-0.78, -0.1, -0.35);
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 6;
    this.pitchPivot.add(this.beam);
    // The light under the cabin, washing down the legs onto the ground
    this.light = new THREE.PointLight(0xc9d8ff, 30, 30, 1.7);
    this.light.position.set(0, CABIN_Y - 0.6, 0);
    this.upper.add(this.light);

    // The fireball when it goes: an expanding shell, built now (hidden) so its shader's compiled up front
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 22, 14),
      new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uFade: { value: 0 }, uHeat: { value: 1 } },
        vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uT;
          float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          void main(){ vP = position; vec3 p = position * (1.0 + 0.1 * sin(position.x * 3.1 + uT * 9.0) * sin(position.y * 2.7 - uT * 7.0)); vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uT; uniform float uFade; uniform float uHeat; varying vec3 vN; varying vec3 vV; varying vec3 vP;
          float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float noise(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
          void main(){
            float n = noise(vP * 2.6 + vec3(0.0, -uT * 3.0, 0.0)) * 0.6 + noise(vP * 6.0 - uT * 4.0) * 0.4;
            float core = pow(max(dot(vN, vV), 0.0), 1.6);
            float a = smoothstep(0.0, 0.55, core) * (0.55 + 0.45 * n) * uFade;
            vec3 hot = mix(vec3(1.0, 0.95, 0.75), vec3(1.0, 0.55, 0.12), 1.0 - core * uHeat);
            vec3 col = mix(vec3(0.55, 0.12, 0.02), hot, smoothstep(0.3, 0.9, n * core + 0.25 * uHeat));
            gl_FragColor = vec4(col * (1.6 + 1.2 * n), a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    this.ball.visible = false;
    this.ball.position.set(0, CABIN_Y + 1.5, 0);
    this.group.add(this.ball);

    this.bounds = new THREE.Box3(V(at.x - 2.6, 0, at.z - 2.6), V(at.x + 2.6, GUN_Y + 0.8, at.z + 2.6));
    this.yaw = yaw;
  }

  /** Where the gun is, in the world. */
  gunWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + GUN_Y, this.pos.z);
  }

  /** In reach, and not too steep under it. */
  canReach(p: THREE.Vector3): boolean {
    const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    return d < RANGE && d > 4;
  }

  /** Is it busy with a burst (don't swap its target mid-way)? */
  get firing(): boolean {
    return this.burstLeft > 0;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.fall) {
      this.updateFall(dt);
      return;
    }
    if (!this.alive) return;
    // The beacon blinks; the slits glow
    (this.beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(this.t * 6) > 0.2 ? 4 : 0.2;
    const tg = this.target;
    let wantYaw: number;
    let wantPitch: number;
    if (tg) {
      const g = this.gunWorld(_a);
      const dx = tg.pos.x - g.x;
      const dz = tg.pos.z - g.z;
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(tg.pos.y - g.y, Math.hypot(dx, dz));
    } else {
      // Sweeping the lot
      this.sweep += dt * 0.35;
      wantYaw = this.yaw + Math.sin(this.sweep) * 0.9 * dt;
      wantPitch = -0.28 + Math.sin(this.sweep * 1.7) * 0.08;
    }
    let dy = wantYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const rate = tg ? 2.6 : 0.6;
    const step = THREE.MathUtils.clamp(dy, -rate * dt, rate * dt);
    this.yaw += step;
    this.pitch += THREE.MathUtils.clamp(wantPitch - this.pitch, -dt * 1.2, dt * 1.2);
    this.yawPivot.rotation.y = this.yaw;
    this.pitchPivot.rotation.x = this.pitch;
    // Servo whine as it slews hard onto someone
    this.servoT -= dt;
    if (tg && Math.abs(dy) > 0.25 && this.servoT <= 0) {
      this.servoT = 1.2;
      this.onEvent?.('servo', this.gunWorld(_b));
    }
    // Recoil, settling
    this.recoil = Math.max(0, this.recoil - dt * 9);
    for (let i = 0; i < 2; i++) this.barrels[i].position.z = -0.6 + this.recoil * (i === (this.burstLeft % 2) ? 0.12 : 0.04);
    // Firing: on target and held a moment (the warning), then a burst; then a rest
    if (this.burstLeft > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0 && tg) {
        this.burstT = BURST_GAP;
        this.burstLeft--;
        this.recoil = 1;
        const m = this.muzzles[this.burstLeft % 2];
        m.getWorldPosition(_a);
        this.onShot?.(_a.clone(), tg.pos.clone(), tg);
        this.onEvent?.('shot', _a);
      }
      if (!tg) this.burstLeft = 0;
      return;
    }
    this.coolT -= dt;
    if (!tg || this.coolT > 0) {
      this.lockT = 0;
      return;
    }
    if (Math.abs(dy) < 0.06) {
      if (this.lockT === 0) this.onEvent?.('lock', this.gunWorld(_b));
      this.lockT += dt;
      if (this.lockT > 0.4) {
        this.burstLeft = BURST + Math.floor(Math.random() * 4);
        this.burstT = 0;
        this.lockT = 0;
        this.coolT = 0.6 + Math.random() * 0.7;
      }
    }
  }

  /**
   * A rocket's hit it. The turret goes dead on the spot, the cabin blows,
   * the gun is thrown off the roof burning, and the tower starts to come
   * down — away from the hit.
   */
  destroy(hit: THREE.Vector3, debris: Debris, particles: ParticleManager, scene: THREE.Scene): void {
    if (!this.alive) return;
    this.alive = false;
    this.target = null;
    this.burstLeft = 0;
    this.beamMat.uniforms.uK.value = 0;
    this.beam.visible = false;
    const M = mats();
    (this.beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    // Falls away from where it was hit (and never toward the drive's middle if it can help it)
    const away = _a.set(this.pos.x - hit.x, 0, this.pos.z - hit.z);
    if (away.lengthSq() < 0.5) away.set(Math.sign(this.pos.x) || 1, 0, -0.3);
    away.normalize();
    if (Math.sign(away.x) !== Math.sign(this.pos.x)) away.x += Math.sign(this.pos.x) * 0.8;
    away.normalize();
    const axis = V(0, 1, 0).cross(away).normalize();
    // The pivot: the foot of the legs on the side it falls to
    const pivot = away.clone().multiplyScalar(1.6).setY(1.45);
    this.upper.position.copy(pivot);
    for (const c of this.upper.children) c.position.sub(pivot);
    this.fall = { t: 0, dir: away.clone(), axis, landed: false, booms: [0.18, 0.55, 1.05, 1.6] };
    // The gun off the roof, spinning, burning
    const gun = this.yawPivot;
    gun.getWorldPosition(_b);
    gun.getWorldQuaternion(_q);
    gun.removeFromParent();
    scene.add(gun);
    gun.position.copy(_b);
    gun.quaternion.copy(_q);
    debris.add({ obj: gun, vel: V(away.x * 6 + (Math.random() - 0.5) * 3, 9 + Math.random() * 3, away.z * 6 + (Math.random() - 0.5) * 3), spin: V((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8), size: 1.4, fire: 9, smoke: 14 });
    // Armour plates and concrete off the footing, flying
    const plate = new THREE.BoxGeometry(1.2, 0.9, 0.08);
    const chunk = new THREE.DodecahedronGeometry(0.35, 0);
    const top = _b.set(this.pos.x, this.pos.y + CABIN_Y + 1.2, this.pos.z);
    for (let k = 0; k < 7; k++) {
      const m = new THREE.Mesh(plate, k % 2 ? M.armour : M.wreck);
      m.position.copy(top).add(V((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2));
      m.castShadow = true;
      scene.add(m);
      const a = Math.random() * Math.PI * 2;
      const sp = 5 + Math.random() * 7;
      debris.add({ obj: m, vel: V(Math.cos(a) * sp, 4 + Math.random() * 7, Math.sin(a) * sp), spin: V((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14), size: 0.6, fire: k < 2 ? 4 : 0, smoke: k < 4 ? 5 : 0 });
    }
    for (let k = 0; k < 9; k++) {
      const m = new THREE.Mesh(chunk, M.concrete);
      const s = 0.6 + Math.random() * 0.9;
      m.scale.setScalar(s);
      m.position.set(this.pos.x + (Math.random() - 0.5) * 3, 1 + Math.random(), this.pos.z + (Math.random() - 0.5) * 3);
      m.castShadow = true;
      scene.add(m);
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 6;
      debris.add({ obj: m, vel: V(Math.cos(a) * sp, 3 + Math.random() * 5, Math.sin(a) * sp), spin: V((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10), size: 0.5 * s });
    }
    // A huge one: the rocket's hit, the cabin going up round it in a ring of
    // secondary blasts, a fireball rolling up off the top, sparks everywhere
    particles.explosion(_b.copy(hit), 8);
    const cab = _a.set(this.pos.x, this.pos.y + CABIN_Y + 1.3, this.pos.z).clone();
    particles.explosion(cab, 11);
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2 + Math.random() * 0.6;
      particles.explosion(cab.clone().add(V(Math.cos(ang) * 3.2, (Math.random() - 0.3) * 2.5, Math.sin(ang) * 3.2)), 5 + Math.random() * 3);
    }
    particles.explosion(cab.clone().add(V(0, 5, 0)), 7);
    particles.sparks(cab, V(0, 1, 0), 140);
    particles.fire(cab, 4, 3);
    _b.copy(cab);
    this.light.color.set(0xff8a3a);
    this.light.intensity = 2600;
    this.light.distance = 70;
    this.ballT = 0;
    this.ball.visible = true;
    this.onEvent?.('boom', _b.clone());
  }

  /** Coming down: it sags, then goes over faster and faster, and hits; then it burns. */
  private updateFall(dt: number): void {
    const f = this.fall!;
    f.t += dt;
    // The fireball: out to twenty-odd metres across in half a second, burning down to red as it goes
    if (this.ballT >= 0) {
      this.ballT += dt;
      const u = this.ballT;
      const k = 1 - Math.pow(1 - Math.min(1, u / 0.55), 3);
      this.ball.scale.setScalar(2 + 8.5 * k);
      this.ball.position.y = CABIN_Y + 1.5 + 3 * u;
      const m = this.ball.material as THREE.ShaderMaterial;
      m.uniforms.uT.value = u;
      m.uniforms.uFade.value = Math.min(1, u / 0.06) * Math.max(0, 1 - u / 1.1);
      m.uniforms.uHeat.value = Math.max(0, 1 - u / 0.7);
      if (u > 1.1) {
        this.ball.visible = false;
        this.ballT = -1;
      }
    }
    const t = f.t;
    // The flash dying to the fire's glow
    this.light.intensity = THREE.MathUtils.lerp(this.light.intensity, 34 + 16 * Math.sin(t * 13) * Math.sin(t * 7.3), Math.min(1, dt * 4));
    const P = this.particlesRef;
    this.upper.updateMatrixWorld(true);
    if (!f.landed) {
      // The legs buckle a little first, then it's going: angle ~ accelerating, to 84°
      const sag = Math.min(1, t / 0.45);
      const go = Math.max(0, t - 0.35);
      const ang = Math.min(1.47, 0.12 * sag + 0.55 * go * go * 1.6);
      this.upper.quaternion.setFromAxisAngle(f.axis, ang);
      this.upper.position.y = 1.45 - 0.9 * sag;
      if (P) {
        this.sparkT -= dt;
        if (this.sparkT <= 0) {
          this.sparkT = 0.08;
          this.upper.localToWorld(_a.set(0, 2, 0));
          P.sparks(_a, V(f.dir.x, 0.6, f.dir.z), 8);
          this.upper.localToWorld(_a.set(0, CABIN_Y + 1, 0));
          P.fire(_a, 1.5, 1);
        }
        while (f.booms.length && t >= f.booms[0]) {
          f.booms.shift();
          this.upper.localToWorld(_a.set((Math.random() - 0.5) * 2, LEG_TOP - Math.random() * 4, (Math.random() - 0.5) * 2));
          P.explosion(_a, 2.2 + Math.random() * 1.5);
          this.light.intensity = 400;
          this.onEvent?.('boom', _a.clone());
        }
      }
      if (t > 0.5 && Math.abs(t - 0.5) < dt) this.onEvent?.('creak', this.pos);
      if (ang >= 1.47) {
        f.landed = true;
        this.onEvent?.('crash', this.pos.clone().addScaledVector(f.dir, 8));
        this.upper.updateMatrixWorld(true);
        if (P) {
          for (let k = 2; k <= 14; k += 4) {
            this.upper.localToWorld(_a.set(0, k, 0));
            _a.y = 0.2;
            P.dust(_a, 3.5, 1.4);
            P.sparks(_a, V(0, 1, 0), 18);
          }
          this.upper.localToWorld(_a.set(0, CABIN_Y + 1, 0));
          _a.y = 1;
          P.explosion(_a, 3.5);
        }
        // Where it burns now: the cabin end, the middle of the legs
        this.upper.localToWorld(_a.set(0, CABIN_Y + 1, 0));
        this.fires.push(V(_a.x, 1.2, _a.z));
        this.upper.localToWorld(_a.set(0, 7, 0));
        this.fires.push(V(_a.x, 0.6, _a.z));
        this.fires.push(V(this.pos.x, 1.5, this.pos.z));
      }
    } else if (P) {
      // Burning where it lies
      this.fireT -= dt;
      const near = this.camDist < 110;
      if (near) for (const p of this.fires) P.fire(p, 1.9, 1);
      if (this.camDist < 220) P.smokeColumn(_a.copy(this.fires[0]).setY(2), 1.5, 1);
      if (this.fireT <= 0) {
        this.fireT = 2 + Math.random() * 3;
        if (near && Math.random() < 0.5) P.sparks(this.fires[0], V(0, 1, 0), 10);
      }
    }
  }

  /** The scene's particles, for the fall; and how far the camera is (fires go quiet far off). */
  particlesRef: ParticleManager | null = null;
  camDist = 0;
  /** The scene's bookkeeping: when it next picks a target, whether this burst has hit Ravi yet. */
  userData: { next: number; hitThisBurst: boolean; willHit: boolean; shot: number } = { next: Math.random() * 2, hitThisBurst: false, willHit: false, shot: 0 };

  /** Already down (a restart past the towers): lying where it fell, burning, the gun thrown clear. */
  wreckInstant(debris: Debris, scene: THREE.Scene): void {
    if (!this.alive) return;
    // All of it at once and quietly: no bangs, no flashes, no particles
    const P = this.particlesRef;
    const ev = this.onEvent;
    this.particlesRef = null;
    this.onEvent = null;
    const quiet = { explosion() {}, sparks() {}, fire() {}, dust() {} } as unknown as ParticleManager;
    this.destroy(this.pos.clone().add(V(-Math.sign(this.pos.x) || 1, 4, 1.5)), debris, quiet, scene);
    for (let i = 0; i < 400 && !this.fall!.landed; i++) this.updateFall(1 / 60);
    this.particlesRef = P;
    this.onEvent = ev;
    this.light.intensity = 40;
    // The gun where it would have come down
    for (let i = 0; i < 300; i++) debris.update(1 / 60);
  }

  /** For the warm-up: the beam's light is drawn once. */
  dispose(): void {
    this.beamMat.dispose();
  }
}
