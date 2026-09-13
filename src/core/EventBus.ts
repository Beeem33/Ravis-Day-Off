/**
 * EventBus — tiny typed pub/sub hub decoupling gameplay systems.
 * Systems publish gameplay facts (gunshots, kills, UI intents) and
 * interested parties subscribe without holding hard references.
 */
export type EventHandler<T = any> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  on<T = any>(event: string, handler: EventHandler<T>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as EventHandler);
    return () => this.off(event, handler);
  }

  once<T = any>(event: string, handler: EventHandler<T>): () => void {
    const wrapped: EventHandler<T> = (payload) => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  off<T = any>(event: string, handler: EventHandler<T>): void {
    this.listeners.get(event)?.delete(handler as EventHandler);
  }

  emit<T = any>(event: string, payload?: T): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy so handlers that unsubscribe mid-emit don't break iteration.
    for (const handler of [...set]) handler(payload as T);
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Well-known event names used across the game. */
export const Events = {
  /** {position: THREE.Vector3, radius: number, kind: 'gunshot'|'footstep'|'glass'|'impact'} */
  Sound: 'sound',
  /** {name: string, remaining: number, headshot: boolean} */
  EnemyKilled: 'enemy-killed',
  /** {killer: string} */
  PlayerDied: 'player-died',
  /** {health: number, maxHealth: number} */
  PlayerDamaged: 'player-damaged',
  LevelComplete: 'level-complete',
  StartGame: 'start-game',
  ReturnToMenu: 'return-menu',
  RestartLevel: 'restart-level',
  /** Intro cleared — hand off to the main office level. */
  IntroComplete: 'intro-complete',
  RestartIntro: 'restart-intro',
  /** Office floor cleared and the player walked out — on to level three. */
  OfficeComplete: 'office-complete',
  RestartLevel3: 'restart-level3',
  /** Level three cleared — on to the dark floor. */
  Level3Complete: 'level3-complete',
  RestartLevel4: 'restart-level4',
  /** Level four cleared and the back door taken — down to the basement. */
  Level4Complete: 'level4-complete',
  RestartLevel5: 'restart-level5',
  /** Knocked out at the breaker — the screen has gone to black. */
  Level5Complete: 'level5-complete',
  /** {level: LevelId} — jump straight to a level from the menu's test page. */
  SelectLevel: 'select-level',
  /** {lethal: boolean} */
  HitMarker: 'hit-marker',
  Resize: 'resize'
} as const;

/** The levels the menu's test page can start from, in running order. */
export const LEVELS = [
  { id: 'intro', n: '1', name: 'THE CALL FLOOR', blurb: 'The desk, the drawer, the first agent' },
  { id: 'office', n: '2', name: 'RAVI-CALL SYSTEMS', blurb: 'The call floor proper — pistol, shotgun, AK' },
  { id: 'level3', n: '3', name: 'THE OTHER FLOOR', blurb: 'Upstairs, and whoever is still up there' },
  { id: 'level4', n: '4', name: 'LIGHTS OUT', blurb: 'The dark floor, by torchlight' },
  { id: 'level5', n: '5', name: 'THE SERVICE LIFT', blurb: 'Down to the basement' }
] as const;

export type LevelId = (typeof LEVELS)[number]['id'];
