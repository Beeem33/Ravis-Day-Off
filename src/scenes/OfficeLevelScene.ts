import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { OfficeLevelBuilder, LevelData } from '../environment/OfficeLevelBuilder';
import { FPSPlayer } from '../entities/FPSPlayer';
import { WeaponViewmodel } from '../entities/WeaponViewmodel';
import { Enemy } from '../entities/Enemy';
import { EnemyAI } from '../entities/EnemyAI';
import { CivilianAI } from '../entities/CivilianAI';
import { ParticleManager } from '../fx/ParticleManager';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { FPSHUD } from '../ui/FPSHUD';

const FIRE_COOLDOWN = 0.17;
const MAG_SIZE = 10;

/**
 * OfficeLevelScene — the playable shift. Owns the level, the player, all
 * intruders + their AI, the physics world for ragdolls, and the shared
 * ballistics pipeline (spread, piercing, glass, gore, tracers).
 */
export class OfficeLevelScene implements GameScene {
  private scene = new THREE.Scene();
  private level!: LevelData;
  private player!: FPSPlayer;
  private weapon!: WeaponViewmodel;
  private enemies: Enemy[] = [];
  private ais: EnemyAI[] = [];
  private civilians: Enemy[] = [];
  private civAIs: CivilianAI[] = [];
  /** Per-enemy cooldown before they take a shot at a civilian. */
  private civShotTimers = new Map<Enemy, number>();
  private particles!: ParticleManager;
  private decals!: BloodDecalSystem;
  private hud!: FPSHUD;
  private world!: CANNON.World;
  private fireCooldown = 0;
  private ammo = MAG_SIZE;
  private remaining = 0;
  private over = false;
  private won = false;
  private raycaster = new THREE.Raycaster();
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onOverlayClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private unloadGuard = (e: BeforeUnloadEvent): void => {
    if (this.over) return; // shift's already finished, let them go
    e.preventDefault();
    e.returnValue = ''; // legacy browsers need this to show the prompt
  };
  private pooledCorpses = new Set<Enemy>();

  constructor(private ctx: GameContext) {}

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x0a0c10);
    this.scene.fog = new THREE.Fog(0x0a0c10, 24, 60);

    this.level = new OfficeLevelBuilder().build();
    this.scene.add(this.level.group);

    // Physics world for ragdolls; level colliders become static bodies.
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -19, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    // Bodies grip surfaces a bit and barely bounce — ragdolls drape, mags clatter
    this.world.defaultContactMaterial.friction = 0.45;
    this.world.defaultContactMaterial.restitution = 0.12;
    for (const c of this.level.colliders) {
      if (c.glass) continue; // glass may vanish; ragdolls can ignore it
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      c.box.getSize(size);
      c.box.getCenter(center);
      const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
        position: new CANNON.Vec3(center.x, center.y, center.z)
      });
      this.world.addBody(body);
    }

    this.player = new FPSPlayer(this.level.playerSpawn, this.level.playerSpawnYaw, input, audio, bus);
    this.scene.add(this.player.camera);
    // Vaulting through a window: smash the pane and keep going
    this.player.onVaultGlass = (c) => {
      const pane = c.glass;
      if (!pane || pane.broken) {
        c.disabled = true;
        return;
      }
      const dir = this.player.forwardDir();
      pane.shatter(pane.center(), dir, this.particles, audio, this.player.position);
      c.disabled = true;
      const idx = this.level.shootables.indexOf(pane.mesh);
      if (idx >= 0) this.level.shootables.splice(idx, 1);
      bus.emit(Events.Sound, { position: pane.center(), radius: 18, kind: 'glass' });
    };
    this.weapon = new WeaponViewmodel(this.player.camera);
    this.weapon.onReloadEvent = (e) => {
      if (e === 'magOut') audio.magOut();
      else if (e === 'magDrop') this.dropMagazine();
      else if (e === 'magIn') audio.magIn();
      else if (e === 'rack') audio.slideRack();
      else if (e === 'done') this.ammo = MAG_SIZE;
    };

    this.particles = new ParticleManager(this.scene);
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
      if (!enemy.alive) continue;
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

    // Aim down sights on right mouse (sprinting drops the aim)
    const aiming = input.rightHeld && input.pointerLocked && this.player.alive && !this.over && !this.weapon.reloading;
    this.player.aiming = aiming;
    this.player.update(dt, this.level.colliders);
    this.weapon.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming);
    // FOV zoom while aiming
    const targetFov = 74 - 22 * this.weapon.aimBlend;
    if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
      this.player.camera.fov = targetFov;
      this.player.camera.updateProjectionMatrix();
    }
    this.hud.setAiming(this.weapon.aimBlend > 0.5);

    // Player shooting (semi-auto)
    this.fireCooldown -= dt;
    // (no firing at a sprint — the gun is down by your hip; let go of Shift first)
    const canFire =
      this.player.alive && this.fireCooldown <= 0 && input.pointerLocked && !this.player.sprinting && !this.weapon.reloading;
    const clicked = input.consumeClick();
    if (clicked && canFire) {
      if (this.ammo > 0) {
        this.fireCooldown = FIRE_COOLDOWN;
        this.ammo--;
        this.playerShoot();
      } else {
        this.ctx.audio.dryFire();
        if (!this.player.sprinting) this.startReload();
      }
    }
    // Manual reload on R (only if the mag isn't already full)
    if (input.wasPressed('KeyR') && this.player.alive && this.ammo < MAG_SIZE && !this.player.sprinting) this.startReload();
    this.hud.setAmmo(this.ammo, MAG_SIZE, this.weapon.reloading);

    // Enemies + AI
    let anyAttacking = false;
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].update(dt);
      if (this.enemies[i].alive) {
        this.ais[i].update(dt);
        if (this.ais[i].state === 'attack') anyAttacking = true;
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

    for (const f of this.level.flickering) f.update(dt);
    for (const g of this.level.glassPanes) g.update(dt);
    this.updateDroppedMags(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.world.step(1 / 60, dt, 3);

    input.endFrame();
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.player.camera);
  }

  // -------------------------------------------------------------- ballistics

  /**
   * Nearest solid level surface straight down from a point (floors, desks,
   * stairs — not enemies or glass). Null over a void.
   */
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
    // Only accept upward-facing surfaces; a wall edge isn't somewhere blood pools
    if (normal.y < 0.5) return null;
    return { point: hit.point, normal, object: hit.object };
  }

  // ---------------------------------------------------------- dropped mags

  private droppedMags: { mesh: THREE.Group; body: CANNON.Body; life: number }[] = [];
  private static MAG_LIFETIME = 60;

  /** The ejected magazine becomes a real object: it flies, clatters, and lies where it lands. */
  private dropMagazine(): void {
    const { position, quaternion, direction } = this.weapon.ejectedMagPose();
    const polymer = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.95 });
    const mesh = new THREE.Group();
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.1, 0.04), polymer);
    mesh.add(bodyMesh);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.012, 0.056), polymer);
    plate.position.set(0, -0.053, 0.004);
    mesh.add(plate);
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    this.scene.add(mesh);

    const body = new CANNON.Body({
      mass: 0.15,
      shape: new CANNON.Box(new CANNON.Vec3(0.013, 0.056, 0.02)),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      linearDamping: 0.05,
      angularDamping: 0.2
    });
    body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    // Spring-ejected along the well, plus whatever Ravi's moving at
    const v = direction.clone().multiplyScalar(3.2 + Math.random()).add(this.player.velocity);
    body.velocity.set(v.x, v.y, v.z);
    body.angularVelocity.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    this.world.addBody(body);
    this.droppedMags.push({ mesh, body, life: OfficeLevelScene.MAG_LIFETIME });
  }

  private updateDroppedMags(dt: number): void {
    for (let i = this.droppedMags.length - 1; i >= 0; i--) {
      const m = this.droppedMags[i];
      m.life -= dt;
      m.mesh.position.set(m.body.position.x, m.body.position.y, m.body.position.z);
      m.mesh.quaternion.set(m.body.quaternion.x, m.body.quaternion.y, m.body.quaternion.z, m.body.quaternion.w);
      // Fell out of the world (void / through a gap)? Don't simulate forever.
      if (m.life <= 0 || m.body.position.y < -5) {
        this.world.removeBody(m.body);
        this.scene.remove(m.mesh);
        this.droppedMags.splice(i, 1);
      }
    }
  }

  private startReload(): void {
    if (this.weapon.startReload()) {
      this.player.aiming = false;
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

  private enemyFire(enemy: Enemy): void {
    const { audio, bus } = this.ctx;
    const player = this.player;
    const dist = player.position.distanceTo(enemy.position);
    audio.enemyGunshot(dist);
    enemy.flashMuzzle();
    bus.emit(Events.Sound, { position: enemy.position.clone(), radius: 25, kind: 'gunshot' });

    const muzzle = enemy.muzzleWorld();
    // Fairness roll for whether they hit you at all: distance, your speed
    // and crouching all make you harder to hit. A hit costs one health.
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
      // Miss: bullet streaks past and lands somewhere behind the player
      const target = player.eyePosition();
      const off = 0.35 + Math.random() * 0.7;
      target.add(
        new THREE.Vector3(
          (Math.random() - 0.5) * off * 2,
          (Math.random() - 0.5) * off,
          (Math.random() - 0.5) * off * 2
        )
      );
      const dir = target.sub(muzzle).normalize();
      const end = this.castBullet(muzzle, dir, enemy);
      this.particles.tracer(muzzle, end, 0xffe0b0);
      // Misses are audible only — no screen flash, that reads as being hit
      if (player.alive) audio.bulletWhiz();
    }
  }

  /**
   * Shared bullet raycast: pierces one cubicle panel, shatters glass and
   * keeps going, stops on hard surfaces, kills intruders it meets.
   * Returns the terminal point (for the tracer).
   */
  private castBullet(origin: THREE.Vector3, dir: THREE.Vector3, shooter: Enemy | null): THREE.Vector3 {
    const { audio } = this.ctx;
    let from = origin.clone();
    let remaining = 80;
    let pierces = 0;

    for (let guard = 0; guard < 6; guard++) {
      this.raycaster.set(from, dir);
      this.raycaster.far = remaining;
      const hits = this.raycaster
        .intersectObjects(this.level.shootables, false)
        .filter((h) => h.distance > 0.02);

      const hit = hits.find((h) => {
        const enemyRef = h.object.userData.enemy as Enemy | undefined;
        if (enemyRef && enemyRef === shooter) return false;
        return true;
      });
      if (!hit) return from.clone().addScaledVector(dir, remaining);

      const obj = hit.object;
      const point = hit.point.clone();
      const normal = (hit.face?.normal ?? new THREE.Vector3(0, 0, 1))
        .clone()
        .transformDirection(obj.matrixWorld);
      const enemyRef = obj.userData.enemy as Enemy | undefined;

      // ---- A corpse: it still takes the bullet — jolts, bleeds, gains a wound
      if (enemyRef && !enemyRef.alive) {
        enemyRef.hitCorpse(point, dir);
        this.spatter(point, dir, false); // same exit jet + splatter fan as a kill, a little smaller
        this.ctx.audio.fleshHit();
        if (shooter === null) this.ctx.bus.emit(Events.HitMarker, { lethal: false });
        return point;
      }

      // ---- Lethal hit on an intruder
      if (enemyRef) {
        const headshot = obj.userData.part === 'head';
        this.killEnemy(enemyRef, point, dir, shooter === null, headshot, (obj.userData.part as string) ?? 'torso');
        return point;
      }

      // ---- Breakable glass: shatter and keep flying
      if (obj.userData.glass) {
        const pane = obj.userData.glass as import('../environment/BreakableGlass').BreakableGlass;
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

      // ---- Cubicle panels: soft cover, one panel of penetration
      if (obj.userData.pierce && pierces < 1) {
        pierces++;
        this.particles.concreteChips(point, normal, 0x9aa2b0);
        this.decals.place('bullethole', point, normal);
        // Exit-side puff
        this.particles.concreteChips(point.clone().addScaledVector(dir, 0.1), dir, 0x9aa2b0);
        remaining -= hit.distance + 0.12;
        from = point.clone().addScaledVector(dir, 0.12);
        continue;
      }

      // ---- Hard surface: impact and stop
      const surface = (obj.userData.surface as string) ?? 'concrete';
      const tint = surface === 'metal' ? 0x8f979e : surface === 'wood' ? 0x9a7d55 : 0xb9b3a8;
      this.particles.concreteChips(point, normal, tint);
      this.decals.place('bullethole', point, normal);
      audio.ricochet(point.distanceTo(this.player.position));
      return point;
    }
    return from;
  }

  private killEnemy(
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

    // Shooting one of your own staff is not progress: it doesn't count
    // towards the intruders and there's no kill confirm for it.
    if (enemy.civilian) {
      this.civAIs.find((a) => a['civ'] === enemy)?.dispose();
      bus.emit(Events.EnemyKilled, {
        name: enemy.name,
        remaining: this.remaining,
        headshot,
        by: byPlayer ? 'RAVI ✖' : 'FBI'
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

    if (this.remaining <= 0) {
      this.over = true;
      this.won = true;
      // Anyone still alive out there can stop running now
      for (const ai of this.civAIs) ai.calmDown();
      bus.emit(Events.LevelComplete);
      // Let the last one hit the floor before the shift-complete card (3 s)
      window.setTimeout(() => this.ctx.input.exitPointerLock(), 3000);
    }
  }

  /** Blood for a hit at point along dir: exit jet particles, stretched splatter fan on what's behind, drip below. */
  private spatter(point: THREE.Vector3, dir: THREE.Vector3, big: boolean): void {
    // Cast against current matrices: update() runs before render(), so world
    // transforms are otherwise a frame stale and splatter can miss.
    this.level.group.updateMatrixWorld(true);
    // Gore. Every splatter is projected onto a real surface found by raycast;
    // if there's nothing there (over the mezzanine void, etc.) nothing is drawn.
    const ground = this.surfaceBelow(point, 6);
    // Spray particles settle on the true surface under the wound, or never settle
    this.particles.bloodSpray(point, dir, big, ground ? ground.point.y + 0.02 : -1);
    // Exit splatter: the bullet carries blood THROUGH the body and throws it
    // on whatever's behind, in that direction. One main streak along the
    // exact exit line plus a fan of smaller spatter around it, each cast
    // separately so they land on the real surfaces they'd hit. Every cast
    // is randomised, so no two kills paint the same pattern.
    const exitFrom = point.clone().addScaledVector(dir, 0.3);
    const castSplat = (d: THREE.Vector3, size: number, stretch: number, maxDist: number): void => {
      this.raycaster.set(exitFrom, d);
      this.raycaster.far = maxDist;
      const hit = this.raycaster
        .intersectObjects(this.level.shootables, false)
        .find((h) => !h.object.userData.enemy && !h.object.userData.glass);
      if (!hit) return;
      const n = (hit.face?.normal ?? new THREE.Vector3(0, 0, 1)).clone().transformDirection(hit.object.matrixWorld);
      // Farther surfaces get a thinner, longer spray; near ones a fat splash
      const falloff = Math.max(0.35, 1 - hit.distance / maxDist);
      this.decals.place('blood', hit.point, n, size * falloff, d, stretch, hit.object);
    };
    castSplat(dir, (big ? 0.9 : 0.5) + Math.random() * 0.8, 2.2 + Math.random() * 1.2, 7);
    const fan = (big ? 4 : 2) + Math.floor(Math.random() * 4);
    for (let i = 0; i < fan; i++) {
      const d = dir
        .clone()
        .add(
          new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.45, (Math.random() - 0.5) * 0.5)
        )
        .normalize();
      castSplat(d, 0.25 + Math.random() * 0.5, 1.3 + Math.random() * 1.2, 6);
    }
    // Drip splash on the surface directly below the wound
    if (ground) this.decals.place('blood', ground.point, ground.normal, undefined, undefined, 1, ground.object);
  }
}
