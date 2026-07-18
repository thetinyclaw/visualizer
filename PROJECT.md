# Project: Music Visualizer

## Brief
Procedurally generated geometric/organic ambient visualizer.
Reactive to microphone input when available, with a synthetic demo pulse fallback when mic access is unavailable.
Web-based raw WebGL/GLSL for a Milkdrop/trippy/fractal-style aesthetic.

## Tech Stack
- **Core:** HTML5, JavaScript
- **Graphics:** Raw WebGL + GLSL shaders
- **Audio:** Web Audio API (`navigator.mediaDevices.getUserMedia`) with demo fallback
- **Deployment:** Static HTML file (hosted on OpenClaw, GitHub Pages, or local HTTP)

## Status
- [x] Define platform: Web (cast/browser/TV)
- [x] Define audio source: microphone + demo fallback
- [x] Define vibe: Milkdrop/fractal/generative ambient
- [x] Implement raw WebGL shader pipeline
- [x] Implement audio analysis (FFT)
- [x] Fix WebGL/shader error handling
- [x] Fix GLSL Intel/Windows loop compatibility
- [x] Add thirteen generated shader patterns, including Cosmic Mycelium, scattered RGB Subpixels, and three Spectral Hive variants
- [x] Refresh render-loop performance and layout (Ponytail pass, 2026-07-05)
- [x] Establish recurring creative evolution contract, novelty gate, effect ledger, and structural verifier (2026-07-17)
- [x] Add standalone FFT Observatory with honest microphone/demo states and logarithmic spectral analysis (2026-07-18)

## Recent Refresh (2026-07-05)
- Capped high-DPI render buffer to reduce fill-rate cost on Retina/TV displays.
- Switched animation timing to `performance.now()`.
- Throttled HUD DOM updates.
- Guarded audio startup against duplicate pointer/touch events.
- Moved static WebGL uniform updates out of the hot render loop.
- Skips next-pattern shader work until transitions actually need it.
- Removed dead generated params and unused GLSL helpers.

## Flow Field rewrite (2026-07-17)
- Replaced the old `50 × 30` per-fragment curl integration (~1,500 path steps per pixel) with analytic domain-warped stream contours.
- Produces continuous crossing rivers and treble capillaries instead of sparse disconnected dashes.
- Same-browser benchmark at `1280×633`, seed `491009`: `4.94 FPS → 14.38 FPS`.
- Audio now changes geometry: bass controls filament width, mids bend topology, and treble exposes microstructure.

## Branches rewrite (2026-07-17)
- Replaced 256 explicit branch-segment tests plus 30 leaf tests per fragment with five inverse-fold iterations and a cell-hashed seed layer.
- The grove now has coherent binary silhouettes, a luminous twig canopy, and structural bass/mid/treble response.
- Same-browser `1280×633`, seed `491009`, 120-frame sample: `15.91 → 16.51 FPS`; p95 frame time improved from `135.3 → 125.5 ms` at effective DPR `1.0`.

## Galaxy rewrite (2026-07-17)
- Replaced 100 per-fragment orbiting-star distance tests with one cell-local hashed star field and analytic polar dust lanes.
- Bass now opens the nucleus, mids alter arm topology, and treble exposes stellar microstructure.
- Same-browser `1280×633`, seed `491009`, 120-frame sample: `16.29 → 19.78 FPS`; p95 improved from `146.2 → 142.3 ms` at effective DPR `1.0`.

## Neurons rewrite (2026-07-17)
- Replaced 12 full-screen neuron tests plus 20 animated spark tests per fragment with one cell-local soma and analytic warped axon fields.
- Bass now joins neural bodies, mids alter dendrite topology and axon paths, and treble reveals local synaptic flashes.
- Mirrored same-browser `1280×633`, seed `491009`, 120-frame median: `14.47 → 17.83 FPS` at effective DPR `1.0`; post-benchmark image analysis found roughly twice the bright-pixel coverage and stronger edge density.

## Stipple Waves optimization (2026-07-18)
- Merged duplicate five-harmonic surface/normal loops and reused each harmonic phase without changing the established geometry or audio mapping.
- Same-browser SwiftShader `756×469`, seed `491009`, 120-frame sample: `14.75 → 16.44 FPS`; p95 improved from `119.7 → 84.2 ms` at effective DPR `1.0`.

## Ribbons optimization (2026-07-18)
- Hoisted layer-invariant phase, gradient, and division work out of the ribbon loop and replaced each layer's exponential halo with a compact cubic falloff.
- Same-browser SwiftShader `756×469`, seed `491009`, 120-frame sample: `15.83 → 16.26 FPS`; p95 improved from `100.6 → 91.1 ms` at effective DPR `1.0`.
- Deterministic screenshot metrics retained mean color and bright coverage while the finite halo made the negative space slightly crisper.

## Cosmic Mycelium optimization (2026-07-18)
- Reused its two existing living domain-warp fields for diffuse nebula shading, removing three redundant noise octaves without changing the aperture, filament, ring, or spore geometry.
- Same-browser SwiftShader `756×326`, seed `491009`, 120-frame sample: `12.37 → 12.75 FPS`; p95 improved from `136.4 → 132.5 ms` at effective DPR `1.0`.
- A deterministic full-viewport screenshot retained dense bright coverage and edge definition.

## Post-process grain optimization (2026-07-18)
- Replaced the final full-screen grain's structural vec3 hash with a compact interleaved-gradient hash; effect geometry, palette, and native backing density are unchanged.
- Mirrored 120-frame RGB Subpixels checks at `800×600`, seed `491009`, moved median `11.97 → 12.31 FPS` at effective DPR `1.0`; p95 remained effectively flat (`126.8 → 127.7 ms`).
- Deterministic screenshots retained full-frame texture and increased measured edge variation slightly rather than blurring the image.

## Frequency-owned Voronoi cells (2026-07-18)
- Replaced uniform bass-driven grid scaling with stable per-generator 16-bin logarithmic FFT affinity and weighted distance, so loud-bin cells consume area while quiet neighbors compress.
- Audio also changes each owner’s motion rate, boundary width, and nucleus size without lowering global tessellation density.
- Deterministic 120-frame browser evidence at `756×469`, seed `491009`, measured `15.48 FPS` at effective DPR `1.0`; the full-frame screenshot retained dense, crisp stained-glass coverage.

## FFT Observatory (2026-07-18)
- Added `fft.html`, a standalone no-build Canvas/Web Audio instrument with waveform, logarithmic spectrum, radial field, decaying peaks, restrained spectrogram history, and peak/centroid/RMS telemetry.
- Microphone startup is user-gesture and secure-context gated; idle, demo, live microphone, and permission-error states remain explicit.
- Browser QA activated demo mode and reported `94 Hz` peak, `8.19 kHz` centroid, `28%` energy, and no horizontal overflow at `756px` viewport width.

## Spectral Hive (2026-07-18)
- Translated the supplied reference into an original spherical shell rather than copying its monochrome stock frames: a center-facing hex and roughly three foreshortened surrounding layers rotate over a front-hemisphere projection.
- A central source leaks through loose shell seams and continues outward as angular shafts; rotating chambers and ray sectors consume the shared 16-bin FFT bus.
- Fixed multiplication ray chains and squared shell gates preserve native density; the corrected spherical version measured `13.30 FPS` at `1280×633`, effective DPR `1.0`.
- Preserved the earlier flat aperture and loose shell as separate patterns/pages rather than overwriting them.
- Added Infinite Hexsphere: a perfectly repeating lattice-matched tessellation on an 80%-height ball, with FFT-driven cell scale, smoothly integrated FFT rotation velocity, and seam-origin external beams.
- Anchored its longitude discontinuity behind the visible hemisphere, made panel gaps dynamically FFT-driven, and replaced the independent background ray lattice with rays gated by actual circumference-gap samples.
- Spatially partitioned shell and edge-emitter evaluation, raising the corrected native-density benchmark from `14.54` to `19.05 FPS` at `1280×633`, DPR `1.0`.
- Replaced circumference-only emitters with a 256-angle front-gap source map shared by visible shell flares and outgoing rays; increased gap displacement to 400%, made rotation constant, and assigned whole-ball radius to positive spectral flux/onsets.
- Replaced discrete source flares with allocation-free ten-depth seam integration so the complete gap network behaves as line emitters; measured `18.68 FPS` at native `1280×633`, DPR `1.0`.

## Design Concepts
- **RGB Subpixels:** scattered multi-scale RGB clusters with tightly overlapping channels, randomized placement, FFT-owned motion/scale, chromatic spill, and luminous edge contours.
- **Stipple Family Pages:** standalone raw-WebGL pages exploring the original stipple-wave language as topographic contour dots, glass/reef caustics, and ink-dune paper grain.
- **Cosmic Mycelium:** a living radial aperture with domain-warped fungal filaments, phase-slipping revelation rings, gravitational lensing, and audio-structured stellar spores.
- **Spectral Hive:** a rotating three-layer spherical hex shell containing a central light source that escapes through FFT-owned seams and volumetric shafts.

## Continuous evolution
- `CREATIVE_ENGINE.md` defines the concept grammar, three-candidate tournament, novelty gate, performance doctrine, and acceptance loop.
- `EFFECTS.md` fingerprints accepted visual families so recurring runs can reject superficial duplicates.
- `EFFECT_PIPELINE.md` defines the open-ended generation state machine and hard native-density/FPS gates.
- `benchmark.html` runs every registered pattern sequentially at full viewport and exports auditable JSON telemetry.
- `scripts/verify_visualizer.py` checks registration, transition, documentation, and performance invariants before browser QA.

## Usage
User visits URL -> starts visualizer -> allows mic if desired. If mic is missing or denied, visuals still animate in demo mode. Use arrow keys or horizontal swipes to move between patterns.
