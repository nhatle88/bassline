// Chord chart text <-> song bars. Format:
//   [Verse] | G | D/F# | Em C | C . . D |
// Bars are split by "|" (or each chord is one bar when there are no pipes).
// Two chords in a bar share the beats; "." adds a beat to the chord before it.
// "%" repeats the previous bar, "N.C." means no chord.
import { parseChord, isNoChord } from './theory.js';

function splitBeats(count, bpb) {
  const base = Math.floor(bpb / count);
  const beats = Array(count).fill(base);
  beats[0] += bpb - base * count;
  return beats;
}

export function parseChart(text, bpb) {
  const errors = [];
  const marked = text.replace(/\[([^\]]*)\]/g, (_, g) => ` §${encodeURIComponent(g.trim())} `);
  const hasPipe = marked.includes('|');
  const cells = hasPipe
    ? marked.split(/\||\n/)
    : marked.split(/\s+/).map((t) => t);

  const bars = [];
  let pendingSection = '';
  for (const cell of cells) {
    let tokens = cell.trim().split(/\s+/).filter(Boolean);
    tokens = tokens.filter((t) => {
      if (t.startsWith('§')) { pendingSection = decodeURIComponent(t.slice(1)); return false; }
      return true;
    });
    if (!tokens.length) continue;

    let chords;
    if (tokens.length === 1 && tokens[0] === '%') {
      const prev = bars[bars.length - 1];
      chords = prev ? prev.chords.map((c) => ({ ...c })) : [{ symbol: 'N.C.', beats: bpb }];
    } else if (tokens.some((t) => t === '.' || t === '/')) {
      chords = [];
      tokens.forEach((t) => {
        if ((t === '.' || t === '/') && chords.length) chords[chords.length - 1].beats += 1;
        else chords.push({ symbol: t, beats: 1 });
      });
      const total = chords.reduce((a, c) => a + c.beats, 0);
      if (total !== bpb) chords[chords.length - 1].beats += bpb - total;
    } else {
      const beats = splitBeats(tokens.length, bpb);
      chords = tokens.map((t, i) => ({ symbol: t, beats: beats[i] }));
    }
    chords = chords.filter((c) => c.beats > 0);
    chords.forEach((c) => {
      if (!isNoChord(c.symbol) && !parseChord(c.symbol)) errors.push(`Bar ${bars.length + 1}: can't read “${c.symbol}”`);
    });
    bars.push({ chords, section: pendingSection });
    pendingSection = '';
  }
  return { bars, errors };
}

export function chartFromSong(song, barsPerLine = 4) {
  const lines = [];
  let line = [];
  const flush = () => { if (line.length) lines.push('| ' + line.join(' | ') + ' |'); line = []; };
  song.bars.forEach((bar) => {
    if (bar.section) {
      flush();
      lines.push(`[${bar.section}]`);
    }
    const even = bar.chords.every((c) => c.beats === bar.chords[0].beats);
    const cell = even
      ? bar.chords.map((c) => c.symbol).join(' ')
      : bar.chords.map((c) => [c.symbol, ...Array(Math.max(0, Math.round(c.beats) - 1)).fill('.')].join(' ')).join(' ');
    line.push(cell);
    if (line.length === barsPerLine) flush();
  });
  flush();
  return lines.join('\n');
}

export const DEMOS = [
  {
    title: 'Demo – Worship in G',
    bpm: 72,
    beatsPerBar: 4,
    key: 'G',
    chart: `[Verse]
| G | D/F# | Em | C |
| G | D/F# | C | C |
[Chorus]
| C | G | D | Em |
| C | G | D | D |`,
  },
  {
    title: 'Demo – Pop in C',
    bpm: 100,
    beatsPerBar: 4,
    key: 'C',
    chart: `[Verse]
| C | G | Am | F |
| C | G | F | F |
[Chorus]
| F | G | Am | Am |
| F | G | C | C |`,
  },
  {
    title: 'Demo – Jazz ii–V–I',
    bpm: 120,
    beatsPerBar: 4,
    key: 'C',
    chart: `[A]
| Dm7 | G7 | Cmaj7 | Cmaj7 |
| Em7 A7 | Dm7 G7 | Cmaj7 | A7 |
[B]
| Fmaj7 | Bb7 | Em7 | A7 |
| Dm7 | G7 | C6 | C6 |`,
  },
];
