# Claude review handoff

This is the complete CAS I/O TONE browser lab, not the parent firmware/workbench repository. All local imports are present, including the previously missing `grid-auto.js`. Start with `README.md` and `REVIEW-FIXES.md`.

## Reproduce

```sh
npm test
npm run build
python serve.py
```

There are 99 passing Node checks; no dependency installation is needed. The generated standalone files live in dist/. Test the source page at localhost and the packaged page at /dist/index.html. Existing imports are relative and the bundler embeds them in the correct order.

## What changed after the review

1. Plot ranges use pitched frames only; unpitched frames share the lower-left pool.
2. PCA uses PC1/PC2 balanced column ranking, avoiding greedy placement by source time.
3. Held period buffers no longer fade to zero on each wrap. Start/stop has a voice envelope.
4. Length below one centers the source cut and applies a full Hann window at the shorter duration.
5. Arrow navigation skips holes and finds nearby occupied cells in the intended direction. Selection owns the grid tab stop.
6. A local HTML media element reads metadata before arrayBuffer/decodeAudioData. Unknown/long durations fail closed, and decoded duration is rechecked.
7. Pitch search extends to about 4 kHz; positive autocorrelation lobes are grouped to avoid small-lag noise peaks.
8. Low-pitch residual masking leaves spectral gaps and declares resolution limits.
9. Static random/knight patterns now use the autoplay seed.
10. ARIA rows, harmonic image descriptions, score grouping, valid fractional number steps, updated captions and duration/sample-count export metadata are included.
11. Default 8x8 pooling and explicit member controls keep the grid playable without losing source-frame access.

## Suggested independent follow-up

Re-run synthetic saw/sine/noisy-tone cases, layout neighbor-distance comparisons and repeated-source order permutations. The relevant new suite is tests/review-regressions.test.mjs. Compare real steady and drifting held sounds, short-grain level, native metadata preflight behavior across browser codecs, and keyboard/screen-reader behavior. No private recordings are required: the demo is generated in harmonic-grid.js.

Known limits remain explicit in README/REVIEW-FIXES: approximate monophonic f0 from short frames, residual leakage at low pitch, rank distortion rather than metric PCA embedding, possible seams for changing audio, source-rate transposition, bounded native grain count, no score importer and no firmware port.

Treat the dist/ files as generated output. Edit modules, run the checks/build, and include regenerated HTML in changes. The CI workflow repeats those checks on Node 22 and verifies dist/ is current.
