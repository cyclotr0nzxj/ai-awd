from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse
from urllib.request import urlopen

from .target_registry import TargetTemplate


LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class TargetRuntimeError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class TargetCommand:
    name: str
    argv: list[list[str]]
    cwd: Path
    env: dict[str, str]

    def public_snapshot(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "argv": self.argv,
            "cwd": str(self.cwd),
            "env": {key: ("FLAG{已隐藏}" if key == "AIAWD_FLAG" else value) for key, value in self.env.items()},
        }


@dataclass(frozen=True, slots=True)
class TargetInstance:
    template_id: str
    room_id: str
    team_id: str
    project_name: str
    compose_file: Path
    base_url: str
    health_url: str
    env: dict[str, str]
    commands: dict[str, TargetCommand]

    def public_snapshot(self) -> dict[str, Any]:
        return {
            "template_id": self.template_id,
            "room_id": self.room_id,
            "team_id": self.team_id,
            "project_name": self.project_name,
            "compose_file": str(self.compose_file),
            "base_url": self.base_url,
            "health_url": self.health_url,
            "commands": {name: command.public_snapshot() for name, command in self.commands.items()},
        }


class TargetRuntime:
    def __init__(self, *, root: Path | None = None) -> None:
        self.root = (root or Path.cwd()).resolve()

    def plan_instance(
        self,
        template: TargetTemplate,
        *,
        room_id: str,
        team_id: str,
        flag: str,
        host: str = "127.0.0.1",
        port: int,
    ) -> TargetInstance:
        self._validate_template(template)
        self._validate_id("room_id", room_id)
        self._validate_id("team_id", team_id)
        if host not in LOCAL_HOSTS:
            raise TargetRuntimeError("OUT_OF_SCOPE_HOST", "靶机只能绑定本机地址")
        if port <= 0 or port > 65535:
            raise TargetRuntimeError("BAD_PORT", "靶机端口不合法")

        manifest = template.manifest_snapshot()
        compose = manifest["compose"]
        compose_file = (self.root / compose["file"]).resolve()
        try:
            compose_file.relative_to(self.root)
        except ValueError as exc:
            raise TargetRuntimeError("BAD_COMPOSE", "compose 文件必须位于项目目录内") from exc
        if not compose_file.exists():
            raise TargetRuntimeError("MISSING_COMPOSE", "compose 文件不存在")
        project_name = f"{compose.get('project_prefix', 'aiawd')}_{room_id}_{team_id}"
        base_url = f"http://{host}:{port}"
        health_path = manifest["healthcheck"]["path"]
        health_url = f"{base_url}{health_path}"
        env = {
            "AIAWD_ROOM_ID": room_id,
            "AIAWD_TEAM_ID": team_id,
            "AIAWD_HTTP_PORT": str(port),
            "AIAWD_FLAG": flag,
        }
        command_specs = {
            "install": [["build"]],
            "start": [["up", "-d"]],
            "stop": [["down"]],
            "reset": [["down", "-v"], ["up", "-d"]],
        }
        commands = {
            name: TargetCommand(
                name=name,
                argv=self._compose_argv(project_name, compose_file, steps),
                cwd=compose_file.parent,
                env=env,
            )
            for name, steps in command_specs.items()
        }
        return TargetInstance(
            template_id=template.template_id,
            room_id=room_id,
            team_id=team_id,
            project_name=project_name,
            compose_file=compose_file,
            base_url=base_url,
            health_url=health_url,
            env=env,
            commands=commands,
        )

    def run(self, command: TargetCommand, *, runner: Callable[..., Any] = subprocess.run) -> Any:
        results = []
        env = {**os.environ, **command.env}
        for argv in command.argv:
            for token in argv:
                if token in {";", "&&", "||", "|"}:
                    raise TargetRuntimeError("UNSAFE_COMMAND", "Docker 命令必须使用 argv 列表，不能包含 shell 控制符")
            results.append(runner(argv, cwd=command.cwd, env=env, check=True, shell=False))
        return results

    def check_health(self, instance: TargetInstance, *, opener: Callable[..., Any] = urlopen, timeout: float | None = None) -> bool:
        parsed = urlparse(instance.health_url)
        if parsed.scheme != "http" or parsed.hostname not in LOCAL_HOSTS:
            raise TargetRuntimeError("OUT_OF_SCOPE_HEALTHCHECK", "健康检查只能访问本机 HTTP 靶机")
        response = opener(instance.health_url, timeout=timeout or 5)
        status = getattr(response, "status", 200)
        return 200 <= int(status) < 300

    def _compose_argv(self, project_name: str, compose_file: Path, steps: list[list[str]]) -> list[list[str]]:
        prefix = ["docker", "compose", "-p", project_name, "-f", str(compose_file)]
        return [[*prefix, *step] for step in steps]

    def _validate_template(self, template: TargetTemplate) -> None:
        manifest = template.manifest_snapshot()
        if template.runtime != "docker-compose" or manifest.get("runtime") != "docker-compose":
            raise TargetRuntimeError("UNSUPPORTED_RUNTIME", "当前仅支持 Docker Compose 靶机")
        security = manifest.get("security") or {}
        if security.get("no_public_targets") is not True or security.get("allowed_scope") != "room_only":
            raise TargetRuntimeError("UNSAFE_TARGET", "靶机必须声明 room_only 且禁止 public targets")
        healthcheck = manifest.get("healthcheck") or {}
        if healthcheck.get("type") != "http" or not str(healthcheck.get("path", "")).startswith("/"):
            raise TargetRuntimeError("BAD_HEALTHCHECK", "靶机必须声明本机 HTTP healthcheck path")
        compose = manifest.get("compose") or {}
        if not compose.get("file"):
            raise TargetRuntimeError("BAD_COMPOSE", "靶机缺少 compose 文件配置")

    def _validate_id(self, name: str, value: str) -> None:
        if not SAFE_ID.match(value):
            raise TargetRuntimeError("BAD_IDENTIFIER", f"{name} 只能包含字母、数字、下划线和短横线")
