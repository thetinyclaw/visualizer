import { probeRenderer, describeRendererMode, RENDERER_MODES } from './capability.js';
import { GpuLifecycle, GPU_LIFECYCLE_STATES } from './gpu-lifecycle.js';
import { AudioFeatureBus } from './audio-feature-bus.js';
import { assertSceneManifest } from './scene-manifest.js';
import { DeviceResourceManager } from './resource-manager.js';
import { AssetCache } from './asset-loader.js';
import { WebGpuGraphExecutor } from './render-graph-executor.js';

const HYDRATED_BUFFER_TYPES = Object.freeze(new Map([
  ['uniform-buffer', ['uniform', 'copy-dst']],
  ['storage-buffer', ['storage', 'copy-dst']],
  ['vertex-buffer', ['vertex', 'copy-dst']],
  ['index-buffer', ['index', 'copy-dst']],
]));

function makePixelTexture(width = 1, height = 1, rgba = [255, 255, 255, 255]) {
  const pixels = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(rgba, offset);
  return Object.freeze({ width, height, pixels });
}

function texturePixelsFromAsset(asset, value) {
  if (value?.data) value = value.data;
  if (value?.pixels) return value;
  if (value instanceof Uint8Array) return { width: asset.width, height: asset.height, pixels: value };
  if (value instanceof ArrayBuffer) return { width: asset.width, height: asset.height, pixels: new Uint8Array(value) };
  return null;
}

function setDataset(statusElement, values) {
  if (!statusElement) return;
  Object.assign(statusElement.dataset, values);
}

export async function hydrateRuntimeResources({ manager, manifest, assetCache = new AssetCache(), graph = null } = {}) {
  if (!manager || typeof manager.createBufferFromData !== 'function') throw new TypeError('hydrateRuntimeResources requires a DeviceResourceManager.');
  const safeManifest = assertSceneManifest(manifest);
  for (const buffer of safeManifest.simulationBuffers) {
    const ids = buffer.kind === 'ping-pong' ? [`${buffer.id}-a`, `${buffer.id}-b`] : [buffer.id];
    for (const id of ids) manager.createBufferFromData(id, { byteLength: buffer.byteLength, usage: ['storage', 'copy-dst'], label: id });
  }
  for (const resource of graph?.resources || []) {
    const usage = HYDRATED_BUFFER_TYPES.get(resource.type);
    if (!usage || manager.get(resource.id)) continue;
    manager.createBufferFromData(resource.id, { byteLength: resource.byteLength, usage, label: resource.id });
  }
  const loadedAssets = await assetCache.loadManifest(safeManifest.assets);
  for (const asset of safeManifest.assets) {
    if (asset.type !== 'texture') continue;
    const pixels = texturePixelsFromAsset(asset, loadedAssets.get(asset.id));
    if (!pixels) continue;
    manager.createTextureFromPixels(`asset:${asset.id}`, pixels);
  }
  return manager;
}

export function buildExecutorResources(manager, graph) {
  const resources = new Map();
  for (const resource of graph?.resources || []) {
    const handle = manager?.get(resource.id);
    if (handle && manager.isHandleCurrent(handle)) resources.set(resource.id, handle.resource);
  }
  for (const entry of manager?.telemetry?.().resources || []) {
    const handle = manager.get(entry.id);
    if (handle && manager.isHandleCurrent(handle)) resources.set(entry.id, handle.resource);
  }
  return resources;
}

function defaultSmokePipelines() {
  const pipeline = { label: 'v4-smoke-placeholder-pipeline' };
  return new Map([['v4-clear-draw-pipeline', pipeline]]);
}

function runtimeFallback({ safeManifest, audioBus, statusElement, publicErrors }) {
  setDataset(statusElement, { rendererMode: RENDERER_MODES.WEBGL2_LEGACY, webgpuActive: 'false', resourcesReady: 'false', frameSubmitted: 'false' });
  if (statusElement) statusElement.textContent = 'Runtime initialization failed safely';
  return Object.freeze({
    mode: RENDERER_MODES.WEBGL2_LEGACY,
    modeLabel: describeRendererMode(RENDERER_MODES.WEBGL2_LEGACY),
    manifest: safeManifest,
    graph: null,
    audioBus,
    lifecycle: null,
    assetCache: new AssetCache(),
    get resourceManager() { return null; },
    get graphExecutor() { return null; },
    resourcesReady: Promise.resolve(null),
    publicErrors,
    renderFrame() { return null; },
    stop() {},
    resize() { return false; },
    dispose() {},
  });
}

export async function startV4Runtime({
  canvas,
  statusElement,
  manifest,
  graph = null,
  graphFactory = null,
  scene = null,
  sceneFactory = null,
  frameProvider = null,
  navigatorObject = globalThis.navigator,
  windowObject = globalThis,
  gpuLifecycleOptions = {},
  pipelineRegistryFactory = defaultSmokePipelines,
  executorRegistry = {},
  dprCap = 2,
  assetCache = new AssetCache(),
  createFallbackCanvas = () => {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(1, 1);
    if (globalThis.document && typeof globalThis.document.createElement === 'function') return globalThis.document.createElement('canvas');
    return null;
  },
} = {}) {
  const safeManifest = assertSceneManifest(manifest);
  const fallbackCanvas = createFallbackCanvas ? createFallbackCanvas() : null;
  const probe = await probeRenderer({ navigatorObject, canvas, fallbackCanvas });
  const audioBus = new AudioFeatureBus();
  const resolvedScene = scene || (sceneFactory ? await sceneFactory({ manifest: safeManifest, audioBus }) : null);
  let authoredGraph;
  try {
    if (graph) authoredGraph = graph;
    else if (graphFactory) authoredGraph = await graphFactory({ manifest: safeManifest, scene: resolvedScene, audioBus });
    else throw new Error('authored graph required');
    if (authoredGraph && typeof authoredGraph.freeze === 'function') authoredGraph = authoredGraph.freeze();
  } catch (error) {
    return runtimeFallback({
      safeManifest,
      audioBus,
      statusElement,
      publicErrors: [Object.freeze({ code: 'render-graph-unavailable', message: 'Authored render graph could not be compiled.' })],
    });
  }

  let resourceManager = null;
  let graphExecutor = null;
  let resourcesReady = Promise.resolve(null);
  let selectedMode = probe.mode;
  let disposed = false;
  let rafId = null;
  let frameGeneration = 0;
  const publicErrors = [...probe.errors];

  const stopLoop = () => {
    frameGeneration += 1;
    if (rafId !== null && windowObject && typeof windowObject.cancelAnimationFrame === 'function') windowObject.cancelAnimationFrame(rafId);
    rafId = null;
  };
  const disposeExecutor = () => {
    stopLoop();
    if (graphExecutor) graphExecutor.dispose();
    graphExecutor = null;
    setDataset(statusElement, { frameSubmitted: 'false' });
  };
  const resetExecutionState = () => {
    disposeExecutor();
    setDataset(statusElement, { resourcesReady: 'false', frameSubmitted: 'false' });
  };
  const submitOneFrame = (time = 0, token = frameGeneration) => {
    if (disposed || token !== frameGeneration || !graphExecutor || lifecycle.state !== GPU_LIFECYCLE_STATES.READY) return null;
    const frame = graphExecutor.render({ time, scene: resolvedScene, audio: audioBus.snapshot ? audioBus.snapshot() : null });
    setDataset(statusElement, { frameSubmitted: String(frame.submitted) });
    return frame;
  };
  const startLoopIfNeeded = () => {
    if (!frameProvider || !windowObject || typeof windowObject.requestAnimationFrame !== 'function') return;
    stopLoop();
    const token = frameGeneration;
    const tick = (time) => {
      if (disposed || token !== frameGeneration || !graphExecutor) return;
      const provided = frameProvider({ time, scene: resolvedScene, audioBus });
      submitOneFrame(provided?.time ?? time, token);
      rafId = windowObject.requestAnimationFrame(tick);
    };
    rafId = windowObject.requestAnimationFrame(tick);
  };

  const hydrateAndStart = ({ device, generation }) => {
    if (!resourceManager) resourceManager = new DeviceResourceManager(lifecycle, { labelPrefix: safeManifest.id });
    setDataset(statusElement, { resourcesReady: 'pending', frameSubmitted: 'false' });
    resourcesReady = hydrateRuntimeResources({ manager: resourceManager, manifest: safeManifest, assetCache, graph: authoredGraph })
      .then((manager) => {
        if (disposed || lifecycle.device !== device || lifecycle.generation !== generation || lifecycle.state !== GPU_LIFECYCLE_STATES.READY) return null;
        disposeExecutor();
        const format = navigatorObject?.gpu?.getPreferredCanvasFormat?.() || 'bgra8unorm';
        const pipelines = pipelineRegistryFactory({ device, format, graph: authoredGraph, manifest: safeManifest, scene: resolvedScene });
        graphExecutor = new WebGpuGraphExecutor({
          device,
          canvas,
          graph: authoredGraph,
          format,
          resources: buildExecutorResources(manager, authoredGraph),
          pipelines,
          executors: executorRegistry,
          dprCap,
          windowObject,
        });
        lifecycle.registerResource(graphExecutor);
        setDataset(statusElement, { resourcesReady: 'true' });
        if (frameProvider) startLoopIfNeeded(); else submitOneFrame(0);
        return manager;
      })
      .catch(() => {
        resetExecutionState();
        publicErrors.push(Object.freeze({ code: 'gpu-resource-initialization-failed', message: 'Scene GPU resources could not be initialized.' }));
        return null;
      });
    return resourcesReady;
  };

  const lifecycle = new GpuLifecycle({
    ...gpuLifecycleOptions,
    onStateChange: (event) => {
      if (statusElement) statusElement.dataset.gpuState = event.state;
      if (event.state === GPU_LIFECYCLE_STATES.LOST || event.state === GPU_LIFECYCLE_STATES.FALLBACK || event.state === GPU_LIFECYCLE_STATES.DISPOSED) resetExecutionState();
      if (event.state === GPU_LIFECYCLE_STATES.READY && lifecycle.device && resourceManager) {
        hydrateAndStart({ device: lifecycle.device, generation: event.generation });
      }
      if (event.state === GPU_LIFECYCLE_STATES.FALLBACK) {
        selectedMode = RENDERER_MODES.WEBGL2_LEGACY;
        publicErrors.push(Object.freeze({ code: event.publicError || 'gpu-fallback-required', message: 'GPU lifecycle entered terminal fallback; WebGPU is inactive.' }));
        if (statusElement) statusElement.textContent = `${describeRendererMode(selectedMode)} fallback required`;
        setDataset(statusElement, { rendererMode: selectedMode, webgpuActive: 'false', resourcesReady: 'false', frameSubmitted: 'false' });
      }
      if (typeof gpuLifecycleOptions.onStateChange === 'function') gpuLifecycleOptions.onStateChange(event);
    },
  });

  if (probe.webgpu && probe.webgpu.device && probe.webgpu.adapter) {
    let adoptingProbedDevice = true;
    const requestDevice = async () => {
      if (adoptingProbedDevice) { adoptingProbedDevice = false; return probe.webgpu.device; }
      return probe.webgpu.adapter.requestDevice({ requiredFeatures: probe.webgpu.requiredFeatures || [] });
    };
    const acquiredDevice = await lifecycle.acquire(requestDevice);
    if (!acquiredDevice) {
      selectedMode = RENDERER_MODES.WEBGL2_LEGACY;
      publicErrors.push(Object.freeze({ code: 'gpu-device-request-failed', message: 'GPU lifecycle could not acquire a device; falling back safely.' }));
    } else {
      await hydrateAndStart({ device: acquiredDevice, generation: lifecycle.generation });
    }
  }

  const runtime = Object.freeze({
    get mode() { return selectedMode; },
    get modeLabel() { return describeRendererMode(selectedMode); },
    manifest: safeManifest,
    graph: authoredGraph,
    audioBus,
    lifecycle,
    assetCache,
    get resourceManager() { return !disposed && lifecycle.state === GPU_LIFECYCLE_STATES.READY ? resourceManager : null; },
    get graphExecutor() { return !disposed && lifecycle.state === GPU_LIFECYCLE_STATES.READY ? graphExecutor : null; },
    get resourcesReady() { return resourcesReady; },
    publicErrors,
    renderFrame: submitOneFrame,
    stop: stopLoop,
    resize() { return graphExecutor ? graphExecutor.resizeTargets() : false; },
    dispose() { disposed = true; resetExecutionState(); resourceManager?.destroy?.(); resourceManager = null; lifecycle.dispose(); },
  });

  if (statusElement) {
    statusElement.textContent = `${runtime.modeLabel} selected`;
    setDataset(statusElement, {
      rendererMode: runtime.mode,
      webgpuActive: String(runtime.mode !== RENDERER_MODES.WEBGL2_LEGACY && lifecycle.state !== GPU_LIFECYCLE_STATES.FALLBACK),
      resourcesReady: statusElement.dataset.resourcesReady || 'false',
      frameSubmitted: statusElement.dataset.frameSubmitted || 'false',
    });
  }
  if (!probe.webgpu) setDataset(statusElement, { resourcesReady: 'false', frameSubmitted: 'false' });

  return runtime;
}

export { makePixelTexture };
