/**
 * InventoryUI — the panel that comes up down the left of the screen when
 * Ravi changes what's in his hands (the wheel, or a number): every slot he
 * has, its number, a side view of what's in it, the one in hand lit; and
 * under them how many grenades he's carrying. It fades away again on its own.
 *
 * One element for the whole game, made the first time it's wanted.
 */

export type InventoryIcon = 'pistol' | 'shotgun' | 'quad' | 'rifle' | 'knife';

export interface InventoryItem {
  /** The number key it's on. */
  key: number;
  icon: InventoryIcon;
  name: string;
}

/** Side views, muzzle to the left, drawn in a 120×40 box. */
const ICONS: Record<InventoryIcon | 'grenade', string> = {
  pistol:
    '<path d="M22 9h60l3 3v8H62l-2 4h-9c-1 3-4 5-8 5l5 9c1 2 0 3-2 3H35c-2 0-3-1-3-2l-4-17h-6z"/>' +
    '<path d="M26 11h50v2H26z" fill="#000" opacity=".35"/><path d="M50 22c0 4 3 6 8 6" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  shotgun:
    '<path d="M2 11h66v4H2z"/><path d="M6 17h50v4H6z"/><path d="M26 16h24v8H26z"/>' +
    '<path d="M66 9h22l4 3v8l-6 4h-4l-2 5h-7l1-5H66z"/><path d="M90 13l26 3v13l-8 1-16-9z"/>' +
    '<path d="M28 18h20v1H28zM28 21h20v1H28z" fill="#000" opacity=".4"/>',
  quad:
    '<path d="M2 8h60v5H2zM2 14h60v5H2z"/><path d="M4 6h6v15H4zM50 6h6v15H50z"/><path d="M8 4h78v2H8z"/>' +
    '<path d="M22 20h20v5H22z"/><path d="M24 25c-3 6 2 10 9 10s9-4 7-10h-3c1 4-1 7-5 7s-6-3-5-7z"/>' +
    '<path d="M60 6h24l3 4v12H60z"/><path d="M78 22h8l4 14h-9z"/><path d="M87 9h29v19h-5V14H87z"/><path d="M88 22l23 5v3L88 26z"/>' +
    '<path d="M64 12h10v2H64z" fill="#ff4b2e"/>',
  rifle:
    '<path d="M2 13h34v2H2z"/><path d="M10 9h3v5h-3z"/><path d="M30 10h30v4H30z"/><path d="M34 15h26v6H34z"/>' +
    '<path d="M58 9h30l3 3v9H58z"/><path d="M66 21h9c1 7 0 12-4 17l-8-2c3-5 4-9 3-15z"/>' +
    '<path d="M82 21h7l3 12h-8z"/><path d="M90 12l27 2v13l-10 1-17-8z"/><path d="M76 21c0 4 2 5 6 5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  knife:
    '<path d="M100 26a8 8 0 1 1 0 .1zm4 0a4 4 0 1 0 0-.1z" fill-rule="evenodd"/>' +
    '<path d="M94 23L62 14c-3-1-6 1-6 4s2 5 5 6l32 6z"/>' +
    '<path d="M58 15C40 8 22 12 8 30c16-9 32-9 48-4z"/><path d="M70 18l2 8M78 20l2 8M86 22l1 7" stroke="#000" stroke-width="1.4" opacity=".4"/>',
  grenade:
    '<path d="M10 13h8v-3h-3V7h10v3h-3v3c5 2 8 6 8 11 0 6-4 10-11 10S8 30 8 24c0-5 1-9 2-11z"/><path d="M25 8h8l3 10h-3l-2-7h-6z"/>'
};

const svg = (icon: keyof typeof ICONS, w: number, h: number, box = '0 0 120 40'): string =>
  `<svg viewBox="${box}" width="${w}" height="${h}" fill="currentColor" aria-hidden="true">${ICONS[icon]}</svg>`;

let panel: HTMLElement | null = null;
let hideTimer: number | null = null;

function ensure(): HTMLElement {
  if (panel && panel.isConnected) return panel;
  if (!document.getElementById('inv-style')) {
    const st = document.createElement('style');
    st.id = 'inv-style';
    st.textContent = `
      #inventory { position: fixed; left: 22px; top: 50%; transform: translateY(-50%) translateX(-14px); z-index: 12; pointer-events: none;
        font-family: 'Courier New', monospace; color: #cfd6da; opacity: 0; transition: opacity .35s, transform .35s; }
      #inventory.show { opacity: 1; transform: translateY(-50%); transition: opacity .1s, transform .12s; }
      #inventory .inv-row { display: flex; align-items: center; gap: 10px; width: 250px; height: 50px; margin: 5px 0; padding: 0 10px 0 8px; box-sizing: border-box;
        background: linear-gradient(90deg, rgba(8,10,12,.78), rgba(8,10,12,.35)); border-left: 3px solid rgba(255,255,255,.18); color: rgba(207,214,218,.55); }
      #inventory .inv-row.on { background: linear-gradient(90deg, rgba(40,30,8,.9), rgba(30,22,6,.45)); border-left-color: #ffc23a; color: #fff3d2; }
      #inventory .inv-key { font-size: 12px; font-weight: bold; width: 18px; height: 18px; line-height: 18px; text-align: center; border: 1px solid currentColor; opacity: .85; flex: none; }
      #inventory .inv-name { font-size: 11px; letter-spacing: 1.5px; white-space: nowrap; margin-left: auto; text-align: right; }
      #inventory .inv-row svg { flex: none; filter: drop-shadow(0 1px 0 rgba(0,0,0,.6)); }
      #inventory .inv-nades { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 6px 10px 6px 8px; width: 250px; box-sizing: border-box;
        background: rgba(8,10,12,.6); border-left: 3px solid rgba(255,255,255,.18); font-size: 12px; letter-spacing: 2px; }
      #inventory .inv-nades.none { color: rgba(207,214,218,.4); }
      #inventory .inv-nades .n { margin-left: auto; font-weight: bold; font-size: 15px; }
      #inventory .inv-head { font-size: 10px; letter-spacing: 4px; opacity: .55; margin-bottom: 6px; padding-left: 4px; }
    `;
    document.head.appendChild(st);
  }
  panel = document.createElement('div');
  panel.id = 'inventory';
  document.body.appendChild(panel);
  return panel;
}

/** Put the panel up (or refresh it) and start its clock again. */
export function showInventory(items: InventoryItem[], active: number, grenades: number): void {
  const el = ensure();
  el.innerHTML =
    '<div class="inv-head">INVENTORY</div>' +
    items
      .map(
        (it, i) =>
          `<div class="inv-row${i === active ? ' on' : ''}"><span class="inv-key">${it.key}</span>${svg(it.icon, 96, 32)}<span class="inv-name">${it.name}</span></div>`
      )
      .join('') +
    `<div class="inv-nades${grenades ? '' : ' none'}">${grenades ? svg('grenade', 14, 16, '4 4 34 32').repeat(Math.min(grenades, 6)) : svg('grenade', 14, 16, '4 4 34 32')}<span>GRENADES</span><span class="n">${grenades}</span></div>`;
  el.classList.add('show');
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    el.classList.remove('show');
    hideTimer = null;
  }, 2200);
}

/** Away at once (a scene ending, a cutscene starting). */
export function hideInventory(): void {
  panel?.classList.remove('show');
}
