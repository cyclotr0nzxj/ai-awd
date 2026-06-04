# Control Plane Slice

This slice follows the NEXUS-Micro workflow used for the first implementation pass.

## Implemented

- M0 project skeleton: `server/`, `client/`, `docs/`, `examples/`, `tests/`, `logs/`.
- M1 protocol: 4-byte big-endian length prefix, UTF-8 JSON body, message validation, half/sticky packet tests.
- M2 room system: create room, list rooms, join as player or spectator, capacity rules, room broadcasts.
- M3a match control: owner-only start, `MATCH_CONFIG`, `PHASE_SYNC`, timed phase progression.
- M4-lite referee path: generated per-player flags, attack-phase submit, self/duplicate/invalid rejection, scoring and ranking. Current protocol payloads still use `team_id` as the internal player id.
- Electron UI slice: main-process TCP bridge, preload API, guided Chinese AWD battle dashboard, offline fallback, click-to-select room list, Agent runtime/model entry, battle-royale / 大逃杀 Agent-player arena visualization, survival/kill HUD, survival situation board, local target lifecycle controls, final results panel, redacted battle report export, target list, phase timer, private battle kit summary, score-gap rankings, tone-coded live events, redacted match config display.
- Frontend direction: Electron GUI as AWD match lobby/battle HUD; cross-platform line-mode TUI with readable match tables, scripted mode, redacted transcript output, and macOS/Windows packaging boundaries recorded in `docs/frontends-and-platforms.md`.
- Headless renderer smoke test: Chinese offline state, Agent runtime/model join payload, protocol update rendering, battle-royale / 大逃杀 Agent-player arena nodes, survival/kill HUD, survival situation board, local target lifecycle controls, final results panel, redacted battle report export, click-to-select room behavior, score-gap rankings, event tone states, and private flag redaction without requiring Electron startup.
- M5-lite target manifest: registry exposes Docker Compose manifest metadata, `LIST_TARGETS_RES` returns it, and player `MATCH_CONFIG` includes `target_manifest`.
- M5-lite target runtime planner: `TargetRuntime` builds safe Docker Compose install/start/stop/reset argv, inherits local process environment for Docker lookup, injects room/player/flag env vars, redacts private flag snapshots, and limits health checks to local HTTP targets.
- M5-lite Electron target lifecycle runner: main process validates `target_runtime` actions, injects the private flag only into local command env, allows only project-local Docker Compose argv, checks only local HTTP health URLs, and returns redacted status summaries to the renderer.
- M5-lite TUI target lifecycle runner: `target install|start|health|stop|reset` uses the same local-only, project-local Docker Compose argv validation and keeps private flags out of transcripts/status text.
- M5-lite target lifecycle evidence collector: `examples/target_lifecycle_evidence.py` writes redacted dry-run/live reports under `logs/target_lifecycle/`; live mode preflights Docker daemon availability before running Compose.
- M5-lite readiness controls: players can send `TARGET_READY` / `AGENT_READY`; spectators are rejected; UI shows target/Agent ready state.
- TUI output modes: `--layout wide` keeps the readable table view, while `--layout compact` emits a shorter redacted status summary for narrow terminals and scripted transcripts.
- Battle-royale / 大逃杀 room model: rooms with 3+ Agent players build each player's private config with every other player as an opponent and only room-scoped `allowed_targets`; UI metrics derive survival status and kill count from referee events.

## Evidence

- `python3 -m unittest discover -s tests -t . -v`
- `examples/three_clients_demo.py`
- `logs/server/events.jsonl`
- `node --test client/test-aiawdProtocol.js`
- `npm test` from `client/`
- `tests/test_tui_client.py`
- `tests/test_tui_integration.py`
- `examples/tui_script_demo.py`
- `logs/tui/script_demo.txt`
- `tests/test_target_registry.py`
- `tests/test_target_runtime.py`
- `tests/test_target_lifecycle_evidence.py`
- `client/test-targetLifecycle.js`
- TUI lifecycle assertions in `tests/test_tui_client.py`
- `examples/target_lifecycle_evidence.py`
- `logs/target_lifecycle/target_lifecycle_evidence.json`
- `logs/target_lifecycle/target_lifecycle_evidence.txt`
- Headless renderer assertions for guided UI state, protocol update rendering, and private flag redaction.

## Not Implemented Yet

- Electron end-to-end screenshots with a live server and three app windows. The Browser plugin could not capture this in the current sandbox because localhost and file URLs were blocked by policy.
- Successful live Docker target install/start/healthcheck evidence. The collector exists and the latest live run records Docker daemon unavailability rather than a target/runtime failure.
- Hermes/OpenClaw/Pi adapters.
- ScopeGuard network/file enforcement.
- Packet capture artifacts.
- Cross-platform packaging.

## Next Best Slices

- Build Electron GUI end-to-end evidence around the already-tested protocol:

1. Start the Python server.
2. Launch three Electron clients.
3. Capture screenshots for connection, create room, player join, spectator join, phase sync, flag capture, and ranking update.
4. Add a GUI/Electron smoke test if local dependency installation is available.

- Continue TUI polish with interactive prompts for room IDs and template IDs.
- Rerun `python3 examples/target_lifecycle_evidence.py --live` after starting Docker Desktop or another Docker daemon, then preserve the successful redacted transcript.
- Continue entertainment UI polish with richer arena animations and live Electron screenshots.
