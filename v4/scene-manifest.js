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

export function validateSceneManifest(manifest) {
  const errors = [];
  if (!isRecord(manifest)) return { ok: false, errors: [err('$', 'Manifest must be an object.')] };
  if (manifest.schemaVersion !== SCENE_MANIFEST_VERSION) errors.push(err('schemaVersion', 'Unsupported scene manifest schema version.'));
  if (typeof manifest.id !== 'string' || !/^[a-z0-9-]+$/.test(manifest.id)) errors.push(err('id', 'Scene id must be a kebab-case string.'));
  if (typeof manifest.title !== 'string' || manifest.title.length === 0) errors.push(err('title', 'Scene title is required.'));

  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(manifest[key])) errors.push(err(key, `${key} must be an array.`));
  }

  (manifest.assets || []).forEach((asset, index) => {
    if (!asset.id || !asset.type || !asset.uri) errors.push(err(`assets[${index}]`, 'Asset requires id, type, and uri.'));
  });

  (manifest.pipelines || []).forEach((pipeline, index) => {
    if (!['compute', 'render', 'post', 'composite'].includes(pipeline.kind)) errors.push(err(`pipelines[${index}].kind`, 'Pipeline kind is invalid.'));
    if (!pipeline.entryPoint) errors.push(err(`pipelines[${index}].entryPoint`, 'Pipeline entry point is required.'));
  });

  (manifest.simulationBuffers || []).forEach((buffer, index) => {
    if (!['storage', 'uniform', 'ping-pong'].includes(buffer.kind)) errors.push(err(`simulationBuffers[${index}].kind`, 'Simulation buffer kind is invalid.'));
    if (!Number.isInteger(buffer.byteLength) || buffer.byteLength <= 0) errors.push(err(`simulationBuffers[${index}].byteLength`, 'Buffer byteLength must be positive.'));
  });

  (manifest.controls || []).forEach((control, index) => {
    if (!control.id || !['float', 'int', 'bool', 'choice'].includes(control.type)) errors.push(err(`controls[${index}]`, 'Control requires id and supported type.'));
  });

  (manifest.transitions || []).forEach((transition, index) => {
    if (!transition.id || !['crossfade', 'feedback-wipe', 'cut'].includes(transition.type)) errors.push(err(`transitions[${index}]`, 'Transition requires id and supported type.'));
    if (transition.durationMs !== undefined && (!Number.isInteger(transition.durationMs) || transition.durationMs < 0)) errors.push(err(`transitions[${index}].durationMs`, 'Transition duration must be a non-negative integer.'));
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
