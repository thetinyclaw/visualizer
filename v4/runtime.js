import { probeRenderer, describeRendererMode, RENDERER_MODES } from './capability.js';
import { GpuLifecycle } from './gpu-lifecycle.js';
import { AudioFeatureBus } from './audio-feature-bus.js';
import { assertSceneManifest } from './scene-manifest.js';
import { makeSceneGraphFoundation } from './render-graph.js';

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
  const lifecycle = new GpuLifecycle({
    ...gpuLifecycleOptions,
    onStateChange: (event) => {
      if (statusElement) statusElement.dataset.gpuState = event.state;
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

  let selectedMode = probe.mode;
  const publicErrors = [...probe.errors];
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
    }
  }

  const runtime = Object.freeze({
    get mode() { return selectedMode; },
    get modeLabel() { return describeRendererMode(selectedMode); },
    manifest: safeManifest,
    graph,
    audioBus,
    lifecycle,
    publicErrors,
  });

  if (statusElement) {
    statusElement.textContent = `${runtime.modeLabel} selected`;
    statusElement.dataset.rendererMode = runtime.mode;
    statusElement.dataset.webgpuActive = String(runtime.mode !== RENDERER_MODES.WEBGL2_LEGACY && lifecycle.state !== 'fallback-required');
  }

  return runtime;
}
