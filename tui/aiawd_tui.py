from __future__ import annotations

import argparse
import asyncio
import shlex
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

from aiawd_server.protocol import Message, read_message, write_message
from tui.agent_runtime import AgentManager, CustomCommandAdapter, sanitize_command
from tui.target_lifecycle import (
    TargetLifecycleError,
    format_target_action_result,
    normalize_target_action,
    run_local_target_action,
    target_action_label,
)


class CommandError(ValueError):
    """Raised when a TUI command cannot be translated into a protocol request."""


@dataclass(frozen=True, slots=True)
class OutgoingRequest:
    msg_type: str
    payload: dict[str, Any]
    room_id: str | None = None
    role: str | None = None


@dataclass(frozen=True, slots=True)
class WaitCondition:
    phase: str
    timeout: float = 10.0


@dataclass(frozen=True, slots=True)
class TargetAction:
    action: str


@dataclass(frozen=True, slots=True)
class AgentStart:
    command: list[str]


@dataclass(frozen=True, slots=True)
class AgentStop:
    pass


class AiawdTuiClient:
    def __init__(
        self,
        *,
        display_name: str = "TUI 玩家",
        agent_runtime: str = "tui-agent",
        model_display_name: str = "tui-model",
        layout: str = "wide",
        target_runner: Callable[..., Any] | None = None,
        target_opener: Callable[..., Any] | None = None,
    ) -> None:
        if layout not in {"compact", "wide"}:
            raise ValueError("layout must be compact or wide")
        self.display_name = display_name
        self.agent_runtime = agent_runtime
        self.model_display_name = model_display_name
        self.layout = layout
        self.target_runner = target_runner
        self.target_opener = target_opener
        self.reader: asyncio.StreamReader | None = None
        self.writer: asyncio.StreamWriter | None = None
        self.client_id: str | None = None
        self.room_id: str | None = None
        self.role: str | None = None
        self.match_id: str | None = None
        self.seq = 1
        self.room: dict[str, Any] | None = None
        self.match: dict[str, Any] | None = None
        self.targets: list[dict[str, Any]] = []
        self.rankings: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.configs: list[dict[str, Any]] = []
        self._reader_task: asyncio.Task[None] | None = None
        self._running = False
        self._agent_manager: AgentManager | None = None
        self.replay_index = 0

    @property
    def connected(self) -> bool:
        return bool(self.writer and not self.writer.is_closing() and self.client_id)

    async def connect(self, host: str, port: int, *, start_reader: bool = True) -> None:
        self.reader, self.writer = await asyncio.open_connection(host, port)
        await self._write(
            Message(
                type="HELLO",
                seq=self._next_seq(),
                payload={
                    "display_name": self.display_name,
                    "platform": sys.platform,
                    "capabilities": ["player", "spectator", "tui"],
                },
            )
        )
        welcome = await self._read()
        if welcome.type != "WELCOME":
            raise CommandError(f"连接失败：期望 WELCOME，收到 {welcome.type}")
        self.handle_message(welcome)
        if start_reader:
            self._running = True
            self._reader_task = asyncio.create_task(self._reader_loop())

    async def close(self) -> None:
        self._running = False
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass
            self._reader_task = None
        if self.writer:
            self.writer.close()
            await self.writer.wait_closed()
        self.writer = None
        self.reader = None
        self.client_id = None

    async def send_request(self, request: OutgoingRequest) -> None:
        if not self.writer or not self.client_id:
            raise CommandError("尚未连接裁判服务器")
        await self._write(
            Message(
                type=request.msg_type,
                seq=self._next_seq(),
                client_id=self.client_id,
                room_id=request.room_id,
                role=request.role,
                payload=request.payload,
            )
        )

    def build_request(self, line: str) -> OutgoingRequest | WaitCondition | TargetAction | str:
        parts = shlex.split(line)
        if not parts:
            raise CommandError("请输入命令")
        command = parts[0].lower()

        if command in {"help", "?"}:
            return help_text()
        if command == "status":
            return "\n".join(self.status_lines())
        if command in {"quit", "exit"}:
            return "QUIT"
        if command == "wait-phase":
            if len(parts) not in {2, 3}:
                raise CommandError("用法：wait-phase PHASE [秒]")
            timeout = float(parts[2]) if len(parts) == 3 else 10.0
            return WaitCondition(normalize_phase(parts[1]), timeout)
        if command in {"target", "靶机"}:
            if len(parts) != 2:
                raise CommandError("用法：target doctor|install|start|health|stop|reset")
            try:
                return TargetAction(normalize_target_action(parts[1]))
            except TargetLifecycleError as exc:
                raise CommandError("用法：target doctor|install|start|health|stop|reset") from exc
        if command == "targets":
            return OutgoingRequest("LIST_TARGETS_REQ", {})
        if command == "rooms":
            return OutgoingRequest("LIST_ROOMS_REQ", {})
        if command == "create":
            if len(parts) < 3:
                raise CommandError('用法：create "房间名" 靶机模板 [人数] [准备秒] [防御秒] [攻击秒]')
            max_players = int(parts[3]) if len(parts) >= 4 else 2
            phase_seconds = {
                "prepare": float(parts[4]) if len(parts) >= 5 else 30,
                "defense": float(parts[5]) if len(parts) >= 6 else 60,
                "attack": float(parts[6]) if len(parts) >= 7 else 120,
            }
            return OutgoingRequest(
                "CREATE_ROOM_REQ",
                {
                    "room_name": parts[1],
                    "max_players": max_players,
                    "target_template_id": parts[2],
                    "display_name": self.display_name,
                    "agent_runtime": self.agent_runtime,
                    "model_display_name": self.model_display_name,
                    "allow_spectators": True,
                    "phase_seconds": phase_seconds,
                },
            )
        if command == "join":
            if len(parts) != 3:
                raise CommandError("用法：join 房间ID player|spectator")
            role = _validate_role(parts[2])
            return OutgoingRequest(
                "JOIN_ROOM_REQ",
                {
                    "display_name": self.display_name,
                    "role": role,
                    "agent_runtime": self.agent_runtime,
                    "model_display_name": self.model_display_name,
                },
                room_id=parts[1],
                role=role,
            )
        if command == "ready":
            if len(parts) != 2:
                raise CommandError("用法：ready target|agent")
            ready_kind = normalize_ready_kind(parts[1])
            return OutgoingRequest(
                "TARGET_READY" if ready_kind == "target" else "AGENT_READY",
                {},
                room_id=self._require_room_id(),
                role="player",
            )
        if command == "start":
            return OutgoingRequest("START_MATCH_REQ", {}, room_id=self._require_room_id(), role="player")
        if command == "submit":
            if len(parts) != 2:
                raise CommandError("用法：submit FLAG{...}")
            return OutgoingRequest(
                "SUBMIT_FLAG_REQ",
                {"match_id": self.match_id, "flag": parts[1], "source": "tui"},
                room_id=self._require_room_id(),
                role="player",
            )
        if command in {"agent", "智能体"}:
            return self._build_agent_request(parts)
        if command in {"replay", "回放"}:
            return self._build_replay_request(parts)
        raise CommandError(f"未知命令：{parts[0]}")

    def handle_message(self, message: Message) -> str:
        if message.type == "WELCOME":
            self.client_id = message.payload.get("client_id") or message.client_id
        elif message.type in {"CREATE_ROOM_RES", "JOIN_ROOM_RES"}:
            room = message.payload.get("room")
            if room:
                self.room = room
                self.room_id = room.get("room_id")
            self.role = message.role or self.role
        elif message.type == "LIST_TARGETS_RES":
            self.targets = list(message.payload.get("targets", []))
            return format_targets(self.targets)
        elif message.type == "LIST_ROOMS_RES":
            return format_rooms(message.payload.get("rooms", []))
        elif message.type == "ROOM_UPDATE":
            self.room = message.payload.get("room") or self.room
            self.room_id = self.room.get("room_id") if self.room else self.room_id
            self.role = self._infer_role() or self.role
        elif message.type == "MATCH_CONFIG":
            self.configs.insert(0, message.payload)
            self.configs = self.configs[:3]
            self.match_id = message.payload.get("match_id") or self.match_id
        elif message.type == "PHASE_SYNC":
            self.match = message.payload.get("match") or self.match
            self.match_id = self.match.get("match_id") if self.match else self.match_id
        elif message.type == "RANKING_UPDATE":
            self.rankings = list(message.payload.get("rankings", []))
            return format_rankings_table(self.rankings)
        elif message.type == "EVENT":
            self.events.insert(0, message.payload)
            self.events = self.events[:20]
        elif message.type == "ERROR":
            return f"错误：{message.payload.get('code', 'ERROR')} {message.payload.get('message', '')}".strip()
        return format_message_summary(message)

    async def read_response_for(self, request: OutgoingRequest, *, timeout: float = 5.0) -> str:
        expected = expected_response_types(request.msg_type)
        message = await self.read_until(lambda incoming: incoming.type in expected or incoming.type == "ERROR", timeout=timeout)
        return self.handle_message(message)

    async def wait_for_phase(self, phase: str, *, timeout: float = 10.0) -> str:
        if self.match and self.match.get("phase") == phase:
            return f"阶段已是 {phase}"
        message = await self.read_until(
            lambda incoming: incoming.type == "PHASE_SYNC" and incoming.payload.get("match", {}).get("phase") == phase,
            timeout=timeout,
        )
        return self.handle_message(message)

    async def run_target_action(self, action: str) -> str:
        if self.role == "spectator":
            raise CommandError("观战席不能执行本地靶机动作")
        if not self.configs:
            raise CommandError("等待私人战斗包")
        config = self.configs[0]
        kwargs: dict[str, Any] = {}
        if self.target_runner:
            kwargs["runner"] = self.target_runner
        if self.target_opener:
            kwargs["opener"] = self.target_opener
        try:
            result = await asyncio.to_thread(
                run_local_target_action,
                config,
                action,
                **kwargs,
            )
        except TargetLifecycleError as exc:
            raise CommandError(f"本地靶机{target_action_label(action)}失败：{exc}") from exc
        return format_target_action_result(result)

    async def read_until(self, predicate: Any, *, timeout: float = 5.0) -> Message:
        if not self.reader:
            raise CommandError("尚未连接裁判服务器")
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise CommandError("等待裁判服务器响应超时")
            message = await asyncio.wait_for(read_message(self.reader), timeout=remaining)
            if predicate(message):
                return message
            self.handle_message(message)

    def status_lines(self) -> list[str]:
        phase = self.match.get("phase") if self.match else self.room.get("status") if self.room else "LOBBY"
        room_label = self.room_id or "未进入房间"
        role_label = {"player": "Agent 玩家", "spectator": "观战席"}.get(self.role or "", "未加入")
        if self.layout == "compact":
            ranking = format_rankings(self.rankings) if self.rankings else "暂无分数"
            lines = [
                "== AI攻防乱斗状态 ==",
                f"{self.client_id or '-'} · {self.display_name} · {room_label} · {role_label} · {format_phase(str(phase))}",
                f"排行：{ranking}",
            ]
            if self.room:
                players = self.room.get("players", [])
                lines.append(
                    "玩家："
                    + (
                        " | ".join(
                            f"{member.get('team_id') or '-'} {member.get('model_display_name') or member.get('agent_runtime') or '-'} "
                            f"{format_ready(member.get('target_ready'))}/{format_ready(member.get('agent_ready'))} "
                            f"{member.get('score', 0)}分"
                            for member in players
                        )
                        if players
                        else "暂无"
                    )
                )
            if self.configs:
                config = redact_config(self.configs[0])
                lines.append(
                    f"战斗包：{config.get('team_id', '-')} · 允许目标 {len(config.get('allowed_targets', []))} · "
                    f"对手 {len(config.get('opponents', []))} · Flag {config.get('flag', '-')}"
                )
            if self.events:
                event_type = self.events[0].get("event_type") or self.events[0].get("type") or "-"
                lines.append(f"最近战报：{event_type}")
            return lines
        lines = [
            "== AI攻防大乱斗状态 ==",
            f"客户端：{self.client_id or '-'} · {self.display_name}",
            f"房间：{room_label}",
            f"身份：{role_label}",
            f"阶段：{format_phase(str(phase))}",
        ]
        if self.room:
            visible_room = dict(self.room)
            if self.match and self.match.get("phase"):
                visible_room["status"] = self.match["phase"]
            lines.append("")
            lines.extend(format_room_panel(visible_room).splitlines())
        if self.rankings:
            lines.append("")
            lines.extend(format_rankings_table(self.rankings).splitlines())
        else:
            lines.append("排行：暂无分数")
        if self.configs:
            lines.append("")
            lines.extend(format_battle_kit(self.configs[0]).splitlines())
        if self.events:
            lines.append("")
            lines.extend(format_events(self.events[:5]).splitlines())
        return lines

    async def _reader_loop(self) -> None:
        assert self.reader is not None
        while self._running:
            try:
                message = await read_message(self.reader)
            except (asyncio.IncompleteReadError, ConnectionResetError, BrokenPipeError, OSError):
                break
            print(f"\n{self.handle_message(message)}")

    async def _read(self) -> Message:
        if not self.reader:
            raise CommandError("尚未连接裁判服务器")
        return await read_message(self.reader)

    async def _write(self, message: Message) -> None:
        if not self.writer:
            raise CommandError("尚未连接裁判服务器")
        await write_message(self.writer, message)

    def _next_seq(self) -> int:
        seq = self.seq
        self.seq += 1
        return seq

    def _require_room_id(self) -> str:
        if not self.room_id:
            raise CommandError("需要先加入或创建房间")
        return self.room_id

    def _build_agent_request(self, parts: list[str]) -> AgentStart | AgentStop | str:
        sub = parts[1].lower() if len(parts) >= 2 else "status"
        if sub in {"start", "启动", "攻击"}:
            command = parts[2:] if len(parts) >= 3 else ["echo", "No agent command configured"]
            if not sanitize_command(command):
                raise CommandError("Agent 命令包含不安全的 shell 控制符")
            return AgentStart(command=command)
        if sub in {"stop", "停止"}:
            return AgentStop()
        if sub in {"status", "状态", "info"}:
            return self._agent_status_text()
        raise CommandError("用法：agent start|stop|status [命令...]")

    async def start_agent(self, command: list[str]) -> str:
        if not self.configs:
            raise CommandError("等待比赛配置下发")
        if self.role == "spectator":
            raise CommandError("观战席不能启动 Agent")
        config = self.configs[0]
        room_status = self.match.get("phase") if self.match else self.room.get("status") if self.room else "LOBBY"
        manager = AgentManager(CustomCommandAdapter(command))
        manager.configure(config, str(room_status))

        loop = asyncio.get_running_loop()

        def submit_flag(flag: str, target_url: str) -> dict[str, Any]:
            if not self.writer or not self.client_id:
                return {"ok": False, "code": "NOT_CONNECTED"}
            future = asyncio.run_coroutine_threadsafe(
                self.send_request(
                    OutgoingRequest(
                        "SUBMIT_FLAG_REQ",
                        {"match_id": self.match_id, "flag": flag, "source": "agent"},
                        room_id=self._require_room_id(),
                        role="player",
                    )
                ),
                loop,
            )
            try:
                future.result(timeout=5)
            except Exception:
                return {"ok": False, "code": "SEND_FAILED"}
            return {"ok": True, "code": "SUBMITTED"}

        result = await loop.run_in_executor(None, lambda: manager.run_attack(submit=submit_flag))
        self._agent_manager = manager
        return self._format_agent_result(result)

    async def stop_agent(self) -> str:
        if not self._agent_manager:
            return "Agent 未在运行"
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._agent_manager.stop)
        self._agent_manager = None
        return "Agent 已停止"

    def _agent_status_text(self) -> str:
        if self._agent_manager is None:
            return "Agent 未启动"
        last = self._agent_manager.last_result
        if last is None:
            return "Agent 已配置，尚未执行"
        return self._format_agent_result(last)

    def _format_agent_result(self, result: AgentResult) -> str:
        lines = [
            f"Agent 结果：{'成功' if result.ok else '失败'}",
            f"耗时：{result.elapsed_ms}ms",
            f"捕获 Flag：{len(result.flags_captured)} 个",
        ]
        if result.flags_captured:
            lines.append("Flags：")
            for f in result.flags_captured:
                lines.append(f"  {f}")
        if result.error:
            lines.append(f"错误：{result.error}")
        if result.actions:
            for action in result.actions:
                status = "成功" if action.ok else "超时/失败"
                target = action.target_url or "-"
                flag_info = f" · Flag：{action.flag}" if action.flag else ""
                lines.append(f"  攻击 {target}：{status}{flag_info}")
        return "\n".join(lines)

    def _infer_role(self) -> str | None:
        if not self.room or not self.client_id:
            return None
        if any(member.get("client_id") == self.client_id for member in self.room.get("players", [])):
            return "player"
        if any(member.get("client_id") == self.client_id for member in self.room.get("spectators", [])):
            return "spectator"
        return None

    def _capture_events(self) -> list[dict[str, Any]]:
        """返回所有 FLAG_CAPTURED 事件（最新在前）。"""
        return [e for e in self.events if e.get("event_type") == "FLAG_CAPTURED"]

    def _format_replay(self, index: int) -> str:
        """格式化单个攻陷事件的重放详情。"""
        events = self._capture_events()
        if not events:
            return "暂无攻陷事件"
        if index < 0 or index >= len(events):
            return f"无效索引：{index}（共 {len(events)} 个事件）"
        event = events[index]
        ev = event.get("event") or event
        submitter = ev.get("submitter_team_id", "-")
        target = ev.get("target_team_id", "-")
        score = ev.get("score_delta", 0)
        code = ev.get("code", "-")
        return (
            f"== 攻陷回放 #{index + 1}/{len(events)} ==\n"
            f"攻陷方：{submitter}\n"
            f"目标：{target}\n"
            f"得分：{score}\n"
            f"结果：{code}"
        )

    def _replay_index(self) -> int:
        """返回当前重放索引。"""
        return self.replay_index

    def _build_replay_request(self, parts: list[str]) -> str:
        """处理回放命令，返回格式化字符串。"""
        sub_aliases = {
            "prev": "prev",
            "上一攻": "prev",
            "上一攻陷": "prev",
            "next": "next",
            "下一攻": "next",
            "下一攻陷": "next",
            "latest": "latest",
            "最新": "latest",
            "list": "list",
            "列表": "list",
        }
        sub = parts[1].lower() if len(parts) >= 2 else "latest"
        sub = sub_aliases.get(sub) or sub_aliases.get(parts[1].strip()) or sub

        events = self._capture_events()
        if sub == "list":
            if not events:
                return "暂无攻陷事件"
            lines = ["== 攻陷事件列表 =="]
            for i, event in enumerate(events):
                ev = event.get("event") or event
                submitter = ev.get("submitter_team_id", "-")
                target = ev.get("target_team_id", "-")
                score = ev.get("score_delta", 0)
                lines.append(f"#{i + 1} {submitter} → {target}  +{score}分")
            return "\n".join(lines)
        if sub in {"prev", "next"}:
            if not events:
                return "暂无攻陷事件"
            if sub == "prev":
                self.replay_index = self.replay_index - 1 if self.replay_index > 0 else len(events) - 1
            else:
                self.replay_index = self.replay_index + 1 if self.replay_index < len(events) - 1 else 0
        else:
            self.replay_index = 0
        return self._format_replay(self.replay_index)


def help_text() -> str:
    return "\n".join(
        [
            "命令：",
            "  targets",
            "  rooms",
            '  create "房间名" 靶机模板 [人数] [准备秒] [防御秒] [攻击秒]',
            "  join 房间ID player|spectator|参赛|观战",
            "  ready target|agent|靶机|智能体",
            "  start",
            "  submit FLAG{...}",
            "  target doctor|status|检查|诊断|install|start|health|stop|reset",
            "  agent start|stop|status [命令...]",
            "  wait-phase PHASE|大厅|准备|防御|攻防|结束 [秒]",
            "  replay prev|next|latest|list|上一攻|下一攻|最新|列表",
            "  status",
            "  quit",
        ]
    )


def redact_config(config: dict[str, Any]) -> dict[str, Any]:
    redacted = dict(config)
    if redacted.get("flag"):
        redacted["flag"] = "FLAG{已隐藏}"
    return redacted


def display_width(value: Any) -> int:
    text = str(value)
    width = 0
    for char in text:
        width += 2 if unicodedata.east_asian_width(char) in {"F", "W"} else 1
    return width


def pad_display(value: Any, width: int) -> str:
    text = str(value)
    return text + " " * max(0, width - display_width(text))


def format_table(headers: list[str], rows: list[list[Any]]) -> str:
    widths = [
        max(display_width(header), *(display_width(row[index]) for row in rows)) if rows else display_width(header)
        for index, header in enumerate(headers)
    ]
    header_line = "  ".join(pad_display(header, widths[index]) for index, header in enumerate(headers))
    rule = "  ".join("-" * width for width in widths)
    body = [
        "  ".join(pad_display(row[index], widths[index]) for index in range(len(headers)))
        for row in rows
    ]
    return "\n".join([header_line, rule, *body])


def format_phase(phase: str) -> str:
    labels = {
        "LOBBY": "大厅",
        "PREPARE": "准备",
        "DEFENSE": "加固",
        "ATTACK": "攻防",
        "FINISHED": "结束",
    }
    return labels.get(phase, phase)


def format_role(role: str) -> str:
    return {"player": "参赛", "spectator": "观战"}.get(role, role or "-")


def format_ready(value: Any) -> str:
    return "已就绪" if value else "未就绪"


def format_difficulty(value: str) -> str:
    return {
        "beginner": "入门",
        "intermediate": "进阶",
        "professional": "专业",
        "advanced": "高级",
    }.get(value, value or "-")


def format_runtime(value: str) -> str:
    return {
        "docker-compose": "Docker Compose",
        "docker": "Docker",
        "local": "本地",
    }.get(value, value or "-")


def format_targets(targets: list[dict[str, Any]]) -> str:
    if not targets:
        return "暂无可用靶场模板"
    rows = [
        [
            target.get("template_id", "-"),
            target.get("name", "-"),
            format_difficulty(str(target.get("difficulty") or "")),
            format_runtime(str(target.get("runtime") or "")),
            target.get("category", "-"),
        ]
        for target in targets
    ]
    return "== 靶场模板 ==\n" + format_table(["模板ID", "名称", "难度", "运行时", "类型"], rows)


def format_room_panel(room: dict[str, Any]) -> str:
    players = list(room.get("players", []))
    spectators = list(room.get("spectators", []))
    header = (
        "== AI攻防乱斗房间战局 ==\n"
        f"{room.get('room_id', '-')} · {room.get('room_name', '-')} · "
        "AI攻防乱斗 · "
        f"{format_phase(str(room.get('status', '-')))} · "
        f"{len(players)}/{room.get('max_players', '-')} 玩家 · "
        f"靶场 {room.get('target_template_id', '-')}"
    )
    player_rows = [
        [
            member.get("team_id") or "-",
            member.get("display_name") or "-",
            member.get("model_display_name") or member.get("agent_runtime") or "-",
            format_ready(member.get("target_ready")),
            format_ready(member.get("agent_ready")),
            member.get("score", 0),
        ]
        for member in players
    ]
    lines = [header, format_table(["玩家ID", "名称", "模型", "靶机", "Agent", "分数"], player_rows) if player_rows else "参赛玩家：暂无"]
    if spectators:
        spectator_names = "、".join(member.get("display_name") or member.get("client_id", "-") for member in spectators)
        lines.append(f"观战席：{spectator_names}")
    return "\n".join(lines)


def format_battle_kit(config: dict[str, Any]) -> str:
    redacted = redact_config(config)
    local_target = redacted.get("local_target") or {}
    opponents = list(redacted.get("opponents", []))
    allowed_targets = list(redacted.get("allowed_targets", []))
    manifest = redacted.get("target_manifest") or {}
    target_name = manifest.get("name") or redacted.get("target_template_id") or "-"
    target_runtime = format_runtime(str(manifest.get("runtime") or redacted.get("runtime") or ""))
    target_difficulty = format_difficulty(str(manifest.get("difficulty") or redacted.get("difficulty") or ""))
    healthcheck = manifest.get("healthcheck") or {}
    health_path = healthcheck.get("path") or "-"
    runtime_plan = format_runtime_plan(redacted.get("target_runtime") or {})
    lines = [
        "== 私人AI攻防乱斗战斗包 ==",
        f"玩家：{redacted.get('team_id', '-')} · 靶机：{target_name}",
        f"运行：{target_difficulty} · {target_runtime} · 健康 {health_path}",
        f"计划：{runtime_plan}" if runtime_plan else "计划：等待本地靶机计划",
        f"本机入口：{local_target.get('base_url', '-')}",
        f"允许目标：{len(allowed_targets)} 个 · 对手：{len(opponents)} 个 · Flag：{redacted.get('flag', '-')}",
    ]
    if opponents:
        rows = [[item.get("team_id", "-"), item.get("base_url", "-")] for item in opponents]
        lines.append(format_table(["对手", "入口"], rows))
    return "\n".join(lines)


def format_runtime_plan(runtime: dict[str, Any]) -> str:
    project_name = runtime.get("project_name")
    if not project_name:
        return ""
    commands = runtime.get("commands") or {}
    command_names = [name for name in ["install", "start", "stop", "reset"] if name in commands]
    parts = [
        str(project_name),
        "/".join(command_names) if command_names else "",
        f"巡检 {runtime.get('health_url')}" if runtime.get("health_url") else "",
    ]
    return " · ".join(part for part in parts if part)


def format_rankings_table(rankings: list[dict[str, Any]]) -> str:
    if not rankings:
        return "排行榜：暂无分数"
    rows = [
        [
            index + 1,
            row.get("team_id") or "-",
            row.get("display_name") or "-",
            row.get("score", 0),
        ]
        for index, row in enumerate(rankings)
    ]
    return "== 排行榜 ==\n" + format_table(["名次", "玩家ID", "名称", "分数"], rows)


def format_events(events: list[dict[str, Any]]) -> str:
    if not events:
        return "战报：暂无"
    rows = []
    for event in events:
        event_type = event.get("event_type") or event.get("type") or "-"
        payload = event.get("event") or event.get("payload") or event
        if isinstance(payload, dict):
            code = payload.get("code") or payload.get("submission", {}).get("code") or "-"
            submitter = payload.get("submitter_team_id") or payload.get("submission", {}).get("submitter_team_id") or "-"
            target = payload.get("target_team_id") or payload.get("submission", {}).get("target_team_id") or "-"
            delta = payload.get("score_delta") or payload.get("submission", {}).get("score_delta") or 0
            rows.append([event_type, submitter, target, code, delta])
        else:
            rows.append([event_type, "-", "-", "-", "-"])
    return "== 最近战报 ==\n" + format_table(["事件", "攻陷方", "目标", "结果", "分值"], rows)


def format_message_summary(message: Message) -> str:
    labels = {
        "WELCOME": "已连接裁判服务器",
        "CREATE_ROOM_RES": "房间已创建",
        "JOIN_ROOM_RES": "已进入房间",
        "LIST_TARGETS_RES": "靶场模板已更新",
        "ROOM_UPDATE": "房间状态已同步",
        "MATCH_CONFIG": "私人战斗包已下发",
        "PHASE_SYNC": "比赛阶段已同步",
        "RANKING_UPDATE": "排行榜已更新",
        "START_MATCH_RES": "比赛已开始",
        "SUBMIT_FLAG_RES": "提交结果已返回",
        "TARGET_READY_ACK": "靶机准备已确认",
        "AGENT_READY_ACK": "Agent 准备已确认",
        "EVENT": "战报已更新",
    }
    return labels.get(message.type, message.type)


def format_rooms(rooms: list[dict[str, Any]]) -> str:
    if not rooms:
        return "暂无公开房间"
    rows = [
        [
            room.get("room_id", "-"),
            room.get("room_name", "-"),
            format_phase(str(room.get("status", "-"))),
            f"{len(room.get('players', []))}/{room.get('max_players', '-')}",
            room.get("target_template_id", "-"),
            "是" if room.get("allow_spectators") else "否",
        ]
        for room in rooms
    ]
    return "== 房间列表 ==\n" + format_table(["房间ID", "名称", "阶段", "玩家", "靶场", "观战"], rows)


def format_rankings(rankings: list[dict[str, Any]]) -> str:
    return " / ".join(f"{index + 1}.{row.get('team_id')} {row.get('score')}分" for index, row in enumerate(rankings))


def expected_response_types(msg_type: str) -> set[str]:
    return {
        "LIST_TARGETS_REQ": {"LIST_TARGETS_RES"},
        "LIST_ROOMS_REQ": {"LIST_ROOMS_RES"},
        "CREATE_ROOM_REQ": {"CREATE_ROOM_RES"},
        "JOIN_ROOM_REQ": {"JOIN_ROOM_RES"},
        "TARGET_READY": {"TARGET_READY_ACK"},
        "AGENT_READY": {"AGENT_READY_ACK"},
        "START_MATCH_REQ": {"START_MATCH_RES"},
        "SUBMIT_FLAG_REQ": {"SUBMIT_FLAG_RES"},
    }.get(msg_type, {msg_type})


def normalize_phase(phase: str) -> str:
    key = phase.strip().upper()
    aliases = {
        "大厅": "LOBBY",
        "准备": "PREPARE",
        "防御": "DEFENSE",
        "加固": "DEFENSE",
        "攻击": "ATTACK",
        "攻防": "ATTACK",
        "结束": "FINISHED",
    }
    return aliases.get(phase.strip(), key)


def normalize_ready_kind(kind: str) -> str:
    aliases = {
        "target": "target",
        "靶机": "target",
        "环境": "target",
        "agent": "agent",
        "智能体": "agent",
        "代理": "agent",
    }
    normalized = aliases.get(kind.strip().lower()) or aliases.get(kind.strip())
    if not normalized:
        raise CommandError("用法：ready target|agent")
    return normalized


def _validate_role(role: str) -> str:
    aliases = {
        "player": "player",
        "参赛": "player",
        "队伍": "player",
        "spectator": "spectator",
        "观战": "spectator",
        "旁观": "spectator",
    }
    normalized = aliases.get(role.strip().lower()) or aliases.get(role.strip())
    if not normalized:
        raise CommandError("身份只能是 player 或 spectator")
    return normalized


async def repl(client: AiawdTuiClient) -> None:
    print(help_text())
    while True:
        line = await asyncio.to_thread(input, "aiawd> ")
        try:
            result = client.build_request(line)
            if result == "QUIT":
                break
            if isinstance(result, str):
                print(result)
            elif isinstance(result, WaitCondition):
                print(await client.wait_for_phase(result.phase, timeout=result.timeout))
            elif isinstance(result, TargetAction):
                print(await client.run_target_action(result.action))
            elif isinstance(result, AgentStart):
                print(await client.start_agent(result.command))
            elif isinstance(result, AgentStop):
                print(await client.stop_agent())
            else:
                await client.send_request(result)
        except CommandError as exc:
            print(f"错误：{exc}")


async def run_script(client: AiawdTuiClient, commands: list[str]) -> list[str]:
    transcript = [f"已连接：{client.client_id}"]
    for raw in commands:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        transcript.append(f"> {redact_command_for_transcript(line)}")
        result = client.build_request(line)
        if result == "QUIT":
            break
        if isinstance(result, str):
            transcript.append(result)
        elif isinstance(result, WaitCondition):
            transcript.append(await client.wait_for_phase(result.phase, timeout=result.timeout))
        elif isinstance(result, TargetAction):
            transcript.append(await client.run_target_action(result.action))
        elif isinstance(result, AgentStart):
            transcript.append(await client.start_agent(result.command))
        elif isinstance(result, AgentStop):
            transcript.append(await client.stop_agent())
        else:
            await client.send_request(result)
            transcript.append(await client.read_response_for(result))
    transcript.extend(client.status_lines())
    return transcript


def redact_command_for_transcript(line: str) -> str:
    parts = shlex.split(line)
    if parts and parts[0].lower() == "submit" and len(parts) >= 2:
        return "submit FLAG{已隐藏}"
    return line


def load_script_commands(script_path: Path | None, inline_commands: list[str] | None) -> list[str]:
    commands: list[str] = []
    if script_path:
        commands.extend(script_path.read_text(encoding="utf-8").splitlines())
    commands.extend(inline_commands or [])
    return commands


async def async_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AI-AWD Arena cross-platform TUI client")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--name", default="TUI 玩家")
    parser.add_argument("--agent-runtime", default="tui-agent")
    parser.add_argument("--model", "--model-display-name", dest="model_display_name", default="tui-model")
    parser.add_argument("--script", type=Path, help="Run commands from a script file and exit")
    parser.add_argument("--cmd", action="append", help="Run one command in script mode; may be repeated")
    parser.add_argument("--transcript", type=Path, help="Write script-mode transcript to this file")
    parser.add_argument("--layout", choices=["wide", "compact"], default="wide", help="Status output layout")
    args = parser.parse_args(argv)

    client = AiawdTuiClient(
        display_name=args.name,
        agent_runtime=args.agent_runtime,
        model_display_name=args.model_display_name,
        layout=args.layout,
    )
    try:
        commands = load_script_commands(args.script, args.cmd)
        await client.connect(args.host, args.port, start_reader=not commands)
        if commands:
            transcript = await run_script(client, commands)
            output = "\n".join(transcript)
            print(output)
            if args.transcript:
                args.transcript.parent.mkdir(parents=True, exist_ok=True)
                args.transcript.write_text(output + "\n", encoding="utf-8")
        else:
            print(f"已连接：{client.client_id}")
            await repl(client)
    finally:
        await client.close()
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(async_main()))


if __name__ == "__main__":
    main()
