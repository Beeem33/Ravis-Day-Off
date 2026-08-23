/**
 * InputManager — keyboard state, pointer-lock mouse look deltas and
 * click edge detection. All consumers poll; deltas are consumed per frame.
 */
export class InputManager {
  private keysDown = new Set<string>();
  private keysPressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private clickQueued = false;
  mouseHeld = false;
  /** Right mouse button held (aim down sights). */
  rightHeld = false;
  pointerLocked = false;

  /** Optional hook fired when pointer lock is lost (e.g. user pressed Esc). */
  onPointerLockLost: (() => void) | null = null;

  constructor(private element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keysDown.add(e.code);
      this.keysPressed.add(e.code);
      // Keep browser shortcuts from stealing game keys while locked.
      if (this.pointerLocked && ['Space', 'ControlLeft', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code));
    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.mouseHeld = false;
      this.rightHeld = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        this.rightHeld = true;
        return;
      }
      if (e.button !== 0) return;
      this.mouseHeld = true;
      if (this.pointerLocked) this.clickQueued = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseHeld = false;
      if (e.button === 2) this.rightHeld = false;
    });
    // Right mouse = aim down sights; never show the browser context menu
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.element;
      const lost = this.pointerLocked && !locked;
      this.pointerLocked = locked;
      if (lost) this.onPointerLockLost?.();
    });
  }

  requestPointerLock(): void {
    if (this.pointerLocked) return;
    try {
      // Returns a promise in modern browsers; rejection (e.g. user hit Esc
      // too recently, or the document isn't focused) is non-fatal.
      const p = this.element.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* ignore */
    }
  }

  exitPointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  /** True only on the frame the key first went down. */
  wasPressed(code: string): boolean {
    return this.keysPressed.has(code);
  }

  /** Returns and clears the accumulated mouse-look delta. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  /** True once per physical click while locked. */
  consumeClick(): boolean {
    const c = this.clickQueued;
    this.clickQueued = false;
    return c;
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.keysPressed.clear();
  }
}
