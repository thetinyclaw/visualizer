// Machine-readable Visualizer v4 launcher registry.
// This file is intentionally data-only plus tiny pure helpers so tests, capture tooling,
// and the no-build launcher can consume the same route/capability contract.

export const VISUALIZER_V4_SCENE_REGISTRY_VERSION = 1;

const DEFAULT_QUERY = Object.freeze({ seed: '491009', time: '18', mode: 'demo' });
const LOCKED_QUERY_KEYS = Object.freeze(['seed', 'time', 'mode']);
const ALLOWED_MODES = Object.freeze(['demo', 'flat', 'live']);
const HERO_MATURITY = 'provisional visual pass';
const HERO_APPROVAL = Object.freeze({ humanApproved: false, maturity: HERO_MATURITY, note: 'Not human approved; do not claim public release approval.' });

export const visualizerV4SceneRegistry = Object.freeze({
  schemaVersion: VISUALIZER_V4_SCENE_REGISTRY_VERSION,
  defaultQuery: DEFAULT_QUERY,
  queryPropagation: Object.freeze({ lockedKeys: LOCKED_QUERY_KEYS, allowedModes: ALLOWED_MODES }),
  legacy: Object.freeze({
    route: '../index.html',
    effectCount: 19,
    contract: 'Preserve existing 19-effect WebGL library as fallback and main legacy cycle.',
    deterministicQuery: Object.freeze({ pattern: '0', seed: DEFAULT_QUERY.seed }),
  }),
  diagnostics: Object.freeze({
    readOnlyRoutes: Object.freeze([
      Object.freeze({ label: 'Evidence README', href: './evidence/README.md', kind: 'read-only-doc' }),
      Object.freeze({ label: 'Runtime smoke diagnostics', href: './demo.html', kind: 'read-only-route' }),
      Object.freeze({ label: 'Live audio diagnostics', href: './live-audio.html', kind: 'read-only-route' }),
      Object.freeze({ label: 'History trails diagnostics', href: './history.html', kind: 'read-only-route' }),
    ]),
    capturePlan: Object.freeze({
      commandTemplate: 'python3 v4/tools/visualizer_v4_evidence.py capture-plan --route {route} --effect-id {effectId} --seed {seed} --time-ms {timeMs} --mode {mode} --run-id dry-run-{effectId}',
      routeHint: '{route}?seed={seed}&time={time}&mode={mode}',
      artifactClaim: 'No artifacts are implied by this launcher; capture-plan is a dry-run route/command hint only.',
    }),
  }),
  scenes: Object.freeze([
    Object.freeze({
      id: 'prismatic-cathedral',
      title: 'Prismatic Cathedral',
      summary: 'Native WebGPU cathedral corridor with deterministic geometry, post, and composite passes.',
      route: './cathedral.html',
      routeExists: true,
      routeKind: 'hero-webgpu',
      fallback: Object.freeze({ requiredWhen: 'WebGPU unavailable or reduced below route contract', oldLabHref: './lab/prismatic-cathedral.html', legacyHref: '../index.html?pattern=14' }),
      capability: Object.freeze({ state: 'webgpu-full', label: 'WebGPU full', requiresWebGPU: true, fallbackRequired: false, audio: 'demo/flat plus trusted-click live microphone; no automatic request' }),
      counts: Object.freeze({ assets: 1, pipelines: 3, simulationBuffers: 0, controls: 3, transitions: 1, renderPasses: 1, computePasses: 0, postPasses: 1, compositePasses: 1 }),
      requirements: Object.freeze({ render: true, compute: false, post: true, composite: true, history: false, liveAudio: true, microphoneAutoRequest: false }),
      manifest: Object.freeze({ module: './scenes/prismatic-cathedral/manifest.js', exportName: 'prismaticCathedralManifest', graphExportName: 'makePrismaticCathedralGraph' }),
      evidence: Object.freeze({ status: 'automation-browser evidence captured; target-device and human approval pending', artifactsExist: true, evidenceRoot: './evidence/runs/cathedral-491009-demo-18000-dpr1/', captureEffectId: 'prismatic-cathedral', approval: HERO_APPROVAL }),
    }),
    Object.freeze({
      id: 'filament-vortex',
      title: 'Filament Vortex',
      summary: 'WebGPU compute ping-pong filament simulation with ribbon render, post, and composite.',
      route: './filament.html',
      routeExists: true,
      routeKind: 'hero-webgpu',
      fallback: Object.freeze({ requiredWhen: 'WebGPU compute/storage unavailable or route validation fails', oldLabHref: './lab/filament-vortex.html', legacyHref: '../index.html?pattern=13' }),
      capability: Object.freeze({ state: 'webgpu-full', label: 'WebGPU full + compute', requiresWebGPU: true, fallbackRequired: false, audio: 'demo/flat gated; no microphone request' }),
      counts: Object.freeze({ assets: 1, pipelines: 4, simulationBuffers: 0, controls: 1, transitions: 1, renderPasses: 1, computePasses: 1, postPasses: 1, compositePasses: 1 }),
      requirements: Object.freeze({ render: true, compute: true, post: true, composite: true, history: false, liveAudio: false }),
      manifest: Object.freeze({ module: './scenes/filament-vortex/manifest.js', exportName: 'filamentVortexManifest', graphExportName: 'makeFilamentVortexGraph' }),
      evidence: Object.freeze({ status: 'automation-browser evidence captured; target-device and human approval pending', artifactsExist: true, evidenceRoot: './evidence/runs/filament-491009-demo-18000-dpr1/', captureEffectId: 'filament-vortex', approval: HERO_APPROVAL }),
    }),
    Object.freeze({
      id: 'neon-voxel-cloud',
      title: 'Neon Voxel Cloud',
      summary: 'Instanced WebGPU voxel cloud with compute-filled payload, post, and composite.',
      route: './voxel.html',
      routeExists: true,
      routeKind: 'hero-webgpu',
      fallback: Object.freeze({ requiredWhen: 'WebGPU compute/storage or instanced draw path unavailable', oldLabHref: './lab/neon-voxel-cloud.html', legacyHref: '../index.html?pattern=17' }),
      capability: Object.freeze({ state: 'webgpu-full', label: 'WebGPU full + compute + instancing', requiresWebGPU: true, fallbackRequired: false, audio: 'demo/flat gated; no microphone request' }),
      counts: Object.freeze({ assets: 1, pipelines: 4, simulationBuffers: 0, controls: 1, transitions: 1, renderPasses: 1, computePasses: 1, postPasses: 1, compositePasses: 1, instanceCount: 260 }),
      requirements: Object.freeze({ render: true, compute: true, post: true, composite: true, history: false, liveAudio: false }),
      manifest: Object.freeze({ module: './scenes/neon-voxel-cloud/manifest.js', exportName: 'neonVoxelCloudManifest', graphExportName: 'makeNeonVoxelCloudGraph' }),
      evidence: Object.freeze({ status: 'automation-browser evidence captured; target-device and human approval pending', artifactsExist: true, evidenceRoot: './evidence/runs/voxel-582114-demo-18000-dpr1/', captureEffectId: 'neon-voxel-cloud', approval: HERO_APPROVAL }),
    }),
    Object.freeze({
      id: 'spectral-waterfall',
      title: 'Spectral Waterfall',
      summary: 'High-contrast full-frame logarithmic spectrogram with flux flashes, bass displacement, and a live spectrum ridge.',
      route: './spectrogram.html',
      routeExists: true,
      routeKind: 'hero-canvas2d',
      fallback: Object.freeze({ requiredWhen: 'Canvas2D unavailable or microphone secure-context gate fails', oldLabHref: '../fft.html', legacyHref: '../index.html?pattern=0' }),
      capability: Object.freeze({ state: 'canvas2d-live-gated', label: 'Canvas2D + live audio gated', requiresWebGPU: false, fallbackRequired: false, audio: 'Demo/flat auto-safe; live microphone requires explicit Start Mic click' }),
      counts: Object.freeze({ audioBands: 192, paletteStops: 7, canvases: 2, historyWidth: 640, historyHeight: 256, renderScale: 0.75, controls: 4, renderPasses: 1, computePasses: 0, postPasses: 0, compositePasses: 1 }),
      requirements: Object.freeze({ render: true, compute: false, post: false, composite: true, history: true, liveAudio: true, microphoneAutoRequest: false }),
      manifest: Object.freeze({ inline: true, routeExport: 'window.__V4_SPECTRAL_WATERFALL__' }),
      evidence: Object.freeze({ status: 'provisional browser visual pass pending; no immutable acceptance artifacts claimed', artifactsExist: false, captureEffectId: 'spectral-waterfall', approval: HERO_APPROVAL }),
    }),
    Object.freeze({
      id: 'runtime-history-trails-smoke',
      title: 'History Trails',
      summary: 'Safe ping-pong history trail diagnostic route; intentionally restrained foundation, not production bloom parity.',
      route: './history.html',
      routeExists: true,
      routeKind: 'diagnostic-webgpu',
      fallback: Object.freeze({ requiredWhen: 'WebGPU history target unsupported', oldLabHref: null, legacyHref: '../index.html' }),
      capability: Object.freeze({ state: 'webgpu-full-or-fallback-required', label: 'WebGPU full; fallback required when unavailable', requiresWebGPU: true, fallbackRequired: true, audio: 'no audio input' }),
      counts: Object.freeze({ assets: 0, pipelines: 3, simulationBuffers: 0, controls: 1, transitions: 0, renderPasses: 1, computePasses: 0, postPasses: 0, historyPasses: 1, compositePasses: 1 }),
      requirements: Object.freeze({ render: true, compute: false, post: false, composite: true, history: true, liveAudio: false }),
      manifest: Object.freeze({ inline: true, routeExport: 'window.__V4_HISTORY_TRAILS__' }),
      evidence: Object.freeze({ status: 'diagnostic route only; no acceptance artifacts claimed', artifactsExist: false, captureEffectId: 'runtime-history-trails-smoke', approval: Object.freeze({ humanApproved: false, maturity: 'foundation diagnostic', note: 'Read-only diagnostic; not a human-approved hero.' }) }),
    }),
    Object.freeze({
      id: 'runtime-clear-draw-smoke',
      title: 'Demo',
      summary: 'Post/composite WebGPU runtime smoke; honest fallback and no invented telemetry.',
      route: './demo.html',
      routeExists: true,
      routeKind: 'diagnostic-webgpu',
      fallback: Object.freeze({ requiredWhen: 'WebGPU unavailable', oldLabHref: null, legacyHref: '../index.html' }),
      capability: Object.freeze({ state: 'webgpu-full-or-webgl2-legacy', label: 'WebGPU full or WebGL2 fallback', requiresWebGPU: false, fallbackRequired: false, audio: 'no audio input' }),
      counts: Object.freeze({ assets: 0, pipelines: 3, simulationBuffers: 0, controls: 0, transitions: 0, renderPasses: 1, computePasses: 0, postPasses: 1, compositePasses: 1 }),
      requirements: Object.freeze({ render: true, compute: false, post: true, composite: true, history: false, liveAudio: false }),
      manifest: Object.freeze({ inline: true, routeExport: 'window.__V4_RUNTIME_SMOKE__' }),
      evidence: Object.freeze({ status: 'diagnostic route only; no acceptance artifacts claimed', artifactsExist: false, captureEffectId: 'runtime-clear-draw-smoke', approval: Object.freeze({ humanApproved: false, maturity: 'foundation diagnostic', note: 'Runtime smoke only.' }) }),
    }),
    Object.freeze({
      id: 'live-audio',
      title: 'Live Audio',
      summary: 'User-activation-gated microphone bridge plus demo/flat source diagnostics.',
      route: './live-audio.html',
      routeExists: true,
      routeKind: 'audio-diagnostic',
      fallback: Object.freeze({ requiredWhen: 'insecure context, missing mediaDevices, denied permission, or no user activation', oldLabHref: null, legacyHref: '../fft.html' }),
      capability: Object.freeze({ state: 'live-gated', label: 'Audio demo/flat/live gated', requiresWebGPU: false, fallbackRequired: false, audio: 'Start Mic requires trusted click; Demo/Flat are synthetic and labeled' }),
      counts: Object.freeze({ audioBands: 16, controls: 4, canvases: 1, renderPasses: 0, computePasses: 0, postPasses: 0, compositePasses: 0 }),
      requirements: Object.freeze({ render: false, compute: false, post: false, composite: false, history: false, liveAudio: true, microphoneAutoRequest: false }),
      manifest: Object.freeze({ inline: true, routeExport: 'window.__V4_LIVE_AUDIO__' }),
      evidence: Object.freeze({ status: 'diagnostic route only; no microphone proof claimed', artifactsExist: false, captureEffectId: 'live-audio', approval: Object.freeze({ humanApproved: false, maturity: 'audio diagnostic', note: 'Synthetic browser smoke is not live microphone proof.' }) }),
    }),
  ]),
});

export function normalizeLauncherQuery(search = globalThis.location?.search || '') {
  const source = new URLSearchParams(search);
  const seed = source.get('seed') || DEFAULT_QUERY.seed;
  const time = source.get('time') || DEFAULT_QUERY.time;
  const mode = ALLOWED_MODES.includes(source.get('mode')) ? source.get('mode') : DEFAULT_QUERY.mode;
  return Object.freeze({ seed, time, mode });
}

export function buildSceneUrl(scene, query = DEFAULT_QUERY) {
  const url = new URL(scene.route, 'https://visualizer.local/v4/index.html');
  for (const key of LOCKED_QUERY_KEYS) url.searchParams.set(key, String(query[key] ?? DEFAULT_QUERY[key]));
  const path = url.pathname.startsWith('/v4/') ? `./${url.pathname.slice('/v4/'.length)}` : `..${url.pathname}`;
  return `${path}${url.search}${url.hash}`;
}

export function buildCapturePlanCommand(scene, query = DEFAULT_QUERY) {
  const route = scene.route.replace(/^\.\//, 'v4/');
  const timeMs = String(Math.round(Number(query.time || DEFAULT_QUERY.time) * 1000));
  return visualizerV4SceneRegistry.diagnostics.capturePlan.commandTemplate
    .replaceAll('{route}', route)
    .replaceAll('{effectId}', scene.evidence.captureEffectId)
    .replaceAll('{seed}', String(query.seed || DEFAULT_QUERY.seed))
    .replaceAll('{timeMs}', timeMs)
    .replaceAll('{mode}', String(query.mode || DEFAULT_QUERY.mode));
}

export function registryPublicJson() {
  return JSON.parse(JSON.stringify(visualizerV4SceneRegistry));
}
