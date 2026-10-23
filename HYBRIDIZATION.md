# Hybrid synthesis directions for CAS I/O TONE

The strongest next sound-engine experiment is a **grid-scanned harmonic table blended with a short source grain**: retain an attack's texture, then sustain and modulate its tonal body with CAS. Add **choice memory** to the grid players as a smaller control project. These are design recommendations. V16 implemented the sample-rate analysis correction; v17 adds waveset repeat/drop on palette cells (part of section 4), two dynamical grid players (Kuramoto and standard map) and ratio-scale quantization. Everything else below remains a proposal.

## Playable combinations already available

1. Select a pitched cell and Generate harmonic preset. After the patch loads, start the grid pattern again and play the synth keyboard. The sampled source and its eight-partial approximation now share the insert effects, echo/room and scope. Adjust PALETTE LEVEL and the synth's A/C/operator depths to balance them; MASTER changes the combined output. Their note timing and pitch remain independently played.
2. Choose Period loops, hold a cell, and play a CAS note against it. Explore ring, SSB or the rotating room on the shared mix. This demonstrates sampled texture plus synthesized tone; it does not lock their phases.
3. Capture a past beat in MEM, send it to the palette with Use captured beat, then write or generate a new path. This recycles a performance into a second sound source. Store/export the take before replacing a path; Undo score offers one RAM recovery level.

## Recommended order

| Priority | Combination | Musical purpose | Main new work | Resource implication |
| --- | --- | --- | --- | --- |
| 1 — sound | Harmonic table + source grain + CAS modulation | Sustain and morph a sampled timbre while preserving its attack | Phase-continuous table voice, blend, table assets and band limiting | Small active-table cache; oscillator work per voice |
| 1 — controls | Grid player + remembered choices | Repeat a found phrase, then introduce controlled variation | Seeded replay probability, memory length, lock | Event metadata; no additional audio history |
| 2 | Score path + harmonic envelopes + grain/noise texture | Transfer timbral movement instead of one static preset | Stable partial identities, smoothed envelopes, residual model | Control trajectories and optional texture buffer |
| 3 | Crossing-defined cycles + recall history | Cycle repeats, rearrangements and rough stretching | Accurate cut points, bounded read/write policy, seam handling | Reuse source/capture PCM; bounded index lists |
| 4 | Sample bus + a trig side input | Let recorded sound interact with a CAS oscillator in one rule | Explicit bus routing, gain bounds, shared live/render implementation | Shared processing first; avoid multiplying work per voice |
| Later | Synth-guided mosaic, parameter search, drawn carriers | Match or steer a corpus, or invent new oscillator geometry | New analysis/control paths and comparison tools | Analysis/search costs dominate; measure separately |

These rankings are engineering judgments from the current code. None establishes physical-device CPU or RAM headroom.

## 1. A harmonic table as the bridge

The existing `h[1..16]` vector is normalized harmonic magnitude, not phase or absolute loudness. Build a cycle with a consistent phase convention:

```text
w_j[p] = sum(k=1..K, h_j[k] * sin(2*pi*k*p))
w(p,u) = (1-u)*w_left(p) + u*w_right(p)
y(t)   = (1-m)*source_grain(t) + m*w(phase(t),u(t))
```

Here `p` is phase in cycles, `u` moves between neighboring timbres and `m` is the sample/synth blend. Keep phase advancing when the selected cell changes; crossfade table changes over a short interval. Use a linear blend initially: correlated grain and tonal components can gain level under an equal-power crossfade. Restore source loudness separately from `h`, using measured RMS plus a bounded user gain. The existing eight-partial preset can be the first implementation; a dedicated table can preserve all 16 measured components.

The sine/cosine Fourier representation has a direct browser precedent in [Web Audio's PeriodicWave specification](https://www.w3.org/TR/webaudio/#PeriodicWave). For this instrument, put the table reader in the shared CAS engine so AudioWorklet playback and offline rendering follow the same rule. A separate native oscillator alone would not provide that parity.

Cache two active 1024-sample Float32 cycles: **8192 bytes of sample storage**, excluding mip levels, assets and voice state. Prebuilding all 64 representative cells at that size uses **262144 bytes** before those extras. Start with the active pair and reuse them across voices where possible. These are allocation calculations, not target fit measurements. Retain exact frame IDs as asset keys; a pooled cell can contain several different cycles.

For keyboard transposition, remove harmonics above Nyquist at the current pitch, or select a band-limited table level and crossfade between levels. The nonlinear trig stack can introduce further aliases even from a band-limited table. Test upper notes, modulation and each quality setting. Raw-cycle tables are another option, but require phase alignment and a consistent period; the current magnitude-based approach deliberately resets original phase.

Suggested controls: **BLEND, POSITION, MOTION, TEXTURE**; SELECT chooses the table pair, EDIT locks it, and SCL+EDIT captures the selected frame. Keep grain length separate from the feature-window length: at 96 kHz the current Frame grain is still 21.33 ms. Add an explicit future duration mode rather than silently retiming existing takes.

Acceptance: m=0 reproduces the existing grain path; m=1 produces a stable keyed tone; cell changes preserve phase continuity; moving position cannot change score IDs; upper-note alias tests and live/offline null comparisons pass. Store table/trajectory assets in a versioned take format, with defaults that preserve older takes.

## 2. Remember choices, then vary them

Add a 1–16-event memory after the automator makes a choice. **REPEAT** controls the probability of replaying a stored event instead of generating a new one; **LOCK** freezes the memory, and a separate command clears/reseeds it. Store complete heard events: frame IDs, rests, chord voices, normalization, transpose and timing. Remap coordinates from IDs after layout changes. Keep memory separate from the editable score until Keep last 32 is pressed.

[Mutable Instruments Marbles](https://pichenettes.github.io/mutable-instruments-documentation/modules/marbles/manual/#deja-vu-section) is a hardware precedent for recycling random decisions with loop-length control. The proposal here applies that principle to CAS grid events; it is not an emulation of Marbles. The existing HITS PER 16 gate already distributes hits over a fixed cycle, so a second rhythm system has less immediate value than memory and lock.

Suggested controls: **REPEAT, MEMORY LENGTH, STRIDE, DENSITY**; EDIT locks choices, SCL+EDIT reseeds. Use the existing seeded PRNG for new/replay decisions. Test probability endpoints, lock across rests/chords, source replacement clearing incompatible IDs, tempo changes, score undo and portable round-trips. At probability 1 with lock, repeated output must be exactly reproducible.

## 3. A path becomes a changing instrument

For a chosen tonal RMS target r[j], derive `a_k[j] = sqrt(2)*r[j]*h_k[j] / sqrt(sum_q(h_q[j]^2))`, then interpolate each harmonic's amplitude on the recorded step clock. This gives the chosen RMS over a full cycle for the harmonic sine bank; r can be source RMS scaled by a tonal-level control, but the current analysis does not measure a separated tonal RMS. Track harmonics by harmonic number throughout the path; selecting the eight strongest anew at every step can make operator identities jump. Begin with a fixed set of eight partials chosen over the whole phrase, or use the table representation for all 16. Allow either keyboard-relative pitch or the recorded f0 trajectory as an explicit mode.

Use the original grain briefly for an attack and optionally retain a quiet grain texture under the synthesized sustain. Add filtered seeded noise only after estimating a residual spectrum or exposing a deliberately approximate texture control. The current `inharmonicity` value includes window leakage and transients; it is not a measured noise gain. A noise source and time-varying per-partial envelopes are new engine features, not options already present in harmonic presets. [Smith's spectral-modeling treatment](https://www.dsprelated.com/freebooks/sasp/Spectral_Modeling_Synthesis.html) provides the sinusoid-plus-noise/transient precedent.

Suggested controls: **PATH POSITION, MORPH TIME, ATTACK GRAIN, TEXTURE**. Skip or hold unpitched frames according to an explicit mode; do not turn unreliable f0 into a note. Validate held notes, abrupt jumps, silent frames, fixed operator identities and score-time fidelity. This can change timbre without allocating a new voice at every step, but its cost still needs measurement.

## 4. Wavesets from crossings and buffers

Index same-direction zero crossings in stored source/capture audio, then repeat, reverse, drop or substitute the segments between them. [Csound's waveset opcode](https://csound.com/manual/opcodes/waveset/) is an established example of stretching by repeating crossing-defined cycles. A crossing segment is not guaranteed to be one fundamental period: complex CAS outputs can have several crossings per cycle. Use f0/confidence to group crossings when a pitched mode needs whole periods.

The current streaming detector uses hysteresis and an envelope gate. Its event count is useful for triggering, but sample-accurate cuts require a separate interpolated zero location. Bound cycle lengths, reject silence, and handle DC and seam discontinuities. A repeated cycle preserves its own duration; it does not provide general transparent time stretching of polyphonic material.

**Status (v17):** palette cells implement repeat (1–4) and drop (every 2nd–8th) on the centered frame, inside the grain buffer, shared by live playback and WAV rendering. Live substitution on the rolling MEM buffer and f0-grouped whole-period mode are not implemented.

Prototype on a pinned capture first. A live reader that repeats too slowly can fall behind the rolling write head and lose its source. Specify freeze, drop or overwrite behavior before making it live; do not allocate an unlimited queue. Keep repeated-cycle choices deterministic in exported scores and ensure recall does not recursively feed itself unless a separately bounded feedback mode is selected.

## 5. Let a sample and an oscillator share a rule

A useful first route is a shared insert such as `z = sin(g*sample + I*carrier)`, with a smoothed wet mix and the existing DC/master chain after it. Audio-rate ring modulation and SSB on the combined bus already work; this proposal adds an explicit side input rather than another layer of parallel effects.

Today, external grains enter after the per-voice operator/stack calculations. They cannot simply be named as an operator PM source. A per-voice version would require a new causal tap, source alignment and a defined delay; the same tap must exist offline. Start with one post-mix rule so its cost does not multiply by polyphony. If the rule enters delay feedback, use the existing gain-bounded loop family rather than arbitrary full-depth stack composition. Test silence, DC, extreme input gain, wet=0, bounded feedback and render parity.

## Assessed external proposals (v17)

A later external proposal suggested ten extensions. Three were implemented in v17 (waveset repeat/drop on cells, Kuramoto and standard-map players, ratio-scale quantization), along with golden render hashes. Notes on the rest:

- **Interpolating operator ratios between cells.** The eight strongest harmonics differ from cell to cell, so interpolating ratios glides partials through inharmonic values and swaps operator identities. Section 1's fixed-harmonic table (amplitude-only interpolation, continuous phase) avoids this. The engine also reads patch values per sample without smoothing, so control-rate scanning would need smoothing to avoid zipper noise.
- **Stack rules inside a pitch-tracked delay loop.** Plausible as a post-mix resonator tuned to the last note. Grains enter after the per-voice calculation, so a per-voice string excited by grains needs the causal tap described in section 5. Chebyshev or trig rules in feedback need an explicit loop-gain bound.
- **Noise as phase modulation of the carriers.** PM by noise spreads and detunes the carriers' partials rather than adding a noise floor; section 3's filtered additive noise is closer to sinusoid-plus-noise models. The current `inharmonicity` value includes window leakage and is not a noise gain.
- **Closed-loop descriptor steering.** The shared dry monitor contains grains, so following it chases the palette's own output. It needs the isolated synth-only tap described under the mosaic follower first.
- **The 50-tick/s clock.** It caps grid event rate, not modulation: waveset processing happens inside each grain buffer, and audio-rate scanning belongs in the shared engine.

## Later experiments

**Mosaic follower.** Use a dry synth-only analysis tap to select the nearest palette vector, with harmonic-distance and optional f0 costs, hysteresis and a repeat penalty. [IRCAM's corpus-based concatenative synthesis work](https://www.ircam.fr/en/research/projects/8-2-2) is a close precedent. The current shared dry monitor also contains grains, so following that tap could chase its own output; add an isolated target tap first. Bound candidate count and decision rate, retain exact source IDs, and begin with offline synth targets before optional microphone input.

**Parameter matching.** Run a seeded, cancelable offline search over selected CAS parameters, comparing pitch, harmonic magnitudes, RMS and attack/decay trajectories. Test a small parameter subset before nested-rule topology. Spectral matches are not unique and do not imply the original oscillator phases or algorithm were recovered. Keep fitting away from the audio thread and budget total rendered samples per search.

**Drawn carriers.** Resample a closed XY path into periodic x/y tables with one shared phase. This could extend the carrier view into a shape editor. Define parameterization, closure, DC removal, normalization and band limiting; an arbitrary SVG drawing does not automatically define a well-behaved oscillator.

**Pitch continuity.** Retain multiple candidates per frame and choose a voiced/unvoiced path with octave/jump costs. The [pYIN paper](https://webspace.eecs.qmul.ac.uk/s.e.dixon/pub/2014/MauchDixon-PYIN-ICASSP2014.pdf) combines probabilistic candidates with HMM/Viterbi decoding; applying continuity costs to this autocorrelation detector would be an adaptation, not pYIN itself. It can also smooth away real note jumps. Persistent 50/60 Hz notches are another optional analysis-only experiment, but can remove musical fundamentals and nearby partials. Retain the documented loud-hum limit until a defined sweep, genuine low notes and abrupt transitions all pass.

## Delivery boundary

Build each extension as one testable mode with shared live/offline DSP, explicit assets/settings, score undo and backward-compatible take loading. Start with a single keyed voice, then measure eight voices, the 32-grain limit and the existing effects together. Firmware work needs its own fixed-point design, memory placement and worst-case target benchmark; browser performance cannot establish physical headroom.
