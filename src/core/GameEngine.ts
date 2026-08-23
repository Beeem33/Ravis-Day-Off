import * as THREE from 'three';
import { EventBus, Events } from './EventBus';

/**
 * A GameScene owns its own THREE.Scene/camera and is driven by the engine.
 */
export interface GameScene {
  enter(): void;
  exit(): void;
  update(dt: number, time: number): void;
  render(renderer: THREE.WebGLRenderer): void;
}

/**
 * GameEngine — renderer bootstrap, scene lifecycle and the main loop.
 * Delta time is clamped so tab-switch hitches never explode physics.
 */
export class GameEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly domElement: HTMLCanvasElement;
  private scene: GameScene | null = null;
  private lastTime = 0;
  private elapsed = 0;

  constructor(
    container: HTMLElement,
    public readonly bus: EventBus
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.domElement = this.renderer.domElement;
    container.appendChild(this.domElement);

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.bus.emit(Events.Resize, { width: window.innerWidth, height: window.innerHeight });
    });
  }

  setScene(scene: GameScene): void {
    this.scene?.exit();
    this.scene = scene;
    scene.enter();
  }

  start(): void {
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => {
      const now = performance.now();
      let dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      dt = Math.min(dt, 1 / 20); // clamp hitches
      this.elapsed += dt;
      if (this.scene) {
        this.scene.update(dt, this.elapsed);
        this.scene.render(this.renderer);
      }
    });
  }
}
