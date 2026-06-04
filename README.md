# AI-AWD Arena

AI-AWD Arena is a C/S prototype for an AI Agent online AWD match platform.

This first development slice implements the referee control plane:

- AIAWD/1.0 TCP protocol with 4-byte big-endian length-prefixed JSON frames.
- Python asyncio referee server.
- `HELLO/WELCOME`, `PING/PONG`, target listing with Docker manifest metadata, room creation, player/spectator joins.
- Minimal match start, `MATCH_CONFIG`, phase sync, flag submission, scoring, ranking, and event broadcasts.
- Standard-library tests for protocol, room rules, match rules, and a three-client TCP integration flow.
- Thin Electron UI shell with a main-process TCP bridge, Chinese guided dashboard, click-to-select room list, battle-royale / 大逃杀 arena visualization, Agent-player runtime/model entry, Agent-player survival/kill HUD, survival situation board, local target lifecycle controls, final results panel, redacted battle report export, ready controls, score-gap rankings, event tone states, redacted match config display, and headless renderer smoke tests.
- Cross-platform line-mode TUI client with readable match tables, scripted mode, transcript output, local target lifecycle commands, and shared AIAWD/1.0 protocol framing.
- Safe Docker Compose target runtime planner plus Electron/TUI local lifecycle runners with localhost-only binding, room-scoped target validation, docker-compose argv allowlists, project-local path checks, redacted public snapshots, local HTTP healthcheck helpers, and a redacted target lifecycle evidence collector.
- Frontend platform notes for an Electron GUI, TUI, and macOS/Windows packaging boundaries.

The current slice intentionally keeps successful live Docker evidence, Hermes/OpenClaw/Pi adapters, ScopeGuard enforcement, and cross-platform packaging as later milestones. A target lifecycle evidence collector exists; the latest live attempt recorded Docker daemon unavailability under `logs/target_lifecycle/`.

## Run Tests

Use Python 3.11+:

```bash
python3 -m unittest discover -s tests -t . -v
```

If your shell cannot import `aiawd_server`, run with:

```bash
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v
```

Run the Node client tests:

```bash
cd client
npm test
```

`npm test` runs both the AIAWD frame codec tests and the headless renderer smoke tests for the Chinese UI.

## Frontend Direction

The GUI is evolving toward an entertaining AWD competition client where one connected client represents one Agent player/model: match lobby, battle-royale / 大逃杀 room staging, Agent runtime/model entry, visual arena map, survival/kill HUD, survival situation board, target runtime/health metadata, local target lifecycle controls, final results panel, redacted battle report export, click-to-select rooms, score-gap rankings, tone-coded live events, target summaries, and a diagnostics area for raw protocol data. The TUI mirrors the same room, phase, ranking, Agent-player readiness, battle-kit, local target lifecycle, survival status, model identity, and flag-submission concepts in a terminal-safe flow. Existing protocol payloads still use `team_id` as the stable internal player id.

## Start Server

```bash
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000
```

Server events are written as JSONL under `logs/server/events.jsonl`.

## Start Electron Client

From `client/`:

```bash
npm install
npm start
```

The renderer does not access TCP directly. The Electron main process owns the AIAWD TCP connection and exposes a narrow preload API.

## Start TUI Client

The TUI is a standard-library line-mode client intended to work on macOS and Windows terminals:

```bash
python3 tui/aiawd_tui.py --host 127.0.0.1 --port 9000 --name Alice --agent-runtime tui-agent --model model-alpha
```

Useful commands inside the TUI include `targets`, `rooms`, `create`, `join`, `ready`, `start`, `submit`, `target`, `wait-phase`, `status`, and `quit`. Common Chinese aliases are supported for roles, readiness, target actions, and phases, such as `参赛`, `观战`, `靶机`, `启动`, and `攻防`.

Run a scripted TUI flow without entering the interactive prompt:

```bash
python3 tui/aiawd_tui.py --host 127.0.0.1 --port 9000 \
  --cmd targets \
  --cmd rooms \
  --cmd status \
  --layout compact \
  --transcript logs/tui/transcript.txt
```

The automated tests include a two-client TUI flow that creates a room, joins a second player, starts a match, waits for `ATTACK`, submits a flag, and verifies ranking.

Run the standalone TUI scripted demo:

```bash
python3 examples/tui_script_demo.py
```

The demo starts a local referee server, connects Alice/Bob/Carol TUI clients, runs a small AWD match, writes a redacted transcript to `logs/tui/script_demo.txt`, and keeps private flags hidden.

## Collect Target Lifecycle Evidence

Dry-run mode validates the local lifecycle plan and writes redacted evidence without starting Docker:

```bash
python3 examples/target_lifecycle_evidence.py
```

Live mode attempts Docker Compose build/start/health/stop on localhost and writes the same redacted evidence files:

```bash
python3 examples/target_lifecycle_evidence.py --live
```

Evidence is written under `logs/target_lifecycle/`. If Docker is installed but the daemon is not running, the live report records that external-state failure explicitly.

## Run Headless Demo

```bash
python3 examples/three_clients_demo.py
```

The demo starts an in-process server, connects three clients, creates a room, joins a second player and a spectator, starts a match, submits a captured flag, and prints the observed protocol transcript.

## Repository Layout

```text
server/aiawd_server/  Python referee server
tests/                Standard-library test suite
examples/             Headless protocol demos
client/               Electron client shell and Node protocol client
tui/                  Cross-platform terminal client
docs/                 Local development notes
logs/                 Runtime logs
```
