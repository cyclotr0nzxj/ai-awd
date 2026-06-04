from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from time import time
from typing import Any


class Role(StrEnum):
    PLAYER = "player"
    SPECTATOR = "spectator"


class Phase(StrEnum):
    LOBBY = "LOBBY"
    PREPARE = "PREPARE"
    DEFENSE = "DEFENSE"
    ATTACK = "ATTACK"
    FINISHED = "FINISHED"


class MemberStatus(StrEnum):
    JOINED = "JOINED"
    DISCONNECTED = "DISCONNECTED"


@dataclass(slots=True)
class Session:
    client_id: str
    display_name: str = ""
    platform: str = ""
    capabilities: list[str] = field(default_factory=list)
    seen_seq: set[int] = field(default_factory=set)
    role: Role | None = None
    room_id: str | None = None
    team_id: str | None = None
    last_seen_at: float = field(default_factory=time)
    writer: Any | None = field(default=None, repr=False)

    def public_snapshot(self) -> dict[str, Any]:
        return {
            "client_id": self.client_id,
            "display_name": self.display_name,
            "platform": self.platform,
            "capabilities": self.capabilities,
            "role": self.role.value if self.role else None,
            "room_id": self.room_id,
            "team_id": self.team_id,
            "last_seen_at": self.last_seen_at,
        }


@dataclass(slots=True)
class RoomMember:
    room_id: str
    client_id: str
    role: Role
    display_name: str
    agent_runtime: str = "mock-agent"
    model_display_name: str = "mock-model"
    team_id: str | None = None
    status: MemberStatus = MemberStatus.JOINED
    score: int = 0
    target_ready: bool = False
    agent_ready: bool = False

    def public_snapshot(self) -> dict[str, Any]:
        return {
            "room_id": self.room_id,
            "client_id": self.client_id,
            "role": self.role.value,
            "display_name": self.display_name,
            "agent_runtime": self.agent_runtime,
            "model_display_name": self.model_display_name,
            "team_id": self.team_id,
            "status": self.status.value,
            "score": self.score,
            "target_ready": self.target_ready,
            "agent_ready": self.agent_ready,
        }


@dataclass(slots=True)
class Room:
    room_id: str
    room_name: str
    owner_client_id: str
    max_players: int
    target_template_id: str
    allow_spectators: bool = True
    phase_seconds: dict[str, float] = field(default_factory=dict)
    status: Phase = Phase.LOBBY
    members: dict[str, RoomMember] = field(default_factory=dict)
    created_at: float = field(default_factory=time)

    def players(self) -> list[RoomMember]:
        return [member for member in self.members.values() if member.role == Role.PLAYER]

    def spectators(self) -> list[RoomMember]:
        return [member for member in self.members.values() if member.role == Role.SPECTATOR]

    def public_snapshot(self) -> dict[str, Any]:
        return {
            "room_id": self.room_id,
            "room_name": self.room_name,
            "owner_client_id": self.owner_client_id,
            "status": self.status.value,
            "max_players": self.max_players,
            "allow_spectators": self.allow_spectators,
            "target_template_id": self.target_template_id,
            "phase_seconds": self.phase_seconds,
            "players": [member.public_snapshot() for member in self.players()],
            "spectators": [member.public_snapshot() for member in self.spectators()],
            "created_at": self.created_at,
        }


@dataclass(slots=True)
class Match:
    match_id: str
    room_id: str
    phase: Phase = Phase.PREPARE
    phase_started_at: float = field(default_factory=time)
    phase_ends_at: float | None = None
    status: str = "RUNNING"

    def public_snapshot(self) -> dict[str, Any]:
        return {
            "match_id": self.match_id,
            "room_id": self.room_id,
            "phase": self.phase.value,
            "phase_started_at": self.phase_started_at,
            "phase_ends_at": self.phase_ends_at,
            "status": self.status,
        }


@dataclass(slots=True)
class FlagRecord:
    room_id: str
    match_id: str
    team_id: str
    flag_hash: str
    flag_plaintext: str
    captured: bool = False


@dataclass(slots=True)
class Submission:
    submission_id: str
    room_id: str
    match_id: str
    submitter_team_id: str
    target_team_id: str | None
    flag_hash: str
    valid: bool
    code: str
    score_delta: int
    submitted_at: float = field(default_factory=time)

    def public_snapshot(self) -> dict[str, Any]:
        return {
            "submission_id": self.submission_id,
            "room_id": self.room_id,
            "match_id": self.match_id,
            "submitter_team_id": self.submitter_team_id,
            "target_team_id": self.target_team_id,
            "valid": self.valid,
            "code": self.code,
            "score_delta": self.score_delta,
            "submitted_at": self.submitted_at,
        }
