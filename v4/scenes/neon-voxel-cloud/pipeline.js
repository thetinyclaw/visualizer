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
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'neon-voxel-cloud-frame-bindings',
    entries: [
      { binding: 0, visibility: stage.COMPUTE | stage.VERTEX | stage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: stage.COMPUTE | stage.VERTEX | stage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: stage.COMPUTE | stage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: stage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: stage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 5, visibility: stage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 6, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ label: 'neon-voxel-cloud-pipeline-layout', bindGroupLayouts: [bindGroupLayout] });
  const compute = device.createComputePipeline({ label: 'neon-voxel-cloud-compute-pipeline', layout: pipelineLayout, compute: { module, entryPoint: 'csVoxel' } });
  const render = device.createRenderPipeline({
    label: 'neon-voxel-cloud-instanced-render-pipeline',
    layout: pipelineLayout,
    vertex: { module, entryPoint: 'vsVoxel', buffers: [{ arrayStride: CUBE_VERTEX_STRIDE, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
    fragment: { module, entryPoint: 'fsVoxel', targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const post = device.createRenderPipeline({ label: 'neon-voxel-cloud-post-pipeline', layout: pipelineLayout, vertex: { module, entryPoint: 'vsFullscreen' }, fragment: { module, entryPoint: 'fsPost', targets: [{ format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' } });
  const composite = device.createRenderPipeline({ label: 'neon-voxel-cloud-composite-pipeline', layout: pipelineLayout, vertex: { module, entryPoint: 'vsFullscreen' }, fragment: { module, entryPoint: 'fsComposite', targets: [{ format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' } });
  const pipelines = new Map([
    ['voxel-compute-pipeline', compute],
    ['voxel-render-pipeline', render],
    ['voxel-post-pipeline', post],
    ['voxel-composite-pipeline', composite],
  ]);
  pipelines.bindGroupLayout = bindGroupLayout;
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

function getVoxelBindGroup({ device, resources, executor, graphPass, frameContext }) {
  const pipeline = executor.pipelineRegistry.get(graphPass.pipeline);
  if (!device.createBindGroup || !pipeline) return null;
  const layout = executor.pipelineRegistry.bindGroupLayout || (typeof pipeline.getBindGroupLayout === 'function' ? pipeline.getBindGroupLayout(0) : null);
  if (!layout) return null;
  const sampler = executor._voxelSampler || (executor._voxelSampler = device.createSampler ? device.createSampler({ label: 'neon-voxel-cloud-linear-sampler', magFilter: 'linear', minFilter: 'linear' }) : null);
  const inputTextureId = bindGroupInputTexture(graphPass);
  const cacheKey = `${graphPass.id}:${inputTextureId}:${executor.textureGeneration || 0}`;
  executor._voxelBindGroups = executor._voxelBindGroups || new Map();
  const cached = executor._voxelBindGroups.get(cacheKey);
  if (cached) { frameContext.lastBindGroup = cached; return cached; }
  const textureView = inputTextureId.startsWith('asset:') ? resources.get(inputTextureId)?.createView?.() : executor.textureView(inputTextureId);
  const bindGroup = device.createBindGroup({
    label: `neon-voxel-cloud:${graphPass.id}:bind-group`,
    layout,
    entries: [
      { binding: 0, resource: { buffer: resources.get('voxel-frame') } },
      { binding: 1, resource: { buffer: resources.get('voxel-audio') } },
      { binding: 2, resource: { buffer: resources.get('voxel-base') } },
      { binding: 3, resource: { buffer: resources.get('voxel-payload') } },
      { binding: 4, resource: sampler },
      { binding: 5, resource: textureView },
      { binding: 6, resource: { buffer: resources.get('voxel-payload') } },
    ],
  });
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
