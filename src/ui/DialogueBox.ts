import type { AudioManager } from '../core/AudioManager';

export interface DialogueLine {
  speaker: string;
  text: string;
  /** Voice pitch for this speaker's blips, roughly 0.6 (low) .. 1.6 (high). */
  pitch?: number;
}

const CHARS_PER_SEC = 34;

/**
 * DialogueBox — a bordered panel that types its line out a character at a
 * time with a blip per letter, and waits for a keypress between lines.
 *
 * Only used where the floor is safe: reading and fighting can't happen at
 * once, so a line that appears mid-firefight is a line nobody reads.
 */
export class DialogueBox {
  private root: HTMLElement;
  private nameEl: HTMLElement;
  private textEl: HTMLElement;
  private promptEl: HTMLElement;
  private lines: DialogueLine[] = [];
  private index = 0;
  private shown = 0; // characters revealed so far
  private blipAccum = 0;
  private done: (() => void) | null = null;
  private active = false;

  constructor(
    parent: HTMLElement,
    private audio: AudioManager
  ) {
    const el = document.createElement('div');
    el.className = 'dialogue-box';
    el.innerHTML = `
      <div class="dlg-name"></div>
      <div class="dlg-text"></div>
      <div class="dlg-prompt">▾</div>
    `;
    parent.appendChild(el);
    this.root = el;
    this.nameEl = el.querySelector('.dlg-name')!;
    this.textEl = el.querySelector('.dlg-text')!;
    this.promptEl = el.querySelector('.dlg-prompt')!;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Whether the current line has finished typing. */
  private get lineComplete(): boolean {
    const line = this.lines[this.index];
    return !line || this.shown >= line.text.length;
  }

  play(lines: DialogueLine[], onDone: () => void): void {
    this.lines = lines;
    this.index = 0;
    this.shown = 0;
    this.done = onDone;
    this.active = true;
    this.root.classList.add('show');
    this.render();
  }

  /**
   * Advance: first press finishes the line instantly, second moves on. That
   * is the one interaction people expect from a box like this.
   */
  advance(): void {
    if (!this.active) return;
    if (!this.lineComplete) {
      this.shown = this.lines[this.index].text.length;
      this.render();
      return;
    }
    this.index++;
    this.shown = 0;
    if (this.index >= this.lines.length) {
      this.close();
      return;
    }
    this.render();
  }

  close(): void {
    if (!this.active) return;
    this.active = false;
    this.root.classList.remove('show');
    const cb = this.done;
    this.done = null;
    cb?.();
  }

  update(dt: number): void {
    if (!this.active || this.lineComplete) {
      this.promptEl.style.opacity = this.active && this.lineComplete ? '1' : '0';
      return;
    }
    const line = this.lines[this.index];
    this.blipAccum += dt * CHARS_PER_SEC;
    let stepped = false;
    while (this.blipAccum >= 1 && this.shown < line.text.length) {
      this.blipAccum -= 1;
      const ch = line.text[this.shown];
      this.shown++;
      stepped = true;
      // No blip for whitespace — it makes the rhythm read as speech
      if (ch.trim().length > 0) this.audio.dialogueBlip(line.pitch ?? 1);
    }
    if (stepped) this.render();
  }

  private render(): void {
    const line = this.lines[this.index];
    if (!line) return;
    this.nameEl.textContent = line.speaker;
    this.textEl.textContent = line.text.slice(0, this.shown);
    this.promptEl.style.opacity = this.lineComplete ? '1' : '0';
  }

  destroy(): void {
    this.root.remove();
  }
}
