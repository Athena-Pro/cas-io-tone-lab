# CAS I/O TONE Lab

A self-contained browser research instrument: two trigonometric carriers, six operators, nested amplitude rules, shared delay/reverb, crossing analysis, retrospective beat recall, and a harmonic sample palette with eight automatic grid players.

This repository contains the complete standalone CAS project. It has fresh history and includes every imported module, particularly `grid-auto.js`. No device connection, firmware, patch banks or uploaded recordings are included.

## Run and test

Requires Node.js 22+ for checks/builds and Python 3 for the local server. No npm dependencies or install step are needed.

```sh
npm test
npm run build
python serve.py
```

Open http://127.0.0.1:8765 and click **Enable audio**. **Analyze CAS demo** supplies a generated sound; no audio asset download is needed. Choose a GRID AUTOPLAY player and press Start auto. Stop/Panic ends playback. The header keyboard also plays the synth.

The portable build is [dist/CAS-I-O-TONE.html](dist/CAS-I-O-TONE.html); download the raw HTML, rather than saving GitHub's file-view page. All code/styles are embedded. Some browsers restrict local-file AudioWorklet; the localhost server is the tested path. `dist/index.html` is the identical server build. Both are generated and should be rebuilt after source changes.

## Code map

| File | Purpose |
| --- | --- |
| `engine.js` | Shared synth/effects/recall DSP factory, offline engine and generated AudioWorklet |
| `app.js` | Main panel, presets, note transport, scope, import/export and audio wiring |
| `harmonic-grid.js` | Shared radix-2 FFT, 2048/1024 frame analysis, f0/harmonics, PCA and layouts |
| `cell-audio.js` | Testable period-loop and centered Hann-grain sample construction |
| `audio-file.js` | Metadata preflight before payload read/decode, with duration checks |
| `grid-auto.js` | Eight seeded continuous grid players and rhythm/scale rules |
| `palette.js` | Grid/member controls, source loading, native grain scheduling and pattern capture |
| `index.html`, `style.css` | Instrument and responsive UI |
| `build.mjs` | Inline bundler and packaged-script syntax/source checks |
| `tests/` | 99 dependency-free Node checks, including generated worklet parity and review regressions |

## Palette workflow

Load local audio up to 30 seconds, analyze the built-in demo, or analyze a captured recall beat. Analysis happens once per source. Mono source/captured audio stays in browser RAM. No upload service is involved.

The default 8x8 palette pools nearby frames. Its member selector reaches every stored frame; 12x12, 16x16 and one-cell-per-frame sizes are available. Layouts are brightness/pitch column ranks, a pitched-only descriptor plot with an unpitched corner, and balanced PC1/PC2 rank columns. Arrow keys skip empty cells and maintain a roving tab stop.

Frame playback uses Hann overlap-add. Short grains use a centered segment and a complete window at their shorter length. Period loops preserve matched rising zero crossings without an amplitude fade on each wrap; the held voice has its own attack/release. Pitch/rate changes also change duration; there is no independent time stretch.

Automatic players: serpentine scan, row sweep, column sweep, random walk, knight walk, Lissajous orbit, harmonic-similarity walk and Conway Life chords. Controls include global-tempo sync/free rate, stride, density, C-based scale quantization, deterministic seed, boundaries and Life voice count. Click cells to steer. **Keep last 32 ticks** creates an editable take, preserving chords, rests and recorded intervals. Audio shares the effects, scope/crossing analysis and retrospective history.

Score v2 JSON stores source identity metadata, settings, coordinates and events, without audio. A kept take retains recorded intervals; editing the free grid rate explicitly makes timing uniform. Synth patch JSON and C4 WAV export remain separate. Score import, spectral morphing and harmonic resynthesis are future work.

## Review status

Read [REVIEW-FIXES.md](REVIEW-FIXES.md) for the external review response and [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md) for the next review entry point. `npm test` currently passes 99 checks. The browser was checked on localhost for pooled members, layout coverage, sparse keyboard navigation, high pitch, metadata rejection, held loops and automation. Browser timing/RAM are not hardware capacity measurements.
