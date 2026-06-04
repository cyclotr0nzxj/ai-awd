# Frontends And Platforms

AI-AWD Arena should support more than one client surface:

- GUI: Electron desktop client for macOS and Windows.
- TUI: terminal client for demos, SSH sessions, and low-resource environments.
- Headless: protocol demos and automated evidence collectors.

The referee server stays platform-neutral. All clients use the same AIAWD/1.0 TCP protocol and treat the server as authoritative for rooms, phases, scoring, and rankings.

## GUI Direction

The Electron GUI should feel like an AWD competition client, not a raw protocol console.

Primary screens:

1. Match lobby: connection state, public rooms with click-to-select room IDs, quick join, create room.
2. Battle-royale / 大逃杀 room staging: free-for-all Agent-player runtime/model entry, Agent-player nodes, spectator list, target ready, Agent ready, owner start.
3. Battle HUD: phase, score, visual arena map, Agent-player survival/kill status, survival situation board, target runtime and health metadata, local target lifecycle controls, score-gap rankings, flag submission, tone-coded live events, target summary.
4. Results: final ranking, winner summary, podium, survival status, latest kill recap, and redacted Markdown report export.
5. Diagnostics: raw protocol messages and redacted match config, hidden from the primary flow.

Design language:

- Dark competition dashboard.
- Clear status colors for connected, ready, attack, warning, and error.
- Free-for-all Agent-player nodes, model labels, survival leader markers, survival count, kill leader, high-risk player, streak state, kill heat, event feed, score-gap rankings, final results, redacted report export, and scoreboard visible at a glance.
- Local target actions run only in the Electron main process: renderer requests install/start/health/stop/reset, main process validates project-local Docker Compose argv and localhost health URLs.
- Plain Chinese labels for participants; protocol names only in diagnostics.
- No public-target or attack-proxy affordances.

Product language:

- One client maps to one Agent player/model.
- Use `玩家` or `Agent 玩家` in user-facing text, with model names shown as details.
- Keep `team_id` only as the current internal protocol player id until a dedicated protocol rename is planned.

## TUI Direction

The first TUI is a cross-platform line-mode client, not a curses-only interface, because Python `curses` is not available by default on Windows. The client lives in `tui/aiawd_tui.py` and reuses the same AIAWD/1.0 protocol framing as the server tests. It supports interactive use plus scripted `--script` / repeated `--cmd` execution with optional transcript output, `--agent-runtime`, `--model`, local target lifecycle commands, and `--layout wide|compact` status output.

Initial commands:

- `targets`
- `rooms`
- `create ROOM_NAME TEMPLATE_ID [PLAYERS] [PREPARE_SEC] [DEFENSE_SEC] [ATTACK_SEC]`
- `join ROOM_ID player|spectator|参赛|观战`
- `ready target|agent|靶机|智能体`
- `start`
- `submit FLAG`
- `target install|start|health|stop|reset`
- `wait-phase PHASE|大厅|准备|防御|攻防|结束 [SECONDS]`
- `status`
- `quit`

TUI output should mirror the GUI concepts:

- Current room and role.
- Agent runtime/model identity for each player where available.
- Chinese phase labels and rankings.
- Chinese aliases for common roles, readiness, and phase names.
- Agent-player readiness tables.
- Battle-royale / 大逃杀 room and private battle-kit wording.
- Survival and kill summaries derived from referee events; no standalone defense metric.
- Target runtime, difficulty, and local healthcheck metadata in private battle-kit summaries.
- Local target lifecycle commands that validate project-local Docker Compose argv and localhost health URLs before running.
- Room, target, battle-kit, and event panels.
- Compact status summaries for narrow terminals and scripted transcripts.
- Redacted private config and redacted submitted flag commands in transcripts.

Current evidence:

- `tests/test_tui_client.py` covers command parsing, local target lifecycle safety checks, state updates, readable tables, message labels, and private config redaction.
- `tests/test_tui_integration.py` covers a two-client TUI match flow and the standalone scripted demo through the live local referee server.
- `examples/tui_script_demo.py` writes a redacted Alice/Bob/Carol transcript under `logs/tui/script_demo.txt`.
- `examples/target_lifecycle_evidence.py` writes redacted local target lifecycle evidence under `logs/target_lifecycle/`; current live evidence can distinguish Docker daemon unavailability from target failure.

Next TUI slices:

- Add smoother interactive prompts for room IDs and template IDs.
- Add optional transcript sections for successful local target lifecycle evidence once Docker daemon is available.

## Platform Notes

macOS:

- Electron GUI is the primary local app.
- TUI should run with standard Python in Terminal.

Windows:

- Electron GUI is the primary local app.
- TUI should avoid Unix-only terminal APIs.
- Path, shell, and Docker checks must be explicit later.

Packaging is still a later milestone. Do not claim macOS or Windows packaged support until installers are built and launched on those systems.
