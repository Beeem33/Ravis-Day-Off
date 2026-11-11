import * as THREE from 'three';
import { Enemy } from '../entities/Enemy';
import { HitmanVisual } from '../entities/HitmanVisual';
import { Lady, sunLounger } from './MenuLadies';

/**
 * The menu's yacht: a white motor yacht at anchor off to Ravi's right, the
 * call-floor crew on it having the party of their lives. Two of them doing
 * cannonballs off the side and swimming back round to the stern ladder,
 * a group talking with drinks on the aft deck, a couple making out at the
 * rail, a DJ and dancers up on the sundeck under strings of lights.
 *
 * Its own frame: bow toward +X, the side facing Ravi is −Z, the main deck
 * at y = DECK, the waterline at 0.
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const DECK = 2.4;
const SUN = 4.65;
const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/** The hull's plan: a flat transom aft, straight sides, a long pointed bow. */
function hullShape(inset = 0, aft = -13, beam = 3.3): THREE.Shape {
  const b = beam - inset;
  const s = new THREE.Shape();
  s.moveTo(aft + inset, -b + 0.25);
  s.lineTo(4, -b);
  s.quadraticCurveTo(11.5 - inset, -b + 0.3, 14.5 - inset * 1.6, 0);
  s.quadraticCurveTo(11.5 - inset, b - 0.3, 4, b);
  s.lineTo(aft + inset, b - 0.25);
  s.closePath();
  return s;
}

/** A slab of the plan between two heights (the shape is in x/z). */
function slab(shape: THREE.Shape, y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 16 });
  // Extruded along +Z with the shape in x/y: turn so the shape lies in x/z and the depth runs up
  g.rotateX(Math.PI / 2);
  g.translate(0, y1, 0);
  return g;
}

interface Jumper {
  e: Enemy;
  home: THREE.Vector3;
  gate: THREE.Vector3;
  state: 'wait' | 'run' | 'air' | 'swim' | 'climb' | 'stairs' | 'back';
  t: number;
  wait: number;
  from: THREE.Vector3;
  splashed: boolean;
}

export class MenuYacht {
  readonly group = new THREE.Group();
  private people: Enemy[] = [];
  private jumpers: Jumper[] = [];
  private talkers: Enemy[] = [];
  private couple: Enemy[] = [];
  private dancers: Enemy[] = [];
  private dj: Enemy | null = null;
  private bulbs: THREE.Mesh[] = [];
  private drops: { s: THREE.Sprite; v: THREE.Vector3; life: number }[] = [];
  private rings: { m: THREE.Mesh; life: number }[] = [];
  private dropTex: THREE.CanvasTexture;
  private floaties: THREE.Object3D[] = [];
  private ladies: Lady[] = [];

  constructor() {
    this.dropTex = this.makeDropTex();
    this.buildBoat();
    this.buildLadies();
    // The crew come aboard once their model has loaded (it loads behind the menu)
    HitmanVisual.load(`${import.meta.env.BASE_URL}models/hitman.glb`)
      .then(() => this.buildParty())
      .catch(() => {});
  }

  // ------------------------------------------------------------- the boat

  private buildBoat(): void {
    const g = this.group;
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f7f5, roughness: 0.35, metalness: 0.05 });
    const navy = new THREE.MeshStandardMaterial({ color: 0x14284a, roughness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0d1820, roughness: 0.08, metalness: 0.6 });
    const teak = new THREE.MeshStandardMaterial({ color: 0xb0814f, roughness: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.2, metalness: 0.9 });
    const antifoul = new THREE.MeshStandardMaterial({ color: 0x7a1d1d, roughness: 0.8 });

    // Hull: the red bottom under the water, the white topsides, a navy stripe, the boot line
    g.add(new THREE.Mesh(slab(hullShape(0.5), -1.2, 0.05), antifoul));
    g.add(new THREE.Mesh(slab(hullShape(0), 0.05, DECK), white));
    const stripe = new THREE.Mesh(slab(hullShape(-0.01), 1.15, 1.45), navy);
    g.add(stripe);
    const boot = new THREE.Mesh(slab(hullShape(-0.01), 0.05, 0.2), navy);
    g.add(boot);
    // Teak on the decks, a bulwark cap round the edge
    const deck = new THREE.Mesh(slab(hullShape(0.12), DECK, DECK + 0.02), teak);
    g.add(deck);
    // Long dark hull windows down each side (the cabins below)
    const hullGlass = new THREE.MeshStandardMaterial({ color: 0x0d1820, roughness: 0.08, metalness: 0.6, side: THREE.DoubleSide });
    for (const z of [-1, 1]) {
      for (const [x0, x1] of [[-10.5, -6.2], [-5.4, -0.6], [0.2, 3.6]]) {
        const w = new THREE.Shape();
        const h = 0.22;
        w.moveTo(x0 + h, -h);
        w.lineTo(x1 - h, -h);
        w.absarc(x1 - h, 0, h, -Math.PI / 2, Math.PI / 2, false);
        w.lineTo(x0 + h, h);
        w.absarc(x0 + h, 0, h, Math.PI / 2, (Math.PI * 3) / 2, false);
        const m = new THREE.Mesh(new THREE.ShapeGeometry(w, 8), hullGlass);
        m.position.set(0, 0.72, z * 3.32);
        g.add(m);
      }
    }

    // The saloon: a white cabin with a wraparound band of dark glass
    const cabin = new THREE.Shape();
    cabin.moveTo(-3.5, -2.5);
    cabin.lineTo(6.5, -2.4);
    cabin.quadraticCurveTo(9.2, -1.6, 9.6, 0);
    cabin.quadraticCurveTo(9.2, 1.6, 6.5, 2.4);
    cabin.lineTo(-3.5, 2.5);
    cabin.closePath();
    g.add(new THREE.Mesh(slab(cabin, DECK, SUN - 0.08), white));
    const band = new THREE.Mesh(slab(cabin, DECK + 0.9, DECK + 1.85), glass);
    band.scale.set(1.004, 1, 1.01);
    g.add(band);
    // The sundeck over it, out over the aft deck as a shade
    const sun = new THREE.Shape();
    sun.moveTo(-7, -2.9);
    sun.lineTo(6.8, -2.75);
    sun.quadraticCurveTo(9.6, -1.8, 10, 0);
    sun.quadraticCurveTo(9.6, 1.8, 6.8, 2.75);
    sun.lineTo(-7, 2.9);
    sun.closePath();
    g.add(new THREE.Mesh(slab(sun, SUN - 0.12, SUN), white));
    g.add(new THREE.Mesh(slab(sun, SUN, SUN + 0.015), teak));
    // Posts holding the overhang up
    for (const z of [-2.7, 2.7]) for (const x of [-6.7, -3.6]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, SUN - DECK, 8), steel);
      post.position.set(x, (SUN + DECK) / 2, z);
      g.add(post);
    }
    // The radar arch and the flybridge console
    const arch = new THREE.Shape();
    arch.moveTo(-0.6, 0);
    arch.lineTo(0.6, 0);
    arch.lineTo(0.3, 2.2);
    arch.lineTo(-0.3, 2.2);
    arch.closePath();
    for (const z of [-2.2, 2.2]) {
      const leg = new THREE.Mesh(new THREE.ExtrudeGeometry(arch, { depth: 0.25, bevelEnabled: false }), white);
      leg.position.set(4.5, SUN, z - 0.125);
      g.add(leg);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 4.7), white);
    top.position.set(4.5, SUN + 2.25, 0);
    g.add(top);
    const radar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 18), white);
    radar.position.set(4.5, SUN + 2.5, 0);
    g.add(radar);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 2.2), white);
    dash.position.set(7.2, SUN + 0.5, 0);
    g.add(dash);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 2.1), glass);
    screen.position.set(7.75, SUN + 1.2, 0);
    screen.rotation.z = -0.5;
    g.add(screen);

    // Rails: the main deck (with gaps at the side gates they jump from) and the sundeck
    const rail = (pts: THREE.Vector3[], gaps: [number, number][] = []): void => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = a.distanceTo(b);
        const n = Math.max(1, Math.round(len / 1.1));
        for (let k = 0; k <= n; k++) {
          const p = a.clone().lerp(b, k / n);
          if (gaps.some(([x0, x1]) => p.x > x0 && p.x < x1 && p.z < 0)) continue;
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 6), steel);
          post.position.set(p.x, p.y + 0.475, p.z);
          g.add(post);
        }
        // The top tube, broken over a gap
        const segs: [THREE.Vector3, THREE.Vector3][] = [[a, b]];
        for (const [x0, x1] of gaps) {
          const cur = segs.pop()!;
          const [p, q] = cur;
          if (p.z >= 0 || Math.max(p.x, q.x) < x0 || Math.min(p.x, q.x) > x1) {
            segs.push(cur);
            continue;
          }
          const lo = p.x < q.x ? p : q;
          const hi = p.x < q.x ? q : p;
          const at = (x: number): THREE.Vector3 => lo.clone().lerp(hi, (x - lo.x) / (hi.x - lo.x));
          if (x0 > lo.x) segs.push([lo, at(x0)]);
          if (x1 < hi.x) segs.push([at(x1), hi]);
        }
        for (const [p, q] of segs) {
          const l = p.distanceTo(q);
          if (l < 0.05) continue;
          const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, l, 6), steel);
          tube.position.copy(p).lerp(q, 0.5).add(V(0, 0.95, 0));
          tube.quaternion.setFromUnitVectors(V(0, 1, 0), q.clone().sub(p).normalize());
          g.add(tube);
        }
      }
    };
    const edge = hullShape(0.15).getPoints(10).map((p) => V(p.x, DECK, p.y));
    // Open across the transom (that's where the steps down to the swim platform are): the aft corners pulled in, the transom dropped
    const side = edge.map((p) => (p.x < -12.6 ? V(-12.6, p.y, p.z) : p));
    while (side.length > 1 && side[side.length - 1].x <= -12.6 && side[side.length - 2].x <= -12.6) side.pop();
    while (side.length > 1 && side[0].x <= -12.6 && side[1].x <= -12.6) side.shift();
    rail(side, [[-9.9, -8.7], [-6.9, -5.7]]);
    const top2 = [V(-6.8, SUN, -2.75), V(6.8, SUN, -2.65), V(9.4, SUN, -1.3), V(9.9, SUN, 0), V(9.4, SUN, 1.3), V(6.8, SUN, 2.65), V(-6.8, SUN, 2.75), V(-6.8, SUN, -2.75)];
    rail(top2);

    // Swim platform off the transom, steps up to the deck, a ladder down into the water
    const plat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 6.0), teak);
    plat.position.set(-13.7, 0.4, 0);
    g.add(plat);
    for (let i = 0; i < 5; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 1.2), teak);
      step.position.set(-13.55 + i * 0.14, 0.4 + (i + 1) * 0.4, -1.8);
      g.add(step);
    }
    for (const z of [-0.95, -0.55]) {
      const rl = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6), steel);
      rl.position.set(-14.35, -0.2, z);
      g.add(rl);
    }

    // Party kit: speakers and a DJ table up top, a banner on the cabin, balloons, strings of lights
    const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
    for (const z of [-1.8, 1.8]) {
      const spk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.5), black);
      spk.position.set(2.6, SUN + 0.55, z);
      g.add(spk);
    }
    const table = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.95, 1.6), black);
    table.position.set(3.0, SUN + 0.475, 0);
    g.add(table);
    const decks = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 1.4), new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x2244ff, emissiveIntensity: 0.4 }));
    decks.position.set(3.0, SUN + 0.97, 0);
    g.add(decks);
    // The banner, on the side Ravi sees
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 160;
    const x = c.getContext('2d')!;
    x.fillStyle = '#1a3d8f';
    x.fillRect(0, 0, 1024, 160);
    x.fillStyle = '#ffd23f';
    x.font = 'bold 74px Arial, sans-serif';
    x.textAlign = 'center';
    x.fillText('RAVI-CALL SYSTEMS', 512, 82);
    x.fillStyle = '#ffffff';
    x.font = 'bold 40px Arial, sans-serif';
    x.fillText('★ STAFF PARTY ★ NO CALLS TODAY ★', 512, 135);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.73), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }));
    banner.position.set(-1.2, DECK + 1.38, -2.56);
    banner.rotation.y = Math.PI;
    g.add(banner);
    // Balloons tied to the rails
    const cols = [0xff4d6d, 0xffd23f, 0x3ec1ff, 0x7bf05a, 0xc06bff, 0xff8c42];
    for (let i = 0; i < 14; i++) {
      const at = i < 7 ? V(-6.6 + Math.random() * 0.4, SUN + 1.5 + Math.random() * 0.8, -2.7 + (i % 7) * 0.9) : V(9.3 - Math.random(), DECK + 1.6 + Math.random() * 0.6, (Math.random() - 0.5) * 2);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.25 }));
      b.scale.y = 1.2;
      b.position.copy(at);
      b.userData.base = at.clone();
      b.userData.ph = Math.random() * 6;
      g.add(b);
      this.floaties.push(b);
    }
    // Strings of coloured bulbs: arch top down to the bow, and aft to the overhang
    const bulbCols = [0xff3b3b, 0xffd23f, 0x3bff7a, 0x3bb4ff, 0xff6bf0];
    const string = (a: THREE.Vector3, b: THREE.Vector3, n: number, sag: number): void => {
      for (let i = 1; i < n; i++) {
        const k = i / n;
        const p = a.clone().lerp(b, k);
        p.y -= Math.sin(Math.PI * k) * sag;
        const col = bulbCols[i % bulbCols.length];
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.5 }));
        m.position.copy(p);
        m.userData.ph = i * 0.7;
        g.add(m);
        this.bulbs.push(m);
      }
    };
    string(V(4.5, SUN + 2.35, -2.3), V(13.5, DECK + 0.9, 0), 22, 0.6);
    string(V(4.5, SUN + 2.35, -2.3), V(-6.8, SUN + 0.9, -2.8), 24, 0.5);
    string(V(4.5, SUN + 2.35, 2.3), V(-6.8, SUN + 0.9, 2.8), 24, 0.5);
    // Floats in the water off the stern: a ring, a lounger
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.2, 12, 24), new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(-16, 0.08, -4);
    g.add(ring);
    const lounger = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 0.75), new THREE.MeshStandardMaterial({ color: 0x3ec1ff, roughness: 0.4 }));
    lounger.position.set(-17, 0.06, 1.2);
    lounger.rotation.y = 0.5;
    g.add(lounger);
    this.floaties.push(ring, lounger);
    ring.userData.base = ring.position.clone();
    ring.userData.ph = 1;
    lounger.userData.base = lounger.position.clone();
    lounger.userData.ph = 2;
    // Anchor chain off the bow
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), steel);
    chain.position.set(13.8, 1.1, 0);
    chain.rotation.z = 0.5;
    g.add(chain);
  }

  /**
   * Up on the sundeck, along the rail on Ravi's side where they stand out against the sky:
   * two chatting over drinks, one dancing, one waving out over the water, one on a lounger.
   */
  private buildLadies(): void {
    const add = (l: Lady, x: number, z: number, yaw: number): void => {
      l.root.position.set(x, SUN, z);
      l.root.rotation.y = yaw;
      this.group.add(l.root);
      this.ladies.push(l);
    };
    add(new Lady({ skin: 0xe6bf9f, hair: 0xe8c66a, bikini: 0xff3b6b, long: true, shades: true }, 'wave'), -1.9, -2.3, Math.PI - 0.15);
    add(new Lady({ skin: 0x8a5a3b, hair: 0x1a1210, bikini: 0xffd23f, long: true, shades: false }, 'chat', true), -4.05, -2.15, (Math.PI * 3) / 4);
    add(new Lady({ skin: 0xd4a27c, hair: 0x5a2e16, bikini: 0x2ad0c8, long: false, shades: true }, 'drink', true), -3.35, -2.2, (-Math.PI * 3) / 4);
    add(new Lady({ skin: 0xbf8a62, hair: 0x2a1a10, bikini: 0xb45cff, long: true, shades: false }, 'dance'), -0.6, -2.15, Math.PI + 0.2);
    // The lounger along the rail, its head toward the bow, and her on it
    const lounger = sunLounger(0xff8c42);
    lounger.position.set(-5.7, SUN, -1.75);
    lounger.rotation.y = -Math.PI / 2;
    this.group.add(lounger);
    const lounging = new Lady({ skin: 0xa8744e, hair: 0x3a2214, bikini: 0x3b8cff, long: true, shades: true }, 'lounge');
    lounger.add(lounging.root);
    this.ladies.push(lounging);
  }

  // ------------------------------------------------------------- the party

  private person(at: THREE.Vector3, yaw: number, i: number, shirt: number, cap: boolean, glasses: boolean): Enemy {
    const e = new Enemy(at, yaw, 700 + i * 7, { name: 'COWORKER', civilian: true });
    e.restyleCrew({ cap, shirt, glasses });
    e.hideWeapon();
    e.setCalm();
    this.group.add(e.root);
    this.people.push(e);
    return e;
  }

  private cup(): THREE.Group {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.034, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0xd61f2c, roughness: 0.5 }));
    c.rotation.z = Math.PI / 2;
    g.add(c);
    return g;
  }

  private buildParty(): void {
    const D = DECK;
    // Talking on the aft deck, drinks in hand
    const group: [number, number, number][] = [[-8.6, 0.2, 0], [-7.6, 0.9, 0], [-7.7, -0.5, 0]];
    const mid = V(-8.0, D, 0.2);
    group.forEach(([x, z], i) => {
      const at = V(x, D, z);
      const yaw = Math.atan2(-(mid.x - x), -(mid.z - z));
      const e = this.person(at, yaw, i, [0xff6f61, 0x06d6a0, 0xf4f1de][i], i === 1, i === 2);
      e.holdProp(this.cup(), 0.02);
      e.root.userData.ph = i * 2.1;
      this.talkers.push(e);
    });
    // Two more on the foredeck, leaning on the rail chatting
    for (let i = 0; i < 2; i++) {
      const e = this.person(V(9.4 + i * 0.9, D, -1.4 + i * 0.4), i ? 2.4 : -0.9, 10 + i, [0xffd166, 0x8338ec][i], false, i === 0);
      e.holdProp(this.cup(), 0.02);
      e.root.userData.ph = 4 + i * 1.7;
      this.talkers.push(e);
    }
    // The couple, at the rail on the near side, wrapped round each other
    const a = this.person(V(-4.35, D, -2.35), -Math.PI / 2, 20, 0xef476f, false, false);
    const b = this.person(V(-3.98, D, -2.35), Math.PI / 2, 21, 0x118ab2, false, true);
    this.couple.push(a, b);
    // The DJ and two dancing up top
    this.dj = this.person(V(3.55, SUN, 0), Math.PI / 2, 30, 0x222222, true, true);
    for (let i = 0; i < 2; i++) this.dancers.push(this.person(V(0.9 - i * 1.4, SUN, i ? 1.0 : -1.2), -Math.PI / 2 + (i ? -0.5 : 0.4), 31 + i, [0x7bf05a, 0xff8c42][i], false, false));
    // Two cannonballers, taking turns off the side gates
    const gates = [V(-9.3, D, -2.9), V(-6.3, D, -2.9)];
    for (let i = 0; i < 2; i++) {
      const home = V(-10.6 + i * 1.6, D, -0.6 - i * 0.6);
      const e = this.person(home.clone(), Math.PI, 40 + i, [0xfff3b0, 0xff4d6d][i], false, false);
      this.jumpers.push({ e, home, gate: gates[i], state: 'wait', t: 0, wait: 1.5 + i * 4.5, from: home.clone(), splashed: false });
    }
  }

  // ------------------------------------------------------------- frame

  update(dt: number, time: number, waveAt: (x: number, z: number, t: number) => number): void {
    const g = this.group;
    // A big boat barely moves on this swell: a slow heave and a little roll
    const h = waveAt(g.position.x, g.position.z, time);
    g.position.y = h * 0.35 + Math.sin(time * 0.4) * 0.04;
    g.rotation.x = Math.sin(time * 0.33) * 0.012;
    g.rotation.z = Math.sin(time * 0.27 + 1) * 0.008;

    this.bulbs.forEach((m, i) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.6 + 1.4 * (0.5 + 0.5 * Math.sin(time * 4 + (m.userData.ph as number) + Math.floor(time * 2) * (i % 3)));
    });
    for (const f of this.floaties) {
      const b = f.userData.base as THREE.Vector3;
      const ph = f.userData.ph as number;
      f.position.y = b.y + Math.sin(time * 1.3 + ph) * 0.06;
      if (b.y > 1) f.position.x = b.x + Math.sin(time * 0.8 + ph) * 0.08;
    }

    this.updateTalkers(time);
    for (const l of this.ladies) l.update(time);
    this.updateCouple(time);
    this.updateTop(time);
    for (const j of this.jumpers) this.updateJumper(j, dt);
    for (const e of this.people) e.update(dt);
    this.updateSplash(dt);
  }

  private updateTalkers(time: number): void {
    this.talkers.forEach((e, i) => {
      const ph = e.root.userData.ph as number;
      const sh = e.shoulderR(new THREE.Vector3());
      // Whose turn it is to talk goes round; the talker waves his free hand about
      const turn = Math.floor((time + ph) / 3.2) % 3 === i % 3;
      e.speaking = turn;
      const sip = Math.max(0, Math.sin(time * 0.5 + ph * 3) - 0.85) / 0.15;
      const cupAt = sh.clone().add(V(-0.05, -0.28 + 0.36 * sip, -0.28 - 0.04 * sip));
      const wave = turn ? Math.sin(time * 5 + ph) : 0;
      const laugh = Math.max(0, Math.sin(time * 0.9 + ph * 2) - 0.8) * 5;
      e.pose = {
        handR: cupAt,
        handL: turn ? V(-0.32 - 0.1 * wave, 1.15 + 0.12 * Math.abs(wave), -0.3) : V(-0.25, 0.95, -0.05),
        curl: 0.7,
        lean: -0.12 * laugh,
        head: new THREE.Euler(-0.2 * laugh + 0.05 * Math.sin(time * 2 + ph), 0.15 * Math.sin(time * 0.7 + ph), 0)
      };
    });
  }

  private updateCouple(time: number): void {
    const [a, b] = this.couple;
    if (!a) return;
    const sway = Math.sin(time * 0.9);
    // Her arms round his neck; his hands on her waist. Heads tipped opposite ways, in close
    a.pose = {
      handR: V(0.13, 1.47, -0.43),
      handL: V(-0.13, 1.49, -0.43),
      curl: 0.4,
      lean: 0.16,
      head: new THREE.Euler(0.15, 0.1 * sway, 0.32 + 0.06 * Math.sin(time * 1.7))
    };
    b.pose = {
      handR: V(0.19, 1.0, -0.33),
      handL: V(-0.19, 1.02, -0.33),
      curl: 0.5,
      lean: 0.18,
      head: new THREE.Euler(0.22, -0.1 * sway, -0.3 + 0.06 * Math.sin(time * 1.7 + 1))
    };
  }

  private updateTop(time: number): void {
    const beat = time * 2.1 * Math.PI;
    if (this.dj) {
      this.dj.pose = {
        handR: V(0.22, 1.05 + 0.02 * Math.sin(beat), -0.42),
        handL: V(-0.2, 1.05 + 0.2 * Math.max(0, Math.sin(time * 1.3)), -0.42 + 0.1 * Math.sin(time * 1.3)),
        curl: 0.4,
        crouch: 0.06 + 0.06 * Math.abs(Math.sin(beat / 2)),
        head: new THREE.Euler(0.25 * Math.abs(Math.sin(beat / 2)), 0, 0)
      };
    }
    this.dancers.forEach((e, i) => {
      const b = beat + i * 1.3;
      const up = Math.sin(time * 0.6 + i) > 0;
      e.pose = {
        handR: up ? V(0.3, 1.95 + 0.1 * Math.sin(b), -0.15) : V(0.3, 1.2 + 0.15 * Math.sin(b), -0.3),
        handL: V(-0.32, 1.85 + 0.12 * Math.sin(b + 1.5), -0.1),
        curl: 0.9,
        crouch: 0.12 * Math.abs(Math.sin(b / 2)),
        twist: 0.35 * Math.sin(b / 2),
        head: new THREE.Euler(0.15 * Math.sin(b), 0.2 * Math.sin(b / 2), 0)
      };
    });
  }

  /** Run at the gate, cannonball off it, swim round to the stern, up the ladder and the steps, back to his spot. */
  private updateJumper(j: Jumper, dt: number): void {
    const e = j.e;
    j.t += dt;
    const face = (to: THREE.Vector3): void => {
      e.yaw = Math.atan2(-(to.x - e.position.x), -(to.z - e.position.z));
      e.root.rotation.y = e.yaw;
    };
    const walk = (to: THREE.Vector3, speed: number): boolean => {
      const d = to.clone().sub(e.position);
      d.y = 0;
      const l = d.length();
      if (l < 0.05) return true;
      face(to);
      e.position.addScaledVector(d.normalize(), Math.min(l, speed * dt));
      return false;
    };
    e.root.rotation.x = 0;
    switch (j.state) {
      case 'wait':
        e.setWalk(0);
        e.setRun(false);
        e.pose = null;
        face(j.gate);
        if (j.t > j.wait) {
          j.state = 'run';
          j.t = 0;
        }
        break;
      case 'run':
        e.setRun(true);
        e.setWalk(1);
        if (walk(j.gate.clone().add(V(0, 0, 0.25)), 4)) {
          j.state = 'air';
          j.t = 0;
          j.from = e.position.clone();
          j.splashed = false;
          e.setRun(false);
          e.setWalk(0);
        }
        break;
      case 'air': {
        // Up and out over the side, tucked into a ball, a slow tumble
        const t = j.t;
        const y = j.from.y + 3.6 * t - 4.9 * t * t;
        e.position.set(j.from.x, Math.max(-1.9, y), j.from.z - 2.6 * Math.min(t, 1.15));
        const tuck = smooth(t / 0.25);
        e.pose = { crouch: tuck, handR: V(0.12, 0.75 + 0.3 * (1 - tuck), -0.32), handL: V(-0.12, 0.75 + 0.3 * (1 - tuck), -0.32), curl: 1, lean: 0.5 * tuck };
        e.root.rotation.x = -0.6 * smooth(t / 1.0);
        if (!j.splashed && y < 0.1) {
          j.splashed = true;
          this.splash(V(e.position.x, 0, e.position.z));
        }
        if (j.splashed && j.t > 1.6) {
          j.state = 'swim';
          j.t = 0;
          e.position.y = -1.45;
          e.pose = null;
        }
        break;
      }
      case 'swim': {
        // Head out of the water, round to the ladder at the stern
        e.position.y = -1.42 + Math.sin(j.t * 3) * 0.04;
        e.setWalk(0.4);
        const ladder = V(-14.5, -1.45, -0.75);
        const via = V(-14.6, -1.45, -3.8);
        const target = e.position.x > -14.2 && e.position.z < -3 ? via : ladder;
        e.pose = { handR: V(0.3, 1.35 + 0.15 * Math.sin(j.t * 4), -0.4), handL: V(-0.3, 1.35 - 0.15 * Math.sin(j.t * 4), -0.4), curl: 0.2 };
        if (walk(target, 1.1) && target === ladder) {
          j.state = 'climb';
          j.t = 0;
          e.setWalk(0);
          face(V(-13.5, 0, -0.75));
        }
        break;
      }
      case 'climb': {
        // Up the ladder onto the platform
        const k = smooth(j.t / 1.6);
        e.position.set(-14.5 + 0.7 * smooth((j.t - 1.2) / 0.5), -1.45 + (0.46 + 1.45) * k, -0.75);
        e.pose = { handR: V(0.2, 1.75 - 0.4 * k, -0.25), handL: V(-0.2, 1.6 - 0.3 * k, -0.25), curl: 1 };
        if (j.t > 1.75) {
          j.state = 'stairs';
          j.t = 0;
          e.pose = null;
        }
        break;
      }
      case 'stairs': {
        // Across the platform and up the steps to the deck
        e.setWalk(0.8);
        const k = smooth(j.t / 2.2);
        const a = V(-13.8, 0.46, -0.75);
        const b = V(-12.4, DECK, -1.8);
        e.position.lerpVectors(a, b, k);
        face(b.clone().add(V(1, 0, 0)));
        if (j.t > 2.2) {
          j.state = 'back';
          j.t = 0;
        }
        break;
      }
      case 'back':
        e.setWalk(0.8);
        if (walk(j.home, 1.3)) {
          j.state = 'wait';
          j.t = 0;
          j.wait = 3 + Math.random() * 4;
        }
        break;
    }
  }

  // ------------------------------------------------------------- splashes

  private makeDropTex(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(16, 16, 1, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }

  /** A body hitting the water: a column of spray up, droplets out, a ring of foam spreading. */
  private splash(at: THREE.Vector3): void {
    for (let i = 0; i < 70; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dropTex, color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }));
      s.position.copy(at).add(V((Math.random() - 0.5) * 0.6, 0.1, (Math.random() - 0.5) * 0.6));
      const a = Math.random() * Math.PI * 2;
      const out = i < 30 ? 0.5 + Math.random() * 0.9 : 1.6 + Math.random() * 2.6;
      const v = V(Math.cos(a) * out, i < 30 ? 6.5 + Math.random() * 4 : 2.5 + Math.random() * 3.5, Math.sin(a) * out);
      s.scale.setScalar(0.4 + Math.random() * 0.6);
      this.group.add(s);
      this.drops.push({ s, v, life: 0 });
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.95, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(at).setY(0.06);
    this.group.add(ring);
    this.rings.push({ m: ring, life: 0 });
  }

  private updateSplash(dt: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life += dt;
      d.v.y -= 9.8 * dt;
      d.s.position.addScaledVector(d.v, dt);
      (d.s.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.95 * (1 - d.life / 2.0));
      if (d.s.position.y < 0 || d.life > 2.0) {
        d.s.removeFromParent();
        d.s.material.dispose();
        this.drops.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      r.m.scale.setScalar(1 + r.life * 2.2);
      (r.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - r.life / 2.5));
      if (r.life > 2.5) {
        r.m.removeFromParent();
        this.rings.splice(i, 1);
      }
    }
  }
}
