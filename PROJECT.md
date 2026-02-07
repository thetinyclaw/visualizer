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
- [ ] Create initial fractal shader

## Usage
User visits URL -> Allows Mic -> Visuals react to room sound.
