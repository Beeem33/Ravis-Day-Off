import * as THREE from 'three';
import { BreakableGlass } from './BreakableGlass';
import { FlickeringLight } from './FlickeringLight';
import {
  officeChair, trashCan, scatteredPaper, vendingMachine, sodaCan,
  fileCabinet, book, spilledCoffee, chipsBox
} from './OfficeProps';

/**
 * Axis-aligned movement collider. `glass` links a pane so shattering it
 * disables the collider; `pierceable` marks cubicle-style soft cover.
 */
export interface Collider {
  box: THREE.Box3;
  disabled?: boolean;
  glass?: BreakableGlass;
  pierceable?: boolean;
}

export interface Waypoint {
  pos: THREE.Vector3;
  links: number[];
}

export interface EnemySpawn {
  pos: THREE.Vector3;
  yaw: number;
}

export interface LevelData {
  group: THREE.Group;
  colliders: Collider[];
  /** Raycast targets for bullets (everything solid + glass + enemies get added later). */
  shootables: THREE.Object3D[];
  /** Raycast targets for AI vision (walls/cubicles — NOT glass). */
  occluders: THREE.Object3D[];
  waypoints: Waypoint[];
  enemySpawns: EnemySpawn[];
  playerSpawn: THREE.Vector3;
  playerSpawnYaw: number;
  flickering: FlickeringLight[];
  glassPanes: BreakableGlass[];
  /** Staff still alive and running when the shift starts. */
  civilianSpawns: EnemySpawn[];
  /** Staff who didn't make it — bodies already on the floor. */
  corpseSpawns: EnemySpawn[];
  /** Panel over the exit door: red while the floor is hot, green when clear. */
  exitPanel: THREE.MeshStandardMaterial;
  exitPanelLight: THREE.PointLight;
  /** Step in here, once the floor is clear, to move on. */
  exitTrigger: THREE.Box3;
}

// ---------------------------------------------------------------- textures

export function noiseCanvas(base: [number, number, number], variance: number, cells = 64): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = cells;
  const g = c.getContext('2d')!;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const v = (Math.random() - 0.5) * variance;
      g.fillStyle = `rgb(${base[0] + v | 0}, ${base[1] + v | 0}, ${base[2] + v | 0})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

export function ceilingTileCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#cfd2cd';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#9a9d99';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 64, 64);
  g.strokeRect(64, 0, 64, 64);
  g.strokeRect(0, 64, 64, 64);
  g.strokeRect(64, 64, 64, 64);
  // speckle
  g.fillStyle = 'rgba(140,140,138,0.5)';
  for (let i = 0; i < 300; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
  return c;
}

export function spreadsheetCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d1b2e';
  g.fillRect(0, 0, 128, 96);
  g.strokeStyle = '#274b73';
  for (let x = 0; x < 128; x += 18) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 96);
    g.stroke();
  }
  for (let y = 0; y < 96; y += 10) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(128, y);
    g.stroke();
  }
  g.fillStyle = '#5f9ed6';
  for (let i = 0; i < 26; i++) {
    g.fillRect(2 + Math.floor(Math.random() * 7) * 18, 1 + Math.floor(Math.random() * 9) * 10, 10 + Math.random() * 5, 6);
  }
  return c;
}

export function makeTex(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// ------------------------------------------------------------------ layout

const FLOOR_H = 3.3; // walk level of upper floor
const WALL_H = 3.0; // clear height per storey
const SLAB_T = 0.3;

// ---- Stairwell shaft: a switchback stair filling the east end of the
// building. Every part of it keys off these so the enclosure walls, the
// slab cutout, the flights and the guard rails stay flush with each other.
const SHAFT_WALL_X = 13.3; // centre of the west enclosure wall (0.22 thick)
const SHAFT_X0 = 13.41; // interior west face
const SHAFT_X1 = 18.19; // interior east face (the exterior wall)
const SHAFT_VOID_X = 13.19; // outer face of that wall — where the slab stops
const DIVIDER_X0 = 15.35; // stair core between the two flights
const DIVIDER_X1 = 16.25;
const STAIR_Z_BOT = -4; // both flights run between these
const STAIR_Z_TOP = -7;
const LANDING_Z = -9; // half-landing occupies z LANDING_Z..STAIR_Z_TOP

// Service door out of the east wall, just south of the stairwell: the way
// on to the next level. Its panel stays red until the floor is clear.
const EXIT_Z0 = 0.5;
const EXIT_Z1 = 2.2;

// Carpet and ceiling-tile textures are authored for the full 36.8 x 24.8
// footprint; slabs of other sizes rescale their UVs against these.
const SLAB_REPEAT_X = 18;
const SLAB_REPEAT_Y = 12;
/** Texture repeats per metre on floor/ceiling surfaces — one tile per 2m. */
const SLAB_TILE_DENSITY = 0.5;

/**
 * BoxGeometry gives every face 0..1 UVs, so a shared texture with a fixed
 * `repeat` is squashed by a different amount on every differently-sized
 * slab — the narrow strips of upper floor smeared the ceiling grid across
 * 2m instead of tiling it. Rescale the top and bottom face UVs so every
 * slab tiles at the same world-space density.
 */
function normalizeSlabUVs(geo: THREE.BoxGeometry, w: number, d: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const su = (w * SLAB_TILE_DENSITY) / SLAB_REPEAT_X;
  const sv = (d * SLAB_TILE_DENSITY) / SLAB_REPEAT_Y;
  for (const face of [2, 3]) { // BoxGeometry face order: px nx py ny pz nz
    for (let i = face * 4; i < face * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }
  uv.needsUpdate = true;
}

/**
 * OfficeLevelBuilder — constructs the whole two-storey call-center complex:
 * geometry, movement colliders, bullet/vision raycast sets, patrol waypoint
 * graph, spawns, glass partitions and flickering fixtures.
 */
export class OfficeLevelBuilder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private glassPanes: BreakableGlass[] = [];
  private flickering: FlickeringLight[] = [];

  private carpetMat!: THREE.MeshLambertMaterial;
  private carpetUpMat!: THREE.MeshLambertMaterial;
  private wallMat!: THREE.MeshLambertMaterial;
  private ceilMat!: THREE.MeshLambertMaterial;
  private cubicleMat!: THREE.MeshLambertMaterial;
  private deskMat!: THREE.MeshLambertMaterial;
  private darkMetalMat!: THREE.MeshLambertMaterial;
  private screenMat!: THREE.MeshBasicMaterial;
  private paperMat!: THREE.MeshLambertMaterial;
  private plasticMat!: THREE.MeshLambertMaterial;
  private beigeMat!: THREE.MeshLambertMaterial;
  private accentMats!: THREE.MeshLambertMaterial[];
  private stickyMats!: THREE.MeshLambertMaterial[];
  private exitPanelMat!: THREE.MeshStandardMaterial;
  private exitPanelLight!: THREE.PointLight;

  build(): LevelData {
    this.makeMaterials();
    this.buildShell();
    this.buildGroundFloor();
    this.buildStairs();
    this.buildUpperFloor();
    this.buildVendingMachines();
    this.buildDebris();
    this.buildLighting();

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      occluders: this.occluders,
      waypoints: this.makeWaypoints(),
      enemySpawns: [
        { pos: new THREE.Vector3(0, 0, 10.5), yaw: Math.PI },
        { pos: new THREE.Vector3(-5, 0, -8), yaw: 0 },
        { pos: new THREE.Vector3(9.5, 0, -3), yaw: Math.PI / 2 },
        { pos: new THREE.Vector3(-13, 0, -8.5), yaw: 0.4 },
        { pos: new THREE.Vector3(3.5, 0, -8.5), yaw: 2.6 },
        { pos: new THREE.Vector3(10.5, FLOOR_H, -7), yaw: 0 },
        { pos: new THREE.Vector3(-10.1, FLOOR_H, -4.5), yaw: 1.2 },
        { pos: new THREE.Vector3(0, FLOOR_H, 8), yaw: Math.PI }
      ],
      playerSpawn: new THREE.Vector3(-16.5, 0, 0.1),
      playerSpawnYaw: -Math.PI / 2, // facing east down the cubicle aisle
      flickering: this.flickering,
      glassPanes: this.glassPanes,
      // Staff still on their feet somewhere out on the floor
      civilianSpawns: [
        { pos: new THREE.Vector3(-7.5, 0, 5.5), yaw: 0.3 },
        { pos: new THREE.Vector3(6.5, 0, -6.5), yaw: -1.2 },
        { pos: new THREE.Vector3(-15, 0, -3.5), yaw: 1.4 },
        { pos: new THREE.Vector3(-3, FLOOR_H, 6.5), yaw: 2.8 }
      ],
      // And the ones who were already caught
      exitPanel: this.exitPanelMat,
      exitPanelLight: this.exitPanelLight,
      exitTrigger: new THREE.Box3(
        new THREE.Vector3(17.1, 0, EXIT_Z0 + 0.1),
        new THREE.Vector3(18.35, 2.2, EXIT_Z1 - 0.1)
      ),
      corpseSpawns: [
        { pos: new THREE.Vector3(-2.5, 0, 4.6), yaw: 1.1 },
        { pos: new THREE.Vector3(-11.8, 0, -6.2), yaw: -2.2 },
        { pos: new THREE.Vector3(8.6, 0, 2.4), yaw: 0.4 },
        { pos: new THREE.Vector3(1.5, FLOOR_H, 5.2), yaw: 2.6 }
      ]
    };
  }

  // ------------------------------------------------------------- materials

  private makeMaterials(): void {
    const sx = SLAB_REPEAT_X;
    const sy = SLAB_REPEAT_Y;
    this.carpetMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([46, 52, 64], 14), sx, sy) });
    this.carpetUpMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([58, 52, 48], 12), sx, sy) });
    this.wallMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([196, 192, 182], 7), 4, 2) });
    this.ceilMat = new THREE.MeshLambertMaterial({ map: makeTex(ceilingTileCanvas(), sx, sy) });
    this.cubicleMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([96, 104, 116], 10), 2, 2) });
    this.deskMat = new THREE.MeshLambertMaterial({ color: 0x8a7358 });
    this.darkMetalMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
    this.screenMat = new THREE.MeshBasicMaterial({ map: makeTex(spreadsheetCanvas()) });
    this.paperMat = new THREE.MeshLambertMaterial({ color: 0xe9e7dd });
    this.plasticMat = new THREE.MeshLambertMaterial({ color: 0x24272c });
    this.beigeMat = new THREE.MeshLambertMaterial({ color: 0xc8c2ad }); // old office plastic
    this.accentMats = [0xb4463c, 0x2f6f9e, 0x3f8a55, 0xd8a13a, 0x7a4f8c].map(
      (c) => new THREE.MeshLambertMaterial({ color: c })
    );
    this.stickyMats = [0xe8d86a, 0xe6a8b8, 0x9fd9a8].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  }

  /** Decorative box. `y` is the BASE, matching `solid`. No collider, not shootable. */
  private prop(
    parent: THREE.Object3D,
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    mat: THREE.Material,
    yaw = 0
  ): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = yaw;
    parent.add(m);
    return m;
  }

  /** Decorative cylinder (mugs, cups, pen holders). `y` is the BASE. */
  private cyl(
    parent: THREE.Object3D,
    r: number, h: number,
    x: number, y: number, z: number,
    mat: THREE.Material
  ): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.88, h, 10), mat);
    m.position.set(x, y + h / 2, z);
    parent.add(m);
    return m;
  }

  private pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // --------------------------------------------------------------- helpers

  /**
   * File cabinet: detailed drawer geometry for looks, plus a plain box
   * collider and a shootable shell so ballistics stay simple.
   */
  private cabinet(w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0, drawers = 4): void {
    const g = fileCabinet(w, h, d, drawers);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.group.add(g);
    const swap = Math.abs(Math.sin(yaw)) > 0.5;
    const hw = (swap ? d : w) / 2;
    const hd = (swap ? w : d) / 2;
    // Invisible shell carries the raycast hits so bullets read 'metal'
    const shell = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, h, hd * 2), this.darkMetalMat);
    shell.position.set(x, y + h / 2, z);
    shell.visible = false;
    shell.userData.surface = 'metal';
    this.group.add(shell);
    this.shootables.push(shell);
    this.occluders.push(shell);
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(x - hw, y, z - hd), new THREE.Vector3(x + hw, y + h, z + hd))
    });
  }

  /** Add a solid box: mesh + collider + shootable (+ optional vision occluder). */
  private solid(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    opts: { occlude?: boolean; surface?: string; pierce?: boolean; collide?: boolean } = {}
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.userData.surface = opts.surface ?? 'concrete';
    if (opts.pierce) mesh.userData.pierce = true;
    this.group.add(mesh);
    this.shootables.push(mesh);
    if (opts.occlude !== false) this.occluders.push(mesh);
    if (opts.collide !== false) {
      const collider: Collider = {
        box: new THREE.Box3(
          new THREE.Vector3(x - w / 2, y, z - d / 2),
          new THREE.Vector3(x + w / 2, y + h, z + d / 2)
        )
      };
      if (opts.pierce) collider.pierceable = true;
      this.colliders.push(collider);
    }
    return mesh;
  }

  /** Wall running along X (thin in Z). y = base height. */
  private wallX(x0: number, x1: number, z: number, y: number, h: number, mat?: THREE.Material): void {
    this.solid(Math.abs(x1 - x0), h, 0.22, (x0 + x1) / 2, y, z, mat ?? this.wallMat);
  }

  /** Wall running along Z (thin in X). */
  private wallZ(z0: number, z1: number, x: number, y: number, h: number, mat?: THREE.Material): void {
    this.solid(0.22, h, Math.abs(z1 - z0), x, y, (z0 + z1) / 2, this.wallMat);
    void mat;
  }

  /** Wall along X with a doorway gap [gap0, gap1]; header above the gap. */
  private wallXDoor(x0: number, x1: number, z: number, y: number, h: number, gap0: number, gap1: number): void {
    if (gap0 > x0) this.wallX(x0, gap0, z, y, h);
    if (x1 > gap1) this.wallX(gap1, x1, z, y, h);
    this.solid(gap1 - gap0, h - 2.1, 0.22, (gap0 + gap1) / 2, y + 2.1, z, this.wallMat);
  }

  private wallZDoor(z0: number, z1: number, x: number, y: number, h: number, gap0: number, gap1: number): void {
    if (gap0 > z0) this.wallZ(z0, gap0, x, y, h);
    if (z1 > gap1) this.wallZ(gap1, z1, x, y, h);
    this.solid(0.22, h - 2.1, gap1 - gap0, x, y + 2.1, (gap0 + gap1) / 2, this.wallMat);
  }

  /** Floor/ceiling slab rectangle (top surface at y + SLAB_T). */
  private slab(x0: number, x1: number, z0: number, z1: number, y: number, topMat: THREE.Material): void {
    const w = x1 - x0;
    const d = z1 - z0;
    const geo = new THREE.BoxGeometry(w, SLAB_T, d);
    normalizeSlabUVs(geo, w, d);
    const mesh = new THREE.Mesh(geo, [
      this.wallMat, this.wallMat, topMat, this.ceilMat, this.wallMat, this.wallMat
    ]);
    mesh.position.set((x0 + x1) / 2, y + SLAB_T / 2, (z0 + z1) / 2);
    mesh.userData.surface = 'concrete';
    this.group.add(mesh);
    this.shootables.push(mesh);
    this.occluders.push(mesh);
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y + SLAB_T, z1))
    });
  }

  /** Breakable glass pane spanning [a0,a1] along an axis at fixed cross position. */
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

  /** Simple railing: posts + top bar. Low collider so you can shoot over it. */
  private railing(x0: number, z0: number, x1: number, z1: number, y: number, broken = false): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dir = new THREE.Vector3(x1 - x0, 0, z1 - z0).normalize();
    const posts = Math.max(2, Math.round(len / 1.2) + 1);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), this.darkMetalMat);
      post.position.set(px, y + 0.5, pz);
      if (broken && i === Math.floor(posts / 2)) {
        post.rotation.z = 0.9;
        post.position.y = y + 0.3;
      }
      this.group.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), this.darkMetalMat);
    bar.position.set((x0 + x1) / 2, y + 1.0, (z0 + z1) / 2);
    bar.rotation.y = -Math.atan2(dir.z, dir.x);
    if (broken) {
      bar.rotation.z = -0.5;
      bar.position.y = y + 0.6;
    }
    this.group.add(bar);
    if (!broken) {
      // Thin blocking collider (waist height) so you don't stroll off the edge
      const pad = 0.08;
      this.colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(Math.min(x0, x1) - pad, y, Math.min(z0, z1) - pad),
          new THREE.Vector3(Math.max(x0, x1) + pad, y + 1.05, Math.max(z0, z1) + pad)
        )
      });
    }
  }

  // --------------------------------------------------------- big structure

  private buildShell(): void {
    // Ground slab and roof
    this.slab(-18.4, 18.4, -12.4, 12.4, -SLAB_T, this.carpetMat);
    this.slab(-18.4, 18.4, -12.4, 12.4, FLOOR_H + WALL_H, this.ceilMat);

    // Exterior walls, both storeys (south wall has the entrance)
    for (const y of [0, FLOOR_H]) {
      this.wallX(-18.3, 18.3, -12.3, y, WALL_H + SLAB_T); // north
      if (y === 0) {
        this.wallXDoor(-18.3, 18.3, 12.3, y, WALL_H + SLAB_T, -2, 2); // south + entrance
      } else {
        this.wallX(-18.3, 18.3, 12.3, y, WALL_H + SLAB_T);
      }
      this.wallZ(-12.3, 12.3, -18.3, y, WALL_H + SLAB_T); // west
      if (y === 0) {
        // East wall, with the service door out of the building — the way on
        // to the next floor of the operation. Sits just south of the stairwell.
        this.wallZ(-12.3, EXIT_Z0, 18.3, y, WALL_H + SLAB_T);
        this.wallZ(EXIT_Z1, 12.3, 18.3, y, WALL_H + SLAB_T);
        this.solid(0.22, WALL_H + SLAB_T - 2.25, EXIT_Z1 - EXIT_Z0, 18.3, 2.25, (EXIT_Z0 + EXIT_Z1) / 2, this.wallMat, {
          collide: false
        });
      } else {
        this.wallZ(-12.3, 12.3, 18.3, y, WALL_H + SLAB_T); // east
      }
    }
    this.buildExitDoor();
    // Entrance glass doors (breakable) in the south gap
    this.glass('x', -2, -0.05, 12.3, 0, 2.1);
    this.glass('x', 0.05, 2, 12.3, 0, 2.1);

    // Upper floor slab with two openings:
    //  H1 mezzanine over the cubicle farm: x[-10,0] z[-2,3]
    //  H2 stairwell void: x[SHAFT_VOID_X,18.4] z[-9,-4]
    const y = FLOOR_H - SLAB_T;
    this.slab(-18.4, 18.4, -12.4, -9, y, this.carpetUpMat);
    this.slab(-18.4, SHAFT_VOID_X, -9, -4, y, this.carpetUpMat);
    this.slab(-18.4, 18.4, -4, -2, y, this.carpetUpMat);
    this.slab(-18.4, -10, -2, 3, y, this.carpetUpMat);
    this.slab(0, 18.4, -2, 3, y, this.carpetUpMat);
    this.slab(-18.4, 18.4, 3, 12.4, y, this.carpetUpMat);

    // Mezzanine railings (east edge has the broken section — the drop-down)
    const ry = FLOOR_H;
    this.railing(-10, -2, 0, -2, ry); // south edge
    this.railing(-10, 3, 0, 3, ry); // north edge
    this.railing(-10, -2, -10, 3, ry); // west edge
    this.railing(0, -2, 0, 0, ry); // east edge lower part
    this.railing(0, 0, 0, 2, ry, true); // BROKEN section — jump down here
    this.railing(0, 2, 0, 3, ry); // east edge upper part

    // Stairwell void: guard every upper-floor edge around it. The gap left
    // at the south edge is where flight B arrives.
    this.railing(SHAFT_VOID_X, LANDING_Z, SHAFT_VOID_X, STAIR_Z_BOT, ry); // west
    this.railing(SHAFT_VOID_X, LANDING_Z, SHAFT_X1, LANDING_Z, ry); // north
    this.railing(DIVIDER_X0, STAIR_Z_BOT, SHAFT_X1, STAIR_Z_BOT, ry); // south, east of the opening
  }

  /**
   * The way out to the next level: a service door in the east wall with a
   * status panel over it. The panel is red — locked — until the last
   * intruder on the floor is down, then it turns green.
   */
  private buildExitDoor(): void {
    const cz = (EXIT_Z0 + EXIT_Z1) / 2;
    const w = EXIT_Z1 - EXIT_Z0;
    // Frame
    for (const z of [EXIT_Z0, EXIT_Z1]) {
      this.solid(0.26, 2.25, 0.08, 18.3, 0, z, this.darkMetalMat, { surface: 'metal', collide: false });
    }
    this.solid(0.26, 0.09, w, 18.3, 2.25, cz, this.darkMetalMat, { surface: 'metal', collide: false });
    // Leaf — no collider, the scene gates entry on the trigger instead
    const leaf = this.solid(0.1, 2.2, w - 0.06, 18.18, 0, cz, this.deskMat, {
      surface: 'wood', occlude: false, collide: false
    });
    leaf.userData.surface = 'wood';
    this.solid(0.06, 0.26, 0.06, 18.1, 1.0, cz - w / 2 + 0.28, this.darkMetalMat, {
      surface: 'metal', occlude: false, collide: false
    }); // handle

    // Status panel above the door
    this.exitPanelMat = new THREE.MeshStandardMaterial({
      color: 0x2a0a0a,
      emissive: 0xff2b1c,
      emissiveIntensity: 1.6
    });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, w * 0.82), this.exitPanelMat);
    panel.position.set(18.15, 2.62, cz);
    this.group.add(panel);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, w * 0.9), this.darkMetalMat);
    hood.position.set(18.2, 2.82, cz);
    this.group.add(hood);
    this.exitPanelLight = new THREE.PointLight(0xff3b28, 4.5, 5, 1.9);
    this.exitPanelLight.position.set(17.7, 2.5, cz);
    this.group.add(this.exitPanelLight);
  }

  private buildGroundFloor(): void {
    // Reception desk
    this.solid(4.6, 1.1, 0.9, 0, 0, 7, this.deskMat, { surface: 'wood' });
    this.solid(0.9, 1.1, 1.8, -2.3, 0, 7.6, this.deskMat, { surface: 'wood' });
    this.solid(0.9, 1.1, 1.8, 2.3, 0, 7.6, this.deskMat, { surface: 'wood' });
    this.screen(0.6, 0.4, 0.5, 1.35, 6.9, Math.PI);
    // "RAVI-CALL SYSTEMS" sign block above reception
    const sign = new THREE.Mesh(new THREE.BoxGeometry(5, 0.7, 0.15), this.darkMetalMat);
    sign.position.set(0, 2.4, 6.2);
    this.group.add(sign);

    // Breakroom: x[-18,-9], z[-12,-5]
    this.wallZDoor(-12.3, -5, -9, 0, WALL_H, -8.6, -7.6); // east wall w/ door
    this.wallX(-18.3, -14.2, -5, 0, WALL_H); // north wall west part
    this.wallX(-11.2, -9, -5, 0, WALL_H); // north wall east part
    this.solid(2.95, 0.9, 0.22, -12.7, 0, -5, this.wallMat); // sill under window
    this.glass('x', -14.2, -11.2, -5, 0.9, 1.6); // breakroom window
    this.solid(0.22, WALL_H - 2.5, 3.0, -12.7, 2.5, -5, this.wallMat, { collide: false }); // header
    // Breakroom furniture
    this.solid(1.4, 2.0, 0.8, -17.4, 0, -8.5, this.darkMetalMat, { surface: 'metal' }); // vending machine
    const vendGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.1, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0x7fd4ff, emissiveIntensity: 0.7 })
    );
    vendGlow.position.set(-16.95, 1.2, -8.5);
    vendGlow.rotation.y = Math.PI / 2;
    this.group.add(vendGlow);
    this.solid(1.6, 0.75, 1.6, -13, 0, -9.5, this.deskMat, { surface: 'wood', occlude: false }); // table
    this.solid(1.6, 0.75, 1.6, -11, 0, -6.8, this.deskMat, { surface: 'wood', occlude: false }); // table
    this.solid(1.0, 0.9, 0.6, -9.6, 0, -11.6, this.darkMetalMat, { surface: 'metal', occlude: false }); // counter w/ coffee

    // Cubicle farm: pods centered x {-13.5,-9.5,-5.5,-1.5}, banks at z -1.9 / 2.1
    for (const cx of [-13.5, -9.5, -5.5, -1.5]) {
      this.cubiclePod(cx, -1.9, 0); // facing north
      this.cubiclePod(cx, 2.1, Math.PI); // facing south
    }

    // Back office (z -12..-3, x -9..12): copier, file cabinets, desks
    this.solid(1.5, 1.15, 0.8, 6.5, 0, -11.4, this.darkMetalMat, { surface: 'metal' }); // copier
    this.cabinet(0.6, 1.5, 2.4, -8.6, 0, -10.8); // cabinets
    this.deskCluster(-1.5, -10.5, 0);
    this.deskCluster(2.5, -6.2, Math.PI / 2);
    this.solid(0.5, 1.1, 0.5, 11.2, 0, -10.5, this.darkMetalMat, { surface: 'metal', occlude: false }); // water cooler

    // Stairwell enclosure: door on the west wall, which sits directly under
    // the cut edge of the slab above so the shaft is a clean rectangle.
    this.wallZDoor(-12.3, -2, SHAFT_WALL_X, 0, WALL_H, -3.4, -2.4);
    this.wallX(SHAFT_WALL_X, 18.3, -2, 0, WALL_H);
  }

  /** A 3m-wide cubicle pod: U-shaped fabric panels + desk + monitor + chair. */
  private cubiclePod(cx: number, cz: number, facing: number): void {
    const s = Math.sign(Math.cos(facing)) || 1; // +1 opening north, -1 opening south
    const panelH = 1.5;
    // Back panel
    this.solid(3.0, panelH, 0.08, cx, 0, cz + 0.9 * s, this.cubicleMat, { surface: 'cubicle', pierce: true });
    // Side panels
    this.solid(0.08, panelH, 1.8, cx - 1.5, 0, cz, this.cubicleMat, { surface: 'cubicle', pierce: true });
    this.solid(0.08, panelH, 1.8, cx + 1.5, 0, cz, this.cubicleMat, { surface: 'cubicle', pierce: true });
    // Desk slab along the back
    const deskZ = cz + 0.55 * s;
    this.solid(2.7, 0.72, 0.6, cx, 0, deskZ, this.deskMat, { surface: 'wood', occlude: false });
    // Monitor, offset along the desk — the workstation is built around it
    const seatX = cx + (Math.random() - 0.5) * 1.4;
    this.screen(0.55, 0.35, seatX, 0.95, cz + 0.6 * s, facing);
    // Office chair — the same task chair the intro uses
    const chair = officeChair();
    chair.position.set(cx + (Math.random() - 0.5) * 0.8, 0, cz - 0.25 * s);
    // Back towards the desk, turned a little as if pushed away in a hurry
    chair.rotation.y = (s > 0 ? Math.PI : 0) + (Math.random() - 0.5) * 0.9;
    this.group.add(chair);

    // Clutter, built in desk-local space then turned to face the same way
    const clutter = this.deskClutter(1.35, seatX - cx);
    clutter.position.set(cx, 0, deskZ);
    clutter.rotation.y = s > 0 ? 0 : Math.PI;
    this.group.add(clutter);

    this.panelClutter(cx, 0, cz + 0.85 * s, s);
  }

  /**
   * The usual workstation debris — tower, keyboard and mouse, paper, a mug,
   * phone, pen cup, letter tray — returned in DESK-LOCAL space: origin at the
   * desk centre on the floor, +X along the desk, +Z towards the back of it.
   * Purely decorative: no colliders and not shootable, so bullets still fly
   * over desks exactly as before.
   */
  private deskClutter(halfW: number, seatOffX: number): THREE.Group {
    const g = new THREE.Group();
    const top = 0.72; // desk surface
    const near = -0.16; // towards the chair
    const far = 0.18; // towards the back
    // Keep props on the desk even when the seat sits near an end
    const sx = THREE.MathUtils.clamp(seatOffX, -halfW + 0.45, halfW - 0.45);
    const jitter = (a: number): number => (Math.random() - 0.5) * a;
    const awayFromSeat = sx > 0 ? -1 : 1;

    // Keyboard + mouse in front of the monitor
    this.prop(g, 0.44, 0.022, 0.15, sx, top, near, this.plasticMat, jitter(0.25));
    this.prop(g, 0.062, 0.028, 0.095, sx + 0.34, top, near + 0.02, this.plasticMat, jitter(0.5));
    // Tower on the floor, tucked under the far end of the desk
    this.prop(g, 0.2, 0.44, 0.46, awayFromSeat * (halfW - 0.35), 0, 0.05, this.beigeMat);

    // Loose sheets, plus a stack of printouts
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      const px = sx + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * Math.max(0.1, halfW - 0.6));
      this.prop(g, 0.21, 0.004, 0.28, THREE.MathUtils.clamp(px, -halfW + 0.15, halfW - 0.15), top, jitter(0.3), this.paperMat, jitter(1.4));
    }
    if (Math.random() < 0.75) {
      this.prop(g, 0.22, 0.045, 0.29, awayFromSeat * (0.55 + Math.random() * 0.4), top, far, this.paperMat, jitter(0.5));
    }

    // Mug, pen cup, desk phone, letter tray — each desk gets its own mix
    if (Math.random() < 0.8) {
      this.cyl(g, 0.042, 0.1, sx - 0.36 + jitter(0.1), top, near + jitter(0.08), this.pick(this.accentMats));
    }
    if (Math.random() < 0.6) {
      const px = THREE.MathUtils.clamp(sx + 0.5, -halfW + 0.1, halfW - 0.1);
      this.cyl(g, 0.038, 0.1, px, top, far, this.plasticMat);
      for (let i = 0; i < 3; i++) {
        this.prop(g, 0.008, 0.14, 0.008, px + jitter(0.04), top + 0.04, far + jitter(0.04), this.pick(this.accentMats));
      }
    }
    if (Math.random() < 0.65) {
      const px = awayFromSeat * (0.7 + Math.random() * 0.3);
      this.prop(g, 0.17, 0.05, 0.21, px, top, far, this.beigeMat);
      this.prop(g, 0.16, 0.045, 0.06, px, top + 0.05, far - 0.06, this.beigeMat); // handset
    }
    // Stacking letter tray: base shelf, a wad of paper, upper shelf
    if (Math.random() < 0.5) {
      const px = awayFromSeat * (halfW - 0.2);
      this.prop(g, 0.3, 0.012, 0.24, px, top, far, this.plasticMat);
      this.prop(g, 0.27, 0.05, 0.21, px, top + 0.012, far, this.paperMat);
      this.prop(g, 0.3, 0.012, 0.24, px, top + 0.062, far, this.plasticMat);
    }
    return g;
  }

  /** Sticky notes and a pinned memo on the fabric back panel of a cubicle. */
  private panelClutter(cx: number, baseY: number, faceZ: number, s: number): void {
    const yaw = s > 0 ? Math.PI : 0; // face the inside of the pod
    const count = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const note = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), this.pick(this.stickyMats));
      note.position.set(cx + (Math.random() - 0.5) * 2.4, baseY + 1.0 + Math.random() * 0.34, faceZ);
      note.rotation.set(0, yaw, (Math.random() - 0.5) * 0.3);
      this.group.add(note);
    }
    if (Math.random() < 0.7) {
      const memo = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.29), this.paperMat);
      memo.position.set(cx + (Math.random() - 0.5) * 2.0, baseY + 1.16, faceZ);
      memo.rotation.set(0, yaw, (Math.random() - 0.5) * 0.14);
      this.group.add(memo);
    }
  }

  /** Freestanding pair of desks used in the back office / exec suites. */
  private deskCluster(cx: number, cz: number, rot: number): void {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = rot;
    this.group.add(g);
    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.72, 1.1), this.deskMat);
    desk.position.y = 0.36;
    desk.userData.surface = 'wood';
    g.add(desk);
    this.shootables.push(desk);
    // World-space collider (rot is 0 or 90°, so swap extents)
    const swap = Math.abs(Math.sin(rot)) > 0.5;
    const w = swap ? 1.1 : 2.4;
    const d = swap ? 2.4 : 1.1;
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(cx - w / 2, 0, cz - d / 2), new THREE.Vector3(cx + w / 2, 0.72, cz + d / 2))
    });
    this.screen(0.55, 0.35, cx, 0.95, cz, rot + Math.PI);

    // `g` already carries the desk's position and rotation, so the clutter
    // group goes in at its local origin.
    g.add(this.deskClutter(1.2, (Math.random() - 0.5) * 1.0));
  }

  /**
   * A monitor: solid bezel shell, glowing face inset in the front, neck and
   * base. Built as a group so it reads correctly from every angle — it used
   * to be a bare single-sided plane that vanished when seen edge-on.
   * `y` is the centre of the panel; the base lands 0.055 below it.
   */
  private screen(w: number, h: number, x: number, y: number, z: number, yaw: number): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.group.add(g);

    // Shell — slightly larger than the picture, giving the bezel
    const shell = new THREE.Mesh(new THREE.BoxGeometry(w + 0.045, h + 0.045, 0.042), this.plasticMat);
    shell.position.z = -0.022;
    g.add(shell);
    // Glowing face, just proud of the shell front so it never z-fights
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

  /**
   * Switchback stair filling the shaft: flight A up the east side to a
   * half-landing, flight B back down the west side onto the upper floor.
   * Both flights run wall-to-core with no slot either side, every tread is
   * a solid column off the floor, and the landing spans the full width —
   * which also seals the dead pocket at the north end of the shaft.
   */
  private buildStairs(): void {
    const steps = 10;
    const rise = FLOOR_H / 2 / steps; // 0.165
    const going = 0.3; // tread depth
    const flightW = DIVIDER_X0 - SHAFT_X0; // both flights are the same width
    const flightAX = (DIVIDER_X1 + SHAFT_X1) / 2; // east flight centre
    const flightBX = (SHAFT_X0 + DIVIDER_X0) / 2; // west flight centre
    const tread = { surface: 'metal', occlude: false } as const;

    // Flight A — east side, climbing north to the landing
    for (let i = 0; i < steps; i++) {
      const z = STAIR_Z_BOT - going * i - going / 2;
      this.solid(flightW, rise * (i + 1), going, flightAX, 0, z, this.darkMetalMat, tread);
    }

    // Half-landing, wall to wall
    this.solid(
      SHAFT_X1 - SHAFT_X0, FLOOR_H / 2, STAIR_Z_TOP - LANDING_Z,
      (SHAFT_X0 + SHAFT_X1) / 2, 0, (LANDING_Z + STAIR_Z_TOP) / 2,
      this.darkMetalMat, tread
    );

    // Flight B — west side, climbing south onto the upper floor
    for (let i = 0; i < steps; i++) {
      const z = STAIR_Z_TOP + going * i + going / 2;
      this.solid(flightW, FLOOR_H / 2 + rise * (i + 1), going, flightBX, 0, z, this.darkMetalMat, tread);
    }

    // Stair core between the flights — floor to just above the top flight
    this.solid(
      DIVIDER_X1 - DIVIDER_X0, FLOOR_H + 0.4, STAIR_Z_BOT - STAIR_Z_TOP,
      (DIVIDER_X0 + DIVIDER_X1) / 2, 0, (STAIR_Z_BOT + STAIR_Z_TOP) / 2,
      this.wallMat
    );
  }

  private buildUpperFloor(): void {
    const y = FLOOR_H;

    // Server room: x[-18,-8], z[-12,-3]; entrance + observation glass on north wall
    this.wallZ(-12.3, -3, -8, y, WALL_H); // east wall
    this.wallX(-18.3, -13.5, -3, y, WALL_H); // north wall west part
    this.wallX(-9.6, -8, -3, y, WALL_H); // north wall east stub
    this.solid(2.9, 0.9, 0.22, -12.05, y, -3, this.wallMat); // sill
    this.glass('x', -13.5, -10.6, -3, y + 0.9, 1.6); // observation window
    this.solid(2.9, WALL_H - 2.5, 0.22, -12.05, y + 2.5, -3, this.wallMat, { collide: false }); // header
    this.solid(1.0, WALL_H - 2.1, 0.22, -10.1, y + 2.1, -3, this.wallMat, { collide: false }); // door header
    // Server racks (metal, tall, good hard cover) with blinky lights
    for (const rx of [-16.5, -14.5, -12.5, -10.5]) {
      this.solid(1.1, 2.2, 0.8, rx, y, -8.5, this.darkMetalMat, { surface: 'metal' });
      this.solid(1.1, 2.2, 0.8, rx, y, -5.8, this.darkMetalMat, { surface: 'metal' });
      const led = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x0a0f0a, emissive: 0x2bff88, emissiveIntensity: 0.5 })
      );
      led.position.set(rx, y + 1.2, -5.38);
      this.group.add(led);
    }

    // Executive suites: x[2,12], z[-12,-4]; glass fronts along z=-4
    this.wallZ(-12.3, -4, 2, y, WALL_H); // west wall
    this.wallZ(-12.3, -4, 12, y, WALL_H); // east wall
    this.wallZDoor(-12.3, -4, 7, y, WALL_H, -9, -8); // divider w/ connecting door
    // Office A front: glass + door gap at x[3,4]
    this.solid(1.0, WALL_H - 2.1, 0.22, 3.5, y + 2.1, -4, this.wallMat, { collide: false }); // door header
    this.glass('x', 2.1, 2.95, -4, y, 2.6);
    this.glass('x', 4.05, 6.95, -4, y, 2.6);
    // Office B front: glass + door gap at x[10,11]
    this.solid(1.0, WALL_H - 2.1, 0.22, 10.5, y + 2.1, -4, this.wallMat, { collide: false });
    this.glass('x', 7.05, 9.95, -4, y, 2.6);
    this.glass('x', 11.05, 11.9, -4, y, 2.6);
    // Glass strip above fronts
    this.solid(10, WALL_H - 2.6, 0.22, 7, y + 2.6, -4, this.wallMat, { collide: false });
    // Exec furniture
    this.deskClusterAt(4.5, y, -9, 0);
    this.deskClusterAt(9.5, y, -9, 0);
    this.cabinet(0.6, 1.5, 2.0, 2.4, y, -6, 0, 3); // cabinets A
    this.cabinet(0.6, 1.5, 2.0, 11.6, y, -6, Math.PI, 3); // cabinets B

    // North open lounge: couch, planters, copier — cover around the mezzanine
    this.solid(2.6, 0.75, 1.0, -4, y, 6.5, new THREE.MeshLambertMaterial({ color: 0x5a2f2f }), { surface: 'wood' }); // couch
    this.solid(1.0, 0.75, 2.6, 3.2, y, 7.5, new THREE.MeshLambertMaterial({ color: 0x5a2f2f }), { surface: 'wood' });
    this.solid(1.5, 1.15, 0.8, 12, y, 10.8, this.darkMetalMat, { surface: 'metal' }); // copier
    this.cabinet(0.6, 1.5, 2.4, -14, y, 8); // cabinets
    this.solid(1.2, 0.72, 1.2, -14, y, 4, this.deskMat, { surface: 'wood', occlude: false }); // side table
  }

  /** Desk cluster helper for the upper floor (y offset). */
  private deskClusterAt(cx: number, y: number, cz: number, rot: number): void {
    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.72, 1.1), this.deskMat);
    desk.position.set(cx, y + 0.36, cz);
    desk.rotation.y = rot;
    desk.userData.surface = 'wood';
    this.group.add(desk);
    this.shootables.push(desk);
    this.colliders.push({
      box: new THREE.Box3(new THREE.Vector3(cx - 1.2, y, cz - 0.55), new THREE.Vector3(cx + 1.2, y + 0.72, cz + 0.55))
    });
    this.screen(0.55, 0.35, cx, y + 0.95, cz, rot);

    const clutter = this.deskClutter(1.2, (Math.random() - 0.5) * 1.0);
    clutter.position.set(cx, y, cz);
    clutter.rotation.y = rot;
    this.group.add(clutter);
  }

  /**
   * Underside of whatever is overhead at a ground-floor point: normally the
   * upper-floor slab, but the roof where that slab is cut away (the
   * mezzanine void over the cubicle farm, and the stairwell void).
   */
  private groundCeilingY(x: number, z: number): number {
    const mezzanineVoid = x > -10 && x < 0 && z > -2 && z < 3;
    const stairwellVoid = x > SHAFT_VOID_X && z > LANDING_Z && z < STAIR_Z_BOT;
    return mezzanineVoid || stairwellVoid ? FLOOR_H + WALL_H : FLOOR_H - SLAB_T;
  }

  /**
   * Mounting hardware so a fixture is attached to something: a short canopy
   * where the ceiling is right above, or a pair of drop rods where the
   * fixture hangs in open air below the roof.
   */
  private mountFixture(x: number, z: number, top: number, ceilY: number): void {
    const drop = ceilY - top;
    if (drop <= 0.01) return; // already flush against the tile

    if (drop < 0.3) {
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.42, drop, 0.16), this.darkMetalMat);
      canopy.position.set(x, top + drop / 2, z);
      this.group.add(canopy);
      return;
    }
    // Suspended pendant: a rod at each end, capped with a ceiling canopy
    for (const off of [-0.45, 0.45]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, drop, 6), this.darkMetalMat);
      rod.position.set(x + off, top + drop / 2, z);
      this.group.add(rod);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 8), this.darkMetalMat);
      cap.position.set(x + off, ceilY - 0.025, z);
      this.group.add(cap);
    }
  }

  /**
   * Vending machines: the breakroom bank downstairs and one on the upper
   * lounge. Each gets a box collider — they're solid cover.
   */
  private buildVendingMachines(): void {
    const place = (x: number, y: number, z: number, yaw: number): void => {
      const m = vendingMachine();
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      this.group.add(m);
      // Footprint is 1.0 x 0.78 before rotation; swap for the quarter turns
      const swap = Math.abs(Math.sin(yaw)) > 0.5;
      const hw = (swap ? 0.78 : 1.0) / 2;
      const hd = (swap ? 1.0 : 0.78) / 2;
      this.colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(x - hw, y, z - hd),
          new THREE.Vector3(x + hw, y + 1.95, z + hd)
        )
      });
    };
    // Breakroom, against the west wall next to the old drinks machine
    place(-17.7, 0, -6.6, Math.PI / 2);
    place(-17.7, 0, -5.5, Math.PI / 2);
    // Back office, by the copier
    place(9.0, 0, -11.7, 0);
    // Upper lounge
    place(-16.5, FLOOR_H, 9.6, Math.PI / 2);
    place(5.5, FLOOR_H, 11.7, 0);
  }

  /**
   * The raid has already been through here: paperwork off the desks, chairs
   * knocked over, bins spilled. Purely visual — none of it collides, so it
   * never snags the player mid-fight.
   */
  private buildDebris(): void {
    const paperAt = (x: number, y: number, z: number, n: number, r: number): void => {
      const p = scatteredPaper(n, r);
      p.position.set(x, y, z);
      this.group.add(p);
    };
    // Ground floor: cubicle aisle, back office, lobby, breakroom
    paperAt(-11.5, 0, 0.1, 7, 1.2);
    paperAt(-3.5, 0, 0.1, 5, 0.9);
    paperAt(-1.5, 0, -9.5, 8, 1.4);
    paperAt(4.5, 0, -7.0, 6, 1.1);
    paperAt(-0.5, 0, 6.5, 5, 1.0);
    paperAt(-13, 0, -8.0, 4, 0.8);
    paperAt(9.5, 0, -2.0, 5, 1.0);
    // Upper floor: hallway and the lounge
    paperAt(-4, FLOOR_H, -2.7, 6, 1.2);
    paperAt(4.5, FLOOR_H, -8.5, 5, 0.9);
    paperAt(-12.5, FLOOR_H, 4.0, 6, 1.1);
    paperAt(2.0, FLOOR_H, 7.5, 5, 1.0);

    // Chairs shoved back or tipped over as people ran
    const chairAt = (x: number, y: number, z: number, yaw: number, tipped: boolean): void => {
      const c = officeChair();
      c.position.set(x, y, z);
      c.rotation.y = yaw;
      if (tipped) {
        c.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
        c.position.y = y + 0.28;
      }
      this.group.add(c);
    };
    chairAt(-9.5, 0, 0.4, 1.2, true);
    chairAt(-5.5, 0, 0.6, 2.6, false);
    chairAt(-13.5, 0, -0.4, 0.4, true);
    chairAt(2.2, 0, -6.0, 1.9, false);
    chairAt(-2.0, 0, -9.8, 0.8, true);
    chairAt(4.6, FLOOR_H, -8.6, 2.2, true);
    chairAt(9.4, FLOOR_H, -8.4, 0.6, false);

    // Bins over on their sides, and a couple of dropped cans
    for (const [x, y, z] of [[-7.8, 0, 1.0], [3.6, 0, -9.6], [-16.0, 0, 4.2], [-13.8, FLOOR_H, 3.0]] as const) {
      const b = trashCan();
      b.position.set(x, y + 0.16, z);
      b.rotation.z = Math.PI / 2;
      b.rotation.y = Math.random() * Math.PI;
      this.group.add(b);
    }
    // DEADBULL everywhere — this is a room full of people on a night shift.
    // Tipped over on the floor...
    for (const [x, y, z] of [
      [-10.4, 0, 0.6], [1.2, 0, -8.4], [-6.6, 0, 1.2], [-14.6, 0, 0.4],
      [3.4, 0, 6.8], [-2.2, 0, -6.4], [10.2, 0, -1.6], [-16.2, 0, -9.4],
      [-15.6, FLOOR_H, 5.0], [2.6, FLOOR_H, -3.2], [8.8, FLOOR_H, 8.4], [-11.2, FLOOR_H, -3.4]
    ] as const) {
      const can = sodaCan();
      can.position.set(x, y + 0.05, z);
      can.rotation.z = Math.PI / 2;
      can.rotation.y = Math.random() * Math.PI * 2;
      this.group.add(can);
    }
    // ...and standing on desks and counters
    for (const [x, y, z] of [
      [-13.1, 0.72, -1.35], [-9.1, 0.72, -1.35], [-5.1, 0.72, 2.55], [-1.1, 0.72, -1.35],
      [0.9, 0.72, 7.05], [-2.1, 0.72, -10.3], [2.9, 0.72, -6.5], [-9.9, 0.9, -11.5],
      [4.9, FLOOR_H + 0.72, -9.2], [9.9, FLOOR_H + 0.72, -8.8], [-13.6, FLOOR_H + 0.72, 4.05]
    ] as const) {
      const can = sodaCan();
      can.position.set(x, y, z);
      this.group.add(can);
    }

    // Reading matter, dropped where people left it
    const bookAt = (kind: 'persuade' | 'scamming' | 'comic', x: number, y: number, z: number): void => {
      const b = book(kind);
      b.position.set(x, y, z);
      b.rotation.y = Math.random() * Math.PI * 2;
      this.group.add(b);
    };
    bookAt('persuade', -12.2, 0, 0.9); // the training manuals, on the aisle floor
    bookAt('scamming', -4.8, 0, -0.7);
    bookAt('persuade', 2.6, 0, -9.2);
    bookAt('scamming', -13.4, 0, -7.2); // breakroom
    bookAt('persuade', 3.8, FLOOR_H, -8.2); // exec office A
    bookAt('scamming', 10.2, FLOOR_H, -7.6); // exec office B
    bookAt('comic', -8.2, 0, 1.1);
    bookAt('comic', -15.4, 0, 4.6);
    bookAt('comic', 0.8, FLOOR_H, 7.2);
    bookAt('comic', -12.8, FLOOR_H, 5.4);

    // Coffee gone over as people ran
    for (const [x, y, z] of [
      [-9.2, 0, -0.4], [1.8, 0, 6.2], [-14.2, 0, -9.4],
      [5.2, FLOOR_H, 4.6], [-6.4, FLOOR_H, -2.4]
    ] as const) {
      const c = spilledCoffee();
      c.position.set(x, y, z);
      c.rotation.y = Math.random() * Math.PI * 2;
      this.group.add(c);
    }

    // PRINTED CHIPS, on desks and spilled out of the machines
    const chipsAt = (x: number, y: number, z: number, tipped = false): void => {
      const b = chipsBox();
      b.position.set(x, y, z);
      b.rotation.y = Math.random() * Math.PI * 2;
      if (tipped) {
        b.rotation.z = Math.PI / 2;
        b.position.y = y + 0.085;
      }
      this.group.add(b);
    };
    chipsAt(-16.9, 0, -4.6, true); // dropped by the breakroom machines
    chipsAt(-16.6, 0, -7.5, true);
    chipsAt(-12.6, 0, -9.3); // breakroom table
    chipsAt(8.1, 0, -11.2, true); // by the back-office machine
    chipsAt(-0.3, 0, 7.05); // reception desk
    chipsAt(-3.6, 0, 0.9, true); // cubicle aisle
    chipsAt(-14.4, FLOOR_H, 9.4, true); // upper lounge machine
    chipsAt(5.9, FLOOR_H, 10.9, true);
    chipsAt(-13.9, FLOOR_H, 4.05); // side table
  }

  private buildLighting(): void {
    const g = this.group;
    // Warmer and a touch lifted, to match the intro. The old mix left the
    // floor between fixtures reading as flat cold grey.
    g.add(new THREE.AmbientLight(0x4a4436, 0.95));
    g.add(new THREE.HemisphereLight(0xa39a86, 0x2a2620, 0.6));

    const addLight = (x: number, y: number, z: number, intensity = 9, dist = 11, color = 0xfff2dc) => {
      const l = new THREE.PointLight(color, intensity, dist, 1.6);
      l.position.set(x, y, z);
      g.add(l);
      const fix = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.07, 0.28),
        new THREE.MeshStandardMaterial({ color: 0x999999, emissive: 0xfff6e0, emissiveIntensity: 1.4 })
      );
      fix.position.set(x, y + 0.12, z);
      g.add(fix);
      const ceilY = y > FLOOR_H ? FLOOR_H + WALL_H : this.groundCeilingY(x, z);
      this.mountFixture(x, z, y + 0.155, ceilY); // fixture box: centered y+0.12, 0.07 tall
    };

    /** Sconce bolted flat to a wall face, for the enclosed stairwell. */
    const addSconce = (x: number, y: number, z: number, faceX: number, intensity: number) => {
      const l = new THREE.PointLight(0xfff2dc, intensity, 9, 1.6);
      l.position.set(x + faceX * 0.3, y, z);
      g.add(l);
      const fix = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.34, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x999999, emissive: 0xfff6e0, emissiveIntensity: 1.2 })
      );
      fix.position.set(x + faceX * 0.06, y, z);
      g.add(fix);
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.16), this.darkMetalMat);
      bracket.position.set(x, y + 0.2, z);
      g.add(bracket);
    };

    // Ground floor (ceiling ~2.95)
    addLight(0, 2.8, 8.5); // reception
    addLight(-7.5, 2.8, 0.1); // cubicles W
    addLight(-1.5, 2.8, 0.1); // cubicles E
    addLight(0, 2.8, -8, 8); // back office
    addLight(-13, 2.8, -8.5, 7); // breakroom
    addLight(-16.5, 2.8, 3, 6); // west strip
    // Fill for the stretches that had nothing overhead: the east half of the
    // lobby, the run down to the stairwell door, the south-west corner of the
    // cubicle farm and the east end of the back office.
    addLight(8.5, 2.8, 8.0, 7); // lobby east
    addLight(14.5, 2.8, 6.5, 6, 10); // south-east corner
    addLight(9.5, 2.8, 2.0, 6, 10); // east corridor north
    addLight(-11.5, 2.8, 6.5, 7); // lobby south-west
    addLight(-17.0, 2.8, 8.5, 5, 9); // west corner
    addLight(7.0, 2.8, -9.5, 7); // back office east
    addLight(-6.0, 2.8, -4.5, 6, 10); // between the farm and the back office
    addLight(-17.5, 2.8, -1.5, 5, 9); // west strip south
    // Stairwell: the void runs up to the roof and the middle is filled by the
    // divider wall, so light it from sconces on both faces of that wall. Each
    // sits head-height above the flight it lights, and the flights are at
    // different heights at this z.
    addSconce(DIVIDER_X0, 3.3, -5.5, -1, 5); // west face → flight B (upper)
    addSconce(DIVIDER_X1, 2.4, -5.5, 1, 5); // east face → flight A (lower)

    // Ground east corridor — flickering (dark hallway)
    this.addFlickering(9.5, 2.8, -3, 8, 10);

    // Upper floor (ceiling ~6.2)
    addLight(0, 6.15, 8); // lounge center
    addLight(-12, 6.15, 5, 7); // lounge west
    addLight(9, 6.15, 6, 7); // lounge east
    addLight(-13, 6.15, -7.5, 7, 10, 0xbfd9ff); // server room, cold blue
    addLight(4.5, 6.15, -8, 7); // office A
    addLight(9.5, 6.15, -8, 7); // office B
    // Upper fill: the east end of the lounge, the corners, and the stretch of
    // hallway past the flickering tubes that had nothing of its own.
    addLight(15.5, 6.15, 6.5, 6, 10); // lounge far east
    addLight(15.0, 6.15, -2.8, 6, 10); // hallway east / stair arrival
    addLight(-16.5, 6.15, 8.5, 5, 9); // lounge north-west corner
    addLight(6.5, 6.15, 10.0, 6, 10); // lounge north-east
    addLight(-10.5, 6.15, 0.5, 6, 10); // west of the mezzanine
    addLight(-17.0, 6.15, -10.5, 5, 9, 0xbfd9ff); // server room far corner

    // Upper hallway — the two flickering tubes
    this.addFlickering(1, 6.15, -2.9, 9, 9);
    this.addFlickering(-6, 6.15, -2.9, 9, 9);
  }

  /** Flickering tube plus the hardware holding it to the ceiling. */
  private addFlickering(x: number, y: number, z: number, intensity: number, dist: number): void {
    this.flickering.push(new FlickeringLight(this.group, new THREE.Vector3(x, y, z), intensity, dist));
    const ceilY = y > FLOOR_H ? FLOOR_H + WALL_H : this.groundCeilingY(x, z);
    this.mountFixture(x, z, y + 0.115, ceilY); // fixture box: centered y+0.08, 0.07 tall
  }

  // ------------------------------------------------------------- waypoints

  private makeWaypoints(): Waypoint[] {
    const y0 = 0;
    const y1 = FLOOR_H;
    const pts: [number, number, number][] = [
      [0, y0, 8], // 0 reception
      [-8, y0, 8], // 1 lobby west
      [7, y0, 8], // 2 lobby east
      [9.5, y0, 1], // 3 east corridor N
      [9.5, y0, -7], // 4 east corridor S
      [-3.5, y0, -7], // 5 back office W
      [3.5, y0, -8.5], // 6 back office E
      [-13, y0, -8.5], // 7 breakroom
      [-16.5, y0, 6], // 8 west strip N
      [-11.5, y0, 0.1], // 9 central aisle W
      [-3.5, y0, 0.1], // 10 central aisle E
      [-16.5, y0, -2], // 11 west strip S
      [2, y0, 0.1], // 12 cubicle exit E
      [-11.5, y0, 6], // 13 lobby SW
      // Upper floor
      [14.5, y1, -2.7], // 14 stair arrival
      [10.5, y1, -2.7], // 15 hallway E
      [3.5, y1, -2.7], // 16 hallway mid-E
      [-4, y1, -2.7], // 17 hallway mid-W
      [-10.1, y1, -2.6], // 18 hallway W / server door
      [-10.1, y1, -5], // 19 server room entry
      [-13, y1, -8], // 20 server room deep
      [3.5, y1, -7], // 21 office A
      [10.5, y1, -7], // 22 office B
      [5, y1, 4], // 23 lounge SE
      [0, y1, 8], // 24 lounge N center
      [-8, y1, 8], // 25 lounge NW
      [-14, y1, 2], // 26 lounge W
      // Stairwell route — lets patrols cross between floors
      [11.8, y0, -2.9], // 27 outside the stairwell door
      [14.6, y0, -2.9], // 28 inside the stairwell, vestibule
      [17.22, y0, -3.4], // 29 foot of flight A
      [17.22, y0 + FLOOR_H / 2, -7.9], // 30 landing, east end
      [14.38, y0 + FLOOR_H / 2, -7.9], // 31 landing, west end (foot of flight B)
      [14.38, y1, -3.7] // 32 top of flight B, on the upper floor
    ];
    const links: [number, number][] = [
      [0, 1], [0, 2], [1, 8], [1, 13], [2, 3], [3, 12], [3, 4], [4, 6], [6, 5],
      [5, 7], [5, 10], [10, 12], [10, 9], [9, 13], [13, 8], [8, 11],
      [14, 15], [15, 16], [16, 17], [17, 18], [18, 19], [19, 20],
      [16, 21], [15, 22], [16, 23], [23, 24], [24, 25], [25, 26], [26, 18],
      [3, 27], [4, 27], [27, 28], [28, 29], [29, 30], [30, 31], [31, 32], [32, 14]
    ];
    const wps: Waypoint[] = pts.map(([x, y, z]) => ({ pos: new THREE.Vector3(x, y, z), links: [] }));
    for (const [a, b] of links) {
      wps[a].links.push(b);
      wps[b].links.push(a);
    }
    return wps;
  }
}
