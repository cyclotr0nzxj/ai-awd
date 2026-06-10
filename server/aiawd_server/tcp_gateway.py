from __future__ import annotations

import asyncio
from contextlib import suppress
from time import time
from typing import Any

from .log_store import LogStore
from .match_engine import MatchEngine, MatchError
from .models import Phase, Role, Room, Session
from .protocol import Message, ProtocolError, make_error, read_message, write_message
from .room_manager import RoomError, RoomManager
from .session_manager import SessionManager
from .target_registry import DEFAULT_TARGET_TEMPLATE_ID, TargetRegistry
from .target_runtime import TargetRuntime, TargetRuntimeError


class TCPGateway:
    def __init__(
        self,
        *,
        host: str = "127.0.0.1",
        port: int = 9000,
        session_manager: SessionManager | None = None,
        room_manager: RoomManager | None = None,
        match_engine: MatchEngine | None = None,
        target_registry: TargetRegistry | None = None,
        target_runtime: TargetRuntime | None = None,
        log_store: LogStore | None = None,
    ) -> None:
        self.host = host
        self.port = port
        self.session_manager = session_manager or SessionManager()
        self.room_manager = room_manager or RoomManager()
        self.match_engine = match_engine or MatchEngine()
        self.target_registry = target_registry or TargetRegistry()
        self.target_runtime = target_runtime or TargetRuntime()
        self.log_store = log_store or LogStore()
        self._server: asyncio.AbstractServer | None = None
        self._phase_tasks: dict[str, asyncio.Task[None]] = {}
        self._response_cache: dict[tuple[str, int], Message | None] = {}

    async def start(self) -> asyncio.AbstractServer:
        self._server = await asyncio.start_server(self._handle_client, self.host, self.port)
        sockets = self._server.sockets or []
        if sockets:
            self.port = int(sockets[0].getsockname()[1])
        self.log_store.append("SERVER_STARTED", {"host": self.host, "port": self.port})
        return self._server

    async def stop(self) -> None:
        for task in self._phase_tasks.values():
            task.cancel()
        for task in self._phase_tasks.values():
            with suppress(asyncio.CancelledError):
                await task
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        self.log_store.append("SERVER_STOPPED", {"host": self.host, "port": self.port})

    async def serve_forever(self) -> None:
        if not self._server:
            await self.start()
        assert self._server is not None
        async with self._server:
            await self._server.serve_forever()

    async def _handle_client(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        session: Session | None = None
        try:
            while True:
                incoming = await read_message(reader)
                if incoming.type == "HELLO":
                    session = self.session_manager.create_session(incoming.payload, writer)
                    await self._send(
                        writer,
                        Message(
                            type="WELCOME",
                            seq=incoming.seq,
                            client_id=session.client_id,
                            payload={"client_id": session.client_id, "server": "ai-awd-arena"},
                        ),
                    )
                    self.log_store.append("CLIENT_CONNECTED", session.public_snapshot())
                    continue
                if not session:
                    await self._send(writer, make_error("BAD_REQUEST", "HELLO is required before other messages", seq=incoming.seq))
                    continue
                self.session_manager.touch(session.client_id)
                if incoming.seq is not None:
                    cache_key = (session.client_id, incoming.seq)
                    if cache_key in self._response_cache:
                        cached = self._response_cache[cache_key]
                        if cached:
                            await self._send(writer, cached)
                        continue
                response = await self._dispatch(session, incoming)
                if incoming.seq is not None:
                    self._response_cache[(session.client_id, incoming.seq)] = response
                if response:
                    await self._send(writer, response)
        except (asyncio.IncompleteReadError, BrokenPipeError, ConnectionResetError, OSError):
            pass
        except ProtocolError as exc:
            if not writer.is_closing():
                await self._send(writer, make_error("BAD_REQUEST", str(exc), client_id=session.client_id if session else None))
        finally:
            if session:
                # Purge response cache entries for this session
                stale = [k for k in self._response_cache if k[0] == session.client_id]
                for k in stale:
                    del self._response_cache[k]
                self.session_manager.disconnect(session.client_id)
                room = self.room_manager.mark_disconnected(session)
                if room:
                    await self._broadcast_room_update(room)
            with suppress(Exception):
                writer.close()

    async def _dispatch(self, session: Session, message: Message) -> Message | None:
        try:
            if message.type == "PING":
                return Message(type="PONG", seq=message.seq, client_id=session.client_id, payload={})
            if message.type == "LIST_ROOMS_REQ":
                return Message(
                    type="LIST_ROOMS_RES",
                    seq=message.seq,
                    client_id=session.client_id,
                    payload={"rooms": self.room_manager.list_rooms()},
                )
            if message.type == "LIST_TARGETS_REQ":
                return Message(
                    type="LIST_TARGETS_RES",
                    seq=message.seq,
                    client_id=session.client_id,
                    payload={"targets": self.target_registry.list_targets()},
                )
            if message.type == "CREATE_ROOM_REQ":
                target_template_id = str(message.payload.get("target_template_id") or DEFAULT_TARGET_TEMPLATE_ID)
                if not self.target_registry.has(target_template_id):
                    raise RoomError("BAD_REQUEST", "未知靶机模板")
                room = self.room_manager.create_room(session, message.payload)
                self.log_store.append("ROOM_CREATED", room.public_snapshot())
                await self._broadcast_room_update(room)
                return Message(
                    type="CREATE_ROOM_RES",
                    seq=message.seq,
                    client_id=session.client_id,
                    room_id=room.room_id,
                    role=Role.PLAYER.value,
                    payload={"ok": True, "room": room.public_snapshot()},
                )
            if message.type == "JOIN_ROOM_REQ":
                room_id = message.room_id or str(message.payload.get("room_id") or "")
                role = message.role or str(message.payload.get("role") or Role.PLAYER.value)
                member = self.room_manager.join_room(session, room_id, role, message.payload)
                room = self.room_manager.get_room(room_id)
                self.log_store.append("ROOM_JOINED", member.public_snapshot())
                await self._broadcast_room_update(room)
                return Message(
                    type="JOIN_ROOM_RES",
                    seq=message.seq,
                    client_id=session.client_id,
                    room_id=room.room_id,
                    role=member.role.value,
                    payload={"ok": True, "member": member.public_snapshot(), "room": room.public_snapshot()},
                )
            if message.type == "START_MATCH_REQ":
                room = self.room_manager.get_room(message.room_id or session.room_id)
                member = room.members.get(session.client_id)
                if not member or member.role != Role.PLAYER:
                    raise RoomError("INVALID_ROLE", "只有参赛成员可以开始比赛")
                match, configs = self.match_engine.start_match(room, session.client_id)
                target_template = self.target_registry.get(room.target_template_id)
                for config in configs.values():
                    config["target_manifest"] = target_template.manifest_snapshot()
                    config["target_runtime"] = self._target_runtime_snapshot(target_template, room, config)
                self.log_store.append("MATCH_STARTED", {"match": match.public_snapshot(), "room_id": room.room_id})
                await self._send_match_configs(room, configs)
                await self._broadcast_phase(room)
                await self._broadcast_rankings(room)
                self._schedule_phases(room)
                return Message(
                    type="START_MATCH_RES",
                    seq=message.seq,
                    client_id=session.client_id,
                    room_id=room.room_id,
                    payload={"ok": True, "match": match.public_snapshot()},
                )
            if message.type == "SUBMIT_FLAG_REQ":
                room = self.room_manager.get_room(message.room_id or session.room_id)
                member = room.members.get(session.client_id)
                if not member:
                    raise RoomError("BAD_REQUEST", "客户端尚未加入房间")
                submission = self.match_engine.submit_flag(room, member, message.payload)
                self.log_store.append("FLAG_SUBMITTED", submission.public_snapshot())
                await self._broadcast_event(
                    room,
                    "FLAG_CAPTURED" if submission.valid else "FLAG_REJECTED",
                    submission.public_snapshot(),
                )
                await self._broadcast_rankings(room)
                return Message(
                    type="SUBMIT_FLAG_RES",
                    seq=message.seq,
                    client_id=session.client_id,
                    room_id=room.room_id,
                    role=member.role.value,
                    payload={"ok": submission.valid, "submission": submission.public_snapshot()},
                )
            if message.type == "TARGET_READY":
                return await self._mark_ready(session, message, "target_ready")
            if message.type == "AGENT_READY":
                return await self._mark_ready(session, message, "agent_ready")
            if message.type == "AGENT_ACTIVITY":
                return await self._handle_agent_activity(session, message)
            if message.type == "BYE":
                return Message(type="BYE", seq=message.seq, client_id=session.client_id, payload={"ok": True})
            return make_error("BAD_REQUEST", f"不支持的消息类型：{message.type}", seq=message.seq, client_id=session.client_id)
        except (RoomError, MatchError) as exc:
            return make_error(exc.code, str(exc), seq=message.seq, client_id=session.client_id, room_id=message.room_id or session.room_id)
        except TargetRuntimeError as exc:
            return make_error(exc.code, str(exc), seq=message.seq, client_id=session.client_id, room_id=message.room_id or session.room_id)
        except ValueError as exc:
            return make_error("BAD_REQUEST", str(exc), seq=message.seq, client_id=session.client_id, room_id=message.room_id or session.room_id)

    def _target_runtime_snapshot(self, target_template: Any, room: Room, config: dict[str, Any]) -> dict[str, Any]:
        local_target = config.get("local_target") or {}
        instance = self.target_runtime.plan_instance(
            target_template,
            room_id=room.room_id,
            team_id=str(config.get("team_id") or ""),
            flag=str(config.get("flag") or ""),
            host=str(local_target.get("host") or "127.0.0.1"),
            port=int(local_target.get("port") or 0),
        )
        return instance.public_snapshot()

    async def _handle_agent_activity(self, session: Session, message: Message) -> Message | None:
        room = self.room_manager.get_room(message.room_id or session.room_id)
        member = room.members.get(session.client_id)
        if not member:
            raise RoomError("BAD_REQUEST", "客户端尚未加入房间")
        activity_payload = {
            "client_id": session.client_id,
            "team_id": member.team_id,
            "display_name": member.display_name,
            "agent_runtime": member.agent_runtime,
            "model_display_name": member.model_display_name,
            "action": message.payload.get("action", "attack"),
            "target_url": message.payload.get("target_url", ""),
            "flag": message.payload.get("flag"),
            "ok": message.payload.get("ok", False),
            "output_snippet": message.payload.get("output_snippet", "")[:300],
            "elapsed_ms": message.payload.get("elapsed_ms", 0),
            "ts": message.ts or time(),
        }
        # Broadcast to all room members as an EVENT
        await self._broadcast_event(room, "AGENT_ACTIVITY", activity_payload)
        # Also log it
        self.log_store.append("AGENT_ACTIVITY", activity_payload)
        return Message(
            type="AGENT_ACTIVITY_ACK",
            seq=message.seq,
            client_id=session.client_id,
            room_id=room.room_id,
            payload={"ok": True},
        )

    async def _mark_ready(self, session: Session, message: Message, field: str) -> Message:
        room = self.room_manager.get_room(message.room_id or session.room_id)
        member = room.members.get(session.client_id)
        if not member or member.role != Role.PLAYER:
            raise RoomError("INVALID_ROLE", "只有参赛成员可以进入就绪状态")
        setattr(member, field, True)
        await self._broadcast_room_update(room)
        return Message(
            type=f"{message.type}_ACK",
            seq=message.seq,
            client_id=session.client_id,
            room_id=room.room_id,
            payload={"ok": True, "member": member.public_snapshot()},
        )

    async def _send(self, writer: Any, message: Message) -> None:
        if writer and not writer.is_closing():
            with suppress(ConnectionError, BrokenPipeError):
                await write_message(writer, message)

    async def _broadcast_room_update(self, room: Room) -> None:
        await self._broadcast(
            room,
            Message(type="ROOM_UPDATE", room_id=room.room_id, payload={"room": room.public_snapshot()}),
        )

    async def _broadcast_phase(self, room: Room) -> None:
        match = self.match_engine.get_match(room.room_id)
        await self._broadcast(
            room,
            Message(type="PHASE_SYNC", room_id=room.room_id, payload={
                "match": match.public_snapshot(),
                "server_time": time(),  # server's clock for client sync
            }),
        )

    async def _broadcast_rankings(self, room: Room) -> None:
        rankings = self.match_engine.rankings(room)
        await self._broadcast(
            room,
            Message(type="RANKING_UPDATE", room_id=room.room_id, payload={"rankings": rankings}),
        )

    async def _broadcast_event(self, room: Room, event_type: str, payload: dict[str, Any]) -> None:
        await self._broadcast(
            room,
            Message(type="EVENT", room_id=room.room_id, payload={"event_type": event_type, "event": payload}),
        )

    async def _send_match_configs(self, room: Room, configs: dict[str, dict[str, Any]]) -> None:
        for client_id, config in configs.items():
            session = self.session_manager.get(client_id)
            if session and session.writer:
                await self._send(
                    session.writer,
                    Message(
                        type="MATCH_CONFIG",
                        client_id=client_id,
                        room_id=room.room_id,
                        role=Role.PLAYER.value,
                        payload=config,
                    ),
                )

    async def _broadcast(self, room: Room, message: Message) -> None:
        for member in room.members.values():
            session = self.session_manager.get(member.client_id)
            if session and session.writer:
                outgoing = Message(
                    type=message.type,
                    client_id=member.client_id,
                    room_id=room.room_id,
                    role=member.role.value,
                    payload=message.payload,
                )
                await self._send(session.writer, outgoing)

    async def _sync_timer(self, room_id: str) -> None:
        """Broadcast PHASE_SYNC every 5 seconds to keep clients in sync."""
        try:
            while True:
                await asyncio.sleep(5)
                room = self.room_manager.get_room(room_id)
                match = self.match_engine.get_match(room_id)
                if match.phase in (Phase.FINISHED,):
                    break
                await self._broadcast_phase(room)
        except (asyncio.CancelledError, Exception):
            pass  # room deleted or phase ended

    def _schedule_phases(self, room: Room) -> None:
        existing = self._phase_tasks.pop(room.room_id, None)
        if existing:
            existing.cancel()
        self._phase_tasks[room.room_id] = asyncio.create_task(self._run_phase_schedule(room.room_id))

    async def _run_phase_schedule(self, room_id: str) -> None:
        try:
            room = self.room_manager.get_room(room_id)
            for phase in (Phase.PREPARE, Phase.DEFENSE, Phase.ATTACK):
                delay = max(0.0, room.phase_seconds.get(phase.value.lower(), 0.0))
                if delay:
                    await asyncio.sleep(delay)
                if phase == Phase.PREPARE:
                    self.match_engine.set_phase(room, Phase.DEFENSE)
                elif phase == Phase.DEFENSE:
                    self.match_engine.set_phase(room, Phase.ATTACK)
                else:
                    self.match_engine.set_phase(room, Phase.FINISHED)
                await self._broadcast_phase(room)
                # During active phases, keep broadcasting timer sync every 5s
                # so all clients stay in sync regardless of clock skew
                if phase in (Phase.DEFENSE, Phase.ATTACK):
                    asyncio.create_task(self._sync_timer(room_id))
            await self._broadcast_rankings(room)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.log_store.append("PHASE_SCHEDULER_ERROR", {"room_id": room_id, "error": str(exc)})
            try:
                room = self.room_manager.get_room(room_id)
                self.match_engine.set_phase(room, Phase.FINISHED)
                await self._broadcast_phase(room)
                await self._broadcast_event(
                    room,
                    "ERROR",
                    {
                        "code": "PHASE_SCHEDULER_ERROR",
                        "message": f"Phase scheduler failed: {exc}",
                        "room_id": room_id,
                    },
                )
            except Exception as inner_exc:
                self.log_store.append("PHASE_SCHEDULER_CLEANUP_ERROR", {"room_id": room_id, "error": str(inner_exc)})
            finally:
                self._phase_tasks.pop(room_id, None)
