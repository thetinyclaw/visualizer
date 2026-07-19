import { probeRenderer, describeRendererMode, RENDERER_MODES } from './capability.js';
import { GpuLifecycle } from './gpu-lifecycle.js';
import { AudioFeatureBus } from './audio-feature-bus.js';
import { assertSceneManifest } from './scene-manifest.js';
import { makeSceneGraphFoundation } from './render-graph.js';
import { AssetCache, GpuResourceManager } from './resource-manager.js';

async function hydrateDeviceResources(device, manifest, assetCache) {
  const manager = new GpuResourceManager(device);
  try {
    for (const buffer of manifest.simulationBuffers) {
      const ids = buffer.kind === 'ping-pong' ? [`${buffer.id}-a`, `${buffer.id}-b`] : [buffer.id];
      for (const id of ids) manager.createBuffer(id, { byteLength: buffer.byteLength, usage: ['storage', 'copy-dst'] });
    }
    const loadedAssets = await assetCache.loadManifest(manifest.assets);
    for (const asset of manifest.assets) {
      if (asset.type !== 'texture') continue;
      const value = loadedAssets.get(asset.id);
      const pixels = value && value.pixels ? value : { width: asset.width, height: asset.height, pixels: value };
      manager.createTextureFromPixels(`asset:${asset.id}`, pixels);
    }
    return manager;
  } catch (error) {
    manager.dispose();
    throw error;
  }
}

export async function startV4Runtime({
  canvas,
  statusElement,
  manifest,
  navigatorObject = globalThis.navigator,
  gpuLifecycleOptions = {},
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
  const graph = makeSceneGraphFoundation(safeManifest.id).freeze();
  const assetCache = new AssetCache();
  let resourceManager = null;
  let resourcesReady = Promise.resolve(null);
  let selectedMode = probe.mode;
  const publicErrors = [...probe.errors];
  const lifecycle = new GpuLifecycle({
    ...gpuLifecycleOptions,
    onStateChange: (event) => {
      if (statusElement) statusElement.dataset.gpuState = event.state;
      if (event.state === 'ready' && lifecycle.device) {
        const device = lifecycle.device;
        const generation = event.generation;
        resourcesReady = hydrateDeviceResources(device, safeManifest, assetCache)
          .then((manager) => {
            if (lifecycle.device !== device || lifecycle.generation !== generation || lifecycle.state !== 'ready') {
              manager.dispose();
              return null;
            }
            resourceManager = manager;
            lifecycle.registerResource(manager);
            if (statusElement) statusElement.dataset.resourcesReady = 'true';
            return manager;
          })
          .catch(() => {
            if (statusElement) statusElement.dataset.resourcesReady = 'false';
            publicErrors.push(Object.freeze({ code: 'gpu-resource-initialization-failed', message: 'Scene GPU resources could not be initialized.' }));
            return null;
          });
      }
      if (event.state === 'fallback-required') {
        selectedMode = RENDERER_MODES.WEBGL2_LEGACY;
        publicErrors.push(Object.freeze({
          code: event.publicError || 'gpu-fallback-required',
          message: 'GPU lifecycle entered terminal fallback; WebGPU is inactive.',
        }));
        if (statusElement) {
          statusElement.textContent = `${describeRendererMode(selectedMode)} fallback required`;
          statusElement.dataset.rendererMode = selectedMode;
          statusElement.dataset.webgpuActive = 'false';
        }
      }
      if (typeof gpuLifecycleOptions.onStateChange === 'function') gpuLifecycleOptions.onStateChange(event);
    },
  });
  if (probe.webgpu && probe.webgpu.device && probe.webgpu.adapter) {
    let adoptingProbedDevice = true;
    const requestDevice = async () => {
      if (adoptingProbedDevice) {
        adoptingProbedDevice = false;
        return probe.webgpu.device;
      }
      return probe.webgpu.adapter.requestDevice({ requiredFeatures: probe.webgpu.requiredFeatures || [] });
    };
    const acquiredDevice = await lifecycle.acquire(requestDevice);
    if (!acquiredDevice) {
      selectedMode = RENDERER_MODES.WEBGL2_LEGACY;
      publicErrors.push(Object.freeze({ code: 'gpu-device-request-failed', message: 'GPU lifecycle could not acquire a device; falling back safely.' }));
    } else {
      await resourcesReady;
    }
  }

  const runtime = Object.freeze({
    get mode() { return selectedMode; },
    get modeLabel() { return describeRendererMode(selectedMode); },
    manifest: safeManifest,
    graph,
    audioBus,
    lifecycle,
    assetCache,
    get resourceManager() { return resourceManager; },
    get resourcesReady() { return resourcesReady; },
    publicErrors,
  });

  if (statusElement) {
    statusElement.textContent = `${runtime.modeLabel} selected`;
    statusElement.dataset.rendererMode = runtime.mode;
    statusElement.dataset.webgpuActive = String(runtime.mode !== RENDERER_MODES.WEBGL2_LEGACY && lifecycle.state !== 'fallback-required');
  }

  return runtime;
}
