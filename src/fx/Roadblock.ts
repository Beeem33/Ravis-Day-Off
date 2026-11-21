import * as THREE from 'three';
import type { ICar, PoliceRig, RoadPos, StreetBlocker } from '../scenes/StreetContracts';
import type { CarRig } from '../scenes/Level8Contracts';
import type { RoadNet } from '../entities/RoadNet';
import { policeCruiser } from '../environment/StreetProps';
import { Enemy } from '../entities/Enemy';
import { armWithAK } from '../entities/AkModel';

/**
 * Roadblock — the highway patrol across the road: cruisers slewed across
 * two of the three lanes (two to a lane, lights going), one lane left open,
 * and officers out on foot, a couple of them out in the open lane itself.
 * The traffic queues up behind the cars in the shut lanes (hazards: to the
 * traffic and the AI drivers it's a car stopped there); the cars are solid
 * (blockers) to everything that drives.
 */

/** A stopped car, as the traffic and the drivers see one: where it is, and that it isn't going anywhere. */
class Stopped implements ICar {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly at: RoadPos;
  yaw = 0;
  speed = 0;
  readonly steerAngle = 0;
  readonly pitch = 0;
  readonly roll = 0;
  readonly slide = 0;
  onImpact = null;
  constructor(
    at: RoadPos,
    readonly halfLength: number,
    readonly halfWidth: number
  ) {
    this.at = { ...at };
  }
  update(): void {}
  place(): void {}
  applyTo(_rig: CarRig): void {}
}

export interface Officer {
  e: Enemy;
  /** Where he stands, and whether he's out in the open lane. */
  at: THREE.Vector3;
  inLane: boolean;
  fireCd: number;
  burst: number;
  /** Run down: off his feet, his ragdoll going. */
  down: boolean;
}

export class Roadblock {
  readonly cars: PoliceRig[] = [];
  readonly hazards: ICar[] = [];
  readonly blockers: StreetBlocker[] = [];
  readonly officers: Officer[] = [];
  readonly group = new THREE.Group();
  /** The lane left open (its offset), and the line across the road where the cars are. */
  readonly openD: number;
  readonly s: number;
  private t = 0;

  constructor(net: RoadNet, s: number, lanes: number[], openIndex: number) {
    this.s = s;
    this.openD = lanes[openIndex];
    const f = net.sample('highway', s);
    const roadYaw = Math.atan2(-f.tangent.x, -f.tangent.z);
    const shut = lanes.filter((_, i) => i !== openIndex);
    let n = 0;
    for (const d of shut) {
      // Two to a shut lane: slewed across it, one ahead of the other, opposite ways
      for (const [ds, turn] of [[0, 1.05], [-7.5, -0.95]] as [number, number][]) {
        const rig = policeCruiser();
        const at = { road: 'highway' as const, s: s + ds, d };
        const pos = net.point(at, new THREE.Vector3());
        const yaw = roadYaw + turn * (n % 2 ? 1 : -1);
        rig.group.position.copy(pos);
        rig.group.rotation.set(0, yaw, 0);
        this.group.add(rig.group);
        this.cars.push(rig);
        this.blockers.push({ centre: pos.clone().setY(pos.y + 0.8), halfX: 1.0, halfZ: 2.6, yaw, minY: pos.y - 0.5, maxY: pos.y + 1.6 });
        n++;
      }
      // To the traffic and the drivers: the lane's stopped dead at the first of them
      this.hazards.push(new Stopped({ road: 'highway', s: s - 9, d }, 4, 1.7));
      const h = this.hazards[this.hazards.length - 1];
      net.point(h.at, h.position);
      h.yaw = roadYaw;
    }
    // Officers: two out in the open lane waving him down (at its edges), the rest behind the cars
    const spots: [number, number, boolean][] = [
      [-15, this.openD - 1.25, true],
      [-24, this.openD + 1.3, true],
      [-3, shut[0] + 0.4, false],
      [-12, shut[0] - 0.9, false],
      [-4, shut[shut.length - 1] + 0.6, false]
    ];
    spots.forEach(([ds, d, inLane], i) => {
      const at = net.point({ road: 'highway', s: s + ds, d }, new THREE.Vector3());
      const e = new Enemy(at.clone(), roadYaw + Math.PI, 40 + i, { name: 'HIGHWAY PATROL', security: true });
      armWithAK(e);
      e.setAiming(true);
      this.officers.push({ e, at, inLane, fireCd: 1 + Math.random() * 2, burst: 0, down: false });
    });
  }

  /** The lights going. */
  update(dt: number): void {
    this.t += dt;
    this.cars.forEach((c, i) => {
      const ph = (this.t * 2.2 + i * 0.37) % 1;
      const flash = (a: number): number => (Math.sin(ph * 2 * Math.PI * 4) > 0 && (ph - a + 1) % 1 < 0.5 ? 3 : 0);
      c.lightRed.emissiveIntensity = flash(0);
      c.lightBlue.emissiveIntensity = flash(0.5);
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const o of this.officers) o.e.root.removeFromParent();
  }
}
