import { STYLES, LEVELS, generateBass, generateBar, lastMidiOf, chordAt, segmentsOf } from './generator.js';
import { assignFingering, positionsFor, STRINGS, noteName, describeInChord, chordToneNames, pcOf, LOWEST, HIGHEST } from './theory.js';
import { parseChart, chartFromSong, DEMOS } from './chart.js';
import { renderTab } from './tab.js';
import { Player } from './player.js';
import { SheetView, filesToPages, MAX_PAGES } from './sheet.js';
import { readSheet, SheetReadError } from './ai.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);

// ---------- icons ----------
const ICONS = {
  logo: '<path d="M3 6h18M3 10h18M3 14h18M3 18h18" opacity=".45"/><circle cx="9" cy="14" r="3" fill="currentColor" stroke="none"/><path d="M12 14V4l5 2"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  sparkles: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  songs: '<path d="M3 6h11M3 11h11M3 16h7"/><circle cx="17" cy="17" r="2.5"/><path d="M19.5 17V5l-3 1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
  rewind: '<path d="M6 5v14"/><path d="M18 5l-9 7 9 7z" fill="currentColor"/>',
  loop: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
document.querySelectorAll('[data-icon]').forEach((e) => { e.innerHTML = icon(e.dataset.icon); });

// ---------- preferences (this device only) ----------
const DEFAULT_PREFS = {
  apiKey: '', view: 'split', split: 50, scrollMode: 'follow', speed: 25, zoom: 1,
  nightSheet: false, countIn: true, mix: { bass: true, click: true, chords: false, swing: false }, lastId: null,
};
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('bassline.prefs') || '{}');
    return { ...DEFAULT_PREFS, ...p, mix: { ...DEFAULT_PREFS.mix, ...(p.mix || {}) } };
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
}
const prefs = loadPrefs();
function savePrefs() {
  try { localStorage.setItem('bassline.prefs', JSON.stringify(prefs)); } catch { /* private mode */ }
}

// ---------- state ----------
const state = {
  id: null, title: '', pages: [], song: null, bass: null,
  style: 'root5', level: 'normal', seed: 1, edited: false, bpm: 90,
  loop: { on: false, from: 0, to: 3 }, startBar: 0, sel: null, steadyOnly: false,
};
const player = new Player();
player.mix = prefs.mix;
const sheet = new SheetView($('sheetScroll'), $('pages'));
let tabView = null;

const bpb = () => state.song?.beatsPerBar || 4;
const preferFlat = () => {
  const s = (state.song?.bars || []).flatMap((b) => b.chords.map((c) => c.symbol)).join(' ');
  return (s.match(/b/g) || []).length > (s.match(/#/g) || []).length || /^(F|Bb|Eb|Ab|Db|Gb|Dm|Gm|Cm|Fm)/.test(state.song?.key || '');
};

// ---------- toast & progress ----------
let toastTimer = null;
function toast(msg, kind = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 6000 : 3800);
}
let progressTimer = null;
function showProgress(text, onCancel) {
  $('progressText').textContent = text;
  $('progressCancel').hidden = !onCancel;
  $('progressCancel').onclick = onCancel || null;
  const t0 = Date.now();
  $('progressTime').textContent = '';
  clearInterval(progressTimer);
  progressTimer = setInterval(() => { $('progressTime').textContent = `${Math.round((Date.now() - t0) / 1000)} s`; }, 1000);
  if (!$('progressDialog').open) $('progressDialog').showModal();
}
const setProgress = (text) => { $('progressText').textContent = text; };
function hideProgress() {
  clearInterval(progressTimer);
  if ($('progressDialog').open) $('progressDialog').close();
}

// ---------- building the bass line ----------
function regenerate() {
  if (!state.song) return;
  state.bass = generateBass(state.song, { style: state.style, level: state.level, seed: state.seed });
  assignFingering(state.bass.bars, state.level);
  state.edited = false;
  refresh();
}

function swing(beat) {
  const whole = Math.floor(beat);
  return Math.abs(beat - whole - 0.5) < 1e-6 ? whole + 2 / 3 : beat;
}

function buildEvents() {
  if (!state.song || !state.bass) { player.load([], 0, 4); return; }
  const n = bpb();
  const doSwing = prefs.mix.swing;
  const events = [];
  state.bass.bars.forEach((bar, bi) => {
    bar.notes.forEach((note) => {
      if (note.midi == null) return;
      let s = bi * n + note.start, e = s + note.dur;
      if (doSwing) { s = swing(s); e = swing(e); }
      events.push({ beat: s, dur: e - s, kind: 'bass', midi: note.midi });
    });
  });
  segmentsOf(state.song).forEach((seg) => {
    if (!seg.chord) return;
    const midis = seg.chord.tones.slice(0, 4).map((t) => 53 + pcOf(seg.chord.root + t - 53));
    events.push({ beat: seg.bar * n + seg.start, dur: seg.beats, kind: 'chord', midis });
  });
  player.load(events, state.song.bars.length * n, n);
}

function loopBeats() {
  if (!state.loop.on || !state.song) return null;
  return { start: state.loop.from * bpb(), end: (state.loop.to + 1) * bpb() };
}

// ---------- rendering ----------
function renderTabView() {
  const box = $('tab');
  $('tabEmpty').hidden = !!state.song;
  if (!state.song || !state.bass) { box.innerHTML = ''; tabView = null; return; }
  tabView = renderTab(box, state.song, state.bass, {
    loop: state.loop,
    onNoteTap: openEditor,
    onBarTap: (bi) => seekBar(bi),
  });
  if (state.sel) tabView.select(state.sel.bi, state.sel.i);
  if (!player.playing) tabView.setPlayhead(state.startBar * bpb());
}

function refresh() {
  renderTabView();
  buildEvents();
  updateUI();
  scheduleSave();
}

function updateUI() {
  const song = state.song;
  $('songTitle').textContent = song?.title || state.title || 'BassLine';
  $('printTitle').textContent = song ? `${song.title}${song.key ? ' · key ' + song.key : ''} · ${STYLES.find((s) => s.id === state.style).name}` : '';
  $('sheetEmpty').hidden = sheet.hasPages;
  $('readBtn').disabled = !sheet.hasPages;
  $('bpmNum').textContent = state.bpm;
  $('styleSelect').value = state.style;
  $('styleHint').textContent = STYLES.find((s) => s.id === state.style).hint;
  [...$('levelSeg').children].forEach((b) => b.classList.toggle('on', b.dataset.level === state.level));
  [...$('viewSeg').children].forEach((b) => b.classList.toggle('on', b.dataset.view === prefs.view));
  const mode = song ? prefs.scrollMode : 'steady';
  [...$('scrollSeg').children].forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === mode);
    b.disabled = !song && b.dataset.mode === 'follow';
  });
  $('speed').hidden = mode !== 'steady';
  $('loopBtn').classList.toggle('on', state.loop.on);
  const notes = song?.notes || '';
  $('songNotes').hidden = !notes;
  $('songNotes').textContent = notes ? `From the sheet: ${notes}` : '';
  updatePlayButton();
  updatePos(state.startBar * bpb());
}

function updatePlayButton() {
  const on = player.playing || state.steadyOnly;
  $('playBtn').innerHTML = icon(on ? 'pause' : 'play');
  $('playBtn').setAttribute('aria-label', on ? 'Pause' : 'Play');
}

let lastPosText = '';
function updatePos(beat) {
  const song = state.song;
  const text = song ? `Bar ${Math.min(song.bars.length, Math.floor(Math.max(0, beat) / bpb()) + 1)} / ${song.bars.length}` : '';
  if (text !== lastPosText) { $('posLabel').textContent = text; lastPosText = text; }
}

function applyView() {
  const stage = $('stage');
  stage.className = `stage view-${prefs.view}`;
  $('sheetPane').style.flexBasis = `${prefs.split}%`;
  $('tabPane').style.flexBasis = `${100 - prefs.split}%`;
  $('pages').classList.toggle('night', prefs.nightSheet);
  sheet.setZoom(prefs.zoom);
  requestAnimationFrame(() => renderTabView());
}

// ---------- playback ----------
let wake = null;
async function keepAwake(on) {
  try {
    if (on && !wake && 'wakeLock' in navigator) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } else if (!on && wake) {
      await wake.release();
      wake = null;
    }
  } catch { /* not allowed here (e.g. http) */ }
}

function startPlay() {
  closePopovers();
  if (state.song && state.bass) {
    player.bpm = state.bpm;
    player.countIn = prefs.countIn;
    player.loop = loopBeats();
    player.play(Math.min(state.startBar, state.song.bars.length - 1) * bpb());
  } else if (sheet.hasPages) {
    state.steadyOnly = true;
  } else {
    toast('Open a sheet or try a demo song first.');
    return;
  }
  keepAwake(true);
  updatePlayButton();
}

function stopPlay() {
  if (player.playing) {
    const p = player.position();
    player.stop();
    if (p != null && p > 0 && state.song) state.startBar = Math.min(state.song.bars.length - 1, Math.floor(p / bpb()));
  }
  state.steadyOnly = false;
  $('countIn').hidden = true;
  tabView?.clearPlayhead();
  tabView?.setPlayhead(state.startBar * bpb());
  keepAwake(false);
  updatePlayButton();
  scheduleSave();
}

const togglePlay = () => (player.playing || state.steadyOnly ? stopPlay() : startPlay());

player.onEnd = () => {
  state.startBar = 0;
  stopPlay();
};

function seekBar(bi) {
  state.startBar = bi;
  if (player.playing) {
    player.loop = loopBeats();
    player.play(bi * bpb());
  } else {
    tabView?.setPlayhead(bi * bpb());
    updatePos(bi * bpb());
    followSheetNow(bi * bpb());
  }
}

function rewind() {
  state.startBar = state.loop.on ? state.loop.from : 0;
  if (player.playing) player.play(state.startBar * bpb());
  else {
    $('sheetScroll').scrollTop = 0;
    sheet.pos = 0;
    $('tabScroll').scrollTop = 0;
    tabView?.setPlayhead(state.startBar * bpb());
    updatePos(state.startBar * bpb());
  }
}

function setTempo(bpm) {
  state.bpm = Math.max(30, Math.min(240, Math.round(bpm)));
  player.setTempo(state.bpm);
  $('bpmNum').textContent = state.bpm;
  $('tempoRange').value = state.bpm;
  const base = state.song?.bpm;
  $('tempoPct').textContent = base ? `${Math.round((state.bpm / base) * 100)}% of song tempo (${base})` : '';
  scheduleSave();
}

// Where the sheet should be for a song position (content y).
function followY(beat) {
  const song = state.song;
  const n = bpb();
  const bi = Math.max(0, Math.min(song.bars.length - 1, Math.floor(beat / n)));
  const sys = song.systems || [];
  const bar = song.bars[bi];
  if (sys.length && bar.system != null && sys[bar.system]) {
    const cur = sys[bar.system];
    let y = sheet.pageY(cur.page, cur.top);
    const next = song.bars[bi + 1];
    const frac = (beat - bi * n) / n;
    if (next && next.system !== bar.system && sys[next.system] && frac > 0.5) {
      const ny = sheet.pageY(sys[next.system].page, sys[next.system].top);
      y += (ny - y) * (frac - 0.5) * 2;
    }
    return y;
  }
  const el = $('sheetScroll');
  const total = song.bars.length * n;
  return (Math.max(0, beat) / total) * (el.scrollHeight - el.clientHeight) + el.clientHeight * 0.12;
}

function followSheetNow(beat) {
  if (!sheet.hasPages || !state.song || prefs.scrollMode !== 'follow') return;
  const el = $('sheetScroll');
  const y = Math.max(0, followY(beat) - el.clientHeight * 0.12);
  el.scrollTo({ top: y, behavior: 'smooth' });
  sheet.pos = y;
}

const speedPx = () => 4 + prefs.speed * 1.6;

// Tab pane: keep the playing line in view unless the user is scrolling it.
let tabTouchUntil = 0;
$('tabScroll').addEventListener('pointerdown', () => { tabTouchUntil = performance.now() + 4000; }, { passive: true });
$('tabScroll').addEventListener('wheel', () => { tabTouchUntil = performance.now() + 4000; }, { passive: true });
function scrollTabTo(line) {
  if (performance.now() < tabTouchUntil) return;
  const sc = $('tabScroll');
  const top = line.offsetTop, bottom = top + line.offsetHeight;
  if (top < sc.scrollTop + 8 || bottom > sc.scrollTop + sc.clientHeight - 8) {
    sc.scrollTo({ top: Math.max(0, top - sc.clientHeight * 0.15), behavior: 'smooth' });
  }
}

let lastFrame = performance.now();
function frame(t) {
  const dt = Math.min(0.25, (t - lastFrame) / 1000);
  lastFrame = t;
  const pos = player.position();
  if (player.playing && pos != null) {
    const counting = player.inCountIn();
    const ci = $('countIn');
    if (counting) {
      const num = Math.floor(pos - (player.songStart - bpb())) + 1;
      ci.hidden = false;
      if (ci.textContent !== String(num)) ci.textContent = num;
    } else if (!ci.hidden) ci.hidden = true;

    if (!counting) {
      const line = tabView?.setPlayhead(pos);
      if (line) scrollTabTo(line);
      updatePos(pos);
      if (sheet.hasPages) {
        if (prefs.scrollMode === 'steady') sheet.stepSteady(speedPx(), dt);
        else sheet.stepFollow(followY(pos));
      }
    }
  } else if (state.steadyOnly) {
    sheet.stepSteady(speedPx(), dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Tap the sheet (without scrolling) to play / pause.
{
  let down = null;
  const el = $('sheetScroll');
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), top: el.scrollTop }; }, { passive: true });
  el.addEventListener('pointerup', (e) => {
    if (!down || !sheet.hasPages || e.target.closest('.empty, button, label')) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) + Math.abs(el.scrollTop - down.top);
    if (moved < 10 && performance.now() - down.t < 350) {
      sheet.holdUntil = 0;
      togglePlay();
    }
    down = null;
  });
}

// ---------- note editor ----------
function openEditor(bi, i) {
  state.sel = { bi, i };
  tabView?.select(bi, i);
  fillEditor();
  $('noteEditor').hidden = false;
  closePopovers();
}

function closeEditor() {
  state.sel = null;
  tabView?.select(null);
  $('noteEditor').hidden = true;
}

const fmtBeat = (b) => {
  const whole = Math.floor(b) + 1, frac = b - Math.floor(b);
  return frac === 0 ? `${whole}` : frac === 0.5 ? `${whole} &` : `${(b + 1).toFixed(2)}`;
};

function fillEditor() {
  const { bi, i } = state.sel;
  const n = state.bass.bars[bi].notes[i];
  const chord = chordAt(state.song, bi, n.start);
  const flat = preferFlat();
  if (n.midi == null) {
    $('neTitle').textContent = 'Rest';
    $('neSub').textContent = `Bar ${bi + 1}, beat ${fmtBeat(n.start)}`;
  } else {
    $('neTitle').textContent = `${noteName(n.midi, flat)} · ${STRINGS[n.string].name} string, fret ${n.fret}`;
    $('neSub').textContent = `Bar ${bi + 1}, beat ${fmtBeat(n.start)} · ${describeInChord(n.midi, chord)}`;
  }
  $('neTones').textContent = chord ? `Notes in ${chord.symbol}: ${chordToneNames(chord, flat)}` : 'No chord here';
  $('neRest').textContent = n.midi == null ? 'Make note' : 'Make rest';
  document.querySelectorAll('.ne-buttons [data-act]').forEach((b) => {
    if (b.dataset.act !== 'rest' && b.dataset.act !== 'idea') b.disabled = n.midi == null;
  });
}

function editNote(act) {
  if (!state.sel) return;
  const { bi, i } = state.sel;
  const n = state.bass.bars[bi].notes[i];
  if (act === 'hear') { if (n.midi != null) player.preview(n.midi); return; }
  if (act === 'idea') return newIdeaForBar(bi);

  let pitchChanged = false;
  if (act === 'up' && n.midi < HIGHEST) { n.midi += 1; pitchChanged = true; }
  if (act === 'down' && n.midi > LOWEST) { n.midi -= 1; pitchChanged = true; }
  if (act === 'oct-up' && n.midi + 12 <= HIGHEST) { n.midi += 12; pitchChanged = true; }
  if (act === 'oct-down' && n.midi - 12 >= LOWEST) { n.midi -= 12; pitchChanged = true; }
  if (act === 'string') {
    // Cycle through the playable spots, low frets first (skip very high frets when there's a choice).
    let spots = positionsFor(n.midi).sort((a, b) => a.fret - b.fret);
    if (spots.filter((s) => s.fret <= 12).length >= 2) spots = spots.filter((s) => s.fret <= 12);
    if (spots.length < 2) { toast('This note can only be played in one place.'); return; }
    const k = spots.findIndex((p) => p.string === n.string);
    const p = spots[(k + 1) % spots.length];
    n.string = p.string;
    n.fret = p.fret;
    n.pin = true;
  }
  if (act === 'rest') {
    if (n.midi == null) {
      const chord = chordAt(state.song, bi, n.start);
      n.midi = n.was ?? (chord ? 28 + pcOf(chord.bass - 28) : 33);
      pitchChanged = true;
    } else {
      n.was = n.midi;
      n.midi = null;
    }
  }
  if (pitchChanged) {
    n.pin = false;
    assignFingering(state.bass.bars, state.level);
    n.pin = true;
    player.preview(n.midi);
  }
  n.edited = true;
  state.edited = true;
  refresh();
  fillEditor();
}

function newIdeaForBar(bi) {
  const prev = bi > 0 ? lastMidiOf(state.bass.bars[bi - 1]) : null;
  const seed = Math.floor(Math.random() * 1e9);
  const style = state.style === 'sheet' ? 'walking' : state.style;
  const level = state.level === 'easy' ? 'normal' : state.level;
  const bar = generateBar(state.song, bi, { style, level, seed: state.seed, barSeed: seed, vary: true }, prev);
  bar.notes.forEach((n) => { n.edited = true; });
  state.bass.bars[bi] = bar;
  assignFingering(state.bass.bars, state.level);
  state.edited = true;
  state.sel = { bi, i: 0 };
  refresh();
  fillEditor();
}

document.querySelector('.ne-buttons').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) editNote(b.dataset.act);
});
$('neClose').onclick = closeEditor;

// ---------- songs: open / demo / read / save ----------
function setSong(song, { keepBass = null } = {}) {
  state.song = song;
  state.bpm = song.bpm;
  state.startBar = 0;
  state.sel = null;
  $('noteEditor').hidden = true;
  state.loop = { on: false, from: 0, to: Math.min(3, song.bars.length - 1) };
  fillLoopSelects();
  setTempo(song.bpm);
  if (keepBass) {
    state.bass = keepBass;
    refresh();
  } else {
    regenerate();
  }
}

async function openFiles(files) {
  if (!files || !files.length) return;
  stopPlay();
  showProgress('Opening sheet…');
  try {
    const { pages, truncated } = await filesToPages(files, setProgress);
    if (!pages.length) throw new Error('no pages found');
    state.id = store.newId();
    state.title = files[0].name.replace(/\.[^.]+$/, '');
    state.pages = pages;
    state.song = null;
    state.bass = null;
    state.edited = false;
    state.startBar = 0;
    closeEditor();
    sheet.show(pages);
    if (prefs.view === 'tab') { prefs.view = 'split'; applyView(); }
    prefs.lastId = state.id;
    savePrefs();
    try { await store.savePages(state.id, pages); } catch (e) { console.warn('pages not saved', e); }
    refresh();
    toast(truncated ? `Showing the first ${MAX_PAGES} pages.` : 'Sheet opened. Tap “Read sheet” to get chords and a bass line.');
  } catch (e) {
    console.error(e);
    toast(`Couldn't open this file (${e.message}).`, 'error');
  } finally {
    hideProgress();
  }
}

function loadDemo(demo) {
  stopPlay();
  const { bars } = parseChart(demo.chart, demo.beatsPerBar);
  state.id = store.newId();
  state.title = demo.title;
  state.pages = [];
  sheet.show([]);
  state.style = /Jazz/.test(demo.title) ? 'walking' : state.style === 'sheet' ? 'root5' : state.style;
  prefs.mix.swing = state.style === 'walking';
  syncMixBoxes();
  prefs.lastId = state.id;
  savePrefs();
  prefs.view = 'tab'; // a demo has no sheet to show
  applyView();
  setSong({ title: demo.title, bpm: demo.bpm, beatsPerBar: demo.beatsPerBar, key: demo.key, systems: [], notes: '', bars: bars.map((b) => ({ ...b, system: null, bass: [] })) });
}

async function onRead() {
  if (!sheet.hasPages) return toast('Open a sheet first.');
  if (!prefs.apiKey) return openSettings('Add your Claude API key to read sheets.');
  if (state.song && !confirm('Read the sheet again? This replaces the chords and bass line.')) return;
  stopPlay();
  const ac = new AbortController();
  showProgress('Getting ready…', () => ac.abort());
  try {
    const song = await readSheet({ apiKey: prefs.apiKey, pages: state.pages, signal: ac.signal, onStatus: setProgress });
    if (!song.bars.length) throw new SheetReadError('No bars were found on this sheet.');
    if (song.hasBassPart) state.style = 'sheet';
    else if (state.style === 'sheet') state.style = 'root5';
    setSong(song);
    const bits = [`${song.bars.length} bars`, `${song.beatsPerBar} beats/bar`];
    if (song.key) bits.push(`key ${song.key}`);
    bits.push(song.hasBassPart ? 'bass part found ✓' : song.chordsFrom === 'inferred_from_notes' ? 'chords worked out from the notes' : 'chords read');
    toast(`Done: ${bits.join(' · ')}. Check the chords with “Chords”.`);
  } catch (e) {
    console.error(e);
    toast(e instanceof SheetReadError ? e.message : `Something went wrong: ${e.message}`, 'error');
  } finally {
    hideProgress();
  }
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}
async function saveNow() {
  if (!state.id || (!state.pages.length && !state.song)) return;
  try {
    await store.saveSong({
      id: state.id,
      title: state.song?.title || state.title || 'Untitled',
      updated: Date.now(),
      pageCount: state.pages.length,
      song: state.song, bass: state.bass,
      style: state.style, level: state.level, seed: state.seed, edited: state.edited,
      bpm: state.bpm, startBar: state.startBar, loop: state.loop,
    });
  } catch (e) {
    console.warn('save failed', e);
  }
}

async function openSaved(id) {
  const rec = await store.getSong(id);
  if (!rec) return false;
  stopPlay();
  closeEditor();
  state.id = rec.id;
  state.title = rec.title;
  state.pages = rec.pageCount ? await store.getPages(rec.id) : [];
  sheet.show(state.pages);
  Object.assign(state, { style: rec.style, level: rec.level, seed: rec.seed, edited: rec.edited });
  state.song = rec.song;
  state.bass = rec.bass;
  if (rec.song) {
    state.loop = rec.loop || { on: false, from: 0, to: 3 };
    fillLoopSelects();
    setTempo(rec.bpm || rec.song.bpm);
    state.startBar = rec.startBar || 0;
  }
  prefs.lastId = rec.id;
  savePrefs();
  refresh();
  return true;
}

// ---------- chords dialog ----------
function openChords() {
  const song = state.song;
  $('cTitle').value = song?.title || state.title || '';
  $('cBpm').value = song?.bpm || 90;
  $('cBeats').value = String(song?.beatsPerBar || 4);
  $('cKey').value = song?.key || '';
  $('cChart').value = song ? chartFromSong(song) : '';
  $('cErrors').innerHTML = '';
  $('cApply').textContent = 'Apply';
  $('cApply').dataset.force = '';
  $('chordDialog').showModal();
}

$('chordForm').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'apply') return;
  const beats = Number($('cBeats').value);
  const { bars, errors } = parseChart($('cChart').value, beats);
  if (!bars.length) {
    e.preventDefault();
    $('cErrors').innerHTML = '<li>Type at least one chord, like <code>| C | G | Am | F |</code></li>';
    return;
  }
  if (errors.length && !$('cApply').dataset.force) {
    e.preventDefault();
    $('cErrors').innerHTML = errors.map((x) => `<li>${x.replace(/</g, '&lt;')}</li>`).join('');
    $('cApply').textContent = 'Apply anyway';
    $('cApply').dataset.force = '1';
    return;
  }
  applyChart(bars, beats);
});

function applyChart(bars, beats) {
  const old = state.song;
  const song = {
    ...(old || { systems: [], notes: '' }),
    title: $('cTitle').value.trim() || old?.title || state.title || 'Untitled',
    bpm: Math.max(30, Math.min(260, Number($('cBpm').value) || 90)),
    beatsPerBar: beats,
    key: $('cKey').value.trim(),
    bars: bars.map((b, i) => ({ ...b, system: old?.bars[i]?.system ?? null, bass: old?.bars[i]?.bass ?? [] })),
  };
  if (!old || !state.bass || old.beatsPerBar !== beats) {
    setSong(song);
    return;
  }
  // Keep bars whose chords didn't change (and your edits in them).
  const same = (a, b) => a && b && JSON.stringify(a.chords) === JSON.stringify(b.chords);
  const opts = { style: state.style, level: state.level, seed: state.seed };
  const segs = segmentsOf(song);
  const out = [];
  song.bars.forEach((bar, i) => {
    if (same(bar, old.bars[i]) && state.bass.bars[i]) out.push(state.bass.bars[i]);
    else out.push(generateBar(song, i, opts, i ? lastMidiOf(out[i - 1]) : null, segs));
  });
  state.song = song;
  if (song.bpm !== old.bpm) setTempo(song.bpm);
  state.bass = { bars: out };
  assignFingering(state.bass.bars, state.level);
  fillLoopSelects();
  refresh();
}

// ---------- settings / library ----------
function openSettings(msg = '') {
  $('settingsMsg').textContent = msg;
  $('apiKey').value = prefs.apiKey;
  $('nightSheet').checked = prefs.nightSheet;
  $('settingsDialog').showModal();
}
$('settingsDialog').addEventListener('close', () => {
  if ($('settingsDialog').returnValue !== 'save') return;
  prefs.apiKey = $('apiKey').value.trim();
  prefs.nightSheet = $('nightSheet').checked;
  savePrefs();
  applyView();
  if (prefs.apiKey && $('settingsMsg').textContent) toast('Key saved. Tap “Read sheet” again.');
});

async function openLibrary() {
  const list = $('libraryList');
  let songs = [];
  try { songs = await store.listSongs(); } catch { /* storage blocked */ }
  list.innerHTML = songs.length ? '' : '<li class="muted">No saved songs yet. Open a sheet or a demo to start.</li>';
  songs.forEach((s) => {
    const li = document.createElement('li');
    const bars = s.song ? `${s.song.bars.length} bars · ${STYLES.find((x) => x.id === s.style)?.name || ''}` : 'not read yet';
    li.innerHTML = `<div class="meta"><b></b><span>${bars} · ${new Date(s.updated).toLocaleDateString()}</span></div>
      <button type="button" class="btn" data-open>Open</button>
      <button type="button" class="btn icon del" data-del aria-label="Delete">✕</button>`;
    li.querySelector('b').textContent = s.title;
    li.querySelector('[data-open]').onclick = async () => { $('libraryDialog').close(); await openSaved(s.id); };
    li.querySelector('[data-del]').onclick = async () => {
      if (!confirm(`Delete “${s.title}” from this device?`)) return;
      await store.deleteSong(s.id);
      if (s.id === state.id) state.id = null;
      openLibrary();
    };
    list.appendChild(li);
  });
  if (!$('libraryDialog').open) $('libraryDialog').showModal();
}

// ---------- popovers ----------
const POPS = ['tempoPop', 'loopPop', 'mixPop'];
function closePopovers(except) { POPS.forEach((p) => { if (p !== except) $(p).hidden = true; }); }
function togglePop(id) {
  const show = $(id).hidden;
  closePopovers();
  $(id).hidden = !show;
}
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.popover, #tempoVal, #loopBtn, #mixBtn')) closePopovers();
});

function fillLoopSelects() {
  const song = state.song;
  const opts = (song?.bars || []).map((b, i) => `<option value="${i}">${i + 1}${b.section ? ' · ' + b.section.replace(/</g, '') : ''}</option>`).join('');
  $('loopFrom').innerHTML = opts;
  $('loopTo').innerHTML = opts;
  $('loopFrom').value = state.loop.from;
  $('loopTo').value = state.loop.to;
  $('loopToggle').textContent = state.loop.on ? 'Loop off' : 'Loop on';
}
function updateLoop() {
  let from = Number($('loopFrom').value), to = Number($('loopTo').value);
  if (to < from) [from, to] = [to, from];
  state.loop.from = from;
  state.loop.to = to;
  player.loop = loopBeats();
  $('loopToggle').textContent = state.loop.on ? 'Loop off' : 'Loop on';
  if (state.loop.on) state.startBar = from;
  renderTabView();
  updateUI();
  scheduleSave();
}

function syncMixBoxes() {
  document.querySelectorAll('[data-mix]').forEach((b) => { b.checked = !!prefs.mix[b.dataset.mix]; });
  $('countInBox').checked = prefs.countIn;
}

// ---------- wiring ----------
STYLES.forEach((s) => $('styleSelect').add(new Option(s.name, s.id)));
LEVELS.forEach((l) => {
  const b = document.createElement('button');
  b.textContent = l.name;
  b.dataset.level = l.id;
  $('levelSeg').appendChild(b);
});
DEMOS.forEach((d) => {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = d.title.replace('Demo – ', '');
  b.onclick = () => loadDemo(d);
  $('demoList').appendChild(b);
});

const confirmReplace = () => !state.edited || confirm('Replace your edits with a new bass line?');

$('styleSelect').onchange = (e) => {
  if (!confirmReplace()) { e.target.value = state.style; return; }
  state.style = e.target.value;
  if (state.style === 'sheet' && state.song && !state.song.hasBassPart) toast('No bass part found on this sheet, so it plays roots instead.');
  if (state.style === 'walking' && !prefs.mix.swing) { prefs.mix.swing = true; syncMixBoxes(); savePrefs(); }
  regenerate();
};
$('levelSeg').onclick = (e) => {
  const b = e.target.closest('[data-level]');
  if (!b || b.dataset.level === state.level || !confirmReplace()) return;
  state.level = b.dataset.level;
  regenerate();
};
$('ideaBtn').onclick = () => {
  if (!state.song) return toast('Add chords first.');
  if (!confirmReplace()) return;
  state.seed += 1;
  if (state.style === 'sheet') toast('“From the sheet” has one version. Pick another style for new ideas.');
  regenerate();
};
$('printBtn').onclick = () => (state.song ? window.print() : toast('Nothing to print yet.'));

// Copy the list first: clearing the input empties its live FileList.
$('fileInput').onchange = (e) => { openFiles([...e.target.files]); e.target.value = ''; };
$('fileInput2').onchange = (e) => { openFiles([...e.target.files]); e.target.value = ''; };
$('readBtn').onclick = onRead;
$('chordsBtn').onclick = openChords;
$('libraryBtn').onclick = openLibrary;
$('settingsBtn').onclick = () => openSettings();
$('viewSeg').onclick = (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  prefs.view = b.dataset.view;
  savePrefs();
  applyView();
  updateUI();
};

$('playBtn').onclick = togglePlay;
$('rewindBtn').onclick = rewind;
$('slowerBtn').onclick = () => setTempo(state.bpm - 5);
$('fasterBtn').onclick = () => setTempo(state.bpm + 5);
$('tempoVal').onclick = () => togglePop('tempoPop');
$('tempoRange').oninput = (e) => setTempo(Number(e.target.value));
$('tempoReset').onclick = () => state.song && setTempo(state.song.bpm);
$('scrollSeg').onclick = (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.disabled) return;
  prefs.scrollMode = b.dataset.mode;
  savePrefs();
  updateUI();
};
$('speed').value = prefs.speed;
$('speed').oninput = (e) => { prefs.speed = Number(e.target.value); savePrefs(); };
$('loopBtn').onclick = () => (state.song ? togglePop('loopPop') : toast('Add chords first.'));
$('loopFrom').onchange = updateLoop;
$('loopTo').onchange = updateLoop;
$('loopToggle').onclick = () => { state.loop.on = !state.loop.on; updateLoop(); };
$('mixBtn').onclick = () => togglePop('mixPop');
document.querySelectorAll('[data-mix]').forEach((box) => {
  box.onchange = () => {
    prefs.mix[box.dataset.mix] = box.checked;
    savePrefs();
    if (box.dataset.mix === 'swing') buildEvents();
  };
});
$('countInBox').onchange = (e) => { prefs.countIn = e.target.checked; player.countIn = prefs.countIn; savePrefs(); };

$('zoomIn').onclick = () => { prefs.zoom = Math.min(2.5, +(prefs.zoom + 0.15).toFixed(2)); sheet.setZoom(prefs.zoom); savePrefs(); };
$('zoomOut').onclick = () => { prefs.zoom = Math.max(0.5, +(prefs.zoom - 0.15).toFixed(2)); sheet.setZoom(prefs.zoom); savePrefs(); };

// Drag the divider to resize sheet vs tab.
{
  const div = $('divider');
  let dragging = false;
  div.addEventListener('pointerdown', (e) => { dragging = true; div.setPointerCapture(e.pointerId); });
  div.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = $('stage').getBoundingClientRect();
    const column = getComputedStyle($('stage')).flexDirection === 'column';
    const ratio = column ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    prefs.split = Math.round(Math.max(20, Math.min(80, ratio * 100)));
    $('sheetPane').style.flexBasis = `${prefs.split}%`;
    $('tabPane').style.flexBasis = `${100 - prefs.split}%`;
  });
  const end = () => { if (dragging) { dragging = false; savePrefs(); renderTabView(); } };
  div.addEventListener('pointerup', end);
  div.addEventListener('pointercancel', end);
}

// Re-layout the tab when its pane changes size (rotation, divider, view switch).
{
  let w = 0, timer = null;
  new ResizeObserver(([entry]) => {
    const nw = Math.round(entry.contentRect.width);
    if (Math.abs(nw - w) < 8) return;
    w = nw;
    clearTimeout(timer);
    timer = setTimeout(renderTabView, 120);
  }).observe($('tabScroll'));
}

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, dialog')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

// ---------- start ----------
syncMixBoxes();
applyView();
updateUI();
if (prefs.lastId) {
  openSaved(prefs.lastId).catch((e) => console.warn('could not restore last song', e));
}
