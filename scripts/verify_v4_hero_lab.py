#!/usr/bin/env python3
"""Structural verifier for the isolated v4 hero prototype lab."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "v4" / "lab"
required = [
    LAB / "index.html",
    LAB / "filament-vortex.html",
    LAB / "prismatic-cathedral.html",
    LAB / "neon-voxel-cloud.html",
    LAB / "hero-lab.js",
    LAB / "hero-lab.css",
    LAB / "RECIPES.md",
]
errors = []

def require(condition, message):
    if not condition:
        errors.append(message)

for path in required:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")

if not errors:
    index = (LAB / "index.html").read_text()
    js = (LAB / "hero-lab.js").read_text()
    recipes = (LAB / "RECIPES.md").read_text()
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

    require("URLSearchParams(location.search)" in js and "seed" in js and "lockedTime" in js and "inputMode" in js,
            "deterministic seed/time/input controls missing")
    require("Math.max(1, Math.min(devicePixelRatio || 1, 2))" in js,
            "native CSS density guard missing")
    require("gl.enable(gl.DEPTH_TEST)" in js and "gl.drawArrays(mesh.primitive" in js,
            "WebGL depth-tested renderer missing")
    require("window.__V4_HERO_LAB__" in js, "lab export missing")
    require("canvasFallback" in js and "fallbackReason" in js and "WebGL unavailable" in js,
            "explicit unsupported/fallback state missing")
    require("webgpuFallback" in js and "WGSL" in recipes and "WebGPU" in recipes,
            "honest WebGPU/WGSL fallback note missing")

    filament = re.search(r"function buildFilament\(\)\{(.*?)function buildCathedral", js, re.S)
    cathedral = re.search(r"function buildCathedral\(\)\{(.*?)function buildVoxels", js, re.S)
    voxels = re.search(r"function buildVoxels\(\)\{(.*?)function addShard", js, re.S)
    require(filament and "strands" in filament.group(1) and "pts" in filament.group(1) and "addRibbon" in filament.group(1) and "118" in filament.group(1),
            "Filament Vortex lacks persistent thick strand/advection ribbon topology")
    require(filament and "occupiedSilhouette:.68" in filament.group(1) and "lineBundleWidth:.052" in filament.group(1),
            "Filament Vortex composition bounds/hierarchy invariants missing")
    require(cathedral and "addShard" in cathedral.group(1) and "addArch" in cathedral.group(1) and "13 arch ribs" in cathedral.group(1) and "72" in cathedral.group(1),
            "Prismatic Cathedral lacks bounded arch/corridor triangle geometry")
    require(cathedral and "nearPlaneClearance:3.9" in cathedral.group(1) and "maxShardSize:.36" in cathedral.group(1) and "corridorHalfWidth:1.72" in cathedral.group(1),
            "Prismatic Cathedral camera/geometry clipping invariants missing")
    require(voxels and "addCube" in voxels.group(1) and "260" in voxels.group(1) and "c.on = c.on*.89" in voxels.group(1),
            "Neon Voxel Cloud lacks persistent voxel occupancy/cube geometry")
    require(voxels and "coherentMassRadius:2.25" in voxels.group(1) and "maxCubeSize:.26" in voxels.group(1) and "scanAxis:'diagonal y/z front'" in voxels.group(1),
            "Neon Voxel Cloud composition/scan invariants missing")
    require("cameraFor" in js and "perspective(" in js and "lookAt(" in js and "7.0" in js and "5.8" in js and "4.25" in js,
            "perspective camera travel/bounds missing")
    require("function bands" in js and "fft" in js and "bin" in js,
            "structural audio band mapping missing")

    recipe_sections = ["Geometry", "Simulation state", "Camera", "Material", "Lighting", "Post stack", "Audio mapping", "Topology", "Originality notes"]
    for name in ["Filament Vortex", "Prismatic Cathedral", "Neon Voxel Cloud"]:
        require(f"## {name}" in recipes, f"recipe missing for {name}")
    for heading in recipe_sections:
        require(heading in recipes, f"recipe heading missing: {heading}")
    require("spatial sheet" in recipes and "chronological sheet" in recipes and "mode=demo" in recipes,
            "motion-sheet scaffolding or demo-input label missing")

if errors:
    print("v4 hero lab verification FAILED")
    for error in errors:
        print(f"- {error}")
    sys.exit(1)
print("v4 hero lab verification passed: 3 routes, deterministic seed/time/input controls, native-DPR guard, 3D depth geometry, structural audio mappings, recipes, and fallback states")
