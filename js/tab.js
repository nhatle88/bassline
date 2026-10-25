// Draws the bass line as 4-string TAB (G on top, E at the bottom), line by line.
import { STRINGS } from './theory.js';

const NS = 'http://www.w3.org/2000/svg';
const LABEL_W = 30;
const PAD_L = 16, PAD_R = 10;
const STRING_TOP = 50, STRING_GAP = 26;
const LINE_H = STRING_TOP + STRING_GAP * 3 + 34;

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}

const stringY = (s) => STRING_TOP + (3 - s) * STRING_GAP;

export function renderTab(container, song, bass, opts = {}) {
  container.innerHTML = '';
  const bpb = song.beatsPerBar;
  const width = Math.max(320, container.clientWidth - 4);

  // Bar width: room for the tightest spacing of notes, 1–4 bars per line.
  let minGap = 1;
  bass.bars.forEach((b) => {
    for (let i = 1; i < b.notes.length; i++) minGap = Math.min(minGap, b.notes[i].start - b.notes[i - 1].start || 1);
  });
  const minBar = Math.min(640, Math.max(140, (22 * bpb) / minGap + PAD_L + PAD_R));
  const perLine = Math.max(1, Math.min(4, Math.floor((width - LABEL_W) / minBar)));
  const barW = (width - LABEL_W - 2) / perLine;
  const innerW = barW - PAD_L - PAD_R;
  const xAt = (barX, beat) => barX + PAD_L + (beat / bpb) * innerW;

  const barMap = [];
  const noteEls = [];
  const lines = [];
  for (let first = 0; first < song.bars.length; first += perLine) {
    const lineEl = document.createElement('div');
    lineEl.className = 'tab-line';
    const svg = el('svg', { viewBox: `0 0 ${width} ${LINE_H}`, width: '100%', class: 'tab-svg' });
    lineEl.appendChild(svg);
    const count = Math.min(perLine, song.bars.length - first);
    const lineEnd = LABEL_W + count * barW;

    // Loop range shading
    if (opts.loop && opts.loop.on) {
      for (let k = 0; k < count; k++) {
        const bi = first + k;
        if (bi >= opts.loop.from && bi <= opts.loop.to) {
          svg.appendChild(el('rect', { x: LABEL_W + k * barW, y: STRING_TOP - 8, width: barW, height: STRING_GAP * 3 + 16, class: 'loop-shade' }));
        }
      }
    }
    // Strings + names
    STRINGS.forEach((s, i) => {
      svg.appendChild(el('line', { x1: LABEL_W - 4, x2: lineEnd, y1: stringY(i), y2: stringY(i), class: 'string' }));
      svg.appendChild(el('text', { x: 10, y: stringY(i) + 5, class: 'string-name' }, s.name));
    });

    for (let k = 0; k < count; k++) {
      const bi = first + k;
      const bar = song.bars[bi];
      const barX = LABEL_W + k * barW;
      barMap[bi] = { line: lines.length, x: barX, w: barW, xAt: (beat) => xAt(barX, beat) };

      svg.appendChild(el('rect', { x: barX, y: 0, width: barW, height: LINE_H, class: 'barhit', 'data-bar': bi }));
      svg.appendChild(el('line', { x1: barX, x2: barX, y1: stringY(3), y2: stringY(0), class: 'barline' }));
      svg.appendChild(el('text', { x: barX + 3, y: STRING_TOP - 32, class: 'bar-num', 'data-bar': bi }, bi + 1));
      if (bar.section) {
        svg.appendChild(el('text', { x: barX + 24, y: STRING_TOP - 32, class: 'section' }, bar.section));
      }
      let t = 0;
      bar.chords.forEach((c) => {
        svg.appendChild(el('text', { x: xAt(barX, t) - 4, y: STRING_TOP - 12, class: 'chord' }, c.symbol));
        t += c.beats;
      });
      for (let b = 0; b < bpb; b++) {
        svg.appendChild(el('text', { x: xAt(barX, b), y: stringY(0) + 26, class: 'beat' }, b + 1));
      }

      noteEls[bi] = [];
      (bass.bars[bi]?.notes || []).forEach((n, i) => {
        const x = xAt(barX, n.start);
        const g = el('g', { class: 'note' + (n.midi == null ? ' rest' : '') + (n.edited ? ' edited' : ''), 'data-bar': bi, 'data-i': i });
        if (n.midi == null) {
          g.appendChild(el('rect', { x: x - 14, y: STRING_TOP, width: 28, height: STRING_GAP * 3, class: 'hit' }));
          g.appendChild(el('text', { x, y: stringY(1) - STRING_GAP / 2 + 5, class: 'rest-mark' }, '–'));
        } else {
          const y = stringY(n.string);
          const xEnd = xAt(barX, n.start + n.dur);
          if (n.dur >= 1 && xEnd - x > 26) {
            g.appendChild(el('line', { x1: x + 12, x2: xEnd - 6, y1: y, y2: y, class: 'sustain' }));
          }
          const label = String(n.fret);
          const w = label.length > 1 ? 26 : 18;
          g.appendChild(el('rect', { x: x - w / 2, y: y - 11, width: w, height: 22, rx: 6, class: 'chip' }));
          g.appendChild(el('text', { x, y: y + 6, class: 'fret' }, label));
          g.appendChild(el('rect', { x: x - 16, y: y - 16, width: 32, height: 32, class: 'hit' }));
        }
        svg.appendChild(g);
        noteEls[bi][i] = g;
      });
    }
    svg.appendChild(el('line', { x1: lineEnd - 1, x2: lineEnd - 1, y1: stringY(3), y2: stringY(0), class: 'barline end' }));
    container.appendChild(lineEl);
    lines.push(lineEl);
  }

  const playhead = document.createElement('div');
  playhead.className = 'playhead';
  playhead.hidden = true;
  playhead.style.top = `${((STRING_TOP - 14) / LINE_H) * 100}%`;
  playhead.style.height = `${((STRING_GAP * 3 + 28) / LINE_H) * 100}%`;

  container.onclick = (e) => {
    const note = e.target.closest('.note');
    if (note && opts.onNoteTap) return opts.onNoteTap(Number(note.dataset.bar), Number(note.dataset.i));
    const bar = e.target.closest('[data-bar]');
    if (bar && opts.onBarTap) opts.onBarTap(Number(bar.dataset.bar));
  };

  let lastNow = null, lastLine = -1, selected = null;
  return {
    // beat: position in the song (beats from bar 1). Returns the line element when the line changes.
    setPlayhead(beat) {
      const bi = Math.floor(beat / bpb);
      const m = barMap[bi];
      if (!m || beat < 0) { playhead.hidden = true; return null; }
      const inBar = beat - bi * bpb;
      playhead.hidden = false;
      playhead.style.left = `${(m.xAt(inBar) / width) * 100}%`;
      let changed = null;
      if (m.line !== lastLine) {
        lines[m.line].appendChild(playhead);
        lastLine = m.line;
        changed = lines[m.line];
      }
      const notes = bass.bars[bi]?.notes || [];
      const idx = notes.findIndex((n) => inBar >= n.start && inBar < n.start + n.dur);
      const now = idx >= 0 ? noteEls[bi][idx] : null;
      if (now !== lastNow) {
        lastNow?.classList.remove('now');
        now?.classList.add('now');
        lastNow = now;
      }
      return changed;
    },
    clearPlayhead() {
      playhead.hidden = true;
      lastNow?.classList.remove('now');
      lastNow = null;
      lastLine = -1;
    },
    select(bi, i) {
      selected?.classList.remove('sel');
      selected = bi == null ? null : noteEls[bi]?.[i] || null;
      selected?.classList.add('sel');
    },
    lineOfBar: (bi) => (barMap[bi] ? lines[barMap[bi].line] : null),
  };
}
