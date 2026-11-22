import * as THREE from 'three';
import { Hound, wetFlesh, paint, profiledTube, toothMat } from './AlienCreatures';

/**
 * A cave crawler: what lives in the cave instead of the hounds. A spider's
 * body — eight long jointed legs arched high over it, a plated thorax, a
 * swollen pale mottled abdomen behind — and, under its head, a pair of thin
 * human-length arms, all bone and tendon, ending in three long hooked claws
 * that it reaches out with and takes hold of you. Its head is a long wedge
 * angled down, a cluster of wet black eyes, and an ant's mouth: two curved
 * serrated mandibles either side that scissor open and shut, small palps
 * twitching between them, the wet red mouth behind.
 *
 * It's a Hound to the scene (the same grabbing, throwing, slamming, shooting,
 * ragdolls and blood); the scene runs its own AI for it — across the roof,
 * dropping on him, the arms out, the grab, the eating.
 *
 * Local frame as the hound's: +Z forward, the feet at y 0, the body at 0.72.
 */

let chitin: THREE.MeshPhysicalMaterial | null = null;
let pale: THREE.MeshPhysicalMaterial | null = null;
let eyeMat: THREE.MeshPhysicalMaterial | null = null;
let mouthMat: THREE.MeshStandardMaterial | null = null;

export type CrawlerMode = 'ceiling' | 'drop' | 'floor' | 'reach' | 'grab' | 'recoil';

export class Crawler extends Hound {
  /** Across the roof, falling from it, on the floor, arms out for him, holding him, knocked off him. */
  mode: CrawlerMode = 'floor';
  modeT = 0;
  /** Falling: its vertical speed; its roll (π upside down on the roof, 0 the right way up). */
  vy = 0;
  roll = 0;
  /** The roof over it (cached, with where it was found). */
  roofY = 0;
  readonly roofAt = new THREE.Vector3(1e9, 0, 0);
  /** Its arms: 0 folded, 1 out reaching, 2 closed round something. */
  armTarget = 0;
  private armK = 0;
  /** Reared up on its back legs (reaching for him, holding him): its face up level with his. */
  private rearK = 0;
  /** Chewing (its mandibles going). */
  chewing = false;
  private gait = Math.random() * 6;
  private twitchT = 0;
  private twitch = new THREE.Euler();
  private twitchTo = new THREE.Euler();
  private head = new THREE.Group();
  private mandibles: THREE.Group[] = [];
  private palps: THREE.Group[] = [];
  private abdomen = new THREE.Group();
  readonly arms: { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group; claws: THREE.Group[]; side: number }[] = [];
  private legRest: { hy: number; hz: number; kz: number }[] = [];
  private mouthPt = new THREE.Object3D();

  constructor() {
    super(true);
    if (!chitin) {
      chitin = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.02, clearcoat: 0.6, clearcoatRoughness: 0.35 });
      pale = wetFlesh(2, { clearcoat: 1, rough: 0.3 });
      eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x050306, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0, emissive: 0x3a0606, emissiveIntensity: 0.5 });
      mouthMat = new THREE.MeshStandardMaterial({ color: 0x3a0608, emissive: 0x2a0204, roughness: 0.25 });
    }
    this.legHalf = 0.26;
    this.hp = 4;
    const g = this.group;
    g.add(this.body);
    this.body.position.y = 0.72;
    const plate = (n: THREE.Vector3, c: THREE.Color, q: THREE.Vector3, base: number): void => {
      // Dark plated chitin, a sheen down the ridges, paler underneath
      c.setHex(base).lerp(new THREE.Color(0x120806), Math.max(0, n.y) * 0.5).lerp(new THREE.Color(0x5a4038), Math.max(0, -n.y) * 0.6);
      c.multiplyScalar(0.85 + 0.15 * Math.sin(q.z * 60));
    };

    // ---- Thorax: plated, ridged, a little hunched
    const thorax = profiledTube(
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.02, -0.18), new THREE.Vector3(0, 0.03, 0.08), new THREE.Vector3(0, 0.02, 0.36)]),
      30,
      18,
      (u, a) => (0.15 + 0.03 * Math.sin(u * Math.PI)) * (1 - 0.15 * Math.abs(Math.cos(a))) * (1 + 0.05 * Math.max(0, Math.sin(u * 28)))
    );
    paint(thorax, (q, n, c) => plate(n, c, q, 0x2e2622));
    this.body.add(new THREE.Mesh(thorax, chitin));
    // A row of spines down its back
    for (let k = 0; k < 6; k++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.09 + (k % 2) * 0.04, 6), toothMat);
      sp.position.set(0, 0.17, -0.12 + k * 0.08);
      sp.rotation.x = -0.4;
      this.body.add(sp);
    }

    // ---- Abdomen: swollen, pale, mottled and striped, slick; it breathes
    this.abdomen.position.set(0, 0.05, -0.2);
    this.body.add(this.abdomen);
    const abd = new THREE.SphereGeometry(0.3, 32, 24);
    const ap = abd.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < ap.count; i++) {
      const x = ap.getX(i);
      const y = ap.getY(i);
      const z = ap.getZ(i);
      const k = 1 + 0.06 * Math.sin(z * 30) * Math.max(0, y / 0.3) + 0.04 * Math.sin(x * 25 + y * 20);
      ap.setXYZ(i, x * 0.85 * k, y * 0.8 * k + 0.08, (z - 0.32) * 1.35);
    }
    abd.computeVertexNormals();
    paint(abd, (q, n, c) => {
      // Sick grey-white, dark bands across its back, blotches
      c.setHex(0xb8aea0);
      const band = Math.max(0, Math.sin(q.z * 22)) * Math.max(0, n.y);
      c.lerp(new THREE.Color(0x2a1a1e), band * 0.8);
      c.lerp(new THREE.Color(0x5a3a40), Math.max(0, Math.sin(q.x * 40) * Math.sin(q.z * 33)) * 0.5);
      c.lerp(new THREE.Color(0x8a7a6a), Math.max(0, -n.y) * 0.5);
    });
    this.abdomen.add(new THREE.Mesh(abd, pale!));
    // Bristles on it
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const h = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.08, 4), chitin);
      h.position.set(Math.cos(a) * 0.2, 0.2 + Math.sin(a * 3) * 0.04, -0.3 + Math.sin(a) * 0.2);
      h.rotation.set(-0.8 + Math.sin(a) * 0.4, 0, Math.cos(a) * 0.6);
      this.abdomen.add(h);
    }

    // ---- The head: on the neck at the thorax's front, a long wedge angled down
    this.neck.position.set(0, 0.06, 0.36);
    this.body.add(this.neck);
    this.neck.add(this.head);
    this.head.rotation.x = 0.55;
    const skull = profiledTube(
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.0, -0.02), new THREE.Vector3(0, 0.02, 0.12), new THREE.Vector3(0, -0.01, 0.28)]),
      24,
      16,
      (u, a) => (0.11 - 0.05 * u) * (1 + 0.25 * Math.abs(Math.cos(a))) * (1 - 0.3 * Math.max(0, -Math.sin(a)))
    );
    skull.scale(1, 0.75, 1);
    paint(skull, (q, n, c) => plate(n, c, q, 0x3a302a));
    this.head.add(new THREE.Mesh(skull, chitin));
    // A crest of plates back off it
    for (const s of [-1, 1]) {
      const crest = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 5), chitin);
      crest.position.set(s * 0.06, 0.07, 0.0);
      crest.rotation.set(-1.9, 0, s * 0.4);
      this.head.add(crest);
    }
    // Eyes: two big wet black ones, four small round them
    const eyes: [number, number, number, number][] = [
      [0.05, 0.05, 0.16, 0.026],
      [-0.05, 0.05, 0.16, 0.026],
      [0.085, 0.035, 0.11, 0.014],
      [-0.085, 0.035, 0.11, 0.014],
      [0.03, 0.07, 0.2, 0.012],
      [-0.03, 0.07, 0.2, 0.012]
    ];
    for (const [x, y, z, r] of eyes) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), eyeMat!);
      e.position.set(x, y, z);
      e.scale.set(1, 0.8, 1);
      this.head.add(e);
    }
    // The mouth: wet red behind, the palps, the mandibles either side
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), mouthMat!);
    mouth.position.set(0, -0.035, 0.27);
    mouth.scale.set(1.2, 0.8, 0.7);
    this.head.add(mouth);
    this.mouthPt.position.set(0, -0.03, 0.33);
    this.head.add(this.mouthPt);
    for (const s of [-1, 1]) {
      const m = new THREE.Group();
      m.position.set(s * 0.06, -0.035, 0.25);
      this.head.add(m);
      // A curved hook of a jaw, serrated along its inner edge
      const crv = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.04, -0.005, 0.07), new THREE.Vector3(s * 0.01, -0.012, 0.15), new THREE.Vector3(-s * 0.04, -0.015, 0.19)]);
      const jaw = profiledTube(crv, 20, 8, (u) => 0.022 * (1 - u * 0.85) + 0.003);
      paint(jaw, (q, n, c) => plate(n, c, q, 0x4a3022));
      m.add(new THREE.Mesh(jaw, chitin));
      for (let k = 0; k < 5; k++) {
        const p = crv.getPointAt(0.25 + k * 0.15);
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.026, 5), toothMat);
        tooth.position.copy(p).add(new THREE.Vector3(-s * 0.012, 0, 0));
        tooth.rotation.z = s * Math.PI / 2;
        m.add(tooth);
      }
      this.mandibles.push(m);
      // A palp: two jointed little feelers between the jaws
      const pg = new THREE.Group();
      pg.position.set(s * 0.025, -0.05, 0.26);
      this.head.add(pg);
      const seg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.06, 6), chitin);
      seg1.position.set(0, -0.025, 0.015);
      seg1.rotation.x = 0.6;
      pg.add(seg1);
      const seg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.007, 0.05, 6), pale!);
      seg2.position.set(0, -0.058, 0.04);
      seg2.rotation.x = 1.1;
      pg.add(seg2);
      this.palps.push(pg);
    }

    // ---- Eight legs: up and out of the thorax's sides in a high arch, down to a hooked tip
    const FEMUR = 0.6;
    const TIBIA = 1.4;
    const zs = [0.26, 0.12, -0.02, -0.16];
    for (const s of [-1, 1]) {
      zs.forEach((z, i) => {
        const hip = new THREE.Group();
        hip.position.set(s * 0.13, 0.0, z);
        this.body.add(hip);
        const spread = (1.5 - i) * 0.42 * s;
        const rest = { hy: spread, hz: s * 2.45, kz: -s * 1.93 };
        hip.rotation.set(0, rest.hy, rest.hz);
        this.legRest.push(rest);
        const femur = profiledTube(
          new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -FEMUR * 0.5, 0.01), new THREE.Vector3(0, -FEMUR, 0)]),
          16,
          8,
          (u) => 0.03 * (1 - u * 0.35) + 0.008 * Math.sin(u * Math.PI)
        );
        paint(femur, (q, n, c) => plate(n, c, q, 0x2a221e));
        hip.add(new THREE.Mesh(femur, chitin!));
        const knee = new THREE.Group();
        knee.position.y = -FEMUR;
        knee.rotation.z = rest.kz;
        hip.add(knee);
        const kb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), chitin!);
        knee.add(kb);
        const tibia = profiledTube(
          new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -TIBIA * 0.5, 0.015), new THREE.Vector3(0, -TIBIA, 0)]),
          22,
          7,
          (u) => 0.022 * (1 - u * 0.75) + 0.003
        );
        paint(tibia, (q, n, c) => plate(n, c, q, 0x241c18));
        knee.add(new THREE.Mesh(tibia, chitin!));
        // Hairs along it, a hooked tip
        for (let k = 0; k < 4; k++) {
          const hr = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.05, 4), chitin!);
          hr.position.set(0, -TIBIA * (0.2 + k * 0.17), 0.012);
          hr.rotation.x = 0.9;
          knee.add(hr);
        }
        const paw = new THREE.Group();
        paw.position.y = -TIBIA;
        knee.add(paw);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.07, 6), toothMat);
        tip.position.y = -0.03;
        tip.rotation.x = Math.PI;
        paw.add(tip);
        this.legs.push({ hip, knee, paw, front: i < 2, side: s });
      });
    }

    // ---- Two arms under its head: thin as bones, long, three hooked claws on each
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.09, -0.08, 0.3);
      this.body.add(shoulder);
      const UP = 0.4;
      const LOW = 0.44;
      const upper = profiledTube(
        new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, UP * 0.5), new THREE.Vector3(0, 0, UP)]),
        14,
        7,
        (u) => 0.02 + 0.008 * Math.sin(u * Math.PI) + (u < 0.1 ? 0.01 : 0)
      );
      paint(upper, (q, n, c) => void c.setHex(0x9a8a80).lerp(new THREE.Color(0x3a2a2a), Math.max(0, n.y) * 0.5));
      shoulder.add(new THREE.Mesh(upper, pale!));
      const elbow = new THREE.Group();
      elbow.position.z = UP;
      shoulder.add(elbow);
      elbow.add(new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), pale!));
      const lower = profiledTube(
        new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, LOW * 0.5), new THREE.Vector3(0, 0, LOW)]),
        14,
        7,
        (u) => 0.016 + 0.004 * Math.sin(u * Math.PI * 2)
      );
      paint(lower, (q, n, c) => void c.setHex(0x8a7a72).lerp(new THREE.Color(0x2a1a1a), Math.max(0, n.y) * 0.5));
      elbow.add(new THREE.Mesh(lower, pale!));
      const hand = new THREE.Group();
      hand.position.z = LOW;
      elbow.add(hand);
      hand.add(new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), pale!));
      const claws: THREE.Group[] = [];
      for (let k = 0; k < 3; k++) {
        const cg = new THREE.Group();
        const a = (k - 1) * 0.5;
        cg.rotation.set(0, a * s * 0.6, a);
        hand.add(cg);
        const crv = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.02, 0.09), new THREE.Vector3(0, -0.01, 0.17), new THREE.Vector3(0, -0.05, 0.21)]);
        const claw = profiledTube(crv, 14, 6, (u) => 0.009 * (1 - u * 0.9) + 0.0015);
        paint(claw, (q, n, c) => void c.setHex(0x1a1410).lerp(new THREE.Color(0xd8ccb0), Math.min(1, q.z * 5)));
        cg.add(new THREE.Mesh(claw, chitin));
        claws.push(cg);
      }
      this.arms.push({ shoulder, elbow, hand, claws, side: s });
    }

    // ---- Hit boxes: its body, and its head
    const hm = new THREE.MeshBasicMaterial({ visible: false });
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 1.25), hm);
    hb.position.set(0, 0.74, -0.15);
    const hh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.42), hm);
    hh.position.set(0, 0.72, 0.62);
    hb.userData.hound = this;
    hh.userData.hound = this;
    hh.userData.head = true;
    g.add(hb, hh);
    this.hitboxes.push(hb, hh);
  }

  mouthWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.mouthPt.getWorldPosition(out);
  }

  ragdollRest(): void {
    // Its legs half-folded as it goes limp, its arms dropping
    this.legs.forEach((l, i) => {
      l.knee.rotation.z = this.legRest[i].kz * 0.6;
    });
    for (const a of this.arms) {
      a.shoulder.rotation.set(0.9, 0, 0);
      a.elbow.rotation.set(0.8, 0, 0);
    }
  }

  animate(dt: number, t: number): void {
    if (this.ragdoll) return;
    const run = Math.min(1, this.speed / 5);
    this.gait += dt * (3 + this.speed * 2.6);
    const ph = this.gait;
    // ---- Legs: two sets of four alternating, each lifted and swung forward in its turn
    this.legs.forEach((l, i) => {
      const r = this.legRest[i];
      const set = (Math.floor(i % 4) + (l.side > 0 ? 1 : 0)) % 2;
      const c = Math.sin(ph + set * Math.PI);
      const lift = Math.max(0, c) * (0.12 + 0.3 * run);
      const swing = Math.cos(ph + set * Math.PI) * (0.06 + 0.28 * run);
      if (this.held) {
        // Flailing on the end of the grabber
        l.hip.rotation.set(Math.sin(t * 17 + i) * 0.5, r.hy + Math.sin(t * 13 + i * 2) * 0.5, r.hz + Math.sin(t * 21 + i) * 0.4 * l.side);
        l.knee.rotation.z = r.kz + Math.sin(t * 19 + i) * 0.6;
        return;
      }
      l.hip.rotation.set(0, r.hy + swing * l.side, r.hz - lift * l.side);
      l.knee.rotation.z = r.kz + lift * 0.6 * l.side;
    });
    // ---- The body: a low skitter's bob; the abdomen swelling and easing, slow
    this.rearK += ((this.mode === 'grab' ? 1 : this.mode === 'reach' ? 0.7 : 0) - this.rearK) * Math.min(1, dt * 6);
    const rear = this.rearK;
    this.body.position.y = 0.72 + Math.abs(Math.sin(ph)) * 0.03 * run + rear * 0.42;
    this.body.position.z = -rear * 0.15;
    this.body.rotation.x = -rear * 0.78;
    this.body.rotation.z = Math.sin(ph) * 0.03 * run;
    const br = 1 + Math.sin(t * 2.2) * 0.04;
    this.abdomen.scale.set(br, br, 1 + Math.sin(t * 2.2) * 0.02);
    this.abdomen.rotation.x = Math.sin(t * 1.3) * 0.05 - 0.05;
    // ---- The head: still, then jerked to a new angle — never smoothly
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      this.twitchT = 0.15 + Math.random() * (this.mode === 'grab' ? 0.3 : 0.9);
      this.twitchTo.set((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.6);
    }
    const k = Math.min(1, dt * 22);
    this.twitch.set(this.twitch.x + (this.twitchTo.x - this.twitch.x) * k, this.twitch.y + (this.twitchTo.y - this.twitch.y) * k, this.twitch.z + (this.twitchTo.z - this.twitch.z) * k);
    this.neck.rotation.copy(this.twitch);
    // Reared, its head tipped down again to look at what's in front of it
    this.neck.rotation.x += this.rearK * 0.55;
    // ---- Mandibles: twitching, wide when it reaches, scissoring when it eats
    const open = this.chewing ? 0.25 + Math.abs(Math.sin(t * 11)) * 0.7 : this.armTarget > 0 ? 0.65 + Math.sin(t * 18) * 0.08 : 0.15 + Math.max(0, Math.sin(t * 3.3)) * 0.25;
    this.mandibles.forEach((m, i) => {
      const s = i === 0 ? -1 : 1;
      m.rotation.y = s * open;
    });
    this.palps.forEach((p, i) => {
      p.rotation.set(Math.sin(t * 14 + i * 2) * 0.4, Math.sin(t * 9 + i) * 0.3, 0);
    });
    // ---- Arms: folded up under its head like a mantis's; out for him; closed round him
    this.armK += (this.armTarget - this.armK) * Math.min(1, dt * (this.armTarget > this.armK ? 9 : 5));
    const reach = Math.min(1, this.armK);
    const close = Math.max(0, this.armK - 1);
    for (const a of this.arms) {
      const s = a.side;
      // folded: upper arm forward and up, forearm folded back down along it
      const sx = THREE.MathUtils.lerp(-0.7, -0.15, reach) + Math.sin(t * 2 + s) * 0.04;
      const sy = THREE.MathUtils.lerp(0.25 * s, 0.22 * s, reach) - close * 0.35 * s;
      a.shoulder.rotation.set(sx, sy, 0);
      a.elbow.rotation.set(THREE.MathUtils.lerp(2.5, 0.3, reach) + close * 0.5, -close * 0.5 * s, 0);
      a.hand.rotation.set(THREE.MathUtils.lerp(0.4, -0.2, reach), 0, 0);
      a.claws.forEach((c, i) => {
        const spread = (i - 1) * THREE.MathUtils.lerp(0.25, 0.6, reach) * (1 - close * 0.8);
        c.rotation.set(close * 0.9 + Math.sin(t * 16 + i) * 0.05 * reach, spread * s * 0.6, spread);
      });
    }
  }
}
