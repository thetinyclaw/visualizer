// Minimal executable WebGPU render-graph submission for the v4 runtime foundation.

const RENDER_ATTACHMENT = globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10;

function assertExecutableInputs(device, canvas, graph) {
  if (!device || typeof device.createCommandEncoder !== 'function' || !device.queue || typeof device.queue.submit !== 'function') {
    throw new TypeError('WebGpuGraphExecutor requires a GPUDevice-compatible object.');
  }
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('WebGpuGraphExecutor requires a canvas.');
  if (!graph || !Array.isArray(graph.passes) || !graph.passes.some((pass) => pass.kind === 'composite' && (pass.output || 'swapchain') === 'swapchain')) {
    throw new TypeError('Executable render graph requires a swapchain composite pass.');
  }
}

export class WebGpuGraphExecutor {
  constructor({ device, canvas, graph, format = 'bgra8unorm' } = {}) {
    assertExecutableInputs(device, canvas, graph);
    const context = canvas.getContext('webgpu');
    if (!context || typeof context.configure !== 'function' || typeof context.getCurrentTexture !== 'function') {
      throw new Error('WebGPU canvas context is unavailable.');
    }
    this.device = device;
    this.canvas = canvas;
    this.graph = graph;
    this.context = context;
    this.format = format;
    this.depthTexture = null;
    this.width = 0;
    this.height = 0;
    this.disposed = false;
    this.context.configure({ device, format, alphaMode: 'opaque' });
    this.resizeTargets();
  }

  resizeTargets() {
    const width = Math.max(1, this.canvas.width | 0);
    const height = Math.max(1, this.canvas.height | 0);
    if (this.depthTexture && width === this.width && height === this.height) return;
    if (this.depthTexture && typeof this.depthTexture.destroy === 'function') this.depthTexture.destroy();
    this.width = width;
    this.height = height;
    this.depthTexture = this.device.createTexture({
      label: `${this.graph.id}:scene-depth`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'depth24plus',
      usage: RENDER_ATTACHMENT,
    });
  }

  render({ clearColor = { r: 0.015, g: 0.025, b: 0.055, a: 1 } } = {}) {
    if (this.disposed) throw new Error('WebGPU graph executor is disposed.');
    this.resizeTargets();
    const encoder = this.device.createCommandEncoder({ label: `${this.graph.id}:frame` });
    const pass = encoder.beginRenderPass({
      label: `${this.graph.id}:composite`,
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: clearColor,
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return Object.freeze({ submitted: true, width: this.width, height: this.height, graphId: this.graph.id });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.depthTexture && typeof this.depthTexture.destroy === 'function') this.depthTexture.destroy();
    this.depthTexture = null;
    if (typeof this.context.unconfigure === 'function') this.context.unconfigure();
  }
}
