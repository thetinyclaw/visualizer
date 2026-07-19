import assert from 'node:assert/strict';
import { probeRenderer, RENDERER_MODES } from '../v4/capability.js';
import { GpuLifecycle, GPU_LIFECYCLE_STATES } from '../v4/gpu-lifecycle.js';
import { RenderGraph, storageBuffer, uniformBuffer, vertexBuffer, indexBuffer, renderTarget, depthTarget, historyTarget, instancedDepthTarget, computePass, renderPass, boundedVolumePass, feedbackPass, postPass, historyPass, compositePass } from '../v4/render-graph.js';
import { validateSceneManifest } from '../v4/scene-manifest.js';
import { startV4Runtime, hydrateRuntimeResources } from '../v4/runtime.js';
import { DeviceResourceManager } from '../v4/resource-manager.js';
import { AssetCache, AssetLoader } from '../v4/asset-loader.js';
import { WebGpuGraphExecutor } from '../v4/render-graph-executor.js';
import { AudioFeatureBus, AUDIO_BAND_COUNT, makeLogBandEdges } from '../v4/audio-feature-bus.js';
import { LiveAudioFeatureBridge, LIVE_AUDIO_STATES } from '../v4/live-audio-engine.js';
import { createPrismaticCathedralScene, sceneByteSignature } from '../v4/scenes/prismatic-cathedral/geometry.js';
import { prismaticCathedralManifest, makePrismaticCathedralGraph } from '../v4/scenes/prismatic-cathedral/manifest.js';
import { createPrismaticCathedralPipelines, createPrismaticCathedralExecutors } from '../v4/scenes/prismatic-cathedral/pipeline.js';
import { createFilamentVortexScene, filamentSignature, FILAMENT_CONTRACT } from '../v4/scenes/filament-vortex/geometry.js';
import { filamentVortexManifest, makeFilamentVortexGraph } from '../v4/scenes/filament-vortex/manifest.js';
import { createFilamentVortexPipelines, createFilamentVortexExecutors } from '../v4/scenes/filament-vortex/pipeline.js';
import { createNeonVoxelCloudScene, demoVoxelBands, voxelByteSignature, VOXEL_INSTANCE_COUNT, VOXEL_CONTRACT } from '../v4/scenes/neon-voxel-cloud/geometry.js';
import { neonVoxelCloudManifest, makeNeonVoxelCloudGraph } from '../v4/scenes/neon-voxel-cloud/manifest.js';
import { createNeonVoxelCloudExecutors, assertNeonVoxelCloudDescriptorContracts } from '../v4/scenes/neon-voxel-cloud/pipeline.js';
import { BOUNDED_BLOOM_TAP_COUNT, BOUNDED_CHROMATIC_MAX_TEXELS, BOUNDED_TRAIL_DECAY_MAX, BOUNDED_POST_WGSL, BOUNDED_TRAIL_WGSL, createBoundedPostPipeline, createBoundedTrailPipeline } from '../v4/post-stack.js';

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => { resolve = innerResolve; });
  return { promise, resolve };
}

function makeDevice(id) {
  const lost = deferred();
  const resources = makeResourceDevice();
  return { id, lost: lost.promise, lose: (reason = 'unknown') => lost.resolve({ reason }), destroyed: false, destroy() { this.destroyed = true; }, ...resources };
}

function makeCanvas() {
  const calls = [];
  const webgpu = {
    configure(descriptor) { calls.push(['configure', descriptor]); },
    getCurrentTexture() { return { createView() { return { id: 'runtime-swap-view' }; } }; },
    unconfigure() { calls.push('unconfigure'); },
  };
  return {
    calls,
    width: 640,
    height: 360,
    getContext(kind) {
      calls.push(kind);
      return kind === 'webgpu' ? webgpu : { kind };
    },
  };
}

function makeResourceDevice() {
  const calls = { buffers: [], textures: [], samplers: [], bindGroupLayouts: [], bindGroups: [], writes: [], submissions: [] };
  const created = [];
  return {
    calls,
    created,
    queue: {
      writeBuffer(buffer, offset, source, byteOffset, byteLength) { buffer.write = { offset, source, byteOffset, byteLength }; calls.writes.push(['buffer', buffer, offset, source, byteOffset, byteLength]); },
      writeTexture(destination, data, layout, size) { destination.texture.write = { data, layout, size }; calls.writes.push(['texture', destination, data, layout, size]); },
      submit(buffers) { calls.submissions.push(buffers); },
    },
    createCommandEncoder() {
      return {
        beginComputePass(descriptor) { calls.computePass = descriptor; return { setPipeline(p) { calls.computePipeline = p; }, setBindGroup(...args) { calls.computeBind = args; }, dispatchWorkgroups(...args) { calls.dispatch = args; }, end() {} }; },
        beginRenderPass(descriptor) { calls.renderPass = descriptor; return { setPipeline(p) { calls.renderPipeline = p; }, setBindGroup(...args) { calls.renderBind = args; }, setVertexBuffer(...args) { calls.vertexBuffer = args; }, setIndexBuffer(...args) { calls.indexBuffer = args; }, draw(...args) { calls.draw = args; }, drawIndexed(...args) { calls.drawIndexed = args; }, end() {} }; },
        finish() { return { id: 'runtime-command-buffer' }; },
      };
    },
    createBuffer(descriptor) {
      const resource = { descriptor, destroyed: false, destroy() { this.destroyed = true; } };
      calls.buffers.push(resource);
      created.push(resource);
      return resource;
    },
    createTexture(descriptor) {
      const resource = { descriptor, destroyed: false, destroy() { this.destroyed = true; }, createView() { return { texture: resource }; } };
      calls.textures.push(resource);
      created.push(resource);
      return resource;
    },
    createSampler(descriptor) { const resource = { descriptor, destroyed: false, destroy() { this.destroyed = true; } }; calls.samplers.push(resource); created.push(resource); return resource; },
    createBindGroupLayout(descriptor) { const resource = { descriptor, destroyed: false, destroy() { this.destroyed = true; } }; calls.bindGroupLayouts.push(resource); created.push(resource); return resource; },
    createBindGroup(descriptor) { const resource = { descriptor, destroyed: false, destroy() { this.destroyed = true; } }; calls.bindGroups.push(resource); created.push(resource); return resource; },
  };
}

function makePipeline(id) {
  return { id, layoutBindGroupCount: 1, getBindGroupLayout(index) { return { id: `${id}:layout:${index}` }; } };
}

function testExecutableRenderGraphSubmission() {
  const calls = { configure: [], passes: [], computes: [], submissions: [], order: [] };
  const context = {
    configure(descriptor) { calls.configure.push(descriptor); },
    getCurrentTexture() { return { createView: () => ({ id: 'swap-view' }) }; },
    unconfigure() { calls.unconfigured = true; },
  };
  const canvas = { width: 640, height: 360, clientWidth: 640, clientHeight: 360, getBoundingClientRect: () => ({ width: 640, height: 360 }), getContext: (kind) => kind === 'webgpu' ? context : null };
  const device = makeResourceDevice();
  device.createCommandEncoder = () => ({
    beginComputePass(descriptor) {
      calls.computes.push(descriptor); calls.order.push('compute');
      return { setPipeline(p) { calls.computePipeline = p; }, setBindGroup(...args) { calls.computeBind = args; }, dispatchWorkgroups(...args) { calls.dispatch = args; }, end() {} };
    },
    beginRenderPass(descriptor) {
      calls.passes.push(descriptor); calls.order.push(descriptor.label.split(':').pop());
      return { setPipeline(p) { calls.renderPipeline = p; }, setBindGroup(...args) { calls.renderBind = args; }, setVertexBuffer(...args) { calls.vertex = args; }, setIndexBuffer(...args) { calls.index = args; }, draw(...args) { calls.draw = args; }, drawIndexed(...args) { calls.drawIndexed = args; }, end() { calls.ended = true; } };
    },
    finish() { return { id: 'command-buffer' }; },
  });
  device.queue.submit = (buffers) => calls.submissions.push(buffers);
  const vertex = { id: 'vertex' };
  const index = { id: 'index' };
  const graph = new RenderGraph({ id: 'executable' })
    .addResource(storageBuffer('state', 16))
    .addResource(vertexBuffer('vertices', 64))
    .addResource(indexBuffer('indices', 12))
    .addResource(renderTarget('scene-color'))
    .addResource(depthTarget('scene-depth'))
    .addPass(computePass('simulate', { pipeline: 'compute-pipeline', outputs: ['state'], workgroups: [2, 3, 4] }))
    .addPass(renderPass('draw-scene', { pipeline: 'render-pipeline', colorTargets: ['scene-color'], depthTarget: 'scene-depth', vertexBuffers: ['vertices'], indexBuffer: 'indices', drawIndexed: [3, 1, 0, 0, 0] }))
    .addPass(compositePass('composite', { layers: ['scene-color'], output: 'swapchain', pipeline: 'composite-pipeline', draw: [3, 1, 0, 0] }))
    .freeze();
  const executor = new WebGpuGraphExecutor({ device, canvas, graph, format: 'bgra8unorm', resources: new Map([['state', {}], ['vertices', vertex], ['indices', index]]), pipelines: new Map([['compute-pipeline', { id: 'cp' }], ['render-pipeline', { id: 'rp' }], ['composite-pipeline', { id: 'pp' }]]), windowObject: { devicePixelRatio: 3 } });
  assert.equal(calls.configure.length, 1, 'GPUCanvasContext is configured once');
  const frame = executor.render();
  assert.equal(frame.submitted, true);
  assert.deepEqual(frame.passes, ['simulate', 'draw-scene', 'composite'], 'authored order is preserved');
  assert.deepEqual(calls.dispatch, [2, 3, 4], 'compute dispatchWorkgroups is encoded');
  assert.deepEqual(calls.drawIndexed, [3, 1, 0, 0, 0], 'drawIndexed is encoded');
  assert.deepEqual(calls.draw, [3, 1, 0, 0], 'composite draw is encoded');
  assert.equal(calls.passes[0].depthStencilAttachment.view.texture.descriptor.format, 'depth24plus');
  assert.equal(canvas.width, 1280, 'DPR is capped to 2 for CSS resize sync');
  assert.deepEqual(calls.submissions[0], [{ id: 'command-buffer' }], 'finished commands reach queue.submit');
  executor.dispose();
  assert.equal(calls.unconfigured, true);
  assert.equal(device.calls.textures.every((texture) => texture.destroyed), true, 'owned canvas-sized targets are destroyed');
}

function testExecutableHistoryPingPongTransactions() {
  const calls = { passes: [], submissions: [], historyRoles: [] };
  const context = {
    configure() {},
    getCurrentTexture() { return { createView: () => ({ id: 'swap-view' }) }; },
    unconfigure() { calls.unconfigured = true; },
  };
  const canvas = { width: 320, height: 180, clientWidth: 320, clientHeight: 180, getBoundingClientRect: () => ({ width: 320, height: 180 }), getContext: (kind) => kind === 'webgpu' ? context : null };
  const device = makeResourceDevice();
  device.createCommandEncoder = () => ({
    beginRenderPass(descriptor) {
      calls.passes.push(descriptor);
      return { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
    },
    finish() { return { id: `history-command-${calls.submissions.length}` }; },
  });
  device.queue.submit = (buffers) => calls.submissions.push(buffers);
  const graph = new RenderGraph({ id: 'history-transaction' })
    .addResource(renderTarget('scene-color'))
    .addResource(historyTarget('trail-history', { decay: 0.87 }))
    .addPass(renderPass('scene-current', { pipeline: 'scene', colorTargets: ['scene-color'], draw: [3, 1, 0, 0] }))
    .addPass(historyPass('history-feedback', { pipeline: 'history', source: 'scene-color', history: 'trail-history', executor: 'history-bind', draw: [3, 1, 0, 0] }))
    .addPass(compositePass('history-composite', { layers: ['trail-history'], output: 'swapchain', pipeline: 'composite', draw: [3, 1, 0, 0] }))
    .freeze();
  const executor = new WebGpuGraphExecutor({
    device,
    canvas,
    graph,
    pipelines: new Map([['scene', makePipeline('scene')], ['history', makePipeline('history')], ['composite', makePipeline('composite')]]),
    executors: new Map([['history-bind', ({ frameContext, graphPass, executor: activeExecutor }) => {
      calls.historyRoles.push({
        reset: frameContext.historyReset,
        parity: frameContext.history.parity,
        previous: activeExecutor.historyState(graphPass.history).previousTexture.descriptor.label,
        next: activeExecutor.historyState(graphPass.history).nextTexture.descriptor.label,
        source: activeExecutor.ownedTextures.get(graphPass.source).texture.descriptor.label,
      });
      assert.notEqual(calls.historyRoles.at(-1).source, calls.historyRoles.at(-1).previous, 'history source and previous target are physically distinct');
      assert.notEqual(calls.historyRoles.at(-1).source, calls.historyRoles.at(-1).next, 'history source and next target are physically distinct');
      assert.notEqual(calls.historyRoles.at(-1).previous, calls.historyRoles.at(-1).next, 'history previous and next targets are physically distinct');
    }]]),
  });
  assert.equal(device.calls.textures.length, 3, 'scene plus two canvas-sized history targets allocated');
  const first = executor.render();
  assert.equal(first.submitted, true);
  assert.equal(calls.historyRoles[0].reset, true, 'first frame deterministically clears history before sampling');
  assert.equal(executor.historyDiagnostics()[0].swapCount, 1, 'history swap occurs after successful submit');
  const firstPreviousAfterSwap = executor.historyDiagnostics()[0].previousRole;
  const second = executor.render();
  assert.equal(second.submitted, true);
  assert.equal(calls.historyRoles[1].reset, false, 'second frame samples initialized previous history');
  assert.notEqual(executor.historyDiagnostics()[0].previousRole, firstPreviousAfterSwap, 'physical previous/next roles alternate');
  const bindGroupsAfterSecond = device.calls.bindGroups.length;
  executor.render();
  assert.equal(device.calls.bindGroups.length, bindGroupsAfterSecond, 'composite history bind groups are reused once both parity views are cached');
  canvas.getBoundingClientRect = () => ({ width: 400, height: 200 });
  executor.resizeTargets();
  const afterResize = executor.historyDiagnostics()[0];
  assert.equal(afterResize.pendingReset, true, 'resize requests deterministic history reset');
  assert.equal(afterResize.width, 400);
  const texturesBeforeDispose = [...device.calls.textures];
  executor.dispose();
  assert.equal(texturesBeforeDispose.every((texture) => texture.destroyed), true, 'dispose destroys scene and both history targets');

  const failingDevice = makeResourceDevice();
  let shouldFail = true;
  failingDevice.queue.submit = () => { if (shouldFail) throw new Error('submit failed'); };
  const failingExecutor = new WebGpuGraphExecutor({ device: failingDevice, canvas, graph, pipelines: new Map([['scene', makePipeline('scene')], ['history', makePipeline('history')], ['composite', makePipeline('composite')]]), executors: new Map([['history-bind', () => {}]]) });
  const before = failingExecutor.historyDiagnostics()[0];
  assert.throws(() => failingExecutor.render(), /submit failed/);
  const after = failingExecutor.historyDiagnostics()[0];
  assert.equal(after.swapCount, before.swapCount, 'failed queue.submit must not swap history targets');
  assert.equal(after.parity, before.parity, 'failed queue.submit preserves parity');
  shouldFail = false;
  assert.equal(failingExecutor.render().submitted, true);
  assert.equal(failingExecutor.historyDiagnostics()[0].swapCount, before.swapCount + 1, 'next successful submit swaps once');
}

function testExecutablePostStackAndCompositeSubmission() {
  const calls = { passes: [], order: [], bindGroups: [], draws: [], submissions: [] };
  const context = {
    configure() {},
    getCurrentTexture() { return { createView: () => ({ id: 'swap-view' }) }; },
    unconfigure() { calls.unconfigured = true; },
  };
  const canvas = { width: 320, height: 180, clientWidth: 320, clientHeight: 180, getBoundingClientRect: () => ({ width: 320, height: 180 }), getContext: (kind) => kind === 'webgpu' ? context : null };
  const device = makeResourceDevice();
  device.createCommandEncoder = () => ({
    beginRenderPass(descriptor) {
      calls.passes.push(descriptor); calls.order.push(descriptor.label.split(':').pop());
      return {
        setPipeline(p) { calls.pipeline = p; },
        setBindGroup(slot, group) { calls.bindGroups.push([descriptor.label, slot, group]); },
        draw(...args) { calls.draws.push([descriptor.label, args]); },
        end() {},
      };
    },
    finish() { return { id: 'post-stack-command-buffer' }; },
  });
  device.queue.submit = (buffers) => calls.submissions.push(buffers);
  const graph = new RenderGraph({ id: 'post-stack' })
    .addResource(renderTarget('scene-color'))
    .addResource(renderTarget('post-color'))
    .addResource(depthTarget('scene-depth'))
    .addPass(renderPass('draw-authored-triangle', { pipeline: 'scene-pipeline', colorTargets: ['scene-color'], depthTarget: 'scene-depth', draw: [3, 1, 0, 0] }))
    .addPass(postPass('post-tonemap-glow', { pipeline: 'post-pipeline', inputs: ['scene-color'], output: 'post-color' }))
    .addPass(compositePass('final-composite', { layers: ['post-color'], output: 'swapchain', pipeline: 'composite-pipeline', draw: [3, 1, 0, 0] }))
    .freeze();
  const executor = new WebGpuGraphExecutor({
    device,
    canvas,
    graph,
    pipelines: new Map([['scene-pipeline', { id: 'scene' }], ['post-pipeline', makePipeline('post')], ['composite-pipeline', makePipeline('composite')]]),
  });
  assert.equal(device.calls.textures.length, 3, 'scene color, post color, and depth targets are allocated once at construction');
  assert.equal(device.calls.samplers.length, 1, 'post/composite share one fullscreen sampler');
  assert.equal(device.calls.bindGroups.length, 2, 'post and composite bind groups are created outside the frame loop');
  assert.equal(device.calls.bindGroups[0].descriptor.entries[1].resource.texture.descriptor.label, 'post-stack:scene-color');
  assert.equal(device.calls.bindGroups[1].descriptor.entries[1].resource.texture.descriptor.label, 'post-stack:post-color');
  const frame = executor.render();
  assert.deepEqual(frame.passes, ['draw-authored-triangle', 'post-tonemap-glow', 'final-composite'], 'render → post → composite order is preserved');
  assert.deepEqual(calls.order, ['draw-authored-triangle', 'post-tonemap-glow', 'final-composite']);
  assert.equal(calls.bindGroups.length, 2, 'post and composite bind groups are bound during fullscreen passes');
  assert.equal(calls.draws.length, 3, 'scene, post fullscreen, and final composite draw calls are encoded');
  assert.equal(calls.submissions.length, 1);
  const bindGroupCountAfterFirstFrame = device.calls.bindGroups.length;
  executor.render();
  assert.equal(device.calls.bindGroups.length, bindGroupCountAfterFirstFrame, 'steady frames do not churn post/composite bind groups');
  canvas.getBoundingClientRect = () => ({ width: 400, height: 200 });
  const oldTextures = [...device.calls.textures];
  const resized = executor.render();
  assert.equal(resized.width, 400);
  assert.equal(oldTextures.every((texture) => texture.destroyed), true, 'resize destroys old offscreen attachments before recreation');
  assert.equal(device.calls.bindGroups.length, bindGroupCountAfterFirstFrame + 2, 'resize recreates texture-view bind groups exactly once');
  executor.dispose();
  assert.equal(device.calls.textures.every((texture) => texture.destroyed), true, 'dispose destroys recreated offscreen attachments');
  assert.equal(calls.unconfigured, true);

  const customDevice = makeResourceDevice();
  const customContext = {
    configure() {},
    getCurrentTexture() { return { createView() { return { id: 'custom-swapchain' }; } }; },
    unconfigure() {},
  };
  const customCanvas = { width: 320, height: 180, clientWidth: 320, clientHeight: 180, getBoundingClientRect: () => ({ width: 320, height: 180 }), getContext: (kind) => kind === 'webgpu' ? customContext : null };
  const customGraph = new RenderGraph({ id: 'custom-composite-bindings' })
    .addResource(renderTarget('custom-color'))
    .addPass(compositePass('custom-composite', { layers: ['custom-color'], output: 'swapchain', pipeline: 'custom-pipeline', executor: 'custom-bindings', draw: [3, 1, 0, 0] }))
    .freeze();
  const customExecutor = new WebGpuGraphExecutor({
    device: customDevice,
    canvas: customCanvas,
    graph: customGraph,
    pipelines: new Map([['custom-pipeline', makePipeline('custom-four-binding-layout')]]),
    executors: new Map([['custom-bindings', () => {}]]),
  });
  assert.equal(customDevice.calls.bindGroups.length, 0, 'custom pass executors own bindings; generic fullscreen bind groups must not poison scene-specific layouts');
  customExecutor.dispose();
}

function testExecutableBoundedVolumeSubmission() {
  const calls = { passes: [], bounds: null, submissions: [] };
  const context = {
    configure() {},
    getCurrentTexture() { return { createView: () => ({ id: 'swap-view' }) }; },
    unconfigure() {},
  };
  const canvas = { width: 320, height: 180, clientWidth: 320, clientHeight: 180, getBoundingClientRect: () => ({ width: 320, height: 180 }), getContext: (kind) => kind === 'webgpu' ? context : null };
  const device = makeResourceDevice();
  device.createCommandEncoder = () => ({
    beginRenderPass(descriptor) {
      calls.passes.push(descriptor);
      return { setPipeline() {}, setBindGroup() {}, draw(...args) { calls.draw = args; }, end() {} };
    },
    finish() { return { id: 'volume-command-buffer' }; },
  });
  device.queue.submit = (buffers) => calls.submissions.push(buffers);
  const graph = new RenderGraph({ id: 'bounded-volume' })
    .addResource(renderTarget('volume-color'))
    .addResource(depthTarget('volume-depth'))
    .addPass(boundedVolumePass('raymarch-volume', {
      pipeline: 'volume-pipeline',
      bounds: [-1, -1, -2, 1, 1, 2],
      depthTarget: 'volume-depth',
      outputs: ['volume-color'],
      executor: 'volume-bounds',
      draw: [3, 1, 0, 0],
    }))
    .addPass(compositePass('volume-composite', { layers: ['volume-color'], output: 'swapchain', pipeline: 'composite-pipeline', draw: [3, 1, 0, 0] }))
    .freeze();
  const executor = new WebGpuGraphExecutor({
    device,
    canvas,
    graph,
    pipelines: new Map([['volume-pipeline', makePipeline('volume')], ['composite-pipeline', makePipeline('composite')]]),
    executors: new Map([['volume-bounds', ({ graphPass }) => { calls.bounds = graphPass.bounds; }]]),
  });
  const frame = executor.render();
  assert.deepEqual(frame.passes, ['raymarch-volume', 'volume-composite']);
  assert.deepEqual(calls.bounds, [-1, -1, -2, 1, 1, 2], 'bounded volume executor receives authored world bounds');
  assert.equal(calls.passes[0].colorAttachments[0].view.texture.descriptor.label, 'bounded-volume:volume-color');
  assert.equal(calls.passes[0].depthStencilAttachment.view.texture.descriptor.label, 'bounded-volume:volume-depth');
  assert.deepEqual(calls.draw, [3, 1, 0, 0], 'bounded volume encodes a fullscreen raymarch draw');
  assert.equal(calls.submissions.length, 1);
}

function testExecutableTwoLayerCrossfadeComposite() {
  const calls = { bindGroups: [], submissions: [] };
  const context = {
    configure() {},
    getCurrentTexture() { return { createView: () => ({ id: 'swap-view' }) }; },
    unconfigure() {},
  };
  const canvas = { width: 320, height: 180, clientWidth: 320, clientHeight: 180, getBoundingClientRect: () => ({ width: 320, height: 180 }), getContext: (kind) => kind === 'webgpu' ? context : null };
  const device = makeResourceDevice();
  device.createCommandEncoder = () => ({
    beginRenderPass() {
      return { setPipeline() {}, setBindGroup(slot, group) { calls.bindGroups.push([slot, group]); }, draw() {}, end() {} };
    },
    finish() { return { id: 'crossfade-command-buffer' }; },
  });
  device.queue.submit = (buffers) => calls.submissions.push(buffers);
  const graph = new RenderGraph({ id: 'crossfade-compositor' })
    .addResource(renderTarget('outgoing-color'))
    .addResource(renderTarget('incoming-color'))
    .addPass(renderPass('outgoing', { pipeline: 'scene-a', colorTargets: ['outgoing-color'], draw: [3, 1, 0, 0] }))
    .addPass(renderPass('incoming', { pipeline: 'scene-b', colorTargets: ['incoming-color'], draw: [3, 1, 0, 0] }))
    .addPass(compositePass('crossfade', {
      layers: ['outgoing-color', 'incoming-color'],
      transition: { type: 'crossfade', progress: 0.25 },
      output: 'swapchain',
      pipeline: 'crossfade-pipeline',
      draw: [3, 1, 0, 0],
    }))
    .freeze();
  const executor = new WebGpuGraphExecutor({
    device,
    canvas,
    graph,
    pipelines: new Map([['scene-a', makePipeline('scene-a')], ['scene-b', makePipeline('scene-b')], ['crossfade-pipeline', makePipeline('crossfade')]]),
  });
  const crossfadeGroup = device.calls.bindGroups.find((group) => group.descriptor.label.includes('crossfade'));
  assert.deepEqual(crossfadeGroup.descriptor.entries.map((entry) => entry.binding), [0, 1, 2, 3], 'crossfade binds sampler, both layers, and progress uniform');
  assert.equal(crossfadeGroup.descriptor.entries[1].resource.texture.descriptor.label, 'crossfade-compositor:outgoing-color');
  assert.equal(crossfadeGroup.descriptor.entries[2].resource.texture.descriptor.label, 'crossfade-compositor:incoming-color');
  executor.render({ transitionProgress: 0.75 });
  const progressWrite = device.calls.writes.find((write) => write[0] === 'buffer' && write[1].descriptor.label.includes('crossfade'));
  assert.equal(progressWrite[3][0], 0.75, 'frame transition progress reaches the GPU uniform');
  assert.equal(calls.submissions.length, 1);
  executor.dispose();
  assert.equal(progressWrite[1].destroyed, true, 'crossfade uniform is executor-owned and destroyed');
}

function testBoundedBloomToneMapPipelineContract() {
  assert.equal(BOUNDED_BLOOM_TAP_COUNT, 9, 'bloom cost stays explicitly bounded');
  assert.equal(BOUNDED_CHROMATIC_MAX_TEXELS, 1.25, 'chromatic separation stays near-pixel and bounded at native density');
  assert.match(BOUNDED_POST_WGSL, /textureDimensions\(sourceTexture\)/, 'bloom offsets are texel-sized');
  assert.match(BOUNDED_POST_WGSL, /max\(luminance - bloomThreshold, 0\.0\)/, 'only highlights feed bloom');
  assert.match(BOUNDED_POST_WGSL, /fn chromaticSample/, 'post stack has an executable chromatic optics stage');
  assert.match(BOUNDED_POST_WGSL, /min\(radial \* radial, 1\.0\)/, 'chromatic separation is restrained toward the optical center');
  assert.doesNotMatch(BOUNDED_POST_WGSL, /textureSample\(sourceTexture, sourceSampler, in\.uv\)\.rgb/, 'base sample must flow through chromatic optics');
  assert.match(BOUNDED_POST_WGSL, /acesToneMap/, 'post output is tone mapped');
  assert.match(BOUNDED_POST_WGSL, /linearToSrgb/, 'post output is encoded for the swapchain');
  const calls = [];
  const device = {
    createShaderModule(descriptor) { calls.push(['shader', descriptor]); return { descriptor }; },
    createBindGroupLayout(descriptor) { calls.push(['bind-group-layout', descriptor]); return { descriptor }; },
    createPipelineLayout(descriptor) { calls.push(['pipeline-layout', descriptor]); return { descriptor }; },
    createRenderPipeline(descriptor) { calls.push(['pipeline', descriptor]); return { descriptor, getBindGroupLayout: () => ({}) }; },
  };
  const pipeline = createBoundedPostPipeline({ device, format: 'bgra8unorm' });
  assert.equal(pipeline.descriptor.fragment.entryPoint, 'postFs');
  assert.equal(pipeline.descriptor.fragment.targets[0].format, 'bgra8unorm');
  assert.equal(calls.filter(([kind]) => kind === 'pipeline').length, 1, 'factory creates one reusable fullscreen pipeline');
}

function testBoundedTrailPipelineContract() {
  assert.equal(BOUNDED_TRAIL_DECAY_MAX, 0.94, 'trail persistence stays bounded');
  assert.match(BOUNDED_TRAIL_WGSL, /max\(current, previous \* decay\)/, 'history retains bright motion without recursively adding energy');
  assert.match(BOUNDED_TRAIL_WGSL, /select\(trailed, current, settings\.reset/, 'first frame and resize can bypass stale history');
  const calls = [];
  const device = {
    createShaderModule(descriptor) { calls.push(['shader', descriptor]); return { descriptor }; },
    createBindGroupLayout(descriptor) { calls.push(['bind-group-layout', descriptor]); return { descriptor }; },
    createPipelineLayout(descriptor) { calls.push(['pipeline-layout', descriptor]); return { descriptor }; },
    createRenderPipeline(descriptor) { calls.push(['pipeline', descriptor]); return { descriptor, getBindGroupLayout: () => ({}) }; },
  };
  const pipeline = createBoundedTrailPipeline({ device, format: 'rgba16float' });
  assert.equal(pipeline.descriptor.fragment.entryPoint, 'trailFs');
  assert.equal(pipeline.descriptor.fragment.targets[0].format, 'rgba16float');
  assert.deepEqual(calls.find(([kind]) => kind === 'bind-group-layout')[1].entries.map((entry) => entry.binding), [0, 1, 2, 3]);
}

async function testResourceManagerAndAssetCache() {
  const device = makeResourceDevice();
  const manager = new GpuResourceManager(device);
  const buffer = manager.createBuffer('particles', { byteLength: 32, usage: ['storage', 'copy-dst'], data: new Uint8Array([1, 2, 3, 4]) });
  assert.equal(device.calls.buffers.length, 1);
  assert.equal(device.calls.writes[0][0], 'buffer', 'initial buffer data reaches the GPU queue');
  assert.equal(manager.get('particles'), buffer);
  assert.throws(() => manager.createBuffer('particles', { byteLength: 32, usage: ['storage'] }), /already exists/);

  let generatedCalls = 0;
  const cache = new AssetCache({ generatedLoaders: { 'blue-noise': async () => { generatedCalls += 1; return { width: 2, height: 2, pixels: new Uint8Array(16).fill(127) }; } } });
  const descriptor = { id: 'blue-noise', type: 'texture', uri: 'generated://blue-noise' };
  const [first, second] = await Promise.all([cache.load(descriptor), cache.load(descriptor)]);
  assert.equal(first, second, 'concurrent asset requests share one promise/value');
  assert.equal(generatedCalls, 1, 'asset generator executes once');
  const texture = manager.createTextureFromPixels('blue-noise', first);
  assert.equal(device.calls.textures.length, 1);
  assert.equal(device.calls.writes.at(-1)[0], 'texture', 'decoded pixels reach the GPU queue');
  manager.dispose();
  assert.equal(buffer.destroyed, true);
  assert.equal(texture.destroyed, true);
  assert.equal(manager.size, 0);

  let attempts = 0;
  const retrying = new AssetCache({ generatedLoaders: { flaky: async () => { attempts += 1; if (attempts === 1) throw new Error('private detail'); return new Uint8Array([9]); } } });
  await assert.rejects(retrying.load({ id: 'flaky', type: 'binary', uri: 'generated://flaky' }), (error) => error.code === 'asset-load-failed' && !error.message.includes('private detail'));
  assert.deepEqual(await retrying.load({ id: 'flaky', type: 'binary', uri: 'generated://flaky' }), new Uint8Array([9]), 'failed loads are evicted and retryable');
}

async function testRuntimeUsesLifecycleAndRetryBudget() {
  const first = makeDevice('first');
  const second = makeDevice('second');
  const third = makeDevice('third');
  let requestCount = 0;
  const adapter = {
    features: new Set(),
    limits: { maxStorageBuffersPerShaderStage: 4, maxStorageBufferBindingSize: 1 << 20 },
    async requestDevice() {
      requestCount += 1;
      return first;
    },
  };
  const statusElement = { dataset: {}, textContent: '' };
  const runtime = await startV4Runtime({
    canvas: makeCanvas(),
    statusElement,
    manifest: validManifest(),
    graphFactory: smokeGraph,
    navigatorObject: { gpu: { async requestAdapter() { return adapter; } } },
    gpuLifecycleOptions: { maxRetries: 2, retryDelayMs: 0 },
    createFallbackCanvas: makeCanvas,
  });
  assert.equal(runtime.mode, RENDERER_MODES.WEBGPU_REDUCED);
  assert.equal(requestCount, 1, 'initial requestDevice should happen during probing only');
  assert.equal(runtime.lifecycle.device, first, 'probed device must be adopted through lifecycle.acquire');
  assert.ok(runtime.resourceManager, JSON.stringify(runtime.publicErrors));
  assert.equal(runtime.resourceManager.size, 3, 'ping-pong buffers and manifest texture are materialized');
  assert.equal(first.calls.buffers.length, 2);
  assert.equal(first.calls.textures.length, 3, 'manifest texture plus graph render/depth targets are materialized');
  assert.equal(first.calls.submissions.length, 1, 'runtime submits an initial WebGPU frame');
  adapter.requestDevice = async () => { requestCount += 1; return requestCount === 2 ? second : third; };
  first.lose('unknown');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runtime.lifecycle.device, second, 'first loss should reacquire');
  await runtime.resourcesReady;
  assert.equal(runtime.resourceManager.size, 3, 'device reacquisition rebuilds scene resources');
  assert.equal(first.calls.buffers.every((buffer) => buffer.destroyed), true, 'lost-device buffers are destroyed');
  assert.equal(runtime.lifecycle.retryCount, 1, 'successful reacquire must not erase loss-cycle budget');
  second.lose('unknown');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runtime.lifecycle.device, third, 'second loss should reacquire');
  assert.equal(runtime.lifecycle.retryCount, 2);
  third.lose('unknown');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runtime.lifecycle.state, GPU_LIFECYCLE_STATES.FALLBACK, 'third loss exceeds bounded policy');
}

async function testExplicitLifecycleBudgetResetOnly() {
  const devices = [makeDevice('a'), makeDevice('b'), makeDevice('c')];
  let index = 0;
  const lifecycle = new GpuLifecycle({ maxRetries: 1, retryDelayMs: 0 });
  await lifecycle.acquire(async () => devices[index++]);
  devices[0].lose('unknown');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(lifecycle.retryCount, 1);
  devices[1].lose('unknown');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(lifecycle.state, GPU_LIFECYCLE_STATES.FALLBACK);
  lifecycle.resetLossBudget('scene-reinitialized');
  await lifecycle.acquire(async () => devices[index++]);
  assert.equal(lifecycle.retryCount, 0, 'explicit reset boundary clears retry count');
}

async function testStalePendingRetryCannotReplaceExplicitReacquire() {
  const initial = makeDevice('initial');
  const explicit = makeDevice('explicit-reacquire');
  const staleRetry = makeDevice('stale-retry');
  const retryDelay = deferred();
  let retryRequests = 0;
  const lifecycle = new GpuLifecycle({
    maxRetries: 3,
    retryDelayMs: 50,
    retryScheduler: () => retryDelay.promise,
  });
  const originalRequestDevice = async () => {
    retryRequests += 1;
    return retryRequests === 1 ? initial : staleRetry;
  };

  await lifecycle.acquire(originalRequestDevice);
  initial.lose('unknown');
  await Promise.resolve();
  assert.equal(lifecycle.state, GPU_LIFECYCLE_STATES.RETRYING, 'loss should park in delayed retry state');

  await lifecycle.acquire(async () => explicit);
  assert.equal(lifecycle.device, explicit, 'explicit reacquire installs the newer device');
  assert.equal(lifecycle.generation, 2);

  retryDelay.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(retryRequests, 1, 'stale delayed retry must abort before requesting another device');
  assert.equal(lifecycle.device, explicit, 'finalDevice must stay the explicit device, not the stale retry');
  assert.notEqual(lifecycle.device, staleRetry);
}

async function testRuntimeFallbackUpdatesPublicStatusContract() {
  const first = makeDevice('terminal-loss');
  let requestCount = 0;
  const adapter = {
    features: new Set(['timestamp-query', 'texture-compression-bc']),
    limits: { maxStorageBuffersPerShaderStage: 4, maxStorageBufferBindingSize: 1 << 20 },
    async requestDevice() {
      requestCount += 1;
      return first;
    },
  };
  const statusElement = { dataset: {}, textContent: '' };
  const runtime = await startV4Runtime({
    canvas: makeCanvas(),
    statusElement,
    manifest: validManifest(),
    graphFactory: smokeGraph,
    navigatorObject: { gpu: { async requestAdapter() { return adapter; } } },
    gpuLifecycleOptions: { maxRetries: 0, retryDelayMs: 0 },
    createFallbackCanvas: makeCanvas,
  });
  assert.equal(runtime.mode, RENDERER_MODES.WEBGPU_FULL);
  assert.equal(statusElement.dataset.rendererMode, RENDERER_MODES.WEBGPU_FULL);
  assert.equal(statusElement.dataset.webgpuActive, 'true');

  first.lose('unknown');
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(requestCount, 1, 'terminal fallback must not request another device');
  assert.equal(runtime.lifecycle.state, GPU_LIFECYCLE_STATES.FALLBACK);
  assert.equal(runtime.mode, RENDERER_MODES.WEBGL2_LEGACY, 'runtime mode becomes honest fallback mode');
  assert.equal(statusElement.dataset.rendererMode, RENDERER_MODES.WEBGL2_LEGACY);
  assert.equal(statusElement.dataset.webgpuActive, 'false');
  assert.equal(statusElement.dataset.gpuState, GPU_LIFECYCLE_STATES.FALLBACK);
  assert.ok(!statusElement.textContent.includes('WebGPU selected'), 'visible status must not keep stale WebGPU selected copy');
  assert.match(statusElement.textContent, /fallback required/i);
  assert.ok(runtime.publicErrors.some((error) => error.code === 'gpu-retry-limit-exceeded'), 'public runtime errors record terminal fallback reason');
}

function testRenderGraphDeepValidation() {
  const base = () => new RenderGraph({ id: 'bad' })
    .addResource(storageBuffer('input', 16))
    .addResource(storageBuffer('output', 16))
    .addResource(instancedDepthTarget('depth'));
  assert.ok(!base().addResource(storageBuffer('input', 16)).validate().ok, 'duplicate resource ids rejected');
  assert.ok(!base().addPass(postPass('p', { inputs: ['input'] })).validate().ok, 'post output required');
  assert.ok(!base().addPass(postPass('p', { output: 'output' })).validate().ok, 'post input required');
  const sameTargetPost = new RenderGraph({ id: 'same-target-post' })
    .addResource(renderTarget('same'))
    .addPass(postPass('post', { pipeline: 'post', inputs: ['same'], output: 'same' }));
  const sameTargetResult = sameTargetPost.validate();
  assert.equal(sameTargetResult.ok, false, 'postPass({ inputs: [same], output: same }) is invalid');
  assert.ok(sameTargetResult.errors.some((message) => message.includes('cannot sample from and render into the same target')), 'same-target post hazard is explicit');
  assert.ok(!new RenderGraph({ id: 'alias-target-post' })
    .addResource(renderTarget('same'))
    .addResource({ type: 'render-target', id: 'same-view', viewOf: 'same' })
    .addPass(postPass('post', { pipeline: 'post', inputs: ['same-view'], output: 'same' })).validate().ok, 'post alias/view read-write hazards are rejected');
  assert.ok(!base().addPass(feedbackPass('f', { source: 'missing', history: 'input', output: 'output' })).validate().ok, 'feedback source must exist');
  assert.ok(!base().addPass(feedbackPass('f', { source: 'input', history: 'missing', output: 'output' })).validate().ok, 'feedback history must exist');
  assert.ok(!base().addPass(feedbackPass('f', { source: 'input', history: 'output' })).validate().ok, 'feedback output required');
  assert.ok(!base().addPass(compositePass('c', { layers: [], output: 'swapchain' })).validate().ok, 'composite layers required');
  assert.ok(!base().addPass(compositePass('c', { layers: ['missing'], output: 'swapchain' })).validate().ok, 'composite layer must exist');
  assert.ok(!base().addPass(boundedVolumePass('v', { pipeline: 'volume', bounds: [-1, -1, -1, 1, 1, 1], inputs: ['input'], outputs: ['output'] })).validate().ok, 'bounded volume depth target required');
  assert.ok(!base().addResource(storageBuffer('volume-storage-output', 16)).addPass(boundedVolumePass('bad-volume-output', { pipeline: 'volume', bounds: [-1, -1, -1, 1, 1, 1], depthTarget: 'depth', outputs: ['volume-storage-output'] })).validate().ok, 'bounded volume output must be a render target');
  assert.ok(!base().addResource(renderTarget('reversed-volume-output')).addPass(boundedVolumePass('bad-volume-bounds', { pipeline: 'volume', bounds: [1, -1, -1, -1, 1, 1], depthTarget: 'depth', outputs: ['reversed-volume-output'] })).validate().ok, 'bounded volume bounds must be ordered min/max pairs');
  assert.ok(base().addResource(renderTarget('out2')).addResource(renderTarget('out3')).addResource(renderTarget('out4'))
    .addPass(computePass('ok-compute', { pipeline: 'sim', inputs: ['input'], outputs: ['output'] }))
    .addPass(boundedVolumePass('ok-volume', { pipeline: 'volume', bounds: [-1, -1, -1, 1, 1, 1], depthTarget: 'depth', inputs: ['input'], outputs: ['out2'] }))
    .addPass(renderPass('ok-render-source', { pipeline: 'render', colorTargets: ['out3'], draw: [3, 1, 0, 0] }))
    .addPass(postPass('ok-post', { pipeline: 'post', inputs: ['out3'], output: 'out4' }))
    .addPass(compositePass('ok-composite', { layers: ['out4'], output: 'swapchain' })).validate().ok);
}

function smokeGraph() {
  return new RenderGraph({ id: 'runtime-smoke' })
    .addResource(renderTarget('smoke-color'))
    .addResource(depthTarget('smoke-depth'))
    .addPass(renderPass('draw', { pipeline: 'v4-clear-draw-pipeline', colorTargets: ['smoke-color'], depthTarget: 'smoke-depth', draw: [3, 1, 0, 0] }))
    .addPass(compositePass('composite', { layers: ['smoke-color'], output: 'swapchain' }));
}

function makeExecutorGraph(id = 'executor-smoke') {
  return new RenderGraph({ id })
    .addResource(renderTarget('scene-color'))
    .addPass(renderPass('draw', { pipeline: 'render-pipeline', colorTargets: ['scene-color'], draw: [3, 1, 0, 0] }))
    .addPass(compositePass('composite', { layers: ['scene-color'], output: 'swapchain', pipeline: 'composite-pipeline', draw: [3, 1, 0, 0] }))
    .freeze();
}

function makeExecutor({ canvas, device = makeResourceDevice(), dpr = 1 } = {}) {
  return { device, executor: new WebGpuGraphExecutor({
    device,
    canvas: canvas || makeCanvas(),
    graph: makeExecutorGraph(),
    pipelines: new Map([['render-pipeline', { id: 'render' }], ['composite-pipeline', { id: 'composite' }]]),
    windowObject: { devicePixelRatio: dpr },
  }) };
}

function testExecutorCanvasSizingContracts() {
  const zeroCanvas = makeCanvas();
  zeroCanvas.width = 300;
  zeroCanvas.height = 150;
  zeroCanvas.clientWidth = 0;
  zeroCanvas.clientHeight = 0;
  zeroCanvas.getBoundingClientRect = () => ({ width: 0, height: 0 });
  const zeroDevice = makeResourceDevice();
  const { executor: zeroExecutor } = makeExecutor({ canvas: zeroCanvas, device: zeroDevice });
  assert.equal(zeroDevice.calls.textures.length, 0, 'zero CSS layout must not create canvas-sized attachments during construction');
  const skipped = zeroExecutor.render();
  assert.equal(skipped.submitted, false, 'zero CSS layout must fail closed instead of using 300x150 backing attributes');
  assert.equal(skipped.reason, 'layout-reports-zero');
  assert.equal(skipped.source, 'getBoundingClientRect');
  assert.equal(zeroCanvas.width, 300, 'zero CSS layout must not resize backing width');
  assert.equal(zeroCanvas.height, 150, 'zero CSS layout must not resize backing height');
  assert.equal(zeroDevice.calls.textures.length, 0, 'zero CSS layout must not create/resize attachments');
  assert.equal(zeroDevice.calls.submissions.length, 0, 'zero CSS layout must not submit commands');
  assert.equal(zeroDevice.calls.renderPass, undefined, 'zero CSS layout must not encode render passes');

  const headlessCanvas = makeCanvas();
  const headlessDevice = makeResourceDevice();
  const { executor: headlessExecutor } = makeExecutor({ canvas: headlessCanvas, device: headlessDevice });
  const headlessFrame = headlessExecutor.render();
  assert.equal(headlessFrame.submitted, true, 'headless mocks without layout APIs keep explicit backing-attribute path');
  assert.equal(headlessFrame.width, 640);
  assert.equal(headlessFrame.height, 360);
  assert.equal(headlessDevice.calls.submissions.length, 1);

  const cssCanvas = makeCanvas();
  cssCanvas.width = 300;
  cssCanvas.height = 150;
  cssCanvas.clientWidth = 321;
  cssCanvas.clientHeight = 123;
  cssCanvas.getBoundingClientRect = () => ({ width: 321, height: 123 });
  const cssDevice = makeResourceDevice();
  const { executor: cssExecutor } = makeExecutor({ canvas: cssCanvas, device: cssDevice, dpr: 2.5 });
  const cssFrame = cssExecutor.render();
  assert.equal(cssFrame.submitted, true, 'nonzero CSS layout submits');
  assert.equal(cssFrame.width, 642, 'CSS width is scaled by capped DPR');
  assert.equal(cssFrame.height, 246, 'CSS height is scaled by capped DPR');
  assert.equal(cssFrame.dpr, 2);
  assert.equal(cssCanvas.width, 642);
  assert.equal(cssCanvas.height, 246);
  assert.equal(cssDevice.calls.submissions.length, 1);
}

function testExecutorFailsClosed() {
  const canvas = makeCanvas();
  const device = makeResourceDevice();
  const badHistory = new RenderGraph({ id: 'bad-history' })
    .addResource(renderTarget('input'))
    .addResource(renderTarget('out'))
    .addPass(postPass('post-history-placeholder', { pipeline: 'post', inputs: ['input'], output: 'out', history: 'trail-history' }))
    .addPass(compositePass('composite', { layers: ['out'], output: 'swapchain' }));
  assert.throws(() => new WebGpuGraphExecutor({ device, canvas, graph: badHistory, pipelines: new Map([['post', {}]]) }), /history post mode/, 'unsupported history/trail post mode fails closed');
  const missingPipeline = new RenderGraph({ id: 'missing-pipeline' })
    .addResource(renderTarget('out'))
    .addPass(renderPass('draw', { pipeline: 'missing', colorTargets: ['out'], draw: [3, 1, 0, 0] }))
    .addPass(compositePass('composite', { layers: ['out'], output: 'swapchain' }))
    .freeze();
  assert.throws(() => new WebGpuGraphExecutor({ device, canvas, graph: missingPipeline }), /missing pipeline/, 'missing pipelines fail at compile time');
  assert.ok(!new RenderGraph({ id: 'bad-target' }).addResource(storageBuffer('not-target', 16)).addPass(renderPass('draw', { pipeline: 'p', colorTargets: ['not-target'], draw: [3, 1, 0, 0] })).validate().ok, 'invalid target kind rejected');
  assert.ok(!new RenderGraph({ id: 'hazard' }).addResource(renderTarget('out')).addPass(renderPass('a', { pipeline: 'p', colorTargets: ['out'], draw: [3, 1, 0, 0] })).addPass(renderPass('b', { pipeline: 'p', colorTargets: ['out'], draw: [3, 1, 0, 0] })).validate().ok, 'output hazards are rejected');
  const unsafeSameTargetPost = {
    id: 'unsafe-same-target-post',
    resources: [renderTarget('same')],
    passes: [postPass('post', { pipeline: 'post', inputs: ['same'], output: 'same' }), compositePass('composite', { layers: ['same'], output: 'swapchain', pipeline: 'composite', draw: [3, 1, 0, 0] })],
    validate: () => ({ ok: true, errors: [] }),
  };
  assert.throws(() => new WebGpuGraphExecutor({ device, canvas, graph: unsafeSameTargetPost, pipelines: new Map([['post', makePipeline('post')], ['composite', makePipeline('composite')]]) }), /cannot sample from and render into the same target/, 'executor compile refuses same-target post hazards even if validation is bypassed');
  assert.equal(device.calls.submissions.length, 0, 'executor refuses to submit unsafe same-target post graph');
}

async function testRuntimeNoExecutorWhenUnavailableAndFallbackCleanup() {
  const unavailable = await startV4Runtime({ canvas: makeCanvas(), statusElement: { dataset: {}, textContent: '' }, manifest: validManifest(), graphFactory: smokeGraph, navigatorObject: {}, createFallbackCanvas: makeCanvas });
  assert.equal(unavailable.graphExecutor, null, 'no executor is exposed when WebGPU is unavailable');
  assert.equal(await unavailable.resourcesReady, null);

  const first = makeDevice('cleanup');
  const statusElement = { dataset: {}, textContent: '' };
  const runtime = await startV4Runtime({ canvas: makeCanvas(), statusElement, manifest: validManifest(), graphFactory: smokeGraph, navigatorObject: { gpu: { async requestAdapter() { return { features: new Set(), limits: { maxStorageBuffersPerShaderStage: 4, maxStorageBufferBindingSize: 1 << 20 }, async requestDevice() { return first; } }; } } }, gpuLifecycleOptions: { maxRetries: 0, retryDelayMs: 0 }, createFallbackCanvas: makeCanvas });
  assert.ok(runtime.graphExecutor);
  first.lose('unknown');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(runtime.graphExecutor, null, 'fallback cleanup hides disposed executor');
  assert.equal(runtime.resourceManager, null, 'fallback cleanup hides disposed manager');
  assert.equal(statusElement.dataset.resourcesReady, 'false');
  assert.equal(statusElement.dataset.frameSubmitted, 'false');
}

async function testRuntimeRafLifecycleStopsStaleFrames() {
  const device = makeDevice('raf');
  let requestId = 0;
  const callbacks = new Map();
  const windowObject = { devicePixelRatio: 1, requestAnimationFrame(cb) { const id = ++requestId; callbacks.set(id, cb); return id; }, cancelAnimationFrame(id) { callbacks.delete(id); } };
  const runtime = await startV4Runtime({ canvas: makeCanvas(), statusElement: { dataset: {}, textContent: '' }, manifest: validManifest(), graphFactory: smokeGraph, frameProvider: ({ time }) => ({ time }), windowObject, navigatorObject: { gpu: { async requestAdapter() { return { features: new Set(), limits: { maxStorageBuffersPerShaderStage: 4, maxStorageBufferBindingSize: 1 << 20 }, async requestDevice() { return device; } }; } } }, createFallbackCanvas: makeCanvas });
  assert.ok(callbacks.size >= 1, 'RAF loop starts only when frame provider is supplied');
  const pending = [...callbacks.values()][0];
  runtime.dispose();
  const before = device.calls.submissions.length;
  pending(99);
  assert.equal(device.calls.submissions.length, before, 'stale queued RAF callback cannot submit after dispose');
  assert.equal(runtime.graphExecutor, null);
}

function validManifest() {
  return {
    schemaVersion: 1,
    id: 'runtime-smoke',
    title: 'Runtime Smoke',
    assets: [{ id: 'blue-noise', type: 'texture', uri: 'generated://blue-noise' }],
    pipelines: [
      { id: 'scene-simulate', kind: 'compute', entryPoint: 'main', assets: ['blue-noise'], buffers: ['particles'] },
      { id: 'scene-volume', kind: 'render', entryPoint: 'main', buffers: ['particles'] },
      { id: 'bloom-tonemap', kind: 'post', entryPoint: 'main' },
    ],
    simulationBuffers: [{ id: 'particles', kind: 'ping-pong', byteLength: 32768 }],
    controls: [{ id: 'density', type: 'float', min: 0, max: 1, default: 1, pipeline: 'scene-volume' }],
    transitions: [{ id: 'crossfade', type: 'crossfade', durationMs: 900, from: 'scene-volume', to: 'bloom-tonemap' }],
  };
}

async function testDeviceResourceManagerBehavior() {
  const first = makeDevice('resources-a');
  const second = makeDevice('resources-b');
  let index = 0;
  const lifecycle = new GpuLifecycle({ maxRetries: 1, retryDelayMs: 0 });
  await lifecycle.acquire(async () => [first, second][index++]);
  const manager = new DeviceResourceManager(lifecycle, { memoryBudgetBytes: 40960, labelPrefix: 'test' });

  const a = manager.createBuffer('particles', { size: 1024, usage: 1 });
  const reused = manager.createBuffer('particles', { size: 1024, usage: 1 });
  assert.equal(reused.resource, a.resource, 'same descriptor is reused within a generation');
  assert.equal(manager.telemetry().knownAllocatedBytes, 1024);

  const texture = manager.createTexture('lut', { size: [4, 4, 1], format: 'rgba8unorm', usage: 1 });
  assert.equal(texture.knownBytes, 64, 'texture allocation uses known format byte accounting');
  const sampler = manager.createSampler('linear', { magFilter: 'linear', minFilter: 'linear' });
  const layout = manager.createBindGroupLayout('layout', { entries: [{ binding: 0, visibility: 1, sampler: {} }] });
  const bindGroup = manager.createBindGroup('bind-group', { layout: layout.resource, entries: [{ binding: 0, resource: sampler.resource }] });
  assert.equal(bindGroup.kind, 'bind-group', 'bind group descriptors with GPU object refs are supported');
  assert.equal(manager.telemetry().externalUsageKnown, false, 'external GPU usage is reported honestly as unknown');

  assert.throws(() => manager.createBuffer('too-big', { size: 10_000_000, usage: 1 }), /Known GPU resource allocations would exceed/);

  first.lose('unknown');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(lifecycle.device, second);
  assert.equal(manager.isHandleCurrent(a), false, 'pre-loss handles become stale');
  assert.equal(a.resource.destroyed, true, 'device-loss disposal destroys old GPU handles');
  assert.equal(manager.telemetry().knownAllocatedBytes, 0);
  assert.equal(lifecycle.resources.has(manager), true, 'persistent manager re-registers after lifecycle loss cleanup');

  const recreated = manager.createBuffer('particles', { size: 1024, usage: 1 });
  assert.notEqual(recreated.resource, a.resource, 'resource is recreated on the new generation');
  assert.equal(recreated.generation, lifecycle.generation);
  second.lose('unknown');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(recreated.resource.destroyed, true, 'resources created after first reacquire are destroyed on second loss');
  assert.equal(lifecycle.resources.has(manager), true, 'persistent registration survives repeated losses without duplicates');
  assert.equal([...lifecycle.resources].filter((resource) => resource === manager).length, 1, 'persistent manager is not duplicate-registered');
  assert.equal(manager.release('particles'), true);
  assert.equal(manager.get('particles'), null);
  manager.clear();
  assert.equal(manager.telemetry().resources.length, 0);
}

function makeHeaders(values) {
  const lower = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get(name) { return lower.get(String(name).toLowerCase()) || null; } };
}

function makeJsonResponse(body, headers = {}, responseOptions = {}) {
  const text = JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  return {
    ok: responseOptions.ok ?? true,
    type: responseOptions.type || 'basic',
    url: Object.hasOwn(responseOptions, 'url') ? responseOptions.url : 'https://example.test/v4/assets/mesh.json',
    headers: makeHeaders({ 'content-type': 'application/json', 'content-length': String(bytes.byteLength), ...headers }),
    async json() { return body; },
    async text() { return text; },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

function makeStreamingResponse(chunks, headers = {}, responseOptions = {}) {
  let index = 0;
  let cancelled = false;
  return {
    ok: true,
    type: 'basic',
    url: responseOptions.url || 'https://example.test/v4/assets/stream.bin',
    get cancelled() { return cancelled; },
    headers: makeHeaders(headers),
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true };
            return { done: false, value: chunks[index++] };
          },
          async cancel() { cancelled = true; },
        };
      },
    },
  };
}

async function testAssetLoaderAndCacheContainment() {
  let fetchCount = 0;
  const loader = new AssetLoader({
    baseUrl: 'https://example.test/v4/demo.html',
    timeoutMs: 50,
    maxBytes: 128,
    fetchImpl: async () => {
      fetchCount += 1;
      await Promise.resolve();
      return makeJsonResponse({ mesh: [1, 2, 3] });
    },
  });
  const cache = new AssetCache(loader);
  const [one, two] = await Promise.all([
    cache.load('./assets/mesh.json'),
    cache.load('/v4/assets/mesh.json'),
  ]);
  assert.equal(fetchCount, 1, 'equivalent same-origin loads are in-flight deduplicated');
  assert.equal(one, two);
  assert.equal(cache.telemetry().knownBytes > 0, true);
  assert.equal(cache.release(one.key), true);
  assert.equal(cache.get(one.key), null);

  await assert.rejects(() => cache.load('https://evil.test/mesh.json'), /Cross-origin assets are rejected/);

  const hugeLoader = new AssetLoader({
    baseUrl: 'https://example.test/',
    maxBytes: 4,
    fetchImpl: async () => makeJsonResponse({ too: 'large' }, { 'content-length': '99' }),
  });
  await assert.rejects(() => hugeLoader.load('/huge.json'), /Asset exceeds configured size bound/);

  const badTypeLoader = new AssetLoader({
    baseUrl: 'https://example.test/',
    fetchImpl: async () => makeJsonResponse({ ok: true }, { 'content-type': 'text/html' }),
  });
  await assert.rejects(() => badTypeLoader.load('/page.html'), /Asset content type is not allowed/);

  const timeoutLoader = new AssetLoader({
    baseUrl: 'https://example.test/',
    timeoutMs: 1,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('network abort detail should be sanitized')), { once: true });
    }),
  });
  await assert.rejects(() => timeoutLoader.load('/slow.bin'), /Asset request was aborted or timed out/);
}

async function testAssetLoaderAdversarialContainment() {
  let fetchInit = null;
  const redirectSafe = new AssetLoader({
    baseUrl: 'https://example.test/v4/demo.html',
    allowedBasePath: '/v4/assets/',
    maxBytes: 64,
    fetchImpl: async (_url, init) => {
      fetchInit = init;
      return makeJsonResponse({ ok: 1 }, {}, { url: 'https://example.test/v4/assets/ok.json' });
    },
  });
  await redirectSafe.load('./assets/ok.json');
  assert.equal(fetchInit.redirect, 'error', 'asset fetch rejects redirects at fetch layer');
  await assert.rejects(() => redirectSafe.load('/v4/%2e%2e/secrets.json'), /Asset path traversal is rejected|outside the allowed base path/);
  await assert.rejects(() => redirectSafe.load('/private/ok.json'), /outside the allowed base path/);

  const missingFinalUrl = new AssetLoader({ baseUrl: 'https://example.test/', fetchImpl: async () => makeJsonResponse({ ok: true }, {}, { url: '' }) });
  await assert.rejects(() => missingFinalUrl.load('/v4/assets/ok.json'), /Asset final URL is unavailable/);
  const crossFinalUrl = new AssetLoader({ baseUrl: 'https://example.test/', fetchImpl: async () => makeJsonResponse({ ok: true }, {}, { url: 'https://evil.test/ok.json' }) });
  await assert.rejects(() => crossFinalUrl.load('/v4/assets/ok.json'), /Cross-origin assets are rejected/);
  const opaque = new AssetLoader({ baseUrl: 'https://example.test/', fetchImpl: async () => makeJsonResponse({ ok: true }, {}, { type: 'opaque', url: 'https://example.test/ok.json' }) });
  await assert.rejects(() => opaque.load('/v4/assets/ok.json'), /Asset request failed/);

  const streamingResponse = makeStreamingResponse([
    new Uint8Array([1, 2, 3]),
    new Uint8Array([4, 5, 6]),
  ], { 'content-type': 'application/octet-stream' });
  const streamingLoader = new AssetLoader({ baseUrl: 'https://example.test/', maxBytes: 5, fetchImpl: async () => streamingResponse });
  await assert.rejects(() => streamingLoader.load('/v4/assets/stream.bin'), /Asset exceeds configured size bound/);
  assert.equal(streamingResponse.cancelled, true, 'stream reader is cancelled as soon as maxBytes is exceeded');
}

async function testAssetCacheAbortAndStaleRaces() {
  const gate = deferred();
  let signalSeen;
  let fetchAttempts = 0;
  const loader = new AssetLoader({
    baseUrl: 'https://example.test/v4/demo.html',
    fetchImpl: async (_url, init) => {
      fetchAttempts += 1;
      signalSeen = init.signal;
      await gate.promise;
      if (init.signal.aborted) throw new Error('private abort detail');
      return makeJsonResponse({ late: true });
    },
  });
  const cache = new AssetCache(loader);
  const pending = cache.load('./assets/late.json');
  await Promise.resolve();
  cache.clear({ abortInflight: true });
  assert.equal(signalSeen.aborted, true, 'clear({abortInflight:true}) aborts active fetches');
  gate.resolve();
  await assert.rejects(() => pending, /Asset request was aborted or timed out/);
  assert.equal(cache.telemetry().entries, 0, 'aborted inflight completion cannot repopulate cache');

  const releaseGate = deferred();
  const releaseLoader = new AssetLoader({
    baseUrl: 'https://example.test/v4/demo.html',
    fetchImpl: async (_url, init) => {
      await releaseGate.promise;
      if (init.signal.aborted) throw new Error('private release abort');
      return makeJsonResponse({ late: true });
    },
  });
  const releaseCache = new AssetCache(releaseLoader);
  const released = releaseCache.load('./assets/released.json');
  await Promise.resolve();
  assert.equal(releaseCache.release('https://example.test/v4/assets/released.json'), true, 'release aborts matching inflight load');
  releaseGate.resolve();
  await assert.rejects(() => released, /Asset request was aborted or timed out/);
  assert.equal(releaseCache.telemetry().entries, 0, 'released inflight completion cannot populate cache');
  assert.equal(fetchAttempts, 1);
}

async function testRuntimeHydrationApi() {
  const lifecycle = new GpuLifecycle({ maxRetries: 0, retryDelayMs: 0 });
  const device = makeDevice('hydrate');
  await lifecycle.acquire(async () => device);
  const manager = new DeviceResourceManager(lifecycle, { labelPrefix: 'hydrate-test' });
  const cache = new AssetCache({ generatedLoaders: { 'blue-noise': async () => ({ width: 2, height: 2, pixels: new Uint8Array(16).fill(127) }) } });
  await hydrateRuntimeResources({ manager, manifest: validManifest(), assetCache: cache });
  assert.ok(manager.get('particles-a'), 'ping-pong simulation buffer A is hydrated');
  assert.ok(manager.get('particles-b'), 'ping-pong simulation buffer B is hydrated');
  assert.ok(manager.get('asset:blue-noise'), 'generated blue-noise texture asset is hydrated');
  assert.equal(device.created.some((resource) => resource.write), true, 'hydrated assets/buffers upload through queue when available');
}

async function testDefaultGeneratedPixelAssets() {
  const cache = new AssetCache({ baseUrl: 'https://example.test/v4/demo.html', maxBytes: 64 });
  const pixel = await cache.loadAssetDescriptor({ id: 'white', type: 'texture', uri: 'generated://pixel' });
  assert.equal(pixel.byteLength, 4);
  assert.deepEqual(Array.from(pixel.data.pixels), [255, 255, 255, 255], 'default generated://pixel expands to an opaque white pixel');
  assert.equal(Object.isFrozen(pixel.data), true, 'generated pixel output object is immutable');

  const explicit = [1, 2, 3, 4, 5, 6, 7, 8];
  const tex = await cache.loadAssetDescriptor({ id: 'explicit', type: 'texture', uri: 'generated://pixel-texture', width: 2, height: 1, pixels: explicit });
  explicit[0] = 99;
  assert.deepEqual(Array.from(tex.data.pixels), [1, 2, 3, 4, 5, 6, 7, 8], 'explicit pixel payload is copied before caching');

  const expanded = await cache.loadAssetDescriptor({ id: 'expanded', type: 'texture', uri: 'generated://pixel-texture', width: 2, height: 2, rgba: [9, 8, 7, 6] });
  assert.deepEqual(Array.from(expanded.data.pixels), [9, 8, 7, 6, 9, 8, 7, 6, 9, 8, 7, 6, 9, 8, 7, 6], 'single rgba payload expands across dimensions');

  await assert.rejects(() => cache.loadAssetDescriptor({ id: 'bad-width', type: 'texture', uri: 'generated://pixel', width: 0, height: 1, rgba: [1, 2, 3, 4] }), /positive bounded integer/);
  await assert.rejects(() => cache.loadAssetDescriptor({ id: 'bad-count', type: 'texture', uri: 'generated://pixel-texture', width: 2, height: 1, pixels: [1, 2, 3, 4] }), /exactly match/);
  await assert.rejects(() => cache.loadAssetDescriptor({ id: 'bad-range', type: 'texture', uri: 'generated://pixel', width: 1, height: 1, rgba: [1, 2, 3, 256] }), /integer byte/);
  await assert.rejects(() => cache.loadAssetDescriptor({ id: 'too-large', type: 'texture', uri: 'generated://pixel-texture', width: 5, height: 4, rgba: [1, 2, 3, 4] }), /exceeds configured size bound/);
  await assert.rejects(() => cache.loadAssetDescriptor({ id: 'unknown', type: 'texture', uri: 'generated://not-a-generator' }), /Scene asset could not be loaded/);
  const injectedUnknown = new AssetCache({ generatedLoaders: { 'not-a-generator': async () => ({ width: 1, height: 1, pixels: new Uint8Array(4) }) } });
  await assert.rejects(() => injectedUnknown.loadAssetDescriptor({ id: 'unknown-injected', type: 'texture', uri: 'generated://not-a-generator' }), /Scene asset could not be loaded/);
}

async function testDefaultGeneratedPixelHydratesManagedTexture() {
  const manifest = validManifest();
  manifest.assets.push({ id: 'default-pixel', type: 'texture', uri: 'generated://pixel', width: 2, height: 2, rgba: [10, 20, 30, 40] });
  manifest.assets.push({ id: 'default-pixel-texture', type: 'texture', uri: 'generated://pixel-texture', width: 1, height: 2, pixels: [1, 2, 3, 4, 5, 6, 7, 8] });
  manifest.pipelines[0].assets.push('default-pixel', 'default-pixel-texture');
  const lifecycle = new GpuLifecycle({ maxRetries: 0, retryDelayMs: 0 });
  const device = makeDevice('hydrate-default-generated');
  await lifecycle.acquire(async () => device);
  const manager = new DeviceResourceManager(lifecycle, { labelPrefix: 'hydrate-default-generated' });
  await hydrateRuntimeResources({ manager, manifest });
  assert.ok(manager.get('asset:default-pixel'), 'default AssetCache hydrates generated://pixel into a managed GPU texture');
  assert.ok(manager.get('asset:default-pixel-texture'), 'default AssetCache hydrates generated://pixel-texture into a managed GPU texture');
  assert.equal(device.created.some((resource) => resource.write && resource.write.size.width === 2 && resource.write.size.height === 2), true, 'generated pixel texture bytes upload through the GPU queue');
}

function testSceneManifestDeepValidation() {
  assert.equal(validateSceneManifest(validManifest()).ok, true);
  const duplicateAssets = validManifest();
  duplicateAssets.assets.push({ id: 'blue-noise', type: 'texture', uri: 'generated://other' });
  assert.ok(!validateSceneManifest(duplicateAssets).ok, 'duplicate asset IDs rejected');
  const missingPipelineId = validManifest();
  delete missingPipelineId.pipelines[0].id;
  assert.ok(!validateSceneManifest(missingPipelineId).ok, 'pipeline ids required');
  const invalidBufferRef = validManifest();
  invalidBufferRef.pipelines[0].buffers = ['missing-buffer'];
  assert.ok(!validateSceneManifest(invalidBufferRef).ok, 'pipeline buffer refs validated');
  const invalidAssetRef = validManifest();
  invalidAssetRef.pipelines[0].assets = ['missing-asset'];
  assert.ok(!validateSceneManifest(invalidAssetRef).ok, 'pipeline asset refs validated');
  const invalidControl = validManifest();
  invalidControl.controls[0].pipeline = 'missing-pipeline';
  assert.ok(!validateSceneManifest(invalidControl).ok, 'control pipeline refs validated');
  const invalidTransition = validManifest();
  invalidTransition.transitions[0].to = 'missing-pipeline';
  assert.ok(!validateSceneManifest(invalidTransition).ok, 'transition pipeline refs validated');
}

async function testFallbackCanvasSeparation() {
  const visibleCanvas = makeCanvas();
  const fallbackCanvas = makeCanvas();
  const result = await probeRenderer({
    canvas: visibleCanvas,
    fallbackCanvas,
    navigatorObject: { gpu: { async requestAdapter() { return null; } } },
  });
  assert.equal(result.mode, RENDERER_MODES.WEBGL2_LEGACY);
  assert.deepEqual(visibleCanvas.calls, [], 'probing fallback must not consume the visible 2D canvas context');
  assert.deepEqual(fallbackCanvas.calls, ['webgl2']);
}

function testAudioFeatureBusLogBandsAndAllocationReuse() {
  const edges = makeLogBandEdges();
  assert.equal(edges.length, AUDIO_BAND_COUNT + 1);
  assert.ok(Math.abs(edges[0] - 20) < 1e-5);
  assert.ok(Math.abs(edges[16] - 20000) < 0.1);
  const ratio0 = edges[1] / edges[0];
  const ratio8 = edges[9] / edges[8];
  assert.ok(Math.abs(ratio0 - ratio8) < 1e-5, 'band edges are logarithmic');

  const bus = new AudioFeatureBus();
  const frame = new Float32Array(129);
  frame.fill(0);
  const snap0 = bus.processSpectrum(frame, 1 / 60, { source: 'flat', state: 'flat' });
  frame.fill(0.75, 4, 40);
  const snap1 = bus.processSpectrum(frame, 1 / 60, { source: 'demo', state: 'demo' });
  const risingFlux = snap1.positiveSpectralFlux;
  const risingOnset = snap1.onsetImpulse;
  frame.fill(0);
  const snap2 = bus.processSpectrum(frame, 1 / 60, { source: 'demo', state: 'demo' });
  const fallingFlux = snap2.positiveSpectralFlux;
  assert.equal(snap0, snap1, 'snapshot object is reused to avoid per-frame object allocation');
  assert.equal(snap1.bands, snap2.bands, 'band array is reused');
  assert.equal(snap1.vec4Views[0].buffer, snap1.vec4Payload.buffer, 'vec4 views share compact payload');
  assert.ok(risingFlux > 0, 'rising frame produces positive flux');
  assert.ok(risingOnset > 0, 'rising frame produces onset impulse');
  assert.equal(fallingFlux, 0, 'falling frame clamps flux to zero');
  assert.ok(Math.max(...snap2.release) > 0, 'release values are separate from attack values');
  assert.equal(bus.own('camera-pressure'), bus.own('camera-pressure'), 'structural owners are stable');
}

function makeRafWindow({ secure = true, AudioContextCtor = null, AudioWorkletNodeCtor = null } = {}) {
  let rafId = 0;
  const callbacks = new Map();
  return {
    isSecureContext: secure,
    AudioContext: AudioContextCtor,
    webkitAudioContext: AudioContextCtor,
    AudioWorkletNode: AudioWorkletNodeCtor,
    requestAnimationFrame(callback) { rafId += 1; callbacks.set(rafId, callback); return rafId; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    flushFrame(time = 16) { const next = callbacks.entries().next(); if (!next.done) { callbacks.delete(next.value[0]); next.value[1](time); } },
  };
}

function makeTrack() {
  return { stopped: false, onended: null, stop() { this.stopped = true; } };
}

function makeStream(track = makeTrack()) {
  return { track, getTracks() { return [track]; }, getAudioTracks() { return [track]; } };
}

function testActivationToken(bridge) {
  const token = bridge.createActivationToken({ isTrusted: true });
  assert.ok(token, 'test activation validator should mint a one-shot token');
  return token;
}

function makeFallbackAudioContext() {
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 1,
    frequencyBinCount: 2048,
    disconnected: false,
    getFloatFrequencyData(target) { target.fill(-90); target.fill(-20, 12, 80); },
    disconnect() { this.disconnected = true; },
  };
  return class MockAudioContext {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.audioWorklet = null; this.closed = false; this.analyser = analyser; }
    createMediaStreamSource() { return { connected: [], connect(node) { this.connected.push(node); }, disconnect() { this.connected = []; } }; }
    createAnalyser() { return analyser; }
    async close() { this.closed = true; }
  };
}

async function testLiveAudioSecureContextAndPermissionDenial() {
  const insecureWindow = makeRafWindow({ secure: false });
  const insecure = new LiveAudioFeatureBridge({
    windowObject: insecureWindow,
    navigatorObject: { mediaDevices: { async getUserMedia() { throw new Error('must not request'); } } },
    trustedActivationValidator: () => true,
  });
  const rejected = await insecure.startMicrophone({ activationToken: testActivationToken(insecure) });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'insecure-context');
  assert.equal(insecure.getDiagnostics().state, LIVE_AUDIO_STATES.INSECURE);
  assert.equal(insecure.getDiagnostics().requestCount, 0, 'secure-context rejection must not request permission');

  let requested = 0;
  const denied = new LiveAudioFeatureBridge({
    windowObject: makeRafWindow({ secure: true, AudioContextCtor: makeFallbackAudioContext() }),
    navigatorObject: { mediaDevices: { async getUserMedia() { requested += 1; const err = new Error('denied'); err.name = 'NotAllowedError'; throw err; } } },
    trustedActivationValidator: () => true,
  });
  const result = await denied.startMicrophone({ activationToken: testActivationToken(denied) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'permission-denied');
  assert.equal(requested, 1);
  assert.equal(denied.getDiagnostics().state, LIVE_AUDIO_STATES.DENIED);
  const retry = await denied.startDemo({ gesture: true });
  assert.equal(retry.ok, true, 'demo remains recoverable after denial');
  assert.equal(denied.getDiagnostics().source, 'demo');
}

async function testLiveAudioFallbackAndStopCleanup() {
  const track = makeTrack();
  const stream = makeStream(track);
  let requested = 0;
  const win = makeRafWindow({ secure: true, AudioContextCtor: makeFallbackAudioContext() });
  const bridge = new LiveAudioFeatureBridge({
    windowObject: win,
    navigatorObject: { mediaDevices: { async getUserMedia() { requested += 1; return stream; } } },
    now: () => 1000,
    trustedActivationValidator: () => true,
  });
  const noGesture = await bridge.startMicrophone({ gesture: false });
  assert.equal(noGesture.ok, false);
  assert.equal(requested, 0, 'mic is user-gesture gated');
  const started = await bridge.startMicrophone({ activationToken: testActivationToken(bridge) });
  assert.equal(started.ok, true);
  assert.equal(bridge.getDiagnostics().state, LIVE_AUDIO_STATES.LIVE_FALLBACK);
  assert.equal(bridge.getDiagnostics().source, 'live-fallback');
  win.flushFrame(1016);
  assert.ok(Math.max(...bridge.getSnapshot().rawBands) > 0, 'fallback analyser feeds reusable feature bus');
  await bridge.stop();
  assert.equal(track.stopped, true, 'stop releases media tracks');
  assert.equal(bridge.stream, null);
  assert.equal(bridge.audioContext, null);
  assert.equal(bridge.getDiagnostics().micActive, false);
  assert.equal(bridge.getDiagnostics().state, LIVE_AUDIO_STATES.STOPPED);
}

async function testLiveAudioWorkletPathAndDeviceLoss() {
  const track = makeTrack();
  const stream = makeStream(track);
  class MockAudioWorkletNode {
    constructor() { this.port = { onmessage: null }; this.disconnected = false; }
    disconnect() { this.disconnected = true; }
  }
  class WorkletAudioContext {
    constructor() { this.state = 'running'; this.audioWorklet = { async addModule() {} }; this.closed = false; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async close() { this.closed = true; }
  }
  const win = makeRafWindow({ secure: true, AudioContextCtor: WorkletAudioContext, AudioWorkletNodeCtor: MockAudioWorkletNode });
  const bridge = new LiveAudioFeatureBridge({
    windowObject: win,
    navigatorObject: { mediaDevices: { async getUserMedia() { return stream; } } },
    trustedActivationValidator: () => true,
  });
  const started = await bridge.startMicrophone({ activationToken: testActivationToken(bridge) });
  assert.equal(started.ok, true);
  assert.equal(bridge.getDiagnostics().state, LIVE_AUDIO_STATES.LIVE_WORKLET);
  const snapBefore = bridge.getSnapshot();
  const payload = new Float32Array(AUDIO_BAND_COUNT + 3);
  payload.fill(0.5, 0, AUDIO_BAND_COUNT);
  bridge.workletNode.port.onmessage({ data: { payload } });
  assert.equal(bridge.getSnapshot(), snapBefore, 'worklet messages update the stable snapshot object');
  assert.ok(Math.max(...bridge.getSnapshot().rawBands) > 0);
  await track.onended();
  assert.equal(bridge.getDiagnostics().state, LIVE_AUDIO_STATES.DEVICE_LOST);
  assert.equal(track.stopped, true);
}

async function testForgedGestureFlagAndInactiveUserActivationCannotRequestMic() {
  let requested = 0;
  const defaultMockBridge = new LiveAudioFeatureBridge({
    windowObject: makeRafWindow({ secure: true, AudioContextCtor: makeFallbackAudioContext() }),
    navigatorObject: { mediaDevices: { async getUserMedia() { requested += 1; return makeStream(); } } },
  });
  assert.equal(defaultMockBridge.createActivationToken({ isTrusted: true }), null, 'plain mock objects cannot forge trusted browser activation');
  assert.equal((await defaultMockBridge.startMicrophone({ activationToken: { generation: 0 } })).ok, false);
  assert.equal(requested, 0, 'default non-browser public path fails closed without test validator');

  const nav = {
    userActivation: { isActive: false },
    mediaDevices: { async getUserMedia() { requested += 1; return makeStream(); } },
  };
  const bridge = new LiveAudioFeatureBridge({
    windowObject: makeRafWindow({ secure: true, AudioContextCtor: makeFallbackAudioContext() }),
    navigatorObject: nav,
    trustedActivationValidator: () => true,
  });

  const forgedGesture = await bridge.startMicrophone({ gesture: true });
  assert.equal(forgedGesture.ok, false, 'caller-supplied gesture:true is ignored');
  assert.equal(forgedGesture.error.code, 'gesture-required');
  assert.equal(requested, 0, 'forged gesture must not reach getUserMedia');

  const tokenWhileInactive = bridge.createActivationToken({ isTrusted: true });
  assert.ok(tokenWhileInactive, 'test-only validator can mint a token in mocks');
  const inactive = await bridge.startMicrophone({ activationToken: tokenWhileInactive });
  assert.equal(inactive.ok, false, 'navigator.userActivation.isActive=false fails closed at request time');
  assert.equal(requested, 0, 'inactive userActivation must not request permission');

  const staleToken = bridge.createActivationToken({ isTrusted: true });
  await bridge.stop();
  const stale = await bridge.startMicrophone({ activationToken: staleToken });
  assert.equal(stale.ok, false, 'activation tokens expire across session invalidation');
  assert.equal(requested, 0, 'stale activation token must not request permission');
}

async function testStaleCapturedWorkletHandlerAfterStopAndRestartCannotMutate() {
  const firstTrack = makeTrack();
  const secondTrack = makeTrack();
  const streams = [makeStream(firstTrack), makeStream(secondTrack)];
  const createdNodes = [];
  class MockAudioWorkletNode {
    constructor() { this.port = { onmessage: null }; this.disconnected = false; createdNodes.push(this); }
    disconnect() { this.disconnected = true; }
  }
  class WorkletAudioContext {
    constructor() { this.state = 'running'; this.audioWorklet = { async addModule() {} }; this.closed = false; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async close() { this.closed = true; }
  }
  const bridge = new LiveAudioFeatureBridge({
    windowObject: makeRafWindow({ secure: true, AudioContextCtor: WorkletAudioContext, AudioWorkletNodeCtor: MockAudioWorkletNode }),
    navigatorObject: { mediaDevices: { async getUserMedia() { return streams.shift(); } } },
    trustedActivationValidator: () => true,
  });

  assert.equal((await bridge.startMicrophone({ activationToken: testActivationToken(bridge) })).ok, true);
  const staleHandler = createdNodes[0].port.onmessage;
  const loudPayload = new Float32Array(AUDIO_BAND_COUNT + 3);
  loudPayload.fill(0.9, 0, AUDIO_BAND_COUNT);
  await bridge.stop();
  const stoppedSequence = bridge.getSnapshot().sequence;
  staleHandler({ data: { payload: loudPayload } });
  assert.equal(bridge.getSnapshot().sequence, stoppedSequence, 'stale worklet message after stop cannot mutate stopped snapshot');

  assert.equal((await bridge.startFlat({ gesture: true })).ok, true);
  const flatSequence = bridge.getSnapshot().sequence;
  staleHandler({ data: { payload: loudPayload } });
  assert.equal(bridge.getSnapshot().sequence, flatSequence, 'stale worklet message cannot mutate flat snapshot');

  assert.equal((await bridge.startMicrophone({ activationToken: testActivationToken(bridge) })).ok, true);
  const newLiveSequence = bridge.getSnapshot().sequence;
  staleHandler({ data: { payload: loudPayload } });
  assert.equal(bridge.getSnapshot().sequence, newLiveSequence, 'stale first-session handler cannot mutate restarted live snapshot');
  createdNodes[1].port.onmessage({ data: { payload: loudPayload } });
  assert.ok(bridge.getSnapshot().sequence > newLiveSequence, 'current-session handler still updates live snapshot');
}

async function testDemoFlatLabelsCannotBeConfused() {
  const bridge = new LiveAudioFeatureBridge({ windowObject: makeRafWindow({ secure: true }), navigatorObject: {} });
  await bridge.startFlat({ gesture: true });
  assert.equal(bridge.getDiagnostics().source, 'flat');
  assert.match(bridge.getDiagnostics().label, /FLAT TEST SIGNAL/);
  await bridge.startDemo({ gesture: true });
  assert.equal(bridge.getDiagnostics().source, 'demo');
  assert.match(bridge.getDiagnostics().label, /DEMO SYNTHETIC/);
  assert.equal(bridge.getDiagnostics().micActive, false);
}

function testPrismaticCathedralGeometryContracts() {
  const a = createPrismaticCathedralScene({ seed: 491009, mode: 'demo' });
  const b = createPrismaticCathedralScene({ seed: 491009, mode: 'demo' });
  const c = createPrismaticCathedralScene({ seed: 491009, mode: 'demo' });
  const summaryA = a.update({ time: 18 });
  const summaryB = b.update({ time: 18 });
  c.update({ time: 19 });
  assert.deepEqual(sceneByteSignature(a), sceneByteSignature(b), 'same seed/time/mode produces byte-identical geometry/color/index buffers');
  assert.notDeepEqual(sceneByteSignature(a), sceneByteSignature(c), 'changed time changes real geometry bytes');
  assert.equal(summaryA.archCount, 13);
  assert.equal(summaryA.shardCount, 72);
  assert.equal(summaryA.vertexCount, 7176, '13 arches + 72 shard meshes + floor runes stay within exact budget');
  assert.equal(summaryA.indexCount, summaryA.vertexCount, 'indexed draw has one deterministic index per triangle vertex');
  assert.ok(summaryA.vertexCount <= 7200);
  assert.ok(summaryA.width > 4, `broad corridor width expected > 4, got ${summaryA.width}`);
  assert.ok(summaryA.height > 3, `cathedral height expected > 3, got ${summaryA.height}`);
  assert.ok(summaryA.depth > 8, `corridor depth expected > 8, got ${summaryA.depth}`);
  assert.match(a.topology, /72 persistent real 3D prismatic shard meshes/);
  assert.ok(a.structuralAudioMappings.some((entry) => /camera pressure/.test(entry)), 'audio maps structurally to camera/travel/materials');
}

function testPrismaticCathedralGraphAndManifestContracts() {
  assert.equal(validateSceneManifest(prismaticCathedralManifest).ok, true, 'manifest accepts relative optional WebGPU shader metadata');
  const bad = structuredClone(prismaticCathedralManifest);
  bad.webgpu.shaders[0].uri = 'https://evil.test/cathedral.wgsl';
  assert.ok(!validateSceneManifest(bad).ok, 'absolute shader URIs are rejected');
  const graph = makePrismaticCathedralGraph();
  const validation = graph.validate();
  assert.equal(validation.ok, true, validation.errors.join('; '));
  const frozen = graph.freeze();
  assert.deepEqual(frozen.passes.map((pass) => pass.id), ['cathedral-geometry', 'cathedral-post', 'cathedral-composite']);
  assert.equal(frozen.resources.find((resource) => resource.id === 'cathedral-scene-depth').type, 'depth-target');
  assert.equal(frozen.resources.find((resource) => resource.id === 'cathedral-indices').type, 'index-buffer');
}

function testPrismaticCathedralExecutorUploadsAndDrawsIndexed() {
  const canvas = makeCanvas();
  canvas.getBoundingClientRect = () => ({ width: 640, height: 360 });
  const device = makeResourceDevice();
  const graph = makePrismaticCathedralGraph().freeze();
  const scene = createPrismaticCathedralScene({ seed: 491009, mode: 'demo' });
  const pipelines = createPrismaticCathedralPipelines({ device, format: 'bgra8unorm' });
  pipelines.bindGroupLayout = { id: 'test-cathedral-layout' };
  const executor = new WebGpuGraphExecutor({
    device,
    canvas,
    graph,
    resources: new Map([
      ['cathedral-uniforms', { id: 'uniforms' }],
      ['cathedral-audio', { id: 'audio' }],
      ['cathedral-positions', { id: 'positions' }],
      ['cathedral-colors', { id: 'colors' }],
      ['cathedral-indices', { id: 'indices' }],
      ['asset:edge-pixel', { id: 'edge-pixel', createView: () => ({ id: 'edge-pixel-view' }) }],
    ]),
    pipelines,
    executors: createPrismaticCathedralExecutors(),
    windowObject: { devicePixelRatio: 1 },
  });
  const frame = executor.render({ time: 18, scene, audio: null });
  assert.equal(frame.submitted, true);
  assert.deepEqual(frame.passes, ['cathedral-geometry', 'cathedral-post', 'cathedral-composite']);
  assert.equal(device.calls.writes.filter((write) => write[0] === 'buffer').length >= 5, true, 'positions/colors/indices/uniform/audio are uploaded through queue.writeBuffer');
  assert.deepEqual(device.calls.drawIndexed, [scene.mesh.indexCount, 1, 0, 0, 0], 'authored executor issues drawIndexed with real mesh indices');
  assert.equal(device.calls.submissions.length, 1, 'executor submits encoded command buffer');
  const bindGroupsAfterFirstFrame = device.created.filter((resource) => resource.descriptor?.label?.startsWith('prismatic-cathedral:')).length;
  assert.equal(bindGroupsAfterFirstFrame, 3, 'one geometry/post/composite bind group is created on the first frame');
  executor.render({ time: 18, scene, audio: null });
  const bindGroupsAfterRepeatFrame = device.created.filter((resource) => resource.descriptor?.label?.startsWith('prismatic-cathedral:')).length;
  assert.equal(bindGroupsAfterRepeatFrame, bindGroupsAfterFirstFrame, 'same-size repeated frames reuse cathedral bind groups/resources');
  assert.equal(device.calls.submissions.length, 2, 'repeat frame submits without bind-group churn');
}

function testFilamentVortexContracts() {
  assert.equal(validateSceneManifest(filamentVortexManifest).ok, true, 'filament manifest validates relative WGSL metadata');
  const graph = makeFilamentVortexGraph();
  const validation = graph.validate();
  assert.equal(validation.ok, true, validation.errors.join('; '));
  const frozen = graph.freeze();
  assert.deepEqual(frozen.passes.map((pass) => pass.id), ['filament-compute', 'filament-strands', 'filament-post', 'filament-composite'], 'compute → strands → post → composite graph order is explicit');
  assert.equal(FILAMENT_CONTRACT.strandCount, 118);
  assert.equal(FILAMENT_CONTRACT.segmentCount, 52);
  assert.equal(FILAMENT_CONTRACT.drawVertices, 118 * 51 * 6);
  const a = filamentSignature({ seed: 491009, time: 18, mode: 'demo' });
  const b = filamentSignature({ seed: 491009, time: 18, mode: 'demo' });
  const c = filamentSignature({ seed: 491009, time: 19, mode: 'demo' });
  assert.equal(a, b, 'locked filament signature is deterministic for seed/time/mode');
  assert.notEqual(a, c, 'changed locked time changes compute topology signature');
  const scene = createFilamentVortexScene({ seed: 491009, mode: 'demo', locked: true });
  const one = scene.prepareFrame({ time: 18, live: false });
  scene.prepareFrame({ time: 11, live: false });
  const two = scene.prepareFrame({ time: 18, live: false });
  assert.equal(one.summary.signature, two.summary.signature, 'locked output is history-independent after unrelated prior times');
  assert.ok(scene.structuralAudioMappings.some((entry) => /curl field/.test(entry)), 'audio structurally drives curl field, not exposure only');
}

function testFilamentExecutorDispatchDrawSubmitAndReuse() {
  const calls = { computeBinds: [], renderBinds: [], dispatches: [], draws: [], submissions: [] };
  const context = { configure() {}, getCurrentTexture() { return { createView: () => ({ id: 'swap-view' }) }; }, unconfigure() {} };
  const canvas = { width: 640, height: 360, clientWidth: 640, clientHeight: 360, getBoundingClientRect: () => ({ width: 640, height: 360 }), getContext: (kind) => kind === 'webgpu' ? context : null };
  const device = makeResourceDevice();
  device.createCommandEncoder = () => ({
    beginComputePass() { return { setPipeline() {}, setBindGroup(...args) { calls.computeBinds.push(args); }, dispatchWorkgroups(...args) { calls.dispatches.push(args); }, end() {} }; },
    beginRenderPass(descriptor) { return { setPipeline() {}, setBindGroup(...args) { calls.renderBinds.push([descriptor.label, ...args]); }, draw(...args) { calls.draws.push([descriptor.label, args]); }, end() {} }; },
    finish() { return { id: 'filament-command-buffer' }; },
  });
  device.queue.submit = (buffers) => calls.submissions.push(buffers);
  const graph = makeFilamentVortexGraph().freeze();
  const scene = createFilamentVortexScene({ seed: 491009, mode: 'demo', locked: false });
  const pipelines = createFilamentVortexPipelines({ device, format: 'bgra8unorm' });
  for (const pipeline of pipelines.values()) pipeline.layoutBindGroupCount = 1;
  pipelines.computeLayout = { id: 'test-filament-compute-layout' };
  pipelines.renderLayout = { id: 'test-filament-render-layout' };
  const resources = new Map([
    ['filament-uniforms', { id: 'uniforms' }],
    ['filament-audio', { id: 'audio' }],
    ['filament-positions-a', { id: 'positions-a' }],
    ['filament-positions-b', { id: 'positions-b' }],
    ['filament-velocities-a', { id: 'velocities-a' }],
    ['filament-velocities-b', { id: 'velocities-b' }],
    ['asset:filament-pixel', { id: 'filament-pixel', createView: () => ({ id: 'filament-pixel-view' }) }],
  ]);
  const executor = new WebGpuGraphExecutor({ device, canvas, graph, resources, pipelines, executors: createFilamentVortexExecutors(), windowObject: { devicePixelRatio: 1 } });
  const first = executor.render({ time: 18, scene, audio: null });
  assert.equal(first.submitted, true);
  assert.deepEqual(first.passes, ['filament-compute', 'filament-strands', 'filament-post', 'filament-composite']);
  assert.deepEqual(calls.dispatches[0], [FILAMENT_CONTRACT.workgroups[0], 1, 1], 'compute dispatchWorkgroups updates storage-buffer topology');
  assert.deepEqual(calls.draws.find(([label]) => label.endsWith(':filament-strands'))[1], [FILAMENT_CONTRACT.drawVertices, 1, 0, 0], 'strand render draws ribbon triangle segment geometry');
  assert.equal(calls.submissions.length, 1, 'commands are submitted');
  assert.equal(device.calls.writes.filter((write) => write[0] === 'buffer').length, 2, 'only small uniform/audio writes occur per frame, no CPU position reupload');
  assert.equal(calls.computeBinds[0][0], 0, 'compute bind group uses pipeline group 0');
  assert.ok(calls.renderBinds.every(([, slot]) => slot === 0), 'render/post/composite custom bind groups use valid pipeline group 0');
  assert.equal(device.calls.bindGroups[0].descriptor.entries[2].resource.buffer.id, 'positions-a', 'compute reads previous position buffer A first');
  assert.equal(device.calls.bindGroups[0].descriptor.entries[4].resource.buffer.id, 'positions-b', 'compute writes next position buffer B first');
  assert.equal(device.calls.bindGroups[1].descriptor.entries[2].resource.buffer.id, 'positions-b', 'render samples the just-written next position buffer');
  assert.equal(scene.pingPongParity, 1, 'successful submit transaction swaps ping-pong parity once');
  assert.equal(scene.pingPongSwapCount, 1);
  const bindGroupsAfterFirst = device.calls.bindGroups.length;
  executor.render({ time: 18.016, scene, audio: null });
  assert.equal(scene.pingPongParity, 0, 'live mode alternates physical ping-pong buffers');
  assert.equal(device.calls.bindGroups.length, bindGroupsAfterFirst + 4, 'second parity creates the alternate cached compute/render/post/composite bind groups');
  const bindGroupsAfterBothParities = device.calls.bindGroups.length;
  executor.render({ time: 18.032, scene, audio: null });
  assert.equal(device.calls.bindGroups.length, bindGroupsAfterBothParities, 'steady live frames reuse bind groups after both parities are cached');
  assert.ok(scene.liveFrame >= 2, 'live mode persistently advances the scene frame counter');

  const failingDevice = makeResourceDevice();
  failingDevice.queue.submit = () => { throw new Error('submit failed'); };
  const failingScene = createFilamentVortexScene({ seed: 491009, mode: 'demo', locked: false });
  const failingExecutor = new WebGpuGraphExecutor({ device: failingDevice, canvas, graph, resources, pipelines, executors: createFilamentVortexExecutors(), windowObject: { devicePixelRatio: 1 } });
  assert.throws(() => failingExecutor.render({ time: 1, scene: failingScene, audio: null }), /submit failed/);
  assert.equal(failingScene.pingPongParity, 0, 'failed submit does not advance ping-pong parity');
  assert.equal(failingScene.pingPongSwapCount, 0, 'failed submit does not count as a swap');

  const badGraph = makeFilamentVortexGraph().freeze();
  const badExecutors = new Map([['filament-compute-bind', createFilamentVortexExecutors().get('filament-compute-bind')], ['filament-render-bind', ({ pass }) => pass.setBindGroup(1, { id: 'invalid-slot' })]]);
  const badDevice = makeResourceDevice();
  badDevice.queue.submit = () => { throw new Error('must not submit invalid slot'); };
  const badExecutor = new WebGpuGraphExecutor({ device: badDevice, canvas, graph: badGraph, resources, pipelines, executors: badExecutors, windowObject: { devicePixelRatio: 1 } });
  assert.throws(() => badExecutor.render({ time: 2, scene: createFilamentVortexScene({ seed: 491009, mode: 'demo', locked: false }), audio: null }), /exceeds pipeline layout bind group count 1/, 'fake device rejects custom executor binding slots beyond pipeline layout');
  assert.equal(badDevice.calls.submissions.length, 0, 'invalid bind slot fails before queue.submit');
}

function testNeonVoxelCloudGeometryContracts() {
  const sceneA = createNeonVoxelCloudScene({ seed: 582114, mode: 'demo' });
  const sceneB = createNeonVoxelCloudScene({ seed: 582114, mode: 'demo' });
  const bands = demoVoxelBands(new Float32Array(16), 12.5, 582114, 'demo');
  const audio = { bands, positiveSpectralFlux: 0.12, onsetImpulse: 0.7 };
  const first = sceneA.update({ time: 12.5, audio, width: 1280, height: 720 });
  sceneA.update({ time: 1.25, audio, width: 1280, height: 720 });
  const afterHistory = sceneA.update({ time: 12.5, audio, width: 1280, height: 720 });
  const second = sceneB.update({ time: 12.5, audio, width: 1280, height: 720 });
  assert.equal(first.instanceCount, 260, 'voxel scene preserves exactly 260 coherent cells');
  assert.equal(second.instanceCount, 260);
  assert.equal(voxelByteSignature(sceneA), voxelByteSignature(sceneB), 'locked voxel bytes are history-independent for same seed/time/mode/audio');
  assert.deepEqual(afterHistory.bounds, second.bounds, 'locked bounds are deterministic after unrelated prior times');
  const later = sceneB.update({ time: 13.25, audio, width: 1280, height: 720 });
  assert.notEqual(voxelByteSignature(sceneA), voxelByteSignature(sceneB), 'changed absolute time changes transform/material payload bytes');
  assert.ok(later.topology.frontCount >= 8 && later.topology.frontCount <= 70, 'scan front selects a bounded coherent slice');
  assert.ok(later.topology.tunnelOuter > 170, 'topology stays volumetric/tunnel-like rather than generic scattered cubes');
  assert.ok(later.bounds.min[2] < -27 && later.bounds.max[2] > 7, 'deep camera-traversable z bounds are preserved');
  assert.ok(later.bounds.max[0] - later.bounds.min[0] > 8, 'wide bounded cloud volume is preserved');
  assert.equal(sceneA.structuralAudioMappings.midBands.includes('corridor'), true, 'audio mapping includes structural corridor control');
}

function testNeonVoxelCloudGraphAndManifestContracts() {
  assert.equal(neonVoxelCloudManifest.id, 'neon-voxel-cloud');
  assert.equal(neonVoxelCloudManifest.webgpu.contract.instanceCount, 260);
  const graph = makeNeonVoxelCloudGraph();
  const validation = graph.validate();
  assert.equal(validation.ok, true, validation.errors.join('; '));
  const frozen = graph.freeze();
  assert.deepEqual(frozen.passes.map((pass) => pass.id), ['voxel-compute', 'voxel-instanced-render', 'voxel-post', 'voxel-composite']);
  assert.equal(frozen.passes[0].kind, 'compute');
  assert.equal(frozen.passes[2].kind, 'post', 'fullscreen post is a declared post pass with its own sampled input/output layout');
  assert.deepEqual(frozen.passes[2].inputs, ['voxel-scene-color']);
  assert.equal(frozen.passes[2].output, 'voxel-post-color');
  assert.deepEqual(frozen.passes[0].workgroups, VOXEL_CONTRACT.computeWorkgroups, 'compute dispatch covers all 260 instances');
  assert.equal(frozen.passes[1].indexFormat, 'uint16', 'instanced cube renderer uses uint16 cube indices');
}

function testNeonVoxelCloudExecutorDispatchAndInstancedDrawReuse() {
  const scene = createNeonVoxelCloudScene({ seed: 582114, mode: 'demo' });
  const graph = makeNeonVoxelCloudGraph().freeze();
  const canvas = { width: 800, height: 450, clientWidth: 800, clientHeight: 450, getBoundingClientRect: () => ({ width: 800, height: 450 }), getContext: (kind) => kind === 'webgpu' ? { configure() {}, getCurrentTexture() { return { createView: () => ({ id: 'swap-view' }) }; }, unconfigure() {} } : null };
  const device = makeResourceDevice();
  const resources = new Map([
    ['voxel-frame', { id: 'voxel-frame' }],
    ['voxel-audio', { id: 'voxel-audio' }],
    ['voxel-base', { id: 'voxel-base' }],
    ['voxel-payload', { id: 'voxel-payload' }],
    ['voxel-cube-vertices', { id: 'voxel-cube-vertices' }],
    ['voxel-cube-indices', { id: 'voxel-cube-indices' }],
    ['asset:voxel-pixel', { id: 'voxel-pixel', createView: () => ({ id: 'voxel-pixel-view' }) }],
  ]);
  const pipelines = new Map([
    ['voxel-compute-pipeline', makePipeline('voxel-compute')],
    ['voxel-render-pipeline', makePipeline('voxel-render')],
    ['voxel-post-pipeline', makePipeline('voxel-post')],
    ['voxel-composite-pipeline', makePipeline('voxel-composite')],
  ]);
  const executor = new WebGpuGraphExecutor({ device, canvas, graph, resources, pipelines, executors: createNeonVoxelCloudExecutors(), windowObject: { devicePixelRatio: 1 } });
  const audio = { bands: demoVoxelBands(new Float32Array(16), 4, 582114, 'demo'), positiveSpectralFlux: 0.1, onsetImpulse: 0.4 };
  const frame = executor.render({ time: 4, scene, audio });
  assert.equal(frame.submitted, true);
  assert.deepEqual(frame.passes, ['voxel-compute', 'voxel-instanced-render', 'voxel-post', 'voxel-composite']);
  assert.deepEqual(device.calls.dispatch, VOXEL_CONTRACT.computeWorkgroups, 'compute dispatchWorkgroups is encoded before rendering');
  assert.deepEqual(device.calls.drawIndexed, [36, VOXEL_INSTANCE_COUNT, 0, 0, 0], 'instanced cube drawIndexed uses instanceCount 260');
  assert.equal(device.calls.indexBuffer[1], 'uint16', 'cube index buffer is bound as uint16');
  assert.equal(device.calls.submissions.length, 1, 'command buffer is submitted');
  assertNeonVoxelCloudDescriptorContracts(device.calls.bindGroups.map((group) => group.descriptor));
  const payloadBindingSets = device.calls.bindGroups
    .filter((group) => group.descriptor?.label?.startsWith('neon-voxel-cloud:'))
    .map((group) => [group.descriptor.label, group.descriptor.entries.map((entry) => entry.binding).sort((a, b) => a - b)]);
  assert.deepEqual(payloadBindingSets.find(([label]) => label.includes('voxel-compute'))[1], [0, 1, 2, 6], 'compute bind group sees base read and payload write only');
  assert.deepEqual(payloadBindingSets.find(([label]) => label.includes('voxel-instanced-render'))[1], [0, 1, 3], 'render bind group sees final payload read only');
  assert.ok(payloadBindingSets.filter(([, bindings]) => bindings.includes(3) && bindings.includes(6)).length === 0, 'no bind group binds voxel-payload as both read-only and read-write');
  const initialWrites = device.calls.writes.length;
  const bindGroupsAfterFirstFrame = device.created.filter((resource) => resource.descriptor?.label?.startsWith('neon-voxel-cloud:')).length;
  executor.render({ time: 4, scene, audio });
  assert.equal(device.created.filter((resource) => resource.descriptor?.label?.startsWith('neon-voxel-cloud:')).length, bindGroupsAfterFirstFrame, 'same-size frames reuse compute/render/post/composite bind groups');
  assert.equal(device.calls.writes.length < initialWrites + 8, true, 'steady frame does not reupload immutable base/cube instance data');
  canvas.getBoundingClientRect = () => ({ width: 1024, height: 512 });
  executor.render({ time: 4.25, scene, audio });
  assert.ok(device.created.filter((resource) => resource.descriptor?.label?.startsWith('neon-voxel-cloud:')).length > bindGroupsAfterFirstFrame, 'resize generation recreates stale texture-view bind groups safely');
}

async function testRuntimeAutoStartAndFrameCounters() {
  const device = makeDevice('locked-frame');
  const runtime = await startV4Runtime({
    canvas: makeCanvas(),
    statusElement: { dataset: {}, textContent: '' },
    manifest: validManifest(),
    graphFactory: smokeGraph,
    autoStart: false,
    navigatorObject: { gpu: { async requestAdapter() { return { features: new Set(), limits: { maxStorageBuffersPerShaderStage: 4, maxStorageBufferBindingSize: 1 << 20 }, async requestDevice() { return device; } }; } } },
    createFallbackCanvas: makeCanvas,
  });
  await runtime.resourcesReady;
  assert.equal(device.calls.submissions.length, 0, 'locked/manual runtime must not submit an implicit initial frame');
  assert.equal(runtime.frameCounters.submitted, 0);
  runtime.renderFrame(18);
  runtime.stop();
  assert.equal(device.calls.submissions.length, 1, 'locked/manual runtime submits exactly one requested frame');
  assert.equal(runtime.frameCounters.submitted, 1);
  assert.equal(runtime.frameCounters.rafScheduled, false, 'locked/manual runtime leaves no queued RAF');

  const liveDevice = makeDevice('live-frame');
  let requestId = 0;
  const callbacks = new Map();
  const windowObject = { devicePixelRatio: 1, performance: { now: () => 10 }, requestAnimationFrame(cb) { const id = ++requestId; callbacks.set(id, cb); return id; }, cancelAnimationFrame(id) { callbacks.delete(id); } };
  const live = await startV4Runtime({
    canvas: makeCanvas(),
    statusElement: { dataset: {}, textContent: '' },
    manifest: validManifest(),
    graphFactory: smokeGraph,
    frameProvider: ({ time }) => ({ time }),
    windowObject,
    navigatorObject: { gpu: { async requestAdapter() { return { features: new Set(), limits: { maxStorageBuffersPerShaderStage: 4, maxStorageBufferBindingSize: 1 << 20 }, async requestDevice() { return liveDevice; } }; } } },
    createFallbackCanvas: makeCanvas,
  });
  assert.equal(callbacks.size, 1, 'unlocked mode schedules exactly one RAF');
  const first = [...callbacks.entries()][0];
  callbacks.delete(first[0]);
  first[1](123);
  assert.equal(live.frameCounters.submitted, 1);
  assert.equal(callbacks.size, 1, 'unlocked tick queues only one next RAF');
  live.dispose();
  assert.equal(callbacks.size, 0, 'dispose cancels queued RAF');
}

await testRuntimeUsesLifecycleAndRetryBudget();
await testExplicitLifecycleBudgetResetOnly();
await testStalePendingRetryCannotReplaceExplicitReacquire();
await testRuntimeFallbackUpdatesPublicStatusContract();
testExecutableRenderGraphSubmission();
testExecutableHistoryPingPongTransactions();
testExecutablePostStackAndCompositeSubmission();
testExecutableBoundedVolumeSubmission();
testExecutableTwoLayerCrossfadeComposite();
testBoundedBloomToneMapPipelineContract();
testBoundedTrailPipelineContract();
testExecutorCanvasSizingContracts();
testExecutorFailsClosed();
await testRuntimeNoExecutorWhenUnavailableAndFallbackCleanup();
await testRuntimeRafLifecycleStopsStaleFrames();
await testDeviceResourceManagerBehavior();
await testAssetLoaderAndCacheContainment();
await testAssetLoaderAdversarialContainment();
await testAssetCacheAbortAndStaleRaces();
await testRuntimeHydrationApi();
await testDefaultGeneratedPixelAssets();
await testDefaultGeneratedPixelHydratesManagedTexture();
testRenderGraphDeepValidation();
testSceneManifestDeepValidation();
testPrismaticCathedralGeometryContracts();
testPrismaticCathedralGraphAndManifestContracts();
testPrismaticCathedralExecutorUploadsAndDrawsIndexed();
testFilamentVortexContracts();
testFilamentExecutorDispatchDrawSubmitAndReuse();
testNeonVoxelCloudGeometryContracts();
testNeonVoxelCloudGraphAndManifestContracts();
testNeonVoxelCloudExecutorDispatchAndInstancedDrawReuse();
await testRuntimeAutoStartAndFrameCounters();
await testFallbackCanvasSeparation();
testAudioFeatureBusLogBandsAndAllocationReuse();
await testLiveAudioSecureContextAndPermissionDenial();
await testLiveAudioFallbackAndStopCleanup();
await testLiveAudioWorkletPathAndDeviceLoss();
await testForgedGestureFlagAndInactiveUserActivationCannotRequestMic();
await testStaleCapturedWorkletHandlerAfterStopAndRestartCannotMutate();
await testDemoFlatLabelsCannotBeConfused();
console.log('Behavioral v4 runtime tests passed');
console.log('Covered lifecycle adoption/loss budget/stale retry aborts, fallback status, render-graph refs, manifest refs, WebGL2/2D canvas separation, live audio worklet/fallback lifecycle, permission/security gates, and allocation reuse');
