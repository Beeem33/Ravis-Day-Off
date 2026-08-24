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
  /** {lethal: boolean} */
  HitMarker: 'hit-marker',
  Resize: 'resize'
} as const;
