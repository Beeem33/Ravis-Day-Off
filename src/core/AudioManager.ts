/**
 * AudioManager — fully procedural Web Audio SFX + music. No audio assets;
 * everything (gunshots, glass, footsteps, the guard's muffled lo-fi mix,
 * the General and his flying cars, the boss music) is synthesized at runtime.
 */

// ------------------------------------------------- Level 8: shared curves

/**
 * A finite number or the fallback. The car park's sounds are called with
 * distances and durations worked out each frame, and an AudioParam handed a
 * NaN throws — one bad vector would take the whole frame down with it.
 */
function fin(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

let softClipCache: Float32Array<ArrayBuffer> | null = null;

/**
 * The lot bus's safety net. Car crashes, stomps and the roar stack on top of
 * each other in a way nothing indoors ever did — two wrecks landing inside a
 * second of a stomp — and summed raw they'd hard-clip the output into a
 * crackle. This is a straight line up to 0.75, then a tanh shoulder that
 * rolls into a ceiling of 1.0 without a kink, so a single sound goes through
 * untouched and only the pile-ups get squashed (which, on a pile-up, just
 * sounds like more weight). The bus feeds it at half gain, so the curve's
 * [-1, 1] input stands for ±2 of signal.
 */
function softClipCurve(): Float32Array<ArrayBuffer> {
  if (softClipCache) return softClipCache;
  const n = 4096;
  const c = new Float32Array(n);
  const K = 0.75;
  for (let i = 0; i < n; i++) {
    const s = ((i / (n - 1)) * 2 - 1) * 2;
    const m = Math.abs(s);
    const y = m <= K ? m : K + (1 - K) * Math.tanh((m - K) / (1 - K));
    c[i] = s < 0 ? -y : y;
  }
  softClipCache = c;
  return c;
}

const driveCache = new Map<number, Float32Array<ArrayBuffer>>();

/**
 * tanh saturation, normalised so full scale in is full scale out. Grit: a
 * throat pushed past what it can do, an engine note with the edges blown off
 * it, a crumple of steel that crackles rather than hisses. Note that it is
 * also gain — the slope at zero is k / tanh(k) — so whatever follows it is
 * turned down to suit.
 */
function driveCurve(k: number): Float32Array<ArrayBuffer> {
  const hit = driveCache.get(k);
  if (hit) return hit;
  const n = 2048;
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / norm;
  driveCache.set(k, c);
  return c;
}

/**
 * `n` random values in [lo, hi] for setValueCurveAtTime: a pitch that won't
 * sit still, a grind that bites and skips. `smooth` (0..1) carries each value
 * part-way into the next, so 0 is jumpy and 0.6 wanders.
 */
function wander(n: number, lo: number, hi: number, smooth = 0): Float32Array<ArrayBuffer> {
  const c = new Float32Array(Math.max(2, Math.floor(n)));
  let v = lo + Math.random() * (hi - lo);
  for (let i = 0; i < c.length; i++) {
    v = v * smooth + (lo + Math.random() * (hi - lo)) * (1 - smooth);
    c[i] = v;
  }
  return c;
}

/** MIDI note number to Hz. The boss score below is written in note numbers. */
const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Plate modes for a car panel, as [ratio to the lowest, level]. Flat steel
 * doesn't ring in harmonics the way a string does; its modes sit at awkward,
 * crowded ratios, and that inharmonicity is most of what makes a clang read
 * as metal rather than as a xylophone.
 */
const PANEL_MODES: readonly (readonly [number, number])[] = [
  [1, 1], [1.58, 0.75], [2.24, 0.6], [2.92, 0.45], [3.73, 0.32], [4.87, 0.22], [6.27, 0.14]
];
/** A steel fire door: a thicker, stiffer slab, its low modes packed closer together. */
const DOOR_MODES: readonly (readonly [number, number])[] = [
  [1, 1], [1.41, 0.72], [1.93, 0.6], [2.47, 0.5], [3.19, 0.36], [4.05, 0.25], [5.33, 0.15]
];
/** A tam-tam, struck at the top of every eight bars of the boss music. */
const GONG_MODES: readonly (readonly [number, number])[] = [
  [1, 1], [1.47, 0.8], [2.09, 0.7], [2.56, 0.55], [3.23, 0.45], [4.12, 0.32], [5.31, 0.2], [6.9, 0.12]
];

// ---------------------------------------------------- Level 8: the score

/**
 * The General's music. D minor at 126: war drums (a big odaiko, a mid drum
 * on the backbeat, the little shime ticking), a galloping bass ostinato, and
 * brass stabbed on the chords. Sixteen bars: A is the groove; B turns the
 * chords over faster and brings a horn theme in over the top.
 */
const BOSS_BPM = 126;
/** One sixteenth, seconds. */
const BOSS_STEP = 60 / BOSS_BPM / 4;
/** Where the whole score sits in the music bus: under the rifle, over the engines. */
const BOSS_LEVEL = 0.5;
/** Each chord: the bass root, and the brass voicing (root, fifth, octave, third — open, so it's wide rather than muddy). */
const BOSS_CHORDS = {
  Dm: { root: 38, brass: [50, 57, 62, 65] },
  Bb: { root: 34, brass: [46, 53, 58, 62] },
  C: { root: 36, brass: [48, 55, 60, 64] },
  Gm: { root: 31, brass: [43, 50, 55, 58] },
  A: { root: 33, brass: [45, 52, 57, 61] }
} as const;
/** Bar by bar. The A major at the end of each half is the harmonic minor's V: it pulls back to Dm every time. */
const BOSS_PROG: readonly (keyof typeof BOSS_CHORDS)[] = [
  'Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A',
  'Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'C', 'A'
];
/** The gallop: an eighth and two sixteenths, over and over, kicking up the octave on the last beat. Semitones above the root. */
const BOSS_BASS: readonly (number | null)[] = [0, null, 0, 0, 0, null, 0, 0, 0, null, 0, 0, 12, null, 12, 7];
/** The odaiko's sixteenths and how hard each lands: BOOM . . BOOM . . . . BOOM . BOOM. */
const BOSS_BIG: Readonly<Partial<Record<number, number>>> = { 0: 1, 3: 0.7, 8: 0.9, 10: 0.72 };
type Stab = readonly [step: number, seconds: number, vel: number];
const BOSS_STABS_A0: readonly Stab[] = [[0, 0.32, 1], [7, 0.1, 0.7], [10, 0.24, 0.85]];
const BOSS_STABS_A1: readonly Stab[] = [[0, 0.12, 0.8], [3, 0.12, 0.75], [6, 0.12, 0.8], [8, 0.62, 1]];
/** In B the brass gets out of the horn's way: one hit a bar, then a climbing turnaround on the last. */
const BOSS_STABS_B: readonly Stab[] = [[0, 0.4, 0.9]];
const BOSS_STABS_TURN: readonly Stab[] = [[0, 0.4, 0.9], [8, 0.1, 0.75], [10, 0.1, 0.85], [12, 0.1, 0.95], [14, 0.22, 1.05]];
type HornNote = readonly [step: number, note: number, steps: number];
/** The theme, one row per bar of B. Chord tones on the strong beats, so it can't fight the stabs. */
const BOSS_HORN: readonly (readonly HornNote[])[] = [
  [[0, 62, 6], [6, 57, 2], [8, 62, 4], [12, 65, 4]], // Dm
  [[0, 62, 8], [8, 60, 4], [12, 58, 4]], //             Bb
  [[0, 62, 6], [6, 58, 2], [8, 55, 8]], //              Gm
  [[0, 57, 6], [6, 61, 2], [8, 64, 8]], //              A
  [[0, 65, 6], [6, 64, 2], [8, 62, 4], [12, 69, 4]], // Dm
  [[0, 65, 8], [8, 62, 8]], //                          Bb
  [[0, 64, 6], [6, 67, 2], [8, 64, 4], [12, 60, 4]], // C
  [[0, 61, 8], [8, 57, 8]] //                           A
];

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuffer!: AudioBuffer;

  masterVolume = 0.8;
  sfxVolume = 0.9;
  musicVolume = 0.75;

  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicTeardown: (() => void) | null = null;

  /** Must be called from a user gesture before any sound plays. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    // Dev convenience (?mute): everything runs, nothing reaches the speakers
    if (!new URLSearchParams(location.search).has('mute')) this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);

    // 2 seconds of white noise reused by every noise-based effect.
    const len = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  setMasterVolume(v: number): void {
    this.masterVolume = v;
    if (this.ctx) this.master.gain.value = v;
  }
  setSfxVolume(v: number): void {
    this.sfxVolume = v;
    if (this.ctx) this.sfxBus.gain.value = v;
  }
  setMusicVolume(v: number): void {
    this.musicVolume = v;
    if (this.ctx) this.musicBus.gain.value = v;
  }

  // ---------------------------------------------------------------- helpers

  private noise(
    duration: number,
    filterType: BiquadFilterType,
    freq: number,
    gain: number,
    decay = true,
    q = 1
  ): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    if (decay) g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    gain: number,
    dest?: AudioNode
  ): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(dest ?? this.sfxBus);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /**
   * A knuckle on a hollow door, `at` seconds from now. Three layers, because
   * a single filtered blip is what makes procedural audio sound like a toy:
   * the knuckle click, the low boom of the panel flexing, and the short
   * woody ring of the leaf in its frame.
   */
  knock(at = 0, strength = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const out = ctx.createGain();
    out.gain.value = 0.9 * strength;
    out.connect(this.sfxBus);

    // Knuckle contact: a very short burst of high noise
    const click = ctx.createBufferSource();
    click.buffer = this.noiseBuffer;
    click.playbackRate.value = 1.5 + Math.random() * 0.3;
    const clickF = ctx.createBiquadFilter();
    clickF.type = 'bandpass';
    clickF.frequency.value = 2100 + Math.random() * 500;
    clickF.Q.value = 0.8;
    const clickG = ctx.createGain();
    clickG.gain.setValueAtTime(0.22, t);
    clickG.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    click.connect(clickF).connect(clickG).connect(out);
    click.start(t, Math.random());
    click.stop(t + 0.08);

    // The panel itself: low thump with a fast pitch drop
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(126 + Math.random() * 18, t);
    body.frequency.exponentialRampToValueAtTime(58, t + 0.12);
    const bodyG = ctx.createGain();
    bodyG.gain.setValueAtTime(0.0001, t);
    bodyG.gain.exponentialRampToValueAtTime(0.5, t + 0.006); // fast attack, not a click
    bodyG.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    body.connect(bodyG).connect(out);
    body.start(t);
    body.stop(t + 0.25);

    // Woody ring: hollow-core doors have an audible mid resonance
    const ring = ctx.createBufferSource();
    ring.buffer = this.noiseBuffer;
    ring.playbackRate.value = 0.5;
    const ringF = ctx.createBiquadFilter();
    ringF.type = 'bandpass';
    ringF.frequency.value = 330 + Math.random() * 60;
    ringF.Q.value = 7;
    const ringG = ctx.createGain();
    ringG.gain.setValueAtTime(0.18, t + 0.004);
    ringG.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    ring.connect(ringF).connect(ringG).connect(out);
    ring.start(t, Math.random());
    ring.stop(t + 0.35);
  }

  /** Three knocks, unevenly spaced the way a person actually knocks. */
  knockSet(): void {
    this.knock(0, 1);
    this.knock(0.26, 0.92);
    this.knock(0.49, 1.05);
  }

  /**
   * A door taking a boot: the frame splintering, the leaf slamming back on
   * its hinges, and a low thud through the floor.
   */
  doorBreach(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Splintering timber — bright noise, gone almost instantly
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer;
    crack.playbackRate.value = 1.7;
    const crackF = ctx.createBiquadFilter();
    crackF.type = 'highpass';
    crackF.frequency.value = 1200;
    const crackG = ctx.createGain();
    crackG.gain.setValueAtTime(0.55, t);
    crackG.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    crack.connect(crackF).connect(crackG).connect(this.sfxBus);
    crack.start(t, Math.random());
    crack.stop(t + 0.2);

    // The boot: a heavy low impact
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(92, t);
    thud.frequency.exponentialRampToValueAtTime(34, t + 0.26);
    const thudG = ctx.createGain();
    thudG.gain.setValueAtTime(0.0001, t);
    thudG.gain.exponentialRampToValueAtTime(0.85, t + 0.008);
    thudG.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    thud.connect(thudG).connect(this.sfxBus);
    thud.start(t);
    thud.stop(t + 0.45);

    // Mid body of the slam, and the leaf banging the wall a beat later
    this.noise(0.3, 'bandpass', 420, 0.4, true, 1.2);
    const bang = ctx.createOscillator();
    bang.type = 'sine';
    bang.frequency.setValueAtTime(150, t + 0.16);
    bang.frequency.exponentialRampToValueAtTime(62, t + 0.34);
    const bangG = ctx.createGain();
    bangG.gain.setValueAtTime(0.0001, t + 0.16);
    bangG.gain.exponentialRampToValueAtTime(0.4, t + 0.17);
    bangG.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    bang.connect(bangG).connect(this.sfxBus);
    bang.start(t + 0.16);
    bang.stop(t + 0.5);
  }

  /**
   * One character's worth of speech blip. Short, pitched per speaker, with a
   * little random wobble so a run of them reads as talking rather than a
   * metronome.
   */
  dialogueBlip(pitch = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = 330 * pitch * (0.94 + Math.random() * 0.12);
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.82, t + 0.055);
    // Soften the square a bit so it isn't pure buzz
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500 * pitch;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(lp).connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  /** Heavy diesel truck engine, for the thing coming through the wall. */
  truckEngine(volume = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(42, t);
    osc.frequency.linearRampToValueAtTime(78, t + 1.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42 * volume, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    osc.connect(lp).connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 2.5);
    this.noise(2.0, 'lowpass', 180, 0.22 * volume, true, 1);
  }

  /** A wall coming down: masonry, dust and a long low collapse. */
  wallCollapse(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // The hit
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(70, t);
    boom.frequency.exponentialRampToValueAtTime(26, t + 0.9);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.95, t + 0.01);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    boom.connect(bg).connect(this.sfxBus);
    boom.start(t);
    boom.stop(t + 1.2);
    // Masonry breaking up, then settling
    this.noise(0.5, 'highpass', 900, 0.6, true, 1);
    this.noise(1.8, 'bandpass', 420, 0.45, true, 0.8);
    for (let i = 0; i < 7; i++) {
      const d = 0.12 + Math.random() * 1.3;
      const chunk = ctx.createOscillator();
      chunk.type = 'triangle';
      chunk.frequency.setValueAtTime(120 + Math.random() * 90, t + d);
      chunk.frequency.exponentialRampToValueAtTime(50, t + d + 0.16);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t + d);
      cg.gain.exponentialRampToValueAtTime(0.2, t + d + 0.006);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.22);
      chunk.connect(cg).connect(this.sfxBus);
      chunk.start(t + d);
      chunk.stop(t + d + 0.3);
    }
  }

  /** Rough distance attenuation for world-positioned sounds. */
  private atten(distance: number, maxDist: number): number {
    return Math.max(0, 1 - distance / maxDist);
  }

  // ------------------------------------------------------------------- SFX

  playerGunshot(): void {
    if (!this.ctx) return;
    // Crack + body + room tail
    this.noise(0.06, 'highpass', 2200, 0.55);
    this.noise(0.16, 'lowpass', 900, 0.75);
    this.tone('square', 160, 40, 0.12, 0.4);
    this.noise(0.5, 'bandpass', 500, 0.14, true, 0.7);
  }

  /** 7.62 rifle: harder crack than the pistol, more body, longer tail. */
  rifleShot(): void {
    if (!this.ctx) return;
    this.noise(0.05, 'highpass', 2600, 0.6);
    this.noise(0.2, 'lowpass', 700, 0.85);
    this.tone('square', 130, 34, 0.15, 0.45);
    this.noise(0.6, 'bandpass', 420, 0.16, true, 0.7);
  }

  /** The fresh mag's spine hitting the release paddle. */
  magStrike(): void {
    this.tone('square', 1300, 500, 0.03, 0.14);
    this.noise(0.04, 'highpass', 2000, 0.16);
  }

  /** Charging handle hauled back against the recoil spring. */
  boltBack(): void {
    this.noise(0.05, 'bandpass', 1500, 0.22, true, 2);
    this.tone('square', 700, 260, 0.05, 0.14);
  }

  /** Bolt carrier slamming home. */
  boltForward(): void {
    this.noise(0.05, 'lowpass', 900, 0.42);
    this.tone('square', 520, 180, 0.06, 0.22);
    this.noise(0.03, 'highpass', 2800, 0.14);
  }

  shotgunBlast(): void {
    if (!this.ctx) return;
    // Wider, deeper than the pistol: big low-end body, broadband crack,
    // and a longer room tail
    this.noise(0.08, 'highpass', 1600, 0.6);
    this.noise(0.3, 'lowpass', 500, 1.0);
    this.tone('square', 110, 28, 0.22, 0.55);
    this.tone('sine', 70, 30, 0.28, 0.5);
    this.noise(0.8, 'bandpass', 350, 0.18, true, 0.6);
  }

  /** Pump hauled back: metal-on-metal clack plus the hull flicked clear. */
  pumpBack(): void {
    this.noise(0.04, 'highpass', 2200, 0.22);
    this.tone('square', 900, 350, 0.05, 0.16);
    this.noise(0.07, 'lowpass', 800, 0.28);
  }

  /** Pump slammed forward: the heavier of the two clacks. */
  pumpForward(): void {
    this.noise(0.05, 'lowpass', 1000, 0.4);
    this.tone('square', 600, 200, 0.06, 0.2);
    this.noise(0.04, 'highpass', 2600, 0.16);
  }

  /** A shell thumbed into the loading port. */
  shellIn(): void {
    this.tone('square', 750, 320, 0.04, 0.12);
    this.noise(0.05, 'lowpass', 1100, 0.22);
  }

  enemyGunshot(distance: number): void {
    const a = this.atten(distance, 45) * 0.9 + 0.08;
    this.noise(0.09, 'highpass', 1500, 0.35 * a);
    this.noise(0.22, 'lowpass', 650, 0.6 * a);
    this.tone('square', 120, 35, 0.16, 0.3 * a);
  }

  /** A round off body armour: a hard flat smack with a ring of metal in it. */
  armourHit(distance: number): void {
    const a = this.atten(distance, 30) * 0.8 + 0.12;
    this.noise(0.035, 'highpass', 3200, 0.32 * a);
    this.noise(0.07, 'bandpass', 1100, 0.3 * a, true, 2);
    this.tone('triangle', 2300 + Math.random() * 500, 1500, 0.09, 0.09 * a);
  }

  /** Someone else's pistol, across the room: lighter and sharper than a rifle. */
  npcPistol(distance: number): void {
    const a = this.atten(distance, 40) * 0.85 + 0.06;
    this.noise(0.06, 'highpass', 2200, 0.32 * a);
    this.noise(0.14, 'lowpass', 900, 0.42 * a);
    this.tone('square', 160, 50, 0.1, 0.2 * a);
  }

  /** A punch landing in somebody else's fight. */
  distantPunch(distance: number, head: boolean): void {
    const a = this.atten(distance, 22);
    if (a <= 0.02) return;
    if (head) {
      this.noise(0.05, 'bandpass', 1700, 0.3 * a, true, 1.2);
      this.noise(0.09, 'lowpass', 520, 0.32 * a);
      this.tone('sine', 180, 60, 0.12, 0.28 * a);
    } else {
      this.noise(0.07, 'lowpass', 300, 0.45 * a);
      this.tone('sine', 115, 42, 0.14, 0.32 * a);
    }
  }

  /** The grunt of whoever took it. */
  distantGrunt(distance: number): void {
    const a = this.atten(distance, 20);
    if (a <= 0.05) return;
    const base = 105 + Math.random() * 40;
    this.voice({
      D: 0.18,
      base: base * 1.3,
      peak: base * 1.5,
      end: base * 0.8,
      attack: 0.02,
      level: 0.24 * a,
      breath: 0.12 * a,
      formants: [[500, 5, 1.0], [850, 6, 0.7], [2500, 8, 0.3]]
    });
  }

  bulletWhiz(): void {
    this.noise(0.09, 'bandpass', 3800, 0.22, true, 3);
  }

  fleshHit(): void {
    this.noise(0.09, 'lowpass', 420, 0.5);
    this.tone('sine', 220, 60, 0.1, 0.3);
  }

  killConfirm(): void {
    if (!this.ctx) return;
    this.tone('sine', 880, 880, 0.05, 0.12);
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1320, t + 0.05);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setValueAtTime(0.1, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  ricochet(distance: number): void {
    const a = this.atten(distance, 30) * 0.8 + 0.1;
    this.noise(0.05, 'highpass', 3000, 0.3 * a);
    if (Math.random() < 0.35) this.tone('sine', 2600 + Math.random() * 1200, 400, 0.25, 0.06 * a);
  }

  /**
   * Pane shatter: a hard initial crack, a bright splintering burst, then a
   * cascade of shards tinkling onto the floor over the next second.
   */
  glassShatter(distance: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const a = this.atten(distance, 35) * 0.9 + 0.1;
    const now = ctx.currentTime;

    // 1. The crack — short, loud, full-band with a resonant ping
    this.noise(0.05, 'highpass', 1800, 0.7 * a);
    this.noise(0.12, 'bandpass', 5200, 0.45 * a, true, 1.2);
    this.tone('triangle', 3600, 2400, 0.09, 0.18 * a);

    // 2. Splintering: the pane breaking up — a crackling burst of tiny clicks
    for (let i = 0; i < 14; i++) {
      const t = now + 0.01 + Math.random() * 0.18;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.value = 1.5 + Math.random();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 4000 + Math.random() * 5000;
      f.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.setValueAtTime((0.12 + Math.random() * 0.1) * a, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + Math.random() * 0.03);
      src.connect(f).connect(g).connect(this.sfxBus);
      src.start(t, Math.random());
      src.stop(t + 0.08);
    }

    // 3. Shards raining down: inharmonic glassy chimes, denser early, thinning out
    for (let i = 0; i < 26; i++) {
      const t = now + 0.08 + Math.pow(Math.random(), 0.6) * 1.1;
      const base = 2200 + Math.random() * 6000;
      for (const ratio of [1, 2.76, 5.4]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = base * ratio;
        const g = ctx.createGain();
        const vol = (0.035 / ratio) * a * (1 - (t - now) / 1.5);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.setValueAtTime(Math.max(0.0002, vol), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08 + Math.random() * 0.2);
        osc.connect(g).connect(this.sfxBus);
        osc.start(t);
        osc.stop(t + 0.35);
      }
    }

    // 4. Body of the pane folding — a low whump underneath it all
    this.noise(0.18, 'lowpass', 260, 0.3 * a);
  }

  footstep(sprinting: boolean, crouching: boolean): void {
    const vol = crouching ? 0.05 : sprinting ? 0.18 : 0.1;
    this.noise(0.07, 'lowpass', 300 + Math.random() * 150, vol);
  }

  enemyFootstep(distance: number): void {
    const a = this.atten(distance, 14);
    if (a <= 0.01) return;
    this.noise(0.07, 'lowpass', 260 + Math.random() * 120, 0.09 * a);
  }

  enemyShout(distance: number): void {
    if (!this.ctx) return;
    const a = this.atten(distance, 30) * 0.8 + 0.1;
    // Gruff "hey!" — pitch-swept sawtooth through a formant-ish bandpass
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150 + Math.random() * 40, t);
    osc.frequency.exponentialRampToValueAtTime(95, t + 0.28);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 620;
    filter.Q.value = 1.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.28 * a, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(filter).connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  /**
   * A voice, from half a metre away — the throat the scream and the grunts
   * share.
   *
   * A single sawtooth is a buzzer; two a few cents apart start to beat like
   * a throat. They wobble with vibrato, and go through three formant bands
   * tuned to a vowel — that shaping is what turns an oscillator into a
   * voice. The pitch leaps to `peak` in `attack`, eases off a little, then
   * falls to `end` as the breath runs out, with breath noise on top.
   */
  private voice(o: {
    D: number;
    base: number;
    peak: number;
    end: number;
    attack: number;
    level: number;
    breath: number;
    formants: readonly (readonly [number, number, number])[];
    vibrato?: number;
  }): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const { D } = o;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(o.level, t + Math.min(0.035, D * 0.2));
    out.gain.setValueAtTime(o.level, t + D * 0.6);
    out.gain.exponentialRampToValueAtTime(0.0001, t + D);
    out.connect(this.sfxBus);

    const voice = ctx.createGain();
    for (const [f, q, g] of o.formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * (0.96 + Math.random() * 0.08);
      bp.Q.value = q;
      const gg = ctx.createGain();
      gg.gain.value = g;
      voice.connect(bp).connect(gg).connect(out);
    }

    const vib = ctx.createOscillator();
    vib.frequency.value = 6 + Math.random() * 1.5;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = o.peak * (o.vibrato ?? 0.035);
    vib.connect(vibDepth);
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(o.base, t);
      osc.frequency.exponentialRampToValueAtTime(o.peak, t + o.attack);
      osc.frequency.exponentialRampToValueAtTime(o.peak * 0.9, t + D * 0.6);
      osc.frequency.exponentialRampToValueAtTime(o.end, t + D);
      vibDepth.connect(osc.frequency);
      osc.connect(voice);
      osc.start(t);
      osc.stop(t + D + 0.05);
    }
    vib.start(t);
    vib.stop(t + D + 0.05);

    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer;
    const airF = ctx.createBiquadFilter();
    airF.type = 'bandpass';
    airF.frequency.value = 1700;
    airF.Q.value = 0.9;
    const airG = ctx.createGain();
    airG.gain.setValueAtTime(0.0001, t);
    airG.gain.exponentialRampToValueAtTime(o.breath, t + Math.min(0.05, D * 0.25));
    airG.gain.exponentialRampToValueAtTime(0.0001, t + D);
    air.connect(airF).connect(airG).connect(this.sfxBus);
    air.start(t, Math.random());
    air.stop(t + D + 0.05);
  }

  /**
   * A man falling down the stairwell, screaming the whole way: one long
   * "AAAH" that cracks, catches its breath and goes again. It plays on for
   * four seconds unless stopped; the scene moves it — set(distance) every
   * frame, loud and bright close by, quieter and duller as he drops away —
   * and stop() cuts it off when he hits the bottom.
   */
  fallScream(): { set(distance: number): void; stop(): void } {
    const none = { set: (_d: number): void => {}, stop: (): void => {} };
    if (!this.ctx) return none;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const D = 4.2;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 7000;
    out.connect(muffle).connect(this.sfxBus);
    const voice = ctx.createGain();
    for (const [f, q, g] of [[820, 5, 1.0], [1180, 6, 0.8], [2700, 8, 0.45]] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * (0.96 + Math.random() * 0.08);
      bp.Q.value = q;
      const gg = ctx.createGain();
      gg.gain.value = g;
      voice.connect(bp).connect(gg).connect(out);
    }
    const base = 185 + Math.random() * 25;
    const vib = ctx.createOscillator();
    vib.frequency.value = 7.5;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = base * 0.09;
    vib.connect(vibDepth);
    const oscs: OscillatorNode[] = [vib];
    for (const detune of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = detune;
      const fq = osc.frequency;
      fq.setValueAtTime(base, t);
      fq.exponentialRampToValueAtTime(base * 2.3, t + 0.18);
      fq.exponentialRampToValueAtTime(base * 2.1, t + 1.4);
      // The crack, a gasp, and up again
      fq.exponentialRampToValueAtTime(base * 1.3, t + 1.65);
      fq.exponentialRampToValueAtTime(base * 2.4, t + 1.9);
      fq.exponentialRampToValueAtTime(base * 2.0, t + 3.4);
      fq.exponentialRampToValueAtTime(base * 1.4, t + D);
      vibDepth.connect(fq);
      osc.connect(voice);
      oscs.push(osc);
    }
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer;
    const airF = ctx.createBiquadFilter();
    airF.type = 'bandpass';
    airF.frequency.value = 1800;
    airF.Q.value = 0.8;
    const airG = ctx.createGain();
    airG.gain.value = 0.12;
    air.connect(airF).connect(airG).connect(out);
    for (const o of oscs) {
      o.start(t);
      o.stop(t + D + 0.05);
    }
    air.start(t, Math.random());
    air.stop(t + D + 0.05);
    let stopped = false;
    return {
      set: (d: number): void => {
        if (stopped) return;
        const now = ctx.currentTime;
        out.gain.setTargetAtTime(0.6 / (1 + (d / 5) * (d / 5)) + 0.006, now, 0.03);
        muffle.frequency.setTargetAtTime(900 + 6500 / (1 + d / 7), now, 0.05);
      },
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0.0001, now, 0.012);
        for (const o of oscs) o.stop(now + 0.12);
        air.stop(now + 0.12);
      }
    };
  }

  /**
   * A man screaming with a knife in him: an open "AAH" that catches, holds,
   * then cracks and drops most of an octave. `strength` below 1 is the
   * second stab — shorter, lower, choked off.
   */
  enemyScream(strength = 1): void {
    const base = 165 + Math.random() * 30;
    this.voice({
      D: 0.35 + 0.6 * strength,
      base,
      peak: base * (1.7 + 0.55 * strength),
      end: base * 0.62,
      attack: 0.09,
      level: 0.1 + 0.28 * strength,
      breath: 0.09 * strength + 0.03,
      formants: [[800, 5, 1.0], [1150, 6, 0.75], [2600, 8, 0.4]]
    });
  }

  /**
   * Effort, not pain. 'strain' is teeth-gritted, holding a knife off his own
   * stomach: a low closed "UH" that barely moves in pitch and shakes. 'oof'
   * is a fist in the gut — the air driven out of him in one short drop.
   */
  enemyGrunt(kind: 'strain' | 'oof'): void {
    const base = 110 + Math.random() * 20;
    if (kind === 'strain') {
      this.voice({
        D: 0.5,
        base,
        peak: base * 1.3,
        end: base * 1.1,
        attack: 0.12,
        level: 0.27,
        breath: 0.07,
        vibrato: 0.08, // a shake, not a singer's vibrato
        formants: [[600, 6, 1.0], [1000, 7, 0.6], [2400, 8, 0.25]]
      });
    } else {
      this.voice({
        D: 0.2,
        base: base * 1.35,
        peak: base * 1.5,
        end: base * 0.75,
        attack: 0.02,
        level: 0.3,
        breath: 0.16,
        formants: [[500, 5, 1.0], [850, 6, 0.7], [2500, 8, 0.3]]
      });
    }
  }

  radioChirp(distance: number): void {
    const a = this.atten(distance, 25) * 0.6 + 0.05;
    this.tone('square', 1800, 1400, 0.05, 0.04 * a);
    this.noise(0.08, 'bandpass', 2100, 0.05 * a, true, 4);
  }

  /** Magazine release: a light click and the mag sliding free. */
  magOut(): void {
    this.tone('square', 900, 300, 0.04, 0.12);
    this.noise(0.08, 'bandpass', 1800, 0.08, true, 2);
  }

  /** Fresh mag slammed home: solid plastic-on-metal thunk. */
  magIn(): void {
    this.noise(0.05, 'lowpass', 900, 0.35);
    this.tone('square', 420, 150, 0.06, 0.2);
  }

  /** Slide racking forward. */
  slideRack(): void {
    this.noise(0.04, 'highpass', 2500, 0.2);
    this.tone('square', 1400, 500, 0.05, 0.12);
    this.noise(0.06, 'lowpass', 700, 0.22);
  }

  /** Trigger pull on an empty chamber. */
  dryFire(): void {
    this.tone('square', 1100, 700, 0.03, 0.1);
  }

  /** Bowie knife clearing the sheath: a bright metallic shing. */
  knifeDraw(): void {
    this.noise(0.12, 'bandpass', 5200, 0.18, true, 5);
    this.tone('sine', 3200, 4600, 0.14, 0.06);
    this.noise(0.05, 'highpass', 3000, 0.12);
  }

  /** The blade going in: a wet punch with a low body. */
  knifeStab(): void {
    this.noise(0.06, 'lowpass', 350, 0.6);
    this.noise(0.14, 'lowpass', 900, 0.35);
    this.tone('sine', 180, 45, 0.16, 0.4);
    this.noise(0.25, 'bandpass', 600, 0.1, true, 1.2);
  }

  // ------------------------------------------------------- Deadbull + kick

  /**
   * The tab going on a cold can: the aluminium gives with a hard tick, then
   * the seal breaks and the carbonation lets go. The hiss is what sells it —
   * the crack on its own just sounds like a light switch.
   */
  canCrack(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // The tab: a sharp tick with a thin metallic ring behind it
    this.noise(0.025, 'bandpass', 3400, 0.3, true, 4);
    this.tone('triangle', 2600, 1500, 0.07, 0.05);
    // Escaping gas, fading over half a second
    this.noise(0.55, 'highpass', 5000, 0.13);
    // Foam keeps ticking after the hiss has gone. Scattered in time, because
    // evenly spaced ticks read as a machine rather than bubbles.
    for (let i = 0; i < 7; i++) {
      const at = t + 0.08 + Math.random() * 0.5;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.value = 1.6 + Math.random();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 4500 + Math.random() * 3500;
      f.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.04 + Math.random() * 0.03, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      src.connect(f).connect(g).connect(this.sfxBus);
      src.start(at, Math.random());
      src.stop(at + 0.08);
    }
  }

  /**
   * One swallow. A glug is an air column, so it climbs in pitch as the can
   * empties — `index` says which gulp this is, and that alone is what keeps
   * three in a row from sounding like the same sample three times.
   */
  gulp(index = 0): void {
    const rise = 1 + index * 0.17;
    this.tone('sine', 92 * rise, 235 * rise, 0.11, 0.17);
    this.noise(0.06, 'lowpass', 620, 0.08);
    this.tone('sine', 150, 70, 0.09, 0.06); // the throat, under the can
  }

  /**
   * Crushing the empty. Thin aluminium doesn't thud, it buckles: a run of
   * irregular creases, each a short bright crackle, over one dull give.
   */
  canCrush(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.noise(0.13, 'lowpass', 480, 0.4);
    for (let i = 0; i < 9; i++) {
      const at = t + Math.random() * 0.22;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.value = 1.2 + Math.random() * 1.2;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1100 + Math.random() * 2600;
      f.Q.value = 2 + Math.random() * 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22 + Math.random() * 0.18, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03 + Math.random() * 0.04);
      src.connect(f).connect(g).connect(this.sfxBus);
      src.start(at, Math.random());
      src.stop(at + 0.1);
    }
  }

  /** The empty landing and rolling off: light, tinny, hollow. */
  canClatter(distance: number): void {
    const a = this.atten(distance, 20) * 0.8 + 0.15;
    this.noise(0.05, 'bandpass', 2600, 0.34 * a, true, 2);
    this.tone('triangle', 1900, 1400, 0.12, 0.1 * a);
    this.noise(0.3, 'bandpass', 3400, 0.12 * a, true, 3);
  }

  /**
   * Legs swinging through the air. A whoosh is a moving resonance rather
   * than a noise burst — the band sweeps up as the boots accelerate past
   * your ear and back down as they go away — so it's built by hand instead
   * of going through noise(), which can't move its filter.
   */
  kickWhoosh(): void {
    this.whoosh(0.26, 280, 1500, 360, 0.5, 1.6);
  }

  /** A strap's velcro torn open and pressed home: a crackling rip. */
  velcro(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 9; i++) {
      setTimeout(() => this.noise(0.022 + Math.random() * 0.02, 'bandpass', 2200 + Math.random() * 1800, 0.1 + Math.random() * 0.06, true, 1.5), i * 21 + Math.random() * 9);
    }
  }

  /** A helmet's shell knocked on: hollow, plastic. */
  helmetKnock(): void {
    this.tone('triangle', 340, 220, 0.09, 0.22);
    this.noise(0.05, 'bandpass', 900, 0.16, true, 2);
  }

  /** Small metal on metal: a grenade's pin ring, a buckle. */
  clink(): void {
    this.tone('sine', 3400, 3300, 0.12, 0.08);
    this.tone('sine', 4700, 4600, 0.08, 0.05);
  }

  /** Something pushed down into a trouser pocket: two soft brushes of cloth. */
  pocket(): void {
    if (!this.ctx) return;
    this.whoosh(0.22, 260, 900, 300, 0.16, 0.9);
    setTimeout(() => this.noise(0.16, 'bandpass', 700, 0.08, true, 0.8), 140);
  }

  /** Something new in the inventory: a short bright rise of two notes. */
  itemGet(): void {
    this.tone('sine', 660, 660, 0.16, 0.09);
    setTimeout(() => this.tone('sine', 990, 990, 0.32, 0.09), 110);
    setTimeout(() => this.tone('triangle', 1980, 1980, 0.22, 0.025), 110);
  }

  /** A fist going past: shorter and higher than legs. */
  punchSwish(): void {
    this.whoosh(0.13, 700, 2400, 900, 0.32, 1.3);
  }

  /** A band of noise swept from f0 up to fPeak and back down to f1 over D, loudest at the top. */
  private whoosh(D: number, f0: number, fPeak: number, f1: number, gain: number, q: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(fPeak, t + D * 0.45);
    f.frequency.exponentialRampToValueAtTime(f1, t + D);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + D * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + D);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + D + 0.05);
  }

  /**
   * Knuckles landing. The gut is a dull, deep thump with a slap of shirt on
   * top; the side of the head is the kill, so it cracks — a short bright
   * smack and a bony click over a harder low end.
   */
  punchImpact(head: boolean): void {
    if (head) {
      this.noise(0.05, 'bandpass', 1900, 0.34, true, 1.2);
      this.noise(0.02, 'highpass', 3200, 0.24);
      this.noise(0.1, 'lowpass', 520, 0.36);
      this.tone('sine', 190, 58, 0.14, 0.34);
    } else {
      this.noise(0.07, 'lowpass', 280, 0.55);
      this.tone('sine', 115, 42, 0.16, 0.42);
      this.noise(0.05, 'bandpass', 1300, 0.16, true, 1.4); // shirt
    }
  }

  /**
   * Both boots into a chest. Blunter and much heavier than a bullet's flesh
   * hit — the low end here is a whole body being moved, not a wound.
   */
  kickImpact(): void {
    this.noise(0.05, 'lowpass', 260, 0.58);
    this.noise(0.18, 'lowpass', 800, 0.26);
    this.tone('sine', 140, 34, 0.24, 0.45);
    this.noise(0.07, 'bandpass', 1500, 0.17, true, 1.5); // boot on cloth
  }

  /**
   * Ravi's own back hitting the floor. No attenuation on this one: it is
   * happening to the player, not somewhere across the room.
   */
  backLanding(): void {
    this.noise(0.09, 'lowpass', 200, 0.4);
    this.tone('sine', 95, 28, 0.3, 0.32);
    this.noise(0.24, 'bandpass', 900, 0.13, true, 1.2); // the jacket
  }

  /** A boot dragging for purchase — him rolling up off the floor. */
  scuff(): void {
    this.noise(0.22, 'bandpass', 1400, 0.28, true, 1.1);
    this.noise(0.1, 'lowpass', 600, 0.2);
  }

  uiBeep(high = false): void {
    this.tone('square', high ? 1150 : 740, high ? 1150 : 740, 0.06, 0.06);
  }

  bodyThud(distance: number): void {
    const a = this.atten(distance, 25) * 0.8 + 0.1;
    this.noise(0.12, 'lowpass', 180, 0.35 * a);
  }

  // ------------------------------------------------------------------ MUSIC

  /**
   * Muffled lo-fi beat "leaking from the guard's headphones": heavily
   * low-passed chords, dusty vinyl crackle, soft kick/snare at 72 BPM.
   */
  /**
   * Menu music: the mp3 in public/audio on loop, routed through the music
   * bus so the volume sliders still apply. Falls back to the old procedural
   * lo-fi mix if the file can't be played.
   */
  private menuTrack: HTMLAudioElement | null = null;
  private menuTrackSource: MediaElementAudioSourceNode | null = null;

  /** True while either the mp3 or the fallback synth mix is actually going. */
  get menuMusicPlaying(): boolean {
    return (this.menuTrack !== null && !this.menuTrack.paused) || this.musicTimer !== null;
  }

  /**
   * A fluorescent tube striking, or failing to. Mains hum with its odd
   * harmonics — that is what makes it read as electrical rather than musical —
   * plus a band of ballast rattle over the top.
   */
  fluorescentBuzz(duration = 0.32, gain = 0.42): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    bus.gain.setValueAtTime(gain, t + duration * 0.75);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    bus.connect(this.sfxBus);

    for (const [f, g] of [[120, 1], [240, 0.42], [360, 0.3], [600, 0.15]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * (0.99 + Math.random() * 0.02);
      const og = ctx.createGain();
      og.gain.value = g * 0.22;
      o.connect(og).connect(bus);
      o.start(t);
      o.stop(t + duration + 0.05);
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 3100;
    nf.Q.value = 7;
    const ng = ctx.createGain();
    ng.gain.value = 0.14;
    n.connect(nf).connect(ng).connect(bus);
    n.start(t);
    n.stop(t + duration + 0.05);
  }

  /**
   * A floor's worth of electrics letting go: the hum slides down an octave and
   * a half while the top end is filtered off it, and a couple of contactors
   * drop out on the way.
   */
  powerDown(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.5, t);
    bus.gain.setValueAtTime(0.44, t + 1.5);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
    bus.connect(this.sfxBus);

    for (const base of [110, 163]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 0.2, t + 2.5);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(2400, t);
      f.frequency.exponentialRampToValueAtTime(160, t + 2.5);
      const g = ctx.createGain();
      g.gain.value = 0.2;
      o.connect(f).connect(g).connect(bus);
      o.start(t);
      o.stop(t + 2.8);
    }
    // Contactors dropping out, a beat apart
    for (const at of [0.06, 0.9]) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 220;
      nf.Q.value = 2.2;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.5, t + at);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.16);
      n.connect(nf).connect(ng).connect(this.sfxBus);
      n.start(t + at);
      n.stop(t + at + 0.2);
    }
  }

  /** Latch, swing, and the handle settling back. */
  doorOpen(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // Latch
    this.noise(0.04, 'bandpass', 2600, 0.34);
    this.tone('square', 1400, 700, 0.05, 0.09);
    // The leaf swinging — filtered noise sweeping down as it opens
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(900, t + 0.06);
    f.frequency.exponentialRampToValueAtTime(260, t + 0.75);
    f.Q.value = 3.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.16);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    n.connect(f).connect(g).connect(this.sfxBus);
    n.start(t + 0.06);
    n.stop(t + 0.85);
  }

  /** The chime a lift gives when it arrives: two soft sine notes. */
  elevatorDing(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [f, at] of [[1318, 0], [1046, 0.22]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.28, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 1.1);
      o.connect(g).connect(this.sfxBus);
      o.start(t + at);
      o.stop(t + at + 1.2);
    }
  }

  /** Lift doors running along their track: a low rumble with a thump at the end. */
  elevatorDoors(seconds = 1.1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 340;
    f.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.12);
    g.gain.setValueAtTime(0.16, t + seconds - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    n.connect(f).connect(g).connect(this.sfxBus);
    n.start(t);
    n.stop(t + seconds + 0.05);
    // The leaves meeting
    const k = ctx.createBufferSource();
    k.buffer = this.noiseBuffer;
    const kf = ctx.createBiquadFilter();
    kf.type = 'lowpass';
    kf.frequency.value = 420;
    const kg = ctx.createGain();
    kg.gain.setValueAtTime(0.0001, t + seconds - 0.04);
    kg.gain.exponentialRampToValueAtTime(0.34, t + seconds);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.18);
    k.connect(kf).connect(kg).connect(this.sfxBus);
    k.start(t + seconds - 0.04);
    k.stop(t + seconds + 0.2);
  }

  /**
   * The car moving: motor hum and cable rumble, rising in at the start and
   * dying away at the end.
   */
  elevatorRide(seconds = 2.6): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(0.3, t + 0.5);
    bus.gain.setValueAtTime(0.3, t + seconds - 0.6);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    bus.connect(this.sfxBus);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(58, t);
    o.frequency.linearRampToValueAtTime(66, t + seconds * 0.5);
    o.frequency.linearRampToValueAtTime(52, t + seconds);
    const of = ctx.createBiquadFilter();
    of.type = 'lowpass';
    of.frequency.value = 260;
    const og = ctx.createGain();
    og.gain.value = 0.5;
    o.connect(of).connect(og).connect(bus);
    o.start(t);
    o.stop(t + seconds + 0.05);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 180;
    const ng = ctx.createGain();
    ng.gain.value = 0.55;
    n.connect(nf).connect(ng).connect(bus);
    n.start(t);
    n.stop(t + seconds + 0.05);
  }

  /**
   * A short arc across the water: a hard snap of broadband noise with a buzz
   * under it, quieter the further off it is.
   */
  electricCrackle(distance: number): void {
    if (!this.ctx) return;
    const a = this.atten(distance, 22);
    if (a < 0.03) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.playbackRate.value = 1.6;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2200;
    const g = ctx.createGain();
    const len = 0.06 + Math.random() * 0.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32 * a, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(f).connect(g).connect(this.sfxBus);
    n.start(t, Math.random() * 1.5);
    n.stop(t + len + 0.02);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 110 + Math.random() * 60;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.06 * a, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(og).connect(this.sfxBus);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  /** Stepping into it: a loud sustained buzz that chokes off. */
  electrocute(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(0.6, t + 0.01);
    bus.gain.setValueAtTime(0.55, t + 0.55);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    bus.connect(this.sfxBus);
    for (const f of [120, 180, 240]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.8, t + 0.8);
      const g = ctx.createGain();
      g.gain.value = 0.18;
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + 0.9);
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 3400;
    nf.Q.value = 2;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    n.connect(nf).connect(ng).connect(bus);
    n.start(t);
    n.stop(t + 0.9);
  }

  /**
   * A seized lever being forced: a low metal groan that wanders in pitch as
   * it binds and gives, with a scrape of grit in the pivot over it and a
   * couple of high squeals where it catches. Runs for `seconds`.
   */
  leverStrain(seconds = 1.4): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
    bus.gain.setValueAtTime(0.5, t + seconds - 0.15);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    bus.connect(this.sfxBus);
    // The groan: two detuned saws through a band that sweeps as it binds
    const steps = 24;
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) curve[i] = 260 + Math.random() * 340;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 5;
    band.frequency.setValueCurveAtTime(curve, t, seconds);
    band.connect(bus);
    for (const f of [68, 71.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 1.25, t + seconds);
      const g = ctx.createGain();
      g.gain.value = 0.34;
      o.connect(g).connect(band);
      o.start(t);
      o.stop(t + seconds + 0.05);
    }
    // Grit in the pivot
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1300;
    nf.Q.value = 1.6;
    const ng = ctx.createGain();
    ng.gain.value = 0.12;
    n.connect(nf).connect(ng).connect(bus);
    n.start(t);
    n.stop(t + seconds + 0.05);
    // Where it catches and squeals
    for (const at of [seconds * 0.22, seconds * 0.63]) {
      const s = ctx.createOscillator();
      s.type = 'triangle';
      s.frequency.setValueAtTime(1150 + Math.random() * 300, t + at);
      s.frequency.linearRampToValueAtTime(900 + Math.random() * 250, t + at + 0.22);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t + at);
      sg.gain.exponentialRampToValueAtTime(0.07, t + at + 0.03);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.25);
      s.connect(sg).connect(bus);
      s.start(t + at);
      s.stop(t + at + 0.3);
    }
  }

  /** Ravi straining at something: a short voiced grunt with breath under it. */
  effortGrunt(strength = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = 0.32 + 0.12 * strength;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(0.32 * strength, t + 0.05);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + len);
    bus.connect(this.sfxBus);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(118, t);
    o.frequency.linearRampToValueAtTime(104, t + len);
    // A throaty vowel: one formant band, low-passed
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 520;
    f1.Q.value = 2.2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    o.connect(f1).connect(lp).connect(bus);
    o.start(t);
    o.stop(t + len + 0.05);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    nf.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.value = 0.25;
    n.connect(nf).connect(ng).connect(bus);
    n.start(t, Math.random());
    n.stop(t + len + 0.05);
  }

  /** The turn and the face behind him: a low hit with a sour high pair over it. */
  revealSting(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(64, t);
    boom.frequency.exponentialRampToValueAtTime(34, t + 1.1);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.75, t + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    boom.connect(bg).connect(this.sfxBus);
    boom.start(t);
    boom.stop(t + 1.35);
    this.noise(0.5, 'lowpass', 380, 0.4);
    for (const f of [740, 784]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g).connect(this.sfxBus);
      o.start(t);
      o.stop(t + 1.65);
    }
  }

  /**
   * A pistol across the side of the head, heard from inside it: a hard low
   * thud and a crack, and then the ringing that is all there is afterwards.
   * The ring goes straight to the master bus and takes `ring` seconds to die.
   */
  knockoutHit(ring = 4.5): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(110, t);
    thud.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(1.0, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    thud.connect(tg).connect(this.sfxBus);
    thud.start(t);
    thud.stop(t + 0.36);
    this.noise(0.06, 'bandpass', 2300, 0.9, true, 1.2);
    this.noise(0.16, 'lowpass', 850, 0.8);
    // Tinnitus: one thin tone, and a second a hair off it that beats against it
    for (const [f, g0] of [[3720, 0.045], [3736, 0.03]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + 0.05);
      g.gain.exponentialRampToValueAtTime(g0, t + 0.3);
      g.gain.setValueAtTime(g0, t + ring * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
      o.connect(g).connect(this.master);
      o.start(t + 0.05);
      o.stop(t + ring + 0.05);
    }
  }

  /** Coming round: the ringing again, quieter, fading out over `seconds`. */
  wakeRing(seconds = 5): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [f, g0] of [[3720, 0.028], [3738, 0.018]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(g0, t + 0.6);
      g.gain.setValueAtTime(g0, t + seconds * 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
      o.connect(g).connect(this.sfxBus);
      o.start(t);
      o.stop(t + seconds + 0.05);
    }
  }

  /** A low, dazed groan: a voiced tone sliding down through a dull vowel. */
  groan(strength = 1): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = 0.9;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(0.26 * strength, t + 0.15);
    bus.gain.setValueAtTime(0.22 * strength, t + len * 0.6);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + len);
    bus.connect(this.sfxBus);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(112, t);
    o.frequency.linearRampToValueAtTime(92, t + len);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.setValueAtTime(560, t);
    f1.frequency.linearRampToValueAtTime(380, t + len);
    f1.Q.value = 2.4;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    o.connect(f1).connect(lp).connect(bus);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  /** Hands working at a knot: bursts of rough fibre scraping on fibre. */
  ropeWork(seconds = 1.2): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    for (let at = 0; at < seconds; at += 0.12 + Math.random() * 0.14) {
      const t = t0 + at;
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer;
      n.playbackRate.value = 0.6 + Math.random() * 0.3;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900 + Math.random() * 900;
      f.Q.value = 1.2;
      const g = ctx.createGain();
      const len = 0.06 + Math.random() * 0.1;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      n.connect(f).connect(g).connect(this.sfxBus);
      n.start(t, Math.random());
      n.stop(t + len + 0.02);
    }
  }

  /** The last knot giving: a rope whipped out through a loop. */
  ropeFree(): void {
    if (!this.ctx) return;
    this.noise(0.18, 'bandpass', 1500, 0.3, true, 0.9);
    this.noise(0.08, 'highpass', 3000, 0.12);
  }

  /** A bare fist into a face: a meaty slap and a crack, and a thud under both. */
  punchHit(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.22);
    this.noise(0.07, 'bandpass', 1800, 0.85, true, 0.8);
    this.noise(0.03, 'highpass', 4200, 0.35);
    this.noise(0.12, 'lowpass', 600, 0.6);
  }

  /** An office chair shoved back hard on its castors. */
  chairScrape(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(320, t + 0.35);
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    n.connect(f).connect(g).connect(this.sfxBus);
    n.start(t, Math.random());
    n.stop(t + 0.45);
  }

  /**
   * A vent cover wrenched off and somebody heavy scrambling into the duct
   * behind it: a clang, the cover landing, then hollow knocks moving away.
   */
  ventRattle(distance: number): void {
    if (!this.ctx) return;
    const a = this.atten(distance, 20) * 0.8 + 0.2;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const clang = (at: number, f: number, gain: number, len: number): void => {
      const t = t0 + at;
      for (const m of [1, 2.76, 5.4]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f * m;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime((gain * a) / m, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + len + 0.02);
      }
    };
    clang(0, 310, 0.3, 0.5);
    clang(0.32, 240, 0.22, 0.35);
    // Knees and elbows in sheet metal, going away
    for (let i = 0; i < 6; i++) clang(0.7 + i * 0.26, 150 + Math.random() * 40, 0.16 * (1 - i / 7), 0.18);
  }

  /** The breaker going over: a heavy mechanical clack. */
  breakerThrow(): void {
    if (!this.ctx) return;
    this.noise(0.09, 'lowpass', 900, 0.7);
    this.tone('square', 220, 70, 0.12, 0.22);
    this.noise(0.05, 'bandpass', 2600, 0.3);
  }

  /**
   * Power coming back to a floor: a rising hum as the plant spins up, with
   * relays pulling in along the way.
   */
  powerUp(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(0.4, t + 0.8);
    bus.gain.setValueAtTime(0.38, t + 2.2);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    bus.connect(this.sfxBus);
    for (const base of [55, 82]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 0.3, t);
      o.frequency.exponentialRampToValueAtTime(base, t + 2.0);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(200, t);
      f.frequency.exponentialRampToValueAtTime(1600, t + 2.0);
      const g = ctx.createGain();
      g.gain.value = 0.22;
      o.connect(f).connect(g).connect(bus);
      o.start(t);
      o.stop(t + 3.5);
    }
    for (const at of [0.3, 0.75, 1.3]) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 260;
      nf.Q.value = 2;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.4, t + at);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.14);
      n.connect(nf).connect(ng).connect(this.sfxBus);
      n.start(t + at);
      n.stop(t + at + 0.16);
    }
  }

  startMenuMusic(): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.menuTrack && !this.menuTrack.paused) return;
    if (!this.menuTrack) {
      const el = new Audio('audio/menu.mp3');
      el.loop = true;
      el.preload = 'auto';
      el.onerror = () => {
        // File missing or undecodable — fall back to the synth mix
        this.menuTrack = null;
        this.startSynthMenuMusic();
      };
      this.menuTrack = el;
      // Route through the Web Audio graph (createMediaElementSource may only
      // be called once per element, so both are cached together)
      this.menuTrackSource = this.ctx.createMediaElementSource(el);
      this.menuTrackSource.connect(this.musicBus);
    }
    void this.menuTrack.play().catch(() => {
      // Autoplay refused (no gesture yet) — the next unlock call retries
    });
  }

  private startSynthMenuMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    const ctx = this.ctx;

    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 640;
    muffle.Q.value = 0.4;
    muffle.connect(this.musicBus);

    // Continuous vinyl hiss
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noiseBuffer;
    hiss.loop = true;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'lowpass';
    hissFilter.frequency.value = 1200;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.012;
    hiss.connect(hissFilter).connect(hissGain).connect(this.musicBus);
    hiss.start();

    // Chord progression: Fmaj7 - Am7 - Dm7 - G7 (lo-fi staple)
    const chords = [
      [174.6, 220.0, 261.6, 329.6],
      [220.0, 261.6, 329.6, 392.0],
      [146.8, 174.6, 220.0, 261.6],
      [196.0, 246.9, 293.7, 349.2]
    ];
    const beat = 60 / 72; // seconds per beat
    this.musicStep = 0;

    const tick = () => {
      const t = ctx.currentTime + 0.03;
      const step = this.musicStep % 16; // 4 bars of 4 beats
      const bar = Math.floor(step / 4);

      // Chord pad on beat 1 of each bar
      if (step % 4 === 0) {
        for (const f of chords[bar]) {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004); // tape warble
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.045, t + 0.35);
          g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 3.9);
          osc.connect(g).connect(muffle);
          osc.start(t);
          osc.stop(t + beat * 4);
        }
      }
      // Kick on 1 and 3
      if (step % 2 === 0) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(110, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.1);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.16, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        osc.connect(g).connect(muffle);
        osc.start(t);
        osc.stop(t + 0.25);
      }
      // Muffled snare on 2 and 4
      if (step % 2 === 1) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.05, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        src.connect(f).connect(g).connect(muffle);
        src.start(t, Math.random());
        src.stop(t + 0.2);
      }
      // Occasional vinyl pop
      if (Math.random() < 0.3) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const g = ctx.createGain();
        const pt = t + Math.random() * beat;
        g.gain.setValueAtTime(0.0, pt);
        g.gain.setValueAtTime(0.03, pt + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, pt + 0.02);
        src.connect(g).connect(this.musicBus);
        src.start(pt, Math.random());
        src.stop(pt + 0.03);
      }
      this.musicStep++;
    };

    tick();
    this.musicTimer = window.setInterval(tick, beat * 1000);
    this.musicTeardown = () => {
      try {
        hiss.stop();
      } catch {
        /* already stopped */
      }
      hiss.disconnect();
      hissGain.disconnect();
      muffle.disconnect();
    };
  }

  stopMenuMusic(): void {
    if (this.menuTrack) {
      this.menuTrack.pause();
      this.menuTrack.currentTime = 0;
    }
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicTeardown?.();
    this.musicTeardown = null;
  }

  // ===================================================== Level 8: THE CAR PARK
  //
  // The General, the cars he throws, the engines, and the fight's music. These
  // are bigger than anything indoors and they pile on top of each other, so
  // they share some plumbing the older one-shots don't: place() gives each one
  // its distance level and a little air absorption, every one of them goes
  // through the soft-clipped lot bus, and the big ones send to the lot echo.
  // Distances are metres from the listener (the camera); 0 means "right here".

  private lotIn: GainNode | null = null;
  private echoIn: GainNode | null = null;
  private boss: { timer: number; out: GainNode } | null = null;
  private hallIR: AudioBuffer | null = null;

  /** The soft-clipped bus every Level 8 sound goes through (see softClipCurve). */
  private lotBus(ctx: AudioContext): GainNode {
    if (this.lotIn) return this.lotIn;
    const input = ctx.createGain();
    input.gain.value = 0.5; // the curve's ±1 covers ±2 of signal
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';
    input.connect(clip).connect(this.sfxBus);
    this.lotIn = input;
    return input;
  }

  /**
   * The car park's answer. Outdoors there's no reverb to speak of, but a slab
   * of office block on one side and a row of buildings over the road on the
   * other throw a big noise back as distinct slaps: the facade first, then the
   * far side of the lot, then a dark smear off everything else. That return is
   * most of what makes a crash sound like it happened in a big open space and
   * not inside your headphones. Built once, fed by sends.
   */
  private echoBus(ctx: AudioContext): GainNode {
    if (this.echoIn) return this.echoIn;
    const input = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160; // the ground soaks up the low end; a slap is all mids
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    input.connect(hp).connect(lp);
    const out = ctx.createGain();
    out.connect(this.sfxBus);
    for (const [time, g] of [[0.085, 0.4], [0.21, 0.28], [0.38, 0.2]] as const) {
      const d = ctx.createDelay(1);
      d.delayTime.value = time;
      const dg = ctx.createGain();
      dg.gain.value = g;
      lp.connect(d).connect(dg).connect(out);
    }
    // The smear: one dark feedback loop, each pass duller than the last
    const tail = ctx.createDelay(1);
    tail.delayTime.value = 0.57;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 1300;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    lp.connect(tail);
    tail.connect(dark).connect(fb).connect(tail);
    const tg = ctx.createGain();
    tg.gain.value = 0.22;
    tail.connect(tg).connect(out);
    this.echoIn = input;
    return input;
  }

  /**
   * Where a Level 8 sound comes from. Its own gain (the distance level), then
   * — if it's any way off — a gentle low-pass that closes as the distance
   * grows, because air soaks up treble and a crash across the lot is a thump,
   * not a fizz. Then the lot bus, plus a send to the echo. Returns the node
   * the layers connect into.
   */
  private place(ctx: AudioContext, dist: number, level: number, echo: number, pan = 0): GainNode {
    const out = ctx.createGain();
    out.gain.value = Math.max(0, fin(level, 0));
    let end: AudioNode = out;
    if (dist > 4) {
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = Math.min(16000, 24000 / (1 + dist / 22));
      air.Q.value = 0.5;
      end = end.connect(air);
    }
    if (pan !== 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      end = end.connect(p);
    }
    end.connect(this.lotBus(ctx));
    if (echo > 0) {
      const send = ctx.createGain();
      send.gain.value = echo;
      end.connect(send).connect(this.echoBus(ctx));
    }
    return out;
  }

  /** A distance in metres, cleaned up: finite and not negative. */
  private far(dist: number): number {
    return Math.max(0, fin(dist, 0));
  }

  /**
   * A burst of filtered noise into `dest` — the workhorse under every layer
   * below. Like noise(), but it can be placed in time (`at` seconds from now,
   * or at absolute time `t`), given an attack, and have its filter swept from
   * `f` to `f1` across its length. It loops the buffer, so long rumbles don't
   * run off the end of it.
   */
  private burst(
    dest: AudioNode,
    o: {
      at?: number;
      t?: number;
      D: number;
      type: BiquadFilterType;
      f: number;
      f1?: number;
      q?: number;
      gain: number;
      attack?: number;
      rate?: number;
    }
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = o.t ?? ctx.currentTime + (o.at ?? 0);
    const atk = o.attack ?? 0.003;
    const D = Math.max(o.D, atk + 0.006);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = o.rate ?? 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f, t);
    if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(o.f1, t + D);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + D);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.8);
    src.stop(t + D + 0.03);
  }

  /**
   * One pitched layer: an oscillator with a fast attack and an exponential
   * decay, gliding from `f` to `f1` over `glide` seconds (default: all of it).
   * Every boom and thud below is one of these with a big downward glide —
   * the pitch drop is what makes a thump sound heavy rather than tuned.
   */
  private partial(
    dest: AudioNode,
    o: {
      at?: number;
      t?: number;
      D: number;
      type: OscillatorType;
      f: number;
      f1?: number;
      glide?: number;
      gain: number;
      attack?: number;
    }
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = o.t ?? ctx.currentTime + (o.at ?? 0);
    const atk = o.attack ?? 0.003;
    const D = Math.max(o.D, atk + 0.006);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f1 !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + Math.min(D, o.glide ?? D));
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + D);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + D + 0.03);
  }

  /**
   * Struck sheet steel, `at` seconds from now. The modes come from a table
   * (see PANEL_MODES); the lowest three are doubled a few hertz apart so they
   * beat, which is the shimmer a panel has and a xylophone doesn't, and the
   * higher modes die first, as they do in the real thing. Each strike nudges
   * every mode a little so no two clangs are quite the same.
   */
  private clang(
    dest: AudioNode,
    at: number,
    base: number,
    gain: number,
    len: number,
    modes: readonly (readonly [number, number])[] = PANEL_MODES
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + at;
    modes.forEach(([ratio, amp], i) => {
      const f = base * ratio * (0.985 + Math.random() * 0.03);
      if (f > 15000) return;
      const decay = len / Math.sqrt(ratio);
      const beats = i < 3 ? [0, 2.5 + Math.random() * 4] : [0];
      for (const beat of beats) {
        const o = ctx.createOscillator();
        o.frequency.value = f + beat;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, (gain * amp) / beats.length), t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + decay + 0.03);
      }
    });
  }

  /**
   * Glass falling out of a frame onto tarmac: `n` shards across `spread`
   * seconds, crowded at the start and thinning out, each a short inharmonic
   * chime. The same idea as glassShatter()'s rain, lighter, for car windows.
   */
  private tinkle(dest: AudioNode, at: number, n: number, spread: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    for (let i = 0; i < n; i++) {
      const t = t0 + Math.pow(Math.random(), 0.7) * spread;
      const left = 1 - (t - t0) / (spread * 1.25);
      const base = 2300 + Math.random() * 5200;
      const len = 0.05 + Math.random() * 0.16;
      for (const ratio of [1, 2.76]) {
        if (base * ratio > 16000) continue;
        const o = ctx.createOscillator();
        o.frequency.value = base * ratio;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(
          Math.max(0.0002, (gain / ratio) * left * (0.5 + Math.random() * 0.5)),
          t + 0.001
        );
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + len + 0.03);
      }
    }
  }

  /**
   * Steel folding. A crumple isn't one sound, it's a run of tiny buckles,
   * each a snap of band-limited noise at its own pitch — front-loaded, since
   * most of the metal gives in the first instant — pushed through a drive
   * stage so the run crackles instead of hissing.
   */
  private crumple(
    dest: AudioNode,
    at: number,
    spread: number,
    n: number,
    gain: number,
    lo = 350,
    hi = 2800
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const grit = ctx.createWaveShaper();
    grit.curve = driveCurve(3);
    const post = ctx.createGain();
    post.gain.value = 0.34; // undo the drive's own gain (3 / tanh 3)
    grit.connect(post).connect(dest);
    const span = Math.max(0.01, spread);
    for (let i = 0; i < n; i++) {
      const u = Math.pow(Math.random(), 1.8);
      this.burst(grit, {
        at: at + u * span,
        D: 0.012 + Math.random() * 0.05,
        type: 'bandpass',
        f: lo * Math.pow(hi / lo, Math.random()),
        q: 1.5 + Math.random() * 3,
        gain: gain * (0.5 + Math.random() * 0.5) * (1 - 0.5 * u),
        attack: 0.001,
        rate: 0.6 + Math.random() * 0.9
      });
    }
  }

  /**
   * Stick-slip: steel dragging on steel catches and lets go dozens of times
   * a second, and every let-go rings the panel. A sawtooth at the catch rate
   * gives one sharp edge per catch; two narrow bands ring each edge. Sweeping
   * the rate is what turns a buzz into a creak.
   */
  private creak(dest: AudioNode, at: number, D: number, rate0: number, rate1: number, f: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(rate0, t);
    o.frequency.linearRampToValueAtTime(((rate0 + rate1) / 2) * (0.75 + Math.random() * 0.5), t + D * 0.5);
    o.frequency.linearRampToValueAtTime(rate1, t + D);
    const g = ctx.createGain();
    // A pulse train through a narrow band is quiet for its size: hence the 5
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * 5, t + D * 0.25);
    g.gain.setValueAtTime(gain * 5, t + D * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + D);
    for (const [mul, q, lvl] of [[1, 9, 1], [2.3, 12, 0.45]] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * mul;
      bp.Q.value = q;
      const bg = ctx.createGain();
      bg.gain.value = lvl;
      o.connect(bp).connect(bg).connect(g);
    }
    g.connect(dest);
    o.start(t);
    o.stop(t + D + 0.03);
  }

  /**
   * Loaded steel groaning: two detuned saws, roughened, through a narrow band
   * that wanders as the structure binds and gives — leverStrain()'s groan,
   * scaled up to a car body taking its own weight.
   */
  private metalGroan(dest: AudioNode, at: number, D: number, f: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + D * 0.2);
    env.gain.setValueAtTime(Math.max(0.0002, gain), t + D * 0.65);
    env.gain.exponentialRampToValueAtTime(0.0001, t + D);
    env.connect(dest);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 6;
    band.frequency.setValueCurveAtTime(wander(Math.ceil(D * 16) + 2, 220, 640, 0.55), t, D);
    const bandG = ctx.createGain();
    bandG.gain.value = 1.3;
    band.connect(bandG).connect(env);
    const drive = ctx.createWaveShaper();
    drive.curve = driveCurve(2.2);
    drive.connect(band);
    for (const ff of [f, f * 1.065]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(ff, t);
      o.frequency.linearRampToValueAtTime(ff * 1.3, t + D);
      const og = ctx.createGain();
      og.gain.value = 0.45;
      o.connect(og).connect(drive);
      o.start(t);
      o.stop(t + D + 0.03);
    }
  }

  /**
   * A hubcap spinning down on its rim. It rattles faster and faster as it
   * settles — the same thing a coin does on a table — and then it's flat and
   * still with one last clack. Each cycle of the reversed sawtooth is a hit
   * that decays, which is what the rim landing over and over sounds like.
   */
  private hubcap(dest: AudioNode, at: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const D = 1.0 + Math.random() * 0.6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01);
    env.gain.setValueAtTime(Math.max(0.0002, gain), t + D * 0.5);
    env.gain.exponentialRampToValueAtTime(0.0001, t + D);
    env.connect(dest);
    const gate = ctx.createGain();
    gate.gain.value = 0.5;
    gate.connect(env);
    const rate = ctx.createOscillator();
    rate.type = 'sawtooth';
    rate.frequency.setValueAtTime(4 + Math.random() * 2, t);
    rate.frequency.exponentialRampToValueAtTime(30, t + D);
    const depth = ctx.createGain();
    depth.gain.value = -0.5; // reversed: jump to full, then fall away
    rate.connect(depth).connect(gate.gain);
    rate.start(t);
    rate.stop(t + D + 0.03);
    const f = 1300 + Math.random() * 600;
    for (const [m, l] of [[1, 1], [2.71, 0.4]] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * m;
      const og = ctx.createGain();
      og.gain.value = l;
      o.connect(og).connect(gate);
      o.start(t);
      o.stop(t + D + 0.03);
    }
    this.burst(dest, { at: at + D, D: 0.05, type: 'bandpass', f: 1900, q: 2, gain: gain * 2.2, attack: 0.001 });
    this.partial(dest, { at: at + D, D: 0.12, type: 'triangle', f: f * 0.8, f1: f * 0.7, gain: gain * 0.6, attack: 0.001 });
  }

  /**
   * An engine, `at` seconds from now for `D` seconds, following `rpm` — a list
   * of [seconds from its start, revs] that it ramps between. Returns its output
   * gain, left at silence: the caller draws the level (the ignition cuts, the
   * fade) on it.
   *
   * What an engine actually is, to the ear, is a train of exhaust pulses at
   * the firing rate — revs / 60 × `fires` per revolution (2 for a four, 4 for
   * a V8). So: two sawtooths at the firing rate a few cents apart (cylinders
   * are never quite equal), a square at half of it (the four-pot thrum, the
   * V8's lumpiness), saturated, through a resonant low-pass that opens with
   * the revs — that's the note. Over it, noise chopped at the firing rate by
   * the note itself, through a band that also climbs: the rasp. Under it, an
   * exhaust rumble. `rough` is random cycle-to-cycle unevenness (a rough idle);
   * `lope` is the big V8's amplitude wobble at half crank speed.
   */
  private engine(
    dest: AudioNode,
    o: {
      at: number;
      D: number;
      rpm: readonly (readonly [number, number])[];
      fires: number;
      bright: number;
      rasp: number;
      rough: number;
      sub: number;
      lope?: number;
    }
  ): GainNode {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + o.at;
    const end = t0 + o.D + 0.05;
    const hz = (rpm: number): number => (rpm / 60) * o.fires;
    const follow = (p: AudioParam, mul: number, add = 0, min = 1): void => {
      p.setValueAtTime(Math.max(min, hz(o.rpm[0][1]) * mul + add), t0);
      for (const [k, r] of o.rpm) p.linearRampToValueAtTime(Math.max(min, hz(r) * mul + add), t0 + k);
    };
    const sources: AudioScheduledSourceNode[] = [];

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.connect(dest);

    // The note
    const pre = ctx.createGain();
    pre.gain.value = 0.55;
    const lump = ctx.createGain();
    lump.gain.setValueCurveAtTime(wander(Math.ceil(o.D * 24) + 2, 1 - o.rough, 1), t0, o.D);
    const drive = ctx.createWaveShaper();
    drive.curve = driveCurve(2.2);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 2.5;
    follow(tone.frequency, o.bright, 250, 80);
    pre.connect(lump).connect(drive).connect(tone);
    let noteOut: AudioNode = tone;
    if (o.lope) {
      const lopeG = ctx.createGain();
      lopeG.gain.value = 1 - o.lope;
      const lfo = ctx.createOscillator();
      follow(lfo.frequency, 1 / (2 * o.fires), 0, 0.5); // half crank speed
      const depth = ctx.createGain();
      depth.gain.value = o.lope;
      lfo.connect(depth).connect(lopeG.gain);
      sources.push(lfo);
      noteOut = noteOut.connect(lopeG);
    }
    const noteG = ctx.createGain();
    noteG.gain.value = 0.6; // the drive comes out near full scale
    noteOut.connect(noteG).connect(env);

    const main = ctx.createOscillator();
    main.type = 'sawtooth';
    follow(main.frequency, 1);
    const twin = ctx.createOscillator();
    twin.type = 'sawtooth';
    twin.detune.value = 12 + Math.random() * 8;
    follow(twin.frequency, 1);
    const half = ctx.createOscillator();
    half.type = 'square';
    follow(half.frequency, 0.5);
    const halfG = ctx.createGain();
    halfG.gain.value = o.sub;
    main.connect(pre);
    twin.connect(pre);
    half.connect(halfG).connect(pre);
    sources.push(main, twin, half);

    // The rasp: noise chopped at the firing rate
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    follow(band.frequency, 3.2, 300, 200);
    const chop = ctx.createGain();
    chop.gain.value = 0.35;
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0.65;
    main.connect(chopDepth).connect(chop.gain);
    const raspDrive = ctx.createWaveShaper();
    raspDrive.curve = driveCurve(2.5);
    const raspG = ctx.createGain();
    raspG.gain.value = o.rasp * 0.5;
    n.connect(band).connect(chop).connect(raspDrive).connect(raspG).connect(env);
    // The exhaust rumble, low and broad
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    follow(rumble.frequency, 1.2, 60, 60);
    const rumbleG = ctx.createGain();
    rumbleG.gain.value = 0.5 + o.rasp;
    n.connect(rumble).connect(rumbleG).connect(env);
    sources.push(n);

    for (const s of sources) {
      if (s === n) n.start(t0, Math.random() * 1.5);
      else s.start(t0);
      s.stop(end);
    }
    return env;
  }

  // ------------------------------------------------------------ the General

  /**
   * THE GENERAL ROARS. The same idea as voice() — detuned saws through formant
   * bands — scaled to the size of him: a vocal tract nearly twice a man's
   * length puts the fundamental down around 55–75 Hz and every formant lower,
   * so the "AAH" sits where a man's "OH" would. What makes it a roar and not
   * a long note is the growl: the false folds rattling, which is amplitude
   * modulation at about 22 Hz (and a second, faster rattle so it's rough
   * rather than a tremolo). The pitch climbs as he leans into it and sags as
   * the breath runs out; the jaw opens into the vowel and closes on the way
   * out; breath noise rides the same growl. `strength` below 1 is shorter
   * and smaller. `dist` is optional — it carries across the whole lot.
   */
  giantRoar(strength = 1, dist = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const s = Math.min(1.4, Math.max(0.25, fin(strength, 1)));
    const d = this.far(dist);
    const t = ctx.currentTime;
    const D = 1.5 + 0.9 * s;
    const a = this.atten(d, 120) * 0.55 + 0.45;
    const out = this.place(ctx, d, (0.55 + 0.3 * s) * a, 0.32);
    const f0 = 50 + Math.random() * 8;
    const peak = f0 * (1.3 + 0.12 * s);
    const sources: AudioScheduledSourceNode[] = [];

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.5, t + 0.09); // the bark at the front of it
    env.gain.linearRampToValueAtTime(1, t + D * 0.32); // swelling as his lungs empty into it
    env.gain.setValueAtTime(1, t + D * 0.6);
    env.gain.exponentialRampToValueAtTime(0.22, t + D * 0.86);
    env.gain.exponentialRampToValueAtTime(0.0001, t + D);
    env.connect(out);

    // The growl
    const growl = ctx.createGain();
    growl.gain.value = 0.62;
    growl.connect(env);
    const flutter = ctx.createOscillator();
    flutter.type = 'triangle';
    flutter.frequency.setValueAtTime(19 + Math.random() * 2, t);
    flutter.frequency.linearRampToValueAtTime(23.5, t + D * 0.45);
    flutter.frequency.linearRampToValueAtTime(20, t + D);
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.setValueAtTime(0.16, t);
    flutterDepth.gain.linearRampToValueAtTime(0.34, t + D * 0.4); // rawest at the top of it
    flutterDepth.gain.linearRampToValueAtTime(0.24, t + D);
    flutter.connect(flutterDepth).connect(growl.gain);
    const rattle = ctx.createOscillator();
    rattle.frequency.value = 31 + Math.random() * 3;
    const rattleDepth = ctx.createGain();
    rattleDepth.gain.value = 0.1;
    rattle.connect(rattleDepth).connect(growl.gain);
    sources.push(flutter, rattle);

    // The throat: two saws and a square an octave down, pushed into saturation
    const throat = ctx.createGain();
    throat.gain.value = 0.42;
    const rasp = ctx.createWaveShaper();
    rasp.curve = driveCurve(2.6);
    rasp.oversample = '2x';
    throat.connect(rasp);
    // A voice that size never holds a pitch: a few tens of cents of drift, shared by all three
    const jitter = ctx.createConstantSource();
    jitter.offset.setValueCurveAtTime(wander(Math.ceil(D * 14) + 2, -32, 32, 0.5), t, D);
    sources.push(jitter);
    for (const [type, mul, detune, level] of [
      ['sawtooth', 1, -11, 1],
      ['sawtooth', 1, 9, 1],
      ['square', 0.5, 0, 0.45]
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      o.frequency.setValueAtTime(f0 * mul, t);
      o.frequency.exponentialRampToValueAtTime(peak * mul, t + D * 0.24);
      o.frequency.exponentialRampToValueAtTime(peak * 0.93 * mul, t + D * 0.62);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.8 * mul, t + D);
      jitter.connect(o.detune);
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(throat);
      sources.push(o);
    }

    // His mouth: "RRR-AAAH-rrgh" — [start, open, close, Q, level] for each formant
    for (const [fa, fb, fc, q, level] of [
      [300, 450, 350, 3.2, 1.5],
      [900, 690, 780, 4.5, 1.0],
      [1380, 1300, 1350, 6, 0.55],
      [2450, 2350, 2400, 7, 0.25]
    ] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = q;
      bp.frequency.setValueAtTime(fa, t);
      bp.frequency.exponentialRampToValueAtTime(fb, t + D * 0.3);
      bp.frequency.exponentialRampToValueAtTime(fc, t + D);
      const g = ctx.createGain();
      g.gain.value = level;
      rasp.connect(bp).connect(g).connect(growl);
    }
    // His chest: the fundamental and first few harmonics, which is where the size lives
    const chest = ctx.createBiquadFilter();
    chest.type = 'lowpass';
    chest.frequency.value = 240;
    chest.Q.value = 0.7;
    const chestG = ctx.createGain();
    chestG.gain.value = 0.55;
    rasp.connect(chest).connect(chestG).connect(growl);

    // Breath: front-loaded, through the same growl
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer;
    air.loop = true;
    air.playbackRate.value = 0.7;
    const airBand = ctx.createBiquadFilter();
    airBand.type = 'bandpass';
    airBand.frequency.value = 650;
    airBand.Q.value = 0.6;
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'highpass';
    hiss.frequency.value = 2400;
    const hissG = ctx.createGain();
    hissG.gain.value = 0.25;
    const airG = ctx.createGain();
    airG.gain.setValueAtTime(0.0001, t);
    airG.gain.exponentialRampToValueAtTime(0.55, t + 0.06);
    airG.gain.exponentialRampToValueAtTime(0.3, t + D * 0.5);
    airG.gain.exponentialRampToValueAtTime(0.0001, t + D);
    air.connect(airBand).connect(airG);
    air.connect(hiss).connect(hissG).connect(airG);
    airG.connect(growl);

    for (const src of sources) {
      src.start(t);
      src.stop(t + D + 0.05);
    }
    air.start(t, Math.random() * 1.5);
    air.stop(t + D + 0.05);
  }

  /**
   * A fist on a chest the size of a door. The thump is a sine with a hard
   * pitch drop (70 → 38 Hz: the chest is a drum), there's a hollow knock an
   * octave up and a band of air around 170 Hz — the barrel of him ringing —
   * and the flat slap of a palm on a dress tunic over the top. His medals
   * jingle. `i` alternates the fists: the right is a shade deeper and sits a
   * little to one side. `dist` is optional.
   */
  chestPound(i: number, dist = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const d = this.far(dist);
    const right = Math.abs(Math.round(fin(i, 0))) % 2 === 1;
    const a = this.atten(d, 90) * 0.8 + 0.2;
    const out = this.place(ctx, d, 0.8 * a, 0.22, right ? 0.16 : -0.16);
    const r = Math.random;
    const f = (right ? 67 : 72) * (0.97 + r() * 0.06);
    this.partial(out, { D: 0.42, type: 'sine', f, f1: 38, glide: 0.11, gain: 0.85, attack: 0.004 });
    this.partial(out, { D: 0.16, type: 'triangle', f: f * 2.1, f1: f * 1.1, glide: 0.08, gain: 0.22, attack: 0.003 });
    this.burst(out, { D: 0.26, type: 'bandpass', f: 165 + r() * 30, q: 3.5, gain: 1.2, attack: 0.004, rate: 0.7 });
    this.burst(out, { D: 0.09, type: 'lowpass', f: 420, gain: 0.6, attack: 0.002 });
    // The slap, and the fist's knuckles in it
    this.burst(out, { D: 0.045, type: 'bandpass', f: 1150 + r() * 250, q: 1.1, gain: 0.5, attack: 0.001 });
    this.burst(out, { D: 0.014, type: 'highpass', f: 3000, gain: 0.22, attack: 0.001 });
    // Medals
    for (let k = 0; k < 3; k++) {
      this.partial(out, {
        at: 0.01 + r() * 0.05,
        D: 0.08 + r() * 0.08,
        type: 'sine',
        f: 3600 + r() * 2800,
        gain: 0.02,
        attack: 0.001
      });
    }
  }

  /**
   * One of his feet coming down. It's felt as much as heard: a sine dropping
   * away under 30 Hz, a sub rumble of the ground carrying it, the boot sole's
   * thud in the low mids and, close to, the grit under it. Silent past ~60 m.
   */
  giantStep(dist: number): void {
    if (!this.ctx) return;
    const d = this.far(dist);
    const a = this.atten(d, 60);
    if (a <= 0.01) return;
    const ctx = this.ctx;
    const out = this.place(ctx, d, 0.85 * a, 0.12);
    const r = Math.random;
    this.partial(out, { D: 0.5, type: 'sine', f: 54 + r() * 10, f1: 27, glide: 0.3, gain: 0.75, attack: 0.006 });
    this.burst(out, { D: 0.32, type: 'lowpass', f: 170, gain: 1.0, attack: 0.005, rate: 0.6 });
    this.burst(out, { D: 0.75, type: 'lowpass', f: 90, gain: 1.4, attack: 0.03, rate: 0.5 });
    this.burst(out, { D: 0.11, type: 'bandpass', f: 320 + r() * 80, q: 1.2, gain: 0.55, attack: 0.002 });
    if (d < 25) this.burst(out, { at: 0.01, D: 0.06, type: 'highpass', f: 2200, gain: 0.12 * (1 - d / 25) + 0.01 });
  }

  /**
   * A wreck torn off the pile. It comes away from the one under it with a
   * crunch and a heavy clunk, then the shell groans and creaks as it takes
   * its own weight in two hands, what's left of the glass lets go, and bits
   * of trim drop back onto the pile. ~1.1 s. `dist` is optional.
   */
  carLift(dist = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const d = this.far(dist);
    const a = this.atten(d, 90) * 0.8 + 0.2;
    const out = this.place(ctx, d, 0.85 * a, 0.18);
    const r = Math.random;
    // Torn free
    this.crumple(out, 0, 0.16, 8, 0.6, 500, 2600);
    this.partial(out, { D: 0.28, type: 'sine', f: 120, f1: 50, glide: 0.18, gain: 0.5, attack: 0.004 });
    this.burst(out, { D: 0.2, type: 'lowpass', f: 600, gain: 0.55 });
    this.clang(out, 0.02, 150 + r() * 60, 0.16, 0.5);
    this.burst(out, { at: 0.02, D: 0.4, type: 'bandpass', f: 2500, f1: 1100, q: 3, gain: 0.25, attack: 0.02 }); // steel dragging off steel
    // Taking the weight
    this.metalGroan(out, 0.05, 1.05, 52 + r() * 6, 0.55);
    this.creak(out, 0.1, 0.45, 26, 70, 820 + r() * 300, 0.5);
    this.creak(out, 0.55, 0.4, 60, 34, 1250 + r() * 400, 0.35);
    this.creak(out, 0.82, 0.25, 45, 90, 640, 0.3);
    // The glass
    this.tinkle(out, 0.25 + r() * 0.15, 5, 0.25, 0.05);
    this.tinkle(out, 0.62 + r() * 0.2, 4, 0.3, 0.04);
    // Trim dropping off it
    for (let k = 0; k < 3; k++) {
      const at = 0.3 + r() * 0.7;
      this.partial(out, { at, D: 0.12, type: 'triangle', f: 180 + r() * 220, f1: 90, gain: 0.12 });
      this.burst(out, { at, D: 0.05, type: 'bandpass', f: 1600, q: 2, gain: 0.15, attack: 0.001 });
    }
  }

  /**
   * A car going over end over end, close by. A tumbling body beats the air
   * rather than parting it, so the whole whoosh flutters at the tumble rate;
   * the band sweeps up as it comes and down as it goes past, a lowpassed
   * weight of air sits under it, and the empty window frames howl faintly.
   * ~0.8 s; inaudible past ~45 m.
   */
  carWhoosh(dist: number): void {
    if (!this.ctx) return;
    const d = this.far(dist);
    const a = this.atten(d, 45);
    if (a <= 0.02) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const D = 0.75 + Math.random() * 0.1;
    const out = this.place(ctx, d, 0.9 * a, 0.08);
    const flutter = ctx.createGain();
    flutter.gain.value = 0.6;
    flutter.connect(out);
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 5.5 + Math.random() * 3;
    const depth = ctx.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(flutter.gain);
    lfo.start(t);
    lfo.stop(t + D + 0.05);
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer;
    air.loop = true;
    // [band start, peak, end, Q, level]: the rush, the weight under it, the howl in the frames
    for (const [f0, f1, f2, q, level] of [
      [180, 520, 200, 1.4, 0.9],
      [90, 150, 80, 0.8, 1.6],
      [300, 420, 280, 8, 0.5]
    ] as const) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = q;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + D * 0.45);
      f.frequency.exponentialRampToValueAtTime(f2, t + D);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + D * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + D);
      air.connect(f).connect(g).connect(flutter);
    }
    air.start(t, Math.random() * 1.5);
    air.stop(t + D + 0.05);
  }

  /**
   * A car landing on tarmac — the sound the whole fight is built on, so it's
   * layered and randomised to the hilt; no two in a row are the same. The
   * contact crack and a low boom (a ton and a half of car meeting the ground),
   * the suspension bottoming out, then the body crumpling in two waves (the
   * first corner, then the rest of it coming down a beat later) with a
   * sustained tearing crunch, panels ringing at inharmonic ratios, the
   * windows blowing out into a rain of glass, trim and a wing mirror
   * bouncing off the tarmac, sometimes a hubcap spinning down, and for a
   * heavy landing the ground carrying it. Audible right across the lot.
   * `heavy` false is a lighter knock — a car shoved off another, a bounce.
   */
  carCrash(dist: number, heavy = true): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const d = this.far(dist);
    const a = this.atten(d, 130) * 0.85 + 0.15;
    const w = heavy ? 1 : 0.6;
    const out = this.place(ctx, d, 0.95 * a, 0.26);
    const r = Math.random;
    // The hit
    this.burst(out, { D: 0.035, type: 'highpass', f: 1400 + r() * 800, gain: 0.5 * w, attack: 0.001 });
    this.partial(out, { D: 0.6 + 0.3 * w, type: 'sine', f: 64 + r() * 16, f1: 27, glide: 0.45, gain: 0.8 * w });
    this.partial(out, { D: 0.22, type: 'triangle', f: 130 + r() * 40, f1: 60, gain: 0.3 * w, attack: 0.002 });
    this.burst(out, { D: 0.32, type: 'lowpass', f: 420 + r() * 160, gain: 0.85 * w });
    // The crumple, in two waves
    this.crumple(out, 0, 0.12, 9 + Math.floor(r() * 5), 0.75 * w, 380, 2600);
    const second = 0.07 + r() * 0.12;
    this.crumple(out, second, 0.25 + r() * 0.15, 8 + Math.floor(r() * 6), 0.55 * w, 300, 2000);
    this.burst(out, {
      at: second,
      D: 0.3,
      type: 'bandpass',
      f: 1600 + r() * 600,
      f1: 450,
      q: 1.6,
      gain: 0.5 * w,
      attack: 0.01
    });
    this.partial(out, { at: second, D: 0.3, type: 'sine', f: 95 + r() * 25, f1: 40, gain: 0.45 * w, attack: 0.004 });
    // Roof, a door, the bonnet
    this.clang(out, 0.004, 150 + r() * 140, 0.2 * w, 0.55 + r() * 0.4);
    this.clang(out, second + 0.02, 260 + r() * 220, 0.12 * w, 0.4 + r() * 0.3);
    // The windows
    if (heavy || r() < 0.5) {
      this.burst(out, { at: 0.008, D: 0.06, type: 'highpass', f: 2600, gain: 0.35 * w, attack: 0.001 });
      this.burst(out, { at: 0.01, D: 0.12, type: 'bandpass', f: 5000, q: 1.3, gain: 0.3 * w, attack: 0.001 });
      for (let k = 0; k < 8; k++) {
        this.burst(out, {
          at: 0.012 + r() * 0.16,
          D: 0.015 + r() * 0.025,
          type: 'bandpass',
          f: 4000 + r() * 5000,
          q: 6,
          gain: 0.3 * w,
          attack: 0.001
        });
      }
      this.tinkle(out, 0.06, heavy ? 16 : 8, 0.9 + r() * 0.3, 0.06 * w);
    }
    // Settling: trim and bits of bumper bouncing off the tarmac
    const bits = Math.floor(3 + r() * 4);
    for (let k = 0; k < bits; k++) {
      const at = 0.25 + r() * 0.9;
      this.partial(out, { at, D: 0.1 + r() * 0.08, type: 'triangle', f: 160 + r() * 340, f1: 80 + r() * 40, gain: 0.12 * w });
      this.burst(out, { at, D: 0.04, type: 'bandpass', f: 1200 + r() * 1800, q: 2, gain: 0.18 * w, attack: 0.001 });
    }
    if (r() < 0.3) this.hubcap(out, 0.3 + r() * 0.4, 0.09 * w);
    if (heavy) this.burst(out, { D: 1.2, type: 'lowpass', f: 110, gain: 1.3, attack: 0.01, rate: 0.5 });
  }

  /**
   * Steel grinding along tarmac — a car shoved or bowled, skidding on its
   * roof. Grinding is never steady (the metal bites, skips, bites), so the
   * whole thing goes through a random gain curve; a gritty bright band for
   * the scrape itself, a duller one for the panel, a thin wavering squeal of
   * metal and a fizz of sparks on top. ~0.6 s.
   */
  carScrape(dist: number): void {
    if (!this.ctx) return;
    const d = this.far(dist);
    const a = this.atten(d, 70);
    if (a <= 0.02) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const D = 0.55 + Math.random() * 0.15;
    const out = this.place(ctx, d, 0.8 * a, 0.12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.8, t + D * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + D);
    env.connect(out);
    const judder = ctx.createGain();
    judder.gain.setValueCurveAtTime(wander(Math.ceil(D * 40) + 2, 0.35, 1), t, D);
    judder.connect(env);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    // The scrape: bright, gritty, sliding down as the car slows
    const scrape = ctx.createBiquadFilter();
    scrape.type = 'bandpass';
    scrape.Q.value = 1.8;
    scrape.frequency.setValueAtTime(2400 + Math.random() * 600, t);
    scrape.frequency.exponentialRampToValueAtTime(1500, t + D);
    const grit = ctx.createWaveShaper();
    grit.curve = driveCurve(2.5);
    const gritG = ctx.createGain();
    gritG.gain.value = 0.38;
    n.connect(scrape).connect(grit).connect(gritG).connect(judder);
    // The panel it's happening to
    const panel = ctx.createBiquadFilter();
    panel.type = 'bandpass';
    panel.frequency.value = 650;
    panel.Q.value = 1.2;
    const panelG = ctx.createGain();
    panelG.gain.value = 0.7;
    n.connect(panel).connect(panelG).connect(judder);
    // Sparks
    const fizz = ctx.createBiquadFilter();
    fizz.type = 'highpass';
    fizz.frequency.value = 5500;
    const fizzG = ctx.createGain();
    fizzG.gain.value = 0.15;
    n.connect(fizz).connect(fizzG).connect(judder);
    // The squeal
    const sq = ctx.createOscillator();
    sq.type = 'triangle';
    sq.frequency.setValueCurveAtTime(wander(Math.ceil(D * 12) + 2, 2500, 3400, 0.5), t, D);
    const sqG = ctx.createGain();
    sqG.gain.value = 0.04;
    sq.connect(sqG).connect(judder);
    n.start(t, Math.random() * 1.5);
    n.stop(t + D + 0.05);
    sq.start(t);
    sq.stop(t + D + 0.05);
  }

  /**
   * A car alarm going off, and staying off: whoops, the hi-lo, a fast yelp,
   * the horn honking, a pulsing beep — round and round, starting at a random
   * point in the cycle and a few per cent off pitch so a row of them don't
   * play in lockstep. It runs until the returned stop() or for 12 s, which
   * is how long anyone can stand one. A cheap horn speaker: all mids, no bass,
   * a bit of buzz. Quieter, and duller, with distance.
   */
  carAlarm(dist: number): { stop(): void } {
    const idle = { stop: (): void => {} };
    if (!this.ctx) return idle;
    const ctx = this.ctx;
    const d = this.far(dist);
    const t = ctx.currentTime;
    const LIFE = 12;
    const end = t + LIFE;
    const a = this.atten(d, 110) * 0.8 + 0.2;
    const out = this.place(ctx, d, 0.09 * a, 0.14);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.02);
    env.gain.setValueAtTime(1, end - 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(out);
    const speaker = ctx.createBiquadFilter();
    speaker.type = 'bandpass';
    speaker.frequency.value = 1500;
    speaker.Q.value = 0.6;
    const buzz = ctx.createWaveShaper();
    buzz.curve = driveCurve(1.6);
    buzz.connect(speaker).connect(env);

    const p = 0.97 + Math.random() * 0.06;
    const siren = ctx.createOscillator();
    siren.type = 'square';
    const sirenG = ctx.createGain();
    siren.connect(sirenG).connect(buzz);
    const hornG = ctx.createGain();
    hornG.connect(buzz);
    const horns: OscillatorNode[] = [];
    for (const f of [405, 510]) {
      const h = ctx.createOscillator();
      h.type = 'square';
      h.frequency.value = f * p;
      const hg = ctx.createGain();
      hg.gain.value = 0.55;
      h.connect(hg).connect(hornG);
      horns.push(h);
    }

    // Gates are tiny ramps, not jumps, so the pattern changes don't click
    const F = siren.frequency;
    let sirenOn = 1;
    let hornOn = 0;
    const gate = (g: AudioParam, from: number, to: number, at: number): void => {
      g.setValueAtTime(from, at);
      g.linearRampToValueAtTime(to, at + 0.005);
    };
    sirenG.gain.setValueAtTime(1, t);
    hornG.gain.setValueAtTime(0, t);
    F.setValueAtTime(900 * p, t);
    const setSiren = (on: number, at: number): void => {
      if (on !== sirenOn) gate(sirenG.gain, sirenOn, on, at);
      sirenOn = on;
    };
    const setHorn = (on: number, at: number): void => {
      if (on !== hornOn) gate(hornG.gain, hornOn, on, at);
      hornOn = on;
    };
    const patterns: ((s: number) => number)[] = [
      (s) => {
        // Whoop: a rising sweep, dropped and swept again
        setSiren(1, s);
        for (let k = 0; k < 4; k++, s += 0.42) {
          F.setValueAtTime(520 * p, s);
          F.exponentialRampToValueAtTime(1750 * p, s + 0.36);
        }
        return s;
      },
      (s) => {
        // Hi-lo
        setSiren(1, s);
        for (let k = 0; k < 4; k++, s += 0.44) {
          F.setValueAtTime(1480 * p, s);
          F.setValueAtTime(980 * p, s + 0.22);
        }
        return s;
      },
      (s) => {
        // Yelp: a fast warble
        setSiren(1, s);
        F.setValueAtTime(820 * p, s);
        const stop = s + 1.8;
        for (; s < stop; s += 0.14) {
          F.linearRampToValueAtTime(1650 * p, s + 0.07);
          F.linearRampToValueAtTime(820 * p, s + 0.14);
        }
        return s;
      },
      (s) => {
        // The horn
        setSiren(0, s);
        for (let k = 0; k < 3; k++, s += 0.55) {
          setHorn(1, s + 0.01);
          setHorn(0, s + 0.33);
        }
        return s;
      },
      (s) => {
        // A pulsing beep
        F.setValueAtTime(2000 * p, s);
        for (let k = 0; k < 8; k++, s += 0.18) {
          setSiren(1, s);
          setSiren(0, s + 0.09);
        }
        return s;
      }
    ];
    let s = t + 0.01;
    let k = Math.floor(Math.random() * patterns.length);
    while (s < end) {
      s = patterns[k % patterns.length](s);
      k++;
    }
    const sources = [siren, ...horns];
    for (const o of sources) {
      o.start(t);
      o.stop(end + 0.05);
    }

    let stopped = false;
    return {
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        if (now >= end) return;
        env.gain.cancelScheduledValues(now);
        env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        for (const o of sources) {
          try {
            o.stop(now + 0.15);
          } catch {
            /* already stopped */
          }
        }
      }
    };
  }

  /**
   * Tyres losing grip, for `seconds`. A squeal is rubber stick-slipping
   * against the road fast enough to sing: a tone that wanders between about
   * 900 and 1600 Hz as the load changes (with a quicker shake on top), a
   * harsher partial an octave up, and the hiss of the rubber under it, all
   * chattering at the stick-slip rate. It sags in pitch at the end as the
   * grip comes back.
   */
  tyreSqueal(seconds: number, dist = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const d = this.far(dist);
    const D = Math.max(0.2, fin(seconds, 0.2));
    const t = ctx.currentTime;
    const a = this.atten(d, 130) * 0.85 + 0.15;
    const out = this.place(ctx, d, 0.85 * a, 0.16);
    const rel = Math.min(0.3, D * 0.3);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + Math.min(0.06, D * 0.2));
    env.gain.setValueAtTime(1, t + D - rel);
    env.gain.exponentialRampToValueAtTime(0.0001, t + D);
    env.connect(out);
    const chatter = ctx.createGain();
    chatter.gain.value = 0.75;
    chatter.connect(env);
    const chat = ctx.createOscillator();
    chat.frequency.value = 17 + Math.random() * 8;
    const chatDepth = ctx.createGain();
    chatDepth.gain.value = 0.25;
    chat.connect(chatDepth).connect(chatter.gain);

    // The tone
    const base = 1200 * (0.95 + Math.random() * 0.1);
    const pitch = ctx.createConstantSource(); // cents
    pitch.offset.setValueCurveAtTime(wander(Math.ceil(D * 5) + 2, -420, 380, 0.6), t, D);
    const shake = ctx.createOscillator();
    shake.frequency.value = 9 + Math.random() * 4;
    const shakeG = ctx.createGain();
    shakeG.gain.value = 30;
    shake.connect(shakeG);
    const toneBus = ctx.createGain();
    const edge = ctx.createWaveShaper();
    edge.curve = driveCurve(1.5);
    const toneBand = ctx.createBiquadFilter();
    toneBand.type = 'bandpass';
    toneBand.frequency.value = 1350;
    toneBand.Q.value = 0.8;
    const toneG = ctx.createGain();
    toneG.gain.value = 0.18;
    toneBus.connect(edge).connect(toneBand).connect(toneG).connect(chatter);
    const oscs: OscillatorNode[] = [];
    for (const [type, mul, level] of [['triangle', 1, 1], ['sawtooth', 2.01, 0.25]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(base * mul, t);
      o.frequency.setValueAtTime(base * mul, t + D - rel);
      o.frequency.linearRampToValueAtTime(base * mul * 0.85, t + D);
      pitch.connect(o.detune);
      shakeG.connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(toneBus);
      oscs.push(o);
    }
    // The rubber hiss: a bright band and a rougher low one
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    for (const [f, q, level] of [[2300, 1.3, 0.35], [900, 2.5, 0.3]] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      n.connect(bp).connect(g).connect(chatter);
    }
    for (const src of [chat, pitch, shake, ...oscs]) {
      src.start(t);
      src.stop(t + D + 0.05);
    }
    n.start(t, Math.random() * 1.5);
    n.stop(t + D + 0.05);
  }

  /**
   * Turning the key in the Civic. The solenoid clacks the pinion into the
   * flywheel, then the starter drags the engine round: each compression
   * stroke loads the motor so its whirr sags in pitch and gets louder, then
   * lets it go — that rhythm (rur-rur-rur) is the sound. `catches`: the last
   * strokes quicken, a couple of misfires, and it fires — revs flare and
   * settle into a lumpy idle that dies away over ~2 s (play engineRev() over
   * it). Not: the battery sags, strokes drag slower, one cough where it nearly
   * goes, and the starter winds down to nothing. Either way ~1.1 s of crank.
   */
  engineCrank(catches: boolean): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.place(ctx, 0, 0.85, 0.08);
    const r = Math.random;

    // The key
    this.burst(out, { D: 0.018, type: 'bandpass', f: 2600, q: 2, gain: 0.4, attack: 0.001 });
    this.partial(out, { D: 0.04, type: 'square', f: 760, f1: 240, gain: 0.07 });
    this.burst(out, { at: 0.035, D: 0.07, type: 'lowpass', f: 650, gain: 0.55 });

    // The strokes
    const strokes: number[] = [];
    let x = 0.07;
    let p = 0.18 + r() * 0.02;
    const until = catches ? 1.02 : 1.12;
    while (x < until) {
      strokes.push(x);
      x += p;
      p *= catches ? 0.97 : 1.07;
    }
    const done = x; // where the last stroke ends

    // The starter motor: [time, motor Hz, load]
    const keys: [number, number, number][] = [[0.07, 60, 0.5]];
    let hi = 178;
    let lo = 122;
    strokes.forEach((s0, k) => {
      const len = (k + 1 < strokes.length ? strokes[k + 1] : done) - s0;
      keys.push([s0 + len * 0.3, hi, 0.6], [s0 + len * 0.78, lo, 1]);
      // Air pushed out past the throttle on each stroke
      this.burst(out, { at: s0 + len * 0.74, D: 0.12, type: 'lowpass', f: 480, gain: 0.45, attack: 0.01 });
      this.partial(out, { at: s0 + len * 0.74, D: 0.1, type: 'sine', f: 72, f1: 46, gain: 0.22, attack: 0.005 });
      if (!catches) {
        hi *= 0.95;
        lo *= 0.92;
      }
    });
    if (catches) {
      // It fires and spins the starter past itself before the pinion lets go
      keys.push([done + 0.06, 285, 0.8], [done + 0.16, 300, 0.0001]);
    } else {
      // One last drag round, and it winds down to nothing
      keys.push([done + 0.12, lo * 1.05, 0.9], [done + 0.42, 40, 0.0001]);
    }
    const motorEnd = t + keys[keys.length - 1][0] + 0.05;
    const motor = ctx.createOscillator();
    motor.type = 'sawtooth';
    const whine = ctx.createOscillator(); // the gears
    const load = ctx.createGain();
    motor.frequency.setValueAtTime(keys[0][1], t);
    whine.frequency.setValueAtTime(keys[0][1] * 5.2, t);
    load.gain.setValueAtTime(0, t);
    for (const [at, f, l] of keys) {
      motor.frequency.linearRampToValueAtTime(f, t + at);
      whine.frequency.linearRampToValueAtTime(f * 5.2, t + at);
      load.gain.linearRampToValueAtTime(l, t + at);
    }
    load.connect(out);
    const drive = ctx.createWaveShaper();
    drive.curve = driveCurve(1.8);
    const body = ctx.createBiquadFilter();
    body.type = 'bandpass';
    body.frequency.value = 480;
    body.Q.value = 0.7;
    const bodyG = ctx.createGain();
    bodyG.gain.value = 0.5;
    motor.connect(drive).connect(body).connect(bodyG).connect(load);
    const rur = ctx.createBiquadFilter();
    rur.type = 'lowpass';
    rur.frequency.value = 260;
    const rurG = ctx.createGain();
    rurG.gain.value = 0.35;
    motor.connect(rur).connect(rurG).connect(load);
    const whineG = ctx.createGain();
    whineG.gain.value = 0.04;
    whine.connect(whineG).connect(load);
    const brushes = ctx.createBufferSource();
    brushes.buffer = this.noiseBuffer;
    brushes.loop = true;
    const brushF = ctx.createBiquadFilter();
    brushF.type = 'bandpass';
    brushF.frequency.value = 3200;
    brushF.Q.value = 1.5;
    const brushG = ctx.createGain();
    brushG.gain.value = 0.08;
    brushes.connect(brushF).connect(brushG).connect(load);
    for (const src of [motor, whine]) {
      src.start(t);
      src.stop(motorEnd);
    }
    brushes.start(t, Math.random() * 1.5);
    brushes.stop(motorEnd);

    if (catches) {
      // Misfires, then it goes
      for (const at of [done - 0.22, done - 0.07]) {
        this.burst(out, { at, D: 0.05, type: 'lowpass', f: 1000, gain: 0.65, attack: 0.001 });
        this.partial(out, { at, D: 0.1, type: 'sine', f: 105, f1: 45, gain: 0.35 });
      }
      const c = done - 0.02;
      const env = this.engine(out, {
        at: c,
        D: 2.3,
        rpm: [[0, 300], [0.1, 1400], [0.3, 2600], [0.6, 1300], [0.95, 900], [1.4, 830], [2.3, 800]],
        fires: 2,
        bright: 5,
        rasp: 0.5,
        rough: 0.55,
        sub: 0.35
      });
      const g = env.gain;
      const T = t + c;
      g.exponentialRampToValueAtTime(0.26, T + 0.04);
      g.linearRampToValueAtTime(0.32, T + 0.3);
      g.linearRampToValueAtTime(0.2, T + 0.9);
      g.setValueAtTime(0.2, T + 1.5);
      g.exponentialRampToValueAtTime(0.0001, T + 2.3);
      // A cough of unburnt fuel out of the exhaust as it catches
      this.burst(out, { at: c, D: 0.28, type: 'lowpass', f: 380, gain: 0.7, attack: 0.01 });
    } else {
      // It nearly goes: one cough and a sputter, then nothing
      const at = strokes[Math.min(3, strokes.length - 1)] + 0.1;
      this.burst(out, { at, D: 0.09, type: 'lowpass', f: 850, gain: 0.7, attack: 0.001 });
      this.partial(out, { at, D: 0.18, type: 'sine', f: 88, f1: 38, gain: 0.42 });
      this.burst(out, { at, D: 0.05, type: 'bandpass', f: 1500, q: 1.5, gain: 0.25, attack: 0.001 });
      this.burst(out, { at: at + 0.09, D: 0.06, type: 'lowpass', f: 700, gain: 0.35, attack: 0.001 });
      // Key back
      this.burst(out, { at: done + 0.5, D: 0.012, type: 'bandpass', f: 2400, q: 2, gain: 0.2, attack: 0.001 });
    }
  }

  /**
   * The Civic screaming. A small four with nothing to push spins up hard —
   * idle to the limiter in half a second — and then the limiter stutters (the
   * ECU cutting the spark, again and again), the revs hang just off it,
   * wavering, while the front tyres claw and slip, and if there's time left
   * it bites and pulls through the gears: each change a lift, a drop of
   * revs and a climb. Lets off over the last moment. `seconds` is the whole
   * thing, once — not a per-frame call.
   */
  engineRev(seconds: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const D = Math.max(1, fin(seconds, 1));
    const t = ctx.currentTime;
    const out = this.place(ctx, 0, 0.85, 0.14);
    const rel = Math.min(0.4, D * 0.25);
    const hold = D - rel;
    const rpm: [number, number][] = [];
    const key = (at: number, r: number): void => {
      const last = rpm.length ? rpm[rpm.length - 1][0] : -1;
      if (at > last + 0.002 && at <= D) rpm.push([at, r]);
    };
    const cuts: [number, number][] = []; // [start, length] of each ignition cut
    // Foot to the floor
    key(0, 950);
    key(0.1, 1600);
    key(0.24, 3500);
    key(0.38, 5500);
    key(0.5, 6900);
    // The limiter
    let x = 0.5;
    for (let k = 0; k < 5 && x + 0.07 < hold; k++) {
      cuts.push([x, 0.035]);
      key(x + 0.035, 6450);
      key(x + 0.07, 6900);
      x += 0.07;
    }
    // Wheelspin
    const spinEnd = Math.min(hold, 1.95);
    while (x + 0.12 < spinEnd) {
      x += 0.12 + Math.random() * 0.1;
      key(Math.min(x, spinEnd), 6100 + Math.random() * 650);
    }
    // It bites, and goes
    if (hold - spinEnd > 0.5) {
      let g = spinEnd + 0.18;
      key(g, 5200);
      let top = 6800;
      for (;;) {
        const from = rpm[rpm.length - 1][1];
        const peakAt = g + 1.05;
        if (peakAt + 0.12 > hold) {
          key(hold, from + (top - from) * Math.min(1, (hold - g) / 1.05));
          break;
        }
        key(peakAt, top);
        cuts.push([peakAt, 0.09]);
        key(peakAt + 0.12, top - 2200);
        g = peakAt + 0.12;
        top -= 120;
      }
    }
    key(D, rpm[rpm.length - 1][1] * 0.82);

    const env = this.engine(out, { at: 0, D, rpm, fires: 2, bright: 7, rasp: 0.45, rough: 0.2, sub: 0.3 });
    const L = 0.5;
    const g = env.gain;
    g.exponentialRampToValueAtTime(L * 0.7, t + 0.04);
    g.linearRampToValueAtTime(L, t + 0.5);
    for (const [c0, len] of cuts) {
      const c = t + c0;
      g.setValueAtTime(L, c);
      g.linearRampToValueAtTime(L * 0.28, c + 0.008);
      g.setValueAtTime(L * 0.28, c + len - 0.008);
      g.linearRampToValueAtTime(L, c + len);
    }
    g.setValueAtTime(L, t + hold);
    g.exponentialRampToValueAtTime(0.0001, t + D);
  }

  /**
   * The boss's big saloon pulling away hard and going. A V8 — four pulses a
   * revolution, the lumpy half-order and the lope that make it burble — with
   * a bark as he floors it, the clutch biting and dragging the revs down,
   * then first gear pulled long and every change a lift with a pop out of the
   * exhaust. Over `seconds` it goes away from you: the level falls, the
   * treble goes first, and everything slides a little flat (the Doppler
   * shift of something receding). Call it as the car moves off.
   */
  bigEngineDrive(seconds: number, dist = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const d = this.far(dist);
    const D = Math.max(1.5, fin(seconds, 1.5));
    const t = ctx.currentTime;
    const a = this.atten(d, 130) * 0.8 + 0.2;
    const out = this.place(ctx, d, 0.9 * a, 0.22);
    const away = ctx.createBiquadFilter();
    away.type = 'lowpass';
    away.Q.value = 0.5;
    away.frequency.setValueAtTime(7000, t);
    away.frequency.setValueAtTime(7000, t + D * 0.25);
    away.frequency.exponentialRampToValueAtTime(650, t + D);
    const fade = ctx.createGain();
    fade.gain.setValueAtTime(1, t);
    fade.gain.setValueAtTime(1, t + D * 0.28);
    fade.gain.exponentialRampToValueAtTime(0.05, t + D * 0.88);
    fade.gain.exponentialRampToValueAtTime(0.0001, t + D);
    away.connect(fade).connect(out);

    const rpm: [number, number][] = [];
    const key = (at: number, r: number): void => {
      const last = rpm.length ? rpm[rpm.length - 1][0] : -1;
      if (at > last + 0.002 && at <= D) rpm.push([at, r]);
    };
    const cuts: number[] = [];
    key(0, 1100);
    key(0.18, 3300); // the bark
    key(0.32, 2800); // the clutch biting
    let g = 0.32;
    let climb = 1.25;
    let top = 5400;
    while (g < D) {
      const from = rpm[rpm.length - 1][1];
      const peakAt = g + climb;
      if (peakAt >= D) {
        key(D, from + (top - from) * ((D - g) / climb));
        break;
      }
      key(peakAt, top);
      cuts.push(peakAt);
      key(peakAt + 0.14, top - 1900);
      g = peakAt + 0.14;
      climb *= 1.25; // taller gears take longer
      top += 100;
    }
    const sag = (at: number): number => 1 - 0.07 * Math.min(1, at / D);
    const keys = rpm.map(([at, r]) => [at, r * sag(at)] as const);

    const env = this.engine(away, { at: 0, D, rpm: keys, fires: 4, bright: 6, rasp: 0.35, rough: 0.3, sub: 0.5, lope: 0.3 });
    const L = 0.42;
    const eg = env.gain;
    eg.exponentialRampToValueAtTime(L, t + 0.05);
    for (const c0 of cuts) {
      const c = t + c0;
      if (c0 + 0.14 > D - 0.06) break;
      eg.setValueAtTime(L, c);
      eg.linearRampToValueAtTime(L * 0.35, c + 0.012);
      eg.setValueAtTime(L * 0.35, c + 0.1);
      eg.linearRampToValueAtTime(L, c + 0.14);
      this.burst(away, { at: c0 + 0.02, D: 0.05, type: 'lowpass', f: 800, gain: 0.5, attack: 0.001 }); // the pop on the lift
    }
    eg.setValueAtTime(L, t + D - 0.06);
    eg.linearRampToValueAtTime(0.0001, t + D);
  }

  /**
   * A car door. Opening: the handle's clack, the latch letting go of the
   * striker a beat later with a little ring of its spring, the rubber seal
   * unsticking, a short dry creak of hinges and the check strap's detent.
   * Shutting: the slam — a big flat panel full of air, so it's mostly a
   * thump and the whump of the cabin pressure — with the latch biting, the
   * panel's short ring (the trim damps it) and the window rattling in its
   * channel.
   */
  carDoor(open: boolean, dist = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const d = this.far(dist);
    const a = this.atten(d, 70) * 0.88 + 0.12;
    const out = this.place(ctx, d, 0.85 * a, 0.12);
    const r = Math.random;
    if (open) {
      this.burst(out, { D: 0.012, type: 'bandpass', f: 2400 + r() * 400, q: 2.5, gain: 0.45, attack: 0.001 });
      this.partial(out, { D: 0.03, type: 'square', f: 1100, f1: 500, gain: 0.05 });
      this.burst(out, { at: 0.055, D: 0.018, type: 'bandpass', f: 1700, q: 2, gain: 0.55, attack: 0.001 });
      this.burst(out, { at: 0.055, D: 0.06, type: 'lowpass', f: 700, gain: 0.45 });
      this.clang(out, 0.056, 900 + r() * 200, 0.03, 0.12);
      this.burst(out, { at: 0.08, D: 0.07, type: 'lowpass', f: 380, gain: 0.5, attack: 0.008 });
      this.creak(out, 0.12, 0.32, 38, 26, 1400 + r() * 300, 0.12);
      this.burst(out, { at: 0.42, D: 0.05, type: 'bandpass', f: 600, q: 1.5, gain: 0.35 });
      this.partial(out, { at: 0.42, D: 0.06, type: 'triangle', f: 260, f1: 140, gain: 0.08 });
    } else {
      this.partial(out, { D: 0.22, type: 'sine', f: 96 + r() * 14, f1: 46, glide: 0.14, gain: 0.7 });
      this.burst(out, { D: 0.14, type: 'lowpass', f: 520, gain: 0.8 });
      this.burst(out, { D: 0.2, type: 'lowpass', f: 140, gain: 1.0, attack: 0.005 });
      this.burst(out, { at: 0.004, D: 0.04, type: 'bandpass', f: 1500 + r() * 300, q: 1.8, gain: 0.5, attack: 0.001 });
      this.burst(out, { D: 0.012, type: 'highpass', f: 3000, gain: 0.18, attack: 0.001 });
      this.clang(out, 0.002, 210 + r() * 80, 0.07, 0.25);
      this.burst(out, { at: 0.01, D: 0.07, type: 'bandpass', f: 4200, q: 4, gain: 0.12 });
    }
  }

  /**
   * His foot slammed into the ground. The tarmac cracks under the heel, a
   * boom drops away to nothing, a push of air rolls out past you (a low
   * whump sweeping down), the ground carries a sub rumble a long way, and
   * grit and stones patter back down while the parked cars nearby rattle on
   * their springs.
   */
  stomp(dist: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const d = this.far(dist);
    const a = this.atten(d, 110) * 0.8 + 0.2;
    const out = this.place(ctx, d, a, 0.34);
    const r = Math.random;
    this.burst(out, { D: 0.05, type: 'highpass', f: 1100, gain: 0.45, attack: 0.001 });
    this.partial(out, { D: 0.9, type: 'sine', f: 58 + r() * 8, f1: 22, glide: 0.6, gain: 0.95, attack: 0.004 });
    this.partial(out, { D: 0.3, type: 'triangle', f: 120, f1: 48, glide: 0.2, gain: 0.35 });
    this.burst(out, { D: 0.28, type: 'lowpass', f: 480, gain: 1.0 });
    this.crumple(out, 0.01, 0.1, 5, 0.35, 300, 1500);
    // The shockwave
    this.burst(out, { D: 0.5, type: 'bandpass', f: 260, f1: 70, q: 1.2, gain: 0.9, attack: 0.02 });
    // The ground carrying it
    this.burst(out, { D: 1.7, type: 'lowpass', f: 85, gain: 1.6, attack: 0.04, rate: 0.5 });
    this.burst(out, { D: 0.9, type: 'lowpass', f: 200, gain: 0.7, attack: 0.02, rate: 0.6 });
    // Debris
    for (let k = 0; k < 14; k++) {
      const at = 0.08 + Math.pow(r(), 0.8) * 1.0;
      this.burst(out, {
        at,
        D: 0.01 + r() * 0.02,
        type: 'bandpass',
        f: 1800 + r() * 3200,
        q: 3 + r() * 3,
        gain: (0.12 + r() * 0.13) * (1 - at / 1.3),
        attack: 0.001
      });
    }
    for (let k = 0; k < 3; k++) this.clang(out, 0.03 + r() * 0.12, 500 + r() * 700, 0.035, 0.18);
  }

  /**
   * A fire going, close by: the roar of it under a handful of sharp cracks
   * and pops at random through it. Called every so often for the nearest
   * fire, so it never loops the same way twice.
   */
  fireCrackle(dist: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const d = this.far(dist);
    const a = this.atten(d, 18);
    if (a <= 0.02) return;
    const out = this.place(ctx, d, a * 0.55, 0.15);
    const r = Math.random;
    this.burst(out, { D: 0.5, type: 'lowpass', f: 260 + r() * 120, gain: 0.22, attack: 0.08, rate: 0.6 });
    const n = 2 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      this.burst(out, {
        at: r() * 0.4,
        D: 0.006 + r() * 0.02,
        type: 'bandpass',
        f: 1600 + r() * 3600,
        q: 2 + r() * 3,
        gain: 0.18 + r() * 0.22,
        attack: 0.001
      });
    }
  }

  /** A rocket leaving the tube: the thump of the charge and the hiss of the motor lighting, going away. */
  rocketLaunch(dist: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const d = this.far(dist);
    const a = this.atten(d, 140) * 0.75 + 0.15;
    const out = this.place(ctx, d, a, 0.3);
    const r = Math.random;
    this.partial(out, { D: 0.22, type: 'sine', f: 90 + r() * 20, f1: 40, glide: 0.18, gain: 0.7, attack: 0.002 });
    this.burst(out, { D: 0.12, type: 'lowpass', f: 700, gain: 0.8 });
    this.burst(out, { D: 0.75, type: 'bandpass', f: 2600, f1: 900, q: 0.9, gain: 0.55, attack: 0.02 });
  }

  /**
   * Something going up — a rocket's warhead on a car or the ground: the
   * crack of it, a boom that drops away under hearing, the blast tearing
   * through the air, and bits coming down for a second after.
   */
  explosion(dist: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const d = this.far(dist);
    const a = this.atten(d, 160) * 0.8 + 0.2;
    const out = this.place(ctx, d, a, 0.45);
    const r = Math.random;
    this.burst(out, { D: 0.06, type: 'highpass', f: 1500, gain: 0.7, attack: 0.001 });
    this.partial(out, { D: 1.3, type: 'sine', f: 62 + r() * 10, f1: 19, glide: 1.0, gain: 1.0, attack: 0.004 });
    this.burst(out, { D: 0.35, type: 'lowpass', f: 900, gain: 1.1 });
    this.burst(out, { D: 1.4, type: 'lowpass', f: 160, gain: 1.3, attack: 0.03, rate: 0.5 });
    this.burst(out, { D: 0.6, type: 'bandpass', f: 600, f1: 140, q: 0.8, gain: 0.7, attack: 0.01 });
    this.crumple(out, 0.02, 0.15, 6, 0.3, 400, 2600);
    for (let k = 0; k < 10; k++) {
      const at = 0.15 + Math.pow(r(), 0.7) * 1.1;
      this.burst(out, {
        at,
        D: 0.01 + r() * 0.02,
        type: 'bandpass',
        f: 1500 + r() * 3000,
        q: 3,
        gain: (0.1 + r() * 0.12) * (1 - at / 1.4),
        attack: 0.001
      });
    }
  }

  /**
   * The General going down: three-odd metres of man falling flat on his back
   * onto a pile of wrecks. The impact (a boom that drops below hearing, the
   * body slam), the pile crushing under him crush after crush with a long
   * tearing crunch and big panels ringing low — roofs and bonnets the size of
   * tables — the rest of him arriving a beat after his back, glass, lots,
   * and then the pile settling: loaded steel groaning and creaking, the odd
   * late clunk, grit sifting down, and a rumble that takes three seconds to
   * go. Played at the moment he lands.
   */
  giantFall(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const out = this.place(ctx, 0, 0.8, 0.4);
    const r = Math.random;
    // The impact
    this.burst(out, { D: 0.06, type: 'highpass', f: 1200, gain: 0.5, attack: 0.001 });
    this.partial(out, { D: 1.8, type: 'sine', f: 46 + r() * 6, f1: 18, glide: 1.3, gain: 1.0, attack: 0.005 });
    this.partial(out, { D: 0.7, type: 'sine', f: 84, f1: 30, glide: 0.5, gain: 0.55, attack: 0.004 });
    this.burst(out, { D: 0.55, type: 'lowpass', f: 420, gain: 1.1, attack: 0.004 });
    // The pile crushing
    this.crumple(out, 0, 0.35, 16, 0.85, 300, 2400);
    this.crumple(out, 0.25, 0.9, 18, 0.55, 250, 1800);
    this.burst(out, { at: 0.03, D: 1.1, type: 'bandpass', f: 1400, f1: 380, q: 1.4, gain: 0.55, attack: 0.02 });
    this.clang(out, 0.005, 95 + r() * 40, 0.22, 1.4);
    this.clang(out, 0.22 + r() * 0.08, 140 + r() * 60, 0.16, 1.0);
    this.clang(out, 0.55 + r() * 0.15, 190 + r() * 90, 0.12, 0.8);
    this.clang(out, 1.05 + r() * 0.2, 120 + r() * 50, 0.08, 1.1);
    // The rest of him
    this.partial(out, { at: 0.18, D: 0.4, type: 'sine', f: 72, f1: 34, gain: 0.5, attack: 0.004 });
    this.burst(out, { at: 0.18, D: 0.22, type: 'lowpass', f: 600, gain: 0.6 });
    // Glass
    this.burst(out, { at: 0.01, D: 0.08, type: 'highpass', f: 2400, gain: 0.3, attack: 0.001 });
    this.tinkle(out, 0.05, 20, 1.3, 0.055);
    this.tinkle(out, 0.6, 10, 1.0, 0.04);
    // The pile settling
    this.metalGroan(out, 0.5, 2.0, 44, 0.45);
    this.creak(out, 1.2, 0.6, 22, 50, 700, 0.35);
    this.creak(out, 1.9, 0.5, 40, 18, 950, 0.25);
    for (const at of [1.4 + r() * 0.2, 2.1 + r() * 0.2, 2.6 + r() * 0.2]) {
      this.partial(out, { at, D: 0.18, type: 'triangle', f: 130 + r() * 130, f1: 70, gain: 0.18 });
      this.burst(out, { at, D: 0.12, type: 'lowpass', f: 700, gain: 0.35 });
    }
    for (let k = 0; k < 10; k++) {
      this.burst(out, {
        at: 0.4 + r() * 2.0,
        D: 0.012 + r() * 0.02,
        type: 'bandpass',
        f: 2500 + r() * 3500,
        q: 4,
        gain: 0.06,
        attack: 0.001
      });
    }
    // The rumble
    this.burst(out, { D: 3.0, type: 'lowpass', f: 75, gain: 2.0, attack: 0.05, rate: 0.5 });
    this.burst(out, { D: 2.2, type: 'lowpass', f: 160, gain: 0.8, attack: 0.03, rate: 0.6 });
  }

  /**
   * Stairwell B's fire door kicked open onto the lot. The push bar slammed
   * down throws the latch with a hard steel clack; the leaf flies round on
   * its hinges into the wall stop — a hollow steel slab, so it bangs and then
   * rings, low and long — the latch, closer arm and bar rattle in their
   * fixings, and it bounces back off the stop.
   */
  stairDoorBang(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const out = this.place(ctx, 0, 0.9, 0.3);
    const r = Math.random;
    // The push bar
    this.burst(out, { D: 0.02, type: 'bandpass', f: 2300, q: 2, gain: 0.55, attack: 0.001 });
    this.partial(out, { D: 0.05, type: 'square', f: 640, f1: 210, gain: 0.12 });
    this.burst(out, { at: 0.005, D: 0.06, type: 'lowpass', f: 900, gain: 0.5 });
    // The leaf hitting the stop
    const hit = 0.13 + r() * 0.03;
    this.burst(out, { at: hit, D: 0.04, type: 'highpass', f: 1500, gain: 0.45, attack: 0.001 });
    this.partial(out, { at: hit, D: 0.34, type: 'sine', f: 105 + r() * 15, f1: 44, glide: 0.22, gain: 0.85 });
    this.burst(out, { at: hit, D: 0.22, type: 'lowpass', f: 650, gain: 0.85 });
    this.clang(out, hit + 0.002, 128 + r() * 30, 0.2, 1.3, DOOR_MODES);
    this.clang(out, hit + 0.003, 410 + r() * 80, 0.06, 0.6, DOOR_MODES);
    // Rattle: bouncing, so the gaps open out
    let at = hit + 0.04;
    for (let k = 0; k < 7; k++) {
      this.burst(out, {
        at,
        D: 0.015,
        type: 'bandpass',
        f: 1600 + r() * 1600,
        q: 3,
        gain: 0.3 * (1 - k / 8),
        attack: 0.001
      });
      this.partial(out, { at, D: 0.04, type: 'triangle', f: 1200 + r() * 1200, gain: 0.04 * (1 - k / 8), attack: 0.001 });
      at += 0.03 + k * 0.012 + r() * 0.02;
    }
    // The bounce back off the stop
    this.partial(out, { at: hit + 0.3, D: 0.15, type: 'sine', f: 80, f1: 45, gain: 0.25 });
    this.burst(out, { at: hit + 0.3, D: 0.1, type: 'lowpass', f: 500, gain: 0.3 });
  }

  // ------------------------------------------------------------- boss music

  /**
   * The General's music (see BOSS_PROG and friends at the top of the file),
   * through the music bus so the slider applies. Notes are scheduled on the
   * audio clock a little ahead of time by a 25 ms timer — the timer only has
   * to wake up often enough, it never sets the timing — so it loops
   * seamlessly whatever the frame rate does. If the timer stalls (a
   * background tab), the steps it missed are skipped, not fired all at once.
   * Calling it while it's playing does nothing. Leaves the menu music alone.
   */
  startBossMusic(): void {
    if (!this.ctx || this.boss) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(BOSS_LEVEL, t + 0.05);
    out.connect(this.musicBus);
    // Glue: the same soft shoulder as the lot bus, so a big ensemble hit can't crack
    const glueIn = ctx.createGain();
    glueIn.gain.value = 0.5;
    const glue = ctx.createWaveShaper();
    glue.curve = softClipCurve();
    glueIn.connect(glue).connect(out);
    const parts = ctx.createGain();
    parts.connect(glueIn);
    // And a hall: war drums want room to boom in
    const hall = ctx.createConvolver();
    hall.buffer = this.hall(ctx);
    const send = ctx.createGain();
    send.gain.value = 0.3;
    parts.connect(send).connect(hall).connect(out);

    let next = t + 0.05;
    let n = 0;
    const tick = (): void => {
      const now = ctx.currentTime;
      if (next < now - 0.02) {
        const missed = Math.ceil((now - next) / BOSS_STEP);
        next += missed * BOSS_STEP;
        n += missed;
      }
      while (next < now + 0.14) {
        this.bossStep(ctx, parts, n, next);
        next += BOSS_STEP;
        n++;
      }
    };
    tick();
    this.boss = { timer: window.setInterval(tick, 25), out };
  }

  /**
   * Fades the boss music out over `fadeSeconds` and lets it all go. Safe to
   * call when it isn't playing; pass 0 for a hard stop (a scene exit).
   */
  stopBossMusic(fadeSeconds = 2): void {
    const b = this.boss;
    if (!b || !this.ctx) return;
    this.boss = null;
    clearInterval(b.timer);
    const now = this.ctx.currentTime;
    const f = Math.max(0.03, fin(fadeSeconds, 2));
    b.out.gain.cancelScheduledValues(now);
    b.out.gain.setValueAtTime(Math.max(0.0001, b.out.gain.value), now);
    b.out.gain.exponentialRampToValueAtTime(0.0001, now + f);
    window.setTimeout(() => b.out.disconnect(), (f + 0.3) * 1000);
  }

  /**
   * The hall's impulse response: 1.3 s of noise dying away, each sample
   * smoothed into the last a little more the further in it is, so the top
   * end dies first the way it does in a real room. Made once.
   */
  private hall(ctx: AudioContext): AudioBuffer {
    if (this.hallIR && this.hallIR.sampleRate === ctx.sampleRate) return this.hallIR;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * 1.3);
    const buf = ctx.createBuffer(2, len, rate);
    const fadeIn = Math.floor(rate * 0.012);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len;
        const k = 0.3 + 0.55 * x;
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        data[i] = lp * Math.pow(1 - x, 2.2) * (i < fadeIn ? i / fadeIn : 1);
      }
    }
    this.hallIR = buf;
    return buf;
  }

  /** Sixteenth `n` of the score, at audio time `t`. */
  private bossStep(ctx: AudioContext, dest: AudioNode, n: number, t: number): void {
    const s = n % 16;
    const bar = Math.floor(n / 16) % 16;
    const B = bar >= 8;
    const fill = bar % 4 === 3;
    const chord = BOSS_CHORDS[BOSS_PROG[bar]];
    // A drummer, not a sequencer: a few milliseconds and a few per cent either way
    const h = (): number => t + Math.random() * 0.006;
    const v = (x: number): number => x * (0.92 + Math.random() * 0.16);

    // Drums
    if (s === 0 && bar % 8 === 0) {
      this.bossGong(ctx, dest, t);
      this.bossTaiko(dest, t, 1.1, 0.75); // the whole ensemble: a bigger drum under the first beat
    }
    const big = BOSS_BIG[s] ?? (B && s === 14 ? 0.6 : 0);
    if (big > 0) this.bossTaiko(dest, h(), v(big), 1);
    if (fill && s >= 12) this.bossTom(dest, h(), v(0.75 + (s - 12) * 0.08), [190, 160, 135, 112][s - 12]);
    else if (s === 4 || s === 12) this.bossChu(dest, h(), v(0.9));
    if (B) this.bossTick(dest, h(), v(s % 2 === 0 ? 0.55 : 0.28));
    else if (s % 4 === 2) this.bossTick(dest, h(), v(0.55));

    // Bass
    const b = BOSS_BASS[s];
    if (b !== null) {
      const eighth = s % 4 === 0;
      this.bossBass(ctx, dest, t, chord.root + b, (eighth ? 1.7 : 0.8) * BOSS_STEP, eighth ? 1 : 0.8);
    }

    // Brass
    const stabs = B ? (bar === 15 ? BOSS_STABS_TURN : BOSS_STABS_B) : bar % 2 === 0 ? BOSS_STABS_A0 : BOSS_STABS_A1;
    for (const [at, len, vel] of stabs) if (at === s) this.bossStab(ctx, dest, t, chord.brass, len, vel);

    // The horn theme
    if (B) for (const [at, note, len] of BOSS_HORN[bar - 8]) if (at === s) this.bossHorn(ctx, dest, t, note, len * BOSS_STEP);
  }

  /** The odaiko: a skin that drops in pitch as it's struck, the air in the shell, and the stick. */
  private bossTaiko(dest: AudioNode, t: number, vel: number, pitch: number): void {
    this.partial(dest, { t, D: 0.7, type: 'sine', f: 100 * pitch, f1: 50 * pitch, glide: 0.1, gain: 0.85 * vel, attack: 0.002 });
    this.burst(dest, { t, D: 0.32, type: 'bandpass', f: 140 * pitch, q: 2.2, gain: 1.5 * vel, attack: 0.002, rate: 0.7 });
    this.burst(dest, { t, D: 0.05, type: 'lowpass', f: 1500, gain: 0.45 * vel, attack: 0.001 });
  }

  /** The mid drum, on the backbeat: tighter skin, a crack, the stick on the rim. */
  private bossChu(dest: AudioNode, t: number, vel: number): void {
    this.partial(dest, { t, D: 0.3, type: 'sine', f: 220, f1: 130, glide: 0.06, gain: 0.5 * vel, attack: 0.002 });
    this.burst(dest, { t, D: 0.14, type: 'bandpass', f: 1000, q: 0.9, gain: 0.7 * vel, attack: 0.001 });
    this.burst(dest, { t, D: 0.014, type: 'highpass', f: 3500, gain: 0.3 * vel, attack: 0.001 });
  }

  /** A tom, for the fills. */
  private bossTom(dest: AudioNode, t: number, vel: number, f: number): void {
    this.partial(dest, { t, D: 0.38, type: 'sine', f, f1: f * 0.62, glide: 0.08, gain: 0.6 * vel, attack: 0.002 });
    this.burst(dest, { t, D: 0.16, type: 'bandpass', f: f * 1.7, q: 2, gain: 0.7 * vel, attack: 0.001 });
  }

  /** The shime: a tight little drum ticking the time. */
  private bossTick(dest: AudioNode, t: number, vel: number): void {
    this.burst(dest, { t, D: 0.03, type: 'bandpass', f: 3800, q: 3, gain: 0.45 * vel, attack: 0.001 });
    this.burst(dest, { t, D: 0.012, type: 'highpass', f: 7000, gain: 0.12 * vel, attack: 0.001 });
  }

  /**
   * One bass note: a saw and a square, driven, through a resonant low-pass
   * that snaps open and closes again — the growl on every note of the gallop —
   * with a clean sine under it so the root stays solid.
   */
  private bossBass(ctx: AudioContext, dest: AudioNode, t: number, note: number, len: number, vel: number): void {
    const f = midi(note);
    const end = t + len;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.005);
    env.gain.linearRampToValueAtTime(0.26 * vel, end);
    env.gain.exponentialRampToValueAtTime(0.0001, end + 0.07);
    env.connect(dest);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(220, t);
    lp.frequency.exponentialRampToValueAtTime(900 + 700 * vel, t + 0.008);
    lp.frequency.exponentialRampToValueAtTime(240, end + 0.07);
    const drive = ctx.createWaveShaper();
    drive.curve = driveCurve(1.8);
    const driveG = ctx.createGain();
    driveG.gain.value = 0.55;
    drive.connect(lp).connect(driveG).connect(env);
    const oscs: OscillatorNode[] = [];
    for (const [type, detune, level] of [['sawtooth', 0, 0.5], ['square', 9, 0.35]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(drive);
      oscs.push(o);
    }
    const sub = ctx.createOscillator();
    sub.frequency.value = f;
    const subG = ctx.createGain();
    subG.gain.value = 0.45;
    sub.connect(subG).connect(env);
    oscs.push(sub);
    for (const o of oscs) {
      o.start(t);
      o.stop(end + 0.1);
    }
  }

  /**
   * A brass stab: the chord on detuned saw pairs, each note scooping up into
   * pitch, through one low-pass that blats open on the attack and closes as
   * it dies — that filter envelope is what reads as "brass" rather than
   * "synth". Harder hits open it further.
   */
  private bossStab(ctx: AudioContext, dest: AudioNode, t: number, notes: readonly number[], len: number, vel: number): void {
    const end = t + len;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.075 * vel, t + 0.012);
    env.gain.linearRampToValueAtTime(0.05 * vel, end);
    env.gain.exponentialRampToValueAtTime(0.0001, end + 0.1);
    env.connect(dest);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(450, t);
    lp.frequency.exponentialRampToValueAtTime(1500 + 1800 * vel, t + 0.03);
    lp.frequency.exponentialRampToValueAtTime(700, end + 0.1);
    lp.connect(env);
    for (const note of notes) {
      const f = midi(note);
      for (const detune of [-9, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = detune;
        o.frequency.setValueAtTime(f * 0.98, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
        o.connect(lp);
        o.start(t);
        o.stop(end + 0.12);
      }
    }
  }

  /**
   * One note of the horn theme: a slower swell than the stabs, a warmer
   * filter, an octave-down triangle for weight, and vibrato that only creeps
   * in once the note has settled, the way a player does it.
   */
  private bossHorn(ctx: AudioContext, dest: AudioNode, t: number, note: number, len: number): void {
    const f = midi(note);
    const end = t + len;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.085, t + 0.06);
    env.gain.linearRampToValueAtTime(0.07, end);
    env.gain.exponentialRampToValueAtTime(0.0001, end + 0.14);
    env.connect(dest);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(1700, t + 0.09);
    lp.frequency.linearRampToValueAtTime(1200, end);
    lp.connect(env);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.3;
    const vibG = ctx.createGain();
    vibG.gain.setValueAtTime(0, t);
    vibG.gain.setValueAtTime(0, t + 0.22);
    vibG.gain.linearRampToValueAtTime(0.006 * f, t + 0.45);
    vib.connect(vibG);
    const oscs: OscillatorNode[] = [vib];
    for (const [type, mul, detune, level] of [
      ['sawtooth', 1, -5, 1],
      ['sawtooth', 1, 6, 1],
      ['triangle', 0.5, 0, 0.6]
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      o.detune.value = detune;
      vibG.connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(lp);
      oscs.push(o);
    }
    for (const o of oscs) {
      o.start(t);
      o.stop(end + 0.16);
    }
  }

  /** The tam-tam: its modes swell after the strike rather than leading with it, and a wash of shimmer over them. */
  private bossGong(ctx: AudioContext, dest: AudioNode, t: number): void {
    for (const [ratio, amp] of GONG_MODES) {
      const o = ctx.createOscillator();
      o.frequency.value = 82 * ratio * (0.99 + Math.random() * 0.02);
      const g = ctx.createGain();
      const decay = 2.6 / Math.sqrt(ratio);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 * amp, t + 0.12 + ratio * 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
    this.burst(dest, { t, D: 2.2, type: 'bandpass', f: 2600, q: 0.7, gain: 0.08, attack: 0.25 });
  }

  // ------------------------------------------------------------ Level 10: the street

  /**
   * The Civic's engine, running: a tired 1.6 four-pot. Two firing pulses a
   * revolution through the same note / rasp / rumble layers as engine(),
   * but live — setSpeed() every frame picks a gear from the road speed
   * (five of them, with hysteresis), works out the revs, and on every
   * upshift the note dips as he lifts and the revs fall into the next gear.
   * Throttle drives it harder into the saturator and opens the rasp (the
   * grit); off it, it goes dull and quiet with a little exhaust burble. A
   * slow wobble at the cam rate is the misfire it has had since 2009.
   * setGain() for the scene's mix (cutscenes, the radio); stop() fades it.
   */
  engineLoop(): { setSpeed(mps: number, throttle: number): void; setGain(g: number): void; stop(): void } {
    const idle = { setSpeed: (): void => {}, setGain: (): void => {}, stop: (): void => {} };
    if (!this.ctx) return idle;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const level = ctx.createGain();
    level.gain.value = 1;
    level.connect(this.lotBus(ctx));
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.3, t + 0.25);
    env.connect(level);

    const sources: AudioScheduledSourceNode[] = [];
    // The note: two saws a few cents apart and the half-order square, saturated, through a low-pass that opens with the revs
    const pre = ctx.createGain();
    pre.gain.value = 0.5;
    const lump = ctx.createGain();
    lump.gain.value = 0.88;
    const drive = ctx.createWaveShaper();
    drive.curve = driveCurve(2.4);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 2.2;
    tone.frequency.value = 400;
    const noteG = ctx.createGain();
    noteG.gain.value = 0.55;
    pre.connect(lump).connect(drive).connect(tone).connect(noteG).connect(env);
    const main = ctx.createOscillator();
    main.type = 'sawtooth';
    const twin = ctx.createOscillator();
    twin.type = 'sawtooth';
    twin.detune.value = 9 + Math.random() * 6;
    const half = ctx.createOscillator();
    half.type = 'square';
    const halfG = ctx.createGain();
    halfG.gain.value = 0.32;
    main.connect(pre);
    twin.connect(pre);
    half.connect(halfG).connect(pre);
    // The tired bit: an uneven wobble at the cam rate
    const cam = ctx.createOscillator();
    cam.type = 'triangle';
    const camG = ctx.createGain();
    camG.gain.value = 0.12;
    cam.connect(camG).connect(lump.gain);
    sources.push(main, twin, half, cam);

    // The rasp: noise chopped at the firing rate
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.value = 600;
    const chop = ctx.createGain();
    chop.gain.value = 0.35;
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0.65;
    main.connect(chopDepth).connect(chop.gain);
    const raspDrive = ctx.createWaveShaper();
    raspDrive.curve = driveCurve(2.5);
    const raspG = ctx.createGain();
    raspG.gain.value = 0.06;
    n.connect(band).connect(chop).connect(raspDrive).connect(raspG).connect(env);
    // The exhaust rumble
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 90;
    const rumbleG = ctx.createGain();
    rumbleG.gain.value = 0.6;
    n.connect(rumble).connect(rumbleG).connect(env);
    sources.push(n);
    for (const s of sources) {
      if (s === n) n.start(t, Math.random() * 1.5);
      else s.start(t);
    }

    // Gears: the top of each in m/s; revs run 1000 → ~6000 across a gear
    const TOPS = [12, 21, 30, 40, 53];
    const IDLE = 850;
    let gear = 0;
    let dipUntil = 0;
    let stopped = false;
    const setF = (p: AudioParam, v: number, tc: number): void => {
      p.setTargetAtTime(Math.max(1, fin(v, 1)), ctx.currentTime, tc);
    };
    return {
      setSpeed: (mps: number, throttle: number): void => {
        if (stopped) return;
        const now = ctx.currentTime;
        const v = Math.abs(fin(mps, 0));
        const thr = Math.max(0, Math.min(1, Math.abs(fin(throttle, 0))));
        // Pick the gear, with some hysteresis so it doesn't hunt
        let g = gear;
        while (g < TOPS.length - 1 && v > TOPS[g] * 0.97) g++;
        while (g > 0 && v < TOPS[g - 1] * 0.78) g--;
        const up = g > gear;
        gear = g;
        let rpm = 1000 + (v / TOPS[g]) * 5000;
        if (g === 0) rpm = Math.max(IDLE + thr * 1600, rpm + thr * 500 * (1 - v / TOPS[0])); // clutch slip off the line
        rpm = Math.min(6600, rpm);
        const hz = (rpm / 60) * 2;
        const tc = up ? 0.09 : 0.045;
        setF(main.frequency, hz, tc);
        setF(twin.frequency, hz, tc);
        setF(half.frequency, hz / 2, tc);
        setF(cam.frequency, rpm / 120, tc);
        setF(tone.frequency, 260 + hz * (3.2 + thr * 3.2), 0.06);
        setF(band.frequency, 300 + hz * 3.2, 0.06);
        setF(rumble.frequency, 60 + hz * 1.2, 0.06);
        pre.gain.setTargetAtTime(0.32 + thr * 0.42, now, 0.05);
        raspG.gain.setTargetAtTime(0.03 + thr * 0.2, now, 0.05);
        // Loudness: louder on the throttle and up the revs; a lift and a dip on every upshift
        const L = 0.18 + thr * 0.17 + (rpm / 6600) * 0.1;
        if (up && v > 3) {
          dipUntil = now + 0.16;
          env.gain.cancelScheduledValues(now);
          env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), now);
          env.gain.linearRampToValueAtTime(L * 0.38, now + 0.03);
          env.gain.setValueAtTime(L * 0.38, now + 0.11);
          env.gain.linearRampToValueAtTime(L, now + 0.16);
          this.burst(env, { at: 0.02, D: 0.05, type: 'lowpass', f: 700, gain: 0.25, attack: 0.001 });
        } else if (now > dipUntil) env.gain.setTargetAtTime(L, now, 0.06);
      },
      setGain: (g: number): void => {
        if (stopped) return;
        level.gain.setTargetAtTime(Math.max(0, fin(g, 1)), ctx.currentTime, 0.08);
      },
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        env.gain.cancelScheduledValues(now);
        env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
        for (const s of sources) {
          try {
            s.stop(now + 0.35);
          } catch {
            /* already stopped */
          }
        }
      }
    };
  }

  /**
   * An American police siren: the wail (a slow rise and fall, ~650–1450 Hz,
   * about four seconds round) for a while, then the yelp (the same sweep at
   * three a second), and back — out of a horn speaker, all mids and buzz.
   * setDistance() every frame: quieter and duller with distance, and the
   * pitch bends with how fast the distance is changing (Doppler: sharp
   * closing in, flat pulling away). stop() fades it.
   */
  /**
   * A helicopter overhead: the blade slap — low noise chopped at the rotor
   * rate, a thump every blade — over the turbine's whine. Louder and
   * brighter close; stop() fades it out.
   */
  heliLoop(): { setDistance(m: number): void; stop(): void } {
    const idle = { setDistance: (): void => {}, stop: (): void => {} };
    if (!this.ctx) return idle;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 6000;
    out.connect(air).connect(this.lotBus(ctx));
    // The blades: noise through a low band, its level chopped ~17 times a second
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 420;
    const chop = ctx.createGain();
    chop.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = 17;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.9;
    lfo.connect(lfoG).connect(chop.gain);
    const bias = ctx.createConstantSource();
    bias.offset.value = 0.55;
    bias.connect(chop.gain);
    noise.connect(body).connect(chop).connect(out);
    // The thump under it
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.value = 52;
    const thumpG = ctx.createGain();
    thumpG.gain.value = 0;
    lfo.connect(thumpG.gain);
    thump.connect(thumpG).connect(out);
    // The turbine
    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    whine.frequency.value = 2350;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 2400;
    wf.Q.value = 6;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    whine.connect(wf).connect(wg).connect(out);
    const sources: AudioScheduledSourceNode[] = [noise, lfo, bias, thump, whine];
    for (const src of sources) src.start(t);
    let stopped = false;
    return {
      setDistance: (m: number): void => {
        if (stopped) return;
        const now = ctx.currentTime;
        const d = this.far(m);
        out.gain.setTargetAtTime(0.55 / (1 + d / 18), now, 0.1);
        air.frequency.setTargetAtTime(Math.min(9000, 14000 / (1 + d / 30)), now, 0.1);
      },
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setTargetAtTime(0.0001, now, 0.4);
        for (const src of sources) {
          try {
            src.stop(now + 2);
          } catch {
            /* already stopped */
          }
        }
      }
    };
  }

  /** A missile lock: two quick high beeps, the warning before a launch. */
  lockBeep(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const at of [0, 0.12]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 1760;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.09, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.08);
      o.connect(g).connect(this.sfxBus);
      o.start(t + at);
      o.stop(t + at + 0.1);
    }
  }

  sirenLoop(): { setDistance(m: number): void; stop(): void } {
    const idle = { setDistance: (): void => {}, stop: (): void => {} };
    if (!this.ctx) return idle;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.Q.value = 0.5;
    air.frequency.value = 9000;
    out.connect(air).connect(this.lotBus(ctx));
    const send = ctx.createGain();
    send.gain.value = 0.18;
    air.connect(send).connect(this.echoBus(ctx));

    const speaker = ctx.createBiquadFilter();
    speaker.type = 'bandpass';
    speaker.frequency.value = 1250;
    speaker.Q.value = 0.65;
    const buzz = ctx.createWaveShaper();
    buzz.curve = driveCurve(1.8);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.4);
    buzz.connect(speaker).connect(env).connect(out);

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1050;
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 1050;
    saw.detune.value = 6;
    const oscG = ctx.createGain();
    oscG.gain.value = 0.5;
    const sawG = ctx.createGain();
    sawG.gain.value = 0.35;
    osc.connect(oscG).connect(buzz);
    saw.connect(sawG).connect(buzz);
    // The sweep
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    const depth = ctx.createGain();
    depth.gain.value = 400;
    lfo.connect(depth);
    depth.connect(osc.frequency);
    depth.connect(saw.frequency);
    // Wail ~9 s, yelp ~3.5 s, round and round for twenty minutes (each change one automation event)
    let s = t;
    lfo.frequency.setValueAtTime(0.23, s);
    while (s < t + 1200) {
      s += 8.7;
      lfo.frequency.setValueAtTime(3.1, s);
      s += 3.5;
      lfo.frequency.setValueAtTime(0.23, s);
    }
    // Doppler, in cents
    const bend = ctx.createConstantSource();
    bend.offset.value = 0;
    bend.connect(osc.detune);
    bend.connect(saw.detune);
    const sources: AudioScheduledSourceNode[] = [osc, saw, lfo, bend];
    for (const src of sources) src.start(t);

    let lastM = NaN;
    let lastT = 0;
    let vr = 0;
    let stopped = false;
    return {
      setDistance: (m: number): void => {
        if (stopped) return;
        const now = ctx.currentTime;
        const d = this.far(m);
        if (Number.isFinite(lastM) && now - lastT > 0.005) {
          const raw = (d - lastM) / (now - lastT);
          vr += (Math.max(-80, Math.min(80, raw)) - vr) * 0.25;
        }
        lastM = d;
        lastT = now;
        const factor = 343 / (343 + vr);
        const cents = Math.max(-260, Math.min(260, 1200 * Math.log2(factor)));
        bend.offset.setTargetAtTime(cents, now, 0.12);
        out.gain.setTargetAtTime(0.16 / (1 + d / 22), now, 0.08);
        air.frequency.setTargetAtTime(Math.min(14000, 20000 / (1 + d / 25)), now, 0.08);
      },
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        env.gain.cancelScheduledValues(now);
        env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
        for (const src of sources) {
          try {
            src.stop(now + 0.65);
          } catch {
            /* already stopped */
          }
        }
      }
    };
  }

  /**
   * A car horn, `dist` metres off: the usual pair of disc horns a major
   * third apart, square and buzzy through the grille, a short angry blast
   * (sometimes two). Quieter and duller with distance.
   */
  horn(dist: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const d = this.far(dist);
    const t = ctx.currentTime;
    const a = this.atten(d, 160) * 0.85 + 0.15;
    const out = this.place(ctx, d, 0.32 * a, 0.16);
    const speaker = ctx.createBiquadFilter();
    speaker.type = 'bandpass';
    speaker.frequency.value = 900;
    speaker.Q.value = 0.7;
    const buzz = ctx.createWaveShaper();
    buzz.curve = driveCurve(1.5);
    buzz.connect(speaker).connect(out);
    const p = 0.9 + Math.random() * 0.2;
    const blasts = Math.random() < 0.35 ? 2 : 1;
    const lens = blasts === 2 ? [0.16, 0.42] : [0.3 + Math.random() * 0.35];
    let at = t;
    for (const D of lens) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(1, at + 0.012);
      env.gain.setValueAtTime(1, at + D - 0.03);
      env.gain.exponentialRampToValueAtTime(0.0001, at + D);
      env.connect(buzz);
      for (const f of [415, 522]) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f * p;
        const g = ctx.createGain();
        g.gain.value = 0.5;
        o.connect(g).connect(env);
        o.start(at);
        o.stop(at + D + 0.02);
      }
      at += D + 0.09;
    }
  }

  /** The radar gun locking on: two quick pips and a held tone, thin and electronic, from the dash. */
  radarBeep(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.place(ctx, 0, 0.16, 0);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    lp.connect(out);
    const notes: [number, number, number][] = [
      [0, 0.07, 2350],
      [0.11, 0.07, 2350],
      [0.22, 0.55, 2800]
    ];
    for (const [at, D, f] of notes) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      const s = t + at;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.5, s + 0.004);
      g.gain.setValueAtTime(0.5, s + D - 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + D);
      o.connect(g).connect(lp);
      o.start(s);
      o.stop(s + D + 0.02);
    }
  }

  /**
   * Tyres sliding, continuously: the squeal of tyreSqueal() held open —
   * the wandering stick-slip tone, its harsh octave, the rubber hiss, all
   * chattering — with set(slide) every frame (0 silent .. 1 full drift):
   * louder, and a little higher and harsher, the more it slides.
   */
  tyreSlideLoop(): { set(slide: number): void; stop(): void } {
    const idle = { set: (): void => {}, stop: (): void => {} };
    if (!this.ctx) return idle;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.place(ctx, 0, 0.75, 0.14);
    const env = ctx.createGain();
    env.gain.value = 0;
    env.connect(out);
    const chatter = ctx.createGain();
    chatter.gain.value = 0.75;
    chatter.connect(env);
    const chat = ctx.createOscillator();
    chat.frequency.value = 17 + Math.random() * 8;
    const chatDepth = ctx.createGain();
    chatDepth.gain.value = 0.25;
    chat.connect(chatDepth).connect(chatter.gain);

    const base = 1150 * (0.95 + Math.random() * 0.1);
    // The load wandering: two slow LFOs at awkward rates into the detune, and a quick shake
    const w1 = ctx.createOscillator();
    w1.frequency.value = 0.37;
    const w1g = ctx.createGain();
    w1g.gain.value = 260;
    const w2 = ctx.createOscillator();
    w2.frequency.value = 1.13;
    const w2g = ctx.createGain();
    w2g.gain.value = 140;
    const lift = ctx.createConstantSource();
    lift.offset.value = 0;
    w1.connect(w1g);
    w2.connect(w2g);
    const shake = ctx.createOscillator();
    shake.frequency.value = 9 + Math.random() * 4;
    const shakeG = ctx.createGain();
    shakeG.gain.value = 30;
    shake.connect(shakeG);
    const toneBus = ctx.createGain();
    const edge = ctx.createWaveShaper();
    edge.curve = driveCurve(1.5);
    const toneBand = ctx.createBiquadFilter();
    toneBand.type = 'bandpass';
    toneBand.frequency.value = 1350;
    toneBand.Q.value = 0.8;
    const toneG = ctx.createGain();
    toneG.gain.value = 0.18;
    toneBus.connect(edge).connect(toneBand).connect(toneG).connect(chatter);
    const oscs: OscillatorNode[] = [];
    const harsh = ctx.createGain();
    harsh.gain.value = 0.15;
    for (const [type, mul] of [['triangle', 1], ['sawtooth', 2.01]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = base * mul;
      w1g.connect(o.detune);
      w2g.connect(o.detune);
      lift.connect(o.detune);
      shakeG.connect(o.frequency);
      if (type === 'sawtooth') o.connect(harsh).connect(toneBus);
      else o.connect(toneBus);
      oscs.push(o);
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    for (const [f, q, lv] of [[2300, 1.3, 0.35], [900, 2.5, 0.3]] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = lv;
      n.connect(bp).connect(g).connect(chatter);
    }
    const sources: AudioScheduledSourceNode[] = [chat, w1, w2, lift, shake, ...oscs, n];
    for (const src of sources) {
      if (src === n) n.start(t, Math.random() * 1.5);
      else src.start(t);
    }
    let stopped = false;
    return {
      set: (slide: number): void => {
        if (stopped) return;
        const now = ctx.currentTime;
        const k = Math.max(0, Math.min(1, fin(slide, 0)));
        const g = k < 0.06 ? 0 : Math.pow((k - 0.06) / 0.94, 1.3);
        env.gain.setTargetAtTime(g, now, g > env.gain.value ? 0.04 : 0.09);
        lift.offset.setTargetAtTime(k * 260, now, 0.1);
        harsh.gain.setTargetAtTime(0.12 + k * 0.25, now, 0.1);
      },
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        env.gain.cancelScheduledValues(now);
        env.gain.setValueAtTime(env.gain.value, now);
        env.gain.linearRampToValueAtTime(0, now + 0.15);
        for (const src of sources) {
          try {
            src.stop(now + 0.2);
          } catch {
            /* already stopped */
          }
        }
      }
    };
  }

  /**
   * A business jet's two engines: a deep roar of filtered noise that swells
   * and opens up with thrust, and the turbines' whine on top, rising in pitch
   * as they spool. setThrust(0..1) spools them; setDistance() dulls and
   * quietens them as the jet goes away; stop() fades out.
   */
  jetEngine(): { setThrust(k: number): void; setDistance(m: number): void; stop(): void } {
    const idle = { setThrust: (): void => {}, setDistance: (): void => {}, stop: (): void => {} };
    if (!this.ctx) return idle;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const fin = (v: number, d: number): number => (Number.isFinite(v) ? v : d);
    const out = ctx.createGain();
    out.gain.value = 0;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 8000;
    out.connect(air).connect(this.sfxBus);
    // The roar
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    const roar = ctx.createBiquadFilter();
    roar.type = 'lowpass';
    roar.frequency.value = 300;
    roar.Q.value = 0.7;
    const roarG = ctx.createGain();
    roarG.gain.value = 0.5;
    n.connect(roar).connect(roarG).connect(out);
    // The whine: two slightly detuned turbines, through a band
    const whine = ctx.createBiquadFilter();
    whine.type = 'bandpass';
    whine.frequency.value = 2400;
    whine.Q.value = 2;
    const whineG = ctx.createGain();
    whineG.gain.value = 0.05;
    whine.connect(whineG).connect(out);
    const oscs: OscillatorNode[] = [];
    for (const det of [0, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 1400;
      o.detune.value = det;
      o.connect(whine);
      oscs.push(o);
    }
    n.start(t, Math.random() * 1.5);
    for (const o of oscs) o.start(t);
    let thrust = 0;
    let gainDist = 1;
    let stopped = false;
    const apply = (): void => {
      const now = ctx.currentTime;
      out.gain.setTargetAtTime((0.16 + 0.5 * thrust) * gainDist, now, 0.15);
      roar.frequency.setTargetAtTime(220 + thrust * 1400, now, 0.4);
      roarG.gain.setTargetAtTime(0.4 + thrust * 0.6, now, 0.3);
      for (const o of oscs) o.frequency.setTargetAtTime(1300 + thrust * 2600, now, 0.6);
      whineG.gain.setTargetAtTime(0.04 + thrust * 0.05, now, 0.3);
    };
    apply();
    return {
      setThrust: (k: number): void => {
        if (stopped) return;
        thrust = Math.max(0, Math.min(1, fin(k, 0)));
        apply();
      },
      setDistance: (m: number): void => {
        if (stopped) return;
        const d = Math.max(1, fin(m, 50));
        gainDist = Math.min(1, 40 / (d + 10));
        air.frequency.setTargetAtTime(Math.max(900, 9000 - d * 18), ctx.currentTime, 0.2);
        apply();
      },
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now);
        out.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
        try {
          n.stop(now + 1.3);
          for (const o of oscs) o.stop(now + 1.3);
        } catch {
          /* already stopped */
        }
      }
    };
  }
}
