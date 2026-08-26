/// <reference types="vite/client" />
import { GameEngine } from './core/GameEngine';
import { EventBus, Events } from './core/EventBus';
import { InputManager } from './core/InputManager';
import { AudioManager } from './core/AudioManager';
import { MainMenuScene } from './scenes/MainMenuScene';
import { IntroLevelScene } from './scenes/IntroLevelScene';
import { OfficeLevelScene } from './scenes/OfficeLevelScene';
import { Level3Scene } from './scenes/Level3Scene';

/** Shared services handed to every scene. */
export interface GameContext {
  engine: GameEngine;
  bus: EventBus;
  input: InputManager;
  audio: AudioManager;
  uiRoot: HTMLElement;
}

const container = document.getElementById('app')!;
const uiRoot = document.getElementById('ui-root')!;

const bus = new EventBus();
const engine = new GameEngine(container, bus);
const input = new InputManager(engine.domElement);
const audio = new AudioManager();

const ctx: GameContext = { engine, bus, input, audio, uiRoot };

// Any first gesture unlocks the audio context (browser autoplay policy)
const unlockOnce = (): void => {
  audio.unlock();
  document.removeEventListener('pointerdown', unlockOnce);
  document.removeEventListener('keydown', unlockOnce);
};
document.addEventListener('pointerdown', unlockOnce);
document.addEventListener('keydown', unlockOnce);

// ---- Scene flow
// A new game opens on the intro, which hands off to the call centre.
bus.on(Events.StartGame, () => {
  audio.stopMenuMusic();
  engine.setScene(new IntroLevelScene(ctx), 'THE CALL FLOOR');
});
bus.on(Events.RestartIntro, () => {
  engine.setScene(new IntroLevelScene(ctx), 'THE CALL FLOOR');
});
bus.on(Events.IntroComplete, () => {
  engine.setScene(new OfficeLevelScene(ctx), 'LEVEL 2 — RAVI-CALL SYSTEMS');
});
bus.on(Events.OfficeComplete, () => {
  engine.setScene(new Level3Scene(ctx), 'LEVEL 3 — THE OTHER FLOOR');
});
bus.on(Events.RestartLevel3, () => {
  engine.setScene(new Level3Scene(ctx), 'LEVEL 3 — THE OTHER FLOOR');
});
bus.on(Events.RestartLevel, () => {
  engine.setScene(new OfficeLevelScene(ctx), 'LEVEL 2 — RAVI-CALL SYSTEMS');
});
bus.on(Events.ReturnToMenu, () => {
  engine.setScene(new MainMenuScene(ctx));
});

engine.uiRoot = uiRoot;
engine.setScene(new MainMenuScene(ctx));
engine.start();

// Dev-only handle for poking at the running game from the console. Stripped
// from production builds by the bundler.
if (import.meta.env.DEV) {
  (window as unknown as { game: GameContext }).game = ctx;
}
