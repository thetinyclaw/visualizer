#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualizerV4SceneRegistry, normalizeLauncherQuery, buildSceneUrl, buildCapturePlanCommand } from '../v4/scene-registry.js';
import { validateSceneManifest } from '../v4/scene-manifest.js';
import { prismaticCathedralManifest } from '../v4/scenes/prismatic-cathedral/manifest.js';
import { filamentVortexManifest } from '../v4/scenes/filament-vortex/manifest.js';
import { neonVoxelCloudManifest } from '../v4/scenes/neon-voxel-cloud/manifest.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const exists = (href) => existsSync(join(ROOT, 'v4', href.replace(/^\.\//, '').split('?')[0]));

assert.equal(visualizerV4SceneRegistry.schemaVersion, 1);
assert.deepEqual(visualizerV4SceneRegistry.scenes.map((scene) => scene.title), [
  'Prismatic Cathedral',
  'Filament Vortex',
  'Neon Voxel Cloud',
  'Spectral Waterfall',
  'History Trails',
  'Demo',
  'Live Audio',
]);
assert.equal(visualizerV4SceneRegistry.legacy.effectCount, 19, 'legacy WebGL effect count contract must remain machine-readable');
assert.equal(visualizerV4SceneRegistry.scenes.find((scene) => scene.id === 'neon-voxel-cloud').counts.instanceCount, 260,
  'voxel launcher metadata must match the executable instanced draw contract');

const query = normalizeLauncherQuery('?seed=a b&time=12.5&mode=live&ignored=<script>');
assert.deepEqual(query, { seed: 'a b', time: '12.5', mode: 'live' });
assert.deepEqual(normalizeLauncherQuery('?mode=bogus'), { seed: '491009', time: '18', mode: 'demo' });

for (const scene of visualizerV4SceneRegistry.scenes) {
  assert.ok(exists(scene.route), `route missing: ${scene.route}`);
  const routeRel = `v4/${scene.route.replace(/^\.\//, '').split('?')[0]}`;
  const routeHtml = read(routeRel);
  assert.match(routeHtml, /<!doctype html>/i, `${scene.id} route shell must be loadable HTML`);
  assert.match(routeHtml, /<title>[^<]+<\/title>/i, `${scene.id} route needs a document title`);
  for (const src of [...routeHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1])) {
    assert.ok(exists(src), `${scene.id} script module missing: ${src}`);
  }
  const routed = buildSceneUrl(scene, query);
  assert.match(routed, /[?&]seed=a\+b(?:&|$)/, `${scene.id} seed not encoded`);
  assert.match(routed, /[?&]time=12\.5(?:&|$)/, `${scene.id} time not propagated`);
  assert.match(routed, /[?&]mode=live(?:&|$)/, `${scene.id} mode not propagated`);
  assert.ok(scene.capability.state, `${scene.id} missing capability state`);
  assert.ok(scene.counts && typeof scene.counts === 'object', `${scene.id} missing counts`);
  assert.ok(scene.requirements && typeof scene.requirements === 'object', `${scene.id} missing render/compute/post requirements`);
  const expectsImmutableBrowserEvidence = scene.routeKind === 'hero-webgpu';
  assert.equal(scene.evidence.artifactsExist, expectsImmutableBrowserEvidence, `${scene.id} artifact status must match committed evidence`);
  if (expectsImmutableBrowserEvidence) assert.match(scene.evidence.status, /automation-browser evidence captured/);
  assert.equal(scene.evidence.approval.humanApproved, false, `${scene.id} must not claim human approval`);
  assert.ok(buildCapturePlanCommand(scene, query).includes('capture-plan'), `${scene.id} missing capture-plan hint`);
  const legacy = buildSceneUrl({ route: scene.fallback.legacyHref }, query);
  assert.match(legacy, /[?&]seed=a\+b(?:&|$)/, `${scene.id} legacy fallback seed not propagated`);
  assert.match(legacy, /[?&]time=12\.5(?:&|$)/, `${scene.id} legacy fallback time not propagated`);
  assert.match(legacy, /[?&]mode=live(?:&|$)/, `${scene.id} legacy fallback mode not propagated`);
  if (scene.fallback.oldLabHref) {
    assert.ok(exists(scene.fallback.oldLabHref), `${scene.id} old lab fallback route missing`);
    const fallback = buildSceneUrl({ route: scene.fallback.oldLabHref }, query);
    assert.match(fallback, /[?&]seed=a\+b(?:&|$)/, `${scene.id} old lab seed not propagated`);
    assert.match(fallback, /[?&]time=12\.5(?:&|$)/, `${scene.id} old lab time not propagated`);
    assert.match(fallback, /[?&]mode=live(?:&|$)/, `${scene.id} old lab mode not propagated`);
  }
}

for (const manifest of [prismaticCathedralManifest, filamentVortexManifest, neonVoxelCloudManifest]) {
  assert.equal(validateSceneManifest(manifest).ok, true, `${manifest.id} old scene-manifest contract broke`);
}

const main = read('index.html');
assert.match(main, /const PATTERN_COUNT = 19;/, '19-effect WebGL library count changed');

const launcher = read('v4/index.html');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(launcher), 'launcher must avoid HTML injection sinks');
assert.ok(!/<iframe|<object|<embed|<canvas/i.test(launcher), 'launcher must not hidden-load GPU/render routes');
assert.ok(!/getUserMedia|requestAdapter|getContext\(['"]webgpu/.test(launcher), 'launcher must not auto-request mic or GPU');
assert.match(launcher, /window\.__V4_SCENE_REGISTRY__/, 'launcher must expose machine-readable registry export');
assert.match(launcher, /aria-label="deterministic query controls"/, 'launcher controls need accessible label');
assert.match(launcher, /Skip to scene cards/, 'launcher needs keyboard skip link');

const registrySource = read('v4/scene-registry.js');
assert.ok(!/humanApproved:\s*true/.test(registrySource), 'registry must not mark scenes human approved');
assert.match(registrySource, /provisional visual pass/, 'hero maturity must be explicit');
assert.match(registrySource, /No artifacts are implied by this launcher/, 'capture hints must not claim artifacts');

const liveAudio = read('v4/live-audio.html');
assert.match(liveAudio, /never auto-requests microphone access/, 'live-audio route must say mic is not automatic');
assert.match(liveAudio, /start-mic'.*addEventListener\('click'/s, 'microphone request must stay click-gated');

const spectralWaterfallHtml = read('v4/spectrogram.html');
const spectralWaterfallRoute = read('v4/spectrogram-route.js');
assert.match(spectralWaterfallHtml, /id="spectrogram-canvas"/, 'Spectral Waterfall needs a full-frame canvas');
assert.match(spectralWaterfallHtml, /id="start-mic"/, 'Spectral Waterfall needs an explicit microphone control');
assert.match(spectralWaterfallHtml, /data-audio-source="demo synthetic"/, 'Spectral Waterfall must truthfully label synthetic demo audio');
assert.match(spectralWaterfallHtml, /id="normalize"[^>]+aria-pressed="false"/, 'Spectral Waterfall normalization must be off by default');
assert.match(spectralWaterfallHtml, /id="normalization-amount"[^>]+type="range"[^>]+value="65"/,
  'Spectral Waterfall normalization amount slider missing');
assert.match(spectralWaterfallRoute, /const HIGH_CONTRAST_STOPS = Object\.freeze/, 'Spectral Waterfall high-contrast palette missing');
assert.match(spectralWaterfallRoute, /function updateSpectrogramHistory/, 'Spectral Waterfall history transport missing');
assert.match(spectralWaterfallRoute, /spectralFlux/, 'Spectral Waterfall lacks flux reactivity');
assert.match(spectralWaterfallRoute, /onsetFlash/, 'Spectral Waterfall lacks onset flash response');
assert.match(spectralWaterfallRoute, /startMic\.addEventListener\('click', startMicrophone\)/,
  'Spectral Waterfall microphone must stay click-gated');
assert.match(spectralWaterfallRoute, /microphoneAutoRequested:\s*false/, 'Spectral Waterfall must expose no-auto-mic telemetry');
assert.match(spectralWaterfallRoute, /windowObject\.__V4_SPECTRAL_WATERFALL__/, 'Spectral Waterfall route telemetry missing');
assert.match(spectralWaterfallRoute, /const normalizationReference = new Float32Array\(BAND_COUNT\)/,
  'Spectral Waterfall adaptive per-band normalization state missing');
assert.match(spectralWaterfallRoute, /function applyAdaptiveNormalization/, 'Spectral Waterfall normalization transform missing');
assert.match(spectralWaterfallRoute, /normalizationEnabled:\s*false/, 'Spectral Waterfall normalization telemetry must default off');
assert.match(spectralWaterfallRoute, /normalizeButton\.addEventListener\('click', toggleNormalization\)/,
  'Spectral Waterfall normalization button is not wired');
assert.match(spectralWaterfallRoute, /event\.key\.toLowerCase\(\) === 'n'/,
  'Spectral Waterfall N-key normalization toggle missing');

const cathedralRoute = read('v4/cathedral-route.js');
const cathedralHtml = read('v4/cathedral.html');
assert.match(cathedralRoute, /createLiveAudioFeatureBridge/, 'Cathedral must instantiate the shared live-audio bridge');
assert.match(cathedralRoute, /audioBus:\s*audioBridge\.bus/, 'Cathedral runtime and live bridge must share one structural feature bus');
assert.match(cathedralRoute, /createActivationToken\(event\)/, 'Cathedral microphone access must mint activation inside the click handler');
assert.match(cathedralHtml, /id="start-mic"/, 'Cathedral must expose an explicit Start Mic control');
assert.match(cathedralHtml, /data-audio-source="idle"/, 'Cathedral must expose an honest initial audio source label');

for (const [routeHtml, routeModule] of [['v4/cathedral.html', 'v4/cathedral-route.js'], ['v4/filament.html', 'v4/filament-route.js']]) {
  assert.match(read(routeHtml), /id="query-text"/, `${routeHtml} must expose dynamic query text instead of hard-coded locks`);
  assert.match(read(routeHtml), /id="fallback-link"/, `${routeHtml} must expose a dynamic fallback link`);
  assert.match(read(routeModule), /queryText\.textContent/, `${routeModule} must render the effective query`);
  assert.match(read(routeModule), /fallbackLink\.href/, `${routeModule} must propagate the effective query to fallback`);
}

console.log('Visualizer v4 launcher registry verification passed');
console.log('Checked routes, query propagation, fallbacks, no injection sinks, no launcher auto mic/GPU, 19 legacy effects, and v4 manifest compatibility.');
