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

  private onOverlayClick(): void {
    if (!this.over) return;
    if (this.won) this.ctx.bus.emit(Events.ReturnToMenu);
    else this.ctx.bus.emit(Events.RestartLevel);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape' && this.over && !this.won) {
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
        this.startReload();
      }
    }
    // Manual reload on R (only if the mag isn't already full)
    if (input.wasPressed('KeyR') && this.player.alive && this.ammo < MAG_SIZE) this.startReload();
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
        if (enemyRef && (enemyRef === shooter || !enemyRef.alive)) return false;
        return true;
      });
      if (!hit) return from.clone().addScaledVector(dir, remaining);

      const obj = hit.object;
      const point = hit.point.clone();
      const normal = (hit.face?.normal ?? new THREE.Vector3(0, 0, 1))
        .clone()
        .transformDirection(obj.matrixWorld);
      const enemyRef = obj.userData.enemy as Enemy | undefined;

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
    this.remaining--;

    audio.fleshHit();
    if (byPlayer) {
      audio.killConfirm();
      bus.emit(Events.HitMarker, { lethal: true });
    }

    // Gore. Every splatter is projected onto a real surface found by raycast;
    // if there's nothing there (over the mezzanine void, etc.) nothing is drawn.
    const ground = this.surfaceBelow(point, 6);
    // Spray particles settle on the true surface under the wound, or never settle
    this.particles.bloodSpray(point, dir, true, ground ? ground.point.y + 0.02 : -1);
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
    castSplat(dir, 0.9 + Math.random() * 0.8, 2.2 + Math.random() * 1.2, 7);
    const fan = 4 + Math.floor(Math.random() * 4);
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

    bus.emit(Events.EnemyKilled, {
      name: enemy.name,
      remaining: this.remaining,
      headshot,
      by: byPlayer ? 'RAVI' : 'FRIENDLY FIRE'
    });

    if (this.remaining <= 0) {
      this.over = true;
      this.won = true;
      bus.emit(Events.LevelComplete);
      this.ctx.input.exitPointerLock();
    }
  }
}
