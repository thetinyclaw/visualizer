import { probeRenderer, describeRendererMode, RENDERER_MODES } from './capability.js';
import { GpuLifecycle } from './gpu-lifecycle.js';
import { AudioFeatureBus } from './audio-feature-bus.js';
import { assertSceneManifest } from './scene-manifest.js';
import { makeSceneGraphFoundation } from './render-graph.js';
import { DeviceResourceManager } from './resource-manager.js';
import { AssetCache } from './asset-loader.js';

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

export async function hydrateRuntimeResources({ manager, manifest, assetCache = new AssetCache() } = {}) {
  if (!manager || typeof manager.createBufferFromData !== 'function') throw new TypeError('hydrateRuntimeResources requires a DeviceResourceManager.');
  const safeManifest = assertSceneManifest(manifest);
  for (const buffer of safeManifest.simulationBuffers) {
    const ids = buffer.kind === 'ping-pong' ? [`${buffer.id}-a`, `${buffer.id}-b`] : [buffer.id];
    for (const id of ids) manager.createBufferFromData(id, { byteLength: buffer.byteLength, usage: ['storage', 'copy-dst'], label: id });
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

export async function startV4Runtime({
  canvas,
  statusElement,
  manifest,
  navigatorObject = globalThis.navigator,
  gpuLifecycleOptions = {},
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
  const graph = makeSceneGraphFoundation(safeManifest.id).freeze();
  let selectedMode = probe.mode;
  const publicErrors = [...probe.errors];
  let resourceManager = null;
  let resourcesReady = Promise.resolve(null);
  const lifecycle = new GpuLifecycle({
    ...gpuLifecycleOptions,
    onStateChange: (event) => {
      if (statusElement) statusElement.dataset.gpuState = event.state;
      if (event.state === 'ready' && resourceManager) {
        const generation = event.generation;
        statusElement && (statusElement.dataset.resourcesReady = 'pending');
        resourcesReady = hydrateRuntimeResources({ manager: resourceManager, manifest: safeManifest, assetCache })
          .then((manager) => {
            if (lifecycle.generation !== generation || lifecycle.state !== 'ready') {
              manager.dispose();
              return null;
            }
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
      resourceManager = new DeviceResourceManager(lifecycle, { labelPrefix: safeManifest.id });
      resourcesReady = hydrateRuntimeResources({ manager: resourceManager, manifest: safeManifest, assetCache })
        .then((manager) => {
          if (statusElement) statusElement.dataset.resourcesReady = 'true';
          return manager;
        })
        .catch(() => {
          if (statusElement) statusElement.dataset.resourcesReady = 'false';
          publicErrors.push(Object.freeze({ code: 'gpu-resource-initialization-failed', message: 'Scene GPU resources could not be initialized.' }));
          return null;
        });
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

export { makePixelTexture };
