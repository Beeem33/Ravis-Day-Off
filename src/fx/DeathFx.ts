import type { GameEngine } from '../core/GameEngine';
import type { AudioManager } from '../core/AudioManager';

/** The song for Ravi's death: "The Sound of Silence", 18–45 s of it, made to loop seamlessly. */
export const DEATH_SONG = 'audio/death.wav';
/** For this long after he goes down, clicks and keys don't restart: he was likely still firing (ms). */
const HOLD_MS = 2500;
/** When the restart prompt fades in over the bottom of the shot (ms after he goes down). */
const PROMPT_AT = 4500;
/** The world slowed this far, for this long (real seconds), then eased back to speed over EASE. */
const SLOW = 0.35;
const SLOW_FOR = 4;
const SLOW_EASE = 1.2;

/**
 * DeathFx — Ravi's death, the same in every level: the HUD and every other
 * bit of the level's UI gone, the picture drained to grey, the world slowed
 * right down, the death camera drifting round him (on foot), every sound but
 * the music cut and the song coming up, and the restart prompt fading in
 * low over the shot after a few seconds. The flashlight, wherever there is
 * one, goes out (the scene's onRaviDeath).
 *
 * One of these for the game; main starts it on Events.PlayerDied (the street
 * calls it itself when it kills him), and it's put right on any scene change.
 */
export class DeathFx {
  private on = false;
  private at = 0;
  private timers: number[] = [];
  private slowTimer: number | null = null;

  constructor(
    private readonly engine: GameEngine,
    private readonly audio: AudioManager,
    private readonly uiRoot: HTMLElement
  ) {
    // The first moments of it can't be clicked or keyed away (Esc to the menu still goes)
    const guard = (e: Event): void => {
      if (!this.on || performance.now() - this.at > HOLD_MS) return;
      if (e instanceof KeyboardEvent && e.code === 'Escape') return;
      e.stopImmediatePropagation();
    };
    for (const t of ['click', 'mousedown', 'keydown']) window.addEventListener(t, guard, true);
  }

  get active(): boolean {
    return this.on;
  }

  /**
   * He's dead. `prompt`: the level's restart prompt, kept (and faded in later) when the rest of the UI goes.
   * `slow`/`slowFor`: how slow the world goes and for how long (real seconds), if not the usual.
   */
  start(prompt: HTMLElement | null, o: { slow?: number; slowFor?: number } = {}): void {
    if (this.on) return;
    this.on = true;
    this.at = performance.now();
    // Grey
    const canvas = this.engine.renderer.domElement;
    canvas.style.transition = 'filter 1.8s ease-out';
    canvas.style.filter = 'grayscale(1) contrast(1.12) brightness(0.84)';
    // Everything off the screen but the prompt, which comes in later, low down
    this.hideAllBut(prompt);
    if (prompt) {
      prompt.style.transition = 'opacity 2.5s';
      prompt.style.opacity = '0';
      prompt.style.background = 'linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(0,0,0,0.78) 100%)';
      prompt.style.justifyContent = 'flex-end';
      prompt.style.paddingBottom = '10vh';
      this.timers.push(window.setTimeout(() => (prompt.style.opacity = '1'), PROMPT_AT));
    }
    // Silence but the song
    this.audio.stopBossMusic(0.8);
    this.audio.hushSfx(true, 0.5);
    this.audio.startTrackMusic(DEATH_SONG, 0, 0, 1, 0.8);
    // Slow, then back up to speed
    const slow = o.slow ?? SLOW;
    const slowFor = o.slowFor ?? SLOW_FOR;
    this.engine.timeScale = slow;
    const t0 = performance.now();
    this.slowTimer = window.setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      if (t < slowFor) return;
      const k = Math.min(1, (t - slowFor) / SLOW_EASE);
      this.engine.timeScale = slow + (1 - slow) * k * k * (3 - 2 * k);
      if (k >= 1 && this.slowTimer !== null) {
        clearInterval(this.slowTimer);
        this.slowTimer = null;
      }
    }, 50);
    // The level's own part: the death camera drifting round him, the flashlight out
    const sc = this.engine.currentScene as unknown as { raviRagdoll?: { orbit: number } | null; onRaviDeath?: () => void } | null;
    if (sc?.raviRagdoll) sc.raviRagdoll.orbit = 0.16;
    sc?.onRaviDeath?.();
  }

  /** Back to normal: a new scene (a restart, the menu). */
  end(): void {
    if (!this.on) return;
    this.on = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.slowTimer !== null) clearInterval(this.slowTimer);
    this.slowTimer = null;
    this.engine.timeScale = 1;
    const canvas = this.engine.renderer.domElement;
    canvas.style.transition = '';
    canvas.style.filter = '';
    for (const el of Array.from(this.uiRoot.querySelectorAll<HTMLElement>('[data-death-hidden]'))) {
      el.style.visibility = el.dataset.deathHidden ?? '';
      delete el.dataset.deathHidden;
    }
    this.audio.stopTrackMusic(0.4);
    this.audio.hushSfx(false, 0.3);
  }

  /** Hide everything in the UI but `keep` (and what it's inside). */
  private hideAllBut(keep: HTMLElement | null): void {
    const walk = (el: Element): void => {
      for (const c of Array.from(el.children) as HTMLElement[]) {
        if (keep && c.contains(keep)) {
          if (c !== keep) walk(c);
          continue;
        }
        if (c.dataset.deathHidden !== undefined) continue;
        c.dataset.deathHidden = c.style.visibility;
        c.style.visibility = 'hidden';
      }
    };
    walk(this.uiRoot);
  }
}
