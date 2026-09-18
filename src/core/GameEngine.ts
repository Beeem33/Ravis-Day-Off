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

  /**
   * Render resolution, in device pixels per CSS pixel. A Retina screen at its
   * full 2x is four times the pixels of 1x, and every lit pixel here runs
   * thirty to forty point lights: at 2x the lights-out floor spent 45 ms a
   * frame on the GPU, against 9 at 1x. So it starts at 1.25 and moves
   * between 1 and 1.5 by how long frames are actually taking.
   */
  private scale: number;
  private readonly scaleMin: number;
  private readonly scaleMax: number;
  private frameSum = 0;
  private frameCount = 0;
  private fastRuns = 0;

  /** A second's worth of frame times at a time: step the resolution down if they run long, up if there is room. */
  private adaptScale(frameSeconds: number): void {
    if (frameSeconds > 0.25) return; // a stall or a hidden tab, not the render
    this.frameSum += frameSeconds;
    if (++this.frameCount < 60) return;
    const avgMs = (this.frameSum / this.frameCount) * 1000;
    this.frameSum = 0;
    this.frameCount = 0;
    let next = this.scale;
    if (avgMs > 21) {
      next = Math.max(this.scaleMin, this.scale - 0.25);
      this.fastRuns = 0;
    } else if (avgMs < 12.5) {
      // Only after a few quick seconds in a row, so it does not see-saw
      if (++this.fastRuns >= 3) {
        next = Math.min(this.scaleMax, this.scale + 0.25);
        this.fastRuns = 0;
      }
    } else {
      this.fastRuns = 0;
    }
    if (next !== this.scale) {
      this.scale = next;
      this.renderer.setPixelRatio(next);
    }
  }

  constructor(
    container: HTMLElement,
    public readonly bus: EventBus
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const dpr = window.devicePixelRatio || 1;
    this.scaleMin = Math.min(dpr, 1);
    this.scaleMax = Math.min(dpr, 1.5);
    this.scale = Math.min(dpr, 1.25);
    this.renderer.setPixelRatio(this.scale);
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
    this.pendingHeld = this.holding;
    // A backgrounded tab never fires requestAnimationFrame, so the loop
    // would never pick this up and the card would hang there forever. The
    // timer still runs when hidden, so it finishes the job off-screen.
    window.clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => this.buildPending(), 150);
  }

  private holding = false;
  private pendingHeld = false;

  /**
   * Scenes queued from now on wait under their loading card until `p`
   * settles — for assets a level is built out of, like the agents' model,
   * which would otherwise arrive after the level had been built without it.
   * Whatever is already queued (the menu, at startup) goes ahead.
   */
  holdScenesUntil(p: Promise<unknown>): void {
    this.holding = true;
    void p.finally(() => {
      this.holding = false;
    });
  }

  /** Swap in the scene that setScene queued, and start its warm-up. */
  private buildPending(): void {
    if (!this.pendingScene) return;
    window.clearTimeout(this.pendingTimer);
    if (this.pendingHeld && this.holding) {
      // Still loading: keep the card up and look again shortly (the timer,
      // for a backgrounded tab; the loop tries every frame otherwise)
      this.pendingTimer = window.setTimeout(() => this.buildPending(), 100);
      return;
    }
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
      // Not while a level is loading or warming its shaders: those frames are
      // long for reasons that have nothing to do with the resolution
      if (!this.pendingScene && !this.loadingCard) this.adaptScale(dt);
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
