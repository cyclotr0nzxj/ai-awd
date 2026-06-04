import asyncio
import tempfile
import unittest
from pathlib import Path
from typing import Any

from aiawd_server.log_store import LogStore
from aiawd_server.protocol import Message, read_message, write_message
from aiawd_server.tcp_gateway import TCPGateway


class TCPGatewayTest(unittest.TestCase):
    def test_three_clients_room_and_match_flow(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            asyncio.run(_three_clients_room_and_match_flow(Path(temp_dir)))


async def _three_clients_room_and_match_flow(tmp_path: Path) -> None:
    gateway = TCPGateway(host="127.0.0.1", port=0, log_store=LogStore(tmp_path / "events.jsonl"))
    await gateway.start()
    clients: list[TestClient] = []
    try:
        client_a = await TestClient.connect(gateway.port, "Alice")
        client_b = await TestClient.connect(gateway.port, "Bob")
        client_c = await TestClient.connect(gateway.port, "Carol")
        clients.extend([client_a, client_b, client_c])

        assert client_a.client_id != client_b.client_id != client_c.client_id

        await client_a.send("LIST_TARGETS_REQ", seq=10)
        targets_res = await client_a.read_until_type("LIST_TARGETS_RES")
        target = targets_res.payload["targets"][0]
        assert target["template_id"] == "real_ctf_web_awd_01"
        assert target["difficulty"] == "professional"
        assert target["runtime"] == "docker-compose"
        assert target["manifest"]["healthcheck"]["path"] == "/health"

        await client_a.send(
            "CREATE_ROOM_REQ",
            seq=11,
            payload={
                "room_name": "Bad Target",
                "target_template_id": "missing_target",
            },
        )
        bad_target = await client_a.read_until_type("ERROR")
        assert bad_target.payload["code"] == "BAD_REQUEST"
        assert len(gateway.room_manager.rooms) == 0

        await client_a.send(
            "CREATE_ROOM_REQ",
            seq=2,
            payload={
                "room_name": "AI AWD Demo",
                "max_players": 2,
                "target_template_id": "real_ctf_web_awd_01",
                "allow_spectators": True,
                "phase_seconds": {"prepare": 0, "defense": 0, "attack": 1},
            },
        )
        create_res = await client_a.read_until_type("CREATE_ROOM_RES")
        room_id = create_res.payload["room"]["room_id"]

        await client_a.send(
            "CREATE_ROOM_REQ",
            seq=2,
            payload={
                "room_name": "AI AWD Demo",
                "max_players": 2,
                "target_template_id": "real_ctf_web_awd_01",
            },
        )
        duplicate_res = await client_a.read_until_type("CREATE_ROOM_RES")
        assert duplicate_res.payload["room"]["room_id"] == room_id
        assert len(gateway.room_manager.rooms) == 1

        await client_b.send(
            "JOIN_ROOM_REQ",
            seq=2,
            room_id=room_id,
            role="player",
            payload={
                "display_name": "Bob",
                "agent_runtime": "mock-agent",
                "model_display_name": "mock-model-b",
            },
        )
        join_b = await client_b.read_until_type("JOIN_ROOM_RES")
        assert join_b.payload["member"]["team_id"] == "team_b"

        await client_c.send(
            "JOIN_ROOM_REQ",
            seq=2,
            room_id=room_id,
            role="spectator",
            payload={"display_name": "Carol"},
        )
        join_c = await client_c.read_until_type("JOIN_ROOM_RES")
        assert join_c.payload["member"]["role"] == "spectator"

        await client_b.send("TARGET_READY", seq=3, room_id=room_id, role="player")
        target_update = await client_a.read_until(
            lambda message: message.type == "ROOM_UPDATE"
            and any(player["team_id"] == "team_b" and player["target_ready"] for player in message.payload["room"]["players"])
        )
        target_player = next(player for player in target_update.payload["room"]["players"] if player["team_id"] == "team_b")
        assert target_player["target_ready"] is True
        target_ack = await client_b.read_until_type("TARGET_READY_ACK")
        assert target_ack.payload["member"]["target_ready"] is True

        await client_b.send("AGENT_READY", seq=4, room_id=room_id, role="player")
        agent_update = await client_a.read_until(
            lambda message: message.type == "ROOM_UPDATE"
            and any(player["team_id"] == "team_b" and player["agent_ready"] for player in message.payload["room"]["players"])
        )
        agent_player = next(player for player in agent_update.payload["room"]["players"] if player["team_id"] == "team_b")
        assert agent_player["agent_ready"] is True
        agent_ack = await client_b.read_until_type("AGENT_READY_ACK")
        assert agent_ack.payload["member"]["agent_ready"] is True

        await client_c.send("TARGET_READY", seq=3, room_id=room_id, role="spectator")
        spectator_ready = await client_c.read_until_type("ERROR")
        assert spectator_ready.payload["code"] == "INVALID_ROLE"

        await client_c.send("START_MATCH_REQ", seq=4, room_id=room_id, role="spectator")
        spectator_start = await client_c.read_until_type("ERROR")
        assert spectator_start.payload["code"] == "INVALID_ROLE"

        await client_a.send("START_MATCH_REQ", seq=3, room_id=room_id, role="player")
        start_res = await client_a.read_until_type("START_MATCH_RES")
        assert start_res.payload["ok"] is True

        config_a = await client_a.read_until_type("MATCH_CONFIG")
        config_b = await client_b.read_until_type("MATCH_CONFIG")
        phase_a = await client_a.read_until(
            lambda message: message.type == "PHASE_SYNC" and message.payload["match"]["phase"] == "PREPARE"
        )
        phase_c = await client_c.read_until_type("PHASE_SYNC")

        assert config_a.payload["team_id"] == "team_a"
        assert config_b.payload["team_id"] == "team_b"
        assert config_a.payload["target_manifest"]["id"] == "real_ctf_web_awd_01"
        assert config_a.payload["target_manifest"]["runtime"] == "docker-compose"
        assert config_a.payload["target_manifest"]["flag"]["visible_to_agent"] is False
        assert config_a.payload["target_manifest"]["healthcheck"]["path"] == "/health"
        assert "FLAG{" not in str(config_a.payload["target_manifest"])
        assert config_a.payload["target_runtime"]["project_name"] == f"aiawd_{room_id}_team_a"
        assert config_a.payload["target_runtime"]["base_url"] == "http://127.0.0.1:18081"
        assert config_a.payload["target_runtime"]["health_url"] == "http://127.0.0.1:18081/health"
        assert config_a.payload["target_runtime"]["commands"]["start"]["argv"][0][-2:] == ["up", "-d"]
        assert config_a.payload["target_runtime"]["commands"]["start"]["env"]["AIAWD_FLAG"] == "FLAG{已隐藏}"
        assert config_a.payload["flag"] not in str(config_a.payload["target_runtime"])
        assert phase_a.payload["match"]["room_id"] == room_id
        assert phase_c.payload["match"]["room_id"] == room_id
        assert all(message.type != "MATCH_CONFIG" for message in client_c.inbox)

        await client_a.read_until(
            lambda message: message.type == "PHASE_SYNC" and message.payload["match"]["phase"] == "ATTACK"
        )
        await client_a.send(
            "SUBMIT_FLAG_REQ",
            seq=4,
            room_id=room_id,
            role="player",
            payload={
                "match_id": start_res.payload["match"]["match_id"],
                "claimed_target_team_id": "team_b",
                "flag": config_b.payload["flag"],
                "source": "test",
            },
        )
        submit_res = await client_a.read_until_type("SUBMIT_FLAG_RES")
        assert submit_res.payload["ok"] is True
        rankings = await client_c.read_until(
            lambda message: message.type == "RANKING_UPDATE"
            and message.payload["rankings"][0]["team_id"] == "team_a"
            and message.payload["rankings"][0]["score"] == 100
        )
        assert rankings.payload["rankings"][0]["team_id"] == "team_a"
    finally:
        for client in clients:
            client.close()
        await gateway.stop()


class TestClient:
    def __init__(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        client_id: str,
    ) -> None:
        self.reader = reader
        self.writer = writer
        self.client_id = client_id
        self.inbox: list[Message] = []

    @classmethod
    async def connect(cls, port: int, display_name: str) -> "TestClient":
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        await write_message(
            writer,
            Message(
                type="HELLO",
                seq=1,
                payload={
                    "display_name": display_name,
                    "platform": "test",
                    "capabilities": ["player", "spectator"],
                },
            ),
        )
        welcome = await asyncio.wait_for(read_message(reader), timeout=1)
        assert welcome.type == "WELCOME"
        return cls(reader, writer, welcome.payload["client_id"])

    async def send(
        self,
        msg_type: str,
        *,
        seq: int,
        payload: dict[str, Any] | None = None,
        room_id: str | None = None,
        role: str | None = None,
    ) -> None:
        await write_message(
            self.writer,
            Message(
                type=msg_type,
                seq=seq,
                client_id=self.client_id,
                room_id=room_id,
                role=role,
                payload=payload or {},
            ),
        )

    async def read_until_type(self, msg_type: str) -> Message:
        return await self.read_until(lambda message: message.type == msg_type)

    async def read_until(self, predicate: Any) -> Message:
        deadline = asyncio.get_running_loop().time() + 2
        for index, message in enumerate(self.inbox):
            if predicate(message):
                return self.inbox.pop(index)
        while True:
            timeout = deadline - asyncio.get_running_loop().time()
            if timeout <= 0:
                raise AssertionError("Timed out waiting for expected message")
            message = await asyncio.wait_for(read_message(self.reader), timeout=timeout)
            if predicate(message):
                return message
            self.inbox.append(message)

    def close(self) -> None:
        self.writer.close()


if __name__ == "__main__":
    unittest.main()
