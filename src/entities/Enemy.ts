import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
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
  /** Random per-person offset so idles do not run in lockstep. */
  private animPhase = Math.random() * 100;
  private animTime = 0;
  /** Eased walkSpeed, so strides start and stop smoothly. */
  private strideBlend = 0;
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
  /** A call-centre worker rather than an agent: shirt, chinos, cap, no weapon. */
  readonly civilian: boolean = false;
  /** 0..1 — hands raised. Only the civilian uses it. */
  private handsUp = 0;
  private handsUpTarget = 0;
  /** 0..1 — seated at a desk. */
  private sitBlend = 0;
  private sitTarget = 0;
  /** 0..1 — balled up on the floor with arms over the head. */
  /** 0..1 — down on both knees, pleading. */
  private kneelBlend = 0;
  private kneelTarget = 0;
  private earsBlend = 0;
  private earsTarget = 0;
  private slumpBlend = 0;
  private slumpTarget = 0;
  /** Manning a vehicle turret: no personal weapon, hands on the spades. */
  private turret = false;
  /** In Ravi's grip for a knife takedown: rifle gone, arms clawing, body writhing. */
  beingExecuted = false;
  private struggleTime = 0;
  private rifleDropped = false;
  private flashTime = 0;

  constructor(
    spawn: THREE.Vector3,
    yaw: number,
    index: number,
    opts: { name?: string; civilian?: boolean } = {}
  ) {
    this.name = opts.name ?? AMERICAN_NAMES[index % AMERICAN_NAMES.length];
    this.civilian = opts.civilian ?? false;
    this.variant = index;
    this.root.position.copy(spawn);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.buildBody();

  }

  /**
   * Where everyone's muzzle flashes come from. Each figure used to own a
   * PointLight it switched on to fire, which moved the scene's visible light
   * count and made three.js recompile every material in it — half a second,
   * mid-fight, every time a new number of guns went off at once. One shared
   * ring of always-on lights keeps the count still.
   */
  static flashPool: MuzzleFlashPool | null = null;

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

  /** Shared face textures: one mean, one very dead, one frightened. */
  private static faceAngry: THREE.MeshStandardMaterial | null = null;
  private static faceDead: THREE.MeshStandardMaterial | null = null;
  private static faceDeadCivilian: THREE.MeshStandardMaterial | null = null;
  private static faceWorried: THREE.MeshStandardMaterial | null = null;
  private static faceCalm: THREE.MeshStandardMaterial | null = null;
  private static faceShaken: THREE.MeshStandardMaterial | null = null;

  /** The civilian at rest: level brows, normal eyes, a slight smile. */
  private static drawCalmFace(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#8a5c3b';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#1c120b';
    g.lineCap = 'round';
    // Level brows, sitting well above the eyes
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(13, 22);
    g.lineTo(27, 21);
    g.moveTo(51, 22);
    g.lineTo(37, 21);
    g.stroke();
    // Relaxed eyes — lids covering the top of the iris
    g.fillStyle = '#f6f4ef';
    g.beginPath();
    g.ellipse(21, 32, 6.5, 4.4, 0, 0, Math.PI * 2);
    g.ellipse(43, 32, 6.5, 4.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#17110c';
    g.beginPath();
    g.ellipse(21, 32, 2.6, 2.9, 0, 0, Math.PI * 2);
    g.ellipse(43, 32, 2.6, 2.9, 0, 0, Math.PI * 2);
    g.fill();
    // Faint smile
    g.strokeStyle = '#5a3020';
    g.lineWidth = 2.2;
    g.beginPath();
    g.arc(32, 44, 9, 0.22 * Math.PI, 0.78 * Math.PI);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  }

  /**
   * After the shooting stops: no longer screaming, but not fine either.
   * Inner brow ends lifted, eyes normal but tired, mouth a flat line.
   */
  private static drawShakenFace(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#8a5c3b';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#1c120b';
    g.lineCap = 'round';
    // Brows level at the outside, lifted at the inside — the worry tell
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(13, 23);
    g.lineTo(27, 20);
    g.moveTo(51, 23);
    g.lineTo(37, 20);
    g.stroke();
    // Eyes back to a normal opening, pupils a touch small
    g.fillStyle = '#f6f4ef';
    g.beginPath();
    g.ellipse(21, 32, 6.8, 5.2, 0, 0, Math.PI * 2);
    g.ellipse(43, 32, 6.8, 5.2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#17110c';
    g.beginPath();
    g.ellipse(21, 32, 2.7, 3, 0, 0, Math.PI * 2);
    g.ellipse(43, 32, 2.7, 3, 0, 0, Math.PI * 2);
    g.fill();
    // Shadow under each eye
    g.fillStyle = 'rgba(70,44,30,0.35)';
    g.fillRect(15, 38, 12, 2);
    g.fillRect(37, 38, 12, 2);
    // Flat mouth, corners just down
    g.strokeStyle = '#5a3020';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(24, 47);
    g.lineTo(32, 46);
    g.lineTo(40, 47);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  }

  /** The civilian's face: brows up, wide eyes, open mouth. */
  private static drawWorriedFace(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#8a5c3b';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#1c120b';
    g.lineCap = 'round';
    // Brows raised and tilted OUT — the opposite slant to the angry face
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(13, 24);
    g.lineTo(27, 18);
    g.moveTo(51, 24);
    g.lineTo(37, 18);
    g.stroke();
    // Wide eyes, whites showing all round a small pupil
    g.fillStyle = '#f6f4ef';
    g.beginPath();
    g.ellipse(21, 31, 7.5, 7, 0, 0, Math.PI * 2);
    g.ellipse(43, 31, 7.5, 7, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#17110c';
    g.beginPath();
    g.ellipse(21, 31, 3, 3, 0, 0, Math.PI * 2);
    g.ellipse(43, 31, 3, 3, 0, 0, Math.PI * 2);
    g.fill();
    // Mouth open in a small O
    g.fillStyle = '#5a2b28';
    g.beginPath();
    g.ellipse(32, 49, 5, 6.5, 0, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  }

  private static drawFace(dead: boolean, skinHex?: string): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = skinHex ?? (dead ? '#b9957a' : '#c59a76');
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
    // The civilian wears what the floor staff wear: white shirt, blue
    // chinos, ball cap. Agents are in black suits.
    const suit = this.civilian ? this.mat(0x2f4a7a, 0.9) : this.mat(0x15161a, 0.8);
    const torsoMat = this.civilian ? this.mat(0xf4f2ec, 0.92) : suit;
    const sleeveMat = torsoMat;
    const shirt = this.mat(0xe9e6df, 0.9);
    // Floor staff share Ravi's complexion (same tone as the viewmodel hands)
    const skin = this.mat(this.civilian ? 0x8a5c3b : 0xc59a76);
    const shoe = this.mat(0x0d0d10, 0.45);
    const glove = this.mat(0x0f0f12, 0.9);
    const gunmetal = this.mat(0x1a1c20, 0.5);
    const tieColors = [0x8c1515, 0x111111, 0x1f2a6b, 0x5a1a6b, 0x8c1515, 0x2a2a2a];
    const tie = this.mat(tieColors[this.variant % tieColors.length], 0.7);
    const hairColors = [0x1b1410, 0x3a2a1c, 0x0d0d0d, 0x6b4a2b, 0x2b2b2b, 0x8a7a66];
    const hair = this.mat(this.civilian ? 0x120d0a : hairColors[this.variant % hairColors.length], 0.95);

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
    // Jacket visual hangs below the chest body so it covers the waist seam;
    // the pelvis body underneath just shows as the trouser top.
    const jacketGeo = new RoundedBoxGeometry(0.46, 0.5, 0.26, 4, 0.09);
    jacketGeo.translate(0, -0.07, 0);
    this.torso = this.addPart(new THREE.Mesh(jacketGeo, torsoMat), 'torso');
    this.torso.position.set(0, 1.27, 0);
    this.root.add(this.torso);
    this.pelvis = this.addPart(new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.28, 0.22, 4, 0.07), suit), 'torso');
    this.pelvis.position.set(0, 0.96, 0);
    this.root.add(this.pelvis);
    // Shirt, tie and lapels are flush skins on the chest surface (z = -0.13),
    // not blocks. The tie starts at the collar — the top of the chest — and
    // runs down; the pelvis carries its tail so it reads as one piece.
    if (this.civilian) {
      // Open collar and a headset lanyard — no tie, no lapels
      for (const side of [-1, 1]) {
        const collar = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.09), torsoMat);
        collar.rotation.y = Math.PI;
        collar.position.set(side * 0.05, 0.16, -0.1325);
        collar.rotation.z = side * 0.5;
        this.torso.add(collar);
      }
      const lanyard = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.26), this.mat(0x1d5f8a, 0.8));
      lanyard.position.set(0.03, 0.02, -0.1335);
      lanyard.rotation.y = Math.PI;
      this.torso.add(lanyard);
      const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.08), this.mat(0xe8e4d8, 0.7));
      badge.position.set(0.03, -0.13, -0.1345);
      badge.rotation.y = Math.PI;
      this.torso.add(badge);
    } else {
      const shirtFront = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.34), shirt);
      shirtFront.position.set(0, 0, -0.1315);
      shirtFront.rotation.y = Math.PI;
      this.torso.add(shirtFront);
      const tieMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.3), tie);
      tieMesh.position.set(0, -0.005, -0.1325);
      tieMesh.rotation.y = Math.PI;
      this.torso.add(tieMesh);
      const knot = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.04, 1, 1), tie);
      knot.position.set(0, 0.16, -0.133);
      knot.rotation.y = Math.PI;
      this.torso.add(knot);
      for (const side of [-1, 1]) {
        const lapel = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.3), suit);
        lapel.rotation.y = Math.PI;
        lapel.position.set(side * 0.085, 0.01, -0.132);
        lapel.rotation.z = side * 0.18;
        this.torso.add(lapel);
      }
      for (const y of [-0.08, -0.16]) {
        const btn = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.01), shoe);
        btn.position.set(0.01, y, -0.145);
        this.torso.add(btn);
      }
    }

    // Head: face texture on the front (-Z), hair by variant
    if (!Enemy.faceAngry) Enemy.faceAngry = Enemy.drawFace(false);
    if (!Enemy.faceDead) Enemy.faceDead = Enemy.drawFace(true);
    if (!Enemy.faceDeadCivilian) Enemy.faceDeadCivilian = Enemy.drawFace(true, '#7d5233');
    if (!Enemy.faceWorried) Enemy.faceWorried = Enemy.drawWorriedFace();
    if (!Enemy.faceCalm) Enemy.faceCalm = Enemy.drawCalmFace();
    if (!Enemy.faceShaken) Enemy.faceShaken = Enemy.drawShakenFace();
    // Staff start calm; the scared face is switched in when they panic
    const faceMat = this.civilian ? Enemy.faceCalm : Enemy.faceAngry;
    this.head = this.addPart(
      new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.27, 0.24, 5, 0.075), [skin, skin, skin, skin, skin, faceMat]),
      'head'
    );
    this.head.position.set(0, 1.585, 0); // sits on the collar, not hovering above it
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.08, 10), skin);
    neck.position.set(0, -0.12, 0);
    this.head.add(neck);
    this.root.add(this.head);
    const hairBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.4), hair);
      m.position.set(x, y, z);
      this.head.add(m);
    };
    if (this.civilian) {
      // Ball cap: crown sitting on the head, peak out over the face (-Z)
      const capMat = this.mat(0x1d3f6e, 0.9);
      const crown = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.09, 0.25, 4, 0.05), capMat);
      crown.position.set(0, 0.15, 0.005);
      this.head.add(crown);
      const peak = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.025, 0.12, 3, 0.012), capMat);
      peak.position.set(0, 0.115, -0.165);
      peak.rotation.x = 0.12;
      this.head.add(peak);
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), capMat);
      btn.position.set(0, 0.2, 0.005);
      this.head.add(btn);
      // A little hair showing under the back of the cap
      hairBox(0.235, 0.05, 0.06, 0, 0.09, 0.1);
      // Bare hands and shirt cuffs, and no weapon
      return this.finishBody(sleeveMat, sleeveMat, skin, gunmetal);
    }
    switch (this.variant % 6) {
      case 0: // buzz cut
        hairBox(0.245, 0.05, 0.245, 0, 0.135, 0);
        break;
      case 1: // side part — swept to one side with a fringe
        hairBox(0.25, 0.08, 0.25, 0, 0.14, 0.01);
        // Sat at brow height across the face and read as a solid unibrow;
        // moved up onto the hairline where a fringe belongs.
        hairBox(0.2, 0.04, 0.05, -0.02, 0.132, -0.101);
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
    this.finishBody(suit, shirt, glove, gunmetal);
  }

  /**
   * Arms and weapon — shared by both builds. Sleeves/cuffs/hands differ
   * (suit + gloves for an agent, shirt sleeves + bare hands for the
   * civilian), and the civilian's rifle group is left empty so it draws
   * nothing while the death code can still detach it unconditionally.
   */
  private finishBody(
    sleeveMat: THREE.Material,
    cuffMat: THREE.Material,
    handMat: THREE.Material,
    gunmetal: THREE.Material
  ): void {
    // Upper arm pivots at the shoulder; forearm (cuff + hand) pivots at the elbow
    const mkArm = (side: number): [THREE.Group, THREE.Group] => {
      const g = new THREE.Group();
      g.position.set(side * 0.29, 1.4, 0);
      const upper = this.addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.2, 4, 12), sleeveMat), 'arm');
      upper.position.set(0, -0.145, 0);
      g.add(upper);
      const fore = new THREE.Group();
      fore.position.set(0, -0.29, 0); // elbow
      const lower = this.addPart(new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 12), sleeveMat), 'arm');
      lower.position.set(0, -0.145, 0);
      fore.add(lower);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.03, 14), cuffMat);
      cuff.position.set(0, -0.24, 0);
      fore.add(cuff);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), handMat);
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
    if (!this.civilian) {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.62), gunmetal);
      this.rifle.add(receiver);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), gunmetal);
      mag.position.set(0, -0.11, 0.05);
      mag.rotation.x = 0.3;
      this.rifle.add(mag);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.16), this.mat(0x4d3a26));
      stock.position.set(0, -0.01, 0.34);
      this.rifle.add(stock);
    }
    this.muzzle.position.set(0, 0.01, -0.36);
    this.rifle.add(this.muzzle);
    this.rifle.position.set(-0.12, -0.21, -0.12); // held in the right hand (forearm frame, origin at the elbow)
    this.foreR.add(this.rifle);
  }

  /** Civilian only: put your hands up. Also drops the calm face. */
  setHandsUp(on: boolean): void {
    this.handsUpTarget = on ? 1 : 0;
    if (on) this.setScared();
  }

  /** Swap the calm face for the frightened one. */
  setScared(): void {
    if (!this.civilian || !Enemy.faceWorried) return;
    const mats = this.head.material;
    if (Array.isArray(mats)) mats[5] = Enemy.faceWorried;
  }

  /**
   * Man a mounted gun. The rifle goes away entirely and both arms come up
   * onto the spade grips in front — the weapon they are firing belongs to
   * the vehicle, not to them.
   */
  setTurretGunner(on: boolean): void {
    this.turret = on;
    this.rifle.visible = !on;
  }

  /** Down on both knees, hands up, begging. */
  setKneeling(on: boolean): void {
    this.kneelTarget = on ? 1 : 0;
    if (on) this.setScared();
  }

  /**
   * Hands clamped over the ears, head ducked. Unlike kneeling this is not a
   * planted pose — it rides on top of whatever the legs are doing, so they
   * keep running while they do it.
   */
  setCoveringEars(on: boolean): void {
    this.earsTarget = on ? 1 : 0;
    if (on) this.setScared();
  }

  /**
   * Sat on the floor with his back to a wall, legs straight out, one hand
   * clamped over his stomach and the other flat on the carpet beside him.
   * Wears the shaken face rather than the panicked one — he has had time to
   * get used to it.
   */
  setSlumped(on: boolean): void {
    this.slumpTarget = on ? 1 : 0;
    if (on) this.setShaken();
  }

  /** Shaken but back on their feet — the face for after the shooting stops. */
  setShaken(): void {
    if (!this.civilian || !Enemy.faceShaken) return;
    const mats = (this.head as THREE.Mesh).material;
    if (Array.isArray(mats)) mats[5] = Enemy.faceShaken;
  }

  /**
   * Out of every panic pose and back upright. Used when the floor goes quiet:
   * anyone still kneeling or covering their ears comes back to normal.
   */
  standDown(): void {
    this.kneelTarget = 0;
    this.earsTarget = 0;
    this.handsUpTarget = 0;
    this.slumpTarget = 0;
    this.setShaken();
  }

  /**
   * True while a pose pins them in place. Kneeling is a planted stance — an
   * AI that walks them anyway just slides the whole pose over the carpet.
   * Covering the ears is not: that one is meant to be run in.
   */
  get rooted(): boolean {
    return this.kneelTarget > 0 || this.kneelBlend > 0.05
      || this.slumpTarget > 0 || this.slumpBlend > 0.05;
  }

  /**
   * Sit down / stand up. Hips drop to seat height, thighs come forward to
   * horizontal and the shins fold back down so the feet stay on the floor.
   */
  setSitting(on: boolean, instant = false): void {
    this.sitTarget = on ? 1 : 0;
    if (instant) this.sitBlend = this.sitTarget;
  }

  /** True once they're properly on their feet again. */
  get standing(): boolean {
    return this.sitBlend < 0.05;
  }

  /**
   * The rifle leaves their hands — becomes its own physics body and clatters
   * away along `dir`. Used by both death and the knife takedown.
   */
  private dropRifle(world: CANNON.World, dir: THREE.Vector3): void {
    if (this.rifleDropped) return;
    this.rifleDropped = true;
    const parent = this.root.parent ?? this.root;
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
      dir.x * 1.5 + (Math.random() - 0.5) * 2,
      1 + Math.random() * 1.5,
      dir.z * 1.5 + (Math.random() - 0.5) * 2
    );
    this.gunBody.angularVelocity.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    world.addBody(this.gunBody);
  }

  /** Grabbed for a knife takedown: gun hits the floor, hands come up to claw. */
  beginExecution(world: CANNON.World): void {
    if (!this.alive || this.beingExecuted) return;
    this.beingExecuted = true;
    this.struggleTime = 0;
    this.aimTarget = 0;
    this.walkSpeed = 0;
    // The gun tumbles out ahead of them, roughly toward their attacker
    this.dropRifle(world, this.forwardDir(new THREE.Vector3()).multiplyScalar(0.6));
  }

  // Scratch vectors — gripRifle runs every frame for every live enemy.
  private static _gripTarget = new THREE.Vector3();
  private static _gripLocal = new THREE.Vector3();
  private static _gripDir = new THREE.Vector3();
  private static _gripQuat = new THREE.Quaternion();
  private static _gripChain = new THREE.Vector3();
  private static _rifleQuat = new THREE.Quaternion();
  private static _rifleAim = new THREE.Quaternion();
  private static _rifleEuler = new THREE.Euler();

  /**
   * Two-bone IK putting the left hand on the rifle's handguard.
   *
   * The rifle hangs off the right forearm, so where the support hand needs to
   * be moves with the aim. Rather than guessing fixed rotations, solve the
   * left arm each frame: point the upper arm at the grip, then bend the elbow
   * by the angle the law of cosines gives for the remaining reach.
   * `blend` fades it in with the aim so the arm doesn't snap across.
   */
  private gripRifle(blend: number): void {
    const UPPER = 0.29; // shoulder to elbow
    const FORE = 0.31; // elbow to hand

    // Walk the handguard up the right arm's chain into root space by hand.
    // Going through world space would depend on matrixWorld, which is only
    // refreshed at render time and is a frame stale here.
    const local = Enemy._gripLocal.set(0, 0.02, -0.19); // handguard, in rifle space
    local.applyQuaternion(this.rifle.quaternion).add(this.rifle.position); // → forearm
    local.applyQuaternion(this.foreR.quaternion).add(this.foreR.position); // → upper arm
    local.applyQuaternion(this.armR.quaternion).add(this.armR.position); // → root
    local.sub(this.armL.position); // → relative to the left shoulder

    let d = local.length();
    if (d < 1e-4) return;
    const maxReach = (UPPER + FORE) * 0.995;
    if (d > maxReach) d = maxReach;
    const dir = Enemy._gripDir.copy(local).normalize();

    // Elbow first: the interior angle that closes the triangle, applied as a
    // forward fold about the elbow's X axis.
    const cosB = (UPPER * UPPER + FORE * FORE - d * d) / (2 * UPPER * FORE);
    const bend = Math.PI - Math.acos(THREE.MathUtils.clamp(cosB, -1, 1));

    // With that fold, the shoulder-to-hand vector in the upper arm's own
    // frame is fixed. Rotating that onto the line to the grip puts the hand
    // exactly on target — no separate shoulder angle needed.
    const chain = Enemy._gripChain.set(0, -(UPPER + FORE * Math.cos(bend)), -FORE * Math.sin(bend)).normalize();
    const q = Enemy._gripQuat.setFromUnitVectors(chain, dir);

    this.armL.quaternion.slerp(q, blend);
    this.foreL.rotation.x = THREE.MathUtils.lerp(this.foreL.rotation.x, bend, blend);
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
    Enemy.flashPool?.flash(this.muzzleWorld());
  }

  // ------------------------------------------------------------------ death

  /**
   * Fatal hit: the figure becomes a jointed ragdoll — torso, head, two arms
   * and two legs as separate cannon bodies linked by ball joints — the
   * bullet impulse lands on whichever part was hit, and the whole thing
   * folds, flops and slides to rest on its own.
   */
  die(
    hitPoint: THREE.Vector3,
    bulletDir: THREE.Vector3,
    world: CANNON.World,
    hitPart: string = 'torso',
    impulseScale = 1
  ): void {
    if (!this.alive) return;
    this.alive = false;
    // The lights go out behind the eyes
    const mats = this.head.material as THREE.Material[];
    const deadFace = this.civilian ? Enemy.faceDeadCivilian : Enemy.faceDead;
    if (Array.isArray(mats) && deadFace) mats[5] = deadFace;
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
      head: { visual: this.head, center: new THREE.Vector3(0, 1.585, 0), half: new THREE.Vector3(0.12, 0.13, 0.12), mass: 5, sphere: 0.13 },
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
        // A body keeps some tone even in death — damp every limb so it swings
        // once and settles instead of flapping, legs hardest of all
        angularDamping:
          name.startsWith('leg') || name.startsWith('shin')
            ? 0.55
            : name.startsWith('arm') || name.startsWith('fore')
              ? 0.25
              : 0.2,
        // Ragdoll parts don't collide with EACH OTHER (group 2 only hits group 1:
        // the level, mags, guns). Thigh/shin and arm boxes overlap at every
        // joint, so self-collision was jamming the knees and elbows stiff.
        collisionFilterGroup: 2,
        collisionFilterMask: 1
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

    // Joints: free ball joints for the shoulders/elbows, cone-limited for the
    // waist, hips and knees so the body can't fold flat like paper — `limit`
    // is the max bend angle (rad) between the two limbs, `twist` the max
    // roll around the limb's own axis.
    const joint = (a: string, b: string, pivot: THREE.Vector3, limit?: { angle: number; twist: number }) => {
      const A = this.ragdollByName.get(a)!;
      const B = this.ragdollByName.get(b)!;
      const pa = pivot.clone().sub(limbs[a].center);
      const pb = pivot.clone().sub(limbs[b].center);
      let c: CANNON.Constraint;
      if (limit) {
        c = new CANNON.ConeTwistConstraint(A, B, {
          pivotA: new CANNON.Vec3(pa.x, pa.y, pa.z),
          pivotB: new CANNON.Vec3(pb.x, pb.y, pb.z),
          axisA: new CANNON.Vec3(0, 1, 0),
          axisB: new CANNON.Vec3(0, 1, 0),
          angle: limit.angle,
          twistAngle: limit.twist,
          maxForce: 1e4
        });
      } else {
        c = new CANNON.PointToPointConstraint(A, new CANNON.Vec3(pa.x, pa.y, pa.z), B, new CANNON.Vec3(pb.x, pb.y, pb.z), 1e4);
      }
      c.collideConnected = false; // free hinge — no contact between the two halves of a joint
      world.addConstraint(c);
    };
    // Neck: a cone-twist so the head nods/rolls but only swivels ±90° — no owl necks
    {
      const A = this.ragdollByName.get('torso')!;
      const B = this.ragdollByName.get('head')!;
      const pivot = new THREE.Vector3(0, 1.47, 0);
      const pa = pivot.clone().sub(limbs.torso.center);
      const pb = pivot.clone().sub(limbs.head.center);
      world.addConstraint(
        new CANNON.ConeTwistConstraint(A, B, {
          pivotA: new CANNON.Vec3(pa.x, pa.y, pa.z),
          pivotB: new CANNON.Vec3(pb.x, pb.y, pb.z),
          axisA: new CANNON.Vec3(0, 1, 0),
          axisB: new CANNON.Vec3(0, 1, 0),
          angle: 0.9, // nod / tilt range
          twistAngle: Math.PI / 2, // ±90° swivel = 180° total
          maxForce: 1e4,
          collideConnected: false
        })
      );
    }
    // Shoulders swing wide but not clean through the torso; elbows are elbows
    joint('torso', 'armL', new THREE.Vector3(-0.29, 1.4, 0), { angle: 1.4, twist: 0.6 });
    joint('torso', 'armR', new THREE.Vector3(0.29, 1.4, 0), { angle: 1.4, twist: 0.6 });
    joint('armL', 'foreL', new THREE.Vector3(-0.29, 1.11, 0), { angle: 1.0, twist: 0.3 }); // elbows
    joint('armR', 'foreR', new THREE.Vector3(0.29, 1.11, 0), { angle: 1.0, twist: 0.3 });
    // Waist still slumps but can't fold flat in half
    joint('torso', 'pelvis', new THREE.Vector3(0, 1.1, 0), { angle: 0.45, twist: 0.3 });
    // Hips swing but don't splay to the splits; knees bend part-way, not backwards flat
    joint('pelvis', 'legL', new THREE.Vector3(-0.115, 0.82, 0), { angle: 0.6, twist: 0.25 });
    joint('pelvis', 'legR', new THREE.Vector3(0.115, 0.82, 0), { angle: 0.6, twist: 0.25 });
    joint('legL', 'shinL', new THREE.Vector3(-0.115, 0.41, 0), { angle: 0.55, twist: 0.15 }); // knees
    joint('legR', 'shinR', new THREE.Vector3(0.115, 0.41, 0), { angle: 0.55, twist: 0.15 });

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
      const mag = (125 + Math.random() * 65) * scale * impulseScale * (body.mass / 30);
      const impulse = new CANNON.Vec3(bulletDir.x * mag, bulletDir.y * mag * 0.4 + 12 * scale, bulletDir.z * mag);
      const rel = new CANNON.Vec3(hitPoint.x - body.position.x, hitPoint.y - body.position.y, hitPoint.z - body.position.z);
      body.applyImpulse(impulse, rel);
    };
    // Where the bullet landed decides how they go down. Nothing here SETS a
    // spin outright — the impulse is applied at the actual hit point (so an
    // off-centre hit already twists the body naturally) and these only add
    // a bias for the limb that was hit.
    const torsoB = this.ragdollByName.get('torso')!;
    const pelvisB = this.ragdollByName.get('pelvis')!;
    const headB = this.ragdollByName.get('head')!;
    const fwdDir = this.forwardDir(new THREE.Vector3());
    const rightDir = new THREE.Vector3(fwdDir.z === 0 && fwdDir.x === 0 ? 1 : -fwdDir.z, 0, fwdDir.x).normalize();
    const r = () => Math.random();
    const nudge = (b: CANNON.Body, v: THREE.Vector3) =>
      b.velocity.vadd(new CANNON.Vec3(v.x * impulseScale, v.y * impulseScale, v.z * impulseScale), b.velocity);
    const spin = (b: CANNON.Body, v: THREE.Vector3) =>
      b.angularVelocity.vadd(new CANNON.Vec3(v.x * impulseScale, v.y * impulseScale, v.z * impulseScale), b.angularVelocity);
    // Hit offset in the enemy's own frame: +side = their right, height above the feet
    const rel = hitPoint.clone().sub(this.root.position);
    const side = rel.dot(rightDir); // metres right (+) / left (−) of the spine
    const sideSign = Math.sign(side) || (r() < 0.5 ? -1 : 1);
    const lateral = Math.min(1, Math.abs(side) / 0.25); // 0 centre … 1 shoulder/hip edge
    // Does the bullet push them back (front hit) or forward (shot in the back)?
    const fromFront = bulletDir.dot(fwdDir) > 0 ? 1 : -1;

    if (hitPart === 'head') {
      // Head whips with the bullet, body follows it down
      punch(headB, 1.6);
      punch(torsoB, 0.25);
      nudge(torsoB, new THREE.Vector3(bulletDir.x * 1.2, -1.2, bulletDir.z * 1.2));
    } else if (hitPart === 'arm') {
      // Shoulder/arm: that side is yanked round and they go down onto it
      punch(struck, 1.3);
      punch(torsoB, 0.3);
      nudge(torsoB, new THREE.Vector3(bulletDir.x * 0.8, 0.3, bulletDir.z * 0.8));
    } else if (hitPart === 'leg') {
      // Leg: knee buckles, they drop and topple over that leg
      punch(struck, 1.2);
      nudge(struck, new THREE.Vector3(0, -2, 0));
      nudge(pelvisB, new THREE.Vector3(bulletDir.x * 0.3, -2.5, bulletDir.z * 0.3));
      nudge(torsoB, new THREE.Vector3(0, -1.5, 0));
    } else {
      // Body: knocked off their feet, folding around the wound
      punch(struck, 1);
      if (struck !== torsoB) punch(torsoB, 0.6);
      nudge(torsoB, new THREE.Vector3(bulletDir.x * (1.2 + r()), 0.4, bulletDir.z * (1.2 + r())));
      // Gut shots fold forward at the waist, high chest hits rock the chest back
      const gut = rel.y < 1.15 ? 1 : -0.5;
      spin(torsoB, new THREE.Vector3(rightDir.x * 4 * gut * fromFront, 0, rightDir.z * 4 * gut * fromFront));
    }

    // Side reaction, for every hit type: the struck side is driven back, the
    // body twists toward it and falls onto that side rather than straight back.
    if (lateral > 0.15) {
      const twist = -sideSign * fromFront * (3 + 5 * lateral); // yaw toward the hit side
      spin(torsoB, new THREE.Vector3(0, twist, 0));
      spin(pelvisB, new THREE.Vector3(0, twist * 0.6, 0));
      // Lean/fall toward that side (roll about the forward axis)
      spin(torsoB, new THREE.Vector3(fwdDir.x * sideSign * 2.5 * lateral, 0, fwdDir.z * sideSign * 2.5 * lateral));
      nudge(torsoB, rightDir.clone().multiplyScalar(sideSign * (0.8 + 1.2 * lateral)));
      nudge(pelvisB, rightDir.clone().multiplyScalar(sideSign * 0.5 * lateral));
    }
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
    this.addWound(hitPoint, bulletDir, struck);

    // The rifle leaves their hands: it becomes its own body and clatters away
    this.dropRifle(world, bulletDir);

    // Limbs just let go. Nothing is posed: every limb simply inherits a
    // share of the bullet's momentum (a bit more the closer it is to the
    // wound) plus a small random tumble, and the joints + physics do the rest.
    const hitV = new CANNON.Vec3(hitPoint.x, hitPoint.y, hitPoint.z);
    for (const { body } of this.ragdoll) {
      if (body === struck) continue;
      const near = Math.max(0.15, 1 - body.position.distanceTo(hitV) / 1.4);
      const carry = (0.6 + Math.random() * 1.4) * near * impulseScale;
      body.velocity.x += bulletDir.x * carry + (Math.random() - 0.5) * 0.9;
      body.velocity.y += bulletDir.y * carry * 0.5 + (Math.random() - 0.5) * 0.6;
      body.velocity.z += bulletDir.z * carry + (Math.random() - 0.5) * 0.9;
      const s = 2 + near * 5;
      body.angularVelocity.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
  }

  update(dt: number): void {
    if (this.flashTime > 0) this.flashTime -= dt;

    if (!this.alive) {
      this.updateDead(dt);
      return;
    }

    // ---- Walk cycle
    this.animTime += dt; // always runs, for idle motion while standing still
    const at = this.animTime + this.animPhase; // offset, so a room of people
    // typing does not all hit the same key on the same frame
    // Ease the stride in and out so starting and stopping isn't a snap
    this.strideBlend += (this.walkSpeed - this.strideBlend) * Math.min(1, dt * 6);
    const stride = this.strideBlend;
    if (this.walkSpeed > 0.05 || stride > 0.02) {
      this.walkPhase += dt * 7.5 * (0.5 + this.walkSpeed);
    }
    const swing = Math.sin(this.walkPhase) * 0.55 * stride;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    // Knees bend BACKWARD (negative x — +x swings a limb forward) and only
    // while that leg is behind the body, heel coming up towards the seat.
    // Bending them forward on the front swing broke the leg the wrong way.
    this.shinL.rotation.x = -Math.max(0, -swing) * 1.05;
    this.shinR.rotation.x = -Math.max(0, swing) * 1.05;

    // Body rise and fall, twice per cycle. Highest when a leg is directly
    // underneath (legs passing, swing ≈ 0) and lowest when they are split
    // widest. Keying this to cos put it exactly out of phase — the body sank
    // at the top of each step, which is what made the walk bounce wrongly.
    const bob = -Math.abs(Math.sin(this.walkPhase)) * 0.042 * stride;
    const sway = Math.sin(this.walkPhase) * 0.018 * stride; // weight shifting side to side
    const lean = 0.13 * stride; // leaning into the walk

    // ---- Sitting: hips drop to seat height, thighs forward, shins back down
    this.sitBlend += (this.sitTarget - this.sitBlend) * Math.min(1, dt * 4.5);
    const sit = this.sitBlend;
    if (sit > 0.001) {
      this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, 1.55, sit);
      this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, 1.55, sit);
      // Shins rotate back by the same amount, so the lower leg stays vertical
      this.shinL.rotation.x = THREE.MathUtils.lerp(this.shinL.rotation.x, -1.5, sit);
      this.shinR.rotation.x = THREE.MathUtils.lerp(this.shinR.rotation.x, -1.5, sit);
    }
    // ---- Slumped against a wall: hips on the carpet, legs straight out
    this.slumpBlend += (this.slumpTarget - this.slumpBlend) * Math.min(1, dt * 5);
    const slump = this.slumpBlend;
    if (slump > 0.001) {
      this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, 1.5, slump);
      this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, 1.46, slump);
      this.legL.rotation.z = THREE.MathUtils.lerp(this.legL.rotation.z, -0.1, slump);
      this.legR.rotation.z = THREE.MathUtils.lerp(this.legR.rotation.z, 0.13, slump);
      this.shinL.rotation.x = THREE.MathUtils.lerp(this.shinL.rotation.x, -0.12, slump);
      this.shinR.rotation.x = THREE.MathUtils.lerp(this.shinR.rotation.x, -0.2, slump);
    }

    // ---- Kneeling: thighs vertical, shins folded back under the seat
    this.kneelBlend += (this.kneelTarget - this.kneelBlend) * Math.min(1, dt * 5);
    const kneel = this.kneelBlend;
    if (kneel > 0.001) {
      this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, 0.15, kneel);
      this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, 0.15, kneel);
      this.shinL.rotation.x = THREE.MathUtils.lerp(this.shinL.rotation.x, -2.5, kneel);
      this.shinR.rotation.x = THREE.MathUtils.lerp(this.shinR.rotation.x, -2.5, kneel);
    }
    // Hip height: seated on a chair, or down on the knees
    const drop = bob - 0.355 * sit - 0.38 * kneel - 0.66 * slump;

    // Hips ride with the pelvis, or the legs detach from it as it sways
    this.legL.position.set(-0.115 + sway, 0.82 + drop, 0);
    this.legR.position.set(0.115 + sway, 0.82 + drop, 0);
    this.pelvis.position.set(sway, 0.96 + drop, 0);
    this.pelvis.rotation.z = -sway * 1.6;
    // Shoulders and head hang off the root rather than the chest, so the
    // hip drop has to be carried up to them by hand.
    this.head.position.set(sway * 0.6, 1.585 + drop, 0);
    this.head.rotation.x = -lean * 0.7; // head stays level as the chest tips
    for (const [g, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      g.position.set(side * 0.29 + sway * 0.7, 1.4 + drop, 0);
    }

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
    // Bring the weapon in to the centreline as it comes up. Held out at the
    // right shoulder the handguard is 0.8m from the left shoulder — further
    // than the arm is long — so the support hand could never reach it.
    this.armR.rotation.z = -0.5 * this.aimBlend;
    // Rifle points forward whatever the arms are doing. Cancelling the arm
    // rotations one Euler axis at a time leaves a yaw behind, so undo the
    // whole parent rotation instead and set the pose we actually want.
    // (Skip all of it once the rifle is on the floor as its own body.)
    if (!this.rifleDropped) {
      Enemy._rifleEuler.set(-0.15 * (1 - this.aimBlend), 0, 0); // muzzle dips when carried
      Enemy._rifleQuat.copy(this.armR.quaternion).multiply(this.foreR.quaternion).invert();
      this.rifle.quaternion.copy(Enemy._rifleQuat).multiply(Enemy._rifleAim.setFromEuler(Enemy._rifleEuler));

      // Support hand: reach the left arm out to the handguard so it is actually
      // holding the weapon, instead of hanging in the air beside it.
      if (!this.civilian && this.aimBlend > 0.01) {
        this.gripRifle(this.aimBlend);
      }
    } else if (this.gunBody) {
      // Dropped while still alive (takedown): the visual tracks the physics
      this.rifle.position.set(this.gunBody.position.x, this.gunBody.position.y, this.gunBody.position.z);
      this.rifle.quaternion.set(
        this.gunBody.quaternion.x,
        this.gunBody.quaternion.y,
        this.gunBody.quaternion.z,
        this.gunBody.quaternion.w
      );
    }

    // Held for execution — panic overrides everything: both hands come up to
    // claw at the grip on their face, head wrenched back, body bucking
    if (this.beingExecuted) {
      this.struggleTime += dt;
      const s = this.struggleTime;
      const buck = Math.sin(s * 12.5) * 0.1 + Math.sin(s * 7.3 + 1.2) * 0.06;
      const claw = Math.sin(s * 15) * 0.14;
      this.armR.rotation.x = 2.1 + claw;
      this.armL.rotation.x = 2.15 - claw * 0.8;
      this.armR.rotation.z = -0.25 + buck * 0.5;
      this.armL.rotation.z = 0.3 - buck * 0.4;
      this.foreR.rotation.x = 0.55 + Math.sin(s * 13.7) * 0.18;
      this.foreL.rotation.x = 0.6 - Math.sin(s * 11.1 + 0.6) * 0.18;
      this.head.rotation.x = 0.38 + buck * 0.35; // wrenched back by the grip
      this.head.rotation.z = Math.sin(s * 9) * 0.08;
      this.torso.position.set(0, 1.27, 0);
      this.torso.rotation.x = -0.1 + buck * 0.4; // leaning away, bucking
      this.torso.rotation.z = buck * 0.3;
      // Feet scrabbling for purchase
      this.legL.rotation.x = 0.12 + Math.sin(s * 10.5) * 0.16;
      this.legR.rotation.x = 0.1 - Math.sin(s * 10.5 + 0.9) * 0.16;
      this.shinL.rotation.x = Math.max(0, Math.sin(s * 10.5)) * 0.3;
      this.shinR.rotation.x = Math.max(0, -Math.sin(s * 10.5 + 0.9)) * 0.3;
      return; // the walk/idle chest pose below must not overwrite the struggle
    }

    // Seated and working: forearms out over the keyboard, hands ticking away
    // at slightly different rates so it reads as typing rather than a twitch.
    if (sit > 0.001 && this.handsUp < 0.5) {
      const tR = Math.sin(at * 9.2) * 0.07 + Math.sin(at * 14.3) * 0.03;
      const tL = Math.sin(at * 8.1 + 1.7) * 0.07 + Math.sin(at * 13.1 + 0.6) * 0.03;
      this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, 0.62, sit);
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, 0.62, sit);
      this.armR.rotation.z = THREE.MathUtils.lerp(this.armR.rotation.z, -0.12, sit);
      this.armL.rotation.z = THREE.MathUtils.lerp(this.armL.rotation.z, 0.12, sit);
      this.foreR.rotation.x = THREE.MathUtils.lerp(this.foreR.rotation.x, 0.62 + tR, sit);
      this.foreL.rotation.x = THREE.MathUtils.lerp(this.foreL.rotation.x, 0.62 + tL, sit);
      // Leaning in at the screen, with a slow breathing sway
      this.torso.rotation.x = THREE.MathUtils.lerp(this.torso.rotation.x, 0.14, sit);
      this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, 0.1, sit);
      this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, Math.sin(at * 0.7) * 0.12, sit);
    }

    // Turret gunner: both hands forward and slightly apart on the grips,
    // shoulders squared, leaning into the recoil.
    if (this.turret) {
      const kick = Math.sin(this.animTime * 26) * 0.03 * (this.flashTime > 0 ? 1 : 0);
      this.armR.rotation.x = 1.42 + kick;
      this.armL.rotation.x = 1.42 + kick;
      this.armR.rotation.z = -0.2;
      this.armL.rotation.z = 0.2;
      this.foreR.rotation.x = -0.45;
      this.foreL.rotation.x = -0.45;
      this.torso.rotation.x = 0.22 + kick * 0.5;
      this.head.rotation.x = -0.12;
    }

    // Hands up — overrides the arm swing entirely as it blends in
    this.handsUp += (this.handsUpTarget - this.handsUp) * Math.min(1, dt * 6);
    if (this.handsUp > 0.001) {
      const h = this.handsUp;
      const tremble = Math.sin(at * 11) * 0.035 * h;
      // Z has to splay the arms OUTWARD from the shoulders. Rotating them
      // inward brought both hands together over the head, which read as a
      // dive rather than surrender.
      this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, 2.85 + tremble, h);
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, 2.85 - tremble, h);
      this.armR.rotation.z = THREE.MathUtils.lerp(this.armR.rotation.z, 0.42, h);
      this.armL.rotation.z = THREE.MathUtils.lerp(this.armL.rotation.z, -0.42, h);
      // Elbows almost straight, so the hands clear the top of the head
      // Slightly bent, not locked straight back
      this.foreR.rotation.x = THREE.MathUtils.lerp(this.foreR.rotation.x, -0.18, h);
      this.foreL.rotation.x = THREE.MathUtils.lerp(this.foreL.rotation.x, -0.18, h);
    }

    // Hands clamped over the ears, elbows flared up and forward. Only the
    // arms and the chin are touched, so the run cycle carries on underneath.
    //
    // The angles are not eyeballed: getting a hand onto the ear needs all
    // three shoulder axes, because the arm's own X/Z alone can only swing it
    // in front of the face. These were solved against the actual rig so the
    // palm lands 0.125m out from the head centre and 0.03m below it — where
    // an ear is — with the elbow raised 0.26m above the shoulder and the
    // forearm running up 0.27m OUTBOARD of the head rather than across the
    // face. That last term is what matters: an earlier solve put the hand on
    // the ear but swept the forearm over the nose to get there, which read as
    // a salute — measurably correct, visibly wrong. The left arm is the
    // mirror: X the same, Y and Z negated.
    this.earsBlend += (this.earsTarget - this.earsBlend) * Math.min(1, dt * 6);
    if (this.earsBlend > 0.001) {
      const c = this.earsBlend;
      const flinch = Math.sin(at * 14) * 0.045 * c;
      this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, -1.58, c);
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, -1.58, c);
      // Nothing else writes the shoulder's Y, so these scale straight off the
      // blend and unwind to zero on their own when the pose lets go.
      this.armR.rotation.y = -1.1 * c;
      this.armL.rotation.y = 1.1 * c;
      this.armR.rotation.z = THREE.MathUtils.lerp(this.armR.rotation.z, 1.56, c);
      this.armL.rotation.z = THREE.MathUtils.lerp(this.armL.rotation.z, -1.56, c);
      this.foreR.rotation.x = THREE.MathUtils.lerp(this.foreR.rotation.x, -2.35 + flinch, c);
      this.foreL.rotation.x = THREE.MathUtils.lerp(this.foreL.rotation.x, -2.35 - flinch, c);
      // Chin down into the shoulders, the way people do it
      this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, 0.26, c);
    }

    // Slumped: one hand pressed over the wound, the other flat on the floor
    // taking his weight, chest tipped back against the wall behind him.
    if (slump > 0.001) {
      const breathe = Math.sin(at * 2.6) * 0.03 * slump;
      // Right arm comes across the body; the forearm folds in to the stomach
      this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, 0.62 + breathe, slump);
      this.armR.rotation.z = THREE.MathUtils.lerp(this.armR.rotation.z, -0.62, slump);
      this.foreR.rotation.x = THREE.MathUtils.lerp(this.foreR.rotation.x, -1.15, slump);
      // Left arm braced straight down and a little out, palm on the carpet
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, -0.22, slump);
      this.armL.rotation.z = THREE.MathUtils.lerp(this.armL.rotation.z, -0.5, slump);
      this.foreL.rotation.x = THREE.MathUtils.lerp(this.foreL.rotation.x, 0.12, slump);
      // Tipped back against the wall, head up, watching whoever just walked in
      this.torso.rotation.x = THREE.MathUtils.lerp(this.torso.rotation.x, -0.2 + breathe, slump);
      this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, 0.12, slump);
      this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, 0, slump);
    }

    // Chest: rides the bob, leans into the walk, breathes when still
    this.torso.position.set(sway * 0.85, 1.27 + drop + Math.sin(at * 2.2) * 0.008 * (1 - stride), 0);
    this.torso.rotation.x = lean;
    this.torso.rotation.z = -sway * 2.2;
  }

  private updateDead(dt: number): void {
    if (this.ragdoll.length === 0) return;
    if (this.settled) {
      // Asleep; only sync if something woke them (a bullet, a body landing on them)
      if (!this.ragdoll.some((r) => r.body.sleepState !== CANNON.Body.SLEEPING)) return;
    }
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

  /** Bullet hole + blood stuck to a limb at the hit point, riding with it. */
  private addWound(hitPoint: THREE.Vector3, bulletDir: THREE.Vector3, body: CANNON.Body): void {
    const entry = this.ragdoll.find((r) => r.body === body);
    if (!entry || !Enemy.woundMat) return;
    const wound = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14 + Math.random() * 0.08, 0.14 + Math.random() * 0.08),
      Enemy.woundMat
    );
    const inward = bulletDir.clone().normalize();
    wound.position.copy(hitPoint).addScaledVector(inward, -0.012);
    wound.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), inward.clone().negate());
    wound.rotateZ(Math.random() * Math.PI * 2);
    entry.container.updateWorldMatrix(true, false);
    entry.container.attach(wound); // keeps its world pose, now rides with the limb
    wound.renderOrder = 3;
  }

  /**
   * Come to rest. The bodies STAY in the world (asleep, so they cost
   * nothing) — a corpse can still be shot and will jolt, bleed and shift.
   */
  private settle(): void {
    this.settled = true;
    for (const { body } of this.ragdoll) body.sleep();
    this.gunBody?.sleep();
  }

  /**
   * A bullet into an already-dead body: wake the nearest limb, shove it
   * along the bullet, and add another wound.
   */
  hitCorpse(hitPoint: THREE.Vector3, bulletDir: THREE.Vector3): void {
    if (this.ragdoll.length === 0) return;
    const hv = new CANNON.Vec3(hitPoint.x, hitPoint.y, hitPoint.z);
    let struck = this.ragdoll[0].body;
    let best = Infinity;
    for (const { body } of this.ragdoll) {
      const d = body.position.distanceTo(hv);
      if (d < best) {
        best = d;
        struck = body;
      }
    }
    for (const { body } of this.ragdoll) body.wakeUp();
    const mag = (95 + Math.random() * 55) * (struck.mass / 18);
    struck.applyImpulse(
      new CANNON.Vec3(bulletDir.x * mag, bulletDir.y * mag * 0.5 + 4, bulletDir.z * mag),
      new CANNON.Vec3(hitPoint.x - struck.position.x, hitPoint.y - struck.position.y, hitPoint.z - struck.position.z)
    );
    this.addWound(hitPoint, bulletDir, struck);
    // The whole corpse shifts with the round, not just the bit that was hit
    for (const { body } of this.ragdoll) {
      if (body === struck) continue;
      const near = Math.max(0.2, 1 - body.position.distanceTo(struck.position) / 1.2);
      body.velocity.x += bulletDir.x * 1.6 * near;
      body.velocity.y += 0.3 * near;
      body.velocity.z += bulletDir.z * 1.6 * near;
    }
    // Keep tracking the bodies until they come to rest again
    this.settled = false;
    this.deadTimer = 0;
  }
}
