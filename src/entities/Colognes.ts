import * as THREE from 'three';
import type { AudioManager } from '../core/AudioManager';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FirstPersonArms, RaviVisual, grip, mixShape, type Grip, type HandShape } from './RaviVisual';
import { Controls } from '../core/Controls';
import type { InputManager } from '../core/InputManager';

/**
 * The fourteen ultra-niche colognes: one hidden somewhere in each of fourteen
 * levels, picked up by walking right up to it. An achievement each — they
 * stay collected between sessions (localStorage), and the menu lists them.
 *
 * Every bottle is built here, procedurally, base at y = 0 and its label
 * facing +Z, about 12–14 cm tall. A level only has to say where its one goes:
 *
 *   Colognes.place(this.scene, 'deadbull', new THREE.Vector3(x, y, z), yaw, () => this.player.camera);
 *
 * The engine ticks the hunt every frame and clears it on every scene change.
 */

export type CologneId =
  | 'keypad'
  | 'scam'
  | 'declined'
  | 'tikka'
  | 'sweat'
  | 'davi'
  | 'delhi'
  | 'pit'
  | 'deadbull'
  | 'curry'
  | 'haheed'
  | 'microsuf'
  | 'pubjae'
  | 'odore'
  | 'maw';

export interface CologneInfo {
  id: CologneId;
  name: string;
  /** What it smells of, read off the box while he looks it over. */
  note?: string;
  /** Which level it's hidden in, for the menu ("Level 3"). */
  level: string;
}

/** In the order of the levels they're hidden in. */
export const COLOGNES: CologneInfo[] = [
  { id: 'keypad', name: 'Musty Keypad', level: 'Level 1', note: 'Top notes of old phone buttons, desk dust and a 2007 handset.' },
  { id: 'scam', name: 'Scent of the Scam', level: 'Level 2', note: 'Bergamot, crisp banknotes and the confidence of a man with a script.' },
  { id: 'declined', name: 'Declined Card on the Rocks', level: 'Level 3', note: 'Smoked oak, ice, and the quiet beep of a card machine saying no.' },
  { id: 'tikka', name: 'Tikka Tock', level: 'Level 4', note: 'Charred tikka, tick-tock, and the sense that time is running out.' },
  { id: 'sweat', name: 'Sweat of Labour', level: 'Level 5', note: 'Honest work. Mostly sweat. A whisper of overtime.' },
  { id: 'davi', name: 'Davi Doff', level: 'Level 6', note: 'Leather chair, corner office, a raise you will never get.' },
  { id: 'delhi', name: 'Dior de Delhi', level: 'Level 7', note: 'Marigold, monsoon rain, and an auntie asking when you will marry.' },
  { id: 'pit', name: 'Sinking Pit', level: 'Level 8', note: 'Wet stone, rusty ladder, and regret, deep down.' },
  { id: 'deadbull', name: 'Deadbull', level: 'Level 9', note: 'Taurine, adrenaline, and a heartbeat you can hear.' },
  { id: 'curry', name: 'Curry', level: 'Level 10', note: 'Butter chicken. That is it. That is the whole scent.' },
  { id: 'haheed', name: 'Journey of Haheed', level: 'Level 11', note: 'Jet fuel, duty-free, and a long journey somewhere warm.' },
  { id: 'microsuf', name: 'Microsuf', level: 'Level 12', note: 'Fresh install, warm plastic, and a forced restart.' },
  { id: 'pubjae', name: 'Pubjae', level: 'Level 13', note: 'Gunpowder, a frying pan, and a winner winner.' },
  { id: 'odore', name: 'Odoré', level: 'Level 14', note: 'It smells exactly like the word "Odoré" sounds.' },
  { id: 'maw', name: 'Musk of the Maw', level: 'Level 16', note: 'Wet sponge, acid rain, and something with no eyes, very close.' }
];

const KEY = 'ravi.colognes';
const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

interface Placed {
  id: CologneId;
  group: THREE.Group;
  glint: THREE.Sprite;
  centre: THREE.Vector3;
  camera: () => THREE.Camera | null;
  radius: number;
  t: number;
  /** Where the camera was last frame: a car going past at speed is checked along its path. */
  last: THREE.Vector3 | null;
  auto: boolean;
  /** Riding on something that moves (a parked car): its pose each frame, and where on it. */
  follow?: (pos: THREE.Vector3, quat: THREE.Quaternion) => boolean;
  local?: THREE.Vector3;
  localQ?: THREE.Quaternion;
}

export interface PlaceOptions {
  /** Reach from the camera to the middle of the bottle (default 1.3 m). */
  radius?: number;
  /** Taken just by going past (the driving levels), rather than with E. */
  auto?: boolean;
  /** The bottle rides on whatever this reports the pose of (it stays where it is on it). */
  follow?: (pos: THREE.Vector3, quat: THREE.Quaternion) => boolean;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Vector3();

/** Distance from point `p` to the segment a→b. */
function segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = _p.subVectors(b, a);
  const len2 = ab.lengthSq();
  const t = len2 > 1e-9 ? THREE.MathUtils.clamp(_e.subVectors(p, a).dot(ab) / len2, 0, 1) : 0;
  return _e.copy(a).addScaledVector(ab, t).distanceTo(p);
}

class CologneHunt {
  audio: AudioManager | null = null;
  uiRoot: HTMLElement | null = null;
  /** The game's input: his weapons held off while the bottle's in his hand. */
  input: InputManager | null = null;
  /** The camera he was looking through when he took it, and what on it was put out of sight for the while. */
  private heldCam: THREE.Camera | null = null;
  private hidden: THREE.Object3D[] = [];
  private placed: Placed[] = [];
  private labelCache = new Map<CologneId, HTMLCanvasElement>();
  private static glintTex: THREE.Texture | null = null;

  // ------------------------------------------------------------ progress

  found(): Set<CologneId> {
    try {
      const raw = localStorage.getItem(KEY);
      return new Set(raw ? (JSON.parse(raw) as CologneId[]) : []);
    } catch {
      return new Set();
    }
  }

  has(id: CologneId): boolean {
    return this.found().has(id);
  }

  private save(set: Set<CologneId>): void {
    try {
      localStorage.setItem(KEY, JSON.stringify([...set]));
    } catch {
      /* private mode: it just won't persist */
    }
  }

  /** The front label of a bottle as a canvas (also used by the menu and the popup). */
  label(id: CologneId): HTMLCanvasElement {
    let c = this.labelCache.get(id);
    if (!c) {
      c = drawLabel(id);
      this.labelCache.set(id, c);
    }
    return c;
  }

  // ------------------------------------------------------------- the hunt

  /**
   * Put a level's cologne at `at` (the surface it stands on), turned `yaw`.
   * `camera` returns the camera the player is looking through, or null while
   * they can't pick things up (a cutscene). `radius` is the reach, from the
   * camera to the middle of the bottle.
   */
  place(scene: THREE.Scene, id: CologneId, at: THREE.Vector3, yaw: number, camera: () => THREE.Camera | null, opts: PlaceOptions = {}): void {
    const radius = opts.radius ?? 1.3;
    if (this.has(id)) return; // already in the collection
    const group = buildBottle(id, this.label(id));
    group.position.copy(at);
    group.rotation.y = yaw;
    group.name = `cologne:${id}`;
    scene.add(group);
    const glint = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: CologneHunt.glint(), color: 0xfff2c8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })
    );
    glint.scale.setScalar(0.09);
    glint.position.set(0.018, 0.11, 0.02);
    group.add(glint);
    const p: Placed = { id, group, glint, centre: at.clone().add(new THREE.Vector3(0, 0.07, 0)), camera, radius, t: Math.random() * 3, last: null, auto: !!opts.auto };
    if (opts.follow) {
      // Pinned to the thing's frame where it is now
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      if (opts.follow(pos, q)) {
        const inv = q.clone().invert();
        p.follow = opts.follow;
        p.local = at.clone().sub(pos).applyQuaternion(inv);
        p.localQ = inv.multiply(group.quaternion);
      }
    }
    this.placed.push(p);
  }

  clear(): void {
    for (const p of this.placed) p.group.removeFromParent();
    this.placed = [];
    this.handsBack();
    if (this.held) {
      // Changed level mid-look: it still counts
      const id = this.held.id;
      this.held.group.removeFromParent();
      this.held = null;
      this.hand = null;
      this.view?.card.classList.remove('show');
      this.collect(id);
    }
    this.near = null;
    this.prompt?.classList.remove('show');
  }

  // ------------------------------------------------- reaching for one

  private prompt: HTMLElement | null = null;
  private near: Placed | null = null;
  private keyBound = false;
  /** The one in his hand right now, and how long he's been looking at it. */
  private held: { id: CologneId; group: THREE.Group; t: number } | null = null;
  private view: {
    scene: THREE.Scene;
    cam: THREE.PerspectiveCamera;
    holder: THREE.Group;
    arms: FirstPersonArms | null;
    card: HTMLElement;
    mist: { s: THREE.Sprite; v: THREE.Vector3; life: number; max: number }[];
  } | null = null;
  /** The one in his hand: its grip (made to fit it), its cap and how that's flying, where its nozzle is. */
  private hand: {
    grip: Grip;
    cap: THREE.Object3D | null;
    capHome: THREE.Vector3;
    capV: THREE.Vector3 | null;
    capSpin: THREE.Vector3;
    nozzle: THREE.Vector3;
    cue: Set<string>;
  } | null = null;

  private onKey = (e: KeyboardEvent): void => {
    if (Controls.translate(e.code) !== 'KeyE' || e.repeat || this.held || !this.near) return;
    const p = this.near;
    this.near = null;
    this.placed.splice(this.placed.indexOf(p), 1);
    this.inspect(p);
  };

  update(dt: number): void {
    if (!this.keyBound) {
      this.keyBound = true;
      document.addEventListener('keydown', this.onKey);
    }
    let near: Placed | null = null;
    let nearD = Infinity;
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const p = this.placed[i];
      // A glint off the glass every few seconds, so a sharp eye can spot it
      p.t += dt;
      const k = (p.t % 3.2) / 3.2;
      const flash = k < 0.12 ? Math.sin((k / 0.12) * Math.PI) : 0;
      p.glint.material.opacity = flash * 0.95;
      p.glint.material.rotation = p.t * 0.8;
      p.glint.scale.setScalar(0.05 + 0.07 * flash);
      if (p.follow && p.local && p.localQ) {
        if (p.follow(_p, _q)) {
          p.group.position.copy(p.local).applyQuaternion(_q).add(_p);
          p.group.quaternion.copy(_q).multiply(p.localQ);
          p.centre.set(0, 0.07, 0).applyQuaternion(p.group.quaternion).add(p.group.position);
        }
      }
      const cam = p.camera();
      if (!cam) {
        p.last = null;
        continue;
      }
      const eye = cam.getWorldPosition(new THREE.Vector3());
      if (p.auto) {
        // Driving past: taken on the way by
        const prev = p.last && p.last.distanceTo(eye) < 6 ? p.last : eye;
        p.last = eye;
        if (segDist(p.centre, prev, eye) <= p.radius) {
          this.placed.splice(i, 1);
          if (this.held) {
            p.group.removeFromParent();
            this.collect(p.id);
          } else this.inspect(p);
        }
        continue;
      }
      // On foot: close enough to reach, and he's looking its way
      const d = eye.distanceTo(p.centre);
      if (d > p.radius + 0.35 || this.held) continue;
      const fwd = cam.getWorldDirection(new THREE.Vector3());
      const to = p.centre.clone().sub(eye).normalize();
      if (fwd.dot(to) < 0.5) continue;
      if (d < nearD) {
        nearD = d;
        near = p;
      }
    }
    this.near = near;
    this.showPrompt(near);
    if (this.held) this.stepInspect(dt);
  }

  private showPrompt(p: Placed | null): void {
    if (!this.uiRoot) return;
    if (!this.prompt) {
      this.prompt = document.createElement('div');
      this.prompt.className = 'cologne-prompt';
      this.uiRoot.appendChild(this.prompt);
    }
    if (!this.prompt.isConnected) this.uiRoot.appendChild(this.prompt);
    if (p) {
      const name = COLOGNES.find((c) => c.id === p.id)!.name;
      const html = `<span class="key">${Controls.label('E')}</span> TAKE THE COLOGNE  <b>${name.toUpperCase()}</b>`;
      if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
    }
    this.prompt.classList.toggle('show', !!p);
  }

  /**
   * He picks it up in his right hand and brings it up in front of him, the
   * label square to him; flicks the cap off with his thumb; puts it to his
   * neck and gives it two sprays; and it's his (the achievement, in the corner).
   */
  private inspect(p: Placed): void {
    const v = this.ensureView();
    p.group.removeFromParent();
    p.group.position.set(0, 0, 0);
    p.group.rotation.set(0, 0, 0);
    p.group.quaternion.identity();
    p.glint.visible = false;
    v.holder.add(p.group);
    this.held = { id: p.id, group: p.group, t: 0 };
    this.heldCam = p.camera();
    if (this.input) this.input.weaponsBlocked = true;
    this.hand = this.fitHand(p.group);
    v.arms?.set('r', p.group, this.hand.grip);
    this.audio?.pocket();
    const info = COLOGNES.find((c) => c.id === p.id)!;
    v.card.innerHTML = `<div class="ci-name">${info.name}</div><div class="ci-sub">an ultra-niche cologne</div><div class="ci-note">${info.note ?? ''}</div>`;
    v.card.classList.add('show');
    if (this.uiRoot && !v.card.isConnected) this.uiRoot.appendChild(v.card);
  }

  private ensureView(): NonNullable<CologneHunt['view']> {
    if (this.view) return this.view;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x404050, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-1, 2, 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd9a0, 1.4);
    rim.position.set(2, 1, -1.5);
    scene.add(rim);
    const cam = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 10);
    scene.add(cam);
    const holder = new THREE.Group();
    cam.add(holder);
    let arms: FirstPersonArms | null = null;
    if (RaviVisual.ready) arms = new FirstPersonArms(holder, cam);
    const card = document.createElement('div');
    card.className = 'cologne-inspect';
    // The atomiser's mist: soft white puffs, drifting out of the nozzle toward his neck and thinning
    const mist: NonNullable<CologneHunt['view']>['mist'] = [];
    const mt = CologneHunt.mistTex();
    for (let i = 0; i < 48; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: mt, color: 0xf4f7ff, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false;
      cam.add(s);
      mist.push({ s, v: new THREE.Vector3(), life: 0, max: 1 });
    }
    this.view = { scene, cam, holder, arms, card, mist };
    return this.view;
  }

  /**
   * A grip made for this bottle: his right hand on its right side, palm flat
   * to it, fingers round behind it (out of the label's way, knuckles past
   * its back so nothing goes into the glass), the thumb up its front edge
   * where it can reach the cap. Measured off the bottle itself.
   */
  private fitHand(bottle: THREE.Object3D): NonNullable<CologneHunt['hand']> {
    const cap = bottle.userData.cap as THREE.Object3D | undefined;
    bottle.updateMatrixWorld(true);
    const inv = bottle.matrixWorld.clone().invert();
    const body = new THREE.Box3();
    const capBox = new THREE.Box3();
    bottle.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.computeBoundingBox();
      // (straight into the bottle's own space: out to the world and back would swell the box by however it's turned)
      const b = m.geometry.boundingBox!.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld));
      let inCap = false;
      for (let q: THREE.Object3D | null = o; q && q !== bottle; q = q.parent) if (q === cap) inCap = true;
      (inCap ? capBox : body).union(b);
    });
    const hx = Math.max(Math.abs(body.min.x), body.max.x);
    const hz = Math.max(Math.abs(body.min.z), body.max.z);
    // (the helmet cap's strap hangs down past the neck: its rim is what counts)
    const capY = capBox.isEmpty() ? body.max.y : Math.max(capBox.min.y, body.max.y - 0.012);
    // The wrist beside it, high enough that the thumb run up its side reaches the cap's edge, and
    // level with its middle front to back: the fingers go round behind (out past its back), the
    // label in front is all clear
    const wy = Math.max(0.008, capY - 0.075);
    const wz = -0.005;
    const g = grip([hx + 0.021, wy, wz], [-0.12, 0.2, -0.97], [-1, 0, -0.08], [0.35, -0.6, 0.72], CologneHunt.HOLD);
    return {
      grip: g,
      cap: cap ?? null,
      capHome: cap ? cap.position.clone() : new THREE.Vector3(),
      capV: null,
      capSpin: new THREE.Vector3(),
      nozzle: new THREE.Vector3(0, Math.max(capY, body.max.y) + 0.004, 0),
      cue: new Set()
    };
  }

  /** The hand round a bottle; the thumb ready under the cap; the thumb flicking up off it; the thumb down on the nozzle. */
  // (the thumb: negative straightens it up the bottle's side toward the cap, positive folds it in)
  private static readonly HOLD: HandShape = { fingers: [[58, 64, 34], [64, 70, 38], [68, 72, 42], [72, 74, 46]], thumb: [-0.08, -0.08, -0.05], spread: 2 };
  private static readonly COCK: HandShape = { fingers: [[58, 64, 34], [64, 70, 38], [68, 72, 42], [72, 74, 46]], thumb: [-0.32, -0.28, 0.25], spread: 2 };
  private static readonly FLICK: HandShape = { fingers: [[58, 64, 34], [64, 70, 38], [68, 72, 42], [72, 74, 46]], thumb: [-0.7, -0.5, -0.6], spread: 2 };
  private static readonly PRESS: HandShape = { fingers: [[58, 64, 34], [64, 70, 38], [68, 72, 42], [72, 74, 46]], thumb: [0.45, 0.45, 0.35], spread: 2 };

  private static mistT: THREE.Texture | null = null;
  private static mistTex(): THREE.Texture {
    if (CologneHunt.mistT) return CologneHunt.mistT;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    r.addColorStop(0, 'rgba(255,255,255,0.9)');
    r.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    CologneHunt.mistT = new THREE.CanvasTexture(c);
    return CologneHunt.mistT;
  }

  /**
   * The timeline (seconds):
   *   0.00–0.60  up from low on the right into the middle of the view
   *   0.60–1.95  held there, label square to him, turned a little in the light
   *   1.95–2.45  the thumb under the cap's edge, and it flicks it off — up and away
   *   2.50–3.05  in to his neck, the nozzle turned to it
   *   3.10, 3.55 two sprays
   *   3.95–4.50  down out of sight; then it's his
   */
  private static readonly T_END = 4.5;

  /**
   * Out of sight for the while: everything drawn on the camera he's looking
   * through — the weapon and the arms holding it, whatever's in his hands —
   * so the only arm is the one with the bottle. Done every frame (a
   * viewmodel shows its own parts again as it updates); the lights on the
   * camera (a torch) stay as they are.
   */
  private handsAway(): void {
    const cam = this.heldCam;
    if (!cam) return;
    cam.traverse((o) => {
      if (o === cam || !o.visible) return;
      const r = o as THREE.Mesh & THREE.Sprite & THREE.Points & THREE.Line;
      if (!(r.isMesh || r.isSprite || r.isPoints || r.isLine)) return;
      o.visible = false;
      if (!this.hidden.includes(o)) this.hidden.push(o);
    });
  }

  /** And back: his weapon (or whatever he had) in his hands again, the controls his again. */
  private handsBack(): void {
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
    this.heldCam = null;
    if (this.input) this.input.weaponsBlocked = false;
  }

  private stepInspect(dt: number): void {
    const h = this.held!;
    const v = this.view!;
    const hand = this.hand!;
    h.t += dt;
    this.handsAway();
    const t = h.t;
    const sm = (x: number): number => {
      const k = Math.min(1, Math.max(0, x));
      return k * k * (3 - 2 * k);
    };
    const once = (k: string, at: number): boolean => {
      if (t < at || hand.cue.has(k)) return false;
      hand.cue.add(k);
      return true;
    };
    // ---- Where the bottle is (camera space): low right → in front → (flick) → at his neck → away
    const P0 = new THREE.Vector3(0.3, -0.5, -0.32);
    const P1 = new THREE.Vector3(0.015, -0.068, -0.33);
    const P3 = new THREE.Vector3(0.02, -0.055, -0.3);
    const P4 = new THREE.Vector3(0.34, -0.55, -0.16);
    const Q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -0.55, 0.45));
    const sway = Math.sin(t * 1.25) * 0.16 * sm((t - 0.6) / 0.4) * (1 - sm((t - 1.7) / 0.3));
    const Q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.06 + Math.sin(t * 0.8) * 0.02, sway, 0.02));
    // The flick: tipped back a touch, away from him, as the thumb goes
    const Q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, -0.05, -0.06));
    // At his neck: the nozzle (its +Y) turned in and back toward it, low under his chin
    // Turned to point at him: the nozzle (+Y) straight back at the camera (a touch down and to the
    // left, toward his neck), and the side his hand's on (+X) turned down, his palm under it
    const toNeck = new THREE.Vector3(-0.12, 0.08, 1).normalize();
    const handDown = new THREE.Vector3(0, -1, 0).addScaledVector(toNeck, 0.3).normalize();
    const Q3 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(handDown, toNeck, new THREE.Vector3().crossVectors(handDown, toNeck)));
    const Q4 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 0.4, 1.2));
    const up = sm(t / 0.6);
    const flk = sm((t - 1.95) / 0.25) * (1 - sm((t - 2.45) / 0.2));
    const neck = sm((t - 2.5) / 0.55);
    const away = sm((t - 3.95) / 0.55);
    // Each spray jolts it a little toward him
    const jolt = (Math.max(0, 1 - Math.abs(t - 3.13) / 0.08) + Math.max(0, 1 - Math.abs(t - 3.58) / 0.08)) * 0.006;
    v.holder.position.lerpVectors(P0, P1, up).lerp(P3, neck).lerp(P4, away);
    v.holder.position.y += up * (1 - neck) * Math.sin(t * 1.6) * 0.004;
    v.holder.position.z += jolt;
    v.holder.quaternion.slerpQuaternions(Q0, Q1, up).slerp(Q2, flk * (1 - neck)).slerp(Q3, neck).slerp(Q4, away);
    // His forearm back down to his right shoulder however the bottle's turned (in its own frame
    // it would swing round with it, and come in across the bottom from the left)
    hand.grip.toward.set(0.35, -0.6, 0.72).normalize().applyQuaternion(v.holder.quaternion.clone().invert());
    // ---- His thumb: up its edge; under the cap and cocked; flicked up; then down on the nozzle, twice
    const H = CologneHunt;
    let shape = H.HOLD;
    if (t > 1.95 && t < 2.5) {
      const cock = sm((t - 1.95) / 0.22);
      const flick = sm((t - 2.17) / 0.06);
      const back = sm((t - 2.3) / 0.2);
      shape = mixShape(mixShape(mixShape(H.HOLD, H.COCK, cock), H.FLICK, flick), H.HOLD, back);
    } else if (t > 3.0 && t < 3.8) {
      const p = Math.max(Math.max(0, 1 - Math.abs(t - 3.13) / 0.09), Math.max(0, 1 - Math.abs(t - 3.58) / 0.09));
      shape = mixShape(mixShape(H.HOLD, H.COCK, sm((t - 3.0) / 0.1) * (1 - sm((t - 3.7) / 0.1))), H.PRESS, p);
    }
    v.arms?.shape('r', shape);
    // ---- The cap: off with the flick, up and away over his left shoulder, spinning
    if (hand.cap) {
      if (once('flick', 2.2)) {
        this.audio?.capFlick();
        hand.capV = new THREE.Vector3(-0.35, 1.25, -0.15);
        hand.capSpin.set(9 + Math.random() * 4, 3, -7);
      }
      if (hand.capV) {
        hand.capV.y -= 3.2 * dt;
        hand.cap.position.addScaledVector(hand.capV, dt);
        hand.cap.rotation.x += hand.capSpin.x * dt;
        hand.cap.rotation.y += hand.capSpin.y * dt;
        hand.cap.rotation.z += hand.capSpin.z * dt;
        if (t > 3.0) hand.cap.visible = false;
      }
    }
    // ---- Two sprays: a puff of mist out of the nozzle toward his neck each time
    for (const [k, at] of [['s1', 3.12], ['s2', 3.57]] as const) {
      if (once(k, at)) {
        this.audio?.perfumeSpray();
        this.spray(v, h.group, hand.nozzle);
      }
    }
    for (const m of v.mist) {
      if (m.life <= 0) continue;
      m.life -= dt;
      m.v.multiplyScalar(Math.exp(-dt * 2.2));
      m.s.position.addScaledVector(m.v, dt);
      // Gone as it reaches him (it would fill the screen past the lens)
      if (m.s.position.z > -0.07) m.life = Math.min(m.life, 0.06);
      const k = 1 - m.life / m.max;
      m.s.scale.setScalar(0.018 + k * 0.11);
      (m.s.material as THREE.SpriteMaterial).opacity = 0.75 * Math.sin(Math.min(1, k * 4) * Math.PI * 0.5) * (1 - k);
      if (m.life <= 0) m.s.visible = false;
    }
    // ---- The card while he looks at it; gone as he takes the cap off
    v.card.classList.toggle('show', t > 0.5 && t < 2.1);
    if (t >= CologneHunt.T_END) {
      h.group.removeFromParent();
      this.held = null;
      this.hand = null;
      v.card.classList.remove('show');
      for (const m of v.mist) {
        m.life = 0;
        m.s.visible = false;
      }
      this.handsBack();
      this.collect(h.id);
    }
  }

  /** A puff of the atomiser: mist out of the nozzle (bottle space), in the camera's frame. */
  private spray(v: NonNullable<CologneHunt['view']>, bottle: THREE.Object3D, nozzle: THREE.Vector3): void {
    v.cam.updateMatrixWorld(true);
    bottle.updateMatrixWorld(true);
    const toCam = v.cam.matrixWorld.clone().invert().multiply(bottle.matrixWorld);
    const at = nozzle.clone().applyMatrix4(toCam);
    const q = new THREE.Quaternion();
    toCam.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    let n = 0;
    for (const m of v.mist) {
      if (m.life > 0) continue;
      m.s.position.copy(at);
      m.s.position.addScaledVector(dir, Math.random() * 0.02);
      m.v.copy(dir).multiplyScalar(0.38 + Math.random() * 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.22));
      m.max = m.life = 0.6 + Math.random() * 0.5;
      m.s.visible = true;
      if (++n >= 22) break;
    }
  }

  /** Drawn over the frame while he's looking at one (the engine calls this after the scene). */
  renderOverlay(renderer: THREE.WebGLRenderer): void {
    if (!this.held || !this.view) return;
    const v = this.view;
    if (!v.scene.environment) {
      const pm = new THREE.PMREMGenerator(renderer);
      v.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    const c = renderer.domElement;
    v.cam.aspect = c.width / c.height;
    v.cam.updateProjectionMatrix();
    v.cam.updateMatrixWorld(true);
    v.arms?.update();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(v.scene, v.cam);
    renderer.autoClear = auto;
  }

  private collect(id: CologneId): void {
    const set = this.found();
    set.add(id);
    this.save(set);
    this.audio?.cologneGet();
    this.toast(id, set.size);
  }

  /** The achievement card, top right: the label, the name, the count. */
  private toast(id: CologneId, count: number): void {
    if (!this.uiRoot) return;
    const info = COLOGNES.find((c) => c.id === id)!;
    const el = document.createElement('div');
    el.className = 'cologne-toast';
    const img = this.label(id).toDataURL();
    el.innerHTML = `
      <img src="${img}" alt="">
      <div class="ct-text">
        <div class="ct-kicker">ACHIEVEMENT · ULTRA NICHE COLLECTED</div>
        <div class="ct-name">${info.name.toUpperCase()}</div>
        <div class="ct-count">${count} / ${COLOGNES.length} ULTRA-NICHE COLOGNES${count === COLOGNES.length ? ' — THE FULL COLLECTION' : ''}</div>
      </div>`;
    this.uiRoot.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => el.classList.remove('show'), 5200);
    setTimeout(() => el.remove(), 6000);
  }

  private static glint(): THREE.Texture {
    if (CologneHunt.glintTex) return CologneHunt.glintTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.15, 'rgba(255,240,200,0.8)');
    r.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(2, 32);
    g.lineTo(62, 32);
    g.moveTo(32, 2);
    g.lineTo(32, 62);
    g.stroke();
    CologneHunt.glintTex = new THREE.CanvasTexture(c);
    CologneHunt.glintTex.colorSpace = THREE.SRGBColorSpace;
    return CologneHunt.glintTex;
  }
}

export const Colognes = new CologneHunt();

// =============================================================== materials

const std = (o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial(o);
const M = {
  black: () => std({ color: 0x121215, roughness: 0.12, metalness: 0.35 }),
  gold: () => std({ color: 0xd8aa48, roughness: 0.22, metalness: 0.85, emissive: 0x2a1c05 }),
  chrome: () => std({ color: 0xd8dde2, roughness: 0.14, metalness: 0.9, emissive: 0x151515 }),
  glass: (color: number, opacity: number) => std({ color, roughness: 0.06, metalness: 0.15, transparent: true, opacity, depthWrite: false })
};

function labelMat(tex: THREE.Texture, transparent = false): THREE.MeshStandardMaterial {
  // A faint glow of its own so it still reads in the dark levels
  return std({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.28, roughness: 0.45, transparent, alphaTest: transparent ? 0.05 : 0 });
}

function texFrom(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ================================================================ geometry

/** A box with rounded vertical edges, base at y = 0. */
function roundBox(w: number, h: number, d: number, r: number, mat: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  const x = -w / 2;
  const z = -d / 2;
  s.moveTo(x + r, z);
  s.lineTo(x + w - r, z);
  s.quadraticCurveTo(x + w, z, x + w, z + r);
  s.lineTo(x + w, z + d - r);
  s.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
  s.lineTo(x + r, z + d);
  s.quadraticCurveTo(x, z + d, x, z + d - r);
  s.lineTo(x, z + r);
  s.quadraticCurveTo(x, z, x + r, z);
  const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 3, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2); // extruded up +Y, the shape lying in XZ
  geo.scale(1, 1, -1);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function lathe(points: [number, number][], mat: THREE.Material, segs = 32): THREE.Mesh {
  return new THREE.Mesh(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segs), mat);
}

function cyl(rTop: number, rBot: number, h: number, mat: THREE.Material, y: number, segs = 24): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs), mat);
  m.position.y = y + h / 2;
  return m;
}

/** A flat label on the front face, `z` out from the middle. */
function flatLabel(tex: THREE.Texture, w: number, h: number, y: number, z: number, transparent = false, tilt = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), labelMat(tex, transparent));
  m.position.set(0, y, z);
  m.rotation.x = tilt;
  return m;
}

/** A label wrapped round a round bottle: `arc` radians across the front. */
function wrapLabel(tex: THREE.Texture, r: number, h: number, y: number, arc: number, transparent = false): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, h, 24, 1, true, -arc / 2, arc);
  const m = new THREE.Mesh(g, labelMat(tex, transparent));
  m.position.y = y + h / 2;
  return m;
}

// ================================================================== labels

type Painter = (g: CanvasRenderingContext2D, W: number, H: number) => void;

function canvas(W: number, H: number, paint: Painter): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  paint(c.getContext('2d')!, W, H);
  return c;
}

function centred(g: CanvasRenderingContext2D, lines: string[], x: number, y: number, lh: number, font: string, fill: string, stroke?: string): void {
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = 6;
      g.lineJoin = 'round';
      g.strokeText(l, x, y + i * lh);
    }
    g.fillStyle = fill;
    g.fillText(l, x, y + i * lh);
  });
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
}

function goldGrad(g: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, '#fbe7a1');
  gr.addColorStop(0.5, '#d8aa48');
  gr.addColorStop(1, '#a8781e');
  return gr;
}

/** Each bottle's front label, 256 wide. */
function drawLabel(id: CologneId): HTMLCanvasElement {
  switch (id) {
    case 'deadbull':
      return canvas(256, 220, (g, W, H) => {
        g.fillStyle = '#141417';
        g.fillRect(0, 0, W, H);
        centred(g, ['Deadbull'], W / 2, 86, 0, `italic 700 50px ${SERIF}`, goldGrad(g, 50, 120) as unknown as string);
        // A little bull's head
        g.fillStyle = '#d8aa48';
        g.beginPath();
        g.ellipse(W / 2, 166, 20, 24, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#d8aa48';
        g.lineWidth = 7;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(W / 2 - 16, 150);
        g.quadraticCurveTo(W / 2 - 48, 146, W / 2 - 46, 120);
        g.moveTo(W / 2 + 16, 150);
        g.quadraticCurveTo(W / 2 + 48, 146, W / 2 + 46, 120);
        g.stroke();
        g.fillStyle = '#141417';
        g.beginPath();
        g.arc(W / 2 - 7, 162, 3.5, 0, Math.PI * 2);
        g.arc(W / 2 + 7, 162, 3.5, 0, Math.PI * 2);
        g.fill();
      });
    case 'curry':
      return canvas(256, 300, (g, W, H) => {
        // Spice-orange paisley ground, a red oval with a gold rim
        g.fillStyle = '#e07b1c';
        g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(150, 50, 0, 0.35)';
        for (let i = 0; i < 26; i++) {
          g.beginPath();
          g.ellipse((i * 53) % W, (i * 89) % H, 9, 15, i, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#d4a640';
        g.beginPath();
        g.ellipse(W / 2, H / 2, 112, 134, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#8f1515';
        g.beginPath();
        g.ellipse(W / 2, H / 2, 102, 124, 0, 0, Math.PI * 2);
        g.fill();
        // Chef's hat
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(W / 2 - 18, 74, 16, 0, Math.PI * 2);
        g.arc(W / 2, 64, 19, 0, Math.PI * 2);
        g.arc(W / 2 + 18, 74, 16, 0, Math.PI * 2);
        g.fill();
        g.fillRect(W / 2 - 20, 76, 40, 20);
        centred(g, ['Curry'], W / 2, 138, 0, `800 58px ${SERIF}`, '#ffffff', '#5a0b0b');
        // The bowl
        g.fillStyle = '#e9e2d4';
        g.beginPath();
        g.ellipse(W / 2, 200, 58, 12, 0, 0, Math.PI);
        g.lineTo(W / 2 - 58, 200);
        g.bezierCurveTo(W / 2 - 54, 250, W / 2 + 54, 250, W / 2 + 58, 200);
        g.fill();
        g.fillStyle = '#e8891e';
        g.beginPath();
        g.ellipse(W / 2, 200, 54, 10, 0, 0, Math.PI * 2);
        g.fill();
      });
    case 'haheed':
      return canvas(150, 340, (g, W, H) => {
        g.fillStyle = '#0d0d10';
        g.fillRect(0, 0, W, H);
        // A golden archway, light pouring through, a figure walking into it
        const gr = g.createRadialGradient(W / 2, 120, 4, W / 2, 120, 90);
        gr.addColorStop(0, '#ffe7a0');
        gr.addColorStop(0.5, '#d88a20');
        gr.addColorStop(1, '#3a2205');
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(W / 2 - 46, 200);
        g.lineTo(W / 2 - 46, 80);
        g.quadraticCurveTo(W / 2 - 46, 30, W / 2, 22);
        g.quadraticCurveTo(W / 2 + 46, 30, W / 2 + 46, 80);
        g.lineTo(W / 2 + 46, 200);
        g.closePath();
        g.fill();
        g.fillStyle = '#0d0d10';
        g.beginPath();
        g.arc(W / 2, 138, 7, 0, Math.PI * 2);
        g.fill();
        g.fillRect(W / 2 - 6, 145, 12, 26);
        g.fillRect(W / 2 - 6, 170, 5, 24);
        g.fillRect(W / 2 + 2, 170, 5, 22);
        centred(g, ['JOURNEY', 'OF', 'HAHEED'], W / 2, 236, 34, `800 27px ${FONT}`, '#f2e6c8');
      });
    case 'scam':
      return canvas(300, 200, (g, W, H) => {
        g.fillStyle = '#e7cf8f';
        g.fillRect(0, 0, W, H);
        g.strokeStyle = '#7a5410';
        g.lineWidth = 4;
        g.strokeRect(70, 6, W - 140, H - 12);
        centred(g, ['$'], W / 2, 46, 0, `900 64px ${SERIF}`, '#2a1c05');
        centred(g, ['SCENT OF', 'THE SCAM'], W / 2, 104, 36, `900 32px ${FONT}`, '#2a1c05');
        centred(g, ['EAU DE PARFUM'], W / 2, 176, 0, `700 14px ${FONT}`, '#2a1c05');
      });
    case 'keypad':
      return canvas(180, 300, (g, W, H) => {
        g.fillStyle = '#16161a';
        g.fillRect(0, 0, W, H);
        // The screen
        g.fillStyle = '#9a8a4a';
        g.fillRect(14, 14, W - 28, 92);
        g.fillStyle = '#d9cf8a';
        g.fillRect(20, 20, W - 40, 80);
        centred(g, ['MUSTY', 'KEYPAD'], W / 2, 46, 32, `900 28px ${FONT}`, '#1a1a10');
        // The keys
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
        keys.forEach((k, i) => {
          const x = 26 + (i % 3) * 46;
          const y = 122 + Math.floor(i / 3) * 42;
          g.fillStyle = '#2a2a30';
          g.beginPath();
          g.roundRect(x, y, 38, 34, 7);
          g.fill();
          g.strokeStyle = '#6a6a72';
          g.lineWidth = 2;
          g.stroke();
          centred(g, [k], x + 19, y + 18, 0, `700 20px ${FONT}`, '#e8e8ee');
        });
      });
    case 'declined':
      return canvas(240, 200, (g, W, H) => {
        g.fillStyle = '#f2ead6';
        g.fillRect(0, 0, W, H);
        g.strokeStyle = '#1a1a1a';
        g.lineWidth = 4;
        g.strokeRect(6, 6, W - 12, H - 12);
        centred(g, ['DECLINED', 'CARD'], W / 2, 44, 38, `900 36px ${FONT}`, '#111');
        centred(g, ['ON THE ROCKS'], W / 2, 122, 0, `800 20px ${FONT}`, '#111');
        // The card
        g.fillStyle = '#c0392b';
        g.beginPath();
        g.roundRect(W / 2 - 40, 140, 80, 46, 6);
        g.fill();
        g.fillStyle = '#e8c35a';
        g.fillRect(W / 2 - 30, 152, 16, 12);
        g.fillStyle = '#ffffff';
        g.fillRect(W / 2 - 30, 172, 56, 4);
      });
    case 'delhi':
      return canvas(220, 320, (g, W, H) => {
        g.fillStyle = '#f3e9d6';
        g.fillRect(0, 0, W, H);
        // A gold arch outline
        g.strokeStyle = '#c39a3e';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(18, H - 14);
        g.lineTo(18, 90);
        g.quadraticCurveTo(18, 22, W / 2, 12);
        g.quadraticCurveTo(W - 18, 22, W - 18, 90);
        g.lineTo(W - 18, H - 14);
        g.stroke();
        centred(g, ['DIOR'], W / 2, 108, 0, `400 44px ${SERIF}`, '#2b2418');
        centred(g, ['DE'], W / 2, 148, 0, `400 20px ${SERIF}`, '#2b2418');
        centred(g, ['DELHI'], W / 2, 186, 0, `400 42px ${SERIF}`, '#2b2418');
        // Skyline: a dome and two minarets
        g.fillStyle = '#c39a3e';
        g.beginPath();
        g.arc(W / 2, 270, 28, Math.PI, 0);
        g.fill();
        g.fillRect(W / 2 - 34, 268, 68, 34);
        g.fillRect(W / 2 - 66, 236, 8, 66);
        g.fillRect(W / 2 + 58, 236, 8, 66);
        g.fillRect(W / 2 - 1.5, 230, 3, 14);
        g.fillRect(28, 284, 30, 18);
        g.fillRect(W - 58, 284, 30, 18);
      });
    case 'pit':
      return canvas(220, 260, (g, W, H) => {
        g.fillStyle = '#2a2a2c';
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 60; i++) {
          g.fillStyle = `rgba(${90 + (i % 5) * 10},${90 + (i % 5) * 10},${95 + (i % 5) * 10},0.25)`;
          g.fillRect((i * 37) % W, (i * 61) % H, 10 + (i % 4) * 6, 6 + (i % 3) * 4);
        }
        // The glowing pit, the ladder down into it, a figure at the bottom
        const gr = g.createRadialGradient(W / 2, 130, 5, W / 2, 130, 80);
        gr.addColorStop(0, '#ffc760');
        gr.addColorStop(1, 'rgba(120, 60, 0, 0)');
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(40, 170);
        g.lineTo(70, 70);
        g.lineTo(150, 62);
        g.lineTo(184, 170);
        g.closePath();
        g.fill();
        g.strokeStyle = '#d8d0c0';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(150, 10);
        g.lineTo(150, 150);
        g.moveTo(166, 10);
        g.lineTo(166, 150);
        for (let y = 18; y < 150; y += 14) {
          g.moveTo(150, y);
          g.lineTo(166, y);
        }
        g.stroke();
        g.fillStyle = '#111';
        g.beginPath();
        g.arc(100, 120, 6, 0, Math.PI * 2);
        g.fill();
        g.fillRect(95, 126, 10, 24);
        centred(g, ['SINKING', 'PIT'], W / 2, 196, 40, `900 36px ${FONT}`, '#f2f2f2', '#000');
      });
    case 'tikka':
      return canvas(240, 300, (g, W, H) => {
        g.clearRect(0, 0, W, H);
        // A clock face
        g.strokeStyle = '#d8aa48';
        g.lineWidth = 5;
        g.beginPath();
        g.arc(W / 2, 92, 54, 0, Math.PI * 2);
        g.stroke();
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          g.beginPath();
          g.moveTo(W / 2 + Math.cos(a) * 44, 92 + Math.sin(a) * 44);
          g.lineTo(W / 2 + Math.cos(a) * 52, 92 + Math.sin(a) * 52);
          g.stroke();
        }
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(W / 2, 92);
        g.lineTo(W / 2, 56);
        g.moveTo(W / 2, 92);
        g.lineTo(W / 2 + 28, 104);
        g.stroke();
        centred(g, ['TIKKA', 'TOCK'], W / 2, 186, 44, `900 42px ${FONT}`, '#f4d27a', '#1a1206');
        centred(g, ['EAU DE PARFUM'], W / 2, 266, 0, `700 15px ${FONT}`, '#f4d27a');
      });
    case 'sweat':
      return canvas(320, 220, (g, W, H) => {
        g.fillStyle = '#1b1b1f';
        g.fillRect(0, 0, W, H);
        g.strokeStyle = '#8a8a90';
        g.lineWidth = 3;
        g.strokeRect(70, 8, W - 140, H - 16);
        g.font = `900 38px ${FONT}`;
        g.textAlign = 'center';
        g.fillStyle = '#f0f0f0';
        g.fillText('SWEAT', W / 2 - 14, 58);
        g.font = `700 18px ${FONT}`;
        g.fillText('of', W / 2 + 64, 52);
        g.font = `900 38px ${FONT}`;
        g.fillText('LABOUR', W / 2, 100);
        g.font = `700 16px ${FONT}`;
        g.fillText('EDT.', W / 2, 128);
        g.textAlign = 'left';
        // Skull
        g.fillStyle = '#e8e8e8';
        g.beginPath();
        g.arc(W / 2, 168, 18, 0, Math.PI * 2);
        g.fill();
        g.fillRect(W / 2 - 10, 178, 20, 16);
        g.fillStyle = '#1b1b1f';
        g.beginPath();
        g.arc(W / 2 - 7, 166, 5, 0, Math.PI * 2);
        g.arc(W / 2 + 7, 166, 5, 0, Math.PI * 2);
        g.fill();
      });
    case 'davi':
      return canvas(220, 300, (g, W, H) => {
        g.fillStyle = '#0f0f12';
        g.fillRect(0, 0, W, H);
        g.strokeStyle = '#d8aa48';
        g.lineWidth = 3;
        g.strokeRect(14, 14, W - 28, H - 28);
        centred(g, ['D'], W / 2, 96, 0, `400 104px ${SERIF}`, '#e3bd62');
        centred(g, ['Davi Doff'], W / 2, 186, 0, `400 34px ${SERIF}`, '#e3bd62');
        centred(g, ['pour homme'], W / 2, 220, 0, `italic 400 18px ${SERIF}`, '#e3bd62');
        g.strokeStyle = '#d8aa48';
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(24, H - 30);
        g.lineTo(W - 24, H - 70);
        g.stroke();
      });
    case 'microsuf':
      return canvas(240, 260, (g, W, H) => {
        g.clearRect(0, 0, W, H);
        // Circuit traces
        g.strokeStyle = 'rgba(160, 220, 255, 0.75)';
        g.lineWidth = 2;
        for (let i = 0; i < 14; i++) {
          const x = 12 + i * 16;
          g.beginPath();
          g.moveTo(x, i % 2 ? 0 : H);
          g.lineTo(x, H / 2 + (i % 3) * 22 - 22);
          g.lineTo(x + 14, H / 2 + (i % 3) * 22 - 8);
          g.stroke();
          g.fillStyle = 'rgba(200, 240, 255, 0.9)';
          g.beginPath();
          g.arc(x + 14, H / 2 + (i % 3) * 22 - 8, 3, 0, Math.PI * 2);
          g.fill();
        }
        // The four panes
        g.fillStyle = '#e8f6ff';
        const s = 30;
        g.fillRect(W / 2 - s - 2, 46, s, s);
        g.fillRect(W / 2 + 2, 46, s, s);
        g.fillRect(W / 2 - s - 2, 46 + s + 4, s, s);
        g.fillRect(W / 2 + 2, 46 + s + 4, s, s);
        centred(g, ['Microsuf'], W / 2, 186, 0, `600 44px ${FONT}`, '#ffffff', '#0b3a6a');
      });
    case 'pubjae':
      return canvas(320, 160, (g, W, H) => {
        g.fillStyle = '#1a1a1a';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#d88a20';
        g.fillRect(0, 0, W, 6);
        g.fillRect(0, H - 6, W, 6);
        centred(g, ['Pubjae'], W / 2, 70, 0, `900 54px ${FONT}`, '#f2c35a', '#000');
        // Little soldiers along the bottom
        g.fillStyle = '#d88a20';
        for (let i = 0; i < 5; i++) {
          const x = 100 + i * 30;
          g.beginPath();
          g.arc(x, 116, 6, 0, Math.PI * 2);
          g.fill();
          g.fillRect(x - 5, 122, 10, 18);
        }
      });
    case 'maw':
      return canvas(240, 200, (g, W, H) => {
        g.fillStyle = '#0a0610';
        g.fillRect(0, 0, W, H);
        // A green planet, a ring of fangs round it
        g.fillStyle = '#3aa020';
        g.beginPath();
        g.arc(W / 2, 74, 34, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#0a0610';
        g.beginPath();
        g.arc(W / 2, 74, 18, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#e8dfc2';
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          g.beginPath();
          g.moveTo(W / 2 + Math.cos(a) * 30, 74 + Math.sin(a) * 30);
          g.lineTo(W / 2 + Math.cos(a + 0.12) * 18, 74 + Math.sin(a + 0.12) * 18);
          g.lineTo(W / 2 + Math.cos(a + 0.26) * 30, 74 + Math.sin(a + 0.26) * 30);
          g.fill();
        }
        centred(g, ['MUSK OF', 'THE MAW'], W / 2, 140, 30, `700 26px ${SERIF}`, '#b8ff5a');
      });
    case 'odore':
      return canvas(240, 170, (g, W, H) => {
        g.clearRect(0, 0, W, H);
        g.fillStyle = '#121212';
        g.beginPath();
        g.ellipse(W / 2, H / 2, W / 2 - 6, H / 2 - 6, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#c9c9c9';
        g.lineWidth = 3;
        g.stroke();
        centred(g, ['Odoré'], W / 2, H / 2 - 4, 0, `400 52px ${SERIF}`, '#f2f2f2');
        g.strokeStyle = '#c9c9c9';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(W / 2 - 30, H / 2 + 34);
        g.bezierCurveTo(W / 2 - 10, H / 2 + 24, W / 2 + 10, H / 2 + 44, W / 2 + 30, H / 2 + 34);
        g.stroke();
      });
  }
}

// ================================================================= bottles

/**
 * Where each bottle's cap starts (y, bottle space): everything wholly above
 * it is the cap, lifted off as one; the neck or collar below it stays.
 */
const CAP_Y: Record<CologneId, number> = {
  keypad: 0.098,
  scam: 0.105,
  declined: 0.088,
  tikka: 0.11,
  sweat: 0.084,
  davi: 0.108,
  delhi: 0.108,
  pit: 0.104,
  deadbull: 0.068,
  curry: 0.105,
  haheed: 0.107,
  microsuf: 0.098,
  pubjae: 0.076,
  odore: 0.095,
  maw: 0.086
};

/** The cap's parts into a group of their own (`userData.cap`), pivoting about its middle. */
function splitCap(id: CologneId, g: THREE.Group): void {
  const cap = new THREE.Group();
  cap.name = 'cap';
  const box = new THREE.Box3();
  const parts: THREE.Object3D[] = [];
  g.updateMatrixWorld(true);
  for (const o of g.children) {
    const m = o as THREE.Mesh;
    if (!m.isMesh) continue;
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrix);
    // (the helmet's chin strap hangs below the brim, but it's the helmet's)
    if (b.min.y >= CAP_Y[id] - 1e-4 || (id === 'pubjae' && m.geometry.type === 'TorusGeometry')) {
      parts.push(m);
      box.union(b);
    }
  }
  if (!parts.length) return;
  const c = box.getCenter(new THREE.Vector3());
  cap.position.copy(c);
  g.add(cap);
  for (const m of parts) {
    m.position.sub(c);
    cap.add(m);
  }
  g.userData.cap = cap;
}

function buildBottle(id: CologneId, label: HTMLCanvasElement): THREE.Group {
  const g = new THREE.Group();
  const tex = texFrom(label);
  const add = (...o: THREE.Object3D[]): void => {
    for (const m of o) {
      m.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
      });
      g.add(m);
    }
  };
  switch (id) {
    case 'deadbull': {
      const black = M.black();
      const gold = M.gold();
      add(roundBox(0.085, 0.07, 0.045, 0.012, black));
      add(flatLabel(tex, 0.07, 0.06, 0.038, 0.0256));
      // The bull's head on top, gold horns sweeping up
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.024, 20, 14), black);
      head.scale.set(1.1, 0.95, 1.2);
      head.position.set(0, 0.092, 0.006);
      const snout = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), black);
      snout.scale.set(1.2, 0.8, 1);
      snout.position.set(0, 0.084, 0.03);
      add(head, snout);
      for (const s of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(s * 0.018, 0.1, 0.004),
          new THREE.Vector3(s * 0.04, 0.104, 0),
          new THREE.Vector3(s * 0.05, 0.122, -0.002),
          new THREE.Vector3(s * 0.044, 0.138, 0)
        ]);
        const horn = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.0045, 8), gold);
        add(horn);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.01, 8), gold);
        tip.position.set(s * 0.043, 0.142, 0);
        add(tip);
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 8), black);
        ear.scale.set(1.6, 0.6, 1);
        ear.position.set(s * 0.03, 0.096, 0.004);
        add(ear);
      }
      break;
    }
    case 'curry': {
      const glass = M.glass(0xc8611a, 0.92);
      add(roundBox(0.068, 0.085, 0.034, 0.01, glass));
      add(flatLabel(tex, 0.06, 0.07, 0.044, 0.0201));
      add(lathe([[0.03, 0.085], [0.02, 0.092], [0.012, 0.1], [0.011, 0.112]], glass, 24));
      const cap = cyl(0.014, 0.014, 0.022, std({ color: 0xc0201a, roughness: 0.35 }), 0.11, 20);
      add(cap);
      break;
    }
    case 'haheed': {
      const black = std({ color: 0x0e0e12, roughness: 0.08, metalness: 0.4, flatShading: true });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.03, 0.105, 6), black);
      body.geometry.rotateY(Math.PI / 6);
      body.position.y = 0.0525;
      add(body);
      const apo0 = 0.03 * Math.cos(Math.PI / 6);
      const apo1 = 0.042 * Math.cos(Math.PI / 6);
      add(flatLabel(tex, 0.034, 0.078, 0.052, (apo0 + apo1) / 2 + 0.0012, false, Math.atan((apo1 - apo0) / 0.105)));
      const neck = cyl(0.01, 0.012, 0.01, black, 0.105, 12);
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.02), std({ color: 0x16161a, roughness: 0.1, metalness: 0.5, flatShading: true }));
      cap.scale.set(0.9, 1.4, 0.9);
      cap.position.y = 0.137;
      add(neck, cap);
      break;
    }
    case 'scam': {
      const sack = std({ color: 0xd9b46a, roughness: 0.32, metalness: 0.55, emissive: 0x2a1c05 });
      add(
        lathe(
          [
            [0, 0],
            [0.036, 0.002],
            [0.05, 0.022],
            [0.054, 0.048],
            [0.047, 0.072],
            [0.03, 0.088],
            [0.016, 0.096],
            [0.014, 0.1],
            [0.02, 0.106],
            [0.024, 0.11],
            [0, 0.11]
          ],
          sack
        )
      );
      add(wrapLabel(tex, 0.0548, 0.05, 0.022, 1.9));
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.0155, 0.003, 8, 24), M.gold());
      tie.rotation.x = Math.PI / 2;
      tie.position.y = 0.098;
      add(tie);
      // The crown
      const gold = M.gold();
      add(cyl(0.02, 0.018, 0.012, gold, 0.11, 20));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.0045, 0.014, 6), gold);
        spike.position.set(Math.sin(a) * 0.016, 0.128, Math.cos(a) * 0.016);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.003, 8, 6), gold);
        ball.position.set(Math.sin(a) * 0.016, 0.136, Math.cos(a) * 0.016);
        add(spike, ball);
      }
      break;
    }
    case 'keypad': {
      add(roundBox(0.058, 0.1, 0.028, 0.007, M.black()));
      add(flatLabel(tex, 0.052, 0.09, 0.05, 0.0172));
      const cap = roundBox(0.034, 0.022, 0.022, 0.006, M.chrome());
      cap.position.y = 0.103;
      add(cap);
      break;
    }
    case 'declined': {
      add(roundBox(0.08, 0.075, 0.08, 0.01, M.glass(0xe6f0f5, 0.32)));
      const whisky = roundBox(0.07, 0.052, 0.07, 0.008, M.glass(0xb8650f, 0.82));
      whisky.position.y = 0.006;
      add(whisky);
      const ice = std({ color: 0xeaf6ff, roughness: 0.05, transparent: true, opacity: 0.65 });
      for (const [x, z, r] of [
        [-0.014, 0.008, 0.3],
        [0.013, -0.01, 1.1]
      ]) {
        const cube = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.02, 0.022), ice);
        cube.position.set(x, 0.058, z);
        cube.rotation.set(0.2, r, 0.15);
        add(cube);
      }
      add(flatLabel(tex, 0.058, 0.048, 0.034, 0.0434));
      add(cyl(0.012, 0.014, 0.012, M.glass(0xe6f0f5, 0.5), 0.078, 16));
      add(cyl(0.016, 0.016, 0.012, M.gold(), 0.09, 20));
      break;
    }
    case 'delhi': {
      const cream = std({ color: 0xf1e6d2, roughness: 0.25, metalness: 0.05 });
      // An arch: straight sides, a rounded top, extruded front to back
      const s = new THREE.Shape();
      s.moveTo(-0.034, 0);
      s.lineTo(0.034, 0);
      s.lineTo(0.034, 0.072);
      s.quadraticCurveTo(0.034, 0.1, 0, 0.104);
      s.quadraticCurveTo(-0.034, 0.1, -0.034, 0.072);
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: 0.032, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 3, curveSegments: 16 });
      geo.translate(0, 0, -0.016);
      add(new THREE.Mesh(geo, cream));
      add(flatLabel(tex, 0.058, 0.084, 0.048, 0.0195));
      const gold = M.gold();
      add(cyl(0.012, 0.012, 0.006, gold, 0.104, 16));
      add(cyl(0.016, 0.016, 0.028, gold, 0.11, 20));
      break;
    }
    case 'pit': {
      const stone = std({ color: 0x3a3a3e, roughness: 0.9, metalness: 0.05 });
      add(roundBox(0.074, 0.088, 0.05, 0.005, stone));
      add(flatLabel(tex, 0.066, 0.078, 0.046, 0.0284));
      const metal = std({ color: 0x4a4a50, roughness: 0.4, metalness: 0.8 });
      add(cyl(0.012, 0.012, 0.012, metal, 0.094, 12));
      add(cyl(0.018, 0.018, 0.02, metal, 0.106, 8));
      break;
    }
    case 'tikka': {
      const black = std({ color: 0x141418, roughness: 0.1, metalness: 0.45, flatShading: true });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.058, 0.12, 4), black);
      cone.geometry.rotateY(Math.PI / 4);
      cone.position.y = 0.06;
      add(cone);
      add(cyl(0.044, 0.044, 0.006, M.gold(), 0, 4).rotateY(Math.PI / 4));
      const apo = 0.058 * Math.cos(Math.PI / 4);
      const tilt = Math.atan(apo / 0.12);
      const yc = 0.04;
      add(flatLabel(tex, 0.046, 0.058, yc, apo * (1 - yc / 0.12) + 0.0015, true, -tilt));
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.012), std({ color: 0x1a1a1e, roughness: 0.1, metalness: 0.5, flatShading: true }));
      cap.position.y = 0.124;
      add(cap);
      break;
    }
    case 'sweat': {
      const black = std({ color: 0x18181c, roughness: 0.12, metalness: 0.4, flatShading: true });
      add(cyl(0.04, 0.042, 0.078, black, 0, 10));
      add(wrapLabel(tex, 0.0425, 0.05, 0.016, 1.7));
      const chrome = M.chrome();
      add(cyl(0.03, 0.04, 0.008, chrome, 0.078, 20));
      add(cyl(0.024, 0.024, 0.03, chrome, 0.086, 20));
      add(cyl(0.025, 0.025, 0.004, std({ color: 0x222226, metalness: 0.6, roughness: 0.3 }), 0.1, 20));
      break;
    }
    case 'davi': {
      add(roundBox(0.074, 0.1, 0.03, 0.004, M.black()));
      add(flatLabel(tex, 0.066, 0.09, 0.05, 0.0182));
      const gold = M.gold();
      add(cyl(0.01, 0.01, 0.008, gold, 0.103, 16));
      add(cyl(0.014, 0.014, 0.03, gold, 0.11, 20));
      break;
    }
    case 'microsuf': {
      add(roundBox(0.08, 0.09, 0.035, 0.008, M.glass(0x2a7fd4, 0.78)));
      add(flatLabel(tex, 0.072, 0.078, 0.046, 0.0207, true));
      const chrome = M.chrome();
      add(cyl(0.011, 0.011, 0.008, chrome, 0.093, 16));
      add(cyl(0.016, 0.016, 0.028, chrome, 0.1, 20));
      break;
    }
    case 'pubjae': {
      add(
        lathe(
          [
            [0, 0],
            [0.03, 0.001],
            [0.042, 0.012],
            [0.046, 0.034],
            [0.042, 0.058],
            [0.026, 0.07],
            [0.014, 0.074],
            [0, 0.074]
          ],
          M.glass(0xd07a18, 0.88)
        )
      );
      add(wrapLabel(tex, 0.0466, 0.028, 0.02, 2.0));
      // The helmet
      const olive = std({ color: 0x1e211c, roughness: 0.5, metalness: 0.2 });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.034, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), olive);
      dome.position.y = 0.08;
      dome.scale.y = 0.85;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.04, 0.005, 24), olive);
      brim.position.y = 0.081;
      add(cyl(0.012, 0.012, 0.008, olive, 0.073, 12), dome, brim);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0018, 6, 24, Math.PI), std({ color: 0x5a4a2a, roughness: 0.8 }));
      strap.position.y = 0.078;
      strap.rotation.z = Math.PI;
      add(strap);
      break;
    }
    case 'maw': {
      // A squat flask of acid-green glass, a cap like a fanged mouth
      add(
        lathe(
          [
            [0, 0],
            [0.036, 0.001],
            [0.048, 0.02],
            [0.05, 0.05],
            [0.04, 0.07],
            [0.016, 0.078],
            [0, 0.078]
          ],
          M.glass(0x6adf2a, 0.82),
          32
        )
      );
      add(wrapLabel(tex, 0.0505, 0.032, 0.022, 1.6));
      const flesh = std({ color: 0x6a1a32, roughness: 0.3, metalness: 0.1 });
      add(cyl(0.014, 0.016, 0.01, flesh, 0.078, 16));
      add(cyl(0.022, 0.018, 0.022, flesh, 0.088, 20));
      const tooth = std({ color: 0xe8dfc2, roughness: 0.3 });
      for (let k = 0; k < 8; k++) {
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.003, 0.012, 5), tooth);
        const a = (k / 8) * Math.PI * 2;
        t.position.set(Math.cos(a) * 0.016, 0.104, Math.sin(a) * 0.016);
        add(t);
      }
      break;
    }
    case 'odore': {
      add(
        lathe(
          [
            [0, 0],
            [0.034, 0.001],
            [0.044, 0.016],
            [0.034, 0.04],
            [0.044, 0.066],
            [0.03, 0.084],
            [0.012, 0.09],
            [0, 0.09]
          ],
          M.glass(0xeef6ff, 0.42),
          36
        )
      );
      const liquid = lathe(
        [
          [0, 0.004],
          [0.03, 0.006],
          [0.038, 0.018],
          [0.029, 0.04],
          [0.036, 0.06],
          [0, 0.06]
        ],
        M.glass(0xf3d9a0, 0.55),
        24
      );
      add(liquid);
      add(flatLabel(tex, 0.05, 0.035, 0.034, 0.042, true));
      const chrome = M.chrome();
      add(cyl(0.01, 0.01, 0.008, chrome, 0.09, 16));
      add(cyl(0.013, 0.015, 0.03, chrome, 0.097, 20));
      break;
    }
  }
  splitCap(id, g);
  return g;
}
