// Versioned scene manifest schema and validation for Visualizer v4.

export const SCENE_MANIFEST_VERSION = 1;

const REQUIRED_ARRAYS = Object.freeze([
  'assets',
  'pipelines',
  'simulationBuffers',
  'controls',
  'transitions',
]);

function err(path, message) {
  return { path, message };
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function collectIds(items, key, errors) {
  const ids = new Set();
  if (!Array.isArray(items)) return ids;
  items.forEach((item, index) => {
    if (!isRecord(item) || !isNonemptyString(item.id)) {
      errors.push(err(`${key}[${index}].id`, `${key} id is required.`));
      return;
    }
    if (ids.has(item.id)) errors.push(err(`${key}[${index}].id`, `Duplicate ${key} id.`));
    ids.add(item.id);
  });
  return ids;
}

function validateRefs(values, targetIds, path, label, errors) {
  if (values === undefined) return;
  const refs = Array.isArray(values) ? values : [values];
  refs.forEach((value, index) => {
    const refPath = Array.isArray(values) ? `${path}[${index}]` : path;
    if (!isNonemptyString(value)) errors.push(err(refPath, `${label} reference must be a nonempty string.`));
    else if (!targetIds.has(value)) errors.push(err(refPath, `${label} reference does not exist.`));
  });
}

export function validateSceneManifest(manifest) {
  const errors = [];
  if (!isRecord(manifest)) return { ok: false, errors: [err('$', 'Manifest must be an object.')] };
  if (manifest.schemaVersion !== SCENE_MANIFEST_VERSION) errors.push(err('schemaVersion', 'Unsupported scene manifest schema version.'));
  if (typeof manifest.id !== 'string' || !/^[a-z0-9-]+$/.test(manifest.id)) errors.push(err('id', 'Scene id must be a kebab-case string.'));
  if (!isNonemptyString(manifest.title)) errors.push(err('title', 'Scene title is required.'));

  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(manifest[key])) errors.push(err(key, `${key} must be an array.`));
  }

  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const pipelines = Array.isArray(manifest.pipelines) ? manifest.pipelines : [];
  const simulationBuffers = Array.isArray(manifest.simulationBuffers) ? manifest.simulationBuffers : [];
  const controls = Array.isArray(manifest.controls) ? manifest.controls : [];
  const transitions = Array.isArray(manifest.transitions) ? manifest.transitions : [];

  const assetIds = collectIds(assets, 'assets', errors);
  const pipelineIds = collectIds(pipelines, 'pipelines', errors);
  const bufferIds = collectIds(simulationBuffers, 'simulationBuffers', errors);
  collectIds(controls, 'controls', errors);
  collectIds(transitions, 'transitions', errors);

  assets.forEach((asset, index) => {
    if (!isRecord(asset)) {
      errors.push(err(`assets[${index}]`, 'Asset must be an object.'));
      return;
    }
    if (!isNonemptyString(asset.type) || !isNonemptyString(asset.uri)) errors.push(err(`assets[${index}]`, 'Asset requires nonempty type and uri.'));
  });

  pipelines.forEach((pipeline, index) => {
    if (!isRecord(pipeline)) {
      errors.push(err(`pipelines[${index}]`, 'Pipeline must be an object.'));
      return;
    }
    if (!['compute', 'render', 'post', 'composite'].includes(pipeline.kind)) errors.push(err(`pipelines[${index}].kind`, 'Pipeline kind is invalid.'));
    if (!isNonemptyString(pipeline.entryPoint)) errors.push(err(`pipelines[${index}].entryPoint`, 'Pipeline entry point is required.'));
    validateRefs(pipeline.assets, assetIds, `pipelines[${index}].assets`, 'Asset', errors);
    validateRefs(pipeline.buffers, bufferIds, `pipelines[${index}].buffers`, 'Simulation buffer', errors);
  });

  simulationBuffers.forEach((buffer, index) => {
    if (!isRecord(buffer)) {
      errors.push(err(`simulationBuffers[${index}]`, 'Simulation buffer must be an object.'));
      return;
    }
    if (!['storage', 'uniform', 'ping-pong'].includes(buffer.kind)) errors.push(err(`simulationBuffers[${index}].kind`, 'Simulation buffer kind is invalid.'));
    if (!Number.isInteger(buffer.byteLength) || buffer.byteLength <= 0) errors.push(err(`simulationBuffers[${index}].byteLength`, 'Buffer byteLength must be positive.'));
  });

  controls.forEach((control, index) => {
    if (!isRecord(control)) {
      errors.push(err(`controls[${index}]`, 'Control must be an object.'));
      return;
    }
    if (!['float', 'int', 'bool', 'choice'].includes(control.type)) errors.push(err(`controls[${index}]`, 'Control requires supported type.'));
    validateRefs(control.pipeline, pipelineIds, `controls[${index}].pipeline`, 'Pipeline', errors);
    validateRefs(control.buffer, bufferIds, `controls[${index}].buffer`, 'Simulation buffer', errors);
  });

  transitions.forEach((transition, index) => {
    if (!isRecord(transition)) {
      errors.push(err(`transitions[${index}]`, 'Transition must be an object.'));
      return;
    }
    if (!['crossfade', 'feedback-wipe', 'cut'].includes(transition.type)) errors.push(err(`transitions[${index}]`, 'Transition requires supported type.'));
    if (transition.durationMs !== undefined && (!Number.isInteger(transition.durationMs) || transition.durationMs < 0)) errors.push(err(`transitions[${index}].durationMs`, 'Transition duration must be a non-negative integer.'));
    validateRefs(transition.from, pipelineIds, `transitions[${index}].from`, 'Pipeline', errors);
    validateRefs(transition.to, pipelineIds, `transitions[${index}].to`, 'Pipeline', errors);
  });

  return { ok: errors.length === 0, errors };
}

export function assertSceneManifest(manifest) {
  const result = validateSceneManifest(manifest);
  if (!result.ok) {
    const error = new Error('Invalid scene manifest.');
    error.publicErrors = result.errors;
    throw error;
  }
  return Object.freeze(manifest);
}
