// Music theory helpers: note names, chord parsing, bass fretboard and fingering.

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export const pcOf = (midi) => ((midi % 12) + 12) % 12;

export function noteName(midi, preferFlat = false, withOctave = false) {
  const name = (preferFlat ? FLATS : SHARPS)[pcOf(midi)];
  return withOctave ? name + (Math.floor(midi / 12) - 1) : name;
}

// "Bb" -> 10, "F#" -> 6
export function parsePitchClass(str) {
  const m = /^([A-Ga-g])([#b♯♭]?)/.exec(str.trim());
  if (!m) return null;
  let pc = LETTER[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  return (pc + 12) % 12;
}

// "F#2" -> MIDI 42 (C4 = 60)
export function parseNoteName(str) {
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(str.trim());
  if (!m) return null;
  const pc = parsePitchClass(m[1] + m[2]);
  let midi = (Number(m[3]) + 1) * 12 + pc;
  // B#3 / Cb4 cross octave boundaries
  if (m[1].toUpperCase() === 'B' && pc === 0) midi += 12;
  if (m[1].toUpperCase() === 'C' && pc === 11) midi -= 12;
  return midi;
}

export const isNoChord = (s) => /^(n\.?\s?c\.?|x|-)$/i.test((s || '').trim());

// Parse a chord symbol into the pieces a bass player needs.
export function parseChord(symbol) {
  if (!symbol) return null;
  const s = symbol.trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\s+/g, '');
  if (isNoChord(s)) return null;
  const m = /^([A-G])([#b]?)(.*)$/.exec(s);
  if (!m) return null;
  const root = parsePitchClass(m[1] + m[2]);
  let rest = m[3];
  let bass = root;
  const slash = /\/([A-G][#b]?)$/.exec(rest);
  if (slash) {
    bass = parsePitchClass(slash[1]);
    rest = rest.slice(0, slash.index);
  }
  const q = rest.replace(/[()]/g, '');
  const core = q.replace(/add\d+/g, '');

  let third = 4, fifth = 7, seventh = null, kind = 'maj';
  if (/^(m(?!aj)|min|mi|-)/.test(q)) { third = 3; kind = 'min'; }
  if (/sus2/.test(q)) { third = 2; kind = 'sus'; }
  else if (/sus/.test(q)) { third = 5; kind = 'sus'; }
  if (/ø|m7b5|-7b5|min7b5/.test(q)) { third = 3; fifth = 6; seventh = 10; kind = 'hdim'; }
  else if (/dim|°|^o/.test(q)) { third = 3; fifth = 6; kind = 'dim'; }
  if (/aug|\+|#5/.test(q)) { fifth = 8; if (kind === 'maj') kind = 'aug'; }
  if (/b5/.test(q) && kind !== 'hdim') fifth = 6;
  if (/^5$/.test(q)) { third = null; kind = 'power'; }

  if (seventh === null) {
    if (/(maj|ma|M|Δ)(7|9|11|13)|Δ/.test(core)) seventh = 11;
    else if (kind === 'dim' && /7/.test(core)) seventh = 9;
    else if (/(7|9|11|13)/.test(core)) seventh = 10;
  }
  const sixth = seventh === null && /6/.test(core);

  let scale;
  if (kind === 'min') scale = seventh === 11 ? [0, 2, 3, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 9, 10];
  else if (kind === 'hdim') scale = [0, 1, 3, 5, 6, 8, 10];
  else if (kind === 'dim') scale = [0, 2, 3, 5, 6, 8, 9, 11];
  else if (kind === 'aug') scale = [0, 2, 4, 6, 8, 10];
  else if (seventh === 10 || kind === 'sus') scale = [0, 2, 4, 5, 7, 9, 10];
  else scale = [0, 2, 4, 5, 7, 9, 11];

  const tones = [0, third, fifth, seventh, sixth ? 9 : null].filter((t) => t !== null);
  return { symbol: s, root, bass, third, fifth, seventh, kind, scale, tones };
}

const INTERVAL_NAMES = ['root', '♭9', '9th', '♭3', '3rd', '4th', '♭5', '5th', '♯5', '6th', '♭7', 'maj 7'];

// Describe how a note relates to a chord, e.g. "5th of Am7"
export function describeInChord(midi, chord) {
  if (!chord) return '';
  const iv = pcOf(midi - chord.root);
  const name = INTERVAL_NAMES[iv];
  const inChord = chord.tones.includes(iv) || pcOf(midi) === chord.bass;
  return `${name} of ${chord.symbol}${inChord ? ' · chord tone' : ' · passing note'}`;
}

export function chordToneNames(chord, preferFlat) {
  if (!chord) return '';
  return chord.tones.map((t) => noteName(chord.root + t, preferFlat)).join(' ');
}

// ---- 4-string bass fretboard (index 0 = low E) ----
export const STRINGS = [
  { name: 'E', open: 28 },
  { name: 'A', open: 33 },
  { name: 'D', open: 38 },
  { name: 'G', open: 43 },
];
export const MAX_FRET = 20;
export const LOWEST = 28;
export const HIGHEST = STRINGS[3].open + MAX_FRET;

export function foldToBass(midi) {
  while (midi < LOWEST) midi += 12;
  while (midi > HIGHEST) midi -= 12;
  return midi;
}

export function positionsFor(midi) {
  const out = [];
  STRINGS.forEach((s, i) => {
    const fret = midi - s.open;
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string: i, fret });
  });
  return out;
}

// Pick string + fret for every note so the line is easy to play:
// low frets, small hand moves, few string skips. Pinned notes keep their spot.
export function assignFingering(bassBars, level = 'normal') {
  const comfy = level === 'easy' ? 5 : level === 'normal' ? 9 : 12;
  const list = [];
  bassBars.forEach((b) => b.notes.forEach((n) => { if (n.midi != null) list.push(n); }));
  if (!list.length) return;

  const options = list.map((n) => {
    n.midi = foldToBass(n.midi);
    if (n.pin && n.string != null && n.fret === n.midi - STRINGS[n.string].open) {
      return [{ string: n.string, fret: n.fret }];
    }
    n.pin = false;
    return positionsFor(n.midi);
  });
  const own = (p) => (p.fret > comfy ? (p.fret - comfy) * 2 : 0) + p.fret * 0.08 - (p.fret === 0 ? 0.1 : 0);
  const move = (a, b) => {
    const skip = Math.max(0, Math.abs(a.string - b.string) - 1) * 0.6;
    if (a.fret === 0 || b.fret === 0) return 0.4 + skip;
    const d = Math.abs(a.fret - b.fret);
    return (d <= 3 ? d * 0.3 : 0.9 + (d - 3) * 1.2) + skip;
  };

  let cost = options[0].map(own);
  const back = [options[0].map(() => -1)];
  for (let i = 1; i < list.length; i++) {
    const next = [], from = [];
    options[i].forEach((p) => {
      let best = Infinity, arg = 0;
      options[i - 1].forEach((q, j) => {
        const c = cost[j] + move(q, p);
        if (c < best) { best = c; arg = j; }
      });
      next.push(best + own(p));
      from.push(arg);
    });
    cost = next;
    back.push(from);
  }
  let k = cost.indexOf(Math.min(...cost));
  for (let i = list.length - 1; i >= 0; i--) {
    const p = options[i][k];
    list[i].string = p.string;
    list[i].fret = p.fret;
    k = back[i][k];
  }
}
