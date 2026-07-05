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

## Current status

- Static WebGL/GLSL app
- Nine generated patterns: Stipple Waves, Neurons, Flow Field, Branches, Reaction, Voronoi, Ribbons, Galaxy, RGB Subpixels
- RGB Subpixels includes experimental panel effects: glitter, reflections, chromatic halos, phosphor smear, moire shimmer, and aging pixel cells
- Stipple family pages:
  - `stipple-topography.html` — contour-map stipple waves
  - `stipple-glass-reef.html` — caustic/glass/glitter stipple waves
  - `stipple-ink-dunes.html` — desert ink/paper-grain stipple waves
- Cross-browser shader error reporting
- Mic mode with Web Audio API
- Demo fallback mode when mic access is unavailable

## Deployment

Any static host works: GitHub Pages, local Mac mini HTTP service, nginx, Caddy, or a TV/cast browser pointed at the file over HTTP.

For GitHub Pages, publish the `main` branch root and use `index.html` as the entry point.
