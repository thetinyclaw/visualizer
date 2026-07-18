#!/usr/bin/env python3
"""Focused structural verifier for the static TinyClaw visualizer."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "index.html").read_text()
cycle_shaders = (ROOT / "candidate-cycle-shaders.js").read_text()
readme = (ROOT / "README.md").read_text()
project = (ROOT / "PROJECT.md").read_text()
creative = (ROOT / "CREATIVE_ENGINE.md").read_text()
ledger = (ROOT / "EFFECTS.md").read_text()
pipeline = (ROOT / "EFFECT_PIPELINE.md").read_text()
benchmark = (ROOT / "benchmark.html").read_text()
agents = (ROOT / "AGENTS.md").read_text()
fft = (ROOT / "fft.html").read_text()
filament_vortex = (ROOT / "candidates" / "filament-vortex.html").read_text()
filament_vortex_doc = (ROOT / "candidates" / "filament-vortex.md").read_text()
hive_aperture_page = (ROOT / "hive-aperture.html").read_text()
hive_shell_page = (ROOT / "hive-shell.html").read_text()
hive_infinite_page = (ROOT / "hive-infinite.html").read_text()

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
require(count == 19, f"main cycle has {count} patterns, expected 19")
require(f"mod(float(pattern + 1), {count}.0)" in html, "shader transition modulo does not match PATTERN_COUNT")
require("Cosmic Mycelium" in names, "Cosmic Mycelium pattern is not registered")
require("vec3 cosmicMycelium(vec2 uv, float t)" in html, "Cosmic Mycelium shader function missing")
require("return cosmicMycelium(uv, t);" in html, "Cosmic Mycelium dispatcher route missing")
require("Spectral Hive Shell" in names and "Spectral Hive Aperture" in names and "Infinite Hexsphere" in names,
        "all three Spectral Hive patterns are not registered")
cycle_names = [
    "Filament Vortex", "Prismatic Rupture Cathedral", "Chromatic Iris Mycorrhiza",
    "Recursive Diamond Lattice", "Neon Voxel Scan Cloud", "Scarlet Velocity Ribbons",
]
require(names[13:19] == cycle_names, "reference candidates are not registered at main-cycle indices 13-18")
require('<script src="candidate-cycle-shaders.js"></script>' in html and
        "${window.CANDIDATE_CYCLE_SHADER_BLOCK}" in html,
        "main page does not inject the candidate-cycle shader module")
cycle_functions = [
    "cycleFilamentVortex", "cyclePrismaticRupture", "cycleChromaticIris",
    "cycleRecursiveDiamond", "cycleNeonVoxel", "cycleScarletVelocity",
]
for index, function_name in enumerate(cycle_functions, start=13):
    require(f"vec3 {function_name}(" in cycle_shaders,
            f"{function_name} shader function missing from cycle module")
    require(f"if (p == {index}) return {function_name}(uv, t);" in html if index < 18 else
            f"return {function_name}(uv, t);" in html,
            f"{function_name} main-cycle dispatcher route missing")
require("cycleFftIndex" in cycle_shaders and "fftBand(" in cycle_shaders,
        "candidate-cycle shaders are not connected to the shared FFT bus")
require("resolution.x / resolution.y" not in cycle_shaders,
        "candidate-cycle shaders double-apply aspect correction to main-cycle UVs")
require("uniform " not in cycle_shaders and "void main" not in cycle_shaders,
        "candidate-cycle module duplicates main shader uniforms or entry point")
require("vec3 spectralHiveShell(vec2 uv, float t)" in html and
        "vec3 spectralHiveAperture(vec2 uv, float t)" in html and
        "vec3 infiniteHexsphere(vec2 uv, float t)" in html,
        "one or more Spectral Hive shader variants are missing")
require("return spectralHiveShell(uv, t);" in html and
        "return spectralHiveAperture(uv, t);" in html and
        "return infiniteHexsphere(uv, t);" in html,
        "one or more Spectral Hive dispatcher routes are missing")
require("vec4 spectralHexCell(vec2 p)" in html and "float spectralHexMetric(vec2 p)" in html,
        "Spectral Hive analytic honeycomb geometry missing")
spectral_hive_match = re.search(r"vec3 spectralHiveShell\(vec2 uv, float t\) \{(.*?)\n\}", html, re.S)
spectral_hive = spectral_hive_match.group(1) if spectral_hive_match else ""
require(spectral_hive_match is not None, "Spectral Hive function body missing")
require("float angularBand = fftBand(angularKey);" in spectral_hive and
        "float cellBand = fftBand(cellKey);" in spectral_hive,
        "Spectral Hive lacks angular and per-cell FFT ownership")
require("pow(" not in spectral_hive, "Spectral Hive returned to general power calls")
require("float cellRadius2 = dot(" in spectral_hive,
        "Spectral Hive returned to per-fragment cell-radius square roots")
require("float centerRevelation = fftBinsA.x;" in spectral_hive,
        "Spectral Hive center is not driven by the lowest FFT bin")
require("const float ballRadius = 0.72;" in spectral_hive and
        "vec3 surfaceNormal = vec3(sphereXY, surfaceZ);" in spectral_hive,
        "Spectral Hive lost its front-hemisphere spherical projection")
require("float shellSpin = t * 0.105;" in spectral_hive and
        "float longitude = atan(surfaceNormal.x, surfaceNormal.z);" in spectral_hive and
        "float latitude = asin(" in spectral_hive,
        "Spectral Hive lost rotating spherical surface coordinates")
require("float centralPressure" in spectral_hive and "float trappedLight" in spectral_hive,
        "Spectral Hive no longer models a central source leaking through seams")
infinite_hive_match = re.search(r"vec3 infiniteHexsphere\(vec2 uv, float t\) \{(.*?)\n\}", html, re.S)
infinite_hive = infinite_hive_match.group(1) if infinite_hive_match else ""
require(infinite_hive_match is not None, "Infinite Hexsphere function body missing")
require("float ballRadius = 0.34 + hiveRadiusDrive * 0.12;" in infinite_hive,
        "Infinite Hexsphere radius is not significantly flux-driven")
require("perfectTiledHexMetric(cellLocal)" in infinite_hive,
        "Infinite Hexsphere lacks lattice-matched perfect tiling")
require("float tilingScale = 5.65 - bass * 1.45 + treble * 0.48;" in infinite_hive,
        "Infinite Hexsphere cell size is not FFT-driven")
require("float longitude = atan(sphereXY.x, surfaceZ) + hiveRotation;" in infinite_hive and
        "spinCos" not in infinite_hive and "surfaceNormal" not in infinite_hive,
        "Infinite Hexsphere can expose its longitude wrap on the visible hemisphere")
require("float gapDrive = 4.0 * (bass * 0.026 + cellBand * 0.050 + treble * 0.010);" in infinite_hive and
        "float seamWidth = 0.014 + gapDrive * 0.22;" in infinite_hive,
        "Infinite Hexsphere gaps do not use 400 percent FFT displacement")
require("texture2D(hiveBeamMap" in infinite_hive and "float sourceLineEnergy" in infinite_hive and
        "float beams = sourceGate * beamEnvelope * beamBreath" in infinite_hive and
        "float lineEmitter = max(seam, gap * 0.34)" in infinite_hive and
        "frontSourceFlare" not in infinite_hive and "frontShaft" not in infinite_hive,
        "Infinite Hexsphere gaps are not continuous line emitters")
require("const HIVE_BEAM_MAP_SIZE = 256;" in html and "function updateHiveBeamMap()" in html and
        "gl.texSubImage2D" in html,
        "Infinite Hexsphere front-gap source map is missing")
require("const depthSamples = 10;" in html and "let seamEnergy = 0;" in html and
        "const averageSeamEnergy = seamEnergy / depthSamples;" in html and
        "const hiveCellScratch = new Float64Array(4);" in html and
        "sampleHiveCell(longitude * tilingScale, latitude * tilingScale, hiveCellScratch);" in html,
        "Infinite Hexsphere beam map does not allocation-free integrate seam lines")
require("if (pattern === 12 || (transition > 0 && nextPatternIndex === 12))" in html,
        "Infinite Hexsphere CPU source-map work is not isolated to its render/transition path")
require("uniform float hiveRotation;" in html and "const hiveRotationRate = 0.085;" in html and
        "hiveRotationPhase += frameSeconds * hiveRotationRate;" in html,
        "Infinite Hexsphere rotation is not constant")
require("uniform float hiveRadiusDrive;" in html and "positiveSpectralFlux" in html and
        "const hiveRadiusTau = hiveRadiusTarget > hiveRadiusPulse ? 0.055 : 0.55;" in html,
        "Infinite Hexsphere radius is not driven by onset-sensitive spectral flux")
require("target.searchParams.set('pattern','11')" in hive_aperture_page and
        "target.searchParams.set('pattern','10')" in hive_shell_page and
        "target.searchParams.set('pattern','12')" in hive_infinite_page,
        "dedicated hive pages do not map to all three variants")
require(all('allow="microphone; fullscreen"' in page for page in
            (hive_aperture_page, hive_shell_page, hive_infinite_page)),
        "dedicated hive pages do not forward microphone/fullscreen permissions")
require("?pattern=" in readme, "README lacks deterministic pattern-selection documentation")
require("QUERY.get('seed')" in html, "deterministic seed-selection route missing")
require("!PATTERN_LOCKED && elapsed > patternDuration" in html, "deterministic pattern route does not lock transitions")
require("for (float i = 0.0; i < 50.0; i++)" not in html, "legacy 1500-step Flow Field loop returned")
require("float flowPhaseA" in html, "analytic Flow Field implementation missing")
require("float waveX = uv.x * freq + t * flowSpeed * i + seed;" in html,
        "Stipple Waves does not reuse harmonic phases for height and normal")
require(html.count("for (float i = 1.0; i <= 5.0; i++)") == 1,
        "Stipple Waves harmonic work is split across duplicate loops")
require("float backgroundFlow = noise" in html, "Flow Field returned to multi-octave background work")
require("float nebula = mix(warpA, warpB" in html,
        "Cosmic Mycelium does not reuse its domain warp for nebula shading")
require("float nebula = fbm(" not in html,
        "Cosmic Mycelium returned to redundant multi-octave nebula noise")
require("for (float i = 0.0; i < 12.0; i++)" not in html, "legacy 12-neuron distance loop returned")
require("for (float i = 0.0; i < 20.0; i++)" not in html, "legacy 20-spark distance loop returned")
require("float neuralLattice" in html, "analytic Neurons lattice missing")
require("float reactionWarpA" in html, "analytic Reaction membrane missing")
require("reactionCurl" not in html, "Reaction returned to expensive 3D curl work")
require("for (float b = 0.0; b < 64.0; b++)" not in html, "legacy 256-segment Branches loop returned")
require("float branchLattice" in html, "analytic Branches lattice missing")
require("for (float i = 0.0; i < 100.0; i++)" not in html, "legacy 100-star Galaxy loop returned")
require("vec2 starCell = floor(starUv)" in html, "cell-local Galaxy stars missing")
require("float rawDist2 = dot(diff, diff);" in html, "Voronoi squared-distance comparison missing")
require("float minDist = sqrt(minDist2);" in html, "Voronoi final nearest-distance recovery missing")
require("float dist = length(diff);" not in html, "Voronoi returned to nine square roots per fragment")
require("float winningBandAmplitude" in html, "Voronoi per-frequency cell ownership missing")
require("float frequencyCellWeight = mix(2.20, 0.24, bandAmplitude);" in html,
        "Voronoi dramatic frequency-weighted cell sizing missing")
require("const float VORONOI_TIME_SCALE = 0.3333333;" in html,
        "Voronoi-specific one-third motion time scale missing")
require("sin(voronoiMotionTime * (0.22 + bandAmplitude * 0.92)" in html,
        "Voronoi motion is not using the slowed time scale while preserving FFT acceleration")
require("sin(t * (0.22 + bandAmplitude * 0.92)" not in html,
        "Voronoi generator motion returned to full-speed time")
require("uv * (8.0 + bass * 4.0)" not in html,
        "Voronoi returned to uniform bass-driven grid scaling")
require("const FFT_BIN_EDGES = new Float32Array" in html and "const fftBins = new Float32Array(16)" in html,
        "shared 16-bin FFT analysis bus missing")
require("analyser.fftSize = 4096" in html and "analyser.smoothingTimeConstant = 0" in html,
        "main analyzer lacks the 4096-sample unsmoothed FFT contract")
require("const FFT_ATTACK_MS" in html and "const FFT_RELEASE_MS" in html,
        "frequency-dependent FFT envelopes missing")
require("uniform vec4 fftBinsA;" in html and "uniform vec4 fftBinsD;" in html,
        "four-vec4 shader FFT payload missing")
require("float fftBand(float key)" in html, "shared shader fftBand selector missing")
require("float bandAmplitude = fftBand(bandKey);" in html,
        "Voronoi does not consume the 16-bin FFT bus")
require("gl.uniform4fv(uni.fftBinsA, fftUniformA)" in html and
        "gl.uniform4fv(uni.fftBinsD, fftUniformD)" in html,
        "FFT vec4 uniforms are not uploaded per frame")
ribbons_match = re.search(r"vec3 ribbons\(vec2 uv, float t\) \{(.*?)\n\}", html, re.S)
ribbons = ribbons_match.group(1) if ribbons_match else ""
require(ribbons_match is not None, "Ribbons shader function missing")
require("exp(" not in ribbons, "Ribbons returned to per-layer exponential glow")
require("float invRibbonCount" in ribbons, "Ribbons does not hoist its invariant layer division")
require("outside = length(max(d, 0.0))" not in html, "RGB rectangles returned to per-mask square roots")
require("vec3 shadeRgbCluster" in html and "vec2 randomPoint = hash2(candidateCell" in html,
        "RGB randomized cluster field missing")
require("float pixelScale = mix(0.58, 1.38, scaleSeed)" in html,
        "RGB seeded multi-scale geometry missing")
require("float channelSpread = 0.105" in html and "vec2 halfPixel = vec2(0.080, 0.205)" in html,
        "RGB channels returned to obvious wide gutters")
require("vec3 softSpill" in html and "vec3 edgeLight" in html,
        "RGB blur and luminous edge treatment missing")
require("if (secondDistance2 < 0.24)" in html,
        "RGB seam-free distance-gated second cluster missing")
require("vec2 grid = uv * vec2(4.8, 3.2)" not in html,
        "legacy rigid RGB panel grid returned")
require("window.__VISUALIZER_BENCHMARK__ = result" in html, "benchmark telemetry export missing")
require("effectiveDprX: canvas.width / window.innerWidth" in html, "benchmark native-density telemetry missing")
require("BENCHMARK_SAMPLE_FRAMES" in html, "benchmark frame sampler missing")
require("Math.max(120, Math.min(600, requestedBenchmarkFrames))" in html,
        "single-pattern benchmark allows undersized acceptance samples")
require('id="btn-tv"' in html, "TV Mode control missing")
require('id="btn-fft" href="fft.html"' in html, "main visualizer lacks FFT Observatory navigation")
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
require("grainHash(gl_FragCoord.xy + time)" in html,
        "post-process grain returned to the heavier structural hash")
require('id="start-mic"' in fft and 'id="start-demo"' in fft,
        "FFT observatory lacks explicit user-gesture source choices")
require("window.isSecureContext" in fft and "navigator.mediaDevices?.getUserMedia" in fft,
        "FFT microphone path lacks secure-context/media-device guards")
require("Math.pow(ratio, i / Math.max(1, bands.length - 1))" in fft,
        "FFT observatory lacks logarithmic frequency bands")
require("raw > bands[i] ? 0.52 : 0.14" in fft,
        "FFT observatory lacks asymmetric attack/release smoothing")
require("peakHolds[i] - deltaSeconds * 0.19" in fft,
        "FFT observatory lacks decaying peak envelopes")
require("if (++historyTick % 2 === 0) updateHistory();" in fft,
        "FFT spectrogram history is not cadence-limited")
require("Math.min(window.devicePixelRatio || 1, 2)" in fft,
        "FFT observatory lacks native-density DPR handling")
require("mode = 'mic'" in fft and "mode = 'demo'" in fft and "let mode = 'idle'" in fft,
        "FFT source states are not explicitly distinct")
require(fft.count("<script") == fft.count("</script>"), "FFT observatory has unbalanced script tags")
require("FILAMENT VORTEX" in filament_vortex and "function updateMicSpectrum()" in filament_vortex,
        "Filament Vortex candidate route or microphone analysis missing")
require("const FFT_BANDS = 16;" in filament_vortex and "uniform vec4 fftBinsA;" in filament_vortex and
        "uniform vec4 fftBinsD;" in filament_vortex and "float fftBand(float key)" in filament_vortex,
        "Filament Vortex does not expose the 16-band four-vec4 FFT shader bus")
require("float aperture = 0.050 + bass * 0.052" in filament_vortex and
        "float apertureRadius = aperture + rimWarp;" in filament_vortex and
        "float curl = baseTwist + lowMid * 2.35 - treble * 0.64;" in filament_vortex and
        "float filamentWidth = mix" in filament_vortex,
        "Filament Vortex audio is not structurally mapped to organic aperture/curl/filament width")
require("float laneCountA = 88.0" in filament_vortex and "float laneCountB = 131.0" in filament_vortex and
        "float laneCountC = 211.0" in filament_vortex and "float brokenBundle" in filament_vortex,
        "Filament Vortex lacks multi-scale irregular hair bundles")
require("canvas { position: fixed; inset: 0; z-index: 0;" in filament_vortex and
        "#overlay { position: fixed; inset: 0;" in filament_vortex and "z-index: 30" in filament_vortex and
        "button { position: relative; z-index: 32;" in filament_vortex,
        "Filament Vortex overlay/button hit-test layering is not explicit")
require("Math.max(1, Math.min(window.devicePixelRatio || 1, 2))" in filament_vortex and
        "effectiveDprX: canvas.width / window.innerWidth" in filament_vortex,
        "Filament Vortex lacks native-density backing and benchmark telemetry")
require("window.__VISUALIZER_BENCHMARK__ = result" in filament_vortex and "Math.max(120" in filament_vortex,
        "Filament Vortex benchmark export or 120-frame minimum missing")
require("supplied image" in filament_vortex_doc and "no pixels" in filament_vortex_doc and
        "candidates/filament-vortex.html?benchmark=1" in readme,
        "Filament Vortex documentation or README route missing")

if errors:
    print("visualizer verification FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)

print(f"visualizer verification passed: {count} patterns, {len(names)} names")
print("creative contract, effect ledger, transition guard, DPR cap, and Cosmic Mycelium route present")
