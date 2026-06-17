from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field
from time import time
from typing import Any


PROTOCOL_VERSION = 1
MAX_FRAME_BYTES = 1024 * 1024
HEADER_BYTES = 4


class ProtocolError(ValueError):
    """Raised when an AIAWD/1.0 frame or message is malformed."""


@dataclass(slots=True)
class Message:
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    seq: int | None = None
    client_id: str | None = None
    room_id: str | None = None
    role: str | None = None
    ts: float | None = None
    v: int = PROTOCOL_VERSION

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Message":
        if not isinstance(raw, dict):
            raise ProtocolError("Message body must be a JSON object")
        if raw.get("v", PROTOCOL_VERSION) != PROTOCOL_VERSION:
            raise ProtocolError("Unsupported protocol version")
        msg_type = raw.get("type")
        if not isinstance(msg_type, str) or not msg_type:
            raise ProtocolError("Message type is required")
        payload = raw.get("payload", {})
        if payload is None:
            payload = {}
        if not isinstance(payload, dict):
            raise ProtocolError("Message payload must be an object")
        seq = raw.get("seq")
        if seq is not None and not isinstance(seq, int):
            raise ProtocolError("Message seq must be an integer")
        return cls(
            type=msg_type,
            payload=payload,
            seq=seq,
            client_id=_optional_str(raw.get("client_id"), "client_id"),
            room_id=_optional_str(raw.get("room_id"), "room_id"),
            role=_optional_str(raw.get("role"), "role"),
            ts=raw.get("ts") if isinstance(raw.get("ts"), (int, float)) else None,
            v=PROTOCOL_VERSION,
        )

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "v": self.v,
            "seq": self.seq,
            "type": self.type,
            "client_id": self.client_id,
            "room_id": self.room_id,
            "role": self.role,
            "ts": self.ts if self.ts is not None else time(),
            "payload": self.payload,
        }
        return {key: value for key, value in data.items() if value is not None}


def encode_message(message: Message | dict[str, Any]) -> bytes:
    if isinstance(message, Message):
        body = message.to_dict()
    else:
        body = message
    try:
        encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ProtocolError(f"Message is not JSON serializable: {exc}") from exc
    if len(encoded) > MAX_FRAME_BYTES:
        raise ProtocolError("Message exceeds maximum frame size")
    return struct.pack(">I", len(encoded)) + encoded


def decode_body(body: bytes) -> Message:
    if len(body) > MAX_FRAME_BYTES:
        raise ProtocolError("Message exceeds maximum frame size")
    try:
        raw = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProtocolError(f"Invalid JSON body: {exc}") from exc
    return Message.from_dict(raw)


class FrameDecoder:
    def __init__(self, *, max_frame_bytes: int = MAX_FRAME_BYTES) -> None:
        self._buffer = bytearray()
        self._max_frame_bytes = max_frame_bytes

    def feed(self, data: bytes) -> list[Message]:
        self._buffer.extend(data)
        messages: list[Message] = []
        while True:
            if len(self._buffer) < HEADER_BYTES:
                break
            frame_len = struct.unpack(">I", self._buffer[:HEADER_BYTES])[0]
            if frame_len <= 0:
                raise ProtocolError("Frame length must be positive")
            if frame_len > self._max_frame_bytes:
                raise ProtocolError("Frame exceeds maximum size")
            if len(self._buffer) < HEADER_BYTES + frame_len:
                break
            body = bytes(self._buffer[HEADER_BYTES : HEADER_BYTES + frame_len])
            del self._buffer[: HEADER_BYTES + frame_len]
            messages.append(decode_body(body))
        return messages


async def read_message(reader: Any) -> Message:
    header = await reader.readexactly(HEADER_BYTES)
    frame_len = struct.unpack(">I", header)[0]
    if frame_len <= 0:
        raise ProtocolError("Frame length must be positive")
    if frame_len > MAX_FRAME_BYTES:
        raise ProtocolError("Frame exceeds maximum size")
    body = await reader.readexactly(frame_len)
    return decode_body(body)


async def write_message(writer: Any, message: Message | dict[str, Any]) -> None:
    writer.write(encode_message(message))
    await writer.drain()


def make_error(
    code: str,
    message: str,
    *,
    seq: int | None = None,
    client_id: str | None = None,
    room_id: str | None = None,
) -> Message:
    return Message(
        type="ERROR",
        seq=seq,
        client_id=client_id,
        room_id=room_id,
        payload={"code": code, "message": message},
    )


def _optional_str(value: Any, field_name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ProtocolError(f"{field_name} must be a string")
    return value
