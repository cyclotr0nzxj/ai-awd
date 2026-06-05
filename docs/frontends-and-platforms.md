# Frontends And Platforms

AI-AWD Arena should support more than one client surface:

- GUI: Electron desktop client for macOS and Windows.
- TUI: terminal client for demos, SSH sessions, and low-resource environments.
- Headless: protocol demos and automated evidence collectors.

The referee server stays platform-neutral. All clients use the same AIAWD/1.0 TCP protocol and treat the server as authoritative for rooms, phases, scoring, and rankings.

## GUI Direction

The Electron GUI should feel like an AWD competition client, not a raw protocol console.

Primary screens:

1. First-run onboarding: auto-starts once, can be relaunched with `新手教程`, and explains connection, room creation, Agent-player setup, replay, flag submission, and report export.
2. Match lobby: connection state, public rooms with click-to-select room IDs, quick join, create room.
3. AI攻防大乱斗 room staging: free-for-all Agent-player runtime/model entry, Agent-player nodes, spectator list, target ready, Agent ready, owner start.
4. Battle HUD: phase, score, visual arena map with clickable Agent-player avatars, readiness bars, attack-route lanes, attack replay panel, battle-focus details, Agent-player attack/defense status, defense-integrity situation board, target runtime and health metadata, local target lifecycle controls, score-gap rankings, flag submission, tone-coded live events, target summary.
5. Results: final ranking, winner summary, podium, defense-integrity status, latest attack recap, and redacted Markdown report export.
6. Diagnostics: raw protocol messages and redacted match config, hidden from the primary flow.

Design language:

- Dark competition dashboard.
- Clear status colors for connected, ready, attack, warning, and error.
- Free-for-all Agent-player nodes, model labels, clickable combatant avatars, readiness bars, attack-route lanes, attack replay controls/highlights, battle-focus panel, defense-integrity leader markers, defense-intact count, attack leader, high-risk player, streak state, attack heat, event feed, score-gap rankings, final results, redacted report export, and scoreboard visible at a glance.
- Local target actions run only in the Electron main process: renderer requests doctor/install/start/health/stop/reset, main process validates project-local Docker Compose argv, localhost health URLs, and Docker CLI/Compose/daemon availability.
- Plain Chinese labels for participants; protocol names only in diagnostics.
- No public-target or attack-proxy affordances.
- No primary UI/documentation wording should use `大逃杀`, `击杀`, or `生存态势`; the project language is `AI攻防大乱斗`, `攻陷`, `失守`, and `防线完整`.

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
- `target doctor|status|检查|诊断|install|start|health|stop|reset`
- `agent start|stop|status [命令...]`
- `replay prev|next|latest|list|回放 上一攻|下一攻|最新|列表`
- `wait-phase PHASE|大厅|准备|防御|攻防|结束 [SECONDS]`
- `status`
- `quit`

TUI output should mirror the GUI concepts:

- Current room and role.
- Agent runtime/model identity for each player where available.
- Chinese phase labels and rankings.
- Chinese aliases for common roles, readiness, and phase names.
- Agent-player readiness tables.
- AI攻防大乱斗 room and private battle-kit wording.
- Defense-integrity and attack summaries derived from referee events; no standalone defense metric.
- Target runtime, difficulty, and local healthcheck metadata in private battle-kit summaries.
- Local target lifecycle commands that diagnose Docker readiness, then validate project-local Docker Compose argv and localhost health URLs before running.
- Agent lifecycle commands: `agent start` runs a configured adapter against opponent targets, captures flags from output, and submits them through the protocol. `agent stop` terminates the agent process. `agent status` shows the last result.
- All agent commands are validated through `sanitize_command()` to prevent shell injection.
- Agent submissions are gated through `ScopeGuard` for network scope, file scope, and process safety.
- Room, target, battle-kit, and event panels.
- Compact status summaries for narrow terminals and scripted transcripts.
- Redacted private config and redacted submitted flag commands in transcripts.

Current evidence:

- `tests/test_tui_client.py` covers command parsing, local target lifecycle safety checks, agent command building, state updates, readable tables, message labels, and private config redaction.
- `tests/test_tui_integration.py` covers a two-client TUI match flow, the standalone scripted demo, and an agent-captures-flag integration test through the live local referee server.
- `tests/test_agent_runtime.py` covers AgentContext, AgentManager, CustomCommandAdapter, flag extraction, and safe command validation.
- `tests/test_adapters.py` covers the multi-provider adapter factory and each adapter's command template.
- `tests/test_scopeguard.py` covers network scope, file scope, process safety, env allowlist, and audit trail.
- `examples/tui_script_demo.py` writes a redacted Alice/Bob/Carol transcript under `logs/tui/script_demo.txt`.
- `examples/target_lifecycle_evidence.py` writes redacted local target lifecycle evidence under `logs/target_lifecycle/`; live all-target evidence covers Web/PWN/Crypto install/start/health/stop and can distinguish Docker daemon unavailability from target failure.
- `client/electronE2eEvidence.js` writes redacted Electron protocol-bridge evidence under `logs/electron/`; it exercises the same `AiawdClient` bridge used by the Electron main process.
- `client/electronWindowEvidence.js` writes redacted BrowserWindow screenshots under `logs/electron/browserwindow/`; it opens Alice/Bob/Carol windows and verifies the visual room flow, attack-phase arena, attack-route lane, replay controls/highlights, click-to-focus player interaction, nonblank screenshots, and private-flag redaction.
- `client/test-renderer.js` covers first-run onboarding auto-start, completion persistence, skip behavior, relaunch, step navigation, and progress-dot jumps.

Next TUI slices:

- Add smoother interactive prompts for room IDs and template IDs.
- Add optional transcript sections for local target lifecycle evidence in scripted demos.
- Add beginner-friendly status hints that explain allowed target scope, Agent-player setup, and replay navigation without exposing private flags.

## Platform Notes

macOS:

- Electron GUI is the primary local app.
- TUI should run with standard Python in Terminal.

Windows:

- Electron GUI is the primary local app.
- TUI should avoid Unix-only terminal APIs.
- Path, shell, and Docker checks must be explicit later.

Packaging configs exist through electron-builder. Do not claim macOS or Windows packaged support until installers are built and launched on those systems.
