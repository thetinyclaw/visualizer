# Effect Pipeline

This is an open-ended generation and acceptance pipeline, not a finite backlog. Each successful run expands the grammar and fingerprint ledger, creating new combinations for later runs.

## Why the supply is effectively inexhaustible

A concept is assembled from independently mutable axes:

- world / subject
- dominant composition
- coordinate system
- geometric primitive
- scale relationship
- motion law
- optical/material model
- audio-to-structure mapping
- temporal arc
- computational strategy

Each axis can add newly discovered values. Accepted effects append fingerprints to `EFFECTS.md`; the novelty gate then forces subsequent runs toward unused combinations. The system therefore explores a growing search space instead of draining a fixed list.

## Run state machine

1. **Inventory** — read the ledger, last five fingerprints, performance results, and recent history.
2. **Generate** — create at least three candidates from different dominant primitives/compositions.
3. **Novelty preflight** — reject palette, density, speed, noun, or seed variants.
4. **Cost preflight** — estimate fragment loops, noise calls, branching, overdraw, and transition cost before coding.
5. **Prototype** — implement one bounded winner with deterministic `pattern` and `seed` selection.
6. **Structural verification** — run `python3 scripts/verify_visualizer.py`.
7. **Performance gate** — benchmark at fixed seed, viewport, backing dimensions, and renderer.
8. **Full-density visual grade** — inspect the actual full-viewport frame and motion; reject blur, sparsity, dead zones, broken continuity, aliasing, clipping, muddy color, or generic composition.
9. **Accept or destroy** — optimize until both gates pass, or revert only the run's own candidate. Never retain a failed effect as accepted inventory.
10. **Ledger and commit** — add the fingerprint, metrics, and focused local commit.

## Native-density gate

- Effective DPR must remain at least `1.0` in both axes.
- Canvas CSS dimensions must equal the full viewport dimensions.
- Lowering backing resolution below one pixel per CSS pixel is not an optimization and cannot pass.
- DPR may be capped above `1.0` to prevent Retina/TV fill-rate waste, but detail must come from analytic geometry and anti-aliasing rather than low-resolution blur.
- The benchmark records backing size, CSS size, and effective DPR so density claims are auditable.

## Frame-rate gate

For a new or changed effect, use one renderer, viewport, seed, sample length, and browser session.

A new effect must achieve both:

1. at least 90% of the same-environment median established-pattern FPS;
2. at least 90% of a structurally comparable established pattern.

A performance refactor must materially improve measured FPS/p95 while preserving or improving the visual grade. Automation-browser FPS is relative evidence, not a universal hardware claim. Target-device aspiration remains smooth 60 FPS.

## Benchmark workflow

### One pattern

Open:

```text
index.html?benchmark=1&pattern=2&seed=491009&frames=120
```

The page auto-enters demo mode, warms up for 30 frames, samples the requested frames, logs `VISUALIZER_BENCHMARK`, and exports the same object as:

```js
window.__VISUALIZER_BENCHMARK__
```

Telemetry includes average FPS/frame time, p95/worst frame time, backing and CSS dimensions, effective DPR, renderer, user agent, seed, and pattern identity. After timing ends, the page reads the final framebuffer once and records sampled mean luminance, dark/bright coverage, and horizontal edge energy. The readback never overlaps sampled frames, so visual-density evidence cannot contaminate FPS.

### Full suite

Open:

```text
benchmark.html?autorun=1&seed=491009&frames=120
```

The dashboard discovers `PATTERN_COUNT` from the child result, benchmarks every pattern forward and then in reverse at full viewport, and uses each pattern's two-run median to neutralize warm-up and ordering bias. It shows the same-environment median, 90% floor, native-density status, and per-pattern results. Raw ordered runs remain in `rawResults`; the complete report is exported as:

```js
window.__VISUALIZER_SUITE__
```

The dashboard enforces a minimum of 120 sampled frames before issuing pass/fail labels; shorter samples proved too sensitive to startup and scheduler noise. The JSON can be downloaded from the dashboard.

## Optimization order

Never solve frame rate by silently degrading density. Optimize in this order:

1. remove per-fragment nested integration and redundant noise;
2. replace particle/ray approximations with analytic fields where visually equivalent or better;
3. isolate selected-pattern shader work;
4. avoid double-render transitions for heavy patterns;
5. reduce overdraw and invisible calculations;
6. split the uber-shader into per-pattern programs if driver/compiler behavior warrants it;
7. cap DPR above native CSS density only after shader work is efficient.

## Current frontier

Underexplored directions that expand the grammar rather than repeat it:

- SDF/raymarched organisms with strict bounded steps
- domain-folded biological mandalas
- caustic and thin-film optical interference
- faux-feedback memory ghosts without framebuffer dependencies
- nested micro/macro reveals
- creature morphology: jellyfish, shells, polyps, embryos
- symbolic masks: irises, petals, runes, apertures
- compositional depth: foreground organism plus parallax cosmic field

This list is a frontier, not a queue. Every accepted run should add at least one new frontier value or retire one only after transforming it into a verified fingerprint.
