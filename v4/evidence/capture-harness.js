// Browser-side Visualizer v4 capture/telemetry harness.
// This file is dependency-free and same-origin safe. Local controllers may inject
// equivalent code before navigation; pages can also include it directly for manual
// protocol/export checks. It observes real requestAnimationFrame timing and page
// metadata only; it never fabricates screenshots or unavailable GPU telemetry.

export function installV4CaptureHarness(options = {}) {
  const config = Object.freeze({
    seed: Number.isInteger(options.seed) ? options.seed : null,
    lockedTimeMs: Number.isFinite(options.lockedTimeMs) ? options.lockedTimeMs : null,
    mode: String(options.mode || 'demo'),
    minFrames: Math.max(120, Number(options.minFrames || 120)),
    warmupFrames: Math.max(1, Number(options.warmupFrames || 10)),
  });
  window.__V4_CAPTURE_CONFIG__ = config;
  const consoleLogs = [];
  if (!window.__V4_CAPTURE_CONSOLE_PATCHED__) {
    window.__V4_CAPTURE_CONSOLE_PATCHED__ = true;
    for (const [kind, original] of [['error', console.error], ['warn', console.warn]]) {
      console[kind] = (...args) => {
        consoleLogs.push({ type: kind === 'warn' ? 'warning' : kind, text: args.map(String).join(' ') });
        return original.apply(console, args);
      };
    }
    window.addEventListener('error', (event) => consoleLogs.push({ type: 'error', text: String(event.message || 'window error') }));
    window.addEventListener('unhandledrejection', (event) => consoleLogs.push({ type: 'error', text: String(event.reason?.message || event.reason || 'unhandled rejection') }));
  }

  async function sampleFrames() {
    const frames = [];
    let previous = null;
    await new Promise((resolve) => {
      let count = 0;
      const tick = () => (++count >= config.warmupFrames ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
    await new Promise((resolve) => {
      const tick = (timestamp) => {
        if (previous !== null) frames.push({ frame_index: frames.length, frame_ms: timestamp - previous, timestamp_ms: timestamp });
        previous = timestamp;
        if (frames.length >= config.minFrames) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return frames;
  }

  window.__V4_CAPTURE_SAMPLE__ = async function v4CaptureSample() {
    const frameSamples = await sampleFrames();
    const canvas = document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : null;
    const perfMemory = performance?.memory || null;
    const compactState = (state) => state ? {
      sceneId: state.sceneId || null,
      rendererMode: state.rendererMode || state.mode || null,
      active: state.active === true,
      webgpuActive: state.webgpuActive === true,
      frame: state.frame || null,
      frameSubmitted: state.frameSubmitted === true,
      validationErrors: Array.isArray(state.validationErrors) ? state.validationErrors : [],
      webgpuValidationErrors: Array.isArray(state.webgpuValidationErrors) ? state.webgpuValidationErrors : [],
    } : null;
    return {
      config,
      frameSamples,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dpr: window.devicePixelRatio,
      backing: canvas ? { width: canvas.width, height: canvas.height, cssWidth: rect?.width ?? null, cssHeight: rect?.height ?? null } : null,
      browser: {
        userAgent: navigator.userAgent || '',
        platform: navigator.platform || '',
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemory: navigator.deviceMemory || null,
      },
      consoleLogs: consoleLogs.slice(),
      exportedState: {
        v4RuntimeSmoke: window.__V4_RUNTIME_SMOKE__ || null,
        v4HeroLab: window.__V4_HERO_LAB__ || null,
        v4CathedralWebGPU: compactState(window.__V4_CATHEDRAL_WEBGPU__),
        v4FilamentWebGPU: compactState(window.__V4_FILAMENT_WEBGPU__),
        v4VoxelWebGPU: compactState(window.__V4_VOXEL_WEBGPU__),
        v4HistoryTrails: compactState(window.__V4_HISTORY_TRAILS__),
        v4CaptureConfig: window.__V4_CAPTURE_CONFIG__,
        locationSearch: window.location.search,
      },
      memory: { jsHeapUsedMB: perfMemory ? perfMemory.usedJSHeapSize / 1048576 : null },
      gpuTiming: { frameMs: null, unknownReason: 'WebGPU timestamp queries unavailable to this harness' },
      gpuMemory: { mb: null, unknownReason: 'Browser GPU memory unavailable to page JavaScript' },
    };
  };
  return window.__V4_CAPTURE_SAMPLE__;
}

if (typeof window !== 'undefined') {
  window.installV4CaptureHarness = installV4CaptureHarness;
}
