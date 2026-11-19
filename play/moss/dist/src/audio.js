/**
 * Procedural sound effects through Web Audio: no audio files. Each sound is a
 * short envelope over an oscillator or filtered noise.
 */
export class Sfx {
          ctx                      = null;
          master                  = null;
  volume = 0.35;

  /** Browsers only allow audio after a user gesture; call from an input handler. */
  unlock()       {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

          tone(type                , f0        , f1        , dur        , gain = 0.5) {
    const c = this.ctx, m = this.master;
    if (!c || !m) return;
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(m);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

          noise(dur        , freq        , gain = 0.4) {
    const c = this.ctx, m = this.master;
    if (!c || !m) return;
    const t = c.currentTime;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf;
    f.type = "lowpass";
    f.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(m);
    s.start(t);
  }

  jump() { this.tone("square", 220, 520, 0.14, 0.18); }
  land(force        ) { this.noise(0.12, 300 + force * 40, Math.min(0.08 + force * 0.02, 0.4)); }
  pickup(pitch = 1) { this.tone("triangle", 660 * pitch, 1320 * pitch, 0.18, 0.3); this.tone("sine", 990 * pitch, 1980 * pitch, 0.25, 0.15); }
  bump(force        ) { this.noise(0.08, 900, Math.min(force * 0.03, 0.3)); }
  pad() { this.tone("sawtooth", 140, 700, 0.35, 0.18); }
  win() { [0, 4, 7, 12].forEach((s, i) => setTimeout(() => this.tone("triangle", 440 * 2 ** (s / 12), 440 * 2 ** (s / 12), 0.4, 0.25), i * 110)); }
}
