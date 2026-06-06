# AI-AWD Arena — Multi-Machine LAN Deployment / 多机联网部署

## Architecture / 架构

```
              ┌──────────────────────────────────┐
              │  Server Machine (Referee)         │
              │  aiawd_server.main (:9000/:9001)  │
              │  Room mgmt / Scoring / Ranking    │
              └──────────┬───────────────────────┘
                         │  TCP (AIAWD/1.0)
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Client A    │ │ Client B    │ │ Spectator C │
│ Electron    │ │ Electron    │ │ Electron    │
│ AI Agent    │ │ AI Agent    │ │ Read-only   │
│ Local target│ │ Local target│ │             │
└─────────────┘ └─────────────┘ └─────────────┘
```

## Requirements / 前置要求

Each machine needs / 每台机器需要:
- Docker Desktop — for local target lifecycle
- One LLM API key (any provider)

Server machine additionally needs / 服务器额外需要:
- Python 3.11+
- Git
- Open TCP port 9000 (client connections / 客户端连接)
- Open TCP port 9001 (HTTP API, optional / 可选)

## Step 1: Start Server / 启动服务器

On the **server machine** / 在服务器机器上:

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd

# LAN mode — listens on all network interfaces / 监听所有网络接口
bash scripts/start-server.sh --lan
```

Output / 输出:
```
AI-AWD Arena 裁判服务器
TCP 地址:  0.0.0.0:9000
HTTP API:  http://0.0.0.0:9001

📡 本机局域网 IP: 192.168.1.100
   客户端连接填:  192.168.1.100:9000
```

The server auto-detects and prints the LAN IP. Share this IP with other players. If automatic detection fails, find it manually:

```bash
# macOS / Linux
ifconfig | grep "inet " | grep -v 127.0.0.1

# Windows
ipconfig | findstr IPv4
```

Verify server is reachable / 验证服务器可访问:

```bash
curl http://<SERVER_IP>:9001/health
# → {"status":"ok","server":"ai-awd-arena"}
```

## Step 2: Start Clients / 启动客户端

On **each client machine** / 在每台客户端机器上:

### Option A: Packaged App / 打包 App (Recommended / 推荐)

Download the latest `.dmg` (macOS) or `.exe` (Windows) from [Releases](https://github.com/cyclotr0nzxj/ai-awd/releases). Install and launch.

In the connection page:
1. **服务器地址** → enter server LAN IP (e.g. `192.168.1.100`)
2. **端口** → `9000`
3. **你的名字** → enter your display name
4. Click **连接服务器**

### Option B: From Source / 从源码运行

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd/client
npm install
npm start
```

> Node.js 18+ required for source builds / 源码运行需要 Node.js 18+

## Step 3: Play a Match / 进行比赛

### Room Owner / 房主操作

1. Connect to the server
2. Click **创建房间** on the lobby page → fill in room name, select target template, choose a phase preset
3. Click **创建房间** in the overlay
4. Share the room ID with other players
5. In the room page, select your Agent model, fill in API key, click **准备**
6. Once all players are ready, click **开始大乱斗**

### Players / 参赛玩家

1. Connect to the server
2. Click **加入房间** on the lobby page → search or enter the room ID shared by the owner
3. Click **参赛**
4. In the room page, select your AI model provider, enter API key, click **准备**
5. Wait for the match to start

### Spectators / 观战

1. Connect to the server
2. Click **加入房间** → enter the room ID
3. Click **观战**

## Match Phases / 比赛阶段

```
LOBBY → PREPARE → DEFENSE → ATTACK → FINISHED
大厅     准备       加固      攻防      结束
```

During ATTACK phase, each player's AI agent scans opponent targets, finds `FLAG{...}` strings, and submits them:
- Successful capture → **+100 points**
- Your flag captured → **-50 points**
- Each flag scores only once globally

## Security / 安全边界

- Targets bind to `127.0.0.1` only — no public exposure / 靶机仅绑 localhost
- Attack scope limited to room-assigned `allowed_targets` / 攻击范围限于房间下发目标
- Private flags auto-redacted in screenshots, logs, and battle reports (`FLAG{已隐藏}`) / Flag 自动脱敏
- Spectators are read-only / 观战只读
- Server is referee-only — never executes attacks / 服务器仅裁判

## Troubleshooting / 故障排查

| Problem | Check |
|---------|-------|
| Client can't connect | Verify server IP and port; check firewall |
| Can't create room | Confirm you are connected to the server |
| Can't start match | Need ≥2 players, all with Target + Agent ready |
| Docker target won't start | Ensure Docker Desktop is running |
| Electron window blank | `cd client && npm install` |
