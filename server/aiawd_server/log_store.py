from __future__ import annotations

import json
from pathlib import Path
from time import time
from typing import Any


class LogStore:
    def __init__(self, path: str | Path = "logs/server/events.jsonl") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        event = {"ts": time(), "type": event_type, "payload": payload}
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
        return event

    def recent(self, room_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        results: list[dict[str, Any]] = []
        with self.path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                payload = event.get("payload") or {}
                rid = payload.get("room_id") or event.get("room_id") or ""
                if rid == room_id:
                    results.append(event)
        return results[-limit:]
