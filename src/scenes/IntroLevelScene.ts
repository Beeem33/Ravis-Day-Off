import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { IntroOfficeBuilder, IntroLevelData } from '../environment/IntroOfficeBuilder';
import { FPSPlayer } from '../entities/FPSPlayer';
import { WeaponViewmodel } from '../entities/WeaponViewmodel';
import { Enemy } from '../entities/Enemy';
import { EnemyAI } from '../entities/EnemyAI';
import { ParticleManager } from '../fx/ParticleManager';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { FPSHUD } from '../ui/FPSHUD';
import type { BreakableGlass } from '../environment/BreakableGlass';

const FIRE_COOLDOWN = 0.17;
const MAG_SIZE = 10;

// ---- Cutscene beats, in seconds from the top of the level
const T_SHOTS = 1.5; // gunfire somewhere out on the floor
const T_TURN0 = 1.65; // Ravi starts to look up from his screen
const T_TURN1 = 3.2; // ...and is facing the glass
const T_WALK0 = 3.2; // the agent walks into view
const T_WALK1 = 4.9; // ...and stops, two metres off her
const T_RAISE = 5.0; // rifle comes up to the shoulder
const T_EXEC = 6.0; // he fires; she goes down
const T_DRAW0 = 7.6; // Ravi looks down at the drawer
const T_DRAW1 = 8.8; // the gun is in his hand
const T_END = 9.5; // control passes to the player

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
export class IntroLevelScene implements GameScene {
  private scene = new THREE.Scene();
  private level!: IntroLevelData;
  private player!: FPSPlayer;
  private weapon!: WeaponViewmodel;
  private agent!: Enemy;
  private agentAI: EnemyAI | null = null;
  private coworker!: Enemy;
  private particles!: ParticleManager;
  private decals!: BloodDecalSystem;
  private hud!: FPSHUD;
  private world!: CANNON.World;
  private raycaster = new THREE.Raycaster();

  private phase: 'cutscene' | 'play' | 'leaving' | 'dead' = 'cutscene';
  private t = 0;
  private beats = new Set<string>();
  private fireCooldown = 0;
  private ammo = MAG_SIZE;
  private agentDown = false;
  private fade = 0; // 0..1 black wipe on the way out
  private lookYaw = 0;

  private ui!: HTMLElement;
  private objective!: HTMLElement;
  private letterbox!: HTMLElement;
  private fadeEl!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private corpsePooled = new Set<Enemy>();

  constructor(private ctx: GameContext) {}

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x0a0c10);
    this.scene.fog = new THREE.Fog(0x0a0c10, 22, 55);

    this.level = new IntroOfficeBuilder().build();
    this.scene.add(this.level.group);

    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -19, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.45;
    this.world.defaultContactMaterial.restitution = 0.12;
    for (const c of this.level.colliders) {
      if (c.glass) continue;
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      c.box.getSize(size);
      c.box.getCenter(center);
      this.world.addBody(
        new CANNON.Body({
          type: CANNON.Body.STATIC,
          shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
          position: new CANNON.Vec3(center.x, center.y, center.z)
        })
      );
    }

    this.player = new FPSPlayer(this.level.playerSpawn, this.level.playerSpawnYaw, input, audio, bus);
    this.player.cinematic = true;
    this.player.pitch = this.level.introPitch; // aimed at the news on his screen
    this.scene.add(this.player.camera);
    this.player.onVaultGlass = (c) => this.smashGlass(c.glass, c);

    this.weapon = new WeaponViewmodel(this.player.camera);
    this.weapon.stow = 1; // still in the drawer
    this.weapon.onReloadEvent = (e) => {
      if (e === 'magOut') audio.magOut();
      else if (e === 'magIn') audio.magIn();
      else if (e === 'rack') audio.slideRack();
      else if (e === 'done') this.ammo = MAG_SIZE;
    };

    this.particles = new ParticleManager(this.scene);
    this.decals = new BloodDecalSystem(this.scene);

    // The coworker — a civilian, no AI; she is only here to die.
    const cw = this.level.coworkerSpawn;
    this.coworker = new Enemy(cw.pos, cw.yaw, 0, { name: 'PRIYA', civilian: true });
    this.scene.add(this.coworker.root);
    for (const p of this.coworker.parts) this.level.shootables.push(p);

    // The agent — rifle stays down until he's in position, and AI is
    // withheld until the cutscene is done.
    const ag = this.level.agentSpawn;
    this.agent = new Enemy(ag.pos, ag.yaw, 1, { name: 'FBI AGENT' });
    this.scene.add(this.agent.root);
    for (const p of this.agent.parts) this.level.shootables.push(p);

    // Ravi ends up looking at the midpoint of the pair, so both of them are
    // in frame side-on rather than one hidden behind the other.
    const mid = cw.pos.clone().add(this.level.agentFiringPos).multiplyScalar(0.5);
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
    this.weapon.stow = track([[0, 1], [T_DRAW0, 1], [T_DRAW1, 0]], this.t);

    // Beats
    this.beat('shot1', T_SHOTS, () => audio.enemyGunshot(22));
    this.beat('shout', T_SHOTS + 0.35, () => audio.enemyShout(16));
    this.beat('shot2', T_SHOTS + 0.6, () => audio.enemyGunshot(20));
    this.beat('shot3', T_SHOTS + 0.95, () => audio.enemyGunshot(24));
    // She is already on her feet with her hands up when he walks in
    this.beat('handsup', T_TURN0, () => this.coworker.setHandsUp(true));
    this.beat('raise', T_RAISE, () => {
      this.agent.setWalk(0);
      this.agent.setAiming(true); // the rifle visibly comes up to the shoulder
    });
    this.beat('exec', T_EXEC, () => this.executeCoworker());
    this.beat('drawer', T_DRAW0 + 0.15, () => audio.magOut());
    this.beat('rack', T_DRAW1 - 0.15, () => audio.slideRack());

    // The agent walks in from the north and stops short of her
    if (this.t >= T_WALK0 && this.t <= T_WALK1) {
      const u = (this.t - T_WALK0) / (T_WALK1 - T_WALK0);
      const s = u * u * (3 - 2 * u);
      this.agent.position.lerpVectors(this.level.agentSpawn.pos, this.level.agentFiringPos, s);
      this.agent.setWalk(1);
    }
    // He tracks her the whole way in; she watches him
    this.agent.faceToward(this.coworker.position, dt, 4);
    if (this.coworker.alive) this.coworker.faceToward(this.agent.position, dt, 3);

    if (this.t >= T_END) this.beginPlay();
  }

  private executeCoworker(): void {
    const { audio } = this.ctx;
    this.agent.flashMuzzle();
    audio.enemyGunshot(this.agent.position.distanceTo(this.player.position));
    const chest = this.coworker.position.clone().add(new THREE.Vector3(0, 1.15, 0));
    const dir = chest.clone().sub(this.agent.muzzleWorld()).normalize();
    this.particles.tracer(this.agent.muzzleWorld(), chest, 0xffe0b0);
    this.coworker.die(chest, dir, this.world, 'torso');
    audio.fleshHit();
    this.spatter(chest, dir, true);
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

    // Shooting
    this.fireCooldown -= dt;
    const canFire =
      playable && this.player.alive && this.fireCooldown <= 0 && input.pointerLocked &&
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
    }
    if (input.wasPressed('KeyR') && this.player.alive && this.ammo < MAG_SIZE && !this.player.sprinting) {
      this.weapon.startReload();
    }
    this.hud.setAmmo(this.ammo, MAG_SIZE, this.weapon.reloading);

    // The agent
    this.agent.update(dt);
    if (this.agent.alive) {
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

  private enemyFire(enemy: Enemy): void {
    const { audio, bus } = this.ctx;
    const player = this.player;
    const dist = player.position.distanceTo(enemy.position);
    audio.enemyGunshot(dist);
    enemy.flashMuzzle();
    bus.emit(Events.Sound, { position: enemy.position.clone(), radius: 25, kind: 'gunshot' });

    const muzzle = enemy.muzzleWorld();
    const speedFactor = Math.min(1, player.currentSpeed / 6.6);
    let hitChance = 0.65 - dist * 0.03 - speedFactor * 0.3 - (player.crouching ? 0.12 : 0);
    hitChance = THREE.MathUtils.clamp(hitChance, 0.1, 0.9);

    if (Math.random() < hitChance && player.alive) {
      const target = player.eyePosition().add(
        new THREE.Vector3((Math.random() - 0.5) * 0.2, -0.2 - Math.random() * 0.4, (Math.random() - 0.5) * 0.2)
      );
      this.particles.tracer(muzzle, target, 0xffe0b0);
      player.hit(enemy.name);
    } else {
      const target = player.eyePosition();
      const off = 0.35 + Math.random() * 0.7;
      target.add(
        new THREE.Vector3((Math.random() - 0.5) * off * 2, (Math.random() - 0.5) * off, (Math.random() - 0.5) * off * 2)
      );
      const d = target.sub(muzzle).normalize();
      const end = this.castBullet(muzzle, d, enemy);
      this.particles.tracer(muzzle, end, 0xffe0b0);
      if (player.alive) audio.bulletWhiz();
    }
  }

  private smashGlass(pane: BreakableGlass | undefined, c: { disabled?: boolean }): void {
    if (!pane || pane.broken) {
      c.disabled = true;
      return;
    }
    pane.shatter(pane.center(), this.player.forwardDir(), this.particles, this.ctx.audio, this.player.position);
    c.disabled = true;
    const idx = this.level.shootables.indexOf(pane.mesh);
    if (idx >= 0) this.level.shootables.splice(idx, 1);
    this.ctx.bus.emit(Events.Sound, { position: pane.center(), radius: 18, kind: 'glass' });
  }

  /** Bullet raycast: glass shatters and the round keeps going, panels take one pierce. */
  private castBullet(origin: THREE.Vector3, dir: THREE.Vector3, shooter: Enemy | null): THREE.Vector3 {
    const { audio } = this.ctx;
    let from = origin.clone();
    let remaining = 60;
    let pierces = 0;

    for (let guard = 0; guard < 6; guard++) {
      this.raycaster.set(from, dir);
      this.raycaster.far = remaining;
      const hit = this.raycaster
        .intersectObjects(this.level.shootables, false)
        .filter((h) => h.distance > 0.02)
        .find((h) => {
          const e = h.object.userData.enemy as Enemy | undefined;
          return !(e && e === shooter); // never hit yourself
        });
      if (!hit) return from.clone().addScaledVector(dir, remaining);

      const obj = hit.object;
      const point = hit.point.clone();
      const normal = (hit.face?.normal ?? new THREE.Vector3(0, 0, 1)).clone().transformDirection(obj.matrixWorld);
      const enemyRef = obj.userData.enemy as Enemy | undefined;

      if (enemyRef && !enemyRef.alive) {
        enemyRef.hitCorpse(point, dir);
        this.spatter(point, dir, false);
        audio.fleshHit();
        if (shooter === null) this.ctx.bus.emit(Events.HitMarker, { lethal: false });
        return point;
      }

      if (enemyRef) {
        this.killEnemy(enemyRef, point, dir, shooter === null, (obj.userData.part as string) ?? 'torso');
        return point;
      }

      if (obj.userData.glass) {
        const pane = obj.userData.glass as BreakableGlass;
        if (!pane.broken) {
          pane.shatter(point, dir, this.particles, audio, this.player.position);
          if (pane.colliderIndex >= 0) this.level.colliders[pane.colliderIndex].disabled = true;
          const idx = this.level.shootables.indexOf(obj);
          if (idx >= 0) this.level.shootables.splice(idx, 1);
          this.ctx.bus.emit(Events.Sound, { position: point.clone(), radius: 18, kind: 'glass' });
        }
        remaining -= hit.distance + 0.05;
        from = point.addScaledVector(dir, 0.05);
        continue;
      }

      if (obj.userData.pierce && pierces < 1) {
        pierces++;
        this.particles.concreteChips(point, normal, 0x9aa2b0);
        this.decals.place('bullethole', point, normal);
        remaining -= hit.distance + 0.12;
        from = point.clone().addScaledVector(dir, 0.12);
        continue;
      }

      const surface = (obj.userData.surface as string) ?? 'concrete';
      const tint = surface === 'metal' ? 0x8f979e : surface === 'wood' ? 0x9a7d55 : 0xb9b3a8;
      this.particles.concreteChips(point, normal, tint);
      this.decals.place('bullethole', point, normal);
      audio.ricochet(point.distanceTo(this.player.position));
      return point;
    }
    return from;
  }

  private killEnemy(enemy: Enemy, point: THREE.Vector3, dir: THREE.Vector3, byPlayer: boolean, hitPart: string): void {
    const { audio, bus } = this.ctx;
    enemy.die(point, dir, this.world, hitPart);
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
        headshot: hitPart === 'head',
        by: byPlayer ? 'RAVI' : 'FRIENDLY FIRE'
      });
      this.setObjective('NOW GET OUT — THE DOOR AT THE END OF THE HALL');
    }
  }

  private surfaceBelow(
    from: THREE.Vector3,
    maxDist: number
  ): { point: THREE.Vector3; normal: THREE.Vector3; object: THREE.Object3D } | null {
    this.raycaster.set(from.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, -1, 0));
    this.raycaster.far = maxDist + 0.05;
    const hit = this.raycaster
      .intersectObjects(this.level.shootables, false)
      .find((h) => !h.object.userData.enemy && !h.object.userData.glass);
    if (!hit) return null;
    const normal = (hit.face?.normal ?? new THREE.Vector3(0, 1, 0)).clone().transformDirection(hit.object.matrixWorld);
    if (normal.y < 0.5) return null;
    return { point: hit.point, normal, object: hit.object };
  }

  /** Exit jet, splatter on whatever is behind, and a drip below. */
  private spatter(point: THREE.Vector3, dir: THREE.Vector3, big: boolean): void {
    const ground = this.surfaceBelow(point, 6);
    this.particles.bloodSpray(point, dir, big, ground ? ground.point.y + 0.02 : -1);
    const exitFrom = point.clone().addScaledVector(dir, 0.3);
    const castSplat = (d: THREE.Vector3, size: number, stretch: number, maxDist: number): void => {
      this.raycaster.set(exitFrom, d);
      this.raycaster.far = maxDist;
      const hit = this.raycaster
        .intersectObjects(this.level.shootables, false)
        .find((h) => !h.object.userData.enemy && !h.object.userData.glass);
      if (!hit) return;
      const n = (hit.face?.normal ?? new THREE.Vector3(0, 0, 1)).clone().transformDirection(hit.object.matrixWorld);
      const falloff = Math.max(0.35, 1 - hit.distance / maxDist);
      this.decals.place('blood', hit.point, n, size * falloff, d, stretch, hit.object);
    };
    castSplat(dir, (big ? 0.9 : 0.5) + Math.random() * 0.8, 2.2 + Math.random() * 1.2, 7);
    const fan = (big ? 4 : 2) + Math.floor(Math.random() * 4);
    for (let i = 0; i < fan; i++) {
      const d = dir
        .clone()
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.45, (Math.random() - 0.5) * 0.5))
        .normalize();
      castSplat(d, 0.25 + Math.random() * 0.5, 1.3 + Math.random() * 1.2, 6);
    }
    if (ground) this.decals.place('blood', ground.point, ground.normal, undefined, undefined, 1, ground.object);
  }
}
