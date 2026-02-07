# Project: Music Visualizer

## Brief
Procedurally generated geometric/organic screen saver.
Reactive to audio input via Microphone.
Web-based (Three.js/WebGL) for "Milkdrop/trippy/fractal" aesthetic.

## Tech Stack
- **Core:** HTML5, JavaScript
- **Graphics:** Three.js (WebGL) + GLSL Shaders
- **Audio:** Web Audio API (`navigator.mediaDevices.getUserMedia`)
- **Deployment:** Static HTML file (hosted on OpenClaw or local)

## Status
- [x] Define platform: Web (Cast to TV)
- [x] Define audio source: Microphone (Browser access)
- [x] Define vibe: Milkdrop/Fractal
- [x] Scaffold basic `index.html` with Three.js setup
- [x] Implement audio analysis (FFT) (Basic pulse implemented)
- [x] Fix WebGL/shader error handling (2026-02-07)
- [x] Fix GLSL Intel/Windows compatibility (2026-02-07)
- [ ] Create initial fractal shader

## Recent Fixes (2026-02-07)
- Added WebGL context availability check with user-friendly error
- Added shader compilation error display
- Fixed "Loop index cannot be compared with non-constant expression" for Intel GPUs
- Changed dynamic loop bounds to constants with early break

## Usage
User visits URL -> Allows Mic -> Visuals react to room sound.
