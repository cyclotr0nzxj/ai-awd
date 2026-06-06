# Control Plane Slice (M0–M15)

This document tracks the implementation slice from project skeleton through agent runtime, adapters, and safety boundary.

## Implemented

### M0 — Project skeleton
`server/`, `client/`, `docs/`, `examples/`, `tests/`, `logs/`, `targets/`.

### M1 — Protocol
4-byte big-endian length prefix, UTF-8 JSON body, message validation, half/sticky packet tests.

### M2 — Room system
Create room, list rooms, join as player or spectator, capacity rules, room broadcasts.

### M3 — Match control
Owner-only start, `MATCH_CONFIG`, `PHASE_SYNC`, timed phase progression.

### M4 — Referee / scoring
Generated per-player flags, attack-phase submit, self/duplicate/invalid rejection, scoring and ranking. Current protocol payloads still use `team_id` as the internal player id.

### M5 — Docker targets
- 3 target templates: `real_ctf_web_awd_01` (web, HTTP healthcheck), `pwn_awd_echo_01` (binary, TCP healthcheck), `crypto_awd_oracle_01` (crypto, TCP healthcheck).
- `TargetRuntime` builds safe Docker Compose install/start/stop/reset argv, injects room/player/flag env vars, redacts private flag snapshots.
- TCP and HTTP healthcheck support.
- Electron local lifecycle runner with Docker readiness diagnostics, localhost-only binding, argv allowlists, project-local path checks.
- Target lifecycle evidence collector (`examples/target_lifecycle_evidence.py`) with single-template and all-target dry-run/live modes.

### M6–M7 — Agent Runtime
- Client-side Agent Runtime in Node (`client/agentRuntime.js`).
- `AgentContext`, `AgentManager`, `CustomCommandAdapter`, flag extraction (regex), safe command validation.
- Electron integration: IPC handlers in main process, preload API, renderer UI controls (start/stop buttons, command input, status display).

### M8 — Agent adapters
- Multi-provider adapter layer: BasicHTTP, Hermes, OpenClaw, OpenCLI, Codex, Pi, CustomPython, and custom command adapters.
- Unified `adapter_for()` factory with `detect_available_adapters()`.
- All adapters implement `AgentAdapter`: `configure(ctx)`, `run(submit=)`, `stop()`.
- Node (`client/adapters.js`).

### M9b — Code audit & hardening
Comprehensive 3-agent parallel audit. Fixed: FrameDecoder buffer order, execSync→spawnSync, async agent execution (Electron), PING/PONG heartbeat (30s/60s), sanitizeCommand `&`/`\t`/`#`/`~` gaps, HTTP blanket-except→typed handling + writer cleanup, zombie room on join failure, attack count drift→server-authoritative, phase scheduler recovery (FINISHED broadcast), session TTL cleanup, TUI reader_loop crash on non-IncompleteReadError.

### M9 — ScopeGuard safety boundary
- Network scope: localhost-only + allowed_targets allowlist.
- File scope: project root enforcement.
- Process safety: shell injection prevention, env allowlist, timeout limits.
- Audit trail with `security_summary()`.
- Node (`client/scopeguard.js`).

### M10 — Electron UI (ongoing)
Main-process TCP bridge, preload API, Chinese AI攻防大乱斗 dashboard, first-run onboarding tutorial, room selection, agent runtime/model entry, visual Agent-player arena with clickable avatars/readiness bars/attack-route lanes/battle-focus panel, battle replay with auto-play timeline + clickable capture dots + prev/next/latest/jump navigation, score delta popup animations, attack/defense HUD, target lifecycle controls and Docker diagnostics, final results panel, redacted battle report export, score-gap rankings, event tone states, agent controls, headless renderer smoke tests, IPC bridge smoke tests.

### M11 — HTTP API
Minimal async HTTP/1.1 server (stdlib only), read-only REST endpoints (`/health`, `/api/v1/targets`, `/api/v1/rooms/*`, `/api/v1/matches/*`), CORS headers, recursive flag redaction, shares state with TCP gateway.

### M12 — Packet capture evidence
`PcapCollector` — captures HTTP/TCP traffic metadata, writes standard PCAP files + JSON evidence logs, room-scoped filtering, flag path redaction, context manager API.

### M13 — Cross-platform packaging
electron-builder configs: macOS DMG/ZIP (x64+arm64, hardened runtime) and Windows NSIS/portable (x64), macOS entitlements plist, asar compression.

### M14 — Electron protocol evidence
`client/electronE2eEvidence.js` starts a local Python referee server, drives three Electron-side protocol clients through create/join/spectate/start/submit/ranking, and writes redacted JSON evidence under `logs/electron/`. This is a repeatable bridge smoke that complements BrowserWindow screenshot evidence.

### M15 — Electron BrowserWindow screenshot evidence
`client/electronWindowEvidence.js` starts a local Python referee server, opens Alice/Bob/Carol BrowserWindows, drives create/join/spectate/start/submit/ranking/replay controls, captures redacted PNG screenshots under `logs/electron/browserwindow/`, and writes assertion evidence under `logs/electron/e2e_browserwindow_evidence.json`, including attack-phase arena, attack-route lane, attacker/target replay highlights, replay navigation, and click-to-focus player visibility checks.

## Evidence

- `PYTHONPATH=server python3 -m unittest discover -s tests -t . -v` — 54 tests
- `cd client && npm test` — 89 tests
- `cd client && npm run e2e:protocol` — redacted Electron protocol bridge evidence
- `cd client && npm run e2e:windows` — redacted Electron BrowserWindow screenshots
- `examples/three_clients_demo.py`
- `examples/target_lifecycle_evidence.py`
- `curl http://127.0.0.1:9001/health` (HTTP API)
- `logs/server/events.jsonl`
- `logs/target_lifecycle/target_lifecycle_evidence.*`
- `logs/target_lifecycle/target_lifecycle_all_evidence.*`

## Remaining Product Gaps

- macOS `.app` bundle verified (build + launch). Windows NSIS + portable builds verified and published on GitHub Releases (v1.0.0).
- Named agent adapters are implemented; keep per-binary real-CLI verification claims tied to captured local evidence.

## Next Best Slices

1. Real-CLI agent smoke tests (Anthropic/OpenAI/Hermes/Codex) against live Docker targets.
2. Live Docker all-target evidence (`--live --all-targets`) when Docker Desktop is available.
3. Code signing for macOS and Windows installers.
