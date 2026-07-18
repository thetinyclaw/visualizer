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

## 2026-07-18 — Treat Spectral Hive as a rotating shell, not a flat aperture
Context: Frame analysis initially misread the supplied honeycomb reference as seven planar cells around a central opening.
Decision: Model Spectral Hive as a projected rotating sphere with a center hex and approximately three surrounding shell layers. Internal light leaks through curved shell seams and produces outward volumetric rays.
Reason: The outer hex rows are foreshortened surface bands; sphere rotation, shell curvature, and central backlighting are the effect's defining topology.
Tradeoff: Spherical projection and moving surface coordinates cost more shader work than a fixed planar lattice, so performance must be recovered through analytic coordinates and bounded arithmetic rather than reducing backing density.

## 2026-07-18 — Preserve Spectral Hive interpretations as three pages
Context: The flat aperture and loose rotating shell are both visually useful even though neither fully replaces the other.
Decision: Keep Aperture, Shell, and Infinite Hexsphere as separate registered patterns and dedicated pages. Infinite Hexsphere uses an 80%-height sphere, lattice-matched perfect hex tiling, internal seam beams, FFT cell scale, and integrated FFT rotation velocity.
Reason: Creative iteration should branch successful interpretations instead of destructively replacing them.
Tradeoff: The uber-shader and verification surface grow, but each visual identity remains reproducible and independently benchmarkable.

## 2026-07-18 — Keep Hexsphere projection seams behind the camera
Context: Rotating the sphere normal before equirectangular mapping moved the longitude wrap across the visible ball and visibly modulated its expansion.
Decision: Compute longitude on the fixed front hemisphere, add an unbounded rotation offset, and never wrap visible coordinates. Sample the actual tiled gap pattern at the circumference to gate external beams, and drive panel gaps dynamically from FFT data.
Reason: The sphere silhouette must remain continuous while beams visibly originate from shell openings.
Tradeoff: Circumference gap sampling adds a second analytic hex lookup per fragment, so native-density performance must be re-benchmarked.

