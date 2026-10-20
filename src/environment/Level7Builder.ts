import * as THREE from 'three';
import type { BreakableGlass } from './BreakableGlass';
import { Collider, Waypoint, noiseCanvas, ceilingTileCanvas, makeTex } from './OfficeLevelBuilder';
import {
  officeChair, trashCan, scatteredPaper, paperStack, fileCabinet, flowerPot, printer, waterCooler,
  deskMonitor, pcTower, deskPhone, wallArt, vent, fireAlarm, roomSign, toiletStall, STALL_D,
  bathroomVanity, mirrorPanel, vendingMachine, rubblePile, officeDesk
} from './OfficeProps';
import { rubble, cable } from './MechanicalProps';
import { mergeStatic } from './mergeStatic';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FlickeringLight } from './FlickeringLight';
import { Level6Builder, type Level6Data } from './Level6Builder';

// ---------------------------------------------------------------- footprint
//
// Laid out from the floor plan: the big office on the west side with its
// windows; a corridor along the top past the restroom to a second corridor
// running down the east side to the stairwell door; the building's core
// (lifts and the server room) closed in the middle; the security room off
// the office's east side; and at the bottom a short hallway out to the
// boss's office, where Ravi starts.
//
// x runs east, z runs south (the plan's "down"). Walls are centred on these
// lines.

const T = 0.24;
const H = 3.0;

export const L7 = {
  office: { x0: 0, x1: 17.5, z0: 0, z1: 24.6 },
  topCorridor: { x0: 17.5, x1: 31.6, z0: 0, z1: 4.1 },
  core: { x0: 17.5, x1: 28.25, z0: 4.1, z1: 15.9 },
  eastCorridor: { x0: 28.25, x1: 31.6, z0: 4.1, z1: 15.9 },
  restroom: { x0: 16.5, x1: 28.5, z0: -4.2, z1: 0 },
  security: { x0: 17.5, x1: 24, z0: 15.9, z1: 24.6 },
  vestibule: { x0: 10.25, x1: 14.6, z0: 24.6, z1: 28.1 },
  hall: { x0: 10.25, x1: 21.6, z0: 28.1, z1: 32.1 },
  /** The boss's office from level six, turned so its vent wall faces east and its door west. */
  boss: { cx: 24.6, cz: 30.6, yaw: -Math.PI / 2 },
  restroomDoor: { x: 24.0, w: 1.3 },
  securityDoor: { z: 21.8, w: 1.2 },
  /** The stairwell door at the bottom of the east corridor: the way on. */
  exitDoor: { x: 29.9, w: 1.4 },
  /** The west wall's two long windows, as z spans. */
  windows: [[2.2, 9.6], [13.2, 21.8]] as [number, number][],
  sill: 0.8,
  head: 2.6,
  /** The ceiling has come down over no-man's land. */
  hole: { x0: 7.6, x1: 10.2, z0: 9.4, z1: 11.9 },
  /** How far below the floor the car park is: the top floor of nine. */
  ground: -26.4
} as const;

/** A level-six local point in this floor's frame. */
function fromBossRoom(x: number, z: number): THREE.Vector3 {
  const { cx, cz, yaw } = L7.boss;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return new THREE.Vector3(cx + x * c + z * s, 0, cz - x * s + z * c);
}

export interface Spot {
  pos: THREE.Vector3;
  yaw: number;
}

export interface Level7Data {
  group: THREE.Group;
  colliders: Collider[];
  shootables: THREE.Object3D[];
  occluders: THREE.Object3D[];
  glassPanes: BreakableGlass[];
  waypoints: Waypoint[];
  flickering: FlickeringLight[];
  playerSpawn: THREE.Vector3;
  playerSpawnYaw: number;

  // ---- The boss's office, rebuilt as he left it
  bossRoom: Level6Data;
  /** The room's own group, placed in this floor. */
  bossRoomGroup: THREE.Group;
  /** Where the boss sat (world), for photographing the portrait again. */
  bossSeat: Spot;
  /** The two agents from level six, where they went down (world). */
  bossRoomBodies: Spot[];
  /** The rifle the second one dropped, lying by him. */
  droppedRifle: Spot;

  // ---- The fight on the office floor
  /** Agents firing from behind the north barricade, at the staff: some knelt behind it, some stood, some in armour. */
  shooters: (Spot & { kneel: boolean; armour: boolean })[];
  /**
   * Staff behind the south barricade with pistols: where each kneels to
   * shoot, where he sits with his back to the desk top, the top edge of it
   * in front of him for his other hand, and the face of it the agents are
   * shooting at. The second is Kevin.
   */
  gunners: { kneel: THREE.Vector3; hide: THREE.Vector3; brace: THREE.Vector3; shield: THREE.Vector3 }[];
  /** Fist fights out in the open: the middle of each pair and the line they face along. */
  brawls: { centre: THREE.Vector3; yaw: number }[];
  /** An agent on his back, an employee knelt over him. */
  pound: { feet: THREE.Vector3; axisYaw: number; employee: Spot };
  /** Staff sat behind cover, hands over their ears. */
  cowering: Spot[];
  /** Agents posted round the rest of the floor: one in the top corridor, one in the restroom, one at the stairwell. */
  guards: { spot: Spot; radius: number; armour: boolean }[];
  /** Where more of them come in once the floor is going badly: out of the lifts, or up the stairs. */
  squad: THREE.Vector3[];
  /** Already dead when Ravi gets here. */
  corpses: { spot: Spot; civilian: boolean }[];

  // ---- The way on
  /** The CCTV wall: where it is, and the dead feeds on it, drawn by the scene. */
  screens: { at: THREE.Vector3; snow: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } };
  exitTrigger: THREE.Box3;
  exitPanel: THREE.MeshStandardMaterial;
  exitLight: THREE.PointLight;
  /** The red emergency light in the east corridor, pulsed by the scene. */
  alarm: THREE.PointLight;
  alarmMat: THREE.MeshStandardMaterial;
  /** Inside the office proper: where the fight is. */
  officeBox: THREE.Box3;
  securityBox: THREE.Box3;

  // ---- Things the scene animates
  /** Cut cables that spark. */
  sparks: THREE.Vector3[];
  /** Water dripping from the ceiling, and the floor it lands on. */
  drips: THREE.Vector3[];
  /** The burst pipe in the restroom: where it sprays from, and which way. */
  spray: { at: THREE.Vector3; dir: THREE.Vector3 };
  /** Bullet holes to put on the walls at the start. */
  bulletHoles: { pos: THREE.Vector3; normal: THREE.Vector3 }[];
}

/**
 * Level7Builder — the top floor, the morning after the raid went wrong.
 *
 * The staff did not just run this time. The office is a battlefield: the
 * desks are on their sides as barricades, the agents dug in along the north
 * side and the staff along the south, with the ground between them strewn
 * with paper, glass, ceiling tiles and water from the burst sprinklers. Two
 * pairs are fighting it out with their fists in the middle, and one agent is
 * on his back taking a beating. Through the windows, eight floors down, the
 * car park and the trees.
 */
export class Level7Builder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private dressing: THREE.Object3D[] = [];
  /** Walls, floors and ceilings: plain boxes, merged by material at the end. */
  private shell: THREE.Mesh[] = [];
  private flickering: FlickeringLight[] = [];
  private doorPoints: [number, number][] = [];
  private sparks: THREE.Vector3[] = [];
  private drips: THREE.Vector3[] = [];
  private bulletHoles: { pos: THREE.Vector3; normal: THREE.Vector3 }[] = [];

  private carpet!: THREE.MeshLambertMaterial;
  private carpetHall!: THREE.MeshLambertMaterial;
  private wallMat!: THREE.MeshLambertMaterial;
  private ceilMat!: THREE.MeshLambertMaterial;
  private tileMat!: THREE.MeshLambertMaterial;
  private tileFloor!: THREE.MeshLambertMaterial;
  private vinyl!: THREE.MeshLambertMaterial;
  private coreMat!: THREE.MeshLambertMaterial;
  private steel!: THREE.MeshStandardMaterial;
  private darkMetal!: THREE.MeshLambertMaterial;
  private frameMat!: THREE.MeshLambertMaterial;
  private puddleMat!: THREE.MeshPhongMaterial;
  private exitPanel!: THREE.MeshStandardMaterial;
  private exitLight!: THREE.PointLight;
  private alarm!: THREE.PointLight;
  private alarmMat!: THREE.MeshStandardMaterial;
  private snow!: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture };

  build(): Level7Data {
    this.makeMaterials();
    this.buildShell();
    const boss = this.buildBossRoom();
    this.buildWindows();
    this.buildOffice();
    this.buildCover();
    this.buildTopCorridor();
    this.buildEastCorridor();
    this.buildRestroom();
    this.buildSecurity();
    this.buildHall();
    this.buildLighting();
    this.buildOutside();
    this.shootables = mergeStatic(this.group, this.dressing, this.shootables);
    this.mergeShell();

    const O = L7.office;
    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      occluders: this.occluders,
      glassPanes: [],
      waypoints: this.makeWaypoints(),
      flickering: this.flickering,
      // Beside his chair, facing the door out
      playerSpawn: fromBossRoom(0.75, 1.55),
      playerSpawnYaw: Math.PI / 2,
      ...boss,
      // Just behind each barricade's legs (and the cabinet on its back): clear
      // of them, rifles over the top. Two of them in armour.
      shooters: [
        { pos: new THREE.Vector3(2.7, 0, 6.7), yaw: Math.PI, kneel: true, armour: false },
        { pos: new THREE.Vector3(5.1, 0, 6.55), yaw: Math.PI, kneel: false, armour: true },
        { pos: new THREE.Vector3(7.0, 0, 6.15), yaw: Math.PI, kneel: true, armour: false },
        { pos: new THREE.Vector3(10.55, 0, 6.95), yaw: Math.PI, kneel: false, armour: false },
        { pos: new THREE.Vector3(11.5, 0, 6.95), yaw: Math.PI, kneel: true, armour: false },
        { pos: new THREE.Vector3(14.7, 0, 6.3), yaw: Math.PI, kneel: false, armour: true }
      ],
      gunners: this.staffLine.map(([x, z]) => {
        const shield = z - 0.72;
        const gx = x - 0.19;
        return {
          kneel: new THREE.Vector3(gx, 0, shield + 0.48),
          hide: new THREE.Vector3(gx, 0, shield + 0.28),
          brace: new THREE.Vector3(gx - 0.15, 0.77, shield + 0.03),
          shield: new THREE.Vector3(gx, 0.45, shield - 0.03)
        };
      }),
      brawls: [
        { centre: new THREE.Vector3(5.6, 0, 11.7), yaw: 0.35 },
        { centre: new THREE.Vector3(12.7, 0, 12.4), yaw: -0.5 }
      ],
      // Just short of the staff's line, his head to the west; the man on
      // him knelt on his north side, facing the way Ravi comes in
      pound: {
        feet: new THREE.Vector3(8.6, 0, 13.3),
        axisYaw: -Math.PI / 2,
        employee: { pos: new THREE.Vector3(7.2, 0, 12.85), yaw: Math.PI }
      },
      cowering: [
        // Behind the desks at the back, backs to them, away from the shooting
        { pos: new THREE.Vector3(8.4, 0, 21.3), yaw: Math.PI },
        { pos: new THREE.Vector3(13.1, 0, 22.05), yaw: Math.PI },
        // On the security room floor, back to the wall
        { pos: new THREE.Vector3(17.85, 0, 17.0), yaw: -Math.PI / 2 }
      ],
      guards: [
        { spot: { pos: new THREE.Vector3(24.2, 0, 2.1), yaw: Math.PI / 2 }, radius: 5.5, armour: false },
        { spot: { pos: new THREE.Vector3(21.5, 0, -2.0), yaw: -Math.PI / 2 }, radius: 4, armour: false },
        // The stairwell door is the way out: its man is in armour
        { spot: { pos: new THREE.Vector3(29.9, 0, 12.4), yaw: 0 }, radius: 4, armour: true }
      ],
      // In front of each lift, and at the top of the stairs
      squad: [new THREE.Vector3(21.6, 0, 2.9), new THREE.Vector3(24.6, 0, 2.9), new THREE.Vector3(29.9, 0, 14.2)],
      corpses: [
        { spot: { pos: new THREE.Vector3(6.1, 0, 18.9), yaw: 2.4 }, civilian: true },
        { spot: { pos: new THREE.Vector3(9.6, 0, 8.9), yaw: -0.8 }, civilian: false },
        { spot: { pos: new THREE.Vector3(15.6, 0, 22.2), yaw: 1.1 }, civilian: true }
      ],
      screens: { at: new THREE.Vector3(L7.security.x1 - 0.2, 1.8, 19.6), snow: this.snow },
      exitTrigger: new THREE.Box3(
        new THREE.Vector3(L7.exitDoor.x - 0.8, 0, L7.eastCorridor.z1 - 1.25),
        new THREE.Vector3(L7.exitDoor.x + 0.8, 2.2, L7.eastCorridor.z1 - 0.05)
      ),
      exitPanel: this.exitPanel,
      exitLight: this.exitLight,
      alarm: this.alarm,
      alarmMat: this.alarmMat,
      officeBox: new THREE.Box3(new THREE.Vector3(O.x0, -1, O.z0), new THREE.Vector3(O.x1, 3, O.z1)),
      securityBox: new THREE.Box3(
        new THREE.Vector3(L7.security.x0, -1, L7.security.z0),
        new THREE.Vector3(L7.security.x1, 3, L7.security.z1)
      ),
      sparks: this.sparks,
      drips: this.drips,
      spray: { at: new THREE.Vector3(27.95, 0.55, -3.55), dir: new THREE.Vector3(-0.85, 0.35, 0.35).normalize() },
      bulletHoles: this.bulletHoles
    };
  }

  // ------------------------------------------------------------- materials

  private makeMaterials(): void {
    this.carpet = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([66, 70, 80], 14), 18, 24) });
    this.carpetHall = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([58, 52, 48], 12), 10, 4) });
    this.wallMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([190, 184, 172], 8), 4, 2) });
    this.ceilMat = new THREE.MeshLambertMaterial({ map: makeTex(ceilingTileCanvas(), 18, 24) });
    this.tileMat = new THREE.MeshLambertMaterial({ map: makeTex(tileCanvas(false), 6, 2) });
    this.tileFloor = new THREE.MeshLambertMaterial({ map: makeTex(tileCanvas(true), 12, 4) });
    this.vinyl = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([92, 96, 98], 10), 6, 8) });
    this.coreMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([150, 146, 140], 10), 4, 2) });
    this.steel = new THREE.MeshStandardMaterial({ color: 0x6d737a, roughness: 0.4, metalness: 0.6 });
    this.darkMetal = new THREE.MeshLambertMaterial({ color: 0x353a41 });
    this.frameMat = new THREE.MeshLambertMaterial({ color: 0x2b2f35 });
    // Standing water: dark, and glossy enough to throw the lights back
    this.puddleMat = new THREE.MeshPhongMaterial({
      color: 0x11181e,
      specular: 0x9fb2c4,
      shininess: 120,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
  }

  // --------------------------------------------------------------- helpers

  /** Solid box: mesh, collider, bullet target and (by default) vision blocker. `y` is its base. */
  private solid(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material = this.wallMat,
    opts: { collide?: boolean; occlude?: boolean; surface?: string } = {}
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.userData.surface = opts.surface ?? 'concrete';
    this.group.add(mesh);
    this.shootables.push(mesh);
    this.shell.push(mesh);
    if (opts.occlude !== false) this.occluders.push(mesh);
    if (opts.collide !== false) {
      this.colliders.push({
        box: new THREE.Box3(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y + h, z + d / 2))
      });
    }
    return mesh;
  }

  private slab(x0: number, x1: number, z0: number, z1: number, y: number, mat: THREE.Material): void {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, y + 0.15, (z0 + z1) / 2);
    this.group.add(m);
    this.shootables.push(m);
    this.shell.push(m);
    this.colliders.push({ box: new THREE.Box3(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y + 0.3, z1)) });
  }

  /** A movement-only box: furniture that is folded into the dressing. */
  private blk(x: number, z: number, w: number, d: number, h: number, y = 0): void {
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y + h, z + d / 2))
    });
  }

  /** A prop, to be folded into the merged dressing. Its meshes still stop bullets. */
  private put(o: THREE.Object3D, x: number, z: number, yaw = 0, y = 0): THREE.Object3D {
    o.position.set(x, y, z);
    o.rotation.y = yaw;
    this.group.add(o);
    this.dressing.push(o);
    o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) {
        if (!m.userData.surface) m.userData.surface = 'wood';
        this.shootables.push(m);
      }
    });
    return o;
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  /**
   * A run of wall along one axis with openings punched through it: a door
   * (a full-height gap with a header over it), a window (the gap between
   * sill and head) or an opening (a wide gap with a deep header).
   */
  private wall(
    axis: 'x' | 'z',
    a0: number,
    a1: number,
    cross: number,
    openings: { at: number; w: number; kind: 'door' | 'window' | 'opening' }[] = [],
    mat: THREE.Material = this.wallMat
  ): void {
    const put = (from: number, to: number, y: number, h: number): void => {
      if (to - from < 0.01 || h < 0.01) return;
      if (axis === 'x') this.solid(to - from, h, T, (from + to) / 2, y, cross, mat);
      else this.solid(T, h, to - from, cross, y, (from + to) / 2, mat);
    };
    let cursor = a0;
    for (const o of [...openings].sort((p, q) => p.at - q.at)) {
      const s = o.at - o.w / 2;
      const e = o.at + o.w / 2;
      put(cursor, s, 0, H);
      if (o.kind === 'window') {
        put(s, e, 0, L7.sill);
        put(s, e, L7.head, H - L7.head);
      } else {
        const top = o.kind === 'door' ? 2.2 : 2.55;
        put(s, e, top, H - top);
        for (const off of [-0.9, 0, 0.9]) {
          this.doorPoints.push(axis === 'x' ? [o.at, cross + off] : [cross + off, o.at]);
        }
      }
      cursor = e;
    }
    put(cursor, a1, 0, H);
  }

  /**
   * The walls, floors and ceilings into one mesh per material. Built as
   * separate boxes they were a draw each — the better part of a hundred —
   * and none of them ever moves. The merged ones take their place as bullet
   * targets and, where the boxes blocked sight, as occluders.
   */
  private mergeShell(): void {
    this.group.updateMatrixWorld(true);
    const buckets = new Map<THREE.Material, THREE.Mesh[]>();
    for (const m of this.shell) {
      const mat = m.material as THREE.Material;
      const list = buckets.get(mat);
      if (list) list.push(m);
      else buckets.set(mat, [m]);
    }
    const gone = new Set<THREE.Object3D>(this.shell);
    const occluding = new Set<THREE.Object3D>(this.occluders);
    this.shootables = this.shootables.filter((o) => !gone.has(o));
    this.occluders = this.occluders.filter((o) => !gone.has(o));
    for (const [mat, list] of buckets) {
      const geos = list.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld));
      const one = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!one) {
        // Could not fold: leave these as they were
        for (const m of list) {
          gone.delete(m);
          this.shootables.push(m);
          if (occluding.has(m)) this.occluders.push(m);
        }
        continue;
      }
      const mesh = new THREE.Mesh(one, mat);
      mesh.userData.surface = list[0].userData.surface;
      this.group.add(mesh);
      this.shootables.push(mesh);
      if (list.some((m) => occluding.has(m))) this.occluders.push(mesh);
      for (const m of list) {
        m.removeFromParent();
        m.geometry.dispose();
      }
    }
    this.shell = [];
  }

  // ----------------------------------------------------------------- shell

  private buildShell(): void {
    const O = L7.office;
    const TC = L7.topCorridor;
    const EC = L7.eastCorridor;
    const R = L7.restroom;
    const S = L7.security;
    const V = L7.vestibule;
    const HL = L7.hall;
    const h = L7.hole;

    // Floors
    this.slab(O.x0 - T, O.x1, O.z0 - T, O.z1 + T, -0.3, this.carpet);
    this.slab(TC.x0, TC.x1 + T, TC.z0 - T, TC.z1, -0.3, this.carpetHall);
    this.slab(EC.x0, EC.x1 + T, EC.z0, EC.z1 + T, -0.3, this.carpetHall);
    this.slab(R.x0 - T, R.x1 + T, R.z0 - T, R.z1, -0.3, this.tileFloor);
    this.slab(S.x0, S.x1 + T, S.z0, S.z1 + T, -0.3, this.vinyl);
    this.slab(V.x0 - T, V.x1 + T, V.z0, V.z1, -0.3, this.carpetHall);
    this.slab(HL.x0 - T, HL.x1, HL.z0, HL.z1 + T, -0.3, this.carpetHall);

    // Ceilings — the office's in four pieces round the hole where it came down
    this.slab(O.x0 - T, O.x1, O.z0 - T, h.z0, H, this.ceilMat);
    this.slab(O.x0 - T, O.x1, h.z1, O.z1 + T, H, this.ceilMat);
    this.slab(O.x0 - T, h.x0, h.z0, h.z1, H, this.ceilMat);
    this.slab(h.x1, O.x1, h.z0, h.z1, H, this.ceilMat);
    this.slab(TC.x0, TC.x1 + T, TC.z0 - T, TC.z1, H, this.ceilMat);
    this.slab(EC.x0, EC.x1 + T, EC.z0, EC.z1 + T, H, this.ceilMat);
    this.slab(R.x0 - T, R.x1 + T, R.z0 - T, R.z1, H, this.ceilMat);
    this.slab(S.x0, S.x1 + T, S.z0, S.z1 + T, H, this.ceilMat);
    this.slab(V.x0 - T, V.x1 + T, V.z0, V.z1, H, this.ceilMat);
    this.slab(HL.x0 - T, HL.x1, HL.z0, HL.z1 + T, H, this.ceilMat);

    // The north line: office, top corridor and the restroom's south wall
    this.wall('x', O.x0 - T / 2, TC.x1 + T / 2, 0, [{ at: L7.restroomDoor.x, w: L7.restroomDoor.w, kind: 'door' }]);
    // The south line: the office and the security room, with the way through to the hallway
    this.wall('x', O.x0 - T / 2, S.x1 + T / 2, O.z1, [{ at: (V.x0 + V.x1) / 2, w: V.x1 - V.x0, kind: 'opening' }]);
    // The office's east side: the core, then the security room with its door
    this.wall('z', TC.z1, O.z1, O.x1, [{ at: L7.securityDoor.z, w: L7.securityDoor.w, kind: 'door' }]);
    // The core, and the corridors round it
    this.wall('x', TC.x0, EC.x0 + T / 2, TC.z1, [], this.coreMat);
    this.wall('z', EC.z0, EC.z1, EC.x0, [], this.coreMat);
    this.wall('z', TC.z0 - T / 2, EC.z1 + T / 2, TC.x1);
    // The stairwell's wall at the bottom of the east corridor, with the core's south face and the security room's north
    this.wall('x', S.x0, TC.x1, EC.z1, [{ at: L7.exitDoor.x, w: L7.exitDoor.w, kind: 'door' }]);
    // The security room's east wall
    this.wall('z', S.z0, S.z1, S.x1);
    // The restroom
    this.wall('z', R.z0 - T / 2, R.z1, R.x0, [], this.tileMat);
    this.wall('z', R.z0 - T / 2, R.z1, R.x1, [], this.tileMat);
    this.wall('x', R.x0 - T / 2, R.x1 + T / 2, R.z0, [], this.tileMat);
    // The vestibule and the hallway down to the boss's office
    this.wall('z', V.z0, HL.z1 + T / 2, V.x0);
    this.wall('z', V.z0, V.z1, V.x1);
    this.wall('x', V.x1, HL.x1, HL.z0);
    this.wall('x', HL.x0, HL.x1, HL.z1);
    // The core is solid: fill it so nothing sees or walks into it
    const C = L7.core;
    this.blk((C.x0 + C.x1) / 2, (C.z0 + C.z1) / 2, C.x1 - C.x0, C.z1 - C.z0, H);
    // The plenum over the hole: dark, with a duct and a pipe running across it
    const pl = L7.hole;
    const plenum = new THREE.Mesh(
      new THREE.BoxGeometry(pl.x1 - pl.x0, 1.0, pl.z1 - pl.z0),
      new THREE.MeshLambertMaterial({ color: 0x15171a, side: THREE.BackSide })
    );
    plenum.position.set((pl.x0 + pl.x1) / 2, H + 0.3 + 0.5, (pl.z0 + pl.z1) / 2);
    this.group.add(plenum);
    const duct = this.box(pl.x1 - pl.x0 + 0.4, 0.45, 0.6, this.steel, (pl.x0 + pl.x1) / 2, H + 0.75, pl.z0 + 0.8);
    this.put(new THREE.Group().add(duct), 0, 0);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, pl.z1 - pl.z0 + 0.4, 10), this.steel);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(pl.x0 + 1.7, H + 0.55, (pl.z0 + pl.z1) / 2);
    this.put(new THREE.Group().add(pipe), 0, 0);
    // The burst sprinkler on it: water still coming down into no-man's land
    this.drips.push(new THREE.Vector3(pl.x0 + 1.7, H + 0.48, pl.z0 + 1.6), new THREE.Vector3(pl.x0 + 1.75, H + 0.48, pl.z0 + 1.1));
  }

  // ------------------------------------------------------------ boss room

  /** Level six's office, as he left it: the chair shoved aside, the vent open, two of his agents on the floor. */
  private buildBossRoom(): {
    bossRoom: Level6Data;
    bossRoomGroup: THREE.Group;
    bossSeat: Spot;
    bossRoomBodies: Spot[];
    droppedRifle: Spot;
  } {
    const room = new Level6Builder({ doorway: { x: 0.8, w: 1.1 }, ambient: false }).build();
    const { cx, cz, yaw } = L7.boss;
    room.group.position.set(cx, 0, cz);
    room.group.rotation.y = yaw;
    this.group.add(room.group);
    room.group.updateMatrixWorld(true);
    // Its colliders were built in its own frame: turn them into this one
    const m = room.group.matrixWorld;
    const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (const c of room.colliders) {
      const b = c.box;
      corners[0].set(b.min.x, 0, b.min.z).applyMatrix4(m);
      corners[1].set(b.max.x, 0, b.min.z).applyMatrix4(m);
      corners[2].set(b.min.x, 0, b.max.z).applyMatrix4(m);
      corners[3].set(b.max.x, 0, b.max.z).applyMatrix4(m);
      const y0 = b.min.y;
      const y1 = b.max.y;
      b.makeEmpty();
      for (const p of corners) b.expandByPoint(p);
      b.min.y = y0;
      b.max.y = y1;
      this.colliders.push(c);
    }
    for (const s of room.shootables) this.shootables.push(s);
    for (const o of room.occluders) this.occluders.push(o);
    // How he left it
    room.ropeR.visible = false;
    room.ropeL.visible = false;
    room.tiedR.visible = false;
    room.tiedL.visible = false;
    room.raviSat.visible = false;
    const shoved = room.bossChairShoved;
    room.bossChair.position.copy(shoved.pos);
    room.bossChair.rotation.y = shoved.yaw;
    // The chair's collider, in this floor's frame
    const chairAt = shoved.pos.clone().applyMatrix4(m);
    room.bossChairCollider.box.setFromCenterAndSize(new THREE.Vector3(chairAt.x, 0.5, chairAt.z), new THREE.Vector3(0.66, 1.0, 0.66));
    room.ventCover.position.copy(room.ventCoverOff.pos);
    room.ventCover.rotation.copy(room.ventCoverOff.rot);
    this.doorPoints.push([L7.boss.cx - 3 - 0.9, cz + 0.8], [L7.boss.cx - 3, cz + 0.8], [L7.boss.cx - 3 + 0.9, cz + 0.8]);

    const toWorldYaw = (y: number): number => y + yaw;
    return {
      bossRoom: room,
      bossRoomGroup: room.group,
      bossSeat: { pos: room.bossAt.clone().applyMatrix4(m), yaw: toWorldYaw(Math.PI) },
      bossRoomBodies: [
        // The one Ravi punched, by the chair; the one he shot, at the end of the desk
        { pos: fromBossRoom(-0.55, 1.45), yaw: toWorldYaw(0.4) },
        { pos: fromBossRoom(-1.75, -0.7), yaw: toWorldYaw(-2.2) }
      ],
      droppedRifle: { pos: fromBossRoom(-1.2, -0.15), yaw: toWorldYaw(0.9) }
    };
  }

  // --------------------------------------------------------------- windows

  /**
   * The office's west wall is mostly glass: two long runs of it between the
   * piers, looking out over the car park eight floors down. Laminated, so a
   * round leaves a star in it and goes no further — and nobody falls out.
   */
  private buildWindows(): void {
    const O = L7.office;
    const ops = L7.windows.map(([a, b]) => ({ at: (a + b) / 2, w: b - a, kind: 'window' as const }));
    this.wall('z', O.z0 - T / 2, O.z1 + T / 2, O.x0, ops);
    const glass = new THREE.MeshStandardMaterial({
      color: 0x9fb8c8,
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.16,
      depthWrite: false
    });
    for (const [a, b] of L7.windows) {
      const h = L7.head - L7.sill;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, b - a), glass);
      pane.position.set(O.x0, L7.sill + h / 2, (a + b) / 2);
      pane.userData.surface = 'glass';
      this.group.add(pane);
      this.shootables.push(pane);
      this.colliders.push({
        box: new THREE.Box3(new THREE.Vector3(O.x0 - 0.08, 0, a), new THREE.Vector3(O.x0 + 0.08, H, b))
      });
      // Mullions every 1.6m, a transom, and a sill board inside
      const frame = new THREE.Group();
      const n = Math.round((b - a) / 1.6);
      for (let i = 0; i <= n; i++) {
        frame.add(this.box(0.1, h, 0.07, this.frameMat, 0, L7.sill + h / 2, a + ((b - a) * i) / n));
      }
      frame.add(this.box(0.1, 0.06, b - a, this.frameMat, 0, L7.sill + h * 0.78, (a + b) / 2));
      frame.add(this.box(0.24, 0.04, b - a, new THREE.MeshLambertMaterial({ color: 0xb9b3a6 }), 0.12, L7.sill, (a + b) / 2));
      this.put(frame, O.x0, 0);
    }
  }

  // ---------------------------------------------------------------- office

  /** A desk knocked onto its side as a barricade. `facing` is the way its top faces: the side the fire comes from. */
  private barricade(x: number, z: number, w: number, facing: 1 | -1, jitter = 0): void {
    const d = officeDesk(w);
    // Tipped over on its back edge, the top standing up as the shield
    d.rotation.set(facing * Math.PI / 2, 0, 0);
    d.position.y = 0.375;
    const g = new THREE.Group().add(d);
    this.put(g, x, z, jitter);
    // Shield plus the pedestal behind it
    const zc = z + facing * 0.36;
    this.blk(x, zc, w + 0.06, 0.8, 0.78);
  }

  /** A chair on its side, or knocked over backwards. */
  private chairDown(x: number, z: number, yaw: number, roll: number): void {
    const c = officeChair(0.46);
    c.rotation.set(0, 0, roll);
    c.position.y = roll !== 0 ? 0.3 : 0;
    this.put(new THREE.Group().add(c), x, z, yaw);
  }

  /** Standing water, ragged at the edge. */
  private puddle(x: number, z: number, r: number, seed = 1): void {
    const shape = new THREE.Shape();
    const n = 18;
    let s = seed * 9301 + 49297;
    const rnd = (): number => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.7 + rnd() * 0.5) * (i === n ? 1 : 1);
      const px = Math.cos(a) * rr * 1.25;
      const pz = Math.sin(a) * rr;
      if (i === 0) shape.moveTo(px, pz);
      else shape.lineTo(px, pz);
    }
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, this.puddleMat);
    m.position.set(x, 0.006, z);
    m.rotation.y = seed;
    m.renderOrder = 1;
    this.group.add(m);
  }

  /** A ceiling tile on the floor, cracked in two. */
  private fallenTile(x: number, z: number, yaw: number): void {
    const g = new THREE.Group();
    const tile = new THREE.MeshLambertMaterial({ color: 0xcfd2cd });
    const a = this.box(0.6, 0.02, 0.3, tile, 0, 0.012, -0.16);
    const b = this.box(0.6, 0.02, 0.28, tile, 0.04, 0.05, 0.16);
    b.rotation.x = 0.25;
    g.add(a, b);
    this.put(g, x, z, yaw);
  }

  /** A monitor face down on the carpet with its screen smashed. */
  private brokenMonitor(x: number, z: number, yaw: number): void {
    const m = deskMonitor();
    m.rotation.set(-Math.PI / 2 + 0.15, 0, 0.1);
    m.position.y = 0.12;
    this.put(new THREE.Group().add(m), x, z, yaw);
  }

  /** The barricades the two sides are behind: [x, z] of each desk's feet end. */
  private agentLine: [number, number][] = [[3.1, 7.2], [7.1, 6.65], [11.0, 7.45], [14.8, 6.8]];
  private staffLine: [number, number][] = [[2.6, 15.25], [6.4, 15.85], [10.4, 15.05], [14.4, 15.65]];

  private buildOffice(): void {
    // ---- The agents' line along the north: desks over, tops to the south
    const aw = [1.6, 1.5, 1.6, 1.5];
    const aj = [0.05, -0.12, 0.08, 0];
    this.agentLine.forEach(([x, z], i) => this.barricade(x, z, aw[i], 1, aj[i] * 0.3));
    // A filing cabinet on its back between two of them
    const fc = fileCabinet(0.6, 1.32, 1.0, 4);
    fc.rotation.set(Math.PI / 2, 0, 0);
    fc.position.y = 0.3;
    this.put(new THREE.Group().add(fc), 5.1, 7.6, Math.PI / 2);
    this.blk(5.1, 7.6, 1.4, 1.0, 0.62);

    // ---- The staff's line across the south: tops to the north
    const sj = [-0.06, 0.1, -0.04, 0.06];
    this.staffLine.forEach(([x, z], i) => this.barricade(x, z, aw[i], -1, sj[i] * 0.3));
    // A vending machine on its face, dragged in as cover at the end of the line
    const vm = vendingMachine();
    vm.rotation.set(-Math.PI / 2, 0, 0);
    vm.position.y = 0.39;
    this.put(new THREE.Group().add(vm), 16.6, 14.6, 0.2);
    this.blk(16.6, 14.6, 1.2, 2.1, 0.8);

    // ---- No-man's land: what came down from the ceiling and what got thrown
    const hl = L7.hole;
    this.put(rubblePile(0.6), (hl.x0 + hl.x1) / 2 - 0.3, (hl.z0 + hl.z1) / 2 + 0.2, 0.4);
    this.put(rubblePile(0.45), (hl.x0 + hl.x1) / 2 + 0.5, (hl.z0 + hl.z1) / 2 + 0.6, 2.2);
    this.put(rubble(1.3, 11), (hl.x0 + hl.x1) / 2 + 0.2, (hl.z0 + hl.z1) / 2 - 0.4, 0.7);
    this.blk((hl.x0 + hl.x1) / 2, (hl.z0 + hl.z1) / 2 + 0.3, 1.4, 1.1, 0.4);
    this.put(rubble(1.2, 5), hl.x0 + 0.4, hl.z1 - 0.2, 1.0);
    this.put(rubble(0.9, 7), hl.x1 - 0.3, hl.z0 + 0.5, 2.1);
    for (const [x, z, yaw] of [
      [7.2, 10.2, 0.4], [9.6, 12.5, 1.2], [6.6, 11.6, 2.5], [10.8, 9.6, -0.6], [9.6, 14.2, 0.9],
      [4.0, 9.1, 1.7], [13.6, 10.4, -1.1], [2.2, 14.1, 0.3]
    ] as const) {
      this.fallenTile(x, z, yaw);
    }
    // Cables hanging out of the hole, one of them live
    const cx = hl.x0 + 0.5;
    const cz = hl.z0 + 0.6;
    this.put(new THREE.Group().add(cable([
      new THREE.Vector3(cx, H + 0.3, cz), new THREE.Vector3(cx + 0.1, H - 0.4, cz + 0.05), new THREE.Vector3(cx + 0.05, H - 1.2, cz + 0.2)
    ], 0.015)), 0, 0);
    this.sparks.push(new THREE.Vector3(cx + 0.05, H - 1.22, cz + 0.2));
    this.put(new THREE.Group().add(cable([
      new THREE.Vector3(hl.x1 - 0.4, H + 0.3, hl.z1 - 0.5), new THREE.Vector3(hl.x1 - 0.5, H - 0.6, hl.z1 - 0.4), new THREE.Vector3(hl.x1 - 0.7, H - 0.9, hl.z1 - 0.2)
    ], 0.018)), 0, 0);
    // Water under the burst sprinkler, and running off across the carpet
    this.puddle(hl.x0 + 1.7, hl.z0 + 1.4, 1.1, 3);
    this.puddle(hl.x0 + 0.6, hl.z1 + 0.9, 0.7, 5);
    this.puddle(4.2, 13.4, 0.9, 7);
    this.puddle(12.4, 9.0, 0.6, 11);
    // Chairs everywhere
    this.chairDown(4.6, 10.0, 0.6, Math.PI / 2);
    this.chairDown(9.9, 13.6, 2.1, -Math.PI / 2);
    this.chairDown(13.2, 9.2, -1.0, 0);
    this.chairDown(1.6, 9.1, 2.6, Math.PI / 2);
    this.chairDown(15.6, 11.8, 0.4, -Math.PI / 2);
    this.chairDown(7.8, 8.4, 1.9, 0);
    // Smashed screens, towers, phones
    this.brokenMonitor(6.0, 9.4, 0.5);
    this.brokenMonitor(11.6, 13.4, -2.2);
    this.brokenMonitor(15.1, 8.7, 1.4);
    const tower = pcTower();
    tower.rotation.z = Math.PI / 2;
    tower.position.y = 0.1;
    this.put(new THREE.Group().add(tower), 3.4, 11.2, 0.8);
    this.put(deskPhone(), 8.6, 8.2, 2.0);
    // Paper over all of it
    for (const [x, z, n, r] of [
      [5.5, 10.5, 9, 1.2], [11.5, 11.0, 9, 1.3], [8.5, 14.0, 7, 1.0], [3.0, 12.0, 6, 0.9], [14.0, 13.0, 7, 1.0],
      [7.0, 18.5, 6, 1.0], [12.0, 20.0, 6, 1.0], [5.0, 4.0, 6, 1.0], [12.0, 3.5, 6, 1.0]
    ] as const) {
      this.put(scatteredPaper(n, r), x, z, x * 0.7);
    }
    this.put(rubblePile(0.5), 1.0, 18.5, 0.3);

    // ---- The south side, behind the staff: what was the call floor, half wrecked
    for (const [x, z, yaw, up] of [
      [3.0, 20.0, 0, true], [8.6, 20.6, 0.05, true], [13.4, 21.4, -0.05, true],
      [3.2, 23.0, Math.PI, false], [8.8, 23.3, Math.PI, true], [15.0, 23.4, Math.PI + 0.3, false]
    ] as const) {
      if (up) {
        this.put(officeDesk(1.6), x, z, yaw);
        this.blk(x, z, 1.7, 0.85, 0.76);
        if (Math.abs(yaw) < 1) this.put(deskMonitor(), x - 0.3, z - 0.1, yaw + Math.PI, 0.745);
      } else {
        const d = officeDesk(1.6);
        d.rotation.set(0, 0, Math.PI / 2 - 0.1);
        d.position.y = 0.78;
        this.put(new THREE.Group().add(d), x, z, yaw);
        this.blk(x, z, 0.85, 1.7, 0.9);
      }
    }
    // Where Ravi comes in: the back of the staff's line, as wrecked as the rest
    this.chairDown(5.0, 19.4, 1.2, Math.PI / 2);
    this.chairDown(11.6, 22.9, -0.7, -Math.PI / 2);
    this.chairDown(15.8, 19.9, 2.8, 0);
    this.chairDown(2.2, 22.1, -2.0, -Math.PI / 2);
    this.brokenMonitor(10.6, 19.1, 2.6);
    this.brokenMonitor(4.6, 22.6, -0.9);
    for (const [x, z, yaw] of [[6.1, 22.0, 0.6], [14.1, 20.8, -1.3], [9.6, 17.6, 2.0], [1.6, 16.9, 0.2], [12.9, 17.1, 1.1]] as const) {
      this.fallenTile(x, z, yaw);
    }
    for (const [x, z, n, r] of [[10.0, 22.6, 7, 1.0], [4.0, 23.4, 6, 0.9], [14.6, 18.6, 6, 1.0], [12.5, 16.9, 5, 0.8], [2.4, 18.3, 5, 0.8], [7.4, 16.9, 5, 0.8]] as const) {
      this.put(scatteredPaper(n, r), x, z, x * 1.3);
    }
    this.put(rubble(0.7, 5), 2.6, 17.4, 0.4);
    this.put(rubble(0.6, 9), 12.2, 21.4, 1.9);
    this.puddle(10.9, 23.1, 0.7, 37);
    this.puddle(4.6, 21.4, 0.8, 41);
    this.puddle(13.6, 18.0, 0.6, 43);
    // A filing cabinet on its side, drawers spilled
    const fc2 = fileCabinet(0.6, 1.32, 1.0, 4);
    fc2.rotation.set(0, 0, Math.PI / 2);
    fc2.position.y = 0.3;
    this.put(new THREE.Group().add(fc2), 1.0, 20.4, 0.3);
    this.blk(1.0, 20.4, 1.4, 0.9, 0.62);
    this.put(paperStack(5, 0.03), 1.7, 19.6, 0.8);
    this.put(printer(), 16.6, 18.4, -Math.PI / 2);
    this.blk(16.6, 18.4, 0.7, 0.6, 1.1);
    this.put(flowerPot('dying'), 0.5, 23.9);
    this.put(trashCan(), 5.6, 21.6);
    const fallen = flowerPot('tall');
    fallen.rotation.z = Math.PI / 2;
    fallen.position.y = 0.2;
    this.put(new THREE.Group().add(fallen), 11.0, 18.0, 1.0);

    // ---- The north side, behind the agents
    for (const [x, z, yaw] of [[3.0, 2.2, Math.PI], [8.0, 2.4, Math.PI], [13.0, 2.0, Math.PI + 0.1]] as const) {
      this.put(officeDesk(1.6), x, z, yaw);
      this.blk(x, z, 1.7, 0.85, 0.76);
      this.put(paperStack(6, 0.04), x + 0.4, z, yaw, 0.745);
    }
    this.put(fileCabinet(0.6, 1.32, 1.0, 4), 16.9, 1.0, Math.PI / 2);
    this.blk(16.9, 1.0, 1.0, 0.62, 1.32);
    const cooler = waterCooler();
    cooler.rotation.z = Math.PI / 2;
    cooler.position.y = 0.17;
    this.put(new THREE.Group().add(cooler), 15.9, 3.4, -0.4);
    this.puddle(15.2, 3.7, 0.8, 13);

    // ---- On the walls: pictures, a vent, the alarm, and a whole lot of bullet holes
    this.put(wallArt('together'), 6.0, L7.office.z0 + T / 2 + 0.03, 0, 1.75);
    this.put(wallArt('dial'), 12.5, L7.office.z0 + T / 2 + 0.03, 0, 1.6);
    this.put(wallArt('coast'), 4.0, L7.office.z1 - T / 2 - 0.03, Math.PI, 1.7);
    this.put(fireAlarm(), 16.0, L7.office.z1 - T / 2 - 0.02, Math.PI, 1.35);
    this.put(vent(), 11.0, L7.office.z0 + T / 2 + 0.01, 0, 2.6);
    for (let i = 0; i < 26; i++) {
      // North wall, behind the agents: the staff's misses
      const x = 1 + ((i * 7.31) % 15.5);
      const y = 0.9 + ((i * 3.7) % 1.5);
      this.bulletHoles.push({ pos: new THREE.Vector3(x, y, L7.office.z0 + T / 2 + 0.002), normal: new THREE.Vector3(0, 0, 1) });
    }
    for (let i = 0; i < 30; i++) {
      // The south wall and the barricades' faces: the agents'
      const x = 1 + ((i * 5.13) % 15.8);
      const y = 0.8 + ((i * 2.9) % 1.7);
      this.bulletHoles.push({ pos: new THREE.Vector3(x, y, L7.office.z1 - T / 2 - 0.002), normal: new THREE.Vector3(0, 0, -1) });
    }
  }

  // ----------------------------------------------------------------- cover

  /**
   * Cover to fight forward behind: across no-man's land and the staff's
   * side, staggered so there is always another piece a dash ahead — banks
   * of filing cabinets dragged out, cubicle walls still standing, and
   * slabs of the ceiling that came down with the hole, propped up on what
   * fell with them. All of it chest-high or more: crouched behind any of
   * it, nothing reaches him.
   */
  private buildCover(): void {
    this.concreteMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([142, 138, 131], 18), 1, 1) });
    this.fabricMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([88, 98, 114], 10), 2, 2) });
    // No-man's land
    this.slabCover(2.6, 12.2, 0.12, 1.9, 1);
    this.slabCover(15.4, 12.6, -0.2, 1.8, 2);
    this.cabinetBank(10.8, 9.6, 0.04, 2);
    this.cabinetBank(6.9, 9.0, -0.05, 2);
    this.partition(3.6, 9.4, 0.1, 1.8);
    this.partition(13.6, 9.6, -0.12, 1.7);
    this.moundCover(8.9, 10.7);
    // The staff's side, where he comes in
    this.partition(6.0, 18.2, 0.05, 2.0);
    this.cabinetBank(13.4, 18.2, 0.02, 2);
    this.slabCover(3.0, 17.8, 0.3, 1.7, 3);
  }

  private concreteMat!: THREE.MeshLambertMaterial;
  private fabricMat!: THREE.MeshLambertMaterial;
  private static unseen = new THREE.MeshBasicMaterial({ visible: false });

  /**
   * The solid part of a piece of cover made of props: the box he can't walk
   * through, and an unseen box the agents can't see through (props stop
   * bullets, but only these stop eyes). Axis-aligned round a small turn.
   */
  private coverBox(x: number, z: number, w: number, d: number, h: number, yaw: number): void {
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    this.blk(x, z, w * c + d * s, w * s + d * c, h);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), Level7Builder.unseen);
    m.position.set(x, h / 2, z);
    m.rotation.y = yaw;
    this.group.add(m);
    this.occluders.push(m);
  }

  /** Tall filing cabinets dragged out side by side, drawers to the south, one hanging open. */
  private cabinetBank(x: number, z: number, yaw: number, n: number): void {
    const g = new THREE.Group();
    const w = 0.92;
    for (let i = 0; i < n; i++) {
      const fc = fileCabinet(0.5, 1.42, 0.9, 4);
      fc.position.set(0, 0, (i - (n - 1) / 2) * w);
      fc.rotation.y = (i % 2 ? 1 : -1) * 0.03;
      g.add(fc);
    }
    // A drawer pulled out, files spilling
    const drawer = this.box(0.5, 0.3, 0.8, this.darkMetal, -0.52, 0.62, (n - 1) / 2 * -w);
    g.add(drawer);
    this.put(g, x, z, Math.PI / 2 + yaw);
    this.put(scatteredPaper(5, 0.6), x - (n - 1) / 2 * w * Math.cos(yaw), z + 0.9, yaw);
    this.coverBox(x, z, n * w, 0.55, 1.42, yaw);
  }

  /** A cubicle wall still standing: fabric panel, aluminium frame and feet. */
  private partition(x: number, z: number, yaw: number, w: number): void {
    const g = new THREE.Group();
    const h = 1.55;
    g.add(this.box(w, h - 0.06, 0.06, this.fabricMat, 0, 0.06 + (h - 0.06) / 2, 0));
    g.add(this.box(w + 0.03, 0.035, 0.075, this.steel, 0, h, 0));
    for (const sx of [-1, 1]) {
      g.add(this.box(0.04, h, 0.08, this.steel, (sx * w) / 2, h / 2, 0));
      g.add(this.box(0.06, 0.03, 0.5, this.steel, (sx * (w - 0.1)) / 2, 0.015, 0));
    }
    // Something still pinned to it
    g.add(this.box(0.21, 0.29, 0.005, new THREE.MeshLambertMaterial({ color: 0xe9e4d6 }), w * 0.2, 1.15, 0.034));
    this.put(g, x, z, yaw);
    this.coverBox(x, z, w, 0.12, h, yaw);
  }

  /**
   * A slab of the floor above, down through the ceiling: stood up on its
   * edge where it landed, leant back on the rubble that came with it, rebar
   * out of its broken end.
   */
  private slabCover(x: number, z: number, yaw: number, w: number, seed: number): void {
    const g = new THREE.Group();
    const slab = this.box(w, 1.3, 0.24, this.concreteMat, 0, 0.62, 0);
    slab.rotation.x = -0.22;
    slab.rotation.z = (seed % 2 ? 1 : -1) * 0.05;
    g.add(slab);
    // Its broken top edge: chunks, and the steel through it
    for (let i = 0; i < 4; i++) {
      const c = this.box(0.25 + (i % 2) * 0.15, 0.18, 0.26, this.concreteMat, -w / 2 + 0.3 + i * (w - 0.5) / 3, 1.28 - (i % 3) * 0.05, 0.12);
      c.rotation.set(0.3 * i, 0.4 * i, 0.2);
      g.add(c);
    }
    for (let i = 0; i < 5; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35 + (i % 3) * 0.12, 5), this.darkMetal);
      bar.position.set(-w / 2 + 0.2 + i * (w - 0.4) / 4, 1.4, 0.15);
      bar.rotation.set(0.5 - i * 0.2, 0, 0.3 * (i - 2));
      g.add(bar);
    }
    // What it is leant on, behind, and what is round its foot
    g.add(rubble(0.9, 20 + seed));
    g.children[g.children.length - 1].position.set(0.2, 0, 0.55);
    this.put(g, x, z, yaw);
    this.put(rubblePile(0.45), x + Math.cos(yaw) * (w / 2 + 0.2), z - Math.sin(yaw) * (w / 2 + 0.2), seed);
    this.put(rubble(0.55, 30 + seed), x - Math.cos(yaw) * (w / 2), z + Math.sin(yaw) * (w / 2) - 0.2, seed * 0.7);
    this.coverBox(x, z + 0.15, w, 0.75, 1.3, yaw);
  }

  /** Where the hole is: a heap of what came down, built up into a mound worth getting behind. */
  private moundCover(x: number, z: number): void {
    const g = new THREE.Group();
    const a = this.box(1.6, 0.22, 1.1, this.concreteMat, 0, 0.75, 0);
    a.rotation.set(0.35, 0.4, -0.25);
    const b = this.box(1.3, 0.2, 0.9, this.concreteMat, 0.3, 0.42, 0.2);
    b.rotation.set(-0.3, 1.1, 0.3);
    g.add(a, b);
    this.put(g, x, z);
    this.put(rubble(1.1, 41), x - 0.4, z + 0.3, 0.6);
    this.put(rubblePile(0.7), x + 0.5, z - 0.2, 1.4);
    this.coverBox(x, z, 1.8, 1.3, 1.1, 0);
  }

  // ------------------------------------------------------------ corridors

  /**
   * Along the top: the lift doors in the core wall (one dented in), a
   * vending machine and the restroom door opposite.
   */
  private buildTopCorridor(): void {
    const z = L7.topCorridor.z1 - T / 2 - 0.02;
    for (const x of [21.6, 24.6]) {
      const lift = new THREE.Group();
      lift.add(this.box(1.5, 2.3, 0.06, this.frameMat, 0, 1.15, 0));
      const leaf = this.box(0.62, 2.12, 0.04, this.steel, -0.32, 1.06, -0.04);
      const leaf2 = this.box(0.62, 2.12, 0.04, this.steel, 0.32, 1.06, -0.04);
      if (x === 24.6) leaf2.rotation.y = 0.12; // pried at
      lift.add(leaf, leaf2);
      lift.add(this.box(0.6, 0.18, 0.03, new THREE.MeshStandardMaterial({ color: 0x110805, emissive: 0xff5a1a, emissiveIntensity: 1.1 }), 0, 2.48, -0.03));
      lift.add(this.box(0.1, 0.24, 0.03, this.steel, 0.98, 1.2, -0.03));
      this.put(lift, x, z, 0);
    }
    this.put(roomSign('LIFTS', 'OUT OF SERVICE'), 23.1, z - 0.02, Math.PI, 2.2);
    // The restroom door, propped open
    const d = this.box(1.0, 2.1, 0.05, new THREE.MeshLambertMaterial({ color: 0x7a6a56 }), 0.5, 1.05, 0);
    const hinge = new THREE.Group().add(d);
    hinge.rotation.y = -1.9;
    this.put(new THREE.Group().add(hinge), L7.restroomDoor.x - 0.62, -0.02, 0);
    this.put(roomSign('RESTROOM'), L7.restroomDoor.x + 1.1, T / 2 + 0.02, 0, 1.75);
    const vm = vendingMachine();
    // Its front (−z) out to the corridor, not to the wall behind it
    this.put(vm, 30.9, 1.4, Math.PI / 2);
    this.blk(30.9, 1.4, 0.8, 1.0, 1.95);
    this.put(flowerPot('bushy'), 18.6, 3.5);
    this.put(scatteredPaper(5, 0.9), 26.5, 2.0, 0.3);
    this.puddle(23.9, 0.9, 0.7, 17);
    this.puddle(25.2, 1.6, 0.5, 19);
  }

  /** Down the east side: an extinguisher, the alarm light, and the stairwell door at the bottom. */
  private buildEastCorridor(): void {
    const EC = L7.eastCorridor;
    const x = L7.exitDoor.x;
    const face = EC.z1 - T / 2;
    const w = L7.exitDoor.w;
    // Frame, leaf and push bar — shut, and the trigger in front does the rest
    for (const dx of [-w / 2, w / 2]) this.solid(0.1, 2.25, 0.12, x + dx, 0, face - 0.06, this.darkMetal, { surface: 'metal', collide: false });
    this.solid(w + 0.1, 0.1, 0.12, x, 2.25, face - 0.06, this.darkMetal, { surface: 'metal', collide: false });
    this.solid(w - 0.06, 2.2, 0.07, x, 0, face - 0.05, this.steel, { surface: 'metal' });
    this.solid(w * 0.7, 0.06, 0.06, x, 1.02, face - 0.12, this.darkMetal, { surface: 'metal', occlude: false, collide: false });
    this.put(roomSign('STAIRWELL B', 'ALL FLOORS — GARAGE'), x, face - 0.1, Math.PI, 2.45);
    // The mag-lock panel: red until security releases it
    this.exitPanel = new THREE.MeshStandardMaterial({ color: 0x2a0a0a, emissive: 0xff2b1c, emissiveIntensity: 1.6 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.04), this.exitPanel);
    panel.position.set(x + w / 2 + 0.25, 1.35, face - 0.04);
    this.group.add(panel);
    this.exitLight = new THREE.PointLight(0xff3b28, 2.0, 4, 1.9);
    this.exitLight.position.set(x + w / 2 + 0.25, 1.5, face - 0.5);
    this.group.add(this.exitLight);
    // EXIT over the door
    const exitSign = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.16, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x0b2a12, emissive: 0x2bff6a, emissiveIntensity: 1.3 })
    );
    exitSign.position.set(x, 2.72, face - 0.05);
    this.group.add(exitSign);
    // An extinguisher on the wall, and the alarm beacon that is going off
    const ext = new THREE.Group();
    const red = new THREE.MeshLambertMaterial({ color: 0xb4161a });
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.5, 12), red);
    can.position.y = 0.25;
    ext.add(can);
    ext.add(this.box(0.05, 0.08, 0.05, this.darkMetal, 0, 0.54, 0));
    this.put(ext, EC.x1 - T / 2 - 0.1, 9.5, 0, 0.4);
    this.alarmMat = new THREE.MeshStandardMaterial({ color: 0x300404, emissive: 0xff1a12, emissiveIntensity: 0.4 });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 12), this.alarmMat);
    beacon.position.set(EC.x1 - T / 2 - 0.08, 2.6, 7.0);
    this.group.add(beacon);
    this.alarm = new THREE.PointLight(0xff2a1a, 0, 9, 1.6);
    this.alarm.position.set(EC.x1 - 0.5, 2.5, 7.0);
    this.group.add(this.alarm);
    this.put(fireAlarm(), EC.x0 + T / 2 + 0.02, 12.0, Math.PI / 2, 1.35);
    this.put(scatteredPaper(4, 0.8), 29.6, 9.0, 1.2);
  }

  // ------------------------------------------------------------- restroom

  /** Four stalls along the back, basins along the side, and a pipe under them that has let go. */
  private buildRestroom(): void {
    const R = L7.restroom;
    const back = R.z0 + T / 2;
    for (let i = 0; i < 4; i++) {
      const x = R.x0 + 0.9 + i * 1.12;
      this.put(toiletStall(0.3 + (i % 3) * 0.5), x, back + STALL_D / 2, 0);
      this.blk(x - 0.55, back + STALL_D / 2, 0.05, STALL_D, 2.0);
      this.blk(x + 0.55, back + STALL_D / 2, 0.05, STALL_D, 2.0);
    }
    // Basins on the east wall, mirror over them
    const vx = R.x1 - T / 2 - 0.27;
    this.put(bathroomVanity(2.4, 3), vx, -2.0, -Math.PI / 2);
    this.blk(vx, -2.0, 0.55, 2.4, 0.9);
    this.put(mirrorPanel(2.3, 0.9), R.x1 - T / 2 - 0.02, -2.0, -Math.PI / 2, 1.55);
    // The water, across the tiles and out of the door
    this.puddle(27.2, -2.9, 1.1, 23);
    this.puddle(25.6, -1.6, 1.0, 29);
    this.puddle(24.2, -0.6, 0.8, 31);
    this.put(trashCan(), R.x0 + 5.6, -0.5);
  }

  // ------------------------------------------------------------- security

  /**
   * The security room: a wall of CCTV screens on the east side over a long
   * desk, a chair, a rack, and lockers. The big screen in the middle is the
   * one the scene draws the stairwell camera onto.
   */
  private buildSecurity(): void {
    const S = L7.security;
    const wallX = S.x1 - T / 2;
    // The desk along the wall
    const desk = new THREE.Group();
    desk.add(this.box(0.8, 0.05, 4.4, new THREE.MeshLambertMaterial({ color: 0x3a3f46 }), 0, 0.76, 0));
    desk.add(this.box(0.76, 0.72, 0.05, this.darkMetal, 0, 0.36, -2.15));
    desk.add(this.box(0.76, 0.72, 0.05, this.darkMetal, 0, 0.36, 2.15));
    desk.add(this.box(0.04, 0.6, 4.3, this.darkMetal, 0.36, 0.42, 0));
    // Keyboards and a joystick for the cameras
    desk.add(this.box(0.18, 0.025, 0.46, new THREE.MeshLambertMaterial({ color: 0x1b1d20 }), -0.1, 0.79, -0.6));
    desk.add(this.box(0.18, 0.025, 0.46, new THREE.MeshLambertMaterial({ color: 0x1b1d20 }), -0.1, 0.79, 0.7));
    desk.add(this.box(0.08, 0.12, 0.08, new THREE.MeshLambertMaterial({ color: 0x24262a }), -0.08, 0.84, 0.05));
    this.put(desk, wallX - 0.42, 19.6);
    this.blk(wallX - 0.42, 19.6, 0.82, 4.4, 0.8);
    this.put(officeChair(0.48), wallX - 1.2, 19.9, -Math.PI / 2 + 0.4);

    // The screens: a 3 x 3 wall of the building's floors and corridors. Two
    // of the feeds are dead — the middle one, big, among them — and show
    // only snow, which the scene keeps moving.
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 80;
    const snowTex = new THREE.CanvasTexture(c);
    snowTex.colorSpace = THREE.SRGBColorSpace;
    this.snow = { canvas: c, texture: snowTex };
    drawStatic(c);
    snowTex.needsUpdate = true;
    const snowMat = new THREE.MeshBasicMaterial({ map: snowTex });
    const feeds: [string, 'office' | 'corridor' | 'snow'][] = [
      ['CAM 01  FLOOR 9 WEST', 'office'], ['CAM 02  FLOOR 9 EAST', 'office'], ['CAM 03  CORRIDOR 9', 'corridor'],
      ['CAM 04  FLOOR 8 WEST', 'office'], ['', 'snow'], ['CAM 05  FLOOR 8 EAST', 'office'],
      ['CAM 06  CORRIDOR 8', 'corridor'], ['CAM 08', 'snow'], ['CAM 09  FLOOR 7', 'office']
    ];
    let k = 0;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const [label, kind] = feeds[k++];
        const zc = 19.6 + (col - 1) * 0.92;
        const y = 1.25 + (2 - row) * 0.56;
        if (row === 1 && col === 1) continue;
        const scr = new THREE.Mesh(
          new THREE.PlaneGeometry(0.84, 0.5),
          kind === 'snow' ? snowMat : new THREE.MeshBasicMaterial({ map: cctvTexture(label, k, kind) })
        );
        scr.position.set(wallX - 0.05, y, zc);
        scr.rotation.y = -Math.PI / 2;
        this.group.add(scr);
        this.dressing.push(scr);
        const bezel = this.box(0.06, 0.54, 0.88, this.frameMat, wallX - 0.02, y, zc);
        this.put(new THREE.Group().add(bezel), 0, 0);
      }
    }
    // The big one in the middle: dead too
    const big = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.56), snowMat);
    big.position.set(wallX - 0.05, 1.81, 19.6);
    big.rotation.y = -Math.PI / 2;
    this.group.add(big);
    this.put(new THREE.Group().add(this.box(0.06, 0.6, 0.94, this.frameMat, wallX - 0.02, 1.81, 19.6)), 0, 0);

    // A rack humming in the corner, lockers by the door
    const rack = new THREE.Group();
    rack.add(this.box(0.6, 1.9, 0.7, this.frameMat, 0, 0.95, 0));
    for (let i = 0; i < 8; i++) {
      rack.add(this.box(0.02, 0.06, 0.5, new THREE.MeshStandardMaterial({ color: 0x0a120a, emissive: i % 3 === 0 ? 0x33ff66 : 0x1a6aff, emissiveIntensity: 0.9 }), -0.31, 0.4 + i * 0.18, 0));
    }
    this.put(rack, wallX - 0.4, S.z0 + 0.6, 0);
    this.blk(wallX - 0.4, S.z0 + 0.6, 0.62, 0.72, 1.9);
    for (let i = 0; i < 3; i++) {
      const locker = new THREE.Group();
      locker.add(this.box(0.48, 1.85, 0.5, new THREE.MeshLambertMaterial({ color: 0x55606b }), 0, 0.925, 0));
      locker.add(this.box(0.02, 0.18, 0.04, this.steel, 0.2, 1.05, -0.26));
      this.put(locker, S.x0 + T / 2 + 0.3, S.z1 - 0.8 - i * 0.5, Math.PI / 2);
    }
    this.blk(S.x0 + T / 2 + 0.3, S.z1 - 1.3, 0.55, 1.5, 1.85);
    this.put(roomSign('SECURITY', 'AUTHORISED ONLY'), S.x0 - T / 2 - 0.02, L7.securityDoor.z + 1.0, -Math.PI / 2, 1.8);
    // The door: kicked in
    const leaf = this.box(1.0, 2.1, 0.05, new THREE.MeshLambertMaterial({ color: 0x5a636c }), 0.5, 1.05, 0);
    const hinge = new THREE.Group().add(leaf);
    hinge.rotation.y = 1.7;
    this.put(new THREE.Group().add(hinge), S.x0 + 0.05, L7.securityDoor.z - 0.6, Math.PI / 2);
    this.put(scatteredPaper(5, 0.8), 20.2, 21.6, 0.4);
  }

  /** The hallway out of the boss's office: plain, a plant, a picture, and a bin. */
  private buildHall(): void {
    const HL = L7.hall;
    this.put(flowerPot('tall'), HL.x0 + 0.45, HL.z1 - 0.45);
    this.put(wallArt('peaks'), 16.5, HL.z0 + T / 2 + 0.03, 0, 1.7);
    this.put(trashCan(), 19.8, HL.z1 - 0.4);
    this.put(roomSign('EXECUTIVE', 'PRIVATE'), L7.boss.cx - 3 - T - 0.02, L7.boss.cz - 0.3, -Math.PI / 2, 1.8);
  }

  // -------------------------------------------------------------- lighting

  /**
   * Few lights, and every one of them earns its place: the counts are what
   * cost, on every pixel of every lit surface. Fixed from the first frame and
   * driven by intensity only — the number of lights is baked into every
   * shader, and changing it recompiles the whole floor.
   */
  private buildLighting(): void {
    this.group.add(new THREE.AmbientLight(0x6e737c, 0.55));
    this.group.add(new THREE.HemisphereLight(0xc4d0dc, 0x3a3630, 0.5));
    // Daylight in through the west windows
    const day = new THREE.PointLight(0xd6e2f2, 13, 24, 1.1);
    day.position.set(2.2, 2.4, 12.3);
    this.group.add(day);

    const panel = (x: number, z: number, intensity = 7, dist = 11): void => {
      const l = new THREE.PointLight(0xfff2dc, intensity, dist, 1.6);
      l.position.set(x, H - 0.25, z);
      this.group.add(l);
      const fix = this.box(1.2, 0.07, 0.3, new THREE.MeshStandardMaterial({ color: 0x999999, emissive: 0xfff6e0, emissiveIntensity: 1.4 }), x, H - 0.05, z);
      this.group.add(fix);
    };
    // The office: two still working, one sputtering, one hanging by a wire
    panel(4.5, 4.0);
    panel(12.5, 4.5);
    panel(8.5, 20.5, 7, 12);
    this.flickering.push(new FlickeringLight(this.group, new THREE.Vector3(13.5, H - 0.25, 13.0), 6, 10));
    // The dead one: dangling on one corner, tube dark
    const dead = this.box(1.2, 0.07, 0.3, new THREE.MeshLambertMaterial({ color: 0x8c8f92 }), 0, 0, 0.0);
    dead.position.set(-0.55, -0.6, 0);
    dead.rotation.z = 1.1;
    const dangle = new THREE.Group().add(dead);
    this.put(dangle, 4.4, 12.6, 0.3, H - 0.05);
    this.put(new THREE.Group().add(cable([new THREE.Vector3(4.4, H, 12.6), new THREE.Vector3(4.3, H - 0.4, 12.62)], 0.008)), 0, 0);
    this.sparks.push(new THREE.Vector3(4.15, H - 0.75, 12.66));
    // Corridors, restroom, security room, hallway — one each
    panel(24.5, 2.0, 6, 10);
    panel(22.5, -2.1, 5, 8);
    panel(15.5, 30.0, 5, 10);
    // The CCTV wall throws a cold glow of its own
    const glow = new THREE.PointLight(0x8fb2ff, 3.6, 8.5, 1.5);
    glow.position.set(L7.security.x1 - 1.3, 1.9, 19.6);
    this.group.add(glow);
  }

  // --------------------------------------------------------------- outside

  /**
   * What the windows look out on, eight floors down: the car park, rows of
   * cars, trees round it and along the road, and the sky. All of it unlit
   * colour — it is far away and lit by the day, not by anything in here —
   * and instanced, so the whole view is a handful of draws.
   */
  private buildOutside(): void {
    const G = L7.ground;
    const flat = (color: number | THREE.Texture): THREE.MeshBasicMaterial =>
      typeof color === 'number'
        ? new THREE.MeshBasicMaterial({ color, fog: false })
        : new THREE.MeshBasicMaterial({ map: color, fog: false });

    // Sky
    // Inside the camera's reach (the scene sets it to 600)
    const sky = new THREE.Mesh(new THREE.SphereGeometry(520, 24, 12), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.position.set(8, G, 12);
    sky.renderOrder = -1;
    this.group.add(sky);
    // Grass to the horizon
    const grassTex = makeTex(noiseCanvas([84, 108, 62], 18), 60, 60);
    grassTex.magFilter = THREE.LinearFilter;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), flat(grassTex));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(-150, G, 12);
    this.group.add(ground);
    // The car park
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(84, 110), flat(lotTexture()));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(-54, G + 0.05, 12);
    this.group.add(lot);
    // The road beyond it
    const road = new THREE.Mesh(new THREE.PlaneGeometry(12, 900), flat(0x3a3c3f));
    road.rotation.x = -Math.PI / 2;
    road.position.set(-108, G + 0.04, 12);
    this.group.add(road);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 900), flat(0xd8c860));
    line.rotation.x = -Math.PI / 2;
    line.position.set(-108, G + 0.06, 12);
    this.group.add(line);

    // Cars: rows of bays either side of the aisles, about two in three taken
    const bodies: THREE.Matrix4[] = [];
    const colours: THREE.Color[] = [];
    const palette = [0xb8bcc0, 0x2a2c30, 0xe6e6e2, 0x7a1c1c, 0x1d3a6a, 0x5d6268, 0x4a5a3a, 0xc8b28a, 0x9a9da2, 0x101214];
    let seed = 17;
    const rnd = (): number => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (const rowX of [-20, -32, -38, -52, -58, -72, -78, -90]) {
      for (let z = -38; z <= 62; z += 2.8) {
        if (rnd() > 0.68) continue;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(rowX + (rnd() - 0.5) * 0.4, G + 0.05, z + (rnd() - 0.5) * 0.3),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rnd() - 0.5) * 0.08),
          new THREE.Vector3(1, 1, 1)
        );
        bodies.push(m);
        colours.push(new THREE.Color(palette[Math.floor(rnd() * palette.length)]));
      }
    }
    const bodyGeo = new THREE.BoxGeometry(4.4, 0.95, 1.85);
    bodyGeo.translate(0, 0.62, 0);
    const cabGeo = new THREE.BoxGeometry(2.3, 0.62, 1.66);
    cabGeo.translate(-0.25, 1.4, 0);
    const shadowGeo = new THREE.PlaneGeometry(4.8, 2.2);
    shadowGeo.rotateX(-Math.PI / 2);
    shadowGeo.translate(0, 0.02, 0);
    const bodyMesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshBasicMaterial({ fog: false }), bodies.length);
    const cabMesh = new THREE.InstancedMesh(cabGeo, new THREE.MeshBasicMaterial({ color: 0x1c242c, fog: false }), bodies.length);
    const shadowMesh = new THREE.InstancedMesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x24262a, fog: false, transparent: true, opacity: 0.5, depthWrite: false }), bodies.length);
    bodies.forEach((m, i) => {
      bodyMesh.setMatrixAt(i, m);
      cabMesh.setMatrixAt(i, m);
      shadowMesh.setMatrixAt(i, m);
      bodyMesh.setColorAt(i, colours[i]);
    });
    for (const im of [shadowMesh, bodyMesh, cabMesh]) {
      im.frustumCulled = false;
      this.group.add(im);
    }

    // Trees: along the road, round the lot, and in a band out to the horizon
    const trees: THREE.Matrix4[] = [];
    const greens: THREE.Color[] = [];
    const tree = (x: number, z: number, s: number): void => {
      trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x, G, z), new THREE.Quaternion(), new THREE.Vector3(s, s * (0.9 + rnd() * 0.3), s)));
      greens.push(new THREE.Color().setHSL(0.24 + rnd() * 0.08, 0.38 + rnd() * 0.2, 0.2 + rnd() * 0.1));
    };
    for (let z = -50; z <= 74; z += 6 + rnd() * 3) {
      tree(-99 + rnd() * 2, z, 1 + rnd() * 0.5);
      tree(-117 - rnd() * 3, z + 2, 1 + rnd() * 0.6);
    }
    for (let x = -94; x <= -14; x += 7 + rnd() * 3) {
      tree(x, -44 - rnd() * 2, 0.9 + rnd() * 0.5);
      tree(x, 68 + rnd() * 2, 0.9 + rnd() * 0.5);
    }
    for (const x of [-26, -45, -65, -84]) for (const z of [-30, 0, 30, 55]) tree(x, z, 0.8 + rnd() * 0.3);
    for (let i = 0; i < 160; i++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.6;
      const r = 150 + rnd() * 120;
      tree(-60 - Math.cos(a) * r * 0.2 - r * 0.6, 12 + Math.sin(a) * r, 1.4 + rnd() * 1.2);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 3, 6);
    trunkGeo.translate(0, 1.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(2.6, 0);
    crownGeo.translate(0, 4.6, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshBasicMaterial({ color: 0x4a3828, fog: false }), trees.length);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshBasicMaterial({ fog: false }), trees.length);
    trees.forEach((m, i) => {
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, greens[i]);
    });
    for (const im of [trunks, crowns]) {
      im.frustumCulled = false;
      this.group.add(im);
    }
    // Lamp posts down the aisles
    const lamps: THREE.Matrix4[] = [];
    for (const x of [-26, -45, -65, -84]) for (let z = -32; z <= 58; z += 18) lamps.push(new THREE.Matrix4().makeTranslation(x, G, z + 9));
    const postGeo = new THREE.CylinderGeometry(0.1, 0.12, 7, 6);
    postGeo.translate(0, 3.5, 0);
    const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshBasicMaterial({ color: 0x55595e, fog: false }), lamps.length);
    lamps.forEach((m, i) => posts.setMatrixAt(i, m));
    posts.frustumCulled = false;
    this.group.add(posts);
  }

  // ------------------------------------------------------------- waypoints

  /**
   * A walkable graph from the level itself: sample the floor on a grid,
   * keep every point a body fits at, and join two points only when a body
   * can be swept between them without touching anything.
   */
  private makeWaypoints(): Waypoint[] {
    const R = 0.42;
    const STEP = 1.2;
    const walls = this.colliders.map((c) => c.box).filter((b) => b.min.y < 1.6 && b.max.y > 0.4);
    const clear = (x: number, z: number, r = R): boolean => {
      for (const b of walls) {
        if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return false;
      }
      return true;
    };
    const walkable = (ax: number, az: number, bx: number, bz: number): boolean => {
      const dx = bx - ax;
      const dz = bz - az;
      const steps = Math.ceil(Math.hypot(dx, dz) / 0.18);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (!clear(ax + dx * t, az + dz * t, R + 0.05)) return false;
      }
      return true;
    };
    const pts: [number, number][] = [];
    for (const d of this.doorPoints) if (clear(d[0], d[1])) pts.push(d);
    const areas = [L7.office, L7.topCorridor, L7.eastCorridor, L7.restroom, L7.security, L7.vestibule, L7.hall];
    for (const a of areas) {
      for (let x = a.x0 + 0.6; x <= a.x1 - 0.6; x += STEP) {
        for (let z = a.z0 + 0.6; z <= a.z1 - 0.6; z += STEP) {
          if (clear(x, z)) pts.push([x, z]);
        }
      }
    }
    // The boss's office
    for (let x = L7.boss.cx - 2.6; x <= L7.boss.cx + 2.6; x += 1.0) {
      for (let z = L7.boss.cz - 2.1; z <= L7.boss.cz + 2.1; z += 1.0) if (clear(x, z)) pts.push([x, z]);
    }
    const wps: Waypoint[] = pts.map(([x, z]) => ({ pos: new THREE.Vector3(x, 0, z), links: [] }));
    const REACH = STEP * 2.2;
    for (let i = 0; i < wps.length; i++) {
      for (let j = i + 1; j < wps.length; j++) {
        const a = wps[i].pos;
        const b = wps[j].pos;
        if (a.distanceTo(b) > REACH) continue;
        if (!walkable(a.x, a.z, b.x, b.z)) continue;
        wps[i].links.push(j);
        wps[j].links.push(i);
      }
    }
    // Keep the biggest island
    const seen = new Set<number>();
    let best: number[] = [];
    for (let i = 0; i < wps.length; i++) {
      if (seen.has(i)) continue;
      const comp: number[] = [];
      const queue = [i];
      seen.add(i);
      while (queue.length) {
        const cur = queue.pop()!;
        comp.push(cur);
        for (const n of wps[cur].links) {
          if (seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
        }
      }
      if (comp.length > best.length) best = comp;
    }
    const keep = best.sort((a, b) => a - b);
    const remap = new Map(keep.map((old, k) => [old, k]));
    return keep.map((old) => ({
      pos: wps[old].pos,
      links: wps[old].links.filter((n) => remap.has(n)).map((n) => remap.get(n)!)
    }));
  }
}

// ---------------------------------------------------------------- textures

/** Washroom tile: small squares with a darker grout line between them. */
function tileCanvas(floor: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const n = floor ? 8 : 6;
  const step = 128 / n;
  g.fillStyle = floor ? '#7d8288' : '#b9c3c6';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 1 + (Math.random() - 0.5) * 0.08;
      const b = floor ? [125, 130, 136] : [185, 195, 198];
      g.fillStyle = `rgb(${b[0] * v | 0},${b[1] * v | 0},${b[2] * v | 0})`;
      g.fillRect(x * step + 1, y * step + 1, step - 2, step - 2);
    }
  }
  return c;
}

/**
 * A CCTV feed of somewhere in the building, high in a corner looking down
 * its length: an office floor with its rows of desks and screens (some of
 * them over on their sides), or a corridor with its doors. Grey and grainy,
 * with the camera's name and the time burned in.
 */
function cctvTexture(label: string, seed: number, kind: 'office' | 'corridor'): THREE.CanvasTexture {
  const W = 256;
  const Hh = 160;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Hh;
  const g = c.getContext('2d')!;
  let s = seed * 7919 + 13;
  const rnd = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  g.fillStyle = '#15191b';
  g.fillRect(0, 0, W, Hh);
  // Where it all runs away to
  const vx = 128 + (rnd() - 0.5) * 70;
  const vy = kind === 'office' ? 44 : 52;
  const half = kind === 'office' ? 78 : 26;
  // Back wall, side walls, floor
  g.fillStyle = '#3b4346';
  g.fillRect(vx - half, 8, half * 2, vy - 8);
  g.fillStyle = '#2f3639';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(vx - half, 8);
  g.lineTo(vx - half, vy);
  g.lineTo(0, Hh);
  g.fill();
  g.beginPath();
  g.moveTo(W, 0);
  g.lineTo(vx + half, 8);
  g.lineTo(vx + half, vy);
  g.lineTo(W, Hh);
  g.fill();
  g.fillStyle = '#272d30';
  g.beginPath();
  g.moveTo(0, Hh);
  g.lineTo(W, Hh);
  g.lineTo(vx + half, vy);
  g.lineTo(vx - half, vy);
  g.fill();
  // Ceiling lights, getting smaller towards the back
  g.fillStyle = '#9aa6a8';
  for (const d of [0.15, 0.4, 0.75]) {
    const w = 10 + d * 50;
    g.fillRect(vx - w / 2, 8 - d * 6, w, 2 + d * 3);
  }
  if (kind === 'office') {
    // Rows of desks, near ones bigger; now and then one on its side
    for (const d of [0.12, 0.3, 0.52, 0.78]) {
      const y = vy + (Hh - vy) * d;
      const sc = 0.3 + d * 1.1;
      for (let col = -2; col <= 2; col++) {
        const x = vx + col * 52 * sc;
        if (x < -30 || x > W + 30) continue;
        if (rnd() < 0.22) {
          // Over on its side
          g.fillStyle = '#3f4649';
          g.fillRect(x - 16 * sc, y - 10 * sc, 32 * sc, 12 * sc);
          continue;
        }
        g.fillStyle = '#4d5558';
        g.fillRect(x - 19 * sc, y, 38 * sc, 7 * sc);
        g.fillStyle = rnd() < 0.7 ? '#7b959e' : '#2a3133';
        g.fillRect(x - 5 * sc, y - 9 * sc, 10 * sc, 8 * sc);
        g.fillStyle = '#1d2224';
        g.beginPath();
        g.arc(x + 4 * sc, y + 12 * sc, 4.5 * sc, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Paper on the floor
    g.fillStyle = 'rgba(200,205,205,0.45)';
    for (let i = 0; i < 14; i++) g.fillRect(rnd() * W, vy + 20 + rnd() * (Hh - vy - 20), 4, 3);
  } else {
    // Doors down both sides
    g.fillStyle = '#1e2325';
    for (const d of [0.2, 0.45, 0.75]) {
      const y = vy + (Hh - vy) * d;
      const xL = vx - half - (vx - half) * d;
      const xR = vx + half + (W - vx - half) * d;
      const hgt = 26 + d * 70;
      g.fillRect(xL + 4, y - hgt, 10 + d * 14, hgt);
      g.fillRect(xR - 14 - d * 14, y - hgt, 10 + d * 14, hgt);
    }
  }
  // Grain and scanlines
  for (let i = 0; i < 1100; i++) {
    const v = 30 + Math.random() * 70;
    g.fillStyle = 'rgba(' + v + ',' + (v + 6) + ',' + (v + 8) + ',0.32)';
    g.fillRect(Math.random() * W, Math.random() * Hh, 1, 1);
  }
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < Hh; y += 3) g.fillRect(0, y, W, 1);
  g.fillStyle = '#d8e0e4';
  g.font = 'bold 13px monospace';
  g.fillText(label, 8, 18);
  g.fillText('06:4' + (seed % 10) + ':1' + ((seed * 3) % 10), 186, 152);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Static: a dead feed, snow and the odd tear across it. Drawn into a small
 * canvas and stretched — at a few frames a second it reads as the real thing.
 */
export function drawStatic(c: HTMLCanvasElement): void {
  const g = c.getContext('2d')!;
  const img = g.createImageData(c.width, c.height);
  const d = img.data;
  let tear = Math.random() < 0.3 ? Math.floor(Math.random() * c.height) : -1;
  for (let y = 0; y < c.height; y++) {
    const band = y === tear || y === tear + 1 ? 70 : 0;
    const roll = 0.75 + 0.25 * Math.sin((y / c.height) * 9 + Math.random());
    for (let x = 0; x < c.width; x++) {
      const v = Math.min(255, (Math.random() * 190 + band) * roll);
      const i = (y * c.width + x) * 4;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = Math.min(255, v * 1.05);
      d[i + 3] = 255;
    }
    if (y === tear + 1 && Math.random() < 0.5) tear = Math.floor(Math.random() * c.height);
  }
  g.putImageData(img, 0, 0);
}

/** The sky: a pale late-afternoon blue going warm towards the horizon. */
function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5f86b8');
  grad.addColorStop(0.42, '#9fbbd8');
  grad.addColorStop(0.5, '#e4d9c4');
  grad.addColorStop(0.56, '#c8c2b0');
  grad.addColorStop(1, '#6d7a5a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Asphalt with the bays painted on: rows running north to south either side of the aisles. */
function lotTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 840;
  c.height = 1100;
  const g = c.getContext('2d')!;
  g.fillStyle = '#45484c';
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9000; i++) {
    const v = 55 + Math.random() * 30;
    g.fillStyle = `rgba(${v},${v + 2},${v + 4},0.5)`;
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
  }
  // 10px a metre; the lot is centred at x -54 and runs 84m east to west
  const px = (x: number): number => (x - -96) * 10;
  g.strokeStyle = '#d9d6cc';
  g.lineWidth = 2;
  for (const rowX of [-20, -32, -38, -52, -58, -72, -78, -90]) {
    for (let z = -39.4; z <= 64; z += 2.8) {
      const y = (z + 43) * 10;
      g.beginPath();
      g.moveTo(px(rowX - 2.4), y);
      g.lineTo(px(rowX + 2.4), y);
      g.stroke();
    }
  }
  // Arrows down the aisles
  g.fillStyle = '#d9d6cc';
  for (const ax of [-26, -45, -65, -84]) {
    for (let z = -30; z <= 60; z += 22) {
      const x = px(ax);
      const y = (z + 43) * 10;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - 8, y + 20);
      g.lineTo(x + 8, y + 20);
      g.fill();
      g.fillRect(x - 2, y + 20, 4, 18);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
