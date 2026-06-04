from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
for path in (ROOT, SERVER):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from aiawd_server.log_store import LogStore
from aiawd_server.tcp_gateway import TCPGateway
from tui.aiawd_tui import AiawdTuiClient, run_script


async def run_demo(
    *,
    log_dir: Path | None = None,
    transcript_path: Path | None = None,
) -> list[str]:
    runtime_dir = log_dir or ROOT / "logs" / "tui"
    runtime_dir.mkdir(parents=True, exist_ok=True)

    gateway = TCPGateway(host="127.0.0.1", port=0, log_store=LogStore(runtime_dir / "events.jsonl"))
    await gateway.start()

    transcript = [
        "== AI-AWD TUI 脚本演示 ==",
        f"裁判服务器：127.0.0.1:{gateway.port}",
    ]
    clients = [
        AiawdTuiClient(display_name="Alice", model_display_name="model-alpha"),
        AiawdTuiClient(display_name="Bob", model_display_name="model-beta"),
        AiawdTuiClient(display_name="Carol 观战"),
    ]
    alice, bob, carol = clients

    try:
        for client in clients:
            await client.connect("127.0.0.1", gateway.port, start_reader=False)

        append_block(
            transcript,
            "Alice 创建 2 玩家 AWD 房间",
            await run_script(alice, ['create "TUI AWD Demo" real_ctf_web_awd_01 2 0 0 2']),
        )
        room_id = alice.room_id
        if not room_id:
            raise RuntimeError("Alice did not receive a room_id")

        append_block(transcript, "Bob 加入参赛席", await run_script(bob, [f"join {room_id} player"]))
        append_block(transcript, "Carol 加入观战席", await run_script(carol, [f"join {room_id} spectator"]))

        append_block(transcript, "Alice 开始比赛", await run_script(alice, ["start"]))

        bob_config = await bob.read_until(lambda message: message.type == "MATCH_CONFIG", timeout=3)
        bob.handle_message(bob_config)
        bob_phase = await bob.read_until(lambda message: message.type == "PHASE_SYNC", timeout=3)
        bob.handle_message(bob_phase)
        append_block(transcript, "Bob 收到私人战斗包", bob.status_lines())

        append_block(transcript, "Alice 等待进入攻防阶段", [await alice.wait_for_phase("ATTACK", timeout=3)])

        flag = bob_config.payload["flag"]
        append_block(transcript, "Alice 提交 Bob 的 flag", await run_script(alice, [f"submit {flag}"]))

        output = "\n".join(transcript) + "\n"
        if transcript_path:
            transcript_path.parent.mkdir(parents=True, exist_ok=True)
            transcript_path.write_text(output, encoding="utf-8")
        return transcript
    finally:
        for client in clients:
            await client.close()
        await gateway.stop()


def append_block(transcript: list[str], title: str, lines: list[str]) -> None:
    transcript.append("")
    transcript.append(f"-- {title} --")
    transcript.extend(lines)


async def async_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a local AI-AWD TUI scripted match demo")
    parser.add_argument("--log-dir", type=Path, default=ROOT / "logs" / "tui")
    parser.add_argument("--transcript", type=Path, default=ROOT / "logs" / "tui" / "script_demo.txt")
    args = parser.parse_args(argv)

    transcript = await run_demo(log_dir=args.log_dir, transcript_path=args.transcript)
    print("\n".join(transcript))
    print(f"\n转录已写入：{args.transcript}")
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(async_main()))


if __name__ == "__main__":
    main()
