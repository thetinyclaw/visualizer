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
const lab = require({json.dumps(str(JS_PATH))});
const out = {{ contracts: lab.CONTRACTS, scenes: {{}} }};
for (const scene of ['filament-vortex','prismatic-cathedral','neon-voxel-cloud']) {{
  const a = lab.createHeadlessScene(scene, 17, 'demo');
  const s12 = a.update(12);
  const prefix12 = Array.from(a.mesh.positions.slice(0, 360));
  const same = lab.createHeadlessScene(scene, 17, 'demo');
  const same12 = same.update(12);
  const prefixSame = Array.from(same.mesh.positions.slice(0, 360));
  const diffTime = lab.createHeadlessScene(scene, 17, 'demo');
  const s18 = diffTime.update(18);
  const prefix18 = Array.from(diffTime.mesh.positions.slice(0, 360));
  const repeatBefore = Array.from(a.mesh.positions.slice(0, 360));
  a.update(12);
  const repeatAfter = Array.from(a.mesh.positions.slice(0, 360));
  const eq = (x,y) => x.length === y.length && x.every((v,i)=>Math.abs(v-y[i]) < 1e-7);
  out.scenes[scene] = {{ summary: s12, sameSeedTimeEqual: eq(prefix12,prefixSame), changedTimeDifferent: !eq(prefix12,prefix18), repeatedSameTimeAdvects: !eq(repeatBefore,repeatAfter), time18: s18, topology: a.mesh.topology, geometry: a.mesh.geometry, contract: a.mesh.contract }};
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

    for scene, data in behavior.get("scenes", {}).items():
        require(data.get("sameSeedTimeEqual"), f"{scene} is not deterministic for same seed/time")
        require(data.get("changedTimeDifferent"), f"{scene} geometry does not change when time changes")
        summary = data.get("summary", {})
        require(summary.get("vertexCount", 0) > 0, f"{scene} emitted no vertices")
        require(summary.get("width", 0) >= 2.0 and summary.get("height", 0) >= 1.5, f"{scene} composition bounds too small: {summary}")
        if scene == "filament-vortex":
            require(data.get("repeatedSameTimeAdvects"), "Filament repeated same-time update must advect persistent phase/radius state")
            require(summary.get("vertexCount") == 118 * 51 * 6 * 3, "Filament vertex count must prove 118x52 × 3 ribbon layers")
        if scene == "prismatic-cathedral":
            b = summary.get("bounds", {})
            require(b.get("minX", 0) < -1.5 and b.get("maxX", 0) > 1.5 and b.get("minY", 0) < -1.1 and b.get("maxY", 0) > 1.5,
                    f"Cathedral occupancy/depth bounds too schematic: {summary}")
            require(summary.get("depth", 0) >= 5.5, f"Cathedral depth layering too shallow: {summary}")
        if scene == "neon-voxel-cloud":
            require(summary.get("width", 0) >= 4.6 and summary.get("depth", 0) >= 6.0, f"Voxel cloud mass/depth too small: {summary}")

    # Adversarial proof: remove both phase and radius advection; verifier should detect lack of persistent same-time state change.
    if not errors:
        mutated = js.replace("strand.phase += strand.handed*(.006 + hi*.014); strand.radius += Math.sin(t*.27+strand.bin)*.00135;",
                             "strand.phase += 0; strand.radius += 0;")
        with tempfile.TemporaryDirectory(prefix="hermes-hero-lab-") as td:
            tmp = Path(td) / "hero-lab-mutated.js"
            tmp.write_text(mutated)
            mutation_script = f"""
const lab = require({json.dumps(str(tmp))});
const s = lab.createHeadlessScene('filament-vortex', 17, 'demo');
s.update(12); const a = Array.from(s.mesh.positions.slice(0,360));
s.update(12); const b = Array.from(s.mesh.positions.slice(0,360));
const eq = a.length === b.length && a.every((v,i)=>Math.abs(v-b[i]) < 1e-7);
console.log(JSON.stringify({{ mutationAccepted: eq }}));
"""
            try:
                adversarial = run_node(mutation_script)
                require(adversarial.get("mutationAccepted") is True,
                        "adversarial mutation did not remove same-time filament advection as expected; test may be invalid")
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
