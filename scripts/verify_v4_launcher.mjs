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
  'History Trails',
  'Demo',
  'Live Audio',
]);
assert.equal(visualizerV4SceneRegistry.legacy.effectCount, 19, 'legacy WebGL effect count contract must remain machine-readable');

const query = normalizeLauncherQuery('?seed=a b&time=12.5&mode=live&ignored=<script>');
assert.deepEqual(query, { seed: 'a b', time: '12.5', mode: 'live' });
assert.deepEqual(normalizeLauncherQuery('?mode=bogus'), { seed: '491009', time: '18', mode: 'demo' });

for (const scene of visualizerV4SceneRegistry.scenes) {
  assert.ok(exists(scene.route), `route missing: ${scene.route}`);
  const routed = buildSceneUrl(scene, query);
  assert.match(routed, /[?&]seed=a\+b(?:&|$)/, `${scene.id} seed not encoded`);
  assert.match(routed, /[?&]time=12\.5(?:&|$)/, `${scene.id} time not propagated`);
  assert.match(routed, /[?&]mode=live(?:&|$)/, `${scene.id} mode not propagated`);
  assert.ok(scene.capability.state, `${scene.id} missing capability state`);
  assert.ok(scene.counts && typeof scene.counts === 'object', `${scene.id} missing counts`);
  assert.ok(scene.requirements && typeof scene.requirements === 'object', `${scene.id} missing render/compute/post requirements`);
  assert.equal(scene.evidence.artifactsExist, false, `${scene.id} must not claim artifacts exist`);
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

console.log('Visualizer v4 launcher registry verification passed');
console.log('Checked routes, query propagation, fallbacks, no injection sinks, no launcher auto mic/GPU, 19 legacy effects, and v4 manifest compatibility.');
