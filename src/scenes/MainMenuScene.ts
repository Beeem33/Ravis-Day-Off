import * as THREE from 'three';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { CRTPass } from '../fx/CRTShader';
import { MenuUI } from '../ui/MenuUI';

/**
 * MainMenuScene — a 3D security-office diorama: a guard slouched in his
 * chair with headphones on (muffled lo-fi leaking out), CRT monitors
 * looping "camera feeds" of the office rendered from a mini diorama, and
 * the whole frame pushed through a CRT post shader.
 */
export class MainMenuScene implements GameScene {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private crt: CRTPass;
  private ui: MenuUI | null = null;
  private unsubs: (() => void)[] = [];
  private musicStarted = false;

  // Camera-feed sub-scene
  private feedScene = new THREE.Scene();
  private feedCamera: THREE.PerspectiveCamera;
  private feedRT: THREE.WebGLRenderTarget;
  private feedDummy!: THREE.Group;
  private feedShooterFlash!: THREE.PointLight;
  private feedCycle = 0;

  // Animated diorama bits
  private guardHead!: THREE.Mesh;
  private guardFoot!: THREE.Mesh;
  private tubeLight!: THREE.PointLight;
  private tubeMat!: THREE.MeshStandardMaterial;
  private mouse = { x: 0, y: 0 };
  private mouseHandler = (e: MouseEvent): void => {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  };

  constructor(private ctx: GameContext) {
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 60);
    this.crt = new CRTPass(window.innerWidth, window.innerHeight);
    this.feedRT = new THREE.WebGLRenderTarget(320, 240);
    this.feedCamera = new THREE.PerspectiveCamera(60, 320 / 240, 0.1, 50);
    this.buildOffice();
    this.buildFeedScene();
  }

  // ----------------------------------------------------------------- build

  private buildOffice(): void {
    const s = this.scene;
    s.background = new THREE.Color(0x05070a);

    const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c });

    // Room shell
    const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 6), lam(0x23262c));
    floor.position.set(0, -0.1, 0);
    s.add(floor);
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 0.2), lam(0x2c3038));
    backWall.position.set(0, 1.7, -2.6);
    s.add(backWall);
    const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.4, 6), lam(0x282c33));
    sideWall.position.set(-4, 1.7, 0);
    s.add(sideWall);

    // Desk
    const desk = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.1, 1.2), lam(0x4a3d2e));
    desk.position.set(0, 0.95, -1.7);
    s.add(desk);
    for (const dx of [-2, 2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 1.0), lam(0x35302a));
      leg.position.set(dx, 0.47, -1.7);
      s.add(leg);
    }

    // CRT monitors on the desk (three) + one mounted on the wall
    const monitorSpots: [number, number, number, number][] = [
      [-1.35, 1.35, -1.85, 0.28],
      [0, 1.38, -1.95, 0],
      [1.35, 1.35, -1.85, -0.28],
      [-0.1, 2.55, -2.35, 0.06]
    ];
    const tints = [0x9fd9c1, 0xa8c8e8, 0xd9c99f, 0xb9e0a8];
    monitorSpots.forEach(([x, y, z, yaw], i) => {
      const mon = new THREE.Group();
      mon.position.set(x, y, z);
      mon.rotation.y = yaw;
      const shell = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.72, 0.7), lam(0x3a3d42));
      mon.add(shell);
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.74, 0.56),
        new THREE.MeshBasicMaterial({ map: this.feedRT.texture, color: tints[i] })
      );
      screen.position.set(0, 0, 0.355);
      mon.add(screen);
      const glow = new THREE.PointLight(tints[i], 1.6, 2.6, 1.8);
      glow.position.set(0, 0, 0.6);
      mon.add(glow);
      s.add(mon);
    });

    // The guard: slouched in a chair, headphones on, dead to the world
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.65), lam(0x1e2126));
    chairSeat.position.set(0.4, 0.55, -0.4);
    s.add(chairSeat);
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.12), lam(0x1e2126));
    chairBack.position.set(0.4, 1.0, -0.05);
    chairBack.rotation.x = -0.35; // reclined
    s.add(chairBack);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5), lam(0x111));
    post.position.set(0.4, 0.28, -0.4);
    s.add(post);

    const uniform = lam(0x2e3a52);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), uniform);
    torso.position.set(0.4, 0.95, -0.22);
    torso.rotation.x = -0.42; // slouch
    s.add(torso);
    this.guardHead = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), lam(0xc09a72));
    this.guardHead.position.set(0.4, 1.4, 0.02);
    this.guardHead.rotation.x = -0.65; // lolled back over the chair, out cold… permanently
    s.add(this.guardHead);
    // The reason he's so relaxed: a neat hole in the forehead
    const blood = new THREE.MeshBasicMaterial({ color: 0x4a0708 });
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.016, 12), new THREE.MeshBasicMaterial({ color: 0x050303 }));
    hole.position.set(0.02, 0.05, -0.131);
    hole.rotation.y = Math.PI;
    this.guardHead.add(hole);
    const ring = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), blood);
    ring.position.set(0.02, 0.05, -0.1305);
    ring.rotation.y = Math.PI;
    this.guardHead.add(ring);
    // Exit at the back: a run of blood down the chair back…
    const streak = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.72), blood);
    streak.position.set(0.03, -0.05, 0.062);
    chairBack.add(streak);
    const streak2 = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.5), blood);
    streak2.position.set(-0.06, -0.12, 0.062);
    chairBack.add(streak2);
    // …and a small puddle gathering on the floor behind the chair
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), blood);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(0.42, 0.004, 0.3);
    puddle.scale.set(1, 0.7, 1);
    s.add(puddle);
    for (let i = 0; i < 5; i++) {
      const drop = new THREE.Mesh(new THREE.CircleGeometry(0.012 + Math.random() * 0.02, 8), blood);
      drop.rotation.x = -Math.PI / 2;
      drop.position.set(0.42 + (Math.random() - 0.5) * 0.45, 0.004, 0.3 + (Math.random() - 0.5) * 0.4);
      s.add(drop);
    }
    // Headphones: band + ear cups
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 8, 16, Math.PI), lam(0x14161a));
    band.position.set(0, 0.05, 0);
    band.rotation.z = 0;
    this.guardHead.add(band);
    for (const side of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 12), lam(0x14161a));
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.155, 0, 0);
      this.guardHead.add(cup);
    }
    // Legs kicked up on the desk, arms hanging
    // Legs: thighs angle up from the chair seat (y≈0.6), calves lie flat on
    // the desk top (y=1.0) so the ankles rest ON the desk, not inside it.
    const trousers = lam(0x232c3f);
    const legSeg = (x: number, y0: number, z0: number, y1: number, z1: number) => {
      const len = Math.hypot(y1 - y0, z1 - z0);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, len), trousers);
      seg.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
      seg.rotation.x = Math.atan2(y1 - y0, -(z1 - z0)); // +x rotation lifts the -z end
      s.add(seg);
    };
    for (const x of [0.28, 0.52]) {
      legSeg(x, 0.66, -0.4, 0.98, -0.9); // thigh: hip → knee
      legSeg(x, 1.08, -0.9, 1.13, -1.45); // calf: knee → ankle, underside just on the desk top
    }
    const leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.3), lam(0x17191c));
    leftFoot.position.set(0.28, 1.07, -1.58);
    s.add(leftFoot);
    this.guardFoot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.3), lam(0x17191c));
    this.guardFoot.position.set(0.52, 1.07, -1.58);
    s.add(this.guardFoot);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.14), uniform);
    arm.position.set(0.75, 0.72, -0.3);
    arm.rotation.z = -0.25;
    s.add(arm);

    // Coffee mug + lamp
    // Mug knocked over, coffee spreading across the desk
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), lam(0xb04438));
    mug.position.set(-0.6, 1.055, -1.35);
    mug.rotation.z = Math.PI / 2 + 0.08;
    mug.rotation.y = 0.5;
    const coffee = new THREE.MeshBasicMaterial({ color: 0x3b2314 });
    const spill = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), coffee);
    spill.rotation.x = -Math.PI / 2;
    spill.position.set(-0.78, 1.003, -1.33);
    spill.scale.set(1.4, 0.8, 1);
    s.add(spill);
    const spill2 = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), coffee);
    spill2.rotation.x = -Math.PI / 2;
    spill2.position.set(-0.98, 1.003, -1.42);
    s.add(spill2);
    // Dribble running out of the rim
    const dribble = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.14), coffee);
    dribble.rotation.x = -Math.PI / 2;
    dribble.position.set(-0.69, 1.004, -1.34);
    dribble.rotation.z = 0.3;
    s.add(dribble);
    s.add(mug);
    const lampArm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), lam(0x222));
    lampArm.position.set(1.9, 1.3, -1.9);
    lampArm.rotation.z = 0.4;
    s.add(lampArm);
    const lampLight = new THREE.PointLight(0xffd9a0, 4, 5, 1.8);
    lampLight.position.set(1.7, 1.6, -1.7);
    s.add(lampLight);

    // Poster: "EMPLOYEE OF THE MONTH — RAVI"
    const posterCanvas = document.createElement('canvas');
    posterCanvas.width = 128;
    posterCanvas.height = 160;
    const pg = posterCanvas.getContext('2d')!;
    pg.fillStyle = '#d8d2c2';
    pg.fillRect(0, 0, 128, 160);
    pg.fillStyle = '#7a4020';
    pg.font = 'bold 13px monospace';
    pg.textAlign = 'center';
    pg.fillText('EMPLOYEE', 64, 24);
    pg.fillText('OF THE MONTH', 64, 40);
    pg.fillStyle = '#8a5c3b';
    pg.fillRect(44, 52, 40, 48);
    pg.fillStyle = '#222';
    pg.fillText('RAVI', 64, 122);
    pg.font = '9px monospace';
    pg.fillText('(37 months running)', 64, 140);
    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.75),
      new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(posterCanvas) })
    );
    poster.position.set(-2.4, 1.9, -2.48);
    poster.rotation.z = -0.04;
    this.scene.add(poster);

    // Ceiling + a dim fluorescent tube right above the guard
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 6), lam(0x1d2026));
    ceiling.position.set(0, 2.95, 0);
    s.add(ceiling);
    const fixtureHousing = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.09, 0.36), lam(0x5a5e63));
    fixtureHousing.position.set(0.4, 2.8, -0.5);
    s.add(fixtureHousing);
    this.tubeMat = new THREE.MeshStandardMaterial({
      color: 0x9aa39c,
      emissive: new THREE.Color(0xd6e6da),
      emissiveIntensity: 1.6
    });
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.14), this.tubeMat);
    tube.position.set(0.4, 2.74, -0.5);
    s.add(tube);
    this.tubeLight = new THREE.PointLight(0xcfe3d6, 11, 8, 1.7);
    this.tubeLight.position.set(0.4, 2.65, -0.5);
    s.add(this.tubeLight);

    // Moody ambient
    s.add(new THREE.AmbientLight(0x25303c, 1.1));
    const overhead = new THREE.PointLight(0x9fb4cc, 2.5, 9, 1.6);
    overhead.position.set(-1, 3, 0.5);
    s.add(overhead);

    this.camera.position.set(-1.5, 1.65, 1.9);
    this.camera.lookAt(0.3, 1.45, -1.6);
  }

  /** Mini office corner rendered into the CRT feed texture. */
  private buildFeedScene(): void {
    const s = this.feedScene;
    s.background = new THREE.Color(0x0b0d11);
    const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(14, 0.2, 10), lam(0x33383f));
    floor.position.y = -0.1;
    s.add(floor);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 0.2), lam(0x565b52));
    wall.position.set(0, 1.5, -4);
    s.add(wall);
    // Cubicle row
    for (let i = 0; i < 4; i++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 0.08), lam(0x6a7280));
      panel.position.set(-4.5 + i * 3, 0.75, -1.5);
      s.add(panel);
      const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.7), lam(0x8a7358));
      desk.position.set(-4.5 + i * 3, 0.72, -1.05);
      s.add(desk);
    }
    s.add(new THREE.AmbientLight(0x6a7585, 1.4));
    const l = new THREE.PointLight(0xfff2dc, 8, 14, 1.6);
    l.position.set(0, 2.7, 0);
    s.add(l);

    // The dummy intruder who gets endlessly cleared, poor guy
    this.feedDummy = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.62, 0.25), lam(0x4a4738));
    body.position.y = 1.1;
    this.feedDummy.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), lam(0xc59a76));
    head.position.y = 1.58;
    this.feedDummy.add(head);
    const legsM = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.8, 0.22), lam(0x39414e));
    legsM.position.y = 0.4;
    this.feedDummy.add(legsM);
    s.add(this.feedDummy);

    // "Ravi" muzzle flash from the corner
    this.feedShooterFlash = new THREE.PointLight(0xffb45e, 0, 10, 1.6);
    this.feedShooterFlash.position.set(4.5, 1.4, 2.5);
    s.add(this.feedShooterFlash);

    this.feedCamera.position.set(-5, 2.6, 3.4);
    this.feedCamera.lookAt(0, 0.8, -1.2);
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
    // If audio was already unlocked in a previous shift, resume the mix
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
    // First user gesture unlocks audio → start the muffled mix
    if (!this.musicStarted && this.ctx.audio.ready) {
      this.ctx.audio.startMenuMusic();
      this.musicStarted = true;
    }

    // The guard doesn't move. He's not going to.
    void this.guardHead;
    void this.guardFoot;

    // Tired fluorescent: a faint mains hum in the brightness, the odd sputter
    const hum = 0.92 + 0.08 * Math.sin(time * 120);
    const sputter = Math.sin(time * 0.7) > 0.985 ? 0.55 : 1;
    this.tubeLight.intensity = 11 * hum * sputter;
    this.tubeMat.emissiveIntensity = 1.6 * hum * sputter;

    // Feed loop: intruder paces… then gets "cleared"… then respawns. TV magic.
    this.feedCycle = (this.feedCycle + dt) % 7;
    const c = this.feedCycle;
    if (c < 4.2) {
      // pacing
      this.feedDummy.rotation.z = 0;
      this.feedDummy.position.y = 0;
      this.feedDummy.position.x = Math.sin(c * 0.9) * 2.5 - 1;
      this.feedDummy.position.z = 0.4;
      this.feedDummy.rotation.y = Math.cos(c * 0.9) > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.feedShooterFlash.intensity = 0;
    } else if (c < 4.35) {
      this.feedShooterFlash.intensity = 26; // the shot
    } else if (c < 5.2) {
      // the fall
      const t = Math.min(1, (c - 4.35) / 0.5);
      this.feedShooterFlash.intensity = 0;
      this.feedDummy.rotation.z = (-t * Math.PI) / 2;
      this.feedDummy.position.y = -0.6 * t * t;
    }
    // (5.2..7 — body on the floor, then loop resets him. The tape never lies.)

    // Camera feed slowly pans
    this.feedCamera.position.x = -5 + Math.sin(time * 0.11) * 1.6;
    this.feedCamera.lookAt(Math.sin(time * 0.11) * 1.2, 0.8, -1.2);

    // Menu camera parallax
    this.camera.position.x = -1.5 + this.mouse.x * 0.12;
    this.camera.position.y = 1.65 - this.mouse.y * 0.07;
    this.camera.lookAt(0.3, 1.45, -1.6);
  }

  render(renderer: THREE.WebGLRenderer): void {
    // Camera feed first, then the office through the CRT shader
    renderer.setRenderTarget(this.feedRT);
    renderer.render(this.feedScene, this.feedCamera);
    renderer.setRenderTarget(null);
    this.crt.render(renderer, this.scene, this.camera, performance.now() / 1000);
  }
}
