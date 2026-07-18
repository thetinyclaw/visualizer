# RUNNING_NOTES

## Active work
- Perpetual evolution job: `aa298a921b15`, gpt-5.6-sol, every two hours, reports to the Visualizer Discord thread.
- Current branch remains `refresh/perf-layout-ponytail`; autonomous runs commit locally and do not push or merge.

## Hypotheses

## Experiments
- 2026-07-17: Cosmic Mycelium Revelation is the first effect developed under the new concept grammar and novelty gate.
- 2026-07-17: Rewrote Flow Field after measured audit found it at `4.94 FPS`. The analytic version reached `14.38 FPS` at the same `1280×633` canvas/seed and changed the image from sparse dashes to continuous luminous rivers.
- 2026-07-17: Rewrote Branches as a five-step inverse-folded grove, removing 256 segment and 30 leaf tests per pixel. A 120-frame same-browser check moved `15.91 → 16.51 FPS` and p95 `135.3 → 125.5 ms` at DPR `1.0`.
- 2026-07-17: Rewrote Galaxy with analytic spiral lanes and one cell-local star test instead of 100 point-distance tests. A 120-frame same-browser check moved `16.29 → 19.78 FPS` and p95 `146.2 → 142.3 ms` at DPR `1.0`.
- 2026-07-17: Replaced the sequential full-suite benchmark verdict with mirrored forward/reverse rounds and per-pattern medians; reports preserve ordered raw runs for auditing.
- 2026-07-17: Rewrote Neurons around a cell-local soma and analytic axon contours, removing 32 full-screen distance tests per pixel. Mirrored 120-frame median moved `14.47 → 17.83 FPS` at DPR `1.0`; screenshot metrics showed denser bright coverage and sharper edges.
- 2026-07-17: Optimized Voronoi's 3×3 nearest-cell search by comparing squared distances and recovering only the two roots needed for shading, reducing nine square roots per fragment to two without changing cell ordering or native density.
- 2026-07-18: Merged Stipple Waves' duplicate five-harmonic height/normal loops, reusing phase calculations. A 120-frame SwiftShader check moved `14.75 → 16.44 FPS` and p95 `119.7 → 84.2 ms` at DPR `1.0`.
- 2026-07-18: Optimized Ribbons by hoisting loop-invariant work and replacing per-layer exponential halos with finite cubic falloffs. A 120-frame SwiftShader check moved `15.83 → 16.26 FPS` and p95 `100.6 → 91.1 ms` at DPR `1.0`; screenshot mean color and bright coverage held steady.
- 2026-07-18: Reused Cosmic Mycelium's living warp fields for nebula shading, removing three redundant noise octaves. A 120-frame SwiftShader check moved `12.37 → 12.75 FPS` and p95 `136.4 → 132.5 ms` at DPR `1.0`; deterministic screenshot metrics retained dense coverage and edge detail.
- 2026-07-18: Replaced the full-screen film grain's structural vec3 hash with a compact interleaved-gradient hash. Mirrored 120-frame RGB Subpixels median moved `11.97 → 12.31 FPS` at `800×600`, DPR `1.0`; p95 was effectively flat and screenshot edge variation remained crisp.
- 2026-07-18: Recovered frequency-owned Voronoi work: stable bass/mid/treble generator affinity now changes individual cell area, motion, edge width, and nuclei instead of uniformly scaling the grid. A deterministic 120-frame run measured `15.48 FPS` at `756×469`, DPR `1.0`, with dense full-frame screenshot coverage.
- 2026-07-18: Recovered standalone `fft.html` Observatory work. Browser QA entered explicit demo mode, produced non-empty peak/centroid/RMS telemetry, and matched `scrollWidth` to the `756px` viewport; structural checks cover secure microphone gating, log interpolation, smoothing, peaks, history cadence, and DPR.

## Open questions
- Which visual families hold 60 FPS on the slowest target TV/mobile GPU? Add measured per-pattern timing before making adaptive quality decisions.
- Should concept-family pages eventually become selectable modes in the main visualizer, or remain a low-risk laboratory?

## Useful links

