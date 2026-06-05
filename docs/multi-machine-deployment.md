# AI-AWD Arena — 多机联网部署指南

## 架构概述

```
┌─────────────────────────────────────────────────────────┐
│  服务器机器 (裁判服务器)                                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │  aiawd_server.main  (TCP :9000 / HTTP :9001)      │  │
│  │  - 房间管理 / 比赛裁判 / 计分排行                      │  │
│  │  - 靶机模板注册 (web / pwn / crypto)                │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────┬──────────────────────────────────────────┘
               │  TCP (AIAWD/1.0 协议)
       ┌───────┴────────┬──────────────┐
       ▼                ▼              ▼
┌────────────┐  ┌────────────┐  ┌────────────┐
│ 客户端 A    │  │ 客户端 B    │  │ 观战席 C   │
│ Electron   │  │ TUI        │  │ TUI        │
│ Agent 玩家  │  │ Agent 玩家  │  │ 只读        │
│ 靶机:本地   │  │ 靶机:本地   │  │            │
└────────────┘  └────────────┘  └────────────┘
```

## 前置要求

每台机器需要：
- Python 3.11+
- macOS / Windows / Linux
- (可选) Docker Desktop — 靶机生命周期管理
- (可选) Node.js 18+ — Electron 客户端

服务器机器额外需要：
- 开放 TCP 端口 9000（客户端连接）
- 开放 TCP 端口 9001（HTTP API，可选）

## 步骤一：启动服务器

在**服务器机器**上：

```bash
# 克隆仓库
git clone <repo-url> ai-awd
cd ai-awd

# 启动裁判服务器（监听所有网络接口）
bash scripts/start-server.sh --lan
```

服务器启动后显示：
```
 AI-AWD Arena 裁判服务器
 TCP 地址:  0.0.0.0:9000
 HTTP API:  http://0.0.0.0:9001
```

记下服务器的**局域网 IP 地址**（如 `192.168.1.100`）：

```bash
# macOS / Linux
ifconfig | grep "inet " | grep -v 127.0.0.1

# Windows
ipconfig | findstr IPv4
```

验证服务器可访问：
```bash
curl http://<服务器IP>:9001/health
# → {"status":"ok","server":"ai-awd-arena"}
```

## 步骤二：启动客户端

在**每台客户端机器**上：

### Electron 客户端（推荐，完整 GUI）

```bash
cd ai-awd/client
npm install
npm start
```

在左侧面板中：
1. **服务端地址** → 输入服务器 IP（如 `192.168.1.100`）
2. **端口** → `9000`
3. **显示名称** → 输入你的名字
4. 点击**连接**

首次启动会自动弹出新手教程，引导完成完整流程。

### TUI 客户端（终端模式）

```bash
cd ai-awd
python3 tui/aiawd_tui.py \
  --host <服务器IP> \
  --port 9000 \
  --name "你的名字" \
  --agent-runtime tui-agent \
  --model model-alpha
```

## 步骤三：进行一场 AI 攻防大乱斗

### 房主操作（Alice，Electron 客户端）

1. 连接裁判服务器
2. 创建房间：
   - 房间名：如 "周赛训练"
   - 靶机模板：`real_ctf_web_awd_01`
   - 玩家数量：按实际参赛人数设置
   - 阶段时长：建议准备 30s / 加固 60s / 攻防 120s
   - 点击**创建**
3. 记下房间 ID（如 `room_001`），告知其他玩家
4. 点击**靶机就绪**和 **Agent 就绪**
5. 等所有玩家就绪后，点击**开始比赛**

### 参赛玩家操作（Bob，TUI 客户端）

```
# 在 TUI 中输入
join room_001 player
ready target
ready agent
```

或使用中文别名：
```
参赛 room_001
靶机
就绪
```

### 观战操作（Carol）

```
# 在 TUI 中输入（或以 Electron 观战模式连接）
join room_001 spectator
```

或：`观战 room_001`

## 比赛阶段流程

```
大厅 (LOBBY)
  │  房主创建房间，玩家加入
  ▼
准备 (PREPARE)
  │  玩家确认靶机和 Agent 就绪
  ▼
加固 (DEFENSE)
  │  玩家加固自己的靶机防线
  ▼
攻防 (ATTACK)
  │  Agent 攻击对手靶机，提交 Flag 得分
  ▼
结束 (FINISHED)
  │  查看排行榜和战报
```

## Flag 提交流程

在 ATTACK 阶段：

1. Agent 自动（或手动）攻击对手靶机
2. 获取 Flag（格式：`FLAG{...}`）
3. 提交 Flag：
   - Electron：在「提交攻陷凭证」框中粘贴 Flag，点击提交
   - TUI：`submit FLAG{...}`
4. 裁判验证通过后：
   - 提交方 +100 分
   - 失守方 -50 分
   - 排行榜实时更新
   - 竞技场显示攻陷动画

## 安全边界

- 攻击行为仅限**房间内下发的 `allowed_targets`**
- 靶机仅绑定 `127.0.0.1`，不暴露到公网
- Flag 在战报、截图、日志中自动隐藏（显示为 `FLAG{已隐藏}`）
- 观战席只读，无法提交 Flag 或开始比赛
- 禁止攻击未授权的目标

## 故障排查

| 问题 | 检查 |
|------|------|
| 客户端连不上服务器 | 确认服务器 IP 和端口正确；检查防火墙 |
| 无法创建房间 | 确认已连接裁判服务器 |
| 无法开始比赛 | 至少需要 2 名参赛玩家，且都确认 Target/Agent 就绪 |
| Docker 靶机无法启动 | 确认 Docker Desktop 正在运行 |
| Electron 窗口白屏 | `cd client && npm install` 重新安装依赖 |

## 演示脚本

单机完整演示（不需要多台机器）：

```bash
# 全部演示
bash scripts/demo.sh

# 快速演示（跳过 Docker live）
bash scripts/demo.sh --quick
```

更多细节见 [README.md](../README.md)。
