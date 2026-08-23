import { EventBus, Events } from '../core/EventBus';

/**
 * FPSHUD — crosshair, hit markers, kill feed, intruder counter, damage
 * flash, and the death / shift-complete overlays. Pure DOM on top of the
 * WebGL canvas.
 */
export class FPSHUD {
  private root: HTMLElement;
  private hud!: HTMLElement;
  private hitmarker!: HTMLElement;
  private killfeed!: HTMLElement;
  private counter!: HTMLElement;
  private alertBanner!: HTMLElement;
  private deathOverlay!: HTMLElement;
  private winOverlay!: HTMLElement;
  private vignette!: HTMLElement;
  private damageFlash!: HTMLElement;
  private unsubs: (() => void)[] = [];
  private hitmarkerTimer: number | null = null;
  private startTime = 0;

  constructor(
    uiRoot: HTMLElement,
    private bus: EventBus,
    private totalEnemies: number
  ) {
    this.root = uiRoot;
    this.build();
    this.wire();
  }

  private build(): void {
    const el = document.createElement('div');
    el.id = 'hud';
    el.innerHTML = `
      <div id="vignette"></div>
      <div id="damage-flash"></div>
      <div class="crosshair">
        <span class="ch-t"></span><span class="ch-b"></span>
        <span class="ch-l"></span><span class="ch-r"></span>
        <span class="ch-dot"></span>
      </div>
      <div class="hitmarker">
        <span class="hm1"></span><span class="hm2"></span>
        <span class="hm3"></span><span class="hm4"></span>
      </div>
      <div class="hud-topleft">
        INTRUDERS REMAINING<br /><span class="big">${this.totalEnemies}</span>
      </div>
      <div class="killfeed"></div>
      <div class="alert-banner">! CONTACT !</div>
      <div class="hud-bottom">
        WASD move &nbsp;·&nbsp; SHIFT sprint &nbsp;·&nbsp; CTRL crouch &nbsp;·&nbsp; SPACE jump &nbsp;·&nbsp; LMB fire
      </div>
      <div id="death-overlay" class="fullscreen-overlay">
        <h2>YOU DIED</h2>
        <p id="death-cause"></p>
        <p class="overlay-hint">[ CLICK ] RESTART SHIFT &nbsp;&nbsp;&nbsp; [ ESC ] SECURITY OFFICE</p>
      </div>
      <div id="win-overlay" class="fullscreen-overlay">
        <h2>SHIFT COMPLETE</h2>
        <p>All intruders neutralized. Ravi clocks out.</p>
        <p id="win-time"></p>
        <p class="overlay-hint">[ CLICK ] RETURN TO SECURITY OFFICE</p>
      </div>
    `;
    this.root.appendChild(el);
    this.hud = el;
    this.hitmarker = el.querySelector('.hitmarker')!;
    this.killfeed = el.querySelector('.killfeed')!;
    this.counter = el.querySelector('.hud-topleft .big')!;
    this.alertBanner = el.querySelector('.alert-banner')!;
    this.deathOverlay = el.querySelector('#death-overlay')!;
    this.winOverlay = el.querySelector('#win-overlay')!;
    this.vignette = el.querySelector('#vignette')!;
    this.damageFlash = el.querySelector('#damage-flash')!;
  }

  private wire(): void {
    this.unsubs.push(
      this.bus.on<{ lethal: boolean }>(Events.HitMarker, () => this.flashHitmarker()),
      this.bus.on<{ name: string; remaining: number; headshot: boolean; by?: string }>(Events.EnemyKilled, (e) => {
        this.counter.textContent = String(e.remaining);
        this.addKillFeed(`<span class="you">${e.by ?? 'RAVI'}</span> ${e.headshot ? '⌖' : '✚'} ${e.name.toUpperCase()}`);
      }),
      this.bus.on<{ killer: string }>(Events.PlayerDied, (e) => {
        const cause = this.deathOverlay.querySelector('#death-cause')!;
        cause.textContent = `${e.killer.toUpperCase()} got you. One shot is all it takes.`;
        window.setTimeout(() => {
          this.deathOverlay.style.display = 'flex';
        }, 900);
      }),
      this.bus.on(Events.LevelComplete, () => {
        const t = (performance.now() - this.startTime) / 1000;
        const mm = Math.floor(t / 60);
        const ss = (t % 60).toFixed(1).padStart(4, '0');
        this.winOverlay.querySelector('#win-time')!.textContent = `Shift cleared in ${mm}:${ss}`;
        window.setTimeout(() => {
          this.winOverlay.style.display = 'flex';
        }, 1200);
      })
    );
  }

  show(): void {
    this.hud.style.display = 'block';
    this.vignette.style.display = 'block';
    this.startTime = performance.now();
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.hud.remove();
  }

  private flashHitmarker(): void {
    this.hitmarker.classList.remove('fade');
    this.hitmarker.classList.add('show');
    if (this.hitmarkerTimer !== null) window.clearTimeout(this.hitmarkerTimer);
    this.hitmarkerTimer = window.setTimeout(() => {
      this.hitmarker.classList.remove('show');
      this.hitmarker.classList.add('fade');
    }, 70);
  }

  private addKillFeed(html: string): void {
    const div = document.createElement('div');
    div.innerHTML = html;
    this.killfeed.prepend(div);
    window.setTimeout(() => div.classList.add('old'), 4200);
    window.setTimeout(() => div.remove(), 5600);
    while (this.killfeed.children.length > 6) this.killfeed.lastChild?.remove();
  }

  /** Near-miss / suppression flash. */
  nearMiss(): void {
    this.damageFlash.style.background = 'rgba(180,0,0,0.16)';
    window.setTimeout(() => {
      this.damageFlash.style.background = 'rgba(180,0,0,0)';
      this.damageFlash.style.transition = 'background 0.3s';
    }, 60);
  }

  setAlert(on: boolean): void {
    this.alertBanner.classList.toggle('show', on);
  }
}
