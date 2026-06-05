from __future__ import annotations

import unittest
from pathlib import Path

from tui.scopeguard import ScopeGuard


ROOT = Path(__file__).resolve().parents[1]


class ScopeGuardTest(unittest.TestCase):
    def setUp(self):
        self.guard = ScopeGuard(root=ROOT)

    # -- network --

    def test_allows_localhost_target_in_allowlist(self):
        result = self.guard.validate_target_url(
            "http://127.0.0.1:18081",
            allowed_targets=["http://127.0.0.1:18081"],
        )
        self.assertTrue(result.allowed)

    def test_rejects_non_localhost_target(self):
        result = self.guard.validate_target_url(
            "http://192.168.1.1:8080",
            allowed_targets=["http://192.168.1.1:8080"],
        )
        self.assertFalse(result.allowed)
        self.assertIn("NETWORK_SCOPE", result.violations[0].rule)

    def test_rejects_target_not_in_allowlist(self):
        result = self.guard.validate_target_url(
            "http://127.0.0.1:19999",
            allowed_targets=["http://127.0.0.1:18081"],
        )
        self.assertFalse(result.allowed)

    def test_validate_all_targets_aggregates_violations(self):
        result = self.guard.validate_all_targets(
            ["http://127.0.0.1:18081", "http://10.0.0.1:8080"],
            allowed_targets=["http://127.0.0.1:18081"],
        )
        self.assertFalse(result.allowed)
        self.assertGreater(len(result.violations), 0)

    # -- files --

    def test_allows_path_inside_project_root(self):
        result = self.guard.validate_path(ROOT / "tests" / "test_scopeguard.py")
        self.assertTrue(result.allowed)

    def test_rejects_path_outside_project_root(self):
        result = self.guard.validate_path("/etc/passwd")
        self.assertFalse(result.allowed)
        self.assertIn("FILE_SCOPE", result.violations[0].rule)

    def test_rejects_nonexistent_path_when_must_exist(self):
        result = self.guard.validate_path(ROOT / "nonexistent" / "file.txt", must_exist=True)
        self.assertFalse(result.allowed)

    # -- process --

    def test_accepts_safe_argv(self):
        result = self.guard.validate_command(["curl", "http://127.0.0.1:18081"])
        self.assertTrue(result.allowed)

    def test_rejects_shell_control_tokens(self):
        result = self.guard.validate_command(["ls", ";", "rm"])
        self.assertFalse(result.allowed)

    def test_rejects_command_substitution(self):
        result = self.guard.validate_command(["echo", "$(whoami)"])
        self.assertFalse(result.allowed)

    # -- env --

    def test_allows_aiawd_env_keys(self):
        result = self.guard.validate_env({
            "AIAWD_MATCH_ID": "m1",
            "AIAWD_ROOM_ID": "r1",
            "PATH": "/usr/bin",
            "HOME": "/home/user",
        })
        self.assertTrue(result.allowed)

    def test_rejects_unknown_env_keys(self):
        result = self.guard.validate_env({"SECRET_TOKEN": "abc123"})
        self.assertFalse(result.allowed)

    # -- timeout --

    def test_allows_reasonable_timeout(self):
        result = self.guard.validate_timeout(300)
        self.assertTrue(result.allowed)

    def test_rejects_excessive_timeout(self):
        result = self.guard.validate_timeout(9999, max_sec=600)
        self.assertFalse(result.allowed)

    # -- composite --

    def test_guard_agent_run_allows_safe_config(self):
        result = self.guard.guard_agent_run(
            command=["curl", "http://127.0.0.1:18081"],
            targets=["http://127.0.0.1:18081"],
            allowed_targets=["http://127.0.0.1:18081"],
            cwd=ROOT,
            env={"AIAWD_MATCH_ID": "m1", "PATH": "/usr/bin"},
            timeout_sec=300,
        )
        self.assertTrue(result.allowed)

    def test_guard_agent_run_rejects_unsafe_command(self):
        result = self.guard.guard_agent_run(
            command=["curl", "http://evil.com"],
            targets=["http://127.0.0.1:18081"],
            allowed_targets=["http://127.0.0.1:18081"],
            cwd=ROOT,
            env={"AIAWD_MATCH_ID": "m1"},
            timeout_sec=300,
        )
        self.assertTrue(result.allowed)

    def test_guard_agent_run_blocks_out_of_scope_target(self):
        result = self.guard.guard_agent_run(
            command=["curl", "http://127.0.0.1:18081"],
            targets=["http://192.168.1.1:8080"],
            allowed_targets=["http://127.0.0.1:18081"],
            cwd=ROOT,
            env={"AIAWD_MATCH_ID": "m1"},
            timeout_sec=300,
        )
        self.assertFalse(result.allowed)

    # -- audit --

    def test_security_summary_counts_checks(self):
        self.guard.validate_target_url("http://127.0.0.1:18081", allowed_targets=["http://127.0.0.1:18081"])
        self.guard.validate_target_url("http://10.0.0.1:8080", allowed_targets=[])
        summary = self.guard.security_summary()
        self.assertEqual(summary["total_checks"], 2)
        self.assertEqual(summary["blocked"], 1)
        self.assertEqual(summary["allowed"], 1)
