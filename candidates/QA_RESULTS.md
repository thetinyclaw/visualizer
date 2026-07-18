# Candidate QA results — video organics A

## Reference inspection

- `doc_e54f7242eea9_20260718-2038-39.1716252.mp4`: h264 1240×628 at 30 fps, duration 5.482646s, AAC audio. Contact sheets showed a monochrome volumetric shard/tunnel/cathedral: cracked line networks, aperture slabs, camera/light motion through high-contrast panels, and intentional dark negative space.
- `doc_f2e836acf4a0_20260718-2039-12.9391643.mp4`: h264 1220×656 at 30 fps, duration 3.519979s, AAC audio. Contact sheets showed an oblique chromatic iris/toroid: central dark void, iridescent cyan/violet/amber sectors, radial fiber bundles, rim spores, and drifting highlight phase.

## Browser visual QA

- `candidates/prismatic-rupture-cathedral.html?seed=491009`: WebGL compiled with clean console. Visual inspection: crisp monochrome fracture lines, bright central aperture, layered shard tunnel/cathedral feel. Honest defect: still uses deliberate black side negative space; density is concentrated in the central vertical volume rather than uniformly filling every edge.
- `candidates/chromatic-iris-mycorrhiza.html?seed=491009`: WebGL compiled with clean console. Visual inspection: full-screen chromatic iris with dark void, dense radial fibers/spores, organic/cosmic material. Honest defect: soft bloom makes parts of the ring painterly rather than razor-sharp, though fine particle/fiber detail remains visible.

## Exact benchmark telemetry

Both benchmarks used `?benchmark=1&seed=491009&frames=120` in HeadlessChrome 150 / WebKit WebGL at 1280×633 CSS/backing, effective DPR 1.0, 30 warmup frames, 16 FFT-ready bands.

### Prismatic Rupture Cathedral

```json
{
  "candidate": "Prismatic Rupture Cathedral",
  "path": "/candidates/prismatic-rupture-cathedral.html",
  "seed": 491009,
  "frames": 120,
  "warmupFrames": 30,
  "avgFrameMs": 75.83083333333335,
  "avgFps": 13.18724793125048,
  "p95FrameMs": 116.69999999999892,
  "worstFrameMs": 133.30000000000018,
  "cssWidth": 1280,
  "cssHeight": 633,
  "backingWidth": 1280,
  "backingHeight": 633,
  "effectiveDprX": 1,
  "effectiveDprY": 1,
  "renderer": "WebKit WebGL",
  "vendor": "WebKit",
  "fftReadyBands": 16,
  "timestamp": "2026-07-18T20:54:18.360Z"
}
```

### Chromatic Iris Mycorrhiza

```json
{
  "candidate": "Chromatic Iris Mycorrhiza",
  "path": "/candidates/chromatic-iris-mycorrhiza.html",
  "seed": 491009,
  "frames": 120,
  "warmupFrames": 30,
  "avgFrameMs": 100.9675,
  "avgFps": 9.90417708668631,
  "p95FrameMs": 133.3000000000011,
  "worstFrameMs": 133.40000000000146,
  "cssWidth": 1280,
  "cssHeight": 633,
  "backingWidth": 1280,
  "backingHeight": 633,
  "effectiveDprX": 1,
  "effectiveDprY": 1,
  "renderer": "WebKit WebGL",
  "vendor": "WebKit",
  "fftReadyBands": 16,
  "timestamp": "2026-07-18T20:53:56.322Z"
}
```
