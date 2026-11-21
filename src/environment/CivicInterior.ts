import * as THREE from 'three';
import type { CarRig } from '../scenes/Level8Contracts';

/**
 * CivicInterior — the inside of Ravi's Civic, so from his seat it's a car
 * and not a glass box with a steering wheel in it: a padded dash with a
 * hood over the instruments (the speedo and rev counter live), a centre
 * stack with the radio and the vents, door cards with armrests and pulls,
 * a headliner and pillar trims, sun visors (his half down), the seats and
 * the rear bench, a console with the gear stick and the handbrake, a tint
 * band across the top of the windscreen, and a curry-bowl air freshener
 * hanging under the mirror on its strings, swinging with everything the car does.
 *
 * Car-local (the rig's group frame: forward −Z, the driver's side −X); it
 * hangs off the body so it rides the body's pitch and roll. Fixed to the
 * Civic's own cabin: windscreen from (±0.75, 0.89, −0.60) up to
 * (±0.66, 1.42, 0.24), belt line at about 0.92, roof at 1.43.
 */

const M = (color: number, rough = 0.85, metal = 0): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

const MAT = {
  pad: M(0x232528, 0.92),
  face: M(0x2d3034, 0.8),
  plastic: M(0x383b40, 0.7),
  dark: M(0x141517, 0.75),
  alu: M(0x9aa1a8, 0.35, 0.7),
  chrome: M(0xc9ced3, 0.2, 0.9),
  headliner: M(0x8f8a82, 1),
  fabric: M(0x3a3c40, 1),
  seat: M(0x2b2d31, 0.95),
  carpet: M(0x1d1e20, 1),
  visor: M(0x7f7a72, 1)
};

/** Points (forward, up) round a profile → a solid that profile drawn across the car from x0 to x1. */
function across(profile: [number, number][], x0: number, x1: number, mat: THREE.Material, bevel = 0.008): THREE.Mesh {
  const sh = new THREE.Shape();
  profile.forEach(([u, v], i) => (i ? sh.lineTo(u, v) : sh.moveTo(u, v)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: x1 - x0, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6 });
  // Shape-space x is forward (−Z in the car), the extrusion runs along +X
  g.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.x = x0;
  return m;
}

/** The freshener's cord down to the knot, and on to the bowl's middle (m). */
const KNOT = 0.075;
const HANG = 0.125;
const _q = new THREE.Quaternion();
const _t = new THREE.Quaternion();
const _tw = new THREE.Quaternion();
const _g = new THREE.Vector3();
const _a = new THREE.Vector3();
const _r = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);

function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

/** A canvas as a texture. */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** One dial: ticks every `step` from 0 to `max` over 270°, numbers every `label`, a red zone from `red`. */
function drawDial(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, max: number, step: number, label: number, red: number, title: string, scale = 1): void {
  g.fillStyle = '#0b0c0e';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#5d636b';
  g.lineWidth = 3;
  g.stroke();
  const ang = (v: number): number => ((225 - (v / max) * 270) * Math.PI) / 180;
  for (let v = 0; v <= max + 1e-6; v += step) {
    const a = ang(v);
    const major = Math.abs(v / label - Math.round(v / label)) < 1e-6;
    const r0 = r * (major ? 0.78 : 0.86);
    g.strokeStyle = v >= red ? '#ff4b3a' : '#eef3f0';
    g.lineWidth = major ? 3 : 1.5;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy - Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * r * 0.94, cy - Math.sin(a) * r * 0.94);
    g.stroke();
    if (major) {
      g.fillStyle = v >= red ? '#ff6a5a' : '#dfe9e4';
      g.font = `bold ${Math.round(r * 0.16)}px Arial`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(Math.round(v / scale)), cx + Math.cos(a) * r * 0.6, cy - Math.sin(a) * r * 0.6);
    }
  }
  g.fillStyle = '#8fd0ff';
  g.font = `${Math.round(r * 0.12)}px Arial`;
  g.textAlign = 'center';
  g.fillText(title, cx, cy + r * 0.42);
}

export class CivicInterior {
  private readonly group = new THREE.Group();
  private readonly speedNeedle: THREE.Object3D;
  private readonly revNeedle: THREE.Object3D;
  private readonly freshener: THREE.Object3D;
  /** The bowl as a weight on a string, in the cabin's frame: where it is from the pivot, how it's moving, how it's turning on the string. */
  private readonly bob = new THREE.Vector3(0, -HANG, 0);
  private readonly bobV = new THREE.Vector3();
  private readonly prevQ = new THREE.Quaternion();
  private hasPrevQ = false;
  private twist = 0;
  private twistV = 0;
  private swing = 0;
  private swingV = 0;
  private revs = 0;
  /** Where the rear-view mirror hangs (for CarMirrors), group frame. */
  static readonly MIRROR_AT: [number, number, number] = [-0.13, 1.27, 0.06];

  constructor(rig: CarRig) {
    const G = this.group;
    G.position.y = -rig.body.position.y;
    rig.body.add(G);

    // ---------------------------------------------------------------- the dash
    // Padded top from the windscreen's foot back to a rolled lip; the face drops away under it
    G.add(
      across(
        [
          [0.63, 0.885],
          [0.42, 0.952],
          [0.31, 0.972],
          [0.255, 0.958],
          [0.24, 0.9],
          [0.26, 0.64],
          [0.4, 0.44],
          [0.63, 0.44]
        ],
        -0.76,
        0.76,
        MAT.pad
      )
    );
    // A defrost grille along the foot of the windscreen
    for (let i = 0; i < 18; i++) G.add(box(0.06, 0.004, 0.012, -0.6 + i * 0.07, 0.93, -0.5, MAT.dark, -0.28));
    // A strip of brushed trim across the face, broken for the stack and the cluster
    G.add(box(0.36, 0.022, 0.012, 0.5, 0.82, -0.255, MAT.alu, 0.08));
    G.add(box(0.12, 0.022, 0.012, -0.69, 0.82, -0.255, MAT.alu, 0.08));

    // ---- The instrument hood over the cluster, in front of him
    const DX = -0.37;
    const hoodMat = MAT.pad.clone();
    hoodMat.side = THREE.DoubleSide;
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.21, 20, 1, true, -Math.PI / 2, Math.PI), hoodMat);
    hood.rotation.x = -Math.PI / 2;
    hood.scale.set(1, 1, 0.45);
    hood.position.set(DX, 0.925, -0.27);
    G.add(hood);
    // The cluster: two dials on one face, tipped up at his eyes
    const cluster = new THREE.Group();
    // Out in front of the pad's lip, so it's the dials he sees through the wheel and not the dash
    cluster.position.set(DX, 0.93, -0.2);
    cluster.rotation.x = -0.38;
    G.add(cluster);
    const tex = canvasTex(512, 256, (g) => {
      g.fillStyle = '#151619';
      g.fillRect(0, 0, 512, 256);
      drawDial(g, 128, 128, 112, 160, 10, 20, 999, 'MPH');
      drawDial(g, 384, 128, 112, 8, 0.5, 1, 6.5, 'x1000 RPM');
      // Warning lamps between them
      const lamp = (x: number, y: number, c: string): void => {
        g.fillStyle = c;
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.fill();
      };
      lamp(256, 60, '#3f6e38');
      lamp(256, 90, '#7a5a1c');
      lamp(256, 196, '#8a2a24');
      g.fillStyle = '#9fe3a6';
      g.font = 'bold 22px Courier New';
      g.textAlign = 'center';
      g.fillText('248314', 128, 205);
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.4 }));
    cluster.add(face);
    const needle = (x: number): THREE.Object3D => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, 0.004);
      const n = new THREE.Mesh(new THREE.BoxGeometry(0.0045, 0.062, 0.002), new THREE.MeshBasicMaterial({ color: 0xff5530 }));
      n.position.y = 0.026;
      pivot.add(n);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 12), MAT.dark);
      cap.rotation.x = Math.PI / 2;
      pivot.add(cap);
      cluster.add(pivot);
      return pivot;
    };
    this.speedNeedle = needle(-0.085);
    this.revNeedle = needle(0.085);
    // A glass over it, catching the light a little
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.18), new THREE.MeshStandardMaterial({ color: 0x0a0c10, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.5 }));
    cover.position.z = 0.012;
    cluster.add(cover);

    // ---- The centre stack: vents, the radio, the heater
    const stack = new THREE.Group();
    stack.position.set(0.0, 0.0, 0.0);
    G.add(stack);
    stack.add(box(0.27, 0.36, 0.06, 0.0, 0.72, -0.25, MAT.face, 0.12));
    for (const x of [-0.065, 0.065]) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 18), MAT.dark);
      v.rotation.x = Math.PI / 2 + 0.12;
      v.position.set(x, 0.85, -0.215);
      stack.add(v);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.006, 6, 20), MAT.alu);
      ring.position.set(x, 0.85, -0.2);
      ring.rotation.x = 0.12;
      stack.add(ring);
      for (let k = -2; k <= 2; k++) stack.add(box(0.07, 0.005, 0.01, x, 0.85 + k * 0.016, -0.2, MAT.plastic, 0.12));
    }
    const radio = canvasTex(256, 64, (g) => {
      g.fillStyle = '#041008';
      g.fillRect(0, 0, 256, 64);
      g.fillStyle = '#5dff8a';
      g.font = 'bold 30px Courier New';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('FM 101.9', 128, 34);
    });
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.038), new THREE.MeshBasicMaterial({ map: radio }));
    disp.position.set(0, 0.765, -0.212);
    disp.rotation.x = -0.12;
    stack.add(disp);
    for (const x of [-0.105, 0.105]) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.025, 14), MAT.alu);
      knob.rotation.x = Math.PI / 2 - 0.12;
      knob.position.set(x, 0.765, -0.208);
      stack.add(knob);
    }
    for (const x of [-0.07, 0, 0.07]) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.025, 16), MAT.dark);
      knob.rotation.x = Math.PI / 2 - 0.12;
      knob.position.set(x, 0.66, -0.2);
      stack.add(knob);
      stack.add(box(0.004, 0.02, 0.004, x, 0.672, -0.186, MAT.alu, -0.12));
    }
    // The outboard vents, each end of the dash
    for (const x of [-0.66, 0.66]) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), MAT.dark);
      v.rotation.x = Math.PI / 2;
      v.position.set(x, 0.86, -0.245);
      G.add(v);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.006, 6, 18), MAT.alu);
      ring.position.set(x, 0.86, -0.228);
      G.add(ring);
    }
    // Glovebox lid
    G.add(box(0.42, 0.14, 0.01, 0.42, 0.67, -0.27, MAT.plastic, 0.35));
    G.add(box(0.08, 0.012, 0.012, 0.42, 0.72, -0.257, MAT.chrome, 0.35));

    // ---------------------------------------------------------- the console
    G.add(box(0.2, 0.2, 0.86, 0.0, 0.42, 0.25, MAT.plastic));
    G.add(box(0.21, 0.04, 0.3, 0.0, 0.54, 0.55, MAT.fabric));
    // Gear stick in its gaiter, the handbrake beside it, a coffee in the holder
    const gaiter = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 10), MAT.dark);
    gaiter.position.set(0, 0.56, 0.0);
    G.add(gaiter);
    G.add(box(0.014, 0.16, 0.014, 0, 0.64, -0.01, MAT.dark, -0.15));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 10), MAT.alu);
    knob.position.set(0, 0.72, -0.024);
    G.add(knob);
    G.add(box(0.03, 0.03, 0.22, 0.05, 0.56, 0.25, MAT.dark, 0.25));
    G.add(box(0.034, 0.034, 0.06, 0.05, 0.585, 0.15, MAT.alu, 0.25));
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.12, 14), M(0xe8e2d6, 0.8));
    cup.position.set(-0.04, 0.59, 0.36);
    G.add(cup);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.012, 14), M(0x2a2a2a, 0.6));
    lid.position.set(-0.04, 0.655, 0.36);
    G.add(lid);

    // ------------------------------------------------------------ the doors
    for (const s of [-1, 1]) {
      const x = s * 0.79;
      // The card, the fabric insert, the armrest and its pull, the handle, a speaker low down
      G.add(box(0.04, 0.6, 1.3, x, 0.62, 0.08, MAT.plastic));
      G.add(box(0.012, 0.18, 0.8, x - s * 0.026, 0.72, 0.1, MAT.fabric));
      G.add(box(0.08, 0.05, 0.42, x - s * 0.05, 0.62, 0.18, MAT.face));
      G.add(box(0.03, 0.04, 0.12, x - s * 0.07, 0.66, 0.06, MAT.dark));
      G.add(box(0.012, 0.03, 0.09, x - s * 0.028, 0.8, -0.32, MAT.chrome));
      const spk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.012, 18), MAT.dark);
      spk.rotation.z = Math.PI / 2;
      spk.position.set(x - s * 0.024, 0.45, -0.35);
      G.add(spk);
      // The sill cap under the glass, rounding off the inside of the belt
      G.add(box(0.07, 0.025, 1.36, s * 0.78, 0.925, 0.1, MAT.pad));
      // A-pillar trim, glass foot to roof
      const a = new THREE.Vector3(s * 0.73, 0.9, -0.58);
      const b = new THREE.Vector3(s * 0.65, 1.41, 0.24);
      const len = a.distanceTo(b);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.085, len, 0.05), MAT.plastic);
      pillar.position.copy(a).add(b).multiplyScalar(0.5);
      pillar.lookAt(pillar.position.clone().add(b.clone().sub(a)));
      pillar.rotateX(Math.PI / 2);
      G.add(pillar);
      // Grab handle over the passenger's door
      if (s > 0) G.add(box(0.03, 0.025, 0.22, 0.68, 1.36, 0.55, MAT.plastic));
    }

    // ---------------------------------------------------------- the roof
    G.add(box(1.42, 0.02, 1.7, 0, 1.425, 1.08, MAT.headliner));
    // The header across the top of the windscreen
    G.add(box(1.36, 0.05, 0.1, 0, 1.4, 0.27, MAT.headliner));
    // Tint band along the top of the windscreen
    {
      const t0 = 0.8;
      const base = new THREE.Vector3(0, 0.89, -0.6);
      const top = new THREE.Vector3(0, 1.42, 0.24);
      const p0 = base.clone().lerp(top, t0);
      const band = new THREE.Mesh(
        new THREE.PlaneGeometry(1.36, top.distanceTo(p0)),
        new THREE.MeshBasicMaterial({ color: 0x0f2a33, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
      );
      band.position.copy(p0).add(top).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.006, 0.01));
      // Its up along the glass, foot to top
      band.rotation.x = Math.atan2(top.z - base.z, top.y - base.y);
      G.add(band);
    }
    // Sun visors: his up out of his eyes, the passenger's down
    for (const [x, down] of [[-0.37, 0.18], [0.37, 0.95]] as [number, number][]) {
      const hinge = new THREE.Group();
      hinge.position.set(x, 1.395, 0.22);
      hinge.rotation.x = -down;
      const v = box(0.36, 0.022, 0.17, 0, 0, -0.085, MAT.visor);
      hinge.add(v);
      hinge.add(box(0.36, 0.012, 0.012, 0, 0.012, -0.002, MAT.plastic));
      G.add(hinge);
    }

    // ------------------------------------------------------------ the seats
    for (const x of [-0.37, 0.37]) {
      G.add(box(0.5, 0.13, 0.52, x, 0.42, 0.4, MAT.seat, -0.05));
      // His own seat back is right behind his head: looking round, it'd be all he saw. Only the passenger's
      if (x < 0) continue;
      G.add(box(0.5, 0.66, 0.13, x, 0.82, 0.74, MAT.seat, -0.2));
      G.add(box(0.27, 0.2, 0.11, x, 1.24, 0.84, MAT.seat, -0.15));
      G.add(box(0.05, 0.08, 0.02, x - 0.07, 1.12, 0.82, MAT.chrome));
      G.add(box(0.05, 0.08, 0.02, x + 0.07, 1.12, 0.82, MAT.chrome));
    }
    G.add(box(1.36, 0.14, 0.5, 0, 0.42, 1.28, MAT.seat));
    G.add(box(1.36, 0.58, 0.12, 0, 0.78, 1.62, MAT.seat, -0.22));
    // Carpet
    G.add(box(1.5, 0.02, 2.4, 0, 0.21, 0.6, MAT.carpet));

    // ----------------------------------------------------- the air freshener
    // A little bowl of curry on a cord off the mirror: rice heaped on one side, the curry glossy
    // round it with its chunks, a sprig of coriander, a wedge of naan; hung like a planter on three
    // strings from a knot, the knot on one cord up to the mirror
    const pivot = new THREE.Group();
    const [mx, my, mz] = CivicInterior.MIRROR_AT;
    pivot.position.set(mx, my - 0.04, mz + 0.01);
    const hang = new THREE.Group();
    pivot.add(hang);
    const cord = (a: THREE.Vector3, b: THREE.Vector3): THREE.Mesh => {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, len, 4), MAT.dark);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      return m;
    };
    const knot = new THREE.Vector3(0, -KNOT, 0);
    hang.add(cord(new THREE.Vector3(), knot));
    const bowl = new THREE.Group();
    bowl.position.y = -HANG;
    hang.add(bowl);
    const R = 0.034;
    // The bowl: glazed, white inside, a terracotta band round the outside
    const prof = [
      new THREE.Vector2(0.0, -0.016),
      new THREE.Vector2(0.017, -0.016),
      new THREE.Vector2(0.018, -0.013),
      new THREE.Vector2(0.026, -0.008),
      new THREE.Vector2(0.032, 0.003),
      new THREE.Vector2(R, 0.012),
      new THREE.Vector2(R - 0.003, 0.012),
      new THREE.Vector2(0.029, 0.003),
      new THREE.Vector2(0.022, -0.007),
      new THREE.Vector2(0.0, -0.011)
    ];
    bowl.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 20), new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: 0.35, side: THREE.DoubleSide })));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0325, 0.029, 0.006, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xb4532a, roughness: 0.5, side: THREE.DoubleSide }));
    bowl.add(band);
    // The curry, near the brim
    const curry = new THREE.Mesh(new THREE.CircleGeometry(0.0295, 20), new THREE.MeshStandardMaterial({ color: 0xc8641e, roughness: 0.25 }));
    curry.rotation.x = -Math.PI / 2;
    curry.position.y = 0.0085;
    bowl.add(curry);
    // Chunks in it
    const chunkMat = new THREE.MeshStandardMaterial({ color: 0x8a3e14, roughness: 0.6 });
    const potato = new THREE.MeshStandardMaterial({ color: 0xe2b24a, roughness: 0.7 });
    for (const [x, z, s, mat] of [[0.012, 0.01, 0.007, chunkMat], [-0.004, 0.018, 0.006, potato], [0.018, -0.006, 0.006, chunkMat], [0.006, -0.016, 0.005, potato], [-0.01, -0.012, 0.0055, chunkMat]] as [number, number, number, THREE.Material][]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.7, s), mat);
      c.position.set(x, 0.0095, z);
      c.rotation.set(0.3, x * 90, 0.2);
      bowl.add(c);
    }
    // The rice, heaped up on one side
    const rice = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfbf8ef, roughness: 0.9 }));
    rice.scale.set(1, 0.55, 0.9);
    rice.position.set(-0.012, 0.01, 0.002);
    bowl.add(rice);
    // Coriander on top, and a wedge of naan stuck in at the back
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f8f3a, roughness: 0.8, side: THREE.DoubleSide });
    for (const [x, z, a] of [[0.004, 0.004, 0.4], [0.008, 0.0, 1.6], [0.002, -0.004, 2.7]] as [number, number, number][]) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 6), leafMat);
      l.rotation.set(-Math.PI / 2 + 0.3, 0, a);
      l.position.set(x, 0.0125, z);
      bowl.add(l);
    }
    const naan = new THREE.Mesh(new THREE.CircleGeometry(0.02, 3, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0xd9a962, roughness: 0.85, side: THREE.DoubleSide }));
    naan.rotation.set(-0.35, 0.4, 0);
    naan.position.set(0.004, 0.006, 0.02);
    bowl.add(naan);
    // The three strings from the knot down to the rim
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      hang.add(cord(knot, new THREE.Vector3(Math.cos(a) * (R - 0.001), -HANG + 0.012, Math.sin(a) * (R - 0.001))));
    }
    G.add(pivot);
    this.freshener = hang;

    G.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });
  }

  /**
   * Each frame: the needles to the speed and the revs, the freshener swinging
   * with the car. `carQ`/`carAcc` (the car's turn and its acceleration, world):
   * the bowl swings on its cord as a weight would, pushed about by every
   * lurch, the cabin turning round it, spun on the cord as it goes.
   */
  update(dt: number, speed: number, throttle: number, lateral: number, carQ?: THREE.Quaternion, carAcc?: THREE.Vector3): void {
    const mph = Math.abs(speed) * 2.237;
    const toA = (k: number): number => THREE.MathUtils.degToRad(135 - Math.min(1, k) * 270);
    this.speedNeedle.rotation.z = toA(mph / 160);
    // Revs: climbing through the gears with the speed, up with the throttle
    const gearSpan = 14;
    const inGear = (Math.abs(speed) % gearSpan) / gearSpan;
    const want = Math.abs(speed) < 1 ? 0.11 + 0.1 * Math.max(0, throttle) : 0.28 + 0.48 * inGear + 0.12 * Math.max(0, throttle);
    this.revs += (want - this.revs) * Math.min(1, dt * 8);
    this.revNeedle.rotation.z = toA(this.revs);
    if (!carQ || !carAcc || !(dt > 0)) {
      // (no car's motion to go on: the old sideways nudge)
      const acc = -lateral * 0.06 - this.swing * 26 - this.swingV * 1.6;
      this.swingV += acc * dt;
      this.swing += this.swingV * dt;
      this.freshener.rotation.set(0, 0, this.swing);
      return;
    }
    // A weight on a cord in the cabin's frame: the pull it feels is gravity less the car's own acceleration,
    // turned into the car's frame; and as the car turns, the cabin turns round it
    const inv = _q.copy(carQ).invert();
    if (!this.hasPrevQ) {
      this.prevQ.copy(carQ);
      this.hasPrevQ = true;
    }
    const turn = _t.copy(inv).multiply(this.prevQ);
    this.prevQ.copy(carQ);
    this.bob.applyQuaternion(turn);
    this.bobV.applyQuaternion(turn);
    const g = _g.set(0, -9.8, 0).sub(_a.copy(carAcc).clampLength(0, 60)).applyQuaternion(inv);
    // Substeps: a short cord is a quick pendulum, and a crash is a big shove
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.bobV.addScaledVector(g, h);
      // Air and the cord's own stiffness: it keeps swinging a good while
      this.bobV.multiplyScalar(Math.exp(-h * 0.9));
      this.bob.addScaledVector(this.bobV, h);
      // On its cord: back to the cord's length, and no speed along it
      this.bob.setLength(HANG);
      const r = _r.copy(this.bob).normalize();
      this.bobV.addScaledVector(r, -this.bobV.dot(r));
      // Not up through the mirror and the roof: it can swing a long way, not right over the top
      if (this.bob.y > -HANG * 0.05) {
        this.bob.y = -HANG * 0.05;
        this.bob.setLength(HANG);
        if (this.bobV.y > 0) this.bobV.y *= -0.3;
      }
    }
    // Spun on the cord by the swinging, and unwinding again
    const sideways = this.bobV.x * this.bob.z - this.bobV.z * this.bob.x;
    this.twistV += (sideways * 900 - this.twist * 6 - this.twistV * 1.2) * dt;
    this.twist += this.twistV * dt;
    // The cord along the bob, the bowl hanging off it, turned by the twist
    this.freshener.quaternion.setFromUnitVectors(_down, _r.copy(this.bob).normalize()).multiply(_tw.setFromAxisAngle(_up, this.twist));
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
