import { filamentVortexWgsl } from './shaders.js';

function gpuStage() {
  return globalThis.GPUShaderStage || { COMPUTE: 4, VERTEX: 1, FRAGMENT: 2 };
}

export function createFilamentVortexPipelines({ device, format }) {
  if (!device || typeof device.createShaderModule !== 'function' || typeof device.createRenderPipeline !== 'function' || typeof device.createComputePipeline !== 'function') {
    return new Map([
      ['filament-compute-pipeline', { id: 'filament-compute-pipeline-mock' }],
      ['filament-strand-pipeline', { id: 'filament-strand-pipeline-mock' }],
      ['filament-post-pipeline', { id: 'filament-post-pipeline-mock' }],
      ['filament-composite-pipeline', { id: 'filament-composite-pipeline-mock' }],
    ]);
  }
  const stage = gpuStage();
  const computeModule = device.createShaderModule({ label: 'filament-vortex-compute-wgsl', code: filamentVortexWgsl });
  const renderModule = device.createShaderModule({ label: 'filament-vortex-render-wgsl', code: filamentVortexWgsl.replaceAll('@group(0)', '@group(7)').replaceAll('@group(1)', '@group(0)') });
  const computeLayout = device.createBindGroupLayout({
    label: 'filament-vortex-compute-layout',
    entries: [
      { binding: 0, visibility: stage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: stage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const renderLayout = device.createBindGroupLayout({
    label: 'filament-vortex-render-layout',
    entries: [
      { binding: 0, visibility: stage.VERTEX | stage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: stage.VERTEX | stage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: stage.VERTEX | stage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: stage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 4, visibility: stage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const computePipeline = device.createComputePipeline({
    label: 'filament-vortex-compute-pipeline',
    layout: device.createPipelineLayout({ label: 'filament-vortex-compute-pipeline-layout', bindGroupLayouts: [computeLayout] }),
    compute: { module: computeModule, entryPoint: 'csSimulate' },
  });
  const renderPipelineLayout = device.createPipelineLayout({ label: 'filament-vortex-render-pipeline-layout', bindGroupLayouts: [renderLayout] });
  const strandPipeline = device.createRenderPipeline({
    label: 'filament-vortex-strand-pipeline',
    layout: renderPipelineLayout,
    vertex: { module: renderModule, entryPoint: 'vsStrand' },
    fragment: { module: renderModule, entryPoint: 'fsStrand', targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
  });
  const fullscreenVertex = { module: renderModule, entryPoint: 'vsFullscreen' };
  const primitive = { topology: 'triangle-list', cullMode: 'none' };
  const postPipeline = device.createRenderPipeline({ label: 'filament-vortex-post-pipeline', layout: renderPipelineLayout, vertex: fullscreenVertex, fragment: { module: renderModule, entryPoint: 'fsPost', targets: [{ format }] }, primitive });
  const compositePipeline = device.createRenderPipeline({ label: 'filament-vortex-composite-pipeline', layout: renderPipelineLayout, vertex: fullscreenVertex, fragment: { module: renderModule, entryPoint: 'fsComposite', targets: [{ format }] }, primitive });
  const pipelines = new Map([
    ['filament-compute-pipeline', computePipeline],
    ['filament-strand-pipeline', strandPipeline],
    ['filament-post-pipeline', postPipeline],
    ['filament-composite-pipeline', compositePipeline],
  ]);
  pipelines.computeLayout = computeLayout;
  pipelines.renderLayout = renderLayout;
  return pipelines;
}

function writeBuffer(device, buffer, data) {
  if (!device?.queue?.writeBuffer || !buffer || !data) return;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  device.queue.writeBuffer(buffer, 0, bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function ensureSampler(device, executor) {
  return executor._filamentSampler || (executor._filamentSampler = device.createSampler ? device.createSampler({ label: 'filament-vortex-linear-sampler', magFilter: 'linear', minFilter: 'linear' }) : null);
}
function bindGroupCache(executor) {
  return executor._filamentBindGroups || (executor._filamentBindGroups = new Map());
}
function getComputeBindGroup({ device, resources, executor }) {
  if (!device.createBindGroup) return null;
  const cache = bindGroupCache(executor);
  const key = `compute:${executor.textureGeneration || 0}`;
  if (cache.has(key)) return cache.get(key);
  const bindGroup = device.createBindGroup({
    label: 'filament-vortex-compute-bind-group',
    layout: executor.pipelineRegistry.computeLayout || executor.pipelineRegistry.get('filament-compute-pipeline')?.getBindGroupLayout?.(0),
    entries: [
      { binding: 0, resource: { buffer: resources.get('filament-uniforms') } },
      { binding: 1, resource: { buffer: resources.get('filament-audio') } },
      { binding: 2, resource: { buffer: resources.get('filament-positions') } },
      { binding: 3, resource: { buffer: resources.get('filament-velocities') } },
    ],
  });
  cache.set(key, bindGroup);
  return bindGroup;
}
function getRenderBindGroup({ device, resources, executor, graphPass }) {
  if (!device.createBindGroup) return null;
  const cache = bindGroupCache(executor);
  const inputTextureId = graphPass.id === 'filament-post' ? 'filament-scene-color' : (graphPass.id === 'filament-composite' ? 'filament-post-color' : 'asset:filament-pixel');
  const key = `${graphPass.id}:${inputTextureId}:${executor.textureGeneration || 0}`;
  if (cache.has(key)) return cache.get(key);
  const sampler = ensureSampler(device, executor);
  const textureView = inputTextureId.startsWith('asset:') ? resources.get(inputTextureId)?.createView() : executor.textureView(inputTextureId);
  const bindGroup = device.createBindGroup({
    label: `filament-vortex:${graphPass.id}:bind-group`,
    layout: executor.pipelineRegistry.renderLayout || executor.pipelineRegistry.get(graphPass.pipeline)?.getBindGroupLayout?.(0),
    entries: [
      { binding: 0, resource: { buffer: resources.get('filament-uniforms') } },
      { binding: 1, resource: { buffer: resources.get('filament-audio') } },
      { binding: 2, resource: { buffer: resources.get('filament-positions') } },
      { binding: 3, resource: sampler },
      { binding: 4, resource: textureView },
    ],
  });
  cache.set(key, bindGroup);
  return bindGroup;
}

export function createFilamentVortexExecutors() {
  return new Map([
    ['filament-compute-bind', ({ pass, device, resources, frameContext, executor }) => {
      const scene = frameContext.scene;
      const dt = Number.isFinite(scene?.lastTime) ? Math.max(0, (frameContext.time || 0) - scene.lastTime) : 1 / 60;
      const prepared = scene.prepareFrame({ time: frameContext.time || 0, dt, audio: frameContext.audio, width: executor.width || 1280, height: executor.height || 720, live: !scene.locked });
      writeBuffer(device, resources.get('filament-uniforms'), prepared.uniforms);
      writeBuffer(device, resources.get('filament-audio'), prepared.bands);
      const bindGroup = getComputeBindGroup({ device, resources, executor });
      if (bindGroup && typeof pass.setBindGroup === 'function') pass.setBindGroup(0, bindGroup);
      frameContext.filamentSummary = prepared.summary;
      executor._filamentDispatches = (executor._filamentDispatches || 0) + 1;
    }],
    ['filament-render-bind', ({ pass, device, resources, graphPass, executor }) => {
      const bindGroup = getRenderBindGroup({ device, resources, executor, graphPass });
      if (bindGroup && typeof pass.setBindGroup === 'function') pass.setBindGroup(1, bindGroup);
      executor._filamentDrawCalls = (executor._filamentDrawCalls || 0) + (graphPass.id === 'filament-strands' ? 1 : 0);
    }],
  ]);
}
