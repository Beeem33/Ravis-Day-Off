/**
 * Looking out through a space-suit helmet: the inside of the helmet dark all
 * round the edge of the view, the visor's rim, faint reflections curving
 * across the glass, the suit's readouts printed small in its corners, and the
 * glass fogging a little at the bottom with each breath.
 *
 * A canvas over the game, under the HUD, redrawn when the window changes
 * size; the breath is a separate layer whose opacity goes with his breathing.
 */
export class HelmetVisor {
  private el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private fog: HTMLDivElement;
  private t = 0;
  private onResize = (): void => this.draw();

  constructor(uiRoot: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'helmet-visor';
    this.canvas = document.createElement('canvas');
    this.fog = document.createElement('div');
    this.fog.className = 'hv-fog';
    this.el.append(this.canvas, this.fog);
    // Under the HUD, so the health and prompts stay on top
    uiRoot.prepend(this.el);
    window.addEventListener('resize', this.onResize);
    this.draw();
  }

  /** `breath` speeds up when he's working hard (0 calm .. 1 flat out). */
  update(dt: number, breath = 0): void {
    this.t += dt * (0.32 + breath * 0.35);
    const k = 0.5 - 0.5 * Math.cos(this.t * Math.PI * 2);
    this.fog.style.opacity = String(0.08 + 0.32 * k * k);
  }

  set visible(on: boolean) {
    this.el.style.display = on ? '' : 'none';
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.el.remove();
  }

  private draw(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = this.canvas;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);

    // The visor's opening: a wide rounded window, flatter along the bottom
    const cx = W / 2;
    const cy = H * 0.5;
    const rx = W * 0.5;
    const ry = H * 0.62;
    const opening = (path: CanvasRenderingContext2D, fresh = true): void => {
      if (fresh) path.beginPath();
      path.moveTo(cx + rx, cy);
      path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    };

    // The inside of the helmet: everything outside the opening, dark padded shell, lit a little at the top
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    opening(g, false);
    g.clip('evenodd');
    const shell = g.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.9, cx, cy, Math.max(W, H) * 0.75);
    shell.addColorStop(0, 'rgba(26, 28, 32, 0.96)');
    shell.addColorStop(1, 'rgba(6, 7, 9, 1)');
    g.fillStyle = shell;
    g.fillRect(0, 0, W, H);
    g.restore();

    // A soft shadow just inside the rim, so the glass meets the shell gently
    g.save();
    opening(g);
    g.clip();
    const inner = g.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.72, cx, cy, Math.max(rx, ry) * 1.02);
    inner.addColorStop(0, 'rgba(0,0,0,0)');
    inner.addColorStop(0.75, 'rgba(0,0,0,0.12)');
    inner.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = inner;
    g.fillRect(0, 0, W, H);
    // A faint tint in the glass
    g.fillStyle = 'rgba(150, 210, 255, 0.035)';
    g.fillRect(0, 0, W, H);
    // Reflections: two long curved highlights across the upper left, one small at the right
    g.lineCap = 'round';
    const arc = (r: number, a0: number, a1: number, w: number, alpha: number): void => {
      g.strokeStyle = `rgba(235, 245, 255, ${alpha})`;
      g.lineWidth = w;
      g.beginPath();
      g.ellipse(cx, cy, rx * r, ry * r, 0, a0, a1);
      g.stroke();
    };
    arc(0.9, Math.PI * 1.08, Math.PI * 1.36, Math.max(6, W * 0.012), 0.07);
    arc(0.84, Math.PI * 1.12, Math.PI * 1.28, Math.max(2, W * 0.004), 0.12);
    arc(0.88, Math.PI * 1.62, Math.PI * 1.7, Math.max(3, W * 0.006), 0.06);
    g.restore();

    // The rim of the visor: a thin lit edge
    g.save();
    opening(g);
    g.strokeStyle = 'rgba(160, 170, 182, 0.28)';
    g.lineWidth = 2;
    g.stroke();
    g.restore();

    // The suit's readouts, small, in the glass at the top corners
    const font = Math.max(10, Math.round(H * 0.016));
    g.font = `${font}px "Courier New", monospace`;
    g.fillStyle = 'rgba(120, 255, 190, 0.55)';
    g.textBaseline = 'top';
    const top = H * 0.07;
    g.textAlign = 'left';
    g.fillText('O₂  ████████░░  84%', cx - rx * 0.6, top);
    g.fillText('SUIT PRESSURE  NOMINAL', cx - rx * 0.6, top + font * 1.4);
    g.textAlign = 'right';
    g.fillText('EXT  −41 °C', cx + rx * 0.6, top);
    g.fillText('ATMOS  TOXIC', cx + rx * 0.6, top + font * 1.4);
  }
}
