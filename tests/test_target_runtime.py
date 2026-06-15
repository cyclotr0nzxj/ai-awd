import os
import unittest
from dataclasses import replace
from pathlib import Path

from aiawd_server.target_registry import TargetRegistry, TargetTemplate
from aiawd_server.target_runtime import TargetCommand, TargetRuntime, TargetRuntimeError


ROOT = Path(__file__).resolve().parents[1]


class TargetRuntimeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.template = TargetRegistry().get("real_ctf_web_awd_01")
        self.runtime = TargetRuntime(root=ROOT)

    def test_plans_safe_docker_compose_instance_and_redacts_flag(self) -> None:
        instance = self.runtime.plan_instance(
            self.template,
            room_id="room_001",
            team_id="team_a",
            flag="FLAG{secret}",
            port=18123,
        )

        self.assertEqual(instance.project_name, "aiawd_room_001_team_a")
        self.assertEqual(instance.base_url, "http://127.0.0.1:18123")
        self.assertEqual(instance.health_url, "http://127.0.0.1:18123/health")
        self.assertTrue(str(instance.compose_file).endswith("targets/real_ctf_web_awd_01/docker-compose.yml"))
        self.assertFalse(instance.compose_file.is_absolute())
        self.assertFalse(instance.commands["start"].cwd.is_absolute())
        self.assertEqual(
            instance.commands["start"].argv,
            [["docker", "compose", "-p", "aiawd_room_001_team_a", "-f", str(instance.compose_file), "up", "-d"]],
        )
        self.assertFalse(Path(instance.commands["start"].argv[0][5]).is_absolute())
        self.assertEqual(instance.commands["install"].argv[0][-1], "build")

        public = instance.public_snapshot()
        self.assertEqual(public["commands"]["start"]["env"]["AIAWD_FLAG"], "FLAG{已隐藏}")
        self.assertNotIn("FLAG{secret}", str(public))

    def test_run_uses_argv_without_shell_and_keeps_process_environment(self) -> None:
        instance = self.runtime.plan_instance(
            self.template,
            room_id="room_001",
            team_id="team_a",
            flag="FLAG{secret}",
            port=18123,
        )
        calls = []

        def runner(argv, *, cwd, env, check, shell):
            calls.append({"argv": argv, "cwd": cwd, "env": env, "check": check, "shell": shell})
            return "ok"

        results = self.runtime.run(instance.commands["start"], runner=runner)

        self.assertEqual(results, ["ok"])
        self.assertEqual(calls[0]["argv"][-2:], ["up", "-d"])
        self.assertEqual(calls[0]["cwd"], ROOT / "targets/real_ctf_web_awd_01")
        self.assertEqual(calls[0]["env"]["AIAWD_FLAG"], "FLAG{secret}")
        self.assertEqual(calls[0]["env"]["AIAWD_ROOM_ID"], "room_001")
        self.assertEqual(calls[0]["env"].get("PATH"), os.environ.get("PATH"))
        self.assertTrue(calls[0]["check"])
        self.assertFalse(calls[0]["shell"])

    def test_healthcheck_is_limited_to_local_http_targets(self) -> None:
        instance = self.runtime.plan_instance(
            self.template,
            room_id="room_001",
            team_id="team_a",
            flag="FLAG{secret}",
            port=18123,
        )
        calls = []

        class Response:
            status = 204

        def opener(url, *, timeout):
            calls.append((url, timeout))
            return Response()

        self.assertTrue(self.runtime.check_health(instance, opener=opener, timeout=2))
        self.assertEqual(calls, [("http://127.0.0.1:18123/health", 2)])

        external = replace(instance, health_url="http://example.com/health")
        with self.assertRaises(TargetRuntimeError) as error:
            self.runtime.check_health(external, opener=opener)
        self.assertEqual(error.exception.code, "OUT_OF_SCOPE_HEALTHCHECK")

    def test_rejects_out_of_scope_or_unsafe_target_plans(self) -> None:
        with self.assertRaises(TargetRuntimeError) as error:
            self.runtime.plan_instance(
                self.template,
                room_id="room_001",
                team_id="team_a",
                flag="FLAG{secret}",
                host="10.0.0.5",
                port=18123,
            )
        self.assertEqual(error.exception.code, "OUT_OF_SCOPE_HOST")

        with self.assertRaises(TargetRuntimeError) as error:
            self.runtime.plan_instance(
                self.template,
                room_id="../room",
                team_id="team_a",
                flag="FLAG{secret}",
                port=18123,
            )
        self.assertEqual(error.exception.code, "BAD_IDENTIFIER")

        bad_manifest = self.template.manifest_snapshot()
        bad_manifest["security"]["allowed_scope"] = "public"
        bad_template = TargetTemplate(
            template_id="unsafe",
            name="unsafe",
            description="unsafe",
            version="0",
            category="web",
            difficulty="professional",
            runtime="docker-compose",
            manifest=bad_manifest,
        )
        with self.assertRaises(TargetRuntimeError) as error:
            self.runtime.plan_instance(bad_template, room_id="room_001", team_id="team_a", flag="FLAG{secret}", port=18123)
        self.assertEqual(error.exception.code, "UNSAFE_TARGET")

    def test_rejects_compose_files_outside_project_and_shell_tokens(self) -> None:
        bad_manifest = self.template.manifest_snapshot()
        bad_manifest["compose"]["file"] = "../outside.yml"
        bad_template = TargetTemplate(
            template_id="bad_compose",
            name="bad compose",
            description="bad compose",
            version="0",
            category="web",
            difficulty="professional",
            runtime="docker-compose",
            manifest=bad_manifest,
        )

        with self.assertRaises(TargetRuntimeError) as error:
            self.runtime.plan_instance(bad_template, room_id="room_001", team_id="team_a", flag="FLAG{secret}", port=18123)
        self.assertEqual(error.exception.code, "BAD_COMPOSE")

        command = TargetCommand(name="bad", argv=[["docker", "|"]], cwd=ROOT, env={})
        with self.assertRaises(TargetRuntimeError) as error:
            self.runtime.run(command, runner=lambda *args, **kwargs: None)
        self.assertEqual(error.exception.code, "UNSAFE_COMMAND")


    def test_plans_tcp_target_instance(self) -> None:
        from aiawd_server.target_registry import TargetRegistry

        registry = TargetRegistry()
        template = registry.get("pwn_awd_echo_01")
        instance = self.runtime.plan_instance(template, room_id="room_001", team_id="team_a", flag="FLAG{secret}", port=31337)
        self.assertEqual(instance.template_id, "pwn_awd_echo_01")
        self.assertEqual(instance.project_name, "aiawd_room_001_team_a")
        self.assertTrue(instance.health_url.startswith("tcp://"))
        self.assertIn("31337", instance.health_url)

    def test_rejects_http_healthcheck_without_path(self) -> None:
        from aiawd_server.target_registry import TargetTemplate

        template = TargetTemplate(
            template_id="bad",
            name="Bad",
            description="Bad target",
            version="0.1.0",
            category="web",
            difficulty="beginner",
            runtime="docker-compose",
            manifest={
                "runtime": "docker-compose",
                "security": {"no_public_targets": True, "allowed_scope": "room_only"},
                "healthcheck": {"type": "http", "path": "", "timeout_sec": 10},
                "compose": {"file": str(ROOT / "targets" / "real_ctf_web_awd_01" / "docker-compose.yml")},
            },
        )
        with self.assertRaises(TargetRuntimeError) as error:
            self.runtime.plan_instance(template, room_id="room_001", team_id="team_a", flag="FLAG{secret}", port=18123)
        self.assertEqual(error.exception.code, "BAD_HEALTHCHECK")

    def test_tcp_healthcheck_connects_to_localhost(self) -> None:
        import socket
        import threading

        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("127.0.0.1", 19999))
        server.listen(1)
        server.settimeout(2)
        received: list[bytes] = []

        def serve_once() -> None:
            conn, _addr = server.accept()
            with conn:
                received.append(conn.recv(16))
                conn.sendall(b"OK\n")

        thread = threading.Thread(target=serve_once, daemon=True)
        thread.start()
        try:
            from aiawd_server.target_registry import TargetRegistry

            registry = TargetRegistry()
            template = registry.get("pwn_awd_echo_01")
            instance = self.runtime.plan_instance(
                template, room_id="room_tcp", team_id="team_c", flag="FLAG{secret}", port=19999
            )
            self.assertTrue(instance.health_url.startswith("tcp://"))
            result = self.runtime.check_health(instance, timeout=2)
            self.assertTrue(result)
            thread.join(timeout=2)
            self.assertEqual(received, [b"HEALTH"])
        finally:
            server.close()


if __name__ == "__main__":
    unittest.main()
