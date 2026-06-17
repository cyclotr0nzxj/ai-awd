"""Minimal async HTTP/1.1 API server — standard library only.

Shares state with TCPGateway: RoomManager, MatchEngine, TargetRegistry, SessionManager.
All endpoints are read-only GET. Responses are JSON with CORS headers.
Private flags are never exposed.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from .log_store import LogStore
from .match_engine import MatchEngine
from .room_manager import RoomError, RoomManager
from .session_manager import SessionManager
from .target_registry import TargetRegistry


MAX_HEADERS = 64
MAX_BODY = 8192
CORS_HEADERS = (
    b"Access-Control-Allow-Origin: *\r\n"
    b"Access-Control-Allow-Methods: GET, OPTIONS\r\n"
    b"Access-Control-Allow-Headers: Content-Type\r\n"
)


class HttpApiServer:
    def __init__(
        self,
        *,
        host: str = "127.0.0.1",
        port: int = 9001,
        session_manager: SessionManager | None = None,
        room_manager: RoomManager | None = None,
        match_engine: MatchEngine | None = None,
        target_registry: TargetRegistry | None = None,
        log_store: LogStore | None = None,
    ) -> None:
        self.host = host
        self.port = port
        self.session_manager = session_manager or SessionManager()
        self.room_manager = room_manager or RoomManager()
        self.match_engine = match_engine or MatchEngine()
        self.target_registry = target_registry or TargetRegistry()
        self.log_store = log_store or LogStore()
        self._server: asyncio.AbstractServer | None = None

    async def start(self) -> None:
        self._server = await asyncio.start_server(
            self._handle, host=self.host, port=self.port
        )
        if self.port == 0 and self._server.sockets:
            self.port = self._server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    async def serve_forever(self) -> None:
        if self._server:
            async with self._server:
                await self._server.serve_forever()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request = await asyncio.wait_for(_read_request(reader), timeout=10)
        except (TimeoutError, asyncio.TimeoutError, asyncio.IncompleteReadError, OSError, ConnectionResetError):
            try:
                writer.close()
            except OSError:
                pass
            return

        if request is None:
            try:
                writer.close()
            except OSError:
                pass
            return

        method, path, _headers = request
        if method == b"OPTIONS":
            await _send(writer, 204, None)
            return

        if method != b"GET":
            await _send(writer, 405, {"error": "method not allowed"})
            return

        status, body = self._route(path)
        await _send(writer, status, body)

    def _route(self, path: bytes) -> tuple[int, dict[str, Any] | None]:
        try:
            return self._route_impl(path)
        except RoomError:
            return 404, {"error": "not found"}
        except Exception as exc:
            self.log_store.append("HTTP_ERROR", {
                "path": path.decode("utf-8", errors="replace"),
                "error": str(exc),
                "type": type(exc).__name__,
            })
            return 500, {"error": "internal server error"}

    def _route_impl(self, path: bytes) -> tuple[int, dict[str, Any] | None]:
        p = path.decode("utf-8", errors="replace")

        if p == "/health":
            return 200, {
                "ok": True,
                "server": "ai-awd-arena",
                "clients": len(self.session_manager.sessions),
            }

        if p == "/api/v1/targets":
            return 200, {"targets": self.target_registry.list_targets()}

        if p == "/api/v1/rooms":
            rooms = self.room_manager.list_rooms()
            return 200, {"rooms": rooms}

        if p.startswith("/api/v1/rooms/") and p.endswith("/rankings"):
            room_id = p[len("/api/v1/rooms/"):-len("/rankings")]
            if not room_id:
                return 404, {"error": "room not found"}
            room = self.room_manager.get_room(room_id)
            if not room:
                return 404, {"error": "room not found"}
            rankings = self.match_engine.rankings(room)
            return 200, {"rankings": rankings}

        if p.startswith("/api/v1/rooms/") and p.endswith("/events"):
            room_id = p[len("/api/v1/rooms/"):-len("/events")]
            if not room_id:
                return 404, {"error": "room not found"}
            events = self.log_store.recent(room_id, limit=20)
            return 200, {"events": _redact_events(events)}

        if p.startswith("/api/v1/rooms/"):
            room_id = p[len("/api/v1/rooms/"):]
            if not room_id:
                return 404, {"error": "room not found"}
            room = self.room_manager.get_room(room_id)
            if not room:
                return 404, {"error": "room not found"}
            return 200, {"room": room.public_snapshot()}

        if p.startswith("/api/v1/matches/"):
            match_id = p[len("/api/v1/matches/"):]
            if not match_id:
                return 404, {"error": "match not found"}
            match = None
            for m in self.match_engine.matches.values():
                if m.match_id == match_id:
                    match = m
                    break
            if not match:
                return 404, {"error": "match not found"}
            return 200, {"match": match.public_snapshot()}

        return 404, {"error": "not found"}


async def _read_request(reader: asyncio.StreamReader) -> tuple[bytes, bytes, list[tuple[bytes, bytes]]] | None:
    line = await reader.readline()
    if not line:
        return None
    parts = line.split(b" ", 2)
    if len(parts) < 2:
        return None
    method, path = parts[0], parts[1]
    headers: list[tuple[bytes, bytes]] = []
    for _ in range(MAX_HEADERS):
        header_line = await reader.readline()
        if header_line in {b"\r\n", b"\n", b""}:
            break
        if b":" in header_line:
            key, value = header_line.split(b":", 1)
            headers.append((key.strip(), value.strip()))
    return method, path, headers


async def _send(writer: asyncio.StreamWriter, status: int, body: dict[str, Any] | None) -> None:
    body_bytes = b""
    if body is not None:
        body_bytes = json.dumps(body, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    reason = {200: "OK", 204: "No Content", 404: "Not Found", 405: "Method Not Allowed", 500: "Internal Server Error"}.get(status, "OK")
    writer.write(f"HTTP/1.1 {status} {reason}\r\n".encode())
    writer.write(b"Content-Type: application/json; charset=utf-8\r\n")
    writer.write(CORS_HEADERS)
    writer.write(f"Content-Length: {len(body_bytes)}\r\n".encode())
    writer.write(b"\r\n")
    writer.write(body_bytes)
    await writer.drain()
    writer.close()
    await writer.wait_closed()


def _redact_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    import copy
    redacted = []
    for event in events:
        e = copy.deepcopy(event)
        _redact_dict(e)
        redacted.append(e)
    return redacted


_REDACT_KEYS = {"flag", "flag_plaintext", "AIAWD_FLAG"}


def _redact_dict(d: dict[str, Any]) -> None:
    for key, value in d.items():
        if key in _REDACT_KEYS and isinstance(value, str):
            d[key] = "FLAG{已隐藏}"
        elif isinstance(value, dict):
            _redact_dict(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _redact_dict(item)
