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

  glassShatter(distance: number): void {
    if (!this.ctx) return;
    const a = this.atten(distance, 35) * 0.9 + 0.1;
    this.noise(0.35, 'highpass', 3200, 0.5 * a);
    // Sprinkle of chimes as shards land
    for (let i = 0; i < 7; i++) {
      const t = this.ctx.currentTime + 0.04 + Math.random() * 0.4;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 2000 + Math.random() * 4500;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      g.gain.setValueAtTime(0.05 * a, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.connect(g).connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + 0.2);
    }
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
  startMenuMusic(): void {
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
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicTeardown?.();
    this.musicTeardown = null;
  }
}
