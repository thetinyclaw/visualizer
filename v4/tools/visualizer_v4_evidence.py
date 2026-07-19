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
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURES = ROOT / "v4" / "evidence" / "fixtures"
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
DISALLOWED_TELEMETRY_LABELS = ("fake", "fabricated", "simulated", "dummy", "placeholder", "n/a", "estimated")
REQUIRED_RECIPE_SECTIONS = [
    "topology",
    "projection",
    "silhouette",
    "occupancy",
    "camera",
    "layers",
    "motion_law",
    "material",
    "lighting",
    "temporal_arc",
    "originality",
]
REQUIRED_SOURCE_FIELDS = ["id", "immutable_path", "sha256", "rights", "allowed_transformations"]


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


def is_relative_immutable_path(text: str) -> bool:
    p = Path(text)
    return not p.is_absolute() and ".." not in p.parts


def validate_human_decision(decision: Any, *, require_approved: bool, context: str) -> None:
    decision = require_mapping(decision, f"{context}.human_decision")
    status = require_nonempty_string(decision.get("status"), f"{context}.human_decision.status")
    require(status in {"approved", "rejected", "revise", "branch", "discard"},
            f"{context}.human_decision.status has unsupported value {status!r}")
    if require_approved:
        require(status == "approved", f"{context} requires explicit human approval")
    require_nonempty_string(decision.get("approver_id"), f"{context}.human_decision.approver_id")
    require_nonempty_string(decision.get("statement"), f"{context}.human_decision.statement")
    require_iso8601(decision.get("decided_at"), f"{context}.human_decision.decided_at")
    require(decision.get("autonomous") is False, f"{context}.human_decision.autonomous must be false")


def validate_provenance(manifest: Mapping[str, Any], *, root: Path = ROOT, verify_hashes: bool = False) -> None:
    require_nonempty_string(manifest.get("manifest_version"), "manifest_version")
    require_nonempty_string(manifest.get("effect_id"), "effect_id")
    require_iso8601(manifest.get("created_at"), "created_at")
    sources = manifest.get("sources")
    require(isinstance(sources, list) and sources, "sources must be a non-empty array")
    for i, source in enumerate(sources):
        source = require_mapping(source, f"sources[{i}]")
        for field in REQUIRED_SOURCE_FIELDS:
            require(field in source, f"sources[{i}].{field} is required")
        immutable_path = require_nonempty_string(source["immutable_path"], f"sources[{i}].immutable_path")
        require(is_relative_immutable_path(immutable_path), f"sources[{i}].immutable_path must be repo-relative and immutable")
        validate_sha256(source["sha256"], f"sources[{i}].sha256")
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
        if verify_hashes:
            actual_path = root / immutable_path
            require(actual_path.exists(), f"sources[{i}].immutable_path does not exist for hash verification: {immutable_path}")
            actual_hash = compute_file_sha256(actual_path)
            require(actual_hash == source["sha256"], f"sources[{i}].sha256 mismatch: expected {source['sha256']} got {actual_hash}")
    require(isinstance(manifest.get("derived_outputs"), list), "derived_outputs must be an array")
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
        # Plain repo-relative HTML routes are allowed and resolved by the local static server.
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
    for i, frame in enumerate(frames):
        frame = require_mapping(frame, f"frames[{i}]")
        require(isinstance(frame.get("index"), int) and frame["index"] >= 0, f"frames[{i}].index must be a non-negative integer")
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
        {
            "frame_index": frame["index"],
            "time_ms": frame["time_ms"],
            "role": frame.get("role", "sample"),
            "capture_path": None,
            "status": "pending_real_capture",
        }
        for frame in frames
    ]
    chronological = []
    for previous, current in zip(frames, frames[1:]):
        chronological.append({
            "from_frame": previous["index"],
            "to_frame": current["index"],
            "delta_ms": current["time_ms"] - previous["time_ms"],
            "motion_observation": "pending_human_review",
            "geometry_motion": None,
            "illumination_motion": None,
            "camera_motion": None,
        })
    return {
        "motion_sheet_version": "1.0",
        "effect_id": spec["effect_id"],
        "route": spec["route"],
        "seed": spec["seed"],
        "viewport": spec["viewport"],
        "dpr": spec["dpr"],
        "spatial_sheet": spatial_cells,
        "chronological_sheet": chronological,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "capture_claim": "fixture_scaffold_only_no_browser_capture_performed",
    }


def validate_motion_sheet(sheet: Mapping[str, Any]) -> None:
    require_nonempty_string(sheet.get("motion_sheet_version"), "motion_sheet_version")
    require_nonempty_string(sheet.get("effect_id"), "effect_id")
    validate_local_route(require_nonempty_string(sheet.get("route"), "route"))
    require(float(sheet.get("dpr", 0)) >= 1.0, "motion sheet dpr must be >= 1")
    spatial = sheet.get("spatial_sheet")
    chronological = sheet.get("chronological_sheet")
    require(isinstance(spatial, list) and len(spatial) >= 2, "spatial_sheet must contain at least two frames")
    require(isinstance(chronological, list) and len(chronological) == len(spatial) - 1,
            "chronological_sheet must connect every adjacent spatial frame")
    require(sheet.get("capture_claim") in {"fixture_scaffold_only_no_browser_capture_performed", "real_browser_capture_completed"},
            "capture_claim must be explicit and honest")


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


def validate_benchmark(report: Mapping[str, Any]) -> None:
    check_no_bad_telemetry_labels(report)
    require_nonempty_string(report.get("benchmark_schema_version"), "benchmark_schema_version")
    require_nonempty_string(report.get("effect_id"), "effect_id")
    require(isinstance(report.get("seed"), int), "seed must be an integer")
    viewport = require_mapping(report.get("viewport"), "viewport")
    require(int(viewport.get("width", 0)) > 0 and int(viewport.get("height", 0)) > 0, "viewport width/height must be positive")
    require(float(report.get("dpr", 0)) >= 1.0, "DPR must be >= 1")
    density = require_mapping(report.get("effective_density"), "effective_density")
    require(float(density.get("x", 0)) >= 1.0 and float(density.get("y", 0)) >= 1.0,
            "effective density must be >= 1 in both axes")
    samples = report.get("frame_samples")
    require(isinstance(samples, list) and len(samples) >= 120, "frame_samples must contain at least 120 samples")
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
    require(isinstance(report.get("console_logs"), list), "console_logs must be an array")
    require(isinstance(report.get("device_logs"), list), "device_logs must be an array")


def validate_target_matrix(matrix: Mapping[str, Any]) -> None:
    require_nonempty_string(matrix.get("matrix_version"), "matrix_version")
    devices = matrix.get("devices")
    require(isinstance(devices, list) and devices, "devices must be a non-empty array")
    for i, device in enumerate(devices):
        device = require_mapping(device, f"devices[{i}]")
        require_nonempty_string(device.get("id"), f"devices[{i}].id")
        require(float(device.get("minimum_dpr", 0)) >= 1.0, f"devices[{i}].minimum_dpr must be >= 1")
        require(int(device.get("minimum_frame_samples", 0)) >= 120,
                f"devices[{i}].minimum_frame_samples must be >= 120")


def validate_gates(gate_manifest: Mapping[str, Any]) -> None:
    require_nonempty_string(gate_manifest.get("gate_manifest_version"), "gate_manifest_version")
    require(gate_manifest.get("autonomous_self_merge") is False, "autonomous_self_merge must be false")
    require(gate_manifest.get("production_merge_action") in {None, "none"}, "gate manifest must not include a production merge action")
    gates = require_mapping(gate_manifest.get("gates"), "gates")
    for gate_name in ("gate_1", "gate_2", "gate_3"):
        gate = require_mapping(gates.get(gate_name), gate_name)
        require(gate.get("passed") is True, f"{gate_name}.passed must be true")
        validate_human_decision(gate.get("human_decision"), require_approved=True, context=gate_name)
        evidence = gate.get("evidence")
        require(isinstance(evidence, list) and evidence, f"{gate_name}.evidence must be non-empty")
    validate_target_matrix(gate_manifest.get("target_device_matrix"))


def validate_candidate_factory(factory: Mapping[str, Any]) -> None:
    require_nonempty_string(factory.get("factory_schema_version"), "factory_schema_version")
    require_nonempty_string(factory.get("candidate_id"), "candidate_id")
    state = require_nonempty_string(factory.get("state"), "state")
    require(state in FACTORY_STATES, f"unsupported candidate factory state {state}")
    require(factory.get("production_merge_action") in {None, "none"}, "candidate factory must not include production merge action")
    transitions = factory.get("transitions")
    require(isinstance(transitions, list) and transitions, "transitions must be non-empty")
    seen_states = []
    for i, transition in enumerate(transitions):
        transition = require_mapping(transition, f"transitions[{i}]")
        to_state = require_nonempty_string(transition.get("to"), f"transitions[{i}].to")
        require(to_state in FACTORY_STATES, f"transitions[{i}].to unsupported")
        require(to_state != "production_merge", "production_merge is forbidden")
        require_nonempty_string(transition.get("actor"), f"transitions[{i}].actor")
        require_iso8601(transition.get("at"), f"transitions[{i}].at")
        seen_states.append(to_state)
    require(seen_states[-1] == state, "factory.state must match last transition.to")
    if state in {"approved_for_release", "rejected", "discarded", "branched_for_learning"}:
        validate_human_decision(factory.get("human_decision"), require_approved=(state == "approved_for_release"), context="candidate_factory")
    else:
        require(state != "approved_for_release", "approval terminal state requires human_decision")


def advance_candidate_factory(factory: Mapping[str, Any], next_state: str, actor: str) -> Mapping[str, Any]:
    validate_candidate_factory(factory)
    require(next_state in FACTORY_STATES, f"unsupported next state {next_state}")
    require(next_state != "approved_for_release", "tooling cannot autonomously enter approved_for_release; record human approval manually")
    current_index = FACTORY_STATES.index(factory["state"])
    next_index = FACTORY_STATES.index(next_state)
    require(factory["state"] not in TERMINAL_STATES, "terminal candidate factory states cannot advance")
    require(next_index == current_index + 1 or next_state in {"rejected", "discarded", "branched_for_learning"},
            f"invalid transition {factory['state']} -> {next_state}")
    updated = json.loads(json.dumps(factory))
    updated["state"] = next_state
    updated["transitions"].append({
        "from": factory["state"],
        "to": next_state,
        "actor": actor,
        "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "notes": "automated state advance; no production merge action performed",
    })
    return updated


def validate_release_manifest(release: Mapping[str, Any]) -> None:
    require_nonempty_string(release.get("release_manifest_version"), "release_manifest_version")
    require_nonempty_string(release.get("release_id"), "release_id")
    channels = release.get("channels")
    require(isinstance(channels, list) and channels, "channels must be non-empty")
    for i, channel in enumerate(channels):
        channel = require_mapping(channel, f"channels[{i}]")
        require_nonempty_string(channel.get("name"), f"channels[{i}].name")
        require(channel.get("deployment_action") in {"none", "read_only_verify_only"},
                f"channels[{i}] must not request deployment")
        require_nonempty_string(channel.get("url"), f"channels[{i}].url")
    rollback = require_mapping(release.get("rollback"), "rollback")
    require_nonempty_string(rollback.get("previous_release_id"), "rollback.previous_release_id")
    require_nonempty_string(rollback.get("operator_instructions"), "rollback.operator_instructions")
    checklist = release.get("https_verification_checklist")
    require(isinstance(checklist, list) and checklist, "https_verification_checklist must be non-empty")
    for i, item in enumerate(checklist):
        item = require_mapping(item, f"https_verification_checklist[{i}]")
        require(item.get("read_only") is True, f"https_verification_checklist[{i}].read_only must be true")
        require_nonempty_string(item.get("command"), f"https_verification_checklist[{i}].command")
    validate_human_decision(release.get("human_decision"), require_approved=True, context="release")


def read_only_https_check(release: Mapping[str, Any]) -> List[str]:
    validate_release_manifest(release)
    return [item["command"] for item in release["https_verification_checklist"]]


def validate_file(path: Path, validator) -> ValidationResult:
    try:
        payload = load_json(path)
        validator(payload)
        return ValidationResult(str(path), True, "ok")
    except Exception as exc:
        return ValidationResult(str(path), False, str(exc))


def verify_all(fixtures_dir: Path) -> List[ValidationResult]:
    checks = [
        ("provenance.manifest.json", validate_provenance),
        ("scene_recipe.json", validate_scene_recipe),
        ("capture_spec.local.json", validate_capture_spec),
        ("motion_sheet.fixture.json", validate_motion_sheet),
        ("benchmark_report.json", validate_benchmark),
        ("gate_manifest.json", validate_gates),
        ("candidate_factory_state.json", validate_candidate_factory),
        ("release_manifest.json", validate_release_manifest),
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

    p = sub.add_parser("release-check-commands")
    p.add_argument("path", type=Path)

    p = sub.add_parser("verify-all")
    p.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)

    args = parser.parse_args(argv)
    validators = {
        "validate-provenance": validate_provenance,
        "validate-scene-recipe": validate_scene_recipe,
        "validate-capture-spec": validate_capture_spec,
        "validate-motion-sheet": validate_motion_sheet,
        "validate-benchmark": validate_benchmark,
        "validate-gates": validate_gates,
        "validate-candidate-factory": validate_candidate_factory,
        "validate-release": validate_release_manifest,
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
            results = verify_all(args.fixtures)
            for result in results:
                print(f"{Path(result.path).name}: {'ok' if result.ok else 'FAIL'} {result.message}")
            if not all(result.ok for result in results):
                return 1
        return 0
    except EvidenceError as exc:
        print(f"{args.command}: FAILED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
