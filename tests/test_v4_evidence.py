#!/usr/bin/env python3
"""Unit tests for Visualizer v4 evidence gates."""
from pathlib import Path
import copy
import json
import subprocess
import tempfile
import unittest

from v4.tools import visualizer_v4_evidence as ev

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "v4" / "evidence" / "fixtures"


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


class EvidenceValidationTests(unittest.TestCase):
    def test_all_fixtures_validate(self):
        results = ev.verify_all(FIXTURES)
        self.assertTrue(all(r.ok for r in results), results)

    def test_provenance_fails_on_disallowed_transformation(self):
        data = fixture("provenance.manifest.json")
        data["sources"][0]["allowed_transformations"].append("copy_pixels")
        with self.assertRaises(ev.EvidenceError):
            ev.validate_provenance(data)

    def test_provenance_hash_can_be_verified(self):
        data = fixture("provenance.manifest.json")
        ev.validate_provenance(data, root=ROOT, verify_hashes=True)
        data["sources"][0]["sha256"] = "0" * 64
        with self.assertRaises(ev.EvidenceError):
            ev.validate_provenance(data, root=ROOT, verify_hashes=True)

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

    def test_benchmark_requires_120_frames_and_matching_percentiles(self):
        data = fixture("benchmark_report.json")
        data["frame_samples"] = data["frame_samples"][:119]
        with self.assertRaises(ev.EvidenceError):
            ev.validate_benchmark(data)
        data = fixture("benchmark_report.json")
        data["summary"]["p95_frame_ms"] += 1
        with self.assertRaises(ev.EvidenceError):
            ev.validate_benchmark(data)

    def test_benchmark_rejects_fake_or_ambiguous_telemetry_labels(self):
        data = fixture("benchmark_report.json")
        data["memory"]["gpu_memory_mb"]["unknown_reason"] = "simulated by automation"
        with self.assertRaises(ev.EvidenceError):
            ev.validate_benchmark(data)

    def test_gates_require_human_approval_and_forbid_self_merge(self):
        data = fixture("gate_manifest.json")
        data["gates"]["gate_3"]["human_decision"]["autonomous"] = True
        with self.assertRaises(ev.EvidenceError):
            ev.validate_gates(data)
        data = fixture("gate_manifest.json")
        data["autonomous_self_merge"] = True
        with self.assertRaises(ev.EvidenceError):
            ev.validate_gates(data)

    def test_candidate_factory_has_no_production_merge_and_terminal_states(self):
        data = fixture("candidate_factory_state.json")
        advanced = ev.advance_candidate_factory(data, "rejected", "tool:test")
        self.assertEqual(advanced["state"], "rejected")
        advanced["human_decision"] = {"status":"rejected","approver_id":"human:test","statement":"Rejected by test.","decided_at":"2026-07-18T21:31:00Z","autonomous":False}
        ev.validate_candidate_factory(advanced)
        data = fixture("candidate_factory_state.json")
        data["production_merge_action"] = "merge_to_main"
        with self.assertRaises(ev.EvidenceError):
            ev.validate_candidate_factory(data)
        with self.assertRaises(ev.EvidenceError):
            ev.advance_candidate_factory(fixture("candidate_factory_state.json"), "approved_for_release", "tool:test")

    def test_release_manifest_is_read_only_and_human_approved(self):
        data = fixture("release_manifest.json")
        commands = ev.read_only_https_check(data)
        self.assertTrue(all(cmd.startswith("curl") for cmd in commands))
        data["https_verification_checklist"][0]["read_only"] = False
        with self.assertRaises(ev.EvidenceError):
            ev.validate_release_manifest(data)

    def test_cli_verify_all_and_command_generation(self):
        result = subprocess.run(
            ["python3", "v4/tools/visualizer_v4_evidence.py", "verify-all"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("benchmark_report.json: ok", result.stdout)
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
