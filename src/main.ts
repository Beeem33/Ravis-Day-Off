/// <reference types="vite/client" />
import type * as THREE from 'three';
import { GameEngine } from './core/GameEngine';
import { EventBus, Events } from './core/EventBus';
import { InputManager } from './core/InputManager';
import { AudioManager } from './core/AudioManager';
import { MainMenuScene } from './scenes/MainMenuScene';
import { IntroLevelScene } from './scenes/IntroLevelScene';
import { OfficeLevelScene } from './scenes/OfficeLevelScene';
import { Level3Scene } from './scenes/Level3Scene';
import { Level4Scene } from './scenes/Level4Scene';

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
bus.on(Events.Level3Complete, () => {
  engine.setScene(new Level4Scene(ctx), 'LEVEL 4 — LIGHTS OUT');
});
bus.on(Events.RestartLevel4, () => {
  engine.setScene(new Level4Scene(ctx), 'LEVEL 4 — LIGHTS OUT');
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

// Dev-only handles for poking at the running game from the console. Stripped
// from production builds by the bundler.
if (import.meta.env.DEV) {
  (window as unknown as { game: GameContext }).game = ctx;

  /**
   * Render a frame and drop it in .shots/ — see the shot-sink plugin in
   * vite.config.ts. Optionally poses the player first, so a view can be
   * framed on whatever is being checked rather than wherever they happen to
   * be stood. Restores the renderer size and camera afterwards.
   */
  (window as unknown as { shot: unknown }).shot = async (o: {
    name?: string;
    /** Put the player at [x, z] first. */
    at?: [number, number];
    yaw?: number;
    pitch?: number;
    w?: number;
    h?: number;
    quality?: number;
    /** Camera height, default standing eye level. */
    eye?: number;
  } = {}) => {
    const sc = engine.currentScene as unknown as {
      player?: {
        camera: THREE.PerspectiveCamera;
        position: THREE.Vector3;
        velocity: THREE.Vector3;
        yaw: number;
        pitch: number;
        cinematic: boolean;
      };
      camera?: THREE.PerspectiveCamera;
      update(dt: number, t: number): void;
      render(r: THREE.WebGLRenderer): void;
    } | null;
    if (!sc) return { error: 'no scene' };
    const cam = sc.player?.camera ?? sc.camera;
    if (!cam) return { error: 'no camera' };

    if (o.at && sc.player) {
      sc.player.cinematic = true;
      sc.player.position.set(o.at[0], 0, o.at[1]);
      sc.player.velocity.set(0, 0, 0);
      if (o.yaw !== undefined) sc.player.yaw = o.yaw;
      if (o.pitch !== undefined) sc.player.pitch = o.pitch;
      // Let the scene settle, THEN drive the camera by hand. A cutscene scene
      // steers the camera itself, so posing the player and stepping afterwards
      // just hands the framing straight back to the cutscene.
      for (let i = 0; i < 4; i++) sc.update(1 / 120, 0);
      const eyeY = o.eye ?? 1.63;
      cam.position.set(o.at[0], eyeY, o.at[1]);
      cam.rotation.order = 'YXZ';
      cam.rotation.set(o.pitch ?? 0, o.yaw ?? 0, 0);
      cam.updateMatrixWorld(true);
    }

    const r = engine.renderer;
    const c = r.domElement;
    const ow = c.width;
    const oh = c.height;
    const oa = cam.aspect;
    const w = o.w ?? 900;
    const h = o.h ?? 560;
    r.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    sc.render(r);
    // toDataURL is synchronous, so the drawing buffer is still intact here.
    // toBlob's callback can land after the compositor has cleared it.
    const b64 = c.toDataURL('image/jpeg', o.quality ?? 0.82).split(',')[1];
    r.setSize(ow, oh, false);
    cam.aspect = oa;
    cam.updateProjectionMatrix();

    const resp = await fetch('/__shot', {
      method: 'POST',
      headers: { 'x-shot-name': o.name ?? 'shot' },
      body: b64
    });
    return resp.json();
  };
}
