import * as THREE from 'three';
import type { BreakableGlass } from './BreakableGlass';
import { Collider, noiseCanvas, ceilingTileCanvas, makeTex } from './OfficeLevelBuilder';

/** Everything the scene needs to drive one lift car. */
export interface ElevatorCar {
  /** Where the car's doors sit: the west face of the car, at z = 0. */
  doorX: number;
  leftDoor: THREE.Mesh;
  rightDoor: THREE.Mesh;
  /** Spans the opening; live only while the doors are shut. */
  doorCollider: Collider;
  /** The control panel plate, which is what E has to be aimed at. */
  panel: THREE.Object3D;
  /** Each button's lamp, by label: '5' … '1', and 'MR'. */
  buttons: Map<string, THREE.MeshStandardMaterial>;
  /** The floor display above the door, and the faces it can show. */
  indicator: THREE.MeshBasicMaterial;
  indicatorFaces: Record<'2' | '1' | 'MR' | 'down', THREE.Texture>;
  /** Inside the car, for "has he stepped in yet". */
  interior: THREE.Box3;
}

export interface Level5Data {
  group: THREE.Group;
  colliders: Collider[];
  shootables: THREE.Object3D[];
  glassPanes: BreakableGlass[];
  playerSpawn: THREE.Vector3;
  playerSpawnYaw: number;
  /** Car A is at the end of the hallway; car B, the same car, in the basement. */
  carA: ElevatorCar;
  carB: ElevatorCar;
  /**
   * B minus A. The two cars are built identically and face the same way, so
   * the ride is a pure translation: the player steps out of B exactly where
   * he was standing in A, looking the same way.
   */
  carOffset: THREE.Vector3;
  /** The emergency lamp in each car, for a flicker on arrival. */
  carLights: THREE.PointLight[];
}

const T = 0.24;

// ---- The hallway down to the lift. Deliberately plain and deliberately dark.
const HALL_X0 = 0;
const HALL_X1 = 18;
const HALL_HW = 1.7; // half width
const HALL_H = 3.0;

// ---- The car. Inside dimensions.
const CAR_D = 2.1; // back to front, along x
const CAR_HW = 1.1; // half width, along z
const CAR_H = 2.5;
const DOOR_HW = 0.62; // half the opening
const DOOR_H = 2.15;

// ---- The basement: a long way off in x, so neither area can see the other.
const OFFSET = new THREE.Vector3(200, 0, 0);
const MR_DEPTH = 30;
const MR_HW = 12;
const MR_H = 5.5;

/**
 * Level5Builder — the lift down, and the mechanical room it stops at.
 *
 * One level holds both. The hallway and its car sit at the origin; the
 * mechanical room and an identical car sit 200m east. When the car "moves"
 * the scene fades to black and slides the player across by exactly that
 * offset, which is why the two cars must be built the same way round.
 */
export class Level5Builder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private carLights: THREE.PointLight[] = [];

  private wallMat!: THREE.MeshLambertMaterial;
  private floorMat!: THREE.MeshLambertMaterial;
  private ceilMat!: THREE.MeshLambertMaterial;
  private concreteMat!: THREE.MeshLambertMaterial;
  private steelMat!: THREE.MeshStandardMaterial;
  private carFloorMat!: THREE.MeshLambertMaterial;
  private darkMetalMat!: THREE.MeshLambertMaterial;
  private doorMat!: THREE.MeshStandardMaterial;

  build(): Level5Data {
    this.makeMaterials();
    this.buildHallway();
    const carA = this.buildCar(HALL_X1, '2');
    this.buildMechanicalRoom();
    const carB = this.buildCar(HALL_X1 + OFFSET.x, 'MR');
    this.buildLighting();

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      glassPanes: [],
      playerSpawn: new THREE.Vector3(HALL_X0 + 1.4, 0, 0),
      playerSpawnYaw: -Math.PI / 2, // facing east, down the hallway at the lift
      carA,
      carB,
      carOffset: OFFSET.clone(),
      carLights: this.carLights
    };
  }

  // ------------------------------------------------------------- materials

  private makeMaterials(): void {
    this.wallMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([150, 146, 138], 7), 4, 2) });
    this.floorMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([44, 46, 52], 12), 10, 2) });
    this.ceilMat = new THREE.MeshLambertMaterial({ map: makeTex(ceilingTileCanvas(), 10, 2) });
    this.concreteMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([96, 98, 100], 16), 12, 10) });
    this.steelMat = new THREE.MeshStandardMaterial({ color: 0x8d949b, metalness: 0.55, roughness: 0.42 });
    this.carFloorMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([34, 35, 38], 10), 2, 2) });
    this.darkMetalMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
    this.doorMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.6, roughness: 0.35 });
  }

  // --------------------------------------------------------------- helpers

  /** Solid box: mesh, collider and bullet target. */
  private solid(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    opts: { collide?: boolean; surface?: string } = {}
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.userData.surface = opts.surface ?? 'concrete';
    this.group.add(mesh);
    this.shootables.push(mesh);
    if (opts.collide !== false) {
      this.colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(x - w / 2, y, z - d / 2),
          new THREE.Vector3(x + w / 2, y + h, z + d / 2)
        )
      });
    }
    return mesh;
  }

  private slab(x0: number, x1: number, z0: number, z1: number, y: number, mat: THREE.Material): void {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, y + 0.15, (z0 + z1) / 2);
    this.group.add(m);
    this.shootables.push(m);
    this.colliders.push({ box: new THREE.Box3(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y + 0.3, z1)) });
  }

  /** A wall running along z at `x`, with the lift opening left in it at z = 0. */
  private endWall(x: number, z0: number, z1: number, h: number, mat: THREE.Material): void {
    this.solid(T, h, -DOOR_HW - z0, x, 0, (z0 - DOOR_HW) / 2, mat);
    this.solid(T, h, z1 - DOOR_HW, x, 0, (z1 + DOOR_HW) / 2, mat);
    this.solid(T, h - DOOR_H, DOOR_HW * 2, x, DOOR_H, 0, mat);
  }

  // -------------------------------------------------------------- hallway

  /** The corridor down to the lift. Nothing in it: the point is the dark. */
  private buildHallway(): void {
    this.slab(HALL_X0, HALL_X1, -HALL_HW, HALL_HW, -0.3, this.floorMat);
    this.slab(HALL_X0, HALL_X1, -HALL_HW, HALL_HW, HALL_H, this.ceilMat);
    this.solid(HALL_X1 - HALL_X0, HALL_H, T, (HALL_X0 + HALL_X1) / 2, 0, -HALL_HW, this.wallMat);
    this.solid(HALL_X1 - HALL_X0, HALL_H, T, (HALL_X0 + HALL_X1) / 2, 0, HALL_HW, this.wallMat);
    this.solid(T, HALL_H, HALL_HW * 2, HALL_X0, 0, 0, this.wallMat);
    // The door he came through, shut behind him
    this.solid(0.08, 2.2, 1.5, HALL_X0 + 0.16, 0, 0, this.doorMat, { surface: 'metal', collide: false });
    this.solid(0.05, 0.05, 1.05, HALL_X0 + 0.22, 1.02, 0, this.darkMetalMat, { surface: 'metal', collide: false });
    this.endWall(HALL_X1, -HALL_HW, HALL_HW, HALL_H, this.wallMat);
  }

  // --------------------------------------------------------- mechanical room

  /** A large bare room for now. Its east wall holds the lift. */
  private buildMechanicalRoom(): void {
    const x1 = HALL_X1 + OFFSET.x;
    const x0 = x1 - MR_DEPTH;
    this.slab(x0, x1, -MR_HW, MR_HW, -0.3, this.concreteMat);
    this.slab(x0, x1, -MR_HW, MR_HW, MR_H, this.concreteMat);
    this.solid(MR_DEPTH, MR_H, T, (x0 + x1) / 2, 0, -MR_HW, this.concreteMat);
    this.solid(MR_DEPTH, MR_H, T, (x0 + x1) / 2, 0, MR_HW, this.concreteMat);
    this.solid(T, MR_H, MR_HW * 2, x0, 0, 0, this.concreteMat);
    this.endWall(x1, -MR_HW, MR_HW, MR_H, this.concreteMat);
  }

  // ------------------------------------------------------------------- car

  /**
   * One lift car, its doors on the west face at `doorX`.
   *
   * Local layout, looking in from the door: the control panel is on the
   * right-hand (south) wall just inside, the emergency-power sign faces you
   * on the back wall, and the floor display is over the door.
   */
  private buildCar(doorX: number, litFloor: '2' | 'MR'): ElevatorCar {
    const x0 = doorX + T / 2; // inside face of the front wall
    const x1 = doorX + CAR_D;
    const cx = (x0 + x1) / 2;

    // Shell
    this.slab(doorX, x1 + T / 2, -CAR_HW - T / 2, CAR_HW + T / 2, -0.3, this.carFloorMat);
    this.slab(doorX, x1 + T / 2, -CAR_HW - T / 2, CAR_HW + T / 2, CAR_H, this.steelMat);
    this.solid(x1 - doorX, CAR_H, T, (doorX + x1) / 2, 0, -CAR_HW, this.steelMat, { surface: 'metal' });
    this.solid(x1 - doorX, CAR_H, T, (doorX + x1) / 2, 0, CAR_HW, this.steelMat, { surface: 'metal' });
    this.solid(T, CAR_H, CAR_HW * 2 + T, x1, 0, 0, this.steelMat, { surface: 'metal' });
    // The inside face of the front wall is steel too, not corridor plaster
    this.solid(0.02, CAR_H, CAR_HW - DOOR_HW, x0 + 0.01, 0, -(CAR_HW + DOOR_HW) / 2, this.steelMat, {
      surface: 'metal',
      collide: false
    });
    this.solid(0.02, CAR_H, CAR_HW - DOOR_HW, x0 + 0.01, 0, (CAR_HW + DOOR_HW) / 2, this.steelMat, {
      surface: 'metal',
      collide: false
    });
    this.solid(0.02, CAR_H - DOOR_H, DOOR_HW * 2, x0 + 0.01, DOOR_H, 0, this.steelMat, {
      surface: 'metal',
      collide: false
    });
    // Handrail round the back
    this.solid(0.05, 0.05, CAR_HW * 2 - 0.3, x1 - T / 2 - 0.07, 0.92, 0, this.darkMetalMat, {
      surface: 'metal',
      collide: false
    });

    // Doors: two leaves meeting in the middle, sliding back into the wall.
    // They live inside the wall's own thickness, so open they are hidden in it.
    const leafW = DOOR_HW;
    const mk = (z: number): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, DOOR_H, leafW), this.doorMat);
      m.position.set(doorX, DOOR_H / 2, z);
      m.userData.surface = 'metal';
      this.group.add(m);
      this.shootables.push(m);
      return m;
    };
    const leftDoor = mk(-leafW * 1.5); // open: both start slid away
    const rightDoor = mk(leafW * 1.5);
    const doorCollider: Collider = {
      box: new THREE.Box3(
        new THREE.Vector3(doorX - T / 2, 0, -DOOR_HW),
        new THREE.Vector3(doorX + T / 2, DOOR_H, DOOR_HW)
      ),
      disabled: true
    };
    this.colliders.push(doorCollider);

    // Emergency lamp: a dim warm panel in the ceiling, and the light itself
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2419, emissive: 0xffd9a0, emissiveIntensity: 0.9 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.5), lampMat);
    lamp.position.set(cx, CAR_H - 0.02, 0);
    this.group.add(lamp);
    const light = new THREE.PointLight(0xffdcaa, 1.5, 6.5, 1.5);
    light.position.set(cx, CAR_H - 0.25, 0);
    this.group.add(light);
    this.carLights.push(light);

    // Control panel on the south wall, just inside the door
    const { panel, buttons } = this.controlPanel();
    panel.position.set(x0 + 0.42, 1.28, -CAR_HW + T / 2 + 0.012);
    this.group.add(panel);
    buttons.get(litFloor)!.emissiveIntensity = 2.2;

    // Emergency power sign and its green lamp, on the back wall
    const sign = this.emergencySign();
    sign.position.set(x1 - T / 2 - 0.012, 1.72, 0.42);
    sign.rotation.y = -Math.PI / 2;
    this.group.add(sign);

    // Floor display over the door, facing into the car
    const faces = {
      '2': this.indicatorFace('2'),
      '1': this.indicatorFace('1'),
      MR: this.indicatorFace('MR'),
      down: this.indicatorFace('↓')
    };
    const indicator = new THREE.MeshBasicMaterial({ map: faces[litFloor] });
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.42), this.darkMetalMat);
    housing.position.set(x0 + 0.025, DOOR_H + 0.17, 0);
    this.group.add(housing);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.16), indicator);
    screen.position.set(x0 + 0.042, DOOR_H + 0.17, 0);
    screen.rotation.y = Math.PI / 2;
    this.group.add(screen);

    return {
      doorX,
      leftDoor,
      rightDoor,
      doorCollider,
      panel,
      buttons,
      indicator,
      indicatorFaces: faces,
      interior: new THREE.Box3(new THREE.Vector3(x0, 0, -CAR_HW + T / 2), new THREE.Vector3(x1 - T / 2, CAR_H, CAR_HW - T / 2))
    };
  }

  /**
   * The button column: 5 at the top down to 1, then the mechanical room on
   * its own below a gap. Each button has its own lamp material so the scene
   * can light any one of them. Built facing +Z.
   */
  private controlPanel(): { panel: THREE.Group; buttons: Map<string, THREE.MeshStandardMaterial> } {
    const g = new THREE.Group();
    const W = 0.3;
    const H = 0.78;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(W, H, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.7, roughness: 0.3 })
    );
    g.add(plate);

    // Engraved labels, drawn once
    const c = document.createElement('canvas');
    c.width = 150;
    c.height = 390;
    const x = c.getContext('2d')!;
    x.fillStyle = '#8f969d';
    x.fillRect(0, 0, 150, 390);
    x.fillStyle = '#1c2026';
    x.textAlign = 'center';
    x.font = 'bold 26px Arial, Helvetica, sans-serif';
    const labels = ['5', '4', '3', '2', '1'];
    const rowY = (i: number): number => 42 + i * 52;
    labels.forEach((l, i) => x.fillText(l, 42, rowY(i) + 9));
    // Set apart from the floors by a rule and a clear gap, so it reads as
    // its own thing rather than a sixth floor crowding the 1
    x.fillStyle = '#5d646b';
    x.fillRect(18, 283, 114, 2);
    x.fillStyle = '#1c2026';
    x.font = 'bold 15px Arial, Helvetica, sans-serif';
    x.fillText('MECHANICAL', 75, 342);
    x.fillText('ROOM', 75, 360);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.94, H * 0.94), new THREE.MeshLambertMaterial({ map: tex }));
    face.position.z = 0.011;
    g.add(face);

    // The buttons themselves, as raised discs with their own lamps
    const buttons = new Map<string, THREE.MeshStandardMaterial>();
    const toLocal = (px: number, py: number): [number, number] => [
      (px / 150 - 0.5) * W * 0.94,
      (0.5 - py / 390) * H * 0.94
    ];
    const disc = (label: string, px: number, py: number): void => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xd9dde0,
        emissive: 0xffc45a,
        emissiveIntensity: 0,
        metalness: 0.3,
        roughness: 0.4
      });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 16), mat);
      b.rotation.x = Math.PI / 2;
      const [lx, ly] = toLocal(px, py);
      b.position.set(lx, ly, 0.017);
      g.add(b);
      buttons.set(label, mat);
    };
    labels.forEach((l, i) => disc(l, 100, rowY(i)));
    disc('MR', 75, 312);
    return { panel: g, buttons };
  }

  /** "EMERGENCY BACKUP ELEVATOR POWER", with a green lamp over it. Faces +Z. */
  private emergencySign(): THREE.Group {
    const g = new THREE.Group();
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = '#1b2a1f';
    x.fillRect(0, 0, 256, 128);
    x.strokeStyle = '#5bd27a';
    x.lineWidth = 3;
    x.strokeRect(6, 6, 244, 116);
    x.fillStyle = '#dff5e4';
    x.textAlign = 'center';
    x.font = 'bold 26px Arial, Helvetica, sans-serif';
    x.fillText('EMERGENCY', 128, 42);
    x.fillText('BACKUP', 128, 72);
    x.font = 'bold 19px Arial, Helvetica, sans-serif';
    x.fillText('ELEVATOR POWER', 128, 102);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 0.015), this.darkMetalMat);
    g.add(plate);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.22),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 })
    );
    face.position.z = 0.009;
    g.add(face);
    // The green lamp, lit: this is what says the car has its own supply
    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16),
      new THREE.MeshStandardMaterial({ color: 0x0b2a14, emissive: 0x2cff62, emissiveIntensity: 1.25 })
    );
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, 0.2, 0.012);
    g.add(lamp);
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 16), this.darkMetalMat);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(0, 0.2, 0.004);
    g.add(bezel);
    return g;
  }

  /** One face of the floor display: amber digits on black. */
  private indicatorFace(text: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 192;
    c.height = 80;
    const x = c.getContext('2d')!;
    x.fillStyle = '#080604';
    x.fillRect(0, 0, 192, 80);
    x.fillStyle = '#ffb23a';
    x.textAlign = 'center';
    x.font = 'bold 56px "Courier New", monospace';
    x.fillText(text, 96, 60);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // -------------------------------------------------------------- lighting

  /**
   * No power anywhere except in the lift. The hallway gets only a trace of
   * ambient so the walls are there if you look hard; the rest is the torch
   * and whatever spills out of the open car.
   */
  private buildLighting(): void {
    this.group.add(new THREE.AmbientLight(0x1c2129, 0.2));
    this.group.add(new THREE.HemisphereLight(0x3a3f4a, 0x0d0f12, 0.12));
  }
}
