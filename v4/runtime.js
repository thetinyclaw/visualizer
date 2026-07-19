import { probeRenderer, describeRendererMode, RENDERER_MODES } from './capability.js';
import { GpuLifecycle } from './gpu-lifecycle.js';
import { AudioFeatureBus } from './audio-feature-bus.js';
import { assertSceneManifest } from './scene-manifest.js';
import { makeSceneGraphFoundation } from './render-graph.js';

export async function startV4Runtime({ canvas, statusElement, manifest, navigatorObject = globalThis.navigator } = {}) {
  const safeManifest = assertSceneManifest(manifest);
  const probe = await probeRenderer({ navigatorObject, canvas });
  const audioBus = new AudioFeatureBus();
  const graph = makeSceneGraphFoundation(safeManifest.id).freeze();
  const lifecycle = new GpuLifecycle({
    onStateChange: (event) => {
      if (statusElement) statusElement.dataset.gpuState = event.state;
    },
  });

  if (probe.webgpu && probe.webgpu.device) {
    lifecycle.device = probe.webgpu.device;
    lifecycle.generation = 1;
    lifecycle.transition('ready');
  }

  const runtime = Object.freeze({
    mode: probe.mode,
    modeLabel: describeRendererMode(probe.mode),
    manifest: safeManifest,
    graph,
    audioBus,
    lifecycle,
    publicErrors: probe.errors,
  });

  if (statusElement) {
    statusElement.textContent = `${runtime.modeLabel} selected`;
    statusElement.dataset.rendererMode = runtime.mode;
    statusElement.dataset.webgpuActive = String(runtime.mode !== RENDERER_MODES.WEBGL2_LEGACY);
  }

  return runtime;
}
