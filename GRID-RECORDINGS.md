# Grid recordings

A take contains the source sound, score, synth/effect configuration, grid controls and current selection. It can produce audio, restore controls, or replay navigation. All storage and rendering happen locally.

## Make and keep a take

1. Load a sound, analyze the CAS demo, or use the recall bank.
2. Clear steps for a fresh path. Arm **Write grid path**, then click, drag or use grid arrows. Disarm to finish the last event. Path writing appends to an existing score and captures intervals from 20 ms to 6 seconds. Generated patterns use the grid clock; kept autoplay ticks retain their heard intervals, rests and chords.
3. Enter a take name. **Store take** saves a new snapshot in IndexedDB, including Float32 source audio. Choose it in the library and click **Load stored take** to restore it after a reload. Library listing reads summaries, rather than retaining all stored audio in memory.
4. **Export take JSON** creates a portable copy containing audio. **Import take JSON** restores the source, score, controls, selected frame/member, selected score step and hardware-panel page. Nothing is uploaded. Keep a JSON copy if the take matters: browser storage can be cleared.

The configuration is a snapshot at save/export/render time. It includes the synth patch, effects, global tempo, panel page/view/operator/bank, grid mapping/capacity/cut/level/clock, autoplay controls and current selection. It does not record every subsequent knob motion. **Apply captured settings** reapplies the last stored/loaded snapshot without replacing the current edited score.

## Three uses for recorded data

| Output | Controls and behavior |
| --- | --- |
| Audio | **Play pattern** loops the score. **Render take WAV** exports one pass as 48 kHz mono PCM16, with current captured settings and fresh effect tails. |
| Preset configuration | Loading a take restores its captured controls. **Generate harmonic preset** instead converts the selected pitched cell to an editable synth patch. **Export harmonic preset** writes a normal CAS patch JSON for Import patch. |
| Navigation | REPLAY OUTPUT selects audio plus selection, audio only, or silent selection only. Silent replay works without enabling audio. Each step restores its exact frame/member, including pooled cells. Clicking a score step also selects its source frame; a chord highlights all its cells and selects its first voice. |

The generated patch uses up to eight strongest components of the measured 16-harmonic vector: sine carrier, cosine carrier with a −π/2 offset, and six direct sine operators. Magnitudes are renormalized; the display reports the retained fraction of measured harmonic energy. Phase, noise and time evolution are not reconstructed. The patch is keyboard-relative; the exported metadata records the analyzed source f0. Unpitched cells cannot generate a preset. No firmware changes are required for this browser implementation.

## Audio render contract

Rendering respects individual frame IDs, event intervals, length, gain, transposition, rests, chord normalization and the 32-active-grain ceiling. Buffer construction, duration and envelope decisions share helpers with live playback. Offline source interpolation is linear; native Web Audio may use a different resampler. Both feed the same CAS effects/DC/master/limiter DSP. The voice shaper and operator network remain synth-only when replaying source audio.

An export starts with empty effects histories and excludes unrelated live notes and the retrospective recall RAM clip. It includes the configured echo/room tail, capped at 12 seconds with a fade at the cap. A complete export, including grain/effect tails, must fit within 120 seconds. Source audio remains limited to 30 seconds; rates are 8–192 kHz. The native-hop grid clock is still capped at 50 events/second. Source-rate transposition changes duration; there is no independent time stretch.

## File format and checks

`cas-grid-take`, version 3, has `source`, `settings`, `configuration`, `selection` and `steps`. Source PCM is explicitly little-endian Float32 encoded as base64, with sample count/rate validation. Imports accept at most 40 MiB and 4096 events, reject missing frame IDs and malformed intervals/PCM, and bound polyphonic events to eight voices. Legacy score v2 can be imported after loading a source matching its name, rate and sample count; that older format has no audio fingerprint, so matching metadata does not prove sample identity.

`grid-recording.js` handles take validation, PCM packaging, harmonic patches and offline audio. `take-store.js` handles IndexedDB. `palette.js` binds controls and navigation. Edit these modules and regenerate both standalone HTML copies.

The 116-check suite includes 17 follow-up/recording checks for phased rumble cases, length-sensitive fallback caches, pooled-member access, sparse players, duration-seek cleanup, take round-trips, malformed imports, legacy migration, measured preset spectra, exact CAS input/render parity, rests/chords, deterministic tails, WAV headers and render/voice bounds. Browser QA additionally verifies storage across reloads, portable import, silent navigation, actual audio playback and downloaded WAV equivalence.
