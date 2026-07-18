# Candidate QA results — video organics A

## Repair pass

- `Prismatic Rupture Cathedral`: broadened the rupture topology from a single central column into a full-frame mirrored cathedral lattice: wider fracture layers, flank cracks, oblique shard sheets, arch ribs, and a subtle background veil. The central aperture/cross hierarchy remains crisp and monochrome, with intentional dark falloff only near the far edges.
- `Chromatic Iris Mycorrhiza`: replaced undefined reversed `smoothstep` masks with explicit `invSmooth(...)`, which removes the portability path that could render black on stricter WebGL implementations. Reworked the expensive 3×3 spore neighborhood into a faster seeded cell/dust field and kept the dense toroidal iris, central void, chromatic sectors, mycelial filaments, spores, and 16-band FFT ownership.

## Browser visual QA

- `candidates/prismatic-rupture-cathedral.html?seed=491009`: WebGL compiled with clean console. Visual inspection: dense fractured cathedral/rupture fills most of the 1280×633 viewport, including side-wall shards and arch ribs; no blank half-frame. Remaining edge darkness reads as vignette/negative space rather than inert black.
- `candidates/chromatic-iris-mycorrhiza.html?seed=491009`: WebGL compiled with clean console. Visual inspection: visible dense chromatic toroidal organic iris with a dark central void, radial filaments, spores, cyan/violet/amber sectoring, and nebular background; no blank/black render.

## Exact benchmark telemetry

Both benchmarks used `?benchmark=1&seed=491009&frames=120` in HeadlessChrome 150 / WebKit WebGL at 1280×633 CSS/backing, effective DPR 1.0, 30 warmup frames, 16 FFT-ready bands. Console check after benchmark reported 0 JS errors and 0 console messages.

### Prismatic Rupture Cathedral

```json
{
  "candidate": "Prismatic Rupture Cathedral",
  "path": "/candidates/prismatic-rupture-cathedral.html",
  "seed": 491009,
  "frames": 120,
  "warmupFrames": 30,
  "avgFrameMs": 50.83166666666666,
  "avgFps": 19.6727761565953,
  "p95FrameMs": 133.30000000000018,
  "worstFrameMs": 133.39999999999964,
  "cssWidth": 1280,
  "cssHeight": 633,
  "backingWidth": 1280,
  "backingHeight": 633,
  "effectiveDprX": 1,
  "effectiveDprY": 1,
  "renderer": "WebKit WebGL",
  "vendor": "WebKit",
  "fftReadyBands": 16,
  "timestamp": "2026-07-18T21:04:57.841Z"
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
  "avgFrameMs": 62.08083333333334,
  "avgFps": 16.108031195887083,
  "p95FrameMs": 100,
  "worstFrameMs": 133.39999999999964,
  "cssWidth": 1280,
  "cssHeight": 633,
  "backingWidth": 1280,
  "backingHeight": 633,
  "effectiveDprX": 1,
  "effectiveDprY": 1,
  "renderer": "WebKit WebGL",
  "vendor": "WebKit",
  "fftReadyBands": 16,
  "timestamp": "2026-07-18T21:05:24.303Z"
}
```
