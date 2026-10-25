# BassLine

A web app for co-writing bass lines from a music sheet, built for iPad.

1. **Open** a sheet: a PDF, or photos of the pages.
2. **Read sheet ✨**: Claude reads the chords for every bar and, if the score has one, the bass part. It also notes where each line of music sits on the page, so the sheet can scroll along with the song.
3. Pick a **style** (Simple roots, Root & 5th, Pop 8ths, Worship/ballad, Rock octaves, Jazz walking, From the sheet) and a **level** (Easy / Normal / Busy). The bass line appears as 4-string TAB (G D A E).
4. **Play** (the big button, or tap the sheet). There's a count-in, then the sheet scrolls, the tab follows and the bass line plays with a click.
   - **Follow**: the sheet scrolls with the music.
   - **Steady**: the sheet scrolls at the speed set by the slider.
   - Use **− / +** or tap the BPM number to practise slower.
   - **Loop** repeats a few bars.
5. **Co-compose**: tap any note in the tab to make it higher or lower, move it to another string, make it a rest, hear it, or get a **new idea** for that bar. The editor tells you what the note is in the chord (root, 3rd, 5th…).
6. **Chords ✎**: type or fix the chord chart (`| G | D/F# | Em C | C . . D |`). Bars you don't change keep your edits.

Songs save automatically on the device, including the sheet, chords and your edits. Open them again from **Songs**.

## Run it locally

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173. To try it on the iPad on the same Wi-Fi, open `http://<your-Mac's-IP>:5173`. Over plain http, "keep screen awake" won't work. It does once the app is on https.

To add it to the iPad home screen: in Safari, tap Share → Add to Home Screen. It then opens full screen like an app.

## Claude API key

Reading sheets uses Claude Opus 5.5 with your own API key from console.anthropic.com, entered in ⚙ Settings. The key is stored only in that browser and is sent only to `api.anthropic.com`. The rest of the app works without a key: demos, typed chords, tab, playback and scrolling.

**Before sharing music.letieb.com with anyone else:** add a small server-side proxy (for example a Cloudflare Worker or Vercel function) that holds the key. Then visitors never handle a key, and `js/ai.js` points at the proxy instead.

## Deploy to music.letieb.com

It's a static site with no build step: upload the folder as it is to any static host, such as Cloudflare Pages, Netlify, Vercel or GitHub Pages. Then point `music.letieb.com` at it with a CNAME record.

## Files

| File | What it does |
|---|---|
| `js/main.js` | Screen wiring, state, autosave |
| `js/sheet.js` | PDF / photo → page images, auto-scroll |
| `js/ai.js` | Sends the pages to Claude and turns the answer into a song |
| `js/generator.js` | Bass line styles |
| `js/theory.js` | Chord parsing, fretboard, picking easy string/fret positions |
| `js/tab.js` | Draws the TAB, playhead and tap targets |
| `js/player.js` | Bass synth, click, chord pad, loop, tempo |
| `js/chart.js` | Chord chart text format and demo songs |
| `js/store.js` | Song library (IndexedDB) |
