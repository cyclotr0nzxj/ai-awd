# AI-AWD Arena — Developer Guide

This is the technical reference for AI coding agents and developers working on AI-AWD Arena. For user-facing documentation, see [README.md](README.md).

## Architecture

```
Electron App (client/)          Python Server (server/aiawd_server/)
┌──────────────────────┐       ┌──────────────────────────┐
│  renderer.js + UI    │       │  tcp_gateway.py           │
│  agentRuntime.js     │ TCP   │  room_manager.py          │
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

## Agent Adapters

8 adapters. **Direct API is the default** — no CLI tools required.

| Agent | Type | How it works |
|-------|------|-------------|
| **Direct API** | HTTP | `https.request` → OpenAI-compatible `/v1/chat/completions`. Uses user's API key, model name, and base URL. Guarantees token consumption with any provider (DeepSeek, OpenAI, etc.) |
| OpenClaw | CLI | `openclaw infer model run --local --json` — uses LLM_API_KEY env var |
| Hermes | CLI | `hermes -z <prompt> --yolo` |
| Codex | CLI | `codex exec --json <prompt>` |
| OpenCLI | CLI | `opencli browser extract` + `opencli browser open` |
| Pi | CLI | `pi --print --mode json` |
| CustomPython | Script | `python3 <script> {target_url}` |
| Mock | built-in | `echo FLAG{test}` — no real AI |

API keys are set as environment variables before agent execution:
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `LLM_API_KEY` — all set to the key entered in UI
- `OPENAI_BASE_URL` / `DEEPSEEK_BASE_URL` — set from user-provided Base URL field, or auto-detected for DeepSeek
- Direct API mode calls `{baseUrl}/v1/chat/completions` directly via Node.js `https.request` — no external CLI dependency
- Token usage is captured from response and displayed: `[prompt:N completion:M total:X]`

Agent execution triggers automatically:
- **DEFENSE phase**: `PHASE_SYNC` with phase "DEFENSE" — starts defense agent scanning own target
- **ATTACK phase**: `PHASE_SYNC` with phase "ATTACK" — starts attack agent probing opponents
- Command auto-populated from runtime dropdown via `buildAgentCommand(runtime, model, phase)`
- Agent activity broadcast to all room members via `AGENT_ACTIVITY` events
- Agent output parsed into natural-language steps via `parseActivitySteps()` (13 pattern categories)

Match flow is fully automated:
- **Auto-ready**: when API key + model + runtime are filled → `TARGET_READY` + `AGENT_READY`
- **Auto-start**: host sees all players ready → 1.5s delay → `START_MATCH`
- **Auto-target-lifecycle**: on `MATCH_CONFIG` receipt → install + start Docker targets
- **Auto-cleanup**: on `FINISHED` phase → stop agent

## Vendor Logo System

`renderer.js` maintains a `VENDOR_LOGOS` mapping (~45 vendors, 70+ keyword aliases) that resolves AI provider logos from model display names or agent runtime selections. Key functions:

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
- Python tests pass (54)
- `examples/three_clients_demo.py` produces readable transcript
- Protocol unit tests pass

**Electron/UI changes:**
- Node tests pass (89)
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
