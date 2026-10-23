# Claude review handoff

This repository contains the complete standalone CAS I/O TONE browser lab. Read README.md, GRID-RECORDINGS.md and REVIEW-FIXES.md. All modules are included; dist/ is generated output.

## Reproduce

```sh
npm test
npm run build
python serve.py
```

There are 124 dependency-free Node checks. Test the modular app at localhost and the standalone app at /dist/index.html. CI runs the tests/build and verifies the committed standalone output matches source.

## Follow-up review addressed in v13

- Pitch-only 50 Hz forward/backward filtering uses reflected padding to reject sub-range rumble without a first-frame transient. The chosen-lag confidence can also use the raw repeat correlation; waveform samples and harmonic FFT remain unfiltered.
- Every non-loop buffer, including Period-cut fallback, keys its shortened window length. Shared helpers define live/offline buffer, duration and envelope decisions.
- Middle pooled members drive colors, default selection and timbre distance. Seeded static patterns and autoplay reach all members.
- Sparse walk/knight fallback moves to other nearby occupied sites. Extinct Life reseeds another occupied area.
- Page/keyboard/loop groups have labeled ARIA roles. Unknown WebM duration gets a bounded native media seek before payload/decode; unresolved duration fails closed.

The previous v12 fixes remain covered by their existing regression suite.

## New recording paths

- grid-recording.js validates take v3, packages exact Float32 PCM as base64, migrates compatible score v2, generates eight-partial magnitude presets and renders one score pass through the CAS DSP.
- take-store.js saves takes in IndexedDB and uses separate summary/audio stores, one-time atomic v1 migration, summary-only rename and persistent single-level delete/undo.
- palette.js captures source/score/settings/selection, restores takes/configuration, records pointer/arrow intervals and replays audio, selection-only or both. Source frame IDs survive mapping changes and pooled-cell selection.
- app.js supplies synth/effect/tempo and hardware-panel navigation snapshots. Generated harmonic patches use the existing two carriers and six direct operators, with no firmware changes.

tests/grid-recording.test.mjs has 18 checks, and tests/grid-timing.test.mjs adds seven timing/admission checks, including phased rumble, sparse grids, metadata seek cleanup, exact PCM/timing round-trips, malformed imports, legacy migration, measured harmonic spectra, live-input DSP parity, rests/chords, deterministic tails and render/voice bounds.

Native browser checks cover a saved take across reloads, JSON import, actual grid playback, selection-only replay while AUDIO ASLEEP, fixed selection during audio-only replay, captured page/grid settings, generated patch export/import and 320/390-pixel layout. An eight-step browser WAV matched the exported take's fresh offline render byte for byte after PCM16 encoding. A one-second headerless WebM loaded; a 31-second headerless WebM was rejected during metadata preflight.

## Limits and useful next checks

A take snapshots settings at save/export/render time; it does not automate every knob motion. Grid WAV starts with fresh effects histories and excludes unrelated live notes/recall RAM clips. Offline interpolation is linear; native resampling may differ. The source cap is 30 seconds, score cap 4096 steps, WAV cap 120 seconds including tails, and active-grain cap 32. Legacy v2 metadata cannot prove audio identity. f0/residual features remain approximate; harmonic presets use eight magnitudes, without original phase/noise. Spectral morphing and firmware ports remain future work.

Useful independent follow-up: compare real changing/steady sources, different browser codecs, IndexedDB quota errors, screen-reader behavior and native interpolation differences. Shared audible-interval admission now has a dense-chord lookahead-versus-render regression. Use generated or user-owned test audio; do not add recordings, banks, credentials, private history or machine-specific paths to the repository.

## V14 review follow-up

Read the corrected coverage statement in REVIEW-FIXES.md. The old 40 Hz test did not cover +4 dB rumble at 40/45 Hz and used coefficient ratios rather than normalized RMS. The new 50 Hz cutoff passes all 160 defined rumble cases; a separate 160-case clean matrix covers ten sine/saw frequencies from 62 to 3000 Hz. This does not claim universal pitch robustness.

`grid-timing.js` preserves path intervals at disarm and shares recorded/uniform clock decisions between live playback and WAV. Changing the rate never deletes recorded intervals. `cell-audio.js` now also owns the shared GrainBudget: it reserves sounding time, so future lookahead nodes do not consume the audible limit prematurely. Dense-chord event admission matches chronological rendering in the regressions; unrelated manual traffic can still reach the native allocation guard.

Fractional division values are canonical and restore into real select options. take-store.js schema v2 reads only headers for the library and rename, with audio in a separate store. V1 migration is atomic; delete keeps one persistent undo until the next delete. Six isolated native browser storage checks are available at `/tests/storage.html`. Grid actions await an in-page confirmation when the synth patch has unsaved edits; cancellation happens before replacing the take or controls.

The native dense-chord check also exported a retrospective capture of live dry output. Its 0.5-second source contained 25 pulse packets with every interior gap exactly 20 ms. The corresponding offline 12-step score admitted all 96 grains and skipped none. The current browser data was left stopped after the check.
