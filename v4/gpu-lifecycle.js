// Recoverable WebGPU device/resource lifecycle for Visualizer v4.

export const GPU_LIFECYCLE_STATES = Object.freeze({
  IDLE: 'idle',
  REQUESTING: 'requesting-device',
  READY: 'ready',
  LOST: 'device-lost',
  RETRYING: 'retrying',
  FALLBACK: 'fallback-required',
  DISPOSED: 'disposed',
});

function sanitizeDeviceLoss(reason) {
  if (reason === 'destroyed') return 'device-destroyed';
  if (reason === 'unknown') return 'device-lost';
  return 'device-lost';
}

export class GpuLifecycle {
  constructor({ maxRetries = 2, retryDelayMs = 250, onStateChange = () => {}, retryScheduler = null } = {}) {
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
    this.onStateChange = onStateChange;
    this.state = GPU_LIFECYCLE_STATES.IDLE;
    this.device = null;
    this.retryCount = 0;
    this.generation = 0;
    this.lifecycleEpoch = 0;
    this.resources = new Set();
    this.disposed = false;
    this.retryScheduler = retryScheduler || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  resetLossBudget(reason = 'explicit-reset-boundary') {
    this.lifecycleEpoch += 1;
    this.retryCount = 0;
    this.transition(this.state, { budgetReset: reason });
  }

  transition(state, detail = {}) {
    this.state = state;
    this.onStateChange(Object.freeze({ state, generation: this.generation, lifecycleEpoch: this.lifecycleEpoch, retryCount: this.retryCount, ...detail }));
  }

  async acquire(requestDevice, retryToken = null) {
    if (this.disposed) return null;
    if (!retryToken) this.lifecycleEpoch += 1;
    if (!this.isRetryTokenCurrent(retryToken)) return null;
    this.transition(GPU_LIFECYCLE_STATES.REQUESTING);
    try {
      const device = await requestDevice();
      if (this.disposed || !this.isRetryTokenCurrent(retryToken)) {
        if (device && typeof device.destroy === 'function') device.destroy();
        return null;
      }
      if (!device) throw new Error('No GPU device returned.');
      this.device = device;
      this.generation += 1;
      this.transition(GPU_LIFECYCLE_STATES.READY);
      this.watchDeviceLoss(device, requestDevice, this.generation);
      return device;
    } catch (error) {
      this.transition(GPU_LIFECYCLE_STATES.FALLBACK, { publicError: 'gpu-device-request-failed' });
      return null;
    }
  }

  isRetryTokenCurrent(retryToken) {
    if (!retryToken) return true;
    return !this.disposed &&
      retryToken.generation === this.generation &&
      retryToken.lifecycleEpoch === this.lifecycleEpoch;
  }

  registerResource(resource) {
    if (!resource || typeof resource.dispose !== 'function') {
      throw new TypeError('GPU lifecycle resources must expose dispose().');
    }
    this.resources.add(resource);
    return () => this.resources.delete(resource);
  }

  disposeResources() {
    for (const resource of this.resources) {
      try { resource.dispose(); } catch (error) { /* public lifecycle never leaks raw errors */ }
    }
    this.resources.clear();
  }

  watchDeviceLoss(device, requestDevice, generation) {
    if (!device || !device.lost || typeof device.lost.then !== 'function') return;
    device.lost.then((info) => {
      if (this.disposed || generation !== this.generation) return;
      this.handleDeviceLoss(info, requestDevice);
    });
  }

  async handleDeviceLoss(info, requestDevice) {
    this.disposeResources();
    this.device = null;
    this.transition(GPU_LIFECYCLE_STATES.LOST, { publicError: sanitizeDeviceLoss(info && info.reason) });
    if (this.retryCount >= this.maxRetries) {
      this.transition(GPU_LIFECYCLE_STATES.FALLBACK, { publicError: 'gpu-retry-limit-exceeded' });
      return null;
    }
    this.retryCount += 1;
    const retryToken = Object.freeze({ generation: this.generation, lifecycleEpoch: this.lifecycleEpoch });
    this.transition(GPU_LIFECYCLE_STATES.RETRYING);
    await this.retryScheduler(this.retryDelayMs);
    if (!this.isRetryTokenCurrent(retryToken)) return null;
    return this.acquire(requestDevice, retryToken);
  }

  dispose() {
    this.disposed = true;
    this.lifecycleEpoch += 1;
    this.disposeResources();
    if (this.device && typeof this.device.destroy === 'function') this.device.destroy();
    this.device = null;
    this.transition(GPU_LIFECYCLE_STATES.DISPOSED);
  }
}
