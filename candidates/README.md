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

## Cosmic, geometric, and velocity candidates

These routes use `cosmic-candidate-runner.js`, which provides explicit demo/microphone startup, a 4096-point analyzer, the shared 16-band/four-`vec4` FFT contract, native-density rendering, and benchmark telemetry.

- `recursive-diamond-lattice.html` → `doc_79df0f13ed04_20260718-2040-08.4133386.mp4`: folded diamond rails, FFT packet gates, procedural circuit nodes, and controlled recursive hierarchy.
- `neon-voxel-scan-cloud.html` → `doc_f2b4cd0d597b_20260718-2040-38.8387510.mp4`: three parallax voxel slices with occlusion accumulation, cube-face cues, scan trails, and FFT-owned blocks.
- `scarlet-velocity-ribbons.html` → `doc_57b3a762ea59_20260718-2041-11.2466374.mp4`: dark aerodynamic ribbons around a nonliteral low-slung singularity; no branded or literal car geometry.

Benchmark each with `?benchmark=1&seed=491009&frames=120`.
