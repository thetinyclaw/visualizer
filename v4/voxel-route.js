import { startV4Runtime } from './runtime.js';
import { createNeonVoxelCloudScene, demoVoxelBands, voxelByteSignature, VOXEL_INSTANCE_COUNT, VOXEL_CONTRACT } from './scenes/neon-voxel-cloud/geometry.js';
import { neonVoxelCloudManifest, makeNeonVoxelCloudGraph } from './scenes/neon-voxel-cloud/manifest.js';
import { createNeonVoxelCloudPipelines, createNeonVoxelCloudExecutors } from './scenes/neon-voxel-cloud/pipeline.js';

function parseParams(windowObject) {
  const params = new URLSearchParams(windowObject.location.search);
  const lockedTime = params.has('time') ? Number.parseFloat(params.get('time')) : null;
  return {
    seed: Number.parseInt(params.get('seed') || '582114', 10) || 582114,
    lockedTime: Number.isFinite(lockedTime) ? lockedTime : null,
    mode: params.get('mode') === 'flat' ? 'flat' : 'demo',
  };
}

function updateState(state, runtime, scene, frame = null) {
  const summary = scene.lastSummary;
  state.rendererMode = runtime.mode;
  state.webgpuActive = Boolean(runtime.graphExecutor && runtime.mode !== 'webgl2-legacy');
  state.validationFailed = state.validationErrors.length > 0;
  state.active = state.webgpuActive && !state.validationFailed;
  state.frame = frame || state.frame || null;
  state.seed = scene.seed;
  state.time = scene.lastTime;
  state.mode = scene.mode;
  state.compute = {
    instanceCount: VOXEL_INSTANCE_COUNT,
    workgroups: VOXEL_CONTRACT.computeWorkgroups,
    payloadFloatsPerInstance: VOXEL_CONTRACT.payloadFloatsPerInstance,
    immutableBaseUploaded: Boolean(runtime.graphExecutor?._voxelImmutableUploaded),
  };
  state.instances = { count: VOXEL_INSTANCE_COUNT, cubeIndices: 36, draw: 'drawIndexed(36, 260, 0, 0, 0)' };
  state.bounds = summary?.bounds || null;
  state.topology = summary?.topology || null;
  state.graphPassIds = runtime.graph?.passes?.map((pass) => pass.id) || [];
  state.passes = state.graphPassIds;
  state.dpr = frame?.dpr || runtime.graphExecutor?.dpr || Math.max(1, globalThis.devicePixelRatio || 1);
  state.telemetry = runtime.resourceManager?.telemetry?.() || null;
  state.gpuTelemetry = runtime.gpuTelemetry;
  state.fallbackReason = state.validationFailed ? 'webgpu-validation-failed' : (runtime.publicErrors?.map((error) => error.code).join(', ') || '');
  state.audio = scene.lastAudio;
  state.byteSignature = voxelByteSignature(scene);
  state.frameCounters = runtime.frameCounters || null;
  state.lastFrameMs = runtime.frameCounters?.lastFrameMs || 0;
  state.rafScheduled = Boolean(runtime.frameCounters?.rafScheduled);
}

function writeStatus(status, state) {
  if (!status) return;
  const frameMode = state.frameMode === 'locked-single-frame' ? 'locked single-frame' : 'live RAF';
  status.textContent = state.validationFailed
    ? `WebGPU validation failed; frame submission is not accepted · ${state.validationErrors[0]?.message || 'uncaptured GPU error'}`
    : state.webgpuActive
    ? `WebGPU active · ${state.instances.count} coherent voxel cells · compute ${state.compute.workgroups.join('×')} · instanced drawIndexed ×260 · ${frameMode} · frames ${state.frameCounters?.submitted ?? 0}`
    : `WebGPU unavailable; old lab fallback link active · ${state.fallbackReason || 'probe unavailable'}`;
}

function installValidationProbe({ runtime, state, status, errors }) {
  const device = runtime?.lifecycle?.device;
  if (!device || typeof device.addEventListener !== 'function' || state._validationProbeInstalled) return false;
  state._validationProbeInstalled = true;
  device.addEventListener('uncapturederror', (event) => {
    const message = event?.error?.message || event?.message || 'Uncaptured WebGPU validation error';
    state.validationErrors.push({ message, name: event?.error?.name || 'GPUUncapturedErrorEvent' });
    state.validationFailed = true;
    state.active = false;
    state.webgpuActive = false;
    state.fallbackReason = 'webgpu-validation-failed';
    if (errors) errors.textContent = state.validationErrors.map((error) => `webgpu-validation-failed: ${error.message}`).join('\n');
    writeStatus(status, state);
    console.error('[Neon Voxel Cloud] WebGPU validation failure', message);
  });
  return true;
}

export async function startVoxelRoute(windowObject = window) {
  const document = windowObject.document;
  const canvas = document.getElementById('voxel-canvas');
  const status = document.getElementById('status');
  const errors = document.getElementById('errors');
  const params = parseParams(windowObject);
  const scene = createNeonVoxelCloudScene({ seed: params.seed, mode: params.mode });
  const demo = new Float32Array(16);
  const start = windowObject.performance.now();
  const locked = Number.isFinite(params.lockedTime);
  const state = {
    sceneId: 'neon-voxel-cloud', renderer: 'webgpu-instanced-compute', rendererMode: 'pending', active: false, webgpuActive: false,
    seed: params.seed, time: params.lockedTime ?? 0, mode: params.mode, lockedTime: params.lockedTime,
    instances: { count: VOXEL_INSTANCE_COUNT }, compute: { instanceCount: VOXEL_INSTANCE_COUNT }, bounds: null, topology: null,
    graphPassIds: [], passes: [], dpr: Math.max(1, windowObject.devicePixelRatio || 1),
    frame: null, telemetry: null, gpuTelemetry: null, fallback: { href: './lab/neon-voxel-cloud.html', label: 'old WebGL lab fallback' }, fallbackReason: '',
    frameMode: locked ? 'locked-single-frame' : 'live-raf', frameCounters: null, lastFrameMs: 0, rafScheduled: false,
    structuralAudio: scene.structuralAudioMappings, materialHierarchy: scene.materialHierarchy, byteSignature: voxelByteSignature(scene),
    validationErrors: [], validationFailed: false, _validationProbeInstalled: false,
  };
  windowObject.__V4_VOXEL_WEBGPU__ = state;

  const runtime = await startV4Runtime({
    canvas,
    statusElement: status,
    manifest: neonVoxelCloudManifest,
    graphFactory: makeNeonVoxelCloudGraph,
    scene,
    frameProvider: locked ? null : ({ time, audioBus }) => {
      const seconds = (time - start) / 1000;
      demoVoxelBands(demo, seconds, params.seed, params.mode);
      audioBus.processBandFrame(demo, 1 / 60, { source: params.mode === 'flat' ? 'flat' : 'demo', state: params.mode });
      return { time: seconds };
    },
    autoStart: !locked,
    onFrame: ({ frame }) => { updateState(state, runtime, scene, frame); writeStatus(status, state); },
    pipelineRegistryFactory: ({ device, format }) => createNeonVoxelCloudPipelines({ device, format }),
    executorRegistry: createNeonVoxelCloudExecutors(),
    dprCap: 2,
    windowObject,
    gpuLifecycleOptions: {
      onStateChange: () => installValidationProbe({ runtime: windowObject.__V4_VOXEL_RUNTIME__, state, status, errors }),
    },
  });
  windowObject.__V4_VOXEL_RUNTIME__ = runtime;
  await runtime.resourcesReady;
  installValidationProbe({ runtime, state, status, errors });
  let frame = runtime.lastFrame;
  const initialTime = Number.isFinite(params.lockedTime) ? params.lockedTime : 0;
  if (locked) {
    demoVoxelBands(demo, initialTime, params.seed, params.mode);
    runtime.audioBus.processBandFrame(demo, 1 / 60, { source: params.mode === 'flat' ? 'flat' : 'demo', state: params.mode });
    frame = runtime.renderFrame(initialTime);
    runtime.stop();
  }
  updateState(state, runtime, scene, frame);
  state.runtime = runtime;
  writeStatus(status, state);
  if (errors) errors.textContent = runtime.publicErrors?.map((error) => `${error.code}: ${error.message}`).join('\n') || '';
  windowObject.addEventListener('resize', () => { runtime.resize(); updateState(state, runtime, scene, state.frame); });
  windowObject.addEventListener('pagehide', () => runtime.dispose(), { once: true });
  return { runtime, scene, state };
}

if (globalThis.document) startVoxelRoute(globalThis).catch((error) => {
  const state = globalThis.__V4_VOXEL_WEBGPU__ || (globalThis.__V4_VOXEL_WEBGPU__ = {});
  state.active = false; state.webgpuActive = false; state.fallbackReason = 'route-start-failed';
  const status = globalThis.document.getElementById('status');
  const errors = globalThis.document.getElementById('errors');
  if (status) status.textContent = 'Neon Voxel Cloud route failed safely; use WebGL lab fallback.';
  if (errors) errors.textContent = 'route-start-failed';
  console.error(error);
});
