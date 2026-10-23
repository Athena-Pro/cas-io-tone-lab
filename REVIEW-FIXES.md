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

`npm test` runs 99 checks. `npm run build` rebuilds both self-contained HTML files. Local uploads remain in browser RAM; neither source audio nor captures are embedded in score JSON.

Remaining boundaries: the 2048-sample analysis is approximate for polyphonic/noisy/low-pitched signals; residual energy includes window leakage. Rank-based PCA preserves neighborhood grouping rather than exact projected distances. Changing recordings may still have loop-seam artifacts. Rate transposition is not time stretching. Score import, spectral morphing and harmonic resynthesis are not implemented. Browser measurements do not establish firmware capacity.
