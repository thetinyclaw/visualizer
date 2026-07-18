# Video-organics candidate notes

These routes are original reference-informed WebGL candidates, not frame recreations. Both use the shared `candidate-runner.js` for deterministic seed routing (`?seed=`), native-density DPR handling, a demo 16-band FFT bus (`fftBinsA` through `fftBinsD`), and benchmark telemetry (`?benchmark=1&frames=120`, exported as `window.__CANDIDATE_BENCHMARK__`).

## Prismatic Rupture Cathedral

- Route: `candidates/prismatic-rupture-cathedral.html?seed=491009`
- Reference: `doc_e54f7242eea9_20260718-2038-39.1716252.mp4`
- Topology hypothesis from contact sheets: volumetric fractured tunnel / camera-space shard cathedral with hard monochrome luminance, high-contrast aperture slabs, cracked polygon seams, and moving viewpoint/light rather than a flat lattice.
- Original transformation: no stock frames or exact shard layout; converted into layered seeded Voronoi fracture cells, mirrored aperture bars, nested tunnel ribs, and white line emitters with subtle cold glass tint.
- FFT-ready mapping: low bins widen central aperture flash and tunnel scale; mid bins open shard slabs and seam widths; high bins sharpen ribs and glints; each fracture owner samples one of 16 bands via `fftBand()`.

## Chromatic Iris Mycorrhiza

- Route: `candidates/chromatic-iris-mycorrhiza.html?seed=491009`
- Reference: `doc_f2e836acf4a0_20260718-2039-12.9391643.mp4`
- Topology hypothesis from contact sheets: oblique toroidal/iris ring with a central void, dense radial fibers, iridescent color sectors, drifting highlights, and particle/spore motion around the rim.
- Original transformation: no exact ring texture; converted into a biological mycorrhizal iris with spectral radial bundles, seeded spores, caustic corona, and breathing dark pupil.
- FFT-ready mapping: bass breathes the void and inner fire; mid bands thicken the iris/corona; high bands drive spore brightness and outer electric-blue fibers; angular/radial primitives use all 16 bins.

## Benchmark contract

Open either route with `?benchmark=1&seed=491009&frames=120`. The runner warms up 30 frames, samples at least 120 `requestAnimationFrame` deltas, preserves backing resolution at >= 1 device-independent pixel per CSS pixel, then logs and exports exact telemetry.
