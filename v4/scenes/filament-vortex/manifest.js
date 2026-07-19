import { RenderGraph, uniformBuffer, storageBuffer, renderTarget, depthTarget, computePass, renderPass, postPass, compositePass } from '../../render-graph.js';
import { FILAMENT_AUDIO_BYTES, FILAMENT_CONTRACT, FILAMENT_DRAW_VERTICES, FILAMENT_POSITION_BYTES, FILAMENT_UNIFORM_BYTES, FILAMENT_VELOCITY_BYTES, FILAMENT_WORKGROUPS } from './geometry.js';

export const filamentVortexManifest = Object.freeze({
  schemaVersion: 1,
  id: 'filament-vortex',
  title: 'Filament Vortex WebGPU',
  assets: [{ id: 'filament-pixel', type: 'texture', uri: 'generated://pixel', width: 1, height: 1, rgba: [190, 220, 255, 255] }],
  pipelines: [
    { id: 'filament-compute-pipeline', kind: 'compute', entryPoint: 'csSimulate', assets: ['filament-pixel'] },
    { id: 'filament-strand-pipeline', kind: 'render', entryPoint: 'vsStrand/fsStrand', assets: ['filament-pixel'] },
    { id: 'filament-post-pipeline', kind: 'post', entryPoint: 'vsFullscreen/fsPost' },
    { id: 'filament-composite-pipeline', kind: 'composite', entryPoint: 'vsFullscreen/fsComposite' },
  ],
  simulationBuffers: [],
  controls: [{ id: 'audio-mode', type: 'choice', options: ['demo', 'flat'], default: 'demo', pipeline: 'filament-compute-pipeline' }],
  transitions: [{ id: 'filament-cut', type: 'cut', from: 'filament-strand-pipeline', to: 'filament-composite-pipeline', durationMs: 0 }],
  webgpu: Object.freeze({ shaders: Object.freeze([{ id: 'filament-vortex-wgsl', uri: './scenes/filament-vortex/filament-vortex.wgsl' }]), contract: FILAMENT_CONTRACT }),
});

export function makeFilamentVortexGraph() {
  return new RenderGraph({ id: 'filament-vortex-webgpu-graph' })
    .addResource(uniformBuffer('filament-uniforms', FILAMENT_UNIFORM_BYTES))
    .addResource(uniformBuffer('filament-audio', FILAMENT_AUDIO_BYTES))
    .addResource(storageBuffer('filament-positions-a', FILAMENT_POSITION_BYTES))
    .addResource(storageBuffer('filament-positions-b', FILAMENT_POSITION_BYTES))
    .addResource(storageBuffer('filament-velocities-a', FILAMENT_VELOCITY_BYTES))
    .addResource(storageBuffer('filament-velocities-b', FILAMENT_VELOCITY_BYTES))
    .addResource(renderTarget('filament-scene-color'))
    .addResource(depthTarget('filament-scene-depth'))
    .addResource(renderTarget('filament-post-color'))
    .addPass(computePass('filament-compute', {
      pipeline: 'filament-compute-pipeline',
      inputs: ['filament-uniforms', 'filament-audio', 'filament-positions-a', 'filament-velocities-a'],
      outputs: ['filament-positions-b', 'filament-velocities-b'],
      workgroups: [FILAMENT_WORKGROUPS, 1, 1],
      executor: 'filament-compute-bind',
    }))
    .addPass(renderPass('filament-strands', {
      pipeline: 'filament-strand-pipeline',
      colorTargets: ['filament-scene-color'],
      depthTarget: 'filament-scene-depth',
      executor: 'filament-render-bind',
      draw: [FILAMENT_DRAW_VERTICES, 1, 0, 0],
      clearColor: { r: 0.001, g: 0.002, b: 0.010, a: 1 },
    }))
    .addPass(postPass('filament-post', {
      pipeline: 'filament-post-pipeline',
      inputs: ['filament-scene-color'],
      output: 'filament-post-color',
      executor: 'filament-render-bind',
      draw: [3, 1, 0, 0],
      clearColor: { r: 0.002, g: 0.003, b: 0.012, a: 1 },
    }))
    .addPass(compositePass('filament-composite', {
      layers: ['filament-post-color'],
      output: 'swapchain',
      pipeline: 'filament-composite-pipeline',
      executor: 'filament-render-bind',
      draw: [3, 1, 0, 0],
      clearColor: { r: 0.001, g: 0.002, b: 0.008, a: 1 },
    }));
}
