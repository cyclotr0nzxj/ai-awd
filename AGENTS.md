# AI-AWD Arena Agent Guide

This file is the entry guide for Codex and other coding agents working in this repository.

## Canonical Project Docs

Primary upstream docs live outside the repo:

- `/Users/mac/Documents/ai-awd/AI-AWD-Arena-full-dev-docs/ai_awd_requirements.md`
- `/Users/mac/Documents/ai-awd/AI-AWD-Arena-full-dev-docs/ai_awd_development_plan.md`
- `/Users/mac/Documents/ai-awd/AI-AWD-Arena-full-dev-docs/AI-AWD-Arena-full-development-docs.md`

Local progress docs:

- `README.md`
- `docs/m0-m4-control-plane-slice.md`
- `docs/frontends-and-platforms.md`

Read the local docs first. Read the upstream docs when expanding scope or checking product intent.

## Product Boundary

AI-AWD Arena is a C/S AI-AWD match prototype for coursework demos and AI security evaluation inside authorized local labs.

Keep this boundary firm:

- The client runs local targets, local Agent Runtime, Docker, and tools.
- The server is the room server and referee only.
- The server must not become an attack proxy or execute attack/defense actions for an agent.
- Real attack/defense activity must stay inside room-scoped `allowed_targets`.
- First version must not support public targets, third-party scanning, unlimited shell, cloud orchestration, exploit tutorials, or commercial user systems.

## Current Implementation State

Implemented:

- Python asyncio referee server under `server/aiawd_server/`.
- AIAWD/1.0 length-prefixed JSON protocol.
- `HELLO/WELCOME`, `PING/PONG`, target list, room creation, player/spectator joins.
- Owner-only match start, `MATCH_CONFIG`, phase sync.
- Target registry exposes Docker Compose manifest metadata; `MATCH_CONFIG` includes `target_manifest` for players.
- Generated per-team flags, attack-phase submit, self/duplicate/invalid rejection, scoring and ranking.
- Headless three-client demo in `examples/three_clients_demo.py`.
- Standard-library `unittest` tests under `tests/`.
- Electron shell under `client/` with main-process TCP bridge, preload API, Chinese AWD battle dashboard, phase timer, click-to-select room list, private battle kit summary, ready controls, score-gap rankings, event tone states, and headless renderer smoke tests.
- Cross-platform standard-library TUI under `tui/` with interactive commands, Chinese role/readiness/phase aliases, readable match tables, compact/wide status layouts, scripted `--script` / `--cmd` mode, redacted transcript output, standalone demo, and integration coverage.

Not implemented yet:

- Electron end-to-end screenshots with a live server and three app windows.
- Actual Docker target install, compose startup, and health checks.
- Hermes/OpenClaw/Pi/custom-command runtime adapters.
- ScopeGuard network/file enforcement.
- Packet capture evidence.
- macOS/Windows packaging.

## Development Strategy

Use a NEXUS-Micro style workflow:

1. PM/Sprint Prioritizer: choose the smallest milestone slice.
2. Backend Architect: check protocol, server authority, state model, and edge cases.
3. Implementer: make scoped code changes.
4. Reality Checker/Evidence Collector: require tests, logs, screenshots, or demo transcript.

Prefer a stable control-plane loop before adding complex agents or real targets.

Recommended milestone order:

1. Protocol.
2. Server rooms.
3. Electron UI.
4. Match state machine.
5. Flag scoring.
6. Spectator UI.
7. Docker targets.
8. Agent Runtime.
9. Hermes adapter.
10. Safety boundary and report materials.

## Commands

Run tests:

```bash
python3 -m unittest discover -s tests -t . -v
```

If imports fail:

```bash
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v
```

Start server:

```bash
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000
```

Run headless demo:

```bash
python3 examples/three_clients_demo.py
```

Run Node protocol tests:

```bash
node --test client/test-aiawdProtocol.js
```

Run all Node client tests:

```bash
cd client
npm test
```

Run TUI-focused tests:

```bash
python3 -m unittest tests.test_tui_client tests.test_tui_integration -v
```

Run TUI scripted demo:

```bash
python3 examples/tui_script_demo.py
```

Start TUI client:

```bash
python3 tui/aiawd_tui.py --host 127.0.0.1 --port 9000 --name 红队
```

The local TCP tests and demo bind `127.0.0.1`; sandboxed runs may need approval.

## Coding Rules

- Keep Python server code dependency-light. Current tests use only the standard library.
- Keep Electron renderer thin. Renderer must call the preload API, not Node TCP APIs directly.
- Keep TUI dependency-light and cross-platform; avoid Unix-only terminal APIs such as Python `curses`.
- Maintain AIAWD/1.0 frame format: 4-byte big-endian length prefix plus UTF-8 JSON body.
- Preserve common message fields: `v`, `seq`, `type`, `client_id`, `room_id`, `role`, `ts`, `payload`.
- Treat `client_id + seq` as idempotent for side-effecting requests.
- Never log API keys or flag plaintext to public spectator/event payloads.
- Redact `MATCH_CONFIG.flag` from UI display and screenshots unless explicitly debugging a private player view.
- Spectator is read-only: no match start, no flag submit, no agent start.
- `SUBMIT_FLAG_REQ` is only valid in `ATTACK`.
- One flag can score only once globally per room.
- Keep generated runtime logs under `logs/`; do not commit JSONL/log runtime artifacts.

## Verification Gates

For every server/protocol change:

- Protocol unit tests pass.
- Room/match unit tests pass.
- Three-client TCP integration test passes.
- `examples/three_clients_demo.py` still produces a readable transcript.

For Electron/UI work:

- Server remains authoritative.
- UI shows connection, room list, create/join/spectate, phase, event stream, and ranking.
- UI shows target difficulty/runtime and player target/Agent ready status.
- `client/test-renderer.js` covers Chinese offline state, protocol update rendering, phase timer, battle kit summary, room selection, score-gap rankings, event tone states, raw protocol message display, and private flag redaction.
- Main process owns AIAWD TCP; renderer only uses `window.aiawd`.
- Capture screenshot evidence after significant UI milestones.

For TUI work:

- TUI uses the same AIAWD/1.0 protocol helpers as the server.
- `tests/test_tui_client.py` and `tests/test_tui_integration.py` pass.
- Private `MATCH_CONFIG.flag` is redacted from status/transcripts unless explicitly debugging a private player view.
- `examples/tui_script_demo.py` produces a readable Alice/Bob/Carol transcript under `logs/tui/`.

For Docker/Agent work:

- Add negative tests for out-of-scope targets and secrets.
- Do not claim Hermes/OpenClaw/Pi support until a real command is launched, logs are captured, and flag submission helper flow is proven.

## Next Best Slices

- Build Electron end-to-end evidence around the existing tested protocol:

1. Start the Python server.
2. Launch three Electron clients.
3. Capture screenshots for Alice creating a room, Bob joining as player, Carol joining as spectator, phase sync, and ranking update.
4. Add a GUI/Electron smoke test once Electron dependencies are installed.

- Continue TUI polish with interactive prompts for room IDs/template IDs and clearer script authoring ergonomics.
