# AI-AWD Arena — Developer Guide

This is the technical reference for AI coding agents and developers working on AI-AWD Arena. For user-facing documentation, see [README.md](README.md).

## Architecture

```
Electron App (client/)          Python Server (server/aiawd_server/)
┌──────────────────────┐       ┌──────────────────────────┐
│  renderer.js + UI    │       │  tcp_gateway.py           │
│  onboarding.js       │◄─────►│  room_manager.py          │
│  agentRuntime.js     │ TCP   │  match_engine.py          │
│  adapters.js         │AIAWD  │  session_manager.py       │
│  scopeguard.js       │/1.0   │  target_registry.py       │
│  targetLifecycle.js  │       │  http_api.py              │
│  aiawdProtocol.js    │       │  protocol.py              │
└──────────────────────┘       └──────────────────────────┘
```

**Server is referee only.** It manages rooms, enforces match rules, scores flags, and broadcasts events. It never executes attack/defense actions or touches Docker. All attack activity stays on the client side within room-scoped `allowed_targets`.

## Quick Commands

```bash
# Python tests (54)
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v

# Node tests (89) — run from client/
cd client
node --test test-aiawdProtocol.js test-targetLifecycle.js test-renderer.js \
          test-agentRuntime.js test-adapters.js test-main.js

# Full verification suite
bash scripts/demo.sh --quick

# Start server (local)
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000

# Start server with HTTP API
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000 --http-port 9001

# Start Electron
cd client && npx electron .

# Package macOS app
cd client && npm run pack && open dist/mac/AI-AWD\ Arena.app

# Headless demo
PYTHONPATH=server python3 examples/three_clients_demo.py

# Target lifecycle evidence (dry-run)
PYTHONPATH=server python3 examples/target_lifecycle_evidence.py --all-targets

# BrowserWindow visual evidence (35 assertions)
cd client && npx electron electronWindowEvidence.js
```

## Protocol

AIAWD/1.0 — 4-byte big-endian length prefix + UTF-8 JSON body. Max frame 1 MB.

Key message types: `HELLO`/`WELCOME`, `CREATE_ROOM_REQ`/`RES`, `JOIN_ROOM_REQ`/`RES`, `START_MATCH_REQ`/`RES`, `MATCH_CONFIG`, `PHASE_SYNC`, `SUBMIT_FLAG_REQ`/`RES`, `RANKING_UPDATE`, `EVENT`, `ROOM_UPDATE`, `LIST_ROOMS_REQ`/`RES`, `LIST_TARGETS_REQ`/`RES`, `ERROR`.

All messages include: `v`, `seq`, `type`, `client_id`, `room_id`, `role`, `ts`, `payload`.

`client_id + seq` is treated as idempotent for side-effecting requests.

## Phase State Machine

```
LOBBY → PREPARE → DEFENSE → ATTACK → FINISHED
```

- `SUBMIT_FLAG_REQ` valid only in ATTACK.
- One flag scores only once globally per room.
- Spectators are read-only throughout.

## Agent Adapters

7 providers, unified via `adapterFor()` / `adapter_for()`:

| Adapter | CLI | Node | Python |
|---------|-----|------|--------|
| Anthropic (Claude) | via API | - | - |
| OpenAI (GPT) | via API | - | - |
| Hermes | `hermes` | ✓ | ✓ |
| OpenClaw | `openclaw` | ✓ | ✓ |
| Codex | `codex` | ✓ | ✓ |
| OpenCLI | `opencli` | ✓ | ✓ |
| Pi | `pi` | ✓ | ✓ |
| Mock | built-in | ✓ | ✓ |

API-key-based providers (Anthropic, OpenAI) are configured in the Electron UI. CLI-based providers require the binary on `PATH`.

## Safety Boundary (ScopeGuard)

- Network targets → `allowed_targets` only, localhost-only
- File paths → must resolve within project root
- Process safety → `sanitize_command()` blocks shell metacharacters (`;`, `|`, `&`, `` ` ``)
- Environment → allowlisted vars only
- Audit trail → every guard call logged

## Coding Rules

- Python server: stdlib only. Tests use `unittest`.
- Electron renderer: no direct TCP. All server communication through `window.aiawd` (preload API).
- Flag redaction: never log API keys or flag plaintext. `MATCH_CONFIG.flag` always redacted in UI/logs/screenshots.
- Language: `AI攻防大乱斗`, `攻陷`, `失守`, `防线完整`. Do not use `大逃杀`, `击杀`, `生存态势`.

## Verification Gates

**Server/protocol changes:**
- Python tests pass (54)
- `examples/three_clients_demo.py` produces readable transcript
- Protocol unit tests pass

**Electron/UI changes:**
- Node tests pass (89)
- `client/test-renderer.js` covers onboarding, arena, replay, battle kit, flag redaction
- Main process owns AIAWD TCP; renderer uses `window.aiawd`
- `npx electron electronWindowEvidence.js` produces 35 passing assertions

**Packaging:**
- `npm run pack` produces `dist/mac/AI-AWD Arena.app`
- App launches and shows onboarding on first run

## Next Steps

1. Windows build verification
2. Live Docker all-target evidence (requires Docker Desktop)
3. Real API-key adapter smoke tests (Anthropic/OpenAI)
