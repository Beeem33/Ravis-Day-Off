import { ScamMe } from './ScamMe';

/**
 * The files and apps on Ravi's desktop in Level 1, and what opens them.
 *
 *  - ScamMe, the office group chat
 *  - Mail, with Maheer's haircut email (and the photo attached)
 *  - A classified case file: the team photo, and the man nobody knows
 *  - "Micheals Day Off game (pirated)", which is mostly pop-up ads
 *  - The FREE RAM downloader
 *
 * Each viewer draws itself into its window's content rect on the PC's canvas
 * and registers its own hotspots through the DeskCtx the desktop hands it.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HotOpts {
  down?: () => void;
  dbl?: () => void;
  wheel?: (dy: number) => void;
}

/** What the desktop gives a viewer to draw and react with. */
export interface DeskCtx {
  g: CanvasRenderingContext2D;
  time: number;
  dt: number;
  hoverId: string;
  mx: number;
  my: number;
  hot(r: Rect, id: string, o?: HotOpts): void;
  open(id: FileId): void;
  close(): void;
  say(title: string, body: string): void;
  /** How many windows are open whose app id starts with `prefix`. */
  count(prefix: string): number;
}

export interface Viewer {
  draw(c: DeskCtx, r: Rect): void;
  /** Keys while its window is on top; true if used. */
  key?(e: KeyboardEvent, c: DeskCtx): boolean;
}

export type FileId = 'scamme' | 'mail' | 'classified' | 'game' | 'ram' | 'maheerpic' | `ad${number}`;

type IconKind = 'txt' | 'doc' | 'xls' | 'ppt' | 'mp4' | 'jpg' | 'exe' | 'folder' | 'html' | 'scamme' | 'mail' | 'secret' | 'game' | 'ad';

export interface FileDef {
  id: FileId;
  name: string;
  /** The name broken onto lines under its desktop icon. */
  label: string[];
  icon: IconKind;
  title: string;
  w: number;
  h: number;
  /** Where its window opens, if not cascaded in the middle. */
  x?: number;
  y?: number;
}

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const IMPACT = 'Impact, "Arial Black", sans-serif';

/** The two photos taken in the game (see OfficePhotos), once they exist. */
export const PHOTOS: {
  team: HTMLCanvasElement | null;
  stranger: { x: number; y: number; r: number } | null;
  maheer: HTMLCanvasElement | null;
} = { team: null, stranger: null, maheer: null };

export const FILES: FileDef[] = [
  { id: 'scamme', name: 'ScamMe', label: ['ScamMe'], icon: 'scamme', title: 'ScamMe — Office Chat', w: 960, h: 700 },
  { id: 'mail', name: 'Mail', label: ['Mail'], icon: 'mail', title: 'Inbox — ravi@ravicorp.biz — Mail', w: 1040, h: 680 },
  { id: 'classified', name: 'CLASSIFIED_Case_0447_Exhibit_A.pdf', label: ['CLASSIFIED_', 'Case_0447_', 'Exhibit_A.pdf'], icon: 'secret', title: 'CLASSIFIED_Case_0447_Exhibit_A.pdf — PDF Viewer', w: 900, h: 720 },
  { id: 'game', name: 'Micheals Day Off game (pirated)', label: ['Micheals Day Off', 'game (pirated)'], icon: 'game', title: "Micheal's Day Off  [CRACKED BY xX_R4V1_Xx]", w: 860, h: 560 },
  { id: 'ram', name: 'FREE_RAM_DOWNLOADER_100GB_REAL_NOT_VIRUS.exe', label: ['FREE_RAM_', 'DOWNLOADER_', '100GB_REAL.exe'], icon: 'exe', title: 'RAM Downloader Pro 4.2 Setup', w: 700, h: 470 },
  { id: 'maheerpic', name: 'IMG_2231.jpg', label: [], icon: 'jpg', title: 'IMG_2231.jpg — Photos', w: 820, h: 620 }
];

/** On the desktop, in this order, down the columns. */
export const DESKTOP_FILES: FileId[] = ['scamme', 'mail', 'classified', 'game', 'ram'];

// ---- The pop-up ads: one window each, made up on the spot
type Brand = 'mccarls' | 'sludger' | 'harpees';
const BRANDS: Brand[] = ['mccarls', 'sludger', 'harpees'];
const BRAND_NAME: Record<Brand, string> = { mccarls: "McCarl's", sludger: 'Sludger King', harpees: "Harpee's" };
let adSeq = 0;
const adDefs = new Map<FileId, FileDef>();

/** A new pop-up ad's id, with a size and a spot on the screen. */
export function newAd(): FileId {
  const id = `ad${adSeq++}` as FileId;
  const n = adSeq;
  const brand = BRANDS[n % 3];
  const w = 360 + ((n * 53) % 110);
  const h = 290 + ((n * 37) % 70);
  const x = 30 + ((n * 211) % (1200 - w - 60));
  const y = 10 + ((n * 137) % (800 - 56 - h - 20));
  adDefs.set(id, { id, name: '', label: [], icon: 'ad', title: `${BRAND_NAME[brand]} — SPECIAL OFFER!!! — Googel Chrome`, w, h, x, y });
  return id;
}

function adBrand(id: FileId): Brand {
  return BRANDS[(Number(id.slice(2)) + 1) % 3];
}

export function fileDef(id: FileId): FileDef {
  return adDefs.get(id) ?? FILES.find((f) => f.id === id)!;
}

export function isFile(app: string): app is FileId {
  return FILES.some((f) => f.id === app) || adDefs.has(app as FileId);
}

export function isAd(app: string): boolean {
  return /^ad\d+$/.test(app);
}

// =================================================================== helpers

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  if (!text) return [''];
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (g.measureText(t).width > max && line) {
      out.push(line);
      line = word;
    } else line = t;
  }
  out.push(line);
  return out;
}

function clipTo(g: CanvasRenderingContext2D, r: Rect): void {
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, fill: string, align: CanvasTextAlign = 'left'): void {
  g.font = font;
  g.fillStyle = fill;
  g.textAlign = align;
  g.fillText(s, x, y);
  g.textAlign = 'left';
}

/** A vertical scrollbar for a scrolled area; returns nothing, draws only. */
function scrollbar(g: CanvasRenderingContext2D, area: Rect, scroll: number, content: number): void {
  if (content <= area.h) return;
  const x = area.x + area.w - 10;
  g.fillStyle = 'rgba(0,0,0,0.06)';
  g.fillRect(x, area.y, 10, area.h);
  const th = Math.max(30, (area.h / content) * area.h);
  const ty = area.y + (scroll / (content - area.h)) * (area.h - th);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  rr(g, x + 2, ty, 6, th, 3);
  g.fill();
}

class Scroller {
  y = 0;
  target = 0;
  max = 0;
  by(dy: number): void {
    this.target = Math.max(0, Math.min(this.max, this.target + dy));
  }
  step(dt: number, content: number, view: number): void {
    this.max = Math.max(0, content - view);
    this.target = Math.min(this.target, this.max);
    this.y += (this.target - this.y) * Math.min(1, dt * 14);
    if (Math.abs(this.target - this.y) < 0.3) this.y = this.target;
  }
}

// ===================================================================== icons

function drawPageIcon(g: CanvasRenderingContext2D, kind: IconKind, x: number, y: number, s: number): void {
  const w = s * 0.78;
  const h = s;
  if (kind === 'folder') {
    g.fillStyle = '#e8a93a';
    rr(g, x, y + h * 0.12, w * 0.5, h * 0.2, 3);
    g.fill();
    g.fillStyle = '#f7c64e';
    rr(g, x, y + h * 0.24, s, h * 0.7, 4);
    g.fill();
    // Papers sticking out
    g.fillStyle = '#ffffff';
    g.fillRect(x + s * 0.12, y + h * 0.18, s * 0.6, h * 0.12);
    g.fillStyle = '#f7c64e';
    g.fillRect(x, y + h * 0.3, s, h * 0.64);
    return;
  }
  if (kind === 'scamme') {
    // A blue rounded tile with a white speech bubble and a $
    g.fillStyle = '#2f6fdc';
    rr(g, x, y + s * 0.06, s * 0.92, s * 0.88, s * 0.2);
    g.fill();
    g.fillStyle = '#ffffff';
    rr(g, x + s * 0.18, y + s * 0.24, s * 0.56, s * 0.42, s * 0.12);
    g.fill();
    g.beginPath();
    g.moveTo(x + s * 0.3, y + s * 0.62);
    g.lineTo(x + s * 0.24, y + s * 0.78);
    g.lineTo(x + s * 0.44, y + s * 0.64);
    g.fill();
    text(g, '$', x + s * 0.46, y + s * 0.56, `900 ${Math.round(s * 0.34)}px ${FONT}`, '#2f6fdc', 'center');
    return;
  }
  if (kind === 'exe') {
    // A boxed installer with a shield
    g.fillStyle = '#5a7fd0';
    rr(g, x + s * 0.05, y + s * 0.1, s * 0.9, s * 0.8, 6);
    g.fill();
    g.fillStyle = '#88a6e8';
    g.fillRect(x + s * 0.05, y + s * 0.1, s * 0.9, s * 0.22);
    g.fillStyle = '#ffd34d';
    g.beginPath();
    g.moveTo(x + s * 0.5, y + s * 0.38);
    g.lineTo(x + s * 0.7, y + s * 0.46);
    g.quadraticCurveTo(x + s * 0.68, y + s * 0.74, x + s * 0.5, y + s * 0.82);
    g.quadraticCurveTo(x + s * 0.32, y + s * 0.74, x + s * 0.3, y + s * 0.46);
    g.closePath();
    g.fill();
    text(g, '!', x + s * 0.5, y + s * 0.72, `900 ${Math.round(s * 0.3)}px ${FONT}`, '#c0392b', 'center');
    return;
  }
  // A page with a folded corner and a coloured badge
  const f = w * 0.28;
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
  if (kind === 'txt') {
    g.fillStyle = '#9aa3ad';
    for (let i = 0; i < 5; i++) g.fillRect(x + w * 0.15, y + h * (0.3 + i * 0.12), w * (i === 4 ? 0.4 : 0.7), Math.max(1.5, h * 0.03));
    return;
  }
  if (kind === 'jpg' || kind === 'mp4') {
    g.fillStyle = kind === 'jpg' ? '#f5a623' : '#222';
    g.fillRect(x + w * 0.1, y + h * 0.3, w * 0.8, h * 0.5);
    if (kind === 'jpg') {
      g.fillStyle = '#6fbf4a';
      g.beginPath();
      g.moveTo(x + w * 0.1, y + h * 0.8);
      g.lineTo(x + w * 0.4, y + h * 0.5);
      g.lineTo(x + w * 0.9, y + h * 0.8);
      g.fill();
      g.fillStyle = '#fff3a0';
      g.beginPath();
      g.arc(x + w * 0.7, y + h * 0.42, w * 0.08, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(x + w * 0.4, y + h * 0.42);
      g.lineTo(x + w * 0.64, y + h * 0.55);
      g.lineTo(x + w * 0.4, y + h * 0.68);
      g.fill();
    }
    return;
  }
  const badge: Record<string, [string, string]> = { doc: ['#2b579a', 'W'], xls: ['#217346', 'X'], ppt: ['#d24726', 'P'], html: ['#25a35a', '💬'] };
  const [col, ch] = badge[kind];
  g.fillStyle = col;
  rr(g, x - w * 0.1, y + h * 0.42, w * 0.62, h * 0.42, 3);
  g.fill();
  text(g, ch, x - w * 0.1 + w * 0.31, y + h * 0.74, `800 ${Math.round(h * 0.3)}px ${FONT}`, '#ffffff', 'center');
  g.fillStyle = '#c9ced6';
  for (let i = 0; i < 4; i++) g.fillRect(x + w * 0.6, y + h * (0.46 + i * 0.1), w * 0.3, Math.max(1.5, h * 0.03));
}


// ================================================================ new icons

export function drawFileIcon(g: CanvasRenderingContext2D, kind: IconKind, x: number, y: number, s: number): void {
  if (kind === 'mail') {
    // An envelope on a blue tile
    g.fillStyle = '#0f62c4';
    rr(g, x, y + s * 0.06, s * 0.92, s * 0.88, s * 0.2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.fillRect(x + s * 0.16, y + s * 0.3, s * 0.6, s * 0.4);
    g.strokeStyle = '#0f62c4';
    g.lineWidth = Math.max(1.5, s * 0.05);
    g.beginPath();
    g.moveTo(x + s * 0.16, y + s * 0.3);
    g.lineTo(x + s * 0.46, y + s * 0.52);
    g.lineTo(x + s * 0.76, y + s * 0.3);
    g.stroke();
    // An unread count
    g.fillStyle = '#e74c3c';
    g.beginPath();
    g.arc(x + s * 0.84, y + s * 0.14, s * 0.15, 0, Math.PI * 2);
    g.fill();
    text(g, '5', x + s * 0.84, y + s * 0.2, `700 ${Math.round(s * 0.2)}px ${FONT}`, '#ffffff', 'center');
    return;
  }
  if (kind === 'secret') {
    drawPageIcon(g, 'txt', x, y, s);
    g.save();
    g.translate(x + s * 0.39, y + s * 0.6);
    g.rotate(-0.35);
    g.strokeStyle = '#c0392b';
    g.lineWidth = Math.max(1.5, s * 0.04);
    g.strokeRect(-s * 0.42, -s * 0.11, s * 0.84, s * 0.22);
    text(g, 'SECRET', 0, s * 0.07, `900 ${Math.round(s * 0.17)}px ${FONT}`, '#c0392b', 'center');
    g.restore();
    return;
  }
  if (kind === 'game') {
    // A box-art tile: sunset, a hammock, a skull-and-crossbones sticker
    const gr = g.createLinearGradient(0, y, 0, y + s);
    gr.addColorStop(0, '#ff8a3d');
    gr.addColorStop(1, '#7a2a8a');
    g.fillStyle = gr;
    rr(g, x + s * 0.04, y, s * 0.84, s, s * 0.08);
    g.fill();
    g.fillStyle = '#ffd34d';
    g.beginPath();
    g.arc(x + s * 0.46, y + s * 0.5, s * 0.16, 0, Math.PI * 2);
    g.fill();
    text(g, "MICHEAL'S", x + s * 0.46, y + s * 0.2, `900 ${Math.round(s * 0.14)}px ${IMPACT}`, '#ffffff', 'center');
    text(g, 'DAY OFF', x + s * 0.46, y + s * 0.33, `900 ${Math.round(s * 0.14)}px ${IMPACT}`, '#ffffff', 'center');
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(x + s * 0.74, y + s * 0.84, s * 0.15, 0, Math.PI * 2);
    g.fill();
    text(g, '☠', x + s * 0.74, y + s * 0.9, `${Math.round(s * 0.2)}px ${FONT}`, '#ffffff', 'center');
    return;
  }
  if (kind === 'ad') {
    g.fillStyle = '#e74c3c';
    g.beginPath();
    g.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
    g.fill();
    text(g, '!', x + s / 2, y + s * 0.72, `900 ${Math.round(s * 0.6)}px ${FONT}`, '#ffffff', 'center');
    return;
  }
  drawPageIcon(g, kind, x, y, s);
}

// =================================================================== Mail

interface Email {
  from: string;
  addr: string;
  subject: string;
  time: string;
  body: string[];
  attach?: boolean;
  col: string;
}

const EMAILS: Email[] = [
  {
    from: 'Maheer',
    addr: 'maheer@ravicorp.biz',
    subject: 'new cut 💈🔥',
    time: '11:58 AM',
    col: '#16a085',
    body: ['yo ravi', '', 'The barber lowk got me right', '', '(pic attached. tell me it’s not hard. you can’t.)', '', '— Maheer', 'Sent from my phone'],
    attach: true
  },
  {
    from: 'Vikram (Manager)',
    addr: 'vikram@ravicorp.biz',
    subject: 'Quick call?',
    time: '7:58 AM',
    col: '#c0392b',
    body: ['Ravi,', '', 'Quick call about your day off. 10 minutes only.', '', 'Also, sign the Terms.', '', 'V.']
  },
  {
    from: 'Sunita (HR)',
    addr: 'hr@ravicorp.biz',
    subject: 'REMINDER: Terms and Conditions (UNSIGNED)',
    time: 'Yesterday',
    col: '#1565c0',
    body: ['Dear Ravi,', '', 'Your Terms and Conditions remain unsigned.', 'Employees who have not signed are considered "available".', '', 'Regards,', 'Sunita, Human Resources']
  },
  {
    from: 'Curry Express',
    addr: 'orders@curryexpress.food',
    subject: 'Your order is on its way (again)',
    time: 'Yesterday',
    col: '#d9771c',
    body: ['Hi Ravi!', '', 'Your 4th butter chicken of the day has left the kitchen.', 'Our driver says hello. He knows the way by heart now.', '', 'Curry Express — we know what you did last night (ordered curry).']
  },
  {
    from: 'Mummy',
    addr: 'mummy.loves.ravi@mail.in',
    subject: 'FW: FW: FW: Good morning 🌻🌻',
    time: 'Mon',
    col: '#c2185b',
    body: ['Beta did you eat.', '', 'Also wear the blue shirt tomorrow. No reason.', '', '🌻 Have a blessed Monday 🌻']
  }
];

class Mail implements Viewer {
  private sel = 0;
  private read = new Set<number>();
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    this.read.add(this.sel);
    g.fillStyle = '#ffffff';
    g.fillRect(r.x, r.y, r.w, r.h);
    // Folders
    const fw = 190;
    g.fillStyle = '#f3f5f9';
    g.fillRect(r.x, r.y, fw, r.h);
    const nb = { x: r.x + 14, y: r.y + 14, w: fw - 28, h: 36 };
    g.fillStyle = '#0f62c4';
    rr(g, nb.x, nb.y, nb.w, nb.h, 6);
    g.fill();
    text(g, '✎  New mail', nb.x + nb.w / 2, nb.y + 24, `600 14px ${FONT}`, '#ffffff', 'center');
    c.hot(nb, `${this.id}:new`, { down: () => c.say('New mail', 'Your outbox is full. Of drafts to Priya you never sent.') });
    const unread = EMAILS.length - this.read.size;
    ([['Inbox', unread ? String(unread) : ''], ['Sent', ''], ['Drafts', '47'], ['Junk', '1,284'], ['Deleted', '']] as [string, string][]).forEach(([n, k], i) => {
      const fy = r.y + 70 + i * 36;
      if (i === 0) {
        g.fillStyle = '#dde7f5';
        rr(g, r.x + 8, fy, fw - 16, 32, 5);
        g.fill();
      }
      text(g, n, r.x + 24, fy + 21, `${i === 0 ? 700 : 400} 14px ${FONT}`, '#1f1f1f');
      if (k) text(g, k, r.x + fw - 22, fy + 21, `600 13px ${FONT}`, '#0f62c4', 'right');
      if (i) c.hot({ x: r.x + 8, y: fy, w: fw - 16, h: 32 }, `${this.id}:f${i}`, { down: () => c.say(n, i === 3 ? '1,284 messages. 1,280 of them are from McCarl’s.' : 'This folder has been archived by HR.') });
    });
    // The list
    const lx = r.x + fw;
    const lw = Math.min(340, r.w * 0.34);
    g.fillStyle = '#e3e7ee';
    g.fillRect(lx + lw, r.y, 1, r.h);
    text(g, 'Inbox', lx + 16, r.y + 32, `700 18px ${FONT}`, '#1f1f1f');
    EMAILS.forEach((m, i) => {
      const it = { x: lx, y: r.y + 50 + i * 76, w: lw, h: 76 };
      const hid = `${this.id}:m${i}`;
      if (i === this.sel || c.hoverId === hid) {
        g.fillStyle = i === this.sel ? '#cfe0f7' : '#eef3fb';
        g.fillRect(it.x, it.y, it.w, it.h);
      }
      const unreadM = !this.read.has(i);
      if (unreadM) {
        g.fillStyle = '#0f62c4';
        g.fillRect(it.x, it.y + 6, 3, it.h - 12);
      }
      text(g, m.from, it.x + 16, it.y + 22, `${unreadM ? 700 : 600} 14px ${FONT}`, '#1f1f1f');
      text(g, m.time, it.x + lw - 12, it.y + 22, `400 12px ${FONT}`, '#666', 'right');
      g.font = `${unreadM ? 700 : 400} 13px ${FONT}`;
      let sub = m.subject;
      while (g.measureText(sub).width > lw - 50) sub = sub.slice(0, -2);
      text(g, sub + (sub === m.subject ? '' : '…'), it.x + 16, it.y + 42, `${unreadM ? 700 : 400} 13px ${FONT}`, unreadM ? '#0f62c4' : '#1f1f1f');
      let pre = m.body.filter(Boolean).join(' ');
      g.font = `400 12px ${FONT}`;
      while (g.measureText(pre).width > lw - 60) pre = pre.slice(0, -2);
      text(g, pre + '…', it.x + 16, it.y + 60, `400 12px ${FONT}`, '#777');
      if (m.attach) text(g, '📎', it.x + lw - 18, it.y + 60, `13px ${FONT}`, '#666', 'center');
      g.fillStyle = '#eceff4';
      g.fillRect(it.x + 12, it.y + it.h - 1, it.w - 24, 1);
      c.hot(it, hid, { down: () => (this.sel = i) });
    });
    // Reading pane
    const m = EMAILS[this.sel];
    const px = lx + lw + 24;
    const pw = r.x + r.w - px - 24;
    text(g, m.subject, px, r.y + 40, `600 20px ${FONT}`, '#1f1f1f');
    g.fillStyle = m.col;
    g.beginPath();
    g.arc(px + 20, r.y + 82, 20, 0, Math.PI * 2);
    g.fill();
    text(g, m.from[0], px + 20, r.y + 89, `700 18px ${FONT}`, '#ffffff', 'center');
    text(g, m.from, px + 52, r.y + 78, `700 15px ${FONT}`, '#1f1f1f');
    text(g, `<${m.addr}>   To: Ravi   ·   ${m.time}`, px + 52, r.y + 97, `400 13px ${FONT}`, '#666');
    g.fillStyle = '#e3e7ee';
    g.fillRect(px, r.y + 114, pw, 1);
    m.body.forEach((l, i) => text(g, l, px, r.y + 146 + i * 24, `400 16px ${FONT}`, '#1f1f1f'));
    if (m.attach) {
      // The picture, attached: a thumbnail card that opens it
      const ay = r.y + 146 + m.body.length * 24 + 10;
      const card = { x: px, y: ay, w: Math.min(260, pw), h: 210 };
      const hid = `${this.id}:attach`;
      g.fillStyle = c.hoverId === hid ? '#eef3fb' : '#f6f8fb';
      rr(g, card.x, card.y, card.w, card.h, 8);
      g.fill();
      g.strokeStyle = '#d6dbe4';
      g.lineWidth = 1;
      g.stroke();
      const pic = PHOTOS.maheer;
      const th = { x: card.x + 10, y: card.y + 10, w: card.w - 20, h: card.h - 54 };
      if (pic) {
        const k = Math.max(th.w / pic.width, th.h / pic.height);
        const sw = th.w / k;
        const sh = th.h / k;
        g.drawImage(pic, (pic.width - sw) / 2, (pic.height - sh) / 2, sw, sh, th.x, th.y, th.w, th.h);
      } else {
        g.fillStyle = '#ccd3de';
        g.fillRect(th.x, th.y, th.w, th.h);
      }
      text(g, '📎 IMG_2231.jpg', card.x + 12, card.y + card.h - 24, `600 13px ${FONT}`, '#1f1f1f');
      text(g, '2.4 MB  ·  click to open', card.x + 12, card.y + card.h - 8, `400 12px ${FONT}`, '#777');
      c.hot(card, hid, { down: () => c.open('maheerpic') });
    }
    // Reply, which goes nowhere
    const rb = { x: px, y: r.y + r.h - 56, w: 100, h: 34 };
    g.fillStyle = c.hoverId === `${this.id}:reply` ? '#e5edf9' : '#f3f5f9';
    rr(g, rb.x, rb.y, rb.w, rb.h, 6);
    g.fill();
    text(g, '↩  Reply', rb.x + rb.w / 2, rb.y + 22, `600 14px ${FONT}`, '#1f1f1f', 'center');
    c.hot(rb, `${this.id}:reply`, {
      down: () => c.say('Reply', m.from === 'Maheer' ? 'You typed "fire 🔥" and deleted it four times. Message not sent.' : 'Replying would mean admitting you read it. Message not sent.')
    });
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.sel = Math.min(EMAILS.length - 1, this.sel + 1);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.sel = Math.max(0, this.sel - 1);
    else return false;
    return true;
  }
}

// ============================================================ Photos

class Photo implements Viewer {
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    g.fillStyle = '#1c1c1c';
    g.fillRect(r.x, r.y, r.w, r.h);
    const pic = PHOTOS.maheer;
    const area = { x: r.x + 16, y: r.y + 16, w: r.w - 32, h: r.h - 56 };
    if (pic) {
      const k = Math.min(area.w / pic.width, area.h / pic.height);
      g.drawImage(pic, area.x + (area.w - pic.width * k) / 2, area.y + (area.h - pic.height * k) / 2, pic.width * k, pic.height * k);
    } else text(g, 'Loading…', r.x + r.w / 2, r.y + r.h / 2, `400 16px ${FONT}`, '#ccc', 'center');
    text(g, 'IMG_2231.jpg   ·   from Maheer   ·   1 of 1', r.x + r.w / 2, r.y + r.h - 16, `400 13px ${FONT}`, '#bbbbbb', 'center');
  }
}

// ================================================= The classified case file

class Classified implements Viewer {
  private s = new Scroller();
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    g.fillStyle = '#3b3f45';
    g.fillRect(r.x, r.y, r.w, r.h);
    const pageW = Math.min(720, r.w - 60);
    const px = r.x + (r.w - pageW) / 2;
    const pageH = 1150;
    this.s.step(c.dt, pageH + 40, r.h);
    clipTo(g, r);
    const top = r.y + 20 - this.s.y;
    g.fillStyle = '#fbfaf6';
    g.fillRect(px, top, pageW, pageH);
    const L = px + 44;
    const W = pageW - 88;
    // Letterhead
    g.fillStyle = '#7a1414';
    g.fillRect(px, top, pageW, 10);
    text(g, 'RAVICORP INTERNAL AFFAIRS', L, top + 52, `800 15px ${FONT}`, '#7a1414');
    text(g, 'CLASSIFIED — EYES ONLY', L + W, top + 52, `800 15px ${FONT}`, '#7a1414', 'right');
    g.fillStyle = '#7a1414';
    g.fillRect(L, top + 64, W, 2);
    text(g, 'CASE FILE #0447', L, top + 104, `900 30px ${FONT}`, '#1f1f1f');
    text(g, 'THE TEAM PHOTO', L, top + 140, `900 30px ${FONT}`, '#1f1f1f');
    const meta: [string, string][] = [
      ['Date of incident:', 'Team-building day (mandatory)'],
      ['Location:', "Ravi's office, south wall"],
      ['Photographer:', '██████████ (asked to remain anonymous)'],
      ['Status:', 'UNSOLVED']
    ];
    meta.forEach(([k, v], i) => {
      text(g, k, L, top + 182 + i * 24, `700 14px ${FONT}`, '#444');
      text(g, v, L + 150, top + 182 + i * 24, `400 14px ${FONT}`, '#1f1f1f');
    });
    // Exhibit A
    text(g, 'EXHIBIT A', L, top + 300, `800 14px ${FONT}`, '#7a1414');
    const ph = { x: L, y: top + 312, w: W, h: (W * 2) / 3 };
    const pic = PHOTOS.team;
    if (pic) g.drawImage(pic, ph.x, ph.y, ph.w, ph.h);
    else {
      g.fillStyle = '#ddd';
      g.fillRect(ph.x, ph.y, ph.w, ph.h);
    }
    g.strokeStyle = '#1f1f1f';
    g.lineWidth = 1;
    g.strokeRect(ph.x, ph.y, ph.w, ph.h);
    // The red circle and the question
    const st = PHOTOS.stranger;
    if (pic && st) {
      const k = ph.w / pic.width;
      const cx = ph.x + st.x * k;
      const cy = ph.y + st.y * k;
      const rad = st.r * k;
      g.strokeStyle = '#e8141c';
      g.lineWidth = 5;
      g.beginPath();
      g.ellipse(cx, cy, rad * 0.62, rad, 0.05, 0, Math.PI * 2);
      g.stroke();
      g.save();
      g.font = `900 34px ${IMPACT}`;
      g.textAlign = 'center';
      g.lineWidth = 5;
      g.strokeStyle = '#ffffff';
      const ty = Math.max(ph.y + 40, cy - rad - 14);
      const tx = Math.min(ph.x + ph.w - 90, cx);
      g.strokeText('WHO IS HE?', tx, ty);
      g.fillStyle = '#e8141c';
      g.fillText('WHO IS HE?', tx, ty);
      g.restore();
    }
    text(g, 'Fig. 1 — Ravi (centre), with his arms around two coworkers who did not agree to this.', L, ph.y + ph.h + 22, `italic 400 13px ${FONT}`, '#555');
    // Findings
    let y = ph.y + ph.h + 64;
    text(g, 'FINDINGS', L, y, `800 14px ${FONT}`, '#7a1414');
    y += 28;
    const findings = [
      '1. Nobody on the floor recognises the individual at the far right of the photo.',
      '2. He is not on the payroll. He is not in the visitor log. He was not invited.',
      '3. He is not wearing anything. He is yellow. All of him. Except the face.',
      '4. When asked, Ravi said: "He was already there when I got there."',
      '5. When asked again, Ravi said: "I thought he was with you guys."',
      '6. The coffee machine has been making a 7th cup every morning since that day.',
      '7. Gary claims he has "seen him in the stairwell". Gary has been sent home.'
    ];
    g.font = `400 15px ${FONT}`;
    for (const f of findings) {
      for (const l of wrap(g, f, W)) {
        text(g, l, L, y, `400 15px ${FONT}`, '#1f1f1f');
        y += 22;
      }
      y += 6;
    }
    y += 14;
    text(g, 'RECOMMENDATION', L, y, `800 14px ${FONT}`, '#7a1414');
    y += 26;
    for (const l of wrap(g, 'Do not engage. Do not make eye contact. Do not, under any circumstances, invite him to the team lunch. If he is already at the team lunch, leave quietly and inform HR (Sunita).', W)) {
      text(g, l, L, y, `400 15px ${FONT}`, '#1f1f1f');
      y += 22;
    }
    // The stamp
    g.save();
    g.translate(px + pageW * 0.66, top + 190);
    g.rotate(-0.22);
    g.globalAlpha = 0.8;
    g.strokeStyle = '#c0392b';
    g.lineWidth = 5;
    rr(g, -150, -38, 300, 76, 8);
    g.stroke();
    text(g, 'CLASSIFIED', 0, 16, `900 42px ${FONT}`, '#c0392b', 'center');
    g.restore();
    g.restore();
    scrollbar(g, r, this.s.y, pageH + 40);
    c.hot(r, `${this.id}:page`, { wheel: (dy) => this.s.by(dy) });
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.s.by(50);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.s.by(-50);
    else if (e.code === 'PageDown' || e.code === 'Space') this.s.by(320);
    else if (e.code === 'PageUp') this.s.by(-320);
    else return false;
    return true;
  }
}

// ============================================= Micheal's Day Off (pirated)

class Game implements Viewer {
  private t = 0;
  private spawned = 0;
  private wave = 9;
  private state: 'ads' | 'title' | 'loading' | 'won' = 'ads';
  private loadT = 0;
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    this.t += c.dt;
    // The ads pour in, one after another, on top of everything
    if (this.state === 'ads' && this.spawned < this.wave && this.t > 0.35 + this.spawned * 0.22) {
      this.spawned++;
      c.open(newAd());
    }
    const ads = c.count('ad');
    if (this.state === 'ads' && this.spawned >= this.wave && ads === 0) this.state = 'title';
    // The title screen behind them
    const gr = g.createLinearGradient(0, r.y, 0, r.y + r.h);
    gr.addColorStop(0, '#ff9a3d');
    gr.addColorStop(0.55, '#c2397a');
    gr.addColorStop(1, '#2a1240');
    g.fillStyle = gr;
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#ffe28a';
    g.beginPath();
    g.arc(r.x + r.w / 2, r.y + r.h * 0.62, 90, Math.PI, 0);
    g.fill();
    // Palm trees and a hammock with Micheal in it
    g.strokeStyle = '#2a1240';
    g.lineWidth = 10;
    for (const s of [-1, 1]) {
      const tx = r.x + r.w / 2 + s * 200;
      g.beginPath();
      g.moveTo(tx, r.y + r.h * 0.9);
      g.quadraticCurveTo(tx - s * 20, r.y + r.h * 0.6, tx + s * 10, r.y + r.h * 0.42);
      g.stroke();
      g.fillStyle = '#2a1240';
      for (let k = 0; k < 5; k++) {
        g.save();
        g.translate(tx + s * 10, r.y + r.h * 0.42);
        g.rotate(-Math.PI / 2 + (k - 2) * 0.6);
        g.beginPath();
        g.ellipse(40, 0, 44, 9, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
    g.strokeStyle = '#f2f2f2';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(r.x + r.w / 2 - 190, r.y + r.h * 0.6);
    g.quadraticCurveTo(r.x + r.w / 2, r.y + r.h * 0.82, r.x + r.w / 2 + 190, r.y + r.h * 0.6);
    g.stroke();
    g.fillStyle = '#2a1240';
    g.beginPath();
    g.ellipse(r.x + r.w / 2, r.y + r.h * 0.7, 80, 14, 0.05, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(r.x + r.w / 2 - 82, r.y + r.h * 0.67, 14, 0, Math.PI * 2);
    g.fill();
    // Title
    g.save();
    g.font = `900 64px ${IMPACT}`;
    g.textAlign = 'center';
    g.lineWidth = 8;
    g.strokeStyle = '#2a1240';
    g.strokeText("MICHEAL'S DAY OFF", r.x + r.w / 2, r.y + 92);
    g.fillStyle = '#fff3c4';
    g.fillText("MICHEAL'S DAY OFF", r.x + r.w / 2, r.y + 92);
    g.restore();
    text(g, '[ CRACKED BY xX_R4V1_Xx ]  [ 100% REAL ]  [ NO VIRUS ]  [ FREE ]', r.x + r.w / 2, r.y + 124, `700 14px ${FONT}`, '#ffffff', 'center');
    const bx = r.x + r.w / 2;
    const by = r.y + r.h - 70;
    if (this.state === 'ads') {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      rr(g, bx - 200, by - 26, 400, 44, 8);
      g.fill();
      text(g, ads ? `Close all ads to continue (${ads} left)` : 'Loading ads…', bx, by + 3, `700 17px ${FONT}`, '#ffd34d', 'center');
    } else if (this.state === 'title') {
      const b = { x: bx - 110, y: by - 28, w: 220, h: 50 };
      const hid = `${this.id}:start`;
      g.fillStyle = c.hoverId === hid ? '#ffe066' : '#ffd34d';
      rr(g, b.x, b.y, b.w, b.h, 10);
      g.fill();
      text(g, '▶  START', bx, b.y + 34, `900 24px ${IMPACT}`, '#2a1240', 'center');
      c.hot(b, hid, {
        down: () => {
          this.state = 'loading';
          this.loadT = 0;
        }
      });
    } else if (this.state === 'loading') {
      this.loadT += c.dt;
      const p = Math.min(0.99, this.loadT / 2.5);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      rr(g, bx - 220, by - 34, 440, 62, 8);
      g.fill();
      g.fillStyle = '#444';
      g.fillRect(bx - 200, by - 18, 400, 14);
      g.fillStyle = '#ffd34d';
      g.fillRect(bx - 200, by - 18, 400 * p, 14);
      text(g, this.loadT < 3.4 ? `Loading… ${Math.round(p * 100)}%` : 'crack.dll is having a day off too. Please download more RAM.', bx, by + 16, `600 14px ${FONT}`, '#ffffff', 'center');
      if (this.loadT > 6) {
        // ...and the ads are back
        this.state = 'ads';
        this.spawned = 0;
        this.wave = 5;
        this.t = 0;
      }
    }
  }
}

class Ad implements Viewer {
  private t = 0;
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    this.t += c.dt;
    const brand = adBrand(this.id);
    const n = Number(this.id.slice(2));
    const blink = Math.floor(this.t * 3) % 2 === 0;
    const cx = r.x + r.w / 2;
    if (brand === 'mccarls') {
      g.fillStyle = '#d61f26';
      g.fillRect(r.x, r.y, r.w, r.h);
      // A grinning yellow star
      g.fillStyle = '#ffcc00';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 ? 26 : 58;
        g.lineTo(r.x + 80 + Math.cos(a) * rad, r.y + 96 + Math.sin(a) * rad);
      }
      g.closePath();
      g.fill();
      g.fillStyle = '#d61f26';
      g.beginPath();
      g.arc(r.x + 70, r.y + 92, 5, 0, Math.PI * 2);
      g.arc(r.x + 90, r.y + 92, 5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#d61f26';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(r.x + 80, r.y + 102, 10, 0.2, Math.PI - 0.2);
      g.stroke();
      text(g, "McCARL'S", r.x + 150, r.y + 82, `900 40px ${IMPACT}`, '#ffcc00');
      text(g, "i'm lowkey lovin' it", r.x + 152, r.y + 108, `italic 700 16px ${FONT}`, '#ffffff');
      text(g, ['2 BURGERS FOR ₹1*', 'FREE FRIES FOR LIFE*', 'BIG McCARL: NOW 40% BIGGER*'][n % 3], cx, r.y + 190, `900 30px ${IMPACT}`, blink ? '#ffffff' : '#ffcc00', 'center');
      text(g, '*burgers not included. fries not included. life not included.', cx, r.y + 216, `400 11px ${FONT}`, '#ffd1d1', 'center');
    } else if (brand === 'sludger') {
      g.fillStyle = '#1d2b6b';
      g.fillRect(r.x, r.y, r.w, r.h);
      // A dripping crown
      g.fillStyle = '#ff8a00';
      g.beginPath();
      g.moveTo(r.x + 30, r.y + 120);
      g.lineTo(r.x + 30, r.y + 60);
      g.lineTo(r.x + 55, r.y + 90);
      g.lineTo(r.x + 80, r.y + 50);
      g.lineTo(r.x + 105, r.y + 90);
      g.lineTo(r.x + 130, r.y + 60);
      g.lineTo(r.x + 130, r.y + 120);
      g.closePath();
      g.fill();
      g.fillStyle = '#7a4a1a';
      for (let i = 0; i < 5; i++) {
        const dx = r.x + 40 + i * 22;
        const len = 10 + ((n + i) % 3) * 8 + Math.sin(this.t * 2 + i) * 3;
        g.beginPath();
        g.ellipse(dx, r.y + 120 + len / 2, 6, len / 2 + 4, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillRect(r.x + 30, r.y + 112, 100, 10);
      text(g, 'SLUDGER', r.x + 150, r.y + 82, `900 40px ${IMPACT}`, '#ff8a00');
      text(g, 'KING', r.x + 150, r.y + 120, `900 40px ${IMPACT}`, '#f5e6c8');
      text(g, ['HAVE IT YOUR WAY (THE WRONG WAY)', 'THE SLUDGEROONI — 99% OFF', 'CONGRATS!! YOU WON A CROWN'][n % 3], cx, r.y + 190, `900 24px ${IMPACT}`, blink ? '#ffffff' : '#ff8a00', 'center');
      text(g, 'Sludger King is not responsible for what is in the sludge.', cx, r.y + 216, `400 11px ${FONT}`, '#aab4e8', 'center');
    } else {
      g.fillStyle = '#ffffff';
      g.fillRect(r.x, r.y, r.w, r.h);
      g.fillStyle = '#c8102e';
      g.fillRect(r.x, r.y, r.w, 12);
      // A harp, and a star over it
      g.strokeStyle = '#c8102e';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(r.x + 50, r.y + 140);
      g.lineTo(r.x + 50, r.y + 60);
      g.quadraticCurveTo(r.x + 100, r.y + 50, r.x + 120, r.y + 90);
      g.lineTo(r.x + 50, r.y + 140);
      g.stroke();
      g.lineWidth = 2;
      for (let i = 1; i < 5; i++) {
        g.beginPath();
        g.moveTo(r.x + 50 + i * 13, r.y + 64 + i * 3);
        g.lineTo(r.x + 50 + i * 13, r.y + 140 - i * 10);
        g.stroke();
      }
      g.fillStyle = '#ffd200';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 ? 7 : 16;
        g.lineTo(r.x + 104 + Math.cos(a) * rad, r.y + 50 + Math.sin(a) * rad);
      }
      g.fill();
      text(g, "HARPEE'S", r.x + 145, r.y + 100, `900 40px ${IMPACT}`, '#c8102e');
      text(g, ['THICCBURGER: NOW THICCER', 'WIN A FREE iPHONE (REAL!!)', 'HOT FRIES IN YOUR AREA'][n % 3], cx, r.y + 190, `900 26px ${IMPACT}`, blink ? '#c8102e' : '#1f1f1f', 'center');
      text(g, "You are the 1,000,000th visitor! (Everyone is.)", cx, r.y + 216, `400 12px ${FONT}`, '#777', 'center');
    }
    // CLAIM NOW: which, of course, opens another one
    const b = { x: cx - 100, y: r.y + r.h - 62, w: 200, h: 42 };
    const hid = `${this.id}:claim`;
    g.fillStyle = c.hoverId === hid ? '#2ecc71' : '#27ae60';
    rr(g, b.x, b.y, b.w, b.h, 21);
    g.fill();
    text(g, blink ? 'CLAIM NOW!!' : 'CLICK HERE!!', cx, b.y + 28, `900 20px ${IMPACT}`, '#ffffff', 'center');
    c.hot(b, hid, { down: () => c.open(newAd()) });
    // A fake little ✕ in the corner of the ad itself
    const fx = { x: r.x + r.w - 26, y: r.y + 16, w: 16, h: 16 };
    text(g, '✕', fx.x + 8, fx.y + 13, `400 13px ${FONT}`, 'rgba(0,0,0,0.35)', 'center');
    c.hot(fx, `${this.id}:fake`, {
      down: () => {
        c.open(newAd());
        c.open(newAd());
      }
    });
  }
}

// ================================================ The "free RAM" installer

const RAM_STEPS = [
  'Connecting to RAM server (Ramesh bhaiya’s cousin’s laptop)…',
  'Downloading RAM… 12%',
  'Asking Sharma ji’s son to share some of his RAM…',
  'Compressing curry to make room…',
  'Calling your bank to "verify" your RAM…',
  'Installing BharatSearch Ultra Toolbar™…',
  'Telling Mummy…',
  'Finalising…'
];

class Installer implements Viewer {
  private step = 0;
  private t = 0;
  private opts = [true, true, true, true];
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    g.fillStyle = '#f0f0f0';
    g.fillRect(r.x, r.y, r.w, r.h);
    // Banner down the left
    const bw = 190;
    const bg = g.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    bg.addColorStop(0, '#1e3c8c');
    bg.addColorStop(1, '#5a1e8c');
    g.fillStyle = bg;
    g.fillRect(r.x, r.y, bw, r.h - 56);
    // A RAM stick
    g.fillStyle = '#1a7a3a';
    g.fillRect(r.x + 30, r.y + 90, 130, 46);
    g.fillStyle = '#111';
    for (let i = 0; i < 4; i++) g.fillRect(r.x + 38 + i * 30, r.y + 98, 22, 28);
    g.fillStyle = '#d4af37';
    for (let i = 0; i < 16; i++) g.fillRect(r.x + 34 + i * 8, r.y + 136, 5, 8);
    text(g, 'RAM', r.x + bw / 2, r.y + 200, `900 40px ${FONT}`, '#ffffff', 'center');
    text(g, 'DOWNLOADER PRO', r.x + bw / 2, r.y + 226, `700 14px ${FONT}`, '#ffd34d', 'center');
    text(g, 'v4.2 (REAL)', r.x + bw / 2, r.y + 246, `400 12px ${FONT}`, '#cfd8ff', 'center');
    const x = r.x + bw + 24;
    const w = r.w - bw - 48;
    if (this.step === 0) {
      text(g, 'Welcome to RAM Downloader Pro!', x, r.y + 50, `700 22px ${FONT}`, '#1f1f1f');
      ['Download up to 100 GB of RAM for FREE*.', '', 'Make your PC faster than Sharma ji’s son’s PC.', 'Trusted by over 3 people.', '', '*not free'].forEach((l, i) =>
        text(g, l, x, r.y + 96 + i * 26, `${l.startsWith('*') ? 'italic ' : ''}400 15px ${FONT}`, l.startsWith('*') ? '#999' : '#333')
      );
    } else if (this.step === 1) {
      text(g, 'Choose components', x, r.y + 50, `700 22px ${FONT}`, '#1f1f1f');
      const labels = ['Install 100 GB RAM', 'Install BharatSearch Ultra Toolbar™ (recommended)', 'Set homepage to RishtaAunty.com', 'Tell Mummy you installed this'];
      labels.forEach((l, i) => {
        const cb = { x, y: r.y + 86 + i * 40, w: w, h: 30 };
        g.fillStyle = '#ffffff';
        g.fillRect(cb.x, cb.y + 5, 20, 20);
        g.strokeStyle = '#666';
        g.lineWidth = 1.5;
        g.strokeRect(cb.x, cb.y + 5, 20, 20);
        if (this.opts[i]) text(g, '✔', cb.x + 10, cb.y + 22, `700 16px ${FONT}`, '#1e7a3a', 'center');
        text(g, l, cb.x + 32, cb.y + 21, `400 15px ${FONT}`, '#1f1f1f');
        c.hot(cb, `${this.id}:opt${i}`, {
          down: () => {
            this.opts[i] = false;
            // ...and it ticks itself again
            setTimeout(() => (this.opts[i] = true), 450);
          }
        });
      });
      text(g, 'Some options cannot be unticked. For your safety.', x, r.y + 270, `italic 400 13px ${FONT}`, '#888');
    } else if (this.step === 2) {
      this.t += c.dt;
      const p = Math.min(1, this.t / 7);
      text(g, 'Installing…', x, r.y + 50, `700 22px ${FONT}`, '#1f1f1f');
      text(g, RAM_STEPS[Math.min(RAM_STEPS.length - 1, Math.floor(p * RAM_STEPS.length))], x, r.y + 110, `400 15px ${FONT}`, '#333');
      g.fillStyle = '#ddd';
      g.fillRect(x, r.y + 130, w, 22);
      g.fillStyle = '#06b025';
      // It goes backwards for a moment, as these do
      const shown = p < 0.55 ? p : p < 0.65 ? 0.55 - (p - 0.55) * 2 : 0.35 + (p - 0.65) * (0.65 / 0.35);
      g.fillRect(x, r.y + 130, w * Math.min(1, shown), 22);
      text(g, `${Math.round(Math.min(1, shown) * 100)}%`, x + w / 2, r.y + 176, `400 14px ${FONT}`, '#333', 'center');
      if (p >= 1) {
        this.step = 3;
      }
    } else {
      text(g, 'Installation complete!', x, r.y + 50, `700 22px ${FONT}`, '#1f1f1f');
      ['RAM downloaded: 0 KB', 'Your computer is now 3% slower.', 'BharatSearch Ultra Toolbar™: installed (cannot be removed)', '', 'Thank you for choosing a scam.', '(Takes one to know one, Ravi.)'].forEach((l, i) =>
        text(g, l, x, r.y + 96 + i * 26, `${i >= 4 ? 700 : 400} 15px ${FONT}`, i >= 4 ? '#c0392b' : '#333')
      );
    }
    // Buttons
    g.fillStyle = '#e4e4e4';
    g.fillRect(r.x, r.y + r.h - 56, r.w, 56);
    const btn = (label: string, bx: number, enabled: boolean, fn: () => void): void => {
      const b = { x: bx, y: r.y + r.h - 44, w: 96, h: 32 };
      const hid = `${this.id}:b${label}`;
      g.fillStyle = enabled ? (c.hoverId === hid ? '#e5f1fb' : '#fdfdfd') : '#ececec';
      g.fillRect(b.x, b.y, b.w, b.h);
      g.strokeStyle = enabled && c.hoverId === hid ? '#0078d7' : '#adadad';
      g.lineWidth = 1;
      g.strokeRect(b.x, b.y, b.w, b.h);
      text(g, label, b.x + b.w / 2, b.y + 21, `400 14px ${FONT}`, enabled ? '#1f1f1f' : '#9a9a9a', 'center');
      if (enabled) c.hot(b, hid, { down: fn });
    };
    const rx = r.x + r.w - 112;
    if (this.step === 3) {
      btn('Finish', rx, true, () => {
        c.close();
        c.say('BharatSearch Ultra Toolbar™', 'Installed successfully! Your homepage is now RishtaAunty.com. Mummy has been notified.');
      });
    } else {
      btn('Cancel', rx, this.step !== 2, () => c.say('RAM Downloader Pro', 'Cancel is not available in the free version.'));
      btn(this.step === 1 ? 'Install' : 'Next >', rx - 108, this.step < 2, () => {
        this.step++;
        this.t = 0;
      });
      btn('< Back', rx - 216, this.step === 1, () => this.step--);
    }
  }
}

// ==================================================================== make

export function viewerFor(id: FileId): Viewer {
  if (isAd(id)) return new Ad(id);
  switch (id) {
    case 'scamme':
      return new ScamMe(id);
    case 'mail':
      return new Mail(id);
    case 'classified':
      return new Classified(id);
    case 'game':
      return new Game(id);
    case 'maheerpic':
      return new Photo(id);
    default:
      return new Installer(id);
  }
}
