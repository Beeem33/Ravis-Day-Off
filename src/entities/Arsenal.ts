import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Events, type EventBus, type LevelId } from '../core/EventBus';
import type { AudioManager } from '../core/AudioManager';
import type { InputManager } from '../core/InputManager';
import type { ParticleManager } from '../fx/ParticleManager';
import type { FPSPlayer } from './FPSPlayer';
import { WeaponViewmodel } from './WeaponViewmodel';
import { ShotgunViewmodel } from './ShotgunViewmodel';
import { RifleViewmodel } from './RifleViewmodel';

export type Gun = 'pistol' | 'shotgun' | 'rifle';

/**
 * What Ravi is carrying when a level starts. He keeps everything he picks up:
 * the pistol out of the drawer on the call floor, the shotgun from the office
 * on, and the AK he takes off the boss's man in Level 6 (that level hands it
 * over itself, mid-cutscene, so it is not on this list for level6).
 */
export function loadoutFor(level: LevelId): Gun[] {
  switch (level) {
    case 'intro':
      return ['pistol'];
    case 'office':
    case 'level3':
    case 'level4':
    case 'level5':
    case 'level6':
      return ['pistol', 'shotgun'];
    default:
      return ['pistol', 'shotgun', 'rifle'];
  }
}

// Pistol: semi-auto, ten in the mag
const FIRE_COOLDOWN = 0.17;
export const MAG_SIZE = 10;
// Shotgun: pump pacing sets the fire rate; the tube holds six
const SHOTGUN_COOLDOWN = 0.85;
export const TUBE_SIZE = 6;
const PELLETS = 8;
// AK-47: full auto at ~600 rpm, 30-round magazine
const RIFLE_COOLDOWN = 0.1;
export const RIFLE_MAG = 30;

const SLOT_KEYS: [string, Gun][] = [
  ['Digit1', 'pistol'],
  ['Digit2', 'shotgun'],
  ['Digit3', 'rifle']
];

/** What the arsenal needs from the scene it is in. */
export interface ArsenalHost {
  player: FPSPlayer;
  audio: AudioManager;
  bus: EventBus;
  world: CANNON.World;
  particles: ParticleManager;
  /** The scene's ballistics: returns where the round stopped. */
  castBullet(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3;
  addDebris(mesh: THREE.Object3D, body: CANNON.Body): void;
  dropMagazine(pose: { position: THREE.Vector3; quaternion: THREE.Quaternion; direction: THREE.Vector3 }): void;
}

/**
 * Every gun Ravi carries, in one place: the three viewmodels, which of them
 * he owns, which is in hand, the rounds in each, 1/2/3 to switch, R to
 * reload, and the shooting itself (semi-auto pistol, pump-paced shotgun,
 * full-auto AK). The scene keeps the moves (kick, drink, takedown) and says
 * when the hands are busy; the ballistics still go through its castBullet,
 * so its own damage rules apply — `firing` says which gun the round came from.
 *
 * Per frame, in order: preUpdate() before the scene works out aiming,
 * updateViewmodels() after player.update(), then updateFire().
 */
export class Arsenal {
  readonly pistol: WeaponViewmodel;
  readonly shotgun: ShotgunViewmodel;
  readonly rifle: RifleViewmodel;
  private owned = new Set<Gun>();
  /** In hand, and what 1/2/3 last asked for. */
  active: Gun;
  wanted: Gun;
  ammo = MAG_SIZE;
  shells = TUBE_SIZE;
  rifleAmmo = RIFLE_MAG;
  /** The gun the round being cast right now came out of. */
  firing: Gun = 'pistol';
  private cooldown = 0;
  /** Stow speeds: how fast the gun goes down, and comes back up. */
  stowRate = 5;
  drawRate = 5;
  private magMat: CANNON.Material | null = null;

  constructor(private host: ArsenalHost, owned: readonly Gun[], active?: Gun) {
    const { player, audio } = host;
    const cam = player.camera;
    this.pistol = new WeaponViewmodel(cam);
    this.pistol.onReloadEvent = (e) => {
      if (e === 'magOut') audio.magOut();
      else if (e === 'magDrop') host.dropMagazine(this.pistol.ejectedMagPose());
      else if (e === 'magIn') audio.magIn();
      else if (e === 'rack') audio.slideRack();
      else if (e === 'done') this.ammo = MAG_SIZE;
    };
    this.shotgun = new ShotgunViewmodel(cam);
    this.shotgun.onPumpEvent = (e) => {
      if (e === 'back') audio.pumpBack();
      else if (e === 'eject') this.dropShell();
      else if (e === 'forward') audio.pumpForward();
    };
    this.shotgun.onReloadEvent = (e) => {
      if (e === 'shellIn') {
        audio.shellIn();
        this.shells = Math.min(TUBE_SIZE, this.shells + 1);
      }
    };
    this.rifle = new RifleViewmodel(cam);
    this.rifle.onReloadEvent = (e) => {
      if (e === 'strike') audio.magStrike();
      else if (e === 'magOut') audio.magOut();
      else if (e === 'magDrop') this.dropRifleMagazine();
      else if (e === 'magIn') audio.magIn();
      else if (e === 'rackBack') audio.boltBack();
      else if (e === 'rack') audio.boltForward();
      else if (e === 'done') this.rifleAmmo = RIFLE_MAG;
    };
    for (const g of owned) this.owned.add(g);
    this.active = active ?? (this.owned.has('rifle') ? 'rifle' : this.owned.has('shotgun') ? 'shotgun' : 'pistol');
    this.wanted = this.active;
    for (const v of this.all) v.stow = 1;
    this.held.stow = 0;
  }

  // ------------------------------------------------------------- inventory

  owns(g: Gun): boolean {
    return this.owned.has(g);
  }

  /** Pick one up. `equip` puts it straight in his hands, with no swing. */
  give(g: Gun, equip = false): void {
    this.owned.add(g);
    if (equip) this.equip(g);
  }

  /** Straight into his hands, everything else stowed (cutscenes, hand-overs). */
  equip(g: Gun, stow = 0): void {
    this.active = g;
    this.wanted = g;
    for (const v of this.all) v.stow = 1;
    this.held.stow = stow;
  }

  vm(g: Gun): WeaponViewmodel | ShotgunViewmodel | RifleViewmodel {
    return g === 'pistol' ? this.pistol : g === 'shotgun' ? this.shotgun : this.rifle;
  }

  get all(): (WeaponViewmodel | ShotgunViewmodel | RifleViewmodel)[] {
    return [this.pistol, this.shotgun, this.rifle];
  }

  /** The viewmodel in hand. */
  get held(): WeaponViewmodel | ShotgunViewmodel | RifleViewmodel {
    return this.vm(this.active);
  }

  get reloading(): boolean {
    return this.held.reloading;
  }

  /** Mid-swap, or still coming back up: no aiming and no shooting. */
  get switching(): boolean {
    return this.wanted !== this.active || this.held.stow > 0.1;
  }

  /** The strongest of the three sights' blends, for the HUD. */
  get aimBlend(): number {
    return Math.max(this.pistol.aimBlend, this.shotgun.aimBlend, this.rifle.aimBlend);
  }

  /** How far the sights pull the lens in (degrees off the hip FOV). */
  get zoomFov(): number {
    return 22 * this.pistol.aimBlend + 12 * this.shotgun.aimBlend + 20 * this.rifle.aimBlend;
  }

  set hideSupportHand(on: boolean) {
    for (const v of this.all) v.hideSupportHand = on;
  }

  // ---------------------------------------------------------------- frame

  /**
   * Slots and stowing. `canSwitch`: Ravi is in control and his hands are
   * free. `busy`: both hands are on something else (a can, a knife, the
   * floor), so the gun drops out of frame. `hold`: a cutscene has it — the
   * scene sets the stows itself and nothing moves here.
   */
  preUpdate(dt: number, input: InputManager, o: { canSwitch: boolean; busy: boolean; hold?: boolean }): void {
    if (o.hold) return;
    const held = this.held;
    if (o.canSwitch && !o.busy && !held.reloading) {
      for (const [key, g] of SLOT_KEYS) if (this.owned.has(g) && input.wasPressed(key)) this.wanted = g;
    }
    if (o.busy) {
      for (const v of this.all) v.stow = Math.min(1, v.stow + dt * 6);
    } else if (this.wanted !== this.active) {
      held.stow = Math.min(1, held.stow + dt * this.stowRate);
      if (held.stow >= 1) this.active = this.wanted;
    } else {
      held.stow = Math.max(0, held.stow - dt * this.drawRate);
    }
    if (this.wanted === this.active && !o.busy) for (const v of this.all) if (v !== this.held) v.stow = 1;
  }

  /** After player.update(): every viewmodel follows the camera; only the one in hand aims. */
  updateViewmodels(dt: number, aiming: boolean): void {
    const p = this.host.player;
    for (const g of ['pistol', 'shotgun', 'rifle'] as Gun[]) {
      this.vm(g).update(dt, p, p.lastMouseDX, p.lastMouseDY, aiming && this.active === g);
    }
  }

  /**
   * The trigger and R. `canFire`: Ravi is alive, in control, the pointer is
   * locked and his hands are free — the arsenal adds its own conditions
   * (cooldown, sprinting, reloading, mid-swap, the pump). Returns the gun
   * fired this frame, if any.
   */
  updateFire(dt: number, input: InputManager, canFire: boolean, setAmmo?: (rounds: number, mag: number, reloading: boolean) => void): Gun | null {
    const p = this.host.player;
    const audio = this.host.audio;
    this.cooldown -= dt;
    const ready =
      canFire &&
      this.cooldown <= 0 &&
      !p.sprinting &&
      !this.held.reloading &&
      !this.switching &&
      (this.active !== 'shotgun' || !this.shotgun.pumping);
    const clicked = input.consumeClick();
    let fired: Gun | null = null;
    if (clicked && canFire && this.active === 'shotgun' && this.shotgun.reloading && this.shells > 0) {
      // Interrupt the shell loop to get back in the fight
      this.shotgun.cancelReload();
    } else if (this.active === 'rifle') {
      // Hold the trigger: it keeps cycling until the mag runs dry
      if (input.mouseHeld && ready) {
        if (this.rifleAmmo > 0) {
          this.cooldown = RIFLE_COOLDOWN;
          this.rifleAmmo--;
          this.shootRifle();
          fired = 'rifle';
        } else if (clicked) {
          audio.dryFire();
          this.reload();
        }
      }
    } else if (clicked && ready) {
      if (this.active === 'pistol') {
        if (this.ammo > 0) {
          this.cooldown = FIRE_COOLDOWN;
          this.ammo--;
          this.shootPistol();
          fired = 'pistol';
        } else {
          audio.dryFire();
          this.reload();
        }
      } else if (this.shells > 0) {
        this.cooldown = SHOTGUN_COOLDOWN;
        this.shells--;
        this.shootShotgun();
        fired = 'shotgun';
      } else {
        audio.dryFire();
        this.reload();
      }
    }
    // Manual reload on R (only if there's room)
    if (canFire && input.wasPressed('KeyR') && !this.switching) this.reload();
    setAmmo?.(...this.ammoReadout());
    return fired;
  }

  /** Rounds in hand, the size of a full load, and whether it is being reloaded. */
  ammoReadout(): [number, number, boolean] {
    if (this.active === 'pistol') return [this.ammo, MAG_SIZE, this.pistol.reloading];
    if (this.active === 'shotgun') return [this.shells, TUBE_SIZE, this.shotgun.reloading];
    return [this.rifleAmmo, RIFLE_MAG, this.rifle.reloading];
  }

  /** Top up whatever is in hand, if there is room. */
  reload(): void {
    const p = this.host.player;
    if (p.sprinting) return;
    let started = false;
    if (this.active === 'pistol') started = this.ammo < MAG_SIZE && this.pistol.startReload();
    else if (this.active === 'shotgun')
      started = this.shells < TUBE_SIZE && !this.shotgun.pumping && this.shotgun.startReload(TUBE_SIZE - this.shells);
    else started = this.rifleAmmo < RIFLE_MAG && this.rifle.startReload();
    if (started) p.aiming = false;
  }

  /** Refill everything without the animation (a level restart, a hand-over). */
  refill(): void {
    this.ammo = MAG_SIZE;
    this.shells = TUBE_SIZE;
    this.rifleAmmo = RIFLE_MAG;
  }

  // -------------------------------------------------------------- shooting

  private aimDir(spread: number): THREE.Vector3 {
    const dir = new THREE.Vector3();
    this.host.player.camera.getWorldDirection(dir);
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    return dir.normalize();
  }

  private shootPistol(): void {
    const { audio, bus, player } = this.host;
    audio.playerGunshot();
    this.pistol.fire();
    bus.emit(Events.Sound, { position: player.position.clone(), radius: 30, kind: 'gunshot' });
    // Spread grows with movement, shrinks when crouched; sights in = tight groups
    const speedFactor = player.currentSpeed / 6.6;
    let spread = 0.0045 + speedFactor * 0.028 + (player.crouching ? -0.002 : 0);
    spread *= 1 - 0.8 * this.pistol.aimBlend;
    this.firing = 'pistol';
    const end = this.host.castBullet(player.eyePosition(), this.aimDir(spread));
    this.host.particles.tracer(this.pistol.muzzleWorld(), end);
  }

  private shootShotgun(): void {
    const { audio, bus, player, particles } = this.host;
    audio.shotgunBlast();
    this.shotgun.fire();
    bus.emit(Events.Sound, { position: player.position.clone(), radius: 34, kind: 'gunshot' });
    // A cone of pellets: wide from the hip, meaningfully tighter on the bead
    const speedFactor = player.currentSpeed / 6.6;
    let spread = 0.035 + speedFactor * 0.012;
    spread *= 1 - 0.4 * this.shotgun.aimBlend;
    const eye = player.eyePosition();
    const muzzle = this.shotgun.muzzleWorld();
    const base = new THREE.Vector3();
    player.camera.getWorldDirection(base);
    particles.barrelSmoke(muzzle, base);
    this.firing = 'shotgun';
    for (let i = 0; i < PELLETS; i++) {
      const end = this.host.castBullet(eye, this.aimDir(spread));
      particles.tracer(muzzle, end);
    }
  }

  private shootRifle(): void {
    const { audio, bus, player } = this.host;
    audio.rifleShot();
    this.rifle.fire();
    bus.emit(Events.Sound, { position: player.position.clone(), radius: 36, kind: 'gunshot' });
    // Hip fire walks all over the place; on the irons it groups, and every
    // shot kicks the muzzle up a touch so a long burst climbs
    const speedFactor = player.currentSpeed / 6.6;
    let spread = 0.012 + speedFactor * 0.03 + (player.crouching ? -0.003 : 0);
    spread *= 1 - 0.7 * this.rifle.aimBlend;
    player.pitch += 0.006 + Math.random() * 0.004;
    player.yaw += (Math.random() - 0.5) * 0.006;
    this.firing = 'rifle';
    const end = this.host.castBullet(player.eyePosition(), this.aimDir(spread));
    this.host.particles.tracer(this.rifle.muzzleWorld(), end);
  }

  // ---------------------------------------------------------------- brass

  /** The pump flicks the spent hull out the port; it becomes a real object. */
  private dropShell(): void {
    const { position, direction } = this.shotgun.ejectedShellPose();
    const hull = new THREE.Group();
    hull.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.05, 8), Arsenal.hullMat()));
    const brass = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, 0.013, 8), Arsenal.brassMat());
    brass.position.y = -0.028;
    hull.add(brass);
    hull.position.copy(position);
    const body = new CANNON.Body({
      mass: 0.04,
      shape: new CANNON.Box(new CANNON.Vec3(0.011, 0.032, 0.011)),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      linearDamping: 0.05,
      angularDamping: 0.25
    });
    const v = direction.clone().multiplyScalar(1.8 + Math.random() * 0.8).add(this.host.player.velocity);
    body.velocity.set(v.x, v.y, v.z);
    body.angularVelocity.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
    this.host.addDebris(hull, body);
  }

  private static hull: THREE.Material | null = null;
  private static brass: THREE.Material | null = null;
  private static hullMat(): THREE.Material {
    return (Arsenal.hull ??= new THREE.MeshStandardMaterial({ color: 0xb32222, roughness: 0.6 }));
  }
  private static brassMat(): THREE.Material {
    return (Arsenal.brass ??= new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.35 }));
  }

  /**
   * The AK's empty mag, flicked out forward by the fresh one. A polymer
   * magazine skitters and bounces rather than landing dead, which the world's
   * default (restitution 0.12, for draping ragdolls) will not do.
   */
  private dropRifleMagazine(): void {
    const mesh = this.rifle.makeDroppedMag();
    if (!mesh) return;
    if (!this.magMat) {
      this.magMat = new CANNON.Material('rifleMag');
      this.host.world.addContactMaterial(
        new CANNON.ContactMaterial(this.magMat, this.host.world.defaultMaterial, { restitution: 0.45, friction: 0.22 })
      );
    }
    // Pose AND velocity come from the animated mag, so the physics copy picks
    // up exactly where the animation left off and falls from there
    const { position, quaternion, velocity, angularVelocity } = this.rifle.ejectedMagPose();
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    const body = new CANNON.Body({
      mass: 0.4,
      shape: new CANNON.Box(new CANNON.Vec3(0.03, 0.075, 0.014)),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      linearDamping: 0.02,
      angularDamping: 0.12,
      material: this.magMat
    });
    body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    body.velocity.set(velocity.x, velocity.y, velocity.z);
    body.angularVelocity.set(angularVelocity.x, angularVelocity.y, angularVelocity.z);
    this.host.addDebris(mesh, body);
  }
}
