// Scene-specific render graph primitives for Visualizer v4.

export const PASS_KINDS = Object.freeze({
  COMPUTE: 'compute',
  RENDER: 'render',
  VOLUME: 'bounded-volume',
  FEEDBACK: 'feedback',
  POST: 'post',
  HISTORY: 'history',
  COMPOSITE: 'composite',
});

const RESOURCE_TYPES = Object.freeze({
  STORAGE_BUFFER: 'storage-buffer',
  UNIFORM_BUFFER: 'uniform-buffer',
  VERTEX_BUFFER: 'vertex-buffer',
  INDEX_BUFFER: 'index-buffer',
  RENDER_TARGET: 'render-target',
  DEPTH_TARGET: 'depth-target',
  PING_PONG: 'ping-pong-state',
  HISTORY_TARGET: 'history-target',
  INSTANCED_DEPTH: 'instanced-depth-target',
});

function positiveBytes(byteLength, label) {
  if (!Number.isInteger(byteLength) || byteLength <= 0) throw new TypeError(`${label} byteLength must be positive.`);
}

export function storageBuffer(id, byteLength, usage = 'read-write') {
  positiveBytes(byteLength, 'storageBuffer');
  return Object.freeze({ type: RESOURCE_TYPES.STORAGE_BUFFER, id, byteLength, usage });
}

export function uniformBuffer(id, byteLength) {
  positiveBytes(byteLength, 'uniformBuffer');
  return Object.freeze({ type: RESOURCE_TYPES.UNIFORM_BUFFER, id, byteLength });
}

export function vertexBuffer(id, byteLength, { stride = 0 } = {}) {
  positiveBytes(byteLength, 'vertexBuffer');
  return Object.freeze({ type: RESOURCE_TYPES.VERTEX_BUFFER, id, byteLength, stride });
}

export function indexBuffer(id, byteLength, { format = 'uint32' } = {}) {
  positiveBytes(byteLength, 'indexBuffer');
  return Object.freeze({ type: RESOURCE_TYPES.INDEX_BUFFER, id, byteLength, format });
}

export function renderTarget(id, { format = 'bgra8unorm', canvasSized = true } = {}) {
  return Object.freeze({ type: RESOURCE_TYPES.RENDER_TARGET, id, format, canvasSized });
}

export function depthTarget(id, { format = 'depth24plus', canvasSized = true } = {}) {
  return Object.freeze({ type: RESOURCE_TYPES.DEPTH_TARGET, id, format, canvasSized });
}

export function pingPongState(id, descriptor) {
  return Object.freeze({ type: RESOURCE_TYPES.PING_PONG, id, current: `${id}-a`, next: `${id}-b`, descriptor });
}

export function historyTarget(id, { format = 'bgra8unorm', canvasSized = true, decay = 0.88 } = {}) {
  return Object.freeze({
    type: RESOURCE_TYPES.HISTORY_TARGET,
    id,
    format,
    canvasSized,
    previous: `${id}:previous`,
    next: `${id}:next`,
    decay: Math.max(0, Math.min(Number(decay) || 0, 0.98)),
  });
}

export function instancedDepthTarget(id, { format = 'depth24plus', instances = 1 } = {}) {
  return Object.freeze({ type: RESOURCE_TYPES.INSTANCED_DEPTH, id, format, instances });
}

export function computePass(id, { pipeline, inputs = [], outputs = [], workgroups = [1, 1, 1], executor = null, resources = [] }) {
  return Object.freeze({ kind: PASS_KINDS.COMPUTE, id, pipeline, inputs, outputs, workgroups, executor, resources });
}

export function renderPass(id, { pipeline, colorTargets = [], depthTarget: depthRef = null, vertexBuffers = [], indexBuffer: indexRef = null, indexFormat = 'uint32', resources = [], draw = null, drawIndexed = null, executor = null, clearColor = null }) {
  return Object.freeze({ kind: PASS_KINDS.RENDER, id, pipeline, colorTargets, depthTarget: depthRef, vertexBuffers, indexBuffer: indexRef, indexFormat, resources, draw, drawIndexed, executor, clearColor });
}

export function boundedVolumePass(id, { pipeline, bounds, depthTarget: depthRef, inputs = [], outputs = [], resources = [], draw = [3, 1, 0, 0], executor = null, clearColor = null }) {
  return Object.freeze({ kind: PASS_KINDS.VOLUME, id, pipeline, bounds, depthTarget: depthRef, inputs, outputs, resources, draw, executor, clearColor });
}

export function feedbackPass(id, { source, history, output, blend = 0.92 }) {
  return Object.freeze({ kind: PASS_KINDS.FEEDBACK, id, source, history, output, blend });
}

export function postPass(id, { pipeline, inputs = [], output, resources = [], draw = [3, 1, 0, 0], executor = null, clearColor = null, history = null } = {}) {
  return Object.freeze({ kind: PASS_KINDS.POST, id, pipeline, inputs, output, resources, draw, executor, clearColor, history });
}

export function historyPass(id, { pipeline, source, history, resources = [], draw = [3, 1, 0, 0], executor = null, clearColor = null, decay = null, clampMax = 1.0 } = {}) {
  return Object.freeze({ kind: PASS_KINDS.HISTORY, id, pipeline, source, history, resources, draw, executor, clearColor, decay, clampMax });
}

export function compositePass(id, { layers = [], transition = null, output = 'swapchain', pipeline = null, resources = [], draw = null, executor = null, clearColor = null }) {
  return Object.freeze({ kind: PASS_KINDS.COMPOSITE, id, layers, transition, output, pipeline, resources, draw, executor, clearColor });
}

const RESOURCE_ALIAS_FIELDS = Object.freeze(['aliasOf', 'viewOf', 'resourceId', 'sourceResource', 'targetResource']);

function resourceAliasTarget(resource) {
  for (const field of RESOURCE_ALIAS_FIELDS) {
    if (typeof resource?.[field] === 'string' && resource[field].length > 0) return resource[field];
  }
  return null;
}

function canonicalResourceId(id, resourceById) {
  if (id === 'swapchain') return 'swapchain';
  let current = id;
  const seen = new Set();
  while (typeof current === 'string' && resourceById.has(current) && !seen.has(current)) {
    seen.add(current);
    const next = resourceAliasTarget(resourceById.get(current));
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

function hasReadWriteHazard(inputs, output, resourceById) {
  if (typeof output !== 'string' || output.length === 0 || !Array.isArray(inputs)) return false;
  const outputIdentity = canonicalResourceId(output, resourceById);
  return inputs.some((input) => typeof input === 'string' && canonicalResourceId(input, resourceById) === outputIdentity);
}

export class RenderGraph {
  constructor({ id }) {
    this.id = id;
    this.resources = [];
    this.passes = [];
  }

  addResource(resource) { this.resources.push(resource); return this; }
  addPass(pass) { this.passes.push(pass); return this; }

  validate() {
    const errors = [];
    const resourceIds = new Set();
    const resourceById = new Map();
    for (const resource of this.resources) {
      if (!resource || typeof resource.id !== 'string' || resource.id.length === 0) { errors.push('resource id is required'); continue; }
      if (resourceIds.has(resource.id)) errors.push(`duplicate resource id: ${resource.id}`);
      resourceIds.add(resource.id); resourceById.set(resource.id, resource);
    }
    for (const resource of this.resources) {
      if (resource?.type === RESOURCE_TYPES.PING_PONG) {
        for (const ref of [resource.current, resource.next]) if (!resourceIds.has(ref)) errors.push(`ping-pong resource ${resource.id} references missing buffer ${ref}`);
      }
      if (resource?.type === RESOURCE_TYPES.HISTORY_TARGET) {
        if (resource.previous === resource.next) errors.push(`history resource ${resource.id} previous/next targets must be distinct`);
      }
    }
    const hasResource = (id) => id === 'swapchain' || resourceIds.has(id);
    const typeOf = (id) => id === 'swapchain' ? 'swapchain' : resourceById.get(id)?.type;
    const requireResource = (pass, field, id) => {
      if (typeof id !== 'string' || id.length === 0) errors.push(`pass ${pass.id} requires ${field}`);
      else if (!hasResource(id)) errors.push(`pass ${pass.id} references missing ${field} ${id}`);
    };
    const requireResourceList = (pass, field, ids, { allowEmpty = false } = {}) => {
      if (!Array.isArray(ids) || (!allowEmpty && ids.length === 0)) { errors.push(`pass ${pass.id} requires ${field}`); return; }
      for (const id of ids) requireResource(pass, field, id);
    };
    const requireType = (pass, field, id, allowed) => {
      requireResource(pass, field, id);
      if (typeof id === 'string' && hasResource(id) && !allowed.includes(typeOf(id))) errors.push(`pass ${pass.id} ${field} ${id} must be ${allowed.join(' or ')}`);
    };
    const passIds = new Set();
    const written = new Set();
    for (const pass of this.passes) {
      if (!pass || typeof pass.id !== 'string' || pass.id.length === 0) { errors.push('pass id is required'); continue; }
      if (passIds.has(pass.id)) errors.push(`duplicate pass id: ${pass.id}`);
      passIds.add(pass.id);
      if (!Object.values(PASS_KINDS).includes(pass.kind)) errors.push(`invalid pass kind: ${pass.kind}`);
      requireResourceList(pass, 'input', pass.inputs || [], { allowEmpty: true });
      requireResourceList(pass, 'output', pass.outputs || [], { allowEmpty: true });
      const outputs = [];
      switch (pass.kind) {
        case PASS_KINDS.COMPUTE:
          if (typeof pass.pipeline !== 'string' || pass.pipeline.length === 0) errors.push(`pass ${pass.id} requires pipeline`);
          if (!Array.isArray(pass.workgroups) || pass.workgroups.length < 1 || pass.workgroups.length > 3 || pass.workgroups.some((value) => !Number.isInteger(value) || value <= 0)) errors.push(`pass ${pass.id} requires positive integer workgroups`);
          outputs.push(...(pass.outputs || []));
          break;
        case PASS_KINDS.RENDER:
          if (typeof pass.pipeline !== 'string' || pass.pipeline.length === 0) errors.push(`pass ${pass.id} requires pipeline`);
          if (!pass.executor && !pass.draw && !pass.drawIndexed) errors.push(`pass ${pass.id} requires draw or executor`);
          requireResourceList(pass, 'colorTarget', pass.colorTargets);
          for (const target of pass.colorTargets || []) requireType(pass, 'colorTarget', target, [RESOURCE_TYPES.RENDER_TARGET, 'swapchain']);
          if (pass.depthTarget !== null) requireType(pass, 'depthTarget', pass.depthTarget, [RESOURCE_TYPES.DEPTH_TARGET, RESOURCE_TYPES.INSTANCED_DEPTH]);
          for (const ref of pass.vertexBuffers || []) requireType(pass, 'vertexBuffer', ref, [RESOURCE_TYPES.VERTEX_BUFFER]);
          if (pass.indexBuffer) requireType(pass, 'indexBuffer', pass.indexBuffer, [RESOURCE_TYPES.INDEX_BUFFER]);
          outputs.push(...(pass.colorTargets || []), ...(pass.depthTarget ? [pass.depthTarget] : []));
          break;
        case PASS_KINDS.VOLUME:
          if (typeof pass.pipeline !== 'string' || pass.pipeline.length === 0) errors.push(`pass ${pass.id} requires pipeline`);
          if (!Array.isArray(pass.bounds) || pass.bounds.length !== 6 || pass.bounds.some((value) => !Number.isFinite(value)) || pass.bounds.slice(0, 3).some((value, index) => value >= pass.bounds[index + 3])) errors.push(`pass ${pass.id} requires ordered finite min/max bounds`);
          if (!pass.executor && !pass.draw) errors.push(`pass ${pass.id} requires draw or executor`);
          requireType(pass, 'depthTarget', pass.depthTarget, [RESOURCE_TYPES.DEPTH_TARGET, RESOURCE_TYPES.INSTANCED_DEPTH]);
          requireResourceList(pass, 'output', pass.outputs);
          for (const target of pass.outputs || []) requireType(pass, 'output', target, [RESOURCE_TYPES.RENDER_TARGET]);
          outputs.push(...(pass.outputs || []));
          break;
        case PASS_KINDS.FEEDBACK:
          requireResource(pass, 'source', pass.source); requireResource(pass, 'history', pass.history); requireResource(pass, 'output', pass.output); outputs.push(pass.output); break;
        case PASS_KINDS.POST:
          if (typeof pass.pipeline !== 'string' || pass.pipeline.length === 0) errors.push(`pass ${pass.id} requires pipeline`);
          requireResourceList(pass, 'input', pass.inputs); requireType(pass, 'output', pass.output, [RESOURCE_TYPES.RENDER_TARGET]);
          for (const input of pass.inputs || []) requireType(pass, 'input', input, [RESOURCE_TYPES.RENDER_TARGET]);
          if (hasReadWriteHazard(pass.inputs, pass.output, resourceById)) errors.push(`pass ${pass.id} post pass cannot sample from and render into the same target`);
          if (pass.history !== null) errors.push(`pass ${pass.id} history post mode is not executable in this foundation`);
          outputs.push(pass.output); break;
        case PASS_KINDS.HISTORY: {
          if (typeof pass.pipeline !== 'string' || pass.pipeline.length === 0) errors.push(`pass ${pass.id} requires pipeline`);
          requireType(pass, 'source', pass.source, [RESOURCE_TYPES.RENDER_TARGET]);
          requireType(pass, 'history', pass.history, [RESOURCE_TYPES.HISTORY_TARGET]);
          const history = resourceById.get(pass.history);
          if (history) {
            const sourceIdentity = canonicalResourceId(pass.source, resourceById);
            if (sourceIdentity === history.previous || sourceIdentity === history.next || sourceIdentity === canonicalResourceId(pass.history, resourceById)) errors.push(`pass ${pass.id} history source must not alias ping-pong targets`);
          }
          outputs.push(pass.history);
          break;
        }
        case PASS_KINDS.COMPOSITE:
          requireResourceList(pass, 'layer', pass.layers); requireResource(pass, 'output', pass.output || 'swapchain');
          for (const layer of pass.layers || []) requireType(pass, 'layer', layer, [RESOURCE_TYPES.RENDER_TARGET, RESOURCE_TYPES.HISTORY_TARGET]);
          if ((pass.output || 'swapchain') !== 'swapchain') errors.push(`pass ${pass.id} composite output must be swapchain`);
          break;
        default: break;
      }
      for (const output of outputs.filter((id) => id !== 'swapchain')) {
        if (written.has(output)) errors.push(`resource ${output} is written by more than one pass`);
        written.add(output);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  freeze() {
    const result = this.validate();
    if (!result.ok) { const error = new Error('Invalid render graph.'); error.publicErrors = result.errors.map((message) => ({ message })); throw error; }
    return Object.freeze({ id: this.id, resources: Object.freeze([...this.resources]), passes: Object.freeze([...this.passes]) });
  }
}

// Roadmap graph: bounded volume and post are executable; legacy feedback remains
// intentionally fail-closed until it is represented by a history ping-pong pass.
export function makeSceneGraphFoundation(sceneId) {
  return new RenderGraph({ id: sceneId })
    .addResource(storageBuffer('audio-features', 16 * 4, 'read-only'))
    .addResource(storageBuffer('particle-state-a', 1024 * 16, 'read-write'))
    .addResource(storageBuffer('particle-state-b', 1024 * 16, 'read-write'))
    .addResource(pingPongState('particle-state', { a: 'particle-state-a', b: 'particle-state-b' }))
    .addResource(instancedDepthTarget('scene-depth', { instances: 1024 }))
    .addResource(renderTarget('volume-color'))
    .addResource(renderTarget('post-color'))
    .addPass(computePass('simulate', { pipeline: 'scene-simulate', inputs: ['audio-features', 'particle-state-a'], outputs: ['particle-state-b'], workgroups: [16, 1, 1] }))
    .addPass(boundedVolumePass('volume', { pipeline: 'scene-volume', bounds: [-1, -1, -1, 1, 1, 1], depthTarget: 'scene-depth', inputs: ['particle-state-b'], outputs: ['volume-color'] }))
    .addPass(feedbackPass('feedback', { source: 'scene-depth', history: 'particle-state', output: 'post-color' }))
    .addPass(postPass('post', { pipeline: 'bloom-tonemap', inputs: ['scene-depth'], output: 'post-color' }))
    .addPass(compositePass('composite', { layers: ['post-color'], transition: 'crossfade', output: 'swapchain' }));
}
