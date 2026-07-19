#!/usr/bin/env python3
"""Behavioral/structural verifier for the isolated v4 hero prototype lab."""
from __future__ import annotations
from pathlib import Path
import json
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "v4" / "lab"
JS_PATH = LAB / "hero-lab.js"
RECIPES = LAB / "RECIPES.md"
required = [
    LAB / "index.html",
    LAB / "filament-vortex.html",
    LAB / "prismatic-cathedral.html",
    LAB / "neon-voxel-cloud.html",
    JS_PATH,
    LAB / "hero-lab.css",
    RECIPES,
]
errors: list[str] = []

def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)

def run_node(script: str, cwd: Path = ROOT) -> dict:
    proc = subprocess.run(["node", "-e", script], cwd=cwd, text=True, capture_output=True, timeout=20)
    if proc.returncode != 0:
        raise RuntimeError(f"node failed\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}")
    return json.loads(proc.stdout)

META_RE = re.compile(r"```json\s*\n(\{.*?\})\s*\n```", re.S)

def validate_recipe_contracts(text: str, contracts: dict) -> list[str]:
    problems: list[str] = []
    match = META_RE.search(text)
    if not match:
        return ["RECIPES.md missing machine-readable JSON contract block"]
    try:
        meta = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        return [f"RECIPES.md contract JSON is invalid: {exc}"]
    expected = {
        "filament-vortex": {"strands": contracts.get("filament", {}).get("strands"), "pointsPerStrand": contracts.get("filament", {}).get("pointsPerStrand")},
        "prismatic-cathedral": {"arches": contracts.get("cathedral", {}).get("arches"), "shards": contracts.get("cathedral", {}).get("shards")},
        "neon-voxel-cloud": {"voxels": contracts.get("voxels", {}).get("cells")},
    }
    scenes = meta.get("scenes", {}) if isinstance(meta, dict) else {}
    for scene, fields in expected.items():
        got = scenes.get(scene, {}) if isinstance(scenes, dict) else {}
        for field, value in fields.items():
            if got.get(field) != value:
                problems.append(f"RECIPES.md JSON {scene}.{field}={got.get(field)!r}, expected {value!r}")

    prose = text[match.end():]
    claim_patterns = {
        "filament-vortex.strands": (contracts.get("filament", {}).get("strands"), [r"(\d+)\s*(?=x\s*52\s+ribbon strands)", r"(\d+)\s+strands?"]),
        "filament-vortex.pointsPerStrand": (contracts.get("filament", {}).get("pointsPerStrand"), [r"118\s*x\s*(\d+)\s+ribbon strands", r"(\d+)\s+advected samples"]),
        "prismatic-cathedral.arches": (contracts.get("cathedral", {}).get("arches"), [r"(\d+)\s+arches?", r"(\d+)\s+arched corridor ribs"]),
        "prismatic-cathedral.shards": (contracts.get("cathedral", {}).get("shards"), [r"(\d+)\s+shards?", r"(\d+)\s+bounded prismatic shard"]),
        "neon-voxel-cloud.voxels": (contracts.get("voxels", {}).get("cells"), [r"(\d+)\s+voxels?", r"(\d+)\s+persistent cells?"]),
    }
    for label, (expected_value, patterns) in claim_patterns.items():
        claims: set[int] = set()
        for pattern in patterns:
            for m in re.finditer(pattern, prose, re.I):
                claims.add(int(m.group(1)))
        if expected_value not in claims:
            problems.append(f"RECIPES.md prose missing {label} claim {expected_value}")
        extras = sorted(v for v in claims if v != expected_value)
        if extras:
            problems.append(f"RECIPES.md contradictory {label} claims: expected only {expected_value}, also saw {extras}")
    return problems

for path in required:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")

if not errors:
    js = JS_PATH.read_text()
    recipes = RECIPES.read_text()
    index = (LAB / "index.html").read_text()
    pages = {p.name: p.read_text() for p in required[1:4]}

    for route, scene in {
        "filament-vortex.html": "filament-vortex",
        "prismatic-cathedral.html": "prismatic-cathedral",
        "neon-voxel-cloud.html": "neon-voxel-cloud",
    }.items():
        html = pages[route]
        require("<canvas id=\"hero-canvas\"" in html, f"{route} canvas missing")
        require(f"window.V4_HERO_SCENE='{scene}'" in html, f"{route} scene key missing")
        require("hero-lab.js" in html and "hero-lab.css" in html, f"{route} shared lab shell missing")
        require(route in index, f"{route} not linked from lab index")

    require("module.exports" in js and "createHeadlessScene" in js, "Node-exportable pure helper seam missing")
    require("window.__V4_HERO_LAB__" in js, "browser QA export missing")
    require("canvasFallback" in js and "fallbackReason" in js and "WebGL unavailable" in js,
            "explicit unsupported/fallback state missing")
    require("WebGPU/WGSL" in recipes and "webgpuFallback" in js, "honest WebGPU/WGSL fallback contract missing")
    require("bufferSubData" in js, "renderer must use bufferSubData for per-frame uploads")
    require(len(re.findall(r"bufferData\(", js)) == 2, "expected exactly two one-time bufferData allocations")

    frame_match = re.search(r"function frame\(now\)\{(.*?)window\.requestAnimationFrame\(frame\); \}\n", js, re.S)
    frame_src = frame_match.group(1) if frame_match else ""
    require(frame_match is not None, "frame loop not found")
    require("new Float32Array" not in frame_src, "per-frame new Float32Array hotspot present")
    require("bufferData" not in frame_src, "per-frame full bufferData upload present")
    require("Array.from" not in frame_src and "=[]" not in frame_src, "per-frame topology/list rebuild hotspot present")

    count_script = f"""
const fs = require('fs');
const vm = require('vm');
function loadUmd(path) {{
  const module = {{ exports: {{}} }};
  const sandbox = {{ module, exports: module.exports, console, Float32Array, Array, Math, Object, JSON }};
  vm.runInNewContext(fs.readFileSync(path, 'utf8'), sandbox, {{ filename: path }});
  return module.exports;
}}
const lab = loadUmd({json.dumps(str(JS_PATH))});
const out = {{ contracts: lab.CONTRACTS, scenes: {{}} }};
for (const scene of ['filament-vortex','prismatic-cathedral','neon-voxel-cloud']) {{
  const a = lab.createHeadlessScene(scene, 17, 'demo');
  const s12 = a.update(12);
  const prefix12 = Array.from(a.mesh.positions.slice(0, 360));
  a.update(0.25); a.update(3.5); a.update(19.75);
  const prefixAfterHistory = Array.from((a.update(12), a.mesh.positions.slice(0, 360)));
  const same = lab.createHeadlessScene(scene, 17, 'demo');
  const same12 = same.update(12);
  const prefixSame = Array.from(same.mesh.positions.slice(0, 360));
  const order = lab.createHeadlessScene(scene, 17, 'demo');
  order.update(18); order.update(6); const order12 = order.update(12);
  const prefixOrder = Array.from(order.mesh.positions.slice(0, 360));
  const diffTime = lab.createHeadlessScene(scene, 17, 'demo');
  const s18 = diffTime.update(18);
  const prefix18 = Array.from(diffTime.mesh.positions.slice(0, 360));
  let liveAdvects = false;
  if (a.mesh.step) {{
    const live = lab.createHeadlessScene(scene, 17, 'demo');
    live.mesh.step(12, live.fft); const liveBefore = Array.from(live.mesh.positions.slice(0,360));
    live.mesh.step(12, live.fft); const liveAfter = Array.from(live.mesh.positions.slice(0,360));
    liveAdvects = !liveBefore.every((v,i)=>Math.abs(v-liveAfter[i]) < 1e-7);
  }}
  const eq = (x,y) => x.length === y.length && x.every((v,i)=>Math.abs(v-y[i]) < 1e-7);
  out.scenes[scene] = {{ summary: s12, sameSeedTimeEqual: eq(prefix12,prefixSame), historyIndependent: eq(prefix12,prefixAfterHistory), callOrderIndependent: eq(prefix12,prefixOrder) && JSON.stringify(s12) === JSON.stringify(order12), changedTimeDifferent: !eq(prefix12,prefix18), liveAdvects, time18: s18, topology: a.mesh.topology, geometry: a.mesh.geometry, contract: a.mesh.contract }};
}}
console.log(JSON.stringify(out));
"""
    try:
        behavior = run_node(count_script)
    except Exception as exc:
        errors.append(str(exc))
        behavior = {"contracts": {}, "scenes": {}}

    contracts = behavior.get("contracts", {})
    require(contracts.get("filament", {}).get("strands") == 118 and contracts.get("filament", {}).get("pointsPerStrand") == 52,
            "Filament contract must be 118x52")
    require(contracts.get("cathedral", {}).get("arches") == 13 and contracts.get("cathedral", {}).get("shards") == 72,
            "Cathedral contract must be 13 arches + 72 shards")
    require(contracts.get("voxels", {}).get("cells") == 260, "Voxel contract must be 260 cells")
    require("118x52 ribbon strands" in recipes, "RECIPES.md missing exact 118x52 ribbon strands")
    require("13 arches + 72 shards" in recipes, "RECIPES.md missing exact 13 arches + 72 shards")
    require("260 voxels" in recipes, "RECIPES.md missing exact 260 voxels")
    for problem in validate_recipe_contracts(recipes, contracts):
        errors.append(problem)
    contradiction_fixtures = {
        "filament": recipes.replace("exactly **118x52 ribbon strands**", "exactly **118x52 ribbon strands**, also 119 strands"),
        "cathedral": recipes.replace("exactly **13 arches + 72 shards**", "exactly **13 arches + 72 shards**, also 14 arches and 73 shards"),
        "voxels": recipes.replace("exactly **260 voxels**", "exactly **260 voxels**, also 261 voxels"),
    }
    for label, bad_recipe in contradiction_fixtures.items():
        if not validate_recipe_contracts(bad_recipe, contracts):
            errors.append(f"RECIPES.md contradiction regression was not rejected for {label}")

    for scene, data in behavior.get("scenes", {}).items():
        require(data.get("sameSeedTimeEqual"), f"{scene} is not deterministic for same seed/time")
        require(data.get("historyIndependent"), f"{scene} same seed/time depends on prior updates")
        require(data.get("callOrderIndependent"), f"{scene} same seed/time depends on call order")
        require(data.get("changedTimeDifferent"), f"{scene} geometry does not change when time changes")
        summary = data.get("summary", {})
        require(summary.get("vertexCount", 0) > 0, f"{scene} emitted no vertices")
        require(summary.get("width", 0) >= 2.0 and summary.get("height", 0) >= 1.5, f"{scene} composition bounds too small: {summary}")
        if scene == "filament-vortex":
            require(data.get("liveAdvects"), "Filament live unlocked step must still advect persistent phase/radius state")
            require(summary.get("vertexCount") == 118 * 51 * 6 * 3, "Filament vertex count must prove 118x52 × 3 ribbon layers")
        if scene == "prismatic-cathedral":
            b = summary.get("bounds", {})
            require(b.get("minX", 0) < -1.5 and b.get("maxX", 0) > 1.5 and b.get("minY", 0) < -1.1 and b.get("maxY", 0) > 1.5,
                    f"Cathedral occupancy/depth bounds too schematic: {summary}")
            require(summary.get("depth", 0) >= 5.5, f"Cathedral depth layering too shallow: {summary}")
        if scene == "neon-voxel-cloud":
            require(summary.get("width", 0) >= 4.6 and summary.get("depth", 0) >= 6.0, f"Voxel cloud mass/depth too small: {summary}")

    # Adversarial proof: make locked update use persistent stepping; verifier should detect history-dependent same seed/time captures.
    if not errors:
        mutated = js.replace("mesh.update=(t,fft)=>{ renderFilaments(t,fft,true); };",
                             "mesh.update=(t,fft)=>{ renderFilaments(t,fft,false); };")
        with tempfile.TemporaryDirectory(prefix="hermes-hero-lab-") as td:
            tmp = Path(td) / "hero-lab-mutated.js"
            tmp.write_text(mutated)
            mutation_script = f"""
const fs = require('fs');
const vm = require('vm');
function loadUmd(path) {{
  const module = {{ exports: {{}} }};
  const sandbox = {{ module, exports: module.exports, console, Float32Array, Array, Math, Object, JSON }};
  vm.runInNewContext(fs.readFileSync(path, 'utf8'), sandbox, {{ filename: path }});
  return module.exports;
}}
const lab = loadUmd({json.dumps(str(tmp))});
const s = lab.createHeadlessScene('filament-vortex', 17, 'demo');
s.update(12); const locked = Array.from(s.mesh.positions.slice(0,360));
s.update(2); s.update(7); s.update(12); const afterHistory = Array.from(s.mesh.positions.slice(0,360));
const eq = locked.length === afterHistory.length && locked.every((v,i)=>Math.abs(v-afterHistory[i]) < 1e-7);
console.log(JSON.stringify({{ mutationRejected: !eq }}));
"""
            try:
                adversarial = run_node(mutation_script)
                require(adversarial.get("mutationRejected") is True,
                        "adversarial mutation did not make filament locked capture history-dependent as expected; test may be invalid")
            except Exception as exc:
                errors.append(f"adversarial verifier probe failed: {exc}")

    for heading in ["Geometry", "Simulation state", "Camera", "Material", "Lighting", "Post stack", "Audio mapping", "Topology", "Fallback", "Originality notes"]:
        require(heading in recipes, f"recipe heading missing: {heading}")
    require("spatial sheet" in recipes and "chronological sheet" in recipes and "mode=demo" in recipes,
            "motion-sheet scaffolding or demo-input label missing")

if errors:
    print("v4 hero lab verification FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)
print("v4 hero lab verification passed: behavioral helpers, exact recipe counts, deterministic seed/time, time-varying geometry, persistent filament advection, composition bounds, audio structure, one-time bufferData + per-frame bufferSubData, fallback contracts")
