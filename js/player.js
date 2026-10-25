// Audio playback: simple bass synth, metronome click and chord pad, with a
// look-ahead scheduler so timing stays tight while the UI is busy.

const LOOKAHEAD = 0.15; // seconds scheduled ahead
const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export class Player {
  constructor() {
    this.ctx = null;
    this.events = []; // {beat, dur, kind:'bass'|'chord', midi|midis}
    this.totalBeats = 0;
    this.bpb = 4;
    this.bpm = 90;
    this.loop = null; // {start, end} in beats
    this.mix = { bass: true, click: true, chords: false };
    this.countIn = true;
    this.playing = false;
    this.onEnd = null;
  }

  ensureContext() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state !== 'running') this.ctx.resume();
    return this.ctx;
  }

  load(events, totalBeats, bpb) {
    this.events = events.slice().sort((a, b) => a.beat - b.beat);
    this.totalBeats = totalBeats;
    this.bpb = bpb;
  }

  get spb() { return 60 / this.bpm; }

  play(fromBeat = 0) {
    const ctx = this.ensureContext();
    this.stop();
    if (this.loop && (fromBeat < this.loop.start || fromBeat >= this.loop.end)) fromBeat = this.loop.start;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    const lead = this.countIn ? this.bpb : 0;
    const t0 = ctx.currentTime + 0.08;
    this.anchors = [{ time: t0, beat: fromBeat - lead, spb: this.spb }];
    this.cursor = fromBeat - lead;
    this.songStart = fromBeat;
    this.skipBefore = fromBeat;
    this.playing = true;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.master) {
      const m = this.master, now = this.ctx.currentTime;
      m.gain.setValueAtTime(m.gain.value, now);
      m.gain.linearRampToValueAtTime(0, now + 0.05);
      setTimeout(() => m.disconnect(), 120);
      this.master = null;
    }
    this.playing = false;
  }

  setTempo(bpm) {
    this.bpm = bpm;
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    this.anchors.push({ time: now, beat: this.beatAt(now), spb: this.spb });
  }

  anchorFor(time) {
    let a = this.anchors[0];
    for (const x of this.anchors) if (x.time <= time) a = x;
    return a;
  }
  beatAt(time) {
    const a = this.anchorFor(time);
    return a.beat + (time - a.time) / a.spb;
  }
  timeAt(beat) {
    const a = this.anchors[this.anchors.length - 1];
    return a.time + (beat - a.beat) * a.spb;
  }

  // Song position for the UI (negative while counting in).
  position() {
    if (!this.playing) return null;
    return this.beatAt(this.ctx.currentTime);
  }
  inCountIn() {
    const p = this.position();
    return p !== null && p < this.songStart;
  }

  tick() {
    const ctx = this.ctx;
    const horizon = ctx.currentTime + LOOKAHEAD;
    let a = this.anchors[this.anchors.length - 1];
    let until = a.beat + (horizon - a.time) / a.spb;
    for (let guard = 0; guard < 4; guard++) {
      const loopEnd = this.loop && this.cursor < this.loop.end && this.cursor >= this.loop.start - this.bpb ? this.loop.end : null;
      const end = loopEnd !== null && loopEnd <= until ? loopEnd : until;
      this.scheduleRange(this.cursor, end);
      this.cursor = end;
      if (end !== loopEnd) break;
      const t = this.timeAt(loopEnd);
      this.anchors.push({ time: t, beat: this.loop.start, spb: this.spb });
      this.cursor = this.loop.start;
      this.skipBefore = this.loop.start;
      this.songStart = -Infinity;
      a = this.anchors[this.anchors.length - 1];
      until = a.beat + (horizon - a.time) / a.spb;
    }
    if (this.anchors.length > 8) this.anchors = this.anchors.slice(-4);
    if (!this.loop && this.beatAt(ctx.currentTime) >= this.totalBeats) {
      this.stop();
      this.onEnd?.();
    }
  }

  scheduleRange(b0, b1) {
    if (b1 <= b0) return;
    for (let k = Math.ceil(b0 - 1e-9); k < b1; k++) {
      const counting = k < this.songStart;
      if ((counting || this.mix.click) && (counting || k < this.totalBeats)) {
        this.click(this.timeAt(k), ((k % this.bpb) + this.bpb) % this.bpb === 0, counting);
      }
    }
    const spb = this.anchors[this.anchors.length - 1].spb;
    for (const ev of this.events) {
      if (ev.beat < b0 || ev.beat < this.skipBefore) continue;
      if (ev.beat >= b1) break;
      const t = this.timeAt(ev.beat);
      if (ev.kind === 'bass' && this.mix.bass) this.bassNote(t, ev.midi, ev.dur * spb);
      if (ev.kind === 'chord' && this.mix.chords) this.pad(t, ev.midis, ev.dur * spb);
    }
  }

  bassNote(t, midi, dur, out = this.master) {
    const ctx = this.ctx;
    const len = Math.max(0.08, dur * 0.95);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq(midi);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq(midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(320, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.2);
    g.gain.setValueAtTime(0.18, t + len);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.08);
    const sg = ctx.createGain();
    sg.gain.value = 0.9;
    osc.connect(filter);
    sub.connect(sg).connect(filter);
    filter.connect(g).connect(out);
    osc.start(t); sub.start(t);
    osc.stop(t + len + 0.1); sub.stop(t + len + 0.1);
  }

  click(t, accent, countIn) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = accent ? 1800 : 1200;
    const g = ctx.createGain();
    const vol = countIn ? 0.22 : 0.12;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  pad(t, midis, dur) {
    const ctx = this.ctx;
    midis.forEach((m) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq(m);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.04);
      g.gain.setValueAtTime(0.035, t + Math.max(0.05, dur - 0.05));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.3);
    });
  }

  // Play a single note now (note editor "Hear" button).
  preview(midi) {
    const ctx = this.ensureContext();
    const g = ctx.createGain();
    g.connect(ctx.destination);
    this.bassNote(ctx.currentTime + 0.02, midi, 0.7, g);
    setTimeout(() => g.disconnect(), 1500);
  }
}
