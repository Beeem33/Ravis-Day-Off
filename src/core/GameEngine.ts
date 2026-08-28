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
    // Off: nothing casts any more. The weapon lights on the dark floor were
    // the only shadow casters, and they are unlit geometry now — the shaft is
    // cut to a raycast rather than to a shadow map, which is both cheaper and
    // the only version that never leaked.
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.domElement = this.renderer.domElement;
    container.appendChild(this.domElement);

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.bus.emit(Events.Resize, { width: window.innerWidth, height: window.innerHeight });
    });
  }

  /** The scene currently being driven. Read-only; use setScene to change it. */
  get currentScene(): GameScene | null {
    return this.scene;
  }

  /** Where loading cards mount. Set once by main. */
  uiRoot: HTMLElement | null = null;
  private loadingCard: HTMLElement | null = null;
  private framesUntilReady = 0;
  private pendingScene: GameScene | null = null;
  private pendingFrames = 0;
  private pendingTimer = 0;

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
    this.loadingCard = this.showLoading(label);
    // The swap is deferred by a frame on purpose. Building a level and then
    // compiling its shaders is one long synchronous block — around a second
    // for the call floor, three for the raid — and the browser cannot paint
    // in the middle of it. Doing the work here would leave the card in the
    // DOM but never on screen, and the player would just see a freeze. So
    // the card goes up, the loop paints it, and the build happens next.
    this.pendingScene = scene;
    this.pendingFrames = 2;
    // A backgrounded tab never fires requestAnimationFrame, so the loop
    // would never pick this up and the card would hang there forever. The
    // timer still runs when hidden, so it finishes the job off-screen.
    window.clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => this.buildPending(), 150);
  }

  /** Swap in the scene that setScene queued, and start its warm-up. */
  private buildPending(): void {
    if (!this.pendingScene) return;
    window.clearTimeout(this.pendingTimer);
    this.scene?.exit();
    this.scene = this.pendingScene;
    this.pendingScene = null;
    this.scene.enter();
    this.framesUntilReady = 2; // this frame, then the warm-up frame
    this.lastTime = performance.now(); // the build is not elapsed game time
  }

  private showLoading(label: string): HTMLElement {
    // Anything still up from a previous swap goes now — a restart mid-fade
    // used to stack cards on top of each other.
    this.loadingCard?.remove();
    for (const old of (this.uiRoot ?? document.body).querySelectorAll('.level-load')) old.remove();
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
      // A scene waiting to be built: hold off until the card has painted
      if (this.pendingScene) {
        if (--this.pendingFrames <= 0) this.buildPending();
        return; // card only until then
      }
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
