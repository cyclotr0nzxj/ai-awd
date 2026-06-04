from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
SAFE_PROJECT = re.compile(r"^[A-Za-z0-9_-]+$")
SHELL_TOKENS = {";", "&&", "||", "|", ">", "<", "`"}
ALLOWED_ENV = {"AIAWD_ROOM_ID", "AIAWD_TEAM_ID", "AIAWD_HTTP_PORT", "AIAWD_FLAG"}
ACTION_LABELS = {
    "doctor": "诊断",
    "install": "安装",
    "start": "启动",
    "health": "巡检",
    "stop": "停止",
    "reset": "重置",
}
EXPECTED_STEPS = {
    "install": [["build"]],
    "start": [["up", "-d"]],
    "stop": [["down"]],
    "reset": [["down", "-v"], ["up", "-d"]],
}


class TargetLifecycleError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def normalize_target_action(action: str) -> str:
    aliases = {
        "doctor": "doctor",
        "status": "doctor",
        "检查": "doctor",
        "诊断": "doctor",
        "install": "install",
        "安装": "install",
        "start": "start",
        "启动": "start",
        "up": "start",
        "health": "health",
        "check": "health",
        "巡检": "health",
        "stop": "stop",
        "停止": "stop",
        "down": "stop",
        "reset": "reset",
        "重置": "reset",
    }
    normalized = aliases.get(action.strip().lower()) or aliases.get(action.strip())
    if not normalized:
        raise TargetLifecycleError("BAD_ACTION", "未知本地靶机动作")
    return normalized


def target_action_label(action: str) -> str:
    return ACTION_LABELS.get(action, action)


def run_local_target_action(
    config: dict[str, Any],
    action: str,
    *,
    runner: Callable[..., Any] = subprocess.run,
    opener: Callable[..., Any] = urlopen,
    root: Path = ROOT,
) -> dict[str, Any]:
    action = normalize_target_action(action)
    runtime = validate_runtime(config.get("target_runtime") or {}, root=root)
    if action == "doctor":
        checks = check_docker_availability(runtime, runner=runner, root=root)
        ok = all(check["ok"] for check in checks)
        return {
            "ok": ok,
            "action": action,
            "label": target_action_label(action),
            "project_name": runtime["project_name"],
            "checks": checks,
            "message": "本地靶机诊断通过" if ok else "本地靶机诊断发现问题",
        }
    if action == "health":
        ok = check_health(runtime, opener=opener)
        return {
            "ok": ok,
            "action": action,
            "label": target_action_label(action),
            "health_url": runtime["health_url"],
            "message": "本地靶机健康检查通过" if ok else "本地靶机健康检查未通过",
        }

    command = validate_command(runtime, action, root=root)
    env = {**os.environ, **command["env"]}
    if config.get("flag"):
        env["AIAWD_FLAG"] = str(config["flag"])
    steps = []
    for argv in command["argv"]:
        try:
            result = runner(argv, cwd=command["cwd"], env=env, check=True, shell=False)
        except subprocess.CalledProcessError as exc:
            raise TargetLifecycleError("COMMAND_FAILED", f"{target_action_label(action)}失败：{argv}") from exc
        steps.append({"command": " ".join(argv), "returncode": int(getattr(result, "returncode", 0) or 0)})
    return {
        "ok": True,
        "action": action,
        "label": target_action_label(action),
        "project_name": runtime["project_name"],
        "steps": steps,
        "message": f"本地靶机{target_action_label(action)}完成",
    }


def validate_runtime(runtime: dict[str, Any], *, root: Path = ROOT) -> dict[str, Any]:
    if not isinstance(runtime, dict):
        raise TargetLifecycleError("BAD_RUNTIME", "缺少本地靶机运行计划")
    project_name = _string_field(runtime, "project_name")
    if not SAFE_PROJECT.match(project_name):
        raise TargetLifecycleError("BAD_PROJECT", "本地靶机项目名不合法")
    validate_local_health_url(_string_field(runtime, "health_url"))
    commands = runtime.get("commands")
    if not isinstance(commands, dict):
        raise TargetLifecycleError("BAD_RUNTIME", "运行计划缺少命令列表")
    return runtime


def validate_command(runtime: dict[str, Any], action: str, *, root: Path = ROOT) -> dict[str, Any]:
    command = runtime.get("commands", {}).get(action)
    if not isinstance(command, dict):
        raise TargetLifecycleError("MISSING_COMMAND", f"运行计划缺少{target_action_label(action)}命令")
    argv_list = command.get("argv")
    if not isinstance(argv_list, list) or not argv_list:
        raise TargetLifecycleError("BAD_COMMAND", "命令必须是非空 argv 列表")
    cwd = _path_inside_root(_string_field(command, "cwd"), root, "cwd")
    expected_steps = EXPECTED_STEPS.get(action) or []
    if len(argv_list) != len(expected_steps):
        raise TargetLifecycleError("BAD_COMMAND", f"{target_action_label(action)}命令步骤数量不匹配")
    argv = [
        _validate_compose_argv(item, runtime["project_name"], cwd, expected_steps[index], root)
        for index, item in enumerate(argv_list)
    ]
    return {
        "argv": argv,
        "cwd": cwd,
        "env": _validate_env(command.get("env") or {}),
    }


def check_docker_availability(
    runtime: dict[str, Any],
    *,
    runner: Callable[..., Any] = subprocess.run,
    root: Path = ROOT,
) -> list[dict[str, Any]]:
    for action in ("install", "start", "stop", "reset"):
        validate_command(runtime, action, root=root)
    checks = [
        ("Docker CLI", ["docker", "--version"]),
        ("Docker Compose", ["docker", "compose", "version"]),
        ("Docker daemon", ["docker", "info"]),
    ]
    return [_run_doctor_check(label, argv, runner) for label, argv in checks]


def check_health(runtime: dict[str, Any], *, opener: Callable[..., Any] = urlopen) -> bool:
    health_url = validate_local_health_url(runtime["health_url"])
    response = opener(health_url, timeout=5)
    return 200 <= int(getattr(response, "status", 200)) < 300


def validate_local_health_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in LOCAL_HOSTS:
        raise TargetLifecycleError("OUT_OF_SCOPE_HEALTHCHECK", "健康检查只能访问本机 HTTP 靶机")
    return value


def format_target_action_result(result: dict[str, Any]) -> str:
    if result["action"] == "doctor":
        checks = "；".join(
            f"{check['label']} {'OK' if check['ok'] else '失败'}" for check in result.get("checks", [])
        )
        return f"{result['message']}：{checks}"
    if result["action"] == "health":
        return f"{result['message']}：{result.get('health_url', '-')}"
    return f"{result['message']}：{result.get('project_name', '-')} · {len(result.get('steps', []))} 步"


def _validate_compose_argv(
    argv: Any,
    project_name: str,
    cwd: Path,
    expected_step: list[str],
    root: Path,
) -> list[str]:
    if not isinstance(argv, list) or any(not isinstance(token, str) or not token for token in argv):
        raise TargetLifecycleError("BAD_COMMAND", "Docker 命令必须使用字符串 argv")
    for token in argv:
        if token in SHELL_TOKENS or "\n" in token or "\r" in token:
            raise TargetLifecycleError("UNSAFE_COMMAND", "Docker 命令不能包含 shell 控制符")
    if len(argv) < 7 or argv[0:3] != ["docker", "compose", "-p"] or argv[4] != "-f":
        raise TargetLifecycleError("BAD_COMMAND", "仅允许 docker compose argv 命令")
    if argv[3] != project_name:
        raise TargetLifecycleError("BAD_PROJECT", "Docker compose 项目名与运行计划不一致")
    compose_file = _path_inside_root(argv[5], root, "compose_file")
    if compose_file.parent != cwd:
        raise TargetLifecycleError("BAD_COMMAND", "compose 文件目录必须等于命令 cwd")
    step = argv[6:]
    if step != expected_step:
        raise TargetLifecycleError("UNSAFE_COMMAND", "Docker compose 子命令不在允许列表内")
    return [*argv[:5], str(compose_file), *step]


def _run_doctor_check(label: str, argv: list[str], runner: Callable[..., Any]) -> dict[str, Any]:
    try:
        result = runner(argv, check=True, shell=False)
    except FileNotFoundError:
        return {"label": label, "ok": False, "returncode": None}
    except subprocess.CalledProcessError as exc:
        return {"label": label, "ok": False, "returncode": int(exc.returncode)}
    return {"label": label, "ok": True, "returncode": int(getattr(result, "returncode", 0) or 0)}


def _validate_env(env: Any) -> dict[str, str]:
    if not isinstance(env, dict):
        raise TargetLifecycleError("BAD_ENV", "命令环境变量必须是对象")
    result = {}
    for key, value in env.items():
        if key not in ALLOWED_ENV:
            raise TargetLifecycleError("BAD_ENV", "命令环境变量包含未授权键")
        result[key] = str(value)
    return result


def _path_inside_root(value: str, root: Path, label: str) -> Path:
    resolved = Path(value).resolve()
    root = root.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise TargetLifecycleError("OUT_OF_SCOPE_PATH", f"{label} 必须位于项目目录内") from exc
    return resolved


def _string_field(value: dict[str, Any], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item.strip():
        raise TargetLifecycleError("BAD_RUNTIME", f"运行计划缺少 {key}")
    return item
