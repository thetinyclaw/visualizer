# Visualizer v4 Hero Prototype Lab Recipes

All lab routes are isolated under `v4/lab/` and are demo-input browser artifacts, not production v4 integration. Deterministic capture controls: `?seed=<int>`, `?time=<seconds>`, `?mode=demo|flat`. Demo input is generated and labeled honestly; microphone input is intentionally out of scope for this static proof surface.

## Filament Vortex

- **Route:** `v4/lab/filament-vortex.html?seed=491009&mode=demo&time=18`
- **Geometry:** 72 persistent 3D strand bundles, each a 36-point polyline emitted as depth-tested WebGL line segments. The topology is log-polar bundle continuity around a vortex throat, not transient noise strokes.
- **Simulation state:** CPU state persists per strand (`phase`, `radius`, `z`, FFT owner bin, point history). Every frame advects phase/radius and rewrites the same strand identities.
- **Camera:** perspective camera with slow lateral drift and bass-linked height; locked `time=` freezes a reproducible view.
- **Material:** cold pearlescent/cyan line emission with alpha tied to band-owned energy; dark aperture preserved by shrinking radii toward the throat.
- **Lighting:** emissive line color plus depth test; no fake exposure-only audio response.
- **Post stack:** no post process in the lab shell; native-density canvas and alpha blending only.
- **Audio mapping:** 16 generated demo bands. Stable strand bin ownership controls local advection speed, alpha, and bundle separation; bass affects camera elevation.
- **Topology / silhouette / occupancy / motion law:** continuous inward spiral bundle field; strand IDs survive over time, so motion is directional advection rather than random redraw.
- **Fallback / unsupported state:** WebGPU/WGSL is not shipped in this no-build lab. The route uses an honest WebGL line-bundle fallback preserving persistent topology; if WebGL is unavailable it falls back to Canvas2D strand advection and labels that state in the HUD/export.
- **Originality notes:** transforms the high-level idea of luminous hairlike vortex strands into seeded procedural strand dynamics; no external/private media is sampled, embedded, traced, or reproduced.

## Prismatic Cathedral

- **Route:** `v4/lab/prismatic-cathedral.html?seed=491009&mode=demo&time=18`
- **Geometry:** 46 actual triangular prism/shard meshes, each with six triangle faces, generated in 3D and streamed to WebGL.
- **Simulation state:** seeded shard transforms persist; z travel wraps through a tunnel while per-shard FFT ownership changes scale/emissive alpha.
- **Camera:** perspective travel down the cathedral volume with lateral orbit and vertical audio lift.
- **Material:** white/cold-blue emissive shard faces with translucent alpha and seeded rotations.
- **Lighting:** material brightness follows per-shard structural bands, giving glints and aperture flashes through mesh density rather than exposure-only gain.
- **Post stack:** none beyond WebGL blending and depth testing.
- **Audio mapping:** bass changes travel/camera pressure; mid/high bands scale shard dimensions and emissive opacity by stable shard owner bins.
- **Topology / silhouette / occupancy / motion law:** volumetric fractured tunnel: shards occupy real z-depth and occlude one another through `DEPTH_TEST`; camera motion changes perspective parallax.
- **Originality notes:** procedural prism cathedral grammar only; not a flattened screen-space rupture approximation and no reference media assets are used.

## Neon Voxel Cloud

- **Route:** `v4/lab/neon-voxel-cloud.html?seed=491009&mode=demo&time=18`
- **Geometry:** 110 instanced-style cube cells emitted as repeated cube triangle faces in 3D; each voxel has real front/back/side depth.
- **Simulation state:** each cell persists with x/y/z, scale, owner bin, phase, and an exponentially smoothed scan occupancy value.
- **Camera:** perspective cloud fly-through with audio-linked height and slow orbit.
- **Material:** green/cyan/magenta/amber neon cube faces; alpha derives from persistent scan occupancy and band energy.
- **Lighting:** emissive face colors plus depth sorting via WebGL depth buffer; no exposure-only audio behavior.
- **Post stack:** none in this prototype; density is preserved by CSS-size canvas and backing DPR >= 1.
- **Audio mapping:** band owners alter cube size, scan activation, z travel speed, and camera lift; generated demo bands are labeled as demo input.
- **Topology / silhouette / occupancy / motion law:** persistent scan field sweeps through stable voxel identities; occupancy decays/smooths so the cloud has memory and structural motion.
- **Originality notes:** an original procedural voxel cloud; no external/private reference media accessed or embedded.

## Paired motion-sheet scaffolding

Capture a spatial sheet by opening each route at fixed seed and the same sequence of locked times, for example:

```text
v4/lab/filament-vortex.html?seed=491009&mode=demo&time=0
v4/lab/filament-vortex.html?seed=491009&mode=demo&time=6
v4/lab/filament-vortex.html?seed=491009&mode=demo&time=12
v4/lab/filament-vortex.html?seed=491009&mode=demo&time=18
```

Capture a chronological sheet with the same route/seed and increasing `time=` values. Keep `mode=demo` in filenames or captions because the audio input is generated. Use `mode=flat` for topology-only comparisons without demo band excitation.
