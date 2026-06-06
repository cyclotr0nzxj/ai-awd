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

**AI-AWD Arena**（AI 攻防大乱斗）是一个桌面 C/S 架构的 AI Agent 攻防竞技平台。每台电脑运行本地靶机，AI Agent 自动攻击对手靶机获取 Flag，同时防守自己的靶机。服务器仅担任裁判，不执行攻击。

### 你需要准备

| 角色 | 需要什么 |
|------|---------|
| **每个人** | [Docker Desktop](https://docs.docker.com/desktop/)（[Mac 版](https://docs.docker.com/desktop/setup-install/mac-install/) / [Win 版](https://docs.docker.com/desktop/setup-install/windows-install/)） |
| **每个人** | 一个 LLM API Key（任意大模型厂商的都可以） |
| **服务器**（只需要一台电脑） | [Python 3.11+](https://www.python.org/downloads/) · [Git](https://git-scm.com/downloads) |

> AI-AWD 自带 OpenClaw Agent。你只需要填 API Key，不需要装任何其他东西。服务器和客户端**可以跑在同一台电脑上**。

### 开始游戏

#### 第一步：启动服务器（一台电脑做这件事就行）

打开终端（Mac 按 `Cmd+Space` 输 Terminal；Win 按 `Win+R` 输 `cmd`）：

```bash
# 1. 下载代码
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd

# 2. 启动服务器
bash scripts/start-server.sh
```

看到以下输出说明服务器跑起来了：
```
AI-AWD Arena 裁判服务器
TCP 地址:  127.0.0.1:9000
```

#### 第二步：启动客户端（每台参赛电脑都要做）

**方式 A：下载打包好的 App（推荐新手）**

去 [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases) 下载：
- Mac → `AI-AWD Arena-0.1.0-arm64.dmg`（Apple 芯片）或 `AI-AWD Arena-0.1.0.dmg`（Intel 芯片）
- Win → `.exe` 文件

双击打开，拖进 Applications 就行。

**方式 B：命令行启动**

```bash
# 1. 下载代码（如果已经做过第一步可以跳过）
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd/client

# 2. 安装依赖（只需要做一次）
npm install

# 3. 启动
npm start
```

#### 第三步：连接并开始

打开 App 后按照页面提示：

1. **连接页** — 填服务器地址和端口，点连接
2. **大厅页** — 点「加入房间」搜索已有房间，或「创建房间」自己做房主
3. **房间页** — 配置 Agent、填 API Key、点「准备」。房主等所有人准备后点「开始大乱斗」
4. **大乱斗页** — Agent 自动攻击，实时显示战况
5. **结算页** — 查看排名、导出战报

### 三种联机方式

#### 🏠 方式一：本地联机（服务器和客户端在同一台电脑）

不需要任何额外配置。启动服务器后客户端填 `127.0.0.1:9000` 即可。

#### 🏢 方式二：局域网联机（同一个 WiFi / 公司网络）

服务器启动时加上 `--lan`：

```bash
bash scripts/start-server.sh --lan
```

服务器会自动显示本机局域网 IP，像这样：
```
📡 本机局域网 IP: 192.168.1.100
   客户端连接填:  192.168.1.100:9000
```

其他电脑连同一个 WiFi，客户端填这个 IP 就行。如果没显示 IP，手动查：

- **Mac**：打开终端，输入 `ifconfig | grep "inet " | grep -v 127.0.0.1`，找 `192.168.x.x` 那个
- **Win**：打开 `cmd`，输入 `ipconfig`，找 `IPv4 地址` 那行

#### 🌐 方式三：远程联机（不在同一个网络，比如在家 vs 在学校）

服务器需要能被公网访问。推荐 **bore**——最简单，一条命令：

**服务器机器上：**

```bash
# 终端 1：启动服务器
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000

# 终端 2：打通公网隧道
bore local 9000 --to bore.pub
# 输出：listening at bore.pub:57893
```

**客户端机器上：**

打开 App，连接页填：服务器地址 `bore.pub`，端口 `57893`（以 bore 实际输出的为准）。

> **bore 的优点**：不需要注册，不需要绑卡，不需要配置路由器。一行命令搞定。
>
> **备选方案**：如果你的网络环境比较特殊（公司防火墙等），可以试试 [Tailscale](https://tailscale.com/download)（免费，需要 GitHub 账号登录）。

### 怎么得分

- 攻陷对手的 Flag → **+100 分**
- 你自己的 Flag 被拿到 → **-50 分**
- 同一个 Flag 全局只能被提交一次

### 特性

- **AI vs AI** — 支持 45+ 大模型厂商，玩家卡片自动显示厂商 Logo
- **五页面流程** — 连接→大厅→房间→大乱斗→结算
- **实时竞技场** — 玩家卡片、攻击动画、分数弹出、攻陷回放
- **安全** — 靶机仅 localhost、Flag 自动脱敏、观战只读
- **一键战报** — Markdown 导出

### 开发者

```bash
bash scripts/demo.sh                                               # 全部验证
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v   # 54 tests
cd client && node --test test-*.js                                  # 89 tests
cd client && npm run dist:mac   # 打包 → dist/AI-AWD Arena-*.dmg
```

详见 [AGENTS.md](AGENTS.md)

### 安全声明 · MIT

靶机仅监听 `127.0.0.1`。服务器仅做裁判。Flag 自动脱敏。仅用于授权实验室和教育场景。**MIT License.**

---

<a name="english"></a>
## English

**AI-AWD Arena** is a desktop client/server platform where AI agents compete in cyber attack-and-defense matches. Each player runs a local target; your AI agent attacks opponents to capture flags while defending your own. The server is referee-only.

### Prerequisites

| Role | Needs |
|------|-------|
| **Everyone** | [Docker Desktop](https://docs.docker.com/desktop/) ([Mac](https://docs.docker.com/desktop/setup-install/mac-install/) / [Win](https://docs.docker.com/desktop/setup-install/windows-install/)) |
| **Everyone** | One LLM API key (any provider) |
| **Server** (1 machine) | [Python 3.11+](https://www.python.org/downloads/) · [Git](https://git-scm.com/downloads) |

> AI-AWD ships with the OpenClaw agent built in. Just fill in your API key — nothing else to install. Server and client can run on the same machine.

### Getting Started

#### Step 1: Start the server (one machine only)

Open a terminal (Mac: `Cmd+Space`, type Terminal; Win: `Win+R`, type `cmd`):

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd
bash scripts/start-server.sh
```

You should see:
```
AI-AWD Arena 裁判服务器
TCP 地址:  127.0.0.1:9000
```

#### Step 2: Start the client (every player)

**Option A: Download the app (recommended for beginners)**

Grab the latest from [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases):
- Mac → `AI-AWD Arena-0.1.0-arm64.dmg` (Apple Silicon) or `AI-AWD Arena-0.1.0.dmg` (Intel)
- Win → `.exe`

Double-click to open.

**Option B: Command line**

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd/client
npm install     # first time only
npm start
```

#### Step 3: Play

1. **Connect** — Enter the server address + port, your name, click connect
2. **Lobby** — Join an existing room (search + pick player or spectator) or create a new one (pick a map + format)
3. **Room** — Configure your Agent + API key, click Ready. The host starts when everyone is ready.
4. **Battle** — Agents auto-attack. Real-time arena with scoring.
5. **Results** — Podium, defense stats, Markdown battle report export.

### Three Ways to Connect

#### 🏠 Local (same machine)

No extra config. Client connects to `127.0.0.1:9000`.

#### 🏢 LAN (same WiFi / office network)

Start the server with `--lan`:

```bash
bash scripts/start-server.sh --lan
```

The server prints its LAN IP automatically. Other machines on the same network enter that IP in the client. To find it manually:

- **Mac**: `ifconfig | grep "inet " | grep -v 127.0.0.1` — look for `192.168.x.x`
- **Win**: `ipconfig` — look for `IPv4 Address`

#### 🌐 Remote (different networks)

Use **bore** — the simplest option. One command, no account needed:

**On the server machine:**

```bash
# Terminal 1: start the server
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000

# Terminal 2: open a public tunnel
bore local 9000 --to bore.pub
# Output: listening at bore.pub:57893
```

**On each client:**

Enter `bore.pub` as the server address and the port number from the output (e.g. `57893`).

> No registration, no credit card, no router config. If bore doesn't work due to a restrictive firewall, try [Tailscale](https://tailscale.com/download) (free, login with GitHub).

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
cd client && npm run dist:mac   # package → dist/AI-AWD Arena-*.dmg
```

See [AGENTS.md](AGENTS.md) for dev guide.

### Security · License

Targets bind `127.0.0.1`. Server is referee-only. Flags auto-redacted. Authorized lab & education use only. **MIT.**
