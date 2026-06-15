# AI-AWD Arena — 完整方法总览

> 课程作业：网络编程实验 — 自定义应用层协议的联网交互系统
>
> 本文件汇总 **代码结构、测试方法、抓包方法、现场演示流程** 四大块内容。

---

## 一、项目结构

```
项目根目录/
├── src/                   源代码（符号链）
│   ├── server/            → server/aiawd_server/    Python 服务端（9 模块）
│   └── client/            → client/                 Electron 桌面客户端
├── README.md              编译与运行说明
├── protocol.md            协议设计文档 ← 提交时交这个
├── logs/                  服务端与客户端日志
│   ├── server/events.jsonl   服务端事件日志（JSONL）
│   └── electron/              Electron 截图证据
├── captures/              抓包文件 ← 新建
│   ├── capture.sh             一键抓包脚本
│   └── aiawd_match_*.pcap     tcpdump 生成的 pcap 文件（你打完放这里）
├── demo/                  演示辅助
│   └── demo_script.md         现场演示逐步操作指南
├── docs/                  详细文档
│   ├── AIAWD协议规格说明.md   完整协议规格（11 章）
│   └── 抓包分析指南.md         抓包实操（tcpdump + Wireshark）
├── report.pdf             实验报告 ← 你写
├── server/                服务端源代码（原始位置）
├── client/                客户端源代码（原始位置）
├── targets/               Docker 靶机（4 个模板）
├── tests/                 测试套件（Python 54 + Node 80）
└── examples/              Python 演示客户端
```

---

## 二、代码已完成的全部课程要求

| # | 课程要求 | 实现方式 | 关键文件 |
|---|---------|---------|---------|
| 1 | C/S 架构 | Python asyncio 服务端 + Electron 客户端 + Python Demo 客户端 | `server/aiawd_server/tcp_gateway.py`, `client/main.js`, `examples/three_clients_demo.py` |
| 2 | 自定义协议 | AIAWD/1.0：4B 大端长度头 + UTF-8 JSON body，28 种消息类型 | `server/aiawd_server/protocol.py`, `client/aiawdProtocol.js`, `protocol.md` |
| 3 | 实时交互 | 广播机制：ROOM_UPDATE / PHASE_SYNC(每5s) / RANKING_UPDATE / EVENT | `server/aiawd_server/tcp_gateway.py:_broadcast()` |
| 4 | 服务端权威 | 服务端生成 Flag、SHA-256 校验、阶段机驱动、计分仲裁 | `server/aiawd_server/match_engine.py` |
| 5 | 并发处理 | asyncio 每连接协程 + 多房间并行 + 独立阶段调度任务 | `server/aiawd_server/tcp_gateway.py:_handle_client()` |
| 6 | 异常处理 | 9 种 ERROR 码 + 断线广播 + 心跳超时 + 阶段崩溃恢复 + 幂等去重 | `server/aiawd_server/tcp_gateway.py:_dispatch()` |
| 7 | 日志记录 | LogStore JSONL：SERVER_STARTED, CLIENT_CONNECTED, ROOM_CREATED, FLAG_SUBMITTED 等 8+ 类型 | `server/aiawd_server/log_store.py`, `logs/server/events.jsonl` |
| 8 | 抓包分析 | tcpdump 抓包 → Wireshark 分析帧结构 + Follow TCP Stream + 广播扇出 | `captures/capture.sh`, `docs/抓包分析指南.md` |
| 9 | 协议文档 | `protocol.md` 12 章：消息格式、类型、字段含义、状态机、错误处理、抓包分析 | `protocol.md` |

---

## 三、测试方法

### 3.1 自动化测试

```bash
# Python 测试套件（54 个）
cd ai-awd
PYTHONPATH=server python3 -m unittest discover -s tests -t . -v

# Node.js 测试套件（80 个）
cd client
node --test test-aiawdProtocol.js test-targetLifecycle.js test-renderer.js test-agentRuntime.js test-adapters.js test-main.js

# 一键全部验证
bash scripts/demo.sh --tcp-only
```

### 3.2 人工测试（你和队友实战）

**准备**：两台电脑（或一台开两个客户端窗口）

```bash
# —— 一个人跑服务端 ——
PYTHONPATH=server python3 -m aiawd_server.main --host 0.0.0.0 --port 9000
```

```bash
# —— 两人各自启动客户端 ——
cd ai-awd/client
npx electron .
```

**操作流程**（约 15 分钟）：

| 步骤 | 操作人 | 操作 |
|------|--------|------|
| 1 | 两人 | 连接页填服务端 IP + 端口，点连接 |
| 2 | 房主 | 大厅页点"创建房间"，选地图和格式 |
| 3 | 队友 | 大厅页找到房间，点"参赛" |
| 4 | 两人 | 房间页选 Agent（mock-agent 即可），点准备 |
| 5 | 房主 | 点"开始大乱斗" |
| 6 | — | 观察自动阶段推进+攻击动画+排行榜刷新 |
| 7 | — | 结束后看结算页面和排行榜 |

**截图时机**：

1. 📸 连接页（两客户端连接成功）
2. 📸 房间页（双方准备状态）
3. 📸 大乱斗页（攻击动画 + 排行榜）
4. 📸 结算页（最终排名）
5. 📸 终端日志（`tail -20 logs/server/events.jsonl`）
6. 📸 Wireshark Follow TCP Stream
7. 📸 Wireshark 单帧 HEX + JSON 对照

---

## 四、抓包方法

### 4.1 一键抓包

```bash
# 终端 1：启动服务端
PYTHONPATH=server python3 -m aiawd_server.main --host 127.0.0.1 --port 9000

# 终端 2：启动抓包
bash captures/capture.sh
# 脚本自动检测网卡、后台启动 tcpdump、等待你按回车停止

# 终端 3：运行演示（或你们在 Electron 里打比赛）
PYTHONPATH=server python3 examples/three_clients_demo.py

# 回到终端 2 按回车停止抓包
```

### 4.2 手动抓包

```bash
# macOS
sudo tcpdump -i lo0 -w captures/aiawd_match.pcap -s 0 'tcp port 9000'

# Linux
sudo tcpdump -i lo -w captures/aiawd_match.pcap -s 0 'tcp port 9000'

# 按 Ctrl+C 停止
```

### 4.3 Wireshark 分析

```bash
# 打开 pcap
open -a Wireshark captures/aiawd_match_*.pcap

# 或在命令行快速预览
tcpdump -r captures/aiawd_match_*.pcap -A | grep '"type"' | head -20
```

**Wireshark 三步分析**：

1. Filter: `tcp.port == 9000`
2. 右键 → Follow → TCP Stream（看完整对话）
3. 观察 4 字节长度头 + JSON body 的对应关系

详细步骤见 `docs/抓包分析指南.md`。

---

## 五、现场演示流程（5 个环节）

### 环节 1 — 启动服务端和两个客户端

```bash
PYTHONPATH=server python3 -m aiawd_server.main --host 0.0.0.0 --port 9000
```

两个客户端 Electron 窗口分别连接。

**口述**：展示 C/S 架构 — 服务端 + 两个客户端通过自定义协议通信。

### 环节 2 — 实时交互

房主创建房间 → 队友加入 → 双方准备 → 开始比赛 → 攻击阶段自动推进。

**口述**：服务端广播 ROOM_UPDATE / PHASE_SYNC / RANKING_UPDATE，两个客户端状态实时同步。

### 环节 3 — 日志记录

```bash
tail -20 logs/server/events.jsonl | python3 -m json.tool
```

**口述**：JSONL 格式记录 SERVER_STARTED → CLIENT_CONNECTED → ROOM_CREATED → FLAG_SUBMITTED 等全部关键事件。

### 环节 4 — 协议文档

展示 `protocol.md` 中任意一条消息示例，逐字段解释 `v`、`type`、`seq`、`client_id`、`payload` 的含义。

### 环节 5 — 抓包分析

打开 Wireshark，加载 pcap 文件，Follow TCP Stream，对着一条 HELLO 帧解释：
"前 4 字节是大端长度头，后面是 UTF-8 JSON body，明文可读。所有 AIAWD/1.0 消息都是这个格式。"

---

## 六、现成素材清单

| 素材 | 位置 | 状态 |
|------|------|------|
| 服务端代码 | `src/server/` | ✅ 已完成 |
| 客户端代码（Electron） | `src/client/` | ✅ 已完成 |
| 客户端代码（Python Demo） | `examples/three_clients_demo.py` | ✅ 已完成 |
| 协议文档 | `protocol.md` | ✅ 已完成 |
| 抓包分析指南 | `docs/抓包分析指南.md` | ✅ 已完成 |
| 抓包脚本 | `captures/capture.sh` | ✅ 已完成 |
| 服务端日志（示例） | `logs/server/events.jsonl` | 运行 demo 后生成 |
| 抓包文件 | `captures/aiawd_match_*.pcap` | 人工测试时抓取 |
| 人工测试截图/视频 | 你截 | 打一局截 7 张 |
| Wireshark 分析截图 | 你截 | 打开 pcap 截 3 张 |
| 现场演示脚本 | `demo/demo_script.md` | ✅ 已完成 |
| 实验报告 | `report.pdf` | 你写 |

---

## 七、report.pdf 报告框架建议

```
第 1 章：系统总体架构
  - 架构图：服务端 ←→ 多个客户端
  - 技术栈：Python asyncio + Electron + Node.js
  - 引用 src/ 目录结构

第 2 章：客户端/服务端分工
  - 服务端：房间管理、阶段调度、Flag 生成与校验、计分、广播
  - 客户端：连接服务端、UI 展示、Agent 执行、Flag 提交上报
  - 服务端权威原则

第 3 章：自定义协议设计
  - 消息格式（4B 长度 + JSON body）
  - 消息类型（28 种）
  - 字段含义（逐字段解释）
  - 状态变化规则（LOBBY → PREPARE → DEFENSE → ATTACK → FINISHED）
  - 错误处理方式（9 种错误码 + 幂等性 + 连接恢复）
  - 引用 protocol.md 原文

第 4 章：服务端状态维护方式
  - 内存数据结构（Room / Match / Session / FlagRecord）
  - 阶段调度器 asyncio Task
  - 广播机制

第 5 章：并发处理方式
  - asyncio 每连接协程
  - 多房间独立 MatchEngine
  - 独立阶段调度任务

第 6 章：异常情况处理
  - 协议错误（非法 JSON、HELLO 前消息、超长帧）
  - 业务错误（阶段错误、权限不足、无效 Flag、房间满）
  - 连接异常（断线广播、心跳超时、asyncio 异常静默关闭）
  - 幂等去重

第 7 章：抓包分析结果
  - 附图：Wireshark Follow TCP Stream
  - 附图：单帧 HEX + JSON 对照
  - 附图：广播扇出对比
  - 分析：帧定界、明文可读性、单播 vs 广播

第 8 章：测试过程与运行截图
  - 自动化测试结果（54 + 80 全部通过）
  - 人工测试截图（7 张）
  - Wireshark 分析截图（3 张）

第 9 章：项目不足与改进方向
  - 抓包分析缺少自动化工具
  - 无 TLS 加密（明文 JSON）
  - 靶机依赖 Docker（纯软件环境可简化）
  - 可扩展：Agent SDK、自定义靶机 marketplace
```
