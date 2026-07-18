#!/usr/bin/env python3
"""Structural checks for reference-informed candidate visualizers."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
CANDIDATES = ROOT / "candidates"
FILES = [
    CANDIDATES / "candidate-runner.js",
    CANDIDATES / "prismatic-rupture-cathedral.html",
    CANDIDATES / "chromatic-iris-mycorrhiza.html",
    CANDIDATES / "README.md",
]
errors = []
for path in FILES:
    if not path.exists():
        errors.append(f"missing {path.relative_to(ROOT)}")

if not errors:
    runner = (CANDIDATES / "candidate-runner.js").read_text()
    readme = (CANDIDATES / "README.md").read_text()
    pages = {path.name: path.read_text() for path in FILES[1:3]}

    def require(condition, message):
        if not condition:
            errors.append(message)

    require("Math.max(1, Math.min(window.devicePixelRatio || 1, 2))" in runner, "runner does not preserve native-density DPR")
    require("const benchmarkFrames = Math.max(120" in runner, "runner allows sub-120 benchmark acceptance")
    require("window.__CANDIDATE_BENCHMARK__ = result" in runner and "CANDIDATE_BENCHMARK" in runner, "benchmark export/log missing")
    require("const fftBins = new Float32Array(16)" in runner, "16-band FFT bus missing")
    require("uniform vec4 fftBinsA" in runner and "uniform vec4 fftBinsD" in runner, "four vec4 FFT shader payload missing")
    require("float fftBand(float key)" in runner, "shader FFT selector missing")
    require("seed = Number.isFinite(requestedSeed)" in runner, "deterministic seed route missing")

    for name, html in pages.items():
        require("<canvas id=\"canvas\"" in html, f"{name} canvas missing")
        require("<script src=\"candidate-runner.js\"></script>" in html, f"{name} does not use reusable runner")
        require("startCandidate(`" in html, f"{name} shader route missing")
        require("fftBand(" in html, f"{name} shader does not consume FFT bands")
        require("seed" in html, f"{name} lacks seeded structural variation")
        require(html.count("<script") == html.count("</script>"), f"{name} unbalanced script tags")
        require(re.search(r"reference: 'doc_[^']+\.mp4'", html), f"{name} reference identifier missing")

    require("Prismatic Rupture Cathedral" in readme and "Chromatic Iris Mycorrhiza" in readme, "candidate README lacks both effect notes")
    require("Topolog" in readme and "FFT-ready mapping" in readme, "candidate README lacks topology/FFT notes")

if errors:
    print("candidate verification FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)
print("candidate verification passed: 2 routes, reusable runner, seed routing, 16-band FFT bus, benchmark telemetry")
