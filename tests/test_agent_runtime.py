from __future__ import annotations

import unittest
from pathlib import Path

from tui.agent_runtime import (
    AgentAction,
    AgentContext,
    AgentManager,
    AgentResult,
    CustomCommandAdapter,
    _default_extract_flags,
    _expand_template,
    sanitize_command,
)


class AgentRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.ctx = AgentContext(
            match_id="match_001",
            room_id="room_x",
            team_id="team_a",
            phase="ATTACK",
            targets=[{"team_id": "team_b", "base_url": "http://127.0.0.1:18082"}],
            local_target={"host": "127.0.0.1", "port": 18081, "base_url": "http://127.0.0.1:18081"},
            allowed_targets=["http://127.0.0.1:18081", "http://127.0.0.1:18082"],
            target_template_id="real_ctf_web_awd_01",
        )

    def test_agent_context_env_exports_all_fields(self):
        env = self.ctx.env()
        self.assertEqual(env["AIAWD_MATCH_ID"], "match_001")
        self.assertEqual(env["AIAWD_ROOM_ID"], "room_x")
        self.assertEqual(env["AIAWD_TEAM_ID"], "team_a")
        self.assertEqual(env["AIAWD_PHASE"], "ATTACK")
        self.assertEqual(env["AIAWD_LOCAL_TARGET"], "http://127.0.0.1:18081")
        self.assertEqual(env["AIAWD_TARGET_TEMPLATE"], "real_ctf_web_awd_01")

    def test_default_extract_flags_finds_braced_flags(self):
        text = "Found FLAG{abc_123} and FLAG{xyz-789} in output"
        flags = _default_extract_flags(text)
        self.assertEqual(flags, ["FLAG{abc_123}", "FLAG{xyz-789}"])

    def test_default_extract_flags_ignores_non_flag_braces(self):
        text = "json: {key: value} no flag here"
        flags = _default_extract_flags(text)
        self.assertEqual(flags, [])

    def test_expand_template_replaces_target_url(self):
        result = _expand_template(
            ["curl", "{target_url}/health"],
            target_url="http://127.0.0.1:18082",
            ctx=self.ctx,
        )
        self.assertEqual(result, ["curl", "http://127.0.0.1:18082/health"])

    def test_expand_template_replaces_match_context(self):
        result = _expand_template(
            ["echo", "{match_id}", "{room_id}", "{team_id}"],
            target_url="http://127.0.0.1:18082",
            ctx=self.ctx,
        )
        self.assertEqual(result, ["echo", "match_001", "room_x", "team_a"])

    def test_custom_command_adapter_requires_configure(self):
        adapter = CustomCommandAdapter(["echo", "hello"])
        result = adapter.run()
        self.assertFalse(result.ok)
        self.assertIn("未配置", result.error or "")

    def test_custom_command_adapter_runs_command_against_targets(self):
        adapter = CustomCommandAdapter(["echo", "FLAG{test_flag_001}"])
        adapter.configure(self.ctx)
        result = adapter.run()
        self.assertTrue(result.ok)
        self.assertGreater(len(result.actions), 0)
        self.assertIn("FLAG{test_flag_001}", result.flags_captured)

    def test_custom_command_adapter_submits_flags(self):
        submitted: list[tuple[str, str]] = []

        def submit(flag: str, target_url: str) -> dict:
            submitted.append((flag, target_url))
            return {"ok": True}

        adapter = CustomCommandAdapter(["echo", "FLAG{submit_test}"])
        adapter.configure(self.ctx)
        result = adapter.run(submit=submit)
        self.assertEqual(len(submitted), 1)
        self.assertEqual(submitted[0][0], "FLAG{submit_test}")

    def test_agent_manager_configures_adapter(self):
        captured_ctx: list[AgentContext] = []

        class SpyAdapter(CustomCommandAdapter):
            def configure(self, ctx):
                captured_ctx.append(ctx)
                super().configure(ctx)

        adapter = SpyAdapter(["echo", "ok"])
        manager = AgentManager(adapter)
        manager.configure(
            {
                "match_id": "m1",
                "room_id": "r1",
                "team_id": "t1",
                "opponents": [],
                "local_target": {"base_url": "http://127.0.0.1:18081"},
                "allowed_targets": ["http://127.0.0.1:18081"],
                "target_template_id": "real_ctf_web_awd_01",
            },
            "ATTACK",
        )
        self.assertEqual(len(captured_ctx), 1)
        self.assertEqual(captured_ctx[0].match_id, "m1")

    def test_agent_manager_running_flag(self):
        adapter = CustomCommandAdapter(["sleep", "0.1"])
        adapter.configure(self.ctx)
        manager = AgentManager(adapter)
        self.assertFalse(manager.running)
        manager.run_attack()
        self.assertFalse(manager.running)

    def test_agent_manager_stores_last_result(self):
        adapter = CustomCommandAdapter(["echo", "FLAG{last_test}"])
        adapter.configure(self.ctx)
        manager = AgentManager(adapter)
        self.assertIsNone(manager.last_result)
        manager.run_attack()
        self.assertIsNotNone(manager.last_result)
        self.assertTrue(manager.last_result.ok)

    def test_sanitize_command_rejects_shell_tokens(self):
        self.assertFalse(sanitize_command(["ls;", "rm"]))
        self.assertFalse(sanitize_command(["echo", "&&", "ls"]))
        self.assertFalse(sanitize_command(["cat", "file", "|", "grep"]))

    def test_sanitize_command_rejects_background_operator(self):
        self.assertFalse(sanitize_command(["sleep", "10", "&"]))
        self.assertFalse(sanitize_command(["sleep", "10", "&", "ls"]))
        self.assertFalse(sanitize_command(["cmd", "&"]))

    def test_sanitize_command_rejects_ampersand_as_token(self):
        self.assertFalse(sanitize_command(["cmd1", "&", "cmd2"]))

    def test_sanitize_command_accepts_safe_argv(self):
        self.assertTrue(sanitize_command(["docker", "compose", "up", "-d"]))
        self.assertTrue(sanitize_command(["curl", "http://127.0.0.1:18081"]))
        self.assertTrue(sanitize_command(["python3", "-c", "print(1)"]))
