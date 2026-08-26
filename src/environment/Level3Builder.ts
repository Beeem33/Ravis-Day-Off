import * as THREE from 'three';
import { FlickeringLight } from './FlickeringLight';
import { BreakableGlass } from './BreakableGlass';
import {
  Collider, Waypoint, EnemySpawn, noiseCanvas, ceilingTileCanvas, spreadsheetCanvas, makeTex
} from './OfficeLevelBuilder';
import {
  officeChair, trashCan, sodaCan, paperStack, scatteredPaper, fileCabinet, book, spilledCoffee,
  chipsBox, snack, printer, vent, fireAlarm, breakTable, vendingMachine, swatTruck, rubblePile
} from './OfficeProps';

export interface Level3Data {
  group: THREE.Group;
  colliders: Collider[];
  shootables: THREE.Object3D[];
  occluders: THREE.Object3D[];
  waypoints: Waypoint[];
  glassPanes: BreakableGlass[];
  flickering: FlickeringLight[];
  playerSpawn: THREE.Vector3;
  playerSpawnYaw: number;
  /** Where the player stands, unable to move, for the opening. */
  introStand: THREE.Vector3;
  introYaw: number;
  /** Staff at their desks, already seated and working. */
  deskWorkers: EnemySpawn[];
  /** The one filling a cup at the cooler. */
  coolerWorker: EnemySpawn;
  /** The one who walks over to talk to Ravi: where he starts, where he stops. */
  greeterStart: THREE.Vector3;
  greeterTalkPos: THREE.Vector3;
  /** The truck, and the pieces of it the scene drives. */
  truck: THREE.Group;
  truckDoor: THREE.Group;
  truckGunMount: THREE.Group;
  truckGunYaw: THREE.Group;
  /** Where the truck starts (outside) and where it ends up (inside). */
  truckFrom: THREE.Vector3;
  truckTo: THREE.Vector3;
  /** Where the gunner sits once the truck is parked. */
  gunnerSpawn: EnemySpawn;
  /** Team members pour out of here. */
  agentSpawns: EnemySpawn[];
  /** Rubble + fire that seals the hole; enabled after the crash. */
  breachBarrier: THREE.Group;
  breachColliders: Collider[];
  /** The wall panel the truck destroys, and its collider index. */
  breachWall: THREE.Mesh;
  breachColliderIndex: number;
  /** Fire licks, animated by the scene. */
  fires: THREE.Mesh[];
}

const WALL_H = 3.2; // corridor
const OFF_H = 4.6; // the office floor is a tall open-plan space, so a
// gunner on the truck roof fits under the ceiling without tearing it open
const T = 0.24;

// ---- Footprint: a long corridor in from the west, then the office floor.
const HALL_X0 = -34;
const HALL_X1 = -16;
const HALL_Z0 = -2.2;
const HALL_Z1 = 2.2;
const OFF_X0 = -16;
const OFF_X1 = 13;
const OFF_Z0 = -13;
const OFF_Z1 = 8;
// Breakroom in the south-east corner
const BR_X0 = 6.0;
const BR_Z0 = 2.6;
// The truck comes through the north wall here
const BREACH_X = 1.0;
const BREACH_W = 7.0;
const DOOR_HW = 1.05; // half-width of the corridor doorway

/**
 * Level3Builder — the sister office. A long featureless corridor in, then a
 * single-storey open-plan floor: rows of desks (no cubicles), a breakroom,
 * and the north wall that a Bureau truck is about to come through.
 *
 * Same conventions as the other builders: `solid()` registers mesh +
 * collider + raycast target, and `y` is always the BASE of a box.
 */
export class Level3Builder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private glassPanes: BreakableGlass[] = [];
  private flickering: FlickeringLight[] = [];
  private fires: THREE.Mesh[] = [];
  private breachColliders: Collider[] = [];
  private breachBarrier = new THREE.Group();
  private breachWall!: THREE.Mesh;
  private breachColliderIndex = -1;

  private carpetMat!: THREE.MeshLambertMaterial;
  private wallMat!: THREE.MeshLambertMaterial;
  private ceilMat!: THREE.MeshLambertMaterial;
  private deskMat!: THREE.MeshLambertMaterial;
  private darkMetalMat!: THREE.MeshLambertMaterial;
  private screenMat!: THREE.MeshBasicMaterial;
  private plasticMat!: THREE.MeshLambertMaterial;
  private coolerMat!: THREE.MeshLambertMaterial;

  private truckParts!: ReturnType<typeof swatTruck>;

  build(): Level3Data {
    this.makeMaterials();
    this.buildCorridor();
    this.buildOfficeShell();
    this.buildDesks();
    this.buildBreakroom();
    this.buildServices();
    this.buildTruck();
    this.buildLighting();

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      occluders: this.occluders,
      waypoints: this.makeWaypoints(),
      glassPanes: this.glassPanes,
      flickering: this.flickering,
      playerSpawn: new THREE.Vector3(HALL_X0 + 1.4, 0, 0),
      playerSpawnYaw: -Math.PI / 2, // facing east, down the corridor
      introStand: new THREE.Vector3(OFF_X0 + 1.5, 0, 0),
      introYaw: -Math.PI / 2,
      // At the chairs, not on the desks, and turned to face their screens —
      // which puts their backs to the wall the truck comes through.
      deskWorkers: [
        { pos: new THREE.Vector3(-9.4, 0, -5.88), yaw: Math.PI },
        { pos: new THREE.Vector3(-4.2, 0, -5.88), yaw: Math.PI },
        { pos: new THREE.Vector3(-9.4, 0, 0.42), yaw: Math.PI },
        { pos: new THREE.Vector3(-4.2, 0, 0.42), yaw: Math.PI },
        { pos: new THREE.Vector3(1.0, 0, 0.42), yaw: Math.PI },
        { pos: new THREE.Vector3(-9.4, 0, -10.18), yaw: Math.PI }
      ],
      coolerWorker: { pos: new THREE.Vector3(-5.6, 0, OFF_Z1 - 1.35), yaw: 0 },
      greeterStart: new THREE.Vector3(-8.5, 0, 4.4),
      greeterTalkPos: new THREE.Vector3(OFF_X0 + 3.4, 0, 0.35),
      truck: this.truckParts.group,
      truckDoor: this.truckParts.doorPivot,
      truckGunMount: this.truckParts.gunMount,
      truckGunYaw: this.truckParts.gunYaw,
      truckFrom: new THREE.Vector3(BREACH_X, 0, OFF_Z0 - 11),
      truckTo: new THREE.Vector3(BREACH_X, 0, OFF_Z0 + 3.2),
      gunnerSpawn: { pos: new THREE.Vector3(BREACH_X, this.truckParts.roofY, OFF_Z0 + 4.2), yaw: Math.PI },
      agentSpawns: [
        { pos: new THREE.Vector3(BREACH_X + 2.4, 0, OFF_Z0 + 2.0), yaw: Math.PI },
        { pos: new THREE.Vector3(BREACH_X + 2.9, 0, OFF_Z0 + 3.6), yaw: Math.PI * 0.8 },
        { pos: new THREE.Vector3(BREACH_X + 2.2, 0, OFF_Z0 + 5.0), yaw: Math.PI * 0.7 },
        { pos: new THREE.Vector3(BREACH_X - 1.9, 0, OFF_Z0 + 2.6), yaw: Math.PI * 1.2 },
        { pos: new THREE.Vector3(BREACH_X - 2.3, 0, OFF_Z0 + 4.4), yaw: Math.PI * 1.3 }
      ],
      breachBarrier: this.breachBarrier,
      breachColliders: this.breachColliders,
      breachWall: this.breachWall,
      breachColliderIndex: this.breachColliderIndex,
      fires: this.fires
    };
  }

  // ------------------------------------------------------------- materials

  private makeMaterials(): void {
    this.carpetMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([50, 47, 42], 13), 16, 13) });
    this.wallMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([198, 194, 184], 7), 5, 2) });
    this.ceilMat = new THREE.MeshLambertMaterial({ map: makeTex(ceilingTileCanvas(), 16, 13) });
    this.deskMat = new THREE.MeshLambertMaterial({ color: 0x8f7a5e });
    this.darkMetalMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
    this.screenMat = new THREE.MeshBasicMaterial({ map: makeTex(spreadsheetCanvas()) });
    this.plasticMat = new THREE.MeshLambertMaterial({ color: 0x24272c });
    this.coolerMat = new THREE.MeshLambertMaterial({ color: 0xd8dde2 });
  }

  // --------------------------------------------------------------- helpers

  private solid(
    w: number, h: number, d: number, x: number, y: number, z: number,
    mat: THREE.Material,
    opts: { occlude?: boolean; surface?: string; collide?: boolean; pierce?: boolean } = {}
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.userData.surface = opts.surface ?? 'concrete';
    if (opts.pierce) mesh.userData.pierce = true;
    this.group.add(mesh);
    this.shootables.push(mesh);
    if (opts.occlude !== false) this.occluders.push(mesh);
    if (opts.collide !== false) {
      const c: Collider = {
        box: new THREE.Box3(
          new THREE.Vector3(x - w / 2, y, z - d / 2),
          new THREE.Vector3(x + w / 2, y + h, z + d / 2)
        )
      };
      if (opts.pierce) c.pierceable = true;
      this.colliders.push(c);
    }
    return mesh;
  }

  private wallX(x0: number, x1: number, z: number, h = WALL_H): void {
    this.solid(Math.abs(x1 - x0), h, T, (x0 + x1) / 2, 0, z, this.wallMat);
  }

  private wallZ(z0: number, z1: number, x: number, h = WALL_H): void {
    this.solid(T, h, Math.abs(z1 - z0), x, 0, (z0 + z1) / 2, this.wallMat);
  }

  private slabAt(x0: number, x1: number, z0: number, z1: number, y: number, mat: THREE.Material): void {
    this.solid(x1 - x0, 0.3, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2, mat, { surface: 'concrete' });
  }

  /** Decorative group: placed, but no collider and not shot at. */
  private place(g: THREE.Object3D, x: number, y: number, z: number, yaw = 0): THREE.Object3D {
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.group.add(g);
    return g;
  }

  /** Breakable pane spanning [a0,a1] along one axis at a fixed cross position. */
  private glass(axis: 'x' | 'z', a0: number, a1: number, cross: number, yBase: number, h: number): void {
    const width = a1 - a0;
    const pane = new BreakableGlass(width, h, axis);
    if (axis === 'x') pane.group.position.set((a0 + a1) / 2, yBase + h / 2, cross);
    else pane.group.position.set(cross, yBase + h / 2, (a0 + a1) / 2);
    this.group.add(pane.group);
    this.shootables.push(pane.mesh);
    this.glassPanes.push(pane);
    const box =
      axis === 'x'
        ? new THREE.Box3(new THREE.Vector3(a0, yBase, cross - 0.06), new THREE.Vector3(a1, yBase + h, cross + 0.06))
        : new THREE.Box3(new THREE.Vector3(cross - 0.06, yBase, a0), new THREE.Vector3(cross + 0.06, yBase + h, a1));
    pane.colliderIndex = this.colliders.length;
    this.colliders.push({ box, glass: pane });
  }

  /** Monitor: solid shell, glowing face, neck and base. `y` is panel centre. */
  private screen(w: number, h: number, x: number, y: number, z: number, yaw: number): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.group.add(g);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(w + 0.045, h + 0.045, 0.042), this.plasticMat);
    shell.position.z = -0.022;
    g.add(shell);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.screenMat);
    face.position.z = 0.0015;
    g.add(face);
    const bottom = -h / 2;
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.05), this.darkMetalMat);
    neck.position.set(0, bottom - 0.0225, -0.02);
    g.add(neck);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.014, 0.13), this.darkMetalMat);
    base.position.set(0, bottom - 0.048, -0.02);
    g.add(base);
  }

  // --------------------------------------------------------------- corridor

  private buildCorridor(): void {
    this.slabAt(HALL_X0, HALL_X1 + 0.2, HALL_Z0, HALL_Z1, -0.3, this.carpetMat);
    this.slabAt(HALL_X0, HALL_X1 + 0.2, HALL_Z0, HALL_Z1, WALL_H, this.ceilMat);
    // Nothing off it — just the two long walls and the end cap
    this.wallX(HALL_X0, HALL_X1, HALL_Z0);
    this.wallX(HALL_X0, HALL_X1, HALL_Z1);
    // The door he came in by, shut behind him
    this.wallZ(HALL_Z0, -DOOR_HW, HALL_X0);
    this.wallZ(DOOR_HW, HALL_Z1, HALL_X0);
    this.solid(T, WALL_H - 2.35, DOOR_HW * 2, HALL_X0, 2.35, 0, this.wallMat, { collide: false });
    const back = this.solid(0.09, 2.3, DOOR_HW * 2 - 0.08, HALL_X0 + 0.1, 0, 0, this.deskMat, { surface: 'wood', occlude: false });
    back.userData.surface = 'wood';
    for (const dz of [-DOOR_HW, DOOR_HW]) {
      this.solid(0.28, 2.35, 0.1, HALL_X0 + 0.05, 0, dz, this.darkMetalMat, { surface: 'metal', collide: false });
    }
    this.solid(0.28, 0.1, DOOR_HW * 2, HALL_X0 + 0.05, 2.35, 0, this.darkMetalMat, { surface: 'metal', collide: false });
    this.solid(0.06, 0.26, 0.06, HALL_X0 + 0.17, 1.0, DOOR_HW - 0.3, this.darkMetalMat, { surface: 'metal', occlude: false, collide: false });


    // Skirting details so eighteen metres of corridor isn't a blank tube
    // One alarm by the door and a couple of vents — a corridor does not have
    // a pull station every four metres.
    this.place(fireAlarm(), HALL_X0 + 2.2, 1.45, HALL_Z0 + T / 2 + 0.03);
    for (const x of [HALL_X0 + 6, HALL_X0 + 13]) {
      this.place(vent(0.55, 0.3), x, 2.55, HALL_Z1 - T / 2 - 0.03, Math.PI);
    }
    for (let x = HALL_X0 + 2; x < HALL_X1; x += 6) {
      const p = scatteredPaper(2, 0.5);
      p.position.set(x, 0, (Math.random() - 0.5) * 2);
      this.group.add(p);
    }
  }

  // ------------------------------------------------------------ office shell

  private buildOfficeShell(): void {
    this.slabAt(OFF_X0, OFF_X1, OFF_Z0, OFF_Z1, -0.3, this.carpetMat);
    this.slabAt(OFF_X0, OFF_X1, OFF_Z0, OFF_Z1, OFF_H, this.ceilMat);

    // North wall, with the stretch the truck destroys left out — the barrier
    // group fills it after the crash.
    this.wallX(OFF_X0, BREACH_X - BREACH_W / 2, OFF_Z0, OFF_H);
    this.wallX(BREACH_X + BREACH_W / 2, OFF_X1, OFF_Z0, OFF_H);
    // The stretch the truck destroys. Solid like the rest of the building
    // until impact, when the scene hides it and disables its collider.
    this.breachWall = this.solid(BREACH_W, OFF_H, T, BREACH_X, 0, OFF_Z0, this.wallMat);
    this.breachColliderIndex = this.colliders.length - 1;
    this.wallX(OFF_X0, OFF_X1, OFF_Z1, OFF_H);
    this.wallZ(OFF_Z0, OFF_Z1, OFF_X1, OFF_H);
    // West wall, split round the doorway in from the corridor. This is the
    // only wall at x = OFF_X0 — the corridor does not build its own, or the
    // two overlap and leave slivers the player can squeeze through.
    this.wallZ(OFF_Z0, -DOOR_HW, OFF_X0, OFF_H);
    this.wallZ(DOOR_HW, OFF_Z1, OFF_X0, OFF_H);
    this.solid(T, OFF_H - 2.35, DOOR_HW * 2, OFF_X0, 2.35, 0, this.wallMat, { collide: false });
    this.buildEntryDoor();

    // Header that survives the impact, so the hole reads as punched through
    // rather than the wall simply vanishing.
    this.solid(BREACH_W, OFF_H - 3.0, T, BREACH_X, 3.0, OFF_Z0, this.wallMat, { collide: false });
  }

  /** Frame plus a leaf standing open flat against the office wall. */
  private buildEntryDoor(): void {
    for (const dz of [-DOOR_HW, DOOR_HW]) {
      this.solid(0.3, 2.35, 0.1, OFF_X0, 0, dz, this.darkMetalMat, { surface: 'metal', collide: false });
    }
    this.solid(0.3, 0.1, DOOR_HW * 2, OFF_X0, 2.35, 0, this.darkMetalMat, { surface: 'metal', collide: false });
    // Swung right back against the wall, out of the opening
    const leaf = this.solid(2.0, 2.3, 0.08, OFF_X0 + 1.05, 0, DOOR_HW + 0.12, this.deskMat, {
      surface: 'wood', occlude: false, collide: false
    });
    leaf.userData.surface = 'wood';
    this.solid(0.06, 0.26, 0.06, OFF_X0 + 1.9, 1.0, DOOR_HW + 0.02, this.darkMetalMat, {
      surface: 'metal', occlude: false, collide: false
    });
  }

  // ------------------------------------------------------------------ desks

  /** One workstation: desk, monitor, keyboard, chair and a bit of clutter. */
  private workstation(x: number, z: number, yaw: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    this.group.add(g);

    // Desk top (local: runs along X, occupant on the −Z side)
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.85), this.deskMat);
    top.position.set(0, 0.69, 0);
    top.userData.surface = 'wood';
    g.add(top);
    this.shootables.push(top);
    for (const [lx, lz] of [[-0.88, -0.36], [0.88, -0.36], [-0.88, 0.36], [0.88, 0.36]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.66, 0.06), this.darkMetalMat);
      leg.position.set(lx, 0.33, lz);
      g.add(leg);
    }
    const modesty = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.03), this.deskMat);
    modesty.position.set(0, 0.42, 0.4);
    g.add(modesty);
    // World-space collider (yaw is a quarter turn or none)
    const swap = Math.abs(Math.sin(yaw)) > 0.5;
    const hw = (swap ? 0.85 : 1.9) / 2;
    const hd = (swap ? 1.9 : 0.85) / 2;
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, 0.72, z + hd))
    });

    // Monitor at the back of the desk, facing the occupant
    const mz = z + Math.cos(yaw) * 0.26;
    const mx = x - Math.sin(yaw) * 0.26;
    this.screen(0.56, 0.36, mx, 0.72 + 0.055 + 0.18, mz, yaw + Math.PI);
    // Keyboard, mouse, tower
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.022, 0.15), this.plasticMat);
    kb.position.set(-0.02, 0.735, -0.24);
    kb.rotation.y = (Math.random() - 0.5) * 0.2;
    g.add(kb);
    const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.028, 0.095), this.plasticMat);
    mouse.position.set(0.36, 0.738, -0.22);
    g.add(mouse);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.44, 0.46), this.darkMetalMat);
    tower.position.set(-0.78, 0.22, 0.2);
    g.add(tower);

    // Desk clutter — paper, a can, a snack, sometimes a mug
    const pap = paperStack(4 + Math.floor(Math.random() * 4));
    pap.position.set(0.62 * (Math.random() < 0.5 ? -1 : 1), 0.72, 0.1);
    pap.rotation.y = Math.random();
    g.add(pap);
    if (Math.random() < 0.7) {
      const can = sodaCan();
      can.position.set(-0.5 + Math.random() * 0.3, 0.72, -0.16);
      g.add(can);
    }
    if (Math.random() < 0.75) {
      const kinds = ['nutbar', 'gumdrops', 'cakes', 'jerky'] as const;
      const s = snack(kinds[Math.floor(Math.random() * kinds.length)]);
      s.position.set(0.24 + Math.random() * 0.4, 0.72, -0.1);
      s.rotation.z = Math.PI / 2; // lying flat
      s.position.y = 0.72 + 0.03;
      s.rotation.y = Math.random() * Math.PI;
      g.add(s);
    }
    if (Math.random() < 0.5) {
      const c = chipsBox();
      c.position.set(-0.3, 0.72, 0.22);
      c.rotation.z = Math.PI / 2;
      c.position.y = 0.72 + 0.085;
      g.add(c);
    }

    // Chair, tucked in
    const chair = officeChair();
    chair.position.set(x - Math.sin(yaw) * -0.78, 0, z + Math.cos(yaw) * -0.78);
    chair.rotation.y = yaw;
    this.group.add(chair);
  }

  private buildDesks(): void {
    // Four rows of paired desks, all facing north — no cubicle panels
    for (const z of [-5.1, 1.2]) {
      for (const x of [-9.4, -4.2, 1.0]) this.workstation(x, z, 0);
    }
    for (const x of [-9.4, -4.2]) this.workstation(x, -9.4, 0);
    // A short row along the east side, turned a quarter
    for (const z of [-9.4, -6.4]) this.workstation(9.6, z, Math.PI / 2);
  }

  // -------------------------------------------------------------- breakroom

  private buildBreakroom(): void {
    const gap0 = 4.2; // doorway in the west partition
    const gap1 = 5.6;
    // West partition: waist-high below, glazed above, so you can see in
    this.solid(T, 1.05, gap0 - BR_Z0, BR_X0, 0, (BR_Z0 + gap0) / 2, this.wallMat);
    this.glass('z', BR_Z0, gap0, BR_X0, 1.05, 1.5);
    this.solid(T, OFF_H - 2.55, gap0 - BR_Z0, BR_X0, 2.55, (BR_Z0 + gap0) / 2, this.wallMat, { collide: false });
    this.solid(T, OFF_H, OFF_Z1 - gap1, BR_X0, 0, (gap1 + OFF_Z1) / 2, this.wallMat);
    this.solid(T, OFF_H - 2.35, gap1 - gap0, BR_X0, 2.35, (gap0 + gap1) / 2, this.wallMat, { collide: false });
    // North partition, also glazed above the counter line
    this.solid(OFF_X1 - BR_X0, 1.05, T, (BR_X0 + OFF_X1) / 2, 0, BR_Z0, this.wallMat);
    this.glass('x', BR_X0, OFF_X1, BR_Z0, 1.05, 1.5);
    this.solid(OFF_X1 - BR_X0, OFF_H - 2.55, T, (BR_X0 + OFF_X1) / 2, 2.55, BR_Z0, this.wallMat, { collide: false });

    this.place(breakTable(), 9.0, 0, 5.4);

    // Machines against the east wall, backs to it
    for (const vz of [4.0, 5.6]) {
      this.place(vendingMachine(), OFF_X1 - 0.5, 0, vz, -Math.PI / 2);
      this.colliders.push({
        box: new THREE.Box3(new THREE.Vector3(OFF_X1 - 0.95, 0, vz - 0.5), new THREE.Vector3(OFF_X1 - 0.05, 1.95, vz + 0.5))
      });
    }
    // Counter along the south wall
    this.solid(2.8, 0.92, 0.6, 8.6, 0, OFF_Z1 - 0.5, this.darkMetalMat, { surface: 'metal' });
    const coffee = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.32), this.plasticMat);
    coffee.position.set(7.7, 1.13, OFF_Z1 - 0.5);
    this.group.add(coffee);
    for (const [sx, k] of [[8.7, 'cakes'], [9.1, 'nutbar'], [9.45, 'jerky']] as const) {
      this.place(snack(k as 'cakes'), sx, 0.92, OFF_Z1 - 0.55, Math.random());
    }
    this.place(trashCan(), 6.7, 0, OFF_Z1 - 0.7);
  }

  // --------------------------------------------------------------- services

  private buildServices(): void {
    // Water cooler on the south wall, straight ahead from the door — in
    // frame for the opening, and still tucked against a wall.
    this.waterCooler(-5.6, OFF_Z1 - 0.55);

    // Printers, backs to the wall, controls facing the room
    this.place(printer(), -13.0, 0, OFF_Z0 + 0.75, Math.PI);
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(-13.4, 0, OFF_Z0 + 0.4), new THREE.Vector3(-12.6, 1.2, OFF_Z0 + 1.15))
    });
    this.place(printer(), 11.4, 0, OFF_Z0 + 0.75, Math.PI);
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(11.0, 0, OFF_Z0 + 0.4), new THREE.Vector3(11.8, 1.2, OFF_Z0 + 1.15))
    });

    const cab = (x: number, z: number, yaw: number, drawers = 4): void => {
      this.place(fileCabinet(0.6, 1.45, 1.8, drawers), x, 0, z, yaw);
      const swap = Math.abs(Math.sin(yaw)) > 0.5;
      const hw = (swap ? 1.8 : 0.6) / 2;
      const hd = (swap ? 0.6 : 1.8) / 2;
      this.colliders.push({
        box: new THREE.Box3(new THREE.Vector3(x - hw, 0, z - hd), new THREE.Vector3(x + hw, 1.45, z + hd))
      });
      const shell = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 1.45, hd * 2), this.darkMetalMat);
      shell.position.set(x, 0.725, z);
      shell.visible = false;
      shell.userData.surface = 'metal';
      this.group.add(shell);
      this.shootables.push(shell);
      this.occluders.push(shell);
    };
    // West wall: backs to it, drawers opening east into the room
    cab(OFF_X0 + 0.42, -6.4, Math.PI);
    cab(OFF_X0 + 0.42, -4.4, Math.PI);
    // East wall: drawers opening west
    cab(OFF_X1 - 0.42, -7.6, 0);
    cab(OFF_X1 - 0.42, -5.6, 0);
    // North wall, well clear of the breach: drawers opening south
    cab(-8.5, OFF_Z0 + 0.42, Math.PI / 2, 3);
    cab(-6.5, OFF_Z0 + 0.42, Math.PI / 2, 3);

    // Vents and fire alarms — the alarms do nothing
    for (const [x, z, yaw] of [
      [-11, OFF_Z0 + T / 2, 0], [8, OFF_Z0 + T / 2, 0],
      [-6, OFF_Z1 - T / 2, Math.PI], [2, OFF_Z1 - T / 2, Math.PI],
      [OFF_X0 + T / 2, -8, Math.PI / 2]
    ] as const) {
      this.place(fireAlarm(), x, 1.45, z, yaw);
    }
    for (const [x, z, yaw] of [
      [-12, OFF_Z0 + T / 2, 0], [-3, OFF_Z0 + T / 2, 0],
      [-9, OFF_Z1 - T / 2, Math.PI], [4, OFF_Z1 - T / 2, Math.PI],
      [OFF_X0 + T / 2, 3, Math.PI / 2], [OFF_X1 - T / 2, -2, -Math.PI / 2]
    ] as const) {
      this.place(vent(0.62, 0.34), x, 3.1, z, yaw);
    }
    for (const [x, z] of [[-8, -2], [2, -2], [-8, 5], [5, 0]] as const) {
      const v = vent(0.7, 0.7);
      v.position.set(x, OFF_H - 0.02, z);
      v.rotation.x = Math.PI / 2;
      this.group.add(v);
    }

    // Floor dressing
    for (const [x, z] of [[-6.5, -2.2], [3.4, -8.6], [-11.5, 3.0]] as const) {
      const c = spilledCoffee();
      c.position.set(x, 0, z);
      this.group.add(c);
    }
    for (const [k, x, z] of [['persuade', -7.2, -8.9], ['scamming', 2.6, 4.2], ['comic', -12.0, 5.0]] as const) {
      const b = book(k as 'persuade');
      b.position.set(x, 0, z);
      b.rotation.y = Math.random() * Math.PI;
      this.group.add(b);
    }
    this.place(trashCan(), -10.6, 0, -2.4);
    this.place(trashCan(), 4.2, 0, -2.4);
    this.place(trashCan(), -14.6, 0, 6.6);
  }

  /** Cooler against the south wall, taps and bottle facing into the room. */
  private waterCooler(x: number, z: number): void {
    this.solid(0.42, 1.02, 0.42, x, 0, z, this.coolerMat, { surface: 'metal', occlude: false });
    const g = new THREE.Group();
    this.group.add(g);
    for (const [dx, col] of [[-0.08, 0x2f6f9e], [0.08, 0xb4463c]] as const) {
      const tap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.05), new THREE.MeshLambertMaterial({ color: col }));
      tap.position.set(x + dx, 0.78, z - 0.22);
      g.add(tap);
    }
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 0.46, 14),
      new THREE.MeshLambertMaterial({ color: 0x7fc4e8, transparent: true, opacity: 0.72 })
    );
    bottle.position.set(x, 1.28, z);
    g.add(bottle);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.14, 12), this.coolerMat);
    neck.position.set(x, 1.02, z);
    g.add(neck);
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(x - 0.21, 0, z - 0.21), new THREE.Vector3(x + 0.21, 1.51, z + 0.21))
    });
  }

  // ------------------------------------------------------------------ truck

  private buildTruck(): void {
    this.truckParts = swatTruck();
    // Parked outside until the scene drives it in
    this.truckParts.group.position.set(BREACH_X, 0, OFF_Z0 - 11);
    this.group.add(this.truckParts.group);

    // Rubble and fire that seal the hole once it's through. Hidden until then.
    this.breachBarrier.visible = false;
    this.group.add(this.breachBarrier);
    const addRubble = (x: number, z: number, s: number): void => {
      const r = rubblePile(s);
      r.position.set(x, 0, z);
      r.rotation.y = Math.random() * Math.PI;
      this.breachBarrier.add(r);
    };
    // Piles either side of the truck, filling the gaps it doesn't
    addRubble(BREACH_X - 3.1, OFF_Z0 + 0.5, 1.2);
    addRubble(BREACH_X - 2.4, OFF_Z0 + 2.1, 1.0);
    addRubble(BREACH_X + 3.2, OFF_Z0 + 0.4, 1.2);
    addRubble(BREACH_X + 2.6, OFF_Z0 + 2.0, 1.0);
    addRubble(BREACH_X, OFF_Z0 - 0.4, 1.4);

    // Fires licking up out of it
    const fireMat = () =>
      new THREE.MeshBasicMaterial({
        color: 0xff8a2b, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide
      });
    for (const [fx, fz, sc] of [
      [BREACH_X - 3.0, OFF_Z0 + 0.7, 1.0], [BREACH_X - 2.2, OFF_Z0 + 2.0, 0.8],
      [BREACH_X + 3.1, OFF_Z0 + 0.6, 1.0], [BREACH_X + 2.5, OFF_Z0 + 2.1, 0.85],
      [BREACH_X - 0.6, OFF_Z0 - 0.6, 0.9], [BREACH_X + 1.2, OFF_Z0 - 0.5, 0.9]
    ] as const) {
      for (let i = 0; i < 3; i++) {
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28 * sc, 1.0 * sc, 6, 1, true), fireMat());
        flame.position.set(fx + (Math.random() - 0.5) * 0.5, 0.5 * sc, fz + (Math.random() - 0.5) * 0.5);
        flame.userData.baseY = flame.position.y;
        flame.userData.phase = Math.random() * Math.PI * 2;
        this.breachBarrier.add(flame);
        this.fires.push(flame);
      }
      const glow = new THREE.PointLight(0xff7a2a, 3.2, 6, 1.9);
      glow.position.set(fx, 0.8, fz);
      this.breachBarrier.add(glow);
    }

    // Colliders that seal the breach — added to the live set after the crash
    for (const [cx, cz, cw, cd] of [
      [BREACH_X - 3.0, OFF_Z0 + 1.2, 2.2, 3.4],
      [BREACH_X + 3.1, OFF_Z0 + 1.2, 2.2, 3.4],
      [BREACH_X, OFF_Z0 - 0.5, 7.0, 1.6]
    ] as const) {
      this.breachColliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(cx - cw / 2, 0, cz - cd / 2),
          new THREE.Vector3(cx + cw / 2, 2.6, cz + cd / 2)
        )
      });
    }
  }

  // ------------------------------------------------------------- lighting

  private buildLighting(): void {
    const g = this.group;
    g.add(new THREE.AmbientLight(0x4a4436, 0.95));
    g.add(new THREE.HemisphereLight(0xa39a86, 0x2a2620, 0.6));

    const addLight = (x: number, z: number, intensity = 8, dist = 12, ceil = WALL_H): void => {
      const l = new THREE.PointLight(0xfff2dc, intensity, dist, 1.6);
      l.position.set(x, ceil - 0.35, z);
      g.add(l);
      const fix = new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 0.07, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x999999, emissive: 0xfff6e0, emissiveIntensity: 1.4 })
      );
      fix.position.set(x, ceil - 0.23, z);
      g.add(fix);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.16), this.darkMetalMat);
      canopy.position.set(x, ceil - 0.09, z);
      g.add(canopy);
    };


    // Corridor — a run of fixtures, one of them failing
    for (let x = HALL_X0 + 3; x < HALL_X1; x += 4.5) addLight(x, 0, 6, 9);
    this.flickering.push(new FlickeringLight(g, new THREE.Vector3(HALL_X1 - 3.4, WALL_H - 0.35, 0), 7, 8));

    // Office floor
    for (const z of [-10, -5, 0, 5]) {
      for (const x of [-12, -6, 0, 6, 11]) addLight(x, z, 9, 15, OFF_H);
    }
    addLight(9.5, 5.5, 7, 12, OFF_H); // breakroom
  }

  // ------------------------------------------------------------ waypoints

  private makeWaypoints(): Waypoint[] {
    const pts: [number, number, number][] = [
      [-14.5, 0, 0], // 0 office end of the corridor
      [-11, 0, -8], [-3, 0, -8], [6, 0, -8], [11, 0, -8], // 1-4 north aisle
      [-11, 0, -2], [-3, 0, -2], [6, 0, -2], [11, 0, -2], // 5-8 middle aisle
      [-11, 0, 4], [-3, 0, 4], [3, 0, 4], // 9-11 south aisle
      [-14, 0, 6.5], [-6, 0, 6.8], [1, 0, 6.8], // 12-14 south wall
      [8.5, 0, 5.0], [11, 0, 6.5], // 15-16 breakroom
      [BREACH_X, 0, -10.5] // 17 the breach
    ];
    const links: [number, number][] = [
      [0, 5], [1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 8], [9, 10], [10, 11],
      [1, 5], [2, 6], [3, 7], [4, 8], [5, 9], [6, 10], [7, 11],
      [9, 12], [12, 13], [13, 14], [14, 11], [11, 15], [15, 16], [8, 15],
      [2, 17], [17, 6]
    ];
    const wps: Waypoint[] = pts.map(([x, y, z]) => ({ pos: new THREE.Vector3(x, y, z), links: [] }));
    for (const [a, b] of links) {
      wps[a].links.push(b);
      wps[b].links.push(a);
    }
    return wps;
  }
}
