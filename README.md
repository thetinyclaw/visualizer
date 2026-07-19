# TinyClaw Visualizer

Audio-reactive browser visualizer for ambient TV / browser display. The legacy 19-effect WebGL cycle remains a single static HTML file; Visualizer v4 adds no-build ES modules and native WebGPU hero routes. There is no backend or production build step.

## Run locally

```bash
python3 -m http.server 8789 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8789/index.html
```

For a dedicated logarithmic spectrum, waveform, radial peak-envelope, and
spectrogram instrument, open `http://127.0.0.1:8789/fft.html`. Microphone mode
requires a secure context outside localhost; its explicit demo mode remains
visually distinct from live input.

Tailnet HTTPS routes (required for iPhone Safari microphone access):

- Visualizer: `https://tinyclaws-mini-1.tail331b3.ts.net:8443/index.html`
- FFT Observatory: `https://tinyclaws-mini-1.tail331b3.ts.net:8443/fft.html`

Click the overlay to start. If browser microphone access works, the shader reacts to the mic. If no mic is available or permission is denied, the app now falls back to a synthetic `demo` pulse so visuals still move.

## Controls

- `N` or `[N]ext`: next pattern
- `←` / `→`: previous / next pattern
- Swipe right / left: previous / next pattern on touch devices
- `R` or `[R]andomize`: new seed / palette / generated parameters
- `T` or `[TV] Mode`: open AirPlay guidance and enter a clean television display mode

## AirPlay from iPhone Safari

1. Start the visualizer and tap `[TV] Mode`.
2. Open iPhone Control Center and tap **Screen Mirroring**.
3. Choose the Apple TV or AirPlay-compatible television.
4. Rotate the phone sideways and tap **Enter TV Mode**.

TV Mode requests fullscreen and landscape orientation where Safari supports them, hides visualizer chrome, and requests a screen wake lock when available. Tap the visualizer to reveal the controls for four seconds; tap `[TV] Exit` to leave. The direct `?tv=1` route opens the AirPlay guidance automatically.

Safari does not expose an AirPlay picker for a WebGL canvas, so the television is selected through iOS Control Center rather than from the webpage itself.

For deterministic QA, select a pattern and seed with `?pattern=N&seed=S`. Example: `index.html?pattern=8&seed=491009` opens and locks a repeatable **Cosmic Mycelium** scene without auto-transitioning.

Visualizer v4 lives in the isolated `v4/` module surface. Open `http://127.0.0.1:8789/v4/index.html` for the unified, read-only launcher. It links deterministic locked routes without hidden canvases, microphone requests, or background GPU work. The executable routes currently include:

- `v4/cathedral.html` — native WebGPU Prismatic Cathedral geometry → post → composite.
- `v4/filament.html` — compute ping-pong Filament Vortex → ribbons → post → composite.
- `v4/voxel.html` — compute-updated 260-cell instanced Neon Voxel Cloud → post → composite.
- `v4/history.html` — transactional ping-pong history/trails diagnostic.
- `v4/demo.html` — bounded volume → bloom/chromatic optics/ACES → two-layer crossfade smoke.
- `v4/live-audio.html` — trusted-click microphone bridge with honestly labeled Demo/Flat modes.

Committed immutable Chromium evidence exists for the three hero routes. It is automation-browser evidence, not Safari/TV target-device acceptance or human release approval. The release gates remain intentionally fail-closed.

The six reference-informed effects are part of the automatic main cycle at indices `13–18` and remain available as standalone candidate pages. Every route accepts deterministic `?seed=...`; append `?benchmark=1&seed=491009&frames=120` for native-density telemetry:

- `candidates/filament-vortex.html`
- `candidates/prismatic-rupture-cathedral.html`
- `candidates/chromatic-iris-mycorrhiza.html`
- `candidates/recursive-diamond-lattice.html`
- `candidates/neon-voxel-scan-cloud.html`
- `candidates/scarlet-velocity-ribbons.html`

Example benchmark route: `candidates/filament-vortex.html?benchmark=1&seed=491009&frames=120`.

## Current status

- Static WebGL/GLSL app
- Nineteen generated patterns, including three preserved Spectral Hive variants and six reference-informed effects in the automatic cycle
- Neurons uses cell-local somas and analytic warped axons instead of 32 full-screen distance tests per pixel
- Cosmic Mycelium combines a bass-opened gravitational aperture, living log-polar filaments, nested revelation rings, and treble-revealed stellar spores; its domain fields are reused for low-cost nebula shading
- Flow Field uses fast analytic domain-warped rivers and capillaries instead of the former 1,500-step-per-pixel particle integration
- Branches uses inverse-folded binary trees and cell-hashed drifting seeds instead of 286 per-pixel distance tests
- Voronoi assigns every generator one of 16 logarithmic FFT bins; weighted distance makes loud-bin cells expand dramatically while quiet-bin neighbors compress, without changing global grid density
- RGB Subpixels scatters randomized multi-scale RGB clusters across the frame; tightly overlapping channels, 16-bin FFT ownership, soft chromatic spill, edge contours, and seam-free two-nearest compositing replace the former rigid panel grid
- Spectral Hive now has three dedicated pages:
  - `hive-aperture.html` — preserved flat seven-cell aperture
  - `hive-shell.html` — loose three-layer rotating spherical shell
  - `hive-infinite.html` — perfectly tiled Hexsphere with hidden longitude wrap, constant rotation, 400% FFT gap motion, onset/flux-driven radius, and a complete seam network acting as continuous beam lines
- Stipple family pages:
  - `stipple-topography.html` — contour-map stipple waves
  - `stipple-glass-reef.html` — caustic/glass/glitter stipple waves
  - `stipple-ink-dunes.html` — desert ink/paper-grain stipple waves
- Cross-browser shader error reporting
- Candidate route `candidates/filament-vortex.html`: a dense microphone/demo reactive filament aperture inspired by the supplied vortex reference at the level of topology/material/motion only
- Low-ALU interleaved-gradient film grain preserves texture without reusing the heavier structural noise hash on every pixel
- Mic mode with Web Audio API
- Shared 16-bin 20 Hz–20 kHz FFT bus: 4096-sample analysis, bandwidth-neutral RMS power, frequency-dependent attack/release envelopes, and four reusable `vec4` shader uniforms
- Demo fallback mode when mic access is unavailable
- Standalone `fft.html` observatory with log-frequency interpolation, asymmetric attack/release smoothing, decaying peaks, waveform, spectrogram history, and honest mic/demo/idle states
- Autonomous creative contract and anti-repetition ledger in `CREATIVE_ENGINE.md` and `EFFECTS.md`

## Verify

```bash
python3 scripts/verify_v4_runtime.py
node scripts/verify_v4_runtime_behavior.mjs
python3 scripts/verify_v4_hero_lab.py
node scripts/verify_v4_launcher.mjs
python3 scripts/verify_visualizer.py
python3 scripts/verify_candidates.py
python3 -m unittest tests/test_v4_evidence.py
python3 v4/tools/visualizer_v4_evidence.py verify-all
```

The v4 evidence tooling under `v4/evidence/` adds provenance, scene-recipe,
deterministic capture-spec, motion-sheet, benchmark-report, Gate 1/2/3,
candidate-factory, release manifest, rollback, and read-only HTTPS verification
scaffolding. It is fail-closed for missing human approval, DPR below `1.0`,
benchmark samples below 120 frames, ambiguous telemetry labels, and autonomous
self-merge paths.

For a full-density mirrored forward/reverse performance run, open:

```text
benchmark.html?autorun=1&seed=491009&frames=120
```

`EFFECT_PIPELINE.md` defines the native-density, comparative frame-rate, visual-grade, and accept/reject gates used by autonomous runs.

## Deployment

Any static host works: GitHub Pages, local Mac mini HTTP service, nginx, Caddy, or a TV/cast browser pointed at the file over HTTP.

For GitHub Pages, publish the `main` branch root and use `index.html` as the entry point.
