import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level3Builder, Level3Data } from '../environment/Level3Builder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { FPSPlayer } from '../entities/FPSPlayer';
import { WeaponViewmodel } from '../entities/WeaponViewmodel';
import { Enemy } from '../entities/Enemy';
import { EnemyAI } from '../entities/EnemyAI';
import { CivilianAI } from '../entities/CivilianAI';
import { FPSHUD } from '../ui/FPSHUD';
import { DialogueBox } from '../ui/DialogueBox';

const FIRE_COOLDOWN = 0.17;
const MAG_SIZE = 10;

/** How close to the office door the player has to get to start the scene. */
const TRIGGER_X = -15.2;

// ---- Crash beats, in seconds from the end of the dialogue
const T_ENGINE = 0.0; // engine note builds outside
const T_IMPACT = 1.5; // it comes through the wall
const T_GUNNER = 3.0; // the gunner opens up
const T_DOORS = 5.6; // the side door swings and the team piles out
const T_HANDOVER = 6.4; // control returns

/**
 * Level3Scene — the sister office. The player walks a long corridor, opens
 * the door, and is held still while the floor plays out in front of them:
 * everyone working, a colleague ambling over for a chat, and then a Bureau
 * truck through the north wall.
 *
 * Control comes back when the truck's side door opens, not at the crash, so
 * the player sees the team arrive rather than being dropped into it.
 */
export class Level3Scene extends CombatScene<Level3Data> {
  private weapon!: WeaponViewmodel;
  private hud!: FPSHUD;
  private dialogue!: DialogueBox;

  private staff: Enemy[] = [];
  private staffAI = new Map<Enemy, CivilianAI>();
  private greeter!: Enemy;
  private gunner: Enemy | null = null;
  private agents: Enemy[] = [];
  private agentAI: EnemyAI[] = [];

  private phase: 'walk' | 'talk' | 'crash' | 'play' | 'dead' = 'walk';
  private t = 0; // seconds since the crash sequence began
  private beats = new Set<string>();
  private fireCooldown = 0;
  private ammo = MAG_SIZE;
  private remaining = 0;
  private over = false;
  private gunnerBurst = 0;
  private shake = 0;
  /** Roof-deck height of the truck, so the gunner stands on it. */
  private roofY = 2.5;

  private ui!: HTMLElement;
  private objective!: HTMLElement;
  private letterbox!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private pooled = new Set<Enemy>();
  /** Staff on their knees pleading — kept turned towards the agents. */
  private begging = new Set<Enemy>();

  constructor(ctx: GameContext) {
    super(ctx);
  }

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x0a0c10);
    this.scene.fog = new THREE.Fog(0x0a0c10, 26, 64);

    this.level = new Level3Builder().build();
    this.scene.add(this.level.group);
    this.world = this.createPhysicsWorld(this.level.colliders);

    this.player = new FPSPlayer(this.level.playerSpawn, this.level.playerSpawnYaw, input, audio, bus);
    this.scene.add(this.player.camera);
    this.player.onVaultGlass = (c) => this.vaultGlass(c);
    this.weapon = new WeaponViewmodel(this.player.camera);
    this.weapon.onReloadEvent = (e) => {
      if (e === 'magOut') audio.magOut();
      else if (e === 'magDrop') this.dropMagazine(this.weapon.ejectedMagPose());
      else if (e === 'magIn') audio.magIn();
      else if (e === 'rack') audio.slideRack();
      else if (e === 'done') this.ammo = MAG_SIZE;
    };

    this.particles = new ParticleManager(this.scene);
    this.decals = new BloodDecalSystem(this.scene);

    // ---- Staff, going about their day. None of them know yet.
    this.level.deskWorkers.forEach((s, i) => {
      const e = new Enemy(s.pos, s.yaw, i + 2, { name: `STAFF ${i + 1}`, civilian: true });
      e.setSitting(true, true);
      this.addStaff(e);
    });
    const cw = this.level.coolerWorker;
    const atCooler = new Enemy(cw.pos, cw.yaw, 9, { name: 'STAFF', civilian: true });
    this.addStaff(atCooler);
    // The one who comes over for a chat
    this.greeter = new Enemy(this.level.greeterStart, 0, 4, { name: 'DEV', civilian: true });
    this.addStaff(this.greeter);

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
        this.phase = 'dead';
        this.over = true;
      })
    );

    document.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);
    input.requestPointerLock();
    this.setObjective('FIND THE REST OF THE OPERATION');
  }

  private addStaff(e: Enemy): void {
    this.scene.add(e.root);
    this.staff.push(e);
    for (const p of e.parts) this.level.shootables.push(p);
  }

  exit(): void {
    for (const u of this.unsubs) u();
    for (const ai of this.agentAI) ai.dispose();
    for (const ai of this.staffAI.values()) ai.dispose();
    document.removeEventListener('click', this.clickHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.hud.destroy();
    this.dialogue.destroy();
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
      <div class="intro-objective"></div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.letterbox = el.querySelector('.intro-letterbox')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.letterbox.classList.add('open'); // bars stay out until the scene starts
  }

  private setObjective(text: string): void {
    if (this.objective.textContent === text) return;
    this.objective.textContent = text;
    this.objective.classList.remove('show');
    void this.objective.offsetWidth;
    this.objective.classList.add('show');
  }

  // ------------------------------------------------------------- the scene

  /** Reaching the office door hands the floor over to the script. */
  private beginScene(): void {
    this.phase = 'talk';
    this.player.cinematic = true;
    this.player.position.copy(this.level.introStand);
    this.player.yaw = this.level.introYaw;
    this.player.pitch = -0.02;
    this.letterbox.classList.remove('open');
    this.setObjective('');
    this.ctx.input.exitPointerLock();

    // He wanders over, then talks
    this.greeterWalk = 0;
  }

  private greeterWalk = -1; // −1 = not started, else 0..1 along the approach

  private updateTalk(dt: number): void {
    // Amble over to Ravi
    if (this.greeterWalk >= 0 && this.greeterWalk < 1) {
      this.greeterWalk = Math.min(1, this.greeterWalk + dt * 0.42);
      const e = this.greeterWalk * this.greeterWalk * (3 - 2 * this.greeterWalk);
      this.greeter.position.lerpVectors(this.level.greeterStart, this.level.greeterTalkPos, e);
      this.greeter.setWalk(0.55);
      this.greeter.faceToward(this.player.position, dt, 4);
      if (this.greeterWalk >= 1) {
        this.greeter.setWalk(0);
        this.dialogue.play(
          [
            { speaker: 'DEV', text: 'Working hard or hardly working huh Ravi', pitch: 0.95 },
            { speaker: 'DEV', text: 'A gun? you need that for the boss or something? haha just kidding, anyway whats--', pitch: 0.95 }
          ],
          () => this.startCrash()
        );
      }
    }
    this.greeter.faceToward(this.player.position, dt, 3);
  }

  private startCrash(): void {
    this.phase = 'crash';
    this.t = 0;
    this.ctx.audio.truckEngine(1);
  }

  private beat(key: string, at: number, fn: () => void): void {
    if (this.t < at || this.beats.has(key)) return;
    this.beats.add(key);
    fn();
  }

  private updateCrash(dt: number): void {
    const { audio } = this.ctx;
    this.t += dt;
    const L = this.level;

    this.beat('engine', T_ENGINE + 0.6, () => audio.truckEngine(0.8));

    // The truck comes through the wall
    if (this.t >= T_ENGINE && this.t <= T_IMPACT) {
      const u = Math.min(1, (this.t - T_ENGINE) / (T_IMPACT - T_ENGINE));
      L.truck.position.lerpVectors(L.truckFrom, L.truckTo, u * u); // accelerating
    }
    this.beat('impact', T_IMPACT, () => {
      L.truck.position.copy(L.truckTo);
      audio.wallCollapse();
      this.shake = 1;
      // Masonry everywhere
      const at = L.truckTo.clone();
      at.z -= 1.5;
      for (let i = 0; i < 26; i++) {
        const p = at.clone().add(
          new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 2.8, (Math.random() - 0.5) * 2.4)
        );
        const n = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, 0.6 + Math.random()).normalize();
        this.particles.concreteChips(p, n, 0xb9b3a8);
      }
      // The wall comes down: panel gone, its collider dead, and rubble and
      // fire take its place so there is still no way out.
      L.breachWall.visible = false;
      if (L.breachColliderIndex >= 0) L.colliders[L.breachColliderIndex].disabled = true;
      const wallIdx = this.level.shootables.indexOf(L.breachWall);
      if (wallIdx >= 0) this.level.shootables.splice(wallIdx, 1);
      L.breachBarrier.visible = true;
      for (const c of L.breachColliders) L.colliders.push(c);
      // The vehicle itself becomes solid now it has stopped
      for (const c of L.truckColliders) {
        L.colliders.push(c);
        const size = new THREE.Vector3();
        const centre = new THREE.Vector3();
        c.box.getSize(size);
        c.box.getCenter(centre);
        this.world.addBody(new CANNON.Body({
          type: CANNON.Body.STATIC,
          shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
          position: new CANNON.Vec3(centre.x, centre.y, centre.z)
        }));
      }
      // Everyone on the floor loses it
      for (const e of this.staff) this.panic(e);
      this.setObjective('');
    });

    // The gunner opens up on the room
    this.beat('gunner', T_GUNNER, () => {
      const g = L.gunnerSpawn;
      this.roofY = g.pos.y;
      this.gunner = new Enemy(g.pos, g.yaw, 3, { name: 'LMG GUNNER' });
      this.gunner.setTurretGunner(true);
      this.scene.add(this.gunner.root);
      for (const p of this.gunner.parts) this.level.shootables.push(p);
      this.remaining++;
      audio.enemyShout(8);
    });
    if (this.t >= T_GUNNER) this.updateGunner(dt);

    // The side door swings and the team piles out — this is the handover
    this.beat('doors', T_DOORS, () => {
      audio.slideRack();
      // They come OUT of the doorway one at a time and each walks to its own
      // spot. Dropping them all on their final marks at once had five men
      // materialise in a heap and then path to the same waypoint together.
      const mouth = L.truck.position.clone().add(L.truckDoorMouth);
      L.agentSpawns.forEach((sp, i) => {
        const e = new Enemy(mouth, sp.yaw, i + 5, { name: 'FBI AGENT' });
        e.setAiming(true);
        this.scene.add(e.root);
        this.agents.push(e);
        for (const p of e.parts) this.level.shootables.push(p);
        this.remaining++;
        this.deploying.push({ e, from: mouth.clone(), to: sp.pos.clone(), t: -i * 0.45 });
      });
    });
    if (this.t >= T_DOORS) {
      const u = Math.min(1, (this.t - T_DOORS) / 0.55);
      L.truckDoor.rotation.y = -1.9 * (1 - Math.pow(1 - u, 3));
    }

    this.beat('handover', T_HANDOVER, () => this.handOver());
  }

  /** Panic, from whatever they were doing. Blends run so it isn't a snap. */
  private panic(e: Enemy): void {
    if (!e.alive) return;
    e.setSitting(false);
    const roll = Math.random();
    if (roll < 0.45) {
      // Bolt for it
      e.setHandsUp(true);
      this.staffAI.set(e, new CivilianAI(e, this.level.waypoints, this.level.colliders, this.ctx.bus));
    } else if (roll < 0.75) {
      e.setCowering(true); // down on the floor, arms over the head
    } else {
      e.setKneeling(true); // on their knees, hands up, pleading
      e.setHandsUp(true);
      this.begging.add(e);
    }
  }

  private updateGunner(dt: number): void {
    const g = this.gunner;
    const L = this.level;
    if (!g || !g.alive) {
      if (g && !g.alive) L.truckGunYaw.rotation.y *= 1 - Math.min(1, dt * 2);
      return;
    }
    // Traverse the mount onto whoever he's shooting at, and keep the gunner
    // squared up behind it — he rides the ring, so the two never disagree.
    const victim = this.staff.find((s) => s.alive);
    const tp = victim ? victim.position : this.player.position;
    L.truck.updateMatrixWorld(true);
    const local = L.truck.worldToLocal(tp.clone());
    let want = Math.atan2(-local.x, -local.z);
    let delta = want - L.truckGunYaw.rotation.y;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    L.truckGunYaw.rotation.y += delta * Math.min(1, dt * 2.6);
    // Depress the barrel onto the target
    const flat = Math.hypot(local.x, local.z);
    const wantPitch = Math.atan2(tp.y + 1.0 - (L.truck.position.y + L.truckGunYaw.position.y + 0.78), flat);
    L.truckGunMount.rotation.x += (wantPitch - L.truckGunMount.rotation.x) * Math.min(1, dt * 3);
    // Gunner stands on the ring behind the gun, facing the same way
    const ringWorld = new THREE.Vector3();
    L.truckGunYaw.getWorldPosition(ringWorld);
    const gunHeading = L.truck.rotation.y + L.truckGunYaw.rotation.y;
    g.position.set(
      ringWorld.x + Math.sin(gunHeading) * 0.62,
      L.truck.position.y + this.roofY,
      ringWorld.z + Math.cos(gunHeading) * 0.62
    );
    g.yaw = gunHeading;
    g.root.rotation.y = gunHeading;

    // Burst fire at the staff
    this.gunnerBurst -= dt;
    if (this.gunnerBurst <= 0) {
      this.gunnerBurst = 0.11;
      const victim = this.staff.find((s) => s.alive);
      this.ctx.audio.enemyGunshot(g.position.distanceTo(this.player.position) * 0.6);
      g.flashMuzzle();
      // Rounds leave the vehicle gun, not anything in his hands
      L.truckGunMount.updateWorldMatrix(true, false);
      const muzzle = new THREE.Vector3(0, 0, -1.3);
      L.truckGunMount.localToWorld(muzzle);
      this.particles.concreteChips(muzzle, new THREE.Vector3(0, 1, 0), 0xffc46a);
      if (victim && Math.random() < 0.045) {
        const chest = victim.position.clone().add(new THREE.Vector3(0, 1.15, 0));
        const dir = chest.clone().sub(muzzle).normalize();
        this.particles.tracer(muzzle, chest, 0xffe0b0);
        victim.die(chest, dir, this.world, 'torso');
        this.ctx.audio.fleshHit();
        this.spatter(chest, dir, true);
        this.staffAI.get(victim)?.dispose();
      } else {
        const stray = (victim ? victim.position : this.player.position)
          .clone()
          .add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.9 + Math.random(), (Math.random() - 0.5) * 3));
        const dir = stray.sub(muzzle).normalize();
        const end = this.castBullet(muzzle, dir, g);
        this.particles.tracer(muzzle, end, 0xffe0b0);
      }
    }
  }

  /** Agents filing out of the truck to their positions, one after another. */
  private deploying: { e: Enemy; from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];

  private updateDeploy(dt: number): void {
    for (let i = this.deploying.length - 1; i >= 0; i--) {
      const d = this.deploying[i];
      d.t += dt;
      if (d.t < 0) continue; // still waiting its turn inside
      if (!d.e.alive) {
        this.deploying.splice(i, 1);
        continue;
      }
      const u = Math.min(1, d.t / 1.3);
      const k = u * u * (3 - 2 * u);
      d.e.position.lerpVectors(d.from, d.to, k);
      d.e.setWalk(1);
      d.e.faceToward(d.to, dt, 6);
      if (u >= 1) {
        d.e.setWalk(0);
        this.startAgentAI(d.e);
        this.deploying.splice(i, 1);
      }
    }
  }

  /** Hand one agent over to its own AI once it is clear of the truck. */
  private startAgentAI(e: Enemy): void {
    const { bus, audio } = this.ctx;
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
  }

  /**
   * Keep them out of each other. Waypoint following alone had four of them
   * standing in the same square metre.
   */
  private separateAgents(dt: number): void {
    const MIN = 1.15;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.agents.length; j++) {
        const b = this.agents[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > MIN * MIN || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = ((MIN - d) / MIN) * dt * 2.2;
        const nx = (dx / d) * push;
        const nz = (dz / d) * push;
        a.position.x -= nx;
        a.position.z -= nz;
        b.position.x += nx;
        b.position.z += nz;
      }
    }
  }

  private handOver(): void {
    if (this.phase === 'play') return;
    this.phase = 'play';
    this.player.cinematic = false;
    this.letterbox.classList.add('open');
    this.setObjective('THEY BROUGHT A TRUCK. PUT THEM DOWN.');
    // Their AIs come online individually as each one finishes deploying
    this.ctx.input.requestPointerLock();
  }

  // ---------------------------------------------------------------- input

  private onClick(): void {
    if (this.dialogue.isActive) {
      this.dialogue.advance();
      return;
    }
    if (this.phase === 'dead') this.ctx.bus.emit(Events.RestartLevel3);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.dialogue.isActive && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) {
      e.preventDefault();
      this.dialogue.advance();
      return;
    }
    if (e.code === 'Escape' && this.phase === 'dead') this.ctx.bus.emit(Events.ReturnToMenu);
  }

  // --------------------------------------------------------------- update

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    const playable = this.phase === 'walk' || this.phase === 'play';

    if (playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();

    const aiming = playable && input.rightHeld && input.pointerLocked && this.player.alive && !this.weapon.reloading;
    this.player.aiming = aiming;
    this.player.update(dt, this.level.colliders);
    this.weapon.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming);
    const targetFov = 74 - 22 * this.weapon.aimBlend;
    if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
      this.player.camera.fov = targetFov;
      this.player.camera.updateProjectionMatrix();
    }
    this.hud.setAiming(this.weapon.aimBlend > 0.5);

    // Walking the corridor: crossing the threshold starts the scene
    if (this.phase === 'walk' && this.player.position.x > TRIGGER_X) this.beginScene();
    if (this.phase === 'talk') this.updateTalk(dt);
    if (this.phase === 'crash') this.updateCrash(dt);
    if (this.deploying.length) this.updateDeploy(dt);
    if (this.agents.length) this.separateAgents(dt);
    // The gunner keeps working after the handover too
    if (this.phase === 'play') this.updateGunner(dt);

    this.dialogue.update(dt);

    // Camera shake from the impact
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      const s = this.shake * this.shake * 0.06;
      this.player.camera.position.x += (Math.random() - 0.5) * s;
      this.player.camera.position.y += (Math.random() - 0.5) * s;
    }

    // Shooting
    this.fireCooldown -= dt;
    const canFire =
      this.phase === 'play' && this.player.alive && this.fireCooldown <= 0 && input.pointerLocked &&
      !this.player.sprinting && !this.weapon.reloading;
    if (input.consumeClick() && canFire) {
      if (this.ammo > 0) {
        this.fireCooldown = FIRE_COOLDOWN;
        this.ammo--;
        this.playerShoot();
      } else {
        this.ctx.audio.dryFire();
        this.weapon.startReload();
      }
    } else if (!playable) {
      input.consumeClick(); // don't let a queued click fire on handover
    }
    if (input.wasPressed('KeyR') && this.player.alive && this.ammo < MAG_SIZE && !this.player.sprinting) {
      this.weapon.startReload();
    }
    this.hud.setAmmo(this.ammo, MAG_SIZE, this.weapon.reloading);

    // Anyone pleading keeps facing the raid — begging at a wall reads as a
    // bug rather than a person.
    if (this.begging.size) {
      const threat = this.agents.find((a) => a.alive)?.position
        ?? (this.gunner?.alive ? this.gunner.position : this.level.truck.position);
      for (const e of this.begging) {
        if (e.alive) e.faceToward(threat, dt, 2.4);
        else this.begging.delete(e);
      }
    }

    // Everyone on the floor
    let attacking = false;
    for (const e of this.staff) {
      e.update(dt);
      if (e.alive) this.staffAI.get(e)?.update(dt);
      else this.poolCorpse(e);
    }
    this.gunner?.update(dt);
    if (this.gunner && !this.gunner.alive) this.poolCorpse(this.gunner);
    for (let i = 0; i < this.agents.length; i++) {
      this.agents[i].update(dt);
      if (this.agents[i].alive) {
        this.agentAI[i]?.update(dt);
        if (this.agentAI[i]?.state === 'attack') attacking = true;
      } else this.poolCorpse(this.agents[i]);
    }
    this.hud.setAlert(attacking && this.player.alive);
    this.hud.setHealth(this.player.health, this.player.regenProgress);

    // Fire licks
    for (const f of this.level.fires) {
      const ph = (f.userData.phase as number) + performance.now() * 0.004;
      f.scale.y = 0.75 + Math.sin(ph) * 0.3;
      f.scale.x = 0.9 + Math.cos(ph * 1.7) * 0.16;
      f.rotation.y += dt * 1.4;
      (f.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(ph * 1.3) * 0.22;
    }

    for (const f of this.level.flickering) f.update(dt);
    for (const g of this.level.glassPanes) g.update(dt);
    this.updateDebris(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.world.step(1 / 60, dt, 3);
    input.endFrame();
  }

  private poolCorpse(e: Enemy): void {
    if (e.alive || !e.settled || this.pooled.has(e)) return;
    this.pooled.add(e);
    this.poolUnder(e);
    this.ctx.audio.bodyThud(this.player.position.distanceTo(e.position));
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
    hitPart = 'torso'
  ): void {
    const { audio, bus } = this.ctx;
    enemy.die(point, dir, this.world, hitPart);
    audio.fleshHit();
    this.spatter(point, dir, true);

    if (enemy.civilian) {
      this.staffAI.get(enemy)?.dispose();
      bus.emit(Events.EnemyKilled, { name: enemy.name, remaining: this.remaining, headshot, by: byPlayer ? 'RAVI ✖' : 'FBI' });
      return;
    }

    this.remaining = Math.max(0, this.remaining - 1);
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
    if (this.remaining <= 0 && this.phase === 'play') {
      this.setObjective('FLOOR CLEAR');
      for (const ai of this.staffAI.values()) ai.calmDown();
    }
  }
}
