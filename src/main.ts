import { GameEngine } from './core/GameEngine';
import { EventBus, Events } from './core/EventBus';
import { InputManager } from './core/InputManager';
import { AudioManager } from './core/AudioManager';
import { MainMenuScene } from './scenes/MainMenuScene';
import { OfficeLevelScene } from './scenes/OfficeLevelScene';

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
bus.on(Events.StartGame, () => {
  audio.stopMenuMusic();
  engine.setScene(new OfficeLevelScene(ctx));
});
bus.on(Events.RestartLevel, () => {
  engine.setScene(new OfficeLevelScene(ctx));
});
bus.on(Events.ReturnToMenu, () => {
  engine.setScene(new MainMenuScene(ctx));
});

engine.setScene(new MainMenuScene(ctx));
engine.start();
