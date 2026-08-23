import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const AMERICAN_NAMES = [
  'Chuck', 'Randy', 'Brad', 'Kyle', 'Dale', 'Hank', 'Wayne', 'Earl', 'Gary', 'Todd', 'Bubba', 'Cody'
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
  private world: CANNON.World | null = null;
  private deadTimer = 0;
  /** Jointed ragdoll pieces once dead. */
  private ragdoll: { body: CANNON.Body; container: THREE.Group }[] = [];
  private ragdollByName = new Map<string, CANNON.Body>();
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
   * Fatal hit: the figure becomes a jointed ragdoll — torso, head, two arms
   * and two legs as separate cannon bodies linked by ball joints — the
   * bullet impulse lands on whichever part was hit, and the whole thing
   * folds, flops and slides to rest on its own.
   */
  die(hitPoint: THREE.Vector3, bulletDir: THREE.Vector3, world: CANNON.World): void {
    if (!this.alive) return;
    this.alive = false;
    this.world = world;
    this.deadTimer = 0;
    this.root.updateMatrixWorld(true);
    const parent = this.root.parent ?? this.root;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    // Each limb: visual node, its local centre (root space), body half-extents, mass.
    type Limb = { visual: THREE.Object3D; center: THREE.Vector3; half: THREE.Vector3; mass: number; sphere?: number };
    const limbs: Record<string, Limb> = {
      torso: { visual: this.torso, center: new THREE.Vector3(0, 1.13, 0), half: new THREE.Vector3(0.23, 0.31, 0.13), mass: 30 },
      head: { visual: this.head, center: new THREE.Vector3(0, 1.62, 0), half: new THREE.Vector3(0.12, 0.13, 0.12), mass: 5, sphere: 0.13 },
      armL: { visual: this.armL, center: new THREE.Vector3(-0.29, 1.12, 0), half: new THREE.Vector3(0.06, 0.29, 0.07), mass: 4 },
      armR: { visual: this.armR, center: new THREE.Vector3(0.29, 1.12, 0), half: new THREE.Vector3(0.06, 0.29, 0.07), mass: 5 },
      legL: { visual: this.legL, center: new THREE.Vector3(-0.115, 0.41, 0), half: new THREE.Vector3(0.085, 0.41, 0.095), mass: 10 },
      legR: { visual: this.legR, center: new THREE.Vector3(0.115, 0.41, 0), half: new THREE.Vector3(0.085, 0.41, 0.095), mass: 10 }
    };

    for (const [name, limb] of Object.entries(limbs)) {
      const worldCenter = this.root.localToWorld(limb.center.clone());
      const body = new CANNON.Body({
        mass: limb.mass,
        shape: limb.sphere
          ? new CANNON.Sphere(limb.sphere)
          : new CANNON.Box(new CANNON.Vec3(limb.half.x, limb.half.y, limb.half.z)),
        position: new CANNON.Vec3(worldCenter.x, worldCenter.y, worldCenter.z),
        linearDamping: 0.25,
        angularDamping: 0.5
      });
      body.quaternion.set(yawQ.x, yawQ.y, yawQ.z, yawQ.w);
      world.addBody(body);

      // Re-home the visual under a container that will track this body.
      const container = new THREE.Group();
      container.position.copy(worldCenter);
      container.quaternion.copy(yawQ);
      parent.add(container);
      this.root.remove(limb.visual);
      limb.visual.position.set(0, 0, 0);
      limb.visual.rotation.set(0, 0, 0);
      if (name === 'armL' || name === 'armR') limb.visual.position.y = 0.28; // shoulder pivot sits above the arm's centre
      container.add(limb.visual);
      this.ragdoll.push({ body, container });
      this.ragdollByName.set(name, body);
    }

    // Ball joints: neck, shoulders, hips. (Pivots in each body's local frame.)
    const joint = (a: string, b: string, pivot: THREE.Vector3) => {
      const A = this.ragdollByName.get(a)!;
      const B = this.ragdollByName.get(b)!;
      const pa = pivot.clone().sub(limbs[a].center);
      const pb = pivot.clone().sub(limbs[b].center);
      world.addConstraint(
        new CANNON.PointToPointConstraint(A, new CANNON.Vec3(pa.x, pa.y, pa.z), B, new CANNON.Vec3(pb.x, pb.y, pb.z), 1e4)
      );
    };
    joint('torso', 'head', new THREE.Vector3(0, 1.47, 0));
    joint('torso', 'armL', new THREE.Vector3(-0.29, 1.4, 0));
    joint('torso', 'armR', new THREE.Vector3(0.29, 1.4, 0));
    joint('torso', 'legL', new THREE.Vector3(-0.115, 0.82, 0));
    joint('torso', 'legR', new THREE.Vector3(0.115, 0.82, 0));

    // The bullet's punch goes into whichever part it struck, plus a smaller
    // shove to the torso so the whole body goes with it.
    let struck = this.ragdollByName.get('torso')!;
    let best = Infinity;
    for (const { body } of this.ragdoll) {
      const d = body.position.distanceTo(new CANNON.Vec3(hitPoint.x, hitPoint.y, hitPoint.z));
      if (d < best) {
        best = d;
        struck = body;
      }
    }
    const punch = (body: CANNON.Body, scale: number) => {
      const mag = (90 + Math.random() * 50) * scale * (body.mass / 30);
      const impulse = new CANNON.Vec3(bulletDir.x * mag, bulletDir.y * mag * 0.4 + 12 * scale, bulletDir.z * mag);
      const rel = new CANNON.Vec3(hitPoint.x - body.position.x, hitPoint.y - body.position.y, hitPoint.z - body.position.z);
      body.applyImpulse(impulse, rel);
    };
    punch(struck, 1);
    if (struck !== this.ragdollByName.get('torso')) punch(this.ragdollByName.get('torso')!, 0.6);
    // Knees buckle: a little random spin so no two fall alike
    for (const { body } of this.ragdoll) {
      body.angularVelocity.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
    }
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
    if (this.ragdoll.length === 0 || this.settled) return;
    this.deadTimer += dt;

    // Every limb's visual tracks its own physics body
    let speed = 0;
    for (const { body, container } of this.ragdoll) {
      container.position.set(body.position.x, body.position.y, body.position.z);
      container.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      speed += body.velocity.length() + body.angularVelocity.length() * 0.5;
    }

    // Settle once the whole body has stopped moving (or after a hard cap)
    if ((this.deadTimer > 1.5 && speed < 0.6) || this.deadTimer > 8) this.settle();
  }

  /** Corpse bottom in world space (for the blood pool decal). */
  corpseBase(): THREE.Vector3 {
    const torso = this.ragdollByName.get('torso');
    const p = torso
      ? new THREE.Vector3(torso.position.x, torso.position.y, torso.position.z)
      : this.root.position.clone();
    p.y -= 0.2;
    return p;
  }

  private settle(): void {
    this.settled = true;
    if (this.world) {
      for (const c of [...this.world.constraints]) {
        if (this.ragdoll.some((r) => r.body === c.bodyA || r.body === c.bodyB)) this.world.removeConstraint(c);
      }
      for (const { body } of this.ragdoll) this.world.removeBody(body);
    }
    this.ragdoll.length = 0;
  }
}
