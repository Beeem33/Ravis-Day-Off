import type { ECPhoto } from '../scenes/ECPhotos';

/**
 * The control office's terminal: EC NET, the Exterminator Collective's
 * intranet, logged in and left that way. The walkway 7 ladder isn't on a
 * lever any more — it's in there somewhere. Click the company's name for
 * its branches, into the Extraterrestrial Collective (staff photos with the
 * hounds), and from that branch's own tools to the facility controls, where
 * the ladder lock is.
 *
 * Plain DOM over the game, the mouse let go while it's up. Esc, or the
 * close button, logs out.
 */

type Page = 'home' | 'branches' | 'xc' | 'controls';

const CSS = `
.ecnet{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);font-family:"Segoe UI",Arial,sans-serif;cursor:default}
.ecnet *{box-sizing:border-box}
.ecnet .mon{width:min(980px,94vw);height:min(660px,90vh);background:#16181b;border-radius:14px;padding:14px;box-shadow:0 20px 70px rgba(0,0,0,.8),inset 0 0 0 2px #2a2d31;display:flex;flex-direction:column}
.ecnet .scr{flex:1;background:#f3f4f1;border-radius:4px;overflow:hidden;display:flex;flex-direction:column;position:relative}
.ecnet .chrome{display:flex;align-items:center;gap:8px;background:#dfe2dd;padding:6px 10px;border-bottom:1px solid #c5c9c2;font-size:13px;color:#333}
.ecnet .chrome button{border:1px solid #b9bdb5;background:#f6f7f4;border-radius:4px;padding:2px 9px;cursor:pointer;font-size:13px}
.ecnet .chrome button:disabled{opacity:.4;cursor:default}
.ecnet .url{flex:1;background:#fff;border:1px solid #c5c9c2;border-radius:12px;padding:3px 12px;color:#555;font-family:Consolas,monospace;font-size:12px}
.ecnet .x{background:#c4261c!important;color:#fff;border-color:#8e1a13!important;font-weight:bold}
.ecnet .top{display:flex;align-items:center;gap:14px;background:#1d1d1f;color:#fff;padding:12px 20px}
.ecnet .brand{display:flex;align-items:center;gap:12px;cursor:pointer;padding:4px 8px;border-radius:6px}
.ecnet .brand:hover{background:#34363a}
.ecnet .hex{width:40px;height:40px;flex:none}
.ecnet .bname{font-weight:800;letter-spacing:1px;font-size:19px;line-height:1}
.ecnet .bname small{display:block;font-weight:600;font-size:11px;color:#e66;letter-spacing:2px;margin-top:4px}
.ecnet .nav{margin-left:auto;display:flex;gap:18px;font-size:13px;color:#bbb}
.ecnet .nav span{cursor:pointer}.ecnet .nav span:hover{color:#fff}
.ecnet .body{flex:1;overflow:auto;padding:22px 28px;color:#222}
.ecnet h1{margin:0 0 6px;font-size:24px}.ecnet h2{margin:18px 0 8px;font-size:16px;color:#c4261c;text-transform:uppercase;letter-spacing:1px}
.ecnet p{margin:6px 0;font-size:14px;line-height:1.45}
.ecnet .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-top:12px}
.ecnet .card{background:#fff;border:1px solid #d7dad3;border-radius:8px;padding:14px;font-size:13px;line-height:1.4}
.ecnet .card b{display:block;margin-bottom:4px;font-size:14px}
.ecnet .branch{cursor:pointer;transition:transform .08s}
.ecnet .branch:hover{border-color:#c4261c;transform:translateY(-2px)}
.ecnet .tag{display:inline-block;background:#2e8b57;color:#fff;font-size:10px;font-weight:bold;padding:1px 6px;border-radius:8px;margin-left:6px;vertical-align:middle}
.ecnet .hint{font-size:12px;color:#888;margin-top:2px}
.ecnet .gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
.ecnet figure{margin:0;background:#fff;border:1px solid #d7dad3;border-radius:8px;overflow:hidden}
.ecnet figure img{display:block;width:100%}
.ecnet figcaption{padding:8px 10px;font-size:12px;color:#444}
.ecnet .side{display:flex;gap:22px}
.ecnet .side .main{flex:1;min-width:0}
.ecnet .side aside{width:200px;flex:none}
.ecnet .tool{display:block;background:#fff;border:1px solid #d7dad3;border-radius:6px;padding:9px 12px;margin-bottom:8px;font-size:13px;cursor:pointer}
.ecnet .tool:hover{border-color:#c4261c;color:#c4261c}
.ecnet .tool.off{color:#999;cursor:not-allowed}.ecnet .tool.off:hover{border-color:#d7dad3;color:#999}
.ecnet table{border-collapse:collapse;width:100%;font-size:13px;background:#fff}
.ecnet td,.ecnet th{border:1px solid #d7dad3;padding:9px 10px;text-align:left}
.ecnet th{background:#eceee9}
.ecnet .st{font-weight:bold}.ecnet .st.red{color:#c4261c}.ecnet .st.green{color:#2e8b57}.ecnet .st.grey{color:#888}
.ecnet .big{background:#c4261c;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-weight:800;letter-spacing:1px;cursor:pointer;font-size:13px}
.ecnet .big:hover{background:#e0302a}.ecnet .big:disabled{background:#8a8f8a;cursor:default}
.ecnet .small{background:#eceee9;border:1px solid #c5c9c2;border-radius:6px;padding:6px 10px;font-size:12px;cursor:not-allowed;color:#888}
.ecnet .toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);background:#1d1d1f;color:#fff;padding:9px 16px;border-radius:6px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none}
.ecnet .toast.on{opacity:.95}
.ecnet a{color:#c4261c;cursor:pointer;text-decoration:underline}
`;

const HEX = `<svg class="hex" viewBox="-50 -50 100 100"><polygon points="43,25 0,50 -43,25 -43,-25 0,-50 43,-25" fill="none" stroke="#e0302a" stroke-width="8"/><text x="0" y="12" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="34" fill="#e0302a">EC</text></svg>`;

export class ECTerminal {
  readonly el: HTMLElement;
  private page: Page = 'home';
  private history: Page[] = [];
  private released = false;
  private toastT = 0;
  private keyFn = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    }
  };

  constructor(
    root: HTMLElement,
    private photos: ECPhoto[],
    private hooks: { onDisengage: () => void; onClose: () => void; click?: () => void },
    alreadyReleased = false
  ) {
    this.released = alreadyReleased;
    if (!document.getElementById('ecnet-css')) {
      const s = document.createElement('style');
      s.id = 'ecnet-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.el = document.createElement('div');
    this.el.className = 'ecnet';
    root.appendChild(this.el);
    // Esc logs out (before the game's own Esc can pause it)
    window.addEventListener('keydown', this.keyFn, true);
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = (e.target as HTMLElement).closest('[data-go],[data-act]') as HTMLElement | null;
      if (!t) return;
      this.hooks.click?.();
      if (t.dataset.go) this.go(t.dataset.go as Page);
      else this.act(t.dataset.act!);
    });
    this.render();
  }

  private go(p: Page): void {
    if (p === this.page) return;
    this.history.push(this.page);
    this.page = p;
    this.render();
  }

  private act(a: string): void {
    if (a === 'back') {
      const p = this.history.pop();
      if (p) {
        this.page = p;
        this.render();
      }
    } else if (a === 'close') this.close();
    else if (a === 'denied') this.toast('ACCESS DENIED — you are not a member of this branch.');
    else if (a === 'locked') this.toast('This control is locked by a supervisor.');
    else if (a === 'disengage' && !this.released) {
      this.released = true;
      this.hooks.onDisengage();
      this.render();
      window.setTimeout(() => this.close(), 1800);
    }
  }

  private toast(msg: string): void {
    const t = this.el.querySelector('.toast') as HTMLElement | null;
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    const id = ++this.toastT;
    window.setTimeout(() => {
      if (id === this.toastT) t.classList.remove('on');
    }, 2200);
  }

  close(): void {
    if (!this.el.isConnected) return;
    window.removeEventListener('keydown', this.keyFn, true);
    this.el.remove();
    this.hooks.onClose();
  }

  private render(): void {
    const urls: Record<Page, string> = {
      home: 'ecnet://intranet/home',
      branches: 'ecnet://intranet/branches',
      xc: 'ecnet://intranet/branches/extraterrestrial-collective',
      controls: 'ecnet://intranet/branches/extraterrestrial-collective/tools/facility-controls'
    };
    this.el.innerHTML = `
      <div class="mon"><div class="scr">
        <div class="chrome">
          <button data-act="back" ${this.history.length ? '' : 'disabled'}>◀ Back</button>
          <div class="url">${urls[this.page]}</div>
          <button class="x" data-act="close">✕ Log out (Esc)</button>
        </div>
        <div class="top">
          <div class="brand" data-go="branches" title="Our branches">${HEX}<div class="bname">EXTERMINATOR COLLECTIVE ▾<small>EC NET · EST. 2003</small></div></div>
          <div class="nav"><span data-go="home">Home</span><span data-act="denied">HR</span><span data-act="denied">Payroll</span><span data-go="branches">Branches</span></div>
        </div>
        <div class="body">${this.pageHtml()}</div>
        <div class="toast"></div>
      </div></div>`;
  }

  private pageHtml(): string {
    switch (this.page) {
      case 'home':
        return `
          <h1>Welcome back, OPERATOR 7</h1>
          <p class="hint">Session restored · Sector 7 Control · terminal C-2</p>
          <h2>Company news</h2>
          <div class="cards">
            <div class="card"><b>Employee of the Month: Gary</b>For the third month running. Nobody else has applied.</div>
            <div class="card"><b>Reminder: the canteen fridge</b>…is not a specimen fridge. Whoever keeps doing this, we know it's you, Gary.</div>
            <div class="card"><b>Vat Line 3 maintenance overdue</b>Do not lean over the vats. Do not fall into the vats. Please.</div>
            <div class="card"><b>New branch!</b>Say hello to our newest family member, the <a data-go="xc">Extraterrestrial Collective</a> — see <a data-go="branches">Branches</a>.</div>
          </div>
          <p class="hint" style="margin-top:18px">Facility controls have moved to each branch's own tools page.</p>`;
      case 'branches':
        return `
          <h1>Our branches</h1>
          <p>One collective, many branches. Click a branch to visit its page.</p>
          <div class="cards">
            <div class="card branch" data-act="denied"><b>Exterminator Collective — Head Office</b>Admin, legal, the good coffee machine.</div>
            <div class="card branch" data-act="denied"><b>Pest Control Division</b>Rats, roaches, and things that are mostly rats.</div>
            <div class="card branch" data-act="denied"><b>Sanitation &amp; Waste</b>The grinder. The vats. Do not ask about the vats.</div>
            <div class="card branch" data-go="xc"><b>Extraterrestrial Collective <span class="tag">NEW</span></b>Our friends from further away. Sector 7 runs on their kit now.</div>
          </div>`;
      case 'xc': {
        const gal = this.photos.length
          ? this.photos.map((p) => `<figure><img src="${p.img.toDataURL('image/jpeg', 0.9)}"><figcaption>${p.caption}</figcaption></figure>`).join('')
          : '<p class="hint">(photos loading…)</p>';
        return `
          <div class="side"><div class="main">
            <h1>Extraterrestrial Collective</h1>
            <p><i>"Bridging species, one handshake at a time."</i> — a branch of the Exterminator Collective since this spring.</p>
            <h2>Meet the team</h2>
            <div class="gal">${gal}</div>
          </div>
          <aside>
            <h2>Branch tools</h2>
            <span class="tool off" data-act="locked">Specimen intake ▸</span>
            <span class="tool off" data-act="locked">Feeding rota ▸</span>
            <span class="tool" data-go="controls">Facility controls ▸</span>
            <span class="tool off" data-act="locked">Incident reports (4,112) ▸</span>
          </aside></div>`;
      }
      case 'controls':
        return `
          <h1>Facility controls — Sector 7</h1>
          <p class="hint">Extraterrestrial Collective · branch tools · changes are logged</p>
          <table>
            <tr><th>System</th><th>Status</th><th></th></tr>
            <tr><td>Grinder line</td><td class="st green">RUNNING</td><td><button class="small" data-act="locked">Stop</button></td></tr>
            <tr><td>Vat line 3 — flush</td><td class="st grey">LOCKED (supervisor)</td><td><button class="small" data-act="locked">Flush</button></td></tr>
            <tr><td>Sentry turrets, hall</td><td class="st red">ARMED</td><td><button class="small" data-act="locked">Disarm</button></td></tr>
            <tr><td><b>Walkway 7 — drop ladder lock</b></td>
              <td class="st ${this.released ? 'green' : 'red'}">${this.released ? 'DISENGAGED — LADDER DOWN' : 'ENGAGED'}</td>
              <td><button class="big" data-act="disengage" ${this.released ? 'disabled' : ''}>${this.released ? 'DONE' : 'DISENGAGE LADDER LOCK'}</button></td></tr>
          </table>
          ${this.released ? '<p style="margin-top:14px;color:#2e8b57;font-weight:bold">Ladder lock released. Walkway 7 drop ladder lowering.</p>' : ''}`;
    }
  }
}
