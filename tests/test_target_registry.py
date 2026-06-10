import unittest

from aiawd_server.target_registry import DEFAULT_TARGET_TEMPLATE_ID, TargetRegistry


class TargetRegistryTest(unittest.TestCase):
    def test_default_target_exposes_docker_manifest_metadata(self) -> None:
        registry = TargetRegistry()

        target = registry.list_targets()[0]

        self.assertEqual(target["template_id"], DEFAULT_TARGET_TEMPLATE_ID)
        self.assertEqual(target["difficulty"], "beginner")
        self.assertEqual(target["runtime"], "docker-compose")
        self.assertEqual(target["manifest"]["healthcheck"]["path"], "/health")
        self.assertEqual(target["manifest"]["flag"]["inject"]["env"], "AIAWD_FLAG")
        self.assertTrue(target["manifest"]["flag"]["visible_to_agent"])
        self.assertTrue(target["manifest"]["security"]["no_public_targets"])

    def test_manifest_snapshots_are_copied(self) -> None:
        registry = TargetRegistry()
        snapshot = registry.get("real_ctf_web_awd_01").manifest_snapshot()

        snapshot["runtime"] = "changed"

        self.assertEqual(registry.get("real_ctf_web_awd_01").manifest_snapshot()["runtime"], "docker-compose")

    def test_all_targets_are_registered(self) -> None:
        registry = TargetRegistry()
        targets = registry.list_targets()
        self.assertEqual(len(targets), 4)
        ids = [t["template_id"] for t in targets]
        self.assertIn("real_ctf_web_awd_02", ids)
        self.assertIn("real_ctf_web_awd_01", ids)
        self.assertIn("pwn_awd_echo_01", ids)
        self.assertIn("crypto_awd_oracle_01", ids)

    def test_pwn_target_has_tcp_healthcheck(self) -> None:
        registry = TargetRegistry()
        pwn = registry.get("pwn_awd_echo_01")
        self.assertEqual(pwn.category, "pwn")
        self.assertEqual(pwn.difficulty, "intermediate")
        self.assertEqual(pwn.manifest["healthcheck"]["type"], "tcp")
        self.assertEqual(pwn.manifest["healthcheck"]["send"], "HEALTH")
        self.assertEqual(pwn.manifest["healthcheck"]["expect"], "OK")

    def test_crypto_target_has_tcp_healthcheck(self) -> None:
        registry = TargetRegistry()
        crypto = registry.get("crypto_awd_oracle_01")
        self.assertEqual(crypto.category, "crypto")
        self.assertEqual(crypto.difficulty, "intermediate")
        self.assertEqual(crypto.manifest["healthcheck"]["type"], "tcp")
        self.assertEqual(crypto.manifest["healthcheck"]["send"], "HEALTH")
        self.assertEqual(crypto.manifest["healthcheck"]["expect"], "OK")


if __name__ == "__main__":
    unittest.main()
