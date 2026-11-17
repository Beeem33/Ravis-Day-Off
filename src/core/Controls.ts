/**
 * Controls — which key does what, and letting the player change it.
 *
 * The game itself is written against the default keys (`input.wasPressed('KeyE')`
 * and so on, all through every level). Rather than touch all of that, the
 * InputManager runs every key through `translate()`: a key the player has
 * bound to an action comes out as that action's default key, and a default
 * key whose action has been moved elsewhere comes out as nothing. So a level
 * asking for 'KeyE' gets whatever key the player chose for Interact.
 *
 * Bindings are kept in this browser (localStorage), and Esc → Settings →
 * Controls is where they're changed.
 */

export interface Action {
  id: string;
  label: string;
  /** The key the game is written against. */
  code: string;
  group: 'MOVEMENT' | 'COMBAT' | 'OTHER';
}

export const ACTIONS: Action[] = [
  { id: 'forward', label: 'Move forward', code: 'KeyW', group: 'MOVEMENT' },
  { id: 'back', label: 'Move back', code: 'KeyS', group: 'MOVEMENT' },
  { id: 'left', label: 'Strafe left', code: 'KeyA', group: 'MOVEMENT' },
  { id: 'right', label: 'Strafe right', code: 'KeyD', group: 'MOVEMENT' },
  { id: 'sprint', label: 'Sprint', code: 'ShiftLeft', group: 'MOVEMENT' },
  { id: 'crouch', label: 'Crouch', code: 'KeyC', group: 'MOVEMENT' },
  { id: 'jump', label: 'Jump', code: 'Space', group: 'MOVEMENT' },
  { id: 'reload', label: 'Reload', code: 'KeyR', group: 'COMBAT' },
  { id: 'w1', label: 'Pistol', code: 'Digit1', group: 'COMBAT' },
  { id: 'w2', label: 'Shotgun', code: 'Digit2', group: 'COMBAT' },
  { id: 'w3', label: 'Rifle', code: 'Digit3', group: 'COMBAT' },
  { id: 'w4', label: 'Weapon 4', code: 'Digit4', group: 'COMBAT' },
  { id: 'w5', label: 'Weapon 5', code: 'Digit5', group: 'COMBAT' },
  { id: 'takedown', label: 'Knife takedown', code: 'KeyF', group: 'COMBAT' },
  { id: 'kick', label: 'Drop kick', code: 'KeyQ', group: 'COMBAT' },
  { id: 'interact', label: 'Interact / pick up', code: 'KeyE', group: 'OTHER' },
  { id: 'drink', label: 'Deadbull (heal)', code: 'KeyG', group: 'OTHER' },
  { id: 'flip', label: 'Flip them off', code: 'KeyT', group: 'OTHER' },
  { id: 'tablet', label: 'Tablet', code: 'KeyM', group: 'OTHER' }
];

/** Shown alongside, but not changeable. */
export const FIXED: [string, string][] = [
  ['Fire', 'LEFT CLICK'],
  ['Aim down sights', 'RIGHT CLICK'],
  ['Pause / menu', 'ESC']
];

/** Keys that can't be given to an action. */
const RESERVED = new Set(['Escape', 'MetaLeft', 'MetaRight', 'F5', 'F11', 'F12', 'ContextMenu']);

const KEY = 'ravi.controls';

class ControlMap {
  /** action id → the key the player has it on. */
  private bound = new Map<string, string>();
  /** physical key → the default key it stands in for ('' = does nothing now). */
  private table = new Map<string, string>();
  private listeners: (() => void)[] = [];

  constructor() {
    for (const a of ACTIONS) this.bound.set(a.id, a.code);
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
      for (const a of ACTIONS) if (typeof saved[a.id] === 'string') this.bound.set(a.id, saved[a.id]);
    } catch {
      /* private window: the defaults */
    }
    this.rebuild();
  }

  /** The key `action` is on. */
  key(id: string): string {
    return this.bound.get(id) ?? ACTIONS.find((a) => a.id === id)?.code ?? '';
  }

  /** What a pressed key means to the game: the default key of the action it's bound to. */
  translate(code: string): string {
    return this.table.has(code) ? this.table.get(code)! : code;
  }

  /** Can `code` be bound at all? */
  allowed(code: string): boolean {
    return !!code && !RESERVED.has(code);
  }

  /**
   * Put `id` on `code`. If another action was on that key, it swaps onto the
   * key this one is leaving — nothing is ever left without a key.
   */
  bind(id: string, code: string): void {
    if (!this.allowed(code)) return;
    const old = this.key(id);
    for (const a of ACTIONS) if (a.id !== id && this.key(a.id) === code) this.bound.set(a.id, old);
    this.bound.set(id, code);
    this.changed();
  }

  reset(): void {
    for (const a of ACTIONS) this.bound.set(a.id, a.code);
    this.changed();
  }

  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  /** "[ E ] TAKE IT" style prompts: the letter in the brackets, as the player has it bound. */
  label(defaultLabel: string): string {
    const code = /^[A-Z]$/.test(defaultLabel) ? `Key${defaultLabel}` : /^\d$/.test(defaultLabel) ? `Digit${defaultLabel}` : '';
    const a = code && ACTIONS.find((x) => x.code === code);
    return a ? keyName(this.key(a.id)) : defaultLabel;
  }

  private changed(): void {
    this.rebuild();
    try {
      const out: Record<string, string> = {};
      for (const a of ACTIONS) out[a.id] = this.key(a.id);
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch {
      /* not kept beyond this visit */
    }
    for (const l of this.listeners) l();
  }

  private rebuild(): void {
    this.table.clear();
    // A default key that's been moved away from does nothing now...
    for (const a of ACTIONS) if (this.key(a.id) !== a.code) this.table.set(a.code, '');
    // ...and a bound key means its action's default
    for (const a of ACTIONS) this.table.set(this.key(a.id), a.code);
  }
}

export const Controls = new ControlMap();

/** A key code as a player would name it: 'KeyW' → 'W', 'ShiftLeft' → 'L-SHIFT'. */
export function keyName(code: string): string {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `NUM ${m[1]}`;
  if (/^F\d+$/.test(code)) return code;
  const names: Record<string, string> = {
    Space: 'SPACE',
    ShiftLeft: 'L-SHIFT',
    ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL',
    ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT',
    AltRight: 'R-ALT',
    Tab: 'TAB',
    CapsLock: 'CAPS',
    Enter: 'ENTER',
    Backspace: 'BKSP',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Insert: 'INS',
    Delete: 'DEL',
    Home: 'HOME',
    End: 'END',
    PageUp: 'PG UP',
    PageDown: 'PG DN'
  };
  return names[code] ?? code.toUpperCase();
}
