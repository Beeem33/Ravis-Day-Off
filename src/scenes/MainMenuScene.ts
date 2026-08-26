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
 * MainMenuScene — after the shift. Ravi sits facing the camera in a dark
 * room, one leg crossed over the other, cigar in hand — four seconds at his
 * lips, then slowly down to rest, then back up. On the table beside him: a
 * single candle dead centre, his pistol, and a small pile of loose rounds.
 * The whole frame goes through the CRT post shader.
 */
export class MainMenuScene implements GameScene {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private crt: CRTPass;
  private ui: MenuUI | null = null;
  private unsubs: (() => void)[] = [];
  private musicRetry = 0;

  // Animated bits
  private ravi!: THREE.Group;
  private head!: THREE.Group;
  private shoulderR!: THREE.Group;
  private elbowR!: THREE.Group;
  private cigar!: THREE.Group;
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

  /** Dead serious. Hard eyes straight at the camera, brows down, jaw set. */
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
    // Brows driven down toward the bridge
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(13, 21);
    g.lineTo(27, 25);
    g.moveTo(51, 21);
    g.lineTo(37, 25);
    g.stroke();
    // Narrowed eyes, fixed on the lens
    g.fillStyle = '#f0ece4';
    g.fillRect(15, 27, 11, 5);
    g.fillRect(38, 27, 11, 5);
    g.fillStyle = '#1a1a1a';
    g.fillRect(19, 28, 4, 4);
    g.fillRect(42, 28, 4, 4);
    // Hard flat mouth
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(23, 49);
    g.lineTo(41, 49);
    g.stroke();
    // Set jaw shadow
    g.strokeStyle = 'rgba(70,45,35,0.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(20, 55);
    g.lineTo(44, 55);
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
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(12, 3.2, 0.2), this.lam(0x15171b));
    backWall.position.set(0, 1.6, -2.4);
    s.add(backWall);

    // The side table
    const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 18), this.lam(0x3e3226));
    tableTop.position.set(-0.95, 0.62, -0.2);
    s.add(tableTop);
    const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.6, 10), this.lam(0x2b2219));
    tableLeg.position.set(-0.95, 0.31, -0.2);
    s.add(tableLeg);

    // Candle dead centre of the table
    const candle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.032, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.6 })
    );
    candle.position.set(-0.95, 0.72, -0.2);
    s.add(candle);
    const wax = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.055, 0.015, 12),
      new THREE.MeshStandardMaterial({ color: 0xded4ba, roughness: 0.5 })
    );
    wax.position.set(-0.95, 0.648, -0.2);
    s.add(wax);
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 6), this.lam(0x111));
    wick.position.set(-0.95, 0.81, -0.2);
    s.add(wick);
    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.02, 0.07, 10),
      new THREE.MeshBasicMaterial({ color: 0xffca6a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })
    );
    this.flame.position.set(-0.95, 0.85, -0.2);
    s.add(this.flame);
    this.candleLight = new THREE.PointLight(0xffb45e, 9, 6, 1.6);
    this.candleLight.position.set(-0.95, 0.9, -0.2);
    s.add(this.candleLight);

    // His pistol on the table, and a small pile of loose rounds
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.7 });
    const pistol = new THREE.Group();
    const slide = new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.045, 0.2, 2, 0.01), steel);
    pistol.add(slide);
    const grip = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.1, 0.045, 2, 0.01), this.lam(0x3a3228));
    grip.position.set(0, -0.045, 0.075);
    grip.rotation.x = 0.25;
    pistol.add(grip);
    pistol.position.set(-1.07, 0.665, -0.06);
    pistol.rotation.set(Math.PI / 2 - 0.02, 0, 1.9); // lying flat on its side
    s.add(pistol);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.35 });
    for (let i = 0; i < 6; i++) {
      const round = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.024, 8), brass);
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * 0.045;
      round.position.set(-0.8 + Math.cos(a) * d, 0.647 + (i < 2 ? 0.011 : 0), -0.08 + Math.sin(a) * d);
      round.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI * 2);
      s.add(round);
    }

    // Lighting: candle is the key; a whisper of cold fill from the other side
    s.add(new THREE.AmbientLight(0x11151d, 1.0));
    const fill = new THREE.PointLight(0x3a4a66, 1.6, 6, 1.8);
    fill.position.set(1.6, 1.8, 1.4);
    s.add(fill);

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

    // The chair, facing the camera
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

    // LEFT leg planted; RIGHT leg crossed over it, ankle riding the knee —
    // the boss-of-the-room sit.
    {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.3, 4, 10), trouser);
      thigh.rotation.x = Math.PI / 2 - 0.08;
      thigh.position.set(-0.13, 0.6, 0.12);
      this.ravi.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.3, 4, 10), trouser);
      shin.position.set(-0.13, 0.28, 0.32);
      shin.rotation.x = 0.15;
      this.ravi.add(shin);
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.08, 0.27, 3, 0.03), shoe);
      foot.position.set(-0.13, 0.04, 0.42);
      this.ravi.add(foot);
    }
    {
      // Right thigh angles out and forward, knee high
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.3, 4, 10), trouser);
      thigh.position.set(0.18, 0.66, 0.1);
      thigh.rotation.set(Math.PI / 2 - 0.18, 0, -0.35);
      this.ravi.add(thigh);
      // Shin lies across, ankle landing on the left knee
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.3, 4, 10), trouser);
      shin.position.set(0.03, 0.68, 0.32);
      shin.rotation.set(0.25, 0, Math.PI / 2 - 0.12);
      this.ravi.add(shin);
      // Foot hanging off past the left knee, toes dropped
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.08, 0.25, 3, 0.03), shoe);
      foot.position.set(-0.24, 0.62, 0.37);
      foot.rotation.set(0.5, 0.3, 0.15);
      this.ravi.add(foot);
    }

    // Torso against the chair back, shirt, loose tie, someone else's blood
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

    // Head: dead serious, eyes on the camera
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
    this.ravi.add(this.head);

    // LEFT arm: resting along the chair, hand on his crossed shin
    {
      const seg = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
        const len = a.distanceTo(b);
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.05, len - r), 3, 8), mat);
        m.position.copy(a).lerp(b, 0.5);
        m.lookAt(b);
        m.rotateX(Math.PI / 2);
        this.ravi.add(m);
      };
      const shoulder = new THREE.Vector3(-0.24, 1.24, -0.12);
      const elbow = new THREE.Vector3(-0.31, 0.95, 0.0);
      const hand = new THREE.Vector3(-0.16, 0.72, 0.3);
      seg(shoulder, elbow, 0.058, shirtMat);
      seg(elbow, hand, 0.048, skin);
      const handL = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.07, 0.1, 3, 0.025), skin);
      handL.position.copy(hand);
      this.ravi.add(handL);
    }

    // RIGHT arm: articulated — shoulder and elbow joints — so it can carry
    // the cigar between his mouth and the armrest.
    this.shoulderR = new THREE.Group();
    this.shoulderR.position.set(0.24, 1.26, -0.1);
    const upperR = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.24, 4, 10), shirtMat);
    upperR.position.set(0, -0.16, 0);
    this.shoulderR.add(upperR);
    this.elbowR = new THREE.Group();
    this.elbowR.position.set(0, -0.32, 0);
    const foreR = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.2, 4, 10), skin);
    foreR.position.set(0, -0.14, 0);
    this.elbowR.add(foreR);
    const handR = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.075, 0.085, 3, 0.025), skin);
    handR.position.set(0, -0.28, 0);
    this.elbowR.add(handR);
    // The cigar, pinched in the fingers
    this.cigar = new THREE.Group();
    const cbody = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.11, 8), this.lam(0x3d2a1a));
    cbody.rotation.x = Math.PI / 2;
    this.cigar.add(cbody);
    const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.015, 8), this.lam(0x8f8f8a));
    ash.rotation.x = Math.PI / 2;
    ash.position.z = -0.055;
    this.cigar.add(ash);
    this.ember = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0105, 0.0105, 0.006, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5a1e })
    );
    this.ember.rotation.x = Math.PI / 2;
    this.ember.position.z = -0.065;
    this.cigar.add(this.ember);
    this.emberLight = new THREE.PointLight(0xff6a22, 0.5, 0.6, 2);
    this.emberLight.position.z = -0.065;
    this.cigar.add(this.emberLight);
    this.cigar.position.set(0, -0.3, -0.06);
    this.cigar.rotation.x = -0.5;
    this.elbowR.add(this.cigar);
    this.shoulderR.add(this.elbowR);
    this.ravi.add(this.shoulderR);
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
    // Kick the music immediately if the browser lets us; otherwise the
    // update loop keeps retrying and it starts on the first click.
    this.ctx.audio.unlock();
    this.ctx.audio.startMenuMusic();
  }

  exit(): void {
    this.ui?.destroy();
    this.ui = null;
    document.removeEventListener('mousemove', this.mouseHandler);
    for (const u of this.unsubs) u();
    this.ctx.audio.stopMenuMusic();
  }

  update(dt: number, time: number): void {
    // Keep nudging until the track is actually going (autoplay policy)
    this.musicRetry -= dt;
    if (this.musicRetry <= 0 && !this.ctx.audio.menuMusicPlaying) {
      this.musicRetry = 0.5;
      this.ctx.audio.startMenuMusic();
    }

    // Candle: restless flame, restless light
    const flick = 0.85 + Math.sin(time * 9.3) * 0.07 + Math.sin(time * 23.7) * 0.05 + Math.sin(time * 3.1) * 0.03;
    this.candleLight.intensity = 9 * flick;
    this.flame.scale.set(flick, 0.85 + (flick - 0.85) * 2.2, flick);
    this.flame.rotation.z = Math.sin(time * 7.7) * 0.1;

    // The cigar arm: 4s at the mouth → 1.4s slow lower → 2.4s resting at
    // armrest height → 1.4s back up. Ember flares while it's at his lips.
    const CYCLE = 9.2;
    const p = time % CYCLE;
    const ease = (x: number) => x * x * (3 - 2 * x);
    let lift: number; // 1 = at mouth, 0 = down at the rest
    if (p < 4) lift = 1;
    else if (p < 5.4) lift = 1 - ease((p - 4) / 1.4);
    else if (p < 7.8) lift = 0;
    else lift = ease((p - 7.8) / 1.4);
    // Two-joint pose blend: down pose / mouth pose
    this.shoulderR.rotation.x = -0.28 - 0.78 * lift;
    this.shoulderR.rotation.z = -0.1 + 0.62 * lift;
    this.shoulderR.rotation.y = 0.15 * lift;
    this.elbowR.rotation.x = -0.5 - 1.35 * lift;
    const atMouth = lift > 0.96;
    const glow = atMouth ? 0.75 + Math.sin(time * 3.5) * 0.25 : 0.4 + Math.sin(time * 2.2) * 0.08;
    (this.ember.material as THREE.MeshBasicMaterial).color.setHSL(0.045, 1, 0.25 + glow * 0.3);
    this.emberLight.intensity = glow * 1.1;

    // Stillness otherwise: breathing, and the smallest turn of the head
    this.ravi.position.y = Math.sin(time * 0.7) * 0.006;
    this.head.rotation.x = 0.02 + Math.sin(time * 0.32) * 0.02;
    this.head.rotation.y = Math.sin(time * 0.21) * 0.04;

    // Smoke curls off the cigar — thickest while it's at his mouth
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = atMouth ? 0.25 : 0.6 + Math.random() * 0.3;
      this.cigar.updateWorldMatrix(true, false);
      this.cigarTip.set(0, 0, -0.07).applyMatrix4(this.cigar.matrixWorld);
      const puff = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), this.smokeMat);
      puff.position.copy(this.cigarTip);
      this.scene.add(puff);
      this.smoke.push({ mesh: puff, age: 0, life: 2.6 + Math.random(), drift: Math.random() * Math.PI * 2 });
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const sp = this.smoke[i];
      sp.age += dt;
      const k = sp.age / sp.life;
      sp.mesh.position.y += dt * (0.14 + k * 0.1);
      sp.mesh.position.x += Math.sin(sp.age * 1.3 + sp.drift) * dt * 0.03;
      sp.mesh.position.z += Math.cos(sp.age * 1.1 + sp.drift) * dt * 0.02;
      sp.mesh.scale.setScalar(1 + k * 3.2);
      sp.mesh.quaternion.copy(this.camera.quaternion);
      (sp.mesh.material as THREE.MeshBasicMaterial).opacity = 0.28 * (1 - k);
      if (k >= 1) {
        this.scene.remove(sp.mesh);
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
