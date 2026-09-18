import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { CRTPass } from '../fx/CRTShader';
import { MenuUI } from '../ui/MenuUI';
import { RaviVisual, HAND, type HandShape, type RaviRig, type SeatPose } from '../entities/RaviVisual';

const V3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
/**
 * How the modelled Ravi sits for the poster, in the scene's own frame (he
 * faces the camera down +z, his right hand on −x): on the front of the seat,
 * bowed over his knees, feet planted wide.
 */
const POSTER_SEAT = {
  hips: V3(0, 0.6, -0.14),
  lean: [8, 12, 14, 12, -6, -18],
  legs: {
    r: { ankle: V3(-0.27, 0.08, 0.27), knee: V3(-0.35, 0.5, 1), turn: -8 },
    l: { ankle: V3(0.27, 0.08, 0.27), knee: V3(0.35, 0.5, 1), turn: 8 }
  }
};
/** How high his hands rest, forearms along his thighs. */
const HANDS_Y = 0.66;
/** His shooting hand round the pistol's grip, in the pistol's frame (muzzle −Z, slide up). */
const POSTER_GUN_GRIP = {
  wrist: V3(0.029, -0.069, 0.14),
  along: V3(-0.15, 0.331, -0.93).normalize(),
  palm: V3(-1, 0.022, -0.098).normalize(),
  shape: { fingers: [[20, 40, 22], [85, 85, 35], [88, 85, 35], [90, 85, 35]], thumb: [0.3, 0.2, 0.1] } as HandShape
};

/**
 * MainMenuScene — the poster shot. Ravi sits square to the camera in an
 * office chair, hunched forward, forearms on his thighs, his pistol held
 * loose in the right hand and resting on the thigh, muzzle tipped past
 * the knee. One hard light overhead; everything else falls into black.
 * The frame goes through the CRT shader.
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
  /** The pistol in his hand; his fingers close round its grip. */
  private pistol!: THREE.Group;
  /** Where his loose left hand hangs, over the other knee. */
  private looseHand!: THREE.Object3D;
  /** The modelled Ravi, posed each frame from the groups above; null until it loads. */
  private rig: RaviRig | null = null;
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

    // The office chair he sits on — dark, mostly swallowed by the black
    const chairMat = this.lam(0x181a1e);
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.09, 0.62, 3, 0.03), chairMat);
    seat.position.set(0, 0.52, -0.18);
    s.add(seat);
    const backrest = new THREE.Mesh(new RoundedBoxGeometry(0.68, 0.85, 0.1, 3, 0.04), chairMat);
    backrest.position.set(0, 1.0, -0.52);
    backrest.rotation.x = -0.1;
    s.add(backrest);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.46, 10), this.lam(0x0e0f11));
    post.position.set(0, 0.26, -0.18);
    s.add(post);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.32), this.lam(0x0e0f11));
      spoke.position.set(Math.sin(a) * 0.16, 0.04, -0.18 + Math.cos(a) * 0.16);
      spoke.rotation.y = a;
      s.add(spoke);
    }

    // ONE hard light overhead, slightly in front — everything the shot has
    this.spot = new THREE.SpotLight(0xdfe8f0, 55, 9, 0.62, 0.55, 1.4);
    this.spot.position.set(0, 3.6, 1.1);
    this.spot.target.position.set(0, 1.1, 0.1);
    s.add(this.spot);
    s.add(this.spot.target);
    // A breath of ambient so the blacks aren't pure void — darker than the reference
    s.add(new THREE.AmbientLight(0x0a0d12, 0.9));
    // Low cold fill from the camera side so the lap — hands, pistol, knees —
    // reads instead of drowning under the overhead cone
    const lapFill = new THREE.PointLight(0x92a4c0, 4, 4.5, 1.7);
    lapFill.position.set(0.5, 0.65, 1.7);
    s.add(lapFill);

    // Dead-centre framing, cropped at the shins like the reference poster
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

    const trousers = new THREE.MeshStandardMaterial({ color: 0x3a445a, roughness: 0.9 });
    const shoe = this.lam(0x15171a);

    // Legs first: knees wide, feet planted, thighs running out of the dark
    // toward the camera — the lap the pistol rests on
    const limb = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.05, len - r), 3, 10), mat);
      m.position.copy(a).lerp(b, 0.5);
      m.lookAt(b);
      m.rotateX(Math.PI / 2);
      this.ravi.add(m);
      return m;
    };
    for (const side of [-1, 1]) {
      limb(new THREE.Vector3(side * 0.14, 0.58, -0.2), new THREE.Vector3(side * 0.27, 0.66, 0.28), 0.088, trousers);
      limb(new THREE.Vector3(side * 0.28, 0.62, 0.32), new THREE.Vector3(side * 0.3, 0.1, 0.36), 0.066, trousers);
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.11, 0.32, 3, 0.03), shoe);
      foot.position.set(side * 0.31, 0.055, 0.44);
      foot.rotation.y = side * 0.15;
      this.ravi.add(foot);
    }

    // Torso hunched toward the camera, lap open
    const torso = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.58, 0.26, 4, 0.09), shirt);
    torso.position.set(0, 0.92, -0.1);
    torso.rotation.x = 0.24; // leaning forward, over the gun
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
      cap.position.set(side * 0.24, 1.14, -0.02);
      cap.scale.set(1.05, 0.8, 1);
      this.ravi.add(cap);
    }

    // Head bowed a touch — the eyes stay in the shadow under the brow,
    // but he is looking straight down the lens
    this.head = new THREE.Group();
    this.head.position.set(0, 1.28, 0.08);
    this.head.rotation.x = 0.32;
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

    // Arms: shoulders down-forward, forearms dropping onto the thighs
    // (sleeves rolled at the elbow — bare forearms)
    limb(new THREE.Vector3(-0.25, 1.12, -0.04), new THREE.Vector3(-0.35, 0.8, 0.14), 0.06, shirt);
    limb(new THREE.Vector3(0.25, 1.12, -0.04), new THREE.Vector3(0.35, 0.8, 0.14), 0.06, shirt);
    limb(new THREE.Vector3(-0.35, 0.8, 0.16), new THREE.Vector3(-0.26, 0.72, 0.4), 0.048, skin);
    limb(new THREE.Vector3(0.35, 0.8, 0.16), new THREE.Vector3(0.26, 0.74, 0.4), 0.048, skin);

    // Right hand: a fist around the pistol grip, the gun resting on the
    // thigh with the muzzle tipped down past the knee
    this.hands = new THREE.Group();
    // His right hand is on −x: he faces the camera
    this.hands.position.set(-0.24, HANDS_Y, 0.34);
    const fist = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.1, 0.11, 3, 0.032), skin);
    this.hands.add(fist);
    for (let i = 0; i < 4; i++) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 8, 6), skin);
      k.position.set(-0.027 + i * 0.018, 0.052, 0.01);
      this.hands.add(k);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.4, metalness: 0.7 });
    const pistol = new THREE.Group();
    const slide = new THREE.Mesh(new RoundedBoxGeometry(0.042, 0.055, 0.26, 2, 0.01), steel);
    pistol.add(slide);
    const muzzleTip = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.036, 0.036, 2, 0.008), this.lam(0x0b0d10));
    muzzleTip.position.set(0, -0.004, -0.14);
    pistol.add(muzzleTip);
    const grip = new THREE.Mesh(new RoundedBoxGeometry(0.032, 0.11, 0.05, 2, 0.01), this.lam(0x3a3228));
    grip.position.set(0, -0.05, 0.075);
    grip.rotation.x = 0.25;
    pistol.add(grip);
    // Muzzle down-forward, like the reference
    pistol.position.set(-0.005, 0.015, 0.02);
    pistol.rotation.set(-0.85, 0.12, 0);
    this.hands.add(pistol);
    this.pistol = pistol;
    this.ravi.add(this.hands);

    // Left hand hangs loose over the other knee
    const lHand = new THREE.Mesh(new RoundedBoxGeometry(0.085, 0.12, 0.095, 3, 0.03), skin);
    lHand.position.set(0.24, HANDS_Y - 0.04, 0.37);
    lHand.rotation.x = 0.35;
    this.ravi.add(lHand);
    this.looseHand = lHand;

    // The modelled Ravi takes over from the blocks as soon as he has loaded:
    // everything above but the pistol stops drawing, and stays as the frame
    // his pose is read from
    RaviVisual.whenReady(() => {
      const keep = new Set<THREE.Object3D>();
      pistol.traverse((o) => keep.add(o));
      this.ravi.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !keep.has(o)) o.visible = false;
      });
      this.rig = RaviVisual.rig('body');
      this.ravi.add(this.rig.root);
      this.poseRavi();
    });
  }

  /**
   * Sit the model down and hang its hands where the blocks' are: the head
   * nods with this.head, the gun hand closes on the pistol wherever
   * this.hands has it, the left hangs off the far knee.
   */
  private poseRavi(): void {
    const rig = this.rig;
    if (!rig) return;
    this.ravi.updateMatrixWorld(true);
    const inRavi = (o: THREE.Object3D, v: THREE.Vector3): THREE.Vector3 => this.ravi.worldToLocal(o.localToWorld(v.clone()));
    const dirIn = (o: THREE.Object3D, v: THREE.Vector3): THREE.Vector3 =>
      inRavi(o, v).sub(inRavi(o, new THREE.Vector3())).normalize();
    const g = POSTER_GUN_GRIP;
    const lean = [...POSTER_SEAT.lean];
    lean[5] += THREE.MathUtils.radToDeg(this.head.rotation.x - 0.32);
    const roll = [0, 0, 0, 0, 0, THREE.MathUtils.radToDeg(this.head.rotation.z)];
    const pose: SeatPose = {
      hips: POSTER_SEAT.hips,
      lean,
      roll,
      legs: POSTER_SEAT.legs,
      arms: {
        r: {
          wrist: inRavi(this.pistol, g.wrist),
          along: dirIn(this.pistol, g.along),
          palm: dirIn(this.pistol, g.palm),
          elbow: V3(-1, -0.4, -0.5),
          shape: g.shape
        },
        l: {
          wrist: inRavi(this.looseHand, V3(0, 0.05, -0.02)),
          along: dirIn(this.looseHand, V3(0, -0.8, 0.6)),
          palm: dirIn(this.looseHand, V3(-1, 0, 0)),
          elbow: V3(1, -0.4, -0.5),
          shape: HAND.relaxed
        }
      }
    };
    rig.seat(pose);
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
    // again, the gun hand shifting on the thigh. Nothing more.
    const breath = Math.sin(time * 0.55);
    this.ravi.position.y = breath * 0.008;
    this.head.rotation.x = 0.32 + breath * 0.015;
    this.head.rotation.z = Math.sin(time * 0.13) * 0.015;
    this.hands.rotation.z = Math.sin(time * 0.4) * 0.02;
    this.hands.position.y = HANDS_Y + breath * 0.006;
    this.poseRavi();

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
