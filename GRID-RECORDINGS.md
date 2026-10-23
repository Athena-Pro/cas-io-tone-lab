# Grid recordings

A take contains the source sound, score, synth/effect configuration, grid controls and current selection. It can produce audio, restore controls, or replay navigation. All storage and rendering happen locally.

## Make and keep a take

1. Load a sound, analyze the CAS demo, or use the recall bank.
2. Clear steps for a fresh path. Arm **Write grid path**, then click, drag or use grid arrows. Disarm ends writing without extending the last event: it repeats the preceding movement interval, or uses the grid clock for a single step. Path writing appends to an existing score and captures intervals from 20 ms to 6 seconds. Generated patterns use the grid clock; kept autoplay ticks retain their heard intervals, rests and chords.
3. Enter a take name. **Store take** saves a new snapshot in IndexedDB, including Float32 source audio. Choose it in the library and click **Load stored take** to restore it after a reload. Library listing queries the small `takeSummaries` store; source/score payloads live in `takePayloads` and are not read for listing or renaming. Existing v1 records move once in an atomic database upgrade.
4. **Rename selected take** uses the TAKE NAME field and updates only its summary. **Delete stored copy** removes a take from the library and keeps one persistent undo copy. **Undo delete** survives a reload; the next delete replaces that undo copy. The synth SAVE and currently loaded score are preserved.
5. **Export take JSON** creates a portable copy containing audio. **Import take JSON** restores the source, score, controls, selected frame/member, selected score step and hardware-panel page. Nothing is uploaded. Keep a JSON copy if the take matters: browser storage can be cleared.

The configuration is a snapshot at save/export/render time. It includes the synth patch, effects, global tempo, panel page/view/operator/bank, grid mapping/capacity/cut/waveset repeat and drop/level/clock, autoplay controls (including coupling/kick K and ratio scales) and current selection. It does not record every subsequent knob motion. Grid actions show an in-page confirmation before replacing unsaved synth edits; Keep edits cancels before any take/source/control replacement. **Apply captured settings** reapplies the last stored/loaded snapshot without replacing the current edited score.


## Recover an unstored score

**Undo score**, next to Clear steps, recovers one score replacement: Original order, Selected row, Random walk, Knight walk, Keep last 32 ticks, Clear steps, Delete step, or a successful source/take load. It restores exact recorded intervals, chords/rests, gain/length/transpose, selected frame and score step, source audio/analysis and grid controls. Undoing a take load also restores the previous synth/effect/tempo/panel configuration, with the same unsaved-edit confirmation before changing the patch. Canceling a load or undo leaves the recovery slot intact; invalid imports do not replace it. Replacements and recovery stop playback and disarm path writing.

This is one level in RAM, consumed by Undo score and replaced by the next score replacement. It does not survive a page reload and does not undo individual knob moves or each appended path event. Store/export the take to keep it across sessions. The separate library **Undo delete** remains persistent. Audio/feature references are retained without copying or base64 encoding on each edit; after a source change the slot may keep one previous source (up to 30 seconds) and its features in memory. Cached playback buffers are rebuilt on recovery.

## Three uses for recorded data

| Output | Controls and behavior |
| --- | --- |
| Audio | **Play pattern** loops the score. **Render take WAV** exports one pass as 48 kHz mono PCM16, with current captured settings and fresh effect tails. |
| Preset configuration | Loading a take restores its captured controls. **Generate harmonic preset** instead converts the selected pitched cell to an editable synth patch. **Export harmonic preset** writes a normal CAS patch JSON for Import patch. |
| Navigation | REPLAY OUTPUT selects audio plus selection, audio only, or silent selection only. Silent replay works without enabling audio. Each step restores its exact frame/member, including pooled cells. Clicking a score step also selects its source frame; a chord highlights all its cells and selects its first voice. |

The generated patch uses up to eight strongest components of the measured 16-harmonic vector: sine carrier, cosine carrier with a −π/2 offset, and six direct sine operators. Magnitudes are renormalized; the display reports the retained fraction of measured harmonic energy. Phase, noise and time evolution are not reconstructed. The patch is keyboard-relative; the exported metadata records the analyzed source f0. Unpitched cells cannot generate a preset. No firmware changes are required for this browser implementation.

## Audio render contract

Rendering respects individual frame IDs, event intervals, length, gain, transposition, rests, chord normalization and the 32-active-grain ceiling. Buffer construction, duration, envelope decisions and audible-interval reservations share helpers with live playback. The 32-grain limit counts overlapping sounding intervals in both paths, rather than the earlier node-queue time. Native playback also has a 96-node allocation guard above the bounded score scheduler requirement; extreme unrelated manual preview traffic can reach that safety guard. Offline source interpolation is linear; native Web Audio may use a different resampler. Both feed the same CAS effects/DC/master/limiter DSP. The voice shaper and operator network remain synth-only when replaying source audio.

An export starts with empty effects histories and excludes unrelated live notes and the retrospective recall RAM clip. It includes the configured echo/room tail, capped at 12 seconds with a fade at the cap. A complete export, including grain/effect tails, must fit within 120 seconds. Source audio remains limited to 30 seconds; rates are 8–192 kHz. The nominal pitch-search range is approximately 60–min(4000, sampleRate/8) Hz: about 60–4000 Hz at 32 kHz and above, and 60–1000 Hz at 8 kHz. Clean low-tone accuracy is tested at 44.1, 48, 88.2, 96 and 192 kHz; short, changing, noisy or polyphonic sources can still be ambiguous. The native-hop grid clock is still capped at 50 events/second. Source-rate transposition changes duration; there is no independent time stretch.

## File format and checks

`cas-grid-take`, version 3, has `source`, `settings`, `configuration`, `selection` and `steps`. Source PCM is explicitly little-endian Float32 encoded as base64, with sample count/rate validation. Imports accept at most 40 MiB and 4096 events, reject missing frame IDs and malformed intervals/PCM, and bound polyphonic events to eight voices. Legacy score v2 can be imported after loading a source matching its name, rate and sample count; that older format has no audio fingerprint, so matching metadata does not prove sample identity.

SCORE TIMING defaults to **Keep recorded intervals**. Editing STEPS/SECOND changes only the free clock; it never deletes captured intervals. **Use grid clock** temporarily plays/renders uniform intervals, and switching back restores the exact recorded timing. This mode is included in take settings.

`grid-history.js` keeps the one-level source/score checkpoint. `grid-recording.js` handles take validation, PCM packaging, harmonic patches and offline audio. `take-store.js` handles IndexedDB. `palette.js` binds controls and navigation. Edit these modules and regenerate both standalone HTML copies.

The 179-check suite includes 18 follow-up/recording checks and seven timing/admission checks for RMS-normalized rumble phase/frame sweeps, clean 62–3000 Hz tones, fractional division restoration, length-sensitive fallback caches, pooled-member access, sparse players, duration-seek cleanup, take round-trips, malformed imports, legacy migration, measured preset spectra, exact CAS input/render parity, rests/chords, deterministic tails, WAV headers and render/voice bounds. Browser QA additionally verifies storage across reloads, portable import, silent navigation, actual audio playback and downloaded WAV equivalence.

The isolated native browser checks at `/tests/storage.html` exercise v1 migration, summary-only query access, rename, delete, undo across reopen and saved-patch preservation. They use generated data in a separate temporary database. The DSP sweep covers five rumble conditions, each at eight rumble phases and four source positions, with component RMS normalized over a one-second reference: 220/25 Hz at −2/+4 dB, 330/40 Hz at −2/+4 dB, and 440/45 Hz at +4 dB. Clean checks cover sine/saw sources at ten frequencies from 62 to 3000 Hz, two phases and four positions. This is defined test coverage, not a guarantee for every recording.

## Known pitch limit: mains hum

The pitch estimate is monophonic. Mains hum near the target tone's level can compete as a second periodic source; the 50 Hz analysis filter does not guarantee rejection of 50/60 Hz interference. The external review swept 50/60 Hz hum under 110–440 Hz saws, with 32 phase/frame-position combinations per condition: every case at −20 and −10 dB hum was correct; 60 Hz at −2 dB lost the intended pitch; 50 Hz at +4 dB under 440 Hz produced octave-low estimates in 13/32 cases. These are reviewer-reported results, separate from the repository's normalized sub-range-rumble regressions. Loud-hum failure remains a documented limit; this revision leaves the detector unchanged.

Browser QA recorded a three-step path with unequal intervals and edited gain/length/transpose. Exported JSON after undo of each generator, Clear, Delete step, Keep last 32 and stored-take loading matched the pre-action export exactly. A 44.1 kHz short take replaced the six-second 48 kHz source; undo recovered the full original PCM, selected pooled member, three steps, settings and synth configuration. Canceling the dirty-patch prompt on both load and undo, and importing an invalid-frame take, retained the existing checkpoint. Ordinary generator undo preserved subsequent synth edits. The recovered native WAV (0.67142 seconds, 64500 bytes) matched a fresh render from exported JSON byte for byte. No browser warning/error logs or 320-pixel horizontal overflow were observed. The module was left stopped with writing disarmed.

## Wavesets, dynamical players and ratio scales (v17)

CELL PLAYBACK **Wavesets · repeat / drop** builds each grain from the centered frame's segments between rising zero crossings (crossings closer than four samples merge). Each kept segment plays REPEAT times (1–4), carrying the fractional overshoot so repeated cycles keep their mean length; WAVESET DROP removes every 2nd–8th segment. One complete Hann window covers the result, so a 3× grain lasts about three frames. Silent or crossing-free frames fall back to the ordinary Frame grain. Buffer keys include repeat, drop and length; live playback and WAV rendering share the construction and use the buffer's own length for duration and the 32-grain budget. Changing repeat/drop while playing affects the next grains without stopping.

The **Kuramoto** and **Standard map** players and the harmonic/just/hexany pitch modes write ordinary heard events (frame IDs, chords, rests, intervals and transposition), so Keep last 32, take storage, undo and rendering need no new event format. Take v3 settings gain optional `waveset: {repeat, drop}` and `automation.coupling`; older takes load with repeat 2, drop 0 and K = 1, which affect only the new modes. An older build reading a v17 take falls back to Frame cut and its known players/scales.

## Choice memory and harmonic scan (v18)

Choice memory lives in the running player only. Replayed events are ordinary heard events, so Keep last 32 keeps them as a fixed score; memory contents are not stored in takes, and a new player, seed, source or layout starts empty. Take settings carry `automation.repeat`, `automation.memory` and `automation.lock`; older takes load with REPEAT 0, MEMORY 8 and no lock.

Harmonic scan settings travel in `settings.scan: {enabled, blend, motion, lock}` and default to off. Keyboard notes are not part of takes, so a grid WAV with scan on contains only the grain share, scaled by 1 − BLEND exactly as live playback scales it; the render status says so. Retargets are scheduled in the AudioWorklet at each grain's start time, and Stop cancels any still queued.

## Sample-rate compatibility

Frame i always starts at i*1024 source samples and covers up to 2048 samples. Frame count, score IDs, selected members, source PCM and the v3 format are unchanged. Feature-window length is `2048 * max(1, 2^round(log2(sampleRate/48000)))`, doubled again if needed to retain the 60 Hz lag range at unusual rates such as 64 kHz. Standard 88.2/96 kHz sources use 4096 samples and 192 kHz uses 8192. Both pitch and harmonic FFT use that larger context. Center the window on its frame, move it inside the source near file edges when possible, and reflect short-source padding. Filter transient padding remains reflected. Longer windows improve frequency resolution but can blend adjacent attacks; very short high-rate sources may contain too few real periods for a reliable low pitch.

Frame-cut playback still uses 2048 source samples: 46.44 ms at 44.1 kHz, 42.67 ms at 48 kHz, 21.33 ms at 96 kHz and 10.67 ms at 192 kHz. Length and transpose retain their existing rules. Changing playback to fixed milliseconds is a future explicit option, not part of this fix. Corrected high-rate pitch estimates can enable or change Period-cut loops, harmonic presets and map positions; they do not retarget saved frame IDs. Original-order reconstruction is still limited by the 50-step/s clock.

Nine sample-rate regressions cover the low-note matrix, high-rate phases/file edges, harmonic vectors, unchanged frame/grain boundaries, 96 kHz take import/selection, prior 44.1/48 kHz features, short-source padding and the high-rate demo. Hybrid synthesis proposals and their compatibility requirements are in [HYBRIDIZATION.md](HYBRIDIZATION.md).
