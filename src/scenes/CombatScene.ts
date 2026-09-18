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
import type { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import type { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import type { DropKickViewmodel } from '../entities/DropKickViewmodel';
import type { TakedownViewmodel } from '../entities/TakedownViewmodel';

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
  /** Shared muzzle lights — see MuzzleFlashPool for why they are shared. */
  protected flashPool!: MuzzleFlashPool;
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
    hitPart?: string,
    /** How hard they are thrown. 1 is a bullet; a boot is about 2. */
    impulseScale?: number,
    /** `wound: false` for a melee kill — no bullet hole, and no blood thrown. */
    opts?: { wound?: boolean; keepWeapon?: boolean }
  ): void;

  // ------------------------------------------------------------- warm-up

  /** Set once the shader warm-up has run for this scene. */
  private warmedUp = false;

  /**
   * Compile every shader the level will ever need, before the player can
   * see a hitch.
   *
   * WebGL compiles and links a program the first time a material is
   * actually drawn, and uploads its textures with it. Everything that only
   * appears mid-fight — the muzzle flash, tracers, blood decals, bullet
   * holes, the particle pools, and anything built `visible = false` and
   * revealed later — therefore paid for itself on the frame it was needed.
   * That is the stutter on the first shot of a level, and the one when the
   * truck's rubble and fire appear.
   *
   * So: force-show the hidden objects, spawn one of every effect far under
   * the floor, draw a single throwaway frame, then put it all back. One
   * expensive frame during the fade instead of one in the middle of a fight.
   */
  protected warmUp(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (this.warmedUp) return;
    this.warmedUp = true;

    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      // Lights are deliberately left alone: the number of VISIBLE lights is
      // part of every material's program key, so switching one on here would
      // compile the wrong variant and the real one would still cost a full
      // recompile the first time it was needed. Nothing in the game toggles
      // light visibility any more — see MuzzleFlashPool.
      if (!o.visible && !(o as THREE.Light).isLight) {
        hidden.push(o);
        o.visible = true;
      }
    });

    // One of every effect, parked well below the floor where nothing shows
    const far = new THREE.Vector3(0, -60, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const nDecals = this.decals ? this.decals.count : 0;
    if (this.particles) {
      this.particles.tracer(far, far.clone().add(new THREE.Vector3(0, 0, 3)));
      this.particles.muzzleFlash(far, up);
      this.particles.bloodSpray(far, up, true, -61);
      this.particles.concreteChips(far, up);
      this.particles.glassShards(far, up, -61);
    }
    if (this.decals) {
      this.decals.place('blood', far, up);
      this.decals.place('pool', far, up);
      this.decals.place('bullethole', far, up);
    }

    // compile() covers materials already in the graph; the throwaway draw
    // catches anything it misses and forces the texture uploads.
    renderer.compile(this.scene, camera);
    renderer.render(this.scene, camera);

    for (const o of hidden) o.visible = false;
    if (this.decals) this.decals.trimTo(nDecals);
    if (this.particles) this.particles.clear();
  }

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

  // -------------------------------------------------------------- takedown

  /**
   * Where the takedown's blade goes in: 1.1m up and 13cm to Ravi's right of
   * the man's spine — measured off the knife in TakedownViewmodel, where the
   * blade crosses the front of his torso. His right hand drives it into the
   * side of the man on that half of the frame, so the blood, the wound and
   * the way the body twists as it drops all have to come from that side too,
   * not from the middle of his shirt.
   */
  protected knifeWound(victim: Enemy): THREE.Vector3 {
    const f = this.player.forwardDir();
    return victim.position.clone().add(new THREE.Vector3(-f.z * 0.13, 1.1, f.x * 0.13));
  }

  private static _holdA = new THREE.Vector3();
  private static _holdB = new THREE.Vector3();
  private static _holdK = new THREE.Vector3();
  private static _holdK2 = new THREE.Vector3();
  private static _belly = new THREE.Vector3();
  private static _head = new THREE.Vector3();

  /**
   * Put the two of them in touch for the frame: the man gets Ravi's arms to
   * hold on to (the forearm across his chest, the knife arm once it's coming
   * at him) and Ravi's fists get the man's stomach and head to aim at. Call
   * after player.update(): the arms ride the camera, and the camera only
   * settles for the frame there.
   */
  protected holdOn(vm: TakedownViewmodel, victim: Enemy): void {
    const { _holdA: a, _holdB: b, _holdK: k, _holdK2: k2 } = CombatScene;
    vm.gap = Math.hypot(this.player.position.x - victim.position.x, this.player.position.z - victim.position.z);
    vm.holdPoints(a, b, k, k2);
    victim.clutch(a, b, k, k2);
    if (victim.alive) vm.aimAt(victim.bellyWorld(CombatScene._belly), victim.headWorld(CombatScene._head));
  }

  /**
   * The counter's last punch: a left hook to the side of his head, which
   * kills him. The blow lands on the side of the head nearest Ravi's left
   * fist and drives across him to Ravi's right, a little forward, so the
   * head snaps away and he goes down sideways out of the fold he was in.
   * No wound — it's a fist — but a spray from the mouth, without the wall
   * splatter a bullet throws.
   */
  protected knockOut(victim: Enemy): void {
    const f = this.player.forwardDir();
    const right = new THREE.Vector3(-f.z, 0, f.x);
    const head = victim.headWorld();
    const hit = head.clone().addScaledVector(right, -0.11);
    const dir = right.clone().multiplyScalar(0.9).addScaledVector(f, 0.35).normalize();
    this.killEnemy(victim, hit, dir, true, false, 'head', 1.0, { wound: false });
    this.ctx.audio.punchImpact(true);
    const floor = this.surfaceBelow(head, 3);
    this.particles.bloodSpray(head, dir, false, floor ? floor.point.y + 0.02 : -1);
  }

  // ------------------------------------------------------------- drop kick

  /**
   * Nearest living enemy in front of Ravi and close enough to reach with a
   * boot. Wider and a little longer than the knife's grab range — he is
   * leaping at them, not reaching for them.
   *
   * Each level keeps its enemies differently, so they pass their own list.
   */
  protected kickTargetFrom(candidates: Enemy[]): Enemy | null {
    if (!this.player.alive) return null;
    const fwd = this.player.forwardDir();
    let best: Enemy | null = null;
    let bestD = 2.6;
    for (const e of candidates) {
      if (!e.alive || e.beingExecuted) continue;
      const to = e.position.clone().sub(this.player.position);
      if (Math.abs(to.y) > 1.2) continue; // same floor only
      to.y = 0;
      const d = to.length();
      if (d > bestD || d < 0.05) continue;
      if (to.normalize().dot(fwd) < 0.55) continue;
      best = e;
      bestD = d;
    }
    return best;
  }

  /**
   * The ground a kick covers. Null when none is under way.
   * - dir: horizontal, fixed at the press — at the man if there is one,
   *   otherwise wherever Ravi was facing.
   * - entry: his speed along dir at the press. This is the sprint.
   * - reach: how far he may travel before the boots land (to a boot's length
   *   off the man's chest), or -1 with nobody there to stop short of.
   * - gone: how far along dir he has got.
   */
  private kickRun: { dir: THREE.Vector3; entry: number; reach: number; gone: number } | null = null;

  /**
   * Call on the frame Q goes down, BEFORE player.update(): the kick sets
   * player.cinematic, and the cinematic branch zeroes his velocity on the very
   * next update — read it any later and every kick starts from a standstill.
   */
  protected beginKickRun(victim: Enemy | null): void {
    const p = this.player;
    const dir = p.forwardDir();
    let reach = -1;
    if (victim) {
      const to = victim.position.clone().sub(p.position).setY(0);
      const d = to.length();
      if (d > 0.05) dir.copy(to).multiplyScalar(1 / d);
      reach = Math.max(0, d - 1.05);
    }
    // Only the part of his speed that is going the way he kicks: a strafe
    // doesn't throw him forward, and backpedalling into a kick shouldn't
    // throw him backwards.
    const entry = Math.max(0, p.velocity.x * dir.x + p.velocity.z * dir.z);
    this.kickRun = { dir, entry, reach, gone: 0 };
  }

  /** Carry him along for this frame. Call where the scene steps the kick, before player.update(). */
  protected runKick(kick: DropKickViewmodel, dt: number): void {
    const run = this.kickRun;
    if (!run || !kick.engaged) return;
    let step = kick.travel(run.entry) * dt;
    if (run.reach >= 0 && !kick.pastImpact) {
      // Somebody's in front of him. Go where the momentum takes him, but be
      // at a boot's length by the impact frame however slowly he came in —
      // and never past it, however fast. There is no body collision between
      // Ravi and the enemies, so without that cap a sprint would carry him
      // straight through the man he is trying to kick.
      const want = Math.min(run.reach, Math.max(run.gone + step, run.reach * kick.lunge));
      step = want - run.gone;
    }
    run.gone += step;
    this.player.shove(run.dir.x * step, run.dir.z * step, this.level.colliders);
  }

  protected endKickRun(): void {
    this.kickRun = null;
  }

  /**
   * Both boots into a chest. The three numbers here are the whole trick:
   *
   * - The hit goes on the torso ragdoll body's exact centre, 1.27 above the
   *   feet. That gives applyImpulse a zero lever arm, so the only rotation he
   *   takes is the backward pitch the kick asks for. Aim at the chest SURFACE
   *   instead and the torque off a steeply angled boot cartwheels him.
   * - die() de-rates the vertical part of an impulse to 40%, so a boot meant
   *   to throw him at about 33 degrees has to be aimed at 55.
   * - die()'s own impulse is left at 1.2 — enough that he folds and spins
   *   like a man who has been hit hard, but it is NOT what moves him. It
   *   lands on the torso alone and the joints hand most of it straight to the
   *   other ten bodies. The travel comes from launch() instead, which throws
   *   every part of him at the same speed: about half a second of air, half a
   *   metre up and three metres back before he lands and slides.
   */
  protected dropKickEnemy(enemy: Enemy): void {
    const chest = enemy.position.clone();
    chest.y += 1.27;
    const fwd = this.player.forwardDir();
    const boot = fwd.clone().multiplyScalar(0.547);
    boot.y = 0.837;
    this.killEnemy(enemy, chest, boot, true, false, 'torso', 1.2, { wound: false });
    enemy.launch(new THREE.Vector3(fwd.x * 6.2, 4.6, fwd.z * 6.2));
    this.ctx.audio.kickImpact();
    this.ctx.bus.emit(Events.Sound, { position: enemy.position.clone(), radius: 12, kind: 'impact' });
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

  /**
   * The crushed Deadbull becomes a real object. Aluminium is almost weightless
   * and very springy, so it gets its own contact material — on the world's
   * default (restitution 0.12, tuned for draping ragdolls) an empty can lands
   * like a bag of sand instead of skittering off under a desk.
   */
  private canMat: CANNON.Material | null = null;
  protected dropCan(pose: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    velocity: THREE.Vector3;
  }): void {
    if (!this.canMat) {
      this.canMat = new CANNON.Material('drinkCan');
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(this.canMat, this.world.defaultMaterial, {
          restitution: 0.55,
          friction: 0.18
        })
      );
    }
    const { position, quaternion, velocity } = pose;
    const mesh = DrinkViewmodel.crushedCan();
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);

    const body = new CANNON.Body({
      mass: 0.016,
      shape: new CANNON.Box(new CANNON.Vec3(0.042, 0.03, 0.042)),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      material: this.canMat,
      linearDamping: 0.03,
      angularDamping: 0.12
    });
    body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    const v = velocity.clone().add(this.player.velocity);
    body.velocity.set(v.x, v.y, v.z);
    // A flicked can tumbles hard — it weighs nothing and he put a wrist into it
    body.angularVelocity.set((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 26, (Math.random() - 0.5) * 26);
    // It rings every time it touches something, not once when it lands — an
    // empty skittering across a floor is most of the joke. Gated on how hard
    // the contact was, or a resting can chatters against the carpet forever,
    // and rate-limited because cannon reports a bounce over several steps.
    let lastRing = -1;
    body.addEventListener('collide', (e: { contact: CANNON.ContactEquation }) => {
      const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (speed < 0.8) return;
      const now = this.world.time;
      if (now - lastRing < 0.09) return;
      lastRing = now;
      this.ctx.audio.canClatter(
        Math.hypot(body.position.x - this.player.position.x, body.position.z - this.player.position.z)
      );
    });
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
