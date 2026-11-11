import * as THREE from 'three';

/**
 * Women in bikinis at the menu yacht's party: simple stylised figures built
 * from rounded shapes (the game has no female model), with jointed arms and
 * legs so they can chat, dance, wave and lounge. Origin at the feet, facing +Z,
 * about 1.68 m tall.
 */

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export interface LadyLook {
  skin: number;
  hair: number;
  bikini: number;
  /** Long hair down the back, or tied up in a bun. */
  long: boolean;
  shades: boolean;
}

export type LadyMood = 'chat' | 'dance' | 'wave' | 'lounge' | 'drink' | 'kiss';

/** A limb hung from a pivot: the upper part, a joint, the lower part. */
interface Limb {
  root: THREE.Group;
  joint: THREE.Group;
  end: THREE.Group;
}

export class Lady {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private arms: Limb[] = [];
  private legs: Limb[] = [];
  private ph = Math.random() * 10;

  constructor(look: LadyLook, readonly mood: LadyMood, cup = false) {
    const skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.55 });
    const cloth = new THREE.MeshStandardMaterial({ color: look.bikini, roughness: 0.45 });
    const hair = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.6 });
    this.root.add(this.body);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Vector3, parent: THREE.Object3D = this.body): THREE.Mesh => {
      const o = new THREE.Mesh(g, m);
      o.position.copy(p);
      parent.add(o);
      return o;
    };
    // Hips, the bikini bottom over them
    mesh(new THREE.SphereGeometry(0.15, 16, 12), skin, V(0, 0.92, 0)).scale.set(1.08, 0.78, 0.8);
    mesh(new THREE.SphereGeometry(0.155, 16, 10, 0, Math.PI * 2, Math.PI * 0.48, Math.PI * 0.3), cloth, V(0, 0.95, 0)).scale.set(1.08, 0.82, 0.82);
    // Torso: a turned profile, narrow at the waist, out at the chest and shoulders
    const prof = [V(0.0, 0, 0), V(0.13, 0, 0), V(0.105, 0.14, 0), V(0.12, 0.3, 0), V(0.135, 0.4, 0), V(0.125, 0.46, 0), V(0.06, 0.5, 0), V(0, 0.5, 0)].map((p) => new THREE.Vector2(p.x, p.y));
    const torso = mesh(new THREE.LatheGeometry(prof, 18), skin, V(0, 0.96, 0));
    torso.scale.set(1, 1, 0.72);
    // The bikini top: two cups and a band round the back, straps over the shoulders
    for (const s of [-1, 1]) {
      const cupM = mesh(new THREE.SphereGeometry(0.06, 12, 10), cloth, V(s * 0.055, 1.29, 0.065));
      cupM.scale.set(1, 0.95, 0.75);
      const strap = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 5), cloth, V(s * 0.07, 1.38, 0.0));
      strap.rotation.x = 0.45;
    }
    mesh(new THREE.TorusGeometry(0.118, 0.012, 6, 22), cloth, V(0, 1.27, 0)).rotation.x = Math.PI / 2;
    // Neck and head, the face toward +Z
    mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.1, 10), skin, V(0, 1.48, 0));
    this.head.position.set(0, 1.56, 0);
    this.body.add(this.head);
    mesh(new THREE.SphereGeometry(0.095, 16, 12), skin, V(0, 0.02, 0.0), this.head).scale.set(0.92, 1.08, 1);
    // Hair: over the top and back of the head, and either down the back or up in a bun
    mesh(new THREE.SphereGeometry(0.102, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, V(0, 0.035, -0.012), this.head).scale.set(1, 1.05, 1.05);
    if (look.long) {
      const fall = mesh(new THREE.CapsuleGeometry(0.075, 0.26, 4, 10), hair, V(0, -0.13, -0.07), this.head);
      fall.scale.set(1.25, 1, 0.5);
      fall.rotation.x = 0.12;
    } else mesh(new THREE.SphereGeometry(0.05, 10, 8), hair, V(0, 0.1, -0.08), this.head);
    if (look.shades) {
      const black = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.15, metalness: 0.4 });
      for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.025, 10, 6), black, V(s * 0.036, 0.03, 0.085), this.head).scale.set(1.2, 0.75, 0.4);
    }
    // Arms from the shoulders, legs from the hips
    for (const s of [-1, 1]) {
      const a = this.limb(skin, V(s * 0.165, 1.4, 0), 0.042, 0.035, 0.27, 0.25, 0.034);
      a.root.rotation.z = s * 0.12;
      this.body.add(a.root);
      this.arms.push(a);
      const l = this.limb(skin, V(s * 0.085, 0.88, 0), 0.07, 0.048, 0.43, 0.42, 0.0);
      this.body.add(l.root);
      this.legs.push(l);
      // A foot on the end of the shin
      mesh(new THREE.BoxGeometry(0.07, 0.04, 0.17), skin, V(0, -0.02, 0.05), l.end);
    }
    if (cup) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.11, 10), new THREE.MeshStandardMaterial({ color: 0xd61f2c, roughness: 0.5 }));
      c.position.set(0, -0.02, 0.03);
      this.arms[1].end.add(c);
    }
  }

  /** Upper part hung down from `at`, a joint at its end, the lower part, a ball of a hand/ankle at the end. */
  private limb(m: THREE.Material, at: THREE.Vector3, r0: number, r1: number, l0: number, l1: number, hand: number): Limb {
    const root = new THREE.Group();
    root.position.copy(at);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry((r0 + r1) / 2, l0 - r0, 4, 10), m);
    upper.position.y = -l0 / 2;
    upper.scale.set(r0 / ((r0 + r1) / 2), 1, r0 / ((r0 + r1) / 2));
    root.add(upper);
    const joint = new THREE.Group();
    joint.position.y = -l0;
    root.add(joint);
    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(r1, l1 - r1, 4, 10), m);
    lower.position.y = -l1 / 2;
    joint.add(lower);
    const end = new THREE.Group();
    end.position.y = -l1;
    joint.add(end);
    if (hand > 0) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(hand, 8, 6), m);
      h.scale.set(0.8, 1.3, 0.6);
      h.position.y = -0.03;
      end.add(h);
    }
    return { root, joint, end };
  }

  /** Set an arm: `fwd` raises it forward, `out` out to the side, `bend` the elbow, `twist` turns it so the elbow folds inward. */
  private arm(i: number, fwd: number, out: number, bend: number, twist = 0): void {
    const a = this.arms[i];
    const s = i === 0 ? -1 : 1;
    a.root.rotation.set(-fwd, s * twist, s * out, 'XZY');
    a.joint.rotation.set(-bend, 0, 0);
  }

  private leg(i: number, fwd: number, bend: number, out = 0): void {
    const l = this.legs[i];
    l.root.rotation.set(-fwd, 0, (i === 0 ? -1 : 1) * out);
    l.joint.rotation.set(bend, 0, 0);
  }

  update(time: number): void {
    const t = time + this.ph;
    const b = this.body;
    b.position.set(0, 0, 0);
    b.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    if (this.mood === 'lounge') {
      // On her back on the lounger, propped up a little, one knee up, an arm behind her head
      b.rotation.x = -Math.PI / 2 + 0.38;
      b.position.set(0, 0.16, 0.9);
      this.leg(0, 0.05, 0);
      this.leg(1, 0.75, 1.3);
      this.arm(0, 2.6, 0.5, 1.9);
      this.arm(1, 0.25, 0.2, 0.3 + 0.1 * Math.sin(t * 0.4));
      this.head.rotation.set(0.35, 0.15 * Math.sin(t * 0.3), 0);
      return;
    }
    if (this.mood === 'dance') {
      const beat = t * 2.1 * Math.PI;
      const sway = Math.sin(beat / 2);
      b.position.y = -0.03 * Math.abs(Math.sin(beat / 2));
      b.rotation.set(0, 0.35 * sway, 0.08 * sway);
      this.leg(0, 0.1 * sway, 0.15 + 0.15 * Math.max(0, sway));
      this.leg(1, -0.1 * sway, 0.15 + 0.15 * Math.max(0, -sway));
      this.arm(0, 2.6 + 0.3 * Math.sin(beat), 0.35, 0.5 + 0.3 * Math.sin(beat + 1));
      this.arm(1, 2.4 + 0.3 * Math.sin(beat + 1.5), 0.4, 0.6);
      this.head.rotation.set(0.1 * Math.sin(beat), 0.2 * sway, 0.1 * sway);
      return;
    }
    // Standing: weight on one hip, a slow sway
    const sway = Math.sin(t * 0.8);
    b.rotation.set(0, 0.06 * sway, 0.04 + 0.02 * sway);
    this.leg(0, 0.02, 0.05);
    this.leg(1, -0.12, 0.25, 0.05);
    if (this.mood === 'kiss') {
      // Up on her toes, leaning in to him, arms up round his neck, her head tipped up and to the side
      const k = Math.sin(t * 1.7);
      b.position.y = 0.06;
      b.rotation.set(0.1, 0.04 * sway, 0);
      this.leg(0, 0.0, 0.05);
      this.leg(1, -0.25, 0.7);
      this.arm(0, 1.95, 0.45, 1.4, 1.3);
      this.arm(1, 1.95, 0.45, 1.4, 1.3);
      this.head.rotation.set(-0.32 + 0.04 * k, 0.05 * sway, 0.28 + 0.05 * k);
      return;
    }
    if (this.mood === 'wave') {
      // Waving out over the water
      this.arm(1, 2.75, 0.55, 0.35 + 0.35 * Math.sin(t * 7));
      this.arm(0, 0.15, 0.25, 0.4);
      this.head.rotation.set(-0.05, 0, 0.1 * Math.sin(t * 1.3));
      return;
    }
    // Chatting (or drinking): a drink in the left hand at her chest, the other hand talking, a laugh now and then
    const sip = this.mood === 'drink' ? Math.max(0, Math.sin(t * 0.6) - 0.6) / 0.4 : 0;
    this.arm(1, 0.9 + 0.9 * sip, 0.15, 1.6 + 0.6 * sip);
    const talk = Math.sin(t * 4) * Math.max(0, Math.sin(t * 0.7));
    this.arm(0, 0.5 + 0.35 * talk, 0.3, 1.1 + 0.3 * talk);
    const laugh = Math.max(0, Math.sin(t * 0.45) - 0.85) * 6;
    this.head.rotation.set(-0.25 * laugh + 0.05 * Math.sin(t * 2), 0.25 * Math.sin(t * 0.5), 0.08 * sway);
  }
}

/** A sun lounger: a white frame and a cushion, the back raised; its head end toward −Z. */
export function sunLounger(cushion = 0x3ec1ff): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.4 });
  const pad = new THREE.MeshStandardMaterial({ color: cushion, roughness: 0.7 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.1, 1.3), pad);
  seat.position.set(0, 0.32, 0.45);
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.1, 0.75), pad);
  back.position.set(0, 0.52, -0.42);
  back.rotation.x = 0.55;
  g.add(back);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 2.0), white);
  frame.position.set(0, 0.25, 0.1);
  g.add(frame);
  for (const [x, z] of [[-0.3, -0.85], [0.3, -0.85], [-0.3, 1.05], [0.3, 1.05]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.25, 0.05), white);
    leg.position.set(x, 0.125, z);
    g.add(leg);
  }
  return g;
}
