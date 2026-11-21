// Tiny synthesized soundscape — no asset files.
export class Sfx {
  ctx: AudioContext | null = null;
  master!: GainNode;
  engineGain!: GainNode;
  muted = false;
  private alarmTimer = 0;

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(ctx.destination);
    // diesel drone: brown-ish noise through lowpass + two detuned saws
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 260;
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0.5;
    noise.connect(lp).connect(this.engineGain).connect(this.master); noise.start();
    for (const f of [41, 41.7]) {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.035;
      const f2 = ctx.createBiquadFilter(); f2.type = "lowpass"; f2.frequency.value = 180;
      o.connect(f2).connect(g).connect(this.master); o.start();
    }
    // wind
    const wl = ctx.createBiquadFilter(); wl.type = "bandpass"; wl.frequency.value = 700; wl.Q.value = 0.4;
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    const n2 = ctx.createBufferSource(); n2.buffer = buf; n2.loop = true; n2.playbackRate.value = 1.7;
    n2.connect(wl).connect(wg).connect(this.master); n2.start();
  }

  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.6; }

  private tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.15, slideTo?: number, delay = 0) {
    const c = this.ctx; if (!c || this.muted) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    const t0 = c.currentTime + delay;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  click() { this.tone(900, 0.06, "square", 0.05); }
  good() { this.tone(660, 0.12, "triangle", 0.12); this.tone(880, 0.18, "triangle", 0.12, undefined, 0.1); this.tone(1320, 0.25, "triangle", 0.1, undefined, 0.22); }
  bad() { this.tone(220, 0.35, "sawtooth", 0.1, 110); }
  radio() { this.tone(1800, 0.05, "square", 0.04); this.tone(1300, 0.07, "square", 0.04, undefined, 0.07); }
  step() { this.tone(70 + Math.random() * 20, 0.07, "triangle", 0.08); }
  thud() { this.tone(90, 0.3, "sine", 0.3, 40); }
  thunder() {
    const c = this.ctx; if (!c || this.muted) return;
    this.tone(70, 1.4, "sawtooth", 0.14, 28); this.tone(46, 1.8, "sine", 0.22, 22, 0.05);
    const len = Math.floor(c.sampleRate * 1.2), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    const src = c.createBufferSource(); src.buffer = buf;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380;
    const g = c.createGain(); g.gain.value = 0.35;
    src.connect(lp).connect(g).connect(this.master); src.start();
  }
  horn() { this.tone(440, 0.45, "sawtooth", 0.1); this.tone(554, 0.45, "sawtooth", 0.1); }
  alarmTick(dt: number, on: boolean) {
    this.alarmTimer -= dt;
    if (on && this.alarmTimer <= 0) { this.alarmTimer = 0.9; this.tone(880, 0.35, "square", 0.07); this.tone(660, 0.35, "square", 0.07, undefined, 0.4); }
  }
  engine(level: number) { if (this.engineGain) this.engineGain.gain.value = 0.25 + 0.5 * level; }
}
