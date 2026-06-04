import unittest

from aiawd_server.target_registry import TargetRegistry


class TargetRegistryTest(unittest.TestCase):
    def test_default_target_exposes_docker_manifest_metadata(self) -> None:
        registry = TargetRegistry()

        target = registry.list_targets()[0]

        self.assertEqual(target["template_id"], "real_ctf_web_awd_01")
        self.assertEqual(target["difficulty"], "professional")
        self.assertEqual(target["runtime"], "docker-compose")
        self.assertEqual(target["manifest"]["healthcheck"]["path"], "/health")
        self.assertEqual(target["manifest"]["flag"]["inject"]["env"], "AIAWD_FLAG")
        self.assertTrue(target["manifest"]["security"]["no_public_targets"])

    def test_manifest_snapshots_are_copied(self) -> None:
        registry = TargetRegistry()
        snapshot = registry.get("real_ctf_web_awd_01").manifest_snapshot()

        snapshot["runtime"] = "changed"

        self.assertEqual(registry.get("real_ctf_web_awd_01").manifest_snapshot()["runtime"], "docker-compose")


if __name__ == "__main__":
    unittest.main()
