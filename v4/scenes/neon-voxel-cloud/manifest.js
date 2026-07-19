import { RenderGraph, uniformBuffer, storageBuffer, vertexBuffer, indexBuffer, renderTarget, depthTarget, computePass, renderPass, compositePass } from '../../render-graph.js';
import { VOXEL_AUDIO_BYTES, VOXEL_BASE_BYTES, VOXEL_CONTRACT, VOXEL_FRAME_BYTES, VOXEL_INSTANCE_COUNT, VOXEL_PAYLOAD_BYTES } from './geometry.js';

export const neonVoxelCloudManifest = Object.freeze({
  schemaVersion: 1,
  id: 'neon-voxel-cloud',
  title: 'Neon Voxel Cloud WebGPU',
  assets: [{ id: 'voxel-pixel', type: 'texture', uri: 'generated://pixel', width: 1, height: 1, rgba: [60, 255, 180, 255] }],
  pipelines: [
    { id: 'voxel-compute-pipeline', kind: 'compute', entryPoint: 'csVoxel' },
    { id: 'voxel-render-pipeline', kind: 'render', entryPoint: 'vsVoxel/fsVoxel', instances: VOXEL_INSTANCE_COUNT },
    { id: 'voxel-post-pipeline', kind: 'post', entryPoint: 'vsFullscreen/fsPost' },
    { id: 'voxel-composite-pipeline', kind: 'composite', entryPoint: 'vsFullscreen/fsComposite' },
  ],
  simulationBuffers: [],
  controls: [{ id: 'audio-mode', type: 'choice', options: ['demo', 'flat'], default: 'demo', pipeline: 'voxel-compute-pipeline' }],
  transitions: [{ id: 'voxel-locked-cut', type: 'cut', from: 'voxel-render-pipeline', to: 'voxel-composite-pipeline', durationMs: 0 }],
  webgpu: Object.freeze({
    shaders: Object.freeze([{ id: 'voxel-wgsl', uri: './scenes/neon-voxel-cloud/voxel.wgsl' }]),
    contract: VOXEL_CONTRACT,
  }),
});

export function makeNeonVoxelCloudGraph() {
  return new RenderGraph({ id: 'neon-voxel-cloud-webgpu-graph' })
    .addResource(uniformBuffer('voxel-frame', VOXEL_FRAME_BYTES))
    .addResource(uniformBuffer('voxel-audio', VOXEL_AUDIO_BYTES))
    .addResource(storageBuffer('voxel-base', VOXEL_BASE_BYTES, 'read-only'))
    .addResource(storageBuffer('voxel-payload', VOXEL_PAYLOAD_BYTES, 'read-write'))
    .addResource(vertexBuffer('voxel-cube-vertices', 8 * 3 * 4, { stride: 12 }))
    .addResource(indexBuffer('voxel-cube-indices', 36 * 2, { format: 'uint16' }))
    .addResource(renderTarget('voxel-scene-color'))
    .addResource(depthTarget('voxel-scene-depth'))
    .addResource(renderTarget('voxel-post-color'))
    .addPass(computePass('voxel-compute', {
      pipeline: 'voxel-compute-pipeline',
      inputs: ['voxel-base', 'voxel-frame', 'voxel-audio'],
      outputs: ['voxel-payload'],
      workgroups: VOXEL_CONTRACT.computeWorkgroups,
      executor: 'voxel-upload-frame-and-bind-compute',
    }))
    .addPass(renderPass('voxel-instanced-render', {
      pipeline: 'voxel-render-pipeline',
      colorTargets: ['voxel-scene-color'],
      depthTarget: 'voxel-scene-depth',
      vertexBuffers: ['voxel-cube-vertices'],
      indexBuffer: 'voxel-cube-indices',
      indexFormat: 'uint16',
      executor: 'voxel-bind-render',
      clearColor: { r: 0.001, g: 0.002, b: 0.012, a: 1 },
    }))
    .addPass(renderPass('voxel-post', {
      pipeline: 'voxel-post-pipeline',
      colorTargets: ['voxel-post-color'],
      executor: 'voxel-bind-fullscreen',
      draw: [3, 1, 0, 0],
      clearColor: { r: 0.003, g: 0.006, b: 0.016, a: 1 },
    }))
    .addPass(compositePass('voxel-composite', {
      layers: ['voxel-post-color'],
      output: 'swapchain',
      pipeline: 'voxel-composite-pipeline',
      executor: 'voxel-bind-fullscreen',
      draw: [3, 1, 0, 0],
      clearColor: { r: 0.002, g: 0.004, b: 0.012, a: 1 },
    }));
}
