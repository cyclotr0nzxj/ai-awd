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
