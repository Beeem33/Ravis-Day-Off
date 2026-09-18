import * as THREE from 'three';
import type { GameContext } from '../main';
import { Events } from '../core/EventBus';
import { Level4Builder, Level4Data, CEILING_H } from '../environment/Level4Builder';
import { CombatScene } from './CombatScene';
import { BloodDecalSystem } from '../fx/BloodDecalSystem';
import { ParticleManager } from '../fx/ParticleManager';
import { MuzzleFlashPool } from '../fx/MuzzleFlashPool';
import { GunBeamPool } from '../fx/GunBeam';
import { FPSPlayer } from '../entities/FPSPlayer';
import { WeaponViewmodel } from '../entities/WeaponViewmodel';
import { EmoteViewmodel } from '../entities/EmoteViewmodel';
import { ShotgunViewmodel } from '../entities/ShotgunViewmodel';
import { DrinkViewmodel } from '../entities/DrinkViewmodel';
import { DropKickViewmodel } from '../entities/DropKickViewmodel';
import { Enemy } from '../entities/Enemy';
import { EnemyAI } from '../entities/EnemyAI';
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
  /** Middle-finger emote on T; the left hand goes back to work on reload. */
  private emote!: EmoteViewmodel;
  private shotgun!: ShotgunViewmodel;
  /** Deadbull on G: three seconds with no gun, and he's back on full health. */
  private drink!: DrinkViewmodel;
  /** Drop kick on Q. */
  private dropKick!: DropKickViewmodel;
  /** Who the kick was aimed at when Q went down. */
  private kickVictim: Enemy | null = null;
  private beams!: GunBeamPool;
  private agents: Enemy[] = [];
  private corpses: Enemy[] = [];
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
  /** Full brightness of every fixture, kept so the flicker can put them back. */
  private lightBase: number[] = [];
  /** How far through the lights-out sequence, in seconds since he stood up. */
  private powerT = -1;
  private flickerStep = 0;
  private monologueDone = false;
  private doorState: 'shut' | 'opening' | 'open' = 'shut';
  private doorAngle = 0;
  private doorAt = new THREE.Vector3();
  /** Ravi's own torch. Off at the start; F works it. */
  private torch!: THREE.SpotLight;
  private torchOn = false;
  private leaveWalk = -1;
  private leaveFrom = new THREE.Vector3();

  private ui!: HTMLElement;
  private objective!: HTMLElement;
  private letterbox!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private over = false;
  /** Every agent down: the back door's panel has gone green. */
  private cleared = false;
  private leaving = false;
  private handedOff = false;
  private fade = 0;
  private fadeEl: HTMLElement | null = null;
  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();
  private clickHandler = (): void => this.onClick();

  /**
   * Retrying after a death skips the approach: Sanjay has already handed the
   * shotgun over and gone, the power is already out, and Ravi starts in the
   * corridor a few metres short of the door. Dying should cost you the floor,
   * not the cutscene.
   */
  constructor(ctx: GameContext, private skipIntro = false) {
    super(ctx);
  }

  /** Where a retry drops him: in the approach corridor, facing the door. */
  private static readonly RETRY_SPAWN = new THREE.Vector3(-28, 0, 0);

  // -------------------------------------------------------------- lifecycle

  enter(): void {
    const { bus, input, audio } = this.ctx;
    this.scene.background = new THREE.Color(0x05070a);
    this.scene.fog = new THREE.Fog(0x05070a, 14, 46);

    this.level = new Level4Builder().build();
    this.scene.add(this.level.group);
    this.world = this.createPhysicsWorld(this.level.colliders);

    this.player = new FPSPlayer(this.level.playerSpawn, this.level.playerSpawnYaw, input, audio, bus);
    // One round is the whole bar here. In the dark, against twelve of them,
    // being seen at all should be the mistake — not the start of a trade.
    this.player.damagePerHit = this.player.maxHealth;
    this.scene.add(this.player.camera);

    this.weapon = new WeaponViewmodel(this.player.camera);
    this.weapon.onReloadEvent = (e) => {
      if (e === 'magOut') audio.magOut();
      else if (e === 'magDrop') this.dropMagazine(this.weapon.ejectedMagPose());
      else if (e === 'magIn') audio.magIn();
      else if (e === 'rack') audio.slideRack();
      else if (e === 'done') this.ammo = MAG_SIZE;
    };
    this.shotgun = new ShotgunViewmodel(this.player.camera);
    this.shotgun.onPumpEvent = (e) => {
      if (e === 'back') audio.pumpBack();
      else if (e === 'forward') audio.pumpForward();
    };
    this.shotgun.onReloadEvent = (e) => {
      if (e === 'shellIn') {
        audio.shellIn();
        this.shells = Math.min(TUBE_SIZE, this.shells + 1);
      }
    };
    // Middle-finger emote (T toggles it; reloading puts the hand back to work)
    this.emote = new EmoteViewmodel(this.player.camera);
    this.shotgun.stow = 1; // stowed, and not even carried yet
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
        // Going over backwards on a hard floor in the dark is a gift to
        // anyone in the next room
        bus.emit(Events.Sound, { position: this.player.position.clone(), radius: 9, kind: 'footstep' });
      } else if (e === 'up') {
        audio.scuff();
      } else if (e === 'done') {
        this.player.cinematic = false;
        this.endKickRun();
      }
    };

    // Ravi's torch. Deliberately modest: enough to pick a doorway out of the
    // black a few metres ahead, not enough to light the room and undo the
    // point of the floor. Created switched on-but-zero and driven by
    // intensity, never visibility — the count of visible lights is baked into
    // every material's shader, and toggling it would recompile the level on
    // the exact frame you wanted to see something.
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
    // Sat squarely on the white shirt rather than half over the waistband,
    // and bright enough to read from across the corridor.
    const stainMat = new THREE.MeshStandardMaterial({ color: 0xb01a12, roughness: 0.45 });
    const stain = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.012), stainMat);
    stain.position.set(-0.02, -0.06, -0.141);
    this.wounded.addChestPatch(stain);
    // A couple of runs down from it, so it reads as soaked through
    for (const [sx, sy, sw, sh] of [[-0.09, -0.19, 0.07, 0.13], [0.07, -0.17, 0.06, 0.1]] as const) {
      const run = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 0.012), stainMat);
      run.position.set(sx, sy, -0.14);
      this.wounded.addChestPatch(run);
    }

    // The gun, across his lap, until he passes it up
    this.propGun = this.shotgunProp();
    this.propGun.position.copy(this.level.woundedSpot).add(new THREE.Vector3(0.12, 0.28, 0.5));
    this.propGun.rotation.set(0, Math.PI / 2 + 0.25, 0.12);
    this.scene.add(this.propGun);

    // ---- The sweep team. Weapons already up: they came in expecting this.
    // The pool casts through this to work out where each beam stops.
    this.beams = new GunBeamPool(this.scene, this.level.enemySpawns.length, (o, dir, far) => {
      this.raycaster.set(o, dir);
      this.raycaster.far = far;
      const h = this.raycaster.intersectObjects(this.level.occluders, false);
      let dist = h.length ? h[0].distance : Infinity;
      let n = h.length && h[0].normal
        ? h[0].normal.clone().transformDirection(h[0].object.matrixWorld)
        : null;
      // The floor and ceiling slabs are not occluder meshes, so clamp to them
      // by hand. The beams are carried a touch low, which means one aimed down
      // a long corridor reaches the floor before it reaches anything solid —
      // and without this it kept going and slid out underneath it.
      const plane = dir.y < -1e-4 ? 0 : dir.y > 1e-4 ? CEILING_H : null;
      if (plane !== null) {
        const t = (plane - o.y) / dir.y;
        if (t > 0 && t < dist) {
          dist = t;
          n = new THREE.Vector3(0, dir.y < 0 ? 1 : -1, 0);
        }
      }
      if (dist > far) return null;
      return { dist, normal: n ?? new THREE.Vector3(0, 1, 0) };
    });
    this.level.enemySpawns.forEach((sp, i) => {
      const e = new Enemy(sp.pos, sp.yaw, i + 11, { name: `POLICE FORCE AGENT ${i + 1}` });
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
      // Hold the room they were posted to. Left to themselves they pick every
      // destination at random from the whole floor, and that drifts the lot of
      // them out of the rooms and into the middle corridors within a minute.
      this.agentAI[i].setPatrolZone(sp.pos, 6.5);
    });
    this.spawnCorpses();
    this.remaining = this.agents.length;
    this.lightBase = this.level.lights.map((l) => l.intensity);
    this.level.mazeDoorCollider.box.getCenter(this.doorAt);
    this.doorAt.y = 0;

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
    if (this.skipIntro) this.beginRetry();
  }

  /**
   * Fast-forward past the approach for a retry: Sanjay is gone, the shotgun
   * is already in hand, the lights are already out, and Ravi is stood in the
   * corridor short of the door with control.
   */
  private beginRetry(): void {
    // A can or a kick still in the air belongs to the run that just ended
    this.drink.abort();
    this.endKick();

    // Sanjay left after the handover, and took his part of the scene with him
    this.wounded.root.visible = false;
    const gone = new Set<THREE.Object3D>(this.wounded.parts);
    this.level.shootables = this.level.shootables.filter((p) => !gone.has(p));
    this.propGun.visible = false;
    this.leaveWalk = -1;

    // The shotgun is his now
    this.hasShotgun = true;
    this.wanted = 'shotgun';
    this.active = 'shotgun';
    this.weapon.stow = 1;
    this.shotgun.stow = 0;
    this.hud.setAmmo(this.shells, TUBE_SIZE, false);

    // The board already dropped: skip the flicker beat straight to the dark
    this.flickerStep = Level4Scene.FLICKER.length;
    this.setLights(false);
    this.cutPower();
    this.powerT = -1; // the lights-out beat is done; don't run it again
    this.monologueDone = true;

    // Back in the corridor, facing the door, with control
    this.player.position.copy(Level4Scene.RETRY_SPAWN);
    this.player.velocity.set(0, 0, 0);
    this.player.yaw = this.level.playerSpawnYaw;
    this.player.pitch = 0;
    this.handOver();
  }

  exit(): void {
    for (const u of this.unsubs) u();
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('click', this.clickHandler);
    this.hud.destroy();
    this.dialogue.destroy();
    for (const ai of this.agentAI) ai.dispose();
    this.beams.dispose();
    this.flashPool.dispose();
    this.ui.remove();
    this.fadeEl?.remove();
    Enemy.flashPool = null;
  }

  private buildUI(): void {
    const el = document.createElement('div');
    el.id = 'intro-ui';
    el.innerHTML = `
      <div class="intro-letterbox"><span class="lb-top"></span><span class="lb-bot"></span></div>
      <div class="intro-objective"></div>
      <div class="torch-hint" style="display:none">[ F ] FLASHLIGHT</div>
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
          text: 'If the police force gets their hands on that, then even if we make it out, we will never be free. You need to find him.',
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
    // On his feet: lights out and control back. He walks the rest of the way
    // on his own while the player is free to go — waiting out ten metres of
    // someone else's stroll is not a cutscene, it is a queue.
    if (this.powerT < 0) this.powerT = 0;
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
    if (left <= 0.5) this.wounded.root.visible = false;
  }

  /**
   * The tubes going out is not one event. They stutter first — a few strikes
   * and drop-outs with the buzz that goes with them — and only then does the
   * board let go. Timed from the moment he gets to his feet.
   */
  private static FLICKER: { at: number; on: boolean }[] = [
    { at: 0.2, on: false },
    { at: 0.34, on: true },
    { at: 0.66, on: false },
    { at: 0.78, on: true },
    { at: 1.12, on: false },
    { at: 1.2, on: true },
    { at: 1.44, on: false },
    { at: 1.58, on: true },
    { at: 1.72, on: false },
    { at: 1.8, on: true }
  ];

  /**
   * The way through stays shut until he walks up to it, and then swings.
   *
   * It used to be deleted outright the moment the cutscene ended, which meant
   * the level you were about to be told to be careful in was already standing
   * open behind the man telling you.
   */
  private updateMazeDoor(dt: number): void {
    if (this.doorState === 'shut') {
      if (this.phase !== 'play') return;
      if (this.player.position.distanceTo(this.doorAt) > 2.1) return;
      this.doorState = 'opening';
      this.level.mazeDoorCollider.disabled = true;
      this.ctx.audio.doorOpen();
      return;
    }
    if (this.doorState !== 'opening') return;
    this.doorAngle = Math.min(1.95, this.doorAngle + dt * 2.6);
    this.level.mazeDoorPivot.rotation.y = -this.doorAngle;
    if (this.doorAngle >= 1.95) this.doorState = 'open';
  }

  /** Put every ceiling fixture back to full, or take it to nothing. */
  private setLights(on: boolean): void {
    this.level.lights.forEach((l, i) => {
      l.intensity = on ? this.lightBase[i] : 0;
    });
    for (const m of this.level.lampMats) m.emissiveIntensity = on ? 1.4 : 0;
  }

  /**
   * Runs the lights-out beat: stutter, then the board drops, then Ravi says
   * the quiet part out loud and control comes back.
   */
  private updatePower(dt: number): void {
    if (this.powerT < 0) return;
    const was = this.powerT;
    this.powerT += dt;

    while (
      this.flickerStep < Level4Scene.FLICKER.length &&
      this.powerT >= Level4Scene.FLICKER[this.flickerStep].at
    ) {
      const step = Level4Scene.FLICKER[this.flickerStep++];
      this.setLights(step.on);
      this.ctx.audio.fluorescentBuzz(step.on ? 0.26 : 0.14, step.on ? 0.42 : 0.24);
    }

    const OUT = 2.05;
    if (was < OUT && this.powerT >= OUT) this.cutPower();

    const SPEAK = OUT + 1.5;
    if (was < SPEAK && this.powerT >= SPEAK) {
      this.dialogue.play(
        [
          {
            speaker: 'RAVI',
            text: 'The ones back here have probably got shotguns too. One shot and I am done. Cannot let that happen.',
            pitch: 1.0
          }
        ],
        () => {
          this.monologueDone = true;
          this.handOver();
        }
      );
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
    this.scene.traverse((o) => {
      if (o.type === 'AmbientLight') (o as THREE.AmbientLight).intensity = 0.12;
    });
    // And now the torch is worth knowing about
    const th = this.ui.querySelector<HTMLElement>('.torch-hint');
    if (th) th.style.display = 'block';
    // Fog from four metres was quietly eating the level: every weapon light
    // more than about six metres off faded to nothing, which is why the beams
    // read as bright up close and absent at any useful range. The dark here
    // should come from there being no light, not from a grey wash.
    this.scene.fog = new THREE.Fog(0x020305, 16, 70);
    this.ctx.audio.powerDown();
  }

  private handOver(): void {
    if (this.phase === 'play') return;
    this.phase = 'play';
    this.player.cinematic = false;
    this.letterbox.classList.add('open');
    this.setObjective('FIND THE BOSS');
    this.ctx.input.requestPointerLock();
  }

  // ---------------------------------------------------------------- input

  private onClick(): void {
    if (this.dialogue.isActive) {
      this.dialogue.advance();
      return;
    }
    if (this.phase === 'dead') this.ctx.bus.emit(Events.RestartLevel4);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.phase === 'dead') {
      if (e.code === 'Escape') this.ctx.bus.emit(Events.ReturnToMenu);
      else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR') {
        this.ctx.bus.emit(Events.RestartLevel4);
      }
      return;
    }
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
    // Anything where the scene, and not Ravi, is driving: the hand-over, the
    // dialogue, the walk out through the back door, or being dead. Neither
    // move starts in one of those, and one already running ends.
    const scripted = !playable || this.dialogue.isActive || this.over || this.leaving;

    // ---- Deadbull on G. Not a cutscene: he keeps his feet and the mouse the
    // whole time, and the price of a full heal is three seconds with the gun
    // out of frame.
    if (
      input.wasPressed('KeyG') &&
      this.player.alive &&
      input.pointerLocked &&
      !scripted &&
      !held.reloading &&
      !this.dropKick.engaged
    ) {
      // The finger stays up if it was up: that is the left hand and this is
      // the right, and with the gun stowed there is nothing for it to do.
      this.drink.start();
    }
    if (!this.player.alive || scripted) this.drink.abort();

    // ---- Drop kick on Q. It plays whether or not anyone is in front of him:
    // a move that silently does nothing when you misjudge the range just
    // reads as a broken button.
    if (
      input.wasPressed('KeyQ') &&
      this.player.alive &&
      input.pointerLocked &&
      !scripted &&
      !held.reloading &&
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
    if (this.dropKick.engaged && (!this.player.alive || scripted)) this.endKick();
    this.runKick(this.dropKick, dt);
    this.dropKick.update(dt);
    // Both hands are busy — or holding a drink — so nothing else can happen
    const busy = this.drink.engaged || this.dropKick.engaged;

    const aiming = playable && input.rightHeld && input.pointerLocked && this.player.alive && !held.reloading && !busy;
    this.player.aiming = aiming;
    this.player.update(dt, this.level.colliders);
    // Layered on after player.update so the leap and the landing ride on top
    // of the ordinary eye position instead of being overwritten by it
    this.dropKick.applyCamera(this.player);

    // Walking up on him starts the scene — but not mid-move: crossing the
    // line takes the camera away, and a kick would be left holding it.
    if (this.phase === 'walk' && !busy && this.player.position.x > this.level.talkX) this.beginTalk();
    if (this.leaveWalk >= 0 && this.wounded.root.visible) this.updateLeaving(dt);
    else if (this.leaveWalk >= 0 && this.powerT >= 0) this.powerT += dt;
    this.updatePower(dt);
    this.updateMazeDoor(dt);
    this.updateExit(dt);

    // ---- Weapon slots. The shotgun is not carried until it is handed over.
    if (playable && this.hasShotgun && !this.dialogue.isActive && !busy) {
      if (input.wasPressed('Digit1')) this.wanted = 'pistol';
      if (input.wasPressed('Digit2')) this.wanted = 'shotgun';
    }
    if (busy) {
      // Both hands are on a can, or he is on his back on the floor — either
      // way whatever was held drops out of frame
      this.weapon.stow = Math.min(1, this.weapon.stow + dt * 6);
      this.shotgun.stow = Math.min(1, this.shotgun.stow + dt * 6);
    } else if (this.wanted !== this.active) {
      const cur = this.active === 'pistol' ? this.weapon : this.shotgun;
      cur.stow = Math.min(1, cur.stow + dt * 6);
      if (cur.stow >= 1) this.active = this.wanted;
    } else {
      held.stow = Math.max(0, held.stow - dt * 6);
    }

    // ---- Middle-finger emote: T raises it and it stays up; T again, a
    // reload, or dying puts the hand back on the gun
    if (
      playable &&
      input.wasPressed('KeyT') &&
      this.player.alive &&
      input.pointerLocked &&
      !held.reloading &&
      !this.dialogue.isActive
    ) {
      this.emote.toggle();
    }
    if (held.reloading || !this.player.alive) this.emote.cancel();
    this.weapon.hideSupportHand = this.emote.engaged;
    this.shotgun.hideSupportHand = this.emote.engaged;

    this.weapon.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming && this.active === 'pistol');
    this.shotgun.update(dt, this.player, this.player.lastMouseDX, this.player.lastMouseDY, aiming && this.active === 'shotgun');
    this.emote.update(dt, this.player);
    this.drink.update(dt, this.player);
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
    if (clicked && this.active === 'shotgun' && this.shotgun.reloading && this.shells > 0) {
      // Interrupt the shell loop to get back in the fight
      this.shotgun.cancelReload();
    } else if (
      this.phase === 'play' && this.player.alive && input.pointerLocked &&
      clicked && this.fireCooldown <= 0 && !held.reloading && !busy
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
      const h = this.ui.querySelector<HTMLElement>('.torch-hint');
      if (h) h.classList.toggle('on', this.torchOn);
    }

    if (input.wasPressed('KeyR') && this.player.alive && !busy) {
      if (this.active === 'pistol' && this.ammo < MAG_SIZE) {
        if (this.weapon.startReload()) this.player.aiming = false;
      } else if (this.active === 'shotgun' && this.shells < TUBE_SIZE && !this.shotgun.pumping) {
        if (this.shotgun.startReload(TUBE_SIZE - this.shells)) this.player.aiming = false;
      }
    }
    if (this.active === 'pistol') this.hud.setAmmo(this.ammo, MAG_SIZE, this.weapon.reloading);
    else this.hud.setAmmo(this.shells, TUBE_SIZE, this.shotgun.reloading);

    // His body stays anchored against the wall and only his head follows
    // Ravi — until he starts getting up, at which point he looks where he is
    // going. Keyed off the walk-out rather than the phase: control comes back
    // as he stands, so by phase he was still tracking Ravi on the way past
    // and his head span round to keep him in view.
    this.wounded.setHeadLook(this.leaveWalk >= 0 ? null : this.player.eyePosition());
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
      const dir = e.forwardDir(new THREE.Vector3());
      dir.y = -0.06; // carried a touch low, the way a weapon light is held
      dir.normalize();
      // The muzzle sits over half a metre in front of the body, so an agent
      // stood against a wall has his weapon hand through it, and a beam
      // starting out there has nothing left to stop it. Walk from the body,
      // which collision keeps honest, out towards the muzzle, and give up at
      // the first thing in the way.
      const from = e.muzzleWorld();
      const body = Level4Scene.tmpA.set(e.position.x, from.y, e.position.z);
      const out = Level4Scene.tmpB.copy(from).sub(body);
      const reachMuzzle = out.length();
      if (reachMuzzle > 0.01) {
        out.divideScalar(reachMuzzle);
        this.raycaster.set(body, out);
        this.raycaster.far = reachMuzzle;
        const wall = this.raycaster.intersectObjects(this.level.occluders, false);
        if (wall.length) from.copy(body).addScaledVector(out, Math.max(0, wall[0].distance - 0.08));
      }
      // Last guard: if the muzzle has still ended up inside a wall — which
      // happens when the body itself is pressed into one — put the beam out
      // for the frame rather than let it shine from inside the plaster. A
      // beam that blinks is far less wrong than one coming through a wall.
      if (this.insideWall(from)) this.beams.kill(i);
      else this.beams.aim(i, from, dir);
    }

    if (this.agents.length) this.separateAgents(dt);

    for (const c of this.corpses) c.update(dt);
    this.wounded.update(dt);
    this.dialogue.update(dt);
    this.world.step(1 / 60, dt, 3);
    for (const pane of this.level.glassPanes) pane.update(dt);
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
    this.particles.barrelSmoke(muzzle, base);
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
        // Separation is a raw position write, so it will happily shove
        // somebody into a wall — and once inside one the AI has no way back
        // out and they stand there scraping it. Push them clear again.
        this.pushOutOfWalls(a);
        this.pushOutOfWalls(b);
      }
    }
  }

  /**
   * Staff who were on this floor when the team came through.
   *
   * Ragdolled and then stepped to rest before the level is ever drawn, so
   * they are lying the way a body lies rather than standing in a T-pose for
   * the first second of play.
   */
  private spawnCorpses(): void {
    for (const [i, s] of this.level.corpseSpawns.entries()) {
      const body = new Enemy(s.pos, s.yaw, i + 31, { name: 'STAFF', civilian: true });
      this.scene.add(body.root);
      this.corpses.push(body);
      for (const part of body.parts) this.level.shootables.push(part);
      const dir = new THREE.Vector3(Math.cos(s.yaw), -0.25, Math.sin(s.yaw)).normalize();
      const hit = s.pos.clone().add(new THREE.Vector3(0, 1.1 + Math.random() * 0.3, 0));
      body.die(hit, dir, this.world, Math.random() < 0.3 ? 'head' : 'torso');
    }
    // Run the ragdolls to rest before the level is ever drawn
    for (let f = 0; f < 110; f++) {
      this.world.step(1 / 60);
      for (const c of this.corpses) c.update(1 / 60);
    }
    const up = new THREE.Vector3(0, 1, 0);
    for (const c of this.corpses) {
      const base = c.corpseBase();
      this.decals.place('pool', base.clone().setY(0.012), up, 1.1 + Math.random() * 0.5);
      this.decals.place('blood', base.clone().add(new THREE.Vector3(0.3, 0, 0.2)).setY(0.012), up, 0.7);
    }
  }

  /** Is this point inside a wall a body could not stand in? */
  private insideWall(p: THREE.Vector3): boolean {
    for (const c of this.level.colliders) {
      if (c.disabled) continue;
      const b = c.box;
      if (b.min.y > p.y || b.max.y < p.y) continue;
      if (p.x > b.min.x - 0.06 && p.x < b.max.x + 0.06 && p.z > b.min.z - 0.06 && p.z < b.max.z + 0.06) {
        return true;
      }
    }
    return false;
  }

  /**
   * Ease a body out of anything it has ended up inside, along whichever axis
   * needs the least movement.
   */
  private pushOutOfWalls(e: Enemy): void {
    // A standoff, not just "outside the wall". Parking them at the exact
    // collision radius leaves them scraping it, which is the look we are
    // trying to be rid of.
    const R = 0.52;
    for (const c of this.level.colliders) {
      if (c.disabled) continue;
      const b = c.box;
      if (b.min.y > 1.6 || b.max.y < 0.4) continue;
      const x = e.position.x;
      const z = e.position.z;
      if (x <= b.min.x - R || x >= b.max.x + R || z <= b.min.z - R || z >= b.max.z + R) continue;
      // Four ways out; take the cheapest
      const left = x - (b.min.x - R);
      const right = b.max.x + R - x;
      const back = z - (b.min.z - R);
      const front = b.max.z + R - z;
      const m = Math.min(left, right, back, front);
      if (m === left) e.position.x = b.min.x - R;
      else if (m === right) e.position.x = b.max.x + R;
      else if (m === back) e.position.z = b.min.z - R;
      else e.position.z = b.max.z + R;
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

  /** Who the drop kick would land on right now, if anyone. */
  private kickTarget(): Enemy | null {
    if (this.over) return null;
    return this.kickTargetFrom(this.agents);
  }

  /** Let go of the kick early: legs gone, camera back, the slide forgotten. */
  private endKick(): void {
    this.dropKick.abort();
    this.player.cinematic = false;
    this.kickVictim = null;
    this.endKickRun();
  }

  protected killEnemy(
    enemy: Enemy,
    point: THREE.Vector3,
    dir: THREE.Vector3,
    byPlayer: boolean,
    headshot: boolean,
    hitPart?: string,
    impulseScale = 1,
    /** A boot rather than a bullet: no hole, and no blood thrown. */
    opts: { wound?: boolean; keepWeapon?: boolean } = {}
  ): void {
    if (!enemy.alive) return;
    enemy.die(point, dir, this.world, hitPart === 'head' ? 'head' : 'torso', impulseScale, opts);
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
    if (this.remaining <= 0 && !this.cleared) {
      this.cleared = true;
      // The back door unlocks: the panel over it goes red to green
      this.level.exitPanel.emissive.setHex(0x2bff6a);
      this.level.exitPanel.color.setHex(0x0a2a12);
      this.level.exitPanelLight.color.setHex(0x2bff6a);
      this.ctx.audio.uiBeep(true);
      this.setObjective('FLOOR CLEAR — THE BACK DOOR IS OPEN');
    }
  }

  /**
   * Standing at the back door with the floor clear takes Ravi down. Same as
   * level three's: the leaf never opens, the trigger in front of it gates the
   * change, and the screen goes to black before the next level loads.
   */
  private updateExit(dt: number): void {
    if (this.leaving) {
      this.fade = Math.min(1, this.fade + dt * 1.4);
      if (this.fadeEl) this.fadeEl.style.opacity = String(this.fade);
      if (this.fade >= 1 && !this.handedOff) {
        this.handedOff = true;
        this.ctx.bus.emit(Events.Level4Complete);
      }
      return;
    }
    if (this.phase !== 'play' || !this.player.alive || this.over) return;
    const p = this.player.position;
    if (!this.level.exitTrigger.containsPoint(new THREE.Vector3(p.x, p.y + 0.9, p.z))) return;
    if (!this.cleared) {
      this.setObjective('LOCKED — CLEAR THE FLOOR FIRST');
      return;
    }
    this.leaving = true;
    this.setObjective('');
    this.ctx.audio.doorOpen();
    if (!this.fadeEl) {
      this.fadeEl = document.createElement('div');
      this.fadeEl.className = 'intro-fade';
      this.ctx.uiRoot.appendChild(this.fadeEl);
    }
    this.ctx.input.exitPointerLock();
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.warmUp(renderer, this.player.camera);
    renderer.render(this.scene, this.player.camera);
  }
}
