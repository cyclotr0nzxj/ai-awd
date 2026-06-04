from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
for path in (ROOT, SERVER):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from aiawd_server.target_registry import TargetRegistry
from aiawd_server.target_runtime import TargetCommand, TargetInstance, TargetRuntime, TargetRuntimeError


DEFAULT_LOG_DIR = ROOT / "logs" / "target_lifecycle"
DEFAULT_ROOM_ID = "room_evidence"
DEFAULT_TEAM_ID = "team_a"
DEFAULT_PORT = 18081
DEMO_FLAG = "FLAG{target_lifecycle_evidence_secret}"


@dataclass(frozen=True, slots=True)
class EvidenceResult:
    ok: bool
    mode: str
    evidence_path: Path
    transcript_path: Path
    summary: dict[str, Any]


def run_evidence(
    *,
    live: bool = False,
    log_dir: Path = DEFAULT_LOG_DIR,
    room_id: str = DEFAULT_ROOM_ID,
    team_id: str = DEFAULT_TEAM_ID,
    port: int = DEFAULT_PORT,
    runner: Callable[..., Any] | None = None,
    opener: Callable[..., Any] | None = None,
) -> EvidenceResult:
    log_dir.mkdir(parents=True, exist_ok=True)
    runtime = TargetRuntime(root=ROOT)
    template = TargetRegistry().get("real_ctf_web_awd_01")
    instance = runtime.plan_instance(template, room_id=room_id, team_id=team_id, flag=DEMO_FLAG, port=port)
    mode = "live" if live else "dry-run"
    transcript: list[str] = [
        "== AI-AWD Target Lifecycle Evidence ==",
        f"mode: {mode}",
        f"template: {template.template_id}",
        f"project: {instance.project_name}",
        f"base_url: {instance.base_url}",
        f"health_url: {instance.health_url}",
        "scope: local-only Docker Compose + localhost healthcheck",
    ]
    actions: list[dict[str, Any]] = []
    live_runner = runner or (subprocess.run if live else dry_run_runner)
    live_opener = opener or None
    ok = True
    started = False

    try:
        if live and runner is None:
            assert_docker_available()
        for action in ["install", "start"]:
            result = run_command_action(runtime, instance.commands[action], runner=live_runner)
            actions.append(result)
            transcript.append(format_action_line(action, result))
            if action == "start" and result["ok"]:
                started = True
        health = wait_for_health(runtime, instance, live=live, opener=live_opener)
        actions.append(health)
        transcript.append(format_action_line("health", health))
        ok = all(action["ok"] for action in actions)
    except Exception as exc:
        ok = False
        failure = {"action": "error", "ok": False, "message": str(exc), "code": getattr(exc, "code", type(exc).__name__)}
        actions.append(failure)
        transcript.append(format_action_line("error", failure))
    finally:
        if live and started:
            try:
                stopped = run_command_action(runtime, instance.commands["stop"], runner=live_runner)
            except Exception as exc:
                stopped = {"action": "stop", "ok": False, "message": str(exc), "steps": []}
            actions.append(stopped)
            transcript.append(format_action_line("stop", stopped))

    summary = redact_summary(
        {
            "ok": ok,
            "mode": mode,
            "template_id": template.template_id,
            "project_name": instance.project_name,
            "base_url": instance.base_url,
            "health_url": instance.health_url,
            "actions": actions,
        }
    )
    transcript.append("")
    transcript.append("summary: " + ("ok" if ok else "failed"))
    transcript_text = redact_text("\n".join(transcript) + "\n")
    evidence_path = log_dir / "target_lifecycle_evidence.json"
    transcript_path = log_dir / "target_lifecycle_evidence.txt"
    evidence_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    transcript_path.write_text(transcript_text, encoding="utf-8")
    return EvidenceResult(ok=ok, mode=mode, evidence_path=evidence_path, transcript_path=transcript_path, summary=summary)


def run_command_action(runtime: TargetRuntime, command: TargetCommand, *, runner: Callable[..., Any]) -> dict[str, Any]:
    steps = []

    def recording_runner(argv: list[str], *, cwd: Path, env: dict[str, str], check: bool, shell: bool) -> Any:
        started = time.time()
        result = runner(argv, cwd=cwd, env=env, check=check, shell=shell)
        steps.append(
            {
                "argv": redact_argv(argv),
                "cwd": str(cwd),
                "returncode": int(getattr(result, "returncode", 0) or 0),
                "elapsed_ms": int((time.time() - started) * 1000),
            }
        )
        return result

    runtime.run(command, runner=recording_runner)
    return {"action": command.name, "ok": True, "steps": steps, "message": f"{command.name} ok"}


def wait_for_health(
    runtime: TargetRuntime,
    instance: TargetInstance,
    *,
    live: bool,
    opener: Callable[..., Any] | None,
    attempts: int = 20,
    delay: float = 0.5,
) -> dict[str, Any]:
    if not live and opener is None:
        return {"action": "health", "ok": True, "health_url": instance.health_url, "message": "dry-run health ok"}
    errors: list[str] = []
    for _ in range(attempts):
        try:
            ok = runtime.check_health(instance, opener=opener) if opener else runtime.check_health(instance)
        except Exception as exc:
            errors.append(str(exc))
            ok = False
        if ok:
            return {"action": "health", "ok": True, "health_url": instance.health_url, "message": "health ok"}
        time.sleep(delay)
    return {
        "action": "health",
        "ok": False,
        "health_url": instance.health_url,
        "message": "healthcheck failed",
        "errors": errors[-3:],
    }


def dry_run_runner(argv: list[str], *, cwd: Path, env: dict[str, str], check: bool, shell: bool) -> Any:
    class Result:
        returncode = 0

    return Result()


def assert_docker_available() -> None:
    if not shutil.which("docker"):
        raise RuntimeError("docker command not found")
    result = subprocess.run(["docker", "info"], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "docker daemon unavailable").strip().splitlines()[-1]
        raise RuntimeError(f"docker daemon unavailable: {detail}")


def redact_argv(argv: list[str]) -> list[str]:
    return [redact_text(token) for token in argv]


def redact_summary(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: redact_summary(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_summary(item) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


def redact_text(text: str) -> str:
    return text.replace(DEMO_FLAG, "FLAG{已隐藏}")


def format_action_line(action: str, result: dict[str, Any]) -> str:
    status = "ok" if result.get("ok") else "failed"
    message = result.get("message", "")
    return f"{action}: {status} {message}".strip()


async def async_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect local target lifecycle evidence for AI-AWD Arena")
    parser.add_argument("--live", action="store_true", help="Actually run Docker Compose install/start/health/stop")
    parser.add_argument("--log-dir", type=Path, default=DEFAULT_LOG_DIR)
    parser.add_argument("--room-id", default=DEFAULT_ROOM_ID)
    parser.add_argument("--team-id", default=DEFAULT_TEAM_ID)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)

    result = run_evidence(
        live=args.live,
        log_dir=args.log_dir,
        room_id=args.room_id,
        team_id=args.team_id,
        port=args.port,
    )
    print(f"mode: {result.mode}")
    print(f"ok: {result.ok}")
    print(f"evidence: {result.evidence_path}")
    print(f"transcript: {result.transcript_path}")
    return 0 if result.ok else 1


def main() -> None:
    raise SystemExit(__import__("asyncio").run(async_main()))


if __name__ == "__main__":
    main()
