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

## Playing the instrument

Click Enable audio, then play the on-screen keys or **A W S E D F T G Y H U J K O L P ;**. **Esc** is Panic. Knobs support vertical drag, scroll and arrow keys; double-click resets. The optional MIDI input connects after an explicit user action and receives note/velocity messages.

- HOME knobs edit A/B/C/D. SELECT edits feedback; ALGORITHM selects a base law or a compound rule template. MASTER is software volume.
- ALG STACK: SELECT chooses stage 1–4. K1 selects its rule, K2 its side input, K3 its amount or Chebyshev order, and K4 its wet mix. EDIT toggles that stage. The editor below the instrument also offers reordering, global stack bypass and an independent base-rule selector.
- OPS: SELECT chooses one of six operators; ALGORITHM changes ratio/fixed-Hz clock. Knobs edit rate, depth, function and destination. EDIT opens PM source, PM index, start phase and decay.
- ENV: per-note ADSR. SHAPE/FX: SELECT chooses voice shaping, phase warp, four trig inserts, trig delay or rotating room. EDIT toggles the selected element; ALGORITHM selects its shaping/modulation/loop mode. On a buffer bank, SCL+EDIT opens its four extra loop controls. GLO: voice/quality settings and clock/screen settings.
- MEM: K1 chooses 1/2/4 beats back, K2 a quarter/half/whole-beat slice, K3 recall return and K4 the rising-crossing trigger count. SELECT chooses history input, ALGORITHM chooses loop/one-shot, EDIT toggles the captured slice and SCL+EDIT grabs a fresh slice.
- SCL latches the modifier, or hold the computer's Shift key. Modified knob turns are finer. SCL+PLAY toggles HOLD; SCL+REC undoes a take; SCL+OCT− panics; SCL+SHAPE/FX bypasses all six effects. SCL+EDIT on HOME snaps a last-touched B/D ratio to half steps.
- PRESETS loads immediately: the sound, all page knobs and the operator table update together. Each arrow-key step selects the adjacent preset. SAVE stores a patch in browser-local storage. JSON export/import includes the patch and note loop. WAV renders a four-second C4 note plus release using the same DSP factory as live audio.
- The performance loop is four beats / sixteen cells. REC arms, PLAY begins an optional one-bar count-in and records a single pass before playback. REC during playback punches note overdub in/out. Undo restores the previous take. It records notes, not motion or audio. Timing uses the audio clock with a short scheduling horizon; leaving the tab stops transport.
- WAVE/FFT show actual output. XY defaults to color-separated dry, delay, room and recall returns; MAP → Carrier S/C restores the original pre-output-law carrier plot. CROSSINGS marks qualified rising/falling events. FREEZE pauses scope data only; counters keep running. ROUTE shows active destinations and delayed operator phase connections.

## Code map

| File | Purpose |
| --- | --- |
| `engine.js` | Shared synth/effects/recall DSP factory, offline engine and generated AudioWorklet |
| `app.js` | Main panel, presets, note transport, scope, import/export and audio wiring |
| `harmonic-grid.js` | Shared radix-2 FFT, fixed 2048/1024 source grid, rate-scaled feature analysis, f0/harmonics, PCA and layouts |
| `cell-audio.js` | Testable period-loop and centered Hann-grain sample construction |
| `audio-file.js` | Metadata preflight before payload read/decode, with duration checks |
| `grid-auto.js` | Eight seeded continuous grid players and rhythm/scale rules |
| `grid-recording.js` | Validated portable takes, harmonic patch generation and offline score audio |
| `take-store.js` | Separate IndexedDB summary/audio stores, migration, rename and reversible deletion |
| `grid-timing.js` | Preserved recorded timing, explicit clock modes and path finalization |
| `grid-history.js` | One-level score recovery with matching source, timing and controls |
| `palette.js` | Grid/member controls, source loading, native grain scheduling and pattern capture |
| `index.html`, `style.css` | Instrument and responsive UI |
| `build.mjs` | Inline bundler and packaged-script syntax/source checks |
| `tests/` | 139 dependency-free Node checks, including generated worklet parity and review regressions |

## Palette workflow

Load local audio up to 30 seconds, analyze the built-in demo, or analyze a captured recall beat. Analysis happens once per source. Audio stays in browser RAM, or in IndexedDB when a take is stored. No upload service is involved.

The default 8x8 palette pools nearby frames. Its member selector reaches every stored frame; 12x12, 16x16 and one-cell-per-frame sizes are available. Layouts are brightness/pitch column ranks, a pitched-only descriptor plot with an unpitched corner, and balanced PC1/PC2 rank columns. Arrow keys skip empty cells and maintain a roving tab stop. Middle members represent pooled cells; static pattern buttons and autoplay choose seeded members throughout each pool. Sparse walks escape isolated sites and extinct Life reseeds other occupied areas.

Frame playback uses Hann overlap-add. Short grains use a centered segment and a complete window at their shorter length. Period loops preserve matched rising zero crossings without an amplitude fade on each wrap; the held voice has its own attack/release. Pitch/rate changes also change duration; there is no independent time stretch.

Automatic players: serpentine scan, row sweep, column sweep, random walk, knight walk, Lissajous orbit, harmonic-similarity walk and Conway Life chords. Controls include global-tempo sync/free rate, stride, density, C-based scale quantization, deterministic seed, boundaries and Life voice count. Click cells to steer. **Keep last 32 ticks** creates an editable take, preserving chords, rests and recorded intervals. Audio shares the effects, scope/crossing analysis and retrospective history.

**Grid recordings now have three outputs.** Store a take in the browser, or export/import portable v3 JSON containing source PCM, the score, settings and selection. Render one pass to WAV; restore the captured synth/effect and grid controls; or replay the exact frame/member selections silently. Combined audio and selection replay is the default. Pointer/arrow path writing captures movement intervals and reuses the last interval at the loop end. SCORE TIMING switches clocks without erasing them; kept autoplay takes retain rests, chords and intervals. Clicking a score step selects its exact frame.

**Generate harmonic preset** fits the selected cell's eight strongest measured harmonics to the two carriers and six operators, reports retained harmonic energy and opens an editable synth patch. Export harmonic preset creates an ordinary CAS patch JSON. Phases and noise are not reconstructed. Synth C4 WAV and grid-take WAV remain separate exports. Read [GRID-RECORDINGS.md](GRID-RECORDINGS.md) for controls, the v3 format, legacy v2 import, audio rendering and limits. Spectral morphing remains future work.

## Hybridization and research

[HYBRIDIZATION.md](HYBRIDIZATION.md) recommends a grid-scanned harmonic table plus source-grain blend as the next sound mode, and repeat/lock memory as a smaller grid-control project. It includes combinations playable now, proposed controls, resource arithmetic and tests. Proposed table morphing, waveset transforms, harmonic trajectories and matching/follower modes remain designs.

Read [THEORY.md](THEORY.md) for the equations, [BUFFER-RESEARCH.md](BUFFER-RESEARCH.md) for echo/room and sample-memory tradeoffs, [CROSSING-MEMORY.md](CROSSING-MEMORY.md) for detectors/recall, and [VALIDATION.md](VALIDATION.md) for current evidence. None establishes physical firmware headroom.

## Current status and limits

The 139 Node checks and standalone build cover DSP parity, grid analysis/players, recordings, score undo and sample-rate compatibility. Six isolated native storage checks are available at `/tests/storage.html`. Review history is in [REVIEW-FIXES.md](REVIEW-FIXES.md); current reviewer entry points are in [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md).

Feature windows grow at high sample rates while source frame IDs and Frame grain durations stay unchanged. Sources are 8–192 kHz; pitch search is approximately 60–min(4000, sampleRate/8) Hz with sufficient real cycles. At 96 kHz, Frame grains are still 21.33 ms. Short/noisy/polyphonic sources and near-equal-level mains hum remain ambiguous. Period loops can change when corrected high-rate f0 becomes available. The 50-tick/s clock limits native-hop reconstruction at high rates.

Undo score recovers one pattern replacement, clear, deletion or source/take load with matching source, timing, controls and selection. It lasts only in RAM; Store/export keeps takes across reloads. Library Undo delete is separately persistent. Grid takes snapshot settings rather than recording every knob motion; WAV begins with fresh effects histories. Read [GRID-RECORDINGS.md](GRID-RECORDINGS.md) for the full compatibility and render contract.
