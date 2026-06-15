<p align="center">
  <img src="https://img.shields.io/badge/version-v1.0-brightgreen">
  <img src="https://img.shields.io/badge/tests-134%20passing-0fe8a0">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue">
  <img src="https://img.shields.io/badge/license-MIT-yellow">
</p>

<h1 align="center">⚔️ AI-AWD Arena</h1>
<h3 align="center">自定义应用层协议联网交互系统 — AI 攻防大乱斗</h3>

---

## 项目简介

本项目是一个基于 **C/S 架构** 的联网交互系统，客户端和服务端通过 **自定义应用层协议 AIAWD/1.0** 进行通信。系统模拟网络安全攻防对抗（AWD）场景：服务端作为裁判管理房间、调度比赛阶段、校验 Flag 并计分；客户端通过 Electron 桌面应用连接服务端，由 AI Agent 自动执行攻击和防守操作。

本仓库同时作为 **网络编程实验课程** 的提交项目，满足以下全部要求：

| 模块 | 要求 | 实现 |
|------|------|------|
| C/S 架构 | 独立服务端 + ≥2 客户端 | Python asyncio 服务端 + Electron 客户端 + Python Demo 客户端 |
| 自定义协议 | 客户端/服务端通过自定义协议通信 | AIAWD/1.0 — 4B 大端长度前缀 + UTF-8 JSON body，28 种消息类型 |
| 实时交互 | 客户端间实时操作同步 | ROOM_UPDATE / PHASE_SYNC(每5s) / RANKING_UPDATE / EVENT 广播 |
| 服务端权威状态 | 服务端最终状态，客户端不能自行决定 | 服务端生成 Flag、驱动阶段机、校验计分；ScopeGuard 约束客户端 |
| 并发处理 | 服务端同时处理多客户端连接 | asyncio 每连接协程 + 多房间并行 + 独立阶段调度 |
| 异常处理 | 非法消息/非法操作/断开等 | 9 种 ERROR 码 + 断线广播 + 心跳超时 + 阶段崩溃恢复 + 幂等去重 |
| 日志记录 | 服务端和客户端记录关键网络事件 | JSONL 事件日志（8+ 类型）+ HTTP API 查询 + Flag 自动脱敏 |
| 抓包分析 | Wireshark/tcpdump 分析完整交互 | 一键抓包脚本 + 完整抓包分析指南 |
| 现场演示 | 展示运行、协议交互、异常处理 | 5 环节逐步演示脚本 |

---

## 项目结构

```
├── src/                    源代码（→ server/aiawd_server/ + client/）
│   ├── server/             Python 服务端（asyncio TCP）
│   └── client/             Electron 桌面客户端（Node.js）
├── protocol.md             协议设计文档（提交用）
├── report.pdf              实验报告（需自行撰写）
├── logs/                   服务端与客户端日志
│   └── server/events.jsonl   服务端事件日志（JSONL 格式）
├── captures/               抓包文件（pcap）
│   └── capture.sh             一键抓包脚本
├── demo/                   演示辅助
│   └── demo_script.md         现场演示逐步操作指南
├── docs/                   详细技术文档
│   ├── AIAWD协议规格说明.md    完整协议规格（11 章）
│   └── 抓包分析指南.md         抓包实操指南
├── METHODS.md              方法总览（测试/抓包/演示操作）
├── METHODS.html            方法总览（浏览器可直接打开）
├── server/                 服务端源代码（原始位置）
├── client/                 客户端源代码（原始位置）
├── targets/                Docker 靶机模板（Web/PWN/Crypto，4 个）
├── tests/                  测试套件（Python 54 + Node 80）
└── examples/               Python 演示客户端
```

---

## 快速开始

### 环境要求

| 角色 | 需要 |
|------|------|
| **服务器**（一台电脑） | Python 3.11+ · Git |
| **每个人** | [Docker Desktop](https://docs.docker.com/desktop/) |
| **每个人** | LLM API Key（任意厂商，可选——用 mock-agent 不需要） |

> 服务器和客户端可以在同一台电脑上。用 mock-agent 模式下不需要任何 API Key。

### 1. 克隆仓库

```bash
git clone https://github.com/cyclotr0nzxj/ai-awd.git
cd ai-awd
```

### 2. 安装客户端依赖

```bash
cd client
npm install
cd ..
```

### 3. 启动服务端（一人运行即可）

```bash
# macOS / Linux
PYTHONPATH=server python3 -m aiawd_server.main --host 0.0.0.0 --port 9000 --http-port 9001
```

```bat
REM Windows
PYTHONPATH=server python3 -m aiawd_server.main --host 0.0.0.0 --port 9000 --http-port 9001
```

看到输出即就绪：

```
AI-AWD Arena TCP server listening on 0.0.0.0:9000
AI-AWD Arena HTTP API listening on 0.0.0.0:9001
```

### 4. 启动客户端

```bash
cd client
npx electron .
```

**连接页** — 填服务端地址（本机 `127.0.0.1`，局域网填服务端 IP），端口 `9000`，输入名字，点击连接。

### 5. 打一局

1. **房主** 在大厅页点「创建房间」— 选地图和赛制 — 创建
2. **队友** 点「加入房间」— 找到房间 — 参赛
3. **双方** 在房间页选 Agent（用 mock-agent 即可）、点准备
4. **房主** 点「开始大乱斗」— 系统自动推进阶段
5. 比赛结束自动跳转结算页

---

## 联机方式

| 方式 | 客户端填 | 说明 |
|------|---------|------|
| 🏠 本地 | `127.0.0.1:9000` | 同一台电脑测试 |
| 🏢 局域网 | `192.168.x.x:9000` | 服务端自动显示 LAN IP |
| 🌐 远程 | `bore.pub:<port>` | 用 [bore](https://github.com/ekzhang/bore) 打公网隧道 |

---

## 得分规则

- 攻陷对手 Flag → **+100 分**
- 你的 Flag 被对手提交 → **-50 分**
- 每个 Flag 全局只能被提交一次（幂等）

---

## 自动化测试

```bash
# 一键全部验证（推荐）
bash scripts/demo.sh --tcp-only

# Python 测试套件（54 个）
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v

# Node.js 测试套件（80 个）
cd client && node --test test-*.js
```

---

## 抓包分析

### 一键抓包

```bash
# 终端 1：服务端
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000

# 终端 2：启动抓包
bash captures/capture.sh

# 终端 3：运行演示 / Electron 人工对战
PYTHONPATH=server python3 examples/three_clients_demo.py

# 终端 2 按回车停止 → 生成 captures/aiawd_match_*.pcap
```

### 用 Wireshark 分析

```bash
open -a Wireshark captures/aiawd_match_*.pcap
# Filter → tcp.port == 9000
# 右键任意包 → Follow → TCP Stream
```

详细分析步骤见 **[docs/抓包分析指南.md](docs/抓包分析指南.md)**。

---

## 现场演示

参见 **[demo/demo_script.md](demo/demo_script.md)**，5 个环节逐步操作：

1. 启动服务端和两个客户端
2. 两个客户端完成实时交互
3. 展示服务端日志
4. 展示协议文档消息结构
5. 使用抓包文件解释通信过程

---

## 协议文档

完整协议规格见 **[protocol.md](protocol.md)**，包含：

- 帧格式（4B 长度头 + JSON body）
- 28 种消息类型定义
- 字段含义逐项说明
- 阶段状态机（LOBBY → PREPARE → DEFENSE → ATTACK → FINISHED）
- 9 种错误码及处理方式
- 心跳与广播机制
- 抓包分析指引

---

## 实验报告

参见 **[METHODS.md](METHODS.md)** 第九章的报告框架建议。报告需包括：系统架构、C/S 分工、协议设计、状态维护、并发处理、异常处理、抓包分析、测试截图、改进方向。

---

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 服务端 | Python 3.11+ · asyncio | TCP 长连接，每连接一个协程 |
| 客户端 | Electron · Node.js | 桌面 GUI，通过 IPC 桥接主进程 |
| 协议 | AIAWD/1.0（自定义） | 4B 大端长度 + UTF-8 JSON，最大 1MB/帧 |
| 靶机 | Docker Compose | 4 个模板：Web（2）、PWN（1）、Crypto（1） |
| 测试 | unittest · node:test | Python 54 + Node 80，全部通过 |
| 打包 | electron-builder | macOS DMG/ZIP + Windows NSIS/Portable |

---

## License

MIT · [AGENTS.md](AGENTS.md) 含开发者详细参考
