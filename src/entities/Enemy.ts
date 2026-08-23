import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const AMERICAN_NAMES = [
  'Chuck', 'Randy', 'Brad', 'Kyle', 'Dale', 'Hank', 'Wayne', 'Earl', 'Gary', 'Todd', 'Bubba', 'Cody'
];

/**
 * One way to die. The ragdoll is a single rigid body, so the character comes
 * from where the limbs settle and how the body is spun as it goes down —
 * `spin` is extra angular velocity applied on top of the bullet impulse.
 */
interface DeathStyle {
  /** [rotation.x, rotation.z] targets for each arm as it goes limp. */
  armL: [number, number];
  armR: [number, number];
  legL: number;
  legR: number;
  head: [number, number]; // [rotation.x, rotation.z]
  /** How fast the limbs give out — low is a slow slump, high is a hard drop. */
  limpRate: number;
  spin: [number, number, number];
  /** Extra upward kick, for the ones that leave their feet. */
  lift: number;
}

/** Ordinary collapses — used for body shots. */
const BODY_DEATHS: DeathStyle[] = [
  {
    // Crumple: folds forward over the wound, arms hanging
    armL: [0.9, 1.2], armR: [-0.6, -1.1], legL: 0.35, legR: -0.2,
    head: [0.35, 0.5], limpRate: 3, spin: [-1.2, 0.4, 0], lift: 0
  },
  {
    // Sprawl: thrown onto their back, limbs wide
    armL: [-1.9, 1.5], armR: [-1.8, -1.6], legL: -0.5, legR: -0.35,
    head: [-0.4, -0.2], limpRate: 2.2, spin: [2.4, -0.6, 0.3], lift: 40
  },
  {
    // Twist: spun sideways, one arm across the chest
    armL: [0.4, 2.0], armR: [-1.2, -0.3], legL: 0.6, legR: 0.15,
    head: [0.1, 1.0], limpRate: 3.6, spin: [0.3, 3.2, 1.8], lift: 15
  },
  {
    // Slump: knees buckle first, a slow sag straight down
    armL: [0.6, 0.5], armR: [0.5, -0.45], legL: 1.1, legR: 0.85,
    head: [0.6, 0.15], limpRate: 1.5, spin: [-0.4, 0.2, -0.2], lift: -20
  },
  {
    // Face plant: pitched forward, arms trailing behind
    armL: [1.8, 0.6], armR: [1.9, -0.5], legL: -0.3, legR: -0.45,
    head: [0.5, -0.3], limpRate: 4, spin: [-2.8, 0.3, 0], lift: 10
  }
];

/** Head shots — snappier, more violent. */
const HEAD_DEATHS: DeathStyle[] = [
  {
    // Snap back: head whips, body follows straight down backwards
    armL: [-1.4, 0.9], armR: [-1.5, -1.0], legL: -0.15, legR: 0.1,
    head: [-1.1, 0.3], limpRate: 6, spin: [3.4, 0.2, 0.4], lift: 55
  },
  {
    // Drop: everything lets go at once, straight to the floor
    armL: [0.2, 0.35], armR: [0.15, -0.3], legL: 0.5, legR: 0.4,
    head: [0.8, 0.9], limpRate: 8, spin: [0.2, -0.3, 0.1], lift: -40
  },
  {
    // Pirouette: spun off their feet by the impact
    armL: [-0.8, 1.7], armR: [-0.9, -1.8], legL: 0.25, legR: -0.6,
    head: [0.2, -1.2], limpRate: 5, spin: [0.6, 4.5, 2.2], lift: 30
  }
];

/**
 * Enemy — an armed intruder. Primitive-built humanoid with walk/aim
 * animation hooks; on a fatal hit it becomes a cannon-es ragdoll body that
 * takes the bullet impulse and tumbles, limbs going limp.
 */
export class Enemy {
  readonly root = new THREE.Group();
  readonly name: string;
  alive = true;
  settled = false;

  /** Feet position in world space (alias of root.position while alive). */
  get position(): THREE.Vector3 {
    return this.root.position;
  }
  yaw = 0;

  readonly eyeHeight = 1.58;
  readonly parts: THREE.Mesh[] = [];

  private legL!: THREE.Mesh;
  private legR!: THREE.Mesh;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private head!: THREE.Mesh;
  private torso!: THREE.Mesh;
  private rifle!: THREE.Group;
  private muzzle = new THREE.Object3D();

  private walkPhase = 0;
  private walkSpeed = 0; // 0 idle .. 1 full stride
  private aimBlend = 0; // 0 relaxed .. 1 weapon raised
  private body: CANNON.Body | null = null;
  private world: CANNON.World | null = null;
  private limpBlend = 0;
  private deadTimer = 0;
  private death: DeathStyle = BODY_DEATHS[0];
  private muzzleFlashLight: THREE.PointLight;
  private flashTime = 0;

  constructor(spawn: THREE.Vector3, yaw: number, index: number) {
    this.name = AMERICAN_NAMES[index % AMERICAN_NAMES.length];
    this.root.position.copy(spawn);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.buildBody();

    this.muzzleFlashLight = new THREE.PointLight(0xffb45e, 0, 7, 1.8);
    this.muzzleFlashLight.visible = false;
    this.muzzle.add(this.muzzleFlashLight);
  }

  private mat(color: number, rough = 0.85): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: rough });
  }

  private addPart(mesh: THREE.Mesh, name: string): THREE.Mesh {
    mesh.userData.enemy = this;
    mesh.userData.part = name;
    mesh.userData.surface = 'flesh';
    this.parts.push(mesh);
    return mesh;
  }

  private buildBody(): void {
    const camo = this.mat(0x4a4738);
    const denim = this.mat(0x39414e);
    const skin = this.mat(0xc59a76);
    const vest = this.mat(0x23261f);
    const gunmetal = this.mat(0x1a1c20, 0.5);

    // Legs
    // (No clone(): Object3D.copy JSON-serializes userData, which holds a back-ref to this enemy.)
    const legGeo = new THREE.BoxGeometry(0.17, 0.82, 0.19);
    this.legL = this.addPart(new THREE.Mesh(legGeo, denim), 'leg');
    this.legL.position.set(-0.115, 0.41, 0);
    this.legR = this.addPart(new THREE.Mesh(legGeo, denim), 'leg');
    this.legR.position.set(0.115, 0.41, 0);
    this.root.add(this.legL, this.legR);

    // Torso + tactical vest
    this.torso = this.addPart(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), camo), 'torso');
    this.torso.position.set(0, 1.13, 0);
    this.root.add(this.torso);
    const vestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.3), vest);
    vestMesh.position.set(0, 0.02, 0);
    this.torso.add(vestMesh);

    // Head + cap
    this.head = this.addPart(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), skin), 'head');
    this.head.position.set(0, 1.62, 0);
    this.root.add(this.head);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.26), this.mat(0x7a1f1f));
    cap.position.set(0, 0.16, 0.02);
    this.head.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.12), this.mat(0x7a1f1f));
    brim.position.set(0, 0.11, -0.16);
    this.head.add(brim);

    // Arms (pivot at shoulders so they can swing / raise)
    const mkArm = (side: number): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(side * 0.29, 1.4, 0);
      const arm = this.addPart(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.58, 0.14), camo), 'arm');
      arm.position.set(0, -0.26, 0);
      g.add(arm);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.1), skin);
      hand.position.set(0, -0.58, 0);
      g.add(hand);
      this.root.add(g);
      return g;
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);

    // Rifle held by the right arm
    this.rifle = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.62), gunmetal);
    this.rifle.add(receiver);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), gunmetal);
    mag.position.set(0, -0.11, 0.05);
    mag.rotation.x = 0.3;
    this.rifle.add(mag);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.16), this.mat(0x4d3a26));
    stock.position.set(0, -0.01, 0.34);
    this.rifle.add(stock);
    this.muzzle.position.set(0, 0.01, -0.36);
    this.rifle.add(this.muzzle);
    this.rifle.position.set(-0.12, -0.5, -0.12);
    this.armR.add(this.rifle);
  }

  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  eyePosition(out = new THREE.Vector3()): THREE.Vector3 {
    if (!this.alive) return this.head.getWorldPosition(out);
    return out.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  forwardDir(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** AI hooks. */
  setWalk(speed01: number): void {
    this.walkSpeed = speed01;
  }
  setAiming(aiming: boolean): void {
    this.aimTarget = aiming ? 1 : 0;
  }
  private aimTarget = 0;

  faceToward(target: THREE.Vector3, dt: number, turnRate = 7): void {
    const desired = Math.atan2(-(target.x - this.position.x), -(target.z - this.position.z));
    let diff = desired - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * turnRate);
    this.root.rotation.y = this.yaw;
  }

  flashMuzzle(): void {
    this.flashTime = 0.05;
    this.muzzleFlashLight.visible = true;
    this.muzzleFlashLight.intensity = 10;
  }

  // ------------------------------------------------------------------ death

  /**
   * Fatal hit: convert to a single-body ragdoll, apply the bullet impulse at
   * the hit point (so headshots snap back, gut shots fold) and let cannon
   * tumble it to the floor. A death style is drawn from the pool matching
   * where they were hit, so no two go down the same way.
   */
  die(hitPoint: THREE.Vector3, bulletDir: THREE.Vector3, world: CANNON.World): void {
    if (!this.alive) return;
    this.alive = false;
    this.world = world;
    this.deadTimer = 0;

    // Torso centre is y 0.95, the head sits around 1.62 — anything landing
    // well above the chest counts as a head shot for animation purposes.
    const highHit = hitPoint.y - this.root.position.y > 1.45;
    const pool = highHit ? HEAD_DEATHS : BODY_DEATHS;
    this.death = pool[Math.floor(Math.random() * pool.length)];

    // Re-root the group at the torso center so it can track the physics body.
    const center = new THREE.Vector3(0, 0.95, 0);
    for (const child of [...this.root.children]) {
      child.position.sub(center);
    }
    const worldCenter = center.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.root.position);
    this.root.position.copy(worldCenter);

    this.body = new CANNON.Body({
      mass: 80,
      shape: new CANNON.Box(new CANNON.Vec3(0.24, 0.8, 0.2)),
      position: new CANNON.Vec3(worldCenter.x, worldCenter.y, worldCenter.z),
      angularDamping: 0.35,
      linearDamping: 0.12
    });
    this.body.quaternion.setFromEuler(0, this.yaw, 0);

    // Impulse at the hit point: knocks the body along the bullet vector.
    const impulseMag = 260 + Math.random() * 120;
    const impulse = new CANNON.Vec3(
      bulletDir.x * impulseMag,
      bulletDir.y * impulseMag * 0.4 + 60 + this.death.lift,
      bulletDir.z * impulseMag
    );
    const rel = new CANNON.Vec3(hitPoint.x - worldCenter.x, hitPoint.y - worldCenter.y, hitPoint.z - worldCenter.z);
    this.body.applyImpulse(impulse, rel);

    // Style-specific tumble, rotated into the direction they were facing so
    // "pitches forward" means forward for this enemy, not world -Z.
    const spin = new THREE.Vector3(...this.death.spin).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const j = (): number => (Math.random() - 0.5) * 0.8; // no two are identical
    this.body.angularVelocity.set(spin.x + j(), spin.y + j(), spin.z + j());

    world.addBody(this.body);
  }

  update(dt: number): void {
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.muzzleFlashLight.intensity *= 0.7;
      if (this.flashTime <= 0) this.muzzleFlashLight.visible = false;
    }

    if (!this.alive) {
      this.updateDead(dt);
      return;
    }

    // Walk cycle
    if (this.walkSpeed > 0.05) {
      this.walkPhase += dt * 7.5 * (0.5 + this.walkSpeed);
    }
    const swing = Math.sin(this.walkPhase) * 0.55 * this.walkSpeed;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;

    // Aim blend: arms swing while patrolling, raise the rifle when aiming
    this.aimBlend += (this.aimTarget - this.aimBlend) * Math.min(1, dt * 8);
    const armSwing = -swing * 0.7;
    const raise = -1.25 * this.aimBlend;
    this.armR.rotation.x = raise + armSwing * (1 - this.aimBlend);
    this.armL.rotation.x = raise * 0.9 - armSwing * (1 - this.aimBlend);
    this.armL.rotation.z = 0.35 * this.aimBlend;

    // Subtle idle breathing
    this.torso.position.y = 1.13 + Math.sin(this.walkPhase * 0.3) * 0.008;
  }

  private updateDead(dt: number): void {
    if (!this.body || this.settled) return;
    this.deadTimer += dt;

    // Track the physics body
    this.root.position.set(this.body.position.x, this.body.position.y, this.body.position.z);
    this.root.quaternion.set(
      this.body.quaternion.x,
      this.body.quaternion.y,
      this.body.quaternion.z,
      this.body.quaternion.w
    );

    // Limbs go limp towards this death's pose
    const d = this.death;
    this.limpBlend = Math.min(1, this.limpBlend + dt * d.limpRate);
    const l = this.limpBlend;
    this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, d.armL[0], l * 0.4);
    this.armL.rotation.z = THREE.MathUtils.lerp(this.armL.rotation.z, d.armL[1], l * 0.4);
    this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, d.armR[0], l * 0.4);
    this.armR.rotation.z = THREE.MathUtils.lerp(this.armR.rotation.z, d.armR[1], l * 0.4);
    this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, d.legL, l * 0.3);
    this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, d.legR, l * 0.3);
    this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, d.head[0], l * 0.3);
    this.head.rotation.z = THREE.MathUtils.lerp(this.head.rotation.z, d.head[1], l * 0.3);

    // Settle after tumbling
    const speed = this.body.velocity.length() + this.body.angularVelocity.length();
    if (this.deadTimer > 1.2 && speed < 0.35) {
      this.settle();
    } else if (this.deadTimer > 6) {
      this.settle();
    }
  }

  /** Corpse bottom in world space (for the blood pool decal). */
  corpseBase(): THREE.Vector3 {
    const p = this.root.position.clone();
    p.y -= 0.35;
    return p;
  }

  private settle(): void {
    this.settled = true;
    if (this.body && this.world) {
      this.world.removeBody(this.body);
      this.body = null;
    }
  }
}
