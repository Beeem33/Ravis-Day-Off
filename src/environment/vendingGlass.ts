import * as THREE from 'three';
import { BreakableGlass } from './BreakableGlass';
import { VENDING_GLASS } from './OfficeProps';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The three collections every level builder keeps, which a pane has to join.
 * Builders hold these privately, so they hand them over rather than being
 * passed as `this`.
 */
export interface LevelParts {
  group: THREE.Group;
  shootables: THREE.Object3D[];
  glassPanes: BreakableGlass[];
}

/**
 * Swap a vending machine's decorative window for a real pane that breaks.
 *
 * The pane has to live in WORLD space, unrotated: BreakableGlass works out
 * where its shards fly from world axes and parents them to its own parent,
 * so nesting one inside a rotated prop would throw the glass off sideways.
 * The machine's placement is baked into the pane's position instead, which
 * holds for the quarter-turn yaws the machines are ever placed at.
 *
 * No collider is added — the machine's own box already stops you walking
 * through it, and the glass is only ever hit by bullets.
 */
export function breakableVendingGlass(machine: THREE.Group, x: number, z: number, yaw: number, level: LevelParts): void {
  // Retire the prop's fake glass. Hiding it is not enough on its own: some
  // builders push every mesh in a prop into `shootables`, and an invisible
  // shootable would go on stopping bullets in front of the real pane.
  const fake = machine.userData.glassPane as THREE.Mesh | undefined;
  if (fake) {
    fake.removeFromParent();
    const i = level.shootables.indexOf(fake);
    if (i >= 0) level.shootables.splice(i, 1);
  }

  const pane = new BreakableGlass(VENDING_GLASS.w, VENDING_GLASS.h, Math.abs(Math.sin(yaw)) > 0.5 ? 'z' : 'x', false);
  const off = new THREE.Vector3(VENDING_GLASS.x, VENDING_GLASS.y, VENDING_GLASS.z).applyAxisAngle(UP, yaw);
  pane.group.position.set(x + off.x, off.y, z + off.z);
  level.group.add(pane.group);
  level.shootables.push(pane.mesh);
  level.glassPanes.push(pane);
}
