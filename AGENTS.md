# AI-AWD Arena — Developer Guide

This is the technical reference for AI coding agents and developers working on AI-AWD Arena. For user-facing documentation, see [README.md](README.md).

## Architecture

```
Electron App (client/)          Python Server (server/aiawd_server/)
┌──────────────────────┐       ┌──────────────────────────┐
│  renderer.js + UI    │       │  tcp_gateway.py           │
│  agentRuntime.js     │ TCP   │  room_manager.py          │
│  adapters.js         │AIAWD  │  match_engine.py          │
│  providerDetect.js   │/1.0   │  session_manager.py       │
│  scopeguard.js       │       │  target_registry.py       │
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

# Start server (default binds 0.0.0.0 for LAN multiplayer)
PYTHONPATH=server python3 -m aiawd_server.main --port 9000

# Start server (localhost only — single-machine testing)
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000

# Start server with HTTP API (default 0.0.0.0:9000 + HTTP :9001)
PYTHONPATH=server python3 -m aiawd_server.main --port 9000 --http-port 9001

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

Key message types: `HELLO`/`WELCOME`, `CREATE_ROOM_REQ`/`RES`, `JOIN_ROOM_REQ`/`RES`, `START_MATCH_REQ`/`RES`, `MATCH_CONFIG`, `PHASE_SYNC`, `SUBMIT_FLAG_REQ`/`RES`, `RANKING_UPDATE`, `EVENT`, `ROOM_UPDATE`, `LIST_ROOMS_REQ`/`RES`, `LIST_TARGETS_REQ`/`RES`, `AGENT_ACTIVITY`, `ERROR`.

All messages include: `v`, `seq`, `type`, `client_id`, `room_id`, `role`, `ts`, `payload`.

`client_id + seq` is treated as idempotent for side-effecting requests.

## Phase State Machine

```
LOBBY → PREPARE → DEFENSE → ATTACK → FINISHED
```

- `SUBMIT_FLAG_REQ` valid only in ATTACK.
- One flag scores only once globally per room.
- Spectators are read-only throughout.

## Agent Runtime

**OpenClaw is the default.** Auto-installed via npm during `npm install` (GitHub release fallback for macOS, npm global/local for Windows). `openclawPath()` in `adapters.js` has a 6-tier resolution chain: PATH → npm local → npm global → Homebrew/macOS paths → bundled bin → fallback.

| Runtime | How it works |
|---------|-------------|
| **OpenClaw (内置)** | `openclawPath()` resolves best available binary. `npm install -g openclaw` as Windows fallback. |
| Hermes | `hermes -z <prompt> --yolo` (if installed) |
| Mock | `echo` — no real AI, for UI testing |

### API Configuration
OpenClaw provider auto-configured on first agent start:
- Writes provider to `~/.openclaw/openclaw.json` matching OpenClaw's native format
- `baseUrl` from user's Base URL field (default `https://api.deepseek.com`)
- `apiKey` from user's API Key field
- Command: `openclaw infer model run --local --json --prompt "..." --model deepseek/deepseek-chat`

### Docker Auto-Start
Docker Desktop auto-launched if daemon not running (macOS: `open -a Docker`, Windows: `start Docker Desktop.exe`), waits up to 30s.

### Auto-Match Flow
- **Auto-ready**: API key + model + runtime filled → `TARGET_READY` + `AGENT_READY`
- **Auto-start**: host sees all ready → `START_MATCH`
- **Auto-target-lifecycle**: `MATCH_CONFIG` → install + start Docker targets (Docker auto-launched if needed)
- **Auto-DEFENSE agent**: `PHASE_SYNC` DEFENSE → continuous defense loop (3s interval)
- **Auto-ATTACK agent**: `PHASE_SYNC` ATTACK → continuous attack loop (3s interval)
- **Auto-cleanup**: `PHASE_SYNC` FINISHED → stop agent loop

### Agent Activity
- Per-player columns with color-coded status borders
- Natural-language step descriptions via `parseActivitySteps()`
- Broadcast to all room members via `AGENT_ACTIVITY` events
- Status badges (agent + target) in activity feed header — green/amber/red states

### Battle Page
- No manual start/stop buttons — agent runs continuously in ATTACK and DEFENSE phases
- Command built automatically per phase with appropriate attack/defense prompt
- OpenClawAdapter uses `openclawPath()` for binary resolution

## Vendor Logo System

`providerDetect.js` is the canonical source for provider detection and vendor logo mapping (~45 vendors, 70+ keyword aliases). It's loaded as a `<script>` tag for the renderer and `require()`d by the main process. Key functions:

- `providerLogo(player)` — returns the logo asset path for a player based on `model_display_name`, `agent_runtime`, or `api_provider` (detected from API key + model name)
- `detectProvider(apiKey, modelName)` — identifies AI vendor from API key prefix + model name heuristics (19+ vendors)
- `runtimeDisplayName(runtime)` — maps agent runtime IDs to human-readable display names
- `VENDOR_LOGOS_ENTRIES` — pre-sorted entries (longest match first) for correct substring matching
- `client/assets/vendors/` — 45 PNG icons (640×640) from LobeHub CDN

Supported vendors include Anthropic, OpenAI, Google, Meta, Mistral, Nvidia, Cohere, Grok/xAI, Perplexity, Groq, Together, HuggingFace, Ollama, DeepSeek, Qwen, Baichuan, Hunyuan, Spark, Wenxin, Yi, StepFun, Skywork, Kimi, Doubao, Zhipu, MiniMax, InternLM, CodeGeeX, Yuanbao, and more.

## Safety Boundary (ScopeGuard)

- Network targets → `allowed_targets` only, localhost-only
- File paths → must resolve within project root
- Process safety → `sanitize_command()` blocks shell metacharacters (`;`, `|`, `&`, `` ` ``)
- Environment → allowlisted vars only
- Audit trail → every guard call logged

## Design System

Immersive Dark. Deep navy (#020617 void, #0f172a surface) with vibrant green accent (#22c55e). Inter for headings/body, JetBrains Mono for data/code. Rounded corners (8/12/16px). No gradients. No backdrop-filter. Page transitions: quick fade-in (0.25s). Blink cursor for running status. Agent activity feed: per-player columns with colored status borders. Dark-exclusive — immersive competitive gaming aesthetic.

## Coding Rules

- Python server: stdlib only. Tests use `unittest`.
- Electron renderer: no direct TCP. All server communication through `window.aiawd` (preload API).
- Flag redaction: never log API keys or flag plaintext. `MATCH_CONFIG.flag` always redacted in UI/logs/screenshots.
- Language: `AI攻防大乱斗`, `攻陷`, `失守`, `防线完整`. Do not use `大逃杀`, `击杀`, `生存态势`.

## Verification Gates

**Server/protocol changes:**
- Python tests pass (22)
- `examples/three_clients_demo.py` produces readable transcript
- Protocol unit tests pass

**Electron/UI changes:**
- Node tests pass (80 / 3 known failures)
- `client/test-renderer.js` covers arena, replay, battle kit, flag redaction, vendor logo resolution
- Main process owns AIAWD TCP; renderer uses `window.aiawd`
- `npx electron electronWindowEvidence.js` produces 35 passing assertions
- New vendor logos: `client/assets/vendors/*.png` — 45 icons, check `providerLogo()` + `runtimeDisplayName()` in renderer.js

**Packaging:**
- `npm run pack` produces `dist/mac/AI-AWD Arena.app`
- App launches and shows lobby page directly

## Current Release Status

- **v1.0.0 published** on [GitHub Releases](https://github.com/cyclotr0nzxj/ai-awd/releases)
- macOS `.dmg` + `.zip` (x64 + arm64): built and uploaded
- Windows `.exe` — NSIS installer + portable (x64): built and uploaded
- GitHub Actions CI: auto-build on `v*` tag push + manual `workflow_dispatch`
- `.icns` (macOS) + `.ico` (Windows) icons in `client/build/`

## Next Steps

1. Live Docker all-target evidence (requires Docker Desktop running)
2. Real-CLI agent smoke tests (Hermes/Codex/OpenClaw with live Docker targets)
3. Code signing for macOS and Windows
