import * as THREE from 'three';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level5Builder, Level5Data, ElevatorCar } from '../environment/Level5Builder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { FPSPlayer } from '../entities/FPSPlayer';
import { WeaponViewmodel } from '../entities/WeaponViewmodel';
import { EmoteViewmodel } from '../entities/EmoteViewmodel';
import { ShotgunViewmodel } from '../entities/ShotgunViewmodel';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { DropKickViewmodel } from '../entities/DropKickViewmodel';
import { Enemy } from '../entities/Enemy';
import { FPSHUD } from '../ui/FPSHUD';
import { DialogueBox } from '../ui/DialogueBox';
import { ElectricArcs } from '../fx/ElectricArcs';
import { GrabHand } from '../entities/GrabHand';
import { LEVER_ON } from '../environment/MechanicalProps';

const FIRE_COOLDOWN = 0.17;
const MAG_SIZE = 10;
const TUBE_SIZE = 6;
/**
 * Torch strength when on. Physical units: at the old 2.1 the beam reaching a
 * floor six metres off in a big room delivered next to nothing, which Level
 * 4's small rooms had been hiding. Measured by screenshot, not guessed.
 */
const TORCH_ON = 16;

/** How long the doors take to run, and how long the car is on the move. */
const DOOR_TIME = 1.2;
const RIDE_TIME = 2.2;
const FADE_TIME = 0.55;
/** How long the load card holds on black before the basement fades up. */
const CARD_TIME = 1.1;
/** How close the panel has to be for E to reach it. */
const REACH = 1.9;
/** The fluorescents' strength once the breaker is back on. */
const MAIN_LIGHT = 4.5;
/**
 * The lights coming back after the breaker: on, off, on, off, then steady.
 * [seconds after the throw, on?]
 */
const POWER_FLICKER: [number, boolean][] = [
  [0.45, true],
  [0.55, false],
  [0.8, true],
  [0.88, false],
  [1.15, true]
];

/**
 * The breaker cutscene, in seconds from the E press: the hand goes to the
 * lever, fights it, throws it; the lights come back; he turns round.
 */
const CUT = {
  SETTLE: 0.7, // stood square at the switch, looking down at it
  REACH: 0.42, // his hand comes into shot
  GRAB: 1.05, // closed round the handle
  SNAP: 2.6, // it gives
  THROWN: 2.84, // home at ON: the lamp goes green and the plant spins up
  LETGO: 3.15, // hand off it and back out of shot
  LOOKUP: 3.05, // eyes up to the label as the tubes strike
  TURN0: 4.45, // lights steady; he turns round
  TURN1: 5.4, // ...and there is somebody there
  WIND: 6.0, // the gun goes up
  STRIKE: 6.34, // and comes down
  HIT: 6.47, // black
  END: 9.6 // on to whatever comes next
};
/**
 * Where he stands to work the lever: off the cabinet's face, and a touch to
 * the right of it, so his right arm comes into shot across the frame rather
 * than straight up from under it.
 */
const STAND_OFF = 0.9;
const STAND_RIGHT = 0.12;
/** How far behind him the agent is standing when he turns. */
const AGENT_BEHIND = 1.04;
/** The torch as the cutscene's fill light, from the eye rather than past the gun. */
const CUT_TORCH = 4;
/**
 * The lever fighting back, from the grab to the snap: [seconds after the
 * grab, angle]. It gives a little, slips back, binds, gives a little more —
 * and then goes all at once.
 */
const STRAIN: [number, number][] = [
  [0, 0],
  [0.32, -0.03],
  [0.58, -0.17],
  [0.8, -0.1],
  [1.25, -0.23],
  [CUT.SNAP - CUT.GRAB, -0.27]
];

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

type Stage = 'hall' | 'closing' | 'ride' | 'fadeOut' | 'card' | 'fadeIn' | 'opening' | 'room';

/**
 * Level5Scene — the service lift down to the mechanical room.
 *
 * Ravi comes out of the dark floor into a dead corridor with a lift at the
 * end of it: the only thing in the building still lit, on its own backup
 * supply. He steps in, reminds himself why he is here, and sends it down.
 *
 * None of the ride is a cutscene. He keeps control the whole way: the doors
 * close round him, he can walk about the car while it moves, and the screen
 * goes to black and comes back with him standing in the same spot in an
 * identical car, 200m away, as its doors open on the basement.
 *
 * The breaker is. His own hand takes the lever and has to fight it over, the
 * lights stutter back on, and he turns round into an agent who has been
 * standing behind him — who puts him down with the gun.
 */
export class Level5Scene extends CombatScene<Level5Data> {
  private weapon!: WeaponViewmodel;
  private emote!: EmoteViewmodel;
  private shotgun!: ShotgunViewmodel;
  /** Deadbull on G: three seconds with no gun, and he's back on full health. */
  private drink!: DrinkViewmodel;
  /** Drop kick on Q. */
  private dropKick!: DropKickViewmodel;
  /** Who the kick was aimed at when Q went down. */
  private kickVictim: Enemy | null = null;
  private hud!: FPSHUD;
  private dialogue!: DialogueBox;

  private active: 'pistol' | 'shotgun' = 'pistol';
  private wanted: 'pistol' | 'shotgun' = 'pistol';
  private ammo = MAG_SIZE;
  private shells = TUBE_SIZE;
  private fireCooldown = 0;

  private torch!: THREE.SpotLight;
  private torchOn = false;

  private stage: Stage = 'hall';
  private stageT = 0;
  /** 1 = fully open, 0 = shut. */
  private openA = 1;
  private openB = 0;
  /** Ravi has said his line; the panel is now what he is waiting on. */
  private toldWhy = false;
  /** The E that closed the dialogue must not also press a button. */
  private eSpent = false;

  private ui!: HTMLElement;
  private objective!: HTMLElement;
  private prompt!: HTMLElement;
  private fadeEl!: HTMLElement;
  private card: HTMLElement | null = null;
  private flashEl!: HTMLElement;

  // ---- The basement
  private arcs!: ElectricArcs;
  private arcTimer = 0;
  private sparkTimer = 1;
  /** Clock for the swell that the bodies and helmets ride. */
  private floatT = 0;
  /** Seconds into an electrocution, or -1 when not being electrocuted. */
  private zapT = -1;
  private respawned = false;
  /** Where along the route he is, for the objective line. */
  private leg: 'corridors' | 'hall' | 'crossed' = 'corridors';
  private powered = false;
  private powerT = -1;
  private flickerStep = 0;

  // ---- The cutscene at the breaker
  private hand!: GrabHand;
  private agent!: Enemy;
  private letterbox!: HTMLElement;
  /** Seconds into it, or -1 before it starts. */
  private cutT = -1;
  private cutFrom = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private cutBeats = new Set<string>();
  /** Where he stands for it, and the pose the agent's arm goes through. */
  private standAt = new THREE.Vector3();
  private agentAt = new THREE.Vector3();
  private aimQ = new THREE.Quaternion();
  private windQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(3.2, 0, 0.6));
  private strikeQ = new THREE.Quaternion();
  private armQ = new THREE.Quaternion();
  private leftQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0, -0.12));
  private knockedOut = false;
  private unsubs: (() => void)[] = [];
  private dead = false;
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private clickHandler = (): void => this.onClick();
  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();

  constructor(ctx: GameContext) {
    super(ctx);
  }

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x030405);
    this.scene.fog = new THREE.Fog(0x030405, 10, 38);

    this.level = new Level5Builder().build();
    this.scene.add(this.level.group);
    this.world = this.createPhysicsWorld(this.level.colliders);

    this.player = new FPSPlayer(this.level.playerSpawn, this.level.playerSpawnYaw, input, audio, bus);
    this.scene.add(this.player.camera);

    this.weapon = new WeaponViewmodel(this.player.camera);
    this.shotgun = new ShotgunViewmodel(this.player.camera);
    this.emote = new EmoteViewmodel(this.player.camera);
    this.shotgun.stow = 1;

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
        // Asked again at the last instant rather than trusting who was in
        // front when the key went down. Down here the answer is always
        // nobody, but the move is the same move wherever it is thrown.
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

    // Same torch as the dark floor, and the only way to see down here — the
    // goggles went in level four. On-but-zero, driven by intensity only.
    this.torch = new THREE.SpotLight(0xffe6c0, 0, 18, Math.PI / 8, 0.5, 1.6);
    // The beam starts out past the muzzle. Sat at the eye, the gun was the
    // nearest thing in the cone by a long way and took nearly all of it —
    // turning the torch up enough to reach the floor just blew the gun out.
    this.torch.position.set(0.06, -0.1, -0.7);
    this.torch.target.position.set(0.06, -0.2, -1.7);
    this.player.camera.add(this.torch);
    this.player.camera.add(this.torch.target);

    this.particles = new ParticleManager(this.scene);
    this.decals = new BloodDecalSystem(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene);
    Enemy.flashPool = this.flashPool;
    this.arcs = new ElectricArcs(this.scene, 8);

    // The basement car waits with its doors shut
    this.setDoors(this.level.carB, 0);

    // The cutscene's cast, built now and hidden: made on the night, the
    // agent's materials and the hand's would compile on the frame they
    // first appear. Neither carries a light, so showing them later does not
    // move the scene's light count.
    this.hand = new GrabHand(this.scene);
    const B = this.level.breaker;
    // Facing the cabinet (-x), his right is -z
    this.standAt.set(B.faceX + STAND_OFF, 0, B.z - STAND_RIGHT);
    this.agentAt.set(this.standAt.x + AGENT_BEHIND, 0, this.standAt.z);
    this.agent = new Enemy(this.agentAt, Math.PI / 2, 1, { name: 'AGENT' });
    this.agent.equipPistol();
    this.agent.root.visible = false;
    this.scene.add(this.agent.root);

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, 0, this.player.maxHealth);
    this.hud.show();
    this.buildUI();
    this.dialogue = new DialogueBox(this.ctx.uiRoot, audio);

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }),
      bus.on(Events.PlayerDied, () => {
        this.dead = true;
      })
    );
    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('click', this.clickHandler);
    input.requestPointerLock();
    this.setObjective('TAKE THE LIFT');
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('click', this.clickHandler);
    this.hud.destroy();
    this.dialogue.destroy();
    this.flashPool.dispose();
    this.arcs.dispose();
    this.hand.dispose();
    this.ui.remove();
    this.card?.remove();
    Enemy.flashPool = null;
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="intro-letterbox open"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="torch-hint">[ F ] FLASHLIGHT</div>
      <div class="l5-prompt" style="position:absolute;left:50%;top:58%;transform:translateX(-50%);
        font:bold 13px monospace;letter-spacing:3px;color:#ffd27a;text-shadow:0 0 6px #000;
        display:none;pointer-events:none"></div>
      <div class="intro-fade"></div>
      <div class="l5-zap" style="position:absolute;inset:0;background:#cdf6ff;opacity:0;pointer-events:none;
        mix-blend-mode:screen"></div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.prompt = el.querySelector('.l5-prompt')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
    this.flashEl = el.querySelector('.l5-zap')!;
  }

  private setObjective(text: string): void {
    if (this.objective.textContent === text) return;
    this.objective.textContent = text;
    this.objective.classList.remove('show');
    void this.objective.offsetWidth;
    this.objective.classList.add('show');
  }

  // ------------------------------------------------------------------ lift

  /** Slide a car's two leaves to `open` (1 open, 0 shut). */
  private setDoors(car: ElevatorCar, open: number): void {
    const hw = 0.62;
    car.leftDoor.position.z = -hw * 0.5 - hw * open;
    car.rightDoor.position.z = hw * 0.5 + hw * open;
    // Passable once there is a body's width of gap, not before
    car.doorCollider.disabled = open > 0.72;
  }

  private insideCar(car: ElevatorCar): boolean {
    const p = this.player.position;
    return car.interior.containsPoint(Level5Scene.tmpA.set(p.x, 0.9, p.z));
  }

  /** Is the crosshair on the panel, close enough to press? */
  private aimingAtPanel(car: ElevatorCar): boolean {
    return this.aimingAt(car.panel, REACH);
  }

  /** Is the crosshair on `target` within `reach` metres? */
  private aimingAt(target: THREE.Object3D, reach: number): boolean {
    const eye = this.player.eyePosition(Level5Scene.tmpA);
    const dir = this.player.camera.getWorldDirection(Level5Scene.tmpB);
    this.raycaster.set(eye, dir);
    this.raycaster.far = reach;
    return this.raycaster.intersectObject(target, true).length > 0;
  }

  // -------------------------------------------------------------- basement

  /**
   * The live water: arcs striking across it, a cold light that jumps with
   * every one, and a junction box on the pit wall spitting sparks. All of it
   * is the warning — nothing down there says "don't" in words except the
   * signs, and nobody reads signs.
   */
  private updateHazard(dt: number): void {
    // Out cold: the water can crackle away where nobody can hear it
    if (this.knockedOut) return;
    const L = this.level;
    this.arcTimer -= dt;
    if (this.arcTimer <= 0) {
      this.arcTimer = 0.12 + Math.random() * 0.33;
      const spot = L.arcSpots[Math.floor(Math.random() * L.arcSpots.length)];
      if (this.arcs.strike(spot)) this.ctx.audio.electricCrackle(this.player.position.distanceTo(spot));
    }
    const live = this.arcs.update(dt);
    L.waterLight.intensity = 0.4 + Math.random() * 0.3 + live * (1.4 + Math.random() * 1.2);
    // Lower than it was: the water used to glow its own colour whatever the
    // room was doing, which is the one thing standing water never does.
    L.waterMat.emissiveIntensity = 0.15 + live * 0.2 + Math.random() * 0.04;
    // Three layers drifting at different speeds and angles. One scrolling
    // texture always reads as a picture being slid along underneath; crossed
    // at different rates they interfere, which is what moving water does.
    // The normals are the important one — they are what bends the highlights.
    if (L.waterMat.map) {
      L.waterMat.map.offset.x += dt * 0.018;
      L.waterMat.map.offset.y += dt * 0.011;
    }
    if (L.waterMat.normalMap) {
      L.waterMat.normalMap.offset.x -= dt * 0.026;
      L.waterMat.normalMap.offset.y += dt * 0.034;
      // The chop picks up while the water is live
      const chop = 0.5 + live * 0.5;
      L.waterMat.normalScale.set(chop, chop);
    }
    if (L.waterGlintMat.map) {
      L.waterGlintMat.map.offset.x += dt * 0.043;
      L.waterGlintMat.map.offset.y -= dt * 0.007;
      L.waterGlintMat.opacity = 0.12 + live * 0.24 + Math.random() * 0.02;
    }
    // What is floating in it rides the swell: a slow bob and a lazy turn,
    // each on its own phase so they are not a raft
    this.floatT += dt;
    for (let i = 0; i < L.floaters.length; i++) {
      const f = L.floaters[i];
      const p = this.floatT * 0.6 + i * 1.7;
      f.position.y = L.pit.waterY + Math.sin(p) * 0.022;
      f.rotation.z = Math.sin(p * 0.8 + 1.1) * 0.035;
      f.rotation.x = Math.sin(p * 0.63) * 0.028;
    }

    this.sparkTimer -= dt;
    if (this.sparkTimer <= 0) {
      this.sparkTimer = 0.5 + Math.random() * 1.4;
      this.particles.electricSparks(L.sparkAt, 8);
      this.ctx.audio.electricCrackle(this.player.position.distanceTo(L.sparkAt));
    }

    // Stepping off into it
    if (this.zapT < 0 && this.stage === 'room') {
      const q = this.player.position;
      const pit = L.pit;
      if (q.x > pit.x0 && q.x < pit.x1 && q.z > pit.z0 && q.z < pit.z1 && q.y < pit.deathY) this.startZap();
    }
    if (this.zapT >= 0) this.updateZap(dt);

    // The objective follows him along the route
    const x = this.player.position.x;
    if (this.stage === 'room' && this.zapT < 0) {
      if (this.leg === 'corridors' && x < L.pit.x1 + 4) {
        this.leg = 'hall';
        if (!this.powered) this.setObjective('CROSS THE BROKEN FLOOR — THE WATER IS LIVE');
      } else if (this.leg === 'hall' && x < L.pit.x0) {
        this.leg = 'crossed';
        if (!this.powered) this.setObjective('RESET THE MAIN BREAKER');
      }
    }
  }

  /** In the water: flash, buzz, then back to the near ledge to try again. */
  private startZap(): void {
    // The current owns him from here, so anything else holding the camera
    // lets go of it first
    this.cancelKick();
    this.drink.abort();
    this.zapT = 0;
    this.respawned = false;
    this.player.cinematic = true;
    this.player.velocity.set(0, 0, 0);
    this.ctx.audio.electrocute();
    this.particles.electricSparks(this.player.position.clone().setY(this.level.pit.waterY + 0.1), 22);
  }

  private updateZap(dt: number): void {
    this.zapT += dt;
    const t = this.zapT;
    // A stutter of blue-white while the current goes through him
    this.flashEl.style.opacity = t < 0.7 ? String(Math.random() < 0.5 ? 0.8 : 0.2) : '0';
    if (t < 0.8) {
      const cam = this.player.camera.position;
      cam.x += (Math.random() - 0.5) * 0.07;
      cam.y += (Math.random() - 0.5) * 0.07;
      cam.z += (Math.random() - 0.5) * 0.07;
    }
    if (t > 0.7 && t < 1.15) this.fadeEl.style.opacity = String(Math.min(1, (t - 0.7) / 0.35));
    if (t >= 1.15 && !this.respawned) {
      this.respawned = true;
      const cp = this.level.checkpoint;
      this.player.position.copy(cp.pos);
      this.player.velocity.set(0, 0, 0);
      this.player.yaw = cp.yaw;
      this.player.pitch = 0;
    }
    if (t >= 1.15) this.fadeEl.style.opacity = String(Math.max(0, 1 - (t - 1.15) / 0.5));
    if (t >= 1.65) {
      this.zapT = -1;
      this.fadeEl.style.opacity = '0';
      this.flashEl.style.opacity = '0';
      this.player.cinematic = false;
      this.setObjective('JUMP THE GAPS — STAY OUT OF THE WATER');
    }
  }

  /** The main breaker: aim, E, and the cutscene takes it from there. */
  private updateBreaker(dt: number): void {
    const L = this.level;
    if (!this.powered && this.stage === 'room' && this.zapT < 0) {
      const on = this.aimingAt(L.breaker.target, 2.1);
      if (on) {
        this.prompt.textContent = '[ E ]  RESET THE BREAKER';
        this.prompt.style.display = 'block';
      } else if (this.prompt.textContent === '[ E ]  RESET THE BREAKER') {
        this.prompt.style.display = 'none';
      }
      if (on && this.ctx.input.wasPressed('KeyE') && !this.eSpent && !this.busy) {
        this.powered = true;
        this.prompt.style.display = 'none';
        this.startCutscene();
      }
    }
    // The lights coming back, once the lever is home
    if (this.powerT >= 0) {
      this.powerT += dt;
      while (this.flickerStep < POWER_FLICKER.length && this.powerT >= POWER_FLICKER[this.flickerStep][0]) {
        const on = POWER_FLICKER[this.flickerStep++][1];
        for (const l of L.mainLights) l.intensity = on ? MAIN_LIGHT : 0;
        L.tubeMat.emissiveIntensity = on ? 1.5 : 0;
        this.ctx.audio.fluorescentBuzz(on ? 0.24 : 0.12, on ? 0.36 : 0.2);
      }
      if (this.flickerStep >= POWER_FLICKER.length) {
        this.powerT = -1;
        for (const l of L.redLights) l.intensity = 0.25;
        L.ambient.intensity = 0.42;
      }
    }
  }

  // ---------------------------------------------------- the breaker cutscene

  /** E on the breaker: the camera is the scene's from here to the black. */
  private startCutscene(): void {
    // Whatever was in his hands a moment ago, it is not now
    this.cancelKick();
    this.drink.abort();
    this.cutT = 0;
    this.cutBeats.clear();
    this.cutFrom.pos.copy(this.player.position);
    this.cutFrom.yaw = this.player.yaw;
    this.cutFrom.pitch = this.player.pitch;
    this.player.cinematic = true;
    this.player.velocity.set(0, 0, 0);
    this.player.crouching = false;
    this.player.aiming = false;
    this.emote.cancel();
    this.letterbox.classList.remove('open');
    this.hud.hide();
    this.objective.style.display = 'none';
    const hint = this.ui.querySelector<HTMLElement>('.torch-hint');
    if (hint) hint.style.display = 'none';
  }

  /**
   * Where he stands and looks, before the player applies it to the camera:
   * across to the switch and square to it, eyes down on the lever; up to
   * the label as the tubes strike; and round to his right, all the way.
   */
  private cutscenePose(dt: number): void {
    this.cutT += dt;
    const t = this.cutT;
    const p = this.player;
    p.position.lerpVectors(this.cutFrom.pos, this.standAt, smooth(t / CUT.SETTLE));
    // Facing the cabinet is yaw π/2. Come round to it the short way.
    const off = this.cutFrom.yaw - Math.PI / 2;
    const y0 = Math.PI / 2 + Math.atan2(Math.sin(off), Math.cos(off));
    p.yaw = track(
      [[0, y0], [CUT.SETTLE, Math.PI / 2], [CUT.TURN0, Math.PI / 2], [CUT.TURN1, -Math.PI / 2]],
      t
    );
    p.pitch = track(
      [
        [0, this.cutFrom.pitch], [CUT.SETTLE, -0.3], [CUT.LOOKUP, -0.3],
        [CUT.LOOKUP + 0.9, -0.05], [CUT.TURN0, -0.05], [CUT.TURN1, -0.02]
      ],
      t
    );
    // The torch, brought back to his eye as a soft fill for the hand: the
    // breaker's red lamp on its own turns everything in front of it one
    // colour. Aimed down at the lever while he works it, then on ahead.
    const down = track([[CUT.LOOKUP, 0.42], [CUT.LOOKUP + 0.9, 0.08]], t);
    // Eased off once the tubes are on: enough to catch his face, not a spot
    // swinging round the walls as he turns
    this.torch.intensity = track([[CUT.LOOKUP, CUT_TORCH], [CUT.TURN0, 1.6]], t);
    this.torch.position.set(0.1, -0.04, 0.04);
    this.torch.target.position.set(0.02, -down, -1);
  }

  /** Everything else in the cutscene, over the camera the player just placed. */
  private updateCutscene(dt: number): void {
    const t = this.cutT;
    const L = this.level;
    const B = L.breaker;
    const cam = this.player.camera;
    const { audio } = this.ctx;
    const beat = (key: string, at: number, fn: () => void): void => {
      if (t < at || this.cutBeats.has(key)) return;
      this.cutBeats.add(key);
      fn();
    };

    // ---- The lever: it fights, then goes all at once and bounces on its stop
    let strain = 0;
    let angle = 0;
    if (t >= CUT.GRAB && t < CUT.SNAP) {
      const s = t - CUT.GRAB;
      strain = clamp01(s / 0.3);
      angle = track(STRAIN, s) + (Math.sin(t * 41) * 0.006 + Math.sin(t * 27.3) * 0.005) * strain;
    } else if (t >= CUT.SNAP) {
      const from = STRAIN[STRAIN.length - 1][1];
      const s = (t - CUT.SNAP) / (CUT.THROWN - CUT.SNAP);
      if (s < 1) angle = from + (LEVER_ON - 0.1 - from) * (1 - Math.pow(1 - s, 3));
      else angle = LEVER_ON - 0.1 * Math.exp(-(t - CUT.THROWN) * 12) * Math.cos((t - CUT.THROWN) * 32);
    }
    B.lever.rotation.x = angle;

    // ---- Camera, on top of the pose: leaning in to it, the tremor while it
    // binds, thrown back off it when it goes, a turn of the head, a flinch
    cam.position.y += track([[0, 0], [CUT.SETTLE, -0.07], [CUT.LOOKUP, -0.07], [CUT.LOOKUP + 0.8, 0]], t);
    if (strain > 0) {
      const a = 0.004 * strain;
      cam.position.x += Math.sin(t * 37) * a;
      cam.position.y += Math.sin(t * 29 + 1.3) * a;
      cam.rotation.x += Math.sin(t * 23 + 0.4) * 0.005 * strain;
    }
    if (t >= CUT.SNAP) {
      const e = Math.exp(-(t - CUT.SNAP) * 7) * clamp01((t - CUT.SNAP) / 0.05);
      cam.position.x += 0.05 * e; // back off the cabinet
      cam.position.y += 0.014 * e;
      cam.rotation.x += 0.05 * e;
    }
    if (t > CUT.TURN0 && t < CUT.TURN1) {
      cam.position.y += Math.sin(Math.PI * ((t - CUT.TURN0) / (CUT.TURN1 - CUT.TURN0))) * 0.018;
    }
    if (t > CUT.TURN1 - 0.08) {
      // Face to face with him: a start back
      const e = Math.exp(-(t - CUT.TURN1) * 5) * clamp01((t - CUT.TURN1 + 0.08) / 0.1);
      cam.position.x -= 0.04 * e;
      cam.rotation.x += 0.03 * e;
    }
    if (t >= CUT.HIT) {
      // The gun takes his head round to the right and down
      const k = 1 - Math.exp(-(t - CUT.HIT) * 30);
      cam.rotation.z -= 0.55 * k;
      cam.rotation.y -= 0.25 * k;
      cam.position.z += 0.07 * k;
      cam.position.y -= 0.06 * k;
    }
    cam.updateMatrixWorld();

    // ---- His hand
    this.updateHand(t, strain);

    // ---- The agent behind him
    if (t >= CUT.TURN0 - 0.05) this.updateAgent(t, dt);

    // ---- Beats
    beat('reach', CUT.REACH, () => {
      this.hand.visible = true;
    });
    beat('grab', CUT.GRAB, () => {
      audio.effortGrunt(0.7);
      audio.leverStrain(CUT.SNAP - CUT.GRAB);
    });
    beat('grunt', CUT.GRAB + 0.78, () => audio.effortGrunt(1));
    beat('snap', CUT.SNAP, () => {
      audio.breakerThrow();
      audio.effortGrunt(0.8);
      audio.electricCrackle(0.6);
      this.particles.electricSparks(B.lever.getWorldPosition(new THREE.Vector3()), 18);
    });
    beat('thrown', CUT.THROWN, () => {
      B.lamp.emissive.setHex(0x33ff66);
      B.lamp.color.setHex(0x0a2a10);
      B.light.color.setHex(0x33ff66);
      // A green tell, not a green room: the fluorescents take over from here
      B.light.intensity = 0.7;
      this.powerT = 0;
      this.flickerStep = 0;
      audio.powerUp();
    });
    beat('sting', CUT.TURN1 - 0.2, () => audio.revealSting());
    beat('wind', CUT.WIND + 0.05, () => audio.enemyShout(1));
    beat('hit', CUT.HIT, () => {
      audio.knockoutHit();
      this.knockedOut = true;
    });
    // A few frames of the blow landing, then nothing
    beat('black', CUT.HIT + 0.07, () => {
      this.fadeEl.style.opacity = '1';
      this.hand.visible = false;
      this.agent.root.visible = false;
    });
    beat('end', CUT.END, () => this.ctx.bus.emit(Events.Level5Complete));
  }

  private static tmpQ = new THREE.Quaternion();
  private static tmpQ2 = new THREE.Quaternion();
  private static tmpC = new THREE.Vector3();
  private static tmpX = new THREE.Vector3();
  private static tmpY = new THREE.Vector3();
  private static tmpZ = new THREE.Vector3();
  private static tmpM = new THREE.Matrix4();

  /**
   * The hand comes up from under the frame to the handle, closes on it and
   * rides it through the throw — held to the grip, so wherever the handle
   * goes it goes — then lets go and drops back out of shot.
   */
  private updateHand(t: number, strain: number): void {
    const h = this.hand;
    if (!h.visible) return;
    const cam = this.player.camera;
    const grip = this.level.breaker.grip;
    grip.updateWorldMatrix(true, false);
    const gp = grip.getWorldPosition(Level5Scene.tmpA);
    // Along the bar, and turned to the eye: the bar rolls in the hand as the
    // lever swings instead of turning the hand over with it
    const X = Level5Scene.tmpX.set(1, 0, 0).applyQuaternion(grip.getWorldQuaternion(Level5Scene.tmpQ));
    const Z = Level5Scene.tmpZ.copy(cam.position).sub(gp);
    Z.addScaledVector(X, -Z.dot(X)).normalize();
    const Y = Level5Scene.tmpY.crossVectors(Z, X);
    const gq = Level5Scene.tmpQ.setFromRotationMatrix(Level5Scene.tmpM.makeBasis(X, Y, Z));
    // Out of shot: low and to the right, the back of the hand to the eye
    const sp = cam.localToWorld(Level5Scene.tmpB.set(0.3, -0.56, -0.2));
    const sq = cam.getWorldQuaternion(Level5Scene.tmpQ2);
    let k: number;
    if (t < CUT.GRAB) k = smooth((t - CUT.REACH) / (CUT.GRAB - CUT.REACH));
    else if (t < CUT.LETGO) k = 1;
    else k = 1 - smooth((t - CUT.LETGO - 0.12) / 0.45);
    h.root.position.lerpVectors(sp, gp, k);
    h.root.quaternion.slerpQuaternions(sq, gq, k);
    // Grinding on it while it binds
    if (strain > 0) {
      h.root.position.y += Math.sin(t * 43) * 0.002 * strain;
      h.root.position.z += Math.sin(t * 31 + 0.7) * 0.002 * strain;
    }
    // Half-closed on the way in, shut on arrival, open again to let go
    h.curl = t < CUT.LETGO ? 0.35 + 0.65 * smooth((t - (CUT.GRAB - 0.18)) / 0.18) : 1 - smooth((t - CUT.LETGO) / 0.14);
    h.update(cam.localToWorld(Level5Scene.tmpC.set(0.26, -0.52, 0.12)));
    if (t > CUT.LETGO + 0.6) h.visible = false;
  }

  /**
   * The agent who has been standing behind him the whole time: pistol on
   * Ravi's face when he turns, then up and back — and down across his head.
   */
  private updateAgent(t: number, dt: number): void {
    const ag = this.agent;
    if (!ag.root.visible && t < CUT.HIT) {
      ag.root.visible = true;
      // His arm's three poses, in his own frame. Facing -x at yaw π/2, a
      // world offset (dx, dy, dz) from his feet is (-dz, dy, dx) to him.
      const eyeY = this.player.eyeHeight;
      const shoulder = ag.shoulderR(new THREE.Vector3());
      const down = new THREE.Vector3(0, -1, 0);
      // Just under his eye, so the gun is seen along its top rather than as a
      // box end-on
      const toFace = new THREE.Vector3(0.03, eyeY - 0.1, this.standAt.x - this.agentAt.x).sub(shoulder).normalize();
      this.aimQ.setFromUnitVectors(down, toFace);
      // The blow lands on his left temple, with the lunge taken into account
      const lunged = this.standAt.x - (this.agentAt.x - 0.3);
      const toTemple = new THREE.Vector3(0.08, eyeY - 0.03, lunged).sub(shoulder).normalize();
      this.strikeQ.setFromUnitVectors(down, toTemple);
    }
    if (!ag.root.visible) return;

    // He steps in as he swings
    const lunge = track([[CUT.WIND, 0], [CUT.HIT, 0.3]], t);
    ag.root.position.set(this.agentAt.x - lunge, 0, this.agentAt.z);
    ag.setWalk(t > CUT.WIND && t < CUT.HIT ? 0.5 : 0);
    ag.setHeadLook(this.player.camera.position);

    let fore: number;
    if (t < CUT.WIND) {
      this.armQ.copy(this.aimQ);
      fore = 0.05;
    } else if (t < CUT.STRIKE) {
      const k = smooth((t - CUT.WIND) / (CUT.STRIKE - CUT.WIND));
      this.armQ.slerpQuaternions(this.aimQ, this.windQ, k);
      fore = 0.05 + 1.95 * k;
    } else {
      // The blow: fast, and faster as it comes
      const s = clamp01((t - CUT.STRIKE) / (CUT.HIT - CUT.STRIKE));
      const k = s * s;
      this.armQ.slerpQuaternions(this.windQ, this.strikeQ, k);
      fore = 2.0 - 1.9 * k;
    }
    ag.pose = {
      armR: this.armQ,
      foreR: fore,
      armL: this.leftQ,
      foreL: 0.45,
      lean: track([[CUT.WIND, 0.03], [CUT.STRIKE, -0.07], [CUT.HIT, 0.22]], t)
    };
    ag.update(dt);
  }

  /**
   * Everything the lift does, one stage at a time. The player is never
   * frozen: update() moves him regardless, and the car's walls and shut
   * doors are what keep him in it.
   */
  private updateLift(dt: number): void {
    const { carA, carB } = this.level;
    this.stageT += dt;

    switch (this.stage) {
      case 'hall': {
        // Stepping into the car is what brings the line on
        if (!this.toldWhy && this.insideCar(carA) && !this.dialogue.isActive) {
          this.toldWhy = true;
          this.dialogue.play(
            [{ speaker: 'RAVI', text: 'I need to turn the breaker back on.', pitch: 1.0 }],
            () => this.setObjective('SEND THE LIFT TO THE MECHANICAL ROOM')
          );
        }
        const onPanel = this.toldWhy && !this.dialogue.isActive && this.aimingAtPanel(carA);
        this.prompt.style.display = onPanel ? 'block' : 'none';
        this.prompt.textContent = '[ E ]  MECHANICAL ROOM';
        if (onPanel && this.ctx.input.wasPressed('KeyE') && !this.eSpent && !this.busy) {
          if (!this.insideCar(carA)) {
            this.setObjective('STEP INSIDE THE LIFT');
            break;
          }
          carA.buttons.get('MR')!.emissiveIntensity = 2.2;
          this.ctx.audio.uiBeep(true);
          this.ctx.audio.elevatorDoors(DOOR_TIME);
          // Shut him in from this moment: he is inside, and the doors are
          // about to be. Enabling it now rather than when they meet means he
          // cannot slip out through the last half-second of gap.
          carA.doorCollider.disabled = false;
          this.prompt.style.display = 'none';
          this.setObjective('');
          this.go('closing');
        }
        break;
      }

      case 'closing': {
        this.openA = Math.max(0, 1 - this.stageT / DOOR_TIME);
        this.setDoors(carA, this.openA);
        carA.doorCollider.disabled = false;
        if (this.openA <= 0) {
          this.ctx.audio.elevatorRide(RIDE_TIME + FADE_TIME + 0.4);
          carA.buttons.get('2')!.emissiveIntensity = 0;
          carA.indicator.map = carA.indicatorFaces.down;
          carA.indicator.needsUpdate = true;
          this.go('ride');
        }
        break;
      }

      case 'ride': {
        if (this.stageT > RIDE_TIME * 0.45 && carA.indicator.map !== carA.indicatorFaces['1']) {
          carA.indicator.map = carA.indicatorFaces['1'];
          carA.indicator.needsUpdate = true;
        }
        if (this.stageT >= RIDE_TIME) this.go('fadeOut');
        break;
      }

      case 'fadeOut': {
        this.fadeEl.style.opacity = String(Math.min(1, this.stageT / FADE_TIME));
        if (this.stageT >= FADE_TIME) {
          // Across to the identical car below, keeping his place in it
          this.player.position.add(this.level.carOffset);
          this.player.velocity.set(0, 0, 0);
          this.showCard();
          this.go('card');
        }
        break;
      }

      case 'card': {
        if (this.stageT >= CARD_TIME) {
          this.card?.classList.add('gone');
          this.go('fadeIn');
        }
        break;
      }

      case 'fadeIn': {
        this.fadeEl.style.opacity = String(Math.max(0, 1 - this.stageT / FADE_TIME));
        if (this.stageT >= FADE_TIME) {
          this.card?.remove();
          this.card = null;
          this.ctx.audio.elevatorDing();
          this.ctx.audio.elevatorDoors(DOOR_TIME);
          this.go('opening');
        }
        break;
      }

      case 'opening': {
        this.openB = Math.min(1, this.stageT / DOOR_TIME);
        this.setDoors(carB, this.openB);
        if (this.openB >= 1) {
          this.setObjective('FIND THE BREAKER');
          this.go('room');
        }
        break;
      }

      case 'room':
        break;
    }
  }

  private go(stage: Stage): void {
    this.stage = stage;
    this.stageT = 0;
  }

  /** The same card the engine shows between levels, so this reads as a load. */
  private showCard(): void {
    this.card?.remove();
    const el = document.createElement('div');
    el.className = 'level-load';
    el.innerHTML =
      '<div class="ll-title">LEVEL 5 — MECHANICAL ROOM</div>' +
      '<div class="ll-bar"><i></i></div>' +
      '<div class="ll-sub">PREPARING</div>';
    this.ctx.uiRoot.appendChild(el);
    this.card = el;
  }

  // ---------------------------------------------------------------- input

  private onClick(): void {
    if (this.dialogue.isActive) {
      this.dialogue.advance();
      return;
    }
    if (this.dead) this.ctx.bus.emit(Events.RestartLevel5);
  }

  private onKey(e: KeyboardEvent): void {
    // Out cold, and nothing more to this level yet
    if (this.knockedOut) {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      return;
    }
    if (this.dead) {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') this.ctx.bus.emit(Events.RestartLevel5);
      return;
    }
    if (this.dialogue.isActive && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) {
      e.preventDefault();
      this.dialogue.advance();
      // The same key press is still visible to the frame's input poll
      if (e.code === 'KeyE') this.eSpent = true;
    }
  }

  // ------------------------------------------------------------- the moves

  /**
   * Who the drop kick would land on. Nobody, ever: the basement is empty,
   * and the agent is only in the world inside the cutscene, where the kick
   * cannot be started. It whiffs every time down here by design — a key
   * that does nothing at all in one level out of six reads as a bug.
   */
  private kickTarget(): Enemy | null {
    return null;
  }

  /** Give the camera back mid-kick: shot, zapped, or the breaker took over. */
  private cancelKick(): void {
    if (!this.dropKick.engaged) return;
    this.dropKick.abort();
    this.player.cinematic = false;
    this.kickVictim = null;
    this.endKickRun();
  }

  /** Hands full: a can in one of them, or both boots off the floor. */
  private get busy(): boolean {
    return this.drink.engaged || this.dropKick.engaged;
  }

  // --------------------------------------------------------------- update

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    const cutscene = this.cutT >= 0;
    const playable = !this.dead && !cutscene;

    if (playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();

    const held = this.active === 'pistol' ? this.weapon : this.shotgun;

    // ---- Deadbull on G. Not a cutscene: he keeps his feet and the mouse the
    // whole time, and the price of a full heal is three seconds with the gun
    // out of frame.
    if (
      playable && input.wasPressed('KeyG') && this.player.alive && input.pointerLocked &&
      !this.dialogue.isActive && !held.reloading && this.zapT < 0 && !this.dropKick.engaged
    ) {
      // The finger stays up if it was up: that is the left hand and this is
      // the right, and with the gun stowed there is nothing for it to do.
      this.drink.start();
    }
    // Dead, or in the water — either way he is not finishing it
    if (!playable || !this.player.alive || this.zapT >= 0) this.drink.abort();

    // ---- Drop kick on Q. It plays whether or not anyone is in front of him,
    // which in this basement is nobody at all: a move that silently does
    // nothing when you press it just reads as a broken button.
    if (
      playable && input.wasPressed('KeyQ') && this.player.alive && input.pointerLocked &&
      !this.dialogue.isActive && !held.reloading && this.zapT < 0 && !this.drink.engaged &&
      this.player.grounded // never off a ledge: the move freezes him mid-air
    ) {
      if (this.dropKick.start()) {
        this.emote.cancel();
        this.player.cinematic = true; // the kick owns the camera until he's up
        this.player.aiming = false;
        this.kickVictim = this.kickTarget();
        this.beginKickRun(this.kickVictim);
      }
    }
    // The water and the breaker hand it back themselves, on their way to
    // taking the camera; this is the one that is nobody else's job
    if (this.dropKick.engaged && !this.player.alive) this.cancelKick();
    this.runKick(this.dropKick, dt);
    this.dropKick.update(dt);

    const aiming =
      playable && input.rightHeld && input.pointerLocked && this.player.alive && !held.reloading && !this.busy;
    this.player.aiming = aiming;
    if (cutscene) this.cutscenePose(dt);
    this.player.update(dt, this.level.colliders);
    // Layered on after player.update so the leap and the landing ride on top
    // of the ordinary eye position instead of being overwritten by it
    this.dropKick.applyCamera(this.player);
    // A little of the motor through the floor while the car is moving
    if (this.stage === 'ride' || this.stage === 'fadeOut') {
      this.player.camera.position.y += (Math.random() - 0.5) * 0.008;
    }

    this.updateLift(dt);
    this.updateHazard(dt);
    this.updateBreaker(dt);
    if (cutscene) this.updateCutscene(dt);

    if (playable && !this.dialogue.isActive && !this.busy) {
      if (input.wasPressed('Digit1')) this.wanted = 'pistol';
      if (input.wasPressed('Digit2')) this.wanted = 'shotgun';
    }
    if (cutscene) {
      // The gun goes down out of shot for it, but never all the way: at full
      // stow a weapon is hidden, and hiding it takes its muzzle light out of
      // the scene's light count — which recompiles every material on the
      // first frame of the cutscene.
      this.wanted = this.active;
      if (held.stow < 0.99) held.stow = Math.min(0.99, held.stow + dt * 3);
    } else if (this.busy) {
      // A can or the floor: whatever he was holding drops out of frame. Held
      // short of 1 for the same reason as the cutscene above — a fully stowed
      // weapon is a hidden one, and hiding it costs the recompile.
      if (held.stow < 0.99) held.stow = Math.min(0.99, held.stow + dt * 6);
    } else if (this.wanted !== this.active) {
      const cur = this.active === 'pistol' ? this.weapon : this.shotgun;
      cur.stow = Math.min(1, cur.stow + dt * 6);
      if (cur.stow >= 1) this.active = this.wanted;
    } else {
      held.stow = Math.max(0, held.stow - dt * 6);
    }

    if (playable && input.wasPressed('KeyT') && input.pointerLocked && !held.reloading && !this.dialogue.isActive) {
      this.emote.toggle();
    }
    if (held.reloading || !this.player.alive) this.emote.cancel();
    this.weapon.hideSupportHand = this.emote.engaged;
    this.shotgun.hideSupportHand = this.emote.engaged;

    this.weapon.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming && this.active === 'pistol');
    this.shotgun.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming && this.active === 'shotgun');
    this.emote.update(dt, this.player);
    this.drink.update(dt, this.player);
    // The cutscene frames in tighter on the lever, and opens out for the turn
    const targetFov = cutscene
      ? track([[0, 74], [CUT.SETTLE, 60], [CUT.LOOKUP, 60], [CUT.LOOKUP + 0.9, 68]], this.cutT)
      : 74 - 22 * this.weapon.aimBlend - 12 * this.shotgun.aimBlend;
    if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
      this.player.camera.fov = targetFov;
      this.player.camera.updateProjectionMatrix();
    }
    this.hud.setAiming(Math.max(this.weapon.aimBlend, this.shotgun.aimBlend) > 0.5);

    this.fireCooldown -= dt;
    const clicked = input.consumeClick();
    if (
      playable && this.player.alive && input.pointerLocked && !this.dialogue.isActive &&
      clicked && this.fireCooldown <= 0 && !held.reloading && !this.busy
    ) {
      if (this.active === 'pistol' && this.ammo > 0) {
        this.ammo--;
        this.fireCooldown = FIRE_COOLDOWN;
        this.playerShoot();
      } else if (this.active === 'shotgun' && this.shells > 0 && !this.shotgun.pumping) {
        this.shells--;
        this.fireCooldown = 0.35;
        this.playerShootShotgun();
      }
    }
    if (input.wasPressed('KeyF') && this.player.alive && !cutscene) {
      this.torchOn = !this.torchOn;
      this.torch.intensity = this.torchOn ? TORCH_ON : 0;
      this.ctx.audio.uiBeep(this.torchOn);
      this.ui.querySelector('.torch-hint')?.classList.toggle('on', this.torchOn);
    }
    if (input.wasPressed('KeyR') && this.player.alive && !cutscene && !this.busy) {
      if (this.active === 'pistol' && this.ammo < MAG_SIZE) {
        this.weapon.startReload();
        this.ammo = MAG_SIZE;
      } else if (this.active === 'shotgun' && this.shells < TUBE_SIZE) {
        this.shells = TUBE_SIZE;
      }
    }
    if (this.active === 'pistol') this.hud.setAmmo(this.ammo, MAG_SIZE, this.weapon.reloading);
    else this.hud.setAmmo(this.shells, TUBE_SIZE, this.shotgun.reloading);

    this.dialogue.update(dt);
    this.world.step(1 / 60, dt, 3);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.decals.update(dt);
    this.updateDebris(dt);
    // Cleared last, so every interaction this frame saw the same answer
    this.eSpent = false;
    input.endFrame();
  }

  private playerShoot(): void {
    const { audio, bus } = this.ctx;
    audio.playerGunshot();
    this.weapon.fire();
    bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 30, kind: 'gunshot' });
    const eye = this.player.eyePosition();
    const dir = new THREE.Vector3();
    this.player.camera.getWorldDirection(dir);
    const end = this.castBullet(eye, dir, null);
    this.particles.tracer(this.weapon.muzzleWorld(), end);
  }

  private playerShootShotgun(): void {
    const { audio, bus } = this.ctx;
    audio.shotgunBlast();
    this.shotgun.fire();
    bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 36, kind: 'gunshot' });
    const eye = this.player.eyePosition();
    const base = new THREE.Vector3();
    this.player.camera.getWorldDirection(base);
    const muzzle = this.shotgun.muzzleWorld();
    this.particles.barrelSmoke(muzzle, base);
    for (let i = 0; i < 9; i++) {
      const dir = base.clone();
      dir.x += (Math.random() - 0.5) * 0.09;
      dir.y += (Math.random() - 0.5) * 0.09;
      dir.z += (Math.random() - 0.5) * 0.09;
      dir.normalize();
      const end = this.castBullet(eye, dir, null);
      if (i % 3 === 0) this.particles.tracer(muzzle, end);
    }
  }

  /** Nobody down here to kill yet. */
  protected killEnemy(): void {}

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}
