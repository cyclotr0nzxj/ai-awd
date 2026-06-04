from __future__ import annotations

from itertools import count
from time import time
from typing import Any

from .models import Session


class SessionManager:
    def __init__(self) -> None:
        self._counter = count(1)
        self.sessions: dict[str, Session] = {}

    def create_session(self, payload: dict[str, Any], writer: Any | None = None) -> Session:
        client_id = f"client_{next(self._counter):04d}"
        session = Session(
            client_id=client_id,
            display_name=str(payload.get("display_name") or client_id),
            platform=str(payload.get("platform") or ""),
            capabilities=list(payload.get("capabilities") or []),
            writer=writer,
        )
        self.sessions[client_id] = session
        return session

    def get(self, client_id: str | None) -> Session | None:
        if not client_id:
            return None
        return self.sessions.get(client_id)

    def touch(self, client_id: str | None) -> None:
        session = self.get(client_id)
        if session:
            session.last_seen_at = time()

    def disconnect(self, client_id: str | None) -> Session | None:
        session = self.get(client_id)
        if session:
            session.writer = None
        return session
