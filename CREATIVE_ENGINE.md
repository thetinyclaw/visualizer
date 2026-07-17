# Creative Evolution Engine

This document is the creative contract for every autonomous visualizer run.

## North star

Build trippy, organic, cosmic-revelation visuals that feel discovered rather than decorated. Every accepted run should add a new spatial idea, temporal behavior, rendering improvement, or interaction—not merely recolor an existing effect.

## Concept grammar

Generate candidates by combining one item from each axis:

1. **World** — cellular tissue, abyssal reef, mycelium, nervous system, cloud chamber, star nursery, gravitational lens, impossible architecture, mineral growth, liquid crystal.
2. **Geometry** — signed-distance contours, warped polar fields, Voronoi boundaries, curl advection, iterated folds, raymarched shells, interference bands, stipple lattices, reaction fronts, recursive branching.
3. **Motion** — breathing, phase slipping, orbiting, budding, accreting, collapsing, flowing, molting, opening, synchronizing.
4. **Revelation** — hidden eye, aperture, horizon, nested world, impossible depth, emergence from noise, symmetry breaking, sudden alignment, dimensional tear, sacred topology.
5. **Audio role** — bass changes topology, mids drive locomotion, treble exposes microstructure. Audio should alter structure, not only brightness.
6. **Material** — phosphor, bioluminescent tissue, oil film, stained glass, plasma, ink, velvet void, crystalline membrane, magnetic dust, wet enamel.

A candidate must use at least three axes in a way not already represented in `EFFECTS.md`.

## Novelty gate

Before coding, write a one-paragraph candidate fingerprint containing:

- silhouette / dominant composition
- coordinate system and spatial primitive
- temporal behavior
- audio-to-structure mapping
- material / light model
- dominant computational cost

Reject the candidate if it overlaps the last five accepted fingerprints on four or more fields. Parameter, palette, density, and speed changes do not count as novelty.

## Candidate tournament

Each run should silently generate three concise candidates, score each from 0–2 on:

- visual distinctness
- organic/cosmic resonance
- audio-reactive depth
- feasibility in one bounded run
- performance risk (reverse scored)

Implement only the highest-scoring candidate. If no candidate scores at least 7/10, make a performance, sharpness, QA, or architecture improvement instead.

## Sharpness and performance doctrine

- Prefer analytic edges (`fwidth` when available, resolution-aware smoothstep otherwise) over brute-force DPR.
- Cap DPR and avoid unconditional expensive loops.
- Keep selected-pattern cost isolated; transitions may temporarily evaluate two patterns.
- Use constant GLSL loop bounds for cross-GPU compatibility.
- Reuse noise/hash primitives before adding new ones.
- Add complexity only when it creates visible structure.

## Acceptance loop

1. Read `PROJECT.md`, `CREATIVE_ENGINE.md`, `EFFECTS.md`, recent git history, and the current shader.
2. Ensure the working tree is clean. Never reset or discard unknown work.
3. Generate and score three candidates; record only the winner.
4. Implement one bounded effect or one measurable performance/sharpness improvement.
5. Run `python3 scripts/verify_visualizer.py`.
6. Serve on `0.0.0.0:8789`, browser-smoke the exact target effect, inspect console, and capture a screenshot.
7. Compare the screenshot to the candidate fingerprint. Reject bland, broken, illegible, or redundant work.
8. Update `EFFECTS.md`, `PROJECT.md`, and `README.md` when applicable.
9. Commit locally with a focused message. Do not push or merge unless explicitly authorized.
10. Report the artifact, visual concept, verification, and next underexplored direction.

## Safe fallback work

If implementation is blocked, do not invent success. Improve one of:

- deterministic effect selection for QA
- render-time instrumentation
- shader compile diagnostics
- anti-aliasing / edge sharpness
- duplicate-concept detection
- documentation and effect fingerprints
- browser compatibility
