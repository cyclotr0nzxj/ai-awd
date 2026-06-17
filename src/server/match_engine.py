from __future__ import annotations

import hashlib
import secrets
from itertools import count
from time import time
from typing import Any

from .models import FlagRecord, Match, Phase, Room, RoomMember, Submission


class MatchError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class MatchEngine:
    def __init__(self) -> None:
        self._match_counter = count(1)
        self._submission_counter = count(1)
        self.matches: dict[str, Match] = {}
        self.flags_by_room: dict[str, dict[str, FlagRecord]] = {}
        self.submitted_hashes_by_room: dict[str, set[str]] = {}

    def start_match(self, room: Room, owner_client_id: str, peer_addrs: dict[str, str] | None = None) -> tuple[Match, dict[str, dict[str, Any]]]:
        if owner_client_id != room.owner_client_id:
            raise MatchError("BAD_REQUEST", "只有房主可以开始比赛")
        if room.status != Phase.LOBBY:
            raise MatchError("INVALID_PHASE", "房间不在大厅阶段")
        players = room.players()
        if len(players) < 2:
            raise MatchError("BAD_REQUEST", "至少需要两名参赛成员")
        match_id = f"match_{next(self._match_counter):03d}"
        match = Match(match_id=match_id, room_id=room.room_id)
        room.status = Phase.PREPARE
        self.matches[room.room_id] = match
        self.flags_by_room[room.room_id] = {}
        self.submitted_hashes_by_room[room.room_id] = set()
        configs: dict[str, dict[str, Any]] = {}
        peer_addrs = peer_addrs or {}
        for index, player in enumerate(players):
            flag = f"FLAG{{{room.room_id}_{player.team_id}_{secrets.token_hex(8)}}}"
            flag_hash = _hash_flag(flag)
            self.flags_by_room[room.room_id][flag_hash] = FlagRecord(
                room_id=room.room_id,
                match_id=match_id,
                team_id=player.team_id or "",
                flag_hash=flag_hash,
                flag_plaintext=flag,
            )
            port = 18081 + index
            local_addr = peer_addrs.get(player.client_id, "127.0.0.1")
            configs[player.client_id] = {
                "match_id": match_id,
                "team_id": player.team_id,
                "flag": flag,
                "target_template_id": room.target_template_id,
                "local_target": {
                    "host": "127.0.0.1",
                    "port": port,
                    "base_url": f"http://127.0.0.1:{port}",
                },
                "opponents": [],
                "allowed_targets": [f"http://127.0.0.1:{port}"],
                "_peer_addr": local_addr,
            }
        for client_id, config in configs.items():
            config["opponents"] = [
                {
                    "team_id": other["team_id"],
                    "base_url": f"http://{other['_peer_addr']}:{other['local_target']['port']}",
                }
                for other_client_id, other in configs.items()
                if other_client_id != client_id
            ]
            config["allowed_targets"] = [
                config["local_target"]["base_url"],
                *[opponent["base_url"] for opponent in config["opponents"]],
            ]
        self.set_phase(room, Phase.PREPARE)
        return match, configs

    def set_phase(self, room: Room, phase: Phase) -> Match:
        match = self.get_match(room.room_id)
        now = time()
        match.phase = phase
        match.phase_started_at = now
        key = phase.value.lower()
        duration = room.phase_seconds.get(key)
        match.phase_ends_at = now + duration if duration is not None else None
        if phase == Phase.FINISHED:
            match.status = "FINISHED"
            room.status = Phase.FINISHED
        else:
            room.status = phase
        return match

    def get_match(self, room_id: str) -> Match:
        match = self.matches.get(room_id)
        if not match:
            raise MatchError("INVALID_PHASE", "比赛尚未开始")
        return match

    def submit_flag(
        self,
        room: Room,
        submitter: RoomMember,
        payload: dict[str, Any],
    ) -> Submission:
        match = self.get_match(room.room_id)
        if submitter.role.value != "player":
            return self._submission(room, match, submitter, None, "", False, "INVALID_ROLE", 0)
        if match.phase != Phase.ATTACK:
            return self._submission(room, match, submitter, None, "", False, "INVALID_PHASE", 0)
        flag = payload.get("flag")
        if not isinstance(flag, str) or not flag:
            return self._submission(room, match, submitter, None, "", False, "INVALID_FLAG", 0)
        flag_hash = _hash_flag(flag)
        flags = self.flags_by_room.get(room.room_id, {})
        record = flags.get(flag_hash)
        if not record:
            return self._submission(room, match, submitter, None, flag_hash, False, "INVALID_FLAG", 0)
        if record.team_id == submitter.team_id:
            return self._submission(room, match, submitter, record.team_id, flag_hash, False, "SELF_FLAG", 0)
        submitted = self.submitted_hashes_by_room.setdefault(room.room_id, set())
        if flag_hash in submitted:
            return self._submission(room, match, submitter, record.team_id, flag_hash, False, "DUPLICATE_FLAG", 0)
        submitted.add(flag_hash)
        record.captured = True
        submitter.score += 100
        target = _member_by_team(room, record.team_id)
        if target:
            target.score -= 50
        return self._submission(room, match, submitter, record.team_id, flag_hash, True, "OK", 100)

    def rankings(self, room: Room) -> list[dict[str, Any]]:
        return [
            {
                "team_id": member.team_id,
                "client_id": member.client_id,
                "display_name": member.display_name,
                "score": member.score,
            }
            for member in sorted(room.players(), key=lambda item: item.score, reverse=True)
        ]

    def _submission(
        self,
        room: Room,
        match: Match,
        submitter: RoomMember,
        target_team_id: str | None,
        flag_hash: str,
        valid: bool,
        code: str,
        score_delta: int,
    ) -> Submission:
        return Submission(
            submission_id=f"sub_{next(self._submission_counter):04d}",
            room_id=room.room_id,
            match_id=match.match_id,
            submitter_team_id=submitter.team_id or "",
            target_team_id=target_team_id,
            flag_hash=flag_hash,
            valid=valid,
            code=code,
            score_delta=score_delta,
        )


def _hash_flag(flag: str) -> str:
    return hashlib.sha256(flag.encode("utf-8")).hexdigest()


def _member_by_team(room: Room, team_id: str) -> RoomMember | None:
    for member in room.players():
        if member.team_id == team_id:
            return member
    return None
