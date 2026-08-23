import * as THREE from 'three';
import type { InputManager } from '../core/InputManager';
import type { AudioManager } from '../core/AudioManager';
import { EventBus, Events } from '../core/EventBus';
import type { Collider } from '../environment/OfficeLevelBuilder';

const GRAVITY = 18;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 6.6;
const CROUCH_SPEED = 2.3;
const JUMP_SPEED = 5.6;
const ACCEL_GROUND = 40;
const ACCEL_AIR = 8;
const STAND_HEIGHT = 1.75;
const CROUCH_HEIGHT = 1.05;
const RADIUS = 0.34;
const STEP_UP = 0.42; // auto-step height for stairs
const EYE_INSET = 0.12;

/**
 * FPSPlayer — pointer-lock mouse look, WASD + sprint/jump/crouch movement,
 * swept AABB collision with auto-stepping (stairs), head bob and one-shot
 * mortality. Position is at the FEET.
 */
export class FPSPlayer {
  readonly camera: THREE.PerspectiveCamera;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  sensitivity = 0.0021;
  alive = true;
  grounded = false;
  crouching = false;
  sprinting = false;

  private height = STAND_HEIGHT;
  private bobPhase = 0;
  private bobAmount = 0;
  private footstepTimer = 0;
  private deathAnim = 0;
  private landedHard = false;

  /** Horizontal speed of last frame, used by AI accuracy + weapon spread. */
  currentSpeed = 0;
  /** Raw mouse delta of the last frame (consumed here, shared with the viewmodel). */
  lastMouseDX = 0;
  lastMouseDY = 0;

  constructor(
    spawn: THREE.Vector3,
    spawnYaw: number,
    private input: InputManager,
    private audio: AudioManager,
    private bus: EventBus
  ) {
    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 120);
    this.camera.rotation.order = 'YXZ';
    this.position.copy(spawn);
    this.yaw = spawnYaw;
  }

  get eyeHeight(): number {
    return this.height - EYE_INSET;
  }

  /** World-space eye position. */
  eyePosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  forwardDir(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  private box(height = this.height, pos = this.position): THREE.Box3 {
    return new THREE.Box3(
      new THREE.Vector3(pos.x - RADIUS, pos.y, pos.z - RADIUS),
      new THREE.Vector3(pos.x + RADIUS, pos.y + height, pos.z + RADIUS)
    );
  }

  update(dt: number, colliders: Collider[]): void {
    if (!this.alive) {
      this.updateDeath(dt);
      return;
    }
    const input = this.input;

    // ---- Mouse look
    const { dx, dy } = input.consumeMouseDelta();
    this.lastMouseDX = dx;
    this.lastMouseDY = dy;
    this.yaw -= dx * this.sensitivity;
    this.pitch -= dy * this.sensitivity;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

    // ---- Crouch (with headroom check before standing)
    const wantCrouch = input.isDown('ControlLeft') || input.isDown('KeyC');
    if (wantCrouch) {
      this.crouching = true;
    } else if (this.crouching) {
      const standBox = this.box(STAND_HEIGHT);
      if (!this.collides(standBox, colliders)) this.crouching = false;
    }
    const targetH = this.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
    this.height += (targetH - this.height) * Math.min(1, dt * 12);

    // ---- Wish direction
    let fwd = 0;
    let strafe = 0;
    if (input.isDown('KeyW')) fwd += 1;
    if (input.isDown('KeyS')) fwd -= 1;
    if (input.isDown('KeyD')) strafe += 1;
    if (input.isDown('KeyA')) strafe -= 1;
    const moving = fwd !== 0 || strafe !== 0;
    this.sprinting = input.isDown('ShiftLeft') && fwd > 0 && !this.crouching;
    const maxSpeed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wishX = (-sin * fwd + cos * strafe) || 0;
    const wishZ = (-cos * fwd - sin * strafe) || 0;
    const wishLen = Math.hypot(wishX, wishZ);

    const accel = this.grounded ? ACCEL_GROUND : ACCEL_AIR;
    if (wishLen > 0.001) {
      const nx = wishX / wishLen;
      const nz = wishZ / wishLen;
      this.velocity.x += nx * accel * dt;
      this.velocity.z += nz * accel * dt;
    } else if (this.grounded) {
      // Friction
      const f = Math.max(0, 1 - dt * 12);
      this.velocity.x *= f;
      this.velocity.z *= f;
    }
    // Clamp horizontal speed
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (hSpeed > maxSpeed) {
      const s = maxSpeed / hSpeed;
      this.velocity.x *= s;
      this.velocity.z *= s;
    }
    this.currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);

    // ---- Jump / gravity
    if (this.grounded && input.wasPressed('Space')) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }
    this.velocity.y -= GRAVITY * dt;

    // ---- Move with collision (axis separated, with step-up on X/Z)
    this.moveAxis(this.velocity.x * dt, 0, colliders);
    this.moveAxis(this.velocity.z * dt, 2, colliders);
    this.moveVertical(this.velocity.y * dt, colliders);

    // Fell out of the world? (shouldn't happen, but be safe)
    if (this.position.y < -10) this.position.set(0, 0.1, 8);

    // ---- Footsteps + noise events
    if (this.grounded && moving && this.currentSpeed > 0.6) {
      this.footstepTimer -= dt * (this.sprinting ? 1.65 : this.crouching ? 0.7 : 1);
      if (this.footstepTimer <= 0) {
        this.footstepTimer = 0.42;
        this.audio.footstep(this.sprinting, this.crouching);
        const radius = this.crouching ? 1.5 : this.sprinting ? 12 : 6;
        this.bus.emit(Events.Sound, { position: this.position.clone(), radius, kind: 'footstep' });
      }
    }
    if (this.landedHard) {
      this.landedHard = false;
      this.audio.footstep(true, false);
      this.bus.emit(Events.Sound, { position: this.position.clone(), radius: 10, kind: 'footstep' });
    }

    // ---- Head bob + camera
    if (this.grounded && moving) {
      this.bobPhase += dt * (this.sprinting ? 13 : this.crouching ? 7 : 10);
      this.bobAmount = Math.min(1, this.bobAmount + dt * 6);
    } else {
      this.bobAmount = Math.max(0, this.bobAmount - dt * 6);
    }
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase) * 0.02 * this.bobAmount;
    const roll = Math.sin(this.bobPhase) * 0.006 * this.bobAmount;

    this.camera.position.set(
      this.position.x + Math.cos(this.yaw) * bobX,
      this.position.y + this.eyeHeight + bobY,
      this.position.z - Math.sin(this.yaw) * bobX
    );
    this.camera.rotation.set(this.pitch, this.yaw, roll);
  }

  /** Bob phase shared with the weapon viewmodel. */
  get bob(): { phase: number; amount: number } {
    return { phase: this.bobPhase, amount: this.bobAmount };
  }

  private collides(box: THREE.Box3, colliders: Collider[]): boolean {
    for (const c of colliders) {
      if (c.disabled) continue;
      if (box.intersectsBox(c.box)) return true;
    }
    return false;
  }

  /** Move along one horizontal axis; try stepping up low obstacles (stairs). */
  private moveAxis(delta: number, axis: 0 | 2, colliders: Collider[]): void {
    if (Math.abs(delta) < 1e-8) return;
    const pos = this.position;
    const key = axis === 0 ? 'x' : 'z';
    pos[key] += delta;
    const box = this.box();
    let blockedTop = -Infinity;
    let hit = false;
    for (const c of colliders) {
      if (c.disabled) continue;
      if (box.intersectsBox(c.box)) {
        hit = true;
        blockedTop = Math.max(blockedTop, c.box.max.y);
      }
    }
    if (!hit) return;
    // Attempt step-up (stairs / thresholds)
    const stepH = blockedTop - pos.y;
    if (this.grounded && stepH > 0 && stepH <= STEP_UP) {
      const stepped = pos.clone();
      stepped.y = blockedTop + 0.001;
      if (!this.collides(this.box(this.height, stepped), colliders)) {
        pos.y = stepped.y;
        return;
      }
    }
    // Blocked: undo and zero velocity on that axis
    pos[key] -= delta;
    this.velocity[key] = 0;
  }

  private moveVertical(delta: number, colliders: Collider[]): void {
    const pos = this.position;
    pos.y += delta;
    const box = this.box();
    let wasGrounded = this.grounded;
    this.grounded = false;
    for (const c of colliders) {
      if (c.disabled) continue;
      if (!box.intersectsBox(c.box)) continue;
      if (delta <= 0) {
        // Landing
        pos.y = c.box.max.y;
        if (!wasGrounded && this.velocity.y < -8) this.landedHard = true;
        this.velocity.y = 0;
        this.grounded = true;
      } else {
        // Bumped head
        pos.y = c.box.min.y - this.height - 0.001;
        this.velocity.y = 0;
      }
      // Recompute box after correction
      box.copy(this.box());
    }
  }

  // ------------------------------------------------------------------ death

  kill(killerName: string): void {
    if (!this.alive) return;
    this.alive = false;
    this.deathAnim = 0;
    this.bus.emit(Events.PlayerDied, { killer: killerName });
  }

  private updateDeath(dt: number): void {
    // Collapse: camera drops to the floor and rolls sideways
    this.deathAnim = Math.min(1, this.deathAnim + dt * 1.6);
    const t = 1 - Math.pow(1 - this.deathAnim, 3);
    const eyeY = this.position.y + this.eyeHeight * (1 - t) + 0.25 * t;
    this.camera.position.set(this.camera.position.x, eyeY, this.camera.position.z);
    this.camera.rotation.set(this.pitch * (1 - t), this.yaw, t * 1.35);
  }
}
