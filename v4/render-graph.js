// Scene-specific render graph primitives for Visualizer v4.

export const PASS_KINDS = Object.freeze({
  COMPUTE: 'compute',
  VOLUME: 'bounded-volume',
  FEEDBACK: 'feedback',
  POST: 'post',
  COMPOSITE: 'composite',
});

export function storageBuffer(id, byteLength, usage = 'read-write') {
  if (!Number.isInteger(byteLength) || byteLength <= 0) throw new TypeError('storageBuffer byteLength must be positive.');
  return Object.freeze({ type: 'storage-buffer', id, byteLength, usage });
}

export function pingPongState(id, descriptor) {
  return Object.freeze({ type: 'ping-pong-state', id, current: `${id}:a`, next: `${id}:b`, descriptor });
}

export function instancedDepthTarget(id, { format = 'depth24plus', instances = 1 } = {}) {
  return Object.freeze({ type: 'instanced-depth-target', id, format, instances });
}

export function computePass(id, { pipeline, inputs = [], outputs = [], workgroups = [1, 1, 1] }) {
  return Object.freeze({ kind: PASS_KINDS.COMPUTE, id, pipeline, inputs, outputs, workgroups });
}

export function boundedVolumePass(id, { pipeline, bounds, depthTarget, inputs = [], outputs = [] }) {
  return Object.freeze({ kind: PASS_KINDS.VOLUME, id, pipeline, bounds, depthTarget, inputs, outputs });
}

export function feedbackPass(id, { source, history, blend = 0.92 }) {
  return Object.freeze({ kind: PASS_KINDS.FEEDBACK, id, source, history, blend });
}

export function postPass(id, { pipeline, inputs = [], output }) {
  return Object.freeze({ kind: PASS_KINDS.POST, id, pipeline, inputs, output });
}

export function compositePass(id, { layers = [], transition = null, output = 'swapchain' }) {
  return Object.freeze({ kind: PASS_KINDS.COMPOSITE, id, layers, transition, output });
}

export class RenderGraph {
  constructor({ id }) {
    this.id = id;
    this.resources = [];
    this.passes = [];
  }

  addResource(resource) {
    this.resources.push(resource);
    return this;
  }

  addPass(pass) {
    this.passes.push(pass);
    return this;
  }

  validate() {
    const errors = [];
    const resourceIds = new Set(this.resources.map((resource) => resource.id));
    const passIds = new Set();
    for (const pass of this.passes) {
      if (passIds.has(pass.id)) errors.push(`duplicate pass id: ${pass.id}`);
      passIds.add(pass.id);
      if (!Object.values(PASS_KINDS).includes(pass.kind)) errors.push(`invalid pass kind: ${pass.kind}`);
      for (const input of pass.inputs || []) {
        if (!resourceIds.has(input)) errors.push(`pass ${pass.id} references missing input ${input}`);
      }
      for (const output of pass.outputs || []) {
        if (output !== 'swapchain' && !resourceIds.has(output)) errors.push(`pass ${pass.id} references missing output ${output}`);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  freeze() {
    const result = this.validate();
    if (!result.ok) {
      const error = new Error('Invalid render graph.');
      error.publicErrors = result.errors.map((message) => ({ message }));
      throw error;
    }
    return Object.freeze({ id: this.id, resources: Object.freeze([...this.resources]), passes: Object.freeze([...this.passes]) });
  }
}

export function makeSceneGraphFoundation(sceneId) {
  return new RenderGraph({ id: sceneId })
    .addResource(storageBuffer('audio-features', 16 * 4, 'read-only'))
    .addResource(storageBuffer('particle-state-a', 1024 * 16, 'read-write'))
    .addResource(storageBuffer('particle-state-b', 1024 * 16, 'read-write'))
    .addResource(pingPongState('particle-state', { a: 'particle-state-a', b: 'particle-state-b' }))
    .addResource(instancedDepthTarget('scene-depth', { instances: 1024 }))
    .addResource(storageBuffer('post-color', 1920 * 1080 * 4, 'render-target'))
    .addPass(computePass('simulate', { pipeline: 'scene-simulate', inputs: ['audio-features', 'particle-state-a'], outputs: ['particle-state-b'], workgroups: [16, 1, 1] }))
    .addPass(boundedVolumePass('volume', { pipeline: 'scene-volume', bounds: [-1, -1, -1, 1, 1, 1], depthTarget: 'scene-depth', inputs: ['particle-state-b'], outputs: ['scene-depth'] }))
    .addPass(feedbackPass('feedback', { source: 'scene-depth', history: 'particle-state' }))
    .addPass(postPass('post', { pipeline: 'bloom-tonemap', inputs: ['scene-depth'], output: 'post-color' }))
    .addPass(compositePass('composite', { layers: ['post-color'], transition: 'crossfade', output: 'swapchain' }));
}
