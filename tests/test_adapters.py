from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import NamedTemporaryFile

from tui.adapters import (
    BasicHTTPAgentAdapter,
    CodexAdapter,
    CustomPythonAdapter,
    HermesAdapter,
    OpenCLIAdapter,
    OpenClawAdapter,
    PiAdapter,
    adapter_for,
    detect_available_adapters,
)
from tui.agent_runtime import AgentContext
from tui.agent_runtime import AgentContext


class AdapterFactoryTest(unittest.TestCase):
    def test_hermes_identifier_returns_hermes_adapter(self):
        adapter = adapter_for("hermes", timeout_sec=120)
        self.assertIsInstance(adapter, HermesAdapter)

    def test_openclaw_identifier_returns_openclaw_adapter(self):
        adapter = adapter_for("openclaw")
        self.assertIsInstance(adapter, OpenClawAdapter)

    def test_pi_identifier_returns_pi_adapter(self):
        adapter = adapter_for("pi")
        self.assertIsInstance(adapter, PiAdapter)

    def test_custom_python_identifier_returns_custom_python_adapter(self):
        adapter = adapter_for("custom-python:./agent.py")
        self.assertIsInstance(adapter, CustomPythonAdapter)
        self.assertIn("./agent.py", adapter.command_template)

    def test_basic_identifier_returns_basic_adapter(self):
        adapter = adapter_for("basic")
        self.assertIsInstance(adapter, BasicHTTPAgentAdapter)
        self.assertIn("basic_http_agent.py", adapter.command_template[1])

    def test_opencli_identifier_returns_opencli_adapter(self):
        adapter = adapter_for("opencli")
        self.assertIsInstance(adapter, OpenCLIAdapter)

    def test_codex_identifier_returns_codex_adapter(self):
        adapter = adapter_for("codex")
        self.assertIsInstance(adapter, CodexAdapter)

    def test_unknown_identifier_falls_back_to_custom_command(self):
        from tui.agent_runtime import CustomCommandAdapter
        adapter = adapter_for("echo FLAG{test}")
        self.assertIsInstance(adapter, CustomCommandAdapter)


class HermesAdapterTest(unittest.TestCase):
    def setUp(self):
        self.ctx = AgentContext(
            match_id="match_001", room_id="room_x", team_id="team_a",
            phase="ATTACK",
            targets=[{"team_id": "team_b", "base_url": "http://127.0.0.1:18082"}],
            local_target={"base_url": "http://127.0.0.1:18081"},
            allowed_targets=["http://127.0.0.1:18081", "http://127.0.0.1:18082"],
            target_template_id="real_ctf_web_awd_01",
        )

    def test_command_template_uses_dash_z_prompt(self):
        adapter = HermesAdapter(hermes_bin="hermes")
        adapter.configure(self.ctx)
        self.assertIn("-z", adapter.command_template)
        self.assertIn("--yolo", adapter.command_template)
        template_str = " ".join(adapter.command_template)
        self.assertIn("{target_url}", template_str)

    def test_model_flag_added(self):
        adapter = HermesAdapter(hermes_bin="hermes", model="claude-opus-4-8")
        self.assertIn("-m", adapter.command_template)
        self.assertIn("claude-opus-4-8", adapter.command_template)

    def test_runs_echo_as_hermes_simulating_flag_find(self):
        adapter = HermesAdapter(hermes_bin="echo")
        adapter.configure(self.ctx)
        result = adapter.run()
        self.assertTrue(result.ok)
        self.assertEqual(len(result.actions), 1)
        self.assertTrue(result.actions[0].ok)


class OpenClawAdapterTest(unittest.TestCase):
    def test_command_template_uses_infer_model_run(self):
        adapter = OpenClawAdapter(openclaw_bin="echo")
        template = adapter.command_template
        self.assertIn("infer", template)
        self.assertIn("model", template)
        self.assertIn("run", template)
        self.assertIn("--local", template)
        self.assertIn("--json", template)

    def test_model_flag_added_when_specified(self):
        adapter = OpenClawAdapter(openclaw_bin="echo", model="claude-sonnet-4-6")
        template = adapter.command_template
        self.assertIn("--model", template)
        self.assertIn("claude-sonnet-4-6", template)


class PiAdapterTest(unittest.TestCase):
    def test_command_template_uses_print_mode_json(self):
        adapter = PiAdapter(pi_bin="echo")
        self.assertIn("--print", adapter.command_template)
        self.assertIn("--mode", adapter.command_template)
        self.assertIn("json", adapter.command_template)
        template_str = " ".join(adapter.command_template)
        self.assertIn("{target_url}", template_str)

    def test_model_flag_added(self):
        adapter = PiAdapter(pi_bin="echo", model="claude-sonnet-4-6")
        self.assertIn("--model", adapter.command_template)
        self.assertIn("claude-sonnet-4-6", adapter.command_template)


class CustomPythonAdapterTest(unittest.TestCase):
    def test_runs_script_with_target_url(self):
        with NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write("import sys; print(f'FLAG{{script_capture}} for {sys.argv[1]}')")
            script_path = f.name

        try:
            ctx = AgentContext(
                match_id="match_001", room_id="room_x", team_id="team_a",
                phase="ATTACK",
                targets=[{"team_id": "team_b", "base_url": "http://127.0.0.1:18082"}],
                local_target={"base_url": "http://127.0.0.1:18081"},
                allowed_targets=["http://127.0.0.1:18081", "http://127.0.0.1:18082"],
                target_template_id="real_ctf_web_awd_01",
            )
            adapter = CustomPythonAdapter(script_path=script_path)
            adapter.configure(ctx)
            result = adapter.run()
            self.assertTrue(result.ok)
            self.assertIn("FLAG{script_capture}", result.flags_captured)
        finally:
            Path(script_path).unlink()


class OpenCLIAdapterTest(unittest.TestCase):
    def test_command_template_uses_browser_extract(self):
        adapter = OpenCLIAdapter(opencli_bin="echo")
        self.assertIn("browser", adapter.command_template)
        self.assertIn("extract", adapter.command_template)

    def test_runs_open_and_extract_via_echo(self):
        ctx = AgentContext(
            match_id="match_001", room_id="room_x", team_id="team_a",
            phase="ATTACK",
            targets=[{"team_id": "team_b", "base_url": "http://127.0.0.1:18082"}],
            local_target={"base_url": "http://127.0.0.1:18081"},
            allowed_targets=["http://127.0.0.1:18081", "http://127.0.0.1:18082"],
            target_template_id="real_ctf_web_awd_01",
        )
        adapter = OpenCLIAdapter(opencli_bin="echo")
        adapter.configure(ctx)
        result = adapter.run()
        self.assertTrue(result.ok)


class CodexAdapterTest(unittest.TestCase):
    def test_command_template_uses_codex_exec(self):
        adapter = CodexAdapter(codex_bin="echo")
        self.assertIn("exec", adapter.command_template)

    def test_prompt_includes_target_placeholder(self):
        adapter = CodexAdapter(codex_bin="echo")
        template_str = " ".join(adapter.command_template)
        self.assertIn("{target_url}", template_str)


class DetectAvailableAdaptersTest(unittest.TestCase):
    def test_returns_dict_with_expected_keys(self):
        available = detect_available_adapters()
        for key in ("hermes", "openclaw", "opencli", "codex", "pi", "python3"):
            self.assertIn(key, available)
