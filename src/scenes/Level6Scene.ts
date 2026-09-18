import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level6Builder, Level6Data } from '../environment/Level6Builder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { FPSPlayer } from '../entities/FPSPlayer';
import { RifleViewmodel } from '../entities/RifleViewmodel';
import { EmoteViewmodel } from '../entities/EmoteViewmodel';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { DropKickViewmodel } from '../entities/DropKickViewmodel';
import { CaptiveHands } from '../entities/CaptiveHands';
import { Enemy } from '../entities/Enemy';
import { EnemyAI } from '../entities/EnemyAI';
import { FPSHUD } from '../ui/FPSHUD';
import { DialogueBox } from '../ui/DialogueBox';

const RIFLE_COOLDOWN = 0.1;
const RIFLE_MAG = 30;
/** His eye, tied into the chair. */
const SEATED_EYE = 1.18;
/** How long it takes him to come round. */
const WAKE_TIME = 5.6;
/** The AK in the agents' hands: real size, and its landmarks in the glb's frame (muzzle down +X). */
const AK_SCALE = 0.95;
const AK_GRIP = [-0.08, -0.05] as const;
const AK_GUARD = [0.255, -0.035] as const;
const AK_MUZZLE = [0.58, 0.022] as const;
const BOSS_PITCH = 0.72;
/**
 * How far forward of the chair he ends up standing — clear of its collider,
 * or the first frame of control would start him inside it and stuck.
 */
const STAND_UP = 0.66;
/** Drawing the right hand back, while he comes up out of the chair. */
const WINDUP = 0.28;

/** Smoothstepped keyframe track: [time, value] pairs. */
function track(keys: readonly (readonly [number, number])[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t <= t1) {
      const u = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (u * u * (3 - 2 * u));
    }
  }
  return keys[keys.length - 1][1];
}
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};

type Phase = 'wake' | 'talk' | 'untie' | 'fight' | 'search' | 'done' | 'dead';

/**
 * One step of the agent's walk over to untie him and what follows it. Each
 * runs for `dur` seconds (or until its walk is done, if it has one).
 */
type Step =
  | 'walkR' | 'kneelR' | 'workR' | 'riseR'
  | 'walkL' | 'kneelL' | 'workL' | 'riseL'
  | 'beat' | 'windup' | 'strike' | 'after';

/**
 * Level6Scene — the boss's office.
 *
 * Ravi comes round tied to a chair. The boss is sat behind his desk, chin on
 * his fists, an agent either side of him with an AK, and a portrait of
 * himself in exactly that pose on the wall behind him. He explains: he sold
 * them all out, and he would like Ravi as a partner. Ravi says he guesses so.
 * One agent comes round and unties him, right hand then left — and Ravi puts
 * the right one through his face. The agent goes down, his AK is Ravi's, the
 * boss drops behind the desk, and the cutscene gives way to the fight with the
 * agent who is left. When that is done there is only the space behind the
 * desk to look in, and the boss is not in it: the vent is open.
 *
 * `retry` starts at the fight, for a restart after dying in it.
 */
export class Level6Scene extends CombatScene<Level6Data> {
  private rifle!: RifleViewmodel;
  private emote!: EmoteViewmodel;
  /** Deadbull on G: three seconds with no gun, and he's back on full health. */
  private drink!: DrinkViewmodel;
  /** Drop kick on Q. */
  private dropKick!: DropKickViewmodel;
  /** Who the kick was aimed at when Q went down. */
  private kickVictim: Enemy | null = null;
  private hands!: CaptiveHands;
  private fill!: THREE.PointLight;
  private hud!: FPSHUD;
  private dialogue!: DialogueBox;

  private boss!: Enemy;
  /** [his left — the one who unties Ravi, his right]. */
  private agents: Enemy[] = [];
  private agentAI: EnemyAI | null = null;
  private rifleAmmo = RIFLE_MAG;
  private fireCooldown = 0;

  private phase: Phase = 'wake';
  private t = 0;
  private beats = new Set<string>();
  private step: Step = 'walkR';
  private stepT = 0;
  private walkLeg = 0;
  /** Seconds since the punch landed, or -1 before it. */
  private afterT = -1;
  /** Seconds since the boss went for the floor, or -1. */
  private duckT = -1;
  private camYaw = 0;
  private camPitch = 0;
  private lift = 0;
  private searchT = -1;
  private over = false;
  private duckAfterPhoto = false;
  /** Game seconds until the last agent's AI starts, or -1. */
  private aiDelay = -1;
  /** Where the fist was when it landed, to draw it back from. */
  private punchAt = new THREE.Vector3();

  private ui!: HTMLElement;
  private objective!: HTMLElement;
  private letterbox!: HTMLElement;
  private lids!: { top: HTMLElement; bot: HTMLElement };
  private photoTaken = false;
  private needsCompile = false;
  private akTemplate: THREE.Object3D | null = null;
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private pooled = new Set<Enemy>();
  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();
  private static tmpQ = new THREE.Quaternion();

  constructor(
    ctx: GameContext,
    private retry = false
  ) {
    super(ctx);
  }

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x050403);
    this.scene.fog = new THREE.Fog(0x050403, 9, 22);

    this.level = new Level6Builder().build();
    this.scene.add(this.level.group);
    this.world = this.createPhysicsWorld(this.level.colliders);

    const L = this.level;
    this.player = new FPSPlayer(L.chairAt, 0, input, audio, bus);
    this.player.cinematic = true;
    this.scene.add(this.player.camera);

    // His AK arrives at the end of the cutscene. Until then it rides at
    // 0.99 stow — out of shot but not hidden, so its muzzle light is in the
    // scene's light count from the first frame and bringing it up recompiles
    // nothing.
    this.rifle = new RifleViewmodel(this.player.camera);
    this.rifle.stow = 0.99;
    this.rifle.onReloadEvent = (e) => {
      if (e === 'strike') audio.magStrike();
      else if (e === 'magOut') audio.magOut();
      else if (e === 'magDrop') this.dropRifleMagazine();
      else if (e === 'magIn') audio.magIn();
      else if (e === 'rackBack') audio.boltBack();
      else if (e === 'rack') audio.boltForward();
      else if (e === 'done') this.rifleAmmo = RIFLE_MAG;
    };
    this.emote = new EmoteViewmodel(this.player.camera);
    // Deadbull (G) and the drop kick (Q)
    this.drink = new DrinkViewmodel(this.player.camera);
    this.drink.onEvent = (e, i) => {
      if (e === 'crack') audio.canCrack();
      else if (e === 'gulp') audio.gulp(i);
      else if (e === 'heal') this.player.healFull();
      else if (e === 'crush') audio.canCrush();
      else if (e === 'toss') this.dropCan(this.drink.tossPose());
    };
    this.dropKick = new DropKickViewmodel(this.player.camera);
    this.dropKick.onEvent = (e) => {
      if (e === 'launch') {
        audio.kickWhoosh();
      } else if (e === 'impact') {
        // Re-check at the last instant rather than trusting who was in front
        // when the key went down — half a second is plenty of time for him to
        // have walked off, or for someone else to have walked in.
        const victim = this.kickVictim?.alive ? this.kickVictim : this.kickTarget();
        this.kickVictim = null;
        if (!victim) return; // kicked the air; the rest of the move still plays
        this.dropKick.hit = true;
        this.dropKickEnemy(victim);
      } else if (e === 'land') {
        audio.backLanding();
        bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 9, kind: 'footstep' });
      } else if (e === 'up') {
        audio.scuff();
      } else if (e === 'done') {
        this.player.cinematic = false;
        this.endKickRun();
      }
    };
    this.hands = new CaptiveHands(this.player.camera);
    // A faint warm fill from where he sits, for the cutscene. The bulb is
    // behind everyone who comes near him, and on its own it made the agent
    // untying him a black cut-out. In the scene from the first frame at zero,
    // so bringing it up never moves the light count.
    this.fill = new THREE.PointLight(0xffd2a0, 0, 3.4, 1.5);
    this.fill.position.set(0.05, 0.12, -0.1);
    this.player.camera.add(this.fill);

    this.particles = new ParticleManager(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene);
    Enemy.flashPool = this.flashPool;
    this.decals = new BloodDecalSystem(this.scene);

    // The boss, sat, elbows on the desk and his chin on his fists
    this.boss = new Enemy(L.bossAt, Math.PI, 7, { name: 'THE BOSS', boss: true });
    this.boss.setSitting(true, true);
    this.scene.add(this.boss.root);
    this.poseBoss(0);
    // And the two either side of him, rifles held at rest — Ravi is tied up
    L.agentAt.forEach((at, i) => {
      const e = new Enemy(at, Math.PI, 3 + i * 2, { name: 'POLICE FORCE AGENT' });
      e.setRestCarry(true, true);
      this.scene.add(e.root);
      for (const p of e.parts) L.shootables.push(p);
      this.agents.push(e);
    });
    this.loadAK();

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, 1, this.player.maxHealth);
    this.buildUI();
    this.dialogue = new DialogueBox(this.ctx.uiRoot, audio);

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }),
      bus.on(Events.PlayerDied, () => {
        this.phase = 'dead';
        this.over = true;
      })
    );
    document.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);
    input.requestPointerLock();

    if (this.retry) this.skipToFight();
    else {
      this.camPitch = -0.75;
      this.camYaw = 0.18;
    }
  }

  exit(): void {
    for (const u of this.unsubs) u();
    this.agentAI?.dispose();
    document.removeEventListener('click', this.clickHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.hud.destroy();
    this.dialogue.destroy();
    this.flashPool.dispose();
    this.ui.remove();
    this.ctx.engine.domElement.style.filter = '';
    Enemy.flashPool = null;
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="l6-lid-top" style="position:absolute;left:0;right:0;top:0;height:50%;background:#000;pointer-events:none"></div>
      <div class="l6-lid-bot" style="position:absolute;left:0;right:0;bottom:0;height:50%;background:#000;pointer-events:none"></div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.lids = { top: el.querySelector('.l6-lid-top')!, bot: el.querySelector('.l6-lid-bot')! };
  }

  private setObjective(text: string): void {
    if (this.objective.textContent === text) return;
    this.objective.textContent = text;
    this.objective.classList.remove('show');
    void this.objective.offsetWidth;
    this.objective.classList.add('show');
  }

  /**
   * The same AK the viewmodel carries, for the agents to hold. Loaded once,
   * then a copy into each pair of hands, and the new materials compiled on the
   * next frame rather than on the frame someone first looks at one.
   */
  private loadAK(): void {
    new GLTFLoader().load(`${import.meta.env.BASE_URL}models/ak47.glb`, (gltf) => {
      this.akTemplate = gltf.scene;
      const S = AK_SCALE;
      // glb (x, y, z) → weapon space: muzzle down −Z, as RifleViewmodel maps it
      const at = (p: readonly [number, number]): THREE.Vector3 => new THREE.Vector3(0, p[1] * S, -p[0] * S);
      for (const e of this.agents) {
        const wrap = new THREE.Group();
        const copy = gltf.scene.clone(true);
        copy.rotation.y = Math.PI / 2;
        copy.scale.setScalar(S);
        wrap.add(copy);
        e.equipWeapon(wrap, at(AK_GRIP), at(AK_GUARD), at(AK_MUZZLE));
      }
      this.needsCompile = true;
    });
  }

  // ------------------------------------------------------------- the boss

  /**
   * Hunched over the desk with his elbows on it and his chin on his fists.
   * `talk` nods the head while a line of his is typing out; `turn` swings it
   * round to his left, to the agent he gives the order to.
   */
  private poseBoss(time: number, talk = false, turn = 0): void {
    const nod = talk ? Math.sin(time * 9) * 0.035 + Math.sin(time * 5.3) * 0.02 : 0;
    this.boss.pose = {
      shift: new THREE.Vector3(0, -0.03 + turn * 0.04, -0.13),
      handR: new THREE.Vector3(0.05, 0.965 + nod * 0.3, -0.2),
      handL: new THREE.Vector3(-0.05, 0.965 + nod * 0.3, -0.2),
      elbow: new THREE.Vector3(0.35, -1, -0.25),
      head: new THREE.Euler(0.1 - turn * 0.1 + nod, turn * 0.85, 0),
      // Negative is forward: a positive tilt takes the top of the chest back
      lean: -0.15
    };
  }

  // ---------------------------------------------------------------- update

  /** The fight is his to play: out of the chair, still alive, vent not yet found. */
  private get playable(): boolean {
    return this.player.alive && !this.over && (this.phase === 'fight' || this.phase === 'search');
  }

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    this.t += dt;
    const cutscene = this.phase === 'wake' || this.phase === 'talk' || this.phase === 'untie';

    if (!cutscene && !this.over && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();

    // ---- Deadbull on G. Not a cutscene: he keeps his feet and the mouse the
    // whole time, and the price of a full heal is three seconds with the AK
    // out of frame.
    if (
      input.wasPressed('KeyG') && this.playable && input.pointerLocked &&
      !this.rifle.reloading && !this.dropKick.engaged
    ) {
      // The finger stays up if it was up: that is the left hand and this is
      // the right, and with the gun stowed there is nothing for it to do.
      this.drink.start();
    }
    if (!this.player.alive) this.drink.abort();

    // ---- Drop kick on Q. It plays whether or not anyone is in front of him:
    // a move that silently does nothing when you misjudge the range just
    // reads as a broken button.
    if (
      input.wasPressed('KeyQ') && this.playable && input.pointerLocked &&
      !this.rifle.reloading && !this.drink.engaged && this.player.grounded
    ) {
      if (this.dropKick.start()) {
        this.emote.cancel();
        this.player.cinematic = true; // the kick owns the camera until he's up
        this.player.aiming = false;
        this.kickVictim = this.kickTarget();
        this.beginKickRun(this.kickVictim);
      }
    }
    if (this.dropKick.engaged && !this.player.alive) {
      this.dropKick.abort();
      this.player.cinematic = false;
      this.kickVictim = null;
      this.endKickRun();
    }
    this.runKick(this.dropKick, dt);
    this.dropKick.update(dt);
    // Both hands are busy — or holding a drink — so nothing else can happen
    const busy = this.drink.engaged || this.dropKick.engaged;

    if (cutscene) this.cutscenePose(dt);
    const aiming =
      !cutscene && !busy && input.rightHeld && input.pointerLocked && this.player.alive && !this.over &&
      !this.rifle.reloading;
    this.player.aiming = aiming;
    this.player.update(dt, this.level.colliders);
    // Layered on after player.update so the leap and the landing ride on top
    // of the ordinary eye position instead of being overwritten by it
    this.dropKick.applyCamera(this.player);
    if (cutscene) this.cutsceneCamera();

    if (this.phase === 'wake') this.updateWake();
    if (this.phase === 'untie') this.updateUntie(dt);
    const fillTo = this.phase === 'untie' ? 2.4 : this.phase === 'talk' ? 0.7 : 0;
    this.fill.intensity += (fillTo - this.fill.intensity) * Math.min(1, dt * 2);
    this.updateBoss(dt);
    this.updateArms();

    // Agents
    for (let i = 0; i < this.agents.length; i++) {
      const e = this.agents[i];
      e.update(dt);
      if (!e.alive && e.settled && !this.pooled.has(e)) {
        this.pooled.add(e);
        this.poolUnder(e);
        for (const p of e.parts) {
          const k = this.level.shootables.indexOf(p);
          if (k >= 0) this.level.shootables.splice(k, 1);
        }
      }
    }
    if (this.aiDelay > 0) {
      this.aiDelay -= dt;
      if (this.aiDelay <= 0) this.wakeAgent();
    }
    if (this.agentAI && this.agents[1].alive) this.agentAI.update(dt);

    // The gun: comes up after the punch, and is his from then on
    if (busy) {
      // A can in one hand or both boots off the floor: whichever it is, the
      // AK goes back down until he is done with it
      this.rifle.stow = Math.min(1, this.rifle.stow + dt * 6);
    } else if (this.afterT >= 0.45 || this.phase === 'fight' || this.phase === 'search' || this.phase === 'done') {
      this.rifle.stow = Math.max(0, this.rifle.stow - dt * 3);
    }
    if (input.wasPressed('KeyT') && !cutscene && this.player.alive && input.pointerLocked && !this.rifle.reloading) {
      this.emote.toggle();
    }
    if (this.rifle.reloading || cutscene || !this.player.alive) this.emote.cancel();
    this.rifle.hideSupportHand = this.emote.engaged;
    this.rifle.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming);
    this.emote.update(dt, this.player);
    this.drink.update(dt, this.player);
    const targetFov = 74 - 20 * this.rifle.aimBlend;
    if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
      this.player.camera.fov = targetFov;
      this.player.camera.updateProjectionMatrix();
    }
    this.hud.setAiming(this.rifle.aimBlend > 0.5);

    if (!cutscene) this.updateShooting(dt, busy);

    this.updateSearch(dt);
    this.hud.setHealth(this.player.health, this.player.regenProgress);
    this.dialogue.update(dt);
    this.updateDebris(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.world.step(1 / 60, dt, 3);
    input.endFrame();
  }

  // -------------------------------------------------------------- cutscene

  /** Where the camera points, before the player applies it: smoothed onto the target the beat asks for. */
  private cutscenePose(dt: number): void {
    const p = this.player;
    p.position.copy(this.level.chairAt);
    let yaw = 0;
    let pitch = -0.02;
    let rate = 3;
    if (this.phase === 'wake') {
      const t = this.t;
      yaw = track([[0, 0.18], [4.0, 0.12], [WAKE_TIME, 0]], t);
      pitch = track([[0, -0.75], [2.9, -0.72], [3.8, -0.45], [4.6, -0.2], [WAKE_TIME, -0.03]], t);
      rate = 20;
    } else if (this.phase === 'talk') {
      // On the boss; a breath of movement so it is not a still
      yaw = Math.sin(this.t * 0.4) * 0.012;
      pitch = -0.02 + Math.sin(this.t * 0.55) * 0.008;
    } else if (this.phase === 'untie') {
      const [ty, tp] = this.untieLook();
      yaw = ty;
      pitch = tp;
      rate = this.step === 'strike' || this.step === 'windup' ? 14 : 3.2;
    }
    const k = 1 - Math.exp(-dt * rate);
    this.camYaw += (yaw - this.camYaw) * k;
    this.camPitch += (pitch - this.camPitch) * k;
    p.yaw = this.camYaw;
    p.pitch = this.camPitch;
  }

  /** Sat in the chair: the eye is lower than standing, and dazed for a while. */
  private cutsceneCamera(): void {
    const cam = this.player.camera;
    cam.position.y = SEATED_EYE + this.lift;
    if (this.phase === 'wake') {
      cam.rotation.z = track([[0, 0.22], [3.0, 0.18], [4.8, 0.03], [WAKE_TIME, 0]], this.t);
      // Still swimming a little
      cam.position.x += Math.sin(this.t * 0.9) * 0.01 * (1 - clamp01(this.t / WAKE_TIME));
    }
    cam.updateMatrixWorld();
  }

  /** Coming round: eyes cracking open and falling shut, the world swimming into focus. */
  private updateWake(): void {
    const t = this.t;
    const { audio } = this.ctx;
    const open = track(
      [
        [0, 0], [0.9, 0], [1.25, 0.16], [1.6, 0.12], [1.9, 0], [2.5, 0], [2.95, 0.42], [3.4, 0.36],
        [3.7, 0.04], [3.9, 0.04], [4.25, 0.78], [4.5, 0.72], [4.62, 0.1], [4.76, 0.1], [5.05, 1]
      ],
      t
    );
    const lid = (1 - open) * 50;
    this.lids.top.style.height = `${lid}%`;
    this.lids.bot.style.height = `${lid}%`;
    const blur = track([[0, 10], [2.5, 8], [3.4, 5], [4.25, 3], [5.3, 0]], t);
    this.ctx.engine.domElement.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '';
    this.beat('ring', 0.1, () => audio.wakeRing(5.5));
    this.beat('groan1', 2.6, () => audio.groan(0.8));
    this.beat('groan2', 4.35, () => audio.groan(0.45));
    this.beat('bars', 4.3, () => this.letterbox.classList.remove('open'));
    if (t >= WAKE_TIME) {
      this.lids.top.style.height = '0';
      this.lids.bot.style.height = '0';
      this.ctx.engine.domElement.style.filter = '';
      this.startTalk();
    }
  }

  private beat(key: string, at: number, fn: () => void): void {
    if (this.t < at || this.beats.has(key)) return;
    this.beats.add(key);
    fn();
  }

  /**
   * The boss explains. Split where it has to be: his six lines, Ravi's one,
   * and then the order to the agent, said with his head turned to him.
   */
  private startTalk(): void {
    this.phase = 'talk';
    const boss = (text: string) => ({ speaker: 'BOSS', text, pitch: BOSS_PITCH });
    this.dialogue.play(
      [
        boss('You really thought I was on your side, huh Ravi?'),
        boss('Scammers get scammed.'),
        boss('I sold you all out to the police force, Ravi.'),
        boss("They gave me an offer I couldn't resist."),
        boss('I always thought you were the best employee, Ravi.'),
        boss('So, how about we become partners, Ravi?')
      ],
      () =>
        this.dialogue.play([{ speaker: 'RAVI', text: 'I guess bro', pitch: 1.0 }], () => {
          this.bossTurn = 1;
          this.dialogue.play([boss('Untie him.')], () => this.startUntie());
        })
    );
  }

  /** 0 facing Ravi, 1 turned to the agent on his left. */
  private bossTurn = 0;
  private bossTurnNow = 0;

  private updateBoss(dt: number): void {
    const b = this.boss;
    // His escape runs on after he is out of sight — the chair and the vent
    // come after he has gone
    if (this.duckT >= 0) {
      this.updateDuck(dt);
      if (b.root.visible) b.update(dt);
      return;
    }
    if (!b.root.visible) return;
    this.bossTurnNow += ((this.phase === 'untie' && this.step !== 'walkR' ? 0 : this.bossTurn) - this.bossTurnNow) * Math.min(1, dt * 4);
    const talking = this.dialogue.speaker === 'BOSS' && this.dialogue.typing;
    this.poseBoss(this.t, talking, this.bossTurnNow);
    b.update(dt);
  }

  // ---------------------------------------------------------------- untie

  private startUntie(): void {
    this.phase = 'untie';
    this.step = 'walkR';
    this.stepT = 0;
    this.walkLeg = 0;
    const a = this.agents[0];
    a.setRestCarry(false, true);
    a.slingWeapon(true);
  }

  /** The agent's walk over: round the end of the desk, to kneel at Ravi's right hand. */
  private pathR(): THREE.Vector3[] {
    const L = this.level;
    return [
      L.agentAt[0].clone(),
      new THREE.Vector3(L.desk.halfW + 0.5, 0, L.desk.frontZ + 0.15),
      new THREE.Vector3(0.85, 0, L.chairAt.z - 1.05),
      this.kneelSpot(1)
    ];
  }

  /**
   * Beside the chair's arm on `side` (+1 his right), a little in front,
   * facing the wrist — close enough that kneeling he can reach the knot.
   */
  private kneelSpot(side: number): THREE.Vector3 {
    const c = this.level.chairAt;
    return new THREE.Vector3(c.x + side * 0.5, 0, c.z - 0.42);
  }

  /** Walk the agent along `pts`, a leg at a time; true on arrival. */
  private walk(pts: THREE.Vector3[], speed: number, dt: number): boolean {
    const a = this.agents[0];
    while (this.walkLeg < pts.length - 1) {
      const to = pts[this.walkLeg + 1];
      const d = Level6Scene.tmpA.copy(to).sub(a.position).setY(0);
      const len = d.length();
      const stepLen = speed * dt;
      if (len <= stepLen) {
        a.position.set(to.x, 0, to.z);
        this.walkLeg++;
        continue;
      }
      a.position.addScaledVector(d.normalize(), stepLen);
      a.faceToward(to, dt, 6);
      a.setWalk(0.7);
      return false;
    }
    a.setWalk(0);
    return true;
  }

  private next(step: Step): void {
    this.step = step;
    this.stepT = 0;
    this.walkLeg = 0;
  }

  /**
   * The untying, a step at a time: walk round to his right hand, kneel,
   * work the knot, up; across the front of him to the left hand, the same
   * again; up, and in close in front of him — where the punch comes from.
   */
  private updateUntie(dt: number): void {
    const a = this.agents[0];
    const L = this.level;
    const { audio } = this.ctx;
    this.stepT += dt;
    const s = this.stepT;
    // Its own vector, not a scratch one: setHeadLook keeps hold of what it
    // is given and reads it when the agent updates, later in the frame
    const chairEye = this.chairEye.set(L.chairAt.x, SEATED_EYE, L.chairAt.z);

    switch (this.step) {
      case 'walkR':
        if (this.walk(this.pathR(), 1.35, dt)) this.next('kneelR');
        a.setHeadLook(null);
        break;
      case 'kneelR':
      case 'workR': {
        a.faceToward(L.wristR, dt, 8);
        a.setKneeling(true);
        a.setHeadLook(L.wristR);
        this.reachFor(L.wristR, this.step === 'workR' ? s : 0);
        if (this.step === 'kneelR' && s > 0.45) {
          this.next('workR');
          audio.ropeWork(1.4);
        } else if (this.step === 'workR' && s > 1.5) {
          audio.ropeFree();
          L.ropeR.visible = false;
          L.tiedR.visible = false;
          this.freeHand(1);
          this.next('riseR');
        }
        break;
      }
      case 'riseR':
        a.pose = null;
        a.setKneeling(false);
        if (s > 0.45) {
          // Across the front of him to the other hand
          const c = L.chairAt;
          this.walkPts = [a.position.clone(), new THREE.Vector3(c.x, 0, c.z - 0.8), this.kneelSpot(-1)];
          this.next('walkL');
        }
        break;
      case 'walkL':
        if (this.walk(this.walkPts, 1.1, dt)) this.next('kneelL');
        a.setHeadLook(L.wristL);
        break;
      case 'kneelL':
      case 'workL': {
        a.faceToward(L.wristL, dt, 8);
        a.setKneeling(true);
        a.setHeadLook(L.wristL);
        this.reachFor(L.wristL, this.step === 'workL' ? s : 0);
        if (this.step === 'kneelL' && s > 0.45) {
          this.next('workL');
          audio.ropeWork(1.2);
        } else if (this.step === 'workL' && s > 1.3) {
          audio.ropeFree();
          L.ropeL.visible = false;
          L.tiedL.visible = false;
          this.freeHand(-1);
          this.next('riseL');
        }
        break;
      }
      case 'riseL':
        // Up off his knees, turning to the man he has just untied. Standing
        // matters: the ragdoll starts from a standing pose, and killing him
        // on his knees jumped him half a metre up on the frame he died.
        a.pose = null;
        a.setKneeling(false);
        a.faceToward(chairEye, dt, 4);
        a.setHeadLook(chairEye);
        if (s > 0.55) this.next('beat');
        break;
      case 'beat':
        a.faceToward(chairEye, dt, 6);
        a.setHeadLook(this.player.camera.position);
        if (s > 0.35) {
          // Up out of the chair: the sat body stays behind, so it goes —
          // below the frame, with his eyes on the man's face
          L.raviSat.visible = false;
          this.next('windup');
        }
        break;
      case 'windup':
        // Ravi comes up out of the chair as he draws back
        a.setHeadLook(this.player.camera.position);
        if (s > WINDUP) this.next('strike');
        break;
      case 'strike':
        if (s > 0.1 && this.afterT < 0) this.landPunch();
        break;
      case 'after':
        break;
    }
    this.updateHandsInCut(dt);

    // The fallout: the gun comes up, the boss goes, and the cutscene ends
    if (this.afterT >= 0) {
      this.afterT += dt;
      // He is out of the chair as it lands, and on his feet by the end
      this.lift = track([[0, 0.4], [0.6, 0.45]], this.afterT);
      this.player.position.z = L.chairAt.z - 0.18 - (STAND_UP - 0.18) * smooth(this.afterT / 1.0);
      if (this.afterT >= 1.05) this.startFight();
    } else if (this.step === 'windup' || this.step === 'strike') {
      // Coming up out of the chair into it: nearly on his feet as it lands,
      // so the man's face is level with his
      this.lift = this.step === 'windup' ? 0.36 * smooth(s / WINDUP) : 0.36 + 0.04 * smooth(s / 0.1);
      this.player.position.z = L.chairAt.z - (this.step === 'windup' ? 0.18 * smooth(s / WINDUP) : 0.18);
    }
  }
  private walkPts: THREE.Vector3[] = [];
  private chairEye = new THREE.Vector3();

  /** Both of the agent's hands on the knot at `wrist`, working it. */
  private reachFor(wrist: THREE.Vector3, work: number): void {
    const a = this.agents[0];
    a.root.updateMatrixWorld(true);
    const local = a.root.worldToLocal(wrist.clone());
    const pick = Math.sin(work * 11) * 0.03;
    const tug = Math.sin(work * 7.3 + 1) * 0.025;
    a.pose = {
      handR: local.clone().add(new THREE.Vector3(0.05 + pick, 0.01 + tug, 0.02)),
      handL: local.clone().add(new THREE.Vector3(-0.05 - pick, -0.01 - tug, 0.03)),
      elbow: new THREE.Vector3(0.6, -0.6, 0.4),
      // Hunched over the knot: the shoulders and head come forward and down
      // with the chest, or the head sits back over his hips on a stalk
      shift: new THREE.Vector3(0, -0.03, -0.07),
      lean: -0.3
    };
  }

  /** Seconds since each hand came free, or -1 while it is still tied. */
  private freeR = -1;
  private freeL = -1;

  private freeHand(side: number): void {
    if (side > 0) this.freeR = 0;
    else this.freeL = 0;
  }

  /** Where each freed hand is held up in front of him, flexing, until the punch. */
  private restHand(side: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(side * 0.19, -0.2, -0.46);
  }

  /** The hand at rest, turned in a little: knuckles up, fingers forward. */
  private restTurn(side: number): THREE.Quaternion {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, side * 0.35, side * 0.12));
  }

  /**
   * His hands in the cutscene: each lifts off the arm of the chair where it
   * was tied as it comes free, up into view, and flexes the blood back into
   * it; then the right one is thrown.
   */
  private updateHandsInCut(dt: number): void {
    const H = this.hands;
    const cam = this.player.camera;
    const punching = this.step === 'windup' || this.step === 'strike' || this.afterT >= 0;
    for (const side of [1, -1] as const) {
      const hand = side > 0 ? H.right : H.left;
      let ft = side > 0 ? this.freeR : this.freeL;
      // Once the punch is under way both hands are the punch's business
      if (ft < 0 || punching) continue;
      ft += dt;
      if (side > 0) this.freeR = ft;
      else this.freeL = ft;
      hand.visible = true;
      const up = smooth(ft / 0.75);
      // Where it lay: on the end of the chair arm, fingers hanging over it.
      // Taken into camera space afresh each frame — the head is turning.
      const c = this.level.chairAt;
      const lay = cam.worldToLocal(Level6Scene.tmpA.set(c.x + side * 0.25, 0.705, c.z - 0.21));
      const layTurn = Level6Scene.tmpQ.setFromEuler(new THREE.Euler(-0.35, 0, 0)).premultiply(cam.quaternion.clone().invert());
      hand.root.position.lerpVectors(lay, this.restHand(side), up);
      hand.root.quaternion.slerpQuaternions(layTurn, this.restTurn(side), up);
      // Hanging limp off the end of the chair arm, then a straight wrist
      hand.straight = up;
      // Slack as it comes off the chair, then open, shut, open, shut: getting
      // the feeling back, ending half closed
      hand.curl = ft < 0.5 ? 0.6 - 0.5 * smooth(ft / 0.5) : ft < 2.22 ? 0.5 - 0.42 * Math.cos((ft - 0.5) * 8.5) : 0.7;
    }

    if (!punching) return;
    // The punch: the right hand winds back and goes into his face, the
    // shoulder going in behind it
    const r = H.right;
    const l = H.left;
    const restL = this.restHand(-1);
    r.straight = 1;
    l.straight = 1;
    if (this.afterT < 0) {
      r.visible = true;
      l.root.position.copy(restL);
      const head = this.agents[0].headWorld(Level6Scene.tmpA);
      const target = cam.worldToLocal(head.clone());
      // Stop at the face, not inside it
      target.addScaledVector(target.clone().normalize(), -0.12);
      const back = new THREE.Vector3(0.25, -0.32, -0.3);
      const dir = target.clone().sub(back).normalize();
      const aim = Level6Scene.tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      r.curl = 1;
      const drawn = new THREE.Vector3(0.03, -0.02, 0.06);
      const thrown = new THREE.Vector3(-0.04, 0.03, -0.1);
      if (this.step === 'windup') {
        const k = smooth(this.stepT / WINDUP);
        r.root.position.lerpVectors(this.restHand(1), back, k);
        r.root.quaternion.slerpQuaternions(this.restTurn(1), aim, k);
        this.punchLean.copy(drawn).multiplyScalar(k);
      } else {
        const k = clamp01(this.stepT / 0.1);
        r.root.position.lerpVectors(back, target, k * k);
        r.root.quaternion.copy(aim);
        this.punchLean.lerpVectors(drawn, thrown, k * k);
        this.punchAt.copy(r.root.position);
      }
      return;
    }
    // Drawn back and down out of shot, both hands, as the gun comes up
    const k = smooth((this.afterT - 0.1) / 0.45);
    r.root.position.lerpVectors(this.punchAt, new THREE.Vector3(0.3, -0.75, -0.25), k);
    l.root.position.lerpVectors(restL, new THREE.Vector3(-0.3, -0.75, -0.25), k);
    this.punchLean.multiplyScalar(1 - k);
    if (this.afterT > 0.6) {
      r.visible = false;
      l.visible = false;
    }
  }

  /** How far his right shoulder has gone into the punch, in his body's frame. */
  private punchLean = new THREE.Vector3();

  /**
   * Hang his arms from his shoulders. Those are on his body, not his head:
   * sat in the chair it faces the desk, and it turns only part of the way
   * the head does — so looking down at one wrist, that shoulder is there
   * beside the camera, and the arm runs from it as it should.
   */
  private updateArms(): void {
    const H = this.hands;
    if (!H.right.visible && !H.left.visible) return;
    const cam = this.player.camera;
    const bodyYaw = this.camYaw * 0.6;
    const at = (side: number, out: THREE.Vector3): THREE.Vector3 => {
      out.set(side * 0.2, -0.3, 0.03);
      if (side > 0) out.add(this.punchLean);
      out.applyAxisAngle(Level6Scene.UP, bodyYaw).add(cam.position);
      return cam.worldToLocal(out);
    };
    H.update(at(1, Level6Scene.shoulderR), at(-1, Level6Scene.shoulderL));
  }
  private static UP = new THREE.Vector3(0, 1, 0);
  private static shoulderR = new THREE.Vector3();
  private static shoulderL = new THREE.Vector3();

  /** Where the camera looks during the untying: at him, and where his hands are. */
  private untieLook(): [number, number] {
    const a = this.agents[0];
    const eye = this.player.eyePosition(Level6Scene.tmpA);
    eye.y = SEATED_EYE + this.lift;
    const look = (p: THREE.Vector3): [number, number] => {
      const d = p.clone().sub(eye);
      return [Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z))];
    };
    switch (this.step) {
      case 'walkR': {
        const [y, p] = look(a.eyePosition(new THREE.Vector3()));
        return [THREE.MathUtils.clamp(y, -1.0, 1.0), p * 0.6];
      }
      case 'kneelR':
      case 'workR':
      case 'riseR':
        return [-0.62, -0.45];
      case 'walkL': {
        const [y] = look(a.eyePosition(new THREE.Vector3()));
        return [THREE.MathUtils.clamp(y, -0.7, 0.7), -0.3];
      }
      case 'kneelL':
      case 'workL':
        return [0.62, -0.45];
      default: {
        // Face to face with him for the punch
        const [y, p] = look(a.headWorld(new THREE.Vector3()));
        return [y, p - 0.05];
      }
    }
  }

  /**
   * The right hand arrives. He goes over backwards, dead, his AK is Ravi's,
   * the other agent finds his rifle, and the boss goes for the floor.
   */
  private landPunch(): void {
    const { audio } = this.ctx;
    const a = this.agents[0];
    this.afterT = 0;
    this.next('after');
    audio.punchHit();
    const head = a.headWorld(new THREE.Vector3());
    const dir = head.clone().sub(this.player.camera.position).setY(0).normalize();
    dir.y = 0.35;
    dir.normalize();
    this.killEnemy(a, head, dir, true, true, 'head');
    // A spray off the blow, not a gunshot's worth
    this.particles.bloodSpray(head, dir, false, 0.02);
    this.duckT = 0;
    // The other one brings his rifle up off the rest
    const b = this.agents[1];
    b.faceToward(this.player.position, 1, 10);
    b.setAiming(true);
    audio.enemyShout(3);
  }

  // ----------------------------------------------------------- the boss goes

  /**
   * He goes off the chair and down behind the desk, and he is gone: the
   * chair is shoved aside, the vent cover comes off, and something heavy
   * scrambles away inside the wall. None of it where Ravi can see.
   */
  private updateDuck(dt: number): void {
    const L = this.level;
    const b = this.boss;
    const { audio } = this.ctx;
    const was = this.duckT;
    this.duckT += dt;
    const t = this.duckT;
    if (was < 0.12 && t >= 0.12) audio.chairScrape();
    const k = smooth((t - 0.12) / 0.38);
    b.root.position.set(L.bossAt.x, -0.72 * k, L.bossAt.z - 0.22 * k);
    b.pose = { shift: new THREE.Vector3(0, 0, -0.1), head: new THREE.Euler(0.3 * k, 0, 0), lean: 0.4 * k };
    if (t > 0.6) {
      b.root.visible = false;
      this.boss.root.position.set(0, -20, 0);
    }
    if (was < 1.25 && t >= 1.25) this.shoveChair();
    if (was < 1.45 && t >= 1.45) this.openVent(true);
  }

  private shoveChair(): void {
    const L = this.level;
    const s = L.bossChairShoved;
    L.bossChair.position.copy(s.pos);
    L.bossChair.rotation.y = s.yaw;
    L.bossChairCollider.box.setFromCenterAndSize(
      new THREE.Vector3(s.pos.x, 0.5, s.pos.z),
      new THREE.Vector3(0.66, 1.0, 0.66)
    );
  }

  private openVent(sound: boolean): void {
    const L = this.level;
    L.ventCover.position.copy(L.ventCoverOff.pos);
    L.ventCover.rotation.copy(L.ventCoverOff.rot);
    if (sound) this.ctx.audio.ventRattle(this.player.position.distanceTo(L.ventMouth));
  }

  // ------------------------------------------------------------------ fight

  /** The cutscene ends on his feet with the dead man's AK: one agent left. */
  private startFight(): void {
    this.phase = 'fight';
    this.afterT = -1;
    this.lift = 0;
    this.player.cinematic = false;
    this.player.position.set(this.level.chairAt.x, 0, this.level.chairAt.z - STAND_UP);
    this.player.yaw = this.camYaw;
    this.player.pitch = this.camPitch;
    this.letterbox.classList.add('open');
    this.hud.show();
    this.hud.setAmmo(this.rifleAmmo, RIFLE_MAG, false);
    this.setObjective('KILL THE AGENT');
    this.ctx.input.requestPointerLock();
    // A breath before he opens up
    this.aiDelay = 0.65;
  }

  private wakeAgent(): void {
    const b = this.agents[1];
    if (!b.alive || this.agentAI) return;
    // The fight's carry is the AI's business from here on
    b.setRestCarry(false);
    this.agentAI = new EnemyAI(b, {
      player: this.player,
      waypoints: this.level.waypoints,
      occluders: this.level.occluders,
      colliders: this.level.colliders,
      bus: this.ctx.bus,
      audio: this.ctx.audio,
      enemyFire: (e) => this.enemyFire(e)
    });
    this.ctx.bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 30, kind: 'gunshot' });
  }

  /**
   * Who the drop kick would land on right now, if anyone. Only the agents are
   * ever candidates: the boss leaves this room through the vent and nothing
   * else, so a boot must not be able to take that off him.
   */
  private kickTarget(): Enemy | null {
    if (!this.playable) return null;
    return this.kickTargetFrom(this.agents);
  }

  private updateShooting(dt: number, busy: boolean): void {
    const { input, audio } = this.ctx;
    this.fireCooldown -= dt;
    const switching = this.rifle.stow > 0.1;
    const canFire =
      this.player.alive && !this.over && this.fireCooldown <= 0 && input.pointerLocked &&
      !this.player.sprinting && !this.rifle.reloading && !switching && !busy;
    const clicked = input.consumeClick();
    if (input.mouseHeld && canFire) {
      if (this.rifleAmmo > 0) {
        this.fireCooldown = RIFLE_COOLDOWN;
        this.rifleAmmo--;
        this.playerShootRifle();
      } else if (clicked) {
        audio.dryFire();
        this.startRifleReload();
      }
    }
    if (
      input.wasPressed('KeyR') && this.player.alive && !this.player.sprinting && !switching && !busy &&
      this.rifleAmmo < RIFLE_MAG
    ) {
      this.startRifleReload();
    }
    this.hud.setAmmo(this.rifleAmmo, RIFLE_MAG, this.rifle.reloading);
  }

  private startRifleReload(): void {
    if (this.rifle.startReload()) this.player.aiming = false;
  }

  private playerShootRifle(): void {
    const { audio, bus } = this.ctx;
    audio.rifleShot();
    this.rifle.fire();
    bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 36, kind: 'gunshot' });
    const speedFactor = this.player.currentSpeed / 6.6;
    let spread = 0.012 + speedFactor * 0.03 + (this.player.crouching ? -0.003 : 0);
    spread *= 1 - 0.7 * this.rifle.aimBlend;
    this.player.pitch += 0.006 + Math.random() * 0.004;
    this.player.yaw += (Math.random() - 0.5) * 0.006;
    const eye = this.player.eyePosition();
    const dir = new THREE.Vector3();
    this.player.camera.getWorldDirection(dir);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    const end = this.castBullet(eye, dir, null);
    this.particles.tracer(this.rifle.muzzleWorld(), end);
  }

  /** A polymer mag on concrete: it bounces and skitters. */
  private magMat: CANNON.Material | null = null;
  private magMaterial(): CANNON.Material {
    if (!this.magMat) {
      this.magMat = new CANNON.Material('rifleMag');
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(this.magMat, this.world.defaultMaterial, { restitution: 0.45, friction: 0.22 })
      );
    }
    return this.magMat;
  }

  private dropRifleMagazine(): void {
    const mesh = this.rifle.makeDroppedMag();
    if (!mesh) return;
    const { position, quaternion, velocity, angularVelocity } = this.rifle.ejectedMagPose();
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    const body = new CANNON.Body({
      mass: 0.4,
      shape: new CANNON.Box(new CANNON.Vec3(0.03, 0.075, 0.014)),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      linearDamping: 0.02,
      angularDamping: 0.12,
      material: this.magMaterial()
    });
    body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    body.velocity.set(velocity.x, velocity.y, velocity.z);
    body.angularVelocity.set(angularVelocity.x, angularVelocity.y, angularVelocity.z);
    this.addDebris(mesh, body);
  }

  protected killEnemy(
    enemy: Enemy,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    byPlayer: boolean,
    headshot: boolean,
    hitPart?: string,
    impulseScale = 1,
    /** A boot rather than a bullet: no hole, and no blood thrown. */
    opts: { wound?: boolean; keepWeapon?: boolean } = {}
  ): void {
    if (!enemy.alive || enemy.boss) return;
    if (enemy === this.agents[0]) {
      // Punched, not shot: no hole, and the rifle is Ravi's now
      enemy.die(point, dir, this.world, 'head', 0.85, { wound: false, keepWeapon: true });
      return;
    }
    enemy.die(point, dir, this.world, hitPart === 'head' ? 'head' : 'torso', impulseScale, opts);
    this.agentAI?.dispose();
    this.ctx.bus.emit(Events.EnemyKilled, { name: enemy.name, remaining: 0, headshot, by: byPlayer ? 'RAVI' : 'FRIENDLY FIRE' });
    if (this.phase === 'fight') {
      this.phase = 'search';
      this.searchT = 0;
      this.setObjective('CHECK BEHIND THE DESK');
    }
  }

  /** Round the back of the desk: the chair shoved aside, and the vent open. */
  private updateSearch(dt: number): void {
    if (this.phase === 'search') {
      const p = this.player.position;
      if (this.level.behindDesk.containsPoint(new THREE.Vector3(p.x, p.y + 0.9, p.z))) {
        this.phase = 'done';
        this.searchT = 0;
        this.setObjective('THE BOSS IS GONE — HE ESCAPED THROUGH THE VENT');
      }
    } else if (this.phase === 'done') {
      const was = this.searchT;
      this.searchT += dt;
      if (was < 4 && this.searchT >= 4) this.ctx.bus.emit(Events.Level6Complete);
    }
  }

  /** A restart after dying in the fight: straight back into it. */
  private skipToFight(): void {
    const L = this.level;
    L.ropeR.visible = false;
    L.ropeL.visible = false;
    L.tiedR.visible = false;
    L.tiedL.visible = false;
    L.raviSat.visible = false;
    this.shoveChair();
    this.openVent(false);
    const a = this.agents[0];
    a.setRestCarry(false, true);
    a.slingWeapon(true);
    a.position.copy(this.kneelSpot(-1));
    this.agents[1].setAiming(true);
    a.root.updateMatrixWorld(true);
    const head = a.eyePosition(new THREE.Vector3());
    this.killEnemy(a, head, new THREE.Vector3(-0.5, 0.3, -1).normalize(), true, true, 'head');
    // The boss stays in his chair only long enough to be photographed
    this.duckAfterPhoto = true;
    this.phase = 'fight';
    this.rifle.stow = 0;
    this.player.cinematic = false;
    this.player.position.set(L.chairAt.x, 0, L.chairAt.z - STAND_UP);
    this.player.yaw = 0;
    this.player.pitch = -0.04;
    this.lids.top.style.height = '0';
    this.lids.bot.style.height = '0';
    this.letterbox.classList.add('open');
    this.hud.show();
    this.setObjective('KILL THE AGENT');
    this.aiDelay = 0.9;
  }

  // ---------------------------------------------------------------- input

  private onClick(): void {
    if (this.dialogue.isActive) {
      this.dialogue.advance();
      return;
    }
    if (this.phase === 'dead') this.ctx.bus.emit(Events.RestartLevel6);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.phase === 'dead') {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') this.ctx.bus.emit(Events.RestartLevel6);
      return;
    }
    if (this.dialogue.isActive && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) {
      e.preventDefault();
      this.dialogue.advance();
    }
  }

  // ---------------------------------------------------------------- render

  /**
   * The portrait behind him is a photograph of this room: on the first frame,
   * with him posed at his desk, a second camera takes it from across the desk
   * and the picture on the wall shows it from then on.
   */
  private takePhoto(renderer: THREE.WebGLRenderer): void {
    const L = this.level;
    const { from, to, fov, aspect } = L.photoCam;
    const cam = new THREE.PerspectiveCamera(fov, aspect, 0.05, 20);
    cam.position.copy(from);
    cam.lookAt(to);
    cam.updateMatrixWorld();
    const target = new THREE.WebGLRenderTarget(1024, 768, { type: THREE.HalfFloatType });
    // Only the picture itself is hidden for it. Hiding anything that carries
    // a light (the viewmodels, under the player's camera) would change the
    // light count for this one render and recompile everything twice.
    L.photoMesh.visible = false;
    this.scene.updateMatrixWorld(true);
    renderer.setRenderTarget(target);
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(null);
    L.photoMesh.visible = true;
    L.photo.map = target.texture;
    L.photo.emissiveMap = target.texture;
    L.photo.color.setHex(0xffffff);
    // A little of its own light, or a photo in a room this dim is a black square
    L.photo.emissiveIntensity = 0.35;
    L.photo.needsUpdate = true;
    this.photoTaken = true;
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    if (!this.photoTaken) {
      this.takePhoto(renderer);
      // On a restart he is photographed and then gone
      if (this.duckAfterPhoto) this.duckT = 0.7;
    }
    if (this.needsCompile) {
      this.needsCompile = false;
      renderer.compile(this.scene, this.player.camera);
    }
    renderer.render(this.scene, this.player.camera);
  }
}
