# Working on the CAS lab

Read README.md, GRID-RECORDINGS.md and CLAUDE_HANDOFF.md first. This repository is self-contained and has no firmware/device path.

Edit source modules, not the generated dist HTML. Run `npm test` and `npm run build` before proposing changes. Keep all local imports in the build list and regenerate both standalone copies. Preserve the local-only audio workflow and metadata preflight. Add meaningful DSP/layout regressions when fixing corresponding behavior. Do not add recordings, patch banks, credentials or machine-specific paths.
