import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { CRTPass } from '../fx/CRTShader';
import { MenuUI } from '../ui/MenuUI';

/**
 * MainMenuScene — the poster shot. Ravi sits behind a bare wooden table,
 * head bowed under the brim of a fedora, hands clasped in front of his
 * face, elbows planted. One hard light overhead; everything else falls
 * into black. His pistol and a few loose rounds sit at the far edge of
 * the table, just inside the light. The frame goes through the CRT shader.
 */
export class MainMenuScene implements GameScene {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private crt: CRTPass;
  private ui: MenuUI | null = null;
  private unsubs: (() => void)[] = [];
  private musicRetry = 0;

  private ravi!: THREE.Group;
  private head!: THREE.Group;
  private hands!: THREE.Group;
  private spot!: THREE.SpotLight;
  private mouse = { x: 0, y: 0 };
  private mouseHandler = (e: MouseEvent): void => {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  };

  constructor(private ctx: GameContext) {
    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 40);
    this.buildRoom();
    this.buildRavi();
    this.crt = new CRTPass(window.innerWidth, window.innerHeight);
  }

  private lam(c: number): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({ color: c });
  }

  /** Soft radial glow on the backdrop, brightest just behind him. */
  private static backdropTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 74, 6, 128, 74, 150);
    grad.addColorStop(0, '#22262c');
    grad.addColorStop(0.4, '#14171b');
    grad.addColorStop(1, '#060708');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ----------------------------------------------------------------- room

  private buildRoom(): void {
    const s = this.scene;
    s.background = new THREE.Color(0x030404);
    s.fog = new THREE.Fog(0x030404, 5, 12);

    // Backdrop with a faint halo of light behind him
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 5),
      new THREE.MeshBasicMaterial({ map: MainMenuScene.backdropTexture() })
    );
    backdrop.position.set(0, 1.5, -2.2);
    s.add(backdrop);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 12), this.lam(0x0c0d10));
    floor.position.set(0, -0.1, 0);
    s.add(floor);

    // The table: a broad wooden top filling the bottom of the frame
    const wood = new THREE.MeshStandardMaterial({ color: 0x5c4026, roughness: 0.75 });
    const tableTop = new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.09, 1.7, 3, 0.04), wood);
    tableTop.position.set(0, 0.78, 0.55);
    s.add(tableTop);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 1.5), this.lam(0x3a2917));
    skirt.position.set(0, 0.7, 0.55);
    s.add(skirt);

    // His pistol and a few rounds at the table's edge, half in shadow
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.7 });
    const pistol = new THREE.Group();
    const slide = new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.045, 0.2, 2, 0.01), steel);
    pistol.add(slide);
    const grip = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.1, 0.045, 2, 0.01), this.lam(0x3a3228));
    grip.position.set(0, -0.045, 0.075);
    grip.rotation.x = 0.25;
    pistol.add(grip);
    pistol.position.set(0.85, 0.845, 0.75);
    pistol.rotation.set(Math.PI / 2 - 0.02, 0, 2.3);
    s.add(pistol);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.35 });
    for (let i = 0; i < 5; i++) {
      const round = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.024, 8), brass);
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * 0.04;
      round.position.set(1.05 + Math.cos(a) * d, 0.832 + (i < 1 ? 0.011 : 0), 0.62 + Math.sin(a) * d);
      round.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI * 2);
      s.add(round);
    }

    // The pump shotgun, lying FLAT ON ITS SIDE across the middle of the
    // table — the way a gun actually rests when you set it down.
    const walnut = new THREE.MeshStandardMaterial({ color: 0x4d3a26, roughness: 0.8 });
    const shotgun = new THREE.Group();
    // Built along X with Y up; the group is then rolled 90° onto its side
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.6, 12), steel);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(-0.3, 0.035, 0);
    shotgun.add(barrel);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6), brass);
    bead.position.set(-0.59, 0.052, 0);
    shotgun.add(bead);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.44, 10), steel);
    tube.rotation.z = Math.PI / 2;
    tube.position.set(-0.26, -0.002, 0);
    shotgun.add(tube);
    const receiver = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.085, 0.05, 3, 0.012), steel);
    receiver.position.set(0.0, 0.012, 0);
    shotgun.add(receiver);
    const port = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.004), this.lam(0x111));
    port.position.set(0.01, 0.012, 0.026);
    shotgun.add(port);
    // The PUMP: ribbed walnut forend riding the mag tube
    const forend = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.17, 10), walnut);
    forend.rotation.z = Math.PI / 2;
    forend.position.set(-0.24, -0.002, 0);
    shotgun.add(forend);
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.0305, 0.0305, 0.008, 10), this.lam(0x3a2c1c));
      rib.rotation.z = Math.PI / 2;
      rib.position.set(-0.3 + i * 0.03, -0.002, 0);
      shotgun.add(rib);
    }
    const actionBar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.01), steel);
    actionBar.position.set(-0.14, 0.005, 0.02);
    shotgun.add(actionBar);
    // Trigger guard + grip swell into the stock
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.012), steel);
    guard.position.set(0.1, -0.04, 0);
    shotgun.add(guard);
    const gripSwell = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.075, 0.045, 3, 0.018), walnut);
    gripSwell.position.set(0.15, -0.005, 0);
    gripSwell.rotation.z = -0.25;
    shotgun.add(gripSwell);
    const stock = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.1, 0.048, 3, 0.02), walnut);
    stock.position.set(0.31, -0.025, 0);
    stock.rotation.z = -0.12;
    shotgun.add(stock);
    const buttPad = new THREE.Mesh(new RoundedBoxGeometry(0.025, 0.11, 0.05, 2, 0.01), this.lam(0x161616));
    buttPad.position.set(0.44, -0.035, 0);
    buttPad.rotation.z = -0.12;
    shotgun.add(buttPad);
    // Onto its side: a pure 90° roll so it lies DEAD FLAT on the wood; the
    // slight yaw comes from a parent group so it can't tip the barrel up.
    shotgun.rotation.set(-Math.PI / 2, 0, 0);
    const gunRest = new THREE.Group();
    gunRest.add(shotgun);
    gunRest.rotation.y = 0.12;
    gunRest.position.set(0, 0.851, 0.5);
    s.add(gunRest);

    // ONE hard light overhead, slightly in front — everything the shot has
    this.spot = new THREE.SpotLight(0xdfe8f0, 55, 9, 0.62, 0.55, 1.4);
    this.spot.position.set(0, 3.6, 1.1);
    this.spot.target.position.set(0, 1.1, 0.1);
    s.add(this.spot);
    s.add(this.spot.target);
    // A breath of ambient so the blacks aren't pure void — darker than the reference
    s.add(new THREE.AmbientLight(0x0a0d12, 0.9));

    // Dead-centre framing, table edge along the bottom of the frame
    this.camera.position.set(0, 1.15, 2.75);
    this.camera.lookAt(0, 1.08, 0);
  }

  // ----------------------------------------------------------------- Ravi

  private buildRavi(): void {
    const s = this.scene;
    this.ravi = new THREE.Group();
    s.add(this.ravi);

    // Ravi as he is in the game: the call-center man. Light blue shirt with
    // the sleeves rolled, loose dark-red tie, dark cropped hair — no hat, no
    // jacket. Same bowed pose under the same light.
    const shirt = new THREE.MeshStandardMaterial({ color: 0x8ea6b6, roughness: 0.9 });
    const skin = this.lam(0x8a5c3b);
    const hair = new THREE.MeshStandardMaterial({ color: 0x120d09, roughness: 0.95 });

    // Torso leaning slightly forward over the table
    const torso = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.58, 0.26, 4, 0.09), shirt);
    torso.position.set(0, 1.02, -0.28);
    torso.rotation.x = -0.14; // leaning IN, not back
    this.ravi.add(torso);
    const tie = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.28), this.lam(0x1f3a6e));
    tie.position.set(0.02, 0.08, 0.134);
    tie.rotation.z = -0.14; // yanked loose, hanging crooked
    torso.add(tie);
    const collar = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.05, 0.2, 2, 0.02), shirt);
    collar.position.set(0, 0.3, -0.01);
    torso.add(collar);
    // Shoulders (shirt, not padded)
    for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), shirt);
      cap.position.set(side * 0.24, 1.25, -0.28);
      cap.scale.set(1.05, 0.8, 1);
      this.ravi.add(cap);
    }

    // Head BOWED, chin to chest — from this angle it's mostly the dark crown
    // of his hair over the clasped hands
    this.head = new THREE.Group();
    this.head.position.set(0, 1.42, -0.22);
    this.head.rotation.x = 0.58;
    const skull = new THREE.Mesh(new RoundedBoxGeometry(0.23, 0.26, 0.23, 4, 0.07), skin);
    this.head.add(skull);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 10), skin);
    neck.position.set(0, -0.16, -0.02);
    this.head.add(neck);
    // Cropped dark hair: crown cap plus a short back
    const crop = new THREE.Mesh(new RoundedBoxGeometry(0.245, 0.09, 0.245, 3, 0.04), hair);
    crop.position.set(0, 0.115, 0.005);
    this.head.add(crop);
    const backHair = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.14, 0.05, 3, 0.02), hair);
    backHair.position.set(0, 0.03, 0.105);
    this.head.add(backHair);
    this.ravi.add(this.head);

    // Arms: elbows planted wide on the table, forearms rising to the
    // clasped hands in front of his face
    const elbowL = new THREE.Vector3(-0.42, 0.86, 0.28);
    const elbowR = new THREE.Vector3(0.42, 0.86, 0.28);
    const clasp = new THREE.Vector3(0, 1.18, 0.12);
    const seg = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.05, len - r), 3, 10), mat);
      m.position.copy(a).lerp(b, 0.5);
      m.lookAt(b);
      m.rotateX(Math.PI / 2);
      this.ravi.add(m);
    };
    // Upper arms from the shoulders down-forward to the elbows (shirt sleeves)
    seg(new THREE.Vector3(-0.26, 1.24, -0.26), elbowL, 0.06, shirt);
    seg(new THREE.Vector3(0.26, 1.24, -0.26), elbowR, 0.06, shirt);
    // Sleeves rolled at the elbow — bare forearms up to the clasped hands
    seg(elbowL, clasp.clone().add(new THREE.Vector3(-0.05, -0.04, 0)), 0.048, skin);
    seg(elbowR, clasp.clone().add(new THREE.Vector3(0.05, -0.04, 0)), 0.048, skin);

    // The clasped hands read as one closed double fist: two mitts pressed
    // tight, a neat row of knuckles across the top, thumbs crossed in front.
    this.hands = new THREE.Group();
    this.hands.position.copy(clasp);
    const handL = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.095, 0.095, 3, 0.032), skin);
    handL.position.set(-0.036, 0, 0);
    this.hands.add(handL);
    const handR = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.095, 0.095, 3, 0.032), skin);
    handR.position.set(0.036, 0, 0.006);
    this.hands.add(handR);
    // Knuckles: four small bumps in a straight row along the top of each fist
    for (const [sx, dz] of [
      [-1, 0],
      [1, 0.006]
    ] as const) {
      for (let i = 0; i < 4; i++) {
        const k = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 8, 6), skin);
        k.position.set(sx * 0.036 - 0.027 + i * 0.018, 0.05, dz - 0.02);
        this.hands.add(k);
      }
    }
    // Thumbs folded across the front, one over the other
    for (const [sx, y] of [
      [-1, 0.012],
      [1, -0.012]
    ] as const) {
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.045, 2, 8), skin);
      thumb.position.set(sx * 0.012, y, -0.052);
      thumb.rotation.z = Math.PI / 2 - sx * 0.25;
      this.hands.add(thumb);
    }
    this.ravi.add(this.hands);
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

    // Stillness. Breathing, the head hanging a fraction lower and rising
    // again, thumbs shifting against each other. Nothing more.
    const breath = Math.sin(time * 0.55);
    this.ravi.position.y = breath * 0.008;
    this.head.rotation.x = 0.58 + breath * 0.015;
    this.head.rotation.z = Math.sin(time * 0.13) * 0.015;
    this.hands.rotation.z = Math.sin(time * 0.4) * 0.02;
    this.hands.position.y = 1.18 + breath * 0.006;

    // The lamp above swings by a hair, the way hanging lights do
    this.spot.position.x = Math.sin(time * 0.31) * 0.05;
    this.spot.intensity = 55 * (0.97 + Math.sin(time * 17.3) * 0.015 + Math.sin(time * 3.7) * 0.015);

    // Slow drift + mouse parallax, centred on him
    this.camera.position.set(
      Math.sin(time * 0.06) * 0.1 + this.mouse.x * 0.07,
      1.15 - this.mouse.y * 0.05,
      2.75 + Math.sin(time * 0.045) * 0.07
    );
    this.camera.lookAt(0, 1.08, 0);
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.crt.render(renderer, this.scene, this.camera, performance.now() / 1000);
  }
}
