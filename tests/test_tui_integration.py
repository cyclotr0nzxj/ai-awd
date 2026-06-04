import asyncio
import tempfile
import unittest
from pathlib import Path

from aiawd_server.log_store import LogStore
from aiawd_server.tcp_gateway import TCPGateway
from examples.tui_script_demo import run_demo
from tui.aiawd_tui import AiawdTuiClient, run_script


class TuiIntegrationTest(unittest.TestCase):
    def test_two_tui_clients_can_run_match_flow(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            asyncio.run(_two_tui_clients_can_run_match_flow(Path(temp_dir)))

    def test_script_demo_generates_redacted_transcript(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            transcript_path = temp_path / "script_demo.txt"
            transcript = asyncio.run(run_demo(log_dir=temp_path / "logs", transcript_path=transcript_path))
            self.assertTrue(transcript_path.exists())

        text = "\n".join(transcript)
        self.assertIn("== AI-AWD TUI 脚本演示 ==", text)
        self.assertIn("== 排行榜 ==", text)
        self.assertIn("team_a", text)
        self.assertIn("> submit FLAG{已隐藏}", text)
        self.assertNotIn("FLAG{room_", text)


async def _two_tui_clients_can_run_match_flow(tmp_path: Path) -> None:
    gateway = TCPGateway(host="127.0.0.1", port=0, log_store=LogStore(tmp_path / "events.jsonl"))
    await gateway.start()
    alice = AiawdTuiClient(display_name="Alice TUI")
    bob = AiawdTuiClient(display_name="Bob TUI")
    try:
        await alice.connect("127.0.0.1", gateway.port, start_reader=False)
        await bob.connect("127.0.0.1", gateway.port, start_reader=False)

        await run_script(alice, ['create "TUI AWD Demo" real_ctf_web_awd_01 2 0 0 2'])
        assert alice.room_id == "room_001"

        await run_script(bob, [f"join {alice.room_id} player"])
        assert bob.role == "player"

        await run_script(alice, ["start"])
        bob_config = await bob.read_until(lambda message: message.type == "MATCH_CONFIG", timeout=2)
        bob.handle_message(bob_config)

        await alice.wait_for_phase("ATTACK", timeout=3)
        flag = bob_config.payload["flag"]
        transcript = await run_script(alice, [f"submit {flag}"])

        assert any("提交结果已返回" in line for line in transcript)
        assert alice.rankings[0]["team_id"] == "team_a"
        assert alice.rankings[0]["score"] == 100
    finally:
        await alice.close()
        await bob.close()
        await gateway.stop()


if __name__ == "__main__":
    unittest.main()
