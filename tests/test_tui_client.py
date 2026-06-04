import asyncio
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from aiawd_server.protocol import Message
from tui.aiawd_tui import (
    AiawdTuiClient,
    CommandError,
    OutgoingRequest,
    TargetAction,
    WaitCondition,
    expected_response_types,
    format_message_summary,
    format_rankings_table,
    format_rooms,
    format_targets,
    load_script_commands,
    redact_command_for_transcript,
    redact_config,
    run_script,
)
from tui.target_lifecycle import TargetLifecycleError, run_local_target_action


class TuiClientTest(unittest.TestCase):
    def test_builds_create_join_ready_and_submit_requests(self) -> None:
        client = AiawdTuiClient(display_name="Alice", agent_runtime="tui-agent", model_display_name="model-alpha")

        create = client.build_request('create "AWD 演示" real_ctf_web_awd_01 3 1 2 3')
        self.assertIsInstance(create, OutgoingRequest)
        self.assertEqual(create.msg_type, "CREATE_ROOM_REQ")
        self.assertEqual(create.payload["room_name"], "AWD 演示")
        self.assertEqual(create.payload["max_players"], 3)
        self.assertEqual(create.payload["display_name"], "Alice")
        self.assertEqual(create.payload["agent_runtime"], "tui-agent")
        self.assertEqual(create.payload["model_display_name"], "model-alpha")
        self.assertEqual(create.payload["phase_seconds"], {"prepare": 1.0, "defense": 2.0, "attack": 3.0})

        join = client.build_request("join room_001 player")
        self.assertIsInstance(join, OutgoingRequest)
        self.assertEqual(join.msg_type, "JOIN_ROOM_REQ")
        self.assertEqual(join.room_id, "room_001")
        self.assertEqual(join.role, "player")
        self.assertEqual(join.payload["display_name"], "Alice")
        self.assertEqual(join.payload["agent_runtime"], "tui-agent")
        self.assertEqual(join.payload["model_display_name"], "model-alpha")

        client.room_id = "room_001"
        client.match_id = "match_001"
        ready = client.build_request("ready 靶机")
        submit = client.build_request("submit FLAG{demo}")
        wait = client.build_request("wait-phase 攻防 3")
        target = client.build_request("target 启动")

        self.assertEqual(ready.msg_type, "TARGET_READY")
        self.assertEqual(ready.room_id, "room_001")
        self.assertEqual(submit.msg_type, "SUBMIT_FLAG_REQ")
        self.assertEqual(submit.payload["match_id"], "match_001")
        self.assertEqual(submit.payload["source"], "tui")
        self.assertIsInstance(wait, WaitCondition)
        self.assertEqual(wait.phase, "ATTACK")
        self.assertEqual(wait.timeout, 3)
        self.assertIsInstance(target, TargetAction)
        self.assertEqual(target.action, "start")
        for alias in ("doctor", "status", "检查", "诊断"):
            doctor = client.build_request(f"target {alias}")
            self.assertIsInstance(doctor, TargetAction)
            self.assertEqual(doctor.action, "doctor")

        chinese_join = client.build_request("join room_001 观战")
        self.assertEqual(chinese_join.role, "spectator")
        self.assertEqual(chinese_join.payload["role"], "spectator")

    def test_runs_tui_target_lifecycle_safely_and_redacts_output(self) -> None:
        calls: list[dict[str, object]] = []

        def runner(argv: list[str], **kwargs: object) -> object:
            calls.append({"argv": argv, "env": kwargs["env"], "shell": kwargs["shell"]})

            class Result:
                returncode = 0

            return Result()

        client = AiawdTuiClient(target_runner=runner)
        client.role = "player"
        client.configs = [target_runtime_config()]

        output = asyncio.run(client.run_target_action("start"))

        self.assertIn("本地靶机启动完成", output)
        self.assertIn("1 步", output)
        self.assertEqual(calls[0]["argv"][-2:], ["up", "-d"])
        self.assertEqual(calls[0]["env"]["AIAWD_FLAG"], "FLAG{secret}")
        self.assertEqual(calls[0]["shell"], False)
        self.assertNotIn("FLAG{secret}", output)

    def test_tui_target_doctor_reports_daemon_unavailable_without_flag_leak(self) -> None:
        calls: list[dict[str, object]] = []

        def runner(argv: list[str], **kwargs: object) -> object:
            calls.append({"argv": argv, "shell": kwargs["shell"]})
            if argv == ["docker", "info"]:
                raise subprocess.CalledProcessError(1, argv)

            class Result:
                returncode = 0

            return Result()

        client = AiawdTuiClient(target_runner=runner)
        client.role = "player"
        client.configs = [target_runtime_config()]

        output = asyncio.run(client.run_target_action("doctor"))

        self.assertIn("本地靶机诊断发现问题", output)
        self.assertIn("Docker CLI OK", output)
        self.assertIn("Docker Compose OK", output)
        self.assertIn("Docker daemon 失败", output)
        self.assertEqual([call["argv"] for call in calls], [["docker", "--version"], ["docker", "compose", "version"], ["docker", "info"]])
        self.assertTrue(all(call["shell"] is False for call in calls))
        self.assertNotIn("up", output)
        self.assertNotIn("down", output)
        self.assertNotIn("build", output)
        self.assertNotIn("FLAG{secret}", output)

    def test_run_script_executes_target_action_without_protocol_send(self) -> None:
        calls: list[list[str]] = []

        def runner(argv: list[str], **kwargs: object) -> object:
            calls.append(argv)

            class Result:
                returncode = 0

            return Result()

        async def scenario() -> list[str]:
            client = AiawdTuiClient(target_runner=runner)
            client.client_id = "client_001"
            client.role = "player"
            client.configs = [target_runtime_config()]
            return await run_script(client, ["target start"])

        transcript = "\n".join(asyncio.run(scenario()))

        self.assertIn("> target start", transcript)
        self.assertIn("本地靶机启动完成", transcript)
        self.assertNotIn("FLAG{secret}", transcript)
        self.assertEqual(calls[0][-2:], ["up", "-d"])

    def test_tui_target_lifecycle_rejects_public_healthcheck(self) -> None:
        config = target_runtime_config()
        config["target_runtime"]["health_url"] = "http://example.com/health"

        with self.assertRaises(TargetLifecycleError) as exc:
            run_local_target_action(config, "health")

        self.assertEqual(exc.exception.code, "OUT_OF_SCOPE_HEALTHCHECK")

    def test_tui_target_lifecycle_rejects_shell_tokens(self) -> None:
        config = target_runtime_config()
        config["target_runtime"]["commands"]["start"]["argv"][0].append("&&")

        with self.assertRaises(TargetLifecycleError) as exc:
            run_local_target_action(config, "start")

        self.assertEqual(exc.exception.code, "UNSAFE_COMMAND")

    def test_ready_requires_room_and_join_validates_role(self) -> None:
        client = AiawdTuiClient()

        with self.assertRaises(CommandError):
            client.build_request("ready agent")
        with self.assertRaises(CommandError):
            client.build_request("join room_001 admin")

    def test_handle_messages_updates_state_and_infers_role(self) -> None:
        client = AiawdTuiClient()

        client.handle_message(Message(type="WELCOME", client_id="client_001", payload={"client_id": "client_001"}))
        client.handle_message(
            Message(
                type="ROOM_UPDATE",
                room_id="room_001",
                payload={
                    "room": {
                        "room_id": "room_001",
                        "status": "LOBBY",
                        "players": [{"client_id": "client_001", "team_id": "team_a"}],
                        "spectators": [],
                    }
                },
            )
        )
        client.handle_message(
            Message(type="PHASE_SYNC", payload={"match": {"match_id": "match_001", "phase": "ATTACK"}})
        )
        client.handle_message(
            Message(type="RANKING_UPDATE", payload={"rankings": [{"team_id": "team_a", "score": 100}]})
        )

        self.assertEqual(client.client_id, "client_001")
        self.assertEqual(client.room_id, "room_001")
        self.assertEqual(client.role, "player")
        self.assertEqual(client.match_id, "match_001")
        self.assertIn("攻防", "\n".join(client.status_lines()))
        self.assertIn("大逃杀", "\n".join(client.status_lines()))
        self.assertIn("team_a", "\n".join(client.status_lines()))

    def test_private_config_is_redacted_from_status(self) -> None:
        client = AiawdTuiClient()
        client.handle_message(
            Message(
                type="MATCH_CONFIG",
                payload={
                    "match_id": "match_001",
                    "team_id": "team_a",
                    "flag": "FLAG{secret}",
                    "allowed_targets": ["http://127.0.0.1:18081"],
                    "opponents": [{"team_id": "team_b"}],
                    "target_manifest": {
                        "name": "Web AWD 演示靶机",
                        "difficulty": "professional",
                        "runtime": "docker-compose",
                        "healthcheck": {"path": "/health"},
                    },
                    "target_runtime": {
                        "project_name": "aiawd_room_001_team_a",
                        "health_url": "http://127.0.0.1:18081/health",
                        "commands": {
                            "install": {},
                            "start": {},
                            "stop": {},
                            "reset": {},
                        },
                    },
                },
            )
        )

        self.assertEqual(redact_config(client.configs[0])["flag"], "FLAG{已隐藏}")
        status = "\n".join(client.status_lines())
        self.assertIn("允许目标：1 个", status)
        self.assertIn("运行：专业 · Docker Compose · 健康 /health", status)
        self.assertIn("计划：aiawd_room_001_team_a · install/start/stop/reset · 巡检 http://127.0.0.1:18081/health", status)
        self.assertNotIn("FLAG{secret}", status)

    def test_compact_status_is_short_and_redacted(self) -> None:
        wide = AiawdTuiClient(display_name="Alice")
        compact = AiawdTuiClient(display_name="Alice", layout="compact")
        messages = [
            Message(type="WELCOME", client_id="client_001", payload={"client_id": "client_001"}),
            Message(
                type="ROOM_UPDATE",
                payload={
                    "room": {
                        "room_id": "room_001",
                        "room_name": "训练赛",
                        "status": "ATTACK",
                        "players": [
                            {
                                "client_id": "client_001",
                                "team_id": "team_a",
                                "display_name": "Alice",
                                "model_display_name": "model-alpha",
                                "target_ready": True,
                                "agent_ready": False,
                                "score": 100,
                            }
                        ],
                        "spectators": [],
                    }
                },
            ),
            Message(type="RANKING_UPDATE", payload={"rankings": [{"team_id": "team_a", "score": 100}]}),
            Message(
                type="MATCH_CONFIG",
                payload={
                    "match_id": "match_001",
                    "team_id": "team_a",
                    "flag": "FLAG{secret}",
                    "allowed_targets": ["http://127.0.0.1:18081"],
                    "opponents": [{"team_id": "team_b"}],
                },
            ),
        ]
        for message in messages:
            wide.handle_message(message)
            compact.handle_message(message)

        wide_status = "\n".join(wide.status_lines())
        compact_status = "\n".join(compact.status_lines())

        self.assertLess(len(compact.status_lines()), len(wide.status_lines()))
        self.assertIn("== AI-AWD 状态 ==", compact_status)
        self.assertIn("排行：1.team_a 100分", compact_status)
        self.assertIn("FLAG{已隐藏}", compact_status)
        self.assertNotIn("FLAG{secret}", compact_status)
        self.assertNotIn("FLAG{secret}", wide_status)

    def test_script_helpers_keep_command_order_and_response_types(self) -> None:
        with TemporaryDirectory() as temp_dir:
            script = Path(temp_dir) / "demo.aiawd"
            script.write_text("targets\nrooms\n", encoding="utf-8")

            commands = load_script_commands(script, ["status", "quit"])

        self.assertEqual(commands, ["targets", "rooms", "status", "quit"])
        self.assertEqual(expected_response_types("CREATE_ROOM_REQ"), {"CREATE_ROOM_RES"})
        self.assertEqual(expected_response_types("TARGET_READY"), {"TARGET_READY_ACK"})
        self.assertEqual(format_message_summary(Message(type="START_MATCH_RES", payload={})), "比赛已开始")

    def test_formats_match_views_as_readable_tables(self) -> None:
        targets = [
            {
                "template_id": "real_ctf_web_awd_01",
                "name": "Web AWD 演示靶机",
                "difficulty": "professional",
                "runtime": "docker-compose",
                "category": "web",
            }
        ]
        rooms = [
            {
                "room_id": "room_001",
                "room_name": "训练赛",
                "status": "LOBBY",
                "players": [{"team_id": "team_a"}],
                "max_players": 2,
                "target_template_id": "real_ctf_web_awd_01",
                "allow_spectators": True,
            }
        ]
        rankings = [{"team_id": "team_a", "display_name": "Alice", "score": 100}]

        self.assertIn("== 靶场模板 ==", format_targets(targets))
        self.assertIn("专业", format_targets(targets))
        self.assertIn("== 房间列表 ==", format_rooms(rooms))
        self.assertIn("大厅", format_rooms(rooms))
        self.assertIn("== 排行榜 ==", format_rankings_table(rankings))
        self.assertIn("Alice", format_rankings_table(rankings))

    def test_script_transcript_redacts_submit_command(self) -> None:
        self.assertEqual(redact_command_for_transcript("submit FLAG{secret}"), "submit FLAG{已隐藏}")
        self.assertEqual(redact_command_for_transcript("rooms"), "rooms")


def target_runtime_config() -> dict[str, object]:
    compose_file = Path(__file__).resolve().parents[1] / "targets" / "real_ctf_web_awd_01" / "docker-compose.yml"
    cwd = compose_file.parent
    return {
        "match_id": "match_001",
        "team_id": "team_a",
        "flag": "FLAG{secret}",
        "target_runtime": {
            "project_name": "aiawd_room_001_team_a",
            "health_url": "http://127.0.0.1:18081/health",
            "commands": {
                "install": target_command(cwd, compose_file, [["build"]]),
                "start": target_command(cwd, compose_file, [["up", "-d"]]),
                "stop": target_command(cwd, compose_file, [["down"]]),
                "reset": target_command(cwd, compose_file, [["down", "-v"], ["up", "-d"]]),
            },
        },
        "allowed_targets": ["http://127.0.0.1:18081"],
        "opponents": [{"team_id": "team_b"}],
    }


def target_command(cwd: Path, compose_file: Path, steps: list[list[str]]) -> dict[str, object]:
    return {
        "argv": [
            ["docker", "compose", "-p", "aiawd_room_001_team_a", "-f", str(compose_file), *step]
            for step in steps
        ],
        "cwd": str(cwd),
        "env": {
            "AIAWD_ROOM_ID": "room_001",
            "AIAWD_TEAM_ID": "team_a",
            "AIAWD_HTTP_PORT": "18081",
            "AIAWD_FLAG": "FLAG{已隐藏}",
        },
    }


if __name__ == "__main__":
    unittest.main()
