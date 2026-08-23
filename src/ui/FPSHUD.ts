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
  private healthBar!: HTMLElement;
  private healthFill!: HTMLElement;
  private healthRegen!: HTMLElement;
  private healthNum!: HTMLElement;
  private shownHealth = -1;
  private shownRegen = -1;
  private unsubs: (() => void)[] = [];
  private hitmarkerTimer: number | null = null;
  private startTime = 0;

  constructor(
    uiRoot: HTMLElement,
    private bus: EventBus,
    private totalEnemies: number,
    private maxHealth: number
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
      <div class="hud-health">
        <span class="hp-label">VITALS</span>
        <div class="hp-track">
          <div class="hp-regen"></div>
          <div class="hp-fill"></div>
          <div class="hp-ticks">${'<span></span>'.repeat(Math.max(0, this.maxHealth - 1))}</div>
        </div>
        <span class="hp-num"></span>
      </div>
      <div class="killfeed"></div>
      <div class="alert-banner">! CONTACT !</div>
      <div class="hud-bottom">
        WASD move &nbsp;·&nbsp; RMB aim &nbsp;·&nbsp; SHIFT sprint &nbsp;·&nbsp; CTRL crouch &nbsp;·&nbsp; SPACE jump &nbsp;·&nbsp; LMB fire
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
    this.healthBar = el.querySelector('.hud-health')!;
    this.healthFill = el.querySelector('.hp-fill')!;
    this.healthRegen = el.querySelector('.hp-regen')!;
    this.healthNum = el.querySelector('.hp-num')!;
    this.setHealth(this.maxHealth);
  }

  /**
   * Health bar: a solid fill for current HP, a dimmer fill creeping in behind
   * it for regeneration progress, and one tick per HP so the discrete hits
   * stay readable.
   */
  setHealth(health: number, regenProgress = 0): void {
    if (health === this.shownHealth && Math.abs(regenProgress - this.shownRegen) < 0.005) return;
    if (health > this.shownHealth && this.shownHealth >= 0) this.pulseHeal();
    this.shownHealth = health;
    this.shownRegen = regenProgress;

    const pct = (health / this.maxHealth) * 100;
    const regenPct = health < this.maxHealth ? ((health + regenProgress) / this.maxHealth) * 100 : pct;
    this.healthFill.style.width = `${pct}%`;
    this.healthRegen.style.width = `${regenPct}%`;
    this.healthNum.textContent = `${health} / ${this.maxHealth}`;
    this.healthBar.classList.toggle('critical', health > 0 && health <= 2);
  }

  private pulseHeal(): void {
    this.healthBar.classList.remove('healed');
    void this.healthBar.offsetWidth; // restart the animation
    this.healthBar.classList.add('healed');
  }

  private wire(): void {
    this.unsubs.push(
      this.bus.on<{ lethal: boolean }>(Events.HitMarker, () => this.flashHitmarker()),
      this.bus.on<{ name: string; remaining: number; headshot: boolean; by?: string }>(Events.EnemyKilled, (e) => {
        this.counter.textContent = String(e.remaining);
        this.addKillFeed(`<span class="you">${e.by ?? 'RAVI'}</span> ${e.headshot ? '⌖' : '✚'} ${e.name.toUpperCase()}`);
      }),
      // The bar itself is driven per-frame from the scene; the event is just
      // the impact cue.
      this.bus.on<{ health: number; maxHealth: number }>(Events.PlayerDamaged, (e) => {
        if (e.health > 0) this.takeHit();
      }),
      this.bus.on<{ killer: string }>(Events.PlayerDied, (e) => {
        const cause = this.deathOverlay.querySelector('#death-cause')!;
        cause.textContent = `${e.killer.toUpperCase()} put you down. Ravi's shift ends here.`;
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

  /** Took real damage — heavier flash than a near miss. */
  private takeHit(): void {
    this.damageFlash.style.transition = 'none';
    this.damageFlash.style.background = 'rgba(200,0,0,0.5)';
    window.setTimeout(() => {
      this.damageFlash.style.transition = 'background 0.55s';
      this.damageFlash.style.background = 'rgba(180,0,0,0)';
    }, 90);
  }

  private ammoEl: HTMLElement | null = null;
  private shownAmmo = '';

  /** Rounds left in the magazine; blinks while reloading. */
  setAmmo(rounds: number, magSize: number, reloading: boolean): void {
    if (!this.ammoEl) {
      this.ammoEl = document.createElement('div');
      this.ammoEl.className = 'hud-ammo';
      this.ammoEl.innerHTML = `<div class="rounds"></div><div>/ ${magSize} &nbsp;·&nbsp; R RELOAD</div>`;
      this.hud.appendChild(this.ammoEl);
    }
    const key = `${rounds}|${reloading}`;
    if (key === this.shownAmmo) return;
    this.shownAmmo = key;
    this.ammoEl.querySelector('.rounds')!.textContent = reloading ? '--' : String(rounds);
    this.ammoEl.classList.toggle('low', !reloading && rounds <= 3);
    this.ammoEl.classList.toggle('reloading', reloading);
  }

  /** Hide the crosshair while aiming down sights — the iron sights take over. */
  setAiming(on: boolean): void {
    const ch = this.hud.querySelector<HTMLElement>('.crosshair');
    if (ch) ch.style.opacity = on ? '0' : '1';
  }

  setAlert(on: boolean): void {
    this.alertBanner.classList.toggle('show', on);
  }
}
