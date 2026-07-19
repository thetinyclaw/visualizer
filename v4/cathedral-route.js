import { startV4Runtime } from './runtime.js';
import { createPrismaticCathedralScene, demoBands } from './scenes/prismatic-cathedral/geometry.js';
import { prismaticCathedralManifest, makePrismaticCathedralGraph } from './scenes/prismatic-cathedral/manifest.js';
import { createPrismaticCathedralPipelines, createPrismaticCathedralExecutors } from './scenes/prismatic-cathedral/pipeline.js';

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
  state.webgpuActive = Boolean(runtime.graphExecutor && runtime.mode !== 'webgl2-legacy' && !state.validationFailed);
  state.active = state.webgpuActive;
  state.frame = frame || state.frame || null;
  state.seed = scene.seed;
  state.time = scene.lastTime;
  state.mode = scene.mode;
  state.vertexCounts = summary ? { vertices: summary.vertexCount, indices: summary.indexCount, triangles: summary.triangleCount, arches: summary.archCount, shards: summary.shardCount, maxTriangleVertices: scene.contract.maxTriangleVertices } : null;
  state.bounds = summary?.bounds || null;
  state.graphPassIds = runtime.graph?.passes?.map((pass) => pass.id) || [];
  state.dpr = frame?.dpr || runtime.graphExecutor?.dpr || Math.max(1, globalThis.devicePixelRatio || 1);
  state.telemetry = runtime.resourceManager?.telemetry?.() || null;
  state.fallbackReason = runtime.publicErrors?.map((error) => error.code).join(', ') || '';
  state.audio = scene.lastAudio;
  state.frameCounters = runtime.frameCounters || null;
  state.lastFrameMs = runtime.frameCounters?.lastFrameMs || 0;
  state.rafScheduled = Boolean(runtime.frameCounters?.rafScheduled);
}

function writeStatus(status, state) {
  if (!status) return;
  const vc = state.vertexCounts;
  const frameMode = state.frameMode === 'locked-single-frame' ? 'locked' : 'live';
  status.textContent = state.webgpuActive
    ? `WebGPU active · ${vc?.arches || 0} arches + ${vc?.shards || 0} shards · ${vc?.vertices || 0} indexed verts · DPR ${Number(state.dpr).toFixed(2)} · ${frameMode} · frames ${state.frameCounters?.submitted ?? 0}`
    : `WebGPU unavailable; fallback link active · ${state.fallbackReason || 'probe unavailable'}`;
}

export function recordCathedralValidationError(state, event, status = null, errors = null) {
  const error = event?.error || event;
  state.webgpuValidationErrors.push({
    name: error?.constructor?.name || 'GPUValidationError',
    message: String(error?.message || 'uncaptured WebGPU error'),
  });
  state.validationFailed = true;
  state.active = false;
  state.webgpuActive = false;
  if (errors) errors.textContent = state.webgpuValidationErrors.map((entry) => `webgpu-validation: ${entry.message}`).join('\n');
  writeStatus(status, state);
}

export async function startCathedralRoute(windowObject = window) {
  const document = windowObject.document;
  const canvas = document.getElementById('cathedral-canvas');
  const status = document.getElementById('status');
  const errors = document.getElementById('errors');
  const params = parseParams(windowObject);
  const scene = createPrismaticCathedralScene({ seed: params.seed, mode: params.mode });
  const demo = new Float32Array(16);
  const start = windowObject.performance.now();
  const locked = Number.isFinite(params.lockedTime);
  const state = {
    sceneId: 'prismatic-cathedral', rendererMode: 'pending', active: false, webgpuActive: false,
    seed: params.seed, time: params.lockedTime ?? 0, mode: params.mode, lockedTime: params.lockedTime,
    vertexCounts: null, bounds: null, graphPassIds: [], dpr: Math.max(1, windowObject.devicePixelRatio || 1),
    frame: null, telemetry: null, fallbackReason: '', fallbackHref: './lab/prismatic-cathedral.html',
    frameMode: locked ? 'locked-single-frame' : 'live-raf', frameCounters: null, lastFrameMs: 0, rafScheduled: false,
    structuralAudio: scene.structuralAudioMappings, materialHierarchy: scene.materialHierarchy,
    validationFailed: false, webgpuValidationErrors: [],
  };
  windowObject.__V4_CATHEDRAL_WEBGPU__ = state;

  const runtime = await startV4Runtime({
    canvas,
    statusElement: status,
    manifest: prismaticCathedralManifest,
    graphFactory: makePrismaticCathedralGraph,
    scene,
    frameProvider: locked ? null : ({ time, audioBus }) => {
      const seconds = Number.isFinite(params.lockedTime) ? params.lockedTime : (time - start) / 1000;
      demoBands(demo, seconds, params.seed, params.mode);
      audioBus.processBandFrame(demo, 1 / 60, { source: params.mode === 'flat' ? 'flat' : 'demo', state: params.mode });
      return { time: seconds };
    },
    autoStart: !locked,
    onFrame: ({ frame }) => { updateState(state, runtime, scene, frame); writeStatus(status, state); },
    pipelineRegistryFactory: ({ device, format }) => createPrismaticCathedralPipelines({ device, format }),
    executorRegistry: createPrismaticCathedralExecutors(),
    dprCap: 2,
    windowObject,
  });
  runtime.lifecycle?.device?.addEventListener?.('uncapturederror', (event) => {
    recordCathedralValidationError(state, event, status, errors);
  });
  await runtime.resourcesReady;
  const initialTime = Number.isFinite(params.lockedTime) ? params.lockedTime : 0;
  let frame = runtime.lastFrame;
  if (locked) {
    demoBands(demo, initialTime, params.seed, params.mode);
    runtime.audioBus.processBandFrame(demo, 1 / 60, { source: params.mode === 'flat' ? 'flat' : 'demo', state: params.mode });
    frame = runtime.renderFrame(initialTime);
    runtime.stop();
  }
  updateState(state, runtime, scene, frame);
  writeStatus(status, state);
  if (errors) errors.textContent = runtime.publicErrors?.map((error) => `${error.code}: ${error.message}`).join('\n') || '';
  windowObject.addEventListener('resize', () => {
    runtime.resize();
    updateState(state, runtime, scene, state.frame);
  });
  windowObject.addEventListener('pagehide', () => runtime.dispose(), { once: true });
  return { runtime, scene, state };
}

if (globalThis.document) startCathedralRoute(globalThis).catch((error) => {
  const state = globalThis.__V4_CATHEDRAL_WEBGPU__ || (globalThis.__V4_CATHEDRAL_WEBGPU__ = {});
  state.active = false; state.webgpuActive = false; state.fallbackReason = 'route-start-failed';
  const status = globalThis.document.getElementById('status');
  const errors = globalThis.document.getElementById('errors');
  if (status) status.textContent = 'Cathedral route failed safely; use WebGL lab fallback.';
  if (errors) errors.textContent = 'route-start-failed';
  console.error(error);
});
