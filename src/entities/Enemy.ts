import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

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

  private legL!: THREE.Group; // thigh, pivots at the hip
  private legR!: THREE.Group;
  private shinL!: THREE.Group; // shin + shoe, pivots at the knee
  private shinR!: THREE.Group;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  /** Forearm groups, pivoted at the elbows. */
  private foreL!: THREE.Group;
  private foreR!: THREE.Group;
  private static woundMat: THREE.MeshBasicMaterial | null = null;
  private head!: THREE.Mesh;
  private torso!: THREE.Mesh; // chest
  private pelvis!: THREE.Mesh;
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
  private gunBody: CANNON.Body | null = null;
  /** Picks the suit/hair/tie look. */
  private variant: number;
  private muzzleFlashLight: THREE.PointLight;
  private flashTime = 0;

  constructor(spawn: THREE.Vector3, yaw: number, index: number) {
    this.name = AMERICAN_NAMES[index % AMERICAN_NAMES.length];
    this.variant = index;
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

  /** Shared face textures: one mean, one very dead. */
  private static faceAngry: THREE.MeshStandardMaterial | null = null;
  private static faceDead: THREE.MeshStandardMaterial | null = null;

  private static drawFace(dead: boolean): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = dead ? '#b9957a' : '#c59a76';
    g.fillRect(0, 0, 64, 64);
    // Stubble
    g.fillStyle = 'rgba(60,40,30,0.25)';
    for (let i = 0; i < 90; i++) g.fillRect(10 + Math.random() * 44, 36 + Math.random() * 22, 1, 1);
    g.strokeStyle = '#2a1d15';
    g.lineCap = 'round';
    if (!dead) {
      // Heavy brows slanted inward, narrowed eyes, hard frown
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(12, 20);
      g.lineTo(27, 26);
      g.moveTo(52, 20);
      g.lineTo(37, 26);
      g.stroke();
      g.fillStyle = '#f2efe9';
      g.fillRect(15, 28, 11, 5);
      g.fillRect(38, 28, 11, 5);
      g.fillStyle = '#1a1a1a';
      g.fillRect(19, 29, 4, 4);
      g.fillRect(42, 29, 4, 4);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(22, 50);
      g.quadraticCurveTo(32, 43, 42, 50);
      g.stroke();
    } else {
      // X eyes, slack open mouth, a trickle from the nose
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(16, 26);
      g.lineTo(26, 35);
      g.moveTo(26, 26);
      g.lineTo(16, 35);
      g.moveTo(38, 26);
      g.lineTo(48, 35);
      g.moveTo(48, 26);
      g.lineTo(38, 35);
      g.stroke();
      g.fillStyle = '#3a0c0c';
      g.beginPath();
      g.ellipse(32, 50, 6, 7, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#7a1010';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(30, 40);
      g.lineTo(28, 47);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  }

  private buildBody(): void {
    const suit = this.mat(0x15161a, 0.8);
    const shirt = this.mat(0xe9e6df, 0.9);
    const skin = this.mat(0xc59a76);
    const shoe = this.mat(0x0d0d10, 0.45);
    const glove = this.mat(0x0f0f12, 0.9);
    const gunmetal = this.mat(0x1a1c20, 0.5);
    const tieColors = [0x8c1515, 0x111111, 0x1f2a6b, 0x5a1a6b, 0x8c1515, 0x2a2a2a];
    const tie = this.mat(tieColors[this.variant % tieColors.length], 0.7);
    const hairColors = [0x1b1410, 0x3a2a1c, 0x0d0d0d, 0x6b4a2b, 0x2b2b2b, 0x8a7a66];
    const hair = this.mat(hairColors[this.variant % hairColors.length], 0.95);

    // Legs: suit trousers + polished shoes
    // (No clone(): Object3D.copy JSON-serializes userData, which holds a back-ref to this enemy.)
    // Thigh pivots at the hip; shin (+ shoe) pivots at the knee
    const mkLeg = (side: number): [THREE.Group, THREE.Group] => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.115, 0.82, 0);
      const thigh = this.addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.28, 4, 12), suit), 'leg');
      thigh.position.set(0, -0.205, 0);
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.set(0, -0.41, 0);
      const shin = this.addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 12), suit), 'leg');
      shin.position.set(0, -0.205, 0);
      knee.add(shin);
      const s = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.08, 0.27, 3, 0.035), shoe);
      s.position.set(0, -0.37, -0.04);
      knee.add(s);
      hip.add(knee);
      this.root.add(hip);
      return [hip, knee];
    };
    [this.legL, this.shinL] = mkLeg(-1);
    [this.legR, this.shinR] = mkLeg(1);

    // Torso: black jacket over a white shirt, tie, lapels, buttons
    // Two-piece torso: chest (shoulders/neck hang off it) and pelvis (hips hang
    // off it), joined at the stomach so the body can fold in the middle.
    this.torso = this.addPart(new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.36, 0.26, 4, 0.09), suit), 'torso');
    this.torso.position.set(0, 1.27, 0);
    this.root.add(this.torso);
    this.pelvis = this.addPart(new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.3, 0.24, 4, 0.08), suit), 'torso');
    this.pelvis.position.set(0, 0.96, 0);
    this.root.add(this.pelvis);
    const belt = new THREE.Mesh(new RoundedBoxGeometry(0.45, 0.04, 0.25, 2, 0.015), shoe);
    belt.position.set(0, 0.13, 0);
    this.pelvis.add(belt);
    const shirtFront = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.02), shirt);
    shirtFront.position.set(0, 0.04, -0.135);
    this.torso.add(shirtFront);
    const tieMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.015), tie);
    tieMesh.position.set(0, 0.04, -0.15);
    this.torso.add(tieMesh);
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), tie);
    knot.position.set(0, 0.25, -0.15);
    this.torso.add(knot);
    for (const side of [-1, 1]) {
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.36, 0.015), suit);
      lapel.position.set(side * 0.09, 0.1, -0.142);
      lapel.rotation.z = side * 0.18;
      this.torso.add(lapel);
    }
    for (const y of [-0.08, -0.16]) {
      const btn = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.01), shoe);
      btn.position.set(0.01, y, -0.145);
      this.torso.add(btn);
    }

    // Head: face texture on the front (-Z), hair by variant
    if (!Enemy.faceAngry) Enemy.faceAngry = Enemy.drawFace(false);
    if (!Enemy.faceDead) Enemy.faceDead = Enemy.drawFace(true);
    this.head = this.addPart(
      new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.27, 0.24, 5, 0.075), [skin, skin, skin, skin, skin, Enemy.faceAngry]),
      'head'
    );
    this.head.position.set(0, 1.62, 0);
    this.root.add(this.head);
    const hairBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.4), hair);
      m.position.set(x, y, z);
      this.head.add(m);
    };
    switch (this.variant % 6) {
      case 0: // buzz cut
        hairBox(0.245, 0.05, 0.245, 0, 0.135, 0);
        break;
      case 1: // side part — swept to one side with a fringe
        hairBox(0.25, 0.08, 0.25, 0, 0.14, 0.01);
        hairBox(0.13, 0.06, 0.06, -0.055, 0.1, -0.1);
        break;
      case 2: // slicked back
        hairBox(0.25, 0.07, 0.2, 0, 0.145, 0.03);
        hairBox(0.25, 0.12, 0.05, 0, 0.09, 0.105);
        break;
      case 3: // bald (just a shine of stubble at the back)
        hairBox(0.245, 0.04, 0.03, 0, 0.06, 0.11);
        break;
      case 4: // mohawk
        hairBox(0.06, 0.11, 0.24, 0, 0.17, 0);
        break;
      default: // long, past the ears
        hairBox(0.26, 0.07, 0.26, 0, 0.14, 0);
        hairBox(0.03, 0.22, 0.24, -0.125, -0.01, 0);
        hairBox(0.03, 0.22, 0.24, 0.125, -0.01, 0);
        hairBox(0.26, 0.22, 0.03, 0, -0.01, 0.115);
        break;
    }
    // Sunglasses on a couple of them
    if (this.variant % 3 === 1) {
      const shades = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.02), this.mat(0x050505, 0.2));
      shades.position.set(0, 0.03, -0.125);
      this.head.add(shades);
    }

    // Arms: suit sleeves, white cuff, black gloves (pivot at shoulders)
    // Upper arm pivots at the shoulder; forearm (cuff + glove) pivots at the elbow
    const mkArm = (side: number): [THREE.Group, THREE.Group] => {
      const g = new THREE.Group();
      g.position.set(side * 0.29, 1.4, 0);
      const upper = this.addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.2, 4, 12), suit), 'arm');
      upper.position.set(0, -0.145, 0);
      g.add(upper);
      const fore = new THREE.Group();
      fore.position.set(0, -0.29, 0); // elbow
      const lower = this.addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 12), suit), 'arm');
      lower.position.set(0, -0.145, 0);
      fore.add(lower);
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.03, 0.145), shirt);
      cuff.position.set(0, -0.24, 0);
      fore.add(cuff);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), glove);
      hand.position.set(0, -0.31, 0);
      fore.add(hand);
      g.add(fore);
      this.root.add(g);
      return [g, fore];
    };
    [this.armL, this.foreL] = mkArm(-1);
    [this.armR, this.foreR] = mkArm(1);

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
    this.rifle.position.set(-0.12, -0.21, -0.12); // held in the right hand (forearm frame, origin at the elbow)
    this.foreR.add(this.rifle);
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
  die(hitPoint: THREE.Vector3, bulletDir: THREE.Vector3, world: CANNON.World, hitPart: string = 'torso'): void {
    if (!this.alive) return;
    this.alive = false;
    // The lights go out behind the eyes
    const mats = this.head.material as THREE.Material[];
    if (Array.isArray(mats) && Enemy.faceDead) mats[5] = Enemy.faceDead;
    this.world = world;
    this.deadTimer = 0;
    this.root.updateMatrixWorld(true);
    const parent = this.root.parent ?? this.root;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    // Each limb: visual node, its local centre (root space), body half-extents, mass.
    type Limb = { visual: THREE.Object3D; center: THREE.Vector3; half: THREE.Vector3; mass: number; sphere?: number };
    const limbs: Record<string, Limb> = {
      torso: { visual: this.torso, center: new THREE.Vector3(0, 1.27, 0), half: new THREE.Vector3(0.23, 0.18, 0.13), mass: 18 },
      pelvis: { visual: this.pelvis, center: new THREE.Vector3(0, 0.96, 0), half: new THREE.Vector3(0.22, 0.15, 0.12), mass: 14 },
      head: { visual: this.head, center: new THREE.Vector3(0, 1.62, 0), half: new THREE.Vector3(0.12, 0.13, 0.12), mass: 5, sphere: 0.13 },
      armL: { visual: this.armL, center: new THREE.Vector3(-0.29, 1.255, 0), half: new THREE.Vector3(0.06, 0.145, 0.07), mass: 2.5 },
      armR: { visual: this.armR, center: new THREE.Vector3(0.29, 1.255, 0), half: new THREE.Vector3(0.06, 0.145, 0.07), mass: 2.5 },
      foreL: { visual: this.foreL, center: new THREE.Vector3(-0.29, 0.965, 0), half: new THREE.Vector3(0.055, 0.145, 0.065), mass: 1.8 },
      foreR: { visual: this.foreR, center: new THREE.Vector3(0.29, 0.965, 0), half: new THREE.Vector3(0.055, 0.145, 0.065), mass: 2.5 },
      legL: { visual: this.legL, center: new THREE.Vector3(-0.115, 0.615, 0), half: new THREE.Vector3(0.085, 0.205, 0.095), mass: 6 },
      legR: { visual: this.legR, center: new THREE.Vector3(0.115, 0.615, 0), half: new THREE.Vector3(0.085, 0.205, 0.095), mass: 6 },
      shinL: { visual: this.shinL, center: new THREE.Vector3(-0.115, 0.205, 0), half: new THREE.Vector3(0.08, 0.205, 0.09), mass: 4 },
      shinR: { visual: this.shinR, center: new THREE.Vector3(0.115, 0.205, 0), half: new THREE.Vector3(0.08, 0.205, 0.09), mass: 4 }
    };

    for (const [name, limb] of Object.entries(limbs)) {
      const worldCenter = this.root.localToWorld(limb.center.clone());
      const body = new CANNON.Body({
        mass: limb.mass,
        shape: limb.sphere
          ? new CANNON.Sphere(limb.sphere)
          : new CANNON.Box(new CANNON.Vec3(limb.half.x, limb.half.y, limb.half.z)),
        position: new CANNON.Vec3(worldCenter.x, worldCenter.y, worldCenter.z),
        linearDamping: 0.04,
        angularDamping: 0.12
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
      // Arm groups pivot at the shoulder / elbow; their bodies are centred 0.145 below that
      if (name.startsWith('arm') || name.startsWith('fore')) limb.visual.position.y = 0.145;
      // Leg groups pivot at the hip / knee; their bodies are centred 0.205 below that
      if (name.startsWith('leg') || name.startsWith('shin')) limb.visual.position.y = 0.205;
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
    joint('armL', 'foreL', new THREE.Vector3(-0.29, 1.11, 0)); // elbows
    joint('armR', 'foreR', new THREE.Vector3(0.29, 1.11, 0));
    joint('torso', 'pelvis', new THREE.Vector3(0, 1.1, 0)); // stomach — lets them fold at the waist
    joint('pelvis', 'legL', new THREE.Vector3(-0.115, 0.82, 0));
    joint('pelvis', 'legR', new THREE.Vector3(0.115, 0.82, 0));
    joint('legL', 'shinL', new THREE.Vector3(-0.115, 0.41, 0)); // knees
    joint('legR', 'shinR', new THREE.Vector3(0.115, 0.41, 0));

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
    // Where the bullet landed decides how they go down.
    const torsoB = this.ragdollByName.get('torso')!;
    const headB = this.ragdollByName.get('head')!;
    const fwdDir = this.forwardDir(new THREE.Vector3());
    const r = () => Math.random();
    const nudge = (b: CANNON.Body, v: THREE.Vector3) => b.velocity.vadd(new CANNON.Vec3(v.x, v.y, v.z), b.velocity);
    if (hitPart === 'head') {
      // Head shot: the head whips back hard, knees go, body follows it down backwards
      punch(headB, 1.6);
      punch(torsoB, 0.25);
      torsoB.angularVelocity.set(-fwdDir.z * 0, 0, 0);
      // Pitch the torso over backwards relative to the bullet
      const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), bulletDir).normalize();
      torsoB.angularVelocity.set(axis.x * 5, 0, axis.z * 5);
      nudge(torsoB, new THREE.Vector3(bulletDir.x * 1.2, -1.5, bulletDir.z * 1.2));
    } else if (hitPart === 'arm') {
      // Arm hit: yanks the shoulder round — they spin on the spot and corkscrew down
      punch(struck, 1.3);
      punch(torsoB, 0.3);
      const side = Math.sign((struck.position.x - torsoB.position.x) * fwdDir.z - (struck.position.z - torsoB.position.z) * fwdDir.x) || 1;
      torsoB.angularVelocity.set(0, side * (6 + r() * 4), 0);
      nudge(torsoB, new THREE.Vector3(bulletDir.x * 0.8, 0.4, bulletDir.z * 0.8));
    } else if (hitPart === 'leg') {
      // Leg shot: that knee buckles first, they drop straight down and topple
      punch(struck, 1.2);
      nudge(struck, new THREE.Vector3(0, -2, 0));
      nudge(torsoB, new THREE.Vector3(bulletDir.x * 0.3, -3, bulletDir.z * 0.3));
      const lean = r() < 0.5 ? 1 : -1; // forward or back
      torsoB.angularVelocity.set(fwdDir.z * lean * 2.5, (r() - 0.5) * 2, -fwdDir.x * lean * 2.5);
    } else {
      // Body shot: knocked back off their feet, folding around the wound
      punch(struck, 1);
      if (struck !== torsoB) punch(torsoB, 0.6);
      nudge(torsoB, new THREE.Vector3(bulletDir.x * (1.5 + r()), 0.5, bulletDir.z * (1.5 + r())));
      const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), bulletDir).normalize();
      const hi = hitPoint.y - this.root.position.y > 1.2 ? -1 : 1; // high chest: head snaps back; gut: folds forward
      torsoB.angularVelocity.set(axis.x * 3 * hi, (r() - 0.5) * 3, axis.z * 3 * hi);
    }
    void headB;
    // The wound itself: a bullet hole with blood, stuck to whichever limb was
    // hit, facing back along the bullet — it rides with the ragdoll.
    if (!Enemy.woundMat) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, 64, 64);
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * 22;
        const rr = 3 + Math.random() * 8;
        g.fillStyle = `rgba(${100 + Math.random() * 60},6,8,${0.5 + Math.random() * 0.4})`;
        g.beginPath();
        g.ellipse(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, rr, rr * 0.6, a, 0, Math.PI * 2);
        g.fill();
      }
      const grad = g.createRadialGradient(32, 32, 1, 32, 32, 9);
      grad.addColorStop(0, 'rgba(8,3,3,1)');
      grad.addColorStop(0.6, 'rgba(40,6,6,0.95)');
      grad.addColorStop(1, 'rgba(90,10,10,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      Enemy.woundMat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: THREE.DoubleSide
      });
    }
    const struckEntry = this.ragdoll.find((r) => r.body === struck);
    if (struckEntry) {
      const wound = new THREE.Mesh(new THREE.PlaneGeometry(0.16 + Math.random() * 0.08, 0.16 + Math.random() * 0.08), Enemy.woundMat);
      const inward = bulletDir.clone().normalize();
      // Entry point sits on the limb's surface; face the plane back at the shooter
      wound.position.copy(hitPoint).addScaledVector(inward, -0.012);
      wound.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), inward.clone().negate());
      wound.rotateZ(Math.random() * Math.PI * 2);
      struckEntry.container.updateWorldMatrix(true, false);
      struckEntry.container.attach(wound); // keeps its world pose, now rides with the limb
      wound.renderOrder = 3;
    }

    // The rifle leaves their hands: it becomes its own body and clatters away
    this.rifle.updateWorldMatrix(true, false);
    const gunPos = this.rifle.getWorldPosition(new THREE.Vector3());
    const gunQ = this.rifle.getWorldQuaternion(new THREE.Quaternion());
    this.foreR.remove(this.rifle);
    this.rifle.position.copy(gunPos);
    this.rifle.quaternion.copy(gunQ);
    parent.add(this.rifle);
    this.gunBody = new CANNON.Body({
      mass: 3.5,
      shape: new CANNON.Box(new CANNON.Vec3(0.03, 0.045, 0.31)),
      position: new CANNON.Vec3(gunPos.x, gunPos.y, gunPos.z),
      linearDamping: 0.1,
      angularDamping: 0.3
    });
    this.gunBody.quaternion.set(gunQ.x, gunQ.y, gunQ.z, gunQ.w);
    this.gunBody.velocity.set(
      bulletDir.x * 1.5 + (Math.random() - 0.5) * 2,
      1 + Math.random() * 1.5,
      bulletDir.z * 1.5 + (Math.random() - 0.5) * 2
    );
    this.gunBody.angularVelocity.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    world.addBody(this.gunBody);

    // Limbs just let go. Nothing is posed: every limb simply inherits a
    // share of the bullet's momentum (a bit more the closer it is to the
    // wound) plus a small random tumble, and the joints + physics do the rest.
    const hitV = new CANNON.Vec3(hitPoint.x, hitPoint.y, hitPoint.z);
    for (const { body } of this.ragdoll) {
      if (body === struck) continue;
      const near = Math.max(0.15, 1 - body.position.distanceTo(hitV) / 1.4);
      const carry = (0.6 + Math.random() * 1.4) * near;
      body.velocity.x += bulletDir.x * carry + (Math.random() - 0.5) * 0.9;
      body.velocity.y += bulletDir.y * carry * 0.5 + (Math.random() - 0.5) * 0.6;
      body.velocity.z += bulletDir.z * carry + (Math.random() - 0.5) * 0.9;
      const s = 2 + near * 5;
      body.angularVelocity.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
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
    // Knees bend on the back-swing
    this.shinL.rotation.x = Math.max(0, swing) * 0.9;
    this.shinR.rotation.x = Math.max(0, -swing) * 0.9;

    // Aim blend: arms swing while patrolling, raise the rifle when aiming
    this.aimBlend += (this.aimTarget - this.aimBlend) * Math.min(1, dt * 8);
    const armSwing = -swing * 0.7;
    // (+x rotation swings a hanging arm FORWARD — the old negative sign put them behind the back)
    const raise = 1.25 * this.aimBlend;
    this.armR.rotation.x = raise + armSwing * (1 - this.aimBlend);
    this.armL.rotation.x = raise * 0.9 - armSwing * (1 - this.aimBlend);
    this.armL.rotation.z = 0.35 * this.aimBlend;
    // Elbows: bent to hold the rifle when aiming, loose swing while walking
    this.foreR.rotation.x = 0.45 * this.aimBlend + Math.max(0, armSwing) * 0.6 * (1 - this.aimBlend);
    this.foreL.rotation.x = 0.8 * this.aimBlend + Math.max(0, -armSwing) * 0.6 * (1 - this.aimBlend);
    // Rifle stays level and pointing forward whatever the arm does (slight dip when carried)
    this.rifle.rotation.x = -(this.armR.rotation.x + this.foreR.rotation.x) - 0.15 * (1 - this.aimBlend);

    // Subtle idle breathing
    this.torso.position.y = 1.27 + Math.sin(this.walkPhase * 0.3) * 0.008;
  }

  private updateDead(dt: number): void {
    if (this.ragdoll.length === 0 || this.settled) return;
    this.deadTimer += dt;

    // Every limb's visual tracks its own physics body
    let speed = 0;
    for (const { body, container } of this.ragdoll) {
      // Cap limb speed: a huge impulse can tunnel a thin arm into a wall and jam it
      const v = body.velocity.length();
      if (v > 9) body.velocity.scale(9 / v, body.velocity);
      container.position.set(body.position.x, body.position.y, body.position.z);
      container.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      speed += v + body.angularVelocity.length() * 0.5;
    }
    if (this.gunBody) {
      const g = this.gunBody;
      this.rifle.position.set(g.position.x, g.position.y, g.position.z);
      this.rifle.quaternion.set(g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w);
    }

    // Settle once the whole body has stopped moving (or after a hard cap)
    if ((this.deadTimer > 2.5 && speed < 0.3) || this.deadTimer > 11) this.settle();
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
      if (this.gunBody) {
        this.world.removeBody(this.gunBody);
        this.gunBody = null;
      }
    }
    this.ragdoll.length = 0;
  }
}
