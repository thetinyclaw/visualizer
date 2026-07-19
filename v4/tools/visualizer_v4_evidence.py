#!/usr/bin/env python3
"""Visualizer v4 evidence, benchmark, candidate-factory, and release-gate tooling.

The tool is intentionally dependency-free and fail-closed. It validates JSON evidence
packs and can generate deterministic local capture commands plus paired motion-sheet
scaffolds without claiming that browser captures occurred.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shlex
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Set
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURES = ROOT / "v4" / "evidence" / "fixtures"
DEFAULT_RAW_ROOT = DEFAULT_FIXTURES / "raw"
DEFAULT_DERIVED_ROOT = ROOT / "v4" / "evidence" / "derived"
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
    if parsed.scheme in {"http", "https"}:
        require(parsed.hostname in {"127.0.0.1", "localhost"}, f"route must be local-only, got {route}")
    elif parsed.scheme == "file":
        require(bool(parsed.path), f"file route must include a path: {route}")
    else:
        require(not route.startswith("//") and ".." not in Path(route.split("?", 1)[0]).parts,
                f"route must be local/repo-relative, got {route}")


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


def validate_motion_sheet(sheet: Mapping[str, Any], *, root: Path = ROOT, require_real: bool = False) -> None:
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
            rel = repo_relative_path(cell.get("capture_path"), f"spatial_sheet[{i}].capture_path")
            path = root / rel
            require(path.exists() and path.is_file(), f"spatial_sheet[{i}].capture_path must exist")
            require(not path_has_symlink_component(path), f"spatial_sheet[{i}].capture_path must not use symlinks")
            realpath_under(path, root, f"spatial_sheet[{i}].capture_path")
            validate_sha256(cell.get("capture_sha256"), f"spatial_sheet[{i}].capture_sha256")
            actual_hash = compute_file_sha256(path)
            require(actual_hash == cell.get("capture_sha256"), f"spatial_sheet[{i}].capture_sha256 mismatch")
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


def validate_benchmark(report: Mapping[str, Any], *, require_real: bool = False) -> None:
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
        validate_benchmark(load_json(target), require_real=require_real)


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
        computed = has_provenance and has_scene and (gate_name == "gate_1" or has_benchmark) and (gate_name == "gate_1" or has_motion)
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
