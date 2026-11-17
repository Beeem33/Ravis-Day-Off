import type { DeskCtx, Rect, Viewer } from './RaviFiles';

/**
 * ScamMe — the office's group-messaging app on Ravi's PC.
 *
 * A list of chats down the left (the team group and a direct message with
 * each coworker), the conversation on the right, and a box at the bottom
 * that takes real typing. Send something and the coworkers answer, live:
 * "typing…", then a reply. They are tired of Ravi. They do not like Ravi. The
 * more he messages, the worse it gets.
 */

type Pid = 'vikram' | 'priya' | 'gary' | 'deepak' | 'sunita';
type Who = Pid | 'ravi' | 'system';

interface Person {
  name: string;
  short: string;
  col: string;
  role: string;
}

const PEOPLE: Record<Pid, Person> = {
  vikram: { name: 'Vikram (Manager)', short: 'Vikram', col: '#c0392b', role: 'Floor Manager' },
  priya: { name: 'Priya', short: 'Priya', col: '#c2185b', role: 'Front desk' },
  gary: { name: 'Gary', short: 'Gary', col: '#2e7d32', role: 'Senior Associate (self-titled)' },
  deepak: { name: 'Deepak', short: 'Deepak', col: '#6a1b9a', role: 'Associate' },
  sunita: { name: 'Sunita (HR)', short: 'Sunita', col: '#1565c0', role: 'Human Resources' }
};
const PIDS = Object.keys(PEOPLE) as Pid[];

interface Msg {
  from: Who;
  text: string;
  time: string;
  likes: number;
}

interface Chat {
  id: string;
  name: string;
  group: boolean;
  with?: Pid;
  msgs: Msg[];
  unread: number;
  /** Ravi's messages here this session: they get shorter with him as it climbs. */
  sent: number;
  /** "Seen" under his last message in a DM. */
  seen: boolean;
}

interface Pending {
  chat: Chat;
  who: Who;
  text: string;
  typeAt: number;
  at: number;
  likes?: number;
}

// ================================================================== lines

const GENERIC: Record<Pid, string[]> = {
  vikram: [
    'Ravi, this is not the right channel for this.',
    "Let's take this offline. Permanently.",
    'Per my last message.',
    'Noted. And ignored.',
    "I'll add this to your performance review.",
    'Is this about work? No? Then no.',
    'Ravi. Quick call?',
    'Can you not.',
    'Please action this by never.'
  ],
  priya: [
    'ok',
    "ravi it's my lunch break 🙂",
    'who gave you my number',
    "i'm going to pretend i didn't see this",
    '👍',
    "that's nice. anyway—",
    'please stop',
    'k',
    'sorry who is this',
    'ravi i have a boyfriend. i also have a restraining order template.'
  ],
  gary: [
    'no',
    'nobody asked',
    'GOD IS WATCHING, RAVI',
    'I still want my samosa back',
    'lol no',
    'muting you',
    "Ravi I'm begging you",
    'blocked (emotionally)',
    'why are you like this'
  ],
  deepak: [
    'wow. riveting.',
    'cool story. send it to someone who cares',
    'did you just learn to type',
    '😐',
    'bro what',
    'not you again',
    'screenshotting this for the group',
    'ravi has entered the chat. i am leaving the chat.',
    'k bye'
  ],
  sunita: [
    'Ravi, this has been noted in your file.',
    'Please refrain from messaging colleagues outside work hours. Or inside them.',
    "Your message has been received and filed under 'R' for 'Ravi'.",
    'HR is not your friend, Ravi. HR is especially not YOUR friend.',
    'Please see me on Monday.',
    'This conversation may be used in a disciplinary hearing.',
    'Acknowledged. Unfortunately.'
  ]
};

const TOPICS: { re: RegExp; lines: Partial<Record<Pid, string[]>> }[] = [
  {
    re: /\b(hi+|hello+|hey+|yo|good morning|gm|namaste|sup|hii+)\b/i,
    lines: {
      priya: ['please stop saying good morning to me every day', 'hi ravi. bye ravi.'],
      gary: ['no', 'and you ruined it'],
      deepak: ['it WAS a good morning', 'oh no he can type'],
      vikram: ["Good morning. Why are you messaging on your day off? Actually, don't answer."],
      sunita: ['Hello Ravi. This conversation is being recorded for training purposes.']
    }
  },
  {
    re: /(day off|leave|holiday|vacation|off today|weekend)/i,
    lines: {
      vikram: ['About your day off… quick call?', 'Day off approved. Phone stays on.'],
      priya: ['you get a day off?? since when', "enjoy it! (please don't come back early)"],
      gary: ['enjoy it. far away. from us.', 'best news all year'],
      deepak: ["ravi's day off is literally the team's favourite holiday", 'we are throwing a party. for unrelated reasons.'],
      sunita: ['Your leave is approved, pending 14 signatures and a blood sample.']
    }
  },
  {
    re: /(samosa|curry|lunch|food|chai|biryani|pizza|eat|hungry|snack|tiffin)/i,
    lines: {
      gary: ['you ATE my SAMOSA', 'DO NOT bring up the samosa. YOU of all people.'],
      priya: ['please do not bring curry again', 'the floor STILL smells from last time'],
      deepak: ['is it the curry from last time. the HVAC filed a complaint.', 'we already ordered. for 5 people. there are 6 of us.'],
      vikram: ['Team lunch is for the team, Ravi.', 'Lunch is 30 minutes. Yours were 2 hours.'],
      sunita: ['Food in the office must be odour-free. That rule was written about you.']
    }
  },
  {
    re: /(sorry|apolog|my bad|forgive)/i,
    lines: {
      gary: ['apology not accepted. samosa not returned.'],
      priya: ["it's fine. (it's not fine)"],
      deepak: ['screenshotting this. evidence.'],
      vikram: ["Apologies don't hit targets."],
      sunita: ['Apology logged. File reference: RAVI-0447.']
    }
  },
  {
    re: /(friend|like me|love|miss (you|u)|hang ?out|party|drinks|bowling|movie|invite)/i,
    lines: {
      priya: ['ravi we are coworkers. barely.', 'we did go out. you were not invited. on purpose.'],
      gary: ['absolutely not', "the party is the day you're not there"],
      deepak: ['the group chat for the party is called "no ravi". this is not that chat. yet.'],
      vikram: ["There is no 'friend' in 'team'."],
      sunita: ['Please review the workplace relationships policy, pages 1 to 48.']
    }
  },
  {
    re: /(money|loan|borrow|₹|rupee|\bpay\b|salary|raise|bonus|lend)/i,
    lines: {
      vikram: ['No.', 'Raises are for people who answer the phone, Ravi.'],
      gary: ['you owe ME money. 40 rupees. samosa money.'],
      deepak: ['lol ask bunty'],
      priya: ['no ravi'],
      sunita: ['Salary queries take 6 to 8 business years to process.']
    }
  },
  {
    re: /(help|favou?r|can you|could you|please|pls|plz)/i,
    lines: {
      vikram: ['Sure. After you finish the 400 callbacks.'],
      priya: ["i'm busy (doing nothing)"],
      gary: ['no', 'help yourself. to my samosa. again.'],
      deepak: ['help is on the way. it got lost. permanently.'],
      sunita: ['Please submit a request form. The form is out of stock until 2031.']
    }
  },
  {
    re: /(call|customer|script|target|scam|work|shift|office|job|headset|boss)/i,
    lines: {
      vikram: ['Finally, a work question. Answer: do your job.', 'Your call numbers are the lowest on the floor. Including the printer.'],
      deepak: ["you're asking US how to do YOUR job?"],
      gary: ['maybe stop texting and start dialling'],
      priya: ['ravi your headset has been on mute for 3 days'],
      sunita: ['Work matters go to your manager. Your manager has muted you.']
    }
  },
  {
    re: /(police|raid|gun|shoot|shot|help me|someone is here|door|swat|agent|intruder|danger)/i,
    lines: {
      vikram: ['Ravi, if this is another fire-drill prank I swear.'],
      priya: ['lol ok', "is this like the time you said the vending machine was 'haunted'"],
      gary: ['good. maybe they can take you with them'],
      deepak: ['is this your new excuse to leave early'],
      sunita: ['Please fill in an incident report. In triplicate. By hand.']
    }
  },
  {
    re: /(hate|why .*(mean|rude)|don'?t like me|nobody likes|be nice|so mean)/i,
    lines: {
      priya: ["we don't hate you ravi. we just… prefer when you're not here."],
      gary: ['you know why. 🥟'],
      deepak: ["it's not hate. it's a lifestyle."],
      vikram: ["It's not personal. It's your performance. And your personality."],
      sunita: ['There is no record of anyone liking you, Ravi. We checked.']
    }
  },
  {
    re: /(cologne|perfume|deo|smell|fragrance)/i,
    lines: {
      deepak: ['is THAT what that smell is'],
      gary: ['the cologne is not helping, ravi'],
      priya: ['please stop wearing the curry one'],
      vikram: ['Fragrance-free office. Effective immediately. Because of you.'],
      sunita: ['We have received 11 complaints about a smell. All of them name you.']
    }
  },
  {
    re: /(terms|conditions|agree|sign)/i,
    lines: {
      vikram: ['Did you sign the Terms yet? It is literally your only task today.'],
      sunita: ['Sign the Terms, Ravi.', 'Section 7 is not optional.'],
      gary: ['just click I agree like a normal person'],
      deepak: ["he's reading ALL of them. psychopath."],
      priya: ['nobody reads those ravi']
    }
  },
  {
    re: /(dance|wedding|bunty|video|mummy|mom|family)/i,
    lines: {
      deepak: ['the vase video? bunty sent it to us. we watched it 40 times.'],
      gary: ["your cousin bunty is cooler than you and he's 19"],
      priya: ['your mom messaged me on facebook to ask if i cook'],
      vikram: ['Your mother called the office again. Twice.'],
      sunita: ['Your mother is not your emergency contact, Ravi. You listed her as your manager.']
    }
  },
  {
    re: /\b(lol|lmao|haha+|joke|funny|😂)\b/i,
    lines: {
      deepak: ['not funny', 'did you laugh at your own message'],
      gary: ['no'],
      priya: ['haha (sarcastic)'],
      vikram: ['Humour is not a KPI.'],
      sunita: ['Jokes are permitted on the last Friday of every leap year.']
    }
  }
];

const QUESTION: Record<Pid, string[]> = {
  vikram: ["I don't know. And I'm not going to find out."],
  priya: ['idk ask googel'],
  gary: ['why would I know that', 'no'],
  deepak: ['google it. no wait, googel it. that thing on your pc.'],
  sunita: ['Questions must be submitted in writing, 3 weeks in advance.']
};

const ESCALATE: Record<Pid, string[]> = {
  vikram: ['Ravi. Stop messaging. That is an instruction.', 'Every message you send is a mark on your review.'],
  priya: ["i'm turning off my notifications", 'ravi please. i am begging.'],
  gary: ['STOP. TEXTING.', 'i am going to throw my phone in the ganga'],
  deepak: ['bro it has been 4 minutes and you sent a novel', "i'm reporting this chat as spam"],
  sunita: ['Your messaging privileges are under review.', 'This is your final warning. (It is not. There will be more.)']
};

const PILE_ON = ['^ this', 'lmao', 'facts', '😂😂', 'ravi pls', 'seconded', 'why is he like this', '+1', 'what he said', 'agreed. no.'];

/** The team chat chatters on its own while the app is open. */
const AMBIENT: [Pid, string][][] = [
  [
    ['gary', 'who is microwaving fish'],
    ['priya', 'not me'],
    ['deepak', "it's ravi. it's always ravi."]
  ],
  [
    ['deepak', 'chai run, anyone? (not you ravi)'],
    ['priya', 'me!!'],
    ['vikram', 'Me. The good biscuits this time.']
  ],
  [
    ['vikram', 'Reminder: targets due at 5 PM.'],
    ['sunita', 'Reminder: no fish in the microwave. Ravi.']
  ],
  [
    ['gary', "ravi's day off is the best day of the year"],
    ['priya', 'honestly'],
    ['deepak', 'should we do a party'],
    ['sunita', 'Only if it is while he is off.']
  ],
  [
    ['priya', 'has anyone seen my stapler'],
    ['gary', 'check ravi’s desk'],
    ['priya', 'found it. it was in his desk. with my mug. and my plant.']
  ],
  [
    ['deepak', 'new rule: whoever replies to ravi buys chai for everyone'],
    ['gary', 'deal'],
    ['vikram', 'Approved.']
  ]
];

// ============================================================== history

const T = (h: number, m: number): string => `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;

function history(): Chat[] {
  const m = (from: Who, text: string, time: string, likes = 0): Msg => ({ from, text, time, likes });
  const group: Chat = {
    id: 'team',
    name: 'Floor 2 Team 🔥',
    group: true,
    unread: 3,
    sent: 0,
    seen: false,
    msgs: [
      m('vikram', 'Reminder: team lunch Friday, 1 PM 🍕', T(9, 2), 4),
      m('priya', 'yay!!', T(9, 3), 3),
      m('gary', 'finally', T(9, 3), 2),
      m('deepak', 'is ravi coming', T(9, 4), 1),
      m('sunita', "…it's a team lunch, Deepak.", T(9, 5), 0),
      m('deepak', "so that's a yes 😐", T(9, 5), 4),
      m('ravi', 'guys i will bring curry!!', T(9, 7), 0),
      m('gary', 'please do not', T(9, 7), 5),
      m('priya', 'last time the whole floor smelled like it for a week', T(9, 8), 4),
      m('ravi', 'that means it was good', T(9, 9), 0),
      m('vikram', 'It means the HVAC filed a complaint.', T(9, 9), 5),
      m('gary', 'Someone ate the last samosa in the fridge. I KNOW it was Ravi.', T(11, 40), 3),
      m('ravi', 'no comment', T(11, 52), 0),
      m('gary', 'GOD IS WATCHING, RAVI', T(11, 52), 5),
      m('sunita', 'Please keep this chat professional. Also Ravi, see me Monday.', T(12, 15), 2),
      m('system', 'Deepak changed the group avatar.', T(12, 30), 0),
      m('vikram', 'Ravi. Quick call?', T(16, 55), 1),
      m('ravi', 'it is 4:55', T(16, 55), 0),
      m('vikram', 'Quick call.', T(16, 56), 3)
    ]
  };
  const dm = (p: Pid, msgs: Msg[], unread = 0): Chat => ({ id: p, name: PEOPLE[p].name, group: false, with: p, msgs, unread, sent: 0, seen: true });
  return [
    group,
    dm('priya', [m('ravi', 'good morning priya!!', T(8, 1)), m('ravi', 'good morning', T(8, 30)), m('ravi', 'morning 🙂', T(9, 0)), m('priya', 'ravi this is the 41st good morning this month', T(9, 1))]),
    dm('gary', [m('gary', 'I know it was you.', T(11, 41)), m('ravi', 'what was me', T(11, 50)), m('gary', 'The samosa, Ravi.', T(11, 50)), m('gary', 'I will never forget.', T(11, 51))], 1),
    dm('vikram', [m('vikram', 'Ravi, small favour on your day off. 10 minutes only. Just sign one document.', T(7, 58)), m('ravi', 'sir it is my day off', T(8, 2)), m('vikram', 'Exactly. So you have time.', T(8, 2))], 1),
    dm('deepak', [m('ravi', 'bro are you coming to bunty’s wedding', T(19, 10)), m('deepak', 'who is bunty', T(21, 44)), m('deepak', 'and no', T(21, 44))]),
    dm('sunita', [m('sunita', 'Ravi, reminder that your Terms and Conditions are still unsigned.', T(8, 0)), m('sunita', 'Also, a coworker has reported a "suspicious samosa situation".', T(8, 1))], 1)
  ];
}

// ============================================================== helpers

const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const BLUE = '#2f6fdc';

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g: CanvasRenderingContext2D, s: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (g.measureText(t).width > max && line) {
      out.push(line);
      line = word;
    } else line = t;
  }
  out.push(line);
  return out;
}

function txt(g: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, fill: string, align: CanvasTextAlign = 'left'): void {
  g.font = font;
  g.fillStyle = fill;
  g.textAlign = align;
  g.fillText(s, x, y);
  g.textAlign = 'left';
}

function avatar(g: CanvasRenderingContext2D, who: Who | 'group', x: number, y: number, r: number): void {
  const col = who === 'ravi' ? '#e67e22' : who === 'group' ? BLUE : who === 'system' ? '#999' : PEOPLE[who].col;
  g.fillStyle = col;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  const ch = who === 'ravi' ? 'R' : who === 'group' ? '🔥' : who === 'system' ? '!' : PEOPLE[who].short[0];
  txt(g, ch, x, y + r * 0.36, `700 ${Math.round(r)}px ${FONT}`, '#ffffff', 'center');
}

function now(): string {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function shuffle<T2>(a: T2[]): T2[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

// ================================================================== app

export class ScamMe implements Viewer {
  private chats = history();
  private active = 0;
  private input = '';
  private focused = true;
  private pending: Pending[] = [];
  private used = new Map<string, Set<string>>();
  private scroll = 0;
  private maxScroll = 0;
  private stick = true;
  private nextAmbient = 18;
  private ambientI = 0;
  private time = 0;

  constructor(private id: string) {
    this.open(0);
  }

  private get chat(): Chat {
    return this.chats[this.active];
  }

  private open(i: number): void {
    this.active = i;
    this.chats[i].unread = 0;
    this.stick = true;
    this.focused = true;
  }

  // ------------------------------------------------------------ replies

  /** A line for `p` from `pool`, not one they've used lately. */
  private pick(p: Pid, pool: string[]): string {
    let used = this.used.get(p);
    if (!used) this.used.set(p, (used = new Set()));
    let fresh = pool.filter((l) => !used!.has(l));
    if (!fresh.length) {
      for (const l of pool) used.delete(l);
      fresh = pool;
    }
    const l = fresh[Math.floor(Math.random() * fresh.length)];
    used.add(l);
    return l;
  }

  private replyLine(p: Pid, said: string, sent: number): string {
    if (sent >= 5 && Math.random() < 0.35) return this.pick(p, ESCALATE[p]);
    for (const t of TOPICS) if (t.re.test(said) && t.lines[p]) return this.pick(p, t.lines[p]!);
    if (/\?\s*$/.test(said) && Math.random() < 0.6) return this.pick(p, QUESTION[p]);
    return this.pick(p, GENERIC[p]);
  }

  private queue(chat: Chat, who: Who, text: string, after: number, likes = 0): number {
    const typing = who === 'system' ? 0 : 0.9 + Math.min(2.6, text.length * 0.035) + Math.random() * 0.6;
    const typeAt = this.time + after;
    this.pending.push({ chat, who, text, typeAt, at: typeAt + typing, likes });
    return after + typing;
  }

  private send(): void {
    const said = this.input.trim();
    this.input = '';
    if (!said) return;
    const chat = this.chat;
    chat.msgs.push({ from: 'ravi', text: said, time: now(), likes: 0 });
    chat.sent++;
    chat.seen = false;
    this.stick = true;
    if (chat.group) {
      // One or two of them answer; the others like each other's messages
      const topical = TOPICS.find((t) => t.re.test(said));
      const order = shuffle(PIDS).sort((a, b) => Number(!!topical?.lines[b]) - Number(!!topical?.lines[a]));
      const first = order[0];
      let t = this.queue(chat, first, this.replyLine(first, said, chat.sent), 0.8 + Math.random() * 1.2, 1 + Math.floor(Math.random() * 4));
      if (Math.random() < 0.6) {
        const second = order[1];
        t = this.queue(chat, second, Math.random() < 0.5 ? PILE_ON[Math.floor(Math.random() * PILE_ON.length)] : this.replyLine(second, said, chat.sent), t + 0.4, 1 + Math.floor(Math.random() * 3));
      }
      if (chat.sent === 4) this.queue(chat, 'system', 'Deepak muted this conversation.', t + 1.2);
      if (chat.sent === 7) this.queue(chat, 'system', "Vikram (Manager) changed the group name to 'Floor 2 Team 🔥 (NO RAVI)'.", t + 1.5);
      if (chat.sent === 10) this.queue(chat, 'system', 'Gary left the group. Gary rejoined the group to say "no". Gary left the group.', t + 1.5);
    } else {
      const p = chat.with!;
      // Seen first; then, now and then, nothing at all
      setTimeout(() => (chat.seen = true), 900 + Math.random() * 900);
      if (chat.sent >= 4 && Math.random() < 0.3) return; // left on read
      this.queue(chat, p, this.replyLine(p, said, chat.sent), 1.6 + Math.random() * 2);
      if (Math.random() < 0.25) this.queue(chat, p, this.pick(p, GENERIC[p]), 4.5 + Math.random() * 2);
    }
  }

  private tick(dt: number): void {
    this.time += dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (this.time < p.at) continue;
      this.pending.splice(i, 1);
      p.chat.msgs.push({ from: p.who, text: p.text, time: now(), likes: 0 });
      if (p.who === 'system' && p.text.includes('changed the group name')) p.chat.name = 'Floor 2 Team 🔥 (NO RAVI)';
      if (p.chat !== this.chat) p.chat.unread++;
      // The others like it, a beat later. Nobody ever likes Ravi's.
      if (p.likes) {
        const msg = p.chat.msgs[p.chat.msgs.length - 1];
        setTimeout(() => (msg.likes = p.likes!), 900 + Math.random() * 1500);
      }
    }
    // The team chat carries on without him
    if (this.time > this.nextAmbient) {
      const team = this.chats[0];
      let t = 0;
      for (const [who, line] of AMBIENT[this.ambientI % AMBIENT.length]) t = this.queue(team, who, line, t + 0.6, Math.floor(Math.random() * 4)) ;
      this.ambientI++;
      this.nextAmbient = this.time + t + 25 + Math.random() * 20;
    }
  }

  // ---------------------------------------------------------------- draw

  draw(c: DeskCtx, r: Rect): void {
    this.tick(c.dt);
    const g = c.g;
    const sideW = Math.min(270, r.w * 0.34);
    // ---- the chat list
    g.fillStyle = '#f4f6fa';
    g.fillRect(r.x, r.y, sideW, r.h);
    g.fillStyle = BLUE;
    g.fillRect(r.x, r.y, sideW, 58);
    // logo: a bubble with a $
    g.fillStyle = '#ffffff';
    rr(g, r.x + 14, r.y + 13, 34, 28, 9);
    g.fill();
    g.beginPath();
    g.moveTo(r.x + 22, r.y + 39);
    g.lineTo(r.x + 18, r.y + 47);
    g.lineTo(r.x + 30, r.y + 40);
    g.fill();
    txt(g, '$', r.x + 31, r.y + 34, `900 20px ${FONT}`, BLUE, 'center');
    txt(g, 'ScamMe', r.x + 58, r.y + 36, `800 22px ${FONT}`, '#ffffff');
    this.chats.forEach((ch, i) => {
      const it = { x: r.x, y: r.y + 58 + i * 68, w: sideW, h: 68 };
      if (it.y + it.h > r.y + r.h) return;
      const hid = `${this.id}:chat${i}`;
      if (i === this.active || c.hoverId === hid) {
        g.fillStyle = i === this.active ? '#dfe8fb' : '#eaeef6';
        g.fillRect(it.x, it.y, it.w, it.h);
      }
      avatar(g, ch.group ? 'group' : ch.with!, it.x + 32, it.y + 34, 20);
      txt(g, ch.name, it.x + 62, it.y + 28, `700 15px ${FONT}`, '#1f1f1f');
      const last = ch.msgs[ch.msgs.length - 1];
      const typing = this.pending.some((p) => p.chat === ch && this.time >= p.typeAt && p.who !== 'system');
      g.font = `400 13px ${FONT}`;
      let prev = typing ? 'typing…' : last ? `${last.from === 'ravi' ? 'You: ' : last.from === 'system' ? '' : PEOPLE[last.from as Pid].short + ': '}${last.text}` : '';
      if (g.measureText(prev).width > sideW - 100) {
        while (prev.length > 3 && g.measureText(prev + '…').width > sideW - 100) prev = prev.slice(0, -1);
        prev += '…';
      }
      txt(g, prev, it.x + 62, it.y + 49, `${typing ? 'italic ' : ''}400 13px ${FONT}`, typing ? BLUE : '#666');
      if (ch.unread) {
        g.fillStyle = '#e74c3c';
        g.beginPath();
        g.arc(it.x + sideW - 24, it.y + 34, 11, 0, Math.PI * 2);
        g.fill();
        txt(g, String(ch.unread), it.x + sideW - 24, it.y + 39, `700 12px ${FONT}`, '#ffffff', 'center');
      }
      c.hot(it, hid, { down: () => this.open(i) });
    });
    g.fillStyle = '#dde2ea';
    g.fillRect(r.x + sideW, r.y, 1, r.h);

    // ---- the conversation
    const cx = r.x + sideW + 1;
    const cw = r.w - sideW - 1;
    const ch = this.chat;
    g.fillStyle = '#ffffff';
    g.fillRect(cx, r.y, cw, r.h);
    g.fillStyle = '#f9fafc';
    g.fillRect(cx, r.y, cw, 58);
    g.fillStyle = '#e3e7ee';
    g.fillRect(cx, r.y + 58, cw, 1);
    avatar(g, ch.group ? 'group' : ch.with!, cx + 30, r.y + 29, 18);
    txt(g, ch.name, cx + 58, r.y + 27, `700 17px ${FONT}`, '#1f1f1f');
    txt(g, ch.group ? 'Vikram, Priya, Gary, Deepak, Sunita, Ravi (unfortunately)' : PEOPLE[ch.with!].role, cx + 58, r.y + 46, `400 13px ${FONT}`, '#777');

    const area = { x: cx, y: r.y + 59, w: cw, h: r.h - 59 - 62 };
    // Lay the messages out
    const maxB = Math.min(420, cw * 0.62);
    type Row = { m: Msg; lines: string[]; y: number; h: number; w: number; showName: boolean };
    const rows: Row[] = [];
    let y = 14;
    let prevFrom: Who | '' = '';
    g.font = `400 15px ${FONT}`;
    for (const m of ch.msgs) {
      if (m.from === 'system') {
        rows.push({ m, lines: wrap(g, m.text, cw - 80), y, h: 0, w: 0, showName: false });
        const n = rows[rows.length - 1].lines.length;
        rows[rows.length - 1].h = n * 17 + 10;
        y += n * 17 + 18;
        prevFrom = '';
        continue;
      }
      const lines = m.text.split('\n').flatMap((l) => wrap(g, l, maxB - 24));
      const showName = m.from !== 'ravi' && m.from !== prevFrom;
      const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 24;
      const h = lines.length * 20 + 16 + (showName ? 18 : 0);
      rows.push({ m, lines, y, h, w, showName });
      y += h + (m.from === prevFrom ? 4 : 12);
      prevFrom = m.from;
    }
    // Who's typing right now, at the bottom
    const typers = [...new Set(this.pending.filter((p) => p.chat === ch && this.time >= p.typeAt && p.who !== 'system').map((p) => p.who as Pid))];
    const content = y + (typers.length ? 34 : 0) + 8;
    this.maxScroll = Math.max(0, content - area.h);
    if (this.stick) this.scroll = this.maxScroll;
    this.scroll = Math.min(this.scroll, this.maxScroll);
    g.save();
    g.beginPath();
    g.rect(area.x, area.y, area.w, area.h);
    g.clip();
    for (const row of rows) {
      const by = area.y + row.y - this.scroll;
      if (by > area.y + area.h || by + row.h < area.y) continue;
      const m = row.m;
      if (m.from === 'system') {
        row.lines.forEach((l, i) => txt(g, l, cx + cw / 2, by + 14 + i * 17, `italic 400 13px ${FONT}`, '#8a8a8a', 'center'));
        continue;
      }
      if (m.from === 'ravi') {
        const bx = cx + cw - row.w - 18;
        g.fillStyle = BLUE;
        rr(g, bx, by, row.w, row.h, 12);
        g.fill();
        row.lines.forEach((l, i) => txt(g, l, bx + 12, by + 24 + i * 20, `400 15px ${FONT}`, '#ffffff'));
        txt(g, m.time, bx - 8, by + row.h - 6, `400 11px ${FONT}`, '#aaa', 'right');
      } else {
        const p = m.from as Pid;
        if (row.showName) avatar(g, p, cx + 30, by + 22, 16);
        const bx = cx + 56;
        let ty = by;
        if (row.showName) {
          txt(g, PEOPLE[p].name, bx + 2, by + 13, `700 13px ${FONT}`, PEOPLE[p].col);
          ty += 18;
        }
        g.fillStyle = '#eef1f6';
        rr(g, bx, ty, row.w, row.h - (row.showName ? 18 : 0), 12);
        g.fill();
        row.lines.forEach((l, i) => txt(g, l, bx + 12, ty + 24 + i * 20, `400 15px ${FONT}`, '#1f1f1f'));
        // Hearts: theirs get them
        const hx = bx + row.w + 16;
        txt(g, m.likes ? '♥' : '♡', hx, ty + 22, `400 16px ${FONT}`, m.likes ? '#e74c3c' : '#c8c8c8', 'center');
        if (m.likes) txt(g, String(m.likes), hx + 13, ty + 21, `600 12px ${FONT}`, '#e74c3c');
        txt(g, m.time, hx + 30, ty + 21, `400 11px ${FONT}`, '#aaa');
      }
    }
    // Ravi's messages: never a heart. And in a DM, the dreaded "Seen".
    const last = ch.msgs[ch.msgs.length - 1];
    if (!ch.group && last?.from === 'ravi' && ch.seen) {
      const row = rows[rows.length - 1];
      txt(g, 'Seen', cx + cw - 20, area.y + row.y + row.h + 14 - this.scroll, `400 11px ${FONT}`, '#888', 'right');
    }
    if (typers.length) {
      const ty = area.y + y - this.scroll + 6;
      const names = typers.map((p) => PEOPLE[p].short);
      const label = names.length > 1 ? `${names.join(' and ')} are typing` : `${names[0]} is typing`;
      g.fillStyle = '#eef1f6';
      rr(g, cx + 56, ty, 54, 26, 13);
      g.fill();
      for (let i = 0; i < 3; i++) {
        g.fillStyle = `rgba(90, 90, 90, ${0.35 + 0.5 * Math.max(0, Math.sin(c.time * 6 - i * 0.8))})`;
        g.beginPath();
        g.arc(cx + 70 + i * 13, ty + 13, 4, 0, Math.PI * 2);
        g.fill();
      }
      txt(g, label + '…', cx + 120, ty + 18, `italic 400 13px ${FONT}`, '#888');
    }
    g.restore();
    // A scrollbar
    if (this.maxScroll > 0) {
      const th = Math.max(30, (area.h / content) * area.h);
      const tyb = area.y + (this.scroll / this.maxScroll) * (area.h - th);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      rr(g, area.x + area.w - 8, tyb, 5, th, 2.5);
      g.fill();
    }
    c.hot(area, `${this.id}:msgs`, {
      wheel: (dy) => {
        this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + dy));
        this.stick = this.scroll >= this.maxScroll - 2;
      },
      down: () => (this.focused = false)
    });

    // ---- the box he types into
    const bar = { x: cx, y: r.y + r.h - 62, w: cw, h: 62 };
    g.fillStyle = '#f4f6fa';
    g.fillRect(bar.x, bar.y, bar.w, bar.h);
    const box = { x: bar.x + 14, y: bar.y + 12, w: bar.w - 120, h: 38 };
    g.fillStyle = '#ffffff';
    rr(g, box.x, box.y, box.w, box.h, 19);
    g.fill();
    g.strokeStyle = this.focused ? BLUE : '#d4d9e2';
    g.lineWidth = this.focused ? 2 : 1;
    g.stroke();
    g.font = `400 15px ${FONT}`;
    let shown = this.input;
    while (shown.length && g.measureText(shown).width > box.w - 36) shown = shown.slice(1);
    if (this.input) txt(g, shown, box.x + 18, box.y + 25, `400 15px ${FONT}`, '#1f1f1f');
    else txt(g, ch.group ? 'Send a message to Floor 2 Team… (they will hate it)' : `Message ${PEOPLE[ch.with!].short}…`, box.x + 18, box.y + 25, `400 15px ${FONT}`, '#9a9a9a');
    if (this.focused && Math.floor(c.time * 2) % 2 === 0) {
      g.font = `400 15px ${FONT}`;
      g.fillStyle = '#1f1f1f';
      g.fillRect(box.x + 18 + g.measureText(shown).width + 1, box.y + 10, 1.5, 19);
    }
    c.hot(box, `${this.id}:input`, { down: () => (this.focused = true) });
    const sb = { x: bar.x + bar.w - 94, y: bar.y + 12, w: 80, h: 38 };
    g.fillStyle = this.input.trim() ? (c.hoverId === `${this.id}:send` ? '#2560c4' : BLUE) : '#a9c0ea';
    rr(g, sb.x, sb.y, sb.w, sb.h, 19);
    g.fill();
    txt(g, 'Send', sb.x + sb.w / 2, sb.y + 25, `700 15px ${FONT}`, '#ffffff', 'center');
    c.hot(sb, `${this.id}:send`, {
      down: () => {
        this.send();
        this.focused = true;
      }
    });
  }

  key(e: KeyboardEvent): boolean {
    if (!this.focused) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        // Typing anywhere in the app goes into the box
        this.focused = true;
      } else return false;
    }
    if (e.key === 'Enter') this.send();
    else if (e.key === 'Escape') this.focused = false;
    else if (e.key === 'Backspace') this.input = this.input.slice(0, -1);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && this.input.length < 200) this.input += e.key;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + (e.key === 'ArrowUp' ? -40 : 40)));
      this.stick = this.scroll >= this.maxScroll - 2;
    } else return false;
    return true;
  }
}
