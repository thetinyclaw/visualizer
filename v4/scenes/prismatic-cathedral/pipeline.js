import { cathedralWgsl } from './shaders.js';

const VERTEX_STRIDE = 12;
const COLOR_STRIDE = 16;

export function createPrismaticCathedralPipelines({ device, format }) {
  if (!device || typeof device.createShaderModule !== 'function' || typeof device.createRenderPipeline !== 'function') {
    return new Map([
      ['cathedral-geometry-pipeline', { id: 'cathedral-geometry-pipeline-mock' }],
      ['cathedral-post-pipeline', { id: 'cathedral-post-pipeline-mock' }],
      ['cathedral-composite-pipeline', { id: 'cathedral-composite-pipeline-mock' }],
    ]);
  }
  const module = device.createShaderModule({ label: 'prismatic-cathedral-wgsl', code: cathedralWgsl });
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'prismatic-cathedral-frame-bindings',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ label: 'prismatic-cathedral-pipeline-layout', bindGroupLayouts: [bindGroupLayout] });
  const fullscreenVertex = { module, entryPoint: 'vsFullscreen' };
  const fullscreenPrimitive = { topology: 'triangle-list', cullMode: 'none' };
  const geometry = device.createRenderPipeline({
    label: 'prismatic-cathedral-geometry-pipeline',
    layout: pipelineLayout,
    vertex: {
      module,
      entryPoint: 'vsCathedral',
      buffers: [
        { arrayStride: VERTEX_STRIDE, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        { arrayStride: COLOR_STRIDE, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }] },
      ],
    },
    fragment: { module, entryPoint: 'fsCathedral', targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
  });
  const post = device.createRenderPipeline({
    label: 'prismatic-cathedral-post-pipeline',
    layout: pipelineLayout,
    vertex: fullscreenVertex,
    fragment: { module, entryPoint: 'fsPost', targets: [{ format }] },
    primitive: fullscreenPrimitive,
  });
  const composite = device.createRenderPipeline({
    label: 'prismatic-cathedral-composite-pipeline',
    layout: pipelineLayout,
    vertex: fullscreenVertex,
    fragment: { module, entryPoint: 'fsComposite', targets: [{ format }] },
    primitive: fullscreenPrimitive,
  });
  const pipelines = new Map([
    ['cathedral-geometry-pipeline', geometry],
    ['cathedral-post-pipeline', post],
    ['cathedral-composite-pipeline', composite],
  ]);
  pipelines.bindGroupLayout = bindGroupLayout;
  return pipelines;
}

function writeBuffer(device, buffer, data) {
  if (!device?.queue?.writeBuffer || !buffer) return;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  device.queue.writeBuffer(buffer, 0, bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function getFrameBindGroup({ device, pass, resources, executor, graphPass, frameContext }) {
  const pipeline = executor.pipelineRegistry.get(graphPass.pipeline);
  if (!device.createBindGroup || !pipeline) return null;
  const layout = executor.pipelineRegistry.bindGroupLayout || (typeof pipeline.getBindGroupLayout === 'function' ? pipeline.getBindGroupLayout(0) : null);
  if (!layout) return null;
  const sampler = executor._cathedralSampler || (executor._cathedralSampler = device.createSampler ? device.createSampler({ label: 'prismatic-cathedral-linear-sampler', magFilter: 'linear', minFilter: 'linear' }) : null);
  const inputTextureId = graphPass.id === 'cathedral-post'
    ? 'cathedral-scene-color'
    : (graphPass.id === 'cathedral-composite' ? 'cathedral-post-color' : 'asset:edge-pixel');
  const cacheKey = `${graphPass.id}:${inputTextureId}:${executor.textureGeneration || 0}`;
  executor._cathedralBindGroups = executor._cathedralBindGroups || new Map();
  const cached = executor._cathedralBindGroups.get(cacheKey);
  if (cached) {
    frameContext.lastBindGroup = cached;
    return cached;
  }
  const textureView = inputTextureId.startsWith('asset:') ? resources.get(inputTextureId).createView() : executor.textureView(inputTextureId);
  const bindGroup = device.createBindGroup({
    label: `prismatic-cathedral:${graphPass.id}:bind-group`,
    layout,
    entries: [
      { binding: 0, resource: { buffer: resources.get('cathedral-uniforms') } },
      { binding: 1, resource: { buffer: resources.get('cathedral-audio') } },
      { binding: 2, resource: sampler },
      { binding: 3, resource: textureView },
    ],
  });
  executor._cathedralBindGroups.set(cacheKey, bindGroup);
  frameContext.lastBindGroup = bindGroup;
  return bindGroup;
}

const EMPTY_UNIFORMS = new Float32Array(24);
const EMPTY_AUDIO = new Float32Array(20);

export function createPrismaticCathedralExecutors() {
  return new Map([
    ['cathedral-upload-and-draw', ({ pass, device, resources, frameContext, graphPass, executor }) => {
      const scene = frameContext.scene;
      const audio = frameContext.audio;
      const summary = scene.update({ time: frameContext.time || 0, audio, width: executor.width || 1280, height: executor.height || 720 });
      writeBuffer(device, resources.get('cathedral-positions'), scene.mesh.positions.subarray(0, scene.mesh.vertexCount * 3));
      writeBuffer(device, resources.get('cathedral-colors'), scene.mesh.colors.subarray(0, scene.mesh.vertexCount * 4));
      writeBuffer(device, resources.get('cathedral-indices'), scene.mesh.indices.subarray(0, scene.mesh.indexCount));
      writeBuffer(device, resources.get('cathedral-uniforms'), scene.mesh.uniforms);
      writeBuffer(device, resources.get('cathedral-audio'), scene.mesh.audioPayload);
      const bindGroup = getFrameBindGroup({ device, pass, resources, executor, graphPass, frameContext });
      if (bindGroup && typeof pass.setBindGroup === 'function') pass.setBindGroup(0, bindGroup);
      if (typeof pass.drawIndexed === 'function') pass.drawIndexed(scene.mesh.indexCount, 1, 0, 0, 0);
      frameContext.cathedralSummary = summary;
    }],
    ['cathedral-bind-fullscreen', ({ pass, device, resources, frameContext, graphPass, executor }) => {
      writeBuffer(device, resources.get('cathedral-uniforms'), frameContext.scene?.mesh?.uniforms || EMPTY_UNIFORMS);
      writeBuffer(device, resources.get('cathedral-audio'), frameContext.scene?.mesh?.audioPayload || EMPTY_AUDIO);
      const bindGroup = getFrameBindGroup({ device, pass, resources, executor, graphPass, frameContext });
      if (bindGroup && typeof pass.setBindGroup === 'function') pass.setBindGroup(0, bindGroup);
    }],
  ]);
}
