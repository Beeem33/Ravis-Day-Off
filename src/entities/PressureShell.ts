import * as THREE from 'three';
import { grip, type Grip } from './RaviVisual';

/**
 * A QB-4 pressure shell, the quad-barrel's round, with how to work the gun
 * printed down its side: the one he picks out of the crate's foam and reads
 * before he lifts the gun out.
 *
 * Shell-local metres: its axis along X, the brass head at +X, the printing
 * facing +Z (read left to right, head on the right). Fat for a shell: it's
 * the Collective's own, and it has to be read from a hand's length off.
 */

export const SHELL = { R: 0.0138, X0: -0.052, X1: 0.034, HEAD: 0.02 };

/** The printing, as lines (the first one the heading). */
export const SHELL_TEXT = [
  'QB-4 PRESSURE · 12 GA',
  'LEFT CLICK — FIRE ALL FOUR BARRELS',
  'RIGHT CLICK — PRESSURE BLAST:',
  'KICKS YOU BACK, HITS WHAT\'S IN FRONT',
  'AIM AT THE FLOOR + BLAST = FLY UP',
  'GAUGE: 3 CHARGES · REFILLS ITSELF'
];

/**
 * His right hand on it: up from below and to the right, fingers and thumb
 * round the brass head only, so the printing is all clear.
 */
export const SHELL_GRIP: Grip = grip([0.1, -0.07, 0.02], [-0.55, 0.75, -0.3], [-0.6, 0.3, -0.7], [0.4, -0.6, 0.7], {
  fingers: [[45, 50, 30], [70, 80, 50], [80, 85, 55], [85, 88, 58]],
  thumb: [0.5, 0.3, 0.2],
  spread: 2
});

function labelCanvas(lines: string[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 400;
  const g = c.getContext('2d')!;
  // The hull's own red, printed on in cream; a brass-coloured rule under the heading
  g.fillStyle = '#9e1c16';
  g.fillRect(0, 0, c.width, c.height);
  const grain = g.createLinearGradient(0, 0, 0, c.height);
  grain.addColorStop(0, 'rgba(0,0,0,0.25)');
  grain.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  grain.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = grain;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#f3e6c8';
  g.textBaseline = 'middle';
  g.font = 'bold 58px "Arial Narrow", Arial, sans-serif';
  g.fillText(lines[0], 26, 52);
  g.fillStyle = '#d8b25a';
  g.fillRect(26, 92, c.width - 52, 5);
  g.fillStyle = '#f3e6c8';
  g.font = 'bold 40px "Arial Narrow", Arial, sans-serif';
  lines.slice(1).forEach((l, i) => g.fillText(l, 26, 136 + i * 58));
  return c;
}

/** The shell itself: the red hull with its printing, the brass head and rim, the crimped mouth. */
export function pressureShell(): THREE.Group {
  const { R, X0, X1, HEAD } = SHELL;
  const group = new THREE.Group();
  group.name = 'pressureShell';
  const hull = new THREE.MeshStandardMaterial({ color: 0x9e1c16, roughness: 0.42, metalness: 0.05 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd8a84a, roughness: 0.25, metalness: 0.9 });
  const len = X1 - X0;
  // The hull: a tube along X
  const body = new THREE.CylinderGeometry(R, R, len, 32, 1, true);
  body.rotateZ(Math.PI / 2);
  body.translate((X0 + X1) / 2, 0, 0);
  group.add(new THREE.Mesh(body, hull));
  // The printing: the front of the hull (round ±80° from +Z), its own patch with the text running down the length
  {
    const tex = new THREE.CanvasTexture(labelCanvas(SHELL_TEXT));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    // (only as far round as shows from the front: none of it lost round the underside)
    const A = (62 * Math.PI) / 180;
    const NU = 2;
    const NV = 20;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const r = R + 0.0003;
    const xa = X0 + 0.004;
    const xb = X1 - 0.002;
    for (let j = 0; j <= NV; j++) {
      // From the top of the arc down (the first line of the text is the uppermost)
      const a = A - (j / NV) * 2 * A;
      for (let i = 0; i <= NU; i++) {
        const x = xa + (i / NU) * (xb - xa);
        pos.push(x, Math.sin(a) * r, Math.cos(a) * r);
        uv.push(i / NU, 1 - j / NV);
      }
    }
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NU; i++) {
        const a = j * (NU + 1) + i;
        const b = a + NU + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.02 })));
  }
  // The brass head, its rim, the primer
  const head = new THREE.CylinderGeometry(R + 0.0006, R + 0.0006, HEAD, 32);
  head.rotateZ(Math.PI / 2);
  head.translate(X1 + HEAD / 2, 0, 0);
  group.add(new THREE.Mesh(head, brass));
  const rim = new THREE.CylinderGeometry(R + 0.0018, R + 0.0018, 0.0026, 32);
  rim.rotateZ(Math.PI / 2);
  rim.translate(X1 + HEAD - 0.0013, 0, 0);
  group.add(new THREE.Mesh(rim, brass));
  const primer = new THREE.CircleGeometry(0.0042, 16);
  primer.rotateY(Math.PI / 2);
  primer.translate(X1 + HEAD + 0.0002, 0, 0);
  group.add(new THREE.Mesh(primer, new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.3, metalness: 0.95 })));
  // The crimped mouth: a shallow dished star at the hull's open end
  const crimp = new THREE.CircleGeometry(R, 12);
  const cp = crimp.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) {
    const y = cp.getX(i);
    const z = cp.getY(i);
    const d = Math.hypot(y, z) / R;
    const a = Math.atan2(z, y);
    cp.setXYZ(i, 0.003 * d * d - 0.004 + Math.max(0, Math.cos(a * 6)) * 0.0012 * d, y, z);
  }
  crimp.rotateY(0);
  crimp.translate(X0, 0, 0);
  crimp.computeVertexNormals();
  const crimpM = new THREE.Mesh(crimp, new THREE.MeshStandardMaterial({ color: 0x7a1410, roughness: 0.6, side: THREE.DoubleSide }));
  group.add(crimpM);
  group.traverse((o) => {
    o.frustumCulled = false;
  });
  return group;
}
