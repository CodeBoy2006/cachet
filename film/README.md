# Cachet — film

A 62-second film rendered live in the browser. Every frame is a pure function of time: Three.js lights a sheet of cotton paper, a 2D press prints vector ink and blind relief onto it each frame, and the score is synthesised with Web Audio on the same clock. Storyboard and the concepts behind it: [STORYBOARD.md](STORYBOARD.md).

```bash
npm install --prefix film
npm run dev --prefix film        # http://localhost:5180
```

| Key | |
|---|---|
| Space / click | Play, pause |
| ← → | One bar (2.5 s); with Shift, 0.1 s |
| 0 | Start |
| f | Fullscreen |
| m | Mute |
| h | Hide controls |
| d | Time, bar and act readout |

URL options: `?t=20.5` start or poster time · `?w=3840&h=2160` render size · `?live` synthesise the score in the page instead of loading `assets/score.flac` · `?clean` no controls.

## Sources

Nothing on screen is mocked up. `npm run capture --prefix film` (needs `npm run dev:local` at the repo root) publishes a sandbox binding to the **local** relay, signs in to Fieldnote and Stall, withdraws, and saves 2× screenshots plus the binding itself (`src/data.json`: npub, address, signed statement, both signatures, binding ID, check results, and the attack variants built from it). The cropped panels in `assets/ui/` come from those captures; the stale log rows of earlier test runs were painted out of the two signed-out screens.

## Tools

- `npm run frames --prefix film -- <dir> 12.5 20 41` — exact frames to PNG at 1920×1080 (headless Chrome).
- `npm run score --prefix film` — re-render the score to `assets/score.flac` after editing `src/audio.js` (−14.8 LUFS, −0.9 dBFS peak).
- `node film/tools/perf.mjs` — frame cost over the whole film (median ≈ 11 ms at 1080p on an M-series Mac).

For a video later: step `window.__film.renderAt(t)` at 1/30 s, read the canvas, and mux with the FLAC.

## Layout

| File | |
|---|---|
| `src/cues.js` | The clock: 96 BPM, act times, shared by picture and sound |
| `src/story.js` | Camera, light and every act |
| `src/engine.js` | Renderer, paper material, studio light, depth of field, film finish |
| `src/press.js` | Ink and relief layers, re-rasterised for the visible part of the sheet |
| `src/objects.js` | Emerald foil, the metal card, real-screen prints with the vesica wipe |
| `src/audio.js` | Score and sound design, rendered offline |
