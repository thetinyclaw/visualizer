#!/usr/bin/env python3
"""Visualizer v4 evidence, benchmark, candidate-factory, and release-gate tooling.

The tool is intentionally dependency-free and fail-closed. It validates JSON evidence
packs and can generate deterministic local capture commands plus paired motion-sheet
scaffolds without claiming that browser captures occurred.
"""
from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import math
import os
import shutil
import shlex
import struct
import sys
import threading
import time
import uuid
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Set
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURES = ROOT / "v4" / "evidence" / "fixtures"
DEFAULT_RAW_ROOT = DEFAULT_FIXTURES / "raw"
DEFAULT_DERIVED_ROOT = ROOT / "v4" / "evidence" / "derived"
DEFAULT_CAPTURE_ROOT = ROOT / "v4" / "evidence" / "local-runs"
PLAYWRIGHT_WEBGPU_ARGS = (
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,UseSkiaRenderer",
    "--disable-vulkan-surface",
)
TERMINAL_STATES = {"approved_for_release", "rejected", "discarded", "branched_for_learning"}
FACTORY_STATES = [
    "ingested_reference",
    "brief_created",
    "prototype_isolated",
    "motion_sheets_created",
    "checks_passed",
    "awaiting_human_approval",
    "approved_for_release",
    "rejected",
    "discarded",
    "branched_for_learning",
]
ALLOWED_TRANSITIONS = {
    None: {"ingested_reference"},
    "ingested_reference": {"brief_created", "rejected", "discarded", "branched_for_learning"},
    "brief_created": {"prototype_isolated", "rejected", "discarded", "branched_for_learning"},
    "prototype_isolated": {"motion_sheets_created", "rejected", "discarded", "branched_for_learning"},
    "motion_sheets_created": {"checks_passed", "rejected", "discarded", "branched_for_learning"},
    "checks_passed": {"awaiting_human_approval", "rejected", "discarded", "branched_for_learning"},
    "awaiting_human_approval": {"approved_for_release", "rejected", "discarded", "branched_for_learning"},
}
DISALLOWED_TELEMETRY_LABELS = (
    "fake", "fabricated", "synthetic", "simulated", "dummy", "placeholder", "n/a", "estimated",
    "mock", "mocked", "artificial", "fixture", "scaffold", "tooling only", "automation-only",
    "no live", "not real",
)
CONSOLE_ERROR_TYPES = {"error", "assert"}
APPROVAL_ABSENCE_PHRASES = (
    "no live capture", "no browser capture", "no real capture", "capture absent", "without live evidence",
    "live evidence absent", "missing live evidence", "missing evidence", "no live evidence", "fixture only",
    "scaffold only", "tooling validation only", "tooling-only", "tool only", "tool-only", "not a performance claim",
    "not acceptance", "no capture", "capture not performed", "capture was not performed", "evidence is missing",
)
REQUIRED_RECIPE_SECTIONS = [
    "topology", "projection", "silhouette", "occupancy", "camera", "layers", "motion_law",
    "material", "lighting", "temporal_arc", "originality",
]
REQUIRED_SOURCE_FIELDS = ["id", "immutable_path", "sha256", "rights", "allowed_transformations"]
SHELL_METACHARS = set(";&|`$<>(){}[]*?!\n\r")


class EvidenceError(ValueError):
    """Raised when an evidence artifact fails a release gate."""


@dataclass
class ValidationResult:
    path: str
    ok: bool
    message: str


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvidenceError(message)


def require_mapping(value: Any, name: str) -> Mapping[str, Any]:
    require(isinstance(value, Mapping), f"{name} must be an object")
    return value


def require_nonempty_string(value: Any, name: str) -> str:
    require(isinstance(value, str) and value.strip(), f"{name} must be a non-empty string")
    return value


def require_iso8601(value: Any, name: str) -> None:
    text = require_nonempty_string(value, name)
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvidenceError(f"{name} must be ISO-8601: {text}") from exc


def validate_sha256(text: Any, field_name: str) -> None:
    require(isinstance(text, str) and len(text) == 64 and all(ch in "0123456789abcdef" for ch in text),
            f"{field_name} must be a lowercase 64-character sha256")


def compute_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def png_central_visual_metrics(path: Path) -> Mapping[str, Any]:
    """Decode an 8-bit Playwright PNG and measure the central canvas region."""
    payload = path.read_bytes()
    require(payload.startswith(b"\x89PNG\r\n\x1a\n"), "capture must be a PNG")
    offset = 8
    width = height = color_type = bit_depth = interlace = None
    compressed = bytearray()
    while offset + 12 <= len(payload):
        length = struct.unpack(">I", payload[offset:offset + 4])[0]
        kind = payload[offset + 4:offset + 8]
        chunk = payload[offset + 8:offset + 8 + length]
        require(offset + 12 + length <= len(payload), "capture PNG chunk is truncated")
        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", chunk)
            require(compression == 0 and filtering == 0, "capture PNG uses unsupported compression/filter method")
        elif kind == b"IDAT":
            compressed.extend(chunk)
        elif kind == b"IEND":
            break
        offset += 12 + length
    require(isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0, "capture PNG missing valid IHDR")
    require(bit_depth == 8 and color_type in {2, 6} and interlace == 0,
            "capture PNG must be non-interlaced 8-bit RGB/RGBA")
    assert isinstance(width, int) and isinstance(height, int)
    width_value = width
    height_value = height
    channels = 3 if color_type == 2 else 4
    stride = width_value * channels
    decoded = zlib.decompress(bytes(compressed))
    require(len(decoded) == (stride + 1) * height_value, "capture PNG scanline length mismatch")
    previous = bytearray(stride)
    rows: List[bytearray] = []

    def paeth(a: int, b: int, c: int) -> int:
        estimate = a + b - c
        pa, pb, pc = abs(estimate - a), abs(estimate - b), abs(estimate - c)
        return a if pa <= pb and pa <= pc else (b if pb <= pc else c)

    cursor = 0
    for _ in range(height_value):
        filter_kind = decoded[cursor]
        raw = decoded[cursor + 1:cursor + 1 + stride]
        cursor += stride + 1
        row = bytearray(stride)
        for index, value in enumerate(raw):
            left = row[index - channels] if index >= channels else 0
            up = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_kind == 0: predictor = 0
            elif filter_kind == 1: predictor = left
            elif filter_kind == 2: predictor = up
            elif filter_kind == 3: predictor = (left + up) // 2
            elif filter_kind == 4: predictor = paeth(left, up, upper_left)
            else: raise EvidenceError(f"capture PNG uses unsupported filter {filter_kind}")
            row[index] = (value + predictor) & 0xFF
        rows.append(row)
        previous = row

    x0, x1 = width_value // 5, width_value - width_value // 5
    y0, y1 = height_value // 5, height_value - height_value // 5
    sampled = bright = vivid = 0
    max_rgb = 0
    for y in range(y0, y1):
        row = rows[y]
        for x in range(x0, x1):
            base = x * channels
            r, g, b = row[base], row[base + 1], row[base + 2]
            peak = max(r, g, b)
            sampled += 1
            max_rgb = max(max_rgb, peak)
            if peak >= 64 and r + g + b >= 128:
                bright += 1
                if peak - min(r, g, b) >= 12: vivid += 1
    require(sampled > 0, "capture PNG central sample region is empty")
    return {"sample_region": "central-60-percent", "sampled_pixels": sampled, "bright_pixels": bright,
            "bright_fraction": bright / sampled, "vivid_pixels": vivid, "vivid_fraction": vivid / sampled,
            "max_rgb": max_rgb}


def require_nonblack_capture(path: Path) -> Mapping[str, Any]:
    metrics = png_central_visual_metrics(path)
    require(metrics["max_rgb"] >= 64 and metrics["bright_fraction"] >= 0.002,
            "capture central canvas region is black or lacks visible rendered content")
    return metrics


def repo_relative_path(text: str, field_name: str) -> Path:
    p = Path(require_nonempty_string(text, field_name))
    require(not p.is_absolute() and ".." not in p.parts, f"{field_name} must be repo-relative with no traversal")
    return p


def realpath_under(path: Path, root: Path, label: str) -> Path:
    root_real = root.resolve(strict=True)
    require(path.exists(), f"{label} does not exist: {path}")
    path_real = path.resolve(strict=True)
    require(path_real == root_real or root_real in path_real.parents, f"{label} escapes declared root: {path}")
    return path_real


def path_has_symlink_component(path: Path) -> bool:
    current = Path(path.anchor) if path.is_absolute() else Path()
    for part in path.parts:
        if part == path.anchor:
            continue
        current = current / part
        if current.exists() and current.is_symlink():
            return True
    return False


def declared_root(manifest: Mapping[str, Any], key: str, default: Path) -> Path:
    raw = manifest.get(key)
    if raw is None:
        return default
    return ROOT / repo_relative_path(raw, key)


def validate_human_decision(decision: Any, *, require_approved: bool, context: str, forbid_absence_notes: bool = False) -> None:
    decision = require_mapping(decision, f"{context}.human_decision")
    status = require_nonempty_string(decision.get("status"), f"{context}.human_decision.status")
    require(status in {"approved", "rejected", "revise", "branch", "discard"},
            f"{context}.human_decision.status has unsupported value {status!r}")
    if require_approved:
        require(status == "approved", f"{context} requires explicit human approval")
    require_nonempty_string(decision.get("approver_id"), f"{context}.human_decision.approver_id")
    statement = require_nonempty_string(decision.get("statement"), f"{context}.human_decision.statement")
    require_iso8601(decision.get("decided_at"), f"{context}.human_decision.decided_at")
    require(decision.get("autonomous") is False, f"{context}.human_decision.autonomous must be false")
    if forbid_absence_notes and status == "approved":
        lowered = statement.lower()
        require(not any(phrase in lowered for phrase in APPROVAL_ABSENCE_PHRASES),
                f"{context}.human_decision.statement admits required live evidence is absent")


def validate_provenance(manifest: Mapping[str, Any], *, root: Path = ROOT, verify_hashes: bool = True) -> None:
    # verify_hashes is kept for API compatibility but hashing is now mandatory/fail-closed.
    del verify_hashes
    require_nonempty_string(manifest.get("manifest_version"), "manifest_version")
    require_nonempty_string(manifest.get("effect_id"), "effect_id")
    require_iso8601(manifest.get("created_at"), "created_at")
    raw_root = declared_root(manifest, "raw_root", DEFAULT_RAW_ROOT)
    derived_root = declared_root(manifest, "derived_root", DEFAULT_DERIVED_ROOT)
    raw_real = realpath_under(raw_root, root, "raw_root")
    if not derived_root.exists():
        derived_root.mkdir(parents=True, exist_ok=True)
    derived_real = derived_root.resolve(strict=True)
    require(raw_real != derived_real and raw_real not in derived_real.parents and derived_real not in raw_real.parents,
            "raw_root and derived_root must be separate trees")
    sources = manifest.get("sources")
    require(isinstance(sources, list) and sources, "sources must be a non-empty array")
    for i, source in enumerate(sources):
        source = require_mapping(source, f"sources[{i}]")
        for field in REQUIRED_SOURCE_FIELDS:
            require(field in source, f"sources[{i}].{field} is required")
        immutable_path = repo_relative_path(source["immutable_path"], f"sources[{i}].immutable_path")
        actual_path = root / immutable_path
        actual_real = realpath_under(actual_path, raw_root, f"sources[{i}].immutable_path")
        require(actual_path.resolve(strict=True) == actual_real, f"sources[{i}].immutable_path must resolve canonically")
        validate_sha256(source["sha256"], f"sources[{i}].sha256")
        actual_hash = compute_file_sha256(actual_real)
        require(actual_hash == source["sha256"], f"sources[{i}].sha256 mismatch: expected {source['sha256']} got {actual_hash}")
        rights = require_mapping(source["rights"], f"sources[{i}].rights")
        require_nonempty_string(rights.get("status"), f"sources[{i}].rights.status")
        require(rights["status"] in {"owned", "licensed", "permission_granted", "public_domain", "internal_reference_only"},
                f"sources[{i}].rights.status is not accepted")
        require_nonempty_string(rights.get("evidence"), f"sources[{i}].rights.evidence")
        transformations = source["allowed_transformations"]
        require(isinstance(transformations, list) and transformations, f"sources[{i}].allowed_transformations must be non-empty")
        disallowed = {"embed_source_frame", "copy_pixels", "trace_exact_layout", "use_watermark"}
        require(not disallowed.intersection(transformations),
                f"sources[{i}] includes disallowed transformation {sorted(disallowed.intersection(transformations))}")
    derived = manifest.get("derived_outputs")
    require(isinstance(derived, list), "derived_outputs must be an array")
    for i, text in enumerate(derived):
        rel = repo_relative_path(text, f"derived_outputs[{i}]")
        out_path = root / rel
        parent = out_path.parent
        require(parent.exists(), f"derived_outputs[{i}] parent does not exist: {parent}")
        parent_real = parent.resolve(strict=True)
        require(derived_real == parent_real or derived_real in parent_real.parents, f"derived_outputs[{i}] must be under derived_root")
        require(raw_real not in parent_real.parents and parent_real != raw_real, f"derived_outputs[{i}] must be outside raw_root")
    validate_human_decision(manifest.get("human_decision"), require_approved=False, context="provenance")


def validate_scene_recipe(recipe: Mapping[str, Any]) -> None:
    require_nonempty_string(recipe.get("recipe_version"), "recipe_version")
    require_nonempty_string(recipe.get("effect_id"), "effect_id")
    for section_name in REQUIRED_RECIPE_SECTIONS:
        section = require_mapping(recipe.get(section_name), section_name)
        require_nonempty_string(section.get("summary"), f"{section_name}.summary")
        evidence = section.get("evidence")
        require(isinstance(evidence, list) and evidence, f"{section_name}.evidence must be a non-empty array")
        for i, item in enumerate(evidence):
            require_nonempty_string(item, f"{section_name}.evidence[{i}]")
    originality = require_mapping(recipe.get("originality"), "originality")
    require(originality.get("source_pixels_embedded") is False, "originality.source_pixels_embedded must be false")
    require(originality.get("exact_layout_copied") is False, "originality.exact_layout_copied must be false")
    require_nonempty_string(originality.get("transformation_summary"), "originality.transformation_summary")
    validate_human_decision(recipe.get("human_decision"), require_approved=False, context="scene_recipe")


def validate_local_route(route: str) -> None:
    parsed = urlparse(route)
    repo_real = ROOT.resolve(strict=True)
    if parsed.scheme in {"http", "https"}:
        require(parsed.hostname in {"127.0.0.1", "localhost"}, f"route must be local-only, got {route}")
    elif parsed.scheme == "file":
        require(bool(parsed.path), f"file route must include a path: {route}")
        path = Path(parsed.path)
        require(path.exists(), f"file route does not exist: {route}")
        require(not path_has_symlink_component(path), "file route must not include symlink components")
        realpath_under(path, repo_real, "file route")
    else:
        require(not route.startswith("//"), f"route must be local/repo-relative, got {route}")
        rel = repo_relative_path(parsed.path, "route")
        target = ROOT / rel
        require(not path_has_symlink_component(target), "repo-relative route must not include symlink components")
        if target.exists():
            realpath_under(target, repo_real, "repo-relative route")


def validate_capture_spec(spec: Mapping[str, Any]) -> None:
    require_nonempty_string(spec.get("capture_spec_version"), "capture_spec_version")
    require_nonempty_string(spec.get("effect_id"), "effect_id")
    validate_local_route(require_nonempty_string(spec.get("route"), "route"))
    require(isinstance(spec.get("seed"), int), "seed must be an integer")
    viewport = require_mapping(spec.get("viewport"), "viewport")
    require(int(viewport.get("width", 0)) > 0 and int(viewport.get("height", 0)) > 0, "viewport width/height must be positive")
    require(float(spec.get("dpr", 0)) >= 1.0, "dpr must be >= 1")
    frames = spec.get("frames")
    require(isinstance(frames, list) and len(frames) >= 2, "frames must include at least two capture frames")
    last_time = -math.inf
    last_index = -1
    for i, frame in enumerate(frames):
        frame = require_mapping(frame, f"frames[{i}]")
        idx = frame.get("index")
        require(isinstance(idx, int) and idx >= 0 and idx > last_index, f"frames[{i}].index must be strictly increasing")
        last_index = idx
        t = float(frame.get("time_ms"))
        require(t >= last_time, f"frames[{i}].time_ms must be chronological")
        last_time = t
    require(spec.get("browser_automation") in {"playwright", "manual_command", "fixture_only"},
            "browser_automation must be playwright, manual_command, or fixture_only")


def capture_commands(spec: Mapping[str, Any]) -> List[str]:
    validate_capture_spec(spec)
    route = spec["route"]
    viewport = spec["viewport"]
    seed = spec["seed"]
    dpr = spec["dpr"]
    frames_arg = ",".join(str(frame["index"]) for frame in spec["frames"])
    command = (
        "python3 v4/tools/visualizer_v4_evidence.py generate-motion-sheet "
        f"--capture-spec {json_quote(str(spec.get('_source_path', 'v4/evidence/fixtures/capture_spec.local.json')))} "
        "--out v4/evidence/derived/motion_sheet.generated.json"
    )
    browser_hint = (
        "# Local browser capture command (requires Playwright installed; records real screenshots if run by a human/operator):\n"
        f"# python3 -m playwright codegen --viewport-size={viewport['width']},{viewport['height']} "
        f"{json_quote(route + ('&' if '?' in route else '?') + 'seed=' + str(seed))}"
    )
    fixture_hint = (
        "# Deterministic fixture scaffold only; no capture is claimed by this command. "
        f"viewport={viewport['width']}x{viewport['height']} dpr={dpr} frames={frames_arg}"
    )
    return [fixture_hint, browser_hint, command]


def json_quote(value: str) -> str:
    return json.dumps(value)


def generate_motion_sheet(spec: Mapping[str, Any]) -> Mapping[str, Any]:
    validate_capture_spec(spec)
    frames = spec["frames"]
    spatial_cells = [
        {"frame_index": frame["index"], "time_ms": frame["time_ms"], "role": frame.get("role", "sample"),
         "capture_path": None, "status": "pending_real_capture"}
        for frame in frames
    ]
    chronological = []
    for previous, current in zip(frames, frames[1:]):
        chronological.append({
            "from_frame": previous["index"], "to_frame": current["index"],
            "delta_ms": current["time_ms"] - previous["time_ms"],
            "motion_observation": "pending_human_review", "geometry_motion": None,
            "illumination_motion": None, "camera_motion": None,
        })
    return {
        "motion_sheet_version": "1.0", "effect_id": spec["effect_id"], "route": spec["route"],
        "seed": spec["seed"], "viewport": spec["viewport"], "dpr": spec["dpr"],
        "spatial_sheet": spatial_cells, "chronological_sheet": chronological,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "capture_claim": "fixture_scaffold_only_no_browser_capture_performed",
    }


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def locked_capture_url(route: str, *, seed: int, time_ms: float, mode: str) -> str:
    """Return a deterministic local URL; reject conflicting seed/time/mode query values."""
    validate_local_route(route)
    parsed = urlparse(route)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    locks = {"seed": str(int(seed)), "time": format(float(time_ms) / 1000.0, ".6f").rstrip("0").rstrip("."), "mode": mode}
    for key, value in locks.items():
        if key in query and query[key] != value:
            raise EvidenceError(f"route already contains conflicting {key}={query[key]!r}; deterministic lock requires {value!r}")
        query[key] = value
    return urlunparse(parsed._replace(query=urlencode(query)))


def parse_frame_indices(text: str) -> List[int]:
    frames = [int(part.strip()) for part in text.split(",") if part.strip()]
    require(len(frames) >= 2, "at least two capture frame indices are required")
    require(frames == sorted(set(frames)), "capture frame indices must be strictly increasing")
    return frames


def safe_run_directory(out_root: Path, run_id: str, *, allow_existing: bool = False) -> Path:
    root = out_root.resolve()
    repo = ROOT.resolve()
    require(root == repo or repo in root.parents, "out root must stay inside this repository")
    require(not path_has_symlink_component(root), "out root must not include symlink components")
    require(bool(run_id) and all(ch.isalnum() or ch in "-_." for ch in run_id), "run id must be path-safe")
    run_dir = root / run_id
    if run_dir.exists() and not allow_existing:
        raise EvidenceError(f"run directory already exists; refusing overwrite: {run_dir}")
    require(not path_has_symlink_component(run_dir), "run directory must not include symlink components")
    return run_dir


def local_capture_plan(*, route: str, seed: int, time_ms: float, mode: str, viewport: Mapping[str, int],
                       frame_indices: Sequence[int], out_root: Path, run_id: str, timeout_ms: int,
                       dpr: float = 1.0) -> Mapping[str, Any]:
    require(float(dpr) >= 1.0, "dpr must be >= 1")
    locked = locked_capture_url(route, seed=seed, time_ms=time_ms, mode=mode)
    run_dir = safe_run_directory(out_root, run_id, allow_existing=False)
    return {
        "capture_plan_version": "1.0",
        "supported_when": "Python Playwright is installed with a browser binary; otherwise execution returns unsupported without artifacts.",
        "route": route,
        "locked_url": locked,
        "seed": seed,
        "time_ms": time_ms,
        "mode": mode,
        "viewport": {"width": int(viewport["width"]), "height": int(viewport["height"])},
        "dpr": float(dpr),
        "minimum_frame_samples": 120,
        "warmup_raf_frames": 10,
        "capture_frame_indices": list(frame_indices),
        "out_root": str(out_root),
        "run_id": run_id,
        "raw_dir": str(run_dir / "raw"),
        "derived_dir": str(run_dir / "derived"),
        "timeout_ms": timeout_ms,
        "network_upload": False,
        "overwrite_policy": "refuse_existing_run_directory",
    }


def browser_harness_script(seed: int, time_ms: float, mode: str, min_frames: int) -> str:
    # Dependency-free script injected by the local controller. It only observes and
    # exports page/runtime state; Playwright performs the actual PNG screenshots.
    return f"""
(() => {{
  const config = {{ seed: {int(seed)}, lockedTimeMs: {float(time_ms)}, mode: {json.dumps(mode)}, minFrames: {int(min_frames)} }};
  window.__V4_CAPTURE_CONFIG__ = Object.freeze(config);
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  const consoleLogs = [];
  console.error = (...args) => {{ consoleLogs.push({{ type: 'error', text: args.map(String).join(' ') }}); originalError(...args); }};
  console.warn = (...args) => {{ consoleLogs.push({{ type: 'warning', text: args.map(String).join(' ') }}); originalWarn(...args); }};
  window.addEventListener('error', (event) => consoleLogs.push({{ type: 'error', text: String(event.message || 'window error') }}));
  window.addEventListener('unhandledrejection', (event) => consoleLogs.push({{ type: 'error', text: String(event.reason && (event.reason.message || event.reason) || 'unhandled rejection') }}));
  window.__V4_CAPTURE_SAMPLE__ = async function() {{
    const frames = [];
    const warmup = 10;
    let previous = null;
    await new Promise((resolve) => {{ let n = 0; const tick = () => (++n >= warmup ? resolve() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }});
    await new Promise((resolve) => {{
      const tick = (ts) => {{
        if (previous !== null) frames.push({{ frame_index: frames.length, frame_ms: ts - previous, timestamp_ms: ts }});
        previous = ts;
        if (frames.length >= config.minFrames) resolve(); else requestAnimationFrame(tick);
      }};
      requestAnimationFrame(tick);
    }});
    const canvas = document.querySelector('canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : null;
    const nav = navigator || {{}};
    const perfMemory = performance && performance.memory ? performance.memory : null;
    const compactState = (state) => state ? {{
      sceneId: state.sceneId || null,
      rendererMode: state.rendererMode || state.mode || null,
      active: state.active === true,
      webgpuActive: state.webgpuActive === true,
      frame: state.frame || null,
      frameSubmitted: state.frameSubmitted === true,
      validationErrors: Array.isArray(state.validationErrors) ? state.validationErrors : [],
      webgpuValidationErrors: Array.isArray(state.webgpuValidationErrors) ? state.webgpuValidationErrors : [],
    }} : null;
    const exportedState = {{
      v4RuntimeSmoke: window.__V4_RUNTIME_SMOKE__ || null,
      v4HeroLab: window.__V4_HERO_LAB__ || null,
      v4CathedralWebGPU: compactState(window.__V4_CATHEDRAL_WEBGPU__),
      v4FilamentWebGPU: compactState(window.__V4_FILAMENT_WEBGPU__),
      v4VoxelWebGPU: compactState(window.__V4_VOXEL_WEBGPU__),
      v4HistoryTrails: compactState(window.__V4_HISTORY_TRAILS__),
      v4CaptureConfig: window.__V4_CAPTURE_CONFIG__,
      locationSearch: window.location.search,
    }};
    return {{
      config,
      frameSamples: frames,
      viewport: {{ width: window.innerWidth, height: window.innerHeight }},
      dpr: window.devicePixelRatio,
      backing: canvas ? {{ width: canvas.width, height: canvas.height, cssWidth: rect ? rect.width : null, cssHeight: rect ? rect.height : null }} : null,
      browser: {{ userAgent: nav.userAgent || '', platform: nav.platform || '', hardwareConcurrency: nav.hardwareConcurrency || null, deviceMemory: nav.deviceMemory || null }},
      consoleLogs,
      exportedState,
      memory: {{ jsHeapUsedMB: perfMemory ? perfMemory.usedJSHeapSize / 1048576 : null }},
      gpuTiming: {{ frameMs: null, unknownReason: 'WebGPU timestamp queries are not exposed by this route/controller' }},
      gpuMemory: {{ mb: null, unknownReason: 'Browser GPU memory is not exposed to page JavaScript' }},
    }};
  }};
}})();
"""


def summarize_samples(samples: Sequence[Mapping[str, Any]]) -> Mapping[str, float]:
    require(len(samples) >= 120, "capture telemetry must include at least 120 measured frames")
    values = sorted(float(sample["frame_ms"]) for sample in samples)
    return {"p50_frame_ms": percentile(values, 0.50), "p95_frame_ms": percentile(values, 0.95)}


def raw_ref(path: Path) -> str:
    return str(path.relative_to(ROOT))


def build_real_motion_sheet_from_captures(*, effect_id: str, route: str, seed: int, viewport: Mapping[str, Any], dpr: float,
                                          captures: Sequence[Mapping[str, Any]]) -> Mapping[str, Any]:
    spatial = []
    for capture in captures:
        spatial.append({
            "frame_index": capture["frame_index"],
            "time_ms": capture["time_ms"],
            "requested_time_ms": capture.get("requested_time_ms", capture["time_ms"]),
            "observed_time_ms": capture.get("observed_time_ms", capture["time_ms"]),
            "role": capture.get("role", "sample"),
            "capture_path": capture["capture_path"],
            "capture_sha256": capture["capture_sha256"],
            "status": "captured",
        })
    chronological = []
    for prev, cur in zip(spatial, spatial[1:]):
        chronological.append({
            "from_frame": prev["frame_index"], "to_frame": cur["frame_index"],
            "delta_ms": float(cur["time_ms"]) - float(prev["time_ms"]),
            "from_capture_path": prev["capture_path"], "to_capture_path": cur["capture_path"],
            "motion_observation": "real browser PNG pair captured; human visual interpretation pending",
            "geometry_motion": "unknown_pending_review",
            "illumination_motion": "unknown_pending_review",
            "camera_motion": "unknown_pending_review",
        })
    return {
        "motion_sheet_version": "1.0", "effect_id": effect_id, "route": route, "seed": seed,
        "viewport": viewport, "dpr": dpr, "spatial_sheet": spatial, "chronological_sheet": chronological,
        "generated_at": iso_now(), "capture_claim": "real_browser_capture_completed",
    }


def fsync_path(path: Path) -> None:
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{uuid.uuid4().hex}")
    try:
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        fsync_path(path.parent)
    finally:
        if tmp.exists():
            tmp.unlink()


def attested_page_time_ms(page: Any, requested_time_ms: float, *, tolerance_ms: float = 0.01) -> float:
    """Require the page's own exported state to attest the locked time, not the controller script alone."""
    attestation = page.evaluate("""
() => {
  const params = new URLSearchParams(window.location.search);
  const hero = window.__V4_HERO_LAB__ || null;
  const smoke = window.__V4_RUNTIME_SMOKE__ || null;
  const cathedral = window.__V4_CATHEDRAL_WEBGPU__ || null;
  const filament = window.__V4_FILAMENT_WEBGPU__ || null;
  const voxel = window.__V4_VOXEL_WEBGPU__ || null;
  const history = window.__V4_HISTORY_TRAILS__ || null;
  return {
    queryTime: params.has('time') ? Number(params.get('time')) : null,
    heroLockedTime: hero && Number.isFinite(Number(hero.lockedTime)) ? Number(hero.lockedTime) : null,
    smokeLockedTime: smoke && Number.isFinite(Number(smoke.lockedTime)) ? Number(smoke.lockedTime) : null,
    cathedralLockedTime: cathedral && Number.isFinite(Number(cathedral.lockedTime)) ? Number(cathedral.lockedTime) : null,
    cathedralTime: cathedral && Number.isFinite(Number(cathedral.time)) ? Number(cathedral.time) : null,
    cathedralObservedLock: cathedral ? Boolean(cathedral.lockedTime !== undefined || cathedral.locked === true || cathedral.lockedMode === true) : false,
    filamentLockedTime: filament && Number.isFinite(Number(filament.lockedTime)) ? Number(filament.lockedTime) : null,
    filamentTime: filament && Number.isFinite(Number(filament.time)) ? Number(filament.time) : null,
    voxelLockedTime: voxel && Number.isFinite(Number(voxel.lockedTime)) ? Number(voxel.lockedTime) : null,
    voxelTime: voxel && Number.isFinite(Number(voxel.time)) ? Number(voxel.time) : null,
    historyLockedTime: history && Number.isFinite(Number(history.lockedTime)) ? Number(history.lockedTime) : null,
    heroSeed: hero && Number.isFinite(Number(hero.seed)) ? Number(hero.seed) : null,
    heroMode: hero && hero.inputMode || null,
  };
}
""")
    require(isinstance(attestation, Mapping), "page lock attestation must be an object")
    requested_time_seconds = float(requested_time_ms) / 1000.0
    tolerance_seconds = float(tolerance_ms) / 1000.0
    query_time = attestation.get("queryTime")
    require(query_time is not None and abs(float(query_time) - requested_time_seconds) <= tolerance_seconds,
            "page URL does not carry requested locked time")
    candidates = [attestation.get("heroLockedTime"), attestation.get("smokeLockedTime"),
                  attestation.get("filamentLockedTime"), attestation.get("filamentTime"),
                  attestation.get("voxelLockedTime"), attestation.get("voxelTime"),
                  attestation.get("historyLockedTime")]
    for value in candidates:
        if value is not None and abs(float(value) - requested_time_seconds) <= tolerance_seconds:
            return float(value) * 1000.0
    if attestation.get("cathedralObservedLock"):
        for value in (attestation.get("cathedralLockedTime"), attestation.get("cathedralTime")):
            if value is not None and abs(float(value) - requested_time_seconds) <= tolerance_seconds:
                return float(value) * 1000.0
    raise EvidenceError("page did not attest the requested locked time via exported runtime state")


def cleanup_temp_run(temp_dir: Path) -> None:
    if temp_dir.exists():
        shutil.rmtree(temp_dir)


def publish_atomic_run(temp_dir: Path, final_dir: Path) -> None:
    require(not final_dir.exists(), f"final run directory already exists: {final_dir}")
    final_dir.parent.mkdir(parents=True, exist_ok=True)
    os.replace(temp_dir, final_dir)
    fsync_path(final_dir.parent)


def quarantine_or_remove_run(run_dir: Path) -> None:
    """Remove a post-publish-invalid run so it cannot be mistaken for complete evidence."""
    if not run_dir.exists():
        return
    quarantine = run_dir.parent / f".{run_dir.name}.quarantine-{uuid.uuid4().hex}"
    try:
        os.replace(run_dir, quarantine)
        shutil.rmtree(quarantine)
    except Exception:
        shutil.rmtree(run_dir, ignore_errors=True)


PathResolver = Callable[[Path], Path]


def identity_path_resolver(path: Path) -> Path:
    return path


def logical_final_to_physical_staging_resolver(final_dir: Path, temp_dir: Path) -> PathResolver:
    final_realish = final_dir.resolve()

    def resolve(logical_path: Path) -> Path:
        try:
            rel = logical_path.resolve().relative_to(final_realish)
        except ValueError:
            return logical_path
        return temp_dir / rel
    return resolve


def resolved_repo_path(root: Path, ref: str, field_name: str, resolver: PathResolver = identity_path_resolver) -> tuple[Path, Path]:
    rel = repo_relative_path(ref, field_name)
    logical_path = root / rel
    return logical_path, resolver(logical_path)


def resolve_route_for_browser(route: str, locked_url: str) -> tuple[str, Any, Any]:
    """Return browser URL plus optional local HTTP server/thread for repo-relative routes."""
    parsed = urlparse(locked_url)
    if parsed.scheme == "file":
        validate_local_route(locked_url)
        return locked_url, None, None
    if parsed.scheme:
        validate_local_route(locked_url)
        return locked_url, None, None
    rel = repo_relative_path(parsed.path, "route")
    target = ROOT / rel
    require(target.exists(), f"repo-relative route does not exist: {route}")
    require(not path_has_symlink_component(target), "repo-relative route must not include symlink components")
    realpath_under(target, ROOT.resolve(strict=True), "repo-relative route")

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *handler_args: Any, **handler_kwargs: Any) -> None:
            super().__init__(*handler_args, directory=str(ROOT), **handler_kwargs)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    browser_url = f"http://127.0.0.1:{server.server_address[1]}/{rel.as_posix()}?{parsed.query}"
    return browser_url, server, server_thread


def run_local_browser_capture(*, route: str, effect_id: str, seed: int, time_ms: float, mode: str, viewport: Mapping[str, int],
                              out_root: Path, run_id: Optional[str] = None, frame_indices: Sequence[int] = (0, 60),
                              timeout_ms: int = 30000, dpr: float = 1.0) -> Mapping[str, Any]:
    require(float(dpr) >= 1.0, "dpr must be >= 1")
    run_id = run_id or f"capture-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    plan = local_capture_plan(route=route, seed=seed, time_ms=time_ms, mode=mode, viewport=viewport,
                              frame_indices=frame_indices, out_root=out_root, run_id=run_id, timeout_ms=timeout_ms,
                              dpr=dpr)
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception as exc:
        return {**plan, "status": "unsupported", "unsupported_reason": f"python Playwright unavailable: {exc.__class__.__name__}", "artifacts_written": []}

    final_dir = safe_run_directory(out_root, run_id, allow_existing=False)
    temp_dir = final_dir.parent / f".{run_id}.tmp-{uuid.uuid4().hex}"
    require(not temp_dir.exists(), f"temporary run directory already exists: {temp_dir}")
    require(not path_has_symlink_component(temp_dir), "temporary run directory must not include symlink components")
    raw_dir = temp_dir / "raw"
    derived_dir = temp_dir / "derived"
    final_raw_dir = final_dir / "raw"
    final_derived_dir = final_dir / "derived"
    final_manifest_path = final_raw_dir / "run-manifest.raw.json"
    final_benchmark_path = final_derived_dir / "benchmark_report.json"
    final_motion_path = final_derived_dir / "motion_sheet.json"
    staging_resolver = logical_final_to_physical_staging_resolver(final_dir, temp_dir)
    raw_dir.mkdir(parents=True)
    derived_dir.mkdir(parents=True)
    started = time.time()
    server = None
    server_thread = None
    browser = None
    context = None
    page = None
    telemetry: Optional[Mapping[str, Any]] = None
    captures: List[Mapping[str, Any]] = []
    console_logs: List[Mapping[str, Any]] = []
    page_errors: List[Mapping[str, Any]] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False, args=list(PLAYWRIGHT_WEBGPU_ARGS))
            context = browser.new_context(viewport={"width": int(viewport["width"]), "height": int(viewport["height"])}, device_scale_factor=float(dpr))
            previous_sha = None
            previous_observed_time = None
            for position, frame_index in enumerate(frame_indices):
                requested_time_ms = float(time_ms) + (1000.0 / 60.0) * int(frame_index)
                locked_url = locked_capture_url(route, seed=seed, time_ms=requested_time_ms, mode=mode)
                parsed_locked = urlparse(locked_url)
                if server is not None and not parsed_locked.scheme:
                    browser_url = f"http://127.0.0.1:{server.server_address[1]}/{repo_relative_path(parsed_locked.path, 'route').as_posix()}?{parsed_locked.query}"
                else:
                    browser_url, maybe_server, maybe_thread = resolve_route_for_browser(route, locked_url)
                    if maybe_server is not None:
                        server, server_thread = maybe_server, maybe_thread
                page = context.new_page()
                page.on("console", lambda msg: console_logs.append({"type": msg.type, "text": msg.text}))
                page.on("pageerror", lambda err: page_errors.append({"type": "error", "text": str(err)}))
                page.add_init_script(browser_harness_script(seed, requested_time_ms, mode, 120))
                page.goto(browser_url, wait_until="networkidle", timeout=timeout_ms)
                observed_time_ms = attested_page_time_ms(page, requested_time_ms)
                telemetry = require_mapping(page.evaluate("window.__V4_CAPTURE_SAMPLE__ && window.__V4_CAPTURE_SAMPLE__()"),
                                            "browser harness telemetry")
                exported_state = require_mapping(telemetry.get("exportedState"), "browser harness exportedState")
                renderer_attestation = require_mapping(next((exported_state.get(key) for key in (
                    "v4CathedralWebGPU", "v4FilamentWebGPU", "v4VoxelWebGPU", "v4HistoryTrails"
                ) if isinstance(exported_state.get(key), Mapping)), None),
                    "capture route attested v4 renderer state")
                require(renderer_attestation.get("rendererMode") == "webgpu-full",
                        f"capture route did not run WebGPU full mode: {renderer_attestation.get('rendererMode')}")
                require(renderer_attestation.get("active") is True or renderer_attestation.get("webgpuActive") is True
                        or renderer_attestation.get("frameSubmitted") is True,
                        "capture route did not attest an active WebGPU frame")
                frame_attestation = renderer_attestation.get("frame")
                if isinstance(frame_attestation, Mapping):
                    require(frame_attestation.get("submitted") is True, "capture route frame was not submitted")
                require(not renderer_attestation.get("validationErrors") and not renderer_attestation.get("webgpuValidationErrors"),
                        "capture route reported WebGPU validation errors")
                observed_dpr = float(telemetry.get("dpr", 0))
                require(abs(observed_dpr - float(dpr)) <= 0.05, f"observed DPR {observed_dpr} does not match requested DPR {dpr}")
                require(previous_observed_time is None or observed_time_ms > previous_observed_time,
                        "observed page time did not advance chronologically")
                capture_path = raw_dir / f"frame-{int(frame_index):04d}.png"
                page.screenshot(path=str(capture_path), full_page=False)
                visual_metrics = require_nonblack_capture(capture_path)
                capture_sha = compute_file_sha256(capture_path)
                if previous_sha is not None:
                    require(capture_sha != previous_sha, "adjacent requested motion captures are byte-identical; refusing mislabeled chronology")
                previous_sha = capture_sha
                previous_observed_time = observed_time_ms
                captures.append({
                    "frame_index": int(frame_index),
                    "requested_time_ms": requested_time_ms,
                    "observed_time_ms": observed_time_ms,
                    "time_ms": observed_time_ms,
                    "role": "spatial" if position == 0 else "chronological",
                    "renderer_attestation": renderer_attestation,
                    "visual_metrics": visual_metrics,
                    "capture_path": raw_ref(final_raw_dir / capture_path.name), "capture_sha256": capture_sha,
                })
                page.close()
                page = None
            require(telemetry is not None, "no telemetry captured")
            frame_samples = telemetry["frameSamples"]
            summary = summarize_samples(frame_samples)
            all_console = console_logs + page_errors + list(telemetry.get("consoleLogs", []))
            raw_telemetry_path = raw_dir / "frame-telemetry.raw.json"
            final_raw_telemetry_path = final_raw_dir / raw_telemetry_path.name
            raw_payload = {"captured_at": iso_now(), "route": route, "seed": seed, "mode": mode,
                           "requested_dpr": float(dpr), "observed_dpr": float(telemetry["dpr"]),
                           "playwright_headless": False, "playwright_launch_args": list(PLAYWRIGHT_WEBGPU_ARGS),
                           "captures": captures, "telemetry": telemetry, "console_logs": all_console}
            atomic_write_json(raw_telemetry_path, raw_payload)
            motion = build_real_motion_sheet_from_captures(effect_id=effect_id, route=route, seed=seed,
                                                           viewport=telemetry["viewport"], dpr=float(telemetry["dpr"]),
                                                           captures=captures)
            motion_path = derived_dir / "motion_sheet.json"
            atomic_write_json(motion_path, motion)
            validate_motion_sheet(motion, require_real=True, evidence_root=temp_dir, path_resolver=staging_resolver)
            benchmark_path = derived_dir / "benchmark_report.json"
            manifest_path = raw_dir / "run-manifest.raw.json"
            benchmark = {
                "benchmark_schema_version": "1.0", "evidence_kind": "real_acceptance", "effect_id": effect_id,
                "seed": seed, "captured_at": iso_now(), "run_id": run_id, "route": route,
                "run_manifest_ref": raw_ref(final_manifest_path),
                "artifact_evidence": [raw_ref(final_raw_telemetry_path), raw_ref(final_motion_path)] + [c["capture_path"] for c in captures],
                "viewport": telemetry["viewport"], "backing_store": telemetry.get("backing"), "dpr": float(telemetry["dpr"]),
                "requested_dpr": float(dpr), "effective_density": {"x": float(telemetry["dpr"]), "y": float(telemetry["dpr"])},
                "frame_samples": [{"frame_index": int(s["frame_index"]), "frame_ms": float(s["frame_ms"]), "evidence_ref": raw_ref(final_raw_telemetry_path)} for s in frame_samples],
                "summary": summary,
                "gpu_timing": {"frame_ms": {"value": None, "unknown_reason": telemetry["gpuTiming"]["unknownReason"], "unit": "ms"}},
                "memory": {
                    "js_heap_used_mb": {"value": telemetry["memory"].get("jsHeapUsedMB"), "unknown_reason": "browser performance.memory unavailable" if telemetry["memory"].get("jsHeapUsedMB") is None else "", "unit": "MB"},
                    "gpu_memory_mb": {"value": telemetry["gpuMemory"].get("mb"), "unknown_reason": telemetry["gpuMemory"].get("unknownReason"), "unit": "MB"},
                },
                "browser": {"name": "Chromium via Playwright", "user_agent": telemetry["browser"].get("userAgent", "unknown"), "device": telemetry["browser"].get("platform", "automation browser") or "automation browser", "headless": False, "launch_args": list(PLAYWRIGHT_WEBGPU_ARGS)},
                "console_logs": all_console, "device_logs": [],
                "capture_limitations": ["automation-browser relative evidence only; not target-device acceptance"],
                "duration_ms": round((time.time() - started) * 1000, 3),
            }
            atomic_write_json(benchmark_path, benchmark)
            manifest = {"run_manifest_version": "1.0", "run_id": run_id, "route": route,
                        "created_at": iso_now(), "benchmark_report": raw_ref(final_benchmark_path),
                        "motion_sheet": raw_ref(final_motion_path), "artifact_sha256": {}}
            for base in (raw_dir, derived_dir):
                for path in sorted(base.rglob("*")):
                    if path.is_file():
                        logical_path = (final_raw_dir if base == raw_dir else final_derived_dir) / path.relative_to(base)
                        if logical_path == final_manifest_path:
                            continue
                        manifest["artifact_sha256"][raw_ref(logical_path)] = compute_file_sha256(path)
            atomic_write_json(manifest_path, manifest)
            validate_run_manifest(manifest, root=ROOT, evidence_root=temp_dir, validate_linked=True,
                                  manifest_ref=raw_ref(final_manifest_path), path_resolver=staging_resolver)
            validate_benchmark(benchmark, require_real=True, root=ROOT, validate_manifest_binding=True,
                               benchmark_ref=raw_ref(final_benchmark_path), evidence_root=temp_dir,
                               path_resolver=staging_resolver)
            if page is not None:
                page.close()
            if context is not None:
                context.close()
            if browser is not None:
                browser.close()
            publish_atomic_run(temp_dir, final_dir)
            final_manifest_ref = raw_ref(final_manifest_path)
            try:
                final_manifest = require_mapping(load_json(final_manifest_path), "run_manifest")
                final_benchmark = require_mapping(load_json(final_benchmark_path), "benchmark_report")
                validate_run_manifest(final_manifest, root=ROOT, evidence_root=final_dir, validate_linked=True,
                                      manifest_ref=final_manifest_ref)
                validate_benchmark(final_benchmark, require_real=True, root=ROOT, validate_manifest_binding=True,
                                   benchmark_ref=raw_ref(final_benchmark_path), evidence_root=final_dir)
            except Exception:
                quarantine_or_remove_run(final_dir)
                raise
            return {**plan, "status": "completed", "run_manifest": final_manifest_ref,
                    "benchmark_report": raw_ref(final_benchmark_path),
                    "motion_sheet": raw_ref(final_motion_path),
                    "artifacts_written": sorted(manifest["artifact_sha256"].keys())}
    except Exception:
        if page is not None:
            try: page.close()
            except Exception: pass
        if context is not None:
            try: context.close()
            except Exception: pass
        if browser is not None:
            try: browser.close()
            except Exception: pass
        cleanup_temp_run(temp_dir)
        raise
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
            if server_thread is not None:
                server_thread.join(timeout=2)


def validate_motion_sheet(sheet: Mapping[str, Any], *, root: Path = ROOT, require_real: bool = False,
                          evidence_root: Optional[Path] = None,
                          path_resolver: PathResolver = identity_path_resolver) -> None:
    require_nonempty_string(sheet.get("motion_sheet_version"), "motion_sheet_version")
    require_nonempty_string(sheet.get("effect_id"), "effect_id")
    validate_local_route(require_nonempty_string(sheet.get("route"), "route"))
    require(float(sheet.get("dpr", 0)) >= 1.0, "motion sheet dpr must be >= 1")
    spatial = sheet.get("spatial_sheet")
    chronological = sheet.get("chronological_sheet")
    require(isinstance(spatial, list) and len(spatial) >= 2, "spatial_sheet must contain at least two frames")
    require(isinstance(chronological, list) and len(chronological) == len(spatial) - 1,
            "chronological_sheet must connect every adjacent spatial frame")
    claim = sheet.get("capture_claim")
    require(claim in {"fixture_scaffold_only_no_browser_capture_performed", "real_browser_capture_completed"},
            "capture_claim must be explicit and honest")
    if require_real:
        require(claim == "real_browser_capture_completed",
                "acceptance motion sheet requires capture_claim == real_browser_capture_completed")
    spatial_by_index: Dict[int, Mapping[str, Any]] = {}
    seen_capture_hashes: Dict[str, int] = {}
    last_time = -math.inf
    for i, cell in enumerate(spatial):
        cell = require_mapping(cell, f"spatial_sheet[{i}]")
        idx = cell.get("frame_index")
        require(isinstance(idx, int), f"spatial_sheet[{i}].frame_index must be an integer")
        t = float(cell.get("time_ms"))
        require(t >= last_time, f"spatial_sheet[{i}].time_ms must be chronological")
        last_time = t
        require(idx not in spatial_by_index, f"duplicate spatial frame_index {idx}")
        spatial_by_index[idx] = cell
        if claim == "real_browser_capture_completed":
            require(cell.get("status") == "captured", f"spatial_sheet[{i}].status must be captured for real claims")
            requested_time = float(cell.get("requested_time_ms", t))
            observed_time = float(cell.get("observed_time_ms", t))
            require(abs(observed_time - t) < 0.0001, f"spatial_sheet[{i}].time_ms must equal observed_time_ms")
            require(abs(observed_time - requested_time) <= 0.01, f"spatial_sheet[{i}] observed time must match requested locked time")
            capture_ref = require_nonempty_string(cell.get("capture_path"), f"spatial_sheet[{i}].capture_path")
            logical_path, path = resolved_repo_path(root, capture_ref, f"spatial_sheet[{i}].capture_path", path_resolver)
            require(path.exists() and path.is_file(), f"spatial_sheet[{i}].capture_path must exist")
            require(not path_has_symlink_component(logical_path), f"spatial_sheet[{i}].capture_path logical path must not use symlinks")
            require(not path_has_symlink_component(path), f"spatial_sheet[{i}].capture_path must not use symlinks")
            realpath_under(path, evidence_root or root, f"spatial_sheet[{i}].capture_path")
            validate_sha256(cell.get("capture_sha256"), f"spatial_sheet[{i}].capture_sha256")
            actual_hash = compute_file_sha256(path)
            require(actual_hash == cell.get("capture_sha256"), f"spatial_sheet[{i}].capture_sha256 mismatch")
            if actual_hash in seen_capture_hashes and observed_time > float(spatial_by_index[seen_capture_hashes[actual_hash]]["time_ms"]):
                require(sheet.get("static_scene_contract") is True,
                        f"duplicate PNG bytes reused for distinct chronological frame {idx}")
            seen_capture_hashes[actual_hash] = idx
        else:
            require(cell.get("capture_path") is None and cell.get("status") == "pending_real_capture",
                    f"spatial_sheet[{i}] fixture scaffold must keep capture_path null and pending")
    for i, edge in enumerate(chronological):
        edge = require_mapping(edge, f"chronological_sheet[{i}]")
        fr = edge.get("from_frame")
        to = edge.get("to_frame")
        require(fr in spatial_by_index and to in spatial_by_index, f"chronological_sheet[{i}] references unknown frame")
        require(spatial.index(spatial_by_index[to]) == spatial.index(spatial_by_index[fr]) + 1,
                f"chronological_sheet[{i}] must pair adjacent spatial frames")
        expected_delta = float(spatial_by_index[to]["time_ms"]) - float(spatial_by_index[fr]["time_ms"])
        require(abs(float(edge.get("delta_ms")) - expected_delta) < 0.0001, f"chronological_sheet[{i}].delta_ms inconsistent")
        if claim == "real_browser_capture_completed":
            require_nonempty_string(edge.get("motion_observation"), f"chronological_sheet[{i}].motion_observation")
            expected_from_path = spatial_by_index[fr].get("capture_path")
            expected_to_path = spatial_by_index[to].get("capture_path")
            require(edge.get("from_capture_path") == expected_from_path,
                    f"chronological_sheet[{i}].from_capture_path must pair adjacent immutable capture")
            require(edge.get("to_capture_path") == expected_to_path,
                    f"chronological_sheet[{i}].to_capture_path must pair adjacent immutable capture")
            for key in ("geometry_motion", "illumination_motion", "camera_motion"):
                require(edge.get(key) is not None, f"chronological_sheet[{i}].{key} required for real capture claims")
        else:
            require(edge.get("motion_observation") == "pending_human_review", f"chronological_sheet[{i}] must be pending in scaffold")


def check_no_bad_telemetry_labels(value: Any, path: str = "telemetry") -> None:
    if isinstance(value, str):
        lowered = value.lower()
        for label in DISALLOWED_TELEMETRY_LABELS:
            require(label not in lowered, f"ambiguous/fake telemetry label {label!r} at {path}")
    elif isinstance(value, Mapping):
        for key, child in value.items():
            check_no_bad_telemetry_labels(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            check_no_bad_telemetry_labels(child, f"{path}[{index}]")


def validate_nullable_measurement(obj: Any, name: str) -> None:
    obj = require_mapping(obj, name)
    value = obj.get("value")
    if value is None:
        require_nonempty_string(obj.get("unknown_reason"), f"{name}.unknown_reason")
    else:
        require(isinstance(value, (int, float)) and math.isfinite(float(value)), f"{name}.value must be numeric or null")
        require(obj.get("unknown_reason") in {None, ""}, f"{name}.unknown_reason must be empty when value is known")
    require_nonempty_string(obj.get("unit"), f"{name}.unit")


def percentile(sorted_values: Sequence[float], pct: float) -> float:
    if not sorted_values:
        raise EvidenceError("cannot compute percentile for empty values")
    k = (len(sorted_values) - 1) * pct
    floor = math.floor(k)
    ceil = math.ceil(k)
    if floor == ceil:
        return sorted_values[int(k)]
    return sorted_values[floor] * (ceil - k) + sorted_values[ceil] * (k - floor)


def validate_run_manifest(manifest: Mapping[str, Any], *, root: Path = ROOT, evidence_root: Path = DEFAULT_CAPTURE_ROOT,
                          validate_linked: bool = True, manifest_ref: Optional[str] = None,
                          path_resolver: PathResolver = identity_path_resolver) -> None:
    require_nonempty_string(manifest.get("run_manifest_version"), "run_manifest_version")
    require_nonempty_string(manifest.get("run_id"), "run_id")
    validate_local_route(require_nonempty_string(manifest.get("route"), "route"))
    require_iso8601(manifest.get("created_at"), "created_at")
    artifact_sha256 = require_mapping(manifest.get("artifact_sha256"), "artifact_sha256")
    require(artifact_sha256, "artifact_sha256 must be non-empty")
    if manifest_ref is not None:
        repo_relative_path(manifest_ref, "manifest_ref")
        require(str(manifest.get("benchmark_report")) != manifest_ref, "manifest benchmark_report must not reference the run manifest itself")
        require(str(manifest.get("motion_sheet")) != manifest_ref, "manifest motion_sheet must not reference the run manifest itself")
    evidence_real = evidence_root.resolve(strict=True)
    for ref, expected_sha in artifact_sha256.items():
        ref_text = str(ref)
        if manifest_ref is not None:
            require(ref_text != manifest_ref, "run manifest must not include its own sha256 in artifact_sha256")
        require(Path(ref_text).name != "run-manifest.raw.json", "run manifest self-reference is forbidden in artifact_sha256")
        logical_path, path = resolved_repo_path(root, ref_text, "artifact_sha256 ref", path_resolver)
        require(path.exists() and path.is_file(), f"manifest artifact does not exist: {ref}")
        require(not path_has_symlink_component(logical_path), f"manifest artifact logical path must not use symlinks: {ref}")
        require(not path_has_symlink_component(path), f"manifest artifact must not use symlinks: {ref}")
        realpath_under(path, evidence_real, f"manifest artifact {ref}")
        validate_sha256(expected_sha, f"artifact_sha256[{ref}]")
        require(compute_file_sha256(path) == expected_sha, f"manifest artifact sha mismatch: {ref}")
    benchmark_ref = require_nonempty_string(manifest.get("benchmark_report"), "benchmark_report")
    motion_ref = require_nonempty_string(manifest.get("motion_sheet"), "motion_sheet")
    for label, ref in (("benchmark_report", benchmark_ref), ("motion_sheet", motion_ref)):
        require(ref in artifact_sha256, f"{label} must be bound in artifact_sha256")
    if validate_linked:
        benchmark_logical, benchmark_path = resolved_repo_path(root, benchmark_ref, "benchmark_report", path_resolver)
        motion_logical, motion_path = resolved_repo_path(root, motion_ref, "motion_sheet", path_resolver)
        require(not path_has_symlink_component(benchmark_logical), "benchmark_report logical path must not use symlinks")
        require(not path_has_symlink_component(motion_logical), "motion_sheet logical path must not use symlinks")
        benchmark = require_mapping(load_json(benchmark_path), "benchmark_report")
        if manifest_ref is not None:
            require(benchmark.get("run_manifest_ref") == manifest_ref, "benchmark run_manifest_ref must match this run manifest path")
        else:
            require_nonempty_string(benchmark.get("run_manifest_ref"), "benchmark.run_manifest_ref")
        require(benchmark.get("run_id") == manifest.get("run_id"), "benchmark run_id must match run manifest")
        require(benchmark.get("route") == manifest.get("route"), "benchmark route must match run manifest")
        validate_benchmark(benchmark, require_real=True, root=root, validate_manifest_binding=False,
                           benchmark_ref=benchmark_ref, evidence_root=evidence_root, path_resolver=path_resolver)
        validate_motion_sheet(require_mapping(load_json(motion_path), "motion_sheet"), root=root, require_real=True,
                              evidence_root=evidence_root, path_resolver=path_resolver)
        for ref in benchmark.get("artifact_evidence", []):
            require(str(ref) in artifact_sha256, f"benchmark artifact_evidence not bound in run manifest: {ref}")


def validate_benchmark(report: Mapping[str, Any], *, require_real: bool = False, root: Path = ROOT,
                       validate_manifest_binding: bool = True, benchmark_ref: Optional[str] = None,
                       evidence_root: Optional[Path] = None,
                       path_resolver: PathResolver = identity_path_resolver) -> None:
    evidence_kind = require_nonempty_string(report.get("evidence_kind"), "evidence_kind")
    require(evidence_kind in {"fixture_scaffold", "real_acceptance"}, "evidence_kind must distinguish fixture_scaffold from real_acceptance")
    if evidence_kind == "real_acceptance":
        check_no_bad_telemetry_labels(report)
    elif require_real:
        raise EvidenceError("fixture/scaffold benchmark cannot satisfy acceptance gate")
    require_nonempty_string(report.get("benchmark_schema_version"), "benchmark_schema_version")
    require_nonempty_string(report.get("effect_id"), "effect_id")
    require(isinstance(report.get("seed"), int), "seed must be an integer")
    require_iso8601(report.get("captured_at"), "captured_at")
    require_nonempty_string(report.get("run_id"), "run_id")
    validate_local_route(require_nonempty_string(report.get("route"), "route"))
    artifact_evidence = report.get("artifact_evidence")
    require(isinstance(artifact_evidence, list) and artifact_evidence, "artifact_evidence must bind samples/artifacts")
    for i, item in enumerate(artifact_evidence):
        require_nonempty_string(item, f"artifact_evidence[{i}]")
    if evidence_kind == "real_acceptance":
        manifest_ref = report.get("run_manifest_ref")
        if validate_manifest_binding:
            manifest_ref = require_nonempty_string(manifest_ref, "run_manifest_ref")
            logical_manifest_path, manifest_path = resolved_repo_path(root, manifest_ref, "run_manifest_ref", path_resolver)
            require(manifest_path.exists() and manifest_path.is_file(), "run_manifest_ref must exist")
            require(not path_has_symlink_component(logical_manifest_path), "run_manifest_ref logical path must not use symlinks")
            require(not path_has_symlink_component(manifest_path), "run_manifest_ref must not use symlinks")
            manifest_root = evidence_root or manifest_path.parents[1]
            manifest = require_mapping(load_json(manifest_path), "run_manifest")
            validate_run_manifest(manifest, root=root, evidence_root=manifest_root, validate_linked=True,
                                  manifest_ref=manifest_ref, path_resolver=path_resolver)
            if benchmark_ref is not None:
                require(manifest.get("benchmark_report") == benchmark_ref,
                        "run manifest benchmark_report must reference this benchmark")
            require(manifest.get("run_id") == report.get("run_id"), "run_manifest run_id must match benchmark")
            require(manifest.get("route") == report.get("route"), "run_manifest route must match benchmark")
    viewport = require_mapping(report.get("viewport"), "viewport")
    require(int(viewport.get("width", 0)) > 0 and int(viewport.get("height", 0)) > 0, "viewport width/height must be positive")
    require(float(report.get("dpr", 0)) >= 1.0, "DPR must be >= 1")
    density = require_mapping(report.get("effective_density"), "effective_density")
    require(float(density.get("x", 0)) >= 1.0 and float(density.get("y", 0)) >= 1.0,
            "effective density must be >= 1 in both axes")
    samples = report.get("frame_samples")
    require(isinstance(samples, list) and len(samples) >= 120, "frame_samples must contain at least 120 actual samples")
    frame_ms = []
    last_index = -1
    for i, sample in enumerate(samples):
        sample = require_mapping(sample, f"frame_samples[{i}]")
        idx = int(sample.get("frame_index"))
        require(idx > last_index, "frame_samples.frame_index must be strictly increasing")
        last_index = idx
        ms = float(sample.get("frame_ms"))
        require(ms > 0 and math.isfinite(ms), f"frame_samples[{i}].frame_ms must be positive finite")
        frame_ms.append(ms)
        if evidence_kind == "real_acceptance":
            require_nonempty_string(sample.get("evidence_ref"), f"frame_samples[{i}].evidence_ref")
    summary = require_mapping(report.get("summary"), "summary")
    sorted_ms = sorted(frame_ms)
    computed_p50 = percentile(sorted_ms, 0.50)
    computed_p95 = percentile(sorted_ms, 0.95)
    require(abs(float(summary.get("p50_frame_ms")) - computed_p50) < 0.0001, "summary.p50_frame_ms does not match samples")
    require(abs(float(summary.get("p95_frame_ms")) - computed_p95) < 0.0001, "summary.p95_frame_ms does not match samples")
    gpu = require_mapping(report.get("gpu_timing"), "gpu_timing")
    validate_nullable_measurement(gpu.get("frame_ms"), "gpu_timing.frame_ms")
    memory = require_mapping(report.get("memory"), "memory")
    for key in ("js_heap_used_mb", "gpu_memory_mb"):
        validate_nullable_measurement(memory.get(key), f"memory.{key}")
    browser = require_mapping(report.get("browser"), "browser")
    require_nonempty_string(browser.get("name"), "browser.name")
    require_nonempty_string(browser.get("user_agent"), "browser.user_agent")
    require_nonempty_string(browser.get("device"), "browser.device")
    require(isinstance(report.get("console_logs"), list), "console_logs must be an array")
    require(isinstance(report.get("device_logs"), list), "device_logs must be an array")
    if evidence_kind == "real_acceptance":
        for group_name in ("console_logs", "device_logs"):
            for i, entry in enumerate(report.get(group_name, [])):
                entry = require_mapping(entry, f"{group_name}[{i}]")
                entry_type = str(entry.get("type", entry.get("level", ""))).lower()
                text = str(entry.get("text", entry.get("message", ""))).lower()
                require(entry_type not in CONSOLE_ERROR_TYPES and "shader error" not in text and "shader compile" not in text,
                        f"{group_name}[{i}] records a console/shader error")


def validate_target_matrix(matrix: Mapping[str, Any], *, evidence_root: Path = DEFAULT_FIXTURES, require_real: bool = False) -> None:
    require_nonempty_string(matrix.get("matrix_version"), "matrix_version")
    devices = matrix.get("devices")
    require(isinstance(devices, list) and devices, "devices must be a non-empty array")
    for i, device in enumerate(devices):
        device = require_mapping(device, f"devices[{i}]")
        require_nonempty_string(device.get("id"), f"devices[{i}].id")
        require(float(device.get("minimum_dpr", 0)) >= 1.0, f"devices[{i}].minimum_dpr must be >= 1")
        require(int(device.get("minimum_frame_samples", 0)) >= 120,
                f"devices[{i}].minimum_frame_samples must be >= 120")
        ref = require_nonempty_string(device.get("benchmark_evidence_ref"), f"devices[{i}].benchmark_evidence_ref")
        rel = repo_relative_path(ref, f"devices[{i}].benchmark_evidence_ref")
        target = ROOT / rel
        require(target.exists() and target.is_file(), f"devices[{i}].benchmark_evidence_ref does not exist: {ref}")
        require(not path_has_symlink_component(target), f"devices[{i}].benchmark_evidence_ref must not use symlinks")
        realpath_under(target, evidence_root, f"devices[{i}].benchmark_evidence_ref")
        validate_benchmark(load_json(target), require_real=require_real, benchmark_ref=ref, evidence_root=evidence_root)


def validator_for_payload(data: Mapping[str, Any], *, require_real_benchmark: bool = False,
                          require_real_motion: bool = False) -> tuple[str, Callable[[Mapping[str, Any]], None]]:
    """Select an evidence validator from its schema discriminator, never its filename."""
    candidates: List[tuple[str, Callable[[Mapping[str, Any]], None]]] = []
    discriminators: List[tuple[str, str, Callable[[Mapping[str, Any]], None]]] = [
        ("provenance", "manifest_version", validate_provenance),
        ("scene", "recipe_version", validate_scene_recipe),
        ("capture_spec", "capture_spec_version", validate_capture_spec),
        ("motion", "motion_sheet_version", lambda payload: validate_motion_sheet(payload, require_real=require_real_motion)),
        ("benchmark", "benchmark_schema_version", lambda payload: validate_benchmark(payload, require_real=require_real_benchmark)),
        ("run_manifest", "run_manifest_version", lambda payload: validate_run_manifest(payload, evidence_root=DEFAULT_CAPTURE_ROOT, validate_linked=True)),
        ("candidate_factory", "factory_schema_version", validate_candidate_factory),
        ("release", "release_manifest_version", validate_release_manifest),
    ]
    for kind, field, validator in discriminators:
        if field in data:
            candidates.append((kind, validator))
    require(len(candidates) == 1,
            f"evidence payload must have exactly one recognized schema discriminator; found {[kind for kind, _ in candidates]}")
    return candidates[0]


def validate_evidence_ref(ref: str, *, evidence_root: Path, seen: Optional[Set[Path]] = None,
                          require_real_benchmark: bool = False, require_real_motion: bool = False) -> str:
    rel = repo_relative_path(ref, "evidence ref")
    path = ROOT / rel
    require(path.exists() and path.is_file(), f"evidence ref does not exist: {ref}")
    require(not path_has_symlink_component(path), "evidence ref must not use symlinks")
    realpath_under(path, evidence_root, "evidence ref")
    seen = seen or set()
    real = path.resolve(strict=True)
    data = require_mapping(load_json(real), "evidence payload")
    kind, validator = validator_for_payload(data, require_real_benchmark=require_real_benchmark,
                                            require_real_motion=require_real_motion)
    if real not in seen:
        seen.add(real)
        if kind == "benchmark":
            validate_benchmark(data, require_real=require_real_benchmark, benchmark_ref=ref, evidence_root=evidence_root)
        elif kind == "motion":
            validate_motion_sheet(data, require_real=require_real_motion, evidence_root=evidence_root)
        elif kind == "run_manifest":
            validate_run_manifest(data, evidence_root=evidence_root, validate_linked=True, manifest_ref=ref)
        else:
            validator(data)
    return kind


def validate_gates(gate_manifest: Mapping[str, Any], *, evidence_root: Path = DEFAULT_FIXTURES, mode: str = "scaffold") -> None:
    require(mode in {"scaffold", "acceptance"}, "gate validation mode must be scaffold or acceptance")
    require_nonempty_string(gate_manifest.get("gate_manifest_version"), "gate_manifest_version")
    require(gate_manifest.get("autonomous_self_merge") is False, "autonomous_self_merge must be false")
    require(gate_manifest.get("production_merge_action") in {None, "none"}, "gate manifest must not include a production merge action")
    gates = require_mapping(gate_manifest.get("gates"), "gates")
    acceptance_passes = []
    for gate_name in ("gate_1", "gate_2", "gate_3"):
        gate = require_mapping(gates.get(gate_name), gate_name)
        declared_passed = gate.get("passed")
        evidence = gate.get("evidence")
        require(isinstance(evidence, list) and evidence, f"{gate_name}.evidence must be non-empty")
        validated_kinds = [validate_evidence_ref(str(ref), evidence_root=evidence_root,
                                                 require_real_benchmark=(mode == "acceptance" and gate_name in {"gate_2", "gate_3"}),
                                                 require_real_motion=(mode == "acceptance" and gate_name in {"gate_2", "gate_3"}))
                           for ref in evidence]
        has_provenance = "provenance" in validated_kinds
        has_scene = "scene" in validated_kinds
        has_benchmark = "benchmark" in validated_kinds
        has_motion = "motion" in validated_kinds
        has_run_manifest = "run_manifest" in validated_kinds
        computed = has_provenance and has_scene and (gate_name == "gate_1" or (has_benchmark and has_motion and has_run_manifest))
        if mode == "scaffold" and gate_name in {"gate_2", "gate_3"}:
            # Fixture/scaffold artifacts may validate structurally, but never become
            # Gate 2/3 acceptance passes without real benchmark/capture evidence.
            computed = False
        if gate_name == "gate_3":
            computed = computed and "target_device_matrix" in gate_manifest
        validate_human_decision(gate.get("human_decision"), require_approved=(mode == "acceptance"),
                                context=gate_name, forbid_absence_notes=(mode == "acceptance"))
        require(declared_passed is computed, f"{gate_name}.passed must equal recomputed result {computed}")
        if mode == "acceptance":
            require(computed is True, f"{gate_name} acceptance requirements are not satisfied")
        acceptance_passes.append(computed)
    validate_target_matrix(gate_manifest.get("target_device_matrix"), evidence_root=evidence_root, require_real=(mode == "acceptance"))
    if mode == "scaffold":
        require(not all(acceptance_passes), "fixture scaffold must not report acceptance pass for all gates")


def validate_candidate_factory(factory: Mapping[str, Any]) -> None:
    require_nonempty_string(factory.get("factory_schema_version"), "factory_schema_version")
    require_nonempty_string(factory.get("candidate_id"), "candidate_id")
    state = require_nonempty_string(factory.get("state"), "state")
    require(state in FACTORY_STATES, f"unsupported candidate factory state {state}")
    require(factory.get("production_merge_action") in {None, "none"}, "candidate factory must not include production merge action")
    transitions = factory.get("transitions")
    require(isinstance(transitions, list) and transitions, "transitions must be non-empty")
    current = None
    terminal_count = 0
    for i, transition in enumerate(transitions):
        transition = require_mapping(transition, f"transitions[{i}]")
        from_state = transition.get("from")
        require(from_state == current, f"transitions[{i}].from must continue from previous state {current!r}")
        to_state = require_nonempty_string(transition.get("to"), f"transitions[{i}].to")
        require(to_state in FACTORY_STATES, f"transitions[{i}].to unsupported")
        require(to_state != "production_merge" and from_state != "production_merge", "production_merge is forbidden")
        require(to_state in ALLOWED_TRANSITIONS.get(from_state, set()), f"invalid transition {from_state} -> {to_state}")
        require_nonempty_string(transition.get("actor"), f"transitions[{i}].actor")
        require_iso8601(transition.get("at"), f"transitions[{i}].at")
        current = to_state
        if to_state in TERMINAL_STATES:
            terminal_count += 1
            require(i == len(transitions) - 1, "terminal transition must be last")
    require(current == state, "factory.state must match last transition.to")
    if state in TERMINAL_STATES:
        require(terminal_count == 1, "terminal factory state requires exactly one explicit terminal transition")
        validate_human_decision(factory.get("human_decision"), require_approved=(state == "approved_for_release"),
                                context="candidate_factory", forbid_absence_notes=(state == "approved_for_release"))
    else:
        require(terminal_count == 0, "non-terminal factory state must not include terminal transition")


def advance_candidate_factory(factory: Mapping[str, Any], next_state: str, actor: str) -> Mapping[str, Any]:
    validate_candidate_factory(factory)
    require(next_state in FACTORY_STATES, f"unsupported next state {next_state}")
    require(next_state != "approved_for_release", "tooling cannot autonomously enter approved_for_release; record human approval manually")
    require(factory["state"] not in TERMINAL_STATES, "terminal candidate factory states cannot advance")
    require(next_state in ALLOWED_TRANSITIONS.get(factory["state"], set()), f"invalid transition {factory['state']} -> {next_state}")
    updated = json.loads(json.dumps(factory))
    updated["state"] = next_state
    updated["transitions"].append({
        "from": factory["state"], "to": next_state, "actor": actor,
        "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "notes": "automated state advance; no production merge action performed",
    })
    return updated


def validate_https_url(url: str, field_name: str) -> None:
    parsed = urlparse(url)
    require(parsed.scheme == "https" and bool(parsed.netloc), f"{field_name} must be an HTTPS URL")


def validate_read_only_command(command: str, context: str) -> None:
    require(command and not any(ch in SHELL_METACHARS for ch in command), f"{context}.command contains forbidden shell metacharacters")
    try:
        parts = shlex.split(command)
    except ValueError as exc:
        raise EvidenceError(f"{context}.command is not parseable: {exc}") from exc
    require(parts and parts[0] == "curl", f"{context}.command must use curl read-only allowlist")
    method = "GET"
    urls = []
    i = 1
    while i < len(parts):
        token = parts[i]
        if token in {"-I", "--head"}:
            method = "HEAD"
        elif token in {"-X", "--request"}:
            i += 1
            require(i < len(parts), f"{context}.command missing request method")
            method = parts[i].upper()
        elif token.startswith("-X") and len(token) > 2:
            method = token[2:].upper()
        elif token.startswith("http://") or token.startswith("https://"):
            urls.append(token)
        elif token.startswith("-"):
            allowed = {"--fail", "--silent", "--show-error", "--location", "-f", "-s", "-S", "-L"}
            require(token in allowed, f"{context}.command option {token!r} is not in read-only allowlist")
        else:
            require(False, f"{context}.command contains unsupported token {token!r}")
        i += 1
    require(method in {"GET", "HEAD"}, f"{context}.command method {method} is not read-only")
    require(urls, f"{context}.command must contain an HTTPS URL")
    for url in urls:
        validate_https_url(url, f"{context}.command url")


def validate_release_manifest(release: Mapping[str, Any], *, mode: str = "acceptance",
                              evidence_root: Path = DEFAULT_FIXTURES) -> None:
    require(mode in {"scaffold", "acceptance"}, "release validation mode must be scaffold or acceptance")
    require_nonempty_string(release.get("release_manifest_version"), "release_manifest_version")
    require_nonempty_string(release.get("release_id"), "release_id")
    channels = release.get("channels")
    require(isinstance(channels, list) and channels, "channels must be non-empty")
    for i, channel in enumerate(channels):
        channel = require_mapping(channel, f"channels[{i}]")
        require_nonempty_string(channel.get("name"), f"channels[{i}].name")
        require(channel.get("deployment_action") in {"none", "read_only_verify_only"}, f"channels[{i}] must not request deployment")
        validate_https_url(require_nonempty_string(channel.get("url"), f"channels[{i}].url"), f"channels[{i}].url")
    rollback = require_mapping(release.get("rollback"), "rollback")
    require_nonempty_string(rollback.get("previous_release_id"), "rollback.previous_release_id")
    require_nonempty_string(rollback.get("operator_instructions"), "rollback.operator_instructions")
    checklist = release.get("https_verification_checklist")
    require(isinstance(checklist, list) and checklist, "https_verification_checklist must be non-empty")
    for i, item in enumerate(checklist):
        item = require_mapping(item, f"https_verification_checklist[{i}]")
        require(item.get("read_only") is True, f"https_verification_checklist[{i}].read_only must be true")
        validate_read_only_command(require_nonempty_string(item.get("command"), f"https_verification_checklist[{i}].command"),
                                   f"https_verification_checklist[{i}]")
    validate_human_decision(release.get("human_decision"), require_approved=(mode == "acceptance"),
                            context="release", forbid_absence_notes=(mode == "acceptance"))
    if mode == "acceptance":
        gate_ref = require_nonempty_string(release.get("acceptance_gate_ref"), "acceptance_gate_ref")
        rel = repo_relative_path(gate_ref, "acceptance_gate_ref")
        gate_path = ROOT / rel
        require(gate_path.exists() and gate_path.is_file(), f"acceptance_gate_ref does not exist: {gate_ref}")
        require(not path_has_symlink_component(gate_path), "acceptance_gate_ref must not use symlinks")
        realpath_under(gate_path, evidence_root, "acceptance_gate_ref")
        validate_gates(load_json(gate_path), evidence_root=evidence_root, mode="acceptance")


def read_only_https_check(release: Mapping[str, Any]) -> List[str]:
    validate_release_manifest(release, mode="scaffold")
    return [item["command"] for item in release["https_verification_checklist"]]


def validate_file(path: Path, validator: Callable[[Mapping[str, Any]], None]) -> ValidationResult:
    try:
        payload = load_json(path)
        validator(payload)
        return ValidationResult(str(path), True, "ok")
    except Exception as exc:
        return ValidationResult(str(path), False, str(exc))


def verify_all(fixtures_dir: Path, *, mode: str = "scaffold") -> List[ValidationResult]:
    checks: List[tuple[str, Callable[[Mapping[str, Any]], None]]] = [
        ("provenance.manifest.json", validate_provenance),
        ("scene_recipe.json", validate_scene_recipe),
        ("capture_spec.local.json", validate_capture_spec),
        ("motion_sheet.fixture.json", validate_motion_sheet),
        ("benchmark_report.json", validate_benchmark),
        ("gate_manifest.json", lambda data: validate_gates(data, evidence_root=fixtures_dir, mode=mode)),
        ("candidate_factory_state.json", validate_candidate_factory),
        ("release_manifest.json", lambda data: validate_release_manifest(data, mode=mode, evidence_root=fixtures_dir)),
    ]
    return [validate_file(fixtures_dir / name, validator) for name, validator in checks]


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in [
        "validate-provenance", "validate-scene-recipe", "validate-capture-spec", "validate-motion-sheet",
        "validate-benchmark", "validate-gates", "validate-candidate-factory", "validate-release",
    ]:
        p = sub.add_parser(name)
        p.add_argument("path", type=Path)
    sub.add_parser("validate-gates-acceptance").add_argument("path", type=Path)
    p = sub.add_parser("generate-capture-commands")
    p.add_argument("--capture-spec", type=Path, required=True)
    p = sub.add_parser("generate-motion-sheet")
    p.add_argument("--capture-spec", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p = sub.add_parser("capture-plan")
    p.add_argument("--route", required=True)
    p.add_argument("--effect-id", default="v4-local-route")
    p.add_argument("--seed", type=int, required=True)
    p.add_argument("--time-ms", type=float, default=0.0)
    p.add_argument("--mode", default="demo")
    p.add_argument("--viewport", default="1280x720")
    p.add_argument("--dpr", type=float, default=1.0)
    p.add_argument("--frames", default="0,60")
    p.add_argument("--out-root", type=Path, default=DEFAULT_CAPTURE_ROOT)
    p.add_argument("--run-id", default="dry-run")
    p.add_argument("--timeout-ms", type=int, default=30000)
    p = sub.add_parser("capture-local")
    p.add_argument("--route", required=True)
    p.add_argument("--effect-id", default="v4-local-route")
    p.add_argument("--seed", type=int, required=True)
    p.add_argument("--time-ms", type=float, default=0.0)
    p.add_argument("--mode", default="demo")
    p.add_argument("--viewport", default="1280x720")
    p.add_argument("--dpr", type=float, default=1.0)
    p.add_argument("--frames", default="0,60")
    p.add_argument("--out-root", type=Path, default=DEFAULT_CAPTURE_ROOT)
    p.add_argument("--run-id")
    p.add_argument("--timeout-ms", type=int, default=30000)
    p = sub.add_parser("candidate-step")
    p.add_argument("--state", type=Path, required=True)
    p.add_argument("--next-state", required=True)
    p.add_argument("--actor", required=True)
    p.add_argument("--out", type=Path, required=True)
    sub.add_parser("release-check-commands").add_argument("path", type=Path)
    p = sub.add_parser("verify-all")
    p.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    p.add_argument("--mode", choices=["scaffold", "acceptance"], default="scaffold")
    args = parser.parse_args(argv)
    validators: Dict[str, Callable[[Mapping[str, Any]], None]] = {
        "validate-provenance": validate_provenance,
        "validate-scene-recipe": validate_scene_recipe,
        "validate-capture-spec": validate_capture_spec,
        "validate-motion-sheet": validate_motion_sheet,
        "validate-benchmark": validate_benchmark,
        "validate-gates": lambda data: validate_gates(data, mode="scaffold"),
        "validate-gates-acceptance": lambda data: validate_gates(data, mode="acceptance"),
        "validate-candidate-factory": validate_candidate_factory,
        "validate-release": lambda data: validate_release_manifest(data, mode="acceptance"),
    }
    try:
        if args.command in validators:
            validators[args.command](load_json(args.path))
            print(f"{args.command}: ok {args.path}")
        elif args.command == "generate-capture-commands":
            spec = load_json(args.capture_spec)
            spec["_source_path"] = str(args.capture_spec)
            print("\n".join(capture_commands(spec)))
        elif args.command == "generate-motion-sheet":
            write_json(args.out, generate_motion_sheet(load_json(args.capture_spec)))
            print(f"generated motion sheet scaffold: {args.out}")
        elif args.command == "capture-plan":
            width, height = [int(part) for part in args.viewport.lower().split("x", 1)]
            plan = local_capture_plan(route=args.route, seed=args.seed, time_ms=args.time_ms, mode=args.mode,
                                      viewport={"width": width, "height": height},
                                      frame_indices=parse_frame_indices(args.frames), out_root=args.out_root,
                                      run_id=args.run_id, timeout_ms=args.timeout_ms, dpr=args.dpr)
            print(json.dumps(plan, indent=2, sort_keys=True))
        elif args.command == "capture-local":
            width, height = [int(part) for part in args.viewport.lower().split("x", 1)]
            result = run_local_browser_capture(route=args.route, effect_id=args.effect_id, seed=args.seed,
                                               time_ms=args.time_ms, mode=args.mode,
                                               viewport={"width": width, "height": height},
                                               out_root=args.out_root, run_id=args.run_id,
                                               frame_indices=parse_frame_indices(args.frames),
                                               timeout_ms=args.timeout_ms, dpr=args.dpr)
            print(json.dumps(result, indent=2, sort_keys=True))
            if result.get("status") == "unsupported":
                return 2
        elif args.command == "candidate-step":
            write_json(args.out, advance_candidate_factory(load_json(args.state), args.next_state, args.actor))
            print(f"advanced candidate factory state to {args.next_state}: {args.out}")
        elif args.command == "release-check-commands":
            print("\n".join(read_only_https_check(load_json(args.path))))
        elif args.command == "verify-all":
            results = verify_all(args.fixtures, mode=args.mode)
            for result in results:
                status = "ok" if result.ok else "FAIL"
                message = result.message
                if args.mode == "scaffold" and result.ok and Path(result.path).name in {"gate_manifest.json", "release_manifest.json"}:
                    status = "scaffold-valid"
                    message = "not release-approved"
                print(f"{Path(result.path).name}: {status} {message}")
            if not all(result.ok for result in results):
                return 1
        return 0
    except EvidenceError as exc:
        print(f"{args.command}: FAILED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
