import { neonVoxelWgsl } from './shaders.js';
import { VOXEL_INSTANCE_COUNT, computeVoxelPayload } from './geometry.js';

const CUBE_VERTEX_STRIDE = 12;
const UINT16_INDEX_FORMAT = 'uint16';
const EMPTY_UNIFORMS = new Float32Array(32);
const EMPTY_AUDIO = new Float32Array(24);

function gpuStageFallback() { return { COMPUTE: 4, VERTEX: 1, FRAGMENT: 2 }; }
function gpuStage() { return globalThis.GPUShaderStage || gpuStageFallback(); }

function writeBuffer(device, buffer, data) {
  if (!device?.queue?.writeBuffer || !buffer || !ArrayBuffer.isView(data)) return;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  device.queue.writeBuffer(buffer, 0, bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function createNeonVoxelCloudPipelines({ device, format }) {
  if (!device || typeof device.createShaderModule !== 'function' || typeof device.createRenderPipeline !== 'function' || typeof device.createComputePipeline !== 'function') {
    return new Map([
      ['voxel-compute-pipeline', { id: 'voxel-compute-pipeline-mock' }],
      ['voxel-render-pipeline', { id: 'voxel-render-pipeline-mock' }],
      ['voxel-post-pipeline', { id: 'voxel-post-pipeline-mock' }],
      ['voxel-composite-pipeline', { id: 'voxel-composite-pipeline-mock' }],
    ]);
  }
  const stage = gpuStage();
  const module = device.createShaderModule({ label: 'neon-voxel-cloud-wgsl', code: neonVoxelWgsl });
  const computeBindGroupLayout = device.createBindGroupLayout({
    label: 'neon-voxel-cloud-compute-bindings',
    entries: [
      { binding: 0, visibility: stage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: stage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const renderBindGroupLayout = device.createBindGroupLayout({
    label: 'neon-voxel-cloud-render-bindings',
    entries: [
      { binding: 0, visibility: stage.VERTEX | stage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: stage.VERTEX | stage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 3, visibility: stage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const fullscreenBindGroupLayout = device.createBindGroupLayout({
    label: 'neon-voxel-cloud-fullscreen-bindings',
    entries: [
      { binding: 0, visibility: stage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: stage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 4, visibility: stage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 5, visibility: stage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const computeLayout = device.createPipelineLayout({ label: 'neon-voxel-cloud-compute-layout', bindGroupLayouts: [computeBindGroupLayout] });
  const renderLayout = device.createPipelineLayout({ label: 'neon-voxel-cloud-render-layout', bindGroupLayouts: [renderBindGroupLayout] });
  const fullscreenLayout = device.createPipelineLayout({ label: 'neon-voxel-cloud-fullscreen-layout', bindGroupLayouts: [fullscreenBindGroupLayout] });
  const compute = device.createComputePipeline({ label: 'neon-voxel-cloud-compute-pipeline', layout: computeLayout, compute: { module, entryPoint: 'csVoxel' } });
  const render = device.createRenderPipeline({
    label: 'neon-voxel-cloud-instanced-render-pipeline',
    layout: renderLayout,
    vertex: { module, entryPoint: 'vsVoxel', buffers: [{ arrayStride: CUBE_VERTEX_STRIDE, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
    fragment: { module, entryPoint: 'fsVoxel', targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const post = device.createRenderPipeline({ label: 'neon-voxel-cloud-post-pipeline', layout: fullscreenLayout, vertex: { module, entryPoint: 'vsFullscreen' }, fragment: { module, entryPoint: 'fsPost', targets: [{ format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' } });
  const composite = device.createRenderPipeline({ label: 'neon-voxel-cloud-composite-pipeline', layout: fullscreenLayout, vertex: { module, entryPoint: 'vsFullscreen' }, fragment: { module, entryPoint: 'fsComposite', targets: [{ format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' } });
  const pipelines = new Map([
    ['voxel-compute-pipeline', compute],
    ['voxel-render-pipeline', render],
    ['voxel-post-pipeline', post],
    ['voxel-composite-pipeline', composite],
  ]);
  pipelines.bindGroupLayouts = Object.freeze({
    compute: computeBindGroupLayout,
    render: renderBindGroupLayout,
    fullscreen: fullscreenBindGroupLayout,
  });
  return pipelines;
}

function ensureImmutableUploads({ device, resources, frameContext, executor }) {
  const scene = frameContext.scene;
  if (!scene || executor._voxelImmutableUploaded) return;
  writeBuffer(device, resources.get('voxel-base'), scene.base);
  writeBuffer(device, resources.get('voxel-cube-vertices'), scene.cube.vertices);
  writeBuffer(device, resources.get('voxel-cube-indices'), scene.cube.indices);
  executor._voxelImmutableUploaded = true;
  executor._voxelImmutableUploadGeneration = executor.textureGeneration || 0;
}

function bindGroupInputTexture(graphPass) {
  if (graphPass.id === 'voxel-post') return 'voxel-scene-color';
  if (graphPass.id === 'voxel-composite') return 'voxel-post-color';
  return 'asset:voxel-pixel';
}

function layoutKindForPass(graphPass) {
  if (graphPass.id === 'voxel-compute') return 'compute';
  if (graphPass.id === 'voxel-instanced-render') return 'render';
  return 'fullscreen';
}

function bindGroupEntriesForPass({ graphPass, resources, sampler, textureView }) {
  if (graphPass.id === 'voxel-compute') {
    return [
      { binding: 0, resource: { buffer: resources.get('voxel-frame') } },
      { binding: 1, resource: { buffer: resources.get('voxel-audio') } },
      { binding: 2, resource: { buffer: resources.get('voxel-base') } },
      { binding: 6, resource: { buffer: resources.get('voxel-payload') } },
    ];
  }
  if (graphPass.id === 'voxel-instanced-render') {
    return [
      { binding: 0, resource: { buffer: resources.get('voxel-frame') } },
      { binding: 1, resource: { buffer: resources.get('voxel-audio') } },
      { binding: 3, resource: { buffer: resources.get('voxel-payload') } },
    ];
  }
  return [
    { binding: 0, resource: { buffer: resources.get('voxel-frame') } },
    { binding: 1, resource: { buffer: resources.get('voxel-audio') } },
    { binding: 4, resource: sampler },
    { binding: 5, resource: textureView },
  ];
}

export function assertNeonVoxelCloudDescriptorContracts(bindGroups) {
  const byLabel = new Map((bindGroups || []).map((descriptor) => [descriptor.label, descriptor]));
  const expected = Object.freeze({
    'neon-voxel-cloud:voxel-compute:bind-group': [0, 1, 2, 6],
    'neon-voxel-cloud:voxel-instanced-render:bind-group': [0, 1, 3],
    'neon-voxel-cloud:voxel-post:bind-group': [0, 1, 4, 5],
    'neon-voxel-cloud:voxel-composite:bind-group': [0, 1, 4, 5],
  });
  for (const [label, bindings] of Object.entries(expected)) {
    const descriptor = byLabel.get(label);
    if (!descriptor) throw new Error(`missing ${label}`);
    const actual = descriptor.entries.map((entry) => entry.binding).sort((a, b) => a - b);
    if (actual.join(',') !== bindings.join(',')) throw new Error(`${label} bindings ${actual.join(',')} did not match ${bindings.join(',')}`);
  }
  const compute = byLabel.get('neon-voxel-cloud:voxel-compute:bind-group');
  const render = byLabel.get('neon-voxel-cloud:voxel-instanced-render:bind-group');
  if (compute.entries.some((entry) => entry.binding === 3) || render.entries.some((entry) => entry.binding === 6)) {
    throw new Error('voxel payload read/write bindings must be split across compute and render bind groups');
  }
  return true;
}

function getVoxelBindGroup({ device, resources, executor, graphPass, frameContext }) {
  const pipeline = executor.pipelineRegistry.get(graphPass.pipeline);
  if (!device.createBindGroup || !pipeline) return null;
  const layoutKind = layoutKindForPass(graphPass);
  const layout = executor.pipelineRegistry.bindGroupLayouts?.[layoutKind] || (typeof pipeline.getBindGroupLayout === 'function' ? pipeline.getBindGroupLayout(0) : null);
  if (!layout) return null;
  const sampler = executor._voxelSampler || (executor._voxelSampler = device.createSampler ? device.createSampler({ label: 'neon-voxel-cloud-linear-sampler', magFilter: 'linear', minFilter: 'linear' }) : null);
  const inputTextureId = bindGroupInputTexture(graphPass);
  const cacheKey = `${layoutKind}:${graphPass.id}:${inputTextureId}:${executor.textureGeneration || 0}`;
  executor._voxelBindGroups = executor._voxelBindGroups || new Map();
  const cached = executor._voxelBindGroups.get(cacheKey);
  if (cached) { frameContext.lastBindGroup = cached; return cached; }
  const textureView = inputTextureId.startsWith('asset:') ? resources.get(inputTextureId)?.createView?.() : executor.textureView(inputTextureId);
  const bindGroupDescriptor = {
    label: `neon-voxel-cloud:${graphPass.id}:bind-group`,
    layout,
    entries: bindGroupEntriesForPass({ graphPass, resources, sampler, textureView }),
  };
  const bindGroup = device.createBindGroup(bindGroupDescriptor);
  frameContext.voxelBindGroupDescriptors = frameContext.voxelBindGroupDescriptors || [];
  frameContext.voxelBindGroupDescriptors.push({ label: bindGroupDescriptor.label, entries: bindGroupDescriptor.entries.map((entry) => ({ binding: entry.binding })) });
  executor._voxelBindGroups.set(cacheKey, bindGroup);
  frameContext.lastBindGroup = bindGroup;
  return bindGroup;
}

function updateFramePayload({ device, resources, frameContext, executor }) {
  const scene = frameContext.scene;
  if (!scene) return null;
  const summary = scene.update({ time: frameContext.time || 0, audio: frameContext.audio, width: executor.width || 1280, height: executor.height || 720 });
  writeBuffer(device, resources.get('voxel-frame'), scene.uniforms);
  writeBuffer(device, resources.get('voxel-audio'), scene.audioPayload);
  // Deterministic CPU mirror for tests/telemetry only. Production instance transforms/materials are updated by csVoxel into voxel-payload.
  computeVoxelPayload({ base: scene.base, out: scene.payload, time: frameContext.time || 0, audio: frameContext.audio, seed: scene.seed, mode: scene.mode });
  frameContext.voxelSummary = summary;
  return summary;
}

export function createNeonVoxelCloudExecutors() {
  return new Map([
    ['voxel-upload-frame-and-bind-compute', ({ pass, device, resources, frameContext, graphPass, executor }) => {
      ensureImmutableUploads({ device, resources, frameContext, executor });
      const summary = updateFramePayload({ device, resources, frameContext, executor });
      const bindGroup = getVoxelBindGroup({ device, resources, executor, graphPass, frameContext });
      if (bindGroup && typeof pass.setBindGroup === 'function') pass.setBindGroup(0, bindGroup);
      frameContext.computeDispatch = { workgroups: graphPass.workgroups, instances: VOXEL_INSTANCE_COUNT, summary };
    }],
    ['voxel-bind-render', ({ pass, device, resources, frameContext, graphPass, executor }) => {
      const bindGroup = getVoxelBindGroup({ device, resources, executor, graphPass, frameContext });
      if (bindGroup && typeof pass.setBindGroup === 'function') pass.setBindGroup(0, bindGroup);
      if (typeof pass.drawIndexed === 'function') pass.drawIndexed(36, VOXEL_INSTANCE_COUNT, 0, 0, 0);
      frameContext.instancedDraw = { indexed: true, indexCount: 36, instanceCount: VOXEL_INSTANCE_COUNT };
    }],
    ['voxel-bind-fullscreen', ({ pass, device, resources, frameContext, graphPass, executor }) => {
      writeBuffer(device, resources.get('voxel-frame'), frameContext.scene?.uniforms || EMPTY_UNIFORMS);
      writeBuffer(device, resources.get('voxel-audio'), frameContext.scene?.audioPayload || EMPTY_AUDIO);
      const bindGroup = getVoxelBindGroup({ device, resources, executor, graphPass, frameContext });
      if (bindGroup && typeof pass.setBindGroup === 'function') pass.setBindGroup(0, bindGroup);
    }],
  ]);
}

export { UINT16_INDEX_FORMAT };
