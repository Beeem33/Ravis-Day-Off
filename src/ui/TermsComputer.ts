import * as THREE from 'three';
import type { AudioManager } from '../core/AudioManager';
import { DESKTOP_FILES, drawFileIcon, fileDef, isAd, isFile, viewerFor, type DeskCtx, type FileId, type Viewer } from './RaviFiles';

/**
 * Ravi's work PC, at the very top of the game: a live canvas on the monitor in
 * the office that behaves like a desktop. A bare desktop with a Recycle Bin,
 * Googel Chrome, the Terms and Conditions file on it; a taskbar with a
 * Start menu and a clock; windows that open on a double-click, drag by their
 * title bars, minimise, maximise and close. Chrome takes typing and goes
 * nowhere useful. The Terms have to be scrolled to the bottom (the controls
 * are the clauses), ticked, and agreed to — then the game begins, and the
 * signed agreement stays up on his screen. The mouse pointer is a bowl of curry.
 *
 * The mouse is the real one, hit-tested against the monitor in the world: a
 * ray from the camera through the pointer onto the face of the screen.
 */

const W = 1200;
const H = 800;
const TASK_H = 56;
const TITLE_H = 38;
const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

type AppId = 'terms' | 'chrome' | 'bin' | FileId;
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Win extends Rect {
  app: AppId;
  min: boolean;
  max: boolean;
}
interface Hot extends Rect {
  id: string;
  win?: Win;
  down?: () => void;
  dbl?: () => void;
  right?: () => void;
  wheel?: (dy: number) => void;
}
type Block = { h: string } | { p: string; small?: boolean } | { k: string[]; t: string };

/** The agreement. The controls are the clauses, which is the joke. */
const DOCUMENT: Block[] = [
  { h: 'END USER LICENSE AGREEMENT FOR BEING RAVI' },
  {
    p: 'Last updated: today, probably. By continuing to sit at this desk, you ("Ravi", "the Employee", "that guy in the back office") agree to the following Terms and Conditions. Please read them carefully. Nobody ever does, which is exactly why we put all the important stuff in here.'
  },
  { h: '1.  DEFINITIONS' },
  {
    p: '"Today" means your day off. "Day off" means a period of time you were technically promised. "Curry" means breakfast, lunch, dinner and emotional support. "The Company" means us. "Us" means the people who will not be reading this either.'
  },
  { h: '2.  MOVEMENT RIGHTS' },
  { k: ['W', 'A', 'S', 'D'], t: 'Walk forwards, left, backwards and right. Walking diagonally is permitted but frowned upon by Management.' },
  { k: ['MOUSE'], t: 'Look around. Looking at a coworker for more than four seconds counts as a meeting and will be logged.' },
  { k: ['SHIFT'], t: 'Sprint. Running in the office is strictly prohibited unless something is shooting at you (see Section 7).' },
  { k: ['C'], t: 'Crouch. Recommended for hiding behind desks, printers and your responsibilities.' },
  { k: ['SPACE'], t: 'Jump. The Company is not liable for ceiling tiles.' },
  { h: '3.  USE OF COMPANY FIREARMS' },
  { k: ['LEFT CLICK'], t: 'Fire. The Employee acknowledges that the stapler was not an acceptable alternative.' },
  { k: ['RIGHT CLICK'], t: 'Aim down the sights. Accuracy is one of our core company values (the other one is synergy).' },
  { k: ['R'], t: 'Reload. Magazines are Company property and must not be thrown at Management.' },
  { k: ['1', '2', '3'], t: 'Switch weapons, once you have more than one. You do not. Yet.' },
  { h: '4.  CLOSE-QUARTERS EMPLOYEE RELATIONS' },
  { k: ['F'], t: 'Knife takedown, when standing right next to someone. Please keep it down, others are trying to work.' },
  { k: ['Q'], t: 'Drop kick. Not covered by the Company dental plan.' },
  { k: ['E'], t: 'Interact. Doors, buttons, lifts, levers and anything else that is not a person.' },
  { h: '5.  WORKPLACE WELLNESS PROGRAMME' },
  { k: ['G'], t: 'Drink a Deadbull™ and return to full health in three seconds. Deadbull™ has not been evaluated by anybody. Side effects may include: winning.' },
  { k: ['T'], t: 'Flip them off. The Company values honest feedback.' },
  { h: '6.  BREAKS' },
  { k: ['ESC'], t: 'Pause / open the menu. This is the only break you will be receiving today.' },
  { h: '7.  LIABILITY' },
  {
    p: 'The Company accepts no responsibility for: being shot at, being shot, coworkers being shot, doors being kicked in, the coffee machine, or anything at all that happens after you click I AGREE. The Employee hereby waives the right to a quiet afternoon.'
  },
  { h: '8.  THE CURRY CLAUSE' },
  {
    p: 'Your mouse pointer has been replaced with a bowl of curry for morale purposes. Do not spill it on the keyboard. The curry is not a refund, a bonus, or a pay rise, and it is not to be shared with Gary.'
  },
  { h: '9.  COLLECTIBLE FRAGRANCES' },
  {
    p: 'Fourteen (14) ultra-niche colognes have been misplaced somewhere on Company premises and beyond. Finders keepers. The Company will not be telling you where they are.'
  },
  { h: '10.  GOVERNING LAW' },
  {
    p: 'These Terms are governed by the laws of physics, mostly. Should any clause be found unenforceable, the remaining clauses will simply be enforced harder.'
  },
  { h: '11.  FINAL NOTICE' },
  {
    p: 'Congratulations. You are one of the 0.0003% of people who have ever scrolled to the bottom of a Terms and Conditions page. Your reward is the checkbox below. Tick it. Enjoy your day off.'
  },
  { p: 'RaviCorp Holdings Ltd. accepts no responsibility for the contents of this agreement, including this sentence.', small: true }
];

const BIN_ITEMS = [
  ['resignation_letter.docx', 'C:\\Users\\Ravi\\Documents', 'Yesterday 4:58 PM'],
  ['resignation_letter_FINAL.docx', 'C:\\Users\\Ravi\\Documents', 'Yesterday 4:59 PM'],
  ['resignation_letter_FINAL_actually_final.docx', 'C:\\Users\\Ravi\\Documents', 'Yesterday 5:00 PM'],
  ['day_off_request.pdf', 'C:\\Users\\Ravi\\Desktop', 'Today 8:01 AM'],
  ['garys_birthday_card_UNSIGNED.png', 'C:\\Users\\Ravi\\Pictures', 'Today 9:15 AM'],
  ['curry_recipe_DO_NOT_DELETE.txt', 'C:\\Users\\Ravi\\Documents', 'Today 12:30 PM']
] as const;

const TITLES: Record<'terms' | 'chrome' | 'bin', string> = {
  terms: 'Terms_and_Conditions_FINAL_v2(3).pdf — PDF Viewer',
  chrome: 'Googel Chrome',
  bin: 'Recycle Bin'
};

export class TermsComputer {
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  /** Set once I AGREE has gone through and the "thank you" has been read. */
  done = false;
  /** Set the moment I AGREE is clicked. */
  accepted = false;

  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private wallpaper: HTMLCanvasElement;
  private time = 0;
  private dt = 0;
  private live = true;
  /** The open files' apps, by file. */
  private viewers = new Map<FileId, Viewer>();

  // ---- pointer
  private mx = W / 2;
  private my = H / 2;
  private sx = window.innerWidth / 2;
  private sy = window.innerHeight / 2;
  private events: ('down' | 'right' | 'up')[] = [];
  private wheelQ = 0;
  private hots: Hot[] = [];
  private hoverId = '';
  private lastDown = { id: '', t: -9 };
  private drag: { win: Win; ox: number; oy: number } | null = null;

  // ---- the desktop
  private wins: Win[] = [];
  private selectedIcon = '';
  private startOpen = false;
  private ctxMenu: { x: number; y: number } | null = null;
  private dialog: { title: string; text: string; buttons: { label: string; fn: () => void }[] } | null = null;
  private note: { title: string; body: string; t: number } | null = null;
  private flash = 0;

  // ---- the Terms
  private docCache = new Map<number, { c: HTMLCanvasElement; h: number }>();
  private scroll = 0;
  private scrollTarget = 0;
  private maxScroll = Infinity;
  private readToEnd = false;
  private checked = false;
  private barDrag: { off: number } | null = null;
  private termsGeo: { bar: Rect; thumbH: number } | null = null;
  private termsMsg = '';
  private termsMsgT = 0;
  private shake = 0;
  private acceptT = -1;
  private declines = 0;

  // ---- Chrome
  private page: 'newtab' | 'results' | 'blocked' = 'newtab';
  private history: ('newtab' | 'results' | 'blocked')[] = [];
  private query = '';
  private typed = '';
  private typing = false;
  private blockedUrl = '';

  // ---- Recycle Bin
  private binItems: (readonly [string, string, string])[] = [...BIN_ITEMS];
  private binSel = -1;

  private onMove = (e: MouseEvent): void => {
    if (document.pointerLockElement) {
      this.sx = THREE.MathUtils.clamp(this.sx + e.movementX, 0, window.innerWidth);
      this.sy = THREE.MathUtils.clamp(this.sy + e.movementY, 0, window.innerHeight);
    } else {
      this.sx = e.clientX;
      this.sy = e.clientY;
    }
  };
  private onDown = (e: MouseEvent): void => {
    if (e.button === 0) this.events.push('down');
    else if (e.button === 2) this.events.push('right');
  };
  private onUp = (): void => {
    this.events.push('up');
  };
  private onCtx = (e: Event): void => e.preventDefault();
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.wheelQ += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  };
  private onKey = (e: KeyboardEvent): void => this.key(e);

  constructor(
    private readonly face: THREE.Mesh,
    private readonly faceW: number,
    private readonly faceH: number,
    private readonly audio: AudioManager
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.wallpaper = TermsComputer.paintWallpaper();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    // Not tone-mapped: a lit screen, and the small print has to stay readable
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.draw();

    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('mousedown', this.onDown);
    document.addEventListener('mouseup', this.onUp);
    document.addEventListener('contextmenu', this.onCtx);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('keydown', this.onKey);
    document.body.classList.add('terms-cursor');
  }

  /** Stop taking input; the screen stays up as it is (the signed agreement). */
  release(): void {
    if (!this.live) return;
    this.live = false;
    document.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('mousedown', this.onDown);
    document.removeEventListener('mouseup', this.onUp);
    document.removeEventListener('contextmenu', this.onCtx);
    window.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('keydown', this.onKey);
    document.body.classList.remove('terms-cursor');
    this.draw();
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.release();
    this.texture.dispose();
    this.material.dispose();
  }

  // ================================================================ input

  /** The pointer, from the window onto the monitor's face (canvas px). */
  private pick(camera: THREE.Camera): void {
    const ndc = new THREE.Vector2((this.sx / window.innerWidth) * 2 - 1, -(this.sy / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    this.face.updateWorldMatrix(true, false);
    const inv = this.face.matrixWorld.clone().invert();
    const o = ray.ray.origin.clone().applyMatrix4(inv);
    const d = ray.ray.direction.clone().transformDirection(inv);
    if (Math.abs(d.z) < 1e-5) return;
    const t = -o.z / d.z;
    if (t <= 0) return;
    this.mx = THREE.MathUtils.clamp(((o.x + d.x * t) / this.faceW + 0.5) * W, 2, W - 2);
    this.my = THREE.MathUtils.clamp((0.5 - (o.y + d.y * t) / this.faceH) * H, 2, H - 2);
  }

  private at(x: number, y: number): Hot | null {
    for (let i = this.hots.length - 1; i >= 0; i--) {
      const h = this.hots[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  private press(right: boolean): void {
    const h = this.at(this.mx, this.my);
    const id = h?.id ?? '';
    if (this.ctxMenu && !id.startsWith('ctx:')) this.ctxMenu = null;
    if (this.startOpen && !id.startsWith('start')) this.startOpen = false;
    if (this.typing && id !== 'omni' && id !== 'gsearch') this.typing = false;
    if (!h) return;
    if (h.win) this.focus(h.win);
    if (right) {
      h.right?.();
      return;
    }
    this.audio.mouseClick();
    const dbl = this.lastDown.id === id && this.time - this.lastDown.t < 0.45;
    this.lastDown = { id, t: dbl ? -9 : this.time };
    if (dbl && h.dbl) h.dbl();
    else h.down?.();
  }

  private key(e: KeyboardEvent): void {
    if (this.accepted) return;
    if (this.typing) {
      e.preventDefault();
      if (e.key === 'Enter') this.search();
      else if (e.key === 'Escape') this.typing = false;
      else if (e.key === 'Backspace') this.typed = this.typed.slice(0, -1);
      else if (e.key.length === 1 && this.typed.length < 48) this.typed += e.key;
      return;
    }
    const top = this.topWin();
    if (top && isFile(top.app)) {
      const v = this.viewers.get(top.app);
      if (v?.key?.(e, this.ctxFor(top))) e.preventDefault();
      return;
    }
    if (top?.app === 'terms') {
      const page = 360;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') this.scrollBy(60);
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.scrollBy(-60);
      else if (e.code === 'PageDown' || e.code === 'Space') this.scrollBy(page);
      else if (e.code === 'PageUp') this.scrollBy(-page);
      else if (e.code === 'End') this.scrollBy(1e6);
      else if (e.code === 'Home') this.scrollBy(-1e6);
      else if (e.code === 'Enter' && this.checked) this.accept();
      else return;
      e.preventDefault();
      return;
    }
    if (e.code === 'Enter' && this.selectedIcon) {
      e.preventDefault();
      this.open(this.selectedIcon as AppId);
    }
  }

  // ============================================================== windows

  private topWin(): Win | null {
    for (let i = this.wins.length - 1; i >= 0; i--) if (!this.wins[i].min) return this.wins[i];
    return null;
  }

  private focus(w: Win): void {
    const i = this.wins.indexOf(w);
    if (i >= 0 && i !== this.wins.length - 1) {
      this.wins.splice(i, 1);
      this.wins.push(w);
    }
  }

  private open(app: AppId): void {
    this.startOpen = false;
    const have = this.wins.find((w) => w.app === app);
    if (have) {
      have.min = false;
      this.focus(have);
      return;
    }
    if (isFile(app)) {
      const d = fileDef(app);
      const n = this.wins.length;
      this.viewers.set(app, viewerFor(app));
      this.wins.push({
        app,
        x: d.x ?? Math.max(0, (W - d.w) / 2 + (n % 4) * 26 - 39),
        y: d.y ?? Math.max(0, Math.min(H - TASK_H - d.h, 30 + (n % 4) * 22)),
        w: d.w,
        h: Math.min(d.h, H - TASK_H),
        min: false,
        max: false
      });
      this.audio.mouseClick();
      return;
    }
    const at: Record<'terms' | 'chrome' | 'bin', Rect> = {
      terms: { x: 70, y: 18, w: 1060, h: 710 },
      chrome: { x: 130, y: 40, w: 920, h: 620 },
      bin: { x: 210, y: 110, w: 780, h: 470 }
    };
    if (app === 'chrome') {
      this.page = 'newtab';
      this.history = [];
      this.typed = '';
    }
    this.wins.push({ app, ...at[app], min: false, max: false });
  }

  private ctxFor(w: Win): DeskCtx {
    return {
      g: this.g,
      time: this.time,
      dt: this.dt,
      hoverId: this.hoverId,
      mx: this.mx,
      my: this.my,
      hot: (r, id, o = {}) => this.hot(r, id, { win: w, ...o }),
      open: (id) => this.open(id),
      close: () => this.close(w),
      say: (t, b) => this.say(t, b),
      count: (p) => this.wins.filter((o) => o.app.startsWith(p)).length
    };
  }

  private close(w: Win): void {
    this.wins = this.wins.filter((o) => o !== w);
    if (w.app === 'chrome') this.typing = false;
  }

  private rectOf(w: Win): Rect {
    return w.max ? { x: 0, y: 0, w: W, h: H - TASK_H } : w;
  }

  private say(title: string, body: string): void {
    this.note = { title, body, t: 4 };
    this.audio.osDing();
  }

  private disabled(what: string): void {
    this.say(what, 'This has been disabled by your organization.');
  }

  // ============================================================ the Terms

  private scrollBy(px: number): void {
    if (this.accepted || !isFinite(this.maxScroll)) return;
    this.scrollTarget = THREE.MathUtils.clamp(this.scrollTarget + px, 0, this.maxScroll);
  }

  private termsSay(text: string): void {
    this.termsMsg = text;
    this.termsMsgT = 2.8;
    this.audio.osDing();
  }

  private accept(): void {
    if (this.accepted) return;
    this.accepted = true;
    this.acceptT = 0;
    this.typing = false;
    this.startOpen = false;
    this.ctxMenu = null;
    this.audio.uiBeep(true);
  }

  // =============================================================== Chrome

  private go(page: 'newtab' | 'results' | 'blocked'): void {
    this.history.push(this.page);
    this.page = page;
  }

  private search(): void {
    const q = this.typed.trim();
    this.typing = false;
    if (!q) return;
    this.query = q;
    if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(q)) {
      this.blockedUrl = q.replace(/^https?:\/\//i, '');
      this.go('blocked');
    } else this.go('results');
    this.audio.mouseClick();
  }

  private block(url: string): void {
    this.blockedUrl = url;
    this.go('blocked');
  }

  // =============================================================== update

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    this.dt = dt;
    if (!this.live) return;
    this.pick(camera);

    for (const e of this.events.splice(0)) {
      if (e === 'up') {
        this.drag = null;
        this.barDrag = null;
      } else if (!this.accepted) this.press(e === 'right');
    }
    if (this.wheelQ !== 0) {
      const h = this.at(this.mx, this.my);
      if (!this.accepted) {
        // Anywhere over the PDF viewer scrolls the agreement, like the real thing
        if (h?.wheel) h.wheel(this.wheelQ * 0.9);
        else if (h?.win?.app === 'terms') this.scrollBy(this.wheelQ * 0.9);
      }
      this.wheelQ = 0;
    }
    if (this.drag) {
      const w = this.drag.win;
      w.x = THREE.MathUtils.clamp(this.mx - this.drag.ox, -w.w + 120, W - 120);
      w.y = THREE.MathUtils.clamp(this.my - this.drag.oy, 0, H - TASK_H - TITLE_H);
    }
    if (this.barDrag && this.termsGeo && isFinite(this.maxScroll)) {
      const { bar, thumbH } = this.termsGeo;
      const u = (this.my - this.barDrag.off - bar.y) / Math.max(1, bar.h - thumbH);
      this.scrollTarget = THREE.MathUtils.clamp(u, 0, 1) * this.maxScroll;
    }

    this.scroll += (this.scrollTarget - this.scroll) * Math.min(1, dt * 14);
    if (Math.abs(this.scrollTarget - this.scroll) < 0.3) this.scroll = this.scrollTarget;
    if (!this.readToEnd && isFinite(this.maxScroll) && this.scroll >= this.maxScroll - 6) {
      this.readToEnd = true;
      this.termsSay('You read the whole thing. HR has been notified.');
    }
    this.termsMsgT = Math.max(0, this.termsMsgT - dt);
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt);
    if (this.note) {
      this.note.t -= dt;
      if (this.note.t <= 0) this.note = null;
    }
    if (this.acceptT >= 0) {
      this.acceptT += dt;
      if (this.acceptT > 2.6) this.done = true;
    }

    this.draw();
    const h = this.at(this.mx, this.my);
    this.hoverId = h?.id ?? '';
    this.texture.needsUpdate = true;
  }

  // ============================================================== drawing

  private hot(r: Rect, id: string, o: Omit<Hot, keyof Rect | 'id'> = {}): void {
    this.hots.push({ ...r, id, ...o });
  }

  private draw(): void {
    const g = this.g;
    this.hots = [];
    g.drawImage(this.wallpaper, 0, 0);
    this.hot({ x: 0, y: 0, w: W, h: H - TASK_H }, 'desktop', {
      down: () => (this.selectedIcon = ''),
      right: () => {
        this.selectedIcon = '';
        this.ctxMenu = { x: Math.min(this.mx, W - 250), y: Math.min(this.my, H - TASK_H - 250) };
      }
    });
    this.drawIcons();
    this.drawFileIcons();
    this.drawStickyNote();
    for (const w of this.wins) if (!w.min) this.drawWindow(w);
    this.drawTaskbar();
    if (this.startOpen) this.drawStart();
    if (this.ctxMenu) this.drawCtx();
    if (this.dialog) this.drawDialog();
    if (this.note) this.drawNote();
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.6})`;
      g.fillRect(0, 0, W, H - TASK_H);
    }
    if (this.accepted && this.acceptT < 2.6) this.drawAccepting();
    if (this.live && !this.done) this.drawCurry(this.mx, this.my);
  }

  // ---------------------------------------------------------------- desktop

  private static paintWallpaper(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#9fc6f2');
    bg.addColorStop(0.55, '#4f8fdc');
    bg.addColorStop(1, '#1d4fa6');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // A soft bloom of overlapping petals, off to the right of centre
    const cx = W * 0.6;
    const cy = H * 0.5;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      g.save();
      g.translate(cx, cy);
      g.rotate(a);
      const p = g.createLinearGradient(0, 0, 260, 0);
      p.addColorStop(0, 'rgba(20, 60, 170, 0.55)');
      p.addColorStop(1, 'rgba(120, 190, 255, 0.25)');
      g.fillStyle = p;
      g.beginPath();
      g.ellipse(130, 0, 150, 60, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    const glow = g.createRadialGradient(cx, cy, 10, cx, cy, 120);
    glow.addColorStop(0, 'rgba(230, 245, 255, 0.7)');
    glow.addColorStop(1, 'rgba(230, 245, 255, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    return c;
  }

  private drawIcons(): void {
    const g = this.g;
    const icons: { id: AppId; label: string[]; draw: (x: number, y: number) => void }[] = [
      { id: 'bin', label: ['Recycle Bin'], draw: (x, y) => drawBin(g, x, y, 54, this.binItems.length > 0) },
      { id: 'chrome', label: ['Googel Chrome'], draw: (x, y) => drawChrome(g, x + 27, y + 27, 26) },
      { id: 'terms', label: ['Terms_and_', 'Conditions_FINAL', '_v2(3).pdf'], draw: (x, y) => drawPdf(g, x + 6, y, 42, 54) }
    ];
    icons.forEach((ic, i) => {
      const r = { x: 18, y: 16 + i * 122, w: 112, h: 116 };
      const sel = this.selectedIcon === ic.id;
      const hov = this.hoverId === 'icon:' + ic.id;
      if (sel || hov) {
        g.fillStyle = sel ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.16)';
        rr(g, r.x, r.y, r.w, r.h, 6);
        g.fill();
        if (sel) {
          g.strokeStyle = 'rgba(255,255,255,0.55)';
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
      ic.draw(r.x + 29, r.y + 8);
      g.font = `400 15px ${FONT}`;
      g.textAlign = 'center';
      g.fillStyle = '#ffffff';
      g.shadowColor = 'rgba(0,0,0,0.85)';
      g.shadowBlur = 4;
      g.shadowOffsetY = 1;
      ic.label.forEach((l, k) => g.fillText(l, r.x + r.w / 2, r.y + 80 + k * 17));
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
      g.textAlign = 'left';
      this.hot(r, 'icon:' + ic.id, {
        down: () => (this.selectedIcon = ic.id),
        dbl: () => {
          this.selectedIcon = ic.id;
          this.open(ic.id);
        },
        right: () => {
          this.selectedIcon = ic.id;
        }
      });
    });
  }

  /** Ravi's files, down the columns after the three system icons. */
  private drawFileIcons(): void {
    const g = this.g;
    DESKTOP_FILES.forEach((id, k) => {
      const slot = 3 + k;
      const r = { x: 18 + Math.floor(slot / 6) * 118, y: 16 + (slot % 6) * 122, w: 112, h: 116 };
      const d = fileDef(id);
      const sel = this.selectedIcon === id;
      const hov = this.hoverId === 'icon:' + id;
      if (sel || hov) {
        g.fillStyle = sel ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.16)';
        rr(g, r.x, r.y, r.w, r.h, 6);
        g.fill();
      }
      const wide = d.icon === 'folder' || d.icon === 'exe';
      drawFileIcon(g, d.icon, r.x + (wide ? 30 : 34), r.y + 8, wide ? 52 : 56);
      g.font = `400 14px ${FONT}`;
      g.textAlign = 'center';
      g.fillStyle = '#ffffff';
      g.shadowColor = 'rgba(0,0,0,0.85)';
      g.shadowBlur = 4;
      g.shadowOffsetY = 1;
      d.label.forEach((l, i) => g.fillText(l, r.x + r.w / 2, r.y + 80 + i * 16));
      g.shadowColor = 'transparent';
      g.shadowBlur = 0;
      g.shadowOffsetY = 0;
      g.textAlign = 'left';
      this.hot(r, 'icon:' + id, {
        down: () => (this.selectedIcon = id),
        dbl: () => {
          this.selectedIcon = id;
          this.open(id);
        },
        right: () => (this.selectedIcon = id)
      });
    });
  }

  private drawStickyNote(): void {
    const g = this.g;
    g.save();
    g.translate(W - 290, 34);
    g.rotate(0.035);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(6, 8, 250, 196);
    g.fillStyle = '#fff176';
    g.fillRect(0, 0, 250, 196);
    g.fillStyle = '#f4e35c';
    g.fillRect(0, 0, 250, 26);
    g.fillStyle = '#3b3320';
    g.font = `700 19px "Segoe Print", "Comic Sans MS", cursive`;
    g.fillText('RAVI —', 16, 54);
    g.font = `400 16px "Segoe Print", "Comic Sans MS", cursive`;
    ['Sign the Terms and', 'Conditions BEFORE your', 'day off starts!!', '(the file is on your desktop)'].forEach((l, i) =>
      g.fillText(l, 16, 82 + i * 24)
    );
    g.font = `italic 400 15px "Segoe Print", "Comic Sans MS", cursive`;
    g.fillText('— Management', 120, 184);
    g.restore();
  }

  private drawCtx(): void {
    const g = this.g;
    const m = this.ctxMenu!;
    const items: [string, () => void][] = [
      ['View', () => this.disabled('View')],
      ['Sort by', () => this.disabled('Sort by')],
      ['Refresh', () => (this.flash = 0.25)],
      ['New', () => this.say('New folder', "You don't have permission to create files on this desktop.")],
      ['Display settings', () => this.disabled('Display settings')],
      ['Personalize', () => this.disabled('Personalize')]
    ];
    const r = { x: m.x, y: m.y, w: 230, h: items.length * 36 + 12 };
    shadowBox(g, r, 8, '#f9f9f9');
    this.hot(r, 'ctx:bg');
    items.forEach(([label, fn], i) => {
      const ir = { x: r.x + 6, y: r.y + 6 + i * 36, w: r.w - 12, h: 34 };
      if (this.hoverId === 'ctx:' + label) {
        g.fillStyle = '#e8eef7';
        rr(g, ir.x, ir.y, ir.w, ir.h, 5);
        g.fill();
      }
      g.fillStyle = '#1f1f1f';
      g.font = `400 16px ${FONT}`;
      g.fillText(label, ir.x + 16, ir.y + 23);
      this.hot(ir, 'ctx:' + label, {
        down: () => {
          this.ctxMenu = null;
          fn();
        }
      });
    });
  }

  private drawDialog(): void {
    const g = this.g;
    const d = this.dialog!;
    this.hot({ x: 0, y: 0, w: W, h: H }, 'dlg:block');
    const r = { x: W / 2 - 250, y: H / 2 - 110, w: 500, h: 200 };
    shadowBox(g, r, 10, '#ffffff');
    g.fillStyle = '#f3f3f3';
    g.fillRect(r.x, r.y, r.w, 36);
    g.font = `400 15px ${FONT}`;
    g.fillStyle = '#1f1f1f';
    g.fillText(d.title, r.x + 14, r.y + 24);
    drawBin(g, r.x + 22, r.y + 58, 40, true);
    g.font = `400 17px ${FONT}`;
    g.fillStyle = '#1f1f1f';
    wrapText(g, d.text, 380).forEach((l, i) => g.fillText(l, r.x + 82, r.y + 74 + i * 24));
    d.buttons.forEach((b, i) => {
      const br = { x: r.x + r.w - 20 - (d.buttons.length - i) * 112, y: r.y + r.h - 54, w: 100, h: 36 };
      const prim = i === 0;
      g.fillStyle = prim ? (this.hoverId === 'dlg:' + i ? '#1a6fd1' : '#0f62c4') : this.hoverId === 'dlg:' + i ? '#e5e5e5' : '#f3f3f3';
      rr(g, br.x, br.y, br.w, br.h, 5);
      g.fill();
      g.strokeStyle = prim ? '#0b4fa0' : '#c4c4c4';
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = prim ? '#ffffff' : '#1f1f1f';
      g.textAlign = 'center';
      g.fillText(b.label, br.x + br.w / 2, br.y + 24);
      g.textAlign = 'left';
      this.hot(br, 'dlg:' + i, {
        down: () => {
          this.dialog = null;
          b.fn();
        }
      });
    });
  }

  private drawNote(): void {
    const g = this.g;
    const n = this.note!;
    const slide = Math.min(1, (4 - n.t) * 6) * Math.min(1, n.t * 3);
    const r = { x: W - 380 + (1 - slide) * 60, y: H - TASK_H - 112, w: 364, h: 98 };
    g.globalAlpha = slide;
    shadowBox(g, r, 8, '#f6f6f6');
    g.fillStyle = '#0f62c4';
    g.font = `600 14px ${FONT}`;
    g.fillText('RaviCorp IT', r.x + 18, r.y + 26);
    g.fillStyle = '#1f1f1f';
    g.font = `700 17px ${FONT}`;
    g.fillText(n.title, r.x + 18, r.y + 50);
    g.font = `400 15px ${FONT}`;
    g.fillStyle = '#444';
    wrapText(g, n.body, r.w - 36)
      .slice(0, 2)
      .forEach((l, i) => g.fillText(l, r.x + 18, r.y + 72 + i * 19));
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- taskbar

  private drawTaskbar(): void {
    const g = this.g;
    const y = H - TASK_H;
    g.fillStyle = 'rgba(238, 242, 248, 0.94)';
    g.fillRect(0, y, W, TASK_H);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, y, W, 1);
    this.hot({ x: 0, y, w: W, h: TASK_H }, 'task:bg');

    const apps: { id: string; app?: AppId; draw: (cx: number, cy: number) => void; click: () => void }[] = [
      { id: 'start', draw: (cx, cy) => drawWinLogo(g, cx, cy, 22), click: () => (this.startOpen = !this.startOpen) },
      { id: 'task:search', draw: (cx, cy) => drawSearch(g, cx, cy), click: () => (this.startOpen = !this.startOpen) },
      { id: 'task:bin', app: 'bin', draw: (cx, cy) => drawFolder(g, cx - 16, cy - 12, 32, 25), click: () => this.taskClick('bin') },
      { id: 'task:chrome', app: 'chrome', draw: (cx, cy) => drawChrome(g, cx, cy, 15), click: () => this.taskClick('chrome') }
    ];
    if (this.wins.some((w) => w.app === 'terms'))
      apps.push({ id: 'task:terms', app: 'terms', draw: (cx, cy) => drawPdf(g, cx - 12, cy - 15, 24, 30), click: () => this.taskClick('terms') });
    for (const w of this.wins) {
      const app = w.app;
      if (!isFile(app) || isAd(app) || apps.some((a) => a.app === app)) continue;
      apps.push({ id: 'task:' + app, app, draw: (cx, cy) => drawFileIcon(g, fileDef(app).icon, cx - 10, cy - 13, 26), click: () => this.taskClick(app) });
    }
    const n = apps.length;
    const x0 = W / 2 - (n * 52) / 2;
    apps.forEach((a, i) => {
      const r = { x: x0 + i * 52 + 2, y: y + 6, w: 48, h: 44 };
      const win = a.app ? this.wins.find((w) => w.app === a.app) : undefined;
      const active = (win && this.topWin() === win) || (a.id === 'start' && this.startOpen);
      if (this.hoverId === a.id || active) {
        g.fillStyle = active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
        rr(g, r.x, r.y, r.w, r.h, 6);
        g.fill();
      }
      a.draw(r.x + r.w / 2, r.y + r.h / 2 - 1);
      if (win) {
        g.fillStyle = active ? '#0f62c4' : '#8a8a8a';
        rr(g, r.x + r.w / 2 - (active ? 9 : 4), r.y + r.h - 4, active ? 18 : 8, 3, 1.5);
        g.fill();
      }
      this.hot(r, a.id, { down: a.click });
    });

    // The tray and the clock
    g.strokeStyle = '#2b2b2b';
    g.fillStyle = '#2b2b2b';
    g.lineWidth = 2;
    // ^
    g.beginPath();
    g.moveTo(W - 228, y + 31);
    g.lineTo(W - 222, y + 25);
    g.lineTo(W - 216, y + 31);
    g.stroke();
    // wifi
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.arc(W - 190, y + 36, 5 + k * 5, -Math.PI * 0.75, -Math.PI * 0.25);
      g.stroke();
    }
    // speaker
    g.beginPath();
    g.moveTo(W - 166, y + 24);
    g.lineTo(W - 166, y + 34);
    g.lineTo(W - 161, y + 34);
    g.lineTo(W - 155, y + 39);
    g.lineTo(W - 155, y + 19);
    g.lineTo(W - 161, y + 24);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(W - 152, y + 29, 6, -0.9, 0.9);
    g.stroke();
    this.hot({ x: W - 236, y, w: 96, h: TASK_H }, 'task:tray', { down: () => this.say('Quick settings', 'Wi-Fi, sound and battery are managed by your organization.') });
    const now = new Date();
    g.textAlign = 'right';
    g.font = `400 15px ${FONT}`;
    g.fillStyle = '#1f1f1f';
    g.fillText(now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), W - 18, y + 24);
    g.fillText(now.toLocaleDateString(), W - 18, y + 44);
    g.textAlign = 'left';
  }

  private taskClick(app: AppId): void {
    const w = this.wins.find((o) => o.app === app);
    if (!w) return this.open(app);
    if (!w.min && this.topWin() === w) w.min = true;
    else {
      w.min = false;
      this.focus(w);
    }
  }

  private drawStart(): void {
    const g = this.g;
    const r = { x: W / 2 - 300, y: H - TASK_H - 12 - 540, w: 600, h: 540 };
    shadowBox(g, r, 12, 'rgba(243, 246, 251, 0.98)');
    this.hot(r, 'start:bg');
    // Search
    const s = { x: r.x + 30, y: r.y + 24, w: r.w - 60, h: 40 };
    g.fillStyle = '#ffffff';
    rr(g, s.x, s.y, s.w, s.h, 20);
    g.fill();
    g.strokeStyle = '#d0d4da';
    g.lineWidth = 1;
    g.stroke();
    drawSearch(g, s.x + 24, s.y + 20);
    g.font = `400 16px ${FONT}`;
    g.fillStyle = '#6b6b6b';
    g.fillText('Search for apps, settings, and documents', s.x + 48, s.y + 26);
    this.hot(s, 'start:search', { down: () => this.disabled('Search') });
    g.font = `600 16px ${FONT}`;
    g.fillStyle = '#1f1f1f';
    g.fillText('Pinned', r.x + 46, r.y + 102);

    const pins: { label: string; draw: (cx: number, cy: number) => void; fn: () => void }[] = [
      { label: 'Chrome', draw: (cx, cy) => drawChrome(g, cx, cy, 20), fn: () => this.open('chrome') },
      { label: 'File Explorer', draw: (cx, cy) => drawFolder(g, cx - 20, cy - 15, 40, 31), fn: () => this.open('bin') },
      { label: 'Recycle Bin', draw: (cx, cy) => drawBin(g, cx - 18, cy - 20, 36, this.binItems.length > 0), fn: () => this.open('bin') },
      { label: 'Terms.pdf', draw: (cx, cy) => drawPdf(g, cx - 14, cy - 19, 28, 38), fn: () => this.open('terms') },
      { label: 'Settings', draw: (cx, cy) => drawGear(g, cx, cy, 18), fn: () => this.disabled('Settings') },
      { label: 'Calculator', draw: (cx, cy) => drawTile(g, cx, cy, '#5a5a5a', '='), fn: () => this.say('Calculator', 'Your salary has been calculated. You do not want to see it.') },
      { label: 'Notepad', draw: (cx, cy) => drawTile(g, cx, cy, '#2d7dd2', '✎'), fn: () => this.disabled('Notepad') },
      { label: 'Solitaire', draw: (cx, cy) => drawTile(g, cx, cy, '#1d7a3a', '♠'), fn: () => this.say('Solitaire', 'Games are blocked during work hours. It is your day off. Still blocked.') },
      { label: 'Photos', draw: (cx, cy) => drawTile(g, cx, cy, '#c2447a', '▣'), fn: () => this.disabled('Photos') },
      { label: 'Mail', draw: (cx, cy) => drawTile(g, cx, cy, '#0f62c4', '✉'), fn: () => this.open('mail') },
      { label: 'Camera', draw: (cx, cy) => drawTile(g, cx, cy, '#444', '◉'), fn: () => this.say('Camera', 'The camera is already on. It has been on all day.') },
      { label: 'Store', draw: (cx, cy) => drawTile(g, cx, cy, '#7a4bc2', '🛍'), fn: () => this.disabled('Store') }
    ];
    pins.forEach((p, i) => {
      const c = i % 6;
      const rw = Math.floor(i / 6);
      const pr = { x: r.x + 30 + c * 90, y: r.y + 118 + rw * 96, w: 86, h: 90 };
      const id = 'start:' + p.label;
      if (this.hoverId === id) {
        g.fillStyle = 'rgba(255,255,255,0.95)';
        rr(g, pr.x, pr.y, pr.w, pr.h, 6);
        g.fill();
      }
      p.draw(pr.x + pr.w / 2, pr.y + 34);
      g.font = `400 13px ${FONT}`;
      g.fillStyle = '#1f1f1f';
      g.textAlign = 'center';
      g.fillText(p.label, pr.x + pr.w / 2, pr.y + 76);
      g.textAlign = 'left';
      this.hot(pr, id, {
        down: () => {
          this.startOpen = false;
          p.fn();
        }
      });
    });
    g.font = `600 16px ${FONT}`;
    g.fillStyle = '#1f1f1f';
    g.fillText('Recommended', r.x + 46, r.y + 340);
    [
      ['Terms_and_Conditions_FINAL_v2(3).pdf', 'Opened by Management · 8:00 AM'],
      ['day_off_request.pdf', 'Deleted · Today']
    ].forEach(([n, sub], i) => {
      const rr2 = { x: r.x + 30, y: r.y + 354 + i * 60, w: 300, h: 54 };
      const id = 'start:rec' + i;
      if (this.hoverId === id) {
        g.fillStyle = 'rgba(255,255,255,0.95)';
        rr(g, rr2.x, rr2.y, rr2.w, rr2.h, 6);
        g.fill();
      }
      drawPdf(g, rr2.x + 10, rr2.y + 9, 28, 36);
      g.font = `400 14px ${FONT}`;
      g.fillStyle = '#1f1f1f';
      g.fillText(n, rr2.x + 50, rr2.y + 24);
      g.fillStyle = '#6b6b6b';
      g.font = `400 13px ${FONT}`;
      g.fillText(sub, rr2.x + 50, rr2.y + 42);
      this.hot(rr2, id, { down: () => (i === 0 ? this.open('terms') : this.say('day_off_request.pdf', 'This file is in the Recycle Bin. Somebody put it there.')) });
    });
    // User and power
    g.fillStyle = 'rgba(0,0,0,0.05)';
    g.fillRect(r.x, r.y + r.h - 64, r.w, 64);
    g.fillStyle = '#c47a2c';
    g.beginPath();
    g.arc(r.x + 52, r.y + r.h - 32, 17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `700 17px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('R', r.x + 52, r.y + r.h - 26);
    g.textAlign = 'left';
    g.fillStyle = '#1f1f1f';
    g.font = `400 16px ${FONT}`;
    g.fillText('Ravi', r.x + 80, r.y + r.h - 26);
    const pw = { x: r.x + r.w - 70, y: r.y + r.h - 54, w: 44, h: 44 };
    if (this.hoverId === 'start:power') {
      g.fillStyle = 'rgba(255,255,255,0.95)';
      rr(g, pw.x, pw.y, pw.w, pw.h, 6);
      g.fill();
    }
    g.strokeStyle = '#1f1f1f';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(pw.x + 22, pw.y + 23, 10, -Math.PI * 0.32, Math.PI * 1.32);
    g.stroke();
    g.beginPath();
    g.moveTo(pw.x + 22, pw.y + 9);
    g.lineTo(pw.x + 22, pw.y + 22);
    g.stroke();
    this.hot(pw, 'start:power', {
      down: () => {
        this.startOpen = false;
        this.say('Shut down', "You can't shut down until you've signed the Terms and Conditions.");
      }
    });
  }

  // ---------------------------------------------------------------- windows

  private drawWindow(w: Win): void {
    const g = this.g;
    const r = this.rectOf(w);
    const focused = this.topWin() === w;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = focused ? 30 : 14;
    g.shadowOffsetY = 6;
    g.fillStyle = '#ffffff';
    rr(g, r.x, r.y, r.w, r.h, w.max ? 0 : 9);
    g.fill();
    g.restore();
    g.save();
    rr(g, r.x, r.y, r.w, r.h, w.max ? 0 : 9);
    g.clip();
    this.hot(r, 'win:' + w.app, { win: w });

    // Title bar
    const chrome = w.app === 'chrome';
    g.fillStyle = chrome ? '#dee3ea' : focused ? '#eef1f6' : '#f6f7f9';
    g.fillRect(r.x, r.y, r.w, TITLE_H);
    this.hot({ x: r.x, y: r.y, w: r.w - 140, h: TITLE_H }, 'title:' + w.app, {
      win: w,
      down: () => {
        if (!w.max) this.drag = { win: w, ox: this.mx - w.x, oy: this.my - w.y };
      },
      dbl: () => this.toggleMax(w)
    });
    if (chrome) {
      // A tab
      const tw = 240;
      g.fillStyle = '#ffffff';
      rr(g, r.x + 10, r.y + 6, tw, TITLE_H, 8);
      g.fill();
      drawChrome(g, r.x + 28, r.y + 21, 8);
      g.font = `400 14px ${FONT}`;
      g.fillStyle = '#1f1f1f';
      const t = this.page === 'newtab' ? 'New Tab' : this.page === 'results' ? `${this.query} - Googel Search` : 'Site blocked';
      g.fillText(ellipsize(g, t, tw - 70), r.x + 44, r.y + 26);
      g.fillText('✕', r.x + tw - 14, r.y + 26);
      g.font = `300 22px ${FONT}`;
      g.fillText('+', r.x + tw + 22, r.y + 28);
      this.hot({ x: r.x + tw + 12, y: r.y + 6, w: 30, h: 30 }, 'newtab', {
        win: w,
        down: () => {
          this.history = [];
          this.page = 'newtab';
          this.typed = '';
        }
      });
    } else {
      if (isFile(w.app)) drawFileIcon(g, fileDef(w.app).icon, r.x + 15, r.y + 9, 20);
      else if (w.app === 'terms') drawPdf(g, r.x + 14, r.y + 9, 16, 20);
      else drawBin(g, r.x + 12, r.y + 8, 22, this.binItems.length > 0);
      g.font = `400 14px ${FONT}`;
      g.fillStyle = focused ? '#1f1f1f' : '#777';
      g.fillText(ellipsize(g, isFile(w.app) ? fileDef(w.app).title : TITLES[w.app], r.w - 220), r.x + 44, r.y + 24);
    }
    // ─ □ ✕
    const bx = r.x + r.w - 138;
    const btns: [string, () => void][] = [
      ['min', () => (w.min = true)],
      ['max', () => this.toggleMax(w)],
      ['close', () => this.close(w)]
    ];
    btns.forEach(([b, fn], i) => {
      const br = { x: bx + i * 46, y: r.y, w: 46, h: TITLE_H };
      const id = `${b}:${w.app}`;
      if (this.hoverId === id) {
        g.fillStyle = b === 'close' ? '#c42b1c' : 'rgba(0,0,0,0.07)';
        g.fillRect(br.x, br.y, br.w, br.h);
      }
      g.strokeStyle = this.hoverId === id && b === 'close' ? '#ffffff' : '#1f1f1f';
      g.lineWidth = 1.3;
      const cx = br.x + 23;
      const cy = br.y + 19;
      g.beginPath();
      if (b === 'min') {
        g.moveTo(cx - 6, cy);
        g.lineTo(cx + 6, cy);
      } else if (b === 'max') {
        g.rect(cx - 6, cy - 6, 12, 12);
      } else {
        g.moveTo(cx - 6, cy - 6);
        g.lineTo(cx + 6, cy + 6);
        g.moveTo(cx + 6, cy - 6);
        g.lineTo(cx - 6, cy + 6);
      }
      g.stroke();
      this.hot(br, id, { win: w, down: fn });
    });

    const c = { x: r.x, y: r.y + TITLE_H, w: r.w, h: r.h - TITLE_H };
    if (w.app === 'terms') this.drawTerms(w, c);
    else if (w.app === 'chrome') this.drawChromeApp(w, c);
    else if (w.app === 'bin') this.drawBinApp(w, c);
    else this.viewers.get(w.app)?.draw(this.ctxFor(w), c);
    g.restore();
    if (!w.max) {
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 1;
      rr(g, r.x, r.y, r.w, r.h, 9);
      g.stroke();
    }
  }

  private toggleMax(w: Win): void {
    w.max = !w.max;
    this.drag = null;
  }

  // ------------------------------------------------------------- the Terms

  private docFor(width: number): { c: HTMLCanvasElement; h: number } {
    const k = Math.round(width);
    let d = this.docCache.get(k);
    if (!d) {
      d = renderDocument(k);
      this.docCache.set(k, d);
    }
    return d;
  }

  private drawTerms(w: Win, r: Rect): void {
    const g = this.g;
    const ox = this.shake > 0 ? Math.sin(this.shake * 70) * 8 * (this.shake / 0.4) : 0;
    g.fillStyle = '#e9ecf1';
    g.fillRect(r.x, r.y, r.w, r.h);
    g.save();
    g.translate(ox, 0);
    g.fillStyle = '#1b2a4a';
    g.font = `800 30px ${FONT}`;
    g.fillText('TERMS AND CONDITIONS', r.x + 24, r.y + 46);
    g.font = `400 16px ${FONT}`;
    g.fillStyle = '#5a6578';
    g.fillText('Please read the entire agreement before continuing. Yes, all of it. We can tell.', r.x + 26, r.y + 72);
    const doc = { x: r.x + 22, y: r.y + 88, w: r.w - 64, h: r.h - 88 - 116 };
    const d = this.docFor(doc.w - 10);
    this.maxScroll = Math.max(0, d.h - doc.h);
    if (this.scrollTarget > this.maxScroll) this.scrollTarget = this.maxScroll;
    const pct = this.maxScroll > 0 ? Math.round((Math.min(this.scroll, this.maxScroll) / this.maxScroll) * 100) : 100;
    g.textAlign = 'right';
    g.font = `600 16px ${FONT}`;
    g.fillStyle = this.readToEnd ? '#2f8a4c' : '#5a6578';
    g.fillText(this.readToEnd ? 'READ: 100% ✓' : `READ: ${pct}%`, r.x + r.w - 24, r.y + 46);
    g.textAlign = 'left';

    g.fillStyle = '#ffffff';
    g.fillRect(doc.x, doc.y, doc.w, doc.h);
    g.save();
    g.beginPath();
    g.rect(doc.x, doc.y, doc.w, doc.h);
    g.clip();
    g.drawImage(d.c, doc.x + 6, doc.y - Math.min(this.scroll, this.maxScroll));
    if (!this.readToEnd) {
      const f = g.createLinearGradient(0, doc.y + doc.h - 50, 0, doc.y + doc.h);
      f.addColorStop(0, 'rgba(255,255,255,0)');
      f.addColorStop(1, 'rgba(255,255,255,0.95)');
      g.fillStyle = f;
      g.fillRect(doc.x, doc.y + doc.h - 50, doc.w, 50);
    }
    g.restore();
    g.strokeStyle = '#b8c1d1';
    g.lineWidth = 1.5;
    g.strokeRect(doc.x, doc.y, doc.w, doc.h);
    this.hot(doc, 'doc', { win: w, wheel: (dy) => this.scrollBy(dy) });

    // Scrollbar
    const bar = { x: doc.x + doc.w + 6, y: doc.y, w: 14, h: doc.h };
    const thumbH = Math.max(46, (doc.h / d.h) * bar.h);
    const thumbY = bar.y + (this.maxScroll > 0 ? (Math.min(this.scroll, this.maxScroll) / this.maxScroll) * (bar.h - thumbH) : 0);
    this.termsGeo = { bar, thumbH };
    g.fillStyle = '#d6dbe4';
    rr(g, bar.x, bar.y, bar.w, bar.h, 7);
    g.fill();
    g.fillStyle = this.barDrag ? '#3d5f95' : this.hoverId === 'thumb' ? '#6f84a8' : '#8f9cb4';
    rr(g, bar.x + 1, thumbY, bar.w - 2, thumbH, 6);
    g.fill();
    this.hot({ x: bar.x - 4, y: bar.y, w: bar.w + 8, h: bar.h }, 'track', {
      win: w,
      wheel: (dy) => this.scrollBy(dy),
      down: () => this.scrollBy(this.my < thumbY ? -doc.h * 0.85 : doc.h * 0.85)
    });
    this.hot({ x: bar.x - 4, y: thumbY, w: bar.w + 8, h: thumbH }, 'thumb', {
      win: w,
      wheel: (dy) => this.scrollBy(dy),
      down: () => (this.barDrag = { off: this.my - thumbY })
    });

    // The checkbox and the buttons
    const enabled = this.readToEnd;
    const ck = { x: r.x + 26, y: doc.y + doc.h + 16, s: 28 };
    g.fillStyle = enabled ? '#ffffff' : '#dfe3e9';
    rr(g, ck.x, ck.y, ck.s, ck.s, 5);
    g.fill();
    g.strokeStyle = this.hoverId === 'check' && enabled ? '#2b4c7e' : enabled ? '#6b778c' : '#b3bac6';
    g.lineWidth = 2.5;
    g.stroke();
    if (this.checked) {
      g.strokeStyle = '#2f8a4c';
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(ck.x + 6, ck.y + 15);
      g.lineTo(ck.x + 12, ck.y + 22);
      g.lineTo(ck.x + 23, ck.y + 6);
      g.stroke();
      g.lineCap = 'butt';
    }
    g.font = `600 21px ${FONT}`;
    g.fillStyle = enabled ? '#1b2a4a' : '#9aa3b2';
    g.fillText('I agree to the Terms and Conditions', ck.x + ck.s + 14, ck.y + 22);
    if (!enabled) {
      g.font = `italic 400 16px ${FONT}`;
      g.fillText('(scroll to the bottom first)', ck.x + ck.s + 372, ck.y + 21);
    }
    this.hot({ x: ck.x - 6, y: ck.y - 6, w: 600, h: ck.s + 12 }, 'check', {
      win: w,
      down: () => {
        if (this.accepted) return;
        if (!this.readToEnd) {
          this.shake = 0.4;
          this.termsSay('Nice try, Ravi. Scroll to the bottom and actually read it.');
        } else this.checked = !this.checked;
      }
    });

    const agree = { x: r.x + r.w - 24 - 190, y: doc.y + doc.h + 60, w: 190, h: 44 };
    const decline = { x: agree.x - 206, y: agree.y, w: 190, h: 44 };
    const signed = this.accepted && this.acceptT >= 1.1;
    this.button(decline, 'DECLINE', false, this.hoverId === 'decline' && !this.accepted);
    this.button(agree, signed ? 'SIGNED ✓' : 'I AGREE', this.checked, this.hoverId === 'agree' && this.checked && !this.accepted);
    this.hot(decline, 'decline', {
      win: w,
      down: () => {
        this.declines++;
        this.termsSay(
          [
            'Declining is not available on your current plan.',
            'Your request to decline has been declined.',
            'Ravi. Please.',
            'We have forwarded your complaint to the shredder.'
          ][(this.declines - 1) % 4]
        );
      }
    });
    this.hot(agree, 'agree', {
      win: w,
      down: () => {
        if (this.checked) this.accept();
        else {
          this.shake = 0.3;
          this.termsSay(this.readToEnd ? 'You have to tick the box first.' : 'You have to read it first. All of it.');
        }
      }
    });

    if (this.termsMsgT > 0 && !this.accepted) {
      g.globalAlpha = Math.min(1, this.termsMsgT * 3);
      g.font = `600 17px ${FONT}`;
      const tw = Math.min(g.measureText(this.termsMsg).width + 32, decline.x - r.x - 40);
      g.fillStyle = '#fff4cf';
      rr(g, r.x + 24, agree.y + 4, tw, 36, 8);
      g.fill();
      g.strokeStyle = '#d9b44a';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#5b4510';
      g.fillText(ellipsize(g, this.termsMsg, tw - 28), r.x + 40, agree.y + 28);
      g.globalAlpha = 1;
    }
    // Signed: a stamp across the bottom of the agreement, and it stays there
    if (signed) {
      g.save();
      g.translate(doc.x + doc.w - 190, doc.y + doc.h - 80);
      g.rotate(-0.16);
      g.globalAlpha = Math.min(1, (this.acceptT - 1.1) * 4) * 0.85;
      g.strokeStyle = '#c0392b';
      g.fillStyle = '#c0392b';
      g.lineWidth = 5;
      rr(g, -150, -42, 300, 84, 10);
      g.stroke();
      g.font = `900 40px ${FONT}`;
      g.textAlign = 'center';
      g.fillText('SIGNED', 0, 4);
      g.font = `700 15px ${FONT}`;
      g.fillText('RAVI · NO TAKE-BACKS', 0, 30);
      g.textAlign = 'left';
      g.restore();
    }
    g.restore();
  }

  private button(r: Rect, label: string, primary: boolean, hot: boolean): void {
    const g = this.g;
    g.fillStyle = primary ? (hot ? '#2e9a55' : '#2f8a4c') : hot ? '#d6dbe4' : '#e3e7ee';
    rr(g, r.x, r.y, r.w, r.h, 8);
    g.fill();
    g.strokeStyle = primary ? '#1f6a37' : '#a9b2c2';
    g.lineWidth = 2;
    g.stroke();
    g.font = `700 20px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = primary ? '#ffffff' : label === 'I AGREE' ? '#a0a8b6' : '#4b5466';
    g.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 7);
    g.textAlign = 'left';
  }

  /** After I AGREE: a progress bar, then a thank-you, over the whole screen. */
  private drawAccepting(): void {
    const g = this.g;
    const t = this.acceptT;
    const fade = t > 2.2 ? 1 - (t - 2.2) / 0.4 : 1;
    g.globalAlpha = Math.max(0, fade);
    g.fillStyle = 'rgba(10, 20, 40, 0.5)';
    g.fillRect(0, 0, W, H);
    const bw = 600;
    const bh = 200;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;
    shadowBox(g, { x: bx, y: by, w: bw, h: bh }, 12, '#eef1f6');
    g.textAlign = 'center';
    if (t < 1.1) {
      g.font = `700 25px ${FONT}`;
      g.fillStyle = '#1b2a4a';
      g.fillText('Processing your signature…', W / 2, by + 70);
      g.fillStyle = '#d3d9e3';
      rr(g, bx + 60, by + 108, bw - 120, 24, 12);
      g.fill();
      g.fillStyle = '#2f8a4c';
      rr(g, bx + 60, by + 108, Math.max(24, (bw - 120) * Math.min(1, t / 1.0)), 24, 12);
      g.fill();
    } else {
      g.font = `800 29px ${FONT}`;
      g.fillStyle = '#2f8a4c';
      g.fillText('✓  AGREEMENT ACCEPTED', W / 2, by + 76);
      g.font = `400 20px ${FONT}`;
      g.fillStyle = '#2b313b';
      g.fillText('Thank you, Ravi. Enjoy your day off.', W / 2, by + 120);
      g.font = `italic 400 15px ${FONT}`;
      g.fillStyle = '#7b8494';
      g.fillText('(Day off subject to Section 7.)', W / 2, by + 156);
    }
    g.textAlign = 'left';
    g.globalAlpha = 1;
  }

  // ----------------------------------------------------------------- Chrome

  private drawChromeApp(w: Win, r: Rect): void {
    const g = this.g;
    // Toolbar
    g.fillStyle = '#ffffff';
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#e3e6ea';
    g.fillRect(r.x, r.y + 46, r.w, 1);
    const canBack = this.history.length > 0;
    g.strokeStyle = canBack ? '#3c4043' : '#c4c7ca';
    g.lineWidth = 2;
    // ←
    g.beginPath();
    g.moveTo(r.x + 30, r.y + 23);
    g.lineTo(r.x + 16, r.y + 23);
    g.moveTo(r.x + 22, r.y + 17);
    g.lineTo(r.x + 16, r.y + 23);
    g.lineTo(r.x + 22, r.y + 29);
    g.stroke();
    this.hot({ x: r.x + 8, y: r.y + 8, w: 30, h: 30 }, 'back', {
      win: w,
      down: () => {
        const p = this.history.pop();
        if (p) this.page = p;
      }
    });
    // →
    g.strokeStyle = '#c4c7ca';
    g.beginPath();
    g.moveTo(r.x + 46, r.y + 23);
    g.lineTo(r.x + 60, r.y + 23);
    g.moveTo(r.x + 54, r.y + 17);
    g.lineTo(r.x + 60, r.y + 23);
    g.lineTo(r.x + 54, r.y + 29);
    g.stroke();
    // ⟳
    g.strokeStyle = '#3c4043';
    g.beginPath();
    g.arc(r.x + 88, r.y + 23, 7, -0.3, Math.PI * 1.6);
    g.stroke();
    this.hot({ x: r.x + 74, y: r.y + 8, w: 30, h: 30 }, 'reload', { win: w, down: () => (this.flash = 0.12) });
    // The omnibox
    const om = { x: r.x + 114, y: r.y + 7, w: r.w - 180, h: 32 };
    g.fillStyle = this.typing ? '#ffffff' : '#f1f3f4';
    rr(g, om.x, om.y, om.w, om.h, 16);
    g.fill();
    if (this.typing) {
      g.strokeStyle = '#1a73e8';
      g.lineWidth = 2;
      g.stroke();
    }
    g.font = `400 15px ${FONT}`;
    const shown = this.typing
      ? this.typed
      : this.page === 'newtab'
        ? ''
        : this.page === 'results'
          ? `googel.com/search?q=${this.query}`
          : this.blockedUrl;
    g.fillStyle = shown ? '#202124' : '#5f6368';
    g.fillText(ellipsize(g, shown || 'Search Googel or type a URL', om.w - 50), om.x + 18, om.y + 21);
    if (this.typing && Math.floor(this.time * 2) % 2 === 0) {
      const cx = om.x + 18 + g.measureText(this.typed).width + 1;
      g.fillStyle = '#202124';
      g.fillRect(cx, om.y + 8, 1.5, 17);
    }
    this.hot(om, 'omni', { win: w, down: () => this.startTyping() });
    // Profile
    g.fillStyle = '#c47a2c';
    g.beginPath();
    g.arc(r.x + r.w - 34, r.y + 23, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `700 14px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('R', r.x + r.w - 34, r.y + 28);
    g.textAlign = 'left';

    const p = { x: r.x, y: r.y + 47, w: r.w, h: r.h - 47 };
    if (this.page === 'newtab') this.drawNewTab(w, p);
    else if (this.page === 'results') this.drawResults(w, p);
    else this.drawBlocked(w, p);
  }

  private startTyping(): void {
    this.typing = true;
    this.typed = '';
  }

  private googleLogo(x: number, y: number, size: number): void {
    const g = this.g;
    g.font = `500 ${size}px "Product Sans", ${FONT}`;
    const letters: [string, string][] = [
      ['G', '#4285f4'],
      ['o', '#ea4335'],
      ['o', '#fbbc05'],
      ['g', '#4285f4'],
      ['e', '#ea4335'],
      ['l', '#34a853']
    ];
    const total = letters.reduce((s, [l]) => s + g.measureText(l).width, 0);
    let cx = x - total / 2;
    for (const [l, c] of letters) {
      g.fillStyle = c;
      g.fillText(l, cx, y);
      cx += g.measureText(l).width;
    }
  }

  private drawNewTab(w: Win, p: Rect): void {
    const g = this.g;
    const cx = p.x + p.w / 2;
    const y0 = p.y + p.h * 0.3;
    this.googleLogo(cx, y0, 72);
    const sb = { x: cx - 280, y: y0 + 30, w: 560, h: 46 };
    g.fillStyle = '#ffffff';
    rr(g, sb.x, sb.y, sb.w, sb.h, 23);
    g.fill();
    g.strokeStyle = this.typing ? '#1a73e8' : '#dfe1e5';
    g.lineWidth = this.typing ? 2 : 1;
    g.stroke();
    drawSearch(g, sb.x + 26, sb.y + 23);
    g.font = `400 16px ${FONT}`;
    g.fillStyle = this.typing && this.typed ? '#202124' : '#70757a';
    g.fillText(this.typing ? this.typed : 'Search Googel or type a URL', sb.x + 50, sb.y + 29);
    if (this.typing && Math.floor(this.time * 2) % 2 === 0) {
      g.fillStyle = '#202124';
      g.fillRect(sb.x + 50 + g.measureText(this.typed).width + 1, sb.y + 13, 1.5, 20);
    }
    this.hot(sb, 'gsearch', { win: w, down: () => this.startTyping() });
    // Shortcuts
    const tiles: [string, string, string, () => void][] = [
      ['RaviCorp Portal', 'R', '#2b4c7e', () => this.open('terms')],
      ['Curry Express', 'C', '#d9771c', () => this.block('curryexpress.com/order')],
      ['Job Search', 'J', '#0a66c2', () => this.block('jobs.example.com/anything-else')],
      ['Add shortcut', '+', '#5f6368', () => this.disabled('Add shortcut')]
    ];
    tiles.forEach(([label, ch, col, fn], i) => {
      const tr = { x: cx - 2 * 112 + i * 112 + 4, y: sb.y + 86, w: 104, h: 104 };
      const id = 'tile:' + label;
      if (this.hoverId === id) {
        g.fillStyle = '#f1f3f4';
        rr(g, tr.x, tr.y, tr.w, tr.h, 8);
        g.fill();
      }
      g.fillStyle = '#f1f3f4';
      g.beginPath();
      g.arc(tr.x + tr.w / 2, tr.y + 38, 24, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = col;
      g.font = `700 22px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(ch, tr.x + tr.w / 2, tr.y + 46);
      g.font = `400 13px ${FONT}`;
      g.fillStyle = '#202124';
      g.fillText(label, tr.x + tr.w / 2, tr.y + 88);
      g.textAlign = 'left';
      this.hot(tr, id, { win: w, down: fn });
    });
  }

  private drawResults(w: Win, p: Rect): void {
    const g = this.g;
    this.googleLogo(p.x + 70, p.y + 46, 30);
    const sb = { x: p.x + 130, y: p.y + 20, w: Math.min(560, p.w - 160), h: 40 };
    g.fillStyle = '#ffffff';
    rr(g, sb.x, sb.y, sb.w, sb.h, 20);
    g.fill();
    g.strokeStyle = '#dfe1e5';
    g.lineWidth = 1;
    g.stroke();
    g.font = `400 16px ${FONT}`;
    g.fillStyle = '#202124';
    g.fillText(ellipsize(g, this.typing ? this.typed : this.query, sb.w - 40), sb.x + 20, sb.y + 26);
    this.hot(sb, 'gsearch', { win: w, down: () => this.startTyping() });
    g.fillStyle = '#ebebeb';
    g.fillRect(p.x, p.y + 76, p.w, 1);
    g.font = `400 14px ${FONT}`;
    g.fillStyle = '#70757a';
    g.fillText('About 3 results (0.42 seconds) · Filtered by your organization', p.x + 130, p.y + 104);
    const q = this.query;
    const results: [string, string, string, () => void][] = [
      [
        'RaviCorp Employee Terms and Conditions — Sign Now',
        'portal.ravicorp.internal › terms',
        'You have not signed the Terms and Conditions. Your day off cannot begin until you do. Click here to open them.',
        () => this.open('terms')
      ],
      [`${q} - Wikipedia`, 'en.wikipedia.org › wiki', `"${q}" is a topic you could be reading about if you had signed the Terms and Conditions.`, () => this.block('en.wikipedia.org/wiki/' + q.replace(/\s+/g, '_'))],
      [
        'Can my boss make me sign things on my day off? : r/antiwork',
        'reddit.com › r › antiwork',
        'Yes. 1.2k comments. Top comment: "just sign it bro"',
        () => this.block('reddit.com/r/antiwork')
      ]
    ];
    results.forEach(([title, url, snip, fn], i) => {
      const y = p.y + 140 + i * 110;
      const rr2 = { x: p.x + 126, y: y - 4, w: Math.min(640, p.w - 160), h: 96 };
      const id = 'res:' + i;
      g.font = `400 14px ${FONT}`;
      g.fillStyle = '#202124';
      g.fillText(url, p.x + 130, y + 14);
      g.font = `400 21px ${FONT}`;
      g.fillStyle = '#1a0dab';
      g.fillText(ellipsize(g, title, rr2.w), p.x + 130, y + 42);
      if (this.hoverId === id) g.fillRect(p.x + 130, y + 45, Math.min(g.measureText(title).width, rr2.w), 1.5);
      g.font = `400 15px ${FONT}`;
      g.fillStyle = '#4d5156';
      wrapText(g, snip, rr2.w)
        .slice(0, 2)
        .forEach((l, k) => g.fillText(l, p.x + 130, y + 66 + k * 20));
      this.hot(rr2, id, { win: w, down: fn });
    });
  }

  private drawBlocked(w: Win, p: Rect): void {
    const g = this.g;
    g.fillStyle = '#f8f9fa';
    g.fillRect(p.x, p.y, p.w, p.h);
    const x = p.x + Math.max(40, p.w / 2 - 300);
    const y = p.y + p.h * 0.22;
    // A padlock
    g.fillStyle = '#5f6368';
    rr(g, x, y + 22, 52, 40, 6);
    g.fill();
    g.strokeStyle = '#5f6368';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(x + 26, y + 22, 15, Math.PI, 0);
    g.stroke();
    g.font = `400 28px ${FONT}`;
    g.fillStyle = '#202124';
    g.fillText('This site is blocked', x, y + 110);
    g.font = `400 16px ${FONT}`;
    g.fillStyle = '#5f6368';
    g.fillText(ellipsize(g, `Your organization doesn't allow you to view ${this.blockedUrl}`, 600), x, y + 144);
    g.fillText('Reason: it is not the Terms and Conditions.', x, y + 170);
    g.font = `400 13px ${FONT}`;
    g.fillText('ERR_BLOCKED_BY_ADMINISTRATOR', x, y + 204);
    const b = { x, y: y + 226, w: 260, h: 40 };
    g.fillStyle = this.hoverId === 'blk' ? '#1765cc' : '#1a73e8';
    rr(g, b.x, b.y, b.w, b.h, 6);
    g.fill();
    g.font = `600 15px ${FONT}`;
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.fillText('Open Terms and Conditions', b.x + b.w / 2, b.y + 26);
    g.textAlign = 'left';
    this.hot(b, 'blk', { win: w, down: () => this.open('terms') });
  }

  // ------------------------------------------------------------ Recycle Bin

  private drawBinApp(w: Win, r: Rect): void {
    const g = this.g;
    g.fillStyle = '#ffffff';
    g.fillRect(r.x, r.y, r.w, r.h);
    // Command bar
    g.fillStyle = '#f7f9fc';
    g.fillRect(r.x, r.y, r.w, 46);
    g.fillStyle = '#e5e8ec';
    g.fillRect(r.x, r.y + 46, r.w, 1);
    const cmds: [string, () => void][] = [
      [
        'Empty Recycle Bin',
        () => {
          if (!this.binItems.length) return this.say('Recycle Bin', 'The Recycle Bin is already empty.');
          this.dialog = {
            title: 'Delete Multiple Items',
            text: `Are you sure you want to permanently delete these ${this.binItems.length} items?`,
            buttons: [
              {
                label: 'Yes',
                fn: () => {
                  this.binItems = [];
                  this.binSel = -1;
                  this.audio.osDing();
                }
              },
              { label: 'No', fn: () => {} }
            ]
          };
        }
      ],
      ['Restore all items', () => this.say('Restore failed', 'Management deleted these on purpose. They are staying deleted.')]
    ];
    let cx = r.x + 14;
    g.font = `400 15px ${FONT}`;
    for (const [label, fn] of cmds) {
      const tw = g.measureText(label).width + 28;
      const br = { x: cx, y: r.y + 7, w: tw, h: 32 };
      const id = 'bincmd:' + label;
      if (this.hoverId === id) {
        g.fillStyle = '#e8edf4';
        rr(g, br.x, br.y, br.w, br.h, 5);
        g.fill();
      }
      g.fillStyle = this.binItems.length || label !== 'Empty Recycle Bin' ? '#1f1f1f' : '#9a9a9a';
      g.fillText(label, br.x + 14, br.y + 21);
      this.hot(br, id, { win: w, down: fn });
      cx += tw + 8;
    }
    // Nav pane
    const navW = 170;
    g.fillStyle = '#fafbfc';
    g.fillRect(r.x, r.y + 47, navW, r.h - 47 - 26);
    ['Home', 'Gallery', 'Desktop', 'Documents', 'Downloads', 'Pictures', 'Recycle Bin'].forEach((n, i) => {
      const y = r.y + 60 + i * 34;
      if (n === 'Recycle Bin') {
        g.fillStyle = '#dde7f5';
        rr(g, r.x + 8, y, navW - 16, 30, 5);
        g.fill();
      }
      if (n === 'Recycle Bin') drawBin(g, r.x + 18, y + 5, 20, this.binItems.length > 0);
      else drawFolder(g, r.x + 18, y + 8, 20, 15);
      g.font = `400 14px ${FONT}`;
      g.fillStyle = '#1f1f1f';
      g.fillText(n, r.x + 48, y + 20);
      if (n !== 'Recycle Bin') this.hot({ x: r.x + 8, y, w: navW - 16, h: 30 }, 'nav:' + n, { win: w, down: () => this.say(n, 'Access denied. This folder is under review by HR.') });
    });
    // List
    const lx = r.x + navW + 12;
    const cols = [lx, lx + Math.max(260, (r.w - navW) * 0.5), lx + Math.max(420, (r.w - navW) * 0.76)];
    g.font = `400 13px ${FONT}`;
    g.fillStyle = '#5f6368';
    ['Name', 'Original location', 'Date deleted'].forEach((h, i) => g.fillText(h, cols[i] + 26 * (i === 0 ? 1 : 0), r.y + 70));
    g.fillStyle = '#ececec';
    g.fillRect(lx, r.y + 78, r.w - navW - 24, 1);
    if (!this.binItems.length) {
      g.font = `400 15px ${FONT}`;
      g.fillStyle = '#6b6b6b';
      g.fillText('This folder is empty.', lx + 200, r.y + 160);
    }
    this.binItems.forEach(([name, loc, date], i) => {
      const y = r.y + 84 + i * 32;
      const rowR = { x: lx - 4, y, w: r.w - navW - 20, h: 30 };
      const id = 'row:' + i;
      if (this.binSel === i || this.hoverId === id) {
        g.fillStyle = this.binSel === i ? '#cce4f7' : '#eef4fb';
        g.fillRect(rowR.x, rowR.y, rowR.w, rowR.h);
      }
      drawDocIcon(g, lx, y + 5, name.endsWith('.png') ? '#c2447a' : name.endsWith('.pdf') ? '#d93025' : name.endsWith('.txt') ? '#6b6b6b' : '#2b579a');
      g.font = `400 14px ${FONT}`;
      g.fillStyle = '#1f1f1f';
      g.fillText(ellipsize(g, name, cols[1] - lx - 36), lx + 26, y + 20);
      g.fillStyle = '#5f6368';
      g.fillText(ellipsize(g, loc, cols[2] - cols[1] - 12), cols[1], y + 20);
      g.fillText(date, cols[2], y + 20);
      this.hot(rowR, id, {
        win: w,
        down: () => (this.binSel = i),
        dbl: () => this.say(name, 'This item is in the Recycle Bin. Restore it to open it. (You can\'t restore it.)')
      });
    });
    // Status bar
    g.fillStyle = '#f7f9fc';
    g.fillRect(r.x, r.y + r.h - 26, r.w, 26);
    g.font = `400 13px ${FONT}`;
    g.fillStyle = '#5f6368';
    g.fillText(`${this.binItems.length} item${this.binItems.length === 1 ? '' : 's'}${this.binSel >= 0 ? '   1 item selected' : ''}`, r.x + 14, r.y + r.h - 8);
  }

  // ----------------------------------------------------------- the pointer

  /**
   * The pointer: a bowl of curry, steam coming off it, with a spoon in it
   * whose handle is the pointy end — the hotspot is the tip of the handle.
   */
  private drawCurry(x: number, y: number): void {
    const g = this.g;
    g.save();
    g.translate(x, y);
    g.scale(0.62, 0.62);
    const bx = 38;
    const by = 46;
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.ellipse(bx + 4, by + 30, 34, 9, 0, 0, Math.PI * 2);
    g.fill();
    const body = g.createLinearGradient(bx - 36, 0, bx + 36, 0);
    body.addColorStop(0, '#e9e2d4');
    body.addColorStop(0.45, '#ffffff');
    body.addColorStop(1, '#bfb5a2');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(bx - 36, by);
    g.bezierCurveTo(bx - 34, by + 30, bx + 34, by + 30, bx + 36, by);
    g.closePath();
    g.fill();
    g.strokeStyle = '#2f5d9e';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(bx - 33, by + 9);
    g.bezierCurveTo(bx - 26, by + 21, bx + 26, by + 21, bx + 33, by + 9);
    g.stroke();
    g.fillStyle = '#cfc6b4';
    g.fillRect(bx - 12, by + 22, 24, 5);
    g.fillStyle = '#f4efe6';
    g.beginPath();
    g.ellipse(bx, by, 37, 11, 0, 0, Math.PI * 2);
    g.fill();
    const curry = g.createRadialGradient(bx - 6, by - 3, 2, bx, by, 34);
    curry.addColorStop(0, '#f2a93b');
    curry.addColorStop(0.7, '#d9771c');
    curry.addColorStop(1, '#a8510f');
    g.fillStyle = curry;
    g.beginPath();
    g.ellipse(bx, by + 1, 32, 8.5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fbf8f0';
    g.beginPath();
    g.ellipse(bx + 14, by - 1, 12, 5, 0.1, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8d3f0d';
    for (const [dx, dy] of [
      [-14, 2],
      [-4, -2],
      [-20, -1],
      [2, 3]
    ]) {
      g.beginPath();
      g.ellipse(bx + dx, by + dy, 3.6, 2.2, 0.4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#3f9a3a';
    g.beginPath();
    g.ellipse(bx - 9, by - 3, 3.5, 1.8, -0.6, 0, Math.PI * 2);
    g.fill();
    g.lineCap = 'round';
    g.strokeStyle = '#8b939e';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(1, 1);
    g.lineTo(bx - 12, by - 6);
    g.stroke();
    g.strokeStyle = '#dfe4ea';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(1, 1);
    g.lineTo(bx - 12, by - 6);
    g.stroke();
    g.lineCap = 'butt';
    g.fillStyle = '#1b2a4a';
    g.beginPath();
    g.arc(1, 1, 3.2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 2.6;
    for (let i = 0; i < 3; i++) {
      const sx = bx - 12 + i * 12;
      const ph = this.time * 3 + i * 1.7;
      g.globalAlpha = 0.45 + 0.35 * Math.sin(ph);
      g.beginPath();
      g.moveTo(sx, by - 10);
      g.bezierCurveTo(sx + 6 * Math.sin(ph), by - 18, sx - 6 * Math.sin(ph + 1), by - 26, sx + 3 * Math.sin(ph + 2), by - 34);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();
  }
}

// ================================================================ helpers

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function shadowBox(g: CanvasRenderingContext2D, r: Rect, rad: number, fill: string): void {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.3)';
  g.shadowBlur = 24;
  g.shadowOffsetY = 6;
  g.fillStyle = fill;
  rr(g, r.x, r.y, r.w, r.h, rad);
  g.fill();
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 1;
  rr(g, r.x, r.y, r.w, r.h, rad);
  g.stroke();
}

function wrapText(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (g.measureText(t).width > max && line) {
      lines.push(line);
      line = word;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function ellipsize(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

/** The Chrome mark: three sectors round a white ring and a blue centre. */
function drawChrome(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const sectors: [number, number, string][] = [
    [-150, -30, '#db4437'],
    [-30, 90, '#f4c20d'],
    [90, 210, '#0f9d58']
  ];
  for (const [a0, a1, c] of sectors) {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, r, (a0 * Math.PI) / 180, (a1 * Math.PI) / 180);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#4285f4';
  g.beginPath();
  g.arc(cx, cy, r * 0.39, 0, Math.PI * 2);
  g.fill();
}

/** A see-through mesh bin, crumpled paper in it when there's something to empty. */
function drawBin(g: CanvasRenderingContext2D, x: number, y: number, s: number, full: boolean): void {
  const top = y + s * 0.18;
  const bot = y + s;
  if (full) {
    g.fillStyle = '#f2f2f2';
    for (const [dx, dy, rr2] of [
      [0.36, 0.2, 0.15],
      [0.6, 0.16, 0.14],
      [0.48, 0.08, 0.12]
    ]) {
      g.beginPath();
      g.arc(x + s * dx, y + s * dy, s * rr2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#b8b8b8';
      g.lineWidth = 1;
      g.stroke();
    }
  }
  const grd = g.createLinearGradient(x, 0, x + s, 0);
  grd.addColorStop(0, 'rgba(170, 200, 230, 0.75)');
  grd.addColorStop(0.5, 'rgba(235, 245, 255, 0.85)');
  grd.addColorStop(1, 'rgba(150, 180, 215, 0.75)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(x + s * 0.12, top);
  g.lineTo(x + s * 0.88, top);
  g.lineTo(x + s * 0.78, bot);
  g.lineTo(x + s * 0.22, bot);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(70, 100, 140, 0.9)';
  g.lineWidth = Math.max(1, s / 30);
  g.stroke();
  g.strokeStyle = 'rgba(70, 100, 140, 0.45)';
  for (let i = 1; i < 5; i++) {
    const u = i / 5;
    g.beginPath();
    g.moveTo(x + s * (0.12 + 0.76 * u), top);
    g.lineTo(x + s * (0.22 + 0.56 * u), bot);
    g.stroke();
  }
  g.beginPath();
  g.ellipse(x + s / 2, top, s * 0.38, s * 0.06, 0, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(70, 100, 140, 0.9)';
  g.stroke();
}

function drawPdf(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const f = w * 0.3;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w - f, y);
  g.lineTo(x + w, y + f);
  g.lineTo(x + w, y + h);
  g.lineTo(x, y + h);
  g.closePath();
  g.fill();
  g.strokeStyle = '#9a9a9a';
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = '#d6d6d6';
  g.beginPath();
  g.moveTo(x + w - f, y);
  g.lineTo(x + w - f, y + f);
  g.lineTo(x + w, y + f);
  g.closePath();
  g.fill();
  g.fillStyle = '#d93025';
  g.fillRect(x - w * 0.08, y + h * 0.55, w * 0.78, h * 0.26);
  g.fillStyle = '#ffffff';
  g.font = `800 ${Math.round(h * 0.2)}px ${FONT}`;
  g.fillText('PDF', x + w * 0.02, y + h * 0.76);
}

function drawFolder(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = '#e8a93a';
  rr(g, x, y, w * 0.45, h * 0.3, 2);
  g.fill();
  g.fillStyle = '#f7c64e';
  rr(g, x, y + h * 0.18, w, h * 0.82, 3);
  g.fill();
}

function drawDocIcon(g: CanvasRenderingContext2D, x: number, y: number, col: string): void {
  g.fillStyle = '#ffffff';
  g.fillRect(x, y, 16, 20);
  g.strokeStyle = '#9a9a9a';
  g.lineWidth = 1;
  g.strokeRect(x, y, 16, 20);
  g.fillStyle = col;
  g.fillRect(x - 2, y + 9, 12, 7);
}

function drawWinLogo(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const q = s / 2 - 1;
  const grd = g.createLinearGradient(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2);
  grd.addColorStop(0, '#3fa9f5');
  grd.addColorStop(1, '#0a5fd0');
  g.fillStyle = grd;
  g.fillRect(cx - s / 2, cy - s / 2, q, q);
  g.fillRect(cx + 1, cy - s / 2, q, q);
  g.fillRect(cx - s / 2, cy + 1, q, q);
  g.fillRect(cx + 1, cy + 1, q, q);
}

function drawSearch(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  g.strokeStyle = '#3c4043';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx - 2, cy - 2, 7, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(cx + 3, cy + 3);
  g.lineTo(cx + 8, cy + 8);
  g.stroke();
}

function drawGear(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.fillStyle = '#5f6368';
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rad = i % 2 ? r : r * 0.78;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
  g.fill();
}

function drawTile(g: CanvasRenderingContext2D, cx: number, cy: number, col: string, ch: string): void {
  g.fillStyle = col;
  rr(g, cx - 19, cy - 19, 38, 38, 8);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = `700 20px ${FONT}`;
  g.textAlign = 'center';
  g.fillText(ch, cx, cy + 7);
  g.textAlign = 'left';
}

/** The whole agreement, word-wrapped once onto a tall canvas `w` wide. */
function renderDocument(w: number): { c: HTMLCanvasElement; h: number } {
  const c = document.createElement('canvas');
  const pad = 22;
  const measure = c.getContext('2d')!;
  const wrap = (text: string, font: string, max: number): string[] => {
    measure.font = font;
    return wrapText(measure, text, max);
  };
  const fH = `700 23px ${FONT}`;
  const fP = `400 20px ${FONT}`;
  const fS = `italic 400 15px ${FONT}`;
  const fK = `700 17px ${FONT}`;
  const KEY_COL = 210;
  type Op = (g: CanvasRenderingContext2D, y: number) => void;
  const ops: { y: number; op: Op }[] = [];
  let y = pad;
  for (const b of DOCUMENT) {
    if ('h' in b) {
      y += 16;
      ops.push({
        y,
        op: (g, yy) => {
          g.font = fH;
          g.fillStyle = '#1b2a4a';
          g.fillText(b.h, pad, yy + 24);
          g.fillStyle = '#c9d2e3';
          g.fillRect(pad, yy + 33, w - pad * 2, 2);
        }
      });
      y += 46;
    } else if ('p' in b) {
      const font = b.small ? fS : fP;
      const lh = b.small ? 21 : 28;
      const lines = wrap(b.p, font, w - pad * 2);
      ops.push({
        y,
        op: (g, yy) => {
          g.font = font;
          g.fillStyle = b.small ? '#7b8494' : '#2b313b';
          lines.forEach((l, i) => g.fillText(l, pad, yy + 21 + i * lh));
        }
      });
      y += lines.length * lh + 12;
    } else {
      const lines = wrap(b.t, fP, w - pad * 2 - KEY_COL);
      ops.push({
        y,
        op: (g, yy) => {
          g.font = fK;
          let kx = pad;
          let ky = yy;
          for (const k of b.k) {
            const kw = Math.max(32, g.measureText(k).width + 18);
            if (kx + kw > pad + KEY_COL - 8) {
              kx = pad;
              ky += 36;
            }
            g.fillStyle = '#9aa6bb';
            rr(g, kx, ky + 3, kw, 30, 6);
            g.fill();
            g.fillStyle = '#f4f6fa';
            rr(g, kx, ky, kw, 29, 6);
            g.fill();
            g.strokeStyle = '#8692a8';
            g.lineWidth = 1.5;
            g.stroke();
            g.fillStyle = '#1b2a4a';
            g.textAlign = 'center';
            g.fillText(k, kx + kw / 2, ky + 21);
            g.textAlign = 'left';
            kx += kw + 6;
          }
          g.font = fP;
          g.fillStyle = '#2b313b';
          lines.forEach((l, i) => g.fillText(l, pad + KEY_COL, yy + 21 + i * 28));
        }
      });
      y += Math.max(lines.length * 28, 36) + 12;
    }
  }
  y += pad + 10;
  c.width = w;
  c.height = y;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, y);
  for (const o of ops) o.op(g, o.y);
  return { c, h: y };
}
