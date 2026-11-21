import type { InputManager } from '../core/InputManager';
import { Controls, keyName } from '../core/Controls';

/**
 * TouchControls — the on-screen controls for phones and tablets (only built
 * when TOUCH is true; a PC never sees any of this).
 *
 * Nothing in the game knows it's there. Every button is turned into the key
 * or mouse button a PC player would press, dispatched as a real DOM event, so
 * the levels, the dialogue, the death screens and the rebinding all work
 * through the same paths as on a keyboard:
 *
 *  - left of the screen: a floating stick → W A S D (pushed to the rim: sprint)
 *  - drag anywhere else: look (the mouse delta)
 *  - FIRE / AIM → left / right mouse button (FIRE can be dragged to look too)
 *  - JUMP, CROUCH, RELOAD, USE, KNIFE, KICK, HEAL, FLIP, TABLET → their keys
 *  - SWAP → a notch of the wheel; ⏸ → letting go of the mouse (the pause menu)
 *
 * "Pointer lock" on a phone is emulated by InputManager: when the game has it,
 * the full set of buttons is up and drags look around; when the game has let
 * go (a cutscene, a death screen, a computer on a desk), taps go through as
 * ordinary clicks and a vertical swipe scrolls like the wheel.
 */

interface Btn {
  id: string;
  label: string;
  /** What it presses: a key action id from Controls, a raw key code, or a mouse button. */
  key?: string;
  code?: string;
  mouse?: 0 | 2;
  /** Tap to turn on, tap again to turn off (instead of held). */
  toggle?: boolean;
  /** Shown only while the game has the "mouse". */
  playOnly?: boolean;
  cls: string;
}

const BUTTONS: Btn[] = [
  { id: 'fire', label: 'FIRE', mouse: 0, playOnly: true, cls: 'tc-fire' },
  { id: 'aim', label: 'AIM', mouse: 2, toggle: true, playOnly: true, cls: 'tc-aim' },
  { id: 'jump', label: 'JUMP', key: 'jump', playOnly: true, cls: 'tc-jump' },
  { id: 'crouch', label: 'CROUCH', key: 'crouch', toggle: true, playOnly: true, cls: 'tc-crouch' },
  { id: 'reload', label: 'RELOAD', key: 'reload', playOnly: true, cls: 'tc-reload' },
  { id: 'use', label: 'USE', key: 'interact', playOnly: true, cls: 'tc-use' },
  { id: 'knife', label: 'KNIFE', key: 'takedown', playOnly: true, cls: 'tc-knife' },
  { id: 'kick', label: 'KICK', key: 'kick', playOnly: true, cls: 'tc-kick' },
  { id: 'swap', label: 'SWAP', playOnly: true, cls: 'tc-swap tc-small' },
  { id: 'heal', label: 'HEAL', key: 'drink', playOnly: true, cls: 'tc-heal tc-small' },
  { id: 'tablet', label: 'MAP', key: 'tablet', playOnly: true, cls: 'tc-tablet tc-small' },
  { id: 'flip', label: 'FLIP', key: 'flip', playOnly: true, cls: 'tc-flip tc-small' },
  { id: 'skip', label: 'NEXT ▸', code: 'Enter', cls: 'tc-skip tc-small' },
  { id: 'pause', label: '❚❚', cls: 'tc-pause tc-small' }
];

/** Look speed for a finger: screen px → the mouse counts FPSPlayer expects. */
const LOOK_GAIN = 1.5;
/** Stick travel (px) at full deflection. */
const STICK_R = 52;

const CSS = `
  body.touch { touch-action: manipulation; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
  body.touch * { -webkit-tap-highlight-color: transparent; }
  .tc-look { position: fixed; inset: 0; z-index: 5; touch-action: none; display: none; }
  .tc-look.on { display: block; }
  .tc-layer { position: fixed; inset: 0; z-index: 8500; pointer-events: none; display: none;
    font-family: 'Consolas', 'Courier New', monospace; }
  .tc-layer.on { display: block; }
  .tc-btn { position: absolute; pointer-events: auto; touch-action: none; display: flex; align-items: center; justify-content: center;
    width: 58px; height: 58px; border-radius: 50%; color: rgba(255,255,255,0.9); font-size: 11px; font-weight: bold; letter-spacing: 1px;
    background: rgba(20,24,22,0.38); border: 2px solid rgba(255,255,255,0.32); text-shadow: 0 1px 2px #000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.35); user-select: none; -webkit-user-select: none; }
  .tc-btn { flex-direction: column; line-height: 1.1; }
  .tc-btn i { font-style: normal; font-size: 9px; opacity: 0.6; letter-spacing: 0; }
  .tc-small i { display: none; }
  .tc-btn.down { background: rgba(255,255,255,0.32); border-color: rgba(255,255,255,0.8); }
  .tc-btn.lit { background: rgba(82,224,122,0.35); border-color: #8dffb8; }
  .tc-layer:not(.play) .tc-play { display: none; }
  .tc-small { width: auto; height: 34px; padding: 0 12px; border-radius: 17px; font-size: 11px; }
  .tc-fire { width: 84px; height: 84px; font-size: 14px; right: calc(26px + env(safe-area-inset-right)); bottom: 34px;
    background: rgba(160,30,30,0.42); border-color: rgba(255,140,140,0.55); }
  .tc-fire.down { background: rgba(255,60,60,0.55); }
  .tc-aim { right: calc(40px + env(safe-area-inset-right)); bottom: 132px; }
  .tc-jump { right: calc(124px + env(safe-area-inset-right)); bottom: 22px; }
  .tc-crouch { right: calc(196px + env(safe-area-inset-right)); bottom: 16px; width: 54px; height: 54px; font-size: 9px; }
  .tc-reload { right: calc(122px + env(safe-area-inset-right)); bottom: 96px; width: 54px; height: 54px; font-size: 9px; }
  .tc-use { right: calc(110px + env(safe-area-inset-right)); bottom: 166px; }
  .tc-knife { right: calc(40px + env(safe-area-inset-right)); bottom: 206px; width: 52px; height: 52px; font-size: 10px; }
  .tc-kick { right: calc(182px + env(safe-area-inset-right)); bottom: 136px; width: 52px; height: 52px; font-size: 10px; }
  .tc-pause { top: 10px; right: calc(12px + env(safe-area-inset-right)); width: 44px; padding: 0; }
  .tc-skip { top: 10px; right: calc(66px + env(safe-area-inset-right)); }
  .tc-layer.play .tc-skip { display: none; }
  .tc-swap { top: 10px; right: calc(66px + env(safe-area-inset-right)); }
  .tc-heal { top: 10px; right: calc(127px + env(safe-area-inset-right)); }
  .tc-tablet { top: 10px; right: calc(186px + env(safe-area-inset-right)); }
  .tc-flip { top: 10px; right: calc(242px + env(safe-area-inset-right)); }
  .tc-stick { position: absolute; width: 124px; height: 124px; margin: -62px 0 0 -62px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.28); background: rgba(20,24,22,0.22); pointer-events: none; opacity: 0.55;
    transition: opacity 0.15s; }
  .tc-stick.held { opacity: 1; transition: none; }
  .tc-layer:not(.play) .tc-stick:not(.held) { opacity: 0; }
  .tc-stick.sprint { border-color: rgba(255,210,90,0.8); }
  .tc-knob { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%;
    background: rgba(255,255,255,0.35); border: 2px solid rgba(255,255,255,0.6); }
  .tc-rotate { position: fixed; inset: 0; z-index: 10001; display: none; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.92); color: #52e07a; font: bold 16px 'Consolas', 'Courier New', monospace; letter-spacing: 2px; text-align: center; gap: 14px; }
  .tc-rotate .tc-phone { font-size: 54px; animation: tc-turn 1.6s ease-in-out infinite; }
  .tc-rotate small { color: #2e8f47; font-size: 11px; letter-spacing: 1px; }
  @keyframes tc-turn { 0%, 30% { transform: rotate(0deg); } 60%, 100% { transform: rotate(-90deg); } }
  @media (orientation: portrait) { body.touch:not(.tc-portrait-ok) .tc-rotate { display: flex; } }

  /* Make room for the thumbs: the HUD's corners move out from under the buttons */
  body.touch .hud-health { bottom: 10px; left: calc(16px + env(safe-area-inset-left)); }
  body.touch .hud-health .hp-track { width: 130px; }
  body.touch .hud-bottom { display: none; }
  body.touch .hud-ammo { right: auto; left: 50%; transform: translateX(-50%); bottom: 8px; text-align: center; }
  body.touch .hud-ammo .rounds { font-size: 24px; }
  body.touch .hud-grenades { right: auto; left: 50%; transform: translateX(-50%); bottom: 58px; }
  body.touch .killfeed { top: 54px; }
`;

export class TouchControls {
  private readonly look: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly els = new Map<string, HTMLElement>();
  /** Keys / mouse buttons this layer is holding down right now. */
  private readonly held = new Set<string>();
  private readonly toggled = new Set<string>();

  private stickId: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  /** A swipe while the game has let go: it scrolls (a computer screen's wheel). */
  private swipeId: number | null = null;
  private swipeY = 0;
  /** Fingers on a button, and which button. */
  private readonly btnTouch = new Map<number, { id: string; x: number; y: number }>();

  private wasActive = false;
  private wasPlay = false;

  constructor(
    private readonly input: InputManager,
    /** In a level, not paused, not loading: the controls are wanted. */
    private readonly active: () => boolean,
    /** A cutscene has the camera: only NEXT and pause are any use. */
    private readonly cinematic: () => boolean = () => false
  ) {
    document.body.classList.add('touch');
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Under the UI root (z 10), over the canvas: the HUD's own clickable bits still win
    this.look = document.createElement('div');
    this.look.className = 'tc-look';
    document.body.appendChild(this.look);

    this.layer = document.createElement('div');
    this.layer.className = 'tc-layer';
    this.stick = document.createElement('div');
    this.stick.className = 'tc-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'tc-knob';
    this.stick.appendChild(this.knob);
    this.layer.appendChild(this.stick);
    for (const b of BUTTONS) {
      const el = document.createElement('div');
      el.className = `tc-btn ${b.cls}${b.playOnly ? ' tc-play' : ''}`;
      // The key it stands for, small underneath: the game's prompts say "[ E ] TAKE IT"
      el.innerHTML = b.key ? `${b.label}<i>${keyName(Controls.key(b.key))}</i>` : b.label;
      el.dataset.id = b.id;
      this.layer.appendChild(el);
      this.els.set(b.id, el);
    }
    document.body.appendChild(this.layer);
    this.restStick();

    const rotate = document.createElement('div');
    rotate.className = 'tc-rotate';
    rotate.innerHTML = '<div class="tc-phone">📱</div>TURN YOUR PHONE SIDEWAYS<small>tap to play upright anyway</small>';
    rotate.addEventListener('click', () => document.body.classList.add('tc-portrait-ok'));
    document.body.appendChild(rotate);

    const opt = { passive: false } as const;
    this.look.addEventListener('touchstart', (e) => this.lookStart(e), opt);
    this.look.addEventListener('touchmove', (e) => this.lookMove(e), opt);
    this.look.addEventListener('touchend', (e) => this.lookEnd(e), opt);
    this.look.addEventListener('touchcancel', (e) => this.lookEnd(e), opt);
    this.layer.addEventListener('touchstart', (e) => this.btnStart(e), opt);
    this.layer.addEventListener('touchmove', (e) => this.btnMove(e), opt);
    this.layer.addEventListener('touchend', (e) => this.btnEnd(e), opt);
    this.layer.addEventListener('touchcancel', (e) => this.btnEnd(e), opt);

    // Full screen and sideways on the first touch, where the browser allows it (not iPhone Safari)
    const goFull = (): void => {
      document.removeEventListener('touchend', goFull);
      const de = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      try {
        const p = de.requestFullscreen?.({ navigationUI: 'hide' }) ?? de.webkitRequestFullscreen?.();
        Promise.resolve(p)
          .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
          .catch(() => {});
      } catch {
        /* not offered here */
      }
    };
    document.addEventListener('touchend', goFull);

    const tick = (): void => {
      this.sync();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------- state

  /** Show what's wanted for the moment: nothing, the stick and pause, or everything. */
  private sync(): void {
    const active = this.active();
    const play = active && this.input.pointerLocked && !this.cinematic();
    if (active !== this.wasActive) {
      this.layer.classList.toggle('on', active);
      this.look.classList.toggle('on', active);
      if (!active) this.releaseAll();
    }
    if (play !== this.wasPlay) {
      this.layer.classList.toggle('play', play);
      // The game let go (or took over): nothing stays held across the change
      if (!play) this.releaseButtons();
    }
    this.wasActive = active;
    this.wasPlay = play;
  }

  private releaseButtons(): void {
    for (const id of [...this.held]) if (!/^Key[WASD]$|^Shift/.test(id)) this.up(id);
    this.toggled.clear();
    this.btnTouch.clear();
    this.lookId = null;
    for (const el of this.els.values()) el.classList.remove('down', 'lit');
  }

  private releaseAll(): void {
    this.releaseButtons();
    for (const id of [...this.held]) this.up(id);
    this.stickId = null;
    this.swipeId = null;
    this.restStick();
  }

  // ------------------------------------------------------- key / mouse

  /** Press `id`: 'mouse0' / 'mouse2', or a key code. */
  private down(id: string): void {
    if (this.held.has(id)) return;
    this.held.add(id);
    if (id.startsWith('mouse')) this.mouse('mousedown', Number(id.slice(5)));
    else this.key('keydown', id);
  }

  private up(id: string): void {
    if (!this.held.delete(id)) return;
    if (id.startsWith('mouse')) this.mouse('mouseup', Number(id.slice(5)));
    else this.key('keyup', id);
  }

  private key(type: 'keydown' | 'keyup', code: string): void {
    const key = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : /^Digit\d$/.test(code) ? code.slice(5) : code === 'Space' ? ' ' : code;
    document.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }));
  }

  private mouse(type: 'mousedown' | 'mouseup', button: number): void {
    document.dispatchEvent(
      new MouseEvent(type, { button, buttons: type === 'mousedown' ? (button === 2 ? 2 : 1) : 0, bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2 })
    );
  }

  /** What a button presses, as one id for down()/up(). */
  private target(b: Btn): string | null {
    if (b.mouse !== undefined) return `mouse${b.mouse}`;
    if (b.key) return Controls.key(b.key);
    return b.code ?? null;
  }

  // ------------------------------------------------------------ buttons

  private btnStart(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      const el = (t.target as HTMLElement | null)?.closest?.('.tc-btn') as HTMLElement | null;
      const b = el && BUTTONS.find((x) => x.id === el.dataset.id);
      if (!b || !el) continue;
      e.preventDefault();
      this.btnTouch.set(t.identifier, { id: b.id, x: t.clientX, y: t.clientY });
      if (b.id === 'pause') {
        if (this.input.pointerLocked) this.input.releaseByUser();
        else {
          this.key('keydown', 'Escape');
          this.key('keyup', 'Escape');
        }
        continue;
      }
      if (b.id === 'swap') {
        this.input.addWheel(1);
        el.classList.add('down');
        continue;
      }
      const id = this.target(b);
      if (!id) continue;
      if (b.toggle) {
        if (this.toggled.has(b.id)) {
          this.toggled.delete(b.id);
          this.up(id);
          el.classList.remove('lit');
        } else {
          this.toggled.add(b.id);
          this.down(id);
          el.classList.add('lit');
        }
      } else {
        this.down(id);
        el.classList.add('down');
      }
    }
  }

  private btnMove(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      const bt = this.btnTouch.get(t.identifier);
      if (!bt) continue;
      e.preventDefault();
      // FIRE (and AIM) can be dragged to steer the shot, like any shooter on a phone
      if (bt.id === 'fire' || bt.id === 'aim') this.input.addLook((t.clientX - bt.x) * LOOK_GAIN, (t.clientY - bt.y) * LOOK_GAIN);
      bt.x = t.clientX;
      bt.y = t.clientY;
    }
  }

  private btnEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      const bt = this.btnTouch.get(t.identifier);
      if (!bt) continue;
      e.preventDefault();
      this.btnTouch.delete(t.identifier);
      const b = BUTTONS.find((x) => x.id === bt.id)!;
      const el = this.els.get(b.id)!;
      if (b.toggle) continue;
      el.classList.remove('down');
      const id = this.target(b);
      if (id) this.up(id);
    }
  }

  // ------------------------------------------------- stick, look, swipe

  private lookStart(e: TouchEvent): void {
    const play = this.wasPlay;
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < innerWidth * 0.42 && this.stickId === null) {
        this.stickId = t.identifier;
        this.stickX = t.clientX;
        this.stickY = t.clientY;
        this.stick.style.left = `${t.clientX}px`;
        this.stick.style.top = `${t.clientY}px`;
        this.stick.classList.add('held');
        this.knob.style.transform = '';
        if (play) e.preventDefault();
      } else if (play && this.lookId === null) {
        this.lookId = t.identifier;
        this.lookX = t.clientX;
        this.lookY = t.clientY;
        e.preventDefault();
      } else if (!play && this.swipeId === null) {
        // Left alone this becomes a click (a death screen's "tap to retry", a desk computer);
        // dragged, it scrolls
        this.swipeId = t.identifier;
        this.swipeY = t.clientY;
      }
    }
  }

  private lookMove(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        e.preventDefault();
        this.moveStick(t.clientX - this.stickX, t.clientY - this.stickY);
      } else if (t.identifier === this.lookId) {
        e.preventDefault();
        this.input.addLook((t.clientX - this.lookX) * LOOK_GAIN, (t.clientY - this.lookY) * LOOK_GAIN);
        this.lookX = t.clientX;
        this.lookY = t.clientY;
      } else if (t.identifier === this.swipeId) {
        const dy = this.swipeY - t.clientY;
        if (Math.abs(dy) < 2) continue;
        this.swipeY = t.clientY;
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: dy * 2.5, deltaMode: 0, bubbles: true, cancelable: true }));
      }
    }
  }

  private lookEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.moveStick(0, 0);
        this.restStick();
        if (this.wasPlay) e.preventDefault();
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
        e.preventDefault();
      } else if (t.identifier === this.swipeId) {
        this.swipeId = null;
      }
    }
  }

  /** The stick's resting place, where the left thumb naturally sits. */
  private restStick(): void {
    this.stick.classList.remove('held', 'sprint');
    this.knob.style.transform = '';
    this.stick.style.left = 'calc(108px + env(safe-area-inset-left))';
    this.stick.style.top = `${innerHeight - 118}px`;
  }

  /** The stick pushed (dx, dy) px from where the thumb went down → W A S D, and sprint at the rim. */
  private moveStick(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    const k = len > STICK_R ? STICK_R / len : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const nx = len ? (dx / len) * Math.min(1, len / STICK_R) : 0;
    const ny = len ? (dy / len) * Math.min(1, len / STICK_R) : 0;
    const live = len > STICK_R * 0.22;
    const set = (action: string, on: boolean): void => {
      const code = Controls.key(action);
      if (on) this.down(code);
      else this.up(code);
    };
    set('forward', live && ny < -0.38);
    set('back', live && ny > 0.38);
    set('left', live && nx < -0.38);
    set('right', live && nx > 0.38);
    // Shoved right to the edge, forwards: running
    const sprint = live && len > STICK_R * 1.05 && ny < -0.6;
    set('sprint', sprint);
    this.stick.classList.toggle('sprint', sprint);
  }
}
