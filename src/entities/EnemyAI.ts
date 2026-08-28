import * as THREE from 'three';
import type { Enemy } from './Enemy';
import type { FPSPlayer } from './FPSPlayer';
import type { Waypoint, Collider } from '../environment/OfficeLevelBuilder';
import { EventBus, Events } from '../core/EventBus';
import type { AudioManager } from '../core/AudioManager';

export type AIState = 'patrol' | 'suspicious' | 'attack';

const VISION_RADIUS = 18;
const VISION_HALF_ANGLE = THREE.MathUtils.degToRad(55); // 110° cone
const PATROL_SPEED = 1.7;
const INVESTIGATE_SPEED = 2.9;
const REACTION_TIME = 0.5; // seconds between acquiring and the first shot

export interface AIDeps {
  player: FPSPlayer;
  waypoints: Waypoint[];
  occluders: THREE.Object3D[];
  /** Level movement colliders — enemies slide along walls like the player does. */
  colliders: Collider[];
  bus: EventBus;
  audio: AudioManager;
  /** Scene-level ballistics: the enemy pulls the trigger. */
  enemyFire: (enemy: Enemy) => void;
}

/**
 * EnemyAI — three-state machine (Patrol → Suspicious → Attack) with a 3D
 * vision cone verified by raycasts against level occluders, plus hearing
 * driven by EventBus sound events (gunshots, sprinting footsteps, glass).
 */
export class EnemyAI {
  state: AIState = 'patrol';
  private awareness = 0; // 0..1 — fills while the player is in the cone
  private targetWp: number;
  /** Remaining waypoints of the current patrol route. */
  private path: number[] = [];
  /** True while Suspicious is walking a stair route to a sound on the other floor. */
  private routing = false;
  private pauseTimer = 0;
  private investigatePos: THREE.Vector3 | null = null;
  private investigateTimer = 0;
  private reactionTimer = 0;
  private fireTimer = 0;
  private lostSightTimer = 0;
  private lastKnownPlayerPos = new THREE.Vector3();
  private stepTimer = 0;
  private strafePhase = Math.random() * 10;
  private unsub: () => void;
  private raycaster = new THREE.Raycaster();
  private hasShouted = false;
  /** Which way they committed to going round the last obstacle, and for how long. */
  private avoidSide = 0;
  private avoidHold = 0;

  private static tmpA = new THREE.Vector3();
  private static tmpB = new THREE.Vector3();
  private static tmpC = new THREE.Vector3();

  constructor(
    private enemy: Enemy,
    private deps: AIDeps
  ) {
    this.targetWp = this.nearestWaypoint();
    this.unsub = deps.bus.on<{ position: THREE.Vector3; radius: number; kind: string }>(
      Events.Sound,
      (s) => this.onSound(s)
    );
  }

  dispose(): void {
    this.unsub();
  }

  // ---------------------------------------------------------------- senses

  private nearestWaypoint(): number {
    const { waypoints } = this.deps;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < waypoints.length; i++) {
      // Stay on our own floor
      if (Math.abs(waypoints[i].pos.y - this.enemy.position.y) > 1.5) continue;
      const d = waypoints[i].pos.distanceToSquared(this.enemy.position);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private onSound(s: { position: THREE.Vector3; radius: number; kind: string }): void {
    if (!this.enemy.alive) return;
    const dist = s.position.distanceTo(this.enemy.position);
    if (dist > s.radius) return;
    // Same-floor sounds only (muffled through the slab), except loud gunshots
    const sameFloor = Math.abs(s.position.y - this.enemy.position.y) < 2;
    if (!sameFloor && s.kind !== 'gunshot' && s.kind !== 'glass') return;

    if (this.state === 'attack') return;
    if (sameFloor) {
      this.investigatePos = s.position.clone();
      this.investigatePos.y = this.enemy.position.y;
      this.investigateTimer = 5;
      if (this.state !== 'suspicious') {
        this.state = 'suspicious';
        this.deps.audio.radioChirp(this.playerDistance());
      }
    } else {
      // Heard trouble on the other floor — head for the stairs and go look
      // (Suspicious routes via the waypoint graph when the target is off-floor)
      this.state = 'suspicious';
      this.investigateTimer = Math.max(this.investigateTimer, 12);
      this.investigatePos = s.position.clone();
      this.routing = false;
      this.path = [];
    }
    this.awareness = Math.min(1, this.awareness + (s.kind === 'gunshot' ? 0.5 : 0.25));
  }

  private playerDistance(): number {
    return this.deps.player.position.distanceTo(this.enemy.position);
  }

  /** 3D cone + raycast line-of-sight check. */
  private canSeePlayer(): boolean {
    const { player, occluders } = this.deps;
    if (!player.alive) return false;
    const eye = this.enemy.eyePosition(EnemyAI.tmpA);
    const target = player.eyePosition(EnemyAI.tmpB);
    const toPlayer = target.clone().sub(eye);
    const dist = toPlayer.length();
    if (dist > VISION_RADIUS) return false;
    toPlayer.normalize();

    // Horizontal cone check against facing
    const fwd = this.enemy.forwardDir(new THREE.Vector3());
    const flat = new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize();
    if (fwd.angleTo(flat) > VISION_HALF_ANGLE) return false;

    // Raycast against occluding geometry (glass intentionally excluded)
    this.raycaster.set(eye, toPlayer);
    this.raycaster.far = dist - 0.1;
    if (this.raycaster.intersectObjects(occluders, false).length > 0) return false;
    // …and back the other way. Meshes are single-sided, so a ray that starts
    // inside a wall sails straight out of it; the reverse ray from the
    // player's side always meets the wall's front face. Both must be clear.
    this.raycaster.set(target, toPlayer.clone().negate());
    this.raycaster.far = dist - 0.1;
    return this.raycaster.intersectObjects(occluders, false).length === 0;
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    const enemy = this.enemy;
    if (!enemy.alive) return;
    const player = this.deps.player;

    const seen = this.canSeePlayer();
    if (seen) {
      this.lastKnownPlayerPos.copy(player.position);
      // Awareness builds faster the closer the player is
      const d = this.playerDistance();
      const rate = d < 6 ? 4 : d < 12 ? 1.8 : 1.0;
      this.awareness = Math.min(1, this.awareness + dt * rate);
    } else {
      this.awareness = Math.max(0, this.awareness - dt * 0.25);
    }

    switch (this.state) {
      case 'patrol':
        this.updatePatrol(dt, seen);
        break;
      case 'suspicious':
        this.updateSuspicious(dt, seen);
        break;
      case 'attack':
        this.updateAttack(dt, seen);
        break;
    }
  }

  private enterAttack(): void {
    if (this.state !== 'attack') {
      this.state = 'attack';
      this.reactionTimer = REACTION_TIME;
      this.fireTimer = 0;
      if (!this.hasShouted) {
        this.hasShouted = true;
        this.deps.audio.enemyShout(this.playerDistance());
      }
      // Yell alerts nearby buddies
      this.deps.bus.emit(Events.Sound, {
        position: this.enemy.position.clone(),
        radius: 12,
        kind: 'shout'
      });
    }
  }

  private updatePatrol(dt: number, seen: boolean): void {
    const enemy = this.enemy;
    enemy.setAiming(false);

    if (seen && this.awareness >= 1) {
      this.enterAttack();
      return;
    }
    if (seen && this.awareness >= 0.35) {
      // A glimpse — stop and stare
      this.state = 'suspicious';
      this.investigatePos = this.deps.player.position.clone();
      this.investigatePos.y = enemy.position.y;
      this.investigateTimer = 4;
      return;
    }

    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
      enemy.setWalk(0);
      return;
    }

    const wp = this.deps.waypoints[this.targetWp];
    const arrived = this.moveToward(wp.pos, PATROL_SPEED, dt, 0.35, true);
    if (arrived) {
      if (this.path.length > 0) {
        // Next leg of the route — only a short breather at corners
        this.targetWp = this.path.shift()!;
        this.pauseTimer = Math.random() < 0.3 ? 0.4 + Math.random() * 1.2 : 0;
      } else {
        // Reached the destination: look around a while, then pick somewhere
        // else in the building (either floor — the stairs are on the graph).
        this.pauseTimer = 1.2 + Math.random() * 3;
        this.planRoute();
      }
    }
  }

  /** Breadth-first route across the waypoint graph to a random far-off node. */
  private planRoute(): void {
    const wps = this.deps.waypoints;
    const start = this.targetWp;
    let dest = Math.floor(Math.random() * wps.length);
    for (let tries = 0; tries < 6 && wps[dest].pos.distanceTo(wps[start].pos) < 8; tries++) {
      dest = Math.floor(Math.random() * wps.length);
    }
    const prev = new Map<number, number>([[start, -1]]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === dest) break;
      for (const n of wps[cur].links) {
        if (!prev.has(n)) {
          prev.set(n, cur);
          queue.push(n);
        }
      }
    }
    if (!prev.has(dest)) return;
    const route: number[] = [];
    for (let n = dest; n !== start && n !== -1; n = prev.get(n)!) route.unshift(n);
    this.path = route;
    if (this.path.length > 0) this.targetWp = this.path.shift()!;
  }

  private updateSuspicious(dt: number, seen: boolean): void {
    const enemy = this.enemy;
    enemy.setAiming(true);

    if (seen && this.awareness >= 1) {
      this.enterAttack();
      return;
    }

    if (this.investigatePos && Math.abs(this.investigatePos.y - enemy.position.y) > 1.2) {
      // Sound came from the other floor: take the stairs toward it
      if (this.path.length === 0 && !this.routing) {
        this.routing = this.routeTo(this.investigatePos);
        if (!this.routing) this.investigatePos.y = enemy.position.y; // no route — just listen from here
      }
      if (this.routing && this.followRoute(INVESTIGATE_SPEED, dt)) {
        this.routing = false;
        this.investigatePos.y = enemy.position.y;
      }
    } else if (this.investigatePos) {
      const arrived = this.moveToward(this.investigatePos, INVESTIGATE_SPEED, dt, 1.1);
      if (arrived) {
        enemy.setWalk(0);
        // Look around: sweep facing left and right
        enemy.yaw += Math.sin(this.investigateTimer * 2.2) * dt * 1.4;
        enemy.root.rotation.y = enemy.yaw;
      }
    } else {
      enemy.setWalk(0);
    }

    this.investigateTimer -= dt;
    if (this.investigateTimer <= 0 && this.awareness < 0.3) {
      this.state = 'patrol';
      this.investigatePos = null;
      this.routing = false;
      this.path = [];
      this.targetWp = this.nearestWaypoint();
    }
  }

  private updateAttack(dt: number, seen: boolean): void {
    const enemy = this.enemy;
    const player = this.deps.player;
    enemy.setAiming(true);

    if (!player.alive) {
      // Job done. Stand down slowly.
      enemy.setWalk(0);
      return;
    }

    if (seen || this.coverPhase === 'inCover' || this.coverPhase === 'toCover') {
      if (seen) this.lostSightTimer = 0;

      // Cover fighters cycle: shoot exposed → duck behind something → pop
      // back out. The rest stand and slug it out like before.
      if (this.usesCover) {
        this.updateCoverFight(dt, seen);
        return;
      }

      enemy.faceToward(seen ? player.position : this.lastKnownPlayerPos, dt, 9);
      // Micro-strafe so he's not a statue
      this.strafePhase += dt;
      const strafe = Math.sin(this.strafePhase * 1.7);
      const side = EnemyAI.tmpA.set(Math.cos(enemy.yaw), 0, -Math.sin(enemy.yaw));
      enemy.position.addScaledVector(side, strafe * dt * 0.6);
      this.resolveCollisions();
      enemy.setWalk(0.3);

      if (this.reactionTimer > 0) {
        this.reactionTimer -= dt;
        return;
      }
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = 1.05 + Math.random() * 0.6;
        this.deps.enemyFire(enemy);
      }
    } else {
      this.lostSightTimer += dt;
      const otherFloor = Math.abs(this.lastKnownPlayerPos.y - enemy.position.y) > 1.2;
      // Push toward the last known position — same floor only; if Ravi was
      // seen on the other floor, hand off to Suspicious, which takes the stairs.
      const arrived = otherFloor ? true : this.moveToward(this.lastKnownPlayerPos, INVESTIGATE_SPEED, dt, 1.4);
      if (arrived || this.lostSightTimer > 4) {
        this.state = 'suspicious';
        this.investigatePos = this.lastKnownPlayerPos.clone();
        this.routing = false;
        this.path = [];
        this.investigateTimer = otherFloor ? 12 : 5;
        this.reactionTimer = REACTION_TIME * 0.6; // faster the second time
      }
    }
  }

  // ------------------------------------------------------------ cover fight

  /** Roughly half the squad fights from cover; the rest stand in the open. */
  private usesCover = Math.random() < 0.55;
  private coverPhase: 'expose' | 'toCover' | 'inCover' | 'toPeek' = 'expose';
  private coverTimer = 1.2 + Math.random();
  private coverPos: THREE.Vector3 | null = null;
  private peekPos: THREE.Vector3 | null = null;

  /** Would an eye at `pos` have line-of-sight to the player? (both-way ray, no cone) */
  private visibleFrom(pos: THREE.Vector3): boolean {
    const { player, occluders } = this.deps;
    const eye = EnemyAI.tmpA.set(pos.x, pos.y + this.enemy.eyeHeight, pos.z);
    const target = player.eyePosition(EnemyAI.tmpB);
    const to = target.clone().sub(eye);
    const dist = to.length();
    to.normalize();
    this.raycaster.set(eye, to);
    this.raycaster.far = dist - 0.1;
    if (this.raycaster.intersectObjects(occluders, false).length > 0) return false;
    this.raycaster.set(target, to.clone().negate());
    this.raycaster.far = dist - 0.1;
    return this.raycaster.intersectObjects(occluders, false).length === 0;
  }

  /** Nearby spot that breaks line-of-sight — behind a wall, pillar or cubicle. */
  private findCover(): THREE.Vector3 | null {
    const p = this.enemy.position;
    for (const d of [1.2, 2, 2.8]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
        const cand = new THREE.Vector3(p.x + Math.cos(a) * d, p.y, p.z + Math.sin(a) * d);
        if (!this.visibleFrom(cand)) return cand;
      }
    }
    return null;
  }

  private updateCoverFight(dt: number, seen: boolean): void {
    const enemy = this.enemy;
    const player = this.deps.player;
    this.coverTimer -= dt;
    switch (this.coverPhase) {
      case 'expose': {
        // Out in the open: face them, get shots off, then look for cover.
        // Only the LIVE position when they can actually be seen — turning to
        // follow someone through a wall is how an agent ends up sweeping his
        // arms through it, tracking a player he has no business knowing about.
        enemy.faceToward(seen ? player.position : this.lastKnownPlayerPos, dt, 9);
        enemy.setWalk(0.2);
        if (this.reactionTimer > 0) {
          this.reactionTimer -= dt;
          break;
        }
        this.fireTimer -= dt;
        if (seen && this.fireTimer <= 0) {
          this.fireTimer = 0.95 + Math.random() * 0.5;
          this.deps.enemyFire(enemy);
        }
        if (this.coverTimer <= 0) {
          const cover = this.findCover();
          if (cover) {
            this.coverPos = cover;
            this.peekPos = enemy.position.clone();
            this.coverPhase = 'toCover';
          } else {
            this.coverTimer = 1.5 + Math.random(); // nothing to hide behind here
          }
        }
        break;
      }
      case 'toCover':
        if (this.moveToward(this.coverPos!, INVESTIGATE_SPEED * 1.15, dt, 0.3)) {
          this.coverPhase = 'inCover';
          this.coverTimer = 0.8 + Math.random() * 1.4;
        }
        break;
      case 'inCover':
        // Tucked away, weapon up, waiting a beat before the peek
        enemy.faceToward(this.peekPos ?? this.lastKnownPlayerPos, dt, 7);
        enemy.setWalk(0);
        if (this.coverTimer <= 0) this.coverPhase = 'toPeek';
        break;
      case 'toPeek':
        if (this.moveToward(this.peekPos!, INVESTIGATE_SPEED * 1.25, dt, 0.3) || seen) {
          // Out again: a short, aggressive exposure
          this.coverPhase = 'expose';
          this.coverTimer = 1.1 + Math.random() * 0.9;
          this.fireTimer = 0.25 + Math.random() * 0.3; // snap shot right out of the peek
        }
        break;
    }
  }

  /**
   * Push the enemy out of any level collider it overlaps (walls, cubicles,
   * desks, unbroken glass) along the axis of least penetration, so they
   * slide along surfaces instead of walking into them.
   */
  /**
   * Is a body-sized probe clear along `dir` for `dist` metres?
   *
   * Uses a wider radius than the collision resolve, so a path counted as
   * clear leaves room to walk it rather than scraping down it.
   */
  private pathClear(dir: THREE.Vector3, dist: number): boolean {
    const p = this.enemy.position;
    const R = 0.55;
    const steps = Math.max(2, Math.ceil(dist / 0.3));
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * dist;
      const x = p.x + dir.x * t;
      const z = p.z + dir.z * t;
      for (const c of this.deps.colliders) {
        if (c.disabled) continue;
        const b = c.box;
        if (b.max.y <= p.y + 0.5 || b.min.y >= p.y + 1.6) continue;
        if (x > b.min.x - R && x < b.max.x + R && z > b.min.z - R && z < b.max.z + R) return false;
      }
    }
    return true;
  }

  /**
   * Turn the direction they WANT to go into one they can actually walk.
   *
   * Without this they walked dead at the target and left resolveCollisions to
   * shove them out of whatever they hit — which, frame after frame, is an
   * agent grinding along a wall going nowhere. It only showed up once there
   * were targets off the waypoint graph to chase: an investigate point or a
   * last-known player position can be straight through a wall, and nothing
   * was routing round it.
   *
   * Deflections are tried in widening steps, and the side chosen is held for
   * a beat so they commit to going round a corner instead of jittering on it.
   */
  private steerAround(desired: THREE.Vector3, dt: number): THREE.Vector3 {
    const LOOK = 1.6;
    this.avoidHold = Math.max(0, this.avoidHold - dt);
    if (this.pathClear(desired, LOOK)) {
      if (this.avoidHold <= 0) this.avoidSide = 0;
      return desired;
    }
    const order = this.avoidSide !== 0 ? [this.avoidSide, -this.avoidSide] : [1, -1];
    const cand = EnemyAI.tmpB;
    for (const ang of [0.55, 1.0, 1.5, 2.1, 2.7]) {
      for (const side of order) {
        const a = ang * side;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        cand.set(desired.x * cos - desired.z * sin, 0, desired.x * sin + desired.z * cos).normalize();
        if (this.pathClear(cand, LOOK)) {
          this.avoidSide = side;
          this.avoidHold = 1.1;
          return desired.copy(cand);
        }
      }
    }
    // Boxed in on every heading: stand rather than push into it
    return desired.set(0, 0, 0);
  }

  private resolveCollisions(): void {
    const p = this.enemy.position;
    const R = 0.42; // wide enough that the ragdoll arms never spawn inside a wall
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.deps.colliders) {
        if (c.disabled) continue;
        const b = c.box;
        // Horizontal slab of the enemy's capsule; skip floors (top below the knees)
        // Skip floors and anything below the knee (stair treads) so they can climb
        if (b.max.y <= p.y + 0.5 || b.min.y >= p.y + 1.6) continue;
        const ox = Math.min(p.x + R - b.min.x, b.max.x - (p.x - R));
        const oz = Math.min(p.z + R - b.min.z, b.max.z - (p.z - R));
        if (ox <= 0 || oz <= 0) continue;
        if (ox < oz) p.x += p.x < (b.min.x + b.max.x) / 2 ? -ox : ox;
        else p.z += p.z < (b.min.z + b.max.z) / 2 ? -oz : oz;
      }
    }
  }

  /** Straight-line steering used along waypoint links. Returns true on arrival. */
  /**
   * Route via the waypoint graph toward a position (possibly on another
   * floor). Used whenever a target isn't on this floor: enemies take the
   * stairs, never the shortcut through the slab.
   */
  private routeTo(target: THREE.Vector3): boolean {
    const wps = this.deps.waypoints;
    const nearest = (p: THREE.Vector3, y: number): number => {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < wps.length; i++) {
        if (Math.abs(wps[i].pos.y - y) > 1.5) continue;
        const d = wps[i].pos.distanceToSquared(p);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    const start = nearest(this.enemy.position, this.enemy.position.y);
    const dest = nearest(target, target.y);
    if (start < 0 || dest < 0) return false;
    const prev = new Map<number, number>([[start, -1]]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === dest) break;
      for (const n of wps[cur].links) {
        if (!prev.has(n)) {
          prev.set(n, cur);
          queue.push(n);
        }
      }
    }
    if (!prev.has(dest)) return false;
    const route: number[] = [];
    for (let n = dest; n !== -1; n = prev.get(n)!) route.unshift(n);
    this.path = route;
    this.targetWp = this.path.shift()!;
    return true;
  }

  /** Follow the planned route one leg at a time. Returns true when the route is done. */
  private followRoute(speed: number, dt: number): boolean {
    const wp = this.deps.waypoints[this.targetWp];
    if (this.moveToward(wp.pos, speed, dt, 0.4, true)) {
      if (this.path.length === 0) return true;
      this.targetWp = this.path.shift()!;
    }
    return false;
  }

  private moveToward(target: THREE.Vector3, speed: number, dt: number, arriveDist = 0.35, followY = false): boolean {
    const enemy = this.enemy;
    const to = EnemyAI.tmpA.set(target.x - enemy.position.x, 0, target.z - enemy.position.z);
    const dist = to.length();
    if (dist < arriveDist) {
      enemy.setWalk(0);
      return true;
    }
    to.normalize();
    // Walk the way that is actually walkable, and face that way too — an
    // agent staring at a target through a wall while sliding along it is
    // exactly what reads as hugging.
    this.steerAround(to, dt);
    if (to.lengthSq() < 0.01) {
      enemy.setWalk(0);
      return false;
    }
    EnemyAI.tmpC.copy(enemy.position).addScaledVector(to, 2);
    enemy.faceToward(EnemyAI.tmpC, dt, 6);
    const step = Math.min(speed * dt, dist);
    enemy.position.addScaledVector(to, step);
    // Climb/descend ONLY along waypoint links (the stairs). Chasing a target
    // on another floor never changes height — that's what routeTo is for.
    if (followY) enemy.position.y += (target.y - enemy.position.y) * Math.min(1, step / Math.max(0.001, dist));
    this.resolveCollisions();
    enemy.setWalk(Math.min(1, speed / 2.5));

    // Footstep noise for the player to track
    this.stepTimer -= dt;
    if (this.stepTimer <= 0) {
      this.stepTimer = 0.38;
      this.deps.audio.enemyFootstep(this.playerDistance());
    }
    return false;
  }
}
