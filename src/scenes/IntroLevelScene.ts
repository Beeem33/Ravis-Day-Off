import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { IntroOfficeBuilder, IntroLevelData } from '../environment/IntroOfficeBuilder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { FPSPlayer } from '../entities/FPSPlayer';
import { WeaponViewmodel } from '../entities/WeaponViewmodel';
import { TakedownViewmodel } from '../entities/TakedownViewmodel';
import { Enemy } from '../entities/Enemy';
import { EnemyAI } from '../entities/EnemyAI';
import { FPSHUD } from '../ui/FPSHUD';
import type { BreakableGlass } from '../environment/BreakableGlass';

const FIRE_COOLDOWN = 0.17;
const MAG_SIZE = 10;

// ---- Cutscene beats, in seconds from the top of the level
const T_KNOCK = 4.4; // three knocks on the side door
const T_SWIVEL = 5.0; // she turns her chair towards the noise
const T_TURN0 = 4.75; // Ravi looks up from his screen
const T_TURN1 = 6.4; // ...and is facing the glass
const T_BURST = 6.55; // the door goes in
const T_WALK0 = 6.6; // the agent comes through it, rifle already up
const T_WALK1 = 8.3; // ...and stops, two metres off her
const T_EXEC = 9.4; // he fires; she goes down
const T_DRAW0 = 11.0; // Ravi looks down at the pistol on his desk
const T_GRAB = 11.9; // his hand sweeps across and takes it
const T_DRAW1 = 12.4; // ...and it is up in the normal hold
const T_END = 13.0; // control passes to the player

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

/**
 * IntroLevelScene — the opening. Ravi is at his desk in the back office when
 * the FBI come through the front; a scripted first-person beat shows his last
 * coworker shot through the glass, then hands control over mid-motion as he
 * pulls the gun out of his drawer.
 *
 * The cutscene and the gameplay share one camera (the FPSPlayer's, in
 * `cinematic` mode) so the handover is a continuation rather than a cut.
 */
export class IntroLevelScene extends CombatScene<IntroLevelData> {
  private weapon!: WeaponViewmodel;
  private takedownVm!: TakedownViewmodel;
  /** The agent, if he's currently held for a knife execution. */
  private takedown: Enemy | null = null;
  private agent!: Enemy;
  private agentAI: EnemyAI | null = null;
  private coworker!: Enemy;
  private hud!: FPSHUD;

  private phase: 'cutscene' | 'play' | 'leaving' | 'dead' = 'cutscene';
  private t = 0;
  private beats = new Set<string>();
  private fireCooldown = 0;
  private ammo = MAG_SIZE;
  private agentDown = false;
  private fade = 0; // 0..1 black wipe on the way out
  private lookYaw = 0;
  /** 0 until the door is kicked, then eases to 1 as it swings wide. */
  private doorSwing = 0;
  /** The chair's built-in yaw, so the swivel is relative to it. */
  private chairYaw = 0;

  private ui!: HTMLElement;
  private objective!: HTMLElement;
  private letterbox!: HTMLElement;
  private fadeEl!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private corpsePooled = new Set<Enemy>();

  constructor(ctx: GameContext) {
    super(ctx);
  }

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x0a0c10);
    this.scene.fog = new THREE.Fog(0x0a0c10, 22, 55);

    this.level = new IntroOfficeBuilder().build();
    this.scene.add(this.level.group);

    this.world = this.createPhysicsWorld(this.level.colliders);

    this.player = new FPSPlayer(this.level.playerSpawn, this.level.playerSpawnYaw, input, audio, bus);
    this.player.cinematic = true;
    this.player.pitch = this.level.introPitch; // aimed at the news on his screen
    this.scene.add(this.player.camera);
    this.player.onVaultGlass = (c) => this.vaultGlass(c);

    this.weapon = new WeaponViewmodel(this.player.camera);
    this.weapon.stow = 1; // still in the drawer
    this.weapon.onReloadEvent = (e) => {
      if (e === 'magOut') audio.magOut();
      else if (e === 'magIn') audio.magIn();
      else if (e === 'rack') audio.slideRack();
      else if (e === 'done') this.ammo = MAG_SIZE;
    };
    // Knife takedown arms (F next to the agent)
    this.takedownVm = new TakedownViewmodel(this.player.camera);
    this.takedownVm.onEvent = (e) => {
      const victim = this.takedown;
      if (e === 'grab') {
        if (victim) audio.enemyShout(1);
      } else if (e === 'draw') {
        audio.knifeDraw();
      } else if (e === 'stab') {
        if (victim && victim.alive) {
          const neck = victim.position.clone().add(new THREE.Vector3(0, 1.42, 0));
          const spray = this.player
            .forwardDir()
            .clone()
            .multiplyScalar(0.45)
            .add(new THREE.Vector3(0, 0.9, 0))
            .normalize();
          audio.knifeStab();
          const slump = this.player.forwardDir().clone();
          slump.y = -0.3;
          this.killEnemy(victim, neck, slump.normalize(), true, false, 'head', 0.2);
          this.spatter(neck, spray, true);
        }
      } else if (e === 'done') {
        this.takedown = null;
        this.player.cinematic = false;
      }
    };

    this.particles = new ParticleManager(this.scene);
    this.decals = new BloodDecalSystem(this.scene);

    // The coworker — a civilian, no AI; she is only here to die.
    const cw = this.level.coworkerSpawn;
    this.coworker = new Enemy(cw.pos, cw.yaw, 0, { name: 'PRIYA', civilian: true });
    this.coworker.setSitting(true, true); // at the desk until the door goes in
    this.chairYaw = this.level.coworkerChair.rotation.y;
    this.scene.add(this.coworker.root);
    for (const p of this.coworker.parts) this.level.shootables.push(p);

    // The agent — rifle already up as he comes through the door; his AI is
    // withheld until the cutscene is done.
    const ag = this.level.agentSpawn;
    this.agent = new Enemy(ag.pos, ag.yaw, 1, { name: 'FBI AGENT' });
    this.agent.setAiming(true); // comes through the door with it already shouldered
    this.scene.add(this.agent.root);
    for (const p of this.agent.parts) this.level.shootables.push(p);

    // Ravi ends up looking at the midpoint of the pair, so both of them are
    // in frame side-on rather than one hidden behind the other.
    const mid = this.level.coworkerStandPos.clone().add(this.level.agentFiringPos).multiplyScalar(0.5);
    this.lookYaw = Math.atan2(
      -(mid.x - this.level.playerSpawn.x),
      -(mid.z - this.level.playerSpawn.z)
    );

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, 1, this.player.maxHealth);
    this.buildUI();

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }),
      bus.on(Events.PlayerDied, () => {
        this.phase = 'dead';
      })
    );

    document.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);
  }

  exit(): void {
    for (const u of this.unsubs) u();
    this.agentAI?.dispose();
    document.removeEventListener('click', this.clickHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.hud.destroy();
    this.ui.remove();
    this.ctx.input.exitPointerLock();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }

  // --------------------------------------------------------------------- UI

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-skip">[ SPACE ] SKIP</div>
      <div class="intro-objective"></div>
      <div class="intro-fade"></div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
  }

  private setObjective(text: string): void {
    if (this.objective.textContent === text) return;
    this.objective.textContent = text;
    this.objective.classList.remove('show');
    void this.objective.offsetWidth;
    this.objective.classList.add('show');
  }

  // ------------------------------------------------------------- cutscene

  /** Run `fn` once, the first time `t` passes `at`. */
  private beat(key: string, at: number, fn: () => void): void {
    if (this.t < at || this.beats.has(key)) return;
    this.beats.add(key);
    fn();
  }

  private updateCutscene(dt: number): void {
    const { audio } = this.ctx;
    this.t += dt;

    // Camera: look up from the screen, turn to the glass, then down to the drawer
    this.player.yaw = track(
      [
        [0, 0], [T_TURN0, 0], [T_TURN1, this.lookYaw],
        [T_DRAW0, this.lookYaw], [T_DRAW1, this.lookYaw * 0.5], [T_END, this.lookYaw * 0.85]
      ],
      this.t
    );
    const p0 = this.level.introPitch; // head down over the monitor
    this.player.pitch = track(
      [
        [0, p0], [T_TURN0, p0], [T_TURN1, -0.02],
        [T_DRAW0, -0.02], [T_DRAW1, -0.62], [T_END, -0.04]
      ],
      this.t
    );
    // The pistol is a real object on the desk until T_GRAB; after that the
    // viewmodel takes over, starting out at arm's length where it was lying.
    this.weapon.stow = this.t < T_GRAB ? 1 : 0;
    this.weapon.reach = track([[T_GRAB, 1], [T_DRAW1, 0]], this.t);

    // Beats
    // Three knocks on the side door — the only warning anyone gets
    this.beat('knock', T_KNOCK, () => audio.knockSet());
    // She is already on her feet with her hands up when he walks in
    // The door goes in. He's already got the rifle up as he comes through it.
    this.beat('burst', T_BURST, () => {
      this.doorSwing = 1;
      audio.doorBreach();
      // She is out of the chair and her hands go up the moment it goes in
      this.coworker.setSitting(false);
      this.coworker.setHandsUp(true);
      this.ctx.bus.emit(Events.Sound, { position: this.agent.position.clone(), radius: 26, kind: 'impact' });
    });
    this.beat('halt', T_WALK1, () => this.agent.setWalk(0));
    this.beat('exec', T_EXEC, () => this.executeCoworker());
    this.beat('grab', T_GRAB, () => {
      this.level.deskGun.visible = false; // the viewmodel is holding it now
      audio.magIn();
    });
    this.beat('rack', T_DRAW1 - 0.1, () => audio.slideRack());

    // The door slams open, then rebounds a little and stays wide
    if (this.doorSwing > 0) {
      this.doorSwing = Math.min(1, this.doorSwing + dt * 4.5);
      const k = 1 - Math.pow(1 - this.doorSwing, 3);
      const rebound = Math.sin(this.doorSwing * Math.PI) * 0.16; // kicks past, settles back
      this.level.doorPivot.rotation.y = -(2.0 * k - rebound);
    }

    // The agent comes through it and stops short of her
    if (this.t >= T_WALK0 && this.t <= T_WALK1) {
      const u = (this.t - T_WALK0) / (T_WALK1 - T_WALK0);
      const s = u * u * (3 - 2 * u);
      this.agent.position.lerpVectors(this.level.agentSpawn.pos, this.level.agentFiringPos, s);
      this.agent.setWalk(1);
    }
    // Up out of the chair, she backs off the desk to where the shot is staged
    if (this.t > T_BURST && this.coworker.alive) {
      const u = Math.min(1, (this.t - T_BURST) / 1.1);
      const e = u * u * (3 - 2 * u);
      this.coworker.position.lerpVectors(this.level.coworkerSpawn.pos, this.level.coworkerStandPos, e);
    }

    // He tracks her the whole way in. She is working with her back to the
    // door until the knock — turning her before that spun her round inside
    // a chair that stayed put.
    this.agent.faceToward(this.coworker.position, dt, 4);
    if (this.coworker.alive && this.t >= T_SWIVEL) {
      this.coworker.faceToward(this.agent.position, dt, 2.6);
      // Still seated? The chair swivels with her.
      if (!this.coworker.standing) {
        this.level.coworkerChair.rotation.y = this.chairYaw + (this.coworker.yaw - this.level.coworkerSpawn.yaw);
      }
    }

    if (this.t >= T_END) this.beginPlay();
  }

  private executeCoworker(): void {
    const { audio } = this.ctx;
    this.agent.flashMuzzle();
    audio.enemyGunshot(this.agent.position.distanceTo(this.player.position));

    // The round has to land where the barrel is actually pointing. The
    // shoulder-height rifle is level, so it strikes at muzzle height — a
    // fixed chest offset put the wound near her hip while he was plainly
    // aiming at her head.
    this.agent.root.updateMatrixWorld(true);
    const muzzle = this.agent.muzzleWorld();
    const target = this.coworker.position.clone();
    target.y = muzzle.y;
    const dir = target.clone().sub(muzzle).normalize();
    const rel = target.y - this.coworker.position.y;

    this.particles.tracer(muzzle, target, 0xffe0b0);
    this.coworker.die(target, dir, this.world, rel > 1.44 ? 'head' : 'torso');
    audio.fleshHit();
    this.spatter(target, dir, true);
  }

  /** Cutscene over: hand the same camera straight to the player. */
  private beginPlay(): void {
    if (this.phase !== 'cutscene') return;
    this.phase = 'play';
    this.t = T_END;
    this.weapon.stow = 0;
    this.player.cinematic = false;
    this.letterbox.classList.add('open');
    this.ui.querySelector('.intro-skip')!.classList.add('gone');
    this.hud.show();
    this.setObjective('THE ONE WHO SHOT HER IS STILL OUT THERE');

    // Now he gets to fight back
    this.agentAI = new EnemyAI(this.agent, {
      player: this.player,
      waypoints: this.level.waypoints,
      occluders: this.level.occluders,
      colliders: this.level.colliders,
      bus: this.ctx.bus,
      audio: this.ctx.audio,
      enemyFire: (e) => this.enemyFire(e)
    });
    // Ravi just racked a slide one room away. Without this the agent starts
    // on a patrol, drops the rifle off his shoulder and strolls off — he
    // should already be turning towards the noise.
    this.ctx.bus.emit(Events.Sound, {
      position: this.player.position.clone(),
      radius: 30,
      kind: 'gunshot'
    });
    this.ctx.input.requestPointerLock();
  }

  private skipCutscene(): void {
    if (this.phase !== 'cutscene') return;
    // Fast-forward the world into the state the cutscene would have left it:
    // agent in position with his rifle up, and her already down.
    this.agent.position.copy(this.level.agentFiringPos);
    this.agent.setWalk(0);
    this.agent.setAiming(true);
    this.doorSwing = 1;
    this.level.doorPivot.rotation.y = -2.0;
    this.coworker.setSitting(false, true);
    this.coworker.setHandsUp(true);
    this.coworker.position.copy(this.level.coworkerStandPos);
    this.level.deskGun.visible = false;
    if (!this.beats.has('exec')) {
      this.beats.add('exec');
      this.executeCoworker();
    }
    this.beginPlay();
  }

  // ---------------------------------------------------------------- input

  private onClick(): void {
    if (this.phase === 'cutscene') {
      // The menu click that started the game is still propagating when this
      // scene mounts; ignore anything in the first moment.
      if (this.t > 0.5) this.skipCutscene();
      return;
    }
    if (this.phase === 'dead') this.ctx.bus.emit(Events.RestartIntro);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.phase === 'cutscene' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      this.skipCutscene();
      return;
    }
    if (e.code === 'Escape' && this.phase === 'dead') this.ctx.bus.emit(Events.ReturnToMenu);
  }

  // --------------------------------------------------------------- update

  update(dt: number, _time: number): void {
    const { input } = this.ctx;

    if (this.phase === 'cutscene') {
      this.updateCutscene(dt);
      this.player.update(dt, this.level.colliders);
      this.weapon.update(dt, this.player, 0, 0, false);
      // These have to run during the cutscene too, or the agent's rifle never
      // leaves his hip and her ragdoll never falls — the pose only caught up
      // once gameplay started ticking them.
      this.agent.update(dt);
      this.coworker.update(dt);
      this.poolCorpse(this.coworker);
      this.stepWorld(dt);
      // Drain the click queue — otherwise the click that started the game (or
      // skipped the cutscene) is still latched and fires a round the instant
      // control lands.
      input.consumeClick();
      input.endFrame();
      return;
    }

    const playable = this.phase === 'play';
    if (playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();

    // ---- Knife takedown: F next to the agent
    const tdTarget = playable && !this.takedown ? this.takedownTarget() : null;
    this.hud.setTakedownHint(!!tdTarget && input.pointerLocked);
    if (tdTarget && input.wasPressed('KeyF') && input.pointerLocked && !this.weapon.reloading) {
      this.takedown = tdTarget;
      this.player.cinematic = true;
      this.player.aiming = false;
      tdTarget.beginExecution(this.world);
      this.takedownVm.start();
    }
    if (this.takedown) {
      if (!this.player.alive) {
        this.takedownVm.abort();
        this.takedown = null;
        this.player.cinematic = false;
      } else {
        this.updateTakedownCamera(dt, _time);
      }
    }
    this.takedownVm.update(dt);
    const inTakedown = this.takedown !== null;
    if (playable) {
      // The pistol drops out of frame while both hands are on the knife
      if (inTakedown) this.weapon.stow = Math.min(1, this.weapon.stow + dt * 6);
      else this.weapon.stow = Math.max(0, this.weapon.stow - dt * 5);
    }

    const aiming =
      playable && input.rightHeld && input.pointerLocked && this.player.alive && !this.weapon.reloading && !inTakedown;
    this.player.aiming = aiming;
    this.player.update(dt, this.level.colliders);
    this.weapon.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming);
    const targetFov = 74 - 22 * this.weapon.aimBlend;
    if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
      this.player.camera.fov = targetFov;
      this.player.camera.updateProjectionMatrix();
    }
    this.hud.setAiming(this.weapon.aimBlend > 0.5);

    // Shooting
    this.fireCooldown -= dt;
    const canFire =
      playable && this.player.alive && this.fireCooldown <= 0 && input.pointerLocked &&
      !this.player.sprinting && !this.weapon.reloading && !inTakedown;
    if (input.consumeClick() && canFire) {
      if (this.ammo > 0) {
        this.fireCooldown = FIRE_COOLDOWN;
        this.ammo--;
        this.playerShoot();
      } else {
        this.ctx.audio.dryFire();
        this.weapon.startReload();
      }
    }
    if (input.wasPressed('KeyR') && this.player.alive && this.ammo < MAG_SIZE && !this.player.sprinting && !inTakedown) {
      this.weapon.startReload();
    }
    this.hud.setAmmo(this.ammo, MAG_SIZE, this.weapon.reloading);

    // The agent
    this.agent.update(dt);
    if (this.agent.alive && !this.agent.beingExecuted) {
      this.agentAI?.update(dt);
      this.hud.setAlert(this.agentAI?.state === 'attack' && this.player.alive);
    } else {
      this.hud.setAlert(false);
    }
    this.hud.setHealth(this.player.health, this.player.regenProgress);
    this.poolCorpse(this.agent);
    this.coworker.update(dt);
    this.poolCorpse(this.coworker);

    if (playable) this.checkExit(dt);
    if (this.phase === 'leaving') this.updateLeaving(dt);

    this.stepWorld(dt);
    input.endFrame();
  }

  /** The agent, if he's alive, close, and roughly ahead of Ravi. */
  private takedownTarget(): Enemy | null {
    if (!this.player.alive || !this.agent.alive || this.agent.beingExecuted) return null;
    const to = this.agent.position.clone().sub(this.player.position);
    if (Math.abs(to.y) > 1.2) return null;
    to.y = 0;
    const d = to.length();
    if (d > 2.3 || d < 0.05) return null;
    if (to.normalize().dot(this.player.forwardDir()) < 0.5) return null;
    return this.agent;
  }

  /** Same choreography as the office level: square up, lock on, shake. */
  private updateTakedownCamera(dt: number, time: number): void {
    const enemy = this.takedown!;
    enemy.faceToward(this.player.position, dt, 12);
    const away = this.player.position.clone().sub(enemy.position).setY(0).normalize();
    const anchor = enemy.position.clone().addScaledVector(away, 0.95);
    anchor.y = this.player.position.y;
    this.player.position.lerp(anchor, Math.min(1, dt * 6));

    const head = enemy.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    const dir = head.sub(this.player.eyePosition());
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    const targetPitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    let dYaw = targetYaw - this.player.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const k = Math.min(1, dt * 9);
    this.player.yaw += dYaw * k;
    this.player.pitch += (targetPitch - this.player.pitch) * k;

    const s = this.takedownVm.struggle;
    this.player.yaw += (Math.sin(time * 12.7) * 0.6 + Math.sin(time * 8.3 + 1.9) * 0.4) * 0.006 * s;
    this.player.pitch += (Math.sin(time * 10.9 + 0.7) * 0.6 + Math.sin(time * 7.1 + 2.6) * 0.4) * 0.005 * s;
  }

  private stepWorld(dt: number): void {
    for (const f of this.level.flickering) f.update(dt);
    for (const g of this.level.glassPanes) g.update(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.world.step(1 / 60, dt, 3);
  }

  private poolCorpse(e: Enemy): void {
    if (e.alive || !e.settled || this.corpsePooled.has(e)) return;
    this.corpsePooled.add(e);
    const base = e.corpseBase();
    const under = this.surfaceBelow(base, 3);
    if (under) this.decals.place('pool', under.point, under.normal, undefined, undefined, 1, under.object);
    this.ctx.audio.bodyThud(this.player.position.distanceTo(base));
  }

  // ----------------------------------------------------------------- exit

  private checkExit(dt: number): void {
    void dt;
    if (!this.player.alive) return;
    const p = this.player.position;
    const inDoor = this.level.exitTrigger.containsPoint(new THREE.Vector3(p.x, p.y + 0.9, p.z));
    if (!inDoor) return;
    if (!this.agentDown) {
      this.setObjective('NOT YET — HE IS STILL BEHIND YOU');
      return;
    }
    this.phase = 'leaving';
    this.setObjective('');
    this.ctx.input.exitPointerLock();
  }

  private updateLeaving(dt: number): void {
    this.fade = Math.min(1, this.fade + dt * 1.4);
    this.fadeEl.style.opacity = String(this.fade);
    if (this.fade >= 1 && !this.beats.has('handoff')) {
      this.beats.add('handoff');
      this.ctx.bus.emit(Events.IntroComplete);
    }
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.player.camera);
  }

  // ----------------------------------------------------------- ballistics

  private playerShoot(): void {
    const { audio, bus } = this.ctx;
    audio.playerGunshot();
    this.weapon.fire();
    bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 30, kind: 'gunshot' });

    const speedFactor = this.player.currentSpeed / 6.6;
    let spread = 0.0045 + speedFactor * 0.028 + (this.player.crouching ? -0.002 : 0);
    spread *= 1 - 0.8 * this.weapon.aimBlend;

    const eye = this.player.eyePosition();
    const dir = new THREE.Vector3();
    this.player.camera.getWorldDirection(dir);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();

    const end = this.castBullet(eye, dir, null);
    this.particles.tracer(this.weapon.muzzleWorld(), end);
  }

  protected killEnemy(
    enemy: Enemy,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    byPlayer: boolean,
    headshot: boolean,
    hitPart = 'torso',
    impulseScale = 1
  ): void {
    const { audio, bus } = this.ctx;
    enemy.die(point, dir, this.world, hitPart, impulseScale);
    audio.fleshHit();
    if (byPlayer) {
      audio.killConfirm();
      bus.emit(Events.HitMarker, { lethal: true });
    }
    this.spatter(point, dir, true);

    if (enemy === this.agent) {
      this.agentDown = true;
      this.agentAI?.dispose();
      this.agentAI = null;
      bus.emit(Events.EnemyKilled, {
        name: enemy.name,
        remaining: 0,
        headshot,
        by: byPlayer ? 'RAVI' : 'FRIENDLY FIRE'
      });
      this.setObjective('NOW GET OUT — THE DOOR AT THE END OF THE HALL');
    }
  }

}
