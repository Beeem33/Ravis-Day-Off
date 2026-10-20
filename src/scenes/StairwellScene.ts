import * as THREE from 'three';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { StairwellBuilder, type StairwellData, type StairAgent } from '../environment/StairwellBuilder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { FPSPlayer } from '../entities/FPSPlayer';
import { Arsenal, loadoutFor, type Gun } from '../entities/Arsenal';
import { EmoteViewmodel } from '../entities/EmoteViewmodel';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { DropKickViewmodel } from '../entities/DropKickViewmodel';
import { Enemy } from '../entities/Enemy';
import { EnemyAI } from '../entities/EnemyAI';
import { armWithAK } from '../entities/AkModel';
import { FPSHUD } from '../ui/FPSHUD';

/** What it takes to put one of them down — the same as the top floor's. */
const AGENT_HP = 100;
const ARMOURED_HP = 140;
const AK_DAMAGE: Record<string, number> = { torso: 25, arm: 18, leg: 18, head: 100 };
const GUN_SCALE: Record<Gun, number> = { rifle: 1, pistol: 1.2, shotgun: 0.45 };
const ARMOUR_LETS = { torso: 0.6, head: 0.5 };

/**
 * Falls. A jump down a broken flight is nothing; a storey knocks the wind
 * out of him; two storeys — the well, a missed jump in the collapse — is
 * the end of him.
 */
const FALL_SAFE = 3.6;
const FALL_HURT = 5.0;
const FALL_KILL = 6.5;
/** Stood in the fire, a hit point this often. */
const BURN_EVERY = 0.7;
/** How close he has to be, and how near his level, before a landing's agents see him coming. */
const SEE_RANGE = 9;
const SEE_LEVEL = 2.6;

/** One of the agents on the landings. */
interface Agent {
  e: Enemy;
  spec: StairAgent;
  hp: number;
  /** Fighting Ravi, once woken. */
  ai: EnemyAI | null;
  /** Seconds until he does, once something has told him Ravi is here; -1 until then. */
  wake: number;
}

/**
 * StairwellScene — Stairwell B, from the top floor all the way down.
 *
 * Ravi comes through the door off the top floor after the boss, and the way
 * down is the stairs: what is left of them. A flight with a hole in it and a
 * fire across its landing; two storeys that have simply gone, crossed on
 * the wreckage left in the shaft; a beam across the well where the stairs
 * are buried in burning rubble; a slab come down to crawl under; a flight
 * fallen out onto a heap to climb up off. On four of the landings there are
 * agents waiting — a couple at a time, never more than three — and at the
 * bottom, the door out to the car park, where the boss is making for his car.
 *
 * A fall of two storeys kills him; the fire burns. Checkpoints on the way
 * down: a death goes back to the last one reached, not to the top.
 */
export class StairwellScene extends CombatScene<StairwellData> {
  private arsenal!: Arsenal;
  private emote!: EmoteViewmodel;
  private drink!: DrinkViewmodel;
  private dropKick!: DropKickViewmodel;
  private kickVictim: Enemy | null = null;
  private hud!: FPSHUD;

  private agents: Agent[] = [];
  private agentOf = new Map<Enemy, Agent>();
  private pooled = new Set<Enemy>();
  private remaining = 0;

  private t = 0;
  private dead = false;
  private over = false;
  private checkpoint = 0;
  private senseT = 0;
  /** Falling: was he on the ground last frame, and the highest he has been since he left it. */
  private wasGrounded = true;
  private airTop = 0;
  /** In the fire: seconds towards the next burn, and how hard the screen glows with it. */
  private burnT = 0;
  private burning = 0;
  private crackleT = 0;
  private sparkT = 1;
  private rumbleT = 18;
  private flick: number[] = [];
  private leaving = false;
  private leaveT = 0;
  private handedOff = false;

  private ui!: HTMLElement;
  private objective!: HTMLElement;
  private fadeEl!: HTMLElement;
  private burnEl!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private clickHandler = (): void => this.onClick();
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);

  private ray = new THREE.Ray();
  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();
  private static tmpC = new THREE.Vector3();
  private static tmpD = new THREE.Vector3();
  private static tmpN = new THREE.Vector3();

  /** `from`: the checkpoint to start at — 0 the top, where Level 7 left him. */
  constructor(ctx: GameContext, private from = 0) {
    super(ctx);
  }

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x0e0d0c);
    // Smoke hanging in the shaft
    this.scene.fog = new THREE.Fog(0x17130f, 7, 30);

    this.level = new StairwellBuilder().build();
    this.scene.add(this.level.group);
    this.world = this.createPhysicsWorld(this.level.colliders);
    const L = this.level;
    this.checkpoint = Math.min(this.from, L.checkpoints.length - 1);
    const start = L.checkpoints[this.checkpoint];

    this.player = new FPSPlayer(start.pos, start.yaw, input, audio, bus);
    this.ragdollOnDeath(() => (this.arsenal.held.stow < 0.5 ? this.arsenal.active : null));
    this.scene.add(this.player.camera);
    this.airTop = start.pos.y;

    this.emote = new EmoteViewmodel(this.player.camera);
    this.drink = new DrinkViewmodel(this.player.camera);
    this.drink.onEvent = (e, i) => {
      if (e === 'crack') audio.canCrack();
      else if (e === 'gulp') audio.gulp(i);
      else if (e === 'heal') this.player.healFull();
      else if (e === 'crush') audio.canCrush();
      else if (e === 'toss') this.dropCan(this.drink.tossPose());
    };
    this.setupTakedown();
    this.dropKick = new DropKickViewmodel(this.player.camera);
    this.dropKick.onEvent = (e) => {
      if (e === 'launch') {
        audio.kickWhoosh();
      } else if (e === 'impact') {
        const victim = this.kickVictim?.alive ? this.kickVictim : this.kickTarget();
        this.kickVictim = null;
        if (!victim) return;
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

    this.particles = new ParticleManager(this.scene);
    this.flashPool = new MuzzleFlashPool(this.scene, 4);
    Enemy.flashPool = this.flashPool;
    this.decals = new BloodDecalSystem(this.scene);
    this.arsenal = new Arsenal(
      {
        player: this.player,
        audio,
        bus,
        world: this.world,
        particles: this.particles,
        castBullet: (o, d) => this.castBullet(o, d, null),
        addDebris: (m, b) => this.addDebris(m, b),
        dropMagazine: (p) => this.dropMagazine(p)
      },
      loadoutFor('stairwell'),
      'rifle'
    );

    // The ones still there for wherever he starts
    L.agents.forEach((spec, i) => {
      if (this.checkpoint > spec.upTo) return;
      const e = new Enemy(spec.pos, spec.yaw, 70 + i, { name: 'POLICE FORCE AGENT' });
      armWithAK(e);
      if (spec.armour) e.wearArmour();
      if (spec.aim) e.setAiming(true);
      else e.setRestCarry(true, true);
      this.scene.add(e.root);
      for (const p of e.parts) L.shootables.push(p);
      const a: Agent = { e, spec, hp: spec.armour ? ARMOURED_HP : AGENT_HP, ai: null, wake: -1 };
      this.agents.push(a);
      this.agentOf.set(e, a);
    });
    this.remaining = this.agents.length;
    this.flick = L.fireLights.map(() => Math.random());

    this.hud = new FPSHUD(this.ctx.uiRoot, bus, this.remaining, this.player.maxHealth);
    this.hud.show();
    this.hud.setAmmo(...this.arsenal.ammoReadout());
    this.buildUI();

    this.unsubs.push(
      bus.on(Events.Resize, () => {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }),
      bus.on(Events.PlayerDied, () => {
        this.dead = true;
        this.over = true;
      })
    );
    document.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);
    input.requestPointerLock();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    for (const a of this.agents) a.ai?.dispose();
    document.removeEventListener('click', this.clickHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.hud.destroy();
    this.flashPool.dispose();
    this.ui.remove();
    Enemy.flashPool = null;
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="sw-burn" style="position:absolute;inset:0;pointer-events:none;opacity:0;
        background:radial-gradient(ellipse at center, rgba(255,120,30,0) 45%, rgba(255,96,20,0.55) 100%)"></div>
      <div class="intro-objective"></div>
      <div class="intro-fade" style="opacity:1"></div>
    `;
    this.ctx.uiRoot.appendChild(el);
    this.ui = el;
    this.burnEl = el.querySelector('.sw-burn')!;
    this.objective = el.querySelector('.intro-objective')!;
    this.fadeEl = el.querySelector('.intro-fade')!;
  }

  private setObjective(text: string): void {
    if (this.objective.textContent === text) return;
    this.objective.textContent = text;
    this.objective.classList.remove('show');
    void this.objective.offsetWidth;
    if (text) this.objective.classList.add('show');
  }

  // ---------------------------------------------------------------- update

  private get playable(): boolean {
    return this.player.alive && !this.over && !this.leaving;
  }

  update(dt: number, _time: number): void {
    const { input } = this.ctx;
    this.t += dt;
    if (this.playable && !input.pointerLocked && input.mouseHeld) input.requestPointerLock();

    // ---- The knife on F, next to one of them

    const tdTarget = this.stepTakedown(dt, this.agents.filter((a) => a.e.alive).map((a) => a.e), this.player.alive && !this.arsenal.reloading && !this.drink.engaged && !this.dropKick.engaged, (on) => this.hud.setTakedownHint(on));

    void tdTarget;


    // ---- Deadbull (G) and the drop kick (Q)
    if (input.wasPressed('KeyG') && !this.inTakedown && this.playable && input.pointerLocked && !this.arsenal.reloading && !this.dropKick.engaged) {
      this.drink.start();
    }
    if (!this.player.alive) this.drink.abort();
    if (input.wasPressed('KeyQ') && !this.inTakedown && this.playable && input.pointerLocked && !this.arsenal.reloading && !this.drink.engaged && this.player.grounded) {
      if (this.dropKick.start()) {
        this.emote.cancel();
        this.player.cinematic = true;
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
    const busy = this.drink.engaged || this.dropKick.engaged || this.inTakedown;
    this.arsenal.preUpdate(dt, input, { canSwitch: this.playable && input.pointerLocked, busy });

    const aiming =
      !busy && input.rightHeld && input.pointerLocked && this.playable && !this.arsenal.reloading && !this.arsenal.switching;
    this.player.aiming = aiming;
    this.player.update(dt, this.level.colliders);
    this.dropKick.applyCamera(this.player);
    this.holdTakedown();

    this.updateFalls();
    this.updateFire(dt);
    this.updateProgress(dt);
    this.updateAgents(dt);
    this.updateCast(dt);

    // ---- The guns
    if (input.wasPressed('KeyT') && this.playable && input.pointerLocked && !this.arsenal.reloading) this.emote.toggle();
    if (this.arsenal.reloading || !this.player.alive) this.emote.cancel();
    this.arsenal.hideSupportHand = this.emote.engaged;
    this.arsenal.updateViewmodels(dt, aiming);
    this.emote.update(dt, this.player);
    this.drink.update(dt, this.player);
    this.hud.setCinematic(this.takedownCinema > 0.5);
    const targetFov = -10 * this.takedownCinema + 74 - this.arsenal.zoomFov;
    if (Math.abs(this.player.camera.fov - targetFov) > 0.01) {
      this.player.camera.fov = targetFov;
      this.player.camera.updateProjectionMatrix();
    }
    this.hud.setAiming(this.arsenal.aimBlend > 0.5);
    const canFire = this.playable && input.pointerLocked && !busy;
    if (this.arsenal.updateFire(dt, input, canFire, (r, m, re) => this.hud.setAmmo(r, m, re))) this.heardShot();

    this.updateAmbience(dt);
    this.hud.setHealth(this.player.health, this.player.regenProgress);
    this.updateDebris(dt);
    this.decals.update(dt);
    this.particles.update(dt);
    this.flashPool.update(dt);
    this.world.step(1 / 60, dt, 3);
    input.endFrame();
  }

  private updateCast(dt: number): void {
    for (const a of this.agents) {
      const e = a.e;
      e.update(dt);
      if (!e.alive && e.settled && !this.pooled.has(e)) {
        this.pooled.add(e);
        this.poolUnder(e);
        for (const p of e.parts) {
          const k = this.level.shootables.indexOf(p);
          if (k >= 0) this.level.shootables.splice(k, 1);
        }
      }
    }
  }

  // ----------------------------------------------------------- the way down

  /** A long enough drop hurts when he lands; a long one kills. */
  private updateFalls(): void {
    const p = this.player;
    if (!p.alive || p.cinematic) {
      this.wasGrounded = true;
      this.airTop = p.position.y;
      return;
    }
    if (!p.grounded) {
      this.airTop = this.wasGrounded ? p.position.y : Math.max(this.airTop, p.position.y);
    } else if (!this.wasGrounded) {
      const drop = this.airTop - p.position.y;
      if (drop > FALL_KILL) {
        this.ctx.audio.bodyThud(0);
        p.kill('THE FALL');
      } else if (drop > FALL_HURT) {
        this.ctx.audio.bodyThud(0);
        this.hurtRavi(2, 'THE FALL');
      } else if (drop > FALL_SAFE) {
        this.ctx.audio.bodyThud(0);
        this.hurtRavi(1, 'THE FALL');
      }
    }
    this.wasGrounded = p.grounded;
  }

  /** In the fire: it burns, a hit point at a time, and the screen glows with it. */
  private updateFire(dt: number): void {
    const p = this.player;
    const feet = StairwellScene.tmpA.set(p.position.x, p.position.y + 0.1, p.position.z);
    let inFire = false;
    if (p.alive) {
      for (const f of this.level.fires) {
        if (f.zone && f.zone.containsPoint(feet)) {
          inFire = true;
          break;
        }
      }
    }
    if (inFire) {
      if (this.burning <= 0.01) this.burnT = BURN_EVERY - 0.3;
      this.burnT += dt;
      if (this.burnT >= BURN_EVERY) {
        this.burnT -= BURN_EVERY;
        this.hurtRavi(1, 'THE FIRE');
      }
    }
    this.burning += ((inFire ? 1 : 0) - this.burning) * Math.min(1, dt * (inFire ? 8 : 2.5));
    const glow = this.burning * (0.75 + 0.25 * Math.sin(this.t * 17));
    this.burnEl.style.opacity = glow > 0.01 ? glow.toFixed(3) : '0';
  }

  /** Damage that isn't a round: the fire, a fall. */
  private hurtRavi(n: number, by: string): void {
    const p = this.player;
    if (!p.alive) return;
    const per = p.damagePerHit;
    p.damagePerHit = n;
    p.hit(by);
    p.damagePerHit = per;
  }

  /** The objective, the checkpoints passed on the way down, and the door at the bottom. */
  private updateProgress(dt: number): void {
    const L = this.level;
    const p = this.player.position;
    if (this.t < 1.4) this.fadeEl.style.opacity = String(Math.max(0, 1 - this.t / 1.2));
    else if (!this.leaving && this.fadeEl.style.opacity !== '0') this.fadeEl.style.opacity = '0';
    if (this.t >= 1.2 && this.t - dt < 1.2) this.setObjective('GET DOWN TO THE CAR PARK');

    const feet = StairwellScene.tmpB.set(p.x, p.y + 0.2, p.z);
    if (this.player.alive) {
      for (let k = this.checkpoint + 1; k < L.checkpoints.length; k++) {
        if (L.checkpoints[k].reach.containsPoint(feet)) {
          this.checkpoint = k;
          this.ctx.audio.uiBeep(true);
          this.setObjective('CHECKPOINT');
        }
      }
      if (!this.leaving && L.exitTrigger.containsPoint(feet)) this.leave();
    }
    if (this.leaving) {
      this.leaveT += dt;
      this.fadeEl.style.opacity = String(Math.min(1, this.leaveT / 0.8));
      if (this.leaveT > 1.4 && !this.handedOff) {
        this.handedOff = true;
        this.ctx.bus.emit(Events.StairwellComplete);
      }
    }
  }

  private leave(): void {
    this.leaving = true;
    this.leaveT = 0;
    this.setObjective('');
    this.ctx.audio.doorOpen();
    this.ctx.audio.stairDoorBang();
    this.ctx.input.exitPointerLock();
  }

  // ---------------------------------------------------------------- agents

  private updateAgents(dt: number): void {
    this.senseT -= dt;
    const sense = this.senseT <= 0;
    if (sense) this.senseT = 0.15;
    for (const a of this.agents) {
      const e = a.e;
      if (!e.alive) continue;
      if (a.ai) {
        a.ai.update(dt);
        // Held to his landing: a step to the side there is a step into the well
        const b = a.spec.area;
        e.position.x = THREE.MathUtils.clamp(e.position.x, b.min.x, b.max.x);
        e.position.z = THREE.MathUtils.clamp(e.position.z, b.min.z, b.max.z);
        e.position.y = a.spec.pos.y;
        continue;
      }
      if (a.wake > 0) {
        a.wake -= dt;
        if (a.wake <= 0) this.turnOnRavi(a);
      } else if (sense && a.wake < 0) {
        this.senseRavi(a);
      }
    }
  }

  /** Close enough, near his level, in sight: he has seen Ravi. */
  private senseRavi(a: Agent): void {
    if (!this.player.alive) return;
    const e = a.e;
    const p = this.player.position;
    const d = Math.hypot(p.x - e.position.x, p.z - e.position.z);
    const dy = Math.abs(p.y - e.position.y);
    if (d < 3 && dy < 1.6) {
      this.wake(a, 0.15);
      return;
    }
    if (d < SEE_RANGE && dy < SEE_LEVEL) {
      const eye = e.eyePosition(StairwellScene.tmpB);
      if (this.clearLine(eye, this.player.eyePosition(StairwellScene.tmpC))) this.wake(a, 0.35 + Math.random() * 0.5);
    }
  }

  private wake(a: Agent, delay: number): void {
    if (a.ai || a.wake >= 0 || !a.e.alive) return;
    a.wake = delay;
    // The rest of his landing with him, a moment after
    for (const o of this.agents) {
      if (o !== a && o.spec.group === a.spec.group && !o.ai && o.wake < 0 && o.e.alive) o.wake = delay + 0.4 + Math.random() * 0.6;
    }
  }

  private turnOnRavi(a: Agent): void {
    a.wake = 0;
    const e = a.e;
    e.setRestCarry(false);
    if (!a.ai) {
      a.ai = new EnemyAI(e, {
        player: this.player,
        waypoints: this.level.waypoints,
        occluders: this.level.occluders,
        colliders: this.level.colliders,
        bus: this.ctx.bus,
        audio: this.ctx.audio,
        enemyFire: (x) => this.enemyFire(x)
      });
      a.ai.holdGround();
      a.ai.setPatrolZone(a.spec.pos, 2.6);
    }
    a.ai.alert(this.player.position);
  }

  /** A gun going off in the shaft: anyone near enough hears it. */
  private heardShot(): void {
    const p = this.player.position;
    for (const a of this.agents) {
      if (!a.e.alive || a.ai || a.wake >= 0) continue;
      if (a.e.position.distanceTo(p) < 11) this.wake(a, 0.3 + Math.random() * 0.5);
    }
  }

  /** Who the boot would land on. */
  private kickTarget(): Enemy | null {
    if (!this.playable) return null;
    const list: Enemy[] = [];
    for (const a of this.agents) if (a.e.alive) list.push(a.e);
    return this.kickTargetFrom(list);
  }

  // ------------------------------------------------------------ their rounds

  /**
   * An agent fires at Ravi: the usual roll on distance and how fast he is
   * moving — but the stairs are cover. With a flight, a slab or a heap of
   * rubble between the rifle and his chest, most of it goes into that.
   */
  protected enemyFire(enemy: Enemy): void {
    const { audio, bus } = this.ctx;
    const player = this.player;
    const dist = player.position.distanceTo(enemy.position);
    audio.enemyGunshot(dist);
    enemy.flashMuzzle();
    bus.emit(Events.Sound, { position: enemy.position.clone(), radius: 25, kind: 'gunshot' });
    const muzzle = enemy.muzzleWorld();
    const speed = Math.min(1, player.currentSpeed / 6.6);
    let chance = 0.68 - dist * 0.03 - speed * 0.28 - (player.crouching ? 0.1 : 0);
    const chest = player.eyePosition();
    chest.y -= player.crouching ? 0.3 : 0.45;
    const to = chest.clone().sub(muzzle);
    const len = to.length();
    to.divideScalar(len);
    const cover = this.rayBoxes(muzzle, to, len - 0.35);
    const coverN = StairwellScene.tmpN.clone();
    if (cover) chance *= player.crouching ? 0.12 : 0.35;
    chance = THREE.MathUtils.clamp(chance, 0.04, 0.9);
    if (Math.random() < chance && player.alive) {
      const target = player.eyePosition().add(
        new THREE.Vector3((Math.random() - 0.5) * 0.2, -0.2 - Math.random() * 0.4, (Math.random() - 0.5) * 0.2)
      );
      this.particles.tracer(muzzle, target, 0xffe0b0);
      player.hit(enemy.name, muzzle);
      return;
    }
    if (cover) {
      this.particles.tracer(muzzle, cover, 0xffe0b0);
      this.particles.concreteChips(cover, coverN, 0x9a958c);
      const near = cover.distanceTo(player.position);
      if (near < 3 && player.alive) audio.ricochet(near);
      return;
    }
    const target = player.eyePosition();
    const off = 0.35 + Math.random() * 0.7;
    target.add(new THREE.Vector3((Math.random() - 0.5) * off * 2, (Math.random() - 0.5) * off, (Math.random() - 0.5) * off * 2));
    const dir = target.sub(muzzle).normalize();
    const end = this.castBullet(muzzle, dir, enemy);
    this.particles.tracer(muzzle, end, 0xffe0b0);
    if (player.alive) audio.bulletWhiz();
  }

  /** Where a ray first meets the level's boxes within `far`; the face's normal is left in tmpN. */
  private rayBoxes(from: THREE.Vector3, dir: THREE.Vector3, far: number): THREE.Vector3 | null {
    this.ray.set(from, dir);
    let best = far;
    let box: THREE.Box3 | null = null;
    const p = StairwellScene.tmpC;
    for (const c of this.level.colliders) {
      if (c.disabled) continue;
      if (!this.ray.intersectBox(c.box, p)) continue;
      const d = p.distanceTo(from);
      if (d > 0.05 && d < best) {
        best = d;
        box = c.box;
      }
    }
    if (!box) return null;
    const at = from.clone().addScaledVector(dir, best);
    const faces: [number, number, number, number][] = [
      [Math.abs(at.x - box.min.x), -1, 0, 0], [Math.abs(at.x - box.max.x), 1, 0, 0],
      [Math.abs(at.y - box.min.y), 0, -1, 0], [Math.abs(at.y - box.max.y), 0, 1, 0],
      [Math.abs(at.z - box.min.z), 0, 0, -1], [Math.abs(at.z - box.max.z), 0, 0, 1]
    ];
    let f = faces[0];
    for (const g of faces) if (g[0] < f[0]) f = g;
    StairwellScene.tmpN.set(f[1], f[2], f[3]);
    at.addScaledVector(StairwellScene.tmpN, 0.004);
    return at;
  }

  /** Nothing in the way between two points, as far as the level's boxes go? */
  private clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dist = a.distanceTo(b);
    this.ray.set(a, StairwellScene.tmpD.copy(b).sub(a).divideScalar(dist || 1));
    const p = StairwellScene.tmpN;
    for (const c of this.level.colliders) {
      if (c.disabled) continue;
      if (c.box.containsPoint(a) || c.box.containsPoint(b)) continue;
      if (this.ray.intersectBox(c.box, p) && p.distanceTo(a) < dist - 0.1) return false;
    }
    return true;
  }

  // -------------------------------------------------------------- his rounds

  /** A round into one of them: out of his hit points, less through a plate or a helmet; the last of them drops him. */
  protected absorbHit(enemy: Enemy, point: THREE.Vector3, dir: THREE.Vector3, shooter: Enemy | null, part: string): boolean {
    const a = this.agentOf.get(enemy);
    if (!a) return false;
    const byRavi = shooter === null;
    const head = part === 'head';
    const plated = a.spec.armour && (head || part === 'torso');
    let dmg = (AK_DAMAGE[part] ?? AK_DAMAGE.torso) * (byRavi ? GUN_SCALE[this.arsenal.firing] : 1);
    if (plated) dmg *= head ? ARMOUR_LETS.head : ARMOUR_LETS.torso;
    a.hp -= dmg;
    if (a.hp <= 0) return false;
    const { audio, bus } = this.ctx;
    const d = point.distanceTo(this.player.position);
    if (plated) {
      this.particles.concreteChips(point, StairwellScene.tmpB.copy(dir).negate(), 0x6e747c);
      this.particles.electricSparks(point, 3);
      audio.armourHit(d);
    } else {
      this.particles.bloodSpray(point, dir, false, -1);
      if (byRavi) audio.fleshHit();
    }
    if (byRavi) {
      bus.emit(Events.HitMarker, { lethal: false });
      if (a.ai) a.ai.alert(this.player.position);
      else this.turnOnRavi(a);
    }
    enemy.flinch(1);
    return true;
  }

  protected killEnemy(
    enemy: Enemy,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    byPlayer: boolean,
    headshot: boolean,
    hitPart?: string,
    impulseScale = 1,
    opts: { wound?: boolean; keepWeapon?: boolean } = {}
  ): void {
    if (!enemy.alive) return;
    enemy.die(point, dir, this.world, hitPart === 'head' ? 'head' : 'torso', impulseScale, opts);
    const a = this.agentOf.get(enemy);
    if (a) {
      a.ai?.dispose();
      a.ai = null;
      this.remaining = Math.max(0, this.remaining - 1);
      // The rest of his landing know about it
      for (const o of this.agents) if (o !== a && o.spec.group === a.spec.group) this.wake(o, 0.2);
    }
    if (byPlayer) this.ctx.bus.emit(Events.HitMarker, { lethal: true });
    this.ctx.bus.emit(Events.EnemyKilled, { name: enemy.name, remaining: this.remaining, headshot, by: byPlayer ? 'RAVI' : 'FRIENDLY FIRE' });
  }

  // ---------------------------------------------------------------- the shaft

  /** The fires burning and throwing their light about, cut cables sparking, the building groaning. */
  private updateAmbience(dt: number): void {
    const L = this.level;
    const p = this.player.position;
    let nearest = Infinity;
    for (const f of L.fires) {
      const d = f.pos.distanceTo(p);
      if (d < nearest) nearest = d;
      if (d < 26) this.particles.fire(f.pos, f.size, 1);
    }
    // Fire light: never steady
    L.fireLights.forEach((l, i) => {
      this.flick[i] += (Math.random() - this.flick[i]) * Math.min(1, dt * 9);
      l.intensity = 7 * (0.72 + 0.4 * this.flick[i]);
    });
    this.crackleT -= dt;
    if (this.crackleT <= 0) {
      this.crackleT = 0.18 + Math.random() * 0.35;
      if (nearest < 14) this.ctx.audio.fireCrackle(nearest);
    }
    this.sparkT -= dt;
    if (this.sparkT <= 0 && L.sparks.length) {
      this.sparkT = 1 + Math.random() * 2.5;
      const at = L.sparks[Math.floor(Math.random() * L.sparks.length)];
      if (at.distanceTo(p) < 20) {
        this.particles.electricSparks(at, 5 + Math.floor(Math.random() * 7));
        this.ctx.audio.electricCrackle(at.distanceTo(p));
      }
    }
    // Now and then something gives, somewhere in the building
    this.rumbleT -= dt;
    if (this.rumbleT <= 0) {
      this.rumbleT = 16 + Math.random() * 18;
      this.ctx.audio.stomp(45 + Math.random() * 20);
    }
  }

  // ---------------------------------------------------------------- input

  /** A click is the gun's — except once he is dead, when it is the restart, from the last checkpoint. */
  private onClick(): void {
    if (this.dead) this.restart();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.dead) return;
    if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
    else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') this.restart();
  }

  private restart(): void {
    this.ctx.bus.emit(Events.RestartStairwell, { checkpoint: this.checkpoint });
  }

  // ---------------------------------------------------------------- render

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}
