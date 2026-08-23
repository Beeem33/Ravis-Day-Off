import { EventBus, Events } from '../core/EventBus';
import type { AudioManager } from '../core/AudioManager';

type Panel = 'main' | 'audio' | 'controls' | 'quit';

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
        <button class="menu-item" data-act="quit">QUIT</button>
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
            <tr><td>MOVE</td><td>W / A / S / D</td></tr>
            <tr><td>LOOK</td><td>MOUSE</td></tr>
            <tr><td>FIRE</td><td>LEFT CLICK</td></tr>
            <tr><td>AIM</td><td>RIGHT CLICK (HOLD)</td></tr>
            <tr><td>SPRINT</td><td>SHIFT</td></tr>
            <tr><td>CROUCH</td><td>CTRL / C</td></tr>
            <tr><td>JUMP</td><td>SPACE</td></tr>
            <tr><td>MENU</td><td>ESC</td></tr>
          </table>
          <div class="divider"></div>
          <div>ONE SHOT KILLS THEM. YOU HAVE 5 HP<br/>AND HEAL 1 EVERY 30s.<br/>USE COVER. LISTEN. CLEAR EVERY ROOM.</div>
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
          this.bus.emit(Events.StartGame);
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
