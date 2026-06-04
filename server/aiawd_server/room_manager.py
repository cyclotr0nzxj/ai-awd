from __future__ import annotations

from itertools import count
from typing import Any

from .models import MemberStatus, Phase, Role, Room, RoomMember, Session


class RoomError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class RoomManager:
    def __init__(self) -> None:
        self._counter = count(1)
        self.rooms: dict[str, Room] = {}

    def list_rooms(self) -> list[dict[str, Any]]:
        return [room.public_snapshot() for room in self.rooms.values()]

    def get_room(self, room_id: str | None) -> Room:
        if not room_id or room_id not in self.rooms:
            raise RoomError("ROOM_NOT_FOUND", "房间不存在")
        return self.rooms[room_id]

    def create_room(self, owner: Session, payload: dict[str, Any]) -> Room:
        max_players = int(payload.get("max_players") or 2)
        if max_players < 1:
            raise RoomError("BAD_REQUEST", "参赛人数必须大于 0")
        room_id = f"room_{next(self._counter):03d}"
        phase_seconds = payload.get("phase_seconds") or {}
        if not isinstance(phase_seconds, dict):
            raise RoomError("BAD_REQUEST", "阶段时长配置必须是对象")
        room = Room(
            room_id=room_id,
            room_name=str(payload.get("room_name") or room_id),
            owner_client_id=owner.client_id,
            max_players=max_players,
            target_template_id=str(payload.get("target_template_id") or "real_ctf_web_awd_01"),
            allow_spectators=bool(payload.get("allow_spectators", True)),
            phase_seconds={
                "prepare": float(phase_seconds.get("prepare", 60)),
                "defense": float(phase_seconds.get("defense", 300)),
                "attack": float(phase_seconds.get("attack", 600)),
            },
        )
        self.rooms[room_id] = room
        self.join_room(owner, room_id, Role.PLAYER, payload)
        return room

    def join_room(
        self,
        session: Session,
        room_id: str,
        role: Role | str,
        payload: dict[str, Any] | None = None,
    ) -> RoomMember:
        payload = payload or {}
        room = self.get_room(room_id)
        role = Role(role)
        if room.status != Phase.LOBBY:
            raise RoomError("INVALID_PHASE", "房间进入大厅阶段后不可再加入")
        if role == Role.SPECTATOR and not room.allow_spectators:
            raise RoomError("INVALID_ROLE", "该房间不允许观战")
        if role == Role.PLAYER and session.client_id not in room.members:
            if len(room.players()) >= room.max_players:
                raise RoomError("ROOM_FULL", "房间已满")
        if session.client_id in room.members:
            member = room.members[session.client_id]
            if member.role != role:
                raise RoomError("INVALID_ROLE", "客户端已使用其他身份加入")
        else:
            team_id = None
            if role == Role.PLAYER:
                team_id = f"team_{chr(ord('a') + len(room.players()))}"
            member = RoomMember(
                room_id=room_id,
                client_id=session.client_id,
                role=role,
                display_name=str(payload.get("display_name") or session.display_name or session.client_id),
                agent_runtime=str(payload.get("agent_runtime") or "mock-agent"),
                model_display_name=str(payload.get("model_display_name") or "mock-model"),
                team_id=team_id,
            )
            room.members[session.client_id] = member
        session.role = role
        session.room_id = room_id
        session.team_id = member.team_id
        return member

    def mark_disconnected(self, session: Session) -> Room | None:
        if not session.room_id:
            return None
        room = self.rooms.get(session.room_id)
        if not room:
            return None
        member = room.members.get(session.client_id)
        if member:
            member.status = MemberStatus.DISCONNECTED
        return room
