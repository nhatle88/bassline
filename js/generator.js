// Bass line generator: turns a chord chart into notes, one style at a time.
import { parseChord, isNoChord, pcOf, foldToBass } from './theory.js';

export const STYLES = [
  { id: 'roots', name: 'Simple roots', hint: 'One long note per chord. Best for learning a song.' },
  { id: 'root5', name: 'Root & 5th', hint: 'Root and fifth. Pop, country, worship.' },
  { id: 'pop8', name: 'Pop 8ths', hint: 'Driving eighth notes with lead-ins.' },
  { id: 'worship', name: 'Worship / ballad', hint: 'Long notes that step smoothly into each chord.' },
  { id: 'rock', name: 'Rock octaves', hint: 'Root–octave pump. Rock, disco, upbeat praise.' },
  { id: 'walking', name: 'Jazz walking', hint: 'Four notes a bar: chord tones plus approach notes. Plays with swing.' },
  { id: 'sheet', name: 'From the sheet', hint: 'The bass part read from your score (needs ✨ Read sheet).' },
];
export const LEVELS = [
  { id: 'easy', name: 'Easy' },
  { id: 'normal', name: 'Normal' },
  { id: 'busy', name: 'Busy' },
];

// Patterns: [tone, beats]. R root, 5 fifth, 8 octave, A approach into next chord, P passing step.
// Each level has a few variations: the song mostly sticks to one (picked by the seed),
// with the odd bar of another one on Normal/Busy.
const p = (s) => s.split(' ').map((t) => { const [tone, d] = t.split(':'); return [tone, Number(d)]; });
const PATTERNS = {
  roots: {
    easy: ['whole'],
    normal: [p('R:2'), p('R:3 A:1'), p('R:2 R:1 A:1')],
    busy: [p('R:1 R:1 R:1 A:1'), p('R:1 R:1 8:1 A:1'), p('R:1.5 R:0.5 R:1 A:1')],
  },
  root5: {
    easy: [p('R:2 5:2'), p('R:3 5:1')],
    normal: [p('R:1.5 R:0.5 5:1.5 5:0.5'), p('R:1 R:1 5:1 5:1'), p('R:1.5 R:0.5 5:2')],
    busy: [p('R:1 5:1 8:1 A:1'), p('R:1.5 R:0.5 5:1 A:1'), p('R:0.5 R:0.5 5:0.5 5:0.5 8:1 A:1')],
  },
  pop8: {
    easy: [p('R:1'), p('R:1.5 R:0.5 R:2')],
    normal: [p('R:0.5 R:0.5 R:0.5 R:0.5 R:0.5 R:0.5 R:0.5 A:0.5'), p('R:0.5 R:0.5 R:0.5 R:0.5 R:0.5 R:0.5 5:0.5 A:0.5'), p('R:1 R:0.5 R:0.5 R:1 R:0.5 A:0.5')],
    busy: [p('R:0.5 R:0.5 R:0.5 8:0.5 R:0.5 R:0.5 5:0.5 A:0.5'), p('R:0.5 R:0.5 8:0.5 R:0.5 R:0.5 R:0.5 5:0.5 A:0.5'), p('R:0.5 8:0.5 R:0.5 5:0.5 R:0.5 8:0.5 5:0.5 A:0.5')],
  },
  worship: {
    easy: ['whole', p('R:3 R:1')],
    normal: [p('R:3 P:1'), p('R:2 5:1 P:1'), p('R:2 R:1 P:1')],
    busy: [p('R:1.5 R:0.5 5:1 P:1'), p('R:1 5:1 8:1 P:1'), p('R:1.5 R:0.5 R:1 P:1')],
  },
  rock: {
    easy: [p('R:1'), p('R:1 R:1 R:1 8:1')],
    normal: [p('R:0.5 8:0.5'), p('R:0.5 R:0.5 8:0.5 R:0.5'), p('R:0.5 R:0.5 R:0.5 R:0.5 R:0.5 R:0.5 8:0.5 A:0.5')],
    busy: [p('R:0.5 R:0.5 8:0.5 R:0.5 R:0.5 5:0.5 8:0.5 A:0.5'), p('R:0.5 8:0.5 R:0.5 8:0.5 R:0.5 8:0.5 5:0.5 A:0.5')],
  },
};
const VARY = { easy: 0, normal: 0.12, busy: 0.25 };

// The variation for one chord: the song's main one, or (sometimes / when asked) another.
function choosePattern(style, level, seed, r, forceOther) {
  const list = PATTERNS[style][level];
  const main = (seed - 1) % list.length; // "New idea" steps through them
  if (list.length > 1 && (forceOther || r() < VARY[level])) {
    const others = list.filter((_, k) => k !== main);
    return others[Math.floor(r() * others.length)];
  }
  return list[main];
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// Nearest MIDI note with pitch class pc to ref, inside the comfortable root range.
function near(pc, ref, lo = 28, hi = 43) {
  let best = null;
  for (let m = lo; m <= hi; m++) {
    if (pcOf(m) === pc && (best === null || Math.abs(m - ref) < Math.abs(best - ref))) best = m;
  }
  return best;
}

// Chord segments of the whole song, in order, with "unreadable" chords carried over.
export function segmentsOf(song) {
  const segs = [];
  let last = null;
  song.bars.forEach((bar, bi) => {
    let t = 0;
    const chords = bar.chords.length ? bar.chords : [{ symbol: 'N.C.', beats: song.beatsPerBar }];
    chords.forEach((c) => {
      let chord = parseChord(c.symbol);
      if (!chord && !isNoChord(c.symbol)) chord = last;
      if (chord) last = chord;
      segs.push({ bar: bi, start: t, beats: c.beats, chord });
      t += c.beats;
    });
  });
  return segs;
}

export function chordAt(song, bar, beat) {
  const segs = segmentsOf(song).filter((s) => s.bar === bar);
  return (segs.find((s) => beat >= s.start && beat < s.start + s.beats) || segs[0] || {}).chord || null;
}

function fifthNear(chord, R) {
  const up = R + pcOf(chord.root + chord.fifth - R);
  return up - (up > 47 ? 12 : 0);
}

function toneMidi(tone, chord, R, target, ctx) {
  switch (tone) {
    case 'R': return R;
    case '5': return fifthNear(chord, R);
    case '8': return R + 12 <= 55 ? R + 12 : R;
    case 'A':
      if (target === null || pcOf(target) === pcOf(R)) return ctx.level === 'busy' ? fifthNear(chord, R) : R;
      return ctx.style === 'rock' ? target - 1 : passing(chord, R, target);
    case 'P':
      if (target === null || pcOf(target) === pcOf(R)) return R;
      return passing(chord, R, target);
    default: return R;
  }
}

// A scale step next to the target, on the side we're coming from.
function passing(chord, R, target) {
  if (Math.abs(target - R) <= 2) return R;
  const fromBelow = target > R;
  const steps = fromBelow ? [target - 2, target - 1] : [target + 2, target + 1];
  const inScale = steps.find((m) => chord.scale.includes(pcOf(m - chord.root)));
  return inScale ?? (fromBelow ? target - 1 : target + 1);
}

function realize(pattern, seg, chord, R, target, ctx) {
  if (pattern === 'whole') return [{ start: 0, dur: seg.beats, tone: 'R', midi: R }];
  const notes = [];
  let t = 0, i = 0;
  while (t < seg.beats - 1e-6) {
    const [tone, dur] = pattern[i % pattern.length];
    const d = Math.min(dur, seg.beats - t);
    notes.push({ start: t, dur: d, tone });
    t += d;
    i++;
  }
  // Lead into a new chord with the last note, if this pattern has lead-ins.
  const hasA = pattern.some((p) => p[0] === 'A' || p[0] === 'P');
  notes.forEach((n, k) => {
    let tone = n.tone;
    if ((tone === 'A' || tone === 'P') && k !== notes.length - 1) tone = 'R';
    if (k === notes.length - 1 && hasA && n.dur <= 1) tone = pattern.some((p) => p[0] === 'P') ? 'P' : 'A';
    n.midi = toneMidi(tone, chord, R, target, ctx);
  });
  return notes;
}

function walk(seg, chord, R, target, ctx) {
  const r = ctx.r;
  if (ctx.level === 'easy') {
    return realize([['R', 2], ['5', 2]], seg, chord, R, target, ctx);
  }
  const n = Math.max(1, Math.round(seg.beats));
  const third = chord.third ?? 7;
  const tgt = target ?? R;
  const scale2 = R + (chord.scale[1] ?? 2);
  const below7 = R + (chord.scale[chord.scale.length - 1] ?? 10) - 12;
  const up = tgt > R + 2, down = tgt < R - 2;
  const templates = [];
  if (!down) templates.push([R, R + third, R + chord.fifth], [R, scale2, R + third]);
  if (!up) templates.push([R, below7, R + chord.fifth - 12], [R, R + chord.fifth, R + third]);
  if (!templates.length) templates.push([R, R + third, R + chord.fifth]);
  const line = pick(r, templates).slice(0, Math.max(1, n - 1));
  while (line.length < n - 1) line.push(R + chord.fifth);
  if (n > 1) {
    // Aim at the next root in the octave closest to where the line ended up,
    // so the approach note is a small step (the next bar starts near it too).
    const last = line[line.length - 1];
    const t2 = near(pcOf(tgt), last, 28, 43);
    let chromatic = last < t2 ? t2 - 1 : t2 + 1;
    if (chromatic === last) chromatic = last < t2 ? t2 + 1 : t2 - 1;
    const dominant = t2 + 7 <= 50 ? t2 + 7 : t2 - 5;
    line.push(r() < 0.75 || dominant === last ? chromatic : dominant);
  }
  const dur = seg.beats / n;
  const notes = line.map((m, k) => ({ start: k * dur, dur, midi: foldToBass(m) }));
  // Busy: sometimes split beat 4 into a swung eighth pickup.
  if (ctx.level === 'busy' && n >= 4 && r() < 0.45) {
    const lastNote = notes.pop();
    notes.push({ start: lastNote.start, dur: dur / 2, midi: R + chord.fifth > 50 ? R + chord.fifth - 12 : R + chord.fifth });
    notes.push({ start: lastNote.start + dur / 2, dur: dur / 2, midi: lastNote.midi });
  }
  return notes;
}

function sheetBar(song, bi) {
  const bass = song.bars[bi].bass || [];
  if (!bass.length) return null;
  let t = 0;
  const notes = [];
  for (const n of bass) {
    if (t >= song.beatsPerBar - 1e-6) break;
    const dur = Math.min(n.beats, song.beatsPerBar - t);
    if (dur > 0) notes.push({ start: t, dur, midi: n.midi == null ? null : foldToBass(n.midi) });
    t += n.beats;
  }
  if (t < song.beatsPerBar - 1e-6) notes.push({ start: t, dur: song.beatsPerBar - t, midi: null });
  return notes;
}

// Generate one bar. prevMidi is the last note played before this bar.
export function generateBar(song, bi, opts, prevMidi, segs = segmentsOf(song)) {
  const ctx = { r: mulberry32(opts.barSeed ?? (opts.seed || 1) * 1000 + bi * 7919), level: opts.level, style: opts.style };
  if (opts.style === 'sheet') {
    const fromSheet = sheetBar(song, bi);
    if (fromSheet) return { notes: fromSheet };
    ctx.style = 'roots';
  }
  let prev = prevMidi;
  const notes = [];
  segs.forEach((seg, si) => {
    if (seg.bar !== bi) return;
    if (!seg.chord) {
      notes.push({ start: seg.start, dur: seg.beats, midi: null });
      return;
    }
    const chord = seg.chord;
    const R = near(chord.bass, prev ?? 34, 28, ctx.level === 'easy' ? 40 : 43);
    const nextSeg = segs.slice(si + 1).find((s) => s.chord);
    const target = nextSeg ? near(nextSeg.chord.bass, R, 28, 43) : null;
    const made = ctx.style === 'walking'
      ? walk(seg, chord, R, target, ctx)
      : realize(choosePattern(ctx.style, ctx.level, opts.seed || 1, ctx.r, opts.vary), seg, chord, R, target, ctx);
    made.forEach((n) => {
      notes.push({ start: seg.start + n.start, dur: n.dur, midi: n.midi == null ? null : foldToBass(n.midi) });
    });
    const lastPlayed = made.filter((n) => n.midi != null).pop();
    if (lastPlayed) prev = lastPlayed.midi;
  });
  return { notes };
}

export const lastMidiOf = (bar) => {
  const n = bar && bar.notes.filter((x) => x.midi != null).pop();
  return n ? n.midi : null;
};

export function generateBass(song, opts) {
  const segs = segmentsOf(song);
  const bars = [];
  let prev = null;
  song.bars.forEach((_, bi) => {
    const bar = generateBar(song, bi, opts, prev, segs);
    bars.push(bar);
    prev = lastMidiOf(bar) ?? prev;
  });
  return { bars };
}
