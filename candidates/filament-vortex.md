# Filament Vortex candidate

Standalone route: `candidates/filament-vortex.html?seed=491009`

## Reference abstraction

The supplied image is treated only as a high-level grammar: a dense field of hairlike luminous strands curves into a dark vortex throat, with a pearl/cold-metal material and subtle violet near the aperture. The implementation uses no pixels from the source: it does not sample, embed, trace, or reproduce source pixels. It transforms the idea into a seedable shader with different strand equations, seeded off-center aperture, procedural band ownership, and live FFT topology controls.

## Shader/effect contract

- **Topology:** full-frame log-polar filament bundles swirl around a seeded gravitational throat. The aperture remains dark, asymmetrically warped, and crisply rim-lit; a tightened lensing shadow avoids the former broad center dead zone.
- **Material:** cold pearlescent plasma fibers on a blue-black cosmic void with minimal procedural grain and faint violet mid-field mist to preserve depth.
- **Motion:** angular flow integrates time through inward radial advection; three non-harmonic hair families, seeded shredding, and broken bundle gates ride the spiral field so the vortex reads as turbulent filaments rather than contour rings.
- **Audio structure:** four `vec4` uniforms expose a 16-band logarithmic FFT bus. Bass opens the organic aperture and rim, low/mids change curl strength and advection, high mids perturb lane phase, and treble splits fine hair lanes. Each angular sector owns a stable FFT bin via `fftBand()` so frequency bands deform local filament width and brightness independently.
- **Density:** the canvas backing store is never below native CSS density (`effectiveDprX/Y >= 1.0`), with only an above-native DPR cap at 2×.
- **Determinism:** `?seed=<int>` fixes aperture center, twist, lane skew, and material variation. `?benchmark=1&frames=120` starts deterministic demo-mode benchmarking without requiring microphone permission.

## Benchmark telemetry

The route exports a `window.__VISUALIZER_BENCHMARK__` object comparable to the main visualizer benchmark with average FPS/frame time, p95/worst frame, CSS/backing dimensions, effective DPR, renderer, user agent, seed, route, mode, and frame counts.

## QA route examples

```text
candidates/filament-vortex.html?seed=491009
candidates/filament-vortex.html?benchmark=1&seed=491009&frames=120
```
