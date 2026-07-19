// Narrow executable WebGPU render-graph foundation for authored draw/dispatch passes.

const RENDER_ATTACHMENT = globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10;
const TEXTURE_BINDING = globalThis.GPUTextureUsage?.TEXTURE_BINDING ?? 0x04;
const COPY_SRC = globalThis.GPUTextureUsage?.COPY_SRC ?? 0x01;

const EXECUTABLE_PASS_KINDS = new Set(['render', 'compute', 'post', 'history', 'composite']);
const DEFAULT_CLEAR = Object.freeze({ r: 0.015, g: 0.025, b: 0.055, a: 1 });

function fail(message) {
  const error = new Error(message);
  error.code = 'render-graph-compile-failed';
  return error;
}

function assertExecutableInputs(device, canvas, graph) {
  if (!device || typeof device.createCommandEncoder !== 'function' || !device.queue || typeof device.queue.submit !== 'function') {
    throw new TypeError('WebGpuGraphExecutor requires a GPUDevice-compatible object.');
  }
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('WebGpuGraphExecutor requires a canvas.');
  if (!graph || !Array.isArray(graph.passes)) throw new TypeError('Executable render graph requires authored passes.');
}

function clampDpr(value, cap) {
  const raw = Number.isFinite(value) ? value : 1;
  return Math.max(1, Math.min(raw || 1, cap));
}

function finiteLayoutPair(width, height) {
  const measuredWidth = Number(width);
  const measuredHeight = Number(height);
  if (!Number.isFinite(measuredWidth) || !Number.isFinite(measuredHeight)) return null;
  return { width: measuredWidth, height: measuredHeight };
}

function cssPixelSize(canvas) {
  const rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
  const rectSize = rect ? finiteLayoutPair(rect.width, rect.height) : null;
  if (rectSize) {
    const width = Math.floor(rectSize.width);
    const height = Math.floor(rectSize.height);
    if (width <= 0 || height <= 0) return { width: 0, height: 0, reason: 'layout-reports-zero', source: 'getBoundingClientRect' };
    return { width, height, reason: 'layout-available', source: 'getBoundingClientRect' };
  }

  const hasClientLayout = 'clientWidth' in canvas || 'clientHeight' in canvas;
  if (hasClientLayout) {
    const clientSize = finiteLayoutPair(canvas.clientWidth, canvas.clientHeight);
    if (!clientSize) return { width: 0, height: 0, reason: 'layout-reports-zero', source: 'client-size' };
    const width = Math.floor(clientSize.width);
    const height = Math.floor(clientSize.height);
    if (width <= 0 || height <= 0) return { width: 0, height: 0, reason: 'layout-reports-zero', source: 'client-size' };
    return { width, height, reason: 'layout-available', source: 'client-size' };
  }

  const attrWidth = Math.floor(Number(canvas.width) || 0);
  const attrHeight = Math.floor(Number(canvas.height) || 0);
  return { width: Math.max(0, attrWidth), height: Math.max(0, attrHeight), reason: 'layout-unavailable', source: 'backing-attributes' };
}

const RESOURCE_ALIAS_FIELDS = Object.freeze(['aliasOf', 'viewOf', 'resourceId', 'sourceResource', 'targetResource']);

function resourceAliasTarget(resource) {
  for (const field of RESOURCE_ALIAS_FIELDS) {
    if (typeof resource?.[field] === 'string' && resource[field].length > 0) return resource[field];
  }
  return null;
}

function canonicalResourceId(id, descriptors) {
  if (id === 'swapchain') return 'swapchain';
  let current = id;
  const seen = new Set();
  while (typeof current === 'string' && descriptors.has(current) && !seen.has(current)) {
    seen.add(current);
    const next = resourceAliasTarget(descriptors.get(current));
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

function assertNoPostReadWriteHazard(pass, descriptors) {
  if (pass.kind !== 'post') return;
  const outputIdentity = canonicalResourceId(pass.output, descriptors);
  if ((pass.inputs || []).some((input) => canonicalResourceId(input, descriptors) === outputIdentity)) {
    throw fail(`Pass ${pass.id} post pass cannot sample from and render into the same target.`);
  }
}

function assertHistoryContract(pass, descriptors) {
  if (pass.kind !== 'history') return;
  const history = descriptors.get(pass.history);
  if (!history || history.type !== 'history-target') throw fail(`Pass ${pass.id} requires a history-target resource.`);
  if (!history.previous || !history.next || history.previous === history.next) throw fail(`Pass ${pass.id} history previous/next targets must be distinct.`);
  const sourceIdentity = canonicalResourceId(pass.source, descriptors);
  if (sourceIdentity === history.previous || sourceIdentity === history.next || sourceIdentity === canonicalResourceId(pass.history, descriptors)) {
    throw fail(`Pass ${pass.id} history source must not alias ping-pong targets.`);
  }
}

function bindPassResources(passEncoder, resources, graphPass) {
  for (const [slot, id] of (graphPass.resources || []).entries()) {
    const resource = resources.get(id);
    if (!resource) throw fail(`Pass ${graphPass.id} references missing bind resource ${id}.`);
    if (typeof passEncoder.setBindGroup === 'function') passEncoder.setBindGroup(slot, resource);
  }
}

function pipelineBindGroupCount(pipeline) {
  const count = pipeline?.layoutBindGroupCount ?? pipeline?.bindGroupLayoutCount ?? pipeline?.layout?.bindGroupLayouts?.length;
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function bindSlotCheckedPass(passEncoder, pipeline, passId) {
  const maxGroups = pipelineBindGroupCount(pipeline);
  if (maxGroups === null || typeof passEncoder?.setBindGroup !== 'function') return passEncoder;
  return Object.create(passEncoder, {
    setBindGroup: {
      value(slot, ...rest) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= maxGroups) {
          throw fail(`Pass ${passId} setBindGroup(${slot}) exceeds pipeline layout bind group count ${maxGroups}.`);
        }
        return passEncoder.setBindGroup(slot, ...rest);
      },
    },
  });
}

export class WebGpuGraphExecutor {
  constructor({
    device,
    canvas,
    graph,
    format = 'bgra8unorm',
    resources = {},
    pipelines = {},
    executors = {},
    dprCap = 2,
    windowObject = globalThis,
  } = {}) {
    assertExecutableInputs(device, canvas, graph);
    const context = canvas.getContext('webgpu');
    if (!context || typeof context.configure !== 'function' || typeof context.getCurrentTexture !== 'function') throw new Error('WebGPU canvas context is unavailable.');
    this.device = device;
    this.canvas = canvas;
    this.graph = graph;
    this.context = context;
    this.format = format;
    this.resourceRegistry = resources instanceof Map ? resources : new Map(Object.entries(resources));
    this.pipelineRegistry = pipelines instanceof Map ? pipelines : new Map(Object.entries(pipelines));
    this.executorRegistry = executors instanceof Map ? executors : new Map(Object.entries(executors));
    this.dprCap = dprCap;
    this.windowObject = windowObject;
    this.ownedTextures = new Map();
    this.fullscreenSampler = null;
    this.autoBindGroups = new Map();
    this.historyStates = new Map();
    this.textureGeneration = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.lastCanvasSize = Object.freeze({ width: 0, height: 0, reason: 'not-measured', source: 'none' });
    this.disposed = false;
    this.context.configure({ device, format, alphaMode: 'opaque' });
    this.compiledPasses = this.compile(graph);
    this.resizeTargets();
  }

  compile(graph) {
    const validation = typeof graph.validate === 'function' ? graph.validate() : { ok: true, errors: [] };
    if (!validation.ok) throw fail(`Invalid render graph: ${validation.errors.join('; ')}`);
    const hasComposite = graph.passes.some((pass) => pass.kind === 'composite' && (pass.output || 'swapchain') === 'swapchain');
    if (!hasComposite) throw fail('Executable render graph requires an explicit swapchain composite pass.');
    const descriptors = new Map((graph.resources || []).map((resource) => [resource.id, resource]));
    const resolvePipeline = (id, pass) => {
      if (typeof id !== 'string' || id.length === 0) throw fail(`Pass ${pass.id} requires a pipeline.`);
      const pipeline = this.pipelineRegistry.get(id);
      if (!pipeline) throw fail(`Pass ${pass.id} references missing pipeline ${id}.`);
      return pipeline;
    };
    const resolveResource = (id, pass) => {
      if (id === 'swapchain') return 'swapchain';
      const descriptor = descriptors.get(id);
      if (!descriptor) throw fail(`Pass ${pass.id} references graph resource ${id} that is not declared.`);
      const resource = this.resourceRegistry.get(id);
      if (!resource && !['render-target', 'depth-target', 'instanced-depth-target', 'history-target'].includes(descriptor.type)) throw fail(`Pass ${pass.id} references missing executable resource ${id}.`);
      return resource || descriptor;
    };
    const resolveExecutor = (name, pass) => {
      if (!name) return null;
      const executor = typeof name === 'function' ? name : this.executorRegistry.get(name);
      if (typeof executor !== 'function') throw fail(`Pass ${pass.id} references missing executor ${name}.`);
      return executor;
    };
    return graph.passes.map((pass) => {
      if (!EXECUTABLE_PASS_KINDS.has(pass.kind)) throw fail(`Pass ${pass.id} kind ${pass.kind} is not executable in this foundation.`);
      assertNoPostReadWriteHazard(pass, descriptors);
      assertHistoryContract(pass, descriptors);
      if (pass.kind === 'compute') {
        const pipeline = resolvePipeline(pass.pipeline, pass);
        const executor = resolveExecutor(pass.executor, pass);
        const resources = [...(pass.inputs || []), ...(pass.outputs || []), ...(pass.resources || [])].map((id) => [id, resolveResource(id, pass)]);
        return Object.freeze({ kind: 'compute', pass, pipeline, executor, resources: new Map(resources) });
      }
      if (pass.kind === 'render') {
        const pipeline = resolvePipeline(pass.pipeline, pass);
        const executor = resolveExecutor(pass.executor, pass);
        if (!executor && !pass.draw && !pass.drawIndexed) throw fail(`Pass ${pass.id} must provide draw, drawIndexed, or executor.`);
        for (const id of [...(pass.resources || []), ...(pass.vertexBuffers || []), ...(pass.indexBuffer ? [pass.indexBuffer] : [])]) resolveResource(id, pass);
        return Object.freeze({ kind: 'render', pass, pipeline, executor });
      }
      if (pass.kind === 'post') {
        if (pass.history !== null) throw fail(`Pass ${pass.id} history post mode is not executable in this foundation.`);
        const pipeline = resolvePipeline(pass.pipeline, pass);
        const executor = resolveExecutor(pass.executor, pass);
        for (const id of [...(pass.inputs || []), pass.output, ...(pass.resources || [])]) resolveResource(id, pass);
        return Object.freeze({ kind: 'post', pass, pipeline, executor });
      }
      if (pass.kind === 'history') {
        const pipeline = resolvePipeline(pass.pipeline, pass);
        const executor = resolveExecutor(pass.executor, pass);
        for (const id of [pass.source, pass.history, ...(pass.resources || [])]) resolveResource(id, pass);
        return Object.freeze({ kind: 'history', pass, pipeline, executor });
      }
      if (pass.kind === 'composite') {
        if ((pass.output || 'swapchain') !== 'swapchain') throw fail(`Pass ${pass.id} composite output must be swapchain.`);
        const pipeline = pass.pipeline ? resolvePipeline(pass.pipeline, pass) : null;
        const executor = resolveExecutor(pass.executor, pass);
        if ((pass.draw || pass.executor) && !pipeline) throw fail(`Pass ${pass.id} composite draw requires a pipeline.`);
        for (const id of [...(pass.layers || []), ...(pass.resources || [])]) resolveResource(id, pass);
        return Object.freeze({ kind: 'composite', pass, pipeline, executor });
      }
      throw fail(`Pass ${pass.id} kind ${pass.kind} is not executable.`);
    });
  }

  syncCanvasSize() {
    const measurement = cssPixelSize(this.canvas);
    this.lastCanvasSize = measurement;
    const { width: cssWidth, height: cssHeight } = measurement;
    if (cssWidth === 0 || cssHeight === 0) return false;
    const devicePixelRatio = this.windowObject?.devicePixelRatio || globalThis.devicePixelRatio || 1;
    const dpr = clampDpr(devicePixelRatio, this.dprCap);
    const width = Math.max(1, Math.floor(cssWidth * dpr));
    const height = Math.max(1, Math.floor(cssHeight * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.width = width; this.height = height; this.dpr = dpr;
    return true;
  }

  resizeTargets() {
    if (!this.syncCanvasSize()) return false;
    let recreated = false;
    for (const resource of this.graph.resources || []) {
      if (!resource.canvasSized || !['render-target', 'depth-target', 'instanced-depth-target', 'history-target'].includes(resource.type)) continue;
      if (resource.type === 'history-target') {
        recreated = this.ensureHistoryTargets(resource) || recreated;
        continue;
      }
      const existing = this.ownedTextures.get(resource.id);
      if (existing && existing.width === this.width && existing.height === this.height) continue;
      if (existing?.texture && typeof existing.texture.destroy === 'function') existing.texture.destroy();
      this.textureGeneration += 1;
      const texture = this.device.createTexture({
        label: `${this.graph.id}:${resource.id}`,
        size: { width: this.width, height: this.height, depthOrArrayLayers: 1 },
        format: resource.format || (resource.type === 'render-target' ? this.format : 'depth24plus'),
        usage: resource.type === 'render-target' ? (RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC) : RENDER_ATTACHMENT,
      });
      this.ownedTextures.set(resource.id, { texture, width: this.width, height: this.height });
      recreated = true;
    }
    if (recreated) this.recreateAutoBindGroups();
    return true;
  }

  ensureHistoryTargets(resource) {
    const existing = this.historyStates.get(resource.id);
    if (existing && existing.width === this.width && existing.height === this.height) return false;
    if (existing) {
      for (const texture of [existing.previousTexture, existing.nextTexture]) if (texture && typeof texture.destroy === 'function') texture.destroy();
    }
    const makeDescriptor = (role) => ({
      label: `${this.graph.id}:${resource.id}:${role}`,
      size: { width: this.width, height: this.height, depthOrArrayLayers: 1 },
      format: resource.format || this.format,
      usage: RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC,
    });
    const previousTexture = this.device.createTexture(makeDescriptor('previous'));
    const nextTexture = this.device.createTexture(makeDescriptor('next'));
    this.textureGeneration += 1;
    this.historyStates.set(resource.id, {
      id: resource.id,
      descriptor: resource,
      previousTexture,
      nextTexture,
      previousRole: 'previous',
      nextRole: 'next',
      width: this.width,
      height: this.height,
      parity: 0,
      swapCount: 0,
      resetCount: (existing?.resetCount || 0) + 1,
      pendingReset: true,
      pendingSwap: false,
      resetReason: existing ? 'resize' : 'first-frame',
    });
    return true;
  }

  historyState(id) {
    const state = this.historyStates.get(id);
    if (!state) throw fail(`History resource ${id} is not allocated.`);
    return state;
  }

  requestHistoryReset(id, reason = 'external-reset') {
    const state = this.historyStates.get(id);
    if (!state) return false;
    state.pendingReset = true;
    state.resetCount += 1;
    state.resetReason = reason;
    this.textureGeneration += 1;
    this.recreateAutoBindGroups();
    return true;
  }

  historyDiagnostics() {
    return Object.freeze([...this.historyStates.values()].map((state) => Object.freeze({
      id: state.id,
      parity: state.parity,
      swapCount: state.swapCount,
      resetCount: state.resetCount,
      pendingReset: state.pendingReset,
      decay: state.descriptor.decay,
      width: state.width,
      height: state.height,
      previousRole: state.previousRole,
      nextRole: state.nextRole,
      textureGeneration: this.textureGeneration,
    })));
  }

  ensureFullscreenSampler() {
    if (!this.fullscreenSampler) this.fullscreenSampler = this.device.createSampler ? this.device.createSampler({ label: `${this.graph.id}:fullscreen-linear`, magFilter: 'linear', minFilter: 'linear' }) : null;
    return this.fullscreenSampler;
  }

  recreateAutoBindGroups() {
    this.autoBindGroups.clear();
    for (const compiled of this.compiledPasses || []) {
      // Passes with a custom executor own their complete binding contract. The
      // generic fullscreen layout (sampler at 0, texture at 1) must not be
      // imposed on scene-specific pipelines with different layouts.
      if (compiled.executor || !['post', 'composite'].includes(compiled.kind) || !compiled.pipeline || typeof compiled.pipeline.getBindGroupLayout !== 'function' || typeof this.device.createBindGroup !== 'function') continue;
      const sourceIds = compiled.kind === 'post' ? (compiled.pass.inputs || []) : (compiled.pass.layers || []);
      if (sourceIds.length !== 1) throw fail(`Pass ${compiled.pass.id} requires exactly one sampled source in this foundation.`);
      if (this.historyStates.has(sourceIds[0])) continue;
      const sampler = this.ensureFullscreenSampler();
      const view = this.textureView(sourceIds[0]);
      if (!sampler || !view) throw fail(`Pass ${compiled.pass.id} cannot create fullscreen bind group.`);
      this.autoBindGroups.set(compiled.pass.id, this.device.createBindGroup({
        label: `${this.graph.id}:${compiled.pass.id}:fullscreen-bind-group`,
        layout: compiled.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: view }],
      }));
    }
  }

  textureView(id) {
    if (id === 'swapchain') return this.context.getCurrentTexture().createView();
    if (this.historyStates.has(id)) return this.historyState(id).nextTexture.createView();
    const owned = this.ownedTextures.get(id)?.texture;
    const registered = this.resourceRegistry.get(id);
    const texture = owned || registered;
    if (!texture || typeof texture.createView !== 'function') throw fail(`Resource ${id} is not a texture view source.`);
    return texture.createView();
  }

  historyTextureView(id, role) {
    const state = this.historyState(id);
    const texture = role === 'previous' ? state.previousTexture : state.nextTexture;
    return texture.createView();
  }

  encodeHistoryResetIfNeeded(encoder, state, clearColor) {
    if (!state.pendingReset) return;
    for (const texture of [state.previousTexture, state.nextTexture]) {
      const pass = encoder.beginRenderPass({
        label: `${this.graph.id}:${state.id}:history-reset-clear`,
        colorAttachments: [{ view: texture.createView(), clearValue: clearColor || { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      pass.end();
    }
  }

  dynamicHistoryBindGroup(compiled) {
    if (compiled.executor || compiled.kind !== 'composite' || !compiled.pipeline || typeof compiled.pipeline.getBindGroupLayout !== 'function' || typeof this.device.createBindGroup !== 'function') return null;
    const sourceIds = compiled.pass.layers || [];
    if (sourceIds.length !== 1 || !this.historyStates.has(sourceIds[0])) return null;
    const state = this.historyState(sourceIds[0]);
    const key = `${compiled.pass.id}:${sourceIds[0]}:${this.textureGeneration}:${state.parity}`;
    const cached = this.autoBindGroups.get(key);
    if (cached) return cached;
    const sampler = this.ensureFullscreenSampler();
    const view = this.textureView(sourceIds[0]);
    const bindGroup = this.device.createBindGroup({
      label: `${this.graph.id}:${compiled.pass.id}:history-bind-group:${state.parity}`,
      layout: compiled.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: view }],
    });
    this.autoBindGroups.set(key, bindGroup);
    return bindGroup;
  }

  encodeCompute(encoder, compiled, frameContext) {
    const passEncoder = encoder.beginComputePass ? encoder.beginComputePass({ label: `${this.graph.id}:${compiled.pass.id}` }) : null;
    if (!passEncoder) throw fail(`Compute pass ${compiled.pass.id} is not supported by this device.`);
    passEncoder.setPipeline(compiled.pipeline);
    bindPassResources(passEncoder, this.resourceRegistry, compiled.pass);
    if (compiled.executor) compiled.executor({ pass: bindSlotCheckedPass(passEncoder, compiled.pipeline, compiled.pass.id), device: this.device, resources: compiled.resources, frameContext, graphPass: compiled.pass, executor: this });
    const [x, y = 1, z = 1] = compiled.pass.workgroups;
    passEncoder.dispatchWorkgroups(x, y, z);
    passEncoder.end();
  }

  encodeRenderLike(encoder, compiled, frameContext) {
    const passDef = compiled.pass;
    const colorIds = compiled.kind === 'composite' ? ['swapchain'] : (compiled.kind === 'post' ? [passDef.output] : (compiled.kind === 'history' ? [passDef.history] : passDef.colorTargets));
    if (compiled.kind === 'history') this.encodeHistoryResetIfNeeded(encoder, this.historyState(passDef.history), passDef.clearColor);
    const descriptor = {
      label: `${this.graph.id}:${passDef.id}`,
      colorAttachments: colorIds.map((id, index) => ({
        view: this.textureView(id),
        clearValue: passDef.clearColor || (index === 0 ? DEFAULT_CLEAR : { r: 0, g: 0, b: 0, a: 0 }),
        loadOp: 'clear',
        storeOp: 'store',
      })),
    };
    if (passDef.depthTarget) {
      descriptor.depthStencilAttachment = { view: this.textureView(passDef.depthTarget), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' };
    }
    const passEncoder = encoder.beginRenderPass(descriptor);
    if (compiled.pipeline) passEncoder.setPipeline(compiled.pipeline);
    const autoBindGroup = this.autoBindGroups.get(passDef.id) || this.dynamicHistoryBindGroup(compiled);
    if (autoBindGroup && typeof passEncoder.setBindGroup === 'function') passEncoder.setBindGroup(0, autoBindGroup);
    bindPassResources(passEncoder, this.resourceRegistry, passDef);
    for (const [slot, id] of (passDef.vertexBuffers || []).entries()) passEncoder.setVertexBuffer(slot, this.resourceRegistry.get(id));
    if (passDef.indexBuffer) passEncoder.setIndexBuffer(this.resourceRegistry.get(passDef.indexBuffer), passDef.indexFormat || 'uint32');
    const callbackContext = compiled.kind === 'history'
      ? { ...frameContext, history: this.historyState(passDef.history), historyReset: this.historyState(passDef.history).pendingReset }
      : frameContext;
    if (compiled.executor) compiled.executor({ pass: bindSlotCheckedPass(passEncoder, compiled.pipeline, passDef.id), device: this.device, resources: this.resourceRegistry, frameContext: callbackContext, graphPass: passDef, executor: this });
    if (passDef.drawIndexed) passEncoder.drawIndexed(...passDef.drawIndexed);
    else if (passDef.draw) passEncoder.draw(...passDef.draw);
    else if (compiled.kind === 'post' || compiled.kind === 'history' || compiled.kind === 'composite') passEncoder.draw(3, 1, 0, 0);
    passEncoder.end();
  }

  render(frameContext = {}) {
    if (this.disposed) throw new Error('WebGPU graph executor is disposed.');
    if (!this.resizeTargets()) {
      const measurement = this.lastCanvasSize || { reason: 'zero-size', source: 'unknown' };
      return Object.freeze({ submitted: false, skipped: 'zero-size', reason: measurement.reason, source: measurement.source, width: 0, height: 0, graphId: this.graph.id });
    }
    const encoder = this.device.createCommandEncoder({ label: `${this.graph.id}:frame` });
    const executed = [];
    const pendingHistorySwaps = [];
    for (const compiled of this.compiledPasses) {
      if (compiled.kind === 'compute') this.encodeCompute(encoder, compiled, frameContext);
      else {
        this.encodeRenderLike(encoder, compiled, frameContext);
        if (compiled.kind === 'history') {
          const state = this.historyState(compiled.pass.history);
          state.pendingSwap = true;
          pendingHistorySwaps.push(state);
        }
      }
      executed.push(compiled.pass.id);
    }
    this.device.queue.submit([encoder.finish()]);
    for (const state of pendingHistorySwaps) {
      const oldPrevious = state.previousTexture;
      state.previousTexture = state.nextTexture;
      state.nextTexture = oldPrevious;
      const oldRole = state.previousRole;
      state.previousRole = state.nextRole;
      state.nextRole = oldRole;
      state.parity = 1 - state.parity;
      state.swapCount += 1;
      state.pendingReset = false;
      state.pendingSwap = false;
    }
    for (const callback of frameContext.afterSubmit || []) callback();
    return Object.freeze({ submitted: true, width: this.width, height: this.height, dpr: this.dpr, graphId: this.graph.id, passes: Object.freeze(executed) });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.ownedTextures.values()) if (entry.texture && typeof entry.texture.destroy === 'function') entry.texture.destroy();
    for (const state of this.historyStates.values()) {
      for (const texture of [state.previousTexture, state.nextTexture]) if (texture && typeof texture.destroy === 'function') texture.destroy();
    }
    this.ownedTextures.clear();
    this.historyStates.clear();
    this.autoBindGroups.clear();
    this.fullscreenSampler = null;
    this.textureGeneration += 1;
    if (typeof this.context.unconfigure === 'function') this.context.unconfigure();
  }
}
