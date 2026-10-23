# Claude review handoff

## Current state: v18

V18 adds choice memory to all ten grid players (REPEAT, MEMORY LENGTH, Lock, Clear; REPEAT 0 is unchanged behavior) and harmonic scan: heard cells retarget a 16-harmonic table that replaces the synth's S carrier, crossfaded over MOTION, with BLEND weighing keyed voices against grains. Both are in take settings with backward-compatible defaults. The suite has 179 checks and 21 golden renders.

Check next for v18: listen to scan on real recordings across the keyboard (skipping a harmonic as a key or bend crosses its Nyquist threshold may be audible as a timbre step); a POSITION control between two locked tables; whether replayed Life/Kuramoto chords should re-evaluate the voice limit; the panel FFT/WAVE canvas, which did not redraw in the preview pane during v18 QA.

## v17 notes

V17 adds golden PCM hashes for deterministic renders, Kuramoto and standard-map grid players with a shared COUPLING / KICK K control, harmonic/just/hexany ratio-scale quantization rooted at the anchor cell, and waveset repeat/drop cell playback. Take v3 settings gain optional waveset and coupling fields; older takes keep their behavior. The suite has 160 checks. An intended DSP change must refresh `tests/fixtures/golden-renders.json` with `npm run golden:update`.

Check next for v17: perceptual review of waveset grit on real recordings (complex tones, noisy sources); Kuramoto density at high stride with the 32-grain limit; golden hashes on arm64 hosts (expected to use the fingerprint fallback). HYBRIDIZATION.md assesses the remaining external proposals.

## v16 notes

The standalone CAS lab plays two trig carriers, six operators, nested amplitude rules, shared effects and retrospective recall. The harmonic palette analyzes local audio into a fixed source-frame grid, supports ten seeded players, and stores/imports/renders timed takes with exact frame/member selection. Grid-score undo is one level in RAM; deleted-library-take undo is persistent. Dirty synth edits have an in-page replacement guard.

High-rate feature windows now grow independently of the saved/playback grid. 88.2/96 kHz uses 4096 samples; 192 kHz uses 8192. Frame IDs remain i, starts remain i*1024, and Frame grains remain 2048 source samples. Both pitch and harmonic analysis use the larger context; near edges they prefer a complete real window, reflecting when the source is shorter. Existing 44.1/48 kHz feature results are preserved. Nine regressions brought the Node suite to 139 at v16.

Known limits (still current): monophonic f0 can fail with near-equal-level mains hum, polyphony, transients or too few real periods. Pitch search is approximately 60–min(4000, sampleRate/8) Hz. High-rate analysis costs more and Frame grains are shorter in time (21.33 ms at 96 kHz). Corrected f0 can change Period loops and feature layouts, but saved frame IDs keep their source locations. WAV uses fresh effects histories and linear offline resampling; take configuration is a snapshot, not knob automation. No firmware/device path is included.

Check next: high-rate files with attacks and short context; old high-rate take selection/audio compatibility; screen-reader behavior; browser codec/quota failures; and native/offline interpolation differences. The new [HYBRIDIZATION.md](HYBRIDIZATION.md) ranks table/grain blending and choice memory first, with integration points, controls, memory arithmetic and acceptance criteria. Its proposed modes, pitch continuity and hum notches are not implemented features.

## Reproduce and inspect

```sh
npm test
npm run build
python serve.py
```

Node.js 22+ and Python 3 are sufficient; no npm dependencies. Test the modular app at `/` and standalone at `/dist/index.html`. CI runs tests/build and requires committed dist to match source. Native storage checks at `/tests/storage.html` use generated data in an isolated database.

- [README.md](README.md): playing the panel, keyboard/MIDI, performance transport and scope.
- [GRID-RECORDINGS.md](GRID-RECORDINGS.md): take format, undo, timing, source-rate compatibility and render contract.
- [VALIDATION.md](VALIDATION.md): current evidence and the defined test matrices.
- [THEORY.md](THEORY.md), [BUFFER-RESEARCH.md](BUFFER-RESEARCH.md), [CROSSING-MEMORY.md](CROSSING-MEMORY.md): equations and resource assumptions.

## Code entry points

`harmonic-grid.js` owns FFT, rate-scaled feature windows, pitch, harmonic vectors, mapping and static paths. `cell-audio.js` defines cached grain construction, period-loop playback and the shared audible-interval GrainBudget. `grid-auto.js` owns continuous players. `grid-timing.js` preserves intervals; `grid-history.js` retains immutable audio/features and cloned score/control checkpoints. `grid-recording.js` validates v3 takes and renders audio; `take-store.js` separates summary/audio/undo storage. `palette.js` binds these controls; `app.js` supplies synth/tempo/panel snapshots and the replacement guard. `engine.js` is shared live/offline DSP.

Do not change the source grid to fix analysis. Add extensions to the shared engine when live/render equivalence matters. Version new persistent assets and preserve older take defaults. Use generated or user-owned test sound; add no recordings, banks, credentials, private history or machine-specific paths.

## Review history

V12 corrected mapping, loops, grains, sparse navigation, metadata probing and accessibility. V13 added portable source-backed takes, harmonic presets and rendering. V14 corrected RMS-normalized rumble coverage, fractional division restore, summary-only storage, timing preservation and audible grain admission. V15 added score recovery and documented loud mains hum. V16 corrects high-rate feature analysis and expands the playing/research/hybridization documentation. V17 adds golden render hashes, Kuramoto and standard-map players, ratio scales and waveset cells. V18 adds choice memory and harmonic scan. Full changes and historical measurements are in [REVIEW-FIXES.md](REVIEW-FIXES.md).
