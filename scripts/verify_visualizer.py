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
