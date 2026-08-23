// Headless movement simulation — run with: npx vite build -c sim/vite.sim.config.ts && node sim/out/sim.js
import * as THREE from 'three';
import { FPSPlayer } from '../src/entities/FPSPlayer';
import { EventBus } from '../src/core/EventBus';
import type { Collider } from '../src/environment/OfficeLevelBuilder';

(globalThis as any).window = { innerWidth: 1280, innerHeight: 720 };

const keys = new Set<string>();
const pressed = new Set<string>();
const input = {
  isDown: (c: string) => keys.has(c),
  wasPressed: (c: string) => pressed.has(c),
  consumeMouseDelta: () => ({ dx: 0, dy: 0 })
} as any;
const audio = { footstep: () => {} } as any;
const bus = new EventBus();

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Collider => ({
  box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1))
});
const colliders: Collider[] = [
  box(-20, -0.3, -20, 20, 0, 20), // floor
  box(5, 0, -2, 5.22, 3, 2), // wall at x=5
  box(9.8, 0, -1, 10.2, 1.5, 1) // low cubicle panel
];
// Stairs: 10 steps rising 0.165 each, 0.3 deep, starting at z=-4 heading -z, at x=17
for (let i = 0; i < 10; i++) colliders.push(box(16.4, 0, -4 - 0.3 * (i + 1), 17.8, 0.165 * (i + 1), -4 - 0.3 * i));

const dt = 1 / 60;
function run(label: string, start: THREE.Vector3, yaw: number, key: string, seconds: number, extra?: (f: number) => void) {
  const p = new FPSPlayer(start, yaw, input, audio, bus);
  keys.clear();
  keys.add(key);
  let maxY = 0;
  for (let f = 0; f < seconds * 60; f++) {
    pressed.clear();
    extra?.(f);
    p.update(dt, colliders);
    maxY = Math.max(maxY, p.position.y);
  }
  keys.clear();
  console.log(
    `${label.padEnd(32)} pos=(${p.position.x.toFixed(2)}, ${p.position.y.toFixed(2)}, ${p.position.z.toFixed(2)}) speed=${p.currentSpeed.toFixed(2)} grounded=${p.grounded} maxY=${maxY.toFixed(2)}`
  );
  return p;
}

// yaw = -PI/2 faces +X
run('walk east 2s (expect x≈+8.6)', new THREE.Vector3(-5, 0, 0), -Math.PI / 2, 'KeyW', 2);
run('sprint east 2s (expect x≈13)', new THREE.Vector3(-9, 0, 0), -Math.PI / 2, 'KeyW', 2, () => keys.add('ShiftLeft'));
run('walk into wall (expect x≈4.66)', new THREE.Vector3(3, 0, 0), -Math.PI / 2, 'KeyW', 2);
run('strafe along wall (z moves)', new THREE.Vector3(4.66, 0, 0), -Math.PI / 2, 'KeyD', 1);
run('walk into cubicle (blocked ~9.46)', new THREE.Vector3(8, 0, 0), -Math.PI / 2, 'KeyW', 2);
run('jump in place (maxY≈0.85)', new THREE.Vector3(0, 0, 0), 0, 'None', 1.5, (f) => {
  if (f === 5) pressed.add('Space');
});
run('climb stairs north (y→1.65)', new THREE.Vector3(17, 0, -3), 0, 'KeyW', 3);
run('crouch walk (speed≈2.3)', new THREE.Vector3(0, 0, 0), -Math.PI / 2, 'KeyW', 2, () => keys.add('ControlLeft'));
run('stop: release key (speed→0)', new THREE.Vector3(0, 0, 0), -Math.PI / 2, 'KeyW', 2, (f) => {
  if (f > 60) keys.delete('KeyW');
});
