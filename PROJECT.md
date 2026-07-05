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
- [x] Add nine generated shader patterns, including RGB subpixel rectangle blocks
- [x] Refresh render-loop performance and layout (Ponytail pass, 2026-07-05)

## Recent Refresh (2026-07-05)
- Capped high-DPI render buffer to reduce fill-rate cost on Retina/TV displays.
- Switched animation timing to `performance.now()`.
- Throttled HUD DOM updates.
- Guarded audio startup against duplicate pointer/touch events.
- Moved static WebGL uniform updates out of the hot render loop.
- Skips next-pattern shader work until transitions actually need it.
- Removed dead generated params and unused GLSL helpers.

## Design Concepts
- **RGB Subpixels:** zoomed-in TV-pixel entities made from adjacent red, green, and blue rectangles, with scanline shimmer and audio-reactive brightness.

## Usage
User visits URL -> starts visualizer -> allows mic if desired. If mic is missing or denied, visuals still animate in demo mode. Use arrow keys or horizontal swipes to move between patterns.
