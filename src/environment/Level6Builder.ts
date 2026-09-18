import * as THREE from 'three';
import type { BreakableGlass } from './BreakableGlass';
import { Collider, Waypoint, noiseCanvas, makeTex } from './OfficeLevelBuilder';
import { deskMonitor, deskPhone, namePlate, paperStack, fileCabinet, flowerPot, trashCan, book } from './OfficeProps';
import { mergeStatic } from './mergeStatic';
import { RaviVisual, type HandShape } from '../entities/RaviVisual';

export interface Level6Data {
  group: THREE.Group;
  colliders: Collider[];
  shootables: THREE.Object3D[];
  glassPanes: BreakableGlass[];
  occluders: THREE.Object3D[];
  waypoints: Waypoint[];
  /** Ravi's chair: where his feet are while he is tied into it, facing −z. */
  chairAt: THREE.Vector3;
  /** His wrists on the chair's arms, and the rope round each. */
  wristR: THREE.Vector3;
  wristL: THREE.Vector3;
  ropeR: THREE.Object3D;
  ropeL: THREE.Object3D;
  /** His own forearms, lying tied along the chair's arms until each is freed. */
  tiedR: THREE.Object3D;
  tiedL: THREE.Object3D;
  /** The rest of Ravi, sat in the chair — until he gets up out of it. */
  raviSat: THREE.Object3D;
  /** The boss, sat behind the desk facing Ravi. */
  bossAt: THREE.Vector3;
  /** The two agents either side of him: [his left, his right]. */
  agentAt: [THREE.Vector3, THREE.Vector3];
  /** The desk: its back edge (the boss's side), its front, and its top. */
  desk: { backZ: number; frontZ: number; topY: number; halfW: number };
  /** The big picture over him, waiting for its photograph. */
  photo: THREE.MeshStandardMaterial;
  photoMesh: THREE.Mesh;
  /** Where the photographer stands for it. */
  photoCam: { from: THREE.Vector3; to: THREE.Vector3; fov: number; aspect: number };
  /** The bulb over the desk. */
  bulb: THREE.PointLight;
  /** The vent behind the desk: its cover, in place and where it ends up. */
  ventCover: THREE.Group;
  ventCoverOff: { pos: THREE.Vector3; rot: THREE.Euler };
  ventMouth: THREE.Vector3;
  /** The boss's chair and its collider, both shoved aside when he goes. */
  bossChair: THREE.Group;
  bossChairCollider: Collider;
  bossChairShoved: { pos: THREE.Vector3; yaw: number };
  /** Round the back of the desk, where the vent can be seen. */
  behindDesk: THREE.Box3;
}

const T = 0.24;
/** His hands tied at the wrist, hanging slack over the ends of the chair's arms. */
const TIED_HAND: HandShape = { fingers: [[40, 35, 18], [42, 38, 18], [45, 40, 20], [48, 42, 22]], thumb: [0.25, 0.2, 0.15] };
/** Inside faces of the room: a single office, for somebody important. */
const R = { x0: -2.5, x1: 2.5, z0: -3.0, z1: 3.0, h: 2.8 };
/** The desk, wide and dark, its back edge towards the boss. */
const DESK = { cx: 0, cz: -1.55, w: 1.9, d: 0.85, top: 0.76 };
const DESK_BACK = DESK.cz - DESK.d / 2;
const DESK_FRONT = DESK.cz + DESK.d / 2;
/** The boss sits this far behind the desk's back edge — close enough to lean his elbows on it. */
const BOSS_BACK = 0.17;
/** The vent in the back wall, behind his chair. */
const VENT = { cx: 0, w: 0.62, h: 0.44, y0: 0.05 };

/**
 * Level6Builder — the boss's office. One room, concrete, no windows: a single
 * office sized for someone important, lit by one bare orange bulb hanging over
 * his desk.
 *
 * Ravi's chair is at the door end facing the desk. The boss's chair is behind
 * it with its back to the wall, and behind that, low in the wall and hidden
 * from the front by the chair and the desk, is the vent he leaves by.
 */
export class Level6Builder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private dressing: THREE.Object3D[] = [];

  private wallMat!: THREE.MeshLambertMaterial;
  private floorMat!: THREE.MeshLambertMaterial;
  private ceilMat!: THREE.MeshLambertMaterial;
  private woodMat!: THREE.MeshLambertMaterial;
  private woodDark!: THREE.MeshLambertMaterial;
  private brass!: THREE.MeshStandardMaterial;
  private steel!: THREE.MeshStandardMaterial;
  private rope!: THREE.MeshLambertMaterial;
  private leather!: THREE.MeshStandardMaterial;

  build(): Level6Data {
    this.makeMaterials();
    this.buildShell();
    const desk = this.buildDesk();
    const chair = this.buildRavisChair();
    const bossChair = this.buildBossChair();
    const photo = this.buildPicture();
    const bulb = this.buildBulb();
    const vent = this.buildVent();
    this.dressRoom();
    this.buildLighting();
    this.shootables = mergeStatic(this.group, this.dressing, this.shootables);

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      glassPanes: [],
      occluders: this.occluders,
      waypoints: this.makeWaypoints(),
      chairAt: chair.at,
      wristR: chair.wristR,
      wristL: chair.wristL,
      ropeR: chair.ropeR,
      ropeL: chair.ropeL,
      tiedR: chair.tiedR,
      tiedL: chair.tiedL,
      raviSat: chair.body,
      bossAt: new THREE.Vector3(DESK.cx, 0, DESK_BACK - BOSS_BACK),
      agentAt: [new THREE.Vector3(1.28, 0, -2.12), new THREE.Vector3(-1.28, 0, -2.12)],
      desk,
      photo: photo.mat,
      photoMesh: photo.mesh,
      photoCam: {
        from: new THREE.Vector3(0.03, 1.33, DESK_FRONT + 0.1),
        to: new THREE.Vector3(0, 1.16, DESK_BACK - BOSS_BACK - 0.05),
        fov: 38,
        aspect: 4 / 3
      },
      bulb,
      ventCover: vent.cover,
      ventCoverOff: vent.coverOff,
      ventMouth: vent.mouth,
      bossChair: bossChair.group,
      bossChairCollider: bossChair.collider,
      bossChairShoved: { pos: new THREE.Vector3(-0.72, 0, DESK_BACK - 0.5), yaw: Math.PI + 0.9 },
      behindDesk: new THREE.Box3(new THREE.Vector3(-1.2, -0.1, R.z0), new THREE.Vector3(1.2, 2, DESK_BACK - 0.05))
    };
  }

  // ------------------------------------------------------------- materials

  private makeMaterials(): void {
    this.wallMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([118, 116, 112], 16), 4, 2) });
    this.floorMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([78, 75, 72], 14), 5, 6) });
    this.ceilMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([92, 90, 88], 12), 4, 4) });
    this.woodMat = new THREE.MeshLambertMaterial({ color: 0x4a2e1c });
    this.woodDark = new THREE.MeshLambertMaterial({ color: 0x2e1c11 });
    this.brass = new THREE.MeshStandardMaterial({ color: 0xb8912f, roughness: 0.35, metalness: 0.8 });
    this.steel = new THREE.MeshStandardMaterial({ color: 0x5c6167, roughness: 0.45, metalness: 0.6 });
    this.rope = new THREE.MeshLambertMaterial({ color: 0x9a7b4f });
    this.leather = new THREE.MeshStandardMaterial({ color: 0x2a1712, roughness: 0.55, metalness: 0.05 });
  }

  // --------------------------------------------------------------- helpers

  /** Solid box: mesh, collider and bullet target. `y` is the base. */
  private solid(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    opts: { collide?: boolean; occlude?: boolean; surface?: string } = {}
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.userData.surface = opts.surface ?? 'concrete';
    this.group.add(mesh);
    this.shootables.push(mesh);
    if (opts.occlude) this.occluders.push(mesh);
    if (opts.collide !== false) {
      this.colliders.push({
        box: new THREE.Box3(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y + h, z + d / 2))
      });
    }
    return mesh;
  }

  /** Drop a prop, to be folded into the merged dressing. */
  private put(o: THREE.Object3D, x: number, z: number, yaw = 0, y = 0): THREE.Object3D {
    o.position.set(x, y, z);
    o.rotation.y = yaw;
    this.group.add(o);
    this.dressing.push(o);
    return o;
  }

  private blk(x: number, z: number, w: number, d: number, h: number): Collider {
    const c: Collider = {
      box: new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, h, z + d / 2))
    };
    this.colliders.push(c);
    return c;
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  // ----------------------------------------------------------------- shell

  /** Four concrete walls, a slab floor and ceiling, and a steel door kept shut. */
  private buildShell(): void {
    const { x0, x1, z0, z1, h } = R;
    const W = x1 - x0 + 2 * T;
    const D = z1 - z0 + 2 * T;
    this.solid(W, 0.3, D, 0, -0.3, (z0 + z1) / 2, this.floorMat);
    this.solid(W, 0.3, D, 0, h, (z0 + z1) / 2, this.ceilMat);
    this.solid(T, h, D, x0 - T / 2, 0, (z0 + z1) / 2, this.wallMat, { occlude: true });
    this.solid(T, h, D, x1 + T / 2, 0, (z0 + z1) / 2, this.wallMat, { occlude: true });
    this.solid(W, h, T, 0, 0, z1 + T / 2, this.wallMat, { occlude: true });
    // The back wall is built round the vent's mouth
    const vx0 = VENT.cx - VENT.w / 2;
    const vx1 = VENT.cx + VENT.w / 2;
    const bz = z0 - T / 2;
    this.solid(vx0 - (x0 - T), h, T, (x0 - T + vx0) / 2, 0, bz, this.wallMat, { occlude: true });
    this.solid(x1 + T - vx1, h, T, (x1 + T + vx1) / 2, 0, bz, this.wallMat, { occlude: true });
    this.solid(VENT.w, h - (VENT.y0 + VENT.h), T, VENT.cx, VENT.y0 + VENT.h, bz, this.wallMat, { occlude: true });
    this.solid(VENT.w, VENT.y0, T, VENT.cx, 0, bz, this.wallMat);

    // A skirting line of darker concrete, and a rug where the important
    // person keeps his feet
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 2.3),
      new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([96, 22, 24], 10), 3, 3) })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.004, DESK.cz - 0.5);
    this.group.add(rug);
    const border = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.4), new THREE.MeshLambertMaterial({ color: 0x5a3a12 }));
    border.rotation.x = -Math.PI / 2;
    border.position.set(0, 0.003, DESK.cz - 0.5);
    this.group.add(border);

    // The way in, shut and staying shut
    const dz = 1.55;
    const door = this.box(0.05, 2.08, 0.96, this.steel, x1 - 0.03, 1.04, dz);
    this.put(door, 0, 0);
    door.position.set(x1 - 0.03, 1.04, dz);
    const frame = new THREE.Group();
    frame.add(this.box(0.07, 2.18, 0.06, this.steel, 0, 1.09, -0.51));
    frame.add(this.box(0.07, 2.18, 0.06, this.steel, 0, 1.09, 0.51));
    frame.add(this.box(0.07, 0.06, 1.08, this.steel, 0, 2.15, 0));
    frame.add(this.box(0.06, 0.03, 0.14, this.brass, -0.04, 1.02, -0.36));
    frame.add(this.box(0.06, 0.26, 0.2, new THREE.MeshLambertMaterial({ color: 0x15181b }), -0.01, 1.62, 0));
    this.put(frame, x1 - 0.03, dz);
  }

  // ------------------------------------------------------------------ desk

  /**
   * An executive desk: a dark top with a leather writing pad, a front panel
   * down to the floor on the visitor's side, and a pedestal of drawers at
   * each end, knee space between them.
   */
  private buildDesk(): { backZ: number; frontZ: number; topY: number; halfW: number } {
    const { cx, cz, w, d, top } = DESK;
    // The top and the front panel are real: they stop bullets and block sight
    this.solid(w, 0.05, d, cx, top - 0.05, cz, this.woodMat, { collide: false, surface: 'wood' });
    this.solid(w - 0.06, top - 0.13, 0.04, cx, 0.08, DESK_FRONT - 0.03, this.woodDark, {
      collide: false,
      occlude: true,
      surface: 'wood'
    });
    for (const s of [-1, 1]) {
      this.solid(0.46, top - 0.06, d - 0.06, cx + s * (w / 2 - 0.26), 0.01, cz, this.woodMat, {
        collide: false,
        surface: 'wood'
      });
    }
    this.blk(cx, cz, w, d, top);
    const g = new THREE.Group();
    // Trim under the top edge, and a plinth
    g.add(this.box(w + 0.02, 0.03, d + 0.02, this.woodDark, 0, top - 0.065, 0));
    g.add(this.box(w - 0.1, 0.08, 0.05, this.woodDark, 0, 0.04, d / 2 - 0.05));
    // Drawers on the boss's side, brass pulls
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const y = 0.16 + i * 0.2;
        g.add(this.box(0.4, 0.17, 0.012, this.woodDark, s * (w / 2 - 0.26), y, -d / 2 + 0.024));
        g.add(this.box(0.12, 0.018, 0.02, this.brass, s * (w / 2 - 0.26), y + 0.03, -d / 2 + 0.01));
      }
    }
    // The leather pad his elbows go on
    g.add(this.box(0.96, 0.006, 0.46, new THREE.MeshLambertMaterial({ color: 0x1d3325 }), 0, top + 0.003, -0.13));
    this.put(g, cx, cz);
    return { backZ: DESK_BACK, frontZ: DESK_FRONT, topY: top, halfW: w / 2 };
  }

  /**
   * Everything on the desk. The computer is off to his left, turned in to
   * him; the phone to his right; a nameplate facing whoever is sat opposite;
   * and a stack of money that did not come from the call floor.
   */
  private dressDesk(): void {
    const y = DESK.top;
    const back = DESK_BACK;
    // His left is +x: he faces +z
    // Far enough forward that its keyboard, on his side of it, is still on the desk
    this.put(deskMonitor(), 0.6, back + 0.42, Math.PI + 0.4, y);
    this.put(deskPhone(), -0.66, back + 0.28, Math.PI - 0.35, y);
    this.put(namePlate('THE BOSS', 'CHIEF EXECUTIVE'), -0.12, DESK_FRONT - 0.1, 0, y);
    this.put(paperStack(9, 0.03), -0.46, back + 0.55, 0.2, y);
    this.put(paperStack(4, 0.05), 0.2, back + 0.6, -0.5, y);
    // The payoff: bundled notes, some still banded
    const cash = new THREE.Group();
    const note = new THREE.MeshLambertMaterial({ color: 0x5d7a4c });
    const band = new THREE.MeshLambertMaterial({ color: 0xe3d7b4 });
    let n = 0;
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 3 - row; i++) {
        const b = this.box(0.16, 0.03, 0.07, note, i * 0.17 - 0.17 + row * 0.085, 0.015 + row * 0.03, 0);
        b.rotation.y = (n++ % 2) * 0.06 - 0.03;
        cash.add(b);
        cash.add(this.box(0.03, 0.032, 0.072, band, b.position.x, b.position.y, 0));
      }
    }
    this.put(cash, 0.42, back + 0.52, 0.25, y);
    // Ashtray and a cigar laid across it, still going
    const tray = new THREE.Group();
    tray.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.025, 16), new THREE.MeshLambertMaterial({ color: 0x3a3f45 })));
    tray.children[0].position.y = 0.0125;
    const cigar = this.box(0.13, 0.018, 0.018, new THREE.MeshLambertMaterial({ color: 0x4a2c16 }), 0.03, 0.03, 0);
    tray.add(cigar);
    tray.add(this.box(0.008, 0.016, 0.016, new THREE.MeshStandardMaterial({ color: 0x3a0c04, emissive: 0xff5a14, emissiveIntensity: 1.2 }), 0.098, 0.03, 0));
    this.put(tray, -0.8, DESK_FRONT - 0.2, 0.3, y);
    // Mug
    const mug = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.04, 0.1, 14), new THREE.MeshLambertMaterial({ color: 0x8c1d1d }));
    m.position.y = 0.05;
    mug.add(m);
    this.put(mug, -0.52, back + 0.16, 0, y);
    this.put(book('scamming'), 0.78, DESK_FRONT - 0.22, 0.4, y);
  }

  // ------------------------------------------------------------- the chairs

  /**
   * Ravi's: a plain wooden chair with arms, its back to the door, facing
   * the desk. A loop of rope round each arm where his wrists are tied, and
   * more round the back and the front legs.
   */
  private buildRavisChair(): {
    at: THREE.Vector3;
    wristR: THREE.Vector3;
    wristL: THREE.Vector3;
    ropeR: THREE.Object3D;
    ropeL: THREE.Object3D;
    tiedR: THREE.Object3D;
    tiedL: THREE.Object3D;
    body: THREE.Object3D;
  } {
    const at = new THREE.Vector3(0, 0, 2.0);
    const g = new THREE.Group();
    const seatY = 0.46;
    g.add(this.box(0.48, 0.05, 0.46, this.woodMat, 0, seatY - 0.025, 0));
    for (const [x, z] of [[-0.21, -0.2], [0.21, -0.2], [-0.21, 0.2], [0.21, 0.2]]) {
      g.add(this.box(0.045, seatY - 0.05, 0.045, this.woodDark, x, (seatY - 0.05) / 2, z));
    }
    // Back: two posts and slats; he faces -z, so the back is at +z
    for (const x of [-0.21, 0.21]) g.add(this.box(0.05, 0.58, 0.05, this.woodDark, x, seatY + 0.29, 0.21));
    for (const y of [0.64, 0.8, 0.96]) g.add(this.box(0.44, 0.06, 0.03, this.woodMat, 0, y, 0.215));
    // Arms
    for (const s of [-1, 1]) {
      g.add(this.box(0.06, 0.035, 0.44, this.woodMat, s * 0.25, 0.66, -0.01));
      g.add(this.box(0.04, 0.2, 0.04, this.woodDark, s * 0.25, 0.555, -0.19));
    }
    // Rope round the back and the front legs: he was tied in for good
    const coil = (x: number, y: number, z: number, r: number, rot: THREE.Euler): void => {
      for (let i = 0; i < 3; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.009, 6, 18), this.rope);
        t.position.set(x, y + (i - 1) * 0.022, z);
        t.rotation.copy(rot);
        g.add(t);
      }
    };
    coil(0, 0.8, 0.215, 0.04, new THREE.Euler(0, Math.PI / 2, 0));
    coil(-0.21, 0.14, -0.2, 0.035, new THREE.Euler(Math.PI / 2, 0, 0));
    coil(0.21, 0.14, -0.2, 0.035, new THREE.Euler(Math.PI / 2, 0, 0));
    this.put(g, at.x, at.z);
    this.blk(at.x, at.z, 0.56, 0.52, 0.5);

    // The wrist ropes are their own objects: they come off one at a time.
    // Each turn goes round the chair arm and his wrist on top of it together,
    // so it is oval — taller than wide — and clears both: chair arm y 0.643
    // to 0.678, his forearm 0.681 to 0.739, the loop's inside 0.638 to 0.743.
    const wrist = (s: number): THREE.Group => {
      const w = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 6, 18), this.rope);
        t.position.set(0, 0, (i - 1.5) * 0.024);
        t.scale.y = 1.28;
        w.add(t);
      }
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), this.rope);
      knot.position.set(s * 0.053, -0.02, 0);
      w.add(knot);
      w.position.set(at.x + s * 0.25, 0.6905, at.z - 0.1);
      this.group.add(w);
      return w;
    };
    // His forearms along the chair's arms, wrists in the rope, hands hanging
    // over the ends. The scene swaps each for his own free hand as it comes loose.
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5c3b, roughness: 0.8 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4d6f9c, roughness: 0.9 });
    const tied = (s: number): THREE.Group => {
      const a = new THREE.Group();
      a.add(this.box(0.062, 0.058, 0.34, skin, 0, 0.71, 0.08));
      a.add(this.box(0.084, 0.082, 0.12, sleeve, 0, 0.715, 0.2));
      const hand = this.box(0.085, 0.03, 0.1, skin, 0, 0.705, -0.14);
      hand.rotation.x = -0.35;
      a.add(hand);
      for (let i = 0; i < 4; i++) {
        const f = this.box(0.017, 0.017, 0.05, skin, -0.031 + i * 0.0205, 0.672, -0.2);
        f.rotation.x = -1.0;
        a.add(f);
      }
      // Upper arm, from the elbow at the back of the chair arm up to his
      // shoulder — which is a little in front of it, his back being against
      // the chair and his eye at 1.18 over the seat
      const elbow = new THREE.Vector3(0, 0.715, 0.25);
      const shoulder = new THREE.Vector3(-s * 0.05, 0.88, 0.11);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.084, elbow.distanceTo(shoulder) + 0.04), sleeve);
      upper.position.copy(elbow).lerp(shoulder, 0.5);
      upper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), shoulder.clone().sub(elbow).normalize());
      a.add(upper);
      a.position.set(at.x + s * 0.25, 0, at.z - 0.08);
      this.group.add(a);
      return a;
    };

    const tiedR = tied(1);
    const tiedL = tied(-1);

    // The rest of him, sat in it: his back against the chair, thighs along
    // the seat, shins back to the front legs where his ankles are tied, and
    // his shoes. Only ever seen from his own eyes, looking down into his lap.
    const trousers = new THREE.MeshStandardMaterial({ color: 0x3a445a, roughness: 0.9 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
    const body = new THREE.Group();
    const limb = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): void => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, a.distanceTo(b), 4, 10), mat);
      m.position.copy(a).lerp(b, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      body.add(m);
    };
    // Topping out at the shoulders, 0.23 under the eye: any higher and its
    // flat top fills the bottom of the frame whenever he looks down at a wrist
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.38, 0.22), sleeve);
    torso.position.set(0, 0.73, 0.09);
    body.add(torso);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.34), trousers);
    seat.position.set(0, 0.55, 0.05);
    body.add(seat);
    for (const s of [-1, 1]) {
      limb(new THREE.Vector3(s * 0.1, 0.56, 0.08), new THREE.Vector3(s * 0.12, 0.55, -0.34), 0.08, trousers);
      limb(new THREE.Vector3(s * 0.12, 0.52, -0.35), new THREE.Vector3(s * 0.15, 0.14, -0.16), 0.064, trousers);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.25), shoe);
      foot.position.set(s * 0.15, 0.045, -0.23);
      body.add(foot);
    }
    body.position.copy(at);
    this.group.add(body);

    // The modelled Ravi takes the blocks' place once he has loaded: sat back
    // in the chair, forearms along its arms with the wrists in the rope and
    // the hands over the ends, ankles back by the front legs. His head is
    // left off — the camera is where it would be. His trunk rides `body`
    // (gone when he gets up), and each arm rides that side's tied group (gone
    // when that hand comes free).
    RaviVisual.whenReady(() => {
      for (const m of [skin, sleeve, trousers, shoe]) m.visible = false;
      const rig = RaviVisual.rig('seated');
      rig.root.rotation.y = Math.PI; // he faces −z
      body.add(rig.root);
      // Model space from here: his chair at the origin, facing +z, his right on −x
      const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
      rig.seat({
        hips: V(0, 0.5, -0.07),
        lean: [-8, 4, 5, 4, 0, 0],
        legs: {
          r: { ankle: V(-0.15, 0.078, 0.19), knee: V(-0.1, 0.6, 1) },
          l: { ankle: V(0.15, 0.078, 0.19), knee: V(0.1, 0.6, 1) }
        },
        arms: {
          r: { wrist: V(-0.25, 0.707, 0.1), along: V(0, -0.35, 0.94), palm: V(0, -1, -0.3), elbow: V(-0.3, -0.2, -1), shape: TIED_HAND },
          l: { wrist: V(0.25, 0.707, 0.1), along: V(0, -0.35, 0.94), palm: V(0, -1, -0.3), elbow: V(0.3, -0.2, -1), shape: TIED_HAND }
        }
      });
      // The skinned arms draw from the bones wherever the meshes hang, so
      // each can live in its own tied group and share that group's fate
      for (const m of rig.sideMeshes('r')) tiedR.attach(m);
      for (const m of rig.sideMeshes('l')) tiedL.attach(m);
    });

    return {
      at,
      wristR: new THREE.Vector3(at.x + 0.25, 0.7, at.z - 0.1),
      wristL: new THREE.Vector3(at.x - 0.25, 0.7, at.z - 0.1),
      ropeR: wrist(1),
      ropeL: wrist(-1),
      tiedR,
      tiedL,
      body
    };
  }

  /**
   * The boss's chair: high-backed leather on a five-star base, turned to
   * face the room. Moves when he leaves, so it is not merged.
   */
  private buildBossChair(): { group: THREE.Group; collider: Collider } {
    const g = new THREE.Group();
    const seatH = 0.45;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = this.box(0.32, 0.04, 0.06, this.steel, Math.cos(a) * 0.17, 0.05, Math.sin(a) * 0.17);
      arm.rotation.y = -a;
      g.add(arm);
    }
    g.add(this.box(0.08, seatH - 0.1, 0.08, this.steel, 0, (seatH - 0.1) / 2 + 0.05, 0));
    g.add(this.box(0.6, 0.11, 0.56, this.leather, 0, seatH - 0.055, 0));
    // High back at +z (he sits facing -z in the chair's frame), tufted
    const back = this.box(0.62, 0.86, 0.13, this.leather, 0, seatH + 0.47, 0.3);
    back.rotation.x = -0.1;
    g.add(back);
    const roll = this.box(0.64, 0.1, 0.16, this.leather, 0, seatH + 0.92, 0.33);
    g.add(roll);
    for (const s of [-1, 1]) {
      g.add(this.box(0.09, 0.08, 0.44, this.leather, s * 0.33, seatH + 0.2, 0.0));
      g.add(this.box(0.05, 0.18, 0.05, this.steel, s * 0.33, seatH + 0.08, 0.12));
    }
    g.position.set(DESK.cx, 0, DESK_BACK - BOSS_BACK);
    g.rotation.y = Math.PI;
    this.group.add(g);
    for (const o of g.children) this.shootables.push(o);
    const collider = this.blk(DESK.cx, DESK_BACK - BOSS_BACK + 0.05, 0.66, 0.66, 1.0);
    return { group: g, collider };
  }

  // --------------------------------------------------------------- picture

  /**
   * The big picture over his head: a heavy gilt frame, and a canvas waiting
   * for the scene to photograph him and put the photograph in it.
   */
  private buildPicture(): { mat: THREE.MeshStandardMaterial; mesh: THREE.Mesh } {
    const W = 1.2;
    const H = 0.9;
    const y = 1.98;
    const z = R.z0;
    const frame = new THREE.Group();
    const bar = 0.075;
    frame.add(this.box(W + 2 * bar, bar, 0.05, this.brass, 0, H / 2 + bar / 2, 0.025));
    frame.add(this.box(W + 2 * bar, bar, 0.05, this.brass, 0, -H / 2 - bar / 2, 0.025));
    frame.add(this.box(bar, H, 0.05, this.brass, -W / 2 - bar / 2, 0, 0.025));
    frame.add(this.box(bar, H, 0.05, this.brass, W / 2 + bar / 2, 0, 0.025));
    frame.add(this.box(W, H, 0.02, this.woodDark, 0, 0, 0.01));
    // A brass plate under it
    frame.add(this.box(0.3, 0.06, 0.012, this.brass, 0, -H / 2 - bar - 0.07, 0.006));
    this.put(frame, 0, z, 0, y);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    // In front of the backing board, behind the face of the frame
    mesh.position.set(0, y, z + 0.032);
    this.group.add(mesh);
    return { mat, mesh };
  }

  // ----------------------------------------------------------------- light

  /** One bare bulb on its flex, over the middle of the desk, burning orange. */
  private buildBulb(): THREE.PointLight {
    const x = DESK.cx;
    const z = DESK.cz - 0.05;
    const g = new THREE.Group();
    const flex = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0x141414 }));
    flex.position.y = R.h - 0.25;
    g.add(flex);
    g.add(this.box(0.05, 0.02, 0.05, this.steel, 0, R.h - 0.01, 0));
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.07, 12), new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
    socket.position.y = R.h - 0.535;
    g.add(socket);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.048, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x5a2a08, emissive: 0xffa040, emissiveIntensity: 3 })
    );
    bulb.position.y = R.h - 0.6;
    g.add(bulb);
    g.position.set(x, 0, z);
    this.group.add(g);
    const light = new THREE.PointLight(0xff9a3c, 7, 9, 1.4);
    light.position.set(x, R.h - 0.66, z);
    this.group.add(light);
    return light;
  }

  private buildLighting(): void {
    this.group.add(new THREE.AmbientLight(0x3a2a1e, 0.34));
    this.group.add(new THREE.HemisphereLight(0x4a3a2a, 0x0e0a08, 0.14));
  }

  // ------------------------------------------------------------------ vent

  /**
   * The way out he keeps for himself: a low vent in the back wall behind his
   * chair, a duct going back into the dark behind it, and a grille over it
   * that the scene takes off and throws down when he goes.
   */
  private buildVent(): {
    cover: THREE.Group;
    coverOff: { pos: THREE.Vector3; rot: THREE.Euler };
    mouth: THREE.Vector3;
  } {
    const { cx, w, h, y0 } = VENT;
    const z = R.z0;
    // The duct behind the wall: seen from inside, so its inside faces
    const duct = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 1.2),
      new THREE.MeshLambertMaterial({ color: 0x1a1c1e, side: THREE.BackSide })
    );
    duct.position.set(cx, y0 + h / 2, z - T - 0.6);
    this.group.add(duct);
    // Lining the hole through the wall itself
    const lining = new THREE.Mesh(new THREE.BoxGeometry(w, h, T + 0.01), new THREE.MeshLambertMaterial({ color: 0x3a3d40, side: THREE.BackSide }));
    lining.position.set(cx, y0 + h / 2, z - T / 2);
    this.group.add(lining);
    // Nothing gets through it on foot
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(cx - w / 2, y0, z - T), new THREE.Vector3(cx + w / 2, y0 + h, z))
    });

    const cover = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a8f95, roughness: 0.5, metalness: 0.6 });
    cover.add(this.box(w + 0.06, 0.03, 0.02, frameMat, 0, h / 2 + 0.015, 0));
    cover.add(this.box(w + 0.06, 0.03, 0.02, frameMat, 0, -h / 2 - 0.015, 0));
    cover.add(this.box(0.03, h, 0.02, frameMat, -w / 2 - 0.015, 0, 0));
    cover.add(this.box(0.03, h, 0.02, frameMat, w / 2 + 0.015, 0, 0));
    for (let i = 0; i < 7; i++) {
      const slat = this.box(w, 0.02, 0.035, frameMat, 0, -h / 2 + 0.04 + i * 0.058, 0.004);
      slat.rotation.x = -0.6;
      cover.add(slat);
    }
    cover.position.set(cx, y0 + h / 2, z + 0.012);
    this.group.add(cover);
    return {
      cover,
      // Thrown down on its back beside the hole
      coverOff: { pos: new THREE.Vector3(cx + 0.62, 0.02, z + 0.4), rot: new THREE.Euler(-Math.PI / 2, 0, 0.5) },
      mouth: new THREE.Vector3(cx, y0 + h / 2, z)
    };
  }

  // ---------------------------------------------------------------- dressing

  /**
   * The rest of an important man's office: a filing cabinet and a plant in
   * the back corners, a bookcase along one wall, a safe by the door, a
   * clock, a bin by the desk.
   */
  private dressRoom(): void {
    this.dressDesk();
    // Filing cabinet in the back right corner, drawers to the room
    this.put(fileCabinet(0.6, 1.32, 1.0, 4), R.x1 - 0.3, R.z0 + 0.7);
    this.blk(R.x1 - 0.3, R.z0 + 0.7, 0.62, 1.02, 1.32);
    // A plant in the back left corner
    this.put(flowerPot('tall'), R.x0 + 0.35, R.z0 + 0.4);
    this.put(trashCan(), -1.2, DESK_FRONT + 0.2);

    // Bookcase along the left wall, facing into the room
    const shelf = new THREE.Group();
    const SW = 1.3;
    const SH = 1.9;
    const SD = 0.34;
    shelf.add(this.box(SW, SH, 0.03, this.woodDark, 0, SH / 2, -SD / 2 + 0.015));
    for (const s of [-1, 1]) shelf.add(this.box(0.04, SH, SD, this.woodMat, s * (SW / 2 - 0.02), SH / 2, 0));
    const spines = [0x6e1d1d, 0x1d3f6e, 0x2e4a2a, 0x5a4a22, 0x3a2a4a, 0x7a6a4a, 0x222222];
    let k = 0;
    for (let i = 0; i < 5; i++) {
      const y = 0.06 + i * 0.44;
      shelf.add(this.box(SW - 0.06, 0.03, SD - 0.02, this.woodMat, 0, y, 0));
      if (i === 4) break;
      let x = -SW / 2 + 0.08;
      while (x < SW / 2 - 0.16) {
        const bw = 0.03 + ((k * 7) % 5) * 0.008;
        const bh = 0.24 + ((k * 3) % 4) * 0.03;
        const b = this.box(bw, bh, 0.2, new THREE.MeshLambertMaterial({ color: spines[k % spines.length] }), x + bw / 2, y + 0.015 + bh / 2, 0.02);
        if (k % 11 === 5) b.rotation.z = 0.25;
        shelf.add(b);
        x += bw + 0.004;
        k++;
        if (k % 9 === 0) x += 0.12;
      }
    }
    this.put(shelf, R.x0 + SD / 2, -0.4, Math.PI / 2);
    this.blk(R.x0 + SD / 2, -0.4, SD, SW, SH);

    // A safe by the door
    const safe = new THREE.Group();
    safe.add(this.box(0.55, 0.62, 0.52, new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.4, metalness: 0.6 }), 0, 0.31, 0));
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 18), this.brass);
    dial.rotation.x = Math.PI / 2;
    dial.position.set(0.05, 0.38, -0.27);
    safe.add(dial);
    safe.add(this.box(0.03, 0.14, 0.03, this.brass, -0.14, 0.34, -0.27));
    this.put(safe, R.x1 - 0.35, R.z1 - 0.45, 0);
    this.blk(R.x1 - 0.35, R.z1 - 0.45, 0.56, 0.54, 0.62);

    // Clock on the right wall
    const clock = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 24), new THREE.MeshLambertMaterial({ color: 0xe8e2d0 }));
    face.rotation.x = Math.PI / 2;
    clock.add(face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.014, 6, 24), this.woodDark);
    clock.add(rim);
    const hand1 = this.box(0.01, 0.1, 0.005, new THREE.MeshLambertMaterial({ color: 0x111111 }), 0, 0.04, 0.02);
    hand1.rotation.z = 0.9;
    clock.add(hand1);
    const hand2 = this.box(0.01, 0.13, 0.005, new THREE.MeshLambertMaterial({ color: 0x111111 }), 0, -0.05, 0.022);
    hand2.rotation.z = -0.4;
    clock.add(hand2);
    this.put(clock, R.x1 - 0.015, -0.6, -Math.PI / 2, 2.1);
  }

  /**
   * Walk graph for the one agent left standing: round the room either side
   * of the desk, and through the middle.
   */
  private makeWaypoints(): Waypoint[] {
    const pts: [number, number][] = [
      [-1.75, -2.3], [-1.6, -0.9], [-1.7, 0.8], [-1.0, 2.2],
      [1.0, 2.2], [1.75, 0.8], [1.65, -0.9], [1.6, -2.35],
      [0, 0.3], [0, -2.72]
    ];
    const links: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7],
      [1, 8], [2, 8], [5, 8], [6, 8], [0, 9], [7, 9]
    ];
    const wps: Waypoint[] = pts.map(([x, z]) => ({ pos: new THREE.Vector3(x, 0, z), links: [] }));
    for (const [a, b] of links) {
      wps[a].links.push(b);
      wps[b].links.push(a);
    }
    return wps;
  }
}
