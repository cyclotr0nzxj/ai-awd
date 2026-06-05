from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

from tui.agent_runtime import (
    FLAG_PATTERN,
    AgentAction,
    AgentAdapter,
    AgentContext,
    AgentResult,
    FlagSubmitter,
    _default_extract_flags,
    _expand_template,
    sanitize_command,
)


class BaseCLIAdapter(AgentAdapter):
    """Adapter that runs a CLI tool against opponent targets.

    Subclasses define the command template, env setup, and flag extraction.
    """

    def __init__(
        self,
        *,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int = 300,
        extract_flags: Callable[[str], list[str]] | None = None,
    ) -> None:
        self._cwd = cwd or Path.cwd()
        self._extra_env = env or {}
        self._timeout = timeout_sec
        self._extract_flags = extract_flags or _default_extract_flags
        self._ctx: AgentContext | None = None
        self._process: subprocess.Popen[bytes] | None = None

    @property
    def command_template(self) -> list[str]:
        raise NotImplementedError

    @property
    def adapter_name(self) -> str:
        raise NotImplementedError

    def configure(self, ctx: AgentContext) -> None:
        self._ctx = ctx
        self._timeout = ctx.timeout_sec or self._timeout

    def run(self, *, submit: FlagSubmitter | None = None) -> AgentResult:
        if self._ctx is None:
            return AgentResult(ok=False, error=f"{self.adapter_name} 未配置比赛上下文")
        started = time.time()
        actions: list[AgentAction] = []
        captured: list[str] = []
        for target in self._ctx.targets:
            url = target.get("base_url", "")
            if not url:
                continue
            action = self._attack_target(url, submit=submit)
            actions.append(action)
            if action.flag:
                captured.append(action.flag)
            if not action.ok:
                break
        return AgentResult(
            ok=all(a.ok for a in actions),
            actions=actions,
            flags_captured=captured,
            elapsed_ms=int((time.time() - started) * 1000),
        )

    def stop(self) -> None:
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait()

    def _attack_target(self, target_url: str, *, submit: FlagSubmitter | None) -> AgentAction:
        argv = _expand_template(self.command_template, target_url=target_url, ctx=self._ctx)
        if not sanitize_command(argv):
            return AgentAction(
                timestamp=time.time(), action="attack", target_url=target_url,
                flag=None, output="", ok=False,
            )
        env = {**os.environ, **(self._ctx.env() if self._ctx else {}), **self._extra_env}
        started = time.time()
        try:
            proc = subprocess.run(
                argv, cwd=self._cwd, env=env, capture_output=True, text=True,
                timeout=self._timeout, check=False, shell=False,
            )
        except subprocess.TimeoutExpired:
            return AgentAction(
                timestamp=started, action="attack", target_url=target_url,
                flag=None, output="", ok=False,
            )
        output = (proc.stdout or "") + (proc.stderr or "")
        flags = self._extract_flags(output)
        for flag in flags:
            if submit:
                submit(flag, target_url)
        return AgentAction(
            timestamp=started, action="attack", target_url=target_url,
            flag=flags[0] if flags else None, output=output, ok=True,
        )


class HermesAdapter(BaseCLIAdapter):
    """Adapter for the Hermes AI agent CLI (NousResearch/hermes-agent).

    Uses: hermes -z "prompt" --yolo for non-interactive security testing.

    Hermes v0.15.2 has 47+ built-in tools including web_search, browser_navigate,
    terminal, and supply-chain security scanning.

    Installed via: pip install hermes-agent
    """

    adapter_name = "Hermes"

    def __init__(
        self,
        *,
        hermes_bin: str = "hermes",
        model: str = "",
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int = 600,
    ) -> None:
        super().__init__(cwd=cwd, env=env, timeout_sec=timeout_sec)
        self._hermes_bin = hermes_bin
        self._model = model

    @property
    def command_template(self) -> list[str]:
        prompt = (
            f"You are an AWD CTF security agent. Target: {{target_url}}. "
            f"Find and report any FLAG{{{{...}}}} you discover. "
            f"Use web tools to probe the target for vulnerabilities."
        )
        cmd = [self._hermes_bin, "-z", prompt, "--yolo"]
        if self._model:
            cmd.extend(["-m", self._model])
        return cmd


class OpenClawAdapter(BaseCLIAdapter):
    """Adapter for the OpenClaw agent CLI.

    Uses: openclaw infer model run --local --json --model MODEL --prompt PROMPT

    The prompt includes the target URL and asks the agent to find flags.
    Match context is provided via AIAWD_* environment variables.
    """

    adapter_name = "OpenClaw"

    def __init__(
        self,
        *,
        openclaw_bin: str = "openclaw",
        model: str = "",
        prompt_template: str = "",
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int = 600,
    ) -> None:
        super().__init__(cwd=cwd, env=env, timeout_sec=timeout_sec)
        self._openclaw_bin = openclaw_bin
        self._model = model
        self._prompt_template = prompt_template or (
            "You are an AWD (Attack-Defense) CTF agent. "
            "Find the FLAG at target {target_url}. "
            "Analyze the target, identify vulnerabilities, and output any FLAG{{...}} you find."
        )

    @property
    def command_template(self) -> list[str]:
        cmd = [
            self._openclaw_bin, "infer", "model", "run",
            "--local", "--json",
            "--prompt", self._prompt_template,
        ]
        if self._model:
            cmd.extend(["--model", self._model])
        return cmd


class PiAdapter(BaseCLIAdapter):
    """Adapter for the Pi AI coding agent (badlogic/pi-mono).

    Uses: pi --print --mode json --system-prompt "..." "Find flags at {target_url}"

    Pi v0.73.1 has read, bash, edit, write tools for autonomous coding.
    Installed via: npm install -g @mariozechner/pi-coding-agent
    """

    adapter_name = "Pi"

    def __init__(
        self,
        *,
        pi_bin: str = "pi",
        model: str = "",
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int = 600,
    ) -> None:
        super().__init__(cwd=cwd, env=env, timeout_sec=timeout_sec)
        self._pi_bin = pi_bin
        self._model = model

    @property
    def command_template(self) -> list[str]:
        system_prompt = (
            f"You are an AWD CTF security agent. "
            f"Use your read and bash tools to probe the target for vulnerabilities. "
            f"Report any FLAG{{{{...}}}} you discover."
        )
        user_prompt = f"Find vulnerabilities at {{target_url}} and report any FLAG{{{{...}}}} patterns you find."
        cmd = [
            self._pi_bin, "--print", "--mode", "json",
            "--system-prompt", system_prompt,
            user_prompt,
        ]
        if self._model:
            cmd.insert(1, "--model")
            cmd.insert(2, self._model)
        return cmd


class CustomPythonAdapter(BaseCLIAdapter):
    """Adapter that runs a custom Python script as an agent.

    The script receives match context via AIAWD_* env vars and the target URL
    as a positional argument. The script should output flags to stdout.
    """

    adapter_name = "CustomPython"

    def __init__(
        self,
        script_path: str | Path,
        *,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int = 600,
    ) -> None:
        super().__init__(cwd=cwd, env=env, timeout_sec=timeout_sec)
        self._script_path = str(script_path)

    @property
    def command_template(self) -> list[str]:
        return ["python3", self._script_path, "{target_url}"]


class OpenCLIAdapter(BaseCLIAdapter):
    """Adapter for OpenCLI — browser-driving agent.

    Uses `opencli browser open {target_url}` to navigate, then
    `opencli browser extract` to get page content as markdown.
    Flags are extracted from the page content.

    OpenCLI is installed at /usr/local/bin/opencli (v1.7.18).
    """

    adapter_name = "OpenCLI"

    def __init__(
        self,
        *,
        opencli_bin: str = "opencli",
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int = 600,
    ) -> None:
        super().__init__(cwd=cwd, env=env, timeout_sec=timeout_sec)
        self._opencli_bin = opencli_bin

    @property
    def command_template(self) -> list[str]:
        return [self._opencli_bin, "browser", "extract"]

    def _attack_target(self, target_url: str, *, submit: FlagSubmitter | None) -> AgentAction:
        import subprocess, os as _os, time as _time
        env = {**_os.environ, **(self._ctx.env() if self._ctx else {}), **self._extra_env}
        started = _time.time()
        try:
            subprocess.run(
                [self._opencli_bin, "browser", "open", target_url],
                cwd=self._cwd, env=env, capture_output=True, text=True,
                timeout=30, check=False, shell=False,
            )
            proc = subprocess.run(
                self.command_template,
                cwd=self._cwd, env=env, capture_output=True, text=True,
                timeout=self._timeout, check=False, shell=False,
            )
        except subprocess.TimeoutExpired:
            return AgentAction(timestamp=started, action="attack", target_url=target_url, flag=None, output="", ok=False)
        output = (proc.stdout or "") + (proc.stderr or "")
        flags = self._extract_flags(output)
        for flag in flags:
            if submit:
                submit(flag, target_url)
        return AgentAction(timestamp=started, action="attack", target_url=target_url, flag=flags[0] if flags else None, output=output, ok=True)


class BasicHTTPAgentAdapter(BaseCLIAdapter):
    """Built-in HTTP reconnaissance agent — zero external dependencies.

    Uses the bundled basic_http_agent.py script to probe target URLs
    for flags via common HTTP paths and methods. Works out of the box.
    """

    adapter_name = "BasicHTTP"

    def __init__(
        self,
        *,
        script_path: str | Path | None = None,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int = 300,
    ) -> None:
        super().__init__(cwd=cwd, env=env, timeout_sec=timeout_sec)
        if script_path is None:
            script_path = Path(__file__).resolve().parents[1] / "examples" / "basic_http_agent.py"
        self._script_path = str(script_path)

    @property
    def command_template(self) -> list[str]:
        return ["python3", self._script_path, "{target_url}"]


class CodexAdapter(BaseCLIAdapter):
    """Adapter for OpenAI Codex CLI agent.

    Uses `codex exec --json <PROMPT>` to run an AI agent against a target URL.
    The prompt instructs Codex to find vulnerabilities and report flags.

    Codex is installed at /usr/local/bin/codex (v0.135.0).
    """

    adapter_name = "Codex"

    def __init__(
        self,
        *,
        codex_bin: str = "codex",
        prompt_template: str = "",
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int = 600,
    ) -> None:
        super().__init__(cwd=cwd, env=env, timeout_sec=timeout_sec)
        self._codex_bin = codex_bin
        self._prompt_template = prompt_template or (
            "You are an AWD CTF agent. Target: {target_url}. "
            "Find vulnerabilities in the web application at this URL. "
            "If you find a flag (format FLAG{{...}}), report it exactly. "
            "The target is on localhost and room-scoped."
        )

    @property
    def command_template(self) -> list[str]:
        return [self._codex_bin, "exec", "--json", self._prompt_template]


# ---- discovery ----

def adapter_for(
    identifier: str,
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    timeout_sec: int = 600,
    **kwargs: Any,
) -> AgentAdapter:
    """Return an AgentAdapter for the given runtime identifier.

    Supported identifiers:
      - "basic" / "basic-http" / "http" → BasicHTTPAgentAdapter (built-in, zero deps)
      - "hermes" / "hermes-local" → HermesAdapter
      - "openclaw" / "openclaw-local" → OpenClawAdapter (verified with real CLI)
      - "opencli" / "browser" → OpenCLIAdapter (verified with real CLI v1.7.18)
      - "codex" / "codex-local" → CodexAdapter (verified with real CLI v0.135.0)
      - "pi" / "pi-local" → PiAdapter
      - "custom-python:path/to/script.py" → CustomPythonAdapter
      - "tui-agent" / "mock-agent" / anything with a CLI command → CustomCommandAdapter
    """
    key = identifier.lower().strip()

    if key in {"basic", "basic-http", "http"}:
        return BasicHTTPAgentAdapter(cwd=cwd, env=env, timeout_sec=timeout_sec)

    if key in {"hermes", "hermes-local"}:
        return HermesAdapter(
            hermes_bin=str(kwargs.pop("hermes_bin", "hermes")),
            model=str(kwargs.pop("model", "")),
            cwd=cwd, env=env, timeout_sec=timeout_sec,
        )

    if key in {"openclaw", "openclaw-local"}:
        return OpenClawAdapter(
            openclaw_bin=str(kwargs.pop("openclaw_bin", "openclaw")),
            model=str(kwargs.pop("model", "")),
            cwd=cwd, env=env, timeout_sec=timeout_sec,
        )

    if key in {"opencli", "opencli-local", "browser"}:
        return OpenCLIAdapter(
            opencli_bin=str(kwargs.pop("opencli_bin", "opencli")),
            cwd=cwd, env=env, timeout_sec=timeout_sec,
        )

    if key in {"codex", "codex-local"}:
        return CodexAdapter(
            codex_bin=str(kwargs.pop("codex_bin", "codex")),
            cwd=cwd, env=env, timeout_sec=timeout_sec,
        )

    if key in {"pi", "pi-local"}:
        return PiAdapter(
            pi_bin=str(kwargs.pop("pi_bin", "pi")),
            model=str(kwargs.pop("model", "")),
            cwd=cwd, env=env, timeout_sec=timeout_sec,
        )

    if key.startswith("custom-python:") or key.startswith("script:"):
        script_path = key.split(":", 1)[1]
        return CustomPythonAdapter(
            script_path=script_path, cwd=cwd, env=env, timeout_sec=timeout_sec,
        )

    # Fallback: treat as a custom CLI command
    from tui.agent_runtime import CustomCommandAdapter
    command = identifier.strip().split()
    if not command:
        command = ["echo", "No agent command configured"]
    return CustomCommandAdapter(command, cwd=cwd, env=env, timeout_sec=timeout_sec)


def detect_available_adapters() -> dict[str, bool]:
    """Check which agent runtimes are available on the local PATH."""
    return {
        "hermes": shutil.which("hermes") is not None,
        "openclaw": shutil.which("openclaw") is not None,
        "opencli": shutil.which("opencli") is not None,
        "codex": shutil.which("codex") is not None,
        "pi": shutil.which("pi") is not None,
        "python3": shutil.which("python3") is not None,
    }
