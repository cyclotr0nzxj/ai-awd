"""ScopeGuard — client-side safety boundary for AI-AWD agent operations.

Enforces:
- Network scope: only room-scoped allowed_targets (localhost-only)
- File scope: agent file access restricted to project root
- Process scope: no shell injection, timeout enforcement, env allowlist
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
SHELL_DANGEROUS = {";", "&&", "||", "|", "`", "$(", "${", "\n", "\r", ">", "<", "&"}
ALLOWED_ENV_KEYS = {
    "AIAWD_MATCH_ID", "AIAWD_ROOM_ID", "AIAWD_TEAM_ID", "AIAWD_PHASE",
    "AIAWD_TARGETS", "AIAWD_LOCAL_TARGET", "AIAWD_ALLOWED_TARGETS",
    "AIAWD_TARGET_TEMPLATE", "AIAWD_FLAG", "AIAWD_HTTP_PORT",
    "PATH", "HOME", "USER", "TMPDIR", "TEMP", "LANG", "LC_ALL",
    "PYTHONPATH", "PYTHONUNBUFFERED",
}


@dataclass(slots=True)
class GuardViolation:
    rule: str
    message: str
    detail: str = ""


@dataclass(slots=True)
class GuardResult:
    allowed: bool
    violations: list[GuardViolation] = field(default_factory=list)

    def reject(self, rule: str, message: str, detail: str = "") -> GuardResult:
        self.allowed = False
        self.violations.append(GuardViolation(rule=rule, message=message, detail=detail))
        return self


class ScopeGuard:
    def __init__(self, *, root: Path | None = None) -> None:
        self.root = (root or Path.cwd()).resolve()
        self._audit: list[GuardResult] = []

    @property
    def audit_log(self) -> list[GuardResult]:
        return list(self._audit)

    # -- network --

    def validate_target_url(self, url: str, *, allowed_targets: list[str] | None = None) -> GuardResult:
        result = GuardResult(allowed=True)
        parsed = urlparse(url)
        if parsed.hostname not in LOCAL_HOSTS:
            result = result.reject("NETWORK_SCOPE", "靶机只能位于本机地址", url)
        if url not in (allowed_targets or []):
            result = result.reject("NETWORK_SCOPE", "目标不在允许列表内", url)
        self._audit.append(result)
        return result

    def validate_all_targets(self, urls: list[str], *, allowed_targets: list[str]) -> GuardResult:
        result = GuardResult(allowed=True)
        for url in urls:
            url_result = self.validate_target_url(url, allowed_targets=allowed_targets)
            if not url_result.allowed:
                result.allowed = False
                result.violations.extend(url_result.violations)
        return result

    # -- files --

    def validate_path(self, file_path: str | Path, *, must_exist: bool = False) -> GuardResult:
        result = GuardResult(allowed=True)
        try:
            resolved = Path(file_path).resolve()
            resolved.relative_to(self.root)
        except ValueError:
            result = result.reject("FILE_SCOPE", "文件路径必须位于项目目录内", str(file_path))
        if must_exist and not resolved.exists():
            result = result.reject("FILE_SCOPE", "文件不存在", str(file_path))
        self._audit.append(result)
        return result

    # -- process --

    def validate_command(self, argv: list[str]) -> GuardResult:
        result = GuardResult(allowed=True)
        for token in argv:
            if token in SHELL_DANGEROUS:
                result = result.reject("PROCESS_SAFE", "命令不能包含 shell 控制符", token)
            for char in token:
                if char in {"`", "$", "\n", "\r"}:
                    result = result.reject("PROCESS_SAFE", "命令包含危险字符", token)
                    break
            if "$(" in token or "${" in token:
                result = result.reject("PROCESS_SAFE", "命令包含变量展开", token)
        self._audit.append(result)
        return result

    def validate_env(self, env: dict[str, str]) -> GuardResult:
        result = GuardResult(allowed=True)
        for key in env:
            if key not in ALLOWED_ENV_KEYS and not key.startswith("AIAWD_"):
                result = result.reject("ENV_SCOPE", "环境变量不在允许列表内", key)
        self._audit.append(result)
        return result

    def validate_timeout(self, timeout_sec: float, *, max_sec: float = 600) -> GuardResult:
        result = GuardResult(allowed=True)
        if timeout_sec <= 0 or timeout_sec > max_sec:
            result = result.reject("TIMEOUT_SCOPE", f"超时必须在 1-{int(max_sec)} 秒之间", str(timeout_sec))
        self._audit.append(result)
        return result

    # -- composite --

    def guard_agent_run(
        self,
        *,
        command: list[str],
        targets: list[str],
        allowed_targets: list[str],
        cwd: str | Path,
        env: dict[str, str],
        timeout_sec: float,
    ) -> GuardResult:
        results = [
            self.validate_command(command),
            self.validate_all_targets(targets, allowed_targets=allowed_targets),
            self.validate_path(cwd, must_exist=True),
            self.validate_env(env),
            self.validate_timeout(timeout_sec),
        ]
        violations: list[GuardViolation] = []
        for r in results:
            violations.extend(r.violations)
        return GuardResult(allowed=all(r.allowed for r in results), violations=violations)

    # -- report --

    def security_summary(self) -> dict[str, Any]:
        total = len(self._audit)
        blocked = sum(1 for r in self._audit if not r.allowed)
        violations_by_rule: dict[str, int] = {}
        for r in self._audit:
            if not r.allowed:
                for v in r.violations:
                    violations_by_rule[v.rule] = violations_by_rule.get(v.rule, 0) + 1
        return {
            "total_checks": total,
            "blocked": blocked,
            "allowed": total - blocked,
            "violations_by_rule": violations_by_rule,
        }
