# CAS lab validation — v16

This is a software research instrument. No physical device was accessed or flashed, and browser timing does not establish firmware headroom.

## Reproduce

```sh
npm test
npm run build
python serve.py
```

There are **139 dependency-free Node checks**: 13 synthesis, 11 trig effects, 11 nested algorithms, 13 buffers, 5 source monitoring, 11 crossing/recall, 11 harmonic palette, 12 grid autoplay, 12 review regressions, 18 grid recording, 7 timing/grain admission, 6 score recovery and 9 sample-rate analysis. The build embeds all source/styles, checks packaged-script equality and module syntax, and writes two identical standalone HTML files. CI repeats tests/build and checks committed dist consistency.

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

The pitch estimate is monophonic and frame-local. Loud 50/60 Hz hum remains a documented limit; the prior normalized 25/40/45 Hz rumble tests are not a hum-robustness guarantee. Short, rapidly changing or polyphonic sources remain ambiguous, and the residual measure includes FFT leakage. Frame-cut grains retain sample-based length; corrected high-rate f0 can change Period loops and maps. The 50-tick/s grid clock limits high-rate native-hop reconstruction.

Harmonic presets retain up to eight magnitudes and reset phase. Grid settings are snapshots, WAV begins with fresh effects histories, and native interpolation can differ from offline linear resampling. Score undo is RAM-only; library delete undo is separately persistent. [HYBRIDIZATION.md](HYBRIDIZATION.md) specifies proposed table/grain, choice-memory, harmonic-trajectory, waveset and matching modes. They are not claims of implemented sound engines or measured target capacity.

## V16 browser verification

Native portable imports at 96 and 192 kHz identified the generated 62 Hz tone correctly. The selected frame 14 remained at 13*1024 source samples (0.139 seconds at 96 kHz and 0.069 seconds at 192 kHz). The UI reported 4096/8192 feature samples respectively. Export preserved exact source PCM, score IDs, selection and intervals. Undo from 192 kHz back to 96 kHz restored an identical complete take JSON. A held 192 kHz source period loop produced about −27.5 dBFS output; harmonic preset generation became available and reported eight components. Playback was stopped and the pre-test synth patch restored. The open hybrid-recipes disclosure had no horizontal overflow at 320 pixels; warning/error logs were empty.

Separate old/new offline comparisons at 96 and 192 kHz produced byte-identical Frame-cut WAVs (0.661 seconds each). Period-cut behavior may change with corrected f0, as documented.
