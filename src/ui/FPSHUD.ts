import { EventBus, Events } from '../core/EventBus';

/**
 * FPSHUD — crosshair, hit markers, kill feed, intruder counter, damage
 * flash, a boss's health bar, interaction prompts, and the death /
 * shift-complete overlays. Pure DOM on top of the WebGL canvas.
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
        WASD move &nbsp;·&nbsp; RMB aim &nbsp;·&nbsp; SHIFT sprint &nbsp;·&nbsp; C crouch &nbsp;·&nbsp; SPACE jump &nbsp;·&nbsp; LMB fire
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
        <p class="overlay-hint">[ P ] PLAY AGAIN &nbsp;&nbsp;&nbsp; [ ESC ] SECURITY OFFICE</p>
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
        }, 3000);
      })
    );
  }

  show(): void {
    this.hud.style.display = 'block';
    this.vignette.style.display = 'block';
    this.startTime = performance.now();
  }

  /** Out of the way for a cutscene: crosshair, vitals, ammo and all. */
  hide(): void {
    this.hud.style.display = 'none';
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.hud.remove();
    // The bars live beside the HUD, and the grade is on the game canvas —
    // neither goes with it, and a level quit mid-takedown would otherwise
    // hand the menu a letterboxed, desaturated picture.
    for (const bar of this.cineBars) bar.remove();
    this.gradeCanvas(false);
  }

  private cineBars: HTMLElement[] = [];
  private cinematic = false;

  /**
   * Cutscene framing for the knife takedown: black bars closing in from the
   * top and bottom, the rest of the HUD faded out, and the picture graded a
   * little colder and harder. All CSS transitions, so the scene only has to
   * say on or off, every frame, and this does nothing until it changes.
   */
  setCinematic(on: boolean): void {
    if (on === this.cinematic) return;
    this.cinematic = on;
    if (!this.cineBars.length) {
      for (const edge of ['top', 'bottom']) {
        const bar = document.createElement('div');
        bar.style.cssText =
          `position:absolute;left:0;right:0;${edge}:0;height:11.5vh;background:#000;pointer-events:none;` +
          `transform:scaleY(0);transform-origin:${edge};transition:transform .35s cubic-bezier(.3,0,.2,1);`;
        this.root.appendChild(bar);
        this.cineBars.push(bar);
      }
    }
    for (const bar of this.cineBars) bar.style.transform = on ? 'scaleY(1)' : 'scaleY(0)';
    this.hud.style.transition = 'opacity .3s';
    this.hud.style.opacity = on ? '0' : '1';
    this.gradeCanvas(on);
  }

  private gradeCanvas(on: boolean): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#app canvas');
    if (!canvas) return;
    canvas.style.transition = 'filter .4s';
    canvas.style.filter = on ? 'saturate(0.75) contrast(1.12) brightness(0.95)' : '';
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
  private shownMagSize = -1;

  /** Rounds left in the magazine; blinks while reloading. */
  setAmmo(rounds: number, magSize: number, reloading: boolean): void {
    if (!this.ammoEl) {
      this.ammoEl = document.createElement('div');
      this.ammoEl.className = 'hud-ammo';
      this.hud.appendChild(this.ammoEl);
    }
    if (magSize !== this.shownMagSize) {
      // Weapon switch changed the magazine size — rebuild the readout
      this.shownMagSize = magSize;
      this.ammoEl.innerHTML = `<div class="rounds"></div><div>/ ${magSize} &nbsp;·&nbsp; R RELOAD</div>`;
      this.shownAmmo = '';
    }
    const key = `${rounds}|${reloading}`;
    if (key === this.shownAmmo) return;
    this.shownAmmo = key;
    this.ammoEl.querySelector('.rounds')!.textContent = reloading ? '--' : String(rounds);
    this.ammoEl.classList.toggle('low', !reloading && rounds <= 3);
    this.ammoEl.classList.toggle('reloading', reloading);
  }

  private takedownEl: HTMLElement | null = null;

  /** "F — TAKEDOWN" prompt when an enemy is close enough to grab. */
  setTakedownHint(show: boolean): void {
    if (show && !this.takedownEl) {
      this.takedownEl = document.createElement('div');
      this.takedownEl.textContent = 'F — TAKEDOWN';
      this.takedownEl.style.cssText =
        'position:absolute;left:50%;top:58%;transform:translateX(-50%);' +
        'font:bold 15px monospace;color:#ff5b4a;letter-spacing:0.2em;' +
        'text-shadow:0 0 8px rgba(255,60,40,0.6);pointer-events:none;';
      this.hud.appendChild(this.takedownEl);
    }
    if (this.takedownEl) this.takedownEl.style.display = show ? '' : 'none';
  }

  // ------------------------------------------------------------- boss bar

  private bossEl: HTMLElement | null = null;
  private bossNameEl: HTMLElement | null = null;
  private bossSubEl: HTMLElement | null = null;
  private bossFill: HTMLElement | null = null;
  private bossTrail: HTMLElement | null = null;
  private bossShown = false;
  private bossFrac = -1;
  private bossName = '';
  private bossSub = '';
  private bossFlashAt = 0;

  /**
   * A boss's health across the top of the screen: his name, a line beside it
   * saying who he is, and a long thin bar. Behind the bar's fill runs a pale
   * damage trail that holds where the health was while the hits keep coming,
   * then drains to catch up — so a burst that lands shows as one chunk bitten
   * out, rather than the fill just creeping down. Faint ticks mark the
   * thirds (where the General's fight changes gear).
   *
   * `frac` is 0..1. `null` for the name fades the bar out. Meant to be called
   * every frame: nothing touches the page unless something has changed, and
   * the trail and the fades are CSS, so it doesn't need calling to animate.
   * It lives inside the HUD, so hide(), setCinematic and destroy() take it too.
   */
  setBoss(name: string | null, frac: number, sub?: string): void {
    if (name === null) {
      if (this.bossShown && this.bossEl) this.bossEl.classList.remove('show');
      this.bossShown = false;
      return;
    }
    if (!this.bossEl) this.buildBoss();
    const el = this.bossEl!;
    const fill = this.bossFill!;
    const trail = this.bossTrail!;

    if (name !== this.bossName) {
      this.bossName = name;
      this.bossNameEl!.textContent = name;
    }
    const s = sub ?? '';
    if (s !== this.bossSub) {
      this.bossSub = s;
      this.bossSubEl!.textContent = s;
      this.bossSubEl!.style.display = s ? '' : 'none';
    }

    // Quantised, but finely enough that every round that lands still moves it
    const f = Math.round(Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0)) * 4000) / 4000;
    const appearing = !this.bossShown;
    if (!appearing && f === this.bossFrac) return;
    const hurt = !appearing && f < this.bossFrac;
    this.bossFrac = f;

    const pct = `${(f * 100).toFixed(3)}%`;
    el.classList.toggle('low', f > 0 && f <= 0.2);

    if (appearing) {
      // Jump straight there, with no transitions: one left running from a
      // previous fight would outrank the sweep below (transitions win the
      // cascade over animations). A one-off forced layout, only on showing.
      fill.style.transition = trail.style.transition = 'none';
      fill.style.width = trail.style.width = pct;
      void el.offsetWidth;
      fill.style.transition = trail.style.transition = '';
      this.bossShown = true;
      el.classList.add('show');
      // Fills up as it comes in, as a boss bar should
      const sweep: Keyframe[] = [{ width: '0%' }, { width: pct }];
      const timing: KeyframeAnimationOptions = { duration: 1100, easing: 'cubic-bezier(.2,.7,.2,1)' };
      fill.animate(sweep, timing);
      trail.animate(sweep, timing);
      return;
    }

    fill.style.width = pct;
    // The trail is sent to the same place, but its transition waits before it
    // moves — and every new hit restarts the wait, so it holds through a burst
    // and only drains once the shooting stops. It sits under the fill, so on
    // the way up (a reset) it is never seen.
    trail.style.width = pct;
    if (hurt) {
      // A flash on the fill as the round lands — at most every few frames, so
      // full auto doesn't just leave it lit
      const now = performance.now();
      if (now - this.bossFlashAt > 80) {
        this.bossFlashAt = now;
        fill.animate([{ filter: 'brightness(2.1)' }, { filter: 'brightness(1)' }], { duration: 170, easing: 'ease-out' });
      }
    }
  }

  private buildBoss(): void {
    const el = document.createElement('div');
    el.className = 'boss-bar';
    el.innerHTML = `
      <div class="bb-head"><span class="bb-name"></span><span class="bb-sub"></span></div>
      <div class="bb-track">
        <div class="bb-trail"></div>
        <div class="bb-fill"></div>
        <div class="bb-ticks"><i style="left:33.333%"></i><i style="left:66.667%"></i></div>
      </div>
    `;
    // Ahead of the death and win overlays in #hud, so they draw over it —
    // appended after them, the bar would float on top of "YOU DIED"
    this.hud.insertBefore(el, this.deathOverlay);
    this.bossEl = el;
    this.bossNameEl = el.querySelector('.bb-name');
    this.bossSubEl = el.querySelector('.bb-sub');
    this.bossFill = el.querySelector('.bb-fill');
    this.bossTrail = el.querySelector('.bb-trail');
    this.bossSubEl!.style.display = 'none';
  }

  // ------------------------------------------------------------- prompt

  private promptEl: HTMLElement | null = null;
  private promptText: string | null = null;

  /**
   * A centred prompt under the crosshair for something he can do right now,
   * like "[ E ] GET IN". A leading "[ KEY ]" is drawn as a key cap. `null`
   * fades it out (keeping the words, so they don't vanish mid-fade). Cheap to
   * call every frame.
   */
  setPrompt(text: string | null): void {
    if (text === this.promptText) return;
    this.promptText = text;
    if (text === null) {
      this.promptEl?.classList.remove('show');
      return;
    }
    if (!this.promptEl) {
      this.promptEl = document.createElement('div');
      this.promptEl.className = 'hud-prompt';
      // Beneath the death / win overlays, like the boss bar
      this.hud.insertBefore(this.promptEl, this.deathOverlay);
    }
    const el = this.promptEl;
    el.textContent = '';
    const m = /^\s*\[\s*([^\]]+?)\s*\]\s*(.*)$/.exec(text);
    if (m) {
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = m[1];
      el.append(key);
      if (m[2]) el.append(document.createTextNode(m[2]));
    } else {
      el.textContent = text;
    }
    el.classList.add('show');
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
