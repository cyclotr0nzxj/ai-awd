from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

from aiawd_server.log_store import LogStore
from aiawd_server.protocol import Message, read_message, write_message
from aiawd_server.tcp_gateway import TCPGateway


class DemoClient:
    def __init__(
        self,
        name: str,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        client_id: str,
        transcript: list[str],
    ) -> None:
        self.name = name
        self.reader = reader
        self.writer = writer
        self.client_id = client_id
        self.transcript = transcript
        self.inbox: list[Message] = []

    @classmethod
    async def connect(cls, port: int, name: str, transcript: list[str]) -> "DemoClient":
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        await write_message(
            writer,
            Message(
                type="HELLO",
                seq=1,
                payload={"display_name": name, "platform": "demo", "capabilities": ["player", "spectator"]},
            ),
        )
        welcome = await read_message(reader)
        transcript.append(f"{name} <- {welcome.type} {welcome.payload}")
        return cls(name, reader, writer, welcome.payload["client_id"], transcript)

    async def send(
        self,
        msg_type: str,
        *,
        seq: int,
        payload: dict[str, Any] | None = None,
        room_id: str | None = None,
        role: str | None = None,
    ) -> None:
        self.transcript.append(f"{self.name} -> {msg_type}")
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

    async def read_until(self, predicate: Callable[[Message], bool], label: str) -> Message:
        for index, message in enumerate(self.inbox):
            if predicate(message):
                self.transcript.append(f"{self.name} <- {message.type} {message.payload}")
                return self.inbox.pop(index)
        while True:
            message = await asyncio.wait_for(read_message(self.reader), timeout=3)
            if predicate(message):
                self.transcript.append(f"{self.name} <- {message.type} {message.payload}")
                return message
            self.inbox.append(message)
            self.transcript.append(f"{self.name} <- {message.type}")

    async def read_type(self, msg_type: str) -> Message:
        return await self.read_until(lambda message: message.type == msg_type, msg_type)

    def close(self) -> None:
        self.writer.close()


async def run_demo() -> list[str]:
    transcript: list[str] = []
    gateway = TCPGateway(
        host="127.0.0.1",
        port=0,
        log_store=LogStore(ROOT / "logs" / "server" / "events.jsonl"),
    )
    await gateway.start()
    transcript.append(f"server listening on 127.0.0.1:{gateway.port}")
    clients: list[DemoClient] = []
    try:
        alice = await DemoClient.connect(gateway.port, "Alice", transcript)
        bob = await DemoClient.connect(gateway.port, "Bob", transcript)
        carol = await DemoClient.connect(gateway.port, "Carol", transcript)
        clients.extend([alice, bob, carol])

        await alice.send(
            "CREATE_ROOM_REQ",
            seq=2,
            payload={
                "room_name": "AI AWD Demo",
                "max_players": 2,
                "target_template_id": "real_ctf_web_awd_01",
                "agent_runtime": "demo-agent",
                "model_display_name": "model-alpha",
                "allow_spectators": True,
                "phase_seconds": {"prepare": 1, "defense": 1, "attack": 5},
            },
        )
        create_res = await alice.read_type("CREATE_ROOM_RES")
        room_id = create_res.payload["room"]["room_id"]

        await bob.send(
            "JOIN_ROOM_REQ",
            seq=2,
            room_id=room_id,
            role="player",
            payload={"display_name": "Bob", "agent_runtime": "demo-agent", "model_display_name": "model-beta"},
        )
        await bob.read_type("JOIN_ROOM_RES")

        await carol.send("JOIN_ROOM_REQ", seq=2, room_id=room_id, role="spectator", payload={"display_name": "Carol"})
        await carol.read_type("JOIN_ROOM_RES")

        await alice.send("START_MATCH_REQ", seq=3, room_id=room_id, role="player")
        start_res = await alice.read_type("START_MATCH_RES")
        config_b = await bob.read_type("MATCH_CONFIG")

        await alice.read_until(
            lambda message: message.type == "PHASE_SYNC" and message.payload["match"]["phase"] == "ATTACK",
            "ATTACK phase",
        )
        await alice.send(
            "SUBMIT_FLAG_REQ",
            seq=4,
            room_id=room_id,
            role="player",
            payload={
                "match_id": start_res.payload["match"]["match_id"],
                "claimed_target_team_id": "team_b",
                "flag": config_b.payload["flag"],
                "source": "demo",
            },
        )
        await alice.read_type("SUBMIT_FLAG_RES")
        await carol.read_until(
            lambda message: message.type == "RANKING_UPDATE"
            and message.payload["rankings"][0]["team_id"] == "team_a"
            and message.payload["rankings"][0]["score"] == 100,
            "post-flag ranking",
        )
        return transcript
    finally:
        for client in clients:
            client.close()
        await gateway.stop()


def main() -> None:
    for line in asyncio.run(run_demo()):
        print(line)


if __name__ == "__main__":
    main()
