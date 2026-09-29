// Procedural WebAudio: an evolving ambient pad plus synthesized sound effects. No asset files.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.voice = true;
    try {
      this.muted = localStorage.getItem('seedfall:muted') === '1';
      this.voice = localStorage.getItem('ares:voice') !== '0';
    } catch {
      // storage unavailable
    }
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // Ambient pad: detuned oscillators through a slowly breathing low-pass filter.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 320;
    this.padFilter.Q.value = 4;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.045;
    this.padFilter.connect(padGain).connect(this.master);
    this.padOscs = [55, 82.4, 110.2, 164.8].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 7;
      o.connect(this.padFilter);
      o.start();
      return o;
    });
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(this.padFilter.frequency);
    lfo.start();

    // Wind.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer(2);
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.018;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // Combat layer: a low pulsing drone whose volume and pace follow the fight.
    this.combatGain = ctx.createGain();
    this.combatGain.gain.value = 0;
    const drone = ctx.createOscillator();
    drone.type = 'sawtooth';
    drone.frequency.value = 41.2;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 180;
    this.pulse = ctx.createGain();
    this.pulse.gain.value = 0.5;
    this.pulseLfo = ctx.createOscillator();
    this.pulseLfo.frequency.value = 1.6;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.5;
    this.pulseLfo.connect(pulseDepth).connect(this.pulse.gain);
    drone.connect(droneFilter).connect(this.pulse).connect(this.combatGain).connect(this.master);
    drone.start();
    this.pulseLfo.start();
  }

  /**
   * Adaptive music: `k` is 0 (calm) to 1 (boss fight). The drone swells and its pulse
   * quickens; `storm` (0–1) raises the wind.
   */
  setIntensity(k, storm = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.combatGain.gain.setTargetAtTime(0.11 * k, t, 0.8);
    this.pulseLfo.frequency.setTargetAtTime(1.4 + k * 2.2, t, 1);
    this.windGain.gain.setTargetAtTime(0.018 + storm * 0.09, t, 1.2);
    this.windFilter.frequency.setTargetAtTime(500 + storm * 700, t, 1.2);
  }

  /** Commander Reyes on the radio, using the browser's speech voice when available. */
  say(text) {
    if (this.muted || !this.voice || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 0.85;
      u.volume = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      // speech not available
    }
  }

  noiseBuffer(seconds) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('seedfall:muted', this.muted ? '1' : '0');
    } catch {
      // storage unavailable
    }
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** The soundtrack brightens and shifts to a major chord as the planet heals. */
  setMood(bio) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.padFilter.frequency.setTargetAtTime(260 + bio * 9, t, 1.5);
    const third = bio > 55 ? 138.6 : 130.8;
    this.padOscs[2].frequency.setTargetAtTime(third, t, 2);
    this.windGain.gain.setTargetAtTime(0.03 - bio * 0.00022, t, 2);
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, slide = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, { vol = 0.3, freq = 800, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  play(name, volume = 1) {
    if (!this.ctx || volume <= 0.01) return;
    const v = volume;
    switch (name) {
      case 'build':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.12 * v, delay: i * 0.06 }));
        break;
      case 'collect':
        this.tone(1320, 0.25, { vol: 0.12 * v });
        this.tone(1760, 0.3, { vol: 0.08 * v, delay: 0.07 });
        break;
      case 'shoot':
        this.tone(1100, 0.14, { type: 'sawtooth', vol: 0.06 * v, slide: 180 });
        break;
      case 'hit':
        this.noise(0.5, { vol: 0.35 * v, freq: 2400 });
        this.tone(220, 0.4, { type: 'square', vol: 0.05 * v, slide: 60 });
        break;
      case 'boom':
        this.noise(1.3, { vol: 0.6 * v, freq: 900 });
        this.tone(70, 1.1, { vol: 0.35 * v, slide: 30 });
        break;
      case 'alarm':
        [0, 0.28, 0.56].forEach((d) => this.tone(880, 0.18, { type: 'square', vol: 0.05 * v, slide: 660, delay: d }));
        break;
      case 'deny':
        this.tone(160, 0.2, { type: 'square', vol: 0.06 * v });
        break;
      case 'ping':
        this.tone(1568, 0.5, { vol: 0.08 * v });
        this.tone(2093, 0.5, { vol: 0.05 * v, delay: 0.09 });
        break;
      case 'ui':
        this.tone(900, 0.06, { type: 'triangle', vol: 0.05 * v });
        break;
      case 'squish':
        this.noise(0.25, { vol: 0.3 * v, freq: 1800 });
        this.tone(320, 0.25, { type: 'square', vol: 0.06 * v, slide: 90 });
        break;
      case 'streak': {
        const base = 440 * 2 ** (Math.min(volume, 8) / 12);
        [0, 4, 7].forEach((st, i) => this.tone(base * 2 ** (st / 12), 0.16, { type: 'triangle', vol: 0.09, delay: i * 0.05 }));
        break;
      }
      case 'bounty':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.1, delay: i * 0.08 }));
        break;
      case 'swarm':
        this.tone(110, 0.9, { type: 'sawtooth', vol: 0.08, slide: 55 });
        this.tone(116, 0.9, { type: 'sawtooth', vol: 0.06, slide: 58, delay: 0.1 });
        break;
      case 'jet':
        this.noise(0.12, { vol: 0.05 * v, freq: 1400 });
        break;
      case 'lose':
        [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.9, { type: 'triangle', vol: 0.1, delay: i * 0.25 }));
        break;
      case 'hurt':
        this.noise(0.18, { vol: 0.25 * v, freq: 700 });
        this.tone(140, 0.2, { type: 'square', vol: 0.07 * v, slide: 70 });
        break;
      case 'down':
        [330, 262, 196].forEach((f, i) => this.tone(f, 0.5, { type: 'sawtooth', vol: 0.07, delay: i * 0.18 }));
        break;
      case 'spit':
        this.noise(0.3, { vol: 0.15 * v, freq: 2600 });
        break;
      case 'type':
        this.tone(1200, 0.04, { type: 'square', vol: 0.03 });
        break;
      case 'glitch':
        for (let i = 0; i < 14; i++) {
          this.tone(200 + Math.random() * 1800, 0.05, { type: 'square', vol: 0.05, delay: i * 0.06 });
        }
        this.tone(55, 1.4, { type: 'sawtooth', vol: 0.12, slide: 40 });
        break;
      case 'beam':
        this.tone(80, 3.5, { type: 'sawtooth', vol: 0.12, slide: 900 });
        this.tone(160, 3.5, { type: 'square', vol: 0.05, slide: 1800 });
        this.noise(3, { vol: 0.12, freq: 3000 });
        break;
      case 'warp':
        this.tone(1400, 2.5, { type: 'sine', vol: 0.1, slide: 60 });
        this.tone(70, 4, { type: 'sawtooth', vol: 0.12, slide: 35, delay: 0.8 });
        this.noise(3, { vol: 0.2, freq: 900, delay: 0.6 });
        break;
      case 'laser':
        this.tone(1800, 0.25, { type: 'sawtooth', vol: 0.06 * v, slide: 300 });
        this.noise(0.4, { vol: 0.08 * v, freq: 1500, delay: 0.15 });
        break;
      case 'explosion':
        this.noise(4, { vol: 0.9, freq: 1200 });
        this.noise(2, { vol: 0.5, freq: 4000 });
        this.tone(45, 4, { type: 'sine', vol: 0.6, slide: 20 });
        this.tone(90, 2.5, { type: 'sawtooth', vol: 0.15, slide: 30 });
        break;
      case 'engine':
        this.noise(3, { vol: 0.25 * v, freq: 500 });
        this.tone(60, 3, { type: 'sawtooth', vol: 0.08 * v, slide: 90 });
        break;
      case 'strike':
        this.tone(900, 0.35, { type: 'sawtooth', vol: 0.12 * v, slide: 120 });
        this.noise(1.2, { vol: 0.6 * v, freq: 2400 });
        this.tone(55, 1.2, { type: 'sine', vol: 0.4 * v, slide: 30 });
        break;
      case 'charge':
        this.tone(200, 1.4, { type: 'sawtooth', vol: 0.05 * v, slide: 1200 });
        break;
      case 'grenade':
        this.noise(0.9, { vol: 0.55 * v, freq: 1800 });
        this.tone(70, 0.7, { type: 'sine', vol: 0.4 * v, slide: 35 });
        break;
      case 'boss':
        [110, 104, 98].forEach((f, i) => this.tone(f, 1.4, { type: 'sawtooth', vol: 0.12, delay: i * 0.5, slide: f * 0.7 }));
        this.noise(2.5, { vol: 0.2, freq: 300 });
        break;
      case 'revive':
        [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.25, { type: 'sine', vol: 0.12 * v, delay: i * 0.07 }));
        break;
      case 'achievement':
        [659, 784, 988, 1318].forEach((f, i) => this.tone(f, 0.5, { type: 'triangle', vol: 0.09, delay: i * 0.09 }));
        break;
      case 'log':
        [880, 660, 990].forEach((f, i) => this.tone(f, 0.12, { type: 'square', vol: 0.04, delay: i * 0.08 }));
        break;
      case 'upgrade':
        this.tone(300, 0.4, { type: 'sawtooth', vol: 0.08, slide: 900 });
        this.tone(900, 0.3, { type: 'triangle', vol: 0.08, delay: 0.35 });
        break;
      case 'win':
        [392, 494, 587, 784, 988].forEach((f, i) => this.tone(f, 1.6, { type: 'triangle', vol: 0.1, delay: i * 0.14 }));
        break;
      default:
    }
  }
}
