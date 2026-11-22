import { EventBus, Events, LEVELS, LevelId } from '../core/EventBus';
import type { AudioManager } from '../core/AudioManager';
import { Colognes, COLOGNES } from '../entities/Colognes';
import { ACTIONS, Controls, FIXED, keyName } from '../core/Controls';

type Panel = 'main' | 'audio' | 'controls' | 'colognes' | 'admin' | 'credits' | 'quit';

/**
 * MenuUI — the diegetic security-terminal overlay for the main menu:
 * Start Shift / Audio Settings / Controls / Quit.
 */
export class MenuUI {
  private el: HTMLElement;

  constructor(
    uiRoot: HTMLElement,
    private bus: EventBus,
    private audio: AudioManager
  ) {
    this.el = document.createElement('div');
    this.el.className = 'menu-terminal';
    uiRoot.appendChild(this.el);
    this.renderPanel('main');
  }

  destroy(): void {
    this.el.remove();
  }

  private header(): string {
    return `
      <h1>RAVI'S DAY OFF</h1>
      <div class="sub">CALL-CENTER SECURITY TERMINAL v2.3 — NIGHT SHIFT<span class="blink">▌</span></div>
      <div class="divider"></div>
    `;
  }

  private renderPanel(panel: Panel): void {
    const beep = () => this.audio.uiBeep();
    if (panel === 'main') {
      this.el.innerHTML = `
        ${this.header()}
        <button class="menu-item" data-act="start">START SHIFT</button>
        <button class="menu-item" data-act="audio">AUDIO SETTINGS</button>
        <button class="menu-item" data-act="controls">CONTROLS</button>
        <button class="menu-item" data-act="colognes">COLOGNES — ${Colognes.found().size} / ${COLOGNES.length}</button>
        <button class="menu-item" data-act="admin">ADMIN — LEVEL SELECT</button>
        <button class="menu-item" data-act="credits">CREDITS</button>
        <button class="menu-item" data-act="quit">QUIT</button>
      `;
    } else if (panel === 'admin') {
      this.el.innerHTML = `
        ${this.header()}
        <div class="menu-panel">
          <div>SUPERVISOR ACCESS — SHIFT PLAYBACK</div>
          <div class="dim">Jump straight to any floor. Each one starts exactly as it would have if you had reached it: same weapons, same script.</div>
        </div>
        <div class="divider"></div>
        ${LEVELS.map(
          (l) => `<button class="menu-item level-pick" data-act="level" data-level="${l.id}">
            <span class="lvl-n">${l.n}</span> ${l.name}
            <span class="lvl-blurb">${l.blurb}</span>
          </button>`
        ).join('')}
        <div class="divider"></div>
        <button class="menu-item" data-act="back">BACK</button>
      `;
    } else if (panel === 'audio') {
      this.el.innerHTML = `
        ${this.header()}
        <div class="menu-panel">
          <table>
            <tr><td>MASTER</td><td><input type="range" id="vol-master" min="0" max="100" value="${Math.round(this.audio.masterVolume * 100)}"></td></tr>
            <tr><td>MUSIC</td><td><input type="range" id="vol-music" min="0" max="100" value="${Math.round(this.audio.musicVolume * 100)}"></td></tr>
            <tr><td>SFX</td><td><input type="range" id="vol-sfx" min="0" max="100" value="${Math.round(this.audio.sfxVolume * 100)}"></td></tr>
          </table>
        </div>
        <div class="divider"></div>
        <button class="menu-item" data-act="back">BACK</button>
      `;
      this.el.querySelector<HTMLInputElement>('#vol-master')!.addEventListener('input', (e) => {
        this.audio.setMasterVolume(Number((e.target as HTMLInputElement).value) / 100);
      });
      this.el.querySelector<HTMLInputElement>('#vol-music')!.addEventListener('input', (e) => {
        this.audio.setMusicVolume(Number((e.target as HTMLInputElement).value) / 100);
      });
      this.el.querySelector<HTMLInputElement>('#vol-sfx')!.addEventListener('input', (e) => {
        this.audio.setSfxVolume(Number((e.target as HTMLInputElement).value) / 100);
        beep();
      });
    } else if (panel === 'controls') {
      this.el.innerHTML = `
        ${this.header()}
        <div class="menu-panel">
          <table>
            <tr><td>LOOK</td><td>MOUSE</td></tr>
            ${FIXED.map(([l, k]) => `<tr><td>${l.toUpperCase()}</td><td>${k}</td></tr>`).join('')}
            ${ACTIONS.map((a) => `<tr><td>${a.label.toUpperCase()}</td><td>${keyName(Controls.key(a.id))}</td></tr>`).join('')}
            <tr><td>DRIVING</td><td>${keyName(Controls.key('forward'))} GAS · ${keyName(Controls.key('back'))} BRAKE / REVERSE · ${keyName(Controls.key('left'))} / ${keyName(Controls.key('right'))} STEER · ${keyName(Controls.key('jump'))} HANDBRAKE</td></tr>
          </table>
          <div class="dim">To change these, press ESC in a level: SETTINGS → CONTROLS.</div>
          <div class="divider"></div>
          <div>ONE SHOT KILLS THEM. YOU HAVE 5 HP<br/>AND HEAL 1 EVERY 30s.<br/>USE COVER. LISTEN. CLEAR EVERY ROOM.</div>
        </div>
        <div class="divider"></div>
        <button class="menu-item" data-act="back">BACK</button>
      `;
    } else if (panel === 'colognes') {
      const found = Colognes.found();
      this.el.innerHTML = `
        ${this.header()}
        <div class="menu-panel">
          <div class="dim">ULTRA-NICHE COLOGNES: ${found.size} / ${COLOGNES.length} FOUND. One is hidden somewhere in each level. Walk right up to one to take it.</div>
          <div class="cologne-grid">
            ${COLOGNES.map((c) =>
              found.has(c.id)
                ? `<div class="cg-cell got"><img src="${Colognes.label(c.id).toDataURL()}" alt=""><div>${c.name}</div><span>${c.level}</span></div>`
                : `<div class="cg-cell"><div class="cg-q">?</div><div>???</div><span>${c.level}</span></div>`
            ).join('')}
          </div>
        </div>
        <div class="divider"></div>
        <button class="menu-item" data-act="back">BACK</button>
      `;
    } else if (panel === 'credits') {
      this.el.innerHTML = `
        ${this.header()}
        <div class="menu-panel">
          <table>
            <tr><td>MADE BY</td><td>BENDABLE PIPE STUDIO</td></tr>
            <tr><td>MUSIC</td><td>FUZZEKE</td></tr>
            <tr><td></td><td>ALEXANDER ZHELANOV</td></tr>
          </table>
        </div>
        <div class="divider"></div>
        <button class="menu-item" data-act="back">BACK</button>
      `;
    } else {
      this.el.innerHTML = `
        ${this.header()}
        <div class="menu-panel">
          NICE TRY. RAVI STILL HAS A BUILDING FULL<br/>OF INTRUDERS AND A SHIFT TO FINISH.<br/><br/>
          (Close the browser tab to actually quit.)
        </div>
        <div class="divider"></div>
        <button class="menu-item" data-act="back">BACK</button>
      `;
    }

    this.el.querySelectorAll<HTMLButtonElement>('.menu-item').forEach((btn) => {
      btn.addEventListener('mouseenter', () => this.audio.uiBeep());
      btn.addEventListener('click', () => {
        this.audio.unlock();
        const act = btn.dataset.act as string;
        if (act === 'start') {
          this.audio.uiBeep(true);
          Colognes.replay = false;
          this.bus.emit(Events.StartGame);
        } else if (act === 'level') {
          this.audio.uiBeep(true);
          // Playing a floor back from the admin list: its cologne is there to take (and spray) again
          Colognes.replay = true;
          this.bus.emit(Events.SelectLevel, { level: btn.dataset.level as LevelId });
        } else if (act === 'back') {
          this.audio.uiBeep();
          this.renderPanel('main');
        } else {
          this.audio.uiBeep(true);
          this.renderPanel(act as Panel);
        }
      });
    });
  }
}
