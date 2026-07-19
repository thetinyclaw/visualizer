# Visualizer v4 Evidence Tooling

This directory contains Phase 1/2/3 acceptance scaffolding for the Visualizer v4 plan. It is deliberately separate from the current no-build static visualizer runtime.

## What is enforced

- Provenance manifests preserve immutable raw source paths and SHA-256 hashes, rights, allowed transformations, derived-output separation, and human decision fields.
- Scene recipes decompose references into topology, projection, silhouette, occupancy, camera, layers, motion law, material, lighting, temporal arc, and originality.
- Capture specs are deterministic and local-route only. `capture-plan` prints an immutable real-browser run plan with seed/time/mode URL locks, >=120 RAF frame telemetry, raw/derived separation, overwrite refusal, and no upload/deploy behavior. `capture-local` only writes PNG/telemetry artifacts when Python Playwright is actually available; otherwise it returns an explicit unsupported status without claiming capture.
- `v4/evidence/capture-harness.js` is the browser-side protocol/export harness: deterministic config export, requestAnimationFrame warmup, >=120 real frame samples, viewport/backing-store/native DPR metadata, console/shader-error observation, and honest `null` GPU timestamp/memory fields when unavailable.
- Benchmark reports require seed, viewport, DPR/effective density, at least 120 frame samples, computed p50/p95, GPU timing and memory telemetry as real numeric values or null with an unknown reason, plus browser/device and console/device logs.
- Gate 1/2/3 validation fails closed without explicit non-autonomous human approval and forbids autonomous self-merge.
- Gate evidence is classified by one unique schema discriminator in its JSON payload, never by filename substrings, so renamed or multi-label artifacts cannot impersonate required evidence classes.
- Candidate-factory state advances through evidence-building states only; it has terminal states and no production merge action.
- Release manifests describe channels, rollback metadata, and read-only HTTPS verification commands. The script prints commands; it does not deploy.

## Commands

```bash
python3 v4/tools/visualizer_v4_evidence.py verify-all
python3 v4/tools/visualizer_v4_evidence.py generate-capture-commands --capture-spec v4/evidence/fixtures/capture_spec.local.json
python3 v4/tools/visualizer_v4_evidence.py generate-motion-sheet --capture-spec v4/evidence/fixtures/capture_spec.local.json --out v4/evidence/derived/motion_sheet.generated.json
python3 v4/tools/visualizer_v4_evidence.py capture-plan --route v4/demo.html --effect-id runtime-clear-draw-smoke --seed 7 --time-ms 1000 --mode demo --run-id dry-run-demo
python3 v4/tools/visualizer_v4_evidence.py capture-local --route v4/demo.html --effect-id runtime-clear-draw-smoke --seed 7 --time-ms 1000 --mode demo --run-id local-demo
python3 v4/tools/visualizer_v4_evidence.py release-check-commands v4/evidence/fixtures/release_manifest.json
python3 -m unittest tests/test_v4_evidence.py
```

`v4/evidence/fixtures/raw/` is the immutable evidence area for fixture inputs. Generated reports belong under `v4/evidence/derived/` or another explicitly derived directory.
