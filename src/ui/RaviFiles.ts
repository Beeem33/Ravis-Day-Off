import { ScamMe } from './ScamMe';

/**
 * The files on Ravi's desktop in Level 1, and the apps that open them.
 *
 * Ten things he should not have left on a work PC: a diary, a crypto pitch, a
 * budget in freefall, a dance rehearsal, a Diwali photo, a "free RAM"
 * download, a marriage biodata his mother has been editing, a "tax" folder
 * full of memes, the family group chat, and his ranked list of leave excuses.
 *
 * Each viewer draws itself into the window's content rect on the PC's canvas
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
}

export interface Viewer {
  draw(c: DeskCtx, r: Rect): void;
  /** Keys while its window is on top; true if used. */
  key?(e: KeyboardEvent, c: DeskCtx): boolean;
}

export type FileId =
  | 'diary'
  | 'excuses'
  | 'biodata'
  | 'budget'
  | 'pitch'
  | 'dance'
  | 'diwali'
  | 'chat'
  | 'tax'
  | 'ram'
  | 'meme1'
  | 'meme2'
  | 'meme3'
  | 'taxtxt'
  | 'scamme';

type IconKind = 'txt' | 'doc' | 'xls' | 'ppt' | 'mp4' | 'jpg' | 'exe' | 'folder' | 'html' | 'scamme';

export interface FileDef {
  id: FileId;
  name: string;
  /** The name broken onto lines under its desktop icon. */
  label: string[];
  icon: IconKind;
  title: string;
  w: number;
  h: number;
}

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const MONO = 'Consolas, "Courier New", monospace';
const IMPACT = 'Impact, "Arial Black", sans-serif';

export const FILES: FileDef[] = [
  { id: 'diary', name: 'Dear_Diary_DO_NOT_READ_MUMMY.txt', label: ['Dear_Diary_DO_', 'NOT_READ_', 'MUMMY.txt'], icon: 'txt', title: 'Dear_Diary_DO_NOT_READ_MUMMY.txt — Notepad', w: 780, h: 600 },
  { id: 'excuses', name: 'Leave_Excuses_MASTERLIST.txt', label: ['Leave_Excuses_', 'MASTERLIST.txt'], icon: 'txt', title: 'Leave_Excuses_MASTERLIST.txt — Notepad', w: 820, h: 600 },
  { id: 'biodata', name: 'Rishta_Biodata_Ravi (edited by Mummy).docx', label: ['Rishta_Biodata_', 'Ravi (edited', 'by Mummy).docx'], icon: 'doc', title: 'Rishta_Biodata_Ravi (edited by Mummy).docx — Word', w: 980, h: 700 },
  { id: 'budget', name: 'Monthly_Budget_FINAL.xlsx', label: ['Monthly_Budget_', 'FINAL.xlsx'], icon: 'xls', title: 'Monthly_Budget_FINAL.xlsx — Excel', w: 1000, h: 640 },
  { id: 'pitch', name: 'CurryCoin_Investor_Pitch_v7_FINAL.pptx', label: ['CurryCoin_', 'Investor_Pitch_', 'v7_FINAL.pptx'], icon: 'ppt', title: 'CurryCoin_Investor_Pitch_v7_FINAL.pptx — PowerPoint', w: 940, h: 640 },
  { id: 'dance', name: 'Ravi_Dance_Practice_Bunty_Wedding.mp4', label: ['Ravi_Dance_', 'Practice_Bunty_', 'Wedding.mp4'], icon: 'mp4', title: 'Ravi_Dance_Practice_Bunty_Wedding.mp4 — Media Player', w: 880, h: 600 },
  { id: 'diwali', name: 'Family_Photo_Diwali_2025.jpg', label: ['Family_Photo_', 'Diwali_2025.jpg'], icon: 'jpg', title: 'Family_Photo_Diwali_2025.jpg — Photos', w: 940, h: 640 },
  { id: 'chat', name: 'PARIVAAR_group_chat_backup.html', label: ['PARIVAAR_group_', 'chat_backup.html'], icon: 'html', title: 'PARIVAAR_group_chat_backup.html — Googel Chrome', w: 720, h: 700 },
  { id: 'tax', name: 'Tax Documents 2025 (DO NOT OPEN)', label: ['Tax Documents', '2025 (DO NOT', 'OPEN)'], icon: 'folder', title: 'Tax Documents 2025 (DO NOT OPEN)', w: 800, h: 480 },
  { id: 'ram', name: 'FREE_RAM_DOWNLOADER_100GB_REAL_NOT_VIRUS.exe', label: ['FREE_RAM_', 'DOWNLOADER_', '100GB_REAL.exe'], icon: 'exe', title: 'RAM Downloader Pro 4.2 Setup', w: 700, h: 470 },
  // Inside the "tax" folder
  { id: 'meme1', name: 'when_manager_says_quick_call.jpg', label: [], icon: 'jpg', title: 'when_manager_says_quick_call.jpg — Photos', w: 700, h: 600 },
  { id: 'meme2', name: 'relatives_asking_what_i_do.jpg', label: [], icon: 'jpg', title: 'relatives_asking_what_i_do.jpg — Photos', w: 700, h: 600 },
  { id: 'meme3', name: 'sharma_ji_ka_beta_vs_me.jpg', label: [], icon: 'jpg', title: 'sharma_ji_ka_beta_vs_me.jpg — Photos', w: 820, h: 560 },
  { id: 'taxtxt', name: 'actual_taxes.txt', label: [], icon: 'txt', title: 'actual_taxes.txt — Notepad', w: 600, h: 400 },
  { id: 'scamme', name: 'ScamMe', label: ['ScamMe'], icon: 'scamme', title: 'ScamMe — Office Chat', w: 960, h: 700 }
];

/** On the desktop, in this order, down the columns. */
export const DESKTOP_FILES: FileId[] = ['scamme', 'diary', 'excuses', 'biodata', 'budget', 'pitch', 'dance', 'diwali', 'chat', 'tax', 'ram'];

export function fileDef(id: FileId): FileDef {
  return FILES.find((f) => f.id === id)!;
}

export function isFile(app: string): app is FileId {
  return FILES.some((f) => f.id === app);
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

export function drawFileIcon(g: CanvasRenderingContext2D, kind: IconKind, x: number, y: number, s: number): void {
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

// =================================================================== Notepad

const DIARY = `DEAR DIARY  (PRIVATE!!!  MUMMY, THIS MEANS YOU)
===============================================

MONDAY
Mummy called 4 times before 9 AM. Topics covered:
  1. Did I eat
  2. Did I eat PROPERLY
  3. Sharma ji's son got promoted to "Senior Vice Associate"
  4. Did I eat
Told her I am also a Senior Associate. She asked "of what". I hung up.

TUESDAY
Priya from the front desk said "good morning" today.
Unclear if she said it to me or to the printer.
The printer did not reply. Taking this as a win.

WEDNESDAY
Ate the last samosa in the break room.
There is now a note on the fridge: "WHOEVER ATE THE SAMOSA, GOD IS WATCHING."
God has not said anything yet. Gary has. Gary is not God.

THURSDAY
Manager said "quick call" at 4:55 PM.
The call ended at 7:40 PM.
There is no such thing as a quick call. There is only suffering.

FRIDAY
Booked my DAY OFF. First one in 14 months.
THE PLAN:
  - sleep till 11
  - Mummy's rajma chawal
  - India match on TV
  - NO phone, NO calls, NO drama
What could possibly go wrong.

SATURDAY  (day off)
Manager called. "Small favour, 10 minutes only, just sign one document."
I am at the office.
The day off is now "day off (pending)".

P.S. If anybody finds this diary: I was framed. For everything.
P.P.S. Mummy if this is you, the rajma was very good. Please close this file.`;

const EXCUSES = `LEAVE EXCUSES — MASTER LIST            (updated after every rejection)
Rating:  ★ = rejected on the spot    ★★★★★ = got the day off
-------------------------------------------------------------------

 1. Grandmother's funeral ............................... ★★★★★
      Used 6 times. Dadi is alive and active in the family group.
      She sends "🙏" every morning at 5 AM. Manager has not noticed.

 2. "Stomach issue" ...................................... ★★★★
      Manager never asks a follow-up question. Never. Not once.

 3. Cousin's wedding ..................................... ★★★
      Have now used 11 cousins. I have 9 cousins.

 4. "Internet is down at home" ........................... ★
      Manager: "Then come to the office. The internet is here."

 5. India vs Pakistan match .............................. ★★★★★
      Manager also took leave. Saw him in the stadium, face painted.
      We made eye contact. We do not speak of it.

 6. Astrologer says Saturn is in a bad position ........... ★★
      Manager: "Saturn is not your manager. I am your manager."

 7. Mummy's orders ....................................... ★★★★
      Nobody argues with a mother. Not even HR.

 8. Power cut ............................................ ★
      Called from the office landline. Rookie mistake.

 9. "My Wi-Fi password expired" ........................... ★
      This is not a thing. I know that now.

10. The honest reason ("I am tired") ...................... ✗
      Never tried. Too dangerous.

-------------------------------------------------------------------
NEXT TIME: ask 3 weeks in advance, in writing, on a Monday, after
bringing laddoos for the whole floor.
Expected success rate: 40%.  With kaju katli: 55%.`;

const TAXES = `ACTUAL TAXES 2025

lol

(ask Papa)`;

class Notepad implements Viewer {
  private s = new Scroller();
  private lines: string[] = [];
  private width = -1;
  constructor(private body: string, private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    g.fillStyle = '#ffffff';
    g.fillRect(r.x, r.y, r.w, r.h);
    // Menu bar
    g.fillStyle = '#f7f7f7';
    g.fillRect(r.x, r.y, r.w, 30);
    ['File', 'Edit', 'View'].forEach((m, i) => {
      const mr = { x: r.x + 8 + i * 56, y: r.y + 3, w: 50, h: 24 };
      if (c.hoverId === `${this.id}:m${i}`) {
        g.fillStyle = '#e5e5e5';
        rr(g, mr.x, mr.y, mr.w, mr.h, 4);
        g.fill();
      }
      text(g, m, mr.x + 25, r.y + 20, `400 14px ${FONT}`, '#1f1f1f', 'center');
      c.hot(mr, `${this.id}:m${i}`, { down: () => c.say(m, 'Menus are view-only on this device. Like your career.') });
    });
    const area = { x: r.x, y: r.y + 31, w: r.w, h: r.h - 31 - 26 };
    g.font = `400 16px ${MONO}`;
    if (this.width !== area.w) {
      this.width = area.w;
      this.lines = this.body.split('\n').flatMap((l) => {
        const lead = l.match(/^ */)![0];
        return wrap(g, l.trimStart(), area.w - 40 - g.measureText(lead).width).map((w2) => lead + w2);
      });
    }
    const lh = 21;
    const content = this.lines.length * lh + 20;
    this.s.step(c.dt, content, area.h);
    clipTo(g, area);
    g.fillStyle = '#1f1f1f';
    this.lines.forEach((l, i) => {
      const y = area.y + 22 + i * lh - this.s.y;
      if (y > area.y - lh && y < area.y + area.h + lh) g.fillText(l, area.x + 14, y);
    });
    g.restore();
    scrollbar(g, area, this.s.y, content);
    c.hot(area, `${this.id}:text`, { wheel: (dy) => this.s.by(dy) });
    // Status bar
    g.fillStyle = '#f3f3f3';
    g.fillRect(r.x, r.y + r.h - 26, r.w, 26);
    text(g, `Ln ${1 + Math.floor(this.s.y / lh)}, Col 1      100%      Windows (CRLF)      UTF-8`, r.x + r.w - 16, r.y + r.h - 8, `400 13px ${FONT}`, '#555', 'right');
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.s.by(42);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.s.by(-42);
    else if (e.code === 'PageDown' || e.code === 'Space') this.s.by(300);
    else if (e.code === 'PageUp') this.s.by(-300);
    else return false;
    return true;
  }
}

// ======================================================= Word: the biodata

type Run = { t: string; del?: boolean; ins?: boolean; b?: boolean; i?: boolean };
type Para = { runs: Run[]; size?: number; center?: boolean; gap?: number; note?: string };

const BIODATA: Para[] = [
  { runs: [{ t: '✿  MARRIAGE BIODATA  ✿', b: true }], size: 26, center: true, gap: 6 },
  { runs: [{ t: 'Prepared by: Ravi. ', i: true }, { t: 'Improved', ins: true, i: true }, { t: ' by: Mummy.', ins: true, i: true }], center: true, size: 14, gap: 18 },
  { runs: [{ t: 'Name: ', b: true }, { t: 'Ravi' }] },
  { runs: [{ t: 'Height: ', b: true }, { t: "5' 6\"", del: true }, { t: " 5' 11\" (with shoes, standing on the stairs)", ins: true }], note: 'Mummy: Nobody measures. Trust me.' },
  { runs: [{ t: 'Education: ', b: true }, { t: 'B.Com (second attempt)', del: true }, { t: ' B.Com (with Distinction*)', ins: true }], note: 'Ravi: what distinction?   Mummy: *distinctly remembered' },
  { runs: [{ t: 'Occupation: ', b: true }, { t: 'Call centre, night shift', del: true }, { t: ' International Customer Relations Executive (Technology Sector, Global Clients)', ins: true }] },
  { runs: [{ t: 'Salary: ', b: true }, { t: '₹32,000 / month', del: true }, { t: ' Confidential (very good)', ins: true }] },
  { runs: [{ t: 'Hobbies: ', b: true }, { t: 'Gaming, sleeping, curry, more sleeping', del: true }, { t: ' Reading, yoga, classical music, helping elders cross the road', ins: true }], note: 'Ravi: I have never done yoga.   Mummy: You bent down to tie your shoe on Tuesday. Yoga.' },
  { runs: [{ t: 'Habits: ', b: true }, { t: 'No smoking, no drinking, ' }, { t: '4 cans of Deadbull a day', del: true }, { t: ' only coconut water', ins: true }] },
  { runs: [{ t: 'Cooking: ', b: true }, { t: 'Maggi', del: true }, { t: ' Expert in all cuisines (has watched MasterChef)', ins: true }] },
  { runs: [{ t: 'Family: ', b: true }, { t: 'Papa (retired, watches the news at full volume), Mummy (homemaker, CEO of everything), Dadi (very active in WhatsApp), dog: Tiger (good boy)' }] },
  { runs: [{ t: 'Looking for: ', b: true }, { t: 'Someone who also likes video games', del: true }, { t: ' Homely, educated, well-settled, knows cooking, from a good family, respects elders, likes long walks to the temple', ins: true }, { t: ' — and who will laugh at my jokes', b: true }], note: 'Mummy: Delete the last line.   Ravi: No.   Mummy: Ravi.   Ravi: It stays.' },
  { runs: [{ t: 'Contact: ', b: true }, { t: "Ravi's mobile", del: true }, { t: " Mummy's mobile ONLY. Do not call Ravi, he will say something.", ins: true }], gap: 22 },
  { runs: [{ t: 'Note to all aunties forwarding this: the photo on page 2 was taken with the beauty filter on. Ravi does not look like that. Ravi did not agree to the filter.', i: true }], size: 13 }
];

class WordDoc implements Viewer {
  private s = new Scroller();
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    // The ribbon
    g.fillStyle = '#2b579a';
    g.fillRect(r.x, r.y, r.w, 34);
    ['File', 'Home', 'Insert', 'Layout', 'Review'].forEach((m, i) => text(g, m, r.x + 20 + i * 70, r.y + 22, `${m === 'Review' ? 600 : 400} 14px ${FONT}`, '#ffffff'));
    g.fillStyle = '#c0392b';
    rr(g, r.x + r.w - 270, r.y + 6, 254, 22, 11);
    g.fill();
    text(g, 'TRACK CHANGES: ON  (user: MUMMY)', r.x + r.w - 143, r.y + 22, `700 12px ${FONT}`, '#ffffff', 'center');
    const area = { x: r.x, y: r.y + 34, w: r.w, h: r.h - 34 };
    g.fillStyle = '#e6e6e6';
    g.fillRect(area.x, area.y, area.w, area.h);
    const notesW = 250;
    const pageW = Math.min(620, area.w - notesW - 60);
    const px = area.x + Math.max(20, (area.w - notesW - pageW) / 2 - 10);
    // Lay the paragraphs out once per frame (cheap enough)
    type Piece = { t: string; x: number; y: number; run: Run; size: number };
    const pieces: Piece[] = [];
    const notes: { y: number; t: string }[] = [];
    let y = 56;
    for (const p of BIODATA) {
      const size = p.size ?? 16;
      const lh = size * 1.55;
      const lineStart = y;
      // Words with their runs, wrapped across runs
      const words: { t: string; run: Run }[] = [];
      for (const run of p.runs) for (const w of run.t.split(/(?<= )/)) if (w) words.push({ t: w, run });
      let line: { t: string; run: Run; w: number }[] = [];
      let lw = 0;
      const flush = (): void => {
        let x = p.center ? (pageW - lw) / 2 : 50;
        for (const piece of line) {
          pieces.push({ t: piece.t, x, y, run: piece.run, size });
          x += piece.w;
        }
        line = [];
        lw = 0;
        y += lh;
      };
      for (const w of words) {
        g.font = `${w.run.b ? 700 : 400} ${w.run.i ? 'italic ' : ''}${size}px ${FONT}`.replace(/^(\d+) italic/, 'italic $1');
        const ww = g.measureText(w.t).width;
        if (lw + ww > pageW - 100 && line.length) flush();
        line.push({ t: w.t, run: w.run, w: ww });
        lw += ww;
      }
      flush();
      if (p.note) notes.push({ y: lineStart, t: p.note });
      y += p.gap ?? 8;
    }
    const content = y + 60;
    this.s.step(c.dt, content, area.h);
    clipTo(g, area);
    const top = area.y + 20 - this.s.y;
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.2)';
    g.shadowBlur = 8;
    g.fillRect(px, top, pageW, content - 20);
    g.shadowBlur = 0;
    g.shadowColor = 'transparent';
    for (const pc of pieces) {
      const font = `${pc.run.i ? 'italic ' : ''}${pc.run.b ? 700 : 400} ${pc.size}px ${FONT}`;
      const col = pc.run.del ? '#c0392b' : pc.run.ins ? '#1f5fbf' : '#1f1f1f';
      text(g, pc.t, px + pc.x, top + pc.y, font, col);
      g.font = font;
      const w = g.measureText(pc.t.trimEnd()).width;
      if (pc.run.del) {
        g.fillStyle = '#c0392b';
        g.fillRect(px + pc.x, top + pc.y - pc.size * 0.32, w, 1.6);
      } else if (pc.run.ins) {
        g.fillStyle = '#1f5fbf';
        g.fillRect(px + pc.x, top + pc.y + 3, w, 1.4);
      }
    }
    // Margin comments
    const nx = px + pageW + 14;
    let lastBottom = -Infinity;
    g.font = `400 13px ${FONT}`;
    for (const n of notes) {
      const lines = wrap(g, n.t, notesW - 28);
      const ny = Math.max(top + n.y - 18, lastBottom + 8);
      const h = lines.length * 17 + 14;
      g.fillStyle = '#fff4c2';
      rr(g, nx, ny, notesW - 10, h, 5);
      g.fill();
      g.strokeStyle = '#e0c060';
      g.lineWidth = 1;
      g.stroke();
      g.strokeStyle = 'rgba(224, 192, 96, 0.8)';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(px + pageW - 40, top + n.y - 5);
      g.lineTo(nx, ny + 12);
      g.stroke();
      g.setLineDash([]);
      lines.forEach((l, i) => text(g, l, nx + 9, ny + 18 + i * 17, `400 13px ${FONT}`, '#4a3b10'));
      lastBottom = ny + h;
    }
    g.restore();
    scrollbar(g, area, this.s.y, content);
    c.hot(area, `${this.id}:page`, { wheel: (dy) => this.s.by(dy) });
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.s.by(42);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.s.by(-42);
    else if (e.code === 'PageDown' || e.code === 'Space') this.s.by(300);
    else if (e.code === 'PageUp') this.s.by(-300);
    else return false;
    return true;
  }
}

// ====================================================== Excel: the budget

type Cell = { v: string; f?: string; neg?: boolean; b?: boolean; num?: boolean };
const SHEETS: { name: string; cols: number[]; rows: Cell[][] }[] = [
  {
    name: 'Budget',
    cols: [250, 100, 100, 340],
    rows: [
      [{ v: 'ITEM', b: true }, { v: 'PLANNED (₹)', b: true }, { v: 'ACTUAL (₹)', b: true }, { v: 'NOTES', b: true }],
      [{ v: 'Salary' }, { v: '32,000', num: true }, { v: '32,000', num: true }, { v: "after 'deductions' (nobody can explain these)" }],
      [{ v: 'Rent (paid to Papa)' }, { v: '8,000', num: true }, { v: '8,000', num: true }, { v: 'He makes me sign a receipt. He has a stamp.' }],
      [{ v: 'Chai' }, { v: '600', num: true }, { v: '4,250', num: true, neg: true }, { v: 'Ramesh bhaiya’s stall has a loyalty card now. I am Gold.' }],
      [{ v: 'Deadbull™' }, { v: '0', num: true }, { v: '3,100', num: true, neg: true }, { v: 'medical expense' }],
      [{ v: 'Gym membership' }, { v: '1,500', num: true }, { v: '1,500', num: true }, { v: 'Visits: 1 (went to cancel it, they talked me out of it)' }],
      [{ v: 'Mummy "loan"' }, { v: '0', num: true }, { v: '5,000', num: true, neg: true }, { v: '"loan"' }],
      [{ v: 'Cousin Bunty "loan"' }, { v: '0', num: true }, { v: '2,500', num: true, neg: true }, { v: 'will never see this money again. accepted.' }],
      [{ v: 'Wedding gifts (cousins)' }, { v: '2,000', num: true }, { v: '9,000', num: true, neg: true }, { v: '3 weddings in ONE month. Who approved this.' }],
      [{ v: 'Curry delivery' }, { v: '1,000', num: true }, { v: '6,780', num: true, neg: true }, { v: 'Curry Express knows my name, my order and my sins' }],
      [{ v: '' }, { v: '' }, { v: '' }, { v: '' }],
      [{ v: 'SAVINGS', b: true }, { v: '10,000', num: true, b: true }, { v: '-8,130', num: true, neg: true, b: true, f: '=C2-SUM(C3:C10)-HOPE' }, { v: 'Savings are also emotionally negative', b: true }],
      [{ v: '' }, { v: '' }, { v: '' }, { v: '' }],
      [{ v: 'Months until financial freedom', b: true }, { v: '' }, { v: '#DIV/0!', neg: true, f: '=FREEDOM/SALARY' }, { v: 'Excel is also confused' }]
    ]
  },
  {
    name: "Sharma ji's son",
    cols: [260, 160, 120, 300],
    rows: [
      [{ v: 'His salary:', b: true }, { v: 'Too much.', f: '=MY_SALARY*14' }, { v: '' }, { v: '' }],
      [{ v: 'His car:', b: true }, { v: 'German.', f: '=IMPORTED("yes")' }, { v: '' }, { v: '' }],
      [{ v: 'Times Mummy mentioned him this month:', b: true }, { v: '47', num: true, f: '=COUNTIF(EVERY_CALL,"Sharma ji")' }, { v: '' }, { v: '' }],
      [{ v: '' }, { v: '' }, { v: '' }, { v: '' }],
      [{ v: 'Why I made this sheet:', b: true }, { v: 'I do not know. Close it.' }, { v: '' }, { v: '' }]
    ]
  },
  { name: 'DO NOT OPEN', cols: [300, 100, 100, 300], rows: [[{ v: 'I said do not open.', b: true }]] }
];

class Sheet implements Viewer {
  private tab = 0;
  private sel: [number, number] = [11, 2];
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    const sheet = SHEETS[this.tab];
    g.fillStyle = '#217346';
    g.fillRect(r.x, r.y, r.w, 32);
    ['File', 'Home', 'Insert', 'Formulas', 'Data', 'Review'].forEach((m, i) => text(g, m, r.x + 18 + i * 76, r.y + 21, `400 14px ${FONT}`, '#ffffff'));
    // Formula bar
    g.fillStyle = '#ffffff';
    g.fillRect(r.x, r.y + 32, r.w, 34);
    g.strokeStyle = '#d4d4d4';
    g.lineWidth = 1;
    g.strokeRect(r.x + 8, r.y + 38, 70, 22);
    const [sr, sc] = this.sel;
    const cell = sheet.rows[sr]?.[sc];
    text(g, `${'ABCD'[sc]}${sr + 1}`, r.x + 43, r.y + 54, `400 14px ${FONT}`, '#1f1f1f', 'center');
    text(g, 'fx', r.x + 92, r.y + 54, `italic 400 15px ${FONT}`, '#666');
    text(g, cell ? cell.f ?? cell.v : '', r.x + 120, r.y + 54, `400 15px ${FONT}`, '#1f1f1f');
    // The grid
    const gx = r.x + 40;
    const gy = r.y + 66 + 24;
    const rh = 28;
    g.fillStyle = '#f3f3f3';
    g.fillRect(r.x, r.y + 66, r.w, 24);
    g.fillRect(r.x, r.y + 66, 40, r.h - 66 - 30);
    let x = gx;
    sheet.cols.forEach((w, i) => {
      text(g, 'ABCD'[i], x + w / 2, r.y + 83, `400 13px ${FONT}`, '#444', 'center');
      x += w;
    });
    const rows = Math.max(sheet.rows.length + 4, 18);
    for (let i = 0; i < rows; i++) {
      const y = gy + i * rh;
      if (y > r.y + r.h - 30) break;
      text(g, String(i + 1), r.x + 20, y + 19, `400 13px ${FONT}`, '#444', 'center');
      let cx = gx;
      sheet.cols.forEach((w, j) => {
        const cr = { x: cx, y, w, h: rh };
        g.strokeStyle = '#e1e1e1';
        g.strokeRect(cr.x, cr.y, cr.w, cr.h);
        const ce = sheet.rows[i]?.[j];
        if (ce && ce.v) {
          const col = ce.neg ? '#c0392b' : '#1f1f1f';
          g.save();
          g.beginPath();
          g.rect(cr.x, cr.y, cr.w - 2, cr.h);
          g.clip();
          text(g, ce.v, ce.num || ce.v.startsWith('#') ? cr.x + cr.w - 8 : cr.x + 6, y + 19, `${ce.b ? 700 : 400} 14px ${FONT}`, col, ce.num || ce.v.startsWith('#') ? 'right' : 'left');
          g.restore();
        }
        c.hot(cr, `${this.id}:c${i}_${j}`, {
          down: () => {
            this.sel = [i, j];
          }
        });
        cx += w;
      });
    }
    // Selection
    const sx = gx + sheet.cols.slice(0, sc).reduce((a, b) => a + b, 0);
    g.strokeStyle = '#217346';
    g.lineWidth = 2.5;
    g.strokeRect(sx, gy + sr * rh, sheet.cols[sc], rh);
    // Tabs
    const ty = r.y + r.h - 30;
    g.fillStyle = '#f3f3f3';
    g.fillRect(r.x, ty, r.w, 30);
    let tx = r.x + 50;
    SHEETS.forEach((s, i) => {
      g.font = `${i === this.tab ? 700 : 400} 13px ${FONT}`;
      const tw = g.measureText(s.name).width + 30;
      const tr = { x: tx, y: ty, w: tw, h: 28 };
      if (i === this.tab) {
        g.fillStyle = '#ffffff';
        g.fillRect(tr.x, tr.y, tr.w, tr.h);
        g.fillStyle = '#217346';
        g.fillRect(tr.x, tr.y + tr.h - 3, tr.w, 3);
      }
      text(g, s.name, tr.x + tw / 2, ty + 19, `${i === this.tab ? 700 : 400} 13px ${FONT}`, i === this.tab ? '#217346' : '#333', 'center');
      c.hot(tr, `${this.id}:tab${i}`, {
        down: () => {
          this.tab = i;
          this.sel = [0, 1];
        }
      });
      tx += tw + 2;
    });
  }
}

// ================================================== PowerPoint: CurryCoin

type Slide = { title: string; sub?: string; bullets?: string[]; bg: [string, string]; chart?: boolean; big?: string };
const SLIDES: Slide[] = [
  { title: 'CURRYCOIN', big: '🍛', sub: "The world's first blockchain backed by butter chicken", bullets: ['Founder, CEO, CFO, CTO & Intern: Ravi'], bg: ['#5a1a00', '#d9771c'] },
  { title: 'THE PROBLEM', bullets: ['Money is boring', 'Curry is delicious', 'Nobody has ever combined them', '(We checked on Googel for four whole minutes)'], bg: ['#1b2a4a', '#2b4c7e'] },
  { title: 'THE SOLUTION', bullets: ['Every CurryCoin is backed by 1 (one) bowl of curry', "Stored securely in Mummy's fridge, behind the pickle jars", 'Proof-of-Taste: every block is personally tasted by Mummy', 'Gas fees are paid in actual gas (cylinder delivery pending)'], bg: ['#0f3d2e', '#1f7a5a'] },
  { title: 'MARKET SIZE', chart: true, bg: ['#2a1a4a', '#5a3a8a'] },
  { title: 'ROADMAP', bullets: ['Q1 — Launch coin', 'Q2 — To the moon', 'Q3 — Lamborghini (used is fine)', 'Q4 — Explain to Papa what crypto is (stretch goal)', 'Q5 — Explain it to Dadi (impossible)'], bg: ['#4a1030', '#9a2a5a'] },
  { title: 'THE ASK', bullets: ['₹50,000 for 0.001% of the company', 'We accept: UPI, cash, leftover laddoos', "Investors so far: Mummy (₹500, 'for chai')", 'Questions? No.'], bg: ['#3a2a00', '#b8860b'] }
];

class Slides implements Viewer {
  private i = 0;
  constructor(private id: FileId) {}

  private go(d: number): void {
    this.i = Math.max(0, Math.min(SLIDES.length - 1, this.i + d));
  }

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    g.fillStyle = '#d24726';
    g.fillRect(r.x, r.y, r.w, 30);
    ['File', 'Home', 'Insert', 'Design', 'Slide Show'].forEach((m, i) => text(g, m, r.x + 18 + i * 80, r.y + 20, `400 14px ${FONT}`, '#ffffff'));
    g.fillStyle = '#2b2b2b';
    g.fillRect(r.x, r.y + 30, r.w, r.h - 30);
    // Thumbnails down the left
    const tw = 120;
    SLIDES.forEach((s, k) => {
      const tr = { x: r.x + 14, y: r.y + 44 + k * 78, w: tw, h: 68 };
      if (tr.y + tr.h > r.y + r.h - 50) return;
      const gr = g.createLinearGradient(tr.x, tr.y, tr.x + tw, tr.y + 68);
      gr.addColorStop(0, s.bg[0]);
      gr.addColorStop(1, s.bg[1]);
      g.fillStyle = gr;
      g.fillRect(tr.x, tr.y, tr.w, tr.h);
      if (k === this.i) {
        g.strokeStyle = '#f0a070';
        g.lineWidth = 3;
        g.strokeRect(tr.x - 2, tr.y - 2, tr.w + 4, tr.h + 4);
      }
      text(g, s.title, tr.x + tw / 2, tr.y + 38, `700 11px ${FONT}`, '#ffffff', 'center');
      c.hot(tr, `${this.id}:t${k}`, { down: () => (this.i = k) });
    });
    // The slide, 16:9
    const ax = r.x + tw + 34;
    const aw = r.w - tw - 54;
    const ah = r.h - 30 - 70;
    let sw = aw;
    let sh = (sw * 9) / 16;
    if (sh > ah) {
      sh = ah;
      sw = (sh * 16) / 9;
    }
    const sx = ax + (aw - sw) / 2;
    const sy = r.y + 44;
    const s = SLIDES[this.i];
    const k = sw / 960;
    const gr = g.createLinearGradient(sx, sy, sx + sw, sy + sh);
    gr.addColorStop(0, s.bg[0]);
    gr.addColorStop(1, s.bg[1]);
    g.fillStyle = gr;
    g.fillRect(sx, sy, sw, sh);
    text(g, s.title, sx + 60 * k, sy + 110 * k, `900 ${Math.round(64 * k)}px ${FONT}`, '#ffffff');
    if (s.big) text(g, s.big, sx + sw - 170 * k, sy + 200 * k, `${Math.round(150 * k)}px ${FONT}`, '#ffffff', 'center');
    if (s.sub) text(g, s.sub, sx + 60 * k, sy + 170 * k, `italic 400 ${Math.round(30 * k)}px ${FONT}`, '#ffe9c8');
    (s.bullets ?? []).forEach((b, n) => {
      const y = sy + (s.sub ? 300 : 210) * k + n * 66 * k;
      g.fillStyle = '#ffd38a';
      g.beginPath();
      g.arc(sx + 74 * k, y - 10 * k, 7 * k, 0, Math.PI * 2);
      g.fill();
      text(g, b, sx + 98 * k, y, `400 ${Math.round(30 * k)}px ${FONT}`, '#ffffff');
    });
    if (s.chart) {
      // People who eat curry vs people who understand crypto
      const base = sy + 420 * k;
      const bars: [string, string, number, string][] = [
        ['People who eat curry', '1.5 BILLION', 240, '#f2a93b'],
        ['People who understand crypto', '7', 2, '#6fd3ff']
      ];
      bars.forEach(([label, val, hgt, col], n) => {
        const bx = sx + (180 + n * 330) * k;
        g.fillStyle = col;
        g.fillRect(bx, base - Math.max(3, hgt) * k, 160 * k, Math.max(3, hgt) * k);
        text(g, val, bx + 80 * k, base - Math.max(3, hgt) * k - 14 * k, `800 ${Math.round(28 * k)}px ${FONT}`, '#ffffff', 'center');
        text(g, label, bx + 80 * k, base + 34 * k, `400 ${Math.round(20 * k)}px ${FONT}`, '#ffffff', 'center');
      });
      text(g, 'TOTAL ADDRESSABLE MARKET: 1,500,000,007', sx + sw / 2, sy + 512 * k, `800 ${Math.round(26 * k)}px ${FONT}`, '#ffe066', 'center');
    }
    text(g, `${this.i + 1}`, sx + sw - 24 * k, sy + sh - 18 * k, `400 ${Math.round(18 * k)}px ${FONT}`, 'rgba(255,255,255,0.7)', 'right');
    c.hot({ x: sx, y: sy, w: sw, h: sh }, `${this.id}:slide`, { down: () => this.go(1), wheel: (dy) => this.go(dy > 0 ? 1 : -1) });
    // Controls
    const cy = r.y + r.h - 40;
    const prev = { x: ax + aw / 2 - 120, y: cy, w: 60, h: 30 };
    const next = { x: ax + aw / 2 + 60, y: cy, w: 60, h: 30 };
    for (const [b, lab, d] of [
      [prev, '◀', -1],
      [next, '▶', 1]
    ] as [Rect, string, number][]) {
      g.fillStyle = c.hoverId === `${this.id}:${lab}` ? '#555' : '#3c3c3c';
      rr(g, b.x, b.y, b.w, b.h, 5);
      g.fill();
      text(g, lab, b.x + b.w / 2, b.y + 21, `400 16px ${FONT}`, '#ffffff', 'center');
      c.hot(b, `${this.id}:${lab}`, { down: () => this.go(d) });
    }
    text(g, `Slide ${this.i + 1} of ${SLIDES.length}`, ax + aw / 2, cy + 21, `400 15px ${FONT}`, '#dddddd', 'center');
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowRight' || e.code === 'Space' || e.code === 'KeyD' || e.code === 'PageDown') this.go(1);
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'PageUp') this.go(-1);
    else return false;
    return true;
  }
}

// ================================================ Media Player: the dance

const DANCE_LEN = 22;
const SUBS: [number, number, string][] = [
  [0, 3, '♪ (dhol intensifies) ♪'],
  [3, 6.5, "[Ravi enters. Does the 'screwing in a light bulb' move]"],
  [6.5, 10, '♪ Mera dil hai curry, tera pyaar hai naan ♪'],
  [10, 12.5, '♪ Tadka laga de, meri jaan, meri jaan ♪'],
  [12.5, 14.5, "[Ravi's elbow meets Mummy's good vase]"],
  [14.5, 17, 'MUMMY (off camera):  RAVIIIIII!!!'],
  [17, 19.5, '[music stops. Ravi becomes a statue. Statues cannot be scolded.]'],
  [19.5, 22, 'BUNTY (holding the phone):  bhaiya this is going on the family group']
];

class MediaPlayer implements Viewer {
  private t = 0;
  private playing = true;
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    if (this.playing) this.t = (this.t + c.dt) % DANCE_LEN;
    const t = this.t;
    const vid = { x: r.x, y: r.y, w: r.w, h: r.h - 56 };
    g.fillStyle = '#000';
    g.fillRect(r.x, r.y, r.w, r.h);
    // Fit a 16:9 frame
    let fw = vid.w;
    let fh = (fw * 9) / 16;
    if (fh > vid.h) {
      fh = vid.h;
      fw = (fh * 16) / 9;
    }
    const fx = vid.x + (vid.w - fw) / 2;
    const fy = vid.y + (vid.h - fh) / 2;
    const k = fw / 800;
    clipTo(g, { x: fx, y: fy, w: fw, h: fh });
    // The living room
    g.fillStyle = '#e7c98f';
    g.fillRect(fx, fy, fw, fh);
    g.fillStyle = '#8a5a3a';
    g.fillRect(fx, fy + fh * 0.72, fw, fh * 0.28);
    // A garland of marigolds across the top
    for (let i = 0; i < 26; i++) {
      g.fillStyle = i % 2 ? '#f39c12' : '#e67e22';
      g.beginPath();
      g.arc(fx + (i + 0.5) * (fw / 26), fy + 18 * k + Math.sin((i / 25) * Math.PI) * 26 * k, 8 * k, 0, Math.PI * 2);
      g.fill();
    }
    // Sofa, side table and THE vase
    g.fillStyle = '#7b2d26';
    rr(g, fx + 520 * k, fy + 300 * k, 230 * k, 90 * k, 12 * k);
    g.fill();
    g.fillStyle = '#5b3a1e';
    g.fillRect(fx + 120 * k, fy + 330 * k, 90 * k, 70 * k);
    const vaseFall = t > 12.7 ? Math.min(1, (t - 12.7) / 0.5) : 0;
    g.save();
    g.translate(fx + 165 * k, fy + 330 * k);
    g.rotate(vaseFall * 1.5);
    g.translate(vaseFall * 40 * k, vaseFall * 60 * k);
    g.fillStyle = '#2e86de';
    g.beginPath();
    g.ellipse(0, -30 * k, 18 * k, 30 * k, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f1c40f';
    g.fillRect(-14 * k, -34 * k, 28 * k, 5 * k);
    g.restore();
    // Party lights
    for (let i = 0; i < 5; i++) {
      const on = Math.sin(t * 6 + i * 1.7) > 0 && t < 17;
      g.fillStyle = on ? ['rgba(255,80,80,0.25)', 'rgba(80,200,255,0.25)', 'rgba(255,230,80,0.25)', 'rgba(180,90,255,0.25)', 'rgba(80,255,140,0.25)'][i] : 'rgba(0,0,0,0)';
      g.beginPath();
      g.arc(fx + (100 + i * 150) * k, fy + 120 * k, 70 * k, 0, Math.PI * 2);
      g.fill();
    }
    // Ravi, dancing (until he's a statue)
    const dancing = t > 3 && t < 17;
    const ph = t * 7.5;
    const cx = fx + (t < 3 ? 900 - t * 140 : 420 + (dancing ? Math.sin(ph * 0.5) * 30 : 0)) * k;
    const by = fy + 420 * k;
    const hip = dancing ? Math.sin(ph) * 12 : 0;
    g.strokeStyle = '#3b2a1e';
    g.lineCap = 'round';
    g.lineWidth = 12 * k;
    // legs
    g.beginPath();
    g.moveTo(cx + hip * k, by - 110 * k);
    g.lineTo(cx - 22 * k, by);
    g.moveTo(cx + hip * k, by - 110 * k);
    g.lineTo(cx + 22 * k + (dancing ? Math.sin(ph) * 10 * k : 0), by);
    g.stroke();
    // body (kurta)
    g.fillStyle = '#ffffff';
    rr(g, cx - 26 * k + hip * k, by - 210 * k, 52 * k, 110 * k, 14 * k);
    g.fill();
    g.strokeStyle = '#c8a24a';
    g.lineWidth = 3 * k;
    g.stroke();
    // arms: the light-bulb twist, then hands up, then the statue pose
    g.strokeStyle = '#8a5a3a';
    g.lineWidth = 10 * k;
    const sx2 = cx + hip * k;
    const sy2 = by - 195 * k;
    const statue = t >= 17;
    const up = statue ? 1 : dancing ? 0.5 + 0.5 * Math.sin(ph * 0.5) : 0;
    for (const s of [-1, 1]) {
      const ax = sx2 + s * (40 + 20 * up) * k;
      const ay = sy2 - (statue ? 70 : 60 * up) * k + (dancing ? Math.sin(ph + s) * 14 * k : 30 * k);
      g.beginPath();
      g.moveTo(sx2 + s * 22 * k, sy2);
      g.lineTo(ax, ay);
      g.stroke();
      if (dancing) {
        // twisting a light bulb
        g.fillStyle = '#8a5a3a';
        g.beginPath();
        g.arc(ax + Math.cos(ph * 2 * s) * 6 * k, ay + Math.sin(ph * 2 * s) * 6 * k, 8 * k, 0, Math.PI * 2);
        g.fill();
      }
    }
    // head
    g.fillStyle = '#8a5a3a';
    g.beginPath();
    g.arc(cx + hip * k, by - 240 * k, 30 * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1e140c';
    g.beginPath();
    g.arc(cx + hip * k, by - 252 * k, 30 * k, Math.PI * 1.05, Math.PI * 1.95);
    g.fill();
    // face: grin, then panic
    g.strokeStyle = '#1e140c';
    g.lineWidth = 3 * k;
    g.beginPath();
    if (t > 12.7) g.arc(cx + hip * k, by - 228 * k, 7 * k, 0, Math.PI * 2);
    else g.arc(cx + hip * k, by - 232 * k, 12 * k, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    // The vase in bits
    if (vaseFall >= 1) {
      g.fillStyle = '#2e86de';
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.arc(fx + (180 + i * 14) * k, fy + 452 * k - (i % 2) * 4 * k, 6 * k, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Phone-camera framing
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 2;
    g.strokeRect(fx + 10, fy + 10, 26, 0.01);
    text(g, '● REC  BUNTY_PHONE', fx + 16, fy + 26, `700 ${Math.max(11, Math.round(14 * k))}px ${FONT}`, '#ff4d4d');
    g.restore();
    // Subtitles
    const sub = SUBS.find(([a, b]) => t >= a && t < b);
    if (sub) {
      g.font = `600 ${Math.max(14, Math.round(22 * k))}px ${FONT}`;
      const tw = g.measureText(sub[2]).width + 28;
      g.fillStyle = 'rgba(0,0,0,0.65)';
      rr(g, fx + fw / 2 - tw / 2, fy + fh - 58 * k, tw, 36 * k, 4);
      g.fill();
      text(g, sub[2], fx + fw / 2, fy + fh - 33 * k, `600 ${Math.max(14, Math.round(22 * k))}px ${FONT}`, '#ffffff', 'center');
    }
    c.hot(vid, `${this.id}:frame`, { down: () => (this.playing = !this.playing) });
    // Controls
    const cy = r.y + r.h - 56;
    g.fillStyle = '#1c1c1c';
    g.fillRect(r.x, cy, r.w, 56);
    const pb = { x: r.x + 14, y: cy + 12, w: 32, h: 32 };
    g.fillStyle = '#ffffff';
    if (this.playing) {
      g.fillRect(pb.x + 8, pb.y + 7, 6, 18);
      g.fillRect(pb.x + 18, pb.y + 7, 6, 18);
    } else {
      g.beginPath();
      g.moveTo(pb.x + 9, pb.y + 6);
      g.lineTo(pb.x + 26, pb.y + 16);
      g.lineTo(pb.x + 9, pb.y + 26);
      g.fill();
    }
    c.hot(pb, `${this.id}:play`, { down: () => (this.playing = !this.playing) });
    const bar = { x: r.x + 60, y: cy + 24, w: r.w - 220, h: 8 };
    g.fillStyle = '#555';
    rr(g, bar.x, bar.y, bar.w, bar.h, 4);
    g.fill();
    g.fillStyle = '#e8473c';
    rr(g, bar.x, bar.y, Math.max(8, (bar.w * t) / DANCE_LEN), bar.h, 4);
    g.fill();
    c.hot({ x: bar.x, y: bar.y - 10, w: bar.w, h: 28 }, `${this.id}:seek`, { down: () => (this.t = Math.max(0, Math.min(0.999, (c.mx - bar.x) / bar.w)) * DANCE_LEN) });
    const fmt = (s: number): string => `0:${String(Math.floor(s)).padStart(2, '0')}`;
    text(g, `${fmt(t)} / ${fmt(DANCE_LEN)}`, r.x + r.w - 18, cy + 33, `400 14px ${FONT}`, '#dddddd', 'right');
    text(g, '🔇', r.x + r.w - 130, cy + 34, `16px ${FONT}`, '#ffffff', 'center');
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'Space' || e.code === 'KeyK') this.playing = !this.playing;
    else if (e.code === 'ArrowRight') this.t = Math.min(DANCE_LEN - 0.01, this.t + 3);
    else if (e.code === 'ArrowLeft') this.t = Math.max(0, this.t - 3);
    else return false;
    return true;
  }
}

// ======================================================= Photos: Diwali

type Person = { name: string; tag: string; x: number; h: number; outfit: string; trim: string; hair: string; extra?: 'phone' | 'thumbs' | 'blink' | 'glare' | 'dog' | 'specs' };
const FAMILY: Person[] = [
  { name: 'Dadi', tag: "'Why is the photo taking so long'", x: 110, h: 0.86, outfit: '#f4f4f4', trim: '#c0392b', hair: '#d8d8d8', extra: 'specs' },
  { name: 'Papa', tag: 'Checking the cricket score', x: 235, h: 1.02, outfit: '#f1e3c6', trim: '#8a6a2a', hair: '#555', extra: 'phone' },
  { name: 'Mummy', tag: 'Perfect. As always.', x: 355, h: 0.94, outfit: '#c2185b', trim: '#f1c40f', hair: '#1e140c' },
  { name: 'Ravi (me)', tag: 'Blinked. Take 14. They gave up.', x: 475, h: 1, outfit: '#2e86de', trim: '#f1c40f', hair: '#1e140c', extra: 'blink' },
  { name: 'Chachi', tag: 'Already judging the rangoli', x: 595, h: 0.93, outfit: '#27ae60', trim: '#f1c40f', hair: '#1e140c', extra: 'glare' },
  { name: 'Cousin Bunty', tag: 'Owes me ₹2,500', x: 715, h: 0.98, outfit: '#8e44ad', trim: '#ecf0f1', hair: '#1e140c', extra: 'thumbs' },
  { name: 'Tiger', tag: 'Only one who listened', x: 820, h: 0.4, outfit: '#c8873a', trim: '#000', hair: '#c8873a', extra: 'dog' }
];

class Photo implements Viewer {
  private tags = true;
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    g.fillStyle = '#1c1c1c';
    g.fillRect(r.x, r.y, r.w, r.h);
    // Toolbar
    if (this.id === 'diwali') {
      const tb = { x: r.x + r.w - 160, y: r.y + 8, w: 146, h: 28 };
      g.fillStyle = c.hoverId === `${this.id}:tags` ? '#3a3a3a' : '#2c2c2c';
      rr(g, tb.x, tb.y, tb.w, tb.h, 5);
      g.fill();
      text(g, this.tags ? '🏷  People tags: ON' : '🏷  People tags: OFF', tb.x + tb.w / 2, tb.y + 19, `400 13px ${FONT}`, '#ffffff', 'center');
      c.hot(tb, `${this.id}:tags`, { down: () => (this.tags = !this.tags) });
    }
    const area = { x: r.x + 16, y: r.y + 44, w: r.w - 32, h: r.h - 84 };
    // The photo, 900x560 design space, fitted
    const k = Math.min(area.w / 900, area.h / 560);
    const pw = 900 * k;
    const ph = 560 * k;
    const px = area.x + (area.w - pw) / 2;
    const py = area.y + (area.h - ph) / 2;
    clipTo(g, { x: px, y: py, w: pw, h: ph });
    if (this.id === 'diwali') this.diwali(g, c, px, py, k);
    else meme(g, this.id, px, py, k, c.time);
    g.restore();
    text(g, `${fileDef(this.id).name}   ·   1 of 1`, r.x + r.w / 2, r.y + r.h - 14, `400 13px ${FONT}`, '#bbbbbb', 'center');
  }

  private diwali(g: CanvasRenderingContext2D, c: DeskCtx, px: number, py: number, k: number): void {
    const P = (x: number, y: number): [number, number] => [px + x * k, py + y * k];
    // Night sky, a house front with string lights
    const sky = g.createLinearGradient(0, py, 0, py + 560 * k);
    sky.addColorStop(0, '#0b1030');
    sky.addColorStop(1, '#3a1d4a');
    g.fillStyle = sky;
    g.fillRect(px, py, 900 * k, 560 * k);
    g.fillStyle = '#c99a6b';
    g.fillRect(...P(0, 150), 900 * k, 300 * k);
    g.fillStyle = '#6b4226';
    g.fillRect(...P(380, 190), 140 * k, 260 * k);
    for (let i = 0; i < 30; i++) {
      const on = Math.sin(c.time * 4 + i) > -0.3;
      g.fillStyle = on ? ['#ffd34d', '#ff6b6b', '#6bd3ff', '#9bff6b'][i % 4] : '#5a4a3a';
      g.beginPath();
      g.arc(...P(15 + i * 30, 160 + Math.sin(i * 0.6) * 8), 5 * k, 0, Math.PI * 2);
      g.fill();
    }
    // Fireworks
    for (const [fx, fy, col] of [
      [120, 70, '#ffd34d'],
      [760, 60, '#ff6bd5']
    ] as [number, number, string][]) {
      g.strokeStyle = col;
      g.lineWidth = 2 * k;
      for (let a = 0; a < 12; a++) {
        const an = (a / 12) * Math.PI * 2;
        g.beginPath();
        g.moveTo(...P(fx + Math.cos(an) * 12, fy + Math.sin(an) * 12));
        g.lineTo(...P(fx + Math.cos(an) * 38, fy + Math.sin(an) * 38));
        g.stroke();
      }
    }
    // Floor and the rangoli
    g.fillStyle = '#a0522d';
    g.fillRect(...P(0, 450), 900 * k, 110 * k);
    const rc = P(450, 515);
    for (const [rad, col] of [
      [70, '#e74c3c'],
      [55, '#f1c40f'],
      [40, '#27ae60'],
      [25, '#3498db'],
      [10, '#ffffff']
    ] as [number, string][]) {
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(rc[0], rc[1], rad * k, rad * 0.35 * k, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Diyas along the front
    for (let i = 0; i < 9; i++) {
      const [dx, dy] = P(40 + i * 100, 470);
      g.fillStyle = '#b5651d';
      g.beginPath();
      g.ellipse(dx, dy, 14 * k, 6 * k, 0, 0, Math.PI);
      g.fill();
      g.fillStyle = '#ffcc33';
      g.beginPath();
      g.ellipse(dx, dy - 8 * k - Math.sin(c.time * 9 + i) * 1.5 * k, 4 * k, 9 * k, 0, 0, Math.PI * 2);
      g.fill();
    }
    // The family
    for (const p of FAMILY) {
      const foot = 455;
      if (p.extra === 'dog') {
        g.fillStyle = p.outfit;
        g.beginPath();
        g.ellipse(...P(p.x, foot - 28), 34 * k, 18 * k, 0, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(...P(p.x + 34, foot - 48), 16 * k, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#000';
        g.beginPath();
        g.arc(...P(p.x + 40, foot - 52), 2.5 * k, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = p.outfit;
        for (const lx of [-20, -6, 10, 22]) g.fillRect(...P(p.x + lx, foot - 16), 6 * k, 16 * k);
      } else {
        const H = 230 * p.h;
        const top = foot - H;
        // Body (kurta / saree)
        g.fillStyle = p.outfit;
        rr(g, ...P(p.x - 34, top + 52), 68 * k, (H - 52) * k, 14 * k);
        g.fill();
        g.fillStyle = p.trim;
        g.fillRect(...P(p.x - 34, foot - 22), 68 * k, 6 * k);
        g.fillRect(...P(p.x - 3, top + 56), 6 * k, (H - 80) * k);
        // Head
        g.fillStyle = '#8a5a3a';
        g.beginPath();
        g.arc(...P(p.x, top + 26), 26 * k, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = p.hair;
        g.beginPath();
        g.arc(...P(p.x, top + 18), 27 * k, Math.PI * 1.02, Math.PI * 1.98);
        g.fill();
        // Eyes
        g.fillStyle = '#1e140c';
        g.strokeStyle = '#1e140c';
        g.lineWidth = 2.5 * k;
        for (const s of [-1, 1]) {
          const [ex, ey] = P(p.x + s * 9, top + 26);
          if (p.extra === 'blink') {
            g.beginPath();
            g.moveTo(ex - 5 * k, ey);
            g.lineTo(ex + 5 * k, ey);
            g.stroke();
          } else if (p.extra === 'glare') {
            g.beginPath();
            g.moveTo(ex - 5 * k, ey - 4 * k * s);
            g.lineTo(ex + 5 * k, ey + 4 * k * s);
            g.stroke();
          } else {
            g.beginPath();
            g.arc(ex, ey, 2.8 * k, 0, Math.PI * 2);
            g.fill();
          }
        }
        if (p.extra === 'specs') {
          g.strokeStyle = '#444';
          g.lineWidth = 2 * k;
          for (const s of [-1, 1]) {
            g.beginPath();
            g.arc(...P(p.x + s * 9, top + 26), 8 * k, 0, Math.PI * 2);
            g.stroke();
          }
        }
        // Smile (Papa's is pointed down at the phone)
        g.strokeStyle = '#3a1e10';
        g.lineWidth = 2 * k;
        g.beginPath();
        g.arc(...P(p.x, top + 34), 8 * k, 0.15 * Math.PI, 0.85 * Math.PI);
        g.stroke();
        if (p.extra === 'phone') {
          g.fillStyle = '#111';
          g.fillRect(...P(p.x + 10, top + 90), 18 * k, 30 * k);
          g.fillStyle = '#6bd3ff';
          g.fillRect(...P(p.x + 12, top + 93), 14 * k, 22 * k);
        }
        if (p.extra === 'thumbs') {
          g.fillStyle = '#8a5a3a';
          g.beginPath();
          g.arc(...P(p.x + 46, top + 84), 10 * k, 0, Math.PI * 2);
          g.fill();
          g.fillRect(...P(p.x + 42, top + 62), 7 * k, 18 * k);
        }
      }
      if (this.tags) {
        // A tag under each face
        // Every other one higher, so neighbours' tags don't overlap
        const lift = (FAMILY.indexOf(p) % 2) * 50;
        const [tx, ty] = P(p.x, p.extra === 'dog' ? foot - 80 : foot - 230 * p.h - 20 - lift);
        g.font = `600 ${Math.max(10, Math.round(13 * k))}px ${FONT}`;
        const lines = [p.name, p.tag];
        const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 14;
        const by = ty - 38 * k;
        g.fillStyle = 'rgba(255,255,255,0.92)';
        rr(g, tx - w / 2, by, w, 34 * k + 6, 4);
        g.fill();
        text(g, p.name, tx, by + 15 * k, `700 ${Math.max(10, Math.round(13 * k))}px ${FONT}`, '#1f1f1f', 'center');
        text(g, p.tag, tx, by + 31 * k, `400 ${Math.max(9, Math.round(12 * k))}px ${FONT}`, '#444', 'center');
      }
    }
  }
}

/** The "tax documents": three memes, drawn in the 900x560 design space. */
function meme(g: CanvasRenderingContext2D, id: FileId, px: number, py: number, k: number, time: number): void {
  const P = (x: number, y: number): [number, number] => [px + x * k, py + y * k];
  const caption = (s: string, y: number, size = 54): void => {
    g.font = `${Math.round(size * k)}px ${IMPACT}`;
    g.textAlign = 'center';
    g.lineJoin = 'round';
    g.strokeStyle = '#000';
    g.lineWidth = 7 * k;
    g.strokeText(s, ...P(450, y));
    g.fillStyle = '#fff';
    g.fillText(s, ...P(450, y));
    g.textAlign = 'left';
  };
  if (id === 'meme1') {
    g.fillStyle = '#4a6a8a';
    g.fillRect(px, py, 900 * k, 560 * k);
    // A clock with its hands spinning, and a skeleton at the desk
    const [cx, cy] = P(250, 290);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(cx, cy, 110 * k, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#222';
    g.lineWidth = 6 * k;
    g.stroke();
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(time * 6) * 80 * k, cy + Math.sin(time * 6) * 80 * k);
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(time * 0.5) * 50 * k, cy + Math.sin(time * 0.5) * 50 * k);
    g.stroke();
    // Skeleton with a headset
    g.fillStyle = '#f2f2e8';
    g.beginPath();
    g.arc(...P(640, 230), 50 * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(...P(622, 225), 12 * k, 0, Math.PI * 2);
    g.arc(...P(658, 225), 12 * k, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#f2f2e8';
    g.lineWidth = 10 * k;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(...P(600, 300 + i * 22));
      g.lineTo(...P(680, 300 + i * 22));
      g.stroke();
    }
    g.strokeStyle = '#222';
    g.lineWidth = 6 * k;
    g.beginPath();
    g.arc(...P(640, 225), 62 * k, Math.PI, 0);
    g.stroke();
    g.fillStyle = '#5b3a1e';
    g.fillRect(...P(520, 420), 320 * k, 24 * k);
    caption('MANAGER: "QUICK CALL?"', 70);
    caption('THE CALL: 2 HOURS 45 MINUTES', 530);
  } else if (id === 'meme2') {
    g.fillStyle = '#d8a35a';
    g.fillRect(px, py, 900 * k, 560 * k);
    // Three aunties, one Ravi, sweating
    for (let i = 0; i < 3; i++) {
      const x = 170 + i * 130;
      g.fillStyle = ['#c2185b', '#27ae60', '#f39c12'][i];
      rr(g, ...P(x - 40, 250), 80 * k, 200 * k, 16 * k);
      g.fill();
      g.fillStyle = '#8a5a3a';
      g.beginPath();
      g.arc(...P(x, 220), 34 * k, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1e140c';
      g.beginPath();
      g.arc(...P(x, 196), 30 * k, Math.PI, 0);
      g.fill();
      g.fillStyle = '#c0392b';
      g.beginPath();
      g.arc(...P(x, 206), 4 * k, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#2e86de';
    rr(g, ...P(660, 250), 90 * k, 200 * k, 16 * k);
    g.fill();
    g.fillStyle = '#8a5a3a';
    g.beginPath();
    g.arc(...P(705, 220), 36 * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#6bd3ff';
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.ellipse(...P(668 + i * 22, 200 + (i % 2) * 18 + ((time * 40 + i * 13) % 30)), 4 * k, 7 * k, 0, 0, Math.PI * 2);
      g.fill();
    }
    caption('AUNTIES: "SO WHAT DO YOU DO, BETA?"', 70, 46);
    caption('ME: "...IT\'S COMPLICATED, AUNTY"', 530, 50);
  } else {
    // Two panels: him / me
    g.fillStyle = '#f5f5f5';
    g.fillRect(px, py, 900 * k, 560 * k);
    g.fillStyle = '#ffe9a8';
    g.fillRect(...P(0, 0), 450 * k, 560 * k);
    g.fillStyle = '#d6e4f0';
    g.fillRect(...P(450, 0), 450 * k, 560 * k);
    g.fillStyle = '#222';
    g.fillRect(...P(447, 0), 6 * k, 560 * k);
    const head = (x: number, col: string, crown: boolean): void => {
      g.fillStyle = col;
      rr(g, ...P(x - 50, 250), 100 * k, 190 * k, 18 * k);
      g.fill();
      g.fillStyle = '#8a5a3a';
      g.beginPath();
      g.arc(...P(x, 210), 44 * k, 0, Math.PI * 2);
      g.fill();
      if (crown) {
        g.fillStyle = '#f1c40f';
        g.beginPath();
        g.moveTo(...P(x - 40, 168));
        g.lineTo(...P(x - 40, 128));
        g.lineTo(...P(x - 20, 150));
        g.lineTo(...P(x, 120));
        g.lineTo(...P(x + 20, 150));
        g.lineTo(...P(x + 40, 128));
        g.lineTo(...P(x + 40, 168));
        g.fill();
      }
    };
    head(225, '#1b2a4a', true);
    head(675, '#7f8c8d', false);
    // A samosa in Ravi's hand
    g.fillStyle = '#d4a03a';
    g.beginPath();
    g.moveTo(...P(740, 330));
    g.lineTo(...P(790, 300));
    g.lineTo(...P(790, 350));
    g.fill();
    caption("SHARMA JI'S SON", 70, 44);
    g.font = `${Math.round(30 * k)}px ${IMPACT}`;
    const left = ['IIT', 'IIM', 'NASA INTERN', 'MARRIED, 2 KIDS, 3 FLATS'];
    const right = ['ME:', 'FOUND A SAMOSA', 'IN MY POCKET', '(IT WAS GOOD)'];
    const col = (lines: string[], x: number): void =>
      lines.forEach((l, i) => {
        g.textAlign = 'center';
        g.strokeStyle = '#000';
        g.lineWidth = 5 * k;
        g.fillStyle = '#fff';
        g.strokeText(l, ...P(x, 410 + i * 36));
        g.fillText(l, ...P(x, 410 + i * 36));
        g.textAlign = 'left';
      });
    col(left, 225);
    col(right, 675);
  }
}

// ======================================================= Chrome: the chat

type Msg = { who: string; t?: string; time: string; img?: string };
const CHAT: Msg[] = [
  { who: 'Mama Ji', time: '5:02 AM', img: '🌻 GOOD MORNING 🌻\nHave a blessed Tuesday' },
  { who: 'Dadi', time: '5:03 AM', t: '🙏🙏🙏🙏🙏🙏🙏' },
  { who: 'Mummy', time: '8:40 AM', t: 'Ravi beta did you eat' },
  { who: 'Mummy', time: '8:52 AM', t: 'Ravi' },
  { who: 'Mummy', time: '9:10 AM', t: 'RAVI' },
  { who: 'Mummy', time: '9:14 AM', t: 'Seen at 9:11. No reply. OK. Fine.' },
  { who: 'Ravi', time: '9:15 AM', t: 'yes mummy i ate' },
  { who: 'Mummy', time: '9:15 AM', t: 'What did you eat' },
  { who: 'Ravi', time: '9:16 AM', t: 'food' },
  { who: 'Papa', time: '10:02 AM', t: 'Forwarded as received: NASA has confirmed that this Diwali the Earth will be closest to the Moon in 500 years. Share with 10 people for good luck.' },
  { who: 'Bunty', time: '10:03 AM', t: 'chachu NASA did not say this' },
  { who: 'Papa', time: '10:05 AM', t: 'Bunty you are not NASA' },
  { who: 'Chachi', time: '11:30 AM', t: "Did everyone see Sharma ji's son's new car? 😊😊" },
  { who: 'Mummy', time: '11:31 AM', t: 'Ravi also has a car' },
  { who: 'Ravi', time: '11:31 AM', t: 'mummy i have a cycle' },
  { who: 'Mummy', time: '11:32 AM', t: 'Ravi also has a car (edited)' },
  { who: 'Dadi', time: '12:00 PM', t: 'Who is this group' },
  { who: 'Bunty', time: '1:12 PM', t: 'Ravi bhaiya can u send ₹500 urgent. will return tomorrow' },
  { who: 'Ravi', time: '1:13 PM', t: 'you said that in 2021' },
  { who: 'Bunty', time: '1:13 PM', t: 'and has tomorrow come yet? no. so technically i am not lying' },
  { who: 'Mama Ji', time: '2:40 PM', img: '▶  DOCTORS HATE this one\nturmeric trick (Must Watch)' },
  { who: 'Mummy', time: '6:01 PM', t: "Ravi tomorrow is your day off na? Come home. Rajma is ready. Also Gupta aunty's niece is coming 'by chance'. Wear the blue shirt." },
  { who: 'Ravi', time: '6:05 PM', t: 'MUMMY' },
  { who: 'Mummy', time: '6:05 PM', t: 'Blue shirt.' },
  { who: 'Bunty', time: '6:06 PM', t: '😂😂😂 rishta incoming' },
  { who: 'Dadi', time: '6:30 PM', t: '🙏' }
];
const NAME_COL: Record<string, string> = { Mummy: '#c2185b', Papa: '#1565c0', Dadi: '#6a1b9a', Chachi: '#2e7d32', 'Mama Ji': '#e65100', Bunty: '#00838f' };

class Chat implements Viewer {
  private s = new Scroller();
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    // Header
    g.fillStyle = '#075e54';
    g.fillRect(r.x, r.y, r.w, 62);
    g.fillStyle = '#f39c12';
    g.beginPath();
    g.arc(r.x + 36, r.y + 31, 20, 0, Math.PI * 2);
    g.fill();
    text(g, '🪔', r.x + 36, r.y + 38, `18px ${FONT}`, '#fff', 'center');
    text(g, 'PARIVAAR ❤️ (Official)', r.x + 68, r.y + 27, `700 17px ${FONT}`, '#ffffff');
    text(g, 'Dadi, Papa, Mummy, Chachi, Mama Ji, Bunty, You', r.x + 68, r.y + 48, `400 13px ${FONT}`, '#cfe9e5');
    const area = { x: r.x, y: r.y + 62, w: r.w, h: r.h - 62 - 52 };
    g.fillStyle = '#ece5dd';
    g.fillRect(area.x, area.y, area.w, area.h);
    // Lay the bubbles out
    const maxW = Math.min(440, area.w * 0.7);
    let y = 16;
    const items: { m: Msg; lines: string[]; x: number; y: number; w: number; h: number; mine: boolean; showName: boolean }[] = [];
    let prev = '';
    g.font = `400 15px ${FONT}`;
    for (const m of CHAT) {
      const mine = m.who === 'Ravi';
      const showName = !mine && m.who !== prev;
      const body = m.img ?? m.t ?? '';
      const lines = body.split('\n').flatMap((l) => wrap(g, l, maxW - 24));
      const w = Math.min(maxW, Math.max(110, ...lines.map((l) => g.measureText(l).width + 24), showName ? g.measureText(m.who).width + 30 : 0));
      const h = (showName ? 20 : 0) + (m.img ? 96 : 0) + lines.length * 20 + 26;
      const x = mine ? area.w - w - 14 : 14;
      items.push({ m, lines, x, y, w, h, mine, showName });
      y += h + (m.who === prev ? 4 : 10);
      prev = m.who;
    }
    const content = y + 10;
    this.s.step(c.dt, content, area.h);
    clipTo(g, area);
    for (const it of items) {
      const bx = area.x + it.x;
      const by = area.y + it.y - this.s.y;
      if (by > area.y + area.h || by + it.h < area.y) continue;
      g.fillStyle = it.mine ? '#dcf8c6' : '#ffffff';
      rr(g, bx, by, it.w, it.h, 8);
      g.fill();
      let ty = by + 20;
      if (it.showName) {
        text(g, it.m.who, bx + 12, ty, `700 13px ${FONT}`, NAME_COL[it.m.who] ?? '#555');
        ty += 20;
      }
      if (it.m.img) {
        const ig = g.createLinearGradient(bx, ty - 10, bx + it.w, ty + 80);
        ig.addColorStop(0, it.m.img.startsWith('▶') ? '#333' : '#f9e79f');
        ig.addColorStop(1, it.m.img.startsWith('▶') ? '#7a1f1f' : '#f5b041');
        g.fillStyle = ig;
        rr(g, bx + 8, ty - 10, it.w - 16, 86, 6);
        g.fill();
        ty += 96;
        it.lines.forEach((l, i) => {
          text(g, l, bx + 12, ty - 82 + 26 + i * 22, `700 15px ${FONT}`, it.m.img!.startsWith('▶') ? '#ffffff' : '#7a3b00');
        });
        text(g, 'Forwarded many times', bx + 12, ty - 2, `italic 400 12px ${FONT}`, '#888');
        ty += 6;
      } else {
        it.lines.forEach((l, i) => text(g, l, bx + 12, ty + i * 20, `400 15px ${FONT}`, '#1f1f1f'));
      }
      text(g, it.m.time + (it.mine ? '  ✓✓' : ''), bx + it.w - 10, by + it.h - 8, `400 11px ${FONT}`, it.mine ? '#4fa3e0' : '#999', 'right');
    }
    g.restore();
    scrollbar(g, area, this.s.y, content);
    c.hot(area, `${this.id}:area`, { wheel: (dy) => this.s.by(dy) });
    // The input, which doesn't work for Ravi
    const ib = { x: r.x + 12, y: r.y + r.h - 44, w: r.w - 24, h: 36 };
    g.fillStyle = '#f0f0f0';
    g.fillRect(r.x, r.y + r.h - 52, r.w, 52);
    g.fillStyle = '#ffffff';
    rr(g, ib.x, ib.y, ib.w, ib.h, 18);
    g.fill();
    text(g, 'Only admins can send messages. Admin: Mummy', ib.x + 18, ib.y + 23, `italic 400 14px ${FONT}`, '#999');
    c.hot(ib, `${this.id}:input`, { down: () => c.say('PARIVAAR ❤️', 'You have been muted by Mummy (admin) until you wear the blue shirt.') });
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.s.by(50);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.s.by(-50);
    else if (e.code === 'PageDown' || e.code === 'Space') this.s.by(300);
    else if (e.code === 'PageUp') this.s.by(-300);
    else return false;
    return true;
  }
}

// ==================================================== Explorer: "taxes"

const TAX_ITEMS: { id: FileId; size: string; type: string }[] = [
  { id: 'meme1', size: '214 KB', type: 'JPG File' },
  { id: 'meme2', size: '188 KB', type: 'JPG File' },
  { id: 'meme3', size: '301 KB', type: 'JPG File' },
  { id: 'taxtxt', size: '1 KB', type: 'Text Document' }
];

class Folder implements Viewer {
  private sel = -1;
  constructor(private id: FileId) {}

  draw(c: DeskCtx, r: Rect): void {
    const g = c.g;
    g.fillStyle = '#ffffff';
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#f7f9fc';
    g.fillRect(r.x, r.y, r.w, 42);
    g.strokeStyle = '#d0d4da';
    g.lineWidth = 1;
    rr(g, r.x + 12, r.y + 8, r.w - 24, 26, 4);
    g.stroke();
    text(g, 'This PC  ›  Documents  ›  Tax Documents 2025 (DO NOT OPEN)', r.x + 24, r.y + 26, `400 14px ${FONT}`, '#1f1f1f');
    const lx = r.x + 20;
    text(g, 'Name', lx + 30, r.y + 66, `400 13px ${FONT}`, '#5f6368');
    text(g, 'Type', lx + 400, r.y + 66, `400 13px ${FONT}`, '#5f6368');
    text(g, 'Size', lx + 560, r.y + 66, `400 13px ${FONT}`, '#5f6368');
    g.fillStyle = '#ececec';
    g.fillRect(lx, r.y + 74, r.w - 40, 1);
    TAX_ITEMS.forEach((it, i) => {
      const y = r.y + 80 + i * 34;
      const rowR = { x: lx - 4, y, w: r.w - 32, h: 32 };
      const hid = `${this.id}:row${i}`;
      if (this.sel === i || c.hoverId === hid) {
        g.fillStyle = this.sel === i ? '#cce4f7' : '#eef4fb';
        g.fillRect(rowR.x, rowR.y, rowR.w, rowR.h);
      }
      drawFileIcon(g, fileDef(it.id).icon, lx + 2, y + 5, 22);
      text(g, fileDef(it.id).name, lx + 30, y + 21, `400 14px ${FONT}`, '#1f1f1f');
      text(g, it.type, lx + 400, y + 21, `400 14px ${FONT}`, '#5f6368');
      text(g, it.size, lx + 560, y + 21, `400 14px ${FONT}`, '#5f6368');
      c.hot(rowR, hid, { down: () => (this.sel = i), dbl: () => c.open(it.id) });
    });
    g.fillStyle = '#f7f9fc';
    g.fillRect(r.x, r.y + r.h - 26, r.w, 26);
    text(g, `${TAX_ITEMS.length} items   ·   0 actual tax documents`, r.x + 14, r.y + r.h - 8, `400 13px ${FONT}`, '#5f6368');
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
  switch (id) {
    case 'diary':
      return new Notepad(DIARY, id);
    case 'excuses':
      return new Notepad(EXCUSES, id);
    case 'taxtxt':
      return new Notepad(TAXES, id);
    case 'biodata':
      return new WordDoc(id);
    case 'budget':
      return new Sheet(id);
    case 'pitch':
      return new Slides(id);
    case 'dance':
      return new MediaPlayer(id);
    case 'diwali':
    case 'meme1':
    case 'meme2':
    case 'meme3':
      return new Photo(id);
    case 'chat':
      return new Chat(id);
    case 'tax':
      return new Folder(id);
    case 'scamme':
      return new ScamMe(id);
    case 'ram':
      return new Installer(id);
  }
}
