import { startV4Runtime } from './runtime.js';
import { createFilamentVortexScene, demoBands, FILAMENT_CONTRACT } from './scenes/filament-vortex/geometry.js';
import { filamentVortexManifest, makeFilamentVortexGraph } from './scenes/filament-vortex/manifest.js';
import { createFilamentVortexPipelines, createFilamentVortexExecutors } from './scenes/filament-vortex/pipeline.js';

function parseParams(windowObject) {
  const params = new URLSearchParams(windowObject.location.search);
  const lockedTime = params.has('time') ? Number.parseFloat(params.get('time')) : null;
  return {
    seed: Number.parseInt(params.get('seed') || '491009', 10) || 491009,
    lockedTime: Number.isFinite(lockedTime) ? lockedTime : null,
    mode: params.get('mode') === 'flat' ? 'flat' : 'demo',
  };
}
function updateState(state, runtime, scene, frame = null) {
  const summary = scene.lastSummary;
  state.rendererMode = runtime.mode;
  state.webgpuActive = Boolean(runtime.graphExecutor && runtime.mode !== 'webgl2-legacy');
  state.active = Boolean(state.webgpuActive && (frame || runtime.lastFrame)?.submitted && state.webgpuValidationErrors.length === 0);
  state.seed = scene.seed; state.mode = scene.mode; state.time = scene.lastTime;
  state.strandCount = FILAMENT_CONTRACT.strandCount;
  state.segmentCount = FILAMENT_CONTRACT.segmentCount;
  state.nodeCount = FILAMENT_CONTRACT.nodeCount;
  state.drawVertices = FILAMENT_CONTRACT.drawVertices;
  state.computeDispatches = runtime.graphExecutor?._filamentDispatches || state.computeDispatches || 0;
  state.renderDrawCalls = runtime.graphExecutor?._filamentDrawCalls || state.renderDrawCalls || 0;
  state.buffers = { positions: ['filament-positions-a', 'filament-positions-b'], velocities: ['filament-velocities-a', 'filament-velocities-b'], renderedPosition: scene.pendingPingPong?.nextPositionId || scene.pingPongState?.().previousPositionId };
  state.pingPong = { parity: scene.pingPongParity, swapCount: scene.pingPongSwapCount, pending: scene.pendingPingPong };
  state.generation = runtime.lifecycle?.generation || scene.generation || 0;
  state.frame = frame || runtime.lastFrame || null;
  state.frameCounters = runtime.frameCounters || null;
  state.graphPasses = runtime.graph?.passes?.map((p) => ({ id: p.id, kind: p.kind })) || [];
  state.graphPassIds = state.graphPasses.map((p) => p.id);
  state.telemetry = runtime.resourceManager?.telemetry?.() || null;
  state.gpuTelemetry = runtime.gpuTelemetry;
  state.audio = scene.lastAudio;
  state.signature = scene.lastSignature;
  state.bounds = summary?.bounds || null;
  state.locked = scene.locked;
  state.fallback = !state.webgpuActive;
  state.fallbackReason = runtime.publicErrors?.map((error) => error.code).join(', ') || '';
  state.rafScheduled = Boolean(runtime.frameCounters?.rafScheduled);
}
function writeStatus(status, state) {
  if (!status) return;
  status.textContent = state.webgpuActive
    ? `${state.active ? 'WebGPU compute active' : 'WebGPU compute submitted; awaiting clean visible frame'} · ${state.strandCount}×${state.segmentCount} nodes · ${state.computeDispatches} dispatch · ${state.renderDrawCalls} strand draws · ping-pong parity ${state.pingPong?.parity ?? 0} swaps ${state.pingPong?.swapCount ?? 0} · ${state.locked ? 'locked single frame' : 'live RAF'}`
    : `WebGPU unavailable; old lab fallback linked · ${state.fallbackReason || 'probe unavailable'}`;
}

export async function startFilamentRoute(windowObject = window) {
  const document = windowObject.document;
  const canvas = document.getElementById('filament-canvas');
  const status = document.getElementById('status');
  const errors = document.getElementById('errors');
  const params = parseParams(windowObject);
  const locked = Number.isFinite(params.lockedTime);
  const scene = createFilamentVortexScene({ seed: params.seed, mode: params.mode, locked });
  const demo = new Float32Array(16);
  const start = windowObject.performance.now();
  const state = {
    sceneId: 'filament-vortex', rendererMode: 'pending', active: false, webgpuActive: false,
    seed: params.seed, mode: params.mode, time: params.lockedTime ?? 0, lockedTime: params.lockedTime,
    frameMode: locked ? 'locked-single-frame' : 'live-raf', strandCount: 118, segmentCount: 52, nodeCount: 6136,
    drawVertices: 36108, computeDispatches: 0, renderDrawCalls: 0, graphPasses: [], graphPassIds: [],
    telemetry: null, gpuTelemetry: null, audio: null, bounds: null, signature: '', buffers: {}, generation: 0,
    lifecycle: 'initializing', lock: locked, locked, fallback: false, fallbackHref: './lab/filament-vortex.html', fallbackReason: '', rafScheduled: false,
    webgpuValidationErrors: [], pingPong: { parity: 0, swapCount: 0, pending: null },
    structuralAudio: scene.structuralAudioMappings, materialHierarchy: scene.materialHierarchy,
  };
  windowObject.__V4_FILAMENT_WEBGPU__ = state;
  windowObject.addEventListener?.('uncapturederror', (event) => {
    const error = event?.error || event;
    state.webgpuValidationErrors.push({ name: error?.constructor?.name || 'GPUUncapturedErrorEvent', message: String(error?.message || error?.error?.message || 'uncaptured WebGPU error') });
    state.active = false;
    if (errors) errors.textContent = state.webgpuValidationErrors.map((entry) => `webgpu-validation: ${entry.message}`).join('\n');
    writeStatus(status, state);
  });
  const runtime = await startV4Runtime({
    canvas,
    statusElement: status,
    manifest: filamentVortexManifest,
    graphFactory: makeFilamentVortexGraph,
    scene,
    frameProvider: locked ? null : ({ time, audioBus }) => {
      const seconds = (time - start) / 1000;
      demoBands(demo, seconds, params.seed, params.mode);
      audioBus.processBandFrame(demo, 1 / 60, { source: params.mode === 'flat' ? 'flat' : 'demo', state: params.mode });
      return { time: seconds };
    },
    autoStart: !locked,
    onFrame: ({ frame }) => { updateState(state, runtime, scene, frame); writeStatus(status, state); },
    pipelineRegistryFactory: ({ device, format }) => createFilamentVortexPipelines({ device, format }),
    executorRegistry: createFilamentVortexExecutors(),
    dprCap: 2,
    windowObject,
  });
  runtime.lifecycle?.device?.addEventListener?.('uncapturederror', (event) => {
    const error = event?.error || event;
    state.webgpuValidationErrors.push({ name: error?.constructor?.name || 'GPUValidationError', message: String(error?.message || 'uncaptured WebGPU error') });
    state.active = false;
    if (errors) errors.textContent = state.webgpuValidationErrors.map((entry) => `webgpu-validation: ${entry.message}`).join('\n');
    writeStatus(status, state);
  });
  await runtime.resourcesReady;
  let frame = runtime.lastFrame;
  if (locked) {
    const initialTime = params.lockedTime;
    demoBands(demo, initialTime, params.seed, params.mode);
    runtime.audioBus.processBandFrame(demo, 1 / 60, { source: params.mode === 'flat' ? 'flat' : 'demo', state: params.mode });
    frame = runtime.renderFrame(initialTime);
    await runtime.flushTelemetry({ timeoutMs: 2000 });
    runtime.stop();
  }
  updateState(state, runtime, scene, frame);
  writeStatus(status, state);
  if (errors) errors.textContent = runtime.publicErrors?.map((error) => `${error.code}: ${error.message}`).join('\n') || '';
  windowObject.addEventListener('resize', () => { runtime.resize(); scene.generation += 1; updateState(state, runtime, scene, state.frame); });
  windowObject.addEventListener('pagehide', () => runtime.dispose(), { once: true });
  return { runtime, scene, state };
}

if (globalThis.document) startFilamentRoute(globalThis).catch((error) => {
  const state = globalThis.__V4_FILAMENT_WEBGPU__ || (globalThis.__V4_FILAMENT_WEBGPU__ = {});
  state.active = false; state.webgpuActive = false; state.fallback = true; state.fallbackReason = 'route-start-failed';
  const status = globalThis.document.getElementById('status'); const errors = globalThis.document.getElementById('errors');
  if (status) status.textContent = 'Filament route failed safely; use old WebGL lab fallback.';
  if (errors) errors.textContent = 'route-start-failed';
  console.error(error);
});
