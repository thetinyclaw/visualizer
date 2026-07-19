// Visualizer v4 renderer capability probing.
// Browser-native ES module with deterministic mode selection and sanitized public errors.

export const RENDERER_MODES = Object.freeze({
  WEBGPU_FULL: 'webgpu-full',
  WEBGPU_REDUCED: 'webgpu-reduced',
  WEBGL2_LEGACY: 'webgl2-legacy',
});

const FULL_WEBGPU_FEATURES = Object.freeze([
  'texture-compression-bc',
]);

const OPTIONAL_TELEMETRY_FEATURES = Object.freeze(['timestamp-query']);

const REDUCED_WEBGPU_LIMITS = Object.freeze({
  minStorageBuffersPerShaderStage: 4,
  minStorageBufferBindingSize: 1 << 20,
});

function publicError(code, message) {
  return Object.freeze({ code, message });
}

function hasFeature(adapter, feature) {
  return Boolean(adapter && adapter.features && adapter.features.has && adapter.features.has(feature));
}

function hasReducedLimits(adapter) {
  const limits = adapter && adapter.limits;
  if (!limits) return false;
  return (limits.maxStorageBuffersPerShaderStage || 0) >= REDUCED_WEBGPU_LIMITS.minStorageBuffersPerShaderStage &&
    (limits.maxStorageBufferBindingSize || 0) >= REDUCED_WEBGPU_LIMITS.minStorageBufferBindingSize;
}

export async function probeRenderer({ navigatorObject = globalThis.navigator, canvas = null, fallbackCanvas = null } = {}) {
  const result = {
    mode: RENDERER_MODES.WEBGL2_LEGACY,
    webgpu: null,
    webgl2: null,
    errors: [],
  };

  if (navigatorObject && navigatorObject.gpu && typeof navigatorObject.gpu.requestAdapter === 'function') {
    try {
      const adapter = await navigatorObject.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter && hasReducedLimits(adapter)) {
        const fullFeatures = FULL_WEBGPU_FEATURES.filter((feature) => hasFeature(adapter, feature));
        const telemetryFeatures = OPTIONAL_TELEMETRY_FEATURES.filter((feature) => hasFeature(adapter, feature));
        let requiredFeatures = [...fullFeatures, ...telemetryFeatures];
        let device;
        let telemetryUnavailableReason = telemetryFeatures.includes('timestamp-query') ? null : 'timestamp-query-feature-unavailable';
        try {
          device = await adapter.requestDevice({ requiredFeatures });
        } catch (error) {
          if (!telemetryFeatures.includes('timestamp-query')) throw error;
          telemetryUnavailableReason = 'timestamp-query-device-request-failed';
          requiredFeatures = fullFeatures;
          device = await adapter.requestDevice({ requiredFeatures: fullFeatures });
        }
        const hasFullFeatures = FULL_WEBGPU_FEATURES.every((feature) => hasFeature(adapter, feature));
        result.mode = hasFullFeatures ? RENDERER_MODES.WEBGPU_FULL : RENDERER_MODES.WEBGPU_REDUCED;
        result.webgpu = {
          adapter,
          device,
          requiredFeatures,
          fullFeatures,
          telemetryFeatures: telemetryUnavailableReason ? [] : telemetryFeatures,
          telemetry: Object.freeze({
            timestampQuerySupported: !telemetryUnavailableReason,
            unavailableReason: telemetryUnavailableReason,
            requestedFeatures: Object.freeze(telemetryUnavailableReason ? [] : telemetryFeatures),
          }),
          limits: adapter.limits,
        };
        return Object.freeze(result);
      }
      result.errors.push(publicError('webgpu-insufficient-limits', 'WebGPU adapter lacks the reduced runtime limits.'));
    } catch (error) {
      result.errors.push(publicError('webgpu-request-failed', 'WebGPU initialization failed; falling back safely.'));
    }
  } else {
    result.errors.push(publicError('webgpu-unavailable', 'WebGPU is not available in this browser.'));
  }

  const webglCanvas = fallbackCanvas || canvas;
  if (webglCanvas && typeof webglCanvas.getContext === 'function') {
    // Prefer a separate fallbackCanvas so canvas.getContext('webgl2') does not prevent later 2D status drawing on the visible canvas.
    const gl2 = webglCanvas.getContext('webgl2', { antialias: false, alpha: false });
    result.webgl2 = gl2 ? { context: gl2 } : null;
    if (!gl2) result.errors.push(publicError('webgl2-unavailable', 'WebGL2 legacy renderer is unavailable.'));
  }

  return Object.freeze(result);
}

export function describeRendererMode(mode) {
  switch (mode) {
    case RENDERER_MODES.WEBGPU_FULL:
      return 'Full WebGPU runtime';
    case RENDERER_MODES.WEBGPU_REDUCED:
      return 'Reduced WebGPU runtime';
    case RENDERER_MODES.WEBGL2_LEGACY:
      return 'WebGL2 legacy renderer';
    default:
      return 'Unknown renderer';
  }
}
