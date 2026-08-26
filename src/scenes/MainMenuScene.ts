import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { CRTPass } from '../fx/CRTShader';
import { MenuUI } from '../ui/MenuUI';

interface SmokePuff {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  drift: number;
}

/**
 * MainMenuScene — after the shift. Ravi sits in a chair in a dark room,
 * facing the camera, shotgun resting across his lap, cigar going, a single
 * candle burning on the table beside him. The whole frame goes through the
 * CRT post shader.
 */
export class MainMenuScene implements GameScene {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private crt: CRTPass;
  private ui: MenuUI | null = null;
  private unsubs: (() => void)[] = [];
  private musicStarted = false;

  // Animated bits
  private ravi!: THREE.Group;
  private head!: THREE.Group;
  private gun!: THREE.Group;
  private candleLight!: THREE.PointLight;
  private flame!: THREE.Mesh;
  private ember!: THREE.Mesh;
  private emberLight!: THREE.PointLight;
  private cigarTip = new THREE.Vector3();
  private smoke: SmokePuff[] = [];
  private smokeMat: THREE.MeshBasicMaterial;
  private smokeTimer = 0;
  private mouse = { x: 0, y: 0 };
  private mouseHandler = (e: MouseEvent): void => {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  };

  constructor(private ctx: GameContext) {
    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 40);
    this.smokeMat = new THREE.MeshBasicMaterial({
      map: MainMenuScene.smokeTexture(),
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    });
    this.buildRoom();
    this.buildRavi();
    this.crt = new CRTPass(window.innerWidth, window.innerHeight);
  }

  private lam(c: number): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({ color: c });
  }

  private static smokeTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(200,200,205,0.75)');
    grad.addColorStop(0.6, 'rgba(180,180,188,0.28)');
    grad.addColorStop(1, 'rgba(170,170,180,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Ravi's face for the close-up: tired eyes, set jaw. Not angry. Done. */
  private static faceTexture(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#b98f68';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(60,40,30,0.2)';
    for (let i = 0; i < 70; i++) g.fillRect(10 + Math.random() * 44, 38 + Math.random() * 20, 1, 1);
    g.strokeStyle = '#2a1d15';
    g.lineCap = 'round';
    // Heavy lids — half-closed eyes
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(14, 24);
    g.lineTo(27, 25);
    g.moveTo(37, 25);
    g.lineTo(50, 24);
    g.stroke();
    g.fillStyle = '#f0ece4';
    g.fillRect(16, 27, 10, 4);
    g.fillRect(38, 27, 10, 4);
    g.fillStyle = '#1a1a1a';
    g.fillRect(20, 27, 4, 4);
    g.fillRect(41, 27, 4, 4);
    // Shadows under the eyes
    g.fillStyle = 'rgba(70,45,35,0.35)';
    g.fillRect(16, 32, 10, 3);
    g.fillRect(38, 32, 10, 3);
    // Flat mouth, cigar corner
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(24, 49);
    g.lineTo(41, 48);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  }

  // ----------------------------------------------------------------- room

  private buildRoom(): void {
    const s = this.scene;
    s.background = new THREE.Color(0x020304);
    s.fog = new THREE.Fog(0x020304, 3.5, 10);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 12), this.lam(0x1a1c20));
    floor.position.set(0, -0.1, 0);
    s.add(floor);
    // Walls barely there — swallowed by the dark
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(12, 3.2, 0.2), this.lam(0x15171b));
    backWall.position.set(0, 1.6, -2.4);
    s.add(backWall);

    // The side table, and the candle on it
    const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 16), this.lam(0x3e3226));
    tableTop.position.set(-0.95, 0.62, -0.35);
    s.add(tableTop);
    const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.6, 10), this.lam(0x2b2219));
    tableLeg.position.set(-0.95, 0.31, -0.35);
    s.add(tableLeg);

    const candle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.032, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.6 })
    );
    candle.position.set(-0.95, 0.72, -0.35);
    s.add(candle);
    // Melted wax pooling at the base
    const wax = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.055, 0.015, 12),
      new THREE.MeshStandardMaterial({ color: 0xded4ba, roughness: 0.5 })
    );
    wax.position.set(-0.95, 0.648, -0.35);
    s.add(wax);
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 6), this.lam(0x111));
    wick.position.set(-0.95, 0.81, -0.35);
    s.add(wick);
    // Flame: a soft additive teardrop
    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.02, 0.07, 10),
      new THREE.MeshBasicMaterial({ color: 0xffca6a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })
    );
    this.flame.position.set(-0.95, 0.85, -0.35);
    s.add(this.flame);
    // The candle is the key light for the whole shot
    this.candleLight = new THREE.PointLight(0xffb45e, 9, 6, 1.6);
    this.candleLight.position.set(-0.95, 0.9, -0.35);
    s.add(this.candleLight);

    // A whisper of cold fill so his dark side isn't a void
    s.add(new THREE.AmbientLight(0x11151d, 1.0));
    const fill = new THREE.PointLight(0x3a4a66, 1.6, 6, 1.8);
    fill.position.set(1.6, 1.8, 1.4);
    s.add(fill);

    // Framing: dead-on, seated height
    this.camera.position.set(0, 1.05, 2.2);
    this.camera.lookAt(0, 0.95, 0);
  }

  // ----------------------------------------------------------------- Ravi

  private buildRavi(): void {
    const s = this.scene;
    this.ravi = new THREE.Group();
    s.add(this.ravi);

    const shirtMat = new THREE.MeshStandardMaterial({ color: 0x8ea6b6, roughness: 0.9 });
    const trouser = this.lam(0x252a33);
    const skin = this.lam(0xb98f68);
    const shoe = this.lam(0x14161a);
    const hair = this.lam(0x14100c);

    // The chair — a plain office job, facing the camera
    const chair = this.lam(0x1e2126);
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.08, 0.6, 3, 0.03), chair);
    seat.position.set(0, 0.52, -0.12);
    this.ravi.add(seat);
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.85, 0.1, 3, 0.03), chair);
    back.position.set(0, 1.0, -0.42);
    back.rotation.x = 0.12;
    this.ravi.add(back);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 10), this.lam(0x101114));
    post.position.set(0, 0.27, -0.12);
    this.ravi.add(post);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.3), this.lam(0x101114));
      leg.position.set(Math.sin(a) * 0.17, 0.035, -0.12 + Math.cos(a) * 0.17);
      leg.rotation.y = a;
      this.ravi.add(leg);
    }

    // Seated body: thighs forward to the knees, shins down, feet planted
    for (const sx of [-0.13, 0.14]) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.3, 4, 10), trouser);
      thigh.rotation.x = Math.PI / 2 - 0.08;
      thigh.position.set(sx, 0.6, 0.12);
      this.ravi.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 10), trouser);
      shin.position.set(sx, 0.28, 0.32);
      shin.rotation.x = 0.15;
      this.ravi.add(shin);
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.08, 0.27, 3, 0.03), shoe);
      foot.position.set(sx, 0.04, 0.42);
      this.ravi.add(foot);
    }

    // Torso leaned back into the chair, shirt with loose tie, blood still on it
    const torso = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.54, 0.24, 4, 0.08), shirtMat);
    torso.position.set(0, 0.98, -0.14);
    torso.rotation.x = 0.12;
    this.ravi.add(torso);
    const tie = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.3), this.lam(0x6b1a1a));
    tie.position.set(0.04, -0.03, 0.125);
    tie.rotation.z = -0.2;
    torso.add(tie);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(
        new THREE.CircleGeometry(0.018 + Math.random() * 0.03, 8),
        new THREE.MeshBasicMaterial({ color: 0x5a0a0c })
      );
      b.position.set(-0.13 + Math.random() * 0.24, -0.16 + Math.random() * 0.32, 0.124);
      torso.add(b);
    }

    // Head, facing the camera, cigar in the corner of his mouth
    this.head = new THREE.Group();
    this.head.position.set(0, 1.44, -0.1);
    const skull = new THREE.Mesh(
      new RoundedBoxGeometry(0.23, 0.26, 0.23, 4, 0.07),
      [skin, skin, skin, skin, MainMenuScene.faceTexture(), skin]
    );
    this.head.add(skull);
    const crop = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.07, 0.24, 3, 0.03), hair);
    crop.position.y = 0.12;
    this.head.add(crop);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.09, 10), skin);
    neck.position.y = -0.16;
    this.head.add(neck);
    // The cigar: dark wrap, ash-grey tip, ember
    const cigar = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.11, 8), this.lam(0x3d2a1a));
    body.rotation.x = Math.PI / 2;
    cigar.add(body);
    const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.015, 8), this.lam(0x8f8f8a));
    ash.rotation.x = Math.PI / 2;
    ash.position.z = 0.06;
    cigar.add(ash);
    this.ember = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0105, 0.0105, 0.006, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5a1e })
    );
    this.ember.rotation.x = Math.PI / 2;
    this.ember.position.z = 0.07;
    cigar.add(this.ember);
    this.emberLight = new THREE.PointLight(0xff6a22, 0.5, 0.6, 2);
    this.emberLight.position.z = 0.07;
    cigar.add(this.emberLight);
    cigar.position.set(0.055, -0.065, 0.12);
    cigar.rotation.set(0.25, -0.18, 0);
    this.head.add(cigar);
    this.ravi.add(this.head);

    // Arms down to the lap, hands resting on the shotgun
    const mkArm = (shoulder: THREE.Vector3, hand: THREE.Vector3, out: number) => {
      const elbow = shoulder.clone().lerp(hand, 0.5);
      elbow.x += out;
      elbow.z += 0.04;
      const seg = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
        const len = a.distanceTo(b);
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.05, len - r), 3, 8), mat);
        m.position.copy(a).lerp(b, 0.5);
        m.lookAt(b);
        m.rotateX(Math.PI / 2);
        this.ravi.add(m);
      };
      seg(shoulder, elbow, 0.058, shirtMat); // rolled sleeve
      seg(elbow, hand, 0.048, skin); // bare forearm
    };
    mkArm(new THREE.Vector3(0.24, 1.24, -0.12), new THREE.Vector3(0.2, 0.72, 0.14), 0.07);
    mkArm(new THREE.Vector3(-0.24, 1.24, -0.12), new THREE.Vector3(-0.22, 0.72, 0.14), -0.07);

    // The shotgun, resting across his lap
    this.gun = new THREE.Group();
    this.gun.position.set(0, 0.71, 0.16);
    this.gun.rotation.set(0.04, 0.16, 0.05);
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.4, metalness: 0.7 });
    const walnut = new THREE.MeshStandardMaterial({ color: 0x4d3a26, roughness: 0.8 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 12), steel);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(-0.28, 0.03, 0);
    this.gun.add(barrel);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 10), steel);
    tube.rotation.z = Math.PI / 2;
    tube.position.set(-0.25, -0.01, 0);
    this.gun.add(tube);
    const receiver = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.09, 0.055, 3, 0.015), steel);
    receiver.position.set(0.03, 0.005, 0);
    this.gun.add(receiver);
    const forend = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.16, 10), walnut);
    forend.rotation.z = Math.PI / 2;
    forend.position.set(-0.22, -0.01, 0);
    this.gun.add(forend);
    const stock = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.11, 0.05, 3, 0.02), walnut);
    stock.position.set(0.28, -0.015, 0);
    stock.rotation.z = -0.1;
    this.gun.add(stock);
    // Hands resting on it
    const handR = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.07, 0.09, 3, 0.025), skin);
    handR.position.set(0.2, 0.045, 0);
    this.gun.add(handR);
    const handL = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.07, 0.1, 3, 0.025), skin);
    handL.position.set(-0.22, 0.045, 0);
    this.gun.add(handL);
    this.ravi.add(this.gun);
  }

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    this.ui = new MenuUI(this.ctx.uiRoot, this.ctx.bus, this.ctx.audio);
    document.addEventListener('mousemove', this.mouseHandler);
    this.unsubs.push(
      this.ctx.bus.on(Events.Resize, () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.crt.setSize(window.innerWidth, window.innerHeight);
      })
    );
    if (this.ctx.audio.ready) {
      this.ctx.audio.startMenuMusic();
      this.musicStarted = true;
    }
  }

  exit(): void {
    this.ui?.destroy();
    this.ui = null;
    document.removeEventListener('mousemove', this.mouseHandler);
    for (const u of this.unsubs) u();
    this.ctx.audio.stopMenuMusic();
  }

  update(dt: number, time: number): void {
    if (!this.musicStarted && this.ctx.audio.ready) {
      this.ctx.audio.startMenuMusic();
      this.musicStarted = true;
    }

    // Candle: restless flame, restless light
    const flick = 0.85 + Math.sin(time * 9.3) * 0.07 + Math.sin(time * 23.7) * 0.05 + Math.sin(time * 3.1) * 0.03;
    this.candleLight.intensity = 9 * flick;
    this.flame.scale.set(flick, 0.85 + (flick - 0.85) * 2.2, flick);
    this.flame.rotation.z = Math.sin(time * 7.7) * 0.1;

    // The cigar: a slow draw every eight seconds — ember flares, then smoke
    const drag = time % 8;
    const drawing = drag > 5.4 && drag < 6.6;
    const glow = drawing ? 0.75 + Math.sin(((drag - 5.4) / 1.2) * Math.PI) : 0.45 + Math.sin(time * 2.2) * 0.1;
    (this.ember.material as THREE.MeshBasicMaterial).color.setHSL(0.045, 1, 0.25 + glow * 0.3);
    this.emberLight.intensity = glow * 1.1;

    // Breathing + the small motions of a man thinking
    this.ravi.position.y = Math.sin(time * 0.7) * 0.006;
    this.head.rotation.x = 0.06 + Math.sin(time * 0.32) * 0.03;
    this.head.rotation.y = Math.sin(time * 0.21) * 0.06;
    this.head.rotation.z = Math.sin(time * 0.17) * 0.02;
    this.gun.rotation.z = 0.05 + Math.sin(time * 0.7) * 0.004; // rises with the chest

    // Smoke curling off the cigar (and heavier right after a drag)
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = drawing ? 0.18 : 0.5 + Math.random() * 0.3;
      this.head.updateWorldMatrix(true, true);
      this.cigarTip.set(0.055, -0.065, 0.19).applyMatrix4(this.head.matrixWorld);
      const puff = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), this.smokeMat);
      puff.position.copy(this.cigarTip);
      this.scene.add(puff);
      this.smoke.push({ mesh: puff, age: 0, life: 2.6 + Math.random(), drift: Math.random() * Math.PI * 2 });
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.age += dt;
      const k = p.age / p.life;
      p.mesh.position.y += dt * (0.14 + k * 0.1);
      p.mesh.position.x += Math.sin(p.age * 1.3 + p.drift) * dt * 0.03;
      p.mesh.position.z += Math.cos(p.age * 1.1 + p.drift) * dt * 0.02;
      p.mesh.scale.setScalar(1 + k * 3.2);
      p.mesh.quaternion.copy(this.camera.quaternion);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.28 * (1 - k);
      if (k >= 1) {
        this.scene.remove(p.mesh);
        this.smoke.splice(i, 1);
      }
    }

    // Slow drift + mouse parallax, always returning to his eyes
    this.camera.position.set(
      Math.sin(time * 0.07) * 0.12 + this.mouse.x * 0.08,
      1.05 - this.mouse.y * 0.05,
      2.2 + Math.sin(time * 0.05) * 0.08
    );
    this.camera.lookAt(0, 0.98, 0);
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.crt.render(renderer, this.scene, this.camera, performance.now() / 1000);
  }
}
