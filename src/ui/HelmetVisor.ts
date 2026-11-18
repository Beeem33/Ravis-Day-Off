/**
 * Looking out through a space-suit helmet.
 *
 * The visor is a wide window with rounded shoulders and a chin piece coming
 * up into the bottom of it; round it, the inside of the helmet: a padded
 * shell, its seams, two lamp housings glowing at the top corners, and the
 * comms mic just in sight at the bottom. The glass has its own life: edges
 * that darken and tint, long curved reflections, fine scratches, dust and a
 * smudge, breath fogging it at the bottom, and water running down it in
 * drops after he comes up out of the lake. The whole thing sways a touch
 * against the way he looks and moves, like a head inside a helmet.
 *
 * Canvases over the game, under the HUD: the helmet and glass are drawn once
 * per window size; only the drops, the breath and the sway change per frame.
 */
interface Drop {
  x: number;
  y: number;
  r: number;
  v: number;
  trail: number;
}

export class HelmetVisor {
  private el: HTMLDivElement;
  private frame: HTMLCanvasElement;
  private wet: HTMLCanvasElement;
  private fog: HTMLDivElement;
  private t = 0;
  private swayX = 0;
  private swayY = 0;
  private drops: Drop[] = [];
  private wetT = 0;
  private onResize = (): void => this.draw();

  constructor(uiRoot: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'helmet-visor';
    this.frame = document.createElement('canvas');
    this.wet = document.createElement('canvas');
    this.wet.className = 'hv-wet';
    this.fog = document.createElement('div');
    this.fog.className = 'hv-fog';
    this.el.append(this.wet, this.fog, this.frame);
    // Under the HUD, so the health and prompts stay on top
    uiRoot.prepend(this.el);
    window.addEventListener('resize', this.onResize);
    this.draw();
  }

  /**
   * One frame. `breath` 0 calm .. 1 working hard; `lookX/Y` how fast he's
   * turning (mouse delta this frame); `bob` his stride, for the sway.
   */
  update(dt: number, breath = 0, lookX = 0, lookY = 0, bob = 0): void {
    this.t += dt * (0.32 + breath * 0.35);
    const k = 0.5 - 0.5 * Math.cos(this.t * Math.PI * 2);
    this.fog.style.opacity = String(0.06 + 0.3 * k * k);
    // The helmet lags the head a little: turn right and it slides left a few pixels, then settles
    const tx = Math.max(-14, Math.min(14, -lookX * 0.35)) + Math.sin(bob) * 2.5;
    const ty = Math.max(-10, Math.min(10, -lookY * 0.25)) + Math.abs(Math.cos(bob)) * 2;
    this.swayX += (tx - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (ty - this.swayY) * Math.min(1, dt * 8);
    this.frame.style.transform = `translate(${this.swayX.toFixed(1)}px, ${this.swayY.toFixed(1)}px)`;
    this.stepDrops(dt);
  }

  /** Just out of the water: drops on the glass for a few seconds. */
  splash(): void {
    this.wetT = 5;
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (let i = 0; i < 70; i++) this.drops.push({ x: Math.random() * W, y: Math.random() * H * 0.9, r: 2 + Math.random() * 7, v: 0, trail: 0 });
  }

  set visible(on: boolean) {
    this.el.style.display = on ? '' : 'none';
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.el.remove();
  }

  // ---------------------------------------------------------------- drops

  private stepDrops(dt: number): void {
    if (!this.drops.length && this.wetT <= 0) return;
    const c = this.wet;
    const g = c.getContext('2d')!;
    this.wetT = Math.max(0, this.wetT - dt);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = c.width / Math.max(1, W);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      // Big ones slide; small ones sit, then go
      if (d.r > 4.5 && Math.random() < dt * 2) d.v = 40 + d.r * 18;
      d.y += d.v * dt;
      d.v *= Math.max(0, 1 - dt * 1.5);
      d.trail = Math.min(60, d.trail + d.v * dt);
      d.r -= dt * (this.wetT > 0 ? 0.25 : 1.2);
      if (d.r <= 0.4 || d.y > H + 10) {
        this.drops.splice(i, 1);
        continue;
      }
      const a = Math.min(1, d.r / 4);
      if (d.trail > 2) {
        g.strokeStyle = `rgba(210, 240, 255, ${0.12 * a})`;
        g.lineWidth = d.r * 0.7;
        g.beginPath();
        g.moveTo(d.x, d.y - d.trail);
        g.lineTo(d.x, d.y);
        g.stroke();
      }
      const gr = g.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.3, 0, d.x, d.y, d.r);
      gr.addColorStop(0, `rgba(255, 255, 255, ${0.55 * a})`);
      gr.addColorStop(0.5, `rgba(190, 230, 255, ${0.18 * a})`);
      gr.addColorStop(1, `rgba(20, 40, 60, ${0.3 * a})`);
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(d.x, d.y, d.r * 0.85, d.r, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (!this.drops.length) g.clearRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- draw

  private draw(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // The frame canvas runs a little past the screen, so its sway never shows an edge
    const pad = 24;
    for (const c of [this.frame, this.wet]) {
      const p = c === this.frame ? pad : 0;
      c.width = Math.round((W + p * 2) * dpr);
      c.height = Math.round((H + p * 2) * dpr);
      c.style.left = `${-p}px`;
      c.style.top = `${-p}px`;
      c.style.width = `${W + p * 2}px`;
      c.style.height = `${H + p * 2}px`;
    }
    const g = this.frame.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, dpr * pad, dpr * pad);
    g.clearRect(-pad, -pad, W + pad * 2, H + pad * 2);

    // ---- the visor's opening: wide, rounded shoulders, sides bowing out, a chin piece up into the bottom
    const cx = W / 2;
    const top = H * -0.02;
    const bot = H * 1.02;
    const half = W * 0.5;
    const chinW = W * 0.13;
    const chinH = H * 0.1;
    const opening = (fresh: boolean): void => {
      if (fresh) g.beginPath();
      g.moveTo(cx, top);
      g.bezierCurveTo(cx + half * 0.7, top, cx + half * 1.02, top + H * 0.12, cx + half * 1.0, H * 0.38);
      g.bezierCurveTo(cx + half * 0.99, H * 0.68, cx + half * 0.86, bot - H * 0.08, cx + half * 0.56, bot);
      // The chin piece: up and over, rounded
      g.lineTo(cx + chinW, bot);
      g.bezierCurveTo(cx + chinW * 0.7, bot - chinH, cx - chinW * 0.7, bot - chinH, cx - chinW, bot);
      g.lineTo(cx - half * 0.56, bot);
      g.bezierCurveTo(cx - half * 0.86, bot - H * 0.08, cx - half * 0.99, H * 0.68, cx - half * 1.0, H * 0.38);
      g.bezierCurveTo(cx - half * 1.02, top + H * 0.12, cx - half * 0.7, top, cx, top);
      g.closePath();
    };

    // ---- the inside of the helmet, everywhere outside the opening
    g.save();
    g.beginPath();
    g.rect(-pad, -pad, W + pad * 2, H + pad * 2);
    opening(false);
    g.clip('evenodd');
    const shell = g.createRadialGradient(cx, H * 0.45, Math.min(W, H) * 0.45, cx, H * 0.45, Math.max(W, H) * 0.8);
    shell.addColorStop(0, '#2a2d33');
    shell.addColorStop(0.6, '#15171b');
    shell.addColorStop(1, '#07080a');
    g.fillStyle = shell;
    g.fillRect(-pad, -pad, W + pad * 2, H + pad * 2);
    // Quilted padding: soft diagonal seams in the dark
    g.strokeStyle = 'rgba(255,255,255,0.025)';
    g.lineWidth = 2;
    for (let i = -H; i < W + H; i += 46) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + H, H);
      g.moveTo(i + H, 0);
      g.lineTo(i, H);
      g.stroke();
    }
    // The chin piece and the mic on its boom
    const chin = g.createLinearGradient(0, bot - chinH, 0, bot);
    chin.addColorStop(0, '#3a3e45');
    chin.addColorStop(1, '#16181c');
    g.fillStyle = chin;
    g.beginPath();
    g.moveTo(cx - chinW * 1.2, bot + 4);
    g.bezierCurveTo(cx - chinW * 0.8, bot - chinH * 1.05, cx + chinW * 0.8, bot - chinH * 1.05, cx + chinW * 1.2, bot + 4);
    g.fill();
    g.fillStyle = '#0d0e10';
    g.beginPath();
    g.ellipse(cx + chinW * 0.15, bot - chinH * 0.62, chinW * 0.16, chinH * 0.2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = -2; i <= 2; i++) g.fillRect(cx + chinW * 0.15 + i * chinW * 0.05 - 1, bot - chinH * 0.7, 2, chinH * 0.16);
    // Lamp housings at the top corners, their glow spilling onto the rim
    for (const s of [-1, 1]) {
      const lx = cx + s * half * 0.8;
      const ly = H * 0.06;
      const glow = g.createRadialGradient(lx, ly, 0, lx, ly, W * 0.12);
      glow.addColorStop(0, 'rgba(255, 236, 190, 0.22)');
      glow.addColorStop(1, 'rgba(255, 236, 190, 0)');
      g.fillStyle = glow;
      g.fillRect(lx - W * 0.12, ly - W * 0.12, W * 0.24, W * 0.24);
    }
    g.restore();

    // ---- the glass
    g.save();
    opening(true);
    g.clip();
    // A faint tint, darker and bluer toward the edges where it curves away
    const edge = g.createRadialGradient(cx, H * 0.48, Math.min(W, H) * 0.35, cx, H * 0.48, Math.max(W, H) * 0.62);
    edge.addColorStop(0, 'rgba(120, 190, 255, 0.025)');
    edge.addColorStop(0.7, 'rgba(40, 70, 110, 0.12)');
    edge.addColorStop(1, 'rgba(0, 6, 14, 0.7)');
    g.fillStyle = edge;
    g.fillRect(0, 0, W, H);
    // Long curved reflections across the upper glass, and a soft one low on the right
    g.lineCap = 'round';
    const sweep = (r: number, a0: number, a1: number, w: number, alpha: number): void => {
      g.strokeStyle = `rgba(235, 245, 255, ${alpha})`;
      g.lineWidth = w;
      g.beginPath();
      g.ellipse(cx, H * 0.55, half * r, H * 0.62 * r, 0, a0, a1);
      g.stroke();
    };
    sweep(0.92, Math.PI * 1.1, Math.PI * 1.36, Math.max(8, W * 0.016), 0.06);
    sweep(0.86, Math.PI * 1.13, Math.PI * 1.29, Math.max(2, W * 0.004), 0.13);
    sweep(0.9, Math.PI * 1.6, Math.PI * 1.7, Math.max(4, W * 0.007), 0.06);
    sweep(0.8, Math.PI * 0.1, Math.PI * 0.2, Math.max(6, W * 0.012), 0.035);
    // Fine scratches, dust, and a smudge where a glove wiped it
    let seed = 7;
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.strokeStyle = 'rgba(230, 240, 255, 0.07)';
    g.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const l = 10 + rnd() * 60;
      const a = rnd() * Math.PI;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 6, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    for (let i = 0; i < 140; i++) {
      g.fillStyle = `rgba(230, 235, 240, ${0.04 + rnd() * 0.08})`;
      g.beginPath();
      g.arc(rnd() * W, rnd() * H, 0.5 + rnd() * 1.4, 0, Math.PI * 2);
      g.fill();
    }
    const smudge = g.createRadialGradient(W * 0.24, H * 0.74, 0, W * 0.24, H * 0.74, W * 0.11);
    smudge.addColorStop(0, 'rgba(220, 230, 240, 0.06)');
    smudge.addColorStop(1, 'rgba(220, 230, 240, 0)');
    g.fillStyle = smudge;
    g.fillRect(0, 0, W, H);
    g.restore();

    // ---- the rim: the seal just inside it, and a lit edge
    g.save();
    opening(true);
    g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = 'rgba(190, 198, 210, 0.35)';
    g.lineWidth = 2.5;
    g.stroke();
    g.restore();

    // ---- the suit's readouts, small, projected in the glass at the top corners
    const font = Math.max(10, Math.round(H * 0.016));
    g.font = `${font}px "Courier New", monospace`;
    g.fillStyle = 'rgba(120, 255, 190, 0.55)';
    g.shadowColor = 'rgba(80, 255, 170, 0.6)';
    g.shadowBlur = 6;
    g.textBaseline = 'top';
    const ty = H * 0.08;
    g.textAlign = 'left';
    g.fillText('O₂  ████████░░  84%', cx - half * 0.62, ty);
    g.fillText('SUIT PRESSURE  NOMINAL', cx - half * 0.62, ty + font * 1.4);
    g.textAlign = 'right';
    g.fillText('EXT  −41 °C', cx + half * 0.62, ty);
    g.fillText('ATMOS  TOXIC', cx + half * 0.62, ty + font * 1.4);
    g.shadowBlur = 0;
  }
}
