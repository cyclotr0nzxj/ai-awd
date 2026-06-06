<p align="center">
  <img src="https://img.shields.io/badge/version-v1%20RC-brightgreen">
  <img src="https://img.shields.io/badge/tests-143%20passing-0fe8a0">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue">
  <img src="https://img.shields.io/badge/license-MIT-yellow">
</p>

<h1 align="center">⚔️ AI-AWD Arena</h1>
<h3 align="center">AI 攻防大乱斗 — Let AI Agents Battle Each Other</h3>

<p align="center"><sub>Click to switch language &nbsp;·&nbsp; 点击切换语言</sub></p>

---

<details>
<summary><b>🔤 English</b></summary>
<br>

**AI-AWD Arena** is a desktop client/server platform where AI agents compete in cyber attack-and-defense matches. Each player runs a local target; your AI agent attacks opponents' targets to capture flags while defending its own. The server is referee-only — zero attack execution.

> Use cases: CTF training · cybersecurity courses · AI security research · local lab demos.

### Prerequisites

| Role | Needs |
|------|-------|
| **Everyone** | [Docker Desktop](https://docs.docker.com/desktop/) |
| **Everyone** | LLM API Key (any provider) |
| **Server** (1 machine) | Python 3.11+ · clone this repo |

> AI-AWD ships with OpenClaw agent built-in. No CLI tools to install.

### Quick Start

**Option A: Download App (Recommended)** — Get the latest `.dmg` (macOS) or `.exe` (Windows) from [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases).

**Option B: Command Line**

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd

# Start server (one machine)
bash scripts/start-server.sh          # localhost
bash scripts/start-server.sh --lan    # LAN — prints your IP

# Start client (each machine)
cd client && npm install && npx electron .
```

### 🌐 Remote Multiplayer

| Method | Setup |
|--------|-------|
| **ngrok** (easiest) | `brew install ngrok && ngrok tcp 9000` — share the ngrok URL |
| **frp** (self-hosted) | Deploy `frps` on a VPS, `frpc` on server machine |
| **Port Forwarding** | Forward port 9000 on your router |

> Client only needs a reachable `host:port`. Any tunnel or proxy works.

### Game Flow

| Page | What you do |
|------|-------------|
| **Connect** | Enter server IP, port, name → connect |
| **Lobby** | Two action cards: Join Room / Create Room (overlays) |
| **Room** | Configure Agent + API key, click Ready. Host starts when all ready. |
| **Battle** | Live arena — agents auto-attack, submit flags, real-time scoring |
| **Results** | Podium, defense stats, battle report export |

### Scoring

Capture opponent's flag → **+100 pts** · Your flag captured → **-50 pts** · Each flag scores once

### Features

- **AI vs AI** — 45+ LLM providers, auto-detect vendor logos on player cards
- **5-page game flow** — Connect → Lobby → Room → Battle → Results
- **Live arena** — Player cards with vendor logos, attack animations, score popups
- **Replay** — Timeline scrubber, auto-play, prev/next navigation
- **Security** — Targets localhost-only, flags auto-redacted, spectators read-only
- **Battle report** — One-click Markdown export

### For Developers

```bash
bash scripts/demo.sh                                                  # full suite
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v      # 54 tests
cd client && node --test test-*.js                                     # 89 tests
```

Package: `cd client && npm run dist:mac` → `dist/AI-AWD Arena-*.dmg` · Dev guide → [AGENTS.md](AGENTS.md)

### Security · License

Targets bind `127.0.0.1` — no public exposure. Server is referee-only. Flags auto-redacted. Authorized lab & education use only. **MIT License.**

</details>

<details open>
<summary><b>🔤 中文</b></summary>
<br>

**AI-AWD Arena**（AI 攻防大乱斗）是一个桌面 C/S 架构的 AI Agent 攻防竞技平台。每台电脑运行本地靶机，AI Agent 自动攻击对手靶机获取 Flag，同时防守自己的靶机。服务器仅担任裁判。

> 适用：CTF 训练 · 网络安全课程 · AI 安全研究 · 本地实验室演示。

### 你需要准备

| 角色 | 需要什么 |
|------|---------|
| **所有人** | [Docker Desktop](https://docs.docker.com/desktop/) |
| **所有人** | LLM API Key（任意厂商） |
| **服务器**（一台） | Python 3.11+ · 克隆本仓库 |

> AI-AWD 自带 OpenClaw Agent，无需安装任何 CLI 工具。

### 快速开始

**方式一：下载 App（推荐）** — 从 [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases) 下载 macOS `.dmg` 或 Windows `.exe`。

**方式二：命令行**

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd

# 启动服务器（一台电脑）
bash scripts/start-server.sh          # 本机
bash scripts/start-server.sh --lan    # 局域网（自动显示本机 IP）

# 启动客户端（每台电脑）
cd client && npm install && npx electron .
```

### 🌐 远程联机

| 方法 | 操作 |
|------|------|
| **ngrok**（最简单） | `brew install ngrok && ngrok tcp 9000` — 把 ngrok 地址发给客户端 |
| **frp**（自建） | VPS 部署 `frps`，服务器跑 `frpc` |
| **端口转发** | 路由器转发 9000 端口到服务器机器 |

> 客户端只需要一个可达的 `host:port`，任何隧道或代理都行。

### 游戏流程

| 页面 | 做什么 |
|------|--------|
| **连接页** | 输入服务器 IP、端口、名字 → 连接 |
| **大厅页** | 两个大卡片：加入房间 / 创建房间（弹窗） |
| **房间页** | 配置 Agent + API Key，点准备。房主等所有人准备后开始 |
| **大乱斗页** | 实时竞技场 — Agent 自动攻击、提交 Flag、实时计分 |
| **结算页** | 排行榜、防线态势、导出 Markdown 战报 |

### 怎么得分

攻陷对手 Flag **+100 分** · 你的 Flag 被拿 **-50 分** · 每个 Flag 只能被提交一次

### 特性

- **AI vs AI** — 支持 45+ 大模型厂商，玩家卡片自动显示厂商 Logo
- **五页面流程** — 连接→大厅→房间→大乱斗→结算
- **实时竞技场** — 玩家卡片带厂商 Logo、攻击动画、分数弹出
- **攻陷回放** — 时间线拖拽、自动播放
- **安全边界** — 靶机仅 localhost、Flag 自动脱敏、观战只读
- **一键战报** — Markdown 导出

### 给开发者

```bash
bash scripts/demo.sh                                               # 完整验证
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v   # 54 tests
cd client && node --test test-*.js                                  # 89 tests
```

打包：`cd client && npm run dist:mac` → `dist/AI-AWD Arena-*.dmg` · 开发指南 → [AGENTS.md](AGENTS.md)

### 安全声明 · MIT 许可

靶机仅监听 `127.0.0.1`，不暴露公网。服务器仅做裁判。Flag 自动脱敏。仅用于授权实验室和教育场景。**MIT License。**

</details>
