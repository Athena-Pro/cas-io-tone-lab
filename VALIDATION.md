# CAS lab validation - v19

This is a software research instrument. No physical device was accessed or flashed, and browser timing does not establish firmware headroom.

## Reproduce

```sh
npm test
npm run build
python serve.py
```

There are **179 dependency-free Node checks**: 13 synthesis, 11 trig effects, 11 nested algorithms, 13 buffers, 5 source monitoring, 11 crossing/recall, 11 harmonic palette, 12 grid autoplay, 12 review regressions, 18 grid recording, 7 timing/grain admission, 6 score recovery, 9 sample-rate analysis, 10 grid dynamics/ratio scales, 8 wavesets, 9 choice memory, 10 harmonic scan and 3 golden renders. The build embeds all source/styles, checks packaged-script equality and module syntax, and writes two identical standalone HTML files. CI repeats tests/build and checks committed dist consistency.

## V19 controls

All nine Try controls were clicked twice with edited effect knobs, modes, custom stack stages and advanced buffer settings. Form values, effect toggles, dirty state and expanded loop panels stayed identical; patch/tempo/note-loop exports were identical before and after the 18 clicks. Separate effect, algorithm and cascade Load actions selected their demonstration presets. At 320 px the new footers wrap without horizontal overflow. Browser console: no warnings or errors. The unchanged 179-check Node suite passes, including all 21 golden PCM renders.

## V18 additions

- **Choice memory.** REPEAT 0 reproduces every player's legacy sequence, including seeded draws. REPEAT 1 loops the first MEMORY events exactly for walk, Life chords, Kuramoto rests and similarity walks at lengths 1, 5 and 16, across pooled members. Lock freezes memory while fresh variations continue, and unlocking resumes overwriting. REPEAT 25/50/75% replays within 3 percentage points of the target over 4000 ticks. Length, stride and density changes keep memory, density 0 silences replays, Clear empties memory, anchor steering preserves the loop, seeds reproduce replay choices, and takes round-trip the settings.
- **Harmonic scan.** The sine recurrence matches the direct harmonic sum within 1e-12 for every harmonic count. A held key at BLEND 1 reproduces a scanned vector's relative harmonic magnitudes within 0.2% of the fundamental. A key whose 16th harmonic lies above the output Nyquist has no aliased energy (below 1e-9 of the fundamental's power). A retarget is exactly halfway at MOTION/2 and complete at MOTION, with no sample step above 1.05× the larger steady-state step. BLEND 0 leaves the grain path bit-identical to an engine without scan, intermediate BLEND is exactly m × keys + (1 − m) × grains through the linear chain, and disabled scan renders bit-identically. The generated AudioWorklet source applies configuration and a timed retarget identically to the offline engine (within Float32 precision). Grid WAVs with scan render grains at 1 − BLEND. A 21st golden render covers a PM-modulated scan with two retargets; the other 20 hashes are unchanged.

Browser QA on localhost with the generated demo: Scan pushed its configuration to the worklet on connect and on toggle, then retargeted to the selected cell (frame 69, 155.6 Hz). During Lissajous autoplay it sent 15 timed retargets in 2 seconds (one per heard tick, non-decreasing times, 7 distinct tables) and none while the table was locked. Walk with REPEAT 100% and MEMORY 4 showed NEW 1–4, then REPLAY 1/4–4/4 repeating with the same cells; at 50% it produced 17 new and 14 replayed ticks; Clear memory refilled from new choices. Original order followed by Undo score restored REPEAT, MEMORY, Lock, Scan, BLEND and MOTION and re-sent the scan configuration. No page overflow at 320 or 390 pixels, and no console warnings or errors. The panel's FFT/WAVE canvas did not redraw in the preview pane during this session, with scan on or off, so the audible result of scan was verified by the Node worklet tests rather than on screen.

## V17 additions

- **Golden renders.** Twenty deterministic renders (initial patch, all twelve algorithms, an operator network, insert effects, serial buffer space at 4× quality, a beat-recall capture, and Frame/Period/Waveset grid takes) are hashed with SHA-256 over their Float32 PCM. x64 hosts must match exactly. V8's portable math library makes that reproducible across operating systems; other architectures may contract multiply-adds in that library, so there a 32-block RMS fingerprint within 1e-6 + 0.01% is accepted with a note. Adding the new renders left every v16-era hash unchanged, which also shows the refactored grain/render path is bit-identical for Frame and Period cuts.
- **Kuramoto.** On an 8×8 generated grid, mean order parameter r over 300 ticks is below 0.45 at K = 0 and above 0.95 at K = 4, with mean chord size rising by more than two voices. Uncoupled, a cell an octave above fires 2.00× as often (200 versus 100 firings in 800 ticks). Silent ticks are rests, fired cells stay inside the 16-cell window and fire at most once per tick, live K changes take effect, and seeds reproduce.
- **Standard map.** At K = 0 and 0.2 the walker visits at most two rows in 256 ticks; at K = 4 it visits at least six rows and more than 40 cells, with Reflect and Wrap. Positions land on occupied cells with holes, and STRIDE is exactly the number of map iterations per tick.
- **Ratio scales.** Over 40–3000 Hz and three roots, every quantized pitch lands on an octave-repeating ratio of its scale within 1e-9, and no shift exceeds half the largest scale gap. The root follows the anchor cell and falls back to the median pitched f0.
- **Wavesets.** Pure-tone wavesets equal the period within 0.01 samples; a 220+880 Hz mix yields more than 1.5× as many. Repeat 2–4 multiplies grain length by the repeat count and keeps a 330 Hz tone's crossing rate within 0.2%; dropping every Nth segment shortens by 1/N and keeps pitch. Silence and DC fall back to the exact Frame grain. Durations follow the buffer, and a 4× offline take still sounds 100 ms after onset where the Frame grain has ended.
- **Takes.** New players, coupling, ratio scales and waveset settings round-trip through take JSON; older settings receive the defaults.

Browser QA on localhost with the generated demo: Kuramoto at K = 0 reported sync r 0.20 with two-cell chords, and raising K to 4 while running locked it to r 1.00. The standard map ran at K = 3.5 with the just-major root shown (155.6 Hz for that anchor). Waveset playback at 3× ran with about five overlapping grains; switching to 1× during playback took effect without stopping. Original order followed by Undo score restored the player, K, hexany scale and waveset 4×/drop-3rd settings. No horizontal page overflow at 320 or 390 pixels, the standalone build loaded, and the console had no warnings or errors.

## High-rate analysis correction

The saved/playback grid remains 2048-sample frames at 1024-sample hops. Feature windows grow to 4096 at 88.2/96 kHz and 8192 at 192 kHz. An extra lag-cap check preserves the 60 Hz search at unusual rates near the rounding threshold. Real file-edge context is preferred to reflection of a partial low-frequency cycle; short-source padding and high-pass transient padding use reflection. Highly coherent low tones have local raw-correlation refinement in enlarged windows.

The new tests include:

- 62, 80, 100 and 150 Hz two-partial tones at 44.1, 48, 88.2, 96 and 192 kHz: all 20 within 0.2% of the known pitch.
- Three independent phases and five frame positions (including both file edges) at three high rates and four pitches: all 180 within 0.2%.
- Fundamental/second-harmonic magnitude balance and normalization at 48/96/192 kHz.
- Fixed frame count, IDs, starts, ends and Frame-grain duration at 96 kHz; exact source PCM, score IDs and selected pooled member through take JSON import.
- Eight permanent generated-source feature baselines at 44.1/48 kHz. A larger local before/after comparison of 68 tone/demo feature results was exactly unchanged.
- Finite short-source/silence padding and a six-second 192 kHz demo with 1122/1124 pitched frames, versus the review's 417/1124 before correction. The 48 kHz demo remains 279/280.

In one desktop Node run, the six-second demo analyzed in about 0.8 seconds at 48 kHz and 6.3 seconds at 192 kHz. These are reference timings, not a performance specification. Analysis yields every 32 frames. Longer feature windows can blend neighboring attacks; very short high-rate sources may contain too few real cycles for a reliable low pitch.

## Existing DSP, recording and storage checks

The suites exercise generated AudioWorklet/offline sample parity, bounded operator/feedback behavior, oversampled synthesis, Hilbert image rejection, allpass response, shared delay/room tails, source-tap additivity, crossing triggers and pinned retrospective capture. Grid checks cover FFT/harmonics, map membership, sparse navigation, deterministic players, chords/rests, recorded intervals and shared live/render grain admission.

Take checks validate exact Float32 source/configuration/selection round-trips, malformed imports, compatible legacy v2 scores, eight-partial magnitude presets, render duration/voice bounds and WAV encoding. Score-history tests retain old source/frame identity and produce byte-identical audio after recovery. The native storage page separately verifies v1 migration, summary-only listing/rename, delete/undo across reopening and saved-patch preservation; it uses an isolated generated-data database.

Prior native browser QA verified the four static pattern undo actions, Clear, Delete step, Keep last 32, stored-take load, a source-rate-changing import, dirty-patch cancellation, invalid import and exact exported JSON recovery. A recovered 0.67142-second browser WAV matched fresh offline rendering byte for byte. Other covered workflows include silent selection replay, actual audio playback, portable import, held loops, harmonic patches, metadata rejection and narrow layouts. Historical details are in [REVIEW-FIXES.md](REVIEW-FIXES.md).

## Limits and proposed work

The pitch estimate is monophonic and frame-local. Loud 50/60 Hz hum remains a documented limit; the prior normalized 25/40/45 Hz rumble tests are not a hum-robustness guarantee. Short, rapidly changing or polyphonic sources remain ambiguous, and the residual measure includes FFT leakage. Frame-cut grains retain sample-based length; corrected high-rate f0 can change Period loops and maps. The 50-tick/s grid clock limits event rate and high-rate native-hop reconstruction; waveset processing happens inside each grain buffer and is not limited by it.

Harmonic presets retain up to eight magnitudes and reset phase. Grid settings are snapshots, WAV begins with fresh effects histories, and native interpolation can differ from offline linear resampling. Score undo is RAM-only; library delete undo is separately persistent. [HYBRIDIZATION.md](HYBRIDIZATION.md) specifies proposed table/grain, choice-memory, harmonic-trajectory, live waveset and matching modes; v17 implements only the palette-cell waveset subset. They are not claims of implemented sound engines or measured target capacity.

## V16 browser verification

Native portable imports at 96 and 192 kHz identified the generated 62 Hz tone correctly. The selected frame 14 remained at 13*1024 source samples (0.139 seconds at 96 kHz and 0.069 seconds at 192 kHz). The UI reported 4096/8192 feature samples respectively. Export preserved exact source PCM, score IDs, selection and intervals. Undo from 192 kHz back to 96 kHz restored an identical complete take JSON. A held 192 kHz source period loop produced about −27.5 dBFS output; harmonic preset generation became available and reported eight components. Playback was stopped and the pre-test synth patch restored. The open hybrid-recipes disclosure had no horizontal overflow at 320 pixels; warning/error logs were empty.

Separate old/new offline comparisons at 96 and 192 kHz produced byte-identical Frame-cut WAVs (0.661 seconds each). Period-cut behavior may change with corrected f0, as documented.
