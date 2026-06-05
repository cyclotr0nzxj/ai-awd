from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol


FLAG_PATTERN = re.compile(r"FLAG\{[A-Za-z0-9_/-]+\}", re.IGNORECASE)
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


class FlagSubmitter(Protocol):
    def __call__(self, flag: str, target_url: str) -> dict[str, Any]: ...


@dataclass(slots=True)
class AgentContext:
    match_id: str
    room_id: str
    team_id: str
    phase: str
    targets: list[dict[str, Any]]
    local_target: dict[str, Any]
    allowed_targets: list[str]
    target_template_id: str
    timeout_sec: int = 300

    def env(self) -> dict[str, str]:
        return {
            "AIAWD_MATCH_ID": self.match_id,
            "AIAWD_ROOM_ID": self.room_id,
            "AIAWD_TEAM_ID": self.team_id,
            "AIAWD_PHASE": self.phase,
            "AIAWD_TARGETS": json_dumps([t["base_url"] for t in self.targets]),
            "AIAWD_LOCAL_TARGET": self.local_target.get("base_url", ""),
            "AIAWD_ALLOWED_TARGETS": json_dumps(self.allowed_targets),
            "AIAWD_TARGET_TEMPLATE": self.target_template_id,
        }


@dataclass(slots=True)
class AgentAction:
    timestamp: float
    action: str
    target_url: str | None
    flag: str | None
    output: str
    ok: bool


@dataclass(slots=True)
class AgentResult:
    ok: bool
    actions: list[AgentAction] = field(default_factory=list)
    flags_captured: list[str] = field(default_factory=list)
    error: str | None = None
    elapsed_ms: int = 0


class AgentAdapter(ABC):
    @abstractmethod
    def configure(self, ctx: AgentContext) -> None: ...

    @abstractmethod
    def run(self, *, submit: FlagSubmitter | None = None) -> AgentResult: ...

    @abstractmethod
    def stop(self) -> None: ...


class CustomCommandAdapter(AgentAdapter):
    def __init__(
        self,
        command: list[str],
        *,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        timeout_sec: int = 300,
        extract_flags: Callable[[str], list[str]] | None = None,
    ) -> None:
        self._command_template = command
        self._cwd = cwd or Path.cwd()
        self._extra_env = env or {}
        self._timeout = timeout_sec
        self._extract_flags = extract_flags or _default_extract_flags
        self._ctx: AgentContext | None = None
        self._process: subprocess.Popen[bytes] | None = None

    def configure(self, ctx: AgentContext) -> None:
        self._ctx = ctx
        self._timeout = ctx.timeout_sec

    def run(self, *, submit: FlagSubmitter | None = None) -> AgentResult:
        if self._ctx is None:
            return AgentResult(ok=False, error="Agent 未配置比赛上下文")
        started = time.time()
        actions: list[AgentAction] = []
        captured: list[str] = []
        targets = self._ctx.targets
        for target in targets:
            if not target:
                continue
            url = target.get("base_url", "")
            if not url:
                continue
            action = self._run_against(url, submit=submit)
            actions.append(action)
            if action.flag:
                captured.append(action.flag)
            if not action.ok:
                break
        elapsed = int((time.time() - started) * 1000)
        return AgentResult(
            ok=all(a.ok for a in actions),
            actions=actions,
            flags_captured=captured,
            elapsed_ms=elapsed,
        )

    def _run_against(self, target_url: str, *, submit: FlagSubmitter | None) -> AgentAction:
        argv = _expand_template(self._command_template, target_url=target_url, ctx=self._ctx)
        env = {**os.environ, **(self._ctx.env() if self._ctx else {}), **self._extra_env}
        started = time.time()
        try:
            proc = subprocess.run(
                argv,
                cwd=self._cwd,
                env=env,
                capture_output=True,
                text=True,
                timeout=self._timeout,
                check=False,
                shell=False,
            )
        except subprocess.TimeoutExpired:
            return AgentAction(
                timestamp=started,
                action="attack",
                target_url=target_url,
                flag=None,
                output="",
                ok=False,
            )
        output = (proc.stdout or "") + (proc.stderr or "")
        flags = self._extract_flags(output)
        for flag in flags:
            if submit:
                submit(flag, target_url)
        return AgentAction(
            timestamp=started,
            action="attack",
            target_url=target_url,
            flag=flags[0] if flags else None,
            output=output,
            ok=True,
        )

    def stop(self) -> None:
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait()


class AgentManager:
    def __init__(self, adapter: AgentAdapter) -> None:
        self.adapter = adapter
        self._results: list[AgentResult] = []
        self._running = False

    def configure(self, match_config: dict[str, Any], room_status: str) -> None:
        targets = match_config.get("opponents") or []
        ctx = AgentContext(
            match_id=match_config.get("match_id", ""),
            room_id=match_config.get("room_id", ""),
            team_id=match_config.get("team_id", ""),
            phase=room_status,
            targets=targets,
            local_target=match_config.get("local_target") or {},
            allowed_targets=match_config.get("allowed_targets") or [],
            target_template_id=match_config.get("target_template_id", ""),
        )
        self.adapter.configure(ctx)

    def run_attack(self, *, submit: FlagSubmitter | None = None) -> AgentResult:
        self._running = True
        result = self.adapter.run(submit=submit)
        self._results.append(result)
        self._running = False
        return result

    def stop(self) -> None:
        self.adapter.stop()
        self._running = False

    @property
    def running(self) -> bool:
        return self._running

    @property
    def last_result(self) -> AgentResult | None:
        return self._results[-1] if self._results else None


def _default_extract_flags(text: str) -> list[str]:
    return FLAG_PATTERN.findall(text)


def _expand_template(template: list[str], *, target_url: str, ctx: AgentContext | None) -> list[str]:
    replacements = {
        "{target_url}": target_url,
        "{local_target}": ctx.local_target.get("base_url", "") if ctx else "",
        "{match_id}": ctx.match_id if ctx else "",
        "{room_id}": ctx.room_id if ctx else "",
        "{team_id}": ctx.team_id if ctx else "",
    }
    result: list[str] = []
    for token in template:
        for placeholder, value in replacements.items():
            token = token.replace(placeholder, value)
        result.append(token)
    return result


def json_dumps(obj: Any) -> str:
    import json as _json

    return _json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def check_docker_available() -> bool:
    return shutil.which("docker") is not None


_SHELL_CONTROL = {";", "&", "&&", "||", "|"}
_SHELL_EXPANSION = ["$(", "${", "`"]
_SHELL_DANGEROUS = {";", "\n", "\r"}


def sanitize_command(command: list[str]) -> bool:
    for token in command:
        if token in _SHELL_CONTROL:
            return False
        for expansion in _SHELL_EXPANSION:
            if expansion in token:
                return False
        for char in token:
            if char in _SHELL_DANGEROUS:
                return False
    return True
