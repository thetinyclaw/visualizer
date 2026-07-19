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
live_audio = read("live-audio-engine.js")
worklet = read("audio-feature-worklet.js")
live_smoke = read("live-audio.html")
manifest = read("scene-manifest.js")
graph = read("render-graph.js")
executor = read("render-graph-executor.js")
resources = read("resource-manager.js")
runtime = read("runtime.js")
resources = read("resource-manager.js")
assets = read("asset-loader.js")
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
require("createBuffer(id, descriptor)" in resources and "createTexture(id, descriptor)" in resources and "device[deviceMethod]" in resources, "real GPU resource creation missing")
require("device.queue.writeBuffer" in resources and "device.queue.writeTexture" in resources, "GPU queue uploads missing")
require("class AssetCache" in assets and "this.inflight" in assets and "loadManifest" in assets, "deduplicated asset cache missing")
require("bytesPerRow" in resources and "256" in resources, "texture upload row alignment missing")
require("hydrateRuntimeResources" in runtime and "new DeviceResourceManager" in runtime and "persistent: true" in resources, "runtime resource lifecycle integration missing")

# Audio feature bus contract.
require("export const AUDIO_BAND_COUNT = 16" in audio, "16-band audio bus missing")
require("FFT_MIN_HZ = 20" in audio and "FFT_MAX_HZ = 20000" in audio, "20Hz-20kHz logarithmic band range missing")
require("Math.pow(maxHz / minHz, 1 / count)" in audio, "logarithmic band spacing missing")
require("positiveFlux += Math.max(0" in audio, "positive spectral flux clamp missing")
require("FFT_ATTACK_MS" in audio and "FFT_RELEASE_MS" in audio, "separate attack/release envelope constants missing")
require("rms > this.envelopedBands[band] ? FFT_ATTACK_MS : FFT_RELEASE_MS" in audio, "attack/release branch missing")
require("stableOwnerId" in audio and "this.bandOwners = new Map()" in audio, "stable structural ownership missing")
require("onsetImpulse" in audio and "ONSET_FLUX_THRESHOLD" in audio, "onset impulse missing")
require("vec4Views" in audio and ".subarray(0, 4)" in audio, "allocation-safe four-vec4 payload views missing")
require("processDecibelSpectrum" in audio and "Math.pow(10" in audio, "AnalyserNode dB-to-power log-band path missing")
require("processBandFrame" in audio and "snapshotObject" in audio, "stable structural feature snapshot missing")

# Live microphone bridge and smoke route.
for token in ["LIVE_WORKLET", "LIVE_FALLBACK", "DEMO", "FLAT", "DENIED", "INSECURE", "DEVICE_LOST", "STOPPED"]:
    require(token in live_audio, f"live audio state {token} missing")
require("createActivationToken(event)" in live_audio and "ACTIVATION_TOKEN_BRAND" in live_audio and "gesture-required" in live_audio, "microphone start is not explicitly user-activation-token gated")
require("userActivation" in live_audio and "isActive === true" in live_audio, "microphone request must honor navigator.userActivation.isActive")
require("event instanceof EventCtor" in live_audio and "trustedActivationValidator" in live_audio, "older-browser activation fallback must require trusted Event or test-only validator")
require("async startMicrophone({ activationToken = null } = {})" in live_audio and "async startMicrophone({ gesture" not in live_audio, "caller-supplied gesture flag must not gate microphone requests")
require("createActivationToken(event)" in live_smoke and "startMicrophone({ activationToken })" in live_smoke, "live smoke UI must pass a bound one-shot activation token")
require("activeSessionGeneration" in live_audio and "handleWorkletMessage(event, sessionGeneration" in live_audio, "worklet messages must be session/generation guarded")
require("isSecureContext" in live_audio and "insecure-context" in live_audio, "secure-context rejection missing")
require("getUserMedia" in live_audio and "echoCancellation: false" in live_audio, "raw-ish microphone request missing")
require("audioWorklet.addModule" in live_audio and "AudioWorkletNode" in live_audio, "AudioWorklet live analysis path missing")
require("createAnalyser" in live_audio and "getFloatFrequencyData" in live_audio, "main-thread AnalyserNode fallback missing")
require("track.stop()" in live_audio and "audioContext.close" in live_audio, "stop cleanup does not release tracks/context")
require("permission-denied" in live_audio and "Use Start Mic to retry" in live_audio, "permission denial recovery copy missing")
require("processBandFrame(this.compactInput" in live_audio, "worklet compact feature transfer bridge missing")
require("processDecibelSpectrum(this.frequencyData" in live_audio, "fallback feature bridge missing")
require("DEMO SYNTHETIC" in live_audio and "FLAT TEST SIGNAL" in live_audio, "demo/flat labels can be confused")
require("registerProcessor('visualizer-v4-feature-processor'" in worklet, "AudioWorklet processor registration missing")
require("new Float32Array(AUDIO_BAND_COUNT + 3)" in worklet and "postMessage" in worklet, "worklet does not transfer compact band/flux/onset packet")
require("Start Mic" in live_smoke and "Demo" in live_smoke and "Stop" in live_smoke, "live audio smoke controls missing")
require("window.__V4_LIVE_AUDIO__" in live_smoke and "data-audio-state" in live_smoke, "live audio browser-smoke diagnostic export missing")
require("never auto-requests" in live_smoke and "demo synthetic - no microphone" in live_smoke, "live smoke route lacks honest source labeling")

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
require("getContext('webgpu')" in executor and "context.configure" in executor, "GPUCanvasContext execution missing")
require("createCommandEncoder" in executor and "beginRenderPass" in executor, "render-pass command encoding missing")
require("depth24plus" in executor and "queue.submit" in executor, "depth target or GPU queue submission missing")
require("new WebGpuGraphExecutor" in runtime and "graphExecutor.render(" in runtime, "runtime does not execute the render graph")

# Runtime/demo route.
require("startV4Runtime" in runtime and "probeRenderer" in runtime, "runtime orchestration missing")
require("DeviceResourceManager" in runtime and "resourceManager" in runtime, "runtime resource manager integration missing")
for token in ["createBuffer", "createTexture", "createSampler", "createBindGroupLayout", "createBindGroup", "knownAllocatedBytes", "externalUsageKnown", "stale", "generation"]:
    require(token in resources, f"resource manager contract {token} missing")
require("resource-memory-budget-exceeded" in resources, "resource manager budget guard missing")
require("Only resources created through DeviceResourceManager" in resources, "honest resource telemetry note missing")
for token in ["AssetLoader", "AssetCache", "asset-cross-origin-rejected", "asset-too-large", "asset-content-type-rejected", "inflight", "same-origin", "credentials: 'same-origin'"]:
    require(token in assets, f"asset loader/cache contract {token} missing")
require("No live GPU telemetry" in demo, "demo must not fake live GPU telemetry")
require("createBuffer('smoke-telemetry-particles'" in demo and "createTexture('smoke-telemetry-lut'" in demo, "demo does not allocate real WebGPU smoke resources")
require("external browser/driver GPU usage: unknown" in demo, "demo telemetry must report external usage as unknown")
require("Runtime initialization failed safely" in demo, "demo safe failure path missing")
require("data-renderer-mode" in demo or "rendererMode" in runtime, "demo mode reporting hook missing")
require("import { startV4Runtime } from './runtime.js';" in demo, "demo does not load v4 runtime module")

# DPR resize sync: v4 executor must use CSS size, min DPR 1, cap high DPR, and skip zero-sized canvases.
require("devicePixelRatio" in executor and "Math.max(1" in executor and "dprCap" in executor, "executor DPR cap/min sync missing")
require("getBoundingClientRect" in executor and "zero-size" in executor, "executor CSS-size or zero-size safety missing")
require("canvas.width" in executor and "canvas.height" in executor, "executor backing-store resize missing")

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
