# TinyClaw Visualizer

Audio-reactive WebGL visualizer for ambient TV / browser display. It is a single static HTML file: no build step, no package install, no backend.

## Run locally

```bash
python3 -m http.server 8789 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8789/index.html
```

Click the overlay to start. If browser microphone access works, the shader reacts to the mic. If no mic is available or permission is denied, the app now falls back to a synthetic `demo` pulse so visuals still move.

## Controls

- `N` or `[N]ext`: next pattern
- `←` / `→`: previous / next pattern
- Swipe right / left: previous / next pattern on touch devices
- `R` or `[R]andomize`: new seed / palette / generated parameters

For deterministic QA, select a pattern and seed with `?pattern=N&seed=S`. Example: `index.html?pattern=8&seed=491009` opens and locks a repeatable **Cosmic Mycelium** scene without auto-transitioning.

## Current status

- Static WebGL/GLSL app
- Ten generated patterns: Stipple Waves, Neurons, Flow Field, Branches, Reaction, Voronoi, Ribbons, Galaxy, Cosmic Mycelium, RGB Subpixels
- Cosmic Mycelium combines a bass-opened gravitational aperture, living log-polar filaments, nested revelation rings, and treble-revealed stellar spores
- Flow Field uses fast analytic domain-warped rivers and capillaries instead of the former 1,500-step-per-pixel particle integration
- RGB Subpixels includes experimental panel effects: glitter, reflections, chromatic halos, phosphor smear, moire shimmer, and aging pixel cells
- Stipple family pages:
  - `stipple-topography.html` — contour-map stipple waves
  - `stipple-glass-reef.html` — caustic/glass/glitter stipple waves
  - `stipple-ink-dunes.html` — desert ink/paper-grain stipple waves
- Cross-browser shader error reporting
- Mic mode with Web Audio API
- Demo fallback mode when mic access is unavailable
- Autonomous creative contract and anti-repetition ledger in `CREATIVE_ENGINE.md` and `EFFECTS.md`

## Verify

```bash
python3 scripts/verify_visualizer.py
```

For a full-density sequential performance run, open:

```text
benchmark.html?autorun=1&seed=491009&frames=120
```

`EFFECT_PIPELINE.md` defines the native-density, comparative frame-rate, visual-grade, and accept/reject gates used by autonomous runs.

## Deployment

Any static host works: GitHub Pages, local Mac mini HTTP service, nginx, Caddy, or a TV/cast browser pointed at the file over HTTP.

For GitHub Pages, publish the `main` branch root and use `index.html` as the entry point.
