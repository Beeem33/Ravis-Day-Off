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

  /** Where loading cards mount. Set once by main. */
  uiRoot: HTMLElement | null = null;
  private loadingCard: HTMLElement | null = null;
  private framesUntilReady = 0;

  /**
   * Swap scenes behind a loading card.
   *
   * Building a level and compiling its shaders both cost far more than a
   * frame's budget, and paying either while the player is already looking at
   * the world reads as a freeze. The card goes up first, the work happens
   * under it, and it only comes down once the new scene has actually drawn a
   * frame — which is when `CombatScene.warmUp` has finished.
   */
  setScene(scene: GameScene, label = ''): void {
    const card = this.showLoading(label);
    this.scene?.exit();
    this.scene = scene;
    scene.enter();
    this.framesUntilReady = 2; // this frame, then the warm-up frame
    this.loadingCard = card;
  }

  private showLoading(label: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'level-load';
    el.innerHTML =
      '<div class="ll-title">' + (label || 'LOADING') + '</div>' +
      '<div class="ll-bar"><i></i></div>' +
      '<div class="ll-sub">PREPARING</div>';
    (this.uiRoot ?? document.body).appendChild(el);
    return el;
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
      // The card comes down a frame after the scene has drawn once, so the
      // warm-up hitch lands underneath it rather than in front of the player.
      if (this.loadingCard && --this.framesUntilReady <= 0) {
        const card = this.loadingCard;
        this.loadingCard = null;
        card.classList.add('gone');
        setTimeout(() => card.remove(), 400);
      }
    });
  }
}
