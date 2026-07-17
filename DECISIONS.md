# DECISIONS

## 2026-03-23 — Added project memory scaffold
Context: Establish a standard knowledge structure for this repo.
Decision: Use PRIMER.md, RUNNING_NOTES.md, and DECISIONS.md at the repo root.
Reason: Keeps project context visible, versioned, and easy to update.
Tradeoff: Adds a few more files to maintain.

## 2026-07-17 — Govern autonomous visual evolution with fingerprints
Context: The visualizer will receive a new creative-engineering run every two hours.
Decision: Use `CREATIVE_ENGINE.md` for candidate generation/selection and `EFFECTS.md` as an anti-repetition ledger. Each run is limited to one coherent, fully verified local commit and may not push automatically.
Reason: Perpetual generation without a novelty gate converges on palette and parameter variants; fingerprints force structural invention while bounded commits preserve stability.
Tradeoff: Some runs will choose performance or QA work when no candidate clears the novelty threshold.

