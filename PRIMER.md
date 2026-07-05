# PRIMER

## What this project is
Music Visualizer is a web-based raw WebGL screensaver-style visualizer that reacts to microphone input, or to a synthetic demo pulse when mic access is unavailable.

## Why it exists
To generate an immersive audio-reactive visual experience in the browser, suitable for casting to a TV or running locally.

## Current goals
- Keep the WebGL/audio pipeline stable
- Preserve smooth performance on laptop, mobile, and TV browsers
- Maintain cross-browser shader compatibility

## Main components
- `index.html`
- Raw WebGL rendering
- GLSL shader patterns
- RGB subpixel rectangle design concept
- Web Audio API microphone input
- Synthetic demo fallback

## Constraints
- Browser mic permissions required for real audio reactivity
- WebGL / shader compatibility matters across GPUs
- Static web deployment: no build step, no dependencies

## Glossary
- FFT: frequency analysis of incoming audio
- Shader: GPU program that drives the visual effect
- DPR: device-pixel ratio; capped here to avoid high-DPI fill-rate spikes

## If you only read one file
Read `PROJECT.md` and `index.html`.
