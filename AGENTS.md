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
- Target registry with 3 Docker Compose target templates (web, pwn, crypto) with TCP and HTTP healthcheck support.
- Generated per-team flags, attack-phase submit, self/duplicate/invalid rejection, scoring and ranking.
- Client-side Agent Runtime module (Python + Node) with `AgentManager`, `CustomCommandAdapter`, flag extraction, safe command validation.
- Multi-provider agent adapters: BasicHTTP, Hermes, OpenClaw, OpenCLI, Codex, Pi, CustomPython, and custom shell commands via a unified `adapter_for()` factory. Keep real-CLI verification claims tied to captured evidence for each binary.
- Client-side ScopeGuard safety boundary: network scope (localhost + allowlist), file scope (project root), process safety (shell injection prevention), env allowlist, timeout enforcement, audit trail.
- Agent Runtime TUI integration: `agent start/stop/status` commands with Chinese aliases, cross-thread flag submission.
- Agent Runtime Electron integration: IPC handlers in main process, preload API, renderer UI controls (start/stop button, command input, status display).
- Server HTTP API layer: read-only REST endpoints alongside TCP (health, targets, rooms, rankings, events, matches), CORS headers, recursive flag redaction, stdlib only.
- Packet capture evidence collector: PCAP + JSON output, room-scoped filtering, flag path redaction, standard libpcap format.
- Cross-platform packaging configs: electron-builder for macOS (DMG, arm64/x64) and Windows (NSIS, portable).
- Headless three-client demo in `examples/three_clients_demo.py`.
- Electron protocol-bridge evidence script in `client/electronE2eEvidence.js`; starts a local server and drives three Electron-side protocol clients through create/join/spectate/start/submit/ranking with flag redaction.
- Electron BrowserWindow evidence script in `client/electronWindowEvidence.js`; starts a live local server, opens Alice/Bob/Carol windows, captures redacted screenshots, and verifies the AI攻防大乱斗 attack-phase arena, attack replay controls/highlights, click-to-focus, and private flag redaction.
- Electron first-run onboarding under `client/onboarding.js`; auto-starts once, can be relaunched from the `新手教程` button, highlights setup/replay/report steps, and persists completion in localStorage.
- Standard-library `unittest` tests under `tests/` (144 Python + 89 Node tests).
- Cross-platform standard-library TUI under `tui/` with interactive commands, Chinese role/readiness/phase/agent/replay aliases, readable match tables, compact/wide status layouts, battle replay commands (prev/next/latest/list), scripted `--script` / `--cmd` mode, redacted transcript output, standalone demo, and integration coverage.

Known product gaps:

- macOS `.app` bundle verified (builds and launches). Windows NSIS/portable configs need a Windows build host for verification.

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
/usr/local/Caskroom/miniforge/base/bin/python3 -m unittest discover -s tests -t . -v
```

If imports fail:

```bash
PYTHONPATH=server /usr/local/Caskroom/miniforge/base/bin/python3 -m unittest discover -s tests -t . -v
```

The Python suite requires Python 3.11+; `/usr/bin/python3` on this Mac is 3.9 and fails on `dataclass(slots=True)`.

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
- User-facing product language is `AI攻防大乱斗`: prefer `攻陷`, `失守`, `防线完整`, `AI攻防态势`; do not reintroduce `大逃杀`, `击杀`, or `生存态势` as primary UI/documentation wording.

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
- `client/test-renderer.js` covers Chinese offline state, protocol update rendering, phase timer, battle kit summary, AI攻防大乱斗 arena/replay state, first-run onboarding, room selection, score-gap rankings, event tone states, raw protocol message display, and private flag redaction.
- Main process owns AIAWD TCP; renderer only uses `window.aiawd`.
- Capture screenshot evidence after significant UI milestones.

For TUI work:

- TUI uses the same AIAWD/1.0 protocol helpers as the server.
- `tests/test_tui_client.py`, `tests/test_tui_integration.py`, and `tests/test_agent_runtime.py` pass.
- Private `MATCH_CONFIG.flag` is redacted from status/transcripts unless explicitly debugging a private player view.
- `examples/tui_script_demo.py` produces a readable Alice/Bob/Carol transcript under `logs/tui/`.

For Agent/Adapter work:

- `tests/test_adapters.py` and `tests/test_scopeguard.py` pass.
- Agent adapters implement the `AgentAdapter` interface: `configure()`, `run(submit=)`, `stop()`.
- Agent commands are validated through `sanitize_command()` before execution.
- Do not claim a named adapter is verified with a real CLI binary until logs or evidence capture an actual launch and flag-submission flow. Keep OpenClaw tests aligned to `openclaw infer model run`.

For HTTP API work:

- `tests/test_http_api.py` passes all 14 endpoint tests.
- Server starts with `--http-port 9001`, responds to `curl http://127.0.0.1:9001/health`.
- All responses are read-only GET, no private flags exposed.
- CORS headers present on all responses.

For ScopeGuard work:

- All agent runs are gated through `ScopeGuard.guard_agent_run()`.
- Network targets must be in `allowed_targets` and localhost-only.
- File paths must resolve within project root.
- Environment variables must be in the allowlist.

## Next Best Slices

1. Build and launch packaged Windows artifacts from the existing electron-builder config (macOS `.app` already verified).
2. Add real-CLI agent smoke tests (Hermes/Pi/OpenCLI/Codex) against live Docker targets when Docker Desktop is available.
3. Refresh live Docker all-target evidence (`--live --all-targets`) when Docker daemon is running.
