import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { OfficeLevelBuilder, LevelData } from '../environment/OfficeLevelBuilder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { FPSPlayer } from '../entities/FPSPlayer';
import { WeaponViewmodel } from '../entities/WeaponViewmodel';
import { ShotgunViewmodel } from '../entities/ShotgunViewmodel';
import { RifleViewmodel } from '../entities/RifleViewmodel';
import { TakedownViewmodel } from '../entities/TakedownViewmodel';
import { EmoteViewmodel } from '../entities/EmoteViewmodel';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { DropKickViewmodel } from '../entities/DropKickViewmodel';
import { Enemy } from '../entities/Enemy';
import { EnemyAI } from '../entities/EnemyAI';
import { CivilianAI } from '../entities/CivilianAI';
import { FPSHUD } from '../ui/FPSHUD';

const FIRE_COOLDOWN = 0.17;
const MAG_SIZE = 10;
// Shotgun: pump pacing sets the fire rate; the tube holds six
const SHOTGUN_COOLDOWN = 0.85;
const TUBE_SIZE = 6;
const PELLETS = 8;
// AK-47: full auto at ~600 rpm, 30-round magazine
const RIFLE_COOLDOWN = 0.1;
const RIFLE_MAG = 30;

type Slot = 'pistol' | 'shotgun' | 'rifle';

/**
 * OfficeLevelScene — the playable shift. Owns the level, the player, all
 * intruders + their AI, the physics world for ragdolls, and the shared
 * ballistics pipeline (spread, piercing, glass, gore, tracers).
 */
export class OfficeLevelScene extends CombatScene<LevelData> {
  private weapon!: WeaponViewmodel;
  private shotgun!: ShotgunViewmodel;
  private rifle!: RifleViewmodel;
  /** Which weapon is in hand, and which slot 1/2/3 asked for. */
  private active: Slot = 'pistol';
  private wanted: Slot = 'pistol';
  private shells = TUBE_SIZE;
  private rifleAmmo = RIFLE_MAG;
  private takedownVm!: TakedownViewmodel;
  /** Middle-finger emote on T; the left hand goes back to work on reload. */
  private emote!: EmoteViewmodel;
  /** Deadbull on G: three seconds with no gun, and he's back on full health. */
  private drink!: DrinkViewmodel;
  /** Drop kick on Q. */
  private dropKick!: DropKickViewmodel;
  /** Who the kick was aimed at when Q went down. */
  private kickVictim: Enemy | null = null;
  /** The enemy currently held for a knife execution, if any. */
  private takedown: Enemy | null = null;
  private enemies: Enemy[] = [];
  private ais: EnemyAI[] = [];
  private civilians: Enemy[] = [];
  private civAIs: CivilianAI[] = [];
  /** Per-enemy cooldown before they take a shot at a civilian. */
  private civShotTimers = new Map<Enemy, number>();
  private hud!: FPSHUD;
  private fireCooldown = 0;
  private ammo = MAG_SIZE;
  private remaining = 0;
  private over = false;
  private won = false;
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onOverlayClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private unloadGuard = (e: BeforeUnloadEvent): void => {
    if (this.over) return; // shift's already finished, let them go
    e.preventDefault();
    e.returnValue = ''; // legacy browsers need this to show the prompt
  };
  private pooledCorpses = new Set<Enemy>();
  /** Floor cleared: the service door unlocks. */
  private cleared = false;
  private leaving = false;
  private handedOff = false;
  private fade = 0;
  private banner: HTMLElement | null = null;
  private fadeEl: HTMLElement | null = null;

  constructor(ctx: GameContext) {
    super(ctx);
  }

  /**
   * Every shift the intruders start somewhere new: the fixed spawn list is
   * used as a pool together with the patrol waypoints (guaranteed walkable),
   * shuffled, kept off the player's back and spread apart.
   */
  private randomizeSpawns(): void {
    const count = this.level.enemySpawns.length;
    const pool: { pos: THREE.Vector3; yaw: number }[] = [
      ...this.level.enemySpawns.map((s) => ({ pos: s.pos.clone(), yaw: s.yaw })),
      ...this.level.waypoints.map((w) => ({ pos: w.pos.clone(), yaw: Math.random() * Math.PI * 2 }))
    ];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked: { pos: THREE.Vector3; yaw: number }[] = [];
    for (const cand of pool) {
      if (picked.length >= count) break;
      if (cand.pos.distanceTo(this.level.playerSpawn) < 9) continue; // never in Ravi's lap
      if (cand.pos.y > 0.1 && cand.pos.y < 3) continue; // no spawning mid-staircase
      if (picked.some((p) => p.pos.distanceTo(cand.pos) < 4)) continue; // spread out
      picked.push(cand);
    }
    // Pool exhausted before we filled the roster? Top up from the originals.
    for (const s of this.level.enemySpawns) {
      if (picked.length >= count) break;
      if (!picked.some((p) => p.pos.distanceTo(s.pos) < 0.5)) picked.push({ pos: s.pos.clone(), yaw: s.yaw });
    }
    this.level.enemySpawns = picked;
  }

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x0a0c10);
    this.scene.fog = new THREE.Fog(0x0a0c10, 24, 60);

    this.level = new OfficeLevelBuilder().build();
    this.randomizeSpawns();
    this.scene.add(this.level.group);

    this.world = this.createPhysicsWorld(this.level.colliders);

    this.player = new FPSPlayer(this.level.playerSpawn, this.level.playerSpawnYaw, input, audio, bus);
    this.scene.add(this.player.camera);
    // Vaulting through a window: smash the pane and keep going
    this.player.onVaultGlass = (c) => this.vaultGlass(c);
    this.weapon = new WeaponViewmodel(this.player.camera);
    this.weapon.onReloadEvent = (e) => {
      if (e === 'magOut') audio.magOut();
      else if (e === 'magDrop') this.dropMagazine(this.weapon.ejectedMagPose());
      else if (e === 'magIn') audio.magIn();
      else if (e === 'rack') audio.slideRack();
      else if (e === 'done') this.ammo = MAG_SIZE;
    };
    // The shotgun rides along stowed until 2 brings it up
    this.shotgun = new ShotgunViewmodel(this.player.camera);
    this.shotgun.onPumpEvent = (e) => {
      if (e === 'back') audio.pumpBack();
      else if (e === 'eject') this.dropShell();
      else if (e === 'forward') audio.pumpForward();
    };
    this.shotgun.onReloadEvent = (e) => {
      if (e === 'shellIn') {
        audio.shellIn();
        this.shells = Math.min(TUBE_SIZE, this.shells + 1);
      }
    };
    // The AK rides along stowed until 3 brings it up
    this.rifle = new RifleViewmodel(this.player.camera);
    this.rifle.onReloadEvent = (e) => {
      if (e === 'strike') audio.magStrike();
      else if (e === 'magOut') audio.magOut();
      else if (e === 'magDrop') this.dropRifleMagazine();
      else if (e === 'magIn') audio.magIn();
      else if (e === 'rackBack') audio.boltBack();
      else if (e === 'rack') audio.boltForward();
      else if (e === 'done') this.rifleAmmo = RIFLE_MAG;
    };
    // Knife takedown arms (F next to an enemy)
    this.takedownVm = new TakedownViewmodel(this.player.camera);
    // Middle-finger emote (T toggles it; reloading puts the hand back to work)
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
    this.takedownVm.onEvent = (e, i) => {
      const victim = this.takedown;
      if (e === 'grab') {
        if (victim) audio.enemyShout(1);
      } else if (e === 'draw') {
        audio.knifeDraw();
      } else if (e === 'stab') {
        // Blade in. He's dying on it — but Ravi is HOLDING him up, so no
        // ragdoll yet. Just the sound and the blood.
        if (victim && victim.alive) {
          const wound = this.knifeWound(victim);
          const spray = this.player
            .forwardDir()
            .clone()
            .multiplyScalar(0.45)
            .add(new THREE.Vector3(0, 0.9, 0))
            .normalize();
          audio.knifeStab();
          // He screams and folds round it, hands going for the wrist. The
          // second time there's less left in him to scream with.
          victim.stabbed();
          audio.enemyScream(i === 0 ? 1 : 0.6);
          this.spatter(wound, spray, true);
        }
      } else if (e === 'release') {
        // The knife comes out, the hand lets go — NOW they drop.
        if (victim && victim.alive) {
          const wound = this.knifeWound(victim);
          const slump = this.player.forwardDir().clone();
          slump.y = -0.3;
          // Gentle impulse: they crumple off the blade, not fly off it
          this.killEnemy(victim, wound, slump.normalize(), true, false, 'torso', 0.2);
          this.spatter(wound, slump.clone().negate().setY(0.4).normalize(), false);
        }
      } else if (e === 'done') {
        this.takedown = null;
        this.player.cinematic = false;
      }
    };

    this.particles = new ParticleManager(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene);
    Enemy.flashPool = this.flashPool;
    this.decals = new BloodDecalSystem(this.scene);

    // Spawn the intruders
    this.level.enemySpawns.forEach((s, i) => {
      const enemy = new Enemy(s.pos, s.yaw, i);
      this.scene.add(enemy.root);
      this.enemies.push(enemy);
      for (const part of enemy.parts) this.level.shootables.push(part);
      this.ais.push(
        new EnemyAI(enemy, {
          player: this.player,
          waypoints: this.level.waypoints,
          occluders: this.level.occluders,
          colliders: this.level.colliders,
          bus,
          audio,
          enemyFire: (e) => this.enemyFire(e)
        })
      );
    });
    this.remaining = this.enemies.length;

    // Staff still on the floor — no weapons, they just run
    this.level.civilianSpawns.forEach((s, i) => {
      const civ = new Enemy(s.pos, s.yaw, i, { name: `STAFF ${i + 1}`, civilian: true });
      this.scene.add(civ.root);
      this.civilians.push(civ);
      for (const part of civ.parts) this.level.shootables.push(part);
      this.civAIs.push(new CivilianAI(civ, this.level.waypoints, this.level.colliders, bus));
    });
    this.spawnCorpses();

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, this.remaining, this.player.maxHealth);
    this.hud.show();

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }),
      bus.on(Events.PlayerDied, () => {
        this.over = true;
      })
    );

    document.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);
    // Ctrl+W / Ctrl+T mid-crouch can't be intercepted — at least make the
    // browser ask before throwing the shift away.
    window.addEventListener('beforeunload', this.unloadGuard);
    input.requestPointerLock();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    for (const ai of this.ais) ai.dispose();
    for (const ai of this.civAIs) ai.dispose();
    document.removeEventListener('click', this.clickHandler);
    document.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('beforeunload', this.unloadGuard);
    this.hud.destroy();
    this.banner?.remove();
    this.fadeEl?.remove();
    this.ctx.input.exitPointerLock();
    // Free GPU resources
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }

  /**
   * Staff who were already dead when Ravi got here. They're simulated
   * forward at load so the bodies are lying still on the first frame
   * instead of dropping in front of the player.
   */
  private spawnCorpses(): void {
    const settleFrames = 110;
    for (const [i, s] of this.level.corpseSpawns.entries()) {
      const body = new Enemy(s.pos, s.yaw, i + 7, { name: 'STAFF', civilian: true });
      this.scene.add(body.root);
      this.civilians.push(body);
      for (const part of body.parts) this.level.shootables.push(part);
      const dir = new THREE.Vector3(Math.cos(s.yaw), -0.25, Math.sin(s.yaw)).normalize();
      const hit = s.pos.clone().add(new THREE.Vector3(0, 1.1 + Math.random() * 0.3, 0));
      body.die(hit, dir, this.world, Math.random() < 0.3 ? 'head' : 'torso');
    }
    // Run the ragdolls to rest before the level is ever drawn
    for (let f = 0; f < settleFrames; f++) {
      this.world.step(1 / 60);
      for (const c of this.civilians) if (!c.alive) c.update(1 / 60);
    }
    // Blood underneath each of them
    for (const c of this.civilians) {
      if (c.alive) continue;
      const base = c.corpseBase();
      const under = this.surfaceBelow(base, 3);
      if (under) this.decals.place('pool', under.point, under.normal, undefined, undefined, 1, under.object);
      this.pooledCorpses.add(c);
    }
  }

  /**
   * Agents shooting the staff. An agent already fighting Ravi ignores them —
   * he has a bigger problem — so they only get picked off by agents who
   * haven't found him yet, which is what makes walking in on a fresh body
   * feel like something that happened without you.
   */
  private updateCivilianHunt(dt: number): void {
    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      if (!enemy.alive || enemy.beingExecuted) continue;
      const busyWithPlayer = this.ais[i].state === 'attack';
      let timer = this.civShotTimers.get(enemy) ?? 3 + Math.random() * 5;
      timer -= dt;
      if (busyWithPlayer || timer > 0) {
        this.civShotTimers.set(enemy, busyWithPlayer ? Math.max(timer, 3) : timer);
        continue;
      }
      const victim = this.visibleCivilian(enemy);
      if (!victim) {
        this.civShotTimers.set(enemy, 1.5);
        continue;
      }
      enemy.faceToward(victim.position, dt, 12);
      enemy.setAiming(true);
      this.executeCivilian(enemy, victim);
      // The floor should empty over the course of the level rather than in
      // the first few seconds — but not so slowly that nothing happens.
      this.civShotTimers.set(enemy, 7 + Math.random() * 9);
    }
  }

  /** Nearest living civilian this agent can actually see. */
  private visibleCivilian(enemy: Enemy): Enemy | null {
    const eye = enemy.eyePosition();
    const facing = enemy.forwardDir();
    let best: Enemy | null = null;
    let bestD = 12.5;
    for (const c of this.civilians) {
      if (!c.alive) continue;
      const d = eye.distanceTo(c.position);
      if (d > bestD) continue;
      if (Math.abs(c.position.y - enemy.position.y) > 1.5) continue; // different floor
      // Only someone they're actually looking at — no shooting over a shoulder
      const toward = c.position.clone().sub(enemy.position).setY(0).normalize();
      if (toward.dot(facing) < 0.35) continue;
      const to = c.position.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(eye);
      const dist = to.length();
      this.raycaster.set(eye, to.normalize());
      this.raycaster.far = dist - 0.3;
      if (this.raycaster.intersectObjects(this.level.occluders, false).length > 0) continue;
      best = c;
      bestD = d;
    }
    return best;
  }

  private executeCivilian(enemy: Enemy, victim: Enemy): void {
    const { audio, bus } = this.ctx;
    audio.enemyGunshot(enemy.position.distanceTo(this.player.position));
    enemy.flashMuzzle();
    bus.emit(Events.Sound, { position: enemy.position.clone(), radius: 25, kind: 'gunshot' });
    const muzzle = enemy.muzzleWorld();
    const chest = victim.position.clone().add(new THREE.Vector3(0, 1.15, 0));
    const dir = chest.clone().sub(muzzle).normalize();
    this.particles.tracer(muzzle, chest, 0xffe0b0);
    victim.die(chest, dir, this.world, 'torso');
    audio.fleshHit();
    this.spatter(chest, dir, true);
    const ai = this.civAIs.find((a) => a['civ'] === victim);
    ai?.dispose();
  }

  private onOverlayClick(): void {
    if (!this.over) return;
    if (this.won) return; // shift complete: P restarts, Esc goes to the office
    else this.ctx.bus.emit(Events.RestartLevel);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'KeyP' && this.over && this.won) {
      this.ctx.bus.emit(Events.RestartLevel);
      return;
    }
    if (e.code === 'Escape' && this.over) {
      this.ctx.bus.emit(Events.ReturnToMenu);
    }
  }

  // ----------------------------------------------------------------- update

  update(dt: number, _time: number): void {
    const { input } = this.ctx;

    // Re-lock the pointer if the player clicks back in mid-game
    if (!this.over && !input.pointerLocked && input.mouseHeld) {
      input.requestPointerLock();
    }

    // ---- Knife takedown: F next to an enemy grabs him, blade does the rest
    const tdTarget = this.takedown ? null : this.takedownTarget();
    this.hud.setTakedownHint(!!tdTarget && input.pointerLocked);
    if (
      tdTarget &&
      input.wasPressed('KeyF') &&
      input.pointerLocked &&
      !this.weapon.reloading &&
      !this.shotgun.reloading &&
      !this.rifle.reloading &&
      !this.drink.engaged &&
      !this.dropKick.engaged
    ) {
      this.takedown = tdTarget;
      this.player.cinematic = true; // the scene owns the camera until it's over
      this.player.aiming = false;
      tdTarget.beginExecution(this.world);
      this.takedownVm.start();
    }
    if (this.takedown) {
      if (!this.player.alive) {
        // Shot dead mid-execution: let go of everything
        this.takedownVm.abort();
        this.takedown = null;
        this.player.cinematic = false;
      } else {
        this.updateTakedownCamera(dt, _time);
      }
    }
    this.takedownVm.update(dt);
    const inTakedown = this.takedown !== null;

    // Weapon slots: 1 = pistol, 2 = shotgun, 3 = rifle. The current gun
    // swings down out of frame, then the other comes up — no switching mid-reload.
    const vmOf = (slot: Slot) => (slot === 'pistol' ? this.weapon : slot === 'shotgun' ? this.shotgun : this.rifle);
    const allVms = [this.weapon, this.shotgun, this.rifle];
    const heldVm = vmOf(this.active);
    if (this.player.alive && !this.over && !heldVm.reloading && !inTakedown && !this.drink.engaged && !this.dropKick.engaged) {
      if (input.wasPressed('Digit1')) this.wanted = 'pistol';
      if (input.wasPressed('Digit2')) this.wanted = 'shotgun';
      if (input.wasPressed('Digit3')) this.wanted = 'rifle';
    }
    if (inTakedown || this.drink.engaged || this.dropKick.engaged) {
      // Both hands are busy — with the knife, a can, or the floor — so
      // whatever was held drops out of frame
      for (const v of allVms) v.stow = Math.min(1, v.stow + dt * 6);
    } else if (this.wanted !== this.active) {
      heldVm.stow = Math.min(1, heldVm.stow + dt * 5);
      if (heldVm.stow >= 1) this.active = this.wanted;
    } else {
      heldVm.stow = Math.max(0, heldVm.stow - dt * 5);
    }
    const vm = vmOf(this.active);
    if (this.wanted === this.active && !inTakedown) for (const v of allVms) if (v !== vm) v.stow = 1;
    const switching = this.wanted !== this.active || vm.stow > 0.1;

    // ---- Middle-finger emote: T raises it and it stays up; T again, a
    // reload, the knife, or dying puts the hand back on the gun
    if (
      input.wasPressed('KeyT') &&
      this.player.alive &&
      input.pointerLocked &&
      !vm.reloading &&
      !inTakedown &&
      !this.over
    ) {
      this.emote.toggle();
    }
    if (vm.reloading || inTakedown || !this.player.alive) this.emote.cancel();
    this.weapon.hideSupportHand = this.emote.engaged;
    this.shotgun.hideSupportHand = this.emote.engaged;
    this.rifle.hideSupportHand = this.emote.engaged;

    // ---- Deadbull on G. Not a cutscene: he keeps his feet and the mouse the
    // whole time, and the price of a full heal is three seconds with the gun
    // out of frame.
    if (
      input.wasPressed('KeyG') &&
      this.player.alive &&
      input.pointerLocked &&
      !inTakedown &&
      !this.over &&
      !vm.reloading &&
      !this.dropKick.engaged
    ) {
      // The finger stays up if it was up: that is the left hand and this is
      // the right, and with the gun stowed there is nothing for it to do.
      this.drink.start();
    }
    if (!this.player.alive || inTakedown) this.drink.abort();

    // ---- Drop kick on Q. It plays whether or not anyone is in front of him:
    // a move that silently does nothing when you misjudge the range just
    // reads as a broken button.
    if (
      input.wasPressed('KeyQ') &&
      this.player.alive &&
      input.pointerLocked &&
      !inTakedown &&
      !this.over &&
      !vm.reloading &&
      !this.drink.engaged &&
      this.player.grounded
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
    const busy = inTakedown || this.drink.engaged || this.dropKick.engaged;

    // Aim down sights on right mouse (sprinting drops the aim)
    const aiming =
      input.rightHeld &&
      input.pointerLocked &&
      this.player.alive &&
      !this.over &&
      !vm.reloading &&
      !switching &&
      !busy;
    this.player.aiming = aiming;
    this.player.update(dt, this.level.colliders);
    // Layered on after player.update so the leap and the landing ride on top
    // of the ordinary eye position instead of being overwritten by it
    this.dropKick.applyCamera(this.player);
    if (this.takedown) this.holdOn(this.takedownVm, this.takedown);
    this.weapon.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming && this.active === 'pistol');
    this.shotgun.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming && this.active === 'shotgun');
    this.rifle.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming && this.active === 'rifle');
    this.emote.update(dt, this.player);
    this.drink.update(dt, this.player);
    // FOV zoom while aiming (the shotgun's bead zooms less than the irons)
    // …and a longer lens for the takedown, which the HUD letterboxes to match
    const targetFov =
      74 - 22 * this.weapon.aimBlend - 12 * this.shotgun.aimBlend - 20 * this.rifle.aimBlend - 10 * this.takedownVm.cinema;
    // Halfway, so the bars' own slide lands in step with the lens
    this.hud.setCinematic(this.takedownVm.cinema > 0.5);
    if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
      this.player.camera.fov = targetFov;
      this.player.camera.updateProjectionMatrix();
    }
    this.hud.setAiming(Math.max(this.weapon.aimBlend, this.shotgun.aimBlend, this.rifle.aimBlend) > 0.5);

    // Player shooting (semi-auto pistol; pump-paced shotgun; full-auto rifle)
    this.fireCooldown -= dt;
    // (no firing at a sprint — the gun is down by your hip; let go of Shift first)
    const canFire =
      this.player.alive &&
      this.fireCooldown <= 0 &&
      input.pointerLocked &&
      !this.player.sprinting &&
      !vm.reloading &&
      !switching &&
      !busy &&
      (this.active !== 'shotgun' || !this.shotgun.pumping);
    const clicked = input.consumeClick();
    if (clicked && this.active === 'shotgun' && this.shotgun.reloading && this.shells > 0) {
      // Interrupt the shell loop to get back in the fight
      this.shotgun.cancelReload();
    } else if (this.active === 'rifle') {
      // Hold the trigger: it keeps cycling until the mag runs dry
      if (input.mouseHeld && canFire) {
        if (this.rifleAmmo > 0) {
          this.fireCooldown = RIFLE_COOLDOWN;
          this.rifleAmmo--;
          this.playerShootRifle();
        } else if (clicked) {
          this.ctx.audio.dryFire();
          if (!this.player.sprinting) this.startRifleReload();
        }
      }
    } else if (clicked && canFire) {
      if (this.active === 'pistol') {
        if (this.ammo > 0) {
          this.fireCooldown = FIRE_COOLDOWN;
          this.ammo--;
          this.playerShoot();
        } else {
          this.ctx.audio.dryFire();
          if (!this.player.sprinting) this.startReload();
        }
      } else {
        if (this.shells > 0) {
          this.fireCooldown = SHOTGUN_COOLDOWN;
          this.shells--;
          this.playerShootShotgun();
        } else {
          this.ctx.audio.dryFire();
          this.startShotgunReload();
        }
      }
    }
    // Manual reload on R (only if there's room)
    if (input.wasPressed('KeyR') && this.player.alive && !this.player.sprinting && !switching && !busy) {
      if (this.active === 'pistol' && this.ammo < MAG_SIZE) this.startReload();
      else if (this.active === 'shotgun' && this.shells < TUBE_SIZE && !this.shotgun.pumping) this.startShotgunReload();
      else if (this.active === 'rifle' && this.rifleAmmo < RIFLE_MAG) this.startRifleReload();
    }
    if (this.active === 'pistol') this.hud.setAmmo(this.ammo, MAG_SIZE, this.weapon.reloading);
    else if (this.active === 'shotgun') this.hud.setAmmo(this.shells, TUBE_SIZE, this.shotgun.reloading);
    else this.hud.setAmmo(this.rifleAmmo, RIFLE_MAG, this.rifle.reloading);

    // Enemies + AI
    let anyAttacking = false;
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].update(dt);
      if (this.enemies[i].alive) {
        // A man being executed has no AI any more — only the struggle
        if (!this.enemies[i].beingExecuted) {
          this.ais[i].update(dt);
          if (this.ais[i].state === 'attack') anyAttacking = true;
        }
      } else if (this.enemies[i].settled && !this.pooledCorpses.has(this.enemies[i])) {
        // Corpse has come to rest — pool of blood
        this.pooledCorpses.add(this.enemies[i]);
        const base = this.enemies[i].corpseBase();
        // Pool goes on whatever the body is actually lying on (floor, desk,
        // stair landing…) — never on a guessed floor height.
        const under = this.surfaceBelow(base, 3);
        if (under) this.decals.place('pool', under.point, under.normal, undefined, undefined, 1, under.object);
        this.ctx.audio.bodyThud(this.player.position.distanceTo(base));
      }
    }
    this.hud.setAlert(anyAttacking && this.player.alive);
    this.hud.setHealth(this.player.health, this.player.regenProgress);

    // Staff: run them, let the agents pick them off, pool the ones that fall
    for (let i = 0; i < this.civilians.length; i++) {
      const c = this.civilians[i];
      c.update(dt);
      if (c.alive) this.civAIs[i]?.update(dt);
      else if (c.settled && !this.pooledCorpses.has(c)) {
        this.pooledCorpses.add(c);
        const under = this.surfaceBelow(c.corpseBase(), 3);
        if (under) this.decals.place('pool', under.point, under.normal, undefined, undefined, 1, under.object);
      }
    }
    if (!this.over) this.updateCivilianHunt(dt);
    this.checkExit(dt);

    for (const f of this.level.flickering) f.update(dt);
    for (const g of this.level.glassPanes) g.update(dt);
    this.updateDebris(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.world.step(1 / 60, dt, 3);

    input.endFrame();
  }

  render(renderer: THREE.WebGLRenderer): void {
    // First frame of the level pays for every shader at once, behind the fade
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }

  // -------------------------------------------------------------- ballistics

  /** Nearest living agent close enough and in front of Ravi to grab. */
  private takedownTarget(): Enemy | null {
    if (!this.player.alive || this.over) return null;
    const fwd = this.player.forwardDir();
    let best: Enemy | null = null;
    let bestD = 2.3;
    for (const e of this.enemies) {
      if (!e.alive || e.beingExecuted) continue;
      const to = e.position.clone().sub(this.player.position);
      if (Math.abs(to.y) > 1.2) continue; // same floor only
      to.y = 0;
      const d = to.length();
      if (d > bestD || d < 0.05) continue;
      if (to.normalize().dot(fwd) < 0.5) continue; // must be roughly ahead
      best = e;
      bestD = d;
    }
    return best;
  }

  /** Who the drop kick would land on right now, if anyone. */
  private kickTarget(): Enemy | null {
    if (this.over) return null;
    return this.kickTargetFrom(this.enemies);
  }

  /**
   * While the takedown runs the scene drives the camera: Ravi squares up
   * ~0.95m from the target, the view drags onto his face, and the whole
   * frame shakes with the struggle.
   */
  private updateTakedownCamera(dt: number, time: number): void {
    const enemy = this.takedown!;
    // He wrenches around to face Ravi; Ravi is pulled to grappling range
    enemy.faceToward(this.player.position, dt, 12);
    const away = this.player.position.clone().sub(enemy.position).setY(0).normalize();
    const anchor = enemy.position.clone().addScaledVector(away, 0.95);
    anchor.y = this.player.position.y;
    this.player.position.lerp(anchor, Math.min(1, dt * 6));

    // Drag the view onto his face
    const head = enemy.position.clone().add(new THREE.Vector3(0, 1.32, 0)); // frame face AND chest — the stabs land low
    const dir = head.sub(this.player.eyePosition());
    const targetYaw = Math.atan2(-dir.x, -dir.z);
    const targetPitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    let dYaw = targetYaw - this.player.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const k = Math.min(1, dt * 9);
    this.player.yaw += dYaw * k;
    this.player.pitch += (targetPitch - this.player.pitch) * k;

    // (No camera shake — the fight reads through the arms, the view stays steady.)
  }

  private startReload(): void {
    if (this.weapon.startReload()) {
      this.player.aiming = false;
    }
  }

  private startShotgunReload(): void {
    if (this.shotgun.startReload(TUBE_SIZE - this.shells)) {
      this.player.aiming = false;
    }
  }

  private startRifleReload(): void {
    if (this.rifle.startReload()) {
      this.player.aiming = false;
    }
  }

  /** The AK's empty mag, flicked out forward by the fresh one, lands in the level. */
  /**
   * A polymer magazine on office carpet: it skitters and bounces rather than
   * landing dead, which the world's default (restitution 0.12, for draping
   * ragdolls) will not do. Registered once, on first use.
   */
  private magMat: CANNON.Material | null = null;
  private magMaterial(): CANNON.Material {
    if (!this.magMat) {
      this.magMat = new CANNON.Material('rifleMag');
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(this.magMat, this.world.defaultMaterial, {
          restitution: 0.45,
          friction: 0.22
        })
      );
    }
    return this.magMat;
  }

  private dropRifleMagazine(): void {
    const mesh = this.rifle.makeDroppedMag();
    if (!mesh) return;
    // Pose AND velocity come from the animated mag, so the physics copy picks
    // up exactly where the animation left off and falls from there
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

  private playerShootRifle(): void {
    const { audio, bus } = this.ctx;
    audio.rifleShot();
    this.rifle.fire();
    bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 36, kind: 'gunshot' });

    // Hip fire walks all over the place; on the irons it groups, and every
    // shot kicks the muzzle up a touch so a long burst climbs
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

  /** The pump flicks the spent hull out the port; it becomes a real object. */
  private dropShell(): void {
    const { position, direction } = this.shotgun.ejectedShellPose();
    const hull = new THREE.Group();
    const bodyMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0105, 0.0105, 0.05, 8),
      new THREE.MeshStandardMaterial({ color: 0xb32222, roughness: 0.6 })
    );
    hull.add(bodyMesh);
    const brass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0115, 0.0115, 0.013, 8),
      new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.35 })
    );
    brass.position.y = -0.028;
    hull.add(brass);
    hull.position.copy(position);

    const body = new CANNON.Body({
      mass: 0.04,
      shape: new CANNON.Box(new CANNON.Vec3(0.011, 0.032, 0.011)),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      linearDamping: 0.05,
      angularDamping: 0.25
    });
    const v = direction.clone().multiplyScalar(1.8 + Math.random() * 0.8).add(this.player.velocity);
    body.velocity.set(v.x, v.y, v.z);
    body.angularVelocity.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
    this.addDebris(hull, body);
  }

  private playerShootShotgun(): void {
    const { audio, bus } = this.ctx;
    audio.shotgunBlast();
    this.shotgun.fire();
    bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 34, kind: 'gunshot' });

    // A cone of pellets: wide from the hip, meaningfully tighter on the bead
    const speedFactor = this.player.currentSpeed / 6.6;
    let spread = 0.035 + speedFactor * 0.012;
    spread *= 1 - 0.4 * this.shotgun.aimBlend;

    const eye = this.player.eyePosition();
    const baseDir = new THREE.Vector3();
    this.player.camera.getWorldDirection(baseDir);
    const muzzle = this.shotgun.muzzleWorld();
    this.particles.barrelSmoke(muzzle, baseDir);
    for (let i = 0; i < PELLETS; i++) {
      const dir = baseDir.clone();
      dir.x += (Math.random() - 0.5) * spread * 2;
      dir.y += (Math.random() - 0.5) * spread * 2;
      dir.z += (Math.random() - 0.5) * spread * 2;
      dir.normalize();
      const end = this.castBullet(eye, dir, null);
      this.particles.tracer(muzzle, end);
    }
  }

  private playerShoot(): void {
    const { audio, bus } = this.ctx;
    audio.playerGunshot();
    this.weapon.fire();
    bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 30, kind: 'gunshot' });

    // Spread grows with movement, shrinks when crouched
    const speedFactor = this.player.currentSpeed / 6.6;
    let spread = 0.0045 + speedFactor * 0.028 + (this.player.crouching ? -0.002 : 0);
    spread *= 1 - 0.8 * this.weapon.aimBlend; // sights in = tight groups

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
    impulseScale = 1,
    /** A boot rather than a bullet: no hole, and no blood thrown. */
    opts: { wound?: boolean; keepWeapon?: boolean } = {}
  ): void {
    const { audio, bus } = this.ctx;
    enemy.die(point, dir, this.world, hitPart, impulseScale, opts);
    if (opts.wound !== false) audio.fleshHit(); // a boot is not a bullet
    // A kick leaves no wound, so there is nothing to throw on the walls
    if (opts.wound !== false) this.spatter(point, dir, true);

    // Shooting one of your own staff is not progress: it doesn't count
    // towards the intruders and there's no kill confirm for it.
    if (enemy.civilian) {
      this.civAIs.find((a) => a['civ'] === enemy)?.dispose();
      bus.emit(Events.EnemyKilled, {
        name: enemy.name,
        remaining: this.remaining,
        headshot,
        by: byPlayer ? 'RAVI ✖' : 'POLICE FORCE'
      });
      return;
    }

    this.remaining--;
    if (byPlayer) {
      audio.killConfirm();
      bus.emit(Events.HitMarker, { lethal: true });
    }

    bus.emit(Events.EnemyKilled, {
      name: enemy.name,
      remaining: this.remaining,
      headshot,
      by: byPlayer ? 'RAVI' : 'FRIENDLY FIRE'
    });

    if (this.remaining <= 0 && !this.cleared) {
      this.cleared = true;
      // Anyone still alive out there can stop running now
      // Worried rather than happy: they have just watched a raid go through
      for (const ai of this.civAIs) ai.calmDown('concerned');
      // The service door unlocks: panel goes from red to green
      this.level.exitPanel.emissive.setHex(0x2bff6a);
      this.level.exitPanel.color.setHex(0x0a2a12);
      this.level.exitPanelLight.color.setHex(0x2bff6a);
      this.ctx.audio.uiBeep(true);
      this.showBanner('FLOOR CLEAR — THE SERVICE DOOR IS OPEN');
    }
  }

  // ---------------------------------------------------------------- the way on

  /** A one-line prompt across the middle of the screen. */
  private showBanner(text: string): void {
    if (!this.banner) {
      this.banner = document.createElement('div');
      this.banner.className = 'intro-objective';
      this.ctx.uiRoot.appendChild(this.banner);
    }
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  /** Walk into the unlocked doorway to move on to the next level. */
  private checkExit(dt: number): void {
    if (this.leaving) {
      this.fade = Math.min(1, this.fade + dt * 1.4);
      if (this.fadeEl) this.fadeEl.style.opacity = String(this.fade);
      if (this.fade >= 1 && !this.handedOff) {
        this.handedOff = true;
        this.ctx.bus.emit(Events.OfficeComplete);
      }
      return;
    }
    if (!this.player.alive || this.over) return;
    const p = this.player.position;
    if (!this.level.exitTrigger.containsPoint(new THREE.Vector3(p.x, p.y + 0.9, p.z))) return;
    if (!this.cleared) {
      this.showBanner('LOCKED — CLEAR THE FLOOR FIRST');
      return;
    }
    this.leaving = true;
    this.showBanner('');
    if (!this.fadeEl) {
      this.fadeEl = document.createElement('div');
      this.fadeEl.className = 'intro-fade';
      this.ctx.uiRoot.appendChild(this.fadeEl);
    }
    this.ctx.input.exitPointerLock();
  }

}
