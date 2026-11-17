import * as THREE from 'three';
import type { AudioManager } from '../core/AudioManager';

/**
 * The Terms and Conditions on Ravi's monitor, at the very top of the game:
 * a live canvas on the screen in the office, a bowl of curry for a mouse
 * pointer, a document to scroll through (the controls are in the clauses),
 * a checkbox that won't tick until he's read to the bottom, and I AGREE.
 *
 * The mouse is the real one, hit-tested against the monitor in the world:
 * a ray from the camera through the pointer onto the face of the screen.
 */

const W = 1200;
const H = 800;

// ---- Layout (canvas pixels)
const TITLE_H = 40;
const DOC = { x: 40, y: 150, w: 1100, h: 476 };
const BAR = { x: DOC.x + DOC.w + 6, y: DOC.y, w: 14, h: DOC.h };
const FOOT_Y = DOC.y + DOC.h + 16;
const CHECK = { x: 48, y: FOOT_Y + 14, s: 30 };
const AGREE = { x: 930, y: FOOT_Y + 64, w: 210, h: 52 };
const DECLINE = { x: 700, y: FOOT_Y + 64, w: 210, h: 52 };

type Block =
  | { h: string }
  | { p: string; small?: boolean }
  | { k: string[]; t: string };

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
  { h: '9.  GOVERNING LAW' },
  {
    p: 'These Terms are governed by the laws of physics, mostly. Should any clause be found unenforceable, the remaining clauses will simply be enforced harder.'
  },
  { h: '10.  FINAL NOTICE' },
  {
    p: 'Congratulations. You are one of the 0.0003% of people who have ever scrolled to the bottom of a Terms and Conditions page. Your reward is the checkbox below. Tick it. Enjoy your day off.'
  },
  { p: 'RaviCorp Holdings Ltd. accepts no responsibility for the contents of this agreement, including this sentence.', small: true }
];

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

export class TermsComputer {
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  /** Set when I AGREE has gone through and the "thank you" has been read. */
  done = false;
  /** Set the moment I AGREE is clicked (the scene starts pulling back). */
  accepted = false;

  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private doc: HTMLCanvasElement;
  private docH = 0;
  private scroll = 0;
  private scrollTarget = 0;
  private maxScroll = 0;
  private readToEnd = false;
  private checked = false;
  /** Canvas-space pointer, and whether it is over the monitor at all. */
  private mx = W / 2;
  private my = H / 2;
  /** Screen-space mouse (client px), kept virtual while the pointer is locked. */
  private sx = window.innerWidth / 2;
  private sy = window.innerHeight * 0.62;
  private dragging = false;
  private dragOff = 0;
  private time = 0;
  private toast = '';
  private toastT = 0;
  private shake = 0;
  private acceptT = -1;
  private hover: 'check' | 'agree' | 'decline' | 'bar' | null = null;
  private declines = 0;

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
    if (e.button !== 0) return;
    this.pointerDown = true;
  };
  private onUp = (): void => {
    this.dragging = false;
  };
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * DOC.h : e.deltaY;
    this.scrollBy(px * 0.9);
  };
  private onKey = (e: KeyboardEvent): void => {
    const page = DOC.h * 0.85;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.scrollBy(60);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.scrollBy(-60);
    else if (e.code === 'PageDown' || e.code === 'Space') this.scrollBy(page);
    else if (e.code === 'PageUp') this.scrollBy(-page);
    else if (e.code === 'End') this.scrollBy(1e6);
    else if (e.code === 'Home') this.scrollBy(-1e6);
    else if (e.code === 'Enter' && this.checked) this.accept();
    else return;
    e.preventDefault();
  };
  private pointerDown = false;

  constructor(
    private readonly face: THREE.Mesh,
    private readonly faceW: number,
    private readonly faceH: number,
    private readonly audio: AudioManager
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.doc = this.renderDocument();
    this.maxScroll = Math.max(0, this.docH - DOC.h);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    // Not tone-mapped: a lit screen, and the small print has to stay readable
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.draw();

    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('mousedown', this.onDown);
    document.addEventListener('mouseup', this.onUp);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('keydown', this.onKey);
    document.body.classList.add('terms-cursor');
  }

  dispose(): void {
    document.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('mousedown', this.onDown);
    document.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('keydown', this.onKey);
    document.body.classList.remove('terms-cursor');
    this.texture.dispose();
    this.material.dispose();
  }

  // ---------------------------------------------------------------- input

  private scrollBy(px: number): void {
    if (this.accepted) return;
    this.scrollTarget = THREE.MathUtils.clamp(this.scrollTarget + px, 0, this.maxScroll);
  }

  /** The pointer, from the window onto the monitor's face (canvas px). */
  private pick(camera: THREE.Camera): void {
    const ndc = new THREE.Vector2((this.sx / window.innerWidth) * 2 - 1, -(this.sy / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    // Into the face's own space, then onto its plane (z = 0)
    this.face.updateWorldMatrix(true, false);
    const inv = this.face.matrixWorld.clone().invert();
    const o = ray.ray.origin.clone().applyMatrix4(inv);
    const d = ray.ray.direction.clone().transformDirection(inv);
    if (Math.abs(d.z) < 1e-5) return;
    const t = -o.z / d.z;
    if (t <= 0) return;
    const x = o.x + d.x * t;
    const y = o.y + d.y * t;
    this.mx = THREE.MathUtils.clamp((x / this.faceW + 0.5) * W, 4, W - 4);
    this.my = THREE.MathUtils.clamp((0.5 - y / this.faceH) * H, 4, H - 4);
  }

  private inside(r: { x: number; y: number; w: number; h: number }): boolean {
    return this.mx >= r.x && this.mx <= r.x + r.w && this.my >= r.y && this.my <= r.y + r.h;
  }

  private thumb(): { y: number; h: number } {
    const h = Math.max(46, (DOC.h / this.docH) * BAR.h);
    const y = BAR.y + (this.maxScroll > 0 ? (this.scroll / this.maxScroll) * (BAR.h - h) : 0);
    return { y, h };
  }

  private say(text: string): void {
    this.toast = text;
    this.toastT = 2.6;
  }

  private click(): void {
    if (this.accepted) return;
    const th = this.thumb();
    const checkBox = { x: CHECK.x - 6, y: CHECK.y - 6, w: 640, h: CHECK.s + 12 };
    if (this.inside({ x: BAR.x - 4, y: th.y, w: BAR.w + 8, h: th.h })) {
      this.dragging = true;
      this.dragOff = this.my - th.y;
    } else if (this.inside({ x: BAR.x - 4, y: BAR.y, w: BAR.w + 8, h: BAR.h })) {
      this.scrollBy(this.my < th.y ? -DOC.h * 0.85 : DOC.h * 0.85);
      this.audio.uiBeep();
    } else if (this.inside(checkBox)) {
      if (!this.readToEnd) {
        this.shake = 0.4;
        this.audio.uiBeep();
        this.say('Nice try, Ravi. Scroll to the bottom and actually read it.');
      } else {
        this.checked = !this.checked;
        this.audio.uiBeep(this.checked);
      }
    } else if (this.inside(AGREE)) {
      if (this.checked) this.accept();
      else {
        this.audio.uiBeep();
        this.say(this.readToEnd ? 'You have to tick the box first.' : 'You have to read it first. All of it.');
        this.shake = 0.3;
      }
    } else if (this.inside(DECLINE)) {
      this.audio.uiBeep();
      this.declines++;
      this.say(
        [
          'Declining is not available on your current plan.',
          'Your request to decline has been declined.',
          'Ravi. Please.',
          'We have forwarded your complaint to the shredder.'
        ][(this.declines - 1) % 4]
      );
    } else if (this.inside(DOC)) {
      // A click in the document: nothing, it's a document
    }
  }

  private accept(): void {
    if (this.accepted) return;
    this.accepted = true;
    this.acceptT = 0;
    this.audio.uiBeep(true);
  }

  // --------------------------------------------------------------- update

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    this.pick(camera);

    if (this.pointerDown) {
      this.pointerDown = false;
      this.click();
    }
    if (this.dragging && this.maxScroll > 0) {
      const th = this.thumb();
      const u = (this.my - this.dragOff - BAR.y) / (BAR.h - th.h);
      this.scrollTarget = THREE.MathUtils.clamp(u, 0, 1) * this.maxScroll;
    }

    this.scroll += (this.scrollTarget - this.scroll) * Math.min(1, dt * 14);
    if (Math.abs(this.scrollTarget - this.scroll) < 0.3) this.scroll = this.scrollTarget;
    if (!this.readToEnd && this.scroll >= this.maxScroll - 6) {
      this.readToEnd = true;
      this.audio.uiBeep(true);
      this.say('You read the whole thing. HR has been notified.');
    }

    this.toastT = Math.max(0, this.toastT - dt);
    this.shake = Math.max(0, this.shake - dt);
    if (this.acceptT >= 0) {
      this.acceptT += dt;
      if (this.acceptT > 2.4) this.done = true;
    }

    const th = this.thumb();
    this.hover = this.inside(AGREE)
      ? 'agree'
      : this.inside(DECLINE)
        ? 'decline'
        : this.inside({ x: CHECK.x - 6, y: CHECK.y - 6, w: 640, h: CHECK.s + 12 })
          ? 'check'
          : this.inside({ x: BAR.x - 4, y: th.y, w: BAR.w + 8, h: th.h })
            ? 'bar'
            : null;

    this.draw();
    this.texture.needsUpdate = true;
  }

  // ------------------------------------------------------------- drawing

  /** The whole agreement, word-wrapped once onto a tall canvas. */
  private renderDocument(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    const w = DOC.w - 40;
    const pad = 24;
    const measure = c.getContext('2d')!;
    const wrap = (text: string, font: string, max: number): string[] => {
      measure.font = font;
      const lines: string[] = [];
      let line = '';
      for (const word of text.split(' ')) {
        const tryLine = line ? line + ' ' + word : word;
        if (measure.measureText(tryLine).width > max && line) {
          lines.push(line);
          line = word;
        } else line = tryLine;
      }
      if (line) lines.push(line);
      return lines;
    };
    const fH = `700 25px ${FONT}`;
    const fP = `400 22px ${FONT}`;
    const fS = `italic 400 16px ${FONT}`;
    const fK = `700 19px ${FONT}`;
    const KEY_COL = 230;

    // Lay out first, then paint at the measured height
    type Op = (g: CanvasRenderingContext2D, y: number) => void;
    const ops: { y: number; op: Op }[] = [];
    let y = pad;
    for (const b of DOCUMENT) {
      if ('h' in b) {
        y += 18;
        const at = y;
        ops.push({
          y: at,
          op: (g, yy) => {
            g.font = fH;
            g.fillStyle = '#1b2a4a';
            g.fillText(b.h, pad, yy + 26);
            g.fillStyle = '#c9d2e3';
            g.fillRect(pad, yy + 36, w - pad * 2, 2);
          }
        });
        y += 50;
      } else if ('p' in b) {
        const font = b.small ? fS : fP;
        const lh = b.small ? 22 : 31;
        const lines = wrap(b.p, font, w - pad * 2);
        const at = y;
        ops.push({
          y: at,
          op: (g, yy) => {
            g.font = font;
            g.fillStyle = b.small ? '#7b8494' : '#2b313b';
            lines.forEach((l, i) => g.fillText(l, pad, yy + 23 + i * lh));
          }
        });
        y += lines.length * lh + 14;
      } else {
        const lines = wrap(b.t, fP, w - pad * 2 - KEY_COL);
        const at = y;
        ops.push({
          y: at,
          op: (g, yy) => {
            // The keys as little keycaps
            g.font = fK;
            let kx = pad;
            let ky = yy;
            for (const k of b.k) {
              const kw = Math.max(34, g.measureText(k).width + 20);
              if (kx + kw > pad + KEY_COL - 8) {
                kx = pad;
                ky += 38;
              }
              g.fillStyle = '#9aa6bb';
              roundRect(g, kx, ky + 3, kw, 32, 6);
              g.fill();
              g.fillStyle = '#f4f6fa';
              roundRect(g, kx, ky, kw, 31, 6);
              g.fill();
              g.strokeStyle = '#8692a8';
              g.lineWidth = 1.5;
              g.stroke();
              g.fillStyle = '#1b2a4a';
              g.textAlign = 'center';
              g.fillText(k, kx + kw / 2, ky + 23);
              g.textAlign = 'left';
              kx += kw + 7;
            }
            g.font = fP;
            g.fillStyle = '#2b313b';
            lines.forEach((l, i) => g.fillText(l, pad + KEY_COL, yy + 23 + i * 31));
          }
        });
        y += Math.max(lines.length * 31, b.k.length > 3 ? 74 : 38) + 14;
      }
    }
    y += pad + 10;
    this.docH = y;
    c.width = w;
    c.height = y;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, y);
    for (const o of ops) o.op(g, o.y);
    return c;
  }

  private draw(): void {
    const g = this.g;
    // The desktop behind the window
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1f4f86');
    bg.addColorStop(1, '#0d2647');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // The window
    const ox = this.shake > 0 ? Math.sin(this.shake * 70) * 9 * (this.shake / 0.4) : 0;
    g.save();
    g.translate(ox, 0);
    g.fillStyle = '#eef1f6';
    g.fillRect(14, 10, W - 28, H - 20);
    // Title bar
    g.fillStyle = '#2b4c7e';
    g.fillRect(14, 10, W - 28, TITLE_H);
    g.font = `600 19px ${FONT}`;
    g.fillStyle = '#ffffff';
    g.fillText('RaviCorp Employee Portal  —  Terms_and_Conditions_FINAL_v2(3).pdf', 30, 10 + 27);
    // ─ □ ✕
    g.fillStyle = '#c94a42';
    g.fillRect(W - 14 - 54, 10, 54, TITLE_H);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.4;
    const cx = W - 14 - 27;
    g.beginPath();
    g.moveTo(cx - 8, 30 - 8);
    g.lineTo(cx + 8, 30 + 8);
    g.moveTo(cx + 8, 30 - 8);
    g.lineTo(cx - 8, 30 + 8);
    g.stroke();
    g.strokeRect(W - 14 - 54 - 40, 22, 16, 16);
    g.beginPath();
    g.moveTo(W - 14 - 54 - 84, 31);
    g.lineTo(W - 14 - 54 - 68, 31);
    g.stroke();

    // Heading
    g.fillStyle = '#1b2a4a';
    g.font = `800 38px ${FONT}`;
    g.fillText('TERMS AND CONDITIONS', 40, 100);
    g.font = `400 18px ${FONT}`;
    g.fillStyle = '#5a6578';
    g.fillText('Please read the entire agreement before continuing. Yes, all of it. We can tell.', 42, 130);
    // Progress through the document, top right
    const pct = this.maxScroll > 0 ? Math.round((this.scroll / this.maxScroll) * 100) : 100;
    g.textAlign = 'right';
    g.font = `600 17px ${FONT}`;
    g.fillStyle = this.readToEnd ? '#2f8a4c' : '#5a6578';
    g.fillText(this.readToEnd ? 'READ: 100% ✓' : `READ: ${pct}%`, DOC.x + DOC.w + 20, 100);
    g.textAlign = 'left';

    // The document, clipped and scrolled
    g.fillStyle = '#ffffff';
    g.fillRect(DOC.x, DOC.y, DOC.w, DOC.h);
    g.save();
    g.beginPath();
    g.rect(DOC.x, DOC.y, DOC.w, DOC.h);
    g.clip();
    g.drawImage(this.doc, DOC.x + 10, DOC.y - this.scroll);
    // A fade at the bottom while there's more below
    if (!this.readToEnd) {
      const f = g.createLinearGradient(0, DOC.y + DOC.h - 60, 0, DOC.y + DOC.h);
      f.addColorStop(0, 'rgba(255,255,255,0)');
      f.addColorStop(1, 'rgba(255,255,255,0.95)');
      g.fillStyle = f;
      g.fillRect(DOC.x, DOC.y + DOC.h - 60, DOC.w, 60);
    }
    g.restore();
    g.strokeStyle = '#b8c1d1';
    g.lineWidth = 2;
    g.strokeRect(DOC.x, DOC.y, DOC.w, DOC.h);

    // Scrollbar
    g.fillStyle = '#dde2ea';
    roundRect(g, BAR.x, BAR.y, BAR.w, BAR.h, 7);
    g.fill();
    const th = this.thumb();
    g.fillStyle = this.dragging ? '#3d5f95' : this.hover === 'bar' ? '#6f84a8' : '#8f9cb4';
    roundRect(g, BAR.x + 1, th.y, BAR.w - 2, th.h, 6);
    g.fill();

    // Footer: the checkbox, then the buttons
    const enabled = this.readToEnd;
    g.fillStyle = enabled ? '#ffffff' : '#e3e6ec';
    roundRect(g, CHECK.x, CHECK.y, CHECK.s, CHECK.s, 5);
    g.fill();
    g.strokeStyle = this.hover === 'check' && enabled ? '#2b4c7e' : enabled ? '#6b778c' : '#b3bac6';
    g.lineWidth = 2.5;
    g.stroke();
    if (this.checked) {
      g.strokeStyle = '#2f8a4c';
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(CHECK.x + 7, CHECK.y + 16);
      g.lineTo(CHECK.x + 13, CHECK.y + 23);
      g.lineTo(CHECK.x + 24, CHECK.y + 7);
      g.stroke();
      g.lineCap = 'butt';
    }
    g.font = `600 22px ${FONT}`;
    g.fillStyle = enabled ? '#1b2a4a' : '#9aa3b2';
    g.fillText('I agree to the Terms and Conditions', CHECK.x + CHECK.s + 14, CHECK.y + 23);
    if (!enabled) {
      g.font = `italic 400 17px ${FONT}`;
      g.fillText('(scroll to the bottom first)', CHECK.x + CHECK.s + 392, CHECK.y + 22);
    }

    this.button(DECLINE, 'DECLINE', false, this.hover === 'decline');
    this.button(AGREE, 'I AGREE', this.checked, this.hover === 'agree' && this.checked);

    // Toast: the portal's replies
    if (this.toastT > 0 && !this.accepted) {
      g.globalAlpha = Math.min(1, this.toastT * 3);
      g.font = `600 19px ${FONT}`;
      const tw = g.measureText(this.toast).width + 36;
      g.fillStyle = '#fff4cf';
      roundRect(g, 46, AGREE.y + 6, Math.min(tw, 640), 40, 8);
      g.fill();
      g.strokeStyle = '#d9b44a';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#5b4510';
      g.fillText(this.toast, 64, AGREE.y + 33);
      g.globalAlpha = 1;
    }
    g.restore();

    if (this.accepted) this.drawAccepted();
    this.drawCurry(this.mx, this.my);
  }

  private button(r: { x: number; y: number; w: number; h: number }, label: string, primary: boolean, hot: boolean): void {
    const g = this.g;
    g.fillStyle = primary ? (hot ? '#2e9a55' : '#2f8a4c') : hot ? '#d6dbe4' : '#e3e7ee';
    roundRect(g, r.x, r.y, r.w, r.h, 8);
    g.fill();
    g.strokeStyle = primary ? '#1f6a37' : '#a9b2c2';
    g.lineWidth = 2;
    g.stroke();
    g.font = `700 22px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = primary ? '#ffffff' : label === 'I AGREE' ? '#a0a8b6' : '#4b5466';
    g.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 8);
    g.textAlign = 'left';
  }

  /** After I AGREE: a progress bar, then a thank-you. */
  private drawAccepted(): void {
    const g = this.g;
    const t = this.acceptT;
    g.fillStyle = 'rgba(10, 20, 40, 0.55)';
    g.fillRect(0, 0, W, H);
    const bw = 620;
    const bh = 210;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;
    g.fillStyle = '#eef1f6';
    roundRect(g, bx, by, bw, bh, 12);
    g.fill();
    g.textAlign = 'center';
    if (t < 1.1) {
      g.font = `700 26px ${FONT}`;
      g.fillStyle = '#1b2a4a';
      g.fillText('Processing your signature…', W / 2, by + 70);
      g.fillStyle = '#d3d9e3';
      roundRect(g, bx + 60, by + 110, bw - 120, 26, 13);
      g.fill();
      g.fillStyle = '#2f8a4c';
      roundRect(g, bx + 60, by + 110, Math.max(26, (bw - 120) * Math.min(1, t / 1.0)), 26, 13);
      g.fill();
    } else {
      g.font = `800 30px ${FONT}`;
      g.fillStyle = '#2f8a4c';
      g.fillText('✓  AGREEMENT ACCEPTED', W / 2, by + 78);
      g.font = `400 21px ${FONT}`;
      g.fillStyle = '#2b313b';
      g.fillText('Thank you, Ravi. Enjoy your day off.', W / 2, by + 124);
      g.font = `italic 400 16px ${FONT}`;
      g.fillStyle = '#7b8494';
      g.fillText('(Day off subject to Section 7.)', W / 2, by + 160);
    }
    g.textAlign = 'left';
  }

  /**
   * The pointer: a bowl of curry, steam coming off it, with a spoon in it
   * whose handle is the pointy end — the hotspot is the tip of the handle.
   */
  private drawCurry(x: number, y: number): void {
    const g = this.g;
    g.save();
    g.translate(x, y);
    g.scale(1.55, 1.55);
    // Bowl centre down and right of the hotspot
    const bx = 38;
    const by = 46;
    // Shadow
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.ellipse(bx + 4, by + 30, 34, 9, 0, 0, Math.PI * 2);
    g.fill();
    // Bowl body: a half ellipse
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
    // A blue band round it
    g.strokeStyle = '#2f5d9e';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(bx - 33, by + 9);
    g.bezierCurveTo(bx - 26, by + 21, bx + 26, by + 21, bx + 33, by + 9);
    g.stroke();
    // Foot
    g.fillStyle = '#cfc6b4';
    g.fillRect(bx - 12, by + 22, 24, 5);
    // Rim and the curry in it
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
    // Rice on one side, bits of chicken and a leaf of coriander
    g.fillStyle = '#fbf8f0';
    g.beginPath();
    g.ellipse(bx + 14, by - 1, 12, 5, 0.1, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8d3f0d';
    for (const [dx, dy] of [[-14, 2], [-4, -2], [-20, -1], [2, 3]]) {
      g.beginPath();
      g.ellipse(bx + dx, by + dy, 3.6, 2.2, 0.4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#3f9a3a';
    g.beginPath();
    g.ellipse(bx - 9, by - 3, 3.5, 1.8, -0.6, 0, Math.PI * 2);
    g.fill();
    // The spoon: its bowl in the curry, its handle out to the top-left — the tip is the hotspot
    g.strokeStyle = '#8b939e';
    g.lineWidth = 6;
    g.lineCap = 'round';
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
    // A dark outline on the tip so it reads as a pointer on white
    g.fillStyle = '#1b2a4a';
    g.beginPath();
    g.arc(1, 1, 3.2, 0, Math.PI * 2);
    g.fill();
    // Steam
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

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
