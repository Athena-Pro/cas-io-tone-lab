# Review fixes: palette v12

The external review covered `harmonic-grid.js` and `palette.js`; the sharing repository now includes every imported module, including `grid-auto.js`, plus the complete tests and standalone build.

| Review finding | Change | Verification |
| --- | --- | --- |
| One unpitched frame compresses the plot's pitch axis | Compute descriptor ranges from pitched frames only; reserve the lower-left pool for unpitched frames | Regression checks row coverage and unpitched placement |
| PCA's greedy placement favors earlier frames | Rank-sort balanced columns using PC1, then PC2; support pooled bins | Reversing source traversal preserves each frame's location |
| Held loops dip on every wrap | Preserve matched rising-zero-crossing loop samples, without periodic amplitude fades; retain voice attack/release | Steady-loop RMS and wrap-step tests |
| Short grains use only the Hann attack | Center the shorter source segment and apply a complete Hann window at its actual length | Constant-signal RMS and centered impulse tests at ¼/½/¾ length |
| Arrows stop at empty cells | Search along the direction, then choose the nearest occupied directional candidate | Sparse navigation tests and browser keyboard check |
| Long compressed files decode before the duration check | Probe local media metadata before reading the payload or calling decodeAudioData; reject unknown/long duration and recheck after decode | Decoder/payload-call counters and a native 31-second WAV rejection |
| High pitches become subharmonics | Extend the search to approximately 4 kHz, grouping autocorrelation peaks by positive lobe to reject noisy near-zero maxima | C7 and higher-tone checks |
| Low-pitch residual measure has no noise gaps | Cap harmonic exclusion width by bin spacing and mark resolution-limited measurements | Noisy 65 Hz regression |
| Static walks ignore the seed | Use the same seeded PRNG for generated random/knight patterns | Repeatability tests |
| Accessibility semantics/focus | Real ARIA grid rows, roving selected tab stop, a score group and a descriptive harmonic image label | Browser DOM/keyboard verification |
| Number defaults fail step validity | Use `step="any"` for fractional grid rate and hysteresis | No step-mismatch fields on startup |
| Crowded grid / inaccessible clustered frames | Default 8×8 pools, optional 12×12/16×16/all-frame layouts, and explicit previous/select/next controls for every member | Membership, unique-frame preservation and browser selection checks |
| Old caption / incomplete export metadata | Describe chords, rests and captured timing; export source duration, sample count and grid capacity | Browser export and source review |

`npm test` runs 116 checks. `npm run build` rebuilds both self-contained HTML files. Audio stays local. The original v12 score JSON omitted audio; v13 portable take JSON embeds its source so it can restore and render independently.

Remaining boundaries: the 2048-sample analysis is approximate for polyphonic/noisy/low-pitched signals; residual energy includes window leakage. Rank-based PCA preserves neighborhood grouping rather than exact projected distances. Changing recordings may still have loop-seam artifacts. Rate transposition is not time stretching. Take import and eight-partial harmonic preset generation were added in v13; spectral morphing remains unimplemented. Browser measurements do not establish firmware capacity.

## Follow-up review and grid recordings: v13

- Pitch analysis now uses a pitch-only 40 Hz high-pass in both directions with reflected padding. This removes low rumble without the initial filter transient corrupting clean first-frame pitch. Correlation at the chosen lag can use the stronger raw/filtered repeat confidence; source samples and harmonic FFT amplitudes remain unfiltered. Tests cover 220/330 Hz saw tones, 25/40 Hz rumble at −2/+4 dB, multiple phases and first/later frames.
- Buffer cache keys include shortened length for every non-loop buffer, including unpitched Period-cut fallback. Live and offline playback share buffer/envelope/duration rules.
- Grid colors, default click/drag members and similarity comparisons use each pool's middle member. Static row/random/knight patterns choose seeded members throughout the pools. Explicit member selections remain exact.
- Walk/knight generators escape isolated sites with seeded nearby-cell fallback; extinct Life reseeds a different occupied area. Dense-grid movement and Conway generation rules retain their existing tests.
- Page, keyboard and performance-step containers have labeled group roles. Headerless WebM metadata is probed with a bounded seek before payload/decode; unknown duration still times out and long duration is rejected. Native browser QA accepted a one-second WebM with no duration header and rejected its 31-second counterpart while preserving the current source.
- Grid takes now persist source PCM, score, settings and selection in IndexedDB and portable v3 JSON. Imports restore controls and exact frame/member identity, including legacy v2 scores with a matching loaded source. Replay has audio, selection-only and combined modes. Manual path writing captures pointer/arrow timing. WAV exports one score pass through fresh CAS effects, with duration/voice limits. Selected cells generate editable eight-partial harmonic presets with retained-energy reporting. See GRID-RECORDINGS.md.

Seventeen new checks pass alongside the earlier 99. A browser-exported eight-step take rendered to a 1.22-second 48 kHz mono WAV and matched a fresh render from its JSON byte for byte after PCM16 encoding. The take survived reloads, restored the OPS page and grid settings, and replayed silent navigation while AUDIO ASLEEP. Generated harmonic patches are magnitude approximations; the source audio and recall histories are not synthesized by that patch.
