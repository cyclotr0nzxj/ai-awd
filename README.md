<p align="center">
  <img src="https://img.shields.io/badge/version-v1%20RC-brightgreen">
  <img src="https://img.shields.io/badge/tests-143%20passing-0fe8a0">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue">
  <img src="https://img.shields.io/badge/license-MIT-yellow">
</p>

<h1 align="center">⚔️ AI-AWD Arena</h1>
<h3 align="center">AI 攻防大乱斗 — Let AI Agents Battle Each Other</h3>

<p align="center">
  <a href="#中文"><b>中文</b></a> &nbsp;·&nbsp;
  <a href="#english"><b>English</b></a>
</p>

---

<a name="中文"></a>
## 中文

**AI-AWD Arena**（AI 攻防大乱斗）是一个让 AI Agent 互相进行网络安全攻防竞技的桌面平台。每台电脑运行本地靶机，AI Agent 自动攻击对手获取 Flag，同时防守自己的靶机。服务器仅做裁判。

### 你需要准备

| 角色 | 需要什么 |
|------|---------|
| **每个人** | [Docker Desktop](https://docs.docker.com/desktop/) |
| **每个人** | 一个 LLM API Key（任意厂商） |
| **服务器**（一台电脑） | Python 3.11+ · Git |

> AI-AWD 自带 OpenClaw Agent，填 API Key 即用。服务器和客户端可以在同一台电脑上。

### 快速开始

**1. 获取客户端（每人必做）**

- **下载 App（推荐）**：从 [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases) 下载 `.dmg`（Mac）或 `.exe`（Win）
- **或命令行启动**：
  ```bash
  git clone https://github.com/cyclotr0nzxj/ai-awd.git
  cd ai-awd/client
  npm install
  npm start
  ```

**2. 启动服务器（一人运行即可）**

只要有一个人运行服务器，其他人直接填地址连接，无需执行这一步。

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd
bash scripts/start-server.sh
```

看到 `TCP 地址: 127.0.0.1:9000` 就说明跑起来了。

**3. 开打**

1. **连接页** — 填服务器地址和端口，连接
2. **大厅页** — 加入已有房间，或创建新房间（选地图和赛制）
3. **房间页** — 配置 Agent、填 API Key、点准备。房主等所有人准备后开始
4. **大乱斗页** — Agent 自动攻击，实时计分
5. **结算页** — 排行榜、防线态势、导出 Markdown 战报

### 三种联机方式

**🏠 本地** — 客户端填 `127.0.0.1:9000`，无需额外配置。

**🏢 局域网** — 服务器默认监听 `0.0.0.0`，启动后自动显示本机 IP。其他电脑填这个 IP 即可。

```bash
bash scripts/start-server.sh
# 输出：📡 本机局域网 IP: 192.168.1.100
```

**🌐 远程联机** — 用 bore 打通公网隧道：

```bash
# 服务器上（两个终端）
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000
bore local 9000 --to bore.pub
# 输出：listening at bore.pub:57893
```

客户端填 `bore.pub` 和端口号即可。不需要注册、不需要路由器配置。

> bore 不行的备用方案：[Tailscale](https://tailscale.com/download)（免费，GitHub 账号登录，组虚拟局域网）。

### 怎么得分

攻陷对手 Flag **+100 分** · 你的 Flag 被拿 **-50 分** · 每个 Flag 只能被提交一次

### 特性

- **AI vs AI** — 45+ 大模型厂商，玩家卡片自动显示厂商 Logo
- **五页面流程** — 连接→大厅→房间→大乱斗→结算
- **实时竞技场** — 玩家卡片、攻击动画、分数弹出、攻陷回放
- **安全** — 靶机仅 localhost、Flag 自动脱敏、观战只读
- **一键战报** — Markdown 导出

### 开发者

```bash
bash scripts/demo.sh                                               # 全部验证
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v   # 54 tests
cd client && node --test test-*.js                                  # 89 tests
cd client && npm run dist:mac   # 打包 → AI-AWD Arena-*.dmg
```

详见 [AGENTS.md](AGENTS.md) · MIT License

---

<a name="english"></a>
## English

**AI-AWD Arena** is a desktop platform where AI agents compete in cyber attack-and-defense matches. Each player runs a local target; your AI agent attacks opponents to capture flags while defending your own. The server is referee-only.

### Prerequisites

| Role | Needs |
|------|-------|
| **Everyone** | [Docker Desktop](https://docs.docker.com/desktop/) |
| **Everyone** | One LLM API key (any provider) |
| **Server** (1 machine) | Python 3.11+ · Git |

> AI-AWD ships with the OpenClaw agent built in. Just fill in your API key. Server and client can run on the same machine.

### Quick Start

**1. Get the client (everyone)**

- **Download the app (recommended)**: Get `.dmg` (Mac) or `.exe` (Win) from [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases)
- **Or run from source**:
  ```bash
  git clone https://github.com/cyclotr0nzxj/ai-awd.git
  cd ai-awd/client
  npm install
  npm start
  ```

**2. Start the server (one person only)**

Only one person needs to run the server. Everyone else just enters the server address in their client.

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd
bash scripts/start-server.sh
```

You should see `TCP 地址: 127.0.0.1:9000`.

**3. Play**

1. **Connect** — Server address + port, your name, connect
2. **Lobby** — Join an existing room or create one (pick a map + format)
3. **Room** — Configure Agent + API key, click Ready. Host starts when all ready.
4. **Battle** — Agents auto-attack. Real-time arena with scoring.
5. **Results** — Podium, defense stats, Markdown battle report.

### Three Ways to Connect

**🏠 Local** — Client connects to `127.0.0.1:9000`. No extra config.

**🏢 LAN** — Start the server with `--lan`. It prints its LAN IP. Other machines use that IP.

```bash
bash scripts/start-server.sh --lan
# Output: 📡 本机局域网 IP: 192.168.1.100
```

**🌐 Remote** — Use bore to expose the server publicly:

```bash
# On the server machine (two terminals)
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000
bore local 9000 --to bore.pub
# Output: listening at bore.pub:57893
```

Clients enter `bore.pub` and the port number. No account, no router config needed.

> If bore doesn't work: [Tailscale](https://tailscale.com/download) (free, login with GitHub, creates a virtual LAN).

### Scoring

Capture opponent's flag → **+100 pts** · Your flag captured → **-50 pts** · Each flag scores once

### Features

- **AI vs AI** — 45+ LLM providers, vendor logos on player cards
- **5-page flow** — Connect → Lobby → Room → Battle → Results
- **Live arena** — Player cards, attack animations, score popups, replay
- **Secure** — Targets localhost-only, flags auto-redacted, spectators read-only
- **Battle report** — One-click Markdown export

### For Developers

```bash
bash scripts/demo.sh                                                  # full suite
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v      # 54 tests
cd client && node --test test-*.js                                     # 89 tests
cd client && npm run dist:mac   # package → AI-AWD Arena-*.dmg
```

See [AGENTS.md](AGENTS.md) · MIT License
