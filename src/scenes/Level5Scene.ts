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
import { Enemy } from '../entities/Enemy';
import { FPSHUD } from '../ui/FPSHUD';
import { DialogueBox } from '../ui/DialogueBox';

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

type Stage = 'hall' | 'closing' | 'ride' | 'fadeOut' | 'card' | 'fadeIn' | 'opening' | 'room';

/**
 * Level5Scene — the service lift down to the mechanical room.
 *
 * Ravi comes out of the dark floor into a dead corridor with a lift at the
 * end of it: the only thing in the building still lit, on its own backup
 * supply. He steps in, reminds himself why he is here, and sends it down.
 *
 * None of it is a cutscene. He keeps control the whole way: the doors close
 * round him, he can walk about the car while it moves, and the screen goes
 * to black and comes back with him standing in the same spot in an identical
 * car, 200m away, as its doors open on the basement.
 */
export class Level5Scene extends CombatScene<Level5Data> {
  private weapon!: WeaponViewmodel;
  private emote!: EmoteViewmodel;
  private shotgun!: ShotgunViewmodel;
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

    // The basement car waits with its doors shut
    this.setDoors(this.level.carB, 0);

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
    this.ui.remove();
    this.card?.remove();
    Enemy.flashPool = null;
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="intro-objective"></div>
      <div class="torch-hint">[ F ] FLASHLIGHT</div>
      <div class="l5-prompt" style="position:absolute;left:50%;top:58%;transform:translateX(-50%);
        font:bold 13px monospace;letter-spacing:3px;color:#ffd27a;text-shadow:0 0 6px #000;
        display:none;pointer-events:none"></div>
      <div class="intro-fade"></div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.objective = el.querySelector('.intro-objective')!;
    this.prompt = el.querySelector('.l5-prompt')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
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
    const eye = this.player.eyePosition(Level5Scene.tmpA);
    const dir = this.player.camera.getWorldDirection(Level5Scene.tmpB);
    this.raycaster.set(eye, dir);
    this.raycaster.far = REACH;
    return this.raycaster.intersectObject(car.panel, true).length > 0;
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
        if (onPanel && this.ctx.input.wasPressed('KeyE') && !this.eSpent) {
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
    this.eSpent = false;
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

  // --------------------------------------------------------------- update

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    const playable = !this.dead;

    if (playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();

    const held = this.active === 'pistol' ? this.weapon : this.shotgun;
    const aiming = playable && input.rightHeld && input.pointerLocked && this.player.alive && !held.reloading;
    this.player.aiming = aiming;
    this.player.update(dt, this.level.colliders);
    // A little of the motor through the floor while the car is moving
    if (this.stage === 'ride' || this.stage === 'fadeOut') {
      this.player.camera.position.y += (Math.random() - 0.5) * 0.008;
    }

    this.updateLift(dt);

    if (playable && !this.dialogue.isActive) {
      if (input.wasPressed('Digit1')) this.wanted = 'pistol';
      if (input.wasPressed('Digit2')) this.wanted = 'shotgun';
    }
    if (this.wanted !== this.active) {
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
    const targetFov = 74 - 22 * this.weapon.aimBlend - 12 * this.shotgun.aimBlend;
    if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
      this.player.camera.fov = targetFov;
      this.player.camera.updateProjectionMatrix();
    }
    this.hud.setAiming(Math.max(this.weapon.aimBlend, this.shotgun.aimBlend) > 0.5);

    this.fireCooldown -= dt;
    const clicked = input.consumeClick();
    if (
      playable && this.player.alive && input.pointerLocked && !this.dialogue.isActive &&
      clicked && this.fireCooldown <= 0 && !held.reloading
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
    if (input.wasPressed('KeyF') && this.player.alive) {
      this.torchOn = !this.torchOn;
      this.torch.intensity = this.torchOn ? TORCH_ON : 0;
      this.ctx.audio.uiBeep(this.torchOn);
      this.ui.querySelector('.torch-hint')?.classList.toggle('on', this.torchOn);
    }
    if (input.wasPressed('KeyR') && this.player.alive) {
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
