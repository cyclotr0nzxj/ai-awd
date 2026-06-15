import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from examples.target_lifecycle_evidence import DEMO_FLAG, run_all_evidence, run_evidence


class TargetLifecycleEvidenceTest(unittest.TestCase):
    def test_dry_run_writes_redacted_evidence(self) -> None:
        with TemporaryDirectory() as temp_dir:
            result = run_evidence(live=False, log_dir=Path(temp_dir))

            evidence = result.evidence_path.read_text(encoding="utf-8")
            transcript = result.transcript_path.read_text(encoding="utf-8")

        self.assertTrue(result.ok)
        self.assertEqual(result.mode, "dry-run")
        self.assertIn("target_lifecycle_evidence", str(result.evidence_path))
        self.assertIn("\"mode\": \"dry-run\"", evidence)
        self.assertIn("install", evidence)
        self.assertIn("start", evidence)
        self.assertIn("health", evidence)
        self.assertIn("summary: ok", transcript)
        self.assertNotIn(DEMO_FLAG, evidence)
        self.assertNotIn(DEMO_FLAG, transcript)

    def test_live_runner_path_records_install_start_and_stop_without_flag_output(self) -> None:
        calls: list[list[str]] = []

        def runner(argv, **kwargs):
            calls.append(list(argv))

            class Result:
                returncode = 0

            return Result()

        class Response:
            status = 200

        def opener(url, *, timeout):
            return Response()

        with TemporaryDirectory() as temp_dir:
            result = run_evidence(live=True, log_dir=Path(temp_dir), runner=runner, opener=opener)
            evidence = result.evidence_path.read_text(encoding="utf-8")

        self.assertTrue(result.ok)
        self.assertEqual(result.mode, "live")
        self.assertEqual(calls[0][-1], "build")
        self.assertEqual(calls[1][-2:], ["up", "-d"])
        self.assertEqual(calls[-1][-1], "down")
        self.assertNotIn(DEMO_FLAG, evidence)

    def test_all_targets_dry_run_writes_each_template_without_flag_output(self) -> None:
        with TemporaryDirectory() as temp_dir:
            result = run_all_evidence(live=False, log_dir=Path(temp_dir))
            evidence = result.evidence_path.read_text(encoding="utf-8")
            transcript = result.transcript_path.read_text(encoding="utf-8")

        self.assertTrue(result.ok)
        self.assertEqual(result.mode, "dry-run-all")
        self.assertEqual(result.summary["target_count"], 4)
        for template_id in ("real_ctf_web_awd_02", "real_ctf_web_awd_01", "pwn_awd_echo_01", "crypto_awd_oracle_01"):
            self.assertIn(template_id, evidence)
            self.assertIn(template_id, transcript)
        self.assertEqual(evidence.count('"action": "health"'), 4)
        self.assertNotIn(DEMO_FLAG, evidence)
        self.assertNotIn(DEMO_FLAG, transcript)


if __name__ == "__main__":
    unittest.main()
