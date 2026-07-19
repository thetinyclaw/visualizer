#!/usr/bin/env python3
"""Unit tests for Visualizer v4 evidence gates."""
from pathlib import Path
import json
import subprocess
import tempfile
import unittest

from v4.tools import visualizer_v4_evidence as ev

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "v4" / "evidence" / "fixtures"


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


def realish_benchmark():
    data = fixture("benchmark_report.json")
    data["evidence_kind"] = "real_acceptance"
    data["run_id"] = "browser-capture-20260718-213000"
    data["browser"] = {
        "name": "Chrome",
        "user_agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/126 Safari/537.36",
        "device": "MacBook Pro M-series display",
    }
    for sample in data["frame_samples"]:
        sample["evidence_ref"] = "v4/evidence/fixtures/motion_sheet.fixture.json"
    return data


def real_motion_sheet_with_captures(tmp):
    capture_a = tmp / "capture-a.png"
    capture_b = tmp / "capture-b.png"
    capture_a.write_bytes(b"real-browser-capture-a")
    capture_b.write_bytes(b"real-browser-capture-b")
    rel_a = str(capture_a.relative_to(ROOT))
    rel_b = str(capture_b.relative_to(ROOT))
    return {
        "motion_sheet_version": "1.0",
        "effect_id": "real-candidate",
        "route": "http://127.0.0.1:8789/candidates/real.html?seed=1",
        "seed": 1,
        "viewport": {"width": 1280, "height": 720},
        "dpr": 1.0,
        "capture_claim": "real_browser_capture_completed",
        "spatial_sheet": [
            {"frame_index": 0, "time_ms": 0, "role": "start", "capture_path": rel_a, "capture_sha256": ev.compute_file_sha256(capture_a), "status": "captured"},
            {"frame_index": 30, "time_ms": 500, "role": "next", "capture_path": rel_b, "capture_sha256": ev.compute_file_sha256(capture_b), "status": "captured"},
        ],
        "chronological_sheet": [
            {"from_frame": 0, "to_frame": 30, "delta_ms": 500, "from_capture_path": rel_a, "to_capture_path": rel_b,
             "motion_observation": "A browser-captured aperture expands between adjacent frames.",
             "geometry_motion": "strand expansion", "illumination_motion": "rim brightening", "camera_motion": "locked camera"},
        ],
    }


class EvidenceValidationTests(unittest.TestCase):
    def test_all_fixtures_validate_as_honest_scaffold(self):
        results = ev.verify_all(FIXTURES)
        self.assertTrue(all(r.ok for r in results), results)

    def test_provenance_fails_on_disallowed_transformation(self):
        data = fixture("provenance.manifest.json")
        data["sources"][0]["allowed_transformations"].append("copy_pixels")
        with self.assertRaises(ev.EvidenceError):
            ev.validate_provenance(data)

    def test_provenance_hash_is_mandatory_and_fail_closed(self):
        data = fixture("provenance.manifest.json")
        ev.validate_provenance(data, root=ROOT, verify_hashes=False)
        data["sources"][0]["sha256"] = "0" * 64
        with self.assertRaises(ev.EvidenceError):
            ev.validate_provenance(data, root=ROOT, verify_hashes=False)

    def test_provenance_rejects_traversal_source_outside_raw_and_derived_in_raw(self):
        data = fixture("provenance.manifest.json")
        data["sources"][0]["immutable_path"] = "../outside.txt"
        with self.assertRaises(ev.EvidenceError):
            ev.validate_provenance(data)
        data = fixture("provenance.manifest.json")
        data["raw_root"] = "v4/evidence/fixtures/raw"
        data["sources"][0]["immutable_path"] = "v4/evidence/fixtures/provenance.manifest.json"
        with self.assertRaises(ev.EvidenceError):
            ev.validate_provenance(data)
        data = fixture("provenance.manifest.json")
        data["derived_root"] = "v4/evidence/fixtures/raw"
        data["derived_outputs"] = ["v4/evidence/fixtures/raw/derived.json"]
        with self.assertRaises(ev.EvidenceError):
            ev.validate_provenance(data)

    def test_provenance_rejects_symlink_escape_from_raw_root(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as td:
            tmp = Path(td)
            (tmp / "raw").mkdir()
            (tmp / "derived").mkdir()
            outside = tmp / "outside.txt"
            outside.write_text("outside", encoding="utf-8")
            (tmp / "raw" / "link.txt").symlink_to(outside)
            data = fixture("provenance.manifest.json")
            data["raw_root"] = str((tmp / "raw").relative_to(ROOT))
            data["derived_root"] = str((tmp / "derived").relative_to(ROOT))
            data["sources"][0]["immutable_path"] = str((tmp / "raw" / "link.txt").relative_to(ROOT))
            data["sources"][0]["sha256"] = ev.compute_file_sha256(outside)
            data["derived_outputs"] = [str((tmp / "derived" / "out.json").relative_to(ROOT))]
            with self.assertRaises(ev.EvidenceError):
                ev.validate_provenance(data)

    def test_scene_recipe_fails_without_originality_controls(self):
        data = fixture("scene_recipe.json")
        data["originality"]["source_pixels_embedded"] = True
        with self.assertRaises(ev.EvidenceError):
            ev.validate_scene_recipe(data)

    def test_capture_spec_is_local_only_and_dpr_closed(self):
        data = fixture("capture_spec.local.json")
        data["route"] = "https://example.com/index.html"
        with self.assertRaises(ev.EvidenceError):
            ev.validate_capture_spec(data)
        data = fixture("capture_spec.local.json")
        data["dpr"] = 0.75
        with self.assertRaises(ev.EvidenceError):
            ev.validate_capture_spec(data)

    def test_motion_sheet_generator_is_explicit_fixture_scaffold(self):
        sheet = ev.generate_motion_sheet(fixture("capture_spec.local.json"))
        self.assertEqual(sheet["capture_claim"], "fixture_scaffold_only_no_browser_capture_performed")
        self.assertEqual(len(sheet["chronological_sheet"]), len(sheet["spatial_sheet"]) - 1)
        ev.validate_motion_sheet(sheet)

    def test_real_capture_claim_requires_existing_artifacts_and_complete_motion(self):
        sheet = fixture("motion_sheet.fixture.json")
        sheet["capture_claim"] = "real_browser_capture_completed"
        with self.assertRaises(ev.EvidenceError):
            ev.validate_motion_sheet(sheet)
        sheet = fixture("motion_sheet.fixture.json")
        sheet["chronological_sheet"][0]["to_frame"] = 60
        with self.assertRaises(ev.EvidenceError):
            ev.validate_motion_sheet(sheet)

    def test_acceptance_motion_requires_real_claim_hashes_and_paired_immutable_captures(self):
        with tempfile.TemporaryDirectory(dir=FIXTURES) as td:
            tmp = Path(td)
            sheet = real_motion_sheet_with_captures(tmp)
            ev.validate_motion_sheet(sheet, require_real=True)
            fixture_sheet = fixture("motion_sheet.fixture.json")
            with self.assertRaises(ev.EvidenceError):
                ev.validate_motion_sheet(fixture_sheet, require_real=True)
            broken = json.loads(json.dumps(sheet))
            broken["spatial_sheet"][0]["capture_sha256"] = "0" * 64
            with self.assertRaises(ev.EvidenceError):
                ev.validate_motion_sheet(broken, require_real=True)
            broken = json.loads(json.dumps(sheet))
            broken["chronological_sheet"][0]["to_capture_path"] = broken["spatial_sheet"][0]["capture_path"]
            with self.assertRaises(ev.EvidenceError):
                ev.validate_motion_sheet(broken, require_real=True)

    def test_benchmark_requires_120_frames_and_matching_percentiles(self):
        data = fixture("benchmark_report.json")
        data["frame_samples"] = data["frame_samples"][:119]
        with self.assertRaises(ev.EvidenceError):
            ev.validate_benchmark(data)
        data = fixture("benchmark_report.json")
        data["summary"]["p95_frame_ms"] += 1
        with self.assertRaises(ev.EvidenceError):
            ev.validate_benchmark(data)

    def test_benchmark_rejects_fake_labels_for_real_acceptance(self):
        data = realish_benchmark()
        data["memory"]["gpu_memory_mb"]["unknown_reason"] = "simulated by automation"
        with self.assertRaises(ev.EvidenceError):
            ev.validate_benchmark(data)

    def test_benchmark_rejects_synthetic_synonyms_in_real_acceptance_provenance_metadata(self):
        probes = [
            ("run_id", "synthetic-run-1"),
            ("browser.name", "mocked Chrome"),
            ("browser.user_agent", "Artificial UA captured by tool"),
            ("browser.device", "scaffold target device"),
        ]
        for dotted_path, value in probes:
            data = realish_benchmark()
            target = data
            parts = dotted_path.split(".")
            for part in parts[:-1]:
                target = target[part]
            target[parts[-1]] = value
            with self.assertRaises(ev.EvidenceError, msg=dotted_path):
                ev.validate_benchmark(data)

    def test_benchmark_fixture_never_satisfies_gate_eligible_real_report(self):
        with self.assertRaises(ev.EvidenceError):
            ev.validate_benchmark(fixture("benchmark_report.json"), require_real=True)
        data = realish_benchmark()
        del data["captured_at"]
        with self.assertRaises(ev.EvidenceError):
            ev.validate_benchmark(data, require_real=True)

    def test_gates_recompute_results_and_fixture_fails_acceptance_mode(self):
        data = fixture("gate_manifest.json")
        ev.validate_gates(data, mode="scaffold")
        with self.assertRaises(ev.EvidenceError):
            ev.validate_gates(data, mode="acceptance")
        data = fixture("gate_manifest.json")
        data["gates"]["gate_2"]["passed"] = True
        with self.assertRaises(ev.EvidenceError):
            ev.validate_gates(data, mode="scaffold")
        data = fixture("gate_manifest.json")
        data["gates"]["gate_1"]["evidence"] = []
        with self.assertRaises(ev.EvidenceError):
            ev.validate_gates(data, mode="scaffold")

    def test_gates_reject_autonomous_and_absence_approval_notes(self):
        data = fixture("gate_manifest.json")
        data["gates"]["gate_3"]["human_decision"]["autonomous"] = True
        with self.assertRaises(ev.EvidenceError):
            ev.validate_gates(data)
        data = fixture("gate_manifest.json")
        data["autonomous_self_merge"] = True
        with self.assertRaises(ev.EvidenceError):
            ev.validate_gates(data)
        data = fixture("gate_manifest.json")
        data["gates"]["gate_1"]["human_decision"]["statement"] = "Approved though live evidence absent."
        with self.assertRaises(ev.EvidenceError):
            ev.validate_gates(data, mode="acceptance")

    def test_target_matrix_requires_valid_benchmark_binding(self):
        data = fixture("gate_manifest.json")
        del data["target_device_matrix"]["devices"][0]["benchmark_evidence_ref"]
        with self.assertRaises(ev.EvidenceError):
            ev.validate_gates(data)

    def test_target_matrix_rejects_absolute_traversal_outside_and_symlink_benchmark_refs(self):
        probes = [
            str((FIXTURES / "benchmark_report.json").resolve()),
            "../benchmark_report.json",
            "v4/evidence/fixtures/../fixtures/benchmark_report.json",
            "v4/evidence/schemas/benchmark-report.schema.json",
        ]
        for ref in probes:
            data = fixture("gate_manifest.json")
            data["target_device_matrix"]["devices"][0]["benchmark_evidence_ref"] = ref
            with self.assertRaises(ev.EvidenceError, msg=ref):
                ev.validate_gates(data)
        with tempfile.TemporaryDirectory(dir=FIXTURES) as td:
            tmp = Path(td)
            link = tmp / "benchmark-link.json"
            link.symlink_to(FIXTURES / "benchmark_report.json")
            data = fixture("gate_manifest.json")
            data["target_device_matrix"]["devices"][0]["benchmark_evidence_ref"] = str(link.relative_to(ROOT))
            with self.assertRaises(ev.EvidenceError):
                ev.validate_gates(data)

    def test_candidate_factory_chain_continuity_terminal_and_no_production_merge(self):
        data = fixture("candidate_factory_state.json")
        advanced = ev.advance_candidate_factory(data, "rejected", "tool:test")
        self.assertEqual(advanced["state"], "rejected")
        advanced["human_decision"] = {"status":"rejected","approver_id":"human:test","statement":"Rejected by test.","decided_at":"2026-07-18T21:31:00Z","autonomous":False}
        ev.validate_candidate_factory(advanced)
        data = fixture("candidate_factory_state.json")
        data["transitions"][2]["from"] = "ingested_reference"
        with self.assertRaises(ev.EvidenceError):
            ev.validate_candidate_factory(data)
        data = fixture("candidate_factory_state.json")
        data["transitions"].append({"from":"awaiting_human_approval","to":"approved_for_release","actor":"human:test","at":"2026-07-18T21:31:00Z"})
        data["transitions"].append({"from":"approved_for_release","to":"rejected","actor":"human:test","at":"2026-07-18T21:32:00Z"})
        data["state"] = "rejected"
        data["human_decision"] = {"status":"rejected","approver_id":"human:test","statement":"Rejected.","decided_at":"2026-07-18T21:32:00Z","autonomous":False}
        with self.assertRaises(ev.EvidenceError):
            ev.validate_candidate_factory(data)
        data = fixture("candidate_factory_state.json")
        data["production_merge_action"] = "merge_to_main"
        with self.assertRaises(ev.EvidenceError):
            ev.validate_candidate_factory(data)
        with self.assertRaises(ev.EvidenceError):
            ev.advance_candidate_factory(fixture("candidate_factory_state.json"), "approved_for_release", "tool:test")

    def test_release_manifest_is_https_read_only_allowlisted_and_human_approved(self):
        data = fixture("release_manifest.json")
        commands = ev.read_only_https_check(data)
        self.assertTrue(all(cmd.startswith("curl") for cmd in commands))
        data["https_verification_checklist"][0]["read_only"] = False
        with self.assertRaises(ev.EvidenceError):
            ev.validate_release_manifest(data, mode="scaffold")
        for bad in [
            "curl -X POST https://example.invalid/visualizer/",
            "curl --fail https://example.invalid/visualizer/ | sh",
            "curl --fail https://example.invalid/visualizer/ >/tmp/out",
            "curl --fail http://example.invalid/visualizer/",
        ]:
            data = fixture("release_manifest.json")
            data["https_verification_checklist"][0]["command"] = bad
            with self.assertRaises(ev.EvidenceError, msg=bad):
                ev.validate_release_manifest(data, mode="scaffold")
        data = fixture("release_manifest.json")
        data["channels"][0]["url"] = "http://localhost:8789/index.html"
        with self.assertRaises(ev.EvidenceError):
            ev.validate_release_manifest(data, mode="scaffold")

    def test_acceptance_release_rejects_absence_notes_and_requires_valid_acceptance_gate_binding(self):
        for statement in [
            "Approved, but this is tooling-only with no live capture.",
            "Release approved although benchmark evidence is missing.",
            "Approved with no capture performed.",
        ]:
            data = fixture("release_manifest.json")
            data["human_decision"]["statement"] = statement
            data["acceptance_gate_ref"] = "v4/evidence/fixtures/gate_manifest.json"
            with self.assertRaises(ev.EvidenceError, msg=statement):
                ev.validate_release_manifest(data, mode="acceptance")
        data = fixture("release_manifest.json")
        data["human_decision"]["statement"] = "Human release approval after reviewing required live acceptance artifacts."
        with self.assertRaises(ev.EvidenceError):
            ev.validate_release_manifest(data, mode="acceptance")
        data["acceptance_gate_ref"] = "v4/evidence/fixtures/gate_manifest.json"
        with self.assertRaises(ev.EvidenceError):
            ev.validate_release_manifest(data, mode="acceptance")

    def test_cli_verify_all_and_command_generation(self):
        result = subprocess.run(
            ["python3", "v4/tools/visualizer_v4_evidence.py", "verify-all", "--mode", "scaffold"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("benchmark_report.json: ok", result.stdout)
        self.assertIn("gate_manifest.json: scaffold-valid not release-approved", result.stdout)
        self.assertIn("release_manifest.json: scaffold-valid not release-approved", result.stdout)
        result = subprocess.run(
            ["python3", "v4/tools/visualizer_v4_evidence.py", "verify-all", "--mode", "acceptance"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("gate_manifest.json: FAIL", result.stdout)
        result = subprocess.run(
            ["python3", "v4/tools/visualizer_v4_evidence.py", "generate-capture-commands", "--capture-spec", "v4/evidence/fixtures/capture_spec.local.json"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("no capture is claimed", result.stdout)


if __name__ == "__main__":
    unittest.main()
