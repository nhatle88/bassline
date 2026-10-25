// Reads a music sheet with Claude: chords per bar, the bass part (if any)
// and where each line of music sits on the page (for auto-scroll).
import { parseNoteName, foldToBass } from './theory.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.132.0/+esm';
const MODEL = 'claude-opus-5-5';

const SYSTEM = `You read printed sheet music for a bass guitarist who cannot read standard notation. \
An app turns your answer into bass TAB and a playable bass line, so be careful and complete: every bar matters.

How to read the score:
- Read all pages in order. List bars in the order they are PLAYED: expand repeat signs and 1st/2nd endings, \
and follow D.C., D.S., Fine and Coda when they are clearly marked. Mention what you expanded in "notes".
- "systems": every line of music (system) on every page, top to bottom, with its page (1-based) and its top and \
bottom edge as a fraction (0–1) of the page height. For each bar, "system" is the 0-based index into this list of \
the line where that bar is printed (a repeated bar points back to where it is printed).
- "chords": the chord symbols for the bar, each with how many beats it lasts; the beats in a bar add up to the time \
signature's top number. If a bar has no new symbol, repeat the chord that is still sounding. Write standard symbols \
like C, Am7, F/A, Bb7, F#m7b5, Cmaj7, Dsus4, N.C. If the score has no chord symbols (common in full band or choir \
scores), work out the harmony from the notes (bass line, piano, guitar, voices) and set chords_from to \
"inferred_from_notes".
- "bass": only if the score has a bass part (a staff named Bass, Bass Guitar, Electric Bass, Bass Gtr., \
Contrabass, Double Bass or similar). Give its notes for the bar as WRITTEN pitch in scientific pitch notation \
(C4 = middle C; a bass guitar's open low E string is written E2), each with its length in beats. Use "rest" for \
rests, merge tied notes into one note, and make the beats add up to the bar length. Do not use a piano left hand \
or a choir part as the bass part. If there is no bass part, set has_bass_part to false and leave every "bass" empty.
- A beat is the note value of the time signature's bottom number (in 4/4 a quarter note = 1 beat, in 6/8 an eighth \
note = 1 beat). If the music starts with a pickup bar, output it as a full bar padded with rests at the start.
- "tempo_bpm": the marked tempo, or a typical tempo for the style if none is marked.
- "section": a rehearsal mark or section name that starts at this bar (Intro, Verse 1, Chorus, A, B…), else "".`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'tempo_bpm', 'time_signature_beats', 'key', 'has_bass_part', 'chords_from', 'notes', 'systems', 'bars'],
  properties: {
    title: { type: 'string' },
    tempo_bpm: { type: 'integer' },
    time_signature_beats: { type: 'integer' },
    key: { type: 'string' },
    has_bass_part: { type: 'boolean' },
    chords_from: { type: 'string', enum: ['chord_symbols', 'inferred_from_notes'] },
    notes: { type: 'string' },
    systems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['page', 'top', 'bottom'],
        properties: { page: { type: 'integer' }, top: { type: 'number' }, bottom: { type: 'number' } },
      },
    },
    bars: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['system', 'section', 'chords', 'bass'],
        properties: {
          system: { type: 'integer' },
          section: { type: 'string' },
          chords: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['symbol', 'beats'],
              properties: { symbol: { type: 'string' }, beats: { type: 'number' } },
            },
          },
          bass: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['pitch', 'beats'],
              properties: { pitch: { type: 'string' }, beats: { type: 'number' } },
            },
          },
        },
      },
    },
  },
};

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export class SheetReadError extends Error {}

export async function readSheet({ apiKey, pages, signal, onStatus }) {
  const { default: Anthropic } = await import(SDK_URL);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const content = [];
  for (const [i, blob] of pages.entries()) {
    content.push({ type: 'text', text: `Page ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(blob) } });
  }
  content.push({ type: 'text', text: 'Read this score for the bassist and fill in every field.' });

  let msg;
  try {
    onStatus?.('Sending the sheet to Claude…');
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content }],
      },
      { signal },
    );
    let chars = 0, started = false;
    stream.on('streamEvent', (ev) => {
      if (!started && ev.type === 'content_block_start' && ev.content_block.type === 'thinking') onStatus?.('Claude is studying the music…');
    });
    stream.on('text', (t) => {
      started = true;
      chars += t.length;
      const bars = Math.max(0, Math.round(chars / 170));
      onStatus?.(`Writing out the bars… (~${bars})`);
    });
    msg = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) throw new SheetReadError('Cancelled.');
    if (err instanceof Anthropic.AuthenticationError) throw new SheetReadError('Your API key was not accepted. Check it in Settings.');
    if (err instanceof Anthropic.PermissionDeniedError) throw new SheetReadError('This API key is not allowed to use Claude Opus 5.5.');
    if (err instanceof Anthropic.RateLimitError) throw new SheetReadError('Claude is busy right now (rate limit). Try again in a minute.');
    if (err instanceof Anthropic.BadRequestError) throw new SheetReadError(`Claude couldn't take this request: ${err.message}`);
    if (err instanceof Anthropic.APIConnectionError) throw new SheetReadError('No connection to Claude. Check your internet.');
    if (err instanceof Anthropic.APIError) throw new SheetReadError(`Claude error: ${err.message}`);
    throw err;
  }

  if (msg.stop_reason === 'refusal') throw new SheetReadError('Claude declined to read this sheet.');
  if (msg.stop_reason === 'max_tokens') throw new SheetReadError('This score is too long to read in one go. Try fewer pages.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SheetReadError('Claude answered in an unexpected format. Please try again.');
  }
  return toSong(data);
}

// Claude's answer -> the app's song model.
function toSong(data) {
  const bpb = Math.max(1, Math.min(12, data.time_signature_beats || 4));
  const bars = data.bars.map((b) => {
    let chords = b.chords.filter((c) => c.symbol && c.beats > 0);
    const sum = chords.reduce((a, c) => a + c.beats, 0);
    if (!chords.length) chords = [{ symbol: 'N.C.', beats: bpb }];
    else if (Math.abs(sum - bpb) > 1e-6) chords = chords.map((c) => ({ ...c, beats: (c.beats * bpb) / sum }));
    const bass = b.bass
      .filter((n) => n.beats > 0)
      .map((n) => {
        const written = /rest/i.test(n.pitch) ? null : parseNoteName(n.pitch);
        // Bass guitar sounds an octave below written pitch.
        return { midi: written == null ? null : foldToBass(written - 12), beats: n.beats };
      });
    return { chords, section: b.section || '', system: b.system, bass };
  });
  return {
    title: data.title || 'Untitled',
    bpm: Math.max(30, Math.min(260, data.tempo_bpm || 90)),
    beatsPerBar: bpb,
    key: data.key || '',
    hasBassPart: !!data.has_bass_part && bars.some((b) => b.bass.length),
    chordsFrom: data.chords_from,
    notes: data.notes || '',
    systems: data.systems || [],
    bars,
  };
}
