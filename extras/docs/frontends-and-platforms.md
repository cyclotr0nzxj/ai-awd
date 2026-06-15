# Frontends And Platforms

AI-AWD Arena should support more than one client surface:

- GUI: Electron desktop client for macOS and Windows.
- Headless: protocol demos and automated evidence collectors.

The referee server stays platform-neutral. All clients use the same AIAWD/1.0 TCP protocol and treat the server as authoritative for rooms, phases, scoring, and rankings.

## GUI Direction

The Electron GUI should feel like an AWD competition client, not a raw protocol console.

Primary screens:

1. Match lobby: connection state, two large action cards（加入房间 / 创建房间）, each opening a floating overlay sub-page. Join overlay shows room search, clickable room list, and join-as-player/spectator buttons. Create overlay shows map cards, format presets, and room config.
2. AI攻防大乱斗 room staging: full-width player list with ready/busy indicators, inline prepare bar at bottom (Agent runtime select, API key, model name), ready toggle, host start button.
3. Battle HUD: phase, score, visual arena map with clickable Agent-player avatars, readiness bars, attack-route lanes, attack replay panel, battle-focus details, Agent-player attack/defense status, defense-integrity situation board, target runtime and health metadata, local target lifecycle controls, score-gap rankings, flag submission, tone-coded live events, target summary.
4. Results: final ranking, winner summary, podium, defense-integrity status, latest attack recap, and redacted Markdown report export.
5. Diagnostics: raw protocol messages and redacted match config, hidden from the primary flow.

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

## Platform Notes

macOS:

- Electron GUI is the primary local app.
- macOS `.app` bundle verified: builds and launches.
- Packaged via `npm run pack` → `dist/mac/AI-AWD Arena.app`

Windows:

- Electron GUI is the primary local app.
- electron-builder NSIS/portable configs verified; Windows builds uploaded to GitHub Releases.

Packaging configs exist through electron-builder (`client/package.json`). macOS and Windows packaging verified; both published on [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases).
