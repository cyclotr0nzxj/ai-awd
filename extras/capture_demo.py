#!/usr/bin/env python3
"""
AIAWD/1.0 Capture Demo — single-process capture server + Alice/Bob/Carol demo.
Replaces: tcpdump + three_clients_demo.py — everything runs in ONE process,
so protocol-level capture works without BPF / sudo / Wireshark permissions.

Usage:
  PYTHONPATH=server python3 extras/capture_demo.py

Output:
  captures/aiawd_capture_<ts>.pcap   — 标准 PCAP，Wireshark 可直接打开
  captures/aiawd_capture_<ts>.jsonl  — 人类可读帧日志
  Terminal transcript                — 完整交互过程
"""

from __future__ import annotations

import asyncio
import json
import struct
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

# ---- Patch protocol BEFORE importing gateway ----
import aiawd_server.protocol as protocol_mod

CAPTURES_DIR = ROOT / "captures"
CAPTURES_DIR.mkdir(parents=True, exist_ok=True)

LINKTYPE_ETHERNET = 1
PCAP_GLOBAL_HEADER = struct.pack("<IHHiIII", 0xa1b2c3d4, 2, 4, 0, 0, 65535, LINKTYPE_ETHERNET)


def _fake_eth() -> bytes:
    return b"\x00" * 6 + b"\x00" * 6 + b"\x08\x00"


def _fake_ip4(payload_len: int, src: bytes, dst: bytes) -> bytes:
    return struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + payload_len, 0, 0x4000, 64, 6, 0, src, dst)


def _fake_tcp(payload_len: int, sport: int, dport: int) -> bytes:
    return struct.pack("!HHIIBBHHH", sport, dport, 0, 0, 0x50, 0x18, 65535, 0, 0)


class FrameCapture:
    def __init__(self):
        ts = int(time.time())
        self.pcap_path = CAPTURES_DIR / f"aiawd_capture_{ts}.pcap"
        self.jsonl_path = CAPTURES_DIR / f"aiawd_capture_{ts}.jsonl"
        self._pcap = open(str(self.pcap_path), "wb")
        self._pcap.write(PCAP_GLOBAL_HEADER)
        self._jsonl = open(str(self.jsonl_path), "w", encoding="utf-8")
        self._orig_read = protocol_mod.read_message
        self._orig_write = protocol_mod.write_message
        self._n = 0

    def install(self) -> None:
        cap = self

        async def patched_write(writer, message):
            raw = protocol_mod.encode_message(message)
            cap._record("S→C", raw)
            writer.write(raw)
            await writer.drain()

        async def patched_read(reader):
            msg = await cap._orig_read(reader)
            raw = protocol_mod.encode_message(msg.to_dict())
            cap._record("C→S", raw)
            return msg

        protocol_mod.write_message = patched_write
        protocol_mod.read_message = patched_read

    def _record(self, direction: str, raw: bytes) -> None:
        self._n += 1
        ts = time.time()
        ts_sec, ts_usec = int(ts), int((ts - int(ts)) * 1_000_000)
        src_ip = b"\x7f\x00\x00\x01" if direction == "S→C" else b"\x7f\x00\x00\x02"
        dst_ip = b"\x7f\x00\x00\x02" if direction == "S→C" else b"\x7f\x00\x00\x01"
        sport, dport = (9001, 12345) if direction == "S→C" else (12345, 9001)
        packet = _fake_eth() + _fake_ip4(len(raw), src_ip, dst_ip) + _fake_tcp(len(raw), sport, dport) + raw
        self._pcap.write(struct.pack("<IIII", ts_sec, ts_usec, len(packet), len(packet)) + packet)
        self._pcap.flush()

        hdr_len = struct.unpack(">I", raw[:4])[0] if len(raw) >= 4 else 0
        try:
            body = json.loads(raw[4:4 + hdr_len].decode())
        except Exception:
            body = {}
        self._jsonl.write(json.dumps({
            "n": self._n, "ts": ts, "dir": direction,
            "bytes": len(raw), "type": body.get("type"),
        }, ensure_ascii=False) + "\n")
        self._jsonl.flush()

    def close(self) -> None:
        self._pcap.close()
        self._jsonl.close()


# ---- Install capture globally (patches protocol module) ----
capture = FrameCapture()
capture.install()

# ---- Now import the rest ----
from aiawd_server.tcp_gateway import TCPGateway
from aiawd_server.log_store import LogStore
from aiawd_server.protocol import Message, read_message, write_message


class DemoClient:
    def __init__(self, name: str, reader, writer, client_id: str, transcript: list[str]):
        self.name = name
        self.reader = reader
        self.writer = writer
        self.client_id = client_id
        self.transcript = transcript
        self.inbox: list[Message] = []

    @classmethod
    async def connect(cls, port: int, name: str, transcript: list[str]) -> "DemoClient":
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        await write_message(writer, Message(
            type="HELLO", seq=1,
            payload={"display_name": name, "platform": "demo", "capabilities": ["player", "spectator"]},
        ))
        welcome = await read_message(reader)
        transcript.append(f"{name} <- {welcome.type} client_id={welcome.payload.get('client_id','?')}")
        return cls(name, reader, writer, welcome.payload["client_id"], transcript)

    async def send(self, msg_type: str, *, seq: int, payload=None, room_id=None, role=None):
        self.transcript.append(f"{self.name} -> {msg_type}")
        await write_message(self.writer, Message(
            type=msg_type, seq=seq, client_id=self.client_id,
            room_id=room_id, role=role, payload=payload or {},
        ))

    async def read_until(self, predicate, label):
        for i, m in enumerate(self.inbox):
            if predicate(m):
                return self.inbox.pop(i)
        while True:
            m = await asyncio.wait_for(read_message(self.reader), timeout=10)
            if predicate(m):
                return m
            self.inbox.append(m)

    async def read_type(self, msg_type):
        return await self.read_until(lambda m: m.type == msg_type, msg_type)

    def close(self):
        self.writer.close()


async def run_capture_demo():
    transcript: list[str] = []
    print("=" * 60)
    print(" AIAWD/1.0 Capture Demo")
    print(f" PCAP:  {capture.pcap_path}")
    print(f" JSONL: {capture.jsonl_path}")
    print("=" * 60)
    print()

    # 1. Start gateway
    gateway = TCPGateway(host="127.0.0.1", port=0, log_store=LogStore(ROOT / "logs" / "server" / "events.jsonl"))
    await gateway.start()
    print(f"Server listening on 127.0.0.1:{gateway.port}")
    print()

    clients = []
    try:
        # 2. Three clients connect
        alice = await DemoClient.connect(gateway.port, "Alice", transcript)
        bob = await DemoClient.connect(gateway.port, "Bob", transcript)
        carol = await DemoClient.connect(gateway.port, "Carol", transcript)
        clients = [alice, bob, carol]
        print("Alice, Bob, Carol connected.\n")

        # 3. Alice creates room
        await alice.send("CREATE_ROOM_REQ", seq=2, payload={
            "room_name": "Capture Demo", "max_players": 2,
            "target_template_id": "real_ctf_web_awd_01",
            "agent_runtime": "demo-agent", "model_display_name": "model-a",
            "allow_spectators": True,
            "phase_seconds": {"prepare": 1, "defense": 1, "attack": 5},
        })
        res = await alice.read_type("CREATE_ROOM_RES")
        room_id = res.payload["room"]["room_id"]
        print(f"Room created: {room_id}")
        _log_phase(transcript, "LOBBY")

        # 4. Bob joins as player
        await bob.send("JOIN_ROOM_REQ", seq=2, room_id=room_id, role="player",
                       payload={"display_name": "Bob", "agent_runtime": "demo-agent", "model_display_name": "model-b"})
        await bob.read_type("JOIN_ROOM_RES")
        print("Bob joined as player.")

        # 5. Carol joins as spectator
        await carol.send("JOIN_ROOM_REQ", seq=2, room_id=room_id, role="spectator", payload={"display_name": "Carol"})
        await carol.read_type("JOIN_ROOM_RES")
        print("Carol joined as spectator.")

        # 6. Alice starts match
        await alice.send("START_MATCH_REQ", seq=3, room_id=room_id, role="player")
        start_res = await alice.read_type("START_MATCH_RES")
        match_id = start_res.payload["match"]["match_id"]
        print(f"Match started: {match_id}")

        # 7. Bob reads his MATCH_CONFIG (contains his flag — redacted in log)
        config_b = await bob.read_type("MATCH_CONFIG")

        # 8. Wait for ATTACK phase
        print("Waiting for ATTACK phase...")
        await alice.read_until(lambda m: m.type == "PHASE_SYNC" and m.payload.get("match", {}).get("phase") == "ATTACK", "ATTACK")
        _log_phase(transcript, "ATTACK")
        print("ATTACK phase — Alice submits Bob's flag\n")

        # 9. Alice submits Bob's flag
        await alice.send("SUBMIT_FLAG_REQ", seq=4, room_id=room_id, role="player", payload={
            "match_id": match_id,
            "claimed_target_team_id": "team_b",
            "flag": config_b.payload["flag"],
            "source": "demo",
        })
        sub_res = await alice.read_type("SUBMIT_FLAG_RES")
        print(f"Flag submitted: {'OK' if sub_res.payload.get('ok') else 'REJECTED'}")

        # 10. Wait for ranking update to propagate
        await carol.read_until(lambda m: m.type == "RANKING_UPDATE" and m.payload.get("rankings", [{}])[0].get("team_id") == "team_a", "RANKING")
        print("Ranking updated — team_a leads.\n")

        _log_phase(transcript, "FINISHED")
        print("=" * 60)
        print(" Demo complete.")
        print(f" PCAP:  {capture.pcap_path}")
        print(f" JSONL: {capture.jsonl_path}")
        print(f" Frames captured: {capture._n}")
        print("=" * 60)

    finally:
        for c in clients:
            c.close()
        await gateway.stop()
        capture.close()


def _log_phase(t: list[str], phase: str) -> None:
    t.append(f"--- {phase} ---")


def main():
    asyncio.run(run_capture_demo())


if __name__ == "__main__":
    main()
