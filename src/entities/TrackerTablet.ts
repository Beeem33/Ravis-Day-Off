import * as THREE from 'three';
import { FirstPersonArms, grip } from './RaviVisual';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * TrackerTablet — the survey drone's tracker. Held up in both hands while M
 * is held, put away again when it's let go. Its screen is a map of the
 * valley turning with him: his arrow in the middle, the beacon's marker
 * (the exit portal) and, when that's off the edge, an arrow pointing to it;
 * down the side its coordinates, his, the distance and the bearing.
 */

/** Right hand round the right edge from behind: fingers up the back, thumb on the front bezel. */
const HOLD_R = grip([0.045, -0.05, -0.035], [-0.35, 0.92, -0.05], [-0.15, 0.1, 1], [0.45, -0.65, 0.6], {
  fingers: [[28, 40, 24], [30, 44, 26], [34, 48, 28], [38, 52, 30]],
  thumb: [0.1, 0.15, 0.1],
  spread: 2
});
const HOLD_L = grip([-0.045, -0.05, -0.035], [0.35, 0.92, -0.05], [0.15, 0.1, 1], [-0.45, -0.65, 0.6], {
  fingers: [[28, 40, 24], [30, 44, 26], [34, 48, 28], [38, 52, 30]],
  thumb: [0.1, 0.15, 0.1],
  spread: 2
});

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

export class TrackerTablet {
  readonly root = new THREE.Group();
  readonly tablet = new THREE.Group();
  private handR = new THREE.Object3D();
  private handL = new THREE.Object3D();
  private arms: FirstPersonArms;
  private screen: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private drawT = 0;
  /** 0 down .. 1 up in front of him. */
  up = 0;
  private t = 0;
  static readonly W = 0.3;
  static readonly H = 0.2;

  constructor(
    camera: THREE.Camera,
    private map: HTMLCanvasElement,
    private bounds: { x0: number; x1: number; z0: number; z1: number }
  ) {
    camera.add(this.root);
    this.root.add(this.tablet);
    const W = TrackerTablet.W;
    const H = TrackerTablet.H;
    // Rugged case: a dark rubber body, yellow bumpers at the corners
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.022, 3, 0.01), new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.75 }));
    this.tablet.add(body);
    const bump = new THREE.MeshStandardMaterial({ color: 0xe0a81c, roughness: 0.6 });
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const b = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.04, 0.03, 2, 0.01), bump);
        b.position.set(sx * (W / 2 - 0.012), sy * (H / 2 - 0.012), 0);
        this.tablet.add(b);
      }
    // A grip strap across the back, an antenna nub on top
    const strap = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.03, 0.006), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 }));
    strap.position.set(0, 0, -0.014);
    this.tablet.add(strap);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.04, 8), bump);
    ant.position.set(W / 2 - 0.04, H / 2 + 0.015, 0);
    this.tablet.add(ant);
    // The screen
    this.screen = document.createElement('canvas');
    this.screen.width = 640;
    this.screen.height = 400;
    this.g = this.screen.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.screen);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.03, H - 0.03), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    face.position.z = 0.0115;
    this.tablet.add(face);
    // The hands' anchors, on its edges
    this.handR.position.set(W / 2, -0.01, 0);
    this.handL.position.set(-W / 2, -0.01, 0);
    this.tablet.add(this.handR, this.handL);
    this.arms = new FirstPersonArms(this.root, camera).set('r', this.handR, HOLD_R).set('l', this.handL, HOLD_L);
    this.root.visible = false;
  }

  update(dt: number, want: boolean, at: THREE.Vector3, yaw: number, target: THREE.Vector3, bob: { phase: number; amount: number }): void {
    this.t += dt;
    this.up = Math.max(0, Math.min(1, this.up + (want ? dt * 3.2 : -dt * 4)));
    const k = smooth(this.up);
    this.root.visible = this.up > 0.01;
    if (!this.root.visible) return;
    const by = -Math.abs(Math.sin(bob.phase)) * 0.008 * bob.amount;
    this.tablet.position.set(0, -0.62 + 0.5 * k + by, -0.36 + 0.02 * k);
    this.tablet.rotation.set(-0.9 + 0.68 * k, 0, 0.05 * (1 - k));
    this.drawT -= dt;
    if (this.drawT <= 0) {
      this.drawT = 1 / 15;
      this.draw(at, yaw, target);
    }
    this.arms.update();
  }

  /** The screen: the map turning with him, the marker, the read-outs. */
  private draw(at: THREE.Vector3, yaw: number, target: THREE.Vector3): void {
    const g = this.g;
    const W = this.screen.width;
    const H = this.screen.height;
    const b = this.bounds;
    g.fillStyle = '#05140c';
    g.fillRect(0, 0, W, H);
    // ---- The map, in a square on the left, centred on him, turned so ahead is up
    const S = 380;
    const ox = 10;
    const oy = 10;
    const ppm = this.map.width / (b.x1 - b.x0);
    const zoom = 1.2;
    g.save();
    g.beginPath();
    g.rect(ox, oy, S, S);
    g.clip();
    g.translate(ox + S / 2, oy + S / 2);
    g.rotate(yaw);
    g.scale(zoom, zoom);
    const mx = (at.x - b.x0) * ppm;
    const my = (at.z - b.z0) * ppm;
    g.globalAlpha = 0.9;
    g.drawImage(this.map, -mx, -my);
    g.globalAlpha = 1;
    // Grid lines every 25 m
    g.strokeStyle = 'rgba(120,255,170,0.12)';
    g.lineWidth = 1 / zoom;
    for (let x = Math.ceil(b.x0 / 25) * 25; x <= b.x1; x += 25) {
      g.beginPath();
      g.moveTo((x - at.x) * ppm, -1000);
      g.lineTo((x - at.x) * ppm, 1000);
      g.stroke();
    }
    for (let z = Math.ceil(b.z0 / 25) * 25; z <= b.z1; z += 25) {
      g.beginPath();
      g.moveTo(-1000, (z - at.z) * ppm);
      g.lineTo(1000, (z - at.z) * ppm);
      g.stroke();
    }
    // The target
    const tx = (target.x - at.x) * ppm;
    const ty = (target.z - at.z) * ppm;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
    g.strokeStyle = `rgba(80,220,255,${0.5 + 0.5 * pulse})`;
    g.lineWidth = 3 / zoom;
    g.beginPath();
    g.arc(tx, ty, (8 + 6 * pulse) / zoom, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#5ae0ff';
    g.beginPath();
    g.arc(tx, ty, 4 / zoom, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // Off the edge: an arrow on the rim toward it
    const sx = Math.cos(yaw) * (target.x - at.x) * ppm * zoom - Math.sin(yaw) * (target.z - at.z) * ppm * zoom;
    const sy = Math.sin(yaw) * (target.x - at.x) * ppm * zoom + Math.cos(yaw) * (target.z - at.z) * ppm * zoom;
    if (Math.abs(sx) > S / 2 - 10 || Math.abs(sy) > S / 2 - 10) {
      const a = Math.atan2(sy, sx);
      const r = S / 2 - 18;
      const k = Math.min(r / Math.abs(Math.cos(a) || 1e-6), r / Math.abs(Math.sin(a) || 1e-6));
      g.save();
      g.translate(ox + S / 2 + Math.cos(a) * k, oy + S / 2 + Math.sin(a) * k);
      g.rotate(a);
      g.fillStyle = '#5ae0ff';
      g.beginPath();
      g.moveTo(12, 0);
      g.lineTo(-8, -9);
      g.lineTo(-8, 9);
      g.closePath();
      g.fill();
      g.restore();
    }
    // Him: an arrow in the middle, pointing up
    g.save();
    g.translate(ox + S / 2, oy + S / 2);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -12);
    g.lineTo(8, 9);
    g.lineTo(0, 4);
    g.lineTo(-8, 9);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    g.strokeStyle = '#3cff8c';
    g.lineWidth = 2;
    g.strokeRect(ox, oy, S, S);
    // N marker on the rim
    g.save();
    g.translate(ox + S / 2, oy + S / 2);
    g.rotate(yaw);
    g.fillStyle = '#3cff8c';
    g.font = 'bold 18px monospace';
    g.textAlign = 'center';
    g.fillText('N', 0, -S / 2 + 20);
    g.restore();
    // ---- Read-outs
    const x0 = ox + S + 16;
    g.fillStyle = '#3cff8c';
    g.font = 'bold 20px monospace';
    g.textAlign = 'left';
    g.fillText('SURVEY TRACKER', x0, 34);
    g.fillStyle = 'rgba(60,255,140,0.35)';
    g.fillRect(x0, 44, W - x0 - 14, 2);
    g.font = '15px monospace';
    g.fillStyle = '#9dffc4';
    g.fillText('BEACON SIGNAL', x0, 74);
    g.fillStyle = '#5ae0ff';
    g.font = 'bold 22px monospace';
    g.fillText('EXIT PORTAL', x0, 100);
    const coord = (v: number): string => (v >= 0 ? '+' : '-') + Math.abs(Math.round(v)).toString().padStart(3, '0');
    g.font = 'bold 20px monospace';
    g.fillText(`X ${coord(target.x)}`, x0, 132);
    g.fillText(`Z ${coord(target.z)}`, x0, 158);
    g.font = '15px monospace';
    g.fillStyle = '#9dffc4';
    g.fillText('YOU', x0, 196);
    g.font = 'bold 18px monospace';
    g.fillStyle = '#ffffff';
    g.fillText(`X ${coord(at.x)}  Z ${coord(at.z)}`, x0, 220);
    const d = Math.hypot(target.x - at.x, target.z - at.z);
    g.font = '15px monospace';
    g.fillStyle = '#9dffc4';
    g.fillText('DISTANCE', x0, 258);
    g.font = 'bold 30px monospace';
    g.fillStyle = '#ffffff';
    g.fillText(`${Math.round(d)} m`, x0, 290);
    // Bearing: where it is relative to where he's facing
    const rel = Math.atan2(sx, -sy);
    g.save();
    g.translate(x0 + 40, 345);
    g.strokeStyle = '#3cff8c';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, 30, 0, Math.PI * 2);
    g.stroke();
    g.rotate(rel);
    g.fillStyle = '#5ae0ff';
    g.beginPath();
    g.moveTo(0, -26);
    g.lineTo(9, 4);
    g.lineTo(-9, 4);
    g.closePath();
    g.fill();
    g.restore();
    g.font = '13px monospace';
    g.fillStyle = '#9dffc4';
    g.fillText('BEARING', x0 + 82, 340);
    g.fillText(`${Math.round(((rel * 180) / Math.PI + 360) % 360)}°`, x0 + 82, 360);
    // Scan lines and a faint flicker
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    this.tex.needsUpdate = true;
  }
}
