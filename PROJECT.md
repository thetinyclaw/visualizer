# Project: Music Visualizer

## Brief
Procedurally generated geometric/organic ambient visualizer.
Reactive to microphone input when available, with a synthetic demo pulse fallback when mic access is unavailable.
Web-based raw WebGL/GLSL for a Milkdrop/trippy/fractal-style aesthetic.

## Tech Stack
- **Core:** HTML5, JavaScript
- **Graphics:** Raw WebGL + GLSL shaders
- **Audio:** Web Audio API (`navigator.mediaDevices.getUserMedia`) with demo fallback
- **Deployment:** Static HTML file (hosted on OpenClaw, GitHub Pages, or local HTTP)

## Status
- [x] Define platform: Web (cast/browser/TV)
- [x] Define audio source: microphone + demo fallback
- [x] Define vibe: Milkdrop/fractal/generative ambient
- [x] Implement raw WebGL shader pipeline
- [x] Implement audio analysis (FFT)
- [x] Fix WebGL/shader error handling
- [x] Fix GLSL Intel/Windows loop compatibility
- [x] Add ten generated shader patterns, including Cosmic Mycelium and RGB subpixel rectangle blocks
- [x] Refresh render-loop performance and layout (Ponytail pass, 2026-07-05)
- [x] Establish recurring creative evolution contract, novelty gate, effect ledger, and structural verifier (2026-07-17)

## Recent Refresh (2026-07-05)
- Capped high-DPI render buffer to reduce fill-rate cost on Retina/TV displays.
- Switched animation timing to `performance.now()`.
- Throttled HUD DOM updates.
- Guarded audio startup against duplicate pointer/touch events.
- Moved static WebGL uniform updates out of the hot render loop.
- Skips next-pattern shader work until transitions actually need it.
- Removed dead generated params and unused GLSL helpers.

## Flow Field rewrite (2026-07-17)
- Replaced the old `50 × 30` per-fragment curl integration (~1,500 path steps per pixel) with analytic domain-warped stream contours.
- Produces continuous crossing rivers and treble capillaries instead of sparse disconnected dashes.
- Same-browser benchmark at `1280×633`, seed `491009`: `4.94 FPS → 14.38 FPS`.
- Audio now changes geometry: bass controls filament width, mids bend topology, and treble exposes microstructure.

## Design Concepts
- **RGB Subpixels:** zoomed-in TV-pixel entities made from adjacent red, green, and blue rectangles, with scanlines, glitter, chromatic edge glow, prism/reflection streaks, phosphor smear, imperfect glass warping, and aging/dead-pixel behavior.
- **Stipple Family Pages:** standalone raw-WebGL pages exploring the original stipple-wave language as topographic contour dots, glass/reef caustics, and ink-dune paper grain.
- **Cosmic Mycelium:** a living radial aperture with domain-warped fungal filaments, phase-slipping revelation rings, gravitational lensing, and audio-structured stellar spores.

## Continuous evolution
- `CREATIVE_ENGINE.md` defines the concept grammar, three-candidate tournament, novelty gate, performance doctrine, and acceptance loop.
- `EFFECTS.md` fingerprints accepted visual families so recurring runs can reject superficial duplicates.
- `scripts/verify_visualizer.py` checks registration, transition, documentation, and performance invariants before browser QA.

## Usage
User visits URL -> starts visualizer -> allows mic if desired. If mic is missing or denied, visuals still animate in demo mode. Use arrow keys or horizontal swipes to move between patterns.
