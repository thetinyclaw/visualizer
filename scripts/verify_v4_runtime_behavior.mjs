import assert from 'node:assert/strict';
import { probeRenderer, RENDERER_MODES } from '../v4/capability.js';
import { GpuLifecycle, GPU_LIFECYCLE_STATES } from '../v4/gpu-lifecycle.js';
import { RenderGraph, storageBuffer, instancedDepthTarget, computePass, boundedVolumePass, feedbackPass, postPass, compositePass } from '../v4/render-graph.js';
import { validateSceneManifest } from '../v4/scene-manifest.js';
import { startV4Runtime } from '../v4/runtime.js';

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => { resolve = innerResolve; });
  return { promise, resolve };
}

function makeDevice(id) {
  const lost = deferred();
  return { id, lost: lost.promise, lose: (reason = 'unknown') => lost.resolve({ reason }), destroyed: false, destroy() { this.destroyed = true; } };
}

function makeCanvas() {
  const calls = [];
  return {
    calls,
    getContext(kind) {
      calls.push(kind);
      return kind === 'webgl2' ? { kind } : { kind };
    },
  };
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
  adapter.requestDevice = async () => { requestCount += 1; return requestCount === 2 ? second : third; };
  first.lose('unknown');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runtime.lifecycle.device, second, 'first loss should reacquire');
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
testRenderGraphDeepValidation();
testSceneManifestDeepValidation();
await testFallbackCanvasSeparation();
console.log('Behavioral v4 runtime tests passed');
console.log('Covered lifecycle adoption/loss budget, render-graph refs, manifest refs, and WebGL2/2D canvas separation');
