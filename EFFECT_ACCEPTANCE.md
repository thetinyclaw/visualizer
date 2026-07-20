# Effect Acceptance Ledger

This ledger separates **previewed**, **accepted**, and **mainlined** visual work.
A focused preview is valid only when its URL starts with `/@git/<commit>/`; a
`?fix=<commit>` query by itself is not commit-pinned and must never be presented
as immutable evidence.

## Required workflow

1. Branch from `main` as `candidate/<effect>/<description>`.
2. Make one coherent effect revision plus focused tests/docs and commit it.
3. Send the exact candidate commit and an immutable preview URL:
   `https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/<commit>/?pattern=<n>&seed=491009&mode=demo`
4. Record status as **CANDIDATE**. Do not change `main`.
5. Wait for an explicit `accept <commit>` from SeaKoala.
6. Re-verify that exact commit, then merge its candidate branch into `main` in a
   way that preserves the accepted commit as an ancestor. Record both the
   accepted commit and resulting mainline commit.
7. Keep superseded candidates viewable. Never infer acceptance from silence,
   praise of a different revision, or the existence of a later commit.

## Recovery audit of focused revisions

The revisions below were historically committed and later placed on `main`
without a separate explicit-acceptance record. They remain recoverable and are
therefore marked **LEGACY-MAINLINED / REVIEW**, not retroactively “accepted.”

### Filament Vortex — pattern 13

- `541244a` — seam removal, seeded center geometry, palette families — **SUPERSEDED / REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/541244a/?pattern=13&seed=491009&mode=demo>
- `4ce74d9` — circular FFT ownership and periodic bundle hashing — **LEGACY-MAINLINED / REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/4ce74d9/?pattern=13&seed=491009&mode=demo>

### Stipple Waves — pattern 0

- `8add53f` — dense initial 16-band per-pixel FFT treatment — **SUPERSEDED / PRIORITY REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/8add53f/?pattern=0&seed=491009&mode=demo>
- `0c8630f` — optimized FFT treatment — **LEGACY-MAINLINED / REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/0c8630f/?pattern=0&seed=491009&mode=demo>

The initial `8add53f` treatment is priority review because SeaKoala explicitly
praised its dense per-pixel personality after the optimization landed.

### Branches — pattern 3

- `aa1bc40` — constricting bark roots — **LEGACY-MAINLINED / REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/aa1bc40/?pattern=3&seed=491009&mode=demo>

### Voronoi — pattern 5

- `82c5d9c` — glacial clock — **SUPERSEDED / REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/82c5d9c/?pattern=5&seed=491009&mode=demo>
- `a846a98` — spectral pressure waves with stable topology — **SUPERSEDED / PRIORITY REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/a846a98/?pattern=5&seed=491009&mode=demo>
- `8a841db` — winner-centered F2 and softened boundary blending — **LEGACY-MAINLINED / REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/8a841db/?pattern=5&seed=491009&mode=demo>

### Galaxy — pattern 7

- `ca1a289` — initial field-wide Infinity Wells — **SUPERSEDED / PRIORITY REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/ca1a289/?pattern=7&seed=491009&mode=demo>
- `0e6ce45` — stronger contours, cores, halos, and gravity moats — **LEGACY-MAINLINED / REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/0e6ce45/?pattern=7&seed=491009&mode=demo>

### Spectral Waterfall — v4 scene

- `4d1f52a` — initial VEffect — **SUPERSEDED / REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/4d1f52a/v4/spectrogram.html?seed=491009&time=18&mode=demo>
- `3e22393` — opt-in adaptive normalization — **LEGACY-MAINLINED / REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/3e22393/v4/spectrogram.html?seed=491009&time=18&mode=demo>

### RGB Subpixels — pattern 9

- `09e53af` — independent full-extinction cycles — **SUPERSEDED / PRIORITY REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/09e53af/?pattern=9&seed=491009&mode=demo>
- `57684f9` — size/frequency stratification and brighter amplitude ownership — **LEGACY-MAINLINED / REVIEW**
  - <https://tinyclaws-mini-1.tail331b3.ts.net:8443/@git/57684f9/?pattern=9&seed=491009&mode=demo>

## Status vocabulary

- **CANDIDATE** — committed and previewable; not accepted and not on `main`.
- **ACCEPTED** — SeaKoala explicitly accepted this exact commit; awaiting merge.
- **MAINLINED** — accepted commit is an ancestor of `main` and passed mainline verification.
- **SUPERSEDED** — retained for comparison; never deleted merely because a later candidate exists.
- **LEGACY-MAINLINED / REVIEW** — currently on `main`, but historical explicit acceptance was not recorded.
