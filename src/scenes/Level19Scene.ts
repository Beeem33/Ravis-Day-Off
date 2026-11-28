import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level19Builder, type Level19Data, type GuardSpawn, parachutePack, HW, DOOR, P_COCKPIT, P_CONF, P_GALLEY } from '../environment/Level19Builder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { FPSPlayer } from '../entities/FPSPlayer';
import { Arsenal, loadoutFor } from '../entities/Arsenal';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { Enemy } from '../entities/Enemy';
import { EnemyAI } from '../entities/EnemyAI';
import { FPSHUD } from '../ui/FPSHUD';
import { DialogueBox } from '../ui/DialogueBox';
import { dataDrive } from '../environment/OfficeProps';
import { smooth, clamp01, yawPitchTo, wrapAngle, alongPath, pathLength } from './cutscene';

/**
 * Level19Scene — the boss's plane, at 41,000 feet.
 *
 *  1. Up out of the hold through a hatch in the aft galley floor. He's in
 *     the lounge, up front: get there, quietly. Eleven of his security on
 *     board, walking the suite, the conference room and the lounge; the
 *     knife (F) from behind, or the guns — and everyone near hears the guns.
 *  2. The lounge: his chair's empty, the cigar still going in the ashtray.
 *     On to the flight deck.
 *  3. The cockpit door: knock (E). The first officer opens it expecting
 *     coffee. The pilots work for him too.
 *  4. With nobody flying her she drops her nose: the alarm, the red lights,
 *     everything sliding forward. Ravi turns round, and right down the
 *     length of the plane the boss comes out of his bedroom — he's been
 *     hiding in there the whole time — with a parachute on his back. A
 *     finger for Ravi, and he's off into the galley; a cut back there as he
 *     hauls the door open, the wind tearing through, and he's gone.
 *  5. Run back down the plane in the gale to the locker of chutes by the
 *     open door: E. Into the harness, to the door, and out after him.
 *
 * Checkpoints: 0 the hatch, 1 the lounge's doorway (the suite and the
 * conference room behind him cleared), 2 the cockpit door, the boss gone.
 */

type Phase = 'intro' | 'play' | 'knock' | 'pilots' | 'slump' | 'dive' | 'reveal' | 'run' | 'gear' | 'out' | 'jump' | 'dead';

/** The captain's ragdoll, part by part, for the replay of him going over onto the controls. */
const RAG_PARTS = ['torso', 'pelvis', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR'];
/** The captain shot: how long it plays out live, and how slow the replay of it goes. */
const SLUMP_LIVE = 1.4;
const REPLAY_RATE = 0.35;

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/**
 * A pilot's peaked cap and his shoulder boards (`bars` gold stripes on each),
 * in the model's rest space: it faces −Z, the top of the head about 1.76 up.
 */
function pilotKit(e: Enemy, bars: number): void {
  const navy = new THREE.MeshStandardMaterial({ color: 0x141b2e, roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.25 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.3 });
  const cap = new THREE.Group();
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.1, 0.075, 20), navy);
  crown.position.y = 0.04;
  cap.add(crown);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.118, 0.012, 20), navy);
  top.position.y = 0.08;
  cap.add(top);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.102, 0.102, 0.026, 20), black);
  band.position.y = 0.013;
  cap.add(band);
  const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.008, 16, 1, false, Math.PI * 0.5, Math.PI), black);
  visor.position.set(0, 0.004, -0.04);
  visor.rotation.x = 0.25;
  visor.scale.set(1.05, 1, 0.8);
  cap.add(visor);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.026, 0.006), gold);
  badge.position.set(0, 0.04, -0.112);
  cap.add(badge);
  const braid = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.006, 0.004), gold);
  braid.position.set(0, 0.02, -0.104);
  cap.add(braid);
  cap.position.set(0, 1.705, -0.005);
  cap.rotation.x = -0.06;
  e.wear(cap, 'Head');
  for (const sx of [-1, 1]) {
    const board = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.13), black);
    board.add(b);
    for (let i = 0; i < bars; i++) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.008, 0.008), gold);
      g.position.z = -0.045 + i * 0.022;
      board.add(g);
    }
    board.position.set(sx * 0.16, 1.47, 0.0);
    board.rotation.z = sx * 0.28;
    board.rotation.y = Math.PI / 2;
    e.wear(board, 'UpperChest');
  }
}
const BossDir = new THREE.Vector3();
const BOSS_PITCH = 0.72;

interface Guard {
  e: Enemy;
  ai: EnemyAI;
  spawn: GuardSpawn;
  /** Seconds into his look-round, for a man stood at his post. */
  look: number;
}

/** A thing flying about the cabin: a glass, a cushion, a sheet of paper. */
interface Flier {
  o: THREE.Object3D;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  /** Light things go where the wind goes. */
  light: boolean;
}

export class Level19Scene extends CombatScene<Level19Data> {
  private arsenal!: Arsenal;
  private drink!: DrinkViewmodel;
  private hud!: FPSHUD;
  private dialogue!: DialogueBox;
  private guards: Guard[] = [];
  private remaining = 0;
  private phase: Phase = 'intro';
  private t = 0;
  private ui!: HTMLElement;
  private objective!: HTMLElement;
  private letterbox!: HTMLElement;
  private subtitle!: HTMLElement;
  private subT = 0;
  private fadeEl!: HTMLElement;
  private mark!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private clickHandler = (): void => this.onClick();

  private boss!: Enemy;
  private copilot!: Enemy;
  private captain!: Enemy;
  private captainUp = false;
  /** The first officer down: the captain's said his piece (he stays at the controls, flying her). */
  private captainPleaded = false;
  /** The captain going over onto his yoke: the live part recorded frame by frame, then played back slow. */
  private slumpFrames: { parts: number[][]; yoke: number }[] = [];
  private slumpReplay = -1;
  private yokeHit = -1;
  private yokeAngle = 0;
  /** In the dive: everything loose (and dead) drifting about the cabin, and the time it's been doing it. */
  private floating = false;
  private floatT = 0;
  /** The cut to the galley for the door: its own camera. */
  private cutCam = new THREE.PerspectiveCamera(50, 1, 0.05, 4000);
  private useCut = false;
  private env: THREE.Texture | null = null;

  // ---- what the plane is doing
  /** Nose down, radians: 0 in the cruise, to about 0.2 in the dive. */
  private pitchDown = 0;
  private pitchTarget = 0;
  private doorOpen = 0;
  private wind = 0;
  private alarm = 0;
  private fliers: Flier[] = [];
  private cabinBase: number[] = [];
  private hum: { setThrust(k: number): void; setDistance(m: number): void; stop(): void } | null = null;
  private roar: { setThrust(k: number): void; setDistance(m: number): void; stop(): void } | null = null;
  private klaxon: { set(k: number): void; stop(): void } | null = null;
  private smokeT = 0;
  private checkpoint = 0;
  private seenLounge = false;
  private knocked = false;
  private doorSwing = 0;
  private ownChute: THREE.Group | null = null;
  private static _a = new THREE.Vector3();
  private static _b = new THREE.Vector3();

  constructor(ctx: GameContext, private from = 0) {
    super(ctx);
    this.checkpoint = from;
  }

  // ================================================================ lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x9fc0e8);
    this.level = new Level19Builder().build();
    const L = this.level;
    this.scene.add(L.group, L.outside);
    this.world = this.createPhysicsWorld(L.colliders);

    // Something for the gold and the leather to shine with
    const pmrem = new THREE.PMREMGenerator(this.ctx.engine.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.3;
    this.cabinBase = L.cabinLights.map((l) => l.intensity);

    const cp = L.checkpoints[Math.min(this.from, L.checkpoints.length - 1)];
    this.player = new FPSPlayer(cp.pos.clone(), cp.yaw, input, audio, bus);
    this.ragdollOnDeath(() => (this.arsenal.held.stow < 0.5 ? this.arsenal.active : null));
    this.scene.add(this.player.camera);
    this.player.camera.far = 4000;
    this.player.camera.updateProjectionMatrix();

    this.particles = new ParticleManager(this.scene);
    this.decals = new BloodDecalSystem(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene);
    Enemy.flashPool = this.flashPool;

    this.drink = new DrinkViewmodel(this.player.camera);
    this.drink.onEvent = (e, i) => {
      if (e === 'crack') audio.canCrack();
      else if (e === 'gulp') audio.gulp(i);
      else if (e === 'heal') this.player.healFull();
      else if (e === 'crush') audio.canCrush();
      else if (e === 'toss') this.dropCan(this.drink.tossPose());
    };
    this.setupTakedown();
    this.arsenal = new Arsenal(
      {
        player: this.player,
        audio,
        bus,
        world: this.world,
        particles: this.particles,
        castBullet: (o, d) => this.castBullet(o, d, null),
        addDebris: (m, b) => this.addDebris(m, b),
        dropMagazine: (p) => this.dropMagazine(p)
      },
      loadoutFor('level19'),
      'pistol'
    );

    this.buildGuards();
    this.buildPilots();
    this.buildBoss();
    this.buildPapers();
    this.buildClutter();
    this.buildPaperStorm();
    this.buildYokeSolids();
    this.buildBottles();
    for (const o of L.loose) this.fliers.push({ o, v: new THREE.Vector3(), spin: new THREE.Vector3(), light: !!o.userData.cushion });

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, this.remaining, this.player.maxHealth);
    this.hud.show();
    this.hud.setAmmo(...this.arsenal.ammoReadout());
    this.dialogue = new DialogueBox(this.ctx.uiRoot, audio);
    this.buildUI();

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        for (const c of [this.player.camera, this.cutCam]) {
          c.aspect = window.innerWidth / window.innerHeight;
          c.updateProjectionMatrix();
        }
      }),
      bus.on(Events.PlayerDied, () => {
        this.phase = 'dead';
      })
    );
    this.cutCam.aspect = window.innerWidth / window.innerHeight;
    this.cutCam.updateProjectionMatrix();

    // The engines, through the walls: a deep steady roar, dulled
    this.hum = audio.jetEngine();
    this.hum.setThrust(0.75);
    this.hum.setDistance(55);

    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('click', this.clickHandler);

    if (this.from >= 2) this.startFromCockpit();
    else if (this.from === 1) this.handOver();
    else this.startIntro();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('click', this.clickHandler);
    this.hud.destroy();
    this.dialogue.destroy();
    for (const g of this.guards) g.ai.dispose();
    this.flashPool.dispose();
    this.ui.remove();
    this.hum?.stop();
    this.roar?.stop();
    this.klaxon?.stop();
    Enemy.flashPool = null;
    this.scene.environment = null;
    this.env?.dispose();
  }

  // ================================================================ building

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="l19-sub" style="position:absolute;left:50%;bottom:17%;transform:translateX(-50%);width:min(760px,88vw);text-align:center;font:600 17px/1.4 'Courier New',monospace;color:#f4ecd8;text-shadow:0 2px 6px #000,0 0 2px #000;opacity:0;transition:opacity .3s;pointer-events:none"></div>
      <div class="l19-mark" style="position:absolute;left:0;top:0;display:none;pointer-events:none;color:#ffd24a;font:700 12px/1 'Courier New',monospace;letter-spacing:2px;text-align:center;text-shadow:0 0 6px #000,0 0 2px #000;transform:translate(-50%,-50%)">
        <div class="l19-arrow" style="font-size:26px;line-height:26px">▼</div>
        <div class="l19-label" style="margin-top:4px;white-space:nowrap"></div>
      </div>
      <div class="l19-fade" style="position:absolute;inset:0;background:#000;opacity:0;pointer-events:none"></div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.subtitle = el.querySelector('.l19-sub')!;
    this.fadeEl = el.querySelector('.l19-fade')!;
    this.mark = el.querySelector('.l19-mark')!;
  }

  /**
   * After the boss has gone, where to go: a marker over the closet, then
   * over the open door — pinned to the edge of the screen, pointing, when
   * it's behind him or off to the side.
   */
  private updateMarker(): void {
    const L = this.level;
    const show = (this.phase === 'run' || this.phase === 'out') && this.player.alive && !this.inTakedown;
    if (!show) {
      if (this.mark.style.display !== 'none') this.mark.style.display = 'none';
      return;
    }
    const at = this.phase === 'run' ? V(HW - 0.4, 1.35, L.lockerAt.z) : V(-HW, 1.2, (DOOR.z0 + DOOR.z1) / 2);
    const label = this.phase === 'run' ? 'PARACHUTE' : 'JUMP';
    const cam = this.player.camera;
    cam.updateMatrixWorld(true);
    const dist = Math.round(this.player.position.distanceTo(at.clone().setY(0)));
    const v = at.clone().applyMatrix4(cam.matrixWorldInverse);
    const ndc = at.clone().project(cam);
    let x = ndc.x;
    let y = ndc.y;
    const behind = v.z > 0;
    let pinned = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.85;
    if (behind) {
      x = -x;
      y = -y;
    }
    if (pinned) {
      const k = 0.88 / Math.max(Math.abs(x), Math.abs(y) / 0.95, 1e-3);
      x *= k;
      y *= k;
      if (behind && Math.abs(x) < 0.5) {
        // Right behind him: off to whichever side is nearer round
        x = x < 0 ? -0.88 : 0.88;
        pinned = true;
      }
    }
    const w = this.ctx.uiRoot.clientWidth || window.innerWidth;
    const h = this.ctx.uiRoot.clientHeight || window.innerHeight;
    this.mark.style.display = 'block';
    this.mark.style.left = `${((x + 1) / 2) * w}px`;
    this.mark.style.top = `${((1 - y) / 2) * h}px`;
    const arrow = this.mark.firstElementChild as HTMLElement;
    arrow.textContent = !pinned ? '▼' : Math.abs(x) > Math.abs(y) ? (x > 0 ? '▶' : '◀') : y > 0 ? '▲' : '▼';
    (this.mark.lastElementChild as HTMLElement).textContent = `${label} ${dist}M`;
  }

  private setObjective(text: string): void {
    if (this.objective.textContent === text) return;
    this.objective.textContent = text;
    this.objective.classList.remove('show');
    void this.objective.offsetWidth;
    if (text) this.objective.classList.add('show');
  }

  /** A line said while he keeps playing: a subtitle that fades on its own. */
  private say(speaker: string, text: string, secs = 4): void {
    this.subtitle.innerHTML = `<span style="color:#e9c46a">${speaker}:</span> ${text}`;
    this.subtitle.style.opacity = '1';
    this.subT = secs;
    this.ctx.audio.dialogueBlip(speaker === 'RAVI' ? 1 : 0.8);
  }

  private cinema(on: boolean): void {
    this.letterbox.classList.toggle('open', !on);
    this.hud.setCinematic(on);
    if (on) this.ctx.input.exitPointerLock();
    else this.ctx.input.requestPointerLock();
  }

  private buildGuards(): void {
    const L = this.level;
    const { bus, audio } = this.ctx;
    L.guards.forEach((sp, i) => {
      // Past a checkpoint, the men behind it are already down: dead where they stood
      if (this.from >= 2 || (this.from >= 1 && (sp.section === 'suite' || sp.section === 'conf'))) {
        const body = new Enemy(sp.pos.clone(), sp.yaw, i + 21, { name: 'BOSS SECURITY' });
        this.scene.add(body.root);
        for (const p of body.parts) L.shootables.push(p);
        const dir = new THREE.Vector3(Math.sin(i * 1.7), -0.2, Math.cos(i * 1.7)).normalize();
        body.die(sp.pos.clone().setY(1.2), dir, this.world, i % 3 === 0 ? 'head' : 'torso');
        this.corpses.push(body);
        return;
      }
      const e = new Enemy(sp.pos.clone(), sp.yaw, i + 21, { name: 'BOSS SECURITY' });
      this.scene.add(e.root);
      for (const p of e.parts) L.shootables.push(p);
      const ai = new EnemyAI(e, {
        player: this.player,
        waypoints: L.waypoints,
        occluders: L.occluders,
        colliders: L.colliders,
        bus,
        audio,
        enemyFire: (x) => this.enemyFire(x)
      });
      if (sp.zone > 0) ai.setPatrolZone(sp.pos, sp.zone);
      // No ducking from cover to cover in here: in a cabin this full of
      // furniture the spot he picks is one he can't get to, and he'd walk
      // round in circles trying instead of shooting. Stand and fight.
      ai.holdGround();
      this.guards.push({ e, ai, spawn: sp, look: i * 1.7 });
    });
    this.remaining = this.guards.length;
    // The dead laid out on the floor before the first frame
    if (this.corpses.length) {
      for (let f = 0; f < 100; f++) {
        this.world.step(1 / 60);
        for (const c of this.corpses) c.update(1 / 60);
      }
    }
  }
  private corpses: Enemy[] = [];

  private buildPilots(): void {
    const L = this.level;
    // Both sat at the controls, until the knock gets the first officer up
    this.captain = new Enemy(L.pilotSeats[0].clone().setY(0), 0, 3, { name: 'CAPTAIN', civilian: true });
    this.copilot = new Enemy(L.pilotSeats[1].clone().setY(0), 0, 5, { name: 'FIRST OFFICER', civilian: true });
    for (const p of [this.captain, this.copilot]) {
      // Dressed as the staff are (white shirt, dark trousers) with the cap off,
      // then the airline's: a peaked cap and the stripes on the shoulders. Not
      // civilians for the knife, though: they're his, and they're the job
      p.restyleCrew({ cap: false, shirt: 0xf7f7f4 });
      pilotKit(p, p === this.captain ? 4 : 3);
      (p as { civilian: boolean }).civilian = false;
      p.hideWeapon();
      p.setSitting(true, true);
      this.scene.add(p.root);
      for (const part of p.parts) L.shootables.push(part);
    }
    if (this.from >= 2) {
      for (const p of [this.captain, this.copilot]) {
        p.root.visible = false;
        p.alive = false;
      }
    }
  }

  private buildBoss(): void {
    const L = this.level;
    const b = new Enemy(L.bossHide.clone(), Math.PI, 7, { name: 'THE BOSS', boss: true });
    b.holdProp(dataDrive(), 0.045);
    this.scene.add(b.root);
    b.root.visible = false;
    // His chute, on his back
    const pack = parachutePack();
    pack.position.set(0, 1.25, 0.19);
    pack.rotation.y = Math.PI;
    b.wear(pack, 'UpperChest');
    this.boss = b;
  }

  /** Paper, where it would be: on the conference table, the security desk, the study's desk. */
  private buildPapers(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xf5f3ee, roughness: 0.9, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(0.21, 0.297);
    const spots: [number, number, number][] = [];
    for (let i = 0; i < 10; i++) spots.push([(i % 2 ? 0.4 : -0.4) + (Math.random() - 0.5) * 0.2, 0.795, -1.4 + Math.floor(i / 2) * 1.6 + Math.random() * 0.3]);
    for (let i = 0; i < 5; i++) spots.push([2.25 + Math.random() * 0.2, 0.815, 5.0 + i * 0.3]);
    for (let i = 0; i < 5; i++) spots.push([2.35, 0.755, 11.8 + i * 0.25]);
    for (const [x, y, z] of spots) {
      const p = new THREE.Mesh(geo, mat);
      p.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
      p.position.set(x, y + Math.random() * 0.004, z);
      this.scene.add(p);
      this.fliers.push({ o: p, v: new THREE.Vector3(), spin: new THREE.Vector3(), light: true });
    }
  }

  /**
   * Everything else loose about the cabin that the dive will lift: cups and
   * plates in the galleys, a laptop and phones on the conference table,
   * bottles on the bar, books, pillows on the beds, and more paper.
   */
  private buildClutter(): void {
    const std = (c: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
    const china = std(0xf4f1ea, { roughness: 0.3 });
    const black = std(0x16171a, { roughness: 0.35 });
    const glass = std(0x3a6a3a, { roughness: 0.1, transparent: true, opacity: 0.85 });
    const amber = std(0x7a4210, { roughness: 0.1, transparent: true, opacity: 0.85 });
    const linen = std(0xf6f3ec, { roughness: 0.9 });
    const books = [std(0x7a1a1a), std(0x1a3a6a), std(0x2a4a2a), std(0x5a4a2a)];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, light = false): void => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = Math.random() * Math.PI;
      this.scene.add(m);
      this.fliers.push({ o: m, v: new THREE.Vector3(), spin: new THREE.Vector3(), light });
    };
    const cup = new THREE.CylinderGeometry(0.04, 0.032, 0.09, 12);
    const plate = new THREE.CylinderGeometry(0.11, 0.09, 0.015, 18);
    const bottle = new THREE.CylinderGeometry(0.035, 0.04, 0.3, 10);
    const book = new THREE.BoxGeometry(0.16, 0.03, 0.23);
    const phone = new THREE.BoxGeometry(0.075, 0.009, 0.15);
    const laptop = new THREE.BoxGeometry(0.33, 0.02, 0.23);
    const pillow = new THREE.BoxGeometry(0.5, 0.13, 0.32);
    const sheet = new THREE.PlaneGeometry(0.21, 0.297);
    // The aft galley's counter and the forward one
    for (let i = 0; i < 5; i++) add(i % 2 ? plate : cup, china, -1.3 + i * 0.55, 1.03, 29.45);
    for (let i = 0; i < 4; i++) add(cup, china, -2.35, 1.03, -26.3 + i * 0.45);
    // The conference table: a laptop, phones, a water bottle or two
    add(laptop, black, -0.3, 0.8, 0.6);
    add(laptop, black, 0.3, 0.8, 3.2);
    for (const [x, z] of [[-0.35, -0.9], [0.4, 1.7], [-0.4, 4.1]] as const) add(phone, black, x, 0.8, z);
    for (const z of [0.0, 2.4]) add(bottle, glass, 0, 0.94, z);
    // (the bar's own bottles are the builder's: they can be shot)
    void amber;
    // More of everything, the length of the plane: magazines, glasses, napkins, a headset, cushions, playing cards
    const mag = new THREE.BoxGeometry(0.21, 0.006, 0.28);
    const tumbler = new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10);
    const napkin = new THREE.PlaneGeometry(0.2, 0.2);
    const card = new THREE.PlaneGeometry(0.06, 0.09);
    const cushion = new THREE.BoxGeometry(0.4, 0.12, 0.4);
    const headset = new THREE.TorusGeometry(0.08, 0.012, 6, 14, Math.PI);
    const mags = [std(0xc0392b), std(0x2c6fbb), std(0xe5c34a), std(0x2b2b2b)];
    const cushions = [std(0x8a6a4a, { roughness: 0.9 }), std(0x2b3a55, { roughness: 0.9 }), std(0xd8cdb8, { roughness: 0.9 })];
    const glassy = std(0xdfe8ee, { roughness: 0.05, transparent: true, opacity: 0.5 });
    const red = std(0xb01818, { roughness: 0.6, side: THREE.DoubleSide });
    const white = std(0xf7f7f4, { roughness: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < 46; i++) {
      const z = -26 + Math.random() * 54;
      const x = (Math.random() - 0.5) * 3.6;
      const y = 0.45 + Math.random() * 0.4;
      switch (i % 6) {
        case 0:
          add(mag, mags[i % 4], x, y, z, true);
          break;
        case 1:
          add(tumbler, glassy, x, y, z);
          break;
        case 2:
          add(napkin, white, x, y, z, true);
          break;
        case 3:
          add(card, i % 12 === 3 ? red : white, x, y, z, true);
          break;
        case 4:
          add(cushion, cushions[i % 3], x, y, z, true);
          break;
        default:
          add(headset, black, x, y, z);
      }
    }
    // Books on the credenza and the study's desk
    for (let i = 0; i < 4; i++) add(book, books[i], -2.5, 0.83 + i * 0.03, 3.8 + (i % 2) * 0.1);
    for (let i = 0; i < 3; i++) add(book, books[(i + 1) % 4], 2.35, 0.77 + i * 0.03, 13.0);
    // Pillows off the beds
    add(pillow, linen, -2.1, 0.75, 17.0, true);
    add(pillow, linen, 1.9, 0.75, 21.1, true);
    // And paper: a stack blown off every surface
    const mat = new THREE.MeshStandardMaterial({ color: 0xf5f3ee, roughness: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < 26; i++) {
      const p = new THREE.Mesh(sheet, mat);
      p.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
      const spots: [number, number, number][] = [[0, 0.8, 1.4], [-2.5, 0.84, 4.6], [2.35, 0.79, 6], [1.45, 1.14, -9.5], [-1.15, 0.47, -16.8], [-1.15, 0.47, -9.6]];
      const [x, y, z] = spots[i % spots.length];
      p.position.set(x + (Math.random() - 0.5) * 0.5, y + i * 0.0005, z + (Math.random() - 0.5) * 1.2);
      this.scene.add(p);
      this.fliers.push({ o: p, v: new THREE.Vector3(), spin: new THREE.Vector3(), light: true });
    }
  }

  /** Paper everywhere: off every desk and table the length of the plane, for the dive to lift. */
  private buildPaperStorm(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xf5f3ee, roughness: 0.9, side: THREE.DoubleSide });
    const ruled = new THREE.MeshStandardMaterial({ color: 0xe8edf6, roughness: 0.9, side: THREE.DoubleSide });
    const sheet = new THREE.PlaneGeometry(0.21, 0.297);
    for (let i = 0; i < 70; i++) {
      const p = new THREE.Mesh(sheet, i % 4 ? mat : ruled);
      p.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
      p.position.set((Math.random() - 0.5) * 4.2, 0.03 + Math.random() * 0.02, -27 + Math.random() * 55);
      this.scene.add(p);
      this.fliers.push({ o: p, v: new THREE.Vector3(), spin: new THREE.Vector3(), light: true });
    }
  }

  /**
   * The control columns as solids, so the captain's weight lands on his and
   * doesn't go through it. And the pilots' seats as what they are to a body
   * (a pan and a back), not the tall blocks that keep the player out of
   * them — a pilot dying in one starts inside that block, and it threw him
   * up out of the seat.
   */
  private buildYokeSolids(): void {
    for (const s of this.level.pilotSeats) {
      for (const b of [...this.world.bodies]) {
        if (b.type !== CANNON.Body.STATIC || b.shapes.length !== 1 || !(b.shapes[0] instanceof CANNON.Box)) continue;
        const h = (b.shapes[0] as CANNON.Box).halfExtents;
        if (Math.abs(b.position.x - s.x) < 0.05 && Math.abs(b.position.z - (s.z + 0.075)) < 0.05 && Math.abs(h.y - 0.65) < 0.02) this.world.removeBody(b);
      }
      const seat = new CANNON.Body({ type: CANNON.Body.STATIC });
      seat.addShape(new CANNON.Box(new CANNON.Vec3(0.27, 0.21, 0.27)), new CANNON.Vec3(0, 0.21, 0));
      seat.addShape(new CANNON.Box(new CANNON.Vec3(0.27, 0.36, 0.06)), new CANNON.Vec3(0, 0.82, 0.38));
      seat.position.set(s.x, 0, s.z);
      this.world.addBody(seat);
    }
    for (const y of this.level.yokes) {
      const b = new CANNON.Body({ type: CANNON.Body.STATIC });
      b.addShape(new CANNON.Box(new CANNON.Vec3(0.2, 0.1, 0.06)), new CANNON.Vec3(0, 0.68, 0));
      b.addShape(new CANNON.Box(new CANNON.Vec3(0.05, 0.31, 0.05)), new CANNON.Vec3(0, 0.31, 0));
      b.position.set(y.position.x, y.position.y, y.position.z);
      this.world.addBody(b);
    }
  }

  /** The bar's bottles: each one shootable, in pieces when it's hit. */
  private buildBottles(): void {
    const L = this.level;
    for (const b of L.barBottles) {
      L.shootables.push(b);
      b.userData.onShot = (at: THREE.Vector3, dir: THREE.Vector3): void => this.breakBottle(b, at, dir);
    }
  }

  private breakBottle(b: THREE.Mesh, at: THREE.Vector3, dir: THREE.Vector3): void {
    if (!b.visible) return;
    b.visible = false;
    const d = at.distanceTo(this.player.position);
    this.particles.glassShards(at, dir, 0);
    this.particles.glassShards(at, Level19Scene._a.set(-dir.x, 0.6, -dir.z), 0);
    // What was in it, everywhere
    const hsl = { h: 0, s: 0, l: 0 };
    (b.material as THREE.MeshStandardMaterial).color.getHSL(hsl);
    this.particles.bloodSpray(at, dir, false, 0, hsl.h === 0.995 ? 0.99 : hsl.h);
    this.ctx.audio.glassShatter(d);
    this.ctx.bus.emit(Events.Sound, { position: at.clone(), radius: 14, kind: 'glass' });
  }

  /**
   * Into the dive: as near nothing as makes no difference. The dead and
   * everything loose come up off the floor and drift about the cabin — not
   * up through the roof, not pinned to it: floating, turning, wandering in
   * the air the plane's falling through.
   */
  private weightless(): void {
    this.world.gravity.set(0, 0.3, -0.5);
    this.floating = true;
    for (const b of this.world.bodies) if (b.mass > 0) b.wakeUp();
  }

  /** A step of the drift: each body pulled gently toward the middle of the cabin's height, stirred by the air, slowed by it. */
  private floatBodies(dt: number): void {
    if (!this.floating || !(dt > 0)) return;
    this.floatT += dt;
    const t = this.floatT;
    const f = new CANNON.Vec3();
    for (const b of this.world.bodies) {
      if (b.type !== CANNON.Body.DYNAMIC || b.mass <= 0) continue;
      b.wakeUp();
      const m = b.mass;
      const k = b.id * 1.37;
      // Where it wants to be: somewhere between knee and head height, wandering
      const want = 1.15 + 0.55 * Math.sin(t * 0.45 + k);
      f.set(Math.sin(t * 0.8 + k * 2.1) * 1.6 * m, ((want - b.position.y) * 2.4 + Math.sin(t * 1.3 + k) * 0.8) * m, Math.cos(t * 0.6 + k * 0.7) * 1.4 * m);
      b.applyForce(f, b.position);
      // Air: it doesn't build up speed, it drifts
      const drag = Math.exp(-dt * 0.9);
      b.velocity.scale(drag, b.velocity);
      b.angularVelocity.scale(Math.exp(-dt * 0.4), b.angularVelocity);
      // A slow tumble of its own
      if (b.angularVelocity.lengthSquared() < 0.3) b.angularVelocity.set(Math.sin(k) * 0.6, Math.cos(k) * 0.6, Math.sin(k * 1.7) * 0.6);
    }
  }

  // ================================================================ beats

  /** Up the ladder out of the hold: the camera comes up through the hatch. */
  private startIntro(): void {
    this.phase = 'intro';
    this.t = 0;
    this.player.cinematic = true;
    this.cinema(true);
    this.setObjective('');
  }

  private updateIntro(dt: number): void {
    const L = this.level;
    this.t += dt;
    const t = this.t;
    // Up the ladder out of the hold, facing it, looking up at the light; at
    // the top, round, and a step off onto the galley floor
    const up = smooth((t - 0.3) / 3.0);
    const step = smooth((t - 2.8) / 1.1);
    const turn = smooth((t - 2.5) / 1.5);
    const p = this.player;
    p.position.set(L.hatch.x + (1.15 - L.hatch.x) * step, -2.6 * (1 - up), L.hatch.z + (27.3 - L.hatch.z) * step);
    p.yaw = Math.PI - 0.15 + wrapAngle(0.05 - (Math.PI - 0.15)) * turn;
    p.pitch = 0.75 * (1 - smooth((t - 1.9) / 1.4)) - 0.04 * turn;
    for (const r of [0.5, 1.15, 1.8, 2.4]) if (t > r && t - dt <= r) this.ctx.audio.ladderRung();
    if (t > 4.0 && t - dt <= 4.0) {
      this.dialogue.play(
        [
          { speaker: 'RAVI', text: 'Eleven hours in the hold, next to his golf clubs. My legs have gone to sleep.', pitch: 1.0 },
          { speaker: 'RAVI', text: 'He will be up front, in the lounge. And his security will be everywhere between here and there. Quietly, Ravi.', pitch: 1.0 }
        ],
        () => this.handOver()
      );
    }
  }

  private handOver(): void {
    this.phase = 'play';
    this.player.cinematic = false;
    this.player.position.y = 0;
    this.cinema(false);
    this.setObjective(this.from >= 1 ? 'THE LOUNGE — FIND THE BOSS' : 'FIND THE BOSS — THE LOUNGE, UP FRONT');
  }

  /** Past the boss's exit: the door open, the gale, the alarms. Straight into the run. */
  private startFromCockpit(): void {
    this.knocked = true;
    this.doorSwing = 1;
    this.level.cockpitDoor.collider.disabled = true;
    this.level.cockpitDoor.pivot.rotation.y = 1.45;
    this.pitchDown = this.pitchTarget = 0.2;
    this.weightless();
    this.alarm = 1;
    this.openAftDoor(true);
    this.updateAftDoorPose();
    this.startRun();
  }

  /** The cockpit door, knocked on. */
  private knock(): void {
    this.knocked = true;
    this.phase = 'knock';
    this.t = 0;
    this.ctx.audio.knock(0, 0.8);
    this.ctx.audio.knock(0.22, 0.8);
    this.ctx.audio.knock(0.44, 0.9);
    this.setObjective('');
    this.hud.setPrompt(null);
  }

  private updateKnock(dt: number): void {
    this.t += dt;
    const L = this.level;
    // A second, then the lock, and the first officer's there with the door open
    if (this.t > 1.2 && this.doorSwing === 0) {
      this.ctx.audio.doorOpen();
      this.copilot.setSitting(false, true);
      this.copilot.position.set(0.1, 0, P_COCKPIT - 0.75);
      this.copilot.yaw = Math.PI;
      this.copilot.root.rotation.y = Math.PI;
    }
    if (this.t > 1.2) this.doorSwing = Math.min(1, this.doorSwing + dt * 2.2);
    L.cockpitDoor.pivot.rotation.y = 1.45 * smooth(this.doorSwing);
    if (this.doorSwing >= 1 && !L.cockpitDoor.collider.disabled) {
      L.cockpitDoor.collider.disabled = true;
      this.say('FIRST OFFICER', 'Finally. Two sugars, I said two — ...you are not catering.', 4.5);
      this.copilot.setScared();
      this.copilot.setHandsUp(true);
      this.phase = 'pilots';
      this.setObjective('THE PILOTS — THEY WORK FOR HIM TOO');
    }
  }

  private updatePilots(dt: number): void {
    // The first officer backs off into the cockpit; once he's down the captain gets up out of his seat
    if (this.copilot.alive && !this.copilot.beingExecuted) {
      this.copilot.position.z = Math.max(P_COCKPIT - 1.5, this.copilot.position.z - dt * 0.4);
      this.copilot.faceToward(this.player.position, dt, 4);
      this.copilot.setWalk(this.copilot.position.z > P_COCKPIT - 1.5 ? 0.25 : 0);
    }
    // The first officer down: the captain stays where he is, hands on the controls, flying her — and says so
    if (!this.copilot.alive && this.captain.alive && !this.captainPleaded) {
      this.captainPleaded = true;
      this.captain.setScared();
      this.say('CAPTAIN', 'Easy — easy! I am the one flying this thing! You shoot me, we ALL go down!', 4);
    }
    if (this.captain.alive) this.captain.setHeadLook(this.captainPleaded ? this.player.camera.getWorldPosition(Level19Scene._b) : null);
  }

  /**
   * The captain shot in his seat: he goes forward over the controls. The
   * next second and a half is recorded as it happens, then shown again
   * from the right-hand seat, slow — his weight going onto the column,
   * the column going forward — and the nose goes down.
   */
  private startSlump(): void {
    this.phase = 'slump';
    this.t = 0;
    this.slumpFrames = [];
    this.slumpReplay = -1;
    this.yokeHit = -1;
    this.yokeAngle = 0;
    this.setObjective('');
    this.hud.setPrompt(null);
    // Over onto the column in front of him
    this.captain.launch(V(0, 0.3, -2.4));
  }

  private updateSlump(dt: number): void {
    const L = this.level;
    const yokes = L.yokes;
    const parts = RAG_PARTS.map((n) => this.captain.ragdollPart(n));
    if (this.slumpReplay < 0) {
      // Live: his weight coming forward; on the column, it goes over with him
      this.t += dt;
      const yoke = yokes[0];
      const top = Level19Scene._a.set(yoke.position.x, yoke.position.y + 0.66, yoke.position.z);
      const torso = this.captain.ragdollPart('torso');
      const head = this.captain.ragdollPart('head');
      const near = (b: CANNON.Body | null): boolean => !!b && Math.hypot(b.position.x - top.x, b.position.y - top.y, b.position.z - top.z) < 0.42;
      if (this.yokeHit < 0 && (near(torso) || near(head) || this.t > 0.55)) {
        this.yokeHit = this.slumpFrames.length;
        this.ctx.audio.bodyThud(1.2);
        this.ctx.audio.punchImpact(false);
      }
      if (this.yokeHit >= 0) this.yokeAngle = Math.min(0.5, this.yokeAngle + dt * 2.6);
      for (const y of yokes) y.rotation.x = -this.yokeAngle;
      this.slumpFrames.push({ parts: parts.map((b) => (b ? [b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w] : [])), yoke: this.yokeAngle });
      if (this.t >= SLUMP_LIVE) {
        // The replay: from the right-hand seat, slow
        this.slumpReplay = 0;
        this.useCut = true;
        this.cinema(true);
        this.player.cinematic = true;
        // From up by the glareshield on the right, looking back across the columns at him
        const seat = L.pilotSeats[0];
        this.cutCam.fov = 52;
        this.cutCam.aspect = window.innerWidth / window.innerHeight;
        this.cutCam.updateProjectionMatrix();
        this.cutCam.position.set(seat.x + 1.0, 1.32, seat.z - 1.15);
        this.cutCam.lookAt(seat.x, 0.85, seat.z - 0.35);
      }
      return;
    }
    // Playing it back
    this.slumpReplay += dt * REPLAY_RATE;
    const i = Math.min(this.slumpFrames.length - 1, Math.floor(this.slumpReplay * 60));
    const fr = this.slumpFrames[i];
    parts.forEach((b, k) => {
      const s = fr.parts[k];
      if (!b || !s || s.length < 7) return;
      b.position.set(s[0], s[1], s[2]);
      b.quaternion.set(s[3], s[4], s[5], s[6]);
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
    });
    for (const y of yokes) y.rotation.x = -fr.yoke;
    // The thump onto the column, again, and the autopilot letting go
    if (i === this.yokeHit && this.yokeHit >= 0) {
      this.yokeHit = -2;
      this.ctx.audio.bodyThud(1.2);
      for (const [d, k] of [[0, 0], [260, 1], [520, 2]] as const) window.setTimeout(() => this.ctx.audio.uiBeep(k !== 1), d);
    }
    // A slow push in on him as it plays
    const seat = L.pilotSeats[0];
    this.cutCam.position.lerp(Level19Scene._a.set(seat.x + 0.75, 1.24, seat.z - 1.05), Math.min(1, dt * 0.6));
    this.cutCam.lookAt(seat.x, 0.85, seat.z - 0.35);
    if (this.slumpReplay * 60 >= this.slumpFrames.length + 18) {
      // Back to his eyes, and down she goes
      this.useCut = false;
      this.cinema(false);
      this.player.cinematic = false;
      for (const y of yokes) y.rotation.x = -0.5;
      for (const b of parts) b?.wakeUp();
      this.startDive();
    }
  }

  /** Nobody at the controls: she drops her nose. */
  private startDive(): void {
    this.weightless();
    this.phase = 'dive';
    this.t = 0;
    this.pitchTarget = 0.2;
    this.klaxon = this.ctx.audio.klaxonLoop();
    this.klaxon.set(0.5);
    this.setObjective('');
    this.say('RAVI', '…Ah. Who is flying the plane?', 3);
  }

  private updateDive(dt: number): void {
    this.t += dt;
    if (this.t > 2.8 && !this.inTakedown) this.startReveal();
  }

  // ---- the reveal: down the length of the plane, the boss, then the cut to the door

  private revealT = 0;
  private revealFrom = { yaw: 0, pitch: 0 };
  private bossRunS = 0;
  private bossLine = false;
  private bossGone = false;

  private startReveal(): void {
    this.phase = 'reveal';
    this.revealT = 0;
    this.player.cinematic = true;
    this.cinema(true);
    this.revealFrom = { yaw: this.player.yaw, pitch: this.player.pitch };
    this.boss.root.visible = true;
    this.boss.position.copy(this.level.bossRun[0]);
    this.bossRunS = 0;
  }

  /**
   *  0.0  he turns round to look back down the plane, a step into the doorway
   *  1.2  the view narrows down the aisle: the suite's corridor at the far end
   *  2.0  the boss comes out of his bedroom, the chute on his back
   *  3.4  he sees Ravi: the finger, the lines (waits on the clicks)
   *  8.3  off into the galley — then the cut there: the door, the wind, out he goes
   */
  private updateReveal(dt: number): void {
    const L = this.level;
    const p = this.player;
    const b = this.boss;
    this.revealT += dt;
    const t = this.revealT;
    const cam = p.camera;
    if (!this.useCut) {
      p.position.lerp(V(0, 0, P_COCKPIT + 0.9), Math.min(1, dt * 3));
      const k = smooth(t / 1.3);
      p.yaw = this.revealFrom.yaw + wrapAngle(Math.PI - this.revealFrom.yaw) * k;
      p.pitch = this.revealFrom.pitch * (1 - k) - 0.008 * k;
      const zoom = smooth((t - 1.2) / 1.1);
      cam.fov = 74 + (5.2 - 74) * zoom;
      cam.updateProjectionMatrix();
    }
    const run = L.bossRun;
    if (t > 2.0 && t < 3.4) {
      this.bossRunS += dt * 1.5;
      alongPath(run.slice(0, 3), this.bossRunS, b.position, BossDir);
      b.faceToward(Level19Scene._a.copy(b.position).add(BossDir), dt, 8);
      b.setWalk(0.8);
    } else if (t >= 3.4 && t < 8.3) {
      b.setWalk(0);
      b.faceToward(p.position, dt, 6);
      if (!this.bossLine) {
        this.bossLine = true;
        b.setMiddleFingers(false, true);
        b.speaking = true;
        this.dialogue.play(
          [
            { speaker: 'THE BOSS', text: 'Ravi! All the way up to the flight deck. Consider this your exit interview.', pitch: BOSS_PITCH },
            { speaker: 'THE BOSS', text: 'The plane is all yours. Enjoy the descent.', pitch: BOSS_PITCH }
          ],
          () => {
            this.revealT = Math.max(this.revealT, 8.3);
            b.setMiddleFingers(false, false);
            b.speaking = false;
          }
        );
      }
      if (this.dialogue.isActive) this.revealT = Math.min(this.revealT, 8.2);
    } else if (t >= 8.3 && t < 9.3) {
      // Off down the corridor into the galley, at a run
      this.bossRunS += dt * 3.4;
      alongPath(run, this.bossRunS, b.position, BossDir);
      b.faceToward(Level19Scene._a.copy(b.position).add(BossDir), dt, 10);
      b.setWalk(1);
      b.setRun(true);
    } else if (t >= 9.3) {
      if (!this.useCut) {
        this.useCut = true;
        cam.fov = 74;
        cam.updateProjectionMatrix();
        this.bossRunS = Math.max(this.bossRunS, pathLength(run.slice(0, 4)));
      }
      this.updateDoorShot(dt, t - 9.3);
    }
  }

  /**
   * The galley, from by the carts: he gets to the door, hauls the handle,
   * the plug comes in and swings out, and the cabin empties itself into the
   * sky. He turns, a finger for the cabin, and goes backwards out of it.
   */
  private updateDoorShot(dt: number, s: number): void {
    const L = this.level;
    const b = this.boss;
    const run = L.bossRun;
    const len = pathLength(run);
    const cam = this.cutCam;
    // A slow push in from by the carts; once he's at the door and turned to
    // face in, round in front of him, the open door and the sky behind him
    cam.position.lerpVectors(V(1.75, 1.62, 28.75), V(1.15, 1.52, 27.7), smooth(s / 6));
    const look = V(-2.2, 1.1, 25.5);
    const front = this.doorShotAt > 0 ? smooth((s - this.doorShotAt - 1.5) / 1.1) : 0;
    if (front > 0) {
      cam.position.lerp(V(0.35, 1.45, 25.95), front);
      look.lerp(V(-2.05, 1.25, 25.6), front);
    }
    cam.lookAt(look);
    const j = 0.006 * (1 + this.wind * 3);
    cam.position.x += (Math.random() - 0.5) * j;
    cam.position.y += (Math.random() - 0.5) * j;
    if (this.bossRunS < len) {
      this.bossRunS += dt * 3.0;
      alongPath(run, this.bossRunS, b.position, BossDir);
      b.faceToward(Level19Scene._a.copy(b.position).add(BossDir), dt, 10);
      b.setWalk(1);
      this.doorShotAt = s;
      return;
    }
    const u = s - this.doorShotAt;
    b.setRun(false);
    b.setWalk(0);
    if (u < 0.9) {
      b.faceToward(V(-HW - 1, 0, b.position.z), dt, 8);
      return;
    }
    if (this.doorOpen === 0) this.openAftDoor(false);
    const zc = (DOOR.z0 + DOOR.z1) / 2;
    if (u > 1.9) {
      // Square in the doorway, his back to the sky, facing into the cabin:
      // both middle fingers up for whoever's watching, and he keeps them up
      b.position.z += (zc - b.position.z) * Math.min(1, dt * 6);
      if (!this.bossGone) b.faceToward(V(HW, 0, zc), dt, 6);
    }
    if (u > 2.3) {
      // Both hands come up either side of his face and give it to the cabin, pumping
      const a = smooth((u - 2.3) / 0.35);
      const pump = Math.sin(u * 10) * 0.045 * a;
      const P = this.flipPose;
      P.handL!.set(-0.2, 0.9, -0.15).lerp(Level19Scene._a.set(-0.42, 1.62 + pump, -0.3), a);
      P.handR!.set(0.2, 0.9, -0.15).lerp(Level19Scene._a.set(0.42, 1.62 - pump, -0.3), a);
      P.lean = 0.04 * Math.sin(u * 5) * a;
      b.freeHands = true;
      b.pose = P;
      b.setMiddleFingers(a > 0.6, a > 0.6);
    }
    if (u >= 3.6) {
      // And out backwards: a lean back, a little hop off the sill, and he
      // tips over away from the plane, fingers up all the way
      if (!this.bossGone) {
        this.bossGone = true;
        this.ctx.audio.kickWhoosh();
        this.bossLeap = b.position.x;
        b.root.rotation.order = 'YXZ';
      }
      const w = u - 3.6;
      b.setWalk(0);
      b.position.x = this.bossLeap - (w < 0.35 ? w * 0.4 : 0.14 + (w - 0.35) * 2.4 + (w - 0.35) * (w - 0.35) * 2);
      if (w > 0.35) {
        const h = w - 0.35;
        // A hop up off the sill, then gone
        b.position.y = 0.35 * h * 4 - 0.5 * 26 * h * h;
      }
      b.root.rotation.x = Math.min(0.25, w * 0.7) + Math.max(0, w - 0.35) * 2.6;
    }
    if (b.position.y < -3) b.root.visible = false;
    if (u > 5.0) {
      b.root.visible = false;
      this.endReveal();
    }
  }
  private bossLeap = 0;
  /** Both hands up either side of his face, the backs of them to the camera, fists with the middle fingers up. */
  private flipPose: NonNullable<Enemy['pose']> = {
    handL: new THREE.Vector3(),
    handR: new THREE.Vector3(),
    palmL: new THREE.Vector3(0, 0, 1),
    thumbL: new THREE.Vector3(-1, 0, 0),
    palmR: new THREE.Vector3(0, 0, 1),
    thumbR: new THREE.Vector3(1, 0, 0),
    curl: 1,
    lean: 0
  };
  private doorShotAt = 0;

  private endReveal(): void {
    this.useCut = false;
    this.boss.root.visible = false;
    this.boss.alive = false;
    this.player.camera.fov = 74;
    this.player.camera.updateProjectionMatrix();
    this.startRun();
    this.say('RAVI', 'He was hiding in his own bedroom. Of course he was. The emergency closet by that door — there will be chutes in it.', 5);
  }

  /** Down the plane in the gale, to the chutes. */
  private startRun(): void {
    this.phase = 'run';
    this.checkpoint = 2;
    this.player.cinematic = false;
    this.cinema(false);
    this.setObjective('GET A PARACHUTE — THE EMERGENCY CLOSET AT THE BACK');
    if (!this.klaxon) {
      this.klaxon = this.ctx.audio.klaxonLoop();
      this.klaxon.set(0.5);
    }
  }

  /** The aft door goes: the plug comes in an inch, then swings out and forward. `instant` for a retry. */
  private openAftDoor(instant: boolean): void {
    this.doorOpen = instant ? 1 : 0.0001;
    this.ctx.audio.doorBreach();
    this.roar = this.ctx.audio.jetEngine();
    this.roar.setThrust(1);
    this.roar.setDistance(6);
    if (instant) this.wind = 1;
  }

  private updateAftDoor(dt: number): void {
    if (this.doorOpen <= 0) return;
    this.doorOpen = Math.min(1, this.doorOpen + dt * 0.9);
    this.updateAftDoorPose();
    this.wind = Math.max(this.wind, smooth((this.doorOpen - 0.2) / 0.3));
    const ear = this.player.position.distanceTo(this.level.aftDoor.at);
    this.roar?.setDistance(this.useCut ? 4 : 3 + ear * 1.2);
  }

  private updateAftDoorPose(): void {
    const L = this.level;
    const zc = (DOOR.z0 + DOOR.z1) / 2;
    const k = this.doorOpen;
    const inward = smooth(k / 0.25) * (1 - smooth((k - 0.25) / 0.3));
    const out = smooth((k - 0.25) / 0.75);
    L.aftDoor.leaf.position.set(-HW - 0.06 + inward * 0.1 - out * 0.55, 0, zc - out * 1.95);
    L.aftDoor.leaf.rotation.y = -out * 0.35;
  }

  // ---- the chute, and out

  private gearT = 0;
  private gearFrom = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };

  /** E at the closet: the doors open, a chute off its hook and onto his back. */
  private startGear(): void {
    this.phase = 'gear';
    this.gearT = 0;
    this.player.cinematic = true;
    this.player.aiming = false;
    this.cinema(true);
    this.setObjective('');
    this.hud.setPrompt(null);
    this.ctx.audio.doorOpen();
    const pack = this.level.chutes.find((c) => c.visible) ?? this.level.chutes[0];
    pack.visible = false;
    const mine = parachutePack();
    pack.getWorldPosition(mine.position);
    pack.getWorldQuaternion(mine.quaternion);
    this.scene.add(mine);
    this.ownChute = mine;
    this.gearFrom = { pos: this.player.position.clone(), yaw: this.player.yaw, pitch: this.player.pitch };
  }

  /**
   *  0.0  he faces the closet; its doors swing open
   *  0.7  he lifts a pack off its hook toward him
   *  1.5  up over his shoulders and on (the straps, the buckles)
   *  2.5  his hands are his own again: to the door, and out
   */
  private updateGear(dt: number): void {
    const L = this.level;
    const p = this.player;
    this.gearT += dt;
    const t = this.gearT;
    const cam = p.camera;
    const eye = V(this.gearFrom.pos.x, 1.6, this.gearFrom.pos.z);
    const face = yawPitchTo(eye, V(L.lockerAt.x + 0.75, 1.2, L.lockerAt.z));
    const k = smooth(t / 0.6);
    p.yaw = this.gearFrom.yaw + wrapAngle(face.yaw - this.gearFrom.yaw) * k;
    p.pitch = this.gearFrom.pitch + (face.pitch - this.gearFrom.pitch) * k;
    const open = smooth(t / 0.7);
    L.closetDoors[0].rotation.y = -1.9 * open;
    L.closetDoors[1].rotation.y = 1.9 * open;
    const pack = this.ownChute!;
    if (t > 0.7) {
      cam.updateMatrixWorld(true);
      const lift = smooth((t - 1.5) / 0.7);
      const hold = V(0, -0.42 + lift * 1.0, -0.75 + lift * 0.95).applyMatrix4(cam.matrixWorld);
      pack.position.lerp(hold, Math.min(1, dt * (t < 1.5 ? 4 : 10)));
      const q = cam.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, 0)));
      pack.quaternion.slerp(q, Math.min(1, dt * 6));
    }
    if (t > 1.9 && t - dt <= 1.9) this.ctx.audio.velcro();
    if (t > 2.25 && t - dt <= 2.25) this.ctx.audio.clink();
    if (t > 2.15) pack.visible = false;
    if (t > 2.6) this.startOut();
  }

  /** Chute on: the door's his. Nothing stops him walking out of it now. */
  private startOut(): void {
    this.phase = 'out';
    this.player.cinematic = false;
    this.cinema(false);
    this.level.aftDoor.collider.disabled = true;
    this.setObjective('JUMP — OUT OF THE DOOR AFTER HIM');
    this.say('RAVI', 'Never done this before. How hard can it be.', 3);
  }

  /** Over the sill: the floor goes, the view tips down into the blue, the sky takes it. */
  private jumpT = 0;
  private jumpV = new THREE.Vector3();
  private startJump(): void {
    this.phase = 'jump';
    this.jumpT = 0;
    this.player.cinematic = true;
    this.player.aiming = false;
    this.hud.setPrompt(null);
    this.setObjective('');
    this.jumpV.set(-3.2, 0, 0);
    this.jumpFrom = { yaw: this.player.yaw, pitch: this.player.pitch };
    this.ctx.audio.kickWhoosh();
    this.mark.style.display = 'none';
  }
  private jumpFrom = { yaw: 0, pitch: 0 };

  private updateJump(dt: number): void {
    const p = this.player;
    this.jumpT += dt;
    const t = this.jumpT;
    // Out and down, the slipstream taking him aft along the fuselage
    this.jumpV.y -= 9.8 * dt;
    this.jumpV.z += 14 * dt;
    p.position.addScaledVector(this.jumpV, dt);
    const k = smooth(t / 0.7);
    p.yaw = this.jumpFrom.yaw + wrapAngle(Math.PI / 2 - this.jumpFrom.yaw) * k;
    p.pitch = this.jumpFrom.pitch + (-0.7 - this.jumpFrom.pitch) * k;
    // Into the sky's own colour; the engine holds it while the fall builds
    this.fadeEl.style.background = '#dce9f5';
    this.fadeEl.style.opacity = String(smooth((t - 0.35) / 0.4));
    if (t > 0.8 && !this.jumped) {
      this.jumped = true;
      this.ctx.bus.emit(Events.Level19Jump);
    }
  }
  private jumped = false;

  // ================================================================ input

  private onClick(): void {
    if (this.dialogue.isActive) {
      this.dialogue.advance();
      return;
    }
    if (this.phase === 'dead') this.ctx.bus.emit(Events.RestartLevel19, { checkpoint: this.checkpoint });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.phase === 'dead') {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') this.ctx.bus.emit(Events.RestartLevel19, { checkpoint: this.checkpoint });
      return;
    }
    if (this.dialogue.isActive && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) {
      e.preventDefault();
      this.dialogue.advance();
    }
  }

  // ================================================================ update

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    const p = this.player;
    const playable = (this.phase === 'play' || this.phase === 'pilots' || this.phase === 'run' || this.phase === 'out') && !this.dialogue.isActive;
    if (playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();

    switch (this.phase) {
      case 'intro':
        this.updateIntro(dt);
        break;
      case 'knock':
        this.updateKnock(dt);
        break;
      case 'pilots':
        this.updatePilots(dt);
        break;
      case 'slump':
        this.updateSlump(dt);
        break;
      case 'dive':
        this.updateDive(dt);
        break;
      case 'reveal':
        this.updateReveal(dt);
        break;
      case 'gear':
        this.updateGear(dt);
        break;
      case 'jump':
        this.updateJump(dt);
        break;
    }

    // ---- The knife on F
    const candidates =
      this.phase === 'play' || this.phase === 'run' || this.phase === 'out' ? this.guards.map((g) => g.e) : this.phase === 'pilots' ? [this.copilot, ...(this.captainUp && this.captain.standing ? [this.captain] : [])] : [];
    this.stepTakedown(dt, candidates, p.alive && playable && !this.arsenal.reloading && !this.drink.engaged, (on) => this.hud.setTakedownHint(on));

    // ---- Deadbull on G
    if (input.wasPressed('KeyG') && !this.inTakedown && p.alive && input.pointerLocked && playable && !this.arsenal.reloading) this.drink.start();
    if (!p.alive || !playable) this.drink.abort();
    const busy = this.drink.engaged || this.inTakedown || (!playable && this.phase !== 'dead');
    this.arsenal.preUpdate(dt, input, { canSwitch: playable, busy });

    const aiming = playable && input.rightHeld && input.pointerLocked && p.alive && !this.arsenal.reloading && !this.arsenal.switching && !busy;
    p.aiming = aiming;

    // The gale through the open door: a pull toward it, stronger the nearer he is
    if (this.wind > 0 && !p.cinematic && p.alive) {
      const to = Level19Scene._a.copy(this.level.aftDoor.at).sub(p.position).setY(0);
      const d = to.length();
      // Down the suite's corridor it can only blow along it: not sideways into the galley doorway's edge
      if (p.position.z < P_GALLEY + 0.5) to.x = 0;
      const pull = (this.wind * 2.6) / (1 + d * 0.3);
      to.normalize().multiplyScalar(pull);
      p.boost.x = to.x;
      p.boost.z = to.z;
    }
    p.update(dt, this.level.colliders);
    this.holdTakedown();
    this.applyShake();

    this.arsenal.updateViewmodels(dt, aiming);
    this.drink.update(dt, p);
    this.hud.setCinematic(this.takedownCinema > 0.5 || (!playable && this.phase !== 'dead'));
    if (!this.useCut && this.phase !== 'reveal') {
      const targetFov = -10 * this.takedownCinema + 74 - this.arsenal.zoomFov;
      if (Math.abs(p.camera.fov - targetFov) > 0.01) {
        p.camera.fov = targetFov;
        p.camera.updateProjectionMatrix();
      }
    }
    this.hud.setAiming(this.arsenal.aimBlend > 0.5);
    this.hud.setHealth(p.health, p.regenProgress);
    const canFire = playable && p.alive && input.pointerLocked && !busy;
    this.arsenal.updateFire(dt, input, canFire, (r, m, re) => this.hud.setAmmo(r, m, re));

    this.updateGuards(dt);
    this.updateTriggers();
    for (const x of [this.captain, this.copilot, this.boss, ...this.corpses]) x.update(dt);
    this.updatePlane(dt);
    this.updateAftDoor(dt);
    this.updateFliers(dt);

    this.dialogue.update(dt);
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) this.subtitle.style.opacity = '0';
    }
    this.floatBodies(dt);
    this.world.step(1 / 60, dt, 3);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.decals.update(dt);
    this.updateDebris(dt);
    input.endFrame();
  }

  /** The prompts, and the places that move the story on. */
  private updateTriggers(): void {
    const p = this.player.position;
    const L = this.level;
    if (!this.player.alive) return;
    if (this.phase === 'play' && p.z < P_CONF - 0.5 && this.checkpoint < 1) this.checkpoint = 1;
    if (this.phase === 'play' && !this.seenLounge && p.z < -9.5) {
      this.seenLounge = true;
      this.say('RAVI', 'His chair is still warm. The cigar is still going. He was here a minute ago.', 4.5);
      this.setObjective('THE BOSS ISN\'T HERE — TRY THE FLIGHT DECK');
    }
    if (this.phase === 'play' && !this.knocked) {
      // Stood at it, and looking at it (not round at the lavatory door beside it)
      const cam = this.player.camera;
      const eye = cam.getWorldPosition(Level19Scene._a);
      const toDoor = Level19Scene._b.set(0, 1.3, P_COCKPIT).sub(eye).normalize();
      const facing = cam.getWorldDirection(new THREE.Vector3()).dot(toDoor) > 0.75;
      const near = facing && Math.abs(p.x - L.cockpitDoor.at.x) < 0.9 && Math.abs(p.z - L.cockpitDoor.at.z) < 0.9;
      this.hud.setPrompt(near ? '[ E ] KNOCK' : null);
      if (near && this.ctx.input.wasPressed('KeyE')) this.knock();
    }
    if (this.phase === 'run') {
      const near = p.distanceTo(L.lockerAt) < 1.3;
      this.hud.setPrompt(near ? '[ E ] OPEN THE CLOSET — TAKE A PARACHUTE' : null);
      if (near && this.ctx.input.wasPressed('KeyE') && !this.inTakedown) this.startGear();
    }
    // Chute on: across the sill and out
    if (this.phase === 'out' && !this.inTakedown && p.x < -HW + 0.15 && p.z > DOOR.z0 && p.z < DOOR.z1) this.startJump();
    this.updateMarker();
  }

  private updateGuards(dt: number): void {
    const active = this.phase === 'play' || this.phase === 'run' || this.phase === 'out' || this.phase === 'pilots' || this.phase === 'knock';
    for (const g of this.guards) {
      g.e.update(dt);
      if (!g.e.alive) continue;
      if (!active || !this.player.alive) {
        g.e.setWalk(0);
        continue;
      }
      // A man at his post stands it, looking about, until something's up
      const post = g.spawn.zone === 0 && g.ai.state === 'patrol';
      if (post) {
        g.look += dt;
        g.e.yaw = g.spawn.yaw + Math.sin(g.look * 0.45) * 0.7;
        g.e.root.rotation.y = g.e.yaw;
      }
      g.ai.update(dt);
      if (post && g.ai.state === 'patrol') {
        g.e.position.x = g.spawn.pos.x;
        g.e.position.z = g.spawn.pos.z;
        g.e.yaw = g.spawn.yaw + Math.sin(g.look * 0.45) * 0.7;
        g.e.root.rotation.y = g.e.yaw;
        g.e.setWalk(0);
      }
    }
  }

  /** The plane's own state: the dive, the lights, the alarm, the cloud going by. */
  private updatePlane(dt: number): void {
    const L = this.level;
    this.pitchDown += (this.pitchTarget - this.pitchDown) * Math.min(1, dt * 0.6);
    L.outside.rotation.x = this.pitchDown;
    // The cloud decks slide aft under her, faster in the dive
    const v = 0.0035 * (1 + this.pitchDown * 3);
    L.cloudMaps[0].offset.y += dt * v * 0.4;
    L.cloudMaps[1].offset.y += dt * v;
    if (this.pitchTarget > 0) {
      this.alarm = Math.min(1, this.alarm + dt);
      const now = performance.now();
      const flash = 0.5 + 0.5 * Math.sin(now * 0.009);
      for (const l of L.alarmLights) l.intensity = this.alarm * flash * 18;
      L.alarmMat.emissiveIntensity = this.alarm * flash * 2.5;
      // The cabin lights stutter on the bus, the strips with them
      const bus = Math.random() < 0.03 ? 0.12 : 1;
      L.cabinLights.forEach((l, i) => {
        l.intensity = this.cabinBase[i] * (0.5 + 0.1 * Math.sin(now * 0.004 + i)) * bus;
      });
      L.ledMat.emissiveIntensity = 0.45 * bus;
      L.screenMat.emissive.setHex(Math.sin(now * 0.012) > 0 ? 0xff5040 : 0xffffff);
      this.klaxon?.set(this.useCut ? 0.25 : 0.45);
    }
    // The cigar, still going
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.5;
      this.particles.barrelSmoke(L.cigarTip, Level19Scene._b.set(0, 1, 0));
    }
    this.hum?.setThrust(0.75 + this.pitchDown);
  }

  /** The camera's shake, on top of wherever it is. */
  private applyShake(): void {
    if (this.phase === 'dead') return;
    const cam = this.player.camera;
    if (this.pitchTarget <= 0) {
      cam.position.x += (Math.random() - 0.5) * 0.0007;
      cam.position.y += (Math.random() - 0.5) * 0.0007;
      return;
    }
    // Going down: a hard rattle through the floor, a slow heave and roll as
    // she wallows, and every so often a jolt that throws the view
    const now = performance.now() * 0.001;
    const k = this.alarm * (1 + this.wind * 0.6);
    const rattle = 0.016 * k;
    cam.position.x += (Math.random() - 0.5) * rattle + Math.sin(now * 1.3) * 0.02 * k;
    cam.position.y += (Math.random() - 0.5) * rattle + Math.sin(now * 2.1) * 0.025 * k;
    cam.rotation.z += (Math.random() - 0.5) * 0.012 * k + Math.sin(now * 0.9) * 0.05 * k;
    cam.rotation.x += Math.sin(now * 1.7) * 0.02 * k;
    this.jolt -= 1 / 60;
    if (this.jolt <= 0) {
      this.jolt = 0.9 + Math.random() * 2.2;
      this.joltK = 1;
    }
    this.joltK *= 0.9;
    cam.position.y += (Math.random() - 0.5) * 0.12 * this.joltK * k;
    cam.rotation.z += (Math.random() - 0.5) * 0.08 * this.joltK * k;
  }
  private jolt = 1;
  private joltK = 0;

  /**
   * Loose things: in the dive they slide forward; when the door goes the
   * light ones are sucked toward it and out, and the heavy ones skitter.
   */
  private updateFliers(dt: number): void {
    if (this.pitchTarget <= 0 && this.wind <= 0) return;
    const door = this.level.aftDoor.at;
    for (const f of this.fliers) {
      const o = f.o;
      if (!o.visible) continue;
      f.v.z -= dt * this.pitchDown * (f.light ? 1.5 : 3);
      if (this.wind > 0) {
        const to = Level19Scene._a.set(door.x - 1.2 - o.position.x, 1.0 - o.position.y, door.z - o.position.z);
        const d = Math.max(0.5, to.length());
        const pull = (this.wind * (f.light ? 40 : 6)) / (d * 0.5 + 1);
        f.v.addScaledVector(to.normalize(), pull * dt);
        if (f.light && Math.random() < dt * 3) f.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      }
      // Next to no g in the dive: everything comes up off the floor and drifts
      // about the cabin, each thing wandering its own way through the air
      if (this.floating) {
        const k = o.id * 1.7;
        const want = 1.15 + 0.6 * Math.sin(this.floatT * 0.5 + k);
        f.v.y += dt * ((want - o.position.y) * 1.8 + Math.sin(this.floatT * 1.4 + k) * (f.light ? 0.9 : 0.4));
        f.v.x += dt * Math.sin(this.floatT * 0.9 + k * 2.3) * (f.light ? 0.9 : 0.5);
        f.v.z += dt * Math.cos(this.floatT * 0.7 + k) * (f.light ? 0.8 : 0.4);
      }
      if (f.light && Math.random() < dt * 1.5) f.spin.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
      f.v.multiplyScalar(1 - dt * (f.light ? 1.2 : 0.4));
      o.position.addScaledVector(f.v, dt);
      o.rotation.x += f.spin.x * dt;
      o.rotation.y += f.spin.y * dt;
      o.rotation.z += f.spin.z * dt;
      if (o.position.y < 0.02) {
        o.position.y = 0.02;
        f.v.y = Math.abs(f.v.y) * 0.2;
        f.v.x *= 0.8;
        f.v.z *= 0.8;
      }
      if (o.position.y > 2.3) {
        o.position.y = 2.3;
        f.v.y = -Math.abs(f.v.y) * 0.3;
      }
      const atDoor = o.position.z > DOOR.z0 && o.position.z < DOOR.z1 && this.doorOpen > 0.5;
      if (o.position.x > HW - 0.05) {
        o.position.x = HW - 0.05;
        f.v.x = -Math.abs(f.v.x) * 0.3;
      }
      if (o.position.x < -HW + 0.05 && !atDoor) {
        o.position.x = -HW + 0.05;
        f.v.x = Math.abs(f.v.x) * 0.3;
      }
      if (o.position.x < -HW - 1) o.visible = false;
    }
  }

  // ================================================================ combat

  protected killEnemy(
    enemy: Enemy,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    byPlayer: boolean,
    headshot: boolean,
    hitPart?: string,
    impulseScale = 1,
    opts: { wound?: boolean; keepWeapon?: boolean } = {}
  ): void {
    if (!enemy.alive) return;
    // The captain, shot at the controls: he goes over from where he sits (not stood up first)
    const captainAtControls = enemy === this.captain && this.phase === 'pilots';
    if (captainAtControls) enemy.ragdollFromPose = true;
    enemy.die(point, dir, this.world, hitPart === 'head' ? 'head' : 'torso', impulseScale, opts);
    if (captainAtControls) this.startSlump();
    const g = this.guards.find((x) => x.e === enemy);
    if (!g) return;
    g.ai.dispose();
    this.remaining = Math.max(0, this.remaining - 1);
    this.ctx.bus.emit(Events.EnemyKilled, { name: enemy.name, remaining: this.remaining, headshot, by: byPlayer ? 'RAVI' : 'FRIENDLY FIRE' });
    // Anybody who saw him go, close by, looking his way, with nothing in between
    if (byPlayer) {
      const at = enemy.position.clone().setY(1.2);
      for (const o of this.guards) {
        if (o === g || !o.e.alive || o.ai.state === 'attack') continue;
        if (this.witnessed(o.e, at)) o.ai.alert(this.player.position);
      }
    }
  }

  /** Did `e` see what happened at `at`: near enough, in front of him, a clear line? */
  private witnessed(e: Enemy, at: THREE.Vector3): boolean {
    const eye = e.eyePosition(Level19Scene._a);
    const to = Level19Scene._b.copy(at).sub(eye);
    const d = to.length();
    if (d > 9) return false;
    to.divideScalar(d);
    const f = e.forwardDir(new THREE.Vector3());
    if (f.x * to.x + f.z * to.z < 0.25) return false;
    this.raycaster.set(eye, to);
    this.raycaster.far = d - 0.2;
    return this.raycaster.intersectObjects(this.level.occluders, false).length === 0;
  }

  protected onTakedownStart(victim: Enemy): void {
    this.guards.find((x) => x.e === victim)?.ai.dispose();
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.useCut ? this.cutCam : this.player.camera);
  }
}
