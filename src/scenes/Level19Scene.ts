import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level19Builder, type Level19Data, type GuardSpawn, parachutePack, HW, DOOR, P_COCKPIT, P_CONF } from '../environment/Level19Builder';
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

type Phase = 'intro' | 'play' | 'knock' | 'pilots' | 'dive' | 'reveal' | 'run' | 'gear' | 'jump' | 'dead';

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
  private unsubs: (() => void)[] = [];
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private clickHandler = (): void => this.onClick();

  private boss!: Enemy;
  private copilot!: Enemy;
  private captain!: Enemy;
  private captainUp = false;
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
      <div class="l19-fade" style="position:absolute;inset:0;background:#000;opacity:0;pointer-events:none"></div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.subtitle = el.querySelector('.l19-sub')!;
    this.fadeEl = el.querySelector('.l19-fade')!;
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
      // Past a checkpoint, the men behind it are already down: they aren't here at all
      if (this.from >= 2) return;
      if (this.from >= 1 && (sp.section === 'suite' || sp.section === 'conf')) return;
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
      this.guards.push({ e, ai, spawn: sp, look: i * 1.7 });
    });
    this.remaining = this.guards.length;
  }

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
    if (!this.copilot.alive && this.captain.alive && !this.captainUp) {
      this.captainUp = true;
      this.captain.setSitting(false);
      this.captain.setHandsUp(true);
      this.captain.setScared();
      this.say('CAPTAIN', 'Whoa — whoa! If you do me, who is going to fly the—', 3.5);
    }
    if (this.captain.alive && !this.captain.beingExecuted && this.captainUp) this.captain.faceToward(this.player.position, dt, 3);
    if (!this.copilot.alive && !this.captain.alive) this.startDive();
  }

  /** Nobody at the controls: she drops her nose. */
  private startDive(): void {
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
    cam.position.lerpVectors(V(1.75, 1.62, 28.75), V(1.15, 1.52, 27.7), smooth(s / 6));
    cam.lookAt(V(-2.2, 1.1, 25.5));
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
    if (u > 1.9 && u < 3.4) b.faceToward(cam.position, dt, 6);
    if (u > 2.3 && u < 3.4) b.setMiddleFingers(true, true);
    if (u >= 3.4) {
      // Backwards out of the door, into the blue
      b.setMiddleFingers(false, false);
      if (!this.bossGone) {
        this.bossGone = true;
        this.ctx.audio.kickWhoosh();
      }
      const w = u - 3.4;
      b.position.x = Math.max(-HW - 30, b.position.x - dt * (2 + w * 6));
      b.position.y -= dt * w * 6;
      b.position.z -= dt * w * 5;
      b.root.rotation.x = -Math.min(1.3, w * 1.6);
    }
    if (u > 4.8) {
      b.root.visible = false;
      this.endReveal();
    }
  }
  private doorShotAt = 0;

  private endReveal(): void {
    this.useCut = false;
    this.boss.root.visible = false;
    this.boss.alive = false;
    this.player.camera.fov = 74;
    this.player.camera.updateProjectionMatrix();
    this.startRun();
    this.say('RAVI', 'He was hiding in his own bedroom. Of course he was. There were chutes back by that door…', 5);
  }

  /** Down the plane in the gale, to the chutes. */
  private startRun(): void {
    this.phase = 'run';
    this.checkpoint = 2;
    this.player.cinematic = false;
    this.cinema(false);
    this.setObjective('GET A PARACHUTE — THE LOCKER BY THE BACK DOOR');
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

  /** E at the locker: a chute out of it, on, and to the door. */
  private startGear(): void {
    this.phase = 'gear';
    this.gearT = 0;
    this.player.cinematic = true;
    this.cinema(true);
    this.setObjective('');
    this.hud.setPrompt(null);
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
   *  0.0  he faces the locker and lifts a pack off its hook toward him
   *  1.1  up over his head and onto his back (the buckles)
   *  2.4  round to the door, a few steps to the edge, the gale in his face
   *  4.2  looking down: the cloud, miles below
   *  5.7  out
   */
  private updateGear(dt: number): void {
    const L = this.level;
    const p = this.player;
    this.gearT += dt;
    const t = this.gearT;
    const cam = p.camera;
    const eye = V(this.gearFrom.pos.x, 1.6, this.gearFrom.pos.z);
    const face = yawPitchTo(eye, V(L.lockerAt.x + 0.75, 1.05, L.lockerAt.z));
    const doorZ = (DOOR.z0 + DOOR.z1) / 2;
    if (t < 2.4) {
      const k = smooth(t / 0.6);
      p.yaw = this.gearFrom.yaw + wrapAngle(face.yaw - this.gearFrom.yaw) * k;
      p.pitch = this.gearFrom.pitch + (face.pitch - this.gearFrom.pitch) * k;
      const pack = this.ownChute!;
      cam.updateMatrixWorld(true);
      const lift = smooth((t - 1.1) / 0.7);
      const hold = V(0, -0.4 + lift * 1.0, -0.72 + lift * 0.9).applyMatrix4(cam.matrixWorld);
      pack.position.lerp(hold, Math.min(1, dt * (t < 1.1 ? 4 : 10)));
      const q = cam.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, 0)));
      pack.quaternion.slerp(q, Math.min(1, dt * 6));
      if (t > 1.6 && t - dt <= 1.6) this.ctx.audio.velcro();
      if (t > 2.0 && t - dt <= 2.0) this.ctx.audio.clink();
      if (t > 1.9) pack.visible = false;
      return;
    }
    const k = smooth((t - 2.4) / 1.8);
    const door = V(-HW + 0.62, 0, doorZ);
    p.position.lerpVectors(this.gearFrom.pos, door, k);
    const out = yawPitchTo(V(door.x, 1.6, door.z), V(-30, -14, doorZ - 6));
    const look = smooth((t - 3.8) / 1.2);
    p.yaw = face.yaw + wrapAngle(out.yaw - face.yaw) * smooth((t - 2.4) / 1.4);
    p.pitch = face.pitch * (1 - k) * (1 - look) + out.pitch * 1.4 * look;
    if (t > 4.2 && t - dt <= 4.2) this.say('RAVI', 'Never done this before. How hard can it be.', 2.4);
    if (t > 5.7) {
      // Out: the floor goes, the view tips down into the blue
      const j = clamp01((t - 5.7) / 1.0);
      p.position.x = door.x - j * 2.6;
      p.position.y = -j * j * 1.5;
      p.pitch = out.pitch * 1.4 - j * 0.9;
      this.fadeEl.style.background = '#fff';
      this.fadeEl.style.opacity = String(smooth((t - 6.1) / 0.5));
      if (t > 6.7 && this.phase === 'gear') {
        this.phase = 'jump';
        this.ctx.bus.emit(Events.Level19Jump);
      }
    }
  }

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
    const playable = (this.phase === 'play' || this.phase === 'pilots' || this.phase === 'run') && !this.dialogue.isActive;
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
      case 'dive':
        this.updateDive(dt);
        break;
      case 'reveal':
        this.updateReveal(dt);
        break;
      case 'gear':
        this.updateGear(dt);
        break;
    }

    // ---- The knife on F
    const candidates =
      this.phase === 'play' || this.phase === 'run' ? this.guards.map((g) => g.e) : this.phase === 'pilots' ? [this.copilot, ...(this.captainUp && this.captain.standing ? [this.captain] : [])] : [];
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
    const canFire = playable && p.alive && input.pointerLocked && !busy;
    this.arsenal.updateFire(dt, input, canFire, (r, m, re) => this.hud.setAmmo(r, m, re));

    this.updateGuards(dt);
    this.updateTriggers();
    for (const x of [this.captain, this.copilot, this.boss]) x.update(dt);
    this.updatePlane(dt);
    this.updateAftDoor(dt);
    this.updateFliers(dt);

    this.dialogue.update(dt);
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) this.subtitle.style.opacity = '0';
    }
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
      const near = Math.abs(p.x - L.cockpitDoor.at.x) < 0.9 && Math.abs(p.z - L.cockpitDoor.at.z) < 0.9;
      this.hud.setPrompt(near ? '[ E ] KNOCK' : null);
      if (near && this.ctx.input.wasPressed('KeyE')) this.knock();
    }
    if (this.phase === 'run') {
      const near = p.distanceTo(L.lockerAt) < 1.15;
      this.hud.setPrompt(near ? '[ E ] TAKE A PARACHUTE' : null);
      if (near && this.ctx.input.wasPressed('KeyE') && !this.inTakedown) this.startGear();
    }
  }

  private updateGuards(dt: number): void {
    const active = this.phase === 'play' || this.phase === 'run' || this.phase === 'pilots' || this.phase === 'knock';
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
    const s = this.pitchTarget > 0 ? 0.004 + this.wind * 0.006 : 0.0007;
    const cam = this.player.camera;
    cam.position.x += (Math.random() - 0.5) * s;
    cam.position.y += (Math.random() - 0.5) * s;
    cam.rotation.z += (Math.random() - 0.5) * s * 0.6 + (this.pitchTarget > 0 ? Math.sin(performance.now() * 0.0011) * 0.012 : 0);
  }

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
      f.v.y -= dt * (f.light ? 1.5 : 9.8);
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
    enemy.die(point, dir, this.world, hitPart === 'head' ? 'head' : 'torso', impulseScale, opts);
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
