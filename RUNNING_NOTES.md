# RUNNING_NOTES

## Current state
- Canonical branch: `integration/visualizer-v4-foundation`.
- Recurring Visualizer v4 writer is intentionally paused while this verified checkpoint is reviewed.
- The unified launcher is `v4/index.html`; it performs no hidden rendering, GPU probe, or microphone request.
- The original 19-effect WebGL visualizer remains the compatibility lane.

## Executable v4 surface
- Prismatic Cathedral: native WebGPU geometry → post → composite.
- Filament Vortex: compute ping-pong → ribbon render → post → composite.
- Neon Voxel Cloud: compute-updated 260-cell instanced render → post → composite.
- Shared runtime: resource lifecycle, render graph, bounded volume, transactional history/trails, bloom, chromatic optics, ACES output, and two-layer crossfade.
- Live audio: trusted-click microphone access with honestly labeled Demo/Flat modes.
- Evidence: immutable automation-browser capture packs for all three heroes; external GPU memory remains unknown and timestamp timing remains nullable when quantized/unavailable.

## Verification contract
```bash
npm run test:v4-runtime
npm run test:v4-launcher
python3 scripts/verify_v4_runtime.py
python3 scripts/verify_v4_hero_lab.py
python3 scripts/verify_visualizer.py
python3 scripts/verify_candidates.py
python3 -m unittest tests/test_v4_evidence.py
python3 v4/tools/visualizer_v4_evidence.py verify-all
```

## Remaining acceptance gates
- Human visual approval for Cathedral, Filament, and Voxel.
- Final HUD-safe production scene orchestration/material polish.
- HTTPS target-device verification in Safari/Chrome and the intended TV route.
- Genuine live-microphone acceptance on a secure target device.
- Gate 2, Gate 3, and release manifests must remain fail-closed until those artifacts and approvals exist.

## Engineering notes
- WebGPU `GPUQueue.writeBuffer()` size is measured in typed-array elements when the data argument is a typed array, not bytes.
- Capture acceptance requires an explicit submitted frame and rejects any reported uncaptured WebGPU validation error.
- Known GPU frame timing must be strictly positive; use `null` plus an explicit reason when unavailable or privacy-quantized.
- Compute dispatches and render passes are distinct WebGPU usage scopes; ordered compute-write → render-read across passes in one command buffer is valid.
