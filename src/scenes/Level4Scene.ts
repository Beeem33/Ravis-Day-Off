import * as THREE from 'three';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level4Builder, Level4Data } from '../environment/Level4Builder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { GunBeamPool, PlayerGlow } from '../fx/GunBeam';
import { FPSPlayer } from '../entities/FPSPlayer';
import { WeaponViewmodel } from '../entities/WeaponViewmodel';
import { ShotgunViewmodel } from '../entities/ShotgunViewmodel';
import { Enemy } from '../entities/Enemy';
import { EnemyAI } from '../entities/EnemyAI';
import { FPSHUD } from '../ui/FPSHUD';
import { DialogueBox } from '../ui/DialogueBox';

const FIRE_COOLDOWN = 0.17;
const MAG_SIZE = 10;
const TUBE_SIZE = 6;

/**
 * Level4Scene — the dark floor.
 *
 * Opens on the approach corridor, where a man Ravi knows is sat against the
 * wall with a hole in him, entirely unbothered by it. He hands over the
 * shotgun, tells Ravi to find the boss, and then gets up and walks off as
 * though nothing has happened. The power goes as he leaves.
 *
 * Layout pass: no enemies and no props in the maze yet.
 */
export class Level4Scene extends CombatScene<Level4Data> {
  private weapon!: WeaponViewmodel;
  private shotgun!: ShotgunViewmodel;
  private glow!: PlayerGlow;
  private beams!: GunBeamPool;
  private agents: Enemy[] = [];
  private agentAI: EnemyAI[] = [];
  private remaining = 0;
  private hud!: FPSHUD;
  private dialogue!: DialogueBox;

  private wounded!: Enemy;
  private propGun!: THREE.Group;
  private phase: 'walk' | 'talk' | 'leaving' | 'play' | 'dead' = 'walk';
  /** He only has the pistol until the hand-over. */
  private hasShotgun = false;
  private active: 'pistol' | 'shotgun' = 'pistol';
  private wanted: 'pistol' | 'shotgun' = 'pistol';
  private ammo = MAG_SIZE;
  private shells = TUBE_SIZE;
  private fireCooldown = 0;
  private blackout = false;
  // ---- Night vision goggles (N): green amplified view of the dark floor
  private nv = false;
  private nvLight!: THREE.AmbientLight;
  private nvSaved: { bg: THREE.Color; fog: THREE.Fog | null } | null = null;
  private leaveWalk = -1;
  private leaveFrom = new THREE.Vector3();

  private ui!: HTMLElement;
  private objective!: HTMLElement;
  private letterbox!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private over = false;
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private clickHandler = (): void => this.onClick();

  constructor(ctx: GameContext) {
    super(ctx);
  }

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x05070a);
    this.scene.fog = new THREE.Fog(0x05070a, 14, 46);

    this.level = new Level4Builder().build();
    this.scene.add(this.level.group);
    this.world = this.createPhysicsWorld(this.level.colliders);

    this.player = new FPSPlayer(this.level.playerSpawn, this.level.playerSpawnYaw, input, audio, bus);
    this.scene.add(this.player.camera);

    this.weapon = new WeaponViewmodel(this.player.camera);
    this.shotgun = new ShotgunViewmodel(this.player.camera);
    this.shotgun.stow = 1; // stowed, and not even carried yet
    this.glow = new PlayerGlow(this.player.camera);
    // The goggles' amplifier: a flat green wash across everything when down
    this.nvLight = new THREE.AmbientLight(0x86ff9c, 0);
    this.scene.add(this.nvLight);

    this.particles = new ParticleManager(this.scene);
    this.decals = new BloodDecalSystem(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene);
    Enemy.flashPool = this.flashPool;

    // ---- The man on the floor
    this.wounded = new Enemy(this.level.woundedSpot, this.level.woundedYaw, 6, {
      name: 'SANJAY',
      civilian: true
    });
    this.wounded.setSlumped(true);
    this.scene.add(this.wounded.root);
    for (const p of this.wounded.parts) this.level.shootables.push(p);
    // The mess he is sitting in
    const floorN = new THREE.Vector3(0, 1, 0);
    this.decals.place('pool', this.level.woundedSpot.clone().add(new THREE.Vector3(0.25, 0.01, 0.34)), floorN, 1.5);
    this.decals.place('pool', this.level.woundedSpot.clone().add(new THREE.Vector3(-0.4, 0.01, 0.2)), floorN, 1.1);
    this.decals.place('blood', this.level.woundedSpot.clone().add(new THREE.Vector3(0.05, 0.01, 0.62)), floorN, 0.8);
    // The ketchup stain. Parented to his chest so it rides the pose and,
    // later, the walk out.
    const stain = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.17, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x7d1410, roughness: 0.55 })
    );
    stain.position.set(-0.03, -0.19, -0.115);
    this.wounded.addChestPatch(stain);
    const smear = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.09, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x64100d, roughness: 0.6 })
    );
    smear.position.set(0.08, -0.26, -0.113);
    this.wounded.addChestPatch(smear);

    // The gun, across his lap, until he passes it up
    this.propGun = this.shotgunProp();
    this.propGun.position.copy(this.level.woundedSpot).add(new THREE.Vector3(0.12, 0.28, 0.5));
    this.propGun.rotation.set(0, Math.PI / 2 + 0.25, 0.12);
    this.scene.add(this.propGun);

    // ---- The sweep team. Weapons already up: they came in expecting this.
    this.beams = new GunBeamPool(this.scene, this.level.enemySpawns.length);
    this.level.enemySpawns.forEach((sp, i) => {
      const e = new Enemy(sp.pos, sp.yaw, i + 11, { name: `FBI AGENT ${i + 1}` });
      e.setAiming(true);
      this.scene.add(e.root);
      this.agents.push(e);
      for (const p of e.parts) this.level.shootables.push(p);
      this.agentAI.push(
        new EnemyAI(e, {
          player: this.player,
          waypoints: this.level.waypoints,
          occluders: this.level.occluders,
          colliders: this.level.colliders,
          bus,
          audio,
          enemyFire: (x) => this.enemyFire(x)
        })
      );
    });
    this.remaining = this.agents.length;

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, this.remaining, this.player.maxHealth);
    this.hud.show();
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

    document.addEventListener('keydown', this.keyHandler);
    document.addEventListener('click', this.clickHandler);
    input.requestPointerLock();
    this.setObjective('FIND THE BOSS');
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('click', this.clickHandler);
    this.hud.destroy();
    this.dialogue.destroy();
    for (const ai of this.agentAI) ai.dispose();
    this.glow.dispose();
    this.beams.dispose();
    this.flashPool.dispose();
    this.ui.remove();
    Enemy.flashPool = null;
  }

  /**
   * Flip the goggles: a green ambient wash lifts the whole floor out of the
   * dark, the fog pulls back (amplified light carries further), and the DOM
   * overlay adds the tube vignette, scanlines and green cast.
   */
  private toggleNightVision(): void {
    this.nv = !this.nv;
    this.ctx.audio.uiBeep(this.nv);
    this.ui.querySelector('.nv-overlay')?.classList.toggle('on', this.nv);
    if (this.nv) {
      const f = this.scene.fog as THREE.Fog | null;
      this.nvSaved = { bg: (this.scene.background as THREE.Color).clone(), fog: f };
      this.scene.background = new THREE.Color(0x0a2010);
      this.scene.fog = new THREE.Fog(0x0c2812, f ? f.near * 1.3 : 10, f ? f.far * 1.9 : 50);
      this.nvLight.intensity = 2.3;
    } else {
      if (this.nvSaved) {
        this.scene.background = this.nvSaved.bg;
        this.scene.fog = this.nvSaved.fog;
        this.nvSaved = null;
      }
      this.nvLight.intensity = 0;
    }
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="nv-overlay"></div>
      <div class="nv-hint" style="display:none">[ N ] NIGHT VISION</div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.letterbox.classList.add('open');
  }

  private setObjective(text: string): void {
    if (this.objective.textContent === text) return;
    this.objective.textContent = text;
    this.objective.classList.remove('show');
    void this.objective.offsetWidth;
    this.objective.classList.add('show');
  }

  // -------------------------------------------------------------- the scene

  /**
   * The shotgun as a world object, laid across his lap. Same proportions as
   * the viewmodel so the hand-over does not change its shape.
   */
  private shotgunProp(): THREE.Group {
    const g = new THREE.Group();
    const blue = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.5, metalness: 0.6 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.8 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.62, 10), blue);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.052, -0.26);
    g.add(barrel);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.54, 8), blue);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.02, -0.24);
    g.add(tube);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.072, 0.24), blue);
    receiver.position.set(0, 0.05, 0.06);
    g.add(receiver);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.17), wood);
    pump.position.set(0, 0.026, -0.2);
    g.add(pump);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.085, 0.3), wood);
    stock.position.set(0, 0.045, 0.32);
    stock.rotation.x = -0.09;
    g.add(stock);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.05, 0.06), wood);
    grip.position.set(0, 0.018, 0.18);
    g.add(grip);
    return g;
  }

  /** Walking up on him hands control over to the script. */
  private beginTalk(): void {
    this.phase = 'talk';
    this.player.cinematic = true;
    this.letterbox.classList.remove('open');
    this.ctx.input.exitPointerLock();
    this.setObjective('');
    this.dialogue.play(
      [
        { speaker: 'SANJAY', text: 'Ravi. Is that you? I tried to fight them.', pitch: 0.88 },
        {
          speaker: 'SANJAY',
          text: 'It is definitely gonna be a hassle to get the boss to cover this with insurance. Have you seen him recently?',
          pitch: 0.88
        },
        {
          speaker: 'SANJAY',
          text: 'You really need to find him. He has a kill switch that can erase all of our information.',
          pitch: 0.88
        },
        {
          speaker: 'SANJAY',
          text: 'If the FBI gets their hands on that, then even if we make it out, we will never be free. You need to find him.',
          pitch: 0.88
        },
        { speaker: 'SANJAY', text: 'Here, take this shotgun. I am not very good with it. Good luck, Ravi.', pitch: 0.88 }
      ],
      () => this.handOverShotgun()
    );
  }

  /** He passes it up, and it comes straight into Ravi's hands. */
  private handOverShotgun(): void {
    this.hasShotgun = true;
    this.propGun.visible = false; // it is in Ravi's hands now
    this.wanted = 'shotgun';
    this.active = 'shotgun';
    this.weapon.stow = 1;
    this.shotgun.stow = 0;
    this.ctx.audio.slideRack();
    this.hud.setAmmo(this.shells, TUBE_SIZE, false);
    this.dialogue.play(
      [{ speaker: 'SANJAY', text: 'I probably should be on my way now. Need to wash this ketchup stain off.', pitch: 0.88 }],
      () => this.startLeaving()
    );
  }

  /** Up as if nothing had happened, and off back the way Ravi came. */
  private startLeaving(): void {
    this.phase = 'leaving';
    this.wounded.setSlumped(false);
    this.wounded.setShaken();
    this.leaveWalk = 0;
    this.leaveFrom.copy(this.wounded.position);
  }

  private updateLeaving(dt: number): void {
    // Seconds since he decided to get up. Timed rather than normalised: the
    // old version crossed the ten metres to the door inside a second, which
    // is about eleven metres per second — he teleported out.
    this.leaveWalk += dt;
    const STAND = 1.1; // getting to his feet, no ground covered
    if (this.leaveWalk < STAND) {
      this.wounded.setWalk(0);
      return;
    }
    const door = this.level.backDoorway;
    const to = door.clone().sub(this.wounded.position).setY(0);
    const left = to.length();
    if (left > 0.5) {
      // A walk, not a jog. He is in no hurry; as far as he is concerned
      // nothing much has happened.
      this.wounded.position.addScaledVector(to.normalize(), Math.min(left, 1.45 * dt));
      this.wounded.setWalk(0.75);
      this.wounded.faceToward(door, dt, 3.2);
    }
    // The lights go once he is well past Ravi and still walking
    if (this.leaveWalk > STAND + 2.4 && !this.blackout) this.cutPower();
    if (left <= 0.5 && this.blackout) {
      this.wounded.root.visible = false;
      this.handOver();
    }
  }

  /**
   * The floor loses power. Every fixture drops to zero rather than being
   * hidden — the visible light count is part of every material's shader, and
   * moving it would recompile the level on the darkest frame of the game.
   */
  private cutPower(): void {
    this.blackout = true;
    for (const l of this.level.lights) l.intensity = 0;
    for (const m of this.level.lampMats) m.emissiveIntensity = 0;
    // Dim every ambient EXCEPT the night-vision amplifier — the goggles must
    // still work (that's the whole point of the dark floor)
    this.scene.traverse((o) => {
      if (o.type === 'AmbientLight' && o !== this.nvLight) (o as THREE.AmbientLight).intensity = 0.12;
    });
    // And now the goggles are worth knowing about
    const hint = this.ui.querySelector<HTMLElement>('.nv-hint');
    if (hint) hint.style.display = 'block';
    this.scene.fog = new THREE.Fog(0x020305, 4, 22);
    this.ctx.audio.wallCollapse();
  }

  private handOver(): void {
    if (this.phase === 'play') return;
    this.phase = 'play';
    this.player.cinematic = false;
    this.letterbox.classList.add('open');
    // The way on opens once he is gone
    this.level.mazeDoorCollider.disabled = true;
    this.level.mazeDoor.visible = false;
    this.setObjective('FIND THE BOSS');
    this.ctx.input.requestPointerLock();
  }

  // ---------------------------------------------------------------- input

  private onClick(): void {
    if (this.dialogue.isActive) this.dialogue.advance();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.dialogue.isActive && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) {
      e.preventDefault();
      this.dialogue.advance();
      return;
    }
  }

  // --------------------------------------------------------------- update

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    const playable = this.phase === 'walk' || this.phase === 'play';

    if (playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();

    const held = this.active === 'pistol' ? this.weapon : this.shotgun;
    const aiming = playable && input.rightHeld && input.pointerLocked && this.player.alive && !held.reloading;
    this.player.aiming = aiming;
    this.player.update(dt, this.level.colliders);

    // Walking up on him starts the scene
    if (this.phase === 'walk' && this.player.position.x > this.level.talkX) this.beginTalk();
    if (this.phase === 'leaving') this.updateLeaving(dt);

    // ---- Weapon slots. The shotgun is not carried until it is handed over.
    if (playable && this.hasShotgun && !this.dialogue.isActive) {
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

    this.weapon.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming && this.active === 'pistol');
    this.shotgun.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming && this.active === 'shotgun');
    const targetFov = 74 - 22 * this.weapon.aimBlend - 12 * this.shotgun.aimBlend;
    if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
      this.player.camera.fov = targetFov;
      this.player.camera.updateProjectionMatrix();
    }
    this.hud.setAiming(Math.max(this.weapon.aimBlend, this.shotgun.aimBlend) > 0.5);

    // ---- Firing. Nothing to shoot at yet, but the ballistics run so the
    // walls take hits and the pass can be checked with a gun in hand.
    this.fireCooldown -= dt;
    const clicked = input.consumeClick();
    if (
      this.phase === 'play' && this.player.alive && input.pointerLocked &&
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
    // Night vision: flip the goggles down/up
    if (input.wasPressed('KeyN') && this.player.alive) this.toggleNightVision();

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

    // His body stays anchored against the wall; only his head follows Ravi.
    // Once he is up and walking he faces where he is going instead.
    this.wounded.setHeadLook(this.phase === 'leaving' ? null : this.player.eyePosition());
    // ---- The team. Their AI walks the waypoint graph, so they turn corners
    // rather than grinding along walls, and each one drags its beam with it.
    for (let i = 0; i < this.agents.length; i++) {
      const e = this.agents[i];
      e.update(dt);
      if (!e.alive) {
        this.beams.kill(i);
        this.poolCorpse(e);
        continue;
      }
      if (this.phase === 'play') this.agentAI[i].update(dt);
      // Beam out of the muzzle, along the way the weapon is actually pointing
      const from = e.muzzleWorld();
      const dir = e.forwardDir(new THREE.Vector3());
      dir.y = -0.06; // carried a touch low, the way a weapon light is held
      this.beams.aim(i, from, dir.normalize());
    }

    if (this.agents.length) this.separateAgents(dt);

    this.wounded.update(dt);
    this.dialogue.update(dt);
    this.world.step(1 / 60, dt, 3);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.decals.update(dt);
    this.updateDebris(dt);
    for (const f of this.level.flickering) f.update(dt);
    // Clears the one-shot key edges. Without this, wasPressed('Space') stays
    // true after the first press and the player jumps every frame forever.
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

  /**
   * Hold an interval. Waypoint following alone routes several of them
   * through the same junction and they end up standing in each other.
   * Runs after the AI has steered, or the AI just walks them back together
   * on the same frame.
   */
  private separateAgents(dt: number): void {
    const MIN = 1.5;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.agents.length; j++) {
        const b = this.agents[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > MIN * MIN) continue;
        // Exactly co-located: nudge them apart along a fixed axis first
        const d = Math.sqrt(d2) || 0.001;
        const push = ((MIN - d) / MIN) * dt * 3.2;
        const nx = (d2 < 1e-6 ? 1 : dx / d) * push;
        const nz = (d2 < 1e-6 ? 0 : dz / d) * push;
        a.position.x -= nx;
        a.position.z -= nz;
        b.position.x += nx;
        b.position.z += nz;
      }
    }
  }

  private pooled = new Set<Enemy>();

  /** Bodies stop being simulated once they have settled. */
  private poolCorpse(e: Enemy): void {
    if (this.pooled.has(e)) return;
    this.pooled.add(e);
    for (const p of e.parts) {
      const i = this.level.shootables.indexOf(p);
      if (i >= 0) this.level.shootables.splice(i, 1);
    }
  }

  protected killEnemy(
    enemy: Enemy,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    byPlayer: boolean,
    headshot: boolean,
    hitPart?: string
  ): void {
    if (!enemy.alive) return;
    enemy.die(point, dir, this.world, hitPart === 'head' ? 'head' : 'torso');
    const i = this.agents.indexOf(enemy);
    if (i >= 0) {
      this.agentAI[i]?.dispose();
      this.beams.kill(i);
    }
    this.remaining = Math.max(0, this.remaining - 1);
    this.ctx.bus.emit(Events.EnemyKilled, {
      name: enemy.name,
      remaining: this.remaining,
      headshot,
      by: byPlayer ? 'RAVI' : 'FRIENDLY FIRE'
    });
    if (this.remaining <= 0) this.setObjective('FLOOR CLEAR');
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}
