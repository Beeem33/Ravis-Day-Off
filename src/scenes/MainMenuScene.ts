import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { CRTPass } from '../fx/CRTShader';
import { MenuUI } from '../ui/MenuUI';

/**
 * MainMenuScene — a cinematic hero shot: Ravi stands in the wrecked office
 * after the shift, blood on his shirt, slowly inspecting the shotgun —
 * turning it in his hands, riding the pump. Behind him: cubicles, a
 * flickering fluorescent, and the bodies of the men who picked the wrong
 * call center. The whole frame goes through the CRT post shader.
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
  private gun!: THREE.Group;
  private pump!: THREE.Group;
  private head!: THREE.Group;
  private tubeLight!: THREE.PointLight;
  private tubeMat!: THREE.MeshStandardMaterial;
  private mouse = { x: 0, y: 0 };
  private mouseHandler = (e: MouseEvent): void => {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  };

  constructor(private ctx: GameContext) {
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 60);
    this.buildSet();
    this.buildRavi();
    this.crt = new CRTPass(window.innerWidth, window.innerHeight);
  }

  // ----------------------------------------------------------------- set

  private lam(c: number): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({ color: c });
  }

  private buildSet(): void {
    const s = this.scene;
    s.background = new THREE.Color(0x04060a);
    s.fog = new THREE.Fog(0x04060a, 6, 18);

    // Floor + walls
    const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.2, 16), this.lam(0x23262c));
    floor.position.set(0, -0.1, 0);
    s.add(floor);
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(20, 3.4, 0.2), this.lam(0x2a2e36));
    backWall.position.set(0, 1.7, -6);
    s.add(backWall);
    const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.4, 16), this.lam(0x262a31));
    sideWall.position.set(-7, 1.7, 0);
    s.add(sideWall);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(20, 0.2, 16), this.lam(0x191c21));
    ceiling.position.set(0, 3.3, 0);
    s.add(ceiling);

    // Windows in the back wall with a cold city glow behind them
    for (const wx of [-4.5, -1, 2.5]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 0.1), this.lam(0x1a1d22));
      frame.position.set(wx, 1.9, -5.93);
      s.add(frame);
      const glassGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 1.3),
        new THREE.MeshBasicMaterial({ color: 0x2c3f58 })
      );
      glassGlow.position.set(wx, 1.9, -5.87);
      s.add(glassGlow);
    }
    const cityLight = new THREE.PointLight(0x40587c, 3, 12, 1.6);
    cityLight.position.set(-1, 2.2, -5.2);
    s.add(cityLight);

    // Cubicle row behind Ravi
    for (let i = 0; i < 3; i++) {
      const x = -4.2 + i * 3.1;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.5, 0.08), this.lam(0x4b5260));
      panel.position.set(x, 0.75, -3.4);
      s.add(panel);
      const desk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.8), this.lam(0x6a5949));
      desk.position.set(x, 0.74, -2.9);
      s.add(desk);
      const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.12), this.lam(0x14161a));
      monitor.position.set(x - 0.5 + i * 0.4, 1.02, -3.1);
      monitor.rotation.y = (i - 1) * 0.4;
      s.add(monitor);
    }
    // Scattered paper
    const paper = new THREE.MeshLambertMaterial({ color: 0xd8d4c8 });
    for (let i = 0; i < 14; i++) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.29), paper);
      sheet.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      sheet.position.set(-4 + Math.random() * 8, 0.005 + Math.random() * 0.01, -3.5 + Math.random() * 5);
      s.add(sheet);
    }

    // The men who came in. They're not leaving.
    this.corpse(new THREE.Vector3(-2.4, 0, -1.6), 2.4, false);
    this.corpse(new THREE.Vector3(1.9, 0, -2.4), -0.5, true);
    this.corpse(new THREE.Vector3(-4.6, 0, -0.4), 1.1, false);

    // A dropped rifle by the nearest body
    const gunmetal = this.lam(0x1a1c20);
    const rifle = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.62), gunmetal);
    rifle.add(receiver);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), gunmetal);
    mag.position.set(0, -0.06, 0.05);
    rifle.add(mag);
    rifle.position.set(-1.6, 0.05, -1.1);
    rifle.rotation.set(Math.PI / 2, 0, 0.8);
    s.add(rifle);

    // The fluorescent above the shot — tired, humming, flickering
    const fixtureHousing = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.09, 0.36), this.lam(0x5a5e63));
    fixtureHousing.position.set(0.3, 3.2, -0.6);
    s.add(fixtureHousing);
    this.tubeMat = new THREE.MeshStandardMaterial({
      color: 0x9aa39c,
      emissive: new THREE.Color(0xd6e6da),
      emissiveIntensity: 1.6
    });
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.14), this.tubeMat);
    tube.position.set(0.3, 3.14, -0.6);
    s.add(tube);
    this.tubeLight = new THREE.PointLight(0xcfe3d6, 14, 9, 1.7);
    this.tubeLight.position.set(0.3, 3.05, -0.6);
    s.add(this.tubeLight);

    // Cinematic lighting: warm key from the side, cold rim from behind
    s.add(new THREE.AmbientLight(0x1c2430, 1.0));
    const key = new THREE.PointLight(0xffd9a0, 5, 8, 1.7);
    key.position.set(1.8, 1.9, 1.6);
    s.add(key);
    const rim = new THREE.PointLight(0x7ea8d8, 8, 7, 1.8);
    rim.position.set(-1.2, 2.2, -2.2);
    s.add(rim);

    // Low, slightly off-axis hero framing
    this.camera.position.set(-0.85, 1.25, 2.5);
    this.camera.lookAt(0.1, 1.25, 0);
  }

  /** A suited body on the floor with a pool under it. */
  private corpse(at: THREE.Vector3, yaw: number, faceDown: boolean): void {
    const s = this.scene;
    const suit = this.lam(0x15161a);
    const shirt = this.lam(0xe9e6df);
    const skin = this.lam(0xc59a76);
    const g = new THREE.Group();
    g.position.copy(at).setY(0.13);
    g.rotation.y = yaw;

    const torso = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.26, 0.6, 3, 0.07), suit);
    g.add(torso);
    if (!faceDown) {
      const shirtFront = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.4), shirt);
      shirtFront.rotation.x = -Math.PI / 2;
      shirtFront.position.set(0, 0.135, 0.02);
      g.add(shirtFront);
      // The wound that put him down
      const wound = new THREE.Mesh(new THREE.CircleGeometry(0.07, 10), new THREE.MeshBasicMaterial({ color: 0x4a0708 }));
      wound.rotation.x = -Math.PI / 2;
      wound.position.set(0.03, 0.14, 0.05);
      g.add(wound);
    }
    const head = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.2, 0.26, 3, 0.06), skin);
    head.position.set(0.06, -0.01, 0.46);
    head.rotation.z = faceDown ? 0.4 : -0.3;
    g.add(head);
    // Limbs sprawled
    const limb = (w: number, len: number, x: number, z: number, rot: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(w, len, 3, 8), mat);
      m.rotation.set(Math.PI / 2, 0, rot);
      m.position.set(x, -0.02, z);
      g.add(m);
    };
    limb(0.06, 0.34, -0.33, 0.1, 0.9, suit); // arm out
    limb(0.06, 0.3, 0.32, -0.05, -1.2, suit); // arm folded
    limb(0.08, 0.4, -0.12, -0.55, 0.25, suit); // legs
    limb(0.08, 0.42, 0.14, -0.58, -0.2, suit);
    s.add(g);

    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.5, 22), new THREE.MeshBasicMaterial({ color: 0x4a0708 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(at.x + 0.1, 0.004, at.z + 0.1);
    pool.scale.set(1, 0.7, 1);
    s.add(pool);
    for (let i = 0; i < 4; i++) {
      const spot = new THREE.Mesh(
        new THREE.CircleGeometry(0.03 + Math.random() * 0.06, 8),
        new THREE.MeshBasicMaterial({ color: 0x4a0708 })
      );
      spot.rotation.x = -Math.PI / 2;
      spot.position.set(at.x + (Math.random() - 0.5) * 1.6, 0.004, at.z + (Math.random() - 0.5) * 1.6);
      s.add(spot);
    }
  }

  // ----------------------------------------------------------------- Ravi

  private buildRavi(): void {
    const s = this.scene;
    this.ravi = new THREE.Group();
    this.ravi.position.set(0.1, 0, 0.1);
    this.ravi.rotation.y = 0.35; // three-quarter to camera

    const shirtMat = new THREE.MeshStandardMaterial({ color: 0x9db6c6, roughness: 0.9 });
    const trouser = this.lam(0x252a33);
    const skin = this.lam(0xc59a76);
    const shoe = this.lam(0x14161a);
    const hair = this.lam(0x14100c);

    // Legs planted wide
    for (const [sx, rz] of [
      [-0.13, 0.07],
      [0.14, -0.09]
    ] as const) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.3, 4, 10), trouser);
      thigh.position.set(sx, 0.62, 0);
      thigh.rotation.z = rz;
      this.ravi.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 10), trouser);
      shin.position.set(sx + rz * -2 * 0.15, 0.22, 0);
      this.ravi.add(shin);
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.08, 0.27, 3, 0.03), shoe);
      foot.position.set(sx + rz * -2 * 0.15, 0.04, -0.05);
      this.ravi.add(foot);
    }

    // Shirt torso — sleeves rolled, tie yanked loose, blood on it
    const torso = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.52, 0.25, 4, 0.08), shirtMat);
    torso.position.set(0, 1.06, 0);
    this.ravi.add(torso);
    const tie = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.3), this.lam(0x6b1a1a));
    tie.position.set(0.05, -0.02, -0.128);
    tie.rotation.y = Math.PI;
    tie.rotation.z = 0.18; // loosened, hanging crooked
    torso.add(tie);
    // Blood spatter across the shirt — someone else's
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(
        new THREE.CircleGeometry(0.02 + Math.random() * 0.035, 8),
        new THREE.MeshBasicMaterial({ color: 0x5a0a0c })
      );
      b.position.set(-0.12 + Math.random() * 0.22, -0.15 + Math.random() * 0.3, -0.127);
      b.rotation.y = Math.PI;
      torso.add(b);
    }
    // ID badge on a lanyard, because he still works here
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.09), this.lam(0xd8d4c8));
    badge.position.set(-0.1, -0.1, -0.13);
    badge.rotation.y = Math.PI;
    badge.rotation.z = -0.15;
    torso.add(badge);

    // Head — looking down at the weapon in his hands
    this.head = new THREE.Group();
    this.head.position.set(0, 1.47, 0);
    const skull = new THREE.Mesh(new RoundedBoxGeometry(0.23, 0.26, 0.23, 4, 0.07), skin);
    this.head.add(skull);
    const crop = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.07, 0.24, 3, 0.03), hair);
    crop.position.y = 0.12;
    this.head.add(crop);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.08, 10), skin);
    neck.position.y = -0.16;
    this.head.add(neck);
    this.head.rotation.x = 0.45; // chin down, eyes on the gun
    this.head.rotation.y = -0.15;
    this.ravi.add(this.head);

    // The shotgun, held across the chest — hands are children of the gun so
    // everything moves together as he turns it over
    this.gun = new THREE.Group();
    this.gun.position.set(0.02, 1.06, -0.3);
    this.gun.rotation.set(0.1, 0.9, -0.12); // across the body, muzzle screen-left

    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.4, metalness: 0.7 });
    const walnut = new THREE.MeshStandardMaterial({ color: 0x4d3a26, roughness: 0.8 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 12), steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.035, -0.28);
    this.gun.add(barrel);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 10), steel);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, -0.005, -0.25);
    this.gun.add(tube);
    const receiver = new THREE.Mesh(new RoundedBoxGeometry(0.055, 0.09, 0.24, 3, 0.015), steel);
    receiver.position.set(0, 0.01, 0.03);
    this.gun.add(receiver);
    const stock = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.11, 0.3, 3, 0.02), walnut);
    stock.position.set(0, -0.01, 0.26);
    stock.rotation.x = 0.12;
    this.gun.add(stock);
    this.pump = new THREE.Group();
    this.pump.position.set(0, -0.005, -0.22);
    const forend = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.16, 10), walnut);
    forend.rotation.x = Math.PI / 2;
    this.pump.add(forend);
    this.gun.add(this.pump);

    // Hands: right on the grip, left cradling the forend
    const handR = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.09, 0.09, 3, 0.025), skin);
    handR.position.set(0, -0.03, 0.12);
    this.gun.add(handR);
    const handL = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.08, 0.1, 3, 0.025), skin);
    handL.position.set(0, -0.04, 0);
    this.pump.add(handL);

    // Arms: rolled light-blue sleeves to the elbow, bare forearms to the hands
    const mkArm = (shoulder: THREE.Vector3, hand: THREE.Vector3) => {
      const elbow = shoulder.clone().lerp(hand, 0.5);
      elbow.y -= 0.1;
      const seg = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
        const len = a.distanceTo(b);
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.05, len - r), 3, 8), mat);
        m.position.copy(a).lerp(b, 0.5);
        m.lookAt(b);
        m.rotateX(Math.PI / 2);
        this.ravi.add(m);
      };
      seg(shoulder, elbow, 0.06, shirtMat); // rolled sleeve
      seg(elbow, hand, 0.05, skin); // forearm
    };
    // Hand positions in Ravi-local space (gun sits at z −0.3)
    mkArm(new THREE.Vector3(0.24, 1.32, 0), new THREE.Vector3(0.1, 1.02, -0.2));
    mkArm(new THREE.Vector3(-0.24, 1.32, 0), new THREE.Vector3(-0.12, 1.0, -0.32));

    this.ravi.add(this.gun);
    s.add(this.ravi);
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
    void dt;
    if (!this.musicStarted && this.ctx.audio.ready) {
      this.ctx.audio.startMenuMusic();
      this.musicStarted = true;
    }

    // Inspecting the weapon: a slow turn in the hands, a considering tilt,
    // and every few seconds he rides the pump back and lets it home.
    const sway = Math.sin(time * 0.5);
    this.gun.rotation.set(0.1 + Math.sin(time * 0.35) * 0.1, 0.9 + sway * 0.14, -0.12 + Math.sin(time * 0.27) * 0.08);
    this.gun.position.y = 1.06 + Math.sin(time * 0.8) * 0.012; // breathing
    const pumpCycle = time % 6;
    let slide = 0;
    if (pumpCycle > 4.4 && pumpCycle < 4.75) slide = (pumpCycle - 4.4) / 0.35; // draw it back
    else if (pumpCycle >= 4.75 && pumpCycle < 4.95) slide = 1 - (pumpCycle - 4.75) / 0.2; // snap home
    this.pump.position.z = -0.22 + slide * 0.09;
    // The head follows the weapon
    this.head.rotation.x = 0.45 + Math.sin(time * 0.35) * 0.04;
    this.head.rotation.y = -0.15 + sway * 0.08;
    // Whole figure breathes
    this.ravi.position.y = Math.sin(time * 0.8) * 0.006;

    // Tired fluorescent overhead
    const hum = 0.92 + 0.08 * Math.sin(time * 120);
    const sputter = Math.sin(time * 0.7) > 0.985 ? 0.5 : 1;
    this.tubeLight.intensity = 14 * hum * sputter;
    this.tubeMat.emissiveIntensity = 1.6 * hum * sputter;

    // Slow cinematic drift + mouse parallax
    const drift = Math.sin(time * 0.09) * 0.25;
    this.camera.position.set(-0.85 + drift + this.mouse.x * 0.1, 1.25 - this.mouse.y * 0.06, 2.5 - Math.sin(time * 0.07) * 0.15);
    this.camera.lookAt(0.1, 1.22, 0);
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.crt.render(renderer, this.scene, this.camera, performance.now() / 1000);
  }
}
