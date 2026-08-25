import * as THREE from 'three';
import { BreakableGlass } from './BreakableGlass';
import { FlickeringLight } from './FlickeringLight';
import { Collider, Waypoint, EnemySpawn, noiseCanvas, ceilingTileCanvas, spreadsheetCanvas, makeTex } from './OfficeLevelBuilder';
import { officeChair, trashCan, sodaCan, paperStack } from './OfficeProps';

export interface IntroLevelData {
  group: THREE.Group;
  colliders: Collider[];
  shootables: THREE.Object3D[];
  occluders: THREE.Object3D[];
  waypoints: Waypoint[];
  glassPanes: BreakableGlass[];
  flickering: FlickeringLight[];
  playerSpawn: THREE.Vector3;
  playerSpawnYaw: number;
  /** Camera pitch at the top of the cutscene: looking down at his monitor. */
  introPitch: number;
  /** Where Ravi looks during the cutscene — his coworker, out on the floor. */
  coworkerSpawn: EnemySpawn;
  /** The agent who does the shooting, and the one target of the level. */
  agentSpawn: EnemySpawn;
  /** Where he stops, two metres off her, before raising the rifle. */
  agentFiringPos: THREE.Vector3;
  /** Walk in here (once the agent is down) to finish the level. */
  exitTrigger: THREE.Box3;
}

const WALL_H = 3.0;
const T = 0.22; // wall thickness

// ---- Footprint. Three spaces and nothing else: Ravi's office, the small
// floor out front where his coworker works, and the corridor to the exit.
// The office's north and south walls ARE the exterior walls, so there are
// no leftover strips of corridor around it.
const X0 = -9;
const X1 = 14;
const Z0 = -3; // north wall of the whole building
const Z1 = 3; // south wall
const OFFICE_X = -1; // glass wall between Ravi's office and the floor
const DOOR_Z0 = -0.4; // doorway gap in that glass wall
const DOOR_Z1 = 0.7;
const HALL_Z0 = -1.5; // corridor east to the exit
const HALL_Z1 = 1.5;
const HALL_X = 7;

/**
 * IntroOfficeBuilder — the opening level: Ravi's private office behind a
 * glass partition, the open floor where the FBI come through, and a corridor
 * to the door that leads into the main call centre.
 *
 * Deliberately small and hand-placed. Same conventions as
 * OfficeLevelBuilder: `solid()` registers mesh + collider + raycast target,
 * and `y` is always the BASE of a box.
 */
export class IntroOfficeBuilder {
  private group = new THREE.Group();
  private colliders: Collider[] = [];
  private shootables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private glassPanes: BreakableGlass[] = [];
  private flickering: FlickeringLight[] = [];

  private carpetMat!: THREE.MeshLambertMaterial;
  private wallMat!: THREE.MeshLambertMaterial;
  private ceilMat!: THREE.MeshLambertMaterial;
  private deskMat!: THREE.MeshLambertMaterial;
  private darkMetalMat!: THREE.MeshLambertMaterial;
  private screenMat!: THREE.MeshBasicMaterial;
  private paperMat!: THREE.MeshLambertMaterial;
  private plasticMat!: THREE.MeshLambertMaterial;
  private coolerMat!: THREE.MeshLambertMaterial;
  private newsMat!: THREE.MeshBasicMaterial;

  /**
   * What is on Ravi's monitor when the level opens: a news story about the
   * Bureau raiding call centres. He is reading about it as it happens to him.
   */
  private static newsCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 200;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f4f2ec';
    g.fillRect(0, 0, 320, 200);
    // Masthead
    g.fillStyle = '#8c1515';
    g.fillRect(0, 0, 320, 22);
    g.fillStyle = '#fff';
    g.font = 'bold 13px Georgia, serif';
    g.fillText('THE DAILY LEDGER', 8, 16);
    g.fillStyle = '#7a7a7a';
    g.font = '8px monospace';
    g.fillText('BREAKING', 258, 15);
    // Headline
    g.fillStyle = '#111';
    g.font = 'bold 17px Georgia, serif';
    g.fillText('FBI CRACKS DOWN ON', 10, 48);
    g.fillText('SCAM CALL CENTERS', 10, 68);
    g.fillStyle = '#444';
    g.font = 'italic 9px Georgia, serif';
    g.fillText('Nationwide raids target phone fraud rings', 10, 84);
    // Photo block: agents in a doorway
    g.fillStyle = '#2b3138';
    g.fillRect(10, 92, 120, 78);
    g.fillStyle = '#151a1f';
    for (let i = 0; i < 3; i++) {
      g.fillRect(24 + i * 32, 108, 18, 46);
      g.beginPath();
      g.arc(33 + i * 32, 102, 8, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#d8d4c8';
    g.font = '7px monospace';
    g.fillText('Agents enter a Tempe office', 12, 180);
    // Body text as ruled lines
    g.strokeStyle = '#b9b6ad';
    g.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.moveTo(140, 100 + i * 9);
      g.lineTo(140 + (i === 8 ? 90 : 168), 100 + i * 9);
      g.stroke();
    }
    g.fillStyle = '#8c1515';
    g.font = 'bold 9px monospace';
    g.fillText('"WE KNOW WHERE THEY ARE."', 140, 186);
    return c;
  }

  build(): IntroLevelData {
    this.makeMaterials();
    this.buildShell();
    this.buildRavisOffice();
    this.buildFloor();
    this.buildCorridor();
    this.buildLighting();

    return {
      group: this.group,
      colliders: this.colliders,
      shootables: this.shootables,
      occluders: this.occluders,
      waypoints: this.makeWaypoints(),
      glassPanes: this.glassPanes,
      flickering: this.flickering,
      // Standing at his desk. `introPitch` aims him straight at the monitor
      // — the news story is what he's reading when the shooting starts.
      playerSpawn: new THREE.Vector3(-5, 0, -1.3),
      playerSpawnYaw: 0,
      introPitch: IntroOfficeBuilder.pitchTo(new THREE.Vector3(-5, 0, -1.3), new THREE.Vector3(-5, 1.14, Z0 + 0.88)),
      // Staged side-on to Ravi: she is south, the agent walks in from the
      // north, so the player sees both of them in profile with the rifle
      // clearly pointed across the view rather than at the camera.
      coworkerSpawn: { pos: new THREE.Vector3(3.2, 0, 1.4), yaw: 0 },
      agentSpawn: { pos: new THREE.Vector3(3.2, 0, -2.3), yaw: Math.PI },
      /** Where the agent stops before raising the rifle. */
      agentFiringPos: new THREE.Vector3(3.2, 0, -0.7),
      exitTrigger: new THREE.Box3(
        new THREE.Vector3(12.2, 0, -0.9),
        new THREE.Vector3(13.9, 2.2, 0.9)
      )
    };
  }

  /** Camera pitch that puts `target` in the middle of the view from `feet`. */
  private static pitchTo(feet: THREE.Vector3, target: THREE.Vector3): number {
    const eye = feet.clone();
    eye.y += 1.63; // standing eye height
    const flat = Math.hypot(target.x - eye.x, target.z - eye.z);
    return Math.atan2(target.y - eye.y, flat);
  }

  // ------------------------------------------------------------- materials

  private makeMaterials(): void {
    this.carpetMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([44, 48, 58], 14), 12, 6) });
    this.wallMat = new THREE.MeshLambertMaterial({ map: makeTex(noiseCanvas([196, 192, 182], 7), 4, 2) });
    this.ceilMat = new THREE.MeshLambertMaterial({ map: makeTex(ceilingTileCanvas(), 12, 6) });
    this.deskMat = new THREE.MeshLambertMaterial({ color: 0x8a7358 });
    this.darkMetalMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
    this.screenMat = new THREE.MeshBasicMaterial({ map: makeTex(spreadsheetCanvas()) });
    this.paperMat = new THREE.MeshLambertMaterial({ color: 0xe9e7dd });
    this.plasticMat = new THREE.MeshLambertMaterial({ color: 0x24272c });
    this.coolerMat = new THREE.MeshLambertMaterial({ color: 0xd8dde2 });
    this.newsMat = new THREE.MeshBasicMaterial({ map: makeTex(IntroOfficeBuilder.newsCanvas()) });
  }

  // --------------------------------------------------------------- helpers

  private solid(
    w: number, h: number, d: number,
    x: number, y: number, z: number,
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

  /** Decorative prop: drawn, but no collider and not shot at. */
  private prop(
    parent: THREE.Object3D,
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    mat: THREE.Material,
    yaw = 0
  ): void {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = yaw;
    parent.add(m);
  }

  private wallX(x0: number, x1: number, z: number, y = 0, h = WALL_H): void {
    this.solid(Math.abs(x1 - x0), h, T, (x0 + x1) / 2, y, z, this.wallMat);
  }

  private wallZ(z0: number, z1: number, x: number, y = 0, h = WALL_H): void {
    this.solid(T, h, Math.abs(z1 - z0), x, y, (z0 + z1) / 2, this.wallMat);
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

  /** Monitor: solid shell, glowing face, neck and base. */
  private screen(w: number, h: number, x: number, y: number, z: number, yaw: number, mat?: THREE.Material): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.group.add(g);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(w + 0.045, h + 0.045, 0.042), this.plasticMat);
    shell.position.z = -0.022;
    g.add(shell);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat ?? this.screenMat);
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

  // --------------------------------------------------------------- shell

  private buildShell(): void {
    // Floor and ceiling cover the office + front floor; the corridor gets its own
    const w = HALL_X - X0;
    const cx = (X0 + HALL_X) / 2;
    const cz = (Z0 + Z1) / 2;
    this.solid(w, 0.3, Z1 - Z0, cx, -0.3, cz, this.carpetMat, { surface: 'concrete' });
    this.solid(w, 0.3, Z1 - Z0, cx, WALL_H, cz, this.ceilMat, { surface: 'concrete' });
    const hw = X1 - HALL_X;
    this.solid(hw, 0.3, HALL_Z1 - HALL_Z0, (HALL_X + X1) / 2, -0.3, 0, this.carpetMat, { surface: 'concrete' });
    this.solid(hw, 0.3, HALL_Z1 - HALL_Z0, (HALL_X + X1) / 2, WALL_H, 0, this.ceilMat, { surface: 'concrete' });

    // Outer walls of the office + front floor
    this.wallX(X0, HALL_X, Z0);
    this.wallX(X0, HALL_X, Z1);
    this.wallZ(Z0, Z1, X0);
    // East end of the front floor, either side of the corridor mouth
    this.wallZ(Z0, HALL_Z0, HALL_X);
    this.wallZ(HALL_Z1, Z1, HALL_X);
  }

  // ------------------------------------------------------- Ravi's office

  private buildRavisOffice(): void {
    // Glass partition, wall to wall, with an open doorway in it. Ravi watches
    // it all happen through this.
    this.glass('z', Z0 + T / 2, DOOR_Z0, OFFICE_X, 0, 2.6);
    this.glass('z', DOOR_Z1, Z1 - T / 2, OFFICE_X, 0, 2.6);
    // Frame: mullions either side of the doorway plus a header over the lot
    this.solid(0.09, 2.6, 0.09, OFFICE_X, 0, DOOR_Z0, this.darkMetalMat, { surface: 'metal', collide: false });
    this.solid(0.09, 2.6, 0.09, OFFICE_X, 0, DOOR_Z1, this.darkMetalMat, { surface: 'metal', collide: false });
    this.solid(0.09, WALL_H - 2.6, Z1 - Z0, OFFICE_X, 2.6, 0, this.wallMat);

    // Ravi's desk against the north wall — he's reading the news on it when
    // it kicks off. The monitor is raised and tilted up so it fills his view.
    const deskZ = Z0 + 0.72;
    this.solid(2.6, 0.72, 0.8, -5, 0, deskZ, this.deskMat, { surface: 'wood', occlude: false });
    // yaw 0 = the glowing face points +Z, back down the room at Ravi. The
    // plane is single-sided: turned the other way he'd see the plastic shell.
    this.screen(0.66, 0.44, -5, 1.14, deskZ + 0.16, 0, this.newsMat);
    const desk = new THREE.Group();
    this.group.add(desk);
    this.prop(desk, 0.44, 0.022, 0.15, -5, 0.72, deskZ - 0.24, this.plasticMat, 0.05); // keyboard
    this.prop(desk, 0.062, 0.028, 0.095, -4.62, 0.72, deskZ - 0.22, this.plasticMat); // mouse
    this.prop(desk, 0.2, 0.44, 0.46, -6.2, 0, deskZ, this.darkMetalMat); // tower under the desk
    // The drawer the gun comes out of
    this.prop(desk, 0.5, 0.16, 0.02, -4.1, 0.42, deskZ - 0.38, this.darkMetalMat);

    // Paperwork, a can of DEADBULL, and a bin under the desk
    const pap = paperStack(8);
    pap.position.set(-5.9, 0.72, deskZ - 0.02);
    pap.rotation.y = 0.35;
    this.group.add(pap);
    const can = sodaCan();
    can.position.set(-4.32, 0.72, deskZ - 0.1);
    this.group.add(can);
    const bin = trashCan();
    bin.position.set(-3.95, 0, deskZ + 0.15);
    this.group.add(bin);

    // His chair, rolled aside — he's on his feet at the desk, not in it
    const chair = officeChair();
    chair.position.set(-6.15, 0, deskZ + 0.9);
    chair.rotation.y = 0.5;
    this.group.add(chair);

    this.solid(0.6, 1.4, 1.1, -8.3, 0, 1.6, this.darkMetalMat, { surface: 'metal' });
  }

  /**
   * Framed "Employee of the Month" photo of the coworker — same white shirt,
   * blue cap and worried little face as the figure out on the floor, so the
   * body is recognisable as someone Ravi knows.
   */
  private employeePhoto(x: number, y: number, z: number, faceZ: -1 | 1 = 1): void {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 160;
    const g = c.getContext('2d')!;
    g.fillStyle = '#c8ced8'; // studio backdrop
    g.fillRect(0, 0, 128, 160);
    g.fillStyle = '#1d3f6e'; // banner
    g.fillRect(0, 0, 128, 26);
    g.fillStyle = '#f4f2ec';
    g.font = 'bold 13px monospace';
    g.textAlign = 'center';
    g.fillText('EMPLOYEE OF', 64, 12);
    g.fillText('THE MONTH', 64, 23);
    // Shoulders in the white shirt
    g.fillStyle = '#f4f2ec';
    g.beginPath();
    g.ellipse(64, 152, 42, 34, 0, 0, Math.PI * 2);
    g.fill();
    // Head
    g.fillStyle = '#c99d78';
    g.beginPath();
    g.ellipse(64, 96, 26, 30, 0, 0, Math.PI * 2);
    g.fill();
    // The blue cap
    g.fillStyle = '#1d3f6e';
    g.beginPath();
    g.ellipse(64, 76, 27, 20, 0, Math.PI, 0);
    g.fill();
    g.fillRect(37, 74, 54, 6);
    g.fillRect(30, 78, 68, 5); // peak
    // Face: same wide eyes, but smiling for the photo
    g.fillStyle = '#f6f4ef';
    g.beginPath();
    g.ellipse(54, 96, 6, 5, 0, 0, Math.PI * 2);
    g.ellipse(74, 96, 6, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#17110c';
    g.beginPath();
    g.ellipse(54, 96, 2.6, 2.6, 0, 0, Math.PI * 2);
    g.ellipse(74, 96, 2.6, 2.6, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#7a4b3a';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(64, 108, 11, 0.25 * Math.PI, 0.75 * Math.PI);
    g.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.64, 0.04), this.darkMetalMat);
    frame.position.set(x, y, z + faceZ * 0.015);
    this.group.add(frame);
    const pic = new THREE.Mesh(
      new THREE.PlaneGeometry(0.46, 0.58),
      new THREE.MeshLambertMaterial({ map: tex })
    );
    pic.position.set(x, y, z + faceZ * 0.036);
    pic.rotation.y = faceZ > 0 ? 0 : Math.PI;
    this.group.add(pic);
    // A little picture light so it reads in the gloom
    const lamp = new THREE.PointLight(0xffe9c4, 2.4, 2.8, 1.8);
    lamp.position.set(x, y + 0.45, z + faceZ * 0.35);
    this.group.add(lamp);
  }

  // ------------------------------------------------- the floor / bullpen

  /**
   * The small floor out front. Deliberately near-empty: the coworker's own
   * workstation against the south wall and nothing else, so the staging of
   * the shooting reads clearly from Ravi's desk.
   */
  private buildFloor(): void {
    // Her desk, against the south wall and clear of the sightline
    const dz = Z1 - 0.7;
    this.solid(2.2, 0.72, 0.8, 4.0, 0, dz, this.deskMat, { surface: 'wood', occlude: false });
    this.screen(0.55, 0.35, 4.0, 0.98, dz - 0.16, Math.PI); // faces north, into the room
    const d = new THREE.Group();
    this.group.add(d);
    this.prop(d, 0.44, 0.022, 0.15, 4.0, 0.72, dz - 0.28, this.plasticMat, -0.06);
    this.prop(d, 0.062, 0.028, 0.095, 4.38, 0.72, dz - 0.26, this.plasticMat);
    this.prop(d, 0.2, 0.44, 0.46, 3.1, 0, dz, this.darkMetalMat);
    const pap = paperStack(6);
    pap.position.set(4.78, 0.72, dz - 0.08);
    pap.rotation.y = -0.4;
    this.group.add(pap);
    const bin = trashCan();
    bin.position.set(5.35, 0, dz - 0.2);
    this.group.add(bin);
    // Her chair, rolled back — she stood up when they came through the door
    const chair = officeChair(0.46, new THREE.MeshLambertMaterial({ color: 0x3a3340 }));
    chair.position.set(4.25, 0, dz - 1.05);
    chair.rotation.y = Math.PI + 0.35; // back towards the desk, spun round
    this.group.add(chair);

    // EMPLOYEE OF THE MONTH — her portrait, on the wall right above her own
    // desk, so the body on the floor is recognisable as the person in it.
    this.employeePhoto(4.0, 1.95, Z1 - T / 2, -1); // south wall, facing into the room

    // A filing cabinet in the north-east corner, the only bit of cover
    this.solid(0.6, 1.4, 1.0, 6.2, 0, Z0 + 0.7, this.darkMetalMat, { surface: 'metal' });
  }

  // -------------------------------------------------------- exit corridor

  private buildCorridor(): void {
    // Corridor walls, leaving the mouth open at x = HALL_X
    this.wallX(HALL_X, X1, HALL_Z0);
    this.wallX(HALL_X, X1, HALL_Z1);
    // East end, either side of the exit doorway
    this.wallZ(HALL_Z0, -0.9, X1);
    this.wallZ(0.9, HALL_Z1, X1);
    this.solid(T, WALL_H - 2.2, 1.8, X1, 2.2, 0, this.wallMat, { collide: false }); // header

    this.waterCooler(9.4, HALL_Z0 + 0.42);

    // The door out — a real leaf in the opening, plus a lit EXIT sign
    const leaf = this.solid(0.1, 2.2, 1.7, X1 - 0.16, 0, 0, this.deskMat, {
      surface: 'wood', occlude: false, collide: false
    });
    leaf.userData.surface = 'wood';
    this.solid(0.06, 0.26, 0.06, X1 - 0.26, 1.0, 0.6, this.darkMetalMat, {
      surface: 'metal', occlude: false, collide: false
    }); // handle

    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.22, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x1a2a1c, emissive: 0x35ff6a, emissiveIntensity: 1.5 })
    );
    sign.position.set(X1 - 0.4, 2.45, 0);
    this.group.add(sign);
    const signLight = new THREE.PointLight(0x5cff92, 3, 4, 1.8);
    signLight.position.set(X1 - 0.8, 2.3, 0);
    this.group.add(signLight);
  }

  /** Water cooler: base cabinet, spigots, and the blue bottle on top. */
  private waterCooler(x: number, z: number): void {
    this.solid(0.42, 1.02, 0.42, x, 0, z, this.coolerMat, { surface: 'metal', occlude: false });
    // Spigots and a drip tray on the front (facing +Z, into the corridor)
    const g = new THREE.Group();
    this.group.add(g);
    for (const [dx, col] of [[-0.08, 0x2f6f9e], [0.08, 0xb4463c]] as const) {
      const tap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.05), new THREE.MeshLambertMaterial({ color: col }));
      tap.position.set(x + dx, 0.78, z + 0.22);
      g.add(tap);
    }
    this.prop(g, 0.24, 0.02, 0.06, x, 0.6, z + 0.21, this.darkMetalMat); // drip tray

    // The bottle — a tapered cylinder of blue water with a neck
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.20, 0.46, 14),
      new THREE.MeshLambertMaterial({ color: 0x7fc4e8, transparent: true, opacity: 0.72 })
    );
    bottle.position.set(x, 1.28, z);
    this.group.add(bottle);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.14, 12), this.coolerMat);
    neck.position.set(x, 1.02, z);
    this.group.add(neck);
    // Collider covers the bottle too, so you can't walk through it
    this.colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(x - 0.21, 0, z - 0.21),
        new THREE.Vector3(x + 0.21, 1.51, z + 0.21)
      )
    });
  }

  // ------------------------------------------------------------- lighting

  private buildLighting(): void {
    const g = this.group;
    g.add(new THREE.AmbientLight(0x35404e, 0.9));
    g.add(new THREE.HemisphereLight(0x8794a3, 0x1c1a17, 0.55));

    const addLight = (x: number, z: number, intensity = 8, dist = 11): void => {
      const l = new THREE.PointLight(0xfff2dc, intensity, dist, 1.6);
      l.position.set(x, 2.8, z);
      g.add(l);
      const fix = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.07, 0.28),
        new THREE.MeshStandardMaterial({ color: 0x999999, emissive: 0xfff6e0, emissiveIntensity: 1.4 })
      );
      fix.position.set(x, 2.92, z);
      g.add(fix);
      // Short canopy up to the tile, so nothing floats
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.045, 0.16), this.darkMetalMat);
      canopy.position.set(x, 2.9775, z);
      g.add(canopy);
    };

    addLight(-6.4, -1.0, 6); // Ravi's office
    addLight(-2.8, 1.0, 6);
    addLight(3.0, -1.4, 8); // over the floor, where it happens
    addLight(3.0, 1.6, 8);
    addLight(11.0, 0, 6, 9); // corridor

    // One dying tube over the corridor, for mood on the walk out
    this.flickering.push(new FlickeringLight(g, new THREE.Vector3(8.6, 2.8, 0), 7, 8));
    const tubeCanopy = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.085, 0.16), this.darkMetalMat);
    tubeCanopy.position.set(8.6, 2.9575, 0); // bridges tube top (2.915) to tile (3.0)
    g.add(tubeCanopy);
  }

  // ------------------------------------------------------------ waypoints

  private makeWaypoints(): Waypoint[] {
    const pts: [number, number, number][] = [
      [3.2, 0, 0.4], // 0 where she falls
      [1.4, 0, -1.8], // 1 north-west of the floor
      [1.4, 0, 1.8], // 2 south-west of the floor
      [5.6, 0, -1.8], // 3 north-east
      [5.6, 0, 1.8], // 4 south-east
      [0.2, 0, 0.2], // 5 outside Ravi's doorway
      [8.6, 0, 0], // 6 corridor mouth
      [-3.4, 0, 0.2] // 7 inside Ravi's office
    ];
    const links: [number, number][] = [
      [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [2, 4], [3, 4],
      [1, 5], [2, 5], [5, 7], [3, 6], [4, 6]
    ];
    const wps: Waypoint[] = pts.map(([x, y, z]) => ({ pos: new THREE.Vector3(x, y, z), links: [] }));
    for (const [a, b] of links) {
      wps[a].links.push(b);
      wps[b].links.push(a);
    }
    return wps;
  }
}
