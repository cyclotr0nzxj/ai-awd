from __future__ import annotations

import asyncio
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen

from aiawd_server.http_api import HttpApiServer
from aiawd_server.log_store import LogStore
from aiawd_server.match_engine import MatchEngine
from aiawd_server.models import Phase, Role, Session
from aiawd_server.room_manager import RoomManager
from aiawd_server.session_manager import SessionManager
from aiawd_server.target_registry import TargetRegistry


class HttpApiTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        tmp_path = Path(self.temp_dir.name)
        self.log_store = LogStore(tmp_path / "events.jsonl")
        self.session_manager = SessionManager()
        self.room_manager = RoomManager()
        self.match_engine = MatchEngine()
        self.target_registry = TargetRegistry()
        self.server = HttpApiServer(
            host="127.0.0.1", port=0,
            session_manager=self.session_manager,
            room_manager=self.room_manager,
            match_engine=self.match_engine,
            target_registry=self.target_registry,
            log_store=self.log_store,
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def _url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.server.port}{path}"

    # -- helpers --

    def _setup_room_and_match(self) -> tuple[str, str]:
        alice = self.session_manager.create_session({"display_name": "Alice"})
        bob = self.session_manager.create_session({"display_name": "Bob"})
        room = self.room_manager.create_room(alice, {
            "room_name": "Test Room", "max_players": 2,
            "target_template_id": "real_ctf_web_awd_01",
            "display_name": alice.display_name,
            "agent_runtime": "test-agent",
            "allow_spectators": True,
            "phase_seconds": {"prepare": 10, "defense": 10, "attack": 30},
        })
        self.room_manager.join_room(bob, room.room_id, Role.PLAYER, {
            "display_name": bob.display_name, "agent_runtime": "test-agent",
        })
        match, _configs = self.match_engine.start_match(room, alice.client_id)
        self.match_engine.set_phase(room, Phase.ATTACK)
        self.log_store.append("ROOM_CREATED", {"room_id": room.room_id})
        self.log_store.append("MATCH_STARTED", {"room_id": room.room_id, "match_id": match.match_id})
        return room.room_id, match.match_id

    async def _start_and_fetch(self, path: str) -> tuple[int, dict]:
        await self.server.start()
        loop = asyncio.get_running_loop()
        try:
            url = self._url(path)

            def _fetch():
                from urllib.error import HTTPError
                req = Request(url, headers={"Accept": "application/json"})
                try:
                    with urlopen(req, timeout=5) as resp:
                        return resp.status, json.loads(resp.read())
                except HTTPError as err:
                    body = json.loads(err.read())
                    return err.code, body

            return await loop.run_in_executor(None, _fetch)
        finally:
            await self.server.stop()

    # -- tests --

    def test_health_endpoint(self):
        status, body = asyncio.run(self._start_and_fetch("/health"))
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["server"], "ai-awd-arena")
        self.assertEqual(body["clients"], 0)

    def test_health_counts_registered_clients(self):
        self.session_manager.sessions["c1"] = Session(client_id="c1", display_name="T1")
        self.session_manager.sessions["c2"] = Session(client_id="c2", display_name="T2")
        status, body = asyncio.run(self._start_and_fetch("/health"))
        self.assertEqual(body["clients"], 2)

    def test_targets_endpoint_returns_three_templates(self):
        status, body = asyncio.run(self._start_and_fetch("/api/v1/targets"))
        self.assertEqual(status, 200)
        self.assertIn("targets", body)
        self.assertEqual(len(body["targets"]), 3)

    def test_rooms_endpoint_empty(self):
        status, body = asyncio.run(self._start_and_fetch("/api/v1/rooms"))
        self.assertEqual(status, 200)
        self.assertIn("rooms", body)
        self.assertEqual(body["rooms"], [])

    def test_rooms_endpoint_after_create(self):
        room_id, _ = self._setup_room_and_match()
        status, body = asyncio.run(self._start_and_fetch("/api/v1/rooms"))
        self.assertEqual(len(body["rooms"]), 1)
        self.assertEqual(body["rooms"][0]["room_id"], room_id)

    def test_room_detail_endpoint(self):
        room_id, _ = self._setup_room_and_match()
        status, body = asyncio.run(self._start_and_fetch(f"/api/v1/rooms/{room_id}"))
        self.assertEqual(status, 200)
        self.assertEqual(body["room"]["room_name"], "Test Room")
        self.assertEqual(len(body["room"]["players"]), 2)

    def test_room_not_found(self):
        status, body = asyncio.run(self._start_and_fetch("/api/v1/rooms/nope"))
        self.assertEqual(status, 404)
        self.assertIn("error", body)

    def test_room_rankings_endpoint(self):
        room_id, _ = self._setup_room_and_match()
        status, body = asyncio.run(self._start_and_fetch(f"/api/v1/rooms/{room_id}/rankings"))
        self.assertEqual(status, 200)
        self.assertIn("rankings", body)
        self.assertGreaterEqual(len(body["rankings"]), 2)

    def test_room_events_endpoint(self):
        room_id, _ = self._setup_room_and_match()
        status, body = asyncio.run(self._start_and_fetch(f"/api/v1/rooms/{room_id}/events"))
        self.assertEqual(status, 200)
        self.assertIn("events", body)
        self.assertGreaterEqual(len(body["events"]), 2)

    def test_match_endpoint(self):
        room_id, match_id = self._setup_room_and_match()
        status, body = asyncio.run(self._start_and_fetch(f"/api/v1/matches/{match_id}"))
        self.assertEqual(status, 200)
        self.assertEqual(body["match"]["room_id"], room_id)

    def test_match_not_found(self):
        status, body = asyncio.run(self._start_and_fetch("/api/v1/matches/nope"))
        self.assertEqual(status, 404)

    def test_options_request(self):
        async def run():
            await self.server.start()
            loop = asyncio.get_running_loop()
            try:
                import http.client

                def _options():
                    conn = http.client.HTTPConnection("127.0.0.1", self.server.port, timeout=5)
                    conn.request("OPTIONS", "/api/v1/rooms")
                    return conn.getresponse()

                resp = await loop.run_in_executor(None, _options)
                self.assertEqual(resp.status, 204)
            finally:
                await self.server.stop()
        asyncio.run(run())

    def test_post_is_rejected(self):
        async def run():
            await self.server.start()
            loop = asyncio.get_running_loop()
            try:
                import http.client

                def _post():
                    conn = http.client.HTTPConnection("127.0.0.1", self.server.port, timeout=5)
                    conn.request("POST", "/api/v1/rooms")
                    return conn.getresponse()

                resp = await loop.run_in_executor(None, _post)
                self.assertEqual(resp.status, 405)
            finally:
                await self.server.stop()
        asyncio.run(run())

    def test_events_redact_private_flags(self):
        room_id, _ = self._setup_room_and_match()
        self.log_store.append("FLAG_CAPTURED", {
            "room_id": room_id,
            "flag": "FLAG{secret_test_flag}",
            "flag_plaintext": "FLAG{secret_test_flag}",
        })
        status, body = asyncio.run(self._start_and_fetch(f"/api/v1/rooms/{room_id}/events"))
        events = body["events"]
        for event in events:
            payload_str = json.dumps(event)
            self.assertNotIn("FLAG{secret_test_flag}", payload_str)
