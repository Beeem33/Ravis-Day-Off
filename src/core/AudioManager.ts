/**
 * AudioManager — fully procedural Web Audio SFX + music. No audio assets;
 * everything (gunshots, glass, footsteps, the guard's muffled lo-fi mix)
 * is synthesized at runtime.
 */
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
    this.master.connect(this.ctx.destination);

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
}
