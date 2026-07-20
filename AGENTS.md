# Visualizer Autonomous Work Rules

These rules apply to every scheduled or autonomous run in this repository.

## Ten-minute run budget

This visualizer cron uses a strict ten-minute wall-clock work transaction. Hermes separately has a 600-second inactivity timer, so the agent must enforce this total budget itself:

- **0–60 seconds:** inspect/recover repository state and choose one bounded task.
- **60–480 seconds:** make one coherent change.
- **At 8 minutes (480 seconds):** stop starting edits.
- **480–540 seconds:** run focused verification.
- **540–590 seconds:** commit verified work or checkpoint interrupted work.
- **By 600 seconds:** prove `git status --short` is empty and respond.

Long benchmark suites are separate acceptance work. Do not start a full multi-pattern suite inside a cron run unless it can finish before the eight-minute edit cutoff and still leave two minutes to commit. Prefer one deterministic changed-pattern benchmark per run; use later runs for mirrored/full-suite acceptance.

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

## Human acceptance boundary for effect edits

Focused visual-effect work must not land directly on `main`.

1. Branch from `main` as `candidate/<effect>/<description>`.
2. Commit one coherent effect revision with its focused tests and ledger update.
3. Preview only through `@git` commit routes from `scripts/commit_preview_server.py`; a `?fix=<hash>` query is only a cache-buster and is not immutable evidence.
4. Record the candidate in `EFFECT_ACCEPTANCE.md` and send its exact commit hash and commit-pinned URL.
5. Do not merge until SeaKoala explicitly says `accept <hash>` (or unambiguously accepts that exact hash).
6. Preserve superseded candidate branches/hashes for comparison. Never infer acceptance from silence or from praise of another revision.
7. After acceptance, verify the exact commit, merge it while preserving the accepted commit as a `main` ancestor, run mainline verification, and record the resulting mainline commit.

Scheduled/autonomous work may create and verify candidate commits, but it may not autonomously accept or mainline visual changes.

## Visual and performance gates

- Preserve effective DPR of at least `1.0`.
- Never trade pixel density for FPS.
- Reject sparse, blurry, muddy, clipped, or stuttering effects.
- Use deterministic pattern/seed benchmark routes.
- Do not measure FPS while capturing screenshots.
- Use at least 120 sampled frames for acceptance claims.
- Do not act on one sequentially biased suite; use mirrored forward/reverse rounds and per-pattern medians for final comparative ranking.
- Keep each cron change small enough to verify and commit within its time budget.
