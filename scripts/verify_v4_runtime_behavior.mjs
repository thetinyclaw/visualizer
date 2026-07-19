import assert from 'node:assert/strict';
import { probeRenderer, RENDERER_MODES } from '../v4/capability.js';
import { GpuLifecycle, GPU_LIFECYCLE_STATES } from '../v4/gpu-lifecycle.js';
import { RenderGraph, storageBuffer, instancedDepthTarget, computePass, boundedVolumePass, feedbackPass, postPass, compositePass } from '../v4/render-graph.js';
import { validateSceneManifest } from '../v4/scene-manifest.js';
import { startV4Runtime, hydrateRuntimeResources } from '../v4/runtime.js';
import { DeviceResourceManager } from '../v4/resource-manager.js';
import { AssetCache, AssetLoader } from '../v4/asset-loader.js';
import { WebGpuGraphExecutor } from '../v4/render-graph-executor.js';
import { AudioFeatureBus, AUDIO_BAND_COUNT, makeLogBandEdges } from '../v4/audio-feature-bus.js';
import { LiveAudioFeatureBridge, LIVE_AUDIO_STATES } from '../v4/live-audio-engine.js';

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
    createSampler(descriptor) { return { descriptor, destroyed: false, destroy() { this.destroyed = true; } }; },
    createBindGroupLayout(descriptor) { return { descriptor, destroyed: false, destroy() { this.destroyed = true; } }; },
    createBindGroup(descriptor) { return { descriptor, destroyed: false, destroy() { this.destroyed = true; } }; },
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

await testRuntimeUsesLifecycleAndRetryBudget();
await testExplicitLifecycleBudgetResetOnly();
await testStalePendingRetryCannotReplaceExplicitReacquire();
await testRuntimeFallbackUpdatesPublicStatusContract();
testExecutableRenderGraphSubmission();
await testDeviceResourceManagerBehavior();
await testAssetLoaderAndCacheContainment();
await testAssetLoaderAdversarialContainment();
await testAssetCacheAbortAndStaleRaces();
await testRuntimeHydrationApi();
await testDefaultGeneratedPixelAssets();
await testDefaultGeneratedPixelHydratesManagedTexture();
testRenderGraphDeepValidation();
testSceneManifestDeepValidation();
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
