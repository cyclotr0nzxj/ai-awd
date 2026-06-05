"""Packet capture evidence collector for AI-AWD matches.

Captures HTTP/TCP traffic metadata during agent attack runs. Produces
standard PCAP files (readable by Wireshark/tcpdump) and JSON evidence logs.
All flag data is redacted from capture output.

PCAP format reference: https://wiki.wireshark.org/Development/LibpcapFileFormat
"""

from __future__ import annotations

import json
import struct
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlparse


LINKTYPE_ETHERNET = 1
LINKTYPE_RAW = 101
PCAP_MAGIC = 0xA1B2C3D4
PCAP_VERSION_MAJOR = 2
PCAP_VERSION_MINOR = 4
PCAP_GLOBAL_HEADER = struct.Struct("<IHHiIII")
PCAP_PACKET_HEADER = struct.Struct("<IIII")

FLAG_REDACT = b"FLAG{REDACTED_FLAG_DATA_HIDDEN}"
FLAG_PATTERN = b"FLAG{[A-Za-z0-9_/-]+}"


@dataclass(slots=True)
class PacketRecord:
    timestamp: float
    src_host: str
    src_port: int
    dst_host: str
    dst_port: int
    protocol: str
    method: str
    path: str
    status: int | None
    request_bytes: int
    response_bytes: int
    duration_ms: float | None

    def redacted_path(self) -> str:
        if "flag" in self.path.lower():
            return "/redacted_flag_path"
        return self.path

    def summary(self) -> dict[str, Any]:
        return {
            "ts": self.timestamp,
            "src": f"{self.src_host}:{self.src_port}",
            "dst": f"{self.dst_host}:{self.dst_port}",
            "proto": self.protocol,
            "method": self.method,
            "path": self.redacted_path(),
            "status": self.status,
            "req_bytes": self.request_bytes,
            "resp_bytes": self.response_bytes,
            "duration_ms": self.duration_ms,
        }


@dataclass(slots=True)
class CaptureSession:
    session_id: str
    room_id: str
    team_id: str
    match_id: str
    allowed_targets: list[str]
    started_at: float = field(default_factory=time.time)
    packets: list[PacketRecord] = field(default_factory=list)

    def add(self, record: PacketRecord) -> None:
        url = f"{record.dst_host}:{record.dst_port}"
        for allowed in self.allowed_targets:
            parsed = urlparse(allowed)
            if parsed.hostname == record.dst_host and str(parsed.port or 80) == str(record.dst_port):
                self.packets.append(record)
                return

    @property
    def total_bytes(self) -> int:
        return sum(p.request_bytes + p.response_bytes for p in self.packets)

    @property
    def duration_sec(self) -> float:
        return time.time() - self.started_at


class PcapCollector:
    def __init__(
        self,
        *,
        room_id: str = "",
        team_id: str = "",
        match_id: str = "",
        allowed_targets: list[str] | None = None,
        snaplen: int = 65535,
    ) -> None:
        self._session = CaptureSession(
            session_id=f"pcap_{int(time.time())}",
            room_id=room_id,
            team_id=team_id,
            match_id=match_id,
            allowed_targets=allowed_targets or [],
        )
        self._snaplen = snaplen
        self._active = False

    @property
    def session(self) -> CaptureSession:
        return self._session

    @property
    def active(self) -> bool:
        return self._active

    def start(self) -> None:
        self._active = True
        self._session.started_at = time.time()

    def stop(self) -> None:
        self._active = False

    def record_http(
        self,
        *,
        method: str = "GET",
        url: str = "",
        status: int | None = None,
        request_bytes: int = 0,
        response_bytes: int = 0,
        duration_ms: float | None = None,
    ) -> PacketRecord | None:
        if not self._active:
            return None
        parsed = urlparse(url)
        record = PacketRecord(
            timestamp=time.time(),
            src_host="127.0.0.1",
            src_port=0,
            dst_host=parsed.hostname or "127.0.0.1",
            dst_port=parsed.port or 80,
            protocol="TCP",
            method=method,
            path=parsed.path or "/",
            status=status,
            request_bytes=request_bytes,
            response_bytes=response_bytes,
            duration_ms=duration_ms,
        )
        self._session.add(record)
        return record

    def record_tcp(
        self,
        *,
        host: str = "127.0.0.1",
        port: int = 0,
        sent_bytes: int = 0,
        recv_bytes: int = 0,
        duration_ms: float | None = None,
    ) -> PacketRecord | None:
        if not self._active:
            return None
        record = PacketRecord(
            timestamp=time.time(),
            src_host="127.0.0.1",
            src_port=0,
            dst_host=host,
            dst_port=port,
            protocol="TCP",
            method="DATA",
            path="/",
            status=None,
            request_bytes=sent_bytes,
            response_bytes=recv_bytes,
            duration_ms=duration_ms,
        )
        self._session.add(record)
        return record

    def write_json(self, path: str | Path) -> Path:
        out = Path(path)
        out.parent.mkdir(parents=True, exist_ok=True)
        evidence = {
            "session_id": self._session.session_id,
            "room_id": self._session.room_id,
            "team_id": self._session.team_id,
            "match_id": self._session.match_id,
            "started_at": self._session.started_at,
            "duration_sec": self._session.duration_sec,
            "total_bytes": self._session.total_bytes,
            "packet_count": len(self._session.packets),
            "packets": [p.summary() for p in self._session.packets],
        }
        out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return out

    def write_pcap(self, path: str | Path) -> Path:
        out = Path(path)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("wb") as f:
            f.write(_pcap_global_header(self._snaplen))
            for record in self._session.packets:
                packet_data = _build_synthetic_packet(record)
                ts_sec = int(record.timestamp)
                ts_usec = int((record.timestamp - ts_sec) * 1_000_000)
                incl_len = min(len(packet_data), self._snaplen)
                f.write(PCAP_PACKET_HEADER.pack(ts_sec, ts_usec, incl_len, len(packet_data)))
                f.write(packet_data[:incl_len])
        return out

    def write_evidence(self, dir_path: str | Path) -> dict[str, Path]:
        base = Path(dir_path)
        base.mkdir(parents=True, exist_ok=True)
        prefix = f"{self._session.session_id}"
        json_path = self.write_json(base / f"{prefix}.json")
        pcap_path = self.write_pcap(base / f"{prefix}.pcap")
        return {"json": json_path, "pcap": pcap_path}


@contextmanager
def capture_session(
    *,
    room_id: str = "",
    team_id: str = "",
    match_id: str = "",
    allowed_targets: list[str] | None = None,
) -> Iterator[PcapCollector]:
    collector = PcapCollector(
        room_id=room_id,
        team_id=team_id,
        match_id=match_id,
        allowed_targets=allowed_targets,
    )
    collector.start()
    try:
        yield collector
    finally:
        collector.stop()


# -- pcap binary helpers --

def _pcap_global_header(snaplen: int) -> bytes:
    return PCAP_GLOBAL_HEADER.pack(
        PCAP_MAGIC,
        PCAP_VERSION_MAJOR,
        PCAP_VERSION_MINOR,
        0,  # thiszone (UTC)
        0,  # sigfigs
        snaplen,
        LINKTYPE_RAW,
    )


def _build_synthetic_packet(record: PacketRecord) -> bytes:
    import re

    path = record.redacted_path()
    status_str = str(record.status) if record.status else "-"
    summary = (
        f"{record.method} {path} {status_str} | "
        f"{record.src_host}:{record.src_port} -> {record.dst_host}:{record.dst_port} | "
        f"req={record.request_bytes} resp={record.response_bytes}"
    )
    payload = summary.encode("utf-8", errors="replace")
    payload = re.sub(FLAG_PATTERN, FLAG_REDACT, payload)
    return payload
