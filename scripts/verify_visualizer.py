#!/usr/bin/env python3
"""Focused structural verifier for the static TinyClaw visualizer."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "index.html").read_text()
readme = (ROOT / "README.md").read_text()
project = (ROOT / "PROJECT.md").read_text()
creative = (ROOT / "CREATIVE_ENGINE.md").read_text()
ledger = (ROOT / "EFFECTS.md").read_text()
pipeline = (ROOT / "EFFECT_PIPELINE.md").read_text()
benchmark = (ROOT / "benchmark.html").read_text()
agents = (ROOT / "AGENTS.md").read_text()

errors = []

def require(condition, message):
    if not condition:
        errors.append(message)

count_match = re.search(r"const PATTERN_COUNT = (\d+);", html)
require(count_match is not None, "PATTERN_COUNT declaration missing")
count = int(count_match.group(1)) if count_match else -1

names_match = re.search(r"const PATTERN_NAMES = \[(.*?)\];", html, re.S)
names = re.findall(r"'([^']+)'", names_match.group(1)) if names_match else []
require(len(names) == count, f"PATTERN_NAMES has {len(names)} entries, expected {count}")
require(f"mod(float(pattern + 1), {count}.0)" in html, "shader transition modulo does not match PATTERN_COUNT")
require("Cosmic Mycelium" in names, "Cosmic Mycelium pattern is not registered")
require("vec3 cosmicMycelium(vec2 uv, float t)" in html, "Cosmic Mycelium shader function missing")
require("return cosmicMycelium(uv, t);" in html, "Cosmic Mycelium dispatcher route missing")
require("?pattern=" in readme, "README lacks deterministic pattern-selection documentation")
require("QUERY.get('seed')" in html, "deterministic seed-selection route missing")
require("!PATTERN_LOCKED && elapsed > patternDuration" in html, "deterministic pattern route does not lock transitions")
require("for (float i = 0.0; i < 50.0; i++)" not in html, "legacy 1500-step Flow Field loop returned")
require("float flowPhaseA" in html, "analytic Flow Field implementation missing")
require("float backgroundFlow = noise" in html, "Flow Field returned to multi-octave background work")
require("for (float i = 0.0; i < 12.0; i++)" not in html, "legacy 12-neuron distance loop returned")
require("for (float i = 0.0; i < 20.0; i++)" not in html, "legacy 20-spark distance loop returned")
require("float neuralLattice" in html, "analytic Neurons lattice missing")
require("float reactionWarpA" in html, "analytic Reaction membrane missing")
require("reactionCurl" not in html, "Reaction returned to expensive 3D curl work")
require("for (float b = 0.0; b < 64.0; b++)" not in html, "legacy 256-segment Branches loop returned")
require("float branchLattice" in html, "analytic Branches lattice missing")
require("for (float i = 0.0; i < 100.0; i++)" not in html, "legacy 100-star Galaxy loop returned")
require("vec2 starCell = floor(starUv)" in html, "cell-local Galaxy stars missing")
require("float dist2 = dot(diff, diff);" in html, "Voronoi squared-distance comparison missing")
require("float minDist = sqrt(minDist2);" in html, "Voronoi final nearest-distance recovery missing")
require("float dist = length(diff);" not in html, "Voronoi returned to nine square roots per fragment")
require("outside = length(max(d, 0.0))" not in html, "RGB rectangles returned to per-mask square roots")
require("window.__VISUALIZER_BENCHMARK__ = result" in html, "benchmark telemetry export missing")
require("effectiveDprX: canvas.width / window.innerWidth" in html, "benchmark native-density telemetry missing")
require("BENCHMARK_SAMPLE_FRAMES" in html, "benchmark frame sampler missing")
require("Math.max(120, Math.min(600, requestedBenchmarkFrames))" in html,
        "single-pattern benchmark allows undersized acceptance samples")
require('id="btn-tv"' in html, "TV Mode control missing")
require('<meta name="mobile-web-app-capable" content="yes">' in html,
        "standards-based mobile web-app capability metadata missing")
require("Screen Mirroring" in html, "AirPlay screen-mirroring guidance missing")
require("async function setTvMode" in html, "TV Mode state transition missing")
require("navigator.wakeLock.request('screen')" in html, "TV Mode wake-lock request missing")
require("QUERY.get('tv') === '1'" in html, "direct TV Mode guidance route missing")
require("body.tv-mode.controls-visible #controls" in html, "TV Mode tap-to-reveal controls missing")
require("Effective DPR must remain at least `1.0`" in pipeline, "native-density acceptance gate missing")
require("at least 90% of the same-environment median" in pipeline, "comparative FPS gate missing")
require("window.__VISUALIZER_SUITE__" in benchmark, "benchmark suite export missing")
require("result.patternCount" in benchmark, "benchmark dashboard does not discover pattern count")
require("item.effectiveDprX >= 0.999" in benchmark, "benchmark dashboard lacks density gate")
require("Math.max(120" in benchmark, "benchmark dashboard allows verdicts from undersized samples")
require("mirrored-forward-reverse-per-pattern-medians" in benchmark, "benchmark dashboard lacks mirrored-run metadata")
require("aggregateRuns(suite)" in benchmark, "benchmark dashboard lacks per-pattern median aggregation")
require("round: 'reverse'" in benchmark, "benchmark dashboard lacks reverse-order round")
require("A dirty tree is a recovery task" in agents, "dirty-workspace recovery protocol missing")
require("At 8 minutes (480 seconds)" in agents, "cron eight-minute edit cutoff missing")
require("By 600 seconds" in agents, "cron ten-minute total budget missing")
require("prove `git status --short` is empty" in agents, "clean-tree end invariant missing")
require("Creative Evolution Engine" in creative, "creative contract missing")
require("Cosmic Mycelium Revelation" in ledger, "effect ledger lacks first autonomous fingerprint")
require("Cosmic Mycelium" in project, "PROJECT.md lacks first autonomous effect")
require(html.count("<script") == html.count("</script>"), "unbalanced script tags")
require(html.count("const fragSrc = `") == 1, "unexpected fragment-shader source count")
require("devicePixelRatio || 1, 2" in html, "DPR cap missing")
require("if (transition > 0.0)" in html, "transition cost guard missing")

if errors:
    print("visualizer verification FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print(f"visualizer verification passed: {count} patterns, {len(names)} names")
print("creative contract, effect ledger, transition guard, DPR cap, and Cosmic Mycelium route present")
