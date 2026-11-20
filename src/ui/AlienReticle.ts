/**
 * The crosshair while he has the alien arms up: not a gun's. A slit pupil
 * in the middle that tracks and dilates; round it two living halves — on the
 * left the grabber's (pink, a ring of hooked teeth that bite shut when it
 * takes hold of something), on the right the acid's (green, a drooping arc
 * that drips, flaring each time it spits). It breathes, it turns slowly,
 * and it narrows and goes red when there's something alive under it.
 */

const CSS = `
.alien-reticle{position:absolute;left:50%;top:50%;width:62px;height:62px;margin:-31px 0 0 -31px;pointer-events:none;z-index:6;opacity:0;transition:opacity .25s}
.alien-reticle.on{opacity:.82}
.alien-reticle svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 2px rgba(0,0,0,.8))}
`;

export interface ReticleState {
  /** 0..1 the acid arm's kick (a shot just went). */
  acid: number;
  /** The grabber: idle, out reaching, or holding something. */
  grab: 'idle' | 'out' | 'hold';
  /** Something alive under it. */
  target: boolean;
}

export class AlienReticle {
  private el: HTMLElement;
  private rot: SVGGElement;
  private grab: SVGGElement;
  private teeth: SVGGElement;
  private acid: SVGPathElement;
  private acidGlow: SVGPathElement;
  private drips: SVGCircleElement[] = [];
  private pupil: SVGEllipseElement;
  private iris: SVGCircleElement;
  private t = 0;
  private grabK = 0;
  private targetK = 0;
  private flare = 0;

  constructor(root: HTMLElement) {
    if (!document.getElementById('alien-reticle-css')) {
      const s = document.createElement('style');
      s.id = 'alien-reticle-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.el = document.createElement('div');
    this.el.className = 'alien-reticle';
    // Teeth round the grabber's half: little hooked triangles on an arc
    let teeth = '';
    for (let k = 0; k < 7; k++) {
      const a = (Math.PI * (0.62 + k * 0.125));
      const x = 60 + Math.cos(a) * 40;
      const y = 60 + Math.sin(a) * 40;
      const deg = (a * 180) / Math.PI;
      teeth += `<path d="M0,-3.2 L7,0 L0,3.2 Z" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${(deg + 180).toFixed(1)})" fill="#ffd0e4"/>`;
    }
    let drips = '';
    for (let k = 0; k < 3; k++) drips += `<circle class="drip" r="2" cx="${(92 + k * 4).toFixed(1)}" cy="80" fill="#9aff3a"/>`;
    this.el.innerHTML = `
      <svg viewBox="0 0 120 120">
        <g class="rot">
          <g class="grab">
            <path d="M60,16 A44,44 0 0 0 60,104" fill="none" stroke="#d0407a" stroke-width="3.2" stroke-linecap="round" opacity=".9"/>
            <path d="M60,22 A38,38 0 0 0 60,98" fill="none" stroke="#ff8ab8" stroke-width="1" stroke-dasharray="2 5" opacity=".7"/>
            <g class="teeth">${teeth}</g>
          </g>
          <path class="acidglow" d="M60,16 A44,44 0 0 1 60,104" fill="none" stroke="#7aff2a" stroke-width="8" stroke-linecap="round" opacity=".18"/>
          <path class="acid" d="M60,16 A44,44 0 0 1 60,104" fill="none" stroke="#9aff3a" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="40 6 18 6 60 8" opacity=".95"/>
          ${drips}
        </g>
        <circle class="iris" cx="60" cy="60" r="9" fill="none" stroke="#e8ffd8" stroke-width="1.6" opacity=".85"/>
        <ellipse class="pupil" cx="60" cy="60" rx="1.6" ry="6" fill="#f4fff0"/>
      </svg>`;
    root.appendChild(this.el);
    const q = <T extends Element>(s: string): T => this.el.querySelector(s) as T;
    this.rot = q('.rot');
    this.grab = q('.grab');
    this.teeth = q('.teeth');
    this.acid = q('.acid');
    this.acidGlow = q('.acidglow');
    this.drips = Array.from(this.el.querySelectorAll('.drip'));
    this.pupil = q('.pupil');
    this.iris = q('.iris');
  }

  set visible(on: boolean) {
    this.el.classList.toggle('on', on);
  }

  update(dt: number, s: ReticleState): void {
    this.t += dt;
    const t = this.t;
    this.grabK += ((s.grab === 'hold' ? 1 : s.grab === 'out' ? 0.5 : 0) - this.grabK) * Math.min(1, dt * 10);
    this.targetK += ((s.target ? 1 : 0) - this.targetK) * Math.min(1, dt * 12);
    this.flare = Math.max(this.flare * Math.exp(-dt * 6), s.acid);
    const breathe = 1 + Math.sin(t * 2.2) * 0.012;
    // In on a target; the whole thing slowly turning
    const k = breathe * (1 - this.targetK * 0.16);
    this.rot.setAttribute('transform', `translate(60 60) rotate(${(Math.sin(t * 0.6) * 3).toFixed(2)}) scale(${k.toFixed(3)}) translate(-60 -60)`);
    // The grabber's half closing in round the middle while it holds something; its teeth biting
    const g = this.grabK;
    this.grab.setAttribute('transform', `translate(${(g * 9).toFixed(2)} 0)`);
    this.teeth.setAttribute('transform', `translate(60 60) rotate(${(-g * 18 + Math.sin(t * 9) * g * 4).toFixed(2)}) translate(-60 -60)`);
    // The acid's half flaring when it spits; its drips falling and coming again
    const f = this.flare;
    this.acid.setAttribute('stroke-width', (3.2 + f * 2.5).toFixed(2));
    this.acidGlow.setAttribute('opacity', (0.1 + f * 0.35).toFixed(2));
    this.acid.setAttribute('stroke-dashoffset', (t * 14).toFixed(1));
    this.drips.forEach((d, i) => {
      const u = (t * 0.8 + i * 0.33) % 1;
      d.setAttribute('cy', (78 + i * 6 + u * 22).toFixed(1));
      d.setAttribute('opacity', (Math.sin(u * Math.PI) * 0.9).toFixed(2));
    });
    // The eye: dilating as it fires, a slit on a target; red over something alive
    const red = this.targetK;
    const col = `rgb(${Math.round(232 + 23 * red)},${Math.round(255 - 200 * red)},${Math.round(216 - 170 * red)})`;
    this.pupil.setAttribute('rx', (1.6 + f * 3 - red * 0.6).toFixed(2));
    this.pupil.setAttribute('ry', (6 - red * 1.5 + f * 1.5).toFixed(2));
    this.pupil.setAttribute('fill', col);
    this.iris.setAttribute('stroke', col);
    this.iris.setAttribute('r', (9 - red * 2 + f * 2).toFixed(2));
  }

  dispose(): void {
    this.el.remove();
  }
}
