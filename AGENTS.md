# Visualizer Autonomous Work Rules

These rules apply to every scheduled or autonomous run in this repository.

## Three-minute run budget

Hermes cron runs have a hard interruption ceiling. A run must use this clock:

- **0–30 seconds:** inspect/recover repository state and choose one bounded task.
- **30–105 seconds:** make one small coherent change only.
- **At 105 seconds:** stop starting edits.
- **105–140 seconds:** run focused verification.
- **140–165 seconds:** commit verified work or checkpoint interrupted work.
- **Before exit:** prove `git status --short` is empty.

Long benchmark suites are separate acceptance work. Do not start a full multi-pattern suite inside a cron run unless enough time remains to finish and commit. Prefer one deterministic changed-pattern benchmark per run; use later runs for mirrored/full-suite acceptance.

## Dirty-workspace recovery

A dirty tree is a recovery task, not a reason to abort forever.

1. Inspect `git status --short`, `git diff`, untracked files, recent commits, and `RUNNING_NOTES.md`.
2. Never reset, stash, checkout over, delete, or discard unknown work.
3. Treat recognizable visualizer source/docs/test changes as interrupted Tiny/cron work. Continue or repair them before starting anything new.
4. Run `python3 scripts/verify_visualizer.py`, `git diff --check`, and focused JavaScript/browser checks.
5. If recovered work passes, commit it immediately with `Recover interrupted visualizer work` before beginning another task.
6. If it cannot be repaired before the cutoff, append the exact failure to `RUNNING_NOTES.md` and commit a clearly labeled `WIP: checkpoint interrupted visualizer work`. This is preferable to leaving the tree dirty.
7. If `HEAD` is a `WIP:` checkpoint, the next run must repair/verify it before any new effect or optimization.
8. Never stage credentials, caches, generated browser profiles, binaries, or unrelated user files. Report unexpected sensitive/unrelated files explicitly.

## End-of-run invariant

Every run must end in exactly one of these states:

- a focused verified commit and clean tree;
- a labeled recovery checkpoint and clean tree;
- no mutation and clean tree.

A final response claiming completion is invalid unless `git status --short` was checked after the commit.

## Visual and performance gates

- Preserve effective DPR of at least `1.0`.
- Never trade pixel density for FPS.
- Reject sparse, blurry, muddy, clipped, or stuttering effects.
- Use deterministic pattern/seed benchmark routes.
- Do not measure FPS while capturing screenshots.
- Use at least 120 sampled frames for acceptance claims.
- Do not act on one sequentially biased suite; use mirrored forward/reverse rounds and per-pattern medians for final comparative ranking.
- Keep each cron change small enough to verify and commit within its time budget.
