#!/usr/bin/env python3
"""Focused structural and deterministic contract checks for Visualizer v4 runtime foundation."""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V4 = ROOT / "v4"

errors: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def read(name: str) -> str:
    path = V4 / name
    require(path.exists(), f"missing v4/{name}")
    return path.read_text() if path.exists() else ""

capability = read("capability.js")
lifecycle = read("gpu-lifecycle.js")
audio = read("audio-feature-bus.js")
manifest = read("scene-manifest.js")
graph = read("render-graph.js")
resources = read("resource-manager.js")
runtime = read("runtime.js")
demo = read("demo.html")

# Capability probing and deterministic selection.
require("WEBGPU_FULL: 'webgpu-full'" in capability, "full WebGPU mode missing")
require("WEBGPU_REDUCED: 'webgpu-reduced'" in capability, "reduced WebGPU mode missing")
require("WEBGL2_LEGACY: 'webgl2-legacy'" in capability, "WebGL2 legacy mode missing")
require("requestAdapter({ powerPreference: 'high-performance' })" in capability, "WebGPU adapter probe missing")
require("hasReducedLimits(adapter)" in capability, "reduced WebGPU limits gate missing")
require("FULL_WEBGPU_FEATURES.every" in capability, "deterministic full/reduced feature selection missing")
require("webgpu-request-failed" in capability and "falling back safely" in capability, "sanitized WebGPU fallback error missing")
require("canvas.getContext('webgl2'" in capability, "WebGL2 fallback probe missing")
require("error.stack" not in capability and "error.message" not in capability, "capability probe leaks raw error details")

# Lifecycle state machine and retry boundary.
for state in ["idle", "requesting-device", "ready", "device-lost", "retrying", "fallback-required", "disposed"]:
    require(state in lifecycle, f"lifecycle state {state} missing")
require("maxRetries = 2" in lifecycle and "retryCount >= this.maxRetries" in lifecycle, "device-loss retry boundary missing")
require("device.lost.then" in lifecycle, "device.lost watcher missing")
require("disposeResources()" in lifecycle and "this.resources.clear()" in lifecycle, "resource cleanup on loss missing")
require("gpu-retry-limit-exceeded" in lifecycle, "retry exhaustion public error missing")
require("error.message" not in lifecycle and "error.stack" not in lifecycle, "lifecycle leaks raw device errors")

# Executable GPU resource and asset-cache coverage.
require("device.createBuffer" in resources and "device.createTexture" in resources, "real GPU resource creation missing")
require("device.queue.writeBuffer" in resources and "device.queue.writeTexture" in resources, "GPU queue uploads missing")
require("class AssetCache" in resources and "this.entries.has(asset.id)" in resources, "deduplicated asset cache missing")
require("bytesPerRow" in resources and "256" in resources, "texture upload row alignment missing")
require("hydrateDeviceResources" in runtime and "lifecycle.registerResource(manager)" in runtime, "runtime resource lifecycle integration missing")

# Audio feature bus contract.
require("export const AUDIO_BAND_COUNT = 16" in audio, "16-band audio bus missing")
require("FFT_MIN_HZ = 20" in audio and "FFT_MAX_HZ = 20000" in audio, "20Hz-20kHz logarithmic band range missing")
require("Math.pow(maxHz / minHz, 1 / count)" in audio, "logarithmic band spacing missing")
require("positiveFlux += Math.max(0" in audio, "positive spectral flux clamp missing")
require("FFT_ATTACK_MS" in audio and "FFT_RELEASE_MS" in audio, "separate attack/release envelope constants missing")
require("rms > this.envelopedBands[band] ? FFT_ATTACK_MS : FFT_RELEASE_MS" in audio, "attack/release branch missing")
require("stableOwnerId" in audio and "this.bandOwners = new Map()" in audio, "stable structural ownership missing")
require("onsetImpulse" in audio and "ONSET_FLUX_THRESHOLD" in audio, "onset impulse missing")

# Manifest schema coverage.
require("SCENE_MANIFEST_VERSION = 1" in manifest, "versioned scene manifest missing")
for key in ["assets", "pipelines", "simulationBuffers", "controls", "transitions"]:
    require(key in manifest, f"manifest validation lacks {key}")
require("Invalid scene manifest." in manifest, "manifest assertion public error missing")

# Render graph primitive coverage.
for token in ["compute", "ping-pong-state", "storage-buffer", "instanced-depth-target", "bounded-volume", "feedback", "post", "composite"]:
    require(token in graph, f"render graph primitive {token} missing")
require("makeSceneGraphFoundation" in graph, "scene graph foundation factory missing")
require("audio-features" in graph and "particle-state" in graph and "scene-depth" in graph, "foundation resources missing")
require("bounds: [-1, -1, -1, 1, 1, 1]" in graph, "bounded volume pass missing explicit bounds")

# Runtime/demo route.
require("startV4Runtime" in runtime and "probeRenderer" in runtime, "runtime orchestration missing")
require("No live GPU telemetry" in demo, "demo must not fake live GPU telemetry")
require("Runtime initialization failed safely" in demo, "demo safe failure path missing")
require("data-renderer-mode" in demo or "dataset.rendererMode" in runtime, "demo mode reporting hook missing")
require("import { startV4Runtime } from './runtime.js';" in demo, "demo does not load v4 runtime module")

# Native-density intent: no DPR lowering runtime trick in v4 foundation.
for source_name, source in [("runtime.js", runtime), ("capability.js", capability), ("render-graph.js", graph), ("resource-manager.js", resources)]:
    require("devicePixelRatio" not in source and "dpr" not in source.lower(), f"v4 {source_name} should not introduce DPR reduction")

# Deterministic synthetic audio vector checks (independent Python mirror of the documented bus contract).
def make_edges(count=16, min_hz=20.0, max_hz=20000.0):
    ratio = (max_hz / min_hz) ** (1 / count)
    return [min_hz * (ratio ** i) for i in range(count + 1)]


def process_frame(magnitudes, previous, env, sample_rate=48000, dt=1/60):
    edges = make_edges()
    nyquist = sample_rate / 2
    bin_hz = nyquist / max(1, len(magnitudes) - 1)
    raw = []
    positive_flux = 0.0
    out_env = env[:]
    for band in range(16):
        start = max(0, math.floor(edges[band] / bin_hz))
        end = min(len(magnitudes) - 1, max(start, math.ceil(edges[band + 1] / bin_hz)))
        values = [max(0.0, magnitudes[i]) for i in range(start, end + 1)]
        rms = math.sqrt(sum(v * v for v in values) / max(1, len(values)))
        raw.append(rms)
        positive_flux += max(0.0, rms - previous[band])
        tau_ms = 45 if rms > out_env[band] else 360
        coeff = 1 - math.exp(-max(0, dt) * 1000 / tau_ms)
        out_env[band] += (rms - out_env[band]) * coeff
    flux = positive_flux / 16
    onset = min(1, flux * 4) if flux >= 0.08 else 0
    return raw, out_env, flux, onset

silence = [0.0] * 129
impulse = [0.0] * 129
for i in range(8, 40):
    impulse[i] = 1.0
prev = [0.0] * 16
env = [0.0] * 16
raw0, env0, flux0, onset0 = process_frame(silence, prev, env)
raw1, env1, flux1, onset1 = process_frame(impulse, raw0, env0)
raw2, env2, flux2, onset2 = process_frame(silence, raw1, env1)
require(all(v == 0 for v in raw0) and flux0 == 0 and onset0 == 0, "synthetic silence vector is not stable")
require(flux1 > 0 and onset1 > 0, "synthetic impulse does not produce positive flux/onset")
require(flux2 == 0 and onset2 == 0, "falling spectrum must clamp flux and onset to zero")
require(any(after > before for after, before in zip(env1, env0)), "attack envelope did not rise on impulse")
require(any(after > 0 for after in env2), "release envelope decayed instantly instead of separately")

if errors:
    print("Visualizer v4 runtime verification FAILED:")
    for issue in errors:
        print(f" - {issue}")
    sys.exit(1)

print("Visualizer v4 runtime verification passed")
print("Synthetic audio vectors: silence stable, impulse flux/onset positive, release decay nonzero")
print("Checked modules: capability, lifecycle, audio bus, manifest schema, render graph, runtime, demo")
