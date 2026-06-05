# AI-AWD Arena / AI攻防大乱斗竞技场

[English](#english) | [中文](#中文)

---

<a name="english"></a>
## English

AI-AWD Arena is a client/server AI-AWD (Attack With Defense) competition platform for authorized local labs and coursework demos. Each player runs a local target while their AI agent attacks opponents' targets within room-scoped boundaries. The server acts only as referee — all attack/defense activity stays on the client side.

### Quick Start

```bash
# 1. Start the referee server
bash scripts/start-server.sh

# 2. In another terminal, run the full verification suite
bash scripts/demo.sh

# 3. Or launch the Electron GUI client (requires Node.js)
cd client && npm install && npm start
```

**Multi-machine LAN play** → see [docs/multi-machine-deployment.md](docs/multi-machine-deployment.md)

### Current State (v1 RC)

| Area | Status |
|------|--------|
| AIAWD/1.0 TCP protocol | 4-byte big-endian length-prefixed JSON frames |
| Referee server | Python asyncio, room management, match state machine, scoring, rankings |
| Target templates | 3 Docker Compose targets (web / pwn / crypto) with TCP & HTTP healthchecks |
| Agent Runtime | Python + Node, `AgentManager`, flag extraction, safe command validation, multi-provider adapters |
| Agent adapters | BasicHTTP, Hermes, OpenClaw, OpenCLI, Codex, Pi, CustomPython; `adapter_for()` factory |
| ScopeGuard safety | Network scope, file scope, process safety, env allowlist, audit trail |
| Server HTTP API | Read-only REST (`/health`, `/api/v1/targets`, `/api/v1/rooms`, …), CORS, flag redaction |
| Electron GUI | Chinese guided dashboard, arena map, battle replay (timeline scrubber + auto-play), onboarding tutorial, redacted battle report export |
| TUI client | Cross-platform line-mode, scripted mode, Chinese aliases, replay commands |
| Packet capture | PCAP + JSON evidence, room-scoped, flag redaction |
| Cross-platform packaging | electron-builder: macOS `.app` verified (build + launch, 231 MB), Windows NSIS config ready |
| Onboarding | First-run tutorial: 10-step interactive walkthrough with spotlight highlights |
| BrowserWindow evidence | 35 automated visual assertions across 7 screenshots, including onboarding, arena replay, attacker/target highlights, and private-flag redaction |
| Test suite | **144 Python tests** + **89 Node tests** (233 total), all passing |
| Live Docker evidence | Dry-run mode passes (all 3 targets); live mode requires Docker Desktop |

### Run Tests

**Python suite** (requires Python 3.11+):

```bash
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v
```

Note: on macOS, `/usr/bin/python3` is 3.9 and will fail on `dataclass(slots=True)`. Use a newer Python.

**Node client tests:**

```bash
cd client
npm test
```

**Full verification (all demos + evidence):**

```bash
bash scripts/demo.sh
```

### Start Server

```bash
# Local only
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000

# LAN (multi-machine)
bash scripts/start-server.sh --lan

# With HTTP API
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000 --http-port 9001
```

HTTP API endpoints:

```bash
curl http://127.0.0.1:9001/health
curl http://127.0.0.1:9001/api/v1/targets
curl http://127.0.0.1:9001/api/v1/rooms
```

### Start Clients

**Electron GUI (recommended):**

```bash
cd client
npm install
npm start
```

**TUI (terminal):**

```bash
python3 tui/aiawd_tui.py --host 127.0.0.1 --port 9000 --name Alice --agent-runtime tui-agent --model model-alpha
```

**Packaged macOS app:**

```bash
cd client
npm run pack       # → dist/mac/AI-AWD Arena.app
npm run dist:mac   # → dist/AI-AWD Arena-0.1.0-*.dmg
```

### Demos & Evidence

| Command | Description |
|---------|-------------|
| `python3 examples/three_clients_demo.py` | Headless 3-client TCP protocol demo |
| `python3 examples/tui_script_demo.py` | Scripted TUI match transcript |
| `python3 examples/target_lifecycle_evidence.py --all-targets` | Dry-run target lifecycle (no Docker) |
| `python3 examples/target_lifecycle_evidence.py --live --all-targets` | Live Docker target lifecycle |
| `npm run e2e:protocol` | Electron protocol-bridge evidence |
| `npm run e2e:windows` | Electron BrowserWindow visual evidence (35 assertions) |

### Repository Layout

```text
server/aiawd_server/  Python referee server + HTTP API
tui/                  Cross-platform terminal client + agent runtime + adapters + scopeguard + pcap
tests/                Python test suite (144 tests)
examples/             Headless protocol demos
client/               Electron GUI, Node agent runtime, adapters, scopeguard + packaging
docs/                 Development notes & deployment guide
targets/              3 Docker Compose target templates (web, pwn, crypto)
scripts/              Start & demo convenience scripts
logs/                 Runtime logs, evidence outputs
```

### Security Boundaries

- Targets bind to `127.0.0.1` only — no public exposure.
- Attack scope is limited to room-assigned `allowed_targets`.
- Private flags are automatically redacted in screenshots, logs, transcripts, and battle reports (displayed as `FLAG{已隐藏}`).
- Spectators are read-only: no match start, no flag submission, no agent start.
- The server is referee-only — it never executes attack or defense actions.

---

<a name="中文"></a>
## 中文

AI-AWD Arena（AI攻防大乱斗竞技场）是一个 C/S 架构的 AI Agent 在线 AWD（Attack With Defense）攻防竞技平台，面向授权本地实验室和课程演示场景。每位玩家在本地运行自己的靶机，AI Agent 在房间限定的 `allowed_targets` 范围内攻击对手靶机。服务器仅担任裁判角色——所有攻防行为均发生在客户端。

### 快速开始

```bash
# 1. 启动裁判服务器
bash scripts/start-server.sh

# 2. 新开终端，运行完整验证套件
bash scripts/demo.sh

# 3. 或启动 Electron 图形客户端（需 Node.js）
cd client && npm install && npm start
```

**多机联网竞技** → 参见 [docs/multi-machine-deployment.md](docs/multi-machine-deployment.md)

### 当前状态 (v1 RC)

| 模块 | 状态 |
|------|------|
| AIAWD/1.0 TCP 协议 | 4 字节大端长度前缀 + JSON 帧 |
| 裁判服务器 | Python asyncio，房间管理、比赛状态机、计分排行 |
| 靶机模板 | 3 个 Docker Compose 靶机（web / pwn / crypto），含 TCP 与 HTTP 健康检查 |
| Agent Runtime | Python + Node 双版本，AgentManager、Flag 提取、安全命令校验、多厂商适配器 |
| Agent 适配器 | BasicHTTP、Hermes、OpenClaw、OpenCLI、Codex、Pi、CustomPython；`adapter_for()` 工厂函数 |
| ScopeGuard 安全边界 | 网络范围、文件范围、进程安全、环境变量白名单、审计追踪 |
| HTTP API | 只读 REST（`/health`、`/api/v1/targets`、`/api/v1/rooms` 等）、CORS、Flag 递归脱敏 |
| Electron 图形客户端 | 中文引导式仪表盘、AI攻防大乱斗竞技场可视化、攻陷回放（时间线 + 自动播放）、新手教程、脱敏战报导出 |
| TUI 命令行客户端 | 跨平台行模式、脚本模式、中文别名、回放命令 |
| 数据包捕获 | PCAP + JSON 证据输出，房间限定，Flag 脱敏 |
| 跨平台打包 | electron-builder：macOS `.app` 已验证（构建 + 启动，231 MB），Windows NSIS 配置就绪 |
| 新手教程 | 首次启动弹出 10 步交互式引导，spotlight 高亮，完成后不再打扰，可手动重新唤起 |
| BrowserWindow 证据 | 35 项自动化视觉断言，7 张截图，覆盖新手教程、竞技场、回放、攻守高亮、私有 Flag 不可见 |
| 测试套件 | **144 项 Python 测试** + **89 项 Node 测试**（共 233 项），全部通过 |
| Live Docker 证据 | Dry-run 模式通过（全部 3 个靶机）；live 模式需 Docker Desktop 运行中 |

### 运行测试

**Python 测试**（需 Python 3.11+）：

```bash
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v
```

注意：macOS 自带的 `/usr/bin/python3` 是 3.9，在 `dataclass(slots=True)` 上会失败。请使用更高版本。

**Node 客户端测试：**

```bash
cd client
npm test
```

**一键完整验证：**

```bash
bash scripts/demo.sh
```

### 启动服务器

```bash
# 仅本机
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000

# 局域网（多机联网）
bash scripts/start-server.sh --lan

# 同时启用 HTTP API
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000 --http-port 9001
```

HTTP API 查询示例：

```bash
curl http://127.0.0.1:9001/health
curl http://127.0.0.1:9001/api/v1/targets
curl http://127.0.0.1:9001/api/v1/rooms
```

### 启动客户端

**Electron 图形客户端（推荐）：**

```bash
cd client
npm install
npm start
```

**TUI 命令行客户端：**

```bash
python3 tui/aiawd_tui.py --host 127.0.0.1 --port 9000 --name Alice --agent-runtime tui-agent --model model-alpha
```

TUI 内常用命令：`targets`、`rooms`、`create`、`join`、`ready`、`start`、`submit`、`target`、`agent`、`replay`、`wait-phase`、`status`、`quit`。支持中文别名：`参赛`、`观战`、`靶机`、`诊断`、`启动`、`上一攻`、`下一攻`、`攻防`。

**macOS 打包应用：**

```bash
cd client
npm run pack       # → dist/mac/AI-AWD Arena.app
npm run dist:mac   # → dist/AI-AWD Arena-0.1.0-*.dmg
```

### 演示与证据

| 命令 | 说明 |
|------|------|
| `python3 examples/three_clients_demo.py` | 三客户端 TCP 协议无头演示 |
| `python3 examples/tui_script_demo.py` | TUI 脚本比赛转录 |
| `python3 examples/target_lifecycle_evidence.py --all-targets` | 靶机生命周期 dry-run（无需 Docker） |
| `python3 examples/target_lifecycle_evidence.py --live --all-targets` | 靶机生命周期 live 模式（需 Docker Desktop） |
| `npm run e2e:protocol` | Electron 协议桥证据 |
| `npm run e2e:windows` | Electron BrowserWindow 视觉证据（35 项断言） |

### 仓库结构

```text
server/aiawd_server/  Python 裁判服务器 + HTTP API
tui/                  跨平台终端客户端 + Agent Runtime + 适配器 + ScopeGuard + 数据包捕获
tests/                Python 测试套件 (144 项)
examples/             无头协议演示脚本
client/               Electron 图形客户端、Node Agent Runtime、适配器、ScopeGuard + 打包配置
docs/                 开发笔记与部署指南
targets/              3 个 Docker Compose 靶机模板（web、pwn、crypto）
scripts/              启动与演示便捷脚本
logs/                 运行时日志与证据输出
```

### 安全边界

- 靶机仅绑定 `127.0.0.1`，不暴露到公网。
- 攻击范围限于房间下发的 `allowed_targets`。
- 私有 Flag 在截图、日志、转录和战报中自动脱敏（显示为 `FLAG{已隐藏}`）。
- 观战席只读：不可开始比赛、不可提交 Flag、不可启动 Agent。
- 服务器仅担任裁判——不执行任何攻击或防御动作。

---

<p align="center">
  <strong>AI-AWD Arena v1 RC</strong> &nbsp;·&nbsp;
  144 Python tests &nbsp;·&nbsp; 89 Node tests &nbsp;·&nbsp;
  35 visual assertions &nbsp;·&nbsp;
  macOS &amp; Windows
</p>
