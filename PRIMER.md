# PRIMER

## What this project is
Music Visualizer is a web-based Three.js/WebGL screensaver-style visualizer that reacts to microphone input with a Milkdrop/fractal/trippy aesthetic.

## Why it exists
To generate an immersive audio-reactive visual experience in the browser, suitable for casting to a TV or running locally.

## Current goals
- Keep the WebGL/audio pipeline stable
- Finish or refine the fractal shader
- Maintain cross-browser shader compatibility

## Main components
- `index.html`
- Three.js/WebGL rendering
- GLSL shaders
- Web Audio API microphone input

## Constraints
- Browser mic permissions required
- WebGL / shader compatibility matters across GPUs
- Static web deployment

## Glossary
- FFT: frequency analysis of incoming audio
- Shader: GPU program that drives the visual effect

## If you only read one file
Read `PROJECT.md` and `index.html`.
