import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { GameScene } from '../core/GameEngine';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import type { Collider } from '../environment/OfficeLevelBuilder';
import type { BreakableGlass } from '../environment/BreakableGlass';
import type { FPSPlayer } from '../entities/FPSPlayer';
import type { Enemy } from '../entities/Enemy';
import type { ParticleManager } from '../fx/ParticleManager';
import type { BloodDecalSystem } from '../fx/BloodDecalSystem';

/** The parts of a level's data that the shared combat code touches. */
export interface CombatLevel {
  group: THREE.Group;
  colliders: Collider[];
  /** Raycast targets for bullets. */
  shootables: THREE.Object3D[];
  glassPanes: BreakableGlass[];
}

/**
 * CombatScene — the ballistics pipeline, shared by every playable level.
 *
 * A shot is not one event: it is spread → raycast → what did it hit →
 * penetrate or stop → consequences → tracer. Every round in the game runs
 * this same chain, whoever fired it, which is what keeps the world
 * consistent for free — enemy fire shatters glass, agents can kill each
 * other through cubicle walls, and blood lands on real geometry.
 *
 * Subclasses own their own level, weapons, HUD and win conditions, and
 * supply `killEnemy` so each level decides what a death means to it.
 */
export abstract class CombatScene<L extends CombatLevel> implements GameScene {
  protected scene = new THREE.Scene();
  protected raycaster = new THREE.Raycaster();
  protected level!: L;
  protected world!: CANNON.World;
  protected player!: FPSPlayer;
  protected particles!: ParticleManager;
  protected decals!: BloodDecalSystem;

  constructor(protected ctx: GameContext) {}

  abstract enter(): void;
  abstract exit(): void;
  abstract update(dt: number, time: number): void;
  abstract render(renderer: THREE.WebGLRenderer): void;

  /**
   * What a death means to this level — scoring, kill feed, win condition.
   * The universal part (ragdoll, gore, audio) happens in `castBullet`'s
   * callers via this hook, so levels stay free to differ.
   */
  protected abstract killEnemy(
    enemy: Enemy,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    byPlayer: boolean,
    headshot: boolean,
    hitPart?: string
  ): void;

  // ------------------------------------------------------------- world setup

  /**
   * Physics world for ragdolls and debris. Level colliders become static
   * bodies; glass is skipped because a pane can vanish mid-fight.
   */
  protected createPhysicsWorld(colliders: Collider[]): CANNON.World {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -19, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    // Bodies grip surfaces a bit and barely bounce — ragdolls drape, mags clatter
    world.defaultContactMaterial.friction = 0.45;
    world.defaultContactMaterial.restitution = 0.12;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    for (const c of colliders) {
      if (c.glass) continue;
      c.box.getSize(size);
      c.box.getCenter(center);
      world.addBody(
        new CANNON.Body({
          type: CANNON.Body.STATIC,
          shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
          position: new CANNON.Vec3(center.x, center.y, center.z)
        })
      );
    }
    return world;
  }

  /** Break a pane and take it out of the world: used by bullets and by vaulting. */
  protected shatterPane(pane: BreakableGlass, at: THREE.Vector3, dir: THREE.Vector3): void {
    pane.shatter(at, dir, this.particles, this.ctx.audio, this.player.position);
    if (pane.colliderIndex >= 0) this.level.colliders[pane.colliderIndex].disabled = true;
    const idx = this.level.shootables.indexOf(pane.mesh);
    if (idx >= 0) this.level.shootables.splice(idx, 1);
    this.ctx.bus.emit(Events.Sound, { position: at.clone(), radius: 18, kind: 'glass' });
  }

  /** Vaulting straight through a window: smash it and keep going. */
  protected vaultGlass(c: Collider): void {
    const pane = c.glass;
    if (!pane || pane.broken) {
      c.disabled = true;
      return;
    }
    this.shatterPane(pane, pane.center(), this.player.forwardDir());
    c.disabled = true;
  }

  // ------------------------------------------------------------- ballistics

  /**
   * Shared bullet raycast: pierces one cubicle panel, shatters glass and
   * keeps going, stops on hard surfaces, kills intruders it meets.
   * Returns the terminal point (for the tracer).
   */
  protected castBullet(origin: THREE.Vector3, dir: THREE.Vector3, shooter: Enemy | null): THREE.Vector3 {
    const { audio, bus } = this.ctx;
    let from = origin.clone();
    let remaining = 80;
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
      const normal = (hit.face?.normal ?? new THREE.Vector3(0, 0, 1))
        .clone()
        .transformDirection(obj.matrixWorld);
      const enemyRef = obj.userData.enemy as Enemy | undefined;

      // ---- A corpse: it still takes the bullet — jolts, bleeds, gains a wound
      if (enemyRef && !enemyRef.alive) {
        enemyRef.hitCorpse(point, dir);
        this.spatter(point, dir, false); // same exit jet + splatter fan as a kill, a little smaller
        audio.fleshHit();
        if (shooter === null) bus.emit(Events.HitMarker, { lethal: false });
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
        const pane = obj.userData.glass as BreakableGlass;
        if (!pane.broken) this.shatterPane(pane, point, dir);
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

  /**
   * An enemy pulls the trigger on Ravi. Whether they connect is a fairness
   * roll — distance, your speed and crouching all make you harder to hit —
   * and a miss is cast as a real bullet so it can break things behind you.
   */
  protected enemyFire(enemy: Enemy): void {
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

  // ------------------------------------------------------------------- gore

  /**
   * Nearest solid level surface straight down from a point (floors, desks,
   * stairs — not enemies or glass). Null over a void.
   */
  protected surfaceBelow(
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

  /**
   * Blood for a hit at `point` along `dir`: exit jet particles, a stretched
   * splatter fan on whatever is behind, and a drip below. Every splatter is
   * projected onto a real surface found by raycast; if there's nothing there
   * (over the mezzanine void, say) nothing is drawn.
   */
  protected spatter(point: THREE.Vector3, dir: THREE.Vector3, big: boolean): void {
    // Cast against current matrices: update() runs before render(), so world
    // transforms are otherwise a frame stale and splatter can miss.
    this.level.group.updateMatrixWorld(true);
    const ground = this.surfaceBelow(point, 6);
    // Spray particles settle on the true surface under the wound, or never settle
    this.particles.bloodSpray(point, dir, big, ground ? ground.point.y + 0.02 : -1);

    // The bullet carries blood THROUGH the body and throws it on whatever's
    // behind, in that direction: one main streak along the exact exit line
    // plus a fan of smaller spatter around it, each cast separately so they
    // land on the real surfaces they'd hit. Every cast is randomised, so no
    // two kills paint the same pattern.
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

  // ------------------------------------------------------------- debris

  private debris: { mesh: THREE.Object3D; body: CANNON.Body; life: number }[] = [];
  private static DEBRIS_LIFETIME = 60;

  /**
   * Hand a mesh over to physics and let it clatter about — spent magazines,
   * ejected shells. Cleaned up once it settles out of interest or falls out
   * of the world.
   */
  protected addDebris(mesh: THREE.Object3D, body: CANNON.Body): void {
    this.scene.add(mesh);
    this.world.addBody(body);
    this.debris.push({ mesh, body, life: CombatScene.DEBRIS_LIFETIME });
  }

  /** The ejected magazine becomes a real object: it flies, clatters, and lies where it lands. */
  protected dropMagazine(pose: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    direction: THREE.Vector3;
  }): void {
    const { position, quaternion, direction } = pose;
    const polymer = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.95 });
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.1, 0.04), polymer));
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.012, 0.056), polymer);
    plate.position.set(0, -0.053, 0.004);
    mesh.add(plate);
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);

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
    this.addDebris(mesh, body);
  }

  protected updateDebris(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.mesh.position.set(d.body.position.x, d.body.position.y, d.body.position.z);
      d.mesh.quaternion.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w);
      // Fell out of the world (void / through a gap)? Don't simulate forever.
      if (d.life <= 0 || d.body.position.y < -5) {
        this.world.removeBody(d.body);
        this.scene.remove(d.mesh);
        this.debris.splice(i, 1);
      }
    }
  }

  /** Blood pool under a corpse that has come to rest. */
  protected poolUnder(enemy: Enemy): void {
    const under = this.surfaceBelow(enemy.corpseBase(), 3);
    if (under) this.decals.place('pool', under.point, under.normal, undefined, undefined, 1, under.object);
  }
}
