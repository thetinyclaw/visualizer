import assert from 'node:assert/strict';
import { probeRenderer, RENDERER_MODES } from '../v4/capability.js';
import { GpuLifecycle, GPU_LIFECYCLE_STATES } from '../v4/gpu-lifecycle.js';
import { RenderGraph, storageBuffer, instancedDepthTarget, computePass, boundedVolumePass, feedbackPass, postPass, compositePass } from '../v4/render-graph.js';
import { validateSceneManifest } from '../v4/scene-manifest.js';
import { startV4Runtime } from '../v4/runtime.js';
import { AssetCache, GpuResourceManager } from '../v4/resource-manager.js';
import { WebGpuGraphExecutor } from '../v4/render-graph-executor.js';

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
  const calls = { buffers: [], textures: [], writes: [], submissions: [] };
  return {
    calls,
    queue: {
      writeBuffer(...args) { calls.writes.push(['buffer', ...args]); },
      writeTexture(...args) { calls.writes.push(['texture', ...args]); },
      submit(buffers) { calls.submissions.push(buffers); },
    },
    createCommandEncoder() {
      return {
        beginRenderPass(descriptor) { calls.renderPass = descriptor; return { end() {} }; },
        finish() { return { id: 'runtime-command-buffer' }; },
      };
    },
    createBuffer(descriptor) {
      const resource = { descriptor, destroyed: false, destroy() { this.destroyed = true; } };
      calls.buffers.push(resource);
      return resource;
    },
    createTexture(descriptor) {
      const resource = { descriptor, destroyed: false, destroy() { this.destroyed = true; }, createView() { return { texture: resource }; } };
      calls.textures.push(resource);
      return resource;
    },
  };
}

function testExecutableRenderGraphSubmission() {
  const calls = { configure: [], passes: [], submissions: [] };
  const context = {
    configure(descriptor) { calls.configure.push(descriptor); },
    getCurrentTexture() { return { createView: () => ({ id: 'swap-view' }) }; },
    unconfigure() { calls.unconfigured = true; },
  };
  const canvas = { width: 640, height: 360, getContext: (kind) => kind === 'webgpu' ? context : null };
  const device = makeResourceDevice();
  device.createCommandEncoder = () => ({
    beginRenderPass(descriptor) {
      calls.passes.push(descriptor);
      return { end() { calls.ended = true; } };
    },
    finish() { return { id: 'command-buffer' }; },
  });
  device.queue.submit = (buffers) => calls.submissions.push(buffers);
  const graph = new RenderGraph({ id: 'executable' })
    .addResource(instancedDepthTarget('scene-depth'))
    .addResource(storageBuffer('post-color', 16))
    .addPass(compositePass('composite', { layers: ['post-color'], output: 'swapchain' }))
    .freeze();
  const executor = new WebGpuGraphExecutor({ device, canvas, graph, format: 'bgra8unorm' });
  assert.equal(calls.configure.length, 1, 'GPUCanvasContext is configured once');
  const frame = executor.render({ clearColor: { r: 0.02, g: 0.04, b: 0.08, a: 1 } });
  assert.equal(frame.submitted, true);
  assert.equal(calls.passes.length, 1, 'a real render pass is encoded');
  assert.equal(calls.passes[0].depthStencilAttachment.view.texture.descriptor.format, 'depth24plus');
  assert.deepEqual(calls.submissions[0], [{ id: 'command-buffer' }], 'finished commands reach queue.submit');
  executor.dispose();
  assert.equal(calls.unconfigured, true);
  assert.equal(device.calls.textures[0].destroyed, true, 'owned depth target is destroyed');
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
    navigatorObject: { gpu: { async requestAdapter() { return adapter; } } },
    gpuLifecycleOptions: { maxRetries: 2, retryDelayMs: 0 },
    createFallbackCanvas: makeCanvas,
  });
  assert.equal(runtime.mode, RENDERER_MODES.WEBGPU_REDUCED);
  assert.equal(requestCount, 1, 'initial requestDevice should happen during probing only');
  assert.equal(runtime.lifecycle.device, first, 'probed device must be adopted through lifecycle.acquire');
  assert.equal(runtime.resourceManager.size, 3, 'ping-pong buffers and manifest texture are materialized');
  assert.equal(first.calls.buffers.length, 2);
  assert.equal(first.calls.textures.length, 2, 'manifest texture and graph depth target are materialized');
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
  assert.ok(!base().addPass(feedbackPass('f', { source: 'missing', history: 'input', output: 'output' })).validate().ok, 'feedback source must exist');
  assert.ok(!base().addPass(feedbackPass('f', { source: 'input', history: 'missing', output: 'output' })).validate().ok, 'feedback history must exist');
  assert.ok(!base().addPass(feedbackPass('f', { source: 'input', history: 'output' })).validate().ok, 'feedback output required');
  assert.ok(!base().addPass(compositePass('c', { layers: [], output: 'swapchain' })).validate().ok, 'composite layers required');
  assert.ok(!base().addPass(compositePass('c', { layers: ['missing'], output: 'swapchain' })).validate().ok, 'composite layer must exist');
  assert.ok(!base().addPass(boundedVolumePass('v', { pipeline: 'volume', bounds: [-1, -1, -1, 1, 1, 1], inputs: ['input'], outputs: ['output'] })).validate().ok, 'bounded volume depth target required');
  assert.ok(base().addPass(computePass('ok-compute', { pipeline: 'sim', inputs: ['input'], outputs: ['output'] }))
    .addPass(boundedVolumePass('ok-volume', { pipeline: 'volume', bounds: [-1, -1, -1, 1, 1, 1], depthTarget: 'depth', inputs: ['input'], outputs: ['output'] }))
    .addPass(feedbackPass('ok-feedback', { source: 'output', history: 'input', output: 'output' }))
    .addPass(postPass('ok-post', { pipeline: 'post', inputs: ['output'], output: 'output' }))
    .addPass(compositePass('ok-composite', { layers: ['output'], output: 'swapchain' })).validate().ok);
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

await testRuntimeUsesLifecycleAndRetryBudget();
await testExplicitLifecycleBudgetResetOnly();
await testStalePendingRetryCannotReplaceExplicitReacquire();
await testRuntimeFallbackUpdatesPublicStatusContract();
await testResourceManagerAndAssetCache();
testExecutableRenderGraphSubmission();
testRenderGraphDeepValidation();
testSceneManifestDeepValidation();
await testFallbackCanvasSeparation();
console.log('Behavioral v4 runtime tests passed');
console.log('Covered lifecycle adoption/loss budget/stale retry aborts, fallback status, render-graph refs, manifest refs, and WebGL2/2D canvas separation');
