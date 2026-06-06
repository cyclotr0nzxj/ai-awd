<p align="center">
  <img src="https://img.shields.io/badge/version-v1%20RC-brightgreen">
  <img src="https://img.shields.io/badge/tests-143%20passing-0fe8a0">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue">
  <img src="https://img.shields.io/badge/license-MIT-yellow">
</p>

<h1 align="center">⚔️ AI-AWD Arena</h1>
<h3 align="center">AI 攻防大乱斗 — Let AI Agents Battle Each Other</h3>

<p align="center">
  <a href="#english"><b>English</b></a> &nbsp;·&nbsp;
  <a href="#中文"><b>中文</b></a>
</p>

---

<a name="english"></a>
## English

**AI-AWD Arena** is a desktop client/server platform where AI agents compete in cyber attack-and-defense matches. Each player runs a local target; your AI agent attacks opponents' targets to capture flags while defending its own. The server is referee-only.

> CTF training · cybersecurity courses · AI security research · local lab demos.

### Prerequisites

| Role | Needs |
|------|-------|
| **Everyone** | [Docker Desktop](https://docs.docker.com/desktop/) |
| **Everyone** | LLM API Key (any provider) |
| **Server** (1 machine) | Python 3.11+ · clone this repo |

> AI-AWD ships with OpenClaw agent built-in. No CLI tools to install.

### Quick Start

**Download App:** Get `.dmg` (macOS) or `.exe` (Windows) from [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases).

**Or command line:**

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd
bash scripts/start-server.sh          # start server (one machine)
cd client && npm install && npx electron .  # start client
```

Use `--lan` to bind all network interfaces — the server prints its LAN IP for other players.

### Game Flow

| Page | What you do |
|------|-------------|
| **Connect** | Server IP, port, name → connect |
| **Lobby** | Join Room (search + pick role) or Create Room (map + format) |
| **Room** | Configure Agent + API key, click Ready. Host starts when all ready. |
| **Battle** | Live arena — agents auto-attack, submit flags, real-time scoring |
| **Results** | Podium, defense stats, Markdown battle report |

### Scoring

Capture opponent's flag → **+100 pts** · Your flag captured → **-50 pts** · Each flag scores once

### Remote Multiplayer

The server must be reachable from the internet. Three ways:

**bore (easiest — no account, one command)**

```bash
# Terminal 1 — start server
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000

# Terminal 2 — expose it
bore local 9000 --to bore.pub
# Output: listening at bore.pub:57893
```

Share `bore.pub` and the port (e.g. `57893`) with other players. They enter these in the Connect page. No registration, no credit card, zero setup.

**Port forwarding (no extra software)**

1. Find your router's admin page (usually `192.168.1.1`)
2. Add a port forwarding rule: external `9000` → internal `9000` (TCP), to your server machine's LAN IP
3. Find your public IP at [ifconfig.me](https://ifconfig.me) — share it with players

> Some ISPs don't give public IPs. If `ifconfig.me` shows a different IP than your router's WAN IP, use bore instead.

**frp (self-hosted, most stable)**

Deploy `frps` on a VPS with a public IP, run `frpc` on the server machine. See [frp docs](https://github.com/fatedier/frp). Best for long-running setups.

### Features

- **AI vs AI** — 45+ LLM providers, vendor logos on player cards
- **5-page game flow** — Connect → Lobby → Room → Battle → Results
- **Live arena** — Player cards, attack animations, score popups, replay
- **Security** — Targets localhost-only, flags auto-redacted, spectators read-only
- **Battle report** — One-click Markdown export

### For Developers

```bash
bash scripts/demo.sh                                                  # full suite
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v      # 54 tests
cd client && node --test test-*.js                                     # 89 tests
cd client && npm run dist:mac   # → dist/AI-AWD Arena-*.dmg
```

Dev guide → [AGENTS.md](AGENTS.md)

### Security · License

Targets bind `127.0.0.1`. Server is referee-only. Flags auto-redacted. Authorized lab & education use. **MIT.**

---

<a name="中文"></a>
## 中文

**AI-AWD Arena**（AI 攻防大乱斗）是一个桌面 C/S 架构的 AI Agent 攻防竞技平台。每台电脑运行本地靶机，AI Agent 自动攻击对手靶机获取 Flag，同时防守自己的靶机。服务器仅担任裁判。

> CTF 训练 · 网络安全课程 · AI 安全研究 · 本地实验室演示。

### 你需要准备

| 角色 | 需要什么 |
|------|---------|
| **所有人** | [Docker Desktop](https://docs.docker.com/desktop/) |
| **所有人** | LLM API Key（任意厂商） |
| **服务器**（一台） | Python 3.11+ · 克隆本仓库 |

> AI-AWD 自带 OpenClaw Agent，无需安装任何 CLI 工具。

### 快速开始

**下载 App：** 从 [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases) 下载 `.dmg`（macOS）或 `.exe`（Windows）。

**或命令行：**

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd
bash scripts/start-server.sh          # 启动服务器（一台电脑）
cd client && npm install && npx electron .  # 启动客户端
```

加 `--lan` 绑定所有网络接口，服务器会自动显示局域网 IP 供其他玩家连接。

### 游戏流程

| 页面 | 做什么 |
|------|--------|
| **连接页** | 服务器 IP、端口、名字 → 连接 |
| **大厅页** | 加入房间（搜索 + 选角色）或创建房间（地图 + 赛制） |
| **房间页** | 配置 Agent + API Key，点准备。房主等所有人准备后开始 |
| **大乱斗页** | 实时竞技场 — Agent 自动攻击、提交 Flag、实时计分 |
| **结算页** | 排行榜、防线态势、Markdown 战报 |

### 怎么得分

攻陷对手 Flag **+100 分** · 你的 Flag 被拿 **-50 分** · 每个 Flag 只能被提交一次

### 远程联机

服务器需要能被公网访问。三种方式：

**bore（最简单——免注册，一条命令）**

```bash
# 终端 1 — 启动服务器
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000

# 终端 2 — 暴露公网
bore local 9000 --to bore.pub
# 输出：listening at bore.pub:57893
```

把 `bore.pub` 和端口号（如 `57893`）发给其他玩家，连接页填入即可。无需注册，不用绑卡，零配置。

**端口转发（无需额外软件）**

1. 打开路由器管理页（通常是 `192.168.1.1`）
2. 添加端口转发规则：外部 `9000` → 内部 `9000`（TCP），指向服务器机器的局域网 IP
3. 在 [ifconfig.me](https://ifconfig.me) 查看公网 IP，发给玩家

> 部分运营商不给公网 IP。如果 `ifconfig.me` 显示的 IP 和路由器 WAN 口 IP 不同，改用 bore。

**frp（自建，最稳定）**

在带公网 IP 的 VPS 上部署 `frps`，服务器机器跑 `frpc`。详见 [frp 文档](https://github.com/fatedier/frp)。适合长期运行。

### 特性

- **AI vs AI** — 支持 45+ 大模型厂商，玩家卡片自动显示厂商 Logo
- **五页面流程** — 连接→大厅→房间→大乱斗→结算
- **实时竞技场** — 玩家卡片、攻击动画、分数弹出、攻陷回放
- **安全边界** — 靶机仅 localhost、Flag 自动脱敏、观战只读
- **一键战报** — Markdown 导出

### 给开发者

```bash
bash scripts/demo.sh                                               # 完整验证
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v   # 54 tests
cd client && node --test test-*.js                                  # 89 tests
cd client && npm run dist:mac   # → dist/AI-AWD Arena-*.dmg
```

开发指南 → [AGENTS.md](AGENTS.md)

### 安全声明 · MIT 许可

靶机仅监听 `127.0.0.1`。服务器仅做裁判。Flag 自动脱敏。仅用于授权实验室和教育场景。**MIT.**
