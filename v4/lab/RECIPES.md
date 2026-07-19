# Visualizer v4 Hero Prototype Lab Recipes

All lab routes are isolated under `v4/lab/` and are demo-input browser artifacts, not production v4 integration. Deterministic capture controls: `?seed=<int>`, `?time=<seconds>`, `?mode=demo|flat`. Demo input is generated and labeled honestly; microphone input is intentionally out of scope for this static proof surface. Each route exports `window.__V4_HERO_LAB__` with scene key, seed/time/input mode, renderer/fallback state, DPR, topology, geometry, vertex counts, and runtime bounds.

## Filament Vortex

- **Route:** `v4/lab/filament-vortex.html?seed=491009&mode=demo&time=18`
- **Geometry:** exactly **118x52 ribbon strands**. Each persistent strand has 52 advected samples and is emitted as layered triangle ribbons: soft halo, narrow luminous core, and fine secondary filaments.
- **Simulation state:** CPU state persists per strand (`phase`, `radius`, `z`, FFT owner bin, tier, handedness). Every frame mutates phase/radius in place and rewrites stable typed-array buffers; strand identity does not redraw randomly.
- **Camera:** perspective camera at bounded z with slow lateral travel and bass-linked height; locked `time=` freezes a reproducible view.
- **Material:** luminous filament material, not broad flat bands: low-alpha cyan halo, narrower pearlescent core, and intermittent fine white-blue secondary lines.
- **Lighting:** emissive line hierarchy plus depth test and alpha blending; no fake exposure-only audio response.
- **Post stack:** no post process in the lab shell; native-density canvas, depth test, and alpha blending only.
- **Audio mapping:** 16 generated demo bands. Stable strand bin ownership controls local advection speed, ribbon width/alpha, secondary line brightness, and camera elevation.
- **Topology / silhouette / occupancy / motion law:** continuous inward spiral bundle field with strong frame occupancy and a dark central throat. Strand IDs survive over time, so motion is directional advection rather than random redraw.
- **Fallback / unsupported state:** WebGPU/WGSL is not shipped in this no-build lab. The route uses an honest WebGL2 ribbon fallback preserving persistent topology; if WebGL is unavailable it falls back to Canvas2D strand advection and labels that state in the HUD/export.
- **Originality notes:** transforms the high-level idea of luminous hairlike vortex strands into seeded procedural strand dynamics; no external/private media is sampled, embedded, traced, or reproduced.

## Prismatic Cathedral

- **Route:** `v4/lab/prismatic-cathedral.html?seed=491009&mode=demo&time=18`
- **Geometry:** exactly **13 arches + 72 shards**. Thirteen arched corridor ribs layer down the travel axis; seventy-two bounded prismatic shard meshes use real triangle faces plus smaller reflected floor shards/runes.
- **Simulation state:** seeded arch and shard transforms persist; z travel wraps through a tunnel while stable FFT owner bins modulate scale, rotation speed, emissive alpha, and camera lift.
- **Camera:** perspective travel down the cathedral volume with lateral orbit, vertical audio lift, near-plane clearance, and a central traversable void.
- **Material:** prismatic cold-blue/white emissive shard faces with translucent alpha, depth-faded glints, magenta/cyan edge/core hierarchy, and floor reflection cues.
- **Lighting:** material brightness follows per-shard structural bands, giving glints and aperture flashes through mesh density rather than exposure-only gain.
- **Post stack:** none beyond WebGL blending and depth testing.
- **Audio mapping:** bass changes travel/camera pressure; mid/high bands scale shard dimensions, prism rotation, arch thickness, and emissive opacity by stable owner bins.
- **Topology / silhouette / occupancy / motion law:** volumetric fractured tunnel: arches define the corridor, shards occupy real z-depth and occlude one another through `DEPTH_TEST`, floor runes/reflections anchor scale, and camera motion changes perspective parallax.
- **Fallback / unsupported state:** WebGL is required for the primary cathedral; the shared Canvas2D fallback reports `canvas2d-fallback` and does not pretend to be native WebGPU/WGSL.
- **Originality notes:** procedural prism cathedral grammar only; not a flattened screen-space rupture approximation and no reference media assets are used.

## Neon Voxel Cloud

- **Route:** `v4/lab/neon-voxel-cloud.html?seed=491009&mode=demo&time=18`
- **Geometry:** exactly **260 voxels**. Each persistent cell emits bounded cube triangle faces in 3D, with additional small scan-front tracer cubes that are not counted as recipe voxels.
- **Simulation state:** each cell persists with x/y/z, scale, owner bin, phase, hierarchy flags, and an exponentially smoothed scan occupancy value.
- **Camera:** perspective cloud fly-through with audio-linked height and slow orbit; bounded camera/mass scale improves occupancy without clipping.
- **Material:** green/cyan/magenta neon cube faces with fog-scaled alpha, front/back/side depth, size hierarchy, and scan-front highlights.
- **Lighting:** emissive face colors plus depth sorting via WebGL depth buffer; no exposure-only audio behavior.
- **Post stack:** none in this prototype; density is preserved by CSS-size canvas and backing DPR >= 1.
- **Audio mapping:** band owners alter cube size, scan activation, z travel speed, fog/alpha, and camera lift; generated demo bands are labeled as demo input.
- **Topology / silhouette / occupancy / motion law:** persistent diagonal y/z scan field sweeps through stable voxel identities; occupancy decays/smooths so the cloud has memory, less-uniform distribution, and structural motion around a traversable tunnel.
- **Fallback / unsupported state:** WebGL primary with shared Canvas2D fallback reporting unsupported state honestly if needed.
- **Originality notes:** an original procedural voxel cloud; no external/private reference media accessed or embedded.

## Shared renderer / performance contract

- WebGL allocates position/color buffers once with `bufferData(byteLength, DYNAMIC_DRAW)` and updates live ranges with `bufferSubData`.
- Band, camera, projection/view/MVP, and geometry/color typed arrays are reused; topology arrays and persistent scene objects are not rebuilt per frame.
- Deterministic same seed/time/mode outputs match across helper runs; changing locked time changes geometry through stateful simulation/advection.
- Native density is capped to DPR 2 but never below DPR 1. Canvas fallback is explicit and labeled.

## Paired motion-sheet scaffolding

Capture a spatial sheet by opening each route at fixed seed and the same sequence of locked times, for example:

```text
v4/lab/filament-vortex.html?seed=491009&mode=demo&time=0
v4/lab/filament-vortex.html?seed=491009&mode=demo&time=6
v4/lab/filament-vortex.html?seed=491009&mode=demo&time=12
v4/lab/filament-vortex.html?seed=491009&mode=demo&time=18
```

Capture a chronological sheet with the same route/seed and increasing `time=` values. Keep `mode=demo` in filenames or captions because the audio input is generated. Use `mode=flat` for topology-only comparisons without demo band excitation.
