# Visualizer v4 — Three-Phase Execution Plan

## North star

Build a browser-delivered, microphone-reactive visual system whose hero effects preserve the defining topology, camera grammar, material, and temporal character of their approved references while remaining original, deterministic, native-density, and operationally measurable.

The existing WebGL library remains available as a lightweight compatibility lane. New high-fidelity effects use scene-specific WebGPU pipelines rather than one monolithic fragment shader.

## Phase 1 — Visual R&D and prototype lab

**Purpose:** prove that the team can reproduce the visual grammar before committing to production architecture.

### Build

- Establish TouchDesigner or Notch as the rapid particle, feedback, and volumetric prototyping environment.
- Use Blender for meshes, camera blocking, UVs, and authored geometry.
- Use small WGSL/GLSL sketches for topology proofs that need direct browser feedback.
- Create paired spatial and chronological motion sheets for every reference and prototype.
- Produce three hero proofs:
  - Filament Vortex: persistent GPU-like strand advection and directional bundle continuity.
  - Prismatic Cathedral: real 3D shards, depth occlusion, emissive lighting, and camera travel.
  - Neon Voxel Cloud: instanced 3D cells, volumetric depth, occlusion, and persistent scan topology.
- Export a scene recipe for each approved proof: geometry, simulation state, camera, material, lighting, post stack, and audio mapping.

### Gate 1

An effect cannot proceed because it is merely attractive. It must pass:

- recognizable dominant topology at thumbnail size;
- correct projection, camera direction, and object occupancy;
- temporally coherent motion over a chronological sheet;
- material and depth hierarchy that match the target grammar;
- explicit human visual approval.

## Phase 2 — WebGPU core and hero effects

**Purpose:** build the reusable browser renderer around proven visual requirements rather than hypothetical abstractions.

### Build

- Capability probe and renderer selection: WebGPU, reduced WebGPU mode, or WebGL2 legacy.
- Device/resource lifecycle with recoverable device-loss handling.
- Scene manifests for assets, pipelines, simulation buffers, controls, and transitions.
- Shared audio feature bus:
  - 16 logarithmic FFT bands;
  - positive spectral flux and onset impulses;
  - separate attack/release envelopes;
  - stable structural ownership.
- Scene-specific render graph supporting:
  - compute simulation and ping-pong state;
  - particle, strand, spline, and voxel storage buffers;
  - instanced geometry and true depth testing;
  - bounded SDF/volumetric passes;
  - feedback history;
  - bloom, trails, tone mapping, and chromatic optics;
  - final compositing and transitions.
- Port the three Phase 1 hero proofs without flattening their geometry into screen-space approximations.

### Gate 2

- Native CSS pixel density on the target Mac and TV route.
- Product target of 60 FPS; provisional release floor of stable 30 FPS for hero scenes on the target Mac, with p95 and GPU timing recorded.
- No black frames, resource leaks, shader errors, or device-loss dead ends.
- Audio visibly changes topology, spacing, motion, camera pressure, or simulation state—not only exposure.
- Side-by-side motion-sheet review confirms the WebGPU port did not regress the approved prototype.
- Safari/Chrome secure-context microphone and full-screen/TV workflows pass.

## Phase 3 — Production library and continuous evolution

**Purpose:** turn the renderer into a durable creative system without allowing automation to self-approve mediocre work.

### Build

- Curate migration of existing effects; upgrade only patterns that gain meaningful depth or fidelity.
- Preserve the current 19-effect WebGL library as a fast fallback.
- Version scene manifests and assets independently from the app shell.
- Add deterministic captures, downloadable benchmark reports, GPU memory telemetry, and a target-device matrix.
- Build an automated candidate factory:
  1. ingest approved reference media;
  2. create topology/camera/material brief;
  3. generate an isolated prototype;
  4. capture paired motion sheets;
  5. run structural, visual, and performance checks;
  6. present evidence for human approval.
- Add release channels, rollback, and clean HTTPS deployment verification.

### Gate 3

- No autonomous candidate may merge itself into the production cycle.
- Every release has provenance, deterministic evidence, performance evidence, visual comparison, and human sign-off.
- Failed candidates are branched for learning or discarded; they are not retained as accepted inventory.

## Acceptance process — every effect

1. **Provenance:** establish source rights, allowed transformations, and immutable source paths.
2. **Reference decomposition:** record topology, projection, silhouette, occupancy, camera, layer count, motion law, material, lighting, and temporal arc.
3. **Grayscale topology proof:** reject the effect before palette work if geometry or projection is wrong.
4. **Motion proof:** compare chronological sheets; distinguish moving geometry, moving illumination, and camera motion.
5. **Material pass:** add color, scattering, bloom, reflections, and depth only after topology passes.
6. **Audio pass:** assign bass, mids, treble, flux, and onset to separate structural behaviors.
7. **Evidence pack:** deterministic captures, paired motion sheet, telemetry, console/device logs, and target-device route.
8. **Human decision:** accept, revise from the failed stage, branch a promising alternative, or destroy it.

## Architecture decisions

- WebGPU is the production renderer; TouchDesigner/Notch and Blender are authoring/prototyping tools.
- The browser remains the delivery surface.
- The audio feature bus is renderer-agnostic.
- Effects own separate pipelines and simulation state; no new monolithic uber-shader.
- Reference fidelity and originality are orthogonal gates: preserve defining visual grammar while changing incidental details and never embedding source frames or watermarks.
- Human visual approval is a product control, not an optional QA step.

## Diagrams

- `visualizer-v4-roadmap.mmd` — three phases and non-bypassable acceptance loop.
- `visualizer-v4-engine.mmd` — prototype-to-WebGPU runtime architecture.
