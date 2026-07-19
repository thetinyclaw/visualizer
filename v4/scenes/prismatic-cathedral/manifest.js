import { RenderGraph, uniformBuffer, vertexBuffer, indexBuffer, renderTarget, depthTarget, renderPass, compositePass } from '../../render-graph.js';
import { CATHEDRAL_CONTRACT, UNIFORM_BYTES, AUDIO_BYTES } from './geometry.js';

export const prismaticCathedralManifest = Object.freeze({
  schemaVersion: 1,
  id: 'prismatic-cathedral',
  title: 'Prismatic Cathedral WebGPU',
  assets: [{ id: 'edge-pixel', type: 'texture', uri: 'generated://pixel', width: 1, height: 1, rgba: [120, 220, 255, 255] }],
  pipelines: [
    { id: 'cathedral-geometry-pipeline', kind: 'render', entryPoint: 'vsCathedral/fsCathedral', assets: ['edge-pixel'] },
    { id: 'cathedral-post-pipeline', kind: 'post', entryPoint: 'vsFullscreen/fsPost' },
    { id: 'cathedral-composite-pipeline', kind: 'composite', entryPoint: 'vsFullscreen/fsComposite' },
  ],
  simulationBuffers: [],
  controls: [{ id: 'audio-mode', type: 'choice', options: ['demo', 'flat'], default: 'demo', pipeline: 'cathedral-geometry-pipeline' }],
  transitions: [{ id: 'cathedral-cut', type: 'cut', from: 'cathedral-geometry-pipeline', to: 'cathedral-composite-pipeline', durationMs: 0 }],
  webgpu: Object.freeze({
    shaders: Object.freeze([{ id: 'cathedral-wgsl', uri: './scenes/prismatic-cathedral/cathedral.wgsl' }]),
    contract: CATHEDRAL_CONTRACT,
  }),
});

export function makePrismaticCathedralGraph() {
  return new RenderGraph({ id: 'prismatic-cathedral-webgpu-graph' })
    .addResource(uniformBuffer('cathedral-uniforms', UNIFORM_BYTES))
    .addResource(uniformBuffer('cathedral-audio', AUDIO_BYTES))
    .addResource(vertexBuffer('cathedral-positions', CATHEDRAL_CONTRACT.maxTriangleVertices * 3 * 4, { stride: 12 }))
    .addResource(vertexBuffer('cathedral-colors', CATHEDRAL_CONTRACT.maxTriangleVertices * 4 * 4, { stride: 16 }))
    .addResource(indexBuffer('cathedral-indices', CATHEDRAL_CONTRACT.maxIndices * 4, { format: 'uint32' }))
    .addResource(renderTarget('cathedral-scene-color'))
    .addResource(depthTarget('cathedral-scene-depth'))
    .addResource(renderTarget('cathedral-post-color'))
    .addPass(renderPass('cathedral-geometry', {
      pipeline: 'cathedral-geometry-pipeline',
      colorTargets: ['cathedral-scene-color'],
      depthTarget: 'cathedral-scene-depth',
      vertexBuffers: ['cathedral-positions', 'cathedral-colors'],
      indexBuffer: 'cathedral-indices',
      indexFormat: 'uint32',
      executor: 'cathedral-upload-and-draw',
      clearColor: { r: 0.002, g: 0.004, b: 0.014, a: 1 },
    }))
    .addPass(renderPass('cathedral-post', {
      pipeline: 'cathedral-post-pipeline',
      colorTargets: ['cathedral-post-color'],
      executor: 'cathedral-bind-fullscreen',
      draw: [3, 1, 0, 0],
      clearColor: { r: 0.006, g: 0.010, b: 0.024, a: 1 },
    }))
    .addPass(compositePass('cathedral-composite', {
      layers: ['cathedral-post-color'],
      output: 'swapchain',
      pipeline: 'cathedral-composite-pipeline',
      executor: 'cathedral-bind-fullscreen',
      draw: [3, 1, 0, 0],
      clearColor: { r: 0.004, g: 0.006, b: 0.016, a: 1 },
    }));
}
